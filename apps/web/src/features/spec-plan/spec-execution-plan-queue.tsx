import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { useSpecExecutionPlanQueueQuery } from '../../shared/api/hooks';
import { useProjectContext } from '../../shared/context/project-context';
import { CompactMetadata, InlineActions, PreviewPane, QueueWorkspace, Section } from '../../shared/layout';
import { Badge, DataTable, EmptyState, InlineNotice, StatusPill, type DataTableColumn } from '../../shared/ui';
import { SurfaceStateIndicator, type SurfaceState } from '../project-management/surface-state';
import {
  specPlanQueueGroups,
  specPlanQueueViewModel,
  type SpecPlanQueueGroup,
  type SpecPlanQueueItem,
  type SpecPlanQueueRow,
} from './spec-plan-view-model';

const selectedSegmentClass =
  'inline-flex min-h-9 items-center justify-center rounded-md border border-primary bg-primary px-3 text-sm font-semibold text-white transition-colors duration-base ease-standard';
const unselectedSegmentClass =
  'inline-flex min-h-9 items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-semibold text-text-primary transition-colors duration-base ease-standard hover:border-border-strong hover:bg-surface-muted';
const secondaryLinkClass = 'text-sm font-semibold text-primary hover:underline';

export function SpecExecutionPlanQueue() {
  const { projectId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'plans' ? 'plans' : 'specs';
  const focusedDevelopmentPlanId = searchParams.get('development_plan_id');
  const focusedDevelopmentPlanItemId = searchParams.get('development_plan_item_id');
  const query = useSpecExecutionPlanQueueQuery({ project_id: projectId, limit: 100 });
  const queueProjection = useMemo(
    () => ({
      items: (query.data?.items ?? []) as unknown as SpecPlanQueueItem[],
      degraded_sources: Array.isArray(query.data?.degraded_sources) ? (query.data.degraded_sources as string[]) : [],
    }),
    [query.data?.degraded_sources, query.data?.items],
  );
  const baseViewModel = useMemo(() => specPlanQueueViewModel(queueProjection), [queueProjection]);
  const rows = useMemo(
    () => baseViewModel.rows
      .filter((row) => (activeTab === 'specs' ? row.artifactType === 'spec' : row.artifactType === 'execution_plan'))
      .filter((row) => isFocusedQueueRow(row, focusedDevelopmentPlanId, focusedDevelopmentPlanItemId)),
    [activeTab, baseViewModel.rows, focusedDevelopmentPlanId, focusedDevelopmentPlanItemId],
  );
  const groups = useMemo(() => specPlanQueueGroups(rows), [rows]);
  const viewModel = useMemo(
    () => specPlanQueueViewModel({ items: rows.map(rowToQueueItem), degraded_sources: queueProjection.degraded_sources }),
    [queueProjection.degraded_sources, rows],
  );
  const [focusedRowKey, setFocusedRowKey] = useState<string | undefined>(undefined);
  const focusedRow = rows.find((row) => row.id === focusedRowKey) ?? rows[0];

  useEffect(() => {
    if (rows.length === 0) {
      setFocusedRowKey(undefined);
      return;
    }
    if (focusedRowKey === undefined || !rows.some((row) => row.id === focusedRowKey)) {
      setFocusedRowKey(rows[0]?.id);
    }
  }, [focusedRowKey, rows]);

  const state = query.isLoading ? 'Loading governance queue' : query.isError ? 'Governance queue unavailable' : viewModel.currentState;
  const blockerRisk = query.isError ? 'Specs & Execution Plans governance risk could not be loaded.' : viewModel.riskSignal;
  const nextAction = focusedRow?.nextAction ?? viewModel.nextAction;
  const roleResponsibility = focusedRow?.reviewer ?? viewModel.primaryActorOrRole;

  return (
    <QueueWorkspace
      as="div"
      blockerRisk={blockerRisk}
      family="governance-queue"
      heading="Specs & Execution Plans"
      nextAction={nextAction}
      roleResponsibility={`Reviewer: ${roleResponsibility}`}
      state={state}
      subtitle="Governance queue for item-scoped Spec and Execution Plan documents."
      toolbar={
        <InlineActions aria-label="Specs and Execution Plans tabs" role="tablist">
          <Link aria-selected={activeTab === 'specs'} className={activeTab === 'specs' ? selectedSegmentClass : unselectedSegmentClass} role="tab" to={tabHref('specs', focusedDevelopmentPlanId, focusedDevelopmentPlanItemId)}>
            Specs
          </Link>
          <Link aria-selected={activeTab === 'plans'} className={activeTab === 'plans' ? selectedSegmentClass : unselectedSegmentClass} role="tab" to={tabHref('plans', focusedDevelopmentPlanId, focusedDevelopmentPlanItemId)}>
            Execution Plans
          </Link>
        </InlineActions>
      }
    >
      <div className="grid gap-4">
        <SurfaceStateIndicator label="Specs & Execution Plans Queue" state={queueSurfaceState(query.isLoading, query.isError, rows, queueProjection.degraded_sources)} />
        {query.isLoading ? <InlineNotice title="Loading Specs & Execution Plans queue." tone="info" /> : null}
        {query.isError ? <InlineNotice title="Specs & Execution Plans queue data is temporarily unavailable." tone="danger" /> : null}
        {focusedDevelopmentPlanId !== null || focusedDevelopmentPlanItemId !== null ? (
          <InlineNotice
            description={queueFocusDescription(focusedDevelopmentPlanId, focusedDevelopmentPlanItemId)}
            title="Focused governance queue"
            tone="info"
          />
        ) : null}
        {!query.isError ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="grid min-w-0 gap-4">
              {groups.map((group) => (
                <SpecPlanGroup
                  focusedRowKey={focusedRow?.id}
                  group={group}
                  isLoading={query.isLoading}
                  key={group.id}
                  onFocusRow={(row) => setFocusedRowKey(row.id)}
                />
              ))}
              {rows.length === 0 && query.isLoading !== true ? (
                <EmptyState description="No Spec or Execution Plan rows currently need governance action." title="No governance rows." />
              ) : null}
            </div>
            <SelectedGovernancePreview row={focusedRow} />
          </div>
        ) : null}
      </div>
    </QueueWorkspace>
  );
}

function SpecPlanGroup({
  focusedRowKey,
  group,
  isLoading,
  onFocusRow,
}: {
  focusedRowKey: string | undefined;
  group: SpecPlanQueueGroup;
  isLoading: boolean;
  onFocusRow: (row: SpecPlanQueueRow) => void;
}) {
  return (
    <Section aria-label={group.label} description={`${group.rows.length} row${group.rows.length === 1 ? '' : 's'}.`} title={group.label} variant="panel">
      {isLoading ? <InlineNotice title={`Loading ${group.label.toLowerCase()} rows.`} tone="info" /> : null}
      <DataTable
        ariaLabel={group.label}
        columns={specPlanColumns}
        density="compact"
        emptyMessage={`No ${group.label.toLowerCase()} rows.`}
        getRowKey={(item) => item.id}
        onSelectRow={onFocusRow}
        rows={group.rows}
        {...(focusedRowKey === undefined ? {} : { selectedRowKey: focusedRowKey })}
        stickyHeader
      />
    </Section>
  );
}

const specPlanColumns: DataTableColumn<SpecPlanQueueRow>[] = [
  {
    key: 'document',
    header: 'Document',
    cell: (row) => (
      <div className="flex min-h-6 min-w-[14rem] max-w-[24rem] items-center gap-3" data-desktop-row-height="44-56" data-spec-plan-queue-row="">
        <span className="truncate font-semibold text-text-primary">{row.title}</span>
        <Link className={secondaryLinkClass} onClick={(event) => event.stopPropagation()} to={row.href}>
          Open plan item
        </Link>
      </div>
    ),
  },
  { key: 'artifact', header: 'Artifact', cell: (row) => <Badge tone="info">{row.artifactLabel}</Badge> },
  { key: 'source', header: 'Source object', cell: (row) => row.sourceObject },
  { key: 'planItem', header: 'Development Plan Item', cell: (row) => row.developmentPlanItem },
  { key: 'gate', header: 'Gate status', cell: (row) => <StatusPill tone={statusTone(row)}>{row.gateStatus}</StatusPill> },
  { key: 'reviewer', header: 'Reviewer', cell: (row) => row.reviewer },
  { key: 'age', header: 'Age', cell: (row) => row.age },
  { key: 'risk', header: 'Risk', cell: (row) => <Badge tone={riskTone(row.risk)}>{row.risk}</Badge> },
  { key: 'action', header: 'Next action', cell: (row) => row.nextAction },
];

function SelectedGovernancePreview({ row }: { row: SpecPlanQueueRow | undefined }) {
  if (row === undefined) {
    return (
      <PreviewPane aria-label="Selected governance row" meta="No row selected" title="Selected governance row">
        <p className="m-0 text-sm text-text-secondary">Select a governance row to inspect its document, gate, and command context.</p>
      </PreviewPane>
    );
  }

  return (
    <PreviewPane
      actions={
        <Link className={unselectedSegmentClass} to={row.href}>
          Open plan item
        </Link>
      }
      aria-label="Selected governance row"
      meta={`${row.artifactLabel} · ${row.groupLabel}`}
      title="Selected governance row"
    >
      <div className="grid gap-3">
        <p className="m-0 text-sm text-text-secondary">{row.documentSummary}</p>
        <CompactMetadata
          items={[
            { label: 'Document summary', value: row.documentSummary },
            { label: 'Gate status', value: row.gateStatus },
            { label: 'Reviewer', value: row.reviewer },
            { label: 'Development Plan Item', value: row.developmentPlanItem },
            { label: 'Command', value: row.command },
            { label: 'Source object', value: row.sourceObject },
            { label: 'Plan item', value: row.developmentPlanItem },
            { label: 'Age', value: row.age },
            { label: 'Risk', value: row.risk },
          ]}
        />
      </div>
    </PreviewPane>
  );
}

function tabHref(tab: 'specs' | 'plans', developmentPlanId: string | null, developmentPlanItemId: string | null): string {
  const params = new URLSearchParams({ tab });
  if (developmentPlanId !== null) params.set('development_plan_id', developmentPlanId);
  if (developmentPlanItemId !== null) params.set('development_plan_item_id', developmentPlanItemId);
  return `/specs-plans?${params.toString()}`;
}

function isFocusedQueueRow(row: SpecPlanQueueRow, developmentPlanId: string | null, developmentPlanItemId: string | null): boolean {
  if (developmentPlanId !== null && row.developmentPlanId !== developmentPlanId) return false;
  if (developmentPlanItemId !== null && row.developmentPlanItemId !== developmentPlanItemId) return false;
  return true;
}

function rowToQueueItem(row: SpecPlanQueueRow): SpecPlanQueueItem {
  return {
    id: row.id,
    artifact_type: row.artifactType,
    title: row.title,
    summary: row.documentSummary,
    status: row.status,
    gate_state: row.gateStatus,
    reviewer_actor_id: row.reviewer,
    age_label: row.age,
    risk: row.risk,
    stale: row.stale,
    blocked: row.blocked,
    next_action: row.nextAction,
    command: row.command,
    href: row.href,
    source_ref: { title: row.sourceObject },
    development_plan_item_ref: {
      ...(row.developmentPlanItemId === undefined ? {} : { id: row.developmentPlanItemId }),
      ...(row.developmentPlanId === undefined ? {} : { development_plan_id: row.developmentPlanId }),
      title: row.developmentPlanItem,
    },
  };
}

function queueFocusDescription(developmentPlanId: string | null, developmentPlanItemId: string | null): string {
  if (developmentPlanId !== null && developmentPlanItemId !== null) {
    return `Showing governance rows for Development Plan ${developmentPlanId} and Development Plan Item ${developmentPlanItemId}.`;
  }
  if (developmentPlanId !== null) return `Showing governance rows for Development Plan ${developmentPlanId}.`;
  if (developmentPlanItemId !== null) return `Showing governance rows for Development Plan Item ${developmentPlanItemId}.`;
  return 'Showing all governance rows.';
}

function queueSurfaceState(isLoading: boolean, isError: boolean, rows: SpecPlanQueueRow[], degradedSources: string[]): SurfaceState | undefined {
  if (isLoading) return 'loading';
  if (isError) return 'error';
  if (rows.length === 0) return 'empty';
  const text = `${degradedSources.join(' ')} ${rows.map((row) => `${row.status} ${row.gateStatus}`).join(' ')}`.toLowerCase();
  if (text.includes('stale')) return 'stale';
  if (rows.some((row) => row.blocked) || text.includes('blocked')) return 'blocked';
  if (text.includes('interrupted') || text.includes('resumable')) return 'resumable';
  if (text.includes('running')) return 'running';
  if (text.includes('approved')) return 'approved';
  return undefined;
}

function statusTone(row: SpecPlanQueueRow): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  const text = `${row.status} ${row.gateStatus}`.toLowerCase();
  if (row.blocked || text.includes('blocked') || text.includes('failed') || text.includes('rejected')) return 'danger';
  if (row.stale || text.includes('stale') || text.includes('changes requested')) return 'warning';
  if (text.includes('approved') || text.includes('accepted')) return 'success';
  if (text.includes('review') || text.includes('submitted')) return 'info';
  return 'neutral';
}

function riskTone(risk: string): 'neutral' | 'warning' | 'danger' {
  const text = risk.toLowerCase();
  if (text.includes('critical') || text.includes('high')) return 'danger';
  if (text.includes('medium') || text.includes('risk')) return 'warning';
  return 'neutral';
}
