import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';

const expectedQuestions = [
  'Which repos, modules, and product surfaces are in scope?',
  'What is explicitly out of scope for this Development Plan Item?',
  'Which acceptance criteria and validation commands must pass?',
  'What risks or dependency constraints should block generation?',
];

describe('Boundary Brainstorming API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('persists questions, answers, decisions, and approved boundary summary before Spec generation', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();
    const session = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/brainstorming-sessions`)
        .send({ actor_id: 'actor-tech' })
        .expect(201)
    ).body;

    expect(session).toMatchObject({
      development_plan_id: plan.id,
      development_plan_item_id: item.id,
      development_plan_item_revision_id: item.revision_id,
      approval_state: 'questions_open',
    });
    expect(session.questions.map((question: { text: string }) => question.text)).toEqual(expectedQuestions);

    await request(server)
      .post(`/brainstorming-sessions/${session.id}/approve-boundary`)
      .send({
        confirmed_scope: ['Web IA and Development Plan Item gate UX'],
        confirmed_out_of_scope: ['Runtime scheduler changes'],
        accepted_assumptions: ['Mock Codex question generation is sufficient for this slice'],
        open_risks: ['Execution queue depends on existing runtime adapters'],
        validation_expectations: ['Route tests and screenshot checks pass'],
        actor_id: 'actor-tech',
        final_decision: 'Approve the boundary.',
      })
      .expect(409);

    for (const question of session.questions) {
      await request(server)
        .post(`/brainstorming-sessions/${session.id}/answers`)
        .send({
          question_id: question.id,
          text: `Answered boundary question: ${question.text}`,
          actor_id: 'actor-tech',
        })
        .expect(201);
    }

    await request(server)
      .post(`/brainstorming-sessions/${session.id}/approve-boundary`)
      .send({
        confirmed_scope: ['Web IA and Development Plan Item gate UX'],
        confirmed_out_of_scope: ['Runtime scheduler changes'],
        accepted_assumptions: ['Mock Codex question generation is sufficient for this slice'],
        open_risks: ['Execution queue depends on existing runtime adapters'],
        validation_expectations: ['Route tests and screenshot checks pass'],
        actor_id: 'actor-tech',
        final_decision: 'Approve the boundary.',
      })
      .expect(409);

    await request(server)
      .post(`/brainstorming-sessions/${session.id}/decisions`)
      .send({
        text: 'Keep implementation scoped to Web IA and route tests.',
        rationale: 'The item is a UI planning slice.',
        actor_id: 'actor-tech',
      })
      .expect(201);

    const approved = (
      await request(server)
        .post(`/brainstorming-sessions/${session.id}/approve-boundary`)
        .send({
          confirmed_scope: ['Web IA and Development Plan Item gate UX'],
          confirmed_out_of_scope: ['Runtime scheduler changes'],
          accepted_assumptions: ['Mock Codex question generation is sufficient for this slice'],
          open_risks: ['Execution queue depends on existing runtime adapters'],
          validation_expectations: ['Route tests and screenshot checks pass'],
          actor_id: 'actor-tech',
          final_decision: 'Approve after all questions and one prior decision.',
        })
        .expect(201)
    ).body;

    expect(approved).toMatchObject({
      approval_state: 'approved',
      boundary_summary_id: expect.any(String),
      development_plan_item_revision_id: expect.any(String),
    });
    expect(approved.development_plan_item_revision_id).not.toBe(item.revision_id);

    const itemRevisions = (
      await request(server)
        .get(`/development-plans/${plan.id}/items/${item.id}/revisions`)
        .expect(200)
    ).body;
    expect(itemRevisions).toHaveLength(2);

    const itemDiff = (
      await request(server)
        .get(`/development-plans/${plan.id}/items/${item.id}/revisions/compare`)
        .query({
          base_revision_id: itemRevisions[0].id,
          compare_revision_id: itemRevisions[1].id,
        })
        .expect(200)
    ).body;
    expect(itemDiff).toMatchObject({
      base_revision_id: itemRevisions[0].id,
      compare_revision_id: itemRevisions[1].id,
      changed_fields: expect.arrayContaining(['snapshot']),
    });

    const boundaryRevisions = (
      await request(server)
        .get(`/boundary-summaries/${approved.boundary_summary_id}/revisions`)
        .expect(200)
    ).body;
    expect(boundaryRevisions).toHaveLength(1);
    expect(boundaryRevisions[0]).toMatchObject({
      boundary_summary_id: approved.boundary_summary_id,
      brainstorming_session_id: session.id,
      decision_count: 2,
      approved_by_actor_id: 'actor-tech',
    });

    const boundaryDiff = (
      await request(server)
        .get(`/boundary-summaries/${approved.boundary_summary_id}/revisions/compare`)
        .query({
          base_revision_id: boundaryRevisions[0].id,
          compare_revision_id: boundaryRevisions[0].id,
        })
        .expect(200)
    ).body;
    expect(boundaryDiff).toMatchObject({
      base_revision_id: boundaryRevisions[0].id,
      compare_revision_id: boundaryRevisions[0].id,
      changed_fields: [],
    });
    expect(JSON.stringify(approved)).not.toContain('"type":"work_item"');
  });
});

async function seedDevelopmentPlanItem(app: INestApplication) {
  const { project, requirement } = await seedRequirement(app);
  const plan = await createDevelopmentPlan(app, {
    project_id: project.id,
    source_ref: { type: 'requirement', id: requirement.id },
  });
  const item = (
    await request(app.getHttpServer())
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

  return { project, requirement, plan, item };
}

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

async function createDevelopmentPlan(
  app: INestApplication,
  input: {
    project_id: string;
    source_ref: { type: 'initiative' | 'requirement' | 'bug' | 'tech_debt'; id: string };
  },
) {
  return (
    await request(app.getHttpServer())
      .post('/development-plans')
      .send({
        project_id: input.project_id,
        source_ref: input.source_ref,
        title: 'Checkout development plan',
        actor_id: 'actor-product',
      })
      .expect(201)
  ).body;
}
