import { integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { SpecRevision } from '@forgeloop/domain';

import { specPlanEditingState, specPlanGateState, specPlanResolution, specPlanStatus, timestampColumn } from './_shared';
import { actors } from './actor';

export const specs = pgTable('specs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workItemId: uuid('work_item_id').notNull(),
  entityType: text('entity_type').notNull(),
  status: specPlanStatus('status').notNull(),
  editingState: specPlanEditingState('editing_state').notNull(),
  gateState: specPlanGateState('gate_state').notNull(),
  resolution: specPlanResolution('resolution').notNull(),
  currentRevisionId: uuid('current_revision_id'),
  approvedRevisionId: uuid('approved_revision_id'),
  approvedAt: timestampColumn('approved_at'),
  approvedByActorId: uuid('approved_by_actor_id').references(() => actors.id),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});

export const spec_revisions = pgTable('spec_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  specId: uuid('spec_id').notNull(),
  workItemId: uuid('work_item_id').notNull(),
  revisionNumber: integer('revision_number').notNull(),
  summary: text('summary').notNull(),
  content: text('content').notNull(),
  background: text('background').notNull(),
  goals: jsonb('goals').$type<SpecRevision['goals']>().notNull(),
  scopeIn: jsonb('scope_in').$type<SpecRevision['scope_in']>().notNull(),
  scopeOut: jsonb('scope_out').$type<SpecRevision['scope_out']>().notNull(),
  acceptanceCriteria: jsonb('acceptance_criteria').$type<SpecRevision['acceptance_criteria']>().notNull(),
  riskNotes: jsonb('risk_notes').$type<SpecRevision['risk_notes']>().notNull(),
  testStrategySummary: text('test_strategy_summary').notNull(),
  structuredDocument: jsonb('structured_document').$type<SpecRevision['structured_document']>(),
  authorActorId: uuid('author_actor_id').references(() => actors.id),
  artifactRefs: jsonb('artifact_refs').$type<SpecRevision['artifact_refs']>().notNull(),
  createdAt: timestampColumn('created_at').notNull(),
});
