import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { useMyWorkQuery } from '../../shared/api/hooks';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { CompactMetadata, PreviewPane, QueueWorkspace, Section } from '../../shared/layout';
import { Badge, DataTable, InlineNotice, StatusPill, type DataTableColumn } from '../../shared/ui';
import {
  myWorkQueueViewModel,
  type MyWorkFilterOption,
  type MyWorkQueueGroup,
  type MyWorkQueueRow,
} from './my-work-view-model';

type FilterKey = 'all' | string;

export function MyWorkRoute() {
  const { actorId } = useActorContext();
  const { projectId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const query = useMyWorkQuery({ project_id: projectId, actor_id: actorId });
  const mode = searchParams.get('mode');
  const viewModel = useMemo(
    () => myWorkQueueViewModel({
      items: query.data?.items,
      degraded_sources: query.data?.degraded_sources,
      bulk_action: query.data?.bulk_action,
    }),
    [query.data?.bulk_action, query.data?.degraded_sources, query.data?.items],
  );
  const [roleFilter, setRoleFilter] = useState<FilterKey>('all');
  const [statusFilter, setStatusFilter] = useState<FilterKey>('all');
  const [gateFilter, setGateFilter] = useState<FilterKey>('all');
  const [riskFilter, setRiskFilter] = useState<FilterKey>('all');
  const filteredGroups = useMemo(
    () => filterGroups(viewModel.groups, { gate: gateFilter, risk: riskFilter, role: roleFilter, status: statusFilter }),
    [gateFilter, riskFilter, roleFilter, statusFilter, viewModel.groups],
  );
  const filteredRows = filteredGroups.flatMap((group) => group.rows);
  const [selectedRowKey, setSelectedRowKey] = useState<string | undefined>(filteredRows[0]?.id);
  const selectedRow = filteredRows.find((row) => row.id === selectedRowKey) ?? filteredRows[0];

  useEffect(() => {
    if (filteredRows.length === 0) {
      setSelectedRowKey(undefined);
      return;
    }
    if (selectedRowKey === undefined || !filteredRows.some((row) => row.id === selectedRowKey)) {
      setSelectedRowKey(filteredRows[0]?.id);
    }
  }, [filteredRows, selectedRowKey]);

  const currentState = query.isLoading ? 'Loading role queue' : query.isError ? 'Queue failed to load' : viewModel.currentState;
  const blockerRisk = query.isError ? 'My Work query failed; review the queue source before acting.' : viewModel.riskSignal;
  const nextAction = (
    <div className="grid gap-1">
      <span>{viewModel.safeBulkAction ? viewModel.nextAction : viewModel.disabledReason}</span>
      {!viewModel.safeBulkAction ? <span className="text-xs text-text-secondary">{viewModel.disabledReason}</span> : null}
    </div>
  );

  return (
    <div data-page-family="queue" data-workspace-layout="queue-workspace">
      <QueueWorkspace
        as="div"
        blockerRisk={blockerRisk}
        family="queue"
        heading="My Work"
        nextAction={nextAction}
        roleResponsibility={viewModel.primaryActorOrRole}
        state={currentState}
        subtitle="Role-aware product inbox."
        toolbar={<QueueFilterToolbar label="Role" options={viewModel.filters.roles} selected={roleFilter} setSelected={setRoleFilter} />}
      >
        <div className="grid gap-4">
          {query.isLoading ? <InlineNotice title="Loading My Work." tone="info" /> : null}
          {query.error ? <InlineNotice title="My Work could not be loaded." tone="danger" /> : null}
          {mode === 'reprioritize' ? (
            <InlineNotice
              description="Attention items stay grouped by role; use the blocking gate, age, and risk context to reorder the next operating pass."
              title="Reprioritization mode"
              tone="info"
            />
          ) : null}
          <Section
            actions={
              viewModel.safeBulkAction ? (
                <div className="flex flex-wrap items-center gap-2" data-safe-bulk-actions="">
                  <button className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-text-primary" type="button">
                    {viewModel.safeBulkAction.label}
                  </button>
                </div>
              ) : null
            }
            title="Queue filters"
            variant="panel"
          >
            <div className="grid gap-3">
              <QueueFilterToolbar label="Status" options={viewModel.filters.statuses} selected={statusFilter} setSelected={setStatusFilter} />
              <QueueFilterToolbar label="Gate" options={viewModel.filters.gates} selected={gateFilter} setSelected={setGateFilter} />
              <QueueFilterToolbar label="Risk" options={viewModel.filters.risks} selected={riskFilter} setSelected={setRiskFilter} />
            </div>
          </Section>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="grid min-w-0 gap-4">
              {filteredGroups.map((group) => (
                <MyWorkGroup
                  group={group}
                  key={group.id}
                  onSelectRow={(row) => setSelectedRowKey(row.id)}
                  selectedRowKey={selectedRow?.id}
                />
              ))}
            </div>
            <SelectedItemPreview disabledReason={viewModel.disabledReason} row={selectedRow} />
          </div>
        </div>
      </QueueWorkspace>
    </div>
  );
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
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-filter-chip-group={label.toLowerCase()}>
      <button
        aria-pressed={selected === 'all'}
        className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-text-primary"
        onClick={() => setSelected('all')}
        type="button"
      >
        {label}: {selectedLabel}
      </button>
      {options.map((option) => (
        <button
          aria-pressed={selected === option.id}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary"
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
  group,
  onSelectRow,
  selectedRowKey,
}: {
  group: MyWorkQueueGroup;
  onSelectRow: (row: MyWorkQueueRow) => void;
  selectedRowKey: string | undefined;
}) {
  return (
    <Section aria-label={group.label} title={group.label} variant="panel">
      <DataTable
        ariaLabel={group.label}
        columns={myWorkColumns}
        density="compact"
        emptyMessage="No attention items."
        getRowKey={(item) => item.id}
        onSelectRow={onSelectRow}
        rows={group.rows}
        {...(selectedRowKey === undefined ? {} : { selectedRowKey })}
        stickyHeader
      />
    </Section>
  );
}

const myWorkColumns: DataTableColumn<MyWorkQueueRow>[] = [
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

function SelectedItemPreview({ disabledReason, row }: { disabledReason: string; row: MyWorkQueueRow | undefined }) {
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
