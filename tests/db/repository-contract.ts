import { expect } from 'vitest';
import type {
  Actor,
  AutomationActionRun,
  Artifact,
  CommandIdempotencyRecord,
  Decision,
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
  DeliveryRepository,
  ReleaseExecutionPackageRecord,
  ReleaseWorkItemRecord,
  TraceArtifactRefRecord,
  TraceEventRecord,
  TraceLinkRecord,
} from '../../packages/db/src/index';

const at = '2026-05-05T00:00:00.000Z';
const later = '2026-05-05T00:01:00.000Z';

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
    goal: 'Persist the release-ready delivery graph.',
    success_criteria: ['Repository contract passes for memory and Drizzle.'],
    priority: 'p1',
    risk: 'medium',
    owner_actor_id: ids.human,
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
      canGeneratePlanDraft: false,
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
  expect(settings.capabilities_json.canGeneratePlanDraft).toBe(true);
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
    command_name: 'ensure_plan',
    idempotency_key: 'command-key-1',
    target_object_type: 'work_item',
    target_object_id: ids.workItem,
    target_revision_id: ids.specRevision2,
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

  const generationRun = await repository.claimExecutionPackageGenerationRun({
    plan_revision_id: ids.planRevision2,
    generation_key: `default:${ids.planRevision2}`,
    generator_version: 'mock-plan-splitter@1',
    policy_digest: 'sha256-policy-a',
    manifest_digest: 'sha256-manifest-a',
    expected_package_count: 2,
    expected_package_keys: ['api', 'tests'],
    claim_token: 'generation-claim-1',
    now: at,
    locked_until: '2026-05-05T00:05:00.000Z',
  });
  expect(generationRun.status).toBe('running');
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
    action_type: 'generate_plan_draft',
    target_object_type: 'work_item',
    target_object_id: ids.workItem,
    target_revision_id: ids.specRevision2,
    target_status: 'approved',
    idempotency_key: 'action-key-contract',
    automation_scope: `repo:${ids.project}:repo-1`,
    automation_settings_version: 2,
    capability_fingerprint: disabled.capability_fingerprint,
    precondition_fingerprint: 'precondition-contract-active',
    action_input_json: { work_item_id: ids.workItem, spec_revision_id: ids.specRevision2 },
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
    action_type: 'ensure_plan_draft',
    target_object_type: 'work_item',
    target_object_id: ids.workItem,
    target_revision_id: ids.specRevision2,
    target_status: 'approved',
    target_version: 1,
    idempotency_key: 'action-key-contract-pending',
    automation_scope: `repo:${ids.project}:repo-contract-pending` as const,
    automation_settings_version: 2,
    capability_fingerprint: disabled.capability_fingerprint,
    precondition_fingerprint: 'precondition-contract-a',
    action_input_json: { work_item_id: ids.workItem, spec_revision_id: ids.specRevision2 },
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
        spec_revision_id: ids.specRevision2,
        work_item_id: ids.workItem,
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
      action_input_json: { work_item_id: ids.workItem2, spec_revision_id: ids.specRevision2 },
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
