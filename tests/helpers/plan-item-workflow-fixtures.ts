import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import type { DeliveryRepository } from '../../packages/db/src';
import type { BoundarySummaryRevision, ExecutionPlanRevision, ExecutionReadinessRecord, SpecRevision } from '../../packages/domain/src';

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
  specRevision: idFor(prefix, '111111111702'),
  implementationPlanRevision: idFor(prefix, '111111111703'),
  readiness: idFor(prefix, '111111111704'),
});

export const ids = idsFor();

export async function seedDevelopmentPlanItem(app: INestApplication, options: { idPrefix?: string } = {}) {
  const fixtureIds = idsFor(options.idPrefix);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

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
    repo_ids: [fixtureIds.repo],
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
    local_path: '/Users/viv/projs/forgeloop',
    default_branch: 'main',
    base_commit_sha: '0'.repeat(40),
    created_at: now,
    updated_at: now,
  });
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
  await repository.saveDevelopmentPlanItem({
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
  });

  return { ids: fixtureIds, plan: { id: fixtureIds.plan }, item: { id: fixtureIds.item } };
}

export async function startWorkflow(app: INestApplication, developmentPlanId: string, itemId: string) {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const item = await repository.getDevelopmentPlanItem(itemId);
  const plan = await repository.getDevelopmentPlan(developmentPlanId);
  const fixtureIds = idsFor(plan?.id.slice(0, 8));
  const actorId = item?.leader_actor_id ?? fixtureIds.actorTech;

  return (
    await request(app.getHttpServer())
      .post(`/development-plans/${developmentPlanId}/items/${itemId}/workflow/start-brainstorming`)
      .send({
        actor_id: actorId,
        runtime_profile_id: fixtureIds.runtimeProfile,
        runtime_profile_revision_id: fixtureIds.runtimeProfileRevision,
        credential_binding_id: fixtureIds.credentialBinding,
        credential_binding_version_id: fixtureIds.credentialBindingVersion,
        reason: 'Start Superpowers workflow.',
      })
      .expect(201)
  ).body;
}

export async function seedWorkflow(app: INestApplication, options: { idPrefix?: string } = {}) {
  const seeded = await seedDevelopmentPlanItem(app, options);
  const workflow = await startWorkflow(app, seeded.plan.id, seeded.item.id);
  return { ...seeded, workflow };
}

export async function seedApprovedBoundaryWorkflow(app: INestApplication, options: { idPrefix?: string } = {}) {
  const seeded = await seedBoundaryReviewWorkflow(app, options);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const approvedWorkflow = await repository.applyPlanItemWorkflowTransition({
    transition: {
      id: idFor(seeded.ids.plan.slice(0, 8), '111111111712'),
      workflow_id: seeded.workflow.id,
      from_status: 'boundary_review',
      to_status: 'spec_generation_queued',
      actor_id: seeded.ids.actorTech,
      evidence_object_type: 'boundary_summary_revision',
      evidence_object_id: seeded.boundaryRevision.id,
      codex_session_id: seeded.workflow.active_codex_session_id,
      created_at: now,
    },
    projection_patch: { active_boundary_summary_revision_id: seeded.boundaryRevision.id },
  });
  return { ...seeded, workflow: approvedWorkflow };
}

export async function seedBoundaryReviewWorkflow(app: INestApplication, options: { idPrefix?: string } = {}) {
  const seeded = await seedWorkflow(app, options);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const boundaryRevision = await seedBoundarySummaryRevisionForWorkflow(repository, seeded);
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
  });
  return { ...seeded, workflow, boundaryRevision };
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

export async function createFork(app: INestApplication, workflowId: string, options: { reason?: string } = {}) {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const workflow = await repository.getPlanItemWorkflow(workflowId);
  if (workflow?.active_codex_session_id === undefined) throw new Error(`Workflow ${workflowId} has no active session`);

  return (
    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${workflowId}/codex-sessions/${workflow.active_codex_session_id}/fork`)
      .send({ actor_id: workflow.created_by_actor_id, reason: options.reason ?? 'Explore a candidate fork.' })
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
): Promise<BoundarySummaryRevision> {
  await repository.saveBoundarySummary({
    id: seeded.ids.boundarySummary,
    revision_id: seeded.ids.boundaryRevision,
    brainstorming_session_id: seeded.ids.boundarySession,
    brainstorming_session_revision_id: idFor(seeded.ids.plan.slice(0, 8), '111111111206'),
    development_plan_id: seeded.plan.id,
    development_plan_item_id: seeded.item.id,
    development_plan_item_revision_id: seeded.ids.itemRevision,
    source_ref: { type: 'requirement', id: seeded.ids.sourceRequirement },
    summary: 'Approved workflow boundary.',
    approved_by_actor_id: seeded.ids.actorTech,
    approved_at: now,
    created_at: now,
    updated_at: now,
  });
  const revision: BoundarySummaryRevision = {
    id: seeded.ids.boundaryRevision,
    boundary_summary_id: seeded.ids.boundarySummary,
    brainstorming_session_id: seeded.ids.boundarySession,
    brainstorming_session_revision_id: idFor(seeded.ids.plan.slice(0, 8), '111111111206'),
    source_round_id: idFor(seeded.ids.plan.slice(0, 8), '111111111207'),
    development_plan_id: seeded.plan.id,
    development_plan_item_id: seeded.item.id,
    development_plan_item_revision_id: seeded.ids.itemRevision,
    workflow_id: seeded.workflow.id,
    codex_session_id: seeded.workflow.active_codex_session_id,
    revision_number: 1,
    status: 'approved',
    summary_markdown: 'Approved workflow boundary.',
    confirmed_scope: ['Workflow transition service'],
    confirmed_out_of_scope: ['Lease service'],
    accepted_assumptions: [],
    open_risks: [],
    validation_expectations: ['Focused API tests pass'],
    question_answer_snapshot: [],
    decision_snapshot: [],
    decision_count: 0,
    approved_by_actor_id: seeded.ids.actorTech,
    approved_at: now,
    created_at: now,
  };
  await repository.saveBoundarySummaryRevision(revision);
  return revision;
}

async function seedSpecRevisionForWorkflow(
  repository: DeliveryRepository,
  seeded: Awaited<ReturnType<typeof seedApprovedBoundaryWorkflow>>,
): Promise<SpecRevision> {
  await repository.saveSpec({
    id: seeded.ids.spec,
    work_item_id: seeded.ids.workItem,
    development_plan_item_id: seeded.item.id,
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
    work_item_id: seeded.ids.workItem,
    development_plan_item_id: seeded.item.id,
    workflow_id: seeded.workflow.id,
    codex_session_id: seeded.workflow.active_codex_session_id,
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
    structured_document: { boundary_summary_revision_id: seeded.boundaryRevision.id },
    boundary_summary_id: seeded.ids.boundarySummary,
    author_actor_id: seeded.ids.actorTech,
    artifact_refs: [],
    created_at: now,
    approved_at: now,
  } as SpecRevision & { approved_at: string };
  await repository.saveSpecRevision(revision);
  return revision;
}

async function seedImplementationPlanRevisionForWorkflow(
  repository: DeliveryRepository,
  seeded: Awaited<ReturnType<typeof seedApprovedBoundaryWorkflow>>,
  specRevisionId: string,
): Promise<ExecutionPlanRevision> {
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
    workflow_id: seeded.workflow.id,
    codex_session_id: seeded.workflow.active_codex_session_id,
    based_on_spec_revision_id: specRevisionId,
    revision_number: 1,
    summary: 'Approved implementation plan.',
    content: 'Implementation plan content.',
    structured_document: { steps: ['implement workflow transition service'] },
    author_actor_id: seeded.ids.actorTech,
    created_at: now,
    approved_at: now,
  } as ExecutionPlanRevision & { approved_at: string };
  await repository.saveExecutionPlanRevision(revision);
  return revision;
}
