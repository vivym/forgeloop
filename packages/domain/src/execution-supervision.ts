import type {
  CodeReviewAuditedException,
  CodeReviewHandoff as ContractCodeReviewHandoff,
  Execution as ContractExecution,
  QaHandoff as ContractQaHandoff,
  ProductObjectRef,
} from '@forgeloop/contracts';
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

export interface CodeReviewHandoff extends ContractCodeReviewHandoff {
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface QaHandoff extends ContractQaHandoff {
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export type TrustedHumanReviewActorClass = 'human' | 'human_admin';

export function isTrustedHumanReviewActorClass(actorClass: string | undefined): actorClass is TrustedHumanReviewActorClass {
  return actorClass === 'human' || actorClass === 'human_admin';
}

export function codeReviewReadyGate(input: {
  execution: Execution;
  changedSurfaces: string[];
  verificationEvidenceRefs: ProductObjectRef[];
}): GateResult<'execution_not_completed' | 'changed_surfaces_missing' | 'verification_evidence_missing'> {
  if (input.execution.status !== 'completed') {
    return { ok: false, reason: 'execution_not_completed' };
  }
  if (input.changedSurfaces.length === 0) {
    return { ok: false, reason: 'changed_surfaces_missing' };
  }
  if (input.verificationEvidenceRefs.length === 0) {
    return { ok: false, reason: 'verification_evidence_missing' };
  }
  return { ok: true };
}

export function canCreateQaHandoff(input: {
  codeReviewHandoff: CodeReviewHandoff;
}): GateResult<'code_review_not_approved'> {
  if (input.codeReviewHandoff.status === 'approved' || input.codeReviewHandoff.audited_exception !== undefined) {
    return { ok: true };
  }
  return { ok: false, reason: 'code_review_not_approved' };
}

export function auditedExceptionAllowsQaPreparation(input: {
  auditedException?: CodeReviewAuditedException;
  qaStatus?: QaHandoff['status'];
}): boolean {
  return input.auditedException !== undefined && input.qaStatus !== 'accepted';
}

export type ExecutionStartGateReason =
  | 'execution_plan_not_approved'
  | 'approved_execution_plan_revision_missing'
  | 'approved_execution_plan_revision_not_loaded'
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
  if (input.executionPlanRevision === undefined) {
    return { ok: false, reason: 'approved_execution_plan_revision_not_loaded' };
  }
  if (input.executionPlanRevision.id !== input.executionPlan.approved_revision_id) {
    return { ok: false, reason: 'execution_plan_revision_not_approved_revision' };
  }
  return { ok: true };
}
