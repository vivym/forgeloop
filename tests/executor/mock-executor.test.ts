import { describe, expect, it } from 'vitest';

import { executorResultSchema } from '@forgeloop/contracts';
import { runMockExecutor } from '../../packages/executor/src/index';

import { blockingCheck, createRunSpec } from './test-fixtures';

describe('runMockExecutor', () => {
  it('returns a deterministic successful executor result by default', async () => {
    const runSpec = createRunSpec({ executor_type: 'mock' });

    const result = await runMockExecutor(runSpec);

    expect(executorResultSchema.parse(result)).toMatchObject({
      run_session_id: 'run-session-1',
      executor_type: 'mock',
      status: 'succeeded',
      changed_files: [
        {
          repo_id: 'repo-1',
          path: 'packages/executor/src/mock-change.ts',
          change_kind: 'modified',
        },
      ],
      checks: [
        {
          check_id: 'unit',
          status: 'succeeded',
          exit_code: 0,
          blocks_review: true,
        },
      ],
      raw_metadata: {
        mock_mode: 'success',
        workflow_only: false,
      },
    });
  });

  it('fails when mock mode marks a blocking check as failed', async () => {
    const runSpec = createRunSpec({
      executor_type: 'mock',
      raw_metadata: { mock_mode: 'blocking_check_failure' },
    });

    const result = await runMockExecutor(runSpec);

    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'failed',
      failure: {
        kind: 'required_check_failed',
        retryable: true,
      },
      checks: [
        {
          check_id: 'unit',
          status: 'failed',
          exit_code: 1,
          blocks_review: true,
        },
      ],
    });
  });

  it('succeeds when only a non-blocking check fails', async () => {
    const requiredChecks = [
      blockingCheck(),
      blockingCheck({
        check_id: 'lint',
        display_name: 'Lint',
        command: 'pnpm lint',
        blocks_review: false,
      }),
    ];
    const runSpec = createRunSpec({
      executor_type: 'mock',
      required_checks: requiredChecks,
      context: { required_checks: requiredChecks },
      raw_metadata: { mock_mode: 'non_blocking_check_failure' },
    });

    const result = await runMockExecutor(runSpec);

    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'succeeded',
      checks: [
        { check_id: 'unit', status: 'succeeded', blocks_review: true },
        { check_id: 'lint', status: 'failed', exit_code: 1, blocks_review: false },
      ],
    });
  });

  it('includes patch and changed-files artifacts for review packet creation', async () => {
    const result = await runMockExecutor(createRunSpec({ executor_type: 'mock' }));

    expect(result.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'diff',
          name: 'mock.patch',
          content_type: 'text/x-diff',
          local_ref: 'mock://run-session-1/mock.patch',
        }),
        expect.objectContaining({
          kind: 'changed_files',
          name: 'changed-files.json',
          content_type: 'application/json',
          local_ref: 'mock://run-session-1/changed-files.json',
        }),
      ]),
    );
  });

  it('records workflow-only runs in raw metadata without changing executor semantics', async () => {
    const result = await runMockExecutor(
      createRunSpec({
        executor_type: 'mock',
        workflow_only: true,
      }),
    );

    expect(executorResultSchema.parse(result)).toMatchObject({
      status: 'succeeded',
      raw_metadata: {
        workflow_only: true,
      },
    });
  });
});
