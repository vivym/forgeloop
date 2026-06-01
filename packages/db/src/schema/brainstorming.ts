import { boolean, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type {
  BoundaryAnswer,
  BoundaryDecision,
  BoundaryQuestion,
  BoundarySummary,
  BoundarySummaryRevision,
  BrainstormingSession,
} from '@forgeloop/domain';
import type { BoundaryRound, BoundarySummaryRevision as ContractBoundarySummaryRevision } from '@forgeloop/contracts';

import { timestampColumn } from './_shared';
import { actors } from './actor';
import { development_plan_item_revisions, development_plan_items, development_plans } from './development-plan';
import { codex_sessions, codex_session_turns, plan_item_workflows } from './plan-item-workflow';

export const brainstorming_sessions = pgTable('brainstorming_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  revisionId: uuid('revision_id').notNull(),
  sourceRef: jsonb('source_ref').$type<BrainstormingSession['source_ref']>().notNull(),
  developmentPlanId: uuid('development_plan_id')
    .notNull()
    .references(() => development_plans.id),
  developmentPlanRevisionId: uuid('development_plan_revision_id'),
  developmentPlanItemId: uuid('development_plan_item_id')
    .notNull()
    .references(() => development_plan_items.id),
  workflowId: uuid('workflow_id').references(() => plan_item_workflows.id),
  codexSessionId: uuid('codex_session_id').references(() => codex_sessions.id),
  developmentPlanItemRevisionId: uuid('development_plan_item_revision_id').notNull(),
  leaderActorId: uuid('leader_actor_id').references(() => actors.id),
  leaderDelegateActorIds: jsonb('leader_delegate_actor_ids').$type<BrainstormingSession['leader_delegate_actor_ids']>(),
  status: text('status').$type<BrainstormingSession['status']>(),
  currentRoundId: text('current_round_id'),
  latestSummaryRevisionId: uuid('latest_summary_revision_id'),
  approvedSummaryRevisionId: uuid('approved_summary_revision_id'),
  closedAt: timestampColumn('closed_at'),
  contextManifestId: uuid('context_manifest_id').notNull(),
  contextManifestRevisionId: uuid('context_manifest_revision_id').notNull(),
  questions: jsonb('questions').$type<BrainstormingSession['questions']>().notNull(),
  answers: jsonb('answers').$type<BrainstormingSession['answers']>().notNull(),
  decisions: jsonb('decisions').$type<BrainstormingSession['decisions']>().notNull(),
  approvalState: text('approval_state').$type<BrainstormingSession['approval_state']>().notNull(),
  boundarySummaryId: uuid('boundary_summary_id'),
  approverActorId: uuid('approver_actor_id').references(() => actors.id),
  approvedAt: timestampColumn('approved_at'),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});

export const boundary_rounds = pgTable('boundary_rounds', {
  id: text('id').primaryKey(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => brainstorming_sessions.id),
  sessionRevisionId: uuid('session_revision_id').notNull(),
  roundNumber: integer('round_number').notNull(),
  trigger: text('trigger').$type<BoundaryRound['trigger']>().notNull(),
  leaderInputMarkdown: text('leader_input_markdown'),
  aiOutputMarkdown: text('ai_output_markdown'),
  runtimeJobId: uuid('runtime_job_id'),
  codexSessionTurnId: uuid('codex_session_turn_id').references(() => codex_session_turns.id),
  runtimeProfileRevisionId: uuid('runtime_profile_revision_id'),
  credentialBindingVersionId: uuid('credential_binding_version_id'),
  appServerThreadDigest: text('app_server_thread_digest'),
  appServerTurnDigest: text('app_server_turn_digest'),
  status: text('status').$type<BoundaryRound['status']>().notNull(),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});

export const boundary_questions = pgTable('boundary_questions', {
  id: text('id').primaryKey(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => brainstorming_sessions.id),
  roundId: text('round_id').references(() => boundary_rounds.id),
  sequence: integer('sequence').notNull(),
  text: text('text').notNull(),
  authorId: text('author_id').notNull(),
  createdAt: timestampColumn('created_at').notNull(),
  status: text('status').$type<BoundaryQuestion['status']>().notNull(),
  required: boolean('required').notNull(),
  rationale: text('rationale'),
  answeredByAnswerId: text('answered_by_answer_id'),
  waivedByDecisionId: text('waived_by_decision_id'),
});

export const boundary_answers = pgTable('boundary_answers', {
  id: text('id').primaryKey(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => brainstorming_sessions.id),
  roundId: text('round_id').references(() => boundary_rounds.id),
  questionId: text('question_id').notNull(),
  sequence: integer('sequence').notNull(),
  text: text('text').notNull(),
  actorId: text('actor_id').notNull(),
  actorRole: text('actor_role').$type<BoundaryAnswer['actor_role']>(),
  answeredForActorId: text('answered_for_actor_id'),
  createdAt: timestampColumn('created_at').notNull(),
});

export const boundary_decisions = pgTable('boundary_decisions', {
  id: text('id').primaryKey(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => brainstorming_sessions.id),
  roundId: text('round_id').references(() => boundary_rounds.id),
  sequence: integer('sequence').notNull(),
  text: text('text').notNull(),
  actorId: text('actor_id').notNull(),
  actorRole: text('actor_role').$type<BoundaryDecision['actor_role']>(),
  source: text('source').$type<BoundaryDecision['source']>().notNull(),
  state: text('state').$type<BoundaryDecision['state']>().notNull(),
  rationale: text('rationale'),
  createdAt: timestampColumn('created_at').notNull(),
});

export const boundary_summaries = pgTable('boundary_summaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  revisionId: uuid('revision_id').notNull(),
  brainstormingSessionId: uuid('brainstorming_session_id')
    .notNull()
    .references(() => brainstorming_sessions.id),
  brainstormingSessionRevisionId: uuid('brainstorming_session_revision_id').notNull(),
  developmentPlanId: uuid('development_plan_id')
    .notNull()
    .references(() => development_plans.id),
  developmentPlanItemId: uuid('development_plan_item_id')
    .notNull()
    .references(() => development_plan_items.id),
  developmentPlanItemRevisionId: uuid('development_plan_item_revision_id').notNull(),
  sourceRef: jsonb('source_ref').$type<BoundarySummary['source_ref']>().notNull(),
  summary: text('summary').notNull(),
  approvedByActorId: uuid('approved_by_actor_id').references(() => actors.id),
  approvedAt: timestampColumn('approved_at'),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});

export const boundary_summary_revisions = pgTable(
  'boundary_summary_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boundarySummaryId: uuid('boundary_summary_id')
      .notNull()
      .references(() => boundary_summaries.id),
    brainstormingSessionId: uuid('brainstorming_session_id')
      .notNull()
      .references(() => brainstorming_sessions.id),
    brainstormingSessionRevisionId: uuid('brainstorming_session_revision_id').notNull(),
    sourceRoundId: text('source_round_id').references(() => boundary_rounds.id),
    developmentPlanId: uuid('development_plan_id').references(() => development_plans.id),
    developmentPlanItemId: uuid('development_plan_item_id')
      .notNull()
      .references(() => development_plan_items.id),
    workflowId: uuid('workflow_id').references(() => plan_item_workflows.id),
    codexSessionId: uuid('codex_session_id').references(() => codex_sessions.id),
    codexSessionTurnId: uuid('codex_session_turn_id').references(() => codex_session_turns.id),
    developmentPlanItemRevisionId: uuid('development_plan_item_revision_id')
      .notNull()
      .references(() => development_plan_item_revisions.id),
    revisionNumber: integer('revision_number').notNull(),
    status: text('status').$type<ContractBoundarySummaryRevision['status']>(),
    summaryMarkdown: text('summary_markdown').notNull(),
    confirmedScope: jsonb('confirmed_scope').$type<ContractBoundarySummaryRevision['confirmed_scope']>(),
    confirmedOutOfScope: jsonb('confirmed_out_of_scope').$type<ContractBoundarySummaryRevision['confirmed_out_of_scope']>(),
    acceptedAssumptions: jsonb('accepted_assumptions').$type<ContractBoundarySummaryRevision['accepted_assumptions']>(),
    openRisks: jsonb('open_risks').$type<ContractBoundarySummaryRevision['open_risks']>(),
    validationExpectations: jsonb('validation_expectations').$type<ContractBoundarySummaryRevision['validation_expectations']>(),
    questionAnswerSnapshot: jsonb('question_answer_snapshot').$type<ContractBoundarySummaryRevision['question_answer_snapshot']>(),
    decisionSnapshot: jsonb('decision_snapshot').$type<BoundarySummaryRevision['decision_snapshot']>().notNull(),
    decisionCount: integer('decision_count').notNull(),
    contextManifestId: uuid('context_manifest_id'),
    contextManifestRevisionId: uuid('context_manifest_revision_id'),
    proposedByRuntimeJobId: uuid('proposed_by_runtime_job_id'),
    approvedByActorId: uuid('approved_by_actor_id').references(() => actors.id),
    approvedAt: timestampColumn('approved_at'),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('boundary_revisions_summary_revision_unique').on(table.boundarySummaryId, table.revisionNumber),
  ],
);
