import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import type { DeliveryRepository } from '../../packages/db/src';
import {
  idsFor,
  seedApprovedBoundaryWorkflow,
  seedBoundaryReviewWorkflow,
  seedDevelopmentPlanItem,
  seedSpecReviewWorkflow,
  seedWorkflow,
  seedWorkflowWithApprovedImplementationPlan,
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

  it('start brainstorming creates workflow, active session, and queued continuation without creating a turn', async () => {
    const { plan, item, ids: fixtureIds } = await seedDevelopmentPlanItem(app, { idPrefix: '51515151' });
    const response = await request(app.getHttpServer())
      .post(`/development-plans/${plan.id}/items/${item.id}/workflow/start-brainstorming`)
      .send({
        actor_id: fixtureIds.actorTech,
        runtime_profile_id: fixtureIds.runtimeProfile,
        runtime_profile_revision_id: fixtureIds.runtimeProfileRevision,
        credential_binding_id: fixtureIds.credentialBinding,
        credential_binding_version_id: fixtureIds.credentialBindingVersion,
        reason: 'Start workflow.',
      })
      .expect(201);

    expect(response.body.status).toBe('brainstorming');
    expect(response.body.queued_actions).toEqual([
      expect.objectContaining({ kind: 'continue_brainstorming', status: 'queued' }),
    ]);

    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const turns = await repository.listCodexSessionTurns(response.body.active_codex_session_id);
    expect(turns).toHaveLength(0);
  });

  it('/messages records human input and creates queued continuation without claiming a lease', async () => {
    const seeded = await seedWorkflow(app, { idPrefix: '52525252' });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await claimStartupActionForMessageTest(repository, seeded.workflow.id);

    const response = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/messages`)
      .send({
        actor_id: seeded.ids.actorTech,
        action: 'answer_boundary_question',
        body_markdown: 'Scope is the workflow API and UI only.',
      })
      .expect(201);

    expect(response.body.queued_actions).toContainEqual(
      expect.objectContaining({
        kind: 'continue_brainstorming',
        status: 'queued',
      }),
    );

    const [message] = await repository.listPlanItemWorkflowMessages(seeded.workflow.id);
    expect(message).toMatchObject({
      action: 'answer_boundary_question',
      body_markdown: 'Scope is the workflow API and UI only.',
      created_queued_action_id: expect.any(String),
    });
    const activeSession = await repository.getCodexSession(seeded.workflow.active_codex_session_id!);
    expect(activeSession?.active_lease_id).toBeUndefined();
    await expect(repository.listCodexSessionTurns(seeded.workflow.active_codex_session_id!)).resolves.toHaveLength(0);
  });

  it('/messages rejects generation actions', async () => {
    const seeded = await seedWorkflow(app, { idPrefix: '53535353' });
    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/messages`)
      .send({
        actor_id: seeded.ids.actorTech,
        action: 'generate_spec_doc',
        body_markdown: 'Generate spec.',
      })
      .expect(400);
  });

  it('runs queued action through workflow turn evidence without starting execution', async () => {
    const seeded = await seedWorkflow(app, { idPrefix: '54545454' });
    const action = await firstQueuedAction(app, seeded.workflow.id);

    const first = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${action.id}/run`)
      .send({ actor_id: seeded.ids.actorTech })
      .expect(201);

    expect(first.body).toMatchObject({
      queued_action: expect.objectContaining({
        id: action.id,
        kind: 'continue_brainstorming',
        status: 'blocked',
        codex_session_turn_id: expect.any(String),
        blocked_reason_code: 'workflow_runtime_dispatch_not_configured',
      }),
    });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const turns = await repository.listCodexSessionTurns(seeded.workflow.active_codex_session_id!);
    expect(turns).toContainEqual(expect.objectContaining({
      id: first.body.queued_action.codex_session_turn_id,
      workflow_id: seeded.workflow.id,
      codex_session_id: seeded.workflow.active_codex_session_id,
      intent: 'continue_brainstorming',
      status: 'running',
    }));
    await expect(repository.listRunSessions()).resolves.toHaveLength(0);

    const second = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${action.id}/run`)
      .send({ actor_id: seeded.ids.actorTech })
      .expect(201);
    expect(second.body.queued_action).toMatchObject({
      id: action.id,
      status: 'blocked',
      codex_session_turn_id: first.body.queued_action.codex_session_turn_id,
    });
    await expect(repository.listCodexSessionTurns(seeded.workflow.active_codex_session_id!)).resolves.toHaveLength(turns.length);
  });

  it('running queued Spec Doc generation creates turn evidence but does not synchronously dispatch runtime work', async () => {
    const seeded = await seedBoundaryReviewWorkflow(app, { idPrefix: '54545455' });
    const approval = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/boundary-summary/revisions/${seeded.boundaryRevision.id}/approve`)
      .send({ actor_id: seeded.ids.actorTech, decision_markdown: 'Boundary accepted.' })
      .expect(201);
    const action = approval.body.queued_actions.find((candidate: { kind: string }) => candidate.kind === 'generate_spec_doc');
    expect(action).toEqual(expect.objectContaining({ status: 'queued' }));

    const response = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${action.id}/run`)
      .send({ actor_id: seeded.ids.actorTech })
      .expect(201);

    expect(response.body.queued_action).toMatchObject({
      id: action.id,
      kind: 'generate_spec_doc',
      status: 'blocked',
      codex_session_turn_id: expect.any(String),
      blocked_reason_code: 'workflow_runtime_dispatch_not_configured',
    });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const turns = await repository.listCodexSessionTurns(seeded.workflow.active_codex_session_id!);
    const turn = turns.find((candidate) => candidate.id === response.body.queued_action.codex_session_turn_id);
    expect(turn).toMatchObject({
      workflow_id: seeded.workflow.id,
      codex_session_id: seeded.workflow.active_codex_session_id,
      intent: 'draft_spec_doc',
    });
    await expect(repository.listRunSessions()).resolves.toHaveLength(0);
  });

  it('approves artifacts and evaluates readiness without starting execution', async () => {
    const boundarySeed = await seedBoundaryReviewWorkflow(app, { idPrefix: '55555551' });
    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${boundarySeed.workflow.id}/artifacts/boundary-summary/revisions/${boundarySeed.boundaryRevision.id}/approve`)
      .send({ actor_id: boundarySeed.ids.actorTech, decision_markdown: 'Looks ready.' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('spec_generation_queued');
        expect(body.queued_actions).toContainEqual(
          expect.objectContaining({ kind: 'generate_spec_doc', status: 'queued' }),
        );
      });

    const specSeed = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '55555552' });
    expect(specSeed.workflow.active_spec_doc_revision_id).toBe(specSeed.specRevision.id);
    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${specSeed.workflow.id}/artifacts/spec-doc/revisions/${specSeed.specRevision.id}/request-changes`)
      .send({ actor_id: specSeed.ids.actorTech, reason_markdown: 'Clarify acceptance criteria.' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('spec_generation_queued');
        expect(body.queued_actions).toContainEqual(
          expect.objectContaining({ kind: 'revise_spec_doc', status: 'queued' }),
        );
      });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await expect(repository.getPlanItemWorkflow(specSeed.workflow.id)).resolves.toMatchObject({
      active_boundary_summary_revision_id: specSeed.workflow.active_boundary_summary_revision_id,
      active_spec_doc_revision_id: undefined,
      active_implementation_plan_doc_revision_id: undefined,
      execution_package_id: undefined,
    });

    const planSeed = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '55555553' });
    const approval = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${planSeed.workflow.id}/artifacts/implementation-plan-doc/revisions/${planSeed.implementationPlanRevision.id}/approve`)
      .send({ actor_id: planSeed.ids.actorTech, decision_markdown: 'Plan accepted.' })
      .expect(201);
    expect(approval.body.status).toBe('implementation_plan_review');
    expect(approval.body.readiness).toMatchObject({ state: 'not_evaluated', can_evaluate: true });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${planSeed.workflow.id}/execution-readiness/evaluate`)
      .send({ actor_id: planSeed.ids.actorTech, rationale_markdown: 'Check readiness.' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('execution_ready');
        expect(body.readiness).toMatchObject({ state: 'ready', can_evaluate: false, blocker_codes: [] });
      });

    await expect(repository.listRunSessions()).resolves.toHaveLength(0);
  });

  it('rejects request-changes for stale owned revisions without clearing active workflow evidence', async () => {
    const seeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '55555554' });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const staleRevisionId = `${seeded.ids.specRevision.slice(0, -1)}9`;
    await repository.saveSpecRevision({
      ...seeded.specRevision,
      id: staleRevisionId,
      revision_number: 0,
      summary: 'Stale workflow spec.',
      content: 'Old spec content.',
      created_at: '2026-05-30T00:00:00.000Z',
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/spec-doc/revisions/${staleRevisionId}/request-changes`)
      .send({ actor_id: seeded.ids.actorTech, reason_markdown: 'This is not the active revision.' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_evidence_not_current');
      });

    await expect(repository.getPlanItemWorkflow(seeded.workflow.id)).resolves.toMatchObject({
      active_boundary_summary_revision_id: seeded.workflow.active_boundary_summary_revision_id,
      active_spec_doc_revision_id: seeded.workflow.active_spec_doc_revision_id,
      active_implementation_plan_doc_revision_id: seeded.workflow.active_implementation_plan_doc_revision_id,
    });
  });

  it('rejects request-changes when workflow projection points at an artifact-non-current revision', async () => {
    const seeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '55555556' });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const newCurrentRevisionId = `${seeded.ids.specRevision.slice(0, -1)}8`;
    await repository.saveSpecRevision({
      ...seeded.specRevision,
      id: newCurrentRevisionId,
      revision_number: 2,
      summary: 'New current workflow spec.',
      content: 'New current spec content.',
      created_at: '2026-06-01T00:00:00.000Z',
    });
    const spec = await repository.getSpec(seeded.ids.spec);
    if (spec === undefined) {
      throw new Error('Expected seeded Spec aggregate');
    }
    await repository.saveSpec({
      ...spec,
      current_revision_id: newCurrentRevisionId,
      updated_at: '2026-06-01T00:00:00.000Z',
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/spec-doc/revisions/${seeded.specRevision.id}/request-changes`)
      .send({ actor_id: seeded.ids.actorTech, reason_markdown: 'Projection points at an old spec revision.' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_evidence_not_current');
        expect(body.details).toMatchObject({
          current_revision_id: newCurrentRevisionId,
          requested_revision_id: seeded.specRevision.id,
        });
      });

    await expect(repository.getPlanItemWorkflow(seeded.workflow.id)).resolves.toMatchObject({
      active_spec_doc_revision_id: seeded.workflow.active_spec_doc_revision_id,
      active_implementation_plan_doc_revision_id: seeded.workflow.active_implementation_plan_doc_revision_id,
    });
    await expect(repository.getSpec(seeded.ids.spec)).resolves.toMatchObject({
      current_revision_id: newCurrentRevisionId,
      status: spec.status,
    });
  });

  it('requesting Boundary Summary changes invalidates the active artifact and session without scheduling hidden work', async () => {
    const seeded = await seedApprovedBoundaryWorkflow(app, { idPrefix: '55555555' });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/boundary-summary/revisions/${seeded.boundaryRevision.id}/request-changes`)
      .send({ actor_id: seeded.ids.actorTech, reason_markdown: 'Narrow the accepted boundary.' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('brainstorming');
        expect(body.queued_actions).toContainEqual(
          expect.objectContaining({ kind: 'revise_boundary_summary', status: 'queued' }),
        );
      });

    await expect(repository.getBoundarySummaryRevisionById(seeded.boundaryRevision.id)).resolves.toMatchObject({
      status: 'superseded',
    });
    await expect(repository.getBrainstormingSession(seeded.ids.boundarySession)).resolves.toMatchObject({
      status: 'changes_requested',
      approval_state: 'changes_requested',
    });
    await expect(repository.listCodexSessionTurns(seeded.workflow.active_codex_session_id!)).resolves.toHaveLength(1);
    await expect(repository.listRunSessions()).resolves.toHaveLength(0);
  });

  it.each([
    ['post', '/plan-item-workflows/:workflowId/transitions'],
    ['post', '/plan-item-workflows/:workflowId/boundary-brainstorming'],
    ['post', '/plan-item-workflows/:workflowId/boundary-brainstorming-sessions/:sessionId/answers'],
    ['post', '/plan-item-workflows/:workflowId/boundary-brainstorming-sessions/:sessionId/decisions'],
    ['post', '/plan-item-workflows/:workflowId/boundary-brainstorming-sessions/:sessionId/continue'],
    ['post', '/plan-item-workflows/:workflowId/boundary-brainstorming-sessions/:sessionId/summary-revisions/:revisionId/request-changes'],
    ['post', '/plan-item-workflows/:workflowId/boundary-summary-revisions/:revisionId/submit'],
    ['post', '/plan-item-workflows/:workflowId/boundary-summary-revisions/:revisionId/approve'],
    ['post', '/plan-item-workflows/:workflowId/spec/generate-draft'],
    ['post', '/plan-item-workflows/:workflowId/spec-revisions/generate'],
    ['post', '/plan-item-workflows/:workflowId/implementation-plan/generate-draft'],
    ['post', '/plan-item-workflows/:workflowId/implementation-plan-revisions/generate'],
    ['post', '/plan-item-workflows/:workflowId/spec/regenerate-draft'],
    ['patch', '/plan-item-workflows/:workflowId/spec/draft'],
    ['post', '/plan-item-workflows/:workflowId/spec-revisions/:revisionId/submit'],
    ['post', '/plan-item-workflows/:workflowId/spec-revisions/:revisionId/approve'],
    ['post', '/plan-item-workflows/:workflowId/implementation-plan/regenerate-draft'],
    ['patch', '/plan-item-workflows/:workflowId/implementation-plan/draft'],
    ['post', '/plan-item-workflows/:workflowId/implementation-plan-revisions/:revisionId/submit'],
    ['post', '/plan-item-workflows/:workflowId/implementation-plan-revisions/:revisionId/approve'],
    ['post', '/plan-item-workflows/:workflowId/request-boundary-changes'],
    ['post', '/plan-item-workflows/:workflowId/request-spec-changes'],
    ['post', '/plan-item-workflows/:workflowId/request-implementation-plan-changes'],
    ['post', '/plan-item-workflows/:workflowId/block'],
    ['post', '/plan-item-workflows/:workflowId/archive'],
    ['post', '/plan-item-workflows/:workflowId/recover'],
    ['post', '/plan-item-workflows/:workflowId/approve-implementation-plan-and-mark-execution-ready'],
    ['post', '/plan-item-workflows/:workflowId/codex-sessions/:sessionId/fork'],
    ['post', '/plan-item-workflows/:workflowId/codex-sessions/:sessionId/select-active-fork'],
    ['post', '/plan-item-workflows/:workflowId/execution/start'],
    ['post', '/plan-item-workflows/:workflowId/run-sessions/:runSessionId/input'],
    ['post', '/plan-item-workflows/:workflowId/run-sessions/:runSessionId/cancel'],
    ['post', '/plan-item-workflows/:workflowId/run-sessions/:runSessionId/resume'],
  ] as const)('disables old public workflow mutation route %s %s', async (method, template) => {
    const seeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '56565656' });
    const url = template
      .replace(':workflowId', seeded.workflow.id)
      .replace(':sessionId', seeded.workflow.active_codex_session_id!)
      .replace(':revisionId', seeded.implementationPlanRevision.id)
      .replace(':runSessionId', seeded.ids.readiness);
    const body = legacyBodyForRoute(template, seeded);

    await request(app.getHttpServer())
      [method](url)
      .send(body)
      .expect(409)
      .expect(({ body: responseBody }) => {
        expect(JSON.stringify(responseBody)).toContain('workflow_legacy_entrypoint_disabled');
      });
  });

  it('maps Wave 5 action conflicts to 409', async () => {
    const seeded = await seedWorkflow(app, { idPrefix: '57575757' });
    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/messages`)
      .send({
        actor_id: seeded.ids.actorTech,
        action: 'continue_ai',
        body_markdown: 'Continue while the startup action is still pending.',
      })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_action_already_pending');
      });
  });
});

async function firstQueuedAction(app: INestApplication, workflowId: string) {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const [action] = await repository.listActivePlanItemWorkflowQueuedActions(workflowId);
  if (action === undefined) {
    throw new Error(`Expected queued action for workflow ${workflowId}`);
  }
  return action;
}

async function claimStartupActionForMessageTest(repository: DeliveryRepository, workflowId: string) {
  const [action] = await repository.listActivePlanItemWorkflowQueuedActions(workflowId);
  if (action === undefined) {
    return;
  }
  await repository.claimOrReplayPlanItemWorkflowQueuedActionRun({
    workflow_id: workflowId,
    action_id: action.id,
    actor_id: action.created_by_actor_id,
    idempotency_key: `test-claim-${action.id}`,
    now: '2026-06-03T00:00:00.000Z',
  });
  await repository.terminalizePlanItemWorkflowQueuedAction({
    workflow_id: workflowId,
    action_id: action.id,
    status: 'cancelled',
    blocked_reason_code: 'test_clear_active_action',
    now: '2026-06-03T00:00:01.000Z',
  });
}

function legacyBodyForRoute(
  template: string,
  seeded: Awaited<ReturnType<typeof seedWorkflowWithApprovedImplementationPlan>>,
): Record<string, unknown> {
  const fixtureIds = idsFor('56565656');
  if (template.includes('/answers')) {
    return { question_id: fixtureIds.boundaryQuestion, text: 'Legacy answer.', actor_id: seeded.ids.actorTech };
  }
  if (template.includes('/decisions')) {
    return { text: 'Legacy decision.', actor_id: seeded.ids.actorTech };
  }
  if (template.includes('/continue')) {
    return { actor_id: seeded.ids.actorTech, leader_input_markdown: 'Legacy continue.' };
  }
  if (template.endsWith('/boundary-brainstorming')) {
    return { actor_id: seeded.ids.actorTech };
  }
  if (template.includes('/summary-revisions/') && template.includes('/request-changes')) {
    return { actor_id: seeded.ids.actorTech, feedback_markdown: 'Legacy boundary changes.' };
  }
  if (template.includes('/regenerate-draft')) {
    return { actor_id: seeded.ids.actorTech, feedback: 'Legacy regenerate feedback.', preserve_prior_decisions: false };
  }
  if (template.includes('/generate-draft') || template.includes('revisions/generate') || template.includes('/execution/start')) {
    return { actor_id: seeded.ids.actorTech };
  }
  if (template.includes('/draft') && template.startsWith('/plan-item-workflows/:workflowId/spec')) {
    return {
      actor_id: seeded.ids.actorTech,
      document: {
        markdown: '# Legacy draft',
        object_ref: { type: 'spec_revision', id: seeded.specRevision.id, spec_id: seeded.ids.spec },
        allowed_blocks: ['paragraph'],
        attachment_refs: [],
        validation_version: '2026-05-23',
      },
    };
  }
  if (template.includes('/draft') && template.includes('/implementation-plan')) {
    return {
      actor_id: seeded.ids.actorTech,
      document: {
        markdown: '# Legacy plan draft',
        object_ref: {
          type: 'implementation_plan_revision',
          id: seeded.implementationPlanRevision.id,
          implementation_plan_id: seeded.ids.executionPlan,
        },
        allowed_blocks: ['paragraph'],
        attachment_refs: [],
        validation_version: '2026-05-23',
      },
    };
  }
  if (template.includes('/transitions')) {
    return {
      actor_id: seeded.ids.actorTech,
      to_status: 'execution_ready',
      evidence_object_type: 'implementation_plan_revision',
      evidence_object_id: seeded.implementationPlanRevision.id,
    };
  }
  if (template.includes('/fork')) {
    return { actor_id: seeded.ids.actorTech, reason: 'Legacy fork.', forked_from_turn_id: fixtureIds.boundaryRound };
  }
  if (template.includes('/select-active-fork')) {
    return { actor_id: seeded.ids.actorTech, reason: 'Legacy fork select.' };
  }
  if (template.includes('/input')) {
    return { message: 'Legacy run input.' };
  }
  if (template.includes('/cancel') || template.includes('/resume')) {
    return { reason: 'Legacy run control.' };
  }
  if (template.includes('approve-implementation-plan-and-mark-execution-ready')) {
    return {
      actor_id: seeded.ids.actorTech,
      approved_implementation_plan_revision_id: seeded.implementationPlanRevision.id,
      reason: 'Legacy readiness.',
    };
  }
  if (template.includes('request-')) {
    return {
      actor_id: seeded.ids.actorTech,
      reason: 'Legacy change request.',
      rejected_revision_id: seeded.implementationPlanRevision.id,
    };
  }
  return { actor_id: seeded.ids.actorTech, reason: 'Legacy mutation.' };
}
