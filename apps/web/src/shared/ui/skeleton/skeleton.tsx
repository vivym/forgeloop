import type { HTMLAttributes } from 'react';

import { cn } from '../../utils/cn';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  lines?: number;
}

export function Skeleton({ className, lines = 1, ...props }: SkeletonProps) {
  return (
    <div aria-hidden="true" className={cn('grid gap-2', className)} {...props}>
      {Array.from({ length: lines }, (_, index) => (
        <span
          className="block h-3.5 rounded-pill bg-surface-muted"
          data-skeleton-line=""
          key={index}
        />
      ))}
    </div>
  );
}
