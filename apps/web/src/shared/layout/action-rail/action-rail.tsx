import type { ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface ActionRailProps {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
}

export function ActionRail({ children, className, title }: ActionRailProps) {
  return (
    <div className={cn('grid gap-3 rounded-card border border-border bg-surface p-4 shadow-sm xl:sticky xl:top-24', className)}>
      {title ? <h2 className="text-sm font-semibold text-text-primary">{title}</h2> : null}
      <div className="grid gap-3">{children}</div>
    </div>
  );
}
