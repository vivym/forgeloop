import { Link } from 'react-router';

import { useDashboardQuery } from '../../shared/api/hooks';
import { useProjectContext } from '../../shared/context/project-context';
import { CockpitCommandCenter } from '../../shared/layout';
import { InlineNotice, StatusPill } from '../../shared/ui';
import {
  cockpitCommandCenterViewModel,
  type CockpitAttentionItem,
  type CockpitCommandCenterViewModel,
} from './cockpit-view-model';

type DashboardQuery = NonNullable<ReturnType<typeof useDashboardQuery>['data']>;

export function CockpitRoute() {
  const { projectId } = useProjectContext();
  const query = useDashboardQuery({ project_id: projectId });
  const viewModel = cockpitCommandCenterViewModel(query.data ?? emptyDashboard(projectId));

  return (
    <section aria-label="Cockpit" className="min-w-0" data-page-family="cockpit">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-normal text-text-secondary">Command center</p>
          <h1 className="text-xl font-semibold text-text-primary">Cockpit</h1>
        </div>
        {query.isLoading ? <InlineNotice title="Loading Cockpit." tone="info" /> : null}
        {query.isError ? <InlineNotice title="Cockpit could not be loaded." tone="danger" /> : null}
      </div>

      <CockpitCommandCenter
        attentionQueue={
          <div className="grid gap-4 xl:grid-cols-[minmax(24rem,1fr)_18rem]">
            <AttentionQueue items={viewModel.attentionItems} />
            <FlowStrip model={viewModel} />
          </div>
        }
        commandStrip={<CommandStrip isError={query.isError} isLoading={query.isLoading} model={viewModel} projectId={projectId} />}
        riskRail={<RiskReadinessRail model={viewModel} />}
        runtimeRail={<RuntimeStatus model={viewModel} />}
      />
    </section>
  );
}

function CommandStrip({
  isError,
  isLoading,
  model,
  projectId,
}: {
  isError: boolean;
  isLoading: boolean;
  model: CockpitCommandCenterViewModel;
  projectId: string;
}) {
  return (
    <div className="grid gap-2 rounded-card border border-border bg-surface-subtle p-2 lg:grid-cols-[minmax(10rem,0.7fr)_minmax(10rem,0.7fr)_minmax(14rem,1fr)_auto] lg:items-center">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-normal text-text-secondary">Project</p>
        <p className="truncate text-sm font-semibold text-text-primary">{projectId}</p>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-normal text-text-secondary">Role lens</p>
        <p className="truncate text-sm font-semibold text-text-primary">{model.roleLens.label}</p>
      </div>
      <label className="min-w-0" htmlFor="cockpit-command-search">
        <span className="block text-xs font-semibold uppercase tracking-normal text-text-secondary">Cockpit command search</span>
        <input
          className="mt-1 w-full rounded-button border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          id="cockpit-command-search"
          placeholder="Search blockers, reviews, QA, runtime"
          type="search"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={isError ? 'danger' : isLoading ? 'warning' : 'success'}>
          Runtime {isError ? 'error' : isLoading ? 'loading' : 'current'}
        </StatusPill>
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-button border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary transition-colors duration-base ease-standard hover:border-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none">
            Create / action
          </summary>
          <div className="absolute right-0 z-10 mt-2 grid w-44 gap-1 rounded-card border border-border bg-surface p-2 shadow-popover">
            <Link className="rounded-button px-2 py-1.5 text-xs font-semibold text-text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" to="/development-plans/new">
              New Development Plan
            </Link>
            <Link className="rounded-button px-2 py-1.5 text-xs font-semibold text-text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" to="/my-work">
              Open role queue
            </Link>
          </div>
        </details>
        <Link
          className="rounded-button border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary transition-colors duration-base ease-standard hover:border-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none"
          to="/my-work"
        >
          Command queue
        </Link>
      </div>
    </div>
  );
}

function AttentionQueue({ items }: { items: CockpitCommandCenterViewModel['attentionItems'] }) {
  return (
    <section
      aria-label="Priority attention queue"
      className="grid min-w-0 gap-3"
      data-attention-queue=""
      data-primary-work-surface=""
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-text-secondary">Priority attention</p>
          <h2 className="text-lg font-semibold text-text-primary">Release blockers, code-review changes, QA, Spec, and Codex continuity</h2>
        </div>
        <StatusPill tone="warning">{items.length} active</StatusPill>
      </div>
      <ol className="m-0 grid list-none gap-2 p-0">
        {items.map((item) => (
          <li key={item.id}>
            <AttentionCard item={item} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function AttentionCard({ item }: { item: CockpitAttentionItem }) {
  const content = (
    <div className="grid gap-2 rounded-card border border-border bg-surface p-3 transition-colors duration-base ease-standard hover:border-primary hover:bg-primary-soft motion-reduce:transition-none">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={item.severity === 'critical' ? 'danger' : item.severity === 'high' ? 'warning' : 'info'}>
          {item.severity}
        </StatusPill>
        <span className="text-xs font-semibold uppercase tracking-normal text-text-secondary">{item.stage_id ?? item.kind}</span>
      </div>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-text-primary">{item.label}</h3>
        <p className="mt-1 text-sm text-text-secondary">{item.next_action}</p>
      </div>
      <p className="text-xs text-text-tertiary">
        {item.typed_ref.type.replaceAll('_', ' ')} · {item.typed_ref.title ?? item.typed_ref.id}
      </p>
    </div>
  );

  return item.href === undefined ? (
    content
  ) : (
    <Link className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" to={item.href}>
      {content}
    </Link>
  );
}

function RiskReadinessRail({ model }: { model: CockpitCommandCenterViewModel }) {
  return (
    <section
      aria-label="Risk and readiness rail"
      className="grid gap-3 rounded-card border border-border bg-surface p-3"
      data-risk-readiness-rail=""
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-normal text-text-secondary">Risk and readiness</p>
        <h2 className="text-base font-semibold text-text-primary">Release blocker rail</h2>
      </div>
      <ul className="m-0 grid list-none gap-2 p-0">
        {model.riskRail.map((item) => (
          <li key={`${item.kind}-${item.label}`} className="grid gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0">
            <span className="text-sm font-semibold text-text-primary">{item.label}</span>
            <span className="text-xs text-text-secondary">{item.summary}</span>
          </li>
        ))}
      </ul>
      {model.degradedStates.length > 0 ? (
        <div className="rounded-card border border-warning bg-warning-soft p-2 text-xs text-text-primary">
          {model.degradedStates.map((state) => state.label).join(', ')}
        </div>
      ) : null}
    </section>
  );
}

function RuntimeStatus({ model }: { model: CockpitCommandCenterViewModel }) {
  return (
    <section aria-label="Runtime status" className="grid gap-3 rounded-card border border-border bg-surface p-3" data-runtime-status="">
      <div>
        <p className="text-xs font-semibold uppercase tracking-normal text-text-secondary">Runtime status</p>
        <h2 className="text-base font-semibold text-text-primary">Active and resumable Codex execution</h2>
      </div>
      <ul className="m-0 grid list-none gap-2 p-0">
        {model.runtimeSignals.length > 0 ? model.runtimeSignals.map((signal) => (
          <li key={signal.execution_id} className="grid gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0">
            {signal.href === undefined ? (
              <span className="text-sm font-semibold text-text-primary">{signal.label}</span>
            ) : (
              <Link className="text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" to={signal.href}>
                {signal.label}
              </Link>
            )}
            <span className="text-xs text-text-secondary">
              {signal.state} · {signal.resumable ? 'resumable' : 'active'}
            </span>
          </li>
        )) : (
          <li className="text-sm text-text-secondary">No active or resumable Codex execution signal.</li>
        )}
      </ul>
    </section>
  );
}

function FlowStrip({ model }: { model: CockpitCommandCenterViewModel }) {
  return (
    <section aria-label="Delivery flow strip" className="grid gap-2" data-flow-strip="">
      <p className="text-xs font-semibold uppercase tracking-normal text-text-secondary">Delivery flow</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-1">
        {model.flowStrip.map((stage) => (
          <div key={stage.id} className="rounded-card border border-border bg-surface-subtle p-2">
            <span className="block text-xs font-semibold text-text-secondary">{stage.label}</span>
            <span className="text-lg font-semibold text-text-primary">{stage.count}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function emptyDashboard(projectId: string): DashboardQuery {
  return {
    project_id: projectId,
    sections: [],
    next_actions: [],
    runtime_signals: [],
    report_links: [],
    degraded_sources: [],
  };
}
