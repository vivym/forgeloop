import { describe, expect, it } from 'vitest';

import { selfReviewResultSchema, type SelfReviewInput } from '@forgeloop/contracts';
import { runMockSelfReview } from '../../packages/executor/src/index';

import { succeededCheckResult } from './test-fixtures';

const createSelfReviewInput = (overrides: Partial<SelfReviewInput> = {}): SelfReviewInput => ({
  run_session_id: 'run-session-1',
  execution_package_id: 'execution-package-1',
  spec_revision_id: 'spec-revision-1',
  plan_revision_id: 'plan-revision-1',
  run_summary: 'Executor completed successfully.',
  changed_files: [
    {
      repo_id: 'repo-1',
      path: 'packages/executor/src/mock-executor.ts',
      change_kind: 'modified',
    },
  ],
  check_results: [succeededCheckResult()],
  artifact_refs: [
    {
      kind: 'diff',
      name: 'mock.patch',
      content_type: 'text/x-diff',
      local_ref: 'mock://run-session-1/mock.patch',
    },
  ],
  requested_changes_context: [],
  ...overrides,
});

describe('runMockSelfReview', () => {
  it('returns a successful mock self-review for a completed run', async () => {
    const result = await runMockSelfReview(createSelfReviewInput());

    expect(selfReviewResultSchema.parse(result)).toMatchObject({
      status: 'succeeded',
      summary: 'Mock self-review completed for run run-session-1.',
      spec_plan_alignment: expect.stringContaining('1 changed file'),
      test_assessment: expect.stringContaining('1 check succeeded'),
      risk_notes: [],
      follow_up_questions: [],
    });
  });

  it('degrades review context rather than execution when self-review fails', async () => {
    const result = await runMockSelfReview(
      createSelfReviewInput({
        run_summary: 'mock_self_review_failure: model unavailable',
      }),
    );

    expect(selfReviewResultSchema.parse(result)).toMatchObject({
      status: 'failed',
      failure_message: 'Mock self-review failed: model unavailable',
      risk_notes: [expect.stringContaining('Self-review unavailable')],
    });
  });

  it('reflects requested-change context so rerun review can see it was considered', async () => {
    const result = await runMockSelfReview(
      createSelfReviewInput({
        requested_changes_context: [
          {
            title: 'Cover blocking checks',
            description: 'Add behavior coverage for blocking check failures.',
            file_path: 'tests/executor/mock-executor.test.ts',
            severity: 'major',
            suggested_validation: 'pnpm test tests/executor',
          },
        ],
      }),
    );

    expect(result.risk_notes).toContain(
      'Considered requested change: Cover blocking checks (tests/executor/mock-executor.test.ts).',
    );
  });
});
