import { describe, expect, it } from 'vitest';
import { reviewPacketSchema } from '@forgeloop/contracts';

describe('Review Packet contract', () => {
  it('preserves independent AI review evidence', () => {
    const parsed = reviewPacketSchema.parse({
      id: 'review-1',
      run_session_id: 'run-1',
      execution_package_id: 'pkg-1',
      reviewer_actor_id: 'reviewer-1',
      spec_revision_id: 'spec-r1',
      plan_revision_id: 'plan-r1',
      status: 'completed',
      decision: 'approved',
      changed_files: [],
      check_result_summary: 'All checks passed',
      self_review: {
        status: 'succeeded',
        summary: 'ok',
        spec_plan_alignment: 'ok',
        test_assessment: 'ok',
        risk_notes: [],
        follow_up_questions: [],
      },
      independent_ai_review: {
        status: 'approved',
        run_session_id: 'run-1',
        execution_package_id: 'pkg-1',
        summary: 'independent ok',
        risk_notes: [],
      },
      test_mapping: [{ gate_id: 'regression', result: 'passed', evidence_ref: 'run-check:regression' }],
      risk_notes: [],
      requested_changes: [],
      created_at: '2026-05-20T00:00:00.000Z',
      updated_at: '2026-05-20T00:00:00.000Z',
    });

    expect(parsed.independent_ai_review).toMatchObject({
      status: 'approved',
      run_session_id: 'run-1',
      execution_package_id: 'pkg-1',
    });
    expect(parsed.test_mapping).toEqual([expect.objectContaining({ gate_id: 'regression', result: 'passed' })]);
  });
});
