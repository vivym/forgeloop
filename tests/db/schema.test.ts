import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  decisions,
  execution_package_dependencies,
  execution_package_activity_state_values,
  execution_package_gate_state_values,
  execution_package_phase_values,
  execution_packages,
  object_events,
  project_repo_status_values,
  project_repos,
  projects,
  review_packet_decision_values,
  review_packet_status_values,
  review_packets,
  run_session_status_values,
  run_sessions,
  spec_plan_gate_state_values,
  spec_plan_status_values,
  spec_revisions,
  specs,
  status_histories,
  plan_revisions,
  plans,
  artifacts,
  work_item_phase_values,
  work_items,
} from '../../packages/db/src/index';

type TableLike = Parameters<typeof getTableColumns>[0];

const requiredTables = {
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
  review_packets,
  object_events,
  status_histories,
  artifacts,
  decisions,
};

const columnType = (table: TableLike, columnName: string) => {
  const column = getTableColumns(table)[columnName];
  if (column === undefined) {
    throw new Error(`Missing column ${columnName}`);
  }

  return (column as { columnType: string }).columnType;
};

describe('P0 Drizzle schema', () => {
  it('exports every required P0 table', () => {
    expect(Object.keys(requiredTables).sort()).toEqual(
      [
        'artifacts',
        'decisions',
        'execution_package_dependencies',
        'execution_packages',
        'object_events',
        'plan_revisions',
        'plans',
        'project_repos',
        'projects',
        'review_packets',
        'run_sessions',
        'spec_revisions',
        'specs',
        'status_histories',
        'work_items',
      ].sort(),
    );

    for (const table of Object.values(requiredTables)) {
      expect(table).toBeDefined();
    }
  });

  it('exports P0 enum value sets used by domain state machines', () => {
    expect(project_repo_status_values).toEqual(['active', 'paused', 'archived']);
    expect(work_item_phase_values).toEqual(['draft', 'triage', 'spec', 'plan', 'execution', 'done']);
    expect(spec_plan_status_values).toEqual(['draft', 'in_review', 'approved']);
    expect(spec_plan_gate_state_values).toEqual([
      'not_submitted',
      'awaiting_approval',
      'approved',
      'changes_requested',
    ]);
    expect(execution_package_phase_values).toEqual(['draft', 'ready', 'queued', 'execution', 'review']);
    expect(execution_package_activity_state_values).toEqual([
      'idle',
      'awaiting_ai',
      'ai_running',
      'blocked',
      'awaiting_human',
    ]);
    expect(execution_package_gate_state_values).toEqual([
      'none',
      'not_submitted',
      'awaiting_human_review',
      'review_approved',
      'changes_requested',
    ]);
    expect(run_session_status_values).toEqual(['queued', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled']);
    expect(review_packet_status_values).toEqual(['ready', 'in_review', 'completed', 'archived']);
    expect(review_packet_decision_values).toEqual(['none', 'approved', 'changes_requested']);
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
    expect(columnType(run_sessions, 'changedFiles')).toBe('PgJsonb');
    expect(columnType(run_sessions, 'checkResults')).toBe('PgJsonb');
    expect(columnType(run_sessions, 'artifacts')).toBe('PgJsonb');
    expect(columnType(review_packets, 'changedFiles')).toBe('PgJsonb');
    expect(columnType(review_packets, 'selfReview')).toBe('PgJsonb');
    expect(columnType(review_packets, 'riskNotes')).toBe('PgJsonb');
    expect(columnType(review_packets, 'requestedChanges')).toBe('PgJsonb');
    expect(columnType(object_events, 'metadata')).toBe('PgJsonb');
  });

  it('includes future artifact trace subject link columns', () => {
    expect(columnType(artifacts, 'traceSubjectType')).toBe('PgText');
    expect(columnType(artifacts, 'traceSubjectId')).toBe('PgText');
  });
});
