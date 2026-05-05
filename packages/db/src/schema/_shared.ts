import { pgEnum, timestamp } from 'drizzle-orm/pg-core';

export const project_repo_status_values = ['active', 'paused', 'archived'] as const;

export const work_item_phase_values = ['draft', 'triage', 'spec', 'plan', 'execution', 'done'] as const;
export const work_item_kind_values = ['feature', 'bugfix', 'tech_debt', 'test_refactor'] as const;
export const work_item_activity_state_values = ['idle'] as const;
export const work_item_gate_state_values = [
  'none',
  'awaiting_spec_approval',
  'spec_changes_requested',
  'awaiting_plan_approval',
  'plan_changes_requested',
] as const;
export const work_item_resolution_values = ['none', 'completed'] as const;

export const spec_plan_status_values = ['draft', 'in_review', 'approved'] as const;
export const spec_plan_editing_state_values = ['idle', 'ai_drafting'] as const;
export const spec_plan_gate_state_values = [
  'not_submitted',
  'awaiting_approval',
  'approved',
  'changes_requested',
] as const;
export const spec_plan_resolution_values = ['none', 'approved'] as const;

export const execution_package_phase_values = ['draft', 'ready', 'queued', 'execution', 'review'] as const;
export const execution_package_activity_state_values = [
  'idle',
  'awaiting_ai',
  'ai_running',
  'blocked',
  'awaiting_human',
] as const;
export const execution_package_gate_state_values = [
  'none',
  'not_submitted',
  'awaiting_human_review',
  'review_approved',
  'changes_requested',
] as const;
export const execution_package_resolution_values = ['none', 'completed'] as const;

export const run_session_status_values = ['queued', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled'] as const;
export const review_packet_status_values = ['ready', 'in_review', 'completed', 'archived'] as const;
export const review_packet_decision_values = ['none', 'approved', 'changes_requested'] as const;
export const decision_values = ['approved', 'changes_requested'] as const;

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

export const timestampColumn = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
