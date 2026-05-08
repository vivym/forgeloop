import { describe, expect, it } from 'vitest';

import { DomainError, transitionRunSession, type RunSession } from '../../packages/domain/src/index';

const expectDomainError = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }

  throw new Error(`Expected DomainError ${code}`);
};

describe('long-running run session states', () => {
  const createSession = (): RunSession =>
    transitionRunSession(undefined, {
      type: 'create',
      id: 'run-session-1',
      execution_package_id: 'exec-package-1',
      requested_by_actor_id: 'actor-1',
    });

  it('supports waiting for input as a non-terminal state', () => {
    const running = transitionRunSession(createSession(), {
      type: 'worker_started',
      at: '2026-05-07T01:00:00.000Z',
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        driver_status: 'active',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'not_requested',
      },
    });
    const waiting = transitionRunSession(running, {
      type: 'waiting_for_input',
      reason: 'Operator input is required.',
      at: '2026-05-07T01:01:00.000Z',
    });

    expect(waiting.status).toBe('waiting_for_input');
    expect(waiting.updated_at).toBe('2026-05-07T01:01:00.000Z');
    expect(waiting.runtime_metadata).toMatchObject({
      durability_mode: 'durable',
      driver_kind: 'app_server',
      driver_status: 'active',
      recovery_attempt_count: 0,
      effective_dangerous_mode: 'not_requested',
    });
    expect('finished_at' in waiting).toBe(false);
  });

  it('resumes waiting and stalled sessions through a non-terminal resuming state', () => {
    const running = transitionRunSession(createSession(), { type: 'workflow_start' });
    const waiting = transitionRunSession(running, { type: 'waiting_for_input', reason: 'Need input.' });
    const resumingFromWaiting = transitionRunSession(waiting, { type: 'resume_requested' });
    const stillResuming = transitionRunSession(resumingFromWaiting, { type: 'resume_requested' });
    const recovered = transitionRunSession(stillResuming, {
      type: 'recovered',
      runtime_metadata: {
        driver_status: 'active',
        recovery_attempt_count: 1,
      },
    });
    const stalled = transitionRunSession(recovered, { type: 'stalled', reason: 'No heartbeat received.' });
    const resumingFromStalled = transitionRunSession(stalled, { type: 'resume_requested' });

    expect(resumingFromWaiting.status).toBe('resuming');
    expect(stillResuming.status).toBe('resuming');
    expect(recovered.status).toBe('running');
    expect(recovered.runtime_metadata).toMatchObject({
      durability_mode: 'durable',
      driver_status: 'active',
      recovery_attempt_count: 1,
      effective_dangerous_mode: 'not_requested',
    });
    expect(stalled.status).toBe('stalled');
    expect(resumingFromStalled.status).toBe('resuming');
    expect('finished_at' in resumingFromStalled).toBe(false);
  });

  it('requests cancellation before reaching the terminal cancelled state', () => {
    const running = transitionRunSession(createSession(), { type: 'workflow_start' });
    const cancelRequested = transitionRunSession(running, { type: 'cancel_requested' });
    const stillCancelRequested = transitionRunSession(cancelRequested, { type: 'cancel_requested' });
    const cancelled = transitionRunSession(stillCancelRequested, { type: 'cancel' });

    expect(cancelRequested.status).toBe('cancel_requested');
    expect(stillCancelRequested.status).toBe('cancel_requested');
    expect(cancelled.status).toBe('cancelled');
  });

  it('rejects resume requests for terminal runs', () => {
    const running = transitionRunSession(createSession(), { type: 'workflow_start' });
    const cancelled = transitionRunSession(running, { type: 'cancel' });

    expectDomainError(() => transitionRunSession(cancelled, { type: 'resume_requested' }), 'INVALID_TRANSITION');
  });
});
