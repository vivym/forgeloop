import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  actions?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
}

export function EmptyState({ actions, className, description, title, ...props }: EmptyStateProps) {
  return (
    <div className={cn('fl-empty-state', className)} {...props}>
      <h2 className="fl-empty-state__title">{title}</h2>
      {description ? <p className="fl-empty-state__description">{description}</p> : null}
      {actions ? <div className="fl-empty-state__actions">{actions}</div> : null}
    </div>
  );
}
