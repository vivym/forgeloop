import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/cn';

const sectionVariantClasses = {
  plain: 'grid gap-4',
  panel: 'grid gap-4 rounded-card border border-border bg-surface p-4',
  subtle: 'grid gap-4 rounded-card border border-border bg-surface-muted/70 p-4',
} as const;

export interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  actions?: ReactNode;
  description?: ReactNode;
  title?: ReactNode;
  variant?: 'plain' | 'panel' | 'subtle';
}

export function Section({ actions, children, className, description, title, variant = 'plain', ...props }: SectionProps) {
  return (
    <section
      className={cn(sectionVariantClasses[variant], className)}
      data-layout-section=""
      data-section-variant={variant}
      {...props}
    >
      {title || description || actions ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {title ? <h2 className="text-base font-semibold text-text-primary">{title}</h2> : null}
            {description ? <p className="mt-1 text-sm text-text-secondary">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className="min-w-0">{children}</div>
    </section>
  );
}
