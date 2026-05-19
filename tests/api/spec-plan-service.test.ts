import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { SpecPlanService } from '../../apps/control-plane-api/src/modules/spec-plan/spec-plan.service';

const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const ownerHeaders = {
  'x-forgeloop-actor-id': actorOwner,
  'x-forgeloop-actor-class': 'human_admin',
};
const reviewerHeaders = {
  'x-forgeloop-actor-id': actorReviewer,
  'x-forgeloop-actor-class': 'human',
};

const validSpecRevision = {
  summary: 'Manual API spec',
  content: 'Manual control plane API spec.',
  background: 'The delivery loop needs spec ownership.',
  goals: ['Expose spec commands'],
  scope_in: ['Control plane API'],
  scope_out: ['Executor runtime safety'],
  acceptance_criteria: ['Spec routes are owned by SpecPlanService'],
  risk_notes: ['Keep extraction behavior-compatible'],
  test_strategy_summary: 'Nest + Supertest API tests',
  author_actor_id: actorOwner,
};

const validPlanRevision = {
  summary: 'Manual API plan',
  content: 'Manual control plane API plan.',
  implementation_summary: 'Extract the spec/plan controller and service.',
  split_strategy: 'Move spec and plan behavior together.',
  dependency_order: ['spec-plan-service'],
  test_matrix: ['pnpm vitest run tests/api/spec-plan-service.test.ts'],
  risk_mitigations: ['Keep old service callers as thin delegates'],
  rollback_notes: 'Revert the extraction commit.',
  author_actor_id: actorOwner,
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
        kind: 'requirement',
        title: 'Extract SpecPlanService',
        goal: 'Move spec and plan commands to the delivery boundary.',
        success_criteria: ['Spec and plan routes stay behavior-compatible.'],
        priority: 'P0',
        risk: 'medium',
        owner_actor_id: actorOwner,
      })
      .expect(201)
  ).body;

  return { project, workItem };
};

const createApprovedSpec = async (app: INestApplication, workItemId: string) => {
  const server = app.getHttpServer();
  const spec = (await request(server).post(`/work-items/${workItemId}/specs`).send({}).expect(201)).body;
  await request(server).post(`/specs/${spec.id}/revisions`).send(validSpecRevision).expect(201);
  await request(server)
    .post(`/specs/${spec.id}/submit-for-approval`)
    .set(ownerHeaders)
    .send({ actor_id: actorOwner })
    .expect(201);
  return (await request(server).post(`/specs/${spec.id}/approve`).set(reviewerHeaders).send({ actor_id: actorReviewer }).expect(201))
    .body;
};

describe('SpecPlanService delivery API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('owns spec and plan commands and advances WorkItem phase gates', async () => {
    expect(app.get(SpecPlanService)).toBeInstanceOf(SpecPlanService);

    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);

    const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;
    const specRevision = (await request(server).post(`/specs/${spec.id}/revisions`).send(validSpecRevision).expect(201)).body;
    expect(specRevision.spec_id).toBe(spec.id);

    await request(server)
      .post(`/specs/${spec.id}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);
    const approvedSpec = (
      await request(server).post(`/specs/${spec.id}/approve`).set(reviewerHeaders).send({ actor_id: actorReviewer }).expect(201)
    ).body;
    expect(approvedSpec.approved_revision_id).toBe(specRevision.id);
    expect((await request(server).get(`/specs/${spec.id}`).expect(200)).body.approved_revision_id).toBe(specRevision.id);

    expect((await request(server).get(`/work-items/${workItem.id}`).expect(200)).body).toMatchObject({
      phase: 'plan',
      gate_state: 'none',
      current_spec_id: spec.id,
    });

    const plan = (await request(server).post(`/work-items/${workItem.id}/plans`).send({}).expect(201)).body;
    const generatedPlanRevision = (await request(server).post(`/plans/${plan.id}/generate-draft`).send({}).expect(201)).body;
    expect(generatedPlanRevision.plan_id).toBe(plan.id);

    const planRevision = (await request(server).post(`/plans/${plan.id}/revisions`).send(validPlanRevision).expect(201)).body;
    await request(server)
      .post(`/plans/${plan.id}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);
    const approvedPlan = (
      await request(server).post(`/plans/${plan.id}/approve`).set(reviewerHeaders).send({ actor_id: actorReviewer }).expect(201)
    ).body;
    expect(approvedPlan.approved_revision_id).toBe(planRevision.id);
    expect((await request(server).get(`/plans/${plan.id}`).expect(200)).body.approved_revision_id).toBe(planRevision.id);

    expect((await request(server).get(`/work-items/${workItem.id}`).expect(200)).body).toMatchObject({
      phase: 'execution',
      gate_state: 'none',
      current_plan_id: plan.id,
    });
  });

  it('uses the WorkItem owner as the generated draft actor anchor', async () => {
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);

    const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;
    const generatedSpecRevision = (await request(server).post(`/specs/${spec.id}/generate-draft`).send({}).expect(201)).body;
    expect(generatedSpecRevision.author_actor_id).toBe(actorOwner);

    await request(server)
      .post(`/specs/${spec.id}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);
    await request(server).post(`/specs/${spec.id}/approve`).set(reviewerHeaders).send({ actor_id: actorReviewer }).expect(201);

    const plan = (await request(server).post(`/work-items/${workItem.id}/plans`).send({}).expect(201)).body;
    const generatedPlanRevision = (await request(server).post(`/plans/${plan.id}/generate-draft`).send({}).expect(201)).body;
    expect(generatedPlanRevision.author_actor_id).toBe(actorOwner);
  });

  it('rejects submitting a spec without a current revision', async () => {
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);

    const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;
    const response = await request(server)
      .post(`/specs/${spec.id}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(400);

    expect(response.body.message).toContain('has no current revision');
  });

  it('rejects submitting a plan without a current revision', async () => {
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);

    const spec = await createApprovedSpec(app, workItem.id);
    expect(spec.approved_revision_id).toBeDefined();

    const plan = (await request(server).post(`/work-items/${workItem.id}/plans`).send({}).expect(201)).body;
    const response = await request(server)
      .post(`/plans/${plan.id}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(400);

    expect(response.body.message).toContain('has no current revision');
  });

  it('rejects request changes without a rationale', async () => {
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);
    const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;
    await request(server).post(`/specs/${spec.id}/revisions`).send(validSpecRevision).expect(201);
    await request(server)
      .post(`/specs/${spec.id}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);

    await request(server)
      .post(`/specs/${spec.id}/request-changes`)
      .set(reviewerHeaders)
      .send({ actor_id: actorReviewer, rationale: '   ' })
      .expect(400);
  });

  it('rejects approval and request changes unless the artifact is in review', async () => {
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);
    const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;
    await request(server).post(`/specs/${spec.id}/revisions`).send(validSpecRevision).expect(201);

    await request(server)
      .post(`/specs/${spec.id}/approve`)
      .set(reviewerHeaders)
      .send({ actor_id: actorReviewer })
      .expect(400);
    await request(server)
      .post(`/specs/${spec.id}/request-changes`)
      .set(reviewerHeaders)
      .send({ actor_id: actorReviewer, rationale: 'Needs review first.' })
      .expect(400);
  });

  it('resubmits specs and plans after requested changes', async () => {
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);
    const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;
    await request(server).post(`/specs/${spec.id}/revisions`).send(validSpecRevision).expect(201);
    await request(server)
      .post(`/specs/${spec.id}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);
    await request(server)
      .post(`/specs/${spec.id}/request-changes`)
      .set(reviewerHeaders)
      .send({ actor_id: actorReviewer, rationale: 'Clarify acceptance criteria.' })
      .expect(201);

    await request(server)
      .post(`/specs/${spec.id}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);
    expect((await request(server).get(`/work-items/${workItem.id}`).expect(200)).body).toMatchObject({
      phase: 'spec',
      gate_state: 'awaiting_spec_approval',
    });

    await request(server).post(`/specs/${spec.id}/approve`).set(reviewerHeaders).send({ actor_id: actorReviewer }).expect(201);
    const plan = (await request(server).post(`/work-items/${workItem.id}/plans`).send({}).expect(201)).body;
    await request(server).post(`/plans/${plan.id}/revisions`).send(validPlanRevision).expect(201);
    await request(server)
      .post(`/plans/${plan.id}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);
    await request(server)
      .post(`/plans/${plan.id}/request-changes`)
      .set(reviewerHeaders)
      .send({ actor_id: actorReviewer, rationale: 'Split rollout checks.' })
      .expect(201);

    await request(server)
      .post(`/plans/${plan.id}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);
    expect((await request(server).get(`/work-items/${workItem.id}`).expect(200)).body).toMatchObject({
      phase: 'plan',
      gate_state: 'awaiting_plan_approval',
    });
  });
});
