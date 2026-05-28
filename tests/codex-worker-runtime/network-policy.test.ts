import { describe, expect, it } from 'vitest';

import { codexCanonicalDigest } from '@forgeloop/domain';

import { FakeDockerRunner } from '../../packages/codex-worker-runtime/src/fake-docker-runner';
import {
  networkArgsForDocker,
  runNetworkPolicySelfTest,
  validateMaterializedNetworkPolicy,
} from '../../packages/codex-worker-runtime/src/network-policy';

const digest = (char: string) => `sha256:${char.repeat(64)}`;

describe('network policy materialization', () => {
  it('maps disabled networking to Docker network none', () => {
    expect(networkArgsForDocker({ mode: 'disabled' })).toEqual(['--network', 'none']);
  });

  it('requires executable allowlist rules and a model provider for strict egress allowlist', () => {
    expect(() =>
      validateMaterializedNetworkPolicy(
        {
          mode: 'egress_allowlist',
          provider: 'host_firewall',
          allowlist_rules: [],
          egress_allowlist_digest: codexCanonicalDigest({ provider: 'host_firewall', allowlist_rules: [] }),
          self_test_digest: digest('a'),
        },
        { strictRealDogfood: true },
      ),
    ).toThrow(
      /allowlist/,
    );
    const packageRegistryRules = [{ id: 'pkg', protocol: 'https' as const, host: 'registry.npmjs.org', purpose: 'package_registry' as const }];
    expect(() =>
      validateMaterializedNetworkPolicy(
        {
          mode: 'egress_allowlist',
          provider: 'host_firewall',
          allowlist_rules: packageRegistryRules,
          egress_allowlist_digest: codexCanonicalDigest({ provider: 'host_firewall', allowlist_rules: packageRegistryRules }),
          self_test_digest: digest('a'),
        },
        { strictRealDogfood: true },
      ),
    ).toThrow(/model_provider/);
  });

  it('plans docker network proxy setup and records self-test evidence through the fake runner', async () => {
    const runner = new FakeDockerRunner();
    const providerConfig = {
      proxy_image: 'ghcr.io/forgeloop/proxy',
      proxy_image_digest: digest('b'),
      self_test_image: 'ghcr.io/forgeloop/self-test',
      self_test_image_digest: digest('c'),
    };
    const result = await runNetworkPolicySelfTest({
      runner,
      dockerBin: '/opt/docker',
      workerId: 'worker-1',
      launchLeaseId: 'lease-1',
      hostUid: 501,
      hostGid: 20,
      policy: {
        mode: 'egress_allowlist',
        provider: 'docker_network_proxy',
        allowlist_rules: [{ id: 'openai', protocol: 'https', host: 'api.openai.com', purpose: 'model_provider' }],
        provider_config: {
          ...providerConfig,
          provider_config_digest: codexCanonicalDigest(providerConfig),
        },
        egress_allowlist_digest: codexCanonicalDigest({
          provider: 'docker_network_proxy',
          allowlist_rules: [{ id: 'openai', protocol: 'https', host: 'api.openai.com', purpose: 'model_provider' }],
        }),
        self_test_digest: providerConfig.self_test_image_digest,
      },
    });

    expect(result.publicSummary).toMatchObject({ blocked_default_egress: true, allowed_model_provider_egress: true });
    expect(result.selfTestDigest).toMatch(/^sha256:/);
    const commandText = runner.startedCommands.map((command) => command.args.join(' ')).join('\n');
    expect(runner.startedCommands.every((command) => command.executable === '/opt/docker')).toBe(true);
    expect(commandText).toContain('FORGELOOP_NETWORK_SELF_TEST=blocked_default_egress');
    expect(commandText).toContain('FORGELOOP_NETWORK_SELF_TEST=allowed_model_provider_egress');
    expect(commandText).toContain('forgeloop-net-lease-1');
  });

  it('retries model provider egress self-test while the proxy sidecar becomes ready', async () => {
    class FlakyModelProviderProbeRunner extends FakeDockerRunner {
      private allowedProbeAttempts = 0;

      override async run(input: Parameters<FakeDockerRunner['run']>[0]): ReturnType<FakeDockerRunner['run']> {
        if (input.publicSummary?.operation === 'network_self_test_allowed_model_provider_egress') {
          this.startedCommands.push(input);
          this.allowedProbeAttempts += 1;
          if (this.allowedProbeAttempts === 1) {
            return { exitCode: 1, stdout: '', stderr: 'proxy not ready' };
          }
          return { exitCode: 0, stdout: '', stderr: '' };
        }
        return super.run(input);
      }
    }
    const runner = new FlakyModelProviderProbeRunner();
    const providerConfig = {
      proxy_image: 'ghcr.io/forgeloop/proxy',
      proxy_image_digest: digest('b'),
      self_test_image: 'ghcr.io/forgeloop/self-test',
      self_test_image_digest: digest('c'),
    };

    await expect(
      runNetworkPolicySelfTest({
        runner,
        workerId: 'worker-1',
        launchLeaseId: 'lease-1',
        hostUid: 501,
        hostGid: 20,
        modelProviderProbeRetryDelayMs: 0,
        policy: {
          mode: 'egress_allowlist',
          provider: 'docker_network_proxy',
          allowlist_rules: [{ id: 'openai', protocol: 'https', host: 'api.openai.com', purpose: 'model_provider' }],
          provider_config: {
            ...providerConfig,
            provider_config_digest: codexCanonicalDigest(providerConfig),
          },
          egress_allowlist_digest: codexCanonicalDigest({
            provider: 'docker_network_proxy',
            allowlist_rules: [{ id: 'openai', protocol: 'https', host: 'api.openai.com', purpose: 'model_provider' }],
          }),
          self_test_digest: providerConfig.self_test_image_digest,
        },
      }),
    ).resolves.toMatchObject({ publicSummary: { allowed_model_provider_egress: true } });

    expect(
      runner.startedCommands.filter((command) => command.publicSummary?.operation === 'network_self_test_allowed_model_provider_egress'),
    ).toHaveLength(2);
  });

  it('cleans the proxy sidecar and internal network when self-test setup fails', async () => {
    class FailingSelfTestRunner extends FakeDockerRunner {
      override async run(input: Parameters<FakeDockerRunner['run']>[0]): ReturnType<FakeDockerRunner['run']> {
        if (input.publicSummary?.operation === 'network_self_test_allowed_model_provider_egress') {
          this.startedCommands.push(input);
          return { exitCode: 1, stdout: '', stderr: 'blocked' };
        }
        return super.run(input);
      }
    }
    const runner = new FailingSelfTestRunner();
    const providerConfig = {
      proxy_image: 'ghcr.io/forgeloop/proxy',
      proxy_image_digest: digest('b'),
      self_test_image: 'ghcr.io/forgeloop/self-test',
      self_test_image_digest: digest('c'),
    };

    await expect(
      runNetworkPolicySelfTest({
        runner,
        workerId: 'worker-1',
        launchLeaseId: 'lease-1',
        hostUid: 501,
        hostGid: 20,
        modelProviderProbeRetryDelayMs: 0,
        policy: {
          mode: 'egress_allowlist',
          provider: 'docker_network_proxy',
          allowlist_rules: [{ id: 'openai', protocol: 'https', host: 'api.openai.com', purpose: 'model_provider' }],
          provider_config: {
            ...providerConfig,
            provider_config_digest: codexCanonicalDigest(providerConfig),
          },
          egress_allowlist_digest: codexCanonicalDigest({
            provider: 'docker_network_proxy',
            allowlist_rules: [{ id: 'openai', protocol: 'https', host: 'api.openai.com', purpose: 'model_provider' }],
          }),
          self_test_digest: providerConfig.self_test_image_digest,
        },
      }),
    ).rejects.toThrow(/network self-test command failed/);

    expect(runner.stoppedContainerDigests).toHaveLength(1);
    expect(runner.startedCommands.map((command) => command.publicSummary?.operation)).toContain('network_remove');
    expect(
      runner.startedCommands.filter((command) => command.publicSummary?.operation === 'network_self_test_allowed_model_provider_egress'),
    ).toHaveLength(6);
  });
});
