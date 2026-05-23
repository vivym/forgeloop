import type { ProductAction, ProductCommandAction, ProductLaneId, ProductNavigateAction } from '../../shared/api/types';

const actionPriorityRank: Record<ProductAction['priority'], number> = {
  primary: 0,
  secondary: 1,
  tertiary: 2,
};

export function sortProductActions(actions: readonly ProductAction[]) {
  return actions
    .map((action, index) => ({ action, index }))
    .sort((left, right) => {
      const priorityDelta = actionPriorityRank[left.action.priority] - actionPriorityRank[right.action.priority];
      return priorityDelta === 0 ? left.index - right.index : priorityDelta;
    })
    .map(({ action }) => action);
}

export function isCommandAction(action: ProductAction): action is ProductCommandAction {
  return action.kind === 'command';
}

export function isNavigateAction(action: ProductAction): action is ProductNavigateAction {
  return action.kind === 'navigate';
}

export function actionStateLabel(action: ProductAction) {
  if (action.blocked_reason !== undefined) return 'Blocked';
  if (!action.enabled) return 'Disabled';
  return 'Available';
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
    case 'initiative':
    case 'requirement':
    case 'bug':
    case 'tech_debt':
    case 'task':
      return 'Open item';
    default:
      return `Open ${objectType.replace(/[_-]+/g, ' ')}`;
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

export function sanitizeProductActionsForDisplay(actions: readonly ProductAction[], activeLane?: ProductLaneId) {
  if (activeLane !== 'manager') return sortProductActions(actions);

  const managerSafeActions = actions.flatMap((action): ProductAction[] => {
    if (action.kind === 'navigate') return [action];

    const drillDown = commandActionToManagerDrillDown(action);
    return drillDown === undefined ? [] : [drillDown];
  });

  return sortProductActions(managerSafeActions);
}

export function primaryActionForItem(item: { actions?: readonly ProductAction[] }) {
  return sortProductActions(item.actions ?? [])[0];
}
