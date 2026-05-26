import { expect, it } from 'vitest';
import type {
  Actor,
  AutomationActionRun,
  Artifact,
  BoundarySummary,
  BoundarySummaryRevision,
  BrainstormingSession,
  CommandIdempotencyRecord,
  ContextManifest,
  Decision,
  DevelopmentPlan,
  DevelopmentPlanItem,
  DevelopmentPlanItemRevision,
  DevelopmentPlanRevision,
  Execution,
  ExecutionPlanDocument,
  ExecutionPlanRevision,
  ExecutionPackageGenerationRun,
  ExecutionPackage,
  ExecutionPackageDependency,
  ManualPathHold,
  Organization,
  ObjectEvent,
  Plan,
  PlanRevision,
  Project,
  ProjectRepo,
  Release,
  ReleaseEvidence,
  ReviewPacket,
  RunCommand,
  RunEvent,
  RunSession,
  Spec,
  SpecRevision,
  StatusHistory,
  WorkItem,
} from '@forgeloop/domain';

import type {
  BoundaryAnswerRecord,
  BoundaryDecisionRecord,
  BoundaryQuestionRecord,
  BoundaryRoundRecord,
  DeliveryRepository,
  ReleaseExecutionPackageRecord,
  ReleaseWorkItemRecord,
  TraceArtifactRefRecord,
  TraceEventRecord,
  TraceLinkRecord,
} from '../../packages/db/src/index';

type RepositoryFactory = () => DeliveryRepository | Promise<DeliveryRepository>;

const at = '2026-05-05T00:00:00.000Z';
const later = '2026-05-05T00:01:00.000Z';
const requirementIntakeContext: WorkItem['intake_context'] = {
  type: 'requirement',
  stakeholder_problem: 'Repository users need typed Work Item intake persisted.',
  desired_outcome: 'Work Items round-trip driver identity and intake context.',
  acceptance_criteria: ['Work Item driver and intake context are durable.'],
  in_scope: ['Repository contract fixtures'],
};

const buildManualScopeKey = (scope: {
  object_type: string;
  object_id: string;
  generation_key?: string;
  gate_key?: string;
}): string =>
  scope.object_type === 'package_generation'
    ? `${scope.object_type}:${scope.object_id}:${scope.generation_key}`
    : scope.object_type === 'release_gate'
      ? `${scope.object_type}:${scope.object_id}:${scope.gate_key}`
      : `${scope.object_type}:${scope.object_id}`;

const ids = {
  org: '11111111-1111-4111-8111-111111111111',
  human: '11111111-1111-4111-8111-111111111112',
  system: '11111111-1111-4111-8111-111111111113',
  ai: '11111111-1111-4111-8111-111111111114',
  project: '22222222-2222-4222-8222-222222222221',
  workItem: '33333333-3333-4333-8333-333333333331',
  workItem2: '33333333-3333-4333-8333-333333333332',
  spec: '44444444-4444-4444-8444-444444444441',
  specRevision1: '44444444-4444-4444-8444-444444444442',
  specRevision2: '44444444-4444-4444-8444-444444444443',
  plan: '55555555-5555-4555-8555-555555555551',
  planRevision1: '55555555-5555-4555-8555-555555555552',
  planRevision2: '55555555-5555-4555-8555-555555555553',
  package: '66666666-6666-4666-8666-666666666661',
  dependency: '66666666-6666-4666-8666-666666666662',
  package2: '66666666-6666-4666-8666-666666666663',
  runSession: '77777777-7777-4777-8777-777777777771',
  reviewPacket: '88888888-8888-4888-8888-888888888881',
  release: '99999999-9999-4999-8999-999999999991',
  artifact: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  decision: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  releaseEvidenceReview: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  releaseEvidenceTest: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
  releaseEvidenceObservation: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
  contextManifest: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
  contextManifestRevision: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
  developmentPlan: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
  developmentPlanRevision: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
  developmentPlanSourceLink1: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3',
  developmentPlanSourceLink2: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4',
  developmentPlanRevision2: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
  developmentPlanItem: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
  developmentPlanItemRevision1: 'ffffffff-ffff-4fff-8fff-fffffffffff2',
  developmentPlanItemRevision2: 'ffffffff-ffff-4fff-8fff-fffffffffff3',
  brainstormingSession: '12121212-1212-4212-8212-121212121211',
  brainstormingSessionRevision: '12121212-1212-4212-8212-121212121212',
  boundaryRound: '12121212-1212-4212-8212-121212121213',
  boundarySummary: '13131313-1313-4313-8313-131313131311',
  boundarySummaryRevision: '13131313-1313-4313-8313-131313131312',
  executionPlan: '14141414-1414-4414-8414-141414141411',
  executionPlanRevision: '14141414-1414-4414-8414-141414141412',
  execution: '15151515-1515-4515-8515-151515151511',
};

const requiredCheck = {
  check_id: 'db-contract',
  display_name: 'DB contract',
  command: 'pnpm vitest run tests/db/repository.test.ts',
  timeout_seconds: 120,
  blocks_review: true,
};

const requiredTestGate = {
  gate_id: 'unit-db',
  display_name: 'Database unit tests',
  required_check_ids: [requiredCheck.check_id],
  blocks_release: true,
};

export async function runDeliveryRepositoryContract(repository: DeliveryRepository): Promise<void> {
  const organization: Organization = {
    id: ids.org,
    name: 'ForgeLoop Test Org',
    created_at: at,
    updated_at: at,
  };
  const actors: Actor[] = [
    {
      id: ids.human,
      org_id: ids.org,
      display_name: 'Human Owner',
      actor_type: 'human',
      email: 'owner@example.test',
      created_at: at,
      updated_at: at,
    },
    {
      id: ids.system,
      org_id: ids.org,
      display_name: 'ForgeLoop System',
      actor_type: 'system',
      created_at: at,
      updated_at: at,
    },
    {
      id: ids.ai,
      org_id: ids.org,
      display_name: 'AI Worker',
      actor_type: 'ai',
      created_at: at,
      updated_at: at,
    },
  ];

  await repository.saveOrganization(organization);
  for (const actor of actors) {
    await repository.saveActor(actor);
  }

  expect(await repository.getOrganization(ids.org)).toEqual(organization);
  expect(await repository.getActor(ids.human)).toEqual(actors[0]);
  expect(await repository.listActorsForOrganization(ids.org)).toEqual(actors);

  const project: Project = {
    id: ids.project,
    org_id: ids.org,
    key: 'FORGE',
    name: 'ForgeLoop',
    repo_ids: ['repo-1'],
    owner_actor_id: ids.human,
    created_at: at,
    updated_at: at,
  };
  const projectRepo: ProjectRepo = {
    id: 'project-repo-1',
    repo_id: 'repo-1',
    org_id: ids.org,
    project_id: ids.project,
    name: 'forgeloop',
    status: 'active',
    local_path: '/workspace/forgeloop',
    default_branch: 'main',
    base_commit_sha: 'abc123',
    created_at: at,
    updated_at: at,
  };
  await repository.saveProject(project);
  await repository.saveProjectRepo(projectRepo);

  const workItem: WorkItem = {
    id: ids.workItem,
    project_id: ids.project,
    kind: 'requirement',
    title: 'Ship P1 repository contract',
    narrative_markdown: '',
    goal: 'Persist the release-ready delivery graph.',
    success_criteria: ['Repository contract passes for memory and Drizzle.'],
    priority: 'p1',
    risk: 'medium',
    driver_actor_id: ids.human,
    intake_context: requirementIntakeContext,
    phase: 'release',
    activity_state: 'idle',
    gate_state: 'awaiting_release_approval',
    resolution: 'none',
    current_spec_id: ids.spec,
    current_spec_revision_id: ids.specRevision2,
    current_plan_id: ids.plan,
    current_plan_revision_id: ids.planRevision2,
    current_release_id: ids.release,
    created_at: at,
    updated_at: at,
  };
  const workItem2: WorkItem = {
    ...workItem,
    id: ids.workItem2,
    title: 'Exercise release link order',
    goal: 'Round-trip multiple release links in insertion order.',
    success_criteria: ['Release link arrays preserve order across adapters.'],
  };
  const spec: Spec = {
    id: ids.spec,
    work_item_id: ids.workItem,
    entity_type: 'spec',
    status: 'approved',
    editing_state: 'idle',
    gate_state: 'approved',
    resolution: 'approved',
    current_revision_id: ids.specRevision2,
    approved_revision_id: ids.specRevision2,
    approved_at: later,
    approved_by_actor_id: ids.human,
    created_at: at,
    updated_at: later,
  };
  const specRevision1 = specRevision(ids.specRevision1, 1, 'Initial spec');
  const specRevision2 = specRevision(ids.specRevision2, 2, 'Approved spec');
  const plan: Plan = {
    id: ids.plan,
    work_item_id: ids.workItem,
    entity_type: 'plan',
    status: 'approved',
    editing_state: 'idle',
    gate_state: 'approved',
    resolution: 'approved',
    current_revision_id: ids.planRevision2,
    approved_revision_id: ids.planRevision2,
    approved_at: later,
    approved_by_actor_id: ids.human,
    created_at: at,
    updated_at: later,
  };
  const planRevision1 = planRevision(ids.planRevision1, 1, ids.specRevision1, 'Initial plan');
  const planRevision2 = planRevision(ids.planRevision2, 2, ids.specRevision2, 'Approved plan');

  await repository.saveWorkItem(workItem);
  await repository.saveSpec(spec);
  await repository.saveSpecRevision(specRevision1);
  await repository.saveSpecRevision(specRevision2);
  await repository.savePlan(plan);
  await repository.savePlanRevision(planRevision1);
  await repository.savePlanRevision(planRevision2);
  await repository.saveWorkItem(workItem2);

  expect(await repository.getWorkItem(ids.workItem)).toEqual(workItem);
  expect(await repository.getSpec(ids.spec)).toEqual(spec);
  expect(await repository.listSpecRevisions(ids.spec)).toEqual([specRevision1, specRevision2]);
  expect(await repository.getSpecRevision(ids.specRevision2)).toEqual(specRevision2);
  expect(await repository.getPlan(ids.plan)).toEqual(plan);
  expect(await repository.listPlanRevisions(ids.plan)).toEqual([planRevision1, planRevision2]);
  expect(await repository.getPlanRevision(ids.planRevision2)).toEqual(planRevision2);

  const executionPackage: ExecutionPackage = {
    id: ids.package,
    work_item_id: ids.workItem,
    spec_id: ids.spec,
    spec_revision_id: ids.specRevision2,
    plan_id: ids.plan,
    plan_revision_id: ids.planRevision2,
    project_id: ids.project,
    repo_id: projectRepo.repo_id,
    objective: 'Implement Task 3.',
    owner_actor_id: ids.human,
    reviewer_actor_id: ids.human,
    qa_owner_actor_id: ids.human,
    phase: 'release',
    activity_state: 'idle',
    gate_state: 'release_ready',
    resolution: 'none',
    required_checks: [requiredCheck],
    required_test_gates: [requiredTestGate],
    required_artifact_kinds: ['execution_summary'],
    allowed_paths: ['packages/db/**', 'tests/db/**'],
    forbidden_paths: ['apps/**'],
    source_mutation_policy: 'path_policy_scoped',
    integration_readiness: {
      status: 'ready',
      checked_at: later,
      notes: ['Review approved and DB tests passed.'],
    },
    current_run_session_id: ids.runSession,
    last_run_session_id: ids.runSession,
    current_review_packet_id: ids.reviewPacket,
    current_release_id: ids.release,
    version: 0,
    created_at: at,
    updated_at: later,
  };
  const executionPackage2: ExecutionPackage = {
    ...executionPackage,
    id: ids.package2,
    work_item_id: ids.workItem2,
  };
  await repository.saveExecutionPackage(executionPackage2);
  expect(await repository.getWorkItem(ids.workItem2)).toEqual(workItem2);
  expect(await repository.getExecutionPackage(ids.package2)).toEqual(executionPackage2);
  expect(await repository.listExecutionPackagesForWorkItem(ids.workItem2)).toEqual([executionPackage2]);
  const dependency: ExecutionPackageDependency = {
    package_id: ids.package,
    depends_on_package_id: ids.dependency,
    dependency_type: 'blocks_release',
    reason: 'Shared schema must land first.',
    metadata: { critical_path: true },
    created_at: at,
    updated_at: later,
  };

  await repository.saveExecutionPackage({ ...executionPackage, id: ids.dependency, objective: 'Upstream package.' });
  await repository.saveExecutionPackage(executionPackage);
  await repository.saveExecutionPackageDependency(dependency);

  expect(await repository.getExecutionPackage(ids.package)).toEqual(executionPackage);
  expect(await repository.listExecutionPackagesForWorkItem(ids.workItem)).toEqual([
    { ...executionPackage, id: ids.dependency, objective: 'Upstream package.' },
    executionPackage,
  ]);
  expect(await repository.listExecutionPackageDependencies(ids.package)).toEqual([dependency]);

  const runSession: RunSession = {
    id: ids.runSession,
    execution_package_id: ids.package,
    requested_by_actor_id: ids.human,
    status: 'succeeded',
    executor_type: 'fake',
    changed_files: [{ repo_id: projectRepo.repo_id, path: 'packages/db/src/index.ts', change_kind: 'modified' }],
    check_results: [
      {
        check_id: requiredCheck.check_id,
        command: requiredCheck.command,
        status: 'succeeded',
        exit_code: 0,
        duration_seconds: 1,
        blocks_review: true,
      },
    ],
    artifacts: [artifactRef('execution_summary', 'summary')],
    log_refs: [artifactRef('logs', 'executor log')],
    summary: 'Run succeeded.',
    created_at: at,
    updated_at: later,
    started_at: at,
    finished_at: later,
  };
  const command: RunCommand = {
    id: 'run-command-1',
    run_session_id: ids.runSession,
    command_type: 'continue',
    status: 'pending',
    actor_id: ids.system,
    payload: { prompt: 'continue' },
    created_at: at,
    updated_at: at,
  };

  await repository.saveRunSession(runSession);
  await repository.claimRunWorkerLease({
    run_session_id: ids.runSession,
    worker_id: 'worker-1',
    lease_token: 'lease-1',
    now: at,
    expires_at: '2026-05-05T00:10:00.000Z',
  });
  const event1 = await repository.appendRunEvent(runEvent('run-event-1', 'Run started.', at));
  const event2 = await repository.appendWorkerRunEvent(runEvent('run-event-2', 'Run completed.', later), {
    workerId: 'worker-1',
    leaseToken: 'lease-1',
  });
  await repository.saveRunCommand(command);
  const claimed = await repository.claimNextRunCommand(ids.runSession, 'worker-1', 'lease-1', later);
  await repository.recordRunCommandDriverAck(command.id, { workerId: 'worker-1', leaseToken: 'lease-1' }, { ok: true }, later);
  await repository.markRunCommandApplied(command.id, { workerId: 'worker-1', leaseToken: 'lease-1' }, later, { ok: true });

  expect(await repository.getRunSession(ids.runSession)).toEqual(runSession);
  expect(await repository.listRunEvents(ids.runSession)).toEqual([
    { ...event1, sequence: 1, cursor: '0000000001' },
    { ...event2, sequence: 2, cursor: '0000000002' },
  ]);
  expect(await repository.getLatestRunEvent(ids.runSession)).toEqual({ ...event2, sequence: 2, cursor: '0000000002' });
  expect(claimed?.command).toMatchObject({ id: command.id, status: 'claimed', claimed_by_worker_id: 'worker-1' });
  expect(await repository.getRunWorkerLease(ids.runSession)).toMatchObject({ status: 'active', worker_id: 'worker-1' });

  const reviewPacket: ReviewPacket = {
    id: ids.reviewPacket,
    run_session_id: ids.runSession,
    execution_package_id: ids.package,
    reviewer_actor_id: ids.human,
    spec_revision_id: ids.specRevision2,
    plan_revision_id: ids.planRevision2,
    status: 'completed',
    decision: 'approved',
    summary: 'Approved.',
    changed_files: runSession.changed_files,
    check_result_summary: 'All required checks passed.',
    self_review: {
      status: 'succeeded',
      summary: 'Aligned.',
      spec_plan_alignment: 'Aligned.',
      test_assessment: 'Tests passed.',
      risk_notes: [],
      follow_up_questions: [],
    },
    independent_ai_review: {
      status: 'approved',
      summary: 'Independent review passed.',
      run_session_id: ids.runSession,
      execution_package_id: ids.package,
      risk_notes: [],
    },
    test_mapping: [{ gate_id: requiredCheck.check_id, result: 'passed', evidence_ref: `run-check:${requiredCheck.check_id}` }],
    risk_notes: ['Watch migration reset behavior.'],
    reviewed_by_actor_id: ids.human,
    reviewed_at: later,
    requested_changes: [],
    created_at: at,
    updated_at: later,
    completed_at: later,
  };
  await repository.saveReviewPacket(reviewPacket);
  expect(await repository.getReviewPacket(ids.reviewPacket)).toEqual(reviewPacket);
  expect(await repository.listReviewPacketsForPackage(ids.package)).toEqual([reviewPacket]);
  expect(await repository.findOpenReviewPacketForPackage(ids.package)).toBeUndefined();

  const release: Release = {
    id: ids.release,
    org_id: ids.org,
    project_id: ids.project,
    key: 'REL-1',
    title: 'Task 3 Release',
    phase: 'candidate',
    activity_state: 'idle',
    gate_state: 'approved',
    resolution: 'none',
    work_item_ids: [ids.workItem2, ids.workItem],
    execution_package_ids: [ids.package2, ids.package],
    current_review_packet_ids: [ids.reviewPacket],
    current_run_session_ids: [ids.runSession],
    rollout_strategy: 'Manual local rollout.',
    rollback_plan: 'Revert the branch.',
    observation_plan: 'Watch tests.',
    release_owner_actor_id: ids.human,
    release_type: 'normal',
    visibility: 'internal',
    labels: ['task-3'],
    created_by_actor_id: ids.human,
    created_at: at,
    updated_at: later,
    updated_by_actor_id: ids.human,
  };
  const releaseWorkItem: ReleaseWorkItemRecord = { release_id: ids.release, work_item_id: ids.workItem };
  const releaseWorkItem2: ReleaseWorkItemRecord = { release_id: ids.release, work_item_id: ids.workItem2 };
  const releaseExecutionPackage: ReleaseExecutionPackageRecord = {
    release_id: ids.release,
    execution_package_id: ids.package,
  };
  const releaseExecutionPackage2: ReleaseExecutionPackageRecord = {
    release_id: ids.release,
    execution_package_id: ids.package2,
  };
  await repository.saveRelease(release);
  await repository.saveReleaseWorkItem(releaseWorkItem);
  await repository.saveReleaseWorkItem(releaseWorkItem2);
  await repository.saveReleaseExecutionPackage(releaseExecutionPackage);
  await repository.saveReleaseExecutionPackage(releaseExecutionPackage2);

  const artifact: Artifact = {
    id: ids.artifact,
    object_type: 'run_session',
    object_id: ids.runSession,
    artifact_type: 'test_report',
    ref: artifactRef('test_report', 'db test report'),
    created_at: at,
  };
  const evidences: ReleaseEvidence[] = [
    {
      id: ids.releaseEvidenceReview,
      org_id: ids.org,
      project_id: ids.project,
      release_id: ids.release,
      key: 'REL-1-review-packet',
      evidence_type: 'review_packet',
      summary: 'Approved review packet.',
      object_ref: { object_type: 'review_packet', object_id: ids.reviewPacket, relationship: 'supports' },
      redacted: false,
      status: 'current',
      visibility: 'internal',
      labels: ['review'],
      created_at: at,
      created_by_actor_id: ids.human,
      updated_at: at,
      updated_by_actor_id: ids.human,
    },
    {
      id: ids.releaseEvidenceTest,
      org_id: ids.org,
      project_id: ids.project,
      release_id: ids.release,
      key: 'REL-1-test-report',
      evidence_type: 'test_report',
      summary: 'Required tests passed.',
      artifact_id: ids.artifact,
      object_ref: { object_type: 'artifact', object_id: ids.artifact, relationship: 'generated_by' },
      redacted: false,
      status: 'current',
      visibility: 'internal',
      labels: ['test'],
      created_at: later,
      created_by_actor_id: ids.human,
      updated_at: later,
      updated_by_actor_id: ids.human,
    },
    {
      id: ids.releaseEvidenceObservation,
      org_id: ids.org,
      project_id: ids.project,
      release_id: ids.release,
      key: 'REL-1-observation',
      evidence_type: 'observation_note',
      summary: 'No regressions observed.',
      extra: { window: '1h' },
      redacted: false,
      status: 'current',
      visibility: 'internal',
      labels: ['observation'],
      created_at: '2026-05-05T00:02:00.000Z',
      created_by_actor_id: ids.human,
      updated_at: '2026-05-05T00:02:00.000Z',
      updated_by_actor_id: ids.human,
    },
  ];
  await repository.saveArtifact(artifact);
  for (const evidence of evidences) {
    await repository.saveReleaseEvidence(evidence);
  }

  expect(await repository.getRelease(ids.release)).toEqual(release);
  expect(await repository.listReleases(ids.project)).toEqual([release]);
  expect(await repository.listReleases()).toEqual([release]);
  expect(await repository.listReleaseWorkItems(ids.release)).toEqual([releaseWorkItem2, releaseWorkItem]);
  expect(await repository.listReleaseExecutionPackages(ids.release)).toEqual([
    releaseExecutionPackage2,
    releaseExecutionPackage,
  ]);
  expect(await repository.getReleaseEvidence(ids.releaseEvidenceReview)).toEqual(evidences[0]);
  expect(await repository.listReleaseEvidences(ids.release)).toEqual(evidences);

  const updatedRelease: Release = {
    ...release,
    work_item_ids: [ids.workItem],
    execution_package_ids: [ids.package, ids.package2],
    updated_at: '2026-05-05T00:03:00.000Z',
    updated_by_actor_id: ids.system,
  };
  await repository.saveRelease(updatedRelease);
  expect(await repository.getRelease(ids.release)).toEqual(updatedRelease);
  expect(await repository.listReleaseWorkItems(ids.release)).toEqual([releaseWorkItem]);
  expect(await repository.listReleaseExecutionPackages(ids.release)).toEqual([
    releaseExecutionPackage,
    releaseExecutionPackage2,
  ]);

  const objectEvent: ObjectEvent = {
    id: 'object-event-1',
    object_type: 'release',
    object_id: ids.release,
    event_type: 'approved',
    actor_id: ids.human,
    actor_type: 'human',
    reason: 'Review approved.',
    payload: { review_packet_id: ids.reviewPacket },
    metadata: { old_payload: false },
    created_at: at,
  };
  const statusHistory: StatusHistory = {
    id: 'status-history-1',
    object_type: 'release',
    object_id: ids.release,
    field_name: 'gate_state',
    from_value: 'awaiting_approval',
    to_value: 'approved',
    actor_id: ids.human,
    actor_type: 'human',
    reason: 'Human approved.',
    context: { review_packet_id: ids.reviewPacket },
    created_at: later,
  };
  const decision: Decision = {
    id: ids.decision,
    object_type: 'release',
    object_id: ids.release,
    decision_type: 'release_approval',
    outcome: 'approved',
    actor_id: ids.human,
    decided_by_actor_id: ids.human,
    rationale: 'All blockers resolved.',
    evidence_refs: [{ object_type: 'review_packet', object_id: ids.reviewPacket }],
    decision: 'approved',
    summary: 'Release approved.',
    created_at: later,
  };
  await repository.appendObjectEvent(objectEvent);
  await repository.appendStatusHistory(statusHistory);
  await repository.saveDecision(decision);
  expect(await repository.listObjectEvents(ids.release, 'release')).toEqual([objectEvent]);
  expect(await repository.listStatusHistory(ids.release, 'release')).toEqual([statusHistory]);
  expect(await repository.listArtifactsForObject('run_session', ids.runSession)).toEqual([artifact]);
  expect(await repository.listDecisionsForObject('release', ids.release)).toEqual([decision]);

  const traceEvent: TraceEventRecord = {
    id: 'trace-event-1',
    event_type: 'release_evidence_linked',
    subject_type: 'release',
    subject_id: ids.release,
    actor_id: ids.system,
    summary: 'Release evidence links package, run, review, and artifact.',
    payload: { release_id: ids.release, execution_package_id: ids.package },
    created_at: at,
  };
  const traceLinks: TraceLinkRecord[] = [
    traceLink('trace-link-1', traceEvent.id, 'belongs_to', 'release', ids.release, at),
    traceLink('trace-link-2', traceEvent.id, 'supports', 'execution_package', ids.package, later),
    traceLink('trace-link-3', traceEvent.id, 'generated_by', 'run_session', ids.runSession, later),
    traceLink('trace-link-4', traceEvent.id, 'replaces', 'review_packet', ids.reviewPacket, later),
  ];
  const traceArtifactRef: TraceArtifactRefRecord = {
    id: 'trace-artifact-ref-1',
    trace_event_id: traceEvent.id,
    artifact_id: ids.artifact,
    ref: artifact.ref,
    created_at: later,
  };
  await repository.saveTraceEvent(traceEvent);
  for (const link of traceLinks) {
    await repository.saveTraceLink(link);
  }
  await repository.saveTraceArtifactRef(traceArtifactRef);
  expect(await repository.listTraceEventsForSubject('release', ids.release)).toEqual([traceEvent]);
  expect(await repository.listTraceLinks(traceEvent.id)).toEqual(traceLinks);
  expect(await repository.listTraceArtifactRefs(traceEvent.id)).toEqual([traceArtifactRef]);

  await expectAutomationRepositoryContract(repository);
}

export function itPersistsAiNativePlanningGraph(factory: RepositoryFactory): void {
  it('persists Development Plan, Item, brainstorming, boundary, execution plan, and execution linkage', async () => {
    const repository = await factory();

    await repository.saveOrganization({
      id: ids.org,
      name: 'ForgeLoop Test Org',
      created_at: at,
      updated_at: at,
    });
    await repository.saveActor({
      id: ids.human,
      org_id: ids.org,
      display_name: 'Human Driver',
      actor_type: 'human',
      created_at: at,
      updated_at: at,
    });
    await repository.saveProject({
      id: ids.project,
      org_id: ids.org,
      key: 'FORGE',
      name: 'ForgeLoop',
      repo_ids: ['repo-1'],
      owner_actor_id: ids.human,
      created_at: at,
      updated_at: at,
    });

    await repository.saveContextManifest(contextManifestFixture());
    await repository.saveDevelopmentPlan(developmentPlanFixture());
    await repository.saveDevelopmentPlanRevision(developmentPlanRevisionFixture());
    await repository.saveDevelopmentPlanSourceLink({
      id: ids.developmentPlanSourceLink1,
      development_plan_id: ids.developmentPlan,
      source_ref: { type: 'requirement', id: ids.workItem, revision_id: ids.specRevision1 },
      link_type: 'primary',
      created_by_actor_id: ids.human,
      created_at: '2026-05-24T00:00:00.000Z',
    });
    await repository.saveDevelopmentPlanSourceLink({
      id: ids.developmentPlanSourceLink2,
      development_plan_id: ids.developmentPlan,
      source_ref: { type: 'bug', id: ids.workItem2, revision_id: ids.specRevision2 },
      link_type: 'related',
      created_by_actor_id: ids.human,
      created_at: '2026-05-24T00:01:00.000Z',
    });
    await repository.saveDevelopmentPlanItem(developmentPlanItemFixture());
    await repository.saveDevelopmentPlanItemRevision(
      developmentPlanItemRevisionFixture({
        id: ids.developmentPlanItemRevision1,
        revision_number: 1,
        snapshot: developmentPlanItemFixture({
          boundary_status: 'not_started',
          next_action: 'Start boundary brainstorming.',
        }),
        change_reason: 'Initial generated row',
        created_at: '2026-05-24T00:02:00.000Z',
      }),
    );
    await repository.saveDevelopmentPlanItemRevision(
      developmentPlanItemRevisionFixture({
        id: ids.developmentPlanItemRevision2,
        revision_number: 2,
        snapshot: developmentPlanItemFixture({
          revision_id: ids.developmentPlanItemRevision2,
          boundary_status: 'approved',
          next_action: 'Generate Spec from approved boundary.',
          updated_at: '2026-05-24T00:03:00.000Z',
        }),
        change_reason: 'Boundary refinement',
        created_at: '2026-05-24T00:03:00.000Z',
      }),
    );
    await repository.saveDevelopmentPlanRevision(
      developmentPlanRevisionFixture({
        id: ids.developmentPlanRevision2,
        revision_number: 2,
        generation_state: 'draft_generated',
        change_reason: 'development_plan_draft_generated',
        item_refs: [
          {
            id: ids.developmentPlanItem,
            revision_id: ids.developmentPlanItemRevision2,
            title: 'Persist planning graph',
            boundary_status: 'approved',
            spec_status: 'approved',
            execution_plan_status: 'approved',
            execution_status: 'ready',
          },
        ],
        created_at: '2026-05-24T00:03:30.000Z',
      }),
    );
    await repository.saveBrainstormingSession(brainstormingSessionFixture());
    await repository.saveBoundaryRound(boundaryRoundFixture());
    await repository.saveBoundaryQuestion(boundaryQuestionFixture());
    await repository.saveBoundaryAnswer(boundaryAnswerFixture());
    await repository.saveBoundaryDecision(boundaryDecisionFixture());
    await repository.saveBoundarySummary(boundarySummaryFixture());
    await repository.saveBoundarySummaryRevision(boundarySummaryRevisionFixture());
    await repository.saveSpec(
      specFixture({
        id: ids.spec,
        development_plan_item_id: ids.developmentPlanItem,
        boundary_summary_id: ids.boundarySummary,
        context_manifest_id: ids.contextManifest,
      }),
    );
    await repository.saveSpecRevision(
      specRevisionFixture({
        id: ids.specRevision1,
        spec_id: ids.spec,
        development_plan_item_id: ids.developmentPlanItem,
        boundary_summary_id: ids.boundarySummary,
        context_manifest_id: ids.contextManifest,
      }),
    );
    await repository.saveExecutionPlan(executionPlanFixture());
    await repository.saveExecutionPlanRevision(executionPlanRevisionFixture());
    await repository.saveExecution(executionFixture());
    await repository.saveExecutionPackage(executionPackageFixture());

    expect(await repository.getContextManifest(ids.contextManifest)).toEqual(contextManifestFixture());
    expect(await repository.getDevelopmentPlan(ids.developmentPlan)).toEqual(
      developmentPlanFixture({ items: [developmentPlanItemFixture()] }),
    );
    expect(await repository.listDevelopmentPlans(ids.project)).toEqual([
      developmentPlanFixture({ items: [developmentPlanItemFixture()] }),
    ]);
    expect(await repository.getDevelopmentPlanItem(ids.developmentPlanItem)).toMatchObject({
      id: ids.developmentPlanItem,
      development_plan_id: ids.developmentPlan,
    });
    expect(await repository.listDevelopmentPlanItems(ids.developmentPlan)).toEqual([developmentPlanItemFixture()]);
    expect(await repository.listDevelopmentPlanSourceLinksForSource({ type: 'bug', id: ids.workItem2 })).toEqual([
      expect.objectContaining({ development_plan_id: ids.developmentPlan, link_type: 'related' }),
    ]);
    expect(await repository.listDevelopmentPlanSourceLinks(ids.developmentPlan)).toHaveLength(2);
    expect(await repository.listDevelopmentPlanRevisions(ids.developmentPlan)).toEqual([
      developmentPlanRevisionFixture(),
      developmentPlanRevisionFixture({
        id: ids.developmentPlanRevision2,
        revision_number: 2,
        generation_state: 'draft_generated',
        change_reason: 'development_plan_draft_generated',
        item_refs: [
          {
            id: ids.developmentPlanItem,
            revision_id: ids.developmentPlanItemRevision2,
            title: 'Persist planning graph',
            boundary_status: 'approved',
            spec_status: 'approved',
            execution_plan_status: 'approved',
            execution_status: 'ready',
          },
        ],
        created_at: '2026-05-24T00:03:30.000Z',
      }),
    ]);
    expect(await repository.listDevelopmentPlanItemRevisions(ids.developmentPlanItem)).toEqual([
      expect.objectContaining({ id: ids.developmentPlanItemRevision1, revision_number: 1 }),
      expect.objectContaining({ id: ids.developmentPlanItemRevision2, revision_number: 2 }),
    ]);
    expect(
      await repository.compareDevelopmentPlanItemRevisions({
        base_revision_id: ids.developmentPlanItemRevision1,
        compare_revision_id: ids.developmentPlanItemRevision2,
      }),
    ).toMatchObject({
      base_revision_id: ids.developmentPlanItemRevision1,
      compare_revision_id: ids.developmentPlanItemRevision2,
      changed_fields: expect.arrayContaining(['boundary_status', 'next_action', 'revision_id', 'updated_at']),
    });
    expect(await repository.getBrainstormingSession(ids.brainstormingSession)).toEqual(brainstormingSessionFixture());
    expect(await repository.listBoundaryRounds(ids.brainstormingSession)).toEqual([boundaryRoundFixture()]);
    expect(await repository.listBoundaryQuestions(ids.brainstormingSession)).toEqual([boundaryQuestionFixture()]);
    expect(await repository.listBoundaryAnswers(ids.brainstormingSession)).toEqual([boundaryAnswerFixture()]);
    expect(await repository.listBoundaryDecisions(ids.brainstormingSession)).toEqual([boundaryDecisionFixture()]);
    expect(await repository.getBoundarySummary(ids.boundarySummary)).toMatchObject({
      development_plan_item_id: ids.developmentPlanItem,
    });
    expect(await repository.listBoundarySummaryRevisions(ids.boundarySummary)).toEqual([
      expect.objectContaining({
        id: ids.boundarySummaryRevision,
        revision_number: 1,
        development_plan_item_revision_id: ids.developmentPlanItemRevision2,
      }),
    ]);
    expect(
      await repository.compareBoundarySummaryRevisions({
        base_revision_id: ids.boundarySummaryRevision,
        compare_revision_id: ids.boundarySummaryRevision,
      }),
    ).toMatchObject({
      base_revision_id: ids.boundarySummaryRevision,
      compare_revision_id: ids.boundarySummaryRevision,
      changed_fields: [],
    });

    await repository.saveBoundarySummaryRevision(
      boundarySummaryRevisionFixture({
        id: '15151515-1515-4515-8515-151515151515',
        revision_number: 2,
        development_plan_item_revision_id: ids.developmentPlanItemRevision2,
        summary_markdown: 'Task 2 scope is approved after narrowed validation.',
        decision_count: 2,
        created_at: '2026-05-24T00:05:00.000Z',
      }),
    );
    expect(
      await repository.compareBoundarySummaryRevisions({
        base_revision_id: ids.boundarySummaryRevision,
        compare_revision_id: '15151515-1515-4515-8515-151515151515',
      }),
    ).toMatchObject({
      base_revision_id: ids.boundarySummaryRevision,
      compare_revision_id: '15151515-1515-4515-8515-151515151515',
      changed_fields: expect.arrayContaining(['summary_markdown', 'decision_count', 'revision_number', 'created_at']),
    });
    expect(await repository.getExecutionPlan(ids.executionPlan)).toEqual(executionPlanFixture());
    expect(await repository.getExecutionPlanRevision(ids.executionPlanRevision)).toEqual(executionPlanRevisionFixture());
    expect(await repository.listExecutionPlanRevisions(ids.executionPlan)).toEqual([executionPlanRevisionFixture()]);
    expect(await repository.getExecution(ids.execution)).toMatchObject({
      execution_plan_revision_id: ids.executionPlanRevision,
    });
    expect(await repository.getExecutionPackage(ids.package)).toMatchObject({
      development_plan_item_id: ids.developmentPlanItem,
      execution_plan_id: ids.executionPlan,
      execution_plan_revision_id: ids.executionPlanRevision,
    });
  });

  it('backfills Boundary Brainstorming leadership defaults and summary revision eligibility', async () => {
    const repository = await factory();
    const reviewerItemId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const reviewerItemRevisionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    const driverItemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
    const driverItemRevisionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
    const blockedItemId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
    const blockedItemRevisionId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
    const storedLeaderItemId = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
    const storedLeaderItemRevisionId = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
    const reviewerSessionId = 'edededed-eded-4ded-8ded-ededededed01';
    const multiRoundSessionId = 'edededed-eded-4ded-8ded-ededededed00';
    const storedLeaderSessionId = 'edededed-eded-4ded-8ded-ededededed02';
    const summarySessionId = 'edededed-eded-4ded-8ded-ededededed03';
    const unsafeSummaryId = 'edededed-eded-4ded-8ded-ededededed04';
    const unsafeRevisionId = 'edededed-eded-4ded-8ded-ededededed05';
    const safeSummarySessionId = 'edededed-eded-4ded-8ded-ededededed06';
    const safeSummaryId = 'edededed-eded-4ded-8ded-ededededed07';
    const safeRevisionId = 'edededed-eded-4ded-8ded-ededededed08';
    const safeRoundId = 'contract-safe-round';

    await repository.saveOrganization({
      id: ids.org,
      name: 'ForgeLoop Test Org',
      created_at: at,
      updated_at: at,
    });
    await repository.saveActor({
      id: ids.human,
      org_id: ids.org,
      display_name: 'Human Reviewer',
      actor_type: 'human',
      created_at: at,
      updated_at: at,
    });
    await repository.saveActor({
      id: ids.system,
      org_id: ids.org,
      display_name: 'Driver Actor',
      actor_type: 'system',
      created_at: at,
      updated_at: at,
    });
    await repository.saveActor({
      id: ids.ai,
      org_id: ids.org,
      display_name: 'Stored Boundary Leader',
      actor_type: 'ai',
      created_at: at,
      updated_at: at,
    });
    await repository.saveProject({
      id: ids.project,
      org_id: ids.org,
      key: 'FORGE',
      name: 'ForgeLoop',
      repo_ids: ['repo-1'],
      owner_actor_id: ids.human,
      created_at: at,
      updated_at: at,
    });
    await repository.saveDevelopmentPlan(developmentPlanFixture());

    await repository.saveDevelopmentPlanItem(
      developmentPlanItemFixture({
        id: reviewerItemId,
        revision_id: reviewerItemRevisionId,
        reviewer_actor_id: ids.human,
        driver_actor_id: ids.system,
        leader_actor_id: undefined,
      }),
    );
    await repository.saveDevelopmentPlanItem(
      developmentPlanItemFixture({
        id: driverItemId,
        revision_id: driverItemRevisionId,
        reviewer_actor_id: undefined,
        driver_actor_id: ids.system,
        leader_actor_id: undefined,
      }),
    );
    await repository.saveDevelopmentPlanItem(
      developmentPlanItemFixture({
        id: blockedItemId,
        revision_id: blockedItemRevisionId,
        reviewer_actor_id: undefined,
        driver_actor_id: undefined,
        leader_actor_id: undefined,
      }),
    );
    await repository.saveDevelopmentPlanItem(
      developmentPlanItemFixture({
        id: storedLeaderItemId,
        revision_id: storedLeaderItemRevisionId,
        reviewer_actor_id: ids.human,
        driver_actor_id: ids.system,
        leader_actor_id: ids.ai,
        leader_delegate_actor_ids: [ids.system],
      }),
    );

    await repository.saveBrainstormingSession(
      legacyBoundarySessionFixture({
        id: reviewerSessionId,
        revision_id: 'edededed-eded-4ded-8ded-ededededed11',
        development_plan_item_id: reviewerItemId,
        development_plan_item_revision_id: reviewerItemRevisionId,
        questions: [
          {
            id: 'contract-legacy-question',
            text: 'Who leads this boundary?',
            author_id: ids.ai,
            status: 'open',
            required: true,
            created_at: at,
          },
        ],
      }),
    );
    await repository.saveBrainstormingSession(
      legacyBoundarySessionFixture({
        id: multiRoundSessionId,
        revision_id: 'edededed-eded-4ded-8ded-ededededed10',
        development_plan_item_id: reviewerItemId,
        development_plan_item_revision_id: reviewerItemRevisionId,
        questions: [
          {
            id: 'contract-multi-question',
            text: 'Which existing round should receive legacy evidence?',
            author_id: ids.ai,
            status: 'resolved',
            required: false,
            answered_by_answer_id: 'contract-multi-answer',
            created_at: at,
          },
        ],
        answers: [
          {
            id: 'contract-multi-answer',
            question_id: 'contract-multi-question',
            text: 'Use the latest round.',
            actor_id: ids.human,
            actor_role: 'leader',
            created_at: at,
          },
        ],
        decisions: [
          {
            id: 'contract-multi-decision',
            text: 'Attach legacy arrays to the latest round when current_round_id is absent.',
            actor_id: ids.human,
            actor_role: 'leader',
            source: 'leader',
            state: 'accepted',
            created_at: at,
          },
        ],
      }),
    );
    await repository.saveBoundaryRound(
      boundaryRoundFixture({
        id: 'contract-multi-round-1',
        session_id: multiRoundSessionId,
        session_revision_id: 'edededed-eded-4ded-8ded-ededededed10',
        round_number: 1,
      }),
    );
    await repository.saveBoundaryRound(
      boundaryRoundFixture({
        id: 'contract-multi-round-2',
        session_id: multiRoundSessionId,
        session_revision_id: 'edededed-eded-4ded-8ded-ededededed10',
        round_number: 2,
      }),
    );
    await repository.saveBrainstormingSession(
      legacyBoundarySessionFixture({
        id: storedLeaderSessionId,
        revision_id: 'edededed-eded-4ded-8ded-ededededed12',
        development_plan_item_id: storedLeaderItemId,
        development_plan_item_revision_id: storedLeaderItemRevisionId,
      }),
    );

    const leaderBackfill = await repository.backfillBoundaryLeaderDefaults({ now: later });

    await expect(repository.getDevelopmentPlanItem(reviewerItemId)).resolves.toMatchObject({
      leader_actor_id: ids.human,
      leader_delegate_actor_ids: [],
    });
    await expect(repository.getDevelopmentPlanItem(driverItemId)).resolves.toMatchObject({
      leader_actor_id: ids.system,
      leader_delegate_actor_ids: [],
    });
    expect((await repository.getDevelopmentPlanItem(blockedItemId))?.leader_actor_id).toBeUndefined();
    await expect(repository.getBrainstormingSession(storedLeaderSessionId)).resolves.toMatchObject({
      leader_actor_id: ids.ai,
      leader_delegate_actor_ids: [ids.system],
      current_round_id: `${storedLeaderSessionId}-round-1`,
    });
    expect(await repository.listBoundaryRounds(reviewerSessionId)).toEqual([
      expect.objectContaining({ id: `${reviewerSessionId}-round-1`, round_number: 1, trigger: 'start' }),
    ]);
    expect(await repository.listBoundaryQuestions(reviewerSessionId)).toEqual([
      expect.objectContaining({ id: 'contract-legacy-question', round_id: `${reviewerSessionId}-round-1` }),
    ]);
    await expect(repository.getBrainstormingSession(multiRoundSessionId)).resolves.toMatchObject({
      leader_actor_id: ids.human,
      current_round_id: 'contract-multi-round-2',
    });
    expect(await repository.listBoundaryQuestions(multiRoundSessionId)).toEqual([
      expect.objectContaining({ id: 'contract-multi-question', round_id: 'contract-multi-round-2' }),
    ]);
    expect(await repository.listBoundaryAnswers(multiRoundSessionId)).toEqual([
      expect.objectContaining({ id: 'contract-multi-answer', round_id: 'contract-multi-round-2' }),
    ]);
    expect(await repository.listBoundaryDecisions(multiRoundSessionId)).toEqual([
      expect.objectContaining({ id: 'contract-multi-decision', round_id: 'contract-multi-round-2' }),
    ]);
    expect(leaderBackfill).toEqual({
      updated_item_ids: [reviewerItemId, driverItemId],
      updated_session_ids: [multiRoundSessionId, reviewerSessionId, storedLeaderSessionId],
      blocked_item_ids: [blockedItemId],
    });

    await repository.saveBrainstormingSession(
      legacyBoundarySessionFixture({
        id: summarySessionId,
        revision_id: 'edededed-eded-4ded-8ded-ededededed13',
        development_plan_item_id: reviewerItemId,
        development_plan_item_revision_id: reviewerItemRevisionId,
        leader_actor_id: ids.human,
        leader_delegate_actor_ids: [],
        status: 'approved',
        approval_state: 'approved',
        boundary_summary_id: unsafeSummaryId,
        approver_actor_id: ids.human,
        approved_at: at,
      }),
    );
    await repository.saveBoundarySummary(
      boundarySummaryFixture({
        id: unsafeSummaryId,
        revision_id: unsafeRevisionId,
        brainstorming_session_id: summarySessionId,
        brainstorming_session_revision_id: 'edededed-eded-4ded-8ded-ededededed13',
        development_plan_item_id: reviewerItemId,
        development_plan_item_revision_id: reviewerItemRevisionId,
      }),
    );
    const unsafeRevision = boundarySummaryRevisionFixture({
      id: unsafeRevisionId,
      boundary_summary_id: unsafeSummaryId,
      brainstorming_session_id: summarySessionId,
      brainstorming_session_revision_id: 'edededed-eded-4ded-8ded-ededededed13',
      development_plan_item_id: reviewerItemId,
      development_plan_item_revision_id: reviewerItemRevisionId,
      decision_snapshot: [],
      decision_count: 0,
    });
    delete (unsafeRevision as Record<string, unknown>).source_round_id;
    delete (unsafeRevision as Record<string, unknown>).development_plan_id;
    delete (unsafeRevision as Record<string, unknown>).status;
    delete (unsafeRevision as Record<string, unknown>).confirmed_scope;
    delete (unsafeRevision as Record<string, unknown>).confirmed_out_of_scope;
    delete (unsafeRevision as Record<string, unknown>).accepted_assumptions;
    delete (unsafeRevision as Record<string, unknown>).open_risks;
    delete (unsafeRevision as Record<string, unknown>).validation_expectations;
    delete (unsafeRevision as Record<string, unknown>).question_answer_snapshot;
    delete (unsafeRevision as Record<string, unknown>).context_manifest_id;
    delete (unsafeRevision as Record<string, unknown>).context_manifest_revision_id;
    await repository.saveBoundarySummaryRevision(unsafeRevision);

    const revisionBackfill = await repository.backfillBoundarySummaryRevisionEligibility({
      session_id: summarySessionId,
      boundary_summary_id: unsafeSummaryId,
      now: later,
    });

    await expect(repository.listBoundarySummaryRevisions(unsafeSummaryId)).resolves.toEqual([
      expect.objectContaining({ id: unsafeRevisionId, status: 'draft' }),
    ]);
    await expect(repository.getBrainstormingSession(summarySessionId)).resolves.not.toHaveProperty('approved_summary_revision_id');
    expect(revisionBackfill).toEqual({
      downgraded_revision_ids: [unsafeRevisionId],
      approved_revision_ids: [],
    });

    const revisionBackfillAgain = await repository.backfillBoundarySummaryRevisionEligibility({
      session_id: summarySessionId,
      boundary_summary_id: unsafeSummaryId,
      now: '2026-05-24T00:08:00.000Z',
    });

    await expect(repository.getBrainstormingSession(summarySessionId)).resolves.toMatchObject({
      updated_at: later,
    });
    expect(revisionBackfillAgain).toEqual({
      downgraded_revision_ids: [],
      approved_revision_ids: [],
    });

    await repository.saveBrainstormingSession(
      legacyBoundarySessionFixture({
        id: safeSummarySessionId,
        revision_id: 'edededed-eded-4ded-8ded-ededededed14',
        development_plan_item_id: reviewerItemId,
        development_plan_item_revision_id: reviewerItemRevisionId,
        leader_actor_id: ids.human,
        leader_delegate_actor_ids: [],
        status: 'approved',
        current_round_id: safeRoundId,
        latest_summary_revision_id: safeRevisionId,
        approved_summary_revision_id: safeRevisionId,
        approval_state: 'approved',
        boundary_summary_id: safeSummaryId,
        approver_actor_id: ids.human,
        approved_at: at,
        updated_at: at,
      }),
    );
    await repository.saveBoundaryRound(
      boundaryRoundFixture({
        id: safeRoundId,
        session_id: safeSummarySessionId,
        session_revision_id: 'edededed-eded-4ded-8ded-ededededed14',
        round_number: 1,
      }),
    );
    await repository.saveBoundaryQuestion(
      boundaryQuestionFixture({
        id: 'contract-safe-question',
        session_id: safeSummarySessionId,
        round_id: safeRoundId,
        answered_by_answer_id: 'contract-safe-answer',
      }),
    );
    await repository.saveBoundaryAnswer(
      boundaryAnswerFixture({
        id: 'contract-safe-answer',
        session_id: safeSummarySessionId,
        round_id: safeRoundId,
        question_id: 'contract-safe-question',
      }),
    );
    await repository.saveBoundaryDecision(
      boundaryDecisionFixture({
        id: 'contract-safe-decision',
        session_id: safeSummarySessionId,
        round_id: safeRoundId,
      }),
    );
    await repository.saveBoundarySummary(
      boundarySummaryFixture({
        id: safeSummaryId,
        revision_id: safeRevisionId,
        brainstorming_session_id: safeSummarySessionId,
        brainstorming_session_revision_id: 'edededed-eded-4ded-8ded-ededededed14',
        development_plan_item_id: reviewerItemId,
        development_plan_item_revision_id: reviewerItemRevisionId,
      }),
    );
    await repository.saveBoundarySummaryRevision(
      boundarySummaryRevisionFixture({
        id: safeRevisionId,
        boundary_summary_id: safeSummaryId,
        brainstorming_session_id: safeSummarySessionId,
        brainstorming_session_revision_id: 'edededed-eded-4ded-8ded-ededededed14',
        source_round_id: safeRoundId,
        development_plan_item_id: reviewerItemId,
        development_plan_item_revision_id: reviewerItemRevisionId,
        question_answer_snapshot: [
          { question_id: 'contract-safe-question', answer_id: 'contract-safe-answer', text: boundaryAnswerFixture().text },
        ],
        decision_snapshot: [{ decision_id: 'contract-safe-decision', text: boundaryDecisionFixture().text }],
      }),
    );

    const safeRevisionBackfill = await repository.backfillBoundarySummaryRevisionEligibility({
      session_id: safeSummarySessionId,
      boundary_summary_id: safeSummaryId,
      now: later,
    });
    const safeRevisionBackfillAgain = await repository.backfillBoundarySummaryRevisionEligibility({
      session_id: safeSummarySessionId,
      boundary_summary_id: safeSummaryId,
      now: '2026-05-24T00:08:00.000Z',
    });

    await expect(repository.getBrainstormingSession(safeSummarySessionId)).resolves.toMatchObject({
      updated_at: at,
      latest_summary_revision_id: safeRevisionId,
      approved_summary_revision_id: safeRevisionId,
    });
    expect(safeRevisionBackfill).toEqual({
      downgraded_revision_ids: [],
      approved_revision_ids: [],
    });
    expect(safeRevisionBackfillAgain).toEqual({
      downgraded_revision_ids: [],
      approved_revision_ids: [],
    });
  });

  it('commits AI-native planning graph writes made inside delivery transactions', async () => {
    const repository = await factory();

    await repository.withDeliveryTransaction(async (transaction) => {
      await transaction.saveOrganization({
        id: ids.org,
        name: 'ForgeLoop Test Org',
        created_at: at,
        updated_at: at,
      });
      await transaction.saveActor({
        id: ids.human,
        org_id: ids.org,
        display_name: 'Human Driver',
        actor_type: 'human',
        created_at: at,
        updated_at: at,
      });
      await transaction.saveProject({
        id: ids.project,
        org_id: ids.org,
        key: 'FORGE',
        name: 'ForgeLoop',
        repo_ids: ['repo-1'],
        owner_actor_id: ids.human,
        created_at: at,
        updated_at: at,
      });
      await transaction.saveContextManifest(contextManifestFixture());
      await transaction.saveDevelopmentPlan(developmentPlanFixture());
      await transaction.saveDevelopmentPlanItem(developmentPlanItemFixture());
      await transaction.saveBrainstormingSession(brainstormingSessionFixture());
      await transaction.saveBoundaryRound(boundaryRoundFixture());
      await transaction.saveBoundaryQuestion(boundaryQuestionFixture());
      await transaction.saveBoundaryAnswer(boundaryAnswerFixture());
      await transaction.saveBoundaryDecision(boundaryDecisionFixture());
      await transaction.saveBoundarySummary(boundarySummaryFixture());
      await transaction.saveSpec(specFixture());
      await transaction.saveSpecRevision(specRevisionFixture());
      await transaction.saveExecutionPlan(executionPlanFixture());
      await transaction.saveExecutionPlanRevision(executionPlanRevisionFixture());
      await transaction.saveExecution(executionFixture());

      expect(await transaction.getContextManifest(ids.contextManifest)).toEqual(contextManifestFixture());
      expect(await transaction.getDevelopmentPlan(ids.developmentPlan)).toEqual(
        developmentPlanFixture({ items: [developmentPlanItemFixture()] }),
      );
      expect(await transaction.getBrainstormingSession(ids.brainstormingSession)).toEqual(brainstormingSessionFixture());
      expect(await transaction.listBoundaryRounds(ids.brainstormingSession)).toEqual([boundaryRoundFixture()]);
      expect(await transaction.listBoundaryQuestions(ids.brainstormingSession)).toEqual([boundaryQuestionFixture()]);
      expect(await transaction.listBoundaryAnswers(ids.brainstormingSession)).toEqual([boundaryAnswerFixture()]);
      expect(await transaction.listBoundaryDecisions(ids.brainstormingSession)).toEqual([boundaryDecisionFixture()]);
      expect(await transaction.getExecutionPlan(ids.executionPlan)).toEqual(executionPlanFixture());
      expect(await transaction.getExecutionPlanRevision(ids.executionPlanRevision)).toEqual(executionPlanRevisionFixture());
      expect(await transaction.getExecution(ids.execution)).toEqual(executionFixture());
    });

    expect(await repository.getContextManifest(ids.contextManifest)).toEqual(contextManifestFixture());
    expect(await repository.getDevelopmentPlan(ids.developmentPlan)).toEqual(
      developmentPlanFixture({ items: [developmentPlanItemFixture()] }),
    );
    expect(await repository.getDevelopmentPlanItem(ids.developmentPlanItem)).toEqual(developmentPlanItemFixture());
    expect(await repository.getBrainstormingSession(ids.brainstormingSession)).toEqual(brainstormingSessionFixture());
    expect(await repository.listBoundaryRounds(ids.brainstormingSession)).toEqual([boundaryRoundFixture()]);
    expect(await repository.listBoundaryQuestions(ids.brainstormingSession)).toEqual([boundaryQuestionFixture()]);
    expect(await repository.listBoundaryAnswers(ids.brainstormingSession)).toEqual([boundaryAnswerFixture()]);
    expect(await repository.listBoundaryDecisions(ids.brainstormingSession)).toEqual([boundaryDecisionFixture()]);
    expect(await repository.getBoundarySummary(ids.boundarySummary)).toEqual(boundarySummaryFixture());
    expect(await repository.getExecutionPlan(ids.executionPlan)).toEqual(executionPlanFixture());
    expect(await repository.getExecutionPlanRevision(ids.executionPlanRevision)).toEqual(executionPlanRevisionFixture());
    expect(await repository.getExecution(ids.execution)).toEqual(executionFixture());
  });

  it('keeps AI-native revision histories immutable', async () => {
    const repository = await factory();

    await repository.saveOrganization({
      id: ids.org,
      name: 'ForgeLoop Test Org',
      created_at: at,
      updated_at: at,
    });
    await repository.saveActor({
      id: ids.human,
      org_id: ids.org,
      display_name: 'Human Driver',
      actor_type: 'human',
      created_at: at,
      updated_at: at,
    });
    await repository.saveProject({
      id: ids.project,
      org_id: ids.org,
      key: 'FORGE',
      name: 'ForgeLoop',
      repo_ids: ['repo-1'],
      owner_actor_id: ids.human,
      created_at: at,
      updated_at: at,
    });
    await repository.saveDevelopmentPlan(developmentPlanFixture());
    await repository.saveDevelopmentPlanRevision(developmentPlanRevisionFixture());
    await repository.saveDevelopmentPlanItem(developmentPlanItemFixture());
    await repository.saveBrainstormingSession(brainstormingSessionFixture());
    await repository.saveBoundaryRound(boundaryRoundFixture());
    await repository.saveBoundarySummary(boundarySummaryFixture());
    await repository.saveSpec(specFixture());
    await repository.saveSpecRevision(specRevisionFixture());
    await repository.saveExecutionPlan(executionPlanFixture());

    const developmentPlanRevision = developmentPlanItemRevisionFixture();
    const parentPlanRevision = developmentPlanRevisionFixture({
      id: ids.developmentPlanRevision2,
      revision_number: 2,
      change_reason: 'Current plan state',
    });
    const boundaryRevision = boundarySummaryRevisionFixture();
    const executionRevision = executionPlanRevisionFixture();

    await repository.saveDevelopmentPlanItemRevision(developmentPlanRevision);
    await repository.saveDevelopmentPlanRevision(parentPlanRevision);
    await repository.saveBoundarySummaryRevision(boundaryRevision);
    await repository.saveExecutionPlanRevision(executionRevision);

    await repository.saveDevelopmentPlanItemRevision({
      ...developmentPlanRevision,
      revision_number: 99,
      change_reason: 'Conflicting rewrite',
    });
    await repository.saveDevelopmentPlanRevision({
      ...parentPlanRevision,
      revision_number: 99,
      change_reason: 'Conflicting rewrite',
    });
    await repository.saveBoundarySummaryRevision({
      ...boundaryRevision,
      revision_number: 99,
      summary_markdown: 'Conflicting rewrite',
    });
    await repository.saveExecutionPlanRevision({
      ...executionRevision,
      revision_number: 99,
      content: 'Conflicting rewrite',
    });

    await repository.saveDevelopmentPlanItemRevision({
      ...developmentPlanRevision,
      id: 'ffffffff-ffff-4fff-8fff-fffffffffff4',
      change_reason: 'Duplicate logical revision',
    });
    await repository.saveDevelopmentPlanRevision({
      ...parentPlanRevision,
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6',
      change_reason: 'Duplicate logical revision',
    });
    await repository.saveBoundarySummaryRevision({
      ...boundaryRevision,
      id: '13131313-1313-4313-8313-131313131313',
      summary_markdown: 'Duplicate logical revision',
    });
    await repository.saveExecutionPlanRevision({
      ...executionRevision,
      id: '14141414-1414-4414-8414-141414141413',
      content: 'Duplicate logical revision',
    });

    expect(await repository.listDevelopmentPlanItemRevisions(ids.developmentPlanItem)).toEqual([developmentPlanRevision]);
    expect(await repository.listDevelopmentPlanRevisions(ids.developmentPlan)).toEqual([
      developmentPlanRevisionFixture(),
      parentPlanRevision,
    ]);
    expect(await repository.listBoundarySummaryRevisions(ids.boundarySummary)).toEqual([boundaryRevision]);
    expect(await repository.getExecutionPlanRevision(ids.executionPlanRevision)).toEqual(executionRevision);
    expect(await repository.listExecutionPlanRevisions(ids.executionPlan)).toEqual([executionRevision]);
  });
}

async function expectAutomationRepositoryContract(repository: DeliveryRepository): Promise<void> {
  const defaultSettings = await repository.resolveAutomationProjectSettings({
    project_id: ids.project,
    repo_id: 'repo-1',
  });
  expect(defaultSettings).toMatchObject({
    project_id: ids.project,
    repo_id: 'repo-1',
    scope_type: 'repo',
    preset: 'off',
    version: 0,
    capabilities_json: {
      canProjectRuntimeState: false,
      canGeneratePackageDrafts: false,
      canEnqueueRuns: false,
    },
  });

  const settings = await repository.setAutomationProjectSettings({
    id: 'automation-settings-1',
    project_id: ids.project,
    repo_id: 'repo-1',
    scope_type: 'repo',
    preset: 'draft_only',
    expected_version: 0,
    reason: 'local dogfood',
    evidence_refs: [],
    actor: { actor_id: ids.human, actor_class: 'human_admin' },
    now: at,
  });
  expect(settings.version).toBe(1);

  const specDrift = {
    workItemId: '33333333-3333-4333-8333-333333333341',
    specId: '44444444-4444-4444-8444-444444444451',
    approvedRevisionId: '44444444-4444-4444-8444-444444444452',
    draftRevisionId: '44444444-4444-4444-8444-444444444453',
  };
  await saveApprovedSpecProjectionCandidate(repository, {
    ...specDrift,
    title: 'Spec drift must not plan',
    goal: 'Ensure automation uses approved Spec revisions only.',
    successCriteria: ['Mutable Spec drafts do not trigger Plan generation.'],
    specCurrentRevisionId: specDrift.draftRevisionId,
    workItemSpecRevisionId: specDrift.draftRevisionId,
  });

  const specPointerDrift = {
    workItemId: '33333333-3333-4333-8333-333333333343',
    specId: '44444444-4444-4444-8444-444444444461',
    approvedRevisionId: '44444444-4444-4444-8444-444444444462',
    draftRevisionId: '44444444-4444-4444-8444-444444444463',
  };
  await saveApprovedSpecProjectionCandidate(repository, {
    ...specPointerDrift,
    title: 'Spec pointer drift must not plan',
    goal: 'Ensure WorkItem Spec pointers stay aligned with approved Spec revisions.',
    successCriteria: ['WorkItem Spec pointer drift does not trigger Plan generation.'],
    workItemSpecRevisionId: specPointerDrift.draftRevisionId,
  });

  const specOwnerDrift = {
    workItemId: '33333333-3333-4333-8333-333333333347',
    specId: '44444444-4444-4444-8444-444444444495',
    approvedRevisionId: '44444444-4444-4444-8444-444444444496',
  };
  await saveApprovedSpecProjectionCandidate(repository, {
    ...specOwnerDrift,
    title: 'Spec owner drift must not plan',
    goal: 'Ensure current Specs belong to the WorkItem before Plan generation.',
    successCriteria: ['Spec owner drift does not trigger Plan generation.'],
    specWorkItemId: '33333333-3333-4333-8333-333333333348',
  });

  const specRevisionSpecDrift = {
    workItemId: '33333333-3333-4333-8333-333333333352',
    specId: '44444444-4444-4444-8444-4444444444ab',
    approvedRevisionId: '44444444-4444-4444-8444-4444444444ac',
  };
  await saveApprovedSpecProjectionCandidate(repository, {
    ...specRevisionSpecDrift,
    title: 'Spec revision spec drift must not plan',
    goal: 'Ensure approved Spec revisions belong to the current Spec before Plan generation.',
    successCriteria: ['SpecRevision Spec drift does not trigger Plan generation.'],
    specRevisionSpecId: '44444444-4444-4444-8444-4444444444ad',
  });

  const specRevisionWorkItemDrift = {
    workItemId: '33333333-3333-4333-8333-333333333353',
    specId: '44444444-4444-4444-8444-4444444444ae',
    approvedRevisionId: '44444444-4444-4444-8444-4444444444af',
  };
  await saveApprovedSpecProjectionCandidate(repository, {
    ...specRevisionWorkItemDrift,
    title: 'Spec revision WorkItem drift must not plan',
    goal: 'Ensure approved Spec revisions belong to the WorkItem before Plan generation.',
    successCriteria: ['SpecRevision WorkItem drift does not trigger Plan generation.'],
    specRevisionWorkItemId: '33333333-3333-4333-8333-333333333354',
  });

  const legacySpecPointerMissing = {
    workItemId: '33333333-3333-4333-8333-333333333358',
    specId: '44444444-4444-4444-8444-4444444444ca',
    approvedRevisionId: '44444444-4444-4444-8444-4444444444cb',
  };
  await saveApprovedSpecProjectionCandidate(repository, {
    ...legacySpecPointerMissing,
    title: 'Legacy Spec pointer missing should plan',
    goal: 'Keep approved legacy Specs eligible for generated Plan drafts.',
    successCriteria: ['Missing WorkItem Spec revision pointer falls back to approved Spec revision.'],
    workItemSpecRevisionId: null,
  });

  const planDrift = {
    workItemId: '33333333-3333-4333-8333-333333333342',
    specId: '44444444-4444-4444-8444-444444444491',
    approvedSpecRevisionId: '44444444-4444-4444-8444-444444444492',
    planId: '55555555-5555-4555-8555-555555555561',
    approvedPlanRevisionId: '55555555-5555-4555-8555-555555555562',
    draftPlanRevisionId: '55555555-5555-4555-8555-555555555563',
  };
  await saveApprovedPlanProjectionCandidate(repository, {
    ...planDrift,
    title: 'Plan drift must not package',
    goal: 'Ensure automation uses approved Plan revisions only.',
    successCriteria: ['Mutable Plan drafts do not trigger Package generation.'],
    planCurrentRevisionId: planDrift.draftPlanRevisionId,
    workItemPlanRevisionId: planDrift.draftPlanRevisionId,
  });

  const planPointerDrift = {
    workItemId: '33333333-3333-4333-8333-333333333344',
    specId: '44444444-4444-4444-8444-444444444471',
    approvedSpecRevisionId: '44444444-4444-4444-8444-444444444472',
    planId: '55555555-5555-4555-8555-555555555571',
    approvedPlanRevisionId: '55555555-5555-4555-8555-555555555572',
    draftPlanRevisionId: '55555555-5555-4555-8555-555555555573',
  };
  await saveApprovedPlanProjectionCandidate(repository, {
    ...planPointerDrift,
    title: 'Plan pointer drift must not package',
    goal: 'Ensure WorkItem Plan pointers stay aligned with approved Plan revisions.',
    successCriteria: ['WorkItem Plan pointer drift does not trigger Package generation.'],
    workItemPlanRevisionId: planPointerDrift.draftPlanRevisionId,
  });

  const planIdPointerDrift = {
    workItemId: '33333333-3333-4333-8333-333333333346',
    specId: '44444444-4444-4444-8444-444444444493',
    approvedSpecRevisionId: '44444444-4444-4444-8444-444444444494',
    planId: '55555555-5555-4555-8555-555555555591',
    approvedPlanRevisionId: '55555555-5555-4555-8555-555555555592',
  };
  await saveApprovedPlanProjectionCandidate(repository, {
    ...planIdPointerDrift,
    title: 'Plan id pointer drift must not package',
    goal: 'Ensure WorkItem current Plan id stays aligned with the approved Plan.',
    successCriteria: ['WorkItem Plan id drift does not trigger Package generation.'],
    workItemPlanId: '55555555-5555-4555-8555-555555555593',
  });

  const planOwnerDrift = {
    workItemId: '33333333-3333-4333-8333-333333333349',
    specId: '44444444-4444-4444-8444-444444444497',
    approvedSpecRevisionId: '44444444-4444-4444-8444-444444444498',
    planId: '55555555-5555-4555-8555-555555555594',
    approvedPlanRevisionId: '55555555-5555-4555-8555-555555555595',
  };
  await saveApprovedPlanProjectionCandidate(repository, {
    ...planOwnerDrift,
    title: 'Plan owner drift must not package',
    goal: 'Ensure approved Plans belong to the WorkItem before Package generation.',
    successCriteria: ['Plan owner drift does not trigger Package generation.'],
    planWorkItemId: '33333333-3333-4333-8333-333333333350',
  });

  const planRevisionPlanDrift = {
    workItemId: '33333333-3333-4333-8333-333333333351',
    specId: '44444444-4444-4444-8444-444444444499',
    approvedSpecRevisionId: '44444444-4444-4444-8444-4444444444aa',
    planId: '55555555-5555-4555-8555-555555555596',
    approvedPlanRevisionId: '55555555-5555-4555-8555-555555555597',
  };
  await saveApprovedPlanProjectionCandidate(repository, {
    ...planRevisionPlanDrift,
    title: 'Plan revision owner drift must not package',
    goal: 'Ensure approved Plan revisions belong to the approved Plan before Package generation.',
    successCriteria: ['Plan revision owner drift does not trigger Package generation.'],
    planRevisionPlanId: '55555555-5555-4555-8555-555555555598',
  });

  const packageSpecRevisionSpecDrift = {
    workItemId: '33333333-3333-4333-8333-333333333355',
    specId: '44444444-4444-4444-8444-4444444444ba',
    approvedSpecRevisionId: '44444444-4444-4444-8444-4444444444bb',
    planId: '55555555-5555-4555-8555-5555555555ba',
    approvedPlanRevisionId: '55555555-5555-4555-8555-5555555555bb',
  };
  await saveApprovedPlanProjectionCandidate(repository, {
    ...packageSpecRevisionSpecDrift,
    title: 'Package SpecRevision Spec drift must not package',
    goal: 'Ensure approved Spec revisions belong to the current Spec before Package generation.',
    successCriteria: ['Package SpecRevision Spec drift does not trigger Package generation.'],
    specRevisionSpecId: '44444444-4444-4444-8444-4444444444bc',
  });

  const packageSpecRevisionWorkItemDrift = {
    workItemId: '33333333-3333-4333-8333-333333333356',
    specId: '44444444-4444-4444-8444-4444444444bd',
    approvedSpecRevisionId: '44444444-4444-4444-8444-4444444444be',
    planId: '55555555-5555-4555-8555-5555555555bc',
    approvedPlanRevisionId: '55555555-5555-4555-8555-5555555555bd',
  };
  await saveApprovedPlanProjectionCandidate(repository, {
    ...packageSpecRevisionWorkItemDrift,
    title: 'Package SpecRevision WorkItem drift must not package',
    goal: 'Ensure approved Spec revisions belong to the WorkItem before Package generation.',
    successCriteria: ['Package SpecRevision WorkItem drift does not trigger Package generation.'],
    specRevisionWorkItemId: '33333333-3333-4333-8333-333333333357',
  });

  const planAncestryDrift = {
    workItemId: '33333333-3333-4333-8333-333333333345',
    specId: '44444444-4444-4444-8444-444444444481',
    approvedSpecRevisionId: '44444444-4444-4444-8444-444444444482',
    staleSpecRevisionId: '44444444-4444-4444-8444-444444444483',
    planId: '55555555-5555-4555-8555-555555555581',
    approvedPlanRevisionId: '55555555-5555-4555-8555-555555555582',
  };
  await saveApprovedPlanProjectionCandidate(repository, {
    ...planAncestryDrift,
    title: 'Plan ancestry drift must not package',
    goal: 'Ensure Plan revisions are based on the WorkItem current approved Spec revision.',
    successCriteria: ['Plan ancestry drift does not trigger Package generation.'],
    planBasedOnSpecRevisionId: planAncestryDrift.staleSpecRevisionId,
  });

  const legacyPackagePointersMissing = {
    workItemId: '33333333-3333-4333-8333-333333333359',
    specId: '44444444-4444-4444-8444-4444444444cc',
    approvedSpecRevisionId: '44444444-4444-4444-8444-4444444444cd',
    planId: '55555555-5555-4555-8555-5555555555cd',
    approvedPlanRevisionId: '55555555-5555-4555-8555-5555555555ce',
  };
  await saveApprovedPlanProjectionCandidate(repository, {
    ...legacyPackagePointersMissing,
    title: 'Legacy package pointers missing should package',
    goal: 'Keep approved legacy Plans eligible for generated Package drafts.',
    successCriteria: ['Missing WorkItem revision pointers fall back to approved Spec/Plan revisions.'],
    workItemSpecRevisionId: null,
    workItemPlanRevisionId: null,
  });

  const driftSnapshot = await repository.getRuntimeSnapshotData();
  expect(driftSnapshot.plan_revisions_requiring_packages).not.toContainEqual(
    expect.objectContaining({ target_object_id: planDrift.approvedPlanRevisionId }),
  );
  expect(driftSnapshot.plan_revisions_requiring_packages).not.toContainEqual(
    expect.objectContaining({ target_object_id: planPointerDrift.approvedPlanRevisionId }),
  );
  expect(driftSnapshot.plan_revisions_requiring_packages).not.toContainEqual(
    expect.objectContaining({ target_object_id: planIdPointerDrift.approvedPlanRevisionId }),
  );
  expect(driftSnapshot.plan_revisions_requiring_packages).not.toContainEqual(
    expect.objectContaining({ target_object_id: planOwnerDrift.approvedPlanRevisionId }),
  );
  expect(driftSnapshot.plan_revisions_requiring_packages).not.toContainEqual(
    expect.objectContaining({ target_object_id: planRevisionPlanDrift.approvedPlanRevisionId }),
  );
  expect(driftSnapshot.plan_revisions_requiring_packages).not.toContainEqual(
    expect.objectContaining({ target_object_id: packageSpecRevisionSpecDrift.approvedPlanRevisionId }),
  );
  expect(driftSnapshot.plan_revisions_requiring_packages).not.toContainEqual(
    expect.objectContaining({ target_object_id: packageSpecRevisionWorkItemDrift.approvedPlanRevisionId }),
  );
  expect(driftSnapshot.plan_revisions_requiring_packages).not.toContainEqual(
    expect.objectContaining({ target_object_id: planAncestryDrift.approvedPlanRevisionId }),
  );
  expect(driftSnapshot.plan_revisions_requiring_packages).toContainEqual(
    expect.objectContaining({
      target_object_id: legacyPackagePointersMissing.approvedPlanRevisionId,
      target_revision_id: `default:${legacyPackagePointersMissing.approvedPlanRevisionId}`,
    }),
  );

  await expect(
    repository.setAutomationProjectSettings({
      id: 'automation-settings-2',
      project_id: ids.project,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'run_enqueue',
      expected_version: 0,
      reason: 'stale',
      evidence_refs: [],
      actor: { actor_id: ids.human, actor_class: 'human_admin' },
      now: later,
    }),
  ).rejects.toThrow(/version/i);
  await expect(
    repository.setAutomationProjectSettings({
      id: 'automation-settings-daemon',
      project_id: ids.project,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'run_enqueue',
      expected_version: 1,
      reason: 'daemon escalation',
      evidence_refs: [],
      actor: { actor_id: ids.system, actor_class: 'automation_daemon' },
      now: later,
    }),
  ).rejects.toThrow(/capabilit|actor/i);
  const concurrentSettings = await Promise.allSettled([
    repository.setAutomationProjectSettings({
      id: 'automation-settings-race-a',
      project_id: ids.project,
      repo_id: 'repo-cas-race',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'race a',
      evidence_refs: [],
      actor: { actor_id: ids.human, actor_class: 'human_admin' },
      now: at,
    }),
    repository.setAutomationProjectSettings({
      id: 'automation-settings-race-b',
      project_id: ids.project,
      repo_id: 'repo-cas-race',
      scope_type: 'repo',
      preset: 'run_enqueue',
      expected_version: 0,
      reason: 'race b',
      evidence_refs: [],
      actor: { actor_id: ids.human, actor_class: 'human_admin' },
      now: at,
    }),
  ]);
  expect(concurrentSettings.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(concurrentSettings.filter((result) => result.status === 'rejected')).toHaveLength(1);

  const disabled = await repository.disableAutomationProjectSettings({
    project_id: ids.project,
    repo_id: 'repo-1',
    expected_version: 1,
    reason: 'pause automation',
    evidence_refs: [],
    actor: { actor_id: ids.human, actor_class: 'human_admin' },
    now: later,
  });
  expect(disabled).toMatchObject({ preset: 'off', version: 2 });

  const hold = await repository.requestManualPathHold({
    id: 'hold-1',
    object_type: 'plan_revision',
    object_id: ids.planRevision2,
    scope_key: buildManualScopeKey({ object_type: 'plan_revision', object_id: ids.planRevision2 }),
    reason_code: 'needs_human_plan_review',
    reason: 'Plan needs manual review.',
    source_automation_action_id: 'automation-action-1',
    evidence_refs: [],
    requested_by: ids.system,
    requested_at: at,
    idempotency_key: 'hold-idem-1',
  });
  const replayedHold = await repository.requestManualPathHold({
    ...hold,
    id: 'hold-duplicate',
    requested_at: later,
    idempotency_key: 'hold-idem-1',
  });
  expect(replayedHold).toEqual(hold);
  expect(replayedHold.source_automation_action_id).toBe('automation-action-1');
  await expect(
    repository.requestManualPathHold({
      ...hold,
      id: 'hold-conflict',
      source_automation_action_id: 'automation-action-conflict',
      requested_at: later,
      idempotency_key: 'hold-idem-conflict',
    }),
  ).rejects.toThrow(/hold|active|duplicate/i);
  await expect(
    repository.requestManualPathHold({
      ...hold,
      id: 'hold-invalid-scope',
      scope_key: 'plan_revision:not-the-plan',
      source_automation_action_id: 'automation-action-invalid-scope',
      idempotency_key: 'hold-idem-invalid',
    }),
  ).rejects.toThrow(/scope/i);
  await expect(
    repository.requestManualPathHold({
      id: 'hold-invalid-package-generation',
      object_type: 'package_generation',
      object_id: ids.planRevision2,
      scope_key: `package_generation:${ids.planRevision2}:wrong-generation-key`,
      reason_code: 'needs_human_package_generation_review',
      reason: 'Generation scope must be canonical.',
      evidence_refs: [],
      requested_by: ids.system,
      requested_at: at,
      idempotency_key: 'hold-idem-invalid-package-generation',
    }),
  ).rejects.toThrow(/generation|scope/i);
  await expect(
    repository.requestManualPathHold({
      id: 'hold-invalid-release-gate',
      object_type: 'release_gate',
      object_id: ids.release,
      scope_key: `release_gate:${ids.release}:wrong-gate-key`,
      reason_code: 'needs_human_release_gate_review',
      reason: 'Release gate scope must be canonical.',
      evidence_refs: [],
      requested_by: ids.system,
      requested_at: at,
      idempotency_key: 'hold-idem-invalid-release-gate',
    }),
  ).rejects.toThrow(/gate|scope/i);

  const activeHoldsForPackage = await repository.listActiveManualPathHolds({
    object_type: 'execution_package',
    object_id: ids.package,
  });
  expect(activeHoldsForPackage.map((activeHold) => activeHold.id)).toContain(hold.id);

  const resolvedHold = await repository.resolveManualPathHold({
    hold_id: hold.id,
    resolved_by: ids.human,
    resolved_at: later,
    resolution: 'handled manually',
  });
  expect(resolvedHold.status).toBe('resolved');
  expect(
    await repository.requestManualPathHold({
      ...hold,
      id: 'hold-after-resolve',
      requested_at: later,
      idempotency_key: 'hold-idem-1',
    }),
  ).toEqual(resolvedHold);
  expect(
    await repository.requestManualPathHold({
      ...hold,
      id: 'hold-source-replay',
      requested_at: later,
      idempotency_key: 'hold-idem-source-replay',
    }),
  ).toEqual(resolvedHold);

  const claimedCommand = await repository.claimCommandIdempotency({
    id: 'command-idem-1',
    command_name: 'ensure_package_drafts',
    idempotency_key: 'command-key-1',
    target_object_type: 'plan_revision',
    target_object_id: ids.planRevision1,
    target_revision_id: ids.planRevision1,
    target_version: 2,
    precondition_fingerprint: 'fingerprint-a',
    precondition_json: { automation_settings_version: 2 },
    actor_scope: ids.system,
    claim_token: 'command-claim-1',
    locked_until: '2026-05-05T00:05:00.000Z',
    now: at,
  });
  expect(claimedCommand.status).toBe('running');
  await expect(
    repository.claimCommandIdempotency({
      ...claimedCommand,
      id: 'command-idem-live-duplicate',
      claim_token: 'command-claim-live-duplicate',
      now: at,
      locked_until: '2026-05-05T00:06:00.000Z',
    }),
  ).rejects.toThrow(/active|claim/i);
  await expect(
    repository.claimCommandIdempotency({
      ...claimedCommand,
      id: 'command-idem-conflict',
      precondition_fingerprint: 'fingerprint-b',
      claim_token: 'command-claim-conflict',
      now: at,
    }),
  ).rejects.toThrow(/fingerprint|precondition/i);
  await expect(
    repository.claimCommandIdempotency({
      ...claimedCommand,
      id: 'command-idem-identity-conflict',
      command_name: 'ensure_execution_packages',
      claim_token: 'command-claim-identity-conflict',
      now: at,
    }),
  ).rejects.toThrow(/idempotency|command|conflict/i);
  const renewedCommand = await repository.renewCommandIdempotency({
    idempotency_key: claimedCommand.idempotency_key,
    claim_token: 'command-claim-1',
    locked_until: '2026-05-05T00:10:00.000Z',
    last_heartbeat_at: later,
  });
  expect(renewedCommand.last_heartbeat_at).toBe(later);
  const completedCommand = await repository.completeCommandIdempotency({
    idempotency_key: claimedCommand.idempotency_key,
    claim_token: 'command-claim-1',
    result_json: { plan_revision_id: ids.planRevision2 },
    finished_at: later,
  });
  expect(completedCommand.status).toBe('succeeded');
  expect(completedCommand.result_json).toEqual({ plan_revision_id: ids.planRevision2 });
  expect(
    await repository.claimCommandIdempotency({
      ...claimedCommand,
      id: 'command-idem-replay',
      claim_token: 'command-claim-replay',
      now: later,
    }),
  ).toEqual(completedCommand);
  const expiringCommand = await repository.claimCommandIdempotency({
    id: 'command-idem-expiring',
    command_name: 'ensure_execution_packages',
    idempotency_key: 'command-key-expiring',
    target_object_type: 'plan_revision',
    target_object_id: ids.planRevision2,
    target_revision_id: ids.planRevision2,
    precondition_fingerprint: 'fingerprint-expiring',
    actor_scope: ids.system,
    claim_token: 'command-claim-expired-1',
    locked_until: '2026-05-05T00:05:00.000Z',
    now: at,
  });
  const reclaimedCommand = await repository.claimCommandIdempotency({
    ...expiringCommand,
    id: 'command-idem-expiring-reclaim',
    claim_token: 'command-claim-expired-2',
    locked_until: '2026-05-05T00:12:00.000Z',
    now: '2026-05-05T00:06:00.000Z',
  });
  expect(reclaimedCommand).toMatchObject({ id: expiringCommand.id, status: 'running', claim_token: 'command-claim-expired-2' });
  await expect(
    repository.renewCommandIdempotency({
      idempotency_key: expiringCommand.idempotency_key,
      claim_token: 'command-claim-expired-1',
      locked_until: '2026-05-05T00:13:00.000Z',
      last_heartbeat_at: '2026-05-05T00:07:00.000Z',
    }),
  ).rejects.toThrow(/claimed|token|running/i);
  await expect(
    repository.completeCommandIdempotency({
      idempotency_key: expiringCommand.idempotency_key,
      claim_token: 'command-claim-expired-1',
      finished_at: '2026-05-05T00:07:00.000Z',
    }),
  ).rejects.toThrow(/claimed|token|running/i);

  const generationEvidenceRefs = [
    {
      kind: 'logs',
      name: 'package-generation.json',
      content_type: 'application/json',
      storage_uri: 'artifact://package-generation.json',
      digest: 'sha256:generation',
    },
  ];
  const generationRun = await repository.claimExecutionPackageGenerationRun({
    plan_revision_id: ids.planRevision2,
    generation_key: `default:${ids.planRevision2}`,
    generator_version: 'mock-plan-splitter@1',
    policy_digest: 'sha256-policy-a',
    manifest_digest: 'sha256-manifest-a',
    expected_package_count: 2,
    expected_package_keys: ['api', 'tests'],
    evidence_refs: generationEvidenceRefs,
    claim_token: 'generation-claim-1',
    now: at,
    locked_until: '2026-05-05T00:05:00.000Z',
  });
  expect(generationRun.status).toBe('running');
  expect(generationRun.evidence_refs).toEqual(generationEvidenceRefs);
  await expect(
    repository.claimExecutionPackageGenerationRun({
      plan_revision_id: ids.planRevision2,
      generation_key: `default:${ids.planRevision2}`,
      generator_version: 'mock-plan-splitter@1',
      policy_digest: 'sha256-policy-a',
      manifest_digest: 'sha256-manifest-a',
      expected_package_count: 2,
      expected_package_keys: ['api', 'tests'],
      claim_token: 'generation-claim-live-duplicate',
      now: at,
      locked_until: '2026-05-05T00:06:00.000Z',
    }),
  ).rejects.toThrow(/active|claim/i);
  await expect(
    repository.claimExecutionPackageGenerationRun({
      plan_revision_id: ids.planRevision2,
      generation_key: `default:${ids.planRevision2}`,
      generator_version: 'mock-plan-splitter@2',
      policy_digest: 'sha256-policy-a',
      manifest_digest: 'sha256-manifest-b',
      expected_package_count: 1,
      expected_package_keys: ['api'],
      claim_token: 'generation-claim-2',
      now: later,
      locked_until: '2026-05-05T00:05:00.000Z',
    }),
  ).rejects.toThrow(/manifest/i);
  await expect(
    repository.claimExecutionPackageGenerationRun({
      plan_revision_id: ids.planRevision2,
      generation_key: `default:${ids.planRevision2}`,
      generator_version: 'mock-plan-splitter@1',
      policy_digest: 'sha256-policy-b',
      manifest_digest: 'sha256-manifest-a',
      expected_package_count: 2,
      expected_package_keys: ['api', 'tests'],
      claim_token: 'generation-claim-policy-drift',
      now: later,
      locked_until: '2026-05-05T00:05:00.000Z',
    }),
  ).rejects.toThrow(/manifest|policy|drift/i);
  await expect(
    repository.claimExecutionPackageGenerationRun({
      plan_revision_id: ids.planRevision2,
      generation_key: `default:${ids.planRevision2}`,
      generator_version: 'mock-plan-splitter@1',
      policy_digest: 'sha256-policy-a',
      manifest_digest: 'sha256-manifest-a',
      expected_package_count: 1,
      expected_package_keys: ['api', 'tests'],
      claim_token: 'generation-claim-count-drift',
      now: later,
      locked_until: '2026-05-05T00:05:00.000Z',
    }),
  ).rejects.toThrow(/manifest|count|drift/i);
  const reclaimedGenerationRun = await repository.claimExecutionPackageGenerationRun({
    plan_revision_id: ids.planRevision2,
    generation_key: `default:${ids.planRevision2}`,
    generator_version: 'mock-plan-splitter@1',
    policy_digest: 'sha256-policy-a',
    manifest_digest: 'sha256-manifest-a',
    expected_package_count: 2,
    expected_package_keys: ['api', 'tests'],
    evidence_refs: generationEvidenceRefs,
    claim_token: 'generation-claim-reclaimed',
    now: '2026-05-05T00:06:00.000Z',
    locked_until: '2026-05-05T00:11:00.000Z',
  });
  expect(reclaimedGenerationRun).toMatchObject({
    execution_package_set_id: generationRun.execution_package_set_id,
    status: 'running',
    claim_token: 'generation-claim-reclaimed',
    locked_until: '2026-05-05T00:11:00.000Z',
    last_heartbeat_at: '2026-05-05T00:06:00.000Z',
    evidence_refs: generationEvidenceRefs,
  });

  await repository.saveExecutionPackageGenerationPackage({
    execution_package_set_id: reclaimedGenerationRun.execution_package_set_id,
    execution_package_id: ids.package,
    plan_revision_id: ids.planRevision2,
    generation_key: reclaimedGenerationRun.generation_key,
    package_key: 'api',
    sequence: 1,
    manifest_digest: reclaimedGenerationRun.manifest_digest!,
    claim_token: 'generation-claim-reclaimed',
  });
  await expect(
    repository.saveExecutionPackageGenerationPackage({
      execution_package_set_id: reclaimedGenerationRun.execution_package_set_id,
      execution_package_id: ids.package2,
      plan_revision_id: ids.planRevision2,
      generation_key: reclaimedGenerationRun.generation_key,
      package_key: 'api',
      sequence: 2,
      manifest_digest: reclaimedGenerationRun.manifest_digest!,
      claim_token: 'generation-claim-reclaimed',
    }),
  ).rejects.toThrow(/package_key|unique|duplicate/i);
  await expect(
    repository.saveExecutionPackageGenerationPackage({
      execution_package_set_id: reclaimedGenerationRun.execution_package_set_id,
      execution_package_id: ids.package,
      plan_revision_id: ids.planRevision2,
      generation_key: reclaimedGenerationRun.generation_key,
      package_key: 'api',
      sequence: 1,
      manifest_digest: 'sha256-manifest-drift',
      claim_token: 'generation-claim-reclaimed',
    }),
  ).rejects.toThrow(/drift|manifest/i);
  await expect(
    repository.saveExecutionPackageGenerationPackage({
      execution_package_set_id: reclaimedGenerationRun.execution_package_set_id,
      execution_package_id: 'generation-package-stale-token',
      plan_revision_id: ids.planRevision2,
      generation_key: reclaimedGenerationRun.generation_key,
      package_key: 'stale',
      sequence: 3,
      manifest_digest: reclaimedGenerationRun.manifest_digest!,
      claim_token: 'generation-claim-1',
    }),
  ).rejects.toThrow(/claimed|token|running/i);
  await expect(
    repository.completeExecutionPackageGenerationRun({
      plan_revision_id: ids.planRevision2,
      execution_package_set_id: reclaimedGenerationRun.execution_package_set_id,
      claim_token: 'generation-claim-1',
      result_json: { package_count: 1 },
      completed_at: later,
    }),
  ).rejects.toThrow(/claimed|token|running/i);
  await expect(
    repository.completeExecutionPackageGenerationRun({
      plan_revision_id: ids.planRevision2,
      execution_package_set_id: reclaimedGenerationRun.execution_package_set_id,
      claim_token: 'generation-claim-reclaimed',
      result_json: { package_count: 1 },
      completed_at: later,
    }),
  ).rejects.toThrow(/package|manifest|count/i);
  await repository.saveExecutionPackageGenerationPackage({
    execution_package_set_id: reclaimedGenerationRun.execution_package_set_id,
    execution_package_id: ids.package2,
    plan_revision_id: ids.planRevision2,
    generation_key: reclaimedGenerationRun.generation_key,
    package_key: 'tests',
    sequence: 2,
    manifest_digest: reclaimedGenerationRun.manifest_digest!,
    claim_token: 'generation-claim-reclaimed',
  });
  const completedGeneration = await repository.completeExecutionPackageGenerationRun({
    plan_revision_id: ids.planRevision2,
    execution_package_set_id: reclaimedGenerationRun.execution_package_set_id,
    claim_token: 'generation-claim-reclaimed',
    result_json: { package_count: 2 },
    completed_at: later,
  });
  expect(completedGeneration.status).toBe('succeeded');
  await expect(
    repository.saveExecutionPackageGenerationPackage({
      execution_package_set_id: reclaimedGenerationRun.execution_package_set_id,
      execution_package_id: 'generation-package-after-complete',
      plan_revision_id: ids.planRevision2,
      generation_key: reclaimedGenerationRun.generation_key,
      package_key: 'after-complete',
      sequence: 3,
      manifest_digest: reclaimedGenerationRun.manifest_digest!,
      claim_token: 'generation-claim-reclaimed',
    }),
  ).rejects.toThrow(/claimed|running|succeeded/i);
  await expect(
    repository.claimExecutionPackageGenerationRun({
      plan_revision_id: ids.planRevision2,
      generation_key: `alternate:${ids.planRevision2}`,
      generator_version: 'mock-plan-splitter@1',
      manifest_digest: 'sha256-manifest-new',
      expected_package_count: 1,
      expected_package_keys: ['worker'],
      claim_token: 'generation-claim-new',
      now: later,
      locked_until: '2026-05-05T00:06:00.000Z',
    }),
  ).rejects.toThrow(/current|succeeded|supersede/i);
  const superseded = await repository.supersedeExecutionPackageGenerationRun({
    plan_revision_id: ids.planRevision2,
    execution_package_set_id: reclaimedGenerationRun.execution_package_set_id,
    expected_version: completedGeneration.version,
    supersede_command_id: 'command-supersede-generation-contract',
    superseded_by: ids.human,
    superseded_at: later,
    reason: 'regenerate packages',
    evidence_refs: [],
  });
  expect(superseded.status).toBe('superseded');
  expect(superseded.next_generation_key).toBe(`regenerate:${ids.planRevision2}:2`);

  const activeRun = await repository.findActiveRunSessionForPackage(ids.package);
  expect(activeRun).toBeUndefined();
  const queuedRun: RunSession = {
    id: 'run-session-active-contract',
    execution_package_id: ids.package,
    requested_by_actor_id: ids.human,
    status: 'queued',
    changed_files: [],
    check_results: [],
    artifacts: [],
    log_refs: [],
    created_at: at,
    updated_at: at,
  };
  await repository.saveRunSession(queuedRun);
  expect(await repository.findActiveRunSessionForPackage(ids.package)).toEqual(queuedRun);
  await expect(repository.saveRunSession({ ...queuedRun, id: 'run-session-active-contract-2' })).rejects.toThrow(
    /active|run/i,
  );
  await repository.saveRunSession({ ...queuedRun, status: 'succeeded', finished_at: later, updated_at: later });
  await repository.saveRunSession({ ...queuedRun, id: 'run-session-active-contract-2', status: 'running' });

  expect(await repository.findOpenReviewPacketForPackage(ids.package)).toBeUndefined();
  const openReview: ReviewPacket = {
    id: 'review-packet-open-contract',
    run_session_id: ids.runSession,
    execution_package_id: ids.package,
    reviewer_actor_id: ids.human,
    spec_revision_id: ids.specRevision2,
    plan_revision_id: ids.planRevision2,
    status: 'draft',
    decision: 'none',
    changed_files: [],
    check_result_summary: 'pending',
    self_review: {
      status: 'succeeded',
      summary: 'pending',
      spec_plan_alignment: 'pending',
      test_assessment: 'pending',
      risk_notes: [],
      follow_up_questions: [],
    },
    risk_notes: [],
    requested_changes: [],
    created_at: at,
    updated_at: at,
  };
  await repository.saveReviewPacket(openReview);
  expect(await repository.findOpenReviewPacketForPackage(ids.package)).toEqual(openReview);
  await expect(repository.saveReviewPacket({ ...openReview, id: 'review-packet-open-contract-2' })).rejects.toThrow(
    /open|review/i,
  );
  await repository.saveReviewPacket({ ...openReview, status: 'completed', completed_at: later, updated_at: later });
  await repository.saveReviewPacket({ ...openReview, id: 'review-packet-open-contract-2', status: 'ready' });

  const actionRun = await repository.claimAutomationActionRun({
    id: 'automation-action-contract',
    action_type: 'ensure_package_drafts',
    target_object_type: 'plan_revision',
    target_object_id: ids.planRevision1,
    target_revision_id: ids.planRevision1,
    target_status: 'approved',
    idempotency_key: 'action-key-contract',
    automation_scope: `repo:${ids.project}:repo-1`,
    automation_settings_version: 2,
    capability_fingerprint: disabled.capability_fingerprint,
    precondition_fingerprint: 'precondition-contract-active',
    action_input_json: {
      plan_revision_id: ids.planRevision1,
      generation_key: `default:${ids.planRevision1}`,
    },
    claim_token: 'automation-claim-1',
    locked_until: '2026-05-05T00:05:00.000Z',
    now: at,
  });
  expect(actionRun.status).toBe('running');
  await expect(
    repository.claimAutomationActionRun({
      ...actionRun,
      id: 'automation-action-live-duplicate',
      claim_token: 'automation-claim-live-duplicate',
      now: at,
      locked_until: '2026-05-05T00:06:00.000Z',
    }),
  ).rejects.toThrow(/active|claim/i);
  const expiredRunningAction = (await repository.listClaimableAutomationActionRuns({
    now: '2026-05-05T00:06:00.000Z',
    limit: 10,
  })).find((run) => run.id === actionRun.id);
  expect(expiredRunningAction).toMatchObject({ id: actionRun.id, status: 'running' });
  expect(expiredRunningAction?.claim_token).toBeUndefined();
  expect(expiredRunningAction?.locked_until).toBeUndefined();
  const reclaimedActionRun = await repository.claimAutomationActionRun({
    ...actionRun,
    claim_token: 'automation-claim-expired-2',
    now: '2026-05-05T00:06:00.000Z',
    locked_until: '2026-05-05T00:10:00.000Z',
  });
  expect(reclaimedActionRun).toMatchObject({ id: actionRun.id, status: 'running', attempt: 2 });
  await expect(
    repository.completeAutomationActionRun({
      id: actionRun.id,
      idempotency_key: actionRun.idempotency_key,
      claim_token: 'automation-claim-1',
      status: 'succeeded',
      finished_at: '2026-05-05T00:06:30.000Z',
    }),
  ).rejects.toThrow(/claimed|running/i);
  const pendingActionRun = await repository.markAutomationActionGatePending({
    id: actionRun.id,
    idempotency_key: actionRun.idempotency_key,
    claim_token: 'automation-claim-expired-2',
    reason: 'manual_path_hold_active',
    result_json: { hold_id: hold.id },
    next_attempt_at: '2026-05-05T00:10:00.000Z',
    now: '2026-05-05T00:07:00.000Z',
  });
  expect(pendingActionRun.status).toBe('gate_pending');
  expect((await repository.listClaimableAutomationActionRuns({ now: '2026-05-05T00:11:00.000Z', limit: 10 })).map(
    (run) => run.id,
  )).toContain(actionRun.id);
  const resumedActionRun = await repository.claimAutomationActionRun({
    ...actionRun,
    claim_token: 'automation-claim-2',
    now: '2026-05-05T00:11:00.000Z',
    locked_until: '2026-05-05T00:15:00.000Z',
  });
  expect(resumedActionRun).toMatchObject({ id: actionRun.id, status: 'running', attempt: 3 });
  const completedActionRun = await repository.completeAutomationActionRun({
    id: actionRun.id,
    idempotency_key: actionRun.idempotency_key,
    claim_token: 'automation-claim-2',
    status: 'skipped',
    result_json: { skipped: true },
    finished_at: '2026-05-05T00:12:00.000Z',
  });
  expect(completedActionRun.status).toBe('skipped');
  await expect(
    repository.markAutomationActionGatePending({
      id: actionRun.id,
      idempotency_key: actionRun.idempotency_key,
      claim_token: 'automation-claim-2',
      reason: 'terminal_actions_are_not_claimed',
      now: '2026-05-05T00:12:00.000Z',
    }),
  ).rejects.toThrow(/claimed|running/i);
  await expect(
    repository.completeAutomationActionRun({
      id: actionRun.id,
      idempotency_key: actionRun.idempotency_key,
      claim_token: 'automation-claim-2',
      status: 'succeeded',
      finished_at: '2026-05-05T00:12:00.000Z',
    }),
  ).rejects.toThrow(/claimed|running/i);
  const replayedCompletedActionRun = await repository.claimAutomationActionRun({
    ...actionRun,
    id: 'automation-action-contract-duplicate',
    claim_token: 'automation-claim-duplicate',
    now: '2026-05-05T00:12:00.000Z',
    locked_until: '2026-05-05T00:15:00.000Z',
  });
  expect(replayedCompletedActionRun).toMatchObject({
    id: completedActionRun.id,
    idempotency_key: completedActionRun.idempotency_key,
    status: completedActionRun.status,
  });
  expect(replayedCompletedActionRun.claim_token).toBeUndefined();
  expect(replayedCompletedActionRun.locked_until).toBeUndefined();
  await expect(
    repository.claimAutomationActionRun({
      ...actionRun,
      id: 'automation-action-contract-settings-drift',
      automation_settings_version: actionRun.automation_settings_version + 1,
      claim_token: 'automation-claim-settings-drift',
      now: '2026-05-05T00:12:00.000Z',
      locked_until: '2026-05-05T00:15:00.000Z',
    }),
  ).rejects.toThrow(/identity|settings|fingerprint/i);
  await expect(
    repository.claimAutomationActionRun({
      ...actionRun,
      id: 'automation-action-contract-fingerprint-drift',
      capability_fingerprint: 'fingerprint-drift',
      claim_token: 'automation-claim-fingerprint-drift',
      now: '2026-05-05T00:12:00.000Z',
      locked_until: '2026-05-05T00:15:00.000Z',
    }),
  ).rejects.toThrow(/identity|settings|fingerprint/i);

  const retryableActionRun = await repository.claimAutomationActionRun({
    id: 'automation-action-retryable',
    action_type: 'enqueue_run',
    target_object_type: 'execution_package',
    target_object_id: ids.package,
    target_status: 'ready',
    idempotency_key: 'action-key-retryable',
    automation_scope: `repo:${ids.project}:repo-1`,
    automation_settings_version: 2,
    capability_fingerprint: disabled.capability_fingerprint,
    precondition_fingerprint: 'precondition-contract-retryable',
    action_input_json: { execution_package_id: ids.package },
    claim_token: 'automation-claim-retryable-1',
    locked_until: '2026-05-05T00:05:00.000Z',
    now: at,
  });
  await repository.completeAutomationActionRun({
    id: retryableActionRun.id,
    idempotency_key: retryableActionRun.idempotency_key,
    claim_token: 'automation-claim-retryable-1',
    status: 'blocked',
    retryable: true,
    next_attempt_at: '2026-05-05T00:20:00.000Z',
    result_json: { reason: 'transient_gate' },
    finished_at: later,
  });
  expect((await repository.listClaimableAutomationActionRuns({ now: '2026-05-05T00:19:00.000Z', limit: 10 })).map(
    (run) => run.id,
  )).not.toContain(retryableActionRun.id);
  expect((await repository.listClaimableAutomationActionRuns({ now: '2026-05-05T00:21:00.000Z', limit: 10 })).map(
    (run) => run.id,
  )).toContain(retryableActionRun.id);
  const resumedRetryableActionRun = await repository.claimAutomationActionRun({
    ...retryableActionRun,
    claim_token: 'automation-claim-retryable-2',
    locked_until: '2026-05-05T00:25:00.000Z',
    now: '2026-05-05T00:21:00.000Z',
  });
  expect(resumedRetryableActionRun).toMatchObject({ id: retryableActionRun.id, status: 'running', attempt: 2 });
  expect(resumedRetryableActionRun.result_json).toBeUndefined();
  expect(resumedRetryableActionRun.retryable).toBeUndefined();
  expect(resumedRetryableActionRun.next_attempt_at).toBeUndefined();
  expect(resumedRetryableActionRun.finished_at).toBeUndefined();
  await repository.completeAutomationActionRun({
    id: retryableActionRun.id,
    idempotency_key: retryableActionRun.idempotency_key,
    claim_token: 'automation-claim-retryable-2',
    status: 'blocked',
    finished_at: '2026-05-05T00:22:00.000Z',
  });
  expect((await repository.listClaimableAutomationActionRuns({ now: '2026-05-05T00:26:00.000Z', limit: 10 })).map(
    (run) => run.id,
  )).not.toContain(retryableActionRun.id);

  const pendingActionInput = {
    id: 'automation-action-contract-pending',
    action_type: 'ensure_package_drafts',
    target_object_type: 'plan_revision',
    target_object_id: ids.planRevision1,
    target_revision_id: ids.planRevision1,
    target_status: 'approved',
    target_version: 1,
    idempotency_key: 'action-key-contract-pending',
    automation_scope: `repo:${ids.project}:repo-contract-pending` as const,
    automation_settings_version: 2,
    capability_fingerprint: disabled.capability_fingerprint,
    precondition_fingerprint: 'precondition-contract-a',
    action_input_json: {
      plan_revision_id: ids.planRevision1,
      generation_key: `default:${ids.planRevision1}`,
    },
    now: '2026-05-05T00:30:00.000Z',
  };
  const pendingNewAction = await repository.createOrReplayAutomationActionRun(pendingActionInput);
  expect(pendingNewAction).toMatchObject({ id: pendingActionInput.id, status: 'pending', attempt: 0 });
  await expect(
    repository.createOrReplayAutomationActionRun({
      ...pendingActionInput,
      idempotency_key: 'action-key-contract-pending-duplicate-id',
    }),
  ).rejects.toThrow(/idempotency|identity|duplicate/i);
  await expect(
    repository.createOrReplayAutomationActionRun({
      ...pendingActionInput,
      action_input_json: {
        generation_key: `default:${ids.planRevision1}`,
        plan_revision_id: ids.planRevision1,
      },
    }),
  ).resolves.toMatchObject({ id: pendingActionInput.id, status: 'pending' });
  await expect(
    repository.createOrReplayAutomationActionRun({
      ...pendingActionInput,
      precondition_fingerprint: 'precondition-contract-b',
    }),
  ).rejects.toThrow(/idempotency|identity|precondition/i);
  await expect(
    repository.createOrReplayAutomationActionRun({
      ...pendingActionInput,
      action_input_json: {
        plan_revision_id: ids.planRevision2,
        generation_key: `default:${ids.planRevision2}`,
      },
    }),
  ).rejects.toThrow(/idempotency|identity|action/i);
  await expect(
    repository.claimNextAutomationActionRun({
      now: '2026-05-05T00:30:01.000Z',
      claim_token: 'automation-claim-next-contract',
      locked_until: '2026-05-05T00:35:00.000Z',
      limit: 10,
      project_id: ids.project,
      repo_id: 'repo-contract-pending',
      automation_scope: `repo:${ids.project}:repo-contract-pending`,
    }),
  ).resolves.toMatchObject({ id: pendingNewAction.id, status: 'running', attempt: 1 });

  await repository.createOrReplayAutomationActionRun({
    ...pendingActionInput,
    id: 'automation-action-contract-filter-outside',
    idempotency_key: 'action-key-contract-filter-outside',
    automation_scope: `repo:${ids.project}:repo-contract-outside`,
    target_object_id: ids.workItem2,
  });
  await expect(
    repository.claimNextAutomationActionRun({
      now: '2026-05-05T00:30:02.000Z',
      claim_token: 'automation-claim-next-contract-empty',
      locked_until: '2026-05-05T00:35:00.000Z',
      limit: 10,
      project_id: ids.project,
      repo_id: 'repo-contract-pending',
      automation_scope: `repo:${ids.project}:repo-contract-pending`,
    }),
  ).resolves.toBeUndefined();

  const snapshotActionInput = {
    id: 'automation-action-contract-snapshot',
    action_type: 'project_runtime_snapshot',
    target_object_type: 'repo',
    target_object_id: 'repo-contract-projection',
    target_status: 'observed',
    idempotency_key: 'action-key-contract-snapshot',
    automation_scope: `repo:${ids.project}:repo-contract-projection` as const,
    automation_settings_version: 2,
    capability_fingerprint: disabled.capability_fingerprint,
    precondition_fingerprint: 'snapshot-precondition-a',
    action_input_json: {
      repo_id: 'repo-contract-projection',
      policy_status: 'loaded',
      policy_digest: 'policy-contract-a',
      parser_version: 'workflow-md-parser:v1',
      reason_code: 'loaded',
      observed_at: '2026-05-05T00:30:00.000Z',
      last_known_good: { repo_id: 'repo-contract-projection', policy_status: 'loaded', policy_digest: 'older' },
    },
    now: '2026-05-05T00:30:00.000Z',
  };
  await repository.createOrReplayAutomationActionRun(snapshotActionInput);
  await expect(
    repository.createOrReplayAutomationActionRun({
      ...snapshotActionInput,
      target_object_type: 'repo',
      target_object_id: 'repo-contract-projection-renamed',
      target_status: 'reobserved',
      automation_scope: `repo:${ids.project}:repo-contract-projection`,
      automation_settings_version: 99,
      capability_fingerprint: 'ignored-capability-change',
      action_input_json: {
        repo_id: 'repo-contract-projection',
        policy_status: 'loaded',
        policy_digest: 'policy-contract-a',
        parser_version: 'workflow-md-parser:v1',
        reason_code: 'loaded',
        observed_at: '2026-05-05T00:31:00.000Z',
        last_known_good: { repo_id: 'repo-contract-projection', policy_status: 'loaded', policy_digest: 'newer' },
      },
    }),
  ).resolves.toMatchObject({ id: snapshotActionInput.id, status: 'pending' });
  await expect(
    repository.createOrReplayAutomationActionRun({
      ...snapshotActionInput,
      automation_scope: `repo:${ids.project}-other:repo-contract-projection`,
    }),
  ).rejects.toThrow(/identity|policy/i);
  await expect(
    repository.createOrReplayAutomationActionRun({
      ...snapshotActionInput,
      action_input_json: {
        repo_id: 'repo-contract-projection',
        policy_status: 'loaded',
        policy_digest: 'policy-contract-b',
        parser_version: 'workflow-md-parser:v1',
        reason_code: 'loaded',
      },
    }),
  ).rejects.toThrow(/identity|policy/i);
  const claimedProjection = await repository.claimNextAutomationActionRun({
    now: '2026-05-05T00:31:00.000Z',
    claim_token: 'automation-claim-projection-contract',
    locked_until: '2026-05-05T00:36:00.000Z',
    limit: 10,
    automation_scope: `repo:${ids.project}:repo-contract-projection`,
  });
  await repository.completeAutomationActionRun({
    id: claimedProjection?.id ?? '',
    idempotency_key: claimedProjection?.idempotency_key ?? '',
    claim_token: 'automation-claim-projection-contract',
    status: 'succeeded',
    finished_at: '2026-05-05T00:32:00.000Z',
    result_json: { projected: true },
  });
  await expect(
    repository.latestCompletedProjectionActionRun({
      automation_scope: `repo:${ids.project}:repo-contract-projection`,
      repo_id: 'repo-contract-projection',
      policy_status: 'loaded',
      policy_digest: 'policy-contract-a',
      parser_version: 'workflow-md-parser:v1',
      reason_code: 'loaded',
    }),
  ).resolves.toMatchObject({ id: snapshotActionInput.id, status: 'succeeded' });

  const concurrentInput = {
    ...pendingActionInput,
    id: 'automation-action-contract-concurrent',
    idempotency_key: 'action-key-contract-concurrent',
    automation_scope: `repo:${ids.project}:repo-contract-concurrent` as const,
    target_object_id: ids.workItem2,
  };
  const concurrentPending = await repository.createOrReplayAutomationActionRun(concurrentInput);
  const concurrentResults = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      repository.claimNextAutomationActionRun({
        now: '2026-05-05T00:33:00.000Z',
        claim_token: `automation-claim-concurrent-${index}`,
        locked_until: '2026-05-05T00:38:00.000Z',
        limit: 10,
        automation_scope: `repo:${ids.project}:repo-contract-concurrent`,
      }),
    ),
  );
  expect(concurrentResults.filter((result) => result?.id === concurrentPending.id)).toHaveLength(1);
}

const contextManifestFixture = (overrides: Partial<ContextManifest> = {}): ContextManifest => ({
  id: ids.contextManifest,
  revision_id: ids.contextManifestRevision,
  source_ref: { type: 'requirement', id: ids.workItem, revision_id: ids.specRevision1 },
  development_plan_id: ids.developmentPlan,
  development_plan_revision_id: ids.developmentPlanRevision,
  development_plan_item_id: ids.developmentPlanItem,
  development_plan_item_revision_id: ids.developmentPlanItemRevision1,
  boundary_approver_actor_id: ids.human,
  boundary_approved_at: '2026-05-24T00:04:00.000Z',
  sources: [{ type: 'repo', ref: 'packages/db/src' }],
  generated_at: '2026-05-24T00:00:00.000Z',
  created_at: '2026-05-24T00:00:00.000Z',
  updated_at: '2026-05-24T00:00:00.000Z',
  ...overrides,
});

const developmentPlanFixture = (overrides: Partial<DevelopmentPlan> = {}): DevelopmentPlan => ({
  id: ids.developmentPlan,
  project_id: ids.project,
  revision_id: ids.developmentPlanRevision,
  title: 'AI-native project management UX redesign',
  status: 'active',
  source_refs: [{ type: 'requirement', id: ids.workItem, revision_id: ids.specRevision1 }],
  items: [],
  created_at: '2026-05-24T00:00:00.000Z',
  updated_at: '2026-05-24T00:00:00.000Z',
  ...overrides,
});

const developmentPlanRevisionFixture = (
  overrides: Partial<DevelopmentPlanRevision> = {},
): DevelopmentPlanRevision => ({
  id: ids.developmentPlanRevision,
  development_plan_id: ids.developmentPlan,
  revision_number: 1,
  title: 'AI-native project management UX redesign',
  status: 'active',
  source_refs: [{ type: 'requirement', id: ids.workItem, revision_id: ids.specRevision1 }],
  item_refs: [],
  change_reason: 'development_plan_created',
  actor_id: ids.human,
  created_at: '2026-05-24T00:00:00.000Z',
  ...overrides,
});

const developmentPlanItemFixture = (overrides: Partial<DevelopmentPlanItem> = {}): DevelopmentPlanItem => ({
  id: ids.developmentPlanItem,
  development_plan_id: ids.developmentPlan,
  revision_id: ids.developmentPlanItemRevision1,
  source_ref: { type: 'requirement', id: ids.workItem, revision_id: ids.specRevision1 },
  title: 'Persist planning graph',
  summary: 'Persist context, planning, brainstorming, and execution planning records.',
  driver_actor_id: ids.human,
  responsible_role: 'developer',
  reviewer_actor_id: ids.human,
  leader_actor_id: ids.human,
  leader_delegate_actor_ids: [],
  risk: 'medium',
  dependency_hints: ['Task 1 contract refs'],
  affected_surfaces: ['packages/db', 'packages/domain'],
  boundary_status: 'approved',
  spec_status: 'approved',
  execution_plan_status: 'approved',
  execution_status: 'ready',
  review_status: 'missing',
  qa_handoff_status: 'missing',
  release_impact: 'release_scoped',
  next_action: 'Start execution from approved execution plan.',
  created_at: '2026-05-24T00:01:00.000Z',
  updated_at: '2026-05-24T00:01:00.000Z',
  ...overrides,
});

const developmentPlanItemRevisionFixture = (
  overrides: Partial<DevelopmentPlanItemRevision> = {},
): DevelopmentPlanItemRevision => ({
  id: ids.developmentPlanItemRevision1,
  development_plan_item_id: ids.developmentPlanItem,
  development_plan_id: ids.developmentPlan,
  revision_number: 1,
  snapshot: developmentPlanItemFixture(),
  change_reason: 'Initial generated row',
  edited_by_actor_id: ids.human,
  created_at: '2026-05-24T00:02:00.000Z',
  ...overrides,
});

const brainstormingSessionFixture = (overrides: Partial<BrainstormingSession> = {}): BrainstormingSession => ({
  id: ids.brainstormingSession,
  revision_id: ids.brainstormingSessionRevision,
  source_ref: { type: 'requirement', id: ids.workItem, revision_id: ids.specRevision1 },
  development_plan_id: ids.developmentPlan,
  development_plan_revision_id: ids.developmentPlanRevision2,
  development_plan_item_id: ids.developmentPlanItem,
  development_plan_item_revision_id: ids.developmentPlanItemRevision2,
  leader_actor_id: ids.human,
  leader_delegate_actor_ids: [],
  context_manifest_id: ids.contextManifest,
  context_manifest_revision_id: ids.contextManifestRevision,
  status: 'approved',
  current_round_id: ids.boundaryRound,
  latest_summary_revision_id: ids.boundarySummaryRevision,
  approved_summary_revision_id: ids.boundarySummaryRevision,
  questions: [
    {
      id: 'question-1',
      text: 'What DB shape is needed?',
      author_id: ids.human,
      created_at: '2026-05-24T00:02:00.000Z',
      status: 'resolved',
    },
  ],
  answers: [
    {
      id: 'answer-1',
      question_id: 'question-1',
      text: 'Use Drizzle schema plus repository contracts.',
      actor_id: ids.human,
      created_at: '2026-05-24T00:03:00.000Z',
    },
  ],
  decisions: [
    {
      id: 'decision-1',
      text: 'Persist the planning graph in first-class tables.',
      actor_id: ids.human,
      rationale: 'The AI-native UX needs durable planning handoffs.',
      created_at: '2026-05-24T00:03:30.000Z',
    },
  ],
  approval_state: 'approved',
  boundary_summary_id: ids.boundarySummary,
  approver_actor_id: ids.human,
  approved_at: '2026-05-24T00:04:00.000Z',
  created_at: '2026-05-24T00:02:00.000Z',
  updated_at: '2026-05-24T00:04:00.000Z',
  ...overrides,
});

const legacyBoundarySessionFixture = (
  overrides: Partial<BrainstormingSession> &
    Pick<BrainstormingSession, 'id' | 'development_plan_item_id' | 'development_plan_item_revision_id'>,
): BrainstormingSession => {
  const session = brainstormingSessionFixture({
    status: 'waiting_for_leader',
    questions: [],
    answers: [],
    decisions: [],
    approval_state: 'questions_open',
  });
  delete (session as Partial<BrainstormingSession>).leader_actor_id;
  delete (session as Partial<BrainstormingSession>).leader_delegate_actor_ids;
  delete (session as Partial<BrainstormingSession>).current_round_id;
  delete (session as Partial<BrainstormingSession>).latest_summary_revision_id;
  delete (session as Partial<BrainstormingSession>).approved_summary_revision_id;
  delete (session as Partial<BrainstormingSession>).boundary_summary_id;
  delete (session as Partial<BrainstormingSession>).approver_actor_id;
  delete (session as Partial<BrainstormingSession>).approved_at;
  return {
    ...session,
    ...overrides,
  } as BrainstormingSession;
};

const boundaryRoundFixture = (overrides: Partial<BoundaryRoundRecord> = {}): BoundaryRoundRecord => ({
  id: ids.boundaryRound,
  session_id: ids.brainstormingSession,
  session_revision_id: ids.brainstormingSessionRevision,
  round_number: 1,
  trigger: 'start',
  ai_output_markdown: 'Ask the Leader for the minimum persistence boundary.',
  status: 'terminal',
  created_at: '2026-05-24T00:02:00.000Z',
  updated_at: '2026-05-24T00:03:30.000Z',
  ...overrides,
});

const boundaryQuestionFixture = (overrides: Partial<BoundaryQuestionRecord> = {}): BoundaryQuestionRecord => ({
  id: 'question-1',
  session_id: ids.brainstormingSession,
  round_id: ids.boundaryRound,
  sequence: 1,
  text: 'What DB shape is needed?',
  author_id: ids.ai,
  created_at: '2026-05-24T00:02:00.000Z',
  status: 'resolved',
  required: true,
  answered_by_answer_id: 'answer-1',
  ...overrides,
});

const boundaryAnswerFixture = (overrides: Partial<BoundaryAnswerRecord> = {}): BoundaryAnswerRecord => ({
  id: 'answer-1',
  session_id: ids.brainstormingSession,
  round_id: ids.boundaryRound,
  question_id: 'question-1',
  sequence: 1,
  text: 'Use Drizzle schema plus repository contracts.',
  actor_id: ids.human,
  actor_role: 'leader',
  created_at: '2026-05-24T00:03:00.000Z',
  ...overrides,
});

const boundaryDecisionFixture = (overrides: Partial<BoundaryDecisionRecord> = {}): BoundaryDecisionRecord => ({
  id: 'decision-1',
  session_id: ids.brainstormingSession,
  round_id: ids.boundaryRound,
  sequence: 1,
  text: 'Persist the planning graph in first-class tables.',
  actor_id: ids.human,
  actor_role: 'leader',
  source: 'leader',
  state: 'accepted',
  rationale: 'The AI-native UX needs durable planning handoffs.',
  created_at: '2026-05-24T00:03:30.000Z',
  ...overrides,
});

const boundarySummaryFixture = (overrides: Partial<BoundarySummary> = {}): BoundarySummary => ({
  id: ids.boundarySummary,
  revision_id: ids.boundarySummaryRevision,
  brainstorming_session_id: ids.brainstormingSession,
  brainstorming_session_revision_id: ids.brainstormingSessionRevision,
  development_plan_id: ids.developmentPlan,
  development_plan_item_id: ids.developmentPlanItem,
  development_plan_item_revision_id: ids.developmentPlanItemRevision2,
  source_ref: { type: 'requirement', id: ids.workItem, revision_id: ids.specRevision1 },
  summary: 'Task 2 owns domain, schema, and repository persistence only.',
  approved_by_actor_id: ids.human,
  approved_at: '2026-05-24T00:04:00.000Z',
  created_at: '2026-05-24T00:04:00.000Z',
  updated_at: '2026-05-24T00:04:00.000Z',
  ...overrides,
});

const boundarySummaryRevisionFixture = (overrides: Partial<BoundarySummaryRevision> = {}): BoundarySummaryRevision => ({
  id: ids.boundarySummaryRevision,
  boundary_summary_id: ids.boundarySummary,
  brainstorming_session_id: ids.brainstormingSession,
  brainstorming_session_revision_id: ids.brainstormingSessionRevision,
  source_round_id: ids.boundaryRound,
  development_plan_id: ids.developmentPlan,
  development_plan_item_id: ids.developmentPlanItem,
  development_plan_item_revision_id: ids.developmentPlanItemRevision2,
  revision_number: 1,
  status: 'approved',
  summary_markdown: 'Task 2 scope is approved.',
  confirmed_scope: ['Repository persistence'],
  confirmed_out_of_scope: ['API orchestration'],
  accepted_assumptions: ['Existing product surfaces keep compatibility arrays during migration.'],
  open_risks: ['Drizzle migrations must preserve immutable revision ordering.'],
  validation_expectations: ['Repository contract passes for in-memory and Drizzle adapters.'],
  question_answer_snapshot: [{ question_id: 'question-1', answer_id: 'answer-1', text: boundaryAnswerFixture().text }],
  decision_snapshot: [{ decision_id: 'decision-1', text: boundaryDecisionFixture().text, rationale: boundaryDecisionFixture().rationale }],
  decision_count: 1,
  context_manifest_id: ids.contextManifest,
  context_manifest_revision_id: ids.contextManifestRevision,
  approved_by_actor_id: ids.human,
  approved_at: '2026-05-24T00:04:00.000Z',
  created_at: '2026-05-24T00:04:00.000Z',
  ...overrides,
}) as BoundarySummaryRevision;

const specFixture = (overrides: Partial<Spec> = {}): Spec => ({
  id: ids.spec,
  work_item_id: ids.workItem,
  entity_type: 'spec',
  status: 'approved',
  editing_state: 'idle',
  gate_state: 'approved',
  resolution: 'approved',
  current_revision_id: ids.specRevision1,
  approved_revision_id: ids.specRevision1,
  approved_at: '2026-05-24T00:05:00.000Z',
  approved_by_actor_id: ids.human,
  development_plan_item_id: ids.developmentPlanItem,
  boundary_summary_id: ids.boundarySummary,
  context_manifest_id: ids.contextManifest,
  created_at: '2026-05-24T00:05:00.000Z',
  updated_at: '2026-05-24T00:05:00.000Z',
  ...overrides,
});

const specRevisionFixture = (overrides: Partial<SpecRevision> = {}): SpecRevision => ({
  id: ids.specRevision1,
  spec_id: ids.spec,
  work_item_id: ids.workItem,
  revision_number: 1,
  summary: 'Approved persistence spec',
  content: 'Persist the AI-native planning graph.',
  background: 'Task 1 added contract refs.',
  goals: ['Persist planning graph objects'],
  scope_in: ['Domain', 'DB schema', 'Repository adapters'],
  scope_out: ['Public UX changes'],
  acceptance_criteria: ['Repository contract passes'],
  risk_notes: ['Keep legacy Work Item Owner semantics out of product refs'],
  test_strategy_summary: 'Repository contract tests',
  structured_document: { sections: ['goal', 'scope'], boundary_summary_revision_id: ids.boundarySummaryRevision },
  author_actor_id: ids.human,
  artifact_refs: [artifactRef('spec', 'approved persistence spec')],
  development_plan_item_id: ids.developmentPlanItem,
  boundary_summary_id: ids.boundarySummary,
  context_manifest_id: ids.contextManifest,
  created_at: '2026-05-24T00:05:00.000Z',
  ...overrides,
});

const executionPlanFixture = (overrides: Partial<ExecutionPlanDocument> = {}): ExecutionPlanDocument => ({
  id: ids.executionPlan,
  development_plan_item_id: ids.developmentPlanItem,
  status: 'approved',
  current_revision_id: ids.executionPlanRevision,
  approved_revision_id: ids.executionPlanRevision,
  approved_by_actor_id: ids.human,
  approved_at: '2026-05-24T00:06:00.000Z',
  created_at: '2026-05-24T00:06:00.000Z',
  updated_at: '2026-05-24T00:06:00.000Z',
  ...overrides,
});

const executionPlanRevisionFixture = (overrides: Partial<ExecutionPlanRevision> = {}): ExecutionPlanRevision => ({
  id: ids.executionPlanRevision,
  execution_plan_id: ids.executionPlan,
  development_plan_item_id: ids.developmentPlanItem,
  based_on_spec_revision_id: ids.specRevision1,
  revision_number: 1,
  summary: 'Approved execution plan',
  content: 'Implement the planning graph persistence task.',
  structured_document: { steps: ['schema', 'repository', 'verification'] },
  author_actor_id: ids.human,
  created_at: '2026-05-24T00:06:00.000Z',
  ...overrides,
});

const executionFixture = (overrides: Partial<Execution> = {}): Execution => ({
  id: ids.execution,
  ref: { type: 'execution', id: ids.execution, title: 'Task 2 execution' },
  development_plan_item_id: ids.developmentPlanItem,
  development_plan_item_ref: {
    type: 'development_plan_item',
    id: ids.developmentPlanItem,
    development_plan_id: ids.developmentPlan,
    revision_id: ids.developmentPlanItemRevision2,
    title: 'Persist planning graph',
  },
  execution_plan_revision_id: ids.executionPlanRevision,
  execution_plan_revision_ref: {
    type: 'execution_plan_revision',
    id: ids.executionPlanRevision,
    execution_plan_id: ids.executionPlan,
    title: 'Approved execution plan',
  },
  approved_spec_revision_id: ids.specRevision1,
  approved_spec_revision_ref: {
    type: 'spec_revision',
    id: ids.specRevision1,
    spec_id: ids.spec,
    title: 'Spec revision 1',
  },
  status: 'ready',
  evidence_refs: [],
  runtime_evidence_refs: [],
  interrupt_history: [{ at: '2026-05-24T00:07:30.000Z', reason: 'Paused for repository contract verification.' }],
  continuation_history: [{ at: '2026-05-24T00:08:00.000Z', summary: 'Resumed for repository contract verification.' }],
  pr_refs: [{ id: 'pr-repository-contract', title: 'Repository contract PR' }],
  diff_refs: [{ id: 'diff-repository-contract', title: 'Repository contract diff' }],
  test_evidence_refs: [{ id: 'test-repository-contract', title: 'Repository contract tests' }],
  created_at: '2026-05-24T00:07:00.000Z',
  updated_at: '2026-05-24T00:07:00.000Z',
  ...overrides,
});

const executionPackageFixture = (overrides: Partial<ExecutionPackage> = {}): ExecutionPackage => ({
  id: ids.package,
  work_item_id: ids.workItem,
  development_plan_item_id: ids.developmentPlanItem,
  execution_id: ids.execution,
  spec_id: ids.spec,
  spec_revision_id: ids.specRevision1,
  execution_plan_id: ids.executionPlan,
  execution_plan_revision_id: ids.executionPlanRevision,
  plan_id: ids.plan,
  plan_revision_id: ids.planRevision1,
  project_id: ids.project,
  repo_id: 'repo-1',
  objective: 'Persist the AI-native planning graph.',
  owner_actor_id: ids.human,
  reviewer_actor_id: ids.human,
  qa_owner_actor_id: ids.human,
  phase: 'ready',
  activity_state: 'idle',
  gate_state: 'not_submitted',
  resolution: 'none',
  required_checks: [requiredCheck],
  required_test_gates: [],
  required_artifact_kinds: ['execution_summary'],
  allowed_paths: ['packages/domain/**', 'packages/db/**', 'tests/db/**'],
  forbidden_paths: ['apps/**'],
  source_mutation_policy: 'path_policy_scoped',
  version: 0,
  created_at: '2026-05-24T00:08:00.000Z',
  updated_at: '2026-05-24T00:08:00.000Z',
  ...overrides,
});

const artifactRef = (kind: string, name: string) => ({
  kind,
  name,
  content_type: 'text/plain',
  local_ref: `artifacts/${name.replaceAll(' ', '-')}.txt`,
});

const specRevision = (id: string, revisionNumber: number, summary: string): SpecRevision => ({
  id,
  spec_id: ids.spec,
  work_item_id: ids.workItem,
  revision_number: revisionNumber,
  summary,
  content: `${summary} body`,
  background: 'Background',
  goals: ['Persist the release graph'],
  scope_in: ['Repository contract'],
  scope_out: ['Product UI'],
  acceptance_criteria: ['Contract passes'],
  risk_notes: ['Reset must be guarded'],
  test_strategy_summary: 'Vitest',
  structured_document: { sections: ['goal'] },
  author_actor_id: ids.human,
  artifact_refs: [artifactRef('spec', summary)],
  created_at: revisionNumber === 1 ? at : later,
});

const planRevision = (
  id: string,
  revisionNumber: number,
  basedOnSpecRevisionId: string,
  summary: string,
): PlanRevision => ({
  id,
  plan_id: ids.plan,
  work_item_id: ids.workItem,
  based_on_spec_revision_id: basedOnSpecRevisionId,
  revision_number: revisionNumber,
  summary,
  content: `${summary} body`,
  implementation_summary: 'Implement repository contract.',
  split_strategy: 'One DB package contract.',
  dependency_order: [ids.package],
  test_matrix: ['pnpm vitest run tests/db/repository.test.ts'],
  risk_mitigations: ['Guard DB reset'],
  rollback_notes: 'Revert repository changes.',
  structured_document: { steps: ['contract'] },
  author_actor_id: ids.human,
  artifact_refs: [artifactRef('plan', summary)],
  created_at: revisionNumber === 1 ? at : later,
});

type ApprovedSpecProjectionCandidate = {
  workItemId: string;
  specId: string;
  specWorkItemId?: string;
  approvedRevisionId: string;
  specRevisionSpecId?: string;
  specRevisionWorkItemId?: string;
  draftRevisionId?: string;
  title: string;
  goal: string;
  successCriteria: string[];
  specCurrentRevisionId?: string;
  workItemSpecRevisionId?: string | null;
};

const saveApprovedSpecProjectionCandidate = async (
  repository: DeliveryRepository,
  input: ApprovedSpecProjectionCandidate,
): Promise<void> => {
  await repository.saveWorkItem({
    id: input.workItemId,
    project_id: ids.project,
    kind: 'requirement',
    title: input.title,
    goal: input.goal,
    success_criteria: input.successCriteria,
    priority: 'p1',
    risk: 'low',
    driver_actor_id: ids.human,
    intake_context: requirementIntakeContext,
    phase: 'plan',
    activity_state: 'idle',
    gate_state: 'none',
    resolution: 'none',
    current_spec_id: input.specId,
    ...(input.workItemSpecRevisionId === null
      ? {}
      : { current_spec_revision_id: input.workItemSpecRevisionId ?? input.approvedRevisionId }),
    created_at: at,
    updated_at: at,
  });
  await repository.saveSpec({
    id: input.specId,
    work_item_id: input.specWorkItemId ?? input.workItemId,
    entity_type: 'spec',
    status: 'approved',
    editing_state: 'idle',
    gate_state: 'approved',
    resolution: 'approved',
    current_revision_id: input.specCurrentRevisionId ?? input.approvedRevisionId,
    approved_revision_id: input.approvedRevisionId,
    approved_at: at,
    approved_by_actor_id: ids.human,
    created_at: at,
    updated_at: later,
  });
  const approvedRevision = specRevision(input.approvedRevisionId, 1, `${input.title} approved`);
  await repository.saveSpecRevision({
    ...approvedRevision,
    id: input.approvedRevisionId,
    spec_id: input.specRevisionSpecId ?? input.specId,
    work_item_id: input.specRevisionWorkItemId ?? input.workItemId,
  });
  if (input.draftRevisionId !== undefined) {
    await repository.saveSpecRevision({
      ...approvedRevision,
      id: input.draftRevisionId,
      spec_id: input.specId,
      work_item_id: input.workItemId,
      revision_number: 2,
      summary: `${input.title} draft`,
      created_at: later,
    });
  }
};

type ApprovedPlanProjectionCandidate = {
  workItemId: string;
  specId: string;
  approvedSpecRevisionId: string;
  specRevisionSpecId?: string;
  specRevisionWorkItemId?: string;
  staleSpecRevisionId?: string;
  planId: string;
  planWorkItemId?: string;
  approvedPlanRevisionId: string;
  planRevisionPlanId?: string;
  draftPlanRevisionId?: string;
  title: string;
  goal: string;
  successCriteria: string[];
  workItemPlanId?: string;
  workItemSpecRevisionId?: string | null;
  workItemPlanRevisionId?: string | null;
  planCurrentRevisionId?: string;
  planBasedOnSpecRevisionId?: string;
};

const saveApprovedPlanProjectionCandidate = async (
  repository: DeliveryRepository,
  input: ApprovedPlanProjectionCandidate,
): Promise<void> => {
  await repository.saveWorkItem({
    id: input.workItemId,
    project_id: ids.project,
    kind: 'requirement',
    title: input.title,
    goal: input.goal,
    success_criteria: input.successCriteria,
    priority: 'p1',
    risk: 'low',
    driver_actor_id: ids.human,
    intake_context: requirementIntakeContext,
    phase: 'execution',
    activity_state: 'idle',
    gate_state: 'none',
    resolution: 'none',
    current_spec_id: input.specId,
    ...(input.workItemSpecRevisionId === null
      ? {}
      : { current_spec_revision_id: input.workItemSpecRevisionId ?? input.approvedSpecRevisionId }),
    current_plan_id: input.workItemPlanId ?? input.planId,
    ...(input.workItemPlanRevisionId === null
      ? {}
      : { current_plan_revision_id: input.workItemPlanRevisionId ?? input.approvedPlanRevisionId }),
    created_at: at,
    updated_at: at,
  });
  await repository.saveSpec({
    id: input.specId,
    work_item_id: input.workItemId,
    entity_type: 'spec',
    status: 'approved',
    editing_state: 'idle',
    gate_state: 'approved',
    resolution: 'approved',
    current_revision_id: input.approvedSpecRevisionId,
    approved_revision_id: input.approvedSpecRevisionId,
    approved_at: at,
    approved_by_actor_id: ids.human,
    created_at: at,
    updated_at: later,
  });
  const approvedSpecRevision = specRevision(input.approvedSpecRevisionId, 1, `${input.title} spec`);
  await repository.saveSpecRevision({
    ...approvedSpecRevision,
    id: input.approvedSpecRevisionId,
    spec_id: input.specRevisionSpecId ?? input.specId,
    work_item_id: input.specRevisionWorkItemId ?? input.workItemId,
  });
  if (input.staleSpecRevisionId !== undefined) {
    await repository.saveSpecRevision({
      ...approvedSpecRevision,
      id: input.staleSpecRevisionId,
      spec_id: input.specId,
      work_item_id: input.workItemId,
      revision_number: 0,
      summary: `${input.title} stale spec`,
      created_at: at,
    });
  }
  await repository.savePlan({
    id: input.planId,
    work_item_id: input.planWorkItemId ?? input.workItemId,
    entity_type: 'plan',
    status: 'approved',
    editing_state: 'idle',
    gate_state: 'approved',
    resolution: 'approved',
    current_revision_id: input.planCurrentRevisionId ?? input.approvedPlanRevisionId,
    approved_revision_id: input.approvedPlanRevisionId,
    approved_at: at,
    approved_by_actor_id: ids.human,
    created_at: at,
    updated_at: later,
  });
  const approvedPlanRevision = planRevision(
    input.approvedPlanRevisionId,
    1,
    input.planBasedOnSpecRevisionId ?? input.approvedSpecRevisionId,
    `${input.title} approved`,
  );
  await repository.savePlanRevision({
    ...approvedPlanRevision,
    id: input.approvedPlanRevisionId,
    plan_id: input.planRevisionPlanId ?? input.planId,
    work_item_id: input.workItemId,
  });
  if (input.draftPlanRevisionId !== undefined) {
    await repository.savePlanRevision({
      ...approvedPlanRevision,
      id: input.draftPlanRevisionId,
      plan_id: input.planId,
      work_item_id: input.workItemId,
      revision_number: 2,
      summary: `${input.title} draft`,
      created_at: later,
    });
  }
};

const runEvent = (id: string, summary: string, createdAt: string): Omit<RunEvent, 'sequence' | 'cursor'> => ({
  id,
  run_session_id: ids.runSession,
  event_type: 'run_log',
  source: 'system',
  visibility: 'internal',
  summary,
  payload: { summary },
  created_at: createdAt,
});

const traceLink = (
  id: string,
  traceEventId: string,
  relationship: TraceLinkRecord['relationship'],
  objectType: string,
  objectId: string,
  createdAt: string,
): TraceLinkRecord => ({
  id,
  trace_event_id: traceEventId,
  relationship,
  object_type: objectType,
  object_id: objectId,
  created_at: createdAt,
});
