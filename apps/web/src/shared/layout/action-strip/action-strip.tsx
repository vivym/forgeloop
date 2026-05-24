import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface ActionStripProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  nextAction: ReactNode;
  secondaryActions?: ReactNode;
}

export function ActionStrip({ className, nextAction, secondaryActions, ...props }: ActionStripProps) {
  return (
    <div
      className={cn('flex flex-col gap-3 rounded-card border border-border bg-surface-raised p-3 md:flex-row md:items-center md:justify-between', className)}
      data-action-strip=""
      {...props}
    >
      <div className="min-w-0 grid gap-1" data-testid="next-action">
        <div className="text-xs font-semibold uppercase text-text-secondary">Next action</div>
        <div className="min-w-0 text-sm text-text-primary">{nextAction}</div>
      </div>
      {secondaryActions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{secondaryActions}</div> : null}
    </div>
  );
}
