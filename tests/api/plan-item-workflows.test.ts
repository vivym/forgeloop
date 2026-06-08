import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY, INTERNAL_ARTIFACT_STORE_ROOT } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { ProductGenerationResultService } from '../../apps/control-plane-api/src/modules/automation/product-generation-result.service';
import { LocalInternalArtifactStore, type DeliveryRepository } from '../../packages/db/src';
import {
  workspaceBundleArchiveDigest,
  workspaceBundleManifestDigest,
} from '../../packages/codex-worker-runtime/src/workspace-bundle';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexRuntimeNetworkPolicyDigest,
  codexRuntimeProfileRevisionDigest,
  reviewPacketInputDigest,
  type CodexGenerationRuntimeJobResult,
  type CodexGenerationWorkloadV1,
  type CodexRunExecutionWorkloadV1,
  type CodexRuntimeCapsule,
  type CodexRuntimeJob,
  type CodexRuntimeProfileRevision,
  type ExecutionPackage,
  type ReviewPacketEvidenceRef,
  type RunSession,
} from '../../packages/domain/src';
import {
  idsFor,
  resolveSeededGenerationRuntimeBinding,
  seedRunExecutionRuntime,
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
        target_type: 'automation_action_run',
        target_id: expect.any(String),
        target_kind: 'generation',
        workflow_id: seeded.workflow.id,
        codex_session_id: seeded.workflow.active_codex_session_id,
        codex_session_turn_id: turn?.id,
      });
      const actionRun = await repository.getAutomationActionRun(runtimeJob!.target_id);
      expect(actionRun?.action_input_json).toMatchObject({ plan_item_workflow_action_id: action.id });
      expect(runtimeJob?.input_json).toMatchObject({ action_run_id: actionRun?.id });
      expect(runtimeJob?.input_json).not.toHaveProperty('plan_item_workflow_action_id');
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

      const runActionResponse = await request(app.getHttpServer())
        .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${action.id}/run`)
        .send({ actor_id: seeded.ids.actorTech });
      expect(runActionResponse.status, JSON.stringify(runActionResponse.body)).toBe(201);

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

  it('schedules review responses as plan item workflow action jobs even without runtime bridge mode', async () => {
    const priorMode = process.env.FORGELOOP_PLAN_ITEM_WORKFLOW_GENERATION_MODE;
    try {
      const seeded = await runWorkflowToExecutionReady(app, '54545457');
      delete process.env.FORGELOOP_PLAN_ITEM_WORKFLOW_GENERATION_MODE;
      const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
      const readyWorkflow = (await repository.getPlanItemWorkflow(seeded.workflow.id))!;
      const executionPackage = (await repository.getExecutionPackage(readyWorkflow.execution_package_id!))!;
      await seedRunExecutionRuntime(repository, seeded.ids.project, executionPackage.repo_id, seeded.ids.actorTech);
      const started = await request(app.getHttpServer())
        .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
        .send({ actor_id: seeded.ids.actorTech, idempotency_key: 'review-response-runtime-start' })
        .expect(201);
      const runSession = (await repository.getRunSession(started.body.execution_run_summary.run_session_id))!;
      const executionRuntimeJobId = runSession.runtime_metadata?.remote_runtime_job_id;
      if (executionRuntimeJobId === undefined) throw new Error('Expected run execution runtime job');
      const executionRuntimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: executionRuntimeJobId }))!;
      await terminalizeWorkflowExecutionForReviewSetup(repository, executionRuntimeJob, runSession, 'review-response-runtime-execution');
      const reviewExecutionPackage = (await repository.getExecutionPackage(executionPackage.id))!;
      await repository.saveRunSessionAttemptLineage({
        run_session_id: runSession.id,
        workflow_id: seeded.workflow.id,
        codex_session_id: executionRuntimeJob.codex_session_id!,
        attempt_kind: 'first_execution',
        created_by_actor_id: seeded.ids.actorTech,
        created_at: '2026-05-31T00:03:00.000Z',
      });
      const reviewPacket = {
        id: stableUuid({ kind: 'review-response-runtime-packet', workflowId: seeded.workflow.id }),
        workflow_id: seeded.workflow.id,
        codex_session_id: executionRuntimeJob.codex_session_id,
        codex_session_turn_id: runSession.codex_session_turn_id,
        execution_package_id: executionPackage.id,
        run_session_id: runSession.id,
        reviewer_actor_id: seeded.ids.actorTech,
        spec_revision_id: seeded.specRevisionId,
        plan_revision_id: seeded.implementationPlanRevisionId,
        status: 'completed' as const,
        decision: 'changes_requested' as const,
        summary: 'Review requests a response.',
        changed_files: [],
        check_result_summary: 'Checks passed.',
        self_review: { status: 'done', summary: 'Self review complete.' },
        risk_notes: ['Review response should be read-only.'],
        requested_changes: [{ id: 'change-1', severity: 'medium', body: 'Explain the failed assumption.' }],
        created_at: '2026-05-31T00:03:00.000Z',
        updated_at: '2026-05-31T00:03:00.000Z',
        completed_at: '2026-05-31T00:03:00.000Z',
      };
      await repository.saveReviewPacket({
        ...reviewPacket,
        current_digest: reviewPacketInputDigest({
          packet: reviewPacket,
          evidence_refs: [],
          previous_run_session_id: runSession.id,
          execution_package_id: reviewExecutionPackage.id,
          execution_package_version: reviewExecutionPackage.execution_package_version ?? reviewExecutionPackage.version,
          approved_spec_revision_id: seeded.specRevisionId,
          approved_implementation_plan_revision_id: seeded.implementationPlanRevisionId,
        }),
      });
      await repository.saveReviewResponse({
        id: stableUuid({ kind: 'review-response-runtime-existing-response', workflowId: seeded.workflow.id }),
        workflow_id: seeded.workflow.id,
        codex_session_id: executionRuntimeJob.codex_session_id!,
        codex_session_turn_id: runSession.codex_session_turn_id,
        review_packet_id: reviewPacket.id,
        previous_run_session_id: runSession.id,
        status: 'succeeded',
        content_digest: codexCanonicalDigest('Existing review response.'),
        created_by_actor_id: seeded.ids.actorTech,
        created_at: '2026-05-31T00:04:00.000Z',
        updated_at: '2026-05-31T00:04:00.000Z',
      });
      const codeReviewWorkflow = (await repository.getPlanItemWorkflow(seeded.workflow.id))!;
      const session = (await repository.getCodexSession(codeReviewWorkflow.active_codex_session_id!))!;
      const actionContextPreviewDigest = codexCanonicalDigest({
        workflow_id: codeReviewWorkflow.id,
        codex_session_id: session.id,
        development_plan_id: codeReviewWorkflow.development_plan_id,
        development_plan_item_id: codeReviewWorkflow.development_plan_item_id,
        workflow_status: codeReviewWorkflow.status,
        active_boundary_summary_revision_id: codeReviewWorkflow.active_boundary_summary_revision_id ?? null,
        active_spec_doc_revision_id: codeReviewWorkflow.active_spec_doc_revision_id ?? null,
        active_implementation_plan_doc_revision_id: codeReviewWorkflow.active_implementation_plan_doc_revision_id ?? null,
        latest_capsule_digest: session.latest_capsule_digest ?? null,
        action_kind: 'respond_to_review',
      });
      const action = await repository.createOrReplayPlanItemWorkflowQueuedAction({
        id: stableUuid({ kind: 'review-response-runtime-action', workflowId: seeded.workflow.id }),
        workflow_id: seeded.workflow.id,
        codex_session_id: session.id,
        kind: 'respond_to_review',
        status: 'queued',
        expected_input_capsule_digest: session.latest_capsule_digest!,
        context_preview_digest: actionContextPreviewDigest,
        idempotency_key: codexCanonicalDigest({ kind: 'review-response-runtime-idempotency', workflow_id: seeded.workflow.id }),
        created_by_actor_id: seeded.ids.actorTech,
        created_at: '2026-05-31T00:03:00.000Z',
        updated_at: '2026-05-31T00:03:00.000Z',
      });
      await repository.saveExecutionContinuationLineage({
        id: stableUuid({ kind: 'review-response-runtime-continuation', workflowId: seeded.workflow.id }),
        workflow_id: seeded.workflow.id,
        run_session_id: runSession.id,
        codex_session_id: executionRuntimeJob.codex_session_id!,
        queued_action_id: action.id,
        continuation_kind: 'relaunch_after_fencing',
        previous_runtime_job_id: executionRuntimeJob.id,
        new_runtime_job_id: stableUuid({ kind: 'review-response-runtime-continuation-runtime', workflowId: seeded.workflow.id }),
        previous_capsule_digest: codexCanonicalDigest({ kind: 'previous-capsule', workflow_id: seeded.workflow.id }),
        expected_input_capsule_digest: codexCanonicalDigest({ kind: 'expected-capsule', workflow_id: seeded.workflow.id }),
        previous_codex_session_lease_id: stableUuid({ kind: 'previous-session-lease', workflowId: seeded.workflow.id }),
        created_by_actor_id: seeded.ids.actorTech,
        created_at: '2026-05-31T00:03:30.000Z',
      });

      const runReviewResponseAction = await request(app.getHttpServer())
        .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${action.id}/run`)
        .send({ actor_id: seeded.ids.actorTech });
      expect(runReviewResponseAction.status, JSON.stringify(runReviewResponseAction.body)).toBe(201);
      expect(runReviewResponseAction.body.workflow.attempt_history).toEqual([
        expect.objectContaining({
          run_session_id: runSession.id,
          attempt_kind: 'first_execution',
          status: 'succeeded',
          continuation_events: [
            expect.objectContaining({
              continuation_kind: 'relaunch_after_fencing',
            }),
          ],
        }),
      ]);
      expect(runReviewResponseAction.body.workflow.latest_review_response).toMatchObject({
        review_packet_id: reviewPacket.id,
        previous_run_session_id: runSession.id,
        status: 'succeeded',
      });
      expect(runReviewResponseAction.body.workflow.recovery_options).toContainEqual(
        expect.objectContaining({
          action_id: 'abandon_new_session',
          enabled: false,
          blocker_code: 'workflow_not_blocked',
        }),
      );
      expect(JSON.stringify(runReviewResponseAction.body.workflow)).not.toContain(executionRuntimeJob.id);
      expect(JSON.stringify(runReviewResponseAction.body.workflow)).not.toContain('previous-session-lease');

      const runningAction = (await repository.getPlanItemWorkflowQueuedAction({
        workflow_id: seeded.workflow.id,
        action_id: action.id,
      }))!;
      expect(runningAction).toMatchObject({ status: 'running', kind: 'respond_to_review', codex_session_turn_id: expect.any(String) });
      const runtimeJobs = ((repository as unknown as { codexRuntimeJobs: Map<string, { job: CodexRuntimeJob }> }).codexRuntimeJobs);
      const runtimeJob = [...runtimeJobs.values()].map((record) => record.job).find((job) => job.target_id === action.id);
      expect(runtimeJob).toMatchObject({
        target_type: 'plan_item_workflow_action',
        target_kind: 'generation',
        target_id: action.id,
        workflow_id: seeded.workflow.id,
        codex_session_id: session.id,
        codex_session_turn_id: runningAction.codex_session_turn_id,
      });
      expect(runtimeJob?.input_json).toMatchObject({
        task_kind: 'review_response',
        review_packet_id: reviewPacket.id,
      });
      expect(runtimeJob?.workspace_acquisition_json).toMatchObject({
        signed_context_json: {
          previous_run_session_id: runSession.id,
          review_packet_id: reviewPacket.id,
        },
      });
      expect(await repository.getAutomationActionRun(action.id)).toBeUndefined();
    } finally {
      if (priorMode === undefined) {
        delete process.env.FORGELOOP_PLAN_ITEM_WORKFLOW_GENERATION_MODE;
      } else {
        process.env.FORGELOOP_PLAN_ITEM_WORKFLOW_GENERATION_MODE = priorMode;
      }
    }
  });

  it('rejects review response scheduling when Review Packet evidence changes after the stored digest', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545468', {
      evidenceRefs: ({ workflowId, reviewPacketId, actorId }) => [
        {
          id: stableUuid({ kind: 'review-response-runtime-evidence-stale', workflowId }),
          review_packet_id: reviewPacketId,
          workflow_id: workflowId,
          ref_kind: 'github_comment_url',
          visibility: 'public',
          display_text: 'Reviewer comment added after digest.',
          url: 'https://github.com/owner/repo/pull/7#discussion_r2',
          digest: codexCanonicalDigest({ kind: 'review-response-runtime-evidence-stale', workflowId }),
          created_by_actor_id: actorId,
          created_at: '2026-05-31T00:03:15.000Z',
        },
      ],
      currentDigest: ({ reviewPacket, runSession, executionPackage, seeded }) =>
        reviewPacketInputDigest({
          packet: reviewPacket,
          evidence_refs: [],
          previous_run_session_id: runSession.id,
          execution_package_id: executionPackage.id,
          execution_package_version: executionPackage.execution_package_version ?? executionPackage.version,
          approved_spec_revision_id: seeded.specRevisionId,
          approved_implementation_plan_revision_id: seeded.implementationPlanRevisionId,
        }),
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/actions/${fixture.action.id}/run`)
      .send({ actor_id: fixture.seeded.ids.actorTech })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_review_packet_digest_mismatch');
      });
  });

  it('rejects private IPv6 Review Packet evidence URLs before scheduling review response runtime work', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545469', {
      evidenceRefs: ({ workflowId, reviewPacketId, actorId }) => [
        {
          id: stableUuid({ kind: 'review-response-runtime-evidence-unsafe', workflowId }),
          review_packet_id: reviewPacketId,
          workflow_id: workflowId,
          ref_kind: 'github_comment_url',
          visibility: 'public',
          display_text: 'Unsafe private IPv6 URL evidence.',
          url: 'http://[fc00::1]/private-review',
          digest: codexCanonicalDigest({ kind: 'review-response-runtime-evidence-unsafe', workflowId }),
          created_by_actor_id: actorId,
          created_at: '2026-05-31T00:03:15.000Z',
        },
      ],
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/actions/${fixture.action.id}/run`)
      .send({ actor_id: fixture.seeded.ids.actorTech })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_review_packet_evidence_unsafe');
      });
  });

  it('rejects runtime-owned internal artifact evidence refs before scheduling review response runtime work', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545470', {
      evidenceRefs: ({ workflowId, reviewPacketId, actorId }) => [
        {
          id: stableUuid({ kind: 'review-response-runtime-evidence-runtime-ref', workflowId }),
          review_packet_id: reviewPacketId,
          workflow_id: workflowId,
          ref_kind: 'internal_artifact',
          visibility: 'internal',
          display_text: 'Unsafe runtime-owned internal evidence.',
          internal_object_ref: 'artifact://internal/codex_runtime_job_artifact/codex_runtime_job/runtime-job-1/generated_payload',
          digest: codexCanonicalDigest({ kind: 'review-response-runtime-evidence-runtime-ref', workflowId }),
          created_by_actor_id: actorId,
          created_at: '2026-05-31T00:03:15.000Z',
        },
      ],
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/actions/${fixture.action.id}/run`)
      .send({ actor_id: fixture.seeded.ids.actorTech })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_review_packet_evidence_unsafe');
      });
  });

  it('responds to code review through the public command without creating execution state', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545471', {
      createAction: false,
      reviewPacketPatch: {
        status: 'ready',
        decision: 'none',
        completed_at: undefined,
      },
    });
    const transitionCountBefore = (await fixture.repository.listPlanItemWorkflowTransitions(fixture.seeded.workflow.id)).length;

    const response = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/respond`)
      .send({
        actor_id: fixture.seeded.ids.actorTech,
        expected_review_packet_id: fixture.reviewPacket.id,
        expected_review_packet_digest: fixture.reviewPacket.current_digest,
        response_prompt_markdown: 'Draft a concise response for the open review packet.',
      })
      .expect(201);

    expect(response.body.status).toBe('code_review');
    expect(response.body.queued_actions).toContainEqual(
      expect.objectContaining({ kind: 'respond_to_review', status: 'running' }),
    );
    const action = (await fixture.repository.listActivePlanItemWorkflowQueuedActions(fixture.seeded.workflow.id)).find(
      (candidate) => candidate.kind === 'respond_to_review',
    );
    expect(action).toMatchObject({
      kind: 'respond_to_review',
      status: 'running',
      codex_session_turn_id: expect.any(String),
    });
    const turns = await fixture.repository.listCodexSessionTurns(fixture.seeded.workflow.active_codex_session_id!);
    expect(turns).toContainEqual(expect.objectContaining({ id: action!.codex_session_turn_id, intent: 'address_review_feedback' }));
    const runtimeJob = workflowActionRuntimeJob(fixture.repository, action!.id);
    expect(runtimeJob).toMatchObject({
      target_type: 'plan_item_workflow_action',
      target_kind: 'generation',
      target_id: action!.id,
      workflow_id: fixture.seeded.workflow.id,
      codex_session_id: fixture.seeded.workflow.active_codex_session_id,
      codex_session_turn_id: action!.codex_session_turn_id,
    });
    expect(runtimeJob?.input_json).toMatchObject({
      task_kind: 'review_response',
      review_packet_id: fixture.reviewPacket.id,
      review_packet_digest: fixture.reviewPacket.current_digest,
    });
    expect(runtimeJob?.workspace_acquisition_json).toMatchObject({
      signed_context_json: {
        review_packet_id: fixture.reviewPacket.id,
        review_packet_digest: fixture.reviewPacket.current_digest,
        response_prompt_markdown: 'Draft a concise response for the open review packet.',
      },
    });
    const runSessions = await fixture.repository.listRunSessionsForPackage(fixture.executionPackage.id);
    expect(runSessions.map((candidate) => candidate.id)).toEqual([fixture.runSession.id]);
    await expect(fixture.repository.listPlanItemWorkflowTransitions(fixture.seeded.workflow.id)).resolves.toHaveLength(transitionCountBefore);
    expect(await fixture.repository.getAutomationActionRun(action!.id)).toBeUndefined();
  });

  it('responds to in-review Review Packets through the public command', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545479', {
      createAction: false,
      reviewPacketPatch: {
        status: 'in_review',
        decision: 'none',
        completed_at: undefined,
      },
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/respond`)
      .send({
        actor_id: fixture.seeded.ids.actorTech,
        expected_review_packet_id: fixture.reviewPacket.id,
        expected_review_packet_digest: fixture.reviewPacket.current_digest,
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('code_review');
        expect(body.queued_actions).toContainEqual(expect.objectContaining({ kind: 'respond_to_review', status: 'running' }));
      });
  });

  it('responds when the current Review Packet stores no digest but the request carries the canonical digest', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545491', {
      createAction: false,
      reviewPacketPatch: {
        status: 'ready',
        decision: 'none',
        completed_at: undefined,
      },
    });
    await fixture.repository.saveReviewPacket({
      ...fixture.reviewPacket,
      current_digest: undefined,
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/respond`)
      .send({
        actor_id: fixture.seeded.ids.actorTech,
        expected_review_packet_id: fixture.reviewPacket.id,
        expected_review_packet_digest: fixture.reviewPacket.current_digest,
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('code_review');
        expect(body.queued_actions).toContainEqual(expect.objectContaining({ kind: 'respond_to_review', status: 'running' }));
      });
  });

  it('rejects review response command for completed approved Review Packets', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545472', {
      createAction: false,
      reviewPacketPatch: {
        decision: 'approved',
        requested_changes: [],
      },
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/respond`)
      .send({
        actor_id: fixture.seeded.ids.actorTech,
        expected_review_packet_id: fixture.reviewPacket.id,
        expected_review_packet_digest: fixture.reviewPacket.current_digest,
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_review_packet_not_current');
      });
  });

  it('rejects review response while another workflow action is active', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545485', {
      createAction: false,
      reviewPacketPatch: {
        status: 'ready',
        decision: 'none',
        completed_at: undefined,
      },
    });
    const session = await fixture.repository.getCodexSession(fixture.seeded.workflow.active_codex_session_id!);
    if (session === undefined) {
      throw new Error('Expected active Codex session fixture');
    }
    await fixture.repository.createOrReplayPlanItemWorkflowQueuedAction({
      id: stableUuid({ kind: 'respond-active-action-conflict', workflowId: fixture.seeded.workflow.id }),
      workflow_id: fixture.seeded.workflow.id,
      codex_session_id: session.id,
      kind: 'continue_execution',
      status: 'queued',
      expected_input_capsule_digest: session.latest_capsule_digest,
      context_preview_digest: codexCanonicalDigest({ kind: 'respond-active-action-context', workflowId: fixture.seeded.workflow.id }),
      idempotency_key: codexCanonicalDigest({ kind: 'respond-active-action-idempotency', workflowId: fixture.seeded.workflow.id }),
      created_by_actor_id: fixture.seeded.ids.actorTech,
      created_at: '2026-05-31T00:04:00.000Z',
      updated_at: '2026-05-31T00:04:00.000Z',
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/respond`)
      .send({
        actor_id: fixture.seeded.ids.actorTech,
        expected_review_packet_id: fixture.reviewPacket.id,
        expected_review_packet_digest: fixture.reviewPacket.current_digest,
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_action_already_pending');
      });
  });

  it('rejects review response when the active Codex session is not idle', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545486', {
      createAction: false,
      reviewPacketPatch: {
        status: 'ready',
        decision: 'none',
        completed_at: undefined,
      },
    });
    const session = await fixture.repository.getCodexSession(fixture.seeded.workflow.active_codex_session_id!);
    if (session === undefined) {
      throw new Error('Expected active Codex session fixture');
    }
    privatePlanItemWorkflowRepository(fixture.repository).codexSessions.set(session.id, {
      ...session,
      status: 'running',
      updated_at: '2026-05-31T00:04:00.000Z',
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/respond`)
      .send({
        actor_id: fixture.seeded.ids.actorTech,
        expected_review_packet_id: fixture.reviewPacket.id,
        expected_review_packet_digest: fixture.reviewPacket.current_digest,
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_invalid_transition');
      });
  });

  it.each([
    ['memory bundle', { latest_memory_bundle_ref: undefined }],
    ['environment manifest', { latest_environment_manifest_ref: undefined }],
  ] as const)('rejects review response when active session %s continuity input is missing', async (_label, patch) => {
    const fixture = await seedReviewResponseRuntimeAction(app, `5454548${_label === 'memory bundle' ? '7' : '8'}`, {
      createAction: false,
      reviewPacketPatch: {
        status: 'ready',
        decision: 'none',
        completed_at: undefined,
      },
    });
    const session = await fixture.repository.getCodexSession(fixture.seeded.workflow.active_codex_session_id!);
    if (session === undefined) {
      throw new Error('Expected active Codex session fixture');
    }
    privatePlanItemWorkflowRepository(fixture.repository).codexSessions.set(session.id, {
      ...session,
      ...patch,
      updated_at: '2026-05-31T00:04:00.000Z',
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/respond`)
      .send({
        actor_id: fixture.seeded.ids.actorTech,
        expected_review_packet_id: fixture.reviewPacket.id,
        expected_review_packet_digest: fixture.reviewPacket.current_digest,
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe(
          _label === 'memory bundle' ? 'codex_memory_bundle_missing' : 'codex_environment_manifest_missing',
        );
      });
  });

  it('rejects review response when latest memory lineage is stale', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545489', {
      createAction: false,
      reviewPacketPatch: {
        status: 'ready',
        decision: 'none',
        completed_at: undefined,
      },
    });
    const session = await fixture.repository.getCodexSession(fixture.seeded.workflow.active_codex_session_id!);
    if (session === undefined) {
      throw new Error('Expected active Codex session fixture');
    }
    privatePlanItemWorkflowRepository(fixture.repository).codexSessions.set(session.id, {
      ...session,
      latest_memory_bundle_digest: codexCanonicalDigest({ kind: 'stale-review-response-memory', workflowId: fixture.seeded.workflow.id }),
      updated_at: '2026-05-31T00:04:00.000Z',
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/respond`)
      .send({
        actor_id: fixture.seeded.ids.actorTech,
        expected_review_packet_id: fixture.reviewPacket.id,
        expected_review_packet_digest: fixture.reviewPacket.current_digest,
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('codex_runtime_capsule_stale');
      });
  });

  it('replays the same review response command while the first response action is running', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545474', {
      createAction: false,
      reviewPacketPatch: {
        status: 'ready',
        decision: 'none',
        completed_at: undefined,
      },
    });

    const first = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/respond`)
      .send({
        actor_id: fixture.seeded.ids.actorTech,
        idempotency_key: 'same-respond-command',
        expected_review_packet_id: fixture.reviewPacket.id,
        expected_review_packet_digest: fixture.reviewPacket.current_digest,
      })
      .expect(201);

    const firstActionId = first.body.queued_actions.find(
      (candidate: { kind: string }) => candidate.kind === 'respond_to_review',
    )?.id;

    const replay = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/respond`)
      .send({
        actor_id: fixture.seeded.ids.actorTech,
        idempotency_key: 'same-respond-command',
        expected_review_packet_id: fixture.reviewPacket.id,
        expected_review_packet_digest: fixture.reviewPacket.current_digest,
      });
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect(replay.body.queued_actions).toContainEqual(
      expect.objectContaining({ id: firstActionId, kind: 'respond_to_review', status: 'running' }),
    );
    const activeActions = await fixture.repository.listActivePlanItemWorkflowQueuedActions(fixture.seeded.workflow.id);
    expect(activeActions.filter((candidate) => candidate.kind === 'respond_to_review')).toHaveLength(1);
  });

  it('replays a terminal review response command without creating a second action or runtime job', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545484', {
      createAction: false,
      reviewPacketPatch: {
        status: 'ready',
        decision: 'none',
        completed_at: undefined,
      },
    });
    const commandBody = {
      actor_id: fixture.seeded.ids.actorTech,
      idempotency_key: 'same-respond-command-terminal',
      expected_review_packet_id: fixture.reviewPacket.id,
      expected_review_packet_digest: fixture.reviewPacket.current_digest,
    };

    const first = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/respond`)
      .send(commandBody)
      .expect(201);
    const actionId = first.body.queued_actions.find((candidate: { kind: string }) => candidate.kind === 'respond_to_review')?.id;
    expect(actionId).toEqual(expect.any(String));
    const runtimeJob = workflowActionRuntimeJob(fixture.repository, actionId);
    expect(runtimeJob).toBeDefined();

    const terminalCapsuleDigest = capsuleDigest('respond-terminal-replay-output-capsule');
    await fixture.repository.terminalizePlanItemWorkflowQueuedAction({
      workflow_id: fixture.seeded.workflow.id,
      action_id: actionId,
      status: 'succeeded',
      output_capsule_id: stableUuid({ kind: 'respond-terminal-replay-output-capsule' }),
      output_capsule_digest: terminalCapsuleDigest,
      output_capsule_sequence: 100,
      codex_thread_id_digest: codexThreadIdDigest('thread-1'),
      now: '2026-05-31T00:05:00.000Z',
    });
    privatePlanItemWorkflowRepository(fixture.repository).codexRuntimeJobs.set(runtimeJob!.id, {
      job: {
        ...runtimeJob!,
        status: 'terminal',
        terminal_status: 'succeeded',
        terminal_reason_code: 'completed',
        finished_at: '2026-05-31T00:05:00.000Z',
        updated_at: '2026-05-31T00:05:00.000Z',
      },
    });
    await fixture.repository.saveReviewResponse({
      id: stableUuid({ kind: 'respond-terminal-replay-review-response', workflowId: fixture.seeded.workflow.id }),
      workflow_id: fixture.seeded.workflow.id,
      codex_session_id: fixture.seeded.workflow.active_codex_session_id!,
      codex_session_turn_id: runtimeJob!.codex_session_turn_id!,
      review_packet_id: fixture.reviewPacket.id,
      previous_run_session_id: fixture.runSession.id,
      status: 'succeeded',
      content_digest: codexCanonicalDigest('Review response generated.'),
      created_by_actor_id: fixture.seeded.ids.actorTech,
      created_at: '2026-05-31T00:05:00.000Z',
      updated_at: '2026-05-31T00:05:00.000Z',
    });
    privatePlanItemWorkflowRepository(fixture.repository).codexSessions.set(fixture.seeded.workflow.active_codex_session_id!, {
      ...(await fixture.repository.getCodexSession(fixture.seeded.workflow.active_codex_session_id!))!,
      status: 'idle',
      latest_capsule_id: stableUuid({ kind: 'respond-terminal-replay-output-capsule' }),
      latest_capsule_digest: terminalCapsuleDigest,
      latest_memory_bundle_ref: `artifact://internal/codex_memory_bundle/codex_session/${fixture.seeded.workflow.active_codex_session_id}/memory-terminal-replay`,
      latest_memory_bundle_digest: capsuleDigest('respond-terminal-replay-memory'),
      latest_environment_manifest_ref: `artifact://internal/codex_environment_manifest/codex_session/${fixture.seeded.workflow.active_codex_session_id}/env-terminal-replay`,
      latest_environment_manifest_digest: capsuleDigest('respond-terminal-replay-env'),
      updated_at: '2026-05-31T00:05:00.000Z',
    });

    await expect(
      fixture.repository.getPlanItemWorkflowQueuedAction({
        workflow_id: fixture.seeded.workflow.id,
        action_id: actionId,
      }),
    ).resolves.toMatchObject({ id: actionId, status: 'succeeded' });
    const latestSession = await fixture.repository.getCodexSession(fixture.seeded.workflow.active_codex_session_id!);
    expect(latestSession?.status).toBe('idle');
    expect(latestSession?.latest_capsule_digest).toBe(terminalCapsuleDigest);

    const replay = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/respond`)
      .send(commandBody)
      .expect(201);
    expect(replay.body.queued_actions).toContainEqual(
      expect.objectContaining({ id: actionId, kind: 'respond_to_review', status: 'succeeded' }),
    );
    const responseActions = (await fixture.repository.listPlanItemWorkflowQueuedActions(fixture.seeded.workflow.id)).filter(
      (action) => action.kind === 'respond_to_review',
    );
    expect(responseActions).toEqual([expect.objectContaining({ id: actionId, status: 'succeeded' })]);
    const runtimeJobs = Array.from(privatePlanItemWorkflowRepository(fixture.repository).codexRuntimeJobs.values())
      .map((record) => record.job)
      .filter((job) => job.target_type === 'plan_item_workflow_action' && job.target_id === actionId);
    expect(runtimeJobs).toHaveLength(1);
    expect(runtimeJobs[0]).toMatchObject({ id: runtimeJob!.id, status: 'terminal' });
  });

  it('requests a review fix by creating a new run execution attempt in the same Codex session', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545473', {
      createAction: false,
      evidenceRefs: ({ workflowId, reviewPacketId, actorId }) => [
        {
          id: stableUuid({ kind: 'request-fix-evidence', workflowId }),
          review_packet_id: reviewPacketId,
          workflow_id: workflowId,
          ref_kind: 'github_comment_url',
          visibility: 'public',
          display_text: 'Reviewer requested a focused fix.',
          url: 'https://github.com/owner/repo/pull/7#discussion_r3',
          digest: codexCanonicalDigest({ kind: 'request-fix-evidence', workflowId }),
          created_by_actor_id: actorId,
          created_at: '2026-05-31T00:03:15.000Z',
        },
      ],
    });
    await fixture.repository.saveReviewResponse({
      id: stableUuid({ kind: 'request-fix-review-response', workflowId: fixture.seeded.workflow.id }),
      workflow_id: fixture.seeded.workflow.id,
      codex_session_id: fixture.seeded.workflow.active_codex_session_id!,
      codex_session_turn_id: fixture.runSession.codex_session_turn_id!,
      review_packet_id: fixture.reviewPacket.id,
      previous_run_session_id: fixture.runSession.id,
      status: 'succeeded',
      content_digest: codexCanonicalDigest('Addressed review response.'),
      created_by_actor_id: fixture.seeded.ids.actorTech,
      created_at: '2026-05-31T00:04:00.000Z',
      updated_at: '2026-05-31T00:04:00.000Z',
    });

    const response = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/request-fix`)
      .send({
        actor_id: fixture.seeded.ids.actorTech,
        expected_review_packet_id: fixture.reviewPacket.id,
        expected_review_packet_digest: fixture.reviewPacket.current_digest,
        fix_instruction_markdown: 'Apply only the requested review fix.',
      });
    expect(response.status, JSON.stringify(response.body)).toBe(201);

    expect(response.body.status).toBe('execution_running');
    expect(response.body.attempt_history).toContainEqual(
      expect.objectContaining({
        attempt_kind: 'review_fix',
        previous_run_session_id: fixture.runSession.id,
        previous_review_packet_id: fixture.reviewPacket.id,
      }),
    );
    const runSessions = await fixture.repository.listRunSessionsForPackage(fixture.executionPackage.id);
    expect(runSessions).toHaveLength(2);
    const fixRunSession = runSessions.find((candidate) => candidate.id !== fixture.runSession.id);
    expect(fixRunSession).toMatchObject({
      workflow_id: fixture.seeded.workflow.id,
      codex_session_id: fixture.seeded.workflow.active_codex_session_id,
      executor_type: 'local_codex',
    });
    expect(fixRunSession?.run_spec?.review_context).toMatchObject({
      latest_decision: 'changes_requested',
      review_packet_id: fixture.reviewPacket.id,
      review_packet_digest: fixture.reviewPacket.current_digest,
      previous_run_session_id: fixture.runSession.id,
      approved_spec_revision_id: fixture.seeded.specRevisionId,
      approved_implementation_plan_revision_id: fixture.seeded.implementationPlanRevisionId,
      execution_package_id: fixture.executionPackage.id,
      execution_package_version: fixture.executionPackage.execution_package_version ?? fixture.executionPackage.version,
      path_policy_digest: codexCanonicalDigest({
        allowed_paths: fixture.executionPackage.allowed_paths,
        forbidden_paths: fixture.executionPackage.forbidden_paths,
        source_mutation_policy: fixture.executionPackage.source_mutation_policy,
      }),
      evidence_refs: [
        {
          id: fixture.evidenceRefs[0]!.id,
          ref_kind: 'github_comment_url',
          display_text: 'Reviewer requested a focused fix.',
          digest: fixture.evidenceRefs[0]!.digest,
        },
      ],
      review_response_ids: [expect.any(String)],
      requested_changes: [
        {
          title: 'Review change',
          description: 'Explain the failed assumption.',
          severity: 'major',
        },
      ],
    });
    const runtimeJobId = fixRunSession?.runtime_metadata?.remote_runtime_job_id;
    expect(runtimeJobId).toEqual(expect.any(String));
    const runtimeJob = await fixture.repository.getCodexRuntimeJob({ runtime_job_id: runtimeJobId! });
    expect(runtimeJob).toMatchObject({ target_kind: 'run_execution', target_type: 'run_session', target_id: fixRunSession!.id });
    const workload = runtimeJob?.input_json as CodexRunExecutionWorkloadV1;
    expect(workload).toMatchObject({
      run_session_id: fixRunSession!.id,
      previous_run_session_id: fixture.runSession.id,
      previous_review_packet_id: fixture.reviewPacket.id,
      review_packet_digest: fixture.reviewPacket.current_digest,
      signed_context_json: {
        schema_version: 'review_fix_context.v1',
        review_packet_id: fixture.reviewPacket.id,
        review_packet_digest: fixture.reviewPacket.current_digest,
        previous_run_session_id: fixture.runSession.id,
        fix_instruction_markdown: 'Apply only the requested review fix.',
      },
      codex_session_runtime_context: {
        codex_session_id: fixture.seeded.workflow.active_codex_session_id,
        expected_input_capsule_digest: fixture.seeded.workflow.active_codex_session_id
          ? (await fixture.repository.getCodexSession(fixture.seeded.workflow.active_codex_session_id))?.latest_capsule_digest
          : undefined,
        continuation: { kind: 'resume_thread' },
      },
    });
    await expect(fixture.repository.getReviewPacket(fixture.reviewPacket.id)).resolves.toMatchObject({
      id: fixture.reviewPacket.id,
      run_session_id: fixture.runSession.id,
    });
  });

  it('replays a completed review fix command through command idempotency', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545475', { createAction: false });

    const commandBody = {
      actor_id: fixture.seeded.ids.actorTech,
      idempotency_key: 'request-fix-replay',
      expected_review_packet_id: fixture.reviewPacket.id,
      expected_review_packet_digest: fixture.reviewPacket.current_digest,
      fix_instruction_markdown: 'Replay should return the original fix run.',
    };
    const first = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/request-fix`)
      .send(commandBody)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/request-fix`)
      .send(commandBody)
      .expect(200);

    expect(second.body.execution_run_summary).toMatchObject({
      run_session_id: first.body.execution_run_summary.run_session_id,
      input_capsule_digest: first.body.execution_run_summary.input_capsule_digest,
      workspace_bundle_digest: first.body.execution_run_summary.workspace_bundle_digest,
      codex_thread_id_digest: first.body.execution_run_summary.codex_thread_id_digest,
    });
    const runSessions = await fixture.repository.listRunSessionsForPackage(fixture.executionPackage.id);
    expect(runSessions.filter((candidate) => candidate.id !== fixture.runSession.id)).toHaveLength(1);
  });

  it('rejects completed review fix replay when the idempotency key is reused with different preconditions', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545490', { createAction: false });

    const commandBody = {
      actor_id: fixture.seeded.ids.actorTech,
      idempotency_key: 'request-fix-replay-precondition-drift',
      expected_review_packet_id: fixture.reviewPacket.id,
      expected_review_packet_digest: fixture.reviewPacket.current_digest,
      fix_instruction_markdown: 'Replay drift should not be accepted.',
    };
    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/request-fix`)
      .send(commandBody)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/request-fix`)
      .send({
        ...commandBody,
        expected_review_packet_digest: `sha256:${'9'.repeat(64)}`,
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_execution_recovery_required');
      });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/request-fix`)
      .send({
        ...commandBody,
        fix_instruction_markdown: 'Changed instruction must not replay the original fix.',
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_execution_recovery_required');
      });
  });

  it('rejects review fix while another workflow action is active', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545480', { createAction: false });
    const session = await fixture.repository.getCodexSession(fixture.seeded.workflow.active_codex_session_id!);
    if (session === undefined) {
      throw new Error('Expected active Codex session fixture');
    }
    await fixture.repository.createOrReplayPlanItemWorkflowQueuedAction({
      id: stableUuid({ kind: 'request-fix-active-action', workflowId: fixture.seeded.workflow.id }),
      workflow_id: fixture.seeded.workflow.id,
      codex_session_id: session.id,
      kind: 'respond_to_review',
      status: 'queued',
      expected_input_capsule_digest: session.latest_capsule_digest,
      context_preview_digest: codexCanonicalDigest({ kind: 'request-fix-active-action-context', workflowId: fixture.seeded.workflow.id }),
      idempotency_key: codexCanonicalDigest({ kind: 'request-fix-active-action-idempotency', workflowId: fixture.seeded.workflow.id }),
      created_by_actor_id: fixture.seeded.ids.actorTech,
      created_at: '2026-05-31T00:04:00.000Z',
      updated_at: '2026-05-31T00:04:00.000Z',
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/request-fix`)
      .send({
        actor_id: fixture.seeded.ids.actorTech,
        expected_review_packet_id: fixture.reviewPacket.id,
        expected_review_packet_digest: fixture.reviewPacket.current_digest,
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_action_already_pending');
      });
  });

  it('rejects review fix when the changes-requested packet has no requested changes', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545481', {
      createAction: false,
      reviewPacketPatch: {
        requested_changes: [],
      },
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/request-fix`)
      .send({
        actor_id: fixture.seeded.ids.actorTech,
        expected_review_packet_id: fixture.reviewPacket.id,
        expected_review_packet_digest: fixture.reviewPacket.current_digest,
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_review_packet_not_current');
      });
  });

  it('rejects review fix when the previous run session is not terminal', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545482', { createAction: false });
    mutateRunSession(fixture.repository, fixture.runSession.id, { status: 'running' });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/request-fix`)
      .send({
        actor_id: fixture.seeded.ids.actorTech,
        expected_review_packet_id: fixture.reviewPacket.id,
        expected_review_packet_digest: fixture.reviewPacket.current_digest,
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_invalid_transition');
      });
  });

  it('builds review fix RunSpec from the current execution package policy instead of the previous run spec', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545483', { createAction: false });
    const currentRequiredChecks = [
      {
        check_id: 'review-fix-current-check',
        display_name: 'Current review fix check',
        command: 'pnpm test',
        timeout_seconds: 180,
        blocks_review: true,
      },
    ];
    mutateExecutionPackage(fixture.repository, fixture.executionPackage.id, {
      allowed_paths: ['apps/control-plane-api/src/modules/plan-item-workflows/**'],
      forbidden_paths: ['legacy/**'],
      required_checks: currentRequiredChecks,
    });

    const response = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/request-fix`)
      .send({
        actor_id: fixture.seeded.ids.actorTech,
        expected_review_packet_id: fixture.reviewPacket.id,
        expected_review_packet_digest: fixture.reviewPacket.current_digest,
      });
    expect(response.status, JSON.stringify(response.body)).toBe(201);

    const fixRunSession = await fixture.repository.getRunSession(response.body.execution_run_summary.run_session_id);
    expect(fixRunSession?.run_spec).toMatchObject({
      allowed_paths: ['apps/control-plane-api/src/modules/plan-item-workflows/**'],
      forbidden_paths: ['legacy/**'],
      required_checks: currentRequiredChecks,
      context: { required_checks: currentRequiredChecks },
      review_context: {
        required_checks: currentRequiredChecks,
        path_policy_digest: codexCanonicalDigest({
          allowed_paths: ['apps/control-plane-api/src/modules/plan-item-workflows/**'],
          forbidden_paths: ['legacy/**'],
          source_mutation_policy: fixture.executionPackage.source_mutation_policy,
        }),
      },
    });
    const runtimeJobId = fixRunSession?.runtime_metadata?.remote_runtime_job_id;
    const runtimeJob = runtimeJobId === undefined ? undefined : await fixture.repository.getCodexRuntimeJob({ runtime_job_id: runtimeJobId });
    expect(runtimeJob?.input_json).toMatchObject({
      required_checks_digest: codexCanonicalDigest(currentRequiredChecks),
    });
  });

  it('rejects review fix when the execution package no longer belongs to the active workflow session', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545476', { createAction: false });
    mutateExecutionPackage(fixture.repository, fixture.executionPackage.id, {
      codex_session_id: stableUuid({ kind: 'foreign-session', workflowId: fixture.seeded.workflow.id }),
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/request-fix`)
      .send({
        actor_id: fixture.seeded.ids.actorTech,
        expected_review_packet_id: fixture.reviewPacket.id,
        expected_review_packet_digest: fixture.reviewPacket.current_digest,
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_evidence_not_owned');
      });
  });

  it('rejects review fix when latest memory lineage is stale', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545478', { createAction: false });
    const session = await fixture.repository.getCodexSession(fixture.seeded.workflow.active_codex_session_id!);
    if (session === undefined) {
      throw new Error('Expected active Codex session fixture');
    }
    privatePlanItemWorkflowRepository(fixture.repository).codexSessions.set(session.id, {
      ...session,
      latest_memory_bundle_digest: codexCanonicalDigest({ kind: 'stale-review-fix-memory', workflowId: fixture.seeded.workflow.id }),
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/request-fix`)
      .send({
        actor_id: fixture.seeded.ids.actorTech,
        expected_review_packet_id: fixture.reviewPacket.id,
        expected_review_packet_digest: fixture.reviewPacket.current_digest,
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('codex_runtime_capsule_stale');
      });
  });

  it('does not carry failed review responses into review fix lineage', async () => {
    const fixture = await seedReviewResponseRuntimeAction(app, '54545477', { createAction: false });
    await fixture.repository.saveReviewResponse({
      id: stableUuid({ kind: 'request-fix-failed-review-response', workflowId: fixture.seeded.workflow.id }),
      workflow_id: fixture.seeded.workflow.id,
      codex_session_id: fixture.seeded.workflow.active_codex_session_id!,
      codex_session_turn_id: fixture.runSession.codex_session_turn_id!,
      review_packet_id: fixture.reviewPacket.id,
      previous_run_session_id: fixture.runSession.id,
      status: 'failed',
      content_digest: codexCanonicalDigest('Failed review response.'),
      created_by_actor_id: fixture.seeded.ids.actorTech,
      created_at: '2026-05-31T00:04:00.000Z',
      updated_at: '2026-05-31T00:04:00.000Z',
    });

    const response = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${fixture.seeded.workflow.id}/code-review/request-fix`)
      .send({
        actor_id: fixture.seeded.ids.actorTech,
        expected_review_packet_id: fixture.reviewPacket.id,
        expected_review_packet_digest: fixture.reviewPacket.current_digest,
      })
      .expect(201);

    const fixRunSession = await fixture.repository.getRunSession(response.body.execution_run_summary.run_session_id);
    expect(fixRunSession?.run_spec?.review_context?.review_response_ids).toEqual([]);
    const attemptHistory = await fixture.repository.listRunSessionAttemptLineage(fixture.seeded.workflow.id);
    const reviewFixAttempt = attemptHistory.find((attempt) => attempt.run_session_id === fixRunSession?.id);
    expect(reviewFixAttempt).toMatchObject({ attempt_kind: 'review_fix' });
    expect(reviewFixAttempt).not.toHaveProperty('review_response_id');
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
      .get(`/query/development-plans/${planSeed.plan.id}/items/${planSeed.item.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.plan_item_workflow).toMatchObject({
          id: planSeed.workflow.id,
          status: 'implementation_plan_review',
          readiness: { state: 'not_evaluated', can_evaluate: true, blocker_codes: [] },
        });
      });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${planSeed.workflow.id}/execution-readiness/evaluate`)
      .send({ actor_id: planSeed.ids.actorTech, rationale_markdown: 'Check readiness after deterministic queued generation.' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('execution_ready');
        expect(body.readiness).toMatchObject({ state: 'ready', can_evaluate: false, blocker_codes: [] });
        expect(body).not.toHaveProperty('execution_package_id');
      });

    await request(app.getHttpServer())
      .get(`/query/development-plans/${planSeed.plan.id}/items/${planSeed.item.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.plan_item_workflow).toMatchObject({
          id: planSeed.workflow.id,
          status: 'execution_ready',
          readiness: { state: 'ready', can_evaluate: false, blocker_codes: [] },
        });
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

  it('rejects execution start unless the workflow is execution_ready', async () => {
    const seeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '56565651' });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
      .send({ actor_id: seeded.ids.actorTech, idempotency_key: 'start-execution-1' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_invalid_transition');
      });
  });

  it('starts workflow-owned execution exactly once and returns only digest-level continuity evidence', async () => {
    const seeded = await runWorkflowToExecutionReady(app, '56565652');
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const readyWorkflow = await repository.getPlanItemWorkflow(seeded.workflow.id);
    const readyExecutionPackage = await repository.getExecutionPackage(readyWorkflow!.execution_package_id!);
    await seedRunExecutionRuntime(repository, seeded.ids.project, readyExecutionPackage!.repo_id, seeded.ids.actorTech, {
      environment: 'local_dogfood',
    });

    const first = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
      .send({ actor_id: seeded.ids.actorTech, idempotency_key: 'start-execution-1' })
      .expect(201);

    expect(first.body).toMatchObject({
      status: 'execution_running',
      session: expect.objectContaining({ continuity_state: 'running' }),
      execution_run_summary: {
        run_session_id: expect.any(String),
        input_capsule_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        codex_thread_id_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
    expect(first.body.execution_run_summary).not.toHaveProperty('execution_package_id');
    expect(first.body.execution_run_summary).not.toHaveProperty('runtime_job_id');
    expect(first.body.execution_run_summary).not.toHaveProperty('codex_session_turn_id');
    expect(JSON.stringify(first.body)).not.toContain('codex_thread_id":"');
    expect(JSON.stringify(first.body)).not.toContain('artifact://internal');
    expect(JSON.stringify(first.body)).not.toContain('lease-token');

    const second = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
      .send({ actor_id: seeded.ids.actorTech, idempotency_key: 'start-execution-1' })
      .expect(200);

    expect(second.body.execution_run_summary).toEqual(first.body.execution_run_summary);
    await request(app.getHttpServer())
      .get(`/query/development-plans/${seeded.plan.id}/items/${seeded.item.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.plan_item_workflow).toMatchObject({
          id: seeded.workflow.id,
          status: 'execution_running',
          execution_run_summary: {
            run_session_id: first.body.execution_run_summary.run_session_id,
            status: 'queued',
            execution_package_version: first.body.execution_run_summary.execution_package_version,
            input_capsule_digest: first.body.execution_run_summary.input_capsule_digest,
            workspace_bundle_digest: first.body.execution_run_summary.workspace_bundle_digest,
            codex_thread_id_digest: first.body.execution_run_summary.codex_thread_id_digest,
          },
        });
        expect(body.plan_item_workflow.execution_run_summary).not.toHaveProperty('execution_package_id');
        expect(body.plan_item_workflow.execution_run_summary).not.toHaveProperty('runtime_job_id');
        expect(body.plan_item_workflow.execution_run_summary).not.toHaveProperty('codex_session_turn_id');
        expect(JSON.stringify(body.plan_item_workflow)).not.toMatch(/codex_thread_id":"|artifact:\/\/internal|lease-token|credential_binding_id/i);
      });
    const runSessions = await repository.listRunSessions();
    const workflowRuns = runSessions.filter((runSession) => runSession.workflow_id === seeded.workflow.id);
    expect(workflowRuns).toHaveLength(1);
    expect(workflowRuns[0]).toMatchObject({
      id: first.body.execution_run_summary.run_session_id,
      status: 'queued',
      runtime_metadata: {
        environment: 'local_dogfood',
        credential_binding_id: expect.any(String),
        credential_binding_version_id: expect.any(String),
      },
    });
    const activeSession = await repository.getCodexSession(seeded.workflow.active_codex_session_id!);
    expect(activeSession?.credential_binding_id).not.toBe(workflowRuns[0]?.runtime_metadata?.credential_binding_id);
    const turns = await repository.listCodexSessionTurns(seeded.workflow.active_codex_session_id!);
    expect(turns.filter((turn) => turn.intent === 'execute_plan')).toHaveLength(1);
    const publicRunSession = await repository.getRunSession(first.body.execution_run_summary.run_session_id);
    const runtimeJobId = publicRunSession?.runtime_metadata?.remote_runtime_job_id;
    const executionTurnId = publicRunSession?.codex_session_turn_id;
    expect(runtimeJobId).toEqual(expect.any(String));
    expect(executionTurnId).toEqual(expect.any(String));
      const runtimeJob = await repository.getCodexRuntimeJob({ runtime_job_id: runtimeJobId! });
      expect(runtimeJob).toMatchObject({
        target_kind: 'run_execution',
        workflow_id: seeded.workflow.id,
        codex_session_id: seeded.workflow.active_codex_session_id,
        codex_session_turn_id: executionTurnId,
      });
      const workload = runtimeJob?.input_json as {
        execution_package_version: number;
        package_prompt_digest: string;
        execution_context_digest: string;
        workspace_bundle_digest: string;
        workspace_acquisition_json: {
          archive_ref: string;
          archive_digest: string;
          manifest_digest: string;
        };
        codex_session_runtime_context: {
          lease_id: string;
          lease_epoch: number;
          worker_id: string;
          worker_session_digest: string;
          continuation: {
            codex_thread_id_digest: string;
          };
        };
        codex_session_terminalization: {
          codex_session_lease_id: string;
          codex_session_lease_epoch: number;
          codex_session_worker_id: string;
          codex_session_worker_session_digest: string;
        };
      };
      expect(workload).toMatchObject({
        plan_item_workflow_id: seeded.workflow.id,
        codex_session_runtime_context: {
          continuation: {
            kind: 'resume_thread',
            codex_thread_id_digest: first.body.execution_run_summary.codex_thread_id_digest,
          },
        },
      });
      expect(workload.codex_session_runtime_context.lease_id).toBe(runtimeJob?.launch_lease_id);
      expect(workload.codex_session_terminalization.codex_session_lease_id).not.toBe(runtimeJob?.launch_lease_id);
      expect(workload.codex_session_terminalization.codex_session_lease_epoch).toBe(workload.codex_session_runtime_context.lease_epoch);
      expect(workload.codex_session_terminalization.codex_session_worker_id).toBe(workload.codex_session_runtime_context.worker_id);
      expect(workload.codex_session_terminalization.codex_session_worker_session_digest).toBe(
        workload.codex_session_runtime_context.worker_session_digest,
      );
      const startedExecutionPackage = await repository.getExecutionPackage(readyExecutionPackage!.id);
      expect(startedExecutionPackage).toMatchObject({
        phase: 'execution',
        activity_state: 'ai_running',
        version: workload.execution_package_version,
      });
      const artifactStore = new LocalInternalArtifactStore({
        root: app.get(INTERNAL_ARTIFACT_STORE_ROOT) as string,
        repository,
        requestId: 'plan-item-workflow-execution-test',
      });
      const storedBundle = await artifactStore.getObject(workload.workspace_acquisition_json.archive_ref);
      const archive = JSON.parse(Buffer.from(storedBundle.bytes).toString('utf8')) as {
        manifest: {
          entries: Array<{ path: string; digest: string; size_bytes: number; type: string }>;
        };
        entries: Array<{ path: string; type: string; content_base64: string }>;
      };
      expect(workspaceBundleArchiveDigest(storedBundle.bytes)).toBe(workload.workspace_bundle_digest);
      expect(workspaceBundleManifestDigest(archive.manifest)).toBe(workload.workspace_acquisition_json.manifest_digest);
      expect(workload.workspace_acquisition_json.archive_digest).toBe(workload.workspace_bundle_digest);
      const bundleEntries = new Map(
        archive.entries.map((entry) => [entry.path, Buffer.from(entry.content_base64, 'base64').toString('utf8')]),
      );
      const packagePrompt = bundleEntries.get('.forgeloop/codex-runtime/package-prompt.txt');
      if (packagePrompt === undefined) {
        throw new Error('Expected run execution package prompt in workspace bundle');
      }
      const executionContext = JSON.parse(bundleEntries.get('.forgeloop/codex-runtime/execution-context.json') ?? 'null') as {
        schema_version: string;
        run_spec: {
          run_session_id: string;
          execution_package_id: string;
          expected_package_version: number;
          repo: { local_path: string };
        };
      };
      expect(packagePrompt).toContain(`Objective: ${startedExecutionPackage?.objective}`);
      expect(codexCanonicalDigest(packagePrompt)).toBe(workload.package_prompt_digest);
      expect(executionContext).toMatchObject({
        schema_version: 'codex_run_execution_context.v1',
        run_spec: {
          run_session_id: first.body.execution_run_summary.run_session_id,
          execution_package_id: startedExecutionPackage?.id,
          expected_package_version: startedExecutionPackage?.version,
          repo: { local_path: '/workspace' },
        },
      });
      expect(codexCanonicalDigest(executionContext)).toBe(workload.execution_context_digest);
      expect(JSON.stringify(archive.manifest)).not.toContain('package_policy_digest');
      expect(JSON.stringify(archive.manifest)).not.toContain('workspace_policy_digest');

      const events = await repository.listTraceEventsForSubject('plan_item_workflow', seeded.workflow.id);
    const startAuditEvent = events.find((event) => event.event_type === 'workflow_execution_started');
    expect(startAuditEvent?.payload).toMatchObject({
      workflow_id: seeded.workflow.id,
      plan_item_id: seeded.item.id,
      repo_binding_id: seeded.ids.repo,
      codex_session_id: seeded.workflow.active_codex_session_id,
      codex_session_turn_id: executionTurnId,
      run_session_id: first.body.execution_run_summary.run_session_id,
      runtime_job_id: runtimeJobId,
      input_capsule_digest: first.body.execution_run_summary.input_capsule_digest,
      codex_thread_id_digest: first.body.execution_run_summary.codex_thread_id_digest,
    });
    expect(startAuditEvent?.payload.credential_binding_id).toBe(workflowRuns[0]?.runtime_metadata?.credential_binding_id);
    expect(startAuditEvent?.payload.credential_binding_version_id).toBe(
      workflowRuns[0]?.runtime_metadata?.credential_binding_version_id,
    );
    expect(startAuditEvent?.payload).not.toMatchObject({
      credential_binding_id: activeSession?.credential_binding_id,
      credential_binding_version_id: activeSession?.credential_binding_version_id,
    });
    expect(JSON.stringify(startAuditEvent)).not.toContain('codex_thread_id":"');
    expect(JSON.stringify(startAuditEvent)).not.toContain('artifact://internal');
    expect(JSON.stringify(startAuditEvent)).not.toContain('lease-token');
    expect(JSON.stringify(startAuditEvent)).not.toContain('auth_json');
  });

  it('continues waiting execution by appending input to the existing runtime job', async () => {
    const started = await startWorkflowOwnedExecution(app, '56565670');
    await saveRunSessionStatus(started.repository, started.runSession, 'waiting_for_input');
    overwriteRuntimeJob(started.repository, started.runtimeJob.id, { status: 'running' });
    const beforeJobIds = workflowRunExecutionRuntimeJobIds(started.repository, started.workflow.id);

    const response = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${started.workflow.id}/execution/continue`)
      .send({
        actor_id: started.seeded.ids.actorTech,
        idempotency_key: 'continue-waiting-input',
        input_markdown: 'The implementation can continue with the approved scope.',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      status: 'execution_running',
      execution_run_summary: {
        run_session_id: started.runSession.id,
        status: 'resuming',
      },
    });
    expect(JSON.stringify(response.body)).not.toContain(started.runtimeJob.id);
    expect(workflowRunExecutionRuntimeJobIds(started.repository, started.workflow.id)).toEqual(beforeJobIds);

    const [lineage] = await started.repository.listExecutionContinuationLineage(started.workflow.id);
    expect(lineage).toMatchObject({
      run_session_id: started.runSession.id,
      continuation_kind: 'existing_job_input',
      previous_runtime_job_id: started.runtimeJob.id,
      previous_capsule_digest: started.runtimeJobInputCapsuleDigest,
      expected_input_capsule_digest: started.session.latest_capsule_digest,
    });
    expect(lineage).not.toHaveProperty('new_runtime_job_id');
    const action = (await started.repository.listPlanItemWorkflowQueuedActions(started.workflow.id)).find(
      (candidate) => candidate.kind === 'continue_execution',
    );
    expect(action).toMatchObject({ status: 'succeeded' });
    const commands = privateRunCommands(started.repository).filter((command) => command.run_session_id === started.runSession.id);
    expect(commands).toContainEqual(
      expect.objectContaining({
        command_type: 'input',
        status: 'pending',
        target_turn_id: started.runSession.codex_session_turn_id,
        payload: expect.objectContaining({
          message: 'The implementation can continue with the approved scope.',
          input_markdown: 'The implementation can continue with the approved scope.',
        }),
      }),
    );
  });

  it('replays a completed continue execution idempotency key without duplicating input commands', async () => {
    const started = await startWorkflowOwnedExecution(app, '56565680');
    await saveRunSessionStatus(started.repository, started.runSession, 'waiting_for_input');
    overwriteRuntimeJob(started.repository, started.runtimeJob.id, { status: 'running' });
    const body = {
      actor_id: started.seeded.ids.actorTech,
      idempotency_key: 'continue-waiting-input-replay',
      input_markdown: 'Continue once only.',
    };

    await request(app.getHttpServer()).post(`/plan-item-workflows/${started.workflow.id}/execution/continue`).send(body).expect(201);
    const commandsAfterFirst = privateRunCommands(started.repository).filter(
      (command) => command.run_session_id === started.runSession.id && command.command_type === 'input',
    );
    const lineagesAfterFirst = await started.repository.listExecutionContinuationLineage(started.workflow.id);
    await request(app.getHttpServer()).post(`/plan-item-workflows/${started.workflow.id}/execution/continue`).send(body).expect(201);

    const commandsAfterSecond = privateRunCommands(started.repository).filter(
      (command) => command.run_session_id === started.runSession.id && command.command_type === 'input',
    );
    const lineagesAfterSecond = await started.repository.listExecutionContinuationLineage(started.workflow.id);
    expect(commandsAfterSecond).toEqual(commandsAfterFirst);
    expect(lineagesAfterSecond).toEqual(lineagesAfterFirst);
  });

  it('fails closed when active continuation runtime job targets an older capsule', async () => {
    const started = await startWorkflowOwnedExecution(app, '56565681');
    await saveRunSessionStatus(started.repository, started.runSession, 'waiting_for_input');
    overwriteRuntimeJob(started.repository, started.runtimeJob.id, { status: 'running' });
    await advanceSessionLatestCapsuleDigest(started.repository, started.session.id, 'latest-capsule-after-runtime-job');

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${started.workflow.id}/execution/continue`)
      .send({
        actor_id: started.seeded.ids.actorTech,
        idempotency_key: 'continue-old-capsule-active-job',
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_execution_recovery_required');
      });

    await expect(started.repository.listExecutionContinuationLineage(started.workflow.id)).resolves.toHaveLength(0);
  });

  it('fails closed when active continuation turn or worker session ownership is stale', async () => {
    const staleTurn = await startWorkflowOwnedExecution(app, '56565682');
    await saveRunSessionStatus(staleTurn.repository, staleTurn.runSession, 'resuming');
    overwriteRuntimeJob(staleTurn.repository, staleTurn.runtimeJob.id, { status: 'materializing' });
    markCodexSessionTurnStatus(staleTurn.repository, staleTurn.runSession.codex_session_turn_id!, 'succeeded');

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${staleTurn.workflow.id}/execution/continue`)
      .send({
        actor_id: staleTurn.seeded.ids.actorTech,
        idempotency_key: 'continue-stale-turn',
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_execution_recovery_required');
      });

    const staleWorkerSession = await startWorkflowOwnedExecution(app, '56565683');
    await saveRunSessionStatus(staleWorkerSession.repository, staleWorkerSession.runSession, 'resuming');
    overwriteRuntimeJob(staleWorkerSession.repository, staleWorkerSession.runtimeJob.id, { status: 'materializing' });
    mutateCodexSessionLeaseForRuntimeJob(staleWorkerSession.repository, staleWorkerSession.runtimeJob, {
      worker_session_digest: codexCanonicalDigest({ stale: 'worker-session-digest' }),
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${staleWorkerSession.workflow.id}/execution/continue`)
      .send({
        actor_id: staleWorkerSession.seeded.ids.actorTech,
        idempotency_key: 'continue-stale-worker-session',
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_execution_recovery_required');
      });
  });

  it('rejects waiting execution when the runtime job is not running', async () => {
    const started = await startWorkflowOwnedExecution(app, '56565671');
    await saveRunSessionStatus(started.repository, started.runSession, 'waiting_for_input');
    overwriteRuntimeJob(started.repository, started.runtimeJob.id, { status: 'materializing' });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${started.workflow.id}/execution/continue`)
      .send({
        actor_id: started.seeded.ids.actorTech,
        idempotency_key: 'continue-waiting-materializing',
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_execution_not_ready_for_input');
      });

    await expect(started.repository.listExecutionContinuationLineage(started.workflow.id)).resolves.toHaveLength(0);
  });

  it('blocks stalled continuation while the previous writer can still terminalize', async () => {
    const started = await startWorkflowOwnedExecution(app, '56565677');
    await saveRunSessionStatus(started.repository, started.runSession, 'stalled');
    overwriteRuntimeJob(started.repository, started.runtimeJob.id, { status: 'running' });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${started.workflow.id}/execution/continue`)
      .send({
        actor_id: started.seeded.ids.actorTech,
        idempotency_key: 'continue-stalled-writer-active',
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_execution_writer_still_active');
      });

    await expect(started.repository.listExecutionContinuationLineage(started.workflow.id)).resolves.toHaveLength(0);
  });

  it('relaunches stalled execution after the previous writer is fenced', async () => {
    const started = await startWorkflowOwnedExecution(app, '56565672');
    await saveRunSessionStatus(started.repository, started.runSession, 'stalled');
    await makePreviousExecutionWriterRecoverable(started.repository, started.runtimeJob, started.runSession, 'failed');
    const beforeJobIds = workflowRunExecutionRuntimeJobIds(started.repository, started.workflow.id);

    const response = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${started.workflow.id}/execution/continue`)
      .send({
        actor_id: started.seeded.ids.actorTech,
        idempotency_key: 'continue-stalled-relaunch',
      })
      .expect(201);

    const updatedRunSession = await started.repository.getRunSession(started.runSession.id);
    expect(updatedRunSession).toMatchObject({
      id: started.runSession.id,
      status: 'resuming',
      codex_session_id: started.session.id,
      codex_session_turn_id: expect.any(String),
    });
    const afterJobIds = workflowRunExecutionRuntimeJobIds(started.repository, started.workflow.id);
    expect(afterJobIds).toHaveLength(beforeJobIds.length + 1);
    const newRuntimeJobId = updatedRunSession?.runtime_metadata?.remote_runtime_job_id;
    expect(newRuntimeJobId).toEqual(expect.any(String));
    expect(newRuntimeJobId).not.toBe(started.runtimeJob.id);
    const newRuntimeJob = await started.repository.getCodexRuntimeJob({ runtime_job_id: newRuntimeJobId! });
    const workload = newRuntimeJob?.input_json as {
      run_session_id: string;
      codex_session_runtime_context: {
        codex_session_id: string;
        codex_session_turn_id: string;
        expected_input_capsule_digest: string;
        continuation: { kind: string; codex_thread_id_digest: string };
      };
    };
    expect(workload).toMatchObject({
      run_session_id: started.runSession.id,
      codex_session_runtime_context: {
        codex_session_id: started.session.id,
        codex_session_turn_id: updatedRunSession?.codex_session_turn_id,
        expected_input_capsule_digest: started.session.latest_capsule_digest,
        continuation: {
          kind: 'resume_thread',
          codex_thread_id_digest: started.session.codex_thread_id_digest,
        },
      },
    });
    expect(response.body.execution_run_summary).toMatchObject({
      run_session_id: started.runSession.id,
      status: 'resuming',
      input_capsule_digest: started.session.latest_capsule_digest,
    });

    const [lineage] = await started.repository.listExecutionContinuationLineage(started.workflow.id);
    expect(lineage).toMatchObject({
      continuation_kind: 'relaunch_after_fencing',
      previous_runtime_job_id: started.runtimeJob.id,
      new_runtime_job_id: newRuntimeJobId,
      previous_capsule_digest: started.runtimeJobInputCapsuleDigest,
      expected_input_capsule_digest: started.session.latest_capsule_digest,
    });
    const action = (await started.repository.listPlanItemWorkflowQueuedActions(started.workflow.id)).find(
      (candidate) => candidate.kind === 'continue_execution',
    );
    expect(action).toMatchObject({ status: 'succeeded', codex_session_turn_id: updatedRunSession?.codex_session_turn_id });
  });

  it('relaunches stalled execution when the run-worker lease is still active but expired', async () => {
    const started = await startWorkflowOwnedExecution(app, '56565684');
    await saveRunSessionStatus(started.repository, started.runSession, 'stalled');
    overwriteRuntimeJob(started.repository, started.runtimeJob.id, {
      status: 'terminal',
      terminal_status: 'failed',
      terminal_at: '2026-06-03T03:01:00.000Z',
    });
    expireCodexSessionLeaseForRuntimeJob(started.repository, started.runtimeJob);
    expireCodexLaunchLease(started.repository, started.runtimeJob.launch_lease_id);
    expireRunWorkerLeaseWithoutStatusMutation(started.repository, started.runSession.id);

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${started.workflow.id}/execution/continue`)
      .send({
        actor_id: started.seeded.ids.actorTech,
        idempotency_key: 'continue-stalled-expired-active-run-worker-lease',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.execution_run_summary).toMatchObject({
          run_session_id: started.runSession.id,
          status: 'resuming',
        });
      });

    const [lineage] = await started.repository.listExecutionContinuationLineage(started.workflow.id);
    expect(lineage).toMatchObject({
      continuation_kind: 'relaunch_after_fencing',
      previous_runtime_job_id: started.runtimeJob.id,
      previous_run_worker_lease_id: expect.any(String),
    });
  });

  it('relaunches terminal resuming execution after the previous continuation writer is fenced', async () => {
    const started = await startWorkflowOwnedExecution(app, '56565678');
    await saveRunSessionStatus(started.repository, started.runSession, 'resuming');
    await makePreviousExecutionWriterRecoverable(started.repository, started.runtimeJob, started.runSession, 'failed');

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${started.workflow.id}/execution/continue`)
      .send({
        actor_id: started.seeded.ids.actorTech,
        idempotency_key: 'continue-resuming-relaunch',
      })
      .expect(201);

    const updatedRunSession = await started.repository.getRunSession(started.runSession.id);
    const [lineage] = await started.repository.listExecutionContinuationLineage(started.workflow.id);
    expect(updatedRunSession).toMatchObject({
      id: started.runSession.id,
      status: 'resuming',
      codex_session_turn_id: expect.any(String),
    });
    expect(updatedRunSession?.runtime_metadata?.remote_runtime_job_id).not.toBe(started.runtimeJob.id);
    expect(lineage).toMatchObject({
      continuation_kind: 'relaunch_after_fencing',
      previous_runtime_job_id: started.runtimeJob.id,
      new_runtime_job_id: updatedRunSession?.runtime_metadata?.remote_runtime_job_id,
    });
  });

  it('replays current resuming execution without creating a replacement runtime job', async () => {
    const started = await startWorkflowOwnedExecution(app, '56565673');
    await saveRunSessionStatus(started.repository, started.runSession, 'resuming');
    overwriteRuntimeJob(started.repository, started.runtimeJob.id, { status: 'materializing' });
    const beforeJobIds = workflowRunExecutionRuntimeJobIds(started.repository, started.workflow.id);

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${started.workflow.id}/execution/continue`)
      .send({
        actor_id: started.seeded.ids.actorTech,
        idempotency_key: 'continue-resuming-replay',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.execution_run_summary).toMatchObject({
          run_session_id: started.runSession.id,
          status: 'resuming',
        });
      });

    expect(workflowRunExecutionRuntimeJobIds(started.repository, started.workflow.id)).toEqual(beforeJobIds);
    const [lineage] = await started.repository.listExecutionContinuationLineage(started.workflow.id);
    expect(lineage).toMatchObject({
      continuation_kind: 'replay_current_continuation',
      previous_runtime_job_id: started.runtimeJob.id,
      previous_capsule_digest: started.runtimeJobInputCapsuleDigest,
      expected_input_capsule_digest: started.session.latest_capsule_digest,
    });
    expect(lineage).not.toHaveProperty('new_runtime_job_id');
  });

  it('rejects continuation from unlisted active run states', async () => {
    const started = await startWorkflowOwnedExecution(app, '56565679');
    await saveRunSessionStatus(started.repository, started.runSession, 'running');
    overwriteRuntimeJob(started.repository, started.runtimeJob.id, { status: 'running' });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${started.workflow.id}/execution/continue`)
      .send({
        actor_id: started.seeded.ids.actorTech,
        idempotency_key: 'continue-running-unlisted-state',
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_execution_not_ready_for_input');
      });

    await expect(started.repository.listExecutionContinuationLineage(started.workflow.id)).resolves.toHaveLength(0);
  });

  it('keeps cancel_requested executions pending unless explicit recovery is safe and confirmed', async () => {
    const pending = await startWorkflowOwnedExecution(app, '56565674');
    await saveRunSessionStatus(pending.repository, pending.runSession, 'cancel_requested');
    await makePreviousExecutionWriterRecoverable(pending.repository, pending.runtimeJob, pending.runSession, 'cancelled');
    markCodexSessionTurnStatus(pending.repository, pending.runSession.codex_session_turn_id!, 'cancelled');

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${pending.workflow.id}/execution/continue`)
      .send({
        actor_id: pending.seeded.ids.actorTech,
        idempotency_key: 'continue-cancel-without-confirmation',
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_execution_cancel_pending');
      });

    const unsafe = await startWorkflowOwnedExecution(app, '56565675');
    await saveRunSessionStatus(unsafe.repository, unsafe.runSession, 'cancel_requested');
    overwriteRuntimeJob(unsafe.repository, unsafe.runtimeJob.id, { status: 'running' });
    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${unsafe.workflow.id}/execution/continue`)
      .send({
        actor_id: unsafe.seeded.ids.actorTech,
        idempotency_key: 'continue-cancel-writer-active',
        cancel_recovery_decision: 'recover_instead_of_accept_cancel',
        cancel_recovery_confirmation_phrase: 'recover cancelled execution',
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_execution_cancel_pending');
      });

    const recoverable = await startWorkflowOwnedExecution(app, '56565676');
    await saveRunSessionStatus(recoverable.repository, recoverable.runSession, 'cancel_requested');
    await makePreviousExecutionWriterRecoverable(recoverable.repository, recoverable.runtimeJob, recoverable.runSession, 'cancelled');
    markCodexSessionTurnStatus(recoverable.repository, recoverable.runSession.codex_session_turn_id!, 'cancelled');

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${recoverable.workflow.id}/execution/continue`)
      .send({
        actor_id: recoverable.seeded.ids.actorTech,
        idempotency_key: 'continue-cancel-recover',
        cancel_recovery_decision: 'recover_instead_of_accept_cancel',
        cancel_recovery_confirmation_phrase: 'recover cancelled execution',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.execution_run_summary).toMatchObject({
          run_session_id: recoverable.runSession.id,
          status: 'resuming',
        });
      });

    const [lineage] = await recoverable.repository.listExecutionContinuationLineage(recoverable.workflow.id);
    expect(lineage).toMatchObject({
      continuation_kind: 'relaunch_after_fencing',
      previous_runtime_job_id: recoverable.runtimeJob.id,
      new_runtime_job_id: expect.any(String),
    });
  });

  it('fails closed instead of projecting execution supervision without runtime-job lineage', async () => {
    const seeded = await runWorkflowToExecutionReady(app, '56565658');
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const readyWorkflow = await repository.getPlanItemWorkflow(seeded.workflow.id);
    const readyExecutionPackage = await repository.getExecutionPackage(readyWorkflow!.execution_package_id!);
    await seedRunExecutionRuntime(repository, seeded.ids.project, readyExecutionPackage!.repo_id, seeded.ids.actorTech, {
      environment: 'local_dogfood',
    });

    const started = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
      .send({ actor_id: seeded.ids.actorTech, idempotency_key: 'start-execution-lineage-missing' })
      .expect(201);

    const runSession = await repository.getRunSession(started.body.execution_run_summary.run_session_id);
    if (runSession === undefined) throw new Error('Expected started run session');
    await repository.saveRunSession({
      ...runSession,
      runtime_metadata: {
        ...runSession.runtime_metadata,
        remote_runtime_job_id: undefined,
      },
      updated_at: '2026-06-06T00:20:00.000Z',
    });

    await request(app.getHttpServer())
      .get(`/query/development-plans/${seeded.plan.id}/items/${seeded.item.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.plan_item_workflow).toMatchObject({
          id: seeded.workflow.id,
          status: 'execution_running',
        });
        expect(body.plan_item_workflow.execution_run_summary).toBeUndefined();
      });
  });

  it('prefers repo-scoped run execution credentials over project-wide fallback credentials', async () => {
    const seeded = await runWorkflowToExecutionReady(app, '56565665');
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const readyWorkflow = await repository.getPlanItemWorkflow(seeded.workflow.id);
    const readyExecutionPackage = await repository.getExecutionPackage(readyWorkflow!.execution_package_id!);
    await seedRunExecutionRuntime(repository, seeded.ids.project, readyExecutionPackage!.repo_id, seeded.ids.actorTech);
    const projectWideCredential = await createRunExecutionCredentialBinding(repository, {
      projectId: seeded.ids.project,
      actorId: seeded.ids.actorTech,
      suffix: 'project-wide-fallback',
    });

    const response = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
      .send({ actor_id: seeded.ids.actorTech, idempotency_key: 'start-execution-repo-scoped-credential' })
      .expect(201);

    const runSession = await repository.getRunSession(response.body.execution_run_summary.run_session_id);
    expect(runSession?.runtime_metadata?.credential_binding_id).toBe(
      stableUuid({ kind: 'plan-item-workflow-run-credential-binding', projectId: seeded.ids.project }),
    );
    expect(runSession?.runtime_metadata?.credential_binding_id).not.toBe(projectWideCredential.credentialBindingId);
  });

  it('fails closed when run execution credential selection has multiple same-priority candidates', async () => {
    const seeded = await runWorkflowToExecutionReady(app, '56565666');
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const readyWorkflow = await repository.getPlanItemWorkflow(seeded.workflow.id);
    const readyExecutionPackage = await repository.getExecutionPackage(readyWorkflow!.execution_package_id!);
    await seedRunExecutionRuntime(repository, seeded.ids.project, readyExecutionPackage!.repo_id, seeded.ids.actorTech);
    await createRunExecutionCredentialBinding(repository, {
      projectId: seeded.ids.project,
      repoId: readyExecutionPackage!.repo_id,
      actorId: seeded.ids.actorTech,
      suffix: 'duplicate-repo-scoped',
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
      .send({ actor_id: seeded.ids.actorTech, idempotency_key: 'start-execution-ambiguous-credential' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_runtime_binding_unavailable');
      });

    await expect(repository.getPlanItemWorkflow(seeded.workflow.id)).resolves.toMatchObject({ status: 'execution_ready' });
    const workflowRuns = (await repository.listRunSessions()).filter((runSession) => runSession.workflow_id === seeded.workflow.id);
    expect(workflowRuns).toHaveLength(0);
    const turns = await repository.listCodexSessionTurns(seeded.workflow.active_codex_session_id!);
    expect(turns.filter((turn) => turn.intent === 'execute_plan')).toHaveLength(0);
  });

  it('rejects duplicate execution start when the existing runtime job is no longer active', async () => {
    const seeded = await runWorkflowToExecutionReady(app, '56565657');
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const readyWorkflow = await repository.getPlanItemWorkflow(seeded.workflow.id);
    const readyExecutionPackage = await repository.getExecutionPackage(readyWorkflow!.execution_package_id!);
    await seedRunExecutionRuntime(repository, seeded.ids.project, readyExecutionPackage!.repo_id, seeded.ids.actorTech);

    const started = await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
      .send({ actor_id: seeded.ids.actorTech, idempotency_key: 'start-execution-terminal-gap' })
      .expect(201);

    const startedRunSession = await repository.getRunSession(started.body.execution_run_summary.run_session_id);
    const runtimeJobId = startedRunSession?.runtime_metadata?.remote_runtime_job_id;
    expect(runtimeJobId).toEqual(expect.any(String));
    const runtimeJob = await repository.getCodexRuntimeJob({ runtime_job_id: runtimeJobId! });
    if (runtimeJob === undefined) throw new Error('Expected runtime job');
    const privateRepository = repository as unknown as {
      codexRuntimeJobs: Map<string, { job: unknown }>;
    };
    const privateRecord = privateRepository.codexRuntimeJobs.get(runtimeJobId!);
    if (privateRecord === undefined) throw new Error('Expected private runtime job record');
    privateRepository.codexRuntimeJobs.set(runtimeJobId!, {
      ...privateRecord,
      job: {
        ...runtimeJob,
        status: 'terminal',
        terminal_status: 'failed',
        terminal_at: '2026-06-03T02:20:00.000Z',
        updated_at: '2026-06-03T02:20:00.000Z',
      },
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
      .send({ actor_id: seeded.ids.actorTech, idempotency_key: 'start-execution-terminal-gap-retry' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_execution_recovery_required');
      });

    const workflowRuns = (await repository.listRunSessions()).filter((runSession) => runSession.workflow_id === seeded.workflow.id);
    expect(workflowRuns).toHaveLength(1);
    const turns = await repository.listCodexSessionTurns(seeded.workflow.active_codex_session_id!);
    expect(turns.filter((turn) => turn.intent === 'execute_plan')).toHaveLength(1);
  });

  it('rejects execution start when active session memory continuity input is missing', async () => {
    const seeded = await runWorkflowToExecutionReady(app, '56565653');
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const readyWorkflow = await repository.getPlanItemWorkflow(seeded.workflow.id);
    const readyExecutionPackage = await repository.getExecutionPackage(readyWorkflow!.execution_package_id!);
    await seedRunExecutionRuntime(repository, seeded.ids.project, readyExecutionPackage!.repo_id, seeded.ids.actorTech);

    const session = await repository.getCodexSession(seeded.workflow.active_codex_session_id!);
    expect(session?.latest_memory_bundle_ref).toEqual(expect.any(String));
    expect(session?.latest_environment_manifest_ref).toEqual(expect.any(String));
    (repository as unknown as { codexSessions: Map<string, unknown> }).codexSessions.set(session!.id, {
      ...session!,
      latest_memory_bundle_ref: undefined,
      updated_at: new Date().toISOString(),
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
      .send({ actor_id: seeded.ids.actorTech, idempotency_key: 'start-execution-missing-continuity' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_evidence_missing');
      });

    await expect(repository.getPlanItemWorkflow(seeded.workflow.id)).resolves.toMatchObject({ status: 'execution_ready' });
    const workflowRuns = (await repository.listRunSessions()).filter((runSession) => runSession.workflow_id === seeded.workflow.id);
    expect(workflowRuns).toHaveLength(0);
    const turns = await repository.listCodexSessionTurns(seeded.workflow.active_codex_session_id!);
    expect(turns.filter((turn) => turn.intent === 'execute_plan')).toHaveLength(0);
    const events = await repository.listTraceEventsForSubject('plan_item_workflow', seeded.workflow.id);
    expect(events.some((event) => event.event_type === 'workflow_execution_started')).toBe(false);
  });

  it('rejects execution start when active session environment continuity input is missing', async () => {
    const seeded = await runWorkflowToExecutionReady(app, '56565654');
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const readyWorkflow = await repository.getPlanItemWorkflow(seeded.workflow.id);
    const readyExecutionPackage = await repository.getExecutionPackage(readyWorkflow!.execution_package_id!);
    await seedRunExecutionRuntime(repository, seeded.ids.project, readyExecutionPackage!.repo_id, seeded.ids.actorTech);

    const session = await repository.getCodexSession(seeded.workflow.active_codex_session_id!);
    expect(session?.latest_memory_bundle_ref).toEqual(expect.any(String));
    expect(session?.latest_environment_manifest_ref).toEqual(expect.any(String));
    (repository as unknown as { codexSessions: Map<string, unknown> }).codexSessions.set(session!.id, {
      ...session!,
      latest_environment_manifest_ref: undefined,
      updated_at: new Date().toISOString(),
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
      .send({ actor_id: seeded.ids.actorTech, idempotency_key: 'start-execution-missing-env-continuity' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_evidence_missing');
      });

    await expect(repository.getPlanItemWorkflow(seeded.workflow.id)).resolves.toMatchObject({ status: 'execution_ready' });
    const workflowRuns = (await repository.listRunSessions()).filter((runSession) => runSession.workflow_id === seeded.workflow.id);
    expect(workflowRuns).toHaveLength(0);
    const turns = await repository.listCodexSessionTurns(seeded.workflow.active_codex_session_id!);
    expect(turns.filter((turn) => turn.intent === 'execute_plan')).toHaveLength(0);
    const events = await repository.listTraceEventsForSubject('plan_item_workflow', seeded.workflow.id);
    expect(events.some((event) => event.event_type === 'workflow_execution_started')).toBe(false);
  });

  it('rejects execution start when the approved Implementation Plan lacks Codex turn provenance', async () => {
    const seeded = await runWorkflowToExecutionReady(app, '56565662');
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const implementationPlanRevision = await repository.getExecutionPlanRevision(seeded.implementationPlanRevisionId);
    if (implementationPlanRevision === undefined) throw new Error('Expected Implementation Plan revision');
    const { codex_session_turn_id: _droppedProvenanceTurn, ...revisionWithoutProvenanceTurn } = implementationPlanRevision;
    (repository as unknown as { executionPlanRevisions: Map<string, unknown> }).executionPlanRevisions.set(
      implementationPlanRevision.id,
      revisionWithoutProvenanceTurn,
    );
    const readyWorkflow = await repository.getPlanItemWorkflow(seeded.workflow.id);
    const readyExecutionPackage = await repository.getExecutionPackage(readyWorkflow!.execution_package_id!);
    await seedRunExecutionRuntime(repository, seeded.ids.project, readyExecutionPackage!.repo_id, seeded.ids.actorTech);

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
      .send({ actor_id: seeded.ids.actorTech, idempotency_key: 'start-execution-missing-package-provenance-turn' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_evidence_not_owned');
      });

    await expect(repository.getPlanItemWorkflow(seeded.workflow.id)).resolves.toMatchObject({ status: 'execution_ready' });
    const workflowRuns = (await repository.listRunSessions()).filter((runSession) => runSession.workflow_id === seeded.workflow.id);
    expect(workflowRuns).toHaveLength(0);
  });

  it('rejects execution start when the approved Implementation Plan has blank Codex turn provenance', async () => {
    const seeded = await runWorkflowToExecutionReady(app, '56565663');
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const implementationPlanRevision = await repository.getExecutionPlanRevision(seeded.implementationPlanRevisionId);
    if (implementationPlanRevision === undefined) throw new Error('Expected Implementation Plan revision');
    (repository as unknown as { executionPlanRevisions: Map<string, unknown> }).executionPlanRevisions.set(implementationPlanRevision.id, {
      ...implementationPlanRevision,
      codex_session_turn_id: '   ',
    });
    const readyWorkflow = await repository.getPlanItemWorkflow(seeded.workflow.id);
    const readyExecutionPackage = await repository.getExecutionPackage(readyWorkflow!.execution_package_id!);
    await seedRunExecutionRuntime(repository, seeded.ids.project, readyExecutionPackage!.repo_id, seeded.ids.actorTech);

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
      .send({ actor_id: seeded.ids.actorTech, idempotency_key: 'start-execution-blank-package-provenance-turn' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_evidence_not_owned');
      });

    await expect(repository.getPlanItemWorkflow(seeded.workflow.id)).resolves.toMatchObject({ status: 'execution_ready' });
    const workflowRuns = (await repository.listRunSessions()).filter((runSession) => runSession.workflow_id === seeded.workflow.id);
    expect(workflowRuns).toHaveLength(0);
  });

  it('rejects execution start when Implementation Plan Codex turn provenance belongs to another workflow', async () => {
    const seeded = await runWorkflowToExecutionReady(app, '56565664');
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const readyWorkflow = await repository.getPlanItemWorkflow(seeded.workflow.id);
    const implementationPlanRevision = await repository.getExecutionPlanRevision(seeded.implementationPlanRevisionId);
    if (readyWorkflow === undefined || implementationPlanRevision === undefined) throw new Error('Expected ready workflow and plan revision');
    const provenanceTurn = await repository.getCodexSessionTurn(implementationPlanRevision.codex_session_turn_id!);
    if (provenanceTurn === undefined) throw new Error('Expected Implementation Plan provenance turn');
    (repository as unknown as { codexSessionTurns: Map<string, unknown> }).codexSessionTurns.set(provenanceTurn.id, {
      ...provenanceTurn,
      workflow_id: '56565664-1111-4111-8111-111111111798',
    });
    const readyExecutionPackage = await repository.getExecutionPackage(readyWorkflow.execution_package_id!);
    await seedRunExecutionRuntime(repository, seeded.ids.project, readyExecutionPackage!.repo_id, seeded.ids.actorTech);

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
      .send({ actor_id: seeded.ids.actorTech, idempotency_key: 'start-execution-cross-workflow-package-provenance-turn' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_evidence_not_owned');
      });

    await expect(repository.getPlanItemWorkflow(seeded.workflow.id)).resolves.toMatchObject({ status: 'execution_ready' });
    const workflowRuns = (await repository.listRunSessions()).filter((runSession) => runSession.workflow_id === seeded.workflow.id);
    expect(workflowRuns).toHaveLength(0);
  });

  it('rejects execution start when Plan Item planning content changed after readiness', async () => {
    const seeded = await runWorkflowToExecutionReady(app, '56565655');
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const readyWorkflow = await repository.getPlanItemWorkflow(seeded.workflow.id);
    const readyExecutionPackage = await repository.getExecutionPackage(readyWorkflow!.execution_package_id!);
    await seedRunExecutionRuntime(repository, seeded.ids.project, readyExecutionPackage!.repo_id, seeded.ids.actorTech);

    const currentItem = await repository.getDevelopmentPlanItem(seeded.item.id);
    if (currentItem === undefined) throw new Error('Expected seeded Plan Item');
    const nextRevisionId = `${currentItem.revision_id.slice(0, -1)}8`;
    const revisedItem = {
      ...currentItem,
      revision_id: nextRevisionId,
      summary: `${currentItem.summary} Updated after readiness.`,
      updated_at: '2026-06-03T02:00:00.000Z',
    };
    await repository.saveDevelopmentPlanItem(revisedItem);
    await repository.saveDevelopmentPlanItemRevision({
      id: nextRevisionId,
      development_plan_item_id: revisedItem.id,
      development_plan_id: revisedItem.development_plan_id,
      revision_number: 2,
      snapshot: revisedItem,
      change_reason: 'regression_plan_item_revision_id_changed',
      edited_by_actor_id: seeded.ids.actorTech,
      created_at: '2026-06-03T02:00:00.000Z',
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
      .send({ actor_id: seeded.ids.actorTech, idempotency_key: 'start-execution-stale-item-revision' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_execution_readiness_blocked');
        expect(body.details.blocker_codes).toContain('development_plan_item_revision_not_current');
      });

    await expect(repository.getPlanItemWorkflow(seeded.workflow.id)).resolves.toMatchObject({ status: 'execution_ready' });
    const workflowRuns = (await repository.listRunSessions()).filter((runSession) => runSession.workflow_id === seeded.workflow.id);
    expect(workflowRuns).toHaveLength(0);
    const turns = await repository.listCodexSessionTurns(seeded.workflow.active_codex_session_id!);
    expect(turns.filter((turn) => turn.intent === 'execute_plan')).toHaveLength(0);
    const events = await repository.listTraceEventsForSubject('plan_item_workflow', seeded.workflow.id);
    expect(events.some((event) => event.event_type === 'workflow_execution_started')).toBe(false);
  });

  it('rejects execution start when the ready package policy was mutated after readiness', async () => {
    const seeded = await runWorkflowToExecutionReady(app, '56565656');
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const readyWorkflow = await repository.getPlanItemWorkflow(seeded.workflow.id);
    const readyExecutionPackage = await repository.getExecutionPackage(readyWorkflow!.execution_package_id!);
    if (readyExecutionPackage === undefined) throw new Error('Expected ready Execution Package');
    await repository.saveExecutionPackage({
      ...readyExecutionPackage,
      allowed_paths: [...readyExecutionPackage.allowed_paths, 'unexpected/**'],
      updated_at: '2026-06-03T02:10:00.000Z',
    });
    await seedRunExecutionRuntime(repository, seeded.ids.project, readyExecutionPackage.repo_id, seeded.ids.actorTech);

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
      .send({ actor_id: seeded.ids.actorTech, idempotency_key: 'start-execution-mutated-package-policy' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('workflow_evidence_not_owned');
      });

    await expect(repository.getPlanItemWorkflow(seeded.workflow.id)).resolves.toMatchObject({ status: 'execution_ready' });
    const workflowRuns = (await repository.listRunSessions()).filter((runSession) => runSession.workflow_id === seeded.workflow.id);
    expect(workflowRuns).toHaveLength(0);
    const turns = await repository.listCodexSessionTurns(seeded.workflow.active_codex_session_id!);
    expect(turns.filter((turn) => turn.intent === 'execute_plan')).toHaveLength(0);
    const events = await repository.listTraceEventsForSubject('plan_item_workflow', seeded.workflow.id);
    expect(events.some((event) => event.event_type === 'workflow_execution_started')).toBe(false);
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

async function seedReviewResponseRuntimeAction(
  app: INestApplication,
  idPrefix: string,
  options: {
    evidenceRefs?: (input: { workflowId: string; reviewPacketId: string; actorId: string }) => ReviewPacketEvidenceRef[];
    currentDigest?: (input: {
      reviewPacket: Parameters<typeof reviewPacketInputDigest>[0]['packet'];
      evidenceRefs: ReviewPacketEvidenceRef[];
      runSession: RunSession;
      executionPackage: NonNullable<Awaited<ReturnType<DeliveryRepository['getExecutionPackage']>>>;
      seeded: Awaited<ReturnType<typeof runWorkflowToExecutionReady>>;
    }) => string;
    createAction?: boolean;
    reviewPacketPatch?: Partial<Parameters<DeliveryRepository['saveReviewPacket']>[0]>;
  } = {},
) {
  const seeded = await runWorkflowToExecutionReady(app, idPrefix);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const readyWorkflow = (await repository.getPlanItemWorkflow(seeded.workflow.id))!;
  const executionPackage = (await repository.getExecutionPackage(readyWorkflow.execution_package_id!))!;
  await seedRunExecutionRuntime(repository, seeded.ids.project, executionPackage.repo_id, seeded.ids.actorTech);
  const started = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
    .send({ actor_id: seeded.ids.actorTech, idempotency_key: `review-response-runtime-start-${idPrefix}` })
    .expect(201);
  const runSession = (await repository.getRunSession(started.body.execution_run_summary.run_session_id))!;
  const executionRuntimeJobId = runSession.runtime_metadata?.remote_runtime_job_id;
  if (executionRuntimeJobId === undefined) throw new Error('Expected run execution runtime job');
  const executionRuntimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: executionRuntimeJobId }))!;
  await terminalizeWorkflowExecutionForReviewSetup(repository, executionRuntimeJob, runSession, `review-response-runtime-${idPrefix}`);
  const reviewExecutionPackage = (await repository.getExecutionPackage(executionPackage.id))!;
  await repository.saveRunSessionAttemptLineage({
    run_session_id: runSession.id,
    workflow_id: seeded.workflow.id,
    codex_session_id: executionRuntimeJob.codex_session_id!,
    attempt_kind: 'first_execution',
    created_by_actor_id: seeded.ids.actorTech,
    created_at: '2026-05-31T00:03:00.000Z',
  });
  const reviewPacket = {
    id: stableUuid({ kind: 'review-response-runtime-packet', workflowId: seeded.workflow.id, idPrefix }),
    workflow_id: seeded.workflow.id,
    codex_session_id: executionRuntimeJob.codex_session_id,
    codex_session_turn_id: runSession.codex_session_turn_id,
    execution_package_id: executionPackage.id,
    run_session_id: runSession.id,
    reviewer_actor_id: seeded.ids.actorTech,
    spec_revision_id: seeded.specRevisionId,
    plan_revision_id: seeded.implementationPlanRevisionId,
    status: 'completed' as const,
    decision: 'changes_requested' as const,
    summary: 'Review requests a response.',
    changed_files: [],
    check_result_summary: 'Checks passed.',
    self_review: { status: 'done', summary: 'Self review complete.' },
    risk_notes: ['Review response should be read-only.'],
    requested_changes: [{ title: 'Review change', description: 'Explain the failed assumption.', severity: 'major' as const }],
    created_at: '2026-05-31T00:03:00.000Z',
    updated_at: '2026-05-31T00:03:00.000Z',
    completed_at: '2026-05-31T00:03:00.000Z',
    ...options.reviewPacketPatch,
  };
  const evidenceRefs =
    options.evidenceRefs?.({
      workflowId: seeded.workflow.id,
      reviewPacketId: reviewPacket.id,
      actorId: seeded.ids.actorTech,
    }) ?? [];
  await repository.saveReviewPacket({
    ...reviewPacket,
    current_digest:
      options.currentDigest?.({ reviewPacket, evidenceRefs, runSession, executionPackage: reviewExecutionPackage, seeded }) ??
      reviewPacketInputDigest({
        packet: reviewPacket,
        evidence_refs: evidenceRefs,
        previous_run_session_id: runSession.id,
        execution_package_id: reviewExecutionPackage.id,
        execution_package_version: reviewExecutionPackage.execution_package_version ?? reviewExecutionPackage.version,
        approved_spec_revision_id: seeded.specRevisionId,
        approved_implementation_plan_revision_id: seeded.implementationPlanRevisionId,
      }),
  });
  for (const evidenceRef of evidenceRefs) {
    await repository.saveReviewPacketEvidenceRef(evidenceRef);
  }
  const codeReviewWorkflow = (await repository.getPlanItemWorkflow(seeded.workflow.id))!;
  const session = (await repository.getCodexSession(codeReviewWorkflow.active_codex_session_id!))!;
  const currentReviewPacket = (await repository.getReviewPacket(reviewPacket.id))!;
  if (options.createAction === false) {
    return { seeded, repository, executionPackage: reviewExecutionPackage, runSession, reviewPacket: currentReviewPacket, evidenceRefs };
  }
  const action = await repository.createOrReplayPlanItemWorkflowQueuedAction({
    id: stableUuid({ kind: 'review-response-runtime-action', workflowId: seeded.workflow.id, idPrefix }),
    workflow_id: seeded.workflow.id,
    codex_session_id: session.id,
    kind: 'respond_to_review',
    status: 'queued',
    expected_input_capsule_digest: session.latest_capsule_digest!,
    context_preview_digest: codexCanonicalDigest({
      workflow_id: codeReviewWorkflow.id,
      codex_session_id: session.id,
      development_plan_id: codeReviewWorkflow.development_plan_id,
      development_plan_item_id: codeReviewWorkflow.development_plan_item_id,
      workflow_status: codeReviewWorkflow.status,
      active_boundary_summary_revision_id: codeReviewWorkflow.active_boundary_summary_revision_id ?? null,
      active_spec_doc_revision_id: codeReviewWorkflow.active_spec_doc_revision_id ?? null,
      active_implementation_plan_doc_revision_id: codeReviewWorkflow.active_implementation_plan_doc_revision_id ?? null,
      latest_capsule_digest: session.latest_capsule_digest ?? null,
      action_kind: 'respond_to_review',
    }),
    idempotency_key: codexCanonicalDigest({ kind: 'review-response-runtime-idempotency', workflow_id: seeded.workflow.id, idPrefix }),
    created_by_actor_id: seeded.ids.actorTech,
    created_at: '2026-05-31T00:03:00.000Z',
    updated_at: '2026-05-31T00:03:00.000Z',
  });
  return { seeded, repository, executionPackage: reviewExecutionPackage, runSession, reviewPacket: currentReviewPacket, evidenceRefs, action };
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

async function startWorkflowOwnedExecution(app: INestApplication, idPrefix: string) {
  const seeded = await runWorkflowToExecutionReady(app, idPrefix);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const readyWorkflow = await repository.getPlanItemWorkflow(seeded.workflow.id);
  const readyExecutionPackage = await repository.getExecutionPackage(readyWorkflow!.execution_package_id!);
  await seedRunExecutionRuntime(repository, seeded.ids.project, readyExecutionPackage!.repo_id, seeded.ids.actorTech, {
    environment: 'local_dogfood',
  });
  const response = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/execution/start`)
    .send({ actor_id: seeded.ids.actorTech, idempotency_key: `start-${idPrefix}` })
    .expect(201);
  const workflow = await repository.getPlanItemWorkflow(seeded.workflow.id);
  const session = await repository.getCodexSession(workflow!.active_codex_session_id!);
  const executionPackage = await repository.getExecutionPackage(workflow!.execution_package_id!);
  const runSession = await repository.getRunSession(response.body.execution_run_summary.run_session_id);
  const runtimeJobId = runSession?.runtime_metadata?.remote_runtime_job_id;
  const runtimeJob = runtimeJobId === undefined ? undefined : await repository.getCodexRuntimeJob({ runtime_job_id: runtimeJobId });
  if (workflow === undefined || session === undefined || executionPackage === undefined || runSession === undefined || runtimeJob === undefined) {
    throw new Error(`Expected started workflow execution fixture ${idPrefix}`);
  }
  const workload = runtimeJob.input_json as {
    codex_session_runtime_context: { expected_input_capsule_digest: string };
  };
  return {
    seeded,
    repository,
    workflow,
    session,
    executionPackage,
    runSession,
    runtimeJob,
    runtimeJobInputCapsuleDigest: workload.codex_session_runtime_context.expected_input_capsule_digest,
  };
}

type PrivatePlanItemWorkflowRepository = {
  executionPackages: Map<string, ExecutionPackage>;
  runSessions: Map<string, RunSession>;
  codexRuntimeJobs: Map<string, { job: CodexRuntimeJob } & Record<string, unknown>>;
  codexSessions: Map<string, Record<string, unknown>>;
  codexSessionLeases: Map<string, Record<string, unknown>>;
  codexLaunchLeases: Map<string, { lease: Record<string, unknown> } & Record<string, unknown>>;
  codexSessionTurns: Map<string, Record<string, unknown>>;
  runWorkerLeases: Map<string, Record<string, unknown>>;
  runCommands: Map<
    string,
    {
      run_session_id: string;
      command_type: string;
      status: string;
      target_turn_id?: string;
      payload: Record<string, unknown>;
    }
  >;
};

function privatePlanItemWorkflowRepository(repository: DeliveryRepository): PrivatePlanItemWorkflowRepository {
  return repository as unknown as PrivatePlanItemWorkflowRepository;
}

function mutateExecutionPackage(repository: DeliveryRepository, executionPackageId: string, patch: Partial<ExecutionPackage>) {
  const privateRepository = privatePlanItemWorkflowRepository(repository);
  const executionPackage = privateRepository.executionPackages.get(executionPackageId);
  if (executionPackage === undefined) {
    throw new Error(`Expected private execution package ${executionPackageId}`);
  }
  privateRepository.executionPackages.set(executionPackageId, {
    ...executionPackage,
    ...patch,
    updated_at: '2026-06-03T03:00:00.000Z',
  });
}

function mutateRunSession(repository: DeliveryRepository, runSessionId: string, patch: Partial<RunSession>) {
  const privateRepository = privatePlanItemWorkflowRepository(repository);
  const runSession = privateRepository.runSessions.get(runSessionId);
  if (runSession === undefined) {
    throw new Error(`Expected private run session ${runSessionId}`);
  }
  privateRepository.runSessions.set(runSessionId, {
    ...runSession,
    ...patch,
    updated_at: '2026-06-03T03:00:00.000Z',
  });
}

function overwriteRuntimeJob(repository: DeliveryRepository, runtimeJobId: string, patch: Partial<CodexRuntimeJob>) {
  const privateRepository = privatePlanItemWorkflowRepository(repository);
  const record = privateRepository.codexRuntimeJobs.get(runtimeJobId);
  if (record === undefined) {
    throw new Error(`Expected private runtime job ${runtimeJobId}`);
  }
  privateRepository.codexRuntimeJobs.set(runtimeJobId, {
    ...record,
    job: {
      ...record.job,
      ...patch,
      updated_at: '2026-06-03T03:00:00.000Z',
    },
  });
}

function workflowRunExecutionRuntimeJobIds(repository: DeliveryRepository, workflowId: string): string[] {
  return Array.from(privatePlanItemWorkflowRepository(repository).codexRuntimeJobs.values())
    .map((record) => record.job)
    .filter((job) => job.workflow_id === workflowId && job.target_kind === 'run_execution')
    .map((job) => job.id)
    .sort();
}

function workflowActionRuntimeJob(repository: DeliveryRepository, actionId: string): CodexRuntimeJob | undefined {
  return Array.from(privatePlanItemWorkflowRepository(repository).codexRuntimeJobs.values())
    .map((record) => record.job)
    .find((job) => job.target_type === 'plan_item_workflow_action' && job.target_id === actionId);
}

function privateRunCommands(repository: DeliveryRepository) {
  return Array.from(privatePlanItemWorkflowRepository(repository).runCommands.values());
}

async function saveRunSessionStatus(repository: DeliveryRepository, runSession: RunSession, status: RunSession['status']) {
  await repository.saveRunSession({
    ...runSession,
    status,
    updated_at: '2026-06-03T03:00:00.000Z',
  });
}

async function makePreviousExecutionWriterRecoverable(
  repository: DeliveryRepository,
  runtimeJob: CodexRuntimeJob,
  runSession: RunSession,
  terminalStatus: 'failed' | 'cancelled',
) {
  overwriteRuntimeJob(repository, runtimeJob.id, {
    status: 'terminal',
    terminal_status: terminalStatus,
    terminal_at: '2026-06-03T03:01:00.000Z',
  });
  const workerLease = await repository.getRunWorkerLease(runSession.id);
  if (workerLease?.status === 'active') {
    await repository.releaseRunWorkerLease(runSession.id, workerLease.worker_id, workerLease.lease_token, '2026-06-03T03:00:30.000Z');
  }
  expireCodexSessionLeaseForRuntimeJob(repository, runtimeJob);
  expireCodexLaunchLease(repository, runtimeJob.launch_lease_id);
}

function expireCodexSessionLeaseForRuntimeJob(repository: DeliveryRepository, runtimeJob: CodexRuntimeJob) {
  const workload = runtimeJob.input_json as {
    codex_session_terminalization: { codex_session_lease_id: string };
  };
  mutateCodexSessionLeaseForRuntimeJob(repository, runtimeJob, {
    status: 'active',
    expires_at: '2000-01-01T00:00:00.000Z',
    updated_at: '2026-06-03T03:00:00.000Z',
  });
}

function mutateCodexSessionLeaseForRuntimeJob(
  repository: DeliveryRepository,
  runtimeJob: CodexRuntimeJob,
  patch: Record<string, unknown>,
) {
  const workload = runtimeJob.input_json as {
    codex_session_terminalization: { codex_session_lease_id: string };
  };
  const privateRepository = privatePlanItemWorkflowRepository(repository);
  const lease = privateRepository.codexSessionLeases.get(workload.codex_session_terminalization.codex_session_lease_id);
  if (lease === undefined) {
    throw new Error(`Expected Codex session lease ${workload.codex_session_terminalization.codex_session_lease_id}`);
  }
  privateRepository.codexSessionLeases.set(workload.codex_session_terminalization.codex_session_lease_id, {
    ...lease,
    ...patch,
  });
}

function expireCodexLaunchLease(repository: DeliveryRepository, launchLeaseId: string) {
  const privateRepository = privatePlanItemWorkflowRepository(repository);
  const record = privateRepository.codexLaunchLeases.get(launchLeaseId);
  if (record === undefined) {
    throw new Error(`Expected Codex launch lease ${launchLeaseId}`);
  }
  privateRepository.codexLaunchLeases.set(launchLeaseId, {
    ...record,
    lease: {
      ...record.lease,
      status: 'expired',
      expires_at: '2000-01-01T00:00:00.000Z',
    },
  });
}

function expireRunWorkerLeaseWithoutStatusMutation(repository: DeliveryRepository, runSessionId: string) {
  const privateRepository = privatePlanItemWorkflowRepository(repository);
  const lease = privateRepository.runWorkerLeases.get(runSessionId);
  if (lease === undefined) {
    throw new Error(`Expected run worker lease for ${runSessionId}`);
  }
  privateRepository.runWorkerLeases.set(runSessionId, {
    ...lease,
    status: 'active',
    expires_at: '2000-01-01T00:00:00.000Z',
    heartbeat_at: '1999-12-31T23:59:59.000Z',
  });
}

function markCodexSessionTurnStatus(repository: DeliveryRepository, turnId: string, status: string) {
  const privateRepository = privatePlanItemWorkflowRepository(repository);
  const turn = privateRepository.codexSessionTurns.get(turnId);
  if (turn === undefined) {
    throw new Error(`Expected Codex session turn ${turnId}`);
  }
  privateRepository.codexSessionTurns.set(turnId, {
    ...turn,
    status,
    updated_at: '2026-06-03T03:00:00.000Z',
  });
}

function advanceSessionLatestCapsuleDigest(repository: DeliveryRepository, sessionId: string, label: string) {
  const privateRepository = privatePlanItemWorkflowRepository(repository);
  const session = privateRepository.codexSessions.get(sessionId);
  if (session === undefined) {
    throw new Error(`Expected Codex session ${sessionId}`);
  }
  privateRepository.codexSessions.set(sessionId, {
    ...session,
    latest_capsule_digest: capsuleDigest(label),
    latest_memory_bundle_digest: capsuleDigest(`${label}-memory`),
    latest_environment_manifest_digest: capsuleDigest(`${label}-environment`),
    updated_at: '2026-06-03T03:00:00.000Z',
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

async function terminalizeWorkflowExecutionForReviewSetup(
  repository: DeliveryRepository,
  runtimeJob: CodexRuntimeJob,
  runSession: RunSession,
  suffix: string,
) {
  const workload = runtimeJob.input_json as {
    plan_item_workflow_id: string;
    execution_package_id: string;
    execution_package_version: number;
    run_session_id: string;
    workspace_bundle_digest: string;
    workspace_acquisition_json: { manifest_digest: string };
    codex_session_runtime_context: {
      codex_session_id: string;
      codex_session_turn_id: string;
      expected_input_capsule_digest?: string;
      continuation: { codex_thread_id: string; codex_thread_id_digest: string };
    };
    codex_session_terminalization: {
      codex_session_lease_id: string;
      codex_session_lease_epoch: number;
      codex_session_worker_id: string;
      codex_session_worker_session_digest: string;
      lease_token: string;
      input_capsule_id: string;
      input_capsule_digest: string;
      input_memory_bundle_ref?: string;
      input_memory_bundle_digest?: string;
      input_environment_manifest_ref?: string;
      input_environment_manifest_digest?: string;
    };
  };
  const now = '2026-05-31T00:03:00.000Z';
  const outputCapsule = runtimeCapsule({
    id: stableUuid({ kind: 'review-response-runtime-execution-output-capsule', runtimeJobId: runtimeJob.id }),
    codex_session_id: workload.codex_session_runtime_context.codex_session_id,
    created_from_turn_id: workload.codex_session_runtime_context.codex_session_turn_id,
    sequence: 100,
    digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'workflow-run-output-capsule' }),
    manifest_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'workflow-run-output-capsule-manifest' }),
    codex_thread_id_digest: workload.codex_session_runtime_context.continuation.codex_thread_id_digest,
    created_by_actor_id: runtimeJob.worker_id,
    created_at: now,
  });
  const terminalResult = {
    task_kind: 'run_execution',
    output_schema_version: 'codex_run_execution_result.v1',
    execution_package_id: workload.execution_package_id,
    execution_package_version: workload.execution_package_version,
    run_session_id: workload.run_session_id,
    workspace_bundle_digest: workload.workspace_bundle_digest,
    workspace_bundle_manifest_digest: workload.workspace_acquisition_json.manifest_digest,
    mounted_task_workspace_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, mounted: true }),
    changed_files: ['packages/domain/src/codex-runtime.ts'],
    check_results: [],
    execution_artifacts: [],
    public_summary: 'Workflow-owned run execution completed.',
    codex_session_thread: {
      codex_thread_id: workload.codex_session_runtime_context.continuation.codex_thread_id,
      codex_thread_id_digest: workload.codex_session_runtime_context.continuation.codex_thread_id_digest,
      app_server_turn_id: `app-server-turn-${runtimeJob.id}`,
    },
    output_capsule: outputCapsule,
    output_memory_bundle_ref: `artifact://internal/codex_memory_bundle/codex_session/${outputCapsule.codex_session_id}/memory-${runtimeJob.id}`,
    output_memory_bundle_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'memory-bundle' }),
    output_environment_manifest_ref: `artifact://internal/codex_environment_manifest/codex_session/${outputCapsule.codex_session_id}/environment-${runtimeJob.id}`,
    output_environment_manifest_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, artifact: 'environment-manifest' }),
    codex_session_turn_id: workload.codex_session_runtime_context.codex_session_turn_id,
  };
  const sessionToken = `plan-item-workflow-run-session-${runtimeJob.project_id}`;
  const acceptedWorkerSessionDigest = codexCredentialPayloadDigest(sessionToken);
  const sessionKey = `plan-item-workflow-run-session-key-${runtimeJob.project_id}`;
  const runtimeNonce = `${runtimeJob.id}-${suffix}`;
  const envelope = await repository.getCodexRuntimeJobEnvelope({ runtime_job_id: runtimeJob.id });
  expect(envelope).toBeDefined();
  const launchTokenHash = String(envelope!.ciphertext).replace(/^in-memory:/, '');
  const replayProtection = (step: string) => ({
    method: 'POST' as const,
    path: `/test/workflow-run-execution/${runtimeJob.id}/${suffix}/${step}`,
    body_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, suffix, step, body: true }),
  });
  await repository.acceptCodexRuntimeJob({
    runtime_job_id: runtimeJob.id,
    worker_id: runtimeJob.worker_id,
    worker_session_token: sessionToken,
    nonce: `${runtimeNonce}-accept`,
    nonce_timestamp: now,
    accepted_worker_session_digest: acceptedWorkerSessionDigest,
    accepted_session_public_key_id: sessionKey,
    accepted_session_epoch: 1,
    idempotency_key: `${runtimeNonce}-accept`,
    request_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, suffix, step: 'accept' }),
    replay_protection: replayProtection('accept'),
    now,
  });
  await repository.claimCodexLaunchTokenEnvelope({
    runtime_job_id: runtimeJob.id,
    envelope_id: envelope!.id,
    worker_id: runtimeJob.worker_id,
    worker_session_token: sessionToken,
    nonce: `${runtimeNonce}-claim-envelope`,
    nonce_timestamp: now,
    accepted_worker_session_digest: acceptedWorkerSessionDigest,
    key_id: sessionKey,
    accepted_session_epoch: 1,
    claim_request_id: `${runtimeNonce}-claim-envelope`,
    request_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, suffix, step: 'claim-envelope' }),
    replay_protection: replayProtection('claim-envelope'),
    now,
  });
  await repository.materializeCodexRuntimeJob({
    runtime_job_id: runtimeJob.id,
    launch_lease_id: runtimeJob.launch_lease_id,
    worker_id: runtimeJob.worker_id,
    worker_session_token: sessionToken,
    nonce: `${runtimeNonce}-materialize`,
    nonce_timestamp: now,
    launch_token_hash: launchTokenHash,
    accepted_worker_session_digest: acceptedWorkerSessionDigest,
    accepted_session_public_key_id: sessionKey,
    accepted_session_epoch: 1,
    materialization_request_id: `${runtimeNonce}-materialize`,
    request_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, suffix, step: 'materialize' }),
    replay_protection: replayProtection('materialize'),
    now,
  });
  await repository.startCodexRuntimeJob({
    runtime_job_id: runtimeJob.id,
    worker_id: runtimeJob.worker_id,
    worker_session_token: sessionToken,
    nonce: `${runtimeNonce}-start`,
    nonce_timestamp: now,
    idempotency_key: `${runtimeNonce}-start`,
    request_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, suffix, step: 'start' }),
    runtime_evidence_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, suffix, step: 'runtime-evidence' }),
    launch_materialization_digest: codexCanonicalDigest({ lease_id: runtimeJob.launch_lease_id, suffix }),
    replay_protection: replayProtection('start'),
    now,
  });
  await repository.terminalizeWorkflowExecution({
    workflow_id: workload.plan_item_workflow_id,
    codex_session_id: workload.codex_session_runtime_context.codex_session_id,
    codex_session_turn_id: workload.codex_session_runtime_context.codex_session_turn_id,
    run_session_id: runSession.id,
    runtime_job_id: runtimeJob.id,
    expected_workflow_status: 'execution_running',
    expected_run_session_status: runSession.status,
    expected_run_session_updated_at: runSession.updated_at,
    runtime_job_terminalization: {
      runtime_job_id: runtimeJob.id,
      launch_lease_id: runtimeJob.launch_lease_id,
      worker_id: runtimeJob.worker_id,
      worker_session_token: sessionToken,
      nonce: `${runtimeNonce}-terminal`,
      nonce_timestamp: now,
      terminal_status: 'succeeded',
      reason_code: 'codex_runtime_job_succeeded',
      terminal_result_json: terminalResult,
      idempotency_key: `${runtimeNonce}-terminal`,
      request_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, suffix, step: 'terminal' }),
      replay_protection: replayProtection('terminal'),
      now,
    },
    codex_session_turn_terminalization: {
      session_id: workload.codex_session_runtime_context.codex_session_id,
      turn_id: workload.codex_session_runtime_context.codex_session_turn_id,
      lease_id: workload.codex_session_terminalization.codex_session_lease_id,
      lease_token_hash: codexCredentialPayloadDigest(workload.codex_session_terminalization.lease_token),
      lease_epoch: workload.codex_session_terminalization.codex_session_lease_epoch,
      worker_id: workload.codex_session_terminalization.codex_session_worker_id,
      worker_session_digest: workload.codex_session_terminalization.codex_session_worker_session_digest,
      status: 'succeeded',
      expected_input_capsule_digest: workload.codex_session_runtime_context.expected_input_capsule_digest,
      input_capsule_id: workload.codex_session_terminalization.input_capsule_id,
      input_capsule_digest: workload.codex_session_terminalization.input_capsule_digest,
      ...(workload.codex_session_terminalization.input_memory_bundle_ref === undefined
        ? {}
        : { input_memory_bundle_ref: workload.codex_session_terminalization.input_memory_bundle_ref }),
      ...(workload.codex_session_terminalization.input_memory_bundle_digest === undefined
        ? {}
        : { input_memory_bundle_digest: workload.codex_session_terminalization.input_memory_bundle_digest }),
      ...(workload.codex_session_terminalization.input_environment_manifest_ref === undefined
        ? {}
        : { input_environment_manifest_ref: workload.codex_session_terminalization.input_environment_manifest_ref }),
      ...(workload.codex_session_terminalization.input_environment_manifest_digest === undefined
        ? {}
        : { input_environment_manifest_digest: workload.codex_session_terminalization.input_environment_manifest_digest }),
      output_capsule: outputCapsule,
      output_memory_bundle_ref: terminalResult.output_memory_bundle_ref,
      output_memory_bundle_digest: terminalResult.output_memory_bundle_digest,
      output_environment_manifest_ref: terminalResult.output_environment_manifest_ref,
      output_environment_manifest_digest: terminalResult.output_environment_manifest_digest,
      app_server_thread_binding_required: true,
      codex_thread_id: terminalResult.codex_session_thread.codex_thread_id,
      codex_thread_id_digest: terminalResult.codex_session_thread.codex_thread_id_digest,
      now,
    },
    run_session_update: {
      status: 'succeeded',
      summary: terminalResult.public_summary,
      finished_at: now,
      updated_at: now,
    },
    workflow_transition: {
      id: stableUuid({ kind: 'review-response-runtime-execution-transition', runtimeJobId: runtimeJob.id }),
      actor_id: runSession.requested_by_actor_id,
      reason: terminalResult.public_summary,
      created_at: now,
    },
    stale_attempt: {
      id: stableUuid({ kind: 'review-response-runtime-stale-attempt', runtimeJobId: runtimeJob.id }),
      codex_session_id: workload.codex_session_runtime_context.codex_session_id,
      codex_session_turn_id: workload.codex_session_runtime_context.codex_session_turn_id,
      lease_id: workload.codex_session_terminalization.codex_session_lease_id,
      lease_epoch: workload.codex_session_terminalization.codex_session_lease_epoch,
      worker_id: workload.codex_session_terminalization.codex_session_worker_id,
      worker_session_digest: workload.codex_session_terminalization.codex_session_worker_session_digest,
      expected_input_capsule_digest: workload.codex_session_runtime_context.expected_input_capsule_digest,
      attempted_output_capsule_digest: outputCapsule.digest,
      attempted_codex_thread_id_digest: terminalResult.codex_session_thread.codex_thread_id_digest,
      workflow_id: workload.plan_item_workflow_id,
      run_session_id: runSession.id,
      runtime_job_id: runtimeJob.id,
      reason_code: 'codex_session_stale_terminalization',
      created_at: now,
    },
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

async function seedRunExecutionRuntime(
  repository: DeliveryRepository,
  projectId: string,
  repoId: string,
  actorId: string,
  options: { environment?: 'test' | 'local_dogfood' } = {},
) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.parse(now) + 60 * 60_000).toISOString();
  const environment = options.environment ?? 'test';
  const networkPolicy = { mode: 'disabled' as const };
  const profileId = stableUuid({ kind: 'plan-item-workflow-run-profile', projectId });
  const profileRevisionId = stableUuid({ kind: 'plan-item-workflow-run-profile-revision', projectId });
  const credentialBindingId = stableUuid({ kind: 'plan-item-workflow-run-credential-binding', projectId });
  const credentialVersionId = stableUuid({ kind: 'plan-item-workflow-run-credential-version', projectId });
  const workerId = stableUuid({ kind: 'plan-item-workflow-run-worker', projectId });
  const dockerImageDigest = codexCanonicalDigest({ label: 'plan-item-workflow-run-docker-image' });
  const networkPolicyDigest = codexRuntimeNetworkPolicyDigest(networkPolicy);
  const codexConfigToml = 'approval_policy = "never"\n';
  const revisionWithoutDigest = {
    id: profileRevisionId,
    profile_id: profileId,
    revision_number: 1,
    status: 'active' as const,
    environment,
    docker_image: 'ghcr.io/forgeloop/codex-worker:test',
    docker_image_digest: dockerImageDigest,
    target_kind: 'run_execution' as const,
    source_access_mode: 'path_policy_scoped' as const,
    codex_config_toml: codexConfigToml,
    codex_config_digest: codexCanonicalDigest(codexConfigToml),
    expected_effective_config_digest: codexCanonicalDigest({ label: 'plan-item-workflow-run-effective-config' }),
    effective_config_assertions: {
      target_kind: 'run_execution' as const,
      approval_policy: 'never' as const,
      sandbox_type: 'danger-full-access' as const,
      writable_roots_policy: 'task_workspace_only' as const,
    },
    app_server_required: true,
    allowed_driver_kind: 'app_server' as const,
    network_policy: networkPolicy,
    resource_limits: {
      cpu_ms: 300_000,
      memory_mb: 1024,
      pids: 256,
      fds: 1024,
      workspace_bytes: 10_000_000,
      artifact_bytes: 1_048_576,
      timeout_ms: 300_000,
      output_limit_bytes: 1_048_576,
      run_output_limit_bytes: 1_048_576,
    },
    docker_policy: {
      network_disabled: true,
      app_server_only: true,
      rootless: true,
      read_only_rootfs: true,
      no_new_privileges: true,
      drop_capabilities: ['ALL'] as const,
    },
    allowed_scopes: [{ project_id: projectId, repo_id: repoId }],
    profile_digest: 'placeholder',
    created_by_actor_id: actorId,
    created_at: now,
  } satisfies CodexRuntimeProfileRevision;
  const revision = { ...revisionWithoutDigest, profile_digest: codexRuntimeProfileRevisionDigest(revisionWithoutDigest) };
  await repository.createCodexRuntimeProfileWithRevision({
    profile: {
      id: profileId,
      name: 'Plan Item Workflow run execution test profile',
      environment,
      target_kind: 'run_execution',
      active_revision_id: profileRevisionId,
      created_by_actor_id: actorId,
      created_at: now,
      updated_at: now,
    },
    revision,
  });
  const secretPayload = { auth: { api_key: 'test-run-api-key' } };
  await repository.createCodexCredentialBindingWithVersion({
    binding: {
      id: credentialBindingId,
      profile_id: profileId,
      project_id: projectId,
      repo_id: repoId,
      provider: 'unsafe_db',
      purpose: 'model_provider',
      active_version_id: credentialVersionId,
      created_by_actor_id: actorId,
      created_at: now,
      updated_at: now,
    },
    version: {
      id: credentialVersionId,
      binding_id: credentialBindingId,
      version_number: 1,
      status: 'active',
      payload_digest: codexCredentialPayloadDigest(secretPayload),
      created_by_actor_id: actorId,
      created_at: now,
    },
    secret_payload_json: secretPayload,
  });
  await repository.createCodexWorkerBootstrapToken({
    id: stableUuid({ kind: 'plan-item-workflow-run-bootstrap', projectId }),
    worker_identity: `plan-item-workflow-run-worker-${projectId}`,
    bootstrap_token_hash: codexCredentialPayloadDigest(`plan-item-workflow-run-bootstrap-${projectId}`),
    bootstrap_token_version: 1,
    status: 'active',
    allowed_scopes_json: [{ project_id: projectId, repo_id: repoId }],
    allowed_capabilities_json: {
      target_kinds: ['run_execution'],
      docker_image_digests: [dockerImageDigest],
      network_policy_digests: [networkPolicyDigest],
    },
    created_by_actor_id: actorId,
    created_at: now,
    expires_at: expiresAt,
  });
  await repository.upsertCodexWorkerRegistration({
    worker_id: workerId,
    worker_identity: `plan-item-workflow-run-worker-${projectId}`,
    version: 'test-worker',
    bootstrap_token_hash: codexCredentialPayloadDigest(`plan-item-workflow-run-bootstrap-${projectId}`),
    bootstrap_token_version: 1,
    session_token: `plan-item-workflow-run-session-${projectId}`,
    session_expires_at: expiresAt,
    status: 'online',
    control_channel_status: 'connected',
    allowed_scopes: [{ project_id: projectId, repo_id: repoId }],
    capabilities: ['run_execution'],
    docker_image_digests: [dockerImageDigest],
    network_policy_digests: [networkPolicyDigest],
    host_worker_uid: 501,
    host_worker_gid: 20,
    lease_count: 0,
    max_concurrency: 100,
    session_public_key_id: `plan-item-workflow-run-session-key-${projectId}`,
    session_public_key_algorithm: 'x25519',
    session_public_key_material: 'base64-public-key-material',
    session_public_key_expires_at: expiresAt,
    now,
  });
  await repository.heartbeatCodexWorker({
    worker_id: workerId,
    session_token: `plan-item-workflow-run-session-${projectId}`,
    nonce: `plan-item-workflow-run-heartbeat-${projectId}`,
    nonce_timestamp: now,
    status: 'online',
    control_channel_status: 'connected',
    active_lease_count: 0,
    capabilities: ['run_execution'],
    now,
  });
}

async function createRunExecutionCredentialBinding(
  repository: DeliveryRepository,
  input: {
    projectId: string;
    repoId?: string;
    actorId: string;
    suffix: string;
  },
): Promise<{ credentialBindingId: string; credentialVersionId: string }> {
  const now = new Date().toISOString();
  const profileId = stableUuid({ kind: 'plan-item-workflow-run-profile', projectId: input.projectId });
  const credentialBindingId = stableUuid({
    kind: 'plan-item-workflow-run-extra-credential-binding',
    projectId: input.projectId,
    suffix: input.suffix,
  });
  const credentialVersionId = stableUuid({
    kind: 'plan-item-workflow-run-extra-credential-version',
    projectId: input.projectId,
    suffix: input.suffix,
  });
  const secretPayload = { auth: { api_key: `test-run-api-key-${input.suffix}` } };
  await repository.createCodexCredentialBindingWithVersion({
    binding: {
      id: credentialBindingId,
      profile_id: profileId,
      project_id: input.projectId,
      ...(input.repoId === undefined ? {} : { repo_id: input.repoId }),
      provider: 'unsafe_db',
      purpose: 'model_provider',
      active_version_id: credentialVersionId,
      created_by_actor_id: input.actorId,
      created_at: now,
      updated_at: now,
    },
    version: {
      id: credentialVersionId,
      binding_id: credentialBindingId,
      version_number: 1,
      status: 'active',
      payload_digest: codexCredentialPayloadDigest(secretPayload),
      created_by_actor_id: input.actorId,
      created_at: now,
    },
    secret_payload_json: secretPayload,
  });
  return { credentialBindingId, credentialVersionId };
}
