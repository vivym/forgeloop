import { describe, expect, it } from 'vitest';

import {
  DomainError,
  deriveRequiredArtifactPresence,
  deriveWorkItemCompletion,
  validateExecutionPackage,
  validateForceRerunAllowed,
  validatePackageDependencyGraph,
  validatePackageEditAllowed,
  validateRepoBelongsToProject,
  type ExecutionPackage,
  type Project,
  type ReviewPacket,
  type RunSession,
  type WorkItem,
} from '../../packages/domain/src/index';
import { buildPackageRuntimePolicySnapshot, RUNTIME_POLICY_SOURCE_PATH, runtimePolicyFromDocument } from '../../packages/executor/src/index';

const timestamp = '2026-05-05T00:00:00.000Z';
const requirementIntakeContext: WorkItem['intake_context'] = {
  type: 'requirement',
  stakeholder_problem: 'Domain rules need typed Work Item intake fixtures.',
  desired_outcome: 'Validator tests use requirement Work Items with complete intake context.',
  acceptance_criteria: ['Direct Work Item fixtures include requirement intake context.'],
  in_scope: ['Domain validator fixtures'],
};

const requiredCheck = {
  check_id: 'domain-tests',
  display_name: 'Domain tests',
  command: 'pnpm test tests/domain',
  timeout_seconds: 120,
  blocks_review: true,
};

const workflowPolicySnapshot = (input: {
  allowedPaths: string[];
  forbiddenPaths: string[];
  requiredChecks: ExecutionPackage['required_checks'];
  sourceMutationPolicy: ExecutionPackage['source_mutation_policy'];
}): NonNullable<ExecutionPackage['package_policy_snapshot']> =>
  buildPackageRuntimePolicySnapshot({
    loadedPolicy: runtimePolicyFromDocument({
      document: {
        codex: { primary_executor: 'mock', network_mode: 'disabled' },
        path_policy: { allowed_paths: input.allowedPaths, forbidden_paths: input.forbiddenPaths },
        observability: { public_summary: 'Domain tests are required before review.' },
      },
      markdownBody: '',
      loadedAt: timestamp,
    }),
    executionPackageChecks: input.requiredChecks,
    executionPackagePathPolicy: { allowed_paths: input.allowedPaths, forbidden_paths: input.forbiddenPaths },
    validationStrategy: 'checks_required',
    sourceMutationPolicy: input.sourceMutationPolicy,
  });

const executionSummaryArtifact = {
  kind: 'execution_summary',
  name: 'summary',
  content_type: 'text/markdown',
  local_ref: 'artifacts/run-session/summary.md',
} as const;

const diffArtifact = {
  kind: 'diff',
  name: 'diff',
  content_type: 'text/x-diff',
  local_ref: 'artifacts/run-session/diff.patch',
} as const;

const logsArtifact = {
  kind: 'logs',
  name: 'executor log',
  content_type: 'text/plain',
  local_ref: 'artifacts/run-session/executor.log',
} as const;

const project: Project = {
  id: 'project-1',
  name: 'Forgeloop',
  repo_ids: ['repo-1'],
  created_at: timestamp,
  updated_at: timestamp,
};

const packageBase = (overrides: Partial<ExecutionPackage> = {}): ExecutionPackage => ({
  id: 'package-1',
  work_item_id: 'work-item-1',
  spec_id: 'spec-1',
  spec_revision_id: 'spec-revision-1',
  plan_id: 'plan-1',
  plan_revision_id: 'plan-revision-1',
  project_id: 'project-1',
  repo_id: 'repo-1',
  objective: 'Implement the domain package.',
  owner_actor_id: 'actor-owner',
  reviewer_actor_id: 'actor-reviewer',
  qa_owner_actor_id: 'actor-qa',
  phase: 'ready',
  activity_state: 'idle',
  gate_state: 'not_submitted',
  resolution: 'none',
  required_checks: [requiredCheck],
  required_artifact_kinds: ['execution_summary', 'diff'],
  allowed_paths: ['packages/domain/**', 'tests/domain/**'],
  forbidden_paths: ['apps/**'],
  source_mutation_policy: 'path_policy_scoped',
  version: 0,
  policy_snapshot_status: 'captured',
  policy_snapshot_version: 1,
  package_policy_snapshot: workflowPolicySnapshot({
    allowedPaths: ['packages/domain/**', 'tests/domain/**'],
    forbiddenPaths: ['apps/**'],
    requiredChecks: [requiredCheck],
    sourceMutationPolicy: 'path_policy_scoped',
  }),
  created_at: timestamp,
  updated_at: timestamp,
  ...overrides,
});

const safeDefaultPolicySnapshot = (
  overrides: Partial<NonNullable<ExecutionPackage['package_policy_snapshot']>> = {},
): NonNullable<ExecutionPackage['package_policy_snapshot']> => {
  const safeDefaultApprovalEvidence = {
    evidence_type: 'decision' as const,
    ref_id: 'decision-1',
    approved_by_actor_id: 'actor-reviewer',
    approved_by_actor_class: 'human' as const,
    approved_at: timestamp,
    summary: 'Reviewed safe default after missing WORKFLOW.md.',
  };
  return {
    ...buildPackageRuntimePolicySnapshot({
      loadedPolicy: {
        status: 'missing',
        policy_source_path: RUNTIME_POLICY_SOURCE_PATH,
        policy_loaded_at: timestamp,
        policy_last_known_good: false,
        blocker_code: 'runtime_policy_missing',
        diagnostics: [{ code: 'runtime_policy_missing', message: 'WORKFLOW.md is missing.', retryable: false }],
      },
      executionPackageChecks: [],
      executionPackagePathPolicy: { allowed_paths: [], forbidden_paths: [] },
      validationStrategy: 'checks_required',
      sourceMutationPolicy: 'no_source_changes',
      safeDefaultApprovalEvidence,
    }),
    ...overrides,
  };
};

const safeDefaultPackage = (
  snapshotOverrides: Partial<NonNullable<ExecutionPackage['package_policy_snapshot']>> = {},
  packageOverrides: Partial<ExecutionPackage> = {},
): ExecutionPackage =>
  packageBase({
    allowed_paths: [],
    forbidden_paths: [],
    source_mutation_policy: 'no_source_changes',
    package_policy_snapshot: safeDefaultPolicySnapshot(snapshotOverrides),
    ...packageOverrides,
  });

const workItem: WorkItem = {
  id: 'work-item-1',
  project_id: 'project-1',
  kind: 'requirement',
  title: 'Domain rules',
  goal: 'Enforce domain state rules.',
  success_criteria: ['Completion and review validators reflect the delivery domain spec.'],
  priority: 'P0',
  risk: 'medium',
  driver_actor_id: 'actor-owner',
  intake_context: requirementIntakeContext,
  phase: 'execution',
  activity_state: 'idle',
  gate_state: 'none',
  resolution: 'none',
  created_at: timestamp,
  updated_at: timestamp,
};

const successfulRun = (overrides: Partial<RunSession> = {}): RunSession => ({
  id: 'run-session-1',
  execution_package_id: 'package-1',
  requested_by_actor_id: 'actor-owner',
  status: 'succeeded',
  changed_files: [
    {
      repo_id: 'repo-1',
      path: 'packages/domain/src/types.ts',
      change_kind: 'modified',
    },
  ],
  check_results: [
    {
      check_id: 'domain-tests',
      command: 'pnpm test tests/domain',
      status: 'succeeded',
      exit_code: 0,
      duration_seconds: 7,
      blocks_review: true,
    },
  ],
  artifacts: [executionSummaryArtifact, diffArtifact],
  log_refs: [
    {
      kind: 'logs',
      name: 'executor log',
      content_type: 'text/plain',
      local_ref: 'artifacts/run-session/executor.log',
    },
  ],
  created_at: timestamp,
  updated_at: timestamp,
  finished_at: timestamp,
  ...overrides,
});

const approvedReviewPacket = (overrides: Partial<ReviewPacket> = {}): ReviewPacket => ({
  id: 'review-packet-1',
  run_session_id: 'run-session-1',
  execution_package_id: 'package-1',
  reviewer_actor_id: 'actor-reviewer',
  spec_revision_id: 'spec-revision-1',
  plan_revision_id: 'plan-revision-1',
  status: 'completed',
  decision: 'approved',
  changed_files: [
    {
      repo_id: 'repo-1',
      path: 'packages/domain/src/types.ts',
      change_kind: 'modified',
    },
  ],
  check_result_summary: 'pnpm test tests/domain passed.',
  self_review: {
    status: 'succeeded',
    summary: 'Changes match the delivery domain spec.',
    spec_plan_alignment: 'Fields are frozen from approved spec and plan revisions.',
    test_assessment: 'Domain transition tests cover the new review packet context.',
    risk_notes: [],
    follow_up_questions: [],
  },
  risk_notes: [],
  requested_changes: [],
  created_at: timestamp,
  updated_at: timestamp,
  completed_at: timestamp,
  ...overrides,
});

const openReviewPacket = (overrides: Partial<ReviewPacket> = {}): ReviewPacket => ({
  id: 'review-packet-1',
  run_session_id: 'run-session-1',
  execution_package_id: 'package-1',
  reviewer_actor_id: 'actor-reviewer',
  spec_revision_id: 'spec-revision-1',
  plan_revision_id: 'plan-revision-1',
  status: 'ready',
  decision: 'none',
  changed_files: [
    {
      repo_id: 'repo-1',
      path: 'packages/domain/src/types.ts',
      change_kind: 'modified',
    },
  ],
  check_result_summary: 'pnpm test tests/domain passed.',
  self_review: {
    status: 'succeeded',
    summary: 'Changes match the delivery domain spec.',
    spec_plan_alignment: 'Fields are frozen from approved spec and plan revisions.',
    test_assessment: 'Domain transition tests cover the new review packet context.',
    risk_notes: [],
    follow_up_questions: [],
  },
  risk_notes: [],
  requested_changes: [],
  created_at: timestamp,
  updated_at: timestamp,
  ...overrides,
});

const expectDomainError = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }

  throw new Error(`Expected DomainError ${code}`);
};

describe('domain validators', () => {
  it('validates that a repo belongs to the project', () => {
    expect(() => validateRepoBelongsToProject(project, 'repo-1')).not.toThrow();
    expectDomainError(() => validateRepoBelongsToProject(project, 'repo-2'), 'REPO_NOT_BOUND');
  });

  it('rejects packages bound to repos outside the project', () => {
    expectDomainError(
      () => validateExecutionPackage(project, packageBase({ repo_id: 'repo-2' })),
      'REPO_NOT_BOUND',
    );
  });

  it('rejects packages whose project_id does not match the project', () => {
    expectDomainError(
      () => validateExecutionPackage(project, packageBase({ project_id: 'project-2' })),
      'PROJECT_MISMATCH',
    );
  });

  it('rejects packages that span multiple repos', () => {
    expectDomainError(
      () =>
        validateExecutionPackage(project, packageBase(), {
          referenced_repo_ids: ['repo-1', 'repo-2'],
        }),
      'PACKAGE_MULTIPLE_REPOS',
    );
  });

  it('rejects packages missing required checks, owner, reviewer, or objective', () => {
    expectDomainError(
      () => validateExecutionPackage(project, packageBase({ required_checks: [] })),
      'REQUIRED_CHECK_MISSING',
    );
    expectDomainError(
      () => validateExecutionPackage(project, packageBase({ owner_actor_id: '' })),
      'OWNER_REQUIRED',
    );
    expectDomainError(
      () => validateExecutionPackage(project, packageBase({ reviewer_actor_id: '' })),
      'REVIEWER_REQUIRED',
    );
    expectDomainError(
      () => validateExecutionPackage(project, packageBase({ qa_owner_actor_id: '   ' })),
      'QA_OWNER_REQUIRED',
    );
    expectDomainError(
      () => validateExecutionPackage(project, packageBase({ objective: '   ' })),
      'EXECUTION_OBJECTIVE_REQUIRED',
    );
  });

  it('rejects packages with a negative mutable version', () => {
    expectDomainError(
      () => validateExecutionPackage(project, packageBase({ version: -1 })),
      'EXECUTION_PACKAGE_VERSION_INVALID',
    );
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY] as const)(
    'rejects packages with non-integer or non-finite mutable version %s',
    (version) => {
      expectDomainError(
        () => validateExecutionPackage(project, packageBase({ version })),
        'EXECUTION_PACKAGE_VERSION_INVALID',
      );
    },
  );

  it('requires a captured policy snapshot before ready or run-eligible phases', () => {
    expectDomainError(
      () => validateExecutionPackage(project, packageBase({ policy_snapshot_status: 'missing' })),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );
    expectDomainError(
      () => validateExecutionPackage(project, packageBase({ phase: 'queued', policy_snapshot_status: 'stale' })),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );
  });

  it('requires ready packages to include a captured policy snapshot payload', () => {
    expectDomainError(
      () => validateExecutionPackage(project, packageBase({ package_policy_snapshot: undefined })),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5] as const)(
    'rejects ready packages with invalid policy snapshot version %s',
    (policy_snapshot_version) => {
      expectDomainError(
        () => validateExecutionPackage(project, packageBase({ policy_snapshot_version })),
        'EXECUTION_PACKAGE_POLICY_INVALID',
      );
    },
  );

  it('requires policy snapshot metadata to match the package snapshot payload', () => {
    const { source_mutation_policy: _sourceMutationPolicy, ...snapshotWithoutSourceMutationPolicy } = packageBase().package_policy_snapshot!;

    expectDomainError(
      () =>
        validateExecutionPackage(
          project,
          packageBase({
            package_policy_snapshot: snapshotWithoutSourceMutationPolicy as ExecutionPackage['package_policy_snapshot'],
          }),
        ),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );

    expectDomainError(
      () =>
        validateExecutionPackage(
          project,
          packageBase({
            policy_snapshot_version: 2,
          }),
        ),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );

    expectDomainError(
      () =>
        validateExecutionPackage(
          project,
          packageBase({
            package_policy_snapshot: {
              ...packageBase().package_policy_snapshot!,
              policy_snapshot_status: 'stale',
            },
          }),
        ),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );

    expectDomainError(
      () =>
        validateExecutionPackage(
          project,
          packageBase({
            validation_strategy: 'custom',
            validation_strategy_version: 1,
            validation_public_summary: 'Validated through an approved manual contract.',
          }),
        ),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );

    expectDomainError(
      () =>
        validateExecutionPackage(
          project,
          packageBase({
            package_policy_snapshot: {
              ...packageBase().package_policy_snapshot!,
              validation_strategy: 'custom',
            },
          }),
        ),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );

  });

  it('rejects ready source-mutating packages with empty allowed paths', () => {
    expectDomainError(
      () =>
        validateExecutionPackage(
          project,
          packageBase({
            allowed_paths: [],
            source_mutation_policy: undefined as unknown as ExecutionPackage['source_mutation_policy'],
          }),
        ),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );

    expectDomainError(
      () =>
        validateExecutionPackage(
          project,
          packageBase({
            allowed_paths: [],
            source_mutation_policy: 'path_policy_scoped',
          }),
        ),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );

  });

  it('rejects malformed source mutation policies from persisted package data', () => {
    expectDomainError(
      () =>
        validateExecutionPackage(
          project,
          packageBase({
            allowed_paths: [],
            source_mutation_policy: 'no-source-changes' as ExecutionPackage['source_mutation_policy'],
            package_policy_snapshot: {
              ...packageBase().package_policy_snapshot!,
              source_mutation_policy: 'no-source-changes' as ExecutionPackage['source_mutation_policy'],
            },
          }),
        ),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );

    expectDomainError(
      () =>
        validateExecutionPackage(
          project,
          packageBase({
            package_policy_snapshot: {
              ...packageBase().package_policy_snapshot!,
              source_mutation_policy: 'path-policy-scoped' as ExecutionPackage['source_mutation_policy'],
            },
          }),
        ),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );

  });

  it('rejects ready packages with partial or digest-mismatched frozen runtime policy snapshots', () => {
    const validSnapshot = packageBase().package_policy_snapshot!;
    expectDomainError(
      () =>
        validateExecutionPackage(
          project,
          packageBase({
            package_policy_snapshot: {
              ...validSnapshot,
              normalized_policy_payload: undefined,
            },
          }),
        ),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );

    expectDomainError(
      () =>
        validateExecutionPackage(
          project,
          packageBase({
            package_policy_snapshot: {
              ...validSnapshot,
              policy_digest: 'sha256:wrong-policy-digest',
            },
          }),
        ),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );

    expectDomainError(
      () =>
        validateExecutionPackage(
          project,
          packageBase({
            package_policy_snapshot: {
              ...validSnapshot,
              normalized_policy_payload: {
                parser_version: validSnapshot.normalized_policy_payload!.parser_version,
                policy_source_path: validSnapshot.normalized_policy_payload!.policy_source_path,
                normalized_payload_digest: validSnapshot.policy_digest,
              },
            },
          }),
        ),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );

    expectDomainError(
      () =>
        validateExecutionPackage(
          project,
          packageBase({
            package_policy_snapshot: {
              ...validSnapshot,
              normalized_policy_payload: {
                ...validSnapshot.normalized_policy_payload!,
                normalized_markdown_body: 'tampered runtime instructions',
              },
            },
          }),
        ),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );

    expectDomainError(
      () =>
        validateExecutionPackage(
          project,
          packageBase({
            package_policy_snapshot: {
              ...validSnapshot,
              env_policy: { allow: ['CI'] },
            },
          }),
        ),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );
  });

  it('allows reviewed safe-default packages that cannot mutate source', () => {
    expect(() => validateExecutionPackage(project, safeDefaultPackage())).not.toThrow();
  });

  it('allows reviewed safe-default snapshots built from a missing repo-root WORKFLOW.md policy', () => {
    const snapshot = buildPackageRuntimePolicySnapshot({
      loadedPolicy: {
        status: 'missing',
        policy_source_path: RUNTIME_POLICY_SOURCE_PATH,
        policy_loaded_at: timestamp,
        policy_last_known_good: false,
        blocker_code: 'runtime_policy_missing',
        diagnostics: [{ code: 'runtime_policy_missing', message: 'WORKFLOW.md is missing.', retryable: false }],
      },
      executionPackageChecks: [],
      executionPackagePathPolicy: { allowed_paths: [], forbidden_paths: [] },
      validationStrategy: 'checks_required',
      sourceMutationPolicy: 'no_source_changes',
      safeDefaultApprovalEvidence: safeDefaultPolicySnapshot().safe_default_approval_evidence!,
    });

    expect(() => validateExecutionPackage(project, safeDefaultPackage({}, { package_policy_snapshot: snapshot }))).not.toThrow();
  });

  it.each([
    [
      'non-empty normalized front matter',
      {
        normalized_policy_payload: {
          ...safeDefaultPolicySnapshot().normalized_policy_payload!,
          normalized_front_matter: { hooks: {} },
        },
      },
    ],
    [
      'non-empty normalized markdown body',
      {
        normalized_policy_payload: {
          ...safeDefaultPolicySnapshot().normalized_policy_payload!,
          normalized_markdown_body: 'policy docs',
        },
      },
    ],
    [
      'extra normalized payload keys',
      {
        normalized_policy_payload: {
          ...safeDefaultPolicySnapshot().normalized_policy_payload!,
          extra_non_empty_policy: { commands: ['should-not-pass'] },
        },
      },
    ],
    ['array hook policy', { hooks: [] }],
    ['hooks', { hooks: { before_run: [{ hook_id: 'before' }], after_run: [] } }],
    ['hook policy extra keys', { hooks: { before_run: [], after_run: [], post_run: [] } }],
    ['frozen hook policy extra keys', { frozen_hook_specs: { before_run: [], after_run: [], post_run: [] } }],
    ['source-mutating path policy', { path_policy: { allowed_paths: ['src/**'], forbidden_paths: [] } }],
    ['non-string forbidden path', { path_policy: { allowed_paths: [], forbidden_paths: [123] } }],
    ['object forbidden path policy', { path_policy: { allowed_paths: [], forbidden_paths: { glob: 'src/**' } } }],
    ['path policy extra keys', { path_policy: { allowed_paths: [], forbidden_paths: [], allow_all_repo: true } }],
    [
      'source-mutating frozen check',
      {
        frozen_command_check_policy: {
          required_checks: [{ check_id: 'unit', source_write_policy: 'path_policy_scoped' }],
        },
      },
    ],
    [
      'invalid frozen check source write policy',
      {
        frozen_command_check_policy: {
          required_checks: [{ check_id: 'unit', source_write_policy: 'workspace_write' }],
        },
      },
    ],
    [
      'source-mutating nested frozen check command',
      {
        frozen_command_check_policy: {
          required_checks: [
            {
              check_id: 'unit',
              command: {
                executable: 'pnpm',
                args: ['test'],
                cwd: 'workspace_root',
                source_write_policy: 'path_policy_scoped',
              },
            },
          ],
        },
      },
    ],
    ['enabled fallback', { fallback_policy: { mode: 'enabled' } }],
    ['alternate fallback disabled key', { fallback_policy: { allow_exec_fallback: false } }],
    ['alternate fallback enabled key', { fallback_policy: { enabled: false } }],
    ['fallback policy extra keys', { fallback_policy: { mode: 'disabled', allow_exec_fallback: true } }],
    ['environment allowlist', { env_policy: { allow: ['CI'] } }],
    ['alternate empty environment allowlist', { env_policy: { allowed: [] } }],
    ['environment policy extra keys', { env_policy: { allow: [], secret_allow: ['TOKEN'] } }],
    ['public artifact visibility', { artifact_visibility_policy: { default_visibility: 'public' } }],
    ['alternate artifact visibility key', { artifact_visibility_policy: { visibility: 'internal' } }],
    ['artifact visibility extra keys', { artifact_visibility_policy: { default_visibility: 'internal', public_paths: ['logs/**'] } }],
    ['missing approval evidence', { safe_default_approval_evidence: undefined }],
    [
      'invalid approval evidence type',
      { safe_default_approval_evidence: { ...safeDefaultPolicySnapshot().safe_default_approval_evidence!, evidence_type: 'automation' } },
    ],
    [
      'invalid approval actor class',
      {
        safe_default_approval_evidence: {
          ...safeDefaultPolicySnapshot().safe_default_approval_evidence!,
          approved_by_actor_role: 'reviewer',
        },
      },
    ],
    ['null approval evidence', { safe_default_approval_evidence: null }],
    [
      'approval evidence extra keys',
      {
        safe_default_approval_evidence: {
          ...safeDefaultPolicySnapshot().safe_default_approval_evidence!,
          approved_by_actor_class: 'automation_daemon',
        },
      },
    ],
    ['network digest mismatch', { network_policy_digest: 'egress-allowlist-digest' }],
    ['network mode mismatch', { codex_runtime_mode: { primary_executor: 'mock', network_mode: 'egress_allowlist' } }],
    ['network mode extra keys', { codex_runtime_mode: { primary_executor: 'mock', network_mode: 'disabled', egress_allowlist_digest: 'digest' } }],
    ['null primary executor', { codex_runtime_mode: { primary_executor: null, network_mode: 'disabled' } }],
    ['missing primary executor', { codex_runtime_mode: { primary_executor: undefined, network_mode: 'disabled' } }],
    ['unknown primary executor', { codex_runtime_mode: { primary_executor: 'sidecar', network_mode: 'disabled' } }],
    ['validation evidence refs', { validation_evidence_refs: [executionSummaryArtifact] }],
    ['object validation evidence refs', { validation_evidence_refs: { length: 0 } }],
    ['string validation evidence refs', { validation_evidence_refs: '' }],
  ] as const)('rejects reviewed safe-default packages with %s', (_label, snapshotOverrides) => {
    expectDomainError(
      () => validateExecutionPackage(project, safeDefaultPackage(snapshotOverrides)),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );
  });

  it('rejects reviewed safe-default packages unless validation strategy is checks_required', () => {
    expectDomainError(
      () =>
        validateExecutionPackage(
          project,
          safeDefaultPackage(
            { validation_strategy: 'custom' },
            {
              validation_strategy: 'custom',
              validation_strategy_version: 1,
              validation_public_summary: 'Manual custom validation is not a safe default.',
            },
          ),
        ),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );
  });

  it('rejects source mutation policy mismatches between package and snapshot', () => {
    expectDomainError(
      () =>
        validateExecutionPackage(
          project,
          packageBase({
            source_mutation_policy: 'no_source_changes',
            allowed_paths: [],
            package_policy_snapshot: {
              ...packageBase().package_policy_snapshot!,
              source_mutation_policy: 'path_policy_scoped',
            },
          }),
        ),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );
  });

  it('requires reviewed approval and evidence for allow_all_repo validation', () => {
    expectDomainError(
      () =>
        validateExecutionPackage(
          project,
          packageBase({
            required_checks: [],
            validation_strategy: 'allow_all_repo',
          }),
        ),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );

    expect(() =>
      validateExecutionPackage(
        project,
        packageBase({
          required_checks: [],
          validation_strategy: 'allow_all_repo',
          validation_approved_by: 'actor-reviewer',
          validation_approved_at: timestamp,
          validation_evidence_refs: [executionSummaryArtifact],
          package_policy_snapshot: {
            ...packageBase().package_policy_snapshot!,
            validation_strategy: 'allow_all_repo',
          },
        }),
      ),
    ).not.toThrow();
  });

  it('requires a public summary and frozen version for custom validation strategies', () => {
    expectDomainError(
      () =>
        validateExecutionPackage(
          project,
          packageBase({
            required_checks: [],
            validation_strategy: 'custom',
            validation_strategy_version: 1,
          }),
        ),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );
    expectDomainError(
      () =>
        validateExecutionPackage(
          project,
          packageBase({
            required_checks: [],
            validation_strategy: 'custom',
            validation_public_summary: 'Validated through an approved manual contract.',
          }),
        ),
      'EXECUTION_PACKAGE_POLICY_INVALID',
    );

    expect(() =>
      validateExecutionPackage(
        project,
        packageBase({
          required_checks: [],
          validation_strategy: 'custom',
          validation_strategy_version: 1,
          validation_public_summary: 'Validated through an approved manual contract.',
          package_policy_snapshot: {
            ...packageBase().package_policy_snapshot!,
            validation_strategy: 'custom',
          },
        }),
      ),
    ).not.toThrow();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5] as const)(
    'rejects custom validation strategy version %s',
    (validation_strategy_version) => {
      expectDomainError(
        () =>
          validateExecutionPackage(
            project,
            packageBase({
              required_checks: [],
              validation_strategy: 'custom',
              validation_strategy_version,
              validation_public_summary: 'Validated through an approved manual contract.',
              package_policy_snapshot: {
                ...packageBase().package_policy_snapshot!,
                validation_strategy: 'custom',
              },
            }),
          ),
        'EXECUTION_PACKAGE_POLICY_INVALID',
      );
    },
  );

  it('detects dependency cycles', () => {
    const packages = [packageBase({ id: 'package-a' }), packageBase({ id: 'package-b' })];

    expectDomainError(
      () =>
        validatePackageDependencyGraph(packages, [
          { package_id: 'package-a', depends_on_package_id: 'package-b' },
          { package_id: 'package-b', depends_on_package_id: 'package-a' },
        ]),
      'DEPENDENCY_CYCLE',
    );
  });

  it('allows package editing only in draft or ready', () => {
    expect(() => validatePackageEditAllowed(packageBase({ phase: 'draft' }))).not.toThrow();
    expect(() => validatePackageEditAllowed(packageBase({ phase: 'ready' }))).not.toThrow();
    expectDomainError(() => validatePackageEditAllowed(packageBase({ phase: 'queued' })), 'EDIT_NOT_ALLOWED');
    expectDomainError(() => validatePackageEditAllowed(packageBase({ phase: 'review' })), 'EDIT_NOT_ALLOWED');
  });

  it('allows force-rerun only for the execution owner while the current review packet is open', () => {
    const reviewPackage = packageBase({
      phase: 'review',
      activity_state: 'awaiting_human',
      last_run_session_id: 'run-session-1',
    });
    const openPacket = openReviewPacket();

    expect(() => validateForceRerunAllowed(reviewPackage, [openPacket], 'actor-owner')).not.toThrow();
    expectDomainError(
      () => validateForceRerunAllowed(reviewPackage, [openPacket], 'actor-reviewer'),
      'FORCE_RERUN_FORBIDDEN',
    );
    expectDomainError(
      () => validateForceRerunAllowed(reviewPackage, [approvedReviewPacket()], 'actor-owner'),
      'FORCE_RERUN_FORBIDDEN',
    );
  });

  it.each(['ready', 'in_review'] as const)(
    'rejects force-rerun for a completed package even with an open %s review packet',
    (status) => {
      const completedPackage = packageBase({
        phase: 'release',
        activity_state: 'idle',
        gate_state: 'release_ready',
        resolution: 'completed',
        last_run_session_id: 'run-session-1',
      });

      expectDomainError(
        () => validateForceRerunAllowed(completedPackage, [openReviewPacket({ status })], 'actor-owner'),
        'FORCE_RERUN_FORBIDDEN',
      );
    },
  );

  it('rejects force-rerun when the only open review packet belongs to an older run', () => {
    const reviewPackage = packageBase({
      phase: 'review',
      activity_state: 'awaiting_human',
      last_run_session_id: 'run-session-2',
    });

    expectDomainError(
      () => validateForceRerunAllowed(reviewPackage, [openReviewPacket({ run_session_id: 'run-session-1' })], 'actor-owner'),
      'FORCE_RERUN_FORBIDDEN',
    );
  });

  it('rejects force-rerun when the package has no last run session', () => {
    const reviewPackage = packageBase({ phase: 'review', activity_state: 'awaiting_human' });

    expectDomainError(
      () => validateForceRerunAllowed(reviewPackage, [openReviewPacket()], 'actor-owner'),
      'FORCE_RERUN_FORBIDDEN',
    );
  });

  it('allows force-rerun with a current open review packet after historical changes requested', () => {
    const reviewPackage = packageBase({
      phase: 'review',
      activity_state: 'awaiting_human',
      last_run_session_id: 'run-session-2',
    });

    expect(
      () =>
        validateForceRerunAllowed(
          reviewPackage,
          [
            openReviewPacket({ id: 'open-review-packet', run_session_id: 'run-session-2' }),
            approvedReviewPacket({
              id: 'completed-review-packet',
              run_session_id: 'run-session-1',
              decision: 'changes_requested',
            }),
          ],
          'actor-owner',
        ),
    ).not.toThrow();
  });

  it('rejects force-rerun for a completed package even with an invalid open review tuple', () => {
    const completedPackage = packageBase({
      phase: 'release',
      activity_state: 'idle',
      gate_state: 'release_ready',
      resolution: 'completed',
      last_run_session_id: 'run-session-1',
    });

    expectDomainError(
      () =>
        validateForceRerunAllowed(
          completedPackage,
          [openReviewPacket({ status: 'ready', decision: 'approved' })],
          'actor-owner',
        ),
      'FORCE_RERUN_FORBIDDEN',
    );
  });
});

describe('domain completion derivation', () => {
  it('marks a work item done when every package has a successful approved run with required artifacts', () => {
    const completion = deriveWorkItemCompletion(workItem, [packageBase()], [successfulRun()], [approvedReviewPacket()]);

    expect(completion).toEqual({
      done: true,
      resolution: 'completed',
      incomplete_reasons: [],
    });
  });

  it('keeps a work item open when a package lacks a successful run', () => {
    const completion = deriveWorkItemCompletion(
      workItem,
      [packageBase()],
      [successfulRun({ status: 'failed' })],
      [approvedReviewPacket()],
    );

    expect(completion.done).toBe(false);
    expect(completion.incomplete_reasons).toContain('package package-1 has no successful run');
  });

  it('keeps a work item open when review is not completed and approved', () => {
    const completion = deriveWorkItemCompletion(
      workItem,
      [packageBase()],
      [successfulRun()],
      [openReviewPacket({ status: 'in_review' })],
    );

    expect(completion.done).toBe(false);
    expect(completion.incomplete_reasons).toContain('package package-1 has no approved review decision');
  });

  it('keeps a work item open when required artifacts are missing', () => {
    const completion = deriveWorkItemCompletion(
      workItem,
      [packageBase()],
      [successfulRun({ artifacts: [executionSummaryArtifact] })],
      [approvedReviewPacket()],
    );

    expect(completion.done).toBe(false);
    expect(completion.incomplete_reasons).toContain('package package-1 is missing artifact diff');
  });

  it('satisfies required logs with run log refs instead of artifacts', () => {
    const completion = deriveWorkItemCompletion(
      workItem,
      [packageBase({ required_artifact_kinds: ['execution_summary', 'diff', 'logs'] })],
      [successfulRun()],
      [approvedReviewPacket()],
    );

    expect(completion).toEqual({
      done: true,
      resolution: 'completed',
      incomplete_reasons: [],
    });
  });

  it('satisfies required review_packet with the approved Review Packet object for the run', () => {
    const executionPackage = packageBase({ required_artifact_kinds: ['execution_summary', 'diff', 'review_packet'] });
    const runSession = successfulRun();
    const reviewPacket = approvedReviewPacket();

    expect(
      deriveRequiredArtifactPresence(executionPackage, runSession, { reviewPackets: [reviewPacket] }),
    ).toMatchObject({
      present_artifact_kinds: ['execution_summary', 'diff', 'review_packet'],
      missing_artifact_kinds: [],
    });

    expect(deriveWorkItemCompletion(workItem, [executionPackage], [runSession], [reviewPacket])).toEqual({
      done: true,
      resolution: 'completed',
      incomplete_reasons: [],
    });
  });

  it('does not satisfy required review_packet with an unapproved or mismatched Review Packet', () => {
    const executionPackage = packageBase({ required_artifact_kinds: ['execution_summary', 'diff', 'review_packet'] });
    const runSession = successfulRun();

    expect(
      deriveRequiredArtifactPresence(executionPackage, runSession, {
        reviewPackets: [approvedReviewPacket({ run_session_id: 'older-run-session' })],
      }).missing_artifact_kinds,
    ).toContain('review_packet');

    expect(
      deriveWorkItemCompletion(workItem, [executionPackage], [runSession], [
        approvedReviewPacket({ decision: 'changes_requested' }),
      ]).incomplete_reasons,
    ).toContain('package package-1 has no approved review decision');
  });

  it('does not satisfy required review_packet from a run artifact without an approved Review Packet object', () => {
    const executionPackage = packageBase({ required_artifact_kinds: ['review_packet'] });
    const runSession = successfulRun({
      artifacts: [
        {
          kind: 'review_packet',
          name: 'review packet artifact',
          content_type: 'text/markdown',
          local_ref: 'artifacts/run-session/review-packet.md',
        },
      ],
    });

    expect(deriveRequiredArtifactPresence(executionPackage, runSession).missing_artifact_kinds).toEqual([
      'review_packet',
    ]);
    expect(
      deriveRequiredArtifactPresence(executionPackage, runSession, {
        reviewPackets: [approvedReviewPacket({ decision: 'changes_requested' })],
      }).missing_artifact_kinds,
    ).toEqual(['review_packet']);
  });

  it('does not satisfy required logs from run artifacts', () => {
    const completion = deriveWorkItemCompletion(
      workItem,
      [packageBase({ required_artifact_kinds: ['logs'] })],
      [successfulRun({ artifacts: [logsArtifact], log_refs: [] })],
      [approvedReviewPacket()],
    );

    expect(completion.done).toBe(false);
    expect(completion.incomplete_reasons).toContain('package package-1 is missing artifact logs');
  });

  it('does not satisfy non-log required artifacts from run log refs', () => {
    const completion = deriveWorkItemCompletion(
      workItem,
      [packageBase({ required_artifact_kinds: ['diff'] })],
      [successfulRun({ artifacts: [], log_refs: [diffArtifact] })],
      [approvedReviewPacket()],
    );

    expect(completion.done).toBe(false);
    expect(completion.incomplete_reasons).toContain('package package-1 is missing artifact diff');
  });

  it('uses a later approved successful run with artifacts when no current run is recorded', () => {
    const completion = deriveWorkItemCompletion(
      workItem,
      [packageBase()],
      [
        successfulRun({ id: 'run-session-1', artifacts: [executionSummaryArtifact] }),
        successfulRun({ id: 'run-session-2', artifacts: [executionSummaryArtifact, diffArtifact] }),
      ],
      [
        approvedReviewPacket({ id: 'review-packet-1', run_session_id: 'run-session-1' }),
        approvedReviewPacket({ id: 'review-packet-2', run_session_id: 'run-session-2' }),
      ],
    );

    expect(completion).toEqual({
      done: true,
      resolution: 'completed',
      incomplete_reasons: [],
    });
  });

  it('blocks completion when the current run is missing a required artifact even if an older run has it', () => {
    const completion = deriveWorkItemCompletion(
      workItem,
      [packageBase({ last_run_session_id: 'run-session-2' })],
      [
        successfulRun({ id: 'run-session-1', artifacts: [executionSummaryArtifact, diffArtifact] }),
        successfulRun({ id: 'run-session-2', artifacts: [executionSummaryArtifact] }),
      ],
      [
        approvedReviewPacket({ id: 'review-packet-1', run_session_id: 'run-session-1' }),
        approvedReviewPacket({ id: 'review-packet-2', run_session_id: 'run-session-2' }),
      ],
    );

    expect(completion.done).toBe(false);
    expect(completion.incomplete_reasons).toContain('package package-1 is missing artifact diff');
  });

  it('completes with current run artifacts even if an older approved run lacks artifacts', () => {
    const completion = deriveWorkItemCompletion(
      workItem,
      [packageBase({ last_run_session_id: 'run-session-2' })],
      [
        successfulRun({ id: 'run-session-1', artifacts: [executionSummaryArtifact] }),
        successfulRun({ id: 'run-session-2', artifacts: [executionSummaryArtifact, diffArtifact] }),
      ],
      [
        approvedReviewPacket({ id: 'review-packet-1', run_session_id: 'run-session-1' }),
        approvedReviewPacket({ id: 'review-packet-2', run_session_id: 'run-session-2' }),
      ],
    );

    expect(completion).toEqual({
      done: true,
      resolution: 'completed',
      incomplete_reasons: [],
    });
  });
});
