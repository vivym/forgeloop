import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { createAutomationActionRunSchema } from '../../apps/control-plane-api/src/modules/automation/automation.dto';
import { BrainstormingService } from '../../apps/control-plane-api/src/modules/brainstorming/brainstorming.service';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { codexCanonicalDigest } from '../../packages/domain/src';
import type { DeliveryRepository } from '../../packages/db/src';

const expectedQuestions = [
  'Which repos, modules, and product surfaces are in scope?',
  'What is explicitly out of scope for this Development Plan Item?',
  'Which acceptance criteria and validation commands must pass?',
  'What risks or dependency constraints should block generation?',
];

describe('Boundary Brainstorming API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('starts with explicit Leader and delegates and stores the snapshot on the item and session', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    const session = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/boundary-brainstorming`)
        .send({
          actor_id: 'actor-leader',
          leader_actor_id: 'actor-leader',
          leader_delegate_actor_ids: ['actor-delegate'],
        })
        .expect(201)
    ).body;

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

  it('rejects delegate self-escalation during boundary start', async () => {
    const first = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();

    await request(server)
      .post(`/development-plans/${first.plan.id}/items/${first.item.id}/boundary-brainstorming`)
      .send({
        actor_id: 'actor-leader',
        leader_actor_id: 'actor-leader',
        leader_delegate_actor_ids: ['actor-delegate'],
      })
      .expect(201);

    await request(server)
      .post(`/development-plans/${first.plan.id}/items/${first.item.id}/boundary-brainstorming`)
      .send({
        actor_id: 'actor-random',
        leader_actor_id: 'actor-leader',
        leader_delegate_actor_ids: ['actor-delegate', 'actor-random'],
      })
      .expect(403);

    const second = await seedDevelopmentPlanItem(app);
    await request(server)
      .post(`/development-plans/${second.plan.id}/items/${second.item.id}/boundary-brainstorming`)
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
    const service = app.get(BrainstormingService) as BrainstormingService & {
      applyBoundaryRoundTerminalResult?: (input: Record<string, unknown>) => Promise<unknown>;
    };

    const session = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/boundary-brainstorming`)
        .send({
          actor_id: 'actor-leader',
          leader_actor_id: 'actor-leader',
        })
        .expect(201)
    ).body;
    const [round] = await repository.listBoundaryRounds(session.id);
    await service.applyBoundaryRoundTerminalResult?.({
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
      .post(`/boundary-brainstorming-sessions/${session.id}/answers`)
      .send({ question_id: question.id, text: 'Non-Leader answer.', actor_id: 'actor-random' })
      .expect(403);
    await request(server)
      .post(`/boundary-brainstorming-sessions/${session.id}/decisions`)
      .send({ text: 'Non-Leader decision.', actor_id: 'actor-random' })
      .expect(403);
    await request(server)
      .post(`/boundary-brainstorming-sessions/${session.id}/continue`)
      .send({ actor_id: 'actor-random', leader_input_markdown: 'Continue anyway.' })
      .expect(403);

    await request(server)
      .post(`/boundary-brainstorming-sessions/${session.id}/answers`)
      .send({ question_id: question.id, text: 'Leader answer.', actor_id: 'actor-leader' })
      .expect(201);
    await request(server)
      .post(`/boundary-brainstorming-sessions/${session.id}/continue`)
      .send({ actor_id: 'actor-leader', leader_input_markdown: 'Please propose a summary.' })
      .expect(201);
    const rounds = await repository.listBoundaryRounds(session.id);
    await service.applyBoundaryRoundTerminalResult?.({
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
      .post(`/boundary-brainstorming-sessions/${session.id}/summary-revisions/${proposed.id}/request-changes`)
      .send({ actor_id: 'actor-random', feedback_markdown: 'Non-Leader feedback.' })
      .expect(403);
    await request(server)
      .post(`/boundary-brainstorming-sessions/${session.id}/summary-revisions/${proposed.id}/approve`)
      .send({ actor_id: 'actor-random' })
      .expect(403);
  });

  it('uses the session Leader snapshot after item Leader/delegate changes', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const service = app.get(BrainstormingService) as BrainstormingService & {
      applyBoundaryRoundTerminalResult?: (input: Record<string, unknown>) => Promise<unknown>;
    };

    const session = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/boundary-brainstorming`)
        .send({
          actor_id: 'actor-leader',
          leader_actor_id: 'actor-leader',
          leader_delegate_actor_ids: ['actor-delegate'],
        })
        .expect(201)
    ).body;
    await repository.saveDevelopmentPlanItem({
      ...(await repository.getDevelopmentPlanItem(item.id))!,
      leader_actor_id: 'actor-new-leader',
      leader_delegate_actor_ids: ['actor-new-delegate'],
    });
    const [round] = await repository.listBoundaryRounds(session.id);
    await service.applyBoundaryRoundTerminalResult?.({
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
      .post(`/boundary-brainstorming-sessions/${session.id}/answers`)
      .send({ question_id: question.id, text: 'Original delegate answer.', actor_id: 'actor-delegate' })
      .expect(201);
    await request(server)
      .post(`/boundary-brainstorming-sessions/${session.id}/decisions`)
      .send({ text: 'New item Leader should not affect this session.', actor_id: 'actor-new-leader' })
      .expect(403);
  });

  it('drives multi-round Boundary Brainstorming through required-question closure', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const service = app.get(BrainstormingService) as BrainstormingService & {
      applyBoundaryRoundTerminalResult?: (input: Record<string, unknown>) => Promise<unknown>;
    };

    const session = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/boundary-brainstorming`)
        .send({
          actor_id: 'actor-leader',
          leader_actor_id: 'actor-leader',
        })
        .expect(201)
    ).body;

    expect(session).toMatchObject({
      status: 'ai_turn_running',
      current_round_id: expect.any(String),
    });
    let rounds = await repository.listBoundaryRounds(session.id);
    expect(rounds).toMatchObject([{ round_number: 1, trigger: 'start', status: 'queued' }]);
    await expect(repository.listClaimableAutomationActionRuns({ now: '2026-05-05T00:01:00.000Z', limit: 10 })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action_type: 'run_boundary_brainstorming_round',
          target_object_type: 'boundary_round',
          target_object_id: rounds[0].id,
          action_input_json: expect.objectContaining({
            round_id: rounds[0].id,
            precondition_fingerprint_json: expect.any(Object),
          }),
        }),
      ]),
    );

    await service.applyBoundaryRoundTerminalResult?.({
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
      .post(`/boundary-brainstorming-sessions/${session.id}/answers`)
      .send({
        question_id: roundOneQuestion.id,
        text: 'Keep Task 3 scoped to the Brainstorming API and action scheduling boundary.',
        actor_id: 'actor-leader',
      })
      .expect(201);
    await request(server)
      .post(`/boundary-brainstorming-sessions/${session.id}/continue`)
      .send({ actor_id: 'actor-leader', leader_input_markdown: 'Continue with a proposed summary.' })
      .expect(201);
    rounds = await repository.listBoundaryRounds(session.id);
    expect(rounds).toHaveLength(2);
    expect(rounds[1]).toMatchObject({ round_number: 2, trigger: 'leader_answer' });

    await service.applyBoundaryRoundTerminalResult?.({
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
      .post(`/boundary-brainstorming-sessions/${session.id}/summary-revisions/${firstProposal.id}/request-changes`)
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

    await service.applyBoundaryRoundTerminalResult?.({
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

    await request(server)
      .post(`/boundary-brainstorming-sessions/${session.id}/summary-revisions/${finalProposal.id}/approve`)
      .send({ actor_id: 'actor-leader' })
      .expect(409);

    const requiredQuestions = await repository.listBoundaryQuestions(session.id);
    await request(server)
      .post(`/boundary-brainstorming-sessions/${session.id}/decisions`)
      .send({
        text: 'Waive the follow-up question because the first answer already closes the runtime boundary.',
        actor_id: 'actor-leader',
        waived_question_id: requiredQuestions[1].id,
      })
      .expect(201);
    await request(server)
      .post(`/boundary-brainstorming-sessions/${session.id}/summary-revisions/${finalProposal.id}/approve`)
      .send({ actor_id: 'actor-leader' })
      .expect(201);
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

  it('persists questions, answers, decisions, and approved boundary summary before Spec generation', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const session = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/brainstorming-sessions`)
        .send({ actor_id: 'actor-tech' })
        .expect(201)
    ).body;

    expect(session).toMatchObject({
      development_plan_id: plan.id,
      development_plan_item_id: item.id,
      development_plan_item_revision_id: item.revision_id,
      approval_state: 'questions_open',
    });
    expect(session.questions.map((question: { text: string }) => question.text)).toEqual(expectedQuestions);

    await request(server)
      .post(`/brainstorming-sessions/${session.id}/approve-boundary`)
      .send({
        confirmed_scope: ['Web IA and Development Plan Item gate UX'],
        confirmed_out_of_scope: ['Runtime scheduler changes'],
        accepted_assumptions: ['Mock Codex question generation is sufficient for this slice'],
        open_risks: ['Execution queue depends on existing runtime adapters'],
        validation_expectations: ['Route tests and screenshot checks pass'],
        actor_id: 'actor-tech',
        final_decision: 'Approve the boundary.',
      })
      .expect(409);

    for (const question of session.questions) {
      await request(server)
        .post(`/brainstorming-sessions/${session.id}/answers`)
        .send({
          question_id: question.id,
          text: `Answered boundary question: ${question.text}`,
          actor_id: 'actor-tech',
        })
        .expect(201);
    }

    await request(server)
      .post(`/brainstorming-sessions/${session.id}/approve-boundary`)
      .send({
        confirmed_scope: ['Web IA and Development Plan Item gate UX'],
        confirmed_out_of_scope: ['Runtime scheduler changes'],
        accepted_assumptions: ['Mock Codex question generation is sufficient for this slice'],
        open_risks: ['Execution queue depends on existing runtime adapters'],
        validation_expectations: ['Route tests and screenshot checks pass'],
        actor_id: 'actor-tech',
        final_decision: 'Approve the boundary.',
      })
      .expect(409);

    await request(server)
      .post(`/brainstorming-sessions/${session.id}/decisions`)
      .send({
        text: 'Keep implementation scoped to Web IA and route tests.',
        rationale: 'The item is a UI planning slice.',
        actor_id: 'actor-tech',
      })
      .expect(201);

    const lockKeys: string[] = [];
    const originalWithObjectLock = repository.withObjectLock.bind(repository);
    vi.spyOn(repository, 'withObjectLock').mockImplementation((key, write) => {
      lockKeys.push(key);
      return originalWithObjectLock(key, write);
    });

    const approved = (
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
        .expect(201)
    ).body;

    expect(approved).toMatchObject({
      approval_state: 'approved',
      boundary_summary_id: expect.any(String),
      development_plan_item_revision_id: expect.any(String),
    });
    expect(lockKeys).toEqual([`development-plan:${plan.id}`, `brainstorming-session:${session.id}`]);
    expect(approved.development_plan_item_revision_id).not.toBe(item.revision_id);

    const itemRevisions = (
      await request(server)
        .get(`/development-plans/${plan.id}/items/${item.id}/revisions`)
        .expect(200)
    ).body;
    expect(itemRevisions).toHaveLength(2);

    const itemDiff = (
      await request(server)
        .get(`/development-plans/${plan.id}/items/${item.id}/revisions/compare`)
        .query({
          base_revision_id: itemRevisions[0].id,
          compare_revision_id: itemRevisions[1].id,
        })
        .expect(200)
    ).body;
    expect(itemDiff).toMatchObject({
      base_revision_id: itemRevisions[0].id,
      compare_revision_id: itemRevisions[1].id,
      changed_fields: expect.arrayContaining(['boundary_status', 'next_action', 'revision_id', 'updated_at']),
    });
    expect(itemDiff.changed_fields).not.toContain('snapshot');

    const boundaryRevisions = (
      await request(server)
        .get(`/boundary-summaries/${approved.boundary_summary_id}/revisions`)
        .expect(200)
    ).body;
    expect(boundaryRevisions).toHaveLength(1);
    expect(boundaryRevisions[0]).toMatchObject({
      boundary_summary_id: approved.boundary_summary_id,
      brainstorming_session_id: session.id,
      development_plan_item_revision_id: approved.development_plan_item_revision_id,
      decision_count: 2,
      approved_by_actor_id: 'actor-tech',
    });
    const persistedApprovedSession = await repository.getBrainstormingSession(session.id);
    const persistedBoundarySummary = await repository.getBoundarySummary(approved.boundary_summary_id);
    expect(persistedApprovedSession?.revision_id).toEqual(expect.any(String));
    expect((persistedBoundarySummary as { brainstorming_session_revision_id?: string })?.brainstorming_session_revision_id).toBe(
      persistedApprovedSession?.revision_id,
    );
    expect(boundaryRevisions[0].brainstorming_session_revision_id).toBe(persistedApprovedSession?.revision_id);

    const boundaryDiff = (
      await request(server)
        .get(`/boundary-summaries/${approved.boundary_summary_id}/revisions/compare`)
        .query({
          base_revision_id: boundaryRevisions[0].id,
          compare_revision_id: boundaryRevisions[0].id,
        })
        .expect(200)
    ).body;
    expect(boundaryDiff).toMatchObject({
      base_revision_id: boundaryRevisions[0].id,
      compare_revision_id: boundaryRevisions[0].id,
      changed_fields: [],
    });
    expect(JSON.stringify(approved)).not.toContain('"type":"work_item"');
  });

  it('rejects answer and decision mutations after boundary approval', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const session = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/brainstorming-sessions`)
        .send({ actor_id: 'actor-tech' })
        .expect(201)
    ).body;

    for (const question of session.questions) {
      await request(server)
        .post(`/brainstorming-sessions/${session.id}/answers`)
        .send({
          question_id: question.id,
          text: `Answered boundary question: ${question.text}`,
          actor_id: 'actor-tech',
        })
        .expect(201);
    }

    await request(server)
      .post(`/brainstorming-sessions/${session.id}/decisions`)
      .send({
        text: 'Keep implementation scoped to Web IA and route tests.',
        rationale: 'The item is a UI planning slice.',
        actor_id: 'actor-tech',
      })
      .expect(201);

    const approved = (
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
        .expect(201)
    ).body;
    const approvedSession = await repository.getBrainstormingSession(session.id);
    expect(approvedSession).toMatchObject({
      approval_state: 'approved',
      revision_id: approved.revision_id,
      boundary_summary_id: approved.boundary_summary_id,
    });

    await request(server)
      .post(`/brainstorming-sessions/${session.id}/answers`)
      .send({
        question_id: session.questions[0].id,
        text: 'Late answer after approval.',
        actor_id: 'actor-tech',
      })
      .expect(400);

    await request(server)
      .post(`/brainstorming-sessions/${session.id}/decisions`)
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
    expect(persistedSession?.answers).toHaveLength(session.questions.length);
    expect(persistedSession?.decisions).toHaveLength(2);
    expect((persistedBoundarySummary as { brainstorming_session_revision_id?: string })?.brainstorming_session_revision_id).toBe(
      persistedSession?.revision_id,
    );
  });

  it('rejects repeated boundary approval without creating new revisions', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const session = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/brainstorming-sessions`)
        .send({ actor_id: 'actor-tech' })
        .expect(201)
    ).body;

    for (const question of session.questions) {
      await request(server)
        .post(`/brainstorming-sessions/${session.id}/answers`)
        .send({
          question_id: question.id,
          text: `Answered boundary question: ${question.text}`,
          actor_id: 'actor-tech',
        })
        .expect(201);
    }
    await request(server)
      .post(`/brainstorming-sessions/${session.id}/decisions`)
      .send({
        text: 'Keep implementation scoped to Web IA and route tests.',
        actor_id: 'actor-tech',
      })
      .expect(201);

    const approved = (
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
        .expect(201)
    ).body;
    const approvedSession = await repository.getBrainstormingSession(session.id);
    const approvedBoundarySummary = await repository.getBoundarySummary(approved.boundary_summary_id);
    const itemRevisionsBefore = await repository.listDevelopmentPlanItemRevisions(item.id);
    const planRevisionsBefore = await repository.listDevelopmentPlanRevisions(plan.id);

    await request(server)
      .post(`/brainstorming-sessions/${session.id}/approve-boundary`)
      .send({
        confirmed_scope: ['Expanded scope should not be written'],
        confirmed_out_of_scope: ['Runtime scheduler changes'],
        accepted_assumptions: ['Mock Codex question generation is sufficient for this slice'],
        open_risks: ['Execution queue depends on existing runtime adapters'],
        validation_expectations: ['Route tests and screenshot checks pass'],
        actor_id: 'actor-tech',
        final_decision: 'Attempt to approve twice.',
      })
      .expect(400);

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
    const session = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/brainstorming-sessions`)
        .send({ actor_id: 'actor-tech' })
        .expect(201)
    ).body;

    await makeSessionReadyForApproval(server, session);
    await approveBoundary(server, session).expect(201);

    const approvedItem = await repository.getDevelopmentPlanItem(item.id);
    const itemRevisionsBefore = await repository.listDevelopmentPlanItemRevisions(item.id);
    const planRevisionsBefore = await repository.listDevelopmentPlanRevisions(plan.id);

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/brainstorming-sessions`)
      .send({ actor_id: 'actor-tech' })
      .expect(409);

    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toEqual(approvedItem);
    await expect(repository.listDevelopmentPlanItemRevisions(item.id)).resolves.toHaveLength(itemRevisionsBefore.length);
    await expect(repository.listDevelopmentPlanRevisions(plan.id)).resolves.toHaveLength(planRevisionsBefore.length);
  });

  it('rejects approving a stale second session after item boundary approval without creating a second summary or revisions', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const firstSession = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/brainstorming-sessions`)
        .send({ actor_id: 'actor-tech' })
        .expect(201)
    ).body;
    const secondSession = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/brainstorming-sessions`)
        .send({ actor_id: 'actor-reviewer' })
        .expect(201)
    ).body;

    await makeSessionReadyForApproval(server, firstSession);
    await makeSessionReadyForApproval(server, secondSession);
    const approved = (await approveBoundary(server, firstSession).expect(201)).body;
    const approvedItem = await repository.getDevelopmentPlanItem(item.id);
    const approvedBoundarySummary = await repository.getBoundarySummary(approved.boundary_summary_id);
    const itemRevisionsBefore = await repository.listDevelopmentPlanItemRevisions(item.id);
    const planRevisionsBefore = await repository.listDevelopmentPlanRevisions(plan.id);
    const saveBoundarySummarySpy = vi.spyOn(repository, 'saveBoundarySummary');

    await approveBoundary(server, secondSession, {
      confirmed_scope: ['Stale session should not create a second boundary summary'],
      actor_id: 'actor-reviewer',
      final_decision: 'Attempt stale approval.',
    }).expect(409);

    expect(saveBoundarySummarySpy).not.toHaveBeenCalled();
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toEqual(approvedItem);
    await expect(repository.getBoundarySummary(approved.boundary_summary_id)).resolves.toEqual(approvedBoundarySummary);
    await expect(repository.listDevelopmentPlanItemRevisions(item.id)).resolves.toHaveLength(itemRevisionsBefore.length);
    await expect(repository.listDevelopmentPlanRevisions(plan.id)).resolves.toHaveLength(planRevisionsBefore.length);
    const persistedSecondSession = await repository.getBrainstormingSession(secondSession.id);
    expect(persistedSecondSession).toMatchObject({ approval_state: 'ready_for_approval' });
    expect(persistedSecondSession?.boundary_summary_id).toBeUndefined();
  });

  it('starts brainstorming sessions under the Development Plan lock and transaction', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();
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

    const session = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/brainstorming-sessions`)
        .send({ actor_id: 'actor-tech' })
        .expect(201)
    ).body;

    expect(lockKeys).toEqual([`development-plan:${plan.id}`]);
    expect(transactionMarkers).toEqual(['started']);
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
          metadata: { brainstorming_session_id: session.id },
        }),
      ]),
    );
  });
});

describe('product generation automation action schemas', () => {
  it.each([
    'run_boundary_brainstorming_round',
    'generate_development_plan_item_spec_revision',
    'generate_development_plan_item_execution_plan_revision',
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

  it('rejects Execution Plan generation without an approved Spec revision', () => {
    const body = productGenerationActionBody('generate_development_plan_item_execution_plan_revision');
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

async function makeSessionReadyForApproval(
  server: ReturnType<INestApplication['getHttpServer']>,
  session: { id: string; questions: { id: string; text: string }[] },
) {
  for (const question of session.questions) {
    await request(server)
      .post(`/brainstorming-sessions/${session.id}/answers`)
      .send({
        question_id: question.id,
        text: `Answered boundary question: ${question.text}`,
        actor_id: 'actor-tech',
      })
      .expect(201);
  }
  await request(server)
    .post(`/brainstorming-sessions/${session.id}/decisions`)
    .send({
      text: 'Keep implementation scoped to Web IA and route tests.',
      actor_id: 'actor-tech',
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
        reviewer_actor_id: 'actor-reviewer',
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
    source_object_ref: { type: 'requirement', id: 'requirement-1' },
    source_object_revision_id: 'source-revision-1',
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
