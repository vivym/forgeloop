import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type {
  CodexSession,
  CodexSessionLease,
  CodexRuntimeCapsule,
  CodexSessionStaleTerminalizationAttempt,
  CodexSessionTurn,
  ExecutionReadinessRecord,
  PlanItemSessionHealth,
  PlanItemWorkflow,
  PlanItemWorkflowMessage,
  PlanItemWorkflowQueuedAction,
  PlanItemWorkflowTransition,
  SessionRecoveryRecord,
  WorkflowManualDecision,
} from '@forgeloop/domain';
import type { CapsuleRetentionPin } from '@forgeloop/contracts';

import { timestampColumn } from './_shared';
import { actors } from './actor';
import { development_plan_items, development_plans } from './development-plan';
import { projects } from './project';

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
    latestCapsuleId: uuid('latest_capsule_id'),
    latestCapsuleDigest: text('latest_capsule_digest'),
    baseMemoryBundleRef: text('base_memory_bundle_ref'),
    baseMemoryBundleDigest: text('base_memory_bundle_digest'),
    latestMemoryBundleRef: text('latest_memory_bundle_ref'),
    latestMemoryBundleDigest: text('latest_memory_bundle_digest'),
    latestEnvironmentManifestRef: text('latest_environment_manifest_ref'),
    latestEnvironmentManifestDigest: text('latest_environment_manifest_digest'),
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
    forkedFromCapsuleId: uuid('forked_from_capsule_id'),
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
    index('codex_sessions_latest_capsule_idx').on(table.latestCapsuleId),
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

export const plan_item_workflow_messages = pgTable(
  'plan_item_workflow_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => plan_item_workflows.id),
    codexSessionId: uuid('codex_session_id')
      .notNull()
      .references(() => codex_sessions.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id),
    action: text('action').$type<PlanItemWorkflowMessage['action']>().notNull(),
    bodyMarkdown: text('body_markdown').notNull(),
    createdQueuedActionId: uuid('created_queued_action_id'),
    clientMessageId: text('client_message_id'),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    index('plan_item_workflow_messages_workflow_created_idx').on(table.workflowId, table.createdAt),
    index('plan_item_workflow_messages_session_idx').on(table.codexSessionId),
  ],
);

export const plan_item_workflow_queued_actions = pgTable(
  'plan_item_workflow_queued_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => plan_item_workflows.id),
    codexSessionId: uuid('codex_session_id')
      .notNull()
      .references(() => codex_sessions.id),
    kind: text('kind').$type<PlanItemWorkflowQueuedAction['kind']>().notNull(),
    status: text('status').$type<PlanItemWorkflowQueuedAction['status']>().notNull(),
    sourceRevisionId: uuid('source_revision_id'),
    changeRequestId: uuid('change_request_id'),
    createdFromMessageId: uuid('created_from_message_id').references(() => plan_item_workflow_messages.id),
    expectedInputCapsuleDigest: text('expected_input_capsule_digest'),
    contextPreviewDigest: text('context_preview_digest').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    codexSessionTurnId: uuid('codex_session_turn_id'),
    outputCapsuleId: uuid('output_capsule_id'),
    outputCapsuleDigest: text('output_capsule_digest'),
    outputCapsuleSequence: integer('output_capsule_sequence'),
    codexThreadIdDigest: text('codex_thread_id_digest'),
    blockedReasonCode: text('blocked_reason_code'),
    createdByActorId: uuid('created_by_actor_id')
      .notNull()
      .references(() => actors.id),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [
    index('plan_item_workflow_queued_actions_workflow_status_idx').on(table.workflowId, table.status),
    index('plan_item_workflow_queued_actions_session_idx').on(table.codexSessionId),
    index('plan_item_workflow_queued_actions_turn_idx').on(table.codexSessionTurnId),
    uniqueIndex('plan_item_workflow_queued_actions_active_idempotency_idx')
      .on(table.workflowId, table.idempotencyKey)
      .where(sql`${table.status} in ('queued', 'running')`),
  ],
);

export const plan_item_workflow_artifact_change_requests = pgTable(
  'plan_item_workflow_artifact_change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => plan_item_workflows.id),
    artifactType: text('artifact_type').$type<'boundary-summary' | 'spec-doc' | 'implementation-plan-doc'>().notNull(),
    revisionId: uuid('revision_id').notNull(),
    reasonMarkdown: text('reason_markdown').notNull(),
    createdQueuedActionId: uuid('created_queued_action_id'),
    requestedByActorId: uuid('requested_by_actor_id')
      .notNull()
      .references(() => actors.id),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    index('plan_item_workflow_artifact_change_requests_workflow_created_idx').on(table.workflowId, table.createdAt),
    index('plan_item_workflow_artifact_change_requests_revision_idx').on(table.artifactType, table.revisionId),
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
    invalidatedAt: timestampColumn('invalidated_at'),
    invalidatedReason: text('invalidated_reason'),
  },
  (table) => [
    index('execution_readiness_records_workflow_idx').on(table.workflowId),
    index('execution_readiness_records_item_idx').on(table.developmentPlanItemId),
    index('execution_readiness_records_session_idx').on(table.codexSessionId),
    index('execution_readiness_records_plan_revision_idx').on(table.approvedImplementationPlanRevisionId),
  ],
);

export const plan_item_session_health = pgTable(
  'plan_item_session_health',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    organizationId: uuid('organization_id'),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => plan_item_workflows.id),
    developmentPlanId: uuid('development_plan_id').references(() => development_plans.id),
    developmentPlanItemId: uuid('development_plan_item_id')
      .notNull()
      .references(() => development_plan_items.id),
    codexSessionId: uuid('codex_session_id')
      .notNull()
      .references(() => codex_sessions.id),
    state: text('state').$type<PlanItemSessionHealth['state']>().notNull(),
    severity: text('severity').$type<PlanItemSessionHealth['severity']>().notNull(),
    reasonCode: text('reason_code'),
    summary: text('summary').notNull(),
    projectionDigest: text('projection_digest').notNull(),
    safeProjectionJson: jsonb('safe_projection_json').$type<Omit<PlanItemSessionHealth, 'candidate_predicate'>>().notNull(),
    checkedAt: timestampColumn('checked_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('plan_item_session_health_workflow_session_idx').on(table.workflowId, table.codexSessionId),
    index('plan_item_session_health_project_idx').on(table.projectId, table.state, table.severity),
    index('plan_item_session_health_state_idx').on(table.state, table.severity),
    index('plan_item_session_health_item_idx').on(table.developmentPlanItemId),
    index('plan_item_session_health_session_idx').on(table.codexSessionId),
  ],
);

export const session_recovery_records = pgTable(
  'session_recovery_records',
  {
    id: uuid('id').primaryKey(),
    operationIdempotencyKey: text('operation_idempotency_key').notNull(),
    operation: text('operation').$type<SessionRecoveryRecord['operation']>().notNull(),
    result: text('result').$type<SessionRecoveryRecord['result']>().notNull(),
    resultCode: text('result_code').notNull(),
    reason: text('reason').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => plan_item_workflows.id),
    developmentPlanItemId: uuid('development_plan_item_id')
      .notNull()
      .references(() => development_plan_items.id),
    codexSessionId: uuid('codex_session_id')
      .notNull()
      .references(() => codex_sessions.id),
    beforeState: text('before_state').$type<SessionRecoveryRecord['before_state']>().notNull(),
    afterState: text('after_state').$type<SessionRecoveryRecord['after_state']>().notNull(),
    beforeProjectionDigest: text('before_projection_digest').notNull(),
    afterProjectionDigest: text('after_projection_digest').notNull(),
    predicateSummary: jsonb('predicate_summary').$type<SessionRecoveryRecord['predicate_summary']>().notNull(),
    affectedLeaseIds: jsonb('affected_lease_ids').$type<string[]>().notNull().default([]),
    affectedQueuedActionIds: jsonb('affected_queued_action_ids').$type<string[]>().notNull().default([]),
    affectedTurnIds: jsonb('affected_turn_ids').$type<string[]>().notNull().default([]),
    affectedRuntimeJobIds: jsonb('affected_runtime_job_ids').$type<string[]>().notNull().default([]),
    affectedRunSessionIds: jsonb('affected_run_session_ids').$type<string[]>().notNull().default([]),
    affectedCapsuleIds: jsonb('affected_capsule_ids').$type<string[]>().notNull().default([]),
    objectEventId: uuid('object_event_id'),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('session_recovery_records_operation_idempotency_key_idx').on(table.operationIdempotencyKey),
    index('session_recovery_records_workflow_idx').on(table.workflowId, table.createdAt),
    index('session_recovery_records_item_idx').on(table.developmentPlanItemId, table.createdAt),
    index('session_recovery_records_session_idx').on(table.codexSessionId),
    index('session_recovery_records_created_idx').on(table.createdAt),
    index('session_recovery_records_result_idx').on(table.operation, table.result),
  ],
);

export const capsule_retention_pins = pgTable(
  'capsule_retention_pins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    capsuleId: uuid('capsule_id').notNull(),
    capsuleDigest: text('capsule_digest').notNull(),
    pinState: text('pin_state').$type<CapsuleRetentionPin['pin_state']>().notNull(),
    pinReasons: jsonb('pin_reasons').$type<CapsuleRetentionPin['pin_reasons']>().notNull().default([]),
    referencedObjectType: text('referenced_object_type').notNull(),
    referencedObjectId: text('referenced_object_id').notNull(),
    referenceRelation: text('reference_relation').notNull(),
    referencedBy: jsonb('referenced_by').$type<CapsuleRetentionPin['referenced_by']>().notNull().default([]),
    checkedAt: timestampColumn('checked_at').notNull(),
  },
  (table) => [
    uniqueIndex('capsule_retention_pins_capsule_reference_idx').on(
      table.capsuleId,
      table.referencedObjectType,
      table.referencedObjectId,
      table.referenceRelation,
    ),
    index('capsule_retention_pins_capsule_idx').on(table.capsuleId),
    index('capsule_retention_pins_state_idx').on(table.pinState),
    index('capsule_retention_pins_reference_idx').on(table.referencedObjectType, table.referencedObjectId),
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
    expectedInputCapsuleDigest: text('expected_input_capsule_digest'),
    inputCapsuleId: uuid('input_capsule_id'),
    inputCapsuleDigest: text('input_capsule_digest'),
    outputCapsuleId: uuid('output_capsule_id'),
    outputCapsuleDigest: text('output_capsule_digest'),
    baseMemoryBundleRef: text('base_memory_bundle_ref'),
    baseMemoryBundleDigest: text('base_memory_bundle_digest'),
    inputMemoryBundleRef: text('input_memory_bundle_ref'),
    inputMemoryBundleDigest: text('input_memory_bundle_digest'),
    outputMemoryBundleRef: text('output_memory_bundle_ref'),
    outputMemoryBundleDigest: text('output_memory_bundle_digest'),
    memoryDeltaArtifactRef: text('memory_delta_artifact_ref'),
    memoryDeltaDigest: text('memory_delta_digest'),
    inputEnvironmentManifestRef: text('input_environment_manifest_ref'),
    inputEnvironmentManifestDigest: text('input_environment_manifest_digest'),
    outputEnvironmentManifestRef: text('output_environment_manifest_ref'),
    outputEnvironmentManifestDigest: text('output_environment_manifest_digest'),
    outputObjectType: text('output_object_type').$type<CodexSessionTurn['output_object_type']>(),
    outputObjectId: text('output_object_id'),
    codexThreadIdDigest: text('codex_thread_id_digest'),
    leaseId: uuid('lease_id'),
    leaseEpoch: integer('lease_epoch'),
    automationActionRunId: uuid('automation_action_run_id'),
    planItemWorkflowActionId: uuid('plan_item_workflow_action_id').references(() => plan_item_workflow_queued_actions.id),
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
    index('codex_session_turns_workflow_action_idx').on(table.planItemWorkflowActionId),
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
    expectedInputCapsuleDigest: text('expected_input_capsule_digest'),
    attemptedOutputCapsuleDigest: text('attempted_output_capsule_digest'),
    attemptedCodexThreadIdDigest: text('attempted_codex_thread_id_digest'),
    workflowId: uuid('workflow_id').references(() => plan_item_workflows.id),
    runSessionId: uuid('run_session_id'),
    runtimeJobId: uuid('runtime_job_id'),
    expectedWorkflowStatus: text('expected_workflow_status'),
    actualWorkflowStatus: text('actual_workflow_status'),
    expectedRunSessionStatus: text('expected_run_session_status'),
    actualRunSessionStatus: text('actual_run_session_status'),
    expectedRunSessionUpdatedAt: timestampColumn('expected_run_session_updated_at'),
    actualRunSessionUpdatedAt: timestampColumn('actual_run_session_updated_at'),
    expectedCodexThreadIdDigest: text('expected_codex_thread_id_digest'),
    failureCode: text('failure_code').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    index('codex_session_stale_terminalization_attempts_session_idx').on(table.codexSessionId, table.createdAt),
    index('codex_session_stale_terminalization_attempts_turn_idx').on(table.codexSessionTurnId),
    index('codex_session_stale_terminalization_attempts_workflow_idx').on(table.workflowId, table.createdAt),
    index('codex_session_stale_terminalization_attempts_run_idx').on(table.runSessionId),
  ],
);

export const codex_runtime_capsules = pgTable(
  'codex_runtime_capsules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codexSessionId: uuid('codex_session_id')
      .notNull()
      .references(() => codex_sessions.id),
    createdFromTurnId: uuid('created_from_turn_id')
      .notNull()
      .references(() => codex_session_turns.id),
    sequence: integer('sequence').notNull(),
    artifactRef: text('artifact_ref').notNull(),
    digest: text('digest').notNull(),
    sizeBytes: text('size_bytes').notNull(),
    manifestDigest: text('manifest_digest').notNull(),
    threadStateDigest: text('thread_state_digest').notNull(),
    memoryStateDigest: text('memory_state_digest').notNull(),
    environmentManifestDigest: text('environment_manifest_digest').notNull(),
    codexThreadIdDigest: text('codex_thread_id_digest').notNull(),
    codexCliVersion: text('codex_cli_version').notNull(),
    appServerProtocolDigest: text('app_server_protocol_digest').notNull(),
    runtimeProfileRevisionId: uuid('runtime_profile_revision_id').notNull(),
    trustedRuntimeManifestDigest: text('trusted_runtime_manifest_digest').notNull(),
    credentialBindingLineageDigest: text('credential_binding_lineage_digest').notNull(),
    createdByActorId: uuid('created_by_actor_id')
      .notNull()
      .references(() => actors.id),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('codex_runtime_capsules_session_sequence_unique').on(table.codexSessionId, table.sequence),
    uniqueIndex('codex_runtime_capsules_artifact_ref_unique').on(table.artifactRef),
    index('codex_runtime_capsules_session_created_idx').on(table.codexSessionId, table.createdAt),
    index('codex_runtime_capsules_turn_idx').on(table.createdFromTurnId),
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
