import { boolean, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { CodeReviewHandoff, Execution, QaHandoff } from '@forgeloop/domain';

import { timestampColumn } from './_shared';
import { actors } from './actor';
import { development_plan_items } from './development-plan';
import { execution_plan_revisions } from './execution-plan';
import { spec_revisions } from './spec';

export const executions = pgTable('executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  ref: jsonb('ref').$type<Execution['ref']>().notNull(),
  developmentPlanItemId: uuid('development_plan_item_id')
    .notNull()
    .references(() => development_plan_items.id),
  developmentPlanItemRef: jsonb('development_plan_item_ref').$type<Execution['development_plan_item_ref']>().notNull(),
  implementationPlanRevisionId: uuid('execution_plan_revision_id')
    .notNull()
    .references(() => execution_plan_revisions.id),
  implementationPlanRevisionRef: jsonb('execution_plan_revision_ref')
    .$type<Execution['implementation_plan_revision_ref']>()
    .notNull(),
  approvedSpecRevisionId: uuid('approved_spec_revision_id')
    .notNull()
    .references(() => spec_revisions.id),
  approvedSpecRevisionRef: jsonb('approved_spec_revision_ref').$type<Execution['approved_spec_revision_ref']>().notNull(),
  status: text('status').$type<Execution['status']>().notNull(),
  workerState: text('worker_state').$type<Execution['worker_state']>(),
  currentStep: text('current_step').$type<Execution['current_step']>(),
  stale: boolean('stale').$type<Execution['stale']>(),
  blocked: boolean('blocked').$type<Execution['blocked']>(),
  lastEventAt: timestampColumn('last_event_at').$type<Execution['last_event_at']>(),
  lastEventSummary: text('last_event_summary').$type<Execution['last_event_summary']>(),
  evidenceRefs: jsonb('evidence_refs').$type<Execution['evidence_refs']>().notNull(),
  runtimeEvidenceRefs: jsonb('runtime_evidence_refs').$type<Execution['runtime_evidence_refs']>().notNull(),
  interruptHistory: jsonb('interrupt_history').$type<Execution['interrupt_history']>().notNull(),
  continuationHistory: jsonb('continuation_history').$type<Execution['continuation_history']>().notNull(),
  prRefs: jsonb('pr_refs').$type<Execution['pr_refs']>().notNull(),
  diffRefs: jsonb('diff_refs').$type<Execution['diff_refs']>().notNull(),
  testEvidenceRefs: jsonb('test_evidence_refs').$type<Execution['test_evidence_refs']>().notNull(),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});

export const code_review_handoffs = pgTable('code_review_handoffs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ref: jsonb('ref').$type<CodeReviewHandoff['ref']>().notNull(),
  executionId: uuid('execution_id')
    .notNull()
    .references(() => executions.id),
  developmentPlanItemId: uuid('development_plan_item_id')
    .notNull()
    .references(() => development_plan_items.id),
  implementationPlanRevisionId: uuid('execution_plan_revision_id')
    .notNull()
    .references(() => execution_plan_revisions.id),
  reviewerActorId: uuid('reviewer_actor_id')
    .notNull()
    .references(() => actors.id),
  status: text('status').$type<CodeReviewHandoff['status']>().notNull(),
  summary: text('summary').notNull(),
  changedSurfaces: jsonb('changed_surfaces').$type<CodeReviewHandoff['changed_surfaces']>().notNull(),
  verificationEvidenceRefs: jsonb('verification_evidence_refs')
    .$type<CodeReviewHandoff['verification_evidence_refs']>()
    .notNull(),
  approvedByActorId: uuid('approved_by_actor_id').references(() => actors.id),
  approvedAt: timestampColumn('approved_at'),
  decisionRationale: text('decision_rationale'),
  auditedException: jsonb('audited_exception').$type<CodeReviewHandoff['audited_exception']>(),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});

export const qa_handoffs = pgTable('qa_handoffs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ref: jsonb('ref').$type<QaHandoff['ref']>().notNull(),
  codeReviewHandoffId: uuid('code_review_handoff_id')
    .notNull()
    .references(() => code_review_handoffs.id),
  executionId: uuid('execution_id')
    .notNull()
    .references(() => executions.id),
  sourceRef: jsonb('source_ref').$type<QaHandoff['source_ref']>().notNull(),
  developmentPlanItemId: uuid('development_plan_item_id')
    .notNull()
    .references(() => development_plan_items.id),
  developmentPlanItemRef: jsonb('development_plan_item_ref').$type<QaHandoff['development_plan_item_ref']>().notNull(),
  approvedSpecRevisionRef: jsonb('approved_spec_revision_ref').$type<QaHandoff['approved_spec_revision_ref']>().notNull(),
  approvedImplementationPlanRevisionRef: jsonb('approved_execution_plan_revision_ref')
    .$type<QaHandoff['approved_implementation_plan_revision_ref']>()
    .notNull(),
  status: text('status').$type<QaHandoff['status']>().notNull(),
  acceptanceCriteria: jsonb('acceptance_criteria').$type<QaHandoff['acceptance_criteria']>().notNull(),
  testStrategy: text('test_strategy').notNull(),
  verificationEvidenceRefs: jsonb('verification_evidence_refs').$type<QaHandoff['verification_evidence_refs']>().notNull(),
  knownRisks: jsonb('known_risks').$type<QaHandoff['known_risks']>().notNull(),
  changedSurfaces: jsonb('changed_surfaces').$type<QaHandoff['changed_surfaces']>().notNull(),
  releaseImpact: text('release_impact').$type<QaHandoff['release_impact']>().notNull(),
  blockedByActorId: uuid('blocked_by_actor_id').references(() => actors.id),
  acceptedByActorId: uuid('accepted_by_actor_id').references(() => actors.id),
  rationale: text('rationale'),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});
