import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { ProductGenerationResultService } from '../../apps/control-plane-api/src/modules/automation/product-generation-result.service';
import type { DeliveryRepository } from '../../packages/db/src';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  type CodexGenerationRuntimeJobResult,
  type CodexGenerationWorkloadV1,
  type CodexRuntimeCapsule,
  type CodexRuntimeJob,
} from '../../packages/domain/src';
import {
  idsFor,
  resolveSeededGenerationRuntimeBinding,
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
	    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
	    const response = await request(app.getHttpServer())
	      .post(`/development-plans/${plan.id}/items/${item.id}/workflow/start-brainstorming`)
	      .send({
	        actor_id: fixtureIds.actorTech,
	        reason: 'Start workflow.',
	      })
	      .expect(201);

    expect(response.body.status).toBe('brainstorming');
    expect(response.body.queued_actions).toEqual([
      expect.objectContaining({ kind: 'continue_brainstorming', status: 'queued' }),
    ]);

    const workflow = await repository.getActivePlanItemWorkflowByItem(item.id);
    expect(workflow?.active_codex_session_id).toEqual(expect.any(String));
    const turns = await repository.listCodexSessionTurns(workflow!.active_codex_session_id!);
    expect(turns).toHaveLength(0);
  });

  it('start brainstorming resolves generation runtime binding server-side for product UI starts', async () => {
    const { plan, item, ids: fixtureIds } = await seedDevelopmentPlanItem(app, { idPrefix: '51515152' });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const developmentPlan = await repository.getDevelopmentPlan(plan.id);
    const runtimeBinding = await resolveSeededGenerationRuntimeBinding(repository, developmentPlan!.project_id);
    const response = await request(app.getHttpServer())
      .post(`/development-plans/${plan.id}/items/${item.id}/workflow/start-brainstorming`)
      .send({
        actor_id: fixtureIds.actorTech,
      })
      .expect(201);

    expect(response.body.status).toBe('brainstorming');
    const workflow = await repository.getActivePlanItemWorkflowByItem(item.id);
	    const session = await repository.getCodexSession(workflow!.active_codex_session_id!);
	    expect(session).toMatchObject(runtimeBinding);
	  });

	  it('rejects raw runtime binding identifiers on the public start brainstorming DTO', async () => {
	    const { plan, item, ids: fixtureIds } = await seedDevelopmentPlanItem(app, { idPrefix: '51515153' });
	    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
	    const developmentPlan = await repository.getDevelopmentPlan(plan.id);
	    const runtimeBinding = await resolveSeededGenerationRuntimeBinding(repository, developmentPlan!.project_id);

	    await request(app.getHttpServer())
	      .post(`/development-plans/${plan.id}/items/${item.id}/workflow/start-brainstorming`)
	      .send({
	        actor_id: fixtureIds.actorTech,
	        ...runtimeBinding,
	      })
	      .expect(400);

	    await expect(repository.getActivePlanItemWorkflowByItem(item.id)).resolves.toBeUndefined();
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
        client_message_id: 'client-boundary-answer-1',
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
      client_message_id: 'client-boundary-answer-1',
      created_queued_action_id: expect.any(String),
    });
    const [queuedAction] = await repository.listActivePlanItemWorkflowQueuedActions(seeded.workflow.id);
    expect(queuedAction).toMatchObject({
      created_from_message_id: message?.id,
      id: message?.created_queued_action_id,
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

  it('runs queued brainstorming continuation through workflow turn evidence without starting execution', async () => {
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
        status: 'succeeded',
        output_capsule_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        output_capsule_sequence: expect.any(Number),
      }),
    });
    expect(first.body.queued_action).not.toHaveProperty('codex_session_id');
    expect(first.body.queued_action).not.toHaveProperty('codex_session_turn_id');
    expect(first.body.queued_action).not.toHaveProperty('output_capsule_id');
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const turns = await repository.listCodexSessionTurns(seeded.workflow.active_codex_session_id!);
    expect(turns).toContainEqual(expect.objectContaining({
      workflow_id: seeded.workflow.id,
      codex_session_id: seeded.workflow.active_codex_session_id,
      intent: 'continue_brainstorming',
      status: 'succeeded',
    }));
    await expect(repository.listRunSessions()).resolves.toHaveLength(0);

    const second = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${action.id}/run`)
      .send({ actor_id: seeded.ids.actorTech })
      .expect(201);
    expect(second.body.queued_action).toMatchObject({
      id: action.id,
      status: 'succeeded',
    });
    await expect(repository.listCodexSessionTurns(seeded.workflow.active_codex_session_id!)).resolves.toHaveLength(turns.length);
  });

  it('can schedule a queued action through the real generation runtime bridge', async () => {
    const priorMode = process.env.FORGELOOP_PLAN_ITEM_WORKFLOW_GENERATION_MODE;
    process.env.FORGELOOP_PLAN_ITEM_WORKFLOW_GENERATION_MODE = 'runtime';
    try {
      const seeded = await seedWorkflow(app, { idPrefix: '54545455' });
      const action = await firstQueuedAction(app, seeded.workflow.id);

      const response = await request(app.getHttpServer())
        .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${action.id}/run`)
        .send({ actor_id: seeded.ids.actorTech })
        .expect(201);

      expect(response.body.queued_action).toMatchObject({
        id: action.id,
        kind: 'continue_brainstorming',
        status: 'running',
      });
      expect(response.body.queued_action).not.toHaveProperty('codex_session_id');
      expect(response.body.queued_action).not.toHaveProperty('codex_session_turn_id');
      expect(response.body.queued_action).not.toHaveProperty('output_capsule_id');

      const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
      const runningAction = await repository.getPlanItemWorkflowQueuedAction({
        workflow_id: seeded.workflow.id,
        action_id: action.id,
      });
      expect(runningAction).toMatchObject({
        status: 'running',
        codex_session_turn_id: expect.any(String),
      });
      const turn = await repository.getCodexSessionTurn(runningAction!.codex_session_turn_id!);
      expect(turn).toMatchObject({
        workflow_id: seeded.workflow.id,
        codex_session_id: seeded.workflow.active_codex_session_id,
        intent: 'continue_brainstorming',
        status: 'running',
      });
      const workflowBoundarySession = (await repository.listBrainstormingSessionsForWorkflow(seeded.workflow.id))[0];
      const rounds = workflowBoundarySession === undefined ? [] : await repository.listBoundaryRounds(workflowBoundarySession.id);
      const runtimeRound = rounds.find((round) => round.codex_session_turn_id === turn?.id);
      expect(runtimeRound).toMatchObject({ status: 'queued', runtime_job_id: expect.any(String) });
      const runtimeJob = await repository.getCodexRuntimeJob({ runtime_job_id: runtimeRound!.runtime_job_id! });
      expect(runtimeJob).toMatchObject({
        target_kind: 'generation',
        workflow_id: seeded.workflow.id,
        codex_session_id: seeded.workflow.active_codex_session_id,
        codex_session_turn_id: turn?.id,
      });
      expect(runtimeJob?.input_json).toMatchObject({ plan_item_workflow_action_id: action.id });
      const actionRun = await repository.getAutomationActionRun(runtimeJob!.target_id);
      expect(actionRun?.action_input_json).toMatchObject({ plan_item_workflow_action_id: action.id });
      await expect(repository.listRunSessions()).resolves.toHaveLength(0);
    } finally {
      if (priorMode === undefined) {
        delete process.env.FORGELOOP_PLAN_ITEM_WORKFLOW_GENERATION_MODE;
      } else {
        process.env.FORGELOOP_PLAN_ITEM_WORKFLOW_GENERATION_MODE = priorMode;
      }
    }
  });

  it('applies a real runtime result back to the queued action and workflow stage', async () => {
    const priorMode = process.env.FORGELOOP_PLAN_ITEM_WORKFLOW_GENERATION_MODE;
    process.env.FORGELOOP_PLAN_ITEM_WORKFLOW_GENERATION_MODE = 'runtime';
    try {
      const seeded = await seedWorkflow(app, { idPrefix: '54545456' });
      const action = await firstQueuedAction(app, seeded.workflow.id);

      await request(app.getHttpServer())
        .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${action.id}/run`)
        .send({ actor_id: seeded.ids.actorTech })
        .expect(201);

      const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
      const runningAction = await repository.getPlanItemWorkflowQueuedAction({
        workflow_id: seeded.workflow.id,
        action_id: action.id,
      });
      const turn = await repository.getCodexSessionTurn(runningAction!.codex_session_turn_id!);
      const workflowBoundarySession = (await repository.listBrainstormingSessionsForWorkflow(seeded.workflow.id))[0]!;
      const runtimeRound = (await repository.listBoundaryRounds(workflowBoundarySession.id)).find(
        (round) => round.codex_session_turn_id === turn?.id,
      )!;
      const runtimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: runtimeRound.runtime_job_id! }))!;
      const terminalResult = generationTerminalResultForWorkflow(runtimeJob, {
        generated_payload: {
          schema_version: 'boundary_round_result.v1',
          session_id: workflowBoundarySession.id,
          round_id: runtimeRound.id,
          questions: [],
          proposed_decisions: [
            {
              text: 'Keep the Plan Item Workflow loop bounded to Execution Ready.',
              rationale: 'Wave 5 must not start execution.',
            },
          ],
          summary_proposal: {
            summary_markdown: 'Boundary draft is ready for review.',
            confirmed_scope: ['PlanItemWorkflow Brainstorming through Execution Ready'],
            confirmed_out_of_scope: ['RunSession creation', 'execution worker jobs', 'PR creation'],
            accepted_assumptions: ['Generation runs in the active Codex session.'],
            open_risks: ['Runtime output still requires human review.'],
            validation_expectations: ['Focused workflow API tests pass.'],
          },
          needs_leader_input: true,
          public_summary: 'Generated a Boundary Summary revision for review.',
          artifacts: [],
        },
      });
      await terminalizeRuntimeJob(repository, runtimeJob, terminalResult, 'workflow-result-apply');

      const resultWriter = app.get(ProductGenerationResultService);
      await expect(
        resultWriter.handleGenerationRuntimeTerminal({
          runtimeJobId: runtimeJob.id,
          actionRunId: runtimeJob.target_id,
          terminalResult,
        }),
      ).resolves.toEqual({
        applied: true,
        artifact: {
          object_type: 'boundary_summary_revision',
          object_id: expect.any(String),
          to_status: 'boundary_review',
        },
      });

      const completedAction = await repository.getPlanItemWorkflowQueuedAction({
        workflow_id: seeded.workflow.id,
        action_id: action.id,
      });
      expect(completedAction).toMatchObject({
        status: 'succeeded',
        codex_session_turn_id: turn!.id,
        output_capsule_digest: terminalResult.output_capsule!.digest,
        output_capsule_sequence: terminalResult.output_capsule!.sequence,
        codex_thread_id_digest: terminalResult.codex_session_thread!.codex_thread_id_digest,
      });
      await expect(repository.getPlanItemWorkflow(seeded.workflow.id)).resolves.toMatchObject({
        status: 'boundary_review',
        active_boundary_summary_revision_id: expect.any(String),
      });
      await expect(repository.listRunSessions()).resolves.toHaveLength(0);
    } finally {
      if (priorMode === undefined) {
        delete process.env.FORGELOOP_PLAN_ITEM_WORKFLOW_GENERATION_MODE;
      } else {
        process.env.FORGELOOP_PLAN_ITEM_WORKFLOW_GENERATION_MODE = priorMode;
      }
    }
  });

  it('running queued Spec Doc generation creates a draft revision and moves to review without execution', async () => {
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
      status: 'succeeded',
      output_capsule_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(response.body.queued_action).not.toHaveProperty('codex_session_id');
    expect(response.body.queued_action).not.toHaveProperty('codex_session_turn_id');
    expect(response.body.queued_action).not.toHaveProperty('output_capsule_id');
    expect(response.body.workflow.status).toBe('spec_review');
    expect(response.body.workflow.active_spec_doc_revision_id).toEqual(expect.any(String));
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const turns = await repository.listCodexSessionTurns(seeded.workflow.active_codex_session_id!);
    const turn = turns.find((candidate) => candidate.intent === 'draft_spec_doc');
    expect(turn).toMatchObject({
      workflow_id: seeded.workflow.id,
      codex_session_id: seeded.workflow.active_codex_session_id,
      intent: 'draft_spec_doc',
    });
    await expect(repository.getSpecRevision(response.body.workflow.active_spec_doc_revision_id)).resolves.toMatchObject({
      workflow_id: seeded.workflow.id,
      codex_session_id: seeded.workflow.active_codex_session_id,
      codex_session_turn_id: turn?.id,
    });
    await expect(repository.listRunSessions()).resolves.toHaveLength(0);
  });

  it('runs queued Implementation Plan Doc generation into review without marking execution ready', async () => {
    const seeded = await seedSpecReviewWorkflow(app, { idPrefix: '54545456' });
    const approval = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/spec-doc/revisions/${seeded.specRevision.id}/approve`)
      .send({ actor_id: seeded.ids.actorTech, decision_markdown: 'Spec accepted.' })
      .expect(201);
    const action = approval.body.queued_actions.find(
      (candidate: { kind: string }) => candidate.kind === 'generate_implementation_plan_doc',
    );
    expect(action).toEqual(expect.objectContaining({ status: 'queued' }));

    const response = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${action.id}/run`)
      .send({ actor_id: seeded.ids.actorTech })
      .expect(201);

    expect(response.body.queued_action).toMatchObject({
      id: action.id,
      kind: 'generate_implementation_plan_doc',
      status: 'succeeded',
      output_capsule_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(response.body.queued_action).not.toHaveProperty('codex_session_id');
    expect(response.body.queued_action).not.toHaveProperty('codex_session_turn_id');
    expect(response.body.queued_action).not.toHaveProperty('output_capsule_id');
    expect(response.body.workflow.status).toBe('implementation_plan_review');
    expect(response.body.workflow.active_implementation_plan_doc_revision_id).toEqual(expect.any(String));
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const turns = await repository.listCodexSessionTurns(seeded.workflow.active_codex_session_id!);
    const turn = turns.find((candidate) => candidate.intent === 'draft_implementation_plan_doc');
    expect(turn).toMatchObject({
      workflow_id: seeded.workflow.id,
      codex_session_id: seeded.workflow.active_codex_session_id,
      intent: 'draft_implementation_plan_doc',
    });
    await expect(repository.getExecutionPlanRevision(response.body.workflow.active_implementation_plan_doc_revision_id)).resolves.toMatchObject({
      workflow_id: seeded.workflow.id,
      codex_session_id: seeded.workflow.active_codex_session_id,
      codex_session_turn_id: turn?.id,
      based_on_spec_revision_id: seeded.specRevision.id,
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

    const planSeed = await seedWorkflow(app, { idPrefix: '55555553' });
    const initialAction = await firstQueuedAction(app, planSeed.workflow.id);
    const brainstormingRun = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${planSeed.workflow.id}/actions/${initialAction.id}/run`)
      .send({ actor_id: planSeed.ids.actorTech })
      .expect(201);
    expect(brainstormingRun.body.workflow.queued_actions).not.toContainEqual(
      expect.objectContaining({ kind: 'generate_boundary_summary', status: 'queued' }),
    );
    await expect(repository.listActivePlanItemWorkflowQueuedActions(planSeed.workflow.id)).resolves.toHaveLength(0);

    const boundaryAnswer = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${planSeed.workflow.id}/messages`)
      .send({
        actor_id: planSeed.ids.actorTech,
        action: 'answer_boundary_question',
        body_markdown: 'Scope is the workflow API and UI only.',
      })
      .expect(201);
    const secondContinuationAction = boundaryAnswer.body.queued_actions.find(
      (candidate: { kind: string; status: string }) => candidate.kind === 'continue_brainstorming' && candidate.status === 'queued',
    );
    expect(secondContinuationAction).toEqual(expect.objectContaining({ status: 'queued' }));
    const secondBrainstormingRun = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${planSeed.workflow.id}/actions/${secondContinuationAction.id}/run`)
      .send({ actor_id: planSeed.ids.actorTech })
      .expect(201);
    const boundaryAction = secondBrainstormingRun.body.workflow.queued_actions.find(
      (candidate: { kind: string; status: string }) => candidate.kind === 'generate_boundary_summary' && candidate.status === 'queued',
    );
    expect(boundaryAction).toEqual(expect.objectContaining({ status: 'queued' }));

    const boundaryRun = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${planSeed.workflow.id}/actions/${boundaryAction.id}/run`)
      .send({ actor_id: planSeed.ids.actorTech })
      .expect(201);
    const boundaryRevisionId = boundaryRun.body.workflow.active_boundary_summary_revision_id;

    const specQueue = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${planSeed.workflow.id}/artifacts/boundary-summary/revisions/${boundaryRevisionId}/approve`)
      .send({ actor_id: planSeed.ids.actorTech, decision_markdown: 'Boundary accepted.' })
      .expect(201);
    const specAction = specQueue.body.queued_actions.find(
      (candidate: { kind: string; status: string }) => candidate.kind === 'generate_spec_doc' && candidate.status === 'queued',
    );
    expect(specAction).toEqual(expect.objectContaining({ status: 'queued' }));

    const specRun = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${planSeed.workflow.id}/actions/${specAction.id}/run`)
      .send({ actor_id: planSeed.ids.actorTech })
      .expect(201);
    const specRevisionId = specRun.body.workflow.active_spec_doc_revision_id;

    const implementationPlanQueue = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${planSeed.workflow.id}/artifacts/spec-doc/revisions/${specRevisionId}/approve`)
      .send({ actor_id: planSeed.ids.actorTech, decision_markdown: 'Spec accepted.' })
      .expect(201);
    const implementationPlanAction = implementationPlanQueue.body.queued_actions.find(
      (candidate: { kind: string; status: string }) =>
        candidate.kind === 'generate_implementation_plan_doc' && candidate.status === 'queued',
    );
    expect(implementationPlanAction).toEqual(expect.objectContaining({ status: 'queued' }));

    const implementationPlanRun = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${planSeed.workflow.id}/actions/${implementationPlanAction.id}/run`)
      .send({ actor_id: planSeed.ids.actorTech })
      .expect(201);
    const implementationPlanRevisionId = implementationPlanRun.body.workflow.active_implementation_plan_doc_revision_id;

    const approval = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${planSeed.workflow.id}/artifacts/implementation-plan-doc/revisions/${implementationPlanRevisionId}/approve`)
      .send({ actor_id: planSeed.ids.actorTech, decision_markdown: 'Plan accepted.' })
      .expect(201);
    expect(approval.body.status).toBe('implementation_plan_review');
    expect(approval.body.readiness).toMatchObject({ state: 'not_evaluated', can_evaluate: true });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${planSeed.workflow.id}/execution-readiness/evaluate`)
      .send({ actor_id: planSeed.ids.actorTech, rationale_markdown: 'Check readiness after deterministic queued generation.' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('execution_ready');
        expect(body.readiness).toMatchObject({ state: 'ready', can_evaluate: false, blocker_codes: [] });
        expect(body).not.toHaveProperty('execution_package_id');
      });

    const readyWorkflow = await repository.getPlanItemWorkflow(planSeed.workflow.id);
    expect(readyWorkflow).toMatchObject({ execution_package_id: expect.any(String) });
    const executionPackage = await repository.getExecutionPackage(readyWorkflow!.execution_package_id!);
    expect(executionPackage).toMatchObject({
      id: readyWorkflow!.execution_package_id,
      development_plan_item_id: planSeed.item.id,
      workflow_id: planSeed.workflow.id,
      spec_revision_id: specRevisionId,
      execution_plan_revision_id: implementationPlanRevisionId,
      phase: 'draft',
      activity_state: 'idle',
      gate_state: 'not_submitted',
      resolution: 'none',
    });
    expect(executionPackage?.current_run_session_id).toBeUndefined();
    expect(executionPackage?.last_run_session_id).toBeUndefined();
    await expect(repository.listRunSessions()).resolves.toHaveLength(0);
  });

  it('blocks readiness when the active workflow lacks terminal capsule lineage', async () => {
    const seeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '55555557' });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/execution-readiness/evaluate`)
      .send({ actor_id: seeded.ids.actorTech, rationale_markdown: 'Check readiness.' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_execution_readiness_blocked');
        expect(body.details.blocker_codes).toContain('codex_session_capsule_lineage_missing');
      });
  });

  it('blocks readiness when approved artifacts target a stale Plan Item revision', async () => {
    const seeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '55555561' });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const currentItem = await repository.getDevelopmentPlanItem(seeded.item.id);
    if (currentItem === undefined) throw new Error('Expected seeded Plan Item');
    const nextRevisionId = `${seeded.ids.itemRevision.slice(0, -1)}9`;
    const revisedItem = {
      ...currentItem,
      revision_id: nextRevisionId,
      summary: 'Plan Item revision changed after the approved workflow artifacts.',
      updated_at: '2026-06-03T01:00:00.000Z',
    };
    await repository.saveDevelopmentPlanItem(revisedItem);
    await repository.saveDevelopmentPlanItemRevision({
      id: nextRevisionId,
      development_plan_item_id: revisedItem.id,
      development_plan_id: revisedItem.development_plan_id,
      revision_number: 2,
      snapshot: revisedItem,
      change_reason: 'regression_plan_item_revision_changed',
      edited_by_actor_id: seeded.ids.actorTech,
      created_at: '2026-06-03T01:00:00.000Z',
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/execution-readiness/evaluate`)
      .send({ actor_id: seeded.ids.actorTech, rationale_markdown: 'Check readiness after Plan Item changed.' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_execution_readiness_blocked');
        expect(body.details.blocker_codes).toContain('development_plan_item_revision_not_current');
      });
    await expect(repository.listRunSessions()).resolves.toHaveLength(0);
  });

  it('stales dependent queued actions when requesting Spec Doc changes', async () => {
    const seeded = await seedSpecReviewWorkflow(app, { idPrefix: '55555558' });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const approval = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/spec-doc/revisions/${seeded.specRevision.id}/approve`)
      .send({ actor_id: seeded.ids.actorTech, decision_markdown: 'Spec accepted.' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.queued_actions).toContainEqual(
          expect.objectContaining({ kind: 'generate_implementation_plan_doc', status: 'queued' }),
        );
      });
    const pendingAction = approval.body.queued_actions.find(
      (candidate: { kind: string }) => candidate.kind === 'generate_implementation_plan_doc',
    );

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/spec-doc/revisions/${seeded.specRevision.id}/request-changes`)
      .send({ actor_id: seeded.ids.actorTech, reason_markdown: 'Change direction while a queued action exists.' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('spec_generation_queued');
        expect(body.queued_actions).toContainEqual(expect.objectContaining({ kind: 'revise_spec_doc', status: 'queued' }));
      });
    await expect(repository.getPlanItemWorkflowQueuedAction({
      workflow_id: seeded.workflow.id,
      action_id: pendingAction.id,
    })).resolves.toMatchObject({ status: 'stale' });
  });

  it('rejects stale queued actions even when they have an existing turn binding', async () => {
    const seeded = await seedSpecReviewWorkflow(app, { idPrefix: '55555557' });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const approval = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/spec-doc/revisions/${seeded.specRevision.id}/approve`)
      .send({ actor_id: seeded.ids.actorTech, decision_markdown: 'Spec accepted.' })
      .expect(201);
    const pendingAction = approval.body.queued_actions.find(
      (candidate: { kind: string }) => candidate.kind === 'generate_implementation_plan_doc',
    );
    await repository.claimOrReplayPlanItemWorkflowQueuedActionRun({
      workflow_id: seeded.workflow.id,
      action_id: pendingAction.id,
      now: '2026-05-31T00:01:00.000Z',
    });
    const session = await repository.getCodexSession(seeded.workflow.active_codex_session_id!);
    const turnId = `${seeded.workflow.id.slice(0, -1)}7`;
    await repository.createCodexSessionTurn({
      id: `${seeded.workflow.id.slice(0, -1)}7`,
      codex_session_id: session!.id,
      workflow_id: seeded.workflow.id,
      intent: 'generate_implementation_plan_doc',
      status: 'running',
      input_digest: codexCanonicalDigest({
        workflow_id: seeded.workflow.id,
        codex_session_id: session!.id,
        plan_item_workflow_action_id: pendingAction.id,
        fixture: 'stale-action-turn',
      }),
      created_by_actor_id: seeded.ids.actorTech,
      created_at: '2026-05-31T00:01:00.000Z',
      updated_at: '2026-05-31T00:01:00.000Z',
    });
    await repository.attachPlanItemWorkflowQueuedActionTurn({
      workflow_id: seeded.workflow.id,
      action_id: pendingAction.id,
      codex_session_turn_id: turnId,
      now: '2026-05-31T00:01:01.000Z',
    });
    await repository.terminalizePlanItemWorkflowQueuedAction({
      workflow_id: seeded.workflow.id,
      action_id: pendingAction.id,
      status: 'stale',
      codex_session_turn_id: turnId,
      now: '2026-05-31T00:01:02.000Z',
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${pendingAction.id}/run`)
      .send({ actor_id: seeded.ids.actorTech })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_action_not_runnable');
      });
  });

  it('invalidates existing readiness evidence when requesting downstream artifact changes', async () => {
    const seeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '55555559' });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    await repository.saveExecutionReadinessRecord({
      id: seeded.ids.readiness,
      workflow_id: seeded.workflow.id,
      development_plan_id: seeded.workflow.development_plan_id,
      development_plan_item_id: seeded.workflow.development_plan_item_id,
      codex_session_id: seeded.workflow.active_codex_session_id!,
      approved_boundary_summary_revision_id: seeded.workflow.active_boundary_summary_revision_id!,
      approved_spec_revision_id: seeded.workflow.active_spec_doc_revision_id!,
      approved_implementation_plan_revision_id: seeded.workflow.active_implementation_plan_doc_revision_id!,
      readiness_state: 'ready',
      blocker_codes: [],
      supporting_evidence: [
        {
          object_type: 'implementation_plan_revision',
          object_id: seeded.workflow.active_implementation_plan_doc_revision_id!,
        },
      ],
      created_by_actor_id: seeded.ids.actorTech,
      created_at: '2026-06-03T00:00:00.000Z',
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/implementation-plan-doc/revisions/${seeded.implementationPlanRevision.id}/request-changes`)
      .send({ actor_id: seeded.ids.actorTech, reason_markdown: 'Refresh the handoff validation strategy.' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('implementation_plan_generation_queued');
        expect(body.queued_actions).toContainEqual(
          expect.objectContaining({ kind: 'revise_implementation_plan_doc', status: 'queued' }),
        );
      });

    await expect(repository.getExecutionReadinessRecord(seeded.ids.readiness)).resolves.toMatchObject({
      invalidated_at: expect.any(String),
      invalidated_reason: 'artifact_change_requested',
    });
  });

  it('archives stale Execution Ready package evidence when requesting downstream artifact changes', async () => {
    const seeded = await runWorkflowToExecutionReady(app, '55555562');
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const readyWorkflow = await repository.getPlanItemWorkflow(seeded.workflow.id);
    const stalePackageId = readyWorkflow?.execution_package_id;
    expect(stalePackageId).toEqual(expect.any(String));
    const draftPackage = await repository.getExecutionPackage(stalePackageId!);
    expect(draftPackage).toMatchObject({ phase: 'draft' });
    expect(draftPackage?.archived_at).toBeUndefined();
    expect(draftPackage?.deleted_at).toBeUndefined();

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/implementation-plan-doc/revisions/${seeded.implementationPlanRevisionId}/request-changes`)
      .send({ actor_id: seeded.ids.actorTech, reason_markdown: 'Refresh after Execution Ready was evaluated.' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('implementation_plan_generation_queued');
        expect(body).not.toHaveProperty('execution_package_id');
      });

    await expect(repository.getPlanItemWorkflow(seeded.workflow.id)).resolves.toMatchObject({
      execution_package_id: undefined,
    });
    const archivedPackage = await repository.getExecutionPackage(stalePackageId!);
    expect(archivedPackage).toMatchObject({
      phase: 'archived',
      archived_at: expect.any(String),
    });
    expect(archivedPackage?.current_run_session_id).toBeUndefined();
    expect(archivedPackage?.last_run_session_id).toBeUndefined();
    await expect(repository.listRunSessions()).resolves.toHaveLength(0);
  });

  it('rejects Implementation Plan Doc request-changes while any Codex action is queued', async () => {
    const seeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '55555590' });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const pendingActionId = '55555590-1111-4111-8111-111111119999';
    await repository.createOrReplayPlanItemWorkflowQueuedAction({
      id: pendingActionId,
      workflow_id: seeded.workflow.id,
      codex_session_id: seeded.workflow.active_codex_session_id!,
      kind: 'revise_implementation_plan_doc',
      status: 'queued',
      source_revision_id: seeded.implementationPlanRevision.id,
      context_preview_digest: `sha256:${'7'.repeat(64)}`,
      idempotency_key: `sha256:${'8'.repeat(64)}`,
      created_by_actor_id: seeded.ids.actorTech,
      created_at: '2026-06-03T00:00:00.000Z',
      updated_at: '2026-06-03T00:00:00.000Z',
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/implementation-plan-doc/revisions/${seeded.implementationPlanRevision.id}/request-changes`)
      .send({ actor_id: seeded.ids.actorTech, reason_markdown: 'Second change request must wait for the queued revision action.' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_action_already_pending');
      });
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
  ] as const)('does not mount old public workflow mutation route %s %s', async (method, template) => {
    const seeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '56565656' });
    const url = template
      .replace(':workflowId', seeded.workflow.id)
      .replace(':sessionId', seeded.workflow.active_codex_session_id!)
      .replace(':revisionId', seeded.implementationPlanRevision.id)
      .replace(':runSessionId', seeded.ids.readiness);

    await request(app.getHttpServer())
      [method](url)
      .send({ actor_id: seeded.ids.actorTech })
      .expect(404);
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

async function runWorkflowToExecutionReady(app: INestApplication, idPrefix: string) {
  const seeded = await seedWorkflow(app, { idPrefix });
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const initialAction = await firstQueuedAction(app, seeded.workflow.id);
  await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${initialAction.id}/run`)
    .send({ actor_id: seeded.ids.actorTech })
    .expect(201);
  await expect(repository.listActivePlanItemWorkflowQueuedActions(seeded.workflow.id)).resolves.toHaveLength(0);

  const boundaryAnswer = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/messages`)
    .send({
      actor_id: seeded.ids.actorTech,
      action: 'answer_boundary_question',
      body_markdown: 'Keep this workflow bounded to Wave 5.',
    })
    .expect(201);
  const continuationAction = boundaryAnswer.body.queued_actions.find(
    (candidate: { kind: string; status: string }) => candidate.kind === 'continue_brainstorming' && candidate.status === 'queued',
  );
  await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${continuationAction.id}/run`)
    .send({ actor_id: seeded.ids.actorTech })
    .expect(201);
  const boundaryAction = (await repository.listActivePlanItemWorkflowQueuedActions(seeded.workflow.id)).find(
    (candidate) => candidate.kind === 'generate_boundary_summary' && candidate.status === 'queued',
  );
  if (boundaryAction === undefined) throw new Error('Expected boundary summary action');
  const boundaryRun = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${boundaryAction.id}/run`)
    .send({ actor_id: seeded.ids.actorTech })
    .expect(201);
  const boundaryRevisionId = boundaryRun.body.workflow.active_boundary_summary_revision_id;

  const specQueue = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/boundary-summary/revisions/${boundaryRevisionId}/approve`)
    .send({ actor_id: seeded.ids.actorTech, decision_markdown: 'Boundary accepted.' })
    .expect(201);
  const specAction = specQueue.body.queued_actions.find(
    (candidate: { kind: string; status: string }) => candidate.kind === 'generate_spec_doc' && candidate.status === 'queued',
  );
  const specRun = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${specAction.id}/run`)
    .send({ actor_id: seeded.ids.actorTech })
    .expect(201);
  const specRevisionId = specRun.body.workflow.active_spec_doc_revision_id;

  const implementationPlanQueue = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/spec-doc/revisions/${specRevisionId}/approve`)
    .send({ actor_id: seeded.ids.actorTech, decision_markdown: 'Spec accepted.' })
    .expect(201);
  const implementationPlanAction = implementationPlanQueue.body.queued_actions.find(
    (candidate: { kind: string; status: string }) =>
      candidate.kind === 'generate_implementation_plan_doc' && candidate.status === 'queued',
  );
  const implementationPlanRun = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${implementationPlanAction.id}/run`)
    .send({ actor_id: seeded.ids.actorTech })
    .expect(201);
  const implementationPlanRevisionId = implementationPlanRun.body.workflow.active_implementation_plan_doc_revision_id;

  await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/implementation-plan-doc/revisions/${implementationPlanRevisionId}/approve`)
    .send({ actor_id: seeded.ids.actorTech, decision_markdown: 'Plan accepted.' })
    .expect(201);
  await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/execution-readiness/evaluate`)
    .send({ actor_id: seeded.ids.actorTech, rationale_markdown: 'Create the draft execution boundary.' })
    .expect(201);

  return { ...seeded, boundaryRevisionId, specRevisionId, implementationPlanRevisionId };
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

function generationTerminalResultForWorkflow(
  runtimeJob: CodexRuntimeJob,
  overrides: Partial<CodexGenerationRuntimeJobResult> = {},
): CodexGenerationRuntimeJobResult {
  const workload = runtimeJob.input_json as CodexGenerationWorkloadV1;
  const runtimeContext = workload.codex_session_runtime_context!;
  const generatedPayload = overrides.generated_payload ?? {
    schema_version: 'boundary_round_result.v1',
    session_id: 'boundary-session-1',
    round_id: 'boundary-round-1',
    questions: [],
    proposed_decisions: [],
    summary_proposal: {
      summary_markdown: 'No questions.',
      confirmed_scope: [],
      confirmed_out_of_scope: [],
      accepted_assumptions: [],
      open_risks: [],
      validation_expectations: [],
    },
    needs_leader_input: false,
    public_summary: 'No questions.',
    artifacts: [],
  };
  const outputCapsule =
    overrides.output_capsule ??
    runtimeCapsule({
      id: stableUuid({ kind: 'workflow-result-apply-capsule', runtimeJobId: runtimeJob.id }),
      codex_session_id: runtimeContext.codex_session_id,
      created_from_turn_id: runtimeContext.codex_session_turn_id,
      sequence: 1,
      digest: capsuleDigest(`capsule-${runtimeJob.id}`),
      manifest_digest: capsuleDigest(`capsule-manifest-${runtimeJob.id}`),
      codex_thread_id_digest: codexThreadIdDigest('thread-1'),
      created_by_actor_id: runtimeJob.worker_id,
    });
  const outputContinuation = {
    output_memory_bundle_ref:
      overrides.output_memory_bundle_ref ??
      `artifact://internal/codex_memory_bundle/codex_session/${outputCapsule.codex_session_id}/memory-${outputCapsule.created_from_turn_id}`,
    output_memory_bundle_digest: overrides.output_memory_bundle_digest ?? capsuleDigest(`memory-${outputCapsule.created_from_turn_id}`),
    output_environment_manifest_ref:
      overrides.output_environment_manifest_ref ??
      `artifact://internal/codex_environment_manifest/codex_session/${outputCapsule.codex_session_id}/environment-${outputCapsule.created_from_turn_id}`,
    output_environment_manifest_digest:
      overrides.output_environment_manifest_digest ?? capsuleDigest(`environment-${outputCapsule.created_from_turn_id}`),
  };
  return {
    task_kind: workload.task_kind,
    prompt_version: workload.prompt_version,
    output_schema_version: workload.output_schema_version,
    generated_payload: generatedPayload,
    generated_payload_digest: codexCanonicalDigest(generatedPayload),
    generation_artifacts: [],
    public_summary: 'Generated product artifact.',
    codex_session_thread: {
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: outputCapsule.codex_thread_id_digest,
      app_server_turn_id: `app-server-turn-${runtimeJob.id}`,
    },
    output_capsule: outputCapsule,
    ...outputContinuation,
    ...overrides,
  } as CodexGenerationRuntimeJobResult;
}

function runtimeCapsule(
  input: Pick<
    CodexRuntimeCapsule,
    | 'id'
    | 'codex_session_id'
    | 'created_from_turn_id'
    | 'sequence'
    | 'digest'
    | 'manifest_digest'
    | 'codex_thread_id_digest'
    | 'created_by_actor_id'
  > &
    Partial<CodexRuntimeCapsule>,
): CodexRuntimeCapsule {
  return {
    id: input.id,
    codex_session_id: input.codex_session_id,
    created_from_turn_id: input.created_from_turn_id,
    sequence: input.sequence,
    artifact_ref:
      input.artifact_ref ??
      `artifact://internal/codex_runtime_capsule/codex_session/${input.codex_session_id}/${input.id}`,
    digest: input.digest,
    size_bytes: input.size_bytes ?? '0',
    manifest_digest: input.manifest_digest,
    thread_state_digest: input.thread_state_digest ?? capsuleDigest(`thread-${input.id}`),
    memory_state_digest: input.memory_state_digest ?? capsuleDigest(`memory-${input.id}`),
    environment_manifest_digest: input.environment_manifest_digest ?? capsuleDigest(`environment-${input.id}`),
    codex_thread_id_digest: input.codex_thread_id_digest,
    codex_cli_version: input.codex_cli_version ?? 'test-codex',
    app_server_protocol_digest: input.app_server_protocol_digest ?? capsuleDigest(`app-server-${input.id}`),
    runtime_profile_revision_id: input.runtime_profile_revision_id ?? '54545456-1111-4111-8111-111111111402',
    trusted_runtime_manifest_digest: input.trusted_runtime_manifest_digest ?? capsuleDigest(`trusted-runtime-${input.id}`),
    credential_binding_lineage_digest: input.credential_binding_lineage_digest ?? capsuleDigest(`credential-${input.id}`),
    created_by_actor_id: input.created_by_actor_id,
    created_at: input.created_at ?? '2026-05-31T00:02:00.000Z',
  };
}

async function terminalizeRuntimeJob(
  repository: DeliveryRepository,
  runtimeJob: CodexRuntimeJob,
  terminalResult: CodexGenerationRuntimeJobResult,
  suffix: string,
) {
  const terminalAt = '2026-05-31T00:02:00.000Z';
  const sessionToken = `plan-item-workflow-session-${runtimeJob.project_id}`;
  const acceptedWorkerSessionDigest = codexCredentialPayloadDigest(sessionToken);
  const sessionKey = `plan-item-workflow-session-key-${runtimeJob.project_id}`;
  const envelope = await repository.getCodexRuntimeJobEnvelope({ runtime_job_id: runtimeJob.id });
  expect(envelope).toBeDefined();
  const launchTokenHash = String(envelope!.ciphertext).replace(/^in-memory:/, '');
  const replayProtection = (step: string) => ({
    method: 'POST' as const,
    path: `/test/product-generation-runtime/${runtimeJob.id}/${suffix}/${step}`,
    body_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, suffix, step, body: true }),
  });
  await repository.acceptCodexRuntimeJob({
    runtime_job_id: runtimeJob.id,
    worker_id: runtimeJob.worker_id,
    worker_session_token: sessionToken,
    nonce: `${suffix}-accept`,
    nonce_timestamp: terminalAt,
    accepted_worker_session_digest: acceptedWorkerSessionDigest,
    accepted_session_public_key_id: sessionKey,
    accepted_session_epoch: 1,
    idempotency_key: `${suffix}-accept`,
    request_digest: codexCanonicalDigest({ suffix, step: 'accept' }),
    replay_protection: replayProtection('accept'),
    now: terminalAt,
  });
  await repository.claimCodexLaunchTokenEnvelope({
    runtime_job_id: runtimeJob.id,
    envelope_id: envelope!.id,
    worker_id: runtimeJob.worker_id,
    worker_session_token: sessionToken,
    nonce: `${suffix}-claim-envelope`,
    nonce_timestamp: terminalAt,
    accepted_worker_session_digest: acceptedWorkerSessionDigest,
    key_id: sessionKey,
    accepted_session_epoch: 1,
    claim_request_id: `${suffix}-claim-envelope`,
    request_digest: codexCanonicalDigest({ suffix, step: 'claim-envelope' }),
    replay_protection: replayProtection('claim-envelope'),
    now: terminalAt,
  });
  await repository.materializeCodexRuntimeJob({
    runtime_job_id: runtimeJob.id,
    launch_lease_id: runtimeJob.launch_lease_id,
    worker_id: runtimeJob.worker_id,
    worker_session_token: sessionToken,
    nonce: `${suffix}-materialize`,
    nonce_timestamp: terminalAt,
    launch_token_hash: launchTokenHash,
    accepted_worker_session_digest: acceptedWorkerSessionDigest,
    accepted_session_public_key_id: sessionKey,
    accepted_session_epoch: 1,
    materialization_request_id: `${suffix}-materialize`,
    request_digest: codexCanonicalDigest({ suffix, step: 'materialize' }),
    replay_protection: replayProtection('materialize'),
    now: terminalAt,
  });
  await repository.startCodexRuntimeJob({
    runtime_job_id: runtimeJob.id,
    worker_id: runtimeJob.worker_id,
    worker_session_token: sessionToken,
    nonce: `${suffix}-start`,
    nonce_timestamp: terminalAt,
    idempotency_key: `${suffix}-start`,
    request_digest: codexCanonicalDigest({ suffix, step: 'start' }),
    runtime_evidence_digest: codexCanonicalDigest({ suffix, step: 'runtime-evidence' }),
    launch_materialization_digest: codexCanonicalDigest({ suffix, step: 'launch-materialization' }),
    replay_protection: replayProtection('start'),
    now: terminalAt,
  });
  await repository.terminalizeCodexRuntimeJob({
    runtime_job_id: runtimeJob.id,
    launch_lease_id: runtimeJob.launch_lease_id,
    worker_id: runtimeJob.worker_id,
    worker_session_token: sessionToken,
    nonce: `${suffix}-terminal`,
    nonce_timestamp: terminalAt,
    terminal_status: 'succeeded',
    reason_code: 'completed',
    terminal_result_json: terminalResult as unknown as Record<string, unknown>,
    idempotency_key: `${suffix}-terminal`,
    request_digest: codexCanonicalDigest({ suffix, step: 'terminal' }),
    replay_protection: replayProtection('terminal'),
    now: terminalAt,
  });
}

function capsuleDigest(label: string): string {
  return codexCanonicalDigest({ kind: 'test-codex-runtime-capsule-digest', label });
}

function codexThreadIdDigest(threadId: string): string {
  return codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: threadId });
}

function stableUuid(input: Record<string, unknown>): string {
  const hex = codexCanonicalDigest(input).slice('sha256:'.length);
  const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
