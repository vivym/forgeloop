import { integer, pgTable, text } from 'drizzle-orm/pg-core';

export const run_event_counters = pgTable('run_event_counters', {
  runSessionId: text('run_session_id').primaryKey(),
  nextSequence: integer('next_sequence').notNull(),
});
