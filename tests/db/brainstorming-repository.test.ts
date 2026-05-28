import { describe, expect, it } from 'vitest';
import type {
  BoundarySummaryRevision,
  BrainstormingSession,
  DevelopmentPlan,
  DevelopmentPlanItem,
} from '@forgeloop/domain';

import {
  InMemoryDeliveryRepository,
  type BoundaryAnswerRecord,
  type BoundaryDecisionRecord,
  type BoundaryQuestionRecord,
  type BoundaryRoundRecord,
  type DeliveryRepository,
} from '../../packages/db/src/index';

const at = '2026-05-25T00:00:00.000Z';
const later = '2026-05-25T00:01:00.000Z';

const createInMemoryDeliveryRepository = (): DeliveryRepository => new InMemoryDeliveryRepository();

describe('boundary brainstorming repository persistence', () => {
  it('persists round-scoped Boundary Brainstorming evidence', async () => {
    const repository = createInMemoryDeliveryRepository();
    const seeded = await seedDevelopmentPlanItemForRepository(repository);

    await repository.saveBrainstormingSession({
      id: '11111111-1111-4111-8111-111111111101',
      revision_id: '11111111-1111-4111-8111-111111111102',
      source_ref: seeded.item.source_ref,
      development_plan_id: seeded.plan.id,
      development_plan_revision_id: seeded.plan.revision_id,
      development_plan_item_id: seeded.item.id,
      development_plan_item_revision_id: seeded.item.revision_id,
      leader_actor_id: '11111111-1111-4111-8111-111111111103',
      leader_delegate_actor_ids: ['11111111-1111-4111-8111-111111111104'],
      context_manifest_id: '11111111-1111-4111-8111-111111111105',
      context_manifest_revision_id: '11111111-1111-4111-8111-111111111106',
      status: 'waiting_for_leader',
      questions: [],
      answers: [],
      decisions: [],
      approval_state: 'questions_open',
      created_at: at,
      updated_at: at,
    });

    const firstRound: BoundaryRoundRecord = {
      id: '11111111-1111-4111-8111-111111111107',
      session_id: '11111111-1111-4111-8111-111111111101',
      session_revision_id: '11111111-1111-4111-8111-111111111102',
      round_number: 1,
      trigger: 'start',
      status: 'waiting_for_leader',
      created_at: at,
      updated_at: at,
    };
    const secondRound: BoundaryRoundRecord = {
      ...firstRound,
      id: '11111111-1111-4111-8111-111111111114',
      round_number: 2,
      trigger: 'ai_follow_up',
      updated_at: later,
    };
    await repository.saveBoundaryRound(secondRound);
    await repository.saveBoundaryRound(firstRound);

    const question: BoundaryQuestionRecord = {
      id: '11111111-1111-4111-8111-111111111108',
      session_id: '11111111-1111-4111-8111-111111111101',
      round_id: '11111111-1111-4111-8111-111111111107',
      sequence: 1,
      text: 'What is in scope?',
      required: true,
      author_id: 'runtime',
      status: 'open',
      created_at: at,
    };
    const followUpQuestion: BoundaryQuestionRecord = {
      ...question,
      id: '11111111-1111-4111-8111-111111111115',
      round_id: secondRound.id,
      sequence: 2,
      text: 'What stays out of scope?',
    };
    await repository.saveBoundaryQuestion(followUpQuestion);
    await repository.saveBoundaryQuestion(question);

    const answer: BoundaryAnswerRecord = {
      id: '11111111-1111-4111-8111-111111111109',
      session_id: '11111111-1111-4111-8111-111111111101',
      round_id: '11111111-1111-4111-8111-111111111107',
      question_id: question.id,
      sequence: 1,
      text: 'Repository persistence is in scope.',
      actor_id: '11111111-1111-4111-8111-111111111103',
      actor_role: 'leader',
      created_at: later,
    };
    const followUpAnswer: BoundaryAnswerRecord = {
      ...answer,
      id: '11111111-1111-4111-8111-111111111116',
      round_id: secondRound.id,
      question_id: followUpQuestion.id,
      sequence: 2,
      text: 'API orchestration stays out of scope.',
    };
    await repository.saveBoundaryAnswer(followUpAnswer);
    await repository.saveBoundaryAnswer(answer);

    const decision: BoundaryDecisionRecord = {
      id: '11111111-1111-4111-8111-111111111110',
      session_id: '11111111-1111-4111-8111-111111111101',
      round_id: '11111111-1111-4111-8111-111111111107',
      sequence: 1,
      text: 'Persist first-class round evidence.',
      actor_id: '11111111-1111-4111-8111-111111111103',
      actor_role: 'leader',
      source: 'leader',
      state: 'accepted',
      created_at: later,
    };
    const followUpDecision: BoundaryDecisionRecord = {
      ...decision,
      id: '11111111-1111-4111-8111-111111111117',
      round_id: secondRound.id,
      sequence: 2,
      text: 'Leave API service orchestration for a later task.',
    };
    await repository.saveBoundaryDecision(followUpDecision);
    await repository.saveBoundaryDecision(decision);

    await repository.saveBoundarySummary({
      id: '11111111-1111-4111-8111-111111111111',
      revision_id: '11111111-1111-4111-8111-111111111112',
      brainstorming_session_id: '11111111-1111-4111-8111-111111111101',
      brainstorming_session_revision_id: '11111111-1111-4111-8111-111111111102',
      development_plan_id: seeded.plan.id,
      development_plan_item_id: seeded.item.id,
      development_plan_item_revision_id: seeded.item.revision_id,
      source_ref: seeded.item.source_ref,
      summary: 'Boundary persistence is approved.',
      approved_by_actor_id: '11111111-1111-4111-8111-111111111103',
      approved_at: later,
      created_at: later,
      updated_at: later,
    });
    await repository.saveBoundarySummaryRevision({
      id: '11111111-1111-4111-8111-111111111113',
      boundary_summary_id: '11111111-1111-4111-8111-111111111111',
      session_id: '11111111-1111-4111-8111-111111111101',
      session_revision_id: '11111111-1111-4111-8111-111111111102',
      source_round_id: '11111111-1111-4111-8111-111111111107',
      development_plan_id: seeded.plan.id,
      development_plan_item_id: seeded.item.id,
      development_plan_item_revision_id: seeded.item.revision_id,
      revision_number: 1,
      status: 'approved',
      summary_markdown: 'Boundary persistence is approved.',
      confirmed_scope: ['Repository persistence'],
      confirmed_out_of_scope: ['API orchestration'],
      accepted_assumptions: [],
      open_risks: [],
      validation_expectations: ['Repository tests pass'],
      question_answer_snapshot: [{ question_id: question.id, answer_id: answer.id, text: answer.text }],
      decision_snapshot: [{ decision_id: decision.id, text: decision.text }],
      context_manifest_id: '11111111-1111-4111-8111-111111111105',
      context_manifest_revision_id: '11111111-1111-4111-8111-111111111106',
      approved_by_actor_id: '11111111-1111-4111-8111-111111111103',
      approved_at: later,
      created_at: later,
    });

    await expect(repository.getBrainstormingSession('11111111-1111-4111-8111-111111111101')).resolves.toMatchObject({
      id: '11111111-1111-4111-8111-111111111101',
      leader_actor_id: '11111111-1111-4111-8111-111111111103',
      leader_delegate_actor_ids: ['11111111-1111-4111-8111-111111111104'],
    });
    expect(await repository.listBoundaryRounds('11111111-1111-4111-8111-111111111101')).toEqual([firstRound, secondRound]);
    expect(await repository.listBoundaryQuestions('11111111-1111-4111-8111-111111111101')).toEqual([
      question,
      followUpQuestion,
    ]);
    expect(await repository.listBoundaryAnswers('11111111-1111-4111-8111-111111111101')).toEqual([answer, followUpAnswer]);
    expect(await repository.listBoundaryDecisions('11111111-1111-4111-8111-111111111101')).toEqual([
      decision,
      followUpDecision,
    ]);
    expect(await repository.listBoundarySummaryRevisions('11111111-1111-4111-8111-111111111111')).toEqual([
      expect.objectContaining({ id: '11111111-1111-4111-8111-111111111113', status: 'approved' }),
    ]);
  });

  it('backfills Leader defaults from reviewer, then driver, and reports items that still cannot start', async () => {
    const repository = createInMemoryDeliveryRepository();
    const reviewerSeed = await seedDevelopmentPlanItemForRepository(repository, {
      item: {
        id: '22222222-2222-4222-8222-222222222101',
        revision_id: '22222222-2222-4222-8222-222222222102',
        reviewer_actor_id: '22222222-2222-4222-8222-222222222103',
        driver_actor_id: '22222222-2222-4222-8222-222222222104',
      },
    });
    const driverSeed = await seedDevelopmentPlanItemForRepository(repository, {
      plan: {
        id: '22222222-2222-4222-8222-222222222201',
        revision_id: '22222222-2222-4222-8222-222222222202',
      },
      item: {
        id: '22222222-2222-4222-8222-222222222203',
        revision_id: '22222222-2222-4222-8222-222222222204',
        reviewer_actor_id: undefined,
        driver_actor_id: '22222222-2222-4222-8222-222222222205',
      },
    });
    const blockedSeed = await seedDevelopmentPlanItemForRepository(repository, {
      plan: {
        id: '22222222-2222-4222-8222-222222222301',
        revision_id: '22222222-2222-4222-8222-222222222302',
      },
      item: {
        id: '22222222-2222-4222-8222-222222222303',
        revision_id: '22222222-2222-4222-8222-222222222304',
        reviewer_actor_id: undefined,
        driver_actor_id: undefined,
      },
    });
    const storedLeaderSeed = await seedDevelopmentPlanItemForRepository(repository, {
      plan: {
        id: '22222222-2222-4222-8222-222222222501',
        revision_id: '22222222-2222-4222-8222-222222222502',
      },
      item: {
        id: '22222222-2222-4222-8222-222222222503',
        revision_id: '22222222-2222-4222-8222-222222222504',
        leader_actor_id: '22222222-2222-4222-8222-222222222505',
        leader_delegate_actor_ids: ['22222222-2222-4222-8222-222222222506'],
        reviewer_actor_id: '22222222-2222-4222-8222-222222222507',
        driver_actor_id: '22222222-2222-4222-8222-222222222508',
      },
    });

    await repository.saveBrainstormingSession(
      legacySessionWithoutLeader({
        id: '22222222-2222-4222-8222-222222222400',
        development_plan_id: storedLeaderSeed.plan.id,
        development_plan_revision_id: storedLeaderSeed.plan.revision_id,
        development_plan_item_id: storedLeaderSeed.item.id,
        development_plan_item_revision_id: storedLeaderSeed.item.revision_id,
      }),
    );
    await repository.saveBrainstormingSession(
      legacySessionWithoutLeader({
        id: '22222222-2222-4222-8222-222222222401',
        development_plan_id: reviewerSeed.plan.id,
        development_plan_revision_id: reviewerSeed.plan.revision_id,
        development_plan_item_id: reviewerSeed.item.id,
        development_plan_item_revision_id: reviewerSeed.item.revision_id,
        questions: [
          {
            id: 'legacy-question-1',
            text: 'Who owns the boundary?',
            author_id: 'runtime',
            status: 'open',
            required: true,
            created_at: at,
          },
        ],
      }),
    );
    await repository.saveBrainstormingSession(
      legacySessionWithoutLeader({
        id: '22222222-2222-4222-8222-222222222402',
        development_plan_id: blockedSeed.plan.id,
        development_plan_revision_id: blockedSeed.plan.revision_id,
        development_plan_item_id: blockedSeed.item.id,
        development_plan_item_revision_id: blockedSeed.item.revision_id,
      }),
    );

    const result = await repository.backfillBoundaryLeaderDefaults({ now: later });

    await expect(repository.getDevelopmentPlanItem(reviewerSeed.item.id)).resolves.toMatchObject({
      leader_actor_id: '22222222-2222-4222-8222-222222222103',
      leader_delegate_actor_ids: [],
    });
    await expect(repository.getDevelopmentPlanItem(driverSeed.item.id)).resolves.toMatchObject({
      leader_actor_id: '22222222-2222-4222-8222-222222222205',
      leader_delegate_actor_ids: [],
    });
    await expect(repository.getDevelopmentPlanItem(blockedSeed.item.id)).resolves.not.toHaveProperty('leader_actor_id');
    await expect(repository.getBrainstormingSession('22222222-2222-4222-8222-222222222401')).resolves.toMatchObject({
      leader_actor_id: '22222222-2222-4222-8222-222222222103',
      leader_delegate_actor_ids: [],
      current_round_id: '22222222-2222-4222-8222-222222222401-round-1',
    });
    await expect(repository.getBrainstormingSession('22222222-2222-4222-8222-222222222400')).resolves.toMatchObject({
      leader_actor_id: '22222222-2222-4222-8222-222222222505',
      leader_delegate_actor_ids: ['22222222-2222-4222-8222-222222222506'],
      current_round_id: '22222222-2222-4222-8222-222222222400-round-1',
    });
    expect(await repository.listBoundaryRounds('22222222-2222-4222-8222-222222222401')).toEqual([
      expect.objectContaining({ round_number: 1, trigger: 'start' }),
    ]);
    expect(await repository.listBoundaryQuestions('22222222-2222-4222-8222-222222222401')).toEqual([
      expect.objectContaining({ id: 'legacy-question-1', round_id: '22222222-2222-4222-8222-222222222401-round-1' }),
    ]);
    expect(result).toEqual({
      updated_item_ids: [reviewerSeed.item.id, driverSeed.item.id],
      updated_session_ids: [
        '22222222-2222-4222-8222-222222222400',
        '22222222-2222-4222-8222-222222222401',
      ],
      blocked_item_ids: [blockedSeed.item.id],
    });
  });

  it('backfills legacy active sessions onto the latest existing round', async () => {
    const repository = createInMemoryDeliveryRepository();
    const seeded = await seedDevelopmentPlanItemForRepository(repository, {
      item: {
        id: '44444444-4444-4444-8444-444444444101',
        revision_id: '44444444-4444-4444-8444-444444444102',
        reviewer_actor_id: '44444444-4444-4444-8444-444444444103',
      },
    });
    const session = legacySessionWithoutLeader({
      id: '44444444-4444-4444-8444-444444444104',
      development_plan_id: seeded.plan.id,
      development_plan_revision_id: seeded.plan.revision_id,
      development_plan_item_id: seeded.item.id,
      development_plan_item_revision_id: seeded.item.revision_id,
      approval_state: 'questions_open',
      questions: [
        {
          id: 'legacy-multi-round-question',
          text: 'Which round receives legacy evidence?',
          author_id: 'runtime',
          status: 'resolved',
          required: false,
          answered_by_answer_id: 'legacy-multi-round-answer',
          created_at: at,
        },
      ],
      answers: [
        {
          id: 'legacy-multi-round-answer',
          question_id: 'legacy-multi-round-question',
          text: 'The latest round receives the evidence.',
          actor_id: '44444444-4444-4444-8444-444444444103',
          actor_role: 'leader',
          created_at: at,
        },
      ],
      decisions: [
        {
          id: 'legacy-multi-round-decision',
          text: 'Use the latest round as current when the legacy session has no pointer.',
          actor_id: '44444444-4444-4444-8444-444444444103',
          actor_role: 'leader',
          source: 'leader',
          state: 'accepted',
          created_at: at,
        },
      ],
    });
    delete (session as Partial<BrainstormingSession>).development_plan_revision_id;
    delete (session as Partial<BrainstormingSession>).status;
    await repository.saveBrainstormingSession(session);
    await repository.saveBoundaryRound({
      id: 'legacy-existing-round-1',
      session_id: session.id,
      session_revision_id: session.revision_id,
      round_number: 1,
      trigger: 'start',
      status: 'waiting_for_leader',
      created_at: at,
      updated_at: at,
    });
    await repository.saveBoundaryRound({
      id: 'legacy-existing-round-2',
      session_id: session.id,
      session_revision_id: session.revision_id,
      round_number: 2,
      trigger: 'leader_reply',
      status: 'waiting_for_leader',
      created_at: later,
      updated_at: later,
    });

    const result = await repository.backfillBoundaryLeaderDefaults({ now: later });

    await expect(repository.getBrainstormingSession(session.id)).resolves.toMatchObject({
      development_plan_revision_id: seeded.plan.revision_id,
      leader_actor_id: '44444444-4444-4444-8444-444444444103',
      leader_delegate_actor_ids: [],
      status: 'waiting_for_leader',
      current_round_id: 'legacy-existing-round-2',
    });
    expect(await repository.listBoundaryQuestions(session.id)).toEqual([
      expect.objectContaining({ id: 'legacy-multi-round-question', round_id: 'legacy-existing-round-2' }),
    ]);
    expect(await repository.listBoundaryAnswers(session.id)).toEqual([
      expect.objectContaining({ id: 'legacy-multi-round-answer', round_id: 'legacy-existing-round-2' }),
    ]);
    expect(await repository.listBoundaryDecisions(session.id)).toEqual([
      expect.objectContaining({ id: 'legacy-multi-round-decision', round_id: 'legacy-existing-round-2' }),
    ]);
    expect(result).toEqual({
      updated_item_ids: [seeded.item.id],
      updated_session_ids: [session.id],
      blocked_item_ids: [],
    });
  });

  it('downgrades approved summary revisions that cannot satisfy Boundary evidence requirements', async () => {
    const repository = createInMemoryDeliveryRepository();
    const seeded = await seedDevelopmentPlanItemForRepository(repository);

    await repository.saveBrainstormingSession({
      ...brainstormingSessionFor(seeded),
      id: '33333333-3333-4333-8333-333333333101',
      revision_id: '33333333-3333-4333-8333-333333333102',
      boundary_summary_id: '33333333-3333-4333-8333-333333333103',
    });
    await repository.saveBoundarySummary({
      id: '33333333-3333-4333-8333-333333333103',
      revision_id: '33333333-3333-4333-8333-333333333104',
      brainstorming_session_id: '33333333-3333-4333-8333-333333333101',
      brainstorming_session_revision_id: '33333333-3333-4333-8333-333333333102',
      development_plan_id: seeded.plan.id,
      development_plan_item_id: seeded.item.id,
      development_plan_item_revision_id: seeded.item.revision_id,
      source_ref: seeded.item.source_ref,
      summary: 'Legacy approved summary',
      approved_by_actor_id: '33333333-3333-4333-8333-333333333105',
      approved_at: at,
      created_at: at,
      updated_at: at,
    });
    await repository.saveBoundarySummaryRevision(
      legacyApprovedSummaryRevision({
        id: '33333333-3333-4333-8333-333333333106',
        boundary_summary_id: '33333333-3333-4333-8333-333333333103',
        brainstorming_session_id: '33333333-3333-4333-8333-333333333101',
        brainstorming_session_revision_id: '33333333-3333-4333-8333-333333333102',
        development_plan_item_id: seeded.item.id,
        development_plan_item_revision_id: seeded.item.revision_id,
        decision_snapshot: [],
        decision_count: 0,
      }),
    );

    const result = await repository.backfillBoundarySummaryRevisionEligibility({
      session_id: '33333333-3333-4333-8333-333333333101',
      boundary_summary_id: '33333333-3333-4333-8333-333333333103',
      now: later,
    });

    await expect(repository.listBoundarySummaryRevisions('33333333-3333-4333-8333-333333333103')).resolves.toEqual([
      expect.objectContaining({ id: '33333333-3333-4333-8333-333333333106', status: 'draft' }),
    ]);
    expect(result).toEqual({
      downgraded_revision_ids: ['33333333-3333-4333-8333-333333333106'],
      approved_revision_ids: [],
    });
  });

  it('does not rewrite already eligible approved summary revisions on repeated backfill', async () => {
    const repository = createInMemoryDeliveryRepository();
    const seeded = await seedDevelopmentPlanItemForRepository(repository);
    const sessionId = '55555555-5555-4555-8555-555555555101';
    const summaryId = '55555555-5555-4555-8555-555555555102';
    const revisionId = '55555555-5555-4555-8555-555555555103';
    const roundId = 'safe-round-1';

    await repository.saveBrainstormingSession({
      ...brainstormingSessionFor(seeded),
      id: sessionId,
      revision_id: '55555555-5555-4555-8555-555555555104',
      status: 'approved',
      current_round_id: roundId,
      latest_summary_revision_id: revisionId,
      approved_summary_revision_id: revisionId,
      approval_state: 'approved',
      boundary_summary_id: summaryId,
      updated_at: at,
    });
    await repository.saveBoundaryRound({
      id: roundId,
      session_id: sessionId,
      session_revision_id: '55555555-5555-4555-8555-555555555104',
      round_number: 1,
      trigger: 'start',
      status: 'terminal',
      created_at: at,
      updated_at: at,
    });
    await repository.saveBoundaryQuestion({
      id: 'safe-question',
      session_id: sessionId,
      round_id: roundId,
      sequence: 1,
      text: 'What evidence proves approval?',
      author_id: 'runtime',
      created_at: at,
      status: 'resolved',
      required: true,
      answered_by_answer_id: 'safe-answer',
    });
    await repository.saveBoundaryAnswer({
      id: 'safe-answer',
      session_id: sessionId,
      round_id: roundId,
      question_id: 'safe-question',
      sequence: 1,
      text: 'A round-scoped answer exists.',
      actor_id: '55555555-5555-4555-8555-555555555105',
      actor_role: 'leader',
      created_at: at,
    });
    await repository.saveBoundaryDecision({
      id: 'safe-decision',
      session_id: sessionId,
      round_id: roundId,
      sequence: 1,
      text: 'Approved evidence is complete.',
      actor_id: '55555555-5555-4555-8555-555555555105',
      actor_role: 'leader',
      source: 'leader',
      state: 'accepted',
      created_at: at,
    });
    await repository.saveBoundarySummary({
      id: summaryId,
      revision_id: revisionId,
      brainstorming_session_id: sessionId,
      brainstorming_session_revision_id: '55555555-5555-4555-8555-555555555104',
      development_plan_id: seeded.plan.id,
      development_plan_item_id: seeded.item.id,
      development_plan_item_revision_id: seeded.item.revision_id,
      source_ref: seeded.item.source_ref,
      summary: 'Safe approved summary',
      approved_by_actor_id: '55555555-5555-4555-8555-555555555105',
      approved_at: at,
      created_at: at,
      updated_at: at,
    });
    await repository.saveBoundarySummaryRevision({
      id: revisionId,
      boundary_summary_id: summaryId,
      brainstorming_session_id: sessionId,
      brainstorming_session_revision_id: '55555555-5555-4555-8555-555555555104',
      source_round_id: roundId,
      development_plan_id: seeded.plan.id,
      development_plan_item_id: seeded.item.id,
      development_plan_item_revision_id: seeded.item.revision_id,
      revision_number: 1,
      status: 'approved',
      summary_markdown: 'Safe approved summary',
      confirmed_scope: ['Repository persistence'],
      confirmed_out_of_scope: [],
      accepted_assumptions: [],
      open_risks: [],
      validation_expectations: ['Boundary evidence exists'],
      question_answer_snapshot: [{ question_id: 'safe-question', answer_id: 'safe-answer', text: 'A round-scoped answer exists.' }],
      decision_snapshot: [{ decision_id: 'safe-decision', text: 'Approved evidence is complete.' }],
      decision_count: 1,
      context_manifest_id: '55555555-5555-4555-8555-555555555106',
      context_manifest_revision_id: '55555555-5555-4555-8555-555555555107',
      approved_by_actor_id: '55555555-5555-4555-8555-555555555105',
      approved_at: at,
      created_at: at,
    });

    const first = await repository.backfillBoundarySummaryRevisionEligibility({
      session_id: sessionId,
      boundary_summary_id: summaryId,
      now: later,
    });
    const second = await repository.backfillBoundarySummaryRevisionEligibility({
      session_id: sessionId,
      boundary_summary_id: summaryId,
      now: '2026-05-25T00:02:00.000Z',
    });

    await expect(repository.getBrainstormingSession(sessionId)).resolves.toMatchObject({
      updated_at: at,
      latest_summary_revision_id: revisionId,
      approved_summary_revision_id: revisionId,
    });
    expect(first).toEqual({ downgraded_revision_ids: [], approved_revision_ids: [] });
    expect(second).toEqual({ downgraded_revision_ids: [], approved_revision_ids: [] });
  });
});

async function seedDevelopmentPlanItemForRepository(
  repository: DeliveryRepository,
  overrides: {
    plan?: Partial<DevelopmentPlan>;
    item?: Partial<DevelopmentPlanItem>;
  } = {},
): Promise<{ plan: DevelopmentPlan; item: DevelopmentPlanItem }> {
  const plan: DevelopmentPlan = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    project_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    revision_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    title: 'Codex Runtime Superpowers Dogfood Closure',
    status: 'active',
    source_refs: [{ type: 'requirement', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4' }],
    items: [],
    created_at: at,
    updated_at: at,
    ...overrides.plan,
  };
  const item: DevelopmentPlanItem = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    development_plan_id: plan.id,
    revision_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    source_ref: { type: 'requirement', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4' },
    title: 'Persist boundary brainstorming rounds',
    summary: 'Persist boundary brainstorming rounds and evidence.',
    driver_actor_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
    responsible_role: 'developer',
    reviewer_actor_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',
    leader_delegate_actor_ids: [],
    risk: 'medium',
    dependency_hints: [],
    affected_surfaces: ['packages/db'],
    boundary_status: 'in_progress',
    spec_status: 'draft',
    execution_plan_status: 'draft',
    execution_status: 'not_started',
    review_status: 'missing',
    qa_handoff_status: 'missing',
    release_impact: 'release_scoped',
    next_action: 'Start boundary brainstorming.',
    created_at: at,
    updated_at: at,
    ...overrides.item,
  };

  await repository.saveDevelopmentPlan(plan);
  await repository.saveDevelopmentPlanItem(item);
  return { plan, item };
}

function brainstormingSessionFor(seeded: { plan: DevelopmentPlan; item: DevelopmentPlanItem }): BrainstormingSession {
  return {
    id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    revision_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
    source_ref: seeded.item.source_ref,
    development_plan_id: seeded.plan.id,
    development_plan_revision_id: seeded.plan.revision_id,
    development_plan_item_id: seeded.item.id,
    development_plan_item_revision_id: seeded.item.revision_id,
    leader_actor_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
    leader_delegate_actor_ids: [],
    context_manifest_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4',
    context_manifest_revision_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc5',
    status: 'waiting_for_leader',
    questions: [],
    answers: [],
    decisions: [],
    approval_state: 'questions_open',
    created_at: at,
    updated_at: at,
  };
}

function legacySessionWithoutLeader(
  overrides: Partial<BrainstormingSession> & Pick<BrainstormingSession, 'id' | 'development_plan_id' | 'development_plan_item_id'>,
): BrainstormingSession {
  return {
    ...brainstormingSessionFor({
      plan: {
        id: overrides.development_plan_id,
        project_id: 'unused',
        revision_id: overrides.development_plan_revision_id ?? 'legacy-plan-rev',
        title: 'unused',
        status: 'active',
        source_refs: [],
        items: [],
        created_at: at,
        updated_at: at,
      },
      item: {
        id: overrides.development_plan_item_id,
        development_plan_id: overrides.development_plan_id,
        revision_id: overrides.development_plan_item_revision_id ?? 'legacy-item-rev',
        source_ref: { type: 'requirement', id: 'legacy-source' },
        title: 'unused',
        summary: 'unused',
        responsible_role: 'developer',
        leader_delegate_actor_ids: [],
        risk: 'medium',
        dependency_hints: [],
        affected_surfaces: [],
        boundary_status: 'in_progress',
        spec_status: 'draft',
        execution_plan_status: 'draft',
        execution_status: 'not_started',
        review_status: 'missing',
        qa_handoff_status: 'missing',
        release_impact: 'none',
        next_action: 'unused',
        created_at: at,
        updated_at: at,
      },
    }),
    ...overrides,
    leader_actor_id: undefined,
    leader_delegate_actor_ids: undefined,
  } as unknown as BrainstormingSession;
}

function legacyApprovedSummaryRevision(
  overrides: Partial<BoundarySummaryRevision> & Pick<BoundarySummaryRevision, 'id' | 'boundary_summary_id'>,
): BoundarySummaryRevision {
  return {
    id: overrides.id,
    boundary_summary_id: overrides.boundary_summary_id,
    brainstorming_session_id: 'legacy-session',
    brainstorming_session_revision_id: 'legacy-session-rev',
    development_plan_item_id: 'legacy-item',
    development_plan_item_revision_id: 'legacy-item-rev',
    revision_number: 1,
    summary_markdown: 'Legacy approved summary',
    decision_snapshot: [],
    decision_count: 0,
    approved_by_actor_id: 'legacy-approver',
    approved_at: at,
    created_at: at,
    ...overrides,
  } as BoundarySummaryRevision;
}
