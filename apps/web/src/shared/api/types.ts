import type { input as zInput } from 'zod';

import type {
  ApproveReleaseRequest,
  AcknowledgeReleaseTestAcceptanceRequest,
  acknowledgeReleaseTestAcceptanceRequestSchema,
  closeReleaseRequestSchema,
  createReleaseEvidenceRequestSchema,
  createReleaseRequestSchema,
  LinkReleaseObjectRequest,
  OverrideApproveReleaseRequest,
  PatchReleaseRequest,
  ProductLaneId,
  productListQuerySchema,
  ReleaseActorCommandRequest,
  releaseListQuerySchema,
  RequestReleaseChangesRequest,
  WorkItemCockpitResponse,
} from '@forgeloop/contracts';

export type {
  ApproveReleaseRequest,
  AcknowledgeReleaseTestAcceptanceRequest,
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
  ProductAction,
  ProductActionTarget,
  ProductCommand,
  ProductCommandAction,
  ProductHref,
  ProductLaneId,
  ProductLaneItem,
  ProductLaneResponse,
  ProductNavigateAction,
  ProductListItem,
  ProductListQuery,
  ProductListResponse,
  PipelineResponse,
  StartReleaseObservingRequest,
  SubmitReleaseForApprovalRequest,
  UnlinkReleaseObjectRequest,
  WorkItemActionsResponse,
  WorkItemCockpitResponse as CockpitResponse,
  WorkItemDeliveryReadiness,
  DeliveryStage,
  DeliveryStageId,
  DeliveryStageState,
  DeliveryBlocker,
  DeliveryEvidence,
} from '@forgeloop/contracts';

export type CreateReleaseBody = zInput<typeof createReleaseRequestSchema>;
export type PatchReleaseBody = PatchReleaseRequest;
export type ReleaseCommandBody = ReleaseActorCommandRequest;
export type ApproveReleaseBody = ApproveReleaseRequest;
export type AcknowledgeReleaseTestAcceptanceBody = zInput<typeof acknowledgeReleaseTestAcceptanceRequestSchema>;
export type OverrideApproveReleaseBody = OverrideApproveReleaseRequest;
export type RequestReleaseChangesBody = RequestReleaseChangesRequest;
export type StartReleaseObservingBody = ReleaseActorCommandRequest;
export type CloseReleaseBody = zInput<typeof closeReleaseRequestSchema>;
export type CreateReleaseEvidenceBody = zInput<typeof createReleaseEvidenceRequestSchema>;
export type LinkReleaseScopeBody = LinkReleaseObjectRequest;
export type UnlinkReleaseScopeBody = ReleaseActorCommandRequest;
export type ListReleasesQuery = zInput<typeof releaseListQuerySchema>;
export type ListProductQuery = zInput<typeof productListQuerySchema>;

export interface ProductLaneQuery {
  project_id: string;
  actor_id?: string;
  owner_actor_id?: string;
  reviewer_actor_id?: string;
  qa_owner_actor_id?: string;
  release_owner_actor_id?: string;
  kind?: 'initiative' | 'requirement' | 'bug' | 'tech_debt';
  phase?: string;
  status?: string;
  gate_state?: string;
  resolution?: string;
  risk?: string;
  blocked?: boolean;
  stale?: boolean;
  cursor?: string;
  limit?: number;
}

export interface WorkItemActionsQuery {
  lane?: ProductLaneId;
}

export type WorkItemKind = 'initiative' | 'requirement' | 'bug' | 'tech_debt';
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

export type WorkItem = WorkItemCockpitResponse['work_item'];
export type SpecPlan = NonNullable<WorkItemCockpitResponse['current_spec']>;

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

export type RequiredCheck = WorkItemCockpitResponse['packages'][number]['required_checks'][number];
export type ExecutionPackage = WorkItemCockpitResponse['packages'][number];
export type ArtifactRef = NonNullable<WorkItemCockpitResponse['run_sessions'][number]['artifacts']>[number];
export type ChangedFile = NonNullable<WorkItemCockpitResponse['run_sessions'][number]['changed_files']>[number];
export type CheckResult = NonNullable<WorkItemCockpitResponse['run_sessions'][number]['check_results']>[number];
export type RunSession = WorkItemCockpitResponse['run_sessions'][number];

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

export type RequestedChange = NonNullable<WorkItemCockpitResponse['review_packets'][number]['requested_changes']>[number];
export type ReviewPacket = WorkItemCockpitResponse['review_packets'][number];

export interface TimelineEntry {
  id: string;
  source: string;
  object_type: string;
  object_id: string;
  summary: string;
  created_at: string;
  payload?: Record<string, unknown>;
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

export type SubmitForApprovalBody = ActorCommandBody;

export interface ApproveArtifactBody extends ActorCommandBody {
  rationale?: string;
}

export interface RequestArtifactChangesBody extends ActorCommandBody {
  rationale: string;
}

export interface MarkPackageReadyBody extends ActorCommandBody {
  expected_package_version: number;
}

export interface RunPackageBody {
  execution_package_id?: string;
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
