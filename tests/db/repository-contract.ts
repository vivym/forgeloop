import { expect } from 'vitest';
import type {
  Actor,
  Artifact,
  Decision,
  ExecutionPackage,
  ExecutionPackageDependency,
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
  P0Repository,
  ReleaseExecutionPackageRecord,
  ReleaseWorkItemRecord,
  TraceArtifactRefRecord,
  TraceEventRecord,
  TraceLinkRecord,
} from '../../packages/db/src/index';

const at = '2026-05-05T00:00:00.000Z';
const later = '2026-05-05T00:01:00.000Z';

const ids = {
  org: '11111111-1111-4111-8111-111111111111',
  human: '11111111-1111-4111-8111-111111111112',
  system: '11111111-1111-4111-8111-111111111113',
  ai: '11111111-1111-4111-8111-111111111114',
  project: '22222222-2222-4222-8222-222222222221',
  workItem: '33333333-3333-4333-8333-333333333331',
  spec: '44444444-4444-4444-8444-444444444441',
  specRevision1: '44444444-4444-4444-8444-444444444442',
  specRevision2: '44444444-4444-4444-8444-444444444443',
  plan: '55555555-5555-4555-8555-555555555551',
  planRevision1: '55555555-5555-4555-8555-555555555552',
  planRevision2: '55555555-5555-4555-8555-555555555553',
  package: '66666666-6666-4666-8666-666666666661',
  dependency: '66666666-6666-4666-8666-666666666662',
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

export async function runP0RepositoryContract(repository: P0Repository): Promise<void> {
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
    integration_readiness: {
      status: 'ready',
      checked_at: later,
      notes: ['Review approved and DB tests passed.'],
    },
    current_run_session_id: ids.runSession,
    last_run_session_id: ids.runSession,
    current_review_packet_id: ids.reviewPacket,
    current_release_id: ids.release,
    created_at: at,
    updated_at: later,
  };
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
    work_item_ids: [ids.workItem],
    execution_package_ids: [ids.package],
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
  const releaseExecutionPackage: ReleaseExecutionPackageRecord = {
    release_id: ids.release,
    execution_package_id: ids.package,
  };
  await repository.saveRelease(release);
  await repository.saveReleaseWorkItem(releaseWorkItem);
  await repository.saveReleaseExecutionPackage(releaseExecutionPackage);

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
  expect(await repository.listReleasesForProject(ids.project)).toEqual([release]);
  expect(await repository.listReleaseWorkItems(ids.release)).toEqual([releaseWorkItem]);
  expect(await repository.listReleaseExecutionPackages(ids.release)).toEqual([releaseExecutionPackage]);
  expect(await repository.getReleaseEvidence(ids.releaseEvidenceReview)).toEqual(evidences[0]);
  expect(await repository.listReleaseEvidences(ids.release)).toEqual(evidences);

  const objectEvent: ObjectEvent = {
    id: 'object-event-1',
    object_type: 'release',
    object_id: ids.release,
    event_type: 'approved',
    actor_id: ids.human,
    actor_type: 'human',
    reason: 'Review approved.',
    payload: { review_packet_id: ids.reviewPacket },
    metadata: { legacy_payload: false },
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
