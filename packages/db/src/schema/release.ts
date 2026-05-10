import { boolean, index, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { Release, ReleaseEvidenceObjectRef } from '@forgeloop/domain';

import {
  releaseActivityState,
  releaseEvidenceStatus,
  releaseEvidenceType,
  releaseGateState,
  releasePhase,
  releaseResolution,
  releaseType,
  timestampColumn,
} from './_shared';
import { actors } from './actor';
import { artifacts } from './evidence';
import { execution_packages } from './execution-package';
import { organizations } from './organization';
import { projects } from './project';
import { work_items } from './work-item';

export const releases = pgTable(
  'releases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    key: text('key').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    phase: releasePhase('phase').notNull(),
    activityState: releaseActivityState('activity_state').notNull(),
    gateState: releaseGateState('gate_state').notNull(),
    resolution: releaseResolution('resolution').notNull(),
    releaseOwnerActorId: uuid('release_owner_actor_id')
      .notNull()
      .references(() => actors.id),
    releaseType: releaseType('release_type').notNull(),
    scopeSummary: text('scope_summary'),
    riskSummary: jsonb('risk_summary').$type<Record<string, unknown>>(),
    rolloutStrategy: jsonb('rollout_strategy').$type<Record<string, unknown>>(),
    rollbackPlan: jsonb('rollback_plan').$type<Record<string, unknown>>(),
    observationPlan: jsonb('observation_plan').$type<Record<string, unknown>>(),
    currentReviewPacketIds: jsonb('current_review_packet_ids').$type<Release['current_review_packet_ids']>(),
    currentRunSessionIds: jsonb('current_run_session_ids').$type<Release['current_run_session_ids']>(),
    rolloutStartedAt: timestampColumn('rollout_started_at'),
    rolloutCompletedAt: timestampColumn('rollout_completed_at'),
    observedUntil: timestampColumn('observed_until'),
    visibility: text('visibility').notNull(),
    sourceType: text('source_type'),
    labels: text('labels').array().notNull(),
    extra: jsonb('extra').$type<Record<string, unknown>>(),
    createdAt: timestampColumn('created_at').notNull(),
    createdByActorId: uuid('created_by_actor_id')
      .notNull()
      .references(() => actors.id),
    updatedAt: timestampColumn('updated_at').notNull(),
    updatedByActorId: uuid('updated_by_actor_id')
      .notNull()
      .references(() => actors.id),
    archivedAt: timestampColumn('archived_at'),
    deletedAt: timestampColumn('deleted_at'),
    closedAt: timestampColumn('closed_at'),
  },
  (table) => [
    uniqueIndex('releases_org_key_uq').on(table.orgId, table.key),
    index('releases_project_phase_idx').on(table.projectId, table.phase),
    index('releases_owner_phase_idx').on(table.releaseOwnerActorId, table.phase),
  ],
);

export const release_work_items = pgTable(
  'release_work_items',
  {
    releaseId: uuid('release_id')
      .notNull()
      .references(() => releases.id, { onDelete: 'cascade' }),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => work_items.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.releaseId, table.workItemId] }),
    index('release_work_items_work_item_idx').on(table.workItemId),
  ],
);

export const release_execution_packages = pgTable(
  'release_execution_packages',
  {
    releaseId: uuid('release_id')
      .notNull()
      .references(() => releases.id, { onDelete: 'cascade' }),
    packageId: uuid('package_id')
      .notNull()
      .references(() => execution_packages.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.releaseId, table.packageId] }),
    index('release_execution_packages_package_idx').on(table.packageId),
  ],
);

export const release_evidences = pgTable(
  'release_evidences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    releaseId: uuid('release_id')
      .notNull()
      .references(() => releases.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    title: text('title'),
    description: text('description'),
    evidenceType: releaseEvidenceType('evidence_type').notNull(),
    artifactId: uuid('artifact_id').references(() => artifacts.id),
    summary: text('summary').notNull(),
    objectRef: jsonb('object_ref').$type<ReleaseEvidenceObjectRef>(),
    redacted: boolean('redacted').notNull(),
    status: releaseEvidenceStatus('status').notNull(),
    visibility: text('visibility').notNull(),
    sourceType: text('source_type'),
    labels: text('labels').array().notNull(),
    extra: jsonb('extra').$type<Record<string, unknown>>(),
    createdAt: timestampColumn('created_at').notNull(),
    createdByActorId: uuid('created_by_actor_id')
      .notNull()
      .references(() => actors.id),
    updatedAt: timestampColumn('updated_at').notNull(),
    updatedByActorId: uuid('updated_by_actor_id')
      .notNull()
      .references(() => actors.id),
    archivedAt: timestampColumn('archived_at'),
    deletedAt: timestampColumn('deleted_at'),
  },
  (table) => [
    uniqueIndex('release_evidences_org_key_uq').on(table.orgId, table.key),
    index('release_evidences_release_idx').on(table.releaseId),
    index('release_evidences_type_idx').on(table.evidenceType),
  ],
);
