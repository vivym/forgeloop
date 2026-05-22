import type { ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface PageHeaderProps {
  actions?: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
  className?: string;
}

export function PageHeader({ actions, className, eyebrow, subtitle, title }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between', className)} data-page-header="">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-xs font-semibold uppercase text-text-secondary">{eyebrow}</p> : null}
        <h1 className="text-2xl font-semibold text-text-primary">{title}</h1>
        {subtitle ? <p className="mt-2 max-w-3xl text-sm text-text-secondary">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
