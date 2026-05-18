import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import type { InMemoryDeliveryRepository } from '../../packages/db/src';

describe('Work Item product API', () => {
  let app: INestApplication;

  const createInitiative = async () => {
    const project = (await request(app.getHttpServer()).post('/projects').send({ name: 'Forgeloop' }).expect(201)).body;
    const workItem = (
      await request(app.getHttpServer())
        .post('/work-items')
        .send({
          project_id: project.id,
          kind: 'initiative',
          title: 'Launch role workbench',
          goal: 'Close the MVP delivery loop.',
          success_criteria: ['Owner can move from intake to spec.'],
          priority: 'P0',
          risk: 'high',
          owner_actor_id: 'actor-owner',
        })
        .expect(201)
    ).body;

    return { project, workItem };
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists Initiative, Requirement, Bug, and Tech Debt work item types', async () => {
    const response = await request(app.getHttpServer()).get('/work-item-types').expect(200);
    expect(response.body.map((item: { kind: string }) => item.kind)).toEqual([
      'initiative',
      'requirement',
      'bug',
      'tech_debt',
    ]);
  });

  it('creates and updates initiative readiness fields', async () => {
    const { workItem: created } = await createInitiative();

    const updated = (
      await request(app.getHttpServer())
        .patch(`/work-items/${created.id}`)
        .send({
          goal: 'Close the delivery-loop MVP.',
          success_criteria: ['Intake actions point to real routes.'],
          priority: 'P0',
          risk: 'medium',
          owner_actor_id: 'actor-owner-2',
        })
        .expect(200)
    ).body;

    expect(updated.kind).toBe('initiative');
    expect(updated.goal).toBe('Close the delivery-loop MVP.');
    expect(updated.success_criteria).toEqual(['Intake actions point to real routes.']);
    expect(updated.priority).toBe('P0');
    expect(updated.risk).toBe('medium');
    expect(updated.owner_actor_id).toBe('actor-owner-2');
  });

  it('rejects lifecycle phase updates and does not mutate the work item', async () => {
    const { workItem } = await createInitiative();

    await request(app.getHttpServer()).patch(`/work-items/${workItem.id}`).send({ phase: 'execution' }).expect(400);

    const unchanged = (await request(app.getHttpServer()).get(`/work-items/${workItem.id}`).expect(200)).body;
    expect(unchanged.phase).toBe('draft');
  });

  it('allows readiness phase changes and records status history', async () => {
    const repository = app.get(DELIVERY_REPOSITORY) as InMemoryDeliveryRepository;
    const { workItem } = await createInitiative();

    const updated = (
      await request(app.getHttpServer()).patch(`/work-items/${workItem.id}`).send({ phase: 'triage' }).expect(200)
    ).body;

    expect(updated.phase).toBe('triage');
    await expect(repository.listStatusHistory(workItem.id, 'work_item')).resolves.toEqual([
      expect.objectContaining({
        object_type: 'work_item',
        object_id: workItem.id,
        from_status: 'draft/none',
        to_status: 'triage/none',
        actor_id: 'actor-owner',
      }),
    ]);
  });

  it('rejects readiness phase changes after lifecycle has started', async () => {
    const repository = app.get(DELIVERY_REPOSITORY) as InMemoryDeliveryRepository;
    const { workItem } = await createInitiative();
    await repository.saveWorkItem({
      ...workItem,
      phase: 'spec',
      gate_state: 'awaiting_spec_approval',
      updated_at: '2026-05-05T00:10:00.000Z',
    });

    await request(app.getHttpServer()).patch(`/work-items/${workItem.id}`).send({ phase: 'triage' }).expect(400);

    const unchanged = (await request(app.getHttpServer()).get(`/work-items/${workItem.id}`).expect(200)).body;
    expect(unchanged.phase).toBe('spec');
    expect(unchanged.gate_state).toBe('awaiting_spec_approval');
  });

  it('rejects empty work item patches', async () => {
    const { workItem } = await createInitiative();

    await request(app.getHttpServer()).patch(`/work-items/${workItem.id}`).send({}).expect(400);
  });
});
