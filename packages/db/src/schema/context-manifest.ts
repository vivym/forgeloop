import { jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { ContextManifest } from '@forgeloop/domain';

import { timestampColumn } from './_shared';
import { actors } from './actor';

export const context_manifests = pgTable('context_manifests', {
  id: uuid('id').primaryKey().defaultRandom(),
  revisionId: uuid('revision_id').notNull(),
  sourceRef: jsonb('source_ref').$type<ContextManifest['source_ref']>().notNull(),
  developmentPlanId: uuid('development_plan_id'),
  developmentPlanRevisionId: uuid('development_plan_revision_id'),
  developmentPlanItemId: uuid('development_plan_item_id'),
  developmentPlanItemRevisionId: uuid('development_plan_item_revision_id'),
  brainstormingSessionId: uuid('brainstorming_session_id'),
  brainstormingSessionRevisionId: uuid('brainstorming_session_revision_id'),
  boundarySummaryId: uuid('boundary_summary_id'),
  boundarySummaryRevisionId: uuid('boundary_summary_revision_id'),
  boundaryApproverActorId: uuid('boundary_approver_actor_id').references(() => actors.id),
  boundaryApprovedAt: timestampColumn('boundary_approved_at'),
  approvedSpecRevisionId: uuid('approved_spec_revision_id'),
  sources: jsonb('sources').$type<ContextManifest['sources']>().notNull(),
  generatedAt: timestampColumn('generated_at').notNull(),
  runtimeIdentity: text('runtime_identity'),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});
