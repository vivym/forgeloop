import { Link } from 'react-router';

import { useDashboardQuery } from '../../../shared/api/hooks';
import { useProjectContext } from '../../../shared/context/project-context';
import { Metric, MetricGrid, PageHeader, Section } from '../../../shared/layout';
import { Button, InlineNotice, StatusPill } from '../../../shared/ui';
import { stateFromStatus, SurfaceStateIndicator, type SurfaceState } from '../../../features/project-management/surface-state';

export default function DashboardRoute() {
  const { projectId } = useProjectContext();
  const query = useDashboardQuery({ project_id: projectId });
  const sections = query.data?.sections ?? [];
  const nextActions = query.data?.next_actions ?? [];
  const reportLinks = query.data?.report_links ?? [];

  return (
    <div className="grid gap-6">
      <PageHeader
        actions={
          <>
            <ActionLink href="/my-work">Unblock</ActionLink>
            <ActionLink href="/board">Escalate</ActionLink>
            <ActionLink href="/my-work?mode=reprioritize">Reprioritize</ActionLink>
            <Link
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-semibold text-primary hover:border-primary hover:bg-primary-soft"
              to="/reports"
            >
              Inspect bottleneck reports
            </Link>
          </>
        }
        subtitle="AI-native delivery health across source objects, Development Plan Items, execution, review, QA, and release."
        title="Dashboard"
      />
      <SurfaceStateIndicator label="Dashboard" state={dashboardSurfaceState(query)} />
      {query.isLoading ? <InlineNotice title="Loading Dashboard." tone="info" /> : null}
      {query.isError ? <InlineNotice title="Dashboard could not be loaded." tone="danger" /> : null}
      <MetricGrid>
        {dashboardSections(sections).map((section) => (
          <Metric key={section.id} label={section.label} value={String(section.value)} />
        ))}
      </MetricGrid>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Section
          description="The cockpit keeps product, technical leadership, development, QA, and release roles on the same typed delivery loop."
          title="Flow health"
        >
          <div className="grid gap-3 md:grid-cols-2">
            {dashboardSections(sections).map((section) => (
              <article className="grid gap-2 rounded-md border border-border bg-background p-3" key={section.id}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-text-primary">{section.label}</h2>
                  <StatusPill tone={section.id === 'blocked-work' && Number(section.value) > 0 ? 'warning' : 'info'}>
                    {String(section.value)}
                  </StatusPill>
                </div>
                <p className="text-sm text-text-secondary">{sectionDescription(section.id)}</p>
              </article>
            ))}
          </div>
        </Section>
        <Section title="Trend reports">
          <div className="grid gap-3 text-sm">
            {(reportLinks.length ? reportLinks : [{ id: 'reports', label: 'Inspect bottleneck reports', href: '/reports' }]).map((link) => (
              <Link className="font-semibold text-primary hover:underline" key={String(link.id)} to={dashboardReportHref(link)}>
                {String(link.label ?? 'Inspect report')}
              </Link>
            ))}
            {nextActions.map((action) => (
              <InlineNotice key={String(action.id)} title={String(action.label ?? 'Review next action')} tone="neutral" />
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

function dashboardSections(sections: Array<Record<string, unknown>>) {
  const byId = new Map(sections.map((section) => [String(section.id), section]));
  return [
    { id: 'flow-health', label: 'Flow health' },
    { id: 'blocked-work', label: 'Blocked work' },
    { id: 'aging', label: 'Aging' },
    { id: 'risk-concentration', label: 'Risk concentration' },
    { id: 'role-load', label: 'Role load' },
    { id: 'release-confidence', label: 'Release confidence' },
  ].map((section) => ({
    ...section,
    value: byId.get(section.id)?.value ?? 0,
  }));
}

function sectionDescription(id: string): string {
  const descriptions: Record<string, string> = {
    'flow-health': 'Movement from source object to Development Plan Item gates.',
    'blocked-work': 'Gate blockers across boundary, Spec, Execution Plan, execution, review, QA, and release.',
    aging: 'Objects whose current role action has aged past the operating threshold.',
    'risk-concentration': 'High and critical risk concentration across source objects and plan rows.',
    'role-load': 'Distribution of active attention across Product, Tech Lead, Developer, QA, and release coordination roles.',
    'release-confidence': 'Current release readiness based on review, QA, evidence, and known risk.',
  };
  return descriptions[id] ?? 'Project-management signal.';
}

function dashboardSurfaceState(query: ReturnType<typeof useDashboardQuery>): SurfaceState | undefined {
  if (query.isLoading) return 'loading';
  if (query.isError) return 'error';
  const data = query.data;
  if (data === undefined || data.sections.length === 0) return 'empty';
  if (data.degraded_sources.some((source) => source.includes('stale'))) return 'stale';
  const sections = dashboardSections(data.sections);
  if (Number(sections.find((section) => section.id === 'blocked-work')?.value ?? 0) > 0) return 'blocked';
  const statusState = data.next_actions.map((action) => stateFromStatus(String(action.label ?? ''))).find(Boolean);
  if (statusState) return statusState;
  if (Number(sections.find((section) => section.id === 'release-confidence')?.value ?? 0) > 0) return 'approved';
  return undefined;
}

const registeredDashboardReportHrefs = new Set(['/reports', '/reports/delivery', '/reports/quality', '/reports/release-readiness', '/reports/observation']);

function dashboardReportHref(link: Record<string, unknown>): string {
  const href = typeof link.href === 'string' ? link.href : undefined;
  if (href !== undefined && registeredDashboardReportHrefs.has(href)) return href;

  const id = String(link.id ?? '');
  if (id.includes('release')) return '/reports/release-readiness';
  if (id.includes('quality') || id.includes('qa') || id.includes('code-review')) return '/reports/quality';
  if (id.includes('observation')) return '/reports/observation';
  if (id.includes('replay')) return '/reports?report=replay';
  if (id.includes('delivery') || id.includes('execution') || id.includes('spec') || id.includes('brainstorming')) return '/reports/delivery';
  return '/reports';
}

function ActionLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-semibold text-text-primary hover:border-border-strong hover:bg-surface-muted"
      to={href}
    >
      {children}
    </Link>
  );
}
