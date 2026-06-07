import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);
const isoDateTime = z.string().datetime();
const safeDigest = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const planItemWorkflowStatusSchema = z.enum([
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
]);
export type PlanItemWorkflowStatus = z.infer<typeof planItemWorkflowStatusSchema>;

export const workflowTransitionEvidenceObjectTypeSchema = z.enum([
  'boundary_summary_revision',
  'spec_revision',
  'implementation_plan_revision',
  'execution_readiness_record',
  'execution_package',
  'run_session',
  'review_packet',
  'internal_artifact',
  'commit',
  'pull_request',
  'manual_decision',
]);
export type WorkflowTransitionEvidenceObjectType = z.infer<typeof workflowTransitionEvidenceObjectTypeSchema>;

export const workflowManualDecisionKindSchema = z.enum([
  'start_brainstorming',
  'change_request',
  'block',
  'recover',
  'archive',
  'fork_select',
  'override',
]);
export type WorkflowManualDecisionKind = z.infer<typeof workflowManualDecisionKindSchema>;

export const codexSessionStatusSchema = z.enum(['starting', 'idle', 'running', 'blocked', 'recovering', 'archived']);
export type CodexSessionStatus = z.infer<typeof codexSessionStatusSchema>;

export const codexSessionRoleSchema = z.enum(['active', 'candidate_fork', 'inactive_fork']);
export type CodexSessionRole = z.infer<typeof codexSessionRoleSchema>;

export const codexSessionTurnIntentSchema = z.enum([
  'continue_brainstorming',
  'draft_boundary_summary',
  'revise_boundary_summary',
  'draft_spec_doc',
  'revise_spec_doc',
  'draft_implementation_plan_doc',
  'revise_implementation_plan_doc',
  'execute_plan',
  'continue_execution',
  'address_review_feedback',
]);
export type CodexSessionTurnIntent = z.infer<typeof codexSessionTurnIntentSchema>;

export const codexSessionTurnStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'stale']);
export type CodexSessionTurnStatus = z.infer<typeof codexSessionTurnStatusSchema>;

export const codexSessionLeaseStatusSchema = z.enum(['active', 'released', 'expired', 'fenced', 'stale']);
export type CodexSessionLeaseStatus = z.infer<typeof codexSessionLeaseStatusSchema>;

export const planItemWorkflowQueuedActionKindSchema = z.enum([
  'continue_brainstorming',
  'generate_boundary_summary',
  'revise_boundary_summary',
  'generate_spec_doc',
  'revise_spec_doc',
  'generate_implementation_plan_doc',
  'revise_implementation_plan_doc',
]);
export type PlanItemWorkflowQueuedActionKind = z.infer<typeof planItemWorkflowQueuedActionKindSchema>;

export const planItemWorkflowQueuedActionStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'blocked',
  'cancelled',
  'stale',
]);
export type PlanItemWorkflowQueuedActionStatus = z.infer<typeof planItemWorkflowQueuedActionStatusSchema>;

export const workflowMessageActionSchema = z.enum(['answer_boundary_question', 'continue_ai']);
export type WorkflowMessageAction = z.infer<typeof workflowMessageActionSchema>;

export const workflowMessageCommandSchema = z
  .object({
    actor_id: nonEmpty,
    action: workflowMessageActionSchema,
    body_markdown: nonEmpty,
    client_message_id: nonEmpty.optional(),
  })
  .strict();
export type WorkflowMessageCommand = z.infer<typeof workflowMessageCommandSchema>;

export const planItemWorkflowQueuedActionSchema = z
  .object({
    id: nonEmpty,
    workflow_id: nonEmpty,
    kind: planItemWorkflowQueuedActionKindSchema,
    status: planItemWorkflowQueuedActionStatusSchema,
    source_revision_id: nonEmpty.optional(),
    change_request_id: nonEmpty.optional(),
    created_from_message_id: nonEmpty.optional(),
    expected_input_capsule_digest: safeDigest.optional(),
    context_preview_digest: safeDigest,
    idempotency_key: safeDigest,
    output_capsule_digest: safeDigest.optional(),
    output_capsule_sequence: z.number().int().nonnegative().optional(),
    codex_thread_id_digest: safeDigest.optional(),
    blocked_reason_code: nonEmpty.optional(),
    created_by_actor_id: nonEmpty,
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict();
export type PlanItemWorkflowQueuedAction = z.infer<typeof planItemWorkflowQueuedActionSchema>;

export const transitionSupportingEvidenceSchema = z
  .object({
    object_type: workflowTransitionEvidenceObjectTypeSchema,
    object_id: nonEmpty,
    digest: nonEmpty.optional(),
  })
  .strict();

export const planItemWorkflowTransitionSchema = z
  .object({
    id: nonEmpty,
    workflow_id: nonEmpty,
    from_status: planItemWorkflowStatusSchema,
    to_status: planItemWorkflowStatusSchema,
    actor_id: nonEmpty,
    reason: nonEmpty.optional(),
    evidence_object_type: workflowTransitionEvidenceObjectTypeSchema,
    evidence_object_id: nonEmpty,
    evidence_digest: nonEmpty.optional(),
    supporting_evidence: z.array(transitionSupportingEvidenceSchema).optional(),
    created_at: isoDateTime,
  })
  .strict();
export type PlanItemWorkflowTransition = z.infer<typeof planItemWorkflowTransitionSchema>;

export const internalPlanItemWorkflowTransitionSchema = planItemWorkflowTransitionSchema
  .extend({
    codex_session_id: nonEmpty,
    codex_session_turn_id: nonEmpty.optional(),
  })
  .strict();
export type InternalPlanItemWorkflowTransition = z.infer<typeof internalPlanItemWorkflowTransitionSchema>;

const workflowManualDecisionBaseSchema = z
  .object({
    id: nonEmpty,
    workflow_id: nonEmpty,
    kind: workflowManualDecisionKindSchema,
    reason: nonEmpty,
    related_object_type: workflowTransitionEvidenceObjectTypeSchema.optional(),
    related_object_id: nonEmpty.optional(),
    created_by_actor_id: nonEmpty,
    created_at: isoDateTime,
  })
  .strict();

export const workflowManualDecisionSchema = workflowManualDecisionBaseSchema
  .superRefine((decision, ctx) => {
    if (decision.kind === 'fork_select') {
      ctx.addIssue({
        code: 'custom',
        path: ['kind'],
        message: 'fork_select is internal runtime evidence and is not public-safe',
      });
    }

    if ((decision.related_object_type === undefined) !== (decision.related_object_id === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['related_object_id'],
        message: 'related_object_type and related_object_id must be provided together',
      });
    }
  });
export type WorkflowManualDecision = z.infer<typeof workflowManualDecisionSchema>;

export const internalWorkflowManualDecisionSchema = workflowManualDecisionBaseSchema
  .extend({
    codex_session_id: nonEmpty,
    selected_codex_session_id: nonEmpty.optional(),
  })
  .strict()
  .superRefine((decision, ctx) => {
    if (decision.kind === 'fork_select' && decision.selected_codex_session_id === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['selected_codex_session_id'],
        message: 'fork_select requires selected_codex_session_id',
      });
    }

    if (decision.kind !== 'fork_select' && decision.selected_codex_session_id !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['selected_codex_session_id'],
        message: 'selected_codex_session_id is only allowed for fork_select',
      });
    }
  });
export type InternalWorkflowManualDecision = z.infer<typeof internalWorkflowManualDecisionSchema>;

export const codexSessionPublicDtoSchema = z
  .object({
    status: codexSessionStatusSchema,
    role: codexSessionRoleSchema,
    continuity_state: z.enum(['ready', 'running', 'blocked', 'stale']),
    can_continue: z.boolean(),
    last_turn_at: isoDateTime.optional(),
    blocked_reason_code: nonEmpty.optional(),
  })
  .strict();
export type CodexSessionPublicDto = z.infer<typeof codexSessionPublicDtoSchema>;

export const planItemWorkflowTimelineEventSchema = z
  .object({
    id: nonEmpty,
    workflow_id: nonEmpty.optional(),
    event_type: nonEmpty,
    status: nonEmpty.optional(),
    body_markdown: nonEmpty.optional(),
    actor_id: nonEmpty.optional(),
    object_type: workflowTransitionEvidenceObjectTypeSchema.optional(),
    object_id: nonEmpty.optional(),
    object_digest: safeDigest.optional(),
    queued_action_id: nonEmpty.optional(),
    queued_action_kind: planItemWorkflowQueuedActionKindSchema.optional(),
    queued_action_status: planItemWorkflowQueuedActionStatusSchema.optional(),
    created_at: isoDateTime,
  })
  .strict();
export type PlanItemWorkflowTimelineEvent = z.infer<typeof planItemWorkflowTimelineEventSchema>;

export const planItemWorkflowContextPreviewSchema = z
  .object({
    digest: safeDigest,
    capsule_digest: safeDigest.optional(),
    boundary_summary_revision_id: nonEmpty.optional(),
    spec_doc_revision_id: nonEmpty.optional(),
    implementation_plan_doc_revision_id: nonEmpty.optional(),
    message_count: z.number().int().nonnegative().optional(),
    queued_action_count: z.number().int().nonnegative().optional(),
    updated_at: isoDateTime.optional(),
  })
  .strict();
export type PlanItemWorkflowContextPreview = z.infer<typeof planItemWorkflowContextPreviewSchema>;

export const planItemWorkflowReadinessSchema = z
  .object({
    state: z.enum(['not_evaluated', 'ready', 'blocked', 'stale']),
    can_evaluate: z.boolean(),
    blocker_codes: z.array(nonEmpty).default([]),
    evaluated_at: isoDateTime.optional(),
    evidence_digest: safeDigest.optional(),
  })
  .strict();
export type PlanItemWorkflowReadiness = z.infer<typeof planItemWorkflowReadinessSchema>;

export const planItemWorkflowExecutionRunSummarySchema = z
  .object({
    run_session_id: nonEmpty,
    status: nonEmpty,
    execution_package_version: z.number().int().nonnegative().optional(),
    input_capsule_digest: safeDigest.optional(),
    workspace_bundle_digest: safeDigest.optional(),
    codex_thread_id_digest: safeDigest.optional(),
    started_at: isoDateTime.optional(),
    updated_at: isoDateTime.optional(),
    finished_at: isoDateTime.optional(),
  })
  .strict();
export type PlanItemWorkflowExecutionRunSummary = z.infer<typeof planItemWorkflowExecutionRunSummarySchema>;

export const planItemWorkflowBlockerSchema = z
  .object({
    code: nonEmpty,
    status: z.enum(['active', 'resolved', 'stale']).optional(),
    related_object_type: workflowTransitionEvidenceObjectTypeSchema.optional(),
    related_object_id: nonEmpty.optional(),
    evidence_digest: safeDigest.optional(),
    created_at: isoDateTime.optional(),
  })
  .strict();
export type PlanItemWorkflowBlocker = z.infer<typeof planItemWorkflowBlockerSchema>;

export const planItemWorkflowPublicDtoSchema = z
  .object({
    id: nonEmpty,
    development_plan_id: nonEmpty,
    development_plan_item_id: nonEmpty,
    status: planItemWorkflowStatusSchema,
    active_boundary_summary_revision_id: nonEmpty.optional(),
    active_spec_doc_revision_id: nonEmpty.optional(),
    active_implementation_plan_doc_revision_id: nonEmpty.optional(),
    session: codexSessionPublicDtoSchema,
    queued_actions: z.array(planItemWorkflowQueuedActionSchema).default([]),
    timeline_events: z.array(planItemWorkflowTimelineEventSchema).default([]),
    context_preview: planItemWorkflowContextPreviewSchema.optional(),
    readiness: planItemWorkflowReadinessSchema.optional(),
    execution_run_summary: planItemWorkflowExecutionRunSummarySchema.optional(),
    blockers: z.array(planItemWorkflowBlockerSchema).default([]),
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict();
export type PlanItemWorkflowPublicDto = z.infer<typeof planItemWorkflowPublicDtoSchema>;
