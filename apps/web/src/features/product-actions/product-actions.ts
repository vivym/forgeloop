import type { ProductAction, ProductCommandAction, ProductNavigateAction } from '../../shared/api/types';

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

export function primaryActionForItem(item: { actions?: readonly ProductAction[] }) {
  return sortProductActions(item.actions ?? [])[0];
}
