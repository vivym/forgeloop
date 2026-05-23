import { integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { ExecutionPlanDocument, ExecutionPlanRevision } from '@forgeloop/domain';

import { timestampColumn } from './_shared';
import { actors } from './actor';
import { development_plan_items } from './development-plan';
import { spec_revisions } from './spec';

export const execution_plans = pgTable('execution_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  developmentPlanItemId: uuid('development_plan_item_id')
    .notNull()
    .references(() => development_plan_items.id),
  status: text('status').$type<ExecutionPlanDocument['status']>().notNull(),
  currentRevisionId: uuid('current_revision_id'),
  approvedRevisionId: uuid('approved_revision_id'),
  approvedByActorId: uuid('approved_by_actor_id').references(() => actors.id),
  approvedAt: timestampColumn('approved_at'),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});

export const execution_plan_revisions = pgTable(
  'execution_plan_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    executionPlanId: uuid('execution_plan_id')
      .notNull()
      .references(() => execution_plans.id),
    developmentPlanItemId: uuid('development_plan_item_id')
      .notNull()
      .references(() => development_plan_items.id),
    basedOnSpecRevisionId: uuid('based_on_spec_revision_id')
      .notNull()
      .references(() => spec_revisions.id),
    revisionNumber: integer('revision_number').notNull(),
    summary: text('summary').notNull(),
    content: text('content').notNull(),
    structuredDocument: jsonb('structured_document').$type<ExecutionPlanRevision['structured_document']>(),
    authorActorId: uuid('author_actor_id').references(() => actors.id),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('execution_plan_revisions_plan_revision_unique').on(table.executionPlanId, table.revisionNumber),
  ],
);
