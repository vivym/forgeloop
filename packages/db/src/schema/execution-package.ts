import { jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import type { ExecutionPackage } from '@forgeloop/domain';

import {
  executionPackageActivityState,
  executionPackageGateState,
  executionPackagePhase,
  executionPackageResolution,
  timestampColumn,
} from './_shared';

export const execution_packages = pgTable('execution_packages', {
  id: text('id').primaryKey(),
  workItemId: text('work_item_id').notNull(),
  specId: text('spec_id').notNull(),
  specRevisionId: text('spec_revision_id').notNull(),
  planId: text('plan_id').notNull(),
  planRevisionId: text('plan_revision_id').notNull(),
  projectId: text('project_id').notNull(),
  repoId: text('repo_id').notNull(),
  objective: text('objective').notNull(),
  ownerActorId: text('owner_actor_id').notNull(),
  reviewerActorId: text('reviewer_actor_id').notNull(),
  qaOwnerActorId: text('qa_owner_actor_id').notNull(),
  phase: executionPackagePhase('phase').notNull(),
  activityState: executionPackageActivityState('activity_state').notNull(),
  gateState: executionPackageGateState('gate_state').notNull(),
  resolution: executionPackageResolution('resolution').notNull(),
  requiredChecks: jsonb('required_checks').$type<ExecutionPackage['required_checks']>().notNull(),
  requiredArtifactKinds: jsonb('required_artifact_kinds').$type<ExecutionPackage['required_artifact_kinds']>().notNull(),
  allowedPaths: jsonb('allowed_paths').$type<ExecutionPackage['allowed_paths']>().notNull(),
  forbiddenPaths: jsonb('forbidden_paths').$type<ExecutionPackage['forbidden_paths']>().notNull(),
  lastRunSessionId: text('last_run_session_id'),
  lastFailureSummary: text('last_failure_summary'),
  blockedReason: text('blocked_reason'),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});

export const execution_package_dependencies = pgTable(
  'execution_package_dependencies',
  {
    packageId: text('package_id').notNull(),
    dependsOnPackageId: text('depends_on_package_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.packageId, table.dependsOnPackageId] })],
);
