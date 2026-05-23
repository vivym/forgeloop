import { lstat, mkdir, mkdtemp, stat, symlink, writeFile } from 'node:fs/promises';
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
    const terminalized: Record<string, unknown>[] = [];

    await scavengeCodexWorkerResources({
      workerId: 'worker-1',
      workerTempRoot,
      dockerRunner: runner,
      controlPlaneClient: {
        getLaunchLeaseStatus: async () => ({ status: 'expired' }),
        terminalizeLaunchLease: async (_workerId: string, _leaseId: string, input: Record<string, unknown>) => {
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
    expect(terminalized[0]?.evidence_summary).toEqual({
      cleanup_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(terminalized[0])).not.toContain(staleRoot);
    expect(JSON.stringify(terminalized[0])).not.toContain('abcdef123456');
    await expect(stat(staleRoot)).rejects.toThrow();
  });

  it('ignores unverified directories and symlinked temp roots without lease lookup', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-worker-'));
    const unverifiedRoot = join(workerTempRoot, 'lease-old');
    const externalRoot = await mkdtemp(join(tmpdir(), 'forgeloop-external-'));
    const symlinkedRoot = join(workerTempRoot, 'lease-symlink');
    await mkdir(unverifiedRoot);
    await writeFile(join(externalRoot, '.forgeloop-resource.json'), JSON.stringify({ workerId: 'worker-1', launchLeaseId: 'lease-symlink' }));
    await symlink(externalRoot, symlinkedRoot);

    const runner = new FakeDockerRunner();
    const statusQueries: string[] = [];

    await scavengeCodexWorkerResources({
      workerId: 'worker-1',
      workerTempRoot,
      dockerRunner: runner,
      controlPlaneClient: {
        getLaunchLeaseStatus: async ({ launchLeaseId }) => {
          statusQueries.push(launchLeaseId);
          return { status: 'expired' };
        },
        terminalizeLaunchLease: async () => ({}),
      },
      workerSessionToken: 'session-1',
    });

    await expect(stat(unverifiedRoot)).resolves.toBeDefined();
    expect((await lstat(symlinkedRoot)).isSymbolicLink()).toBe(true);
    expect(statusQueries).toEqual([]);
    expect(runner.stoppedContainerDigests).toEqual([]);
  });

  it('ignores temp roots whose metadata lease id does not match the directory name', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-worker-'));
    const mismatchedRoot = join(workerTempRoot, 'lease-active');
    await mkdir(mismatchedRoot);
    await writeFile(join(mismatchedRoot, '.forgeloop-resource.json'), JSON.stringify({ workerId: 'worker-1', launchLeaseId: 'lease-old' }));

    const runner = new FakeDockerRunner();
    const statusQueries: string[] = [];

    await scavengeCodexWorkerResources({
      workerId: 'worker-1',
      workerTempRoot,
      dockerRunner: runner,
      controlPlaneClient: {
        getLaunchLeaseStatus: async ({ launchLeaseId }) => {
          statusQueries.push(launchLeaseId);
          return { status: 'expired' };
        },
        terminalizeLaunchLease: async () => ({}),
      },
      workerSessionToken: 'session-1',
    });

    await expect(stat(mismatchedRoot)).resolves.toBeDefined();
    expect(statusQueries).toEqual([]);
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
