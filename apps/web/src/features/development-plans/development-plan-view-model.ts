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

function itemGateProgress(item: DevelopmentPlanItemProjection): ViewModelGate[] {
  return [
    { label: 'Boundary', state: item.boundary_status ?? 'unavailable' },
    { label: 'Spec', state: item.spec_status ?? 'unavailable' },
    { label: 'Execution Plan', state: item.execution_plan_status ?? 'unavailable' },
    { label: 'Execution', state: item.execution_status ?? 'unavailable' },
    { label: 'Review', state: item.review_status ?? 'unavailable' },
    { label: 'QA handoff', state: item.qa_handoff_status ?? 'unavailable' },
  ];
}

function itemMetadata(item: DevelopmentPlanItemProjection): ViewModelMetadata[] {
  return [
    { label: 'Driver', value: item.driver_actor_id ?? 'Unassigned' },
    { label: 'Reviewer', value: item.reviewer_actor_id ?? 'Unassigned' },
    { label: 'Release impact', value: item.release_impact ?? 'Unavailable' },
  ];
}

function nextGateAction(item: DevelopmentPlanItemProjection): string {
  if (item.boundary_status !== 'approved') return 'Complete boundary brainstorming';
  if (item.spec_status !== 'approved') return 'Review Spec';
  if (item.execution_plan_status !== 'approved') return 'Review Execution Plan';
  if (item.execution_status !== 'completed') return 'Supervise execution';
  if (item.review_status !== 'approved') return 'Complete review';
  if (item.qa_handoff_status !== 'accepted') return 'Complete QA handoff';
  return 'Prepare release';
}

function sourceSummary(plan: DevelopmentPlanProjection): string {
  if (plan.source_refs?.length) return plan.source_refs.map((ref) => ref.title ?? ref.id).join(', ');
  return 'Source links unavailable';
}

function gateText(item: DevelopmentPlanItemProjection): string {
  return itemGateProgress(item).map((gate) => `${gate.label}: ${gate.state}`).join(', ');
}

function riskLabel(risk: string | undefined): string {
  return risk === undefined ? 'Risk unavailable' : `${formatValue(risk)} risk`;
}

function formatValue(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}
