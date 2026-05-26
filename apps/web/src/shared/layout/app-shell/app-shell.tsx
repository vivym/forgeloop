import { useEffect, useState, type ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface AppShellProps {
  children: ReactNode;
  sidebar?: ReactNode;
  topbar?: ReactNode;
  className?: string;
}

export function AppShell({ children, sidebar, topbar, className }: AppShellProps) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const mobileNavigation = useMobileNavigation();

  return (
    <div className={cn('min-h-screen bg-background text-text-primary lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]', className)}>
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-modal focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-text-primary focus:shadow-elevated"
        href="#main-content"
      >
        Skip to main content
      </a>
      {sidebar ? (
        <aside
          aria-label="Primary navigation"
          className="hidden border-r border-border bg-surface p-3 lg:sticky lg:top-0 lg:z-sticky lg:block lg:h-screen"
          data-desktop-navigation=""
          hidden={mobileNavigation}
        >
          {sidebar}
        </aside>
      ) : null}
      <div className="min-w-0">
        <header className="sticky top-0 z-sticky flex min-h-16 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur lg:px-5">
          {sidebar ? (
            <button
              aria-controls="primary-navigation"
              aria-expanded={navigationOpen}
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-semibold text-text-primary transition-colors duration-base ease-standard hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none lg:hidden"
              onClick={() => setNavigationOpen((current) => !current)}
              type="button"
            >
              {navigationOpen ? 'Close navigation' : 'Open navigation'}
            </button>
          ) : null}
          {topbar}
        </header>
        {sidebar && mobileNavigation ? (
          <aside
            aria-label="Primary navigation"
            className="fixed inset-y-0 left-0 z-drawer w-72 border-r border-border bg-surface p-4 shadow-elevated lg:hidden"
            data-mobile-navigation=""
            hidden={!navigationOpen}
            id="primary-navigation"
          >
            {sidebar}
          </aside>
        ) : null}
        {sidebar && mobileNavigation && navigationOpen ? (
          <div
            aria-hidden="true"
            className="fixed inset-0 z-overlay bg-black/30 lg:hidden"
            onClick={() => setNavigationOpen(false)}
          />
        ) : null}
        <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 outline-none lg:px-6" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

function useMobileNavigation() {
  const [mobileNavigation, setMobileNavigation] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const query = window.matchMedia('(max-width: 1023px)');
    setMobileNavigation(query.matches);

    const onChange = (event: MediaQueryListEvent) => setMobileNavigation(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return mobileNavigation;
}
