import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/cn';

type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  children: ReactNode;
}

export function StatusPill({ tone = 'neutral', className, children, ...props }: StatusPillProps) {
  return (
    <span className={cn('fl-status-pill', `fl-status-pill--${tone}`, className)} {...props}>
      <span aria-hidden="true" className="fl-status-pill__dot" />
      <span>{children}</span>
    </span>
  );
}
