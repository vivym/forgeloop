import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Module } from '@nestjs/common';
import {
  CliDockerRunner,
  createLeasedRunSessionCodexDriver,
  createLocalCodexWorkerRuntime,
  DockerizedCodexAppServerLauncher,
  normalizeMaterializationResponse,
} from '@forgeloop/codex-worker-runtime';
import { CodexAppServerEndpointTransport, effectiveConfigFromResponse, type CodexAppServerTransport } from '@forgeloop/codex-runtime';
import type { ExecutorResult, SelfReviewInput, SelfReviewResult } from '@forgeloop/contracts';
import type { DeliveryRepository } from '@forgeloop/db';
import type { CodexRuntimeScope, CodexRuntimeTargetKind, RunRuntimeMetadata, RunSession } from '@forgeloop/domain';
import {
  captureLocalCodexEvidence,
  CodexExecFallbackDriver,
  createLocalCodexRuntimeSafety,
  LocalCodexRawLogStore,
  parseExecutorRuntimeSafetyConfigFromEnv,
  type CodexDriverStartInput,
  type CodexDriverStreamItem,
  type CodexSessionDriver,
  type LocalCodexEvidenceInput,
  type LocalCodexRuntimeSafety,
} from '@forgeloop/executor';
import { FakeCodexSessionDriver, RunWorker } from '@forgeloop/run-worker';

import { AuditModule } from '../audit/audit.module';
import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import { CodexRuntimeModule } from '../codex-runtime/codex-runtime.module';
import { CodexRuntimeService } from '../codex-runtime/codex-runtime.service';
import { ExecutionPackagesModule } from '../execution-packages/execution-packages.module';
import { ReviewEvidenceModule } from '../review-evidence/review-evidence.module';
import { ExecutionPackageRunsController } from './execution-package-runs.controller';
import { RunControlService } from './run-control.service';
import { RunSessionsController } from './run-sessions.controller';
import { RunWorkerLifecycleService } from './run-worker-lifecycle.service';
import { DELIVERY_RUN_WORKER } from './run-worker.token';

const safePathSegment = (value: string): string => {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.\.+/g, '-')
    .replace(/^\.+/, '')
    .replace(/^-+|-+$/g, '');

  return sanitized.length > 0 ? sanitized : 'artifact';
};

const evidenceChangedFilePath = (allowedPaths: string[]): string => {
  const firstAllowedPath = allowedPaths[0] ?? 'forgeloop-generated.txt';
  return firstAllowedPath.replace(/\/\*\*$/, '/forgeloop-generated.txt').replace(/\*+$/, 'forgeloop-generated.txt');
};

const mockSelfReview = (input: SelfReviewInput): SelfReviewResult => ({
  status: 'succeeded',
  summary: `Mock self-review completed for run ${input.run_session_id}.`,
  spec_plan_alignment: 'The mock run uses the approved spec and plan revision ids.',
  test_assessment: `${input.check_results.length} required checks were reported.`,
  risk_notes: [],
  follow_up_questions: [],
});

const mockEvidence = (input: LocalCodexEvidenceInput): ExecutorResult => ({
  run_session_id: input.runSpec.run_session_id,
  executor_type: input.runSpec.executor_type,
  executor_version: 'control-plane-fake-driver',
  status: 'succeeded',
  started_at: input.startedAt,
  finished_at: new Date().toISOString(),
  summary: input.summary,
  changed_files: [
    {
      repo_id: input.runSpec.repo.repo_id,
      path: evidenceChangedFilePath(input.runSpec.allowed_paths),
      change_kind: 'modified',
    },
  ],
  checks: input.runSpec.required_checks.map((check) => ({
    check_id: check.check_id,
    command: check.command,
    status: 'succeeded',
    exit_code: 0,
    duration_seconds: 0,
    blocks_review: check.blocks_review,
  })),
  artifacts: [...new Set(input.runSpec.artifact_policy.requested_artifacts)].map((kind) => ({
    kind,
    name: `${kind}.txt`,
    content_type: 'text/plain',
    local_ref: join(input.artifactRoot, safePathSegment(input.runSpec.run_session_id), `${kind}.txt`),
  })),
  raw_metadata: { workflow_only: input.runSpec.workflow_only },
});

const optionalEnv = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

const requiredEnv = (key: string): string => {
  const value = optionalEnv(key);
  if (value === undefined) {
    throw new Error(`Missing required Codex runtime config: ${key}`);
  }
  return value;
};

const positiveIntEnv = (key: string, fallback?: number): number => {
  const raw = optionalEnv(key);
  if (raw === undefined) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`Missing required Codex runtime config: ${key}`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid Codex runtime config: ${key} must be a positive integer`);
  }
  return value;
};

const nonNegativeIntEnv = (key: string, fallback: number): number => {
  const raw = optionalEnv(key);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid Codex runtime config: ${key} must be a non-negative integer`);
  }
  return value;
};

const stringListEnv = (key: string, fallback: string[] = []): string[] => {
  const raw = optionalEnv(key);
  if (raw === undefined) {
    return fallback;
  }
  return raw
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const runtimeScopesEnv = (): CodexRuntimeScope[] => {
  const raw = optionalEnv('FORGELOOP_CODEX_WORKER_SCOPES_JSON');
  if (raw !== undefined) {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Invalid Codex runtime config: FORGELOOP_CODEX_WORKER_SCOPES_JSON must be an array');
    }
    return parsed.map((entry) => entry as CodexRuntimeScope);
  }
  const projectId = requiredEnv('FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID');
  const repoId = optionalEnv('FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID');
  return [{ project_id: projectId, ...(repoId === undefined ? {} : { repo_id: repoId }) }];
};

const workerCapabilitiesEnv = (fallback: CodexRuntimeTargetKind[]): CodexRuntimeTargetKind[] => {
  const values = stringListEnv('FORGELOOP_CODEX_WORKER_CAPABILITIES', fallback);
  return values.map((value) => {
    if (value !== 'generation' && value !== 'run_execution') {
      throw new Error('Invalid Codex runtime config: FORGELOOP_CODEX_WORKER_CAPABILITIES');
    }
    return value;
  });
};

const firstDigestList = (primaryKey: string, listKey: string): string[] => {
  const primary = optionalEnv(primaryKey);
  if (primary !== undefined) {
    return [primary];
  }
  const values = stringListEnv(listKey);
  if (values.length === 0) {
    throw new Error(`Missing required Codex runtime config: ${primaryKey}`);
  }
  return values;
};

const codexRunWorkerMode = (): 'disabled' | 'local_docker' => {
  const raw = optionalEnv('FORGELOOP_CODEX_RUN_WORKER_MODE') ?? optionalEnv('FORGELOOP_CODEX_WORKER_MODE') ?? 'disabled';
  if (raw === 'disabled' || raw === 'local_docker') {
    return raw;
  }
  throw new Error('Invalid Codex runtime config: FORGELOOP_CODEX_RUN_WORKER_MODE must be disabled or local_docker');
};

const expiresFromNow = (ms: number): string => new Date(Date.now() + ms).toISOString();

const probeCodexEffectiveConfig = async (
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

class AppServerGovernorUnavailableDriver implements CodexSessionDriver {
  readonly kind = 'app_server' as const;

  async *startRun(): AsyncIterable<CodexDriverStreamItem> {
    yield this.fallbackEvent('Codex app-server direct process transport is disabled until it can run under the runtime governor.');
  }

  async *resumeRun(): AsyncIterable<CodexDriverStreamItem> {
    yield this.fallbackEvent('Codex app-server resume is disabled until it can run under the runtime governor.');
  }

  async sendInput(): Promise<Record<string, unknown>> {
    return { acknowledged: false, reason: 'app_server_governor_unavailable' };
  }

  async cancelRun(): Promise<Record<string, unknown>> {
    return { acknowledged: false, reason: 'app_server_governor_unavailable' };
  }

  private fallbackEvent(summary: string): CodexDriverStreamItem {
    return {
      kind: 'event',
      event: {
        event_type: 'driver_fallback_used',
        source: 'executor',
        visibility: 'public',
        summary,
        payload: { reason: 'primary_executor_governor_unavailable' },
      },
      runtimeMetadata: {
        driver_kind: 'exec_fallback',
        driver_status: 'starting',
      },
    };
  }
}

const runtimeSafetyForRun = async (
  repository: DeliveryRepository,
  input: {
    runSpec: CodexDriverStartInput['runSpec'];
    workspacePath: string;
    artifactRoot: string;
  },
): Promise<LocalCodexRuntimeSafety> => {
  const runSpec = input.runSpec;
  const executionPackage = await repository.getExecutionPackage(runSpec.execution_package_id);
  if (executionPackage?.package_policy_snapshot === undefined) {
    throw new Error('policy_snapshot_missing: local_codex requires a captured package policy snapshot.');
  }
  const parseResult = parseExecutorRuntimeSafetyConfigFromEnv(process.env, {
    workspaceRoot: input.workspacePath,
    tempRoot: tmpdir(),
    packageControlledPaths: [runSpec.repo.local_path],
  });
  if (parseResult.status !== 'available') {
    const details =
      parseResult.status === 'unavailable'
        ? parseResult.missing_keys.join(',')
        : parseResult.diagnostics.map((diagnostic) => diagnostic.message).join('; ');
    throw new Error(`${parseResult.reason_code}: ${details}`);
  }
  return createLocalCodexRuntimeSafety({
    runSpec,
    runtimeConfig: parseResult.config,
    frozenSnapshot: executionPackage.package_policy_snapshot,
    workspaceRoot: input.workspacePath,
    artifactRoot: join(input.artifactRoot, safePathSegment(runSpec.run_session_id)),
  });
};

class GovernedCodexDriver implements CodexSessionDriver {
  readonly kind: 'app_server' | 'exec_fallback';
  #inner: CodexSessionDriver | undefined;

  constructor(
    private readonly input: {
      kind: 'app_server' | 'exec_fallback';
      repository: DeliveryRepository;
	      runSession: RunSession;
	      rawLogStore: LocalCodexRawLogStore;
	      artifactRoot: string;
	      workerId: string;
	      leasedDriverFactory?: (input: CodexDriverStartInput, runtimeSafety: LocalCodexRuntimeSafety) => CodexSessionDriver;
	    },
  ) {
    this.kind = input.kind;
  }

  async *startRun(input: CodexDriverStartInput): AsyncIterable<CodexDriverStreamItem> {
    const driver = await this.innerDriver(input);
    yield* driver.startRun(input);
  }

  async *resumeRun(input: CodexDriverStartInput): AsyncIterable<CodexDriverStreamItem> {
    const driver = await this.innerDriver(input);
    yield* driver.resumeRun(input);
  }

  async sendInput(input: {
    message: string;
    runtimeMetadata: RunRuntimeMetadata;
    targetTurnId?: string;
  }): Promise<Record<string, unknown>> {
    if (this.#inner === undefined) {
      throw new Error('Cannot send input before the governed Codex driver has started.');
    }
    return this.#inner.sendInput(input);
  }

  async cancelRun(input: { runtimeMetadata: RunRuntimeMetadata }): Promise<Record<string, unknown>> {
    if (this.#inner === undefined) {
      return { acknowledged: false, reason: 'driver_not_started' };
    }
    return this.#inner.cancelRun(input);
  }

  async close(): Promise<void> {
    await this.#inner?.close?.();
  }

  private async innerDriver(input: CodexDriverStartInput): Promise<CodexSessionDriver> {
    if (this.#inner !== undefined) {
      return this.#inner;
    }
    const runtimeSafety = await runtimeSafetyForRun(this.input.repository, {
      runSpec: input.runSpec,
      workspacePath: input.workspacePath,
      artifactRoot: this.input.artifactRoot,
    });
	    this.#inner =
	      this.kind === 'app_server'
	        ? (this.input.leasedDriverFactory?.(input, runtimeSafety) ?? new AppServerGovernorUnavailableDriver())
	        : new CodexExecFallbackDriver({ runtimeSafety });
    return this.#inner;
  }
}

const createLocalDockerLeasedDriverFactory = (input: {
  repository: DeliveryRepository;
  codexRuntimeService: CodexRuntimeService;
  artifactRoot: string;
  rawLogStore: LocalCodexRawLogStore;
  runWorkerId: string;
}): ((factoryInput: {
  runSession: RunSession;
  runtimeMetadata: RunRuntimeMetadata;
  workerLease: { workerId: string; runSessionId: string; leaseId?: string; leaseToken: string };
}) => CodexSessionDriver) | undefined => {
  if (codexRunWorkerMode() !== 'local_docker') {
    return undefined;
  }

  const dockerBin = optionalEnv('FORGELOOP_DOCKER_BIN') ?? 'docker';
  const dockerRunner = new CliDockerRunner(dockerBin);
  const workerId = optionalEnv('FORGELOOP_CODEX_WORKER_ID') ?? `${input.runWorkerId}-codex`;
  const workerIdentity = optionalEnv('FORGELOOP_WORKER_IDENTITY') ?? workerId;
  const workerTempRoot = requiredEnv('FORGELOOP_WORKER_TEMP_ROOT');
  const bootstrapToken = requiredEnv('FORGELOOP_WORKER_BOOTSTRAP_TOKEN');
  const bootstrapTokenVersion = positiveIntEnv('FORGELOOP_WORKER_BOOTSTRAP_TOKEN_VERSION');
  const hostUid = nonNegativeIntEnv('FORGELOOP_WORKER_HOST_UID', process.getuid?.() ?? 0);
  const hostGid = nonNegativeIntEnv('FORGELOOP_WORKER_HOST_GID', process.getgid?.() ?? 0);
  const dockerImageDigests = firstDigestList('FORGELOOP_CODEX_DOCKER_IMAGE_DIGEST', 'FORGELOOP_CODEX_WORKER_DOCKER_IMAGE_DIGESTS');
  const networkPolicyDigests = firstDigestList('FORGELOOP_CODEX_NETWORK_POLICY_DIGEST', 'FORGELOOP_CODEX_WORKER_NETWORK_POLICY_DIGESTS');
  const networkProviderConfigDigests = stringListEnv('FORGELOOP_CODEX_WORKER_NETWORK_PROVIDER_CONFIG_DIGESTS');
  const runtimeProfileId = optionalEnv('FORGELOOP_CODEX_RUN_EXECUTION_RUNTIME_PROFILE_ID') ?? optionalEnv('FORGELOOP_CODEX_RUNTIME_PROFILE_ID');
  const credentialBindingId = requiredEnv('FORGELOOP_CODEX_RUN_EXECUTION_CREDENTIAL_BINDING_ID');
  const maxConcurrency = positiveIntEnv('FORGELOOP_WORKER_MAX_CONCURRENCY', 1);
  const capabilities = workerCapabilitiesEnv(['run_execution']);
  const authorizedScopes = runtimeScopesEnv();
  const nonceFactory = () => randomBytes(16).toString('base64url');
  const now = () => new Date().toISOString();

  const worker = createLocalCodexWorkerRuntime({
    workerId,
    workerIdentity,
    version: 'control-plane-api-run-worker',
    bootstrapToken,
    bootstrapTokenVersion,
    authorizedScopes,
    capabilities,
    dockerImageDigests,
    networkPolicyDigests,
    ...(networkProviderConfigDigests.length === 0 ? {} : { networkProviderConfigDigests }),
    hostUid,
    hostGid,
    maxConcurrency,
    labels: { process: 'control-plane-api', run_worker_id: input.runWorkerId },
    controlPlaneClient: {
      registerWorker: (body) => input.codexRuntimeService.registerWorker(body as any),
      heartbeatWorker: (registeredWorkerId, body) => input.codexRuntimeService.heartbeatWorker(registeredWorkerId, body as any),
    },
    now,
    nonceFactory,
  });

  let workerReady: Promise<void> | undefined;
  const ensureWorkerReady = (): Promise<void> => {
    workerReady ??= (async () => {
      await worker.register();
      await worker.heartbeat();
      worker.startHeartbeatLoop();
    })();
    return workerReady;
  };

  const launcher = new DockerizedCodexAppServerLauncher({
    dockerBin,
    workerId,
    workerTempRoot,
    dockerRunner,
    controlPlaneClient: {
      materializeLaunchLease: async (registeredWorkerId, leaseId, body) =>
        normalizeMaterializationResponse(await input.codexRuntimeService.materializeLaunchLease(registeredWorkerId, leaseId, body as any)),
      terminalizeLaunchLease: (registeredWorkerId, leaseId, body) =>
        input.codexRuntimeService.terminalizeLaunchLease(registeredWorkerId, leaseId, body as any),
    },
    hostUid,
    hostGid,
    allowedRepoRoots: stringListEnv('FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS'),
    effectiveConfigProbe: probeCodexEffectiveConfig,
    now,
    nonceFactory,
  });

  return ({ runSession, runtimeMetadata, workerLease }) =>
    createLeasedRunSessionCodexDriver(
      {
        launcher,
        rawLogStore: input.rawLogStore,
        workerIdentity,
        createLaunchLease: async () => {
          await ensureWorkerReady();
          const latest = await input.repository.getRunSession(runSession.id);
          if (latest?.run_spec === undefined) {
            throw new Error('codex_launch_lease_denied: run session is missing a run spec');
          }
          const runSpec = latest.run_spec;
          const status = await input.codexRuntimeService.getStatus({
            project_id: runSpec.project_id,
            repo_id: runSpec.repo.repo_id,
            target_kind: 'run_execution',
            ...(runtimeProfileId === undefined ? {} : { runtime_profile_id: runtimeProfileId }),
            credential_binding_id: credentialBindingId,
          });
          if (
            status.runtime_profile_revision_id === undefined ||
            status.credential_binding_id === undefined ||
            status.credential_binding_version_id === undefined ||
            status.credential_payload_digest === undefined ||
            status.docker_image_digest === undefined
          ) {
            throw new Error('codex_launch_lease_denied: runtime profile or credential status is incomplete');
          }
          const selected = await worker.selectForLaunch({
            projectId: runSpec.project_id,
            repoId: runSpec.repo.repo_id,
            dockerImageDigest: status.docker_image_digest,
            targetKind: 'run_execution',
          });
          const launchToken = `codex-launch-${randomBytes(32).toString('base64url')}`;
          const lease = await input.codexRuntimeService.createLaunchLease({
            id: `codex-run-lease-${latest.id}-${randomUUID()}`,
            lease_request_id: `codex-run-lease-request-${latest.id}-${randomUUID()}`,
            target: {
              target_type: 'run_session',
              target_id: latest.id,
              target_kind: 'run_execution',
              project_id: runSpec.project_id,
              repo_id: runSpec.repo.repo_id,
            },
            worker_id: selected.workerId,
            runtime_profile_revision_id: status.runtime_profile_revision_id,
            credential_binding_id: status.credential_binding_id,
            credential_binding_version_id: status.credential_binding_version_id,
            credential_payload_digest: status.credential_payload_digest,
            launch_token: launchToken,
            launch_attempt: runtimeMetadata.recovery_attempt_count,
            execution_package_id: runSpec.execution_package_id,
            run_session_id: latest.id,
            run_worker_lease_id: workerLease.leaseId ?? `run-worker-lease:${latest.id}`,
            run_worker_lease_token: workerLease.leaseToken,
            run_session_status: latest.status as any,
            run_session_updated_at: latest.updated_at,
            execution_package_version: runSpec.expected_package_version,
            expires_at: expiresFromNow(10 * 60 * 1000),
          });
          return { leaseId: lease.lease.id, launchToken: lease.launch_token, workerSessionToken: selected.sessionToken };
        },
      },
      { runSession, runtimeMetadata, workerLease },
    );
};

const createRunWorker = (repository: DeliveryRepository, codexRuntimeService: CodexRuntimeService): RunWorker => {
  const artifactRoot = process.env.FORGELOOP_EXECUTOR_ARTIFACT_ROOT ?? join(tmpdir(), 'forgeloop-executor-artifacts');
  mkdirSync(artifactRoot, { recursive: true });
  const rawLogStore = new LocalCodexRawLogStore({ artifactRoot: join(artifactRoot, 'raw-logs') });
  const runWorkerId = process.env.FORGELOOP_RUN_WORKER_ID ?? 'control-plane-api-worker';
  const leasedDriverFactory = createLocalDockerLeasedDriverFactory({
    repository,
    codexRuntimeService,
    artifactRoot,
    rawLogStore,
    runWorkerId,
  });

  return new RunWorker({
    repository,
    workerId: runWorkerId,
    driverFactory: ({ runSession, runtimeMetadata, workerLease }) => {
      const runSpec = runSession.run_spec;
      if (runSpec?.executor_type === 'local_codex' && runSpec.workflow_only !== true) {
        if (leasedDriverFactory !== undefined) {
          return leasedDriverFactory({ runSession, runtimeMetadata, workerLease });
        }
        return new GovernedCodexDriver({
          kind: 'app_server',
          repository,
          rawLogStore,
          artifactRoot,
          runSession,
          workerId: runWorkerId,
        });
      }

      return new FakeCodexSessionDriver({
        kind: 'fake',
        script: [{ kind: 'terminal', status: 'succeeded', summary: 'Fake run completed.' }],
      });
    },
    execFallbackDriverFactory: ({ runSession }) =>
      new GovernedCodexDriver({
        kind: 'exec_fallback',
        repository,
        rawLogStore,
        artifactRoot,
        runSession,
        workerId: runWorkerId,
      }),
    evidenceCollector: (input) =>
      input.runSpec.executor_type === 'local_codex' && input.runSpec.workflow_only !== true
        ? runtimeSafetyForRun(repository, {
            runSpec: input.runSpec,
            workspacePath: input.workspacePath,
            artifactRoot,
          }).then((runtimeSafety) => captureLocalCodexEvidence({ ...input, runtimeSafety }))
        : Promise.resolve(mockEvidence(input)),
    selfReview: (input) => Promise.resolve(mockSelfReview(input)),
    artifactRoot,
    allowExecFallback: leasedDriverFactory === undefined,
  });
};

@Module({
  imports: [ControlPlaneCoreModule, CodexRuntimeModule, AuditModule, ExecutionPackagesModule, ReviewEvidenceModule],
  controllers: [ExecutionPackageRunsController, RunSessionsController],
  providers: [
    {
      provide: DELIVERY_RUN_WORKER,
      useFactory: createRunWorker,
      inject: [DELIVERY_REPOSITORY, CodexRuntimeService],
    },
    RunControlService,
    RunWorkerLifecycleService,
  ],
  exports: [DELIVERY_RUN_WORKER, RunControlService, RunWorkerLifecycleService],
})
export class RunControlModule {}
