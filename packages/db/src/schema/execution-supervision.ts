import { jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { Execution } from '@forgeloop/domain';

import { timestampColumn } from './_shared';
import { development_plan_items } from './development-plan';
import { execution_plan_revisions } from './execution-plan';

export const executions = pgTable('executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  ref: jsonb('ref').$type<Execution['ref']>().notNull(),
  developmentPlanItemId: uuid('development_plan_item_id')
    .notNull()
    .references(() => development_plan_items.id),
  developmentPlanItemRef: jsonb('development_plan_item_ref').$type<Execution['development_plan_item_ref']>().notNull(),
  executionPlanRevisionId: uuid('execution_plan_revision_id')
    .notNull()
    .references(() => execution_plan_revisions.id),
  executionPlanRevisionRef: jsonb('execution_plan_revision_ref')
    .$type<Execution['execution_plan_revision_ref']>()
    .notNull(),
  status: text('status').$type<Execution['status']>().notNull(),
  evidenceRefs: jsonb('evidence_refs').$type<Execution['evidence_refs']>().notNull(),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});
