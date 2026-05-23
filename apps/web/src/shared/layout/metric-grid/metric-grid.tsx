import type { ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface MetricGridProps {
  children: ReactNode;
  className?: string;
}

export interface MetricProps {
  label: ReactNode;
  value: ReactNode;
  className?: string;
  description?: ReactNode;
}

export function MetricGrid({ children, className }: MetricGridProps) {
  return <dl className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4', className)}>{children}</dl>;
}

export function Metric({ className, description, label, value }: MetricProps) {
  return (
    <div className={cn('rounded-card border border-border bg-surface p-4 shadow-sm', className)}>
      <dt className="text-sm font-medium text-text-secondary">{label}</dt>
      <dd className="mt-2 text-2xl font-semibold text-text-primary">{value}</dd>
      {description ? <dd className="mt-1 text-sm text-text-secondary">{description}</dd> : null}
    </div>
  );
}
