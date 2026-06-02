import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  actors,
  attachments,
  decisions,
  execution_package_dependencies,
  execution_package_activity_state_values,
  execution_package_gate_state_values,
  execution_package_phase_values,
  execution_packages,
  decision_outcome_values,
  execution_package_resolution_values,
  organizations,
  object_events,
  project_repo_status_values,
  project_repos,
  projects,
  qa_handoffs,
  release_evidences,
  release_execution_packages,
  release_work_items,
  releases,
  review_packet_decision_values,
  review_packet_status_values,
  review_packets,
  run_commands,
  run_event_counters,
  run_events,
  run_session_status_values,
  run_sessions,
  run_worker_leases,
  spec_plan_editing_state_values,
  spec_plan_gate_state_values,
  spec_plan_resolution_values,
  spec_plan_status_values,
  spec_revisions,
  specs,
  status_histories,
  plan_revisions,
  plans,
  artifacts,
  automation_action_runs,
  automation_project_settings,
  codex_credential_bindings,
  codex_credential_binding_versions,
  codex_launch_leases,
  codex_launch_token_envelopes,
  internal_artifact_objects,
  codex_pending_workspace_bundles,
  codex_runtime_job_artifacts,
  codex_runtime_jobs,
  codex_runtime_setup_nonces,
  codex_runtime_profiles,
  codex_runtime_profile_revisions,
  codex_worker_bootstrap_tokens,
  codex_worker_registrations,
  codex_worker_session_nonces,
  codex_sessions,
  codex_session_leases,
  codex_runtime_capsules,
  codex_session_stale_terminalization_attempts,
  codex_session_turns,
  command_idempotency_records,
  execution_readiness_records,
  boundary_answers,
  boundary_decisions,
  boundary_questions,
  boundary_rounds,
  boundary_summaries,
  boundary_summary_revisions,
  brainstorming_sessions,
  code_review_handoffs,
  context_manifests,
  development_plan_revisions,
  development_plan_item_revisions,
  development_plan_items,
  development_plan_source_links,
  development_plans,
  plan_item_workflows,
  plan_item_workflow_transitions,
  workflow_manual_decisions,
  executions,
  execution_plan_revisions,
  execution_plans,
  execution_package_generation_packages,
  execution_package_generation_runs,
  manual_path_hold_idempotency_records,
  manual_path_holds,
  trace_artifact_refs,
  trace_events,
  trace_link_relationship_values,
  trace_links,
  tasks,
  work_item_activity_state_values,
  work_item_gate_state_values,
  work_item_kind_values,
  work_item_phase_values,
  work_item_resolution_values,
  work_items,
} from '../../packages/db/src/index';
import * as dbSchema from '../../packages/db/src/index';

type TableLike = Parameters<typeof getTableColumns>[0];
type ColumnLike = { name: string; columnType: string; notNull?: boolean; isUnique?: boolean; primary?: boolean; table: unknown };
type ConfiguredTable = Parameters<typeof getTableConfig>[0];

const requiredTables = {
  codex_runtime_profiles,
  codex_runtime_profile_revisions,
  codex_credential_bindings,
  codex_credential_binding_versions,
  codex_worker_bootstrap_tokens,
  codex_worker_registrations,
  codex_worker_session_nonces,
  codex_runtime_jobs,
  codex_launch_token_envelopes,
  internal_artifact_objects,
  codex_runtime_job_artifacts,
  codex_pending_workspace_bundles,
  codex_launch_leases,
  codex_runtime_setup_nonces,
  codex_sessions,
  codex_session_leases,
  codex_runtime_capsules,
  codex_session_stale_terminalization_attempts,
  codex_session_turns,
  automation_project_settings,
  manual_path_holds,
  manual_path_hold_idempotency_records,
  command_idempotency_records,
  execution_readiness_records,
  boundary_answers,
  boundary_decisions,
  boundary_questions,
  boundary_rounds,
  context_manifests,
  development_plans,
  development_plan_revisions,
  development_plan_source_links,
  development_plan_items,
  development_plan_item_revisions,
  plan_item_workflows,
  plan_item_workflow_transitions,
  workflow_manual_decisions,
  brainstorming_sessions,
  boundary_summaries,
  boundary_summary_revisions,
  execution_plans,
  execution_plan_revisions,
  executions,
  code_review_handoffs,
  qa_handoffs,
  execution_package_generation_runs,
  execution_package_generation_packages,
  automation_action_runs,
  organizations,
  actors,
  projects,
  project_repos,
  work_items,
  tasks,
  attachments,
  specs,
  spec_revisions,
  plans,
  plan_revisions,
  execution_packages,
  execution_package_dependencies,
  run_sessions,
  run_events,
  run_event_counters,
  run_commands,
  run_worker_leases,
  review_packets,
  object_events,
  status_histories,
  artifacts,
  decisions,
  releases,
  release_work_items,
  release_execution_packages,
  release_evidences,
  trace_events,
  trace_links,
  trace_artifact_refs,
};

const column = (table: TableLike, columnName: string) => {
  const columns = getTableColumns(table);
  const matchedColumn =
    columns[columnName] ??
    Object.values(columns).find((candidate) => (candidate as { name: string }).name === columnName);
  if (matchedColumn === undefined) {
    throw new Error(`Missing column ${columnName}`);
  }

  return matchedColumn as ColumnLike;
};

const columnType = (table: TableLike, columnName: string) => column(table, columnName).columnType;

const columnNotNull = (table: TableLike, columnName: string) => column(table, columnName).notNull === true;

const primaryKeyColumnNames = (table: ConfiguredTable) =>
  [
    ...getTableConfig(table).primaryKeys.map((primaryKey) => primaryKey.columns.map((keyColumn) => keyColumn.name)),
    ...Object.values(getTableColumns(table))
      .filter((tableColumn) => (tableColumn as ColumnLike).primary === true)
      .map((tableColumn) => [(tableColumn as ColumnLike).name]),
  ];

const hasForeignKey = (table: ConfiguredTable, columnName: string, foreignColumn: ColumnLike) =>
  getTableConfig(table).foreignKeys.some((foreignKey) => {
    const reference = foreignKey.reference();
    return (
      reference.columns.length === 1 &&
      reference.columns[0]?.name === columnName &&
      reference.foreignTable === foreignColumn.table &&
      reference.foreignColumns[0] === foreignColumn
    );
  });

const hasUniqueIndex = (table: ConfiguredTable, indexName: string, columnNames: string[]) => {
  const index = getTableConfig(table).indexes.find((candidate) => candidate.config.name === indexName);

  return (
    index?.config.unique === true &&
    index.config.columns.map((indexColumn) => (indexColumn as { name: string }).name).join(',') === columnNames.join(',')
  );
};

const hasIndex = (table: ConfiguredTable, indexName: string, columnNames: string[]) => {
  const index = getTableConfig(table).indexes.find((candidate) => candidate.config.name === indexName);

  return index?.config.columns.map((indexColumn) => (indexColumn as { name: string }).name).join(',') === columnNames.join(',');
};

const uniqueIndexColumns = (table: ConfiguredTable, indexName: string) => {
  const index = getTableConfig(table).indexes.find((candidate) => candidate.config.name === indexName);
  if (index === undefined || index.config.unique !== true) {
    throw new Error(`Missing unique index ${indexName}`);
  }
  return index.config.columns;
};

describe('P1 core schema release flow Drizzle schema', () => {
  it('exports every required delivery table', () => {
    expect(Object.keys(requiredTables).sort()).toEqual(
      [
        'automation_action_runs',
        'automation_project_settings',
        'actors',
        'attachments',
        'artifacts',
        'code_review_handoffs',
        'command_idempotency_records',
        'boundary_answers',
        'boundary_decisions',
        'boundary_questions',
        'boundary_rounds',
        'boundary_summaries',
        'boundary_summary_revisions',
        'brainstorming_sessions',
        'codex_credential_bindings',
        'codex_credential_binding_versions',
        'codex_launch_leases',
        'codex_launch_token_envelopes',
        'internal_artifact_objects',
        'codex_pending_workspace_bundles',
        'codex_runtime_job_artifacts',
        'codex_runtime_jobs',
        'codex_runtime_profiles',
        'codex_runtime_profile_revisions',
        'codex_runtime_setup_nonces',
        'codex_session_leases',
        'codex_runtime_capsules',
        'codex_session_stale_terminalization_attempts',
        'codex_session_turns',
        'codex_sessions',
        'codex_worker_bootstrap_tokens',
        'codex_worker_registrations',
        'codex_worker_session_nonces',
        'context_manifests',
        'decisions',
        'development_plan_item_revisions',
        'development_plan_items',
        'development_plan_revisions',
        'development_plan_source_links',
        'development_plans',
        'execution_readiness_records',
        'execution_plan_revisions',
        'execution_plans',
        'execution_package_dependencies',
        'execution_package_generation_packages',
        'execution_package_generation_runs',
        'execution_packages',
        'executions',
        'object_events',
        'manual_path_holds',
        'manual_path_hold_idempotency_records',
        'organizations',
        'plan_item_workflow_transitions',
        'plan_item_workflows',
        'plan_revisions',
        'plans',
        'project_repos',
        'projects',
        'qa_handoffs',
        'release_evidences',
        'release_execution_packages',
        'release_work_items',
        'releases',
        'review_packets',
        'run_commands',
        'run_event_counters',
        'run_events',
        'run_sessions',
        'run_worker_leases',
        'spec_revisions',
        'specs',
        'status_histories',
        'trace_artifact_refs',
        'trace_events',
        'trace_links',
        'tasks',
        'work_items',
        'workflow_manual_decisions',
      ].sort(),
    );

    for (const table of Object.values(requiredTables)) {
      expect(table).toBeDefined();
    }

    expect(dbSchema).not.toHaveProperty('test_evidences');
    expect(dbSchema).not.toHaveProperty('incidents');
    expect(dbSchema).not.toHaveProperty('incident_links');
    expect(dbSchema).not.toHaveProperty('contracts');
    expect(dbSchema).not.toHaveProperty('contract_revisions');
    expect(dbSchema).not.toHaveProperty('package_contract_links');
  });

  it('exports P1 core enum value sets used by domain state machines', () => {
    expect(project_repo_status_values).toEqual(['active', 'paused', 'archived']);
    expect(work_item_phase_values).toEqual([
      'draft',
      'triage',
      'spec',
      'plan',
      'execution',
      'release',
      'observing',
      'done',
      'closed',
    ]);
    expect(work_item_kind_values).toEqual(['initiative', 'requirement', 'bug', 'tech_debt']);
    expect(work_item_activity_state_values).toEqual([
      'idle',
      'in_progress',
      'awaiting_ai',
      'ai_running',
      'awaiting_human',
      'human_in_progress',
      'blocked',
    ]);
    expect(work_item_gate_state_values).toEqual([
      'none',
      'awaiting_spec_approval',
      'spec_changes_requested',
      'awaiting_plan_approval',
      'plan_changes_requested',
      'awaiting_release_approval',
      'release_changes_requested',
    ]);
    expect(work_item_resolution_values).toEqual([
      'none',
      'completed',
      'cancelled',
      'rejected',
      'duplicate',
      'superseded',
      'won_t_do',
    ]);
    expect(spec_plan_status_values).toEqual(['draft', 'in_review', 'approved', 'rejected', 'superseded', 'archived']);
    expect(spec_plan_editing_state_values).toEqual(['idle', 'ai_drafting', 'human_editing', 'co_editing']);
    expect(spec_plan_gate_state_values).toEqual([
      'not_submitted',
      'awaiting_approval',
      'approved',
      'changes_requested',
    ]);
    expect(spec_plan_resolution_values).toEqual(['none', 'approved', 'rejected', 'superseded']);
    expect(execution_package_phase_values).toEqual([
      'draft',
      'ready',
      'queued',
      'execution',
      'review',
      'integration',
      'test_gate',
      'release',
      'archived',
    ]);
    expect(execution_package_activity_state_values).toEqual([
      'idle',
      'ai_running',
      'ai_retrying',
      'human_editing',
      'awaiting_human',
      'human_reviewing',
      'blocked',
      'handover',
    ]);
    expect(execution_package_activity_state_values).not.toContain('awaiting_ai');
    expect(execution_package_gate_state_values).toEqual([
      'not_submitted',
      'self_review_pending',
      'awaiting_human_review',
      'changes_requested',
      'review_approved',
      'integration_failed',
      'integration_passed',
      'test_failed',
      'test_passed',
      'release_ready',
      'released',
    ]);
    expect(execution_package_gate_state_values).not.toContain('none');
    expect(execution_package_resolution_values).toEqual([
      'none',
      'completed',
      'cancelled',
      'rolled_back',
      'superseded',
    ]);
    expect(decision_outcome_values).toEqual([
      'approved',
      'changes_requested',
      'rejected',
      'override_approved',
      'rolled_back',
      'cancelled',
      'completed',
    ]);
    expect(run_session_status_values).toEqual([
      'queued',
      'running',
      'waiting_for_input',
      'stalled',
      'resuming',
      'cancel_requested',
      'succeeded',
      'failed',
      'timed_out',
      'cancelled',
    ]);
    expect(review_packet_status_values).toEqual(['draft', 'ready', 'in_review', 'completed', 'escalated', 'archived']);
    expect(review_packet_decision_values).toEqual([
      'none',
      'approved',
      'changes_requested',
      'need_more_context',
      'escalate',
    ]);
    expect(trace_link_relationship_values).toEqual([
      'belongs_to',
      'generated_by',
      'supports',
      'supersedes',
      'replaces',
      'redacted_from',
    ]);
  });

  it('uses JSONB for representative structured delivery fields', () => {
    expect(columnType(spec_revisions, 'structuredDocument')).toBe('PgJsonb');
    expect(columnType(spec_revisions, 'artifactRefs')).toBe('PgJsonb');
    expect(columnType(plan_revisions, 'structuredDocument')).toBe('PgJsonb');
    expect(columnType(plan_revisions, 'testMatrix')).toBe('PgJsonb');
    expect(columnType(execution_packages, 'requiredChecks')).toBe('PgJsonb');
    expect(columnType(execution_packages, 'requiredArtifactKinds')).toBe('PgJsonb');
    expect(columnType(execution_packages, 'allowedPaths')).toBe('PgJsonb');
    expect(columnType(tasks, 'acceptanceChecklist')).toBe('PgJsonb');
    expect(columnType(tasks, 'parentRef')).toBe('PgJsonb');
    expect(columnType(tasks, 'auditedException')).toBe('PgJsonb');
    expect(columnType(attachments, 'linkedObjectRefs')).toBe('PgJsonb');
    expect(columnType(run_sessions, 'runSpec')).toBe('PgJsonb');
    expect(columnType(run_sessions, 'executorResult')).toBe('PgJsonb');
    expect(columnType(run_sessions, 'runtimeMetadata')).toBe('PgJsonb');
    expect(columnType(run_sessions, 'changedFiles')).toBe('PgJsonb');
    expect(columnType(run_sessions, 'checkResults')).toBe('PgJsonb');
    expect(columnType(run_sessions, 'artifacts')).toBe('PgJsonb');
    expect(columnType(review_packets, 'changedFiles')).toBe('PgJsonb');
    expect(columnType(review_packets, 'selfReview')).toBe('PgJsonb');
    expect(columnType(review_packets, 'independentAiReview')).toBe('PgJsonb');
    expect(columnType(review_packets, 'testMapping')).toBe('PgJsonb');
    expect(columnType(review_packets, 'riskNotes')).toBe('PgJsonb');
    expect(columnType(review_packets, 'requestedChanges')).toBe('PgJsonb');
    expect(columnType(object_events, 'metadata')).toBe('PgJsonb');
    expect(columnType(run_events, 'payload')).toBe('PgJsonb');
    expect(columnType(run_events, 'rawRef')).toBe('PgJsonb');
    expect(columnType(run_commands, 'payload')).toBe('PgJsonb');
    expect(columnType(run_commands, 'driverAck')).toBe('PgJsonb');
    expect(columnType(trace_events, 'payload')).toBe('PgJsonb');
    expect(columnType(trace_artifact_refs, 'ref')).toBe('PgJsonb');
    expect(columnType(development_plan_items, 'leaderDelegateActorIds')).toBe('PgJsonb');
    expect(columnType(brainstorming_sessions, 'leaderDelegateActorIds')).toBe('PgJsonb');
    expect(columnType(boundary_summary_revisions, 'confirmedScope')).toBe('PgJsonb');
    expect(columnType(boundary_summary_revisions, 'confirmedOutOfScope')).toBe('PgJsonb');
    expect(columnType(boundary_summary_revisions, 'acceptedAssumptions')).toBe('PgJsonb');
    expect(columnType(boundary_summary_revisions, 'openRisks')).toBe('PgJsonb');
    expect(columnType(boundary_summary_revisions, 'validationExpectations')).toBe('PgJsonb');
    expect(columnType(boundary_summary_revisions, 'questionAnswerSnapshot')).toBe('PgJsonb');
  });

  it('keeps migration-phase boundary defaults nullable on existing tables', () => {
    expect(columnNotNull(development_plan_items, 'leaderDelegateActorIds')).toBe(false);
    expect(columnNotNull(brainstorming_sessions, 'developmentPlanRevisionId')).toBe(false);
    expect(columnNotNull(brainstorming_sessions, 'leaderDelegateActorIds')).toBe(false);
    expect(columnNotNull(brainstorming_sessions, 'status')).toBe(false);
    expect(columnNotNull(boundary_summary_revisions, 'developmentPlanId')).toBe(false);
  });

  it('defines Plan Item Workflow and Codex Session tables', () => {
    expect(primaryKeyColumnNames(plan_item_workflows)).toEqual([['id']]);
    expect(columnType(plan_item_workflows, 'status')).toBe('PgText');
    expect(columnNotNull(plan_item_workflows, 'development_plan_item_id')).toBe(true);
    expect(columnNotNull(plan_item_workflows, 'created_by_actor_id')).toBe(true);
    expect(hasIndex(plan_item_workflows, 'plan_item_workflows_item_idx', ['development_plan_id', 'development_plan_item_id'])).toBe(true);

    expect(primaryKeyColumnNames(codex_sessions)).toEqual([['id']]);
    expect(columnNotNull(codex_sessions, 'role')).toBe(true);
    expect(columnNotNull(codex_sessions, 'lease_epoch')).toBe(true);
    expect(columnNotNull(codex_sessions, 'created_by_actor_id')).toBe(true);
    expect(columnType(codex_sessions, 'latest_capsule_id')).toBe('PgUUID');
    expect(columnType(codex_sessions, 'base_memory_bundle_ref')).toBe('PgText');
    expect(columnType(codex_sessions, 'latest_environment_manifest_ref')).toBe('PgText');
    expect(Object.keys(getTableColumns(codex_sessions))).not.toContain('latestSnapshotId');
    expect(hasIndex(codex_sessions, 'codex_sessions_owner_idx', ['owner_type', 'owner_id'])).toBe(true);

    expect(columnNotNull(plan_item_workflow_transitions, 'actor_id')).toBe(true);
    expect(columnNotNull(workflow_manual_decisions, 'created_by_actor_id')).toBe(true);
    expect(columnNotNull(execution_readiness_records, 'created_by_actor_id')).toBe(true);
    expect(columnNotNull(codex_session_turns, 'created_by_actor_id')).toBe(true);
    for (const columnName of [
      'created_by_actor_id',
      'created_from_turn_id',
      'sequence',
      'artifact_ref',
      'digest',
      'size_bytes',
      'manifest_digest',
      'thread_state_digest',
      'memory_state_digest',
      'environment_manifest_digest',
      'codex_thread_id_digest',
      'codex_cli_version',
      'app_server_protocol_digest',
      'runtime_profile_revision_id',
      'trusted_runtime_manifest_digest',
      'credential_binding_lineage_digest',
    ]) {
      expect(columnNotNull(codex_runtime_capsules, columnName)).toBe(true);
    }

    expect(primaryKeyColumnNames(codex_session_leases)).toEqual([['id']]);
    expect(columnNotNull(codex_session_leases, 'lease_token_hash')).toBe(true);
    expect(hasIndex(codex_session_leases, 'codex_session_leases_session_epoch_idx', ['codex_session_id', 'lease_epoch'])).toBe(true);
  });

  it('adds workflow references to child delivery records', () => {
    expect(columnType(brainstorming_sessions, 'workflow_id')).toBe('PgUUID');
    expect(columnType(boundary_summary_revisions, 'codex_session_turn_id')).toBe('PgUUID');
    expect(columnType(execution_readiness_records, 'codex_session_turn_id')).toBe('PgUUID');
    expect(columnType(spec_revisions, 'codex_session_turn_id')).toBe('PgUUID');
    expect(columnType(execution_plan_revisions, 'codex_session_turn_id')).toBe('PgUUID');
    expect(columnType(automation_action_runs, 'workflow_id')).toBe('PgUUID');
    expect(columnType(codex_runtime_jobs, 'codex_session_turn_id')).toBe('PgUUID');
    expect(columnType(run_sessions, 'codex_session_turn_id')).toBe('PgUUID');
  });

  it('uses UUID ids for aggregate tables and text ids for runtime protocol tables', () => {
    expect(columnType(organizations, 'id')).toBe('PgUUID');
    expect(columnType(actors, 'id')).toBe('PgUUID');
    expect(columnType(projects, 'id')).toBe('PgUUID');
    expect(columnType(work_items, 'id')).toBe('PgUUID');
    expect(columnType(tasks, 'id')).toBe('PgUUID');
    expect(columnType(attachments, 'id')).toBe('PgUUID');
    expect(columnType(specs, 'id')).toBe('PgUUID');
    expect(columnType(spec_revisions, 'id')).toBe('PgUUID');
    expect(columnType(plans, 'id')).toBe('PgUUID');
    expect(columnType(plan_revisions, 'id')).toBe('PgUUID');
    expect(columnType(execution_packages, 'id')).toBe('PgUUID');
    expect(columnType(execution_packages, 'executionId')).toBe('PgUUID');
    expect(columnType(run_sessions, 'id')).toBe('PgUUID');
    expect(columnType(review_packets, 'id')).toBe('PgUUID');
    expect(columnType(artifacts, 'id')).toBe('PgUUID');
    expect(columnType(decisions, 'id')).toBe('PgUUID');
    expect(columnType(releases, 'id')).toBe('PgUUID');
    expect(columnType(release_evidences, 'id')).toBe('PgUUID');
    expect(columnType(run_events, 'id')).toBe('PgText');
    expect(columnType(run_commands, 'id')).toBe('PgText');
    expect(columnType(run_worker_leases, 'id')).toBe('PgText');
    expect(columnType(execution_packages, 'executionPackageSetId')).toBe('PgText');
    expect(columnType(codex_credential_bindings, 'repoId')).toBe('PgText');
    expect(columnType(codex_launch_leases, 'repoId')).toBe('PgText');
    expect(columnType(codex_launch_leases, 'targetId')).toBe('PgText');
    expect(columnNotNull(codex_launch_leases, 'launchAttempt')).toBe(true);
    expect(columnType(codex_launch_leases, 'runWorkerLeaseId')).toBe('PgText');
    expect(columnType(codex_launch_leases, 'terminalEvidenceSummaryJson')).toBe('PgJsonb');
    expect(columnType(codex_launch_leases, 'terminalRuntimeJobId')).toBe('PgText');
    expect(columnType(codex_launch_leases, 'terminalIdempotencyKey')).toBe('PgText');
    expect(columnType(codex_worker_session_nonces, 'nonceHash')).toBe('PgText');
    expect(columnType(codex_worker_registrations, 'sessionEpoch')).toBe('PgInteger');
    expect(columnNotNull(codex_worker_registrations, 'sessionEpoch')).toBe(true);
    expect(columnType(codex_worker_session_nonces, 'sessionEpoch')).toBe('PgInteger');
    expect(columnNotNull(codex_worker_session_nonces, 'sessionEpoch')).toBe(true);
    expect(columnType(codex_worker_session_nonces, 'requestBindingDigest')).toBe('PgText');
    expect(columnNotNull(codex_worker_session_nonces, 'requestBindingDigest')).toBe(true);
    expect(columnType(codex_worker_session_nonces, 'replayKeyHash')).toBe('PgText');
    expect(columnNotNull(codex_worker_session_nonces, 'replayKeyHash')).toBe(true);
    expect(
      hasUniqueIndex(codex_worker_session_nonces, 'codex_worker_session_nonces_worker_session_nonce_idx', [
        'worker_id',
        'session_token_hash',
        'nonce_hash',
      ]),
    ).toBe(true);
    expect(
      hasUniqueIndex(codex_worker_session_nonces, 'codex_worker_session_nonces_worker_epoch_nonce_idx', [
        'worker_id',
        'session_epoch',
        'nonce_hash',
      ]),
    ).toBe(true);
    expect(hasUniqueIndex(codex_worker_session_nonces, 'codex_worker_session_nonces_replay_key_idx', ['replay_key_hash'])).toBe(true);
    expect(columnNotNull(codex_worker_registrations, 'sessionTokenExpiresAt')).toBe(true);
    expect(columnNotNull(codex_worker_session_nonces, 'sessionTokenHash')).toBe(true);
    expect(Object.keys(getTableColumns(codex_worker_session_nonces))).not.toContain('nonce');
    expect(Object.keys(getTableColumns(codex_worker_session_nonces))).not.toContain('sessionToken');
    expect(columnType(codex_runtime_setup_nonces, 'setupNonceHash')).toBe('PgText');
    expect(columnNotNull(codex_runtime_setup_nonces, 'requestSignatureHash')).toBe(true);
    expect(columnType(codex_worker_registrations, 'capabilityCeilingJson')).toBe('PgJsonb');
    expect(columnNotNull(codex_worker_registrations, 'capabilityCeilingJson')).toBe(true);
    expect(columnType(project_repos, 'project_id')).toBe('PgUUID');
    expect(columnType(projects, 'owner_actor_id')).toBe('PgUUID');
    expect(columnType(work_items, 'driver_actor_id')).toBe('PgUUID');
    expect(columnType(work_items, 'intake_context')).toBe('PgJsonb');
    expect(columnType(work_items, 'narrative_markdown')).toBe('PgText');
    expect(Object.keys(getTableColumns(work_items))).not.toContain('ownerActorId');
    expect(columnType(development_plan_revisions, 'id')).toBe('PgUUID');
    expect(columnType(development_plan_revisions, 'development_plan_id')).toBe('PgUUID');
    expect(columnType(development_plan_revisions, 'source_refs')).toBe('PgJsonb');
    expect(columnType(development_plan_revisions, 'item_refs')).toBe('PgJsonb');
    expect(columnType(development_plan_revisions, 'generation_state')).toBe('PgText');
    expect(columnNotNull(development_plan_revisions, 'revisionNumber')).toBe(true);
    expect(
      hasUniqueIndex(development_plan_revisions, 'development_plan_revisions_plan_revision_unique', [
        'development_plan_id',
        'revision_number',
      ]),
    ).toBe(true);
    expect(columnType(boundary_summary_revisions, 'brainstorming_session_revision_id')).toBe('PgUUID');
    expect(columnNotNull(boundary_summary_revisions, 'brainstormingSessionRevisionId')).toBe(true);
    expect(columnType(boundary_summary_revisions, 'source_round_id')).toBe('PgText');
    expect(columnType(boundary_summary_revisions, 'development_plan_id')).toBe('PgUUID');
    expect(columnType(boundary_summary_revisions, 'status')).toBe('PgText');
    expect(columnType(boundary_summary_revisions, 'development_plan_item_revision_id')).toBe('PgUUID');
    expect(columnNotNull(boundary_summary_revisions, 'developmentPlanItemRevisionId')).toBe(true);
    expect(columnType(boundary_rounds, 'id')).toBe('PgText');
    expect(columnType(boundary_rounds, 'session_id')).toBe('PgUUID');
    expect(columnType(boundary_rounds, 'round_number')).toBe('PgInteger');
    expect(columnNotNull(boundary_rounds, 'roundNumber')).toBe(true);
    expect(columnType(boundary_questions, 'id')).toBe('PgText');
    expect(columnType(boundary_questions, 'sequence')).toBe('PgInteger');
    expect(columnNotNull(boundary_questions, 'required')).toBe(true);
    expect(columnType(boundary_answers, 'id')).toBe('PgText');
    expect(columnType(boundary_answers, 'sequence')).toBe('PgInteger');
    expect(columnType(boundary_decisions, 'id')).toBe('PgText');
    expect(columnType(boundary_decisions, 'sequence')).toBe('PgInteger');
    expect(columnType(execution_packages, 'task_id')).toBe('PgUUID');
    expect(columnType(execution_packages, 'owner_actor_id')).toBe('PgUUID');
    expect(columnType(execution_packages, 'reviewer_actor_id')).toBe('PgUUID');
    expect(columnType(execution_packages, 'qa_owner_actor_id')).toBe('PgUUID');
    expect(columnType(run_sessions, 'requested_by_actor_id')).toBe('PgUUID');
    expect(columnType(run_commands, 'actor_id')).toBe('PgText');
    expect(columnType(execution_packages, 'required_checks')).toBe('PgJsonb');
    expect(columnType(execution_packages, 'required_test_gates')).toBe('PgJsonb');
    expect(columnType(release_evidences, 'object_ref')).toBe('PgJsonb');
  });

  it('uses a null-safe target attempt uniqueness key for Codex launch leases', () => {
    const targetAttemptColumns = uniqueIndexColumns(codex_launch_leases, 'codex_launch_leases_target_attempt_idx');

    expect(targetAttemptColumns.map((indexColumn) => (indexColumn as { name?: string }).name)).toEqual([
      'project_id',
      undefined,
      'target_type',
      'target_id',
      'launch_attempt',
    ]);
  });

  it('defines Codex runtime job persistence tables and safety indexes', () => {
    expect(columnType(codex_runtime_jobs, 'id')).toBe('PgUUID');
    expect(columnType(codex_runtime_jobs, 'jobRequestId')).toBe('PgText');
    expect(columnType(codex_runtime_jobs, 'inputJson')).toBe('PgJsonb');
    expect(columnType(codex_runtime_jobs, 'workspaceAcquisitionJson')).toBe('PgJsonb');
    expect(columnType(codex_runtime_jobs, 'terminalResultJson')).toBe('PgJsonb');
    expect(columnType(codex_runtime_jobs, 'acceptedWorkerSessionDigest')).toBe('PgText');
    expect(columnType(codex_runtime_jobs, 'acceptedSessionPublicKeyId')).toBe('PgText');
    expect(columnType(codex_runtime_jobs, 'acceptedSessionPublicKeyExpiresAt')).toBe('PgTimestampString');
    expect(columnType(codex_runtime_jobs, 'materializationRequestDigest')).toBe('PgText');
    expect(columnType(codex_runtime_jobs, 'runtimeEvidenceDigest')).toBe('PgText');
    expect(columnType(codex_runtime_jobs, 'launchMaterializationDigest')).toBe('PgText');
    expect(columnType(codex_runtime_jobs, 'cancelRequestDigest')).toBe('PgText');
    expect(columnType(codex_runtime_jobs, 'terminalRequestDigest')).toBe('PgText');
    expect(columnType(codex_runtime_jobs, 'lastEventAt')).toBe('PgTimestampString');

    expect(columnType(codex_launch_token_envelopes, 'id')).toBe('PgUUID');
    expect(columnType(codex_launch_token_envelopes, 'runtimeJobId')).toBe('PgUUID');
    expect(columnType(codex_launch_token_envelopes, 'aadJson')).toBe('PgJsonb');
    expect(columnType(codex_launch_token_envelopes, 'claimRequestDigest')).toBe('PgText');
    expect(columnType(codex_launch_token_envelopes, 'claimedWorkerSessionDigest')).toBe('PgText');
    expect(Object.keys(getTableColumns(codex_launch_token_envelopes))).not.toContain('launchToken');
    expect(Object.keys(getTableColumns(codex_launch_token_envelopes))).not.toContain('plaintextLaunchToken');

    expect(columnType(codex_runtime_job_artifacts, 'runtimeJobId')).toBe('PgUUID');
    expect(columnType(codex_runtime_job_artifacts, 'metadataJson')).toBe('PgJsonb');
    expect(columnType(codex_runtime_job_artifacts, 'requestDigest')).toBe('PgText');
    expect(columnNotNull(codex_runtime_job_artifacts, 'requestDigest')).toBe(false);
    expect(columnType(codex_pending_workspace_bundles, 'workspaceAcquisitionJson')).toBe('PgJsonb');
    expect(columnType(codex_pending_workspace_bundles, 'runWorkerLeaseId')).toBe('PgText');

    expect(hasUniqueIndex(codex_runtime_jobs, 'codex_runtime_jobs_job_request_idx', ['job_request_id'])).toBe(true);
    const targetAttemptColumns = uniqueIndexColumns(codex_runtime_jobs, 'codex_runtime_jobs_target_attempt_idx');
    expect(targetAttemptColumns.map((indexColumn) => (indexColumn as { name?: string }).name)).toEqual([
      'project_id',
      undefined,
      'target_type',
      'target_id',
      'launch_attempt',
    ]);
    expect(hasUniqueIndex(codex_launch_token_envelopes, 'codex_launch_token_envelopes_runtime_job_idx', ['runtime_job_id'])).toBe(true);
    expect(hasUniqueIndex(codex_runtime_job_artifacts, 'codex_runtime_job_artifacts_job_digest_idx', [
      'runtime_job_id',
      'digest',
      'content_type',
    ])).toBe(true);
    expect(hasUniqueIndex(codex_pending_workspace_bundles, 'codex_pending_workspace_bundles_bundle_idx', ['bundle_id'])).toBe(true);
  });

  it('defines internal artifact objects with non-public storage metadata', () => {
    const columns = getTableColumns(internal_artifact_objects);
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining([
        'id',
        'artifactId',
        'ref',
        'storageKey',
        'kind',
        'contentType',
        'sizeBytes',
        'digest',
        'visibility',
        'ownerType',
        'ownerId',
        'idempotencyKey',
        'requestDigest',
        'metadataJson',
        'createdByActorType',
        'createdByActorId',
        'createdAt',
        'deletedAt',
      ]),
    );
    expect(hasUniqueIndex(internal_artifact_objects, 'internal_artifact_objects_ref_idx', ['ref'])).toBe(true);
    expect(
      hasUniqueIndex(internal_artifact_objects, 'internal_artifact_objects_owner_idempotency_idx', [
        'owner_type',
        'owner_id',
        'idempotency_key',
      ]),
    ).toBe(true);
    expect(
      hasUniqueIndex(internal_artifact_objects, 'internal_artifact_objects_owner_kind_artifact_idx', [
        'owner_type',
        'owner_id',
        'kind',
        'artifact_id',
      ]),
    ).toBe(true);
    expect(
      hasIndex(internal_artifact_objects, 'internal_artifact_objects_owner_kind_created_idx', [
        'owner_type',
        'owner_id',
        'kind',
        'created_at',
      ]),
    ).toBe(true);
    expect(hasIndex(internal_artifact_objects, 'internal_artifact_objects_storage_key_idx', ['storage_key'])).toBe(true);
    expect(
      hasIndex(internal_artifact_objects, 'internal_artifact_objects_digest_content_type_idx', ['digest', 'content_type']),
    ).toBe(true);
  });

  it('defines release uniqueness and evidence contract constraints', () => {
    expect(hasUniqueIndex(releases, 'releases_org_key_uq', ['org_id', 'key'])).toBe(true);
    expect(hasUniqueIndex(release_evidences, 'release_evidences_org_key_uq', ['org_id', 'key'])).toBe(true);
    expect(columnType(releases, 'scope_summary')).toBe('PgText');
    expect(columnType(releases, 'rollout_strategy')).toBe('PgText');
    expect(columnType(releases, 'rollback_plan')).toBe('PgText');
    expect(columnType(releases, 'observation_plan')).toBe('PgText');
    expect(columnNotNull(releases, 'updated_by_actor_id')).toBe(true);
    expect(columnNotNull(release_evidences, 'summary')).toBe(true);
  });

  it('defines automation uniqueness and ownership fences', () => {
    expect(hasUniqueIndex(automation_project_settings, 'automation_project_settings_project_scope', ['project_id'])).toBe(true);
    expect(hasUniqueIndex(automation_project_settings, 'automation_project_settings_repo_scope', ['project_id', 'repo_id'])).toBe(
      true,
    );
    expect(hasUniqueIndex(manual_path_holds, 'manual_path_holds_active_scope', ['object_type', 'object_id', 'scope_key'])).toBe(true);
    expect(hasUniqueIndex(manual_path_holds, 'manual_path_holds_source_action', ['source_automation_action_id'])).toBe(true);
    expect(
      hasUniqueIndex(execution_package_generation_runs, 'execution_package_generation_runs_key', ['plan_revision_id', 'generation_key']),
    ).toBe(true);
    expect(
      hasUniqueIndex(execution_package_generation_runs, 'execution_package_generation_runs_current_succeeded', ['plan_revision_id']),
    ).toBe(true);
    expect(
      hasUniqueIndex(
        execution_package_generation_packages,
        'execution_package_generation_package_id',
        ['execution_package_set_id', 'execution_package_id'],
      ),
    ).toBe(true);
    expect(
      hasUniqueIndex(
        execution_package_generation_packages,
        'execution_package_generation_package_key',
        ['plan_revision_id', 'generation_key', 'package_key'],
      ),
    ).toBe(true);
    expect(column(manual_path_hold_idempotency_records, 'idempotency_key').primary).toBe(true);
    expect(column(command_idempotency_records, 'idempotency_key').isUnique).toBe(true);
    expect(column(automation_action_runs, 'idempotency_key').isUnique).toBe(true);
    expect(columnType(automation_action_runs, 'target_version')).toBe('PgInteger');
    expect(columnNotNull(automation_action_runs, 'precondition_fingerprint')).toBe(true);
    expect(columnNotNull(automation_action_runs, 'action_input_json')).toBe(true);
  });

  it('defines durable project and actor foreign keys', () => {
    expect(hasForeignKey(project_repos, 'project_id', column(projects, 'id'))).toBe(true);
    expect(hasForeignKey(projects, 'owner_actor_id', column(actors, 'id'))).toBe(true);
    expect(hasForeignKey(work_items, 'driver_actor_id', column(actors, 'id'))).toBe(true);
    expect(hasForeignKey(execution_packages, 'owner_actor_id', column(actors, 'id'))).toBe(true);
    expect(hasForeignKey(execution_packages, 'reviewer_actor_id', column(actors, 'id'))).toBe(true);
    expect(hasForeignKey(execution_packages, 'qa_owner_actor_id', column(actors, 'id'))).toBe(true);
    expect(hasForeignKey(run_sessions, 'requested_by_actor_id', column(actors, 'id'))).toBe(true);
    expect(hasForeignKey(decisions, 'actor_id', column(actors, 'id'))).toBe(true);
    expect(hasForeignKey(review_packets, 'reviewer_actor_id', column(actors, 'id'))).toBe(true);
    expect(hasForeignKey(review_packets, 'reviewed_by_actor_id', column(actors, 'id'))).toBe(true);
    expect(hasForeignKey(spec_revisions, 'author_actor_id', column(actors, 'id'))).toBe(true);
    expect(hasForeignKey(plan_revisions, 'author_actor_id', column(actors, 'id'))).toBe(true);
  });

  it('defines AI-native planning graph foreign keys and immutable revision indexes', () => {
    expect(hasForeignKey(development_plans, 'project_id', column(projects, 'id'))).toBe(true);
    expect(hasForeignKey(development_plan_items, 'development_plan_id', column(development_plans, 'id'))).toBe(true);
    expect(hasForeignKey(development_plan_source_links, 'development_plan_id', column(development_plans, 'id'))).toBe(true);
    expect(hasForeignKey(brainstorming_sessions, 'development_plan_item_id', column(development_plan_items, 'id'))).toBe(true);
    expect(hasForeignKey(boundary_summaries, 'brainstorming_session_id', column(brainstorming_sessions, 'id'))).toBe(true);
    expect(hasForeignKey(boundary_summary_revisions, 'boundary_summary_id', column(boundary_summaries, 'id'))).toBe(true);
    expect(hasForeignKey(boundary_summary_revisions, 'codex_session_turn_id', column(codex_session_turns, 'id'))).toBe(true);
    expect(hasForeignKey(execution_readiness_records, 'codex_session_turn_id', column(codex_session_turns, 'id'))).toBe(true);
    expect(hasForeignKey(execution_plans, 'development_plan_item_id', column(development_plan_items, 'id'))).toBe(true);
    expect(hasForeignKey(execution_plan_revisions, 'execution_plan_id', column(execution_plans, 'id'))).toBe(true);
    expect(hasForeignKey(execution_plan_revisions, 'based_on_spec_revision_id', column(spec_revisions, 'id'))).toBe(true);
    expect(hasForeignKey(executions, 'execution_plan_revision_id', column(execution_plan_revisions, 'id'))).toBe(true);
    expect(hasForeignKey(executions, 'approved_spec_revision_id', column(spec_revisions, 'id'))).toBe(true);
    expect(hasForeignKey(execution_packages, 'execution_id', column(executions, 'id'))).toBe(true);
    expect(hasForeignKey(code_review_handoffs, 'execution_id', column(executions, 'id'))).toBe(true);
    expect(hasForeignKey(code_review_handoffs, 'execution_plan_revision_id', column(execution_plan_revisions, 'id'))).toBe(true);
    expect(hasForeignKey(qa_handoffs, 'code_review_handoff_id', column(code_review_handoffs, 'id'))).toBe(true);
    expect(hasForeignKey(qa_handoffs, 'execution_id', column(executions, 'id'))).toBe(true);
    for (const columnName of [
      'interrupt_history',
      'continuation_history',
      'pr_refs',
      'diff_refs',
      'test_evidence_refs',
      'approved_spec_revision_ref',
    ]) {
      expect(columnType(executions, columnName)).toBe('PgJsonb');
      expect(columnNotNull(executions, columnName)).toBe(true);
    }
    expect(columnType(executions, 'approved_spec_revision_id')).toBe('PgUUID');
    expect(columnNotNull(executions, 'approved_spec_revision_id')).toBe(true);
    expect(columnType(executions, 'worker_state')).toBe('PgText');
    expect(columnType(executions, 'current_step')).toBe('PgText');
    expect(columnType(executions, 'stale')).toBe('PgBoolean');
    expect(columnType(executions, 'blocked')).toBe('PgBoolean');
    expect(columnType(executions, 'last_event_at')).toBe('PgTimestampString');
    expect(columnType(executions, 'last_event_summary')).toBe('PgText');
    for (const columnName of ['worker_state', 'current_step', 'stale', 'blocked', 'last_event_at', 'last_event_summary']) {
      expect(columnNotNull(executions, columnName)).toBe(false);
    }
    expect(
      hasUniqueIndex(development_plan_item_revisions, 'dpi_revisions_item_revision_unique', [
        'development_plan_item_id',
        'revision_number',
      ]),
    ).toBe(true);
    expect(
      hasUniqueIndex(boundary_summary_revisions, 'boundary_revisions_summary_revision_unique', [
        'boundary_summary_id',
        'revision_number',
      ]),
    ).toBe(true);
    expect(
      hasUniqueIndex(execution_plan_revisions, 'execution_plan_revisions_plan_revision_unique', [
        'execution_plan_id',
        'revision_number',
      ]),
    ).toBe(true);
  });

  it('defines release link composite primary keys and durable foreign keys', () => {
    expect(primaryKeyColumnNames(release_work_items)).toContainEqual(['release_id', 'work_item_id']);
    expect(primaryKeyColumnNames(release_execution_packages)).toContainEqual(['release_id', 'package_id']);
    expect(hasForeignKey(release_work_items, 'release_id', column(releases, 'id'))).toBe(true);
    expect(hasForeignKey(release_work_items, 'work_item_id', column(work_items, 'id'))).toBe(true);
    expect(hasForeignKey(release_execution_packages, 'release_id', column(releases, 'id'))).toBe(true);
    expect(hasForeignKey(release_execution_packages, 'package_id', column(execution_packages, 'id'))).toBe(true);
  });

  it('includes future artifact trace subject link columns', () => {
    expect(columnType(artifacts, 'traceSubjectType')).toBe('PgText');
    expect(columnType(artifacts, 'traceSubjectId')).toBe('PgText');
  });

  it('defines trace evidence tables with relationship and subject columns', () => {
    expect(columnType(trace_events, 'eventType')).toBe('PgText');
    expect(columnType(trace_events, 'subjectType')).toBe('PgText');
    expect(columnType(trace_events, 'subjectId')).toBe('PgText');
    expect(columnType(trace_events, 'summary')).toBe('PgText');
    expect(columnType(trace_links, 'traceEventId')).toBe('PgText');
    expect(columnType(trace_links, 'relationship')).toBe('PgEnumColumn');
    expect(columnType(trace_links, 'objectType')).toBe('PgText');
    expect(columnType(trace_links, 'objectId')).toBe('PgText');
    expect(columnType(trace_artifact_refs, 'traceEventId')).toBe('PgText');
    expect(columnType(trace_artifact_refs, 'artifactId')).toBe('PgText');
  });
});
