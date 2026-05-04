import { describe, expect, it } from 'vitest';

import {
  executorResultSchema,
  reviewDecisionPayloadSchema,
  runSpecSchema,
  selfReviewResultSchema,
} from '../../packages/contracts/src/index';

describe('P0 delivery loop contracts', () => {
  it('parses a valid run spec', () => {
    const parsed = runSpecSchema.parse({
      run_session_id: 'run-session-1',
      execution_package_id: 'exec-package-1',
      work_item_id: 'work-item-1',
      spec_revision_id: 'spec-revision-1',
      plan_revision_id: 'plan-revision-1',
      executor_type: 'local_codex',
      repo: {
        repo_id: 'repo-1',
        local_path: '/workspace/repo',
        base_branch: 'main',
        base_commit_sha: '748c32b',
      },
      objective: 'Implement the P0 contracts package.',
      context: {
        spec_revision_summary: 'Thin delivery loop MVP contracts.',
        plan_revision_summary: 'Add Zod schemas and DTO types.',
        package_instructions: 'Keep this package shared-safe.',
        required_checks: [
          {
            check_id: 'contracts-test',
            display_name: 'Contracts tests',
            command: 'pnpm test tests/contracts',
            timeout_seconds: 60,
            blocks_review: true,
          },
        ],
      },
      review_context: {
        latest_decision: 'changes_requested',
        requested_changes: [
          {
            title: 'Clarify artifact refs',
            description: 'Make artifact references explicit enough for review packets.',
            file_path: 'packages/contracts/src/executor.ts',
            severity: 'major',
            suggested_validation: 'pnpm test tests/contracts',
          },
        ],
      },
      allowed_paths: ['packages/contracts/**', 'tests/contracts/**'],
      forbidden_paths: ['apps/**'],
      required_checks: [
        {
          check_id: 'contracts-test',
          display_name: 'Contracts tests',
          command: 'pnpm test tests/contracts',
          timeout_seconds: 60,
          blocks_review: true,
        },
      ],
      artifact_policy: {
        requested_artifacts: ['diff', 'changed_files', 'check_output', 'logs', 'execution_summary'],
      },
      timeout_seconds: 300,
      idempotency_key: 'exec-package-1:run-session-1:748c32b',
    });

    expect(parsed.executor_type).toBe('local_codex');
    expect(parsed.required_checks[0]?.blocks_review).toBe(true);
    expect(parsed.review_context.requested_changes).toHaveLength(1);
    expect(parsed.idempotency_key).toBe('exec-package-1:run-session-1:748c32b');
  });

  it('parses blocking and non-blocking executor results', () => {
    const blocking = executorResultSchema.parse({
      run_session_id: 'run-session-blocking',
      executor_type: 'local_codex',
      executor_version: '0.1.0',
      status: 'failed',
      started_at: '2026-05-05T01:00:00.000Z',
      finished_at: '2026-05-05T01:02:00.000Z',
      summary: 'Blocking required check failed, so review packet should not be created.',
      changed_files: [
        {
          repo_id: 'repo-1',
          path: 'packages/contracts/src/executor.ts',
          change_kind: 'modified',
        },
      ],
      checks: [
        {
          check_id: 'contracts-test',
          command: 'pnpm test tests/contracts',
          status: 'failed',
          exit_code: 1,
          duration_seconds: 12.4,
          blocks_review: true,
          stdout: {
            kind: 'check_output',
            name: 'contracts-test stdout',
            content_type: 'text/plain',
            local_ref: 'artifacts/run-session-blocking/stdout.log',
          },
          stderr: {
            kind: 'check_output',
            name: 'contracts-test stderr',
            content_type: 'text/plain',
            local_ref: 'artifacts/run-session-blocking/stderr.log',
          },
        },
      ],
      artifacts: [
        {
          kind: 'execution_summary',
          name: 'summary',
          content_type: 'text/markdown',
          local_ref: 'artifacts/run-session-blocking/summary.md',
          digest: 'sha256:summary-digest',
        },
      ],
      failure: {
        kind: 'required_check_failed',
        message: 'Contracts tests failed.',
        retryable: true,
      },
      raw_metadata: {
        codex_session_id: 'session-1',
      },
    });

    const nonBlocking = executorResultSchema.parse({
      run_session_id: 'run-session-non-blocking',
      executor_type: 'local_codex',
      executor_version: '0.1.0',
      status: 'succeeded',
      started_at: '2026-05-05T01:00:00.000Z',
      finished_at: '2026-05-05T01:02:00.000Z',
      summary: 'Execution succeeded with non-blocking risk notes.',
      changed_files: [
        {
          repo_id: 'repo-1',
          path: 'packages/contracts/src/review.ts',
          change_kind: 'added',
        },
      ],
      checks: [
        {
          check_id: 'optional-lint',
          command: 'pnpm lint',
          status: 'failed',
          exit_code: 1,
          duration_seconds: 8.1,
          blocks_review: false,
        },
      ],
      artifacts: [
        {
          kind: 'diff',
          name: 'working tree diff',
          content_type: 'text/x-diff',
          storage_uri: 's3://forgeloop-artifacts/run-session-non-blocking/diff.patch',
        },
      ],
      raw_metadata: {
        warning_count: 3,
      },
    });

    expect(blocking.status).toBe('failed');
    expect(blocking.failure?.kind).toBe('required_check_failed');
    expect(blocking.checks[0]?.blocks_review).toBe(true);
    expect(nonBlocking.status).toBe('succeeded');
    expect(nonBlocking.failure).toBeUndefined();
    expect(nonBlocking.checks[0]?.blocks_review).toBe(false);
  });

  it('parses a review request-changes decision payload', () => {
    const parsed = reviewDecisionPayloadSchema.parse({
      review_packet_id: 'review-packet-1',
      decision: 'changes_requested',
      summary: 'The contracts need a stronger API DTO surface before approval.',
      requested_changes: [
        {
          title: 'Add rerun DTO',
          description: 'Expose a contract for rerunning a package with requested changes context.',
          file_path: 'packages/contracts/src/api.ts',
          severity: 'major',
          suggested_validation: 'pnpm test tests/contracts',
        },
      ],
      reviewed_by_actor_id: 'actor-1',
      reviewed_at: '2026-05-05T02:00:00.000Z',
    });

    expect(parsed.decision).toBe('changes_requested');
    expect(parsed.requested_changes).toHaveLength(1);
  });

  it('parses a failed self-review result', () => {
    const parsed = selfReviewResultSchema.parse({
      status: 'failed',
      summary: 'Self-review could not determine whether the run satisfies the plan.',
      spec_plan_alignment: 'Insufficient evidence to evaluate plan alignment.',
      test_assessment: 'Required check output artifact was missing.',
      risk_notes: ['Human review should inspect executor artifacts manually.'],
      follow_up_questions: ['Was the contract test output captured elsewhere?'],
      failure_message: 'Missing check output artifact.',
    });

    expect(parsed.status).toBe('failed');
    expect(parsed.failure_message).toBe('Missing check output artifact.');
  });
});
