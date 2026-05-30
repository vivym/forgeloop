import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import {
  BugWorkspace,
  DenseToolbar,
  InitiativeWorkspace,
  PropertyList,
  RequirementWorkspace,
  TechDebtWorkspace,
} from '../../shared/layout';
import { Badge, DataTable, EmptyState, InlineNotice, Input, StatusPill, type DataTableColumn } from '../../shared/ui';
import { ObjectList } from './object-list';
import {
  bugWorkspaceViewModel,
  initiativeWorkspaceViewModel,
  requirementWorkspaceViewModel,
  techDebtWorkspaceViewModel,
  type TypedDocumentWorkspaceDefinition,
  type TypedDocumentWorkspaceRow,
} from './document-workspace-view-model';

type ProjectObjectRef = {
  development_plan_id?: string | undefined;
  id?: string | undefined;
  title?: string | undefined;
  type?: string | undefined;
};

export interface ProjectObjectListItem {
  affected_modules?: readonly string[] | undefined;
  attachment_refs?: readonly ProjectObjectRef[] | undefined;
  bug_refs?: readonly ProjectObjectRef[] | undefined;
  business_outcome?: string | undefined;
  child_refs?: readonly ProjectObjectRef[] | undefined;
  downstream_gate_summary?: { current_gate_counts: Record<string, number>; blocker_count: number } | undefined;
  driver_actor_id?: string | undefined;
  evidence_refs?: readonly ProjectObjectRef[] | undefined;
  expected_behavior?: string | undefined;
  id: string;
  last_meaningful_update_at?: string | undefined;
  linked_development_plans?: readonly ProjectObjectRef[] | undefined;
  linked_plan_items?: readonly ProjectObjectRef[] | undefined;
  milestone_intent?: string | undefined;
  narrative_markdown?: string | undefined;
  next_action?: string | undefined;
  observed_behavior?: string | undefined;
  planning_coverage?: { development_plan_count: number; plan_item_count: number; uncovered: boolean } | undefined;
  priority?: string | undefined;
  ref: { type: string; id: string };
  relationship_refs?: readonly ProjectObjectRef[] | undefined;
  release_coverage?: string | undefined;
  release_refs?: readonly ProjectObjectRef[] | undefined;
  reproduction_steps?: readonly string[] | undefined;
  risk?: string | undefined;
  risk_rationale?: string | undefined;
  severity?: string | undefined;
  status: string;
  title: string;
  updated_at?: string | undefined;
  validation_strategy?: string | undefined;
}

type TypedWorkspaceKind = 'bug' | 'initiative' | 'requirement' | 'tech_debt';
type ViewMode = 'dense' | 'preview';

export interface TypedDocumentListProps<T extends ProjectObjectListItem> {
  createHref: string;
  detailHref: (item: T) => string;
  emptyMessage: string;
  error?: Error | null;
  isLoading: boolean;
  items: T[];
  planningHref?: string | undefined;
  subtitle: string;
  title: string;
  workspaceKind: TypedWorkspaceKind;
}

export function TypedDocumentList<T extends ProjectObjectListItem>({
  createHref,
  detailHref,
  emptyMessage,
  error,
  isLoading,
  items,
  planningHref = '/development-plans/new',
  subtitle,
  title,
  workspaceKind,
}: TypedDocumentListProps<T>) {
  const adapter = adapterFor(workspaceKind);
  const rows = useMemo(
    () => items.map((item) => adapter.row(item, detailHref(item))),
    [adapter, detailHref, items],
  );
  const [driverFilter, setDriverFilter] = useState('all');
  const [focusedRowKey, setFocusedRowKey] = useState<string | undefined>(undefined);
  const [planningCoverageFilter, setPlanningCoverageFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [releaseFilter, setReleaseFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewMode, setViewMode] = useState<ViewMode>('dense');
  const filteredRows = useMemo(
    () => rows.filter((row) =>
      (driverFilter === 'all' || row.driver === driverFilter) &&
      (planningCoverageFilter === 'all' || row.planningCoverageState === planningCoverageFilter) &&
      (priorityFilter === 'all' || row.priority === priorityFilter) &&
      (releaseFilter === 'all' || row.releaseLinkState === releaseFilter) &&
      (riskFilter === 'all' || row.risk === riskFilter) &&
      (roleFilter === 'all' || row.roleFilterState === roleFilter) &&
      (statusFilter === 'all' || row.status === statusFilter) &&
      (search.trim().length === 0 || row.searchText.includes(search.trim().toLowerCase()))
    ),
    [driverFilter, planningCoverageFilter, priorityFilter, releaseFilter, riskFilter, roleFilter, rows, search, statusFilter],
  );
  const focusedRow = filteredRows.find((row) => row.id === focusedRowKey) ?? filteredRows[0];
  const workspace = workspaceFor(workspaceKind);

  useEffect(() => {
    if (filteredRows.length === 0) {
      setFocusedRowKey(undefined);
      return;
    }
    if (focusedRowKey === undefined || !filteredRows.some((row) => row.id === focusedRowKey)) {
      setFocusedRowKey(filteredRows[0]?.id);
    }
  }, [filteredRows, focusedRowKey]);

  return (
    <ObjectList
      className="typed-document-workspace"
      family="document-database"
      heading={title}
      Workspace={workspace.Component}
      toolbar={
        <TypedDocumentToolbar
          driverFilter={driverFilter}
          planningCoverageFilter={planningCoverageFilter}
          priorityFilter={priorityFilter}
          releaseFilter={releaseFilter}
          riskFilter={riskFilter}
          roleFilter={roleFilter}
          rows={rows}
          search={search}
          statusFilter={statusFilter}
          title={title}
          viewMode={viewMode}
          onDriverFilter={setDriverFilter}
          onPlanningCoverageFilter={setPlanningCoverageFilter}
          onPriorityFilter={setPriorityFilter}
          onReleaseFilter={setReleaseFilter}
          onRiskFilter={setRiskFilter}
          onRoleFilter={setRoleFilter}
          onSearch={setSearch}
          onStatusFilter={setStatusFilter}
          onViewMode={setViewMode}
        />
      }
      table={
        <section className="grid min-w-0 content-start gap-3 lg:min-h-[70vh]" data-primary-work-surface="">
          {filteredRows.length === 0 && !isLoading && !error ? (
            <TypedDocumentEmptyState createHref={createHref} definition={adapter.definition} description={emptyMessage} planningHref={planningHref} />
          ) : null}
          <DataTable
            ariaLabel={adapter.definition.tableAriaLabel}
            columns={typedDocumentColumns(adapter.definition)}
            density="compact"
            emptyMessage={null}
            getRowKey={(item) => item.id}
            onSelectRow={(row) => setFocusedRowKey(row.id)}
            rows={filteredRows}
            {...(focusedRow?.id === undefined ? {} : { selectedRowKey: focusedRow.id })}
            stickyHeader
          />
          <TypedDocumentActions createHref={createHref} definition={adapter.definition} planningHref={planningHref} />
          {isLoading ? <InlineNotice title={`Loading ${title.toLowerCase()}.`} tone="info" /> : null}
          {error ? <InlineNotice title={`${title} could not be loaded.`} tone="danger" /> : null}
        </section>
      }
      inspector={viewMode === 'preview' ? <TypedDocumentInspector definition={adapter.definition} row={focusedRow} subtitle={subtitle} /> : undefined}
    />
  );
}

function adapterFor(kind: TypedWorkspaceKind) {
  switch (kind) {
    case 'bug':
      return bugWorkspaceViewModel;
    case 'initiative':
      return initiativeWorkspaceViewModel;
    case 'tech_debt':
      return techDebtWorkspaceViewModel;
    case 'requirement':
      return requirementWorkspaceViewModel;
  }
}

function workspaceFor(kind: TypedWorkspaceKind): { Component: (props: { toolbar: ReactNode; table: ReactNode; inspector?: ReactNode }) => ReactNode } {
  switch (kind) {
    case 'bug':
      return { Component: BugWorkspace };
    case 'initiative':
      return { Component: InitiativeWorkspace };
    case 'tech_debt':
      return { Component: TechDebtWorkspace };
    case 'requirement':
      return { Component: RequirementWorkspace };
  }
}

function TypedDocumentToolbar({
  driverFilter,
  onDriverFilter,
  onPlanningCoverageFilter,
  onPriorityFilter,
  onReleaseFilter,
  onRiskFilter,
  onRoleFilter,
  onSearch,
  onStatusFilter,
  onViewMode,
  planningCoverageFilter,
  priorityFilter,
  releaseFilter,
  riskFilter,
  roleFilter,
  rows,
  search,
  statusFilter,
  title,
  viewMode,
}: {
  driverFilter: string;
  onDriverFilter: (value: string) => void;
  onPlanningCoverageFilter: (value: string) => void;
  onPriorityFilter: (value: string) => void;
  onReleaseFilter: (value: string) => void;
  onRiskFilter: (value: string) => void;
  onRoleFilter: (value: string) => void;
  onSearch: (value: string) => void;
  onStatusFilter: (value: string) => void;
  onViewMode: (value: ViewMode) => void;
  planningCoverageFilter: string;
  priorityFilter: string;
  releaseFilter: string;
  riskFilter: string;
  roleFilter: string;
  rows: TypedDocumentWorkspaceRow[];
  search: string;
  statusFilter: string;
  title: string;
  viewMode: ViewMode;
}) {
  return (
    <DenseToolbar>
      <label className="grid min-w-[14rem] shrink-0 sm:w-72">
        <span className="sr-only">Search {title}</span>
        <Input
          aria-label={`Search ${title}`}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={`Search ${title.toLowerCase()}`}
          role="searchbox"
          value={search}
        />
      </label>
      <FilterGroup label="Status" selected={statusFilter} values={uniqueValues(rows.map((row) => row.status))} onSelect={onStatusFilter} />
      <FilterGroup label="Risk" selected={riskFilter} values={uniqueValues(rows.map((row) => row.risk))} onSelect={onRiskFilter} />
      <FilterGroup label="Priority" selected={priorityFilter} values={uniqueValues(rows.map((row) => row.priority))} onSelect={onPriorityFilter} />
      <FilterGroup label="Driver" selected={driverFilter} values={uniqueValues(rows.map((row) => row.driver))} onSelect={onDriverFilter} />
      <FilterGroup label="Planning coverage" selected={planningCoverageFilter} values={['covered', 'uncovered', 'unavailable']} onSelect={onPlanningCoverageFilter} />
      <FilterGroup label="Release link" selected={releaseFilter} values={['linked', 'unlinked', 'unavailable']} onSelect={onReleaseFilter} />
      <FilterGroup label="Role filter" selected={roleFilter} values={['driver present', 'driver missing']} onSelect={onRoleFilter} />
      <FilterChip label="View: Dense" onClick={() => onViewMode('dense')} selected={viewMode === 'dense'} />
      <FilterChip label="View: Preview" onClick={() => onViewMode('preview')} selected={viewMode === 'preview'} />
    </DenseToolbar>
  );
}

function FilterGroup({
  label,
  onSelect,
  selected,
  values,
}: {
  label: string;
  onSelect: (value: string) => void;
  selected: string;
  values: string[];
}) {
  return (
    <div className="flex shrink-0 flex-nowrap items-center gap-2">
      <FilterChip label={`${label}: All`} onClick={() => onSelect('all')} selected={selected === 'all'} />
      {values.map((value) => (
        <FilterChip key={value} label={`${label}: ${formatValue(value)}`} onClick={() => onSelect(value)} selected={selected === value} />
      ))}
    </div>
  );
}

function typedDocumentColumns(definition: TypedDocumentWorkspaceDefinition): DataTableColumn<TypedDocumentWorkspaceRow>[] {
  return [
    {
      key: 'title',
      header: 'Title',
      cell: (item) => (
        <div className="grid min-w-[14rem] gap-1">
          <span className="font-semibold text-text-primary">{item.title}</span>
          <Link className={secondaryLinkClass} to={item.href}>
            Open {definition.detailNoun}
          </Link>
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (item) => <StatusPill tone="neutral">{item.status}</StatusPill> },
    { key: 'priority', header: 'Priority', cell: (item) => item.priority },
    { key: 'risk', header: 'Risk', cell: (item) => <Badge tone={riskTone(item.risk)}>{riskLabel(item.risk)}</Badge> },
    { key: 'driver', header: definition.driverLabel, cell: (item) => item.driver },
    ...definition.typeSpecificColumns.map((column): DataTableColumn<TypedDocumentWorkspaceRow> => ({
      key: column.key,
      header: column.header,
      cell: (item) => item[column.field] ?? 'Unavailable',
    })),
    { key: 'development-plan-coverage', header: 'Development Plan coverage', cell: (item) => item.developmentPlanCoverage },
    { key: 'plan-item-coverage', header: 'Plan Item coverage', cell: (item) => item.planItemCoverage },
    { key: 'downstream-gates', header: 'Downstream gates', cell: (item) => item.downstreamGateSummary },
    { key: 'updated', header: 'Last meaningful update', cell: (item) => item.lastMeaningfulUpdate },
    { key: 'action', header: 'Next action', cell: (item) => item.nextAction },
  ];
}

function TypedDocumentActions({
  createHref,
  definition,
  planningHref,
}: {
  createHref: string;
  definition: TypedDocumentWorkspaceDefinition;
  planningHref: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link className={primaryLinkClass} to={createHref}>
        {definition.createLabel}
      </Link>
      <Link className={secondaryButtonClass} to={planningHref}>
        Create Development Plan
      </Link>
    </div>
  );
}

function TypedDocumentEmptyState({
  createHref,
  definition,
  description,
  planningHref,
}: {
  createHref: string;
  definition: TypedDocumentWorkspaceDefinition;
  description: string;
  planningHref: string;
}) {
  return (
    <EmptyState
      actions={<TypedDocumentActions createHref={createHref} definition={definition} planningHref={planningHref} />}
      data-typed-document-empty-state=""
      description={description === definition.emptyTitle ? 'Adjust filters or create a typed planning input.' : description}
      title={definition.emptyTitle}
    />
  );
}

function TypedDocumentInspector({
  definition,
  row,
  subtitle,
}: {
  definition: TypedDocumentWorkspaceDefinition;
  row: TypedDocumentWorkspaceRow | undefined;
  subtitle: string;
}) {
  if (row === undefined) {
    return (
      <section aria-label={definition.inspectorLabel} className="grid gap-3 rounded-card border border-border bg-surface p-4">
        <h2 className="text-base font-semibold text-text-primary">{definition.inspectorLabel}</h2>
        <p className="m-0 text-sm text-text-secondary">No row selected.</p>
      </section>
    );
  }

  return (
    <section aria-label={definition.inspectorLabel} className="grid gap-3 rounded-card border border-border bg-surface p-4">
      <div className="grid gap-1">
        <h2 className="text-base font-semibold text-text-primary">{row.title}</h2>
        <p className="m-0 text-sm text-text-secondary">{subtitle}</p>
      </div>
      <p className="m-0 text-sm text-text-secondary">{row.previewSummary}</p>
      <PropertyList
        items={[
          { label: 'Next action', value: row.nextAction },
          ...definition.typeSpecificColumns.map((column) => ({ label: column.header, value: row[column.field] ?? 'Unavailable' })),
          { label: 'Development Plan coverage', value: row.developmentPlanCoverage },
          { label: 'Plan Item coverage', value: row.planItemCoverage },
          { label: 'Downstream gates', value: row.downstreamGateSummary },
          { label: 'Last update', value: row.lastMeaningfulUpdate },
          { label: 'Related objects', value: row.relatedObjects },
          { label: 'Release refs', value: row.releaseRefs },
        ]}
      />
      <Link className={secondaryButtonClass} to={row.href}>
        Open {definition.detailNoun}
      </Link>
    </section>
  );
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

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values)).filter(Boolean);
}

function riskLabel(risk: string): string {
  return risk === 'Unavailable' ? risk : `${formatValue(risk)} risk`;
}

function riskTone(risk: string): 'neutral' | 'warning' | 'danger' {
  const text = risk.toLowerCase();
  if (text.includes('high') || text.includes('critical')) return 'danger';
  if (text.includes('risk') || text.includes('medium')) return 'warning';
  return 'neutral';
}

function formatValue(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

const primaryLinkClass =
  'inline-flex min-h-10 items-center rounded-md border border-primary bg-primary px-4 text-sm font-semibold text-white';
const secondaryButtonClass =
  'inline-flex min-h-10 items-center rounded-md border border-border bg-surface px-4 text-sm font-semibold text-text-primary';
const secondaryLinkClass = 'text-sm font-semibold text-primary hover:underline';
