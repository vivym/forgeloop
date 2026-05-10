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
  goal: text('goal').notNull(),
  successCriteria: jsonb('success_criteria').$type<WorkItem['success_criteria']>().notNull(),
  priority: text('priority').notNull(),
  risk: text('risk').notNull(),
  ownerActorId: uuid('owner_actor_id')
    .notNull()
    .references(() => actors.id),
  phase: workItemPhase('phase').notNull(),
  activityState: workItemActivityState('activity_state').notNull(),
  gateState: workItemGateState('gate_state').notNull(),
  resolution: workItemResolution('resolution').notNull(),
  currentSpecId: uuid('current_spec_id'),
  currentPlanId: uuid('current_plan_id'),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});
