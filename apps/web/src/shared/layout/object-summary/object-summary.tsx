import type { ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface ObjectSummaryProps {
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
  meta?: ReactNode;
  subtitle?: ReactNode;
}

export function ObjectSummary({ actions, className, meta, subtitle, title }: ObjectSummaryProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold text-text-primary">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-text-secondary">{subtitle}</p> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
