import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);
const isoDateTime = z.string().datetime();

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
    codex_session_id: nonEmpty,
    codex_session_turn_id: nonEmpty.optional(),
    created_at: isoDateTime,
  })
  .strict();
export type PlanItemWorkflowTransition = z.infer<typeof planItemWorkflowTransitionSchema>;

export const workflowManualDecisionSchema = z
  .object({
    id: nonEmpty,
    workflow_id: nonEmpty,
    codex_session_id: nonEmpty,
    kind: workflowManualDecisionKindSchema,
    reason: nonEmpty,
    selected_codex_session_id: nonEmpty.optional(),
    related_object_type: workflowTransitionEvidenceObjectTypeSchema.optional(),
    related_object_id: nonEmpty.optional(),
    created_by_actor_id: nonEmpty,
    created_at: isoDateTime,
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

    if ((decision.related_object_type === undefined) !== (decision.related_object_id === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['related_object_id'],
        message: 'related_object_type and related_object_id must be provided together',
      });
    }
  });
export type WorkflowManualDecision = z.infer<typeof workflowManualDecisionSchema>;

export const codexSessionPublicDtoSchema = z
  .object({
    id: nonEmpty,
    status: codexSessionStatusSchema,
    role: codexSessionRoleSchema,
    continuity_state: z.enum(['ready', 'running', 'blocked', 'stale']),
    can_continue: z.boolean(),
    last_turn_at: isoDateTime.optional(),
    blocked_reason_code: nonEmpty.optional(),
  })
  .strict();
export type CodexSessionPublicDto = z.infer<typeof codexSessionPublicDtoSchema>;

export const planItemWorkflowPublicDtoSchema = z
  .object({
    id: nonEmpty,
    development_plan_id: nonEmpty,
    development_plan_item_id: nonEmpty,
    status: planItemWorkflowStatusSchema,
    active_codex_session_id: nonEmpty,
    active_boundary_summary_revision_id: nonEmpty.optional(),
    active_spec_doc_revision_id: nonEmpty.optional(),
    active_implementation_plan_doc_revision_id: nonEmpty.optional(),
    execution_package_id: nonEmpty.optional(),
    session: codexSessionPublicDtoSchema,
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict();
export type PlanItemWorkflowPublicDto = z.infer<typeof planItemWorkflowPublicDtoSchema>;
