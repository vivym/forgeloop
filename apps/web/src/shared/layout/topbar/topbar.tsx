import type { ReactNode } from 'react';

import { SegmentedControl } from '../../ui';
import { cn } from '../../utils/cn';

export interface TopbarProps {
  actions?: ReactNode;
  actorId?: string;
  children?: ReactNode;
  className?: string;
  devToolsEnabled?: boolean;
  projectId?: string;
}

export function Topbar({ actions, actorId, children, className, devToolsEnabled, projectId }: TopbarProps) {
  const content =
    children ??
    (projectId || actorId || devToolsEnabled !== undefined ? (
      <div className="flex min-w-0 flex-wrap items-center gap-3 text-sm">
        <label className="sr-only" htmlFor="command-search">Command search</label>
        <input
          className="hidden h-9 w-64 max-w-full rounded-md border border-border bg-background px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/20 lg:block"
          id="command-search"
          placeholder="Search commands, objects, or reports"
          type="search"
        />
        <SegmentedControl
          ariaLabel="Global role selection"
          className="hidden lg:inline-flex"
          defaultValue="product"
          options={[
            { label: 'Product', value: 'product' },
            { label: 'Tech Lead', value: 'tech-lead' },
            { label: 'Developer', value: 'developer' },
            { label: 'QA', value: 'qa' },
          ]}
        />
        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {projectId ? (
            <div className="flex items-center gap-1.5">
              <dt className="text-text-secondary">Project</dt>
              <dd className="font-medium text-text-primary">Context active</dd>
            </div>
          ) : null}
          {actorId ? (
            <div className="flex items-center gap-1.5">
              <dt className="text-text-secondary">Actor</dt>
              <dd className="font-medium text-text-primary">Authenticated</dd>
            </div>
          ) : null}
          <div className="flex items-center gap-1.5">
            <dt className="text-text-secondary">Runtime</dt>
            <dd className="font-medium text-success">Ready</dd>
          </div>
          {devToolsEnabled ? (
            <div className="flex items-center gap-1.5">
              <dt className="text-text-secondary">Dev Tools</dt>
              <dd className="font-medium text-success">Visible</dd>
            </div>
          ) : null}
        </dl>
      </div>
    ) : null);

  return (
    <div
      className={cn('flex min-w-0 flex-1 items-center justify-between gap-3', className)}
      data-actor-context={actorId ? 'active' : undefined}
      data-dev-tools-enabled={devToolsEnabled === undefined ? undefined : String(devToolsEnabled)}
      data-project-context={projectId ? 'active' : undefined}
      data-topbar-context=""
    >
      <div className="min-w-0">{content}</div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
