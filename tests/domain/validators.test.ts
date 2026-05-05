import { describe, expect, it } from 'vitest';

import {
  DomainError,
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

const timestamp = '2026-05-05T00:00:00.000Z';

const requiredCheck = {
  check_id: 'domain-tests',
  display_name: 'Domain tests',
  command: 'pnpm test tests/domain',
  timeout_seconds: 120,
  blocks_review: true,
};

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
  project_id: 'project-1',
  repo_id: 'repo-1',
  objective: 'Implement the domain package.',
  owner_actor_id: 'actor-owner',
  reviewer_actor_id: 'actor-reviewer',
  phase: 'ready',
  activity_state: 'idle',
  gate_state: 'not_submitted',
  resolution: 'none',
  required_checks: [requiredCheck],
  required_artifact_kinds: ['execution_summary', 'diff'],
  allowed_paths: ['packages/domain/**', 'tests/domain/**'],
  forbidden_paths: ['apps/**'],
  created_at: timestamp,
  updated_at: timestamp,
  ...overrides,
});

const workItem: WorkItem = {
  id: 'work-item-1',
  project_id: 'project-1',
  title: 'Domain rules',
  owner_actor_id: 'actor-owner',
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
  status: 'completed',
  decision: 'approved',
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
  status: 'ready',
  decision: 'none',
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
      () => validateExecutionPackage(project, packageBase({ objective: '   ' })),
      'EXECUTION_OBJECTIVE_REQUIRED',
    );
  });

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

  it('allows force-rerun only for the execution owner while a review packet is open', () => {
    const reviewPackage = packageBase({ phase: 'review', activity_state: 'awaiting_human' });
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
});
