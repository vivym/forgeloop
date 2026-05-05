import type { CheckResult, RequiredCheckSpec, RunSpec } from '@forgeloop/contracts';

export const blockingCheck = (
  overrides: Partial<RequiredCheckSpec> = {},
): RequiredCheckSpec => ({
  check_id: 'unit',
  display_name: 'Unit tests',
  command: 'pnpm test tests/executor',
  timeout_seconds: 60,
  blocks_review: true,
  ...overrides,
});

export const createRunSpec = (
  overrides: Partial<RunSpec> & {
    repo?: Partial<RunSpec['repo']>;
    context?: Partial<RunSpec['context']>;
    review_context?: Partial<RunSpec['review_context']>;
  } = {},
): RunSpec => {
  const requiredChecks = overrides.required_checks ?? [blockingCheck()];
  const { repo, context, review_context: reviewContext, ...topLevelOverrides } = overrides;

  return {
    run_session_id: 'run-session-1',
    execution_package_id: 'execution-package-1',
    work_item_id: 'work-item-1',
    spec_revision_id: 'spec-revision-1',
    plan_revision_id: 'plan-revision-1',
    executor_type: 'local_codex',
    repo: {
      repo_id: 'repo-1',
      local_path: '/tmp/forgeloop-test-repo',
      base_branch: 'main',
      base_commit_sha: 'HEAD',
      ...repo,
    },
    objective: 'Implement the executor adapter.',
    context: {
      spec_revision_summary: 'Spec summary.',
      plan_revision_summary: 'Plan summary.',
      package_instructions: 'Keep changes scoped.',
      required_checks: requiredChecks,
      ...context,
    },
    review_context: {
      latest_decision: 'none',
      requested_changes: [],
      ...reviewContext,
    },
    workflow_only: false,
    allowed_paths: ['packages/executor/src/**', 'tests/executor/**'],
    forbidden_paths: ['packages/contracts/**'],
    required_checks: requiredChecks,
    artifact_policy: {
      requested_artifacts: ['diff', 'changed_files', 'check_output', 'execution_summary'],
    },
    timeout_seconds: 300,
    idempotency_key: 'execution-package-1:run-session-1:HEAD',
    ...topLevelOverrides,
  };
};

export const succeededCheckResult = (
  overrides: Partial<CheckResult> = {},
): CheckResult => ({
  check_id: 'unit',
  command: 'pnpm test tests/executor',
  status: 'succeeded',
  exit_code: 0,
  duration_seconds: 0.01,
  blocks_review: true,
  ...overrides,
});
