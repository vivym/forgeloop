import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { WorkItemIntakeContext, WorkItemKind } from '@forgeloop/contracts';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import type { InMemoryDeliveryRepository } from '../../packages/db/src';

const intakeContextByKind = {
  initiative: {
    type: 'initiative',
    business_outcome: 'Reduce delivery coordination overhead.',
    scope_narrative: 'Coordinate intake, planning, and execution readiness.',
    success_metrics: ['A driver can move intake into triage.'],
  },
  requirement: {
    type: 'requirement',
    stakeholder_problem: 'Stakeholders cannot tell whether intake is ready.',
    desired_outcome: 'Ready requirements carry enough context for specification.',
    acceptance_criteria: ['Context is visible on the Work Item.'],
    in_scope: ['Typed Work Item intake'],
  },
  bug: {
    type: 'bug',
    impact_summary: 'Delivery status is misleading.',
    observed_behavior: 'The item appears owner-driven.',
    expected_behavior: 'The item appears driver-driven.',
    reproduction_steps: ['Create a bug Work Item', 'Inspect the response'],
    affected_environment: 'control-plane API',
    verification_path: 'API regression test',
  },
  tech_debt: {
    type: 'tech_debt',
    current_pain: 'Work Item intake shape is ambiguous.',
    desired_invariant: 'Each Work Item kind has a specific intake context.',
    affected_modules: ['control-plane-api'],
    behavior_preservation: 'Project and Execution Package owner fields still work.',
    validation_strategy: 'Focused API tests',
  },
} satisfies Record<WorkItemKind, WorkItemIntakeContext>;

describe('Work Item product API', () => {
  let app: INestApplication;

  const createProject = async () =>
    (await request(app.getHttpServer()).post('/projects').send({ name: 'Forgeloop' }).expect(201)).body;

  const createWorkItem = async (kind: WorkItemKind = 'requirement', overrides: Record<string, unknown> = {}) => {
    const project = await createProject();
    const workItem = (
      await request(app.getHttpServer())
        .post('/work-items')
        .send({
          project_id: project.id,
          kind,
          title: `Launch ${kind} workbench`,
          goal: 'Close the MVP delivery loop.',
          success_criteria: ['Driver can move from intake to spec.'],
          priority: kind === 'bug' ? 'critical' : 'P1',
          risk: kind === 'bug' ? 'high' : 'medium',
          driver_actor_id: 'actor-driver',
          intake_context: intakeContextByKind[kind],
          ...overrides,
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

  it('lists typed work item metadata without owner compatibility fields', async () => {
    const response = await request(app.getHttpServer()).get('/work-item-types').expect(200);
    expect(response.body.map((item: { kind: string }) => item.kind)).toEqual([
      'initiative',
      'requirement',
      'bug',
      'tech_debt',
    ]);
    expect(response.body.every((item: Record<string, unknown>) => !('recommended_next_actions' in item))).toBe(true);
    expect(response.body.every((item: Record<string, unknown>) => !('default_priority' in item))).toBe(true);
    expect(
      response.body.every((item: { required_fields: string[] }) => item.required_fields.includes('driver_actor_id')),
    ).toBe(true);
    expect(
      response.body.every((item: { required_fields: string[] }) => item.required_fields.includes('intake_context')),
    ).toBe(true);
    expect(
      response.body.every((item: { required_fields: string[] }) => !item.required_fields.includes('owner_actor_id')),
    ).toBe(true);
  });

  it('creates each typed work item kind with matching intake context', async () => {
    for (const kind of ['initiative', 'requirement', 'bug', 'tech_debt'] as const) {
      const { workItem } = await createWorkItem(kind);

      expect(workItem.kind).toBe(kind);
      expect(workItem.driver_actor_id).toBe('actor-driver');
      expect(workItem.intake_context).toEqual(intakeContextByKind[kind]);
      expect(workItem).not.toHaveProperty('owner_actor_id');
    }
  });

  it('creates a Requirement document from the concrete route without accepting body kind', async () => {
    const project = await createProject();

    const createdRequirement = (
      await request(app.getHttpServer())
        .post('/requirements')
        .send({
          project_id: project.id,
          title: 'Create runtime dogfood source',
          goal: 'Seed a canonical Requirement for the product loop.',
          success_criteria: ['The created object uses the route planning input type.'],
          priority: 'P0',
          risk: 'high',
          driver_actor_id: 'actor-driver',
          intake_context: intakeContextByKind.requirement,
        })
        .expect(201)
    ).body;

    expect(createdRequirement).toMatchObject({
      project_id: project.id,
      kind: 'requirement',
      title: 'Create runtime dogfood source',
      driver_actor_id: 'actor-driver',
      intake_context: intakeContextByKind.requirement,
    });
    expect(createdRequirement).not.toHaveProperty('owner_actor_id');

    await request(app.getHttpServer())
      .post('/requirements')
      .send({
        project_id: project.id,
        kind: 'requirement',
        title: 'Reject duplicated source kind',
        goal: 'The route-derived planning input type is authoritative.',
        success_criteria: ['body.kind is not accepted.'],
        priority: 'P0',
        risk: 'high',
        driver_actor_id: 'actor-driver',
        intake_context: intakeContextByKind.requirement,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/requirements')
      .send({
        project_id: project.id,
        title: 'Reject mismatched source intake',
        goal: 'The route type and intake context must agree.',
        success_criteria: ['Mismatched intake is rejected.'],
        priority: 'P0',
        risk: 'high',
        driver_actor_id: 'actor-driver',
        intake_context: intakeContextByKind.bug,
      })
      .expect(400);
  });

  it('patches driver_actor_id and uses the driver for status history and audit events', async () => {
    const repository = app.get(DELIVERY_REPOSITORY) as InMemoryDeliveryRepository;
    const { workItem } = await createWorkItem('requirement');

    const updated = (
      await request(app.getHttpServer())
        .patch(`/work-items/${workItem.id}`)
        .send({ driver_actor_id: 'actor-driver-2', phase: 'triage' })
        .expect(200)
    ).body;

    expect(updated.driver_actor_id).toBe('actor-driver-2');
    expect(updated.phase).toBe('triage');
    expect(updated).not.toHaveProperty('owner_actor_id');
    await expect(repository.listStatusHistory(workItem.id, 'work_item')).resolves.toEqual([
      expect.objectContaining({
        object_type: 'work_item',
        object_id: workItem.id,
        from_status: 'draft/none',
        to_status: 'triage/none',
        actor_id: 'actor-driver-2',
      }),
    ]);
    await expect(repository.listObjectEvents(workItem.id, 'work_item')).resolves.toEqual([
      expect.objectContaining({ event_type: 'work_item_created', actor_id: 'actor-driver' }),
      expect.objectContaining({ event_type: 'work_item_updated', actor_id: 'actor-driver-2' }),
    ]);
  });

  it('patches intake_context for the matching Work Item kind', async () => {
    const { workItem } = await createWorkItem('bug');
    const intake_context = {
      ...intakeContextByKind.bug,
      impact_summary: 'Delivery status blocks release confidence.',
    };

    const updated = (
      await request(app.getHttpServer()).patch(`/work-items/${workItem.id}`).send({ intake_context }).expect(200)
    ).body;

    expect(updated.intake_context).toEqual(intake_context);
    expect(updated).not.toHaveProperty('owner_actor_id');
  });

  it('rejects owner_actor_id create and patch payloads', async () => {
    const project = await createProject();

    await request(app.getHttpServer())
      .post('/work-items')
      .send({
        project_id: project.id,
        kind: 'bug',
        title: 'Reject owner compatibility',
        goal: 'Use driver semantics only.',
        success_criteria: ['owner_actor_id is not accepted.'],
        priority: 'P0',
        risk: 'high',
        driver_actor_id: 'actor-driver',
        owner_actor_id: 'actor-owner',
        intake_context: intakeContextByKind.bug,
      })
      .expect(400);

    const { workItem } = await createWorkItem('bug');
    await request(app.getHttpServer())
      .patch(`/work-items/${workItem.id}`)
      .send({ owner_actor_id: 'actor-owner' })
      .expect(400);
  });

  it('rejects intake context when its type does not match kind', async () => {
    const project = await createProject();

    await request(app.getHttpServer())
      .post('/work-items')
      .send({
        project_id: project.id,
        kind: 'bug',
        title: 'Reject mismatched intake',
        goal: 'Keep typed intake coherent.',
        success_criteria: ['Bug cannot use requirement context.'],
        priority: 'P0',
        risk: 'high',
        driver_actor_id: 'actor-driver',
        intake_context: intakeContextByKind.requirement,
      })
      .expect(400);
  });

  it('rejects missing required intake context fields with field detail', async () => {
    const project = await createProject();
    const response = await request(app.getHttpServer())
      .post('/work-items')
      .send({
        project_id: project.id,
        kind: 'requirement',
        title: 'Reject incomplete intake',
        goal: 'Keep intake complete.',
        success_criteria: ['Missing context fields fail validation.'],
        priority: 'P1',
        risk: 'medium',
        driver_actor_id: 'actor-driver',
        intake_context: {
          ...intakeContextByKind.requirement,
          desired_outcome: undefined,
        },
      })
      .expect(400);

    expect(JSON.stringify(response.body)).toContain('desired_outcome');
  });

  it('rejects lifecycle phase updates and does not mutate the work item', async () => {
    const { workItem } = await createWorkItem();

    await request(app.getHttpServer()).patch(`/work-items/${workItem.id}`).send({ phase: 'execution' }).expect(400);

    const unchanged = (await request(app.getHttpServer()).get(`/work-items/${workItem.id}`).expect(200)).body;
    expect(unchanged.phase).toBe('draft');
  });

  it('allows readiness phase changes and records status history', async () => {
    const repository = app.get(DELIVERY_REPOSITORY) as InMemoryDeliveryRepository;
    const { workItem } = await createWorkItem();

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
        actor_id: 'actor-driver',
      }),
    ]);
  });

  it('rejects readiness phase changes after lifecycle has started', async () => {
    const repository = app.get(DELIVERY_REPOSITORY) as InMemoryDeliveryRepository;
    const { workItem } = await createWorkItem();
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
    const { workItem } = await createWorkItem();

    await request(app.getHttpServer()).patch(`/work-items/${workItem.id}`).send({}).expect(400);
    await request(app.getHttpServer())
      .patch(`/work-items/${workItem.id}`)
      .send({ goal: ' ', success_criteria: [' ', ''], driver_actor_id: ' ' })
      .expect(400);
  });
});
