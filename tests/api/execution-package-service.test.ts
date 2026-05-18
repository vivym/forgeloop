import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { ExecutionPackageService } from '../../apps/control-plane-api/src/modules/execution-packages/execution-package.service';
import { InMemoryDeliveryRepository } from '../../packages/db/src/index';
import { transitionReviewPacket } from '../../packages/domain/src/index';

const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const actorQa = 'actor-qa';
const ownerHeaders = {
  'x-forgeloop-actor-id': actorOwner,
  'x-forgeloop-actor-class': 'human_admin',
};
const reviewerHeaders = {
  'x-forgeloop-actor-id': actorReviewer,
  'x-forgeloop-actor-class': 'human',
};

const requiredChecks = [
  {
    check_id: 'unit',
    display_name: 'Unit tests',
    command: 'pnpm vitest run tests/api/execution-package-service.test.ts',
    timeout_seconds: 120,
    blocks_review: true,
  },
];

const validPackageBody = {
  repo_id: 'repo-1',
  objective: 'Implement the execution package service.',
  owner_actor_id: actorOwner,
  reviewer_actor_id: actorReviewer,
  qa_owner_actor_id: actorQa,
  required_checks: requiredChecks,
  required_artifact_kinds: ['execution_summary'],
  allowed_paths: ['apps/control-plane-api/**', 'tests/api/**'],
  forbidden_paths: ['packages/db/**'],
};

const validSpecRevision = {
  summary: 'Execution package service spec',
  content: 'Move execution package lifecycle routes to the delivery boundary.',
  background: 'Execution packages need semantic module ownership.',
  goals: ['Extract package lifecycle behavior'],
  scope_in: ['Execution package routes and service'],
  scope_out: ['Executor runtime safety'],
  acceptance_criteria: ['Package generation, edits, and ready transitions remain behavior-compatible'],
  risk_notes: ['Keep package graph validation intact'],
  test_strategy_summary: 'Focused API tests for execution packages',
  author_actor_id: actorOwner,
};

const validPlanRevision = {
  summary: 'Execution package service plan',
  content: 'Create ExecutionPackageService and route package lifecycle commands through it.',
  implementation_summary: 'Move package methods out of the old service.',
  split_strategy: 'One package lifecycle module.',
  dependency_order: ['execution-packages'],
  test_matrix: ['pnpm vitest run tests/api/execution-package-service.test.ts'],
  risk_mitigations: ['Keep old internal callers as delegates'],
  rollback_notes: 'Revert the extraction commit.',
  author_actor_id: actorOwner,
};

const createApprovedPlan = async (app: INestApplication) => {
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
        title: 'Extract ExecutionPackageService',
        goal: 'Move execution package commands to the delivery boundary.',
        success_criteria: ['Execution package routes are owned by ExecutionPackageService.'],
        priority: 'P0',
        risk: 'medium',
        owner_actor_id: actorOwner,
      })
      .expect(201)
  ).body;

  const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;
  await request(server).post(`/specs/${spec.id}/revisions`).send(validSpecRevision).expect(201);
  await request(server)
    .post(`/specs/${spec.id}/submit-for-approval`)
    .set(ownerHeaders)
    .send({ actor_id: actorOwner })
    .expect(201);
  await request(server).post(`/specs/${spec.id}/approve`).set(reviewerHeaders).send({ actor_id: actorReviewer }).expect(201);

  const plan = (await request(server).post(`/work-items/${workItem.id}/plans`).send({}).expect(201)).body;
  const planRevision = (await request(server).post(`/plans/${plan.id}/revisions`).send(validPlanRevision).expect(201)).body;
  await request(server)
    .post(`/plans/${plan.id}/submit-for-approval`)
    .set(ownerHeaders)
    .send({ actor_id: actorOwner })
    .expect(201);
  await request(server).post(`/plans/${plan.id}/approve`).set(reviewerHeaders).send({ actor_id: actorReviewer }).expect(201);

  return { workItem, planRevision };
};

const repositoryFor = (app: INestApplication): InMemoryDeliveryRepository =>
  (app.get(ExecutionPackageService) as unknown as { repository: InMemoryDeliveryRepository }).repository;

describe('ExecutionPackageService delivery API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('owns package generation, manual creation, patching, and ready transition routes', async () => {
    expect(app.get(ExecutionPackageService)).toBeInstanceOf(ExecutionPackageService);

    const server = app.getHttpServer();
    const { workItem, planRevision } = await createApprovedPlan(app);

    const generated = (await request(server).post(`/plan-revisions/${planRevision.id}/generate-packages`).send({}).expect(201))
      .body;
    expect(generated).toHaveLength(1);
    expect(generated[0].execution_package_set_id).toBe(`generation:${planRevision.id}:default`);
    expect(generated[0].generation_key).toBe('default');
    expect(generated[0].package_policy_snapshot.policy_digest).toBe('delivery-default-policy');
    expect(generated[0].package_policy_snapshot.policy_source_path).toBe('forgeloop://delivery/default-package-policy');

    const created = (
      await request(server).post(`/plan-revisions/${planRevision.id}/execution-packages`).send(validPackageBody).expect(201)
    ).body;
    expect(created.package_policy_snapshot.policy_digest).toBe('delivery-manual-package-policy');
    expect(created.package_policy_snapshot.policy_source_path).toBe('forgeloop://delivery/manual-package-policy');

    expect((await request(server).get(`/work-items/${workItem.id}/execution-packages`).expect(200)).body.length).toBeGreaterThanOrEqual(2);
    await request(server).get(`/execution-packages/${created.id}`).expect(200);

    const patched = (await request(server).patch(`/execution-packages/${created.id}`).send({ objective: 'Updated objective' }).expect(200))
      .body;
    expect(patched).toMatchObject({ objective: 'Updated objective', version: 1 });

    const ready = (
      await request(server)
        .post(`/execution-packages/${created.id}/mark-ready`)
        .set(ownerHeaders)
        .send({ actor_id: actorOwner, expected_package_version: 1 })
        .expect(201)
    ).body;
    expect(ready).toMatchObject({ phase: 'ready', version: 2 });
  });

  it('rejects stale package versions before marking ready', async () => {
    const server = app.getHttpServer();
    const { planRevision } = await createApprovedPlan(app);
    const created = (
      await request(server).post(`/plan-revisions/${planRevision.id}/execution-packages`).send(validPackageBody).expect(201)
    ).body;
    await request(server).patch(`/execution-packages/${created.id}`).send({ objective: 'Updated objective' }).expect(200);

    const response = await request(server)
      .post(`/execution-packages/${created.id}/mark-ready`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner, expected_package_version: 0 })
      .expect(422);

    expect(response.body).toMatchObject({
      code: 'stale_execution_package_revision',
      message: 'Execution package version changed before mark ready.',
    });
  });

  it('blocks package edits while an open ReviewPacket exists', async () => {
    const server = app.getHttpServer();
    const { planRevision } = await createApprovedPlan(app);
    const created = (
      await request(server).post(`/plan-revisions/${planRevision.id}/execution-packages`).send(validPackageBody).expect(201)
    ).body;
    const repository = repositoryFor(app);
    await repository.saveReviewPacket(
      transitionReviewPacket(undefined, {
        type: 'create',
        id: 'review-packet-open',
        run_session_id: 'run-session-open',
        execution_package_id: created.id,
        reviewer_actor_id: actorReviewer,
        spec_revision_id: created.spec_revision_id,
        plan_revision_id: created.plan_revision_id,
        changed_files: [],
        check_result_summary: 'Pending review.',
        self_review: {
          status: 'succeeded',
          summary: 'Self-review is ready.',
          spec_plan_alignment: 'Matches the approved plan.',
          test_assessment: 'Required checks passed.',
          risk_notes: [],
          follow_up_questions: [],
        },
        risk_notes: [],
      }),
    );

    const response = await request(server).patch(`/execution-packages/${created.id}`).send({ objective: 'Blocked edit' }).expect(422);

    expect(response.body).toMatchObject({
      code: 'automation_gate_pending',
      message: 'Open review packet blocks package edit.',
    });
  });
});
