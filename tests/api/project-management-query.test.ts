import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import {
  executionActorDeveloper,
  executionActorOwner,
  executionActorQa,
  executionActorReviewer,
  reviewerHeaders,
  seedApprovedExecutionPlan,
  seedCompletedExecution,
} from '../helpers/execution-supervision-fixtures';

const reportIds = [
  'development-plan-throughput',
  'brainstorming-bottlenecks',
  'spec-review-aging',
  'execution-plan-review-aging',
  'execution-continuation',
  'execution-outcomes',
  'code-review',
  'qa-handoff-readiness',
  'release-readiness',
  'quality-bug-escape',
] as const;

describe('project management query API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists My Work using source objects and Development Plan Items, not generic Tasks', async () => {
    const { developmentPlan, item } = await seedApprovedExecutionPlan(app);

    const response = await request(app.getHttpServer())
      .get('/query/my-work')
      .query({ project_id: developmentPlan.project_id, actor_id: executionActorOwner })
      .expect(200);

    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object_ref: expect.objectContaining({
            type: 'development_plan',
            id: developmentPlan.id,
          }),
          href: `/development-plans/${developmentPlan.id}`,
        }),
        expect.objectContaining({
          object_ref: expect.objectContaining({
            type: 'development_plan_item',
            id: item.id,
            development_plan_id: item.development_plan_id,
          }),
          href: `/development-plans/${item.development_plan_id}/items/${item.id}`,
        }),
        expect.objectContaining({
          object_ref: expect.objectContaining({
            type: 'spec',
          }),
          href: `/development-plans/${item.development_plan_id}/items/${item.id}`,
        }),
        expect.objectContaining({
          object_ref: expect.objectContaining({
            type: 'execution_plan',
          }),
          href: `/development-plans/${item.development_plan_id}/items/${item.id}`,
        }),
      ]),
    );
    expect(JSON.stringify(response.body)).not.toContain('"type":"task"');
    expect(JSON.stringify(response.body)).not.toContain('"type":"work_item"');
    expect(JSON.stringify(response.body)).not.toContain('owner_actor_id');
  });

  it('projects source object details through relationships, not legacy Task or direct Plan refs', async () => {
    const { developmentPlan, item, workItem } = await seedApprovedExecutionPlan(app);

    const response = await request(app.getHttpServer()).get(`/query/requirements/${workItem.id}`).expect(200);

    expect(response.body.relationship_refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'development_plan', id: developmentPlan.id }),
        expect.objectContaining({ type: 'development_plan_item', id: item.id, development_plan_id: developmentPlan.id }),
      ]),
    );
    expect(response.body).not.toHaveProperty('task_refs');
    expect(response.body).not.toHaveProperty('plan_ref');
    expect(JSON.stringify(response.body)).not.toContain('"type":"task"');
    expect(JSON.stringify(response.body)).not.toContain('"type":"work_item"');
  });

  it('does not expose old product registry query route families', async () => {
    const server = app.getHttpServer();

    for (const route of ['/query/work-items', '/query/specs', '/query/plans', '/query/execution-packages', '/query/runs', '/query/review-packets']) {
      await request(server).get(route).query({ project_id: 'project-1' }).expect(404);
    }
  });

  it('projects AI-native planning, artifact, execution, review, QA, dashboard, board, and report queues', async () => {
    const { developmentPlan, item, workItem, specRevision, executionPlanRevision, execution, review, qa } = await seedExecutionReviewAndQa(app);
    const server = app.getHttpServer();
    const query = { project_id: developmentPlan.project_id };

    const dashboard = await request(server).get('/query/dashboard').query(query).expect(200);
    expect(dashboard.body).toMatchObject({
      sections: expect.arrayContaining([
        expect.objectContaining({ id: 'flow-health' }),
        expect.objectContaining({ id: 'blocked-work' }),
        expect.objectContaining({ id: 'aging' }),
        expect.objectContaining({ id: 'role-load' }),
        expect.objectContaining({ id: 'release-confidence' }),
      ]),
    });

    const developmentPlans = await request(server).get('/query/development-plans').query(query).expect(200);
    expect(developmentPlans.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object_ref: expect.objectContaining({ type: 'development_plan', id: developmentPlan.id }),
          item_count: 1,
          responsible_role: item.responsible_role,
          responsible_roles: [item.responsible_role],
          gate_state: 'execution',
          gate_states: ['execution'],
          risk: item.risk,
          risks: [item.risk],
          href: `/development-plans/${developmentPlan.id}`,
        }),
      ]),
    );

    const developmentPlanDetail = await request(server).get(`/query/development-plans/${developmentPlan.id}`).expect(200);
    expect(developmentPlanDetail.body).toMatchObject({
      object_ref: expect.objectContaining({ type: 'development_plan', id: developmentPlan.id }),
      source_refs: [expect.objectContaining({ type: workItem.kind, id: workItem.id })],
      items: [expect.objectContaining({ object_ref: expect.objectContaining({ type: 'development_plan_item', id: item.id }) })],
    });

    const itemDetail = await request(server).get(`/query/development-plans/${developmentPlan.id}/items/${item.id}`).expect(200);
    expect(itemDetail.body).toMatchObject({
      object_ref: expect.objectContaining({ type: 'development_plan_item', id: item.id, development_plan_id: developmentPlan.id }),
      source_ref: { type: workItem.kind, id: workItem.id },
      revisions: expect.arrayContaining([expect.objectContaining({ id: item.revision_id })]),
      boundary_summary_revisions: expect.arrayContaining([expect.objectContaining({ development_plan_item_id: item.id })]),
      specs: expect.arrayContaining([
        expect.objectContaining({
          current_revision_id: specRevision.id,
          approved_revision_id: specRevision.id,
        }),
      ]),
      execution_plans: expect.arrayContaining([
        expect.objectContaining({
          current_revision_id: executionPlanRevision.id,
          approved_revision_id: executionPlanRevision.id,
        }),
      ]),
      executions: expect.arrayContaining([
        expect.objectContaining({
          id: execution.id,
          status: 'qa_handoff_pending',
        }),
      ]),
      code_review_handoffs: expect.arrayContaining([
        expect.objectContaining({
          id: review.id,
          status: 'approved',
        }),
      ]),
      compare_links: expect.objectContaining({
        item_revisions_href: `/development-plans/${developmentPlan.id}/items/${item.id}/revisions/compare`,
      }),
    });

    const specsAndExecutionPlans = await request(server).get('/query/specs-execution-plans').query(query).expect(200);
    expect(specsAndExecutionPlans.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ artifact_type: 'spec', development_plan_item_ref: expect.objectContaining({ id: item.id }) }),
        expect.objectContaining({
          artifact_type: 'execution_plan',
          development_plan_item_ref: expect.objectContaining({ id: item.id }),
        }),
      ]),
    );

    const executions = await request(server).get('/query/executions').query(query).expect(200);
    expect(executions.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object_ref: expect.objectContaining({ type: 'execution', id: execution.id }),
          development_plan_item_ref: expect.objectContaining({ id: item.id }),
          execution_plan_revision_ref: expect.objectContaining({ id: execution.execution_plan_revision_id }),
          last_event_at: expect.any(String),
          actions: expect.arrayContaining([expect.objectContaining({ id: 'inspect' })]),
        }),
      ]),
    );

    const reviews = await request(server).get('/query/code-review-handoffs').query(query).expect(200);
    expect(reviews.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object_ref: expect.objectContaining({ type: 'code_review_handoff', id: review.id }),
          execution_ref: expect.objectContaining({ type: 'execution', id: execution.id }),
          qa_handoff_available: false,
          href: `/executions/${execution.id}`,
        }),
      ]),
    );
    const executionScopedReviews = await request(server).get('/query/code-review-handoffs').query({ ...query, execution_id: execution.id }).expect(200);
    expect(executionScopedReviews.body.items).toEqual([
      expect.objectContaining({ id: review.id, href: `/executions/${execution.id}` }),
    ]);

    const qaHandoffs = await request(server).get('/query/qa-handoffs').query(query).expect(200);
    const projectedQaHandoff = qaHandoffs.body.items.find((handoff: { id: string }) => handoff.id === qa.id);
    expect(qaHandoffs.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object_ref: expect.objectContaining({ type: 'qa_handoff', id: qa.id }),
          source_ref: expect.objectContaining({ type: workItem.kind, id: workItem.id }),
          development_plan_item_ref: expect.objectContaining({ id: item.id }),
          href: `/executions/${execution.id}`,
          status: 'blocked',
        }),
      ]),
    );
    expect(projectedQaHandoff.actions).toEqual([
      {
        id: 'accept',
        href: `/executions/${execution.id}`,
        label: 'Accept',
        command: { type: 'accept_qa_handoff', qa_handoff_id: qa.id },
      },
      { id: 'inspect', href: `/executions/${execution.id}`, label: 'Inspect' },
    ]);
    expect(JSON.stringify(projectedQaHandoff.actions)).not.toMatch(/block_qa_handoff/);
    const executionScopedQaHandoffs = await request(server).get('/query/qa-handoffs').query({ ...query, execution_id: execution.id }).expect(200);
    expect(executionScopedQaHandoffs.body.items).toEqual([
      expect.objectContaining({ id: qa.id, href: `/executions/${execution.id}` }),
    ]);

    const qaMyWork = await request(server)
      .get('/query/my-work')
      .query({ ...query, actor_id: executionActorOwner })
      .expect(200);
    expect(qaMyWork.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object_ref: expect.objectContaining({ type: 'qa_handoff', id: qa.id }),
          href: `/executions/${execution.id}`,
        }),
      ]),
    );

    const board = await request(server).get('/query/board').query(query).expect(200);
    expect(board.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ object_ref: expect.objectContaining({ type: workItem.kind, id: workItem.id }) }),
        expect.objectContaining({
          object_ref: expect.objectContaining({ type: 'development_plan_item', id: item.id, development_plan_id: item.development_plan_id }),
        }),
      ]),
    );

    for (const reportId of reportIds) {
      const report = await request(server).get(`/query/reports/${reportId}`).query(query).expect(200);
      expect(report.body).toMatchObject({
        id: reportId,
        project_id: developmentPlan.project_id,
        groups: expect.any(Array),
      });
      expect(report.body.groups.length).toBeGreaterThan(0);
    }

    const executionContinuationReport = await request(server)
      .get('/query/reports/execution-continuation')
      .query(query)
      .expect(200);
    expect(executionContinuationReport.body.groups).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'interrupted_or_resumable' })]),
    );

    const executionOutcomesReport = await request(server).get('/query/reports/execution-outcomes').query(query).expect(200);
    expect(executionOutcomesReport.body.groups).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'succeeded' }), expect.objectContaining({ id: 'failed' })]),
    );

    const qualityReport = await request(server).get('/query/reports/quality-bug-escape').query(query).expect(200);
    expect(qualityReport.body.groups).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'escaped_bugs' }), expect.objectContaining({ id: 'qa_blockers' })]),
    );

    expect(JSON.stringify({ dashboard: dashboard.body, board: board.body, qa: qaHandoffs.body })).not.toContain('"type":"task"');
    expect(JSON.stringify({ dashboard: dashboard.body, board: board.body, qa: qaHandoffs.body })).not.toContain('"type":"work_item"');
  });
});

async function seedExecutionReviewAndQa(app: INestApplication) {
  const seeded = await seedCompletedExecution(app);
  const server = app.getHttpServer();

  const review = (
    await request(server)
      .post(`/executions/${seeded.execution.id}/ready-for-code-review`)
      .send({
        actor_id: executionActorDeveloper,
        summary: 'Diff is ready for review.',
        changed_surfaces: ['apps/web/src/features/development-plans'],
        verification_evidence_refs: [{ type: 'execution', id: seeded.execution.id }],
      })
      .expect(201)
  ).body;

  await request(server)
    .post(`/code-review-handoffs/${review.id}/approve`)
    .set(reviewerHeaders)
    .send({ actor_id: executionActorReviewer, rationale: 'Code review passed.' })
    .expect(201);

  const qa = (
    await request(server)
      .post(`/code-review-handoffs/${review.id}/qa-handoff`)
      .send({
        actor_id: executionActorReviewer,
        acceptance_criteria: ['Development Plan Item gate flow works'],
        test_strategy: 'Route tests plus visual checks',
        known_risks: ['Runtime adapter is still mocked locally'],
      })
      .expect(201)
  ).body;

  await request(server)
    .post(`/qa-handoffs/${qa.id}/block`)
    .send({ actor_id: executionActorQa, rationale: 'Acceptance evidence is incomplete.' })
    .expect(201);

  return { ...seeded, review, qa: { ...qa, status: 'blocked' } };
}
