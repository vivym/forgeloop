import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import type { DeliveryRepository } from '../../packages/db/src';
import type {
  BoundarySummaryRevision,
  BrainstormingSession,
} from '../../packages/domain/src';
import {
  seedBoundaryReviewWorkflow,
  seedDevelopmentPlanItem,
  seedWorkflowWithApprovedImplementationPlan,
} from '../helpers/plan-item-workflow-fixtures';

describe('Boundary Brainstorming public API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ['development-plans/:developmentPlanId/items/:itemId/brainstorming-sessions', 'item-brainstorming-start', 'basic'],
    ['development-plans/:developmentPlanId/items/:itemId/boundary-brainstorming', 'item-boundary-brainstorming-start', 'boundary'],
    ['development-plans/:developmentPlanId/items/:itemId/boundary-brainstorming/restart', 'item-boundary-brainstorming-restart', 'boundary'],
  ] as const)('does not mount legacy item mutation route POST /%s', async (template, _operation, bodyKind) => {
    const { plan, item, ids } = await seedDevelopmentPlanItem(app, { idPrefix: '58585858' });
    const path = `/${template}`
      .replace(':developmentPlanId', plan.id)
      .replace(':itemId', item.id);
    const body = bodyKind === 'basic'
      ? { actor_id: ids.actorTech }
      : {
          actor_id: ids.actorTech,
          leader_actor_id: ids.actorTech,
          leader_delegate_actor_ids: [],
          initial_leader_context_markdown: 'Legacy mutation should be disabled.',
        };

    await request(app.getHttpServer())
      .post(path)
      .send(body)
      .expect(404);
  });

  it.each([
    ['brainstorming-sessions/:sessionId/answers', { question_id: 'question-1', text: 'Legacy answer.', actor_id: 'actor-tech' }],
    ['brainstorming-sessions/:sessionId/decisions', { text: 'Legacy decision.', actor_id: 'actor-tech' }],
    ['brainstorming-sessions/:sessionId/approve-boundary', { actor_id: 'actor-tech' }],
    ['boundary-brainstorming-sessions/:sessionId/answers', { question_id: 'question-1', text: 'Legacy answer.', actor_id: 'actor-tech' }],
    ['boundary-brainstorming-sessions/:sessionId/decisions', { text: 'Legacy decision.', actor_id: 'actor-tech' }],
    ['boundary-brainstorming-sessions/:sessionId/continue', { actor_id: 'actor-tech', leader_input_markdown: 'Continue.' }],
    [
      'boundary-brainstorming-sessions/:sessionId/summary-revisions/:revisionId/approve',
      { actor_id: 'actor-tech', final_decision: 'Legacy approval.' },
    ],
    [
      'boundary-brainstorming-sessions/:sessionId/summary-revisions/:revisionId/request-changes',
      { actor_id: 'actor-tech', feedback_markdown: 'Legacy changes.' },
    ],
  ] as const)('does not mount legacy session mutation route POST /%s', async (template, body) => {
    const seeded = await seedBoundaryReviewWorkflow(app, { idPrefix: '59595959' });
    const sessionId = await sessionIdForBoundaryRevision(app, seeded.boundaryRevision);
    const path = `/${template}`
      .replace(':sessionId', sessionId)
      .replace(':revisionId', seeded.boundaryRevision.id);

    await request(app.getHttpServer())
      .post(path)
      .send(body)
      .expect(404);
  });

  it('keeps read-only revision endpoints available for workflow-owned artifacts', async () => {
    const seeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '60606060' });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const itemRevisions = await repository.listDevelopmentPlanItemRevisions(seeded.item.id);
    const [baseRevision] = itemRevisions;
    expect(baseRevision).toBeDefined();

    await request(app.getHttpServer())
      .get(`/development-plans/${seeded.plan.id}/items/${seeded.item.id}/revisions`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(expect.arrayContaining([expect.objectContaining({ id: baseRevision.id })]));
      });

    await request(app.getHttpServer())
      .get(`/development-plans/${seeded.plan.id}/items/${seeded.item.id}/revisions/compare`)
      .query({ base_revision_id: baseRevision.id, compare_revision_id: baseRevision.id })
      .expect(200)
      .expect(({ body }) => {
        expect(body.base_revision_id).toBe(baseRevision.id);
        expect(body.compare_revision_id).toBe(baseRevision.id);
      });

    await request(app.getHttpServer())
      .get(`/boundary-summaries/${seeded.boundaryRevision.boundary_summary_id}/revisions`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(expect.arrayContaining([expect.objectContaining({ id: seeded.boundaryRevision.id })]));
      });

    await request(app.getHttpServer())
      .get(`/boundary-summaries/${seeded.boundaryRevision.boundary_summary_id}/revisions/compare`)
      .query({ base_revision_id: seeded.boundaryRevision.id, compare_revision_id: seeded.boundaryRevision.id })
      .expect(200)
      .expect(({ body }) => {
        expect(body.base_revision_id).toBe(seeded.boundaryRevision.id);
        expect(body.compare_revision_id).toBe(seeded.boundaryRevision.id);
      });
  });
});

async function sessionIdForBoundaryRevision(app: INestApplication, revision: BoundarySummaryRevision): Promise<string> {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const record = revision as BoundarySummaryRevision & { session_id?: string; brainstorming_session_id?: string };
  const sessionId = record.session_id ?? record.brainstorming_session_id;
  if (sessionId === undefined) {
    throw new Error(`Boundary Summary revision ${revision.id} has no session id`);
  }
  const session = await repository.getBrainstormingSession(sessionId) as BrainstormingSession | undefined;
  if (session === undefined) {
    throw new Error(`Boundary Brainstorming Session ${sessionId} not found`);
  }
  return session.id;
}
