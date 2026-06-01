import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import type { DeliveryRepository } from '../../packages/db/src';
import type { CodeReviewHandoff, Execution, Plan, PlanRevision, QaHandoff } from '../../packages/domain/src';
import {
  ids,
  idsFor,
  seedApprovedBoundaryWorkflow,
  seedBoundaryReviewWorkflow,
  seedDevelopmentPlanItem,
  seedSpecReviewWorkflow,
  seedWorkflow,
  seedWorkflowWithApprovedImplementationPlan,
  startWorkflow,
} from '../helpers/plan-item-workflow-fixtures';

async function seedLegacyCurrentPlanForWorkflowOwnedItem(
  repository: DeliveryRepository,
  seeded: Awaited<ReturnType<typeof seedWorkflowWithApprovedImplementationPlan>>,
): Promise<PlanRevision> {
  const now = '2026-05-31T00:00:00.000Z';
  const planId = `legacy-plan-${seeded.ids.item}`;
  const planRevisionId = `legacy-plan-revision-${seeded.ids.item}`;
  const plan: Plan = {
    id: planId,
    work_item_id: seeded.ids.sourceRequirement,
    development_plan_item_id: seeded.item.id,
    workflow_id: seeded.workflow.id,
    entity_type: 'plan',
    status: 'approved',
    editing_state: 'idle',
    gate_state: 'approved',
    resolution: 'approved',
    current_revision_id: planRevisionId,
    approved_revision_id: planRevisionId,
    approved_at: now,
    approved_by_actor_id: seeded.ids.actorTech,
    created_at: now,
    updated_at: now,
  };
  const planRevision: PlanRevision = {
    id: planRevisionId,
    plan_id: plan.id,
    work_item_id: seeded.ids.sourceRequirement,
    based_on_spec_revision_id: seeded.specRevision.id,
    revision_number: 1,
    summary: 'Legacy approved plan for workflow-owned item.',
    content: 'Legacy route fixture plan body.',
    implementation_summary: 'Should be blocked by workflow ownership.',
    split_strategy: 'One package.',
    dependency_order: ['api-package'],
    test_matrix: ['pnpm vitest run tests/api/plan-item-workflows.test.ts'],
    risk_mitigations: ['Route bypass risk is rejected.'],
    rollback_notes: 'No mutation should be persisted.',
    author_actor_id: seeded.ids.actorTech,
    artifact_refs: [],
    created_at: now,
  };
  const workItem = await repository.getWorkItem(seeded.ids.sourceRequirement);
  if (workItem === undefined) {
    throw new Error(`WorkItem ${seeded.ids.sourceRequirement} not found`);
  }
  await repository.savePlan(plan);
  await repository.savePlanRevision(planRevision);
  await repository.saveWorkItem({
    ...workItem,
    current_plan_id: plan.id,
    current_plan_revision_id: planRevision.id,
    updated_at: now,
  });
  return planRevision;
}

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

  it('seeds workflow-owned plan items with a portable runtime policy repo', async () => {
    const { ids: fixtureIds } = await seedDevelopmentPlanItem(app, { idPrefix: '12121212' });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const [repo] = await repository.listProjectRepos(fixtureIds.project);

    expect(repo?.local_path).toContain('forgeloop-runtime-policy-repo-');
    await expect(access(join(repo!.local_path, 'WORKFLOW.md'))).resolves.toBeUndefined();
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

  it('stores workflow and Codex session refs on boundary brainstorming child records', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const workflow = await startWorkflow(app, plan.id, item.id);

    const session = (
      await request(app.getHttpServer())
        .post(`/plan-item-workflows/${workflow.id}/boundary-brainstorming`)
        .send({ actor_id: ids.actorTech })
        .expect(201)
    ).body;

    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await expect(repository.getBrainstormingSession(session.id)).resolves.toMatchObject({
      workflow_id: workflow.id,
      codex_session_id: workflow.active_codex_session_id,
    });
    const [round] = await repository.listBoundaryRounds(session.id);
    expect(round).toMatchObject({ codex_session_turn_id: expect.any(String) });
    await expect(repository.getCodexSessionTurn(round.codex_session_turn_id ?? '')).resolves.toMatchObject({
      workflow_id: workflow.id,
      codex_session_id: workflow.active_codex_session_id,
      intent: 'continue_brainstorming',
      status: 'running',
    });
  });

  it('rejects direct legacy Superpowers mutators for workflow-owned items', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app, { idPrefix: '17171717' });
    const workflow = await startWorkflow(app, plan.id, item.id);

    await request(app.getHttpServer())
      .post(`/development-plans/${plan.id}/items/${item.id}/boundary-brainstorming`)
      .send({ actor_id: idsFor('17171717').actorTech })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${workflow.id}/boundary-brainstorming`)
      .send({ actor_id: idsFor('17171717').actorTech })
      .expect(201);
  });

  it('rejects direct legacy document mutators for workflow-owned items', async () => {
    const seeded = await seedApprovedBoundaryWorkflow(app, { idPrefix: '18181818' });

    await request(app.getHttpServer())
      .post(`/development-plans/${seeded.plan.id}/items/${seeded.item.id}/spec/generate-draft`)
      .send({ actor_id: seeded.ids.actorTech })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });

    const specRevision = (
      await request(app.getHttpServer())
        .post(`/plan-item-workflows/${seeded.workflow.id}/spec/generate-draft`)
        .send({ actor_id: seeded.ids.actorTech })
        .expect(201)
    ).body;
    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/spec-revisions/${specRevision.id}/submit`)
      .send({ actor_id: seeded.ids.actorTech, reason: 'Submit Spec for review.' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/spec-revisions/${specRevision.id}/approve`)
      .send({ actor_id: seeded.ids.actorTech, reason: 'Approve Spec.' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/development-plans/${seeded.plan.id}/items/${seeded.item.id}/implementation-plan/generate-draft`)
      .send({ actor_id: seeded.ids.actorTech })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
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

  it('approves Boundary Summary child records before advancing workflow', async () => {
    const seeded = await seedBoundaryReviewWorkflow(app, { idPrefix: '15151515' });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    const initialBoundaryRevision = await repository.getBoundarySummaryRevisionById(seeded.boundaryRevision.id);
    expect(initialBoundaryRevision).toMatchObject({ status: 'proposed' });
    expect(initialBoundaryRevision?.approved_at).toBeUndefined();

    const response = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/boundary-summary-revisions/${seeded.boundaryRevision.id}/approve`)
      .send({ actor_id: seeded.ids.actorTech, reason: 'Approve Boundary Summary for Spec generation.' })
      .expect(201);

    expect(response.body).toMatchObject({
      status: 'spec_generation_queued',
      active_boundary_summary_revision_id: seeded.boundaryRevision.id,
    });
    await expect(repository.getBoundarySummaryRevisionById(seeded.boundaryRevision.id)).resolves.toMatchObject({
      status: 'approved',
      approved_by_actor_id: seeded.ids.actorTech,
      approved_at: expect.any(String),
    });
    await expect(repository.getBrainstormingSession(seeded.boundaryRevision.session_id)).resolves.toMatchObject({
      status: 'approved',
      approval_state: 'approved',
      approved_summary_revision_id: seeded.boundaryRevision.id,
      approver_actor_id: seeded.ids.actorTech,
      approved_at: expect.any(String),
    });
    await expect(repository.getBoundarySummary(seeded.boundaryRevision.boundary_summary_id)).resolves.toMatchObject({
      revision_id: seeded.boundaryRevision.id,
      approved_by_actor_id: seeded.ids.actorTech,
      approved_at: expect.any(String),
    });
    await expect(repository.getDevelopmentPlanItem(seeded.item.id)).resolves.toMatchObject({
      boundary_status: 'approved',
      next_action: 'generate_spec',
    });
    const transitions = await repository.listPlanItemWorkflowTransitions(seeded.workflow.id);
    expect(transitions.at(-1)).toMatchObject({
      to_status: 'spec_generation_queued',
      evidence_object_id: seeded.boundaryRevision.id,
      codex_session_turn_id: seeded.boundaryRevision.codex_session_turn_id,
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

  it('stores workflow/session/turn refs on generated Spec revisions', async () => {
    const seeded = await seedApprovedBoundaryWorkflow(app, { idPrefix: '88888888' });

    const revision = (
      await request(app.getHttpServer())
        .post(`/plan-item-workflows/${seeded.workflow.id}/spec/generate-draft`)
        .send({ actor_id: seeded.ids.actorTech })
        .expect(201)
    ).body;

    expect(revision).toMatchObject({
      workflow_id: seeded.workflow.id,
      codex_session_id: seeded.workflow.active_codex_session_id,
      codex_session_turn_id: expect.any(String),
    });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await expect(repository.getSpecRevision(revision.id)).resolves.toMatchObject({
      workflow_id: seeded.workflow.id,
      codex_session_id: seeded.workflow.active_codex_session_id,
      codex_session_turn_id: revision.codex_session_turn_id,
    });
  });

  it('records child Codex turn refs on document gate transitions', async () => {
    const seeded = await seedApprovedBoundaryWorkflow(app, { idPrefix: '16161616' });
    const server = app.getHttpServer();
    const specRevision = (
      await request(server)
        .post(`/plan-item-workflows/${seeded.workflow.id}/spec/generate-draft`)
        .send({ actor_id: seeded.ids.actorTech })
        .expect(201)
    ).body;

    await request(server)
      .post(`/plan-item-workflows/${seeded.workflow.id}/spec-revisions/${specRevision.id}/submit`)
      .send({ actor_id: seeded.ids.actorTech, reason: 'Submit Spec for review.' })
      .expect(201);
    const specApproved = (
      await request(server)
        .post(`/plan-item-workflows/${seeded.workflow.id}/spec-revisions/${specRevision.id}/approve`)
        .send({ actor_id: seeded.ids.actorTech, reason: 'Approve Spec for Implementation Plan generation.' })
        .expect(201)
    ).body;

    const implementationPlanRevision = (
      await request(server)
        .post(`/plan-item-workflows/${seeded.workflow.id}/implementation-plan/generate-draft`)
        .send({ actor_id: seeded.ids.actorTech })
        .expect(201)
    ).body;
    await request(server)
      .post(`/plan-item-workflows/${seeded.workflow.id}/implementation-plan-revisions/${implementationPlanRevision.id}/submit`)
      .send({ actor_id: seeded.ids.actorTech, reason: 'Submit Implementation Plan for review.' })
      .expect(201);
    await request(server)
      .post(
        `/plan-item-workflows/${seeded.workflow.id}/implementation-plan-revisions/${implementationPlanRevision.id}/approve`,
      )
      .send({ actor_id: seeded.ids.actorTech, reason: 'Approve Implementation Plan for execution.' })
      .expect(201);

    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const transitions = await repository.listPlanItemWorkflowTransitions(seeded.workflow.id);
    expect(transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to_status: 'spec_review',
          evidence_object_id: specRevision.id,
          codex_session_turn_id: specRevision.codex_session_turn_id,
        }),
        expect.objectContaining({
          to_status: 'implementation_plan_generation_queued',
          evidence_object_id: specRevision.id,
          codex_session_turn_id: specRevision.codex_session_turn_id,
        }),
        expect.objectContaining({
          to_status: 'implementation_plan_review',
          evidence_object_id: implementationPlanRevision.id,
          codex_session_turn_id: implementationPlanRevision.codex_session_turn_id,
        }),
      ]),
    );
    const executionReady = transitions.find((transition) => transition.to_status === 'execution_ready');
    expect(executionReady).toMatchObject({
      evidence_object_type: 'execution_readiness_record',
      codex_session_turn_id: implementationPlanRevision.codex_session_turn_id,
    });
    await expect(repository.getExecutionReadinessRecord(executionReady?.evidence_object_id ?? '')).resolves.toMatchObject({
      codex_session_turn_id: implementationPlanRevision.codex_session_turn_id,
    });
    expect(specApproved).toMatchObject({ active_spec_doc_revision_id: specRevision.id });
  });

  it('submits document revisions through workflow-addressed routes', async () => {
    const seeded = await seedApprovedBoundaryWorkflow(app, { idPrefix: '12121212' });
    const specRevision = (
      await request(app.getHttpServer())
        .post(`/plan-item-workflows/${seeded.workflow.id}/spec/generate-draft`)
        .send({ actor_id: seeded.ids.actorTech })
        .expect(201)
    ).body;

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/spec-revisions/not-current/submit`)
      .send({ actor_id: seeded.ids.actorTech, reason: 'Wrong revision id must not be accepted.' })
      .expect(400)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_evidence');
      });

    const specSubmission = (
      await request(app.getHttpServer())
        .post(`/plan-item-workflows/${seeded.workflow.id}/spec-revisions/${specRevision.id}/submit`)
        .send({ actor_id: seeded.ids.actorTech, reason: 'Submit Spec for workflow review.' })
        .expect(201)
    ).body;

    expect(specSubmission).toMatchObject({ status: 'spec_review' });
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

  it('rejects unauthorized workflow change requests before mutating child records', async () => {
    const specSeeded = await seedSpecReviewWorkflow(app, { idPrefix: '24242424' });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${specSeeded.workflow.id}/request-spec-changes`)
      .send({
        actor_id: specSeeded.ids.actorLeader,
        reason: 'Product driver cannot request workflow-owned Spec changes.',
        rejected_revision_id: specSeeded.specRevision.id,
      })
      .expect(403)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_actor_not_authorized');
      });

    await expect(repository.getPlanItemWorkflow(specSeeded.workflow.id)).resolves.toMatchObject({ status: 'spec_review' });
    await expect(repository.getDevelopmentPlanItem(specSeeded.item.id)).resolves.toMatchObject({ spec_status: 'missing' });

    const planSeeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '25252525' });
    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${planSeeded.workflow.id}/request-implementation-plan-changes`)
      .send({
        actor_id: planSeeded.ids.actorLeader,
        reason: 'Product driver cannot request workflow-owned Implementation Plan changes.',
        rejected_revision_id: planSeeded.implementationPlanRevision.id,
      })
      .expect(403)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_actor_not_authorized');
      });

    await expect(repository.getPlanItemWorkflow(planSeeded.workflow.id)).resolves.toMatchObject({
      status: 'implementation_plan_review',
    });
    await expect(repository.getDevelopmentPlanItem(planSeeded.item.id)).resolves.toMatchObject({
      implementation_plan_status: 'missing',
    });
  });

  it('requires an authorized actor when saving workflow-owned document drafts', async () => {
    const seeded = await seedApprovedBoundaryWorkflow(app, { idPrefix: '26262626' });
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const specRevision = (
      await request(server)
        .post(`/plan-item-workflows/${seeded.workflow.id}/spec/generate-draft`)
        .send({ actor_id: seeded.ids.actorTech })
        .expect(201)
    ).body;
    const specDocument = {
      markdown: '# Edited Spec draft\n\nAuthorized workflow edits must name the caller.',
      object_ref: { type: 'spec_revision', id: specRevision.id, spec_id: specRevision.spec_id },
      allowed_blocks: ['paragraph', 'heading', 'list', 'link', 'image', 'table', 'code_block', 'inline_code'],
      attachment_refs: [],
      validation_version: '2026-05-23',
    };

    await request(server)
      .patch(`/plan-item-workflows/${seeded.workflow.id}/spec/draft`)
      .send(specDocument)
      .expect(400);
    await request(server)
      .patch(`/plan-item-workflows/${seeded.workflow.id}/spec/draft`)
      .send({ actor_id: seeded.ids.actorLeader, document: specDocument })
      .expect(403)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_actor_not_authorized');
      });
    await expect(repository.getSpecRevision(specRevision.id)).resolves.toMatchObject({ content: specRevision.content });

    await request(server)
      .post(`/plan-item-workflows/${seeded.workflow.id}/spec-revisions/${specRevision.id}/submit`)
      .send({ actor_id: seeded.ids.actorTech, reason: 'Submit Spec for review.' })
      .expect(201);
    await request(server)
      .post(`/plan-item-workflows/${seeded.workflow.id}/spec-revisions/${specRevision.id}/approve`)
      .send({ actor_id: seeded.ids.actorTech, reason: 'Approve Spec for Implementation Plan generation.' })
      .expect(201);
    const planRevision = (
      await request(server)
        .post(`/plan-item-workflows/${seeded.workflow.id}/implementation-plan/generate-draft`)
        .send({ actor_id: seeded.ids.actorTech })
        .expect(201)
    ).body;
    const planDocument = {
      markdown: '# Edited Implementation Plan draft\n\nAuthorized workflow edits must name the caller.',
      object_ref: {
        type: 'implementation_plan_revision',
        id: planRevision.id,
        implementation_plan_id: planRevision.implementation_plan_id,
      },
      allowed_blocks: ['paragraph', 'heading', 'list', 'link', 'image', 'table', 'code_block', 'inline_code'],
      attachment_refs: [],
      validation_version: '2026-05-23',
    };
    await request(server)
      .patch(`/plan-item-workflows/${seeded.workflow.id}/implementation-plan/draft`)
      .send(planDocument)
      .expect(400);
    await request(server)
      .patch(`/plan-item-workflows/${seeded.workflow.id}/implementation-plan/draft`)
      .send({ actor_id: seeded.ids.actorLeader, document: planDocument })
      .expect(403)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_actor_not_authorized');
      });
    await expect(repository.getExecutionPlanRevision(planRevision.id)).resolves.toMatchObject({ content: planRevision.content });
  });

  it('creates and selects Codex session forks through public workflow routes without leaking runtime internals', async () => {
    const seeded = await seedWorkflow(app, { idPrefix: '27272727' });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const activeSessionId = seeded.workflow.active_codex_session_id;
    if (activeSessionId === undefined) throw new Error('Workflow fixture has no active session');
    const forkTurnId = '27272727-1111-4111-8111-111111119001';
    await repository.createCodexSessionTurn({
      id: forkTurnId,
      workflow_id: seeded.workflow.id,
      codex_session_id: activeSessionId,
      intent: 'continue_brainstorming',
      status: 'running',
      input_digest: 'sha256:fork-point',
      created_by_actor_id: seeded.ids.actorTech,
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/codex-sessions/${activeSessionId}/fork`)
      .send({ actor_id: seeded.ids.actorTech, reason: 'Missing explicit fork point.' })
      .expect(400);

    const fork = (
      await request(app.getHttpServer())
        .post(`/plan-item-workflows/${seeded.workflow.id}/codex-sessions/${activeSessionId}/fork`)
        .send({
          actor_id: seeded.ids.actorTech,
          reason: 'Explore an alternate Codex session path.',
          forked_from_turn_id: forkTurnId,
        })
        .expect(201)
    ).body;

    expect(fork).toMatchObject({
      id: expect.any(String),
      role: 'candidate_fork',
      status: 'idle',
      continuity_state: 'ready',
      can_continue: false,
    });
    expect(fork.forked_from_turn_id).toBeUndefined();
    expect(fork.latest_snapshot_digest).toBeUndefined();
    expect(fork.codex_thread_id).toBeUndefined();
    expect(fork.lease_token_hash).toBeUndefined();

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/codex-sessions/${fork.id}/select-active-fork`)
      .send({ actor_id: seeded.ids.actorLeader, reason: 'Unauthorized fork selection.' })
      .expect(403)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_actor_not_authorized');
      });

    const selected = (
      await request(app.getHttpServer())
        .post(`/plan-item-workflows/${seeded.workflow.id}/codex-sessions/${fork.id}/select-active-fork`)
        .send({ actor_id: seeded.ids.actorTech, reason: 'Use the alternate Codex session path.' })
        .expect(201)
    ).body;

    expect(selected).toMatchObject({
      id: seeded.workflow.id,
      status: 'brainstorming',
      active_codex_session_id: fork.id,
      session: { id: fork.id, role: 'active', status: 'idle' },
    });
    await expect(repository.getCodexSession(activeSessionId)).resolves.toMatchObject({ role: 'inactive_fork' });
    const transitions = await repository.listPlanItemWorkflowTransitions(seeded.workflow.id);
    const latestTransition = transitions.at(-1);
    expect(latestTransition).toMatchObject({
      from_status: 'brainstorming',
      to_status: 'brainstorming',
      evidence_object_type: 'manual_decision',
      actor_id: seeded.ids.actorTech,
      reason: 'Use the alternate Codex session path.',
    });
    await expect(repository.getWorkflowManualDecision(latestTransition?.evidence_object_id ?? '')).resolves.toMatchObject({
      kind: 'fork_select',
      selected_codex_session_id: fork.id,
    });
  });

  it('starts execution through workflow route and carries workflow session refs into package and run session', async () => {
    const seeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '19191919' });
    const server = app.getHttpServer();
    await request(server)
      .post(`/plan-item-workflows/${seeded.workflow.id}/approve-implementation-plan-and-mark-execution-ready`)
      .send({
        actor_id: seeded.ids.actorTech,
        approved_implementation_plan_revision_id: seeded.implementationPlanRevision.id,
        reason: 'Execution readiness approved.',
      })
      .expect(201);

    const response = await request(server)
      .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
      .send({ actor_id: seeded.ids.actorTech })
      .expect(201);

    expect(response.body).toMatchObject({
      status: 'execution_running',
      execution_package_id: expect.any(String),
    });

    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const transitions = await repository.listPlanItemWorkflowTransitions(seeded.workflow.id);
    const executionStarted = transitions.at(-1);
    expect(executionStarted).toMatchObject({
      from_status: 'execution_ready',
      to_status: 'execution_running',
      evidence_object_type: 'execution_package',
      evidence_object_id: response.body.execution_package_id,
      codex_session_turn_id: expect.any(String),
      supporting_evidence: [expect.objectContaining({ object_type: 'run_session', object_id: expect.any(String) })],
    });
    const runSessionId = executionStarted?.supporting_evidence?.find((evidence) => evidence.object_type === 'run_session')?.object_id;
    if (runSessionId === undefined) {
      throw new Error('Run Session supporting evidence was not recorded');
    }
    await expect(repository.getExecutionPackage(response.body.execution_package_id)).resolves.toMatchObject({
      workflow_id: seeded.workflow.id,
      codex_session_id: seeded.workflow.active_codex_session_id,
      codex_session_turn_id: executionStarted?.codex_session_turn_id,
    });
    await expect(repository.getRunSession(runSessionId)).resolves.toMatchObject({
      workflow_id: seeded.workflow.id,
      codex_session_id: seeded.workflow.active_codex_session_id,
      codex_session_turn_id: executionStarted?.codex_session_turn_id,
    });
    await expect(repository.getDevelopmentPlanItem(seeded.item.id)).resolves.toMatchObject({
      execution_status: 'running',
      next_action: 'monitor_execution',
    });
  });

  it('rejects legacy direct boundary session mutators for workflow-owned sessions', async () => {
    const { plan, item, ids: fixtureIds } = await seedDevelopmentPlanItem(app, { idPrefix: '20202020' });
    const workflow = await startWorkflow(app, plan.id, item.id);
    const server = app.getHttpServer();
    const session = (
      await request(server)
        .post(`/plan-item-workflows/${workflow.id}/boundary-brainstorming`)
        .send({ actor_id: fixtureIds.actorTech })
        .expect(201)
    ).body;
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const [round] = await repository.listBoundaryRounds(session.id);
    await repository.saveBoundaryQuestion({
      id: fixtureIds.boundaryQuestion,
      session_id: session.id,
      sequence: 1,
      round_id: round.id,
      text: 'Which workflow route owns this answer?',
      author_id: fixtureIds.actorTech,
      created_at: '2026-05-31T00:00:00.000Z',
      status: 'open',
      required: true,
    });

    await request(server)
      .post(`/boundary-brainstorming-sessions/${session.id}/answers`)
      .send({ question_id: fixtureIds.boundaryQuestion, text: 'Legacy answer.', actor_id: fixtureIds.actorTech })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });
    await request(server)
      .post(`/boundary-brainstorming-sessions/${session.id}/decisions`)
      .send({ text: 'Legacy decision.', actor_id: fixtureIds.actorTech })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });
    await request(server)
      .post(`/boundary-brainstorming-sessions/${session.id}/continue`)
      .send({ actor_id: fixtureIds.actorTech, leader_input_markdown: 'Legacy continue.' })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });
    await expect(repository.listBoundaryAnswers(session.id)).resolves.toHaveLength(0);
    await expect(repository.listBoundaryDecisions(session.id)).resolves.toHaveLength(0);
  });

  it('rejects legacy package generation and creation for workflow-owned items', async () => {
    const seeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '21212121' });
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const planRevision = await seedLegacyCurrentPlanForWorkflowOwnedItem(repository, seeded);

    await request(server)
      .post(`/plan-revisions/${planRevision.id}/generate-packages`)
      .send({})
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });
    await request(server)
      .post(`/plan-revisions/${planRevision.id}/execution-packages`)
      .send({
        repo_id: 'forgeloop',
        objective: 'Legacy package create should be blocked.',
        owner_actor_id: seeded.ids.actorTech,
        reviewer_actor_id: seeded.ids.actorTech,
        qa_owner_actor_id: seeded.ids.actorLeader,
        required_checks: [
          {
            check_id: 'unit',
            display_name: 'Unit tests',
            command: 'pnpm vitest run tests/api/plan-item-workflows.test.ts',
            timeout_seconds: 120,
            blocks_review: true,
          },
        ],
        required_artifact_kinds: ['execution_summary'],
        allowed_paths: ['apps/control-plane-api/**'],
        forbidden_paths: ['packages/db/**'],
      })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });

    await expect(repository.listExecutionPackagesForWorkItem(seeded.ids.sourceRequirement)).resolves.toEqual([]);
  });

  it('rejects legacy run-session commands for workflow-owned run sessions', async () => {
    const seeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '22222222' });
    const server = app.getHttpServer();
    await request(server)
      .post(`/plan-item-workflows/${seeded.workflow.id}/approve-implementation-plan-and-mark-execution-ready`)
      .send({
        actor_id: seeded.ids.actorTech,
        approved_implementation_plan_revision_id: seeded.implementationPlanRevision.id,
        reason: 'Execution readiness approved.',
      })
      .expect(201);
    const started = (
      await request(server)
        .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
        .send({ actor_id: seeded.ids.actorTech })
        .expect(201)
    ).body;
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const transitions = await repository.listPlanItemWorkflowTransitions(seeded.workflow.id);
    const runSessionId = transitions
      .at(-1)
      ?.supporting_evidence?.find((evidence) => evidence.object_type === 'run_session')?.object_id;
    if (runSessionId === undefined) {
      throw new Error('Run Session supporting evidence was not recorded');
    }

    const ownerHeaders = {
      'x-forgeloop-actor-id': seeded.ids.actorTech,
      'x-forgeloop-actor-class': 'human',
    };
    await request(server)
      .post(`/run-sessions/${runSessionId}/input`)
      .set(ownerHeaders)
      .send({ message: 'Legacy input command.' })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });
    await request(server)
      .post(`/run-sessions/${runSessionId}/cancel`)
      .set(ownerHeaders)
      .send({ reason: 'Legacy cancel command.' })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });
    await request(server)
      .post(`/run-sessions/${runSessionId}/resume`)
      .set(ownerHeaders)
      .send({ reason: 'Legacy resume command.' })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });

    expect(started.execution_package_id).toEqual(expect.any(String));
    await expect(repository.getRunSession(runSessionId)).resolves.toMatchObject({
      status: 'queued',
      workflow_id: seeded.workflow.id,
      codex_session_id: seeded.workflow.active_codex_session_id,
    });
  });

  it('rejects legacy execution, review, and QA mutators for workflow-owned items', async () => {
    const seeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '23232323' });
    const server = app.getHttpServer();
    await request(server)
      .post(`/plan-item-workflows/${seeded.workflow.id}/approve-implementation-plan-and-mark-execution-ready`)
      .send({
        actor_id: seeded.ids.actorTech,
        approved_implementation_plan_revision_id: seeded.implementationPlanRevision.id,
        reason: 'Execution readiness approved.',
      })
      .expect(201);
    await request(server)
      .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
      .send({ actor_id: seeded.ids.actorTech })
      .expect(201);

    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const [execution] = await repository.listExecutions();
    if (execution === undefined) {
      throw new Error('Workflow execution was not created');
    }

    await request(server)
      .post(`/executions/${execution.id}/interrupt`)
      .send({ actor_id: seeded.ids.actorTech })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });
    await request(server)
      .post(`/executions/${execution.id}/ready-for-code-review`)
      .send({
        actor_id: seeded.ids.actorTech,
        summary: 'Legacy code review handoff.',
        changed_surfaces: ['apps/control-plane-api'],
        verification_evidence_refs: [{ type: 'execution', id: execution.id, title: 'Workflow-owned execution' }],
      })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });

    const codeReviewHandoff: CodeReviewHandoff = {
      id: seeded.ids.boundaryAnswer,
      ref: { type: 'code_review_handoff', id: seeded.ids.boundaryAnswer, title: 'Workflow-owned code review' },
      execution_id: execution.id,
      development_plan_item_id: seeded.item.id,
      implementation_plan_revision_id: seeded.implementationPlanRevision.id,
      reviewer_actor_id: seeded.ids.actorTech,
      status: 'in_review',
      summary: 'Workflow-owned code review handoff.',
      changed_surfaces: ['apps/control-plane-api'],
      verification_evidence_refs: [{ type: 'execution', id: execution.id, title: 'Workflow-owned execution' }],
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    };
    await repository.saveCodeReviewHandoff(codeReviewHandoff);
    const reviewerHeaders = {
      'x-forgeloop-actor-id': seeded.ids.actorTech,
      'x-forgeloop-actor-class': 'human',
    };
    await request(server)
      .post(`/code-review-handoffs/${codeReviewHandoff.id}/approve`)
      .set(reviewerHeaders)
      .send({ actor_id: seeded.ids.actorTech, rationale: 'Legacy review approval.' })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });
    await request(server)
      .post(`/code-review-handoffs/${codeReviewHandoff.id}/qa-handoff`)
      .send({
        actor_id: seeded.ids.actorTech,
        acceptance_criteria: ['Legacy QA handoff should not be created.'],
        test_strategy: 'Legacy QA strategy.',
      })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });

    const qaHandoff: QaHandoff = {
      id: seeded.ids.boundaryDecision,
      ref: { type: 'qa_handoff', id: seeded.ids.boundaryDecision, title: 'Workflow-owned QA handoff' },
      code_review_handoff_id: codeReviewHandoff.id,
      execution_id: execution.id,
      source_ref: { type: 'requirement', id: seeded.ids.sourceRequirement },
      development_plan_item_id: seeded.item.id,
      development_plan_item_ref: {
        type: 'development_plan_item',
        id: seeded.item.id,
        development_plan_id: seeded.plan.id,
        revision_id: seeded.ids.itemRevision,
        title: 'Session continuity',
      },
      approved_spec_revision_ref: {
        type: 'spec_revision',
        id: seeded.specRevision.id,
        spec_id: seeded.ids.spec,
        title: seeded.specRevision.summary,
      },
      approved_implementation_plan_revision_ref: {
        type: 'implementation_plan_revision',
        id: seeded.implementationPlanRevision.id,
        implementation_plan_id: seeded.ids.executionPlan,
        title: seeded.implementationPlanRevision.summary,
      },
      status: 'pending',
      acceptance_criteria: ['Workflow-owned QA acceptance criteria.'],
      test_strategy: 'Workflow-owned QA strategy.',
      verification_evidence_refs: [],
      known_risks: [],
      changed_surfaces: ['apps/control-plane-api'],
      release_impact: 'none',
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    };
    await repository.saveQaHandoff(qaHandoff);
    await request(server)
      .post(`/qa-handoffs/${qaHandoff.id}/block`)
      .send({ actor_id: seeded.ids.actorTech, rationale: 'Legacy QA block.' })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });
    await request(server)
      .post(`/qa-handoffs/${qaHandoff.id}/accept`)
      .send({
        actor_id: seeded.ids.actorTech,
        rationale: 'Legacy QA accept.',
        verification_evidence_refs: [{ type: 'execution', id: execution.id, title: 'Workflow-owned execution' }],
      })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });

    await expect(repository.getExecution(execution.id)).resolves.toMatchObject({ status: 'running' });
    await expect(repository.getCodeReviewHandoff(codeReviewHandoff.id)).resolves.toMatchObject({ status: 'in_review' });
    await expect(repository.getQaHandoff(qaHandoff.id)).resolves.toMatchObject({ status: 'pending' });
  });
});
