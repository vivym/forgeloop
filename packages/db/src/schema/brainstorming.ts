import { integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { BoundarySummary, BoundarySummaryRevision, BrainstormingSession } from '@forgeloop/domain';

import { timestampColumn } from './_shared';
import { actors } from './actor';
import { development_plan_items, development_plans } from './development-plan';

export const brainstorming_sessions = pgTable('brainstorming_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  revisionId: uuid('revision_id').notNull(),
  sourceRef: jsonb('source_ref').$type<BrainstormingSession['source_ref']>().notNull(),
  developmentPlanId: uuid('development_plan_id')
    .notNull()
    .references(() => development_plans.id),
  developmentPlanItemId: uuid('development_plan_item_id')
    .notNull()
    .references(() => development_plan_items.id),
  developmentPlanItemRevisionId: uuid('development_plan_item_revision_id').notNull(),
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

export const boundary_summary_revisions = pgTable('boundary_summary_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  boundarySummaryId: uuid('boundary_summary_id')
    .notNull()
    .references(() => boundary_summaries.id),
  brainstormingSessionId: uuid('brainstorming_session_id')
    .notNull()
    .references(() => brainstorming_sessions.id),
  developmentPlanItemId: uuid('development_plan_item_id')
    .notNull()
    .references(() => development_plan_items.id),
  revisionNumber: integer('revision_number').notNull(),
  summaryMarkdown: text('summary_markdown').notNull(),
  decisionSnapshot: jsonb('decision_snapshot').$type<BoundarySummaryRevision['decision_snapshot']>().notNull(),
  decisionCount: integer('decision_count').notNull(),
  approvedByActorId: uuid('approved_by_actor_id').references(() => actors.id),
  approvedAt: timestampColumn('approved_at'),
  createdAt: timestampColumn('created_at').notNull(),
});
