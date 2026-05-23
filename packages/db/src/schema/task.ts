import { jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { ObjectRef } from '@forgeloop/contracts';
import type { Task } from '@forgeloop/domain';

import { timestampColumn } from './_shared';

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  title: text('title').notNull(),
  narrativeMarkdown: text('narrative_markdown').notNull().default(''),
  executionBrief: text('execution_brief').notNull(),
  acceptanceChecklist: jsonb('acceptance_checklist').$type<string[]>().notNull(),
  status: text('status').notNull(),
  parentRef: jsonb('parent_ref').$type<ObjectRef>(),
  controllingSpecRevisionId: uuid('controlling_spec_revision_id'),
  controllingPlanRevisionId: uuid('controlling_plan_revision_id'),
  staleState: text('stale_state').notNull(),
  auditedException: jsonb('audited_exception').$type<Task['audited_exception']>(),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});
