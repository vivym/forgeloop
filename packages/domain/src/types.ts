import {
  releaseActivityStates as contractReleaseActivityStates,
  releaseBlockerCodes as contractReleaseBlockerCodes,
  releaseEvidenceObjectTypes as contractReleaseEvidenceObjectTypes,
  releaseEvidenceRelationships as contractReleaseEvidenceRelationships,
  releaseEvidenceTypes as contractReleaseEvidenceTypes,
  releaseGateStates as contractReleaseGateStates,
  releasePhases as contractReleasePhases,
  releaseResolutions as contractReleaseResolutions,
  reviewPacketDecisions as contractReviewPacketDecisions,
  type ArtifactKind,
  type ArtifactRef,
  type ChangedFile,
  type CheckResult,
  type ExecutorResult,
  type ExecutorType,
  type FailureKind,
  type IndependentAiReviewResult,
  type RequiredCheckSpec,
  type ReviewPacketTestMapping,
  type RequestedChange,
  type RunCommandType,
  type RunEventSource,
  type RunEventType,
  type RunEventVisibility,
  type RunSpec,
  type SelfReviewResult,
  type WorkItemIntakeContext,
} from '@forgeloop/contracts';
import type { PackageRuntimePolicySnapshot, SourceMutationPolicy, ValidationStrategy } from './automation.js';

export type DomainErrorCode =
  | 'INVALID_TRANSITION'
  | 'REPO_NOT_BOUND'
  | 'PROJECT_MISMATCH'
  | 'PACKAGE_MULTIPLE_REPOS'
  | 'REQUIRED_CHECK_MISSING'
  | 'OWNER_REQUIRED'
  | 'REVIEWER_REQUIRED'
  | 'QA_OWNER_REQUIRED'
  | 'DEPENDENCY_CYCLE'
  | 'EXECUTION_OBJECTIVE_REQUIRED'
  | 'EDIT_NOT_ALLOWED'
  | 'FORCE_RERUN_FORBIDDEN'
  | 'COMPLETION_BLOCKED'
  | 'AUTOMATION_CAPABILITY_REJECTED'
  | 'MANUAL_PATH_SCOPE_INVALID'
  | 'EXECUTION_PACKAGE_VERSION_INVALID'
  | 'EXECUTION_PACKAGE_POLICY_INVALID'
  | 'codex_runtime_profile_invalid'
  | 'codex_worker_docker_policy_unavailable'
  | 'codex_docker_runtime_evidence_unsafe'
  | 'codex_app_server_effective_config_mismatch'
  | 'codex_worker_nonce_replay'
  | 'codex_worker_registration_denied'
  | 'codex_runtime_job_unavailable'
  | 'codex_launch_lease_denied'
  | 'codex_launch_materialization_denied'
  | 'workflow_invalid_transition'
  | 'workflow_evidence_missing'
  | 'workflow_evidence_type_invalid'
  | 'workflow_evidence_not_owned'
  | 'workflow_actor_not_authorized'
  | 'workflow_active_session_missing'
  | 'workflow_active_session_conflict'
  | 'codex_session_lease_conflict'
  | 'codex_session_lease_expired'
  | 'codex_session_stale_terminalization'
  | 'codex_session_snapshot_stale'
  | 'codex_session_thread_binding_conflict'
  | 'codex_session_thread_binding_partial'
  | 'codex_session_thread_digest_mismatch'
  | 'codex_session_thread_binding_stale'
  | 'codex_app_server_thread_id_missing'
  | 'codex_session_runner_unavailable'
  | 'codex_session_fork_invalid'
  | 'codex_generation_workload_unsupported'
  | 'workflow_legacy_entrypoint_disabled';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DomainErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export type IsoDateTime = string;
export type RequiredTestGateSpec = Record<string, unknown>;

export interface WorkflowPersistenceRefs {
  workflow_id?: string;
  codex_session_id?: string;
  codex_session_turn_id?: string;
}

export interface Project {
  id: string;
  org_id?: string;
  key?: string;
  name: string;
  repo_ids: string[];
  owner_actor_id?: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface ProjectRepo {
  id: string;
  repo_id: string;
  org_id?: string;
  project_id: string;
  name: string;
  status: 'active' | 'paused' | 'archived';
  local_path: string;
  default_branch: string;
  remote_url?: string;
  base_commit_sha: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export const workItemKinds = ['initiative', 'requirement', 'bug', 'tech_debt'] as const;
export type WorkItemKind = (typeof workItemKinds)[number];

export const workItemPhases = [
  'draft',
  'triage',
  'spec',
  'plan',
  'execution',
  'release',
  'observing',
  'done',
  'closed',
] as const;
export type WorkItemPhase = (typeof workItemPhases)[number];

export type WorkItemActivityState = 'idle' | 'awaiting_ai';
export type WorkItemGateState =
  | 'none'
  | 'awaiting_spec_approval'
  | 'spec_changes_requested'
  | 'awaiting_plan_approval'
  | 'plan_changes_requested';
export type WorkItemResolution = 'none' | 'completed';

export interface WorkItem {
  id: string;
  project_id: string;
  kind: WorkItemKind;
  title: string;
  narrative_markdown: string;
  goal: string;
  success_criteria: string[];
  priority: string;
  risk: string;
  driver_actor_id: string;
  intake_context: WorkItemIntakeContext;
  phase: WorkItemPhase;
  activity_state: WorkItemActivityState;
  gate_state: WorkItemGateState;
  resolution: WorkItemResolution;
  current_spec_id?: string;
  current_spec_revision_id?: string;
  current_plan_id?: string;
  current_plan_revision_id?: string;
  current_release_id?: string;
  archived_at?: IsoDateTime;
  deleted_at?: IsoDateTime;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export type SpecPlanEntityType = 'spec' | 'plan';
export type SpecPlanStatus = 'draft' | 'in_review' | 'approved';
export type SpecPlanEditingState = 'idle' | 'ai_drafting';
export type SpecPlanGateState = 'not_submitted' | 'awaiting_approval' | 'approved' | 'changes_requested';
export type SpecPlanResolution = 'none' | 'approved';

export interface SpecPlanBase {
  id: string;
  work_item_id: string;
  development_plan_item_id?: string;
  workflow_id?: string;
  boundary_summary_id?: string;
  context_manifest_id?: string;
  entity_type: SpecPlanEntityType;
  status: SpecPlanStatus;
  editing_state: SpecPlanEditingState;
  gate_state: SpecPlanGateState;
  resolution: SpecPlanResolution;
  current_revision_id?: string;
  approved_revision_id?: string;
  approved_at?: IsoDateTime;
  approved_by_actor_id?: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface Spec extends SpecPlanBase {
  entity_type: 'spec';
}

export interface Plan extends SpecPlanBase {
  entity_type: 'plan';
}

export type SpecPlan = Spec | Plan;

export interface SpecRevision {
  id: string;
  spec_id: string;
  work_item_id: string;
  development_plan_item_id?: string;
  workflow_id?: string;
  codex_session_id?: string;
  codex_session_turn_id?: string;
  boundary_summary_id?: string;
  context_manifest_id?: string;
  revision_number: number;
  summary: string;
  content: string;
  background: string;
  goals: string[];
  scope_in: string[];
  scope_out: string[];
  acceptance_criteria: string[];
  risk_notes: string[];
  test_strategy_summary: string;
  qa_owner_actor_id?: string;
  test_owner_actor_id?: string;
  testability_note?: string;
  risk_scenarios?: string[];
  structured_document?: Record<string, unknown>;
  author_actor_id?: string;
  artifact_refs: ArtifactRef[];
  created_at: IsoDateTime;
}

export interface PlanRevision {
  id: string;
  plan_id: string;
  work_item_id: string;
  based_on_spec_revision_id?: string;
  revision_number: number;
  summary: string;
  content: string;
  implementation_summary: string;
  split_strategy: string;
  dependency_order: string[];
  test_matrix: string[];
  risk_mitigations: string[];
  rollback_notes: string;
  structured_document?: Record<string, unknown>;
  author_actor_id?: string;
  artifact_refs: ArtifactRef[];
  created_at: IsoDateTime;
}

export const executionPackagePhases = [
  'draft',
  'ready',
  'queued',
  'execution',
  'review',
  'integration',
  'test_gate',
  'release',
  'archived',
] as const;
export type ExecutionPackagePhase = (typeof executionPackagePhases)[number];

export const executionPackageActivityStates = [
  'idle',
  'ai_running',
  'ai_retrying',
  'human_editing',
  'awaiting_human',
  'human_reviewing',
  'blocked',
  'handover',
] as const;
export type ExecutionPackageActivityState = (typeof executionPackageActivityStates)[number];

export const executionPackageGateStates = [
  'not_submitted',
  'self_review_pending',
  'awaiting_human_review',
  'changes_requested',
  'review_approved',
  'integration_failed',
  'integration_passed',
  'test_failed',
  'test_passed',
  'release_ready',
  'released',
] as const;
export type ExecutionPackageGateState = (typeof executionPackageGateStates)[number];

export type ExecutionPackageResolution = 'none' | 'completed';

export interface ExecutionPackage {
  id: string;
  task_id?: string;
  work_item_id: string;
  development_plan_item_id?: string;
  workflow_id?: string;
  codex_session_id?: string;
  codex_session_turn_id?: string;
  execution_id?: string;
  spec_id: string;
  spec_revision_id: string;
  execution_plan_id?: string;
  execution_plan_revision_id?: string;
  plan_id: string;
  plan_revision_id: string;
  project_id: string;
  repo_id: string;
  objective: string;
  owner_actor_id: string;
  reviewer_actor_id: string;
  qa_owner_actor_id: string;
  phase: ExecutionPackagePhase;
  activity_state: ExecutionPackageActivityState;
  gate_state: ExecutionPackageGateState;
  resolution: ExecutionPackageResolution;
  required_checks: RequiredCheckSpec[];
  required_test_gates?: RequiredTestGateSpec[];
  required_artifact_kinds: ArtifactKind[];
  allowed_paths: string[];
  forbidden_paths: string[];
  source_mutation_policy: SourceMutationPolicy;
  version: number;
  execution_package_set_id?: string;
  execution_package_version?: number;
  generation_key?: string;
  package_key?: string;
  sequence?: number;
  manifest_digest?: string;
  validation_strategy?: ValidationStrategy;
  validation_strategy_version?: number;
  validation_rationale?: string;
  validation_approved_by?: string;
  validation_approved_at?: IsoDateTime;
  validation_evidence_refs?: ArtifactRef[];
  validation_public_summary?: string;
  policy_snapshot_status?: 'captured' | 'missing' | 'stale' | 'superseded';
  policy_snapshot_version?: number;
  package_policy_snapshot?: PackageRuntimePolicySnapshot;
  last_run_session_id?: string;
  current_run_session_id?: string;
  current_review_packet_id?: string;
  current_release_id?: string;
  integration_readiness?: Record<string, unknown>;
  last_failure_summary?: string;
  blocked_reason?: string;
  archived_at?: IsoDateTime;
  deleted_at?: IsoDateTime;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface ExecutionPackageDependency {
  package_id: string;
  depends_on_package_id: string;
  dependency_type?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  created_at?: IsoDateTime;
  updated_at?: IsoDateTime;
}

export type RunSessionStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_input'
  | 'stalled'
  | 'resuming'
  | 'cancel_requested'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

export type RunDriverKind = 'app_server' | 'exec_fallback' | 'fake';
export type RunDriverStatus = 'not_started' | 'starting' | 'active' | 'waiting_for_input' | 'stalled' | 'terminal';
export type EffectiveDangerousMode = 'confirmed' | 'unconfirmed' | 'not_requested';

export interface RunRuntimeMetadata {
  durability_mode: 'durable' | 'volatile_demo';
  driver_kind?: RunDriverKind;
  driver_status?: RunDriverStatus;
  codex_thread_id?: string;
  active_turn_id?: string;
  workspace_path?: string;
  app_server_endpoint?: string;
  worker_id?: string;
  worker_lease_status?: RunWorkerLeaseStatus;
  worker_lease_heartbeat_at?: IsoDateTime;
  worker_lease_expires_at?: IsoDateTime;
  last_event_cursor?: string;
  last_event_at?: IsoDateTime;
  recovery_attempt_count: number;
  effective_dangerous_mode: EffectiveDangerousMode;
  app_server_attempted?: boolean;
  selected_execution_mode?: 'app_server' | 'exec_fallback' | 'fake';
  app_server_fallback_reason?: string;
  exec_fallback_dangerous_bypass?: boolean;
  source_repo_path?: string;
  source_repo_before_status?: string;
  source_repo_before_dirty_fingerprint?: string;
  runtime_profile_id?: string;
  runtime_profile_revision_id?: string;
  runtime_profile_digest?: string;
  runtime_target_kind?: 'generation' | 'run_execution';
  source_access_mode?: 'artifact_only' | 'path_policy_scoped';
  environment?: 'local_dogfood' | 'test';
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
  remote_runtime_job_id?: string;
  remote_runtime_job_created?: boolean;
  remote_run_worker_lease_id?: string;
  remote_workspace_bundle_id?: string;
  remote_workspace_bundle_artifact_record_id?: string;
  remote_workspace_bundle_artifact_request_digest?: string;
  remote_workspace_bundle_created_at?: IsoDateTime;
  remote_workspace_internal_artifact_object_id?: string;
  remote_workspace_bundle_digest?: string;
  remote_workspace_manifest_digest?: string;
  remote_workspace_bundle_size_bytes?: number;
  remote_workspace_bundle_expires_at?: IsoDateTime;
  remote_workspace_acquisition_digest?: string;
  remote_workspace_acquisition_json?: Record<string, unknown>;
}

export interface RunSession {
  id: string;
  execution_package_id: string;
  workflow_id?: string;
  codex_session_id?: string;
  codex_session_turn_id?: string;
  requested_by_actor_id: string;
  status: RunSessionStatus;
  executor_type?: ExecutorType;
  executor_result?: ExecutorResult;
  run_spec?: RunSpec;
  changed_files: ChangedFile[];
  check_results: CheckResult[];
  artifacts: ArtifactRef[];
  log_refs: ArtifactRef[];
  summary?: string;
  failure_kind?: FailureKind;
  failure_reason?: string;
  runtime_metadata?: RunRuntimeMetadata;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  started_at?: IsoDateTime;
  finished_at?: IsoDateTime;
}

export interface RequiredArtifactPresence {
  required_artifact_kinds: ArtifactKind[];
  present_artifact_kinds: ArtifactKind[];
  missing_artifact_kinds: ArtifactKind[];
}

export interface RunEvent {
  id: string;
  run_session_id: string;
  sequence: number;
  cursor: string;
  event_type: RunEventType;
  source: RunEventSource;
  visibility: RunEventVisibility;
  summary: string;
  payload: Record<string, unknown>;
  raw_ref?: string;
  created_at: IsoDateTime;
}

export interface RunCommand {
  id: string;
  run_session_id: string;
  command_type: RunCommandType;
  status: 'pending' | 'claimed' | 'applied' | 'failed' | 'superseded';
  actor_id: string;
  payload: Record<string, unknown>;
  target_thread_id?: string;
  target_turn_id?: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  claimed_by_worker_id?: string;
  claimed_at?: IsoDateTime;
  applied_at?: IsoDateTime;
  failure_reason?: string;
  driver_ack?: Record<string, unknown>;
}

export type RunWorkerLeaseStatus = 'active' | 'released' | 'expired';

export interface RunWorkerLease {
  id: string;
  run_session_id: string;
  worker_id: string;
  lease_token: string;
  heartbeat_at: IsoDateTime;
  expires_at: IsoDateTime;
  status: RunWorkerLeaseStatus;
}

export type ReviewPacketStatus = 'draft' | 'ready' | 'in_review' | 'completed' | 'escalated' | 'archived';
export const reviewPacketDecisions = contractReviewPacketDecisions;
export type ReviewPacketDecision = (typeof reviewPacketDecisions)[number];

export interface ReviewPacket {
  id: string;
  run_session_id: string;
  execution_package_id: string;
  workflow_id?: string;
  codex_session_id?: string;
  codex_session_turn_id?: string;
  reviewer_actor_id: string;
  spec_revision_id: string;
  plan_revision_id: string;
  status: ReviewPacketStatus;
  decision: ReviewPacketDecision;
  summary?: string;
  changed_files: ChangedFile[];
  check_result_summary: string;
  self_review: SelfReviewResult;
  independent_ai_review?: IndependentAiReviewResult;
  test_mapping?: ReviewPacketTestMapping[];
  risk_notes: string[];
  reviewed_by_actor_id?: string;
  reviewed_at?: IsoDateTime;
  requested_changes: RequestedChange[];
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  completed_at?: IsoDateTime;
}

export interface ObjectEvent {
  id: string;
  object_type: string;
  object_id: string;
  event_type: string;
  actor_type?: 'human' | 'ai' | 'system';
  actor_id?: string;
  reason?: string;
  payload?: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: IsoDateTime;
}

export interface StatusHistory {
  id: string;
  object_type: string;
  object_id: string;
  field_name?: string;
  from_status?: string;
  to_status: string;
  from_value?: string;
  to_value?: string;
  actor_type?: 'human' | 'ai' | 'system';
  actor_id?: string;
  reason?: string;
  context?: Record<string, unknown>;
  created_at: IsoDateTime;
}

export interface Artifact {
  id: string;
  object_type: string;
  object_id: string;
  trace_subject_type?: string;
  trace_subject_id?: string;
  artifact_type?: string;
  ref: ArtifactRef;
  created_at: IsoDateTime;
}

export interface Decision {
  id: string;
  object_type: string;
  object_id: string;
  actor_id: string;
  decided_by_actor_id?: string;
  decision_type?: string;
  outcome?: string;
  decision:
    | 'approved'
    | 'changes_requested'
    | 'need_more_context'
    | 'escalate'
    | 'rejected'
    | 'override_approved'
    | 'completed'
    | 'rolled_back'
    | 'cancelled';
  summary: string;
  rationale?: string;
  evidence_refs?: unknown;
  created_at: IsoDateTime;
}

export interface Organization {
  id: string;
  name: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface Actor {
  id: string;
  org_id: string;
  display_name: string;
  actor_type: 'human' | 'system' | 'ai';
  email?: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export const releasePhases = contractReleasePhases;
export type ReleasePhase = (typeof releasePhases)[number];

export const releaseActivityStates = contractReleaseActivityStates;
export type ReleaseActivityState = (typeof releaseActivityStates)[number];

export const releaseGateStates = contractReleaseGateStates;
export type ReleaseGateState = (typeof releaseGateStates)[number];

export const releaseResolutions = contractReleaseResolutions;
export type ReleaseResolution = (typeof releaseResolutions)[number];

export const releaseEvidenceTypes = contractReleaseEvidenceTypes;
export type ReleaseEvidenceType = (typeof releaseEvidenceTypes)[number];

export const releaseEvidenceObjectTypes = contractReleaseEvidenceObjectTypes;
export type ReleaseEvidenceObjectType = (typeof releaseEvidenceObjectTypes)[number];

export const releaseEvidenceRelationships = contractReleaseEvidenceRelationships;
export type ReleaseEvidenceRelationship = (typeof releaseEvidenceRelationships)[number];

export interface ReleaseEvidenceObjectRef {
  object_type: ReleaseEvidenceObjectType;
  object_id: string;
  relationship: ReleaseEvidenceRelationship;
}

export interface ReleaseEvidence {
  id: string;
  org_id?: string;
  project_id?: string;
  release_id: string;
  key?: string;
  title?: string;
  description?: string;
  evidence_type: ReleaseEvidenceType;
  summary: string;
  object_ref?: ReleaseEvidenceObjectRef;
  artifact_id?: string;
  extra?: Record<string, unknown>;
  redacted: boolean;
  status: 'current' | 'stale' | 'superseded';
  visibility?: string;
  source_type?: string;
  labels?: string[];
  created_at: IsoDateTime;
  created_by_actor_id?: string;
  updated_at?: IsoDateTime;
  updated_by_actor_id?: string;
}

export interface Release {
  id: string;
  org_id: string;
  project_id: string;
  key?: string;
  title: string;
  description?: string;
  scope_summary?: string;
  phase: ReleasePhase;
  activity_state: ReleaseActivityState;
  gate_state: ReleaseGateState;
  resolution: ReleaseResolution;
  work_item_ids: string[];
  execution_package_ids: string[];
  current_review_packet_ids?: string[];
  current_run_session_ids?: string[];
  rollout_strategy?: string;
  rollback_plan?: string;
  observation_plan?: string;
  release_owner_actor_id?: string;
  release_type?: string;
  visibility?: string;
  labels?: string[];
  extra?: Record<string, unknown>;
  created_by_actor_id: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  updated_by_actor_id?: string;
  closed_at?: IsoDateTime;
}

export interface ReleaseWorkItem {
  release_id: string;
  work_item_id: string;
}

export interface ReleaseExecutionPackage {
  release_id: string;
  execution_package_id: string;
}

export const releaseBlockerCodes = contractReleaseBlockerCodes;
export type ReleaseBlockerCode = (typeof releaseBlockerCodes)[number];

export type ReleaseBlockerCategory = 'structural' | 'risk' | 'evidence' | 'planning';

export interface ReleaseBlocker {
  code: ReleaseBlockerCode;
  category: ReleaseBlockerCategory;
  overrideable: boolean;
  message: string;
  object_type?: string;
  object_id?: string;
}

export interface ReleaseBlockerSnapshot {
  release_id: string;
  generated_at: IsoDateTime;
  blocker_fingerprint: string;
  blockers: ReleaseBlocker[];
}

export interface ReleaseDecisionIntent {
  object_type: 'release';
  object_id: string;
  actor_id: string;
  decision_type: 'manual_override' | 'release_approval' | 'release_changes_requested' | 'release_close';
  outcome: 'approved' | 'changes_requested' | 'override_approved' | 'completed' | 'rolled_back' | 'cancelled';
  reason?: string;
  blocker_snapshot?: ReleaseBlockerSnapshot;
}
