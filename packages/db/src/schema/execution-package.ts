import { jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import type { ExecutionPackage } from '@forgeloop/domain';

import {
  executionPackageActivityState,
  executionPackageGateState,
  executionPackagePhase,
  executionPackageResolution,
  timestampColumn,
} from './_shared';
import { actors } from './actor';

export type RequiredTestGateSpec = Record<string, unknown>;

export const execution_packages = pgTable('execution_packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  workItemId: uuid('work_item_id').notNull(),
  specId: uuid('spec_id').notNull(),
  specRevisionId: uuid('spec_revision_id').notNull(),
  planId: uuid('plan_id').notNull(),
  planRevisionId: uuid('plan_revision_id').notNull(),
  projectId: uuid('project_id').notNull(),
  repoId: text('repo_id').notNull(),
  objective: text('objective').notNull(),
  ownerActorId: uuid('owner_actor_id')
    .notNull()
    .references(() => actors.id),
  reviewerActorId: uuid('reviewer_actor_id')
    .notNull()
    .references(() => actors.id),
  qaOwnerActorId: uuid('qa_owner_actor_id')
    .notNull()
    .references(() => actors.id),
  phase: executionPackagePhase('phase').notNull(),
  activityState: executionPackageActivityState('activity_state').notNull(),
  gateState: executionPackageGateState('gate_state').notNull(),
  resolution: executionPackageResolution('resolution').notNull(),
  requiredChecks: jsonb('required_checks').$type<ExecutionPackage['required_checks']>().notNull(),
  requiredTestGates: jsonb('required_test_gates').$type<RequiredTestGateSpec[]>().notNull(),
  requiredArtifactKinds: jsonb('required_artifact_kinds').$type<ExecutionPackage['required_artifact_kinds']>().notNull(),
  allowedPaths: jsonb('allowed_paths').$type<ExecutionPackage['allowed_paths']>().notNull(),
  forbiddenPaths: jsonb('forbidden_paths').$type<ExecutionPackage['forbidden_paths']>().notNull(),
  integrationReadiness: jsonb('integration_readiness').$type<ExecutionPackage['integration_readiness']>(),
  currentRunSessionId: uuid('current_run_session_id'),
  lastRunSessionId: uuid('last_run_session_id'),
  currentReviewPacketId: uuid('current_review_packet_id'),
  currentReleaseId: uuid('current_release_id'),
  lastFailureSummary: text('last_failure_summary'),
  blockedReason: text('blocked_reason'),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});

export const execution_package_dependencies = pgTable(
  'execution_package_dependencies',
  {
    packageId: uuid('package_id').notNull(),
    dependsOnPackageId: uuid('depends_on_package_id').notNull(),
    dependencyType: text('dependency_type'),
    reason: text('reason'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestampColumn('created_at'),
    updatedAt: timestampColumn('updated_at'),
  },
  (table) => [primaryKey({ columns: [table.packageId, table.dependsOnPackageId] })],
);
