import 'reflect-metadata';

import { fileURLToPath } from 'node:url';
import { isAbsolute, resolve } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AutomationDaemon } from '../apps/automation-daemon/src/automation-daemon';
import { loadDaemonWorkflowPolicyDigest } from '../apps/automation-daemon/src/workflow-policy-loader';
import {
  AutomationHttpClient,
  type AutomationGenerationPlanningConfig,
  type AutomationActionResponse,
  type ClaimNextActionInput,
  type NextAction,
} from '../packages/automation/src/index';
import {
  createCodexGenerationRuntime,
  parseCodexAppServerEndpoint,
  type CodexGenerationRuntime,
} from '../packages/codex-runtime/src/index';
import { InMemoryDeliveryRepository, type DeliveryRepository } from '../packages/db/src/index';
import type { AutomationActionRun, Plan, PlanRevision, Project, Spec, WorkItem } from '../packages/domain/src/index';
import {
  automationDogfoodExitCode,
  renderAutomationDogfoodSummary,
  type AutomationDogfoodSummaryInput,
} from './automation-dogfood-summary';

interface AutomationDogfoodResult extends AutomationDogfoodSummaryInput {
  exitCode: number;
}

type EnvLike = Record<string, string | undefined>;

export interface DogfoodGenerationRuntimeConfig {
  planning: AutomationGenerationPlanningConfig;
  runtime?: CodexGenerationRuntime;
  appServerDogfood: AutomationDogfoodSummaryInput['appServerDogfood'];
}

const automationSecret = process.env.FORGELOOP_AUTOMATION_DOGFOOD_SECRET ?? 'automation-dogfood-secret';
const automationActorId = process.env.FORGELOOP_AUTOMATION_ACTOR_ID ?? 'automation-dogfood-actor';
const automationDaemonIdentity = process.env.FORGELOOP_AUTOMATION_DAEMON_IDENTITY ?? 'automation-dogfood-daemon';
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

const optionalPositiveIntEnv = (env: EnvLike, key: string): number | undefined => {
  const raw = optionalNonBlankEnv(env, key);
  if (raw === undefined) {
    return undefined;
  }
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

const preflightSkippedGeneration = (reasonCode: string): DogfoodGenerationRuntimeConfig => ({
  planning: createDogfoodGenerationPlanning('app_server'),
  appServerDogfood: { status: 'skipped', reasonCode },
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
    const endpoint = optionalNonBlankEnv(env, 'FORGELOOP_CODEX_APP_SERVER_ENDPOINT');
    if (endpoint === undefined) {
      return preflightSkippedGeneration('app_server_endpoint_missing');
    }
    try {
      parseCodexAppServerEndpoint(endpoint);
    } catch {
      return preflightSkippedGeneration('app_server_endpoint_invalid');
    }
    const artifactRoot = optionalNonBlankEnv(env, 'FORGELOOP_CODEX_GENERATION_ARTIFACT_ROOT');
    if (artifactRoot === undefined) {
      return preflightSkippedGeneration('app_server_artifact_root_missing');
    }
    if (!isAbsolute(artifactRoot)) {
      return preflightSkippedGeneration('app_server_artifact_root_invalid');
    }
    const timeoutMs = optionalPositiveIntEnv(env, 'FORGELOOP_CODEX_GENERATION_TURN_TIMEOUT_MS');
    const outputLimitBytes = optionalPositiveIntEnv(env, 'FORGELOOP_CODEX_GENERATION_OUTPUT_LIMIT_BYTES');
    const rawNotificationLimitBytes = optionalPositiveIntEnv(env, 'FORGELOOP_CODEX_GENERATION_RAW_NOTIFICATION_LIMIT_BYTES');
    const maxConcurrency = optionalPositiveIntEnv(env, 'FORGELOOP_CODEX_GENERATION_MAX_CONCURRENCY');
    return {
      planning: createDogfoodGenerationPlanning('app_server'),
      runtime: createCodexGenerationRuntime({
        mode: 'app_server',
        appServerEndpoint: endpoint,
        artifactRoot,
        workspaceRoot: repoPath,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        ...(outputLimitBytes === undefined ? {} : { outputLimitBytes }),
        ...(rawNotificationLimitBytes === undefined ? {} : { rawNotificationLimitBytes }),
        ...(maxConcurrency === undefined ? {} : { maxConcurrency }),
      }),
      appServerDogfood: { status: 'passed' },
    };
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
      owner_actor_id: actorOwner,
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
  return publicDogfoodErrorCodes.has(code) ? code : undefined;
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
  const generation = loadDogfoodGenerationRuntimeConfig();
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

  const previousSecret = process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET;
  process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET = automationSecret;
  let app: INestApplication | undefined;
  let repository: DeliveryRepository | undefined;
  let seeded: { workItem: WorkItem } | undefined;
  let restartRecoveredFromActionRuns = false;
  try {
    const booted = await bootControlPlane();
    app = booted.app;
    repository = booted.repository;
    const { baseUrl } = booted;
    seeded = await seedDraftOnlyApprovedSpec(app);
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
      appServerDogfood: generation.appServerDogfood.status === 'passed' ? { status: 'passed' } : generation.appServerDogfood,
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
