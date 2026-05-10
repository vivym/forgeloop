import { getTableColumns } from 'drizzle-orm';
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
  spec_plan_gate_state_values,
  spec_plan_status_values,
  spec_revisions,
  specs,
  status_histories,
  plan_revisions,
  plans,
  artifacts,
  trace_artifact_refs,
  trace_events,
  trace_link_relationship_values,
  trace_links,
  work_item_kind_values,
  work_item_phase_values,
  work_items,
} from '../../packages/db/src/index';
import * as dbSchema from '../../packages/db/src/index';

type TableLike = Parameters<typeof getTableColumns>[0];

const requiredTables = {
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

const columnType = (table: TableLike, columnName: string) => {
  const columns = getTableColumns(table);
  const column =
    columns[columnName] ??
    Object.values(columns).find((candidate) => (candidate as { name: string }).name === columnName);
  if (column === undefined) {
    throw new Error(`Missing column ${columnName}`);
  }

  return (column as { columnType: string }).columnType;
};

describe('P0 Drizzle schema', () => {
  it('exports every required P0 table', () => {
    expect(Object.keys(requiredTables).sort()).toEqual(
      [
        'actors',
        'artifacts',
        'decisions',
        'execution_package_dependencies',
        'execution_packages',
        'object_events',
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

  it('exports P0 enum value sets used by domain state machines', () => {
    expect(project_repo_status_values).toEqual(['active', 'paused', 'archived']);
    expect(work_item_phase_values).toEqual(['draft', 'triage', 'spec', 'plan', 'execution', 'done']);
    expect(work_item_kind_values).toEqual(['requirement', 'bug', 'tech_debt']);
    expect(spec_plan_status_values).toEqual(['draft', 'in_review', 'approved']);
    expect(spec_plan_gate_state_values).toEqual([
      'not_submitted',
      'awaiting_approval',
      'approved',
      'changes_requested',
    ]);
    expect(execution_package_phase_values).toEqual(['draft', 'ready', 'queued', 'execution', 'review']);
    expect(execution_package_activity_state_values).not.toContain('awaiting_ai');
    expect(execution_package_gate_state_values).not.toContain('none');
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
    expect(review_packet_status_values).toEqual(['ready', 'in_review', 'completed', 'archived']);
    expect(review_packet_decision_values).toEqual(['none', 'approved', 'changes_requested']);
    expect(trace_link_relationship_values).toEqual([
      'belongs_to',
      'generated_by',
      'supports',
      'supersedes',
      'replaces',
      'redacted_from',
    ]);
  });

  it('uses JSONB for representative structured P0 fields', () => {
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
    expect(columnType(execution_packages, 'required_checks')).toBe('PgJsonb');
    expect(columnType(execution_packages, 'required_test_gates')).toBe('PgJsonb');
    expect(columnType(release_evidences, 'object_ref')).toBe('PgJsonb');
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
