import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { ReviewPacket } from '@forgeloop/domain';

import { reviewPacketDecision, reviewPacketStatus, timestampColumn } from './_shared';
import { actors } from './actor';
import { codex_sessions, codex_session_turns, plan_item_workflows } from './plan-item-workflow';

export const review_packets = pgTable(
  'review_packets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runSessionId: uuid('run_session_id').notNull(),
    executionPackageId: uuid('execution_package_id').notNull(),
    workflowId: uuid('workflow_id').references(() => plan_item_workflows.id),
    codexSessionId: uuid('codex_session_id').references(() => codex_sessions.id),
    codexSessionTurnId: uuid('codex_session_turn_id').references(() => codex_session_turns.id),
    reviewerActorId: uuid('reviewer_actor_id')
      .notNull()
      .references(() => actors.id),
    specRevisionId: uuid('spec_revision_id').notNull(),
    planRevisionId: uuid('plan_revision_id').notNull(),
    status: reviewPacketStatus('status').notNull(),
    decision: reviewPacketDecision('decision').notNull(),
    summary: text('summary'),
    changedFiles: jsonb('changed_files').$type<ReviewPacket['changed_files']>().notNull(),
    checkResultSummary: text('check_result_summary').notNull(),
    selfReview: jsonb('self_review').$type<ReviewPacket['self_review']>().notNull(),
    independentAiReview: jsonb('independent_ai_review').$type<ReviewPacket['independent_ai_review']>(),
    testMapping: jsonb('test_mapping').$type<ReviewPacket['test_mapping']>(),
    riskNotes: jsonb('risk_notes').$type<ReviewPacket['risk_notes']>().notNull(),
    reviewedByActorId: uuid('reviewed_by_actor_id').references(() => actors.id),
    reviewedAt: timestampColumn('reviewed_at'),
    requestedChanges: jsonb('requested_changes').$type<ReviewPacket['requested_changes']>().notNull(),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
    completedAt: timestampColumn('completed_at'),
  },
  (table) => [
    uniqueIndex('review_packets_one_open_per_package')
      .on(table.executionPackageId)
      .where(sql`${table.status} in ('draft','ready','in_review','escalated')`),
  ],
);
