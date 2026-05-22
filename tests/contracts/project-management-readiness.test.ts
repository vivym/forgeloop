import { describe, expect, it } from 'vitest';

import {
  evidenceRequirementStatusSchema,
  observationEvidenceRefSchema,
  packageRunEvidenceRefSchema,
  releaseReadinessDetailSchema,
  reviewEvidenceRefSchema,
  testAcceptanceEvidenceRefSchema,
  type EvidenceRequirementStatus,
  type ProductSafeDisabledReason,
} from '@forgeloop/contracts';

const releaseScope = [
  { type: 'initiative', id: 'init-1' },
  { type: 'requirement', id: 'req-1' },
  { type: 'tech_debt', id: 'td-1' },
  { type: 'task', id: 'task-1' },
  { type: 'bug', id: 'bug-1' },
] as const;

function gate(
  requirementId: ProductSafeDisabledReason['code'],
  kind: EvidenceRequirementStatus['kind'],
  status: EvidenceRequirementStatus['status'],
): EvidenceRequirementStatus {
  return {
    requirement_id: requirementId,
    scope_ref: { type: 'requirement', id: 'req-1' },
    kind,
    status,
    disabled_reason: disabled(requirementId),
  };
}

function disabled(code: ProductSafeDisabledReason['code']): ProductSafeDisabledReason {
  return {
    code,
    message: `Release is blocked by ${code.replaceAll('_', ' ')}.`,
    target_ref: { type: 'requirement', id: 'req-1' },
    remediation_route: '/requirements/req-1/evidence',
  };
}

const approvedReviewEvidence = {
  id: 'review-evidence-1',
  authority_type: 'human_review_decision',
  authority_ref: { type: 'human_review_decision', id: 'decision-1' },
  scope_ref: { type: 'requirement', id: 'req-1' },
  status: 'approved',
  required: true,
  attachment_refs: [],
} as const;

const passedQaEvidence = {
  id: 'qa-evidence-1',
  scope_ref: { type: 'requirement', id: 'req-1' },
  evidence_type: 'qa_acceptance',
  status: 'passed',
  required: true,
  attachment_refs: [],
} as const;

const passedPackageRunEvidence = {
  id: 'package-run-evidence-1',
  scope_ref: { type: 'requirement', id: 'req-1' },
  evidence_type: 'package_run',
  status: 'passed',
  required: true,
  package_ref: { type: 'execution_package', id: 'pkg-1' },
  run_session_ref: { type: 'run_session', id: 'run-1' },
  attachment_refs: [],
} as const;

const passedObservationEvidence = {
  id: 'observation-evidence-1',
  scope_ref: { type: 'requirement', id: 'req-1' },
  evidence_type: 'observation',
  status: 'passed',
  required: true,
  observation_ref: { type: 'release', id: 'release-1' },
  attachment_refs: [],
} as const;

const matchingRevisionAuthority = {
  current_spec_revision_id: 'spec-rev-2',
  evidence_spec_revision_id: 'spec-rev-2',
  current_plan_revision_id: 'plan-rev-2',
  evidence_plan_revision_id: 'plan-rev-2',
} as const;

describe('project management release readiness contracts', () => {
  it('accepts typed review and test evidence authority', () => {
    expect(reviewEvidenceRefSchema.parse(approvedReviewEvidence)).toMatchObject({ status: 'approved' });

    expect(testAcceptanceEvidenceRefSchema.parse(passedQaEvidence)).toMatchObject({ status: 'passed' });
    expect(packageRunEvidenceRefSchema.parse(passedPackageRunEvidence)).toMatchObject({ evidence_type: 'package_run' });
    expect(observationEvidenceRefSchema.parse(passedObservationEvidence)).toMatchObject({ evidence_type: 'observation' });
  });

  it('requires typed evidence authority for passed readiness gates', () => {
    expect(
      evidenceRequirementStatusSchema.safeParse({
        requirement_id: 'review-gate',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'review',
        status: 'passed',
      }).success,
    ).toBe(false);

    expect(
      evidenceRequirementStatusSchema.safeParse({
        requirement_id: 'qa-gate',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'qa_acceptance',
        status: 'passed',
      }).success,
    ).toBe(false);
  });

  it('rejects mismatched passed readiness evidence authority', () => {
    expect(
      evidenceRequirementStatusSchema.safeParse({
        requirement_id: 'review-gate',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'review',
        status: 'passed',
        ...matchingRevisionAuthority,
        evidence_ref: passedQaEvidence,
      }).success,
    ).toBe(false);

    expect(
      evidenceRequirementStatusSchema.safeParse({
        requirement_id: 'qa-gate',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'qa_acceptance',
        status: 'passed',
        ...matchingRevisionAuthority,
        evidence_ref: approvedReviewEvidence,
      }).success,
    ).toBe(false);

    expect(
      evidenceRequirementStatusSchema.safeParse({
        requirement_id: 'package-run-gate',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'package_run',
        status: 'passed',
        ...matchingRevisionAuthority,
        evidence_ref: approvedReviewEvidence,
      }).success,
    ).toBe(false);

    expect(
      evidenceRequirementStatusSchema.safeParse({
        requirement_id: 'observation-gate',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'observation',
        status: 'passed',
        ...matchingRevisionAuthority,
        evidence_ref: passedQaEvidence,
      }).success,
    ).toBe(false);
  });

  it('accepts passed readiness gates backed by matching approved or passed evidence authority', () => {
    expect(
      evidenceRequirementStatusSchema.safeParse({
        requirement_id: 'review-gate',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'review',
        status: 'passed',
        ...matchingRevisionAuthority,
        evidence_ref: approvedReviewEvidence,
      }).success,
    ).toBe(true);

    expect(
      evidenceRequirementStatusSchema.safeParse({
        requirement_id: 'qa-gate',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'qa_acceptance',
        status: 'passed',
        ...matchingRevisionAuthority,
        evidence_ref: passedQaEvidence,
      }).success,
    ).toBe(true);

    expect(
      evidenceRequirementStatusSchema.safeParse({
        requirement_id: 'package-run-gate',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'package_run',
        status: 'passed',
        ...matchingRevisionAuthority,
        evidence_ref: passedPackageRunEvidence,
      }).success,
    ).toBe(true);

    expect(
      evidenceRequirementStatusSchema.safeParse({
        requirement_id: 'observation-gate',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'observation',
        status: 'passed',
        ...matchingRevisionAuthority,
        evidence_ref: passedObservationEvidence,
      }).success,
    ).toBe(true);
  });

  it('rejects revisionless passed readiness gates even with typed evidence authority', () => {
    for (const gate of [
      { requirement_id: 'review-gate', kind: 'review', evidence_ref: approvedReviewEvidence },
      { requirement_id: 'qa-gate', kind: 'qa_acceptance', evidence_ref: passedQaEvidence },
      { requirement_id: 'package-run-gate', kind: 'package_run', evidence_ref: passedPackageRunEvidence },
      { requirement_id: 'observation-gate', kind: 'observation', evidence_ref: passedObservationEvidence },
    ] as const) {
      expect(
        evidenceRequirementStatusSchema.safeParse({
          ...gate,
          scope_ref: { type: 'requirement', id: 'req-1' },
          status: 'passed',
        }).success,
      ).toBe(false);
    }
  });

  it('rejects passed readiness gates with evidence outside the gate scope', () => {
    expect(
      evidenceRequirementStatusSchema.safeParse({
        requirement_id: 'review-gate',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'review',
        status: 'passed',
        ...matchingRevisionAuthority,
        evidence_ref: {
          ...approvedReviewEvidence,
          scope_ref: { type: 'requirement', id: 'req-other' },
        },
      }).success,
    ).toBe(false);

    expect(
      evidenceRequirementStatusSchema.safeParse({
        requirement_id: 'qa-gate',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'qa_acceptance',
        status: 'passed',
        ...matchingRevisionAuthority,
        evidence_ref: {
          ...passedQaEvidence,
          scope_ref: { type: 'task', id: 'task-1' },
        },
      }).success,
    ).toBe(false);

    expect(
      evidenceRequirementStatusSchema.safeParse({
        requirement_id: 'package-run-gate',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'package_run',
        status: 'passed',
        ...matchingRevisionAuthority,
        evidence_ref: {
          ...passedPackageRunEvidence,
          scope_ref: { type: 'requirement', id: 'req-other' },
        },
      }).success,
    ).toBe(false);

    expect(
      evidenceRequirementStatusSchema.safeParse({
        requirement_id: 'observation-gate',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'observation',
        status: 'passed',
        ...matchingRevisionAuthority,
        evidence_ref: {
          ...passedObservationEvidence,
          scope_ref: { type: 'bug', id: 'bug-1' },
        },
      }).success,
    ).toBe(false);
  });

  it('requires current Spec and Plan revision authority for passed readiness gates', () => {
    expect(
      evidenceRequirementStatusSchema.safeParse({
        requirement_id: 'review-gate',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'review',
        status: 'passed',
        current_spec_revision_id: 'spec-rev-2',
        evidence_ref: approvedReviewEvidence,
      }).success,
    ).toBe(false);

    expect(
      evidenceRequirementStatusSchema.safeParse({
        requirement_id: 'review-gate',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'review',
        status: 'passed',
        current_spec_revision_id: 'spec-rev-2',
        evidence_spec_revision_id: 'spec-rev-1',
        current_plan_revision_id: 'plan-rev-2',
        evidence_plan_revision_id: 'plan-rev-1',
        evidence_ref: approvedReviewEvidence,
      }).success,
    ).toBe(false);

    expect(
      evidenceRequirementStatusSchema.safeParse({
        requirement_id: 'review-gate',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'review',
        status: 'passed',
        ...matchingRevisionAuthority,
        evidence_ref: approvedReviewEvidence,
      }).success,
    ).toBe(true);

    expect(
      evidenceRequirementStatusSchema.safeParse({
        requirement_id: 'qa-gate',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'qa_acceptance',
        status: 'passed',
        ...matchingRevisionAuthority,
        evidence_ref: passedQaEvidence,
      }).success,
    ).toBe(true);
  });

  it('rejects passed review gates with conflicting nested revision evidence', () => {
    expect(
      evidenceRequirementStatusSchema.safeParse({
        requirement_id: 'review-gate',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'review',
        status: 'passed',
        ...matchingRevisionAuthority,
        evidence_ref: {
          ...approvedReviewEvidence,
          spec_revision_id: 'spec-rev-1',
          plan_revision_id: 'plan-rev-2',
        },
      }).success,
    ).toBe(false);

    expect(
      evidenceRequirementStatusSchema.safeParse({
        requirement_id: 'review-gate',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'review',
        status: 'passed',
        ...matchingRevisionAuthority,
        evidence_ref: {
          ...approvedReviewEvidence,
          spec_revision_id: 'spec-rev-2',
          plan_revision_id: 'plan-rev-1',
        },
      }).success,
    ).toBe(false);

    expect(
      evidenceRequirementStatusSchema.safeParse({
        requirement_id: 'review-gate',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'review',
        status: 'passed',
        ...matchingRevisionAuthority,
        evidence_ref: {
          ...approvedReviewEvidence,
          spec_revision_id: 'spec-rev-2',
          plan_revision_id: 'plan-rev-2',
        },
      }).success,
    ).toBe(true);
  });

  it('rejects freeform notes, ai self-review, and bare attachments as gate authority', () => {
    expect(() =>
      reviewEvidenceRefSchema.parse({
        id: 'review-evidence-2',
        authority_type: 'ai_self_review_approval',
        scope_ref: { type: 'requirement', id: 'req-1' },
        status: 'approved',
        required: true,
        attachment_refs: [],
      }),
    ).toThrow();

    expect(() =>
      evidenceRequirementStatusSchema.parse({
        requirement_id: 'gate-1',
        scope_ref: { type: 'requirement', id: 'req-1' },
        kind: 'review',
        status: 'passed',
        evidence_ref: { type: 'attachment', id: 'att-1' },
      }),
    ).toThrow();
  });

  it('models disabled reasons for missing, stale, wrong-scope, unauthorized, and tombstoned evidence', () => {
    const readiness = releaseReadinessDetailSchema.parse({
      release_id: 'release-1',
      scope_refs: releaseScope,
      ready: false,
      required_review_evidence: [
        gate('missing_required_review', 'review', 'missing'),
        gate('evidence_stale', 'review', 'stale'),
        gate('evidence_scope_mismatch', 'review', 'blocked'),
      ],
      required_test_acceptance_evidence: [
        gate('missing_required_test_acceptance', 'qa_acceptance', 'missing'),
        gate('evidence_unauthorized', 'qa_acceptance', 'unauthorized'),
        gate('evidence_tombstoned', 'qa_acceptance', 'tombstoned'),
      ],
      package_run_evidence: [],
      observation_evidence: [],
      disabled_reasons: [
        disabled('missing_required_review'),
        disabled('evidence_stale'),
        disabled('evidence_scope_mismatch'),
        disabled('missing_required_test_acceptance'),
        disabled('evidence_unauthorized'),
        disabled('evidence_tombstoned'),
      ],
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.disabled_reasons.map((reason) => reason.code)).toContain('evidence_scope_mismatch');
  });
});
