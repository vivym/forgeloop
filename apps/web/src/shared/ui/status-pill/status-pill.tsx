import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/cn';

type StatusTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const toneClasses = {
  neutral: 'bg-surface-muted text-text-secondary',
  primary: 'bg-primary-soft text-primary-hover',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
} as const;

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  showDot?: boolean;
  children: ReactNode;
}

export function StatusPill({ tone = 'neutral', showDot = true, className, children, ...props }: StatusPillProps) {
  return (
    <span className={cn('inline-flex items-center gap-2 rounded-pill px-3 py-1 text-xs font-semibold leading-none', toneClasses[tone], className)} {...props}>
      {showDot ? <span aria-hidden="true" className="size-2 rounded-pill bg-current" /> : null}
      <span>{children}</span>
    </span>
  );
}
