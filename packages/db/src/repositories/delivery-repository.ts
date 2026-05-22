import type {
  AutomationActionRun,
  AutomationActorContext,
  AutomationProjectSettings,
  AutomationPreset,
  AutomationScope,
  Artifact,
  Actor,
  CodexCredentialBinding,
  CodexCredentialBindingPublic,
  CodexCredentialBindingVersion,
  CodexLaunchLease,
  CodexLaunchLeaseWithToken,
  CodexLaunchMaterialization,
  CodexLaunchTokenEnvelope,
  CodexLaunchTarget,
  CodexRuntimeJob,
  CodexRuntimeProfile,
  CodexRuntimeProfileRevision,
  CodexRuntimeScope,
  CodexRuntimeStatusProjection,
  CodexRuntimeTargetKind,
  CodexWorkerBootstrapToken,
  CodexWorkerRegistration,
  ResolvedCodexCredential,
  CommandIdempotencyRecord,
  Decision,
  ExecutionPackageGenerationRun,
  ExecutionPackage,
  ExecutionPackageDependency,
  ManualPathHold,
  ObjectEvent,
  Organization,
  Plan,
  PlanRevision,
  Project,
  ProjectRepo,
  Release,
  ReleaseEvidence,
  ReleaseExecutionPackage,
  ReleaseWorkItem,
  ReviewPacket,
  RunCommand,
  RunEvent,
  RunSession,
  RunWorkerLease,
  Spec,
  SpecRevision,
  StatusHistory,
  WorkItem,
} from '@forgeloop/domain';

import type { trace_link_relationship_values } from '../schema/_shared';

export type TraceLinkRelationship = (typeof trace_link_relationship_values)[number];

export interface TraceEventRecord {
  id: string;
  event_type: string;
  subject_type: string;
  subject_id: string;
  actor_id?: string;
  summary: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface TraceLinkRecord {
  id: string;
  trace_event_id: string;
  relationship: TraceLinkRelationship;
  object_type: string;
  object_id: string;
  created_at: string;
}

export interface TraceArtifactRefRecord {
  id: string;
  trace_event_id: string;
  artifact_id?: string;
  ref: Artifact['ref'];
  created_at: string;
}

export interface CreateCodexRuntimeProfileWithRevisionInput {
  profile: CodexRuntimeProfile;
  revision: CodexRuntimeProfileRevision;
}

export interface CreateCodexCredentialBindingWithVersionInput {
  binding: CodexCredentialBinding;
  version: CodexCredentialBindingVersion;
  secret_payload_json: unknown;
}

export interface ResolveCodexRuntimeForLaunchInput {
  project_id: string;
  repo_id?: string;
  target_kind: CodexRuntimeTargetKind;
  runtime_profile_id?: string;
  now: string;
}

export interface ResolveCodexCredentialForLaunchInput {
  credential_binding_id: string;
  target_kind: CodexRuntimeTargetKind;
  runtime_profile_id?: string;
  project_id: string;
  repo_id?: string;
  required_payload_digest?: string;
  now: string;
}

export interface GetCodexRuntimeStatusInput {
  project_id: string;
  repo_id?: string;
  target_kind: CodexRuntimeTargetKind;
  runtime_profile_id?: string;
  credential_binding_id?: string;
  now: string;
}

export interface CreateCodexWorkerBootstrapTokenInput {
  id: string;
  worker_identity: string;
  bootstrap_token_hash: string;
  bootstrap_token_version: number;
  status: 'active' | 'revoked' | 'consumed';
  allowed_scopes_json: readonly CodexRuntimeScope[];
  allowed_capabilities_json: Record<string, unknown>;
  created_by_actor_id: string;
  created_at: string;
  expires_at: string;
  revoked_at?: string;
}

export interface UpsertCodexWorkerRegistrationInput {
  worker_id: string;
  worker_identity: string;
  version: string;
  bootstrap_token_hash: string;
  bootstrap_token_version: number;
  session_token: string;
  session_expires_at: string;
  status: CodexWorkerRegistration['status'];
  control_channel_status: CodexWorkerRegistration['control_channel_status'];
  allowed_scopes: readonly CodexRuntimeScope[];
  capabilities: readonly CodexRuntimeTargetKind[];
  docker_image_digests: readonly string[];
  network_policy_digests: readonly string[];
  network_provider_config_digests?: readonly string[];
  host_worker_uid: number;
  host_worker_gid: number;
  lease_count: number;
  max_concurrency: number;
  labels?: Record<string, unknown>;
  session_public_key_id: string;
  session_public_key_algorithm: 'x25519';
  session_public_key_material: string;
  session_public_key_expires_at: string;
  now: string;
}

export interface HeartbeatCodexWorkerInput {
  worker_id: string;
  session_token: string;
  nonce: string;
  nonce_timestamp: string;
  status: CodexWorkerRegistration['status'];
  control_channel_status: CodexWorkerRegistration['control_channel_status'];
  active_lease_count: number;
  capabilities: readonly CodexRuntimeTargetKind[];
  now: string;
}

export interface FindAvailableCodexWorkerInput {
  project_id: string;
  repo_id?: string;
  target_kind: CodexRuntimeTargetKind;
  docker_image_digest: string;
  network_policy_digest: string;
  network_provider_config_digest?: string;
  now: string;
}

export interface CodexLaunchFenceSnapshot {
  action_claim_token_hash?: string;
  precondition_fingerprint?: string;
  run_worker_lease_id?: string;
  run_worker_lease_token_hash?: string;
  run_session_status?: string;
  run_session_updated_at?: string;
  execution_package_version?: number;
}

export interface CreateOrReplayCodexLaunchLeaseInput {
  id: string;
  lease_request_id: string;
  target: CodexLaunchTarget;
  launch_attempt: number;
  worker_id: string;
  runtime_profile_revision_id: string;
  runtime_profile_digest: string;
  credential_binding_id: string;
  credential_binding_version_id: string;
  credential_payload_digest: string;
  docker_image_digest: string;
  network_policy_digest: string;
  network_provider_config_digest?: string;
  launch_token: string;
  action_type?: string;
  action_attempt?: number;
  action_claim_token_hash?: string;
  precondition_fingerprint?: string;
  execution_package_id?: string;
  run_worker_lease_id?: string;
  run_worker_lease_token_hash?: string;
  run_session_status?: string;
  run_session_updated_at?: string;
  execution_package_version?: number;
  expires_at: string;
  now: string;
}

export interface CodexLaunchTokenEnvelopeSealer {
  sealLaunchTokenEnvelope(input: {
    plaintext_launch_token: string;
    runtime_job_id: string;
    launch_lease_id: string;
    envelope_id: string;
    worker_id: string;
    worker_public_key_material: string;
    key_id: string;
    expires_at: string;
  }): Promise<Omit<CodexLaunchTokenEnvelope, 'status' | 'created_at'>>;
}

export interface PendingWorkspaceBundleInput {
  bundle_id: string;
  pending_artifact_ref: string;
  archive_digest: string;
  manifest_digest: string;
  run_worker_lease_id: string;
  workspace_acquisition_digest: string;
  workspace_acquisition_json: Record<string, unknown>;
  expires_at: string;
}

export interface CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput {
  runtime_job_id: string;
  launch_lease_id: string;
  envelope_id: string;
  job_request_id: string;
  target: CodexLaunchTarget;
  launch_attempt: number;
  worker_id: string;
  runtime_profile_revision_id: string;
  runtime_profile_digest: string;
  credential_binding_id: string;
  credential_binding_version_id: string;
  credential_payload_digest: string;
  docker_image_digest: string;
  network_policy_digest: string;
  network_provider_config_digest?: string;
  input_json: Record<string, unknown>;
  input_digest: string;
  workspace_acquisition_json?: Record<string, unknown>;
  workspace_acquisition_digest?: string;
  pending_workspace_bundle?: PendingWorkspaceBundleInput;
  action_type?: string;
  action_attempt?: number;
  action_claim_token_hash?: string;
  precondition_fingerprint?: string;
  execution_package_id?: string;
  run_worker_lease_id?: string;
  run_worker_lease_token_hash?: string;
  run_session_status?: string;
  run_session_updated_at?: string;
  execution_package_version?: number;
  expires_at: string;
  now: string;
}

export interface CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeResult {
  runtime_job: CodexRuntimeJob;
  launch_lease: CodexLaunchLease;
  envelope: CodexLaunchTokenEnvelope;
  replayed: boolean;
}

export interface PollCodexRuntimeJobsInput {
  worker_id: string;
  worker_session_token: string;
  nonce: string;
  nonce_timestamp: string;
  target_kinds?: readonly CodexRuntimeTargetKind[];
  limit: number;
  now: string;
}

export interface AcceptCodexRuntimeJobInput {
  runtime_job_id: string;
  worker_id: string;
  worker_session_token: string;
  nonce: string;
  nonce_timestamp: string;
  accepted_worker_session_digest: string;
  accepted_session_public_key_id: string;
  accepted_session_epoch: number;
  idempotency_key: string;
  request_digest: string;
  now: string;
}

export interface ClaimCodexLaunchTokenEnvelopeInput {
  runtime_job_id: string;
  envelope_id: string;
  worker_id: string;
  worker_session_token: string;
  nonce: string;
  nonce_timestamp: string;
  accepted_worker_session_digest: string;
  key_id: string;
  accepted_session_epoch: number;
  claim_request_id: string;
  request_digest: string;
  now: string;
}

export interface MaterializeCodexRuntimeJobInput {
  runtime_job_id: string;
  launch_lease_id: string;
  worker_id: string;
  worker_session_token: string;
  nonce: string;
  nonce_timestamp: string;
  launch_token_hash: string;
  accepted_worker_session_digest: string;
  accepted_session_public_key_id: string;
  accepted_session_epoch: number;
  materialization_request_id: string;
  request_digest: string;
  active_fence?: CodexLaunchFenceSnapshot;
  now: string;
}

export interface StartCodexRuntimeJobInput {
  runtime_job_id: string;
  worker_id: string;
  worker_session_token: string;
  nonce: string;
  nonce_timestamp: string;
  idempotency_key: string;
  request_digest: string;
  runtime_evidence_digest: string;
  launch_materialization_digest: string;
  now: string;
}

export interface AppendCodexRuntimeJobEventInput {
  runtime_job_id: string;
  worker_id: string;
  worker_session_token: string;
  nonce: string;
  nonce_timestamp: string;
  event_id: string;
  idempotency_key: string;
  event_type: string;
  event_payload_json: Record<string, unknown>;
  request_digest: string;
  now: string;
}

export interface CreateCodexRuntimeJobArtifactInput {
  runtime_job_id: string;
  worker_id: string;
  worker_session_token: string;
  artifact_id: string;
  artifact_idempotency_key: string;
  kind: string;
  name: string;
  content_type: string;
  digest: string;
  internal_ref: string;
  size_bytes: number;
  metadata_json: Record<string, unknown>;
  request_digest: string;
  now: string;
}

export interface CreatePendingWorkspaceBundleArtifactInput extends PendingWorkspaceBundleInput {
  id: string;
  request_digest: string;
  created_at: string;
}

export interface GetWorkspaceBundleDownloadForRuntimeJobInput {
  runtime_job_id: string;
  bundle_id: string;
  worker_id: string;
  worker_session_token: string;
  now: string;
}

export interface CancelCodexRuntimeJobInput {
  runtime_job_id: string;
  reason_code: string;
  idempotency_key: string;
  request_digest: string;
  now: string;
}

export interface TerminalizeCodexRuntimeJobInput {
  runtime_job_id: string;
  launch_lease_id: string;
  worker_id: string;
  worker_session_token: string;
  nonce: string;
  nonce_timestamp: string;
  terminal_status: NonNullable<CodexRuntimeJob['terminal_status']>;
  reason_code: string;
  terminal_result_json?: Record<string, unknown>;
  idempotency_key: string;
  request_digest: string;
  now: string;
}

export interface RecoverStaleCodexRuntimeJobsInput {
  stale_before: string;
  now: string;
  worker_id?: string;
  reason_code: string;
}

export interface RecoverStaleCodexRuntimeJobsResult {
  recovered_runtime_jobs: CodexRuntimeJob[];
  recovered_launch_leases: CodexLaunchLease[];
}

export interface GetCodexLaunchLeaseStatusInput {
  launch_lease_id: string;
  worker_id: string;
  worker_session_token: string;
  nonce: string;
  nonce_timestamp: string;
  now: string;
}

export interface RefreshCodexWorkerSessionInput {
  worker_id: string;
  current_session_token: string;
  next_session_token: string;
  next_session_expires_at: string;
  next_session_public_key_id: string;
  next_session_public_key_material: string;
  next_session_public_key_expires_at: string;
  request_digest: string;
  now: string;
}

export interface MaterializeCodexLaunchLeaseInput {
  lease_id: string;
  worker_id: string;
  launch_token: string;
  worker_session_token: string;
  nonce: string;
  nonce_timestamp: string;
  materialization_request_hash: string;
  active_fence?: CodexLaunchFenceSnapshot;
  now: string;
}

export interface TerminalizeCodexLaunchLeaseInput {
  lease_id: string;
  worker_id: string;
  worker_session_token: string;
  nonce: string;
  nonce_timestamp: string;
  terminal_status: Extract<CodexLaunchLease['status'], 'terminal'>;
  reason_code: string;
  evidence_summary?: Record<string, unknown>;
  runtime_job_id?: string;
  idempotency_key: string;
  now: string;
}

export interface RevokeCodexLaunchLeaseInput {
  lease_id: string;
  reason_code: string;
  idempotency_key: string;
  now: string;
}

export interface RecoverStaleCodexWorkerLeasesInput {
  stale_before: string;
  now: string;
  worker_id?: string;
  reason_code: string;
}

export interface ConsumeCodexRuntimeSetupNonceInput {
  setup_nonce_hash: string;
  request_signature_hash: string;
  actor_id: string;
  actor_class: string;
  created_at: string;
  expires_at: string;
}

export interface CodexRuntimeRecoveryResult {
  recovered_launch_leases: CodexLaunchLease[];
  automation_action_transitions: Array<{
    action_type?: string;
    target_id: string;
    reason_code: string;
  }>;
  run_session_transitions: Array<{
    run_session_id?: string;
    execution_package_id?: string;
    reason_code: string;
  }>;
}

export type ReleaseWorkItemRecord = ReleaseWorkItem;
export type ReleaseExecutionPackageRecord = ReleaseExecutionPackage;

export interface ResolveAutomationProjectSettingsInput {
  project_id: string;
  repo_id?: string;
}

export interface SetAutomationProjectSettingsInput {
  id: string;
  project_id: string;
  repo_id?: string;
  scope_type: 'project' | 'repo';
  preset: AutomationPreset;
  expected_version: number;
  reason: string;
  evidence_refs: Artifact['ref'][];
  actor: AutomationActorContext;
  now: string;
}

export interface DisableAutomationProjectSettingsInput
  extends Omit<SetAutomationProjectSettingsInput, 'id' | 'preset' | 'scope_type'> {
  id?: string;
}

export interface RequestManualPathHoldInput
  extends Omit<ManualPathHold, 'status' | 'resolved_by' | 'resolved_at' | 'resolution'> {
  idempotency_key: string;
  generation_key?: string;
  gate_key?: string;
}

export interface ResolveManualPathHoldInput {
  hold_id: string;
  resolved_by: string;
  resolved_at: string;
  resolution: string;
}

export interface ListActiveManualPathHoldsInput {
  object_type: string;
  object_id: string;
  generation_key?: string;
  gate_key?: string;
}

export interface ClaimCommandIdempotencyInput
  extends Omit<CommandIdempotencyRecord, 'status' | 'created_at' | 'updated_at' | 'started_at' | 'finished_at'> {
  claim_token: string;
  locked_until: string;
  now: string;
}

export interface RenewCommandIdempotencyInput {
  idempotency_key: string;
  claim_token: string;
  locked_until: string;
  last_heartbeat_at: string;
}

export interface FinishCommandIdempotencyInput {
  idempotency_key: string;
  claim_token: string;
  result_json?: Record<string, unknown>;
  finished_at: string;
}

export interface ClaimExecutionPackageGenerationRunInput {
  plan_revision_id: string;
  generation_key: string;
  generator_version?: string;
  policy_digest?: string;
  manifest_digest?: string;
  expected_package_count?: number;
  expected_package_keys?: string[];
  evidence_refs?: Artifact['ref'][];
  claim_token: string;
  now: string;
  locked_until: string;
}

export interface ExecutionPackageGenerationPackageRecord {
  execution_package_set_id: string;
  execution_package_id: string;
  plan_revision_id: string;
  generation_key: string;
  package_key: string;
  sequence: number;
  manifest_digest: string;
}

export interface SaveExecutionPackageGenerationPackageInput extends ExecutionPackageGenerationPackageRecord {
  claim_token: string;
}

export interface CompleteExecutionPackageGenerationRunInput {
  plan_revision_id: string;
  execution_package_set_id: string;
  claim_token: string;
  result_json?: Record<string, unknown>;
  completed_at: string;
}

export interface SupersedeExecutionPackageGenerationRunInput {
  plan_revision_id: string;
  execution_package_set_id: string;
  expected_version: number;
  supersede_command_id: string;
  superseded_by: string;
  superseded_at: string;
  reason: string;
  evidence_refs: Artifact['ref'][];
}

export interface GetExecutionPackageGenerationRunInput {
  plan_revision_id: string;
  generation_key: string;
}

export interface ClaimAutomationActionRunInput
  extends Omit<
    AutomationActionRun,
    | 'status'
    | 'attempt'
    | 'claim_token'
    | 'locked_until'
    | 'last_heartbeat_at'
    | 'next_attempt_at'
    | 'retryable'
    | 'result_json'
    | 'metadata_json'
    | 'reason'
    | 'error_code'
    | 'error_message'
    | 'policy_digest'
    | 'created_by'
    | 'created_at'
    | 'updated_at'
    | 'claimed_at'
    | 'started_at'
    | 'finished_at'
  > {
  automation_scope: AutomationScope;
  claim_token: string;
  locked_until: string;
  now: string;
}

export interface CreateOrReplayAutomationActionRunInput
  extends Pick<
    AutomationActionRun,
    | 'id'
    | 'action_type'
    | 'target_object_type'
    | 'target_object_id'
    | 'target_status'
    | 'idempotency_key'
    | 'automation_scope'
    | 'automation_settings_version'
    | 'capability_fingerprint'
    | 'precondition_fingerprint'
    | 'action_input_json'
  > {
  target_revision_id?: string;
  target_version?: number;
  created_by?: string;
  status?: Extract<AutomationActionRun['status'], 'pending'>;
  now: string;
}

export interface ClaimNextAutomationActionRunInput {
  now: string;
  claim_token: string;
  locked_until: string;
  limit: number;
  action_type?: AutomationActionRun['action_type'];
  project_id?: string;
  repo_id?: string;
  automation_scope?: AutomationScope;
}

export interface GetClaimedAutomationActionRunInput {
  id: string;
  claim_token: string;
}

export interface LatestCompletedProjectionActionRunInput {
  automation_scope: AutomationScope;
  repo_id: string;
  policy_status: string;
  policy_digest?: string;
  parser_version: string;
  reason_code?: string;
}

export interface MarkAutomationActionGatePendingInput {
  id: string;
  idempotency_key: string;
  claim_token: string;
  reason: string;
  result_json?: Record<string, unknown>;
  next_attempt_at?: string;
  now: string;
}

export interface CompleteAutomationActionRunInput {
  id: string;
  idempotency_key: string;
  claim_token: string;
  status: Extract<AutomationActionRun['status'], 'succeeded' | 'failed' | 'skipped' | 'blocked'>;
  result_json?: Record<string, unknown>;
  retryable?: boolean;
  next_attempt_at?: string;
  finished_at: string;
}

export interface ListClaimableAutomationActionRunsInput {
  now: string;
  limit: number;
}

export const runtimeSnapshotBlockerCodeOrder = [
  'policy_snapshot_missing',
  'policy_snapshot_invalid',
  'policy_digest_mismatch',
  'runtime_policy_invalid',
  'path_policy_declared_scope_rejected',
  'required_check_command_invalid',
  'structured_command_invalid',
  'runtime_hard_limits_unavailable',
  'sandbox_isolation_unavailable',
  'runtime_attestation_invalid',
  'primary_executor_governor_unavailable',
  'before_run_hook_failed',
  'before_run_hook_timed_out',
  'required_check_failed',
  'required_check_timed_out',
  'changed_files_unavailable',
  'path_policy_actual_changes_rejected',
  'fallback_denied_by_policy',
  'artifact_visibility_denied',
] as const;

export type RuntimeSnapshotBlockerCode = (typeof runtimeSnapshotBlockerCodeOrder)[number];

const runtimeSnapshotBlockerCodes = new Set<string>(runtimeSnapshotBlockerCodeOrder);
const runtimeSnapshotBlockerRank = new Map<string, number>(
  runtimeSnapshotBlockerCodeOrder.map((code, index) => [code, index]),
);

const runtimeSnapshotBlockerPublicSummaries: Record<RuntimeSnapshotBlockerCode, string> = {
  policy_snapshot_missing: 'Policy snapshot is missing.',
  policy_snapshot_invalid: 'Policy snapshot is invalid.',
  policy_digest_mismatch: 'Policy digest does not match the captured snapshot.',
  runtime_policy_invalid: 'Runtime policy is invalid.',
  path_policy_declared_scope_rejected: 'Declared source scope is outside the runtime path policy.',
  required_check_command_invalid: 'Required check command policy is invalid.',
  structured_command_invalid: 'Structured command policy is invalid.',
  runtime_hard_limits_unavailable: 'Runtime hard limits are unavailable.',
  sandbox_isolation_unavailable: 'Sandbox isolation is unavailable.',
  runtime_attestation_invalid: 'Runtime safety attestation is invalid.',
  primary_executor_governor_unavailable: 'Primary executor governor is unavailable.',
  before_run_hook_failed: 'Before-run hook failed.',
  before_run_hook_timed_out: 'Before-run hook timed out.',
  required_check_failed: 'Required check failed.',
  required_check_timed_out: 'Required check timed out.',
  changed_files_unavailable: 'Changed-file evidence is unavailable.',
  path_policy_actual_changes_rejected: 'Runtime path policy rejected the actual source changes.',
  fallback_denied_by_policy: 'Executor fallback is denied by policy.',
  artifact_visibility_denied: 'Artifact visibility policy denied public projection.',
};

const safePublicRefPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const codeUnitCompare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export interface RuntimeSnapshotBlockerRow {
  blocked_reason_code: string;
  blocked_summary: string;
  retryable: boolean;
  policy_digest?: string;
  policy_snapshot_version?: number;
  diagnostic_ref?: string;
}

export const isRuntimeSnapshotBlockerCode = (value: unknown): value is RuntimeSnapshotBlockerCode =>
  typeof value === 'string' && runtimeSnapshotBlockerCodes.has(value);

export const normalizeRuntimeSnapshotBlockerCode = (value: unknown): RuntimeSnapshotBlockerCode | undefined => {
  if (value === 'runtime_policy_snapshot_missing') {
    return 'policy_snapshot_missing';
  }
  if (value === 'runtime_policy_missing') {
    return 'runtime_policy_invalid';
  }
  return isRuntimeSnapshotBlockerCode(value) ? value : undefined;
};

export const sanitizeRuntimeSnapshotDiagnosticRef = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!safePublicRefPattern.test(trimmed) || /secret|token|stdout|stderr|diff/i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
};

export const runtimeSnapshotDiagnosticRefFromArtifact = (
  artifact: { kind?: unknown; digest?: unknown; name?: unknown } | undefined,
): string | undefined => {
  if (artifact === undefined || typeof artifact.kind !== 'string') {
    return undefined;
  }
  const ref = typeof artifact.digest === 'string' ? artifact.digest : typeof artifact.name === 'string' ? artifact.name : undefined;
  return sanitizeRuntimeSnapshotDiagnosticRef(ref === undefined ? `artifact:${artifact.kind}` : `artifact:${artifact.kind}:${ref}`);
};

export const normalizeRuntimeSnapshotBlocker = (input: {
  blocked_reason_code?: unknown;
  code?: unknown;
  blocked_summary?: unknown;
  summary?: unknown;
  retryable?: unknown;
  policy_digest?: unknown;
  policy_snapshot_version?: unknown;
  diagnostic_ref?: unknown;
}): RuntimeSnapshotBlockerRow | undefined => {
  const blockedReasonCode = normalizeRuntimeSnapshotBlockerCode(input.blocked_reason_code ?? input.code);
  if (blockedReasonCode === undefined) {
    return undefined;
  }
  const policyDigest =
    typeof input.policy_digest === 'string' && safePublicRefPattern.test(input.policy_digest) ? input.policy_digest : undefined;
  const policySnapshotVersion =
    typeof input.policy_snapshot_version === 'number' &&
    Number.isInteger(input.policy_snapshot_version) &&
    input.policy_snapshot_version >= 0
      ? input.policy_snapshot_version
      : undefined;
  const diagnosticRef = sanitizeRuntimeSnapshotDiagnosticRef(input.diagnostic_ref);
  return {
    blocked_reason_code: blockedReasonCode,
    blocked_summary: runtimeSnapshotBlockerPublicSummaries[blockedReasonCode],
    retryable: typeof input.retryable === 'boolean' ? input.retryable : false,
    ...(policyDigest === undefined ? {} : { policy_digest: policyDigest }),
    ...(policySnapshotVersion === undefined ? {} : { policy_snapshot_version: policySnapshotVersion }),
    ...(diagnosticRef === undefined ? {} : { diagnostic_ref: diagnosticRef }),
  };
};

export const sortRuntimeSnapshotBlockers = (
  blockers: readonly RuntimeSnapshotBlockerRow[] | undefined,
): RuntimeSnapshotBlockerRow[] => {
  const normalized = (blockers ?? [])
    .map((blocker) => normalizeRuntimeSnapshotBlocker(blocker))
    .filter((blocker): blocker is RuntimeSnapshotBlockerRow => blocker !== undefined);
  const deduped: RuntimeSnapshotBlockerRow[] = [];
  const seen = new Set<string>();
  for (const blocker of normalized) {
    const key = JSON.stringify(blocker);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(blocker);
    }
  }
  return deduped.sort(
    (left, right) =>
      (runtimeSnapshotBlockerRank.get(left.blocked_reason_code) ?? Number.MAX_SAFE_INTEGER) -
        (runtimeSnapshotBlockerRank.get(right.blocked_reason_code) ?? Number.MAX_SAFE_INTEGER) ||
      codeUnitCompare(left.blocked_reason_code, right.blocked_reason_code) ||
      codeUnitCompare(left.diagnostic_ref ?? '', right.diagnostic_ref ?? ''),
  );
};

const objectRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const runSessionRecencyValue = (runSession: RunSession): number => {
  const parsed = Date.parse(runSession.finished_at ?? runSession.updated_at);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const runtimeSnapshotBlockerFieldsFor = (
  blockers: readonly RuntimeSnapshotBlockerRow[],
): Pick<RuntimeSnapshotTargetRow, 'blocked_reason_code' | 'blocked_summary' | 'blockers'> => {
  const sortedBlockers = sortRuntimeSnapshotBlockers(blockers);
  const firstBlocker = sortedBlockers[0];
  if (firstBlocker === undefined) {
    return {};
  }
  return {
    blocked_reason_code: firstBlocker.blocked_reason_code,
    blocked_summary: firstBlocker.blocked_summary,
    blockers: sortedBlockers,
  };
};

export const runtimeSnapshotBlockersForActionRun = (actionRun: AutomationActionRun): RuntimeSnapshotBlockerRow[] => {
  if (actionRun.status !== 'blocked' && actionRun.status !== 'failed' && actionRun.status !== 'gate_pending') {
    return [];
  }
  const resultRecord = objectRecord(actionRun.result_json) ?? {};
  const blocker = normalizeRuntimeSnapshotBlocker({
    code: actionRun.reason ?? actionRun.error_code ?? resultRecord.code ?? resultRecord.reason_code,
    retryable: actionRun.status === 'gate_pending' ? true : actionRun.retryable ?? false,
    diagnostic_ref: resultRecord.diagnostic_ref,
  });
  return blocker === undefined ? [] : [blocker];
};

const runtimeSnapshotPackagePolicyBlocker = (executionPackage: ExecutionPackage): RuntimeSnapshotBlockerRow | undefined => {
  const code =
    executionPackage.policy_snapshot_status === undefined || executionPackage.policy_snapshot_status === 'missing'
      ? 'policy_snapshot_missing'
      : executionPackage.policy_snapshot_status !== 'captured' || executionPackage.package_policy_snapshot === undefined
        ? 'policy_snapshot_invalid'
        : executionPackage.package_policy_snapshot.policy_snapshot_status !== undefined &&
            executionPackage.package_policy_snapshot.policy_snapshot_status !== 'captured'
          ? 'policy_snapshot_invalid'
          : executionPackage.policy_snapshot_version !== undefined &&
              executionPackage.package_policy_snapshot.policy_snapshot_version !== executionPackage.policy_snapshot_version
            ? 'policy_snapshot_invalid'
            : undefined;
  return normalizeRuntimeSnapshotBlocker({
    code,
    retryable: false,
    policy_digest: executionPackage.package_policy_snapshot?.policy_digest,
    policy_snapshot_version: executionPackage.policy_snapshot_version,
  });
};

const runtimeSnapshotBlockersForRunSession = (runSession: RunSession): RuntimeSnapshotBlockerRow[] => {
  const blockers: RuntimeSnapshotBlockerRow[] = [];
  const runtimeFinalization = objectRecord(runSession.executor_result?.raw_metadata.runtime_finalization);
  const runtimeBlockers = Array.isArray(runtimeFinalization?.runtime_blockers) ? runtimeFinalization.runtime_blockers : [];
  for (const blocker of runtimeBlockers) {
    const normalized = normalizeRuntimeSnapshotBlocker(objectRecord(blocker) ?? {});
    if (normalized !== undefined) {
      blockers.push(normalized);
    }
  }

  const pathPolicy = objectRecord(runtimeFinalization?.path_policy);
  if (pathPolicy?.ok === false) {
    const diagnosticRef =
      objectRecord(pathPolicy.diagnostic_ref) === undefined
        ? pathPolicy.diagnostic_ref
        : runtimeSnapshotDiagnosticRefFromArtifact(objectRecord(pathPolicy.diagnostic_ref));
    const normalized = normalizeRuntimeSnapshotBlocker({
      code: pathPolicy.blocker_code,
      retryable: true,
      diagnostic_ref: diagnosticRef,
    });
    if (normalized !== undefined) {
      blockers.push(normalized);
    }
  }

  for (const check of runSession.check_results) {
    if (!check.blocks_review || check.status === 'succeeded') {
      continue;
    }
    const normalized = normalizeRuntimeSnapshotBlocker({
      code: check.status === 'timed_out' ? 'required_check_timed_out' : 'required_check_failed',
      retryable: true,
    });
    if (normalized !== undefined) {
      blockers.push(normalized);
    }
  }

  const hasRequiredCheckBlocker = blockers.some(
    (blocker) => blocker.blocked_reason_code === 'required_check_failed' || blocker.blocked_reason_code === 'required_check_timed_out',
  );
  const hasPathPolicyBlocker = blockers.some(
    (blocker) =>
      blocker.blocked_reason_code === 'changed_files_unavailable' ||
      blocker.blocked_reason_code === 'path_policy_actual_changes_rejected',
  );
  const failureMessage = `${runSession.failure_reason ?? ''} ${runSession.executor_result?.failure?.message ?? ''}`.toLowerCase();
  const failureKindCode =
    runSession.failure_kind === 'required_check_failed' && !hasRequiredCheckBlocker
      ? 'required_check_failed'
      : runSession.failure_kind === 'path_violation' && !hasPathPolicyBlocker
        ? failureMessage.includes('changed-file') && failureMessage.includes('unavailable')
          ? 'changed_files_unavailable'
          : 'path_policy_actual_changes_rejected'
        : undefined;
  const failureBlocker = normalizeRuntimeSnapshotBlocker({
    code: failureKindCode,
    retryable: runSession.executor_result?.failure?.retryable ?? false,
  });
  if (failureBlocker !== undefined) {
    blockers.push(failureBlocker);
  }

  return sortRuntimeSnapshotBlockers(blockers);
};

export const runtimeSnapshotBlockersForExecutionPackage = (
  executionPackage: ExecutionPackage,
  runSessions: readonly RunSession[],
): RuntimeSnapshotBlockerRow[] => {
  const blockers: RuntimeSnapshotBlockerRow[] = [];
  const policyBlocker = runtimeSnapshotPackagePolicyBlocker(executionPackage);
  if (policyBlocker !== undefined) {
    blockers.push(policyBlocker);
  }
  const latestRunSession = [...runSessions].sort(
    (left, right) => runSessionRecencyValue(right) - runSessionRecencyValue(left) || codeUnitCompare(right.id, left.id),
  )[0];
  if (latestRunSession !== undefined) {
    blockers.push(...runtimeSnapshotBlockersForRunSession(latestRunSession));
  }
  return sortRuntimeSnapshotBlockers(blockers);
};

export interface RuntimeSnapshotTargetRow {
  target_object_type: string;
  target_object_id: string;
  target_revision_id?: string;
  target_version?: number;
  target_status: string;
  project_id?: string;
  repo_id?: string;
  eligible_repo_ids?: string[];
  automation_scope: AutomationScope;
  active_hold_fingerprint?: string;
  latest_matching_action_status?: string;
  blocked_reason_code?: string;
  blocked_summary?: string;
  blockers?: RuntimeSnapshotBlockerRow[];
  generation_key?: string;
  disabled_reason?: 'run_enqueue_disabled_by_scope';
}

export interface RuntimeSnapshotProjectRow {
  project_id: string;
  automation_scope: AutomationScope;
  automation_settings_version: number;
  capability_fingerprint: string;
}

export interface RuntimeSnapshotRepoRow {
  project_id: string;
  repo_id: string;
  automation_scope: AutomationScope;
  automation_settings_version: number;
  capability_fingerprint: string;
  daemon_internal_local_path: string;
}

export interface RuntimeSnapshotManualHoldRow {
  object_type: string;
  object_id: string;
  scope_key: string;
  reason_code: string;
  status: ManualPathHold['status'];
  requested_at: string;
  resolved_at?: string;
  fingerprint: string;
}

export interface RuntimeSnapshotRepositoryData {
  projects: RuntimeSnapshotProjectRow[];
  repos: RuntimeSnapshotRepoRow[];
  work_items_requiring_spec: RuntimeSnapshotTargetRow[];
  work_items_requiring_plan: RuntimeSnapshotTargetRow[];
  plan_revisions_requiring_packages: RuntimeSnapshotTargetRow[];
  run_enqueue_disabled_packages: RuntimeSnapshotTargetRow[];
  active_holds: RuntimeSnapshotManualHoldRow[];
  recent_action_runs: AutomationActionRun[];
  policy_projection_action_runs: AutomationActionRun[];
}

export interface DeliveryRepository {
  withDeliveryTransaction<T>(write: (repository: DeliveryRepository) => Promise<T>): Promise<T>;
  withObjectLock<T>(key: string, write: (repository: DeliveryRepository) => Promise<T>): Promise<T>;

  createCodexRuntimeProfileWithRevision(
    input: CreateCodexRuntimeProfileWithRevisionInput,
  ): Promise<CodexRuntimeProfileRevision>;
  getActiveCodexRuntimeProfileRevision(
    input: ResolveCodexRuntimeForLaunchInput,
  ): Promise<CodexRuntimeProfileRevision | undefined>;
  createCodexCredentialBindingWithVersion(
    input: CreateCodexCredentialBindingWithVersionInput,
  ): Promise<CodexCredentialBindingVersion>;
  getCodexCredentialBindingPublic(id: string): Promise<CodexCredentialBindingPublic | undefined>;
  resolveCodexCredentialForLaunch(input: ResolveCodexCredentialForLaunchInput): Promise<ResolvedCodexCredential | undefined>;
  getCodexRuntimeStatus(input: GetCodexRuntimeStatusInput): Promise<CodexRuntimeStatusProjection>;
  createCodexWorkerBootstrapToken(input: CreateCodexWorkerBootstrapTokenInput): Promise<CodexWorkerBootstrapToken>;
  upsertCodexWorkerRegistration(input: UpsertCodexWorkerRegistrationInput): Promise<CodexWorkerRegistration>;
  heartbeatCodexWorker(input: HeartbeatCodexWorkerInput): Promise<CodexWorkerRegistration>;
  findAvailableCodexWorker(input: FindAvailableCodexWorkerInput): Promise<CodexWorkerRegistration | undefined>;
  createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(
    input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput,
  ): Promise<CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeResult>;
  pollCodexRuntimeJobs(input: PollCodexRuntimeJobsInput): Promise<CodexRuntimeJob[]>;
  acceptCodexRuntimeJob(input: AcceptCodexRuntimeJobInput): Promise<CodexRuntimeJob>;
  claimCodexLaunchTokenEnvelope(input: ClaimCodexLaunchTokenEnvelopeInput): Promise<CodexLaunchTokenEnvelope>;
  materializeCodexRuntimeJob(input: MaterializeCodexRuntimeJobInput): Promise<CodexLaunchMaterialization>;
  startCodexRuntimeJob(input: StartCodexRuntimeJobInput): Promise<CodexRuntimeJob>;
  appendCodexRuntimeJobEvent(input: AppendCodexRuntimeJobEventInput): Promise<CodexRuntimeJob>;
  cancelCodexRuntimeJob(input: CancelCodexRuntimeJobInput): Promise<CodexRuntimeJob>;
  terminalizeCodexRuntimeJob(input: TerminalizeCodexRuntimeJobInput): Promise<CodexRuntimeJob>;
  recoverStaleCodexRuntimeJobs(input: RecoverStaleCodexRuntimeJobsInput): Promise<RecoverStaleCodexRuntimeJobsResult>;
  getCodexLaunchLeaseStatus(input: GetCodexLaunchLeaseStatusInput): Promise<CodexLaunchLease>;
  createOrReplayCodexLaunchLease(input: CreateOrReplayCodexLaunchLeaseInput): Promise<CodexLaunchLeaseWithToken>;
  materializeCodexLaunchLease(input: MaterializeCodexLaunchLeaseInput): Promise<CodexLaunchMaterialization>;
  terminalizeCodexLaunchLease(input: TerminalizeCodexLaunchLeaseInput): Promise<CodexLaunchLease>;
  revokeCodexLaunchLease(input: RevokeCodexLaunchLeaseInput): Promise<CodexLaunchLease>;
  expireCodexLaunchLeases(now: string): Promise<number>;
  recoverStaleCodexWorkerLeases(input: RecoverStaleCodexWorkerLeasesInput): Promise<CodexRuntimeRecoveryResult>;
  consumeCodexRuntimeSetupNonce(input: ConsumeCodexRuntimeSetupNonceInput): Promise<void>;

  saveOrganization(organization: Organization): Promise<void>;
  getOrganization(organizationId: string): Promise<Organization | undefined>;

  saveActor(actor: Actor): Promise<void>;
  getActor(actorId: string): Promise<Actor | undefined>;
  listActorsForOrganization(organizationId: string): Promise<Actor[]>;

  saveProject(project: Project): Promise<void>;
  getProject(projectId: string): Promise<Project | undefined>;

  saveProjectRepo(projectRepo: ProjectRepo): Promise<void>;
  listProjectRepos(projectId: string): Promise<ProjectRepo[]>;

  saveWorkItem(workItem: WorkItem): Promise<void>;
  getWorkItem(workItemId: string): Promise<WorkItem | undefined>;
  listWorkItems(projectId?: string): Promise<WorkItem[]>;

  saveSpec(spec: Spec): Promise<void>;
  getSpec(specId: string): Promise<Spec | undefined>;
  listSpecs(projectId?: string): Promise<Spec[]>;
  saveSpecRevision(specRevision: SpecRevision): Promise<void>;
  getSpecRevision(specRevisionId: string): Promise<SpecRevision | undefined>;
  listSpecRevisions(specId: string): Promise<SpecRevision[]>;

  savePlan(plan: Plan): Promise<void>;
  getPlan(planId: string): Promise<Plan | undefined>;
  listPlans(projectId?: string): Promise<Plan[]>;
  savePlanRevision(planRevision: PlanRevision): Promise<void>;
  getPlanRevision(planRevisionId: string): Promise<PlanRevision | undefined>;
  listPlanRevisions(planId: string): Promise<PlanRevision[]>;

  saveExecutionPackage(executionPackage: ExecutionPackage): Promise<void>;
  getExecutionPackage(executionPackageId: string): Promise<ExecutionPackage | undefined>;
  listExecutionPackages(projectId?: string): Promise<ExecutionPackage[]>;
  listExecutionPackagesForWorkItem(workItemId: string): Promise<ExecutionPackage[]>;
  saveExecutionPackageDependency(dependency: ExecutionPackageDependency): Promise<void>;
  listExecutionPackageDependencies(executionPackageId: string): Promise<ExecutionPackageDependency[]>;

  saveRunSession(runSession: RunSession): Promise<void>;
  getRunSession(runSessionId: string): Promise<RunSession | undefined>;
  listRunSessions(projectId?: string): Promise<RunSession[]>;
  listRunSessionsForPackage(executionPackageId: string): Promise<RunSession[]>;
  findActiveRunSessionForPackage(executionPackageId: string): Promise<RunSession | undefined>;
  listRecoverableRunSessions(): Promise<RunSession[]>;

  appendRunEvent(event: Omit<RunEvent, 'sequence' | 'cursor'>): Promise<RunEvent>;
  listRunEvents(runSessionId: string, options?: { after?: string; limit?: number }): Promise<RunEvent[]>;
  getLatestRunEvent(runSessionId: string): Promise<RunEvent | undefined>;
  appendWorkerRunEvent(
    event: Omit<RunEvent, 'sequence' | 'cursor'>,
    lease: { workerId: string; leaseToken: string },
  ): Promise<RunEvent>;

  saveRunCommand(command: RunCommand): Promise<void>;
  claimNextRunCommand(
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    now: string,
    options?: { reclaim_claimed_before?: string },
  ): Promise<{ command: RunCommand; reclaimed: boolean } | undefined>;
  recordRunCommandDriverAck(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    driverAck: Record<string, unknown>,
    acknowledgedAt: string,
  ): Promise<void>;
  markRunCommandApplied(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    appliedAt: string,
    driverAck: Record<string, unknown>,
  ): Promise<void>;
  markRunCommandFailed(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    failureReason: string,
    failedAt: string,
  ): Promise<void>;
  supersedePendingRunCommands(runSessionId: string, commandTypes: RunCommand['command_type'][], now: string): Promise<void>;
  supersedePendingRunCommandsForWorker(
    runSessionId: string,
    commandTypes: RunCommand['command_type'][],
    lease: { workerId: string; leaseToken: string },
    now: string,
  ): Promise<void>;

  claimRunWorkerLease(input: {
    run_session_id: string;
    worker_id: string;
    lease_token: string;
    now: string;
    expires_at: string;
  }): Promise<RunWorkerLease>;
  heartbeatRunWorkerLease(
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    heartbeatAt: string,
    expiresAt: string,
  ): Promise<void>;
  getRunWorkerLease(runSessionId: string): Promise<RunWorkerLease | undefined>;
  releaseRunWorkerLease(runSessionId: string, workerId: string, leaseToken: string, releasedAt: string): Promise<void>;
  assertActiveRunWorkerLease(runSessionId: string, workerId: string, leaseToken: string, now: string): Promise<void>;
  withActiveRunWorkerLease<T>(
    runSessionId: string,
    lease: { workerId: string; leaseToken: string; now: string },
    write: (repository: DeliveryRepository) => Promise<T>,
  ): Promise<T>;

  saveReviewPacket(reviewPacket: ReviewPacket): Promise<void>;
  getReviewPacket(reviewPacketId: string): Promise<ReviewPacket | undefined>;
  listReviewPackets(projectId?: string): Promise<ReviewPacket[]>;
  listReviewPacketsForPackage(executionPackageId: string): Promise<ReviewPacket[]>;
  findOpenReviewPacketForPackage(executionPackageId: string): Promise<ReviewPacket | undefined>;

  resolveAutomationProjectSettings(input: ResolveAutomationProjectSettingsInput): Promise<AutomationProjectSettings>;
  setAutomationProjectSettings(input: SetAutomationProjectSettingsInput): Promise<AutomationProjectSettings>;
  disableAutomationProjectSettings(input: DisableAutomationProjectSettingsInput): Promise<AutomationProjectSettings>;
  getManualPathHold(holdId: string): Promise<ManualPathHold | undefined>;
  listActiveManualPathHolds(input: ListActiveManualPathHoldsInput): Promise<ManualPathHold[]>;
  requestManualPathHold(input: RequestManualPathHoldInput): Promise<ManualPathHold>;
  resolveManualPathHold(input: ResolveManualPathHoldInput): Promise<ManualPathHold>;
  claimCommandIdempotency(input: ClaimCommandIdempotencyInput): Promise<CommandIdempotencyRecord>;
  renewCommandIdempotency(input: RenewCommandIdempotencyInput): Promise<CommandIdempotencyRecord>;
  completeCommandIdempotency(input: FinishCommandIdempotencyInput): Promise<CommandIdempotencyRecord>;
  failCommandIdempotency(input: FinishCommandIdempotencyInput): Promise<CommandIdempotencyRecord>;
  blockCommandIdempotency(input: FinishCommandIdempotencyInput): Promise<CommandIdempotencyRecord>;
  claimExecutionPackageGenerationRun(input: ClaimExecutionPackageGenerationRunInput): Promise<ExecutionPackageGenerationRun>;
  saveExecutionPackageGenerationPackage(input: SaveExecutionPackageGenerationPackageInput): Promise<void>;
  completeExecutionPackageGenerationRun(
    input: CompleteExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun>;
  getExecutionPackageGenerationRun(
    input: GetExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun | undefined>;
  supersedeExecutionPackageGenerationRun(
    input: SupersedeExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun>;
  createOrReplayAutomationActionRun(input: CreateOrReplayAutomationActionRunInput): Promise<AutomationActionRun>;
  claimNextAutomationActionRun(input: ClaimNextAutomationActionRunInput): Promise<AutomationActionRun | undefined>;
  getClaimedAutomationActionRun(input: GetClaimedAutomationActionRunInput): Promise<AutomationActionRun>;
  latestCompletedProjectionActionRun(
    input: LatestCompletedProjectionActionRunInput,
  ): Promise<AutomationActionRun | undefined>;
  claimAutomationActionRun(input: ClaimAutomationActionRunInput): Promise<AutomationActionRun>;
  completeAutomationActionRun(input: CompleteAutomationActionRunInput): Promise<AutomationActionRun>;
  markAutomationActionGatePending(input: MarkAutomationActionGatePendingInput): Promise<AutomationActionRun>;
  listClaimableAutomationActionRuns(input: ListClaimableAutomationActionRunsInput): Promise<AutomationActionRun[]>;
  getRuntimeSnapshotData(): Promise<RuntimeSnapshotRepositoryData>;

  saveRelease(release: Release): Promise<void>;
  getRelease(releaseId: string): Promise<Release | undefined>;
  listReleases(projectId?: string): Promise<Release[]>;
  saveReleaseWorkItem(releaseWorkItem: ReleaseWorkItemRecord): Promise<void>;
  listReleaseWorkItems(releaseId: string): Promise<ReleaseWorkItemRecord[]>;
  saveReleaseExecutionPackage(releaseExecutionPackage: ReleaseExecutionPackageRecord): Promise<void>;
  listReleaseExecutionPackages(releaseId: string): Promise<ReleaseExecutionPackageRecord[]>;
  saveReleaseEvidence(releaseEvidence: ReleaseEvidence): Promise<void>;
  getReleaseEvidence(releaseEvidenceId: string): Promise<ReleaseEvidence | undefined>;
  listReleaseEvidences(releaseId: string): Promise<ReleaseEvidence[]>;

  appendObjectEvent(objectEvent: ObjectEvent): Promise<void>;
  listObjectEvents(objectId: string, objectType?: string): Promise<ObjectEvent[]>;

  appendStatusHistory(statusHistory: StatusHistory): Promise<void>;
  listStatusHistory(objectId: string, objectType?: string): Promise<StatusHistory[]>;

  saveArtifact(artifact: Artifact): Promise<void>;
  listArtifactsForObject(objectType: string, objectId: string): Promise<Artifact[]>;

  saveDecision(decision: Decision): Promise<void>;
  listDecisionsForObject(objectType: string, objectId: string): Promise<Decision[]>;

  saveTraceEvent(traceEvent: TraceEventRecord): Promise<void>;
  listTraceEventsForSubject(subjectType: string, subjectId: string): Promise<TraceEventRecord[]>;
  saveTraceLink(traceLink: TraceLinkRecord): Promise<void>;
  listTraceLinks(traceEventId: string): Promise<TraceLinkRecord[]>;
  saveTraceArtifactRef(traceArtifactRef: TraceArtifactRefRecord): Promise<void>;
  listTraceArtifactRefs(traceEventId: string): Promise<TraceArtifactRefRecord[]>;
}
