import type {
  CockpitResponse,
  DeliveryEvidence,
  DeliveryStageState,
  ExecutionPackage,
  ProductAction,
  ProductCommandAction,
  ProductLaneId,
  ProductNavigateAction,
  ReviewPacket,
  RunSession,
  SpecPlan,
  TimelineEntry,
  WorkItem,
  WorkItemDeliveryReadiness,
} from '../../shared/api/types';

export type DeliveryStatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
type DeliveryObjectRef = WorkItemDeliveryReadiness['stages'][number]['object_refs'][number];

export interface DeliveryActionGroups {
  primary: ProductAction[];
  secondary: ProductAction[];
}

export interface DeliveryPackageDisplayRow {
  id: string;
  label: string;
  href: string;
  owner: string;
  latestRun: string;
  stateLabel: string;
  stateTone: DeliveryStatusTone;
  blockingReason?: string;
}

export interface WorkItemDetailViewModel {
  workItem: WorkItem | null;
  spec: SpecPlan | null;
  plan: SpecPlan | null;
  packages: ExecutionPackage[];
  packageRows: DeliveryPackageDisplayRow[];
  runs: RunSession[];
  reviews: ReviewPacket[];
  deliveryReadiness: WorkItemDeliveryReadiness | null;
  deliveryActions: DeliveryActionGroups;
  timeline: TimelineEntry[];
}

export const formatValue = (value: string | undefined, fallback = 'Not set') =>
  value === undefined || value.trim().length === 0
    ? fallback
    : value
        .split(/[_ -]+/)
        .filter(Boolean)
        .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
        .join(' ');

const priorityRank: Record<ProductAction['priority'], number> = {
  primary: 0,
  secondary: 1,
  tertiary: 2,
};

export function deliveryStageTone(state: DeliveryStageState): DeliveryStatusTone {
  switch (state) {
    case 'passed':
    case 'ready':
      return 'success';
    case 'running':
      return 'info';
    case 'blocked':
    case 'failed':
      return 'danger';
    case 'missing':
      return 'warning';
    case 'not_applicable':
      return 'neutral';
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

export function deliveryOverallLabel(readiness: WorkItemDeliveryReadiness | undefined) {
  return formatValue(readiness?.overall_state, 'Readiness unavailable');
}

export function deliveryStageTargetId(stage: { id: string }) {
  return `delivery-stage-${stage.id}`;
}

export function sortDeliveryActions(actions: readonly ProductAction[]) {
  return actions
    .map((action, index) => ({ action, index }))
    .sort((left, right) => {
      const priorityDelta = priorityRank[left.action.priority] - priorityRank[right.action.priority];
      return priorityDelta === 0 ? left.index - right.index : priorityDelta;
    })
    .map(({ action }) => action);
}

type ProductObjectActionTarget = Extract<ProductNavigateAction['target'], { kind: 'object' }>;

function objectTypeActionLabel(objectType: ProductObjectActionTarget['object_type']) {
  switch (objectType) {
    case 'execution_package':
      return 'Open package';
    case 'run_session':
      return 'Open run';
    case 'review_packet':
      return 'Open review';
    case 'work_item':
      return 'Open work item';
    default:
      return `Open ${formatValue(objectType).toLowerCase()}`;
  }
}

function commandActionToManagerDrillDown(action: ProductCommandAction): ProductNavigateAction | undefined {
  const target = action.target;
  if (target?.kind !== 'object') return undefined;

  return {
    id: `${action.id}-drill-down`,
    lane_id: 'manager',
    priority: 'secondary',
    label: objectTypeActionLabel(target.object_type),
    description: action.description,
    enabled: true,
    kind: 'navigate',
    target,
  };
}

export function sanitizeDeliveryActionsForDisplay(actions: readonly ProductAction[], activeLane: ProductLaneId) {
  if (activeLane !== 'manager') return sortDeliveryActions(actions);

  const managerSafeActions = actions.flatMap((action): ProductAction[] => {
    if (action.kind === 'navigate') return [action];

    const drillDown = commandActionToManagerDrillDown(action);
    return drillDown === undefined ? [] : [drillDown];
  });

  return sortDeliveryActions(managerSafeActions);
}

export function groupDeliveryActionsByPriority(actions: readonly ProductAction[]): DeliveryActionGroups {
  const groups: DeliveryActionGroups = { primary: [], secondary: [] };

  for (const action of sortDeliveryActions(actions)) {
    if (action.priority === 'primary') {
      groups.primary.push(action);
    } else {
      groups.secondary.push(action);
    }
  }

  return groups;
}

function objectRefHref(objectRef: DeliveryObjectRef | undefined, fallback: string) {
  return objectRef?.href ?? fallback;
}

function packageObjectRef(readiness: WorkItemDeliveryReadiness | undefined, packageId: string) {
  const stageRefs = readiness?.stages.flatMap((stage) => stage.object_refs) ?? [];
  const evidenceRefs = readiness?.evidence.flatMap((item) => (item.object_ref === undefined ? [] : [item.object_ref])) ?? [];

  return [...stageRefs, ...evidenceRefs].find((ref) => ref.object_type === 'execution_package' && ref.object_id === packageId);
}

function latestRunLabel(executionPackage: ExecutionPackage) {
  return executionPackage.last_run_session_id ?? 'No run yet';
}

function packageTone(executionPackage: ExecutionPackage): DeliveryStatusTone {
  if (executionPackage.blocked_reason !== undefined) return 'danger';
  if (executionPackage.activity_state === 'running') return 'info';
  return 'neutral';
}

export function createDeliveryPackageRows(
  packages: readonly ExecutionPackage[],
  readiness: WorkItemDeliveryReadiness | undefined,
): DeliveryPackageDisplayRow[] {
  return packages.map((executionPackage) => {
    const objectRef = packageObjectRef(readiness, executionPackage.id);

    return {
      id: executionPackage.id,
      label: executionPackage.objective,
      href: objectRefHref(objectRef, `/packages/${encodeURIComponent(executionPackage.id)}`),
      owner: executionPackage.owner_actor_id,
      latestRun: latestRunLabel(executionPackage),
      stateLabel: formatValue(executionPackage.phase),
      stateTone: packageTone(executionPackage),
      ...(executionPackage.blocked_reason === undefined ? {} : { blockingReason: executionPackage.blocked_reason }),
    };
  });
}

export function evidenceForStage(evidence: readonly DeliveryEvidence[], stageId: string) {
  return evidence.filter((item) => item.stage_id === stageId);
}

export const createWorkItemDetailViewModel = (cockpit: CockpitResponse | undefined, timeline: TimelineEntry[] | undefined): WorkItemDetailViewModel => ({
  workItem: cockpit?.work_item ?? null,
  spec: cockpit?.current_spec ?? null,
  plan: cockpit?.current_plan ?? null,
  packages: cockpit?.packages ?? [],
  packageRows: createDeliveryPackageRows(cockpit?.packages ?? [], cockpit?.delivery_readiness),
  runs: cockpit?.run_sessions ?? [],
  reviews: cockpit?.review_packets ?? [],
  deliveryReadiness: cockpit?.delivery_readiness ?? null,
  deliveryActions: groupDeliveryActionsByPriority(
    sanitizeDeliveryActionsForDisplay(cockpit?.delivery_readiness.next_actions ?? [], cockpit?.delivery_readiness.active_lane ?? 'requirements'),
  ),
  timeline: timeline ?? [],
});
