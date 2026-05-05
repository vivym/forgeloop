import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import type { Artifact, ObjectEvent } from '@forgeloop/domain';

import { decisionValue, timestampColumn } from './_shared';

export const object_events = pgTable('object_events', {
  id: text('id').primaryKey(),
  objectType: text('object_type').notNull(),
  objectId: text('object_id').notNull(),
  eventType: text('event_type').notNull(),
  actorId: text('actor_id'),
  metadata: jsonb('metadata').$type<ObjectEvent['metadata']>().notNull(),
  createdAt: timestampColumn('created_at').notNull(),
});

export const status_histories = pgTable('status_histories', {
  id: text('id').primaryKey(),
  objectType: text('object_type').notNull(),
  objectId: text('object_id').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  actorId: text('actor_id'),
  reason: text('reason'),
  createdAt: timestampColumn('created_at').notNull(),
});

export const artifacts = pgTable('artifacts', {
  id: text('id').primaryKey(),
  objectType: text('object_type').notNull(),
  objectId: text('object_id').notNull(),
  traceSubjectType: text('trace_subject_type'),
  traceSubjectId: text('trace_subject_id'),
  ref: jsonb('ref').$type<Artifact['ref']>().notNull(),
  createdAt: timestampColumn('created_at').notNull(),
});

export const decisions = pgTable('decisions', {
  id: text('id').primaryKey(),
  objectType: text('object_type').notNull(),
  objectId: text('object_id').notNull(),
  actorId: text('actor_id').notNull(),
  decision: decisionValue('decision').notNull(),
  summary: text('summary').notNull(),
  createdAt: timestampColumn('created_at').notNull(),
});
