import type { ArtifactRef, ChangedFile, CheckResult } from '../../contracts/src/executor.js';

interface RequestedChangeContext {
  title: string;
  description: string;
  file_path?: string;
  severity?: 'minor' | 'major' | 'critical';
  suggested_validation?: string;
}

export interface MockSelfReviewInput {
  run_session_id: string;
  execution_package_id: string;
  spec_revision_id: string;
  plan_revision_id: string;
  run_summary: string;
  changed_files: ChangedFile[];
  check_results: CheckResult[];
  artifact_refs: ArtifactRef[];
  requested_changes_context: RequestedChangeContext[];
}

export interface MockSelfReviewResult {
  status: 'succeeded' | 'failed';
  summary: string;
  spec_plan_alignment: string;
  test_assessment: string;
  risk_notes: string[];
  follow_up_questions: string[];
  failure_message?: string;
}

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const requestedChangeNote = (change: MockSelfReviewInput['requested_changes_context'][number]): string => {
  const file = change.file_path === undefined ? '' : ` (${change.file_path})`;

  return `Considered requested change: ${change.title}${file}.`;
};

export const runMockSelfReview = async (input: MockSelfReviewInput): Promise<MockSelfReviewResult> => {
  const failureMarker = 'mock_self_review_failure:';
  const failureIndex = input.run_summary.indexOf(failureMarker);

  if (failureIndex >= 0) {
    const detail = input.run_summary.slice(failureIndex + failureMarker.length).trim() || 'unknown failure';

    return {
      status: 'failed',
      summary: `Mock self-review failed for run ${input.run_session_id}.`,
      spec_plan_alignment: 'Self-review could not assess spec and plan alignment.',
      test_assessment: 'Self-review could not assess test evidence.',
      risk_notes: ['Self-review unavailable; reviewer should treat this as degraded review context.'],
      follow_up_questions: [],
      failure_message: `Mock self-review failed: ${detail}`,
    };
  }

  const succeededChecks = input.check_results.filter((check) => check.status === 'succeeded').length;

  return {
    status: 'succeeded',
    summary: `Mock self-review completed for run ${input.run_session_id}.`,
    spec_plan_alignment: `Reviewed ${pluralize(input.changed_files.length, 'changed file')} against the run summary.`,
    test_assessment: `${pluralize(succeededChecks, 'check')} succeeded out of ${input.check_results.length}.`,
    risk_notes: input.requested_changes_context.map(requestedChangeNote),
    follow_up_questions: [],
  };
};
