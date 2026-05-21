import { z } from 'zod';

import { artifactRefSchema, changedFileSchema, checkResultSchema } from './executor.js';

const isoDateTimeSchema = z.string().datetime();

export const reviewPacketStatusSchema = z.enum(['draft', 'ready', 'in_review', 'completed', 'escalated', 'archived']);
export type ReviewPacketStatus = z.infer<typeof reviewPacketStatusSchema>;

export const reviewPacketDecisions = ['none', 'approved', 'changes_requested', 'need_more_context', 'escalate'] as const;
export const reviewDecisionSchema = z.enum(reviewPacketDecisions);
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

export const reviewSubmitDecisionSchema = z.enum(['approved', 'changes_requested']);
export type ReviewSubmitDecision = z.infer<typeof reviewSubmitDecisionSchema>;

export const requestedChangeSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().min(1),
    file_path: z.string().min(1).optional(),
    severity: z.enum(['minor', 'major', 'critical']).optional(),
    suggested_validation: z.string().min(1).optional(),
  })
  .strict();
export type RequestedChange = z.infer<typeof requestedChangeSchema>;

export const selfReviewInputSchema = z.object({
  run_session_id: z.string().min(1),
  execution_package_id: z.string().min(1),
  spec_revision_id: z.string().min(1),
  plan_revision_id: z.string().min(1),
  run_summary: z.string().min(1),
  changed_files: z.array(changedFileSchema),
  check_results: z.array(checkResultSchema),
  artifact_refs: z.array(artifactRefSchema),
  requested_changes_context: z.array(requestedChangeSchema).default([]),
});
export type SelfReviewInput = z.infer<typeof selfReviewInputSchema>;

export const selfReviewResultSchema = z
  .object({
    status: z.enum(['succeeded', 'failed']),
    summary: z.string().min(1),
    spec_plan_alignment: z.string().min(1),
    test_assessment: z.string().min(1),
    risk_notes: z.array(z.string().min(1)),
    follow_up_questions: z.array(z.string().min(1)),
    failure_message: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((result, ctx) => {
    if (result.status === 'failed' && !result.failure_message) {
      ctx.addIssue({
        code: 'custom',
        path: ['failure_message'],
        message: 'failure_message is required when self-review status is failed',
      });
    }

    if (result.status !== 'failed' && result.failure_message !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['failure_message'],
        message: 'failure_message is only allowed when self-review status is failed',
      });
    }
  });
export type SelfReviewResult = z.infer<typeof selfReviewResultSchema>;

export const reviewPacketTestMappingSchema = z
  .object({
    gate_id: z.string().min(1),
    result: z.enum(['passed', 'failed', 'not_required']),
    evidence_ref: z.string().min(1).optional(),
    rationale: z.string().min(1).optional(),
  })
  .strict();
export type ReviewPacketTestMapping = z.infer<typeof reviewPacketTestMappingSchema>;

export const independentAiReviewResultSchema = z
  .object({
    status: z.enum(['approved', 'changes_requested', 'failed']),
    summary: z.string().min(1),
    run_session_id: z.string().min(1).optional(),
    execution_package_id: z.string().min(1).optional(),
    risk_notes: z.array(z.string().min(1)).default([]),
    failure_message: z.string().min(1).optional(),
  })
  .strict();
export type IndependentAiReviewResult = z.infer<typeof independentAiReviewResultSchema>;

export const reviewPacketSchema = z
  .object({
    id: z.string().min(1),
    run_session_id: z.string().min(1),
    execution_package_id: z.string().min(1),
    reviewer_actor_id: z.string().min(1),
    spec_revision_id: z.string().min(1),
    plan_revision_id: z.string().min(1),
    status: reviewPacketStatusSchema,
    decision: reviewDecisionSchema,
    summary: z.string().min(1).optional(),
    changed_files: z.array(changedFileSchema),
    check_result_summary: z.string().min(1),
    self_review: selfReviewResultSchema,
    independent_ai_review: independentAiReviewResultSchema.optional(),
    test_mapping: z.array(reviewPacketTestMappingSchema).optional(),
    risk_notes: z.array(z.string().min(1)),
    reviewed_by_actor_id: z.string().min(1).optional(),
    reviewed_at: isoDateTimeSchema.optional(),
    requested_changes: z.array(requestedChangeSchema),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
    completed_at: isoDateTimeSchema.optional(),
  })
  .strict();
export type ReviewPacket = z.infer<typeof reviewPacketSchema>;

export const reviewDecisionPayloadSchema = z
  .object({
    review_packet_id: z.string().min(1),
    decision: reviewSubmitDecisionSchema,
    summary: z.string().min(1),
    requested_changes: z.array(requestedChangeSchema).default([]),
    reviewed_by_actor_id: z.string().min(1),
    reviewed_at: isoDateTimeSchema,
  })
  .superRefine((payload, ctx) => {
    if (payload.decision === 'changes_requested' && payload.requested_changes.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['requested_changes'],
        message: 'changes_requested decisions require at least one requested change',
      });
    }

    if (payload.decision === 'approved' && payload.requested_changes.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['requested_changes'],
        message: 'approved decisions cannot include requested changes',
      });
    }
  });
export type ReviewDecisionPayload = z.infer<typeof reviewDecisionPayloadSchema>;
