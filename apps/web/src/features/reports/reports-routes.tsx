import { Link, useSearchParams } from 'react-router';

import { useReportQuery } from '../../shared/api/hooks';
import { useProjectContext } from '../../shared/context/project-context';
import { Metric, MetricGrid, PageHeader, Section } from '../../shared/layout';
import { InlineNotice, StatusPill } from '../../shared/ui';
import { stateFromStatus, SurfaceStateIndicator, type SurfaceState } from '../project-management/surface-state';

type ReportId = 'delivery' | 'quality' | 'release-readiness' | 'observation' | 'replay';

const reportCatalog: Array<{
  id: ReportId;
  title: string;
  href: string;
  summary: string;
  metrics: Array<{ label: string; value: string }>;
}> = [
  {
    id: 'delivery',
    title: 'Delivery Flow',
    href: '/reports/delivery',
    summary: 'Flow, bottlenecks, and Development Plan Item movement across product lifecycle objects.',
    metrics: [
      { label: 'Flow view', value: 'Typed' },
      { label: 'Bottleneck scan', value: 'Active' },
    ],
  },
  {
    id: 'quality',
    title: 'Quality',
    href: '/reports/quality',
    summary: 'Bug escape, validation coverage, and QA acceptance risk.',
    metrics: [
      { label: 'Bug escape', value: 'Tracked' },
      { label: 'Validation', value: 'Current' },
    ],
  },
  {
    id: 'release-readiness',
    title: 'Release Readiness',
    href: '/reports/release-readiness',
    summary: 'Readiness evidence, release risk, disabled reasons, and scope gates.',
    metrics: [
      { label: 'Readiness', value: 'Scoped' },
      { label: 'Risk', value: 'Reviewed' },
    ],
  },
  {
    id: 'observation',
    title: 'Observation',
    href: '/reports/observation',
    summary: 'Post-release signals, observation evidence, and regression follow-up.',
    metrics: [
      { label: 'Signals', value: 'Observed' },
      { label: 'Follow-up', value: 'Open' },
    ],
  },
  {
    id: 'replay',
    title: 'Replay',
    href: '/reports?report=replay',
    summary: 'Retrospective evidence and lifecycle replay for project management objects.',
    metrics: [
      { label: 'Replay scope', value: 'Product' },
      { label: 'Evidence', value: 'Execution-scoped' },
    ],
  },
];

export function ReportsIndexRoute() {
  const { projectId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const scopedReportId = scopedReportFromSearchParams(searchParams);
  const query = useReportQuery(scopedReportId ?? 'delivery', { project_id: projectId, limit: 100 });
  const context = reportContextFromSearchParams(searchParams);

  return (
    <div className="grid gap-6">
      <PageHeader
        subtitle="Product metrics for the full AI-native loop from Development Plan creation through QA and release."
        title="Reports"
      />
      <SurfaceStateIndicator label="Reports" state={reportSurfaceState(query.isLoading, query.isError, query.data)} />
      {context !== undefined ? <InlineNotice description={context.description} title={context.title} tone="info" /> : null}
      <Section title="Product metric sections">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {metricSections.map((section) => (
            <article className="grid gap-2 rounded-md border border-border bg-background p-3" key={section.title}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-text-primary">{section.title}</h2>
                <StatusPill tone="info">{section.owner}</StatusPill>
              </div>
              <p className="text-sm text-text-secondary">{section.summary}</p>
            </article>
          ))}
        </div>
      </Section>
      <Section title="Report families">
        <div className="grid gap-3 md:grid-cols-2">
          {reportCatalog.map((report) => (
            <Link
              className="grid gap-2 rounded-card border border-border bg-surface p-4 shadow-sm transition-colors duration-base ease-standard hover:border-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none"
              key={report.id}
              to={report.href}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-text-primary">{report.title}</h2>
                <StatusPill tone="info">Report</StatusPill>
              </div>
              <p className="text-sm text-text-secondary">{report.summary}</p>
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}

function reportContextFromSearchParams(searchParams: URLSearchParams): { title: string; description: string } | undefined {
  if (scopedReportFromSearchParams(searchParams) === 'replay') {
    return {
      title: 'Lifecycle replay evidence context',
      description: 'Showing scoped lifecycle evidence inside Reports without exposing a raw replay browser route.',
    };
  }

  const codeReviewHandoffId = searchParams.get('code_review_handoff_id');
  if (codeReviewHandoffId !== null) {
    return {
      title: `Focused code review handoff ${codeReviewHandoffId}`,
      description: 'Showing report families relevant to code review turnaround and quality readiness.',
    };
  }

  const qaHandoffId = searchParams.get('qa_handoff_id');
  if (qaHandoffId !== null) {
    return {
      title: `Focused QA handoff ${qaHandoffId}`,
      description: 'Showing report families relevant to QA handoff readiness and release confidence.',
    };
  }

  const developmentPlanItemId = searchParams.get('development_plan_item_id');
  const reviewPacketId = searchParams.get('review_packet_id');
  if (developmentPlanItemId !== null || reviewPacketId !== null) {
    return {
      title: 'Focused evidence context',
      description: [
        developmentPlanItemId === null ? undefined : `Development Plan Item ${developmentPlanItemId}`,
        reviewPacketId === null ? undefined : `review evidence ${reviewPacketId}`,
      ].filter((part): part is string => part !== undefined).join(' with '),
    };
  }

  return undefined;
}

function scopedReportFromSearchParams(searchParams: URLSearchParams): ReportId | undefined {
  return searchParams.get('report') === 'replay' ? 'replay' : undefined;
}

export function ReportFamilyRoute({ reportId }: { reportId: ReportId }) {
  const { projectId } = useProjectContext();
  const report = reportCatalog.find((candidate) => candidate.id === reportId) ?? reportCatalog[0]!;
  const query = useReportQuery(report.id, { project_id: projectId, limit: 100 });

  return (
    <>
      <PageHeader subtitle={report.summary} title={report.title} />
      <SurfaceStateIndicator label={`${report.title} report`} state={reportSurfaceState(query.isLoading, query.isError, query.data)} />
      {query.isLoading ? <InlineNotice title={`${report.title} report is loading.`} tone="info" /> : null}
      {query.isError ? <InlineNotice title={`${report.title} report could not be loaded.`} tone="danger" /> : null}
      <Section title={`${report.title} summary`}>
        <div className="grid gap-4">
          <MetricGrid>
            {report.metrics.map((metric) => (
              <Metric key={metric.label} label={metric.label} value={metric.value} />
            ))}
            <Metric label="Project" value={query.data?.project_id ?? projectId} />
            <Metric label="Generated" value={formatDate(query.data?.generated_at)} />
          </MetricGrid>
          <p className="text-sm text-text-secondary">
            This report summarizes typed project-management objects and links follow-up work through execution evidence routes.
          </p>
        </div>
      </Section>
    </>
  );
}

const metricSections = [
  {
    title: 'Development Plan throughput',
    owner: 'Product',
    summary: 'Measures how source objects move into Development Plans and plan rows.',
  },
  {
    title: 'Brainstorming bottlenecks',
    owner: 'Tech Lead',
    summary: 'Shows unanswered questions, missing decisions, and stale boundaries.',
  },
  {
    title: 'Spec review aging',
    owner: 'Tech Lead',
    summary: 'Highlights item-scoped Specs waiting for review or regeneration.',
  },
  {
    title: 'Execution Plan review aging',
    owner: 'Tech Lead',
    summary: 'Tracks Execution Plan document review health before Codex execution.',
  },
  {
    title: 'Execution outcomes',
    owner: 'Developer',
    summary: 'Summarizes succeeded, failed, interrupted, and completed Codex executions.',
  },
  {
    title: 'Execution continuation',
    owner: 'Developer',
    summary: 'Separates resumable executions from failed or blocked execution states.',
  },
  {
    title: 'Code review turnaround',
    owner: 'Reviewer',
    summary: 'Tracks handoff age, requested changes, and approval throughput.',
  },
  {
    title: 'QA handoff readiness',
    owner: 'QA',
    summary: 'Shows acceptance criteria, evidence, blockers, and audited exceptions.',
  },
  {
    title: 'Release readiness',
    owner: 'Release',
    summary: 'Combines QA acceptance, evidence, known risks, and rollout blockers.',
  },
  {
    title: 'Quality and bug escape',
    owner: 'QA',
    summary: 'Connects escaped bugs and QA blockers back to source objects and plan rows.',
  },
] as const;

function reportSurfaceState(isLoading: boolean, isError: boolean, data: Record<string, unknown> | undefined): SurfaceState | undefined {
  if (isLoading) return 'loading';
  if (isError) return 'error';
  if (data === undefined) return 'empty';
  const degradedSources = Array.isArray(data.degraded_sources) ? data.degraded_sources.map(String) : [];
  if (degradedSources.some((source) => source.includes('stale'))) return 'stale';
  const groups = Array.isArray(data.groups) ? data.groups : [];
  const groupState = groups.map((group) => (isRecord(group) ? stateFromStatus(String(group.id ?? group.status ?? '')) : undefined)).find(Boolean);
  if (groupState) return groupState;
  return data.generated_at === undefined ? 'empty' : 'approved';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatDate(value: string | undefined): string {
  return value === undefined ? 'Pending' : new Date(value).toLocaleString();
}
