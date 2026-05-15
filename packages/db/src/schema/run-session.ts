import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { RunSession } from '@forgeloop/domain';

import { runSessionStatus, timestampColumn } from './_shared';
import { actors } from './actor';

export const run_sessions = pgTable(
  'run_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    executionPackageId: uuid('execution_package_id').notNull(),
    requestedByActorId: uuid('requested_by_actor_id')
      .notNull()
      .references(() => actors.id),
    status: runSessionStatus('status').notNull(),
    executorType: text('executor_type'),
    executorResult: jsonb('executor_result').$type<RunSession['executor_result']>(),
    runSpec: jsonb('run_spec').$type<RunSession['run_spec']>(),
    runtimeMetadata: jsonb('runtime_metadata').$type<RunSession['runtime_metadata']>(),
    changedFiles: jsonb('changed_files').$type<RunSession['changed_files']>().notNull(),
    checkResults: jsonb('check_results').$type<RunSession['check_results']>().notNull(),
    artifacts: jsonb('artifacts').$type<RunSession['artifacts']>().notNull(),
    logRefs: jsonb('log_refs').$type<RunSession['log_refs']>().notNull(),
    summary: text('summary'),
    failureKind: text('failure_kind'),
    failureReason: text('failure_reason'),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
    startedAt: timestampColumn('started_at'),
    finishedAt: timestampColumn('finished_at'),
  },
  (table) => [
    uniqueIndex('run_sessions_one_active_per_package')
      .on(table.executionPackageId)
      .where(sql`${table.status} in ('queued','running','waiting_for_input','stalled','resuming','cancel_requested')`),
  ],
);
