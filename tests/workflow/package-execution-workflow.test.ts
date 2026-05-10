import { describe, expect, it } from 'vitest';
import type { ArtifactRef, CheckResult, ExecutorResult, RunSpec, SelfReviewInput, SelfReviewResult } from '@forgeloop/contracts';
import type {
  ExecutionPackage,
  Plan,
  PlanRevision,
  Project,
  ProjectRepo,
  ReviewPacket,
  RunSession,
  Spec,
  SpecRevision,
  WorkItem,
} from '@forgeloop/domain';

import { InMemoryP0Repository } from '../../packages/db/src/index';
import { transitionExecutionPackage, transitionReviewPacket, transitionRunSession } from '../../packages/domain/src/index';
import { createPackageExecutionActivities, executePackageRun } from '../../packages/workflow/src/index';

const now = '2026-05-05T00:00:00.000Z';
const later = '2026-05-05T00:01:00.000Z';

const requiredChecks = [
  {
    check_id: 'unit-tests',
    display_name: 'Unit tests',
    command: 'pnpm test tests/workflow',
    timeout_seconds: 120,
    blocks_review: true,
  },
  {
    check_id: 'lint',
    display_name: 'Lint',
    command: 'pnpm lint',
    timeout_seconds: 60,
    blocks_review: false,
  },
] as const;

const summaryArtifact: ArtifactRef = {
  kind: 'execution_summary',
  name: 'summary',
  content_type: 'text/markdown',
  local_ref: 'artifacts/run-session/summary.md',
};

const diffArtifact: ArtifactRef = {
  kind: 'diff',
  name: 'diff',
  content_type: 'text/x-diff',
  local_ref: 'artifacts/run-session/diff.patch',
};

const successfulChecks = (): CheckResult[] =>
  requiredChecks.map((check) => ({
    check_id: check.check_id,
    command: check.command,
    status: 'succeeded',
    exit_code: 0,
    duration_seconds: 2,
    blocks_review: check.blocks_review,
  }));

const successfulSelfReview = (overrides: Partial<SelfReviewResult> = {}): SelfReviewResult => ({
  status: 'succeeded',
  summary: 'The implementation follows the approved package plan.',
  spec_plan_alignment: 'The changed files match the package scope.',
  test_assessment: 'Required checks passed.',
  risk_notes: [],
  follow_up_questions: [],
  ...overrides,
});

const executorResult = (runSpec: RunSpec, overrides: Partial<ExecutorResult> = {}): ExecutorResult => ({
  run_session_id: runSpec.run_session_id,
  executor_type: runSpec.executor_type,
  executor_version: 'test-executor',
  status: 'succeeded',
  started_at: now,
  finished_at: later,
  summary: 'Executor completed the package.',
  changed_files: [{ repo_id: runSpec.repo.repo_id, path: 'packages/workflow/src/index.ts', change_kind: 'modified' }],
  checks: successfulChecks(),
  artifacts: [summaryArtifact, diffArtifact],
  raw_metadata: {},
  ...overrides,
});

const runSpecFor = (executionPackage: ExecutionPackage, runSessionId: string): RunSpec => ({
  run_session_id: runSessionId,
  execution_package_id: executionPackage.id,
  work_item_id: executionPackage.work_item_id,
  spec_revision_id: executionPackage.spec_revision_id,
  plan_revision_id: executionPackage.plan_revision_id,
  executor_type: 'mock',
  repo: {
    repo_id: executionPackage.repo_id,
    local_path: '/workspace/forgeloop',
    base_branch: 'main',
    base_commit_sha: 'abc123',
  },
  objective: executionPackage.objective,
  context: {
    spec_revision_summary: 'Approved package execution spec',
    plan_revision_summary: 'Approved package execution plan',
    package_instructions: executionPackage.objective,
    required_checks: [...requiredChecks],
  },
  review_context: { latest_decision: 'none', requested_changes: [] },
  workflow_only: true,
  allowed_paths: executionPackage.allowed_paths,
  forbidden_paths: executionPackage.forbidden_paths,
  required_checks: [...requiredChecks],
  artifact_policy: { requested_artifacts: ['execution_summary', 'diff', 'changed_files', 'check_output'] },
  timeout_seconds: 3600,
  idempotency_key: runSessionId,
});

interface FixtureOptions {
  packageState?: 'ready' | 'review_changes_requested' | 'review_force_rerun';
  runSessionId?: string;
  previousReviewPacket?: ReviewPacket;
}

const createFixture = async (options: FixtureOptions = {}) => {
  const repository = new InMemoryP0Repository();

  const project: Project = {
    id: 'project-1',
    name: 'Forgeloop',
    repo_ids: ['repo-1'],
    owner_actor_id: 'actor-owner',
    created_at: now,
    updated_at: now,
  };
  const projectRepo: ProjectRepo = {
    id: 'project-repo-1',
    repo_id: 'repo-1',
    project_id: project.id,
    name: 'forgeloop',
    status: 'active',
    local_path: '/workspace/forgeloop',
    default_branch: 'main',
    base_commit_sha: 'abc123',
    created_at: now,
    updated_at: now,
  };
  const workItem: WorkItem = {
    id: 'work-item-1',
    project_id: project.id,
    kind: 'requirement',
    title: 'Ship package workflow',
    goal: 'Execute generated packages.',
    success_criteria: ['A review packet is produced for successful runs.'],
    priority: 'P0',
    risk: 'medium',
    owner_actor_id: 'actor-owner',
    phase: 'execution',
    activity_state: 'idle',
    gate_state: 'not_submitted',
    resolution: 'none',
    current_spec_id: 'spec-1',
    current_plan_id: 'plan-1',
    created_at: now,
    updated_at: now,
  };
  const spec: Spec = {
    id: 'spec-1',
    work_item_id: workItem.id,
    entity_type: 'spec',
    status: 'approved',
    editing_state: 'idle',
    gate_state: 'approved',
    resolution: 'approved',
    current_revision_id: 'spec-revision-1',
    created_at: now,
    updated_at: now,
  };
  const specRevision: SpecRevision = {
    id: 'spec-revision-1',
    spec_id: spec.id,
    work_item_id: workItem.id,
    revision_number: 1,
    summary: 'Approved package execution spec',
    content: 'Spec body',
    background: 'Background',
    goals: ['Execute packages'],
    scope_in: ['Workflow package'],
    scope_out: ['Executor implementation'],
    acceptance_criteria: ['Successful runs produce review packets'],
    risk_notes: [],
    test_strategy_summary: 'Workflow tests',
    artifact_refs: [],
    created_at: now,
  };
  const plan: Plan = {
    id: 'plan-1',
    work_item_id: workItem.id,
    entity_type: 'plan',
    status: 'approved',
    editing_state: 'idle',
    gate_state: 'approved',
    resolution: 'approved',
    current_revision_id: 'plan-revision-1',
    created_at: now,
    updated_at: now,
  };
  const planRevision: PlanRevision = {
    id: 'plan-revision-1',
    plan_id: plan.id,
    work_item_id: workItem.id,
    revision_number: 1,
    summary: 'Approved package execution plan',
    content: 'Plan body',
    implementation_summary: 'Add workflow orchestration.',
    split_strategy: 'One workflow package task.',
    dependency_order: ['execution-package-1'],
    test_matrix: ['pnpm test tests/workflow'],
    risk_mitigations: [],
    rollback_notes: 'Revert workflow package changes.',
    artifact_refs: [],
    created_at: now,
  };

  const generatedPackage = transitionExecutionPackage(undefined, {
    type: 'generate_package',
    id: 'execution-package-1',
    work_item_id: workItem.id,
    spec_id: spec.id,
    spec_revision_id: specRevision.id,
    plan_id: plan.id,
    plan_revision_id: planRevision.id,
    project_id: project.id,
    repo_id: projectRepo.repo_id,
    objective: 'Implement the package execution workflow.',
    owner_actor_id: 'actor-owner',
    reviewer_actor_id: 'actor-reviewer',
    qa_owner_actor_id: 'actor-qa',
    required_checks: [...requiredChecks],
    required_artifact_kinds: ['execution_summary'],
    allowed_paths: ['packages/workflow/**', 'tests/workflow/**'],
    forbidden_paths: ['packages/db/**'],
    at: now,
  });

  let executionPackage: ExecutionPackage = transitionExecutionPackage(generatedPackage, { type: 'mark_ready', at: now });

  if (options.packageState === 'review_changes_requested' || options.packageState === 'review_force_rerun') {
    executionPackage = {
      ...executionPackage,
      phase: 'review',
      activity_state: 'awaiting_human',
      gate_state: 'awaiting_human_review',
      resolution: 'none',
      last_run_session_id: 'run-session-previous',
    };
  }

  if (options.previousReviewPacket !== undefined) {
    await repository.saveReviewPacket(options.previousReviewPacket);
  }

  const runSessionId = options.runSessionId ?? 'run-session-1';
  const queuedPackage =
    options.packageState === 'review_force_rerun'
      ? transitionExecutionPackage(executionPackage, {
          type: 'force_rerun',
          run_session_id: runSessionId,
          has_open_review_packet: true,
          at: now,
        })
      : transitionExecutionPackage(
          options.packageState === 'review_changes_requested'
            ? transitionExecutionPackage(executionPackage, { type: 'review_changes_requested', at: now })
            : executionPackage,
          { type: options.packageState === 'review_changes_requested' ? 'rerun' : 'run', run_session_id: runSessionId, at: now },
        );

  const runSession: RunSession = transitionRunSession(undefined, {
    type: 'create',
    id: runSessionId,
    execution_package_id: queuedPackage.id,
    requested_by_actor_id: 'actor-owner',
    executor_type: 'mock',
    at: now,
  });

  await repository.saveProject(project);
  await repository.saveProjectRepo(projectRepo);
  await repository.saveWorkItem(workItem);
  await repository.saveSpec(spec);
  await repository.saveSpecRevision(specRevision);
  await repository.savePlan(plan);
  await repository.savePlanRevision(planRevision);
  await repository.saveExecutionPackage(queuedPackage);
  await repository.saveRunSession(runSession);

  return { repository, runSessionId, executionPackage: queuedPackage };
};

const runWorkflow = async (
  repository: InMemoryP0Repository,
  runSessionId: string,
  options: {
    executor?: (runSpec: RunSpec) => Promise<ExecutorResult>;
    selfReview?: (input: SelfReviewInput) => Promise<SelfReviewResult>;
    forceRerun?: boolean;
  } = {},
) =>
  executePackageRun({
    repository,
    runSessionId,
    executor: options.executor ?? ((runSpec) => Promise.resolve(executorResult(runSpec))),
    selfReview: options.selfReview ?? (() => Promise.resolve(successfulSelfReview())),
    now: () => now,
    workflowOnly: true,
    forceRerun: options.forceRerun,
  });

describe('executePackageRun', () => {
  it('creates a ReviewPacket for a successful package run', async () => {
    const { repository, runSessionId, executionPackage } = await createFixture();

    await runWorkflow(repository, runSessionId);

    const runSession = await repository.getRunSession(runSessionId);
    const updatedPackage = await repository.getExecutionPackage(executionPackage.id);
    const reviewPackets = await repository.listReviewPacketsForPackage(executionPackage.id);
    const artifacts = await repository.listArtifactsForObject('run_session', runSessionId);
    const packageHistory = await repository.listStatusHistory(executionPackage.id, 'execution_package');

    expect(runSession).toMatchObject({
      status: 'succeeded',
      summary: 'Executor completed the package.',
      run_spec: {
        run_session_id: runSessionId,
        execution_package_id: executionPackage.id,
        workflow_only: true,
        idempotency_key: runSessionId,
      },
    });
    expect(updatedPackage).toMatchObject({
      phase: 'review',
      activity_state: 'awaiting_human',
      gate_state: 'awaiting_human_review',
    });
    expect(reviewPackets).toHaveLength(1);
    expect(reviewPackets[0]).toMatchObject({
      id: `review-packet:${runSessionId}`,
      run_session_id: runSessionId,
      status: 'ready',
      decision: 'none',
      check_result_summary: '2 checks passed.',
      self_review: { status: 'succeeded' },
    });
    expect(artifacts.map((artifact) => artifact.ref.kind)).toEqual(['execution_summary', 'diff']);
    expect(packageHistory.map((entry) => entry.to_status)).toContain('review/awaiting_human/awaiting_human_review');
  });

  it('creates a ReviewPacket with risk notes for non-blocking check failures', async () => {
    const { repository, runSessionId, executionPackage } = await createFixture();

    await runWorkflow(repository, runSessionId, {
      executor: (runSpec) =>
        Promise.resolve(
          executorResult(runSpec, {
            checks: [
              successfulChecks()[0]!,
              { ...successfulChecks()[1]!, status: 'failed', exit_code: 1 },
            ],
          }),
        ),
    });

    const runSession = await repository.getRunSession(runSessionId);
    const [reviewPacket] = await repository.listReviewPacketsForPackage(executionPackage.id);

    expect(runSession).toMatchObject({ status: 'succeeded' });
    expect(reviewPacket?.risk_notes).toContain('Non-blocking check failed: Lint.');
    expect(reviewPacket?.check_result_summary).toBe('1 check passed; 1 non-blocking check failed.');
  });

  it('does not create a ReviewPacket when a blocking check fails', async () => {
    const { repository, runSessionId, executionPackage } = await createFixture();
    let selfReviewCalls = 0;

    await runWorkflow(repository, runSessionId, {
      executor: (runSpec) =>
        Promise.resolve(
          executorResult(runSpec, {
            status: 'failed',
            checks: [{ ...successfulChecks()[0]!, status: 'failed', exit_code: 1 }, successfulChecks()[1]!],
            failure: { kind: 'required_check_failed', message: 'Unit tests failed.', retryable: true },
          }),
        ),
      selfReview: async () => {
        selfReviewCalls += 1;
        return successfulSelfReview();
      },
    });

    const runSession = await repository.getRunSession(runSessionId);
    const updatedPackage = await repository.getExecutionPackage(executionPackage.id);
    const reviewPackets = await repository.listReviewPacketsForPackage(executionPackage.id);

    expect(runSession).toMatchObject({
      status: 'failed',
      failure_kind: 'required_check_failed',
      failure_reason: 'Unit tests failed.',
    });
    expect(updatedPackage).toMatchObject({
      phase: 'ready',
      activity_state: 'idle',
      last_failure_summary: 'Unit tests failed.',
    });
    expect(reviewPackets).toEqual([]);
    expect(selfReviewCalls).toBe(0);
  });

  it('still creates a ReviewPacket when self-review fails', async () => {
    const { repository, runSessionId, executionPackage } = await createFixture();

    await runWorkflow(repository, runSessionId, {
      selfReview: async () => {
        throw new Error('model unavailable');
      },
    });

    const [reviewPacket] = await repository.listReviewPacketsForPackage(executionPackage.id);
    const events = await repository.listObjectEvents(runSessionId, 'run_session');

    expect(reviewPacket).toMatchObject({
      self_review: {
        status: 'failed',
        failure_message: 'model unavailable',
      },
    });
    expect(reviewPacket?.risk_notes).toContain('AI self-review failed: model unavailable.');
    expect(events.map((event) => event.event_type)).toContain('self_review_failed');
  });

  it('passes latest requested-change context into reruns', async () => {
    const requestedChanges = [
      {
        title: 'Add idempotency coverage',
        description: 'Verify repeated workflow starts do not create duplicates.',
        file_path: 'tests/workflow/package-execution-workflow.test.ts',
        severity: 'major' as const,
        suggested_validation: 'Run pnpm test tests/workflow',
      },
    ];
    const previousReviewPacket = transitionReviewPacket(
      transitionReviewPacket(undefined, {
        type: 'create',
        id: 'review-packet:run-session-previous',
        run_session_id: 'run-session-previous',
        execution_package_id: 'execution-package-1',
        reviewer_actor_id: 'actor-reviewer',
        spec_revision_id: 'spec-revision-1',
        plan_revision_id: 'plan-revision-1',
        changed_files: [],
        check_result_summary: 'Previous run needs changes.',
        self_review: successfulSelfReview(),
        risk_notes: [],
        at: now,
      }),
      {
        type: 'request_changes',
        summary: 'Please address review feedback.',
        reviewed_by_actor_id: 'actor-reviewer',
        reviewed_at: now,
        requested_changes: requestedChanges,
        at: now,
      },
    );
    const { repository, runSessionId } = await createFixture({
      packageState: 'review_changes_requested',
      previousReviewPacket,
      runSessionId: 'run-session-rerun',
    });
    let capturedRunSpec: RunSpec | undefined;
    let capturedSelfReviewInput: SelfReviewInput | undefined;

    await runWorkflow(repository, runSessionId, {
      executor: async (runSpec) => {
        capturedRunSpec = runSpec;
        return executorResult(runSpec);
      },
      selfReview: async (input) => {
        capturedSelfReviewInput = input;
        return successfulSelfReview();
      },
    });

    expect(capturedRunSpec?.review_context).toEqual({
      latest_decision: 'changes_requested',
      requested_changes: requestedChanges,
    });
    expect(capturedSelfReviewInput?.requested_changes_context).toEqual(requestedChanges);
  });

  it('archives open ReviewPackets on force rerun', async () => {
    const openReviewPacket = transitionReviewPacket(undefined, {
      type: 'create',
      id: 'review-packet:run-session-previous',
      run_session_id: 'run-session-previous',
      execution_package_id: 'execution-package-1',
      reviewer_actor_id: 'actor-reviewer',
      spec_revision_id: 'spec-revision-1',
      plan_revision_id: 'plan-revision-1',
      changed_files: [],
      check_result_summary: 'Previous run is awaiting review.',
      self_review: successfulSelfReview(),
      risk_notes: [],
      at: now,
    });
    const { repository, runSessionId, executionPackage } = await createFixture({
      packageState: 'review_force_rerun',
      previousReviewPacket: openReviewPacket,
      runSessionId: 'run-session-force-rerun',
    });

    await runWorkflow(repository, runSessionId, { forceRerun: true });

    const reviewPackets = await repository.listReviewPacketsForPackage(executionPackage.id);

    expect(reviewPackets).toHaveLength(2);
    expect(reviewPackets.find((packet) => packet.id === openReviewPacket.id)).toMatchObject({
      status: 'archived',
      decision: 'none',
    });
    expect(reviewPackets.find((packet) => packet.id === `review-packet:${runSessionId}`)).toMatchObject({
      status: 'ready',
      decision: 'none',
    });
  });

  it('is idempotent for duplicate starts with the same run session id', async () => {
    const { repository, runSessionId, executionPackage } = await createFixture();
    let executorCalls = 0;

    await runWorkflow(repository, runSessionId, {
      executor: async (runSpec) => {
        executorCalls += 1;
        return executorResult(runSpec);
      },
    });
    await runWorkflow(repository, runSessionId, {
      executor: async (runSpec) => {
        executorCalls += 1;
        return executorResult(runSpec);
      },
    });

    const reviewPackets = await repository.listReviewPacketsForPackage(executionPackage.id);
    const artifacts = await repository.listArtifactsForObject('run_session', runSessionId);
    const events = await repository.listObjectEvents(runSessionId, 'run_session');
    const histories = await repository.listStatusHistory(runSessionId, 'run_session');

    expect(executorCalls).toBe(1);
    expect(reviewPackets).toHaveLength(1);
    expect(artifacts).toHaveLength(2);
    expect(events.map((event) => event.event_type)).toEqual(['workflow_started', 'executor_succeeded', 'review_packet_created']);
    expect(histories.map((history) => history.to_status)).toEqual(['running', 'succeeded']);
  });

  it('reconciles a terminal successful retry when final side effects are missing', async () => {
    const { repository, runSessionId, executionPackage } = await createFixture();
    const runSpec = runSpecFor(executionPackage, runSessionId);
    const persistedResult = executorResult(runSpec);
    let executorCalls = 0;

    await repository.saveExecutionPackage({
      ...executionPackage,
      phase: 'execution',
      activity_state: 'ai_running',
      gate_state: 'not_submitted',
    });
    await repository.saveRunSession({
      ...(await repository.getRunSession(runSessionId))!,
      status: 'succeeded',
      executor_type: 'mock',
      run_spec: runSpec,
      executor_result: persistedResult,
      changed_files: persistedResult.changed_files,
      check_results: persistedResult.checks,
      artifacts: persistedResult.artifacts,
      log_refs: [],
      summary: persistedResult.summary,
      started_at: now,
      finished_at: later,
      updated_at: later,
    });

    await runWorkflow(repository, runSessionId, {
      executor: async (input) => {
        executorCalls += 1;
        return executorResult(input);
      },
    });

    const reviewPackets = await repository.listReviewPacketsForPackage(executionPackage.id);
    const updatedPackage = await repository.getExecutionPackage(executionPackage.id);

    expect(executorCalls).toBe(0);
    expect(reviewPackets).toHaveLength(1);
    expect(reviewPackets[0]).toMatchObject({ id: `review-packet:${runSessionId}`, status: 'ready' });
    expect(updatedPackage).toMatchObject({
      phase: 'review',
      activity_state: 'awaiting_human',
      gate_state: 'awaiting_human_review',
    });
  });

  it('reconciles a terminal blocking-check retry without creating a ReviewPacket', async () => {
    const { repository, runSessionId, executionPackage } = await createFixture();
    const runSpec = runSpecFor(executionPackage, runSessionId);
    const persistedResult = executorResult(runSpec, {
      status: 'failed',
      checks: [{ ...successfulChecks()[0]!, status: 'failed', exit_code: 1 }, successfulChecks()[1]!],
      failure: { kind: 'required_check_failed', message: 'Unit tests failed.', retryable: true },
    });
    let executorCalls = 0;

    await repository.saveExecutionPackage({
      ...executionPackage,
      phase: 'execution',
      activity_state: 'ai_running',
      gate_state: 'not_submitted',
    });
    await repository.saveRunSession({
      ...(await repository.getRunSession(runSessionId))!,
      status: 'failed',
      executor_type: 'mock',
      run_spec: runSpec,
      executor_result: persistedResult,
      changed_files: persistedResult.changed_files,
      check_results: persistedResult.checks,
      artifacts: persistedResult.artifacts,
      log_refs: [],
      summary: persistedResult.summary,
      failure_kind: 'required_check_failed',
      failure_reason: 'Unit tests failed.',
      started_at: now,
      finished_at: later,
      updated_at: later,
    });

    await runWorkflow(repository, runSessionId, {
      executor: async (input) => {
        executorCalls += 1;
        return executorResult(input);
      },
    });

    expect(executorCalls).toBe(0);
    expect(await repository.listReviewPacketsForPackage(executionPackage.id)).toEqual([]);
    expect(await repository.getExecutionPackage(executionPackage.id)).toMatchObject({
      phase: 'ready',
      activity_state: 'idle',
      gate_state: 'not_submitted',
      last_failure_summary: 'Unit tests failed.',
    });
  });

  it('rejects stale package revision ids before calling the executor', async () => {
    const { repository, runSessionId, executionPackage } = await createFixture();
    let executorCalls = 0;

    await repository.saveSpecRevision({
      id: 'spec-revision-stale',
      spec_id: 'spec-1',
      work_item_id: 'work-item-1',
      revision_number: 0,
      summary: 'Stale spec revision',
      content: 'Old spec body',
      background: 'Old background',
      goals: ['Old goal'],
      scope_in: ['Old scope'],
      scope_out: [],
      acceptance_criteria: ['Old criteria'],
      risk_notes: [],
      test_strategy_summary: 'Old tests',
      artifact_refs: [],
      created_at: now,
    });
    await repository.saveExecutionPackage({ ...executionPackage, spec_revision_id: 'spec-revision-stale' });

    await expect(
      runWorkflow(repository, runSessionId, {
        executor: async (input) => {
          executorCalls += 1;
          return executorResult(input);
        },
      }),
    ).rejects.toThrow('ExecutionPackage execution-package-1 spec_revision_id spec-revision-stale is not current approved revision spec-revision-1');
    expect(executorCalls).toBe(0);
  });

  it('archives all older open ReviewPackets and preserves completed packets', async () => {
    const openReady = transitionReviewPacket(undefined, {
      type: 'create',
      id: 'review-packet:open-ready',
      run_session_id: 'run-session-open-ready',
      execution_package_id: 'execution-package-1',
      reviewer_actor_id: 'actor-reviewer',
      spec_revision_id: 'spec-revision-1',
      plan_revision_id: 'plan-revision-1',
      changed_files: [],
      check_result_summary: 'Open ready review.',
      self_review: successfulSelfReview(),
      risk_notes: [],
      at: now,
    });
    const openInReview = transitionReviewPacket(
      transitionReviewPacket(undefined, {
        type: 'create',
        id: 'review-packet:open-in-review',
        run_session_id: 'run-session-open-in-review',
        execution_package_id: 'execution-package-1',
        reviewer_actor_id: 'actor-reviewer',
        spec_revision_id: 'spec-revision-1',
        plan_revision_id: 'plan-revision-1',
        changed_files: [],
        check_result_summary: 'Open in-review review.',
        self_review: successfulSelfReview(),
        risk_notes: [],
        at: now,
      }),
      { type: 'start_review', at: now },
    );
    const completed = transitionReviewPacket(
      transitionReviewPacket(undefined, {
        type: 'create',
        id: 'review-packet:completed',
        run_session_id: 'run-session-completed',
        execution_package_id: 'execution-package-1',
        reviewer_actor_id: 'actor-reviewer',
        spec_revision_id: 'spec-revision-1',
        plan_revision_id: 'plan-revision-1',
        changed_files: [],
        check_result_summary: 'Completed review.',
        self_review: successfulSelfReview(),
        risk_notes: [],
        at: now,
      }),
      {
        type: 'approve',
        summary: 'Approved.',
        reviewed_by_actor_id: 'actor-reviewer',
        reviewed_at: now,
        at: now,
      },
    );
    const { repository, runSessionId, executionPackage } = await createFixture({
      packageState: 'review_force_rerun',
      previousReviewPacket: openReady,
      runSessionId: 'run-session-archives-all',
    });
    await repository.saveReviewPacket(openInReview);
    await repository.saveReviewPacket(completed);

    await runWorkflow(repository, runSessionId);

    const reviewPackets = await repository.listReviewPacketsForPackage(executionPackage.id);

    expect(reviewPackets.find((packet) => packet.id === openReady.id)).toMatchObject({ status: 'archived', decision: 'none' });
    expect(reviewPackets.find((packet) => packet.id === openInReview.id)).toMatchObject({
      status: 'archived',
      decision: 'none',
    });
    expect(reviewPackets.find((packet) => packet.id === completed.id)).toMatchObject({
      status: 'completed',
      decision: 'approved',
    });
  });

  it('does not let an old terminal retry overwrite newer package state', async () => {
    const { repository, runSessionId, executionPackage } = await createFixture();
    const runSpec = runSpecFor(executionPackage, runSessionId);
    const persistedResult = executorResult(runSpec);

    await repository.saveExecutionPackage({
      ...executionPackage,
      phase: 'queued',
      activity_state: 'idle',
      gate_state: 'not_submitted',
      last_run_session_id: 'run-session-newer',
    });
    await repository.saveRunSession({
      ...(await repository.getRunSession(runSessionId))!,
      status: 'succeeded',
      executor_type: 'mock',
      run_spec: runSpec,
      executor_result: persistedResult,
      changed_files: persistedResult.changed_files,
      check_results: persistedResult.checks,
      artifacts: persistedResult.artifacts,
      log_refs: [],
      summary: persistedResult.summary,
      started_at: now,
      finished_at: later,
      updated_at: later,
    });

    await runWorkflow(repository, runSessionId);

    expect(await repository.getExecutionPackage(executionPackage.id)).toMatchObject({
      phase: 'queued',
      activity_state: 'idle',
      gate_state: 'not_submitted',
      last_run_session_id: 'run-session-newer',
    });
    expect(await repository.getReviewPacket(`review-packet:${runSessionId}`)).toMatchObject({
      status: 'ready',
      run_session_id: runSessionId,
    });
  });

  it('fails the run and releases package execution when the executor throws after workflow start', async () => {
    const { repository, runSessionId, executionPackage } = await createFixture();

    const result = await runWorkflow(repository, runSessionId, {
      executor: async () => {
        throw new Error('executor process crashed');
      },
    });

    expect(result).toEqual({ runSessionId, status: 'failed' });
    expect(await repository.getRunSession(runSessionId)).toMatchObject({
      status: 'failed',
      failure_kind: 'executor_error',
      failure_reason: 'executor process crashed',
    });
    expect(await repository.getExecutionPackage(executionPackage.id)).toMatchObject({
      phase: 'ready',
      activity_state: 'idle',
      gate_state: 'not_submitted',
      last_failure_summary: 'executor process crashed',
    });
    expect(await repository.listReviewPacketsForPackage(executionPackage.id)).toEqual([]);
  });

  it('fails succeeded executor results that omit required blocking checks', async () => {
    const { repository, runSessionId, executionPackage } = await createFixture();

    const result = await runWorkflow(repository, runSessionId, {
      executor: (runSpec) =>
        Promise.resolve(
          executorResult(runSpec, {
            checks: [successfulChecks()[1]!],
          }),
        ),
    });

    expect(result).toEqual({ runSessionId, status: 'failed' });
    expect(await repository.getRunSession(runSessionId)).toMatchObject({
      status: 'failed',
      failure_kind: 'required_check_failed',
      failure_reason: 'Required check unit-tests did not report a result.',
    });
    expect(await repository.listReviewPacketsForPackage(executionPackage.id)).toEqual([]);
  });

  it('exposes injectable Temporal activities for worker registration', async () => {
    const { repository, runSessionId, executionPackage } = await createFixture();
    const activities = createPackageExecutionActivities({
      repository,
      executor: (runSpec) => Promise.resolve(executorResult(runSpec)),
      selfReview: () => Promise.resolve(successfulSelfReview()),
      now: () => now,
    });

    const result = await activities.executePackageRunActivity({ runSessionId, workflowOnly: true });

    expect(result).toEqual({
      runSessionId,
      status: 'succeeded',
      reviewPacketId: `review-packet:${runSessionId}`,
    });
    expect(await repository.getReviewPacket(`review-packet:${runSessionId}`)).toMatchObject({
      execution_package_id: executionPackage.id,
      status: 'ready',
    });
  });
});
