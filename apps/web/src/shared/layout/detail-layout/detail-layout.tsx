import type { ReactNode } from 'react';

export interface DetailLayoutProps {
  actionRail?: ReactNode;
  children: ReactNode;
  header: ReactNode;
}

export function DetailLayout({ header, children, actionRail }: DetailLayoutProps) {
  return (
    <main className="fl-detail-layout" id="main-content">
      <div className="fl-detail-layout__header">{header}</div>
      <div className="fl-detail-layout__body">
        <div className="fl-detail-layout__content">{children}</div>
        {actionRail ? <aside className="fl-detail-layout__rail">{actionRail}</aside> : null}
      </div>
    </main>
  );
}
