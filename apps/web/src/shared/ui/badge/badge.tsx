import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/cn';

type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', className, children, ...props }: BadgeProps) {
  return (
    <span className={cn('fl-badge', `fl-badge--${tone}`, className)} {...props}>
      {children}
    </span>
  );
}
