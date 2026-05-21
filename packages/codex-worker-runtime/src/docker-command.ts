import type { CodexRuntimeNetworkPolicy, CodexRuntimeProfileRevision } from '@forgeloop/domain';

import { networkArgsForDocker, validateMaterializedNetworkPolicy } from './network-policy.js';

export interface DockerCommandInput {
  dockerBin: string;
  workerId: string;
  launchLeaseId: string;
  targetType: string;
  targetId: string;
  image: string;
  imageDigest: string;
  hostUid: number;
  hostGid: number;
  workspaceHostPath?: string;
  workspaceContainerPath: '/workspace';
  artifactHostPath: string;
  codexHomeHostPath: string;
  socketHostDir: string;
  socketContainerPath: '/run/forgeloop/codex.sock';
  networkPolicy: CodexRuntimeNetworkPolicy;
  resourceLimits: CodexRuntimeProfileRevision['resource_limits'];
  dockerPolicy: CodexRuntimeProfileRevision['docker_policy'];
}

export interface DockerCommand {
  executable: string;
  args: string[];
  publicSummary: Record<string, unknown>;
  internal?: {
    socketHostPath?: string;
  };
}

const sha256DigestPattern = /^sha256:[a-f0-9]{64}$/;
const forbiddenHostPathPattern = /(^|\/)(\.codex|\.ssh|\.git-credentials|\.npmrc|\.yarnrc|\.pnpmrc|auth\.json|config\.toml|docker\.sock)$/i;
const secretLookingPattern = /(sk-[a-z0-9_-]+|api[_-]?key|secret|token|password)/i;

const assertPinnedDigest = (value: string, label: string): void => {
  if (!sha256DigestPattern.test(value)) {
    throw new Error(`${label} must be a pinned sha256 digest.`);
  }
};

const assertSafeHostPath = (value: string): void => {
  if (!value.startsWith('/')) {
    throw new Error('Docker mount host paths must be absolute.');
  }
  if (forbiddenHostPathPattern.test(value) || value.includes('/var/run/docker.sock')) {
    throw new Error(`forbidden host path mount: ${value}`);
  }
  if (secretLookingPattern.test(value)) {
    throw new Error(`secret-looking value cannot appear in Docker argv: ${value}`);
  }
};

const bindMount = (hostPath: string, containerPath: string, mode: 'ro' | 'rw'): string => `${hostPath}:${containerPath}:${mode}`;

const label = (key: string, value: string): string => `forgeloop.${key}=${value}`;

export const buildCodexAppServerDockerCommand = (input: DockerCommandInput): DockerCommand => {
  assertPinnedDigest(input.imageDigest, 'Docker image digest');
  const networkPolicy = validateMaterializedNetworkPolicy(input.networkPolicy, { strictRealDogfood: input.networkPolicy.mode !== 'disabled' });

  const hostPaths = [
    input.artifactHostPath,
    input.codexHomeHostPath,
    input.socketHostDir,
    ...(input.workspaceHostPath === undefined ? [] : [input.workspaceHostPath]),
  ];
  hostPaths.forEach(assertSafeHostPath);

  if (!input.dockerPolicy.rootless || input.hostUid === 0 || input.hostGid === 0) {
    throw new Error('Dockerized Codex app-server must run as a non-root host UID/GID.');
  }
  if (!input.dockerPolicy.app_server_only || !input.dockerPolicy.no_new_privileges) {
    throw new Error('Docker policy cannot be represented safely by Docker CLI.');
  }
  if (!input.dockerPolicy.drop_capabilities.includes('ALL')) {
    throw new Error('Docker policy must drop all capabilities.');
  }

  const networkArgs =
    networkPolicy.mode === 'egress_allowlist' && networkPolicy.provider === 'docker_network_proxy'
      ? ['--network', `forgeloop-net-${input.launchLeaseId}`, '--env', 'HTTPS_PROXY=http://forgeloop-proxy:8080', '--env', 'HTTP_PROXY=http://forgeloop-proxy:8080', '--env', 'NO_PROXY=localhost,127.0.0.1']
      : networkArgsForDocker(networkPolicy);

  const args = [
    'run',
    '--rm',
    '--detach',
    '--name',
    `forgeloop-codex-${input.launchLeaseId}`,
    '--label',
    label('worker_id', input.workerId),
    '--label',
    label('launch_lease_id', input.launchLeaseId),
    '--label',
    label('target_type', input.targetType),
    '--label',
    label('target_id', input.targetId),
    '--user',
    `${input.hostUid}:${input.hostGid}`,
    ...(input.dockerPolicy.read_only_rootfs ? ['--read-only'] : []),
    '--security-opt',
    'no-new-privileges',
    '--cap-drop',
    'ALL',
    '--memory',
    `${input.resourceLimits.memory_mb}m`,
    '--cpus',
    String(input.resourceLimits.cpu_ms / 1000),
    '--pids-limit',
    String(input.resourceLimits.pids),
    ...networkArgs,
    '--env',
    'CODEX_HOME=/codex-home',
    ...(input.workspaceHostPath === undefined ? [] : ['--volume', bindMount(input.workspaceHostPath, input.workspaceContainerPath, 'rw')]),
    '--volume',
    bindMount(input.artifactHostPath, '/artifacts', 'rw'),
    '--volume',
    bindMount(input.codexHomeHostPath, '/codex-home', 'ro'),
    '--volume',
    bindMount(input.socketHostDir, '/run/forgeloop', 'rw'),
    `${input.image}@${input.imageDigest}`,
    'codex',
    'app-server',
    '--socket',
    input.socketContainerPath,
  ];

  if (args.some((arg) => secretLookingPattern.test(arg) && !arg.startsWith('forgeloop.'))) {
    throw new Error('secret-looking value cannot appear in Docker argv.');
  }

  return {
    executable: input.dockerBin,
    args,
    publicSummary: {
      worker_id: input.workerId,
      launch_lease_id: input.launchLeaseId,
      target_type: input.targetType,
      target_id: input.targetId,
      image_digest: input.imageDigest,
      network_mode: networkPolicy.mode === 'disabled' ? 'disabled' : networkPolicy.provider,
      run_as_non_root: true,
      read_only_rootfs: input.dockerPolicy.read_only_rootfs,
    },
    internal: {
      socketHostPath: input.socketHostDir.endsWith('/codex.sock') ? input.socketHostDir : `${input.socketHostDir}/codex.sock`,
    },
  };
};
