import { Link } from 'react-router';

import type { ProductAction, ProductCommandAction, ProductLaneId } from '../../../shared/api/types';
import { ActionRail as SharedActionRail } from '../../../shared/layout';
import { Button } from '../../../shared/ui';
import { cn } from '../../../shared/utils/cn';
import { groupDeliveryActionsByPriority, sanitizeDeliveryActionsForDisplay } from '../work-item-view-model';

export interface DeliveryActionRailProps {
  actions: readonly ProductAction[];
  activeLane: ProductLaneId;
  onCommandAction?: ((action: ProductCommandAction) => void) | undefined;
  title?: string;
}

export function DeliveryActionRail({ actions, activeLane, onCommandAction, title = 'Delivery actions' }: DeliveryActionRailProps) {
  const groups = groupDeliveryActionsByPriority(sanitizeDeliveryActionsForDisplay(actions, activeLane));

  return (
    <SharedActionRail title={title}>
      <ActionGroup actions={groups.primary} label="Primary" onCommandAction={onCommandAction} />
      <ActionGroup actions={groups.secondary} label="Secondary" onCommandAction={onCommandAction} />
      {groups.primary.length === 0 && groups.secondary.length === 0 ? <p className="empty">No delivery actions are available.</p> : null}
    </SharedActionRail>
  );
}

function ActionGroup({
  actions,
  label,
  onCommandAction,
}: {
  actions: readonly ProductAction[];
  label: string;
  onCommandAction?: ((action: ProductCommandAction) => void) | undefined;
}) {
  if (actions.length === 0) return null;

  return (
    <div className="stack-form compact">
      <h3>{label}</h3>
      {actions.map((action) => (
        <ActionItem action={action} key={action.id} onCommandAction={onCommandAction} />
      ))}
    </div>
  );
}

function ActionItem({
  action,
  onCommandAction,
}: {
  action: ProductAction;
  onCommandAction?: ((action: ProductCommandAction) => void) | undefined;
}) {
  const effectiveEnabled = action.kind === 'command' ? action.enabled && onCommandAction !== undefined : action.enabled;

  return (
    <div className="stack-form compact">
      {action.kind === 'navigate' ? <NavigateAction action={action} /> : <CommandAction action={action} onCommandAction={onCommandAction} />}
      <p className="empty">{effectiveEnabled ? 'Available' : 'Disabled'}</p>
      {action.description === undefined ? null : <p className="empty">{action.description}</p>}
      {action.disabled_reason === undefined ? null : <p className="empty">{action.disabled_reason}</p>}
      {action.blocked_reason === undefined ? null : <p className="empty">{action.blocked_reason}</p>}
    </div>
  );
}

function NavigateAction({ action }: { action: Extract<ProductAction, { kind: 'navigate' }> }) {
  if (!action.enabled) {
    return (
      <Button disabled variant={action.priority === 'primary' ? 'primary' : 'secondary'}>
        {action.label}
      </Button>
    );
  }

  return (
    <Link className={cn('fl-button', action.priority === 'primary' ? 'fl-button--primary' : 'fl-button--secondary')} to={action.target.href}>
      <span className="fl-button__label">{action.label}</span>
    </Link>
  );
}

function CommandAction({
  action,
  onCommandAction,
}: {
  action: Extract<ProductAction, { kind: 'command' }>;
  onCommandAction?: ((action: ProductCommandAction) => void) | undefined;
}) {
  const canExecute = action.enabled && onCommandAction !== undefined;

  return (
    <Button disabled={!canExecute} onClick={canExecute ? () => onCommandAction(action) : undefined} variant={action.priority === 'primary' ? 'primary' : 'secondary'}>
      {action.label}
    </Button>
  );
}
