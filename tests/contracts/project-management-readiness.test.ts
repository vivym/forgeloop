import { describe, expect, it } from 'vitest';

import {
  evidenceRequirementStatusSchema,
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

describe('project management release readiness contracts', () => {
  it('accepts typed review and test evidence authority', () => {
    expect(
      reviewEvidenceRefSchema.parse({
        id: 'review-evidence-1',
        authority_type: 'human_review_decision',
        authority_ref: { type: 'human_review_decision', id: 'decision-1' },
        scope_ref: { type: 'requirement', id: 'req-1' },
        status: 'approved',
        required: true,
        attachment_refs: [],
      }),
    ).toMatchObject({ status: 'approved' });

    expect(
      testAcceptanceEvidenceRefSchema.parse({
        id: 'qa-evidence-1',
        scope_ref: { type: 'task', id: 'task-1' },
        evidence_type: 'qa_acceptance',
        status: 'passed',
        required: true,
        attachment_refs: [],
      }),
    ).toMatchObject({ status: 'passed' });
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
