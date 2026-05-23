import type { Execution as ContractExecution } from '@forgeloop/contracts';
import type { GateResult } from './development-plan.js';
import type { IsoDateTime } from './types.js';

export interface ExecutionPlanDocument {
  id: string;
  development_plan_item_id: string;
  status: 'draft' | 'in_review' | 'approved' | 'changes_requested' | 'stale' | 'blocked';
  current_revision_id?: string;
  approved_revision_id?: string;
  approved_by_actor_id?: string;
  approved_at?: IsoDateTime;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface ExecutionPlanRevision {
  id: string;
  execution_plan_id: string;
  development_plan_item_id: string;
  based_on_spec_revision_id: string;
  revision_number: number;
  summary: string;
  content: string;
  structured_document?: Record<string, unknown>;
  author_actor_id?: string;
  created_at: IsoDateTime;
}

export interface Execution extends ContractExecution {
  development_plan_item_id: string;
  execution_plan_revision_id: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export type ExecutionStartGateReason =
  | 'execution_plan_not_approved'
  | 'approved_execution_plan_revision_missing'
  | 'execution_plan_revision_not_approved_revision';

export function canStartExecutionFromApprovedExecutionPlan(input: {
  executionPlan: ExecutionPlanDocument;
  executionPlanRevision?: ExecutionPlanRevision;
}): GateResult<ExecutionStartGateReason> {
  if (input.executionPlan.status !== 'approved' || input.executionPlan.approved_by_actor_id === undefined) {
    return { ok: false, reason: 'execution_plan_not_approved' };
  }
  if (input.executionPlan.approved_revision_id === undefined) {
    return { ok: false, reason: 'approved_execution_plan_revision_missing' };
  }
  if (
    input.executionPlanRevision !== undefined &&
    input.executionPlanRevision.id !== input.executionPlan.approved_revision_id
  ) {
    return { ok: false, reason: 'execution_plan_revision_not_approved_revision' };
  }
  return { ok: true };
}
