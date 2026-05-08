import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import type { RunCommand } from '@forgeloop/domain';

import { timestampColumn } from './_shared';

export const run_commands = pgTable('run_commands', {
  id: text('id').primaryKey(),
  runSessionId: text('run_session_id').notNull(),
  commandType: text('command_type').notNull(),
  status: text('status').notNull(),
  actorId: text('actor_id').notNull(),
  payload: jsonb('payload').$type<RunCommand['payload']>().notNull(),
  targetThreadId: text('target_thread_id'),
  targetTurnId: text('target_turn_id'),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
  claimedByWorkerId: text('claimed_by_worker_id'),
  claimedAt: timestampColumn('claimed_at'),
  appliedAt: timestampColumn('applied_at'),
  failureReason: text('failure_reason'),
  driverAck: jsonb('driver_ack').$type<RunCommand['driver_ack']>(),
});
