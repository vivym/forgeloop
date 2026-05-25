import { useId, type ReactNode } from 'react';

import { Drawer } from '../../ui';
import { cn } from '../../utils/cn';

export interface EvidenceDrawerProps {
  title: ReactNode;
  content: ReactNode;
  trigger?: ReactNode;
  className?: string;
  description?: ReactNode;
  side?: 'left' | 'right';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function EvidenceDrawer({ className, content, description, onOpenChange, open, side = 'right', title, trigger }: EvidenceDrawerProps) {
  const headingId = useId();

  if (trigger || open !== undefined || onOpenChange !== undefined) {
    const drawerProps = {
      content,
      description,
      side,
      title,
      ...(open === undefined ? {} : { open }),
      ...(onOpenChange === undefined ? {} : { onOpenChange }),
    };

    return (
      <Drawer {...drawerProps}>
        {trigger}
      </Drawer>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className={cn('grid gap-3 rounded-card border border-border bg-surface p-4', className)}
      data-evidence-drawer=""
      role="region"
    >
      <div className="min-w-0">
        <h2 className="m-0 text-base font-semibold text-text-primary" id={headingId}>
          {title}
        </h2>
        {description ? <p className="mt-1 text-sm text-text-secondary">{description}</p> : null}
      </div>
      <div className="min-w-0">{content}</div>
    </section>
  );
}
