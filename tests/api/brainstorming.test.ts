import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { createAutomationActionRunSchema } from '../../apps/control-plane-api/src/modules/automation/automation.dto';
import { ProductGenerationResultService } from '../../apps/control-plane-api/src/modules/automation/product-generation-result.service';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { CodexRuntimeService } from '../../apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexRuntimeNetworkPolicyDigest,
  codexRuntimeProfileRevisionDigest,
  type CodexGenerationRuntimeJobResult,
  type CodexRuntimeJob,
  type CodexRuntimeProfileRevision,
} from '../../packages/domain/src';
import type { DeliveryRepository } from '../../packages/db/src';

const expectedQuestions = [
  'Which repos, modules, and product surfaces are in scope?',
  'What is explicitly out of scope for this Development Plan Item?',
  'Which acceptance criteria and validation commands must pass?',
  'What risks or dependency constraints should block generation?',
];

const withBodyDigest = <T extends Record<string, unknown>>(body: T): T & { body_digest: string } => ({
  ...body,
  body_digest: codexCanonicalDigest(body),
});

async function startWorkflowForPlanItem(app: INestApplication, plan: { id: string }, item: { id: string }, actorId = 'actor-tech') {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const planRecord = await repository.getDevelopmentPlan(plan.id);
  if (planRecord === undefined) {
    throw new Error(`Development Plan ${plan.id} not found`);
  }
  const runtime = runtimeBindingForProject(planRecord.project_id);
  return (
    await request(app.getHttpServer())
      .post(`/development-plans/${plan.id}/items/${item.id}/workflow/start-brainstorming`)
      .send({
        actor_id: actorId,
        runtime_profile_id: runtime.profileId,
        runtime_profile_revision_id: runtime.profileRevisionId,
        credential_binding_id: runtime.credentialBindingId,
        credential_binding_version_id: runtime.credentialBindingVersionId,
        reason: 'Start workflow-scoped Boundary Brainstorming.',
      })
      .expect(201)
  ).body;
}

async function startWorkflowBoundaryBrainstorming(
  app: INestApplication,
  workflowId: string,
  input: {
    actor_id: string;
    leader_actor_id?: string;
    leader_delegate_actor_ids?: string[];
    initial_leader_context_markdown?: string;
  },
) {
  return (
    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${workflowId}/boundary-brainstorming`)
      .send(input)
      .expect(201)
  ).body;
}

async function startWorkflowAndBoundaryBrainstorming(
  app: INestApplication,
  plan: { id: string },
  item: { id: string },
  input: {
    actor_id: string;
    leader_actor_id?: string;
    leader_delegate_actor_ids?: string[];
    initial_leader_context_markdown?: string;
  },
) {
  const workflow = await startWorkflowForPlanItem(app, plan, item);
  const session = await startWorkflowBoundaryBrainstorming(app, workflow.id, input);
  return { workflow, session };
}

function runtimeBindingForProject(projectId: string) {
  return {
    profileId: stableUuid({ kind: 'boundary-generation-profile', projectId }),
    profileRevisionId: stableUuid({ kind: 'boundary-generation-profile-revision', projectId }),
    credentialBindingId: stableUuid({ kind: 'boundary-generation-credential-binding', projectId }),
    credentialBindingVersionId: stableUuid({ kind: 'boundary-generation-credential-version', projectId }),
  };
}

function workflowBoundarySessionPath(workflowId: string, sessionId: string) {
  return `/plan-item-workflows/${workflowId}/boundary-brainstorming-sessions/${sessionId}`;
}

function submitBoundarySummaryRevision(
  server: ReturnType<INestApplication['getHttpServer']>,
  workflowId: string,
  revisionId: string,
  actorId = 'actor-tech',
) {
  return request(server)
    .post(`/plan-item-workflows/${workflowId}/boundary-summary-revisions/${revisionId}/submit`)
    .send({ actor_id: actorId, reason: 'Submit proposed Boundary Summary for review.' });
}

function approveBoundarySummaryRevision(
  server: ReturnType<INestApplication['getHttpServer']>,
  workflowId: string,
  revisionId: string,
  actorId = 'actor-tech',
  reason?: string,
) {
  const body: { actor_id: string; reason?: string } = { actor_id: actorId };
  if (reason !== undefined) body.reason = reason;
  return request(server)
    .post(`/plan-item-workflows/${workflowId}/boundary-summary-revisions/${revisionId}/approve`)
    .send(body);
}

describe('Boundary Brainstorming API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await app.close();
  });

  it('starts with explicit Leader and delegates and stores the snapshot on the item and session', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    const { session } = await startWorkflowAndBoundaryBrainstorming(app, plan, item, {
      actor_id: 'actor-leader',
      leader_actor_id: 'actor-leader',
      leader_delegate_actor_ids: ['actor-delegate'],
    });

    expect(session).toMatchObject({
      leader_actor_id: 'actor-leader',
      leader_delegate_actor_ids: ['actor-delegate'],
      development_plan_item_revision_id: item.revision_id,
    });
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({
      leader_actor_id: 'actor-leader',
      leader_delegate_actor_ids: ['actor-delegate'],
    });
  });

  it('schedules Boundary generation when Codex worker heartbeat uses the runtime wall clock', async () => {
    const codexWorkerNow = '2026-05-29T00:00:00.000Z';
    vi.stubEnv('FORGELOOP_AUTOMATION_TEST_NOW', codexWorkerNow);
    const { project, requirement } = await seedRequirement(app);
    await seedBoundaryGenerationRuntimeForProject(app, project.id, { workerNow: codexWorkerNow });
    const plan = await createDevelopmentPlan(app, {
      project_id: project.id,
      source_ref: { type: 'requirement', id: requirement.id },
    });
    const item = (
      await request(app.getHttpServer())
        .post(`/development-plans/${plan.id}/items`)
        .send({
          title: 'Schedule boundary with wall-clock worker',
          summary: 'Ensure runtime scheduler uses Codex worker time for availability.',
          responsible_role: 'tech_lead',
          driver_actor_id: 'actor-tech',
          reviewer_actor_id: 'actor-leader',
          risk: 'medium',
          dependency_hints: [],
          affected_surfaces: ['codex-runtime'],
          release_impact: 'release_scoped',
        })
        .expect(201)
    ).body;

    const { session } = await startWorkflowAndBoundaryBrainstorming(app, plan, item, {
      actor_id: 'actor-leader',
      leader_actor_id: 'actor-leader',
    });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const [round] = await repository.listBoundaryRounds(session.id);

    expect(round).toMatchObject({
      status: 'queued',
      runtime_job_id: expect.any(String),
    });
  });

  it('rejects delegate self-escalation during boundary start', async () => {
    const first = await seedDevelopmentPlanItem(app);
    const firstWorkflow = await startWorkflowForPlanItem(app, first.plan, first.item);
    const server = app.getHttpServer();

    await request(server)
      .post(`/plan-item-workflows/${firstWorkflow.id}/boundary-brainstorming`)
      .send({
        actor_id: 'actor-leader',
        leader_actor_id: 'actor-leader',
        leader_delegate_actor_ids: ['actor-delegate'],
      })
      .expect(201);

    await request(server)
      .post(`/plan-item-workflows/${firstWorkflow.id}/boundary-brainstorming`)
      .send({
        actor_id: 'actor-random',
        leader_actor_id: 'actor-leader',
        leader_delegate_actor_ids: ['actor-delegate', 'actor-random'],
      })
      .expect(403);

    const second = await seedDevelopmentPlanItem(app);
    const secondWorkflow = await startWorkflowForPlanItem(app, second.plan, second.item);
    await request(server)
      .post(`/plan-item-workflows/${secondWorkflow.id}/boundary-brainstorming`)
      .send({
        actor_id: 'actor-random',
        leader_actor_id: 'actor-leader',
        leader_delegate_actor_ids: ['actor-random'],
      })
      .expect(403);
  });

  it('rejects non-Leader answer, decision, continue, approve, and request-changes actions', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    const { workflow, session } = await startWorkflowAndBoundaryBrainstorming(app, plan, item, {
      actor_id: 'actor-leader',
      leader_actor_id: 'actor-leader',
    });
    const [round] = await repository.listBoundaryRounds(session.id);
    await terminalizeBoundaryRound(app, repository, round, {
      schema_version: 'boundary_round_result.v1',
      session_id: session.id,
      round_id: round.id,
      questions: [{ text: 'Which boundary question must the Leader close?', required: true }],
      proposed_decisions: [],
      needs_leader_input: true,
      public_summary: 'Question proposed.',
    });
    const [question] = await repository.listBoundaryQuestions(session.id);

    await request(server)
      .post(`${workflowBoundarySessionPath(workflow.id, session.id)}/answers`)
      .send({ question_id: question.id, text: 'Non-Leader answer.', actor_id: 'actor-random' })
      .expect(403);
    await request(server)
      .post(`${workflowBoundarySessionPath(workflow.id, session.id)}/decisions`)
      .send({ text: 'Non-Leader decision.', actor_id: 'actor-random' })
      .expect(403);
    await request(server)
      .post(`${workflowBoundarySessionPath(workflow.id, session.id)}/continue`)
      .send({ actor_id: 'actor-random', leader_input_markdown: 'Continue anyway.' })
      .expect(403);

    await request(server)
      .post(`${workflowBoundarySessionPath(workflow.id, session.id)}/answers`)
      .send({ question_id: question.id, text: 'Leader answer.', actor_id: 'actor-leader' })
      .expect(201);
    await request(server)
      .post(`${workflowBoundarySessionPath(workflow.id, session.id)}/continue`)
      .send({ actor_id: 'actor-leader', leader_input_markdown: 'Please propose a summary.' })
      .expect(201);
    const rounds = await repository.listBoundaryRounds(session.id);
    await terminalizeBoundaryRound(app, repository, rounds[1], {
      schema_version: 'boundary_round_result.v1',
      session_id: session.id,
      round_id: rounds[1].id,
      questions: [],
      proposed_decisions: [],
      summary_proposal: boundarySummaryProposal(),
      needs_leader_input: false,
      public_summary: 'Summary proposed.',
    });
    const proposed = await latestBoundarySummaryRevision(repository, session.id);

    await request(server)
      .post(`${workflowBoundarySessionPath(workflow.id, session.id)}/summary-revisions/${proposed.id}/request-changes`)
      .send({ actor_id: 'actor-random', feedback_markdown: 'Non-Leader feedback.' })
      .expect(403);
    await submitBoundarySummaryRevision(server, workflow.id, proposed.id, 'actor-leader').expect(201);
    await approveBoundarySummaryRevision(server, workflow.id, proposed.id, 'actor-random').expect(403);
  });

  it('uses the session Leader snapshot after item Leader/delegate changes', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    const { workflow, session } = await startWorkflowAndBoundaryBrainstorming(app, plan, item, {
      actor_id: 'actor-leader',
      leader_actor_id: 'actor-leader',
      leader_delegate_actor_ids: ['actor-delegate'],
    });
    await repository.saveDevelopmentPlanItem({
      ...(await repository.getDevelopmentPlanItem(item.id))!,
      leader_actor_id: 'actor-new-leader',
      leader_delegate_actor_ids: ['actor-new-delegate'],
    });
    const [round] = await repository.listBoundaryRounds(session.id);
    await terminalizeBoundaryRound(app, repository, round, {
      schema_version: 'boundary_round_result.v1',
      session_id: session.id,
      round_id: round.id,
      questions: [{ text: 'Does the original delegate still have authority?', required: true }],
      proposed_decisions: [],
      needs_leader_input: true,
      public_summary: 'Question proposed.',
    });
    const [question] = await repository.listBoundaryQuestions(session.id);

    await request(server)
      .post(`${workflowBoundarySessionPath(workflow.id, session.id)}/answers`)
      .send({ question_id: question.id, text: 'Original delegate answer.', actor_id: 'actor-delegate' })
      .expect(201);
    await request(server)
      .post(`${workflowBoundarySessionPath(workflow.id, session.id)}/decisions`)
      .send({ text: 'New item Leader should not affect this session.', actor_id: 'actor-new-leader' })
      .expect(403);
  });

  it('rejects proposed Boundary Summary approval without question and decision evidence', async () => {
    const first = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const { workflow: firstWorkflow, session: firstSession } = await startWorkflowAndBoundaryBrainstorming(app, first.plan, first.item, {
      actor_id: 'actor-leader',
      leader_actor_id: 'actor-leader',
    });
    let rounds = await repository.listBoundaryRounds(firstSession.id);
    await terminalizeBoundaryRound(app, repository, rounds[0], {
      schema_version: 'boundary_round_result.v1',
      session_id: firstSession.id,
      round_id: rounds[0].id,
      questions: [],
      proposed_decisions: [],
      summary_proposal: boundarySummaryProposal(),
      needs_leader_input: false,
      public_summary: 'Summary proposed without evidence.',
    });
    const noQuestionProposal = await latestBoundarySummaryRevision(repository, firstSession.id);

    await submitBoundarySummaryRevision(server, firstWorkflow.id, noQuestionProposal.id, 'actor-leader').expect(201);
    await approveBoundarySummaryRevision(server, firstWorkflow.id, noQuestionProposal.id, 'actor-leader')
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('question and decision evidence');
      });

    const second = await seedDevelopmentPlanItem(app);
    const { workflow: secondWorkflow, session: secondSession } = await startWorkflowAndBoundaryBrainstorming(app, second.plan, second.item, {
      actor_id: 'actor-leader',
      leader_actor_id: 'actor-leader',
    });
    rounds = await repository.listBoundaryRounds(secondSession.id);
    await terminalizeBoundaryRound(app, repository, rounds[0], {
      schema_version: 'boundary_round_result.v1',
      session_id: secondSession.id,
      round_id: rounds[0].id,
      questions: [{ text: 'Which exact files are in scope?', required: true }],
      proposed_decisions: [],
      needs_leader_input: true,
      public_summary: 'Question proposed.',
    });
    const [question] = await repository.listBoundaryQuestions(secondSession.id);
    await request(server)
      .post(`${workflowBoundarySessionPath(secondWorkflow.id, secondSession.id)}/answers`)
      .send({ question_id: question.id, text: 'Only API tests are in scope.', actor_id: 'actor-leader' })
      .expect(201);
    await request(server)
      .post(`${workflowBoundarySessionPath(secondWorkflow.id, secondSession.id)}/continue`)
      .send({ actor_id: 'actor-leader', leader_input_markdown: 'Please propose the Boundary Summary.' })
      .expect(201);
    rounds = await repository.listBoundaryRounds(secondSession.id);
    await terminalizeBoundaryRound(app, repository, rounds[1], {
      schema_version: 'boundary_round_result.v1',
      session_id: secondSession.id,
      round_id: rounds[1].id,
      questions: [],
      proposed_decisions: [],
      summary_proposal: boundarySummaryProposal(),
      needs_leader_input: false,
      public_summary: 'Summary proposed without decisions.',
    });
    const noDecisionProposal = await latestBoundarySummaryRevision(repository, secondSession.id);

    await submitBoundarySummaryRevision(server, secondWorkflow.id, noDecisionProposal.id, 'actor-leader').expect(201);
    await approveBoundarySummaryRevision(server, secondWorkflow.id, noDecisionProposal.id, 'actor-leader')
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('question and decision evidence');
      });
  });

  it('drives multi-round Boundary Brainstorming through required-question closure', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    const { workflow, session } = await startWorkflowAndBoundaryBrainstorming(app, plan, item, {
      actor_id: 'actor-leader',
      leader_actor_id: 'actor-leader',
    });

    expect(session).toMatchObject({
      status: 'ai_turn_running',
      current_round_id: expect.any(String),
    });
    let rounds = await repository.listBoundaryRounds(session.id);
    expect(rounds).toMatchObject([{ round_number: 1, trigger: 'start', status: 'queued' }]);
    const firstRoundRuntime = await runtimeJobActionForRound(repository, rounds[0]);
    expect(firstRoundRuntime.actionRun).toMatchObject({
      action_type: 'run_boundary_brainstorming_round',
      target_object_type: 'boundary_round',
      target_object_id: rounds[0].id,
      status: 'running',
      action_input_json: expect.objectContaining({
        round_id: rounds[0].id,
        precondition_fingerprint_json: expect.any(Object),
      }),
    });

    await terminalizeBoundaryRound(app, repository, rounds[0], {
      schema_version: 'boundary_round_result.v1',
      session_id: session.id,
      round_id: rounds[0].id,
      questions: [{ text: 'What is the narrow runtime boundary?', required: true, rationale: 'Spec generation depends on it.' }],
      proposed_decisions: [{ text: 'Keep worker auth out of this API slice.', rationale: 'Task 7 owns terminal writers.' }],
      needs_leader_input: true,
      public_summary: 'Round 1 questions are ready.',
    });
    await expect(repository.getBrainstormingSession(session.id)).resolves.toMatchObject({
      status: 'waiting_for_leader',
      approval_state: 'questions_open',
    });
    const [roundOneQuestion] = await repository.listBoundaryQuestions(session.id);

    await request(server)
      .post(`${workflowBoundarySessionPath(workflow.id, session.id)}/answers`)
      .send({
        question_id: roundOneQuestion.id,
        text: 'Keep Task 3 scoped to the Brainstorming API; do not use auth.json or http://127.0.0.1:7897.',
        actor_id: 'actor-leader',
      })
      .expect(201);
    await request(server)
      .post(`${workflowBoundarySessionPath(workflow.id, session.id)}/continue`)
      .send({ actor_id: 'actor-leader', leader_input_markdown: 'Continue from ~/.codex/config.toml with a proposed summary.' })
      .expect(201);
    rounds = await repository.listBoundaryRounds(session.id);
    expect(rounds).toHaveLength(2);
    expect(rounds[1]).toMatchObject({ round_number: 2, trigger: 'leader_answer' });
    const roundTwoRuntime = await repository.getCodexRuntimeJob({ runtime_job_id: rounds[1].runtime_job_id! });
    const roundTwoSignedContext = roundTwoRuntime?.workspace_acquisition_json?.signed_context_json as Record<string, unknown>;
    expect(JSON.stringify(roundTwoSignedContext)).not.toContain('~/.codex');
    expect(JSON.stringify(roundTwoSignedContext)).not.toContain('config.toml');
    expect(JSON.stringify(roundTwoSignedContext)).not.toContain('auth.json');
    expect(JSON.stringify(roundTwoSignedContext)).not.toContain('127.0.0.1');
    expect(roundTwoSignedContext).toMatchObject({
      boundary_history: {
        questions: expect.arrayContaining([
          expect.objectContaining({ id: roundOneQuestion.id, summary: 'What is the narrow runtime boundary?', status: 'answered' }),
        ]),
        answers: expect.arrayContaining([
          expect.objectContaining({
            question_id: roundOneQuestion.id,
            summary: 'Keep Task 3 scoped to the Brainstorming API; do not use [runtime-redacted] or [runtime-redacted].',
          }),
        ]),
        decisions: expect.arrayContaining([
          expect.objectContaining({ summary: 'Keep worker auth out of this API slice.', state: 'proposed' }),
        ]),
      },
    });

    await terminalizeBoundaryRound(app, repository, rounds[1], {
      schema_version: 'boundary_round_result.v1',
      session_id: session.id,
      round_id: rounds[1].id,
      questions: [],
      proposed_decisions: [],
      summary_proposal: boundarySummaryProposal({ confirmed_scope: ['Initial proposed scope'] }),
      needs_leader_input: false,
      public_summary: 'Round 2 summary proposed.',
    });
    const firstProposal = await latestBoundarySummaryRevision(repository, session.id);
    expect(firstProposal).toMatchObject({ status: 'proposed', source_round_id: rounds[1].id });

    await request(server)
      .post(`${workflowBoundarySessionPath(workflow.id, session.id)}/summary-revisions/${firstProposal.id}/request-changes`)
      .send({ actor_id: 'actor-leader', feedback_markdown: 'Tighten the runtime scheduling language.' })
      .expect(201);
    await expect(repository.listBoundarySummaryRevisions(firstProposal.boundary_summary_id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstProposal.id,
          status: 'superseded',
        }),
      ]),
    );
    await expect(repository.listBoundaryDecisions(session.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'Tighten the runtime scheduling language.',
          state: 'rejected',
        }),
      ]),
    );
    rounds = await repository.listBoundaryRounds(session.id);
    expect(rounds).toHaveLength(3);
    expect(rounds[2]).toMatchObject({ round_number: 3, trigger: 'leader_revision_request' });
    const roundThreeRuntime = await repository.getCodexRuntimeJob({ runtime_job_id: rounds[2].runtime_job_id! });
    expect((roundThreeRuntime?.workspace_acquisition_json?.signed_context_json as Record<string, unknown>)).toMatchObject({
      boundary_history: {
        summary_revisions: expect.arrayContaining([
          expect.objectContaining({
            id: firstProposal.id,
            status: 'superseded',
            summary: expect.stringContaining('Boundary Summary'),
          }),
        ]),
        decisions: expect.arrayContaining([
          expect.objectContaining({ summary: 'Tighten the runtime scheduling language.', state: 'rejected' }),
        ]),
      },
    });

    await terminalizeBoundaryRound(app, repository, rounds[2], {
      schema_version: 'boundary_round_result.v1',
      session_id: session.id,
      round_id: rounds[2].id,
      questions: [{ text: 'Can the required question be waived by a Leader decision?', required: true }],
      proposed_decisions: [],
      summary_proposal: boundarySummaryProposal({ confirmed_scope: ['Tight runtime scheduling boundary'] }),
      needs_leader_input: false,
      public_summary: 'Round 3 summary proposed.',
    });
    const finalProposal = await latestBoundarySummaryRevision(repository, session.id);

    await submitBoundarySummaryRevision(server, workflow.id, finalProposal.id, 'actor-leader').expect(201);
    await approveBoundarySummaryRevision(server, workflow.id, finalProposal.id, 'actor-leader').expect(409);

    const requiredQuestions = await repository.listBoundaryQuestions(session.id);
    await request(server)
      .post(`/plan-item-workflows/${workflow.id}/request-boundary-changes`)
      .send({
        actor_id: 'actor-leader',
        rejected_revision_id: finalProposal.id,
        reason: 'Return to brainstorming so the Leader can waive the follow-up question.',
      })
      .expect(201);
    await repository.updateBoundarySummaryRevision({ ...finalProposal, status: 'proposed' });
    await request(server)
      .post(`${workflowBoundarySessionPath(workflow.id, session.id)}/decisions`)
      .send({
        text: 'Waive the follow-up question because the first answer already closes the runtime boundary.',
        actor_id: 'actor-leader',
        waived_question_id: requiredQuestions[1].id,
      })
      .expect(201);
    await submitBoundarySummaryRevision(server, workflow.id, finalProposal.id, 'actor-leader').expect(201);
    await approveBoundarySummaryRevision(server, workflow.id, finalProposal.id, 'actor-leader', 'Approve proposed Boundary Summary revision.').expect(
      201,
    );
    await expect(repository.listBoundarySummaryRevisions(finalProposal.boundary_summary_id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: finalProposal.id,
          status: 'approved',
          approved_by_actor_id: 'actor-leader',
        }),
      ]),
    );
  });

  it('approves a proposed Boundary Summary when every required question is waived by an accepted decision', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const { workflow, session } = await startWorkflowAndBoundaryBrainstorming(app, plan, item, {
      actor_id: 'actor-leader',
      leader_actor_id: 'actor-leader',
    });

    let rounds = await repository.listBoundaryRounds(session.id);
    await terminalizeBoundaryRound(app, repository, rounds[0], {
      schema_version: 'boundary_round_result.v1',
      session_id: session.id,
      round_id: rounds[0].id,
      questions: [{ text: 'Can the implementation scope question be waived?', required: true }],
      proposed_decisions: [],
      needs_leader_input: true,
      public_summary: 'Boundary question generated.',
    });
    const [question] = await repository.listBoundaryQuestions(session.id);
    await request(server)
      .post(`${workflowBoundarySessionPath(workflow.id, session.id)}/decisions`)
      .send({
        text: 'Waive the required question because the approved PRD already fixes the implementation scope.',
        actor_id: 'actor-leader',
        waived_question_id: question!.id,
      })
      .expect(201);
    await request(server)
      .post(`${workflowBoundarySessionPath(workflow.id, session.id)}/continue`)
      .send({ actor_id: 'actor-leader', leader_input_markdown: 'Propose the Boundary Summary after the waiver.' })
      .expect(201);
    rounds = await repository.listBoundaryRounds(session.id);
    await terminalizeBoundaryRound(app, repository, rounds[1], {
      schema_version: 'boundary_round_result.v1',
      session_id: session.id,
      round_id: rounds[1].id,
      questions: [],
      proposed_decisions: [],
      summary_proposal: boundarySummaryProposal(),
      needs_leader_input: false,
      public_summary: 'Boundary Summary proposed.',
    });
    const proposal = await latestBoundarySummaryRevision(repository, session.id);

    await submitBoundarySummaryRevision(server, workflow.id, proposal.id, 'actor-leader').expect(201);
    await approveBoundarySummaryRevision(server, workflow.id, proposal.id, 'actor-leader', 'Approve proposed Boundary Summary revision.').expect(
      201,
    );
  });

  it('applies boundary round terminal results only while the action-run precondition is still current', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const resultWriter = app.get(ProductGenerationResultService);
    const codexRuntimeService = app.get(CodexRuntimeService);

    const { session } = await startWorkflowAndBoundaryBrainstorming(app, plan, item, {
      actor_id: 'actor-leader',
      leader_actor_id: 'actor-leader',
    });
    const [round] = await repository.listBoundaryRounds(session.id);
    const { runtimeJobId: currentRuntimeJobId, actionRun } = await runtimeJobActionForRound(repository, round);
    const currentTerminalResult = generationTerminalResult('boundary_brainstorming_round', {
      schema_version: 'boundary_round_result.v1',
      session_id: session.id,
      round_id: round.id,
      questions: [{ text: 'Which exact files are in scope?', required: true }],
      proposed_decisions: [{ text: 'Keep this slice limited to result writers.' }],
      needs_leader_input: true,
      public_summary: 'Boundary questions generated.',
      artifacts: [],
    });

    const currentRuntimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: currentRuntimeJobId }))!;
    const { sessionToken, terminalAt } = await startGenerationRuntimeJob(repository, currentRuntimeJob, 'boundary-current');
    await codexRuntimeService.terminalizeRuntimeJob(
      currentRuntimeJob.worker_id,
      currentRuntimeJob.id,
      withBodyDigest({
        worker_session_token: sessionToken,
        nonce: 'boundary-current-terminal',
        nonce_timestamp: terminalAt,
        launch_lease_id: currentRuntimeJob.launch_lease_id,
        terminal_status: 'succeeded',
        reason_code: 'completed',
        terminal_idempotency_key: 'boundary-current-terminal',
        terminal_result_json: currentTerminalResult,
      }),
    );
    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: currentRuntimeJobId,
        actionRunId: actionRun.id,
        terminalResult: currentTerminalResult,
      }),
    ).resolves.toEqual({ applied: true });
    await expect(repository.listBoundaryQuestions(session.id)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ text: 'Which exact files are in scope?', status: 'open' })]),
    );
    const questionsAfterFirstApply = await repository.listBoundaryQuestions(session.id);
    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: currentRuntimeJobId,
        actionRunId: actionRun.id,
        terminalResult: currentTerminalResult,
      }),
    ).resolves.toEqual({ applied: true });
    await expect(repository.listBoundaryQuestions(session.id)).resolves.toHaveLength(questionsAfterFirstApply.length);
    await expect(repository.listObjectEvents(actionRun.id, 'automation_action_run')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'product_generation_result_applied',
          metadata: expect.objectContaining({
            runtime_job_id: currentRuntimeJobId,
            generated_object_type: 'boundary_round',
            boundary_round_id: round.id,
          }),
        }),
      ]),
    );

    const staleSeed = await seedDevelopmentPlanItem(app);
    const { session: staleSession } = await startWorkflowAndBoundaryBrainstorming(app, staleSeed.plan, staleSeed.item, {
      actor_id: 'actor-leader',
      leader_actor_id: 'actor-leader',
    });
    const [staleRound] = await repository.listBoundaryRounds(staleSession.id);
    const { runtimeJobId: staleRuntimeJobId, actionRun: staleActionRun } = await runtimeJobActionForRound(repository, staleRound);
    await repository.saveDevelopmentPlanItem({
      ...(await repository.getDevelopmentPlanItem(staleSeed.item.id))!,
      revision_id: 'stale-item-revision-after-action-run',
      updated_at: '2026-05-05T00:02:00.000Z',
    });

    const staleTerminalResult = generationTerminalResult('boundary_brainstorming_round', {
      schema_version: 'boundary_round_result.v1',
      session_id: staleSession.id,
      round_id: staleRound.id,
      questions: [{ text: 'This stale question must not be persisted.', required: true }],
      proposed_decisions: [],
      needs_leader_input: true,
      public_summary: 'Stale boundary questions generated.',
      artifacts: [],
    });
    await terminalizeGenerationRuntimeJob(repository, (await repository.getCodexRuntimeJob({ runtime_job_id: staleRuntimeJobId }))!, staleTerminalResult, 'boundary-stale');
    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: staleRuntimeJobId,
        actionRunId: staleActionRun.id,
        terminalResult: staleTerminalResult,
      }),
    ).resolves.toEqual({ applied: false, reason: 'stale_precondition_fingerprint' });
    await expect(repository.listBoundaryQuestions(staleSession.id)).resolves.toEqual([]);
  });

  it('rejects legacy direct boundary approval without creating approved summary state', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const { session } = await startWorkflowAndBoundaryBrainstorming(app, plan, item, {
      actor_id: 'actor-tech',
      leader_actor_id: 'actor-tech',
    });

    const itemRevisionsBefore = await repository.listDevelopmentPlanItemRevisions(item.id);
    const planRevisionsBefore = await repository.listDevelopmentPlanRevisions(plan.id);
    const saveBoundarySummarySpy = vi.spyOn(repository, 'saveBoundarySummary');

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
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });

    expect(saveBoundarySummarySpy).not.toHaveBeenCalled();
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ boundary_status: 'in_progress' });
    await expect(repository.listDevelopmentPlanItemRevisions(item.id)).resolves.toHaveLength(itemRevisionsBefore.length);
    await expect(repository.listDevelopmentPlanRevisions(plan.id)).resolves.toHaveLength(planRevisionsBefore.length);
  });

  it('rejects answer and decision mutations after boundary approval', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const { workflow, session, question, approved } = await approveBoundaryThroughRounds(app, plan, item);
    const approvedSession = await repository.getBrainstormingSession(session.id);
    expect(approvedSession).toMatchObject({
      approval_state: 'approved',
      revision_id: approved.revision_id,
      boundary_summary_id: approved.boundary_summary_id,
    });

    await request(server)
      .post(`${workflowBoundarySessionPath(workflow.id, session.id)}/answers`)
      .send({
        question_id: question.id,
        text: 'Late answer after approval.',
        actor_id: 'actor-tech',
      })
      .expect(400);

    await request(server)
      .post(`${workflowBoundarySessionPath(workflow.id, session.id)}/decisions`)
      .send({
        text: 'Late decision after approval.',
        rationale: 'This should not mutate an approved boundary.',
        actor_id: 'actor-tech',
      })
      .expect(400);

    const persistedSession = await repository.getBrainstormingSession(session.id);
    const persistedBoundarySummary = await repository.getBoundarySummary(approved.boundary_summary_id);
    expect(persistedSession).toMatchObject({
      approval_state: 'approved',
      revision_id: approved.revision_id,
      boundary_summary_id: approved.boundary_summary_id,
    });
    await expect(repository.listBoundaryAnswers(session.id)).resolves.toHaveLength(1);
    await expect(repository.listBoundaryDecisions(session.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'Keep implementation scoped to Web IA and route tests.' }),
        expect.objectContaining({ text: 'Approve proposed Boundary Summary revision.' }),
      ]),
    );
    expect((persistedBoundarySummary as { brainstorming_session_revision_id?: string })?.brainstorming_session_revision_id).toBe(
      persistedSession?.revision_id,
    );
  });

  it('rejects repeated boundary approval without creating new revisions', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const { workflow, session, proposal, approved } = await approveBoundaryThroughRounds(app, plan, item);
    const approvedSession = await repository.getBrainstormingSession(session.id);
    const approvedBoundarySummary = await repository.getBoundarySummary(approved.boundary_summary_id);
    const itemRevisionsBefore = await repository.listDevelopmentPlanItemRevisions(item.id);
    const planRevisionsBefore = await repository.listDevelopmentPlanRevisions(plan.id);

    await approveBoundarySummaryRevision(server, workflow.id, proposal.id, 'actor-tech', 'Attempt to approve twice.').expect(400);

    const persistedSession = await repository.getBrainstormingSession(session.id);
    const persistedBoundarySummary = await repository.getBoundarySummary(approved.boundary_summary_id);
    expect(persistedSession?.revision_id).toBe(approvedSession?.revision_id);
    expect(persistedBoundarySummary).toEqual(approvedBoundarySummary);
    await expect(repository.listDevelopmentPlanItemRevisions(item.id)).resolves.toHaveLength(itemRevisionsBefore.length);
    await expect(repository.listDevelopmentPlanRevisions(plan.id)).resolves.toHaveLength(planRevisionsBefore.length);
  });

  it('rejects starting a new session after item boundary approval without changing revisions', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await approveBoundaryThroughRounds(app, plan, item);

    const approvedItem = await repository.getDevelopmentPlanItem(item.id);
    const itemRevisionsBefore = await repository.listDevelopmentPlanItemRevisions(item.id);
    const planRevisionsBefore = await repository.listDevelopmentPlanRevisions(plan.id);

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/brainstorming-sessions`)
      .send({ actor_id: 'actor-tech' })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });

    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toEqual(approvedItem);
    await expect(repository.listDevelopmentPlanItemRevisions(item.id)).resolves.toHaveLength(itemRevisionsBefore.length);
    await expect(repository.listDevelopmentPlanRevisions(plan.id)).resolves.toHaveLength(planRevisionsBefore.length);
  });

  it('rejects legacy direct approval from a second session without creating a summary or revisions', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const { session: secondSession } = await startWorkflowAndBoundaryBrainstorming(app, plan, item, {
      actor_id: 'actor-tech',
      leader_actor_id: 'actor-tech',
    });
    const itemBefore = await repository.getDevelopmentPlanItem(item.id);
    const itemRevisionsBefore = await repository.listDevelopmentPlanItemRevisions(item.id);
    const planRevisionsBefore = await repository.listDevelopmentPlanRevisions(plan.id);
    const saveBoundarySummarySpy = vi.spyOn(repository, 'saveBoundarySummary');

    await approveBoundary(server, secondSession, {
      confirmed_scope: ['Stale session should not create a second boundary summary'],
      actor_id: 'actor-reviewer',
      final_decision: 'Attempt stale approval.',
    }).expect(409);

    expect(saveBoundarySummarySpy).not.toHaveBeenCalled();
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toEqual(itemBefore);
    await expect(repository.listDevelopmentPlanItemRevisions(item.id)).resolves.toHaveLength(itemRevisionsBefore.length);
    await expect(repository.listDevelopmentPlanRevisions(plan.id)).resolves.toHaveLength(planRevisionsBefore.length);
    const persistedSecondSession = await repository.getBrainstormingSession(secondSession.id);
    expect(persistedSecondSession).toMatchObject({ approval_state: 'draft' });
    expect(persistedSecondSession?.boundary_summary_id).toBeUndefined();
  });

  it('starts workflow-scoped brainstorming sessions under locks and transactions', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const lockKeys: string[] = [];
    const transactionMarkers: string[] = [];
    const originalWithObjectLock = repository.withObjectLock.bind(repository);
    const originalWithDeliveryTransaction = repository.withDeliveryTransaction.bind(repository);
    vi.spyOn(repository, 'withObjectLock').mockImplementation((key, write) => {
      lockKeys.push(key);
      return originalWithObjectLock(key, write);
    });
    vi.spyOn(repository, 'withDeliveryTransaction').mockImplementation((write) =>
      originalWithDeliveryTransaction(async (transaction) => {
        transactionMarkers.push('started');
        return write(transaction);
      }),
    );

    const { workflow, session } = await startWorkflowAndBoundaryBrainstorming(app, plan, item, {
      actor_id: 'actor-tech',
      leader_actor_id: 'actor-tech',
    });

    expect(lockKeys).toEqual([`development-plan:${plan.id}`, `plan-item-workflow:${workflow.id}`, `development-plan:${plan.id}`]);
    expect(transactionMarkers).toEqual(['started', 'started', 'started']);
    await expect(repository.getContextManifest(session.context_manifest_id)).resolves.toMatchObject({
      development_plan_id: plan.id,
      development_plan_item_id: item.id,
    });
    await expect(repository.getBrainstormingSession(session.id)).resolves.toMatchObject({
      id: session.id,
      context_manifest_id: session.context_manifest_id,
    });
    await expect(repository.listObjectEvents(item.id, 'development_plan_item')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'brainstorming_session_started',
          metadata: expect.objectContaining({ brainstorming_session_id: session.id }),
        }),
      ]),
    );
  });
});

describe('product generation automation action schemas', () => {
  it.each([
    'run_boundary_brainstorming_round',
    'generate_development_plan_item_spec_revision',
    'generate_development_plan_item_implementation_plan_revision',
  ])('rejects %s without precondition_fingerprint_json', (actionType) => {
    const body = productGenerationActionBody(actionType);
    delete (body.action_input_json as Record<string, unknown>).precondition_fingerprint_json;

    expect(createAutomationActionRunSchema.safeParse(body).success).toBe(false);
  });

  it('rejects stale development_plan_item_revision_id in product generation preconditions', () => {
    const body = productGenerationActionBody('run_boundary_brainstorming_round');
    (body.action_input_json as Record<string, unknown>).development_plan_item_revision_id = 'item-revision-stale';

    expect(createAutomationActionRunSchema.safeParse(body).success).toBe(false);
  });

  it('rejects Boundary Brainstorming actions without a round id', () => {
    const body = productGenerationActionBody('run_boundary_brainstorming_round');
    delete (body.action_input_json as Record<string, unknown>).round_id;

    expect(createAutomationActionRunSchema.safeParse(body).success).toBe(false);
  });

  it('rejects Spec generation without an approved Boundary Summary revision', () => {
    const body = productGenerationActionBody('generate_development_plan_item_spec_revision');
    delete (body.action_input_json as Record<string, unknown>).approved_boundary_summary_revision_id;

    expect(createAutomationActionRunSchema.safeParse(body).success).toBe(false);
  });

  it('rejects Implementation Plan Doc generation without an approved Spec revision', () => {
    const body = productGenerationActionBody('generate_development_plan_item_implementation_plan_revision');
    delete (body.action_input_json as Record<string, unknown>).approved_spec_revision_id;

    expect(createAutomationActionRunSchema.safeParse(body).success).toBe(false);
  });

  it('rejects product generation action precondition fingerprints that do not match the canonical digest', () => {
    const body = productGenerationActionBody('generate_development_plan_item_spec_revision', {
      precondition_fingerprint: 'sha256:not-the-canonical-digest',
    });

    expect(createAutomationActionRunSchema.safeParse(body).success).toBe(false);
  });
});

async function approveBoundaryThroughRounds(
  app: INestApplication,
  plan: { id: string },
  item: { id: string },
  actorId = 'actor-tech',
) {
  const server = app.getHttpServer();
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const { workflow, session } = await startWorkflowAndBoundaryBrainstorming(app, plan, item, {
    actor_id: actorId,
    leader_actor_id: actorId,
  });
  let rounds = await repository.listBoundaryRounds(session.id);
  await terminalizeBoundaryRound(app, repository, rounds[0], {
    schema_version: 'boundary_round_result.v1',
    session_id: session.id,
    round_id: rounds[0].id,
    questions: [{ text: 'Which exact files are in scope?', required: true }],
    proposed_decisions: [{ text: 'Keep implementation scoped to Web IA and route tests.' }],
    needs_leader_input: true,
    public_summary: 'Boundary questions generated.',
  });
  const [question] = await repository.listBoundaryQuestions(session.id);
  await request(server)
    .post(`${workflowBoundarySessionPath(workflow.id, session.id)}/answers`)
    .send({
      question_id: question.id,
      text: 'Keep implementation scoped to Web IA and route tests.',
      actor_id: actorId,
    })
    .expect(201);
  await request(server)
    .post(`${workflowBoundarySessionPath(workflow.id, session.id)}/continue`)
    .send({ actor_id: actorId, leader_input_markdown: 'Please propose the Boundary Summary.' })
    .expect(201);
  rounds = await repository.listBoundaryRounds(session.id);
  await terminalizeBoundaryRound(app, repository, rounds[1], {
    schema_version: 'boundary_round_result.v1',
    session_id: session.id,
    round_id: rounds[1].id,
    questions: [],
    proposed_decisions: [],
    summary_proposal: boundarySummaryProposal(),
    needs_leader_input: false,
    public_summary: 'Boundary Summary proposed.',
  });
  const proposal = await latestBoundarySummaryRevision(repository, session.id);
  await submitBoundarySummaryRevision(server, workflow.id, proposal.id, actorId).expect(201);
  await approveBoundarySummaryRevision(server, workflow.id, proposal.id, actorId, 'Approve proposed Boundary Summary revision.').expect(201);
  const approved = await repository.getBrainstormingSession(session.id);
  if (approved?.revision_id === undefined || approved.boundary_summary_id === undefined) {
    throw new Error(`Expected Boundary Brainstorming Session ${session.id} to be approved`);
  }

  return { workflow, session, question, proposal, approved };
}

async function makeSessionReadyForApproval(
  server: ReturnType<INestApplication['getHttpServer']>,
  session: { id: string; questions: { id: string; text: string }[] },
  actorId = 'actor-tech',
) {
  for (const question of session.questions) {
    await request(server)
      .post(`/brainstorming-sessions/${session.id}/answers`)
      .send({
        question_id: question.id,
        text: `Answered boundary question: ${question.text}`,
        actor_id: actorId,
      })
      .expect(201);
  }
  await request(server)
    .post(`/brainstorming-sessions/${session.id}/decisions`)
    .send({
      text: 'Keep implementation scoped to Web IA and route tests.',
      actor_id: actorId,
    })
    .expect(201);
}

function approveBoundary(
  server: ReturnType<INestApplication['getHttpServer']>,
  session: { id: string },
  overrides: Partial<{
    confirmed_scope: string[];
    confirmed_out_of_scope: string[];
    accepted_assumptions: string[];
    open_risks: string[];
    validation_expectations: string[];
    actor_id: string;
    final_decision: string;
  }> = {},
) {
  return request(server)
    .post(`/brainstorming-sessions/${session.id}/approve-boundary`)
    .send({
      confirmed_scope: ['Web IA and Development Plan Item gate UX'],
      confirmed_out_of_scope: ['Runtime scheduler changes'],
      accepted_assumptions: ['Mock Codex question generation is sufficient for this slice'],
      open_risks: ['Execution queue depends on existing runtime adapters'],
      validation_expectations: ['Route tests and screenshot checks pass'],
      actor_id: 'actor-tech',
      final_decision: 'Approve after all questions and one prior decision.',
      ...overrides,
    });
}

async function seedDevelopmentPlanItem(app: INestApplication) {
  const { project, requirement } = await seedRequirement(app);
  await seedBoundaryGenerationRuntimeForProject(app, project.id);
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
        reviewer_actor_id: 'actor-leader',
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

function boundarySummaryProposal(overrides: Partial<{
  summary_markdown: string;
  confirmed_scope: string[];
  confirmed_out_of_scope: string[];
  accepted_assumptions: string[];
  open_risks: string[];
  validation_expectations: string[];
}> = {}) {
  return {
    summary_markdown: '# Boundary Summary\n\nTask 3 remains scoped to boundary brainstorming.',
    confirmed_scope: ['Boundary Brainstorming API'],
    confirmed_out_of_scope: ['Worker terminal endpoint'],
    accepted_assumptions: ['Runtime terminal writers land in a later task'],
    open_risks: ['Action scheduling must keep precondition fences stable'],
    validation_expectations: ['API tests pass'],
    ...overrides,
  };
}

function generationTerminalResult(
  taskKind: CodexGenerationRuntimeJobResult['task_kind'],
  generatedPayload: Record<string, unknown>,
): CodexGenerationRuntimeJobResult {
  const generationContracts: Record<string, { promptVersion: string; outputSchemaVersion: string }> = {
    boundary_brainstorming_round: {
      promptVersion: 'boundary-brainstorming-round:v1',
      outputSchemaVersion: 'boundary_round_result.v1',
    },
  };
  const contract = generationContracts[taskKind] ?? { promptVersion: 'prompt-v1', outputSchemaVersion: `${taskKind}.v1` };
  return {
    task_kind: taskKind,
    prompt_version: contract.promptVersion,
    output_schema_version: contract.outputSchemaVersion,
    generated_payload: generatedPayload,
    generated_payload_digest: codexCanonicalDigest(generatedPayload),
    generation_artifacts: [],
    public_summary: 'Generated product artifact.',
  };
}

async function runtimeJobActionForRound(repository: DeliveryRepository, round: { runtime_job_id?: string | undefined }) {
  expect(round.runtime_job_id).toBeDefined();
  const runtimeJob = await repository.getCodexRuntimeJob({ runtime_job_id: round.runtime_job_id! });
  expect(runtimeJob).toBeDefined();
  const actionRun = await repository.getAutomationActionRun(runtimeJob!.target_id);
  expect(actionRun).toBeDefined();
  return { runtimeJobId: runtimeJob!.id, actionRun: actionRun! };
}

async function terminalizeBoundaryRound(
  app: INestApplication,
  repository: DeliveryRepository,
  round: { runtime_job_id?: string | undefined },
  generatedPayload: Record<string, unknown>,
) {
  expect(round.runtime_job_id).toBeDefined();
  const runtimeJob = await repository.getCodexRuntimeJob({ runtime_job_id: round.runtime_job_id! });
  expect(runtimeJob).toBeDefined();
  const terminalResult = generationTerminalResult('boundary_brainstorming_round', { artifacts: [], ...generatedPayload });
  const suffix = `boundary-${runtimeJob!.id}`;
  const { sessionToken, terminalAt } = await startGenerationRuntimeJob(repository, runtimeJob!, suffix);
  const codexRuntimeService = app.get(CodexRuntimeService);
  await codexRuntimeService.terminalizeRuntimeJob(
    runtimeJob!.worker_id,
    runtimeJob!.id,
    withBodyDigest({
      worker_session_token: sessionToken,
      nonce: `${suffix}-terminal`,
      nonce_timestamp: terminalAt,
      launch_lease_id: runtimeJob!.launch_lease_id,
      terminal_status: 'succeeded',
      reason_code: 'completed',
      terminal_idempotency_key: `${suffix}-terminal`,
      terminal_result_json: terminalResult,
    }),
  );
}

async function startGenerationRuntimeJob(
  repository: DeliveryRepository,
  runtimeJob: CodexRuntimeJob,
  suffix: string,
): Promise<{ sessionToken: string; terminalAt: string }> {
  const terminalAt = '2026-05-05T00:01:45.000Z';
  const sessionToken =
    runtimeJob.repo_id === undefined
      ? `boundary-session-${runtimeJob.project_id}`
      : `session-${runtimeJob.project_id}-${runtimeJob.repo_id}`;
  const sessionKey =
    runtimeJob.repo_id === undefined
      ? `boundary-session-key-${runtimeJob.project_id}`
      : `session-key-${runtimeJob.project_id}-${runtimeJob.repo_id}`;
  const acceptedSessionDigest = codexCredentialPayloadDigest(sessionToken);
  const envelope = await repository.getCodexRuntimeJobEnvelope({ runtime_job_id: runtimeJob.id });
  expect(envelope).toBeDefined();
  const launchTokenHash = String(envelope!.ciphertext).replace(/^in-memory:/, '');
  const replayProtection = (step: string) => ({
    method: 'POST' as const,
    path: `/test/boundary-generation-runtime/${runtimeJob.id}/${suffix}/${step}`,
    body_digest: digest(`${runtimeJob.id}:${suffix}:${step}:body`),
  });
  await repository.acceptCodexRuntimeJob({
    runtime_job_id: runtimeJob.id,
    worker_id: runtimeJob.worker_id,
    worker_session_token: sessionToken,
    nonce: `${suffix}-accept`,
    nonce_timestamp: terminalAt,
    accepted_worker_session_digest: acceptedSessionDigest,
    accepted_session_public_key_id: sessionKey,
    accepted_session_epoch: 1,
    idempotency_key: `${suffix}-accept`,
    request_digest: digest(`${suffix}:accept`),
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
    accepted_worker_session_digest: acceptedSessionDigest,
    key_id: sessionKey,
    accepted_session_epoch: 1,
    claim_request_id: `${suffix}-claim-envelope`,
    request_digest: digest(`${suffix}:claim-envelope`),
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
    accepted_worker_session_digest: acceptedSessionDigest,
    accepted_session_public_key_id: sessionKey,
    accepted_session_epoch: 1,
    materialization_request_id: `${suffix}-materialize`,
    request_digest: digest(`${suffix}:materialize`),
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
    request_digest: digest(`${suffix}:start`),
    runtime_evidence_digest: digest(`${suffix}:runtime-evidence`),
    launch_materialization_digest: digest(`${suffix}:launch-materialization`),
    replay_protection: replayProtection('start'),
    now: terminalAt,
  });
  return { sessionToken, terminalAt };
}

async function terminalizeGenerationRuntimeJob(
  repository: DeliveryRepository,
  runtimeJob: CodexRuntimeJob,
  terminalResult: CodexGenerationRuntimeJobResult,
  suffix: string,
) {
  const { sessionToken, terminalAt } = await startGenerationRuntimeJob(repository, runtimeJob, suffix);
  const replayProtection = (step: string) => ({
    method: 'POST' as const,
    path: `/test/boundary-generation-runtime/${runtimeJob.id}/${suffix}/${step}`,
    body_digest: digest(`${runtimeJob.id}:${suffix}:${step}:body`),
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
    request_digest: digest(`${suffix}:terminal`),
    replay_protection: replayProtection('terminal'),
    now: terminalAt,
  });
}

async function seedBoundaryGenerationRuntimeForProject(
  app: INestApplication,
  projectId: string,
  overrides: Partial<{ workerNow: string }> = {},
) {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const now = '2026-05-05T00:00:00.000Z';
  const workerNow = overrides.workerNow ?? now;
  const expiresAt = new Date(Date.parse(workerNow) + 10 * 60 * 1000).toISOString();
  const networkPolicy = { mode: 'disabled' as const };
  const profileId = stableUuid({ kind: 'boundary-generation-profile', projectId });
  const profileRevisionId = stableUuid({ kind: 'boundary-generation-profile-revision', projectId });
  const credentialBindingId = stableUuid({ kind: 'boundary-generation-credential-binding', projectId });
  const credentialVersionId = stableUuid({ kind: 'boundary-generation-credential-version', projectId });
  const workerId = stableUuid({ kind: 'boundary-generation-worker', projectId });
  const dockerImageDigest = digest('boundary-docker-image');
  const networkPolicyDigest = codexRuntimeNetworkPolicyDigest(networkPolicy);
  const codexConfigToml = 'approval_policy = "never"\n';
  const revisionWithoutDigest = {
    id: profileRevisionId,
    profile_id: profileId,
    revision_number: 1,
    status: 'active' as const,
    environment: 'test' as const,
    docker_image: 'ghcr.io/forgeloop/codex-worker:test',
    docker_image_digest: dockerImageDigest,
    target_kind: 'generation' as const,
    source_access_mode: 'artifact_only' as const,
    codex_config_toml: codexConfigToml,
    codex_config_digest: codexCanonicalDigest(codexConfigToml),
    expected_effective_config_digest: digest('boundary-effective-config'),
    effective_config_assertions: {
      target_kind: 'generation' as const,
      approval_policy: 'never' as const,
      source_write_policy: 'artifact_only' as const,
      forbidden_writable_roots: ['workspace'] as const,
    },
    app_server_required: true,
    allowed_driver_kind: 'app_server' as const,
    network_policy: networkPolicy,
    resource_limits: {
      cpu_ms: 300_000,
      memory_mb: 1024,
      pids: 256,
      fds: 1024,
      workspace_bytes: 1,
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
      drop_capabilities: ['ALL'],
    },
    allowed_scopes: [{ project_id: projectId }],
    profile_digest: digest('placeholder'),
    created_by_actor_id: 'actor-leader',
    created_at: now,
  } satisfies CodexRuntimeProfileRevision;
  const revision = { ...revisionWithoutDigest, profile_digest: codexRuntimeProfileRevisionDigest(revisionWithoutDigest) };
  await repository.createCodexRuntimeProfileWithRevision({
    profile: {
      id: profileId,
      name: 'Boundary generation test profile',
      environment: 'test',
      target_kind: 'generation',
      active_revision_id: profileRevisionId,
      created_by_actor_id: 'actor-leader',
      created_at: now,
      updated_at: now,
    },
    revision,
  });
  const secretPayload = { auth: { api_key: 'test-api-key' } };
  await repository.createCodexCredentialBindingWithVersion({
    binding: {
      id: credentialBindingId,
      profile_id: profileId,
      project_id: projectId,
      provider: 'unsafe_db',
      purpose: 'model_provider',
      active_version_id: credentialVersionId,
      created_by_actor_id: 'actor-leader',
      created_at: now,
      updated_at: now,
    },
    version: {
      id: credentialVersionId,
      binding_id: credentialBindingId,
      version_number: 1,
      status: 'active',
      payload_digest: codexCredentialPayloadDigest(secretPayload),
      created_by_actor_id: 'actor-leader',
      created_at: now,
    },
    secret_payload_json: secretPayload,
  });
  await repository.createCodexWorkerBootstrapToken({
    id: stableUuid({ kind: 'boundary-generation-bootstrap', projectId }),
    worker_identity: `boundary-worker-${projectId}`,
    bootstrap_token_hash: codexCredentialPayloadDigest(`boundary-bootstrap-${projectId}`),
    bootstrap_token_version: 1,
    status: 'active',
    allowed_scopes_json: [{ project_id: projectId }],
    allowed_capabilities_json: {
      target_kinds: ['generation'],
      docker_image_digests: [dockerImageDigest],
      network_policy_digests: [networkPolicyDigest],
    },
    created_by_actor_id: 'actor-leader',
    created_at: now,
    expires_at: expiresAt,
  });
  await repository.upsertCodexWorkerRegistration({
    worker_id: workerId,
    worker_identity: `boundary-worker-${projectId}`,
    version: 'test-worker',
    bootstrap_token_hash: codexCredentialPayloadDigest(`boundary-bootstrap-${projectId}`),
    bootstrap_token_version: 1,
    session_token: `boundary-session-${projectId}`,
    session_expires_at: expiresAt,
    status: 'online',
    control_channel_status: 'connected',
    allowed_scopes: [{ project_id: projectId }],
    capabilities: ['generation'],
    docker_image_digests: [dockerImageDigest],
    network_policy_digests: [networkPolicyDigest],
    host_worker_uid: 501,
    host_worker_gid: 20,
    lease_count: 0,
    max_concurrency: 100,
    session_public_key_id: `boundary-session-key-${projectId}`,
    session_public_key_algorithm: 'x25519',
    session_public_key_material: 'base64-public-key-material',
    session_public_key_expires_at: expiresAt,
    now: workerNow,
  });
  await repository.heartbeatCodexWorker({
    worker_id: workerId,
    session_token: `boundary-session-${projectId}`,
    nonce: `boundary-heartbeat-${projectId}`,
    nonce_timestamp: workerNow,
    status: 'online',
    control_channel_status: 'connected',
    active_lease_count: 0,
    capabilities: ['generation'],
    now: workerNow,
  });

  vi.stubEnv('FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID', profileId);
  vi.stubEnv('FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID', credentialBindingId);
  vi.stubEnv('FORGELOOP_AUTOMATION_TEST_NOW', new Date(Date.parse(workerNow) + 90_000).toISOString());
}

function stableUuid(input: Record<string, unknown>): string {
  const hex = codexCanonicalDigest(input).slice('sha256:'.length);
  const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function digest(label: string): string {
  return codexCanonicalDigest({ label });
}

async function latestBoundarySummaryRevision(repository: DeliveryRepository, sessionId: string) {
  const session = await repository.getBrainstormingSession(sessionId);
  if (session?.boundary_summary_id === undefined) {
    throw new Error(`Expected session ${sessionId} to have a boundary summary`);
  }
  const revisions = await repository.listBoundarySummaryRevisions(session.boundary_summary_id);
  const revision = revisions.at(-1);
  if (revision === undefined) {
    throw new Error(`Expected boundary summary ${session.boundary_summary_id} to have revisions`);
  }
  return revision;
}

function productGenerationActionBody(actionType: string, overrides: Record<string, unknown> = {}) {
  const basePrecondition = {
    source_ref: { type: 'requirement', id: 'requirement-1' },
    source_revision_id: 'source-revision-1',
    development_plan_id: 'plan-1',
    development_plan_revision_id: 'plan-revision-1',
    development_plan_item_id: 'item-1',
    development_plan_item_revision_id: 'item-revision-1',
    boundary_session_id: 'session-1',
    boundary_session_revision_id: 'session-revision-1',
    boundary_round_id: 'round-1',
    approved_boundary_summary_revision_id: 'boundary-summary-revision-1',
    approved_spec_revision_id: 'spec-revision-1',
    context_manifest_id: 'context-manifest-1',
    context_manifest_revision_id: 'context-manifest-revision-1',
    requested_by_actor_id: 'actor-leader',
  };
  const precondition =
    actionType === 'run_boundary_brainstorming_round'
      ? basePrecondition
      : actionType === 'generate_development_plan_item_spec_revision'
        ? omit(basePrecondition, ['boundary_round_id', 'approved_spec_revision_id'])
        : omit(basePrecondition, ['boundary_round_id']);
  const actionInput =
    actionType === 'run_boundary_brainstorming_round'
      ? {
          development_plan_id: 'plan-1',
          development_plan_revision_id: 'plan-revision-1',
          development_plan_item_id: 'item-1',
          development_plan_item_revision_id: 'item-revision-1',
          session_id: 'session-1',
          session_revision_id: 'session-revision-1',
          round_id: 'round-1',
          operation: 'start',
          context_manifest_id: 'context-manifest-1',
          context_manifest_revision_id: 'context-manifest-revision-1',
          requested_by_actor_id: 'actor-leader',
          precondition_fingerprint_json: precondition,
        }
      : actionType === 'generate_development_plan_item_spec_revision'
        ? {
            development_plan_id: 'plan-1',
            development_plan_revision_id: 'plan-revision-1',
            development_plan_item_id: 'item-1',
            development_plan_item_revision_id: 'item-revision-1',
            boundary_session_id: 'session-1',
            boundary_session_revision_id: 'session-revision-1',
            approved_boundary_summary_revision_id: 'boundary-summary-revision-1',
            context_manifest_id: 'context-manifest-1',
            context_manifest_revision_id: 'context-manifest-revision-1',
            requested_by_actor_id: 'actor-leader',
            precondition_fingerprint_json: precondition,
          }
        : {
            development_plan_id: 'plan-1',
            development_plan_revision_id: 'plan-revision-1',
            development_plan_item_id: 'item-1',
            development_plan_item_revision_id: 'item-revision-1',
            boundary_session_id: 'session-1',
            boundary_session_revision_id: 'session-revision-1',
            approved_boundary_summary_revision_id: 'boundary-summary-revision-1',
            approved_spec_revision_id: 'spec-revision-1',
            context_manifest_id: 'context-manifest-1',
            context_manifest_revision_id: 'context-manifest-revision-1',
            requested_by_actor_id: 'actor-leader',
            precondition_fingerprint_json: precondition,
          };

  return {
    id: `${actionType}-1`,
    action_type: actionType,
    target_object_type: actionType === 'run_boundary_brainstorming_round' ? 'boundary_round' : 'development_plan_item',
    target_object_id: actionType === 'run_boundary_brainstorming_round' ? 'round-1' : 'item-1',
    target_revision_id: 'item-revision-1',
    target_status: 'queued',
    idempotency_key: `${actionType}-1-key`,
    automation_scope: 'project:project-1',
    automation_settings_version: 1,
    capability_fingerprint: 'capability-fingerprint-1',
    precondition_fingerprint: codexCanonicalDigest(precondition),
    action_input_json: actionInput,
    ...overrides,
  };
}

function omit<T extends Record<string, unknown>>(input: T, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([key]) => !keys.includes(key)));
}
