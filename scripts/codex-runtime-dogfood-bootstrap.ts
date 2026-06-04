import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';

import { signAutomationRequest } from '../packages/automation/src/index';
import type { AutomationActorClass } from '../packages/domain/src/index';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexNetworkPolicyDigestInput,
  codexRuntimeNetworkPolicyDigest,
  type CodexNetworkAllowlistRule,
  type CodexRuntimeProfileRevision,
} from '../packages/domain/src/index';

type EnvLike = Record<string, string | undefined>;

export interface CodexRuntimeDogfoodBootstrapConfig {
  controlPlaneUrl: string;
  trustedActorHeaderSecret: string;
  actorId: string;
  actorClass: 'system_bootstrap' | 'human_admin';
  daemonIdentity: string;
  codexConfigToml: string;
  authJson: unknown;
  dockerImage: string;
  dockerImageDigest: string;
  generationExpectedEffectiveConfigDigest: string;
  runExecutionExpectedEffectiveConfigDigest: string;
  allowedScope: { project_id: string; repo_id?: string };
  networkPolicy: Exclude<CodexRuntimeProfileRevision['network_policy'], { mode: 'disabled' }>;
  workerIdentity: string;
  workerBootstrapToken: string;
  workerBootstrapTokenVersion: number;
  hostWorkerUid: number;
  hostWorkerGid: number;
}

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

const requiredSha256Digest = (env: EnvLike, key: string): string => {
  const value = requiredEnv(env, key);
  if (!sha256DigestPattern.test(value)) {
    throw new Error(`${key}_must_be_pinned_sha256_digest`);
  }
  return value;
};

const positiveIntEnv = (env: EnvLike, key: string): number => {
  const value = Number(requiredEnv(env, key));
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

const parseJson = (value: string, key: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${key}_invalid_json`);
  }
};

const readProtectedRegularFile = (path: string, key: string): string => {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${key}_must_be_protected_regular_file`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(`${key}_must_be_protected_regular_file`);
  }
  return readFileSync(path, 'utf8');
};

const parseCodexConfigToml = (env: EnvLike): string => {
  const configPath = requiredEnv(env, 'FORGELOOP_CODEX_CONFIG_TOML_PATH');
  const configToml = readProtectedRegularFile(configPath, 'FORGELOOP_CODEX_CONFIG_TOML_PATH');
  if (configToml.trim().length === 0) {
    throw new Error('FORGELOOP_CODEX_CONFIG_TOML_PATH_empty');
  }
  return configToml;
};

export const codexConfigTomlForTarget = (toml: string, targetKind: 'generation' | 'run_execution'): string => {
  const policyLines =
    targetKind === 'generation'
      ? ['approval_policy = "never"', 'sandbox_mode = "read-only"']
      : ['approval_policy = "never"', 'sandbox_mode = "danger-full-access"'];
  const lines = toml.replace(/\n*$/, '').split(/\r?\n/);
  const firstTableIndex = lines.findIndex((line) => /^\s*\[/.test(line));
  const rootEnd = firstTableIndex === -1 ? lines.length : firstTableIndex;
  const rootLines = lines
    .slice(0, rootEnd)
    .filter((line) => !/^\s*(approval_policy|sandbox_mode)\s*=/.test(line))
    .filter((line, index, array) => !(line.trim().length === 0 && index === array.length - 1));
  const tableLines = lines.slice(rootEnd);
  const nextLines = [...rootLines, ...policyLines, ...(tableLines.length === 0 ? [] : ['', ...tableLines])];
  return `${nextLines.join('\n')}\n`;
};

export const codexRuntimeDogfoodWorkerIdentityForTarget = (
  baseWorkerIdentity: string,
  targetKind: 'generation' | 'run_execution',
): string => {
  const targetSuffix = targetKind === 'generation' ? 'generation' : 'run-execution';
  const scopeDigest = createHash('sha256')
    .update(codexCanonicalDigest({ worker_identity: baseWorkerIdentity, target_kind: targetKind }))
    .digest('hex')
    .slice(0, 12);
  return `codex-runtime-dogfood-worker-${scopeDigest}-${targetSuffix}`;
};

export const codexRuntimeDogfoodBootstrapTokenForTarget = (
  baseBootstrapToken: string,
  input: {
    workerIdentity: string;
    allowedScope: { project_id: string; repo_id?: string };
    allowedCapabilities: Record<string, unknown>;
  },
): string =>
  `codex-runtime-dogfood-bootstrap:${createHash('sha256')
    .update(
      codexCanonicalDigest({
        base_bootstrap_token_digest: codexCredentialPayloadDigest(baseBootstrapToken),
        worker_identity: input.workerIdentity,
        allowed_scope: input.allowedScope,
        allowed_capabilities: input.allowedCapabilities,
      }),
    )
    .digest('hex')}`;

export const codexRuntimeDogfoodUuidFromSeed = (input: unknown): string => {
  const hex = createHash('sha256').update(codexCanonicalDigest(input)).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const parseAuthJson = (env: EnvLike, stdin?: string): unknown => {
  if (optionalEnv(env, 'FORGELOOP_CODEX_AUTH_JSON_INLINE') !== undefined) {
    throw new Error('FORGELOOP_CODEX_AUTH_JSON_INLINE_not_allowed');
  }
  const authPath = optionalEnv(env, 'FORGELOOP_CODEX_AUTH_JSON_PATH');
  if (authPath !== undefined) {
    return parseJson(readProtectedRegularFile(authPath, 'FORGELOOP_CODEX_AUTH_JSON_PATH'), 'FORGELOOP_CODEX_AUTH_JSON_PATH');
  }
  if (stdin !== undefined && stdin.trim().length > 0) {
    return parseJson(stdin, 'stdin');
  }
  throw new Error('FORGELOOP_CODEX_AUTH_JSON_PATH_or_stdin_required');
};

const parseAllowlist = (env: EnvLike): CodexNetworkAllowlistRule[] => {
  const parsed = parseJson(requiredEnv(env, 'FORGELOOP_CODEX_EGRESS_ALLOWLIST_JSON'), 'FORGELOOP_CODEX_EGRESS_ALLOWLIST_JSON');
  if (!Array.isArray(parsed)) {
    throw new Error('FORGELOOP_CODEX_EGRESS_ALLOWLIST_JSON_must_be_array');
  }
  const rules = parsed.map((entry) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as { id?: unknown }).id !== 'string' ||
      (entry as { id: string }).id.trim().length === 0 ||
      !['https', 'http', 'tcp'].includes(String((entry as { protocol?: unknown }).protocol)) ||
      typeof (entry as { host?: unknown }).host !== 'string' ||
      (entry as { host: string }).host.trim().length === 0 ||
      !['model_provider', 'package_registry', 'git_remote', 'other'].includes(String((entry as { purpose?: unknown }).purpose)) ||
      ((entry as { port?: unknown }).port !== undefined &&
        (!Number.isInteger((entry as { port: unknown }).port) ||
          Number((entry as { port: unknown }).port) < 1 ||
          Number((entry as { port: unknown }).port) > 65_535))
    ) {
      throw new Error('FORGELOOP_CODEX_EGRESS_ALLOWLIST_JSON_invalid_rule');
    }
    return entry as CodexNetworkAllowlistRule;
  });
  if (!rules.some((rule) => rule.purpose === 'model_provider')) {
    throw new Error('FORGELOOP_CODEX_EGRESS_ALLOWLIST_JSON_requires_model_provider_rule');
  }
  return rules;
};

const providerBaseUrlHosts = (toml: string): string[] =>
  [
    ...toml.matchAll(/^\s*base_url\s*=\s*["']([^"']+)["']/gm),
  ].flatMap((match) => {
    try {
      const host = new URL(match[1]!).hostname.toLowerCase();
      return host.length === 0 ? [] : [host];
    } catch {
      return [];
    }
  });

const assertAllowlistCoversConfiguredModelProviders = (
  toml: string,
  allowlistRules: readonly CodexNetworkAllowlistRule[],
): void => {
  const allowedHosts = new Set(
    allowlistRules.filter((rule) => rule.purpose === 'model_provider').map((rule) => rule.host.toLowerCase()),
  );
  const missingHost = providerBaseUrlHosts(toml).find((host) => !allowedHosts.has(host));
  if (missingHost !== undefined) {
    throw new Error('FORGELOOP_CODEX_EGRESS_ALLOWLIST_JSON_missing_model_provider_host');
  }
};

export const loadCodexRuntimeDogfoodBootstrapConfig = (
  env: EnvLike = process.env,
  stdin?: string,
): CodexRuntimeDogfoodBootstrapConfig => {
  const actorClass = requiredEnv(env, 'FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_CLASS') as AutomationActorClass;
  if (actorClass !== 'system_bootstrap' && actorClass !== 'human_admin') {
    throw new Error('FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_CLASS_must_be_system_bootstrap_or_human_admin');
  }
  const networkProvider = requiredEnv(env, 'FORGELOOP_CODEX_NETWORK_PROVIDER');
  if (networkProvider !== 'docker_network_proxy') {
    throw new Error('FORGELOOP_CODEX_NETWORK_PROVIDER_must_be_docker_network_proxy');
  }
  const allowlistRules = parseAllowlist(env);
  const codexConfigToml = parseCodexConfigToml(env);
  assertAllowlistCoversConfiguredModelProviders(codexConfigToml, allowlistRules);
  const providerConfigWithoutDigest = {
    proxy_image: requiredEnv(env, 'FORGELOOP_CODEX_NETWORK_PROXY_IMAGE'),
    proxy_image_digest: requiredSha256Digest(env, 'FORGELOOP_CODEX_NETWORK_PROXY_IMAGE_DIGEST'),
    self_test_image: requiredEnv(env, 'FORGELOOP_CODEX_NETWORK_SELF_TEST_IMAGE'),
    self_test_image_digest: requiredSha256Digest(env, 'FORGELOOP_CODEX_NETWORK_SELF_TEST_IMAGE_DIGEST'),
  };
  const allowedScope = {
    project_id: requiredEnv(env, 'FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID'),
    ...(optionalEnv(env, 'FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID') === undefined
      ? {}
      : { repo_id: optionalEnv(env, 'FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID')! }),
  };
  return {
    controlPlaneUrl: requiredEnv(env, 'FORGELOOP_CONTROL_PLANE_URL').replace(/\/$/, ''),
    trustedActorHeaderSecret: requiredEnv(env, 'FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET'),
    actorId: requiredEnv(env, 'FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID'),
    actorClass,
    daemonIdentity: requiredEnv(env, 'FORGELOOP_CODEX_RUNTIME_SETUP_DAEMON_IDENTITY'),
    codexConfigToml,
    authJson: parseAuthJson(env, stdin),
    dockerImage: requiredEnv(env, 'FORGELOOP_CODEX_DOCKER_IMAGE'),
    dockerImageDigest: requiredSha256Digest(env, 'FORGELOOP_CODEX_DOCKER_IMAGE_DIGEST'),
    generationExpectedEffectiveConfigDigest: requiredSha256Digest(
      env,
      'FORGELOOP_CODEX_GENERATION_EXPECTED_EFFECTIVE_CONFIG_DIGEST',
    ),
    runExecutionExpectedEffectiveConfigDigest: requiredSha256Digest(
      env,
      'FORGELOOP_CODEX_RUN_EXECUTION_EXPECTED_EFFECTIVE_CONFIG_DIGEST',
    ),
    allowedScope,
    networkPolicy: {
      mode: 'egress_allowlist',
      provider: 'docker_network_proxy',
      allowlist_rules: allowlistRules,
      provider_config: {
        ...providerConfigWithoutDigest,
        provider_config_digest: codexCanonicalDigest(providerConfigWithoutDigest),
      },
      egress_allowlist_digest: codexCanonicalDigest(codexNetworkPolicyDigestInput('docker_network_proxy', allowlistRules)),
      self_test_digest: providerConfigWithoutDigest.self_test_image_digest,
    },
    workerIdentity: requiredEnv(env, 'FORGELOOP_WORKER_IDENTITY'),
    workerBootstrapToken: requiredEnv(env, 'FORGELOOP_WORKER_BOOTSTRAP_TOKEN'),
    workerBootstrapTokenVersion: positiveIntEnv(env, 'FORGELOOP_WORKER_BOOTSTRAP_TOKEN_VERSION'),
    hostWorkerUid: nonNegativeIntEnv(env, 'FORGELOOP_WORKER_HOST_UID', process.getuid?.() ?? 0),
    hostWorkerGid: nonNegativeIntEnv(env, 'FORGELOOP_WORKER_HOST_GID', process.getgid?.() ?? 0),
  };
};

const signedSetupPost = async (config: CodexRuntimeDogfoodBootstrapConfig, path: string, body: Record<string, unknown>) => {
  const setupNonce = randomUUID();
  const bodyWithNonce = { ...body, setup_nonce: setupNonce };
  const rawBody = JSON.stringify(bodyWithNonce);
  const headers = {
    'content-type': 'application/json',
    'X-Forgeloop-Setup-Nonce': setupNonce,
    ...signAutomationRequest({
      method: 'POST',
      pathAndQuery: path,
      rawBody,
      actorId: config.actorId,
      actorClass: config.actorClass,
      daemonIdentity: config.daemonIdentity,
      timestamp: new Date().toISOString(),
      secret: config.trustedActorHeaderSecret,
    }),
  };
  const response = await fetch(`${config.controlPlaneUrl}${path}`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  if (!response.ok) {
    throw new Error(`codex_runtime_bootstrap_failed:${path}:${response.status}`);
  }
  return response.json();
};

export const runCodexRuntimeDogfoodBootstrap = async (
  config: CodexRuntimeDogfoodBootstrapConfig = loadCodexRuntimeDogfoodBootstrapConfig(),
): Promise<Record<string, unknown>> => {
  const createdAt = new Date().toISOString();
  const generationAllowedScope = { project_id: config.allowedScope.project_id };
  if (config.allowedScope.repo_id === undefined) {
    throw new Error('FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID_required_for_run_execution_worker');
  }
  const runExecutionAllowedScope = { project_id: config.allowedScope.project_id, repo_id: config.allowedScope.repo_id };
  const generationWorkerIdentity = codexRuntimeDogfoodWorkerIdentityForTarget(config.workerIdentity, 'generation');
  const runExecutionWorkerIdentity = codexRuntimeDogfoodWorkerIdentityForTarget(config.workerIdentity, 'run_execution');
  const generationAllowedCapabilities = {
    target_kinds: ['generation'],
    docker_image_digests: [config.dockerImageDigest],
    network_policy_digests: [codexRuntimeNetworkPolicyDigest(config.networkPolicy)],
    network_provider_config_digests: [config.networkPolicy.provider_config.provider_config_digest],
  };
  const runExecutionAllowedCapabilities = {
    target_kinds: ['run_execution'],
    docker_image_digests: [config.dockerImageDigest],
    network_policy_digests: [codexRuntimeNetworkPolicyDigest(config.networkPolicy)],
    network_provider_config_digests: [config.networkPolicy.provider_config.provider_config_digest],
  };
  const bootstrapTokenId = (
    workerIdentity: string,
    allowedScope: { project_id: string; repo_id?: string },
    allowedCapabilities: typeof generationAllowedCapabilities,
    bootstrapTokenHash: string,
  ): string =>
    codexRuntimeDogfoodUuidFromSeed({
      kind: 'codex_runtime_dogfood_bootstrap_token',
      worker_identity: workerIdentity,
      allowed_scope: allowedScope,
      allowed_capabilities: allowedCapabilities,
      bootstrap_token_hash: bootstrapTokenHash,
      bootstrap_token_version: config.workerBootstrapTokenVersion,
    });
  const generationBootstrapTokenHash = codexCredentialPayloadDigest(
    codexRuntimeDogfoodBootstrapTokenForTarget(config.workerBootstrapToken, {
      workerIdentity: generationWorkerIdentity,
      allowedScope: generationAllowedScope,
      allowedCapabilities: generationAllowedCapabilities,
    }),
  );
  const runExecutionBootstrapTokenHash = codexCredentialPayloadDigest(
    codexRuntimeDogfoodBootstrapTokenForTarget(config.workerBootstrapToken, {
      workerIdentity: runExecutionWorkerIdentity,
      allowedScope: runExecutionAllowedScope,
      allowedCapabilities: runExecutionAllowedCapabilities,
    }),
  );
  const generationImport = (await signedSetupPost(config, '/internal/codex-runtime/import-local-codex', {
    profile_name: 'codex-runtime-generation-local-dogfood',
    target_kind: 'generation',
    local_source_label: 'dogfood-bootstrap-generation',
    codex_config_toml: codexConfigTomlForTarget(config.codexConfigToml, 'generation'),
    auth_json: config.authJson,
    project_id: config.allowedScope.project_id,
    docker_image: config.dockerImage,
    docker_image_digest: config.dockerImageDigest,
    expected_effective_config_digest: config.generationExpectedEffectiveConfigDigest,
    allowed_scopes: [generationAllowedScope],
    network_policy: config.networkPolicy,
    provider: 'unsafe_db',
    unsafe_db_acknowledgement: true,
    created_by: { actor_id: config.actorId },
  })) as Record<string, string>;
  const runExecutionImport = (await signedSetupPost(config, '/internal/codex-runtime/import-local-codex', {
    profile_name: 'codex-runtime-run-execution-local-dogfood',
    target_kind: 'run_execution',
    local_source_label: 'dogfood-bootstrap-run-execution',
    codex_config_toml: codexConfigTomlForTarget(config.codexConfigToml, 'run_execution'),
    auth_json: config.authJson,
    project_id: config.allowedScope.project_id,
    ...(config.allowedScope.repo_id === undefined ? {} : { repo_id: config.allowedScope.repo_id }),
    docker_image: config.dockerImage,
    docker_image_digest: config.dockerImageDigest,
    expected_effective_config_digest: config.runExecutionExpectedEffectiveConfigDigest,
    allowed_scopes: [runExecutionAllowedScope],
    network_policy: config.networkPolicy,
    provider: 'unsafe_db',
    unsafe_db_acknowledgement: true,
    created_by: { actor_id: config.actorId },
  })) as Record<string, string>;
  await signedSetupPost(config, '/internal/codex-runtime/worker-bootstrap-tokens', {
    id: bootstrapTokenId(
      generationWorkerIdentity,
      generationAllowedScope,
      generationAllowedCapabilities,
      generationBootstrapTokenHash,
    ),
    worker_identity: generationWorkerIdentity,
    bootstrap_token_hash: generationBootstrapTokenHash,
    bootstrap_token_version: config.workerBootstrapTokenVersion,
    status: 'active',
    allowed_scopes_json: [generationAllowedScope],
    allowed_capabilities_json: generationAllowedCapabilities,
    created_by_actor_id: config.actorId,
    created_at: createdAt,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    created_by: { actor_id: config.actorId },
  });
  await signedSetupPost(config, '/internal/codex-runtime/worker-bootstrap-tokens', {
    id: bootstrapTokenId(
      runExecutionWorkerIdentity,
      runExecutionAllowedScope,
      runExecutionAllowedCapabilities,
      runExecutionBootstrapTokenHash,
    ),
    worker_identity: runExecutionWorkerIdentity,
    bootstrap_token_hash: runExecutionBootstrapTokenHash,
    bootstrap_token_version: config.workerBootstrapTokenVersion,
    status: 'active',
    allowed_scopes_json: [runExecutionAllowedScope],
    allowed_capabilities_json: runExecutionAllowedCapabilities,
    created_by_actor_id: config.actorId,
    created_at: createdAt,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    created_by: { actor_id: config.actorId },
  });

  return {
    generation_runtime_profile_id: generationImport.profile_id,
    generation_runtime_profile_revision_id: generationImport.profile_revision_id,
    generation_credential_binding_id: generationImport.credential_binding_id,
    generation_credential_binding_version_id: generationImport.credential_binding_version_id,
    run_execution_runtime_profile_id: runExecutionImport.profile_id,
    run_execution_runtime_profile_revision_id: runExecutionImport.profile_revision_id,
    run_execution_credential_binding_id: runExecutionImport.credential_binding_id,
    run_execution_credential_binding_version_id: runExecutionImport.credential_binding_version_id,
    generation_worker_identity: generationWorkerIdentity,
    run_execution_worker_identity: runExecutionWorkerIdentity,
    docker_image_digest: config.dockerImageDigest,
    codex_config_digest: generationImport.codex_config_digest,
    network_policy_digest: codexRuntimeNetworkPolicyDigest(config.networkPolicy),
    network_provider_config_digest: config.networkPolicy.provider_config.provider_config_digest,
  };
};

export const renderCodexRuntimeDogfoodBootstrapCliFailure = (_error: unknown): string => 'codex_runtime_bootstrap_failed';

if (import.meta.url === `file://${process.argv[1]}`) {
  runCodexRuntimeDogfoodBootstrap()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((error: unknown) => {
      console.error(renderCodexRuntimeDogfoodBootstrapCliFailure(error));
      process.exitCode = 1;
    });
}
