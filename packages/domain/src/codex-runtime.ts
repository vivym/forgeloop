import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import { artifactRefSchema } from '@forgeloop/contracts';

import { isInternalArtifactRefString, parseInternalArtifactRef } from './internal-artifacts.js';
import type { CodexRuntimeCapsule } from './plan-item-workflow.js';
import { DomainError, type IsoDateTime, type RunDriverKind, type WorkflowPersistenceRefs } from './types.js';

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
  session_epoch: number;
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

export interface CodexRuntimeJob extends WorkflowPersistenceRefs {
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
  accepted_session_public_key_expires_at?: IsoDateTime;
  accepted_session_epoch?: number;
  materializing_at?: IsoDateTime;
  materialization_request_id?: string;
  materialization_request_digest?: string;
  start_idempotency_key?: string;
  start_request_digest?: string;
  runtime_evidence_digest?: string;
  launch_materialization_digest?: string;
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

export interface CodexRuntimeJobArtifact {
  id: string;
  runtime_job_id: string;
  project_id: string;
  repo_id?: string;
  target_kind: CodexRuntimeTargetKind;
  artifact_idempotency_key: string;
  kind: string;
  name: string;
  content_type: string;
  digest: string;
  internal_ref: string;
  internal_artifact_object_id?: string;
  size_bytes: number;
  metadata_json: Record<string, unknown>;
  created_at: IsoDateTime;
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

export const codexGenerationTaskKinds = [
  'spec_draft',
  'plan_draft',
  'package_drafts',
  'boundary_brainstorming_round',
  'development_plan_item_spec_revision',
  'development_plan_item_execution_plan_revision',
] as const;

export type CodexGenerationTaskKind = (typeof codexGenerationTaskKinds)[number];

export type CodexLaunchTokenEnvelopeDigestInput = Pick<
  CodexLaunchTokenEnvelope,
  | 'id'
  | 'runtime_job_id'
  | 'launch_lease_id'
  | 'worker_id'
  | 'key_id'
  | 'algorithm'
  | 'ciphertext'
  | 'encryption_nonce'
  | 'aad_json'
  | 'aad_digest'
  | 'expires_at'
>;

export interface CodexGenerationWorkloadV1 {
  schema_version: 'codex_generation_workload.v1';
  runtime_job_id: string;
  action_run_id: string;
  plan_item_workflow_action_id?: string;
  task_kind: CodexGenerationTaskKind;
  prompt_version: string;
  output_schema_version: string;
  signed_context_ref: string;
  signed_context_digest: string;
  prompt_template_digest: string;
  created_at: string;
  expires_at: string;
  codex_session_runtime_context?: CodexSessionRuntimeContextV1;
  codex_session_terminalization?: CodexSessionTerminalizationV1;
}

export type CodexThreadContinuationV1 =
  | { kind: 'start_thread' }
  | { kind: 'resume_thread'; codex_thread_id: string; codex_thread_id_digest: string };

const codexSessionThreadIdDigest = (threadId: string): string =>
  codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: threadId });

export interface CodexSessionRuntimeContextV1 {
  schema_version: 'codex_session_runtime_context.v1';
  codex_session_id: string;
  codex_session_turn_id: string;
  lease_id: string;
  lease_epoch: number;
  worker_id: string;
  worker_session_digest: string;
  expected_input_capsule_digest?: string;
  runner_runtime_job_id?: string;
  runner_launch_lease_id?: string;
  turn_group_status: 'intermediate' | 'complete';
  continuation: CodexThreadContinuationV1;
}

const codexSessionRuntimeContextKeys = new Set([
  'schema_version',
  'codex_session_id',
  'codex_session_turn_id',
  'lease_id',
  'lease_epoch',
  'worker_id',
  'worker_session_digest',
  'expected_input_capsule_digest',
  'runner_runtime_job_id',
  'runner_launch_lease_id',
  'turn_group_status',
  'continuation',
]);

const codexRunExecutionWorkloadKeys = new Set([
  'schema_version',
  'runtime_job_id',
  'plan_item_workflow_id',
  'development_plan_id',
  'development_plan_item_id',
  'run_session_id',
  'execution_package_id',
  'execution_package_version',
  'workspace_bundle_id',
  'workspace_bundle_digest',
  'package_prompt_ref',
  'package_prompt_digest',
  'execution_context_ref',
  'execution_context_digest',
  'path_policy_digest',
  'required_checks_digest',
  'output_schema_version',
  'created_at',
  'expires_at',
  'workspace_acquisition_json',
  'codex_session_runtime_context',
  'codex_session_terminalization',
]);

const codexRunExecutionWorkspaceAcquisitionKeys = new Set(['manifest_digest', 'size_bytes']);
const codexRunExecutionResumeThreadContinuationKeys = new Set([
  'kind',
  'codex_thread_id',
  'codex_thread_id_digest',
]);

const codexSessionTerminalizationKeys = new Set([
  'schema_version',
  'lease_token',
  'codex_session_id',
  'codex_session_turn_id',
  'expected_input_capsule_digest',
  'input_capsule_id',
  'input_capsule_digest',
  'input_capsule_ref',
  'base_memory_bundle_ref',
  'base_memory_bundle_digest',
  'input_memory_bundle_ref',
  'input_memory_bundle_digest',
  'input_environment_manifest_ref',
  'input_environment_manifest_digest',
]);

export interface CodexSessionTerminalizationV1 {
  schema_version: 'codex_session_terminalization.v1';
  lease_token: string;
  codex_session_id: string;
  codex_session_turn_id: string;
  expected_input_capsule_digest?: string;
  input_capsule_id?: string;
  input_capsule_digest?: string;
  input_capsule_ref?: string;
  base_memory_bundle_ref?: string;
  base_memory_bundle_digest?: string;
  input_memory_bundle_ref?: string;
  input_memory_bundle_digest?: string;
  input_environment_manifest_ref?: string;
  input_environment_manifest_digest?: string;
}

export interface CodexRunExecutionWorkspaceAcquisitionV1 {
  manifest_digest: string;
  size_bytes: number;
}

export interface CodexRunExecutionWorkloadV1 {
  schema_version: 'codex_run_execution_workload.v1';
  runtime_job_id: string;
  plan_item_workflow_id?: string;
  development_plan_id?: string;
  development_plan_item_id?: string;
  run_session_id: string;
  execution_package_id: string;
  execution_package_version: number;
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
  workspace_acquisition_json?: CodexRunExecutionWorkspaceAcquisitionV1;
  codex_session_runtime_context?: CodexSessionRuntimeContextV1;
  codex_session_terminalization?: CodexSessionTerminalizationV1;
}

export type CodexWorkflowRunExecutionRuntimeContextV1 = CodexSessionRuntimeContextV1 & {
  expected_input_capsule_digest: string;
  turn_group_status: 'complete';
  continuation: Extract<CodexThreadContinuationV1, { kind: 'resume_thread' }>;
};

export type CodexWorkflowRunExecutionTerminalizationV1 = CodexSessionTerminalizationV1 & {
  expected_input_capsule_digest: string;
  input_capsule_id: string;
  input_capsule_ref: string;
  input_capsule_digest: string;
  input_memory_bundle_ref: string;
  input_memory_bundle_digest: string;
  input_environment_manifest_ref: string;
  input_environment_manifest_digest: string;
};

export interface CodexWorkflowRunExecutionWorkloadV1 extends CodexRunExecutionWorkloadV1 {
  plan_item_workflow_id: string;
  development_plan_id: string;
  development_plan_item_id: string;
  workspace_acquisition_json: CodexRunExecutionWorkspaceAcquisitionV1;
  codex_session_runtime_context: CodexWorkflowRunExecutionRuntimeContextV1;
  codex_session_terminalization: CodexWorkflowRunExecutionTerminalizationV1;
}

export interface CodexRunExecutionExpectedContinuation {
  codex_session_id: string;
  codex_session_turn_id: string;
  input_capsule_digest: string;
  input_memory_bundle_ref: string;
  input_memory_bundle_digest: string;
  input_environment_manifest_ref: string;
  input_environment_manifest_digest: string;
  lease_id: string;
  lease_epoch: number;
  worker_id: string;
  worker_session_digest: string;
  codex_thread_id_digest: string;
}

export interface CodexGenerationRuntimeJobResult {
  task_kind: CodexGenerationTaskKind;
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
  codex_session_thread?: {
    codex_thread_id: string;
    codex_thread_id_digest: string;
    app_server_turn_id?: string;
  };
  output_capsule?: CodexRuntimeCapsule;
  output_memory_bundle_ref?: string;
  output_memory_bundle_digest?: string;
  memory_delta_artifact_ref?: string;
  memory_delta_digest?: string;
  output_environment_manifest_ref?: string;
  output_environment_manifest_digest?: string;
  runtime_evidence?: CodexDockerRuntimeEvidence;
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
  output_schema_version: 'codex_run_execution_result.v1';
  execution_package_id: string;
  execution_package_version: number;
  run_session_id: string;
  workspace_bundle_digest: string;
  workspace_bundle_manifest_digest: string;
  mounted_task_workspace_digest: string;
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
  codex_session_thread?: {
    codex_thread_id: string;
    codex_thread_id_digest: string;
    app_server_turn_id?: string;
  };
  output_capsule?: CodexRuntimeCapsule;
  output_memory_bundle_ref?: string;
  output_memory_bundle_digest?: string;
  memory_delta_artifact_ref?: string;
  memory_delta_digest?: string;
  output_environment_manifest_ref?: string;
  output_environment_manifest_digest?: string;
  codex_session_turn_id?: string;
  runtime_evidence?: CodexDockerRuntimeEvidence;
  public_summary: string;
}

export interface CodexWorkflowRunExecutionRuntimeJobResult extends CodexRunExecutionRuntimeJobResult {
  codex_session_thread: {
    codex_thread_id: string;
    codex_thread_id_digest: string;
    app_server_turn_id?: string;
  };
  output_capsule: CodexRuntimeCapsule;
  output_memory_bundle_ref: string;
  output_memory_bundle_digest: string;
  memory_delta_artifact_ref?: string;
  memory_delta_digest?: string;
  output_environment_manifest_ref: string;
  output_environment_manifest_digest: string;
  codex_session_turn_id: string;
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
  'codex_generation_workload_unsupported',
  'codex_runtime_job_expired',
  'codex_runtime_job_cancelled',
  'codex_workspace_bundle_invalid',
  'codex_runtime_job_stale',
  'codex_runtime_job_lease_terminal',
  'codex_session_resume_without_binding',
  'codex_session_thread_binding_partial',
  'codex_session_runner_unavailable',
  'codex_app_server_resume_failed',
  'codex_app_server_thread_mismatch',
  'codex_session_thread_digest_mismatch',
  'codex_session_thread_start_for_bound_session',
  'codex_session_thread_binding_stale',
  'codex_app_server_thread_id_missing',
  'codex_runtime_capsule_missing',
  'codex_memory_bundle_missing',
  'codex_environment_manifest_missing',
  'codex_runtime_capsule_unknown_path',
] as const;

export type CodexPublicBlockerCode = (typeof codexPublicBlockerCodes)[number];
export const codexRuntimeRecoveryReasonCodes = ['codex_runtime_job_stale', 'codex_runtime_job_lease_terminal'] as const;
export type CodexRuntimeRecoveryReasonCode = (typeof codexRuntimeRecoveryReasonCodes)[number];
export const isCodexRuntimeRecoveryReasonCode = (value: string): value is CodexRuntimeRecoveryReasonCode =>
  (codexRuntimeRecoveryReasonCodes as readonly string[]).includes(value);

export const assertCodexRuntimeRecoveryReasonCode = (value: string): CodexRuntimeRecoveryReasonCode => {
  if (!isCodexRuntimeRecoveryReasonCode(value)) {
    throw new DomainError('codex_runtime_job_unavailable', 'Codex runtime recovery reason code was rejected.');
  }
  return value;
};

type CanonicalJsonValue = null | boolean | number | string | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue };

const sha256DigestPattern = /^sha256:[a-f0-9]{64}$/;
const configInterpolationPattern = /(\$\{[^}]+\}|\$ENV\b|\benv\.)/i;
const unsafeEvidenceKeyPattern = /(secret|token|api_key|auth|password|workspace_path|source_repo_path|app_server_endpoint|endpoint|container_id)$/i;
const unsafeRuntimePublicKeyPattern =
  /(api[_-]?key|token|secret|auth(?:orization)?(?:_header)?|password|endpoint|socket(?:_path|_ref)?|container(?:_id|_name|_ref)?|workspace_path|source_repo_path)$/i;
const rawRuntimePublicFieldPattern = /^raw(?:_|[A-Z]|$)/;
const validRuntimeTargetKinds = new Set<CodexRuntimeTargetKind>(['generation', 'run_execution']);
const validSourceAccessModes = new Set<CodexSourceAccessMode>(['artifact_only', 'path_policy_scoped']);
const validRuntimeEnvironments = new Set<CodexRuntimeEnvironment>(['local_dogfood', 'test']);
const validRuntimeProfileRevisionStatuses = new Set<CodexRuntimeProfileRevision['status']>(['active', 'superseded']);
const validNetworkAllowlistProtocols = new Set<CodexNetworkAllowlistRule['protocol']>(['https', 'http', 'tcp']);
const validNetworkAllowlistPurposes = new Set<CodexNetworkAllowlistRule['purpose']>(['model_provider', 'package_registry', 'git_remote', 'other']);
const validRuntimeNetworkProviders = new Set<CodexRuntimeNetworkProvider>(['host_firewall', 'docker_network_proxy']);
const runtimeResourceLimitKeys: Array<keyof CodexRuntimeResourceLimits> = [
  'cpu_ms',
  'memory_mb',
  'pids',
  'fds',
  'workspace_bytes',
  'artifact_bytes',
  'timeout_ms',
  'output_limit_bytes',
  'run_output_limit_bytes',
];
const singleLabelHostPortPattern = /^[a-z][a-z0-9_-]*:\d{1,5}(\/|$)/i;

const normalizeRuntimePublicKey = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-:\s]+/g, '_')
    .toLowerCase();

const compactRuntimePublicKey = (key: string): string => normalizeRuntimePublicKey(key).replace(/_/g, '');
const unsafeRuntimePublicCompactKeys = new Set([
  'prompt',
  'prompts',
  'systemprompt',
  'developerprompt',
  'userprompt',
  'workerprompt',
  'log',
  'logs',
  'stdout',
  'stderr',
  'appserverlog',
  'appserverlogs',
  'workerlog',
  'workerlogs',
  'containerlog',
  'containerlogs',
  'notification',
  'notifications',
  'rawnotification',
  'rawnotifications',
]);

const compareCodeUnits = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const invalidProfile = (message: string, details?: Record<string, unknown>): DomainError =>
  new DomainError('codex_runtime_profile_invalid', message, details);

const unsupportedGenerationWorkload = (message: string, details?: Record<string, unknown>): DomainError =>
  new DomainError('codex_generation_workload_unsupported', message, details);

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

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const requireRuntimeContextString = (record: Record<string, unknown>, key: keyof CodexSessionRuntimeContextV1): string => {
  const value = record[key];
  if (!isNonEmptyString(value)) {
    throw unsupportedGenerationWorkload(`codex_generation_workload_unsupported: ${String(key)} is required.`);
  }
  return value;
};

const optionalRuntimeContextString = (record: Record<string, unknown>, key: keyof CodexSessionRuntimeContextV1): string | undefined => {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (!isNonEmptyString(value)) {
    throw unsupportedGenerationWorkload(`codex_generation_workload_unsupported: ${String(key)} is invalid.`);
  }
  return value;
};

export const validateCodexSessionRuntimeContext = (value: unknown): CodexSessionRuntimeContextV1 => {
  if (!isPlainObject(value) || value.schema_version !== 'codex_session_runtime_context.v1') {
    throw unsupportedGenerationWorkload('codex_generation_workload_unsupported: session runtime context is unsupported.');
  }
  for (const key of Object.keys(value)) {
    if (!codexSessionRuntimeContextKeys.has(key)) {
      throw unsupportedGenerationWorkload(`codex_generation_workload_unsupported: ${key} is unsupported.`);
    }
  }

  const continuation = value.continuation;
  if (!isPlainObject(continuation)) {
    throw unsupportedGenerationWorkload('codex_generation_workload_unsupported: continuation is required.');
  }
  if (continuation.kind !== 'start_thread' && continuation.kind !== 'resume_thread') {
    throw unsupportedGenerationWorkload('codex_generation_workload_unsupported: continuation kind is unsupported.');
  }

  const runnerRuntimeJobId = optionalRuntimeContextString(value, 'runner_runtime_job_id');
  const runnerLaunchLeaseId = optionalRuntimeContextString(value, 'runner_launch_lease_id');
  const expectedInputCapsuleDigest = optionalRuntimeContextString(value, 'expected_input_capsule_digest');
  if ((runnerRuntimeJobId === undefined) !== (runnerLaunchLeaseId === undefined)) {
    throw new DomainError(
      'codex_session_thread_binding_partial',
      'codex_session_thread_binding_partial: runner binding must be complete.',
    );
  }

  let parsedContinuation: CodexThreadContinuationV1;
  if (continuation.kind === 'start_thread') {
    if ('codex_thread_id' in continuation || 'codex_thread_id_digest' in continuation) {
      throw new DomainError(
        'codex_session_thread_binding_partial',
        'codex_session_thread_binding_partial: start_thread must not carry thread binding fields.',
      );
    }
    if (runnerRuntimeJobId !== undefined || runnerLaunchLeaseId !== undefined) {
      throw unsupportedGenerationWorkload(
        'codex_generation_workload_unsupported: runner binding is forbidden for start_thread.',
      );
    }
    parsedContinuation = { kind: 'start_thread' };
  } else {
    const codexThreadId = continuation.codex_thread_id;
    const codexThreadIdDigest = continuation.codex_thread_id_digest;
    if (!isNonEmptyString(codexThreadId) || !isNonEmptyString(codexThreadIdDigest)) {
      throw new DomainError(
        'codex_session_thread_binding_partial',
        'codex_session_thread_binding_partial: resume_thread requires thread id and digest.',
      );
    }
    if (codexThreadIdDigest !== codexSessionThreadIdDigest(codexThreadId)) {
      throw new DomainError(
        'codex_session_thread_digest_mismatch',
        'codex_session_thread_digest_mismatch: resume_thread thread digest does not match thread id.',
      );
    }
    parsedContinuation = {
      kind: 'resume_thread',
      codex_thread_id: codexThreadId,
      codex_thread_id_digest: codexThreadIdDigest,
    };
  }

  if (!Number.isInteger(value.lease_epoch) || Number(value.lease_epoch) <= 0) {
    throw unsupportedGenerationWorkload('codex_generation_workload_unsupported: lease_epoch must be a positive integer.');
  }
  if (value.turn_group_status !== 'intermediate' && value.turn_group_status !== 'complete') {
    throw unsupportedGenerationWorkload('codex_generation_workload_unsupported: turn_group_status is unsupported.');
  }

  return {
    schema_version: 'codex_session_runtime_context.v1',
    codex_session_id: requireRuntimeContextString(value, 'codex_session_id'),
    codex_session_turn_id: requireRuntimeContextString(value, 'codex_session_turn_id'),
    lease_id: requireRuntimeContextString(value, 'lease_id'),
    lease_epoch: Number(value.lease_epoch),
    worker_id: requireRuntimeContextString(value, 'worker_id'),
    worker_session_digest: requireRuntimeContextString(value, 'worker_session_digest'),
    ...(expectedInputCapsuleDigest === undefined
      ? {}
      : { expected_input_capsule_digest: expectedInputCapsuleDigest }),
    ...(runnerRuntimeJobId === undefined ? {} : { runner_runtime_job_id: runnerRuntimeJobId }),
    ...(runnerLaunchLeaseId === undefined ? {} : { runner_launch_lease_id: runnerLaunchLeaseId }),
    turn_group_status: value.turn_group_status,
    continuation: parsedContinuation,
  };
};

const assertRunExecutionWorkloadKeys = (input: Record<string, unknown>, allowedKeys: ReadonlySet<string>, label: string): void => {
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      throw unsupportedGenerationWorkload(`codex_generation_workload_unsupported: ${label} field ${key} is unsupported.`);
    }
  }
};

const requireRunExecutionWorkloadString = (input: Record<string, unknown>, field: string): string => {
  const value = input[field];
  if (!isNonEmptyString(value)) {
    throw unsupportedGenerationWorkload(`codex_generation_workload_unsupported: ${field} is required.`);
  }
  return value;
};

const requireRunExecutionWorkloadDigest = (input: Record<string, unknown>, field: string): string => {
  const value = requireRunExecutionWorkloadString(input, field);
  if (!isSha256Digest(value)) {
    throw unsupportedGenerationWorkload(`codex_generation_workload_unsupported: ${field} must be a sha256 digest.`);
  }
  return value;
};

const requireRunExecutionWorkloadInteger = (input: Record<string, unknown>, field: string): number => {
  const value = input[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw unsupportedGenerationWorkload(`codex_generation_workload_unsupported: ${field} must be a non-negative integer.`);
  }
  return value;
};

const requireRunExecutionWorkspaceAcquisition = (value: unknown): CodexRunExecutionWorkspaceAcquisitionV1 => {
  if (!isPlainObject(value)) {
    throw unsupportedGenerationWorkload('codex_generation_workload_unsupported: workspace_acquisition_json is required.');
  }
  assertRunExecutionWorkloadKeys(value, codexRunExecutionWorkspaceAcquisitionKeys, 'workspace_acquisition_json');
  return {
    manifest_digest: requireRunExecutionWorkloadDigest(value, 'manifest_digest'),
    size_bytes: requireRunExecutionWorkloadInteger(value, 'size_bytes'),
  };
};

const requireRunExecutionTerminalization = (value: unknown): CodexWorkflowRunExecutionTerminalizationV1 => {
  if (!isPlainObject(value) || value.schema_version !== 'codex_session_terminalization.v1') {
    throw unsupportedGenerationWorkload('codex_generation_workload_unsupported: session terminalization is unsupported.');
  }
  assertRunExecutionWorkloadKeys(value, codexSessionTerminalizationKeys, 'codex_session_terminalization');
  return {
    schema_version: 'codex_session_terminalization.v1',
    lease_token: requireRunExecutionWorkloadString(value, 'lease_token'),
    codex_session_id: requireRunExecutionWorkloadString(value, 'codex_session_id'),
    codex_session_turn_id: requireRunExecutionWorkloadString(value, 'codex_session_turn_id'),
    expected_input_capsule_digest: requireRunExecutionWorkloadDigest(value, 'expected_input_capsule_digest'),
    input_capsule_id: requireRunExecutionWorkloadString(value, 'input_capsule_id'),
    input_capsule_ref: requireRunExecutionWorkloadString(value, 'input_capsule_ref'),
    input_capsule_digest: requireRunExecutionWorkloadDigest(value, 'input_capsule_digest'),
    ...(value.base_memory_bundle_ref === undefined
      ? {}
      : { base_memory_bundle_ref: requireRunExecutionWorkloadString(value, 'base_memory_bundle_ref') }),
    ...(value.base_memory_bundle_digest === undefined
      ? {}
      : { base_memory_bundle_digest: requireRunExecutionWorkloadDigest(value, 'base_memory_bundle_digest') }),
    input_memory_bundle_ref: requireRunExecutionWorkloadString(value, 'input_memory_bundle_ref'),
    input_memory_bundle_digest: requireRunExecutionWorkloadDigest(value, 'input_memory_bundle_digest'),
    input_environment_manifest_ref: requireRunExecutionWorkloadString(value, 'input_environment_manifest_ref'),
    input_environment_manifest_digest: requireRunExecutionWorkloadDigest(value, 'input_environment_manifest_digest'),
  };
};

const assertRunExecutionContinuityMatches = (actual: unknown, expected: unknown, label: string): void => {
  if (actual !== expected) {
    throw unsupportedGenerationWorkload(`codex_generation_workload_unsupported: ${label} does not match.`);
  }
};

export const validateCodexRunExecutionWorkload = (value: unknown): CodexWorkflowRunExecutionWorkloadV1 => {
  if (!isPlainObject(value) || value.schema_version !== 'codex_run_execution_workload.v1') {
    throw unsupportedGenerationWorkload('codex_generation_workload_unsupported: run-execution workload is unsupported.');
  }
  assertRunExecutionWorkloadKeys(value, codexRunExecutionWorkloadKeys, 'run-execution workload');

  if (value.output_schema_version !== 'codex_run_execution_result.v1') {
    throw unsupportedGenerationWorkload('codex_generation_workload_unsupported: output_schema_version is unsupported.');
  }
  const executionPackageVersion = requireRunExecutionWorkloadInteger(value, 'execution_package_version');
  if (executionPackageVersion <= 0) {
    throw unsupportedGenerationWorkload('codex_generation_workload_unsupported: execution_package_version must be positive.');
  }

  const rawRuntimeContext = value.codex_session_runtime_context;
  if (!isPlainObject(rawRuntimeContext)) {
    throw unsupportedGenerationWorkload('codex_generation_workload_unsupported: codex_session_runtime_context is required.');
  }
  if (!isPlainObject(rawRuntimeContext.continuation)) {
    throw unsupportedGenerationWorkload('codex_generation_workload_unsupported: continuation is required.');
  }
  assertRunExecutionWorkloadKeys(
    rawRuntimeContext.continuation,
    codexRunExecutionResumeThreadContinuationKeys,
    'codex_session_runtime_context.continuation',
  );
  const runtimeContext = validateCodexSessionRuntimeContext(rawRuntimeContext);
  if (runtimeContext.turn_group_status !== 'complete') {
    throw unsupportedGenerationWorkload('codex_generation_workload_unsupported: turn_group_status must be complete.');
  }
  if (runtimeContext.continuation.kind !== 'resume_thread') {
    throw unsupportedGenerationWorkload('codex_generation_workload_unsupported: continuation must resume an existing thread.');
  }
  if (!isSha256Digest(runtimeContext.expected_input_capsule_digest)) {
    throw unsupportedGenerationWorkload(
      'codex_generation_workload_unsupported: expected_input_capsule_digest must be a sha256 digest.',
    );
  }

  const workflowRuntimeContext: CodexWorkflowRunExecutionRuntimeContextV1 = {
    ...runtimeContext,
    expected_input_capsule_digest: runtimeContext.expected_input_capsule_digest,
    turn_group_status: runtimeContext.turn_group_status,
    continuation: runtimeContext.continuation,
  };
  const terminalization = requireRunExecutionTerminalization(value.codex_session_terminalization);
  assertRunExecutionContinuityMatches(
    terminalization.codex_session_id,
    workflowRuntimeContext.codex_session_id,
    'codex_session_id',
  );
  assertRunExecutionContinuityMatches(
    terminalization.codex_session_turn_id,
    workflowRuntimeContext.codex_session_turn_id,
    'codex_session_turn_id',
  );
  assertRunExecutionContinuityMatches(
    terminalization.expected_input_capsule_digest,
    workflowRuntimeContext.expected_input_capsule_digest,
    'expected_input_capsule_digest',
  );
  assertRunExecutionContinuityMatches(
    terminalization.input_capsule_digest,
    workflowRuntimeContext.expected_input_capsule_digest,
    'input_capsule_digest',
  );

  return {
    schema_version: 'codex_run_execution_workload.v1',
    runtime_job_id: requireRunExecutionWorkloadString(value, 'runtime_job_id'),
    plan_item_workflow_id: requireRunExecutionWorkloadString(value, 'plan_item_workflow_id'),
    development_plan_id: requireRunExecutionWorkloadString(value, 'development_plan_id'),
    development_plan_item_id: requireRunExecutionWorkloadString(value, 'development_plan_item_id'),
    run_session_id: requireRunExecutionWorkloadString(value, 'run_session_id'),
    execution_package_id: requireRunExecutionWorkloadString(value, 'execution_package_id'),
    execution_package_version: executionPackageVersion,
    workspace_bundle_id: requireRunExecutionWorkloadString(value, 'workspace_bundle_id'),
    workspace_bundle_digest: requireRunExecutionWorkloadDigest(value, 'workspace_bundle_digest'),
    package_prompt_ref: requireRunExecutionWorkloadString(value, 'package_prompt_ref'),
    package_prompt_digest: requireRunExecutionWorkloadDigest(value, 'package_prompt_digest'),
    execution_context_ref: requireRunExecutionWorkloadString(value, 'execution_context_ref'),
    execution_context_digest: requireRunExecutionWorkloadDigest(value, 'execution_context_digest'),
    path_policy_digest: requireRunExecutionWorkloadDigest(value, 'path_policy_digest'),
    ...(value.required_checks_digest === undefined
      ? {}
      : { required_checks_digest: requireRunExecutionWorkloadDigest(value, 'required_checks_digest') }),
    output_schema_version: 'codex_run_execution_result.v1',
    created_at: requireRunExecutionWorkloadString(value, 'created_at'),
    expires_at: requireRunExecutionWorkloadString(value, 'expires_at'),
    workspace_acquisition_json: requireRunExecutionWorkspaceAcquisition(value.workspace_acquisition_json),
    codex_session_runtime_context: workflowRuntimeContext,
    codex_session_terminalization: terminalization,
  };
};

export const validateCodexRunExecutionWorkloadContinuity = (
  workload: unknown,
  expectedContinuation: CodexRunExecutionExpectedContinuation,
): CodexWorkflowRunExecutionWorkloadV1 => {
  const validated = validateCodexRunExecutionWorkload(workload);
  const runtimeContext = validated.codex_session_runtime_context;
  const terminalization = validated.codex_session_terminalization;

  assertRunExecutionContinuityMatches(runtimeContext.codex_session_id, expectedContinuation.codex_session_id, 'codex_session_id');
  assertRunExecutionContinuityMatches(
    runtimeContext.codex_session_turn_id,
    expectedContinuation.codex_session_turn_id,
    'codex_session_turn_id',
  );
  assertRunExecutionContinuityMatches(
    terminalization.input_capsule_digest,
    expectedContinuation.input_capsule_digest,
    'input_capsule_digest',
  );
  assertRunExecutionContinuityMatches(
    terminalization.input_memory_bundle_ref,
    expectedContinuation.input_memory_bundle_ref,
    'input_memory_bundle_ref',
  );
  assertRunExecutionContinuityMatches(
    terminalization.input_memory_bundle_digest,
    expectedContinuation.input_memory_bundle_digest,
    'input_memory_bundle_digest',
  );
  assertRunExecutionContinuityMatches(
    terminalization.input_environment_manifest_ref,
    expectedContinuation.input_environment_manifest_ref,
    'input_environment_manifest_ref',
  );
  assertRunExecutionContinuityMatches(
    terminalization.input_environment_manifest_digest,
    expectedContinuation.input_environment_manifest_digest,
    'input_environment_manifest_digest',
  );
  assertRunExecutionContinuityMatches(runtimeContext.lease_id, expectedContinuation.lease_id, 'lease_id');
  assertRunExecutionContinuityMatches(runtimeContext.lease_epoch, expectedContinuation.lease_epoch, 'lease_epoch');
  assertRunExecutionContinuityMatches(runtimeContext.worker_id, expectedContinuation.worker_id, 'worker_id');
  assertRunExecutionContinuityMatches(
    runtimeContext.worker_session_digest,
    expectedContinuation.worker_session_digest,
    'worker_session_digest',
  );
  assertRunExecutionContinuityMatches(
    runtimeContext.continuation.codex_thread_id_digest,
    expectedContinuation.codex_thread_id_digest,
    'codex_thread_id_digest',
  );

  return validated;
};

const isRawPathEndpointOrContainerId = (value: string): boolean =>
  /^\/|https?:\/\/|^unix:|\.sock$/i.test(value) || /^[a-f0-9]{12,64}$/i.test(value);

const rawEndpointHostCandidate = (value: string): string | undefined => {
  const withoutPath = value.split(/[/?#]/, 1)[0] ?? value;
  const legacySchemeEndpoint = withoutPath.match(/^[A-Za-z][A-Za-z0-9+.-]*:(?!\/\/)(.+)$/);
  if (legacySchemeEndpoint?.[1] !== undefined) {
    return rawEndpointHostCandidate(legacySchemeEndpoint[1]);
  }
  const bracketed = withoutPath.match(/^\[([^\]]+)\](?::\d{1,5})?$/);
  if (bracketed?.[1] !== undefined) {
    return bracketed[1];
  }
  const ipv4Mapped = withoutPath.match(/^((?:::ffff:|(?:0{1,4}:){5}ffff:)\d{1,3}(?:\.\d{1,3}){3})(?::\d{1,5})?$/i);
  if (ipv4Mapped?.[1] !== undefined) {
    return ipv4Mapped[1];
  }
  if (isIP(withoutPath) !== 0) {
    return withoutPath;
  }
  const hostPort = withoutPath.match(/^([^:]+):\d{1,5}$/);
  return hostPort?.[1];
};

const isIpEndpointString = (value: string): boolean => {
  const candidate = rawEndpointHostCandidate(value);
  const legacyCandidate = value.split(/[/?#]/, 1)[0]?.toLowerCase().replace(/%.+$/, '') ?? value;
  if (isPrivateLegacyIpv4Endpoint(legacyCandidate)) {
    return true;
  }
  if (candidate === undefined) {
    return false;
  }
  const withoutZone = candidate.toLowerCase().replace(/%.+$/, '');
  const ipv4Mapped = withoutZone.match(/^(?:::ffff:|(?:0{1,4}:){5}ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (ipv4Mapped?.[1] !== undefined) {
    return isIP(ipv4Mapped[1]) === 4;
  }
  return isIP(withoutZone) !== 0 || isPrivateLegacyIpv4Endpoint(withoutZone);
};

const parseLegacyIpv4Part = (part: string): number | undefined => {
  const radix = /^0x/i.test(part) ? 16 : /^0[0-7]+$/.test(part) ? 8 : 10;
  if (radix === 10 && !/^\d+$/.test(part)) {
    return undefined;
  }
  if (radix === 16 && !/^0x[0-9a-f]+$/i.test(part)) {
    return undefined;
  }
  if (radix === 8 && !/^0[0-7]+$/.test(part)) {
    return undefined;
  }
  const parsed = Number.parseInt(part, radix);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const parseLegacyIpv4Number = (value: string): number | undefined => {
  if (!/^(?:0x[0-9a-f]+|0[0-7]+|\d+)(?:\.(?:0x[0-9a-f]+|0[0-7]+|\d+)){0,3}$/i.test(value)) {
    return undefined;
  }
  const parts = value.split('.').map(parseLegacyIpv4Part);
  if (parts.some((part) => part === undefined)) {
    return undefined;
  }
  const [first = 0, second = 0, third = 0, fourth = 0] = parts as [number?, number?, number?, number?];
  if (parts.length === 1) {
    return first <= 0xffffffff ? first : undefined;
  }
  if (parts.length === 2) {
    return first <= 0xff && second <= 0xffffff ? first * 0x1000000 + second : undefined;
  }
  if (parts.length === 3) {
    return first <= 0xff && second <= 0xff && third <= 0xffff ? first * 0x1000000 + second * 0x10000 + third : undefined;
  }
  return first <= 0xff && second <= 0xff && third <= 0xff && fourth <= 0xff
    ? first * 0x1000000 + second * 0x10000 + third * 0x100 + fourth
    : undefined;
};

const isPrivateLegacyIpv4Endpoint = (value: string): boolean => {
  const parsed = parseLegacyIpv4Number(value);
  if (parsed === undefined) {
    return false;
  }
  const first = Math.floor(parsed / 0x1000000) & 0xff;
  const second = Math.floor(parsed / 0x10000) & 0xff;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
};

const safeProductRefPathPattern = /^[A-Za-z0-9._~!$&'()*+,;=-]+(?:\/[A-Za-z0-9._~!$&'()*+,;=-]+)*$/;
const isSafeProductRefPath = (path: string): boolean =>
  path.length > 0 &&
  safeProductRefPathPattern.test(path) &&
  !path.includes('..') &&
  !path.includes('\\') &&
  !/[A-Za-z][A-Za-z0-9+.-]*:/.test(path);

const isCodexRuntimeArtifactRefString = (value: string): boolean => {
  const prefix = 'artifact://';
  if (!value.startsWith(prefix)) {
    return false;
  }
  const body = value.slice(prefix.length);
  return (
    (body.startsWith('codex-runtime-jobs/') || body.startsWith('automation/') || body.startsWith('runs/')) &&
    isSafeProductRefPath(body)
  );
};

export const isLegacyCodexRuntimeJobArtifactRefString = (ref: string): boolean =>
  /^artifact:\/\/codex-runtime-jobs\/[a-z0-9_-]+\/artifacts\/[a-z0-9_-]+$/.test(ref);

const isCodexRuntimeForgeloopRefString = (value: string): boolean => {
  const prefix = 'forgeloop://';
  if (!value.startsWith(prefix)) {
    return false;
  }
  const body = value.slice(prefix.length);
  return /^(?:automation|runs|specs|plans|execution-packages|review-packets|releases)\//.test(body) && isSafeProductRefPath(body);
};

const isCodexRuntimeMimeTypeString = (value: string): boolean =>
  /^(application|audio|font|image|message|model|multipart|text|video)\/[A-Za-z0-9.+-]+$/i.test(value);

const isCodexRuntimeIsoDateTimeString = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value);

const isCodexRuntimeProductSafeString = (value: string): boolean =>
  isCodexRuntimeArtifactRefString(value) ||
  isCodexRuntimeForgeloopRefString(value) ||
  isCodexRuntimeMimeTypeString(value) ||
  isCodexRuntimeIsoDateTimeString(value) ||
  isSha256Digest(value);

const normalizeCodexRuntimeEndpointCandidate = (value: string): string => {
  const [withoutQuery = value] = value.split(/[?#]/, 1);
  const slashIndex = withoutQuery.indexOf('/');
  const stripHostRootDot = (host: string): string => host.replace(/\.(?=:\d{1,5}$)/, '').replace(/\.$/, '');
  if (slashIndex < 0) {
    return stripHostRootDot(withoutQuery);
  }
  return `${stripHostRootDot(withoutQuery.slice(0, slashIndex))}${withoutQuery.slice(slashIndex)}`;
};

const isCodexRuntimeEndpointOrContainerString = (value: string): boolean => {
  if (isCodexRuntimeProductSafeString(value)) {
    return false;
  }
  const normalizedValue = normalizeCodexRuntimeEndpointCandidate(value);
  if (normalizedValue !== value && isCodexRuntimeEndpointOrContainerString(normalizedValue)) {
    return true;
  }
  const loopbackEndpointPattern =
    /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?(?:::0*1|(?:0{1,4}:){7}0{0,3}1)(?:%[A-Za-z0-9_.-]+)?\]?)(:\d{1,5})?(\/|$)/i;
  const privateIpv4EndpointPattern =
    /^(10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2})(:\d{1,5})?(\/|$)/i;
  const ipv4MappedPrivateEndpointPattern =
    /^\[?::ffff:(127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|0\.0\.0\.0)\]?(:\d{1,5})?(\/|$)/i;
  const privateIpv6EndpointPattern =
    /^\[?(?:(?:fc|fd)[0-9a-f]{0,2}|fe80):[0-9a-f:]+(?:%[A-Za-z0-9_.-]+)?\]?(:\d{1,5})?(\/|$)/i;
  const internalHostEndpointPattern = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.internal(:\d{1,5})?(\/|$)/i;
  const clusterLocalEndpointPattern = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.svc\.cluster\.local(:\d{1,5})?(\/|$)/i;
  const clusterShortServiceEndpointPattern = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.svc(:\d{1,5})?(\/|$)/i;
  const rawRuntimeServiceEndpointPattern = /^(app-server|control-plane)(:\d{1,5})?(\/|$)/i;
  const rawRuntimeContainerNamePattern =
    /^(?:app_server|control_plane|(?:forgeloop[-_])?(?:app|control)[-_](?:server|plane)[-_]\d+)(:\d{1,5})?(\/|$)/i;
  const legacySchemeEndpointPattern = /^[A-Za-z][A-Za-z0-9+.-]*:(?!\/\/)(.+)$/;
  const rawUrlSchemePattern = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
  const hostWithPortOrPathPattern = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(:\d{1,5}|\/)/i;
  const legacySchemeEndpoint = value.match(legacySchemeEndpointPattern);
  if (legacySchemeEndpoint?.[1] !== undefined && isCodexRuntimeEndpointOrContainerString(legacySchemeEndpoint[1])) {
    return true;
  }
  return (
    rawUrlSchemePattern.test(value) ||
    /^file:\//i.test(value) ||
    /^https?:\/\//i.test(value) ||
    /^(app-server|control-plane):\/\//i.test(value) ||
    /^unix:/i.test(value) ||
    /\.sock(?:$|[/?#])/i.test(value) ||
    isIpEndpointString(value) ||
    loopbackEndpointPattern.test(value) ||
    privateIpv4EndpointPattern.test(value) ||
    ipv4MappedPrivateEndpointPattern.test(value) ||
    privateIpv6EndpointPattern.test(value) ||
    internalHostEndpointPattern.test(value) ||
    clusterLocalEndpointPattern.test(value) ||
    clusterShortServiceEndpointPattern.test(value) ||
    singleLabelHostPortPattern.test(value) ||
    rawRuntimeServiceEndpointPattern.test(value) ||
    rawRuntimeContainerNamePattern.test(value) ||
    hostWithPortOrPathPattern.test(value) ||
    /^[a-f0-9]{12,64}$/i.test(value)
  );
};

const safePublicFilenameExtensions = new Set([
  'cjs',
  'csv',
  'css',
  'diff',
  'env',
  'gif',
  'gql',
  'graphql',
  'htm',
  'html',
  'ico',
  'js',
  'json',
  'jsx',
  'jpeg',
  'jpg',
  'lock',
  'log',
  'map',
  'md',
  'mdx',
  'mjs',
  'mts',
  'patch',
  'pdf',
  'png',
  'proto',
  'py',
  'scss',
  'sh',
  'sql',
  'svg',
  'toml',
  'tsv',
  'ts',
  'tsx',
  'txt',
  'webp',
  'xml',
  'yaml',
  'yml',
  'zip',
]);
const isCodexRuntimePublicFilenameToken = (value: string): boolean => {
  if (value.includes('/') || value.includes('\\') || value.includes(':') || value.includes('\0')) {
    return false;
  }
  if (/^(?:Dockerfile|Makefile)(?:\.[A-Za-z0-9._-]+)?$/i.test(value)) {
    return true;
  }
  const extension = value.toLowerCase().split('.').at(-1);
  return extension !== undefined && extension !== value.toLowerCase() && safePublicFilenameExtensions.has(extension);
};
const isBareDnsHostString = (value: string): boolean => {
  const candidate = value.split(/[?#]/, 1)[0]?.replace(/\.$/, '') ?? value;
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(candidate)) {
    return false;
  }
  return !isCodexRuntimePublicFilenameToken(candidate);
};
const displayUnsafeEndpointTokenPattern =
  /\b(?:https?:\/\/|(?:https?|wss?|tcp|ssh|redis|postgres(?:ql)?|mysql|file):\S+|localhost(?::\d{1,5})?|(?:[a-z0-9-]+\.)+(?:internal|svc|svc\.cluster\.local)|\d{1,3}(?:\.\d{1,3}){1,3}(?::\d{1,5})?|(?:forgeloop[-_])?(?:app|control)[-_](?:server|plane)[-_]\d+|(?:(?:app|control)[-_](?:server|plane)|[a-z][a-z0-9-]*_[a-z0-9_-]*|redis|postgres|mysql):\d{1,5}|unix:|[A-Za-z]:[\\/]|\\\\|\.sock\b)/i;
const displayBareDnsHostTokenPattern = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi;
const displayBracketedIpv6TokenPattern = /\[[0-9a-f:.]+(?:%[A-Za-z0-9_.-]+)?\](?::\d{1,5})?(?:\/\S*)?/gi;
const displayIpv6TokenPattern = /\b(?:[0-9a-f]{0,4}:){2,}[0-9a-f:.]+(?:%[A-Za-z0-9_.-]+)?(?:\/\S*)?/gi;
const displayLeadingCompressedIpv6TokenPattern = /(?<![A-Za-z0-9])::[0-9a-f:.]*(?:%[A-Za-z0-9_.-]+)?(?:\/\S*)?/gi;
const displayLegacyIpv4TokenPattern = /\b(?:0x[0-9a-f]{7,8}|0[0-7]{8,11}|\d{8,10}|(?:\d{1,3}\.){1,3}\d{1,3})\b/gi;
const displayHexRuntimeIdTokenPattern = /\b[a-f0-9]{12,64}\b/gi;
const displayUnsafePathTokenPattern = /(?:^|[\s([{"'=`])(?:\/|~[\\/]|\.{1,2}[\\/]|\\\\|[A-Za-z]:[\\/])\S*/;
const publicUnsafeSecretTokenPattern =
  /\b(?:(?:api[_-]?key|token|secret|password|authorization|auth(?:[_-]?header)?)\s*(?:[:=]|Bearer\b)|Bearer\s+[A-Za-z0-9._~+/=-]+|sk-[A-Za-z0-9_-]+)/i;
const dockerRuntimeEvidencePublicIdKeys = new Set([
  'runtime_profile_id',
  'runtime_profile_revision_id',
  'credential_binding_id',
  'credential_binding_version_id',
  'launch_lease_id',
]);
const dockerRuntimeEvidencePublicIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const isDockerRuntimeEvidencePublicId = (key: string, value: string): boolean =>
  dockerRuntimeEvidencePublicIdKeys.has(key) && dockerRuntimeEvidencePublicIdPattern.test(value);
const isDockerRuntimeEvidenceWorkerScopeDigestToken = (
  value: string,
  match: RegExpMatchArray,
  runtimeTargetKind: unknown,
): boolean => {
  if (!/^[a-f0-9]{12}$/i.test(match[0])) {
    return false;
  }
  const expectedSuffix =
    runtimeTargetKind === 'generation' ? '-generation' : runtimeTargetKind === 'run_execution' ? '-run-execution' : undefined;
  if (expectedSuffix === undefined) {
    return false;
  }
  const start = match.index;
  if (start === undefined || value[start - 1] !== '-') {
    return false;
  }
  const end = start + match[0].length;
  const prefix = value.slice(0, start - 1);
  return value.slice(end) === expectedSuffix && /^[A-Za-z][A-Za-z0-9-]{0,95}$/.test(prefix);
};
const isDockerRuntimeEvidencePublicWorkerId = (value: string, runtimeTargetKind: unknown): boolean => {
  if (!/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(value) || !value.includes('-')) {
    return false;
  }
  if (
    displayUnsafeEndpointTokenPattern.test(value) ||
    publicUnsafeSecretTokenPattern.test(value) ||
    isRawPathEndpointOrContainerId(value) ||
    isCodexRuntimeEndpointOrContainerString(value) ||
    isCodexRuntimeLocalPathString(value)
  ) {
    return false;
  }
  return [...value.matchAll(displayHexRuntimeIdTokenPattern)].every((match) =>
    isDockerRuntimeEvidenceWorkerScopeDigestToken(value, match, runtimeTargetKind),
  );
};
const codexRuntimePublicRoutePathTokenPattern =
  /(^|[\s([{"'=`])\/(?:api|v\d+(?:\.\d+)?|graphql|health|status|auth|oauth)(?:\/\S*)?/gi;
const stripCodexRuntimePublicRoutePathTokens = (value: string): string =>
  value.replace(codexRuntimePublicRoutePathTokenPattern, (_match, prefix: string) => prefix);
const isCodexRuntimeUnsafeDisplayTokenString = (value: string): boolean =>
  [...value.matchAll(displayBracketedIpv6TokenPattern)].some(([candidate]) => isCodexRuntimeEndpointOrContainerString(candidate)) ||
  [...value.matchAll(displayIpv6TokenPattern)].some(([candidate]) => isCodexRuntimeEndpointOrContainerString(candidate)) ||
  [...value.matchAll(displayLeadingCompressedIpv6TokenPattern)].some(([candidate]) => isCodexRuntimeEndpointOrContainerString(candidate)) ||
  [...value.matchAll(displayLegacyIpv4TokenPattern)].some(([candidate]) => isPrivateLegacyIpv4Endpoint(candidate)) ||
  [...value.matchAll(displayHexRuntimeIdTokenPattern)].some((match) => value.slice(Math.max(0, match.index - 7), match.index).toLowerCase() !== 'sha256:');
const isCodexRuntimeUnsafeDisplayString = (value: string): boolean =>
  displayUnsafeEndpointTokenPattern.test(value) ||
  [...value.matchAll(displayBareDnsHostTokenPattern)].some(([candidate]) => isBareDnsHostString(candidate)) ||
  isCodexRuntimeUnsafeDisplayTokenString(value) ||
  displayUnsafePathTokenPattern.test(value) ||
  publicUnsafeSecretTokenPattern.test(value);

const decodeCodexRuntimePercentEncodedString = (value: string): string | undefined => {
  if (!/%[0-9a-f]{2}/i.test(value)) {
    return undefined;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value.replace(/%([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  }
};

const isCodexRuntimeLocalPathString = (value: string): boolean => {
  if (isCodexRuntimeProductSafeString(value)) {
    return false;
  }
  const relativeLocalPathPattern = /[\\/]/;
  const singleSegmentLocalPathPattern =
    /^(?:\.[A-Za-z0-9._-]+|(?:Dockerfile|Makefile)(?:\.[A-Za-z0-9._-]+)?|README|LICENSE|CHANGELOG|[A-Za-z0-9._-]+\.(?:cjs|css|diff|env|js|json|jsx|lock|log|md|mjs|patch|py|sh|sql|toml|ts|tsx|txt|yaml|yml)|app|apps|backend|build|client|config|configs|dist|docs|frontend|lib|node_modules|packages|repo|repository|scripts|server|src|test|tests|tmp|workspace|workspaces)$/i;
  return (
    /^(\/|\\{2}|~[\\/]|\.{1,2}[\\/]|[A-Za-z]:)/i.test(value) ||
    relativeLocalPathPattern.test(value) ||
    singleSegmentLocalPathPattern.test(value)
  );
};

const isSafeCodexRuntimeRepoRelativePath = (value: string): boolean => {
  if (
    value.length === 0 ||
    value.includes('\\') ||
    value.includes('\0') ||
    /^(\/|~[\\/]|\.{1,2}[\\/]|[A-Za-z]:)/i.test(value) ||
    isCodexRuntimeEndpointOrContainerString(value) ||
    isBareDnsHostString(value)
  ) {
    return false;
  }
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
};

const isRawRuntimePublicString = (
  value: string,
  options: { allowDisplayText?: boolean; allowInternalArtifactRef?: boolean; allowRepoRelativePath?: boolean } = {},
): boolean => {
  if (options.allowInternalArtifactRef === true && isInternalArtifactRefString(value)) {
    return false;
  }
  if (isCodexRuntimeArtifactRefString(value)) {
    return false;
  }
  if (isCodexRuntimeForgeloopRefString(value)) {
    return false;
  }
  if (isCodexRuntimeProductSafeString(value)) {
    return false;
  }
  if (publicUnsafeSecretTokenPattern.test(value)) {
    return true;
  }
  const decodedValue = decodeCodexRuntimePercentEncodedString(value);
  if (decodedValue !== undefined && decodedValue !== value && isRawRuntimePublicString(decodedValue, options)) {
    return true;
  }
  if (isCodexRuntimeEndpointOrContainerString(value)) {
    return true;
  }
  if (isBareDnsHostString(value)) {
    return true;
  }
  if (options.allowRepoRelativePath) {
    return !isSafeCodexRuntimeRepoRelativePath(value);
  }
  if (options.allowDisplayText === true) {
    return isCodexRuntimeUnsafeDisplayString(value);
  }
  if (/[\s()[\]{}'"=;:,|@<>]/.test(value) && isCodexRuntimeUnsafeDisplayString(value)) {
    return true;
  }
  return isCodexRuntimeLocalPathString(value);
};

const assertSha256Digest = (value: unknown, label: string, error: (message: string) => DomainError = invalidProfile): void => {
  if (!isSha256Digest(value)) {
    throw error(`${label} must be a pinned sha256 digest.`);
  }
};

const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const assertNonEmptyString = (value: unknown, label: string): void => {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidProfile(`${label} must be a non-empty string.`);
  }
};

const assertPositiveInteger = (value: unknown, label: string): void => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw invalidProfile(`${label} must be a positive integer.`);
  }
};

const assertIsoDateTime = (value: unknown, label: string): void => {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (typeof value !== 'string' || !isoDateTimePattern.test(value) || Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) {
    throw invalidProfile(`${label} must be an ISO datetime string.`);
  }
};

function assertCodexRuntimeResourceLimits(resourceLimits: unknown): asserts resourceLimits is CodexRuntimeResourceLimits {
  if (!isPlainObject(resourceLimits)) {
    throw invalidProfile('Codex runtime resource_limits must be an object.');
  }
  for (const key of runtimeResourceLimitKeys) {
    const value = resourceLimits[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      throw invalidProfile(`Codex runtime resource limit ${key} must be a positive integer.`);
    }
  }
}

const safeCodexRuntimeAllowlistHostPattern =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i;

function assertCodexRuntimeNetworkAllowlistRule(rule: unknown): asserts rule is CodexNetworkAllowlistRule {
  const port = isPlainObject(rule) ? rule.port : undefined;
  if (
    !isPlainObject(rule) ||
    typeof rule.id !== 'string' ||
    rule.id.length === 0 ||
    !validNetworkAllowlistProtocols.has(rule.protocol as CodexNetworkAllowlistRule['protocol']) ||
    typeof rule.host !== 'string' ||
    rule.host.length === 0 ||
    !validNetworkAllowlistPurposes.has(rule.purpose as CodexNetworkAllowlistRule['purpose']) ||
    (rule.path_prefix !== undefined && typeof rule.path_prefix !== 'string') ||
    (port !== undefined && (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535))
  ) {
    throw dockerPolicyUnavailable('Codex runtime network policy allowlist_rules entries are invalid.');
  }
}

const assertStrictCodexRuntimeNetworkAllowlistRule = (rule: CodexNetworkAllowlistRule): void => {
  if (!validNetworkAllowlistProtocols.has(rule.protocol)) {
    throw dockerPolicyUnavailable('Strict real dogfood egress allowlist rules must use a supported protocol.');
  }
  if (
    !safeCodexRuntimeAllowlistHostPattern.test(rule.host) ||
    isCodexRuntimeEndpointOrContainerString(rule.host) ||
    rule.host.includes('*')
  ) {
    throw dockerPolicyUnavailable('Strict real dogfood egress allowlist rules must use public DNS hosts only.');
  }
  if (rule.port !== undefined && (!Number.isInteger(rule.port) || rule.port < 1 || rule.port > 65535)) {
    throw dockerPolicyUnavailable('Strict real dogfood egress allowlist rule ports must be valid TCP ports.');
  }
};

const assertStrictCodexRuntimeNetworkPolicy = (
  policy: CodexRuntimeNetworkPolicy,
): Extract<CodexRuntimeNetworkPolicy, { mode: 'egress_allowlist' }> => {
  if (policy.mode !== 'egress_allowlist') {
    throw dockerPolicyUnavailable('Strict real dogfood profiles require a model_provider egress allowlist network policy.');
  }
  if (!validRuntimeNetworkProviders.has(policy.provider)) {
    throw dockerPolicyUnavailable('Strict real dogfood egress allowlist profiles require a supported network provider.');
  }
  return policy;
};

const codexProviderBaseUrlHosts = (toml: string): string[] =>
  [...toml.matchAll(/^\s*base_url\s*=\s*["']([^"']+)["']/gm)].flatMap((match) => {
    try {
      const host = new URL(match[1]!).hostname.toLowerCase();
      return host.length === 0 ? [] : [host];
    } catch {
      return [];
    }
  });

const assertCodexProviderHostsCoveredByAllowlist = (
  toml: string,
  networkPolicy: Extract<CodexRuntimeNetworkPolicy, { mode: 'egress_allowlist' }>,
): void => {
  const allowedHosts = new Set(
    networkPolicy.allowlist_rules.filter((rule) => rule.purpose === 'model_provider').map((rule) => rule.host.toLowerCase()),
  );
  const missingHost = codexProviderBaseUrlHosts(toml).find((host) => !allowedHosts.has(host));
  if (missingHost !== undefined) {
    throw dockerPolicyUnavailable('Strict real dogfood provider base_url hosts must be covered by model_provider allowlist rules.');
  }
};

function assertCodexRuntimeNetworkPolicy(policy: unknown): asserts policy is CodexRuntimeNetworkPolicy {
  if (!isPlainObject(policy)) {
    throw dockerPolicyUnavailable('Codex runtime network policy must be an object.');
  }
  if (policy.mode === 'disabled') {
    return;
  }
  if (policy.mode !== 'egress_allowlist') {
    throw dockerPolicyUnavailable('Codex runtime network policy mode is invalid.');
  }
  if (!validRuntimeNetworkProviders.has(policy.provider as CodexRuntimeNetworkProvider)) {
    throw dockerPolicyUnavailable('Codex runtime network policy provider is invalid.');
  }
  if (!Array.isArray(policy.allowlist_rules)) {
    throw dockerPolicyUnavailable('Codex runtime network policy allowlist_rules must be an array.');
  }
  policy.allowlist_rules.forEach(assertCodexRuntimeNetworkAllowlistRule);
  assertSha256Digest(policy.egress_allowlist_digest, 'Codex runtime network policy egress allowlist digest', dockerPolicyUnavailable);
  assertSha256Digest(policy.self_test_digest, 'Codex runtime network policy self-test digest', dockerPolicyUnavailable);
  if (policy.provider === 'docker_network_proxy' && !isPlainObject(policy.provider_config)) {
    throw dockerPolicyUnavailable('Docker network proxy provider_config is required.');
  }
}

function assertCodexRuntimeScopes(scopes: unknown): asserts scopes is readonly CodexRuntimeScope[] {
  if (!Array.isArray(scopes)) {
    throw invalidProfile('Codex runtime allowed_scopes must be an array.');
  }
  for (const scope of scopes) {
    if (
      !isPlainObject(scope) ||
      typeof scope.project_id !== 'string' ||
      scope.project_id.length === 0 ||
      (scope.repo_id !== undefined && typeof scope.repo_id !== 'string')
    ) {
      throw invalidProfile('Codex runtime allowed_scopes entries must identify project and optional repo scope.');
    }
  }
}

function assertCodexDockerPolicy(policy: unknown): asserts policy is CodexDockerPolicy {
  if (!isPlainObject(policy)) {
    throw dockerPolicyUnavailable('Codex runtime docker_policy must be an object.');
  }
  if (policy.network_disabled !== undefined && typeof policy.network_disabled !== 'boolean') {
    throw dockerPolicyUnavailable('Codex runtime docker_policy network_disabled must be a boolean.');
  }
  for (const key of ['app_server_only', 'rootless', 'read_only_rootfs', 'no_new_privileges'] as const) {
    if (typeof policy[key] !== 'boolean') {
      throw dockerPolicyUnavailable(`Codex runtime docker_policy ${key} must be a boolean.`);
    }
  }
  if (!Array.isArray(policy.drop_capabilities) || policy.drop_capabilities.some((capability) => typeof capability !== 'string')) {
    throw dockerPolicyUnavailable('Codex runtime docker_policy drop_capabilities must be an array of strings.');
  }
}

function assertCodexEffectiveConfigAssertions(
  assertions: unknown,
  targetKind: CodexRuntimeTargetKind,
): asserts assertions is CodexEffectiveConfigAssertions {
  if (!isPlainObject(assertions)) {
    throw invalidProfile('Codex runtime effective_config_assertions must be an object.');
  }
  if (assertions.approval_policy !== 'never') {
    throw invalidProfile('Codex runtime effective_config_assertions approval_policy must be never.');
  }
  if (targetKind === 'generation') {
    if (
      assertions.target_kind !== 'generation' ||
      assertions.source_write_policy !== 'artifact_only' ||
      !Array.isArray(assertions.forbidden_writable_roots) ||
      assertions.forbidden_writable_roots.some((root) => typeof root !== 'string')
    ) {
      throw invalidProfile('Codex runtime generation effective_config_assertions are invalid.');
    }
    return;
  }
  if (
    assertions.target_kind !== 'run_execution' ||
    !['danger-full-access', 'dangerFullAccess'].includes(String(assertions.sandbox_type)) ||
    assertions.writable_roots_policy !== 'task_workspace_only'
  ) {
    throw invalidProfile('Codex runtime run-execution effective_config_assertions are invalid.');
  }
}

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

export const codexCanonicalJsonBytes = (value: unknown): Uint8Array =>
  new TextEncoder().encode(stableJson(value));

export const codexCredentialPayloadDigest = (payload: unknown): string => codexCanonicalDigest(payload);

export const codexRuntimeNetworkPolicyDigest = (policy: CodexRuntimeNetworkPolicy): string =>
  codexCanonicalDigest(normalizeCodexRuntimeNetworkPolicy(policy));

export const codexRuntimeScopeMatches = (allowed: readonly CodexRuntimeScope[], target: CodexRuntimeScope): boolean =>
  allowed.some(
    (scope) =>
      scope.project_id === target.project_id &&
      (scope.repo_id === undefined || (target.repo_id !== undefined && scope.repo_id === target.repo_id)),
  );

export const codexWorkerScopeMatchesTarget = (
  allowed: readonly CodexRuntimeScope[],
  targetKind: CodexRuntimeTargetKind,
  target: CodexRuntimeScope,
): boolean => {
  if (targetKind !== 'run_execution') {
    return codexRuntimeScopeMatches(allowed, target);
  }
  return (
    target.repo_id !== undefined &&
    allowed.some((scope) => scope.project_id === target.project_id && scope.repo_id === target.repo_id)
  );
};

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

const codexRuntimeDisplayStringKeys = new Set(['name', 'public_summary', 'summary']);
const isCodexRuntimeDisplayStringPath = (path: readonly string[]): boolean => {
  const key = path[path.length - 1];
  return key !== undefined && codexRuntimeDisplayStringKeys.has(key);
};

const isUnsafeCodexRuntimePublicKey = (key: string): boolean => {
  const normalizedKey = normalizeRuntimePublicKey(key);
  const compactKey = compactRuntimePublicKey(key);
  return (
    unsafeRuntimePublicKeyPattern.test(normalizedKey) ||
    rawRuntimePublicFieldPattern.test(normalizedKey) ||
    rawRuntimePublicFieldPattern.test(compactKey) ||
    compactKey.startsWith('raw') ||
    unsafeRuntimePublicCompactKeys.has(compactKey) ||
    /(?:apikey|token|secret|auth(?:orization)?(?:header)?|password|endpoint|socket(?:path|ref)?|container(?:id|name|ref)?|workspacepath|sourcerepopath)$/.test(
      compactKey,
    ) ||
    isRawRuntimePublicString(key, { allowDisplayText: true })
  );
};

const isCodexRuntimeChangedFilePath = (path: readonly string[]): boolean => {
  if (path.length !== 2 || !/^\d+$/.test(path[path.length - 1] ?? '')) {
    return false;
  }
  return path[path.length - 2] === 'changed_files';
};

const isCodexRuntimeInternalArtifactRefPath = (path: readonly string[]): boolean => {
  const key = path[path.length - 1];
  return (
    key === 'artifact_ref' ||
    key === 'internal_ref' ||
    key === 'output_internal_ref' ||
    key === 'archive_ref' ||
    key === 'output_memory_bundle_ref' ||
    key === 'memory_delta_artifact_ref' ||
    key === 'output_environment_manifest_ref'
  );
};

const assertCodexRuntimePublicSafeRecord = (
  value: unknown,
  label: string,
  path: readonly string[],
  options: {
    allowRunExecutionChangedFiles?: boolean;
    allowInternalArtifactRefFields?: boolean;
    rejectLegacyCodexRuntimeJobArtifactRefs?: boolean;
  } = {},
): void => {
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
    if (
      typeof value === 'string' &&
      options.rejectLegacyCodexRuntimeJobArtifactRefs === true &&
      value.startsWith('artifact://codex-runtime-jobs/')
    ) {
      throw unsafeCodexRuntimePublicValue('Codex runtime terminal result cannot include legacy runtime artifact refs.', {
        field: path.join('.'),
      });
    }
    if (
      typeof value === 'string' &&
      value.includes('artifact://internal/') &&
      (options.allowInternalArtifactRefFields !== true || !isCodexRuntimeInternalArtifactRefPath(path))
    ) {
      throw unsafeCodexRuntimePublicValue('Codex runtime public-safe values cannot include internal artifact refs outside artifact fields.', {
        field: path.join('.'),
      });
    }
    if (
      typeof value === 'string' &&
      isRawRuntimePublicString(value, {
        allowInternalArtifactRef: options.allowInternalArtifactRefFields === true && isCodexRuntimeInternalArtifactRefPath(path),
        allowDisplayText: isCodexRuntimeDisplayStringPath(path),
        allowRepoRelativePath: options.allowRunExecutionChangedFiles === true && isCodexRuntimeChangedFilePath(path),
      })
    ) {
      throw unsafeCodexRuntimePublicValue(
        'Codex runtime public-safe values cannot include raw paths, endpoints, container IDs, socket paths, or secrets.',
        { field: path.join('.') },
      );
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => assertCodexRuntimePublicSafeRecord(entry, label, [...path, String(index)], options));
    }
    if (isPlainObject(value)) {
      for (const [key, entry] of Object.entries(value)) {
        const entryPath = [...path, key];
        if (isUnsafeCodexRuntimePublicKey(key)) {
          throw unsafeCodexRuntimePublicValue(
            'Codex runtime public-safe values cannot include raw paths, endpoints, container IDs, socket paths, or secrets.',
            { field: entryPath.join('.') },
          );
        }
        assertCodexRuntimePublicSafeRecord(entry, label, entryPath, options);
      }
    }
    return;
  }

  throw unsafeCodexRuntimePublicValue(`Codex runtime ${label} must be JSON-compatible.`, { field: path.join('.') });
};

export const assertCodexRuntimePublicSafeValue = (input: unknown, label: string): void => {
  assertCodexRuntimePublicSafeRecord(input, label, []);
};

const codexWorkloadSchemasWithTrustedTerminalization = new Set([
  'codex_generation_workload.v1',
  'codex_run_execution_workload.v1',
]);

const isCodexWorkloadWithTrustedTerminalization = (input: unknown): input is Record<string, unknown> =>
  isPlainObject(input) &&
  typeof input.schema_version === 'string' &&
  codexWorkloadSchemasWithTrustedTerminalization.has(input.schema_version) &&
  input.codex_session_terminalization !== undefined;

export const codexRuntimeJobInputDigest = (input: unknown): string => {
  const trustedInput = isCodexWorkloadWithTrustedTerminalization(input)
    ? Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'codex_session_terminalization'))
    : input;
  assertCodexRuntimePublicSafeValue(trustedInput, 'job input');
  return codexCanonicalDigest(input);
};

export const codexWorkspaceAcquisitionDigest = (input: unknown | undefined): string | undefined => {
  if (input === undefined) {
    return undefined;
  }
  assertCodexRuntimePublicSafeRecord(input, 'workspace acquisition', [], { allowInternalArtifactRefFields: true });
  return codexCanonicalDigest(input);
};

const requireCodexLaunchTokenEnvelopeDigestString = (
  input: Record<string, unknown>,
  field: keyof CodexLaunchTokenEnvelopeDigestInput,
): string => {
  const value = input[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidProfile(`Codex launch token envelope digest field ${field} is required.`);
  }
  return value;
};

const requireCodexLaunchTokenEnvelopeDigestAad = (input: Record<string, unknown>): Record<string, string> => {
  const value = input.aad_json;
  if (!isPlainObject(value) || Object.values(value).some((entry) => typeof entry !== 'string')) {
    throw invalidProfile('Codex launch token envelope digest field aad_json is required.');
  }
  return value as Record<string, string>;
};

const requireCodexLaunchTokenEnvelopeDigestSha256 = (
  input: Record<string, unknown>,
  field: keyof CodexLaunchTokenEnvelopeDigestInput,
): string => {
  const value = requireCodexLaunchTokenEnvelopeDigestString(input, field);
  if (!isSha256Digest(value)) {
    throw invalidProfile(`Codex launch token envelope digest field ${field} must be a sha256 digest.`);
  }
  return value;
};

const requireCodexRuntimeResultString = (input: Record<string, unknown>, field: string): string => {
  const value = input[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw unsafeCodexRuntimePublicValue(`Codex runtime terminal result field ${field} is required.`);
  }
  return value;
};

const requireCodexRuntimeResultDigest = (input: Record<string, unknown>, field: string): string => {
  const value = requireCodexRuntimeResultString(input, field);
  if (!isSha256Digest(value)) {
    throw unsafeCodexRuntimePublicValue(`Codex runtime terminal result field ${field} must be a sha256 digest.`);
  }
  return value;
};

const requireCodexRuntimeResultInteger = (input: Record<string, unknown>, field: string): number => {
  const value = input[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw unsafeCodexRuntimePublicValue(`Codex runtime terminal result field ${field} must be a non-negative integer.`);
  }
  return value;
};

const requireCodexRuntimeResultBoolean = (input: Record<string, unknown>, field: string): boolean => {
  const value = input[field];
  if (typeof value !== 'boolean') {
    throw unsafeCodexRuntimePublicValue(`Codex runtime terminal result field ${field} must be a boolean.`);
  }
  return value;
};

const requireCodexRuntimeResultRecord = (input: Record<string, unknown>, field: string): Record<string, unknown> => {
  const value = input[field];
  if (!isPlainObject(value)) {
    throw unsafeCodexRuntimePublicValue(`Codex runtime terminal result field ${field} must be an object.`);
  }
  return value;
};

const requireCodexRuntimeResultArray = (input: Record<string, unknown>, field: string): unknown[] => {
  const value = input[field];
  if (!Array.isArray(value)) {
    throw unsafeCodexRuntimePublicValue(`Codex runtime terminal result field ${field} must be an array.`);
  }
  return value;
};

const requireCodexRuntimeResultStringArray = (input: Record<string, unknown>, field: string): string[] => {
  const value = requireCodexRuntimeResultArray(input, field);
  if (value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw unsafeCodexRuntimePublicValue(`Codex runtime terminal result field ${field} must be an array of non-empty strings.`);
  }
  return value as string[];
};

const assertCodexRuntimeResultKeys = (input: Record<string, unknown>, allowedKeys: ReadonlySet<string>, label: string): void => {
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      throw unsafeCodexRuntimePublicValue(`Codex runtime terminal result ${label} contains unsupported field ${key}.`);
    }
  }
};

const codexRuntimeArtifactResultKeys = new Set(['kind', 'name', 'content_type', 'digest', 'internal_ref']);
export const codexRuntimeJobArtifactMaxSizeBytes = 10_000_000;
export const codexRuntimeGeneratedPayloadInlineMaxBytes = 64 * 1024;
const allowedCodexRuntimeJobArtifactContentTypes = new Set([
  'application/json',
  'application/xml',
  'application/zip',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/markdown',
  'text/plain',
  'text/x-diff',
]);
const codexGenerationRuntimeJobResultKeys = new Set([
  'task_kind',
  'prompt_version',
  'output_schema_version',
  'generated_payload',
  'generated_payload_digest',
  'generation_artifacts',
  'codex_session_thread',
  'output_capsule',
  'output_memory_bundle_ref',
  'output_memory_bundle_digest',
  'memory_delta_artifact_ref',
  'memory_delta_digest',
  'output_environment_manifest_ref',
  'output_environment_manifest_digest',
  'runtime_evidence',
  'public_summary',
]);
const codexGenerationTaskKindSet = new Set<string>(codexGenerationTaskKinds);
const productGenerationTaskKindSet = new Set<string>([
  'boundary_brainstorming_round',
  'development_plan_item_spec_revision',
  'development_plan_item_execution_plan_revision',
]);
const boundaryRoundRuntimeResultKeys = new Set([
  'schema_version',
  'session_id',
  'round_id',
  'questions',
  'proposed_decisions',
  'summary_proposal',
  'needs_leader_input',
  'public_summary',
  'artifacts',
]);
const boundaryRoundQuestionKeys = new Set(['text', 'required', 'rationale']);
const boundaryRoundDecisionKeys = new Set(['text', 'rationale']);
const boundaryRoundSummaryProposalKeys = new Set([
  'summary_markdown',
  'confirmed_scope',
  'confirmed_out_of_scope',
  'accepted_assumptions',
  'open_risks',
  'validation_expectations',
]);
const generatedSpecRevisionKeys = new Set([
  'schema_version',
  'development_plan_item_id',
  'boundary_summary_revision_id',
  'summary',
  'content_markdown',
  'problem_context',
  'scope_in',
  'scope_out',
  'acceptance_criteria',
  'test_strategy',
  'risks',
  'assumptions',
  'unresolved_questions',
  'public_summary',
]);
const generatedExecutionPlanRevisionKeys = new Set([
  'schema_version',
  'development_plan_item_id',
  'based_on_spec_revision_id',
  'summary',
  'content_markdown',
  'implementation_sequence',
  'validation_strategy',
  'allowed_paths',
  'forbidden_paths',
  'required_checks',
  'rollback_notes',
  'handoff_criteria',
  'public_summary',
]);
const generatedExecutionPlanRequiredCheckKeys = new Set(['check_id', 'command', 'timeout_seconds', 'blocks_review']);
const codexRunExecutionPatchArtifactKeys = new Set(['content_type', 'digest', 'internal_ref']);
const codexRunExecutionCheckResultKeys = new Set(['name', 'status', 'summary', 'output_digest', 'output_internal_ref']);
const codexRunExecutionContinuationEvidenceFields = [
  'codex_session_thread',
  'output_capsule',
  'output_memory_bundle_ref',
  'output_memory_bundle_digest',
  'memory_delta_artifact_ref',
  'memory_delta_digest',
  'output_environment_manifest_ref',
  'output_environment_manifest_digest',
  'codex_session_turn_id',
] as const;
const codexRunExecutionRuntimeJobResultKeys = new Set([
  'task_kind',
  'output_schema_version',
  'execution_package_id',
  'execution_package_version',
  'run_session_id',
  'workspace_bundle_digest',
  'workspace_bundle_manifest_digest',
  'mounted_task_workspace_digest',
  'changed_files',
  'patch_artifact',
  'check_results',
  'execution_artifacts',
  ...codexRunExecutionContinuationEvidenceFields,
  'runtime_evidence',
  'public_summary',
]);
const codexSessionThreadTerminalEvidenceKeys = new Set(['codex_thread_id', 'codex_thread_id_digest', 'app_server_turn_id']);
const codexRuntimeCapsuleTerminalEvidenceKeys = new Set([
  'id',
  'codex_session_id',
  'created_from_turn_id',
  'sequence',
  'artifact_ref',
  'digest',
  'size_bytes',
  'manifest_digest',
  'thread_state_digest',
  'memory_state_digest',
  'environment_manifest_digest',
  'codex_thread_id_digest',
  'codex_cli_version',
  'app_server_protocol_digest',
  'runtime_profile_revision_id',
  'trusted_runtime_manifest_digest',
  'credential_binding_lineage_digest',
  'created_by_actor_id',
  'created_at',
]);

const requireCodexRuntimeInternalRef = (input: Record<string, unknown>, field: string, label: string): string => {
  const internalRef = requireCodexRuntimeResultString(input, field);
  try {
    const parsed = parseInternalArtifactRef(internalRef);
    if (parsed.kind === 'codex_runtime_job_artifact' && parsed.owner_type === 'codex_runtime_job') {
      return internalRef;
    }
  } catch {
    // Report all terminal internal ref failures with the runtime evidence safety code.
  }
  if (!isInternalArtifactRefString(internalRef)) {
    throw unsafeCodexRuntimePublicValue(`Codex runtime terminal result field ${label} is invalid.`);
  }
  throw unsafeCodexRuntimePublicValue(`Codex runtime terminal result field ${label} must reference a runtime job artifact.`);
};

const requireCodexSessionArtifactRef = (
  input: Record<string, unknown>,
  field: string,
  expectedKind: 'codex_memory_bundle' | 'codex_memory_delta' | 'codex_environment_manifest',
): string => {
  const internalRef = requireCodexRuntimeResultString(input, field);
  try {
    const parsed = parseInternalArtifactRef(internalRef);
    if (parsed.kind === expectedKind && parsed.owner_type === 'codex_session') {
      return internalRef;
    }
  } catch {
    // Report all terminal internal ref failures with the runtime evidence safety code.
  }
  throw unsafeCodexRuntimePublicValue(`Codex runtime terminal result field ${field} is invalid.`);
};

const requireCodexRuntimeArtifact = (input: unknown, field: string): Record<string, unknown> => {
  if (!isPlainObject(input)) {
    throw unsafeCodexRuntimePublicValue(`Codex runtime terminal result field ${field} must contain artifact objects.`);
  }
  assertCodexRuntimeResultKeys(input, codexRuntimeArtifactResultKeys, field);
  requireCodexRuntimeResultString(input, 'kind');
  requireCodexRuntimeResultString(input, 'name');
  requireCodexRuntimeResultString(input, 'content_type');
  if (input.digest !== undefined) {
    requireCodexRuntimeResultDigest(input, 'digest');
  }
  if (input.internal_ref !== undefined) {
    if (input.digest === undefined) {
      throw unsafeCodexRuntimePublicValue(`Codex runtime terminal result field ${field} internal_ref requires digest.`);
    }
    requireCodexRuntimeInternalRef(input, 'internal_ref', `${field} internal_ref`);
  }
  return input;
};

const requireCodexSessionThreadTerminalEvidence = (input: unknown): Record<string, unknown> => {
  if (!isPlainObject(input)) {
    throw unsafeCodexRuntimePublicValue('Codex runtime terminal result field codex_session_thread must be an object.');
  }
  assertCodexRuntimeResultKeys(input, codexSessionThreadTerminalEvidenceKeys, 'codex_session_thread');
  const codexThreadId = requireCodexRuntimeResultString(input, 'codex_thread_id');
  const codexThreadIdDigest = requireCodexRuntimeResultString(input, 'codex_thread_id_digest');
  if (codexThreadIdDigest !== codexSessionThreadIdDigest(codexThreadId)) {
    throw unsafeCodexRuntimePublicValue('Codex runtime terminal result field codex_session_thread digest does not match thread id.');
  }
  if (input.app_server_turn_id !== undefined) {
    requireCodexRuntimeResultString(input, 'app_server_turn_id');
  }
  return input;
};

const requireCodexRuntimeCapsuleTerminalEvidence = (input: unknown): CodexRuntimeCapsule => {
  if (!isPlainObject(input)) {
    throw unsafeCodexRuntimePublicValue('Codex runtime terminal result field output_capsule must be an object.');
  }
  assertCodexRuntimeResultKeys(input, codexRuntimeCapsuleTerminalEvidenceKeys, 'output_capsule');
  requireCodexRuntimeResultString(input, 'id');
  requireCodexRuntimeResultString(input, 'codex_session_id');
  requireCodexRuntimeResultString(input, 'created_from_turn_id');
  requireCodexRuntimeResultInteger(input, 'sequence');
  const artifactRef = requireCodexRuntimeResultString(input, 'artifact_ref');
  try {
    const parsed = parseInternalArtifactRef(artifactRef);
    if (
      parsed.kind !== 'codex_runtime_capsule' ||
      parsed.owner_type !== 'codex_session' ||
      parsed.owner_id !== input.codex_session_id ||
      parsed.artifact_id !== input.id
    ) {
      throw unsafeCodexRuntimePublicValue('Codex runtime terminal result field output_capsule artifact_ref does not match capsule identity.');
    }
  } catch (error) {
    if (error instanceof DomainError && error.code === 'codex_docker_runtime_evidence_unsafe') {
      throw error;
    }
    throw unsafeCodexRuntimePublicValue('Codex runtime terminal result field output_capsule artifact_ref is invalid.');
  }
  requireCodexRuntimeResultDigest(input, 'digest');
  requireCodexRuntimeResultString(input, 'size_bytes');
  requireCodexRuntimeResultDigest(input, 'manifest_digest');
  requireCodexRuntimeResultDigest(input, 'thread_state_digest');
  requireCodexRuntimeResultDigest(input, 'memory_state_digest');
  requireCodexRuntimeResultDigest(input, 'environment_manifest_digest');
  requireCodexRuntimeResultDigest(input, 'codex_thread_id_digest');
  requireCodexRuntimeResultString(input, 'codex_cli_version');
  requireCodexRuntimeResultDigest(input, 'app_server_protocol_digest');
  requireCodexRuntimeResultString(input, 'runtime_profile_revision_id');
  requireCodexRuntimeResultDigest(input, 'trusted_runtime_manifest_digest');
  requireCodexRuntimeResultDigest(input, 'credential_binding_lineage_digest');
  requireCodexRuntimeResultString(input, 'created_by_actor_id');
  const createdAt = requireCodexRuntimeResultString(input, 'created_at');
  if (!isCodexRuntimeIsoDateTimeString(createdAt)) {
    throw unsafeCodexRuntimePublicValue('Codex runtime terminal result field output_capsule created_at must be an ISO datetime string.');
  }
  return input as unknown as CodexRuntimeCapsule;
};

const requireCodexRuntimeTerminalContinuationEvidence = (
  input: Record<string, unknown>,
): { codexSessionThread: Record<string, unknown>; outputCapsule: CodexRuntimeCapsule } => {
  const codexSessionThread = requireCodexSessionThreadTerminalEvidence(input.codex_session_thread);
  const outputCapsule = requireCodexRuntimeCapsuleTerminalEvidence(input.output_capsule);
  if (codexSessionThread.codex_thread_id_digest !== outputCapsule.codex_thread_id_digest) {
    throw unsafeCodexRuntimePublicValue(
      'Codex runtime terminal result codex_session_thread digest must match output_capsule codex_thread_id_digest.',
    );
  }
  requireCodexSessionArtifactRef(input, 'output_memory_bundle_ref', 'codex_memory_bundle');
  requireCodexRuntimeResultDigest(input, 'output_memory_bundle_digest');
  requireCodexSessionArtifactRef(input, 'output_environment_manifest_ref', 'codex_environment_manifest');
  requireCodexRuntimeResultDigest(input, 'output_environment_manifest_digest');
  const hasMemoryDeltaRef = input.memory_delta_artifact_ref !== undefined;
  const hasMemoryDeltaDigest = input.memory_delta_digest !== undefined;
  if (hasMemoryDeltaRef !== hasMemoryDeltaDigest) {
    throw unsafeCodexRuntimePublicValue(
      'Codex runtime terminal result memory_delta_artifact_ref and memory_delta_digest must be provided together.',
    );
  }
  if (hasMemoryDeltaRef) {
    requireCodexSessionArtifactRef(input, 'memory_delta_artifact_ref', 'codex_memory_delta');
    requireCodexRuntimeResultDigest(input, 'memory_delta_digest');
  }
  return { codexSessionThread, outputCapsule };
};

const runtimePayloadRawMaterialPattern =
  /(?:\b(?:auth\.json|config\.toml)\b|\b(?:app[-_ ]?server\s+)?endpoint\s*[:=]\s*(?:unix|https?|wss?|tcp|socket|sock):|\bapp[-_ ]?server\s+endpoint\b|\b(?:unix|websocket|socket|sock):|\b(?:socket|sock)\s+(?:path|file|id)\b|\bcontainer[-_ ]?(?:id|name)\b|\bauth[-_ ]?(?:json|config|file|token|material)\b|\braw[-_ ]?(?:config|auth|logs?|output|prompt)\b|\bconfig[-_ ]?(?:json|file|path|material)\b|\bapp[-_ ]?server[-_ ]?logs?\b:?)/i;
const runtimePayloadHexContainerIdPattern = /[a-f0-9]{12,64}/gi;

const hasRuntimePayloadRawContainerIdToken = (value: string): boolean =>
  Array.from(value.matchAll(runtimePayloadHexContainerIdPattern)).some((match) => {
    const index = match.index ?? 0;
    const previous = index > 0 ? (value[index - 1] ?? '') : '';
    const next = value[index + match[0].length] ?? '';
    return (
      !/[a-f0-9-]/i.test(previous) &&
      !/[a-f0-9-]/i.test(next) &&
      value.slice(Math.max(0, index - 7), index).toLowerCase() !== 'sha256:'
    );
  });

const isUnsafeGeneratedPayloadString = (value: string, path: readonly string[]): boolean => {
  const safetyValue = stripCodexRuntimePublicRoutePathTokens(value);
  if (runtimePayloadRawMaterialPattern.test(value)) {
    return true;
  }
  if (
    hasRuntimePayloadRawContainerIdToken(value)
  ) {
    return true;
  }
  if (isGeneratedExecutionPlanPathField(path)) {
    return !isSafeCodexRuntimeRepoRelativePath(value);
  }
  if (isGeneratedExecutionPlanCommandField(path)) {
    return (
      publicUnsafeSecretTokenPattern.test(safetyValue) ||
      displayUnsafeEndpointTokenPattern.test(safetyValue) ||
      displayUnsafePathTokenPattern.test(safetyValue)
    );
  }
  return isRawRuntimePublicString(safetyValue, { allowDisplayText: isCodexRuntimeDisplayStringPath(path) });
};

const isGeneratedExecutionPlanPathField = (path: readonly string[]): boolean => {
  const parent = path[path.length - 2];
  return (parent === 'allowed_paths' || parent === 'forbidden_paths') && /^\d+$/.test(path[path.length - 1] ?? '');
};

const isGeneratedExecutionPlanCommandField = (path: readonly string[]): boolean => {
  const last = path[path.length - 1];
  const grandparent = path[path.length - 3];
  return last === 'command' && grandparent === 'required_checks';
};

const assertGeneratedPayloadPublicSafe = (value: unknown, path: readonly string[] = []): void => {
  if (typeof value === 'string') {
    if (isCodexRuntimeInternalArtifactRefPath(path) && isInternalArtifactRefString(value)) {
      return;
    }
    if (isUnsafeGeneratedPayloadString(value, path)) {
      throw unsafeCodexRuntimePublicValue(
        'Codex runtime generated payload cannot include raw paths, endpoints, container IDs, socket paths, config, auth, or logs.',
        { field: path.join('.') },
      );
    }
    return;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw unsafeCodexRuntimePublicValue('Codex runtime generated payload must be JSON-compatible.', { field: path.join('.') });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertGeneratedPayloadPublicSafe(entry, [...path, String(index)]));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (isUnsafeCodexRuntimePublicKey(key)) {
        throw unsafeCodexRuntimePublicValue(
          'Codex runtime generated payload cannot include raw paths, endpoints, container IDs, socket paths, config, auth, or logs.',
          { field: [...path, key].join('.') },
        );
      }
      assertGeneratedPayloadPublicSafe(entry, [...path, key]);
    }
    return;
  }
  throw unsafeCodexRuntimePublicValue('Codex runtime generated payload must be JSON-compatible.', { field: path.join('.') });
};

const requireOptionalCodexRuntimeResultString = (input: Record<string, unknown>, field: string): string | undefined => {
  if (input[field] === undefined) {
    return undefined;
  }
  return requireCodexRuntimeResultString(input, field);
};

const requireBoundaryRoundQuestion = (input: unknown, field: string): void => {
  if (!isPlainObject(input)) {
    throw unsafeCodexRuntimePublicValue(`Codex runtime terminal result field ${field} must contain question objects.`);
  }
  assertCodexRuntimeResultKeys(input, boundaryRoundQuestionKeys, field);
  requireCodexRuntimeResultString(input, 'text');
  requireCodexRuntimeResultBoolean(input, 'required');
  requireOptionalCodexRuntimeResultString(input, 'rationale');
};

const requireBoundaryRoundDecision = (input: unknown, field: string): void => {
  if (!isPlainObject(input)) {
    throw unsafeCodexRuntimePublicValue(`Codex runtime terminal result field ${field} must contain decision objects.`);
  }
  assertCodexRuntimeResultKeys(input, boundaryRoundDecisionKeys, field);
  requireCodexRuntimeResultString(input, 'text');
  requireOptionalCodexRuntimeResultString(input, 'rationale');
};

const requireBoundaryRoundSummaryProposal = (input: unknown): void => {
  if (!isPlainObject(input)) {
    throw unsafeCodexRuntimePublicValue('Codex boundary round summary_proposal must be an object.');
  }
  assertCodexRuntimeResultKeys(input, boundaryRoundSummaryProposalKeys, 'summary_proposal');
  requireCodexRuntimeResultString(input, 'summary_markdown');
  requireCodexRuntimeResultStringArray(input, 'confirmed_scope');
  requireCodexRuntimeResultStringArray(input, 'confirmed_out_of_scope');
  requireCodexRuntimeResultStringArray(input, 'accepted_assumptions');
  requireCodexRuntimeResultStringArray(input, 'open_risks');
  requireCodexRuntimeResultStringArray(input, 'validation_expectations');
};

const requireBoundaryRoundRuntimeResultPayload = (input: Record<string, unknown>): void => {
  assertCodexRuntimeResultKeys(input, boundaryRoundRuntimeResultKeys, 'boundary round generated_payload');
  if (input.schema_version !== 'boundary_round_result.v1') {
    throw unsafeCodexRuntimePublicValue('Codex boundary round generated_payload schema_version is invalid.');
  }
  requireCodexRuntimeResultString(input, 'session_id');
  requireCodexRuntimeResultString(input, 'round_id');
  requireCodexRuntimeResultArray(input, 'questions').forEach((entry) => requireBoundaryRoundQuestion(entry, 'questions'));
  requireCodexRuntimeResultArray(input, 'proposed_decisions').forEach((entry) =>
    requireBoundaryRoundDecision(entry, 'proposed_decisions'),
  );
  if (input.summary_proposal !== undefined) {
    requireBoundaryRoundSummaryProposal(input.summary_proposal);
  }
  requireCodexRuntimeResultBoolean(input, 'needs_leader_input');
  requireCodexRuntimeResultString(input, 'public_summary');
  requireCodexRuntimeResultArray(input, 'artifacts').forEach((entry) => {
    if (!artifactRefSchema.safeParse(entry).success) {
      throw unsafeCodexRuntimePublicValue('Codex boundary round generated_payload artifacts are invalid.');
    }
  });
  assertGeneratedPayloadPublicSafe(input);
};

const requireGeneratedSpecRevisionPayload = (input: Record<string, unknown>): void => {
  assertCodexRuntimeResultKeys(input, generatedSpecRevisionKeys, 'Spec revision generated_payload');
  if (input.schema_version !== 'spec_revision.v1') {
    throw unsafeCodexRuntimePublicValue('Codex Spec revision generated_payload schema_version is invalid.');
  }
  requireCodexRuntimeResultString(input, 'development_plan_item_id');
  requireCodexRuntimeResultString(input, 'boundary_summary_revision_id');
  requireCodexRuntimeResultString(input, 'summary');
  requireCodexRuntimeResultString(input, 'content_markdown');
  requireCodexRuntimeResultString(input, 'problem_context');
  requireCodexRuntimeResultStringArray(input, 'scope_in');
  requireCodexRuntimeResultStringArray(input, 'scope_out');
  requireCodexRuntimeResultStringArray(input, 'acceptance_criteria');
  requireCodexRuntimeResultStringArray(input, 'test_strategy');
  requireCodexRuntimeResultStringArray(input, 'risks');
  requireCodexRuntimeResultStringArray(input, 'assumptions');
  requireCodexRuntimeResultStringArray(input, 'unresolved_questions');
  requireCodexRuntimeResultString(input, 'public_summary');
  assertGeneratedPayloadPublicSafe(input);
};

const requireGeneratedExecutionPlanRequiredCheck = (input: unknown): void => {
  if (!isPlainObject(input)) {
    throw unsafeCodexRuntimePublicValue('Codex Implementation Plan Doc required_checks must contain objects.');
  }
  assertCodexRuntimeResultKeys(input, generatedExecutionPlanRequiredCheckKeys, 'required_checks');
  requireCodexRuntimeResultString(input, 'check_id');
  requireCodexRuntimeResultString(input, 'command');
  if (typeof input.timeout_seconds !== 'number' || !Number.isInteger(input.timeout_seconds) || input.timeout_seconds <= 0) {
    throw unsafeCodexRuntimePublicValue('Codex Implementation Plan Doc required_checks timeout_seconds must be a positive integer.');
  }
  requireCodexRuntimeResultBoolean(input, 'blocks_review');
};

const requireGeneratedExecutionPlanRevisionPayload = (input: Record<string, unknown>): void => {
  assertCodexRuntimeResultKeys(input, generatedExecutionPlanRevisionKeys, 'Implementation Plan Doc revision generated_payload');
  if (input.schema_version !== 'execution_plan_revision.v1') {
    throw unsafeCodexRuntimePublicValue('Codex Implementation Plan Doc revision generated_payload schema_version is invalid.');
  }
  requireCodexRuntimeResultString(input, 'development_plan_item_id');
  requireCodexRuntimeResultString(input, 'based_on_spec_revision_id');
  requireCodexRuntimeResultString(input, 'summary');
  requireCodexRuntimeResultString(input, 'content_markdown');
  requireCodexRuntimeResultStringArray(input, 'implementation_sequence');
  requireCodexRuntimeResultStringArray(input, 'validation_strategy');
  requireCodexRuntimeResultStringArray(input, 'allowed_paths').forEach((path) => {
    if (!isSafeCodexRuntimeRepoRelativePath(path)) {
      throw unsafeCodexRuntimePublicValue('Codex Implementation Plan Doc allowed_paths must be safe repository-relative paths.');
    }
  });
  requireCodexRuntimeResultStringArray(input, 'forbidden_paths').forEach((path) => {
    if (!isSafeCodexRuntimeRepoRelativePath(path)) {
      throw unsafeCodexRuntimePublicValue('Codex Implementation Plan Doc forbidden_paths must be safe repository-relative paths.');
    }
  });
  const checkIds = requireCodexRuntimeResultArray(input, 'required_checks').map((entry) => {
    requireGeneratedExecutionPlanRequiredCheck(entry);
    return (entry as Record<string, unknown>).check_id as string;
  });
  if (new Set(checkIds).size !== checkIds.length) {
    throw unsafeCodexRuntimePublicValue('Codex Implementation Plan Doc required_checks check_id values must be unique.');
  }
  requireCodexRuntimeResultString(input, 'rollback_notes');
  requireCodexRuntimeResultStringArray(input, 'handoff_criteria');
  requireCodexRuntimeResultString(input, 'public_summary');
  assertGeneratedPayloadPublicSafe(input);
};

const requireProductGenerationPayload = (taskKind: CodexGenerationTaskKind, generatedPayload: Record<string, unknown>): void => {
  switch (taskKind) {
    case 'boundary_brainstorming_round':
      requireBoundaryRoundRuntimeResultPayload(generatedPayload);
      return;
    case 'development_plan_item_spec_revision':
      requireGeneratedSpecRevisionPayload(generatedPayload);
      return;
    case 'development_plan_item_execution_plan_revision':
      requireGeneratedExecutionPlanRevisionPayload(generatedPayload);
      return;
    case 'spec_draft':
    case 'plan_draft':
    case 'package_drafts':
      return;
  }
};

const isGeneratedPayloadArtifactRefPayload = (payload: Record<string, unknown>): boolean =>
  payload.schema_version === 'generated_payload_ref.v1';

const requireGeneratedPayloadArtifactRefPayload = (
  payload: Record<string, unknown>,
): void => {
  assertCodexRuntimeResultKeys(payload, new Set(['schema_version', 'artifact']), 'generated_payload ref');
  const artifact = requireCodexRuntimeResultRecord(payload, 'artifact');
  requireCodexRuntimeArtifact(artifact, 'generated_payload.artifact');
  if (
    artifact.kind !== 'generated_payload' ||
    artifact.content_type !== 'application/json' ||
    typeof artifact.internal_ref !== 'string'
  ) {
    throw unsafeCodexRuntimePublicValue('Codex generation terminal result generated_payload artifact ref is invalid.');
  }
  assertGeneratedPayloadPublicSafe(payload);
};

const requireCodexGenerationRuntimeJobResult = (input: Record<string, unknown>): CodexGenerationRuntimeJobResult => {
  assertCodexRuntimeResultKeys(input, codexGenerationRuntimeJobResultKeys, 'generation result');
  if (!codexGenerationTaskKindSet.has(String(input.task_kind))) {
    throw unsafeCodexRuntimePublicValue('Codex generation terminal result task_kind is invalid.');
  }
  const taskKind = input.task_kind as CodexGenerationTaskKind;
  requireCodexRuntimeResultString(input, 'prompt_version');
  requireCodexRuntimeResultString(input, 'output_schema_version');
  const generatedPayload = requireCodexRuntimeResultRecord(input, 'generated_payload');
  const generatedPayloadDigest = requireCodexRuntimeResultDigest(input, 'generated_payload_digest');
  if (isGeneratedPayloadArtifactRefPayload(generatedPayload)) {
    requireGeneratedPayloadArtifactRefPayload(generatedPayload);
  } else {
    if (generatedPayloadDigest !== codexCanonicalDigest(generatedPayload)) {
      throw unsafeCodexRuntimePublicValue('Codex generation terminal result generated_payload_digest does not match generated_payload.');
    }
    requireProductGenerationPayload(taskKind, generatedPayload);
  }
  if (Buffer.byteLength(JSON.stringify(generatedPayload), 'utf8') > codexRuntimeGeneratedPayloadInlineMaxBytes) {
    throw unsafeCodexRuntimePublicValue('Codex generation terminal result generated_payload must be uploaded as an artifact ref.');
  }
  requireCodexRuntimeResultArray(input, 'generation_artifacts').forEach((artifact) =>
    requireCodexRuntimeArtifact(artifact, 'generation_artifacts'),
  );
  if (input.codex_session_thread !== undefined) {
    requireCodexSessionThreadTerminalEvidence(input.codex_session_thread);
  }
  if (input.output_capsule !== undefined) {
    requireCodexRuntimeCapsuleTerminalEvidence(input.output_capsule);
    requireCodexSessionArtifactRef(input, 'output_memory_bundle_ref', 'codex_memory_bundle');
    requireCodexRuntimeResultDigest(input, 'output_memory_bundle_digest');
    requireCodexSessionArtifactRef(input, 'output_environment_manifest_ref', 'codex_environment_manifest');
    requireCodexRuntimeResultDigest(input, 'output_environment_manifest_digest');
    const hasMemoryDeltaRef = input.memory_delta_artifact_ref !== undefined;
    const hasMemoryDeltaDigest = input.memory_delta_digest !== undefined;
    if (hasMemoryDeltaRef !== hasMemoryDeltaDigest) {
      throw unsafeCodexRuntimePublicValue(
        'Codex runtime terminal result memory_delta_artifact_ref and memory_delta_digest must be provided together.',
      );
    }
    if (hasMemoryDeltaRef) {
      requireCodexSessionArtifactRef(input, 'memory_delta_artifact_ref', 'codex_memory_delta');
      requireCodexRuntimeResultDigest(input, 'memory_delta_digest');
    }
  } else {
    const continuationFields = [
      'output_memory_bundle_ref',
      'output_memory_bundle_digest',
      'memory_delta_artifact_ref',
      'memory_delta_digest',
      'output_environment_manifest_ref',
      'output_environment_manifest_digest',
    ] as const;
    for (const field of continuationFields) {
      if (input[field] !== undefined) {
        throw unsafeCodexRuntimePublicValue(`Codex runtime terminal result field ${field} requires output_capsule.`);
      }
    }
  }
  if (input.runtime_evidence !== undefined) {
    validateCodexDockerRuntimeEvidence(input.runtime_evidence);
  }
  requireCodexRuntimeResultString(input, 'public_summary');
  return input as unknown as CodexGenerationRuntimeJobResult;
};

const hasCodexRunExecutionContinuationEvidence = (input: Record<string, unknown>): boolean =>
  codexRunExecutionContinuationEvidenceFields.some((field) => Object.prototype.hasOwnProperty.call(input, field));

const requireCodexRunExecutionRuntimeJobResult = (input: Record<string, unknown>): CodexRunExecutionRuntimeJobResult => {
  assertCodexRuntimeResultKeys(input, codexRunExecutionRuntimeJobResultKeys, 'run-execution result');
  if (input.task_kind !== 'run_execution') {
    throw unsafeCodexRuntimePublicValue('Codex run-execution terminal result task_kind is invalid.');
  }
  const normalizedInput =
    input.output_schema_version === undefined
      ? { ...input, output_schema_version: 'codex_run_execution_result.v1' }
      : input;
  if (normalizedInput.output_schema_version !== 'codex_run_execution_result.v1') {
    throw unsafeCodexRuntimePublicValue('Codex run-execution terminal result output_schema_version is invalid.');
  }
  requireCodexRuntimeResultString(normalizedInput, 'execution_package_id');
  requireCodexRuntimeResultInteger(normalizedInput, 'execution_package_version');
  requireCodexRuntimeResultString(normalizedInput, 'run_session_id');
  requireCodexRuntimeResultDigest(normalizedInput, 'workspace_bundle_digest');
  requireCodexRuntimeResultDigest(normalizedInput, 'workspace_bundle_manifest_digest');
  requireCodexRuntimeResultDigest(normalizedInput, 'mounted_task_workspace_digest');
  const changedFiles = requireCodexRuntimeResultArray(normalizedInput, 'changed_files');
  if (changedFiles.some((entry) => typeof entry !== 'string' || !isSafeCodexRuntimeRepoRelativePath(entry))) {
    throw unsafeCodexRuntimePublicValue('Codex run-execution changed_files must be safe repository-relative paths.');
  }
  if (normalizedInput.patch_artifact !== undefined) {
    const patchArtifact = requireCodexRuntimeResultRecord(normalizedInput, 'patch_artifact');
    assertCodexRuntimeResultKeys(patchArtifact, codexRunExecutionPatchArtifactKeys, 'patch_artifact');
    if (patchArtifact.content_type !== 'text/x-diff') {
      throw unsafeCodexRuntimePublicValue('Codex run-execution patch_artifact content_type is invalid.');
    }
    requireCodexRuntimeResultDigest(patchArtifact, 'digest');
    requireCodexRuntimeInternalRef(patchArtifact, 'internal_ref', 'patch_artifact internal_ref');
  }
  requireCodexRuntimeResultArray(normalizedInput, 'check_results').forEach((entry) => {
    if (!isPlainObject(entry)) {
      throw unsafeCodexRuntimePublicValue('Codex run-execution check_results must contain objects.');
    }
    assertCodexRuntimeResultKeys(entry, codexRunExecutionCheckResultKeys, 'check_results');
    requireCodexRuntimeResultString(entry, 'name');
    if (!['passed', 'failed', 'skipped'].includes(String(entry.status))) {
      throw unsafeCodexRuntimePublicValue('Codex run-execution check result status is invalid.');
    }
    requireCodexRuntimeResultString(entry, 'summary');
    if (entry.output_digest !== undefined) {
      requireCodexRuntimeResultDigest(entry, 'output_digest');
    }
    if (entry.output_internal_ref !== undefined) {
      if (entry.output_digest === undefined) {
        throw unsafeCodexRuntimePublicValue('Codex run-execution check result output_internal_ref requires output_digest.');
      }
      requireCodexRuntimeInternalRef(entry, 'output_internal_ref', 'check_results output_internal_ref');
    }
  });
  requireCodexRuntimeResultArray(normalizedInput, 'execution_artifacts').forEach((artifact) =>
    requireCodexRuntimeArtifact(artifact, 'execution_artifacts'),
  );
  if (normalizedInput.runtime_evidence !== undefined) {
    validateCodexDockerRuntimeEvidence(normalizedInput.runtime_evidence);
  }
  requireCodexRuntimeResultString(normalizedInput, 'public_summary');
  return normalizedInput as unknown as CodexRunExecutionRuntimeJobResult;
};

const requireCodexWorkflowRunExecutionRuntimeJobResult = (
  input: Record<string, unknown>,
): CodexWorkflowRunExecutionRuntimeJobResult => {
  const normalizedInput = requireCodexRunExecutionRuntimeJobResult(input) as unknown as Record<string, unknown>;
  requireCodexRuntimeTerminalContinuationEvidence(normalizedInput);
  requireCodexRuntimeResultString(normalizedInput, 'codex_session_turn_id');
  return normalizedInput as unknown as CodexWorkflowRunExecutionRuntimeJobResult;
};

export const validateCodexRuntimeJobArtifactIntake = (input: {
  kind?: string;
  content_type: string;
  digest: string;
  size_bytes: number;
  metadata_json?: unknown;
}): void => {
  if (!allowedCodexRuntimeJobArtifactContentTypes.has(input.content_type)) {
    throw unsafeCodexRuntimePublicValue('Codex runtime job artifact content_type is not allowed.');
  }
  if (!isSha256Digest(input.digest)) {
    throw unsafeCodexRuntimePublicValue('Codex runtime job artifact digest must be a sha256 digest.');
  }
  if (!Number.isInteger(input.size_bytes) || input.size_bytes < 0 || input.size_bytes > codexRuntimeJobArtifactMaxSizeBytes) {
    throw unsafeCodexRuntimePublicValue('Codex runtime job artifact size exceeds the allowed limit.');
  }
  if (input.metadata_json !== undefined) {
    assertCodexRuntimePublicSafeRecord(input.metadata_json, 'runtime job artifact metadata', [], {
      allowInternalArtifactRefFields: true,
      allowRunExecutionChangedFiles: input.kind === 'run_execution_patch' && input.content_type === 'text/x-diff',
    });
  }
};

export interface CodexRuntimeTerminalArtifactRef {
  internal_ref: string;
  digest: string;
  content_type?: string;
}

export const collectCodexRuntimeJobTerminalArtifactRefs = (input: unknown): CodexRuntimeTerminalArtifactRef[] => {
  const result = validateCodexRuntimeJobTerminalResult(input);
  if (result.task_kind === 'run_execution') {
    return [
      ...(result.patch_artifact === undefined
        ? []
        : [
            {
              internal_ref: result.patch_artifact.internal_ref,
              digest: result.patch_artifact.digest,
              content_type: result.patch_artifact.content_type,
            },
          ]),
      ...result.check_results.flatMap((entry) =>
        entry.output_internal_ref === undefined || entry.output_digest === undefined
          ? []
          : [{ internal_ref: entry.output_internal_ref, digest: entry.output_digest }],
      ),
      ...result.execution_artifacts.flatMap((artifact) =>
        artifact.internal_ref === undefined || artifact.digest === undefined
          ? []
          : [{ internal_ref: artifact.internal_ref, digest: artifact.digest, content_type: artifact.content_type }],
      ),
    ];
  }
  const generatedPayloadArtifact =
    isPlainObject(result.generated_payload) &&
    result.generated_payload.schema_version === 'generated_payload_ref.v1' &&
    isPlainObject(result.generated_payload.artifact)
      ? [
          {
            internal_ref: requireCodexRuntimeResultString(result.generated_payload.artifact, 'internal_ref'),
            digest: requireCodexRuntimeResultDigest(result.generated_payload.artifact, 'digest'),
            content_type: requireCodexRuntimeResultString(result.generated_payload.artifact, 'content_type'),
          },
        ]
      : [];
  const refs = [
    ...generatedPayloadArtifact,
    ...result.generation_artifacts.flatMap((artifact) =>
      artifact.internal_ref === undefined || artifact.digest === undefined
        ? []
        : [{ internal_ref: artifact.internal_ref, digest: artifact.digest, content_type: artifact.content_type }],
    ),
  ];
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.internal_ref}\0${ref.digest}\0${ref.content_type ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

export const codexLaunchTokenEnvelopeDigest = (input: CodexLaunchTokenEnvelopeDigestInput | CodexLaunchTokenEnvelope): string => {
  if (!isPlainObject(input)) {
    throw unsupportedJsonValue();
  }
  const algorithm = requireCodexLaunchTokenEnvelopeDigestString(input, 'algorithm');
  if (algorithm !== 'x25519-hkdf-sha256-aes-256-gcm') {
    throw invalidProfile('Codex launch token envelope digest field algorithm is invalid.');
  }
  return codexCanonicalDigest({
    id: requireCodexLaunchTokenEnvelopeDigestString(input, 'id'),
    runtime_job_id: requireCodexLaunchTokenEnvelopeDigestString(input, 'runtime_job_id'),
    launch_lease_id: requireCodexLaunchTokenEnvelopeDigestString(input, 'launch_lease_id'),
    worker_id: requireCodexLaunchTokenEnvelopeDigestString(input, 'worker_id'),
    key_id: requireCodexLaunchTokenEnvelopeDigestString(input, 'key_id'),
    algorithm,
    ciphertext: requireCodexLaunchTokenEnvelopeDigestString(input, 'ciphertext'),
    encryption_nonce: requireCodexLaunchTokenEnvelopeDigestString(input, 'encryption_nonce'),
    aad_json: requireCodexLaunchTokenEnvelopeDigestAad(input),
    aad_digest: requireCodexLaunchTokenEnvelopeDigestSha256(input, 'aad_digest'),
    expires_at: requireCodexLaunchTokenEnvelopeDigestString(input, 'expires_at'),
  });
};

const assertCodexRuntimeJobTerminalResultPublicSafe = (
  result: CodexGenerationRuntimeJobResult | CodexRunExecutionRuntimeJobResult,
): void => {
  const resultRecord = result as unknown as Record<string, unknown>;
  const omittedPublicSafeKeys = new Set<string>([
    ...(resultRecord.runtime_evidence !== undefined ? ['runtime_evidence'] : []),
    ...(resultRecord.codex_session_thread !== undefined ? ['codex_session_thread'] : []),
    ...(resultRecord.output_capsule !== undefined ? ['output_capsule'] : []),
    ...(productGenerationTaskKindSet.has(String(resultRecord.task_kind)) ? ['generated_payload'] : []),
  ]);
  const publicSafeInput =
    omittedPublicSafeKeys.size === 0
      ? resultRecord
      : Object.fromEntries(Object.entries(resultRecord).filter(([key]) => !omittedPublicSafeKeys.has(key)));
  assertCodexRuntimePublicSafeRecord(publicSafeInput, 'terminal result', [], {
    allowInternalArtifactRefFields: true,
    allowRunExecutionChangedFiles: resultRecord.task_kind === 'run_execution',
    rejectLegacyCodexRuntimeJobArtifactRefs: true,
  });
};

export const validateCodexWorkflowRunExecutionRuntimeJobResult = (
  input: unknown,
): CodexWorkflowRunExecutionRuntimeJobResult => {
  if (!isPlainObject(input)) {
    throw unsafeCodexRuntimePublicValue('Codex runtime terminal result must be an object.');
  }
  const result = requireCodexWorkflowRunExecutionRuntimeJobResult(input);
  assertCodexRuntimeJobTerminalResultPublicSafe(result);
  return result;
};

export const validateCodexRuntimeJobTerminalResult = (
  input: unknown,
): CodexGenerationRuntimeJobResult | CodexRunExecutionRuntimeJobResult => {
  if (!isPlainObject(input)) {
    throw unsafeCodexRuntimePublicValue('Codex runtime terminal result must be an object.');
  }
  const result =
    input.task_kind === 'run_execution'
      ? hasCodexRunExecutionContinuationEvidence(input)
        ? requireCodexWorkflowRunExecutionRuntimeJobResult(input)
        : requireCodexRunExecutionRuntimeJobResult(input)
      : requireCodexGenerationRuntimeJobResult(input);
  assertCodexRuntimeJobTerminalResultPublicSafe(result);
  return result;
};

export const validateCodexDockerNetworkProxyConfig = (config: CodexDockerNetworkProxyConfig): CodexDockerNetworkProxyConfig => {
  if (!isPlainObject(config)) {
    throw dockerPolicyUnavailable('Docker network proxy provider_config is required.');
  }
  if (typeof config.proxy_image !== 'string' || config.proxy_image.length === 0) {
    throw dockerPolicyUnavailable('Docker proxy image must be a non-empty string.');
  }
  if (typeof config.self_test_image !== 'string' || config.self_test_image.length === 0) {
    throw dockerPolicyUnavailable('Docker proxy self-test image must be a non-empty string.');
  }
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
  revision: unknown,
  options: { strictRealDogfood?: boolean } = {},
): CodexRuntimeProfileRevision => {
  if (!isPlainObject(revision)) {
    throw invalidProfile('Codex runtime profile revision must be an object.');
  }
  if (!validRuntimeTargetKinds.has(revision.target_kind as CodexRuntimeTargetKind)) {
    throw invalidProfile('Codex runtime profile target_kind is invalid.');
  }
  if (!validSourceAccessModes.has(revision.source_access_mode as CodexSourceAccessMode)) {
    throw invalidProfile('Codex runtime profile source_access_mode is invalid.');
  }
  if (!validRuntimeEnvironments.has(revision.environment as CodexRuntimeEnvironment)) {
    throw invalidProfile('Codex runtime profile environment is invalid.');
  }
  if (!validRuntimeProfileRevisionStatuses.has(revision.status as CodexRuntimeProfileRevision['status'])) {
    throw invalidProfile('Codex runtime profile status is invalid.');
  }
  assertNonEmptyString(revision.id, 'Codex runtime profile revision id');
  assertNonEmptyString(revision.profile_id, 'Codex runtime profile id');
  assertPositiveInteger(revision.revision_number, 'Codex runtime profile revision_number');
  assertNonEmptyString(revision.docker_image, 'Codex runtime profile docker_image');
  assertNonEmptyString(revision.codex_config_toml, 'Codex runtime profile codex_config_toml');
  assertNonEmptyString(revision.created_by_actor_id, 'Codex runtime profile created_by_actor_id');
  assertIsoDateTime(revision.created_at, 'Codex runtime profile created_at');
  const targetKind = revision.target_kind as CodexRuntimeTargetKind;
  assertCodexRuntimeResourceLimits(revision.resource_limits);
  assertCodexRuntimeNetworkPolicy(revision.network_policy);
  assertCodexRuntimeScopes(revision.allowed_scopes);
  assertCodexDockerPolicy(revision.docker_policy);
  assertCodexEffectiveConfigAssertions(revision.effective_config_assertions, targetKind);
  assertSha256Digest(revision.docker_image_digest, 'Docker image digest');
  assertSha256Digest(revision.codex_config_digest, 'Codex config digest');
  assertSha256Digest(revision.expected_effective_config_digest, 'Expected effective config digest');

  const validatedRevision = revision as unknown as CodexRuntimeProfileRevision;
  const expectedCodexConfigDigest = codexCanonicalDigest(validatedRevision.codex_config_toml);
  if (validatedRevision.codex_config_digest !== expectedCodexConfigDigest) {
    throw invalidProfile('Codex runtime profile config digest does not match normalized Codex config.');
  }

  const expectedProfileDigest = codexRuntimeProfileRevisionDigest(validatedRevision);
  if (validatedRevision.profile_digest !== expectedProfileDigest) {
    throw invalidProfile('Codex runtime profile digest does not match runtime-affecting profile data.');
  }

  if (configInterpolationPattern.test(validatedRevision.codex_config_toml)) {
    throw invalidProfile('Codex config TOML must not depend on environment interpolation channels.');
  }

  if (validatedRevision.app_server_required !== true || validatedRevision.allowed_driver_kind !== 'app_server') {
    throw invalidProfile('Codex runtime profiles must require the app-server driver.');
  }

  const strict = options.strictRealDogfood === true;
  if (strict) {
    const networkPolicy = assertStrictCodexRuntimeNetworkPolicy(normalizeCodexRuntimeNetworkPolicy(validatedRevision.network_policy));
    networkPolicy.allowlist_rules.forEach(assertStrictCodexRuntimeNetworkAllowlistRule);
    if (validatedRevision.docker_policy.network_disabled === true) {
      throw dockerPolicyUnavailable('Strict real dogfood profiles must not disable Docker networking when using an egress allowlist network policy.');
    }

    if (
      validatedRevision.docker_policy.app_server_only !== true ||
      validatedRevision.docker_policy.rootless !== true ||
      validatedRevision.docker_policy.read_only_rootfs !== true ||
      validatedRevision.docker_policy.no_new_privileges !== true ||
      !validatedRevision.docker_policy.drop_capabilities.includes('ALL')
    ) {
      throw dockerPolicyUnavailable('Strict real dogfood profiles require Docker app-server-only, rootless, read-only, no-new-privileges policy with all capabilities dropped.');
    }

    if (validatedRevision.effective_config_assertions.approval_policy !== 'never') {
      throw invalidProfile('Strict Codex runtime profiles must assert approval_policy never.');
    }
    if (validatedRevision.target_kind === 'generation') {
      if (
        validatedRevision.source_access_mode !== 'artifact_only' ||
        validatedRevision.effective_config_assertions.target_kind !== 'generation' ||
        validatedRevision.effective_config_assertions.source_write_policy !== 'artifact_only' ||
        validatedRevision.effective_config_assertions.forbidden_writable_roots.length !== 1 ||
        validatedRevision.effective_config_assertions.forbidden_writable_roots[0] !== 'workspace'
      ) {
        throw invalidProfile('Strict generation profiles must assert artifact-only source access and no source workspace writes.');
      }
    }
    if (validatedRevision.target_kind === 'run_execution') {
      if (
        validatedRevision.source_access_mode !== 'path_policy_scoped' ||
        validatedRevision.effective_config_assertions.target_kind !== 'run_execution' ||
        !['danger-full-access', 'dangerFullAccess'].includes(validatedRevision.effective_config_assertions.sandbox_type) ||
        validatedRevision.effective_config_assertions.writable_roots_policy !== 'task_workspace_only'
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
    assertCodexProviderHostsCoveredByAllowlist(validatedRevision.codex_config_toml, networkPolicy);
  }

  const networkPolicy = normalizeCodexRuntimeNetworkPolicy(validatedRevision.network_policy);
  if (networkPolicy.mode === 'egress_allowlist' && networkPolicy.provider === 'docker_network_proxy') {
    validateCodexDockerNetworkProxyConfig(networkPolicy.provider_config);
  }

  return validatedRevision;
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
    if (key === 'runtime_target_kind' && !validRuntimeTargetKinds.has(value as CodexRuntimeTargetKind)) {
      throw unsafeDockerRuntimeEvidence('Codex public-safe Docker runtime evidence runtime_target_kind is invalid.', { field: key });
    }
    if (key === 'runtime_target_kind') {
      continue;
    }
    if (key === 'source_access_mode') {
      if (!validSourceAccessModes.has(value as CodexSourceAccessMode)) {
        throw unsafeDockerRuntimeEvidence('Codex public-safe Docker runtime evidence source_access_mode is invalid.', { field: key });
      }
      continue;
    }
    if (key === 'environment') {
      if (!validRuntimeEnvironments.has(value as CodexRuntimeEnvironment)) {
        throw unsafeDockerRuntimeEvidence('Codex public-safe Docker runtime evidence environment is invalid.', { field: key });
      }
      continue;
    }
    if (key.endsWith('_digest') && !isSha256Digest(value)) {
      throw unsafeDockerRuntimeEvidence('Codex public-safe Docker runtime evidence digest fields must be sha256 digests.', {
        field: key,
      });
    }
    if (isDockerRuntimeEvidencePublicId(key, value)) {
      continue;
    }
    if (key === 'worker_id' && isDockerRuntimeEvidencePublicWorkerId(value, evidence.runtime_target_kind)) {
      continue;
    }
    if (
      !key.endsWith('_digest') &&
      (isRawPathEndpointOrContainerId(value) ||
        isCodexRuntimeEndpointOrContainerString(value) ||
        isCodexRuntimeUnsafeDisplayString(value) ||
        isBareDnsHostString(value) ||
        publicUnsafeSecretTokenPattern.test(value) ||
        isCodexRuntimeLocalPathString(value))
    ) {
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
