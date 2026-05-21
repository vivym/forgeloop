import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';

import { signAutomationRequest } from '../packages/automation/src/index';
import type { AutomationActorClass } from '../packages/domain/src/index';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexNetworkPolicyDigestInput,
  codexRuntimeNetworkPolicyDigest,
  codexRuntimeProfileRevisionDigest,
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

const parseAuthJson = (env: EnvLike, stdin?: string): unknown => {
  if (optionalEnv(env, 'FORGELOOP_CODEX_AUTH_JSON_INLINE') !== undefined) {
    throw new Error('FORGELOOP_CODEX_AUTH_JSON_INLINE_not_allowed');
  }
  const authPath = optionalEnv(env, 'FORGELOOP_CODEX_AUTH_JSON_PATH');
  if (authPath !== undefined) {
    const authStat = lstatSync(authPath);
    if (!authStat.isFile() || authStat.isSymbolicLink()) {
      throw new Error('FORGELOOP_CODEX_AUTH_JSON_PATH_must_be_protected_regular_file');
    }
    if ((authStat.mode & 0o077) !== 0) {
      throw new Error('FORGELOOP_CODEX_AUTH_JSON_PATH_must_be_protected_regular_file');
    }
    return parseJson(readFileSync(authPath, 'utf8'), 'FORGELOOP_CODEX_AUTH_JSON_PATH');
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
  const rules = parsed.map((entry) => entry as CodexNetworkAllowlistRule);
  if (!rules.some((rule) => rule.purpose === 'model_provider')) {
    throw new Error('FORGELOOP_CODEX_EGRESS_ALLOWLIST_JSON_requires_model_provider_rule');
  }
  return rules;
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

const buildProfileRevision = (
  config: CodexRuntimeDogfoodBootstrapConfig,
  input: {
    profileId: string;
    revisionId: string;
    targetKind: 'generation' | 'run_execution';
    expectedEffectiveConfigDigest: string;
  },
): CodexRuntimeProfileRevision => {
  const codexConfigToml = 'approval_policy = "never"\n';
  const revisionWithoutDigest: CodexRuntimeProfileRevision = {
    id: input.revisionId,
    profile_id: input.profileId,
    revision_number: 1,
    status: 'active',
    environment: 'local_dogfood',
    docker_image: config.dockerImage,
    docker_image_digest: config.dockerImageDigest,
    target_kind: input.targetKind,
    source_access_mode: input.targetKind === 'generation' ? 'artifact_only' : 'path_policy_scoped',
    codex_config_toml: codexConfigToml,
    codex_config_digest: codexCanonicalDigest(codexConfigToml),
    expected_effective_config_digest: input.expectedEffectiveConfigDigest,
    effective_config_assertions:
      input.targetKind === 'generation'
        ? {
            target_kind: 'generation',
            approval_policy: 'never',
            source_write_policy: 'artifact_only',
            forbidden_writable_roots: ['workspace'],
          }
        : {
            target_kind: 'run_execution',
            approval_policy: 'never',
            sandbox_type: 'danger-full-access',
            writable_roots_policy: 'task_workspace_only',
          },
    app_server_required: true,
    allowed_driver_kind: 'app_server',
    network_policy: config.networkPolicy,
    resource_limits: {
      cpu_ms: 600_000,
      memory_mb: 4096,
      pids: 512,
      fds: 1024,
      workspace_bytes: 2_000_000_000,
      artifact_bytes: 500_000_000,
      timeout_ms: 900_000,
      output_limit_bytes: 2_000_000,
      run_output_limit_bytes: 2_000_000,
    },
    docker_policy: {
      app_server_only: true,
      rootless: true,
      read_only_rootfs: true,
      no_new_privileges: true,
      drop_capabilities: ['ALL'],
    },
    allowed_scopes: [config.allowedScope],
    profile_digest: 'sha256:placeholder',
    created_by_actor_id: config.actorId,
    created_at: new Date().toISOString(),
  };
  return {
    ...revisionWithoutDigest,
    profile_digest: codexRuntimeProfileRevisionDigest(revisionWithoutDigest),
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
  const generationProfileId = 'codex-runtime-generation-local-dogfood';
  const runProfileId = 'codex-runtime-run-execution-local-dogfood';
  const generationRevision = buildProfileRevision(config, {
    profileId: generationProfileId,
    revisionId: `${generationProfileId}-rev-1`,
    targetKind: 'generation',
    expectedEffectiveConfigDigest: config.generationExpectedEffectiveConfigDigest,
  });
  const runRevision = buildProfileRevision(config, {
    profileId: runProfileId,
    revisionId: `${runProfileId}-rev-1`,
    targetKind: 'run_execution',
    expectedEffectiveConfigDigest: config.runExecutionExpectedEffectiveConfigDigest,
  });
  const createdAt = new Date().toISOString();
  const authDigest = codexCredentialPayloadDigest(config.authJson);
  for (const [profileId, revision] of [
    [generationProfileId, generationRevision],
    [runProfileId, runRevision],
  ] as const) {
    await signedSetupPost(config, '/internal/codex-runtime/profiles', {
      profile: {
        id: profileId,
        name: profileId,
        environment: 'local_dogfood',
        target_kind: revision.target_kind,
        active_revision_id: revision.id,
        created_by_actor_id: config.actorId,
        created_at: createdAt,
        updated_at: createdAt,
      },
      revision,
      created_by: { actor_id: config.actorId },
    });
    await signedSetupPost(config, '/internal/codex-runtime/credentials', {
      binding: {
        id: `${profileId}-credential`,
        profile_id: profileId,
        project_id: config.allowedScope.project_id,
        ...(config.allowedScope.repo_id === undefined ? {} : { repo_id: config.allowedScope.repo_id }),
        provider: 'unsafe_db',
        purpose: 'model_provider',
        active_version_id: `${profileId}-credential-v1`,
        created_by_actor_id: config.actorId,
        created_at: createdAt,
        updated_at: createdAt,
      },
      version: {
        id: `${profileId}-credential-v1`,
        binding_id: `${profileId}-credential`,
        version_number: 1,
        status: 'active',
        payload_digest: authDigest,
        created_by_actor_id: config.actorId,
        created_at: createdAt,
      },
      secret_payload_json: config.authJson,
      created_by: { actor_id: config.actorId },
    });
  }
  await signedSetupPost(config, '/internal/codex-runtime/worker-bootstrap-tokens', {
    id: `bootstrap-${createHash('sha256').update(config.workerIdentity).digest('hex').slice(0, 16)}`,
    worker_identity: config.workerIdentity,
    bootstrap_token_hash: codexCredentialPayloadDigest(config.workerBootstrapToken),
    bootstrap_token_version: config.workerBootstrapTokenVersion,
    status: 'active',
    allowed_scopes_json: [config.allowedScope],
    allowed_capabilities_json: {
      target_kinds: ['generation', 'run_execution'],
      docker_image_digests: [config.dockerImageDigest],
      network_policy_digests: [codexRuntimeNetworkPolicyDigest(config.networkPolicy)],
      network_provider_config_digests: [config.networkPolicy.provider_config.provider_config_digest],
    },
    created_by_actor_id: config.actorId,
    created_at: createdAt,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    created_by: { actor_id: config.actorId },
  });

  return {
    generation_runtime_profile_id: generationProfileId,
    generation_credential_binding_id: `${generationProfileId}-credential`,
    run_execution_runtime_profile_id: runProfileId,
    run_execution_credential_binding_id: `${runProfileId}-credential`,
    docker_image_digest: config.dockerImageDigest,
    network_policy_digest: codexRuntimeNetworkPolicyDigest(config.networkPolicy),
    network_provider_config_digest: config.networkPolicy.provider_config.provider_config_digest,
  };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  runCodexRuntimeDogfoodBootstrap()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
