import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';

import { createForgeloopCommandApi } from '../../shared/api/commands';
import { useBugsQuery, useDevelopmentPlansQuery, useInitiativesQuery, useRequirementsQuery, useTechDebtQuery } from '../../shared/api/hooks';
import type { SourceObjectRef } from '../../shared/api/types';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { PlanningTableWorkspace, Section } from '../../shared/layout';
import { Badge, Button, DataTable, EmptyState, InlineNotice, Select, StatusPill, Textarea, type DataTableColumn } from '../../shared/ui';
import { SurfaceStateIndicator } from '../project-management/surface-state';
import { formatValue } from './development-plan-table';

type DevelopmentPlanListRow = {
  id: string;
  title: string;
  status?: string;
  source_refs?: Array<{ type: string; id: string; title?: string }>;
  item_count?: number;
  blocked_count?: number;
  responsible_role?: string;
  responsible_roles?: string[];
  gate_state?: string;
  gate_states?: string[];
  risk?: string;
  risks?: string[];
  updated_at?: string;
};

type DevelopmentPlanFilterState = {
  sourceType: string;
  role: string;
  gate: string;
  risk: string;
  status: string;
};

type SourceObjectType = SourceObjectRef['type'];

type SourceObjectListItem = {
  id?: string | undefined;
  ref?: { type?: string | undefined; id?: string | undefined; title?: string | undefined } | undefined;
  title?: string | undefined;
};

type SourceObjectOption = {
  label: string;
  value: string;
};

const defaultFilters: DevelopmentPlanFilterState = {
  sourceType: 'all',
  role: 'all',
  gate: 'all',
  risk: 'all',
  status: 'all',
};

const sourceTypeOptions = [
  { label: 'All source types', value: 'all' },
  { label: 'Requirements', value: 'requirement' },
  { label: 'Initiatives', value: 'initiative' },
  { label: 'Bugs', value: 'bug' },
  { label: 'Tech Debt', value: 'tech_debt' },
];

const roleOptions = [
  { label: 'All roles', value: 'all' },
  { label: 'Product', value: 'product' },
  { label: 'Tech Lead', value: 'tech_lead' },
  { label: 'Developer', value: 'developer' },
  { label: 'QA', value: 'qa' },
  { label: 'Release', value: 'release_owner' },
  { label: 'Manager', value: 'manager' },
];

const gateOptions = [
  { label: 'All gates', value: 'all' },
  { label: 'Boundary', value: 'boundary' },
  { label: 'Spec', value: 'spec' },
  { label: 'Execution Plan', value: 'execution_plan' },
  { label: 'Execution', value: 'execution' },
  { label: 'Review', value: 'review' },
  { label: 'QA', value: 'qa' },
  { label: 'Release', value: 'release' },
];

const riskOptions = [
  { label: 'All risks', value: 'all' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Critical', value: 'critical' },
];

const statusOptions = [
  { label: 'All statuses', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Draft', value: 'draft' },
  { label: 'In Review', value: 'in_review' },
  { label: 'Approved', value: 'approved' },
  { label: 'Blocked', value: 'blocked' },
  { label: 'Complete', value: 'complete' },
];

const sourceAuthoringOptions = sourceTypeOptions.filter((option) => option.value !== 'all');

export function DevelopmentPlansRoute() {
  const { projectId } = useProjectContext();
  const query = useDevelopmentPlansQuery({ project_id: projectId });
  const rows = (query.data?.items ?? []) as DevelopmentPlanListRow[];
  const [filters, setFilters] = useState(defaultFilters);
  const filteredRows = useMemo(() => rows.filter((row) => rowMatchesFilters(row, filters)), [filters, rows]);
  const totalItems = rows.reduce((count, row) => count + (row.item_count ?? 0), 0);
  const blockedCount = rows.reduce((count, row) => count + (row.blocked_count ?? 0), 0);
  const activeCount = rows.filter((row) => row.status === 'active').length;

  return (
    <PlanningTableWorkspace
      as="div"
      blockerRisk={`${blockedCount} blocked. ${rows.length === 0 ? 'No source-linked planning risk yet.' : 'Review blocked Plan Items before downstream artifact work.'}`}
      family="development-plan-index"
      heading="Development Plans"
      nextAction={rows.length === 0 ? 'Create or generate a Development Plan from source context.' : 'Open the oldest blocked or high-risk Plan Item.'}
      roleResponsibility="Product and tech lead roles maintain source-linked Plan Item boundaries."
      state={query.isLoading ? 'Loading plans' : query.isError ? 'Plan index error' : `${activeCount} active ${pluralize(activeCount, 'plan')}`}
      subtitle="Create source-linked Development Plans, then govern Spec and Execution Plan work through approved Plan Items."
      toolbar={<DevelopmentPlanIndexActions />}
    >
      <SurfaceStateIndicator
        label="Development Plans"
        state={query.isLoading ? 'loading' : query.isError ? 'error' : rows.length === 0 ? 'empty' : undefined}
      />
      {query.isError ? <InlineNotice title="Development Plans could not be loaded." tone="danger" /> : null}
      <Section
        actions={<DevelopmentPlanFilters filters={filters} onFiltersChange={setFilters} />}
        description={`${rows.length} ${pluralize(rows.length, 'plan')} · ${totalItems} ${pluralize(totalItems, 'Plan Item')} · ${blockedCount} blocked`}
        title="Active Development Plans"
      >
        <DataTable
          ariaLabel="Active Development Plans"
          columns={columns}
          density="compact"
          emptyMessage={<DevelopmentPlanEmptyState />}
          getRowKey={(row) => row.id}
          rows={filteredRows}
          stickyHeader
        />
      </Section>
    </PlanningTableWorkspace>
  );
}

export function DevelopmentPlanNewRoute() {
  const { actorId } = useActorContext();
  const { projectId } = useProjectContext();
  const requirementQuery = useRequirementsQuery({ project_id: projectId, limit: 100 });
  const initiativeQuery = useInitiativesQuery({ project_id: projectId, limit: 100 });
  const bugQuery = useBugsQuery({ project_id: projectId, limit: 100 });
  const techDebtQuery = useTechDebtQuery({ project_id: projectId, limit: 100 });
  const [title, setTitle] = useState('');
  const [sourceType, setSourceType] = useState<SourceObjectType>('requirement');
  const [sourceId, setSourceId] = useState('');
  const [manualGuidance, setManualGuidance] = useState('');
  const [aiGuidance, setAiGuidance] = useState('Draft a table-first Development Plan with source-linked Plan Items and boundary risks.');
  const [actionState, setActionState] = useState<{ status: 'idle' | 'running' | 'success' | 'error'; message?: string; planId?: string }>({ status: 'idle' });

  const sourceQueries = useMemo(
    () => ({
      bug: bugQuery,
      initiative: initiativeQuery,
      requirement: requirementQuery,
      tech_debt: techDebtQuery,
    }),
    [bugQuery, initiativeQuery, requirementQuery, techDebtQuery],
  );
  const sourceObjectOptionsByType = useMemo<Record<SourceObjectType, SourceObjectOption[]>>(
    () => ({
      bug: sourceOptionsFromItems(bugQuery.data?.items, 'bug'),
      initiative: sourceOptionsFromItems(initiativeQuery.data?.items, 'initiative'),
      requirement: sourceOptionsFromItems(requirementQuery.data?.items, 'requirement'),
      tech_debt: sourceOptionsFromItems(techDebtQuery.data?.items, 'tech_debt'),
    }),
    [bugQuery.data?.items, initiativeQuery.data?.items, requirementQuery.data?.items, techDebtQuery.data?.items],
  );
  const currentSourceObjectOptions = sourceObjectOptions(sourceType, sourceObjectOptionsByType);
  const visibleSourceObjectOptions = currentSourceObjectOptions.length > 0
    ? currentSourceObjectOptions
    : [{ label: `${formatValue(sourceType)} source objects unavailable`, value: '' }];
  const selectedSourceQuery = sourceQueries[sourceType];
  const selectedSourceOption = currentSourceObjectOptions.find((option) => option.value === sourceId);
  const validation = validateAuthoring({
    sourceId,
    sourceObjectCount: currentSourceObjectOptions.length,
    sourceObjectsError: selectedSourceQuery.isError,
    sourceObjectsLoading: selectedSourceQuery.isLoading,
    title,
  });
  const sourceRef = sourceRefFor(sourceType, sourceId, selectedSourceOption?.label);

  useEffect(() => {
    if (!currentSourceObjectOptions.some((option) => option.value === sourceId)) {
      setSourceId(currentSourceObjectOptions[0]?.value ?? '');
    }
  }, [currentSourceObjectOptions, sourceId]);

  const createPlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (validation.hasBlockingIssue) {
      setActionState({ status: 'error', message: 'Select a source object before creating the Development Plan.' });
      return;
    }

    setActionState({ status: 'running', message: 'Creating Development Plan from source context.' });
    try {
      const created = await createForgeloopCommandApi().createDevelopmentPlan({
        actor_id: actorId,
        ...(manualGuidance.trim().length > 0 ? { guidance: manualGuidance.trim() } : {}),
        project_id: projectId,
        source_ref: sourceRef,
        title: title.trim() || `${sourceRef.title ?? sourceRef.id} Development Plan`,
      });
      setActionState({
        status: 'success',
        message: 'Development Plan created with source context. Add Plan Items before downstream artifacts.',
        ...(typeof created.id === 'string' ? { planId: created.id } : {}),
      });
    } catch {
      setActionState({ status: 'error', message: 'Development Plan could not be created from this source context.' });
    }
  };

  const generatePlan = async () => {
    if (validation.hasBlockingIssue) {
      setActionState({ status: 'error', message: 'Select a source object before generating a Development Plan draft.' });
      return;
    }

    setActionState({ status: 'running', message: 'Generating Development Plan draft from source context.' });
    try {
      const guidance = aiGuidance.trim() || manualGuidance.trim();
      const generated = await createForgeloopCommandApi().generateDevelopmentPlanDraft({
        actor_id: actorId,
        project_id: projectId,
        source_ref: sourceRef,
        ...(guidance.length > 0 ? { guidance } : {}),
      });
      const planId = typeof generated.id === 'string' ? generated.id : undefined;
      setActionState({
        status: 'success',
        message: 'Development Plan draft generated with source context. Review Plan Items before boundary approval.',
        ...(planId === undefined ? {} : { planId }),
      });
    } catch {
      setActionState({ status: 'error', message: 'AI-assisted Development Plan draft could not be generated.' });
    }
  };

  return (
    <PlanningTableWorkspace
      as="div"
      blockerRisk="Downstream Spec and Execution Plan documents are generated only from Plan Items after boundary approval."
      family="development-plan-index"
      heading="New Development Plan"
      nextAction="Select source context, then create or generate a Plan Item table."
      roleResponsibility="Product owns source intent; tech lead owns the first boundary review."
      state="Authoring from source context"
      subtitle="Author a source-linked planning workspace without directly generating downstream documents."
      toolbar={<Link className="inline-flex min-h-10 items-center rounded-md border border-border bg-surface px-4 text-sm font-semibold text-text-primary hover:bg-surface-muted" to="/development-plans">Back to Development Plans</Link>}
    >
      <SurfaceStateIndicator label="New Development Plan" state={validation.hasBlockingIssue ? 'blocked' : 'approved'} />
      <form className="grid gap-4" onSubmit={(event) => void createPlan(event)}>
        <Section
          description="Manual creation records source context and starts an empty Plan Item table for boundary approval."
          title="Manual source context"
          variant="panel"
        >
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_minmax(10rem,0.8fr)]">
            <label className="grid gap-1 text-sm font-semibold text-text-primary">
              Development Plan title
              <input
                className="min-h-10 rounded-md border border-border bg-surface px-3 text-sm font-normal text-text-primary"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-text-primary">
              Source type
              <Select
                aria-label="Source type"
                options={sourceAuthoringOptions}
                value={sourceType}
                onChange={(event) => {
                  const nextSourceType = event.target.value;
                  if (isSourceObjectType(nextSourceType)) {
                    const nextSourceOptions = sourceObjectOptions(nextSourceType, sourceObjectOptionsByType);
                    setSourceType(nextSourceType);
                    setSourceId(nextSourceOptions[0]?.value ?? '');
                  }
                }}
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-text-primary">
              Source object
              <Select
                aria-label="Source object"
                disabled={currentSourceObjectOptions.length === 0 || selectedSourceQuery.isLoading || selectedSourceQuery.isError}
                options={visibleSourceObjectOptions}
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value)}
              />
            </label>
          </div>
          {selectedSourceQuery.isLoading ? <InlineNotice title={`Loading ${formatValue(sourceType)} source objects.`} tone="info" /> : null}
          {selectedSourceQuery.isError ? <InlineNotice title={`${formatValue(sourceType)} source objects could not be loaded.`} tone="danger" /> : null}
          {!selectedSourceQuery.isLoading && !selectedSourceQuery.isError && currentSourceObjectOptions.length === 0 ? (
            <InlineNotice title={`No ${formatValue(sourceType)} source objects are available for this project.`} tone="warning" />
          ) : null}
          <label className="mt-3 grid gap-1 text-sm font-semibold text-text-primary">
            Manual source guidance
            <Textarea
              aria-label="Manual source guidance"
              placeholder="Capture source constraints, acceptance criteria, dependencies, or known risks for Plan Item authoring."
              value={manualGuidance}
              onChange={(event) => setManualGuidance(event.target.value)}
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button disabled={validation.hasBlockingIssue} loading={actionState.status === 'running'} type="submit" variant="primary">
              Create Development Plan
            </Button>
          </div>
        </Section>

        <Section
          description="AI assistance proposes Development Plan rows from source context. It does not create Spec or Execution Plan documents."
          title="AI-assisted plan generation"
          variant="panel"
        >
          <label className="grid gap-1 text-sm font-semibold text-text-primary">
            AI generation guidance
            <Textarea
              aria-label="AI generation guidance"
              value={aiGuidance}
              onChange={(event) => setAiGuidance(event.target.value)}
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button disabled={validation.hasBlockingIssue} loading={actionState.status === 'running'} onClick={() => void generatePlan()} variant="secondary">
              Generate AI-assisted draft
            </Button>
          </div>
        </Section>
      </form>

      <Section title="Validation summary" variant="subtle">
        <ul className="m-0 grid gap-2 pl-5 text-sm text-text-secondary">
          {validation.messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
          <li>Source objects create or generate Development Plans only; downstream artifacts wait for approved Plan Items.</li>
        </ul>
        {actionState.status !== 'idle' ? (
          <InlineNotice
            description={actionState.planId ? <Link className="font-semibold text-primary hover:underline" to={`/development-plans/${actionState.planId}`}>Open Development Plan</Link> : undefined}
            title={actionState.message ?? 'Command state updated.'}
            tone={actionState.status === 'success' ? 'success' : actionState.status === 'error' ? 'danger' : 'info'}
          />
        ) : null}
      </Section>
    </PlanningTableWorkspace>
  );
}

function DevelopmentPlanIndexActions() {
  return (
    <>
      <Link className="inline-flex min-h-10 items-center rounded-md border border-primary bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover" to="/development-plans/new">
        Create Development Plan
      </Link>
      <Link className="inline-flex min-h-10 items-center rounded-md border border-border bg-surface px-4 text-sm font-semibold text-text-primary hover:bg-surface-muted" to="/development-plans/new">
        Generate with AI assistance
      </Link>
    </>
  );
}

function DevelopmentPlanFilters({
  filters,
  onFiltersChange,
}: {
  filters: DevelopmentPlanFilterState;
  onFiltersChange: (filters: DevelopmentPlanFilterState) => void;
}) {
  const updateFilter = (key: keyof DevelopmentPlanFilterState, value: string) => onFiltersChange({ ...filters, [key]: value });

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      <label className="grid gap-1 text-xs font-semibold uppercase text-text-secondary">
        Source type
        <Select aria-label="Source type" options={sourceTypeOptions} value={filters.sourceType} onChange={(event) => updateFilter('sourceType', event.target.value)} />
      </label>
      <label className="grid gap-1 text-xs font-semibold uppercase text-text-secondary">
        Role
        <Select aria-label="Role" options={roleOptions} value={filters.role} onChange={(event) => updateFilter('role', event.target.value)} />
      </label>
      <label className="grid gap-1 text-xs font-semibold uppercase text-text-secondary">
        Gate
        <Select aria-label="Gate" options={gateOptions} value={filters.gate} onChange={(event) => updateFilter('gate', event.target.value)} />
      </label>
      <label className="grid gap-1 text-xs font-semibold uppercase text-text-secondary">
        Risk
        <Select aria-label="Risk" options={riskOptions} value={filters.risk} onChange={(event) => updateFilter('risk', event.target.value)} />
      </label>
      <label className="grid gap-1 text-xs font-semibold uppercase text-text-secondary">
        Status
        <Select aria-label="Status" options={statusOptions} value={filters.status} onChange={(event) => updateFilter('status', event.target.value)} />
      </label>
    </div>
  );
}

function DevelopmentPlanEmptyState() {
  return (
    <EmptyState
      description="Select source context, then create a table of Plan Items for boundary approval before downstream artifact generation."
      title="No active Development Plans yet."
    />
  );
}

const columns: DataTableColumn<DevelopmentPlanListRow>[] = [
  {
    key: 'title',
    header: 'Development Plan',
    cell: (row) => (
      <Link className="font-semibold text-primary hover:underline" to={`/development-plans/${encodeURIComponent(row.id)}`}>
        {row.title}
      </Link>
    ),
  },
  {
    key: 'source',
    header: 'Source links',
    cell: (row) => (
      <div className="grid gap-1">
        {row.source_refs?.length ? row.source_refs.map((ref) => (
          <Link className="font-medium text-primary hover:underline" key={`${ref.type}-${ref.id}`} to={sourceHref(ref)}>
            {ref.title ?? `${formatValue(ref.type)} ${ref.id}`}
          </Link>
        )) : <span className="text-text-muted">Not linked</span>}
      </div>
    ),
  },
  {
    key: 'items',
    header: 'Plan items',
    cell: (row) => `${row.item_count ?? 0} ${pluralize(row.item_count ?? 0, 'Plan Item')}`,
  },
  { key: 'role', header: 'Role', cell: (row) => formatValues(row.responsible_roles, row.responsible_role, 'mixed') },
  { key: 'gate', header: 'Gate', cell: (row) => formatValues(row.gate_states, row.gate_state, 'boundary') },
  {
    key: 'risk',
    header: 'Risk',
    cell: (row) => <Badge tone={riskTone(row.risk)}>{formatValue(row.risk ?? 'medium')}</Badge>,
  },
  { key: 'status', header: 'Status', cell: (row) => <StatusPill tone={statusTone(row.status)}>{formatValue(row.status)}</StatusPill> },
  { key: 'blocked', header: 'Blocked', cell: (row) => <Badge tone={row.blocked_count ? 'warning' : 'success'}>{row.blocked_count ?? 0}</Badge> },
  { key: 'updated', header: 'Updated', cell: (row) => formatDate(row.updated_at) },
];

function rowMatchesFilters(row: DevelopmentPlanListRow, filters: DevelopmentPlanFilterState): boolean {
  return (
    (filters.sourceType === 'all' || (row.source_refs?.some((ref) => ref.type === filters.sourceType) ?? false)) &&
    matchesProjectionFilter(row.responsible_roles, row.responsible_role, filters.role) &&
    matchesProjectionFilter(row.gate_states, row.gate_state, filters.gate) &&
    matchesProjectionFilter(row.risks, row.risk, filters.risk) &&
    (filters.status === 'all' || row.status === filters.status)
  );
}

function validateAuthoring(input: {
  sourceId: string;
  sourceObjectCount: number;
  sourceObjectsError: boolean;
  sourceObjectsLoading: boolean;
  title: string;
}) {
  const messages = [
    input.title.trim().length > 0 ? 'Title is ready.' : 'Title can be added now or inferred from source context.',
    sourceObjectSelectionMessage(input),
    'Plan Items remain the boundary for Spec, Execution Plan, execution, review, QA, and release readiness.',
  ];

  return {
    hasBlockingIssue:
      input.sourceObjectsLoading ||
      input.sourceObjectsError ||
      input.sourceObjectCount === 0 ||
      input.sourceId.trim().length === 0,
    messages,
  };
}

function sourceObjectSelectionMessage(input: {
  sourceId: string;
  sourceObjectCount: number;
  sourceObjectsError: boolean;
  sourceObjectsLoading: boolean;
}) {
  if (input.sourceObjectsLoading) return 'Source objects are loading from live project data.';
  if (input.sourceObjectsError) return 'Source object list failed to load.';
  if (input.sourceObjectCount === 0) return 'Create a source object before authoring a Development Plan.';
  return input.sourceId.trim().length > 0 ? 'Source object is selected.' : 'Source object selection is required.';
}

function sourceObjectOptions(sourceType: SourceObjectType, optionsByType: Record<SourceObjectType, SourceObjectOption[]>) {
  return optionsByType[sourceType] ?? [];
}

function sourceOptionsFromItems(items: readonly SourceObjectListItem[] | undefined, sourceType: SourceObjectType): SourceObjectOption[] {
  return (items ?? []).flatMap((item) => {
    const id = item.ref?.id ?? item.id;
    if (id === undefined || id.trim().length === 0) return [];
    return [{
      label: item.title ?? item.ref?.title ?? `${formatValue(sourceType)} ${id}`,
      value: id,
    }];
  });
}

function sourceRefFor(sourceType: SourceObjectType, sourceId: string, sourceTitle: string | undefined): SourceObjectRef {
  const id = sourceId.trim();
  return { type: sourceType, id, title: sourceTitle ?? `${formatValue(sourceType)} ${id}` } as SourceObjectRef;
}

function isSourceObjectType(value: string): value is SourceObjectType {
  return value === 'requirement' || value === 'initiative' || value === 'bug' || value === 'tech_debt';
}

function sourceHref(ref: { type: string; id: string }) {
  switch (ref.type) {
    case 'requirement':
      return `/requirements/${encodeURIComponent(ref.id)}`;
    case 'initiative':
      return `/initiatives/${encodeURIComponent(ref.id)}`;
    case 'bug':
      return `/bugs/${encodeURIComponent(ref.id)}`;
    case 'tech_debt':
      return `/tech-debt/${encodeURIComponent(ref.id)}`;
    default:
      return '/development-plans';
  }
}

function statusTone(status: string | undefined): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'active' || status === 'in_review') return 'info';
  if (status === 'approved' || status === 'complete') return 'success';
  if (status === 'blocked') return 'danger';
  if (status === 'draft') return 'warning';
  return 'neutral';
}

function riskTone(risk: string | undefined): 'neutral' | 'success' | 'warning' | 'danger' {
  if (risk === 'low') return 'success';
  if (risk === 'high' || risk === 'critical') return 'danger';
  if (risk === 'medium') return 'warning';
  return 'neutral';
}

function formatDate(value: string | undefined): string {
  if (value === undefined) return 'Not recorded';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function pluralize(count: number, label: string): string {
  return count === 1 ? label : `${label}s`;
}

function matchesProjectionFilter(values: string[] | undefined, value: string | undefined, selected: string): boolean {
  if (selected === 'all') return true;
  const candidates = values?.length ? values : value === undefined ? [] : [value];
  return candidates.includes(selected);
}

function formatValues(values: string[] | undefined, value: string | undefined, fallback: string): string {
  const candidates = values?.length ? values : [value ?? fallback];
  return candidates.map((candidate) => formatValue(candidate)).join(', ');
}
