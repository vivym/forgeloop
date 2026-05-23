import { describe, expect, it } from 'vitest';
import type { Spec, SpecRevision } from '@forgeloop/domain';
import {
  canGenerateExecutionPlanFromApprovedSpec,
  canStartExecutionFromApprovedExecutionPlan,
  type ExecutionPlanDocument,
  type ExecutionPlanRevision,
} from '@forgeloop/domain';

const at = '2026-05-24T00:00:00.000Z';

const approvedSpec = (overrides: Partial<Spec> = {}): Spec => ({
  id: 'spec-1',
  work_item_id: 'requirement-1',
  entity_type: 'spec',
  status: 'approved',
  editing_state: 'idle',
  gate_state: 'approved',
  resolution: 'approved',
  current_revision_id: 'spec-revision-1',
  approved_revision_id: 'spec-revision-1',
  approved_at: at,
  approved_by_actor_id: 'actor-tech-lead',
  created_at: at,
  updated_at: at,
  ...overrides,
});

const specRevision = (overrides: Partial<SpecRevision> = {}): SpecRevision => ({
  id: 'spec-revision-1',
  spec_id: 'spec-1',
  work_item_id: 'requirement-1',
  revision_number: 1,
  summary: 'Approved spec',
  content: 'Approved spec body',
  background: 'Background',
  goals: ['Generate an execution plan'],
  scope_in: ['Execution planning'],
  scope_out: [],
  acceptance_criteria: ['Execution Plan is generated only from loaded approved SpecRevision'],
  risk_notes: [],
  test_strategy_summary: 'Domain gates',
  artifact_refs: [],
  created_at: at,
  ...overrides,
});

const approvedExecutionPlan = (overrides: Partial<ExecutionPlanDocument> = {}): ExecutionPlanDocument => ({
  id: 'execution-plan-1',
  development_plan_item_id: 'development-plan-item-1',
  status: 'approved',
  current_revision_id: 'execution-plan-revision-1',
  approved_revision_id: 'execution-plan-revision-1',
  approved_by_actor_id: 'actor-tech-lead',
  approved_at: at,
  created_at: at,
  updated_at: at,
  ...overrides,
});

const executionPlanRevision = (overrides: Partial<ExecutionPlanRevision> = {}): ExecutionPlanRevision => ({
  id: 'execution-plan-revision-1',
  execution_plan_id: 'execution-plan-1',
  development_plan_item_id: 'development-plan-item-1',
  based_on_spec_revision_id: 'spec-revision-1',
  revision_number: 1,
  summary: 'Approved execution plan',
  content: 'Execution plan body',
  created_at: at,
  ...overrides,
});

describe('AI-native planning gate helpers', () => {
  it('requires the approved SpecRevision to be loaded before Execution Plan generation', () => {
    expect(canGenerateExecutionPlanFromApprovedSpec({ spec: approvedSpec() })).toEqual({
      ok: false,
      reason: 'approved_spec_revision_not_loaded',
    });
    expect(
      canGenerateExecutionPlanFromApprovedSpec({
        spec: approvedSpec(),
        specRevision: specRevision(),
      }),
    ).toEqual({ ok: true });
  });

  it('requires the approved ExecutionPlanRevision to be loaded before execution starts', () => {
    expect(canStartExecutionFromApprovedExecutionPlan({ executionPlan: approvedExecutionPlan() })).toEqual({
      ok: false,
      reason: 'approved_execution_plan_revision_not_loaded',
    });
    expect(
      canStartExecutionFromApprovedExecutionPlan({
        executionPlan: approvedExecutionPlan(),
        executionPlanRevision: executionPlanRevision(),
      }),
    ).toEqual({ ok: true });
  });
});
