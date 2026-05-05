import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import type { RunSession } from '@forgeloop/domain';

import { runSessionStatus, timestampColumn } from './_shared';

export const run_sessions = pgTable('run_sessions', {
  id: text('id').primaryKey(),
  executionPackageId: text('execution_package_id').notNull(),
  requestedByActorId: text('requested_by_actor_id').notNull(),
  status: runSessionStatus('status').notNull(),
  executorType: text('executor_type'),
  executorResult: jsonb('executor_result').$type<RunSession['executor_result']>(),
  runSpec: jsonb('run_spec').$type<RunSession['run_spec']>(),
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
});
