import { INestApplication } from '@nestjs/common';
import type { DeliveryRepository } from '@forgeloop/db';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';

const actorProduct = 'actor-product';
const actorTech = 'actor-tech';
const actorReviewer = 'actor-reviewer';

describe('SpecPlanService item-scoped delivery API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('generates Spec only from an approved Development Plan Item boundary', async () => {
    const { plan: unapprovedPlan, item: unapprovedItem } = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();

    await request(server)
      .post(`/development-plans/${unapprovedPlan.id}/items/${unapprovedItem.id}/spec/generate-draft`)
      .send({ actor_id: actorTech })
      .expect(400);

    const { plan, item, boundary } = await seedApprovedBoundary(app);
    const specRevision = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec/generate-draft`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;

    expect(specRevision).toMatchObject({
      development_plan_item_id: item.id,
      boundary_summary_id: boundary.id,
      context_manifest_id: expect.any(String),
      author_actor_id: actorTech,
    });

    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await expect(repository.getContextManifest(specRevision.context_manifest_id)).resolves.toMatchObject({
      development_plan_id: plan.id,
      development_plan_item_id: item.id,
      boundary_summary_id: boundary.id,
    });
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ spec_status: 'draft' });
  });

  it('rejects Execution Plan generation until Spec is approved', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    const server = app.getHttpServer();

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/execution-plan/generate-draft`)
      .send({ actor_id: actorTech })
      .expect(400);
  });

  it('supports submit, request changes, regenerate, compare, submit, and approve for Spec reviews', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    const firstSpecRevision = await generateItemSpecDraft(app, plan.id, item.id);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/submit-for-approval`)
      .send({ actor_id: actorTech })
      .expect(201);
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ spec_status: 'in_review' });

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/request-changes`)
      .send({ actor_id: actorReviewer, rationale: 'Clarify acceptance criteria.' })
      .expect(201);
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ spec_status: 'changes_requested' });

    const secondSpecRevision = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec/regenerate-draft`)
        .send({
          actor_id: actorTech,
          feedback: 'Add explicit route and API validation.',
          preserve_prior_decisions: true,
        })
        .expect(201)
    ).body;
    expect(secondSpecRevision.revision_number).toBe(firstSpecRevision.revision_number + 1);
    expect(secondSpecRevision.context_manifest_id).not.toBe(firstSpecRevision.context_manifest_id);

    const specDiff = (
      await request(server)
        .get(`/development-plans/${plan.id}/items/${item.id}/spec/revisions/compare`)
        .query({ base_revision_id: firstSpecRevision.id, compare_revision_id: secondSpecRevision.id })
        .expect(200)
    ).body;
    expect(specDiff).toMatchObject({
      base_revision_id: firstSpecRevision.id,
      compare_revision_id: secondSpecRevision.id,
      changed_fields: expect.arrayContaining(['content', 'context_manifest_id', 'revision_number']),
    });

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/submit-for-approval`)
      .send({ actor_id: actorTech })
      .expect(201);
    const approvedSpec = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec/approve`)
        .send({ actor_id: actorReviewer, rationale: 'Spec approved.' })
        .expect(201)
    ).body;

    expect(approvedSpec).toMatchObject({
      approved_revision_id: secondSpecRevision.id,
      approved_by_actor_id: actorReviewer,
      status: 'approved',
    });
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ spec_status: 'approved' });
    await expect(repository.listDecisionsForObject('spec', approvedSpec.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actor_id: actorReviewer, decision: 'approved', summary: 'Spec approved.' }),
      ]),
    );
  });

  it('supports generate after approved Spec, submit, reject, regenerate, and compare for Execution Plan reviews', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    const specRevision = await generateItemSpecDraft(app, plan.id, item.id);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/submit-for-approval`)
      .send({ actor_id: actorTech })
      .expect(201);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/approve`)
      .send({ actor_id: actorReviewer, rationale: 'Spec approved.' })
      .expect(201);

    const firstExecutionPlanRevision = await generateItemExecutionPlanDraft(app, plan.id, item.id);
    expect(firstExecutionPlanRevision).toMatchObject({
      development_plan_item_id: item.id,
      based_on_spec_revision_id: specRevision.id,
      author_actor_id: actorTech,
    });
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ execution_plan_status: 'draft' });

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/execution-plan/submit-for-approval`)
      .send({ actor_id: actorTech })
      .expect(201);
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ execution_plan_status: 'in_review' });

    const rejected = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/execution-plan/reject`)
        .send({ actor_id: actorReviewer, rationale: 'Plan does not include QA handoff validation.' })
        .expect(201)
    ).body;
    expect(rejected.status).toBe('changes_requested');
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ execution_plan_status: 'changes_requested' });

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/execution-plan/submit-for-approval`)
      .send({ actor_id: actorTech })
      .expect(400);

    const secondExecutionPlanRevision = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/execution-plan/regenerate-draft`)
        .send({
          actor_id: actorTech,
          feedback: 'Add QA handoff validation and visual checks.',
          preserve_prior_decisions: true,
        })
        .expect(201)
    ).body;
    expect(secondExecutionPlanRevision.revision_number).toBe(firstExecutionPlanRevision.revision_number + 1);

    const executionPlanDiff = (
      await request(server)
        .get(`/development-plans/${plan.id}/items/${item.id}/execution-plan/revisions/compare`)
        .query({
          base_revision_id: firstExecutionPlanRevision.id,
          compare_revision_id: secondExecutionPlanRevision.id,
        })
        .expect(200)
    ).body;
    expect(executionPlanDiff).toMatchObject({
      base_revision_id: firstExecutionPlanRevision.id,
      compare_revision_id: secondExecutionPlanRevision.id,
      changed_fields: expect.arrayContaining(['content', 'revision_number']),
    });
    await expect(repository.listDecisionsForObject('execution_plan', rejected.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor_id: actorReviewer,
          decision: 'changes_requested',
          summary: 'Plan does not include QA handoff validation.',
        }),
      ]),
    );
  });
});

async function generateItemSpecDraft(app: INestApplication, developmentPlanId: string, itemId: string) {
  return (
    await request(app.getHttpServer())
      .post(`/development-plans/${developmentPlanId}/items/${itemId}/spec/generate-draft`)
      .send({ actor_id: actorTech })
      .expect(201)
  ).body;
}

async function generateItemExecutionPlanDraft(app: INestApplication, developmentPlanId: string, itemId: string) {
  return (
    await request(app.getHttpServer())
      .post(`/development-plans/${developmentPlanId}/items/${itemId}/execution-plan/generate-draft`)
      .send({ actor_id: actorTech })
      .expect(201)
  ).body;
}

async function seedApprovedBoundary(app: INestApplication) {
  const seeded = await seedDevelopmentPlanItem(app);
  const server = app.getHttpServer();
  const session = (
    await request(server)
      .post(`/development-plans/${seeded.plan.id}/items/${seeded.item.id}/brainstorming-sessions`)
      .send({ actor_id: actorTech })
      .expect(201)
  ).body;

  for (const question of session.questions) {
    await request(server)
      .post(`/brainstorming-sessions/${session.id}/answers`)
      .send({
        question_id: question.id,
        text: `Answered boundary question: ${question.text}`,
        actor_id: actorTech,
      })
      .expect(201);
  }

  await request(server)
    .post(`/brainstorming-sessions/${session.id}/decisions`)
    .send({
      text: 'Keep implementation scoped to item-level spec and execution plan gates.',
      rationale: 'The Development Plan Item is the product boundary.',
      actor_id: actorTech,
    })
    .expect(201);

  const approved = (
    await request(server)
      .post(`/brainstorming-sessions/${session.id}/approve-boundary`)
      .send({
        confirmed_scope: ['Item-scoped Spec and Execution Plan APIs'],
        confirmed_out_of_scope: ['Direct Work Item creation compatibility'],
        accepted_assumptions: ['Mock draft generation is sufficient for service tests'],
        open_risks: ['Reviewers need structured revision comparison'],
        validation_expectations: ['API and contract tests pass'],
        actor_id: actorTech,
        final_decision: 'Approve this Development Plan Item boundary.',
      })
      .expect(201)
  ).body;

  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const boundary = await repository.getBoundarySummary(approved.boundary_summary_id);
  expect(boundary).toBeDefined();

  return { ...seeded, session: approved, boundary: boundary! };
}

async function seedDevelopmentPlanItem(app: INestApplication) {
  const { project, workItem } = await createProjectRepoWorkItem(app);
  const server = app.getHttpServer();
  const plan = (
    await request(server)
      .post('/development-plans')
      .send({
        project_id: project.id,
        source_ref: { type: 'requirement', id: workItem.id },
        title: 'Spec and execution plan gate development plan',
        actor_id: actorProduct,
      })
      .expect(201)
  ).body;
  const item = (
    await request(server)
      .post(`/development-plans/${plan.id}/items`)
      .send({
        title: 'Gate specs and execution plans by item',
        summary: 'Generate and review artifacts only from approved Development Plan Item boundaries.',
        responsible_role: 'tech_lead',
        driver_actor_id: actorTech,
        reviewer_actor_id: actorReviewer,
        risk: 'medium',
        dependency_hints: [],
        affected_surfaces: ['apps/control-plane-api', 'apps/web'],
        release_impact: 'release_scoped',
      })
      .expect(201)
  ).body;

  return { project, workItem, plan, item };
}

const createProjectRepoWorkItem = async (app: INestApplication) => {
  const server = app.getHttpServer();
  const project = (
    await request(server).post('/projects').send({ name: 'Forgeloop', owner_actor_id: actorProduct }).expect(201)
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
        kind: 'requirement',
        title: 'Extract SpecPlanService',
        goal: 'Move spec and execution plan commands to the item boundary.',
        success_criteria: ['Spec and execution plan routes are item-scoped.'],
        priority: 'P0',
        risk: 'medium',
        driver_actor_id: actorProduct,
        intake_context: {
          type: 'requirement',
          stakeholder_problem: 'Direct source-object spec and plan routing bypasses item boundaries.',
          desired_outcome: 'Artifacts are generated from approved Development Plan Items.',
          acceptance_criteria: ['Spec and execution plan commands require item gates.'],
          in_scope: ['SpecPlanService API tests'],
        },
      })
      .expect(201)
  ).body;

  return { project, workItem };
};
