import { Link } from 'react-router';
import type { ReactNode } from 'react';

import { useProductActionCommandMutation } from '../../shared/api/hooks';
import type { ProductAction, ProductActionTarget, ProductCommandAction, ProductNavigateAction } from '../../shared/api/types';
import { useActorContext } from '../../shared/context/actor-context';
import { Button } from '../../shared/ui';
import { cn } from '../../shared/utils/cn';
import { actionStateLabel, isCommandAction, sortProductActions } from './product-actions';

export interface ProductActionListProps {
  projectId: string;
  actions: readonly ProductAction[];
}

export function ProductActionList({ actions, projectId }: ProductActionListProps) {
  const sortedActions = sortProductActions(actions);

  if (!sortedActions.length) {
    return <p className="empty">No product actions are available.</p>;
  }

  return (
    <div className="stack-form compact">
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
        <Link className={cn('fl-button', action.priority === 'primary' ? 'fl-button--primary' : 'fl-button--secondary')} to={action.target.href}>
          <span className="fl-button__label">{action.label}</span>
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
      {mutation.isError ? <p className="empty">{mutation.error.message}</p> : null}
      {mutation.isSuccess && action.target !== undefined ? <FollowUpLink action={action} target={action.target} /> : null}
    </ProductActionFrame>
  );
}

function ProductActionFrame({ action, children }: { action: ProductAction; children: ReactNode }) {
  return (
    <div className="stack-form compact">
      {children}
      <p className="empty">{actionStateLabel(action)}</p>
      {action.description !== undefined ? <p className="empty">{action.description}</p> : null}
      {action.disabled_reason !== undefined ? <p className="empty">{action.disabled_reason}</p> : null}
      {action.blocked_reason !== undefined ? <p className="empty">{action.blocked_reason}</p> : null}
    </div>
  );
}

function FollowUpLink({ action, target }: { action: ProductCommandAction; target: ProductActionTarget }) {
  return (
    <Link className="fl-button fl-button--secondary" to={target.href}>
      <span className="fl-button__label">Open {action.label}</span>
    </Link>
  );
}
