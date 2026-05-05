import { integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import type { PlanRevision } from '@forgeloop/domain';

import { specPlanEditingState, specPlanGateState, specPlanResolution, specPlanStatus, timestampColumn } from './_shared';

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  workItemId: text('work_item_id').notNull(),
  entityType: text('entity_type').notNull(),
  status: specPlanStatus('status').notNull(),
  editingState: specPlanEditingState('editing_state').notNull(),
  gateState: specPlanGateState('gate_state').notNull(),
  resolution: specPlanResolution('resolution').notNull(),
  currentRevisionId: text('current_revision_id'),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});

export const plan_revisions = pgTable('plan_revisions', {
  id: text('id').primaryKey(),
  planId: text('plan_id').notNull(),
  workItemId: text('work_item_id').notNull(),
  revisionNumber: integer('revision_number').notNull(),
  summary: text('summary').notNull(),
  content: text('content').notNull(),
  implementationSummary: text('implementation_summary').notNull(),
  splitStrategy: text('split_strategy').notNull(),
  dependencyOrder: jsonb('dependency_order').$type<PlanRevision['dependency_order']>().notNull(),
  testMatrix: jsonb('test_matrix').$type<PlanRevision['test_matrix']>().notNull(),
  riskMitigations: jsonb('risk_mitigations').$type<PlanRevision['risk_mitigations']>().notNull(),
  rollbackNotes: text('rollback_notes').notNull(),
  structuredDocument: jsonb('structured_document').$type<PlanRevision['structured_document']>(),
  authorActorId: text('author_actor_id'),
  artifactRefs: jsonb('artifact_refs').$type<PlanRevision['artifact_refs']>().notNull(),
  createdAt: timestampColumn('created_at').notNull(),
});
