import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/cn';

type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const toneClasses = {
  neutral: 'bg-surface-muted text-text-secondary',
  primary: 'bg-primary-soft text-primary-hover',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
} as const;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', className, children, ...props }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center rounded-pill px-2 py-1 text-xs font-semibold leading-none', toneClasses[tone], className)} {...props}>
      {children}
    </span>
  );
}
