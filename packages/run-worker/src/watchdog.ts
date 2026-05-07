import type { RunSessionStatus } from '../../domain/src/index.js';

const isFresh = (at: string | undefined, now: string, thresholdMs: number): boolean =>
  at !== undefined && Date.parse(now) - Date.parse(at) <= thresholdMs;

export function evaluateRunProgress(input: {
  status: RunSessionStatus;
  lastCodexActivityAt?: string;
  lastWorkerHeartbeatAt?: string;
  now: string;
  idleThresholdMs: number;
}): 'active' | 'waiting' | 'stalled' {
  if (input.status === 'waiting_for_input') {
    return 'waiting';
  }

  if (isFresh(input.lastCodexActivityAt, input.now, input.idleThresholdMs)) {
    return 'active';
  }

  return 'stalled';
}
