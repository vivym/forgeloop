import type { ProductPageViewModel, ViewModelGate, ViewModelMetadata } from '../product-surfaces/view-model-types';

type ProductRef = { type?: string; id?: string; title?: string };

interface DevelopmentPlanProjection {
  id: string;
  title?: string;
  status?: string;
  source_refs?: readonly ProductRef[];
  items?: readonly DevelopmentPlanItemProjection[];
  item_count?: number;
  blocked_count?: number;
  updated_at?: string;
}

interface DevelopmentPlanItemProjection {
  id: string;
  title?: string;
  summary?: string;
  responsible_role?: string;
  driver_actor_id?: string;
  reviewer_actor_id?: string;
  risk?: string;
  dependency_hints?: readonly string[];
  affected_surfaces?: readonly string[];
  boundary_status?: string;
  spec_status?: string;
  execution_plan_status?: string;
  execution_status?: string;
  review_status?: string;
  qa_handoff_status?: string;
  release_impact?: string;
  next_action?: string;
  updated_at?: string;
}

export type DevelopmentPlanColumnKey =
  | 'planItem'
  | 'role'
  | 'driver'
  | 'reviewer'
  | 'risk'
  | 'dependencyHints'
  | 'affectedSurface'
  | 'boundary'
  | 'spec'
  | 'executionPlan'
  | 'execution'
  | 'review'
  | 'qa'
  | 'releaseImpact'
  | 'currentGate'
  | 'gateProgress'
  | 'qaReviewSummary'
  | 'nextAction';

export type DevelopmentPlanColumnBreakpoint = 'desktop' | 'tablet' | 'mobile';

export interface DevelopmentPlanColumnDefinition {
  key: DevelopmentPlanColumnKey;
  label: string;
  priority: number;
}

export const developmentPlanPlanningColumns: readonly DevelopmentPlanColumnDefinition[] = [
  { key: 'planItem', label: 'Plan Item', priority: 1 },
  { key: 'role', label: 'Role', priority: 2 },
  { key: 'driver', label: 'Driver', priority: 11 },
  { key: 'reviewer', label: 'Reviewer', priority: 12 },
  { key: 'risk', label: 'Risk', priority: 3 },
  { key: 'dependencyHints', label: 'Dependency hints', priority: 13 },
  { key: 'affectedSurface', label: 'Affected surface', priority: 14 },
  { key: 'boundary', label: 'Boundary', priority: 4 },
  { key: 'spec', label: 'Spec', priority: 5 },
  { key: 'executionPlan', label: 'Execution Plan', priority: 6 },
  { key: 'execution', label: 'Execution', priority: 7 },
  { key: 'review', label: 'Review', priority: 8 },
  { key: 'qa', label: 'QA', priority: 9 },
  { key: 'releaseImpact', label: 'Release impact', priority: 10 },
  { key: 'currentGate', label: 'Current gate', priority: 4 },
  { key: 'gateProgress', label: 'Gate progress', priority: 5 },
  { key: 'qaReviewSummary', label: 'QA / Review', priority: 8 },
  { key: 'nextAction', label: 'Next action', priority: 1 },
];

export const developmentPlanColumnPriorityByBreakpoint: Record<DevelopmentPlanColumnBreakpoint, readonly DevelopmentPlanColumnKey[]> = {
  desktop: ['planItem', 'role', 'risk', 'boundary', 'spec', 'executionPlan', 'execution', 'review', 'qa', 'releaseImpact', 'nextAction'],
  tablet: ['planItem', 'role', 'risk', 'currentGate', 'gateProgress', 'execution', 'qaReviewSummary', 'nextAction'],
  mobile: ['planItem', 'risk', 'currentGate', 'gateProgress', 'nextAction'],
};

export function developmentPlanViewModel(plan: DevelopmentPlanProjection): ProductPageViewModel {
  const itemCount = plan.items?.length ?? plan.item_count ?? 0;
  const blockedCount = plan.blocked_count ?? (plan.items ?? []).filter((item) => gateText(item).includes('blocked')).length;

  return {
    objectLabel: plan.title ?? plan.id,
    objectType: 'Development Plan',
    currentState: plan.status ?? 'Status unavailable',
    nextAction: itemCount === 0 ? 'Add Development Plan Items' : 'Review Development Plan Items',
    disabledReason: undefined,
    primaryActorOrRole: 'Product and technical owner',
    riskSignal: blockedCount === 0 ? 'No blocked item signal' : `${blockedCount} blocked item(s)`,
    gateProgress: [
      { label: 'Source links', state: (plan.source_refs?.length ?? 0) === 0 ? 'unavailable' : 'linked' },
      { label: 'Development Plan Items', state: itemCount === 0 ? 'missing' : 'available' },
    ],
    criticalEvidence: [
      {
        label: 'Source context',
        state: (plan.source_refs?.length ?? 0) === 0 ? 'unavailable' : 'available',
        compactText: sourceSummary(plan),
      },
    ],
    secondaryMetadata: [
      { label: 'Items', value: String(itemCount) },
      { label: 'Blocked', value: String(blockedCount) },
    ],
    previewSummary: sourceSummary(plan),
    timelineSummary: plan.updated_at === undefined ? 'Timeline unavailable' : `Updated ${plan.updated_at}`,
  };
}

export function developmentPlanItemViewModel(item: DevelopmentPlanItemProjection): ProductPageViewModel {
  return {
    objectLabel: item.title ?? item.id,
    objectType: 'Development Plan Item',
    currentState: item.execution_status ?? item.spec_status ?? item.boundary_status ?? 'Status unavailable',
    nextAction: item.next_action ?? nextGateAction(item),
    disabledReason: undefined,
    primaryActorOrRole: item.responsible_role ?? item.driver_actor_id ?? 'Unassigned',
    riskSignal: riskLabel(item.risk),
    gateProgress: itemGateProgress(item),
    criticalEvidence: [
      {
        label: 'Gate evidence',
        state: gateText(item).includes('missing') ? 'unavailable' : 'available',
        compactText: gateText(item) || 'Gate status unavailable',
      },
    ],
    secondaryMetadata: itemMetadata(item),
    previewSummary: item.summary ?? item.next_action ?? 'Development Plan Item summary unavailable',
    timelineSummary: item.updated_at === undefined ? 'Timeline unavailable' : `Updated ${item.updated_at}`,
  };
}

export function itemGateProgress(item: DevelopmentPlanItemProjection): ViewModelGate[] {
  return [
    { label: 'Boundary', state: item.boundary_status ?? 'unavailable' },
    { label: 'Spec', state: item.spec_status ?? 'unavailable' },
    { label: 'Execution Plan', state: item.execution_plan_status ?? 'unavailable' },
    { label: 'Execution', state: item.execution_status ?? 'unavailable' },
    { label: 'Review', state: item.review_status ?? 'unavailable' },
    { label: 'QA handoff', state: item.qa_handoff_status ?? 'unavailable' },
  ];
}

export function currentPlanItemGate(item: DevelopmentPlanItemProjection): ViewModelGate {
  return itemGateProgress(item).find((gate) => !isCompleteGateState(gate.state)) ?? { label: 'Release', state: item.release_impact ?? 'ready' };
}

export function gateProgressSummary(item: DevelopmentPlanItemProjection): string {
  const gates = itemGateProgress(item);
  const completed = gates.filter((gate) => isCompleteGateState(gate.state)).length;
  return `${completed}/${gates.length} gates complete`;
}

export function qaReviewSummary(item: DevelopmentPlanItemProjection): string {
  return `Review ${item.review_status ?? 'unavailable'} · QA ${item.qa_handoff_status ?? 'unavailable'}`;
}

function itemMetadata(item: DevelopmentPlanItemProjection): ViewModelMetadata[] {
  return [
    { label: 'Driver', value: item.driver_actor_id ?? 'Unassigned' },
    { label: 'Reviewer', value: item.reviewer_actor_id ?? 'Unassigned' },
    { label: 'Dependency hints', value: summarizeList(item.dependency_hints) },
    { label: 'Affected surface', value: summarizeList(item.affected_surfaces) },
    { label: 'Release impact', value: item.release_impact ?? 'Unavailable' },
  ];
}

function nextGateAction(item: DevelopmentPlanItemProjection): string {
  if (item.boundary_status !== 'approved') return 'Complete boundary brainstorming';
  if (item.spec_status !== 'approved') return 'Review Spec';
  if (item.execution_plan_status !== 'approved') return 'Review Execution Plan';
  if (item.execution_status !== 'completed') return 'Supervise execution';
  if (item.review_status !== 'approved') return 'Complete review';
  if (item.qa_handoff_status !== 'approved') return 'Complete QA handoff';
  return 'Prepare release';
}

function sourceSummary(plan: DevelopmentPlanProjection): string {
  if (plan.source_refs?.length) return plan.source_refs.map((ref) => ref.title ?? ref.id).join(', ');
  return 'Source links unavailable';
}

function gateText(item: DevelopmentPlanItemProjection): string {
  return itemGateProgress(item).map((gate) => `${gate.label}: ${gate.state}`).join(', ');
}

function isCompleteGateState(state: unknown): boolean {
  if (typeof state !== 'string') return false;
  return ['accepted', 'approved', 'completed', 'complete', 'ready'].includes(state);
}

function riskLabel(risk: string | undefined): string {
  return risk === undefined ? 'Risk unavailable' : `${formatValue(risk)} risk`;
}

function summarizeList(values: readonly string[] | undefined): string {
  return values === undefined || values.length === 0 ? 'Unavailable' : values.join(', ');
}

function formatValue(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}
