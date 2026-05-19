import type { ReactNode } from 'react';

export interface DetailLayoutProps {
  actionRail?: ReactNode;
  children: ReactNode;
  header: ReactNode;
}

export function DetailLayout({ header, children, actionRail }: DetailLayoutProps) {
  return (
    <div className="fl-detail-layout">
      <div className="fl-detail-layout__header">{header}</div>
      <div className="fl-detail-layout__body">
        <div className="fl-detail-layout__content">{children}</div>
        {actionRail ? <div className="fl-detail-layout__rail">{actionRail}</div> : null}
      </div>
    </div>
  );
}
