import { describe, expect, it } from 'vitest';
import { DomainError, type RunCommand, type RunEvent, type RunSession } from '@forgeloop/domain';

import { InMemoryP0Repository, type P0Repository } from '../../packages/db/src/index';

const runtimeMetadata = {
  durability_mode: 'durable',
  recovery_attempt_count: 0,
  effective_dangerous_mode: 'confirmed',
} as const;

const now = '2026-05-05T00:00:00.000Z';

const createRepository = (): P0Repository => new InMemoryP0Repository();

const runSession = (overrides: Partial<RunSession> = {}): RunSession => ({
  id: overrides.id ?? 'run-session-1',
  execution_package_id: overrides.execution_package_id ?? 'execution-package-1',
  requested_by_actor_id: overrides.requested_by_actor_id ?? 'actor-owner',
  status: overrides.status ?? 'running',
  changed_files: overrides.changed_files ?? [],
  check_results: overrides.check_results ?? [],
  artifacts: overrides.artifacts ?? [],
  log_refs: overrides.log_refs ?? [],
  runtime_metadata: overrides.runtime_metadata ?? runtimeMetadata,
  created_at: overrides.created_at ?? now,
  updated_at: overrides.updated_at ?? now,
  ...(overrides.executor_type !== undefined ? { executor_type: overrides.executor_type } : {}),
  ...(overrides.executor_result !== undefined ? { executor_result: overrides.executor_result } : {}),
  ...(overrides.run_spec !== undefined ? { run_spec: overrides.run_spec } : {}),
  ...(overrides.summary !== undefined ? { summary: overrides.summary } : {}),
  ...(overrides.failure_kind !== undefined ? { failure_kind: overrides.failure_kind } : {}),
  ...(overrides.failure_reason !== undefined ? { failure_reason: overrides.failure_reason } : {}),
  ...(overrides.started_at !== undefined ? { started_at: overrides.started_at } : {}),
  ...(overrides.finished_at !== undefined ? { finished_at: overrides.finished_at } : {}),
});

const runEvent = (overrides: Partial<Omit<RunEvent, 'sequence' | 'cursor'>> = {}): Omit<RunEvent, 'sequence' | 'cursor'> => ({
  id: overrides.id ?? 'event-1',
  run_session_id: overrides.run_session_id ?? 'run-session-1',
  event_type: overrides.event_type ?? 'driver_started',
  source: overrides.source ?? 'worker',
  visibility: overrides.visibility ?? 'internal',
  summary: overrides.summary ?? 'Driver started.',
  payload: overrides.payload ?? {},
  created_at: overrides.created_at ?? now,
  ...(overrides.raw_ref !== undefined ? { raw_ref: overrides.raw_ref } : {}),
});

const runCommand = (overrides: Partial<RunCommand> = {}): RunCommand => ({
  id: overrides.id ?? 'command-1',
  run_session_id: overrides.run_session_id ?? 'run-session-1',
  command_type: overrides.command_type ?? 'input',
  status: overrides.status ?? 'pending',
  actor_id: overrides.actor_id ?? 'actor-owner',
  payload: overrides.payload ?? {},
  created_at: overrides.created_at ?? now,
  updated_at: overrides.updated_at ?? now,
  ...(overrides.target_thread_id !== undefined ? { target_thread_id: overrides.target_thread_id } : {}),
  ...(overrides.target_turn_id !== undefined ? { target_turn_id: overrides.target_turn_id } : {}),
  ...(overrides.claimed_by_worker_id !== undefined ? { claimed_by_worker_id: overrides.claimed_by_worker_id } : {}),
  ...(overrides.claimed_at !== undefined ? { claimed_at: overrides.claimed_at } : {}),
  ...(overrides.applied_at !== undefined ? { applied_at: overrides.applied_at } : {}),
  ...(overrides.failure_reason !== undefined ? { failure_reason: overrides.failure_reason } : {}),
  ...(overrides.driver_ack !== undefined ? { driver_ack: overrides.driver_ack } : {}),
});

describe('run runtime repository behavior', () => {
  it('assigns monotonic run event sequences and lists events after a cursor', async () => {
    const repository = createRepository();

    const first = await repository.appendRunEvent(runEvent({ id: 'event-1' }));
    const second = await repository.appendRunEvent(runEvent({ id: 'event-2' }));
    const third = await repository.appendRunEvent(runEvent({ id: 'event-3' }));

    expect(first.sequence).toBe(1);
    expect(first.cursor).toBe('0000000001');
    expect(second.sequence).toBe(2);
    expect(third.sequence).toBe(3);
    expect(await repository.getLatestRunEvent('run-session-1')).toEqual(third);
    expect(await repository.listRunEvents('run-session-1', { after: first.cursor })).toEqual([second, third]);
    expect(await repository.listRunEvents('run-session-1', { after: first.cursor, limit: 1 })).toEqual([second]);
  });

  it('keeps run event sequences unique under concurrent append pressure', async () => {
    const repository = createRepository();

    const events = await Promise.all(
      Array.from({ length: 10 }, (_, index) => repository.appendRunEvent(runEvent({ id: `event-${index + 1}` }))),
    );

    expect(events.map((event) => event.sequence).sort((left, right) => left - right)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(new Set(events.map((event) => event.cursor)).size).toBe(10);
  });

  it('claims pending commands idempotently and reclaims stale claimed commands after lease takeover', async () => {
    const repository = createRepository();

    await repository.claimRunWorkerLease({
      run_session_id: 'run-session-1',
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now,
      expires_at: '2026-05-05T00:01:00.000Z',
    });
    await repository.saveRunCommand(runCommand({ id: 'input-1', command_type: 'input' }));

    const claimed = await repository.claimNextRunCommand('run-session-1', 'worker-1', 'lease-token-1', now);
    const secondClaim = await repository.claimNextRunCommand('run-session-1', 'worker-1', 'lease-token-1', now);

    expect(claimed).toMatchObject({ reclaimed: false, command: { id: 'input-1', claimed_by_worker_id: 'worker-1' } });
    expect(secondClaim).toBeUndefined();

    await repository.claimRunWorkerLease({
      run_session_id: 'run-session-1',
      worker_id: 'worker-2',
      lease_token: 'lease-token-2',
      now: '2026-05-05T00:02:00.000Z',
      expires_at: '2026-05-05T00:03:00.000Z',
    });

    const reclaimed = await repository.claimNextRunCommand(
      'run-session-1',
      'worker-2',
      'lease-token-2',
      '2026-05-05T00:02:00.000Z',
      {
        reclaim_claimed_before: '2026-05-05T00:01:30.000Z',
      },
    );

    expect(reclaimed).toMatchObject({ reclaimed: true, command: { id: 'input-1', claimed_by_worker_id: 'worker-2' } });

    await repository.markRunCommandApplied(
      'input-1',
      { workerId: 'worker-2', leaseToken: 'lease-token-2' },
      '2026-05-05T00:02:05.000Z',
      { driver_command_id: 'driver-command-1' },
    );

    expect(
      await repository.claimNextRunCommand('run-session-1', 'worker-2', 'lease-token-2', '2026-05-05T00:02:10.000Z', {
        reclaim_claimed_before: '2026-05-05T00:02:09.000Z',
      }),
    ).toBeUndefined();
  });

  it('claims cancel commands before older pending input commands', async () => {
    const repository = createRepository();

    await repository.claimRunWorkerLease({
      run_session_id: 'run-session-1',
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now,
      expires_at: '2026-05-05T00:01:00.000Z',
    });
    await repository.saveRunCommand(
      runCommand({ id: 'input-1', command_type: 'input', created_at: '2026-05-05T00:00:01.000Z' }),
    );
    await repository.saveRunCommand(
      runCommand({ id: 'cancel-1', command_type: 'cancel', created_at: '2026-05-05T00:00:02.000Z' }),
    );

    const claimed = await repository.claimNextRunCommand('run-session-1', 'worker-1', 'lease-token-1', now);

    expect(claimed?.command.id).toBe('cancel-1');
  });

  it('does not let concurrent command claim attempts claim the same command twice', async () => {
    const repository = createRepository();

    await repository.claimRunWorkerLease({
      run_session_id: 'run-session-1',
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now,
      expires_at: '2026-05-05T00:01:00.000Z',
    });
    await repository.saveRunCommand(runCommand({ id: 'input-1' }));

    const claims = await Promise.all(
      Array.from({ length: 10 }, () => repository.claimNextRunCommand('run-session-1', 'worker-1', 'lease-token-1', now)),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.filter(Boolean)[0]?.command.id).toBe('input-1');
  });

  it('does not mutate terminal commands through the same worker lease', async () => {
    const repository = createRepository();
    const lease = { workerId: 'worker-1', leaseToken: 'lease-token-1' };

    await repository.claimRunWorkerLease({
      run_session_id: 'run-session-1',
      worker_id: lease.workerId,
      lease_token: lease.leaseToken,
      now,
      expires_at: '2026-05-05T00:01:00.000Z',
    });
    await repository.saveRunCommand(runCommand({ id: 'apply-then-terminal' }));
    await repository.saveRunCommand(runCommand({ id: 'fail-then-terminal' }));

    expect(await repository.claimNextRunCommand('run-session-1', lease.workerId, lease.leaseToken, now)).toMatchObject({
      command: { id: 'apply-then-terminal' },
    });
    await repository.markRunCommandApplied(
      'apply-then-terminal',
      lease,
      '2026-05-05T00:00:10.000Z',
      { driver_command_id: 'driver-command-1' },
    );
    await expect(
      repository.markRunCommandFailed(
        'apply-then-terminal',
        lease,
        'Should not overwrite applied command.',
        '2026-05-05T00:00:11.000Z',
      ),
    ).rejects.toMatchObject<Partial<DomainError>>({ name: 'DomainError', code: 'INVALID_TRANSITION' });
    await expect(
      repository.recordRunCommandDriverAck(
        'apply-then-terminal',
        lease,
        { driver_command_id: 'driver-command-after-applied' },
        '2026-05-05T00:00:12.000Z',
      ),
    ).rejects.toMatchObject<Partial<DomainError>>({ name: 'DomainError', code: 'INVALID_TRANSITION' });

    expect(await repository.claimNextRunCommand('run-session-1', lease.workerId, lease.leaseToken, now)).toMatchObject({
      command: { id: 'fail-then-terminal' },
    });
    await repository.markRunCommandFailed(
      'fail-then-terminal',
      lease,
      'Driver failed.',
      '2026-05-05T00:00:13.000Z',
    );
    await expect(
      repository.markRunCommandApplied(
        'fail-then-terminal',
        lease,
        '2026-05-05T00:00:14.000Z',
        { driver_command_id: 'driver-command-after-failed' },
      ),
    ).rejects.toMatchObject<Partial<DomainError>>({ name: 'DomainError', code: 'INVALID_TRANSITION' });
    await expect(
      repository.recordRunCommandDriverAck(
        'fail-then-terminal',
        lease,
        { driver_command_id: 'driver-command-after-failed' },
        '2026-05-05T00:00:15.000Z',
      ),
    ).rejects.toMatchObject<Partial<DomainError>>({ name: 'DomainError', code: 'INVALID_TRANSITION' });
  });

  it('claims expired leases and lists only non-terminal recoverable run sessions', async () => {
    const repository = createRepository();

    await repository.saveRunSession(runSession({ id: 'queued-run', status: 'queued', created_at: '2026-05-05T00:00:01.000Z' }));
    await repository.saveRunSession(runSession({ id: 'running-run', status: 'running', created_at: '2026-05-05T00:00:02.000Z' }));
    await repository.saveRunSession(
      runSession({ id: 'waiting-run', status: 'waiting_for_input', created_at: '2026-05-05T00:00:03.000Z' }),
    );
    await repository.saveRunSession(runSession({ id: 'stalled-run', status: 'stalled', created_at: '2026-05-05T00:00:04.000Z' }));
    await repository.saveRunSession(runSession({ id: 'resuming-run', status: 'resuming', created_at: '2026-05-05T00:00:05.000Z' }));
    await repository.saveRunSession(
      runSession({ id: 'cancel-run', status: 'cancel_requested', created_at: '2026-05-05T00:00:06.000Z' }),
    );
    await repository.saveRunSession(runSession({ id: 'done-run', status: 'succeeded', created_at: '2026-05-05T00:00:07.000Z' }));

    await repository.claimRunWorkerLease({
      run_session_id: 'running-run',
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now,
      expires_at: '2026-05-05T00:00:10.000Z',
    });
    const lease = await repository.claimRunWorkerLease({
      run_session_id: 'running-run',
      worker_id: 'worker-2',
      lease_token: 'lease-token-2',
      now: '2026-05-05T00:00:11.000Z',
      expires_at: '2026-05-05T00:01:00.000Z',
    });

    expect(lease.worker_id).toBe('worker-2');
    expect((await repository.listRecoverableRunSessions()).map((session) => session.id)).toEqual([
      'queued-run',
      'running-run',
      'waiting-run',
      'stalled-run',
      'resuming-run',
      'cancel-run',
    ]);
  });

  it('does not let concurrent workers own the same active lease', async () => {
    const repository = createRepository();

    const claims = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) =>
        repository.claimRunWorkerLease({
          run_session_id: 'run-session-1',
          worker_id: `worker-${index + 1}`,
          lease_token: `lease-token-${index + 1}`,
          now,
          expires_at: '2026-05-05T00:01:00.000Z',
        }),
      ),
    );

    expect(claims.filter((claim) => claim.status === 'fulfilled')).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === 'rejected')).toHaveLength(9);
  });

  it('rejects stale worker-owned writes after another worker takes over the lease', async () => {
    const repository = createRepository();

    await repository.claimRunWorkerLease({
      run_session_id: 'run-session-1',
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now,
      expires_at: '2026-05-05T00:00:10.000Z',
    });
    await repository.claimRunWorkerLease({
      run_session_id: 'run-session-1',
      worker_id: 'worker-2',
      lease_token: 'lease-token-2',
      now: '2026-05-05T00:00:11.000Z',
      expires_at: '2026-05-05T00:01:00.000Z',
    });

    await expect(
      repository.appendWorkerRunEvent(runEvent({ id: 'event-1' }), {
        workerId: 'worker-1',
        leaseToken: 'lease-token-1',
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({ name: 'DomainError', code: 'INVALID_TRANSITION' });
  });

  it('fences worker supersession of pending commands by worker id and lease token', async () => {
    const repository = createRepository();

    await repository.claimRunWorkerLease({
      run_session_id: 'run-session-1',
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now,
      expires_at: '2026-05-05T00:00:10.000Z',
    });
    await repository.saveRunCommand(runCommand({ id: 'input-1', command_type: 'input' }));
    await repository.claimRunWorkerLease({
      run_session_id: 'run-session-1',
      worker_id: 'worker-2',
      lease_token: 'lease-token-2',
      now: '2026-05-05T00:00:11.000Z',
      expires_at: '2026-05-05T00:01:00.000Z',
    });

    await expect(
      repository.supersedePendingRunCommandsForWorker(
        'run-session-1',
        ['input'],
        { workerId: 'worker-1', leaseToken: 'lease-token-1' },
        '2026-05-05T00:00:12.000Z',
      ),
    ).rejects.toMatchObject<Partial<DomainError>>({ name: 'DomainError', code: 'INVALID_TRANSITION' });

    await repository.supersedePendingRunCommandsForWorker(
      'run-session-1',
      ['input'],
      { workerId: 'worker-2', leaseToken: 'lease-token-2' },
      '2026-05-05T00:00:13.000Z',
    );

    expect(await repository.claimNextRunCommand('run-session-1', 'worker-2', 'lease-token-2', '2026-05-05T00:00:14.000Z')).toBeUndefined();
  });
});
