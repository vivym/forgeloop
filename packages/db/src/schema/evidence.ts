import { jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { Artifact, ObjectEvent } from '@forgeloop/domain';

import { decisionValue, timestampColumn, traceLinkRelationship } from './_shared';

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
  id: uuid('id').primaryKey().defaultRandom(),
  objectType: text('object_type').notNull(),
  objectId: text('object_id').notNull(),
  traceSubjectType: text('trace_subject_type'),
  traceSubjectId: text('trace_subject_id'),
  ref: jsonb('ref').$type<Artifact['ref']>().notNull(),
  createdAt: timestampColumn('created_at').notNull(),
});

export const decisions = pgTable('decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  objectType: text('object_type').notNull(),
  objectId: text('object_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  decision: decisionValue('decision').notNull(),
  summary: text('summary').notNull(),
  createdAt: timestampColumn('created_at').notNull(),
});

export const trace_events = pgTable('trace_events', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(),
  actorId: text('actor_id'),
  summary: text('summary').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  createdAt: timestampColumn('created_at').notNull(),
});

export const trace_links = pgTable('trace_links', {
  id: text('id').primaryKey(),
  traceEventId: text('trace_event_id').notNull(),
  relationship: traceLinkRelationship('relationship').notNull(),
  objectType: text('object_type').notNull(),
  objectId: text('object_id').notNull(),
  createdAt: timestampColumn('created_at').notNull(),
});

export const trace_artifact_refs = pgTable('trace_artifact_refs', {
  id: text('id').primaryKey(),
  traceEventId: text('trace_event_id').notNull(),
  artifactId: text('artifact_id'),
  ref: jsonb('ref').$type<Artifact['ref']>().notNull(),
  createdAt: timestampColumn('created_at').notNull(),
});
