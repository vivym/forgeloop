import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, UserCircle } from 'lucide-react';

import { CommandSearch } from '../../navigation/command-search';
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
      <div className="flex min-w-0 flex-1 items-center gap-2 py-2 lg:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <CommandSearch className="w-full sm:max-w-md" />
        <SegmentedControl
          ariaLabel="Global role selection"
          className="hidden shrink-0 xl:inline-flex"
          defaultValue="product"
          options={[
            { label: 'Product', value: 'product' },
            { label: 'Tech Lead', value: 'tech-lead' },
            { label: 'Developer', value: 'developer' },
            { label: 'QA', value: 'qa' },
          ]}
        />
        </div>
        <dl className="hidden shrink-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs md:flex">
          {projectId ? (
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
              <dt className="text-text-muted">Project</dt>
              <dd className="font-medium text-text-primary">Context active</dd>
            </div>
          ) : null}
          {actorId ? (
            <div className="relative">
              <dt className="sr-only">Actor</dt>
              <dd>
                <ActorMenu actorId={actorId} />
              </dd>
            </div>
          ) : null}
          <div className="flex items-center gap-1.5 px-1.5 py-1 text-text-secondary">
            <dt>Runtime</dt>
            <dd className="font-medium text-text-primary">Ready</dd>
          </div>
          {devToolsEnabled ? (
            <div className="flex items-center gap-1.5 px-1.5 py-1 text-text-secondary">
              <dt>Dev Tools</dt>
              <dd className="font-medium text-text-primary">Visible</dd>
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

function ActorMenu({ actorId }: { actorId: string }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-text-primary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <UserCircle aria-hidden="true" className="size-4 text-text-secondary" />
        <span>Authenticated</span>
        <ChevronDown aria-hidden="true" className="size-3.5 text-text-muted" />
      </button>
      {open ? (
        <div
          className="absolute right-0 top-full z-modal mt-2 w-56 rounded-card border border-border bg-surface p-3 text-sm shadow-elevated"
          id={panelId}
        >
          <div className="text-xs font-semibold uppercase text-text-secondary">Current actor</div>
          <div className="mt-1 text-sm font-semibold text-text-primary [overflow-wrap:anywhere]">{actorId}</div>
        </div>
      ) : null}
    </div>
  );
}
