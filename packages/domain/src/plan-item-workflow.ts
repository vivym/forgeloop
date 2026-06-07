import { createHash } from 'node:crypto';
import {
  planItemWorkflowAttemptHistorySchema,
  planItemWorkflowLatestReviewResponseSchema,
  planItemWorkflowRecoveryOptionSchema,
} from '@forgeloop/contracts';
import type {
  CodexSessionLeaseStatus,
  CodexSessionRole,
  CodexSessionStatus,
  CodexSessionTurnIntent,
  CodexSessionTurnStatus,
  PlanItemWorkflowPublicDto,
  PlanItemWorkflowQueuedActionKind,
  PlanItemWorkflowQueuedActionStatus,
  PlanItemWorkflowStatus,
  WorkflowMessageAction,
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

export interface PlanItemWorkflowQueuedAction {
  id: string;
  workflow_id: string;
  codex_session_id: string;
  kind: PlanItemWorkflowQueuedActionKind;
  status: PlanItemWorkflowQueuedActionStatus;
  source_revision_id?: string;
  change_request_id?: string;
  created_from_message_id?: string;
  expected_input_capsule_digest?: string;
  context_preview_digest: string;
  idempotency_key: string;
  codex_session_turn_id?: string;
  output_capsule_id?: string;
  output_capsule_digest?: string;
  output_capsule_sequence?: number;
  codex_thread_id_digest?: string;
  blocked_reason_code?: string;
  created_by_actor_id: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface PlanItemWorkflowMessage {
  id: string;
  workflow_id: string;
  codex_session_id: string;
  actor_id: string;
  action: WorkflowMessageAction;
  body_markdown: string;
  created_queued_action_id?: string;
  client_message_id?: string;
  created_at: IsoDateTime;
}

export interface ExecutionReadinessRecord {
  id: string;
  workflow_id: string;
  development_plan_id: string;
  development_plan_item_id: string;
  codex_session_id: string;
  codex_session_turn_id?: string;
  approved_boundary_summary_revision_id: string;
  approved_spec_revision_id: string;
  approved_implementation_plan_revision_id: string;
  readiness_state: 'ready' | 'not_ready';
  blocker_codes: string[];
  supporting_evidence: TransitionSupportingEvidence[];
  created_by_actor_id: string;
  created_at: IsoDateTime;
  invalidated_at?: IsoDateTime;
  invalidated_reason?: string;
}

export interface ReviewPacketEvidenceRef {
  id: string;
  review_packet_id: string;
  workflow_id: string;
  ref_kind:
    | 'github_comment_url'
    | 'github_thread_url'
    | 'markdown_excerpt'
    | 'image_attachment'
    | 'internal_artifact'
    | 'check_log_summary';
  display_text: string;
  url?: string;
  internal_object_ref?: string;
  digest: string;
  created_by_actor_id: string;
  created_at: IsoDateTime;
}

export interface ReviewResponse {
  id: string;
  workflow_id: string;
  codex_session_id: string;
  codex_session_turn_id: string;
  review_packet_id: string;
  previous_run_session_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked';
  content_digest?: string;
  rendered_markdown_artifact_ref?: string;
  created_by_actor_id: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface RunSessionAttemptLineage {
  run_session_id: string;
  workflow_id: string;
  codex_session_id: string;
  attempt_kind: 'first_execution' | 'review_fix';
  previous_run_session_id?: string;
  previous_review_packet_id?: string;
  review_response_id?: string;
  created_by_actor_id: string;
  created_at: IsoDateTime;
}

export interface ExecutionContinuationLineage {
  id: string;
  workflow_id: string;
  run_session_id: string;
  codex_session_id: string;
  queued_action_id: string;
  continuation_kind: 'existing_job_input' | 'replay_current_continuation' | 'relaunch_after_fencing';
  previous_runtime_job_id: string;
  new_runtime_job_id?: string;
  codex_session_turn_id?: string;
  previous_capsule_digest: string;
  expected_input_capsule_digest: string;
  previous_codex_session_lease_id: string;
  previous_run_worker_lease_id?: string;
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
  latest_capsule_id?: string;
  latest_capsule_digest?: string;
  base_memory_bundle_ref?: string;
  base_memory_bundle_digest?: string;
  latest_memory_bundle_ref?: string;
  latest_memory_bundle_digest?: string;
  latest_environment_manifest_ref?: string;
  latest_environment_manifest_digest?: string;
  latest_turn_id?: string;
  latest_turn_digest?: string;
  runtime_profile_id: string;
  runtime_profile_revision_id: string;
  credential_binding_id: string;
  credential_binding_version_id: string;
  active_lease_id?: string;
  lease_epoch: number;
  runner_worker_id?: string | undefined;
  runner_launch_lease_id?: string | undefined;
  runner_runtime_job_id?: string | undefined;
  runner_expires_at?: IsoDateTime | undefined;
  forked_from_session_id?: string;
  forked_from_turn_id?: string;
  forked_from_capsule_id?: string;
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
  expected_input_capsule_digest?: string;
  input_capsule_id?: string;
  input_capsule_digest?: string;
  output_capsule_id?: string;
  output_capsule_digest?: string;
  base_memory_bundle_ref?: string;
  base_memory_bundle_digest?: string;
  input_memory_bundle_ref?: string;
  input_memory_bundle_digest?: string;
  output_memory_bundle_ref?: string;
  output_memory_bundle_digest?: string;
  memory_delta_artifact_ref?: string;
  memory_delta_digest?: string;
  input_environment_manifest_ref?: string;
  input_environment_manifest_digest?: string;
  output_environment_manifest_ref?: string;
  output_environment_manifest_digest?: string;
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

export interface CodexRuntimeCapsule {
  id: string;
  codex_session_id: string;
  created_from_turn_id: string;
  sequence: number;
  artifact_ref: string;
  digest: string;
  size_bytes: string;
  manifest_digest: string;
  thread_state_digest: string;
  memory_state_digest: string;
  environment_manifest_digest: string;
  codex_thread_id_digest: string;
  codex_cli_version: string;
  app_server_protocol_digest: string;
  runtime_profile_revision_id: string;
  trusted_runtime_manifest_digest: string;
  credential_binding_lineage_digest: string;
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
  expected_input_capsule_digest?: string;
  attempted_output_capsule_digest?: string;
  attempted_codex_thread_id_digest?: string;
  workflow_id?: string;
  run_session_id?: string;
  runtime_job_id?: string;
  expected_workflow_status?: string;
  actual_workflow_status?: string;
  expected_run_session_status?: string;
  actual_run_session_status?: string;
  expected_run_session_updated_at?: IsoDateTime;
  actual_run_session_updated_at?: IsoDateTime;
  expected_codex_thread_id_digest?: string;
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
  'spec_generation_queued->brainstorming|manual_decision|change_request',
  'spec_generation_queued->spec_review|spec_revision|',
  'spec_review->brainstorming|manual_decision|change_request',
  'spec_review->spec_generation_queued|manual_decision|change_request',
  'spec_review->implementation_plan_generation_queued|spec_revision|',
  'implementation_plan_generation_queued->brainstorming|manual_decision|change_request',
  'implementation_plan_generation_queued->spec_generation_queued|manual_decision|change_request',
  'implementation_plan_generation_queued->implementation_plan_review|implementation_plan_revision|',
  'implementation_plan_review->brainstorming|manual_decision|change_request',
  'implementation_plan_review->spec_generation_queued|manual_decision|change_request',
  'implementation_plan_review->implementation_plan_generation_queued|manual_decision|change_request',
  'execution_ready->brainstorming|manual_decision|change_request',
  'execution_ready->spec_generation_queued|manual_decision|change_request',
  'execution_ready->implementation_plan_generation_queued|manual_decision|change_request',
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

const workflowError = (code: ConstructorParameters<typeof DomainError>[0], message: string = code, details?: Record<string, unknown>): DomainError =>
  new DomainError(code, `${code}: ${message}`, details);

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

const abandonNewSessionFallbackTargets = new Set<PlanItemWorkflowStatus>([
  'code_review',
  'execution_ready',
  'implementation_plan_review',
  'implementation_plan_generation_queued',
  'spec_review',
  'spec_generation_queued',
  'brainstorming',
]);

export const assertAbandonNewSessionTransitionAllowed = (input: {
  from_status: PlanItemWorkflowStatus;
  to_status: PlanItemWorkflowStatus;
  manual_decision_kind: WorkflowManualDecisionKind;
}): void => {
  if (
    input.manual_decision_kind === 'abandon_new_session' &&
    input.from_status === 'blocked' &&
    abandonNewSessionFallbackTargets.has(input.to_status)
  ) {
    return;
  }

  throw new DomainError(
    'workflow_invalid_transition',
    `workflow_invalid_transition: Invalid abandon_new_session transition ${input.from_status}->${input.to_status}`,
  );
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
  status: session.status,
  role: session.role,
  continuity_state: codexSessionContinuityState(session.status),
  can_continue: session.status === 'idle' && session.role === 'active',
  ...(session.latest_turn_id === undefined ? {} : { last_turn_at: session.updated_at }),
  ...(session.status === 'blocked' ? { blocked_reason_code: 'codex_session_blocked' } : {}),
});

export const mapQueuedActionKindToTurnIntent = (kind: PlanItemWorkflowQueuedActionKind): CodexSessionTurnIntent => {
  switch (kind) {
    case 'continue_brainstorming':
      return 'continue_brainstorming';
    case 'generate_boundary_summary':
      return 'draft_boundary_summary';
    case 'revise_boundary_summary':
      return 'revise_boundary_summary';
    case 'generate_spec_doc':
      return 'draft_spec_doc';
    case 'revise_spec_doc':
      return 'revise_spec_doc';
    case 'generate_implementation_plan_doc':
      return 'draft_implementation_plan_doc';
    case 'revise_implementation_plan_doc':
      return 'revise_implementation_plan_doc';
    case 'continue_execution':
      return 'continue_execution';
    case 'respond_to_review':
      return 'address_review_feedback';
    case 'request_fix':
      return 'fix_review_feedback';
  }
};

export const isSameStatusWorkflowEventActionKind = (kind: PlanItemWorkflowQueuedActionKind): boolean =>
  kind === 'continue_execution' || kind === 'respond_to_review';

const workflowMessageActions = new Set<WorkflowMessageAction>(['answer_boundary_question', 'continue_ai']);

export const assertWorkflowMessageAllowed = (input: {
  action: string;
  workflow_status: PlanItemWorkflowStatus;
  active_codex_session_id?: string;
  active_codex_action_count: number;
}): void => {
  if (!workflowMessageActions.has(input.action as WorkflowMessageAction)) {
    throw workflowError('workflow_invalid_message_action', `Invalid workflow message action ${input.action}`);
  }

  if (input.workflow_status !== 'brainstorming') {
    throw workflowError('workflow_invalid_message_action', `Workflow message action ${input.action} is only valid during brainstorming.`);
  }

  if (input.active_codex_action_count > 0) {
    throw workflowError('workflow_action_already_pending', 'A queued or running workflow action already exists.');
  }

  if (input.active_codex_session_id === undefined || input.active_codex_session_id.trim() === '') {
    throw workflowError('workflow_action_not_active_session', 'Workflow message requires an active Codex session.');
  }
};

export const assertQueuedActionCanRun = (input: {
  action: Pick<
    PlanItemWorkflowQueuedAction,
    | 'id'
    | 'workflow_id'
    | 'codex_session_id'
    | 'kind'
    | 'status'
    | 'expected_input_capsule_digest'
    | 'context_preview_digest'
  >;
  workflow_id: string;
  active_codex_session_id?: string;
  latest_capsule_digest?: string;
  context_preview_digest: string;
}): void => {
  if (input.action.workflow_id !== input.workflow_id) {
    throw workflowError('workflow_action_not_runnable', 'Queued action does not belong to the workflow.', {
      action_id: input.action.id,
      workflow_id: input.workflow_id,
    });
  }

  if (
    input.active_codex_session_id === undefined ||
    input.action.codex_session_id !== input.active_codex_session_id
  ) {
    throw workflowError('workflow_action_not_active_session', 'Queued action does not target the active Codex session.', {
      action_id: input.action.id,
      active_codex_session_id: input.active_codex_session_id,
    });
  }

  if (input.action.status !== 'queued') {
    throw workflowError('workflow_action_not_runnable', 'Queued action is not in queued status.', {
      action_id: input.action.id,
      status: input.action.status,
    });
  }

  if (
    input.action.expected_input_capsule_digest !== undefined &&
    input.action.expected_input_capsule_digest !== input.latest_capsule_digest
  ) {
    throw workflowError('workflow_capsule_digest_mismatch', 'Queued action input capsule digest is stale.', {
      action_id: input.action.id,
      expected_input_capsule_digest: input.action.expected_input_capsule_digest,
      latest_capsule_digest: input.latest_capsule_digest,
    });
  }

  if (input.action.context_preview_digest !== input.context_preview_digest) {
    throw workflowError('workflow_context_digest_mismatch', 'Queued action context preview digest is stale.', {
      action_id: input.action.id,
      expected_context_preview_digest: input.action.context_preview_digest,
      context_preview_digest: input.context_preview_digest,
    });
  }
};

export const buildPlanItemWorkflowQueuedActionIdempotencyKey = (input: {
  workflow_id: string;
  kind: PlanItemWorkflowQueuedActionKind;
  source_revision_id?: string;
  change_request_id?: string;
  context_preview_digest: string;
  expected_input_capsule_digest?: string;
}): string => {
  const scopedInput = {
    workflow_id: input.workflow_id,
    kind: input.kind,
    source_revision_id: input.source_revision_id ?? null,
    change_request_id: input.change_request_id ?? null,
    context_preview_digest: input.context_preview_digest,
    expected_input_capsule_digest: input.expected_input_capsule_digest ?? null,
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(scopedInput)).digest('hex')}`;
};

export const planItemWorkflowPublicProjection = (input: {
  workflow: Pick<
    PlanItemWorkflow,
    | 'id'
    | 'development_plan_id'
    | 'development_plan_item_id'
    | 'status'
	    | 'active_codex_session_id'
	    | 'active_boundary_summary_revision_id'
	    | 'active_spec_doc_revision_id'
	    | 'active_implementation_plan_doc_revision_id'
	    | 'created_at'
	    | 'updated_at'
  >;
  session: CodexSession;
  queued_actions?: readonly PlanItemWorkflowQueuedAction[];
  timeline_events?: PlanItemWorkflowPublicDto['timeline_events'];
  context_preview?: PlanItemWorkflowPublicDto['context_preview'];
  readiness?: PlanItemWorkflowPublicDto['readiness'];
  execution_run_summary?: PlanItemWorkflowPublicDto['execution_run_summary'];
  attempt_history?: PlanItemWorkflowPublicDto['attempt_history'];
  latest_review_response?: PlanItemWorkflowPublicDto['latest_review_response'];
  recovery_options?: PlanItemWorkflowPublicDto['recovery_options'];
  blockers?: PlanItemWorkflowPublicDto['blockers'];
}): PlanItemWorkflowPublicDto => ({
  id: input.workflow.id,
  development_plan_id: input.workflow.development_plan_id,
  development_plan_item_id: input.workflow.development_plan_item_id,
  status: input.workflow.status,
  ...(input.workflow.active_boundary_summary_revision_id === undefined
    ? {}
    : { active_boundary_summary_revision_id: input.workflow.active_boundary_summary_revision_id }),
  ...(input.workflow.active_spec_doc_revision_id === undefined
    ? {}
    : { active_spec_doc_revision_id: input.workflow.active_spec_doc_revision_id }),
  ...(input.workflow.active_implementation_plan_doc_revision_id === undefined
    ? {}
    : { active_implementation_plan_doc_revision_id: input.workflow.active_implementation_plan_doc_revision_id }),
  session: codexSessionPublicProjection(input.session),
  queued_actions: (input.queued_actions ?? []).map((action) => ({
    id: action.id,
    workflow_id: action.workflow_id,
    kind: action.kind,
    status: action.status,
    ...(action.source_revision_id === undefined ? {} : { source_revision_id: action.source_revision_id }),
    ...(action.change_request_id === undefined ? {} : { change_request_id: action.change_request_id }),
    ...(action.created_from_message_id === undefined ? {} : { created_from_message_id: action.created_from_message_id }),
    ...(action.expected_input_capsule_digest === undefined
      ? {}
      : { expected_input_capsule_digest: action.expected_input_capsule_digest }),
    context_preview_digest: action.context_preview_digest,
    idempotency_key: action.idempotency_key,
    ...(action.output_capsule_digest === undefined ? {} : { output_capsule_digest: action.output_capsule_digest }),
    ...(action.output_capsule_sequence === undefined ? {} : { output_capsule_sequence: action.output_capsule_sequence }),
    ...(action.codex_thread_id_digest === undefined ? {} : { codex_thread_id_digest: action.codex_thread_id_digest }),
    ...(action.blocked_reason_code === undefined ? {} : { blocked_reason_code: action.blocked_reason_code }),
    created_by_actor_id: action.created_by_actor_id,
    created_at: action.created_at,
    updated_at: action.updated_at,
  })),
  timeline_events: input.timeline_events ?? [],
  ...(input.context_preview === undefined ? {} : { context_preview: input.context_preview }),
  ...(input.readiness === undefined ? {} : { readiness: input.readiness }),
  ...(input.execution_run_summary === undefined ? {} : { execution_run_summary: input.execution_run_summary }),
  attempt_history: (input.attempt_history ?? []).map((attempt) => planItemWorkflowAttemptHistorySchema.parse(attempt)),
  ...(input.latest_review_response === undefined
    ? {}
    : { latest_review_response: planItemWorkflowLatestReviewResponseSchema.parse(input.latest_review_response) }),
  recovery_options: (input.recovery_options ?? []).map((option) => planItemWorkflowRecoveryOptionSchema.parse(option)),
  blockers: input.blockers ?? [],
  created_at: input.workflow.created_at,
  updated_at: input.workflow.updated_at,
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
