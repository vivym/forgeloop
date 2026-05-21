import { describe, expect, it } from 'vitest';

import { codexCanonicalDigest } from '@forgeloop/domain';

import { buildCodexAppServerDockerCommand } from '../../packages/codex-worker-runtime/src/docker-command';
import type { DockerCommandInput } from '../../packages/codex-worker-runtime/src/docker-command';

const digest = (char: string) => `sha256:${char.repeat(64)}`;

const baseInput = (overrides: Partial<DockerCommandInput> = {}): DockerCommandInput => ({
  dockerBin: 'docker',
  workerId: 'worker-1',
  launchLeaseId: 'lease-1',
  targetType: 'automation_action_run',
  targetId: 'action-1',
  image: 'ghcr.io/forgeloop/codex-app-server',
  imageDigest: digest('a'),
  hostUid: 501,
  hostGid: 20,
  workspaceHostPath: '/safe/workspace',
  workspaceContainerPath: '/workspace',
  artifactHostPath: '/safe/artifacts',
  codexHomeHostPath: '/safe/codex-home',
  socketHostDir: '/safe/run',
  socketContainerPath: '/run/forgeloop/codex.sock',
  networkPolicy: { mode: 'disabled' },
  resourceLimits: {
    cpu_ms: 2000,
    memory_mb: 1024,
    pids: 128,
    fds: 256,
    workspace_bytes: 10_000_000,
    artifact_bytes: 1_000_000,
    timeout_ms: 300_000,
    output_limit_bytes: 1_000_000,
    run_output_limit_bytes: 1_000_000,
  },
  dockerPolicy: {
    app_server_only: true,
    rootless: true,
    read_only_rootfs: true,
    no_new_privileges: true,
    drop_capabilities: ['ALL'],
  },
  ...overrides,
});

const dockerProxyNetworkPolicy = (): DockerCommandInput['networkPolicy'] => {
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

describe('buildCodexAppServerDockerCommand', () => {
  it('defaults to the hardened docker-exec app-server command from a pinned image digest', () => {
    const command = buildCodexAppServerDockerCommand(baseInput());

    expect(command.executable).toBe('docker');
    expect(command.args.slice(0, 4)).toEqual(['run', '--rm', '--detach', '--name']);
    expect(command.args).toContain('--user');
    expect(command.args).toContain('501:20');
    expect(command.args).toContain('--read-only');
    expect(command.args).toContain('--security-opt');
    expect(command.args).toContain('no-new-privileges');
    expect(command.args).toContain('--cap-drop');
    expect(command.args).toContain('ALL');
    expect(command.args).toContain('--memory');
    expect(command.args).toContain('1024m');
    expect(command.args).toContain('--cpus');
    expect(command.args).toContain('2');
    expect(command.args).toContain('--pids-limit');
    expect(command.args).toContain('128');
    expect(command.args).not.toContain('--privileged');
    expect(command.args).toContain('--network');
    expect(command.args).toContain('none');
    expect(command.args).toContain('HOME=/codex-home');
    expect(command.args).toContain('/safe/codex-home:/codex-seed:ro');
    expect(command.args).not.toContain('/safe/codex-home:/codex-home:rw');
    expect(command.args).toContain('/codex-home:rw,noexec,nosuid,nodev,uid=501,gid=20,mode=700');
    expect(command.args).toContain('cp /codex-seed/config.toml /codex-home/config.toml && cp /codex-seed/auth.json /codex-home/auth.json && chmod 600 /codex-home/config.toml /codex-home/auth.json && exec "$@"');
    expect(command.args).toContain('ghcr.io/forgeloop/codex-app-server@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(command.args).not.toContain('--publish');
    expect(command.args).not.toContain('/safe/run:/run/forgeloop:rw');
    expect(command.args).toContain('/run/forgeloop:rw,noexec,nosuid,nodev,uid=501,gid=20,mode=700');
    expect(command.args).toContain('/tmp:rw,nosuid,nodev,uid=501,gid=20,mode=1777');
    expect(command.args.slice(-3)).toEqual(['app-server', '--listen', 'unix:///run/forgeloop/codex.sock']);
    expect(command.publicSummary).toMatchObject({
      worker_id: 'worker-1',
      launch_lease_id: 'lease-1',
      image_digest: digest('a'),
      network_mode: 'disabled',
      app_server_transport: 'docker_exec',
    });
    expect(command.internal).toMatchObject({
      controlTransport: 'docker_exec',
      socketContainerPath: '/run/forgeloop/codex.sock',
    });
    expect(command.internal).not.toHaveProperty('socketHostPath');
  });

  it('builds a hardened websocket app-server command without exposing the capability token', () => {
    const command = buildCodexAppServerDockerCommand(
      baseInput({
        appServerTransport: 'websocket',
        networkPolicy: dockerProxyNetworkPolicy(),
      }),
    );

    expect(command.args).toContain('--publish');
    expect(command.args).toContain('127.0.0.1::34567');
    expect(command.args.slice(-7)).toEqual([
      'app-server',
      '--listen',
      'ws://0.0.0.0:34567',
      '--ws-auth',
      'capability-token',
      '--ws-token-file',
      '/run/forgeloop/ws-token',
    ]);
    expect(command.args.join(' ')).not.toContain('Bearer');
    expect(command.args.join(' ')).not.toContain('secret-token');
    expect(command.internal).toMatchObject({ websocketContainerPort: 34567 });
  });

  it('builds a hardened docker-exec app-server command without exposing a host socket or port', () => {
    const command = buildCodexAppServerDockerCommand(baseInput({ appServerTransport: 'docker_exec' }));

    expect(command.args).not.toContain('--publish');
    expect(command.args).not.toContain('/safe/run:/run/forgeloop:rw');
    expect(command.args).toContain('--tmpfs');
    expect(command.args).toContain('/run/forgeloop:rw,noexec,nosuid,nodev,uid=501,gid=20,mode=700');
    expect(command.args).toContain('/tmp:rw,nosuid,nodev,uid=501,gid=20,mode=1777');
    expect(command.args.slice(-3)).toEqual(['app-server', '--listen', 'unix:///run/forgeloop/codex.sock']);
    expect(command.publicSummary).toMatchObject({
      app_server_transport: 'docker_exec',
    });
    expect(command.internal).toMatchObject({
      controlTransport: 'docker_exec',
      socketContainerPath: '/run/forgeloop/codex.sock',
    });
    expect(command.internal).not.toHaveProperty('socketHostPath');
    expect(command.internal).not.toHaveProperty('websocketContainerPort');
  });

  it('rejects websocket app-server transport when Docker networking is disabled', () => {
    expect(() => buildCodexAppServerDockerCommand(baseInput({ appServerTransport: 'websocket' }))).toThrow(
      /websocket app-server transport requires Docker networking/,
    );
  });

  it('rejects unpinned images and secret-looking channels', () => {
    expect(() => buildCodexAppServerDockerCommand(baseInput({ imageDigest: 'latest' }))).toThrow(/pinned sha256 digest/);
    expect(() =>
      buildCodexAppServerDockerCommand(baseInput({ codexHomeHostPath: '/Users/me/.codex' })),
    ).toThrow(/forbidden host path/);
    expect(() =>
      buildCodexAppServerDockerCommand(baseInput({ artifactHostPath: '/tmp/sk-secret-artifacts' })),
    ).toThrow(/secret-looking/);
  });

  it('rejects strict allowlist policy without a model provider rule', () => {
    const allowlistRules = [{ id: 'registry', protocol: 'https' as const, host: 'registry.npmjs.org', purpose: 'package_registry' as const }];
    const providerConfig = {
      proxy_image: 'ghcr.io/forgeloop/proxy',
      proxy_image_digest: digest('b'),
      self_test_image: 'ghcr.io/forgeloop/self-test',
      self_test_image_digest: digest('c'),
    };
    expect(() =>
      buildCodexAppServerDockerCommand(
        baseInput({
          networkPolicy: {
            mode: 'egress_allowlist',
            provider: 'docker_network_proxy',
            allowlist_rules: allowlistRules,
            provider_config: {
              proxy_image: 'ghcr.io/forgeloop/proxy',
              proxy_image_digest: digest('b'),
              self_test_image: 'ghcr.io/forgeloop/self-test',
              self_test_image_digest: digest('c'),
              provider_config_digest: codexCanonicalDigest(providerConfig),
            },
            egress_allowlist_digest: codexCanonicalDigest({
              provider: 'docker_network_proxy',
              allowlist_rules: allowlistRules,
            }),
            self_test_digest: providerConfig.self_test_image_digest,
          },
        }),
      ),
    ).toThrow(/model_provider/);
  });
});
