import type {
  CodexSessionLeaseStatus,
  CodexSessionRole,
  CodexSessionStatus,
  CodexSessionTurnIntent,
  CodexSessionTurnStatus,
  PlanItemWorkflowStatus,
  WorkflowManualDecisionKind,
  WorkflowTransitionEvidenceObjectType,
} from '@forgeloop/contracts';
import { DomainError, type IsoDateTime } from './types.js';

export const planItemWorkflowStatusValues = [
  'not_started',
  'brainstorming',
  'boundary_review',
  'spec_generation_queued',
  'spec_review',
  'implementation_plan_generation_queued',
  'implementation_plan_review',
  'execution_ready',
  'execution_running',
  'code_review',
  'qa',
  'release_ready',
  'blocked',
  'archived',
] as const satisfies readonly PlanItemWorkflowStatus[];

export type { PlanItemWorkflowStatus };

export interface PlanItemWorkflow {
  id: string;
  development_plan_id: string;
  development_plan_item_id: string;
  status: PlanItemWorkflowStatus;
  previous_status?: PlanItemWorkflowStatus;
  active_codex_session_id?: string;
  active_boundary_summary_revision_id?: string;
  active_spec_doc_revision_id?: string;
  active_implementation_plan_doc_revision_id?: string;
  execution_package_id?: string;
  created_by_actor_id: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface TransitionSupportingEvidence {
  object_type: WorkflowTransitionEvidenceObjectType;
  object_id: string;
  digest?: string;
}

export interface PlanItemWorkflowTransition {
  id: string;
  workflow_id: string;
  from_status: PlanItemWorkflowStatus;
  to_status: PlanItemWorkflowStatus;
  actor_id: string;
  reason?: string;
  evidence_object_type: WorkflowTransitionEvidenceObjectType;
  evidence_object_id: string;
  evidence_digest?: string;
  supporting_evidence?: TransitionSupportingEvidence[];
  codex_session_id: string;
  codex_session_turn_id?: string;
  created_at: IsoDateTime;
}

export interface WorkflowManualDecision {
  id: string;
  workflow_id: string;
  codex_session_id: string;
  kind: WorkflowManualDecisionKind;
  reason: string;
  selected_codex_session_id?: string;
  related_object_type?: WorkflowTransitionEvidenceObjectType;
  related_object_id?: string;
  created_by_actor_id: string;
  created_at: IsoDateTime;
}

export interface ExecutionReadinessRecord {
  id: string;
  workflow_id: string;
  development_plan_id: string;
  development_plan_item_id: string;
  codex_session_id: string;
  approved_boundary_summary_revision_id: string;
  approved_spec_revision_id: string;
  approved_implementation_plan_revision_id: string;
  readiness_state: 'ready' | 'not_ready';
  blocker_codes: string[];
  supporting_evidence: TransitionSupportingEvidence[];
  created_by_actor_id: string;
  created_at: IsoDateTime;
}

export interface CodexSession {
  id: string;
  owner_type: 'plan_item_workflow';
  owner_id: string;
  status: CodexSessionStatus;
  role: CodexSessionRole;
  codex_thread_id?: string;
  codex_thread_id_digest?: string;
  latest_snapshot_id?: string;
  latest_snapshot_digest?: string;
  latest_turn_id?: string;
  latest_turn_digest?: string;
  runtime_profile_id: string;
  runtime_profile_revision_id: string;
  credential_binding_id: string;
  credential_binding_version_id: string;
  active_lease_id?: string;
  lease_epoch: number;
  forked_from_session_id?: string;
  forked_from_turn_id?: string;
  forked_from_snapshot_id?: string;
  fork_reason?: string;
  created_by_actor_id: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  archived_at?: IsoDateTime;
}

export interface CodexSessionTurn {
  id: string;
  codex_session_id: string;
  workflow_id: string;
  intent: CodexSessionTurnIntent;
  status: CodexSessionTurnStatus;
  input_digest: string;
  expected_previous_snapshot_digest?: string;
  output_snapshot_id?: string;
  output_snapshot_digest?: string;
  output_object_type?: WorkflowTransitionEvidenceObjectType;
  output_object_id?: string;
  codex_thread_id_digest?: string;
  lease_id?: string;
  lease_epoch?: number;
  automation_action_run_id?: string;
  runtime_job_id?: string;
  created_by_actor_id: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface CodexSessionSnapshot {
  id: string;
  codex_session_id: string;
  sequence: number;
  artifact_ref: string;
  digest: string;
  size_bytes: string;
  manifest_digest: string;
  codex_thread_id_digest?: string;
  runtime_profile_revision_id: string;
  created_from_turn_id?: string;
  created_by_actor_id: string;
  created_at: IsoDateTime;
}

export interface CodexSessionStaleTerminalizationAttempt {
  id: string;
  codex_session_id: string;
  codex_session_turn_id?: string;
  lease_id?: string;
  lease_epoch?: number;
  worker_id: string;
  worker_session_digest: string;
  expected_previous_snapshot_digest?: string;
  attempted_output_snapshot_digest?: string;
  attempted_codex_thread_id_digest?: string;
  failure_code: string;
  created_at: IsoDateTime;
}

export interface CodexSessionLease {
  id: string;
  codex_session_id: string;
  lease_token_hash: string;
  lease_epoch: number;
  worker_id: string;
  worker_session_digest: string;
  status: CodexSessionLeaseStatus;
  acquired_at: IsoDateTime;
  heartbeat_at?: IsoDateTime;
  expires_at: IsoDateTime;
  released_at?: IsoDateTime;
  fenced_at?: IsoDateTime;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

interface TransitionCheck {
  from_status: PlanItemWorkflowStatus;
  to_status: PlanItemWorkflowStatus;
  previous_status?: PlanItemWorkflowStatus;
  evidence_object_type: WorkflowTransitionEvidenceObjectType;
  manual_decision_kind?: WorkflowManualDecisionKind;
}

const exactTransitions = new Set<string>([
  'not_started->brainstorming|manual_decision|start_brainstorming',
  'brainstorming->boundary_review|boundary_summary_revision|',
  'boundary_review->brainstorming|manual_decision|change_request',
  'boundary_review->spec_generation_queued|boundary_summary_revision|',
  'spec_generation_queued->spec_review|spec_revision|',
  'spec_review->spec_generation_queued|manual_decision|change_request',
  'spec_review->implementation_plan_generation_queued|spec_revision|',
  'implementation_plan_generation_queued->implementation_plan_review|implementation_plan_revision|',
  'implementation_plan_review->implementation_plan_generation_queued|manual_decision|change_request',
  'implementation_plan_review->execution_ready|execution_readiness_record|',
  'execution_ready->execution_running|execution_package|',
  'execution_running->code_review|run_session|',
  'execution_running->code_review|commit|',
  'code_review->qa|review_packet|',
  'code_review->qa|pull_request|',
  'code_review->qa|manual_decision|override',
  'qa->release_ready|manual_decision|override',
]);

const transitionKey = (input: TransitionCheck) =>
  `${input.from_status}->${input.to_status}|${input.evidence_object_type}|${input.manual_decision_kind ?? ''}`;

export const assertPlanItemWorkflowTransitionAllowed = (input: TransitionCheck): void => {
  if (exactTransitions.has(transitionKey(input))) return;

  if (
    input.to_status === 'blocked' &&
    input.from_status !== 'blocked' &&
    input.from_status !== 'archived' &&
    input.evidence_object_type === 'manual_decision' &&
    input.manual_decision_kind === 'block'
  ) {
    return;
  }

  if (
    input.from_status === 'blocked' &&
    input.evidence_object_type === 'manual_decision' &&
    input.manual_decision_kind === 'recover' &&
    input.previous_status !== undefined &&
    input.to_status === input.previous_status &&
    input.to_status !== 'blocked' &&
    input.to_status !== 'archived'
  ) {
    return;
  }

  if (
    input.to_status === 'archived' &&
    input.from_status !== 'archived' &&
    input.evidence_object_type === 'manual_decision' &&
    input.manual_decision_kind === 'archive'
  ) {
    return;
  }

  if (
    input.from_status === input.to_status &&
    input.from_status !== 'archived' &&
    input.evidence_object_type === 'manual_decision' &&
    input.manual_decision_kind === 'fork_select'
  ) {
    return;
  }

  throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Invalid workflow transition ${transitionKey(input)}`);
};

export const assertWorkflowManualDecisionAllowedForTransition = (
  decision: WorkflowManualDecision,
  transition: Pick<TransitionCheck, 'from_status' | 'to_status' | 'previous_status'>,
): void => {
  if (decision.kind === 'fork_select' && decision.selected_codex_session_id === undefined) {
    throw new DomainError('workflow_invalid_transition', 'workflow_invalid_transition: fork_select requires selected_codex_session_id');
  }

  if (decision.kind !== 'fork_select' && decision.selected_codex_session_id !== undefined) {
    throw new DomainError(
      'workflow_invalid_transition',
      'workflow_invalid_transition: selected_codex_session_id is only allowed for fork_select',
    );
  }

  if ((decision.related_object_type === undefined) !== (decision.related_object_id === undefined)) {
    throw new DomainError(
      'workflow_invalid_transition',
      'workflow_invalid_transition: related_object_type and related_object_id must be provided together',
    );
  }

  assertPlanItemWorkflowTransitionAllowed({
    ...transition,
    evidence_object_type: 'manual_decision',
    manual_decision_kind: decision.kind,
  });
};

const codexSessionContinuityState = (status: CodexSessionStatus): 'ready' | 'running' | 'blocked' | 'stale' => {
  switch (status) {
    case 'idle':
      return 'ready';
    case 'running':
    case 'starting':
    case 'recovering':
      return 'running';
    case 'blocked':
      return 'blocked';
    case 'archived':
      return 'stale';
  }
};

export const codexSessionPublicProjection = (session: CodexSession) => ({
  id: session.id,
  status: session.status,
  role: session.role,
  continuity_state: codexSessionContinuityState(session.status),
  can_continue: session.status === 'idle' && session.role === 'active',
  ...(session.latest_turn_id === undefined ? {} : { last_turn_at: session.updated_at }),
  ...(session.status === 'blocked' ? { blocked_reason_code: 'codex_session_blocked' } : {}),
});

export const assertWorkflowActorAuthorized = (
  workflow: Pick<PlanItemWorkflow, 'development_plan_item_id'>,
  action:
    | 'start_brainstorming'
    | 'submit_document_gate'
    | 'approve_document_gate'
    | 'block'
    | 'recover'
    | 'archive'
    | 'start_execution'
    | 'select_fork',
  actorContext: {
    actor_id: string;
    actor_class?: string;
    development_plan_item?: {
      driver_actor_id?: string;
      reviewer_actor_id?: string;
      leader_actor_id?: string;
      leader_delegate_actor_ids?: string[];
    };
    execution_owner_actor_id?: string;
  },
): void => {
  const item = actorContext.development_plan_item;
  const techLeads = new Set([item?.leader_actor_id, item?.reviewer_actor_id, ...(item?.leader_delegate_actor_ids ?? [])].filter(Boolean));
  const productActors = new Set([item?.driver_actor_id, ...techLeads].filter(Boolean));
  const operators = new Set(['human_admin', 'automation_daemon', 'system_bootstrap']);
  const isOperator = actorContext.actor_class !== undefined && operators.has(actorContext.actor_class);
  const actorId = actorContext.actor_id;

  const allowed =
    (action === 'start_brainstorming' && productActors.has(actorId)) ||
    ((action === 'submit_document_gate' || action === 'approve_document_gate' || action === 'select_fork') && techLeads.has(actorId)) ||
    (action === 'start_execution' && (actorContext.execution_owner_actor_id === actorId || techLeads.has(actorId))) ||
    ((action === 'block' || action === 'recover' || action === 'archive') && (techLeads.has(actorId) || isOperator));

  if (!allowed) {
    throw new DomainError(
      'workflow_actor_not_authorized',
      `Actor ${actorId} cannot perform ${action} on workflow item ${workflow.development_plan_item_id}`,
    );
  }
};
