import { describe, expect, it } from 'vitest';

import { evaluateRunProgress } from '../../packages/run-worker/src';

describe('watchdog', () => {
  it('treats fresh Codex activity as active', () => {
    expect(
      evaluateRunProgress({
        status: 'running',
        lastCodexActivityAt: '2026-05-08T00:00:50.000Z',
        lastWorkerHeartbeatAt: '2026-05-08T00:01:00.000Z',
        now: '2026-05-08T00:01:00.000Z',
        idleThresholdMs: 30_000,
      }),
    ).toBe('active');
  });

  it('keeps waiting_for_input waiting even when Codex activity is old', () => {
    expect(
      evaluateRunProgress({
        status: 'waiting_for_input',
        lastCodexActivityAt: '2026-05-08T00:00:00.000Z',
        lastWorkerHeartbeatAt: '2026-05-08T00:01:00.000Z',
        now: '2026-05-08T00:01:00.000Z',
        idleThresholdMs: 30_000,
      }),
    ).toBe('waiting');
  });

  it('stalls when only worker heartbeat is fresh and Codex activity is old', () => {
    expect(
      evaluateRunProgress({
        status: 'running',
        lastCodexActivityAt: '2026-05-08T00:00:00.000Z',
        lastWorkerHeartbeatAt: '2026-05-08T00:01:00.000Z',
        now: '2026-05-08T00:01:00.000Z',
        idleThresholdMs: 30_000,
      }),
    ).toBe('stalled');
  });
});
