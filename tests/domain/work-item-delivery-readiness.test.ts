import { describe, expect, it } from 'vitest';
import {
  deriveInitiativeAggregationState,
  hasCompleteReviewEvidence,
  normalizeIntegrationReadiness,
  normalizeRequiredTestGate,
} from '@forgeloop/domain';

describe('Work Item delivery readiness domain helpers', () => {
  it('requires selected-run review evidence mapped to approved revisions', () => {
    expect(
      hasCompleteReviewEvidence(
        {
          status: 'completed',
          decision: 'approved',
          execution_package_id: 'pkg-1',
          run_session_id: 'run-1',
          spec_revision_id: 'spec-r1',
          plan_revision_id: 'plan-r1',
          test_mapping: [{ gate_id: 'regression', result: 'passed' }],
          risk_notes: [],
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
            summary: 'independent review ok',
          },
        },
        {
          selectedRunId: 'run-1',
          packageId: 'pkg-1',
          approvedSpecRevisionId: 'spec-r1',
          approvedPlanRevisionId: 'plan-r1',
        },
      ),
    ).toEqual({ complete: true, blockers: [] });

    expect(
      hasCompleteReviewEvidence(
        {
          status: 'completed',
          decision: 'approved',
          execution_package_id: 'pkg-1',
          run_session_id: 'stale-run',
          spec_revision_id: 'spec-r1',
          plan_revision_id: 'plan-r1',
          self_review: {
            status: 'succeeded',
            summary: 'ok',
            spec_plan_alignment: 'ok',
            test_assessment: 'ok',
            risk_notes: [],
            follow_up_questions: [],
          },
        },
        {
          selectedRunId: 'run-1',
          packageId: 'pkg-1',
          approvedSpecRevisionId: 'spec-r1',
          approvedPlanRevisionId: 'plan-r1',
        },
      ),
    ).toMatchObject({
      complete: false,
      blockers: expect.arrayContaining([
        'stale_review_run',
        'missing_independent_ai_review',
        'missing_review_test_mapping',
        'missing_review_risk_notes',
      ]),
    });
  });

  it('blocks review completion when implementer self-review failed', () => {
    expect(
      hasCompleteReviewEvidence(
        {
          status: 'completed',
          decision: 'approved',
          execution_package_id: 'pkg-1',
          run_session_id: 'run-1',
          spec_revision_id: 'spec-r1',
          plan_revision_id: 'plan-r1',
          test_mapping: [{ gate_id: 'regression', result: 'passed' }],
          risk_notes: [],
          self_review: {
            status: 'failed',
            summary: 'failed',
            spec_plan_alignment: 'not checked',
            test_assessment: 'not checked',
            risk_notes: [],
            follow_up_questions: [],
            failure_message: 'self-review failed',
          },
          independent_ai_review: {
            status: 'approved',
            run_session_id: 'run-1',
            execution_package_id: 'pkg-1',
            summary: 'independent review ok',
          },
        },
        {
          selectedRunId: 'run-1',
          packageId: 'pkg-1',
          approvedSpecRevisionId: 'spec-r1',
          approvedPlanRevisionId: 'plan-r1',
        },
      ),
    ).toMatchObject({
      complete: false,
      blockers: expect.arrayContaining(['self_review_not_succeeded']),
    });
  });

  it('requires independent AI review evidence for the selected run and package', () => {
    const completeReviewEvidence = {
      status: 'completed',
      decision: 'approved',
      execution_package_id: 'pkg-1',
      run_session_id: 'run-1',
      spec_revision_id: 'spec-r1',
      plan_revision_id: 'plan-r1',
      test_mapping: [{ gate_id: 'regression', result: 'passed' }],
      risk_notes: [],
      self_review: {
        status: 'succeeded',
        summary: 'ok',
        spec_plan_alignment: 'ok',
        test_assessment: 'ok',
        risk_notes: [],
        follow_up_questions: [],
      },
    } as const;
    const context = {
      selectedRunId: 'run-1',
      packageId: 'pkg-1',
      approvedSpecRevisionId: 'spec-r1',
      approvedPlanRevisionId: 'plan-r1',
    };

    expect(
      hasCompleteReviewEvidence(
        {
          ...completeReviewEvidence,
          independent_ai_review: {
            status: 'approved',
            execution_package_id: 'pkg-1',
            summary: 'independent review ok',
          },
        },
        context,
      ),
    ).toMatchObject({
      complete: false,
      blockers: expect.arrayContaining(['missing_independent_ai_review_run']),
    });

    expect(
      hasCompleteReviewEvidence(
        {
          ...completeReviewEvidence,
          independent_ai_review: {
            status: 'approved',
            run_session_id: 'run-1',
            summary: 'independent review ok',
          },
        },
        context,
      ),
    ).toMatchObject({
      complete: false,
      blockers: expect.arrayContaining(['missing_independent_ai_review_package']),
    });
  });

  it('normalizes required test gates only with matching evidence', () => {
    expect(
      normalizeRequiredTestGate(
        { gate_id: 'regression' },
        {
          runChecks: [{ check_id: 'regression', status: 'succeeded' }],
          reviewTestMappings: [],
          releaseTestAcceptance: [],
        },
      ),
    ).toEqual({
      gate_id: 'regression',
      state: 'passed',
      blocker: undefined,
    });

    expect(
      normalizeRequiredTestGate(
        { gate_id: 'regression', status: 'passed' },
        { runChecks: [], reviewTestMappings: [], releaseTestAcceptance: [] },
      ),
    ).toMatchObject({ state: 'blocked', blocker: 'missing_required_test_gate_evidence' });

    expect(normalizeRequiredTestGate({ status: 'passed' }, { runChecks: [], reviewTestMappings: [], releaseTestAcceptance: [] })).toMatchObject({
      state: 'blocked',
      blocker: 'unknown_required_test_gate',
    });

    expect(
      normalizeRequiredTestGate(
        { gate_id: 'manual-qa' },
        {
          runChecks: [],
          reviewTestMappings: [],
          releaseTestAcceptance: [
            { gate_id: 'manual-qa', state: 'not_required', rationale: 'covered by upstream certification' },
          ],
        },
      ),
    ).toMatchObject({ state: 'passed' });
  });

  it('does not pass required test gates from non-test readiness statuses', () => {
    expect(
      normalizeRequiredTestGate(
        { gate_id: 'unit' },
        {
          runChecks: [{ check_id: 'unit', status: 'ready' }],
          reviewTestMappings: [],
          releaseTestAcceptance: [],
        },
      ),
    ).toMatchObject({ state: 'blocked', blocker: 'missing_required_test_gate_evidence' });

    expect(
      normalizeRequiredTestGate(
        { gate_id: 'manual-qa' },
        {
          runChecks: [],
          reviewTestMappings: [],
          releaseTestAcceptance: [{ gate_id: 'manual-qa', state: 'ready' }],
        },
      ),
    ).toMatchObject({ state: 'blocked', blocker: 'missing_required_test_gate_evidence' });
  });

  it('passes required test gates from not-required test evidence with rationale', () => {
    expect(
      normalizeRequiredTestGate(
        { gate_id: 'manual-qa' },
        {
          runChecks: [{ check_id: 'manual-qa', status: 'not_required', rationale: 'covered by certification' }],
          reviewTestMappings: [],
          releaseTestAcceptance: [],
        },
      ),
    ).toMatchObject({ state: 'passed' });
  });

  it('does not pass integration readiness from top-level status alone', () => {
    expect(normalizeIntegrationReadiness({ status: 'ready' })).toMatchObject({
      state: 'blocked',
      blockers: expect.arrayContaining(['missing_contract_readiness']),
    });
  });

  it('passes integration readiness with full dimension evidence', () => {
    expect(
      normalizeIntegrationReadiness({
        status: 'ready',
        contract: { status: 'frozen' },
        mock_fixture: { status: 'ready' },
        environment: { status: 'ready' },
        dependencies: { status: 'ready' },
        cross_end_validation: { status: 'validated' },
        blockers: [],
      }),
    ).toMatchObject({ state: 'passed', blockers: [] });
  });

  it('normalizes running, failed, and unknown Integration Readiness records', () => {
    expect(
      normalizeIntegrationReadiness({
        status: 'validating',
        contract: { status: 'frozen' },
        mock_fixture: { status: 'ready' },
        environment: { status: 'ready' },
        dependencies: { status: 'ready' },
        cross_end_validation: { status: 'validating' },
        blockers: [],
      }),
    ).toMatchObject({ state: 'running', blockers: [] });

    expect(
      normalizeIntegrationReadiness({
        status: 'failed',
        contract: { status: 'failed' },
        mock_fixture: { status: 'ready' },
        environment: { status: 'ready' },
        dependencies: { status: 'ready' },
        cross_end_validation: { status: 'validated' },
        blockers: [],
      }),
    ).toMatchObject({ state: 'failed', blockers: expect.arrayContaining(['failed_contract_readiness']) });

    expect(
      normalizeIntegrationReadiness({
        status: 'mystery',
        contract: { status: 'frozen' },
        mock_fixture: { status: 'ready' },
        environment: { status: 'ready' },
        dependencies: { status: 'ready' },
        cross_end_validation: { status: 'validated' },
      }),
    ).toMatchObject({ state: 'blocked', blockers: expect.arrayContaining(['unknown_integration_readiness_status']) });
  });

  it('normalizes top-level Integration Readiness state and result summaries', () => {
    const completeDimensions = {
      contract: { status: 'frozen' },
      mock_fixture: { status: 'ready' },
      environment: { status: 'ready' },
      dependencies: { status: 'ready' },
      cross_end_validation: { status: 'validated' },
      blockers: [],
    };

    expect(normalizeIntegrationReadiness({ ...completeDimensions, state: 'mystery' })).toMatchObject({
      state: 'blocked',
      blockers: expect.arrayContaining(['unknown_integration_readiness_status']),
    });

    expect(normalizeIntegrationReadiness({ ...completeDimensions, result: 'mystery' })).toMatchObject({
      state: 'blocked',
      blockers: expect.arrayContaining(['unknown_integration_readiness_status']),
    });

    expect(normalizeIntegrationReadiness({ ...completeDimensions, status: 'failed' })).toMatchObject({
      state: 'failed',
      blockers: [],
    });

    expect(normalizeIntegrationReadiness({ ...completeDimensions, state: 'validating' })).toMatchObject({
      state: 'running',
      blockers: [],
    });
  });

  it('blocks non-summary-positive top-level Integration Readiness values', () => {
    const completeDimensions = {
      contract: { status: 'frozen' },
      mock_fixture: { status: 'ready' },
      environment: { status: 'ready' },
      dependencies: { status: 'ready' },
      cross_end_validation: { status: 'validated' },
      blockers: [],
    };

    expect(normalizeIntegrationReadiness({ ...completeDimensions, status: 'succeeded' })).toMatchObject({
      state: 'blocked',
      blockers: expect.arrayContaining(['unknown_integration_readiness_status']),
    });

    expect(normalizeIntegrationReadiness({ ...completeDimensions, state: 'acknowledged' })).toMatchObject({
      state: 'blocked',
      blockers: expect.arrayContaining(['unknown_integration_readiness_status']),
    });

    expect(normalizeIntegrationReadiness({ ...completeDimensions, result: 'frozen' })).toMatchObject({
      state: 'blocked',
      blockers: expect.arrayContaining(['unknown_integration_readiness_status']),
    });
  });

  it('marks Initiative child aggregation unavailable when no child readiness evidence exists', () => {
    expect(deriveInitiativeAggregationState({ kind: 'initiative', currentPackages: [], childReadiness: undefined })).toEqual({
      mode: 'unavailable',
      label: 'Child-work aggregation unavailable',
    });

    expect(deriveInitiativeAggregationState({ kind: 'initiative', currentPackages: [], childReadiness: [] })).toEqual({
      mode: 'unavailable',
      label: 'Child-work aggregation unavailable',
    });
  });
});
