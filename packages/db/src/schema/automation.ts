import { sql } from 'drizzle-orm';
import { boolean, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import type {
  AutomationActionRun,
  AutomationProjectSettings,
  CommandIdempotencyRecord,
  ExecutionPackageGenerationRun,
  ManualPathHold,
} from '@forgeloop/domain';

import { timestampColumn } from './_shared';

export const automation_project_settings = pgTable(
  'automation_project_settings',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    repoId: text('repo_id'),
    preset: text('preset').$type<AutomationProjectSettings['preset']>().notNull(),
    capabilitiesJson: jsonb('capabilities_json').$type<AutomationProjectSettings['capabilities_json']>().notNull(),
    capabilityFingerprint: text('capability_fingerprint').notNull(),
    scopeType: text('scope_type').$type<AutomationProjectSettings['scope_type']>().notNull(),
    version: integer('version').notNull(),
    enabledBy: text('enabled_by'),
    enabledAt: timestampColumn('enabled_at'),
    updatedBy: text('updated_by'),
    updatedAt: timestampColumn('updated_at'),
    reason: text('reason'),
    evidenceRefs: jsonb('evidence_refs').$type<AutomationProjectSettings['evidence_refs']>().notNull(),
  },
  (table) => [
    uniqueIndex('automation_project_settings_project_scope')
      .on(table.projectId)
      .where(sql`${table.repoId} is null`),
    uniqueIndex('automation_project_settings_repo_scope')
      .on(table.projectId, table.repoId)
      .where(sql`${table.repoId} is not null`),
  ],
);

export const manual_path_holds = pgTable(
  'manual_path_holds',
  {
    id: text('id').primaryKey(),
    objectType: text('object_type').notNull(),
    objectId: text('object_id').notNull(),
    scopeKey: text('scope_key').notNull(),
    status: text('status').$type<ManualPathHold['status']>().notNull(),
    reasonCode: text('reason_code').notNull(),
    reason: text('reason').notNull(),
    sourceAutomationActionId: text('source_automation_action_id'),
    evidenceRefs: jsonb('evidence_refs').$type<ManualPathHold['evidence_refs']>().notNull(),
    requestedBy: text('requested_by').notNull(),
    requestedAt: timestampColumn('requested_at').notNull(),
    resolvedBy: text('resolved_by'),
    resolvedAt: timestampColumn('resolved_at'),
    resolution: text('resolution'),
    metadataJson: jsonb('metadata_json').$type<ManualPathHold['metadata_json']>(),
  },
  (table) => [
    uniqueIndex('manual_path_holds_active_scope')
      .on(table.objectType, table.objectId, table.scopeKey)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex('manual_path_holds_source_action')
      .on(table.sourceAutomationActionId)
      .where(sql`${table.sourceAutomationActionId} is not null`),
  ],
);

export const manual_path_hold_idempotency_records = pgTable('manual_path_hold_idempotency_records', {
  idempotencyKey: text('idempotency_key').primaryKey(),
  holdId: text('hold_id').notNull(),
});

export const command_idempotency_records = pgTable('command_idempotency_records', {
  id: text('id').primaryKey(),
  commandName: text('command_name').notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  targetObjectType: text('target_object_type').notNull(),
  targetObjectId: text('target_object_id').notNull(),
  targetRevisionId: text('target_revision_id'),
  targetVersion: integer('target_version'),
  preconditionJson: jsonb('precondition_json').$type<CommandIdempotencyRecord['precondition_json']>(),
  preconditionFingerprint: text('precondition_fingerprint'),
  actorScope: text('actor_scope'),
  resultJson: jsonb('result_json').$type<CommandIdempotencyRecord['result_json']>(),
  status: text('status').$type<CommandIdempotencyRecord['status']>().notNull(),
  lockedUntil: timestampColumn('locked_until'),
  lastHeartbeatAt: timestampColumn('last_heartbeat_at'),
  claimToken: text('claim_token'),
  createdBy: text('created_by'),
  startedAt: timestampColumn('started_at'),
  finishedAt: timestampColumn('finished_at'),
  createdAt: timestampColumn('created_at'),
  updatedAt: timestampColumn('updated_at'),
});

export const execution_package_generation_runs = pgTable(
  'execution_package_generation_runs',
  {
    executionPackageSetId: text('execution_package_set_id').primaryKey(),
    planRevisionId: text('plan_revision_id').notNull(),
    generationKey: text('generation_key').notNull(),
    version: integer('version').notNull(),
    generatorVersion: text('generator_version'),
    policyDigest: text('policy_digest'),
    manifestDigest: text('manifest_digest'),
    expectedPackageCount: integer('expected_package_count'),
    expectedPackageKeys: jsonb('expected_package_keys').$type<ExecutionPackageGenerationRun['expected_package_keys']>(),
    status: text('status').$type<ExecutionPackageGenerationRun['status']>().notNull(),
    resultJson: jsonb('result_json').$type<ExecutionPackageGenerationRun['result_json']>(),
    lockedUntil: timestampColumn('locked_until'),
    lastHeartbeatAt: timestampColumn('last_heartbeat_at'),
    claimToken: text('claim_token'),
    supersededBy: text('superseded_by'),
    supersededAt: timestampColumn('superseded_at'),
    supersededReason: text('superseded_reason'),
    supersedeCommandId: text('supersede_command_id'),
    evidenceRefs: jsonb('evidence_refs').$type<ExecutionPackageGenerationRun['evidence_refs']>(),
    nextGenerationKey: text('next_generation_key'),
    completedAt: timestampColumn('completed_at'),
    createdAt: timestampColumn('created_at'),
    updatedAt: timestampColumn('updated_at'),
  },
  (table) => [
    uniqueIndex('execution_package_generation_runs_key').on(table.planRevisionId, table.generationKey),
    uniqueIndex('execution_package_generation_runs_current_succeeded')
      .on(table.planRevisionId)
      .where(sql`${table.status} = 'succeeded'`),
  ],
);

export const execution_package_generation_packages = pgTable(
  'execution_package_generation_packages',
  {
    executionPackageSetId: text('execution_package_set_id').notNull(),
    executionPackageId: text('execution_package_id').notNull(),
    planRevisionId: text('plan_revision_id').notNull(),
    generationKey: text('generation_key').notNull(),
    packageKey: text('package_key').notNull(),
    sequence: integer('sequence').notNull(),
    manifestDigest: text('manifest_digest').notNull(),
  },
  (table) => [
    uniqueIndex('execution_package_generation_package_id').on(table.executionPackageSetId, table.executionPackageId),
    uniqueIndex('execution_package_generation_package_key').on(
      table.planRevisionId,
      table.generationKey,
      table.packageKey,
    ),
  ],
);

export const automation_action_runs = pgTable(
  'automation_action_runs',
  {
    id: text('id').primaryKey(),
    actionType: text('action_type').notNull(),
    targetObjectType: text('target_object_type').notNull(),
    targetObjectId: text('target_object_id').notNull(),
    targetRevisionId: text('target_revision_id'),
    targetVersion: integer('target_version'),
    targetStatus: text('target_status').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    automationScope: text('automation_scope').notNull(),
    automationSettingsVersion: integer('automation_settings_version').notNull(),
    capabilityFingerprint: text('capability_fingerprint').notNull(),
    preconditionFingerprint: text('precondition_fingerprint').notNull(),
    actionInputJson: jsonb('action_input_json').$type<AutomationActionRun['action_input_json']>().notNull(),
    status: text('status').$type<AutomationActionRun['status']>().notNull(),
    claimToken: text('claim_token'),
    attempt: integer('attempt').notNull(),
    lockedUntil: timestampColumn('locked_until'),
    lastHeartbeatAt: timestampColumn('last_heartbeat_at'),
    nextAttemptAt: timestampColumn('next_attempt_at'),
    retryable: boolean('retryable'),
    resultJson: jsonb('result_json').$type<AutomationActionRun['result_json']>(),
    metadataJson: jsonb('metadata_json').$type<AutomationActionRun['metadata_json']>(),
    reason: text('reason'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    policyDigest: text('policy_digest'),
    createdBy: text('created_by'),
    claimedAt: timestampColumn('claimed_at'),
    startedAt: timestampColumn('started_at'),
    finishedAt: timestampColumn('finished_at'),
    createdAt: timestampColumn('created_at'),
    updatedAt: timestampColumn('updated_at'),
  },
);
