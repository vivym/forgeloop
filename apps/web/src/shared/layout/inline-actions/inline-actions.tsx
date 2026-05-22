import type { HTMLAttributes } from 'react';

import { cn } from '../../utils/cn';

export type InlineActionsProps = HTMLAttributes<HTMLDivElement>;

export function InlineActions({ children, className, ...props }: InlineActionsProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} {...props}>
      {children}
    </div>
  );
}
