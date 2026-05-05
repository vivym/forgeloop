import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import type { WorkItem } from '@forgeloop/domain';

import {
  timestampColumn,
  workItemActivityState,
  workItemGateState,
  workItemKind,
  workItemPhase,
  workItemResolution,
} from './_shared';

export const work_items = pgTable('work_items', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  kind: workItemKind('kind').notNull(),
  title: text('title').notNull(),
  goal: text('goal').notNull(),
  successCriteria: jsonb('success_criteria').$type<WorkItem['success_criteria']>().notNull(),
  priority: text('priority').notNull(),
  risk: text('risk').notNull(),
  ownerActorId: text('owner_actor_id').notNull(),
  phase: workItemPhase('phase').notNull(),
  activityState: workItemActivityState('activity_state').notNull(),
  gateState: workItemGateState('gate_state').notNull(),
  resolution: workItemResolution('resolution').notNull(),
  currentSpecId: text('current_spec_id'),
  currentPlanId: text('current_plan_id'),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});
