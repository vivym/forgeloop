import type { ExecutorResult, SelfReviewInput, SelfReviewResult } from '@forgeloop/contracts';
import type { P0Repository } from '../../db/src/index.js';
import type { RunRuntimeMetadata, RunSession } from '../../domain/src/index.js';
import type {
  CodexDriverStreamItem,
  CodexSessionDriver,
  LocalCodexEvidenceInput,
  LocalCodexEnvironment,
  SourceRepoSnapshot,
} from '../../executor/src/index.js';
import { buildAndStartPackageRun, finalizePackageRunWithExecutorResult } from '../../workflow/src/index.js';

import { applyPendingRunCommands } from './command-inbox.js';
import { acquireLeaseForRun, heartbeatLease, releaseLease } from './lease.js';
import { evaluateRunProgress } from './watchdog.js';

type IsoDateTime = string;

export interface RunWorkerInput {
  repository: P0Repository;
  workerId: string;
  driverFactory: (input: { runSession: RunSession; runtimeMetadata: RunRuntimeMetadata }) => CodexSessionDriver;
  execFallbackDriverFactory?: (input: { runSession: RunSession; runtimeMetadata: RunRuntimeMetadata }) => CodexSessionDriver;
  evidenceCollector: (input: LocalCodexEvidenceInput) => Promise<ExecutorResult>;
  selfReview: (input: SelfReviewInput) => Promise<SelfReviewResult>;
  now?: () => IsoDateTime;
  heartbeatIntervalMs?: number;
  commandPollIntervalMs?: number;
  leaseDurationMs?: number;
  idleThresholdMs?: number;
  artifactRoot?: string;
}

interface OwnedRun {
  runSessionId: string;
  workerId: string;
  leaseToken: string;
}

interface RunControl {
  stopped: boolean;
  stalled: boolean;
  stoppedPromise: Promise<void>;
  stop: () => void;
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
  firstTerminal?: Extract<CodexDriverStreamItem, { kind: 'terminal' }>;
  stalled?: boolean;
}

const terminalStatuses = new Set<RunSession['status']>(['succeeded', 'failed', 'timed_out', 'cancelled']);
const nowIso = () => new Date().toISOString();
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isFallbackRequiredEvent = (item: CodexDriverStreamItem): boolean =>
  item.kind === 'event' &&
  item.event.event_type === 'driver_fallback_used' &&
  item.runtimeMetadata?.driver_kind === 'exec_fallback';

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
  failure: {
    kind: input.status === 'cancelled' ? 'cancelled' : 'executor_error',
    message: input.summary,
    retryable: input.status !== 'cancelled',
  },
  raw_metadata: {},
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

export class RunWorker {
  private readonly repository: P0Repository;
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
  private drainPromise: Promise<void> | undefined;

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
  }

  kick(): void {
    if (this.drainPromise !== undefined) {
      return;
    }

    this.drainPromise = this.drainOnce().finally(() => {
      this.drainPromise = undefined;
    });
  }

  async drainOnce(): Promise<void> {
    const sessions = await this.repository.listRecoverableRunSessions();
    for (const session of sessions) {
      if (terminalStatuses.has(session.status)) {
        continue;
      }

      const at = this.now();
      let leaseToken: string;
      try {
        const acquired = await acquireLeaseForRun(this.repository, session.id, this.workerId, at, this.leaseDurationMs);
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

      await this.runOne({ runSessionId: session.id, workerId: this.workerId, leaseToken });
    }
  }

  async runOne(input: OwnedRun): Promise<void> {
    let terminalOrStopped = false;
    const control = this.createRunControl();
    const heartbeat = this.startHeartbeat(input, control);

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
      const runtimeMetadata = mergeMetadata(started, input.workerId, {
        driver_kind: started.runtime_metadata?.driver_kind ?? 'fake',
      });
      const driver = this.driverFactory({ runSession: started, runtimeMetadata });
      const opened = await this.openDriverStream(driver, started, runtimeMetadata, input, wasQueued ? 'start' : 'resume');
      const primed = await this.primeDriverStream(opened, started, input, wasQueued ? 'start' : 'resume', control);

      if (primed.stalled === true) {
        terminalOrStopped = true;
        return;
      }
      if (control.stopped) {
        return;
      }

      control.cancelStream = async () => {
        await primed.iterator.return?.();
      };

      const commandInput = {
        repository: this.repository,
        runSessionId: started.id,
        workerId: input.workerId,
        leaseToken: input.leaseToken,
        driver: primed.driver,
        runtimeMetadata: primed.runtimeMetadata,
        now: this.now,
      };
      const commandPolling =
        primed.firstTerminal === undefined
          ? this.startCommandPolling(
              loaded.status === 'queued'
                ? commandInput
                : {
                    ...commandInput,
                    reclaimClaimedBefore: this.now(),
                  },
              control,
            )
          : { done: Promise.resolve() };

      const terminal =
        primed.firstTerminal ?? (await this.consumeStream(primed.iterator, primed.currentRunSession, input, control));
      const stoppedBeforeStreamEndHandling = control.stopped;
      control.stop();
      await commandPolling.done;

      if (control.stalled) {
        terminalOrStopped = true;
        return;
      }
      if (terminal !== undefined) {
        terminalOrStopped = true;
        await this.finalizeTerminal(started, terminal, input);
        return;
      }
      if (!stoppedBeforeStreamEndHandling) {
        const latest = (await this.repository.getRunSession(started.id)) ?? primed.currentRunSession;
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

    if (mode === 'start') {
      return { driver, runtimeMetadata, stream: driver.startRun(input) };
    }

    try {
      return { driver, runtimeMetadata, stream: driver.resumeRun(input) };
    } catch (error) {
      if (runtimeMetadata.driver_kind !== 'app_server') {
        throw error;
      }

      const fallbackMetadata = { ...runtimeMetadata, driver_kind: 'exec_fallback' as const };
      const fallback = this.execFallbackDriverFactory({ runSession, runtimeMetadata: fallbackMetadata });
      const at = this.now();
      await this.repository.appendWorkerRunEvent(
        {
          id: `run-event:${runSession.id}:driver-fallback-used:${at}`,
          run_session_id: runSession.id,
          event_type: 'driver_fallback_used',
          source: 'worker',
          visibility: 'public',
          summary: 'Worker switched to exec fallback recovery.',
          payload: { reason: error instanceof Error ? error.message : String(error) },
          created_at: at,
        },
        { workerId: lease.workerId, leaseToken: lease.leaseToken },
      );

      return {
        driver: fallback,
        runtimeMetadata: fallbackMetadata,
        stream: fallback.resumeRun({
          ...input,
          runtimeMetadata: fallbackMetadata,
        }),
        isRecoveryFallback: true,
      };
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
        mode === 'resume' &&
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
          return this.openFallbackAfterRecoveryFailure(opened.runtimeMetadata, runSession, lease, first.value.event.summary, control);
        }

        const nextHandled = await this.handleStreamItem(next.value, handled.currentRunSession, lease);
        if (nextHandled.terminal !== undefined) {
          if (nextHandled.terminal.status === 'failed') {
            await iterator.return?.();
            return this.openFallbackAfterRecoveryFailure(opened.runtimeMetadata, runSession, lease, nextHandled.terminal, control);
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
        mode === 'resume' &&
        (opened.runtimeMetadata.driver_kind === 'app_server' || opened.isRecoveryFallback === true)
      ) {
        await iterator.return?.();
        if (opened.isRecoveryFallback === true) {
          await this.stallRun(runSession, lease, 'Driver recovery failed.', handled.terminal.failure?.message ?? handled.terminal.summary);
          return { ...opened, iterator, currentRunSession: handled.currentRunSession, stalled: true };
        }
        return this.openFallbackAfterRecoveryFailure(opened.runtimeMetadata, runSession, lease, handled.terminal, control);
      }

      return {
        ...opened,
        iterator,
        currentRunSession: handled.currentRunSession,
        ...(handled.terminal === undefined ? {} : { firstTerminal: handled.terminal }),
      };
    } catch (error) {
      if (mode !== 'resume' || opened.runtimeMetadata.driver_kind !== 'app_server') {
        throw error;
      }

      return this.openFallbackAfterRecoveryFailure(opened.runtimeMetadata, runSession, lease, error, control);
    }
  }

  private async openFallbackAfterRecoveryFailure(
    runtimeMetadata: RunRuntimeMetadata,
    runSession: RunSession,
    lease: OwnedRun,
    reason: unknown,
    control: RunControl,
  ): Promise<PrimedDriverStream> {
    const fallbackMetadata = { ...runtimeMetadata, driver_kind: 'exec_fallback' as const };
    const fallback = this.execFallbackDriverFactory({ runSession, runtimeMetadata: fallbackMetadata });
    const at = this.now();
    await this.repository.appendWorkerRunEvent(
      {
        id: `run-event:${runSession.id}:driver-fallback-used:${at}`,
        run_session_id: runSession.id,
        event_type: 'driver_fallback_used',
        source: 'worker',
        visibility: 'public',
        summary: 'Worker switched to exec fallback recovery.',
        payload: { reason: reason instanceof Error ? reason.message : String(reason) },
        created_at: at,
      },
      { workerId: lease.workerId, leaseToken: lease.leaseToken },
    );

    try {
      const opened = await this.openDriverStream(fallback, runSession, fallbackMetadata, lease, 'resume');
      const iterator = opened.stream[Symbol.asyncIterator]();
      control.cancelStream = () => {
        void iterator.return?.();
      };
      const first = await this.nextStreamItem(iterator, control);
      if (first === undefined) {
        return { ...opened, iterator, currentRunSession: runSession, stalled: control.stalled };
      }
      if (first.done === true) {
        await this.stallRun(runSession, lease, 'Driver recovery failed.', 'Exec fallback ended before recovery completed.');
        return { ...opened, iterator, currentRunSession: runSession, stalled: true };
      }

      const handled = await this.handleStreamItem(first.value, runSession, lease);
      if (handled.terminal?.status === 'failed') {
        await iterator.return?.();
        await this.stallRun(runSession, lease, 'Driver recovery failed.', handled.terminal.failure?.message ?? handled.terminal.summary);
        return { ...opened, iterator, currentRunSession: handled.currentRunSession, stalled: true };
      }

      return {
        ...opened,
        iterator,
        currentRunSession: handled.currentRunSession,
        ...(handled.terminal === undefined ? {} : { firstTerminal: handled.terminal }),
      };
    } catch (error) {
      await this.stallRun(runSession, lease, 'Driver recovery failed.', error);
      return {
        driver: fallback,
        runtimeMetadata: fallbackMetadata,
        iterator: (async function* empty() {})()[Symbol.asyncIterator](),
        currentRunSession: runSession,
        stalled: true,
      };
    }
  }

  private async consumeStream(
    iterator: AsyncIterator<CodexDriverStreamItem>,
    runSession: RunSession,
    lease: OwnedRun,
    control: RunControl,
  ): Promise<Extract<CodexDriverStreamItem, { kind: 'terminal' }> | undefined> {
    let current = runSession;
    while (!control.stopped) {
      const item = await this.nextStreamItem(iterator, control);
      if (item === undefined) {
        return undefined;
      }
      if (item.done === true) {
        return undefined;
      }

      const handled = await this.handleStreamItem(item.value, current, lease);
      current = handled.currentRunSession;
      if (handled.terminal !== undefined) {
        return handled.terminal;
      }
    }

    return undefined;
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
      executorResult = await this.evidenceCollector({
        runSpec: latest.run_spec,
        workspacePath: latest.runtime_metadata?.workspace_path ?? latest.run_spec.repo.local_path,
        baseRef: latest.run_spec.repo.base_commit_sha,
        artifactRoot: this.artifactRoot,
        summary: terminal.summary,
        startedAt: latest.started_at ?? at,
        environment: fakeEnvironment(),
        checkEnv: {},
        sourceRepoSnapshot: sourceSnapshot(latest),
        effectiveDangerousMode: latest.runtime_metadata?.effective_dangerous_mode ?? 'not_requested',
      });
    } else {
      executorResult = terminalExecutorResult({
        runSession: latest,
        status: terminal.status,
        summary: terminal.summary,
        at,
      });
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
        } catch {
          control.stop();
        }
      }
    };

    return { done: beat() };
  }

  private startCommandPolling(
    input: Parameters<typeof applyPendingRunCommands>[0],
    control: RunControl,
  ): { done: Promise<void> } {
    const done = (async () => {
      while (!control.stopped) {
        try {
          await applyPendingRunCommands(input);
        } catch {
          control.stop();
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
