import { Link } from 'react-router';

import { useProductActionCommandMutation } from '../../../shared/api/hooks';
import type { ProductAction, ProductActionTarget, ProductCommandAction, ProductLaneId } from '../../../shared/api/types';
import { useActorContext } from '../../../shared/context/actor-context';
import { ActionRail as SharedActionRail } from '../../../shared/layout';
import { Button, InlineNotice } from '../../../shared/ui';
import { groupDeliveryActionsByPriority, sanitizeDeliveryActionsForDisplay } from '../work-item-view-model';

export interface DeliveryActionRailProps {
  actions: readonly ProductAction[];
  activeLane: ProductLaneId;
  onCommandAction?: ((action: ProductCommandAction) => void) | undefined;
  projectId?: string | undefined;
  title?: string;
}

export function DeliveryActionRail({ actions, activeLane, onCommandAction, projectId, title = 'Delivery actions' }: DeliveryActionRailProps) {
  const groups = groupDeliveryActionsByPriority(sanitizeDeliveryActionsForDisplay(actions, activeLane));

  return (
    <div data-testid="delivery-action-rail">
      <SharedActionRail title={title}>
        <ActionGroup actions={groups.primary} label="Primary" onCommandAction={onCommandAction} projectId={projectId} />
        <ActionGroup actions={groups.secondary} label="Secondary" onCommandAction={onCommandAction} projectId={projectId} />
        {groups.primary.length === 0 && groups.secondary.length === 0 ? <InlineNotice title="No delivery actions are available." /> : null}
      </SharedActionRail>
    </div>
  );
}

function ActionGroup({
  actions,
  label,
  onCommandAction,
  projectId,
}: {
  actions: readonly ProductAction[];
  label: string;
  onCommandAction?: ((action: ProductCommandAction) => void) | undefined;
  projectId?: string | undefined;
}) {
  if (actions.length === 0) return null;

  return (
    <div className="grid gap-3">
      <h3 className="m-0 text-sm font-semibold text-text-primary">{label}</h3>
      {actions.map((action) => (
        <ActionItem action={action} key={action.id} onCommandAction={onCommandAction} projectId={projectId} />
      ))}
    </div>
  );
}

function ActionItem({
  action,
  onCommandAction,
  projectId,
}: {
  action: ProductAction;
  onCommandAction?: ((action: ProductCommandAction) => void) | undefined;
  projectId?: string | undefined;
}) {
  const commandCanExecute = onCommandAction !== undefined || projectId !== undefined;
  const effectiveEnabled = action.kind === 'command' ? action.enabled && commandCanExecute : action.enabled;

  return (
    <div className="grid gap-2">
      {action.kind === 'navigate' ? (
        <NavigateAction action={action} />
      ) : (
        <CommandAction action={action} onCommandAction={onCommandAction} projectId={projectId} />
      )}
      <p className="m-0 text-sm text-text-secondary">{effectiveEnabled ? 'Available' : 'Disabled'}</p>
      {action.description === undefined ? null : <p className="m-0 text-sm text-text-secondary">{action.description}</p>}
      {action.disabled_reason === undefined ? null : <InlineNotice title={action.disabled_reason} tone="warning" />}
      {action.blocked_reason === undefined ? null : <InlineNotice title={action.blocked_reason} tone="warning" />}
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
    <Link className={linkButtonClass(action.priority === 'primary' ? 'primary' : 'secondary')} to={action.target.href}>
      {action.label}
    </Link>
  );
}

function CommandAction({
  action,
  onCommandAction,
  projectId,
}: {
  action: Extract<ProductAction, { kind: 'command' }>;
  onCommandAction?: ((action: ProductCommandAction) => void) | undefined;
  projectId?: string | undefined;
}) {
  if (onCommandAction === undefined && projectId !== undefined) {
    return <ExecutableCommandAction action={action} projectId={projectId} />;
  }

  const canExecute = action.enabled && onCommandAction !== undefined;

  return (
    <Button disabled={!canExecute} onClick={canExecute ? () => onCommandAction(action) : undefined} variant={action.priority === 'primary' ? 'primary' : 'secondary'}>
      {action.label}
    </Button>
  );
}

function ExecutableCommandAction({ action, projectId }: { action: ProductCommandAction; projectId: string }) {
  const { actorId } = useActorContext();
  const mutation = useProductActionCommandMutation({ projectId, action });
  const canExecute = action.enabled && !mutation.isPending;

  return (
    <>
      <Button
        disabled={!canExecute}
        loading={mutation.isPending}
        onClick={() => mutation.mutate({ actorId })}
        variant={action.priority === 'primary' ? 'primary' : 'secondary'}
      >
        {action.label}
      </Button>
      {mutation.isError ? <InlineNotice title={mutation.error.message} tone="danger" /> : null}
      {mutation.isSuccess && action.target !== undefined ? <FollowUpLink action={action} target={action.target} /> : null}
    </>
  );
}

function FollowUpLink({ action, target }: { action: ProductCommandAction; target: ProductActionTarget }) {
  return (
    <Link className={linkButtonClass('secondary')} to={target.href}>
      Open {action.label}
    </Link>
  );
}

function linkButtonClass(variant: 'primary' | 'secondary') {
  const variantClass =
    variant === 'primary'
      ? 'border-primary bg-primary text-white hover:bg-primary-hover'
      : 'border-border bg-surface text-text-primary hover:border-border-strong hover:bg-surface-muted';

  return [
    'inline-flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition-colors duration-base ease-standard motion-reduce:transition-none',
    variantClass,
  ].join(' ');
}
