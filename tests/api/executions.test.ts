import { INestApplication } from '@nestjs/common';
import type { DeliveryRepository } from '@forgeloop/db';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import {
  executionActorDeveloper,
  executionActorOwner,
  seedApprovedExecutionPlan,
} from '../helpers/execution-supervision-fixtures';

const ownerHeaders = {
  'x-forgeloop-actor-id': executionActorOwner,
  'x-forgeloop-actor-class': 'human',
};

describe('Executions API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('starts execution only from an approved Execution Plan revision and links runtime package as evidence', async () => {
    const { workItem, developmentPlan, item, specRevision, executionPlanRevision } = await seedApprovedExecutionPlan(app);
    const server = app.getHttpServer();

    const execution = (
      await request(server)
        .post(`/development-plans/${developmentPlan.id}/items/${item.id}/execution/start`)
        .send({ actor_id: executionActorDeveloper })
        .expect(201)
    ).body;

    expect(execution).toMatchObject({
      development_plan_item_id: item.id,
      execution_plan_revision_id: executionPlanRevision.id,
      status: 'running',
      runtime_evidence_refs: [expect.objectContaining({ type: 'execution_package' })],
    });
    expect(execution).not.toHaveProperty('execution_package_id');

    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const executionPackageRef = execution.runtime_evidence_refs.find(
      (ref: { type: string; id: string }) => ref.type === 'execution_package',
    );
    if (executionPackageRef === undefined) {
      throw new Error('Execution package runtime evidence ref was not recorded');
    }
    const executionPackage = await repository.getExecutionPackage(executionPackageRef.id);
    expect(executionPackage).toMatchObject({
      development_plan_item_id: item.id,
      execution_id: execution.id,
      execution_plan_revision_id: executionPlanRevision.id,
    });
    expect(executionPackage?.task_id).toBeUndefined();
    if (executionPackage === undefined) {
      throw new Error('Execution package was not persisted');
    }
    await request(server)
      .post(`/execution-packages/${executionPackage.id}/mark-ready`)
      .set(ownerHeaders)
      .send({ actor_id: executionActorOwner, expected_package_version: executionPackage.version })
      .expect(201);
    const acceptedRun = (
      await request(server)
        .post(`/execution-packages/${executionPackage.id}/run`)
        .set(ownerHeaders)
        .send({ workflow_only: true })
        .expect(201)
    ).body;
    const runSession = await repository.getRunSession(acceptedRun.run_session_id);
    expect(runSession?.run_spec).toMatchObject({
      execution_package_id: executionPackage.id,
      work_item_id: workItem.id,
      spec_revision_id: specRevision.id,
      plan_revision_id: executionPlanRevision.id,
    });
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({
      execution_status: 'running',
      next_action: 'monitor_execution',
    });
  });

  it('does not create a second product Execution for an already-started item revision', async () => {
    const { developmentPlan, item } = await seedApprovedExecutionPlan(app);
    const server = app.getHttpServer();
    const firstExecution = (
      await request(server)
        .post(`/development-plans/${developmentPlan.id}/items/${item.id}/execution/start`)
        .send({ actor_id: executionActorDeveloper })
        .expect(201)
    ).body;

    const response = await request(server)
      .post(`/development-plans/${developmentPlan.id}/items/${item.id}/execution/start`)
      .send({ actor_id: executionActorDeveloper })
      .expect(409);
    expect(response.body.message).toContain('already has an active execution');

    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const [executionPackageRef] = firstExecution.runtime_evidence_refs.filter(
      (ref: { type: string }) => ref.type === 'execution_package',
    );
    const executionPackage = await repository.getExecutionPackage(executionPackageRef.id);
    expect(executionPackage?.execution_id).toBe(firstExecution.id);
  });

  it('fails closed for missing, draft, stale, or unapproved Execution Plan revisions', async () => {
    const { developmentPlan, item, executionPlan } = await seedApprovedExecutionPlan(app);
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const server = app.getHttpServer();

    const blockedExecutionPlanStates = [
      {
        ...executionPlan,
        status: 'draft' as const,
        approved_revision_id: undefined,
        approved_by_actor_id: undefined,
        approved_at: undefined,
      },
      {
        ...executionPlan,
        status: 'in_review' as const,
        approved_revision_id: undefined,
        approved_by_actor_id: undefined,
        approved_at: undefined,
      },
      {
        ...executionPlan,
        status: 'approved' as const,
        current_revision_id: 'missing-approved-revision',
        approved_revision_id: 'missing-approved-revision',
      },
    ];

    for (const blockedExecutionPlan of blockedExecutionPlanStates) {
      await repository.saveExecutionPlan(blockedExecutionPlan);
      await request(server)
        .post(`/development-plans/${developmentPlan.id}/items/${item.id}/execution/start`)
        .send({ actor_id: executionActorDeveloper })
        .expect(400);
    }

    await repository.saveExecutionPlan({
      ...executionPlan,
      status: 'approved',
      approved_revision_id: executionPlan.approved_revision_id,
      approved_by_actor_id: executionPlan.approved_by_actor_id,
      approved_at: executionPlan.approved_at,
      current_revision_id: 'stale-revision',
    });
    await request(server)
      .post(`/development-plans/${developmentPlan.id}/items/${item.id}/execution/start`)
      .send({ actor_id: executionActorDeveloper })
      .expect(400);
  });

  it('supports interrupt and continue controls for a running product Execution', async () => {
    const { developmentPlan, item } = await seedApprovedExecutionPlan(app);
    const server = app.getHttpServer();
    const execution = (
      await request(server)
        .post(`/development-plans/${developmentPlan.id}/items/${item.id}/execution/start`)
        .send({ actor_id: executionActorDeveloper })
        .expect(201)
    ).body;

    const interrupted = (
      await request(server)
        .post(`/executions/${execution.id}/interrupt`)
        .send({ actor_id: executionActorDeveloper })
        .expect(201)
    ).body;
    expect(interrupted.status).toBe('interrupted');

    const continued = (
      await request(server)
        .post(`/executions/${execution.id}/continue`)
        .send({ actor_id: executionActorDeveloper })
        .expect(201)
    ).body;
    expect(continued.status).toBe('running');
  });
});
