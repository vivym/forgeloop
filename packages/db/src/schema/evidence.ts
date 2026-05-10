import { jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { Artifact, Decision, ObjectEvent, StatusHistory } from '@forgeloop/domain';

import { decisionValue, timestampColumn, traceLinkRelationship } from './_shared';
import { actors } from './actor';

export const object_events = pgTable('object_events', {
  id: text('id').primaryKey(),
  objectType: text('object_type').notNull(),
  objectId: text('object_id').notNull(),
  eventType: text('event_type').notNull(),
  actorType: text('actor_type'),
  actorId: text('actor_id'),
  reason: text('reason'),
  payload: jsonb('payload').$type<ObjectEvent['payload']>(),
  metadata: jsonb('metadata').$type<ObjectEvent['metadata']>().notNull(),
  createdAt: timestampColumn('created_at').notNull(),
});

export const status_histories = pgTable('status_histories', {
  id: text('id').primaryKey(),
  objectType: text('object_type').notNull(),
  objectId: text('object_id').notNull(),
  fieldName: text('field_name'),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  fromValue: text('from_value'),
  toValue: text('to_value'),
  actorType: text('actor_type'),
  actorId: text('actor_id'),
  reason: text('reason'),
  context: jsonb('context').$type<StatusHistory['context']>(),
  createdAt: timestampColumn('created_at').notNull(),
});

export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  objectType: text('object_type').notNull(),
  objectId: text('object_id').notNull(),
  traceSubjectType: text('trace_subject_type'),
  traceSubjectId: text('trace_subject_id'),
  artifactType: text('artifact_type'),
  ref: jsonb('ref').$type<Artifact['ref']>().notNull(),
  createdAt: timestampColumn('created_at').notNull(),
});

export const decisions = pgTable('decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  objectType: text('object_type').notNull(),
  objectId: text('object_id').notNull(),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => actors.id),
  decidedByActorId: uuid('decided_by_actor_id').references(() => actors.id),
  decisionType: text('decision_type'),
  outcome: decisionValue('outcome'),
  decision: decisionValue('decision').notNull(),
  summary: text('summary').notNull(),
  rationale: text('rationale'),
  evidenceRefs: jsonb('evidence_refs').$type<Decision['evidence_refs']>(),
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
