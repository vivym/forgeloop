import type { ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface AppShellProps {
  children: ReactNode;
  sidebar?: ReactNode;
  topbar?: ReactNode;
  className?: string;
}

export function AppShell({ children, sidebar, topbar, className }: AppShellProps) {
  return (
    <div className={cn('fl-app-shell', className)}>
      {sidebar ? <aside className="fl-app-shell__sidebar">{sidebar}</aside> : null}
      <div className="fl-app-shell__main">
        {topbar ? <div className="fl-app-shell__topbar">{topbar}</div> : null}
        <div className="fl-app-shell__content">{children}</div>
      </div>
    </div>
  );
}
