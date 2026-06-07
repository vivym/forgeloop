import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { actorClassHeaderName, actorHeaderName } from '../../apps/control-plane-api/src/modules/auth/actor-context';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import type { DeliveryRepository } from '../../packages/db/src';
import { seedItemScopedSpecPlan } from '../helpers/item-scoped-artifact-fixtures';
import { createWorkflowPolicyRepoRoot } from '../helpers/runtime-policy-repo';

const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const actorQa = 'actor-qa';
const ownerHeaders = { [actorHeaderName]: actorOwner, [actorClassHeaderName]: 'human_admin' };
const reviewerHeaders = { [actorHeaderName]: actorReviewer, [actorClassHeaderName]: 'human' };
const requirementIntakeContext = {
  type: 'requirement',
  stakeholder_problem: 'Local Codex routing fixtures need typed intake context.',
  desired_outcome: 'Routing tests create valid requirement Work Items.',
  acceptance_criteria: ['local_codex run sessions retain workspace evidence.'],
  in_scope: ['Local Codex routing tests'],
};

const requiredChecks = [
  {
    check_id: 'unit',
    display_name: 'Unit tests',
    command: 'pnpm test tests/api/local-codex-routing.test.ts',
    timeout_seconds: 120,
    blocks_review: true,
  },
];

const createApprovedPlanRevision = async (app: INestApplication) => {
  const server = app.getHttpServer();
  const project = (
    await request(server).post('/projects').send({ name: 'Local codex routing', owner_actor_id: actorOwner }).expect(201)
  ).body;
  await request(server)
    .post(`/projects/${project.id}/repos`)
    .send({
      repo_id: 'repo-1',
      name: 'forgeloop',
      local_path: await createWorkflowPolicyRepoRoot(),
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
        title: 'Route local_codex through adapter',
        goal: 'Use the real local_codex executor path for non-workflow runs.',
        success_criteria: ['local_codex run sessions retain workspace evidence.'],
        priority: 'P0',
        risk: 'high',
        driver_actor_id: actorOwner,
        intake_context: requirementIntakeContext,
      })
      .expect(201)
  ).body;

  const { planRevision } = await seedItemScopedSpecPlan(app, workItem.id, {
    actorId: actorOwner,
    reviewerActorId: actorReviewer,
  });

  return planRevision!.id;
};

const createReadyPackage = async (app: INestApplication, planRevisionId: string) => {
  const server = app.getHttpServer();
  const executionPackage = (
    await request(server)
      .post(`/plan-revisions/${planRevisionId}/execution-packages`)
      .send({
        repo_id: 'repo-1',
        objective: 'Produce local_codex routing evidence.',
        owner_actor_id: actorOwner,
        reviewer_actor_id: actorReviewer,
        qa_owner_actor_id: actorQa,
        required_checks: requiredChecks,
        required_artifact_kinds: ['diff', 'execution_summary'],
        allowed_paths: ['docs/superpowers/reports/**'],
        forbidden_paths: ['apps/control-plane-api/**'],
      })
      .expect(201)
  ).body;
  await request(server)
    .post(`/execution-packages/${executionPackage.id}/mark-ready`)
    .set(ownerHeaders)
    .send({ actor_id: actorOwner, expected_package_version: executionPackage.version })
    .expect(201);
  return executionPackage.id as string;
};

const repositoryFor = (app: INestApplication): DeliveryRepository => app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

describe('control-plane local_codex routing', () => {
  let app: INestApplication;
  const runWorker = { kick: vi.fn(), drainOnce: vi.fn() };

  beforeEach(async () => {
    runWorker.kick.mockClear();
    runWorker.drainOnce.mockClear();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DELIVERY_RUN_WORKER)
      .useValue(runWorker)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('fails closed for local_codex non-workflow package runs without dispatching a worker', async () => {
    const server = app.getHttpServer();
    const planRevisionId = await createApprovedPlanRevision(app);
    const packageId = await createReadyPackage(app, planRevisionId);

    const response = await request(server)
      .post(`/execution-packages/${packageId}/run`)
      .set(ownerHeaders)
      .send({ executor_type: 'local_codex', workflow_only: false })
      .expect(410);

    expect(response.body).toMatchObject({
      code: 'legacy_execution_entrypoint_disabled',
    });
    expect(response.body).not.toHaveProperty('run_session_id');
    expect(response.body).not.toHaveProperty('workflow_result');
    expect(runWorker.kick).not.toHaveBeenCalled();
    expect(await repositoryFor(app).listRunSessionsForPackage(packageId)).toEqual([]);
  });

  it('fails closed before workflow-only mock routing when local_codex is requested', async () => {
    const server = app.getHttpServer();
    const planRevisionId = await createApprovedPlanRevision(app);
    const packageId = await createReadyPackage(app, planRevisionId);

    const response = await request(server)
      .post(`/execution-packages/${packageId}/run`)
      .set(ownerHeaders)
      .send({ executor_type: 'local_codex', workflow_only: true })
      .expect(410);

    expect(response.body).toMatchObject({
      code: 'legacy_execution_entrypoint_disabled',
    });
    expect(response.body).not.toHaveProperty('run_session_id');
    expect(response.body).not.toHaveProperty('workflow_result');
    expect(runWorker.kick).not.toHaveBeenCalled();
    expect(await repositoryFor(app).listRunSessionsForPackage(packageId)).toEqual([]);
  });
});
