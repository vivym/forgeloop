import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import type { ReviewPacket } from '@forgeloop/domain';

import { reviewPacketDecision, reviewPacketStatus, timestampColumn } from './_shared';

export const review_packets = pgTable('review_packets', {
  id: text('id').primaryKey(),
  runSessionId: text('run_session_id').notNull(),
  executionPackageId: text('execution_package_id').notNull(),
  reviewerActorId: text('reviewer_actor_id').notNull(),
  specRevisionId: text('spec_revision_id').notNull(),
  planRevisionId: text('plan_revision_id').notNull(),
  status: reviewPacketStatus('status').notNull(),
  decision: reviewPacketDecision('decision').notNull(),
  summary: text('summary'),
  changedFiles: jsonb('changed_files').$type<ReviewPacket['changed_files']>().notNull(),
  checkResultSummary: text('check_result_summary').notNull(),
  selfReview: jsonb('self_review').$type<ReviewPacket['self_review']>().notNull(),
  riskNotes: jsonb('risk_notes').$type<ReviewPacket['risk_notes']>().notNull(),
  reviewedByActorId: text('reviewed_by_actor_id'),
  reviewedAt: timestampColumn('reviewed_at'),
  requestedChanges: jsonb('requested_changes').$type<ReviewPacket['requested_changes']>().notNull(),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
  completedAt: timestampColumn('completed_at'),
});
