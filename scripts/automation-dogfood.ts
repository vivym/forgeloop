import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AutomationDaemon } from '../apps/automation-daemon/src/automation-daemon';
import { loadDaemonWorkflowPolicyDigest } from '../apps/automation-daemon/src/workflow-policy-loader';
import {
  AutomationHttpClient,
  signAutomationRequest,
  type AutomationGenerationPlanningConfig,
  type AutomationActionResponse,
  type ClaimNextActionInput,
  type NextAction,
} from '../packages/automation/src/index';
import {
  CodexAppServerEndpointTransport,
  createCodexGenerationRuntime,
  effectiveConfigFromResponse,
  type CodexAppServerTransport,
  type CodexGenerationRuntime,
} from '../packages/codex-runtime/src/index';
import {
  CliDockerRunner,
  CodexRuntimeControlPlaneClient,
  DockerizedCodexAppServerLauncher,
  createLocalCodexWorkerRuntime,
  createRemoteCodexWorkerClient,
} from '../packages/codex-worker-runtime/src/index';
import { InMemoryDeliveryRepository, type DeliveryRepository } from '../packages/db/src/index';
import type { AutomationActionRun, Plan, PlanRevision, Project, Spec, WorkItem } from '../packages/domain/src/index';
import { createLeasedDockerCodexGenerationRuntime, createRemoteCodexGenerationRuntime } from '../apps/automation-daemon/src/generation-runtime';
import {
  loadCodexRuntimeDogfoodBootstrapConfig,
  runCodexRuntimeDogfoodBootstrap,
  type CodexRuntimeDogfoodBootstrapConfig,
} from './codex-runtime-dogfood-bootstrap';
import {
  automationDogfoodExitCode,
  renderAutomationDogfoodSummary,
  type AutomationDogfoodSummaryInput,
} from './automation-dogfood-summary';
import { codexCanonicalDigest, validateCodexDockerRuntimeEvidence } from '../packages/domain/src/index';

interface AutomationDogfoodResult extends AutomationDogfoodSummaryInput {
  exitCode: number;
}

type EnvLike = Record<string, string | undefined>;

export interface DogfoodGenerationRuntimeConfig {
  planning: AutomationGenerationPlanningConfig;
  runtime?: CodexGenerationRuntime;
  localDockerRequested?: boolean;
  remoteOutboundRequested?: {
    waitTimeoutMs: number;
    pollIntervalMs: number;
  };
  observedDockerRuntimeEvidence?: Array<ReturnType<typeof validateCodexDockerRuntimeEvidence>>;
  cleanup?: () => void;
  appServerDogfood: AutomationDogfoodSummaryInput['appServerDogfood'];
}

const automationSecret = process.env.FORGELOOP_AUTOMATION_DOGFOOD_SECRET ?? 'automation-dogfood-secret';
const automationActorId = process.env.FORGELOOP_AUTOMATION_ACTOR_ID ?? 'automation-dogfood-actor';
const automationDaemonIdentity = process.env.FORGELOOP_AUTOMATION_DAEMON_IDENTITY ?? 'automation-dogfood-daemon';
const requirementIntakeContext = {
  type: 'requirement',
  stakeholder_problem: 'Automation dogfood fixtures need typed intake context.',
  desired_outcome: 'Automation dogfood can create valid requirement Work Items.',
  acceptance_criteria: ['Plan and package drafts are created without enqueueing a run.'],
  in_scope: ['Automation dogfood script'],
};
const actorOwner = process.env.FORGELOOP_ACTOR_OWNER ?? 'actor-owner';
const actorReviewer = process.env.FORGELOOP_ACTOR_REVIEWER ?? 'actor-reviewer';
const repoId = process.env.FORGELOOP_REPO_ID ?? 'forgeloop';
const repoPath = resolve(process.env.FORGELOOP_REPO_PATH ?? process.cwd());
const expectedPendingBeforeRestartActionTypes = ['ensure_plan_draft', 'project_runtime_snapshot'] as const;

const createDogfoodGenerationPlanning = (
  mode: AutomationGenerationPlanningConfig['mode'],
): AutomationGenerationPlanningConfig => ({
  mode,
  tasks: {
    spec_draft: { enabled: false, promptVersion: 'spec-draft.fake.v1', outputSchemaVersion: 'spec_draft.v1' },
    plan_draft: { enabled: mode !== 'disabled', promptVersion: 'plan-draft.fake.v1', outputSchemaVersion: 'plan_draft.v1' },
    package_drafts: { enabled: mode !== 'disabled', promptVersion: 'package-drafts.fake.v1', outputSchemaVersion: 'package_drafts.v1' },
  },
});

const optionalNonBlankEnv = (env: EnvLike, key: string): string | undefined => {
  const value = env[key];
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
};

const requiredConfigEnv = (env: EnvLike, key: string): string => {
  const value = optionalNonBlankEnv(env, key);
  if (value === undefined) {
    throw new Error(`${key}_missing`);
  }
  return value;
};

const positiveIntConfigEnv = (env: EnvLike, key: string): number => {
  const raw = requiredConfigEnv(env, key);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key}_invalid`);
  }
  return value;
};

export const requestedGenerationMode = (env: EnvLike = process.env): AutomationGenerationPlanningConfig['mode'] => {
  const explicitLegacyMode = optionalNonBlankEnv(env, 'FORGELOOP_CODEX_AUTOMATION_GENERATION');
  const legacyMode = explicitLegacyMode ?? 'fake';
  const driver = optionalNonBlankEnv(env, 'FORGELOOP_CODEX_GENERATION_DRIVER');
  const mode = legacyMode === 'codex' ? 'app_server' : legacyMode;
  if (driver !== undefined) {
    if (driver === 'cli' || driver === 'exec' || driver === 'exec_fallback' || driver === 'codex_exec') {
      throw new Error(`FORGELOOP_CODEX_GENERATION_DRIVER_${driver}_not_allowed`);
    }
    if (driver !== 'fake' && driver !== 'app_server') {
      throw new Error('FORGELOOP_CODEX_GENERATION_DRIVER_must_be_fake_or_app_server');
    }
    if (explicitLegacyMode !== undefined && mode !== driver) {
      throw new Error('FORGELOOP_CODEX_GENERATION_DRIVER_conflicts_with_FORGELOOP_CODEX_AUTOMATION_GENERATION');
    }
    return driver;
  }
  if (mode === 'fake' || mode === 'app_server' || mode === 'disabled') {
    return mode;
  }
  throw new Error('FORGELOOP_CODEX_AUTOMATION_GENERATION_invalid');
};

const preflightBlockedGeneration = (reasonCode: string): DogfoodGenerationRuntimeConfig => ({
  planning: createDogfoodGenerationPlanning('app_server'),
  appServerDogfood: { status: 'blocked', reasonCode },
});

export const loadDogfoodGenerationRuntimeConfig = (env: EnvLike = process.env): DogfoodGenerationRuntimeConfig => {
  const mode = requestedGenerationMode(env);
  if (mode === 'disabled') {
    return {
      planning: createDogfoodGenerationPlanning('disabled'),
      appServerDogfood: { status: 'skipped', reasonCode: 'generation_disabled' },
    };
  }

  if (mode === 'app_server') {
    const workerMode = optionalNonBlankEnv(env, 'FORGELOOP_CODEX_WORKER_MODE');
    if (workerMode === 'local_docker') {
      return {
        planning: createDogfoodGenerationPlanning('app_server'),
        localDockerRequested: true,
        appServerDogfood: { status: 'blocked', reasonCode: 'codex_worker_unavailable' },
      };
    }
    if (workerMode === 'remote_outbound') {
      const waitTimeoutMs = positiveIntConfigEnv(env, 'FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_WAIT_TIMEOUT_MS');
      const pollIntervalMs = positiveIntConfigEnv(env, 'FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_POLL_INTERVAL_MS');
      return {
        planning: createDogfoodGenerationPlanning('app_server'),
        remoteOutboundRequested: {
          waitTimeoutMs,
          pollIntervalMs,
        },
        appServerDogfood: { status: 'blocked', reasonCode: 'codex_worker_unavailable', runtimeMode: 'remote_outbound' },
      };
    }
    return preflightBlockedGeneration('codex_docker_runtime_required');
  }

  return {
    planning: createDogfoodGenerationPlanning('fake'),
    runtime: createCodexGenerationRuntime({ mode: 'fake' }),
    appServerDogfood: { status: 'skipped', reasonCode: 'fake_generation_mode' },
  };
};

const humanAdminHeaders = {
  'x-forgeloop-actor-id': actorOwner,
  'x-forgeloop-actor-class': 'human_admin',
};
const reviewerHeaders = {
  'x-forgeloop-actor-id': actorReviewer,
  'x-forgeloop-actor-class': 'human',
};

const bootControlPlane = async (): Promise<{ app: INestApplication; repository: DeliveryRepository; baseUrl: string }> => {
  const [{ AppModule }, { DELIVERY_REPOSITORY }, { DELIVERY_RUN_WORKER }] = await Promise.all([
    import('../apps/control-plane-api/src/app.module'),
    import('../apps/control-plane-api/src/modules/core/control-plane-tokens'),
    import('../apps/control-plane-api/src/modules/run-control/run-worker.token'),
  ]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DELIVERY_REPOSITORY)
    .useValue(new InMemoryDeliveryRepository())
    .overrideProvider(DELIVERY_RUN_WORKER)
    .useValue({ kick: () => undefined, drainOnce: async () => undefined })
    .compile();
  const app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.useLogger(false);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  return { app, repository: app.get(DELIVERY_REPOSITORY) as DeliveryRepository, baseUrl: `http://127.0.0.1:${address.port}` };
};

const createAutomationClient = (baseUrl: string): AutomationHttpClient =>
  new AutomationHttpClient({
    baseUrl,
    actorId: automationActorId,
    daemonIdentity: automationDaemonIdentity,
    secret: automationSecret,
  });

const requiredDogfoodEnv = (key: string): string => {
  const value = optionalNonBlankEnv(process.env, key);
  if (value === undefined) {
    throw new Error(`${key}_missing`);
  }
  return value;
};

const dogfoodPositiveIntEnv = (key: string): number | undefined => {
  const raw = optionalNonBlankEnv(process.env, key);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key}_invalid`);
  }
  return value;
};

const dogfoodAppServerTransport = (): 'unix' | 'websocket' | 'docker_exec' => {
  const raw = optionalNonBlankEnv(process.env, 'FORGELOOP_CODEX_APP_SERVER_TRANSPORT');
  if (raw === undefined) {
    return 'docker_exec';
  }
  if (raw === 'unix' || raw === 'websocket' || raw === 'docker_exec') {
    return raw;
  }
  throw new Error('FORGELOOP_CODEX_APP_SERVER_TRANSPORT_invalid');
};

const codexEffectiveConfigProbe = async (
  endpoint: `unix:${string}` | `ws://${string}` | `docker-exec:${string}`,
  auth?: { bearerToken: string },
  createTransport?: () => CodexAppServerTransport,
): Promise<Record<string, unknown>> => {
  const transport = createTransport?.() ?? new CodexAppServerEndpointTransport(endpoint, auth);
  try {
    await transport.initialize?.();
    for (const [method, params] of [
      ['config/read', { includeLayers: false }],
      ['getEffectiveConfig', {}],
      ['codex/getEffectiveConfig', {}],
      ['effective_config', {}],
    ] as const) {
      try {
        const response = await transport.request(method, params);
        const config = effectiveConfigFromResponse(response);
        if (config !== undefined) {
          return config as Record<string, unknown>;
        }
      } catch {
        // Try the next known effective-config method name.
      }
    }
  } finally {
    await transport.close?.().catch(() => undefined);
  }
  throw new Error('codex_app_server_effective_config_mismatch');
};

const dogfoodTrustedActorSigner = (input: { method: string; pathAndQuery: string; rawBody: string }) =>
  signAutomationRequest({
    ...input,
    actorId: automationActorId,
    actorClass: 'automation_daemon',
    daemonIdentity: automationDaemonIdentity,
    timestamp: new Date().toISOString(),
    secret: automationSecret,
  });

const bootstrapConfigForProject = (baseUrl: string, project: Project): CodexRuntimeDogfoodBootstrapConfig =>
  loadCodexRuntimeDogfoodBootstrapConfig({
    ...process.env,
    FORGELOOP_CONTROL_PLANE_URL: baseUrl,
    FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: automationSecret,
    FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID: project.id,
    FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID: repoId,
  });

const createDogfoodLocalDockerGenerationRuntime = async (input: {
  baseUrl: string;
  project: Project;
  generation: DogfoodGenerationRuntimeConfig;
}): Promise<DogfoodGenerationRuntimeConfig> => {
  const observedDockerRuntimeEvidence: Array<ReturnType<typeof validateCodexDockerRuntimeEvidence>> = [];
  const bootstrapConfig = bootstrapConfigForProject(input.baseUrl, input.project);
  const bootstrapSummary = await runCodexRuntimeDogfoodBootstrap(bootstrapConfig);
  const dockerImageDigest = String(bootstrapSummary.docker_image_digest);
  const networkPolicyDigest = String(bootstrapSummary.network_policy_digest);
  const networkProviderConfigDigest = String(bootstrapSummary.network_provider_config_digest);
  const generationRuntimeProfileId = String(bootstrapSummary.generation_runtime_profile_id);
  const generationCredentialBindingId = String(bootstrapSummary.generation_credential_binding_id);
  const workerId = optionalNonBlankEnv(process.env, 'FORGELOOP_CODEX_WORKER_ID') ?? bootstrapConfig.workerIdentity;
  const workerTempRoot = requiredDogfoodEnv('FORGELOOP_WORKER_TEMP_ROOT');
  const generationArtifactRoot = requiredDogfoodEnv('FORGELOOP_CODEX_GENERATION_ARTIFACT_ROOT');
  const dockerBin = optionalNonBlankEnv(process.env, 'FORGELOOP_DOCKER_BIN') ?? 'docker';
  const controlPlaneClient = new CodexRuntimeControlPlaneClient({
    baseUrl: input.baseUrl,
    trustedActorSigner: dogfoodTrustedActorSigner,
  });
  const nonceFactory = () => randomUUID();
  const now = () => new Date().toISOString();
  const worker = createLocalCodexWorkerRuntime({
    workerId,
    workerIdentity: bootstrapConfig.workerIdentity,
    version: 'automation-dogfood-local-docker',
    bootstrapToken: bootstrapConfig.workerBootstrapToken,
    bootstrapTokenVersion: bootstrapConfig.workerBootstrapTokenVersion,
    authorizedScopes: [bootstrapConfig.allowedScope],
    capabilities: ['generation'],
    dockerImageDigests: [dockerImageDigest],
    networkPolicyDigests: [networkPolicyDigest],
    networkProviderConfigDigests: [networkProviderConfigDigest],
    hostUid: bootstrapConfig.hostWorkerUid,
    hostGid: bootstrapConfig.hostWorkerGid,
    maxConcurrency: 1,
    controlPlaneClient,
    now,
    nonceFactory,
  });
  await worker.register();
  await worker.heartbeat();
  const heartbeat = worker.startHeartbeatLoop();
  const launcher = new DockerizedCodexAppServerLauncher({
    dockerBin,
    workerId,
    workerTempRoot,
    dockerRunner: new CliDockerRunner(dockerBin),
    controlPlaneClient,
    hostUid: bootstrapConfig.hostWorkerUid,
    hostGid: bootstrapConfig.hostWorkerGid,
    appServerTransport: dogfoodAppServerTransport(),
    allowedRepoRoots: [repoPath],
    effectiveConfigProbe: codexEffectiveConfigProbe,
    now,
    nonceFactory,
  });
  const turnTimeoutMs = dogfoodPositiveIntEnv('FORGELOOP_CODEX_GENERATION_TURN_TIMEOUT_MS');
  const outputLimitBytes = dogfoodPositiveIntEnv('FORGELOOP_CODEX_GENERATION_OUTPUT_LIMIT_BYTES');
  const rawNotificationLimitBytes = dogfoodPositiveIntEnv('FORGELOOP_CODEX_GENERATION_RAW_NOTIFICATION_LIMIT_BYTES');
  const maxConcurrency = dogfoodPositiveIntEnv('FORGELOOP_CODEX_GENERATION_MAX_CONCURRENCY');
  const runtime = createLeasedDockerCodexGenerationRuntime({
    worker,
    launcher,
    dockerImageDigest,
    createLaunchLease: async ({ taskKind, workerId: selectedWorkerId, generationInput }) => {
      const orchestration = generationInput.orchestration;
      if (orchestration === undefined) {
        throw new Error('codex_launch_lease_denied');
      }
      const status = await controlPlaneClient.getStatus({
        projectId: generationInput.projectId,
        repoId: generationInput.repoIds[0],
        targetKind: 'generation',
        runtimeProfileId: generationRuntimeProfileId,
        credentialBindingId: generationCredentialBindingId,
      });
      if (
        status.runtime_profile_revision_id === undefined ||
        status.credential_binding_id === undefined ||
        status.credential_binding_version_id === undefined ||
        status.credential_payload_digest === undefined
      ) {
        throw new Error(status.blocker_codes?.[0] ?? 'codex_launch_lease_denied');
      }
      const response = (await controlPlaneClient.createLaunchLease({
        id: `codex-generation-lease-${orchestration.actionRunId}-${randomUUID()}`,
        lease_request_id: `codex-generation-lease-request-${orchestration.actionRunId}-${taskKind}-${randomUUID()}`,
        target: {
          target_type: 'automation_action_run',
          target_id: orchestration.actionRunId,
          target_kind: 'generation',
          project_id: generationInput.projectId,
          ...(generationInput.repoIds[0] === undefined ? {} : { repo_id: generationInput.repoIds[0] }),
        },
        worker_id: selectedWorkerId,
        runtime_profile_revision_id: status.runtime_profile_revision_id,
        credential_binding_id: status.credential_binding_id,
        credential_binding_version_id: status.credential_binding_version_id,
        credential_payload_digest: status.credential_payload_digest,
        launch_token: `codex-launch-${randomBytes(32).toString('base64url')}`,
        launch_attempt: orchestration.actionAttempt,
        action_type: orchestration.actionType,
        action_attempt: orchestration.actionAttempt,
        action_claim_token: orchestration.claimToken,
        precondition_fingerprint: orchestration.preconditionFingerprint,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      })) as { lease: { id: string }; launch_token: string };
      return { leaseId: response.lease.id, launchToken: response.launch_token };
    },
    runtimeConfig: {
      artifactRoot: generationArtifactRoot,
      workspaceRoot: repoPath,
      ...(turnTimeoutMs === undefined ? {} : { timeoutMs: turnTimeoutMs }),
      ...(outputLimitBytes === undefined ? {} : { outputLimitBytes }),
      ...(rawNotificationLimitBytes === undefined ? {} : { rawNotificationLimitBytes }),
      ...(maxConcurrency === undefined ? {} : { maxConcurrency }),
    },
    onDockerRuntimeEvidence: (evidence) => {
      observedDockerRuntimeEvidence.push(validateCodexDockerRuntimeEvidence(evidence));
    },
  });

  return {
    ...input.generation,
    runtime,
    cleanup: () => heartbeat.stop(),
    observedDockerRuntimeEvidence,
    appServerDogfood: { status: 'blocked', reasonCode: 'codex_worker_unavailable', runtimeMode: 'local_docker' },
  };
};

const createDogfoodRemoteOutboundGenerationRuntime = async (input: {
  baseUrl: string;
  project: Project;
  generation: DogfoodGenerationRuntimeConfig;
}): Promise<DogfoodGenerationRuntimeConfig> => {
  const remote = input.generation.remoteOutboundRequested;
  if (remote === undefined) {
    return input.generation;
  }
  const bootstrapConfig = bootstrapConfigForProject(input.baseUrl, input.project);
  const bootstrapSummary = await runCodexRuntimeDogfoodBootstrap(bootstrapConfig);
  const dockerImageDigest = String(bootstrapSummary.docker_image_digest);
  const networkPolicyDigest = String(bootstrapSummary.network_policy_digest);
  const networkProviderConfigDigest = String(bootstrapSummary.network_provider_config_digest);
  const generationRuntimeProfileId = String(bootstrapSummary.generation_runtime_profile_id);
  const generationCredentialBindingId = String(bootstrapSummary.generation_credential_binding_id);
  const workerId = optionalNonBlankEnv(process.env, 'FORGELOOP_CODEX_WORKER_ID') ?? bootstrapConfig.workerIdentity;
  const workerTempRoot = requiredDogfoodEnv('FORGELOOP_WORKER_TEMP_ROOT');
  const dockerBin = optionalNonBlankEnv(process.env, 'FORGELOOP_DOCKER_BIN') ?? 'docker';
  const now = () => new Date().toISOString();
  const nonceFactory = () => randomUUID();
  const controlPlaneClient = new CodexRuntimeControlPlaneClient({
    baseUrl: input.baseUrl,
    trustedActorSigner: dogfoodTrustedActorSigner,
    now,
    nonceFactory,
  });
  const launcher = new DockerizedCodexAppServerLauncher({
    dockerBin,
    workerId,
    workerTempRoot,
    dockerRunner: new CliDockerRunner(dockerBin),
    controlPlaneClient,
    hostUid: bootstrapConfig.hostWorkerUid,
    hostGid: bootstrapConfig.hostWorkerGid,
    appServerTransport: dogfoodAppServerTransport(),
    allowedRepoRoots: [repoPath],
    effectiveConfigProbe: codexEffectiveConfigProbe,
    now,
    nonceFactory,
  });
  let remoteWorkerRunning = true;
  const worker = createRemoteCodexWorkerClient({
    workerId,
    workerIdentity: bootstrapConfig.workerIdentity,
    version: 'automation-dogfood-remote-outbound',
    bootstrapToken: bootstrapConfig.workerBootstrapToken,
    bootstrapTokenVersion: bootstrapConfig.workerBootstrapTokenVersion,
    workerTempRoot,
    allowedScopes: [bootstrapConfig.allowedScope],
    capabilities: ['generation'],
    dockerImageDigests: [dockerImageDigest],
    networkPolicyDigests: [networkPolicyDigest],
    networkProviderConfigDigests: [networkProviderConfigDigest],
    hostUid: bootstrapConfig.hostWorkerUid,
    hostGid: bootstrapConfig.hostWorkerGid,
    maxConcurrency: 1,
    controlPlaneClient,
    launcher,
    scavenger: async () => undefined,
    pollIntervalMs: remote.pollIntervalMs,
    controlPollIntervalMs: remote.pollIntervalMs,
    shouldContinue: () => remoteWorkerRunning,
    now,
    nonceFactory,
  });
  const workerLoop = worker.runLoop().catch(() => undefined);
  return {
    ...input.generation,
    runtime: createRemoteCodexGenerationRuntime({
      controlPlaneClient,
      runtimeProfileId: generationRuntimeProfileId,
      credentialBindingId: generationCredentialBindingId,
      waitTimeoutMs: remote.waitTimeoutMs,
      pollIntervalMs: remote.pollIntervalMs,
    }),
    cleanup: () => {
      remoteWorkerRunning = false;
      void workerLoop;
    },
    appServerDogfood: { status: 'blocked', reasonCode: 'codex_worker_unavailable', runtimeMode: 'remote_outbound' },
  };
};

const createDaemon = (
  baseUrl: string,
  generation: DogfoodGenerationRuntimeConfig,
  client = createAutomationClient(baseUrl),
): AutomationDaemon =>
  new AutomationDaemon({
    client,
    actorId: automationActorId,
    daemonIdentity: automationDaemonIdentity,
    allowedRepoRoots: [repoPath],
    policyParserVersion: 'workflow-md-parser:v1',
    policyLoader: loadDaemonWorkflowPolicyDigest,
    loopIntervalMs: 1,
    noClaimBackoffMs: 1,
    generationPlanning: generation.planning,
    ...(generation.runtime === undefined ? {} : { generationRuntime: generation.runtime }),
  });

const seedDraftOnlyApprovedSpec = async (
  app: INestApplication,
): Promise<{ project: Project; workItem: WorkItem; spec: Spec; specRevisionId: string }> => {
  const server = app.getHttpServer();
  const project = (await request(server).post('/projects').send({ name: 'Automation dogfood', owner_actor_id: actorOwner }).expect(201))
    .body as Project;
  await request(server)
    .post(`/projects/${project.id}/repos`)
    .send({
      repo_id: repoId,
      name: repoId,
      local_path: repoPath,
      default_branch: 'main',
      base_commit_sha: 'automation-dogfood-base',
    })
    .expect(201);
  await request(server)
    .post(`/automation/projects/${project.id}/capabilities`)
    .set(humanAdminHeaders)
    .send({
      repo_id: repoId,
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable deterministic automation daemon dogfood',
      evidence_refs: [],
      actor_context: { actor_id: actorOwner, actor_class: 'human_admin' },
    })
    .expect(201);
  const workItem = (await request(server)
    .post('/work-items')
    .send({
      project_id: project.id,
      kind: 'requirement',
      title: 'Dogfood HTTP automation daemon',
      goal: 'Create draft artifacts through the HTTP automation daemon.',
      success_criteria: ['Plan and package drafts are created without enqueueing a run.'],
      priority: 'P0',
      risk: 'medium',
      driver_actor_id: actorOwner,
      intake_context: requirementIntakeContext,
    })
    .expect(201)).body as WorkItem;
  const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body as Spec;
  const revision = (await request(server).post(`/specs/${spec.id}/generate-draft`).send({}).expect(201)).body as {
    id: string;
  };
  await request(server).post(`/specs/${spec.id}/submit-for-approval`).set(humanAdminHeaders).send({ actor_id: actorOwner }).expect(201);
  const approvedSpec = (await request(server)
    .post(`/specs/${spec.id}/approve`)
    .set(reviewerHeaders)
    .send({ actor_id: actorReviewer })
    .expect(201)).body as Spec;
  return { project, workItem, spec: approvedSpec, specRevisionId: revision.id };
};

const approveCurrentPlan = async (
  app: INestApplication,
  repository: DeliveryRepository,
  workItemId: string,
): Promise<{ plan: Plan; revision: PlanRevision }> => {
  const workItem = await repository.getWorkItem(workItemId);
  if (workItem?.current_plan_id === undefined) {
    throw new Error('automation_dogfood_missing_plan_draft');
  }
  const plan = await repository.getPlan(workItem.current_plan_id);
  if (plan === undefined || plan.current_revision_id === undefined) {
    throw new Error('automation_dogfood_missing_plan_revision');
  }
  const revision = await repository.getPlanRevision(plan.current_revision_id);
  if (revision === undefined) {
    throw new Error('automation_dogfood_missing_plan_revision');
  }

  const server = app.getHttpServer();
  await request(server).post(`/plans/${plan.id}/submit-for-approval`).set(humanAdminHeaders).send({ actor_id: actorOwner }).expect(201);
  const approvedPlan = (await request(server)
    .post(`/plans/${plan.id}/approve`)
    .set(reviewerHeaders)
    .send({ actor_id: actorReviewer })
    .expect(201)).body as Plan;
  return { plan: approvedPlan, revision };
};

const runUntil = async (daemon: AutomationDaemon, predicate: () => Promise<boolean>, label: string): Promise<void> => {
  for (let index = 0; index < 6; index += 1) {
    if (await predicate()) {
      return;
    }
    await daemon.runOnce();
  }
  if (await predicate()) {
    return;
  }
  throw new Error(`automation_dogfood_condition_not_met:${label}`);
};

const drainDaemon = async (daemon: AutomationDaemon, label: string): Promise<void> => {
  for (let index = 0; index < 6; index += 1) {
    const result = await daemon.runOnce();
    if (result.plannedActionCount === 0 && result.executed.reasonCode === 'no_claimable_action') {
      return;
    }
  }
  throw new Error(`automation_dogfood_condition_not_met:${label}`);
};

class RestartBeforeClaimClient extends AutomationHttpClient {
  readonly createOrReplayActions: NextAction[] = [];

  override async createOrReplayAction(action: NextAction): Promise<AutomationActionResponse> {
    this.createOrReplayActions.push(action);
    return super.createOrReplayAction(action);
  }

  override async claimNextAction(_input: ClaimNextActionInput): Promise<AutomationActionResponse> {
    throw new Error('automation_dogfood_simulated_restart_before_claim');
  }
}

const sortedActionTypes = (runs: { action_type: string }[]): string[] => runs.map((actionRun) => actionRun.action_type).sort();

const publicDogfoodErrorCodes = new Set([
  'codex_generation_disabled',
  'codex_generation_safety_unavailable',
  'codex_generation_sandbox_invalid',
  'codex_app_server_unavailable',
  'codex_generation_timeout',
  'codex_generation_cancelled',
  'codex_generation_concurrency_limit_exceeded',
  'codex_generation_raw_log_too_large',
  'codex_generation_turn_failed',
  'generated_output_invalid_json',
  'generated_output_ambiguous',
  'generated_output_schema_invalid',
  'generated_output_too_large',
  'generated_package_dependency_invalid',
  'generated_package_manifest_invalid',
  'generated_package_policy_invalid',
  'generated_spec_draft_invalid',
  'generated_plan_draft_invalid',
  'generated_payload_idempotency_drift',
]);

const publicDogfoodErrorCode = (code: string | undefined): string | undefined => {
  if (code === undefined) {
    return undefined;
  }
  const publicCode = code.split(':', 1)[0]?.trim();
  return publicCode !== undefined && publicDogfoodErrorCodes.has(publicCode) ? publicCode : undefined;
};

const publicReasonForActionRun = (actionRun: AutomationActionRun): string | undefined => {
  const resultCode = actionRun.result_json?.code;
  return (
    publicDogfoodErrorCode(actionRun.error_code) ??
    publicDogfoodErrorCode(actionRun.reason) ??
    (typeof resultCode === 'string' ? publicDogfoodErrorCode(resultCode) : undefined)
  );
};

const appServerDogfoodStatusForActionRuns = (
  actionRuns: AutomationActionRun[],
  fallbackReasonCode: string,
): AutomationDogfoodSummaryInput['appServerDogfood'] => {
  const blocked = actionRuns.find((actionRun) => actionRun.status === 'blocked');
  if (blocked !== undefined) {
    return { status: 'blocked', reasonCode: publicReasonForActionRun(blocked) ?? fallbackReasonCode };
  }
  const failed = actionRuns.find((actionRun) => actionRun.status === 'failed');
  if (failed !== undefined) {
    return { status: 'failed', reasonCode: publicReasonForActionRun(failed) ?? fallbackReasonCode };
  }
  return { status: 'failed', reasonCode: fallbackReasonCode };
};

const summaryFromRepository = async (input: {
  repository: DeliveryRepository;
  workItemId?: string;
  restartRecoveredFromActionRuns: boolean;
  appServerDogfood: AutomationDogfoodSummaryInput['appServerDogfood'];
}): Promise<AutomationDogfoodSummaryInput> => {
  const packages = input.workItemId === undefined ? [] : await input.repository.listExecutionPackagesForWorkItem(input.workItemId);
  const runSessions = (await Promise.all(packages.map((item) => input.repository.listRunSessionsForPackage(item.id)))).flat();
  const actionRuns = (await input.repository.getRuntimeSnapshotData()).recent_action_runs;
  const completedActionTypes = actionRuns
    .filter((actionRun) => actionRun.status === 'succeeded')
    .map((actionRun) => actionRun.action_type);
  return {
    planDraftCreated:
      input.workItemId === undefined ? false : (await input.repository.getWorkItem(input.workItemId))?.current_plan_id !== undefined,
    packageDraftCount: packages.length,
    completedActionTypes,
    actionRunCount: actionRuns.length,
    nonSucceededActionRunCount: actionRuns.filter((actionRun) => actionRun.status !== 'succeeded').length,
    runSessionCount: runSessions.length,
    restartRecoveredFromActionRuns: input.restartRecoveredFromActionRuns,
    appServerDogfood: input.appServerDogfood,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const actionRunGenerationArtifacts = (actionRun: AutomationActionRun): Array<Record<string, unknown>> => {
  const result = actionRun.result_json;
  if (!isRecord(result)) {
    return [];
  }
  const artifacts = result.generation_artifacts;
  return Array.isArray(artifacts) ? artifacts.filter(isRecord) : [];
};

const observedArtifactsFromActionRuns = (
  actionRuns: AutomationActionRun[],
): NonNullable<AutomationDogfoodSummaryInput['appServerDogfood']['artifacts']> => {
  const artifacts = new Map<string, { name: string; digest: string }>();
  for (const artifact of actionRuns.flatMap(actionRunGenerationArtifacts)) {
    if (typeof artifact.name !== 'string' || typeof artifact.digest !== 'string') {
      continue;
    }
    artifacts.set(`${artifact.name}:${artifact.digest}`, { name: artifact.name, digest: artifact.digest });
  }
  return [...artifacts.values()];
};

const runtimeJobIdFromArtifact = (artifact: Record<string, unknown>): string | undefined => {
  if (typeof artifact.storage_uri !== 'string') {
    return undefined;
  }
  const match = /^artifact:\/\/codex-runtime-jobs\/([^/]+)\/artifacts\/[^/]+$/.exec(artifact.storage_uri);
  return match?.[1];
};

const runtimeJobIdsFromActionRuns = (actionRuns: AutomationActionRun[]): string[] => [
  ...new Set(actionRuns.flatMap((actionRun) => actionRunGenerationArtifacts(actionRun).flatMap((artifact) => runtimeJobIdFromArtifact(artifact) ?? []))),
];

const generationActionRunTypes = new Set(['ensure_spec_draft', 'ensure_plan_draft', 'ensure_package_drafts']);

const runtimeJobIdsForActionRun = (actionRun: AutomationActionRun): string[] => [
  ...new Set(actionRunGenerationArtifacts(actionRun).flatMap((artifact) => runtimeJobIdFromArtifact(artifact) ?? [])),
];

const isoTimeMs = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
};

const durationMs = (start: string | undefined, finish: string | undefined): number | undefined => {
  const startMs = isoTimeMs(start);
  const finishMs = isoTimeMs(finish);
  if (startMs === undefined || finishMs === undefined || finishMs < startMs) {
    return undefined;
  }
  return finishMs - startMs;
};

const durationBucket = (duration: number | undefined): string | undefined => {
  if (duration === undefined) {
    return undefined;
  }
  if (duration < 5_000) {
    return '<5s';
  }
  if (duration < 60_000) {
    return '<60s';
  }
  if (duration < 5 * 60_000) {
    return '<5m';
  }
  return '>5m';
};

const maxObservedDuration = (durations: Array<number | undefined>): number | undefined => {
  const observed = durations.filter((value): value is number => value !== undefined);
  return observed.length === 0 ? undefined : Math.max(...observed);
};

const timingBucketsFromActionRuns = (
  actionRuns: AutomationActionRun[],
): AutomationDogfoodSummaryInput['appServerDogfood']['timingBuckets'] => ({
  queue: durationBucket(maxObservedDuration(actionRuns.map((actionRun) => durationMs(actionRun.created_at, actionRun.started_at)))),
  execution: durationBucket(maxObservedDuration(actionRuns.map((actionRun) => durationMs(actionRun.started_at, actionRun.finished_at)))),
  terminalization: durationBucket(maxObservedDuration(actionRuns.map((actionRun) => durationMs(actionRun.finished_at, actionRun.updated_at)))),
});

const timingBucketsFromRuntimeJobs = (
  jobs: Array<Awaited<ReturnType<DeliveryRepository['getCodexRuntimeJob']>>>,
): AutomationDogfoodSummaryInput['appServerDogfood']['timingBuckets'] => {
  const observedJobs = jobs.filter((job): job is NonNullable<typeof job> => job !== undefined);
  return {
    queue: durationBucket(maxObservedDuration(observedJobs.map((job) => durationMs(job.created_at, job.started_at)))),
    execution: durationBucket(maxObservedDuration(observedJobs.map((job) => durationMs(job.started_at, job.terminal_at)))),
    terminalization: durationBucket(maxObservedDuration(observedJobs.map((job) => durationMs(job.terminal_at, job.updated_at)))),
  };
};

const runtimeEvidenceFromJob = (
  job: Awaited<ReturnType<DeliveryRepository['getCodexRuntimeJob']>>,
): ReturnType<typeof validateCodexDockerRuntimeEvidence> | undefined => {
  const terminalResult = job?.terminal_result_json;
  if (!isRecord(terminalResult) || terminalResult.runtime_evidence === undefined) {
    return undefined;
  }
  try {
    const evidence = validateCodexDockerRuntimeEvidence(terminalResult.runtime_evidence);
    if (
      job.runtime_evidence_digest === undefined ||
      codexCanonicalDigest(terminalResult.runtime_evidence) !== job.runtime_evidence_digest
    ) {
      return undefined;
    }
    return evidence;
  } catch {
    return undefined;
  }
};

const appServerDogfoodFromObservedEvidence = (input: {
  runtimeMode: 'local_docker' | 'remote_outbound';
  evidence?: ReturnType<typeof validateCodexDockerRuntimeEvidence>;
  artifacts: NonNullable<AutomationDogfoodSummaryInput['appServerDogfood']['artifacts']>;
  timingBuckets: AutomationDogfoodSummaryInput['appServerDogfood']['timingBuckets'];
}): AutomationDogfoodSummaryInput['appServerDogfood'] => {
  const evidence = input.evidence;
  if (evidence === undefined) {
    return { status: 'failed', reasonCode: 'codex_docker_runtime_evidence_unsafe', runtimeMode: input.runtimeMode };
  }
  const observed: AutomationDogfoodSummaryInput['appServerDogfood'] = {
    status: 'passed',
    runtimeMode: input.runtimeMode,
    dockerizedAppServerEvidence: {
      dockerImageDigest: evidence.docker_image_digest,
      ...(evidence.network_policy_digest === undefined ? {} : { networkPolicyDigest: evidence.network_policy_digest }),
      effectiveConfigDigest: evidence.app_server_effective_config_digest,
      containerIdDigest: evidence.container_id_digest,
    },
    artifacts: input.artifacts,
    timingBuckets: input.timingBuckets,
  };
  if (
    evidence.network_policy_digest === undefined ||
    input.artifacts.length === 0 ||
    input.timingBuckets?.queue === undefined ||
    input.timingBuckets.execution === undefined ||
    input.timingBuckets.terminalization === undefined
  ) {
    return { ...observed, status: 'failed', reasonCode: 'codex_docker_runtime_evidence_unsafe' };
  }
  return observed;
};

const observedAppServerDogfood = async (input: {
  generation: DogfoodGenerationRuntimeConfig;
  repository: DeliveryRepository;
  actionRuns: AutomationActionRun[];
}): Promise<AutomationDogfoodSummaryInput['appServerDogfood']> => {
  const succeededActionRuns = input.actionRuns.filter((actionRun) => actionRun.status === 'succeeded');
  if (input.generation.remoteOutboundRequested !== undefined) {
    const succeededGenerationActionRuns = succeededActionRuns.filter((actionRun) => generationActionRunTypes.has(actionRun.action_type));
    const hasRuntimeJobForEveryGenerationAction = succeededGenerationActionRuns.every(
      (actionRun) => runtimeJobIdsForActionRun(actionRun).length > 0,
    );
    const runtimeJobIds = runtimeJobIdsFromActionRuns(succeededGenerationActionRuns);
    const runtimeJobs = await Promise.all(
      runtimeJobIds.map((runtimeJobId) => input.repository.getCodexRuntimeJob({ runtime_job_id: runtimeJobId })),
    );
    const runtimeEvidences = runtimeJobs.map(runtimeEvidenceFromJob);
    const hasEvidenceForEveryJob =
      hasRuntimeJobForEveryGenerationAction &&
      runtimeJobIds.length > 0 &&
      runtimeJobs.length === runtimeJobIds.length &&
      runtimeEvidences.every((evidence) => evidence !== undefined);
    return appServerDogfoodFromObservedEvidence({
      runtimeMode: 'remote_outbound',
      evidence: hasEvidenceForEveryJob ? runtimeEvidences[0] : undefined,
      artifacts: observedArtifactsFromActionRuns(succeededActionRuns),
      timingBuckets: timingBucketsFromRuntimeJobs(runtimeJobs),
    });
  }
  if (input.generation.localDockerRequested === true) {
    return appServerDogfoodFromObservedEvidence({
      runtimeMode: 'local_docker',
      evidence: input.generation.observedDockerRuntimeEvidence?.[0],
      artifacts: observedArtifactsFromActionRuns(succeededActionRuns),
      timingBuckets: timingBucketsFromActionRuns(succeededActionRuns),
    });
  }
  return input.generation.appServerDogfood;
};

const errorReasonCode = (error: unknown): string => {
  if (error instanceof Error && error.message.length > 0) {
    return publicDogfoodErrorCode(error.message) ?? 'automation_dogfood_failed';
  }
  return 'automation_dogfood_failed';
};

const resultWithExitCode = (summary: AutomationDogfoodSummaryInput): AutomationDogfoodResult => ({
  ...summary,
  exitCode: automationDogfoodExitCode(summary),
});

const runDogfood = async (): Promise<AutomationDogfoodResult> => {
  let generation = loadDogfoodGenerationRuntimeConfig();
  if (generation.runtime === undefined && generation.localDockerRequested !== true && generation.remoteOutboundRequested === undefined) {
    return resultWithExitCode({
      planDraftCreated: false,
      packageDraftCount: 0,
      completedActionTypes: [],
      actionRunCount: 0,
      nonSucceededActionRunCount: 0,
      runSessionCount: 0,
      restartRecoveredFromActionRuns: false,
      appServerDogfood: generation.appServerDogfood,
    });
  }

  const previousSecret = process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET;
  process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET = automationSecret;
  let app: INestApplication | undefined;
  let repository: DeliveryRepository | undefined;
  let seeded: { project: Project; workItem: WorkItem } | undefined;
  let restartRecoveredFromActionRuns = false;
  try {
    const booted = await bootControlPlane();
    app = booted.app;
    repository = booted.repository;
    const { baseUrl } = booted;
    seeded = await seedDraftOnlyApprovedSpec(app);
    if (generation.localDockerRequested === true) {
      generation = await createDogfoodLocalDockerGenerationRuntime({
        baseUrl,
        project: seeded.project,
        generation,
      });
    }
    if (generation.remoteOutboundRequested !== undefined) {
      generation = await createDogfoodRemoteOutboundGenerationRuntime({ baseUrl, project: seeded.project, generation });
    }
    if (generation.runtime === undefined) {
      return resultWithExitCode({
        planDraftCreated: false,
        packageDraftCount: 0,
        completedActionTypes: [],
        actionRunCount: 0,
        nonSucceededActionRunCount: 0,
        runSessionCount: 0,
        restartRecoveredFromActionRuns: false,
        appServerDogfood: generation.appServerDogfood,
      });
    }
    const interruptedClient = new RestartBeforeClaimClient({
      baseUrl,
      actorId: automationActorId,
      daemonIdentity: automationDaemonIdentity,
      secret: automationSecret,
    });

    try {
      await createDaemon(baseUrl, generation, interruptedClient).runOnce();
      throw new Error('automation_dogfood_expected_restart_before_claim');
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'automation_dogfood_simulated_restart_before_claim') {
        throw error;
      }
    }

    const pendingBeforeRestart = (await repository.getRuntimeSnapshotData()).recent_action_runs.filter(
      (actionRun) => actionRun.status === 'pending',
    );
    const pendingBeforeRestartIds = new Set(pendingBeforeRestart.map((actionRun) => actionRun.id));
    const pendingBeforeRestartKeys = new Set(pendingBeforeRestart.map((actionRun) => actionRun.idempotency_key));
    const pendingBeforeRestartActionTypes = sortedActionTypes(pendingBeforeRestart);
    const daemon = createDaemon(baseUrl, generation);

    await runUntil(
      daemon,
      async () => (await repository.getWorkItem(seeded.workItem.id))?.current_plan_id !== undefined,
      'plan_draft_created',
    );
    await approveCurrentPlan(app, repository, seeded.workItem.id);
    await runUntil(
      daemon,
      async () => (await repository.listExecutionPackagesForWorkItem(seeded.workItem.id)).length > 0,
      'package_drafts_created',
    );
    await drainDaemon(daemon, 'daemon_drained');

    const packages = await repository.listExecutionPackagesForWorkItem(seeded.workItem.id);
    const runSessions = (await Promise.all(packages.map((item) => repository.listRunSessionsForPackage(item.id)))).flat();
    const actionRuns = (await repository.getRuntimeSnapshotData()).recent_action_runs;
    const completedActionTypes = actionRuns
      .filter((actionRun) => actionRun.status === 'succeeded')
      .map((actionRun) => actionRun.action_type);
    const recoveredPendingRuns = actionRuns.filter((actionRun) => pendingBeforeRestartIds.has(actionRun.id));
    const pendingKeyOccurrences = actionRuns.filter((actionRun) => pendingBeforeRestartKeys.has(actionRun.idempotency_key));
    restartRecoveredFromActionRuns =
      pendingBeforeRestart.length > 0 &&
      pendingBeforeRestart.length === expectedPendingBeforeRestartActionTypes.length &&
      pendingBeforeRestartActionTypes.every((actionType, index) => actionType === expectedPendingBeforeRestartActionTypes[index]) &&
      interruptedClient.createOrReplayActions.length === pendingBeforeRestart.length &&
      pendingBeforeRestartIds.size === pendingBeforeRestart.length &&
      pendingBeforeRestartKeys.size === pendingBeforeRestart.length &&
      recoveredPendingRuns.length === pendingBeforeRestart.length &&
      recoveredPendingRuns.every((actionRun) => actionRun.status === 'succeeded') &&
      pendingKeyOccurrences.length === pendingBeforeRestart.length;
    const summary: AutomationDogfoodSummaryInput = {
      planDraftCreated: (await repository.getWorkItem(seeded.workItem.id))?.current_plan_id !== undefined,
      packageDraftCount: packages.length,
      completedActionTypes,
      actionRunCount: actionRuns.length,
      nonSucceededActionRunCount: actionRuns.filter((actionRun) => actionRun.status !== 'succeeded').length,
      runSessionCount: runSessions.length,
      restartRecoveredFromActionRuns,
      appServerDogfood: await observedAppServerDogfood({ generation, repository, actionRuns }),
    };
    return resultWithExitCode(summary);
  } catch (error) {
    if (generation.planning.mode === 'app_server' && repository !== undefined) {
      const actionRuns = (await repository.getRuntimeSnapshotData()).recent_action_runs;
      const summary = await summaryFromRepository({
        repository,
        workItemId: seeded?.workItem.id,
        restartRecoveredFromActionRuns,
        appServerDogfood: appServerDogfoodStatusForActionRuns(actionRuns, errorReasonCode(error)),
      });
      return resultWithExitCode(summary);
    }
    throw error;
  } finally {
    generation.cleanup?.();
    if (app !== undefined) {
      await app.close();
    }
    if (previousSecret === undefined) {
      delete process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET;
    } else {
      process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET = previousSecret;
    }
  }
};

export const main = async (): Promise<number> => {
  const result = await runDogfood();
  console.log(renderAutomationDogfoodSummary(result));
  return result.exitCode;
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
