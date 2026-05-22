import type { ReactNode } from 'react';

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
      <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
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
        {devToolsEnabled ? (
          <div className="flex items-center gap-1.5">
            <dt className="text-text-secondary">Dev Tools</dt>
            <dd className="font-medium text-success">Visible</dd>
          </div>
        ) : null}
      </dl>
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
