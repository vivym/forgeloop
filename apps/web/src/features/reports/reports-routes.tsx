import { Link, Navigate, useSearchParams } from 'react-router';
import type { ReactNode } from 'react';

import { useReportQuery } from '../../shared/api/hooks';
import type { ProductObjectRef } from '../../shared/api/types';
import { useProjectContext } from '../../shared/context/project-context';
import { useRuntimeFlags } from '../../shared/context/runtime-flags';
import { CompactMetadata, ProductPage, ReportInsightLayout, Section } from '../../shared/layout';
import { DataTable, InlineNotice, StatusPill, type DataTableColumn } from '../../shared/ui';
import { stateFromStatus, SurfaceStateIndicator, type SurfaceState } from '../project-management/surface-state';
import { reportViewModel, type ReportProjection } from './report-view-model';

type ReportId = 'delivery' | 'quality' | 'release-readiness' | 'observation';
type BackendReportId =
  | 'development-plan-throughput'
  | 'execution-continuation'
  | 'execution-outcomes'
  | 'quality-bug-escape'
  | 'release-readiness';

type ReportCatalogItem = {
  id: ReportId;
  backendReportId: BackendReportId;
  title: string;
  href: string;
  summary: string;
  owner: string;
};

type ReportGroupRow = {
  affectedCount: number;
  id: string;
  count: number;
  affected: string;
};

const reportCatalog: ReportCatalogItem[] = [
  {
    id: 'delivery',
    backendReportId: 'development-plan-throughput',
    title: 'Delivery Flow',
    href: '/reports/delivery',
    summary: 'Flow, bottlenecks, and Development Plan Item movement across product lifecycle objects.',
    owner: 'Product',
  },
  {
    id: 'quality',
    backendReportId: 'quality-bug-escape',
    title: 'Quality',
    href: '/reports/quality',
    summary: 'Bug escape, validation coverage, and QA acceptance risk.',
    owner: 'QA',
  },
  {
    id: 'release-readiness',
    backendReportId: 'release-readiness',
    title: 'Release Readiness',
    href: '/reports/release-readiness',
    summary: 'Readiness evidence, release risk, disabled reasons, and scope gates.',
    owner: 'Release',
  },
  {
    id: 'observation',
    backendReportId: 'execution-outcomes',
    title: 'Observation',
    href: '/reports/observation',
    summary: 'Post-release signals, observation evidence, and regression follow-up.',
    owner: 'Manager',
  },
];

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

export function ReportsIndexRoute() {
  const { projectId } = useProjectContext();
  const runtimeFlags = useRuntimeFlags();
  const [searchParams] = useSearchParams();
  const report = reportCatalog[0]!;
  const query = useReportQuery(report.backendReportId, { project_id: projectId, limit: 100 });
  const context = reportContextFromSearchParams(searchParams);
  const viewModel = reportViewModel(reportProjection(query.data, report));

  if (retiredReportQueryRequested(searchParams)) {
    return runtimeFlags.devToolsEnabled ? <ReplayDevOnlyPanel /> : <Navigate replace to="/reports" />;
  }

  return (
    <ReportWorkspace
      context={context}
      heading="Reports"
      isError={query.isError}
      isLoading={query.isLoading}
      report={report}
      reportData={query.data}
      stateLabel="Reports"
      viewModel={viewModel}
    >
      <Section title="Product metric sections">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {metricSections.map((section) => (
            <article className="grid gap-2 rounded-card border border-border bg-surface p-3" key={section.title}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-text-primary">{section.title}</h3>
                <StatusPill tone="info">{section.owner}</StatusPill>
              </div>
              <p className="m-0 text-sm text-text-secondary">{section.summary}</p>
            </article>
          ))}
        </div>
      </Section>
      <Section title="Report families">
        <div className="grid gap-3 md:grid-cols-2">
          {reportCatalog.map((candidate) => (
            <Link
              className="grid gap-2 rounded-card border border-border bg-surface p-4 shadow-sm transition-colors duration-base ease-standard hover:border-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none"
              key={candidate.id}
              to={candidate.href}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-text-primary">{candidate.title}</h3>
                <StatusPill tone="info">{candidate.owner}</StatusPill>
              </div>
              <p className="m-0 text-sm text-text-secondary">{candidate.summary}</p>
            </Link>
          ))}
        </div>
      </Section>
    </ReportWorkspace>
  );
}

function ReplayDevOnlyPanel() {
  return (
    <ProductPage family="report-insight" heading="Reports Replay Dev Panel">
      <Section title="Report unavailable">
        <InlineNotice title="Lifecycle replay evidence context is available only with dev tools enabled." tone="warning" />
      </Section>
    </ProductPage>
  );
}

export function ReportFamilyRoute({ reportId }: { reportId: ReportId }) {
  const { projectId } = useProjectContext();
  const report = reportCatalog.find((candidate) => candidate.id === reportId) ?? reportCatalog[0]!;
  const query = useReportQuery(report.backendReportId, { project_id: projectId, limit: 100 });
  const viewModel = reportViewModel(reportProjection(query.data, report));

  return (
    <ReportWorkspace
      heading={report.title}
      isError={query.isError}
      isLoading={query.isLoading}
      report={report}
      reportData={query.data}
      stateLabel={`${report.title} report`}
      viewModel={viewModel}
    />
  );
}

function ReportWorkspace({
  children,
  context,
  heading,
  isError,
  isLoading,
  report,
  reportData,
  stateLabel,
  viewModel,
}: {
  children?: ReactNode;
  context?: { title: string; description: string } | undefined;
  heading: string;
  isError: boolean;
  isLoading: boolean;
  report: ReportCatalogItem;
  reportData: Record<string, unknown> | undefined;
  stateLabel: string;
  viewModel: ReturnType<typeof reportViewModel>;
}) {
  const conclusion = viewModel.conclusion ?? viewModel.currentState;
  const supporting = supportingSignal(reportData);
  const affected = affectedObjects(reportData);
  const suggestedAction = viewModel.suggestedAction?.label ?? viewModel.nextAction;

  return (
    <ProductPage family="report-insight" heading={heading}>
      <ReportInsightLayout
        conclusion={
          <div className="grid gap-3">
            <SurfaceStateIndicator label={stateLabel} state={reportSurfaceState(isLoading, isError, reportData)} />
            {isLoading ? <InlineNotice title={`${heading} report is loading.`} tone="info" /> : null}
            {isError ? <InlineNotice title={`${heading} report could not be loaded.`} tone="danger" /> : null}
            {context !== undefined ? <InlineNotice description={context.description} title={context.title} tone="info" /> : null}
            <ReportConclusion
              affected={affected}
              conclusion={conclusion}
              report={report}
              riskSignal={viewModel.riskSignal}
              suggestedAction={suggestedAction}
              supportingSignal={supporting}
            />
            {children}
          </div>
        }
        signals={<ReportSignals report={report} reportData={reportData} />}
        actions={<RecommendedActions action={suggestedAction} report={report} />}
      />
    </ProductPage>
  );
}

function ReportConclusion({
  affected,
  conclusion,
  report,
  riskSignal,
  suggestedAction,
  supportingSignal,
}: {
  affected: string;
  conclusion: string;
  report: ReportCatalogItem;
  riskSignal: string;
  suggestedAction: string;
  supportingSignal: string;
}) {
  return (
    <Section description={report.summary} title="Operational intelligence">
      <p className="sr-only">
        {`Conclusion: ${conclusion}. Supporting signal: ${supportingSignal}. Affected objects: ${affected}. Suggested action: ${suggestedAction}. ${riskSignal}`}
      </p>
      <CompactMetadata
        items={[
          { label: 'Conclusion', value: conclusion },
          { label: 'Supporting signal', value: supportingSignal },
          { label: 'Affected objects', value: affected },
          { label: 'Suggested action', value: suggestedAction },
        ]}
      />
    </Section>
  );
}

function ReportSignals({ report, reportData }: { report: ReportCatalogItem; reportData: Record<string, unknown> | undefined }) {
  return (
    <Section title={`${report.title} signal`}>
      <DataTable
        ariaLabel={`${report.title} report groups`}
        columns={reportGroupColumns}
        density="compact"
        emptyMessage="No supporting report groups are available."
        getRowKey={(row) => row.id}
        rows={reportGroupRows(reportData)}
      />
    </Section>
  );
}

function RecommendedActions({ action, report }: { action: string; report: ReportCatalogItem }) {
  return (
    <Section title="Recommended actions" variant="subtle">
      <CompactMetadata
        items={[
          { label: 'Primary action', value: action },
          { label: 'Responsible role', value: report.owner },
          { label: 'Report family', value: report.title },
        ]}
      />
    </Section>
  );
}

const reportGroupColumns: DataTableColumn<ReportGroupRow>[] = [
  { key: 'group', header: 'Signal', cell: (row) => formatValue(row.id) },
  { key: 'count', header: 'Supporting count', cell: (row) => String(row.count) },
  { key: 'affected', header: 'Object coverage', cell: (row) => row.affected },
];

function reportProjection(data: Record<string, unknown> | undefined, report: ReportCatalogItem): ReportProjection {
  return {
    id: stringField(data, 'id') ?? report.backendReportId,
    title: stringField(data, 'title') ?? report.title,
    project_id: stringField(data, 'project_id'),
    generated_at: stringField(data, 'generated_at'),
    groups: reportGroups(data),
    links: reportLinks(data),
    degraded_sources: stringArrayField(data, 'degraded_sources'),
  };
}

function reportContextFromSearchParams(searchParams: URLSearchParams): { title: string; description: string } | undefined {
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
  if (developmentPlanItemId !== null) {
    return {
      title: 'Focused evidence context',
      description: `Development Plan Item ${developmentPlanItemId}`,
    };
  }

  return undefined;
}

function retiredReportQueryRequested(searchParams: URLSearchParams): boolean {
  return searchParams.get('report') === 'replay';
}

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

function supportingSignal(data: Record<string, unknown> | undefined): string {
  const groups = reportGroupRows(data);
  if (groups.length === 0) return 'No supporting signal available';
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  return `${groups.length} group(s), ${total} supporting signal(s)`;
}

function affectedObjects(data: Record<string, unknown> | undefined): string {
  const affected = uniqueReportObjectRefs(reportGroups(data).flatMap((group) => productObjectRefs(group.items)));
  if (affected.length === 0) return 'No affected objects in current signal';
  return `${affected.length} affected object(s): ${objectTypeSummary(affected)}`;
}

function reportGroupRows(data: Record<string, unknown> | undefined): ReportGroupRow[] {
  const groups = reportGroups(data);
  return groups.filter(isRecord).map((group, index) => {
    const items = productObjectRefs(group.items);
    const count = typeof group.count === 'number' ? group.count : items.length;
    return {
      id: String(group.id ?? `group-${index + 1}`),
      count,
      affectedCount: items.length,
      affected: affectedLabel(items),
    };
  });
}

function reportGroups(data: Record<string, unknown> | undefined): NonNullable<ReportProjection['groups']> {
  return arrayField(data, 'groups').filter(isRecord).map((group) => ({
    id: typeof group.id === 'string' ? group.id : undefined,
    count: typeof group.count === 'number' ? group.count : undefined,
    items: productObjectRefs(group.items),
  }));
}

function reportLinks(data: Record<string, unknown> | undefined): NonNullable<ReportProjection['links']> {
  return arrayField(data, 'links').filter(isRecord).map((link) => ({
    id: typeof link.id === 'string' ? link.id : undefined,
    href: typeof link.href === 'string' ? link.href : undefined,
  }));
}

function arrayField(data: Record<string, unknown> | undefined, key: string): unknown[] {
  const value = data?.[key];
  return Array.isArray(value) ? value : [];
}

function stringArrayField(data: Record<string, unknown> | undefined, key: string): string[] {
  return arrayField(data, key).map(String);
}

function stringField(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = data?.[key];
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function productObjectRefs(value: unknown): ProductObjectRef[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isProductObjectRef);
}

function isProductObjectRef(value: unknown): value is ProductObjectRef {
  if (!isRecord(value) || typeof value.type !== 'string' || typeof value.id !== 'string') return false;
  if (value.type === 'development_plan_item') return typeof value.development_plan_id === 'string';
  return true;
}

function uniqueReportObjectRefs(items: ProductObjectRef[]): ProductObjectRef[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function affectedLabel(items: ProductObjectRef[]): string {
  if (items.length === 0) return 'No affected object refs';
  return `${items.length} ${items.length === 1 ? 'object' : 'objects'}: ${objectTypeSummary(items)}`;
}

function objectTypeSummary(items: ProductObjectRef[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => `${count} ${formatValue(type)}${count === 1 ? '' : 's'}`)
    .join(', ');
}

function formatValue(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}
