import { jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { ReviewPacket } from '@forgeloop/domain';

import { reviewPacketDecision, reviewPacketStatus, timestampColumn } from './_shared';
import { actors } from './actor';

export const review_packets = pgTable('review_packets', {
  id: uuid('id').primaryKey().defaultRandom(),
  runSessionId: uuid('run_session_id').notNull(),
  executionPackageId: uuid('execution_package_id').notNull(),
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
  riskNotes: jsonb('risk_notes').$type<ReviewPacket['risk_notes']>().notNull(),
  reviewedByActorId: uuid('reviewed_by_actor_id').references(() => actors.id),
  reviewedAt: timestampColumn('reviewed_at'),
  requestedChanges: jsonb('requested_changes').$type<ReviewPacket['requested_changes']>().notNull(),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
  completedAt: timestampColumn('completed_at'),
});
