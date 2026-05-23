import type { ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface DetailLayoutProps {
  actionRail?: ReactNode;
  children: ReactNode;
  className?: string;
  header: ReactNode;
}

export function DetailLayout({ header, children, actionRail, className }: DetailLayoutProps) {
  return (
    <div className={cn('grid gap-6', className)}>
      <div>{header}</div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        {actionRail ? (
          <div className="min-w-0 xl:order-last" data-detail-layout-rail="">
            {actionRail}
          </div>
        ) : null}
        <div className="grid min-w-0 gap-6" data-detail-layout-content="">
          {children}
        </div>
      </div>
    </div>
  );
}
