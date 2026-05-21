import { randomUUID } from 'node:crypto';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { codexCanonicalDigest } from '@forgeloop/domain';

import type { DockerRunner } from './docker-runner.js';

export interface ScavengeCodexWorkerResourcesInput {
  workerId: string;
  workerTempRoot: string;
  dockerRunner: DockerRunner;
  workerSessionToken: string;
  controlPlaneClient: {
    getLaunchLeaseStatus(input: { workerId: string; launchLeaseId: string }): Promise<{ status: string }>;
    terminalizeLaunchLease(workerId: string, leaseId: string, input: Record<string, unknown>): Promise<unknown>;
  };
  now?: () => string;
  nonceFactory?: () => string;
}

const terminalStatuses = new Set(['expired', 'revoked', 'terminal']);

export const scavengeCodexWorkerResources = async (input: ScavengeCodexWorkerResourcesInput): Promise<void> => {
  const entries = await readdir(input.workerTempRoot, { withFileTypes: true }).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  });

  const scavengableLeaseIds = new Set<string>();
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const leaseRoot = join(input.workerTempRoot, entry.name);
    const metadataPath = join(leaseRoot, '.forgeloop-resource.json');
    const metadata = await readFile(metadataPath, 'utf8')
      .then((value) => JSON.parse(value) as { workerId?: string; launchLeaseId?: string })
      .catch(() => ({ workerId: input.workerId, launchLeaseId: entry.name }));
    if (metadata.workerId !== input.workerId || metadata.launchLeaseId === undefined) {
      continue;
    }

    const status = await input.controlPlaneClient.getLaunchLeaseStatus({
      workerId: input.workerId,
      launchLeaseId: metadata.launchLeaseId,
    });
    if (!terminalStatuses.has(status.status)) {
      throw new Error('codex_worker_unavailable: launch lease status cannot be safely scavenged');
    }
    scavengableLeaseIds.add(metadata.launchLeaseId);
    await input.controlPlaneClient.terminalizeLaunchLease(input.workerId, metadata.launchLeaseId, {
      worker_session_token: input.workerSessionToken,
      nonce: input.nonceFactory?.() ?? randomUUID(),
      nonce_timestamp: input.now?.() ?? new Date().toISOString(),
      terminal_status: 'terminal',
      reason_code: 'codex_worker_scavenged_stale_resource',
      evidence_summary: { cleanup_digest: codexCanonicalDigest({ lease: metadata.launchLeaseId, status: status.status }) },
      idempotency_key: codexCanonicalDigest({ lease: metadata.launchLeaseId, operation: 'scavenge' }),
    });
    await rm(leaseRoot, { recursive: true, force: true });
  }

  const containers = await input.dockerRunner.listByLabel({ 'forgeloop.worker_id': input.workerId });
  for (const container of containers) {
    const leaseId = container.labels?.['forgeloop.launch_lease_id'] ?? container.labels?.launch_lease_id;
    if (leaseId === undefined || leaseId.length === 0) {
      throw new Error('codex_worker_unavailable: container launch lease label is required for safe scavenging');
    }
    if (!scavengableLeaseIds.has(leaseId)) {
      const status = await input.controlPlaneClient.getLaunchLeaseStatus({
        workerId: input.workerId,
        launchLeaseId: leaseId,
      });
      if (!terminalStatuses.has(status.status)) {
        throw new Error('codex_worker_unavailable: active launch lease container cannot be scavenged');
      }
    }
    await container.stop();
  }
};
