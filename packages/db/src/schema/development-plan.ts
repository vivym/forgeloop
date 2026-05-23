import { integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type {
  DevelopmentPlan,
  DevelopmentPlanItem,
  DevelopmentPlanItemRevision,
  DevelopmentPlanSourceLink,
} from '@forgeloop/domain';

import { timestampColumn } from './_shared';
import { actors } from './actor';
import { projects } from './project';

export const development_plans = pgTable('development_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  revisionId: uuid('revision_id').notNull(),
  title: text('title').notNull(),
  status: text('status').$type<DevelopmentPlan['status']>().notNull(),
  sourceRefs: jsonb('source_refs').$type<DevelopmentPlan['source_refs']>().notNull(),
  items: jsonb('items').$type<DevelopmentPlan['items']>().notNull(),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});

export const development_plan_source_links = pgTable('development_plan_source_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  developmentPlanId: uuid('development_plan_id')
    .notNull()
    .references(() => development_plans.id),
  sourceRef: jsonb('source_ref').$type<DevelopmentPlanSourceLink['source_ref']>().notNull(),
  linkType: text('link_type').$type<DevelopmentPlanSourceLink['link_type']>().notNull(),
  rationale: text('rationale'),
  createdByActorId: uuid('created_by_actor_id').references(() => actors.id),
  createdAt: timestampColumn('created_at').notNull(),
});

export const development_plan_items = pgTable('development_plan_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  developmentPlanId: uuid('development_plan_id')
    .notNull()
    .references(() => development_plans.id),
  revisionId: uuid('revision_id').notNull(),
  sourceRef: jsonb('source_ref').$type<DevelopmentPlanItem['source_ref']>().notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  driverActorId: uuid('driver_actor_id').references(() => actors.id),
  responsibleRole: text('responsible_role').$type<DevelopmentPlanItem['responsible_role']>().notNull(),
  reviewerActorId: uuid('reviewer_actor_id').references(() => actors.id),
  risk: text('risk').$type<DevelopmentPlanItem['risk']>().notNull(),
  dependencyHints: jsonb('dependency_hints').$type<DevelopmentPlanItem['dependency_hints']>().notNull(),
  affectedSurfaces: jsonb('affected_surfaces').$type<DevelopmentPlanItem['affected_surfaces']>().notNull(),
  boundaryStatus: text('boundary_status').$type<DevelopmentPlanItem['boundary_status']>().notNull(),
  specStatus: text('spec_status').$type<DevelopmentPlanItem['spec_status']>().notNull(),
  executionPlanStatus: text('execution_plan_status').$type<DevelopmentPlanItem['execution_plan_status']>().notNull(),
  executionStatus: text('execution_status').$type<DevelopmentPlanItem['execution_status']>().notNull(),
  reviewStatus: text('review_status').$type<DevelopmentPlanItem['review_status']>().notNull(),
  qaHandoffStatus: text('qa_handoff_status').$type<DevelopmentPlanItem['qa_handoff_status']>().notNull(),
  releaseImpact: text('release_impact').$type<DevelopmentPlanItem['release_impact']>().notNull(),
  nextAction: text('next_action').notNull(),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});

export const development_plan_item_revisions = pgTable(
  'development_plan_item_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    developmentPlanItemId: uuid('development_plan_item_id')
      .notNull()
      .references(() => development_plan_items.id),
    developmentPlanId: uuid('development_plan_id')
      .notNull()
      .references(() => development_plans.id),
    revisionNumber: integer('revision_number').notNull(),
    snapshot: jsonb('snapshot').$type<DevelopmentPlanItemRevision['snapshot']>().notNull(),
    changeReason: text('change_reason').notNull(),
    editedByActorId: uuid('edited_by_actor_id').references(() => actors.id),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('dpi_revisions_item_revision_unique').on(table.developmentPlanItemId, table.revisionNumber),
  ],
);
