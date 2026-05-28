import { useId, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface PreviewPaneProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'title'> {
  title: ReactNode;
  children: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}

export function PreviewPane({ actions, children, className, meta, title, ...props }: PreviewPaneProps) {
  const headingId = useId();
  const labelledBy = props['aria-labelledby'] ?? headingId;

  return (
    <section
      {...props}
      aria-labelledby={labelledBy}
      className={cn('grid gap-3 rounded-card border border-border bg-surface p-4', className)}
      data-preview-pane=""
      role="region"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="m-0 text-base font-semibold text-text-primary" id={headingId}>
            {title}
          </h2>
          {meta ? <p className="mt-1 text-xs text-text-secondary">{meta}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
