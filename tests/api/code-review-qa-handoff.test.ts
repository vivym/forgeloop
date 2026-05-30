import { INestApplication } from '@nestjs/common';
import type { DeliveryRepository } from '@forgeloop/db';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import {
  executionActorDeveloper,
  executionActorQa,
  executionActorReviewer,
  executionActorTechLead,
  reviewerHeaders,
  seedCompletedExecution,
  techLeadHeaders,
} from '../helpers/execution-supervision-fixtures';

describe('Code review and QA handoff API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('moves a completed execution into code review and then QA handoff', async () => {
    const { execution, item, executionPlanRevision, specRevision } = await seedCompletedExecution(app);
    const server = app.getHttpServer();

    const review = (
      await request(server)
        .post(`/executions/${execution.id}/ready-for-code-review`)
        .send({
          actor_id: executionActorDeveloper,
          summary: 'Diff is ready for review.',
          changed_surfaces: ['apps/web/src/features/development-plans'],
          verification_evidence_refs: [{ type: 'execution', id: execution.id }],
        })
        .expect(201)
    ).body;

    expect(review).toMatchObject({
      execution_id: execution.id,
      status: 'in_review',
      reviewer_actor_id: executionActorReviewer,
    });

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

    expect(qa).toMatchObject({
      code_review_handoff_id: review.id,
      execution_id: execution.id,
      status: 'pending',
      source_ref: expect.objectContaining({ type: 'requirement' }),
      development_plan_item_id: item.id,
      approved_spec_revision_ref: expect.objectContaining({ id: specRevision.id }),
      approved_implementation_plan_revision_ref: expect.objectContaining({ id: executionPlanRevision.id }),
      changed_surfaces: ['apps/web/src/features/development-plans'],
      release_impact: item.release_impact,
    });

    await request(server)
      .post(`/qa-handoffs/${qa.id}/accept`)
      .send({
        actor_id: executionActorQa,
        rationale: 'Regression evidence accepted.',
        verification_evidence_refs: [{ type: 'execution', id: execution.id }],
      })
      .expect(201);

    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await expect(repository.getExecution(execution.id)).resolves.toMatchObject({ status: 'completed' });
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({
      execution_status: 'completed',
      qa_handoff_status: 'approved',
      next_action: 'prepare_release',
    });
  });

  it('supports code review changes requested, QA block, QA accept, and audited exception paths', async () => {
    const { execution } = await seedCompletedExecution(app);
    const server = app.getHttpServer();
    const review = (
      await request(server)
        .post(`/executions/${execution.id}/ready-for-code-review`)
        .send({
          actor_id: executionActorDeveloper,
          summary: 'Review needs QA preparation in parallel.',
          changed_surfaces: ['apps/control-plane-api/src/modules/executions'],
          verification_evidence_refs: [{ type: 'execution', id: execution.id }],
        })
        .expect(201)
    ).body;

    await request(server)
      .post(`/code-review-handoffs/${review.id}/request-changes`)
      .set(reviewerHeaders)
      .send({ actor_id: executionActorReviewer, rationale: 'Test evidence is missing.' })
      .expect(201);
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await expect(repository.getExecution(execution.id)).resolves.toMatchObject({ status: 'interrupted' });
    await expect(repository.getDevelopmentPlanItem(execution.development_plan_item_id)).resolves.toMatchObject({
      execution_status: 'interrupted',
      review_status: 'changes_requested',
      next_action: 'continue_execution',
    });
    await request(server)
      .post(`/executions/${execution.id}/continue`)
      .send({ actor_id: executionActorDeveloper })
      .expect(201);
    await expect(repository.getDevelopmentPlanItem(execution.development_plan_item_id)).resolves.toMatchObject({
      execution_status: 'running',
      next_action: 'monitor_execution',
    });

    const exception = (
      await request(server)
        .post(`/code-review-handoffs/${review.id}/audited-exception`)
        .set(techLeadHeaders)
        .send({
          actor_id: executionActorTechLead,
          reason: 'QA may prepare test data before final review approval.',
          risk: 'medium',
          rollback_plan: 'Hold QA acceptance until review passes.',
        })
        .expect(201)
    ).body;
    expect(exception.audited_exception).toMatchObject({ actor_id: executionActorTechLead, risk: 'medium' });

    const qa = (
      await request(server)
        .post(`/code-review-handoffs/${review.id}/qa-handoff`)
        .send({
          actor_id: executionActorReviewer,
          acceptance_criteria: ['Execution supervision evidence is complete'],
          test_strategy: 'Focused API regression tests',
        })
        .expect(201)
    ).body;

    await request(server)
      .post(`/qa-handoffs/${qa.id}/block`)
      .send({ actor_id: executionActorQa, rationale: 'Acceptance evidence is incomplete.' })
      .expect(201);

    const blockedByReview = await request(server)
      .post(`/qa-handoffs/${qa.id}/accept`)
      .send({
        actor_id: executionActorQa,
        rationale: 'Regression evidence accepted.',
        verification_evidence_refs: [{ type: 'execution', id: execution.id }],
      })
      .expect(400);
    expect(blockedByReview.body.message).toContain('approved code review');
  });

  it('rejects duplicate QA handoffs and terminal QA transitions', async () => {
    const { execution } = await seedCompletedExecution(app);
    const server = app.getHttpServer();
    const review = (
      await request(server)
        .post(`/executions/${execution.id}/ready-for-code-review`)
        .send({
          actor_id: executionActorDeveloper,
          summary: 'Diff is ready for review.',
          changed_surfaces: ['apps/control-plane-api/src/modules/executions'],
          verification_evidence_refs: [{ type: 'execution', id: execution.id }],
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
          acceptance_criteria: ['Execution supervision evidence is complete'],
          test_strategy: 'Focused API regression tests',
        })
        .expect(201)
    ).body;
    await request(server)
      .post(`/code-review-handoffs/${review.id}/qa-handoff`)
      .send({
        actor_id: executionActorReviewer,
        acceptance_criteria: ['Duplicate handoff should be rejected'],
        test_strategy: 'Focused API regression tests',
      })
      .expect(409);

    await request(server)
      .post(`/qa-handoffs/${qa.id}/block`)
      .send({ actor_id: executionActorQa, rationale: 'Acceptance evidence is incomplete.' })
      .expect(201);
    await request(server)
      .post(`/qa-handoffs/${qa.id}/accept`)
      .send({
        actor_id: executionActorQa,
        rationale: 'Regression evidence accepted after block resolution.',
        verification_evidence_refs: [{ type: 'execution', id: execution.id }],
      })
      .expect(201);
    await request(server)
      .post(`/qa-handoffs/${qa.id}/block`)
      .send({ actor_id: executionActorQa, rationale: 'Cannot block after acceptance.' })
      .expect(400);
    await request(server)
      .post(`/qa-handoffs/${qa.id}/accept`)
      .send({
        actor_id: executionActorQa,
        rationale: 'Cannot accept twice.',
        verification_evidence_refs: [{ type: 'execution', id: execution.id }],
      })
      .expect(400);
    await request(server)
      .post(`/code-review-handoffs/${review.id}/request-changes`)
      .set(reviewerHeaders)
      .send({ actor_id: executionActorReviewer, rationale: 'Cannot request changes after approval and QA acceptance.' })
      .expect(400);
  });

  it('rejects review approval from non-human actor headers', async () => {
    const { execution } = await seedCompletedExecution(app);
    const server = app.getHttpServer();
    const review = (
      await request(server)
        .post(`/executions/${execution.id}/ready-for-code-review`)
        .send({
          actor_id: executionActorDeveloper,
          summary: 'Diff is ready for review.',
          changed_surfaces: ['tests/api'],
          verification_evidence_refs: [{ type: 'execution', id: execution.id }],
        })
        .expect(201)
    ).body;

    await request(server)
      .post(`/code-review-handoffs/${review.id}/approve`)
      .set({
        'x-forgeloop-actor-id': 'actor-bot',
        'x-forgeloop-actor-class': 'automation_daemon',
      })
      .send({ actor_id: 'actor-bot', rationale: 'Bots cannot approve product review.' })
      .expect(403);
  });
});
