import { randomUUID } from 'node:crypto';
import { delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { signAutomationRequest } from '../packages/automation/src/index';
import {
  CodexAppServerEndpointTransport,
  effectiveConfigFromResponse,
  type CodexAppServerTransport,
} from '../packages/codex-runtime/src/index';
import {
  CliDockerRunner,
  CodexRuntimeControlPlaneClient,
  createRemoteCodexWorkerClient,
  DockerizedCodexAppServerLauncher,
} from '../packages/codex-worker-runtime/src/index';
import { codexCanonicalDigest, type CodexRuntimeScope, type CodexRuntimeTargetKind } from '../packages/domain/src/index';

type EnvLike = Record<string, string | undefined>;
type RemoteWorkerRunMode = 'run_once' | 'run_loop';
type AppServerTransportMode = 'unix' | 'websocket' | 'docker_exec';

export interface CodexRemoteWorkerDogfoodConfig {
  controlPlaneUrl: string;
  trustedActorHeaderSecret: string;
  actorId: string;
  daemonIdentity: string;
  workerId: string;
  workerIdentity: string;
  workerBootstrapToken: string;
  workerBootstrapTokenVersion: number;
  workerTempRoot: string;
  dockerBin: string;
  appServerTransport: AppServerTransportMode;
  noSharedFilesystem: boolean;
  allowedRepoRoots: string[];
  allowedScopes: CodexRuntimeScope[];
  capabilities: CodexRuntimeTargetKind[];
  dockerImageDigests: string[];
  networkPolicyDigests: string[];
  networkProviderConfigDigests?: string[];
  hostUid: number;
  hostGid: number;
  maxConcurrency: number;
  pollIntervalMs: number;
  controlPollIntervalMs: number;
  runMode: RemoteWorkerRunMode;
}

export const codexRemoteWorkerDogfoodCommand =
  'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-remote-worker-dogfood.ts';

const sha256DigestPattern = /^sha256:[a-f0-9]{64}$/;

const optionalEnv = (env: EnvLike, key: string): string | undefined => {
  const value = env[key]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

const requiredEnv = (env: EnvLike, key: string): string => {
  const value = optionalEnv(env, key);
  if (value === undefined) {
    throw new Error(`${key}_missing`);
  }
  return value;
};

const positiveIntEnv = (env: EnvLike, key: string, fallback?: number): number => {
  const raw = optionalEnv(env, key);
  if (raw === undefined) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`${key}_missing`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key}_must_be_positive_integer`);
  }
  return value;
};

const nonNegativeIntEnv = (env: EnvLike, key: string, fallback: number): number => {
  const raw = optionalEnv(env, key);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${key}_must_be_non_negative_integer`);
  }
  return value;
};

const digestListEnv = (env: EnvLike, key: string): string[] | undefined => {
  const raw = optionalEnv(env, key);
  if (raw === undefined) {
    return undefined;
  }
  const values = raw
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (values.length === 0 || values.some((value) => !sha256DigestPattern.test(value))) {
    throw new Error(`${key}_must_contain_pinned_sha256_digests`);
  }
  return values;
};

const singleDigestListEnv = (env: EnvLike, pluralKey: string, singleKey: string): string[] => {
  const plural = digestListEnv(env, pluralKey);
  if (plural !== undefined) {
    return plural;
  }
  const single = requiredEnv(env, singleKey);
  if (!sha256DigestPattern.test(single)) {
    throw new Error(`${singleKey}_must_be_pinned_sha256_digest`);
  }
  return [single];
};

const allowedScopesEnv = (env: EnvLike): CodexRuntimeScope[] => {
  const projectId = requiredEnv(env, 'FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID');
  const repoId = optionalEnv(env, 'FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID');
  return [{ project_id: projectId, ...(repoId === undefined ? {} : { repo_id: repoId }) }];
};

const capabilitiesEnv = (env: EnvLike): CodexRuntimeTargetKind[] => {
  const raw = optionalEnv(env, 'FORGELOOP_CODEX_WORKER_CAPABILITIES');
  if (raw === undefined) {
    return ['generation'];
  }
  return raw
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      if (entry !== 'generation' && entry !== 'run_execution') {
        throw new Error('FORGELOOP_CODEX_WORKER_CAPABILITIES_must_contain_generation_or_run_execution');
      }
      return entry;
    });
};

const appServerTransportEnv = (env: EnvLike): AppServerTransportMode => {
  const value = optionalEnv(env, 'FORGELOOP_CODEX_APP_SERVER_TRANSPORT') ?? 'docker_exec';
  if (value !== 'unix' && value !== 'websocket' && value !== 'docker_exec') {
    throw new Error('FORGELOOP_CODEX_APP_SERVER_TRANSPORT_invalid');
  }
  return value;
};

const runModeEnv = (env: EnvLike): RemoteWorkerRunMode => {
  const value = optionalEnv(env, 'FORGELOOP_CODEX_REMOTE_WORKER_RUN_MODE') ?? 'run_once';
  if (value !== 'run_once' && value !== 'run_loop') {
    throw new Error('FORGELOOP_CODEX_REMOTE_WORKER_RUN_MODE_must_be_run_once_or_run_loop');
  }
  return value;
};

const pathListEnv = (env: EnvLike, key: string): string[] => {
  const raw = optionalEnv(env, key);
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const booleanEnv = (env: EnvLike, key: string): boolean => {
  const raw = optionalEnv(env, key);
  return raw === '1' || raw === 'true' || raw === 'yes';
};

const assertNoSharedFilesystemInputs = (env: EnvLike): void => {
  for (const key of [
    'FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS',
    'FORGELOOP_CODEX_CONFIG_TOML_PATH',
    'FORGELOOP_CODEX_AUTH_JSON_PATH',
    'FORGELOOP_CODEX_HOME',
    'CODEX_HOME',
  ]) {
    if (optionalEnv(env, key) !== undefined) {
      throw new Error(`${key}_not_allowed_in_no_shared_filesystem_mode`);
    }
  }
};

export const loadCodexRemoteWorkerDogfoodConfig = (env: EnvLike = process.env): CodexRemoteWorkerDogfoodConfig => {
  const workerIdentity = requiredEnv(env, 'FORGELOOP_WORKER_IDENTITY');
  const workerId = optionalEnv(env, 'FORGELOOP_CODEX_WORKER_ID') ?? workerIdentity;
  const noSharedFilesystem = booleanEnv(env, 'FORGELOOP_CODEX_NO_SHARED_FILESYSTEM');
  if (noSharedFilesystem) {
    assertNoSharedFilesystemInputs(env);
  }
  return {
    controlPlaneUrl: requiredEnv(env, 'FORGELOOP_CONTROL_PLANE_URL').replace(/\/$/, ''),
    trustedActorHeaderSecret: requiredEnv(env, 'FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET'),
    actorId: requiredEnv(env, 'FORGELOOP_AUTOMATION_ACTOR_ID'),
    daemonIdentity: requiredEnv(env, 'FORGELOOP_AUTOMATION_DAEMON_IDENTITY'),
    workerId,
    workerIdentity,
    workerBootstrapToken: requiredEnv(env, 'FORGELOOP_WORKER_BOOTSTRAP_TOKEN'),
    workerBootstrapTokenVersion: positiveIntEnv(env, 'FORGELOOP_WORKER_BOOTSTRAP_TOKEN_VERSION'),
    workerTempRoot: requiredEnv(env, 'FORGELOOP_WORKER_TEMP_ROOT'),
    dockerBin: optionalEnv(env, 'FORGELOOP_DOCKER_BIN') ?? 'docker',
    appServerTransport: appServerTransportEnv(env),
    noSharedFilesystem,
    allowedRepoRoots: noSharedFilesystem ? [] : pathListEnv(env, 'FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS'),
    allowedScopes: allowedScopesEnv(env),
    capabilities: capabilitiesEnv(env),
    dockerImageDigests: singleDigestListEnv(env, 'FORGELOOP_CODEX_WORKER_DOCKER_IMAGE_DIGESTS', 'FORGELOOP_CODEX_DOCKER_IMAGE_DIGEST'),
    networkPolicyDigests: singleDigestListEnv(
      env,
      'FORGELOOP_CODEX_WORKER_NETWORK_POLICY_DIGESTS',
      'FORGELOOP_CODEX_NETWORK_POLICY_DIGEST',
    ),
    ...(digestListEnv(env, 'FORGELOOP_CODEX_WORKER_NETWORK_PROVIDER_CONFIG_DIGESTS') === undefined
      ? {}
      : { networkProviderConfigDigests: digestListEnv(env, 'FORGELOOP_CODEX_WORKER_NETWORK_PROVIDER_CONFIG_DIGESTS') }),
    hostUid: nonNegativeIntEnv(env, 'FORGELOOP_WORKER_HOST_UID', process.getuid?.() ?? 0),
    hostGid: nonNegativeIntEnv(env, 'FORGELOOP_WORKER_HOST_GID', process.getgid?.() ?? 0),
    maxConcurrency: positiveIntEnv(env, 'FORGELOOP_WORKER_MAX_CONCURRENCY', 1),
    pollIntervalMs: positiveIntEnv(env, 'FORGELOOP_CODEX_REMOTE_WORKER_POLL_INTERVAL_MS', 1_000),
    controlPollIntervalMs: positiveIntEnv(env, 'FORGELOOP_CODEX_REMOTE_WORKER_CONTROL_POLL_INTERVAL_MS', 2_000),
    runMode: runModeEnv(env),
  };
};

export const renderCodexRemoteWorkerDogfoodStartSummary = (config: CodexRemoteWorkerDogfoodConfig): string =>
  [
    'Remote Codex worker dogfood',
    `Control plane digest: ${codexCanonicalDigest(config.controlPlaneUrl)}`,
    `Worker digest: ${codexCanonicalDigest(config.workerId)}`,
    `Run mode: ${config.runMode}`,
    `No shared filesystem: ${config.noSharedFilesystem ? 'enabled' : 'disabled'}`,
    `Capabilities: ${config.capabilities.join(',')}`,
    `Docker image digests: ${config.dockerImageDigests.join(',')}`,
    `Network policy digests: ${config.networkPolicyDigests.join(',')}`,
    ...(config.networkProviderConfigDigests === undefined
      ? []
      : [`Network provider config digests: ${config.networkProviderConfigDigests.join(',')}`]),
  ].join('\n');

const publicRemoteWorkerDogfoodCodes = new Set([
  'codex_app_server_effective_config_mismatch',
  'codex_runtime_job_unavailable',
  'codex_worker_unavailable',
  'codex_worker_docker_policy_unavailable',
  'codex_runtime_workspace_isolation_unavailable',
  'codex_docker_runtime_evidence_unsafe',
]);

const publicRemoteWorkerDogfoodCode = (error: unknown): string => {
  if (error instanceof Error) {
    const code = error.message.split(':', 1)[0]?.trim();
    if (code !== undefined && publicRemoteWorkerDogfoodCodes.has(code)) {
      return code;
    }
  }
  return 'codex_remote_worker_dogfood_failed';
};

export const renderCodexRemoteWorkerDogfoodFailure = (error: unknown): string =>
  `Remote Codex worker dogfood failed: ${publicRemoteWorkerDogfoodCode(error)}`;

const codexEffectiveConfigProbe = async (
  endpoint: `unix:${string}` | `ws://${string}` | `docker-exec:${string}`,
  auth?: { bearerToken: string },
  createTransport?: () => CodexAppServerTransport,
): Promise<Record<string, unknown>> => {
  const transport = createTransport?.() ?? new CodexAppServerEndpointTransport(endpoint, auth);
  try {
    await transport.initialize?.();
    for (const [method, params] of [
      ['config/read', { includeLayers: false }],
      ['getEffectiveConfig', {}],
      ['codex/getEffectiveConfig', {}],
      ['effective_config', {}],
    ] as const) {
      try {
        const response = await transport.request(method, params);
        const config = effectiveConfigFromResponse(response);
        if (config !== undefined) {
          return config as Record<string, unknown>;
        }
      } catch {
        // Try the next known app-server method name.
      }
    }
  } finally {
    await transport.close?.().catch(() => undefined);
  }
  throw new Error('codex_app_server_effective_config_mismatch');
};

export const runCodexRemoteWorkerDogfood = async (
  config: CodexRemoteWorkerDogfoodConfig = loadCodexRemoteWorkerDogfoodConfig(),
): Promise<{ iterations?: number; processed: number }> => {
  const now = () => new Date().toISOString();
  const nonceFactory = () => randomUUID();
  const controlPlaneClient = new CodexRuntimeControlPlaneClient({
    baseUrl: config.controlPlaneUrl,
    trustedActorSigner: ({ method, pathAndQuery, rawBody }) =>
      ({
        ...signAutomationRequest({
          method,
          pathAndQuery,
          rawBody,
          actorId: config.actorId,
          actorClass: 'automation_daemon',
          daemonIdentity: config.daemonIdentity,
          timestamp: now(),
          secret: config.trustedActorHeaderSecret,
        }),
      }),
    now,
    nonceFactory,
  });
  const dockerRunner = new CliDockerRunner(config.dockerBin);
  const launcher = new DockerizedCodexAppServerLauncher({
    dockerBin: config.dockerBin,
    workerId: config.workerId,
    workerTempRoot: config.workerTempRoot,
    dockerRunner,
    controlPlaneClient,
    hostUid: config.hostUid,
    hostGid: config.hostGid,
    appServerTransport: config.appServerTransport,
    allowedRepoRoots: config.allowedRepoRoots,
    effectiveConfigProbe: codexEffectiveConfigProbe,
    now,
    nonceFactory,
  });
  const worker = createRemoteCodexWorkerClient({
    workerId: config.workerId,
    workerIdentity: config.workerIdentity,
    version: 'codex-remote-worker-dogfood',
    bootstrapToken: config.workerBootstrapToken,
    bootstrapTokenVersion: config.workerBootstrapTokenVersion,
    workerTempRoot: config.workerTempRoot,
    allowedScopes: config.allowedScopes,
    capabilities: config.capabilities,
    dockerImageDigests: config.dockerImageDigests,
    networkPolicyDigests: config.networkPolicyDigests,
    ...(config.networkProviderConfigDigests === undefined ? {} : { networkProviderConfigDigests: config.networkProviderConfigDigests }),
    hostUid: config.hostUid,
    hostGid: config.hostGid,
    maxConcurrency: config.maxConcurrency,
    controlPlaneClient,
    launcher,
    scavenger: async () => undefined,
    pollIntervalMs: config.pollIntervalMs,
    controlPollIntervalMs: config.controlPollIntervalMs,
    now,
    nonceFactory,
  });
  return config.runMode === 'run_loop' ? worker.runLoop() : worker.runOnce();
};

export const main = async (): Promise<number> => {
  const config = loadCodexRemoteWorkerDogfoodConfig();
  console.log(renderCodexRemoteWorkerDogfoodStartSummary(config));
  const result = await runCodexRemoteWorkerDogfood(config);
  console.log(
    JSON.stringify(
      {
        status: 'completed',
        processed: result.processed,
        ...(result.iterations === undefined ? {} : { iterations: result.iterations }),
      },
      null,
      2,
    ),
  );
  return 0;
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(renderCodexRemoteWorkerDogfoodFailure(error));
      process.exitCode = 1;
    });
}
