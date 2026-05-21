import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { FakeDockerRunner } from '../../packages/codex-worker-runtime/src/fake-docker-runner';
import { scavengeCodexWorkerResources } from '../../packages/codex-worker-runtime/src/scavenger';

describe('scavengeCodexWorkerResources', () => {
  it('removes stale temp roots and stops stale containers after lease verification', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-worker-'));
    const staleRoot = join(workerTempRoot, 'lease-old');
    await mkdir(staleRoot);
    await writeFile(join(staleRoot, '.forgeloop-resource.json'), JSON.stringify({ workerId: 'worker-1', launchLeaseId: 'lease-old' }));

    const runner = new FakeDockerRunner();
    runner.addListedContainer({
      containerId: 'abcdef123456',
      containerIdDigest: 'sha256:' + 'c'.repeat(64),
      socketHostPath: join(staleRoot, 'run', 'codex.sock'),
      labels: { 'forgeloop.launch_lease_id': 'lease-old', 'forgeloop.worker_id': 'worker-1' },
    });
    const terminalized: unknown[] = [];

    await scavengeCodexWorkerResources({
      workerId: 'worker-1',
      workerTempRoot,
      dockerRunner: runner,
      controlPlaneClient: {
        getLaunchLeaseStatus: async () => ({ status: 'expired' }),
        terminalizeLaunchLease: async (input: unknown) => {
          terminalized.push(input);
          return {};
        },
      },
      workerSessionToken: 'session-1',
      now: () => '2026-05-21T00:00:00.000Z',
      nonceFactory: () => 'nonce-1',
    });

    expect(runner.stoppedContainerDigests).toEqual(['sha256:' + 'c'.repeat(64)]);
    expect(terminalized).toHaveLength(1);
    await expect(stat(staleRoot)).rejects.toThrow();
  });

  it('refuses to stop containers without a verifiable launch lease label', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-worker-'));
    const runner = new FakeDockerRunner();
    runner.addListedContainer({
      containerId: 'abcdef123456',
      containerIdDigest: 'sha256:' + 'c'.repeat(64),
      socketHostPath: '',
      labels: { 'forgeloop.worker_id': 'worker-1' },
    });

    await expect(
      scavengeCodexWorkerResources({
        workerId: 'worker-1',
        workerTempRoot,
        dockerRunner: runner,
        controlPlaneClient: {
          getLaunchLeaseStatus: async () => ({ status: 'expired' }),
          terminalizeLaunchLease: async () => ({}),
        },
        workerSessionToken: 'session-1',
      }),
    ).rejects.toThrow(/container launch lease label is required/);
    expect(runner.stoppedContainerDigests).toEqual([]);
  });
});
