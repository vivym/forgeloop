import { describe, expect, it } from 'vitest';
import type {
  Artifact,
  AutomationActionRun,
  BoundarySummaryRevision,
  Decision,
  ExecutionPackage,
  ExecutionPackageDependency,
  ObjectEvent,
  Plan,
  PlanRevision,
  Project,
  ProjectRepo,
  Release,
  ReviewPacket,
  RunSession,
  Spec,
  SpecRevision,
  StatusHistory,
  WorkItem,
} from '@forgeloop/domain';

import {
  createDbClient,
  DrizzleDeliveryRepository,
  InMemoryDeliveryRepository,
  type DeliveryRepository,
  type TraceArtifactRefRecord,
  type TraceEventRecord,
  type TraceLinkRecord,
  assertResettableDatabaseUrl,
  resetForgeloopDatabase,
  release_execution_packages,
  release_work_items,
  releases,
} from '../../packages/db/src/index';
import { itPersistsAiNativePlanningGraph, runDeliveryRepositoryContract } from './repository-contract';

const now = '2026-05-05T00:00:00.000Z';

const artifactRef = {
  kind: 'execution_summary',
  name: 'summary',
  content_type: 'text/markdown',
  local_ref: 'artifacts/run-1/summary.md',
} as const;

const requiredCheck = {
  check_id: 'db-tests',
  display_name: 'DB tests',
  command: 'pnpm test tests/db',
  timeout_seconds: 120,
  blocks_review: true,
};
const requirementIntakeContext: WorkItem['intake_context'] = {
  type: 'requirement',
  stakeholder_problem: 'Delivery teams need durable Work Item records.',
  desired_outcome: 'Repository adapters persist typed Work Item intake.',
  acceptance_criteria: ['Work Item fixtures round-trip driver identity and intake context.'],
  in_scope: ['DB repository contract'],
};

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
  title: 'Ship delivery db boundary',
  narrative_markdown: '',
  goal: 'Persist the delivery loop state.',
  success_criteria: ['Required delivery records can be saved and queried.'],
  priority: 'P0',
  risk: 'medium',
  driver_actor_id: 'actor-driver',
  intake_context: requirementIntakeContext,
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
  summary: 'Approved spec',
  content: 'Spec body',
  background: 'Background',
  goals: ['Persist delivery state'],
  scope_in: ['DB package'],
  scope_out: ['Non-delivery workflows'],
  acceptance_criteria: ['Repository can replay minimal flow'],
  risk_notes: ['Adapter is not integration-tested against Postgres yet'],
  test_strategy_summary: 'Vitest repository tests',
  structured_document: { sections: ['goal', 'scope'] },
  artifact_refs: [artifactRef],
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
  summary: 'Approved plan',
  content: 'Plan body',
  implementation_summary: 'Add schema and repository boundary.',
  split_strategy: 'One package for db boundary.',
  dependency_order: ['execution-package-1'],
  test_matrix: ['pnpm test tests/db'],
  risk_mitigations: ['Keep runtime adapter compile-safe'],
  rollback_notes: 'Revert db package changes.',
  structured_document: { steps: ['schema', 'repository'] },
  artifact_refs: [artifactRef],
  created_at: now,
};

const executionPackage: ExecutionPackage = {
  id: 'execution-package-1',
  work_item_id: workItem.id,
  spec_id: spec.id,
  spec_revision_id: specRevision.id,
  plan_id: plan.id,
  plan_revision_id: planRevision.id,
  project_id: project.id,
  repo_id: projectRepo.repo_id,
  objective: 'Add the delivery db boundary.',
  owner_actor_id: 'actor-owner',
  reviewer_actor_id: 'actor-reviewer',
  qa_owner_actor_id: 'actor-qa',
  phase: 'review',
  activity_state: 'awaiting_human',
  gate_state: 'awaiting_human_review',
  resolution: 'none',
  required_checks: [requiredCheck],
  required_test_gates: [],
  required_artifact_kinds: ['execution_summary'],
  allowed_paths: ['packages/db/**', 'tests/db/**'],
  forbidden_paths: ['apps/**'],
  source_mutation_policy: 'path_policy_scoped',
  last_run_session_id: 'run-session-1',
  created_at: now,
  updated_at: now,
};

const workItem2: WorkItem = {
  ...workItem,
  id: 'work-item-2',
  title: 'Ship P1 release link ordering',
  goal: 'Exercise release link ordering with multiple rows.',
  success_criteria: ['Release links preserve insertion order.'],
};

const executionPackage2: ExecutionPackage = {
  ...executionPackage,
  id: 'execution-package-2',
  work_item_id: workItem2.id,
};

const dependency: ExecutionPackageDependency = {
  package_id: executionPackage.id,
  depends_on_package_id: 'execution-package-0',
};

const runSession: RunSession = {
  id: 'run-session-1',
  execution_package_id: executionPackage.id,
  requested_by_actor_id: 'actor-owner',
  status: 'succeeded',
  executor_type: 'mock',
  run_spec: {
    run_session_id: 'run-session-1',
    execution_package_id: executionPackage.id,
    work_item_id: workItem.id,
    spec_revision_id: specRevision.id,
    plan_revision_id: planRevision.id,
    executor_type: 'mock',
    repo: {
      repo_id: projectRepo.repo_id,
      local_path: projectRepo.local_path,
      base_branch: projectRepo.default_branch,
      base_commit_sha: projectRepo.base_commit_sha,
    },
    objective: executionPackage.objective,
    context: {
      spec_revision_summary: specRevision.summary,
      plan_revision_summary: planRevision.summary,
      package_instructions: executionPackage.objective,
      required_checks: [requiredCheck],
    },
    review_context: { latest_decision: 'none', requested_changes: [] },
    workflow_only: true,
    allowed_paths: executionPackage.allowed_paths,
    forbidden_paths: executionPackage.forbidden_paths,
    required_checks: [requiredCheck],
    artifact_policy: { requested_artifacts: ['execution_summary'] },
    timeout_seconds: 300,
    idempotency_key: 'execution-package-1:run-session-1:abc123',
  },
  executor_result: {
    run_session_id: 'run-session-1',
    executor_type: 'mock',
    executor_version: '0.1.0',
    status: 'succeeded',
    started_at: now,
    finished_at: now,
    summary: 'Mock execution succeeded.',
    changed_files: [{ repo_id: projectRepo.repo_id, path: 'packages/db/src/index.ts', change_kind: 'modified' }],
    checks: [
      {
        check_id: requiredCheck.check_id,
        command: requiredCheck.command,
        status: 'succeeded',
        exit_code: 0,
        duration_seconds: 2,
        blocks_review: true,
      },
    ],
    artifacts: [artifactRef],
    raw_metadata: { workflow_only: true },
  },
  changed_files: [{ repo_id: projectRepo.repo_id, path: 'packages/db/src/index.ts', change_kind: 'modified' }],
  check_results: [
    {
      check_id: requiredCheck.check_id,
      command: requiredCheck.command,
      status: 'succeeded',
      exit_code: 0,
      duration_seconds: 2,
      blocks_review: true,
    },
  ],
  artifacts: [artifactRef],
  log_refs: [{ ...artifactRef, kind: 'logs', name: 'executor log', content_type: 'text/plain' }],
  summary: 'Run completed.',
  created_at: now,
  updated_at: now,
  started_at: now,
  finished_at: now,
};

const reviewPacket: ReviewPacket = {
  id: 'review-packet-1',
  run_session_id: runSession.id,
  execution_package_id: executionPackage.id,
  reviewer_actor_id: executionPackage.reviewer_actor_id,
  spec_revision_id: specRevision.id,
  plan_revision_id: planRevision.id,
  status: 'ready',
  decision: 'none',
  summary: 'Ready for review.',
  changed_files: runSession.changed_files,
  check_result_summary: 'pnpm test tests/db passed.',
  self_review: {
    status: 'succeeded',
    summary: 'The db boundary matches the approved plan.',
    spec_plan_alignment: 'Aligned.',
    test_assessment: 'DB repository tests cover the delivery flow.',
    risk_notes: ['Postgres integration remains future work.'],
    follow_up_questions: [],
  },
  independent_ai_review: {
    status: 'approved',
    summary: 'Independent review passed.',
    run_session_id: runSession.id,
    execution_package_id: executionPackage.id,
    risk_notes: [],
  },
  test_mapping: [{ gate_id: requiredCheck.check_id, result: 'passed', evidence_ref: `run-check:${requiredCheck.check_id}` }],
  risk_notes: ['Postgres integration remains future work.'],
  requested_changes: [],
  created_at: now,
  updated_at: now,
};

const objectEvent: ObjectEvent = {
  id: 'event-1',
  object_type: 'execution_package',
  object_id: executionPackage.id,
  event_type: 'run_completed',
  actor_id: 'actor-owner',
  metadata: { run_session_id: runSession.id },
  created_at: now,
};

const statusHistory: StatusHistory = {
  id: 'status-1',
  object_type: 'execution_package',
  object_id: executionPackage.id,
  from_status: 'execution',
  to_status: 'review',
  actor_id: 'actor-owner',
  reason: 'Run succeeded.',
  created_at: now,
};

const artifact: Artifact = {
  id: 'artifact-1',
  object_type: 'run_session',
  object_id: runSession.id,
  ref: artifactRef,
  created_at: now,
};

const artifactWithTraceSubject: Artifact = {
  ...artifact,
  id: 'artifact-with-trace-subject',
  trace_subject_type: 'execution_package',
  trace_subject_id: executionPackage.id,
};

const decision: Decision = {
  id: 'decision-1',
  object_type: 'review_packet',
  object_id: reviewPacket.id,
  actor_id: 'actor-reviewer',
  decision: 'approved',
  summary: 'Approved for handoff.',
  created_at: now,
};

const release: Release = {
  id: 'release-1',
  org_id: 'org-1',
  project_id: project.id,
  key: 'REL-1',
  title: 'P1 release',
  phase: 'candidate',
  activity_state: 'idle',
  gate_state: 'approved',
  resolution: 'none',
  scope_summary: 'Two work items, one package.',
  work_item_ids: [workItem2.id, workItem.id],
  execution_package_ids: [executionPackage2.id, executionPackage.id],
  current_review_packet_ids: [reviewPacket.id],
  current_run_session_ids: [runSession.id],
  rollout_strategy: 'Ship behind flag.',
  rollback_plan: 'Disable flag.',
  observation_plan: 'Watch latency.',
  release_owner_actor_id: 'actor-owner',
  release_type: 'gray',
  visibility: 'internal',
  labels: ['p1'],
  created_by_actor_id: 'actor-owner',
  created_at: now,
  updated_at: now,
  updated_by_actor_id: 'actor-owner',
};

const traceEvent: TraceEventRecord = {
  id: 'trace-event-1',
  event_type: 'run_replacement_recorded',
  subject_type: 'run_session',
  subject_id: 'run-session-2',
  actor_id: 'actor-owner',
  summary: 'Run run-session-2 supersedes run-session-1.',
  payload: {
    mode: 'rerun_package',
    execution_package_id: executionPackage.id,
    work_item_id: workItem.id,
    new_run_session_id: 'run-session-2',
    previous_run_session_id: runSession.id,
    previous_review_packet_id: reviewPacket.id,
  },
  created_at: now,
};

const traceLinks: TraceLinkRecord[] = [
  {
    id: 'trace-link-1',
    trace_event_id: traceEvent.id,
    relationship: 'belongs_to',
    object_type: 'execution_package',
    object_id: executionPackage.id,
    created_at: now,
  },
  {
    id: 'trace-link-2',
    trace_event_id: traceEvent.id,
    relationship: 'generated_by',
    object_type: 'run_session',
    object_id: 'run-session-2',
    created_at: now,
  },
  {
    id: 'trace-link-3',
    trace_event_id: traceEvent.id,
    relationship: 'supersedes',
    object_type: 'run_session',
    object_id: runSession.id,
    created_at: now,
  },
  {
    id: 'trace-link-4',
    trace_event_id: traceEvent.id,
    relationship: 'replaces',
    object_type: 'review_packet',
    object_id: reviewPacket.id,
    created_at: now,
  },
];

const traceArtifactRef: TraceArtifactRefRecord = {
  id: 'trace-artifact-ref-1',
  trace_event_id: traceEvent.id,
  artifact_id: artifact.id,
  ref: artifactRef,
  created_at: now,
};

const createInsertCaptureRepository = () => {
  const captures: Array<{ table: unknown; values: Record<string, unknown>; set?: Record<string, unknown> }> = [];
  const deletes: Array<{ table: unknown; predicate: unknown }> = [];
  const transactions: unknown[] = [];
  const db = {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
          captures.push({ table, values, set });
        },
        onConflictDoNothing: async () => {
          captures.push({ table, values });
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async (predicate: unknown) => {
        deletes.push({ table, predicate });
      },
    }),
    transaction: async <T>(callback: (tx: never) => Promise<T>) => {
      transactions.push(db);
      return callback(db as never);
    },
  };

  return { repository: new DrizzleDeliveryRepository(db as never), captures, deletes, transactions };
};

const createSingleRowRepository = (row: Record<string, unknown>) => {
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [row],
        }),
      }),
    }),
  };

  return new DrizzleDeliveryRepository(db as never);
};

const createEmptySelectRepository = () => {
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
  };

  return new DrizzleDeliveryRepository(db as never);
};

const createReleaseSelectRepository = () => {
  const releaseRow = {
    id: release.id,
    orgId: release.org_id,
    projectId: release.project_id,
    key: release.key,
    title: release.title,
    phase: release.phase,
    activityState: release.activity_state,
    gateState: release.gate_state,
    resolution: release.resolution,
    currentReviewPacketIds: release.current_review_packet_ids,
    currentRunSessionIds: release.current_run_session_ids,
    rolloutStrategy: release.rollout_strategy,
    rollbackPlan: release.rollback_plan,
    observationPlan: release.observation_plan,
    releaseOwnerActorId: release.release_owner_actor_id,
    releaseType: release.release_type,
    scopeSummary: release.scope_summary,
    visibility: release.visibility,
    labels: release.labels,
    createdByActorId: release.created_by_actor_id,
    createdAt: release.created_at,
    updatedAt: release.updated_at,
    updatedByActorId: release.updated_by_actor_id,
  };
  const rowsByTable = new Map<unknown, Record<string, unknown>[]>([
    [releases, [releaseRow]],
    [
      release_work_items,
      [
        { releaseId: release.id, workItemId: workItem.id, linkOrder: 1 },
        { releaseId: release.id, workItemId: workItem2.id, linkOrder: 0 },
      ],
    ],
    [
      release_execution_packages,
      [
        { releaseId: release.id, packageId: executionPackage.id, linkOrder: 1 },
        { releaseId: release.id, packageId: executionPackage2.id, linkOrder: 0 },
      ],
    ],
  ]);
  const sortReleaseLinks = (rows: Record<string, unknown>[]) =>
    [...rows].sort((left, right) => (Number(left.linkOrder ?? 0) - Number(right.linkOrder ?? 0)) || 0);
  const queryResult = (table: unknown) => {
    const rows = rowsByTable.get(table) ?? [];
    const orderedRows = sortReleaseLinks(rows);
    return {
      limit: async () => rows.slice(0, 1),
      orderBy: async () => orderedRows,
      then: (resolve: (rows: Record<string, unknown>[]) => unknown, reject?: (error: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };
  };
  const selectFrom = (table: unknown) => ({
    where: () => queryResult(table),
    orderBy: async () => sortReleaseLinks(rowsByTable.get(table) ?? []),
  });
  const db = {
    select: () => ({
      from: (table: unknown) => selectFrom(table),
    }),
  };

  return new DrizzleDeliveryRepository(db as never);
};

describe('DeliveryRepository in-memory adapter', () => {
  it('satisfies the shared repository contract', async () => {
    await runDeliveryRepositoryContract(new InMemoryDeliveryRepository());
  });

  itPersistsAiNativePlanningGraph(() => new InMemoryDeliveryRepository());

  it('persists and queries a minimal delivery flow', async () => {
    const repository: DeliveryRepository = new InMemoryDeliveryRepository();

    await repository.saveProject(project);
    await repository.saveProjectRepo(projectRepo);
    await repository.saveWorkItem(workItem);
    await repository.saveSpec(spec);
    await repository.saveSpecRevision(specRevision);
    await repository.savePlan(plan);
    await repository.savePlanRevision(planRevision);
    await repository.saveExecutionPackage(executionPackage);
    await repository.saveExecutionPackageDependency(dependency);
    await repository.saveRunSession(runSession);
    await repository.saveReviewPacket(reviewPacket);
    await repository.appendObjectEvent(objectEvent);
    await repository.appendStatusHistory(statusHistory);
    await repository.saveArtifact(artifact);
    await repository.saveDecision(decision);

    expect(await repository.getProject(project.id)).toEqual(project);
    expect(await repository.listProjectRepos(project.id)).toEqual([projectRepo]);
    expect(await repository.getWorkItem(workItem.id)).toEqual(workItem);
    expect(await repository.listWorkItems(project.id)).toEqual([workItem]);
    expect(await repository.getSpec(spec.id)).toEqual(spec);
    expect(await repository.listSpecRevisions(spec.id)).toEqual([specRevision]);
    expect(await repository.getPlan(plan.id)).toEqual(plan);
    expect(await repository.listPlanRevisions(plan.id)).toEqual([planRevision]);
    expect(await repository.getExecutionPackage(executionPackage.id)).toEqual(executionPackage);
    expect(await repository.listExecutionPackagesForWorkItem(workItem.id)).toEqual([executionPackage]);
    expect(await repository.listExecutionPackageDependencies(executionPackage.id)).toEqual([dependency]);
    expect(await repository.getRunSession(runSession.id)).toEqual(runSession);
    expect(await repository.listRunSessionsForPackage(executionPackage.id)).toEqual([runSession]);
    expect(await repository.getReviewPacket(reviewPacket.id)).toEqual(reviewPacket);
    expect(await repository.listReviewPacketsForPackage(executionPackage.id)).toEqual([reviewPacket]);
    expect(await repository.findOpenReviewPacketForPackage(executionPackage.id)).toEqual(reviewPacket);
    expect(await repository.listObjectEvents(executionPackage.id)).toEqual([objectEvent]);
    expect(await repository.listStatusHistory(executionPackage.id)).toEqual([statusHistory]);
    expect(await repository.listArtifactsForObject('run_session', runSession.id)).toEqual([artifact]);
    expect(await repository.listDecisionsForObject('review_packet', reviewPacket.id)).toEqual([decision]);
  });

  it('does not leak mutable references for key records', async () => {
    const repository = new InMemoryDeliveryRepository();

    await repository.saveProject(project);
    await repository.saveWorkItem(workItem);
    await repository.saveRunSession(runSession);

    const returnedProject = await repository.getProject(project.id);
    const returnedWorkItem = await repository.getWorkItem(workItem.id);
    const returnedRunSession = await repository.getRunSession(runSession.id);

    if (returnedProject === undefined || returnedWorkItem === undefined || returnedRunSession === undefined) {
      throw new Error('Expected saved records to be returned');
    }

    returnedProject.name = 'mutated';
    returnedWorkItem.success_criteria.push('mutated');
    returnedRunSession.changed_files[0]!.path = 'mutated.ts';

    expect((await repository.getProject(project.id))?.name).toBe(project.name);
    expect((await repository.getWorkItem(workItem.id))?.success_criteria).toEqual(workItem.success_criteria);
    expect((await repository.getRunSession(runSession.id))?.changed_files).toEqual(runSession.changed_files);
  });

  it('rolls back in-memory transaction writes when the callback throws', async () => {
    const repository = new InMemoryDeliveryRepository();

    await expect(
      repository.withDeliveryTransaction(async (transaction) => {
        await transaction.saveProject(project);
        await transaction.saveProjectRepo(projectRepo);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    await expect(repository.getProject(project.id)).resolves.toBeUndefined();
    await expect(repository.listProjectRepos(project.id)).resolves.toEqual([]);
  });

  it('does not roll back concurrent in-memory writes when a transaction throws', async () => {
    const repository = new InMemoryDeliveryRepository();
    const concurrentProject: Project = {
      ...project,
      id: 'project-concurrent-commit',
      name: 'Concurrent commit',
    };
    let releaseTransaction: (() => void) | undefined;
    let transaction: Promise<unknown> | undefined;
    const transactionStarted = new Promise<void>((resolve) => {
      transaction = repository.withDeliveryTransaction(async (tx) => {
        await tx.saveProject(project);
        resolve();
        await new Promise<void>((release) => {
          releaseTransaction = release;
        });
        throw new Error('rollback');
      });
    });

    await transactionStarted;
    await repository.saveProject(concurrentProject);
    releaseTransaction?.();

    if (transaction === undefined) {
      throw new Error('Expected transaction to be started');
    }
    await expect(transaction).rejects.toThrow('rollback');

    await expect(repository.getProject(project.id)).resolves.toBeUndefined();
    await expect(repository.getProject(concurrentProject.id)).resolves.toEqual(concurrentProject);
  });

  it('rejects an in-memory transaction that would overwrite a concurrent write', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.saveProject(project);
    const concurrentProject: Project = {
      ...project,
      name: 'Concurrent update',
    };
    const transactionProject: Project = {
      ...project,
      name: 'Transaction update',
    };
    let releaseTransaction: (() => void) | undefined;
    let transaction: Promise<unknown> | undefined;
    const transactionStarted = new Promise<void>((resolve) => {
      transaction = repository.withDeliveryTransaction(async (tx) => {
        await tx.saveProject(transactionProject);
        resolve();
        await new Promise<void>((release) => {
          releaseTransaction = release;
        });
      });
    });

    await transactionStarted;
    await repository.saveProject(concurrentProject);
    releaseTransaction?.();

    if (transaction === undefined) {
      throw new Error('Expected transaction to be started');
    }
    await expect(transaction).rejects.toThrow(/concurrent/i);
    await expect(repository.getProject(project.id)).resolves.toEqual(concurrentProject);
  });

  it('gets spec revisions by id and returns undefined for unknown ids', async () => {
    const repository: DeliveryRepository = new InMemoryDeliveryRepository();
    await repository.saveSpec(spec);
    await repository.saveSpecRevision(specRevision);

    const storedRevision = await repository.getSpecRevision(specRevision.id);
    expect(storedRevision).toEqual(specRevision);
    expect(storedRevision).not.toBe(specRevision);
    expect(await repository.getSpecRevision('missing-spec-revision')).toBeUndefined();
  });

  it('gets plan revisions by id and returns undefined for unknown ids', async () => {
    const repository: DeliveryRepository = new InMemoryDeliveryRepository();
    await repository.savePlan(plan);
    await repository.savePlanRevision(planRevision);

    const storedRevision = await repository.getPlanRevision(planRevision.id);
    expect(storedRevision).toEqual(planRevision);
    expect(storedRevision).not.toBe(planRevision);
    expect(await repository.getPlanRevision('missing-plan-revision')).toBeUndefined();
  });

  it('keeps the original object event when the same event id is appended again', async () => {
    const repository = new InMemoryDeliveryRepository();
    const duplicateEvent: ObjectEvent = {
      ...objectEvent,
      event_type: 'run_started',
      metadata: { run_session_id: 'different-run-session' },
      created_at: '2026-05-05T00:01:00.000Z',
    };

    await repository.appendObjectEvent(objectEvent);
    await repository.appendObjectEvent(duplicateEvent);

    expect(await repository.listObjectEvents(executionPackage.id)).toEqual([objectEvent]);
  });

  it('keeps the original status history when the same history id is appended again', async () => {
    const repository = new InMemoryDeliveryRepository();
    const duplicateStatusHistory: StatusHistory = {
      ...statusHistory,
      from_status: 'ready',
      to_status: 'execution',
      reason: 'Conflicting duplicate.',
      created_at: '2026-05-05T00:01:00.000Z',
    };

    await repository.appendStatusHistory(statusHistory);
    await repository.appendStatusHistory(duplicateStatusHistory);

    expect(await repository.listStatusHistory(executionPackage.id)).toEqual([statusHistory]);
  });

  it('persists artifact trace subject fields', async () => {
    const repository = new InMemoryDeliveryRepository();

    await repository.saveArtifact(artifactWithTraceSubject);

    expect(await repository.listArtifactsForObject('run_session', runSession.id)).toEqual([artifactWithTraceSubject]);
  });

  it('persists trace events, links, and artifact refs', async () => {
    const repository: DeliveryRepository = new InMemoryDeliveryRepository();

    await repository.saveTraceEvent(traceEvent);
    for (const link of traceLinks) {
      await repository.saveTraceLink(link);
    }
    await repository.saveTraceArtifactRef(traceArtifactRef);

    expect(await repository.listTraceEventsForSubject('run_session', 'run-session-2')).toEqual([traceEvent]);
    expect(await repository.listTraceLinks(traceEvent.id)).toEqual(traceLinks);
    expect(await repository.listTraceArtifactRefs(traceEvent.id)).toEqual([traceArtifactRef]);
  });

  it('orders trace rows by creation time and id for deterministic projections', async () => {
    const repository: DeliveryRepository = new InMemoryDeliveryRepository();
    const firstEvent: TraceEventRecord = { ...traceEvent, id: 'trace-event-a' };
    const secondEvent: TraceEventRecord = { ...traceEvent, id: 'trace-event-b' };
    const firstLink: TraceLinkRecord = { ...traceLinks[0]!, id: 'trace-link-a' };
    const secondLink: TraceLinkRecord = { ...traceLinks[0]!, id: 'trace-link-b' };
    const firstArtifactRef: TraceArtifactRefRecord = { ...traceArtifactRef, id: 'trace-artifact-ref-a' };
    const secondArtifactRef: TraceArtifactRefRecord = { ...traceArtifactRef, id: 'trace-artifact-ref-b' };

    await repository.saveTraceEvent(secondEvent);
    await repository.saveTraceEvent(firstEvent);
    await repository.saveTraceLink(secondLink);
    await repository.saveTraceLink(firstLink);
    await repository.saveTraceArtifactRef(secondArtifactRef);
    await repository.saveTraceArtifactRef(firstArtifactRef);

    expect(await repository.listTraceEventsForSubject(traceEvent.subject_type, traceEvent.subject_id)).toEqual([
      firstEvent,
      secondEvent,
    ]);
    expect(await repository.listTraceLinks(traceEvent.id)).toEqual([firstLink, secondLink]);
    expect(await repository.listTraceArtifactRefs(traceEvent.id)).toEqual([firstArtifactRef, secondArtifactRef]);
  });

  it('round-trips release canonical fields and lists releases with optional project filtering', async () => {
    const repository: DeliveryRepository = new InMemoryDeliveryRepository();
    const otherProjectRelease: Release = {
      ...release,
      id: 'release-other-project',
      project_id: 'project-2',
      key: 'REL-2',
      title: 'Other project release',
    };

    await repository.saveRelease(release);
    await repository.saveRelease(otherProjectRelease);

    expect(await repository.getRelease(release.id)).toEqual(release);
    expect(await repository.listReleases(project.id)).toEqual([release]);
    expect(await repository.listReleases()).toEqual([release, otherProjectRelease]);
  });
});

describe('DeliveryRepository Drizzle adapter contract', () => {
  const databaseUrl = process.env.FORGELOOP_TEST_DATABASE_URL ?? process.env.FORGELOOP_DATABASE_URL;

  if (databaseUrl === undefined) {
    it.skip('skips shared repository contract because no disposable database URL is configured', () => {});
  } else if (!isResettable(databaseUrl)) {
    it.skip('skips shared repository contract because configured database URL is not resettable', () => {});
  } else {
    it('satisfies the shared repository contract', async () => {
      await resetForgeloopDatabase(databaseUrl);
      const { db, pool } = createDbClient({ connectionString: databaseUrl });
      try {
        await runDeliveryRepositoryContract(new DrizzleDeliveryRepository(db));
      } finally {
        await pool.end();
      }
    });

    itPersistsAiNativePlanningGraph(async () => {
      await resetForgeloopDatabase(databaseUrl);
      const { db } = createDbClient({ connectionString: databaseUrl });
      return new DrizzleDeliveryRepository(db);
    });
  }
});

describe('DeliveryRepository Drizzle adapter persistence mapping', () => {
  it('maps contract Boundary Summary Revision session fields into the existing Drizzle columns', async () => {
    const { repository, captures } = createInsertCaptureRepository();
    const sessionId = '12121212-1212-4212-8212-121212121211';
    const sessionRevisionId = '12121212-1212-4212-8212-121212121212';
    const developmentPlanId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const revision: BoundarySummaryRevision = {
      id: '13131313-1313-4313-8313-131313131312',
      boundary_summary_id: '13131313-1313-4313-8313-131313131311',
      session_id: sessionId,
      session_revision_id: sessionRevisionId,
      source_round_id: 'boundary-round-1',
      development_plan_id: developmentPlanId,
      development_plan_item_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
      development_plan_item_revision_id: 'ffffffff-ffff-4fff-8fff-fffffffffff3',
      revision_number: 1,
      status: 'approved',
      summary_markdown: 'Boundary summary approved.',
      confirmed_scope: ['DB repository persistence'],
      confirmed_out_of_scope: ['API orchestration'],
      accepted_assumptions: [],
      open_risks: [],
      validation_expectations: ['Repository tests pass'],
      question_answer_snapshot: [{ question_id: 'question-1', answer_id: 'answer-1', text: 'Persist it.' }],
      decision_snapshot: [{ decision_id: 'decision-1', text: 'Use first-class tables.' }],
      decision_count: 1,
      context_manifest_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      context_manifest_revision_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      approved_by_actor_id: '99999999-9999-4999-8999-999999999999',
      approved_at: now,
      created_at: now,
    } as BoundarySummaryRevision;

    await repository.saveBoundarySummaryRevision(revision);

    expect(captures[0]?.values.brainstormingSessionId).toBe(sessionId);
    expect(captures[0]?.values.brainstormingSessionRevisionId).toBe(sessionRevisionId);
    expect(captures[0]?.values.sessionId).toBeUndefined();
    expect(captures[0]?.values.sessionRevisionId).toBeUndefined();
    expect(captures[0]?.values.developmentPlanId).toBe(developmentPlanId);
    expect(captures[0]?.values.decisionCount).toBe(1);
    expect(captures[0]?.set).toBeUndefined();
  });

  it('writes omitted nullable optional domain fields as null without nulling required JSON fields', async () => {
    const { repository, captures } = createInsertCaptureRepository();
    const executionPackageWithoutLastRun: ExecutionPackage = { ...executionPackage };
    const runSessionWithoutTerminalFields: RunSession = {
      id: 'run-session-open',
      execution_package_id: executionPackage.id,
      requested_by_actor_id: 'actor-owner',
      status: 'running',
      changed_files: [],
      check_results: [],
      artifacts: [],
      log_refs: [],
      created_at: now,
      updated_at: now,
    };
    const reviewPacketWithoutCompletion: ReviewPacket = { ...reviewPacket, id: 'review-packet-open' };

    delete executionPackageWithoutLastRun.last_run_session_id;
    delete reviewPacketWithoutCompletion.summary;

    await repository.saveExecutionPackage(executionPackageWithoutLastRun);
    await repository.saveRunSession(runSessionWithoutTerminalFields);
    await repository.saveReviewPacket(reviewPacketWithoutCompletion);

    expect(captures[0]?.values.lastRunSessionId).toBeNull();
    expect(captures[0]?.set?.lastRunSessionId).toBeNull();
    expect(captures[1]?.values.finishedAt).toBeNull();
    expect(captures[1]?.values.summary).toBeNull();
    expect(captures[1]?.values.failureReason).toBeNull();
    expect(captures[1]?.set?.finishedAt).toBeNull();
    expect(captures[1]?.set?.summary).toBeNull();
    expect(captures[1]?.set?.failureReason).toBeNull();
    expect(captures[1]?.values.changedFiles).toEqual([]);
    expect(captures[1]?.values.checkResults).toEqual([]);
    expect(captures[1]?.values.artifacts).toEqual([]);
    expect(captures[1]?.values.logRefs).toEqual([]);
    expect(captures[2]?.values.completedAt).toBeNull();
    expect(captures[2]?.values.summary).toBeNull();
    expect(captures[2]?.set?.completedAt).toBeNull();
    expect(captures[2]?.set?.summary).toBeNull();
  });

  it('writes omitted artifact trace subject fields as null', async () => {
    const { repository, captures } = createInsertCaptureRepository();

    await repository.saveArtifact(artifact);

    expect(captures[0]?.values.traceSubjectType).toBeNull();
    expect(captures[0]?.values.traceSubjectId).toBeNull();
    expect(captures[0]?.set?.traceSubjectType).toBeNull();
    expect(captures[0]?.set?.traceSubjectId).toBeNull();
  });

  it('writes omitted nullable trace fields as null', async () => {
    const { repository, captures } = createInsertCaptureRepository();
    const traceEventWithoutActor: TraceEventRecord = { ...traceEvent };
    const traceArtifactRefWithoutArtifact: TraceArtifactRefRecord = { ...traceArtifactRef };
    delete traceEventWithoutActor.actor_id;
    delete traceArtifactRefWithoutArtifact.artifact_id;

    await repository.saveTraceEvent(traceEventWithoutActor);
    await repository.saveTraceArtifactRef(traceArtifactRefWithoutArtifact);

    expect(captures[0]?.values.actorId).toBeNull();
    expect(captures[0]?.set?.actorId).toBeNull();
    expect(captures[0]?.set?.createdAt).toBeUndefined();
    expect(captures[1]?.values.artifactId).toBeNull();
    expect(captures[1]?.set).toBeUndefined();
  });

  it('writes release pointer arrays and normalized package links', async () => {
    const { repository, captures, deletes, transactions } = createInsertCaptureRepository();

    await repository.saveRelease(release);

    expect(captures[0]?.values.currentReviewPacketIds).toEqual(release.current_review_packet_ids);
    expect(captures[0]?.values.currentRunSessionIds).toEqual(release.current_run_session_ids);
    expect(captures[0]?.values.scopeSummary).toBe('Two work items, one package.');
    expect(captures[0]?.values.rolloutStrategy).toBe('Ship behind flag.');
    expect(captures[0]?.values.rollbackPlan).toBe('Disable flag.');
    expect(captures[0]?.values.observationPlan).toBe('Watch latency.');
    expect(captures[0]?.values.releaseOwnerActorId).toBe('actor-owner');
    expect(captures[0]?.values.releaseType).toBe('gray');
    expect(captures[0]?.values.updatedByActorId).toBe('actor-owner');
    expect(captures[0]?.values.workItemIds).toBeUndefined();
    expect(captures[0]?.values.executionPackageIds).toBeUndefined();
    expect(captures.slice(1)).toEqual([
      expect.objectContaining({
        values: expect.objectContaining({ releaseId: release.id, workItemId: workItem2.id, linkOrder: 0 }),
      }),
      expect.objectContaining({
        values: expect.objectContaining({ releaseId: release.id, workItemId: workItem.id, linkOrder: 1 }),
      }),
      expect.objectContaining({
        values: expect.objectContaining({ releaseId: release.id, packageId: executionPackage2.id, linkOrder: 0 }),
      }),
      expect.objectContaining({
        values: expect.objectContaining({ releaseId: release.id, packageId: executionPackage.id, linkOrder: 1 }),
      }),
    ]);
    expect(transactions).toHaveLength(1);
    expect(deletes.map(({ table }) => table)).toEqual([release_work_items, release_execution_packages]);
  });

  it('replaces stale release links on repeat saves', async () => {
    const { repository, deletes, transactions } = createInsertCaptureRepository();

    await repository.saveRelease(release);
    await repository.saveRelease({
      ...release,
      work_item_ids: [workItem.id],
      execution_package_ids: [executionPackage.id, executionPackage2.id],
      updated_at: '2026-05-05T00:03:00.000Z',
      updated_by_actor_id: 'actor-system',
    });

    expect(transactions).toHaveLength(2);
    expect(deletes.map(({ table }) => table)).toEqual([
      release_work_items,
      release_execution_packages,
      release_work_items,
      release_execution_packages,
    ]);
  });

  it('maps release rows with normalized links back to the domain release shape', async () => {
    expect(await createReleaseSelectRepository().getRelease(release.id)).toEqual(release);
  });

  it('maps database nulls back to omitted optional domain properties', async () => {
    const executionPackageRow = {
      id: executionPackage.id,
      workItemId: executionPackage.work_item_id,
      specId: executionPackage.spec_id,
      specRevisionId: executionPackage.spec_revision_id,
      planId: executionPackage.plan_id,
      planRevisionId: executionPackage.plan_revision_id,
      projectId: executionPackage.project_id,
      repoId: executionPackage.repo_id,
      objective: executionPackage.objective,
      ownerActorId: executionPackage.owner_actor_id,
      reviewerActorId: executionPackage.reviewer_actor_id,
      qaOwnerActorId: executionPackage.qa_owner_actor_id,
      phase: executionPackage.phase,
      activityState: executionPackage.activity_state,
      gateState: executionPackage.gate_state,
      resolution: executionPackage.resolution,
      requiredChecks: executionPackage.required_checks,
      requiredArtifactKinds: executionPackage.required_artifact_kinds,
      allowedPaths: executionPackage.allowed_paths,
      forbiddenPaths: executionPackage.forbidden_paths,
      lastRunSessionId: null,
      createdAt: executionPackage.created_at,
      updatedAt: executionPackage.updated_at,
    };
    const runSessionRow = {
      id: runSession.id,
      executionPackageId: runSession.execution_package_id,
      requestedByActorId: runSession.requested_by_actor_id,
      status: runSession.status,
      changedFiles: runSession.changed_files,
      checkResults: runSession.check_results,
      artifacts: runSession.artifacts,
      logRefs: runSession.log_refs,
      summary: null,
      failureReason: null,
      createdAt: runSession.created_at,
      updatedAt: runSession.updated_at,
      finishedAt: null,
    };
    const reviewPacketRow = {
      id: reviewPacket.id,
      runSessionId: reviewPacket.run_session_id,
      executionPackageId: reviewPacket.execution_package_id,
      reviewerActorId: reviewPacket.reviewer_actor_id,
      specRevisionId: reviewPacket.spec_revision_id,
      planRevisionId: reviewPacket.plan_revision_id,
      status: reviewPacket.status,
      decision: reviewPacket.decision,
      changedFiles: reviewPacket.changed_files,
      checkResultSummary: reviewPacket.check_result_summary,
      selfReview: reviewPacket.self_review,
      independentAiReview: reviewPacket.independent_ai_review,
      testMapping: reviewPacket.test_mapping,
      riskNotes: reviewPacket.risk_notes,
      requestedChanges: reviewPacket.requested_changes,
      createdAt: reviewPacket.created_at,
      updatedAt: reviewPacket.updated_at,
      completedAt: null,
      summary: null,
    };

    const mappedExecutionPackage = await createSingleRowRepository(executionPackageRow).getExecutionPackage(
      executionPackage.id,
    );
    const mappedRunSession = await createSingleRowRepository(runSessionRow).getRunSession(runSession.id);
    const mappedReviewPacket = await createSingleRowRepository(reviewPacketRow).getReviewPacket(reviewPacket.id);

    expect(mappedExecutionPackage).not.toHaveProperty('last_run_session_id');
    expect(mappedRunSession).not.toHaveProperty('finished_at');
    expect(mappedRunSession).not.toHaveProperty('summary');
    expect(mappedRunSession).not.toHaveProperty('failure_reason');
    expect(mappedReviewPacket).not.toHaveProperty('completed_at');
    expect(mappedReviewPacket).not.toHaveProperty('summary');
    expect(mappedReviewPacket?.independent_ai_review).toEqual(reviewPacket.independent_ai_review);
    expect(mappedReviewPacket?.test_mapping).toEqual(reviewPacket.test_mapping);
  });

  it('maps spec revisions fetched by id', async () => {
    const repository = createSingleRowRepository({
      id: specRevision.id,
      specId: specRevision.spec_id,
      workItemId: specRevision.work_item_id,
      revisionNumber: specRevision.revision_number,
      summary: specRevision.summary,
      content: specRevision.content,
      background: specRevision.background,
      goals: specRevision.goals,
      scopeIn: specRevision.scope_in,
      scopeOut: specRevision.scope_out,
      acceptanceCriteria: specRevision.acceptance_criteria,
      riskNotes: specRevision.risk_notes,
      testStrategySummary: specRevision.test_strategy_summary,
      structuredDocument: specRevision.structured_document,
      artifactRefs: specRevision.artifact_refs,
      authorActorId: null,
      createdAt: specRevision.created_at,
    });

    expect(await repository.getSpecRevision(specRevision.id)).toEqual(specRevision);
  });

  it('returns undefined for missing spec revisions fetched by id', async () => {
    expect(await createEmptySelectRepository().getSpecRevision('missing-spec-revision')).toBeUndefined();
  });

  it('maps plan revisions fetched by id', async () => {
    const repository = createSingleRowRepository({
      id: planRevision.id,
      planId: planRevision.plan_id,
      workItemId: planRevision.work_item_id,
      revisionNumber: planRevision.revision_number,
      summary: planRevision.summary,
      content: planRevision.content,
      implementationSummary: planRevision.implementation_summary,
      splitStrategy: planRevision.split_strategy,
      dependencyOrder: planRevision.dependency_order,
      testMatrix: planRevision.test_matrix,
      riskMitigations: planRevision.risk_mitigations,
      rollbackNotes: planRevision.rollback_notes,
      structuredDocument: planRevision.structured_document,
      artifactRefs: planRevision.artifact_refs,
      authorActorId: null,
      createdAt: planRevision.created_at,
    });

    expect(await repository.getPlanRevision(planRevision.id)).toEqual(planRevision);
  });

  it('returns undefined for missing plan revisions fetched by id', async () => {
    expect(await createEmptySelectRepository().getPlanRevision('missing-plan-revision')).toBeUndefined();
  });

  it('normalizes PostgreSQL timestamp strings back to ISO datetime strings', async () => {
    const runSessionRow = {
      id: runSession.id,
      executionPackageId: runSession.execution_package_id,
      requestedByActorId: runSession.requested_by_actor_id,
      status: runSession.status,
      changedFiles: runSession.changed_files,
      checkResults: runSession.check_results,
      artifacts: runSession.artifacts,
      logRefs: runSession.log_refs,
      summary: runSession.summary,
      createdAt: '2026-05-08 03:00:00+00',
      updatedAt: '2026-05-08 03:01:00.01+00',
      startedAt: new Date('2026-05-08T03:02:00.123Z'),
      finishedAt: '2026-05-08 03:03:00.456789+00',
    };

    const mappedRunSession = await createSingleRowRepository(runSessionRow).getRunSession(runSession.id);

    expect(mappedRunSession?.created_at).toBe('2026-05-08T03:00:00.000Z');
    expect(mappedRunSession?.updated_at).toBe('2026-05-08T03:01:00.010Z');
    expect(mappedRunSession?.started_at).toBe('2026-05-08T03:02:00.123Z');
    expect(mappedRunSession?.finished_at).toBe('2026-05-08T03:03:00.456Z');
  });

  it('normalizes PostgreSQL locked-until timestamp strings back to ISO datetime strings', async () => {
    const actionRun: AutomationActionRun = {
      id: 'automation-action-1',
      action_type: 'codex_generation',
      target_object_type: 'generation_request',
      target_object_id: 'generation-1',
      target_status: 'running',
      idempotency_key: 'automation-action-key-1',
      automation_scope: 'repo:project-1:repo-1',
      automation_settings_version: 1,
      capability_fingerprint: 'capability-1',
      precondition_fingerprint: 'precondition-1',
      action_input_json: {},
      status: 'running',
      claim_token: 'claim-token-1',
      attempt: 1,
      locked_until: '2026-05-08T03:10:00.000Z',
      claimed_at: '2026-05-08T03:00:00.000Z',
      started_at: '2026-05-08T03:00:00.000Z',
      created_at: '2026-05-08T03:00:00.000Z',
      updated_at: '2026-05-08T03:00:00.000Z',
    };

    const mappedActionRun = await createSingleRowRepository({
      ...actionRun,
      lockedUntil: '2026-05-08 03:10:00+00',
      claimedAt: '2026-05-08 03:00:00+00',
    }).getClaimedAutomationActionRun({ id: actionRun.id, claim_token: actionRun.claim_token! });

    expect(mappedActionRun.locked_until).toBe('2026-05-08T03:10:00.000Z');
    expect(mappedActionRun.claimed_at).toBe('2026-05-08T03:00:00.000Z');
  });
});

const isResettable = (databaseUrl: string): boolean => {
  try {
    assertResettableDatabaseUrl(databaseUrl);
    return true;
  } catch {
    return false;
  }
};
