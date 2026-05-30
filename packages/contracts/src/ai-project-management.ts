import { z } from 'zod';

import { productObjectRefSchema, runtimeEvidenceObjectRefSchema, planningInputRefSchema } from './product-object-ref.js';

const nonEmpty = z.string().trim().min(1);
const isoDateTimeSchema = z.string().datetime();

export const developmentPlanStatusSchema = z.enum(['draft', 'active', 'approved', 'archived']);
export type DevelopmentPlanStatus = z.infer<typeof developmentPlanStatusSchema>;

export const developmentPlanItemBoundaryStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'approved',
  'changes_requested',
  'stale',
]);
export type DevelopmentPlanItemBoundaryStatus = z.infer<typeof developmentPlanItemBoundaryStatusSchema>;

export const artifactReviewStatusSchema = z.enum([
  'missing',
  'draft',
  'in_review',
  'approved',
  'changes_requested',
  'stale',
  'blocked',
]);
export type ArtifactReviewStatus = z.infer<typeof artifactReviewStatusSchema>;

export const executionStatusSchema = z.enum([
  'not_started',
  'ready',
  'running',
  'paused',
  'interrupted',
  'failed',
  'completed',
  'awaiting_code_review',
  'qa_handoff_pending',
]);
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

export const contextManifestSchema = z
  .object({
    id: nonEmpty,
    revision_id: nonEmpty,
    source_ref: planningInputRefSchema,
    development_plan_id: nonEmpty.optional(),
    development_plan_revision_id: nonEmpty.optional(),
    development_plan_item_id: nonEmpty.optional(),
    development_plan_item_revision_id: nonEmpty.optional(),
    brainstorming_session_id: nonEmpty.optional(),
    brainstorming_session_revision_id: nonEmpty.optional(),
    boundary_summary_id: nonEmpty.optional(),
    boundary_summary_revision_id: nonEmpty.optional(),
    boundary_approver_actor_id: nonEmpty.optional(),
    boundary_approved_at: isoDateTimeSchema.optional(),
    approved_spec_revision_id: nonEmpty.optional(),
    sources: z.array(z.object({ type: nonEmpty, ref: nonEmpty, digest: nonEmpty.optional() }).strict()).default([]),
    generated_at: isoDateTimeSchema,
    runtime_identity: nonEmpty.optional(),
  })
  .strict();
export type ContextManifest = z.infer<typeof contextManifestSchema>;

export const developmentPlanItemSchema = z
  .object({
    id: nonEmpty,
    development_plan_id: nonEmpty,
    revision_id: nonEmpty,
    title: nonEmpty,
    summary: nonEmpty,
    driver_actor_id: nonEmpty.optional(),
    responsible_role: z.enum(['product', 'tech_lead', 'developer', 'qa', 'release_owner', 'manager']),
    reviewer_actor_id: nonEmpty.optional(),
    leader_actor_id: nonEmpty.optional(),
    leader_delegate_actor_ids: z.array(nonEmpty).default([]),
    risk: z.enum(['low', 'medium', 'high', 'critical']),
    dependency_hints: z.array(nonEmpty).default([]),
    affected_surfaces: z.array(nonEmpty).default([]),
    boundary_status: developmentPlanItemBoundaryStatusSchema,
    spec_status: artifactReviewStatusSchema,
    implementation_plan_status: artifactReviewStatusSchema,
    execution_status: executionStatusSchema,
    review_status: artifactReviewStatusSchema,
    qa_handoff_status: artifactReviewStatusSchema,
    release_impact: z.enum(['none', 'release_scoped', 'release_blocking']),
    next_action: nonEmpty,
    updated_at: isoDateTimeSchema,
  })
  .strict();
export type DevelopmentPlanItem = z.infer<typeof developmentPlanItemSchema>;

export const developmentPlanSchema = z
  .object({
    id: nonEmpty,
    revision_id: nonEmpty,
    title: nonEmpty,
    status: developmentPlanStatusSchema,
    source_refs: z.array(planningInputRefSchema).default([]),
    items: z.array(developmentPlanItemSchema).default([]),
    created_at: isoDateTimeSchema.optional(),
    updated_at: isoDateTimeSchema,
  })
  .strict();
export type DevelopmentPlan = z.infer<typeof developmentPlanSchema>;

export const brainstormingQuestionSchema = z
  .object({
    id: nonEmpty,
    round_id: nonEmpty.optional(),
    text: nonEmpty,
    author_id: nonEmpty,
    created_at: isoDateTimeSchema,
    status: z.enum(['open', 'answered', 'resolved', 'superseded']),
    required: z.boolean().default(false),
    rationale: nonEmpty.optional(),
    answered_by_answer_id: nonEmpty.optional(),
    waived_by_decision_id: nonEmpty.optional(),
  })
  .strict();
export type BrainstormingQuestion = z.infer<typeof brainstormingQuestionSchema>;

export const brainstormingAnswerSchema = z
  .object({
    id: nonEmpty,
    question_id: nonEmpty,
    round_id: nonEmpty.optional(),
    text: nonEmpty,
    actor_id: nonEmpty,
    actor_role: z.enum(['leader', 'delegate', 'ai', 'driver', 'reviewer', 'observer']).optional(),
    answered_for_actor_id: nonEmpty.optional(),
    created_at: isoDateTimeSchema,
  })
  .strict();
export type BrainstormingAnswer = z.infer<typeof brainstormingAnswerSchema>;

export const brainstormingDecisionSchema = z
  .object({
    id: nonEmpty,
    round_id: nonEmpty.optional(),
    text: nonEmpty,
    actor_id: nonEmpty,
    actor_role: z.enum(['leader', 'delegate', 'ai', 'driver', 'reviewer', 'observer']).optional(),
    source: z.enum(['leader', 'delegate', 'ai_proposed', 'driver', 'reviewer']).default('leader'),
    state: z.enum(['proposed', 'accepted', 'rejected', 'superseded']).default('accepted'),
    rationale: nonEmpty.optional(),
    created_at: isoDateTimeSchema,
  })
  .strict();
export type BrainstormingDecision = z.infer<typeof brainstormingDecisionSchema>;

export const boundarySessionStatusSchema = z.enum([
  'draft',
  'ai_turn_running',
  'waiting_for_leader',
  'summary_proposed',
  'approved',
  'changes_requested',
  'stale',
  'cancelled',
]);
export type BoundarySessionStatus = z.infer<typeof boundarySessionStatusSchema>;

const boundaryBrainstormingSessionProcessShape = {
  development_plan_revision_id: nonEmpty,
  leader_actor_id: nonEmpty,
  leader_delegate_actor_ids: z.array(nonEmpty).default([]),
  status: boundarySessionStatusSchema,
  current_round_id: nonEmpty.optional(),
  latest_summary_revision_id: nonEmpty.optional(),
  approved_summary_revision_id: nonEmpty.optional(),
  closed_at: isoDateTimeSchema.optional(),
} satisfies z.ZodRawShape;

export const boundaryRoundSchema = z
  .object({
    id: nonEmpty,
    session_id: nonEmpty,
    session_revision_id: nonEmpty,
    round_number: z.number().int().positive(),
    trigger: z.enum([
      'start',
      'leader_answer',
      'leader_revision_request',
      'ai_follow_up',
      'summary_proposal',
      'approval_request',
    ]),
    leader_input_markdown: nonEmpty.optional(),
    ai_output_markdown: nonEmpty.optional(),
    runtime_job_id: nonEmpty.optional(),
    runtime_profile_revision_id: nonEmpty.optional(),
    credential_binding_version_id: nonEmpty.optional(),
    app_server_thread_digest: nonEmpty.optional(),
    app_server_turn_digest: nonEmpty.optional(),
    status: z.enum(['queued', 'running', 'waiting_for_leader', 'summary_proposed', 'terminal', 'failed']),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
  })
  .strict();
export type BoundaryRound = z.infer<typeof boundaryRoundSchema>;

export const brainstormingSessionSchema = z
  .object({
    id: nonEmpty,
    revision_id: nonEmpty,
    source_ref: planningInputRefSchema,
    development_plan_id: nonEmpty,
    ...boundaryBrainstormingSessionProcessShape,
    development_plan_item_id: nonEmpty,
    development_plan_item_revision_id: nonEmpty,
    context_manifest_id: nonEmpty,
    context_manifest_revision_id: nonEmpty,
    questions: z.array(brainstormingQuestionSchema).default([]),
    answers: z.array(brainstormingAnswerSchema).default([]),
    decisions: z.array(brainstormingDecisionSchema).default([]),
    approval_state: z.enum(['draft', 'questions_open', 'ready_for_approval', 'approved', 'changes_requested']),
    boundary_summary_id: nonEmpty.optional(),
    approver_actor_id: nonEmpty.optional(),
    approved_at: isoDateTimeSchema.optional(),
    created_at: isoDateTimeSchema.optional(),
    updated_at: isoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((session, ctx) => {
    if (session.status === 'approved' && session.approval_state !== 'approved') {
      ctx.addIssue({
        code: 'custom',
        path: ['approval_state'],
        message: 'approved Boundary Brainstorming status requires approval_state approved',
      });
    }

    if (session.approval_state !== 'approved') {
      return;
    }

    if (session.questions.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['questions'],
        message: 'approved brainstorming sessions require recorded questions',
      });
    }
    if (session.answers.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['answers'],
        message: 'approved brainstorming sessions require recorded answers',
      });
    }
    if (session.decisions.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['decisions'],
        message: 'approved brainstorming sessions require recorded decisions',
      });
    }
    if (!session.boundary_summary_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['boundary_summary_id'],
        message: 'approved brainstorming sessions require a boundary summary',
      });
    }
    if (!session.approver_actor_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['approver_actor_id'],
        message: 'approved brainstorming sessions require an approver',
      });
    }
    if (!session.approved_at) {
      ctx.addIssue({
        code: 'custom',
        path: ['approved_at'],
        message: 'approved brainstorming sessions require an approval timestamp',
      });
    }
  });
export type BrainstormingSession = z.infer<typeof brainstormingSessionSchema>;

export const boundarySummarySchema = z
  .object({
    id: nonEmpty,
    revision_id: nonEmpty,
    brainstorming_session_id: nonEmpty,
    brainstorming_session_revision_id: nonEmpty,
    development_plan_id: nonEmpty,
    development_plan_item_id: nonEmpty,
    development_plan_item_revision_id: nonEmpty,
    source_ref: planningInputRefSchema,
    summary: nonEmpty,
    approved_by_actor_id: nonEmpty.optional(),
    approved_at: isoDateTimeSchema.optional(),
  })
  .strict();
export type BoundarySummary = z.infer<typeof boundarySummarySchema>;

export const boundarySummaryRevisionSchema = z
  .object({
    id: nonEmpty,
    boundary_summary_id: nonEmpty,
    session_id: nonEmpty,
    session_revision_id: nonEmpty,
    source_round_id: nonEmpty,
    development_plan_id: nonEmpty,
    development_plan_item_id: nonEmpty,
    development_plan_item_revision_id: nonEmpty,
    revision_number: z.number().int().positive(),
    status: z.enum(['draft', 'proposed', 'approved', 'changes_requested', 'stale', 'superseded']),
    summary_markdown: nonEmpty,
    confirmed_scope: z.array(nonEmpty).default([]),
    confirmed_out_of_scope: z.array(nonEmpty).default([]),
    accepted_assumptions: z.array(nonEmpty).default([]),
    open_risks: z.array(nonEmpty).default([]),
    validation_expectations: z.array(nonEmpty).default([]),
    question_answer_snapshot: z
      .array(
        z
          .object({
            question_id: nonEmpty,
            answer_id: nonEmpty,
            text: nonEmpty,
          })
          .strict(),
      )
      .default([]),
    decision_snapshot: z
      .array(
        z
          .object({
            decision_id: nonEmpty,
            text: nonEmpty,
            rationale: nonEmpty.optional(),
          })
          .strict(),
      )
      .default([]),
    context_manifest_id: nonEmpty,
    context_manifest_revision_id: nonEmpty,
    approved_by_actor_id: nonEmpty.optional(),
    approved_at: isoDateTimeSchema.optional(),
    created_at: isoDateTimeSchema,
  })
  .strict()
  .superRefine((revision, ctx) => {
    if (revision.status !== 'approved') {
      return;
    }
    if (revision.question_answer_snapshot.length === 0 || revision.decision_snapshot.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['question_answer_snapshot'],
        message: 'approved Boundary Summary must include question and decision evidence',
      });
    }
    if (revision.approved_by_actor_id === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['approved_by_actor_id'],
        message: 'approved Boundary Summary must include an approver',
      });
    }
    if (revision.approved_at === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['approved_at'],
        message: 'approved Boundary Summary must include an approval timestamp',
      });
    }
  });
export type BoundarySummaryRevision = z.infer<typeof boundarySummaryRevisionSchema>;

export const executionSchema = z
  .object({
    id: nonEmpty,
    development_plan_item_id: nonEmpty,
    approved_spec_revision_id: nonEmpty,
    approved_spec_revision_ref: z
      .object({
        type: z.literal('spec_revision'),
        id: nonEmpty,
        spec_id: nonEmpty,
        title: nonEmpty.optional(),
      })
      .strict(),
    implementation_plan_revision_id: nonEmpty,
    ref: z.object({ type: z.literal('execution'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
    development_plan_item_ref: z
      .object({
        type: z.literal('development_plan_item'),
        id: nonEmpty,
        development_plan_id: nonEmpty,
        revision_id: nonEmpty.optional(),
        title: nonEmpty.optional(),
      })
      .strict(),
    implementation_plan_revision_ref: z
      .object({
        type: z.literal('implementation_plan_revision'),
        id: nonEmpty,
        implementation_plan_id: nonEmpty,
        title: nonEmpty.optional(),
      })
      .strict(),
    status: executionStatusSchema,
    worker_state: nonEmpty.optional(),
    current_step: nonEmpty.optional(),
    source_ref: planningInputRefSchema.optional(),
    stale: z.boolean().optional(),
    blocked: z.boolean().optional(),
    last_event_at: isoDateTimeSchema.optional(),
    last_event_summary: nonEmpty.optional(),
    interrupt_history: z
      .array(z.object({ at: isoDateTimeSchema.optional(), reason: nonEmpty.optional() }).strict())
      .default([]),
    continuation_history: z
      .array(z.object({ at: isoDateTimeSchema.optional(), summary: nonEmpty.optional() }).strict())
      .default([]),
    evidence_refs: z.array(productObjectRefSchema).default([]),
    runtime_evidence_refs: z.array(runtimeEvidenceObjectRefSchema).default([]),
    pr_refs: z.array(z.object({ id: nonEmpty, title: nonEmpty.optional() }).strict()).default([]),
    diff_refs: z.array(z.object({ id: nonEmpty, title: nonEmpty.optional() }).strict()).default([]),
    test_evidence_refs: z.array(z.object({ id: nonEmpty, title: nonEmpty.optional() }).strict()).default([]),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
  })
  .strict()
  .superRefine((execution, ctx) => {
    if (execution.approved_spec_revision_ref.id !== execution.approved_spec_revision_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['approved_spec_revision_ref', 'id'],
        message: 'approved_spec_revision_ref.id must match approved_spec_revision_id',
      });
    }
  });
export type Execution = z.infer<typeof executionSchema>;

export const codeReviewHandoffStatusSchema = z.enum(['in_review', 'approved', 'changes_requested']);
export type CodeReviewHandoffStatus = z.infer<typeof codeReviewHandoffStatusSchema>;

export const codeReviewAuditedExceptionSchema = z
  .object({
    actor_id: nonEmpty,
    reason: nonEmpty,
    risk: z.enum(['low', 'medium', 'high', 'critical']),
    rollback_plan: nonEmpty,
    created_at: isoDateTimeSchema,
  })
  .strict();
export type CodeReviewAuditedException = z.infer<typeof codeReviewAuditedExceptionSchema>;

export const codeReviewHandoffSchema = z
  .object({
    id: nonEmpty,
    ref: z.object({ type: z.literal('code_review_handoff'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
    execution_id: nonEmpty,
    development_plan_item_id: nonEmpty,
    implementation_plan_revision_id: nonEmpty,
    reviewer_actor_id: nonEmpty,
    status: codeReviewHandoffStatusSchema,
    summary: nonEmpty,
    changed_surfaces: z.array(nonEmpty).default([]),
    verification_evidence_refs: z.array(productObjectRefSchema).default([]),
    approved_by_actor_id: nonEmpty.optional(),
    approved_at: isoDateTimeSchema.optional(),
    decision_rationale: nonEmpty.optional(),
    audited_exception: codeReviewAuditedExceptionSchema.optional(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
  })
  .strict();
export type CodeReviewHandoff = z.infer<typeof codeReviewHandoffSchema>;

export const qaHandoffStatusSchema = z.enum(['pending', 'blocked', 'accepted']);
export type QaHandoffStatus = z.infer<typeof qaHandoffStatusSchema>;

export const qaHandoffSchema = z
  .object({
    id: nonEmpty,
    ref: z.object({ type: z.literal('qa_handoff'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
    code_review_handoff_id: nonEmpty,
    execution_id: nonEmpty,
    source_ref: planningInputRefSchema,
    development_plan_item_id: nonEmpty,
    development_plan_item_ref: z
      .object({
        type: z.literal('development_plan_item'),
        id: nonEmpty,
        development_plan_id: nonEmpty,
        revision_id: nonEmpty.optional(),
        title: nonEmpty.optional(),
      })
      .strict(),
    approved_spec_revision_ref: z.object({ type: z.literal('spec_revision'), id: nonEmpty, spec_id: nonEmpty, title: nonEmpty.optional() }).strict(),
    approved_implementation_plan_revision_ref: z
      .object({
        type: z.literal('implementation_plan_revision'),
        id: nonEmpty,
        implementation_plan_id: nonEmpty,
        title: nonEmpty.optional(),
      })
      .strict(),
    status: qaHandoffStatusSchema,
    acceptance_criteria: z.array(nonEmpty).default([]),
    test_strategy: nonEmpty,
    verification_evidence_refs: z.array(productObjectRefSchema).default([]),
    known_risks: z.array(nonEmpty).default([]),
    changed_surfaces: z.array(nonEmpty).default([]),
    release_impact: z.enum(['none', 'release_scoped', 'release_blocking']),
    blocked_by_actor_id: nonEmpty.optional(),
    accepted_by_actor_id: nonEmpty.optional(),
    rationale: nonEmpty.optional(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
  })
  .strict();
export type QaHandoff = z.infer<typeof qaHandoffSchema>;
