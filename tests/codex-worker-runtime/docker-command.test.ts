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

describe('buildCodexAppServerDockerCommand', () => {
  it('builds a hardened docker app-server command from a pinned image digest', () => {
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
    expect(command.args).toContain('ghcr.io/forgeloop/codex-app-server@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(command.args.slice(-3)).toEqual(['app-server', '--socket', '/run/forgeloop/codex.sock']);
    expect(command.publicSummary).toMatchObject({
      worker_id: 'worker-1',
      launch_lease_id: 'lease-1',
      image_digest: digest('a'),
      network_mode: 'disabled',
    });
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
