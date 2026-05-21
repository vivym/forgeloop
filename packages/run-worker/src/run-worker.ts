import type { ExecutorFailure, ExecutorResult, SelfReviewInput, SelfReviewResult } from '@forgeloop/contracts';
import type { DeliveryRepository } from '../../db/src/index.js';
import type { RunRuntimeMetadata, RunSession } from '../../domain/src/index.js';
import type {
  CodexDriverStreamItem,
  CodexSessionDriver,
  LocalCodexEvidenceInput,
  LocalCodexEnvironment,
  SourceRepoSnapshot,
} from '../../executor/src/index.js';
import { createDefaultLocalCodexEnvironment, createLocalCodexCheckEnv, snapshotSourceRepoStatus } from '../../executor/src/index.js';
import {
  buildAndStartPackageRun,
  completePackageRunReviewFinalization,
  finalizePackageRunWithExecutorResult,
  terminalizePackageRunWithRuntimeEvidence,
  type RuntimeFinalizationEvidence,
  type RuntimeSafetyBlocker,
  type TerminalizedRunResult,
} from '../../workflow/src/index.js';

import { applyPendingRunCommands } from './command-inbox.js';
import { acquireLeaseForRun, heartbeatLease, releaseLease } from './lease.js';
import { evaluateRunProgress } from './watchdog.js';

type IsoDateTime = string;

export interface RunWorkerDriverFactoryInput {
  runSession: RunSession;
  runtimeMetadata: RunRuntimeMetadata;
  workerLease: {
    workerId: string;
    runSessionId: string;
    leaseId?: string;
    leaseToken: string;
  };
}

export interface RunWorkerInput {
  repository: DeliveryRepository;
  workerId: string;
  driverFactory: (input: RunWorkerDriverFactoryInput) => CodexSessionDriver;
  execFallbackDriverFactory?: (input: RunWorkerDriverFactoryInput) => CodexSessionDriver;
  evidenceCollector: (input: LocalCodexEvidenceInput) => Promise<ExecutorResult>;
  selfReview: (input: SelfReviewInput) => Promise<SelfReviewResult>;
  now?: () => IsoDateTime;
  heartbeatIntervalMs?: number;
  commandPollIntervalMs?: number;
  leaseDurationMs?: number;
  idleThresholdMs?: number;
  artifactRoot?: string;
  allowExecFallback?: boolean;
}

interface OwnedRun {
  runSessionId: string;
  workerId: string;
  leaseId?: string;
  leaseToken: string;
}

interface RunControl {
  stopped: boolean;
  stalled: boolean;
  failure?: unknown;
  stoppedPromise: Promise<void>;
  stop: () => void;
  fail: (error: unknown) => void;
  stall: () => void;
  cancelStream?: () => Promise<void> | void;
}

interface OpenedDriverStream {
  driver: CodexSessionDriver;
  runtimeMetadata: RunRuntimeMetadata;
  stream: AsyncIterable<CodexDriverStreamItem>;
  isRecoveryFallback?: boolean;
}

interface PrimedDriverStream {
  driver: CodexSessionDriver;
  runtimeMetadata: RunRuntimeMetadata;
  iterator: AsyncIterator<CodexDriverStreamItem>;
  currentRunSession: RunSession;
  isRecoveryFallback?: boolean;
  firstTerminal?: Extract<CodexDriverStreamItem, { kind: 'terminal' }>;
  stalled?: boolean;
}

type TerminalStreamItem = Extract<CodexDriverStreamItem, { kind: 'terminal' }>;

type ConsumeStreamResult =
  | { kind: 'terminal'; terminal: TerminalStreamItem }
  | { kind: 'switched'; stream: PrimedDriverStream }
  | { kind: 'ended'; currentRunSession: RunSession };

const terminalStatuses = new Set<RunSession['status']>(['succeeded', 'failed', 'timed_out', 'cancelled']);
const nowIso = () => new Date().toISOString();
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isFallbackRequiredEvent = (item: CodexDriverStreamItem): boolean =>
  item.kind === 'event' &&
  item.event.event_type === 'driver_fallback_used' &&
  item.runtimeMetadata?.driver_kind === 'exec_fallback';

const fallbackReason = (reason: unknown): string => {
  if (typeof reason === 'string') {
    return reason;
  }
  if (reason instanceof Error) {
    return reason.message;
  }
  if (reason !== null && typeof reason === 'object' && 'summary' in reason && typeof reason.summary === 'string') {
    return reason.summary;
  }
  return String(reason);
};

const fallbackReasonFromEvent = (item: Extract<CodexDriverStreamItem, { kind: 'event' }>): string =>
  typeof item.event.payload?.reason === 'string' ? item.event.payload.reason : item.event.summary;

const runtimeSafetyFailureSummaries = {
  runtime_policy_invalid: 'Runtime policy is invalid.',
  runtime_hard_limits_unavailable: 'Runtime hard limits are unavailable.',
  sandbox_isolation_unavailable: 'Sandbox isolation is unavailable.',
  runtime_attestation_invalid: 'Runtime safety attestation is invalid.',
  primary_executor_governor_unavailable: 'Primary executor governor is unavailable.',
  fallback_denied_by_policy: 'Executor fallback is denied by policy.',
  artifact_visibility_denied: 'Artifact visibility policy denied public projection.',
} as const;

type RuntimeSafetyFailureCode = keyof typeof runtimeSafetyFailureSummaries;

const runtimeSafetyFailureCodePatterns: Array<[RuntimeSafetyFailureCode, RegExp]> = Object.keys(runtimeSafetyFailureSummaries).map(
  (code) => [code as RuntimeSafetyFailureCode, new RegExp(`(?:^|[^A-Za-z0-9_])${code}(?:$|[^A-Za-z0-9_])`)],
);

const baseRuntimeMetadata = (runSession: RunSession, workerId: string): RunRuntimeMetadata => ({
  durability_mode: runSession.runtime_metadata?.durability_mode ?? 'durable',
  recovery_attempt_count: runSession.runtime_metadata?.recovery_attempt_count ?? 0,
  effective_dangerous_mode: runSession.runtime_metadata?.effective_dangerous_mode ?? 'not_requested',
  ...runSession.runtime_metadata,
  worker_id: workerId,
});

const mergeMetadata = (
  runSession: RunSession,
  workerId: string,
  update: Partial<RunRuntimeMetadata> = {},
): RunRuntimeMetadata => ({
  ...baseRuntimeMetadata(runSession, workerId),
  ...update,
  worker_id: workerId,
});

const terminalExecutorResult = (input: {
  runSession: RunSession;
  status: 'failed' | 'cancelled';
  summary: string;
  failure?: ExecutorFailure;
  at: string;
}): ExecutorResult => ({
  run_session_id: input.runSession.id,
  executor_type: input.runSession.run_spec?.executor_type ?? input.runSession.executor_type ?? 'mock',
  executor_version: 'run-worker',
  status: input.status,
  started_at: input.runSession.started_at ?? input.at,
  finished_at: input.at,
  summary: input.summary,
  changed_files: [],
  checks: [],
  artifacts: [],
  failure:
    input.status === 'failed' && input.failure !== undefined
      ? input.failure
      : {
          kind: input.status === 'cancelled' ? 'cancelled' : 'executor_error',
          message: input.summary,
          retryable: input.status !== 'cancelled',
        },
  raw_metadata: {},
});

const runtimeSafetyBlockersFromExecutorResult = (executorResult: ExecutorResult): RuntimeSafetyBlocker[] => {
  if (executorResult.status === 'succeeded' || executorResult.failure === undefined) {
    return [];
  }

  const evidenceText = [executorResult.failure?.message, executorResult.summary]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join('\n');
  if (evidenceText.length === 0) {
    return [];
  }

  const retryable = executorResult.failure?.retryable;
  return runtimeSafetyFailureCodePatterns.flatMap(([code, pattern]) =>
    pattern.test(evidenceText)
      ? [
          {
            code,
            summary: runtimeSafetyFailureSummaries[code],
            retryable: retryable ?? code !== 'fallback_denied_by_policy',
          },
        ]
      : [],
  );
};

const runtimeEvidenceFromExecutorResult = (executorResult: ExecutorResult): RuntimeFinalizationEvidence => ({
  executorResult,
  authoritativeChangedFiles: executorResult.changed_files,
  requiredCheckResults: executorResult.checks,
  primaryArtifactRefs: executorResult.artifacts,
  runtimeBlockers: runtimeSafetyBlockersFromExecutorResult(executorResult),
  pathPolicy:
    executorResult.failure?.kind === 'path_violation'
      ? {
          ok: false,
          blockerCode: 'path_policy_actual_changes_rejected',
          publicSummary: executorResult.failure.message,
        }
      : { ok: true },
});

const fakeEnvironment = (): LocalCodexEnvironment => ({
  commandExists: async () => false,
  isCodexRuntimeReady: async () => false,
  isGitRepo: async () => false,
  resolveGitRef: async () => false,
  prepareWorkspace: async () => ({ ok: false, message: 'not prepared by run-worker test environment' }),
  isWorkspaceClean: async () => true,
  isWritableDirectory: async () => true,
  runCodex: async () => undefined,
  runCommand: async () => ({ stdout: '', stderr: '' }),
});

const sourceSnapshot = (runSession: RunSession): SourceRepoSnapshot => ({
  repoPath: runSession.run_spec?.repo.local_path ?? '',
  beforePorcelain: '',
  beforeDirtyFingerprint: '',
});

const closeDriverQuietly = async (driver: CodexSessionDriver): Promise<void> => {
  try {
    await driver.close?.();
  } catch {
    // Driver cleanup must not overwrite the authoritative run outcome.
  }
};

const isRealLocalCodexDriverRun = (runSession: RunSession, driver: CodexSessionDriver): boolean =>
  runSession.run_spec?.executor_type === 'local_codex' &&
  runSession.run_spec.workflow_only !== true &&
  (driver.kind === 'app_server' || driver.kind === 'exec_fallback');

const isRealLocalCodexRuntime = (runSession: RunSession): boolean =>
  runSession.run_spec?.executor_type === 'local_codex' &&
  runSession.run_spec.workflow_only !== true &&
  (runSession.runtime_metadata?.driver_kind === 'app_server' || runSession.runtime_metadata?.driver_kind === 'exec_fallback');

const runtimeMetadataSourceSnapshot = (runtimeMetadata: RunRuntimeMetadata | undefined): SourceRepoSnapshot | undefined => {
  if (
    typeof runtimeMetadata?.source_repo_path !== 'string' ||
    typeof runtimeMetadata.source_repo_before_status !== 'string' ||
    typeof runtimeMetadata.source_repo_before_dirty_fingerprint !== 'string'
  ) {
    return undefined;
  }

  return {
    repoPath: runtimeMetadata.source_repo_path,
    beforePorcelain: runtimeMetadata.source_repo_before_status,
    beforeDirtyFingerprint: runtimeMetadata.source_repo_before_dirty_fingerprint,
  };
};

export class RunWorker {
  private readonly repository: DeliveryRepository;
  private readonly workerId: string;
  private readonly driverFactory: RunWorkerInput['driverFactory'];
  private readonly execFallbackDriverFactory: NonNullable<RunWorkerInput['execFallbackDriverFactory']>;
  private readonly evidenceCollector: RunWorkerInput['evidenceCollector'];
  private readonly selfReview: RunWorkerInput['selfReview'];
  private readonly now: () => string;
  private readonly heartbeatIntervalMs: number;
  private readonly commandPollIntervalMs: number;
  private readonly leaseDurationMs: number;
  private readonly idleThresholdMs: number;
  private readonly artifactRoot: string;
  private readonly allowExecFallback: boolean;
  private drainPromise: Promise<void> | undefined;
  private drainAgainRequested = false;

  constructor(input: RunWorkerInput) {
    this.repository = input.repository;
    this.workerId = input.workerId;
    this.driverFactory = input.driverFactory;
    this.execFallbackDriverFactory = input.execFallbackDriverFactory ?? input.driverFactory;
    this.evidenceCollector = input.evidenceCollector;
    this.selfReview = input.selfReview;
    this.now = input.now ?? nowIso;
    this.heartbeatIntervalMs = input.heartbeatIntervalMs ?? 5_000;
    this.commandPollIntervalMs = input.commandPollIntervalMs ?? 750;
    this.leaseDurationMs = input.leaseDurationMs ?? 60_000;
    this.idleThresholdMs = input.idleThresholdMs ?? 120_000;
    this.artifactRoot = input.artifactRoot ?? '.forgeloop/artifacts';
    this.allowExecFallback = input.allowExecFallback ?? true;
  }

  kick(): void {
    if (this.drainPromise !== undefined) {
      this.drainAgainRequested = true;
      return;
    }

    this.startBackgroundDrain();
  }

  private startBackgroundDrain(): void {
    this.drainAgainRequested = false;
    this.drainPromise = this.drainOnce().catch(() => undefined).finally(() => {
      this.drainPromise = undefined;
      if (this.drainAgainRequested) {
        this.startBackgroundDrain();
      }
    });
  }

  async drainOnce(): Promise<void> {
    const sessions = await this.repository.listRecoverableRunSessions();
    for (const session of sessions) {
      if (terminalStatuses.has(session.status)) {
        continue;
      }

      const at = this.now();
      let leaseId: string;
      let leaseToken: string;
      try {
        const acquired = await acquireLeaseForRun(this.repository, session.id, this.workerId, at, this.leaseDurationMs);
        leaseId = acquired.lease.id;
        leaseToken = acquired.leaseToken;
        await this.repository.appendWorkerRunEvent(
          {
            id: `run-event:${session.id}:worker-lease-acquired:${this.workerId}:${at}`,
            run_session_id: session.id,
            event_type: 'worker_lease_acquired',
            source: 'worker',
            visibility: 'internal',
            summary: 'Worker lease acquired.',
            payload: { worker_id: this.workerId },
            created_at: at,
          },
          { workerId: this.workerId, leaseToken },
        );
      } catch {
        continue;
      }

      await this.runOne({ runSessionId: session.id, workerId: this.workerId, leaseId, leaseToken });
    }
  }

  async runOne(input: OwnedRun): Promise<void> {
    let terminalOrStopped = false;
    const control = this.createRunControl();
    const heartbeat = this.startHeartbeat(input, control);
    const openedDrivers = new Set<CodexSessionDriver>();

    try {
      const loaded = await this.repository.getRunSession(input.runSessionId);
      if (loaded === undefined || terminalStatuses.has(loaded.status)) {
        terminalOrStopped = true;
        return;
      }

      if (await this.stallIfIdle(loaded, input)) {
        terminalOrStopped = true;
        return;
      }

      const wasQueued = loaded.status === 'queued';
      const started = wasQueued ? await this.startQueuedRun(loaded, input) : loaded;
      let activeRunSession = started;
      let runtimeMetadata = mergeMetadata(started, input.workerId, {
        driver_kind: started.runtime_metadata?.driver_kind ?? 'fake',
      });
      const resumeWithExecFallback =
        !wasQueued &&
        (runtimeMetadata.driver_kind === 'exec_fallback' || runtimeMetadata.selected_execution_mode === 'exec_fallback');
      const driver = resumeWithExecFallback
        ? this.execFallbackDriverFactory({ runSession: started, runtimeMetadata, workerLease: input })
        : this.driverFactory({ runSession: started, runtimeMetadata, workerLease: input });
      openedDrivers.add(driver);
      if (isRealLocalCodexDriverRun(started, driver)) {
        activeRunSession = await this.prepareLocalCodexRuntime(
          activeRunSession,
          input,
          runtimeMetadata,
          wasQueued ? 'start' : 'resume',
        );
        runtimeMetadata = activeRunSession.runtime_metadata!;
      }
      if (driver.kind === 'app_server') {
        const workspacePath = runtimeMetadata.workspace_path ?? started.run_spec?.repo.local_path;
        activeRunSession = await this.updateRuntimeMetadata(activeRunSession, input, {
          driver_kind: 'app_server',
          driver_status: 'starting',
          ...(workspacePath === undefined ? {} : { workspace_path: workspacePath }),
          app_server_attempted: true,
          selected_execution_mode: 'app_server',
        } as Partial<RunRuntimeMetadata>);
        runtimeMetadata = activeRunSession.runtime_metadata!;
      }
      const opened = await this.openDriverStream(driver, activeRunSession, runtimeMetadata, input, wasQueued ? 'start' : 'resume');
      const primed = await this.primeDriverStream(opened, activeRunSession, input, wasQueued ? 'start' : 'resume', control);
      openedDrivers.add(primed.driver);

      if (primed.stalled === true) {
        terminalOrStopped = true;
        return;
      }
      if (control.stopped) {
        const latest = (await this.repository.getRunSession(started.id)) ?? primed.currentRunSession;
        await this.stallStoppedRun(latest, input, control);
        terminalOrStopped = true;
        return;
      }

      control.cancelStream = async () => {
        await primed.iterator.return?.();
      };

      let terminal = primed.firstTerminal;
      let currentStream: PrimedDriverStream | undefined = terminal === undefined ? primed : undefined;
      let currentRunSession = primed.currentRunSession;
      let activeDriver = primed.driver;
      let activeRuntimeMetadata = currentRunSession.runtime_metadata ?? primed.runtimeMetadata;
      const commandInput = () => ({
        repository: this.repository,
        runSessionId: started.id,
        workerId: input.workerId,
        leaseToken: input.leaseToken,
        driver: activeDriver,
        runtimeMetadata: currentStream?.currentRunSession.runtime_metadata ?? currentRunSession.runtime_metadata ?? activeRuntimeMetadata,
        now: this.now,
      });
      const reclaimClaimedBefore = loaded.status === 'queued' ? undefined : this.now();
      const commandPolling =
        primed.firstTerminal === undefined
          ? this.startCommandPolling(() => ({
              ...commandInput(),
              ...(reclaimClaimedBefore === undefined ? {} : { reclaimClaimedBefore }),
            }), control)
          : { done: Promise.resolve() };

      let streamStalled = false;
      while (terminal === undefined && currentStream !== undefined && !control.stopped) {
        activeDriver = currentStream.driver;
        currentRunSession = currentStream.currentRunSession;
        activeRuntimeMetadata = currentRunSession.runtime_metadata ?? currentStream.runtimeMetadata;
        control.cancelStream = async () => {
          await currentStream?.iterator.return?.();
        };

        const consumed = await this.consumeStream(currentStream, input, wasQueued ? 'start' : 'resume', control);
        if (consumed.kind === 'terminal') {
          terminal = consumed.terminal;
          break;
        }
        if (consumed.kind === 'switched') {
          openedDrivers.add(consumed.stream.driver);
          if (consumed.stream.stalled === true) {
            streamStalled = true;
            currentStream = undefined;
            currentRunSession = consumed.stream.currentRunSession;
            break;
          }
          currentStream = consumed.stream.firstTerminal === undefined ? consumed.stream : undefined;
          terminal = consumed.stream.firstTerminal;
          activeDriver = consumed.stream.driver;
          activeRuntimeMetadata = consumed.stream.runtimeMetadata;
          currentRunSession = consumed.stream.currentRunSession;
          continue;
        }
        currentRunSession = consumed.currentRunSession;
        activeRuntimeMetadata = currentRunSession.runtime_metadata ?? activeRuntimeMetadata;
        currentStream = undefined;
      }
      const stoppedBeforeStreamEndHandling = control.stopped;
      control.stop();
      await commandPolling.done;

      if (streamStalled || control.stalled) {
        terminalOrStopped = true;
        return;
      }
      if (terminal !== undefined) {
        terminalOrStopped = true;
        await this.finalizeTerminal(started, terminal, input);
        return;
      }
      const latest = (await this.repository.getRunSession(started.id)) ?? currentRunSession;
      if (stoppedBeforeStreamEndHandling) {
        await this.stallStoppedRun(latest, input, control);
        terminalOrStopped = true;
        return;
      }
      if (!stoppedBeforeStreamEndHandling) {
        if (!terminalStatuses.has(latest.status)) {
          await this.stallRun(latest, input, 'Driver stream ended before terminal completion.');
        }
        terminalOrStopped = true;
      }
    } catch (error) {
      const runSession = await this.repository.getRunSession(input.runSessionId);
      if (runSession !== undefined && !terminalStatuses.has(runSession.status)) {
        await this.stallRun(runSession, input, 'Driver recovery failed.', error);
      }
      terminalOrStopped = true;
    } finally {
      control.stop();
      await heartbeat.done;
      await Promise.all([...openedDrivers].map((driver) => closeDriverQuietly(driver)));
      if (terminalOrStopped) {
        try {
          await releaseLease(this.repository, input.runSessionId, input.workerId, input.leaseToken, this.now());
        } catch {
          // Another worker may already have taken over an expired lease.
        }
      }
    }
  }

  private async startQueuedRun(runSession: RunSession, lease: OwnedRun): Promise<RunSession> {
    const at = this.now();
    const startInput = {
      repository: this.repository,
      runSessionId: runSession.id,
      now: () => at,
    };
    await this.repository.withActiveRunWorkerLease(runSession.id, { ...lease, now: at }, async (repository) => {
      await buildAndStartPackageRun({
        ...startInput,
        repository,
        ...(runSession.run_spec?.workflow_only === undefined ? {} : { workflowOnly: runSession.run_spec.workflow_only }),
      });
    });

    const started = await this.repository.getRunSession(runSession.id);
    if (started === undefined) {
      throw new Error(`Run session ${runSession.id} disappeared after start`);
    }

    return started;
  }

  private async prepareLocalCodexRuntime(
    runSession: RunSession,
    lease: OwnedRun,
    runtimeMetadata: RunRuntimeMetadata,
    mode: 'start' | 'resume',
  ): Promise<RunSession> {
    const runSpec = runSession.run_spec;
    if (runSpec === undefined) {
      throw new Error(`Run session ${runSession.id} does not have a run spec`);
    }

    const environment = createDefaultLocalCodexEnvironment();
    const baseRef = runSpec.repo.base_commit_sha.trim().length > 0 ? runSpec.repo.base_commit_sha : runSpec.repo.base_branch;
    const existingSnapshot = runtimeMetadataSourceSnapshot(runtimeMetadata);
    if (mode === 'resume' && existingSnapshot === undefined) {
      throw new Error('Missing pre-run source snapshot metadata for local Codex recovery.');
    }
    const sourceRepoSnapshot =
      existingSnapshot ?? (await snapshotSourceRepoStatus(environment, runSpec.repo.local_path));
    let workspacePath = runtimeMetadata.workspace_path;
    let workspacePrepared = false;
    if (workspacePath === undefined) {
      const prepared = await environment.prepareWorkspace({
        repoPath: runSpec.repo.local_path,
        baseRef,
        runSessionId: runSpec.run_session_id,
      });
      if (!prepared.ok) {
        throw new Error(`Persistent workspace preparation failed: ${prepared.message}`);
      }
      workspacePath = prepared.workspacePath;
      workspacePrepared = true;
    }

    if ((mode === 'start' || workspacePrepared) && !(await environment.isWorkspaceClean(workspacePath))) {
      throw new Error(`Persistent workspace is not clean: ${workspacePath}`);
    }

    return this.updateRuntimeMetadata(runSession, lease, {
      workspace_path: workspacePath,
      source_repo_path: sourceRepoSnapshot.repoPath,
      source_repo_before_status: sourceRepoSnapshot.beforePorcelain,
      source_repo_before_dirty_fingerprint: sourceRepoSnapshot.beforeDirtyFingerprint,
    });
  }

  private async openDriverStream(
    driver: CodexSessionDriver,
    runSession: RunSession,
    runtimeMetadata: RunRuntimeMetadata,
    lease: OwnedRun,
    mode: 'start' | 'resume',
  ): Promise<OpenedDriverStream> {
    const runSpec = runSession.run_spec;
    if (runSpec === undefined) {
      throw new Error(`Run session ${runSession.id} does not have a run spec`);
    }

    const input = {
      runSpec,
      workspacePath: runtimeMetadata.workspace_path ?? runSpec.repo.local_path,
      runtimeMetadata,
    };

    try {
      return {
        driver,
        runtimeMetadata,
        stream: mode === 'start' ? driver.startRun(input) : driver.resumeRun(input),
      };
    } catch (error) {
      if (driver.kind !== 'app_server' && runtimeMetadata.driver_kind !== 'app_server') {
        throw error;
      }

      return this.openFallbackDriverStream(runtimeMetadata, runSession, lease, error, mode);
    }
  }

  private async primeDriverStream(
    opened: OpenedDriverStream,
    runSession: RunSession,
    lease: OwnedRun,
    mode: 'start' | 'resume',
    control: RunControl,
  ): Promise<PrimedDriverStream> {
    const iterator = opened.stream[Symbol.asyncIterator]();
    control.cancelStream = () => {
      void iterator.return?.();
    };

    try {
      const first = await this.nextStreamItem(iterator, control);
      if (first === undefined) {
        return { ...opened, iterator, currentRunSession: runSession, stalled: control.stalled };
      }
      if (first.done === true) {
        return { ...opened, iterator, currentRunSession: runSession };
      }

      const handled = await this.handleStreamItem(first.value, runSession, lease);
      if (
        opened.runtimeMetadata.driver_kind === 'app_server' &&
        first.value.kind === 'event' &&
        isFallbackRequiredEvent(first.value)
      ) {
        const next = await this.nextStreamItem(iterator, control);
        if (next === undefined) {
          return { ...opened, iterator, currentRunSession: handled.currentRunSession, stalled: control.stalled };
        }
        if (next.done === true) {
          await iterator.return?.();
          return this.openFallbackAfterRecoveryFailure(opened.runtimeMetadata, runSession, lease, fallbackReasonFromEvent(first.value), control, mode);
        }

        const nextHandled = await this.handleStreamItem(next.value, handled.currentRunSession, lease);
        if (nextHandled.terminal !== undefined) {
          if (nextHandled.terminal.status === 'failed') {
            await iterator.return?.();
            return this.openFallbackAfterRecoveryFailure(opened.runtimeMetadata, runSession, lease, nextHandled.terminal, control, mode);
          }

          return {
            ...opened,
            iterator,
            currentRunSession: nextHandled.currentRunSession,
            firstTerminal: nextHandled.terminal,
          };
        }

        return { ...opened, iterator, currentRunSession: nextHandled.currentRunSession };
      }

      if (
        handled.terminal?.status === 'failed' &&
        (opened.runtimeMetadata.driver_kind === 'app_server' || opened.isRecoveryFallback === true)
      ) {
        await iterator.return?.();
        if (opened.isRecoveryFallback === true) {
          await this.stallRun(
            handled.currentRunSession,
            lease,
            'Driver recovery failed.',
            handled.terminal.failure?.message ?? handled.terminal.summary,
          );
          return { ...opened, iterator, currentRunSession: handled.currentRunSession, stalled: true };
        }
        return this.openFallbackAfterRecoveryFailure(opened.runtimeMetadata, runSession, lease, handled.terminal, control, mode);
      }

      return {
        ...opened,
        iterator,
        currentRunSession: handled.currentRunSession,
        ...(handled.terminal === undefined ? {} : { firstTerminal: handled.terminal }),
      };
    } catch (error) {
      if (opened.runtimeMetadata.driver_kind !== 'app_server') {
        throw error;
      }

      return this.openFallbackAfterRecoveryFailure(opened.runtimeMetadata, runSession, lease, error, control, mode);
    }
  }

  private async openFallbackDriverStream(
    runtimeMetadata: RunRuntimeMetadata,
    runSession: RunSession,
    lease: OwnedRun,
    reason: unknown,
    mode: 'start' | 'resume',
  ): Promise<OpenedDriverStream> {
    const runSpec = runSession.run_spec;
    if (runSpec === undefined) {
      throw new Error(`Run session ${runSession.id} does not have a run spec`);
    }

    const reasonText = fallbackReason(reason);
    if (!this.allowExecFallback) {
      throw new Error(`fallback_denied_by_policy: ${reasonText}`);
    }
    const updatedRunSession = await this.updateRuntimeMetadata(runSession, lease, {
      ...runtimeMetadata,
      driver_kind: 'exec_fallback',
      driver_status: 'starting',
      selected_execution_mode: 'exec_fallback',
      app_server_fallback_reason: reasonText,
      exec_fallback_dangerous_bypass: true,
      effective_dangerous_mode: 'confirmed',
    } as Partial<RunRuntimeMetadata>);
    const fallbackMetadata = updatedRunSession.runtime_metadata!;
    const fallback = this.execFallbackDriverFactory({ runSession: updatedRunSession, runtimeMetadata: fallbackMetadata, workerLease: lease });
    const at = this.now();
    await this.repository.appendWorkerRunEvent(
      {
        id: `run-event:${runSession.id}:driver-fallback-used:${at}`,
        run_session_id: runSession.id,
        event_type: 'driver_fallback_used',
        source: 'worker',
        visibility: 'public',
        summary: mode === 'start' ? 'Worker switched to exec fallback start.' : 'Worker switched to exec fallback recovery.',
        payload: { reason: reasonText },
        created_at: at,
      },
      { workerId: lease.workerId, leaseToken: lease.leaseToken },
    );

    const input = {
      runSpec,
      workspacePath: fallbackMetadata.workspace_path ?? runSpec.repo.local_path,
      runtimeMetadata: fallbackMetadata,
    };
    const fallbackMode = mode === 'resume' && fallbackMetadata.codex_thread_id === undefined ? 'start' : mode;

    return {
      driver: fallback,
      runtimeMetadata: fallbackMetadata,
      stream: fallbackMode === 'start' ? fallback.startRun(input) : fallback.resumeRun(input),
      isRecoveryFallback: true,
    };
  }

  private async openFallbackAfterRecoveryFailure(
    runtimeMetadata: RunRuntimeMetadata,
    runSession: RunSession,
    lease: OwnedRun,
    reason: unknown,
    control: RunControl,
    mode: 'start' | 'resume',
  ): Promise<PrimedDriverStream> {
    try {
      const opened = await this.openFallbackDriverStream(runtimeMetadata, runSession, lease, reason, mode);
      const fallbackRunSession = (await this.repository.getRunSession(runSession.id)) ?? runSession;
      const iterator = opened.stream[Symbol.asyncIterator]();
      control.cancelStream = () => {
        void iterator.return?.();
      };
      const first = await this.nextStreamItem(iterator, control);
      if (first === undefined) {
        return { ...opened, iterator, currentRunSession: fallbackRunSession, stalled: control.stalled };
      }
      if (first.done === true) {
        await this.stallRun(fallbackRunSession, lease, 'Driver recovery failed.', 'Exec fallback ended before recovery completed.');
        return { ...opened, iterator, currentRunSession: fallbackRunSession, stalled: true };
      }

      const handled = await this.handleStreamItem(first.value, fallbackRunSession, lease);
      if (handled.terminal?.status === 'failed') {
        await iterator.return?.();
        if (mode === 'start') {
          return {
            ...opened,
            iterator,
            currentRunSession: handled.currentRunSession,
            firstTerminal: handled.terminal,
          };
        }
        await this.stallRun(
          handled.currentRunSession,
          lease,
          'Driver recovery failed.',
          handled.terminal.failure?.message ?? handled.terminal.summary,
        );
        return { ...opened, iterator, currentRunSession: handled.currentRunSession, stalled: true };
      }

      return {
        ...opened,
        iterator,
        currentRunSession: handled.currentRunSession,
        ...(handled.terminal === undefined ? {} : { firstTerminal: handled.terminal }),
      };
    } catch (error) {
      const latest = (await this.repository.getRunSession(runSession.id)) ?? runSession;
      await this.stallRun(latest, lease, 'Driver recovery failed.', error);
      return {
        driver: this.execFallbackDriverFactory({
          runSession: latest,
          runtimeMetadata: latest.runtime_metadata ?? runtimeMetadata,
          workerLease: lease,
        }),
        runtimeMetadata: latest.runtime_metadata ?? runtimeMetadata,
        iterator: (async function* empty() {})()[Symbol.asyncIterator](),
        currentRunSession: latest,
        stalled: true,
      };
    }
  }

  private async consumeStream(
    opened: PrimedDriverStream,
    lease: OwnedRun,
    mode: 'start' | 'resume',
    control: RunControl,
  ): Promise<ConsumeStreamResult> {
    let current = opened.currentRunSession;
    while (!control.stopped) {
      const item = await this.nextStreamItem(opened.iterator, control);
      if (item === undefined) {
        return { kind: 'ended', currentRunSession: current };
      }
      if (item.done === true) {
        return { kind: 'ended', currentRunSession: current };
      }

      if (
        opened.runtimeMetadata.driver_kind === 'app_server' &&
        item.value.kind === 'event' &&
        isFallbackRequiredEvent(item.value)
      ) {
        const handled = await this.handleStreamItem(item.value, current, lease);
        await opened.iterator.return?.();
        return {
          kind: 'switched',
          stream: await this.openFallbackAfterRecoveryFailure(
            handled.currentRunSession.runtime_metadata ?? opened.runtimeMetadata,
            handled.currentRunSession,
            lease,
            fallbackReasonFromEvent(item.value),
            control,
            mode,
          ),
        };
      }

      const handled = await this.handleStreamItem(item.value, current, lease);
      current = handled.currentRunSession;
      opened.currentRunSession = current;
      opened.runtimeMetadata = current.runtime_metadata ?? opened.runtimeMetadata;
      if (handled.terminal !== undefined) {
        if (
          handled.terminal.status === 'failed' &&
          (opened.runtimeMetadata.driver_kind === 'app_server' || opened.isRecoveryFallback === true)
        ) {
          await opened.iterator.return?.();
          if (opened.isRecoveryFallback === true) {
            await this.stallRun(
              handled.currentRunSession,
              lease,
              'Driver recovery failed.',
              handled.terminal.failure?.message ?? handled.terminal.summary,
            );
            return {
              kind: 'switched',
              stream: {
                ...opened,
                currentRunSession: handled.currentRunSession,
                stalled: true,
              },
            };
          }
          return {
            kind: 'switched',
            stream: await this.openFallbackAfterRecoveryFailure(
              opened.runtimeMetadata,
              handled.currentRunSession,
              lease,
              handled.terminal,
              control,
              mode,
            ),
          };
        }
        return { kind: 'terminal', terminal: handled.terminal };
      }
    }

    return { kind: 'ended', currentRunSession: current };
  }

  private async nextStreamItem(
    iterator: AsyncIterator<CodexDriverStreamItem>,
    control: RunControl,
  ): Promise<IteratorResult<CodexDriverStreamItem> | undefined> {
    return Promise.race([iterator.next(), control.stoppedPromise.then(() => undefined)]);
  }

  private async handleStreamItem(
    item: CodexDriverStreamItem,
    runSession: RunSession,
    lease: OwnedRun,
  ): Promise<{
    currentRunSession: RunSession;
    terminal?: Extract<CodexDriverStreamItem, { kind: 'terminal' }>;
  }> {
    if (item.kind !== 'event') {
      return { currentRunSession: runSession, terminal: item };
    }

    const at = this.now();
    const event = await this.repository.appendWorkerRunEvent(
      {
        id: `run-event:${runSession.id}:${item.event.event_type}:${at}`,
        run_session_id: runSession.id,
        event_type: item.event.event_type,
        source: item.event.source,
        visibility: item.event.visibility,
        summary: item.event.summary,
        payload: item.event.payload,
        ...(item.event.raw_ref === undefined ? {} : { raw_ref: JSON.stringify(item.event.raw_ref) }),
        created_at: at,
      },
      { workerId: lease.workerId, leaseToken: lease.leaseToken },
    );
    let current = await this.updateRuntimeMetadata(runSession, lease, {
      ...item.runtimeMetadata,
      last_event_at: event.created_at,
      last_event_cursor: event.cursor,
    });

    if (item.event.event_type === 'waiting_for_input') {
      current = {
        ...current,
        status: 'waiting_for_input',
        updated_at: event.created_at,
      };
      await this.saveRunSessionFenced(current, lease);
    }

    return { currentRunSession: current };
  }

  private async finalizeTerminal(
    runSession: RunSession,
    terminal: Extract<CodexDriverStreamItem, { kind: 'terminal' }>,
    lease: OwnedRun,
  ): Promise<void> {
    const latest = (await this.repository.getRunSession(runSession.id)) ?? runSession;
    const at = this.now();
    let executorResult: ExecutorResult;

    if (terminal.status === 'succeeded') {
      if (latest.run_spec === undefined) {
        throw new Error(`Run session ${latest.id} does not have a run spec`);
      }
      const localCodexRun =
        latest.run_spec.executor_type === 'local_codex' &&
        latest.run_spec.workflow_only !== true &&
        (latest.runtime_metadata?.driver_kind === 'app_server' || latest.runtime_metadata?.driver_kind === 'exec_fallback');
      const workspacePath = latest.runtime_metadata?.workspace_path ?? latest.run_spec.repo.local_path;
      const environment = localCodexRun ? createDefaultLocalCodexEnvironment() : fakeEnvironment();
      const checkEnv = localCodexRun ? await createLocalCodexCheckEnv(environment, workspacePath) : {};
      const sourceRepoSnapshot = localCodexRun ? runtimeMetadataSourceSnapshot(latest.runtime_metadata) : sourceSnapshot(latest);
      if (sourceRepoSnapshot === undefined) {
        throw new Error('Missing pre-run source snapshot metadata for local Codex finalization.');
      }
      executorResult = await this.evidenceCollector({
        runSpec: latest.run_spec,
        workspacePath,
        baseRef: latest.run_spec.repo.base_commit_sha,
        artifactRoot: this.artifactRoot,
        summary: terminal.summary,
        startedAt: latest.started_at ?? at,
        environment,
        checkEnv,
        sourceRepoSnapshot,
        effectiveDangerousMode: latest.runtime_metadata?.effective_dangerous_mode ?? 'not_requested',
      });
    } else {
      executorResult = terminalExecutorResult({
        runSession: latest,
        status: terminal.status,
        summary: terminal.summary,
        ...(terminal.failure === undefined ? {} : { failure: terminal.failure }),
        at,
      });
    }

    if (isRealLocalCodexRuntime(latest)) {
      const terminalized = await terminalizePackageRunWithRuntimeEvidence({
        repository: this.repository,
        runSessionId: latest.id,
        evidence: runtimeEvidenceFromExecutorResult(executorResult),
        workerLease: { workerId: lease.workerId, leaseToken: lease.leaseToken },
        now: () => at,
      });
      await this.recordAfterRunDiagnosticsBestEffort(latest, terminalized, lease);
      if (terminalized.reviewEligible) {
        await completePackageRunReviewFinalization({
          repository: this.repository,
          runSessionId: latest.id,
          selfReview: this.selfReview,
          workerLease: { workerId: lease.workerId, leaseToken: lease.leaseToken },
          now: () => this.now(),
        });
      }
      return;
    }

    await finalizePackageRunWithExecutorResult({
      repository: this.repository,
      runSessionId: latest.id,
      executorResult,
      selfReview: this.selfReview,
      workerLease: { workerId: lease.workerId, leaseToken: lease.leaseToken },
      now: () => at,
    });
  }

  private async recordAfterRunDiagnosticsBestEffort(
    runSession: RunSession,
    terminalized: TerminalizedRunResult,
    lease: OwnedRun,
  ): Promise<void> {
    try {
      await this.recordAfterRunDiagnostics(runSession, terminalized, lease);
    } catch (error) {
      console.warn('[forgeloop:run-worker] after_run diagnostics persistence failed', {
        run_session_id: runSession.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async recordAfterRunDiagnostics(
    runSession: RunSession,
    terminalized: TerminalizedRunResult,
    lease: OwnedRun,
  ): Promise<void> {
    const at = this.now();
    await this.repository.appendWorkerRunEvent(
      {
        id: `run-event:${runSession.id}:after-run-diagnostics:${at}`,
        run_session_id: runSession.id,
        event_type: 'after_run_diagnostics_recorded',
        source: 'worker',
        visibility: 'internal',
        summary: 'after_run hooks skipped because read-only source enforcement is unavailable.',
        payload: {
          terminal_status: terminalized.status,
          review_finalization_eligible: terminalized.reviewEligible,
          diagnostics: [
            {
              phase: 'after_run',
              status: 'skipped',
              reason_code: 'after_run_read_only_unavailable',
              summary: 'after_run hook skipped because read-only source enforcement is unavailable.',
            },
          ],
        },
        created_at: at,
      },
      { workerId: lease.workerId, leaseToken: lease.leaseToken },
    );
  }

  private startHeartbeat(lease: OwnedRun, control: RunControl): { done: Promise<void> } {
    const beat = async () => {
      while (!control.stopped) {
        await delay(this.heartbeatIntervalMs);
        if (control.stopped) {
          return;
        }

        const at = this.now();
        try {
          await heartbeatLease(this.repository, lease.runSessionId, lease.workerId, lease.leaseToken, at, this.leaseDurationMs);
          await this.repository.appendWorkerRunEvent(
            {
              id: `run-event:${lease.runSessionId}:watchdog-heartbeat:${at}`,
              run_session_id: lease.runSessionId,
              event_type: 'watchdog_heartbeat',
              source: 'watchdog',
              visibility: 'internal',
              summary: 'Worker heartbeat.',
              payload: { worker_id: lease.workerId },
              created_at: at,
            },
            { workerId: lease.workerId, leaseToken: lease.leaseToken },
          );
          const runSession = await this.repository.getRunSession(lease.runSessionId);
          if (runSession !== undefined && (await this.stallIfIdle(runSession, lease))) {
            control.stall();
            void control.cancelStream?.();
          }
        } catch (error) {
          control.fail(error);
          void control.cancelStream?.();
        }
      }
    };

    return { done: beat() };
  }

  private startCommandPolling(
    input: Parameters<typeof applyPendingRunCommands>[0] | (() => Parameters<typeof applyPendingRunCommands>[0]),
    control: RunControl,
  ): { done: Promise<void> } {
    const done = (async () => {
      while (!control.stopped) {
        try {
          await applyPendingRunCommands(typeof input === 'function' ? input() : input);
        } catch (error) {
          control.fail(error);
          void control.cancelStream?.();
          return;
        }

        await delay(this.commandPollIntervalMs);
      }
    })();

    return { done };
  }

  private createRunControl(): RunControl {
    let resolveStopped: (() => void) | undefined;
    const stoppedPromise = new Promise<void>((resolve) => {
      resolveStopped = resolve;
    });
    const control: RunControl = {
      stopped: false,
      stalled: false,
      stoppedPromise,
      stop: () => {
        control.stopped = true;
        resolveStopped?.();
      },
      fail: (error: unknown) => {
        control.failure = error;
        control.stopped = true;
        resolveStopped?.();
      },
      stall: () => {
        control.stalled = true;
        control.stopped = true;
        resolveStopped?.();
      },
    };

    return control;
  }

  private async stallIfIdle(runSession: RunSession, lease: OwnedRun): Promise<boolean> {
    if (runSession.runtime_metadata?.last_event_at === undefined || runSession.status !== 'running') {
      return false;
    }

    const progress = evaluateRunProgress({
      status: runSession.status,
      lastCodexActivityAt: runSession.runtime_metadata.last_event_at,
      now: this.now(),
      idleThresholdMs: this.idleThresholdMs,
    });

    if (progress !== 'stalled') {
      return false;
    }

    await this.stallRun(runSession, lease, 'Codex activity stalled.');
    return true;
  }

  private async stallStoppedRun(runSession: RunSession, lease: OwnedRun, control: RunControl): Promise<void> {
    if (terminalStatuses.has(runSession.status)) {
      return;
    }

    await this.stallRun(runSession, lease, 'Worker stopped before terminal completion.', control.failure);
  }

  private async stallRun(runSession: RunSession, lease: OwnedRun, summary: string, error?: unknown): Promise<void> {
    const at = this.now();
    await this.saveRunSessionFenced(
      {
        ...runSession,
        status: 'stalled',
        summary,
        updated_at: at,
      },
      lease,
    );
    await this.repository.appendWorkerRunEvent(
      {
        id: `run-event:${runSession.id}:stalled:${at}`,
        run_session_id: runSession.id,
        event_type: 'stalled',
        source: 'watchdog',
        visibility: 'public',
        summary,
        payload: { reason: error instanceof Error ? error.message : summary },
        created_at: at,
      },
      { workerId: lease.workerId, leaseToken: lease.leaseToken },
    );
  }

  private async updateRuntimeMetadata(
    runSession: RunSession,
    lease: OwnedRun,
    update: Partial<RunRuntimeMetadata>,
  ): Promise<RunSession> {
    const next = {
      ...runSession,
      runtime_metadata: mergeMetadata(runSession, lease.workerId, update),
      updated_at: this.now(),
    };
    await this.saveRunSessionFenced(next, lease);
    return next;
  }

  private async saveRunSessionFenced(runSession: RunSession, lease: OwnedRun): Promise<void> {
    await this.repository.withActiveRunWorkerLease(runSession.id, { ...lease, now: this.now() }, (repository) =>
      repository.saveRunSession(runSession),
    );
  }
}
