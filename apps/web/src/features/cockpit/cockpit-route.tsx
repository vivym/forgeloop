import { Link } from 'react-router';

import { useDashboardQuery } from '../../shared/api/hooks';
import { useProjectContext } from '../../shared/context/project-context';
import { CompactMetadata, GateProgress, Section, WorkspacePage } from '../../shared/layout';
import { InlineNotice, StatusPill } from '../../shared/ui';
import { stateFromStatus, SurfaceStateIndicator, type SurfaceState } from '../project-management/surface-state';
import { dashboardCockpitViewModel, type DashboardCockpitViewModel } from './cockpit-view-model';

type DashboardQuery = NonNullable<ReturnType<typeof useDashboardQuery>['data']>;

export function CockpitRoute() {
  const { projectId } = useProjectContext();
  const query = useDashboardQuery({ project_id: projectId });
  const viewModel = dashboardCockpitViewModel(query.data ?? emptyDashboard(projectId));

  return (
    <WorkspacePage
      as="div"
      blockerRisk={viewModel.riskSignal}
      family="cockpit"
      heading="Cockpit"
      layout="workspace"
      nextAction={viewModel.nextAction}
      roleResponsibility={viewModel.primaryActorOrRole}
      state={viewModel.currentState}
      subtitle="Action-first operating cockpit for current delivery state, role responsibility, blockers, execution continuity, review queues, QA, and release readiness."
      toolbar={<StatusPill tone="info">{viewModel.objectType}</StatusPill>}
    >
      <SurfaceStateIndicator label="Cockpit" state={cockpitSurfaceState(query.isLoading, query.isError, query.data)} />
      {query.isLoading ? <InlineNotice title="Loading Cockpit." tone="info" /> : null}
      {query.isError ? <InlineNotice title="Cockpit could not be loaded." tone="danger" /> : null}

      <Section
        description="Role lens output from the current cockpit signal. Items route to canonical product destinations only."
        title="Role-selected next-action queue"
      >
        <MetadataActionList items={viewModel.roleSelectedQueue} />
      </Section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(20rem,0.95fr)]">
        <Section description="Blocker, aging, risk, release, and stale-source gates that require attention." title="Blockers and stale gates">
          <GateProgress
            gates={viewModel.blockerAndStaleGates.map((gate) => ({
              id: String(gate.label),
              label: gate.label,
              status: gate.disabledReason === undefined ? gate.state : `${gate.state}: ${gate.disabledReason}`,
            }))}
          />
        </Section>

        <Section title="Compact health indicators">
          <CompactMetadata items={viewModel.compactHealthIndicators} />
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <AttentionSection
          description="Execution continuity and resumability signals."
          items={viewModel.activeExecutionItems}
          title="Active and resumable executions"
        />
        <AttentionSection
          description="Item-scoped Spec and Execution Plan review attention."
          items={viewModel.specExecutionPlanItems}
          title="Spec / Execution Plan review queue"
        />
        <AttentionSection
          description="QA handoff, release confidence, and readiness evidence attention."
          items={viewModel.qaReleaseAttentionItems}
          title="QA and release readiness attention"
        />
      </div>
    </WorkspacePage>
  );
}

function AttentionSection({
  description,
  items,
  title,
}: {
  description: string;
  items: DashboardCockpitViewModel['activeExecutionItems'];
  title: string;
}) {
  return (
    <Section description={description} title={title}>
      <MetadataActionList items={items} />
    </Section>
  );
}

function MetadataActionList({ items }: { items: DashboardCockpitViewModel['roleSelectedQueue'] }) {
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {items.map((item, index) => (
        <li key={`${item.label}-${index}`}>
          {item.href === undefined ? (
            <div className="grid gap-1 rounded-card border border-border bg-surface p-3">
              <span className="text-sm font-semibold text-text-primary">{item.label}</span>
              <span className="text-xs text-text-secondary">{item.value}</span>
            </div>
          ) : (
            <Link
              className="grid gap-1 rounded-card border border-border bg-surface p-3 transition-colors duration-base ease-standard hover:border-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none"
              to={item.href}
            >
              <span className="text-sm font-semibold text-text-primary">{item.label}</span>
              <span className="text-xs text-text-secondary">{item.value}</span>
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

function cockpitSurfaceState(
  isLoading: boolean,
  isError: boolean,
  data: DashboardQuery | undefined,
): SurfaceState | undefined {
  if (isLoading) return 'loading';
  if (isError) return 'error';
  if (data === undefined || data.sections.length === 0) return 'empty';
  if (data.degraded_sources.some((source) => source.includes('stale'))) return 'stale';
  if (sectionValue(data.sections, 'blocked-work') > 0) return 'blocked';
  const statusState = data.next_actions.map((action) => stateFromStatus(String(action.label ?? ''))).find(Boolean);
  if (statusState) return statusState;
  if (sectionValue(data.sections, 'release-confidence') > 0) return 'approved';
  return undefined;
}

function sectionValue(sections: Array<Record<string, unknown>>, id: string): number {
  const value = sections.find((section) => section.id === id)?.value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function emptyDashboard(projectId: string): DashboardQuery {
  return {
    project_id: projectId,
    sections: [],
    next_actions: [],
    report_links: [],
    degraded_sources: [],
  };
}
