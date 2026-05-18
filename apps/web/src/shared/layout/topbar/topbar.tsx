import type { ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface TopbarProps {
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function Topbar({ actions, children, className }: TopbarProps) {
  return (
    <header className={cn('fl-topbar', className)}>
      <div className="fl-topbar__content">{children}</div>
      {actions ? <div className="fl-topbar__actions">{actions}</div> : null}
    </header>
  );
}
