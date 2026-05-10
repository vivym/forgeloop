import { pgEnum, timestamp } from 'drizzle-orm/pg-core';

export const project_repo_status_values = ['active', 'paused', 'archived'] as const;

export const work_item_phase_values = [
  'draft',
  'triage',
  'spec',
  'plan',
  'execution',
  'release',
  'observing',
  'done',
  'closed',
] as const;
export const work_item_kind_values = ['requirement', 'bug', 'tech_debt'] as const;
export const work_item_activity_state_values = ['idle', 'awaiting_ai'] as const;
export const work_item_gate_state_values = [
  'none',
  'awaiting_spec_approval',
  'spec_changes_requested',
  'awaiting_plan_approval',
  'plan_changes_requested',
] as const;
export const work_item_resolution_values = ['none', 'completed'] as const;

export const spec_plan_status_values = ['draft', 'in_review', 'approved', 'rejected', 'superseded', 'archived'] as const;
export const spec_plan_editing_state_values = ['idle', 'ai_drafting', 'human_editing', 'co_editing'] as const;
export const spec_plan_gate_state_values = [
  'not_submitted',
  'awaiting_approval',
  'approved',
  'changes_requested',
] as const;
export const spec_plan_resolution_values = ['none', 'approved', 'rejected', 'superseded'] as const;

export const execution_package_phase_values = [
  'draft',
  'ready',
  'queued',
  'execution',
  'review',
  'integration',
  'test_gate',
  'release',
  'archived',
] as const;
export const execution_package_activity_state_values = [
  'idle',
  'ai_running',
  'ai_retrying',
  'human_editing',
  'awaiting_human',
  'human_reviewing',
  'blocked',
  'handover',
] as const;
export const execution_package_gate_state_values = [
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
] as const;
export const execution_package_resolution_values = ['none', 'completed', 'cancelled', 'rolled_back', 'superseded'] as const;

export const run_session_status_values = [
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
] as const;
export const review_packet_status_values = ['draft', 'ready', 'in_review', 'completed', 'escalated', 'archived'] as const;
export const review_packet_decision_values = [
  'none',
  'approved',
  'changes_requested',
  'need_more_context',
  'escalate',
] as const;
export const decision_outcome_values = [
  'approved',
  'changes_requested',
  'rejected',
  'override_approved',
  'rolled_back',
  'cancelled',
  'completed',
] as const;
export const decision_values = decision_outcome_values;
export const actor_type_values = ['human', 'system', 'ai'] as const;
export const release_phase_values = ['draft', 'candidate', 'approval', 'rollout', 'observing', 'completed', 'closed'] as const;
export const release_activity_state_values = [
  'idle',
  'awaiting_human',
  'human_in_progress',
  'rolling_out',
  'paused',
  'blocked',
] as const;
export const release_gate_state_values = [
  'not_submitted',
  'awaiting_approval',
  'changes_requested',
  'approved',
  'rollout_failed',
  'rollout_succeeded',
] as const;
export const release_resolution_values = ['none', 'completed', 'rolled_back', 'cancelled'] as const;
export const release_type_values = ['normal', 'hotfix', 'emergency', 'gray'] as const;
export const release_evidence_type_values = [
  'test_report',
  'review_packet',
  'build',
  'deployment',
  'metric_snapshot',
  'rollback_record',
  'observation_note',
] as const;
export const release_evidence_status_values = ['current', 'stale', 'superseded'] as const;
export const trace_link_relationship_values = [
  'belongs_to',
  'generated_by',
  'supports',
  'supersedes',
  'replaces',
  'redacted_from',
] as const;

export const projectRepoStatus = pgEnum('project_repo_status', project_repo_status_values);
export const workItemPhase = pgEnum('work_item_phase', work_item_phase_values);
export const workItemKind = pgEnum('work_item_kind', work_item_kind_values);
export const workItemActivityState = pgEnum('work_item_activity_state', work_item_activity_state_values);
export const workItemGateState = pgEnum('work_item_gate_state', work_item_gate_state_values);
export const workItemResolution = pgEnum('work_item_resolution', work_item_resolution_values);
export const specPlanStatus = pgEnum('spec_plan_status', spec_plan_status_values);
export const specPlanEditingState = pgEnum('spec_plan_editing_state', spec_plan_editing_state_values);
export const specPlanGateState = pgEnum('spec_plan_gate_state', spec_plan_gate_state_values);
export const specPlanResolution = pgEnum('spec_plan_resolution', spec_plan_resolution_values);
export const executionPackagePhase = pgEnum('execution_package_phase', execution_package_phase_values);
export const executionPackageActivityState = pgEnum(
  'execution_package_activity_state',
  execution_package_activity_state_values,
);
export const executionPackageGateState = pgEnum('execution_package_gate_state', execution_package_gate_state_values);
export const executionPackageResolution = pgEnum('execution_package_resolution', execution_package_resolution_values);
export const runSessionStatus = pgEnum('run_session_status', run_session_status_values);
export const reviewPacketStatus = pgEnum('review_packet_status', review_packet_status_values);
export const reviewPacketDecision = pgEnum('review_packet_decision', review_packet_decision_values);
export const decisionValue = pgEnum('decision_value', decision_values);
export const decisionOutcome = pgEnum('decision_outcome', decision_outcome_values);
export const actorType = pgEnum('actor_type', actor_type_values);
export const releasePhase = pgEnum('release_phase', release_phase_values);
export const releaseActivityState = pgEnum('release_activity_state', release_activity_state_values);
export const releaseGateState = pgEnum('release_gate_state', release_gate_state_values);
export const releaseResolution = pgEnum('release_resolution', release_resolution_values);
export const releaseType = pgEnum('release_type', release_type_values);
export const releaseEvidenceType = pgEnum('release_evidence_type', release_evidence_type_values);
export const releaseEvidenceStatus = pgEnum('release_evidence_status', release_evidence_status_values);
export const traceLinkRelationship = pgEnum('trace_link_relationship', trace_link_relationship_values);

export const timestampColumn = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
