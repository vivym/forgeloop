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
    });
    const waiting = transitionRunSession(running, {
      type: 'waiting_for_input',
      at: '2026-05-07T01:01:00.000Z',
    });

    expect(waiting.status).toBe('waiting_for_input');
    expect(waiting.updated_at).toBe('2026-05-07T01:01:00.000Z');
    expect('finished_at' in waiting).toBe(false);
  });

  it('resumes waiting and stalled sessions through a non-terminal resuming state', () => {
    const running = transitionRunSession(createSession(), { type: 'workflow_start' });
    const waiting = transitionRunSession(running, { type: 'waiting_for_input' });
    const resumingFromWaiting = transitionRunSession(waiting, { type: 'resume_requested' });
    const stillResuming = transitionRunSession(resumingFromWaiting, { type: 'resume_requested' });
    const recovered = transitionRunSession(stillResuming, { type: 'recovered' });
    const stalled = transitionRunSession(recovered, { type: 'stalled' });
    const resumingFromStalled = transitionRunSession(stalled, { type: 'resume_requested' });

    expect(resumingFromWaiting.status).toBe('resuming');
    expect(stillResuming.status).toBe('resuming');
    expect(recovered.status).toBe('running');
    expect(stalled.status).toBe('stalled');
    expect(resumingFromStalled.status).toBe('resuming');
    expect('finished_at' in resumingFromStalled).toBe(false);
  });

  it('rejects resume requests for terminal runs', () => {
    const running = transitionRunSession(createSession(), { type: 'workflow_start' });
    const cancelled = transitionRunSession(running, { type: 'cancel' });

    expectDomainError(() => transitionRunSession(cancelled, { type: 'resume_requested' }), 'INVALID_TRANSITION');
  });
});
