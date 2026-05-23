import path from 'node:path';
import type { AutomationGenerationPlanningConfig } from '@forgeloop/automation';
import { parseCodexAppServerEndpoint } from '@forgeloop/codex-runtime';

export const DEFAULT_AUTOMATION_LOOP_INTERVAL_MS = 5_000;
export const DEFAULT_AUTOMATION_NO_CLAIM_BACKOFF_MS = 10_000;
export const DEFAULT_WORKFLOW_POLICY_PARSER_VERSION = 'workflow-md-parser:v1';

export type CodexWorkerMode = 'disabled' | 'local_docker' | 'remote_outbound';
export type CodexAppServerTransport = 'unix' | 'websocket' | 'docker_exec';

export interface AutomationDaemonConfig {
  controlPlaneUrl: string;
  trustedActorHeaderSecret: string;
  daemonIdentity: string;
  actorId: string;
  allowedRepoRoots: string[];
  loopIntervalMs: number;
  noClaimBackoffMs: number;
  policyParserVersion: string;
  codexAutomationGeneration: AutomationGenerationPlanningConfig['mode'];
  generationPlanning: AutomationGenerationPlanningConfig;
  generationPlanningExplicit: boolean;
  codexWorkerMode: CodexWorkerMode;
  workerId?: string;
  workerIdentity?: string;
  workerBootstrapToken?: string;
  workerBootstrapTokenVersion?: number;
  workerLabels?: Record<string, string>;
  workerMaxConcurrency?: number;
  workerHostUid?: number;
  workerHostGid?: number;
  workerAuthorizedScopes?: Array<{ project_id: string; repo_id?: string }>;
  workerCapabilities?: Array<'generation' | 'run_execution'>;
  workerDockerImageDigests?: string[];
  workerNetworkPolicyDigests?: string[];
  workerNetworkProviderConfigDigests?: string[];
  generationRuntimeProfileId?: string;
  generationCredentialBindingId?: string;
  dockerBin?: string;
  dockerSocket?: string;
  workerTempRoot?: string;
  appServerTransport?: CodexAppServerTransport;
  appServerEndpoint?: string;
  generationArtifactRoot?: string;
  generationTurnTimeoutMs?: number;
  generationOutputLimitBytes?: number;
  generationRawNotificationLimitBytes?: number;
  generationMaxConcurrency?: number;
  remoteRuntimeJobWaitTimeoutMs?: number;
  remoteRuntimeJobPollIntervalMs?: number;
  remoteActionClaimRenewalMs?: number;
}

type EnvLike = Record<string, string | undefined>;

const requiredEnv = (env: EnvLike, key: string): string => {
  const value = env[key];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required automation daemon config: ${key}`);
  }
  return value;
};

const optionalPositiveInt = (env: EnvLike, key: string, fallback: number): number => {
  const raw = env[key];
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid automation daemon config: ${key} must be a positive integer`);
  }
  return value;
};

const optionalPositiveIntEnv = (env: EnvLike, key: string): number | undefined => {
  const raw = env[key];
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid automation daemon config: ${key} must be a positive integer`);
  }
  return value;
};

const pathListEnv = (env: EnvLike, key: string): string[] => {
  const raw = requiredEnv(env, key);
  const values = raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (values.length === 0) {
    throw new Error(`Invalid automation daemon config: ${key} must contain at least one path`);
  }
  return values;
};

const booleanEnv = (env: EnvLike, key: string, fallback: boolean): boolean => {
  const raw = env[key];
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  throw new Error(`Invalid automation daemon config: ${key} must be true or false`);
};

const optionalNonBlankEnv = (env: EnvLike, key: string): string | undefined => {
  const raw = env[key];
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  return raw.trim();
};

const codexWorkerModeEnv = (env: EnvLike): CodexWorkerMode => {
  const raw = env.FORGELOOP_CODEX_WORKER_MODE?.trim() ?? 'disabled';
  if (raw === 'disabled' || raw === 'local_docker' || raw === 'remote_outbound') {
    return raw;
  }
  throw new Error('Invalid automation daemon config: FORGELOOP_CODEX_WORKER_MODE must be disabled, local_docker, or remote_outbound');
};

const appServerTransportEnv = (env: EnvLike): CodexAppServerTransport | undefined => {
  const raw = optionalNonBlankEnv(env, 'FORGELOOP_CODEX_APP_SERVER_TRANSPORT');
  if (raw === undefined) {
    return undefined;
  }
  if (raw === 'unix' || raw === 'websocket' || raw === 'docker_exec') {
    return raw;
  }
  throw new Error('Invalid automation daemon config: FORGELOOP_CODEX_APP_SERVER_TRANSPORT must be unix, websocket, or docker_exec');
};

const recordEnv = (env: EnvLike, key: string): Record<string, string> | undefined => {
  const raw = optionalNonBlankEnv(env, key);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid automation daemon config: ${key} must be a JSON object`);
  }
  return Object.fromEntries(
    Object.entries(parsed).map(([entryKey, entryValue]) => {
      if (typeof entryValue !== 'string') {
        throw new Error(`Invalid automation daemon config: ${key} values must be strings`);
      }
      return [entryKey, entryValue];
    }),
  );
};

const stringListEnv = (env: EnvLike, key: string): string[] | undefined => {
  const raw = optionalNonBlankEnv(env, key);
  if (raw === undefined) {
    return undefined;
  }
  const values = raw
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return values.length === 0 ? undefined : values;
};

const workerScopesEnv = (env: EnvLike): Array<{ project_id: string; repo_id?: string }> | undefined => {
  const raw = optionalNonBlankEnv(env, 'FORGELOOP_CODEX_WORKER_SCOPES_JSON');
  if (raw !== undefined) {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Invalid automation daemon config: FORGELOOP_CODEX_WORKER_SCOPES_JSON must be a JSON array');
    }
    return parsed.map((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error('Invalid automation daemon config: FORGELOOP_CODEX_WORKER_SCOPES_JSON entries must be objects');
      }
      const projectId = (entry as Record<string, unknown>).project_id;
      const repoId = (entry as Record<string, unknown>).repo_id;
      if (typeof projectId !== 'string' || projectId.length === 0 || (repoId !== undefined && typeof repoId !== 'string')) {
        throw new Error('Invalid automation daemon config: FORGELOOP_CODEX_WORKER_SCOPES_JSON entries must include project_id and optional repo_id');
      }
      return { project_id: projectId, ...(repoId === undefined ? {} : { repo_id: repoId }) };
    });
  }
  const projectId = optionalNonBlankEnv(env, 'FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID');
  if (projectId === undefined) {
    return undefined;
  }
  const repoId = optionalNonBlankEnv(env, 'FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID');
  return [{ project_id: projectId, ...(repoId === undefined ? {} : { repo_id: repoId }) }];
};

const workerCapabilitiesEnv = (env: EnvLike): Array<'generation' | 'run_execution'> | undefined => {
  const values = stringListEnv(env, 'FORGELOOP_CODEX_WORKER_CAPABILITIES');
  if (values === undefined) {
    return undefined;
  }
  return values.map((value) => {
    if (value !== 'generation' && value !== 'run_execution') {
      throw new Error('Invalid automation daemon config: FORGELOOP_CODEX_WORKER_CAPABILITIES must contain generation or run_execution');
    }
    return value;
  });
};

const legacyGenerationModeEnv = (env: EnvLike): AutomationGenerationPlanningConfig['mode'] => {
  const raw = env.FORGELOOP_CODEX_AUTOMATION_GENERATION?.trim() ?? 'disabled';
  if (raw === 'disabled' || raw === 'fake') {
    return raw;
  }
  if (raw === 'codex') {
    return 'app_server';
  }
  throw new Error('Invalid automation daemon config: FORGELOOP_CODEX_AUTOMATION_GENERATION must be disabled, fake, or codex');
};

const generationDriverEnv = (env: EnvLike): AutomationGenerationPlanningConfig['mode'] => {
  const legacyMode = legacyGenerationModeEnv(env);
  const rawDriver = env.FORGELOOP_CODEX_GENERATION_DRIVER?.trim();
  if (rawDriver === undefined || rawDriver.length === 0) {
    return legacyMode;
  }
  if (rawDriver === 'cli' || rawDriver === 'exec' || rawDriver === 'exec_fallback' || rawDriver === 'codex_exec') {
    throw new Error(`Invalid automation daemon config: FORGELOOP_CODEX_GENERATION_DRIVER=${rawDriver} is not allowed`);
  }
  if (rawDriver !== 'fake' && rawDriver !== 'app_server') {
    throw new Error('Invalid automation daemon config: FORGELOOP_CODEX_GENERATION_DRIVER must be fake or app_server');
  }
  if (env.FORGELOOP_CODEX_AUTOMATION_GENERATION !== undefined && legacyMode !== rawDriver) {
    throw new Error('Invalid automation daemon config: FORGELOOP_CODEX_GENERATION_DRIVER conflicts with FORGELOOP_CODEX_AUTOMATION_GENERATION');
  }
  return rawDriver;
};

const generationPlanningEnv = (env: EnvLike): AutomationGenerationPlanningConfig => {
  const mode = generationDriverEnv(env);
  const defaultsEnabled = mode !== 'disabled';
  return {
    mode,
    tasks: {
      spec_draft: {
        enabled: booleanEnv(env, 'FORGELOOP_CODEX_GENERATION_SPEC_DRAFT_ENABLED', defaultsEnabled),
        promptVersion: 'spec-draft.fake.v1',
        outputSchemaVersion: 'spec_draft.v1',
      },
      plan_draft: {
        enabled: booleanEnv(env, 'FORGELOOP_CODEX_GENERATION_PLAN_DRAFT_ENABLED', defaultsEnabled),
        promptVersion: 'plan-draft.fake.v1',
        outputSchemaVersion: 'plan_draft.v1',
      },
      package_drafts: {
        enabled: booleanEnv(env, 'FORGELOOP_CODEX_GENERATION_PACKAGE_DRAFTS_ENABLED', false),
        promptVersion: 'package-drafts.fake.v1',
        outputSchemaVersion: 'package_drafts.v1',
      },
    },
  };
};

const generationPlanningExplicitEnv = (env: EnvLike): boolean =>
  env.FORGELOOP_CODEX_AUTOMATION_GENERATION !== undefined ||
  env.FORGELOOP_CODEX_GENERATION_DRIVER !== undefined ||
  env.FORGELOOP_CODEX_GENERATION_SPEC_DRAFT_ENABLED !== undefined ||
  env.FORGELOOP_CODEX_GENERATION_PLAN_DRAFT_ENABLED !== undefined ||
  env.FORGELOOP_CODEX_GENERATION_PACKAGE_DRAFTS_ENABLED !== undefined;

const assertAppServerRuntimeConfig = (
  env: EnvLike,
  mode: AutomationGenerationPlanningConfig['mode'],
  workerMode: CodexWorkerMode,
): void => {
  if (mode !== 'app_server') {
    return;
  }
  const endpoint = optionalNonBlankEnv(env, 'FORGELOOP_CODEX_APP_SERVER_ENDPOINT');
  if (endpoint === undefined && workerMode !== 'local_docker' && workerMode !== 'remote_outbound') {
    throw new Error('Invalid automation daemon config: app-server generation requires FORGELOOP_CODEX_APP_SERVER_ENDPOINT');
  }
  if (endpoint !== undefined) {
    try {
      parseCodexAppServerEndpoint(endpoint);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      throw new Error(`Invalid automation daemon config: FORGELOOP_CODEX_APP_SERVER_ENDPOINT is invalid: ${reason}`);
    }
  }
  if (workerMode !== 'remote_outbound' && optionalNonBlankEnv(env, 'FORGELOOP_CODEX_GENERATION_ARTIFACT_ROOT') === undefined) {
    throw new Error('Invalid automation daemon config: app-server generation requires FORGELOOP_CODEX_GENERATION_ARTIFACT_ROOT');
  }
  if (workerMode === 'local_docker') {
    requiredEnv(env, 'FORGELOOP_WORKER_IDENTITY');
    requiredEnv(env, 'FORGELOOP_WORKER_BOOTSTRAP_TOKEN');
    requiredEnv(env, 'FORGELOOP_WORKER_BOOTSTRAP_TOKEN_VERSION');
    requiredEnv(env, 'FORGELOOP_WORKER_TEMP_ROOT');
    requiredEnv(env, 'FORGELOOP_CODEX_DOCKER_IMAGE_DIGEST');
    requiredEnv(env, 'FORGELOOP_CODEX_NETWORK_POLICY_DIGEST');
    requiredEnv(env, 'FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID');
    requiredEnv(env, 'FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID');
  }
  if (workerMode === 'remote_outbound') {
    requiredEnv(env, 'FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID');
    requiredEnv(env, 'FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID');
    requiredEnv(env, 'FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_WAIT_TIMEOUT_MS');
    requiredEnv(env, 'FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_POLL_INTERVAL_MS');
  }
};

export const loadAutomationDaemonConfig = (env: EnvLike = process.env): AutomationDaemonConfig => {
  const generationPlanning = generationPlanningEnv(env);
  const generationPlanningExplicit = generationPlanningExplicitEnv(env);
  const codexWorkerMode = codexWorkerModeEnv(env);
  assertAppServerRuntimeConfig(env, generationPlanning.mode, codexWorkerMode);
  const appServerEndpoint = optionalNonBlankEnv(env, 'FORGELOOP_CODEX_APP_SERVER_ENDPOINT');
  const generationArtifactRoot = optionalNonBlankEnv(env, 'FORGELOOP_CODEX_GENERATION_ARTIFACT_ROOT');
  const workerIdentity = optionalNonBlankEnv(env, 'FORGELOOP_WORKER_IDENTITY');
  const workerId = optionalNonBlankEnv(env, 'FORGELOOP_CODEX_WORKER_ID') ?? workerIdentity;
  const workerBootstrapToken = optionalNonBlankEnv(env, 'FORGELOOP_WORKER_BOOTSTRAP_TOKEN');
  const workerBootstrapTokenVersion = optionalPositiveIntEnv(env, 'FORGELOOP_WORKER_BOOTSTRAP_TOKEN_VERSION');
  const workerLabels = recordEnv(env, 'FORGELOOP_WORKER_LABELS');
  const workerMaxConcurrency = optionalPositiveIntEnv(env, 'FORGELOOP_WORKER_MAX_CONCURRENCY');
  const workerHostUid = optionalPositiveIntEnv(env, 'FORGELOOP_WORKER_HOST_UID');
  const workerHostGid = optionalPositiveIntEnv(env, 'FORGELOOP_WORKER_HOST_GID');
  const workerAuthorizedScopes = workerScopesEnv(env);
  const workerCapabilities = workerCapabilitiesEnv(env);
  const singleDockerImageDigest = optionalNonBlankEnv(env, 'FORGELOOP_CODEX_DOCKER_IMAGE_DIGEST');
  const workerDockerImageDigests =
    stringListEnv(env, 'FORGELOOP_CODEX_WORKER_DOCKER_IMAGE_DIGESTS') ??
    (singleDockerImageDigest === undefined ? undefined : [singleDockerImageDigest]);
  const singleNetworkPolicyDigest = optionalNonBlankEnv(env, 'FORGELOOP_CODEX_NETWORK_POLICY_DIGEST');
  const workerNetworkPolicyDigests =
    stringListEnv(env, 'FORGELOOP_CODEX_WORKER_NETWORK_POLICY_DIGESTS') ??
    (singleNetworkPolicyDigest === undefined ? undefined : [singleNetworkPolicyDigest]);
  const workerNetworkProviderConfigDigests = stringListEnv(env, 'FORGELOOP_CODEX_WORKER_NETWORK_PROVIDER_CONFIG_DIGESTS');
  const generationRuntimeProfileId = optionalNonBlankEnv(env, 'FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID');
  const generationCredentialBindingId = optionalNonBlankEnv(env, 'FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID');
  const dockerBin = optionalNonBlankEnv(env, 'FORGELOOP_DOCKER_BIN');
  const dockerSocket = optionalNonBlankEnv(env, 'FORGELOOP_DOCKER_SOCKET');
  const workerTempRoot = optionalNonBlankEnv(env, 'FORGELOOP_WORKER_TEMP_ROOT');
  const appServerTransport = appServerTransportEnv(env);
  const generationTurnTimeoutMs = optionalPositiveIntEnv(env, 'FORGELOOP_CODEX_GENERATION_TURN_TIMEOUT_MS');
  const generationOutputLimitBytes = optionalPositiveIntEnv(env, 'FORGELOOP_CODEX_GENERATION_OUTPUT_LIMIT_BYTES');
  const generationRawNotificationLimitBytes = optionalPositiveIntEnv(
    env,
    'FORGELOOP_CODEX_GENERATION_RAW_NOTIFICATION_LIMIT_BYTES',
  );
  const generationMaxConcurrency = optionalPositiveIntEnv(env, 'FORGELOOP_CODEX_GENERATION_MAX_CONCURRENCY');
  const remoteRuntimeJobWaitTimeoutMs = optionalPositiveIntEnv(env, 'FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_WAIT_TIMEOUT_MS');
  const remoteRuntimeJobPollIntervalMs = optionalPositiveIntEnv(env, 'FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_POLL_INTERVAL_MS');
  const remoteActionClaimRenewalMs = optionalPositiveIntEnv(env, 'FORGELOOP_CODEX_REMOTE_ACTION_CLAIM_RENEWAL_MS');
  return {
    controlPlaneUrl: requiredEnv(env, 'FORGELOOP_CONTROL_PLANE_URL'),
    trustedActorHeaderSecret: requiredEnv(env, 'FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET'),
    daemonIdentity: requiredEnv(env, 'FORGELOOP_AUTOMATION_DAEMON_IDENTITY'),
    actorId: requiredEnv(env, 'FORGELOOP_AUTOMATION_ACTOR_ID'),
    allowedRepoRoots: pathListEnv(env, 'FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS'),
    loopIntervalMs: optionalPositiveInt(
      env,
      'FORGELOOP_AUTOMATION_LOOP_INTERVAL_MS',
      DEFAULT_AUTOMATION_LOOP_INTERVAL_MS,
    ),
    noClaimBackoffMs: optionalPositiveInt(
      env,
      'FORGELOOP_AUTOMATION_NO_CLAIM_BACKOFF_MS',
      DEFAULT_AUTOMATION_NO_CLAIM_BACKOFF_MS,
    ),
    policyParserVersion: DEFAULT_WORKFLOW_POLICY_PARSER_VERSION,
    codexAutomationGeneration: generationPlanning.mode,
    generationPlanning,
    generationPlanningExplicit,
    codexWorkerMode,
    ...(workerId === undefined ? {} : { workerId }),
    ...(workerIdentity === undefined ? {} : { workerIdentity }),
    ...(workerBootstrapToken === undefined ? {} : { workerBootstrapToken }),
    ...(workerBootstrapTokenVersion === undefined ? {} : { workerBootstrapTokenVersion }),
    ...(workerLabels === undefined ? {} : { workerLabels }),
    ...(workerMaxConcurrency === undefined ? {} : { workerMaxConcurrency }),
    ...(workerHostUid === undefined ? {} : { workerHostUid }),
    ...(workerHostGid === undefined ? {} : { workerHostGid }),
    ...(workerAuthorizedScopes === undefined ? {} : { workerAuthorizedScopes }),
    ...(workerCapabilities === undefined ? {} : { workerCapabilities }),
    ...(workerDockerImageDigests === undefined ? {} : { workerDockerImageDigests }),
    ...(workerNetworkPolicyDigests === undefined ? {} : { workerNetworkPolicyDigests }),
    ...(workerNetworkProviderConfigDigests === undefined ? {} : { workerNetworkProviderConfigDigests }),
    ...(generationRuntimeProfileId === undefined ? {} : { generationRuntimeProfileId }),
    ...(generationCredentialBindingId === undefined ? {} : { generationCredentialBindingId }),
    ...(dockerBin === undefined ? {} : { dockerBin }),
    ...(dockerSocket === undefined ? {} : { dockerSocket }),
    ...(workerTempRoot === undefined ? {} : { workerTempRoot }),
    ...(appServerTransport === undefined ? {} : { appServerTransport }),
    ...(appServerEndpoint === undefined ? {} : { appServerEndpoint }),
    ...(generationArtifactRoot === undefined ? {} : { generationArtifactRoot }),
    ...(generationTurnTimeoutMs === undefined ? {} : { generationTurnTimeoutMs }),
    ...(generationOutputLimitBytes === undefined ? {} : { generationOutputLimitBytes }),
    ...(generationRawNotificationLimitBytes === undefined ? {} : { generationRawNotificationLimitBytes }),
    ...(generationMaxConcurrency === undefined ? {} : { generationMaxConcurrency }),
    ...(remoteRuntimeJobWaitTimeoutMs === undefined ? {} : { remoteRuntimeJobWaitTimeoutMs }),
    ...(remoteRuntimeJobPollIntervalMs === undefined ? {} : { remoteRuntimeJobPollIntervalMs }),
    ...(remoteActionClaimRenewalMs === undefined ? {} : { remoteActionClaimRenewalMs }),
  };
};

export const generationPlanningForDaemon = (
  config: AutomationDaemonConfig,
): AutomationGenerationPlanningConfig | undefined => (config.generationPlanningExplicit ? config.generationPlanning : undefined);
