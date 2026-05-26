import { useId, type ReactNode } from 'react';
import { ActionStrip } from '../action-strip/action-strip';
import { PrioritySummary } from '../priority-summary/priority-summary';

export interface WorkspacePageProps {
  as?: 'main' | 'div';
  children: ReactNode;
  family: string;
  heading: ReactNode;
  state: ReactNode;
  nextAction: ReactNode;
  roleResponsibility: ReactNode;
  blockerRisk: ReactNode;
  layout: string;
  subtitle?: ReactNode;
  toolbar?: ReactNode;
}

export function WorkspacePage({
  as: Root = 'main',
  blockerRisk,
  children,
  family,
  heading,
  layout,
  nextAction,
  roleResponsibility,
  state,
  subtitle,
  toolbar,
}: WorkspacePageProps) {
  const headingId = useId();
  const headingLabel = typeof heading === 'string' ? heading : undefined;

  return (
    <Root
      {...(Root === 'main'
        ? {
            'aria-label': headingLabel,
            'aria-labelledby': headingLabel ? undefined : headingId,
          }
        : {})}
      className="grid min-w-0 gap-6 px-4 py-4 md:px-6 md:py-5"
      data-page-family={family}
      data-workspace-layout={layout}
    >
      <header className="grid gap-4" data-first-viewport="">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 lg:flex-1">
            <h1 className="m-0 text-xl font-semibold leading-tight text-text-primary" id={headingId}>
              {heading}
            </h1>
            {subtitle ? <p className="mt-2 text-sm text-text-secondary">{subtitle}</p> : null}
          </div>
          {toolbar ? <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">{toolbar}</div> : null}
        </div>
        <PrioritySummary blockerRisk={blockerRisk} roleResponsibility={roleResponsibility} state={state} />
        <ActionStrip nextAction={nextAction} />
      </header>
      <div className="grid min-w-0 gap-4" data-workspace-content="">
        {children}
      </div>
    </Root>
  );
}
