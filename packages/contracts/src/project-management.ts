import { z } from 'zod';

import { attachmentRefSchema } from './attachments.js';
import { objectRefSchema } from './product-object-ref.js';

const nonEmpty = z.string().trim().min(1);
const isoDateTimeSchema = z.string().datetime();

const reviewedAuthoritySchema = z.enum(['review_packet_approval', 'human_review_decision']);
const taskStaleStateSchema = z.enum(['current', 'stale_spec', 'stale_plan', 'stale_parent', 'manual_exception']);
const taskStatusSchema = z.enum(['todo', 'ready', 'in_progress', 'blocked', 'review', 'done', 'canceled']);
const objectLifecycleStatusSchema = z.string().trim().min(1);

const humanReviewDecisionRefSchema = z.object({ type: z.literal('human_review_decision'), id: nonEmpty }).strict();
const reviewPacketAuthorityRefSchema = z.object({ type: z.literal('review_packet'), id: nonEmpty }).strict();

export const reviewEvidenceRefSchema = z
  .object({
    id: nonEmpty,
    authority_type: reviewedAuthoritySchema,
    authority_ref: z.union([reviewPacketAuthorityRefSchema, humanReviewDecisionRefSchema]),
    scope_ref: objectRefSchema,
    status: z.enum(['missing', 'pending', 'approved', 'changes_requested', 'rejected', 'stale', 'blocked']),
    required: z.boolean(),
    reviewer_actor_id: nonEmpty.optional(),
    review_packet_id: nonEmpty.optional(),
    decision_id: nonEmpty.optional(),
    execution_package_id: nonEmpty.optional(),
    spec_revision_id: nonEmpty.optional(),
    plan_revision_id: nonEmpty.optional(),
    approved_at: isoDateTimeSchema.optional(),
    stale_reason: nonEmpty.optional(),
    attachment_refs: z.array(attachmentRefSchema).default([]),
  })
  .strict()
  .superRefine((evidence, ctx) => {
    if (evidence.authority_type === 'human_review_decision' && evidence.authority_ref.type !== 'human_review_decision') {
      ctx.addIssue({
        code: 'custom',
        path: ['authority_ref'],
        message: 'human review evidence must reference a human review decision',
      });
    }
    if (evidence.authority_type === 'review_packet_approval' && evidence.authority_ref.type !== 'review_packet') {
      ctx.addIssue({
        code: 'custom',
        path: ['authority_ref'],
        message: 'review packet evidence must reference a review packet',
      });
    }
  });
export type ReviewEvidenceRef = z.infer<typeof reviewEvidenceRefSchema>;

export const testAcceptanceEvidenceRefSchema = z
  .object({
    id: nonEmpty,
    scope_ref: objectRefSchema,
    evidence_type: z.enum(['test_result', 'qa_acceptance', 'product_acceptance', 'regression', 'integration_validation']),
    status: z.enum(['missing', 'pending', 'passed', 'failed', 'stale', 'blocked']),
    required: z.boolean(),
    actor_id: nonEmpty.optional(),
    attachment_refs: z.array(attachmentRefSchema).default([]),
    run_session_id: nonEmpty.optional(),
    review_packet_id: nonEmpty.optional(),
    created_at: isoDateTimeSchema.optional(),
    completed_at: isoDateTimeSchema.optional(),
    stale_reason: nonEmpty.optional(),
  })
  .strict();
export type TestAcceptanceEvidenceRef = z.infer<typeof testAcceptanceEvidenceRefSchema>;

export const productSafeDisabledReasonSchema = z
  .object({
    code: z.enum([
      'missing_required_review',
      'review_not_approved',
      'missing_required_test_acceptance',
      'test_acceptance_failed',
      'evidence_stale',
      'evidence_scope_mismatch',
      'evidence_revision_mismatch',
      'evidence_unauthorized',
      'evidence_tombstoned',
      'missing_package_run_evidence',
      'missing_observation_evidence',
    ]),
    message: nonEmpty,
    target_ref: objectRefSchema.optional(),
    remediation_route: nonEmpty.optional(),
  })
  .strict();
export type ProductSafeDisabledReason = z.infer<typeof productSafeDisabledReasonSchema>;

const testAcceptanceRequirementKinds = [
  'qa_acceptance',
  'product_acceptance',
  'regression',
  'integration_validation',
] as const;

export const evidenceRequirementStatusSchema = z
  .object({
    requirement_id: nonEmpty,
    scope_ref: objectRefSchema,
    kind: z.enum([
      'review',
      'qa_acceptance',
      'product_acceptance',
      'regression',
      'integration_validation',
      'package_run',
      'observation',
    ]),
    status: z.enum(['missing', 'pending', 'passed', 'failed', 'stale', 'blocked', 'unauthorized', 'tombstoned']),
    current_spec_revision_id: nonEmpty.optional(),
    evidence_spec_revision_id: nonEmpty.optional(),
    current_plan_revision_id: nonEmpty.optional(),
    evidence_plan_revision_id: nonEmpty.optional(),
    evidence_ref: z.union([reviewEvidenceRefSchema, testAcceptanceEvidenceRefSchema]).optional(),
    supporting_attachment_refs: z.array(attachmentRefSchema).optional(),
    disabled_reason: productSafeDisabledReasonSchema.optional(),
  })
  .strict()
  .superRefine((requirement, ctx) => {
    if (requirement.status !== 'passed') {
      return;
    }

    if (!requirement.evidence_ref) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence_ref'],
        message: 'passed readiness gates require typed evidence authority',
      });
      return;
    }

    if (!objectRefsMatch(requirement.evidence_ref.scope_ref, requirement.scope_ref)) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence_ref', 'scope_ref'],
        message: 'passed readiness evidence must match the gate scope',
      });
    }
    if (requirement.current_spec_revision_id !== undefined) {
      if (requirement.evidence_spec_revision_id === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence_spec_revision_id'],
          message: 'passed readiness gates require evidence Spec revision authority',
        });
      } else if (requirement.evidence_spec_revision_id !== requirement.current_spec_revision_id) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence_spec_revision_id'],
          message: 'passed readiness evidence must match the current Spec revision',
        });
      }
    }
    if (requirement.current_plan_revision_id !== undefined) {
      if (requirement.evidence_plan_revision_id === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence_plan_revision_id'],
          message: 'passed readiness gates require evidence Plan revision authority',
        });
      } else if (requirement.evidence_plan_revision_id !== requirement.current_plan_revision_id) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence_plan_revision_id'],
          message: 'passed readiness evidence must match the current Plan revision',
        });
      }
    }

    if (requirement.kind === 'review') {
      const reviewEvidence = reviewEvidenceRefSchema.safeParse(requirement.evidence_ref);
      if (!reviewEvidence.success) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence_ref'],
          message: 'passed review readiness gates require review evidence authority',
        });
        return;
      }
      if (reviewEvidence.data.status !== 'approved') {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence_ref', 'status'],
          message: 'passed review readiness gates require approved review evidence',
        });
      }
      return;
    }

    if (isTestAcceptanceRequirementKind(requirement.kind)) {
      const testEvidence = testAcceptanceEvidenceRefSchema.safeParse(requirement.evidence_ref);
      if (!testEvidence.success) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence_ref'],
          message: 'passed test readiness gates require test acceptance evidence authority',
        });
        return;
      }
      if (testEvidence.data.status !== 'passed') {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence_ref', 'status'],
          message: 'passed test readiness gates require passed test evidence',
        });
      }
      if (testEvidence.data.evidence_type !== requirement.kind) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence_ref', 'evidence_type'],
          message: 'test readiness evidence type must match the readiness gate kind',
        });
      }
    }
  });
export type EvidenceRequirementStatus = z.infer<typeof evidenceRequirementStatusSchema>;

function isTestAcceptanceRequirementKind(
  kind: EvidenceRequirementStatus['kind'],
): kind is (typeof testAcceptanceRequirementKinds)[number] {
  return (testAcceptanceRequirementKinds as readonly string[]).includes(kind);
}

function objectRefsMatch(left: z.infer<typeof objectRefSchema>, right: z.infer<typeof objectRefSchema>): boolean {
  return left.type === right.type && left.id === right.id;
}

export const releaseReadinessDetailSchema = z
  .object({
    release_id: nonEmpty,
    scope_refs: z.array(objectRefSchema),
    required_review_evidence: z.array(evidenceRequirementStatusSchema),
    required_test_acceptance_evidence: z.array(evidenceRequirementStatusSchema),
    package_run_evidence: z.array(evidenceRequirementStatusSchema),
    observation_evidence: z.array(evidenceRequirementStatusSchema),
    ready: z.boolean(),
    disabled_reasons: z.array(productSafeDisabledReasonSchema),
  })
  .strict();
export type ReleaseReadinessDetail = z.infer<typeof releaseReadinessDetailSchema>;

const auditedExceptionSchema = z
  .object({
    exception_id: nonEmpty,
    actor_id: nonEmpty,
    reason: nonEmpty,
    risk: z.enum(['low', 'medium', 'high', 'critical']),
    rollback_plan: nonEmpty,
    verification_ref: z.union([
      testAcceptanceEvidenceRefSchema,
      z.object({ type: z.literal('audited_exception_decision'), id: nonEmpty }).strict(),
    ]),
    supporting_attachment_refs: z.array(attachmentRefSchema).default([]),
    release_impact: z.enum(['none', 'release_scoped']),
    created_at: isoDateTimeSchema,
  })
  .strict();
export type AuditedException = z.infer<typeof auditedExceptionSchema>;

const objectListItemBaseSchema = z
  .object({
    id: nonEmpty,
    ref: objectRefSchema,
    title: nonEmpty,
    status: objectLifecycleStatusSchema,
    priority: nonEmpty.optional(),
    risk: nonEmpty.optional(),
    driver_actor_id: nonEmpty.optional(),
    updated_at: isoDateTimeSchema.optional(),
  })
  .strict();

const objectDetailBaseSchema = objectListItemBaseSchema
  .extend({
    narrative_markdown: z.string().default(''),
    evidence_refs: z.array(objectRefSchema).default([]),
    attachment_refs: z.array(attachmentRefSchema).default([]),
  })
  .strict();

const specObjectRefSchema = z.object({ type: z.literal('spec'), id: nonEmpty, title: nonEmpty.optional() }).strict();
const planObjectRefSchema = z.object({ type: z.literal('plan'), id: nonEmpty, title: nonEmpty.optional() }).strict();

const revisionSummarySchema = z
  .object({
    id: nonEmpty,
    revision_number: z.number().int().min(1),
    summary: nonEmpty,
    author_actor_id: nonEmpty.optional(),
    created_at: isoDateTimeSchema.optional(),
    approved_at: isoDateTimeSchema.optional(),
    approved_by_actor_id: nonEmpty.optional(),
    attachment_refs: z.array(attachmentRefSchema).default([]),
  })
  .strict();

export const specPlanQueueItemSchema = z
  .object({
    id: nonEmpty,
    entity_type: z.enum(['spec', 'plan']),
    title: nonEmpty,
    source_ref: objectRefSchema,
    status: nonEmpty,
    gate_state: nonEmpty,
    current_revision_id: nonEmpty.optional(),
    approved_revision_id: nonEmpty.optional(),
    updated_at: isoDateTimeSchema.optional(),
    href: nonEmpty.optional(),
  })
  .strict();
export type SpecPlanQueueItem = z.infer<typeof specPlanQueueItemSchema>;

export const specDetailSchema = z
  .object({
    id: nonEmpty,
    ref: specObjectRefSchema,
    source_ref: objectRefSchema,
    title: nonEmpty,
    status: nonEmpty,
    gate_state: nonEmpty,
    current_revision_id: nonEmpty.optional(),
    approved_revision_id: nonEmpty.optional(),
    current_revision: revisionSummarySchema.optional(),
    revisions: z.array(revisionSummarySchema).default([]),
    narrative_markdown: z.string().default(''),
    attachment_refs: z.array(attachmentRefSchema).default([]),
  })
  .strict();
export type SpecDetail = z.infer<typeof specDetailSchema>;

export const planDetailSchema = z
  .object({
    id: nonEmpty,
    ref: planObjectRefSchema,
    source_ref: objectRefSchema,
    title: nonEmpty,
    status: nonEmpty,
    gate_state: nonEmpty,
    current_revision_id: nonEmpty.optional(),
    approved_revision_id: nonEmpty.optional(),
    current_revision: revisionSummarySchema.optional(),
    revisions: z.array(revisionSummarySchema).default([]),
    narrative_markdown: z.string().default(''),
    attachment_refs: z.array(attachmentRefSchema).default([]),
    based_on_spec_revision_id: nonEmpty.optional(),
    task_refs: z.array(objectRefSchema).default([]),
  })
  .strict();
export type PlanDetail = z.infer<typeof planDetailSchema>;

export const myWorkQueueItemSchema = z
  .object({
    id: nonEmpty,
    object_ref: objectRefSchema,
    title: nonEmpty,
    attention_reason: nonEmpty,
    expected_action: nonEmpty.optional(),
    actor_id: nonEmpty.optional(),
    due_at: isoDateTimeSchema.optional(),
    href: nonEmpty.optional(),
  })
  .strict();
export type MyWorkQueueItem = z.infer<typeof myWorkQueueItemSchema>;

export const initiativeListItemSchema = objectListItemBaseSchema.extend({
  business_outcome: nonEmpty.optional(),
});
export type InitiativeListItem = z.infer<typeof initiativeListItemSchema>;

export const initiativeDetailSchema = objectDetailBaseSchema.extend({
  child_refs: z.array(objectRefSchema).default([]),
  milestone_intent: nonEmpty.optional(),
  release_refs: z.array(objectRefSchema).default([]),
});
export type InitiativeDetail = z.infer<typeof initiativeDetailSchema>;

export const requirementListItemSchema = objectListItemBaseSchema.extend({
  phase: nonEmpty.optional(),
});
export type RequirementListItem = z.infer<typeof requirementListItemSchema>;

export const requirementDetailSchema = objectDetailBaseSchema.extend({
  spec_ref: objectRefSchema.optional(),
  plan_ref: objectRefSchema.optional(),
  task_refs: z.array(objectRefSchema).default([]),
  bug_refs: z.array(objectRefSchema).default([]),
  release_refs: z.array(objectRefSchema).default([]),
});
export type RequirementDetail = z.infer<typeof requirementDetailSchema>;

export const techDebtListItemSchema = objectListItemBaseSchema.extend({
  affected_modules: z.array(nonEmpty).default([]),
});
export type TechDebtListItem = z.infer<typeof techDebtListItemSchema>;

export const techDebtDetailSchema = objectDetailBaseSchema.extend({
  affected_modules: z.array(nonEmpty).default([]),
  validation_strategy: nonEmpty.optional(),
  spec_ref: objectRefSchema.optional(),
  plan_ref: objectRefSchema.optional(),
  task_refs: z.array(objectRefSchema).default([]),
});
export type TechDebtDetail = z.infer<typeof techDebtDetailSchema>;

export const bugListItemSchema = objectListItemBaseSchema.extend({
  severity: nonEmpty.optional(),
});
export type BugListItem = z.infer<typeof bugListItemSchema>;

export const bugDetailSchema = objectDetailBaseSchema.extend({
  observed_behavior: nonEmpty.optional(),
  expected_behavior: nonEmpty.optional(),
  reproduction_steps: z.array(nonEmpty).default([]),
  task_refs: z.array(objectRefSchema).default([]),
});
export type BugDetail = z.infer<typeof bugDetailSchema>;

export const taskListItemSchema = z
  .object({
    id: nonEmpty,
    ref: objectRefSchema,
    title: nonEmpty,
    status: taskStatusSchema,
    parent_ref: objectRefSchema.optional(),
    driver_actor_id: nonEmpty.optional(),
    package_generation_eligible: z.boolean().default(false),
    updated_at: isoDateTimeSchema.optional(),
  })
  .strict();
export type TaskListItem = z.infer<typeof taskListItemSchema>;

export const taskDetailSchema = taskListItemSchema
  .extend({
    narrative_markdown: z.string().default(''),
    acceptance_checklist: z.array(nonEmpty).default([]),
    controlling_spec_revision_id: nonEmpty.optional(),
    controlling_plan_revision_id: nonEmpty.optional(),
    stale_state: taskStaleStateSchema,
    audited_exception: auditedExceptionSchema.optional(),
    attachment_refs: z.array(attachmentRefSchema).default([]),
  })
  .omit({ ref: true, status: true, updated_at: true, driver_actor_id: true })
  .strict()
  .superRefine((task, ctx) => {
    if (task.stale_state === 'manual_exception' && !task.audited_exception) {
      ctx.addIssue({
        code: 'custom',
        path: ['audited_exception'],
        message: 'manual_exception tasks require an audited_exception block',
      });
    }
    if (task.package_generation_eligible) {
      if (!task.controlling_spec_revision_id || !task.controlling_plan_revision_id || task.stale_state !== 'current') {
        ctx.addIssue({
          code: 'custom',
          path: ['package_generation_eligible'],
          message: 'package generation requires current approved Spec and Plan revision authority',
        });
      }
    }
    if (task.stale_state === 'manual_exception' && task.package_generation_eligible) {
      ctx.addIssue({
        code: 'custom',
        path: ['audited_exception'],
        message: 'manual_exception cannot authorize runtime package generation',
      });
    }
  });
export type TaskDetail = z.infer<typeof taskDetailSchema>;

export const boardCardSchema = z
  .object({
    id: nonEmpty,
    object_ref: objectRefSchema,
    title: nonEmpty,
    column_id: nonEmpty,
    status: nonEmpty,
    priority: nonEmpty.optional(),
    risk: nonEmpty.optional(),
    driver_actor_id: nonEmpty.optional(),
    blocked: z.boolean().default(false),
    href: nonEmpty.optional(),
  })
  .strict();
export type BoardCard = z.infer<typeof boardCardSchema>;
