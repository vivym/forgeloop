import { randomUUID } from 'node:crypto';

import type { DeliveryRepository } from '../../db/src/index.js';
import type { RunWorkerLease } from '../../domain/src/index.js';

const expiresAt = (now: string, leaseDurationMs: number): string =>
  new Date(Date.parse(now) + leaseDurationMs).toISOString();

export const acquireLeaseForRun = async (
  repository: DeliveryRepository,
  runSessionId: string,
  workerId: string,
  now: string,
  leaseDurationMs: number,
): Promise<{ lease: RunWorkerLease; leaseToken: string }> => {
  const leaseToken = randomUUID();
  const lease = await repository.claimRunWorkerLease({
    run_session_id: runSessionId,
    worker_id: workerId,
    lease_token: leaseToken,
    now,
    expires_at: expiresAt(now, leaseDurationMs),
  });

  return { lease, leaseToken };
};

export const heartbeatLease = async (
  repository: DeliveryRepository,
  runSessionId: string,
  workerId: string,
  leaseToken: string,
  now: string,
  leaseDurationMs: number,
): Promise<void> => {
  await repository.heartbeatRunWorkerLease(runSessionId, workerId, leaseToken, now, expiresAt(now, leaseDurationMs));
};

export const releaseLease = async (
  repository: DeliveryRepository,
  runSessionId: string,
  workerId: string,
  leaseToken: string,
  now: string,
): Promise<void> => {
  await repository.releaseRunWorkerLease(runSessionId, workerId, leaseToken, now);
};

export const assertLeaseStillOwned = async (
  repository: DeliveryRepository,
  runSessionId: string,
  workerId: string,
  leaseToken: string,
  now: string,
): Promise<void> => {
  await repository.assertActiveRunWorkerLease(runSessionId, workerId, leaseToken, now);
};
