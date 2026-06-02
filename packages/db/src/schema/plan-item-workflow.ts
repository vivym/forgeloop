import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type {
  CodexSession,
  CodexSessionLease,
  CodexSessionSnapshot,
  CodexSessionStaleTerminalizationAttempt,
  CodexSessionTurn,
  ExecutionReadinessRecord,
  PlanItemWorkflow,
  PlanItemWorkflowTransition,
  WorkflowManualDecision,
} from '@forgeloop/domain';

import { timestampColumn } from './_shared';
import { actors } from './actor';
import { development_plan_items, development_plans } from './development-plan';

export const plan_item_workflows = pgTable(
  'plan_item_workflows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    developmentPlanId: uuid('development_plan_id')
      .notNull()
      .references(() => development_plans.id),
    developmentPlanItemId: uuid('development_plan_item_id')
      .notNull()
      .references(() => development_plan_items.id),
    status: text('status').$type<PlanItemWorkflow['status']>().notNull(),
    previousStatus: text('previous_status').$type<PlanItemWorkflow['previous_status']>(),
    activeCodexSessionId: uuid('active_codex_session_id'),
    activeBoundarySummaryRevisionId: uuid('active_boundary_summary_revision_id'),
    activeSpecDocRevisionId: uuid('active_spec_doc_revision_id'),
    activeImplementationPlanDocRevisionId: uuid('active_implementation_plan_doc_revision_id'),
    executionPackageId: uuid('execution_package_id'),
    createdByActorId: uuid('created_by_actor_id')
      .notNull()
      .references(() => actors.id),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [
    index('plan_item_workflows_item_idx').on(table.developmentPlanId, table.developmentPlanItemId),
    index('plan_item_workflows_active_session_idx').on(table.activeCodexSessionId),
    uniqueIndex('plan_item_workflows_one_active_per_item_idx')
      .on(table.developmentPlanItemId)
      .where(sql`${table.status} <> 'archived'`),
  ],
);

export const codex_sessions = pgTable(
  'codex_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerType: text('owner_type').$type<CodexSession['owner_type']>().notNull(),
    ownerId: uuid('owner_id').notNull(),
    status: text('status').$type<CodexSession['status']>().notNull(),
    role: text('role').$type<CodexSession['role']>().notNull(),
    codexThreadId: text('codex_thread_id'),
    codexThreadIdDigest: text('codex_thread_id_digest'),
    latestSnapshotId: uuid('latest_snapshot_id'),
    latestSnapshotDigest: text('latest_snapshot_digest'),
    latestTurnId: uuid('latest_turn_id'),
    latestTurnDigest: text('latest_turn_digest'),
    runtimeProfileId: uuid('runtime_profile_id').notNull(),
    runtimeProfileRevisionId: uuid('runtime_profile_revision_id').notNull(),
    credentialBindingId: uuid('credential_binding_id').notNull(),
    credentialBindingVersionId: uuid('credential_binding_version_id').notNull(),
    activeLeaseId: uuid('active_lease_id'),
    leaseEpoch: integer('lease_epoch').notNull().default(0),
    runnerWorkerId: uuid('runner_worker_id'),
    runnerLaunchLeaseId: uuid('runner_launch_lease_id'),
    runnerRuntimeJobId: uuid('runner_runtime_job_id'),
    runnerExpiresAt: timestampColumn('runner_expires_at'),
    forkedFromSessionId: uuid('forked_from_session_id'),
    forkedFromTurnId: uuid('forked_from_turn_id'),
    forkedFromSnapshotId: uuid('forked_from_snapshot_id'),
    forkReason: text('fork_reason'),
    createdByActorId: uuid('created_by_actor_id')
      .notNull()
      .references(() => actors.id),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
    archivedAt: timestampColumn('archived_at'),
  },
  (table) => [
    index('codex_sessions_owner_idx').on(table.ownerType, table.ownerId),
    index('codex_sessions_owner_role_idx').on(table.ownerId, table.role),
    index('codex_sessions_thread_digest_idx').on(table.codexThreadIdDigest),
    index('codex_sessions_latest_snapshot_idx').on(table.latestSnapshotId),
    index('codex_sessions_active_lease_idx').on(table.activeLeaseId),
    index('codex_sessions_runner_worker_idx').on(table.runnerWorkerId),
    index('codex_sessions_runner_launch_lease_idx').on(table.runnerLaunchLeaseId),
    uniqueIndex('codex_sessions_one_active_per_workflow_idx')
      .on(table.ownerId)
      .where(sql`${table.role} = 'active' and ${table.status} <> 'archived'`),
  ],
);

export const plan_item_workflow_transitions = pgTable(
  'plan_item_workflow_transitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => plan_item_workflows.id),
    fromStatus: text('from_status').$type<PlanItemWorkflowTransition['from_status']>().notNull(),
    toStatus: text('to_status').$type<PlanItemWorkflowTransition['to_status']>().notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id),
    reason: text('reason'),
    evidenceObjectType: text('evidence_object_type').$type<PlanItemWorkflowTransition['evidence_object_type']>().notNull(),
    evidenceObjectId: text('evidence_object_id').notNull(),
    evidenceDigest: text('evidence_digest'),
    supportingEvidence: jsonb('supporting_evidence')
      .$type<NonNullable<PlanItemWorkflowTransition['supporting_evidence']>>()
      .notNull()
      .default([]),
    codexSessionId: uuid('codex_session_id')
      .notNull()
      .references(() => codex_sessions.id),
    codexSessionTurnId: uuid('codex_session_turn_id'),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    index('plan_item_workflow_transitions_workflow_created_idx').on(table.workflowId, table.createdAt),
    index('plan_item_workflow_transitions_evidence_idx').on(table.evidenceObjectType, table.evidenceObjectId),
    index('plan_item_workflow_transitions_session_idx').on(table.codexSessionId),
  ],
);

export const workflow_manual_decisions = pgTable(
  'workflow_manual_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => plan_item_workflows.id),
    codexSessionId: uuid('codex_session_id')
      .notNull()
      .references(() => codex_sessions.id),
    kind: text('kind').$type<WorkflowManualDecision['kind']>().notNull(),
    reason: text('reason').notNull(),
    selectedCodexSessionId: uuid('selected_codex_session_id').references(() => codex_sessions.id),
    relatedObjectType: text('related_object_type').$type<WorkflowManualDecision['related_object_type']>(),
    relatedObjectId: text('related_object_id'),
    createdByActorId: uuid('created_by_actor_id')
      .notNull()
      .references(() => actors.id),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    index('workflow_manual_decisions_workflow_created_idx').on(table.workflowId, table.createdAt),
    index('workflow_manual_decisions_session_idx').on(table.codexSessionId),
    index('workflow_manual_decisions_kind_created_idx').on(table.kind, table.createdAt),
  ],
);

export const execution_readiness_records = pgTable(
  'execution_readiness_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => plan_item_workflows.id),
    developmentPlanId: uuid('development_plan_id')
      .notNull()
      .references(() => development_plans.id),
    developmentPlanItemId: uuid('development_plan_item_id')
      .notNull()
      .references(() => development_plan_items.id),
    codexSessionId: uuid('codex_session_id')
      .notNull()
      .references(() => codex_sessions.id),
    codexSessionTurnId: uuid('codex_session_turn_id').references(() => codex_session_turns.id),
    approvedBoundarySummaryRevisionId: uuid('approved_boundary_summary_revision_id').notNull(),
    approvedSpecRevisionId: uuid('approved_spec_revision_id').notNull(),
    approvedImplementationPlanRevisionId: uuid('approved_implementation_plan_revision_id').notNull(),
    readinessState: text('readiness_state').$type<ExecutionReadinessRecord['readiness_state']>().notNull(),
    blockerCodes: jsonb('blocker_codes').$type<ExecutionReadinessRecord['blocker_codes']>().notNull(),
    supportingEvidence: jsonb('supporting_evidence').$type<ExecutionReadinessRecord['supporting_evidence']>().notNull(),
    createdByActorId: uuid('created_by_actor_id')
      .notNull()
      .references(() => actors.id),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    index('execution_readiness_records_workflow_idx').on(table.workflowId),
    index('execution_readiness_records_item_idx').on(table.developmentPlanItemId),
    index('execution_readiness_records_session_idx').on(table.codexSessionId),
    index('execution_readiness_records_plan_revision_idx').on(table.approvedImplementationPlanRevisionId),
  ],
);

export const codex_session_turns = pgTable(
  'codex_session_turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codexSessionId: uuid('codex_session_id')
      .notNull()
      .references(() => codex_sessions.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => plan_item_workflows.id),
    intent: text('intent').$type<CodexSessionTurn['intent']>().notNull(),
    status: text('status').$type<CodexSessionTurn['status']>().notNull(),
    inputDigest: text('input_digest').notNull(),
    expectedPreviousSnapshotDigest: text('expected_previous_snapshot_digest'),
    outputSnapshotId: uuid('output_snapshot_id'),
    outputSnapshotDigest: text('output_snapshot_digest'),
    outputObjectType: text('output_object_type').$type<CodexSessionTurn['output_object_type']>(),
    outputObjectId: text('output_object_id'),
    codexThreadIdDigest: text('codex_thread_id_digest'),
    leaseId: uuid('lease_id'),
    leaseEpoch: integer('lease_epoch'),
    automationActionRunId: uuid('automation_action_run_id'),
    runtimeJobId: uuid('runtime_job_id'),
    createdByActorId: uuid('created_by_actor_id')
      .notNull()
      .references(() => actors.id),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [
    index('codex_session_turns_session_created_idx').on(table.codexSessionId, table.createdAt),
    index('codex_session_turns_workflow_created_idx').on(table.workflowId, table.createdAt),
    index('codex_session_turns_runtime_job_idx').on(table.runtimeJobId),
    index('codex_session_turns_action_run_idx').on(table.automationActionRunId),
  ],
);

export const codex_session_stale_terminalization_attempts = pgTable(
  'codex_session_stale_terminalization_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codexSessionId: uuid('codex_session_id')
      .notNull()
      .references(() => codex_sessions.id),
    codexSessionTurnId: uuid('codex_session_turn_id').references(() => codex_session_turns.id),
    leaseId: uuid('lease_id'),
    leaseEpoch: integer('lease_epoch'),
    workerId: text('worker_id').notNull(),
    workerSessionDigest: text('worker_session_digest').notNull(),
    expectedPreviousSnapshotDigest: text('expected_previous_snapshot_digest'),
    attemptedOutputSnapshotDigest: text('attempted_output_snapshot_digest'),
    attemptedCodexThreadIdDigest: text('attempted_codex_thread_id_digest'),
    failureCode: text('failure_code').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    index('codex_session_stale_terminalization_attempts_session_idx').on(table.codexSessionId, table.createdAt),
    index('codex_session_stale_terminalization_attempts_turn_idx').on(table.codexSessionTurnId),
  ],
);

export const codex_session_snapshots = pgTable(
  'codex_session_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codexSessionId: uuid('codex_session_id')
      .notNull()
      .references(() => codex_sessions.id),
    sequence: integer('sequence').notNull(),
    artifactRef: text('artifact_ref').notNull(),
    digest: text('digest').notNull(),
    sizeBytes: text('size_bytes').notNull(),
    manifestDigest: text('manifest_digest').notNull(),
    codexThreadIdDigest: text('codex_thread_id_digest'),
    runtimeProfileRevisionId: uuid('runtime_profile_revision_id').notNull(),
    createdFromTurnId: uuid('created_from_turn_id'),
    createdByActorId: uuid('created_by_actor_id')
      .notNull()
      .references(() => actors.id),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('codex_session_snapshots_session_sequence_unique').on(table.codexSessionId, table.sequence),
    uniqueIndex('codex_session_snapshots_artifact_ref_unique').on(table.artifactRef),
    index('codex_session_snapshots_session_created_idx').on(table.codexSessionId, table.createdAt),
  ],
);

export const codex_session_leases = pgTable(
  'codex_session_leases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codexSessionId: uuid('codex_session_id')
      .notNull()
      .references(() => codex_sessions.id),
    leaseTokenHash: text('lease_token_hash').notNull(),
    leaseEpoch: integer('lease_epoch').notNull(),
    workerId: text('worker_id').notNull(),
    workerSessionDigest: text('worker_session_digest').notNull(),
    status: text('status').$type<CodexSessionLease['status']>().notNull(),
    acquiredAt: timestampColumn('acquired_at').notNull(),
    heartbeatAt: timestampColumn('heartbeat_at'),
    expiresAt: timestampColumn('expires_at').notNull(),
    releasedAt: timestampColumn('released_at'),
    fencedAt: timestampColumn('fenced_at'),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('codex_session_leases_one_active_per_session_idx')
      .on(table.codexSessionId)
      .where(sql`${table.status} = 'active'`),
    index('codex_session_leases_session_epoch_idx').on(table.codexSessionId, table.leaseEpoch),
    index('codex_session_leases_worker_status_idx').on(table.workerId, table.status),
    index('codex_session_leases_expires_at_idx').on(table.expiresAt),
  ],
);
