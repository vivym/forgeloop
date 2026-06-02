import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

import { codexCanonicalDigest, type CodexLaunchMaterialization } from '@forgeloop/domain';
import { effectiveConfigFromResponse, type CodexAppServerTransport } from '../../packages/codex-runtime/src/index';

import { DockerizedCodexAppServerLauncher } from '../../packages/codex-worker-runtime/src/app-server-launcher';
import { FakeDockerRunner } from '../../packages/codex-worker-runtime/src/fake-docker-runner';

const digest = (char: string) => `sha256:${char.repeat(64)}`;

const dockerProxyNetworkPolicy = (): CodexLaunchMaterialization['profile_revision']['network_policy'] => {
  const allowlistRules = [{ id: 'openai', protocol: 'https' as const, host: 'api.openai.com', purpose: 'model_provider' as const }];
  const providerConfig = {
    proxy_image: 'ghcr.io/forgeloop/proxy',
    proxy_image_digest: digest('b'),
    self_test_image: 'ghcr.io/forgeloop/self-test',
    self_test_image_digest: digest('c'),
  };
  return {
    mode: 'egress_allowlist',
    provider: 'docker_network_proxy',
    allowlist_rules: allowlistRules,
    provider_config: {
      ...providerConfig,
      provider_config_digest: codexCanonicalDigest(providerConfig),
    },
    egress_allowlist_digest: codexCanonicalDigest({
      provider: 'docker_network_proxy',
      allowlist_rules: allowlistRules,
    }),
    self_test_digest: providerConfig.self_test_image_digest,
  };
};

const materialization = (
  tempRoot: string,
  overrides: { networkPolicy?: CodexLaunchMaterialization['profile_revision']['network_policy'] } = {},
): CodexLaunchMaterialization => ({
  launch_target: {
    target_type: 'automation_action_run',
    target_id: 'action-1',
    target_kind: 'generation',
    project_id: 'proj',
    repo_id: 'repo',
  },
  lease_id: 'lease-1',
  expires_at: '2026-05-21T00:15:00.000Z',
  materialized_at: '2026-05-21T00:00:00.000Z',
  resolved_credentials: [
    {
      binding_id: 'cred-1',
      binding_version_id: 'cred-v1',
      payload: { OPENAI_API_KEY: 'sk-test' },
      payload_digest: digest('e'),
    },
  ],
  profile_revision: {
    id: 'profile-rev-1',
    profile_id: 'profile-1',
    revision_number: 1,
    status: 'active',
    environment: 'test',
    docker_image: 'ghcr.io/forgeloop/codex',
    docker_image_digest: digest('a'),
    target_kind: 'generation',
    source_access_mode: 'artifact_only',
    codex_config_toml: 'approval_policy = "never"',
    codex_config_digest: codexCanonicalDigest('approval_policy = "never"'),
    expected_effective_config_digest: codexCanonicalDigest({
      target_kind: 'generation',
      approval_policy: 'never',
      source_write_policy: 'artifact_only',
      forbidden_writable_roots: ['workspace'],
    }),
    effective_config_assertions: {
      target_kind: 'generation',
      approval_policy: 'never',
      source_write_policy: 'artifact_only',
      forbidden_writable_roots: ['workspace'],
    },
    app_server_required: true,
    allowed_driver_kind: 'app_server',
    network_policy: overrides.networkPolicy ?? { mode: 'disabled' },
    resource_limits: {
      cpu_ms: 1000,
      memory_mb: 512,
      pids: 64,
      fds: 128,
      workspace_bytes: 0,
      artifact_bytes: 1000,
      timeout_ms: 60_000,
      output_limit_bytes: 1000,
      run_output_limit_bytes: 1000,
    },
    docker_policy: {
      app_server_only: true,
      rootless: true,
      read_only_rootfs: true,
      no_new_privileges: true,
      drop_capabilities: ['ALL'],
    },
    allowed_scopes: [{ project_id: 'proj', repo_id: 'repo' }],
    profile_digest: digest('f'),
    created_by_actor_id: 'actor',
    created_at: '2026-05-21T00:00:00.000Z',
  },
});

describe('DockerizedCodexAppServerLauncher', () => {
  it('materializes once, writes per-task files, starts Docker, returns internal endpoint and public-safe evidence', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-worker-'));
    const runner = new FakeDockerRunner({
      effectiveConfig: {
        target_kind: 'generation',
        approval_policy: 'never',
        source_write_policy: 'artifact_only',
        forbidden_writable_roots: ['workspace'],
      },
    });
    const terminalized: unknown[] = [];
    const launcher = new DockerizedCodexAppServerLauncher({
      dockerBin: 'docker',
      workerId: 'worker-1',
      workerSessionToken: 'session-1',
      workerTempRoot,
      dockerRunner: runner,
      controlPlaneClient: {
        materializeLaunchLease: async () => materialization(workerTempRoot),
        terminalizeLaunchLease: async (input: unknown) => {
          terminalized.push(input);
          return {};
        },
      },
      hostUid: 501,
      hostGid: 20,
      nonceFactory: () => 'nonce-1',
      now: () => '2026-05-21T00:00:00.000Z',
    });

    const session = await launcher.launchFromLease({ leaseId: 'lease-1', launchToken: 'launch-secret' });

    expect(session.endpoint).toMatch(/^docker-exec:sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(session.publicEvidence)).not.toContain(workerTempRoot);
    expect(session.publicEvidence).toMatchObject({
      runtime_profile_id: 'profile-1',
      runtime_profile_revision_id: 'profile-rev-1',
      launch_lease_id: 'lease-1',
      docker_image_digest: digest('a'),
    });
    expect(runner.startedCommands).toHaveLength(1);
    await expect(stat(join(workerTempRoot, 'lease-1', 'codex-home', 'auth.json'))).resolves.toBeDefined();

    await session.close('succeeded', 'done');
    expect(terminalized).toHaveLength(1);
    await expect(stat(join(workerTempRoot, 'lease-1'))).rejects.toThrow();
  });

  it('runs restore before app-server start and successful packaging before cleanup', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-worker-'));
    const events: string[] = [];
    const runner = new FakeDockerRunner({
      effectiveConfig: {
        target_kind: 'generation',
        approval_policy: 'never',
        source_write_policy: 'artifact_only',
        forbidden_writable_roots: ['workspace'],
      },
    });
    const originalStart = runner.start.bind(runner);
    runner.start = async (command) => {
      events.push('docker-start');
      return originalStart(command);
    };
    const launcher = new DockerizedCodexAppServerLauncher({
      dockerBin: 'docker',
      workerId: 'worker-1',
      workerSessionToken: 'session-1',
      workerTempRoot,
      dockerRunner: runner,
      controlPlaneClient: {
        materializeLaunchLease: async () => materialization(workerTempRoot),
        terminalizeLaunchLease: async () => ({}),
      },
      hostUid: 501,
      hostGid: 20,
      nonceFactory: () => 'nonce-1',
      now: () => '2026-05-21T00:00:00.000Z',
    });

    const session = await launcher.startFromMaterialization(materialization(workerTempRoot), {
      workerSessionToken: 'session-1',
      restoreCodexHome: async (codexHomeHostPath) => {
        events.push(`restore:${await readFile(join(codexHomeHostPath, 'config.toml'), 'utf8').catch(() => 'no-config')}`);
      },
      beforeAppServerStart: async ({ codexHomeHostPath }) => {
        events.push(`before-start:${await readFile(join(codexHomeHostPath, 'config.toml'), 'utf8')}`);
      },
      beforeRuntimeCleanup: async ({ codexHomeHostPath, status }) => {
        await stat(codexHomeHostPath);
        events.push(`before-cleanup:${status}`);
      },
    });

    await session.close('succeeded', 'done');

    expect(events).toEqual([
      'restore:no-config',
      'before-start:approval_policy = "never"',
      'docker-start',
      'before-cleanup:succeeded',
    ]);
    await expect(stat(join(workerTempRoot, 'lease-1'))).rejects.toThrow();
  });

  it('starts websocket app-server sessions with private bearer auth material', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-worker-'));
    const runner = new FakeDockerRunner({
      effectiveConfig: {
        target_kind: 'generation',
        approval_policy: 'never',
        source_write_policy: 'artifact_only',
        forbidden_writable_roots: ['workspace'],
      },
    });
    const launcher = new DockerizedCodexAppServerLauncher({
      dockerBin: 'docker',
      workerId: 'worker-1',
      workerSessionToken: 'session-1',
      workerTempRoot,
      dockerRunner: runner,
      controlPlaneClient: {
        materializeLaunchLease: async () => materialization(workerTempRoot, { networkPolicy: dockerProxyNetworkPolicy() }),
        terminalizeLaunchLease: async () => ({}),
      },
      appServerTransport: 'websocket',
      hostUid: 501,
      hostGid: 20,
      nonceFactory: () => 'nonce-1',
      websocketTokenFactory: () => 'secret-token',
      now: () => '2026-05-21T00:00:00.000Z',
    });

    const session = await launcher.launchFromLease({ leaseId: 'lease-1', launchToken: 'launch-secret' });

    expect(session.endpoint).toMatch(/^ws:\/\/127\.0\.0\.1:/);
    expect(session.endpointAuth).toEqual({ bearerToken: 'secret-token' });
    expect(JSON.stringify(session.publicEvidence)).not.toContain('secret-token');
    expect(runner.startedCommands[1]?.args.join(' ')).not.toContain('secret-token');
    await expect(readFile(join(workerTempRoot, 'lease-1', 'run', 'ws-token'), 'utf8')).resolves.toBe('secret-token');

    await session.close('succeeded', 'done');
    await expect(stat(join(workerTempRoot, 'lease-1'))).rejects.toThrow();
  });

  it('starts docker-exec app-server sessions with a private exec transport factory', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-worker-'));
    const runner = new FakeDockerRunner();
    const createdTransports: Array<{ containerId: string; socketContainerPath: string }> = [];
    const launcher = new DockerizedCodexAppServerLauncher({
      dockerBin: 'docker',
      workerId: 'worker-1',
      workerSessionToken: 'session-1',
      workerTempRoot,
      dockerRunner: runner,
      controlPlaneClient: {
        materializeLaunchLease: async () => materialization(workerTempRoot),
        terminalizeLaunchLease: async () => ({}),
      },
      appServerTransport: 'docker_exec',
      dockerExecTransportFactory: (input) => {
        createdTransports.push(input);
        return {
          initialize: async () => undefined,
          request: async () => ({
            config: {
              approval_policy: 'never',
            },
          }),
          close: async () => undefined,
        } satisfies CodexAppServerTransport;
      },
      effectiveConfigProbe: async (endpoint, auth, createTransport) => {
        expect(endpoint).toMatch(/^docker-exec:sha256:[a-f0-9]{64}$/);
        expect(auth).toBeUndefined();
        expect(createTransport).toBeDefined();
        const transport = createTransport?.();
        await transport?.initialize?.();
        const response = await transport?.request('config/read', { includeLayers: false });
        await transport?.close?.();
        return (response as { config: Record<string, unknown> }).config;
      },
      hostUid: 501,
      hostGid: 20,
      nonceFactory: () => 'nonce-1',
      now: () => '2026-05-21T00:00:00.000Z',
    });

    const session = await launcher.launchFromLease({ leaseId: 'lease-1', launchToken: 'launch-secret' });

    expect(session.endpoint).toMatch(/^docker-exec:sha256:[a-f0-9]{64}$/);
    expect(session.endpointAuth).toBeUndefined();
    expect(session.createTransport).toBeDefined();
    expect(createdTransports).toEqual([{ containerId: 'fake-container-1', socketContainerPath: '/run/forgeloop/codex.sock' }]);
    expect(JSON.stringify(session.publicEvidence)).not.toContain('fake-container-1');
    expect(runner.startedCommands[0]?.args).toContain('--tmpfs');
    expect(runner.startedCommands[0]?.args).not.toContain(`${join(workerTempRoot, 'lease-1', 'run')}:/run/forgeloop:rw`);

    await session.close('succeeded', 'done');
    await expect(stat(join(workerTempRoot, 'lease-1'))).rejects.toThrow();
  });

  it('hashes Codex 0.132 config/read output using the canonical evidence contract', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-worker-'));
    const runner = new FakeDockerRunner();
    const launcher = new DockerizedCodexAppServerLauncher({
      dockerBin: 'docker',
      workerId: 'worker-1',
      workerSessionToken: 'session-1',
      workerTempRoot,
      dockerRunner: runner,
      controlPlaneClient: {
        materializeLaunchLease: async () => materialization(workerTempRoot),
        terminalizeLaunchLease: async () => ({}),
      },
      appServerTransport: 'docker_exec',
      effectiveConfigProbe: async () =>
        effectiveConfigFromResponse({
          config: {
            approval_policy: 'never',
            sandbox: null,
          },
        }) as Record<string, unknown>,
      hostUid: 501,
      hostGid: 20,
      nonceFactory: () => 'nonce-1',
      now: () => '2026-05-21T00:00:00.000Z',
    });

    const session = await launcher.launchFromLease({ leaseId: 'lease-1', launchToken: 'launch-secret' });

    expect(session.publicEvidence.app_server_effective_config_digest).toBe(
      codexCanonicalDigest({
        target_kind: 'generation',
        approval_policy: 'never',
        source_write_policy: 'artifact_only',
        forbidden_writable_roots: ['workspace'],
      }),
    );

    await session.close('succeeded', 'done');
    await expect(stat(join(workerTempRoot, 'lease-1'))).rejects.toThrow();
  });

  it('bounds a hung effective-config probe during startup', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-worker-'));
    const runner = new FakeDockerRunner();
    let releaseProbe: ((error: Error) => void) | undefined;
    const launcher = new DockerizedCodexAppServerLauncher({
      dockerBin: 'docker',
      workerId: 'worker-1',
      workerSessionToken: 'session-1',
      workerTempRoot,
      dockerRunner: runner,
      controlPlaneClient: {
        materializeLaunchLease: async () => materialization(workerTempRoot),
        terminalizeLaunchLease: async () => ({}),
      },
      appServerTransport: 'docker_exec',
      startupProbeTimeoutMs: 75,
      effectiveConfigProbe: async () =>
        new Promise<Record<string, unknown>>((_resolve, reject) => {
          releaseProbe = reject;
        }),
      hostUid: 501,
      hostGid: 20,
      nonceFactory: () => 'nonce-1',
      now: () => '2026-05-21T00:00:00.000Z',
    });
    const launch = launcher.launchFromLease({ leaseId: 'lease-1', launchToken: 'launch-secret' });

    try {
      const result = await Promise.race([
        launch.then(
          () => 'resolved',
          (error: unknown) => `rejected:${error instanceof Error ? error.message : 'unknown'}`,
        ),
        delay(750).then(() => 'probe_still_hung'),
      ]);
      expect(result).not.toBe('probe_still_hung');
      expect(result).toBe('rejected:codex_app_server_unavailable');
      await expect(launch).rejects.toThrow(/codex_app_server_unavailable/);
    } finally {
      releaseProbe?.(new Error('released_probe'));
      await launch.catch(() => undefined);
    }

    expect(runner.stoppedContainerDigests).toHaveLength(1);
    await expect(stat(join(workerTempRoot, 'lease-1'))).rejects.toThrow();
  });

  it('cleans task files and stops Docker even when terminalization fails', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-worker-'));
    const runner = new FakeDockerRunner({
      effectiveConfig: {
        target_kind: 'generation',
        approval_policy: 'never',
        source_write_policy: 'artifact_only',
        forbidden_writable_roots: ['workspace'],
      },
    });
    const launcher = new DockerizedCodexAppServerLauncher({
      dockerBin: 'docker',
      workerId: 'worker-1',
      workerSessionToken: 'session-1',
      workerTempRoot,
      dockerRunner: runner,
      controlPlaneClient: {
        materializeLaunchLease: async () => materialization(workerTempRoot),
        terminalizeLaunchLease: async () => {
          throw new Error('terminalize failed');
        },
      },
      hostUid: 501,
      hostGid: 20,
      nonceFactory: () => 'nonce-1',
      now: () => '2026-05-21T00:00:00.000Z',
    });

    const session = await launcher.launchFromLease({ leaseId: 'lease-1', launchToken: 'launch-secret' });

    await expect(session.close('failed', 'failed')).rejects.toThrow(/terminalize failed/);
    expect(runner.stoppedContainerDigests).toHaveLength(1);
    await expect(stat(join(workerTempRoot, 'lease-1'))).rejects.toThrow();
  });

  it('terminalizes a materialized lease when Docker startup assertions fail', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-worker-'));
    const runner = new FakeDockerRunner({
      effectiveConfig: {
        target_kind: 'generation',
        approval_policy: 'on-request',
        source_write_policy: 'artifact_only',
        forbidden_writable_roots: ['workspace'],
      },
    });
    const terminalized: unknown[] = [];
    const launcher = new DockerizedCodexAppServerLauncher({
      dockerBin: 'docker',
      workerId: 'worker-1',
      workerSessionToken: 'session-1',
      workerTempRoot,
      dockerRunner: runner,
      controlPlaneClient: {
        materializeLaunchLease: async () => materialization(workerTempRoot),
        terminalizeLaunchLease: async (_workerId, _leaseId, input) => {
          terminalized.push(input);
          return {};
        },
      },
      hostUid: 501,
      hostGid: 20,
      nonceFactory: () => 'nonce-1',
      now: () => '2026-05-21T00:00:00.000Z',
    });

    await expect(launcher.launchFromLease({ leaseId: 'lease-1', launchToken: 'launch-secret' })).rejects.toThrow(
      /codex_app_server_effective_config_mismatch/,
    );

    expect(terminalized).toHaveLength(1);
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'terminal',
      reason_code: 'codex_app_server_effective_config_mismatch',
      evidence_summary: {
        launch_lease_id: 'lease-1',
        app_server_attempted: true,
        selected_execution_mode: 'app_server',
        startup_blocker_code: 'codex_app_server_effective_config_mismatch',
      },
    });
    expect(runner.stoppedContainerDigests).toHaveLength(1);
    await expect(stat(join(workerTempRoot, 'lease-1'))).rejects.toThrow();
  });

  it('cleans remote-mode sessions without terminalizing the launch lease directly', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-worker-'));
    const runner = new FakeDockerRunner({
      effectiveConfig: {
        target_kind: 'generation',
        approval_policy: 'never',
        source_write_policy: 'artifact_only',
        forbidden_writable_roots: ['workspace'],
      },
    });
    const terminalized: unknown[] = [];
    const launcher = new DockerizedCodexAppServerLauncher({
      dockerBin: 'docker',
      workerId: 'worker-1',
      workerSessionToken: 'session-1',
      workerTempRoot,
      dockerRunner: runner,
      controlPlaneClient: {
        materializeLaunchLease: async () => materialization(workerTempRoot),
        terminalizeLaunchLease: async (_workerId, _leaseId, input) => {
          terminalized.push(input);
          return {};
        },
      },
      hostUid: 501,
      hostGid: 20,
      nonceFactory: () => 'nonce-1',
      now: () => '2026-05-21T00:00:00.000Z',
    });

    const session = await launcher.startFromMaterialization(materialization(workerTempRoot), {
      workerSessionToken: 'session-1',
      terminalizeLaunchLeaseOnClose: false,
    });

    await expect(stat(join(workerTempRoot, 'lease-1', 'codex-home', 'auth.json'))).resolves.toBeDefined();
    await session.close('succeeded', 'remote runtime job terminalized');

    expect(terminalized).toEqual([]);
    expect(runner.stoppedContainerDigests).toHaveLength(1);
    await expect(stat(join(workerTempRoot, 'lease-1'))).rejects.toThrow();
  });

  it('does not terminalize the launch lease directly when remote-mode startup fails', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-worker-'));
    const runner = new FakeDockerRunner({
      effectiveConfig: {
        target_kind: 'generation',
        approval_policy: 'on-request',
        source_write_policy: 'artifact_only',
        forbidden_writable_roots: ['workspace'],
      },
    });
    const terminalized: unknown[] = [];
    const launcher = new DockerizedCodexAppServerLauncher({
      dockerBin: 'docker',
      workerId: 'worker-1',
      workerSessionToken: 'session-1',
      workerTempRoot,
      dockerRunner: runner,
      controlPlaneClient: {
        materializeLaunchLease: async () => materialization(workerTempRoot),
        terminalizeLaunchLease: async (_workerId, _leaseId, input) => {
          terminalized.push(input);
          return {};
        },
      },
      hostUid: 501,
      hostGid: 20,
      nonceFactory: () => 'nonce-1',
      now: () => '2026-05-21T00:00:00.000Z',
    });

    await expect(
      launcher.startFromMaterialization(materialization(workerTempRoot), {
        workerSessionToken: 'session-1',
        terminalizeLaunchLeaseOnClose: false,
      }),
    ).rejects.toThrow(/codex_app_server_effective_config_mismatch/);

    expect(terminalized).toEqual([]);
    expect(runner.stoppedContainerDigests).toHaveLength(1);
    await expect(stat(join(workerTempRoot, 'lease-1'))).rejects.toThrow();
  });
});
