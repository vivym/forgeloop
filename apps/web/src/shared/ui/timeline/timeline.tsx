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
    <ol className={cn('fl-timeline', className)} {...props}>
      {items.map((item) => (
        <li className="fl-timeline__item" key={item.id}>
          <div aria-hidden="true" className="fl-timeline__marker" />
          <div className="fl-timeline__content">
            <div className="fl-timeline__title">{item.title}</div>
            {item.description ? <div className="fl-timeline__description">{item.description}</div> : null}
            {item.meta ? <div className="fl-timeline__meta">{item.meta}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
