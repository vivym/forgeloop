import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { CompactMetadata, PreviewPane, QueueWorkspace, Section } from '../../shared/layout';
import { Badge, DataTable, EmptyState, InlineNotice, Input, StatusPill, type DataTableColumn } from '../../shared/ui';
import type { ProductPageViewModel } from '../product-surfaces/view-model-types';
import { sourceObjectListViewModel } from './source-object-view-model';

export interface ProjectObjectListItem {
  id: string;
  ref: { type: string; id: string };
  title: string;
  status: string;
  priority?: string | undefined;
  risk?: string | undefined;
  driver_actor_id?: string | undefined;
  updated_at?: string | undefined;
  narrative_markdown?: string | undefined;
  relationship_refs?: readonly { type?: string; id?: string; title?: string; development_plan_id?: string }[] | undefined;
  child_refs?: readonly { type?: string; id?: string; title?: string }[] | undefined;
  bug_refs?: readonly { type?: string; id?: string; title?: string }[] | undefined;
  release_refs?: readonly { type?: string; id?: string; title?: string }[] | undefined;
  evidence_refs?: readonly { type?: string; id?: string; title?: string }[] | undefined;
  attachment_refs?: readonly { type?: string; id?: string; title?: string }[] | undefined;
}

export interface ObjectListProps<T extends ProjectObjectListItem> {
  createHref: string;
  detailHref: (item: T) => string;
  emptyMessage: string;
  error?: Error | null;
  isLoading: boolean;
  items: T[];
  planningHref?: string | undefined;
  subtitle: string;
  title: string;
}

export function ObjectList<T extends ProjectObjectListItem>({
  createHref,
  detailHref,
  emptyMessage,
  error,
  isLoading,
  items,
  planningHref = '/development-plans/new',
  subtitle,
  title,
}: ObjectListProps<T>) {
  const rows = useMemo(
    () => items.map((item) => sourceObjectQueueRow(item, detailHref(item))),
    [detailHref, items],
  );
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'dense' | 'preview'>('dense');
  const filteredRows = useMemo(
    () => rows.filter((row) =>
      (riskFilter === 'all' || row.riskLabel === riskFilter) &&
      (statusFilter === 'all' || row.statusLabel === statusFilter) &&
      (search.trim().length === 0 || row.searchText.includes(search.trim().toLowerCase()))
    ),
    [riskFilter, rows, search, statusFilter],
  );
  const focusedRow = filteredRows[0];
  const listState = isLoading ? `Loading ${title.toLowerCase()} source objects` : `${filteredRows.length} source object${filteredRows.length === 1 ? '' : 's'} ready for planning`;
  const roleResponsibility = focusedRow === undefined
    ? 'Source object responsibility is assigned when a row enters planning.'
    : focusedRow.responsibilityText;
  const blockerRisk = error
    ? `${title} source object risk could not be loaded.`
    : focusedRow?.riskLabel ?? 'No source object risk visible in the current filters.';
  const nextAction = focusedRow?.nextAction ?? 'Create a source object or open Development Plans to start planning.';

  const columns: DataTableColumn<SourceObjectQueueRow>[] = [
    {
      key: 'object',
      header: 'Object',
      cell: (item) => (
        <div className="grid min-w-[14rem] gap-1">
          <span className="font-semibold text-text-primary">{item.title}</span>
          <Link className={secondaryLinkClass} to={item.href}>
            Open {item.objectType}
          </Link>
        </div>
      ),
    },
    { key: 'type', header: 'Type', cell: (item) => item.objectType },
    { key: 'gate', header: 'Gate / status', cell: (item) => <StatusPill tone="neutral">{item.statusLabel}</StatusPill> },
    { key: 'risk', header: 'Risk', cell: (item) => <Badge tone={riskTone(item.riskLabel)}>{item.riskLabel}</Badge> },
    { key: 'role', header: 'Role / actor', cell: (item) => item.responsibilityText },
    {
      key: 'plan',
      header: 'Development Plan',
      cell: (item) => item.developmentPlanHref === undefined ? (
        <span>{item.developmentPlanState}</span>
      ) : (
        <Link className={secondaryLinkClass} to={item.developmentPlanHref}>
          {item.developmentPlanState}
        </Link>
      ),
    },
    { key: 'action', header: 'Next action', cell: (item) => item.nextAction },
    { key: 'updated', header: 'Last meaningful update', cell: (item) => item.lastMeaningfulUpdate },
  ];

  return (
    <QueueWorkspace
      blockerRisk={blockerRisk}
      family="source-object-list"
      heading={title}
      nextAction={nextAction}
      roleResponsibility={roleResponsibility}
      state={listState}
      subtitle={subtitle}
      toolbar={
        <>
          <Link className={primaryLinkClass} to={createHref}>
            Create source object
          </Link>
          <Link className={secondaryButtonClass} to={planningHref}>
            Plan source object
          </Link>
        </>
      }
    >
      <div className="grid gap-4">
        <Section title={`${title} queue controls`} variant="panel">
          <div className="grid gap-3">
            <label className="grid min-w-0 gap-2 sm:max-w-sm">
              <span className="text-sm font-semibold text-text-secondary">Search {title}</span>
              <Input
                aria-label={`Search ${title}`}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Search ${title.toLowerCase()}`}
                role="searchbox"
                value={search}
              />
            </label>
            <div className="flex flex-wrap items-center gap-2" data-filter-chip-group="risk">
              <FilterChip label="Risk: All" onClick={() => setRiskFilter('all')} selected={riskFilter === 'all'} />
              {uniqueValues(rows.map((row) => row.riskLabel)).map((risk) => (
                <FilterChip key={risk} label={risk} onClick={() => setRiskFilter(risk)} selected={riskFilter === risk} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2" data-filter-chip-group="status">
              <FilterChip label="Status: All" onClick={() => setStatusFilter('all')} selected={statusFilter === 'all'} />
              {uniqueValues(rows.map((row) => row.statusLabel)).map((status) => (
                <FilterChip key={status} label={status} onClick={() => setStatusFilter(status)} selected={statusFilter === status} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2" data-view-options="">
              <FilterChip label="View: Dense" onClick={() => setViewMode('dense')} selected={viewMode === 'dense'} />
              <FilterChip label="View: Preview" onClick={() => setViewMode('preview')} selected={viewMode === 'preview'} />
            </div>
          </div>
        </Section>
        {isLoading ? <InlineNotice title={`Loading ${title.toLowerCase()} source objects.`} tone="info" /> : null}
        {error ? <InlineNotice title={`${title} source objects could not be loaded.`} tone="danger" /> : null}
        <div className={viewMode === 'preview' ? 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]' : 'grid gap-4'}>
          <Section title={`${title} source object queue`} variant="panel">
            <DataTable
              ariaLabel={`${title} source object queue`}
              columns={columns}
              density="compact"
              emptyMessage={
                <EmptyState
                  actions={
                    <>
                      <Link className={primaryLinkClass} to={createHref}>
                        Create source object
                      </Link>
                      <Link className={secondaryButtonClass} to={planningHref}>
                        Plan source object
                      </Link>
                    </>
                  }
                  description={emptyMessage}
                  title={`No ${title.toLowerCase()} source objects.`}
                />
              }
              getRowKey={(item) => item.id}
              rows={filteredRows}
              stickyHeader
            />
          </Section>
          {viewMode === 'preview' ? <SourceObjectPreview row={focusedRow} /> : null}
        </div>
      </div>
    </QueueWorkspace>
  );
}

interface SourceObjectQueueRow {
  id: string;
  title: string;
  href: string;
  objectType: string;
  statusLabel: string;
  riskLabel: string;
  responsibilityText: string;
  developmentPlanState: string;
  developmentPlanHref?: string | undefined;
  nextAction: string;
  lastMeaningfulUpdate: string;
  previewSummary: string;
  metadata: ProductPageViewModel['secondaryMetadata'];
  searchText: string;
}

const primaryLinkClass =
  'inline-flex min-h-10 items-center rounded-md border border-primary bg-primary px-4 text-sm font-semibold text-white';
const secondaryButtonClass =
  'inline-flex min-h-10 items-center rounded-md border border-border bg-surface px-4 text-sm font-semibold text-text-primary';
const secondaryLinkClass = 'text-sm font-semibold text-primary hover:underline';

function sourceObjectQueueRow<T extends ProjectObjectListItem>(item: T, href: string): SourceObjectQueueRow {
  const viewModel = sourceObjectListViewModel(item);
  const developmentPlanGate = viewModel.gateProgress.find((gate) => gate.label === 'Development Plan');
  const responsibilityText = `Responsibility: ${viewModel.primaryActorOrRole}`;

  return {
    id: item.id,
    title: viewModel.objectLabel,
    href,
    objectType: viewModel.objectType,
    statusLabel: viewModel.currentState,
    riskLabel: viewModel.riskSignal,
    responsibilityText,
    developmentPlanState: developmentPlanStateLabel(developmentPlanGate?.state),
    developmentPlanHref: developmentPlanGate?.href,
    nextAction: viewModel.nextAction,
    lastMeaningfulUpdate: viewModel.timelineSummary,
    previewSummary: viewModel.previewSummary,
    metadata: viewModel.secondaryMetadata,
    searchText: [
      viewModel.objectLabel,
      viewModel.objectType,
      viewModel.currentState,
      viewModel.riskSignal,
      responsibilityText,
      viewModel.nextAction,
      viewModel.timelineSummary,
    ].join(' ').toLowerCase(),
  };
}

function FilterChip({ label, onClick, selected }: { label: string; onClick: () => void; selected: boolean }) {
  return (
    <button
      aria-pressed={selected}
      className={selected ? primaryLinkClass : secondaryButtonClass}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function SourceObjectPreview({ row }: { row: SourceObjectQueueRow | undefined }) {
  if (row === undefined) {
    return (
      <PreviewPane meta="No row selected" title="Source object preview">
        <p className="m-0 text-sm text-text-secondary">Use the queue filters to find a source object.</p>
      </PreviewPane>
    );
  }

  return (
    <PreviewPane
      actions={
        <Link className={secondaryButtonClass} to={row.href}>
          Open {row.objectType}
        </Link>
      }
      meta={`${row.objectType} · ${row.statusLabel}`}
      title="Source object preview"
    >
      <div className="grid gap-3">
        <p className="m-0 text-sm text-text-secondary">{row.previewSummary}</p>
        <CompactMetadata
          items={[
            { label: 'Next action', value: row.nextAction },
            { label: 'Development Plan', value: row.developmentPlanState },
            { label: 'Last update', value: row.lastMeaningfulUpdate },
            ...row.metadata,
          ]}
        />
      </div>
    </PreviewPane>
  );
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values)).filter(Boolean);
}

function developmentPlanStateLabel(state: string | undefined): string {
  if (state === 'linked') return 'Development Plan linked';
  if (state === 'missing') return 'Development Plan missing';
  return 'Planning state unknown';
}

function riskTone(risk: string): 'neutral' | 'warning' | 'danger' {
  const text = risk.toLowerCase();
  if (text.includes('high') || text.includes('critical')) return 'danger';
  if (text.includes('risk')) return 'warning';
  return 'neutral';
}
