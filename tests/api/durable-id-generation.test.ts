import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import {
  DELIVERY_REPOSITORY,
  RUN_DURABILITY_MODE,
} from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import { actorClassHeaderName, actorHeaderName } from '../../apps/control-plane-api/src/modules/auth/actor-context';
import { InMemoryDeliveryRepository } from '../../packages/db/src';
import { createWorkflowPolicyRepoRoot } from '../helpers/runtime-policy-repo';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('durable delivery object IDs', () => {
  const apps: INestApplication[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  const createDurableApp = async (repository: InMemoryDeliveryRepository): Promise<INestApplication> => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DELIVERY_REPOSITORY)
      .useValue(repository)
      .overrideProvider(DELIVERY_RUN_WORKER)
      .useValue({ kick: () => undefined, drainOnce: async () => undefined })
      .overrideProvider(RUN_DURABILITY_MODE)
      .useValue('durable')
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    apps.push(app);
    return app;
  };

  it('does not reuse deterministic IDs after a durable app restart', async () => {
    const repository = new InMemoryDeliveryRepository();
    const firstApp = await createDurableApp(repository);
    const firstProject = (
      await request(firstApp.getHttpServer())
        .post('/projects')
        .send({ name: 'First durable app', owner_actor_id: 'actor-owner' })
        .expect(201)
    ).body as { id: string };

    await firstApp.close();
    apps.splice(apps.indexOf(firstApp), 1);

    const secondApp = await createDurableApp(repository);
    const secondProject = (
      await request(secondApp.getHttpServer())
        .post('/projects')
        .send({ name: 'Second durable app', owner_actor_id: 'actor-owner' })
        .expect(201)
    ).body as { id: string };

    expect(secondProject.id).not.toBe(firstProject.id);
  });

  it('uses UUID ids for durable public delivery API-created aggregates', async () => {
    const repository = new InMemoryDeliveryRepository();
    const app = await createDurableApp(repository);
    const server = app.getHttpServer();
    const ownerActorId = '11111111-1111-4111-8111-111111111111';
    const reviewerActorId = '22222222-2222-4222-8222-222222222222';
    const qaActorId = '33333333-3333-4333-8333-333333333333';
    const ownerHeaders = { [actorHeaderName]: ownerActorId, [actorClassHeaderName]: 'human_admin' };
    const reviewerHeaders = { [actorHeaderName]: reviewerActorId, [actorClassHeaderName]: 'human' };

    const project = (await request(server).post('/projects').send({ name: 'Durable UUIDs', owner_actor_id: ownerActorId }).expect(201))
      .body;
    await request(server)
      .post(`/projects/${project.id}/repos`)
      .send({
        repo_id: 'forgeloop-source',
        name: 'forgeloop',
        local_path: await createWorkflowPolicyRepoRoot({ allowedPaths: ['README.md'], forbiddenPaths: ['.git'] }),
        base_commit_sha: 'base',
      })
      .expect(201);
    const workItem = (
      await request(server)
        .post('/work-items')
        .send({
          project_id: project.id,
          kind: 'requirement',
          title: 'Durable UUID path',
          goal: 'Prove durable ids',
          success_criteria: ['ids are UUIDs'],
          priority: 'P1',
          risk: 'low',
          owner_actor_id: ownerActorId,
        })
        .expect(201)
    ).body;
    const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;
    const specRevision = (
      await request(server)
        .post(`/specs/${spec.id}/revisions`)
        .send({
          summary: 'Durable spec',
          content: 'Spec content',
          background: 'Background',
          goals: ['Goal'],
          scope_in: ['In'],
          scope_out: ['Out'],
          acceptance_criteria: ['Accept'],
          test_strategy_summary: 'Test',
          author_actor_id: ownerActorId,
        })
        .expect(201)
    ).body;
    await request(server)
      .post(`/specs/${spec.id}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: ownerActorId })
      .expect(201);
    await request(server)
      .post(`/specs/${spec.id}/approve`)
      .set(reviewerHeaders)
      .send({ actor_id: reviewerActorId })
      .expect(201);
    const plan = (await request(server).post(`/work-items/${workItem.id}/plans`).send({}).expect(201)).body;
    const planRevision = (
      await request(server)
        .post(`/plans/${plan.id}/revisions`)
        .send({
          summary: 'Durable plan',
          content: 'Plan content',
          implementation_summary: 'Implement',
          split_strategy: 'One package',
          dependency_order: [],
          test_matrix: ['pnpm test'],
          rollback_notes: 'Revert',
          author_actor_id: ownerActorId,
        })
        .expect(201)
    ).body;
    await request(server)
      .post(`/plans/${plan.id}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: ownerActorId })
      .expect(201);
    await request(server)
      .post(`/plans/${plan.id}/approve`)
      .set(reviewerHeaders)
      .send({ actor_id: reviewerActorId })
      .expect(201);
    const executionPackage = (
      await request(server)
        .post(`/plan-revisions/${planRevision.id}/execution-packages`)
        .send({
          repo_id: 'forgeloop-source',
          objective: 'Durable package',
          owner_actor_id: ownerActorId,
          reviewer_actor_id: reviewerActorId,
          qa_owner_actor_id: qaActorId,
          required_checks: [
            {
              check_id: 'unit',
              display_name: 'Unit',
              command: 'node --version',
              timeout_seconds: 30,
              blocks_review: true,
            },
          ],
          required_artifact_kinds: ['execution_summary'],
          allowed_paths: ['README.md'],
          forbidden_paths: ['.git'],
        })
        .expect(201)
    ).body;
    await request(server)
      .post(`/execution-packages/${executionPackage.id}/mark-ready`)
      .set(ownerHeaders)
      .send({ actor_id: ownerActorId, expected_package_version: executionPackage.version })
      .expect(201);
    const run = (
      await request(server)
        .post(`/execution-packages/${executionPackage.id}/run`)
        .set(ownerHeaders)
        .send({
          executor_type: 'mock',
          workflow_only: true,
        })
        .expect(201)
    ).body;

    for (const id of [
      project.id,
      workItem.id,
      spec.id,
      specRevision.id,
      plan.id,
      planRevision.id,
      executionPackage.id,
      run.run_session_id,
    ]) {
      expect(id).toMatch(uuidPattern);
    }
  });
});
