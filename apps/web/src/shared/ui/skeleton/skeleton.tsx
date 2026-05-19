import type { HTMLAttributes } from 'react';

import { cn } from '../../utils/cn';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  lines?: number;
}

export function Skeleton({ className, lines = 1, ...props }: SkeletonProps) {
  return (
    <div aria-hidden="true" className={cn('fl-skeleton-group', className)} {...props}>
      {Array.from({ length: lines }, (_, index) => (
        <span className="fl-skeleton" key={index} />
      ))}
    </div>
  );
}
