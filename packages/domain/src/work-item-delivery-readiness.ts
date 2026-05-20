import type { ReviewPacket } from './types.js';

const integrationSummaryPositive = new Set(['ready', 'passed', 'validated']);
const integrationDimensionPositive = new Set(['ready', 'passed', 'validated', 'succeeded', 'acknowledged', 'frozen']);
const failed = new Set(['failed', 'invalid', 'rejected']);
const running = new Set(['running', 'in_progress', 'validating']);
const acceptedTestEvidence = new Set(['passed', 'succeeded', 'acknowledged']);

export const normalizeToken = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : undefined;

type ReviewEvidenceContext = {
  selectedRunId: string;
  packageId: string;
  approvedSpecRevisionId: string;
  approvedPlanRevisionId: string;
};

export const hasCompleteReviewEvidence = (
  reviewPacket: Partial<ReviewPacket>,
  context: ReviewEvidenceContext,
): { complete: boolean; blockers: string[] } => {
  const blockers: string[] = [];

  if (reviewPacket.status !== 'completed' || reviewPacket.decision !== 'approved') {
    blockers.push('review_not_approved');
  }
  if (reviewPacket.run_session_id !== context.selectedRunId) {
    blockers.push('stale_review_run');
  }
  if (reviewPacket.execution_package_id !== context.packageId) {
    blockers.push('stale_review_package');
  }
  if (reviewPacket.spec_revision_id !== context.approvedSpecRevisionId) {
    blockers.push('stale_review_spec_revision');
  }
  if (reviewPacket.plan_revision_id !== context.approvedPlanRevisionId) {
    blockers.push('stale_review_plan_revision');
  }
  if (reviewPacket.self_review === undefined) {
    blockers.push('missing_self_review');
  } else if (reviewPacket.self_review.status !== 'succeeded') {
    blockers.push('self_review_not_succeeded');
  }

  const independentAiReview = reviewPacket.independent_ai_review;
  if (independentAiReview === undefined) {
    blockers.push('missing_independent_ai_review');
  } else {
    if (independentAiReview.status !== 'approved') {
      blockers.push('independent_ai_review_not_approved');
    }
    if (independentAiReview.run_session_id === undefined) {
      blockers.push('missing_independent_ai_review_run');
    } else if (independentAiReview.run_session_id !== context.selectedRunId) {
      blockers.push('stale_independent_ai_review_run');
    }
    if (
      independentAiReview.execution_package_id === undefined
    ) {
      blockers.push('missing_independent_ai_review_package');
    } else if (
      independentAiReview.execution_package_id !== context.packageId
    ) {
      blockers.push('stale_independent_ai_review_package');
    }
  }

  if (!Array.isArray(reviewPacket.test_mapping) || reviewPacket.test_mapping.length === 0) {
    blockers.push('missing_review_test_mapping');
  }
  if (!Object.hasOwn(reviewPacket, 'risk_notes') || !Array.isArray(reviewPacket.risk_notes)) {
    blockers.push('missing_review_risk_notes');
  }

  return { complete: blockers.length === 0, blockers };
};

type TestGateRecord = Record<string, unknown>;
type RequiredTestGateEvidence = {
  runChecks: TestGateRecord[];
  reviewTestMappings: TestGateRecord[];
  releaseTestAcceptance: TestGateRecord[];
};

type RequiredTestGateResult = {
  gate_id?: string;
  state: 'passed' | 'blocked';
  blocker?: string | undefined;
};

const testGateId = (record: TestGateRecord): string | undefined =>
  normalizeToken(record.gate_id) ?? normalizeToken(record.key) ?? normalizeToken(record.check_id);

const matchingTestGate = (gateId: string) => (record: TestGateRecord): boolean => testGateId(record) === gateId;

const hasAcceptedTestEvidenceState = (record: TestGateRecord, statusKey: 'status' | 'state' | 'result'): boolean => {
  const state = normalizeToken(record[statusKey]);
  return acceptedTestEvidence.has(state ?? '') || (state === 'not_required' && normalizeToken(record.rationale) !== undefined);
};

const hasPassingRunCheck = (gateId: string, runChecks: TestGateRecord[]): boolean =>
  runChecks.some((check) => matchingTestGate(gateId)(check) && hasAcceptedTestEvidenceState(check, 'status'));

const hasPassingReviewMapping = (gateId: string, reviewTestMappings: TestGateRecord[]): boolean =>
  reviewTestMappings.some((mapping) => {
    if (!matchingTestGate(gateId)(mapping)) {
      return false;
    }

    return hasAcceptedTestEvidenceState(mapping, 'result');
  });

const hasPassingReleaseAcceptance = (gateId: string, releaseTestAcceptance: TestGateRecord[]): boolean =>
  releaseTestAcceptance.some((acceptance) => {
    if (!matchingTestGate(gateId)(acceptance)) {
      return false;
    }

    return hasAcceptedTestEvidenceState(acceptance, 'state') || hasAcceptedTestEvidenceState(acceptance, 'result');
  });

export const normalizeRequiredTestGate = (
  gate: TestGateRecord,
  evidence: RequiredTestGateEvidence,
): RequiredTestGateResult => {
  const gateId = testGateId(gate);
  if (gateId === undefined) {
    return { state: 'blocked', blocker: 'unknown_required_test_gate' };
  }

  if (
    hasPassingRunCheck(gateId, evidence.runChecks) ||
    hasPassingReviewMapping(gateId, evidence.reviewTestMappings) ||
    hasPassingReleaseAcceptance(gateId, evidence.releaseTestAcceptance)
  ) {
    return { gate_id: gateId, state: 'passed', blocker: undefined };
  }

  return { gate_id: gateId, state: 'blocked', blocker: 'missing_required_test_gate_evidence' };
};

type IntegrationDimension = {
  key: 'contract' | 'mock_fixture' | 'environment' | 'dependencies' | 'cross_end_validation';
  missingBlocker: string;
  failedBlocker: string;
};

const integrationDimensions: IntegrationDimension[] = [
  {
    key: 'contract',
    missingBlocker: 'missing_contract_readiness',
    failedBlocker: 'failed_contract_readiness',
  },
  {
    key: 'mock_fixture',
    missingBlocker: 'missing_mock_fixture_readiness',
    failedBlocker: 'failed_mock_fixture_readiness',
  },
  {
    key: 'environment',
    missingBlocker: 'missing_environment_readiness',
    failedBlocker: 'failed_environment_readiness',
  },
  {
    key: 'dependencies',
    missingBlocker: 'missing_dependency_readiness',
    failedBlocker: 'failed_dependency_readiness',
  },
  {
    key: 'cross_end_validation',
    missingBlocker: 'missing_cross_end_validation',
    failedBlocker: 'failed_cross_end_validation',
  },
];

type IntegrationReadinessResult = {
  state: 'passed' | 'running' | 'failed' | 'blocked';
  blockers: string[];
  summary_status?: string;
};

const objectRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

export const normalizeIntegrationReadiness = (value: unknown): IntegrationReadinessResult => {
  const record = objectRecord(value) ?? {};
  const blockers: string[] = [];
  let hasRunningDimension = false;
  let hasFailedDimension = false;
  let hasRunningSummary = false;
  let hasFailedSummary = false;

  const summaryStatus = normalizeToken(record.status) ?? normalizeToken(record.state) ?? normalizeToken(record.result);
  if (
    summaryStatus !== undefined &&
    !integrationSummaryPositive.has(summaryStatus) &&
    !failed.has(summaryStatus) &&
    !running.has(summaryStatus)
  ) {
    blockers.push('unknown_integration_readiness_status');
  } else if (summaryStatus !== undefined) {
    hasFailedSummary = failed.has(summaryStatus);
    hasRunningSummary = running.has(summaryStatus);
  }

  for (const dimension of integrationDimensions) {
    const dimensionRecord = objectRecord(record[dimension.key]);
    const dimensionStatus = normalizeToken(dimensionRecord?.status);

    if (dimensionRecord === undefined || dimensionStatus === undefined) {
      blockers.push(dimension.missingBlocker);
      continue;
    }
    if (failed.has(dimensionStatus)) {
      hasFailedDimension = true;
      blockers.push(dimension.failedBlocker);
      continue;
    }
    if (running.has(dimensionStatus)) {
      hasRunningDimension = true;
      continue;
    }
    if (!integrationDimensionPositive.has(dimensionStatus)) {
      blockers.push('unknown_integration_readiness_status');
    }
  }

  const explicitBlockers = record.blockers;
  if (!Array.isArray(explicitBlockers)) {
    blockers.push('missing_integration_blockers');
  } else if (explicitBlockers.length > 0) {
    blockers.push('explicit_integration_blockers');
  }

  const result: IntegrationReadinessResult = {
    state:
      hasFailedDimension || hasFailedSummary
        ? 'failed'
        : blockers.length > 0
          ? 'blocked'
          : hasRunningDimension || hasRunningSummary
            ? 'running'
            : 'passed',
    blockers,
  };
  if (summaryStatus !== undefined) {
    result.summary_status = summaryStatus;
  }
  return result;
};

type InitiativeAggregationInput = {
  kind: string;
  currentPackages: unknown[];
  childReadiness?: unknown[];
};

export const deriveInitiativeAggregationState = (
  input: InitiativeAggregationInput,
): { mode: 'direct_packages' | 'aggregated_children' | 'unavailable'; label: string } => {
  if (input.currentPackages.length > 0) {
    return { mode: 'direct_packages', label: 'Direct package readiness' };
  }
  if (input.kind === 'initiative' && (input.childReadiness === undefined || input.childReadiness.length === 0)) {
    return { mode: 'unavailable', label: 'Child-work aggregation unavailable' };
  }
  return { mode: 'aggregated_children', label: 'Child-work aggregation' };
};
