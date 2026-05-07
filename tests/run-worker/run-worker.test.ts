import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';
import type { ExecutorResult } from '@forgeloop/contracts';
import { InMemoryP0Repository } from '../../packages/db/src';
import type { CodexSessionDriver, RunRuntimeMetadata } from '../../packages/executor/src';

import { FakeCodexSessionDriver, RunWorker } from '../../packages/run-worker/src';
import {
  seedQueuedPackageRun,
  seedReadyStartedPackageRun,
  seedRunningRunWithCommand,
  succeededExecutorResult,
  succeededSelfReview,
} from '../helpers/p0-runtime-fixtures';

const runWorker = (input: {
  repository: InMemoryP0Repository;
  driver: CodexSessionDriver;
  workerId?: string;
  now?: () => string;
  heartbeatIntervalMs?: number;
  commandPollIntervalMs?: number;
  idleThresholdMs?: number;
  leaseDurationMs?: number;
  evidenceCollector?: () => Promise<ExecutorResult>;
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
  });

class FailingClaimRepository extends InMemoryP0Repository {
  override async claimNextRunCommand(): Promise<undefined> {
    throw new Error('injected command polling failure');
  }
}

class FailingHeartbeatRepository extends InMemoryP0Repository {
  override async heartbeatRunWorkerLease(): Promise<void> {
    throw new Error('injected heartbeat failure');
  }
}

describe('RunWorker', () => {
  it('discovers queued runs, emits live events, and finalizes only after terminal driver completion', async () => {
    const repository = new InMemoryP0Repository();
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

  it('moves idle active runs to stalled instead of timed_out', async () => {
    const repository = new InMemoryP0Repository();
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
    const repository = new InMemoryP0Repository();
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
    const repository = new InMemoryP0Repository();
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
    const repository = new InMemoryP0Repository();
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
    const repository = new InMemoryP0Repository();
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
    const repository = new InMemoryP0Repository();
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
    const repository = new InMemoryP0Repository();
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
    const repository = new InMemoryP0Repository();
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

  it('watchdog stalls a long active stream when Codex activity goes stale', async () => {
    const repository = new InMemoryP0Repository();
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
    const repository = new InMemoryP0Repository();
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
    const repository = new InMemoryP0Repository();
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
