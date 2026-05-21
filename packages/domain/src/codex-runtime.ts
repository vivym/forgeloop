import { createHash } from 'node:crypto';

import { DomainError, type IsoDateTime, type RunDriverKind } from './types.js';

export type CodexRuntimeEnvironment = 'local_dogfood' | 'test';
export type CodexRuntimeTargetKind = 'generation' | 'run_execution';
export type CodexSourceAccessMode = 'artifact_only' | 'path_policy_scoped';

export interface CodexRuntimeScope {
  project_id: string;
  repo_id?: string;
}

export interface CodexNetworkAllowlistRule {
  id: string;
  protocol: 'https' | 'http' | 'tcp';
  host: string;
  port?: number;
  path_prefix?: string;
  purpose: 'model_provider' | 'package_registry' | 'git_remote' | 'other';
}

export interface CodexDockerNetworkProxyConfig {
  proxy_image: string;
  proxy_image_digest: string;
  self_test_image: string;
  self_test_image_digest: string;
  provider_config_digest: string;
}

export type CodexRuntimeNetworkPolicy =
  | {
      mode: 'disabled';
    }
  | {
      mode: 'host_firewall';
      egress: 'allowlist';
      allowlist: readonly CodexNetworkAllowlistRule[];
    }
  | {
      mode: 'docker_network_proxy';
      egress: 'allowlist';
      allowlist: readonly CodexNetworkAllowlistRule[];
      provider_config: CodexDockerNetworkProxyConfig;
    };

export interface CodexRuntimeResourceLimits {
  cpu_ms: number;
  memory_mb: number;
  pids: number;
  fds: number;
  workspace_bytes: number;
  artifact_bytes: number;
  timeout_ms: number;
  output_limit_bytes: number;
  run_output_limit_bytes: number;
}

export interface CodexDockerPolicy {
  network_disabled?: boolean;
  app_server_only: boolean;
  rootless: boolean;
  read_only_rootfs: boolean;
  no_new_privileges: boolean;
  drop_capabilities: readonly string[];
}

export type CodexEffectiveConfigAssertions =
  | {
      target_kind: 'generation';
      approval_policy: 'never';
      source_write_policy: 'artifact_only';
      forbidden_writable_roots: readonly ['workspace'];
    }
  | {
      target_kind: 'run_execution';
      approval_policy: 'never';
      sandbox_type: 'danger-full-access' | 'dangerFullAccess';
      writable_roots_policy: 'task_workspace_only';
    };

export interface CodexRuntimeProfile {
  id: string;
  name: string;
  environment: CodexRuntimeEnvironment;
  target_kind: CodexRuntimeTargetKind;
  active_revision_id?: string;
  created_by_actor_id: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface CodexRuntimeProfileRevision {
  id: string;
  profile_id: string;
  revision_number: number;
  status: 'active' | 'superseded';
  environment: CodexRuntimeEnvironment;
  docker_image: string;
  docker_image_digest: string;
  target_kind: CodexRuntimeTargetKind;
  source_access_mode: CodexSourceAccessMode;
  codex_config_toml: string;
  codex_config_digest: string;
  expected_effective_config_digest: string;
  effective_config_assertions: CodexEffectiveConfigAssertions;
  app_server_required: boolean;
  allowed_driver_kind: Extract<RunDriverKind, 'app_server'>;
  network_policy: CodexRuntimeNetworkPolicy;
  resource_limits: CodexRuntimeResourceLimits;
  docker_policy: CodexDockerPolicy;
  allowed_scopes: readonly CodexRuntimeScope[];
  profile_digest: string;
  created_by_actor_id: string;
  created_at: IsoDateTime;
}

export interface CodexCredentialBinding {
  id: string;
  profile_id: string;
  project_id: string;
  repo_id?: string;
  provider: 'unsafe_db';
  purpose: 'model_provider' | 'package_registry' | 'git_remote' | 'other';
  active_version_id?: string;
  created_by_actor_id: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface CodexCredentialBindingVersion {
  id: string;
  binding_id: string;
  version_number: number;
  status: 'active' | 'superseded' | 'revoked';
  payload_digest: string;
  created_by_actor_id: string;
  created_at: IsoDateTime;
}

export interface CodexCredentialBindingPublic {
  id: string;
  profile_id: string;
  project_id: string;
  repo_id?: string;
  provider: string;
  purpose: CodexCredentialBinding['purpose'];
  active_version_id?: string;
  active_payload_digest?: string;
}

export interface ResolvedCodexCredential {
  binding_id: string;
  binding_version_id: string;
  payload: unknown;
  payload_digest: string;
}

export interface CodexWorkerBootstrapToken {
  id: string;
  token_hash: string;
  worker_id?: string;
  expires_at: IsoDateTime;
  consumed_at?: IsoDateTime;
  created_at: IsoDateTime;
}

export interface CodexWorkerRegistration {
  id: string;
  worker_version: string;
  worker_identity: string;
  status: 'online' | 'offline' | 'draining' | 'disabled';
  control_channel_status: 'connected' | 'disconnected';
  session_id?: string;
  session_expires_at?: IsoDateTime;
  bootstrap_token_hash?: string;
  capabilities: readonly CodexRuntimeTargetKind[];
  uid: number;
  gid: number;
  active_lease_count: number;
  max_concurrency: number;
  session_public_key: string;
  registered_at: IsoDateTime;
  last_heartbeat_at?: IsoDateTime;
}

export interface CodexLaunchTarget {
  target_type: 'automation_action_run' | 'run_session';
  target_id: string;
  target_kind: CodexRuntimeTargetKind;
  project_id: string;
  repo_id?: string;
}

export interface CodexLaunchLease {
  id: string;
  target: CodexLaunchTarget;
  launch_attempt: number;
  profile_revision_id: string;
  worker_id?: string;
  status: 'active' | 'materialized' | 'expired' | 'revoked' | 'terminal';
  lease_token_hash: string;
  created_at: IsoDateTime;
  expires_at: IsoDateTime;
  materialized_at?: IsoDateTime;
  terminal_at?: IsoDateTime;
  revoked_at?: IsoDateTime;
  terminal_reason_code?: string;
  terminal_evidence_summary?: Record<string, unknown>;
  terminal_runtime_job_id?: string;
  terminal_idempotency_key?: string;
}

export interface CodexLaunchLeaseWithToken extends CodexLaunchLease {
  lease_token: string;
}

export interface CodexLaunchMaterialization {
  launch_target: CodexLaunchTarget;
  profile_revision: CodexRuntimeProfileRevision;
  resolved_credentials: readonly ResolvedCodexCredential[];
  lease_id: string;
  expires_at: IsoDateTime;
  materialized_at: IsoDateTime;
}

export interface CodexDockerRuntimeEvidence {
  runtime_profile_id?: string;
  runtime_profile_revision_id?: string;
  runtime_profile_digest?: string;
  runtime_target_kind?: CodexRuntimeTargetKind;
  source_access_mode?: CodexSourceAccessMode;
  environment?: CodexRuntimeEnvironment;
  credential_binding_id?: string;
  credential_binding_version_id?: string;
  credential_payload_digest?: string;
  launch_lease_id?: string;
  docker_image_digest?: string;
  container_id_digest?: string;
  app_server_effective_config_digest?: string;
  network_policy_digest?: string;
  network_policy_self_test_digest?: string;
  docker_policy_self_check_digest?: string;
  workspace_isolation_digest?: string;
}

export interface CodexRuntimeStatusProjection extends CodexDockerRuntimeEvidence {
  profile_status?: CodexRuntimeProfileRevision['status'];
  worker_status?: CodexWorkerRegistration['status'];
  lease_status?: CodexLaunchLease['status'];
  blocker_codes?: readonly CodexPublicBlockerCode[];
}

export const codexPublicBlockerCodes = [
  'codex_worker_docker_policy_unavailable',
  'codex_app_server_effective_config_mismatch',
  'codex_docker_runtime_evidence_unsafe',
  'codex_runtime_profile_invalid',
] as const;

export type CodexPublicBlockerCode = (typeof codexPublicBlockerCodes)[number];

type CanonicalJsonValue = null | boolean | number | string | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue };

const sha256DigestPattern = /^sha256:[a-f0-9]{64}$/;
const secretConfigPattern = /(\$\{[^}]+\}|\$ENV\b|\benv\.|\b[A-Za-z0-9_.-]*(api[_-]?key|token|secret|auth)[A-Za-z0-9_.-]*\b)/i;
const unsafeEvidenceKeyPattern = /(secret|token|api_key|auth|password|credential|payload|workspace_path|source_repo_path|app_server_endpoint|endpoint|container_id)$/i;

const compareCodeUnits = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const invalidProfile = (message: string, details?: Record<string, unknown>): DomainError =>
  new DomainError('codex_runtime_profile_invalid', message, details);

const dockerPolicyUnavailable = (message: string, details?: Record<string, unknown>): DomainError =>
  new DomainError('codex_worker_docker_policy_unavailable', `codex_worker_docker_policy_unavailable: ${message}`, details);

const unsafeDockerRuntimeEvidence = (message: string, details?: Record<string, unknown>): DomainError =>
  new DomainError('codex_docker_runtime_evidence_unsafe', message, details);

const unsupportedJsonValue = (): DomainError => invalidProfile('Codex canonical digest input must be JSON-compatible.');

const canonicalize = (value: unknown, allowUndefinedObjectField = false): CanonicalJsonValue | undefined => {
  if (value === undefined) {
    if (allowUndefinedObjectField) {
      return undefined;
    }
    throw unsupportedJsonValue();
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw unsupportedJsonValue();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw unsupportedJsonValue();
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => {
      const canonicalEntry = canonicalize(entry);
      if (canonicalEntry === undefined) {
        throw unsupportedJsonValue();
      }
      return canonicalEntry;
    });
  }
  if (isPlainObject(value)) {
    return Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .reduce<Record<string, CanonicalJsonValue>>((accumulator, [key, entry]) => {
        const canonicalEntry = canonicalize(entry, true);
        if (canonicalEntry !== undefined) {
          accumulator[key] = canonicalEntry;
        }
        return accumulator;
      }, {});
  }
  throw unsupportedJsonValue();
};

const stableJson = (value: unknown): string => JSON.stringify(canonicalize(value));

const isSha256Digest = (value: unknown): value is string => typeof value === 'string' && sha256DigestPattern.test(value);

const isRawPathEndpointOrContainerId = (value: string): boolean => /^\/|https?:\/\//i.test(value) || /^[a-f0-9]{12,64}$/i.test(value);

const assertSha256Digest = (value: unknown, label: string, error: (message: string) => DomainError = invalidProfile): void => {
  if (!isSha256Digest(value)) {
    throw error(`${label} must be a pinned sha256 digest.`);
  }
};

const dockerNetworkProxyConfigDigestInput = (config: CodexDockerNetworkProxyConfig): Omit<CodexDockerNetworkProxyConfig, 'provider_config_digest'> => ({
  proxy_image: config.proxy_image,
  proxy_image_digest: config.proxy_image_digest,
  self_test_image: config.self_test_image,
  self_test_image_digest: config.self_test_image_digest,
});

const sortedScopes = (scopes: readonly CodexRuntimeScope[]): readonly CodexRuntimeScope[] =>
  [...scopes].sort((left, right) => compareCodeUnits(`${left.project_id}/${left.repo_id ?? ''}`, `${right.project_id}/${right.repo_id ?? ''}`));

const sortedAllowlist = (rules: readonly CodexNetworkAllowlistRule[]): readonly CodexNetworkAllowlistRule[] =>
  [...rules].sort((left, right) => compareCodeUnits(left.id, right.id));

const normalizedNetworkPolicy = (policy: CodexRuntimeNetworkPolicy): CodexRuntimeNetworkPolicy => {
  if (policy.mode === 'disabled') {
    return policy;
  }
  if (policy.mode === 'host_firewall') {
    return { ...policy, allowlist: sortedAllowlist(policy.allowlist) };
  }
  return { ...policy, allowlist: sortedAllowlist(policy.allowlist) };
};

export const codexCanonicalDigest = (value: unknown): string =>
  `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;

export const codexCredentialPayloadDigest = (payload: unknown): string => codexCanonicalDigest(payload);

export const codexRuntimeScopeMatches = (allowed: readonly CodexRuntimeScope[], target: CodexRuntimeScope): boolean =>
  allowed.some(
    (scope) =>
      scope.project_id === target.project_id &&
      (scope.repo_id === undefined || (target.repo_id !== undefined && scope.repo_id === target.repo_id)),
  );

export const codexRuntimeProfileRevisionDigest = (revision: CodexRuntimeProfileRevision): string =>
  codexCanonicalDigest({
    environment: revision.environment,
    docker_image: revision.docker_image,
    docker_image_digest: revision.docker_image_digest,
    target_kind: revision.target_kind,
    source_access_mode: revision.source_access_mode,
    codex_config_toml: revision.codex_config_toml,
    codex_config_digest: revision.codex_config_digest,
    expected_effective_config_digest: revision.expected_effective_config_digest,
    effective_config_assertions: revision.effective_config_assertions,
    app_server_required: revision.app_server_required,
    allowed_driver_kind: revision.allowed_driver_kind,
    network_policy: normalizedNetworkPolicy(revision.network_policy),
    resource_limits: revision.resource_limits,
    docker_policy: revision.docker_policy,
    allowed_scopes: sortedScopes(revision.allowed_scopes),
  });

export const validateCodexDockerNetworkProxyConfig = (config: CodexDockerNetworkProxyConfig): CodexDockerNetworkProxyConfig => {
  assertSha256Digest(config.proxy_image_digest, 'Docker proxy image digest', dockerPolicyUnavailable);
  assertSha256Digest(config.self_test_image_digest, 'Docker proxy self-test image digest', dockerPolicyUnavailable);

  const expectedDigest = codexCanonicalDigest(dockerNetworkProxyConfigDigestInput(config));
  if (config.provider_config_digest !== expectedDigest) {
    throw dockerPolicyUnavailable('Docker network proxy provider_config_digest does not match normalized provider config.', {
      expected_digest: expectedDigest,
      actual_digest: config.provider_config_digest,
    });
  }

  return config;
};

export const validateCodexEffectiveConfigAssertions = (
  captured: Record<string, unknown>,
  assertions: CodexEffectiveConfigAssertions,
): CodexPublicBlockerCode | undefined => {
  const matchesAssertion = (capturedValue: unknown, assertionValue: unknown): boolean => {
    if (isPlainObject(assertionValue)) {
      if (!isPlainObject(capturedValue)) {
        return false;
      }
      return Object.entries(assertionValue).every(([key, value]) => matchesAssertion(capturedValue[key], value));
    }
    return capturedValue === assertionValue;
  };

  return matchesAssertion(captured, assertions) ? undefined : 'codex_app_server_effective_config_mismatch';
};

export const validateCodexLaunchTargetKind = (
  targetType: CodexLaunchTarget['target_type'],
  targetKind: CodexRuntimeTargetKind,
): void => {
  const valid =
    (targetType === 'automation_action_run' && targetKind === 'generation') ||
    (targetType === 'run_session' && targetKind === 'run_execution');
  if (!valid) {
    throw invalidProfile(`Launch target type ${targetType} cannot use Codex runtime target kind ${targetKind}.`);
  }
};

export const validateCodexRuntimeProfileRevision = (
  revision: CodexRuntimeProfileRevision,
  options: { strictRealDogfood?: boolean } = {},
): CodexRuntimeProfileRevision => {
  assertSha256Digest(revision.docker_image_digest, 'Docker image digest');
  assertSha256Digest(revision.codex_config_digest, 'Codex config digest');
  assertSha256Digest(revision.expected_effective_config_digest, 'Expected effective config digest');

  const expectedCodexConfigDigest = codexCanonicalDigest(revision.codex_config_toml);
  if (revision.codex_config_digest !== expectedCodexConfigDigest) {
    throw invalidProfile('Codex runtime profile config digest does not match normalized Codex config.');
  }

  const expectedProfileDigest = codexRuntimeProfileRevisionDigest(revision);
  if (revision.profile_digest !== expectedProfileDigest) {
    throw invalidProfile('Codex runtime profile digest does not match runtime-affecting profile data.');
  }

  if (secretConfigPattern.test(revision.codex_config_toml)) {
    throw invalidProfile('Codex config TOML must not contain secret-looking keys or environment interpolation channels.');
  }

  if (revision.app_server_required !== true || revision.allowed_driver_kind !== 'app_server') {
    throw invalidProfile('Codex runtime profiles must require the app-server driver.');
  }

  const strict = options.strictRealDogfood === true;
  if (strict) {
    if (revision.network_policy.mode === 'disabled') {
      throw dockerPolicyUnavailable('Strict real dogfood profiles require a model_provider egress allowlist network policy.');
    }
    if (revision.docker_policy.network_disabled === true) {
      throw dockerPolicyUnavailable('Strict real dogfood profiles must not disable Docker networking when using an egress allowlist network policy.');
    }

    if (
      revision.docker_policy.app_server_only !== true ||
      revision.docker_policy.rootless !== true ||
      revision.docker_policy.read_only_rootfs !== true ||
      revision.docker_policy.no_new_privileges !== true ||
      !revision.docker_policy.drop_capabilities.includes('ALL')
    ) {
      throw dockerPolicyUnavailable('Strict real dogfood profiles require Docker app-server-only, rootless, read-only, no-new-privileges policy with all capabilities dropped.');
    }

    if (revision.effective_config_assertions.approval_policy !== 'never') {
      throw invalidProfile('Strict Codex runtime profiles must assert approval_policy never.');
    }
    if (revision.target_kind === 'generation') {
      if (
        revision.source_access_mode !== 'artifact_only' ||
        revision.effective_config_assertions.target_kind !== 'generation' ||
        revision.effective_config_assertions.source_write_policy !== 'artifact_only' ||
        revision.effective_config_assertions.forbidden_writable_roots.length !== 1 ||
        revision.effective_config_assertions.forbidden_writable_roots[0] !== 'workspace'
      ) {
        throw invalidProfile('Strict generation profiles must assert artifact-only source access and no source workspace writes.');
      }
    }
    if (revision.target_kind === 'run_execution') {
      if (
        revision.source_access_mode !== 'path_policy_scoped' ||
        revision.effective_config_assertions.target_kind !== 'run_execution' ||
        !['danger-full-access', 'dangerFullAccess'].includes(revision.effective_config_assertions.sandbox_type) ||
        revision.effective_config_assertions.writable_roots_policy !== 'task_workspace_only'
      ) {
        throw invalidProfile('Strict run-execution profiles must assert task-workspace-only sandbox access.');
      }
    }

    const hasModelProvider = revision.network_policy.allowlist.some((rule) => rule.purpose === 'model_provider');
    if (!hasModelProvider) {
      throw dockerPolicyUnavailable('Strict real dogfood egress allowlist profiles require a model_provider allowlist rule.');
    }
  }

  if (revision.network_policy.mode === 'docker_network_proxy') {
    validateCodexDockerNetworkProxyConfig(revision.network_policy.provider_config);
  }

  return revision;
};

export const validateCodexDockerRuntimeEvidence = (evidence: unknown): CodexDockerRuntimeEvidence => {
  if (!isPlainObject(evidence)) {
    throw unsafeDockerRuntimeEvidence('Codex public-safe Docker runtime evidence must be an object.');
  }

  const allowedKeys = new Set<keyof CodexDockerRuntimeEvidence>([
    'runtime_profile_id',
    'runtime_profile_revision_id',
    'runtime_profile_digest',
    'runtime_target_kind',
    'source_access_mode',
    'environment',
    'credential_binding_id',
    'credential_binding_version_id',
    'credential_payload_digest',
    'launch_lease_id',
    'docker_image_digest',
    'container_id_digest',
    'app_server_effective_config_digest',
    'network_policy_digest',
    'network_policy_self_test_digest',
    'docker_policy_self_check_digest',
    'workspace_isolation_digest',
  ]);

  for (const [key, value] of Object.entries(evidence)) {
    if (!allowedKeys.has(key as keyof CodexDockerRuntimeEvidence) || unsafeEvidenceKeyPattern.test(key)) {
      throw unsafeDockerRuntimeEvidence('Codex public-safe Docker runtime evidence cannot include raw paths, endpoints, container IDs, or secrets.', {
        field: key,
      });
    }
    if (typeof value !== 'string') {
      throw unsafeDockerRuntimeEvidence('Codex public-safe Docker runtime evidence values must be strings.', { field: key });
    }
    if (key.endsWith('_digest') && !isSha256Digest(value)) {
      throw unsafeDockerRuntimeEvidence('Codex public-safe Docker runtime evidence digest fields must be sha256 digests.', {
        field: key,
      });
    }
    if (isRawPathEndpointOrContainerId(value) && !key.endsWith('_digest')) {
      throw unsafeDockerRuntimeEvidence('Codex public-safe Docker runtime evidence cannot include raw paths, endpoints, container IDs, or secrets.', {
        field: key,
      });
    }
  }

  return evidence;
};

export const redactCodexLaunchMaterialization = (value: CodexLaunchMaterialization): Record<string, unknown> => ({
  launch_target: value.launch_target,
  profile_revision: {
    id: value.profile_revision.id,
    profile_id: value.profile_revision.profile_id,
    profile_digest: value.profile_revision.profile_digest,
    computed_profile_digest: codexRuntimeProfileRevisionDigest(value.profile_revision),
    target_kind: value.profile_revision.target_kind,
    source_access_mode: value.profile_revision.source_access_mode,
    docker_image_digest: value.profile_revision.docker_image_digest,
    network_policy_digest: codexCanonicalDigest(normalizedNetworkPolicy(value.profile_revision.network_policy)),
  },
  resolved_credentials: value.resolved_credentials.map((credential) => ({
    binding_id: credential.binding_id,
    binding_version_id: credential.binding_version_id,
    payload_digest: credential.payload_digest,
  })),
  lease_id: value.lease_id,
  materialized_at: value.materialized_at,
});
