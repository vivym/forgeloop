import { describe, expect, it } from 'vitest';

import { runSpecSchema } from '@forgeloop/contracts';

const requiredChecks = [
  {
    check_id: 'api-tests',
    display_name: 'API tests',
    command: 'pnpm test tests/api',
    timeout_seconds: 120,
    blocks_review: true,
  },
];

const baseRunSpec = {
  run_session_id: 'run-session-1',
  execution_package_id: 'execution-package-1',
  project_id: 'project-1',
  expected_package_version: 0,
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
  objective: 'Validate source mutation run-spec rules.',
  context: {
    spec_revision_summary: 'Runtime safety contract.',
    plan_revision_summary: 'Validate conditional path policy.',
    package_instructions: 'Do not mutate source for this package.',
    required_checks: requiredChecks,
  },
  review_context: {
    requested_changes: [],
  },
  workflow_only: false,
  allowed_paths: ['apps/control-plane-api/**'],
  forbidden_paths: ['packages/db/**'],
  required_checks: requiredChecks,
  artifact_policy: {
    requested_artifacts: ['execution_summary'],
  },
  timeout_seconds: 300,
  idempotency_key: 'execution-package-1:run-session-1:748c32b',
} as const;

describe('RunSpec source mutation validation', () => {
  it('allows empty allowed_paths only for no-source-change run specs', () => {
    expect(
      runSpecSchema.parse({
        ...baseRunSpec,
        source_mutation_policy: 'no_source_changes',
        allowed_paths: [],
      }).allowed_paths,
    ).toEqual([]);
  });

  it('rejects empty allowed_paths when the source mutation policy is omitted', () => {
    expect(() => runSpecSchema.parse({ ...baseRunSpec, allowed_paths: [] })).toThrow(/source_mutation_policy/i);
  });

  it('rejects path-policy-scoped run specs with empty allowed_paths', () => {
    expect(() =>
      runSpecSchema.parse({
        ...baseRunSpec,
        source_mutation_policy: 'path_policy_scoped',
        allowed_paths: [],
      }),
    ).toThrow(/allowed_paths/i);
  });
});
