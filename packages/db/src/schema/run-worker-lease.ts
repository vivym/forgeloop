import { pgTable, text } from 'drizzle-orm/pg-core';

import { timestampColumn } from './_shared';

export const run_worker_leases = pgTable('run_worker_leases', {
  id: text('id').primaryKey(),
  runSessionId: text('run_session_id').notNull().unique(),
  workerId: text('worker_id').notNull(),
  leaseToken: text('lease_token').notNull(),
  heartbeatAt: timestampColumn('heartbeat_at').notNull(),
  expiresAt: timestampColumn('expires_at').notNull(),
  status: text('status').notNull(),
});
