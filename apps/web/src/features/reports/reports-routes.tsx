import { Link } from 'react-router';

import { useReportQuery } from '../../shared/api/hooks';
import { useProjectContext } from '../../shared/context/project-context';
import { Metric, MetricGrid, PageHeader, Section } from '../../shared/layout';
import { InlineNotice, StatusPill } from '../../shared/ui';

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
    summary: 'Flow, bottlenecks, and task movement across product lifecycle objects.',
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
    href: '/reports/replay',
    summary: 'Retrospective evidence and lifecycle replay for project management objects.',
    metrics: [
      { label: 'Replay scope', value: 'Product' },
      { label: 'Evidence', value: 'Task-scoped' },
    ],
  },
];

export function ReportsIndexRoute() {
  return (
    <>
      <PageHeader subtitle="Delivery, quality, readiness, observation, and replay reporting." title="Reports" />
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
    </>
  );
}

export function ReportFamilyRoute({ reportId }: { reportId: ReportId }) {
  const { projectId } = useProjectContext();
  const report = reportCatalog.find((candidate) => candidate.id === reportId) ?? reportCatalog[0]!;
  const query = useReportQuery(report.id, { project_id: projectId, limit: 100 });

  return (
    <>
      <PageHeader subtitle={report.summary} title={report.title} />
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
            This report summarizes typed project-management objects and links follow-up work through task-scoped evidence routes.
          </p>
        </div>
      </Section>
    </>
  );
}

function formatDate(value: string | undefined): string {
  return value === undefined ? 'Pending' : new Date(value).toLocaleString();
}
