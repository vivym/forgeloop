import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { ArtifactRef, CheckResult, ExecutorResult, RunSpec, SelfReviewResult } from '@forgeloop/contracts';
import type {
  ExecutionPackage,
  Plan,
  PlanRevision,
  Project,
  ProjectRepo,
  RunCommand,
  RunSession,
  Spec,
  SpecRevision,
  WorkItem,
} from '../../packages/domain/src/index';
import { transitionExecutionPackage, transitionRunSession } from '../../packages/domain/src/index';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import {
  P0_DEMO_ACTOR_ID_FALLBACK,
  P0_REPOSITORY,
  RUN_DURABILITY_MODE,
  RUN_WORKER,
} from '../../apps/control-plane-api/src/p0/p0.service';
import { InMemoryP0Repository, type P0Repository } from '../../packages/db/src';

const now = '2026-05-05T00:00:00.000Z';
const later = '2026-05-05T00:01:00.000Z';
const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const actorQa = 'actor-qa';

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

export const succeededSelfReview = (): SelfReviewResult => ({
  status: 'succeeded',
  summary: 'The implementation follows the approved package plan.',
  spec_plan_alignment: 'The changed files match the package scope.',
  test_assessment: 'Required checks passed.',
  risk_notes: [],
  follow_up_questions: [],
});

export const succeededExecutorResult = (runSessionId: string): ExecutorResult => ({
  run_session_id: runSessionId,
  executor_type: 'mock',
  executor_version: 'test-executor',
  status: 'succeeded',
  started_at: now,
  finished_at: later,
  summary: 'Executor completed the package.',
  changed_files: [{ repo_id: 'repo-1', path: 'packages/workflow/src/index.ts', change_kind: 'modified' }],
  checks: successfulChecks(),
  artifacts: [summaryArtifact, diffArtifact],
  raw_metadata: {},
});

const baseRecords = (): {
  project: Project;
  projectRepo: ProjectRepo;
  workItem: WorkItem;
  spec: Spec;
  specRevision: SpecRevision;
  plan: Plan;
  planRevision: PlanRevision;
  executionPackage: ExecutionPackage;
} => {
  const project: Project = {
    id: 'project-1',
    name: 'Forgeloop',
    repo_ids: ['repo-1'],
    owner_actor_id: actorOwner,
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
    kind: 'feature',
    title: 'Ship package workflow',
    goal: 'Execute generated packages.',
    success_criteria: ['A review packet is produced for successful runs.'],
    priority: 'P0',
    risk: 'medium',
    owner_actor_id: actorOwner,
    phase: 'execution',
    activity_state: 'idle',
    gate_state: 'none',
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
    owner_actor_id: actorOwner,
    reviewer_actor_id: actorReviewer,
    qa_owner_actor_id: actorQa,
    required_checks: [...requiredChecks],
    required_artifact_kinds: ['execution_summary'],
    allowed_paths: ['packages/workflow/**', 'tests/workflow/**'],
    forbidden_paths: ['packages/db/**'],
    at: now,
  });
  const executionPackage = transitionExecutionPackage(generatedPackage, { type: 'mark_ready', at: now });

  return { project, projectRepo, workItem, spec, specRevision, plan, planRevision, executionPackage };
};

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

const saveBaseRecords = async (
  repository: P0Repository,
  executionPackage: ExecutionPackage,
  records: ReturnType<typeof baseRecords>,
): Promise<void> => {
  await repository.saveProject(records.project);
  await repository.saveProjectRepo(records.projectRepo);
  await repository.saveWorkItem(records.workItem);
  await repository.saveSpec(records.spec);
  await repository.saveSpecRevision(records.specRevision);
  await repository.savePlan(records.plan);
  await repository.savePlanRevision(records.planRevision);
  await repository.saveExecutionPackage(executionPackage);
};

export const seedQueuedPackageRun = async (
  repository: P0Repository,
): Promise<{ executionPackage: ExecutionPackage; runSession: RunSession }> => {
  const records = baseRecords();
  const runSessionId = 'run-session-1';
  const executionPackage = transitionExecutionPackage(records.executionPackage, {
    type: 'run',
    run_session_id: runSessionId,
    at: now,
  });
  const runSession = transitionRunSession(undefined, {
    type: 'create',
    id: runSessionId,
    execution_package_id: executionPackage.id,
    requested_by_actor_id: actorOwner,
    executor_type: 'mock',
    at: now,
  });

  await saveBaseRecords(repository, executionPackage, records);
  await repository.saveRunSession(runSession);

  return { executionPackage, runSession };
};

export const seedReadyStartedPackageRun = async (
  repository: P0Repository,
): Promise<{ executionPackage: ExecutionPackage; runSession: RunSession }> => {
  const { executionPackage, runSession } = await seedQueuedPackageRun(repository);
  const startedAt = '2026-05-05T00:00:30.000Z';
  const startedPackage: ExecutionPackage = {
    ...executionPackage,
    phase: 'execution',
    activity_state: 'ai_running',
    updated_at: startedAt,
  };
  const startedRunSession: RunSession = {
    ...runSession,
    status: 'running',
    executor_type: 'mock',
    run_spec: runSpecFor(executionPackage, runSession.id),
    started_at: startedAt,
    updated_at: startedAt,
  };

  await repository.saveExecutionPackage(startedPackage);
  await repository.saveRunSession(startedRunSession);

  return { executionPackage: startedPackage, runSession: startedRunSession };
};

export const seedRunningRunWithCommand = async (
  repository: P0Repository,
  command: Partial<RunCommand>,
): Promise<{ runSession: RunSession; command: RunCommand }> => {
  const { runSession } = await seedReadyStartedPackageRun(repository);
  const persistedCommand: RunCommand = {
    id: command.id ?? `run-command:${runSession.id}:continue`,
    run_session_id: command.run_session_id ?? runSession.id,
    command_type: command.command_type ?? 'continue',
    status: command.status ?? 'pending',
    actor_id: command.actor_id ?? actorOwner,
    payload: command.payload ?? {},
    created_at: command.created_at ?? now,
    updated_at: command.updated_at ?? now,
    ...(command.target_thread_id === undefined ? {} : { target_thread_id: command.target_thread_id }),
    ...(command.target_turn_id === undefined ? {} : { target_turn_id: command.target_turn_id }),
    ...(command.claimed_by_worker_id === undefined ? {} : { claimed_by_worker_id: command.claimed_by_worker_id }),
    ...(command.claimed_at === undefined ? {} : { claimed_at: command.claimed_at }),
    ...(command.applied_at === undefined ? {} : { applied_at: command.applied_at }),
    ...(command.failure_reason === undefined ? {} : { failure_reason: command.failure_reason }),
    ...(command.driver_ack === undefined ? {} : { driver_ack: command.driver_ack }),
  };

  await repository.saveRunCommand(persistedCommand);

  return { runSession, command: persistedCommand };
};

export const monotonicTestClock = (startIso: string, incrementMs = 1): (() => string) => {
  let current = new Date(startIso).getTime();

  return () => {
    const value = new Date(current).toISOString();
    current += incrementMs;
    return value;
  };
};

const createProjectRepoWorkItem = async (app: INestApplication) => {
  const server = app.getHttpServer();
  const project = (
    await request(server).post('/projects').send({ name: 'Forgeloop', owner_actor_id: actorOwner }).expect(201)
  ).body;

  await request(server)
    .post(`/projects/${project.id}/repos`)
    .send({
      repo_id: 'repo-1',
      name: 'forgeloop',
      local_path: '/workspace/forgeloop',
      default_branch: 'main',
      base_commit_sha: 'abc123',
    })
    .expect(201);

  const workItem = (
    await request(server)
      .post('/work-items')
      .send({
        project_id: project.id,
        kind: 'feature',
        title: 'Ship P0 control plane API',
        goal: 'Expose the delivery loop commands over REST.',
        success_criteria: ['Spec, plan, package, run, and review commands are available.'],
        priority: 'P0',
        risk: 'medium',
        owner_actor_id: actorOwner,
      })
      .expect(201)
  ).body;

  return { project, workItem };
};

const approveSpec = async (app: INestApplication, workItemId: string): Promise<string> => {
  const server = app.getHttpServer();
  const spec = (await request(server).post(`/work-items/${workItemId}/specs`).send({}).expect(201)).body;

  await request(server).post(`/specs/${spec.id}/generate-draft`).send({}).expect(201);
  await request(server).post(`/specs/${spec.id}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
  await request(server).post(`/specs/${spec.id}/approve`).send({ actor_id: actorReviewer }).expect(201);

  return spec.id as string;
};

const approvePlan = async (app: INestApplication, workItemId: string): Promise<string> => {
  const server = app.getHttpServer();
  const plan = (await request(server).post(`/work-items/${workItemId}/plans`).send({}).expect(201)).body;
  const planRevision = (await request(server).post(`/plans/${plan.id}/generate-draft`).send({}).expect(201)).body;

  await request(server).post(`/plans/${plan.id}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
  await request(server).post(`/plans/${plan.id}/approve`).send({ actor_id: actorReviewer }).expect(201);

  return planRevision.id as string;
};

export const seedReadyExecutionPackageThroughApi = async (app: INestApplication): Promise<ExecutionPackage> => {
  const server = app.getHttpServer();
  const { workItem } = await createProjectRepoWorkItem(app);

  await approveSpec(app, workItem.id);
  const planRevisionId = await approvePlan(app, workItem.id);

  const executionPackage = (
    await request(server)
      .post(`/plan-revisions/${planRevisionId}/execution-packages`)
      .send({
        repo_id: 'repo-1',
        objective: 'Implement the P0 API package.',
        owner_actor_id: actorOwner,
        reviewer_actor_id: actorReviewer,
        qa_owner_actor_id: actorQa,
        required_checks: [...requiredChecks],
        required_artifact_kinds: ['execution_summary'],
        allowed_paths: ['apps/control-plane-api/**', 'tests/api/**'],
        forbidden_paths: ['packages/db/**'],
      })
      .expect(201)
  ).body as ExecutionPackage;

  return (await request(server)
    .post(`/execution-packages/${executionPackage.id}/mark-ready`)
    .send({ actor_id: actorOwner })
    .expect(201)).body as ExecutionPackage;
};

export const seedAppWithRunSession = async (
  options: { durabilityMode?: 'durable' | 'volatile_demo'; allowDemoActorIdFallback?: boolean } = {},
): Promise<{ app: INestApplication; repo: InMemoryP0Repository; runSessionId: string }> => {
  let moduleBuilder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RUN_WORKER)
    .useValue({ kick: () => undefined, drainOnce: async () => undefined });
  if (options.durabilityMode !== undefined) {
    moduleBuilder = moduleBuilder.overrideProvider(RUN_DURABILITY_MODE).useValue(options.durabilityMode);
  }
  if (options.allowDemoActorIdFallback !== undefined) {
    moduleBuilder = moduleBuilder.overrideProvider(P0_DEMO_ACTOR_ID_FALLBACK).useValue(options.allowDemoActorIdFallback);
  }
  const moduleRef = await moduleBuilder.compile();
  const app = moduleRef.createNestApplication();
  await app.init();

  const executionPackage = await seedReadyExecutionPackageThroughApi(app);
  const repo = app.get(P0_REPOSITORY) as InMemoryP0Repository;

  if (options.durabilityMode === 'durable' && options.allowDemoActorIdFallback === false) {
    const runSessionId = 'run-session-seeded';
    const at = '2026-05-07T00:00:00.000Z';
    await repo.saveExecutionPackage(transitionExecutionPackage(executionPackage, { type: 'run', run_session_id: runSessionId, at }));
    await repo.saveRunSession({
      ...transitionRunSession(undefined, {
        type: 'create',
        id: runSessionId,
        execution_package_id: executionPackage.id,
        requested_by_actor_id: actorOwner,
        executor_type: 'mock',
        at,
      }),
      runtime_metadata: {
        durability_mode: 'durable',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'not_requested',
      },
    });
    await repo.appendRunEvent({
      id: 'run-event-seeded-queued',
      run_session_id: runSessionId,
      event_type: 'run_queued',
      source: 'api',
      visibility: 'public',
      summary: 'Run queued.',
      payload: { execution_package_id: executionPackage.id, mode: 'run', workflow_only: true, executor_type: 'mock' },
      created_at: at,
    });

    return { app, repo, runSessionId };
  }

  const run = (
    await request(app.getHttpServer())
      .post(`/execution-packages/${executionPackage.id}/run`)
      .send({
        requested_by_actor_id: actorOwner,
        workflow_only: true,
      })
      .expect(201)
  ).body as { run_session_id: string };

  const runSession = await repo.getRunSession(run.run_session_id);

  if (runSession !== undefined) {
    await repo.saveRunSession({
      ...runSession,
      runtime_metadata: {
        durability_mode: options.durabilityMode ?? 'volatile_demo',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'not_requested',
      },
    });
  }

  return { app, repo, runSessionId: run.run_session_id };
};
