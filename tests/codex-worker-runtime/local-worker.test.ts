import { describe, expect, it } from 'vitest';

import { createLocalCodexWorkerRuntime } from '../../packages/codex-worker-runtime/src/local-worker';

describe('local codex worker runtime', () => {
  it('registers, scavenges before heartbeat, selects compatible leases, and releases concurrency slots', async () => {
    const calls: string[] = [];
    const registrations: Record<string, unknown>[] = [];
    const worker = createLocalCodexWorkerRuntime({
      workerId: 'worker-1',
      workerIdentity: 'local-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      authorizedScopes: [{ project_id: 'proj', repo_id: 'repo' }],
      capabilities: ['generation'],
      dockerImageDigests: ['sha256:' + 'a'.repeat(64)],
      networkPolicyDigests: ['sha256:' + 'b'.repeat(64)],
      networkProviderConfigDigests: ['sha256:' + 'c'.repeat(64)],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input) => {
          calls.push('register');
          registrations.push(input);
          return { session_token: 'session-1', session_expires_at: '2026-05-21T00:15:00.000Z' };
        },
        heartbeatWorker: async () => {
          calls.push('heartbeat');
          return {};
        },
      },
      scavenger: async () => {
        calls.push('scavenge');
      },
      now: () => '2026-05-21T00:00:00.000Z',
      nonceFactory: () => `nonce-${calls.length}`,
    });

    await worker.register();
    await worker.heartbeat();
    expect(calls).toEqual(['register', 'scavenge', 'heartbeat']);
    expect(registrations[0]).toMatchObject({
      network_provider_config_digests: ['sha256:' + 'c'.repeat(64)],
    });

    await expect(
      worker.selectForLaunch({
        projectId: 'proj',
        repoId: 'repo',
        dockerImageDigest: 'sha256:' + 'a'.repeat(64),
        targetKind: 'generation',
      }),
    ).resolves.toMatchObject({ workerId: 'worker-1', sessionToken: 'session-1' });

    await expect(
      worker.withLeaseSlot(async () =>
        worker.selectForLaunch({
          projectId: 'proj',
          repoId: 'repo',
          dockerImageDigest: 'sha256:' + 'a'.repeat(64),
          targetKind: 'generation',
        }),
      ),
    ).rejects.toThrow(/concurrency/);

    await expect(worker.withLeaseSlot(async () => 'ok')).resolves.toBe('ok');
  });
});
