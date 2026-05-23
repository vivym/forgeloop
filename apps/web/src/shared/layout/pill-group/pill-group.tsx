import type { HTMLAttributes } from 'react';

import { cn } from '../../utils/cn';

export type PillGroupProps = HTMLAttributes<HTMLDivElement>;

export function PillGroup({ children, className, ...props }: PillGroupProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} {...props}>
      {children}
    </div>
  );
}
