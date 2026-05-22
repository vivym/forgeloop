import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/cn';

type InlineNoticeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const toneClasses = {
  neutral: 'border-border bg-surface-muted text-text-secondary',
  info: 'border-info/30 bg-info-soft text-info',
  success: 'border-success/30 bg-success-soft text-success',
  warning: 'border-warning/30 bg-warning-soft text-warning',
  danger: 'border-danger/30 bg-danger-soft text-danger',
} as const;

export interface InlineNoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  actions?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
  tone?: InlineNoticeTone;
}

export function InlineNotice({
  actions,
  'aria-label': ariaLabel,
  className,
  description,
  role,
  title,
  tone = 'neutral',
  ...props
}: InlineNoticeProps) {
  return (
    <div
      {...props}
      aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
      className={cn('grid gap-2 rounded-card border px-4 py-3 text-sm', toneClasses[tone], className)}
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
    >
      <div className="font-semibold">{title}</div>
      {description ? <div className="text-current/80">{description}</div> : null}
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
