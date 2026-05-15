import type { input as zInput } from 'zod';

import type {
  ApproveReleaseRequest,
  closeReleaseRequestSchema,
  createReleaseEvidenceRequestSchema,
  createReleaseRequestSchema,
  LinkReleaseObjectRequest,
  OverrideApproveReleaseRequest,
  PatchReleaseRequest,
  ReleaseActorCommandRequest,
  releaseListQuerySchema,
  RequestReleaseChangesRequest,
} from '@forgeloop/contracts';

export type {
  ApproveReleaseRequest,
  CloseReleaseRequest,
  CreateReleaseEvidenceRequest,
  CreateReleaseRequest,
  EvidenceChainItem,
  EvidenceChainObjectRef,
  EvidenceChainRedactionReason,
  EvidenceChainResponse,
  EvidenceChainRiskFlag,
  LinkReleaseObjectRequest,
  LinkReleaseObjectResponse,
  OverrideApproveReleaseRequest,
  PatchReleaseRequest,
  PublicReleaseSummary as ReleaseSummary,
  ReleaseActorCommandRequest,
  ReleaseBlocker,
  ReleaseBlockerSnapshot,
  ReleaseChecklistItem,
  ReleaseCockpitResponse,
  ReleaseControlResponse,
  ReleaseEvidence,
  ReleaseEvidenceObjectRef,
  ReleaseListQuery,
  ReleaseListResponse,
  ReleaseResourceResponse,
  RequestReleaseChangesRequest,
  StartReleaseObservingRequest,
  SubmitReleaseForApprovalRequest,
  UnlinkReleaseObjectRequest,
} from '@forgeloop/contracts';

export type CreateReleaseBody = zInput<typeof createReleaseRequestSchema>;
export type PatchReleaseBody = PatchReleaseRequest;
export type ReleaseCommandBody = ReleaseActorCommandRequest;
export type ApproveReleaseBody = ApproveReleaseRequest;
export type OverrideApproveReleaseBody = OverrideApproveReleaseRequest;
export type RequestReleaseChangesBody = RequestReleaseChangesRequest;
export type StartReleaseObservingBody = ReleaseActorCommandRequest;
export type CloseReleaseBody = zInput<typeof closeReleaseRequestSchema>;
export type CreateReleaseEvidenceBody = zInput<typeof createReleaseEvidenceRequestSchema>;
export type LinkReleaseScopeBody = LinkReleaseObjectRequest;
export type UnlinkReleaseScopeBody = ReleaseActorCommandRequest;
export type ListReleasesQuery = zInput<typeof releaseListQuerySchema>;

export type WorkItemKind = 'requirement' | 'bug' | 'tech_debt';
export type ArtifactKind =
  | 'diff'
  | 'changed_files'
  | 'check_output'
  | 'logs'
  | 'execution_summary'
  | 'self_review'
  | 'review_packet'
  | 'raw_metadata';
export type ExecutorType = 'mock' | 'local_codex';
export type ReviewSeverity = 'minor' | 'major' | 'critical';

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
  phase: string;
  activity_state: string;
  gate_state: string;
  resolution: string;
  current_spec_id?: string;
  current_plan_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SpecPlan {
  id: string;
  work_item_id: string;
  entity_type: 'spec' | 'plan';
  status: string;
  editing_state: string;
  gate_state: string;
  resolution: string;
  current_revision_id?: string;
  created_at?: string;
  updated_at?: string;
}

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
  risk_notes?: string[];
  test_strategy_summary: string;
  created_at?: string;
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
  dependency_order?: string[];
  test_matrix: string[];
  risk_mitigations?: string[];
  rollback_notes: string;
  created_at?: string;
}

export interface RequiredCheck {
  check_id: string;
  display_name: string;
  command: string;
  timeout_seconds: number;
  blocks_review: boolean;
}

export interface ExecutionPackage {
  id: string;
  work_item_id: string;
  spec_id?: string;
  spec_revision_id?: string;
  plan_id?: string;
  plan_revision_id?: string;
  project_id?: string;
  repo_id: string;
  objective: string;
  owner_actor_id: string;
  reviewer_actor_id: string;
  qa_owner_actor_id: string;
  phase: string;
  activity_state: string;
  gate_state: string;
  resolution: string;
  required_checks: RequiredCheck[];
  required_artifact_kinds: ArtifactKind[];
  allowed_paths: string[];
  forbidden_paths: string[];
  version: number;
  last_run_session_id?: string;
  last_failure_summary?: string;
  blocked_reason?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ArtifactRef {
  kind?: string;
  name?: string;
  content_type?: string;
  storage_uri?: string;
  local_ref?: string;
  digest?: string;
}

export interface ChangedFile {
  repo_id?: string;
  path: string;
  change_kind: string;
  previous_path?: string;
}

export interface CheckResult {
  check_id: string;
  command?: string;
  status: string;
  exit_code?: number | null;
  duration_seconds?: number;
  blocks_review?: boolean;
  stdout?: ArtifactRef;
  stderr?: ArtifactRef;
}

export interface RunSession {
  id: string;
  execution_package_id: string;
  requested_by_actor_id: string;
  status: string;
  executor_type?: ExecutorType;
  changed_files?: ChangedFile[];
  check_results?: CheckResult[];
  artifacts?: ArtifactRef[];
  log_refs?: ArtifactRef[];
  runtime_metadata?: {
    durability_mode?: 'durable' | 'volatile_demo';
    driver_kind?: 'app_server' | 'exec_fallback' | 'fake';
    driver_status?: 'not_started' | 'starting' | 'active' | 'waiting_for_input' | 'stalled' | 'terminal';
    codex_thread_id?: string;
    active_turn_id?: string;
    workspace_path?: string;
    app_server_endpoint?: string;
    worker_id?: string;
    worker_lease_status?: 'active' | 'released' | 'expired';
    worker_lease_heartbeat_at?: string;
    worker_lease_expires_at?: string;
    last_event_cursor?: string;
    last_event_at?: string;
    recovery_attempt_count?: number;
    effective_dangerous_mode?: 'confirmed' | 'unconfirmed' | 'not_requested';
  };
  summary?: string;
  failure_kind?: string;
  failure_reason?: string;
  created_at?: string;
  updated_at?: string;
  started_at?: string;
  finished_at?: string;
}

export interface RunEvent {
  id: string;
  run_session_id?: string;
  sequence: number;
  cursor?: string;
  event_type?: string;
  source?: string;
  visibility?: 'public';
  summary?: string;
  payload?: Record<string, unknown>;
  created_at?: string;
}

export interface RunEventListResponse {
  events: RunEvent[];
  next_cursor: string;
  has_more?: boolean;
}

export interface RunOperatorCommandResponse {
  status?: string;
  command_id?: string;
  run_session_id?: string;
  command_type?: 'input' | 'cancel' | 'resume';
}

export interface RequestedChange {
  title: string;
  description: string;
  file_path?: string;
  severity?: ReviewSeverity;
  suggested_validation?: string;
}

export interface ReviewPacket {
  id: string;
  run_session_id: string;
  execution_package_id: string;
  reviewer_actor_id: string;
  status: string;
  decision: string;
  summary?: string;
  changed_files?: ChangedFile[];
  check_result_summary?: string;
  self_review?: {
    status?: string;
    summary?: string;
    spec_plan_alignment?: string;
    test_assessment?: string;
    risk_notes?: string[];
    follow_up_questions?: string[];
    failure_message?: string;
  };
  risk_notes?: string[];
  requested_changes?: RequestedChange[];
  reviewed_by_actor_id?: string;
  reviewed_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface TimelineEntry {
  id: string;
  source: string;
  object_type: string;
  object_id: string;
  summary: string;
  created_at: string;
  payload?: Record<string, unknown>;
}

export interface CockpitResponse {
  work_item?: WorkItem;
  current_spec?: SpecPlan | null;
  current_plan?: SpecPlan | null;
  packages?: ExecutionPackage[];
  run_sessions?: RunSession[];
  review_packets?: ReviewPacket[];
  next_actions?: string[];
  completion_state?: Record<string, unknown>;
}

export interface CreateWorkItemBody {
  project_id: string;
  kind: WorkItemKind;
  title: string;
  goal: string;
  success_criteria: string[];
  priority: string;
  risk: string;
  owner_actor_id: string;
}

export interface CreateSpecRevisionBody {
  summary: string;
  content: string;
  background: string;
  goals: string[];
  scope_in: string[];
  scope_out: string[];
  acceptance_criteria: string[];
  risk_notes?: string[];
  test_strategy_summary: string;
  structured_document?: Record<string, unknown>;
  author_actor_id?: string;
}

export interface CreatePlanRevisionBody {
  summary: string;
  content: string;
  implementation_summary: string;
  split_strategy: string;
  dependency_order?: string[];
  test_matrix: string[];
  risk_mitigations?: string[];
  rollback_notes: string;
  structured_document?: Record<string, unknown>;
  author_actor_id?: string;
}

export interface CreateExecutionPackageBody {
  repo_id: string;
  objective: string;
  owner_actor_id: string;
  reviewer_actor_id: string;
  qa_owner_actor_id: string;
  required_checks: RequiredCheck[];
  required_artifact_kinds: ArtifactKind[];
  allowed_paths: string[];
  forbidden_paths: string[];
}

export type PatchExecutionPackageBody = Partial<Omit<CreateExecutionPackageBody, 'repo_id'>>;

export interface ActorCommandBody {
  actor_id?: string;
}

export interface MarkPackageReadyBody extends ActorCommandBody {
  expected_package_version: number;
}

export interface RunPackageBody {
  execution_package_id?: string;
  requested_by_actor_id: string;
  executor_type?: ExecutorType;
  workflow_only?: boolean;
  previous_run_session_id?: string;
  force?: true;
  force_reason?: string;
}

export interface ReviewDecisionBody {
  summary: string;
  reviewed_by_actor_id: string;
  reviewed_at: string;
  requested_changes?: RequestedChange[];
}

export interface RunEventStreamHandlers {
  onEvent: (event: RunEvent) => void;
  onError: (error: Event | Error) => void;
}

export interface RunEventStream {
  close: () => void;
}
