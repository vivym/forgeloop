import { describe, expect, it } from 'vitest';
import type { Spec, SpecRevision } from '@forgeloop/domain';
import {
  actorCanActForBoundaryLeader,
  canGenerateExecutionPlanFromApprovedSpec,
  canGenerateSpecFromPlanItem,
  canStartExecutionFromApprovedExecutionPlan,
  requiredBoundaryQuestionsClosed,
  type DevelopmentPlanItem,
  type ExecutionPlanDocument,
  type ExecutionPlanRevision,
} from '@forgeloop/domain';

const at = '2026-05-24T00:00:00.000Z';

const approvedSpec = (overrides: Partial<Spec> = {}): Spec => ({
  id: 'spec-1',
  work_item_id: 'requirement-1',
  entity_type: 'spec',
  status: 'approved',
  editing_state: 'idle',
  gate_state: 'approved',
  resolution: 'approved',
  current_revision_id: 'spec-revision-1',
  approved_revision_id: 'spec-revision-1',
  approved_at: at,
  approved_by_actor_id: 'actor-tech-lead',
  created_at: at,
  updated_at: at,
  ...overrides,
});

const specRevision = (overrides: Partial<SpecRevision> = {}): SpecRevision => ({
  id: 'spec-revision-1',
  spec_id: 'spec-1',
  work_item_id: 'requirement-1',
  revision_number: 1,
  summary: 'Approved spec',
  content: 'Approved spec body',
  background: 'Background',
  goals: ['Generate an execution plan'],
  scope_in: ['Execution planning'],
  scope_out: [],
  acceptance_criteria: ['Execution Plan is generated only from loaded approved SpecRevision'],
  risk_notes: [],
  test_strategy_summary: 'Domain gates',
  artifact_refs: [],
  created_at: at,
  ...overrides,
});

const approvedExecutionPlan = (overrides: Partial<ExecutionPlanDocument> = {}): ExecutionPlanDocument => ({
  id: 'execution-plan-1',
  development_plan_item_id: 'development-plan-item-1',
  status: 'approved',
  current_revision_id: 'execution-plan-revision-1',
  approved_revision_id: 'execution-plan-revision-1',
  approved_by_actor_id: 'actor-tech-lead',
  approved_at: at,
  created_at: at,
  updated_at: at,
  ...overrides,
});

const executionPlanRevision = (overrides: Partial<ExecutionPlanRevision> = {}): ExecutionPlanRevision => ({
  id: 'execution-plan-revision-1',
  execution_plan_id: 'execution-plan-1',
  development_plan_item_id: 'development-plan-item-1',
  based_on_spec_revision_id: 'spec-revision-1',
  revision_number: 1,
  summary: 'Approved execution plan',
  content: 'Execution plan body',
  created_at: at,
  ...overrides,
});

const approvedPlanItem = (overrides: Partial<DevelopmentPlanItem> = {}): DevelopmentPlanItem => ({
  id: 'development-plan-item-1',
  development_plan_id: 'development-plan-1',
  revision_id: 'development-plan-item-revision-1',
  source_ref: { type: 'requirement', id: 'requirement-1' },
  title: 'Runtime closure',
  summary: 'Close runtime dogfood',
  responsible_role: 'tech_lead',
  risk: 'high',
  dependency_hints: [],
  affected_surfaces: [],
  boundary_status: 'approved',
  spec_status: 'missing',
  execution_plan_status: 'missing',
  execution_status: 'not_started',
  review_status: 'missing',
  qa_handoff_status: 'missing',
  release_impact: 'release_scoped',
  next_action: 'generate_spec',
  created_at: at,
  updated_at: at,
  ...overrides,
});

describe('AI-native planning gate helpers', () => {
  it('requires the approved SpecRevision to be loaded before Execution Plan generation', () => {
    expect(canGenerateExecutionPlanFromApprovedSpec({ spec: approvedSpec() })).toEqual({
      ok: false,
      reason: 'approved_spec_revision_not_loaded',
    });
    expect(
      canGenerateExecutionPlanFromApprovedSpec({
        spec: approvedSpec(),
        specRevision: specRevision(),
      }),
    ).toEqual({ ok: true });
  });

  it('rejects approved Spec gates without an approved revision pointer', () => {
    expect(
      canGenerateExecutionPlanFromApprovedSpec({
        spec: approvedSpec({ approved_revision_id: undefined }),
        specRevision: specRevision(),
      }),
    ).toEqual({
      ok: false,
      reason: 'approved_spec_revision_missing',
    });
  });

  it('rejects loaded SpecRevisions that do not match the approved revision', () => {
    expect(
      canGenerateExecutionPlanFromApprovedSpec({
        spec: approvedSpec(),
        specRevision: specRevision({ id: 'spec-revision-2', revision_number: 2 }),
      }),
    ).toEqual({
      ok: false,
      reason: 'spec_revision_not_approved_revision',
    });
  });

  it('requires the approved ExecutionPlanRevision to be loaded before execution starts', () => {
    expect(canStartExecutionFromApprovedExecutionPlan({ executionPlan: approvedExecutionPlan() })).toEqual({
      ok: false,
      reason: 'approved_execution_plan_revision_not_loaded',
    });
    expect(
      canStartExecutionFromApprovedExecutionPlan({
        executionPlan: approvedExecutionPlan(),
        executionPlanRevision: executionPlanRevision(),
      }),
    ).toEqual({ ok: true });
  });

  it('rejects execution start without an approved ExecutionPlan revision pointer', () => {
    expect(
      canStartExecutionFromApprovedExecutionPlan({
        executionPlan: approvedExecutionPlan({ approved_revision_id: undefined }),
        executionPlanRevision: executionPlanRevision(),
      }),
    ).toEqual({
      ok: false,
      reason: 'approved_execution_plan_revision_missing',
    });
  });

  it('rejects loaded ExecutionPlanRevisions that do not match the approved revision', () => {
    expect(
      canStartExecutionFromApprovedExecutionPlan({
        executionPlan: approvedExecutionPlan(),
        executionPlanRevision: executionPlanRevision({
          id: 'execution-plan-revision-2',
          revision_number: 2,
        }),
      }),
    ).toEqual({
      ok: false,
      reason: 'execution_plan_revision_not_approved_revision',
    });
  });

  it('allows the Leader and delegates to act for a Boundary Brainstorming session', () => {
    const session = {
      leader_actor_id: 'actor-leader',
      leader_delegate_actor_ids: ['actor-delegate'],
    };

    expect(actorCanActForBoundaryLeader(session, 'actor-leader')).toBe(true);
    expect(actorCanActForBoundaryLeader(session, 'actor-delegate')).toBe(true);
    expect(actorCanActForBoundaryLeader(session, 'actor-driver')).toBe(false);
    expect(actorCanActForBoundaryLeader({ leader_actor_id: 'legacy-leader' }, 'actor-delegate')).toBe(false);
  });

  it('requires required Boundary questions to be answered or explicitly waived by accepted Leader decisions', () => {
    const questions = [
      {
        id: 'question-1',
        round_id: 'round-1',
        text: 'Which runtime boundary owns Codex config?',
        author_id: 'codex-runtime',
        created_at: at,
        status: 'answered' as const,
        required: true,
        rationale: 'Spec generation needs an ownership decision.',
        answered_by_answer_id: 'answer-1',
      },
      {
        id: 'question-2',
        round_id: 'round-1',
        text: 'Can CLI fallback be in scope?',
        author_id: 'codex-runtime',
        created_at: at,
        status: 'resolved' as const,
        required: true,
        waived_by_decision_id: 'decision-1',
      },
      {
        id: 'question-3',
        text: 'Superseded follow-up',
        author_id: 'codex-runtime',
        created_at: at,
        status: 'superseded' as const,
        required: true,
      },
    ];
    const answers = [
      {
        id: 'answer-1',
        question_id: 'question-1',
        round_id: 'round-1',
        text: 'Centralized config distribution owns it.',
        actor_id: 'actor-leader',
        actor_role: 'leader' as const,
        created_at: at,
      },
    ];
    const decisions = [
      {
        id: 'decision-1',
        round_id: 'round-1',
        text: 'CLI fallback is out of scope.',
        actor_id: 'actor-leader',
        actor_role: 'leader' as const,
        source: 'leader' as const,
        state: 'accepted' as const,
        created_at: at,
      },
    ];

    expect(requiredBoundaryQuestionsClosed({ questions, answers, decisions })).toBe(true);
    expect(
      requiredBoundaryQuestionsClosed({
        questions: [{ ...questions[0], answered_by_answer_id: 'missing-answer' }],
        answers,
        decisions,
      }),
    ).toBe(false);
    expect(
      requiredBoundaryQuestionsClosed({
        questions: [{ ...questions[1], waived_by_decision_id: 'ai-decision' }],
        answers,
        decisions: [{ ...decisions[0], id: 'ai-decision', source: 'ai_proposed' as const }],
      }),
    ).toBe(false);
    expect(
      requiredBoundaryQuestionsClosed({
        questions: [{ ...questions[1], waived_by_decision_id: 'driver-decision' }],
        answers,
        decisions: [{ ...decisions[0], id: 'driver-decision', source: 'driver' as const }],
      }),
    ).toBe(false);
    expect(
      requiredBoundaryQuestionsClosed({
        questions: [{ ...questions[1], waived_by_decision_id: 'reviewer-decision' }],
        answers,
        decisions: [{ ...decisions[0], id: 'reviewer-decision', source: 'reviewer' as const }],
      }),
    ).toBe(false);
  });

  it('requires answer links to match the required Boundary question identity', () => {
    expect(
      requiredBoundaryQuestionsClosed({
        questions: [
          {
            id: 'question-1',
            round_id: 'round-1',
            text: 'Which runtime boundary owns Codex config?',
            author_id: 'codex-runtime',
            created_at: at,
            status: 'answered',
            required: true,
            answered_by_answer_id: 'answer-1',
          },
        ],
        answers: [
          {
            id: 'answer-1',
            question_id: 'question-2',
            round_id: 'round-1',
            text: 'Answer for a different question.',
            actor_id: 'actor-leader',
            actor_role: 'leader',
            created_at: at,
          },
        ],
        decisions: [],
      }),
    ).toBe(false);
  });

  it('requires answer round links to match when question and answer both carry Boundary round identity', () => {
    expect(
      requiredBoundaryQuestionsClosed({
        questions: [
          {
            id: 'question-1',
            round_id: 'round-1',
            text: 'Which runtime boundary owns Codex config?',
            author_id: 'codex-runtime',
            created_at: at,
            status: 'answered',
            required: true,
            answered_by_answer_id: 'answer-1',
          },
        ],
        answers: [
          {
            id: 'answer-1',
            question_id: 'question-1',
            round_id: 'round-2',
            text: 'Answer from a stale round.',
            actor_id: 'actor-leader',
            actor_role: 'leader',
            created_at: at,
          },
        ],
        decisions: [],
      }),
    ).toBe(false);
  });

  it('requires waiver decision round links to match when question and decision both carry Boundary round identity', () => {
    expect(
      requiredBoundaryQuestionsClosed({
        questions: [
          {
            id: 'question-1',
            round_id: 'round-2',
            text: 'Can CLI fallback be in scope?',
            author_id: 'codex-runtime',
            created_at: at,
            status: 'resolved',
            required: true,
            waived_by_decision_id: 'decision-1',
          },
        ],
        answers: [],
        decisions: [
          {
            id: 'decision-1',
            round_id: 'round-1',
            text: 'CLI fallback is out of scope.',
            actor_id: 'actor-delegate',
            actor_role: 'delegate',
            source: 'delegate',
            state: 'accepted',
            created_at: at,
          },
        ],
      }),
    ).toBe(false);
  });

  it('rejects non-accepted Leader and delegate waiver decisions', () => {
    const question = {
      id: 'question-1',
      round_id: 'round-1',
      text: 'Can CLI fallback be in scope?',
      author_id: 'codex-runtime',
      created_at: at,
      status: 'resolved' as const,
      required: true,
      waived_by_decision_id: 'decision-1',
    };
    const decision = {
      id: 'decision-1',
      round_id: 'round-1',
      text: 'CLI fallback is out of scope.',
      actor_id: 'actor-leader',
      actor_role: 'leader' as const,
      source: 'leader' as const,
      created_at: at,
    };

    expect(
      requiredBoundaryQuestionsClosed({
        questions: [question],
        answers: [],
        decisions: [{ ...decision, state: 'proposed' as const }],
      }),
    ).toBe(false);
    expect(
      requiredBoundaryQuestionsClosed({
        questions: [question],
        answers: [],
        decisions: [{ ...decision, state: 'rejected' as const }],
      }),
    ).toBe(false);
  });

  it('requires an approved Boundary Summary revision before Spec generation', () => {
    const baseInput = {
      item: approvedPlanItem(),
      brainstormingSession: { approval_state: 'approved' },
      boundarySummary: {
        approved_by_actor_id: 'actor-leader',
        approved_at: at,
      },
    };

    expect(canGenerateSpecFromPlanItem(baseInput)).toEqual({
      ok: false,
      reason: 'boundary_summary_missing_approval',
    });
    expect(
      canGenerateSpecFromPlanItem({
        ...baseInput,
        boundarySummaryRevision: { status: 'draft' },
      }),
    ).toEqual({
      ok: false,
      reason: 'boundary_summary_missing_approval',
    });
    expect(
      canGenerateSpecFromPlanItem({
        ...baseInput,
        boundarySummaryRevision: { status: 'approved' },
      }),
    ).toEqual({ ok: true });
  });
});
