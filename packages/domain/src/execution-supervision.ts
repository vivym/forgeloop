import type {
  CodeReviewAuditedException,
  CodeReviewHandoff as ContractCodeReviewHandoff,
  Execution as ContractExecution,
  QaHandoff as ContractQaHandoff,
  ProductObjectRef,
} from '@forgeloop/contracts';
import { canGenerateExecutionPlanFromApprovedSpec, hasText, type DevelopmentPlanItem, type GateResult } from './development-plan.js';
import type { ExecutionPackage, IsoDateTime, Spec, SpecRevision } from './types.js';

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
  implementation_plan_revision_id: string;
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
  | 'boundary_not_approved'
  | 'spec_not_approved'
  | 'approved_spec_revision_missing'
  | 'approved_spec_revision_not_loaded'
  | 'spec_revision_not_approved_revision'
  | 'qa_test_owner_missing'
  | 'testability_note_missing'
  | 'acceptance_criteria_missing'
  | 'test_strategy_summary_missing'
  | 'implementation_plan_not_approved'
  | 'approved_implementation_plan_revision_missing'
  | 'approved_implementation_plan_revision_not_loaded'
  | 'implementation_plan_revision_not_approved_revision'
  | 'execution_package_boundary_missing'
  | 'execution_package_not_runnable'
  | 'execution_package_scope_mismatch'
  | 'execution_package_policy_missing';

export function canStartExecutionFromApprovedExecutionPlan(input: {
  item?: Pick<DevelopmentPlanItem, 'id' | 'boundary_status' | 'spec_status' | 'implementation_plan_status' | 'risk' | 'release_impact' | 'affected_surfaces'>;
  spec?: Spec;
  specRevision?: SpecRevision;
  executionPlan: ExecutionPlanDocument;
  executionPlanRevision?: ExecutionPlanRevision;
  executionPackage?: Pick<
    ExecutionPackage,
    | 'development_plan_item_id'
    | 'execution_plan_id'
    | 'execution_plan_revision_id'
    | 'spec_revision_id'
    | 'phase'
    | 'activity_state'
    | 'gate_state'
    | 'required_checks'
    | 'allowed_paths'
    | 'qa_owner_actor_id'
  >;
}): GateResult<ExecutionStartGateReason> {
  if (input.item !== undefined && input.item.boundary_status !== 'approved') {
    return { ok: false, reason: 'boundary_not_approved' };
  }
  if (input.spec !== undefined) {
    const specGate = canGenerateExecutionPlanFromApprovedSpec({
      ...(input.item === undefined ? {} : { item: input.item }),
      spec: input.spec,
      ...(input.specRevision === undefined ? {} : { specRevision: input.specRevision }),
    });
    if (!specGate.ok) {
      return { ok: false, reason: specGate.reason };
    }
  } else if (input.item !== undefined && input.item.spec_status !== 'approved') {
    return { ok: false, reason: 'spec_not_approved' };
  }
  if (input.executionPlan.status !== 'approved' || input.executionPlan.approved_by_actor_id === undefined) {
    return { ok: false, reason: 'implementation_plan_not_approved' };
  }
  if (input.executionPlan.approved_revision_id === undefined) {
    return { ok: false, reason: 'approved_implementation_plan_revision_missing' };
  }
  if (input.executionPlanRevision === undefined) {
    return { ok: false, reason: 'approved_implementation_plan_revision_not_loaded' };
  }
  if (input.executionPlanRevision.id !== input.executionPlan.approved_revision_id) {
    return { ok: false, reason: 'implementation_plan_revision_not_approved_revision' };
  }
  if (input.executionPackage !== undefined) {
    if (
      input.executionPackage.development_plan_item_id !== input.executionPlan.development_plan_item_id ||
      input.executionPackage.execution_plan_id !== input.executionPlan.id ||
      input.executionPackage.execution_plan_revision_id !== input.executionPlanRevision.id ||
      (input.specRevision !== undefined && input.executionPackage.spec_revision_id !== input.specRevision.id)
    ) {
      return { ok: false, reason: 'execution_package_scope_mismatch' };
    }
    if (
      input.executionPackage.phase !== 'ready' ||
      input.executionPackage.activity_state !== 'idle' ||
      input.executionPackage.gate_state !== 'not_submitted'
    ) {
      return { ok: false, reason: 'execution_package_not_runnable' };
    }
    if (
      input.executionPackage.required_checks.length === 0 ||
      input.executionPackage.allowed_paths.length === 0 ||
      !hasText(input.executionPackage.qa_owner_actor_id)
    ) {
      return { ok: false, reason: 'execution_package_policy_missing' };
    }
  } else if (input.item !== undefined || input.spec !== undefined) {
    return { ok: false, reason: 'execution_package_boundary_missing' };
  }
  return { ok: true };
}
