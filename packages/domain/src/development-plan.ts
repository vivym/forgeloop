import type {
  ContextManifest as ContractContextManifest,
  DevelopmentPlan as ContractDevelopmentPlan,
  DevelopmentPlanItem as ContractDevelopmentPlanItem,
  SourceObjectRef,
} from '@forgeloop/contracts';
import type { IsoDateTime, Spec, SpecRevision } from './types.js';

export type GateResult<Reason extends string = string> = { ok: true } | { ok: false; reason: Reason };

export interface ContextManifest extends ContractContextManifest {
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface DevelopmentPlanItem extends ContractDevelopmentPlanItem {
  source_ref: SourceObjectRef;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface DevelopmentPlan extends Omit<ContractDevelopmentPlan, 'items'> {
  project_id: string;
  items: DevelopmentPlanItem[];
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface DevelopmentPlanSourceLink {
  id: string;
  development_plan_id: string;
  source_ref: SourceObjectRef;
  link_type: 'primary' | 'related';
  rationale?: string;
  created_by_actor_id?: string;
  created_at: IsoDateTime;
}

export interface DevelopmentPlanItemRevision {
  id: string;
  development_plan_item_id: string;
  development_plan_id: string;
  revision_number: number;
  snapshot: DevelopmentPlanItem;
  change_reason: string;
  edited_by_actor_id?: string;
  created_at: IsoDateTime;
}

export interface RevisionCompareQuery {
  base_revision_id: string;
  compare_revision_id: string;
}

export interface StructuredRevisionDiff {
  base_revision_id: string;
  compare_revision_id: string;
  changed_fields: string[];
  base_snapshot?: Record<string, unknown>;
  compare_snapshot?: Record<string, unknown>;
}

export type SpecGenerationGateReason =
  | 'boundary_not_approved'
  | 'brainstorming_not_approved'
  | 'boundary_summary_missing_approval';

export type ExecutionPlanGenerationGateReason =
  | 'spec_not_approved'
  | 'approved_spec_revision_missing'
  | 'approved_spec_revision_not_loaded'
  | 'spec_revision_not_approved_revision';

export function canGenerateSpecFromPlanItem(input: {
  item: DevelopmentPlanItem;
  brainstormingSession?: { approval_state: string };
  boundarySummary?: { approved_by_actor_id?: string; approved_at?: string };
}): GateResult<SpecGenerationGateReason> {
  if (input.item.boundary_status !== 'approved') {
    return { ok: false, reason: 'boundary_not_approved' };
  }
  if (input.brainstormingSession?.approval_state !== 'approved') {
    return { ok: false, reason: 'brainstorming_not_approved' };
  }
  if (input.boundarySummary?.approved_by_actor_id === undefined || input.boundarySummary.approved_at === undefined) {
    return { ok: false, reason: 'boundary_summary_missing_approval' };
  }
  return { ok: true };
}

export function canGenerateExecutionPlanFromApprovedSpec(input: {
  spec: Spec;
  specRevision?: SpecRevision;
}): GateResult<ExecutionPlanGenerationGateReason> {
  if (input.spec.status !== 'approved' || input.spec.gate_state !== 'approved' || input.spec.resolution !== 'approved') {
    return { ok: false, reason: 'spec_not_approved' };
  }
  if (input.spec.approved_revision_id === undefined) {
    return { ok: false, reason: 'approved_spec_revision_missing' };
  }
  if (input.specRevision === undefined) {
    return { ok: false, reason: 'approved_spec_revision_not_loaded' };
  }
  if (input.specRevision.id !== input.spec.approved_revision_id) {
    return { ok: false, reason: 'spec_revision_not_approved_revision' };
  }
  return { ok: true };
}
