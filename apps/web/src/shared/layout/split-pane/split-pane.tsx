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
    <div className={cn('fl-split-pane', `fl-split-pane--${asidePosition}`, className)}>
      <div className="fl-split-pane__main">{children}</div>
      <aside className="fl-split-pane__aside">{aside}</aside>
    </div>
  );
}
