import { z } from 'zod';

import { productHrefSchema } from './api.js';
import { attachmentRefSchema } from './attachments.js';
import {
  objectRefSchema,
  productObjectRefSchema,
  productQueryObjectRefSchema,
} from './product-object-ref.js';

const nonEmpty = z.string().trim().min(1);
const isoDateTimeSchema = z.string().datetime();

const reviewedAuthoritySchema = z.enum(['code_review_handoff_approval', 'human_review_decision']);
const objectLifecycleStatusSchema = z.string().trim().min(1);
const evidenceRunStatusSchema = z.enum(['missing', 'pending', 'passed', 'failed', 'stale', 'blocked']);
const revisionAuthoritySchema = z.enum(['current_approved', 'missing', 'stale', 'unapproved']);

const humanReviewDecisionRefSchema = z.object({ type: z.literal('human_review_decision'), id: nonEmpty }).strict();
const codeReviewHandoffAuthorityRefSchema = z.object({ type: z.literal('code_review_handoff'), id: nonEmpty }).strict();
const initiativeObjectRefSchema = z.object({ type: z.literal('initiative'), id: nonEmpty, title: nonEmpty.optional() }).strict();
const requirementObjectRefSchema = z.object({ type: z.literal('requirement'), id: nonEmpty, title: nonEmpty.optional() }).strict();
const techDebtObjectRefSchema = z.object({ type: z.literal('tech_debt'), id: nonEmpty, title: nonEmpty.optional() }).strict();
const bugObjectRefSchema = z.object({ type: z.literal('bug'), id: nonEmpty, title: nonEmpty.optional() }).strict();
const specObjectRefSchema = z.object({ type: z.literal('spec'), id: nonEmpty, title: nonEmpty.optional() }).strict();
const executionPlanObjectRefSchema = z.object({ type: z.literal('execution_plan'), id: nonEmpty, title: nonEmpty.optional() }).strict();
const releaseObjectRefSchema = z.object({ type: z.literal('release'), id: nonEmpty, title: nonEmpty.optional() }).strict();
const executionObjectRefSchema = z.object({ type: z.literal('execution'), id: nonEmpty, title: nonEmpty.optional() }).strict();
const codeReviewHandoffObjectRefSchema = z
  .object({ type: z.literal('code_review_handoff'), id: nonEmpty, title: nonEmpty.optional() })
  .strict();

export const reviewEvidenceRefSchema = z
  .object({
    id: nonEmpty,
    authority_type: reviewedAuthoritySchema,
    authority_ref: z.union([codeReviewHandoffAuthorityRefSchema, humanReviewDecisionRefSchema]),
    scope_ref: objectRefSchema,
    status: z.enum(['missing', 'pending', 'approved', 'changes_requested', 'rejected', 'stale', 'blocked']),
    required: z.boolean(),
    reviewer_actor_id: nonEmpty.optional(),
    code_review_handoff_id: nonEmpty.optional(),
    decision_id: nonEmpty.optional(),
    execution_id: nonEmpty.optional(),
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
    if (evidence.authority_type === 'code_review_handoff_approval' && evidence.authority_ref.type !== 'code_review_handoff') {
      ctx.addIssue({
        code: 'custom',
        path: ['authority_ref'],
        message: 'code review evidence must reference a code review handoff',
      });
    }
    if (
      evidence.authority_type === 'human_review_decision' &&
      evidence.authority_ref.type === 'human_review_decision' &&
      evidence.decision_id !== undefined &&
      evidence.decision_id !== evidence.authority_ref.id
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['decision_id'],
        message: 'human review decision id must match authority_ref.id',
      });
    }
    if (
      evidence.authority_type === 'code_review_handoff_approval' &&
      evidence.authority_ref.type === 'code_review_handoff' &&
      evidence.code_review_handoff_id !== undefined &&
      evidence.code_review_handoff_id !== evidence.authority_ref.id
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['code_review_handoff_id'],
        message: 'code review handoff id must match authority_ref.id',
      });
    }
  });
export type ReviewEvidenceRef = z.infer<typeof reviewEvidenceRefSchema>;

export const testAcceptanceEvidenceRefSchema = z
  .object({
    id: nonEmpty,
    scope_ref: objectRefSchema,
    evidence_type: z.enum(['test_result', 'qa_acceptance', 'product_acceptance', 'regression', 'integration_validation']),
    status: evidenceRunStatusSchema,
    required: z.boolean(),
    actor_id: nonEmpty.optional(),
    attachment_refs: z.array(attachmentRefSchema).default([]),
    execution_id: nonEmpty.optional(),
    code_review_handoff_id: nonEmpty.optional(),
    created_at: isoDateTimeSchema.optional(),
    completed_at: isoDateTimeSchema.optional(),
    stale_reason: nonEmpty.optional(),
  })
  .strict();
export type TestAcceptanceEvidenceRef = z.infer<typeof testAcceptanceEvidenceRefSchema>;

export const packageRunEvidenceRefSchema = z
  .object({
    id: nonEmpty,
    scope_ref: objectRefSchema,
    evidence_type: z.literal('package_run'),
    status: evidenceRunStatusSchema,
    required: z.boolean(),
    execution_ref: executionObjectRefSchema,
    created_at: isoDateTimeSchema.optional(),
    completed_at: isoDateTimeSchema.optional(),
    stale_reason: nonEmpty.optional(),
    attachment_refs: z.array(attachmentRefSchema).default([]),
  })
  .strict();
export type PackageRunEvidenceRef = z.infer<typeof packageRunEvidenceRefSchema>;

export const observationEvidenceRefSchema = z
  .object({
    id: nonEmpty,
    scope_ref: objectRefSchema,
    evidence_type: z.literal('observation'),
    status: evidenceRunStatusSchema,
    required: z.boolean(),
    observation_ref: z.union([releaseObjectRefSchema, codeReviewHandoffObjectRefSchema]),
    created_at: isoDateTimeSchema.optional(),
    completed_at: isoDateTimeSchema.optional(),
    stale_reason: nonEmpty.optional(),
    attachment_refs: z.array(attachmentRefSchema).default([]),
  })
  .strict();
export type ObservationEvidenceRef = z.infer<typeof observationEvidenceRefSchema>;

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
    evidence_ref: z
      .union([reviewEvidenceRefSchema, testAcceptanceEvidenceRefSchema, packageRunEvidenceRefSchema, observationEvidenceRefSchema])
      .optional(),
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
    if (!requirement.current_spec_revision_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['current_spec_revision_id'],
        message: 'passed readiness gates require current Spec revision authority',
      });
    }
    if (!requirement.evidence_spec_revision_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence_spec_revision_id'],
        message: 'passed readiness gates require evidence Spec revision authority',
      });
    }
    if (
      requirement.current_spec_revision_id !== undefined &&
      requirement.evidence_spec_revision_id !== undefined &&
      requirement.evidence_spec_revision_id !== requirement.current_spec_revision_id
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence_spec_revision_id'],
        message: 'passed readiness evidence must match the current Spec revision',
      });
    }
    if (!requirement.current_plan_revision_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['current_plan_revision_id'],
        message: 'passed readiness gates require current Plan revision authority',
      });
    }
    if (!requirement.evidence_plan_revision_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence_plan_revision_id'],
        message: 'passed readiness gates require evidence Plan revision authority',
      });
    }
    if (
      requirement.current_plan_revision_id !== undefined &&
      requirement.evidence_plan_revision_id !== undefined &&
      requirement.evidence_plan_revision_id !== requirement.current_plan_revision_id
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence_plan_revision_id'],
        message: 'passed readiness evidence must match the current Plan revision',
      });
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
      if (
        reviewEvidence.data.spec_revision_id !== undefined &&
        requirement.evidence_spec_revision_id !== undefined &&
        reviewEvidence.data.spec_revision_id !== requirement.evidence_spec_revision_id
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence_ref', 'spec_revision_id'],
          message: 'review evidence Spec revision must match the gate evidence Spec revision',
        });
      }
      if (
        reviewEvidence.data.plan_revision_id !== undefined &&
        requirement.evidence_plan_revision_id !== undefined &&
        reviewEvidence.data.plan_revision_id !== requirement.evidence_plan_revision_id
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence_ref', 'plan_revision_id'],
          message: 'review evidence Plan revision must match the gate evidence Plan revision',
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
      return;
    }

    if (requirement.kind === 'package_run') {
      const packageRunEvidence = packageRunEvidenceRefSchema.safeParse(requirement.evidence_ref);
      if (!packageRunEvidence.success) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence_ref'],
          message: 'passed package run readiness gates require package run evidence authority',
        });
        return;
      }
      if (packageRunEvidence.data.status !== 'passed') {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence_ref', 'status'],
          message: 'passed package run readiness gates require passed package run evidence',
        });
      }
      return;
    }

    if (requirement.kind === 'observation') {
      const observationEvidence = observationEvidenceRefSchema.safeParse(requirement.evidence_ref);
      if (!observationEvidence.success) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence_ref'],
          message: 'passed observation readiness gates require observation evidence authority',
        });
        return;
      }
      if (observationEvidence.data.status !== 'passed') {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence_ref', 'status'],
          message: 'passed observation readiness gates require passed observation evidence',
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
  .strict()
  .superRefine((readiness, ctx) => {
    if (!readiness.ready) {
      return;
    }

    if (readiness.disabled_reasons.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['disabled_reasons'],
        message: 'ready release readiness details must not include disabled reasons',
      });
    }

    const evidenceGroups = [
      ['required_review_evidence', readiness.required_review_evidence],
      ['required_test_acceptance_evidence', readiness.required_test_acceptance_evidence],
      ['package_run_evidence', readiness.package_run_evidence],
      ['observation_evidence', readiness.observation_evidence],
    ] as const;
    for (const [path, evidenceItems] of evidenceGroups) {
      evidenceItems.forEach((evidence, index) => {
        if (evidence.status !== 'passed') {
          ctx.addIssue({
            code: 'custom',
            path: [path, index, 'status'],
            message: 'ready release readiness details require every evidence gate to be passed',
          });
        }
      });
    }
  });
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
    priority: nonEmpty,
    risk: nonEmpty,
    driver_actor_id: nonEmpty,
    updated_at: isoDateTimeSchema,
  })
  .strict();

export const sourcePlanningCoverageSchema = z
  .object({
    development_plan_count: z.number().int().nonnegative(),
    plan_item_count: z.number().int().nonnegative(),
    uncovered: z.boolean(),
  })
  .strict();
export type SourcePlanningCoverage = z.infer<typeof sourcePlanningCoverageSchema>;

export const downstreamGateSummarySchema = z
  .object({
    current_gate_counts: z
      .object({
        boundary: z.number().int().nonnegative(),
        spec: z.number().int().nonnegative(),
        execution_plan: z.number().int().nonnegative(),
        execution: z.number().int().nonnegative(),
        code_review: z.number().int().nonnegative(),
        qa: z.number().int().nonnegative(),
        release: z.number().int().nonnegative(),
      })
      .strict(),
    blocker_count: z.number().int().nonnegative(),
  })
  .strict();
export type DownstreamGateSummary = z.infer<typeof downstreamGateSummarySchema>;

export const sourceAuditSchema = z
  .object({
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
    updated_by_actor_id: nonEmpty.optional(),
  })
  .strict();
export type SourceAudit = z.infer<typeof sourceAuditSchema>;

const sourceListProjectionFieldsSchema = {
  planning_coverage: sourcePlanningCoverageSchema,
  downstream_gate_summary: downstreamGateSummarySchema,
  last_meaningful_update_at: isoDateTimeSchema,
  next_action: nonEmpty,
  release_refs: z.array(releaseObjectRefSchema),
} as const;

const developmentPlanObjectRefSchema = z
  .object({ type: z.literal('development_plan'), id: nonEmpty, revision_id: nonEmpty.optional(), title: nonEmpty.optional() })
  .strict();
const developmentPlanItemObjectRefSchema = z
  .object({
    type: z.literal('development_plan_item'),
    id: nonEmpty,
    development_plan_id: nonEmpty,
    revision_id: nonEmpty.optional(),
    title: nonEmpty.optional(),
  })
  .strict();
const attachmentObjectRefSchema = z.object({ type: z.literal('attachment'), id: nonEmpty, title: nonEmpty.optional() }).strict();
export const typedSourceReleaseEvidenceRefSchema = z
  .object({ type: z.literal('release_evidence'), id: nonEmpty, release_id: nonEmpty, title: nonEmpty.optional() })
  .strict();
export type TypedSourceReleaseEvidenceRef = z.infer<typeof typedSourceReleaseEvidenceRefSchema>;
export const typedSourceRelationshipRefSchema = z.discriminatedUnion('type', [
  initiativeObjectRefSchema,
  requirementObjectRefSchema,
  bugObjectRefSchema,
  techDebtObjectRefSchema,
  developmentPlanObjectRefSchema,
  developmentPlanItemObjectRefSchema,
  releaseObjectRefSchema,
  attachmentObjectRefSchema,
]);
export type TypedSourceRelationshipRef = z.infer<typeof typedSourceRelationshipRefSchema>;

export const typedSourceEvidenceRefSchema = z.discriminatedUnion('type', [attachmentObjectRefSchema, typedSourceReleaseEvidenceRefSchema]);
export type TypedSourceEvidenceRef = z.infer<typeof typedSourceEvidenceRefSchema>;

export const typedSourceAttachmentRefSchema = attachmentRefSchema
  .extend({
    linked_object_refs: z.array(typedSourceRelationshipRefSchema).default([]),
  })
  .strict();
export type TypedSourceAttachmentRef = z.infer<typeof typedSourceAttachmentRefSchema>;

const objectDetailBaseSchema = objectListItemBaseSchema
  .extend({
    ...sourceListProjectionFieldsSchema,
    narrative_markdown: z.string(),
    linked_development_plans: z.array(developmentPlanObjectRefSchema),
    linked_plan_items: z.array(developmentPlanItemObjectRefSchema),
    evidence_refs: z.array(typedSourceEvidenceRefSchema),
    attachment_refs: z.array(typedSourceAttachmentRefSchema),
    audit: sourceAuditSchema,
    relationship_refs: z.array(typedSourceRelationshipRefSchema),
  })
  .strict();

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
    source_ref: productObjectRefSchema,
    status: nonEmpty,
    gate_state: nonEmpty,
    current_revision_id: nonEmpty.optional(),
    approved_revision_id: nonEmpty.optional(),
    updated_at: isoDateTimeSchema.optional(),
    href: productHrefSchema.optional(),
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
    ref: executionPlanObjectRefSchema,
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
  })
  .strict();
export type PlanDetail = z.infer<typeof planDetailSchema>;

export const myWorkQueueItemSchema = z
  .object({
    id: nonEmpty,
    object_ref: productQueryObjectRefSchema,
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
  ref: initiativeObjectRefSchema,
  ...sourceListProjectionFieldsSchema,
  business_outcome: nonEmpty,
});
export type InitiativeListItem = z.infer<typeof initiativeListItemSchema>;

export const initiativeDetailSchema = objectDetailBaseSchema.extend({
  ref: initiativeObjectRefSchema,
  business_outcome: nonEmpty,
  milestone_intent: nonEmpty,
  child_refs: z.array(objectRefSchema),
  release_coverage: nonEmpty,
});
export type InitiativeDetail = z.infer<typeof initiativeDetailSchema>;

export const requirementListItemSchema = objectListItemBaseSchema.extend({
  ref: requirementObjectRefSchema,
  ...sourceListProjectionFieldsSchema,
});
export type RequirementListItem = z.infer<typeof requirementListItemSchema>;

export const requirementDetailSchema = objectDetailBaseSchema.extend({
  ref: requirementObjectRefSchema,
  stakeholder_problem: nonEmpty,
  desired_outcome: nonEmpty,
  acceptance_criteria_summary: nonEmpty,
  scope_summary: z.object({ in_scope: nonEmpty, out_of_scope: nonEmpty }).strict(),
});
export type RequirementDetail = z.infer<typeof requirementDetailSchema>;

export const techDebtListItemSchema = objectListItemBaseSchema.extend({
  ref: techDebtObjectRefSchema,
  ...sourceListProjectionFieldsSchema,
  affected_modules: z.array(nonEmpty),
  risk_rationale: nonEmpty,
});
export type TechDebtListItem = z.infer<typeof techDebtListItemSchema>;

export const techDebtDetailSchema = objectDetailBaseSchema.extend({
  ref: techDebtObjectRefSchema,
  affected_modules: z.array(nonEmpty),
  risk_rationale: nonEmpty,
  validation_strategy: nonEmpty,
  remediation_intent: nonEmpty,
});
export type TechDebtDetail = z.infer<typeof techDebtDetailSchema>;

export const bugListItemSchema = objectListItemBaseSchema.extend({
  ref: bugObjectRefSchema,
  ...sourceListProjectionFieldsSchema,
  severity: nonEmpty,
  affected_surfaces: z.array(nonEmpty),
});
export type BugListItem = z.infer<typeof bugListItemSchema>;

export const bugDetailSchema = objectDetailBaseSchema.extend({
  ref: bugObjectRefSchema,
  observed_behavior: nonEmpty,
  expected_behavior: nonEmpty,
  reproduction_steps: z.array(nonEmpty),
  severity: nonEmpty,
  affected_surfaces: z.array(nonEmpty),
});
export type BugDetail = z.infer<typeof bugDetailSchema>;

export const boardCardSchema = z
  .object({
    id: nonEmpty,
    object_ref: productQueryObjectRefSchema,
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
