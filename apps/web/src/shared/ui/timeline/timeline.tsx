import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface TimelineItem {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
}

export interface TimelineProps extends HTMLAttributes<HTMLOListElement> {
  items: TimelineItem[];
}

export function Timeline({ items, className, ...props }: TimelineProps) {
  return (
    <ol className={cn('m-0 grid list-none gap-4 p-0', className)} {...props}>
      {items.map((item) => (
        <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-3" key={item.id}>
          <div aria-hidden="true" className="mt-1.5 size-2.5 rounded-pill bg-primary" />
          <div className="min-w-0">
            <div className="font-semibold text-text-primary">{item.title}</div>
            {item.description ? <div className="text-sm text-text-secondary">{item.description}</div> : null}
            {item.meta ? <div className="text-sm text-text-secondary">{item.meta}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
