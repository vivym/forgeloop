import { execFile as execFileCallback } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';
import type { ExecutorResult, RunSpec } from '@forgeloop/contracts';
import {
  InMemoryDeliveryRepository,
  LocalInternalArtifactStore,
  type CreatePendingWorkspaceBundleArtifactInput,
  type CreateInternalArtifactObjectInput,
} from '../../packages/db/src';
import {
  buildInternalArtifactRef,
  codexCanonicalDigest,
  codexRuntimeJobInputDigest,
  codexWorkspaceAcquisitionDigest,
  transitionExecutionPackage,
  transitionRunSession,
} from '../../packages/domain/src';
import type { CodexDriverStartInput, CodexSessionDriver, LocalCodexEvidenceInput, RunRuntimeMetadata } from '../../packages/executor/src';

import { createRunWorkerPendingWorkspaceBundleArtifact, FakeCodexSessionDriver, RunWorker, type RemoteRunExecutionClient } from '../../packages/run-worker/src';
import {
  seedQueuedPackageRun,
  seedReadyStartedPackageRun,
  seedRunningRunWithCommand,
  succeededExecutorResult,
  succeededSelfReview,
} from '../helpers/delivery-runtime-fixtures';

const execFile = promisify(execFileCallback);
const tempRoots: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'forgeloop-run-worker-'));
  tempRoots.push(dir);
  return dir;
};

const execGit = async (cwd: string, args: readonly string[]) => {
  const { stdout } = await execFile('git', [...args], { cwd });
  return String(stdout);
};

const createGitRepo = async (): Promise<{ repo: string; head: string }> => {
  const repo = await makeTempDir();
  await execGit(repo, ['init', '-b', 'main']);
  await execGit(repo, ['config', 'user.email', 'test@example.com']);
  await execGit(repo, ['config', 'user.name', 'Test User']);
  await writeFile(join(repo, 'README.md'), '# Test Repo\n');
  await execGit(repo, ['add', '.']);
  await execGit(repo, ['commit', '-m', 'initial']);
  const head = (await execGit(repo, ['rev-parse', 'HEAD'])).trim();
  return { repo, head };
};

const createGitWorktree = async (): Promise<{ repo: string; worktree: string; head: string }> => {
  const { repo, head } = await createGitRepo();
  const worktreeRoot = await makeTempDir();
  const worktree = join(worktreeRoot, 'linked-worktree');
  await execGit(repo, ['worktree', 'add', worktree, head]);
  return { repo, worktree, head };
};

const localCodexRunSpec = (runSpec: RunSpec, repo: string, head: string): RunSpec => ({
  ...runSpec,
  executor_type: 'local_codex',
  workflow_only: false,
  repo: {
    ...runSpec.repo,
    local_path: repo,
    base_branch: 'main',
    base_commit_sha: head,
  },
  allowed_paths: ['README.md'],
  forbidden_paths: ['.git', '.env', 'node_modules'],
  required_checks: [],
  context: {
    ...runSpec.context,
    required_checks: [],
  },
});

const stableUuidFromDigestForTest = (input: Record<string, unknown>): string => {
  const hex = codexCanonicalDigest(input).slice('sha256:'.length);
  const variant = (8 + (Number.parseInt(hex[16]!, 16) % 4)).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const internalRuntimeArtifactRefForTest = (runtimeJobId: string, artifactIdempotencyKey: string): string => {
  const artifactId = stableUuidFromDigestForTest({
    kind: 'codex_runtime_job_artifact',
    runtime_job_id: runtimeJobId,
    artifact_idempotency_key: artifactIdempotencyKey,
  });
  return buildInternalArtifactRef({
    kind: 'codex_runtime_job_artifact',
    owner_type: 'codex_runtime_job',
    owner_id: runtimeJobId,
    artifact_id: artifactId,
  });
};

const remoteRunExecutionStatusForTest = () => ({
  profile_status: 'active' as const,
  worker_status: 'online' as const,
  runtime_profile_revision_id: 'profile-rev-run-1',
  runtime_profile_digest: `sha256:${'a'.repeat(64)}`,
  credential_binding_id: 'credential-binding-run-1',
  credential_binding_version_id: 'credential-version-run-1',
  credential_payload_digest: `sha256:${'b'.repeat(64)}`,
  docker_image_digest: `sha256:${'c'.repeat(64)}`,
  network_policy_digest: `sha256:${'d'.repeat(64)}`,
});

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const runWorker = (input: {
  repository: InMemoryDeliveryRepository;
  driver: CodexSessionDriver;
  workerId?: string;
  now?: () => string;
  heartbeatIntervalMs?: number;
  commandPollIntervalMs?: number;
  idleThresholdMs?: number;
  leaseDurationMs?: number;
  evidenceCollector?: (input: LocalCodexEvidenceInput) => Promise<ExecutorResult>;
  remoteRunExecutionClient?: RemoteRunExecutionClient;
  remoteRunExecutionWaitTimeoutMs?: number;
  remoteRunExecutionPollIntervalMs?: number;
}) =>
  new RunWorker({
    repository: input.repository,
    workerId: input.workerId ?? 'worker-1',
    driverFactory: () => input.driver,
    execFallbackDriverFactory: () => input.driver,
    evidenceCollector:
      input.evidenceCollector ??
      (async ({ runSpec }) => ({
        ...succeededExecutorResult(runSpec.run_session_id),
        executor_type: runSpec.executor_type,
      })),
    selfReview: async () => succeededSelfReview(),
    now: input.now ?? (() => new Date().toISOString()),
    heartbeatIntervalMs: input.heartbeatIntervalMs ?? 10,
    commandPollIntervalMs: input.commandPollIntervalMs ?? 10,
    leaseDurationMs: input.leaseDurationMs ?? 60_000,
    idleThresholdMs: input.idleThresholdMs ?? 30_000,
    ...(input.remoteRunExecutionClient === undefined ? {} : { remoteRunExecutionClient: input.remoteRunExecutionClient }),
    ...(input.remoteRunExecutionWaitTimeoutMs === undefined ? {} : { remoteRunExecutionWaitTimeoutMs: input.remoteRunExecutionWaitTimeoutMs }),
    ...(input.remoteRunExecutionPollIntervalMs === undefined ? {} : { remoteRunExecutionPollIntervalMs: input.remoteRunExecutionPollIntervalMs }),
  });

class FailingClaimRepository extends InMemoryDeliveryRepository {
  override async claimNextRunCommand(): Promise<undefined> {
    throw new Error('injected command polling failure');
  }
}

class FailingHeartbeatRepository extends InMemoryDeliveryRepository {
  override async heartbeatRunWorkerLease(): Promise<void> {
    throw new Error('injected heartbeat failure');
  }
}

class CapturingWorkspaceBundleRepository extends InMemoryDeliveryRepository {
  pendingWorkspaceBundleInputs: CreatePendingWorkspaceBundleArtifactInput[] = [];

  get capturedInternalArtifactObjects(): CreateInternalArtifactObjectInput[] {
    return [
      ...(this as unknown as { internalArtifactObjects: Map<string, CreateInternalArtifactObjectInput> }).internalArtifactObjects.values(),
    ];
  }

  override async createPendingWorkspaceBundleArtifact(input: CreatePendingWorkspaceBundleArtifactInput): Promise<void> {
    this.pendingWorkspaceBundleInputs.push(input);
    await super.createPendingWorkspaceBundleArtifact(input);
  }
}

const createTestInternalArtifactStore = async (repository: CapturingWorkspaceBundleRepository) =>
  new LocalInternalArtifactStore({
    root: process.env.FORGELOOP_ARTIFACT_STORE_ROOT ?? (await makeTempDir()),
    repository,
    requestId: 'run-worker-test',
  });

const readStoredWorkspaceBundleArchive = async (repository: CapturingWorkspaceBundleRepository, index = 0) => {
  const input = repository.pendingWorkspaceBundleInputs[index]!;
  const object = await createTestInternalArtifactStore(repository).then((store) => store.getObject(input.pending_artifact_ref));
  return JSON.parse(Buffer.from(object.bytes).toString('utf8')) as {
    entries: Array<{ path: string; content_base64?: string }>;
  };
};

describe('RunWorker', () => {
  it('runs a follow-up drain when kick is called during an active drain', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { executionPackage, runSession } = await seedQueuedPackageRun(repository);
    const driver = new FakeCodexSessionDriver({
      script: [{ kind: 'delay', ms: 20 }, { kind: 'terminal', status: 'succeeded', summary: 'Driver completed.' }],
    });
    const worker = runWorker({ repository, driver });

    worker.kick();
    await delay(1);

    const { last_run_session_id, last_failure_summary, blocked_reason, ...readyBase } = executionPackage;
    void last_run_session_id;
    void last_failure_summary;
    void blocked_reason;
    const secondPackage = transitionExecutionPackage(
      {
        ...readyBase,
        id: 'execution-package-2',
        phase: 'ready',
        activity_state: 'idle',
        gate_state: 'not_submitted',
        resolution: 'none',
      },
      { type: 'run', run_session_id: 'run-session-2', at: '2026-05-05T00:00:01.000Z' },
    );
    const secondRun = transitionRunSession(undefined, {
      type: 'create',
      id: 'run-session-2',
      execution_package_id: secondPackage.id,
      requested_by_actor_id: 'actor-owner',
      executor_type: 'mock',
      at: '2026-05-05T00:00:01.000Z',
    });
    await repository.saveExecutionPackage(secondPackage);
    await repository.saveRunSession(secondRun);

    worker.kick();
    await delay(80);

    expect(await repository.getRunSession(runSession.id)).toMatchObject({ status: 'succeeded' });
    expect(await repository.getRunSession(secondRun.id)).toMatchObject({ status: 'succeeded' });
    expect(driver.startCalls.map((call) => call.runSpec.run_session_id)).toEqual([runSession.id, secondRun.id]);
  });

  it('discovers queued runs, emits live events, and finalizes only after terminal driver completion', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedQueuedPackageRun(repository);
    const driver = new FakeCodexSessionDriver({
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'driver_started',
            source: 'codex',
            visibility: 'public',
            summary: 'Driver started.',
            payload: {},
          },
          runtimeMetadata: { driver_kind: 'fake', codex_thread_id: 'thread-1', active_turn_id: 'turn-1' },
        },
        { kind: 'delay', ms: 20 },
        {
          kind: 'terminal',
          status: 'succeeded',
          summary: 'Driver completed.',
          runtimeMetadata: { driver_status: 'terminal' },
        },
      ],
    });
    const worker = runWorker({ repository, driver });

    const pending = worker.drainOnce();
    await delay(1);
    expect(await repository.getRunSession(runSession.id)).toMatchObject({ status: 'running' });

    await pending;

    expect(await repository.getRunSession(runSession.id)).toMatchObject({ status: 'succeeded', summary: 'Executor completed the package.' });
    expect((await repository.listReviewPacketsForPackage(runSession.execution_package_id))).toHaveLength(1);
    expect((await repository.listRunEvents(runSession.id)).map((event) => event.event_type)).toContain('driver_started');
    expect(driver.startCalls).toHaveLength(1);
    expect(driver.resumeCalls).toHaveLength(0);
  });

  it('passes the active run-worker lease context to driver factories', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedQueuedPackageRun(repository);
    const driver = new FakeCodexSessionDriver({
      script: [{ kind: 'terminal', status: 'succeeded', summary: 'Driver completed.' }],
    });
    const factoryInputs: unknown[] = [];
    const worker = new RunWorker({
      repository,
      workerId: 'worker-lease-context',
      driverFactory: (input) => {
        factoryInputs.push(input);
        return driver;
      },
      evidenceCollector: async ({ runSpec }) => ({
        ...succeededExecutorResult(runSpec.run_session_id),
        executor_type: runSpec.executor_type,
      }),
      selfReview: async () => succeededSelfReview(),
      heartbeatIntervalMs: 10,
      commandPollIntervalMs: 10,
      leaseDurationMs: 60_000,
    });

    await worker.drainOnce();

    expect(factoryInputs).toHaveLength(1);
    expect(factoryInputs[0]).toMatchObject({
      runSession: { id: runSession.id },
      workerLease: {
        workerId: 'worker-lease-context',
        runSessionId: runSession.id,
        leaseToken: expect.any(String),
      },
    });
  });

  it('moves idle active runs to stalled instead of timed_out', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedReadyStartedPackageRun(repository);
    await repository.saveRunSession({
      ...runSession,
      runtime_metadata: {
        ...runSession.runtime_metadata!,
        driver_kind: 'fake',
        driver_status: 'active',
        last_event_at: '2026-05-08T00:00:00.000Z',
      },
    });
    const driver = new FakeCodexSessionDriver();
    const worker = runWorker({
      repository,
      driver,
      now: () => '2026-05-08T00:02:00.000Z',
      idleThresholdMs: 30_000,
    });

    await worker.drainOnce();

    expect(await repository.getRunSession(runSession.id)).toMatchObject({ status: 'stalled' });
  });

  it('heartbeats lease during long driver execution and releases on terminal completion', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedQueuedPackageRun(repository);
    const driver = new FakeCodexSessionDriver({
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'driver_started',
            source: 'codex',
            visibility: 'public',
            summary: 'Driver started.',
            payload: {},
          },
        },
        { kind: 'delay', ms: 35 },
        { kind: 'terminal', status: 'succeeded', summary: 'Done.' },
      ],
    });
    const worker = runWorker({ repository, driver, heartbeatIntervalMs: 5 });

    await worker.drainOnce();

    const lease = await repository.getRunWorkerLease(runSession.id);
    expect(lease).toMatchObject({ status: 'released', worker_id: 'worker-1' });
    expect((await repository.listRunEvents(runSession.id)).filter((event) => event.event_type === 'watchdog_heartbeat').length).toBeGreaterThan(1);
  });

  it('polls active commands while a long driver stream is running', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedReadyStartedPackageRun(repository);
    const driver = new FakeCodexSessionDriver({
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'driver_started',
            source: 'codex',
            visibility: 'public',
            summary: 'Driver resumed.',
            payload: {},
          },
          runtimeMetadata: { driver_kind: 'fake', active_turn_id: 'turn-active' },
        },
        { kind: 'delay', ms: 60 },
        { kind: 'terminal', status: 'succeeded', summary: 'Done.' },
      ],
      inputAcks: [{ continuity: { turn_id: 'turn-after-input' } }],
    });
    const worker = runWorker({ repository, driver, commandPollIntervalMs: 5 });

    const pending = worker.drainOnce();
    await delay(15);
    await repository.saveRunCommand({
      id: 'run-command:late-input',
      run_session_id: runSession.id,
      command_type: 'input',
      status: 'pending',
      actor_id: 'actor-owner',
      payload: { message: 'late steering input' },
      target_turn_id: 'turn-active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await pending;

    expect(driver.inputs).toEqual([
      expect.objectContaining({
        message: 'late steering input',
        targetTurnId: 'turn-active',
      }),
    ]);
  });

  it('delivers queued app-server input with runtime metadata from the primed thread event', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedQueuedPackageRun(repository);
    const driver = new FakeCodexSessionDriver({
      kind: 'app_server',
      deferStartUntilIteration: true,
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'thread_started',
            source: 'codex',
            visibility: 'public',
            summary: 'App-server thread started.',
            payload: { thread_id: 'thread-from-start' },
          },
          runtimeMetadata: {
            driver_kind: 'app_server',
            driver_status: 'active',
            codex_thread_id: 'thread-from-start',
            active_turn_id: 'turn-from-start',
            effective_dangerous_mode: 'confirmed',
          },
        },
        { kind: 'delay', ms: 60 },
        { kind: 'terminal', status: 'succeeded', summary: 'Done.' },
      ],
    });
    const worker = runWorker({ repository, driver, commandPollIntervalMs: 5 });

    const pending = worker.drainOnce();
    await delay(15);
    await repository.saveRunCommand({
      id: 'run-command:queued-app-server-input',
      run_session_id: runSession.id,
      command_type: 'input',
      status: 'pending',
      actor_id: 'actor-owner',
      payload: { message: 'continue after app-server start' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await pending;

    expect(driver.inputs[0]?.runtimeMetadata).toMatchObject({
      codex_thread_id: 'thread-from-start',
      active_turn_id: 'turn-from-start',
    });
  });

  it('stalls and releases lease when active command polling fails', async () => {
    const repository = new FailingClaimRepository();
    const { runSession } = await seedReadyStartedPackageRun(repository);
    const driver = new FakeCodexSessionDriver({
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'driver_started',
            source: 'codex',
            visibility: 'public',
            summary: 'Driver resumed.',
            payload: {},
          },
        },
        { kind: 'delay', ms: 1_000 },
        { kind: 'terminal', status: 'succeeded', summary: 'Should not complete.' },
      ],
    });
    const worker = runWorker({ repository, driver, commandPollIntervalMs: 5 });

    await expect(Promise.race([worker.drainOnce(), delay(300).then(() => 'timeout')])).resolves.not.toBe('timeout');

    expect(await repository.getRunSession(runSession.id)).toMatchObject({
      status: 'stalled',
      summary: 'Worker stopped before terminal completion.',
    });
    expect(await repository.getRunWorkerLease(runSession.id)).toMatchObject({
      status: 'released',
      worker_id: 'worker-1',
    });
  });

  it('reclaims expired running lease before recovery', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedReadyStartedPackageRun(repository);
    await repository.claimRunWorkerLease({
      run_session_id: runSession.id,
      worker_id: 'worker-old',
      lease_token: 'lease-token-old',
      now: '2026-05-08T00:00:00.000Z',
      expires_at: '2026-05-08T00:00:05.000Z',
    });
    const driver = new FakeCodexSessionDriver({
      script: [{ kind: 'terminal', status: 'succeeded', summary: 'Recovered.' }],
    });
    const worker = runWorker({
      repository,
      driver,
      workerId: 'worker-new',
      now: () => '2026-05-08T00:00:10.000Z',
    });

    await worker.drainOnce();

    const lease = await repository.getRunWorkerLease(runSession.id);
    expect(lease).toMatchObject({ worker_id: 'worker-new', status: 'released' });
    expect(driver.resumeCalls).toHaveLength(1);
  });

  it('reattaches app-server recovery before applying pending input', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedRunningRunWithCommand(repository, {
      command_type: 'input',
      payload: { message: 'please continue' },
      target_turn_id: 'turn-existing',
    });
    await repository.saveRunSession({
      ...runSession,
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        driver_status: 'active',
        codex_thread_id: 'thread-existing',
        active_turn_id: 'turn-existing',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'confirmed',
      },
    });
    await repository.claimRunWorkerLease({
      run_session_id: runSession.id,
      worker_id: 'worker-old',
      lease_token: 'lease-token-old',
      now: '2026-05-08T00:00:00.000Z',
      expires_at: '2026-05-08T00:00:05.000Z',
    });
    const driver = new FakeCodexSessionDriver({
      deferResumeUntilIteration: true,
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'thread_resumed',
            source: 'codex',
            visibility: 'public',
            summary: 'Thread resumed.',
            payload: {},
          },
        },
        { kind: 'delay', ms: 20 },
        { kind: 'terminal', status: 'succeeded', summary: 'Recovered.' },
      ],
      inputAcks: [{ continuity: { thread_id: 'thread-existing', turn_id: 'turn-after-input' } }],
    });
    const worker = runWorker({
      repository,
      driver,
      workerId: 'worker-new',
      now: () => '2026-05-08T00:00:10.000Z',
    });

    await worker.drainOnce();

    expect(driver.resumeCalls).toHaveLength(1);
    expect(driver.inputs).toEqual([
      expect.objectContaining({
        message: 'please continue',
        targetTurnId: 'turn-existing',
      }),
    ]);
    expect(driver.callOrder).toEqual(['resumeRun', 'sendInput']);
  });

  it('marks synchronous app-server recovery and exec fallback failure as stalled', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedReadyStartedPackageRun(repository);
    await repository.saveRunSession({
      ...runSession,
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        driver_status: 'active',
        codex_thread_id: 'thread-existing',
        active_turn_id: 'turn-existing',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'confirmed',
      } satisfies RunRuntimeMetadata,
    });
    const appServerDriver = new FakeCodexSessionDriver({ failResumeWith: new Error('app server unavailable') });
    const execFallbackDriver = new FakeCodexSessionDriver({ failResumeWith: new Error('exec resume unavailable') });
    const worker = new RunWorker({
      repository,
      workerId: 'worker-1',
      driverFactory: () => appServerDriver,
      execFallbackDriverFactory: () => execFallbackDriver,
      evidenceCollector: async ({ runSpec }) => succeededExecutorResult(runSpec.run_session_id),
      selfReview: async () => succeededSelfReview(),
      now: () => '2026-05-08T00:00:00.000Z',
      heartbeatIntervalMs: 10,
      leaseDurationMs: 60_000,
      idleThresholdMs: 30_000,
    });

    await worker.drainOnce();

    expect(await repository.getRunSession(runSession.id)).toMatchObject({
      status: 'stalled',
      summary: 'Driver recovery failed.',
    });
    expect((await repository.listRunEvents(runSession.id)).map((event) => event.event_type)).toContain('stalled');
  });

  it('marks async app-server and exec fallback terminal recovery failures as stalled', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedReadyStartedPackageRun(repository);
    await repository.saveRunSession({
      ...runSession,
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        driver_status: 'active',
        codex_thread_id: 'thread-existing',
        active_turn_id: 'turn-existing',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'confirmed',
      } satisfies RunRuntimeMetadata,
    });
    const appServerDriver = new FakeCodexSessionDriver({
      kind: 'app_server',
      deferResumeUntilIteration: true,
      script: [
        {
          kind: 'terminal',
          status: 'failed',
          summary: 'App-server resume failed.',
          failure: { kind: 'executor_error', message: 'app server unavailable', retryable: true },
        },
      ],
    });
    const execFallbackDriver = new FakeCodexSessionDriver({
      kind: 'exec_fallback',
      deferResumeUntilIteration: true,
      script: [
        {
          kind: 'terminal',
          status: 'failed',
          summary: 'Exec fallback resume failed.',
          failure: { kind: 'executor_error', message: 'exec resume unavailable', retryable: true },
        },
      ],
    });
    const worker = new RunWorker({
      repository,
      workerId: 'worker-1',
      driverFactory: () => appServerDriver,
      execFallbackDriverFactory: () => execFallbackDriver,
      evidenceCollector: async ({ runSpec }) => succeededExecutorResult(runSpec.run_session_id),
      selfReview: async () => succeededSelfReview(),
      now: () => new Date().toISOString(),
      heartbeatIntervalMs: 10,
      commandPollIntervalMs: 10,
      leaseDurationMs: 60_000,
      idleThresholdMs: 30_000,
    });

    await worker.drainOnce();

    expect(appServerDriver.resumeCalls).toHaveLength(1);
    expect(execFallbackDriver.resumeCalls).toHaveLength(1);
    expect(await repository.getRunSession(runSession.id)).toMatchObject({
      status: 'stalled',
      summary: 'Driver recovery failed.',
    });
    expect((await repository.listReviewPacketsForPackage(runSession.execution_package_id))).toHaveLength(0);
  });

  it('uses exec fallback when app-server recovery emits fallback event and ends', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedReadyStartedPackageRun(repository);
    await repository.saveRunSession({
      ...runSession,
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        driver_status: 'active',
        codex_thread_id: 'thread-existing',
        active_turn_id: 'turn-existing',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'confirmed',
      } satisfies RunRuntimeMetadata,
    });
    const appServerDriver = new FakeCodexSessionDriver({
      kind: 'app_server',
      deferResumeUntilIteration: true,
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'driver_fallback_used',
            source: 'executor',
            visibility: 'public',
            summary: 'Codex app-server resume failed; fallback is required.',
            payload: { reason: 'thread/resume failed' },
          },
          runtimeMetadata: {
            driver_kind: 'exec_fallback',
            driver_status: 'starting',
          },
        },
      ],
    });
    const execFallbackDriver = new FakeCodexSessionDriver({
      kind: 'exec_fallback',
      deferResumeUntilIteration: true,
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'thread_resumed',
            source: 'codex',
            visibility: 'public',
            summary: 'Exec fallback resumed thread.',
            payload: { thread_id: 'thread-existing' },
          },
        },
        { kind: 'terminal', status: 'succeeded', summary: 'Exec fallback completed.' },
      ],
    });
    const worker = new RunWorker({
      repository,
      workerId: 'worker-1',
      driverFactory: () => appServerDriver,
      execFallbackDriverFactory: () => execFallbackDriver,
      evidenceCollector: async ({ runSpec }) => succeededExecutorResult(runSpec.run_session_id),
      selfReview: async () => succeededSelfReview(),
      now: () => new Date().toISOString(),
      heartbeatIntervalMs: 10,
      commandPollIntervalMs: 10,
      leaseDurationMs: 60_000,
      idleThresholdMs: 30_000,
    });

    await worker.drainOnce();

    expect(appServerDriver.resumeCalls).toHaveLength(1);
    expect(execFallbackDriver.resumeCalls).toHaveLength(1);
    expect(await repository.getRunSession(runSession.id)).toMatchObject({
      status: 'succeeded',
      summary: 'Executor completed the package.',
    });
  });

  it('stalls instead of using host exec fallback when fallback is denied by policy', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedReadyStartedPackageRun(repository);
    await repository.saveRunSession({
      ...runSession,
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        driver_status: 'active',
        codex_thread_id: 'thread-existing',
        active_turn_id: 'turn-existing',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'confirmed',
      } satisfies RunRuntimeMetadata,
    });
    const appServerDriver = new FakeCodexSessionDriver({
      kind: 'app_server',
      deferResumeUntilIteration: true,
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'driver_fallback_used',
            source: 'executor',
            visibility: 'public',
            summary: 'Codex app-server resume failed; fallback is required.',
            payload: { reason: 'thread/resume failed' },
          },
          runtimeMetadata: {
            driver_kind: 'exec_fallback',
            driver_status: 'starting',
          },
        },
      ],
    });
    const execFallbackDriver = new FakeCodexSessionDriver({
      kind: 'exec_fallback',
      script: [{ kind: 'terminal', status: 'succeeded', summary: 'Exec fallback should not run.' }],
    });
    const worker = new RunWorker({
      repository,
      workerId: 'worker-1',
      driverFactory: () => appServerDriver,
      execFallbackDriverFactory: () => execFallbackDriver,
      evidenceCollector: async ({ runSpec }) => succeededExecutorResult(runSpec.run_session_id),
      selfReview: async () => succeededSelfReview(),
      now: () => new Date().toISOString(),
      heartbeatIntervalMs: 10,
      commandPollIntervalMs: 10,
      leaseDurationMs: 60_000,
      idleThresholdMs: 30_000,
      allowExecFallback: false,
    });

    await worker.drainOnce();

    expect(appServerDriver.resumeCalls).toHaveLength(1);
    expect(execFallbackDriver.startCalls).toHaveLength(0);
    expect(execFallbackDriver.resumeCalls).toHaveLength(0);
    expect(await repository.getRunSession(runSession.id)).toMatchObject({
      status: 'stalled',
      summary: 'Driver recovery failed.',
    });
  });

  it('resumes exec fallback directly when recovery metadata already selected fallback', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedReadyStartedPackageRun(repository);
    await repository.saveRunSession({
      ...runSession,
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'exec_fallback',
        driver_status: 'active',
        selected_execution_mode: 'exec_fallback',
        app_server_attempted: true,
        app_server_fallback_reason: 'Codex app-server thread became idle before turn completion.',
        exec_fallback_dangerous_bypass: true,
        codex_thread_id: 'thread-fallback-existing',
        active_turn_id: 'turn-fallback-existing',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'confirmed',
      } satisfies RunRuntimeMetadata,
    });
    const appServerDriver = new FakeCodexSessionDriver({
      kind: 'app_server',
      failResumeWith: new Error('app-server resume should not be used after fallback selection'),
    });
    const execFallbackDriver = new FakeCodexSessionDriver({
      kind: 'exec_fallback',
      deferResumeUntilIteration: true,
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'thread_resumed',
            source: 'codex',
            visibility: 'public',
            summary: 'Exec fallback resumed thread.',
            payload: { thread_id: 'thread-fallback-existing' },
          },
          runtimeMetadata: {
            driver_kind: 'exec_fallback',
            driver_status: 'active',
            selected_execution_mode: 'exec_fallback',
            codex_thread_id: 'thread-fallback-existing',
            effective_dangerous_mode: 'confirmed',
          },
        },
        { kind: 'terminal', status: 'succeeded', summary: 'Exec fallback completed.' },
      ],
    });
    const worker = new RunWorker({
      repository,
      workerId: 'worker-1',
      driverFactory: () => appServerDriver,
      execFallbackDriverFactory: () => execFallbackDriver,
      evidenceCollector: async ({ runSpec }) => succeededExecutorResult(runSpec.run_session_id),
      selfReview: async () => succeededSelfReview(),
      now: () => new Date().toISOString(),
      heartbeatIntervalMs: 10,
      commandPollIntervalMs: 10,
      leaseDurationMs: 60_000,
      idleThresholdMs: 30_000,
    });

    await worker.drainOnce();

    expect(appServerDriver.resumeCalls).toHaveLength(0);
    expect(execFallbackDriver.resumeCalls).toHaveLength(1);
    expect(await repository.getRunSession(runSession.id)).toMatchObject({
      status: 'succeeded',
      runtime_metadata: expect.objectContaining({
        selected_execution_mode: 'exec_fallback',
        driver_kind: 'exec_fallback',
        app_server_fallback_reason: 'Codex app-server thread became idle before turn completion.',
      }),
    });
  });

  it('uses exec fallback when app-server start emits fallback event and ends', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedQueuedPackageRun(repository);
    const appServerDriver = new FakeCodexSessionDriver({
      kind: 'app_server',
      deferStartUntilIteration: true,
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'driver_fallback_used',
            source: 'executor',
            visibility: 'public',
            summary: 'Codex app-server failed preflight; fallback is required.',
            payload: { reason: 'app-server connection refused' },
          },
          runtimeMetadata: {
            driver_kind: 'exec_fallback',
            driver_status: 'starting',
          },
        },
      ],
    });
    const execFallbackDriver = new FakeCodexSessionDriver({
      kind: 'exec_fallback',
      deferStartUntilIteration: true,
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'thread_started',
            source: 'codex',
            visibility: 'public',
            summary: 'Exec fallback started thread.',
            payload: { thread_id: 'thread-fallback' },
          },
          runtimeMetadata: {
            driver_kind: 'exec_fallback',
            driver_status: 'active',
            codex_thread_id: 'thread-fallback',
            effective_dangerous_mode: 'confirmed',
          },
        },
        { kind: 'terminal', status: 'succeeded', summary: 'Exec fallback completed.' },
      ],
    });
    const worker = new RunWorker({
      repository,
      workerId: 'worker-1',
      driverFactory: () => appServerDriver,
      execFallbackDriverFactory: () => execFallbackDriver,
      evidenceCollector: async ({ runSpec }) => ({
        ...succeededExecutorResult(runSpec.run_session_id),
        executor_type: runSpec.executor_type,
      }),
      selfReview: async () => succeededSelfReview(),
      now: () => new Date().toISOString(),
      heartbeatIntervalMs: 10,
      commandPollIntervalMs: 10,
      leaseDurationMs: 60_000,
      idleThresholdMs: 30_000,
    });

    await worker.drainOnce();

    const completed = await repository.getRunSession(runSession.id);
    expect(appServerDriver.startCalls).toHaveLength(1);
    expect(execFallbackDriver.startCalls).toHaveLength(1);
    expect(execFallbackDriver.resumeCalls).toHaveLength(0);
    expect(completed).toMatchObject({
      status: 'succeeded',
      summary: 'Executor completed the package.',
      runtime_metadata: expect.objectContaining({
        app_server_attempted: true,
        selected_execution_mode: 'exec_fallback',
        app_server_fallback_reason: 'app-server connection refused',
        exec_fallback_dangerous_bypass: true,
        effective_dangerous_mode: 'confirmed',
      }),
    });
  });

  it('uses a run-session worktree and snapshots the source checkout before app-server execution', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { repo, head } = await createGitRepo();
    const { runSession } = await seedQueuedPackageRun(repository);
    const [projectRepo] = await repository.listProjectRepos('project-1');
    await repository.saveProjectRepo({
      ...projectRepo!,
      local_path: repo,
      base_commit_sha: head,
      default_branch: 'main',
    });
    await repository.saveRunSession({
      ...runSession,
      executor_type: 'local_codex',
      run_spec: undefined,
    });

    const startInputs: CodexDriverStartInput[] = [];
    let evidenceInput: LocalCodexEvidenceInput | undefined;
    const driver: CodexSessionDriver = {
      kind: 'app_server',
      startRun: async function* (input) {
        startInputs.push(input);
        await mkdir(join(repo, 'source-mutation'), { recursive: true });
        await writeFile(join(repo, 'source-mutation', 'during-run.txt'), 'mutated during run\n');
        yield { kind: 'terminal', status: 'succeeded', summary: 'App-server completed.' };
      },
      resumeRun: async function* () {
        throw new Error('resume should not be called');
      },
      sendInput: async () => ({}),
      cancelRun: async () => ({}),
    };
    const worker = runWorker({
      repository,
      driver,
      evidenceCollector: async (input) => {
        evidenceInput = input;
        return {
          ...succeededExecutorResult(input.runSpec.run_session_id),
          executor_type: 'local_codex',
        };
      },
    });

    await worker.drainOnce();

    expect(startInputs[0]?.workspacePath).toBe(join(repo, '.worktrees', runSession.id));
    expect(evidenceInput?.workspacePath).toBe(join(repo, '.worktrees', runSession.id));
    expect(evidenceInput?.sourceRepoSnapshot).toMatchObject({
      repoPath: repo,
      beforePorcelain: '',
    });
  }, 15_000);

  it('stores remote workspace bundle bytes only after holding an active run-worker lease', async () => {
    const repository = new CapturingWorkspaceBundleRepository();
    const { repo, head } = await createGitRepo();
    await mkdir(join(repo, 'packages', 'workflow'), { recursive: true });
    await writeFile(join(repo, 'packages', 'workflow', 'src.ts'), 'export const value = 1;\n');
    await execGit(repo, ['add', '.']);
    await execGit(repo, ['commit', '-m', 'add source']);
    const { executionPackage, runSession } = await seedQueuedPackageRun(repository);
    const [projectRepo] = await repository.listProjectRepos('project-1');
    await repository.saveProjectRepo({
      ...projectRepo!,
      local_path: repo,
      base_commit_sha: head,
      default_branch: 'main',
    });
    const activeLease = await repository.claimRunWorkerLease({
      run_session_id: runSession.id,
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now: '2026-05-23T00:00:00.000Z',
      expires_at: '2026-05-23T00:10:00.000Z',
    });

    const pending = await createRunWorkerPendingWorkspaceBundleArtifact({
      repository,
      runSession,
      executionPackage,
      runWorkerLease: activeLease,
      workspacePath: repo,
      bundleId: 'run-worker-workspace-bundle-1',
      now: '2026-05-23T00:00:00.000Z',
      expiresAt: '2026-05-23T00:10:00.000Z',
      maxSizeBytes: 1_000_000,
    });

    expect(repository.pendingWorkspaceBundleInputs).toHaveLength(1);
    expect(repository.pendingWorkspaceBundleInputs[0]).not.toHaveProperty('archive_bytes_base64');
    expect(repository.pendingWorkspaceBundleInputs[0]).toMatchObject({
      bundle_id: 'run-worker-workspace-bundle-1',
      run_session_id: runSession.id,
      execution_package_id: executionPackage.id,
      run_worker_lease_id: activeLease.id,
      size_bytes: expect.any(Number),
      pending_artifact_ref: `artifact://internal/workspace_bundle/run_session/${runSession.id}/run-worker-workspace-bundle-1`,
      internal_artifact_object_id: expect.any(String),
    });
    expect(repository.capturedInternalArtifactObjects).toHaveLength(1);
    expect(repository.capturedInternalArtifactObjects[0]).toMatchObject({
      id: repository.pendingWorkspaceBundleInputs[0]!.internal_artifact_object_id,
      ref: repository.pendingWorkspaceBundleInputs[0]!.pending_artifact_ref,
      kind: 'workspace_bundle',
      owner_type: 'run_session',
      owner_id: runSession.id,
      digest: repository.pendingWorkspaceBundleInputs[0]!.archive_digest,
      size_bytes: String(repository.pendingWorkspaceBundleInputs[0]!.size_bytes),
      metadata_json: expect.objectContaining({
        manifest_digest: repository.pendingWorkspaceBundleInputs[0]!.manifest_digest,
        execution_package_id: executionPackage.id,
        run_worker_lease_id: activeLease.id,
      }),
    });
    expect(pending.pending_workspace_bundle).toMatchObject({
      bundle_id: 'run-worker-workspace-bundle-1',
      run_worker_lease_id: activeLease.id,
      archive_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      manifest_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(pending.pending_workspace_bundle.workspace_acquisition_json)).not.toContain(repo);

    await expect(
      createRunWorkerPendingWorkspaceBundleArtifact({
        repository,
        runSession,
        executionPackage,
        runWorkerLease: { ...activeLease, status: 'expired' },
        workspacePath: repo,
        bundleId: 'run-worker-workspace-bundle-expired',
        now: '2026-05-23T00:00:00.000Z',
        expiresAt: '2026-05-23T00:10:00.000Z',
      }),
    ).rejects.toThrow(/run_worker_lease_unavailable/);
  });

  it('stores remote workspace bundle bytes from a git worktree without packaging the .git file', async () => {
    const repository = new CapturingWorkspaceBundleRepository();
    const { repo, worktree, head } = await createGitWorktree();
    const { executionPackage, runSession } = await seedQueuedPackageRun(repository);
    const [projectRepo] = await repository.listProjectRepos('project-1');
    await repository.saveProjectRepo({
      ...projectRepo!,
      local_path: worktree,
      base_commit_sha: head,
      default_branch: 'main',
    });
    const activeLease = await repository.claimRunWorkerLease({
      run_session_id: runSession.id,
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now: '2026-05-23T00:00:00.000Z',
      expires_at: '2026-05-23T00:10:00.000Z',
    });

    await createRunWorkerPendingWorkspaceBundleArtifact({
      repository,
      runSession,
      executionPackage,
      runWorkerLease: activeLease,
      workspacePath: worktree,
      bundleId: 'run-worker-workspace-bundle-worktree',
      now: '2026-05-23T00:00:00.000Z',
      expiresAt: '2026-05-23T00:10:00.000Z',
      maxSizeBytes: 1_000_000,
    });

    const archive = await readStoredWorkspaceBundleArchive(repository);
    expect(archive.entries.map((entry) => entry.path)).not.toContain('.git');
    expect(JSON.stringify(archive)).not.toContain(repo);
  });

  it('skips nested git metadata and dependency directories when storing remote workspace bundles', async () => {
    const repository = new CapturingWorkspaceBundleRepository();
    const { repo, head } = await createGitRepo();
    await mkdir(join(repo, 'packages', 'workflow', '.git'), { recursive: true });
    await mkdir(join(repo, 'packages', 'workflow', 'node_modules', 'pkg'), { recursive: true });
    await mkdir(join(repo, '.forgeloop', 'codex-runtime', 'nested'), { recursive: true });
    await writeFile(join(repo, 'packages', 'workflow', 'src.ts'), 'export const value = 1;\n');
    await writeFile(join(repo, 'packages', 'workflow', '.git', 'config'), '[remote \"origin\"]\nurl = git@example.com:secret/repo.git\n');
    await writeFile(join(repo, 'packages', 'workflow', 'node_modules', 'pkg', 'index.js'), 'module.exports = \"secret\";\n');
    await writeFile(join(repo, '.forgeloop', 'repo-owned.toml'), 'setting = true\n');
    await writeFile(join(repo, '.forgeloop', 'codex-runtime', 'package-prompt.txt'), 'stale runtime prompt\n');
    await writeFile(join(repo, '.forgeloop', 'codex-runtime', 'nested', 'state.json'), '{\"secret\":true}\n');
    const { executionPackage, runSession } = await seedQueuedPackageRun(repository);
    const [projectRepo] = await repository.listProjectRepos('project-1');
    await repository.saveProjectRepo({
      ...projectRepo!,
      local_path: repo,
      base_commit_sha: head,
      default_branch: 'main',
    });
    const activeLease = await repository.claimRunWorkerLease({
      run_session_id: runSession.id,
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now: '2026-05-23T00:00:00.000Z',
      expires_at: '2026-05-23T00:10:00.000Z',
    });

    await createRunWorkerPendingWorkspaceBundleArtifact({
      repository,
      runSession,
      executionPackage,
      runWorkerLease: activeLease,
      workspacePath: repo,
      bundleId: 'run-worker-workspace-bundle-nested-skips',
      now: '2026-05-23T00:00:00.000Z',
      expiresAt: '2026-05-23T00:10:00.000Z',
      maxSizeBytes: 1_000_000,
    });

    const archive = await readStoredWorkspaceBundleArchive(repository);
    expect(archive.entries.map((entry) => entry.path)).toContain('packages/workflow/src.ts');
    expect(archive.entries.map((entry) => entry.path)).toContain('.forgeloop/repo-owned.toml');
    expect(archive.entries.map((entry) => entry.path)).not.toContain('packages/workflow/.git/config');
    expect(archive.entries.map((entry) => entry.path)).not.toContain('packages/workflow/node_modules/pkg/index.js');
    expect(archive.entries.map((entry) => entry.path)).not.toContain('.forgeloop/codex-runtime/package-prompt.txt');
    expect(archive.entries.map((entry) => entry.path)).not.toContain('.forgeloop/codex-runtime/nested/state.json');
    expect(JSON.stringify(archive)).not.toContain('git@example.com');
    expect(JSON.stringify(archive)).not.toContain('module.exports = \"secret\"');
    expect(JSON.stringify(archive)).not.toContain('stale runtime prompt');
  });

  it('refuses to store remote workspace bundles that contain symlinks escaping the workspace', async () => {
    const repository = new CapturingWorkspaceBundleRepository();
    const { repo, head } = await createGitRepo();
    const outside = await makeTempDir();
    await writeFile(join(outside, 'secret.txt'), 'outside\n');
    await mkdir(join(repo, 'packages', 'workflow'), { recursive: true });
    await symlink(join(outside, 'secret.txt'), join(repo, 'packages', 'workflow', 'leak.txt'));
    const { executionPackage, runSession } = await seedQueuedPackageRun(repository);
    const [projectRepo] = await repository.listProjectRepos('project-1');
    await repository.saveProjectRepo({
      ...projectRepo!,
      local_path: repo,
      base_commit_sha: head,
      default_branch: 'main',
    });
    const activeLease = await repository.claimRunWorkerLease({
      run_session_id: runSession.id,
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now: '2026-05-23T00:00:00.000Z',
      expires_at: '2026-05-23T00:10:00.000Z',
    });

    await expect(
      createRunWorkerPendingWorkspaceBundleArtifact({
        repository,
        runSession,
        executionPackage,
        runWorkerLease: activeLease,
        workspacePath: repo,
        bundleId: 'run-worker-workspace-bundle-symlink',
        now: '2026-05-23T00:00:00.000Z',
        expiresAt: '2026-05-23T00:10:00.000Z',
      }),
    ).rejects.toThrow(/codex_workspace_bundle_invalid/);
    expect(repository.pendingWorkspaceBundleInputs).toHaveLength(0);
  });

  it('delegates local Codex package execution through a remote runtime job and finalizes terminal evidence through the writer path', async () => {
    const repository = new CapturingWorkspaceBundleRepository();
    const { repo, head } = await createGitRepo();
    const { executionPackage, runSession } = await seedQueuedPackageRun(repository);
    await mkdir(join(repo, 'packages', 'workflow'), { recursive: true });
    await writeFile(join(repo, 'packages', 'workflow', 'src.ts'), 'export const delegated = true;\n');
    await execGit(repo, ['add', '.']);
    await execGit(repo, ['commit', '-m', 'update readme']);
    const [projectRepo] = await repository.listProjectRepos('project-1');
    await repository.saveProjectRepo({
      ...projectRepo!,
      local_path: repo,
      base_commit_sha: head,
      default_branch: 'main',
    });
    await repository.saveRunSession({
      ...runSession,
      executor_type: 'local_codex',
    });
    const createdRuntimeJobs: Record<string, unknown>[] = [];
    const remoteClient: RemoteRunExecutionClient = {
      getStatus: async () => remoteRunExecutionStatusForTest(),
      createRuntimeJob: async (input) => {
        createdRuntimeJobs.push(input);
        return { runtime_job: { id: input.runtime_job_id, status: 'queued' } };
      },
      getRuntimeJob: async (runtimeJobId) => ({
        runtime_job: {
          id: runtimeJobId,
          status: 'terminal',
          terminal_status: 'succeeded',
          terminal_result_json: {
            task_kind: 'run_execution',
            output_schema_version: 'codex_run_execution_result.v1',
            execution_package_id: executionPackage.id,
            execution_package_version: executionPackage.version,
            run_session_id: runSession.id,
            workspace_bundle_digest: repository.pendingWorkspaceBundleInputs[0]!.archive_digest,
            workspace_bundle_manifest_digest: repository.pendingWorkspaceBundleInputs[0]!.manifest_digest,
            mounted_task_workspace_digest: repository.pendingWorkspaceBundleInputs[0]!.manifest_digest,
            changed_files: ['packages/workflow/src.ts'],
            patch_artifact: {
              content_type: 'text/x-diff',
              digest: `sha256:${'e'.repeat(64)}`,
              internal_ref: internalRuntimeArtifactRefForTest(runtimeJobId, 'run_execution_patch'),
            },
            check_results: [],
            execution_artifacts: [],
            public_summary: 'Remote package run completed.',
          },
        },
      }),
    };
    const localDriver = new FakeCodexSessionDriver({
      kind: 'app_server',
      script: [{ kind: 'terminal', status: 'failed', summary: 'local driver should not run' }],
    });
    const worker = runWorker({
      repository,
      driver: localDriver,
      remoteRunExecutionClient: remoteClient,
      now: () => '2026-05-23T00:00:00.000Z',
      heartbeatIntervalMs: 10,
    });

    await worker.drainOnce();

    expect(localDriver.startCalls).toHaveLength(0);
    expect(repository.pendingWorkspaceBundleInputs).toHaveLength(1);
    expect(createdRuntimeJobs).toHaveLength(1);
    const created = createdRuntimeJobs[0]!;
    expect(created).toMatchObject({
      target: {
        target_type: 'run_session',
        target_id: runSession.id,
        target_kind: 'run_execution',
        project_id: 'project-1',
        repo_id: 'repo-1',
      },
      runtime_profile_revision_id: 'profile-rev-run-1',
      credential_binding_id: 'credential-binding-run-1',
      credential_binding_version_id: 'credential-version-run-1',
      credential_payload_digest: `sha256:${'b'.repeat(64)}`,
      execution_package_id: executionPackage.id,
      run_session_id: runSession.id,
      run_worker_lease_id: expect.any(String),
      run_session_status: 'running',
      execution_package_version: executionPackage.version,
      pending_workspace_bundle: expect.objectContaining({
        bundle_id: repository.pendingWorkspaceBundleInputs[0]!.bundle_id,
        archive_digest: repository.pendingWorkspaceBundleInputs[0]!.archive_digest,
      }),
      workspace_acquisition_json: repository.pendingWorkspaceBundleInputs[0]!.workspace_acquisition_json,
    });
    expect(created.input_json).toMatchObject({
      schema_version: 'codex_run_execution_workload.v1',
      run_session_id: runSession.id,
      execution_package_id: executionPackage.id,
      execution_package_version: executionPackage.version,
      workspace_bundle_id: repository.pendingWorkspaceBundleInputs[0]!.bundle_id,
      workspace_bundle_digest: repository.pendingWorkspaceBundleInputs[0]!.archive_digest,
      output_schema_version: 'codex_run_execution_result.v1',
    });
    expect(created.input_json).not.toMatchObject({
      run_worker_lease_id: expect.anything(),
    });
    expect(created.input_json).not.toMatchObject({
      package_prompt: expect.anything(),
      execution_context_json: expect.anything(),
    });
    expect(() => codexRuntimeJobInputDigest(created.input_json)).not.toThrow();
    expect(() => codexWorkspaceAcquisitionDigest(created.workspace_acquisition_json)).not.toThrow();
    expect(JSON.stringify(created)).not.toContain(repo);
    const archive = await readStoredWorkspaceBundleArchive(repository);
    const contextEntry = archive.entries.find((entry) => entry.path === '.forgeloop/codex-runtime/execution-context.json');
    expect(contextEntry?.content_base64).toBeDefined();
    const executionContext = JSON.parse(Buffer.from(contextEntry!.content_base64!, 'base64').toString('utf8')) as Record<string, unknown>;
    expect(codexCanonicalDigest(executionContext)).toBe((created.input_json as Record<string, unknown>).execution_context_digest);
    expect(JSON.stringify(executionContext)).not.toContain(repo);
    expect(await repository.getRunSession(runSession.id)).toMatchObject({
      status: 'succeeded',
      changed_files: [{ repo_id: 'repo-1', path: 'packages/workflow/src.ts', change_kind: 'modified' }],
    });
  });

  it('treats remote run execution terminal results with mismatched workspace manifest evidence as stale', async () => {
    const repository = new CapturingWorkspaceBundleRepository();
    const { repo, head } = await createGitRepo();
    const { executionPackage, runSession } = await seedQueuedPackageRun(repository);
    const [projectRepo] = await repository.listProjectRepos('project-1');
    await repository.saveProjectRepo({
      ...projectRepo!,
      local_path: repo,
      base_commit_sha: head,
      default_branch: 'main',
    });
    await repository.saveRunSession({
      ...runSession,
      executor_type: 'local_codex',
    });
    const remoteClient: RemoteRunExecutionClient = {
      getStatus: async () => remoteRunExecutionStatusForTest(),
      createRuntimeJob: async (input) => ({ runtime_job: { id: input.runtime_job_id, status: 'queued' } }),
      getRuntimeJob: async (runtimeJobId) => ({
        runtime_job: {
          id: runtimeJobId,
          status: 'terminal',
          terminal_status: 'succeeded',
          terminal_result_json: {
            task_kind: 'run_execution',
            output_schema_version: 'codex_run_execution_result.v1',
            execution_package_id: executionPackage.id,
            execution_package_version: executionPackage.version,
            run_session_id: runSession.id,
            workspace_bundle_digest: repository.pendingWorkspaceBundleInputs[0]!.archive_digest,
            workspace_bundle_manifest_digest: `sha256:${'f'.repeat(64)}`,
            mounted_task_workspace_digest: repository.pendingWorkspaceBundleInputs[0]!.manifest_digest,
            changed_files: ['README.md'],
            check_results: [],
            execution_artifacts: [],
            public_summary: 'Remote package run completed.',
          },
        },
      }),
    };
    const worker = runWorker({
      repository,
      driver: new FakeCodexSessionDriver({
        kind: 'app_server',
        script: [{ kind: 'terminal', status: 'failed', summary: 'local driver should not run' }],
      }),
      remoteRunExecutionClient: remoteClient,
      now: () => '2026-05-23T00:00:00.000Z',
      heartbeatIntervalMs: 10,
    });

    await worker.drainOnce();

    const staleRunSession = await repository.getRunSession(runSession.id);
    expect(staleRunSession).toMatchObject({ status: 'running' });
    expect(staleRunSession?.executor_result).toBeUndefined();
    await expect(repository.listRunEvents(runSession.id)).resolves.toContainEqual(
      expect.objectContaining({
        event_type: 'codex_warning',
        summary: 'Remote Codex runtime job terminal result was stale and was not applied.',
      }),
    );
  });

  it('uses the remote run execution wait timeout for pending bundle and runtime job expiry', async () => {
    const repository = new CapturingWorkspaceBundleRepository();
    const { repo, head } = await createGitRepo();
    const { executionPackage, runSession } = await seedQueuedPackageRun(repository);
    await repository.saveProjectRepo({
      ...(await repository.listProjectRepos('project-1'))[0]!,
      local_path: repo,
      base_commit_sha: head,
      default_branch: 'main',
    });
    await repository.saveRunSession({
      ...runSession,
      executor_type: 'local_codex',
    });
    let createdRuntimeJob: Record<string, unknown> | undefined;
    const remoteClient: RemoteRunExecutionClient = {
      getStatus: async () => remoteRunExecutionStatusForTest(),
      createRuntimeJob: async (input) => {
        createdRuntimeJob = input;
        return { runtime_job: { id: input.runtime_job_id, status: 'queued' } };
      },
      getRuntimeJob: async (runtimeJobId) => ({
        runtime_job: {
          id: runtimeJobId,
          status: 'terminal',
          terminal_status: 'succeeded',
          terminal_result_json: {
            task_kind: 'run_execution',
            output_schema_version: 'codex_run_execution_result.v1',
            execution_package_id: executionPackage.id,
            execution_package_version: executionPackage.version,
            run_session_id: runSession.id,
            workspace_bundle_digest: repository.pendingWorkspaceBundleInputs[0]!.archive_digest,
            workspace_bundle_manifest_digest: repository.pendingWorkspaceBundleInputs[0]!.manifest_digest,
            mounted_task_workspace_digest: repository.pendingWorkspaceBundleInputs[0]!.manifest_digest,
            changed_files: ['README.md'],
            patch_artifact: {
              content_type: 'text/x-diff',
              digest: `sha256:${'e'.repeat(64)}`,
              internal_ref: internalRuntimeArtifactRefForTest(runtimeJobId, 'run_execution_patch'),
            },
            check_results: [],
            execution_artifacts: [],
            public_summary: 'Remote package run completed.',
          },
        },
      }),
    };
    const worker = runWorker({
      repository,
      driver: new FakeCodexSessionDriver({
        kind: 'app_server',
        script: [{ kind: 'terminal', status: 'failed', summary: 'local driver should not run' }],
      }),
      remoteRunExecutionClient: remoteClient,
      remoteRunExecutionWaitTimeoutMs: 10 * 60_000,
      leaseDurationMs: 60_000,
      now: () => '2026-05-23T00:00:00.000Z',
    });

    await worker.drainOnce();

    expect(createdRuntimeJob).toMatchObject({
      expires_at: '2026-05-23T00:10:00.000Z',
      input_json: expect.objectContaining({
        expires_at: '2026-05-23T00:10:00.000Z',
      }),
    });
    expect(repository.pendingWorkspaceBundleInputs[0]).toMatchObject({
      expires_at: '2026-05-23T00:10:00.000Z',
    });
  });

  it('reuses the persisted remote runtime job fence when resuming after runtime job creation', async () => {
    const repository = new CapturingWorkspaceBundleRepository();
    const { repo, head } = await createGitRepo();
    const { executionPackage, runSession } = await seedReadyStartedPackageRun(repository);
    const workspacePath = join(repo, '.worktrees', runSession.id);
    await execGit(repo, ['worktree', 'add', '--detach', workspacePath, head]);
    const runtimeJobId = stableUuidFromDigestForTest({
      kind: 'codex_runtime_job',
      run_session_id: runSession.id,
      execution_package_id: executionPackage.id,
      execution_package_version: executionPackage.version,
    });
    const workspaceAcquisitionJson = {
      schema_version: 'workspace_bundle_acquisition.v1',
      bundle_id: `run-worker-workspace-bundle-${runSession.id}`,
      archive_ref: `artifact://internal/workspace_bundle/run_session/${runSession.id}/run-worker-workspace-bundle-${runSession.id}`,
      archive_digest: `sha256:${'c'.repeat(64)}`,
      manifest_digest: `sha256:${'d'.repeat(64)}`,
      size_bytes: 128,
      expires_at: '2026-05-23T00:10:00.000Z',
    };
    const persistedUpdatedAt = '2026-05-23T00:00:00.000Z';
    const activeLease = await repository.claimRunWorkerLease({
      run_session_id: runSession.id,
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now: '2026-05-23T00:00:00.000Z',
      expires_at: '2026-05-23T00:10:00.000Z',
    });
    const runSpec = localCodexRunSpec(runSession.run_spec!, repo, head);
    const persistedPending = await createRunWorkerPendingWorkspaceBundleArtifact({
      repository,
      runSession,
      executionPackage,
      runWorkerLease: activeLease,
      workspacePath,
      bundleId: workspaceAcquisitionJson.bundle_id,
      now: '2026-05-23T00:00:00.000Z',
      expiresAt: workspaceAcquisitionJson.expires_at,
      extraFiles: [
        {
          path: '.forgeloop/codex-runtime/package-prompt.txt',
          content: [`Objective: ${runSpec.objective}`, '', `Package instructions: ${runSpec.context.package_instructions}`].join('\n'),
        },
        {
          path: '.forgeloop/codex-runtime/execution-context.json',
          content: JSON.stringify({
            schema_version: 'codex_run_execution_context.v1',
            run_spec: {
              ...runSpec,
              repo: {
                ...runSpec.repo,
                local_path: '/workspace',
              },
            },
          }),
        },
      ],
    });
    await repository.saveRunSession({
      ...runSession,
      executor_type: 'local_codex',
      run_spec: runSpec,
      updated_at: persistedUpdatedAt,
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        driver_status: 'active',
        workspace_path: workspacePath,
        source_repo_path: repo,
        source_repo_before_status: '',
        source_repo_before_dirty_fingerprint: 'fingerprint-before',
        launch_lease_id: stableUuidFromDigestForTest({ kind: 'codex_launch_lease', runtime_job_id: runtimeJobId }),
        remote_runtime_job_id: runtimeJobId,
        remote_run_worker_lease_id: activeLease.id,
        remote_workspace_bundle_id: persistedPending.pending_workspace_bundle.bundle_id,
        remote_workspace_bundle_digest: persistedPending.archive_digest,
        remote_workspace_manifest_digest: persistedPending.manifest_digest,
        remote_workspace_bundle_size_bytes: persistedPending.size_bytes,
        remote_workspace_bundle_expires_at: persistedPending.pending_workspace_bundle.expires_at,
        remote_workspace_bundle_artifact_record_id: persistedPending.pending_artifact_record.id,
        remote_workspace_bundle_artifact_request_digest: persistedPending.pending_artifact_record.request_digest,
        remote_workspace_bundle_created_at: persistedPending.pending_artifact_record.created_at,
        remote_workspace_internal_artifact_object_id: persistedPending.pending_workspace_bundle.internal_artifact_object_id,
        remote_workspace_acquisition_digest: persistedPending.pending_workspace_bundle.workspace_acquisition_digest,
        remote_workspace_acquisition_json: persistedPending.pending_workspace_bundle.workspace_acquisition_json,
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'confirmed',
      } satisfies RunRuntimeMetadata,
    });
    const createInputs: Record<string, unknown>[] = [];
    const polledRuntimeJobIds: string[] = [];
    const remoteClient: RemoteRunExecutionClient = {
      getStatus: async () => remoteRunExecutionStatusForTest(),
      createRuntimeJob: async (input) => {
        createInputs.push(input);
        return { runtime_job: { id: input.runtime_job_id, status: 'queued' } };
      },
      getRuntimeJob: async (id) => {
        polledRuntimeJobIds.push(id);
        return {
          runtime_job: {
          id,
          status: 'terminal',
          terminal_status: 'failed',
          terminal_reason_code: 'codex_runtime_job_unavailable',
          },
        };
      },
    };
    const worker = new RunWorker({
      repository,
      workerId: 'worker-1',
      driverFactory: () => new FakeCodexSessionDriver({ kind: 'app_server', script: [] }),
      evidenceCollector: async ({ runSpec }) => succeededExecutorResult(runSpec.run_session_id),
      selfReview: async () => succeededSelfReview(),
      remoteRunExecutionClient: remoteClient,
      now: () => '2026-05-23T00:00:00.000Z',
      heartbeatIntervalMs: 10,
    });

    await worker.runOne({
      runSessionId: runSession.id,
      workerId: 'worker-1',
      leaseId: activeLease.id,
      leaseToken: activeLease.lease_token,
    });

    const failedRunSession = await repository.getRunSession(runSession.id);
    expect(failedRunSession?.executor_result).toMatchObject({
      status: 'failed',
      summary: 'codex_runtime_job_unavailable',
      raw_metadata: {
        remote_runtime_job_id: runtimeJobId,
        remote_runtime_reason_code: 'codex_runtime_job_unavailable',
      },
    });
    expect(createInputs).toHaveLength(1);
    expect(createInputs[0]).toMatchObject({
      runtime_job_id: runtimeJobId,
      launch_lease_id: stableUuidFromDigestForTest({ kind: 'codex_launch_lease', runtime_job_id: runtimeJobId }),
      run_session_updated_at: persistedUpdatedAt,
      pending_workspace_bundle: expect.objectContaining({
        bundle_id: persistedPending.pending_workspace_bundle.bundle_id,
        run_worker_lease_id: activeLease.id,
        archive_digest: persistedPending.archive_digest,
        internal_artifact_object_id: persistedPending.pending_workspace_bundle.internal_artifact_object_id,
      }),
    });
    expect(polledRuntimeJobIds).toEqual([runtimeJobId]);
    expect((await repository.getRunSession(runSession.id))?.updated_at).toBe(persistedUpdatedAt);
  });

  it('recreates remote workspace bundle metadata when the persisted runtime job fence no longer matches', async () => {
    const repository = new CapturingWorkspaceBundleRepository();
    const { repo, head } = await createGitRepo();
    const { executionPackage, runSession } = await seedReadyStartedPackageRun(repository);
    const workspacePath = join(repo, '.worktrees', runSession.id);
    await execGit(repo, ['worktree', 'add', '--detach', workspacePath, head]);
    const currentRuntimeJobId = stableUuidFromDigestForTest({
      kind: 'codex_runtime_job',
      run_session_id: runSession.id,
      execution_package_id: executionPackage.id,
      execution_package_version: executionPackage.version,
    });
    const staleRuntimeJobId = stableUuidFromDigestForTest({
      kind: 'codex_runtime_job',
      run_session_id: runSession.id,
      execution_package_id: executionPackage.id,
      execution_package_version: executionPackage.version + 1,
    });
    const staleWorkspaceAcquisitionJson = {
      schema_version: 'workspace_bundle_acquisition.v1',
      bundle_id: `run-worker-workspace-bundle-${runSession.id}`,
      archive_ref: `artifact://internal/workspace_bundle/run_session/${runSession.id}/run-worker-workspace-bundle-${runSession.id}`,
      archive_digest: `sha256:${'c'.repeat(64)}`,
      manifest_digest: `sha256:${'d'.repeat(64)}`,
      size_bytes: 128,
      expires_at: '2026-05-23T00:10:00.000Z',
    };
    await repository.saveRunSession({
      ...runSession,
      executor_type: 'local_codex',
      run_spec: localCodexRunSpec(runSession.run_spec!, repo, head),
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        driver_status: 'active',
        workspace_path: workspacePath,
        source_repo_path: repo,
        source_repo_before_status: '',
        source_repo_before_dirty_fingerprint: 'fingerprint-before',
        launch_lease_id: stableUuidFromDigestForTest({ kind: 'codex_launch_lease', runtime_job_id: staleRuntimeJobId }),
        remote_runtime_job_id: staleRuntimeJobId,
        remote_workspace_bundle_id: staleWorkspaceAcquisitionJson.bundle_id,
        remote_workspace_bundle_digest: staleWorkspaceAcquisitionJson.archive_digest,
        remote_workspace_manifest_digest: staleWorkspaceAcquisitionJson.manifest_digest,
        remote_workspace_bundle_size_bytes: staleWorkspaceAcquisitionJson.size_bytes,
        remote_workspace_bundle_expires_at: staleWorkspaceAcquisitionJson.expires_at,
        remote_workspace_acquisition_digest: codexCanonicalDigest(staleWorkspaceAcquisitionJson),
        remote_workspace_acquisition_json: staleWorkspaceAcquisitionJson,
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'confirmed',
      } satisfies RunRuntimeMetadata,
    });
    const activeLease = await repository.claimRunWorkerLease({
      run_session_id: runSession.id,
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now: '2026-05-23T00:00:00.000Z',
      expires_at: '2026-05-23T00:10:00.000Z',
    });
    const createInputs: Record<string, unknown>[] = [];
    const remoteClient: RemoteRunExecutionClient = {
      getStatus: async () => remoteRunExecutionStatusForTest(),
      createRuntimeJob: async (input) => {
        createInputs.push(input);
        return { runtime_job: { id: input.runtime_job_id, status: 'queued' } };
      },
      getRuntimeJob: async (id) => ({
        runtime_job: {
          id,
          status: 'terminal',
          terminal_status: 'failed',
          terminal_reason_code: 'codex_runtime_job_unavailable',
        },
      }),
    };
    const worker = new RunWorker({
      repository,
      workerId: 'worker-1',
      driverFactory: () => new FakeCodexSessionDriver({ kind: 'app_server', script: [] }),
      evidenceCollector: async ({ runSpec }) => succeededExecutorResult(runSpec.run_session_id),
      selfReview: async () => succeededSelfReview(),
      remoteRunExecutionClient: remoteClient,
      now: () => '2026-05-23T00:00:00.000Z',
      heartbeatIntervalMs: 10,
    });

    await worker.runOne({
      runSessionId: runSession.id,
      workerId: 'worker-1',
      leaseId: activeLease.id,
      leaseToken: activeLease.lease_token,
    });

    expect(repository.pendingWorkspaceBundleInputs).toHaveLength(1);
    expect(createInputs).toHaveLength(1);
    expect(createInputs[0]).toMatchObject({
      runtime_job_id: currentRuntimeJobId,
      launch_lease_id: stableUuidFromDigestForTest({ kind: 'codex_launch_lease', runtime_job_id: currentRuntimeJobId }),
      pending_workspace_bundle: expect.objectContaining({
        archive_digest: repository.pendingWorkspaceBundleInputs[0]!.archive_digest,
      }),
    });
    expect(createInputs[0]).not.toMatchObject({
      pending_workspace_bundle: expect.objectContaining({
        archive_digest: staleWorkspaceAcquisitionJson.archive_digest,
      }),
    });
  });

  it('recreates remote workspace bundle metadata when the persisted bundle lease fence no longer matches', async () => {
    const repository = new CapturingWorkspaceBundleRepository();
    const { repo, head } = await createGitRepo();
    const { executionPackage, runSession } = await seedReadyStartedPackageRun(repository);
    const workspacePath = join(repo, '.worktrees', runSession.id);
    await execGit(repo, ['worktree', 'add', '--detach', workspacePath, head]);
    const runtimeJobId = stableUuidFromDigestForTest({
      kind: 'codex_runtime_job',
      run_session_id: runSession.id,
      execution_package_id: executionPackage.id,
      execution_package_version: executionPackage.version,
    });
    const staleWorkspaceAcquisitionJson = {
      schema_version: 'workspace_bundle_acquisition.v1',
      bundle_id: `run-worker-workspace-bundle-${runSession.id}`,
      archive_ref: `artifact://internal/workspace_bundle/run_session/${runSession.id}/run-worker-workspace-bundle-${runSession.id}`,
      archive_digest: `sha256:${'c'.repeat(64)}`,
      manifest_digest: `sha256:${'d'.repeat(64)}`,
      size_bytes: 128,
      expires_at: '2026-05-23T00:10:00.000Z',
    };
    await repository.saveRunSession({
      ...runSession,
      executor_type: 'local_codex',
      run_spec: localCodexRunSpec(runSession.run_spec!, repo, head),
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        driver_status: 'active',
        workspace_path: workspacePath,
        source_repo_path: repo,
        source_repo_before_status: '',
        source_repo_before_dirty_fingerprint: 'fingerprint-before',
        launch_lease_id: stableUuidFromDigestForTest({ kind: 'codex_launch_lease', runtime_job_id: runtimeJobId }),
        remote_runtime_job_id: runtimeJobId,
        remote_run_worker_lease_id: 'stale-run-worker-lease',
        remote_workspace_bundle_id: staleWorkspaceAcquisitionJson.bundle_id,
        remote_workspace_bundle_digest: staleWorkspaceAcquisitionJson.archive_digest,
        remote_workspace_manifest_digest: staleWorkspaceAcquisitionJson.manifest_digest,
        remote_workspace_bundle_size_bytes: staleWorkspaceAcquisitionJson.size_bytes,
        remote_workspace_bundle_expires_at: staleWorkspaceAcquisitionJson.expires_at,
        remote_workspace_acquisition_digest: codexCanonicalDigest(staleWorkspaceAcquisitionJson),
        remote_workspace_acquisition_json: staleWorkspaceAcquisitionJson,
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'confirmed',
      } satisfies RunRuntimeMetadata,
    });
    const activeLease = await repository.claimRunWorkerLease({
      run_session_id: runSession.id,
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now: '2026-05-23T00:00:00.000Z',
      expires_at: '2026-05-23T00:10:00.000Z',
    });
    const createInputs: Record<string, unknown>[] = [];
    const remoteClient: RemoteRunExecutionClient = {
      getStatus: async () => remoteRunExecutionStatusForTest(),
      createRuntimeJob: async (input) => {
        createInputs.push(input);
        return { runtime_job: { id: input.runtime_job_id, status: 'queued' } };
      },
      getRuntimeJob: async (id) => ({
        runtime_job: {
          id,
          status: 'terminal',
          terminal_status: 'failed',
          terminal_reason_code: 'codex_runtime_job_unavailable',
        },
      }),
    };
    const worker = new RunWorker({
      repository,
      workerId: 'worker-1',
      driverFactory: () => new FakeCodexSessionDriver({ kind: 'app_server', script: [] }),
      evidenceCollector: async ({ runSpec }) => succeededExecutorResult(runSpec.run_session_id),
      selfReview: async () => succeededSelfReview(),
      remoteRunExecutionClient: remoteClient,
      now: () => '2026-05-23T00:00:00.000Z',
      heartbeatIntervalMs: 10,
    });

    await worker.runOne({
      runSessionId: runSession.id,
      workerId: 'worker-1',
      leaseId: activeLease.id,
      leaseToken: activeLease.lease_token,
    });

    expect(repository.pendingWorkspaceBundleInputs).toHaveLength(1);
    expect(createInputs[0]).toMatchObject({
      pending_workspace_bundle: expect.objectContaining({
        run_worker_lease_id: activeLease.id,
        archive_digest: repository.pendingWorkspaceBundleInputs[0]!.archive_digest,
      }),
    });
    expect(createInputs[0]).not.toMatchObject({
      pending_workspace_bundle: expect.objectContaining({
        archive_digest: staleWorkspaceAcquisitionJson.archive_digest,
      }),
    });
  });

  it('replays pending workspace bundle creation after a crash before remote metadata persistence', async () => {
    const repository = new CapturingWorkspaceBundleRepository();
    const { repo, head } = await createGitRepo();
    const { executionPackage, runSession } = await seedReadyStartedPackageRun(repository);
    const workspacePath = join(repo, '.worktrees', runSession.id);
    await execGit(repo, ['worktree', 'add', '--detach', workspacePath, head]);
    const runtimeJobId = stableUuidFromDigestForTest({
      kind: 'codex_runtime_job',
      run_session_id: runSession.id,
      execution_package_id: executionPackage.id,
      execution_package_version: executionPackage.version,
    });
    const activeLease = await repository.claimRunWorkerLease({
      run_session_id: runSession.id,
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now: '2026-05-23T00:00:00.000Z',
      expires_at: '2026-05-23T00:10:00.000Z',
    });
    const runSpec = localCodexRunSpec(runSession.run_spec!, repo, head);
    const stalePending = await createRunWorkerPendingWorkspaceBundleArtifact({
      repository,
      runSession,
      executionPackage,
      runWorkerLease: activeLease,
      workspacePath,
      bundleId: `run-worker-workspace-bundle-${runSession.id}`,
      now: '2026-05-23T00:00:00.000Z',
      expiresAt: '2026-05-23T00:10:00.000Z',
      extraFiles: [
        {
          path: '.forgeloop/codex-runtime/package-prompt.txt',
          content: [`Objective: ${runSpec.objective}`, '', `Package instructions: ${runSpec.context.package_instructions}`].join('\n'),
        },
        {
          path: '.forgeloop/codex-runtime/execution-context.json',
          content: JSON.stringify({
            schema_version: 'codex_run_execution_context.v1',
            run_spec: {
              ...runSpec,
              repo: {
                ...runSpec.repo,
                local_path: '/workspace',
              },
            },
          }),
        },
      ],
    });
    await repository.saveRunSession({
      ...runSession,
      executor_type: 'local_codex',
      run_spec: runSpec,
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        driver_status: 'active',
        workspace_path: workspacePath,
        source_repo_path: repo,
        source_repo_before_status: '',
        source_repo_before_dirty_fingerprint: 'fingerprint-before',
        launch_lease_id: stableUuidFromDigestForTest({ kind: 'codex_launch_lease', runtime_job_id: runtimeJobId }),
        remote_runtime_job_id: runtimeJobId,
        remote_run_worker_lease_id: activeLease.id,
        remote_workspace_bundle_id: stalePending.pending_workspace_bundle.bundle_id,
        remote_workspace_bundle_digest: stalePending.archive_digest,
        remote_workspace_manifest_digest: stalePending.manifest_digest,
        remote_workspace_bundle_size_bytes: stalePending.size_bytes,
        remote_workspace_bundle_expires_at: stalePending.pending_workspace_bundle.expires_at,
        remote_workspace_bundle_artifact_record_id: stalePending.pending_artifact_record.id,
        remote_workspace_bundle_artifact_request_digest: stalePending.pending_artifact_record.request_digest,
        remote_workspace_bundle_created_at: stalePending.pending_artifact_record.created_at,
        remote_workspace_internal_artifact_object_id: stalePending.pending_workspace_bundle.internal_artifact_object_id,
        remote_workspace_acquisition_digest: stalePending.pending_workspace_bundle.workspace_acquisition_digest,
        remote_workspace_acquisition_json: stalePending.pending_workspace_bundle.workspace_acquisition_json,
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'confirmed',
      } satisfies RunRuntimeMetadata,
    });
    const createInputs: Record<string, unknown>[] = [];
    const remoteClient: RemoteRunExecutionClient = {
      getStatus: async () => remoteRunExecutionStatusForTest(),
      createRuntimeJob: async (input) => {
        createInputs.push(input);
        return { runtime_job: { id: input.runtime_job_id, status: 'queued' } };
      },
      getRuntimeJob: async (id) => ({
        runtime_job: {
          id,
          status: 'terminal',
          terminal_status: 'failed',
          terminal_reason_code: 'codex_runtime_job_unavailable',
        },
      }),
    };
    const worker = new RunWorker({
      repository,
      workerId: 'worker-1',
      driverFactory: () => new FakeCodexSessionDriver({ kind: 'app_server', script: [] }),
      evidenceCollector: async ({ runSpec }) => succeededExecutorResult(runSpec.run_session_id),
      selfReview: async () => succeededSelfReview(),
      remoteRunExecutionClient: remoteClient,
      now: () => '2026-05-23T00:00:00.000Z',
      heartbeatIntervalMs: 10,
    });

    await worker.runOne({
      runSessionId: runSession.id,
      workerId: 'worker-1',
      leaseId: activeLease.id,
      leaseToken: activeLease.lease_token,
    });

    expect(createInputs).toHaveLength(1);
    expect(createInputs[0]).toMatchObject({
      runtime_job_id: runtimeJobId,
      pending_workspace_bundle: expect.objectContaining({
        bundle_id: stalePending.pending_workspace_bundle.bundle_id,
        run_worker_lease_id: activeLease.id,
        internal_artifact_object_id: stalePending.pending_workspace_bundle.internal_artifact_object_id,
      }),
    });
    expect((createInputs[0]!.pending_workspace_bundle as Record<string, unknown>).archive_digest).toBe(stalePending.archive_digest);
  });

  it('maps run-session cancel commands to remote runtime job cancellation while waiting for terminal result', async () => {
    const repository = new CapturingWorkspaceBundleRepository();
    const { repo, head } = await createGitRepo();
    const { executionPackage, runSession } = await seedQueuedPackageRun(repository);
    const [projectRepo] = await repository.listProjectRepos('project-1');
    await repository.saveProjectRepo({
      ...projectRepo!,
      local_path: repo,
      base_commit_sha: head,
      default_branch: 'main',
    });
    await repository.saveRunSession({
      ...runSession,
      executor_type: 'local_codex',
    });
    const runtimeJobId = stableUuidFromDigestForTest({
      kind: 'codex_runtime_job',
      run_session_id: runSession.id,
      execution_package_id: executionPackage.id,
      execution_package_version: executionPackage.version,
    });
    const cancelRuntimeJobIds: string[] = [];
    const remoteClient: RemoteRunExecutionClient = {
      getStatus: async () => remoteRunExecutionStatusForTest(),
      createRuntimeJob: async (input) => ({ runtime_job: { id: input.runtime_job_id, status: 'queued' } }),
      getRuntimeJob: async () => new Promise<never>(() => undefined),
      cancelRuntimeJob: async (id) => {
        cancelRuntimeJobIds.push(id);
        return { id, status: 'terminal', terminal_status: 'cancelled' };
      },
    };
    const worker = runWorker({
      repository,
      driver: new FakeCodexSessionDriver({ kind: 'app_server', script: [] }),
      remoteRunExecutionClient: remoteClient,
      now: () => '2026-05-23T00:00:00.000Z',
      heartbeatIntervalMs: 10,
      commandPollIntervalMs: 10,
    });

    const pending = worker.drainOnce();
    await delay(30);
    await repository.saveRunCommand({
      id: 'run-command:remote-cancel',
      run_session_id: runSession.id,
      command_type: 'cancel',
      status: 'pending',
      actor_id: 'actor-owner',
      payload: {},
      created_at: '2026-05-23T00:00:00.000Z',
      updated_at: '2026-05-23T00:00:00.000Z',
    });

    await expect(Promise.race([pending, delay(500).then(() => 'timeout')])).resolves.not.toBe('timeout');

    expect(cancelRuntimeJobIds).toContain(runtimeJobId);
    expect(await repository.getRunSession(runSession.id)).toMatchObject({
      status: 'cancelled',
    });
  });

  it('uses exec fallback when app-server emits a fallback event after initial progress', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedQueuedPackageRun(repository);
    const appServerDriver = new FakeCodexSessionDriver({
      kind: 'app_server',
      deferStartUntilIteration: true,
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'thread_started',
            source: 'codex',
            visibility: 'public',
            summary: 'App-server started a thread.',
            payload: { thread_id: 'thread-app-server' },
          },
          runtimeMetadata: {
            driver_kind: 'app_server',
            driver_status: 'active',
            codex_thread_id: 'thread-app-server',
            effective_dangerous_mode: 'confirmed',
          },
        },
        {
          kind: 'event',
          event: {
            event_type: 'driver_fallback_used',
            source: 'executor',
            visibility: 'public',
            summary: 'Codex app-server turn failed; fallback is required.',
            payload: { reason: 'turn/start failed' },
          },
          runtimeMetadata: {
            driver_kind: 'exec_fallback',
            driver_status: 'starting',
          },
        },
      ],
    });
    const execFallbackDriver = new FakeCodexSessionDriver({
      kind: 'exec_fallback',
      deferStartUntilIteration: true,
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'thread_started',
            source: 'codex',
            visibility: 'public',
            summary: 'Exec fallback started thread.',
            payload: { thread_id: 'thread-fallback' },
          },
          runtimeMetadata: {
            driver_kind: 'exec_fallback',
            driver_status: 'active',
            codex_thread_id: 'thread-fallback',
            effective_dangerous_mode: 'confirmed',
          },
        },
        { kind: 'terminal', status: 'succeeded', summary: 'Exec fallback completed.' },
      ],
    });
    const worker = new RunWorker({
      repository,
      workerId: 'worker-1',
      driverFactory: () => appServerDriver,
      execFallbackDriverFactory: () => execFallbackDriver,
      evidenceCollector: async ({ runSpec }) => ({
        ...succeededExecutorResult(runSpec.run_session_id),
        executor_type: runSpec.executor_type,
      }),
      selfReview: async () => succeededSelfReview(),
      now: () => new Date().toISOString(),
      heartbeatIntervalMs: 10,
      commandPollIntervalMs: 10,
      leaseDurationMs: 60_000,
      idleThresholdMs: 30_000,
    });

    await worker.drainOnce();

    expect(appServerDriver.startCalls).toHaveLength(1);
    expect(execFallbackDriver.startCalls).toHaveLength(1);
    expect(await repository.getRunSession(runSession.id)).toMatchObject({
      status: 'succeeded',
      runtime_metadata: expect.objectContaining({
        selected_execution_mode: 'exec_fallback',
        app_server_fallback_reason: 'turn/start failed',
      }),
    });
  });

  it('closes the app-server driver after switching to exec fallback', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedQueuedPackageRun(repository);
    let appServerCloseCalls = 0;
    const appServerDriver: CodexSessionDriver & { close(): Promise<void> } = {
      kind: 'app_server',
      startRun: async function* (input) {
        expect(input.runSpec.run_session_id).toBe(runSession.id);
        yield {
          kind: 'event',
          event: {
            event_type: 'thread_started',
            source: 'codex',
            visibility: 'public',
            summary: 'App-server started a thread.',
            payload: { thread_id: 'thread-app-server' },
          },
          runtimeMetadata: {
            driver_kind: 'app_server',
            driver_status: 'active',
            codex_thread_id: 'thread-app-server',
            effective_dangerous_mode: 'confirmed',
          },
        };
        yield {
          kind: 'event',
          event: {
            event_type: 'driver_fallback_used',
            source: 'executor',
            visibility: 'public',
            summary: 'Codex app-server turn failed; fallback is required.',
            payload: { reason: 'turn/start failed' },
          },
          runtimeMetadata: {
            driver_kind: 'exec_fallback',
            driver_status: 'starting',
          },
        };
      },
      resumeRun: async function* () {
        throw new Error('resume should not be called');
      },
      sendInput: async () => ({}),
      cancelRun: async () => ({}),
      close: async () => {
        appServerCloseCalls += 1;
      },
    };
    const execFallbackDriver = new FakeCodexSessionDriver({
      kind: 'exec_fallback',
      deferStartUntilIteration: true,
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'thread_started',
            source: 'codex',
            visibility: 'public',
            summary: 'Exec fallback started thread.',
            payload: { thread_id: 'thread-fallback' },
          },
          runtimeMetadata: {
            driver_kind: 'exec_fallback',
            driver_status: 'active',
            codex_thread_id: 'thread-fallback',
            effective_dangerous_mode: 'confirmed',
          },
        },
        { kind: 'terminal', status: 'succeeded', summary: 'Exec fallback completed.' },
      ],
    });
    const worker = new RunWorker({
      repository,
      workerId: 'worker-1',
      driverFactory: () => appServerDriver,
      execFallbackDriverFactory: () => execFallbackDriver,
      evidenceCollector: async ({ runSpec }) => ({
        ...succeededExecutorResult(runSpec.run_session_id),
        executor_type: runSpec.executor_type,
      }),
      selfReview: async () => succeededSelfReview(),
      now: () => new Date().toISOString(),
      heartbeatIntervalMs: 10,
      commandPollIntervalMs: 10,
      leaseDurationMs: 60_000,
      idleThresholdMs: 30_000,
    });

    await worker.drainOnce();

    expect(appServerCloseCalls).toBe(1);
    expect(await repository.getRunSession(runSession.id)).toMatchObject({
      status: 'succeeded',
      runtime_metadata: expect.objectContaining({
        selected_execution_mode: 'exec_fallback',
      }),
    });
  });

  it('uses exec fallback when app-server emits a failed terminal after initial progress', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedQueuedPackageRun(repository);
    const appServerDriver = new FakeCodexSessionDriver({
      kind: 'app_server',
      deferStartUntilIteration: true,
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'thread_started',
            source: 'codex',
            visibility: 'public',
            summary: 'App-server started a thread.',
            payload: { thread_id: 'thread-app-server' },
          },
          runtimeMetadata: {
            driver_kind: 'app_server',
            driver_status: 'active',
            codex_thread_id: 'thread-app-server',
            effective_dangerous_mode: 'confirmed',
          },
        },
        {
          kind: 'terminal',
          status: 'failed',
          summary: 'Codex app-server thread became idle before turn completion.',
          failure: {
            kind: 'executor_error',
            message: 'Codex app-server reported an idle thread before turn/completed.',
            retryable: true,
          },
        },
      ],
    });
    const execFallbackDriver = new FakeCodexSessionDriver({
      kind: 'exec_fallback',
      deferStartUntilIteration: true,
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'thread_started',
            source: 'codex',
            visibility: 'public',
            summary: 'Exec fallback started thread.',
            payload: { thread_id: 'thread-fallback' },
          },
          runtimeMetadata: {
            driver_kind: 'exec_fallback',
            driver_status: 'active',
            codex_thread_id: 'thread-fallback',
            effective_dangerous_mode: 'confirmed',
          },
        },
        { kind: 'terminal', status: 'succeeded', summary: 'Exec fallback completed.' },
      ],
    });
    const worker = new RunWorker({
      repository,
      workerId: 'worker-1',
      driverFactory: () => appServerDriver,
      execFallbackDriverFactory: () => execFallbackDriver,
      evidenceCollector: async ({ runSpec }) => ({
        ...succeededExecutorResult(runSpec.run_session_id),
        executor_type: runSpec.executor_type,
      }),
      selfReview: async () => succeededSelfReview(),
      now: () => new Date().toISOString(),
      heartbeatIntervalMs: 10,
      commandPollIntervalMs: 10,
      leaseDurationMs: 60_000,
      idleThresholdMs: 30_000,
    });

    await worker.drainOnce();

    expect(appServerDriver.startCalls).toHaveLength(1);
    expect(execFallbackDriver.startCalls).toHaveLength(1);
    expect(await repository.getRunSession(runSession.id)).toMatchObject({
      status: 'succeeded',
      runtime_metadata: expect.objectContaining({
        selected_execution_mode: 'exec_fallback',
        app_server_fallback_reason: 'Codex app-server thread became idle before turn completion.',
      }),
    });
  });

  it('resumes a dirty local Codex worktree instead of rejecting it before recovery', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { repo, head } = await createGitRepo();
    const { runSession } = await seedReadyStartedPackageRun(repository);
    const workspacePath = join(repo, '.worktrees', runSession.id);
    await execGit(repo, ['worktree', 'add', '--detach', workspacePath, head]);
    await writeFile(join(workspacePath, 'README.md'), '# Dirty Recovery Worktree\n');
    await repository.saveRunSession({
      ...runSession,
      executor_type: 'local_codex',
      run_spec: localCodexRunSpec(runSession.run_spec!, repo, head),
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        driver_status: 'active',
        workspace_path: workspacePath,
        source_repo_path: repo,
        source_repo_before_status: '',
        source_repo_before_dirty_fingerprint: 'fingerprint-before',
        codex_thread_id: 'thread-existing',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'confirmed',
      } satisfies RunRuntimeMetadata,
    });
    const appServerDriver = new FakeCodexSessionDriver({
      kind: 'app_server',
      deferResumeUntilIteration: true,
      script: [{ kind: 'terminal', status: 'succeeded', summary: 'Recovered app-server turn completed.' }],
    });
    const worker = runWorker({
      repository,
      driver: appServerDriver,
      evidenceCollector: async ({ runSpec }) => ({
        ...succeededExecutorResult(runSpec.run_session_id),
        executor_type: 'local_codex',
      }),
    });

    await worker.drainOnce();

    expect(appServerDriver.resumeCalls[0]?.workspacePath).toBe(workspacePath);
    expect(await repository.getRunSession(runSession.id)).toMatchObject({
      status: 'succeeded',
    });
  });

  it('starts exec fallback when recovery has no persisted Codex thread id', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { repo, head } = await createGitRepo();
    const { runSession } = await seedReadyStartedPackageRun(repository);
    const workspacePath = join(repo, '.worktrees', runSession.id);
    await execGit(repo, ['worktree', 'add', '--detach', workspacePath, head]);
    await repository.saveRunSession({
      ...runSession,
      executor_type: 'local_codex',
      run_spec: localCodexRunSpec(runSession.run_spec!, repo, head),
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        driver_status: 'active',
        workspace_path: workspacePath,
        source_repo_path: repo,
        source_repo_before_status: '',
        source_repo_before_dirty_fingerprint: 'fingerprint-before',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'confirmed',
      } satisfies RunRuntimeMetadata,
    });
    const appServerDriver = new FakeCodexSessionDriver({
      kind: 'app_server',
      deferResumeUntilIteration: true,
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'driver_fallback_used',
            source: 'executor',
            visibility: 'public',
            summary: 'Codex app-server resume requires a thread id; fallback is required.',
            payload: {},
          },
          runtimeMetadata: {
            driver_kind: 'exec_fallback',
            driver_status: 'starting',
          },
        },
      ],
    });
    const execFallbackDriver = new FakeCodexSessionDriver({
      kind: 'exec_fallback',
      deferStartUntilIteration: true,
      script: [{ kind: 'terminal', status: 'succeeded', summary: 'Exec fallback restarted.' }],
    });
    const worker = new RunWorker({
      repository,
      workerId: 'worker-1',
      driverFactory: () => appServerDriver,
      execFallbackDriverFactory: () => execFallbackDriver,
      evidenceCollector: async ({ runSpec }) => ({
        ...succeededExecutorResult(runSpec.run_session_id),
        executor_type: 'local_codex',
      }),
      selfReview: async () => succeededSelfReview(),
      now: () => new Date().toISOString(),
      heartbeatIntervalMs: 10,
      commandPollIntervalMs: 10,
      leaseDurationMs: 60_000,
      idleThresholdMs: 30_000,
    });

    await worker.drainOnce();

    expect(execFallbackDriver.startCalls).toHaveLength(1);
    expect(execFallbackDriver.resumeCalls).toHaveLength(0);
    expect(await repository.getRunSession(runSession.id)).toMatchObject({
      status: 'succeeded',
      runtime_metadata: expect.objectContaining({
        selected_execution_mode: 'exec_fallback',
      }),
    });
  });

  it('preserves fallback metadata when recovery fallback stalls', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedReadyStartedPackageRun(repository);
    await repository.saveRunSession({
      ...runSession,
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        driver_status: 'active',
        codex_thread_id: 'thread-existing',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'confirmed',
      } satisfies RunRuntimeMetadata,
    });
    const appServerDriver = new FakeCodexSessionDriver({
      kind: 'app_server',
      deferResumeUntilIteration: true,
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'driver_fallback_used',
            source: 'executor',
            visibility: 'public',
            summary: 'Codex app-server resume failed; fallback is required.',
            payload: { reason: 'thread/resume failed' },
          },
          runtimeMetadata: { driver_kind: 'exec_fallback', driver_status: 'starting' },
        },
      ],
    });
    const execFallbackDriver = new FakeCodexSessionDriver({
      kind: 'exec_fallback',
      deferResumeUntilIteration: true,
      script: [
        {
          kind: 'terminal',
          status: 'failed',
          summary: 'Exec fallback resume failed.',
          failure: { kind: 'executor_error', message: 'exec resume unavailable', retryable: true },
        },
      ],
    });
    const worker = new RunWorker({
      repository,
      workerId: 'worker-1',
      driverFactory: () => appServerDriver,
      execFallbackDriverFactory: () => execFallbackDriver,
      evidenceCollector: async ({ runSpec }) => succeededExecutorResult(runSpec.run_session_id),
      selfReview: async () => succeededSelfReview(),
      now: () => new Date().toISOString(),
      heartbeatIntervalMs: 10,
      commandPollIntervalMs: 10,
      leaseDurationMs: 60_000,
      idleThresholdMs: 30_000,
    });

    await worker.drainOnce();

    expect(await repository.getRunSession(runSession.id)).toMatchObject({
      status: 'stalled',
      runtime_metadata: expect.objectContaining({
        selected_execution_mode: 'exec_fallback',
        app_server_fallback_reason: 'thread/resume failed',
        exec_fallback_dangerous_bypass: true,
      }),
    });
  });

  it('stalls local Codex finalization instead of late-snapshotting when pre-run source snapshot is missing', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { repo, head } = await createGitRepo();
    const { runSession } = await seedReadyStartedPackageRun(repository);
    let evidenceCalled = false;
    await repository.saveRunSession({
      ...runSession,
      executor_type: 'local_codex',
      run_spec: localCodexRunSpec(runSession.run_spec!, repo, head),
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        driver_status: 'active',
        workspace_path: repo,
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'confirmed',
      } satisfies RunRuntimeMetadata,
    });
    const driver = new FakeCodexSessionDriver({
      kind: 'fake',
      script: [{ kind: 'terminal', status: 'succeeded', summary: 'Terminal without source snapshot.' }],
    });
    const worker = runWorker({
      repository,
      driver,
      evidenceCollector: async ({ runSpec }) => {
        evidenceCalled = true;
        return succeededExecutorResult(runSpec.run_session_id);
      },
    });

    await worker.drainOnce();

    expect(evidenceCalled).toBe(false);
    expect(await repository.getRunSession(runSession.id)).toMatchObject({
      status: 'stalled',
      summary: 'Driver recovery failed.',
    });
  });

  it('finalizes start fallback terminal failure instead of leaving the run stalled', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedQueuedPackageRun(repository);
    const appServerDriver = new FakeCodexSessionDriver({
      kind: 'app_server',
      deferStartUntilIteration: true,
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'driver_fallback_used',
            source: 'executor',
            visibility: 'public',
            summary: 'Codex app-server failed preflight; fallback is required.',
            payload: { reason: 'app-server connection refused' },
          },
          runtimeMetadata: {
            driver_kind: 'exec_fallback',
            driver_status: 'starting',
          },
        },
      ],
    });
    const execFallbackDriver = new FakeCodexSessionDriver({
      kind: 'exec_fallback',
      deferStartUntilIteration: true,
      script: [
        {
          kind: 'terminal',
          status: 'failed',
          summary: 'Exec fallback failed.',
          failure: { kind: 'executor_error', message: 'codex exec failed', retryable: true },
        },
      ],
    });
    const worker = new RunWorker({
      repository,
      workerId: 'worker-1',
      driverFactory: () => appServerDriver,
      execFallbackDriverFactory: () => execFallbackDriver,
      evidenceCollector: async ({ runSpec }) => ({
        ...succeededExecutorResult(runSpec.run_session_id),
        executor_type: runSpec.executor_type,
      }),
      selfReview: async () => succeededSelfReview(),
      now: () => new Date().toISOString(),
      heartbeatIntervalMs: 10,
      commandPollIntervalMs: 10,
      leaseDurationMs: 60_000,
      idleThresholdMs: 30_000,
    });

    await worker.drainOnce();

    expect(execFallbackDriver.startCalls).toHaveLength(1);
    expect(await repository.getRunSession(runSession.id)).toMatchObject({
      status: 'failed',
      summary: 'Exec fallback failed.',
      failure_kind: 'executor_error',
    });
  });

  it.each([
    ['runtime_hard_limits_unavailable', 'Runtime hard limits are unavailable.', true],
    ['fallback_denied_by_policy', 'Executor fallback is denied by policy.', false],
  ] as const)('preserves %s as a runtime blocker from failed local Codex terminals', async (code, publicSummary, retryable) => {
    const repository = new InMemoryDeliveryRepository();
    const { repo, head } = await createGitRepo();
    const { runSession } = await seedReadyStartedPackageRun(repository);
    await repository.saveRunSession({
      ...runSession,
      executor_type: 'local_codex',
      run_spec: localCodexRunSpec(runSession.run_spec!, repo, head),
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'exec_fallback',
        driver_status: 'active',
        workspace_path: repo,
        source_repo_path: repo,
        source_repo_before_status: '',
        source_repo_before_dirty_fingerprint: 'fingerprint-before',
        codex_thread_id: 'thread-existing',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'confirmed',
      } satisfies RunRuntimeMetadata,
    });
    const driver = new FakeCodexSessionDriver({
      kind: 'exec_fallback',
      deferResumeUntilIteration: true,
      script: [
        {
          kind: 'terminal',
          status: 'failed',
          summary: 'Local Codex terminal failed before producing runtime evidence.',
          failure: {
            kind: 'executor_error',
            message: `${code}: injected runtime safety failure`,
            retryable,
          },
        },
      ],
    });
    const worker = runWorker({ repository, driver });

    await worker.drainOnce();

    const finalized = await repository.getRunSession(runSession.id);
    expect(finalized).toMatchObject({
      status: 'failed',
      executor_result: {
        raw_metadata: {
          runtime_finalization: {
            runtime_blockers: [{ code, summary: publicSummary, retryable }],
          },
        },
      },
    });
    expect(finalized?.failure_kind).toBe('path_violation');
    expect(finalized?.failure_reason).toBe(publicSummary);
  });

  it('watchdog stalls a long active stream when Codex activity goes stale', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedReadyStartedPackageRun(repository);
    let currentTime = Date.parse('2026-05-08T00:00:00.000Z');
    await repository.saveRunSession({
      ...runSession,
      runtime_metadata: {
        ...runSession.runtime_metadata!,
        driver_kind: 'fake',
        driver_status: 'active',
        last_event_at: new Date(currentTime).toISOString(),
      },
    });
    const driver = new FakeCodexSessionDriver({
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'driver_started',
            source: 'codex',
            visibility: 'public',
            summary: 'Driver resumed.',
            payload: {},
          },
        },
      ],
      neverCompletesUntilWatchdog: true,
    });
    const worker = runWorker({
      repository,
      driver,
      heartbeatIntervalMs: 5,
      commandPollIntervalMs: 5,
      idleThresholdMs: 10_000,
      now: () => new Date(currentTime).toISOString(),
    });

    const pending = worker.drainOnce();
    await delay(15);
    currentTime += 20_000;
    await expect(Promise.race([pending, delay(500).then(() => 'timeout')])).resolves.not.toBe('timeout');

    expect(await repository.getRunSession(runSession.id)).toMatchObject({
      status: 'stalled',
      summary: 'Codex activity stalled.',
    });
  });

  it('stalls and releases lease when driver stream ends without terminal', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedReadyStartedPackageRun(repository);
    const driver = new FakeCodexSessionDriver({
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'driver_started',
            source: 'codex',
            visibility: 'public',
            summary: 'Driver resumed.',
            payload: {},
          },
        },
      ],
    });
    const worker = runWorker({ repository, driver });

    await worker.drainOnce();

    expect(await repository.getRunSession(runSession.id)).toMatchObject({
      status: 'stalled',
      summary: 'Driver stream ended before terminal completion.',
    });
    expect(await repository.getRunWorkerLease(runSession.id)).toMatchObject({
      status: 'released',
      worker_id: 'worker-1',
    });
    expect((await repository.listRunEvents(runSession.id)).map((event) => event.event_type)).toContain('stalled');
  });

  it('watchdog interrupts a stream stuck before the first item', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { runSession } = await seedReadyStartedPackageRun(repository);
    let currentTime = Date.parse('2026-05-08T00:00:00.000Z');
    await repository.saveRunSession({
      ...runSession,
      runtime_metadata: {
        ...runSession.runtime_metadata!,
        driver_kind: 'fake',
        driver_status: 'active',
        last_event_at: new Date(currentTime).toISOString(),
      },
    });
    const driver = new FakeCodexSessionDriver({
      script: [
        { kind: 'delay', ms: 1_000 },
        {
          kind: 'terminal',
          status: 'succeeded',
          summary: 'Should not wait for this.',
        },
      ],
    });
    const worker = runWorker({
      repository,
      driver,
      heartbeatIntervalMs: 5,
      idleThresholdMs: 10_000,
      now: () => new Date(currentTime).toISOString(),
    });

    const pending = worker.drainOnce();
    await delay(15);
    currentTime += 20_000;

    await expect(Promise.race([pending, delay(300).then(() => 'timeout')])).resolves.not.toBe('timeout');
    expect(await repository.getRunSession(runSession.id)).toMatchObject({
      status: 'stalled',
      summary: 'Codex activity stalled.',
    });
    expect(await repository.getRunWorkerLease(runSession.id)).toMatchObject({ status: 'released' });
  });

  it('stalls and releases lease when priming is stopped before the first item', async () => {
    const repository = new FailingHeartbeatRepository();
    const { runSession } = await seedReadyStartedPackageRun(repository);
    const driver = new FakeCodexSessionDriver({
      script: [
        { kind: 'delay', ms: 1_000 },
        {
          kind: 'terminal',
          status: 'succeeded',
          summary: 'Should not wait for this.',
        },
      ],
    });
    const worker = runWorker({
      repository,
      driver,
      heartbeatIntervalMs: 5,
      idleThresholdMs: 30_000,
    });

    await expect(Promise.race([worker.drainOnce(), delay(300).then(() => 'timeout')])).resolves.not.toBe('timeout');

    expect(await repository.getRunSession(runSession.id)).toMatchObject({
      status: 'stalled',
      summary: 'Worker stopped before terminal completion.',
    });
    expect(await repository.getRunWorkerLease(runSession.id)).toMatchObject({
      status: 'released',
      worker_id: 'worker-1',
    });
  });

  it('preserves primed runtime metadata when stop path stalls before terminal completion', async () => {
    const repository = new FailingHeartbeatRepository();
    const { runSession } = await seedReadyStartedPackageRun(repository);
    await repository.saveRunSession({
      ...runSession,
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        driver_status: 'active',
        codex_thread_id: 'thread-original',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'confirmed',
      } satisfies RunRuntimeMetadata,
    });
    const driver = new FakeCodexSessionDriver({
      kind: 'app_server',
      script: [
        {
          kind: 'event',
          event: {
            event_type: 'driver_fallback_used',
            source: 'executor',
            visibility: 'public',
            summary: 'App-server recovery requested fallback.',
            payload: {},
          },
          runtimeMetadata: {
            driver_kind: 'exec_fallback',
            driver_status: 'starting',
            codex_thread_id: 'thread-primed',
            active_turn_id: 'turn-primed',
          },
        },
        { kind: 'delay', ms: 1_000 },
        { kind: 'terminal', status: 'succeeded', summary: 'Should not complete.' },
      ],
    });
    const worker = runWorker({
      repository,
      driver,
      heartbeatIntervalMs: 5,
      idleThresholdMs: 30_000,
    });

    await expect(Promise.race([worker.drainOnce(), delay(300).then(() => 'timeout')])).resolves.not.toBe('timeout');

    expect(await repository.getRunSession(runSession.id)).toMatchObject({
      status: 'stalled',
      summary: 'Worker stopped before terminal completion.',
      runtime_metadata: expect.objectContaining({
        driver_kind: 'exec_fallback',
        codex_thread_id: 'thread-primed',
        active_turn_id: 'turn-primed',
      }),
    });
    expect(await repository.getRunWorkerLease(runSession.id)).toMatchObject({ status: 'released' });
  });
});
