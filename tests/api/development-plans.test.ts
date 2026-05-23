import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import type { DeliveryRepository } from '../../packages/db/src';

describe('Development Plans API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a Development Plan from a Requirement and manually adds a plan item', async () => {
    const { project, requirement } = await seedRequirement(app);
    const server = app.getHttpServer();
    const plan = (
      await request(server)
        .post('/development-plans')
        .send({
          project_id: project.id,
          source_ref: { type: 'requirement', id: requirement.id },
          title: 'Checkout development plan',
          actor_id: 'actor-product',
        })
        .expect(201)
    ).body;

    expect(plan).toMatchObject({
      project_id: project.id,
      source_refs: [{ type: 'requirement', id: requirement.id }],
      revision_id: expect.any(String),
    });

    const item = (
      await request(server)
        .post(`/development-plans/${plan.id}/items`)
        .send({
          title: 'Build checkout validation flow',
          summary: 'Implement validation and route tests.',
          responsible_role: 'tech_lead',
          driver_actor_id: 'actor-tech',
          reviewer_actor_id: 'actor-reviewer',
          risk: 'medium',
          dependency_hints: [],
          affected_surfaces: ['apps/web'],
          release_impact: 'release_scoped',
        })
        .expect(201)
    ).body;

    expect(item).toMatchObject({
      development_plan_id: plan.id,
      source_ref: { type: 'requirement', id: requirement.id },
      boundary_status: 'not_started',
      spec_status: 'missing',
      execution_plan_status: 'missing',
      execution_status: 'not_started',
      review_status: 'missing',
      qa_handoff_status: 'missing',
    });
    expect(item.revision_id).not.toBe(plan.revision_id);
    expect(JSON.stringify(item)).not.toContain('"type":"work_item"');
  });

  it('links an existing Development Plan from a source object without creating a duplicate', async () => {
    const { project, requirement, bug } = await seedRequirementAndBug(app);
    const server = app.getHttpServer();
    const plan = await createDevelopmentPlan(app, { project_id: project.id, source_ref: { type: 'requirement', id: requirement.id } });

    const link = (
      await request(server)
        .post(`/source-objects/bug/${bug.id}/development-plans/${plan.id}/link`)
        .send({ actor_id: 'actor-product', rationale: 'Bug belongs to the same checkout plan.' })
        .expect(201)
    ).body;

    expect(link).toMatchObject({
      source_ref: { type: 'bug', id: bug.id },
      development_plan_id: plan.id,
      link_type: 'related',
    });

    const duplicateLink = (
      await request(server)
        .post(`/source-objects/bug/${bug.id}/development-plans/${plan.id}/link`)
        .send({ actor_id: 'actor-product', rationale: 'Idempotent relationship.' })
        .expect(201)
    ).body;
    expect(duplicateLink.id).toBe(link.id);
    expect(JSON.stringify(link)).not.toContain('"type":"work_item"');
  });

  it('generates and regenerates a draft Development Plan with a context manifest and feedback', async () => {
    const { project, requirement } = await seedRequirement(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const generated = (
      await request(server)
        .post('/development-plans/generate-draft')
        .send({
          project_id: project.id,
          source_ref: { type: 'requirement', id: requirement.id },
          actor_id: 'actor-product',
          guidance: 'Split into a UI planning item and a validation item.',
        })
        .expect(201)
    ).body;

    expect(generated).toMatchObject({
      project_id: project.id,
      source_refs: [{ type: 'requirement', id: requirement.id }],
      generation_state: 'draft_generated',
      actor_guidance: 'Split into a UI planning item and a validation item.',
      context_manifest_id: expect.any(String),
      items: expect.arrayContaining([
        expect.objectContaining({
          development_plan_id: generated.id,
          boundary_status: 'not_started',
          spec_status: 'missing',
          execution_plan_status: 'missing',
          execution_status: 'not_started',
        }),
      ]),
    });
    for (const item of generated.items) {
      await expect(repository.listObjectEvents(item.id, 'development_plan_item')).resolves.toEqual([
        expect.objectContaining({ event_type: 'development_plan_item_created', actor_id: 'actor-product' }),
      ]);
    }

    const regenerated = (
      await request(server)
        .post(`/development-plans/${generated.id}/regenerate-draft`)
        .send({
          actor_id: 'actor-tech',
          feedback: 'Preserve the UI item, add a QA handoff item.',
          preserve_prior_decisions: true,
        })
        .expect(201)
    ).body;

    expect(regenerated.id).toBe(generated.id);
    expect(regenerated.revision_id).not.toBe(generated.revision_id);
    expect(regenerated.context_manifest_id).toEqual(expect.any(String));
    expect(regenerated.regeneration).toMatchObject({
      feedback: 'Preserve the UI item, add a QA handoff item.',
      preserve_prior_decisions: true,
    });
    expect(regenerated.items.length).toBeGreaterThan(generated.items.length);
    const regeneratedItem = regenerated.items.find((item: { title: string }) => item.title === 'QA handoff planning');
    expect(regeneratedItem).toBeDefined();
    await expect(repository.listObjectEvents(regeneratedItem.id, 'development_plan_item')).resolves.toEqual([
      expect.objectContaining({ event_type: 'development_plan_item_created', actor_id: 'actor-tech' }),
    ]);
  });

  it('rejects unsupported public source object types', async () => {
    const { project, requirement } = await seedRequirement(app);

    await request(app.getHttpServer())
      .post('/development-plans')
      .send({
        project_id: project.id,
        source_ref: { type: 'work_item', id: requirement.id },
        title: 'Legacy source ref plan',
        actor_id: 'actor-product',
      })
      .expect(400);
  });
});

async function seedRequirement(app: INestApplication) {
  const server = app.getHttpServer();
  const project = (await request(server).post('/projects').send({ name: 'Forgeloop', owner_actor_id: 'actor-product' }).expect(201))
    .body;
  const requirement = (
    await request(server)
      .post('/work-items')
      .send({
        project_id: project.id,
        kind: 'requirement',
        title: 'Checkout validation requirement',
        goal: 'Make checkout validation explicit before implementation.',
        success_criteria: ['Invalid checkout data is blocked.'],
        priority: 'P0',
        risk: 'medium',
        driver_actor_id: 'actor-product',
        intake_context: {
          type: 'requirement',
          stakeholder_problem: 'Checkout validation is under-specified.',
          desired_outcome: 'The team can plan and validate checkout changes.',
          acceptance_criteria: ['Validation behavior is covered by API and route tests.'],
          in_scope: ['Checkout validation'],
        },
      })
      .expect(201)
  ).body;

  return { project, requirement };
}

async function seedRequirementAndBug(app: INestApplication) {
  const seeded = await seedRequirement(app);
  const server = app.getHttpServer();
  const bug = (
    await request(server)
      .post('/work-items')
      .send({
        project_id: seeded.project.id,
        kind: 'bug',
        title: 'Checkout accepts invalid customer data',
        goal: 'Tie the regression to the same Development Plan.',
        success_criteria: ['The bug links to the existing Development Plan.'],
        priority: 'P1',
        risk: 'high',
        driver_actor_id: 'actor-product',
        intake_context: {
          type: 'bug',
          impact_summary: 'Invalid checkout records reach fulfillment.',
          observed_behavior: 'Bad customer data is accepted.',
          expected_behavior: 'Bad customer data is rejected.',
          reproduction_steps: ['Submit checkout with missing customer fields.'],
          affected_environment: 'control-plane API',
          verification_path: 'Development Plan API test',
        },
      })
      .expect(201)
  ).body;

  return { ...seeded, bug };
}

async function createDevelopmentPlan(
  app: INestApplication,
  overrides: Partial<{
    project_id: string;
    source_ref: { type: 'initiative' | 'requirement' | 'bug' | 'tech_debt'; id: string };
    title: string;
    actor_id: string;
  }>,
) {
  const seeded = overrides.project_id === undefined || overrides.source_ref === undefined ? await seedRequirement(app) : undefined;
  const projectId = overrides.project_id ?? seeded!.project.id;
  const sourceRef = overrides.source_ref ?? { type: 'requirement' as const, id: seeded!.requirement.id };
  return (
    await request(app.getHttpServer())
      .post('/development-plans')
      .send({
        project_id: projectId,
        source_ref: sourceRef,
        title: overrides.title ?? 'Checkout development plan',
        actor_id: overrides.actor_id ?? 'actor-product',
      })
      .expect(201)
  ).body;
}
