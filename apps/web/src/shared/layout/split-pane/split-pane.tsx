import type { ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface SplitPaneProps {
  aside: ReactNode;
  children: ReactNode;
  asidePosition?: 'left' | 'right';
  className?: string;
}

export function SplitPane({ aside, asidePosition = 'right', children, className }: SplitPaneProps) {
  return (
    <div
      className={cn(
        'grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]',
        asidePosition === 'left' && 'lg:grid-cols-[18rem_minmax(0,1fr)]',
        className,
      )}
    >
      <div className={cn('min-w-0', asidePosition === 'left' && 'lg:order-2')}>{children}</div>
      <aside className={cn('min-w-0', asidePosition === 'left' && 'lg:order-1')}>{aside}</aside>
    </div>
  );
}
