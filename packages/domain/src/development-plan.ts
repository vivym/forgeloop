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

export type DevelopmentPlanGenerationState = 'draft_generated' | 'draft_regenerated';

export interface DevelopmentPlanRevisionItemRef {
  id: string;
  revision_id: string;
  title: string;
  boundary_status: DevelopmentPlanItem['boundary_status'];
  spec_status: DevelopmentPlanItem['spec_status'];
  execution_plan_status: DevelopmentPlanItem['execution_plan_status'];
  execution_status: DevelopmentPlanItem['execution_status'];
}

export interface DevelopmentPlanRevision {
  id: string;
  development_plan_id: string;
  revision_number: number;
  title: string;
  status: DevelopmentPlan['status'];
  source_refs: SourceObjectRef[];
  item_refs: DevelopmentPlanRevisionItemRef[];
  generation_state?: DevelopmentPlanGenerationState;
  change_reason: string;
  actor_id?: string;
  created_at: IsoDateTime;
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
  | 'spec_revision_not_approved_revision'
  | 'qa_test_owner_missing'
  | 'testability_note_missing'
  | 'acceptance_criteria_missing'
  | 'test_strategy_summary_missing';

export function canGenerateSpecFromPlanItem(input: {
  item: DevelopmentPlanItem;
  brainstormingSession?: { approval_state: string };
  boundarySummary?: { approved_by_actor_id?: string; approved_at?: string };
  boundarySummaryRevision?: { status: string };
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
  if (input.boundarySummaryRevision?.status !== 'approved') {
    return { ok: false, reason: 'boundary_summary_missing_approval' };
  }
  return { ok: true };
}

export function canGenerateExecutionPlanFromApprovedSpec(input: {
  item?: Pick<DevelopmentPlanItem, 'risk' | 'release_impact' | 'affected_surfaces'>;
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
  if (requiresQaTestStrategy(input.item)) {
    if (!hasText(input.specRevision.qa_owner_actor_id) && !hasText(input.specRevision.test_owner_actor_id)) {
      return { ok: false, reason: 'qa_test_owner_missing' };
    }
    if (!hasText(input.specRevision.testability_note)) {
      return { ok: false, reason: 'testability_note_missing' };
    }
    if (!hasListItems(input.specRevision.acceptance_criteria)) {
      return { ok: false, reason: 'acceptance_criteria_missing' };
    }
    if (!hasText(input.specRevision.test_strategy_summary)) {
      return { ok: false, reason: 'test_strategy_summary_missing' };
    }
  }
  return { ok: true };
}

export function requiresQaTestStrategy(
  item: Pick<DevelopmentPlanItem, 'risk' | 'release_impact' | 'affected_surfaces'> | undefined,
): boolean {
  if (item === undefined) return false;
  const risk = item.risk?.toLowerCase();
  return (
    risk === 'medium' ||
    risk === 'high' ||
    risk === 'critical' ||
    item.release_impact === 'release_scoped' ||
    item.release_impact === 'release_blocking' ||
    item.affected_surfaces.length > 1
  );
}

export function hasText(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function hasListItems(values: readonly string[] | undefined): boolean {
  return values !== undefined && values.some((value) => value.trim().length > 0);
}
