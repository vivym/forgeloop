import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { actorClassHeaderName, actorHeaderName } from '../../apps/control-plane-api/src/modules/auth/actor-context';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import { InMemoryDeliveryRepository, type DeliveryRepository } from '../../packages/db/src';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  buildSessionHealthProjection,
  type Actor,
  type CodexRuntimeCapsule,
  type CodexRuntimeJob,
  type CodexSession,
  type PlanItemWorkflow,
  type RunSession,
  type SessionRecoveryCandidatePredicate,
} from '../../packages/domain/src';
import { idsFor, seedDevelopmentPlanItem, startWorkflow } from './plan-item-workflow-fixtures';

const now = '2026-06-09T00:00:00.000Z';
const later = '2026-06-09T00:08:00.000Z';

export const signedHumanHeaders = (actorId: string) => ({
  [actorHeaderName]: actorId,
  [actorClassHeaderName]: 'human_admin',
});

export const signedDeveloperHeaders = (actorId: string) => ({
  [actorHeaderName]: actorId,
  [actorClassHeaderName]: 'human',
});

export async function createSessionOperationsTestApp() {
  const repository = new InMemoryDeliveryRepository();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DELIVERY_REPOSITORY)
    .useValue(repository)
    .overrideProvider(DELIVERY_RUN_WORKER)
    .useValue({ kick: () => undefined, drainOnce: async () => undefined })
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, repository };
}

export async function buildFreshOperatorHealthCandidate(app: INestApplication, sessionId: string, actorId: string) {
  const response = await request(app.getHttpServer())
    .get(`/session-operations/health?codex_session_id=${sessionId}`)
    .set(signedHumanHeaders(actorId))
    .expect(200);
  const item = response.body.items.find((candidate: { codex_session_id?: string }) => candidate.codex_session_id === sessionId);
  if (item === undefined) {
    throw new Error(`No session operations health candidate for ${sessionId}`);
  }
  return item as { candidate_predicate?: SessionRecoveryCandidatePredicate };
}

export async function seedBlockedStaleLeaseStateOnly(idPrefix: string) {
  const { app } = await createSessionOperationsTestApp();
  return seedBlockedStaleLeaseStateOnlyInApp(app, idPrefix);
}

export async function seedBlockedStaleLeaseStateOnlyInApp(app: INestApplication, idPrefix: string) {
  const seeded = await seedDevelopmentPlanItem(app, { idPrefix });
  await startWorkflow(app, seeded.plan.id, seeded.item.id);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const workflow = await repository.getActivePlanItemWorkflowByItem(seeded.item.id);
  if (workflow?.active_codex_session_id === undefined) {
    throw new Error(`Workflow for Plan Item ${seeded.item.id} has no active Codex session`);
  }
  const sessionId = workflow.active_codex_session_id as string;

  await repository.claimCodexSessionLease({
    session_id: sessionId,
    workflow_id: workflow.id,
    lease_id: `${idPrefix}-1111-4111-8111-111111112001`,
    worker_id: seeded.ids.actorDelegate,
    worker_session_digest: `sha256:${'b'.repeat(64)}`,
    lease_token_hash: `sha256:${'1'.repeat(64)}`,
    now,
    expires_at: '2026-06-09T00:01:00.000Z',
  });

  return {
    app,
    repository,
    sessionId,
    workflowId: workflow.id as string,
    itemId: seeded.item.id,
    actorId: seeded.ids.actorTech,
    developerActorId: seeded.ids.actorDelegate,
    outOfScopeOperatorActorId: seeded.ids.actorUnauthorized,
  };
}

export async function seedBlockedStaleLeaseCandidate(idPrefix: string) {
  const stateOnly = await seedBlockedStaleLeaseStateOnly(idPrefix);
  const health = await buildFreshOperatorHealthCandidate(stateOnly.app, stateOnly.sessionId, stateOnly.actorId);
  return { ...stateOnly, predicate: requiredPredicate(health) };
}

export async function seedBlockedStaleLeaseCandidateInApp(app: INestApplication, idPrefix: string) {
  const stateOnly = await seedBlockedStaleLeaseStateOnlyInApp(app, idPrefix);
  const health = await buildFreshOperatorHealthCandidate(app, stateOnly.sessionId, stateOnly.actorId);
  return { ...stateOnly, predicate: requiredPredicate(health) };
}

export async function seedBlockedMissingCapsuleCandidate(idPrefix: string) {
  const { app } = await createSessionOperationsTestApp();
  return seedBlockedMissingCapsuleCandidateInApp(app, idPrefix);
}

export async function seedBlockedMissingCapsuleCandidateInApp(app: INestApplication, idPrefix: string) {
  const seeded = await seedDevelopmentPlanItem(app, { idPrefix });
  await startWorkflow(app, seeded.plan.id, seeded.item.id);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const workflow = await repository.getActivePlanItemWorkflowByItem(seeded.item.id);
  if (workflow?.active_codex_session_id === undefined) {
    throw new Error(`Workflow for Plan Item ${seeded.item.id} has no active Codex session`);
  }
  const sessionId = workflow.active_codex_session_id as string;
  setInMemorySessionLatestCapsule(repository, {
    session_id: sessionId,
    latest_capsule_id: `${idPrefix}-1111-4111-8111-111111113001`,
    latest_capsule_digest: `sha256:${'c'.repeat(64)}`,
    now,
  });
  const health = await buildFreshOperatorHealthCandidate(app, sessionId, seeded.ids.actorTech);
  return {
    app,
    repository,
    sessionId,
    workflowId: workflow.id as string,
    itemId: seeded.item.id,
    actorId: seeded.ids.actorTech,
    predicate: requiredPredicate(health),
  };
}

export async function seedExternalActorForSessionOperations(
  app: INestApplication,
  idPrefix: string,
): Promise<{ actorId: string; orgId: string }> {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const orgId = `${idPrefix}-2222-4222-8222-222222221001`;
  const actorId = `${idPrefix}-2222-4222-8222-222222221101`;
  await repository.saveOrganization({ id: orgId, name: 'External Org', created_at: now, updated_at: now });
  const actor: Actor = {
    id: actorId,
    org_id: orgId,
    display_name: 'External Operator',
    actor_type: 'human',
    created_at: now,
    updated_at: now,
  };
  await repository.saveActor(actor);
  return { actorId, orgId };
}

export async function seedBlockedOrphanQueuedActionCandidate(idPrefix: string) {
  const { app } = await createSessionOperationsTestApp();
  const seeded = await seedDevelopmentPlanItem(app, { idPrefix });
  await startWorkflow(app, seeded.plan.id, seeded.item.id);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const workflow = await repository.getActivePlanItemWorkflowByItem(seeded.item.id);
  if (workflow?.active_codex_session_id === undefined) {
    throw new Error(`Workflow for Plan Item ${seeded.item.id} has no active Codex session`);
  }
  const sessionId = workflow.active_codex_session_id;
  const action = await repository.createOrReplayPlanItemWorkflowQueuedAction({
    id: `${idPrefix}-1111-4111-8111-111111114001`,
    workflow_id: workflow.id,
    codex_session_id: sessionId,
    kind: 'continue_brainstorming',
    status: 'queued',
    context_preview_digest: codexCanonicalDigest({ kind: 'session-operations-orphan-action-context', idPrefix }),
    idempotency_key: codexCanonicalDigest({ kind: 'session-operations-orphan-action', idPrefix }),
    created_by_actor_id: seeded.ids.actorTech,
    created_at: now,
    updated_at: now,
  });
  const health = await buildFreshOperatorHealthCandidate(app, sessionId, seeded.ids.actorTech);
  return {
    app,
    repository,
    sessionId,
    workflowId: workflow.id,
    itemId: seeded.item.id,
    actorId: seeded.ids.actorTech,
    actionId: action.id,
    predicate: requiredPredicate(health),
  };
}

export async function seedBlockedOrphanRuntimeRunSessionCandidate(idPrefix: string) {
  const { app } = await createSessionOperationsTestApp();
  const seeded = await seedDevelopmentPlanItem(app, { idPrefix });
  await startWorkflow(app, seeded.plan.id, seeded.item.id);
  const repository = app.get(DELIVERY_REPOSITORY) as InMemoryDeliveryRepository;
  const workflow = await repository.getActivePlanItemWorkflowByItem(seeded.item.id);
  if (workflow?.active_codex_session_id === undefined) {
    throw new Error(`Workflow for Plan Item ${seeded.item.id} has no active Codex session`);
  }
  const sessionId = workflow.active_codex_session_id;
  await staleActiveQueuedActions(repository, workflow.id);
  const runtimeJobId = `${idPrefix}-1111-4111-8111-111111115001`;
  const runSessionId = `${idPrefix}-1111-4111-8111-111111115002`;
  const turnId = `${idPrefix}-1111-4111-8111-111111115003`;
  const nowUpdated = '2026-06-09T00:02:00.000Z';
  const runtimeJob: CodexRuntimeJob = {
    id: runtimeJobId,
    job_request_id: `${idPrefix}-session-ops-runtime-request`,
    target_type: 'plan_item_workflow_action',
    target_id: workflow.id,
    target_kind: 'generation',
    project_id: seeded.ids.project,
    repo_id: seeded.ids.repo,
    worker_id: seeded.ids.actorDelegate,
    launch_lease_id: `${idPrefix}-1111-4111-8111-111111115004`,
    launch_attempt: 1,
    status: 'running',
    input_digest: codexCanonicalDigest({ kind: 'session-operations-orphan-runtime-input', idPrefix }),
    input_json: { kind: 'session-operations-orphan-runtime' },
    workflow_id: workflow.id,
    codex_session_id: sessionId,
    codex_session_turn_id: turnId,
    accepted_worker_session_digest: `sha256:${'9'.repeat(64)}`,
    expires_at: '2026-06-09T00:10:00.000Z',
    created_at: now,
    updated_at: nowUpdated,
  };
  const runSession: RunSession = {
    id: runSessionId,
    execution_package_id: `${idPrefix}-1111-4111-8111-111111115005`,
    workflow_id: workflow.id,
    codex_session_id: sessionId,
    codex_session_turn_id: turnId,
    requested_by_actor_id: seeded.ids.actorTech,
    status: 'running',
    executor_type: 'codex',
    changed_files: [],
    check_results: [],
    artifacts: [],
    log_refs: [],
    runtime_metadata: { runtime_job_id: runtimeJobId },
    created_at: now,
    updated_at: nowUpdated,
    started_at: nowUpdated,
  };
  const repositoryInternals = repository as unknown as {
    codexRuntimeJobs: Map<string, { job: CodexRuntimeJob } & Record<string, unknown>>;
    codexSessionTurns: Map<string, { runtime_job_id?: string } & Record<string, unknown>>;
  };
  repositoryInternals.codexRuntimeJobs.set(runtimeJobId, {
    job: runtimeJob,
    runtime_profile_digest: codexCanonicalDigest({ kind: 'session-operations-runtime-profile', idPrefix }),
    credential_binding_id: seeded.ids.credentialBinding,
    credential_binding_version_id: seeded.ids.credentialBindingVersion,
    credential_payload_digest: codexCredentialPayloadDigest(`session-ops-runtime-${idPrefix}`),
    docker_image_digest: `sha256:${'6'.repeat(64)}`,
    network_policy_digest: `sha256:${'7'.repeat(64)}`,
    envelope_id: `${idPrefix}-1111-4111-8111-111111115006`,
    envelope_digest: `sha256:${'8'.repeat(64)}`,
  });
  await repository.saveRunSession(runSession);
  await repository.createCodexSessionTurn({
    id: turnId,
    workflow_id: workflow.id,
    codex_session_id: sessionId,
    intent: 'continue_brainstorming',
    status: 'running',
    input_digest: codexCanonicalDigest({ kind: 'session-operations-runtime-turn', idPrefix }),
    created_by_actor_id: seeded.ids.actorTech,
    created_at: nowUpdated,
    updated_at: nowUpdated,
  });
  const turn = repositoryInternals.codexSessionTurns.get(turnId);
  if (turn === undefined) {
    throw new Error(`Codex session turn ${turnId} is missing`);
  }
  repositoryInternals.codexSessionTurns.set(turnId, { ...turn, runtime_job_id: runtimeJobId });
  await repository.markCodexSessionRunnerOwner({
    session_id: sessionId,
    workflow_id: workflow.id,
    runner_worker_id: seeded.ids.actorDelegate,
    runner_launch_lease_id: runtimeJob.launch_lease_id,
    runner_runtime_job_id: runtimeJob.id,
    runner_expires_at: '2026-06-09T00:10:00.000Z',
    now: nowUpdated,
  });
  const health = await buildFreshOperatorHealthCandidate(app, sessionId, seeded.ids.actorTech);
  return {
    app,
    repository,
    sessionId,
    workflowId: workflow.id,
    itemId: seeded.item.id,
    actorId: seeded.ids.actorTech,
    runtimeJobId,
    runSessionId,
    predicate: requiredPredicate(health),
  };
}

export async function seedBlockedLineageConflictCandidate(idPrefix: string) {
  const { app } = await createSessionOperationsTestApp();
  const seeded = await seedDevelopmentPlanItem(app, { idPrefix });
  await startWorkflow(app, seeded.plan.id, seeded.item.id);
  const repository = app.get(DELIVERY_REPOSITORY) as InMemoryDeliveryRepository;
  const workflow = await repository.getActivePlanItemWorkflowByItem(seeded.item.id);
  if (workflow?.active_codex_session_id === undefined) {
    throw new Error(`Workflow for Plan Item ${seeded.item.id} has no active Codex session`);
  }
  const sessionId = workflow.active_codex_session_id;
  await staleActiveQueuedActions(repository, workflow.id);
  const inserted = insertInMemoryPlanItemWorkflowForSessionOperationsFixture(repository, {
    workflow_id: workflow.id,
    codex_session_id: `${idPrefix}-1111-4111-8111-111111116001`,
    development_plan_id: workflow.development_plan_id,
    development_plan_item_id: workflow.development_plan_item_id,
    runtime_profile_id: seeded.ids.runtimeProfile,
    runtime_profile_revision_id: seeded.ids.runtimeProfileRevision,
    credential_binding_id: seeded.ids.credentialBinding,
    credential_binding_version_id: seeded.ids.credentialBindingVersion,
    actor_id: seeded.ids.actorTech,
    now: '2026-06-09T00:05:00.000Z',
  });
  const originalSession = await repository.getCodexSession(sessionId);
  if (originalSession === undefined) {
    throw new Error(`Codex session ${sessionId} is missing`);
  }
  const plan = await repository.getDevelopmentPlan(workflow.development_plan_id);
  if (plan === undefined) {
    throw new Error(`Development Plan ${workflow.development_plan_id} is missing`);
  }
  const project = await repository.getProject(plan.project_id);
  const health = buildSessionHealthProjection({
    project_id: plan.project_id,
    ...(project?.org_id === undefined ? {} : { organization_id: project.org_id }),
    checked_at: '2026-06-09T00:05:00.000Z',
    workflow: inserted.workflow,
    session: originalSession,
    workflow_resolution: 'active_workflow',
    plan_item_id: workflow.development_plan_item_id,
  });
  await repository.upsertPlanItemSessionHealth(health);
  return {
    app,
    repository,
    sessionId,
    itemId: seeded.item.id,
    actorId: seeded.ids.actorTech,
    predicate: requiredPredicate(health),
  };
}

export async function seedAmbiguousWorkflowForPlanItem(app: INestApplication, seeded: Awaited<ReturnType<typeof seedDevelopmentPlanItem>>) {
  const repository = app.get(DELIVERY_REPOSITORY) as InMemoryDeliveryRepository;
  const fixtureIds = idsFor(seeded.plan.id.slice(0, 8));
  const duplicateWorkflowId = `${fixtureIds.plan.slice(0, 8)}-1111-4111-8111-111111119901`;
  const duplicateSessionId = `${fixtureIds.plan.slice(0, 8)}-1111-4111-8111-111111119902`;
  insertInMemoryPlanItemWorkflowForSessionOperationsFixture(repository, {
    workflow_id: duplicateWorkflowId,
    codex_session_id: duplicateSessionId,
    development_plan_id: seeded.plan.id,
    development_plan_item_id: seeded.item.id,
    actor_id: fixtureIds.actorTech,
    runtime_profile_id: fixtureIds.runtimeProfile,
    runtime_profile_revision_id: fixtureIds.runtimeProfileRevision,
    credential_binding_id: fixtureIds.credentialBinding,
    credential_binding_version_id: fixtureIds.credentialBindingVersion,
    now,
  });
  const workflows = await repository.listActivePlanItemWorkflowsByItem(seeded.item.id);
  if (workflows.length !== 2) {
    throw new Error(`Expected ambiguous workflows for ${seeded.item.id}`);
  }
}

export const createCapsule = (input: {
  id: string;
  sessionId: string;
  turnId: string;
  sequence?: number;
  digest?: string;
  actorId: string;
  runtimeProfileRevisionId: string;
}): CodexRuntimeCapsule => ({
  id: input.id,
  codex_session_id: input.sessionId,
  created_from_turn_id: input.turnId,
  sequence: input.sequence ?? 1,
  artifact_ref: `internal-artifact://${input.id}`,
  digest: input.digest ?? `sha256:${'d'.repeat(64)}`,
  size_bytes: '100',
  manifest_digest: `sha256:${'e'.repeat(64)}`,
  thread_state_digest: `sha256:${'f'.repeat(64)}`,
  memory_state_digest: `sha256:${'1'.repeat(64)}`,
  environment_manifest_digest: `sha256:${'2'.repeat(64)}`,
  codex_thread_id_digest: `sha256:${'3'.repeat(64)}`,
  codex_cli_version: '0.0.0-test',
  app_server_protocol_digest: codexCanonicalDigest({ protocol: 'test' }),
  runtime_profile_revision_id: input.runtimeProfileRevisionId,
  trusted_runtime_manifest_digest: `sha256:${'4'.repeat(64)}`,
  credential_binding_lineage_digest: `sha256:${'5'.repeat(64)}`,
  created_by_actor_id: input.actorId,
  created_at: later,
});

const requiredPredicate = (health: { candidate_predicate?: SessionRecoveryCandidatePredicate }): SessionRecoveryCandidatePredicate => {
  if (health.candidate_predicate === undefined) {
    throw new Error('Expected session operations candidate predicate');
  }
  return health.candidate_predicate;
};

const staleActiveQueuedActions = async (repository: DeliveryRepository, workflowId: string): Promise<void> => {
  for (const action of await repository.listActivePlanItemWorkflowQueuedActions(workflowId)) {
    await repository.stalePlanItemWorkflowQueuedActionForSessionOperations({
      workflow_id: workflowId,
      action_id: action.id,
      reason: 'session_operations_fixture_non_target_action',
      now,
    });
  }
};

const setInMemorySessionLatestCapsule = (
  repository: InMemoryDeliveryRepository,
  input: { session_id: string; latest_capsule_id: string; latest_capsule_digest: string; now: string },
): void => {
  const repositoryInternals = repository as unknown as {
    codexSessions: Map<string, Record<string, unknown>>;
  };
  const session = repositoryInternals.codexSessions.get(input.session_id);
  if (session === undefined) {
    throw new Error(`Codex session ${input.session_id} is missing`);
  }
  repositoryInternals.codexSessions.set(input.session_id, {
    ...session,
    latest_capsule_id: input.latest_capsule_id,
    latest_capsule_digest: input.latest_capsule_digest,
    updated_at: input.now,
  });
};

const insertInMemoryPlanItemWorkflowForSessionOperationsFixture = (
  repository: InMemoryDeliveryRepository,
  input: {
    workflow_id: string;
    codex_session_id: string;
    development_plan_id: string;
    development_plan_item_id: string;
    runtime_profile_id: string;
    runtime_profile_revision_id: string;
    credential_binding_id: string;
    credential_binding_version_id: string;
    actor_id: string;
    now: string;
  },
): { workflow: PlanItemWorkflow; session: CodexSession } => {
  const workflow: PlanItemWorkflow = {
    id: input.workflow_id,
    development_plan_id: input.development_plan_id,
    development_plan_item_id: input.development_plan_item_id,
    status: 'brainstorming',
    active_codex_session_id: input.codex_session_id,
    created_by_actor_id: input.actor_id,
    created_at: input.now,
    updated_at: input.now,
  };
  const session: CodexSession = {
    id: input.codex_session_id,
    owner_type: 'plan_item_workflow',
    owner_id: input.workflow_id,
    status: 'idle',
    role: 'active',
    runtime_profile_id: input.runtime_profile_id,
    runtime_profile_revision_id: input.runtime_profile_revision_id,
    credential_binding_id: input.credential_binding_id,
    credential_binding_version_id: input.credential_binding_version_id,
    lease_epoch: 0,
    created_by_actor_id: input.actor_id,
    created_at: input.now,
    updated_at: input.now,
  };
  const repositoryInternals = repository as unknown as {
    planItemWorkflows: Map<string, PlanItemWorkflow>;
    codexSessions: Map<string, CodexSession>;
  };
  repositoryInternals.planItemWorkflows.set(workflow.id, { ...workflow });
  repositoryInternals.codexSessions.set(session.id, { ...session });
  return { workflow: { ...workflow }, session: { ...session } };
};
