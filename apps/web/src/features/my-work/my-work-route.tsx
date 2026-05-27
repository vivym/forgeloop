import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { useMyWorkQuery } from '../../shared/api/hooks';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { CompactMetadata, InboxLayout, PreviewPane, ProductPage, Section } from '../../shared/layout';
import { Badge, Checkbox, DataTable, InlineNotice, StatusPill, type DataTableColumn } from '../../shared/ui';
import {
  myWorkQueueViewModel,
  type MyWorkFilterOption,
  type MyWorkQueueGroup,
  type MyWorkQueueRow,
} from './my-work-view-model';
import { SurfaceStateIndicator, type SurfaceState } from '../project-management/surface-state';

type FilterKey = 'all' | string;

export function MyWorkRoute() {
  const { actorId } = useActorContext();
  const { projectId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const query = useMyWorkQuery({ project_id: projectId, actor_id: actorId });
  const mode = searchParams.get('mode');
  const queueProjection = useMemo(
    () => ({
      items: query.data?.items,
      degraded_sources: query.data?.degraded_sources,
      bulk_action: query.data?.bulk_action,
    }),
    [query.data?.bulk_action, query.data?.degraded_sources, query.data?.items],
  );
  const baseViewModel = useMemo(() => myWorkQueueViewModel(queueProjection), [queueProjection]);
  const [roleFilter, setRoleFilter] = useState<FilterKey>('all');
  const [statusFilter, setStatusFilter] = useState<FilterKey>('all');
  const [gateFilter, setGateFilter] = useState<FilterKey>('all');
  const [riskFilter, setRiskFilter] = useState<FilterKey>('all');
  const filteredGroups = useMemo(
    () => filterGroups(baseViewModel.groups, { gate: gateFilter, risk: riskFilter, role: roleFilter, status: statusFilter }),
    [baseViewModel.groups, gateFilter, riskFilter, roleFilter, statusFilter],
  );
  const filteredRows = useMemo(() => filteredGroups.flatMap((group) => group.rows), [filteredGroups]);
  const visibleGroups = useMemo(() => filteredGroups.filter((group) => group.rows.length > 0), [filteredGroups]);
  const [focusedRowKey, setFocusedRowKey] = useState<string | undefined>(undefined);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const selectedRows = useMemo(
    () => filteredRows.filter((row) => selectedRowIds.includes(row.id)),
    [filteredRows, selectedRowIds],
  );
  const viewModel = useMemo(() => myWorkQueueViewModel(queueProjection, selectedRows), [queueProjection, selectedRows]);
  const focusedRow = filteredRows.find((row) => row.id === focusedRowKey) ?? filteredRows[0];

  useEffect(() => {
    if (filteredRows.length === 0) {
      setFocusedRowKey(undefined);
      return;
    }
    if (focusedRowKey === undefined || !filteredRows.some((row) => row.id === focusedRowKey)) {
      setFocusedRowKey(filteredRows[0]?.id);
    }
  }, [filteredRows, focusedRowKey]);

  useEffect(() => {
    const visibleRowIds = new Set(filteredRows.map((row) => row.id));
    setSelectedRowIds((current) => {
      const visibleSelectedIds = current.filter((id) => visibleRowIds.has(id));
      return visibleSelectedIds.length === current.length ? current : visibleSelectedIds;
    });
  }, [filteredRows]);

  const toggleSelectedRow = (row: MyWorkQueueRow) => {
    setFocusedRowKey(row.id);
    setSelectedRowIds((current) => (
      current.includes(row.id)
        ? current.filter((id) => id !== row.id)
        : [...current, row.id]
    ));
  };

  const degradedSources = query.data?.degraded_sources ?? [];

  return (
    <ProductPage
      family="inbox"
      ariaLabel="My Work"
    >
      <h1 className="mb-3 text-xl font-semibold text-text-primary">My Work</h1>
      <InboxLayout
        groups={
          <div className="grid gap-2">
            <QueueFilterToolbar label="Role" options={baseViewModel.filters.roles} selected={roleFilter} setSelected={setRoleFilter} />
            <QueueFilterToolbar label="Gate" options={baseViewModel.filters.gates} selected={gateFilter} setSelected={setGateFilter} />
          </div>
        }
        toolbar={
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1">
            <QueueFilterToolbar label="Status" options={baseViewModel.filters.statuses} selected={statusFilter} setSelected={setStatusFilter} />
            <QueueFilterToolbar label="Risk" options={baseViewModel.filters.risks} selected={riskFilter} setSelected={setRiskFilter} />
          </div>
        }
        list={
          <div className="grid min-w-0 gap-4">
            {visibleGroups.length > 0 ? (
              visibleGroups.map((group) => (
                <MyWorkGroup
                  focusedRowKey={focusedRow?.id}
                  group={group}
                  onFocusRow={(row) => setFocusedRowKey(row.id)}
                  key={group.id}
                  onToggleSelectedRow={toggleSelectedRow}
                  selectedRowIds={selectedRowIds}
                />
              ))
            ) : (
              <Section title="No attention items" variant="panel">
                <p className="m-0 text-sm text-text-secondary">No visible items match the selected filters.</p>
              </Section>
            )}
          </div>
        }
        inspector={<SelectedItemPreview disabledReason={viewModel.disabledReason} row={focusedRow} selectedCount={selectedRows.length} />}
      />
      <SurfaceStateIndicator label="My Work" state={myWorkSurfaceState(query.isLoading, query.isError, filteredRows, degradedSources)} />
      {query.isLoading ? <InlineNotice title="Loading My Work." tone="info" /> : null}
      {query.error ? <InlineNotice title="My Work could not be loaded." tone="danger" /> : null}
      {mode === 'reprioritize' ? (
        <InlineNotice
          description="Attention items stay grouped by role; use the blocking gate, age, and risk context to reorder the next operating pass."
          title="Reprioritization mode"
          tone="info"
        />
      ) : null}
    </ProductPage>
  );
}

function myWorkSurfaceState(
  isLoading: boolean,
  isError: boolean,
  rows: readonly MyWorkQueueRow[],
  degradedSources: readonly string[],
): SurfaceState {
  if (isLoading) return 'loading';
  if (isError) return 'error';
  if (degradedSources.length > 0) return 'stale';
  if (rows.length === 0) return 'empty';
  const rowText = rows
    .map((row) => `${row.statusLabel} ${row.attentionReasonLabel} ${row.nextAction} ${row.riskLabel}`)
    .join(' ');
  if (/resumable|interrupted|paused/i.test(rowText)) return 'resumable';
  if (/running|active execution/i.test(rowText)) return 'running';
  if (/blocked|failed|blocked risk/i.test(rowText)) return 'blocked';
  if (/approved|accepted/i.test(rowText)) return 'approved';
  return 'approved';
}

function QueueFilterToolbar({
  label,
  options,
  selected,
  setSelected,
}: {
  label: string;
  options: MyWorkFilterOption[];
  selected: FilterKey;
  setSelected: (value: FilterKey) => void;
}) {
  const selectedLabel = selected === 'all' ? 'All' : options.find((option) => option.id === selected)?.label ?? selected;

  return (
    <div className="flex min-w-0 shrink-0 flex-nowrap items-center gap-2" data-filter-chip-group={label.toLowerCase()}>
      <select
        aria-label={`${label} filter`}
        className="min-h-10 rounded-md border border-border bg-surface px-3 text-sm font-semibold text-text-primary md:hidden"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
      >
        <option value="all">{label}: All</option>
        {options.map((option) => (
          <option disabled={option.count === 0} key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        aria-pressed={selected === 'all'}
        className="hidden rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-text-primary md:inline-flex"
        onClick={() => setSelected('all')}
        type="button"
      >
        {label}: {selectedLabel}
      </button>
      {options.map((option) => (
        <button
          aria-pressed={selected === option.id}
          className="hidden rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary md:inline-flex"
          disabled={option.count === 0}
          key={option.id}
          onClick={() => setSelected(option.id)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function MyWorkGroup({
  focusedRowKey,
  group,
  onFocusRow,
  onToggleSelectedRow,
  selectedRowIds,
}: {
  focusedRowKey: string | undefined;
  group: MyWorkQueueGroup;
  onFocusRow: (row: MyWorkQueueRow) => void;
  onToggleSelectedRow: (row: MyWorkQueueRow) => void;
  selectedRowIds: string[];
}) {
  return (
    <Section aria-label={group.label} title={group.label} variant="panel">
      <DataTable
        ariaLabel={group.label}
        columns={myWorkColumns(selectedRowIds, onToggleSelectedRow)}
        density="compact"
        emptyMessage="No attention items."
        getRowKey={(item) => item.id}
        onSelectRow={onFocusRow}
        rows={group.rows}
        {...(focusedRowKey === undefined ? {} : { selectedRowKey: focusedRowKey })}
        stickyHeader
      />
    </Section>
  );
}

const myWorkColumns = (
  selectedRowIds: string[],
  onToggleSelectedRow: (row: MyWorkQueueRow) => void,
): DataTableColumn<MyWorkQueueRow>[] => [
  {
    key: 'select',
    header: 'Select',
    cell: (item) => (
      <Checkbox
        checked={selectedRowIds.includes(item.id)}
        label={<span className="sr-only">Select {item.title}</span>}
        onChange={() => onToggleSelectedRow(item)}
        onClick={(event) => event.stopPropagation()}
      />
    ),
  },
  {
    key: 'title',
    header: 'Target',
    cell: (item) =>
      item.href === undefined ? (
        <span className="font-semibold">{item.title}</span>
      ) : (
        <span className="grid gap-1">
          <span className="font-semibold">{item.title}</span>
          <Link className="text-sm font-semibold text-primary hover:underline" to={item.href}>
            {item.openLabel}
          </Link>
        </span>
      ),
  },
  { key: 'type', header: 'Type', cell: (item) => item.objectTypeLabel },
  { key: 'reason', header: 'Why visible', cell: (item) => <StatusPill tone="neutral">{item.attentionReasonLabel}</StatusPill> },
  { key: 'gate', header: 'Blocking gate', cell: (item) => item.gateLabel },
  { key: 'age', header: 'Age', cell: (item) => item.ageLabel },
  { key: 'role', header: 'Role', cell: (item) => item.roleLabel },
  { key: 'risk', header: 'Risk', cell: (item) => <Badge tone={item.riskLabel === 'Normal risk' ? 'neutral' : 'warning'}>{item.riskLabel}</Badge> },
  { key: 'action', header: 'Next action', cell: (item) => item.nextAction },
];

function SelectedItemPreview({ disabledReason, row, selectedCount }: { disabledReason: string; row: MyWorkQueueRow | undefined; selectedCount: number }) {
  if (row === undefined) {
    return (
      <PreviewPane meta="No row selected" title="Selected queue item">
        <p className="m-0 text-sm text-text-secondary">Select a queue row to inspect its next action.</p>
      </PreviewPane>
    );
  }

  return (
    <PreviewPane
      meta={`${row.roleLabel} · ${row.gateLabel}`}
      title="Selected queue item"
    >
      <div className="grid gap-3">
        <div className="grid gap-1">
          <h3 className="m-0 text-sm font-semibold text-text-primary">{row.title}</h3>
          <p className="m-0 text-sm text-text-secondary">{row.attentionReasonLabel}</p>
        </div>
        <CompactMetadata
          items={[
            { label: 'Next action', value: row.nextAction },
            { label: 'Disabled reason', value: disabledReason },
            { label: 'Selected rows', value: String(selectedCount) },
            { label: 'Risk', value: row.riskLabel },
            { label: 'Status', value: row.statusLabel },
          ]}
        />
      </div>
    </PreviewPane>
  );
}

function filterGroups(
  groups: MyWorkQueueGroup[],
  filters: { gate: FilterKey; risk: FilterKey; role: FilterKey; status: FilterKey },
): MyWorkQueueGroup[] {
  return groups
    .filter((group) => filters.role === 'all' || group.id === filters.role)
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) =>
        (filters.status === 'all' || row.statusLabel === filters.status) &&
        (filters.gate === 'all' || row.gateLabel === filters.gate) &&
        (filters.risk === 'all' || row.riskLabel === filters.risk)
      ),
    }));
}
