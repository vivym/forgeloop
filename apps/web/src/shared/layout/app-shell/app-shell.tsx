import { useState, type ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface AppShellProps {
  children: ReactNode;
  sidebar?: ReactNode;
  topbar?: ReactNode;
  className?: string;
}

export function AppShell({ children, sidebar, topbar, className }: AppShellProps) {
  const [navigationOpen, setNavigationOpen] = useState(false);

  return (
    <div className={cn('fl-app-shell', className)}>
      <a className="fl-skip-link" href="#main-content">
        Skip to main content
      </a>
      {sidebar ? (
        <aside
          aria-label="Primary navigation"
          className={cn('fl-app-shell__sidebar', navigationOpen && 'is-open')}
          id="primary-navigation"
        >
          {sidebar}
        </aside>
      ) : null}
      <div className="fl-app-shell__main">
        <header className="fl-app-shell__topbar">
          {sidebar ? (
            <button
              aria-controls="primary-navigation"
              aria-expanded={navigationOpen}
              className="fl-app-shell__nav-trigger"
              onClick={() => setNavigationOpen((current) => !current)}
              type="button"
            >
              Open navigation
            </button>
          ) : null}
          {topbar}
        </header>
        <main className="fl-app-shell__content" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
