import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { DeliveryRepository } from '@forgeloop/db';
import { bugDetailSchema, initiativeDetailSchema, requirementDetailSchema, techDebtDetailSchema } from '@forgeloop/contracts';
import type { Attachment, DevelopmentPlan, DevelopmentPlanItem, Release, ReleaseEvidence, WorkItem } from '@forgeloop/domain';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { seedProductWorkspacePreviewRepository } from '../../apps/control-plane-api/src/modules/core/product-workspace-preview-seed';
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
    expect(response.body.relationship_refs).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'spec' }),
        expect.objectContaining({ type: 'execution_plan' }),
      ]),
    );
    expect(response.body).not.toHaveProperty('task_refs');
    expect(response.body).not.toHaveProperty('plan_ref');
    expect(JSON.stringify(response.body)).not.toContain('"type":"task"');
    expect(JSON.stringify(response.body)).not.toContain('"type":"work_item"');
  });

  it('projects typed Requirement list and detail fields from stored planning, release, evidence, and attachment data', async () => {
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await seedTypedRequirementProjection(repository);
    const server = app.getHttpServer();

    const listResponse = await request(server).get('/query/requirements').query({ project_id: 'project-typed-source' }).expect(200);
    expect(listResponse.body.items).toEqual([
      expect.objectContaining({
        id: 'req-checkout-risk',
        ref: { type: 'requirement', id: 'req-checkout-risk', title: 'Checkout risk controls' },
        title: 'Checkout risk controls',
        status: 'triage',
        priority: 'high',
        risk: 'high',
        driver_actor_id: 'actor-product',
        planning_coverage: { development_plan_count: 1, plan_item_count: 3, uncovered: false },
        downstream_gate_summary: {
          current_gate_counts: { boundary: 1, spec: 1, execution_plan: 1, execution: 0, code_review: 0, qa: 0, release: 0 },
          blocker_count: 1,
        },
        last_meaningful_update_at: '2026-05-27T08:45:00.000Z',
        next_action: 'Review Spec test strategy',
        release_refs: [{ type: 'release', id: 'rel-preview', title: 'Preview release' }],
        updated_at: '2026-05-27T08:00:00.000Z',
      }),
    ]);

    const detailResponse = await request(server).get('/query/requirements/req-checkout-risk').expect(200);
    expect(() => requirementDetailSchema.parse(detailResponse.body)).not.toThrow();
    expect(detailResponse.body).toMatchObject({
      id: 'req-checkout-risk',
      ref: { type: 'requirement', id: 'req-checkout-risk', title: 'Checkout risk controls' },
      stakeholder_problem: 'Product needs confidence that risky checkout changes are reviewed before release.',
      desired_outcome: 'Every release-impacting checkout change carries approved Spec, plan, QA, and release evidence.',
      acceptance_criteria_summary: 'Risky paths have approved test strategy and QA handoff before release readiness clears.',
      scope_summary: {
        in_scope: 'Checkout requirements, delivery plan links, QA evidence, release blockers',
        out_of_scope: 'External Jira sync, retro learning loop',
      },
      linked_development_plans: [{ type: 'development_plan', id: 'dp-core', title: 'Core redesign plan' }],
      linked_plan_items: expect.arrayContaining([
        expect.objectContaining({ type: 'development_plan_item', id: 'dpi-boundary', development_plan_id: 'dp-core', title: 'Confirm checkout boundary' }),
        expect.objectContaining({ type: 'development_plan_item', id: 'dpi-spec', development_plan_id: 'dp-core', title: 'Review Spec test strategy' }),
        expect.objectContaining({ type: 'development_plan_item', id: 'dpi-plan', development_plan_id: 'dp-core', title: 'Approve checkout execution plan' }),
      ]),
      evidence_refs: [{ type: 'attachment', id: 'att-1', title: 'Research screenshot' }],
      attachment_refs: [
        expect.objectContaining({
          id: 'att-1',
          owner_object_type: 'requirement',
          owner_object_id: 'req-checkout-risk',
          filename: 'scope.png',
          evidence_category: 'image',
          linked_object_refs: [{ type: 'requirement', id: 'req-checkout-risk', title: 'Checkout risk controls' }],
        }),
      ],
      audit: { created_at: '2026-05-27T08:00:00.000Z', updated_at: '2026-05-27T08:00:00.000Z', updated_by_actor_id: 'actor-product' },
      last_meaningful_update_at: '2026-05-27T08:45:00.000Z',
      next_action: 'Review Spec test strategy',
      release_refs: [{ type: 'release', id: 'rel-preview', title: 'Preview release' }],
    });
    expect(JSON.stringify(detailResponse.body)).not.toContain('storage_uri');
    expect(JSON.stringify(detailResponse.body.attachment_refs)).not.toMatch(/\"type\":\"spec\"|\"type\":\"execution_plan\"|\"type\":\"execution\"/);
    expect(JSON.stringify({ list: listResponse.body, detail: detailResponse.body })).not.toMatch(/unavailable|source object|owner_actor_id/);

    await repository.saveReleaseEvidence({
      id: 'evidence-scope-only',
      org_id: 'org-typed-source',
      project_id: 'project-typed-source',
      release_id: 'rel-preview',
      title: 'Scope-only Plan Item evidence',
      evidence_type: 'observation_note',
      summary: 'Scope-only Plan Item evidence',
      extra: {
        scope_ref: {
          type: 'development_plan_item',
          id: 'dpi-spec',
          development_plan_id: 'dp-core',
          title: 'Review Spec test strategy',
        },
      },
      redacted: false,
      status: 'current',
      created_at: '2026-05-27T08:46:00.000Z',
      created_by_actor_id: 'actor-product',
    });
    const scopeOnlyDetailResponse = await request(server).get('/query/requirements/req-checkout-risk').expect(200);
    expect(scopeOnlyDetailResponse.body.evidence_refs).toEqual(
      expect.arrayContaining([
        {
          type: 'release_evidence',
          id: 'evidence-scope-only',
          release_id: 'rel-preview',
          title: 'Scope-only Plan Item evidence',
        },
      ]),
    );
    expect(scopeOnlyDetailResponse.body.evidence_refs).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'attachment', id: 'evidence-scope-only' }),
      ]),
    );
  });

  it('applies typed source list filters instead of silently ignoring them', async () => {
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await seedTypedRequirementProjection(repository);
    await repository.saveWorkItem({
      id: 'req-low-risk-followup',
      project_id: 'project-typed-source',
      kind: 'requirement',
      title: 'Low risk follow-up',
      narrative_markdown: 'Low risk follow-up narrative.',
      goal: 'Keep low-risk cleanup separate.',
      success_criteria: ['Low-risk cleanup remains separately filterable.'],
      priority: 'low',
      risk: 'low',
      driver_actor_id: 'actor-secondary',
      intake_context: {
        type: 'requirement',
        stakeholder_problem: 'Secondary cleanup needs separate ownership.',
        desired_outcome: 'Secondary cleanup does not appear in primary driver filters.',
        acceptance_criteria: ['Filtering by driver, risk, and status excludes this row.'],
        in_scope: ['Secondary cleanup'],
        out_of_scope: ['Checkout risk controls'],
      },
      phase: 'draft',
      activity_state: 'idle',
      gate_state: 'none',
      resolution: 'none',
      created_at: '2026-05-27T09:00:00.000Z',
      updated_at: '2026-05-27T09:00:00.000Z',
    });
    const server = app.getHttpServer();

    const byDriver = await request(server)
      .get('/query/requirements')
      .query({ project_id: 'project-typed-source', driver_actor_id: 'actor-product' })
      .expect(200);
    expect(byDriver.body.items.map((item: { id: string }) => item.id)).toEqual(['req-checkout-risk']);

    const byRisk = await request(server)
      .get('/query/requirements')
      .query({ project_id: 'project-typed-source', risk: 'low' })
      .expect(200);
    expect(byRisk.body.items.map((item: { id: string }) => item.id)).toEqual(['req-low-risk-followup']);

    const byStatus = await request(server)
      .get('/query/requirements')
      .query({ project_id: 'project-typed-source', status: 'triage' })
      .expect(200);
    expect(byStatus.body.items.map((item: { id: string }) => item.id)).toEqual(['req-checkout-risk']);
  });

  it('strictly projects all product workspace preview typed source detail routes', async () => {
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await seedProductWorkspacePreviewRepository(repository);
    const server = app.getHttpServer();

    const requirement = await request(server).get('/query/requirements/req-product-workspace-clarity').expect(200);
    expect(() => requirementDetailSchema.parse(requirement.body)).not.toThrow();

    const initiative = await request(server).get('/query/initiatives/init-product-workspace-redesign').expect(200);
    expect(() => initiativeDetailSchema.parse(initiative.body)).not.toThrow();

    const techDebt = await request(server).get('/query/tech-debt/td-retire-generic-product-page').expect(200);
    expect(() => techDebtDetailSchema.parse(techDebt.body)).not.toThrow();

    const bug = await request(server).get('/query/bugs/bug-plan-item-action-eligibility').expect(200);
    expect(() => bugDetailSchema.parse(bug.body)).not.toThrow();

    expect(JSON.stringify({ requirement: requirement.body, initiative: initiative.body, techDebt: techDebt.body, bug: bug.body })).not.toMatch(
      /storage_uri|\"type\":\"spec\"|\"type\":\"execution_plan\"/,
    );
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
        expect.objectContaining({
          object_ref: expect.objectContaining({ type: 'execution', id: execution.id }),
          href: `/executions/${execution.id}`,
        }),
        expect.objectContaining({
          object_ref: expect.objectContaining({ type: 'code_review_handoff', id: review.id }),
          column_id: 'review',
          href: `/executions/${execution.id}`,
        }),
        expect.objectContaining({
          object_ref: expect.objectContaining({ type: 'qa_handoff', id: qa.id }),
          column_id: 'qa',
          href: `/executions/${execution.id}`,
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

    const throughputReport = await request(server).get('/query/reports/development-plan-throughput').query(query).expect(200);
    expect(throughputReport.body.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'draft_or_active',
          items: expect.arrayContaining([expect.objectContaining({ type: 'development_plan_item' })]),
        }),
      ]),
    );

    const executionOutcomesReport = await request(server).get('/query/reports/execution-outcomes').query(query).expect(200);
    expect(executionOutcomesReport.body.groups).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'succeeded' }), expect.objectContaining({ id: 'failed' })]),
    );

    const qualityReport = await request(server).get('/query/reports/quality-bug-escape').query(query).expect(200);
    expect(qualityReport.body.groups).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'escaped_bugs' }), expect.objectContaining({ id: 'qa_blockers' })]),
    );
    expect(qualityReport.body.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'qa_blockers',
          items: expect.arrayContaining([expect.objectContaining({ type: 'qa_handoff' })]),
        }),
      ]),
    );

    expect(JSON.stringify({ dashboard: dashboard.body, board: board.body, qa: qaHandoffs.body })).not.toContain('"type":"task"');
    expect(JSON.stringify({ dashboard: dashboard.body, board: board.body, qa: qaHandoffs.body })).not.toContain('"type":"work_item"');
  });

  it('preserves real execution supervision fields while keeping blocked resumable rows non-continuable', async () => {
    const { developmentPlan, item } = await seedApprovedExecutionPlan(app);
    const server = app.getHttpServer();
    const started = (
      await request(server)
        .post(`/development-plans/${developmentPlan.id}/items/${item.id}/execution/start`)
        .send({ actor_id: executionActorDeveloper })
        .expect(201)
    ).body;
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const interruptedAt = '2026-05-24T00:00:00.000Z';
    const continuedAt = '2026-05-24T00:01:00.000Z';
    await repository.saveExecution({
      ...started,
      status: 'paused',
      worker_state: 'resumable-worker',
      current_step: 'Waiting for approval evidence',
      blocked: true,
      stale: true,
      last_event_at: continuedAt,
      last_event_summary: 'Custom checkpoint recorded by actor-reviewer.',
      interrupt_history: [{ at: interruptedAt, reason: 'Execution interrupted by actor-owner.' }],
      continuation_history: [{ at: continuedAt, summary: 'Execution continued by actor-reviewer.' }],
      updated_at: continuedAt,
    });

    const executions = await request(server).get('/query/executions').query({ project_id: developmentPlan.project_id }).expect(200);
    const projectedExecution = executions.body.items.find((row: { id: string }) => row.id === started.id);

    expect(projectedExecution).toMatchObject({
      id: started.id,
      status: 'paused',
      worker_state: 'resumable-worker',
      current_step: 'Waiting for approval evidence',
      stale: true,
      blocked: true,
      last_event_at: continuedAt,
      last_event_summary: 'Custom checkpoint recorded by assigned operator.',
      actions: [{ id: 'inspect', href: `/executions/${started.id}`, label: 'Inspect' }],
    });
    expect(JSON.stringify(projectedExecution)).not.toMatch(/actor-owner|actor-reviewer/);
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

async function seedTypedRequirementProjection(repository: DeliveryRepository) {
  const requirement: WorkItem = {
    id: 'req-checkout-risk',
    project_id: 'project-typed-source',
    kind: 'requirement',
    title: 'Checkout risk controls',
    narrative_markdown: 'Checkout risk controls narrative.',
    goal: 'Reduce checkout release risk.',
    success_criteria: ['Risky paths have approved test strategy and QA handoff before release readiness clears.'],
    priority: 'high',
    risk: 'high',
    driver_actor_id: 'actor-product',
    intake_context: {
      type: 'requirement',
      stakeholder_problem: 'Product needs confidence that risky checkout changes are reviewed before release.',
      desired_outcome: 'Every release-impacting checkout change carries approved Spec, plan, QA, and release evidence.',
      acceptance_criteria: ['Risky paths have approved test strategy and QA handoff before release readiness clears.'],
      in_scope: ['Checkout requirements', 'delivery plan links', 'QA evidence', 'release blockers'],
      out_of_scope: ['External Jira sync', 'retro learning loop'],
    },
    phase: 'triage',
    activity_state: 'idle',
    gate_state: 'none',
    resolution: 'none',
    current_release_id: 'rel-preview',
    created_at: '2026-05-27T08:00:00.000Z',
    updated_at: '2026-05-27T08:00:00.000Z',
  };
  const sourceRef = { type: 'requirement' as const, id: requirement.id, title: requirement.title };
  const developmentPlan: DevelopmentPlan = {
    id: 'dp-core',
    revision_id: 'dp-core-rev-1',
    project_id: requirement.project_id,
    title: 'Core redesign plan',
    status: 'active',
    source_refs: [sourceRef],
    items: [],
    created_at: '2026-05-27T08:05:00.000Z',
    updated_at: '2026-05-27T08:05:00.000Z',
  };
  const items: DevelopmentPlanItem[] = [
    {
      id: 'dpi-boundary',
      revision_id: 'dpi-boundary-rev-1',
      development_plan_id: developmentPlan.id,
      source_ref: sourceRef,
      title: 'Confirm checkout boundary',
      summary: 'Confirm checkout scope.',
      responsible_role: 'product',
      driver_actor_id: 'actor-product',
      reviewer_actor_id: 'actor-tech',
      risk: 'high',
      dependency_hints: [],
      affected_surfaces: ['checkout'],
      boundary_status: 'not_started',
      spec_status: 'missing',
      execution_plan_status: 'missing',
      execution_status: 'not_started',
      review_status: 'missing',
      qa_handoff_status: 'missing',
      release_impact: 'release_scoped',
      next_action: 'Clarify checkout boundary',
      created_at: '2026-05-27T08:10:00.000Z',
      updated_at: '2026-05-27T08:10:00.000Z',
    },
    {
      id: 'dpi-spec',
      revision_id: 'dpi-spec-rev-1',
      development_plan_id: developmentPlan.id,
      source_ref: sourceRef,
      title: 'Review Spec test strategy',
      summary: 'Review checkout Spec test strategy.',
      responsible_role: 'tech_lead',
      driver_actor_id: 'actor-product',
      reviewer_actor_id: 'actor-tech',
      risk: 'high',
      dependency_hints: [],
      affected_surfaces: ['checkout'],
      boundary_status: 'approved',
      spec_status: 'blocked',
      execution_plan_status: 'missing',
      execution_status: 'not_started',
      review_status: 'missing',
      qa_handoff_status: 'missing',
      release_impact: 'release_blocking',
      next_action: 'Review Spec test strategy',
      created_at: '2026-05-27T08:30:00.000Z',
      updated_at: '2026-05-27T08:30:00.000Z',
    },
    {
      id: 'dpi-plan',
      revision_id: 'dpi-plan-rev-1',
      development_plan_id: developmentPlan.id,
      source_ref: sourceRef,
      title: 'Approve checkout execution plan',
      summary: 'Approve checkout execution plan.',
      responsible_role: 'tech_lead',
      driver_actor_id: 'actor-product',
      reviewer_actor_id: 'actor-tech',
      risk: 'medium',
      dependency_hints: [],
      affected_surfaces: ['checkout'],
      boundary_status: 'approved',
      spec_status: 'approved',
      execution_plan_status: 'in_review',
      execution_status: 'not_started',
      review_status: 'missing',
      qa_handoff_status: 'missing',
      release_impact: 'release_scoped',
      next_action: 'Approve checkout execution plan',
      created_at: '2026-05-27T08:20:00.000Z',
      updated_at: '2026-05-27T08:20:00.000Z',
    },
  ];
  const release: Release = {
    id: 'rel-preview',
    org_id: 'org-typed-source',
    project_id: requirement.project_id,
    title: 'Preview release',
    phase: 'planning',
    activity_state: 'idle',
    gate_state: 'not_started',
    resolution: 'none',
    work_item_ids: [requirement.id],
    execution_package_ids: [],
    extra: { project_management_scope_refs: [sourceRef, { type: 'development_plan_item', id: 'dpi-spec', development_plan_id: 'dp-core' }] },
    created_by_actor_id: 'actor-release',
    created_at: '2026-05-27T08:40:00.000Z',
    updated_at: '2026-05-27T08:40:00.000Z',
  };
  const attachment: Attachment = {
    id: 'att-1',
    owner_object_type: 'requirement',
    owner_object_id: requirement.id,
    linked_object_refs: [sourceRef, { type: 'spec', id: 'spec-direct-attachment' }],
    filename: 'scope.png',
    content_type: 'image/png',
    size_bytes: 128,
    storage_uri: 'memory://scope.png',
    checksum_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    uploaded_by_actor_id: 'actor-product',
    created_at: '2026-05-27T08:00:00.000Z',
    evidence_category: 'image',
    visibility: 'object',
    safety_status: 'passed',
    reference_status: 'active',
  };
  const evidence: ReleaseEvidence = {
    id: 'evidence-1',
    org_id: 'org-typed-source',
    project_id: requirement.project_id,
    release_id: release.id,
    title: 'Research screenshot',
    evidence_type: 'observation_note',
    summary: 'Research screenshot',
    object_ref: { object_type: 'work_item', object_id: requirement.id, relationship: 'supports' },
    extra: {
      observation: {
        links: [{ object_type: 'attachment', object_id: attachment.id, relationship: 'supports' }],
      },
    },
    redacted: false,
    status: 'current',
    created_at: '2026-05-27T08:45:00.000Z',
    created_by_actor_id: 'actor-product',
  };

  await repository.saveWorkItem(requirement);
  await repository.saveDevelopmentPlan(developmentPlan);
  await Promise.all(items.map((item) => repository.saveDevelopmentPlanItem(item)));
  await repository.saveRelease(release);
  await repository.saveAttachment(attachment);
  await repository.saveReleaseEvidence(evidence);
}
