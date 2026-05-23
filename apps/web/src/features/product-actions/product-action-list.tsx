import { Link } from 'react-router';
import type { ReactNode } from 'react';

import { useProductActionCommandMutation } from '../../shared/api/hooks';
import type { ProductAction, ProductActionTarget, ProductCommandAction, ProductLaneId, ProductNavigateAction } from '../../shared/api/types';
import { useActorContext } from '../../shared/context/actor-context';
import { InlineActions } from '../../shared/layout';
import { Button, InlineNotice } from '../../shared/ui';
import { cn } from '../../shared/utils/cn';
import { actionStateLabel, isCommandAction, sanitizeProductActionsForDisplay } from './product-actions';

export interface ProductActionListProps {
  activeLane?: ProductLaneId;
  projectId: string;
  actions: readonly ProductAction[];
}

export function ProductActionList({ actions, activeLane, projectId }: ProductActionListProps) {
  const sortedActions = sanitizeProductActionsForDisplay(actions, activeLane);

  if (!sortedActions.length) {
    return <InlineNotice title="No product actions are available." />;
  }

  return (
    <div className="grid gap-3">
      {sortedActions.map((action) =>
        isCommandAction(action) ? (
          <CommandActionItem action={action} key={action.id} projectId={projectId} />
        ) : (
          <NavigateActionItem action={action} key={action.id} />
        ),
      )}
    </div>
  );
}

function NavigateActionItem({ action }: { action: ProductNavigateAction }) {
  return (
    <ProductActionFrame action={action}>
      {action.enabled ? (
        <Link className={linkButtonClass(action.priority)} to={action.target.href}>
          <span className="inline-flex min-w-0 items-center gap-1.5">{action.label}</span>
        </Link>
      ) : (
        <Button disabled variant={action.priority === 'primary' ? 'primary' : 'secondary'}>
          {action.label}
        </Button>
      )}
    </ProductActionFrame>
  );
}

function CommandActionItem({ action, projectId }: { action: ProductCommandAction; projectId: string }) {
  const { actorId } = useActorContext();
  const mutation = useProductActionCommandMutation({ projectId, action });
  const canExecute = action.enabled && !mutation.isPending;

  return (
    <ProductActionFrame action={action}>
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
    </ProductActionFrame>
  );
}

function ProductActionFrame({ action, children }: { action: ProductAction; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <InlineActions>{children}</InlineActions>
      <p className="m-0 text-sm text-text-secondary">{actionStateLabel(action)}</p>
      {action.description !== undefined ? <p className="m-0 text-sm text-text-secondary">{action.description}</p> : null}
      {action.disabled_reason !== undefined ? <p className="m-0 text-sm text-text-secondary">{action.disabled_reason}</p> : null}
      {action.blocked_reason !== undefined ? <p className="m-0 text-sm text-text-secondary">{action.blocked_reason}</p> : null}
    </div>
  );
}

function FollowUpLink({ action, target }: { action: ProductCommandAction; target: ProductActionTarget }) {
  return (
    <Link className={linkButtonClass('secondary')} to={target.href}>
      <span className="inline-flex min-w-0 items-center gap-1.5">Open {action.label}</span>
    </Link>
  );
}

function linkButtonClass(priority: ProductAction['priority']) {
  return cn(
    'inline-flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition-colors duration-base ease-standard motion-reduce:transition-none',
    priority === 'primary'
      ? 'border-primary bg-primary text-white hover:bg-primary-hover'
      : 'border-border bg-surface text-text-primary hover:border-border-strong hover:bg-surface-muted',
  );
}
