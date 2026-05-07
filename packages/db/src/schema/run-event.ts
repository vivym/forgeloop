import { integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import type { RunEvent } from '@forgeloop/domain';

import { timestampColumn } from './_shared';

export const run_events = pgTable('run_events', {
  id: text('id').primaryKey(),
  runSessionId: text('run_session_id').notNull(),
  sequence: integer('sequence').notNull(),
  cursor: text('cursor').notNull(),
  eventType: text('event_type').notNull(),
  source: text('source').notNull(),
  visibility: text('visibility').notNull(),
  summary: text('summary').notNull(),
  payload: jsonb('payload').$type<RunEvent['payload']>().notNull(),
  rawRef: jsonb('raw_ref').$type<RunEvent['raw_ref']>(),
  createdAt: timestampColumn('created_at').notNull(),
});
