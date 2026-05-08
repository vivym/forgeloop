import { describe, expect, it } from 'vitest';
import { InMemoryP0Repository } from '../../packages/db/src';
import type { RunCommand, RunEvent } from '../../packages/domain/src';

import { applyPendingRunCommands, FakeCodexSessionDriver } from '../../packages/run-worker/src';
import { seedRunningRunWithCommand } from '../helpers/p0-runtime-fixtures';

const now = '2026-05-08T00:00:00.000Z';
const lease = { workerId: 'worker-1', leaseToken: 'lease-token-1' };

const command = (overrides: Partial<RunCommand> = {}): Partial<RunCommand> => ({
  command_type: 'input',
  payload: { message: 'continue with the fix' },
  target_turn_id: 'turn-1',
  ...overrides,
});

const acquireLease = async (repository: InMemoryP0Repository, runSessionId: string) => {
  await repository.claimRunWorkerLease({
    run_session_id: runSessionId,
    worker_id: lease.workerId,
    lease_token: lease.leaseToken,
    now,
    expires_at: '2026-05-08T00:02:00.000Z',
  });
};

class FailingDeliveryEventRepository extends InMemoryP0Repository {
  override async appendWorkerRunEvent(
    event: Omit<RunEvent, 'sequence' | 'cursor'>,
    leaseInput: { workerId: string; leaseToken: string },
  ): Promise<RunEvent> {
    if (event.event_type === 'user_input') {
      throw new Error('injected delivery append failure');
    }

    return super.appendWorkerRunEvent(event, leaseInput);
  }
}

describe('command inbox', () => {
  it('applies pending input exactly once to the active turn', async () => {
    const repository = new InMemoryP0Repository();
    const { runSession } = await seedRunningRunWithCommand(repository, command());
    await acquireLease(repository, runSession.id);
    const driver = new FakeCodexSessionDriver({
      inputAcks: [{ continuity: { thread_id: 'thread-1', turn_id: 'turn-2' } }],
    });

    await applyPendingRunCommands({
      repository,
      runSessionId: runSession.id,
      workerId: lease.workerId,
      leaseToken: lease.leaseToken,
      driver,
      runtimeMetadata: {
        durability_mode: 'durable',
        driver_kind: 'fake',
        active_turn_id: 'turn-1',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'not_requested',
      },
      now: () => now,
    });
    await applyPendingRunCommands({
      repository,
      runSessionId: runSession.id,
      workerId: lease.workerId,
      leaseToken: lease.leaseToken,
      driver,
      runtimeMetadata: {
        durability_mode: 'durable',
        driver_kind: 'fake',
        active_turn_id: 'turn-1',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'not_requested',
      },
      now: () => '2026-05-08T00:00:01.000Z',
    });

    expect(driver.inputs).toEqual([
      {
        message: 'continue with the fix',
        runtimeMetadata: expect.objectContaining({ active_turn_id: 'turn-1' }),
        targetTurnId: 'turn-1',
      },
    ]);
    expect(await repository.claimNextRunCommand(runSession.id, lease.workerId, lease.leaseToken, '2026-05-08T00:00:02.000Z')).toBeUndefined();
  });

  it('emits public delivery event with fallback continuity after driver acknowledgement', async () => {
    const repository = new InMemoryP0Repository();
    const { runSession } = await seedRunningRunWithCommand(repository, command());
    await acquireLease(repository, runSession.id);
    const driver = new FakeCodexSessionDriver({
      inputAcks: [
        {
          driver_command_id: 'driver-command-1',
          continuity: {
            thread_id: 'thread-1',
            turn_id: 'turn-2',
            fallback: 'exec_resume',
            secret_token: 'do-not-leak',
          },
        },
      ],
    });

    await applyPendingRunCommands({
      repository,
      runSessionId: runSession.id,
      workerId: lease.workerId,
      leaseToken: lease.leaseToken,
      driver,
      runtimeMetadata: {
        durability_mode: 'durable',
        driver_kind: 'fake',
        active_turn_id: 'turn-1',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'not_requested',
      },
      now: () => now,
    });

    const events = await repository.listRunEvents(runSession.id);
    expect(events).toEqual([
      expect.objectContaining({
        event_type: 'user_input',
        source: 'user',
        visibility: 'public',
        summary: 'User input delivered.',
        payload: {
          command_id: 'run-command:run-session-1:continue',
          continuity: {
            thread_id: 'thread-1',
            turn_id: 'turn-2',
            fallback: 'exec_resume',
          },
        },
      }),
    ]);
  });

  it('emits fallback continuity from exec fallback driver acknowledgement without sensitive fields', async () => {
    const repository = new InMemoryP0Repository();
    const { runSession } = await seedRunningRunWithCommand(repository, command());
    await acquireLease(repository, runSession.id);
    const driver = new FakeCodexSessionDriver({
      inputAcks: [
        {
          continuity: 'resume_fallback',
          threadId: 'thread-1',
          pid: 12345,
          args: ['codex', '--resume', 'thread-1'],
          response: { token: 'do-not-leak' },
        },
      ],
    });

    await applyPendingRunCommands({
      repository,
      runSessionId: runSession.id,
      workerId: lease.workerId,
      leaseToken: lease.leaseToken,
      driver,
      runtimeMetadata: {
        durability_mode: 'durable',
        driver_kind: 'exec_fallback',
        active_turn_id: 'turn-1',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'not_requested',
      },
      now: () => now,
    });

    const events = await repository.listRunEvents(runSession.id);
    expect(events).toEqual([
      expect.objectContaining({
        event_type: 'user_input',
        payload: {
          command_id: 'run-command:run-session-1:continue',
          continuity: {
            fallback: 'resume_fallback',
            thread_id: 'thread-1',
          },
        },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain('pid');
    expect(JSON.stringify(events)).not.toContain('args');
    expect(JSON.stringify(events)).not.toContain('do-not-leak');
  });

  it('emits thread continuation from app server acknowledgement without raw response data', async () => {
    const repository = new InMemoryP0Repository();
    const { runSession } = await seedRunningRunWithCommand(repository, command());
    await acquireLease(repository, runSession.id);
    const driver = new FakeCodexSessionDriver({
      inputAcks: [
        {
          continuity: 'thread_continuation',
          threadId: 'thread-1',
          turnId: 'turn-2',
          response: { accessToken: 'do-not-leak' },
        },
      ],
    });

    await applyPendingRunCommands({
      repository,
      runSessionId: runSession.id,
      workerId: lease.workerId,
      leaseToken: lease.leaseToken,
      driver,
      runtimeMetadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'not_requested',
      },
      now: () => now,
    });

    const events = await repository.listRunEvents(runSession.id);
    expect(events).toEqual([
      expect.objectContaining({
        event_type: 'user_input',
        payload: {
          command_id: 'run-command:run-session-1:continue',
          continuity: {
            thread_id: 'thread-1',
            turn_id: 'turn-2',
          },
        },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain('response');
    expect(JSON.stringify(events)).not.toContain('do-not-leak');
  });

  it('omits continuity details for active turn steering acknowledgements', async () => {
    const repository = new InMemoryP0Repository();
    const { runSession } = await seedRunningRunWithCommand(repository, command());
    await acquireLease(repository, runSession.id);
    const driver = new FakeCodexSessionDriver({
      inputAcks: [
        {
          continuity: 'turn_steer',
          threadId: 'thread-1',
          turnId: 'turn-1',
          response: { accessToken: 'do-not-leak' },
        },
      ],
    });

    await applyPendingRunCommands({
      repository,
      runSessionId: runSession.id,
      workerId: lease.workerId,
      leaseToken: lease.leaseToken,
      driver,
      runtimeMetadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        active_turn_id: 'turn-1',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'not_requested',
      },
      now: () => now,
    });

    const events = await repository.listRunEvents(runSession.id);
    expect(events).toEqual([
      expect.objectContaining({
        event_type: 'user_input',
        payload: {
          command_id: 'run-command:run-session-1:continue',
          continuity: {},
        },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain('turn_steer');
    expect(JSON.stringify(events)).not.toContain('do-not-leak');
  });

  it('does not re-send stale claimed input with unknown delivery state and marks warning', async () => {
    const repository = new InMemoryP0Repository();
    const { runSession, command: staleCommand } = await seedRunningRunWithCommand(
      repository,
      command({
        status: 'claimed',
        claimed_by_worker_id: 'worker-old',
        claimed_at: '2026-05-08T00:00:00.000Z',
      }),
    );
    await acquireLease(repository, runSession.id);
    const driver = new FakeCodexSessionDriver();

    await applyPendingRunCommands({
      repository,
      runSessionId: runSession.id,
      workerId: lease.workerId,
      leaseToken: lease.leaseToken,
      driver,
      runtimeMetadata: {
        durability_mode: 'durable',
        driver_kind: 'fake',
        recovery_attempt_count: 1,
        effective_dangerous_mode: 'not_requested',
      },
      reclaimClaimedBefore: '2026-05-08T00:00:30.000Z',
      now: () => '2026-05-08T00:01:00.000Z',
    });

    expect(driver.inputs).toEqual([]);
    const persisted = await repository.claimNextRunCommand(runSession.id, lease.workerId, lease.leaseToken, '2026-05-08T00:01:01.000Z', {
      reclaim_claimed_before: '2026-05-08T00:01:00.000Z',
    });
    expect(persisted).toBeUndefined();
    const events = await repository.listRunEvents(runSession.id);
    expect(events).toEqual([
      expect.objectContaining({
        event_type: 'codex_warning',
        source: 'worker',
        visibility: 'public',
        payload: {
          command_id: staleCommand.id,
          reason: 'delivery_unknown_after_worker_crash',
        },
      }),
    ]);
  });

  it('does not mark input applied when delivery event append fails after driver ack', async () => {
    const repository = new FailingDeliveryEventRepository();
    const { runSession } = await seedRunningRunWithCommand(repository, command());
    await acquireLease(repository, runSession.id);
    const driver = new FakeCodexSessionDriver({
      inputAcks: [{ continuity: { thread_id: 'thread-1', turn_id: 'turn-2' } }],
    });

    await expect(
      applyPendingRunCommands({
        repository,
        runSessionId: runSession.id,
        workerId: lease.workerId,
        leaseToken: lease.leaseToken,
        driver,
        runtimeMetadata: {
          durability_mode: 'durable',
          driver_kind: 'fake',
          active_turn_id: 'turn-1',
          recovery_attempt_count: 0,
          effective_dangerous_mode: 'not_requested',
        },
        now: () => now,
      }),
    ).rejects.toThrow('injected delivery append failure');

    expect(await repository.listRunEvents(runSession.id)).toEqual([]);
    const reclaimed = await repository.claimNextRunCommand(
      runSession.id,
      lease.workerId,
      lease.leaseToken,
      '2026-05-08T00:01:00.000Z',
      { reclaim_claimed_before: '2026-05-08T00:00:30.000Z' },
    );
    expect(reclaimed).toEqual(
      expect.objectContaining({
        reclaimed: true,
        command: expect.objectContaining({
          status: 'claimed',
          driver_ack: { continuity: { thread_id: 'thread-1', turn_id: 'turn-2' } },
        }),
      }),
    );
  });
});
