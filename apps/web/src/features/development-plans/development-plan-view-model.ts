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
  implementation_plan_status?: string;
  execution_status?: string;
  review_status?: string;
  qa_handoff_status?: string;
  release_impact?: string;
  next_action?: string;
  updated_at?: string;
}

export type DevelopmentPlanColumnKey =
  | 'planItem'
  | 'typedRefs'
  | 'currentGate'
  | 'gateProgress'
  | 'risk'
  | 'driver'
  | 'role'
  | 'reviewer'
  | 'affectedSurfaces'
  | 'dependencies'
  | 'releaseImpact'
  | 'nextAction';

export type DevelopmentPlanColumnBreakpoint = 'desktop' | 'tablet' | 'mobile';

export interface DevelopmentPlanColumnDefinition {
  key: DevelopmentPlanColumnKey;
  label: string;
  priority: number;
}

export interface DevelopmentPlanWorkspaceMetric {
  label: string;
  value: string;
  detail?: string;
}

export interface DevelopmentPlanWorkspacePlanItemSummary {
  id: string;
  title: string;
  currentGate: string;
  blocker: string;
  nextAction: string;
  typedDocumentContext: string[];
  artifacts: Array<{ label: string; href: string }>;
  evidenceLinks: Array<{ label: string; href: string }>;
  gateProgress: ViewModelGate[];
  risk: string;
  driver: string;
  responsibleRole: string;
  reviewer: string;
  affectedSurfaces: string;
  dependencies: string;
  releaseImpact: string;
  summary: string;
}

export interface DevelopmentPlanWorkspacePlanSummary {
  id: string;
  title: string;
  status: string;
  typedRefs: string[];
  itemCount: number;
  blockedCount: number;
  gateDistribution: string;
  actors: {
    drivers: string[];
    reviewers: string[];
    responsibleRoles: string[];
  };
  risk: string;
  updatedAt: string;
  nextAction: string;
  selectedPlanItem: DevelopmentPlanWorkspacePlanItemSummary;
}

export interface DevelopmentPlanWorkspaceViewModel {
  summaryMetrics: DevelopmentPlanWorkspaceMetric[];
  plans: DevelopmentPlanWorkspacePlanSummary[];
  selectedPlan?: DevelopmentPlanWorkspacePlanSummary;
}

export const developmentPlanPlanningColumns: readonly DevelopmentPlanColumnDefinition[] = [
  { key: 'planItem', label: 'Plan Item', priority: 1 },
  { key: 'typedRefs', label: 'Typed refs', priority: 2 },
  { key: 'currentGate', label: 'Current gate', priority: 3 },
  { key: 'gateProgress', label: 'Gate progress', priority: 4 },
  { key: 'risk', label: 'Risk', priority: 5 },
  { key: 'driver', label: 'Driver', priority: 6 },
  { key: 'role', label: 'Responsible role', priority: 7 },
  { key: 'reviewer', label: 'Reviewer', priority: 8 },
  { key: 'affectedSurfaces', label: 'Affected surfaces', priority: 9 },
  { key: 'dependencies', label: 'Dependencies', priority: 10 },
  { key: 'releaseImpact', label: 'Release impact', priority: 11 },
  { key: 'nextAction', label: 'Next action', priority: 12 },
];

export const developmentPlanColumnPriorityByBreakpoint: Record<DevelopmentPlanColumnBreakpoint, readonly DevelopmentPlanColumnKey[]> = {
  desktop: ['planItem', 'typedRefs', 'currentGate', 'gateProgress', 'risk', 'driver', 'role', 'reviewer', 'affectedSurfaces', 'dependencies', 'releaseImpact', 'nextAction'],
  tablet: ['planItem', 'typedRefs', 'currentGate', 'gateProgress', 'risk', 'driver', 'role', 'nextAction'],
  mobile: ['planItem', 'currentGate', 'gateProgress', 'risk', 'nextAction'],
};

export function developmentPlanWorkspaceViewModel(
  plans: readonly DevelopmentPlanProjection[],
  selectedPlanId?: string,
  selectedPlanItemId?: string,
): DevelopmentPlanWorkspaceViewModel {
  const normalizedPlans = plans.map((plan) => normalizePlan(plan, selectedPlanItemId));
  const selectedPlan = normalizedPlans.find((plan) => plan.id === selectedPlanId) ?? normalizedPlans[0];
  const totalPlans = normalizedPlans.length;
  const activePlans = normalizedPlans.filter((plan) => plan.status === 'active').length;
  const blockedItems = normalizedPlans.reduce((count, plan) => count + plan.blockedCount, 0);
  const reviewAging = summarizeReviewAging(plans);
  const executionInProgress = plans.reduce((count, plan) => count + (plan.items ?? []).filter((item) => isActiveExecutionState(item.execution_status)).length, 0);

  return {
    summaryMetrics: [
      { label: 'Total plans', value: String(totalPlans) },
      { label: 'Active plans', value: String(activePlans) },
      { label: 'Blocked items', value: String(blockedItems) },
      { label: 'Review aging', value: reviewAging },
      { label: 'Execution in progress', value: String(executionInProgress) },
    ],
    plans: normalizedPlans,
    ...(selectedPlan === undefined ? {} : { selectedPlan }),
  };
}

export function developmentPlanViewModel(plan: DevelopmentPlanProjection): ProductPageViewModel {
  const itemCount = plan.items?.length ?? plan.item_count ?? 0;
  const blockedCount = plan.blocked_count ?? (plan.items ?? []).filter(isBlockedPlanItemProjection).length;

  return {
    objectLabel: plan.title ?? plan.id,
    objectType: 'Development Plan',
    currentState: plan.status ?? 'Status unavailable',
    nextAction: itemCount === 0 ? 'Add Development Plan Items' : 'Review Development Plan Items',
    disabledReason: undefined,
    primaryActorOrRole: 'Product and technical owner',
    riskSignal: blockedCount === 0 ? 'No blocked item signal' : `${blockedCount} blocked item(s)`,
    gateProgress: [
      { label: 'Typed refs', state: (plan.source_refs?.length ?? 0) === 0 ? 'unavailable' : 'linked' },
      { label: 'Development Plan Items', state: itemCount === 0 ? 'missing' : 'available' },
    ],
    criticalEvidence: [
      {
        label: 'Typed refs',
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
    { label: 'Implementation Plan Doc', state: item.implementation_plan_status ?? 'unavailable' },
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

function normalizePlan(plan: DevelopmentPlanProjection, selectedPlanItemId: string | undefined): DevelopmentPlanWorkspacePlanSummary {
  const items = (plan.items ?? []).map((item) => normalizePlanItem(item, plan));
  const blockedCount = plan.blocked_count ?? (plan.items ?? []).filter(isBlockedPlanItemProjection).length;
  const selectedPlanItem = items.find((item) => item.id === selectedPlanItemId) ?? items[0] ?? emptyPlanItem(plan);
  return {
    id: plan.id,
    title: plan.title ?? plan.id,
    status: plan.status ?? 'Status unavailable',
    typedRefs: typedRefsForPlan(plan),
    itemCount: plan.item_count ?? items.length,
    blockedCount,
    gateDistribution: gateDistributionFor(items),
    actors: {
      drivers: uniqueValues(items.map((item) => item.driver).filter(nonEmpty)),
      reviewers: uniqueValues(items.map((item) => item.reviewer).filter(nonEmpty)),
      responsibleRoles: uniqueValues(items.map((item) => item.responsibleRole).filter(nonEmpty)),
    },
    risk: highestRisk(items),
    updatedAt: plan.updated_at === undefined ? 'Timeline unavailable' : `Updated ${plan.updated_at}`,
    nextAction: selectedPlanItem.nextAction,
    selectedPlanItem,
  };
}

function normalizePlanItem(item: DevelopmentPlanItemProjection, plan: DevelopmentPlanProjection): DevelopmentPlanWorkspacePlanItemSummary {
  const currentGate = currentPlanItemGate(item);
  const nextAction = nextGateAction(item);
  const typedDocumentContext = typedDocumentContextForPlan(plan);
  return {
    id: item.id,
    title: item.title ?? item.id,
    currentGate: `${currentGate.label}: ${formatValue(currentGate.state)}`,
    blocker: blockerLabel(item),
    nextAction,
    typedDocumentContext,
    artifacts: planItemArtifacts(plan, item),
    evidenceLinks: planItemEvidenceLinks(plan, item),
    gateProgress: itemGateProgress(item),
    risk: riskLabel(item.risk),
    driver: item.driver_actor_id ?? 'Unassigned',
    responsibleRole: item.responsible_role ?? 'Unassigned',
    reviewer: item.reviewer_actor_id ?? 'Unassigned',
    affectedSurfaces: summarizeList(item.affected_surfaces),
    dependencies: summarizeList(item.dependency_hints),
    releaseImpact: formatValue(item.release_impact),
    summary: item.summary ?? 'Development Plan Item summary unavailable',
  };
}

function planItemArtifacts(plan: DevelopmentPlanProjection, item: DevelopmentPlanItemProjection): Array<{ label: string; href: string }> {
  const base = `/development-plans/${encodeURIComponent(plan.id)}/items/${encodeURIComponent(item.id)}`;
  return [
    { label: 'Boundary', href: `${base}` },
    { label: 'Spec', href: `${base}/spec` },
    { label: 'Implementation Plan Doc', href: `${base}/implementation-plan` },
    { label: 'Execution', href: `${base}/execution` },
    { label: 'Review', href: '/reviews' },
    { label: 'QA', href: '/qa' },
  ];
}

function planItemEvidenceLinks(plan: DevelopmentPlanProjection, item: DevelopmentPlanItemProjection): Array<{ label: string; href: string }> {
  return [
    { label: 'Context manifest', href: `/development-plans/${encodeURIComponent(plan.id)}` },
    { label: 'Typed refs', href: sourceHref(plan.source_refs?.[0]) },
    { label: 'Plan Item', href: `/development-plans/${encodeURIComponent(plan.id)}/items/${encodeURIComponent(item.id)}` },
  ];
}

function typedRefsForPlan(plan: DevelopmentPlanProjection): string[] {
  return plan.source_refs?.length ? plan.source_refs.map((ref) => ref.title ?? ref.id).filter(nonEmpty) : ['Typed refs unavailable'];
}

function typedDocumentContextForPlan(plan: DevelopmentPlanProjection): string[] {
  const refs = typedRefsForPlan(plan);
  return refs.length > 0 ? refs : ['Typed refs unavailable'];
}

function gateDistributionFor(items: readonly DevelopmentPlanWorkspacePlanItemSummary[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const currentGate = item.currentGate.split(':')[0] ?? 'Unknown';
    counts.set(currentGate, (counts.get(currentGate) ?? 0) + 1);
  }
  const gates = ['Boundary', 'Spec', 'Implementation Plan Doc', 'Execution', 'Review', 'QA handoff'];
  return gates.map((gate) => `${gate} ${counts.get(gate) ?? 0}`).join(' · ');
}

function highestRisk(items: readonly DevelopmentPlanWorkspacePlanItemSummary[]): string {
  const order = new Map([['Critical risk', 4], ['High risk', 3], ['Medium risk', 2], ['Low risk', 1]]);
  const highest = items.reduce((value, item) => Math.max(value, order.get(item.risk) ?? 0), 0);
  if (highest >= 4) return 'Critical risk';
  if (highest === 3) return 'High risk';
  if (highest === 2) return 'Medium risk';
  if (highest === 1) return 'Low risk';
  return 'Risk unavailable';
}

function summarizeReviewAging(plans: readonly DevelopmentPlanProjection[]): string {
  const reviewQueueCount = plans.reduce((count, plan) => count + (plan.items ?? []).filter((item) => isInProgressGateState(item.review_status)).length, 0);
  if (reviewQueueCount === 0) return '0 aging';
  return `${reviewQueueCount} aging`;
}

function blockerLabel(item: DevelopmentPlanItemProjection): string {
  if (item.boundary_status !== 'approved') return 'Boundary brainstorming pending';
  if (item.spec_status !== 'approved') return 'Spec approval pending';
  if (item.implementation_plan_status !== 'approved') return 'Implementation Plan Doc approval pending';
  if (item.execution_status !== 'completed') return 'Execution in progress';
  if (item.review_status !== 'approved') return 'Code review pending';
  if (item.qa_handoff_status !== 'approved' && item.qa_handoff_status !== 'accepted') return 'QA handoff pending';
  return 'Ready';
}

function nextGateAction(item: DevelopmentPlanItemProjection): string {
  if (item.boundary_status !== 'approved') return 'Complete boundary brainstorming';
  if (item.spec_status !== 'approved') return 'Review Spec';
  if (item.implementation_plan_status !== 'approved') return 'Review Implementation Plan Doc';
  if (item.execution_status !== 'completed') return 'Supervise execution';
  if (item.review_status !== 'approved') return 'Complete review';
  if (item.qa_handoff_status !== 'approved' && item.qa_handoff_status !== 'accepted') return 'Complete QA handoff';
  return 'Prepare release';
}

function isBlockedPlanItemProjection(item: DevelopmentPlanItemProjection): boolean {
  return [
    item.boundary_status,
    item.spec_status,
    item.implementation_plan_status,
    item.execution_status,
    item.review_status,
    item.qa_handoff_status,
  ].some(isBlockedGateState);
}

function isBlockedGateState(state: unknown): boolean {
  if (typeof state !== 'string') return false;
  return ['blocked', 'changes_requested', 'failed', 'interrupted'].includes(state);
}

function emptyPlanItem(plan: DevelopmentPlanProjection): DevelopmentPlanWorkspacePlanItemSummary {
  return {
    id: plan.id,
    title: plan.title ?? plan.id,
    currentGate: 'Release: Ready',
    blocker: 'No Plan Items',
    nextAction: 'Add Plan Item',
    typedDocumentContext: typedDocumentContextForPlan(plan),
    artifacts: [{ label: 'Plan', href: `/development-plans/${encodeURIComponent(plan.id)}` }],
    evidenceLinks: [],
    gateProgress: [],
    risk: 'Risk unavailable',
    driver: 'Unassigned',
    responsibleRole: 'Unassigned',
    reviewer: 'Unassigned',
    affectedSurfaces: 'Unavailable',
    dependencies: 'Unavailable',
    releaseImpact: 'Unavailable',
    summary: 'Development Plan Item summary unavailable',
  };
}

function sourceSummary(plan: DevelopmentPlanProjection): string {
  if (plan.source_refs?.length) return plan.source_refs.map((ref) => ref.title ?? ref.id).join(', ');
  return 'Typed refs unavailable';
}

function gateText(item: DevelopmentPlanItemProjection): string {
  return itemGateProgress(item).map((gate) => `${gate.label}: ${gate.state}`).join(', ');
}

function isCompleteGateState(state: unknown): boolean {
  if (typeof state !== 'string') return false;
  return ['accepted', 'approved', 'completed', 'complete', 'ready'].includes(state);
}

function isInProgressGateState(state: unknown): boolean {
  if (typeof state !== 'string') return false;
  return ['running', 'in_progress', 'in review', 'in_review', 'ready'].includes(state);
}

function isActiveExecutionState(state: unknown): boolean {
  if (typeof state !== 'string') return false;
  return ['running', 'in_progress', 'in review', 'in_review'].includes(state);
}

function riskLabel(risk: string | undefined): string {
  return risk === undefined ? 'Risk unavailable' : `${formatValue(risk)} risk`;
}

function summarizeList(values: readonly string[] | undefined): string {
  return values === undefined || values.length === 0 ? 'Unavailable' : values.join(', ');
}

function formatValue(value: string | undefined): string {
  if (value === undefined) return 'Unavailable';
  return value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

function sourceHref(ref: ProductRef | undefined): string {
  if (ref === undefined) return '/development-plans';
  switch (ref.type) {
    case 'requirement':
      return `/requirements/${encodeURIComponent(ref.id ?? '')}`;
    case 'initiative':
      return `/initiatives/${encodeURIComponent(ref.id ?? '')}`;
    case 'bug':
      return `/bugs/${encodeURIComponent(ref.id ?? '')}`;
    case 'tech_debt':
      return `/tech-debt/${encodeURIComponent(ref.id ?? '')}`;
    default:
      return '/development-plans';
  }
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values)].filter(nonEmpty);
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
