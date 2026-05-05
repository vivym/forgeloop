import type {
  ArtifactKind,
  ArtifactRef,
  CheckResult,
  ExecutorType,
  RequiredCheckSpec,
  RequestedChange,
} from '@forgeloop/contracts';

export type DomainErrorCode =
  | 'INVALID_TRANSITION'
  | 'REPO_NOT_BOUND'
  | 'PROJECT_MISMATCH'
  | 'PACKAGE_MULTIPLE_REPOS'
  | 'REQUIRED_CHECK_MISSING'
  | 'OWNER_REQUIRED'
  | 'REVIEWER_REQUIRED'
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
  project_id: string;
  local_path: string;
  default_branch: string;
  remote_url?: string;
  base_commit_sha?: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export type WorkItemPhase = 'draft' | 'triage' | 'spec' | 'plan' | 'execution' | 'done';
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
  title: string;
  owner_actor_id: string;
  phase: WorkItemPhase;
  activity_state: WorkItemActivityState;
  gate_state: WorkItemGateState;
  resolution: WorkItemResolution;
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
  project_id: string;
  repo_id: string;
  objective: string;
  owner_actor_id: string;
  reviewer_actor_id: string;
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

export type RunSessionStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled';

export interface RunSession {
  id: string;
  execution_package_id: string;
  requested_by_actor_id: string;
  status: RunSessionStatus;
  executor_type?: ExecutorType;
  check_results: CheckResult[];
  artifacts: ArtifactRef[];
  summary?: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  started_at?: IsoDateTime;
  finished_at?: IsoDateTime;
}

export type ReviewPacketStatus = 'ready' | 'in_review' | 'completed' | 'archived';
export type ReviewPacketDecision = 'none' | 'approved' | 'changes_requested';

export interface ReviewPacket {
  id: string;
  run_session_id: string;
  execution_package_id: string;
  reviewer_actor_id: string;
  status: ReviewPacketStatus;
  decision: ReviewPacketDecision;
  summary?: string;
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
