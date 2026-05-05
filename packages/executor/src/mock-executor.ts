import type {
  ArtifactRef,
  ChangedFile,
  CheckResult,
  ExecutorResult,
  JsonValue,
  RunSpec,
} from '../../contracts/src/executor.js';

type MockMode = 'success' | 'blocking_check_failure' | 'non_blocking_check_failure';

type MockRunSpec = RunSpec & {
  raw_metadata?: Record<string, JsonValue>;
};

const EXECUTOR_VERSION = '0.1.0';
const FIXED_STARTED_AT = '2026-05-05T00:00:00.000Z';
const FIXED_FINISHED_AT = '2026-05-05T00:00:01.000Z';

const mockModeFor = (runSpec: MockRunSpec): MockMode => {
  const mode = runSpec.raw_metadata?.mock_mode;

  if (mode === 'blocking_check_failure' || mode === 'non_blocking_check_failure') {
    return mode;
  }

  return 'success';
};

const defaultChangedFiles = (runSpec: RunSpec): ChangedFile[] => [
  {
    repo_id: runSpec.repo.repo_id,
    path: 'packages/executor/src/mock-change.ts',
    change_kind: 'modified',
  },
];

const checkResultsFor = (runSpec: RunSpec, mode: MockMode): CheckResult[] => {
  const blockingFailureIndex = runSpec.required_checks.findIndex((check) => check.blocks_review);
  const nonBlockingFailureIndex = runSpec.required_checks.findIndex((check) => !check.blocks_review);

  return runSpec.required_checks.map((check, index) => {
    const shouldFail =
      (mode === 'blocking_check_failure' && index === blockingFailureIndex) ||
      (mode === 'non_blocking_check_failure' && index === nonBlockingFailureIndex);

    return {
      check_id: check.check_id,
      command: check.command,
      status: shouldFail ? 'failed' : 'succeeded',
      exit_code: shouldFail ? 1 : 0,
      duration_seconds: 0.01,
      blocks_review: check.blocks_review,
    };
  });
};

const artifactsFor = (runSpec: RunSpec): ArtifactRef[] => [
  {
    kind: 'diff',
    name: 'mock.patch',
    content_type: 'text/x-diff',
    local_ref: `mock://${runSpec.run_session_id}/mock.patch`,
  },
  {
    kind: 'changed_files',
    name: 'changed-files.json',
    content_type: 'application/json',
    local_ref: `mock://${runSpec.run_session_id}/changed-files.json`,
  },
  {
    kind: 'execution_summary',
    name: 'execution-summary.md',
    content_type: 'text/markdown',
    local_ref: `mock://${runSpec.run_session_id}/execution-summary.md`,
  },
];

export const runMockExecutor = async (runSpec: MockRunSpec): Promise<ExecutorResult> => {
  const mode = mockModeFor(runSpec);
  const checks = checkResultsFor(runSpec, mode);
  const hasBlockingFailure = checks.some((check) => check.blocks_review && check.status !== 'succeeded');

  return {
    run_session_id: runSpec.run_session_id,
    executor_type: 'mock',
    executor_version: EXECUTOR_VERSION,
    status: hasBlockingFailure ? 'failed' : 'succeeded',
    started_at: FIXED_STARTED_AT,
    finished_at: FIXED_FINISHED_AT,
    summary: hasBlockingFailure
      ? 'Mock execution failed because a blocking check failed.'
      : 'Mock execution succeeded.',
    changed_files: defaultChangedFiles(runSpec),
    checks,
    artifacts: artifactsFor(runSpec),
    ...(hasBlockingFailure
      ? {
          failure: {
            kind: 'required_check_failed' as const,
            message: 'A blocking required check failed in mock execution.',
            retryable: true,
          },
        }
      : {}),
    raw_metadata: {
      mock_mode: mode,
      workflow_only: runSpec.workflow_only,
    },
  };
};
