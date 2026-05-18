import type { ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface ActionRailProps {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
}

export function ActionRail({ children, className, title }: ActionRailProps) {
  return (
    <aside className={cn('fl-action-rail', className)}>
      {title ? <h2 className="fl-action-rail__title">{title}</h2> : null}
      <div className="fl-action-rail__content">{children}</div>
    </aside>
  );
}
