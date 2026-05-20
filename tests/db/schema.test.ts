import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  actors,
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
  command_idempotency_records,
  execution_package_generation_packages,
  execution_package_generation_runs,
  manual_path_hold_idempotency_records,
  manual_path_holds,
  trace_artifact_refs,
  trace_events,
  trace_link_relationship_values,
  trace_links,
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
  automation_project_settings,
  manual_path_holds,
  manual_path_hold_idempotency_records,
  command_idempotency_records,
  execution_package_generation_runs,
  execution_package_generation_packages,
  automation_action_runs,
  organizations,
  actors,
  projects,
  project_repos,
  work_items,
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
  getTableConfig(table).primaryKeys.map((primaryKey) => primaryKey.columns.map((keyColumn) => keyColumn.name));

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

describe('P1 core schema release flow Drizzle schema', () => {
  it('exports every required delivery table', () => {
    expect(Object.keys(requiredTables).sort()).toEqual(
      [
        'automation_action_runs',
        'automation_project_settings',
        'actors',
        'artifacts',
        'command_idempotency_records',
        'decisions',
        'execution_package_dependencies',
        'execution_package_generation_packages',
        'execution_package_generation_runs',
        'execution_packages',
        'object_events',
        'manual_path_holds',
        'manual_path_hold_idempotency_records',
        'organizations',
        'plan_revisions',
        'plans',
        'project_repos',
        'projects',
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
        'work_items',
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
  });

  it('uses UUID ids for aggregate tables and text ids for runtime protocol tables', () => {
    expect(columnType(organizations, 'id')).toBe('PgUUID');
    expect(columnType(actors, 'id')).toBe('PgUUID');
    expect(columnType(projects, 'id')).toBe('PgUUID');
    expect(columnType(work_items, 'id')).toBe('PgUUID');
    expect(columnType(specs, 'id')).toBe('PgUUID');
    expect(columnType(spec_revisions, 'id')).toBe('PgUUID');
    expect(columnType(plans, 'id')).toBe('PgUUID');
    expect(columnType(plan_revisions, 'id')).toBe('PgUUID');
    expect(columnType(execution_packages, 'id')).toBe('PgUUID');
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
    expect(columnType(project_repos, 'project_id')).toBe('PgUUID');
    expect(columnType(projects, 'owner_actor_id')).toBe('PgUUID');
    expect(columnType(work_items, 'owner_actor_id')).toBe('PgUUID');
    expect(columnType(execution_packages, 'owner_actor_id')).toBe('PgUUID');
    expect(columnType(execution_packages, 'reviewer_actor_id')).toBe('PgUUID');
    expect(columnType(execution_packages, 'qa_owner_actor_id')).toBe('PgUUID');
    expect(columnType(run_sessions, 'requested_by_actor_id')).toBe('PgUUID');
    expect(columnType(run_commands, 'actor_id')).toBe('PgText');
    expect(columnType(execution_packages, 'required_checks')).toBe('PgJsonb');
    expect(columnType(execution_packages, 'required_test_gates')).toBe('PgJsonb');
    expect(columnType(release_evidences, 'object_ref')).toBe('PgJsonb');
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
    expect(hasForeignKey(work_items, 'owner_actor_id', column(actors, 'id'))).toBe(true);
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
