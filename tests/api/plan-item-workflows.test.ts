import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import type { DeliveryRepository } from '../../packages/db/src';
import {
  ids,
  seedApprovedBoundaryWorkflow,
  seedBoundaryReviewWorkflow,
  seedDevelopmentPlanItem,
  seedSpecReviewWorkflow,
  seedWorkflow,
  seedWorkflowWithApprovedImplementationPlan,
  startWorkflow,
} from '../helpers/plan-item-workflow-fixtures';

describe('Plan Item Workflow API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('starts workflow with initial active session and transition ledger', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);

    const response = await request(app.getHttpServer())
      .post(`/development-plans/${plan.id}/items/${item.id}/workflow/start-brainstorming`)
      .send({
        actor_id: ids.actorTech,
        runtime_profile_id: ids.runtimeProfile,
        runtime_profile_revision_id: ids.runtimeProfileRevision,
        credential_binding_id: ids.credentialBinding,
        credential_binding_version_id: ids.credentialBindingVersion,
        reason: 'Start Superpowers workflow.',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      status: 'brainstorming',
      session: {
        status: 'idle',
        role: 'active',
        continuity_state: 'ready',
      },
    });
    expect(response.body.session.codex_thread_id).toBeUndefined();
    expect(response.body.session.latest_snapshot_digest).toBeUndefined();
    expect(response.body.session.lease_token_hash).toBeUndefined();
    expect(response.body.session.worker_id).toBeUndefined();

    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const transitions = await repository.listPlanItemWorkflowTransitions(response.body.id);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      from_status: 'not_started',
      to_status: 'brainstorming',
      evidence_object_type: 'manual_decision',
    });
  });

  it('rejects unauthorized workflow start before creating workflow/session rows', async () => {
    const { ids: fixtureIds, plan, item } = await seedDevelopmentPlanItem(app);
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    await request(app.getHttpServer())
      .post(`/development-plans/${plan.id}/items/${item.id}/workflow/start-brainstorming`)
      .send({
        actor_id: fixtureIds.actorUnauthorized,
        runtime_profile_id: fixtureIds.runtimeProfile,
        runtime_profile_revision_id: fixtureIds.runtimeProfileRevision,
        credential_binding_id: fixtureIds.credentialBinding,
        credential_binding_version_id: fixtureIds.credentialBindingVersion,
        reason: 'Unauthorized workflow start.',
      })
      .expect(403)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_actor_not_authorized');
      });

    await expect(repository.getActivePlanItemWorkflowByItem(item.id)).resolves.toBeUndefined();
  });

  it('rejects workflow start when route plan does not own the item', async () => {
    const first = await seedDevelopmentPlanItem(app, { idPrefix: '66666666' });
    const second = await seedDevelopmentPlanItem(app, { idPrefix: '77777777' });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    await request(app.getHttpServer())
      .post(`/development-plans/${second.plan.id}/items/${first.item.id}/workflow/start-brainstorming`)
      .send({
        actor_id: first.ids.actorTech,
        runtime_profile_id: first.ids.runtimeProfile,
        runtime_profile_revision_id: first.ids.runtimeProfileRevision,
        credential_binding_id: first.ids.credentialBinding,
        credential_binding_version_id: first.ids.credentialBindingVersion,
        reason: 'Start workflow with a mismatched route plan.',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_invalid_transition');
      });

    await expect(repository.getActivePlanItemWorkflowByItem(first.item.id)).resolves.toBeUndefined();
    await expect(repository.getActivePlanItemWorkflowByItem(second.item.id)).resolves.toBeUndefined();
  });

  it('rejects wrong evidence type for boundary submission', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const workflow = await startWorkflow(app, plan.id, item.id);

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${workflow.id}/transitions`)
      .send({
        actor_id: ids.actorTech,
        to_status: 'boundary_review',
        evidence_object_type: 'spec_revision',
        evidence_object_id: ids.specRevision,
      })
      .expect(400)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_invalid_transition');
      });
  });

  it('enforces product authorization before workflow mutations', async () => {
    const { workflow, ids: fixtureIds } = await seedWorkflow(app);

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${workflow.id}/block`)
      .send({
        actor_id: fixtureIds.actorLeader,
        reason: 'Only a Tech Lead, delegate, owner, or operator can block workflow execution.',
      })
      .expect(403)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_actor_not_authorized');
      });
  });

  it('rejects document evidence from another workflow', async () => {
    const first = await seedBoundaryReviewWorkflow(app, { idPrefix: '11111111' });
    const second = await seedApprovedBoundaryWorkflow(app, { idPrefix: '22222222' });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${first.workflow.id}/transitions`)
      .send({
        actor_id: first.ids.actorTech,
        to_status: 'spec_generation_queued',
        evidence_object_type: 'boundary_summary_revision',
        evidence_object_id: second.boundaryRevision.id,
      })
      .expect(400)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_evidence_not_owned');
      });
  });

  it('rejects supporting evidence from another workflow', async () => {
    const first = await seedSpecReviewWorkflow(app, { idPrefix: '33333333' });
    const second = await seedApprovedBoundaryWorkflow(app, { idPrefix: '44444444' });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${first.workflow.id}/transitions`)
      .send({
        actor_id: first.ids.actorTech,
        to_status: 'implementation_plan_generation_queued',
        evidence_object_type: 'spec_revision',
        evidence_object_id: first.specRevision.id,
        supporting_evidence: [
          {
            object_type: 'boundary_summary_revision',
            object_id: second.boundaryRevision.id,
          },
        ],
      })
      .expect(400)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_evidence_not_owned');
      });
  });

  it('approves implementation plan and creates readiness evidence in one service action', async () => {
    const seeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '55555555' });

    const response = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/approve-implementation-plan-and-mark-execution-ready`)
      .send({
        actor_id: seeded.ids.actorTech,
        approved_implementation_plan_revision_id: seeded.implementationPlanRevision.id,
        reason: 'Implementation Plan reviewed and ready for execution.',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      status: 'execution_ready',
      active_implementation_plan_doc_revision_id: seeded.implementationPlanRevision.id,
    });

    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const transitions = await repository.listPlanItemWorkflowTransitions(seeded.workflow.id);
    expect(transitions.at(-1)).toMatchObject({
      from_status: 'implementation_plan_review',
      to_status: 'execution_ready',
      evidence_object_type: 'execution_readiness_record',
      supporting_evidence: [{ object_type: 'implementation_plan_revision', object_id: seeded.implementationPlanRevision.id }],
    });
    await expect(repository.getExecutionReadinessRecord(transitions.at(-1)?.evidence_object_id ?? '')).resolves.toMatchObject({
      readiness_state: 'ready',
      approved_implementation_plan_revision_id: seeded.implementationPlanRevision.id,
    });
  });
});
