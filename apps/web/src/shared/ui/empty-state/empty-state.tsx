import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  actions?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
}

export function EmptyState({ actions, className, description, title, ...props }: EmptyStateProps) {
  return (
    <div className={cn('grid justify-items-center gap-3 px-6 py-10 text-center', className)} {...props}>
      <h2 className="m-0 text-lg font-semibold text-text-primary">{title}</h2>
      {description ? <p className="m-0 max-w-xl text-sm text-text-secondary">{description}</p> : null}
      {actions ? <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}
