import {
  codexCanonicalDigest,
  codexNetworkPolicyDigestInput,
  normalizeCodexRuntimeNetworkPolicy,
  validateCodexDockerNetworkProxyConfig,
  type CodexRuntimeNetworkPolicy,
} from '@forgeloop/domain';

import type { DockerCommand } from './docker-command.js';
import type { DockerRunner, StartedDockerContainer } from './docker-runner.js';

const modelProviderProbeRetryDelaysMs = [100, 250, 500, 1_000, 2_000] as const;

const hasModelProvider = (policy: Extract<CodexRuntimeNetworkPolicy, { mode: 'egress_allowlist' }>): boolean =>
  policy.allowlist_rules.some((rule) => rule.purpose === 'model_provider');

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const validateMaterializedNetworkPolicy = (
  policy: CodexRuntimeNetworkPolicy,
  options: { strictRealDogfood?: boolean } = {},
): CodexRuntimeNetworkPolicy => {
  const normalized = normalizeCodexRuntimeNetworkPolicy(policy);
  if (normalized.mode === 'disabled') {
    return normalized;
  }
  if (normalized.allowlist_rules.length === 0) {
    throw new Error('codex_worker_docker_policy_unavailable: executable allowlist rules are required');
  }
  if (normalized.egress_allowlist_digest !== codexCanonicalDigest(codexNetworkPolicyDigestInput(normalized.provider, normalized.allowlist_rules))) {
    throw new Error('codex_worker_docker_policy_unavailable: egress allowlist digest does not match rules');
  }
  if (options.strictRealDogfood === true && !hasModelProvider(normalized)) {
    throw new Error('codex_worker_docker_policy_unavailable: model_provider allowlist rule is required');
  }
  return normalized;
};

export const networkArgsForDocker = (policy: CodexRuntimeNetworkPolicy): string[] => {
  const normalized = normalizeCodexRuntimeNetworkPolicy(policy);
  if (normalized.mode === 'disabled') {
    return ['--network', 'none'];
  }
  if (normalized.provider === 'docker_network_proxy') {
    return ['--network', 'forgeloop-net'];
  }
  return ['--network', 'bridge'];
};

export const runNetworkPolicySelfTest = async (input: {
  runner: DockerRunner;
  dockerBin?: string;
  workerId: string;
  launchLeaseId: string;
  hostUid: number;
  hostGid: number;
  policy: CodexRuntimeNetworkPolicy;
  modelProviderProbeRetryDelayMs?: number;
}): Promise<{ selfTestDigest: string; publicSummary: Record<string, unknown>; cleanup?: () => Promise<void> }> => {
  const policy = validateMaterializedNetworkPolicy(input.policy, { strictRealDogfood: input.policy.mode !== 'disabled' });
  if (policy.mode === 'disabled') {
    const publicSummary = { mode: 'disabled', blocked_default_egress: true, allowed_model_provider_egress: false };
    return { selfTestDigest: codexCanonicalDigest(publicSummary), publicSummary };
  }
  if (policy.provider !== 'docker_network_proxy') {
    throw new Error('codex_worker_docker_policy_unavailable: host firewall provider is not implemented in v0 worker runtime');
  }
  validateCodexDockerNetworkProxyConfig(policy.provider_config);

  const networkName = `forgeloop-net-${input.launchLeaseId}`;
  const proxyName = `forgeloop-proxy-${input.launchLeaseId}`;
  const allowlistDigest = policy.egress_allowlist_digest;
  const modelProviderRules = policy.allowlist_rules.filter((rule) => rule.purpose === 'model_provider');
  const dockerBin = input.dockerBin ?? 'docker';
  const runDocker = async (command: DockerCommand): Promise<void> => {
    if (input.runner.run === undefined) {
      throw new Error('codex_worker_docker_policy_unavailable: Docker foreground run support is required for network self-test');
    }
    const result = await input.runner.run(command);
    if (result.exitCode !== 0) {
      throw new Error('codex_worker_docker_policy_unavailable: network self-test command failed');
    }
  };
  const runDockerWithRetry = async (command: DockerCommand): Promise<void> => {
    const retryDelays =
      input.modelProviderProbeRetryDelayMs === undefined
        ? modelProviderProbeRetryDelaysMs
        : Array.from({ length: modelProviderProbeRetryDelaysMs.length }, () => input.modelProviderProbeRetryDelayMs!);
    for (let attempt = 1; attempt <= retryDelays.length + 1; attempt += 1) {
      try {
        await runDocker(command);
        return;
      } catch (error) {
        const retryDelayMs = retryDelays[attempt - 1];
        if (retryDelayMs === undefined) {
          throw error;
        }
        if (retryDelayMs > 0) {
          await sleep(retryDelayMs);
        }
      }
    }
  };
  const cleanupCommands: DockerCommand[] = [];
  let proxyContainer: StartedDockerContainer | undefined;
  const cleanup = async (): Promise<void> => {
    await proxyContainer?.stop().catch(() => undefined);
    for (const command of cleanupCommands) {
      await input.runner.run?.(command).catch(() => undefined);
    }
  };
  try {
    await runDocker({
      executable: dockerBin,
      args: ['network', 'create', '--internal', networkName],
      publicSummary: { operation: 'network_create', network: networkName },
    });
    cleanupCommands.push({
      executable: dockerBin,
      args: ['network', 'rm', networkName],
      publicSummary: { operation: 'network_remove', network: networkName },
    });
    proxyContainer = await input.runner.start({
      executable: dockerBin,
      args: [
        'run',
        '--rm',
        '--detach',
        '--name',
        proxyName,
        '--label',
        `forgeloop.worker_id=${input.workerId}`,
        '--label',
        `forgeloop.launch_lease_id=${input.launchLeaseId}`,
        '--label',
        'forgeloop.role=network_proxy',
        '--network',
        'bridge',
        '--env',
        `FORGELOOP_EGRESS_ALLOWLIST_DIGEST=${allowlistDigest}`,
        '--env',
        `FORGELOOP_EGRESS_ALLOWLIST_JSON=${Buffer.from(JSON.stringify(policy.allowlist_rules), 'utf8').toString('base64url')}`,
        '--user',
        `${input.hostUid}:${input.hostGid}`,
        '--security-opt',
        'no-new-privileges',
        '--cap-drop',
        'ALL',
        '--read-only',
        `${policy.provider_config.proxy_image}@${policy.provider_config.proxy_image_digest}`,
      ],
      publicSummary: { operation: 'proxy_sidecar', network: networkName },
    });
    await runDocker({
      executable: dockerBin,
      args: ['network', 'connect', '--alias', 'forgeloop-proxy', networkName, proxyName],
      publicSummary: { operation: 'proxy_connect_internal_network', network: networkName },
    });
    await runDocker({
        executable: dockerBin,
      args: [
        'run',
        '--rm',
        '--network',
        networkName,
        '--env',
        'FORGELOOP_NETWORK_SELF_TEST=blocked_default_egress',
        '--env',
        `FORGELOOP_EGRESS_ALLOWLIST_DIGEST=${allowlistDigest}`,
        '--user',
        `${input.hostUid}:${input.hostGid}`,
        '--security-opt',
        'no-new-privileges',
        '--cap-drop',
        'ALL',
        '--read-only',
        `${policy.provider_config.self_test_image}@${policy.provider_config.self_test_image_digest}`,
      ],
      publicSummary: { operation: 'network_self_test_blocked_default_egress', network: networkName },
    });
    await runDockerWithRetry({
      executable: dockerBin,
      args: [
        'run',
        '--rm',
        '--network',
        networkName,
        '--env',
        'FORGELOOP_NETWORK_SELF_TEST=allowed_model_provider_egress',
        '--env',
        'HTTPS_PROXY=http://forgeloop-proxy:8080',
        '--env',
        'HTTP_PROXY=http://forgeloop-proxy:8080',
        '--env',
        'NO_PROXY=localhost,127.0.0.1',
        '--env',
        `FORGELOOP_EGRESS_ALLOWLIST_DIGEST=${allowlistDigest}`,
        '--env',
        `FORGELOOP_MODEL_PROVIDER_ALLOWLIST_JSON=${Buffer.from(JSON.stringify(modelProviderRules), 'utf8').toString('base64url')}`,
        '--user',
        `${input.hostUid}:${input.hostGid}`,
        '--security-opt',
        'no-new-privileges',
        '--cap-drop',
        'ALL',
        '--read-only',
        `${policy.provider_config.self_test_image}@${policy.provider_config.self_test_image_digest}`,
      ],
      publicSummary: { operation: 'network_self_test_allowed_model_provider_egress', network: networkName },
    });

    const publicSummary = {
      mode: 'egress_allowlist',
      provider: 'docker_network_proxy',
      blocked_default_egress: true,
      allowed_model_provider_egress: true,
      egress_allowlist_digest: allowlistDigest,
    };
    return {
      selfTestDigest: codexCanonicalDigest(publicSummary),
      publicSummary,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
};
