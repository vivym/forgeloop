import { jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { WorkItem } from '@forgeloop/domain';

import {
  timestampColumn,
  workItemActivityState,
  workItemGateState,
  workItemKind,
  workItemPhase,
  workItemResolution,
} from './_shared';
import { actors } from './actor';

export const work_items = pgTable('work_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  kind: workItemKind('kind').notNull(),
  title: text('title').notNull(),
  narrativeMarkdown: text('narrative_markdown').notNull().default(''),
  goal: text('goal').notNull(),
  successCriteria: jsonb('success_criteria').$type<WorkItem['success_criteria']>().notNull(),
  priority: text('priority').notNull(),
  risk: text('risk').notNull(),
  driverActorId: uuid('driver_actor_id')
    .notNull()
    .references(() => actors.id),
  intakeContext: jsonb('intake_context').$type<WorkItem['intake_context']>().notNull(),
  phase: workItemPhase('phase').notNull(),
  activityState: workItemActivityState('activity_state').notNull(),
  gateState: workItemGateState('gate_state').notNull(),
  resolution: workItemResolution('resolution').notNull(),
  currentSpecId: uuid('current_spec_id'),
  currentSpecRevisionId: uuid('current_spec_revision_id'),
  currentPlanId: uuid('current_plan_id'),
  currentPlanRevisionId: uuid('current_plan_revision_id'),
  currentReleaseId: uuid('current_release_id'),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});
