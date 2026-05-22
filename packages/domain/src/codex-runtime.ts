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

export type CodexRuntimeNetworkProvider = 'host_firewall' | 'docker_network_proxy';

export type CodexRuntimeNetworkPolicy =
  | {
      mode: 'disabled';
    }
  | {
      mode: 'egress_allowlist';
      provider: 'host_firewall';
      allowlist_rules: readonly CodexNetworkAllowlistRule[];
      egress_allowlist_digest: string;
      self_test_digest: string;
    }
  | {
      mode: 'egress_allowlist';
      provider: 'docker_network_proxy';
      allowlist_rules: readonly CodexNetworkAllowlistRule[];
      provider_config: CodexDockerNetworkProxyConfig;
      egress_allowlist_digest: string;
      self_test_digest: string;
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

export type CodexRuntimeJobStatus = 'queued' | 'accepted' | 'materializing' | 'running' | 'terminal';
export type CodexRuntimeJobTerminalStatus = 'succeeded' | 'failed' | 'cancelled' | 'expired';

export interface CodexRuntimeJob {
  id: string;
  job_request_id: string;
  target_type: CodexLaunchTarget['target_type'];
  target_id: string;
  target_kind: CodexRuntimeTargetKind;
  project_id: string;
  repo_id?: string;
  worker_id: string;
  launch_lease_id: string;
  launch_attempt: number;
  status: CodexRuntimeJobStatus;
  input_digest: string;
  input_json: Record<string, unknown>;
  workspace_acquisition_digest?: string;
  workspace_acquisition_json?: Record<string, unknown>;
  accept_idempotency_key?: string;
  accept_request_digest?: string;
  accepted_at?: IsoDateTime;
  accepted_worker_session_digest?: string;
  accepted_session_public_key_id?: string;
  accepted_session_epoch?: number;
  materializing_at?: IsoDateTime;
  materialization_request_id?: string;
  materialization_request_digest?: string;
  start_idempotency_key?: string;
  start_request_digest?: string;
  started_at?: IsoDateTime;
  last_event_at?: IsoDateTime;
  cancel_requested_at?: IsoDateTime;
  cancel_idempotency_key?: string;
  cancel_request_digest?: string;
  drain_requested_at?: IsoDateTime;
  terminal_idempotency_key?: string;
  terminal_request_digest?: string;
  terminal_at?: IsoDateTime;
  terminal_status?: CodexRuntimeJobTerminalStatus;
  terminal_reason_code?: string;
  terminal_result_json?: Record<string, unknown>;
  expires_at: IsoDateTime;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface CodexLaunchTokenEnvelope {
  id: string;
  runtime_job_id: string;
  launch_lease_id: string;
  worker_id: string;
  key_id: string;
  algorithm: 'x25519-hkdf-sha256-aes-256-gcm';
  ciphertext: string;
  encryption_nonce: string;
  aad_json: Record<string, string>;
  aad_digest: string;
  envelope_digest: string;
  status: 'available' | 'claimed' | 'expired' | 'revoked';
  claim_request_id?: string;
  claim_request_digest?: string;
  claimed_worker_session_digest?: string;
  claimed_key_id?: string;
  claimed_at?: IsoDateTime;
  expires_at: IsoDateTime;
  created_at: IsoDateTime;
}

export interface CodexGenerationWorkloadV1 {
  schema_version: 'codex_generation_workload.v1';
  runtime_job_id: string;
  action_run_id: string;
  task_kind: 'spec_draft' | 'plan_draft' | 'package_drafts';
  prompt_version: string;
  output_schema_version: string;
  signed_context_ref: string;
  signed_context_digest: string;
  prompt_template_digest: string;
  created_at: string;
  expires_at: string;
}

export interface CodexRunExecutionWorkloadV1 {
  schema_version: 'codex_run_execution_workload.v1';
  runtime_job_id: string;
  run_session_id: string;
  execution_package_id: string;
  execution_package_version: number;
  run_worker_lease_id: string;
  workspace_bundle_id: string;
  workspace_bundle_digest: string;
  package_prompt_ref: string;
  package_prompt_digest: string;
  execution_context_ref: string;
  execution_context_digest: string;
  path_policy_digest: string;
  required_checks_digest?: string;
  output_schema_version: string;
  created_at: string;
  expires_at: string;
}

export interface CodexGenerationRuntimeJobResult {
  task_kind: 'spec_draft' | 'plan_draft' | 'package_drafts';
  prompt_version: string;
  output_schema_version: string;
  generated_payload: Record<string, unknown>;
  generated_payload_digest: string;
  generation_artifacts: Array<{
    kind: string;
    name: string;
    content_type: string;
    digest?: string;
    internal_ref?: string;
  }>;
  public_summary: string;
}

export interface WorkspaceBundleV1 {
  schema_version: 'workspace_bundle.v1';
  bundle_id: string;
  project_id: string;
  repo_id: string;
  run_session_id: string;
  execution_package_id: string;
  base_commit_sha: string;
  allowed_paths: string[];
  forbidden_paths: string[];
  source_mutation_policy: 'path_policy_scoped';
  archive_ref: string;
  archive_digest: string;
  manifest_digest: string;
  created_at: string;
}

export interface CodexRunExecutionRuntimeJobResult {
  task_kind: 'run_execution';
  execution_package_id: string;
  execution_package_version: number;
  run_session_id: string;
  workspace_bundle_digest: string;
  changed_files: string[];
  patch_artifact?: {
    content_type: 'text/x-diff';
    digest: string;
    internal_ref: string;
  };
  check_results: Array<{
    name: string;
    status: 'passed' | 'failed' | 'skipped';
    summary: string;
    output_digest?: string;
    output_internal_ref?: string;
  }>;
  execution_artifacts: Array<{
    kind: string;
    name: string;
    content_type: string;
    digest?: string;
    internal_ref?: string;
  }>;
  public_summary: string;
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
  runtime_profile_id: string;
  runtime_profile_revision_id: string;
  runtime_profile_digest: string;
  runtime_target_kind: CodexRuntimeTargetKind;
  source_access_mode: CodexSourceAccessMode;
  environment: CodexRuntimeEnvironment;
  credential_binding_id?: string;
  credential_binding_version_id?: string;
  credential_payload_digest?: string;
  launch_lease_id: string;
  worker_id: string;
  docker_image_digest: string;
  container_id_digest: string;
  app_server_effective_config_digest: string;
  network_policy_digest?: string;
  network_policy_self_test_digest?: string;
  docker_policy_self_check_digest: string;
  workspace_isolation_digest?: string;
  app_server_attempted: true;
  selected_execution_mode: 'app_server';
}

export interface CodexRuntimeStatusProjection extends Partial<CodexDockerRuntimeEvidence> {
  profile_status?: CodexRuntimeProfileRevision['status'];
  worker_status?: CodexWorkerRegistration['status'];
  lease_status?: CodexLaunchLease['status'];
  blocker_codes?: readonly CodexPublicBlockerCode[];
}

export const codexPublicBlockerCodes = [
  'codex_worker_docker_policy_unavailable',
  'codex_worker_unavailable',
  'codex_worker_capability_mismatch',
  'codex_worker_docker_unavailable',
  'codex_app_server_effective_config_mismatch',
  'codex_app_server_unavailable',
  'codex_runtime_workspace_isolation_unavailable',
  'codex_docker_runtime_evidence_unsafe',
  'codex_docker_runtime_required',
  'codex_runtime_profile_invalid',
  'codex_credential_unavailable',
  'codex_launch_lease_denied',
  'codex_launch_materialization_denied',
  'codex_runtime_job_unavailable',
  'codex_runtime_job_expired',
  'codex_runtime_job_cancelled',
  'codex_workspace_bundle_invalid',
] as const;

export type CodexPublicBlockerCode = (typeof codexPublicBlockerCodes)[number];

type CanonicalJsonValue = null | boolean | number | string | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue };

const sha256DigestPattern = /^sha256:[a-f0-9]{64}$/;
const secretConfigPattern = /(\$\{[^}]+\}|\$ENV\b|\benv\.|\b[A-Za-z0-9_.-]*(api[_-]?key|token|secret|auth)[A-Za-z0-9_.-]*\b)/i;
const unsafeEvidenceKeyPattern = /(secret|token|api_key|auth|password|workspace_path|source_repo_path|app_server_endpoint|endpoint|container_id)$/i;
const unsafeRuntimePublicKeyPattern = /(token|secret|auth|password|endpoint|container_id|workspace_path|source_repo_path)$/i;
const rawRuntimePublicFieldPattern = /^raw_(prompt|context|log|logs|notification|notifications|headers?)$/i;

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

const isRawPathEndpointOrContainerId = (value: string): boolean =>
  /^\/|https?:\/\/|^unix:|\.sock$/i.test(value) || /^[a-f0-9]{12,64}$/i.test(value);

const isRawRuntimePublicString = (value: string): boolean => {
  if (/^artifact:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$/i.test(value)) {
    return false;
  }
  if (/^forgeloop:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$/i.test(value)) {
    return false;
  }
  if (/^(application|audio|font|image|message|model|multipart|text|video)\/[A-Za-z0-9.+-]+$/i.test(value)) {
    return false;
  }
  const loopbackEndpointPattern =
    /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?(?:::0*1|(?:0{1,4}:){7}0{0,3}1)(?:%[A-Za-z0-9_.-]+)?\]?)(:\d{1,5})?(\/|$)/i;
  const privateIpv4EndpointPattern =
    /^(10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2})(:\d{1,5})?(\/|$)/i;
  const privateIpv6EndpointPattern =
    /^\[?(?:(?:fc|fd)[0-9a-f]{0,2}|fe80):[0-9a-f:]+(?:%[A-Za-z0-9_.-]+)?\]?(:\d{1,5})?(\/|$)/i;
  const internalHostEndpointPattern = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.internal(:\d{1,5})?(\/|$)/i;
  const clusterLocalEndpointPattern = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.svc\.cluster\.local(:\d{1,5})?(\/|$)/i;
  const singleLabelHostPortPattern = /^[a-z][a-z0-9-]*:\d{1,5}(\/|$)/i;
  const rawRuntimeServiceEndpointPattern = /^(app-server|control-plane)(:\d{1,5})?(\/|$)/i;
  const relativeLocalPathPattern = /^(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]*(?:$|[?#])/;
  const singleSegmentLocalPathPattern =
    /^(?:\.[A-Za-z0-9._-]+|(?:Dockerfile|Makefile)(?:\.[A-Za-z0-9._-]+)?|README|LICENSE|CHANGELOG|[A-Za-z0-9._-]+\.(?:cjs|css|diff|env|js|json|jsx|lock|log|md|mjs|patch|py|sh|sql|toml|ts|tsx|txt|yaml|yml)|app|apps|backend|build|client|config|configs|dist|docs|frontend|lib|node_modules|packages|repo|repository|scripts|server|src|test|tests|tmp|workspace|workspaces)$/i;
  const rawUrlSchemePattern = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
  const hostWithPortOrPathPattern = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(:\d{1,5}|\/)/i;
  return (
    /^(\/|~\/|\.{1,2}\/|[A-Za-z]:[\\/])/i.test(value) ||
    relativeLocalPathPattern.test(value) ||
    singleSegmentLocalPathPattern.test(value) ||
    rawUrlSchemePattern.test(value) ||
    /^file:\//i.test(value) ||
    /^https?:\/\//i.test(value) ||
    /^(app-server|control-plane):\/\//i.test(value) ||
    /^unix:/i.test(value) ||
    /\.sock(?:$|[/?#])/i.test(value) ||
    loopbackEndpointPattern.test(value) ||
    privateIpv4EndpointPattern.test(value) ||
    privateIpv6EndpointPattern.test(value) ||
    internalHostEndpointPattern.test(value) ||
    clusterLocalEndpointPattern.test(value) ||
    singleLabelHostPortPattern.test(value) ||
    rawRuntimeServiceEndpointPattern.test(value) ||
    hostWithPortOrPathPattern.test(value) ||
    /^[a-f0-9]{12,64}$/i.test(value)
  );
};

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

export const codexNetworkPolicyDigestInput = (
  provider: CodexRuntimeNetworkProvider,
  allowlistRules: readonly CodexNetworkAllowlistRule[],
): { provider: CodexRuntimeNetworkProvider; allowlist_rules: readonly CodexNetworkAllowlistRule[] } => ({
  provider,
  allowlist_rules: sortedAllowlist(allowlistRules),
});

export const normalizeCodexRuntimeNetworkPolicy = (policy: CodexRuntimeNetworkPolicy): CodexRuntimeNetworkPolicy => {
  if (policy.mode === 'disabled') {
    return policy;
  }
  return { ...policy, allowlist_rules: sortedAllowlist(policy.allowlist_rules) } as CodexRuntimeNetworkPolicy;
};

export const codexCanonicalDigest = (value: unknown): string =>
  `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;

export const codexCredentialPayloadDigest = (payload: unknown): string => codexCanonicalDigest(payload);

export const codexRuntimeNetworkPolicyDigest = (policy: CodexRuntimeNetworkPolicy): string =>
  codexCanonicalDigest(normalizeCodexRuntimeNetworkPolicy(policy));

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
    network_policy: normalizeCodexRuntimeNetworkPolicy(revision.network_policy),
    resource_limits: revision.resource_limits,
    docker_policy: revision.docker_policy,
    allowed_scopes: sortedScopes(revision.allowed_scopes),
  });

export const codexRuntimeJobIsActive = (job: Pick<CodexRuntimeJob, 'status'>): boolean => job.status !== 'terminal';

const unsafeCodexRuntimePublicValue = (message: string, details?: Record<string, unknown>): DomainError =>
  new DomainError('codex_docker_runtime_evidence_unsafe', message, details);

const assertCodexRuntimePublicSafeRecord = (value: unknown, label: string, path: readonly string[]): void => {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    Array.isArray(value) ||
    isPlainObject(value)
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw unsafeCodexRuntimePublicValue(`Codex runtime ${label} must be JSON-compatible.`, { field: path.join('.') });
    }
    if (typeof value === 'string' && isRawRuntimePublicString(value)) {
      throw unsafeCodexRuntimePublicValue(
        'Codex runtime public-safe values cannot include raw paths, endpoints, container IDs, socket paths, or secrets.',
        { field: path.join('.') },
      );
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => assertCodexRuntimePublicSafeRecord(entry, label, [...path, String(index)]));
    }
    if (isPlainObject(value)) {
      for (const [key, entry] of Object.entries(value)) {
        const entryPath = [...path, key];
        if (unsafeRuntimePublicKeyPattern.test(key) || rawRuntimePublicFieldPattern.test(key)) {
          throw unsafeCodexRuntimePublicValue(
            'Codex runtime public-safe values cannot include raw paths, endpoints, container IDs, socket paths, or secrets.',
            { field: entryPath.join('.') },
          );
        }
        assertCodexRuntimePublicSafeRecord(entry, label, entryPath);
      }
    }
    return;
  }

  throw unsafeCodexRuntimePublicValue(`Codex runtime ${label} must be JSON-compatible.`, { field: path.join('.') });
};

export const assertCodexRuntimePublicSafeValue = (input: unknown, label: string): void => {
  assertCodexRuntimePublicSafeRecord(input, label, []);
};

export const codexRuntimeJobInputDigest = (input: unknown): string => {
  assertCodexRuntimePublicSafeValue(input, 'job input');
  return codexCanonicalDigest(input);
};

export const codexWorkspaceAcquisitionDigest = (input: unknown | undefined): string | undefined => {
  if (input === undefined) {
    return undefined;
  }
  assertCodexRuntimePublicSafeValue(input, 'workspace acquisition');
  return codexCanonicalDigest(input);
};

export const codexLaunchTokenEnvelopeDigest = (input: unknown): string => {
  if (!isPlainObject(input)) {
    throw unsupportedJsonValue();
  }
  return codexCanonicalDigest({
    id: input.id,
    runtime_job_id: input.runtime_job_id,
    launch_lease_id: input.launch_lease_id,
    worker_id: input.worker_id,
    key_id: input.key_id,
    algorithm: input.algorithm,
    ciphertext: input.ciphertext,
    encryption_nonce: input.encryption_nonce,
    aad_json: input.aad_json,
    aad_digest: input.aad_digest,
    expires_at: input.expires_at,
  });
};

export const validateCodexRuntimeJobTerminalResult = (input: unknown): Record<string, unknown> => {
  if (!isPlainObject(input)) {
    throw unsafeCodexRuntimePublicValue('Codex runtime terminal result must be an object.');
  }
  assertCodexRuntimePublicSafeValue(input, 'terminal result');
  return input;
};

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
    if (Array.isArray(assertionValue)) {
      return (
        Array.isArray(capturedValue) &&
        capturedValue.length === assertionValue.length &&
        assertionValue.every((entry, index) => matchesAssertion(capturedValue[index], entry))
      );
    }
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
    const networkPolicy = normalizeCodexRuntimeNetworkPolicy(revision.network_policy);
    if (networkPolicy.mode === 'disabled') {
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

    const expectedAllowlistDigest = codexCanonicalDigest(codexNetworkPolicyDigestInput(networkPolicy.provider, networkPolicy.allowlist_rules));
    if (networkPolicy.egress_allowlist_digest !== expectedAllowlistDigest) {
      throw dockerPolicyUnavailable('Strict real dogfood egress allowlist digest does not match executable allowlist rules.');
    }
    assertSha256Digest(networkPolicy.self_test_digest, 'Network policy self-test digest', dockerPolicyUnavailable);
    const hasModelProvider = networkPolicy.allowlist_rules.some((rule) => rule.purpose === 'model_provider');
    if (!hasModelProvider) {
      throw dockerPolicyUnavailable('Strict real dogfood egress allowlist profiles require a model_provider allowlist rule.');
    }
  }

  const networkPolicy = normalizeCodexRuntimeNetworkPolicy(revision.network_policy);
  if (networkPolicy.mode === 'egress_allowlist' && networkPolicy.provider === 'docker_network_proxy') {
    validateCodexDockerNetworkProxyConfig(networkPolicy.provider_config);
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
    'worker_id',
    'docker_image_digest',
    'container_id_digest',
    'app_server_effective_config_digest',
    'network_policy_digest',
    'network_policy_self_test_digest',
    'docker_policy_self_check_digest',
    'workspace_isolation_digest',
    'app_server_attempted',
    'selected_execution_mode',
  ]);
  const requiredKeys: Array<keyof CodexDockerRuntimeEvidence> = [
    'runtime_profile_id',
    'runtime_profile_revision_id',
    'runtime_profile_digest',
    'runtime_target_kind',
    'source_access_mode',
    'environment',
    'launch_lease_id',
    'worker_id',
    'docker_image_digest',
    'container_id_digest',
    'app_server_effective_config_digest',
    'docker_policy_self_check_digest',
    'app_server_attempted',
    'selected_execution_mode',
  ];

  for (const key of requiredKeys) {
    if (!(key in evidence)) {
      throw unsafeDockerRuntimeEvidence('Codex public-safe Docker runtime evidence is missing required app-server proof.', {
        field: key,
      });
    }
  }

  for (const [key, value] of Object.entries(evidence)) {
    if (!allowedKeys.has(key as keyof CodexDockerRuntimeEvidence) || unsafeEvidenceKeyPattern.test(key)) {
      throw unsafeDockerRuntimeEvidence('Codex public-safe Docker runtime evidence cannot include raw paths, endpoints, container IDs, or secrets.', {
        field: key,
      });
    }
    if (key === 'app_server_attempted') {
      if (value !== true) {
        throw unsafeDockerRuntimeEvidence('Codex public-safe Docker runtime evidence must prove app-server was attempted.', {
          field: key,
        });
      }
      continue;
    }
    if (key === 'selected_execution_mode') {
      if (value !== 'app_server') {
        throw unsafeDockerRuntimeEvidence('Codex public-safe Docker runtime evidence must prove app-server execution mode.', {
          field: key,
        });
      }
      continue;
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

  return evidence as unknown as CodexDockerRuntimeEvidence;
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
    network_policy_digest: codexRuntimeNetworkPolicyDigest(value.profile_revision.network_policy),
  },
  resolved_credentials: value.resolved_credentials.map((credential) => ({
    binding_id: credential.binding_id,
    binding_version_id: credential.binding_version_id,
    payload_digest: credential.payload_digest,
  })),
  lease_id: value.lease_id,
  materialized_at: value.materialized_at,
});
