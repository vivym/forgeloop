import type {
  ArtifactKind,
  ArtifactRef,
  ChangedFile,
  CheckResult,
  ExecutorResult,
  ExecutorType,
  FailureKind,
  RequiredCheckSpec,
  RequestedChange,
  RunCommandType,
  RunEventSource,
  RunEventType,
  RunEventVisibility,
  RunSpec,
  SelfReviewResult,
} from '@forgeloop/contracts';

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
  | 'COMPLETION_BLOCKED';

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

export interface Project {
  id: string;
  name: string;
  repo_ids: string[];
  owner_actor_id?: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface ProjectRepo {
  id: string;
  repo_id: string;
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

export type WorkItemPhase = 'draft' | 'triage' | 'spec' | 'plan' | 'execution' | 'done';
export type WorkItemKind = 'feature' | 'bugfix' | 'tech_debt' | 'test_refactor';
export type WorkItemActivityState = 'idle';
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
  goal: string;
  success_criteria: string[];
  priority: string;
  risk: string;
  owner_actor_id: string;
  phase: WorkItemPhase;
  activity_state: WorkItemActivityState;
  gate_state: WorkItemGateState;
  resolution: WorkItemResolution;
  current_spec_id?: string;
  current_plan_id?: string;
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
  entity_type: SpecPlanEntityType;
  status: SpecPlanStatus;
  editing_state: SpecPlanEditingState;
  gate_state: SpecPlanGateState;
  resolution: SpecPlanResolution;
  current_revision_id?: string;
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
  structured_document?: Record<string, unknown>;
  author_actor_id?: string;
  artifact_refs: ArtifactRef[];
  created_at: IsoDateTime;
}

export interface PlanRevision {
  id: string;
  plan_id: string;
  work_item_id: string;
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

export type ExecutionPackagePhase = 'draft' | 'ready' | 'queued' | 'execution' | 'review';
export type ExecutionPackageActivityState = 'idle' | 'awaiting_ai' | 'ai_running' | 'blocked' | 'awaiting_human';
export type ExecutionPackageGateState =
  | 'none'
  | 'not_submitted'
  | 'awaiting_human_review'
  | 'review_approved'
  | 'changes_requested';
export type ExecutionPackageResolution = 'none' | 'completed';

export interface ExecutionPackage {
  id: string;
  work_item_id: string;
  spec_id: string;
  spec_revision_id: string;
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
  required_artifact_kinds: ArtifactKind[];
  allowed_paths: string[];
  forbidden_paths: string[];
  last_run_session_id?: string;
  last_failure_summary?: string;
  blocked_reason?: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface ExecutionPackageDependency {
  package_id: string;
  depends_on_package_id: string;
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
}

export interface RunSession {
  id: string;
  execution_package_id: string;
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

export type ReviewPacketStatus = 'ready' | 'in_review' | 'completed' | 'archived';
export type ReviewPacketDecision = 'none' | 'approved' | 'changes_requested';

export interface ReviewPacket {
  id: string;
  run_session_id: string;
  execution_package_id: string;
  reviewer_actor_id: string;
  spec_revision_id: string;
  plan_revision_id: string;
  status: ReviewPacketStatus;
  decision: ReviewPacketDecision;
  summary?: string;
  changed_files: ChangedFile[];
  check_result_summary: string;
  self_review: SelfReviewResult;
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
  actor_id?: string;
  metadata: Record<string, unknown>;
  created_at: IsoDateTime;
}

export interface StatusHistory {
  id: string;
  object_type: string;
  object_id: string;
  from_status?: string;
  to_status: string;
  actor_id?: string;
  reason?: string;
  created_at: IsoDateTime;
}

export interface Artifact {
  id: string;
  object_type: string;
  object_id: string;
  trace_subject_type?: string;
  trace_subject_id?: string;
  ref: ArtifactRef;
  created_at: IsoDateTime;
}

export interface Decision {
  id: string;
  object_type: string;
  object_id: string;
  actor_id: string;
  decision: 'approved' | 'changes_requested';
  summary: string;
  created_at: IsoDateTime;
}
