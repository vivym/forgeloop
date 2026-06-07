import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import type { BoundaryAnswerRecord, BoundaryDecisionRecord, BoundaryQuestionRecord, DeliveryRepository } from '../../packages/db/src';
import type {
  BoundarySummary,
  BoundarySummaryRevision,
  BrainstormingSession,
  ContextManifest,
  CodexSessionTurn,
  DevelopmentPlanItem,
  DevelopmentPlanItemRevision,
  ExecutionPlanRevision,
  ExecutionReadinessRecord,
  PlanItemWorkflow,
  SpecRevision,
} from '../../packages/domain/src';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexRuntimeNetworkPolicyDigest,
  codexRuntimeProfileRevisionDigest,
  type CodexRuntimeProfileRevision,
} from '../../packages/domain/src';
import { createWorkflowPolicyRepoRoot } from './runtime-policy-repo';

const now = '2026-05-31T00:00:00.000Z';

const idFor = (prefix: string, suffix: string) => `${prefix}-1111-4111-8111-${suffix}`;

export const idsFor = (prefix = '11111111') => ({
  org: idFor(prefix, '111111111001'),
  actorTech: idFor(prefix, '111111111101'),
  actorLeader: idFor(prefix, '111111111102'),
  actorDelegate: idFor(prefix, '111111111103'),
  actorUnauthorized: idFor(prefix, '111111111104'),
  project: idFor(prefix, '111111111201'),
  repo: idFor(prefix, '111111111202'),
  workItem: idFor(prefix, '111111111203'),
  boundarySession: idFor(prefix, '111111111204'),
  boundarySummary: idFor(prefix, '111111111205'),
  spec: idFor(prefix, '111111111206'),
  executionPlan: idFor(prefix, '111111111207'),
  plan: idFor(prefix, '111111111301'),
  planRevision: idFor(prefix, '111111111303'),
  item: idFor(prefix, '111111111302'),
  itemRevision: idFor(prefix, '111111111304'),
  runtimeProfile: idFor(prefix, '111111111401'),
  runtimeProfileRevision: idFor(prefix, '111111111402'),
  credentialBinding: idFor(prefix, '111111111501'),
  credentialBindingVersion: idFor(prefix, '111111111502'),
  sourceRequirement: idFor(prefix, '111111111601'),
  boundaryRevision: idFor(prefix, '111111111701'),
  contextManifest: idFor(prefix, '111111111706'),
  contextManifestRevision: idFor(prefix, '111111111707'),
  boundaryRound: idFor(prefix, '111111111708'),
  boundaryQuestion: idFor(prefix, '111111111709'),
  boundaryAnswer: idFor(prefix, '111111111710'),
  boundaryDecision: idFor(prefix, '111111111714'),
  specRevision: idFor(prefix, '111111111702'),
  implementationPlanRevision: idFor(prefix, '111111111703'),
  readiness: idFor(prefix, '111111111704'),
});

export const ids = idsFor();

export async function seedDevelopmentPlanItem(app: INestApplication, options: { idPrefix?: string } = {}) {
  const fixtureIds = idsFor(options.idPrefix);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const repoRoot = await createWorkflowPolicyRepoRoot();

  await repository.saveOrganization({ id: fixtureIds.org, name: 'ForgeLoop', created_at: now, updated_at: now });
  await repository.saveActor({
    id: fixtureIds.actorTech,
    org_id: fixtureIds.org,
    display_name: 'Tech Lead',
    actor_type: 'human',
    created_at: now,
    updated_at: now,
  });
  await repository.saveActor({
    id: fixtureIds.actorLeader,
    org_id: fixtureIds.org,
    display_name: 'Product Lead',
    actor_type: 'human',
    created_at: now,
    updated_at: now,
  });
  await repository.saveActor({
    id: fixtureIds.actorUnauthorized,
    org_id: fixtureIds.org,
    display_name: 'Unauthorized',
    actor_type: 'human',
    created_at: now,
    updated_at: now,
  });
  await repository.saveProject({
    id: fixtureIds.project,
    org_id: fixtureIds.org,
    name: 'ForgeLoop',
    repo_ids: ['forgeloop'],
    owner_actor_id: fixtureIds.actorTech,
    created_at: now,
    updated_at: now,
  });
  await repository.saveProjectRepo({
    id: fixtureIds.repo,
    repo_id: 'forgeloop',
    org_id: fixtureIds.org,
    project_id: fixtureIds.project,
    name: 'forgeloop',
    status: 'active',
    local_path: repoRoot,
    default_branch: 'main',
    base_commit_sha: '0'.repeat(40),
    created_at: now,
    updated_at: now,
  });
  await repository.saveWorkItem({
    id: fixtureIds.sourceRequirement,
    project_id: fixtureIds.project,
    kind: 'requirement',
    title: 'Session continuity requirement',
    narrative_markdown: '',
    goal: 'Model Codex workflow continuity.',
    success_criteria: ['Workflow records keep Codex session provenance.'],
    priority: 'P0',
    risk: 'medium',
    driver_actor_id: fixtureIds.actorLeader,
    intake_context: {
      type: 'requirement',
      stakeholder_problem: 'Codex session continuity is not explicit.',
      desired_outcome: 'The team can trace generated artifacts back to the active Codex session.',
      acceptance_criteria: ['Workflow child records store workflow and session refs.'],
      in_scope: ['Plan Item Workflow session metadata'],
    },
    phase: 'draft',
    activity_state: 'idle',
    gate_state: 'none',
    resolution: 'none',
    created_at: now,
    updated_at: now,
  });
  await seedBoundaryGenerationRuntime(repository, fixtureIds.project, fixtureIds.actorTech);
  await repository.saveDevelopmentPlan({
    id: fixtureIds.plan,
    project_id: fixtureIds.project,
    revision_id: fixtureIds.planRevision,
    title: 'Codex Session Workflow',
    status: 'draft',
    source_refs: [],
    items: [],
    created_at: now,
    updated_at: now,
  });
  const item: DevelopmentPlanItem = {
    id: fixtureIds.item,
    development_plan_id: fixtureIds.plan,
    revision_id: fixtureIds.itemRevision,
    source_ref: { type: 'requirement', id: fixtureIds.sourceRequirement },
    title: 'Session continuity',
    summary: 'Model Codex workflow continuity.',
    driver_actor_id: fixtureIds.actorLeader,
    responsible_role: 'tech_lead',
    reviewer_actor_id: fixtureIds.actorTech,
    leader_actor_id: fixtureIds.actorTech,
    leader_delegate_actor_ids: [],
    risk: 'medium',
    dependency_hints: [],
    affected_surfaces: ['control-plane-api', 'db'],
    boundary_status: 'in_progress',
    spec_status: 'missing',
    implementation_plan_status: 'missing',
    execution_status: 'not_started',
    review_status: 'missing',
    qa_handoff_status: 'missing',
    release_impact: 'none',
    next_action: 'Start brainstorming',
    created_at: now,
    updated_at: now,
  };
  await repository.saveDevelopmentPlanItem(item);
  const itemRevision: DevelopmentPlanItemRevision = {
    id: item.revision_id,
    development_plan_item_id: item.id,
    development_plan_id: item.development_plan_id,
    revision_number: 1,
    snapshot: item,
    change_reason: 'plan_item_workflow_fixture_created',
    edited_by_actor_id: fixtureIds.actorTech,
    created_at: now,
  };
  await repository.saveDevelopmentPlanItemRevision(itemRevision);

  return { ids: fixtureIds, plan: { id: fixtureIds.plan }, item: { id: fixtureIds.item, revision_id: fixtureIds.itemRevision } };
}

export async function startWorkflow(app: INestApplication, developmentPlanId: string, itemId: string) {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const item = await repository.getDevelopmentPlanItem(itemId);
	  const plan = await repository.getDevelopmentPlan(developmentPlanId);
	  const fixtureIds = idsFor(plan?.id.slice(0, 8));
	  const actorId = item?.leader_actor_id ?? fixtureIds.actorTech;
	  if (plan === undefined) {
	    throw new Error(`Development Plan ${developmentPlanId} is missing`);
	  }

	  return (
	    await request(app.getHttpServer())
	      .post(`/development-plans/${developmentPlanId}/items/${itemId}/workflow/start-brainstorming`)
	      .send({
	        actor_id: actorId,
	        reason: 'Start Superpowers workflow.',
	      })
	      .expect(201)
	  ).body;
}

export async function resolveSeededGenerationRuntimeBinding(
  repository: DeliveryRepository,
  projectId: string,
  at = now,
): Promise<{
  runtime_profile_id: string;
  runtime_profile_revision_id: string;
  credential_binding_id: string;
  credential_binding_version_id: string;
}> {
  const profileRevision = await repository.getActiveCodexRuntimeProfileRevision({
    project_id: projectId,
    target_kind: 'generation',
    now: at,
  });
  if (profileRevision === undefined) {
    throw new Error(`Generation runtime profile is missing for project ${projectId}`);
  }
  const [candidate] = (
    await repository.listCodexCredentialBindingReadinessCandidates({
      project_id: projectId,
      runtime_profile_id: profileRevision.profile_id,
      target_kind: 'generation',
      now: at,
    })
  ).filter((value) => value.purpose === 'model_provider');
  if (candidate === undefined) {
    throw new Error(`Generation model credential binding is missing for project ${projectId}`);
  }
  const credential = await repository.getCodexCredentialBindingPublic(candidate.id);
  if (credential?.active_version_id === undefined) {
    throw new Error(`Generation model credential binding ${candidate.id} has no active version`);
  }
  return {
    runtime_profile_id: profileRevision.profile_id,
    runtime_profile_revision_id: profileRevision.id,
    credential_binding_id: credential.id,
    credential_binding_version_id: credential.active_version_id,
  };
}

export async function seedWorkflow(app: INestApplication, options: { idPrefix?: string } = {}) {
  const seeded = await seedDevelopmentPlanItem(app, options);
  const started = await startWorkflow(app, seeded.plan.id, seeded.item.id);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const workflow = await repository.getPlanItemWorkflow(started.id);
  if (workflow === undefined) {
    throw new Error(`Started workflow ${started.id} was not persisted`);
  }
  return { ...seeded, workflow };
}

export async function seedApprovedBoundaryWorkflow(app: INestApplication, options: { idPrefix?: string } = {}) {
  const seeded = await seedBoundaryReviewWorkflow(app, options);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const approvedBoundaryRevision = await seedBoundarySummaryRevisionForWorkflow(repository, seeded, { status: 'approved' });
  const approvedWorkflow = await repository.applyPlanItemWorkflowTransition({
    transition: {
      id: idFor(seeded.ids.plan.slice(0, 8), '111111111712'),
      workflow_id: seeded.workflow.id,
      from_status: 'boundary_review',
      to_status: 'spec_generation_queued',
      actor_id: seeded.ids.actorTech,
      evidence_object_type: 'boundary_summary_revision',
      evidence_object_id: approvedBoundaryRevision.id,
      codex_session_id: seeded.workflow.active_codex_session_id,
      created_at: now,
    },
    projection_patch: { active_boundary_summary_revision_id: approvedBoundaryRevision.id },
  });
  const item = await repository.getDevelopmentPlanItem(seeded.item.id);
  if (item !== undefined) {
    await repository.saveDevelopmentPlanItem({
      ...item,
      boundary_status: 'approved',
      spec_status: 'missing',
      next_action: 'generate_spec',
      updated_at: now,
    });
  }
  return { ...seeded, workflow: approvedWorkflow, boundaryRevision: approvedBoundaryRevision };
}

export async function seedBoundaryReviewWorkflow(app: INestApplication, options: { idPrefix?: string } = {}) {
  const seeded = await seedWorkflow(app, options);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  await clearFixtureStartupQueuedActions(repository, seeded.workflow.id);
  const boundaryRevision = await seedBoundarySummaryRevisionForWorkflow(repository, seeded, { status: 'proposed' });
  const workflow = await repository.applyPlanItemWorkflowTransition({
    transition: {
      id: idFor(seeded.ids.plan.slice(0, 8), '111111111711'),
      workflow_id: seeded.workflow.id,
      from_status: 'brainstorming',
      to_status: 'boundary_review',
      actor_id: seeded.ids.actorTech,
      evidence_object_type: 'boundary_summary_revision',
      evidence_object_id: boundaryRevision.id,
      codex_session_id: seeded.workflow.active_codex_session_id,
      created_at: now,
    },
    projection_patch: { active_boundary_summary_revision_id: boundaryRevision.id },
  });
  return { ...seeded, workflow, boundaryRevision };
}

async function clearFixtureStartupQueuedActions(repository: DeliveryRepository, workflowId: string): Promise<void> {
  const activeActions = await repository.listActivePlanItemWorkflowQueuedActions(workflowId);
  for (const action of activeActions) {
    if (action.kind !== 'continue_brainstorming' || action.status !== 'queued') continue;
    const { claimed } = await repository.claimOrReplayPlanItemWorkflowQueuedActionRun({
      workflow_id: workflowId,
      action_id: action.id,
      actor_id: action.created_by_actor_id,
      idempotency_key: `fixture-clear-${action.id}`,
      now,
    });
    if (claimed) {
      await repository.terminalizePlanItemWorkflowQueuedAction({
        workflow_id: workflowId,
        action_id: action.id,
        status: 'cancelled',
        blocked_reason_code: 'fixture_manual_state_seed',
        now,
      });
    }
  }
}

export async function seedSpecReviewWorkflow(app: INestApplication, options: { idPrefix?: string } = {}) {
  const seeded = await seedApprovedBoundaryWorkflow(app, options);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const specRevision = await seedSpecRevisionForWorkflow(repository, seeded);
  const workflow = await repository.applyPlanItemWorkflowTransition({
    transition: {
      id: idFor(seeded.ids.plan.slice(0, 8), '111111111721'),
      workflow_id: seeded.workflow.id,
      from_status: 'spec_generation_queued',
      to_status: 'spec_review',
      actor_id: seeded.ids.actorTech,
      evidence_object_type: 'spec_revision',
      evidence_object_id: specRevision.id,
      codex_session_id: seeded.workflow.active_codex_session_id,
      created_at: now,
    },
    projection_patch: { active_spec_doc_revision_id: specRevision.id },
  });
  return { ...seeded, workflow, specRevision };
}

export async function seedWorkflowWithApprovedImplementationPlan(
  app: INestApplication,
  options: { idPrefix?: string } = {},
) {
  const seeded = await seedSpecReviewWorkflow(app, options);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const implementationPlanRevision = await seedImplementationPlanRevisionForWorkflow(repository, seeded, seeded.specRevision.id);
  const implementationPlanQueuedWorkflow = await repository.applyPlanItemWorkflowTransition({
    transition: {
      id: idFor(seeded.ids.plan.slice(0, 8), '111111111722'),
      workflow_id: seeded.workflow.id,
      from_status: 'spec_review',
      to_status: 'implementation_plan_generation_queued',
      actor_id: seeded.ids.actorTech,
      evidence_object_type: 'spec_revision',
      evidence_object_id: seeded.specRevision.id,
      codex_session_id: seeded.workflow.active_codex_session_id,
      created_at: now,
    },
    projection_patch: { active_spec_doc_revision_id: seeded.specRevision.id },
  });
  const workflow = await repository.applyPlanItemWorkflowTransition({
    transition: {
      id: idFor(seeded.ids.plan.slice(0, 8), '111111111723'),
      workflow_id: implementationPlanQueuedWorkflow.id,
      from_status: 'implementation_plan_generation_queued',
      to_status: 'implementation_plan_review',
      actor_id: seeded.ids.actorTech,
      evidence_object_type: 'implementation_plan_revision',
      evidence_object_id: implementationPlanRevision.id,
      codex_session_id: implementationPlanQueuedWorkflow.active_codex_session_id,
      created_at: now,
    },
    projection_patch: { active_implementation_plan_doc_revision_id: implementationPlanRevision.id },
  });

  return { ...seeded, workflow, implementationPlanRevision };
}

export async function createExecutionReadinessRecord(
  app: INestApplication,
  seeded: Awaited<ReturnType<typeof seedWorkflowWithApprovedImplementationPlan>>,
) {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const record = buildExecutionReadinessRecord(seeded);
  await repository.saveExecutionReadinessRecord(record);
  return record;
}

export async function createFork(
  app: INestApplication,
  workflowId: string,
  options: { reason?: string; forked_from_turn_id?: string; forked_from_capsule_id?: string } = {},
) {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const workflow = await repository.getPlanItemWorkflow(workflowId);
  if (workflow?.active_codex_session_id === undefined) throw new Error(`Workflow ${workflowId} has no active session`);
  const activeSession = await repository.getCodexSession(workflow.active_codex_session_id);
  if (activeSession === undefined) throw new Error(`Workflow ${workflowId} active session does not exist`);
  let forkedFromTurnId = options.forked_from_turn_id;
  if (forkedFromTurnId === undefined && options.forked_from_capsule_id === undefined) {
    forkedFromTurnId = `${workflow.id.slice(0, 8)}-1111-4111-8111-111111119901`;
    await repository.createCodexSessionTurn({
      id: forkedFromTurnId,
      workflow_id: workflow.id,
      codex_session_id: workflow.active_codex_session_id,
      intent: 'continue_brainstorming',
      status: 'running',
      input_digest: codexCanonicalDigest({
        workflow_id: workflow.id,
        codex_session_id: workflow.active_codex_session_id,
        fixture_turn_id: forkedFromTurnId,
        expected_input_capsule_digest: activeSession.latest_capsule_digest ?? null,
      }),
      ...(activeSession.latest_capsule_digest === undefined
        ? {}
        : { expected_input_capsule_digest: activeSession.latest_capsule_digest }),
      created_by_actor_id: workflow.created_by_actor_id,
      created_at: now,
      updated_at: now,
    });
  }

  return (
    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${workflowId}/codex-sessions/${workflow.active_codex_session_id}/fork`)
      .send({
        actor_id: workflow.created_by_actor_id,
        reason: options.reason ?? 'Explore a candidate fork.',
        ...(forkedFromTurnId === undefined ? {} : { forked_from_turn_id: forkedFromTurnId }),
        ...(options.forked_from_capsule_id === undefined ? {} : { forked_from_capsule_id: options.forked_from_capsule_id }),
      })
      .expect(201)
  ).body;
}

function buildExecutionReadinessRecord(
  seeded: Awaited<ReturnType<typeof seedWorkflowWithApprovedImplementationPlan>>,
): ExecutionReadinessRecord {
  if (
    seeded.workflow.active_boundary_summary_revision_id === undefined ||
    seeded.workflow.active_spec_doc_revision_id === undefined ||
    seeded.workflow.active_implementation_plan_doc_revision_id === undefined
  ) {
    throw new Error('Execution readiness fixture requires active approved document revisions');
  }
  return {
    id: seeded.ids.readiness,
    workflow_id: seeded.workflow.id,
    development_plan_id: seeded.workflow.development_plan_id,
    development_plan_item_id: seeded.workflow.development_plan_item_id,
    codex_session_id: seeded.workflow.active_codex_session_id,
    approved_boundary_summary_revision_id: seeded.workflow.active_boundary_summary_revision_id,
    approved_spec_revision_id: seeded.workflow.active_spec_doc_revision_id,
    approved_implementation_plan_revision_id: seeded.workflow.active_implementation_plan_doc_revision_id,
    readiness_state: 'ready',
    blocker_codes: [],
    supporting_evidence: [
      {
        object_type: 'implementation_plan_revision',
        object_id: seeded.workflow.active_implementation_plan_doc_revision_id,
      },
    ],
    created_by_actor_id: seeded.ids.actorTech,
    created_at: now,
  };
}

async function seedBoundarySummaryRevisionForWorkflow(
  repository: DeliveryRepository,
  seeded: Awaited<ReturnType<typeof seedWorkflow>>,
  options: { status?: 'proposed' | 'approved' } = {},
): Promise<BoundarySummaryRevision> {
  const status = options.status ?? 'approved';
  const contextManifest = await seedBoundaryContextManifest(repository, seeded);
  const turn = await createWorkflowFixtureTurn(repository, seeded.workflow.id, seeded.workflow.active_codex_session_id, {
    id: idFor(seeded.ids.plan.slice(0, 8), '111111111713'),
    intent: 'draft_boundary_summary',
    actor_id: seeded.ids.actorTech,
  });
  const question: BoundaryQuestionRecord = {
    id: seeded.ids.boundaryQuestion,
    session_id: seeded.ids.boundarySession,
    sequence: 1,
    round_id: seeded.ids.boundaryRound,
    text: 'What is the approved workflow boundary?',
    author_id: seeded.ids.actorTech,
    created_at: now,
    status: 'resolved',
    required: true,
    answered_by_answer_id: seeded.ids.boundaryAnswer,
  };
  const answer: BoundaryAnswerRecord = {
    id: seeded.ids.boundaryAnswer,
    session_id: seeded.ids.boundarySession,
    sequence: 1,
    question_id: question.id,
    round_id: seeded.ids.boundaryRound,
    text: 'The fixture is scoped to Plan Item Workflow session provenance.',
    actor_id: seeded.ids.actorTech,
    actor_role: 'leader',
    created_at: now,
  };
  const decision: BoundaryDecisionRecord = {
    id: seeded.ids.boundaryDecision,
    session_id: seeded.ids.boundarySession,
    sequence: 1,
    round_id: seeded.ids.boundaryRound,
    text: 'Use workflow-owned child records for generated artifacts.',
    actor_id: seeded.ids.actorTech,
    actor_role: 'leader',
    source: 'leader',
    state: 'accepted',
    rationale: 'The Codex session must remain the continuity anchor.',
    created_at: now,
  };
  const session: BrainstormingSession = {
    id: seeded.ids.boundarySession,
    revision_id: idFor(seeded.ids.plan.slice(0, 8), '111111111206'),
    source_ref: { type: 'requirement', id: seeded.ids.sourceRequirement },
    development_plan_id: seeded.plan.id,
    development_plan_revision_id: seeded.ids.planRevision,
    development_plan_item_id: seeded.item.id,
    development_plan_item_revision_id: seeded.ids.itemRevision,
    context_manifest_id: contextManifest.id,
    context_manifest_revision_id: contextManifest.revision_id,
    leader_actor_id: seeded.ids.actorTech,
    leader_delegate_actor_ids: [],
    status: status === 'approved' ? 'approved' : 'summary_proposed',
    current_round_id: seeded.ids.boundaryRound,
    latest_summary_revision_id: seeded.ids.boundaryRevision,
    ...(status === 'approved' ? { approved_summary_revision_id: seeded.ids.boundaryRevision } : {}),
    questions: [question],
    answers: [answer],
    decisions: [decision],
    approval_state: status === 'approved' ? 'approved' : 'ready_for_approval',
    boundary_summary_id: seeded.ids.boundarySummary,
    ...(status === 'approved' ? { approver_actor_id: seeded.ids.actorTech, approved_at: now, closed_at: now } : {}),
    workflow_id: seeded.workflow.id,
    codex_session_id: seeded.workflow.active_codex_session_id,
    created_at: now,
    updated_at: now,
  };
  await repository.saveBrainstormingSession(session);
  await repository.saveBoundaryRound({
    id: seeded.ids.boundaryRound,
    session_id: session.id,
    session_revision_id: session.revision_id,
    round_number: 1,
    trigger: 'start',
    status: 'terminal',
    codex_session_turn_id: turn.id,
    created_at: now,
    updated_at: now,
  });
  await repository.saveBoundaryQuestion(question);
  await repository.saveBoundaryAnswer(answer);
  await repository.saveBoundaryDecision(decision);

  const boundary: BoundarySummary = {
    id: seeded.ids.boundarySummary,
    revision_id: seeded.ids.boundaryRevision,
    brainstorming_session_id: seeded.ids.boundarySession,
    brainstorming_session_revision_id: session.revision_id,
    development_plan_id: seeded.plan.id,
    development_plan_item_id: seeded.item.id,
    development_plan_item_revision_id: seeded.ids.itemRevision,
    source_ref: { type: 'requirement', id: seeded.ids.sourceRequirement },
    summary: 'Approved workflow boundary.',
    ...(status === 'approved' ? { approved_by_actor_id: seeded.ids.actorTech, approved_at: now } : {}),
    created_at: now,
    updated_at: now,
  };
  await repository.saveBoundarySummary(boundary);
  const revision: BoundarySummaryRevision = {
    id: seeded.ids.boundaryRevision,
    boundary_summary_id: seeded.ids.boundarySummary,
    session_id: session.id,
    session_revision_id: session.revision_id,
    source_round_id: seeded.ids.boundaryRound,
    development_plan_id: seeded.plan.id,
    development_plan_item_id: seeded.item.id,
    development_plan_item_revision_id: seeded.ids.itemRevision,
    workflow_id: seeded.workflow.id,
    codex_session_id: seeded.workflow.active_codex_session_id,
    codex_session_turn_id: turn.id,
    revision_number: 1,
    status,
    summary_markdown: 'Approved workflow boundary.',
    confirmed_scope: ['Workflow transition service'],
    confirmed_out_of_scope: ['Lease service'],
    accepted_assumptions: [],
    open_risks: [],
    validation_expectations: ['Focused API tests pass'],
    question_answer_snapshot: [{ question_id: question.id, answer_id: answer.id, text: answer.text }],
    decision_snapshot: [{ decision_id: decision.id, text: decision.text, rationale: decision.rationale }],
    decision_count: 1,
    context_manifest_id: contextManifest.id,
    context_manifest_revision_id: contextManifest.revision_id,
    ...(status === 'approved' ? { approved_by_actor_id: seeded.ids.actorTech, approved_at: now } : {}),
    created_at: now,
  } as BoundarySummaryRevision;
  if ((await repository.getBoundarySummaryRevisionById(revision.id)) === undefined) {
    await repository.saveBoundarySummaryRevision(revision);
  } else {
    await repository.updateBoundarySummaryRevision(revision);
  }
  if (status === 'approved') {
    await repository.appendObjectEvent({
      id: idFor(seeded.ids.plan.slice(0, 8), '111111111715'),
      object_type: 'development_plan_item',
      object_id: seeded.item.id,
      event_type: 'development_plan_item_boundary_approved',
      actor_id: seeded.ids.actorTech,
      metadata: { boundary_summary_id: boundary.id },
      created_at: now,
    });
  }
  return revision;
}

async function seedBoundaryContextManifest(
  repository: DeliveryRepository,
  seeded: Awaited<ReturnType<typeof seedWorkflow>>,
): Promise<ContextManifest> {
  const manifest: ContextManifest = {
    id: seeded.ids.contextManifest,
    revision_id: seeded.ids.contextManifestRevision,
    source_ref: { type: 'requirement', id: seeded.ids.sourceRequirement },
    project_id: seeded.ids.project,
    development_plan_id: seeded.plan.id,
    development_plan_revision_id: seeded.ids.planRevision,
    development_plan_item_id: seeded.item.id,
    development_plan_item_revision_id: seeded.ids.itemRevision,
    actor_guidance: seeded.ids.actorTech,
    sources: [{ type: 'development_plan_item', ref: seeded.item.id, digest: seeded.ids.itemRevision }],
    generated_at: now,
    runtime_identity: 'test:plan-item-workflow-fixtures',
    created_at: now,
    updated_at: now,
  };
  await repository.saveContextManifest(manifest);
  return manifest;
}

async function seedBoundaryGenerationRuntime(repository: DeliveryRepository, projectId: string, actorId: string): Promise<void> {
  const workerNow = '2026-05-31T00:00:00.000Z';
  const expiresAt = '2026-05-31T01:00:00.000Z';
  const networkPolicy = { mode: 'disabled' as const };
  const profileId = stableUuid({ kind: 'plan-item-workflow-generation-profile', projectId });
  const profileRevisionId = stableUuid({ kind: 'plan-item-workflow-generation-profile-revision', projectId });
  const credentialBindingId = stableUuid({ kind: 'plan-item-workflow-generation-credential-binding', projectId });
  const credentialVersionId = stableUuid({ kind: 'plan-item-workflow-generation-credential-version', projectId });
  const workerId = stableUuid({ kind: 'plan-item-workflow-generation-worker', projectId });
  const dockerImageDigest = codexCanonicalDigest({ label: 'plan-item-workflow-generation-docker-image' });
  const networkPolicyDigest = codexRuntimeNetworkPolicyDigest(networkPolicy);
  const codexConfigToml = 'approval_policy = "never"\n';
  const revisionWithoutDigest = {
    id: profileRevisionId,
    profile_id: profileId,
    revision_number: 1,
    status: 'active' as const,
    environment: 'test' as const,
    docker_image: 'ghcr.io/forgeloop/codex-worker:test',
    docker_image_digest: dockerImageDigest,
    target_kind: 'generation' as const,
    source_access_mode: 'artifact_only' as const,
    codex_config_toml: codexConfigToml,
    codex_config_digest: codexCanonicalDigest(codexConfigToml),
    expected_effective_config_digest: codexCanonicalDigest({ label: 'plan-item-workflow-effective-config' }),
    effective_config_assertions: {
      target_kind: 'generation' as const,
      approval_policy: 'never' as const,
      source_write_policy: 'artifact_only' as const,
      forbidden_writable_roots: ['workspace'] as const,
    },
    app_server_required: true,
    allowed_driver_kind: 'app_server' as const,
    network_policy: networkPolicy,
    resource_limits: {
      cpu_ms: 300_000,
      memory_mb: 1024,
      pids: 256,
      fds: 1024,
      workspace_bytes: 1,
      artifact_bytes: 1_048_576,
      timeout_ms: 300_000,
      output_limit_bytes: 1_048_576,
      run_output_limit_bytes: 1_048_576,
    },
    docker_policy: {
      network_disabled: true,
      app_server_only: true,
      rootless: true,
      read_only_rootfs: true,
      no_new_privileges: true,
      drop_capabilities: ['ALL'],
    },
    allowed_scopes: [{ project_id: projectId }],
    profile_digest: 'placeholder',
    created_by_actor_id: actorId,
    created_at: now,
  } satisfies CodexRuntimeProfileRevision;
  const revision = { ...revisionWithoutDigest, profile_digest: codexRuntimeProfileRevisionDigest(revisionWithoutDigest) };
  await repository.createCodexRuntimeProfileWithRevision({
    profile: {
      id: profileId,
      name: 'Plan Item Workflow generation test profile',
      environment: 'test',
      target_kind: 'generation',
      active_revision_id: profileRevisionId,
      created_by_actor_id: actorId,
      created_at: now,
      updated_at: now,
    },
    revision,
  });

  const secretPayload = { auth: { api_key: 'test-api-key' } };
  await repository.createCodexCredentialBindingWithVersion({
    binding: {
      id: credentialBindingId,
      profile_id: profileId,
      project_id: projectId,
      provider: 'unsafe_db',
      purpose: 'model_provider',
      active_version_id: credentialVersionId,
      created_by_actor_id: actorId,
      created_at: now,
      updated_at: now,
    },
    version: {
      id: credentialVersionId,
      binding_id: credentialBindingId,
      version_number: 1,
      status: 'active',
      payload_digest: codexCredentialPayloadDigest(secretPayload),
      created_by_actor_id: actorId,
      created_at: now,
    },
    secret_payload_json: secretPayload,
  });

  await repository.createCodexWorkerBootstrapToken({
    id: stableUuid({ kind: 'plan-item-workflow-generation-bootstrap', projectId }),
    worker_identity: `plan-item-workflow-worker-${projectId}`,
    bootstrap_token_hash: codexCredentialPayloadDigest(`plan-item-workflow-bootstrap-${projectId}`),
    bootstrap_token_version: 1,
    status: 'active',
    allowed_scopes_json: [{ project_id: projectId }],
    allowed_capabilities_json: {
      target_kinds: ['generation'],
      docker_image_digests: [dockerImageDigest],
      network_policy_digests: [networkPolicyDigest],
    },
    created_by_actor_id: actorId,
    created_at: now,
    expires_at: expiresAt,
  });
  await repository.upsertCodexWorkerRegistration({
    worker_id: workerId,
    worker_identity: `plan-item-workflow-worker-${projectId}`,
    version: 'test-worker',
    bootstrap_token_hash: codexCredentialPayloadDigest(`plan-item-workflow-bootstrap-${projectId}`),
    bootstrap_token_version: 1,
    session_token: `plan-item-workflow-session-${projectId}`,
    session_expires_at: expiresAt,
    status: 'online',
    control_channel_status: 'connected',
    allowed_scopes: [{ project_id: projectId }],
    capabilities: ['generation'],
    docker_image_digests: [dockerImageDigest],
    network_policy_digests: [networkPolicyDigest],
    host_worker_uid: 501,
    host_worker_gid: 20,
    lease_count: 0,
    max_concurrency: 100,
    session_public_key_id: `plan-item-workflow-session-key-${projectId}`,
    session_public_key_algorithm: 'x25519',
    session_public_key_material: 'base64-public-key-material',
    session_public_key_expires_at: expiresAt,
    now: workerNow,
  });
  await repository.heartbeatCodexWorker({
    worker_id: workerId,
    session_token: `plan-item-workflow-session-${projectId}`,
    nonce: `plan-item-workflow-heartbeat-${projectId}`,
    nonce_timestamp: workerNow,
    status: 'online',
    control_channel_status: 'connected',
    active_lease_count: 0,
    capabilities: ['generation'],
    now: workerNow,
  });

  process.env.FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID = profileId;
  process.env.FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID = credentialBindingId;
  process.env.FORGELOOP_AUTOMATION_TEST_NOW = new Date(Date.parse(workerNow) + 90_000).toISOString();
}

export async function seedRunExecutionRuntime(repository: DeliveryRepository, projectId: string, repoId: string, actorId: string) {
  const workerNow = new Date().toISOString();
  const expiresAt = new Date(Date.parse(workerNow) + 60 * 60_000).toISOString();
  const networkPolicy = { mode: 'disabled' as const };
  const profileId = stableUuid({ kind: 'plan-item-workflow-run-profile', projectId });
  const profileRevisionId = stableUuid({ kind: 'plan-item-workflow-run-profile-revision', projectId });
  const credentialBindingId = stableUuid({ kind: 'plan-item-workflow-run-credential-binding', projectId });
  const credentialVersionId = stableUuid({ kind: 'plan-item-workflow-run-credential-version', projectId });
  const workerId = stableUuid({ kind: 'plan-item-workflow-run-worker', projectId });
  const dockerImageDigest = codexCanonicalDigest({ label: 'plan-item-workflow-run-docker-image' });
  const networkPolicyDigest = codexRuntimeNetworkPolicyDigest(networkPolicy);
  const codexConfigToml = 'approval_policy = "never"\n';
  const revisionWithoutDigest = {
    id: profileRevisionId,
    profile_id: profileId,
    revision_number: 1,
    status: 'active' as const,
    environment: 'test' as const,
    docker_image: 'ghcr.io/forgeloop/codex-worker:test',
    docker_image_digest: dockerImageDigest,
    target_kind: 'run_execution' as const,
    source_access_mode: 'path_policy_scoped' as const,
    codex_config_toml: codexConfigToml,
    codex_config_digest: codexCanonicalDigest(codexConfigToml),
    expected_effective_config_digest: codexCanonicalDigest({ label: 'plan-item-workflow-run-effective-config' }),
    effective_config_assertions: {
      target_kind: 'run_execution' as const,
      approval_policy: 'never' as const,
      sandbox_type: 'danger-full-access' as const,
      writable_roots_policy: 'task_workspace_only' as const,
    },
    app_server_required: true,
    allowed_driver_kind: 'app_server' as const,
    network_policy: networkPolicy,
    resource_limits: {
      cpu_ms: 300_000,
      memory_mb: 1024,
      pids: 256,
      fds: 1024,
      workspace_bytes: 10_000_000,
      artifact_bytes: 1_048_576,
      timeout_ms: 300_000,
      output_limit_bytes: 1_048_576,
      run_output_limit_bytes: 1_048_576,
    },
    docker_policy: {
      network_disabled: true,
      app_server_only: true,
      rootless: true,
      read_only_rootfs: true,
      no_new_privileges: true,
      drop_capabilities: ['ALL'] as const,
    },
    allowed_scopes: [{ project_id: projectId, repo_id: repoId }],
    profile_digest: 'placeholder',
    created_by_actor_id: actorId,
    created_at: workerNow,
  } satisfies CodexRuntimeProfileRevision;
  const revision = { ...revisionWithoutDigest, profile_digest: codexRuntimeProfileRevisionDigest(revisionWithoutDigest) };
  await repository.createCodexRuntimeProfileWithRevision({
    profile: {
      id: profileId,
      name: 'Plan Item Workflow run execution test profile',
      environment: 'test',
      target_kind: 'run_execution',
      active_revision_id: profileRevisionId,
      created_by_actor_id: actorId,
      created_at: workerNow,
      updated_at: workerNow,
    },
    revision,
  });
  const secretPayload = { auth: { api_key: 'test-run-api-key' } };
  await repository.createCodexCredentialBindingWithVersion({
    binding: {
      id: credentialBindingId,
      profile_id: profileId,
      project_id: projectId,
      repo_id: repoId,
      provider: 'unsafe_db',
      purpose: 'model_provider',
      active_version_id: credentialVersionId,
      created_by_actor_id: actorId,
      created_at: workerNow,
      updated_at: workerNow,
    },
    version: {
      id: credentialVersionId,
      binding_id: credentialBindingId,
      version_number: 1,
      status: 'active',
      payload_digest: codexCredentialPayloadDigest(secretPayload),
      created_by_actor_id: actorId,
      created_at: workerNow,
    },
    secret_payload_json: secretPayload,
  });
  await repository.createCodexWorkerBootstrapToken({
    id: stableUuid({ kind: 'plan-item-workflow-run-bootstrap', projectId }),
    worker_identity: `plan-item-workflow-run-worker-${projectId}`,
    bootstrap_token_hash: codexCredentialPayloadDigest(`plan-item-workflow-run-bootstrap-${projectId}`),
    bootstrap_token_version: 1,
    status: 'active',
    allowed_scopes_json: [{ project_id: projectId, repo_id: repoId }],
    allowed_capabilities_json: {
      target_kinds: ['run_execution'],
      docker_image_digests: [dockerImageDigest],
      network_policy_digests: [networkPolicyDigest],
    },
    created_by_actor_id: actorId,
    created_at: workerNow,
    expires_at: expiresAt,
  });
  await repository.upsertCodexWorkerRegistration({
    worker_id: workerId,
    worker_identity: `plan-item-workflow-run-worker-${projectId}`,
    version: 'test-worker',
    bootstrap_token_hash: codexCredentialPayloadDigest(`plan-item-workflow-run-bootstrap-${projectId}`),
    bootstrap_token_version: 1,
    session_token: `plan-item-workflow-run-session-${projectId}`,
    session_expires_at: expiresAt,
    status: 'online',
    control_channel_status: 'connected',
    allowed_scopes: [{ project_id: projectId, repo_id: repoId }],
    capabilities: ['run_execution'],
    docker_image_digests: [dockerImageDigest],
    network_policy_digests: [networkPolicyDigest],
    host_worker_uid: 501,
    host_worker_gid: 20,
    lease_count: 0,
    max_concurrency: 100,
    session_public_key_id: `plan-item-workflow-run-session-key-${projectId}`,
    session_public_key_algorithm: 'x25519',
    session_public_key_material: 'base64-public-key-material',
    session_public_key_expires_at: expiresAt,
    now: workerNow,
  });
  await repository.heartbeatCodexWorker({
    worker_id: workerId,
    session_token: `plan-item-workflow-run-session-${projectId}`,
    nonce: `plan-item-workflow-run-heartbeat-${projectId}`,
    nonce_timestamp: workerNow,
    status: 'online',
    control_channel_status: 'connected',
    active_lease_count: 0,
    capabilities: ['run_execution'],
    now: workerNow,
  });
  process.env.FORGELOOP_AUTOMATION_TEST_NOW = new Date(Date.parse(workerNow) + 90_000).toISOString();
}

function stableUuid(input: Record<string, unknown>): string {
  const hex = codexCanonicalDigest(input).slice('sha256:'.length);
  const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function seedSpecRevisionForWorkflow(
  repository: DeliveryRepository,
  seeded: Awaited<ReturnType<typeof seedApprovedBoundaryWorkflow>>,
): Promise<SpecRevision> {
  const turn = await createWorkflowFixtureTurn(repository, seeded.workflow.id, seeded.workflow.active_codex_session_id, {
    id: idFor(seeded.ids.plan.slice(0, 8), '111111111724'),
    intent: 'draft_spec_doc',
    actor_id: seeded.ids.actorTech,
  });
  await repository.saveSpec({
    id: seeded.ids.spec,
    work_item_id: seeded.ids.sourceRequirement,
    development_plan_item_id: seeded.item.id,
    development_plan_item_revision_id: seeded.item.revision_id,
    workflow_id: seeded.workflow.id,
    boundary_summary_id: seeded.ids.boundarySummary,
    entity_type: 'spec',
    status: 'approved',
    editing_state: 'idle',
    gate_state: 'approved',
    resolution: 'approved',
    current_revision_id: seeded.ids.specRevision,
    approved_revision_id: seeded.ids.specRevision,
    approved_at: now,
    approved_by_actor_id: seeded.ids.actorTech,
    created_at: now,
    updated_at: now,
  });
  const revision = {
    id: seeded.ids.specRevision,
    spec_id: seeded.ids.spec,
    work_item_id: seeded.ids.sourceRequirement,
    development_plan_item_id: seeded.item.id,
    development_plan_item_revision_id: seeded.item.revision_id,
    workflow_id: seeded.workflow.id,
    codex_session_id: seeded.workflow.active_codex_session_id,
    codex_session_turn_id: turn.id,
    revision_number: 1,
    summary: 'Approved workflow spec.',
    content: 'Spec content.',
    background: 'Background.',
    goals: ['Goal.'],
    scope_in: ['Workflow transition service.'],
    scope_out: ['Lease service.'],
    acceptance_criteria: ['API tests pass.'],
    risk_notes: [],
    test_strategy_summary: 'Focused Vitest suite.',
    qa_owner_actor_id: seeded.ids.actorTech,
    testability_note: 'QA/Test Owner validates the workflow session provenance before execution starts.',
    structured_document: { boundary_summary_revision_id: seeded.boundaryRevision.id },
    boundary_summary_id: seeded.ids.boundarySummary,
    author_actor_id: seeded.ids.actorTech,
    artifact_refs: [],
    created_at: now,
    approved_at: now,
  } as SpecRevision & { approved_at: string };
  await repository.saveSpecRevision(revision);
  const workItem = await repository.getWorkItem(seeded.ids.sourceRequirement);
  if (workItem !== undefined) {
    await repository.saveWorkItem({
      ...workItem,
      current_spec_id: seeded.ids.spec,
      current_spec_revision_id: revision.id,
      updated_at: now,
    });
  }
  return revision;
}

async function seedImplementationPlanRevisionForWorkflow(
  repository: DeliveryRepository,
  seeded: Awaited<ReturnType<typeof seedApprovedBoundaryWorkflow>>,
  specRevisionId: string,
): Promise<ExecutionPlanRevision> {
  const turn = await createWorkflowFixtureTurn(repository, seeded.workflow.id, seeded.workflow.active_codex_session_id, {
    id: idFor(seeded.ids.plan.slice(0, 8), '111111111725'),
    intent: 'draft_implementation_plan_doc',
    actor_id: seeded.ids.actorTech,
  });
  await repository.saveExecutionPlan({
    id: seeded.ids.executionPlan,
    development_plan_item_id: seeded.item.id,
    workflow_id: seeded.workflow.id,
    status: 'approved',
    current_revision_id: seeded.ids.implementationPlanRevision,
    approved_revision_id: seeded.ids.implementationPlanRevision,
    approved_by_actor_id: seeded.ids.actorTech,
    approved_at: now,
    created_at: now,
    updated_at: now,
  });
  const revision = {
    id: seeded.ids.implementationPlanRevision,
    execution_plan_id: seeded.ids.executionPlan,
    development_plan_item_id: seeded.item.id,
    development_plan_item_revision_id: seeded.item.revision_id,
    workflow_id: seeded.workflow.id,
    codex_session_id: seeded.workflow.active_codex_session_id,
    codex_session_turn_id: turn.id,
    based_on_spec_revision_id: specRevisionId,
    revision_number: 1,
    summary: 'Approved implementation plan.',
    content: 'Implementation plan content.',
    structured_document: {
      steps: ['implement workflow transition service'],
      validation_strategy: ['Focused API tests', 'deterministic handoff dogfood'],
      required_checks: [
        {
          check_id: 'deterministic-handoff-dogfood',
          command: 'pnpm dogfood:plan-item-execution-handoff',
          timeout_seconds: 120,
          blocks_review: true,
        },
      ],
      handoff_criteria: ['Worker resumes the same Codex thread and terminalizes a new capsule.'],
    },
    author_actor_id: seeded.ids.actorTech,
    created_at: now,
    approved_at: now,
  } as ExecutionPlanRevision & { approved_at: string };
  await repository.saveExecutionPlanRevision(revision);
  return revision;
}

async function createWorkflowFixtureTurn(
  repository: DeliveryRepository,
  workflowId: string,
  codexSessionId: string | undefined,
  input: {
    id: string;
    intent: CodexSessionTurn['intent'];
    actor_id: string;
  },
): Promise<CodexSessionTurn> {
  if (codexSessionId === undefined) {
    throw new Error(`Workflow ${workflowId} has no active Codex session`);
  }
  const existing = await repository.getCodexSessionTurn(input.id);
  if (existing !== undefined) {
    if (existing.workflow_id !== workflowId || existing.codex_session_id !== codexSessionId || existing.intent !== input.intent) {
      throw new Error(`Codex session turn ${input.id} already exists for another workflow fixture`);
    }
    return existing;
  }
  const session = await repository.getCodexSession(codexSessionId);
  const turn: CodexSessionTurn = {
    id: input.id,
    workflow_id: workflowId,
    codex_session_id: codexSessionId,
    intent: input.intent,
    status: 'running',
    input_digest: codexCanonicalDigest({
      workflow_id: workflowId,
      codex_session_id: codexSessionId,
      intent: input.intent,
      fixture_turn_id: input.id,
      expected_input_capsule_digest: session?.latest_capsule_digest ?? null,
    }),
    ...(session?.latest_capsule_digest === undefined ? {} : { expected_input_capsule_digest: session.latest_capsule_digest }),
    created_by_actor_id: input.actor_id,
    created_at: now,
    updated_at: now,
  };
  await repository.createCodexSessionTurn(turn);
  return turn;
}
