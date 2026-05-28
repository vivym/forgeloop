import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';

import { createForgeloopCommandApi } from '../../shared/api/commands';
import { useBugsQuery, useDevelopmentPlansQuery, useInitiativesQuery, useRequirementsQuery, useTechDebtQuery } from '../../shared/api/hooks';
import type { SourceObjectRef } from '../../shared/api/types';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { CompactMetadata, DevelopmentPlanWorkspace, PlanAuthoringLayout, PreviewPane, ProductPage, Section } from '../../shared/layout';
import { Badge, Button, DataTable, EmptyState, InlineNotice, Select, StatusPill, Textarea, type DataTableColumn } from '../../shared/ui';
import { developmentPlanWorkspaceViewModel } from './development-plan-view-model';
import { formatValue, statusTone } from './development-plan-table';

type DevelopmentPlanListRow = {
  id: string;
  title: string;
  status?: string;
  source_refs?: Array<{ type: string; id: string; title?: string }>;
  items?: Array<{
    id: string;
    title?: string;
    responsible_role?: string;
    driver_actor_id?: string;
    reviewer_actor_id?: string;
    boundary_status?: string;
    spec_status?: string;
    execution_plan_status?: string;
    execution_status?: string;
    review_status?: string;
    qa_handoff_status?: string;
    risk?: string;
    release_impact?: string;
    next_action?: string;
  }>;
  item_count?: number;
  blocked_count?: number;
  responsible_role?: string;
  responsible_roles?: string[];
  driver_actor_id?: string;
  driver_actor_ids?: string[];
  reviewer_actor_id?: string;
  reviewer_actor_ids?: string[];
  gate_state?: string;
  gate_states?: string[];
  risk?: string;
  risks?: string[];
  release_impact?: string;
  release_impacts?: string[];
  updated_at?: string;
};

type DevelopmentPlanFilterState = {
  sourceType: string;
  role: string;
  driver: string;
  reviewer: string;
  gate: string;
  risk: string;
  releaseImpact: string;
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
  driver: 'all',
  reviewer: 'all',
  gate: 'all',
  risk: 'all',
  releaseImpact: 'all',
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

const releaseImpactOptions = [
  { label: 'All release impact', value: 'all' },
  { label: 'Release scoped', value: 'release_scoped' },
  { label: 'No release impact', value: 'none' },
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
  const viewModel = useMemo(() => developmentPlanWorkspaceViewModel(filteredRows), [filteredRows]);
  const selectedPlanRow = viewModel.selectedPlan === undefined ? undefined : filteredRows.find((row) => row.id === viewModel.selectedPlan?.id);

  return (
    <ProductPage family="planning-table" ariaLabel="Development Plans">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-normal text-text-secondary">Planning workspace</p>
          <h1 className="mt-1 text-2xl font-semibold text-text-primary">Development Plans</h1>
        </div>
        {query.isLoading ? <InlineNotice title="Loading Development Plans." tone="info" /> : null}
        {query.isError ? <InlineNotice title="Development Plans could not be loaded." tone="danger" /> : null}
      </div>
      <DevelopmentPlanWorkspace
        toolbar={<DevelopmentPlanIndexToolbar filters={filters} rows={rows} onFiltersChange={setFilters} />}
        table={
          <section className="grid min-w-0 content-start gap-3 lg:min-h-[70vh]" data-plan-items-table="" data-primary-work-surface="">
            <DevelopmentPlanSummaryBar metrics={viewModel.summaryMetrics} />
            <DataTable
              ariaLabel="Active Development Plans"
              columns={columns}
              density="compact"
              emptyMessage={<DevelopmentPlanEmptyState />}
              getRowKey={(row) => row.id}
              rows={filteredRows}
              stickyHeader
            />
            <DevelopmentPlanIndexActions />
          </section>
        }
        inspector={<DevelopmentPlanIndexInspector plan={viewModel.selectedPlan} planRow={selectedPlanRow} />}
      />
    </ProductPage>
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
  const [aiGuidance, setAiGuidance] = useState('Draft a table-first Development Plan with linked typed refs, Plan Items, boundary risks, and release impact.');
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
    : [{ label: `${formatValue(sourceType)} typed refs unavailable`, value: '' }];
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
      setActionState({ status: 'error', message: 'Select a typed ref before creating the Development Plan.' });
      return;
    }

    setActionState({ status: 'running', message: 'Creating Development Plan from typed refs.' });
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
        message: 'Development Plan created with typed refs. Add Plan Items before downstream artifacts.',
        ...(typeof created.id === 'string' ? { planId: created.id } : {}),
      });
    } catch {
      setActionState({ status: 'error', message: 'Development Plan could not be created from this typed ref.' });
    }
  };

  const generatePlan = async () => {
    if (validation.hasBlockingIssue) {
      setActionState({ status: 'error', message: 'Select a typed ref before generating a Development Plan draft.' });
      return;
    }

    setActionState({ status: 'running', message: 'Generating Development Plan draft from typed refs.' });
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
    <ProductPage family="plan-authoring" ariaLabel="New Development Plan">
      <h1 className="mb-3 text-xl font-semibold text-text-primary">New Development Plan</h1>
      <PlanAuthoringLayout
        sourceContext={
          <div className="grid gap-4">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Link className="inline-flex min-h-10 items-center rounded-md border border-border bg-surface px-4 text-sm font-semibold text-text-primary hover:bg-surface-muted" to="/development-plans">Back to Development Plans</Link>
            </div>
            <form className="grid gap-4" onSubmit={(event) => void createPlan(event)}>
              <Section
                description="Manual creation records typed refs and starts an empty Plan Item table for boundary approval."
                title="Manual source context"
                variant="panel"
              >
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_minmax(10rem,0.8fr)]">
                  <label className="grid gap-1 text-sm font-semibold text-text-primary">
                    Development Plan title
                    <input className="min-h-10 rounded-md border border-border bg-surface px-3 text-sm font-normal text-text-primary" value={title} onChange={(event) => setTitle(event.target.value)} />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold text-text-primary">
                    Source type
                    <Select aria-label="Source type" options={sourceAuthoringOptions} value={sourceType} onChange={(event) => {
                      const nextSourceType = event.target.value;
                      if (isSourceObjectType(nextSourceType)) {
                        const nextSourceOptions = sourceObjectOptions(nextSourceType, sourceObjectOptionsByType);
                        setSourceType(nextSourceType);
                        setSourceId(nextSourceOptions[0]?.value ?? '');
                      }
                    }} />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold text-text-primary">
                    Source object
                    <Select aria-label="Source object" disabled={currentSourceObjectOptions.length === 0 || selectedSourceQuery.isLoading || selectedSourceQuery.isError} options={visibleSourceObjectOptions} value={sourceId} onChange={(event) => setSourceId(event.target.value)} />
                  </label>
                </div>
                {selectedSourceQuery.isLoading ? <InlineNotice title={`Loading ${formatValue(sourceType)} typed refs.`} tone="info" /> : null}
                {selectedSourceQuery.isError ? <InlineNotice title={`${formatValue(sourceType)} typed refs could not be loaded.`} tone="danger" /> : null}
                {!selectedSourceQuery.isLoading && !selectedSourceQuery.isError && currentSourceObjectOptions.length === 0 ? (
                  <InlineNotice title={`No ${formatValue(sourceType)} typed refs are available for this project.`} tone="warning" />
                ) : null}
                <label className="mt-3 grid gap-1 text-sm font-semibold text-text-primary">
                  Manual source guidance
                  <Textarea aria-label="Manual source guidance" placeholder="Capture constraints, acceptance criteria, dependencies, or known risks for Plan Item authoring." value={manualGuidance} onChange={(event) => setManualGuidance(event.target.value)} />
                </label>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button disabled={validation.hasBlockingIssue} loading={actionState.status === 'running'} type="submit" variant="primary">
                    Create Development Plan
                  </Button>
                </div>
              </Section>
            </form>
          </div>
        }
        aiAssist={
          <Section description="AI assistance proposes Plan Items from typed refs. It does not create Spec or Execution Plan documents." title="AI-assisted plan generation" variant="panel">
            <label className="grid gap-1 text-sm font-semibold text-text-primary">
              AI generation guidance
              <Textarea aria-label="AI generation guidance" value={aiGuidance} onChange={(event) => setAiGuidance(event.target.value)} />
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button disabled={validation.hasBlockingIssue} loading={actionState.status === 'running'} onClick={() => void generatePlan()} type="button" variant="secondary">
                Generate AI-assisted draft
              </Button>
            </div>
          </Section>
        }
        preview={
          <Section title="Validation summary" variant="subtle">
            <ul className="m-0 grid gap-2 pl-5 text-sm text-text-secondary">
              {validation.messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
              <li>Downstream Spec and Execution Plan documents are generated only from Plan Items after boundary approval.</li>
              <li>Typed refs create or generate Development Plans only; downstream artifacts wait for approved Plan Items.</li>
            </ul>
            {actionState.status !== 'idle' ? (
              <InlineNotice
                description={actionState.planId ? <Link className="font-semibold text-primary hover:underline" to={`/development-plans/${actionState.planId}`}>Open Development Plan</Link> : undefined}
                title={actionState.message ?? 'Command state updated.'}
                tone={actionState.status === 'success' ? 'success' : actionState.status === 'error' ? 'danger' : 'info'}
              />
            ) : null}
          </Section>
        }
      />
    </ProductPage>
  );
}

function DevelopmentPlanSummaryBar({ metrics }: { metrics: Array<{ label: string; value: string; detail?: string }> }) {
  return (
    <dl className="grid gap-2 rounded-card border border-border bg-surface-subtle p-2 sm:grid-cols-2 xl:grid-cols-5" data-development-plan-summary-bar="">
      {metrics.map((metric) => (
        <div className="rounded-md border border-border bg-surface px-3 py-2" key={metric.label}>
          <dt className="text-[0.68rem] font-semibold uppercase tracking-normal text-text-secondary">{metric.label}</dt>
          <dd className="mt-1 text-base font-semibold text-text-primary">{metric.value}</dd>
          {metric.detail === undefined ? null : <dd className="text-xs text-text-secondary">{metric.detail}</dd>}
        </div>
      ))}
    </dl>
  );
}

function DevelopmentPlanIndexActions() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link className="inline-flex min-h-10 items-center rounded-md border border-primary bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover" to="/development-plans/new">
        Create Development Plan
      </Link>
      <Link className="inline-flex min-h-10 items-center rounded-md border border-border bg-surface px-4 text-sm font-semibold text-text-primary hover:bg-surface-muted" to="/development-plans/new">
        Generate with AI assistance
      </Link>
    </div>
  );
}

function DevelopmentPlanIndexInspector({
  plan,
  planRow,
}: {
  plan: ReturnType<typeof developmentPlanWorkspaceViewModel>['selectedPlan'];
  planRow: DevelopmentPlanListRow | undefined;
}) {
  if (plan === undefined) {
    return (
      <PreviewPane aria-label="Selected Development Plan preview" meta="No Development Plan selected" title="Selected Development Plan preview">
        <EmptyState title="Select or create a Development Plan." />
      </PreviewPane>
    );
  }

  const selectedItem = plan.selectedPlanItem;
  return (
    <PreviewPane
      actions={
        <Link className="inline-flex min-h-10 items-center justify-center rounded-md border border-primary bg-primary px-4 text-sm font-semibold text-white" to={`/development-plans/${encodeURIComponent(plan.id)}`}>
          Open Development Plan
        </Link>
      }
      aria-label="Selected Development Plan preview"
      meta={`${plan.itemCount} ${pluralize(plan.itemCount, 'Plan Item')} · ${plan.blockedCount} blocked`}
      title="Selected Development Plan preview"
    >
      <div className="grid gap-4">
        <div className="grid gap-1">
          <h2 className="text-base font-semibold text-text-primary">{plan.title}</h2>
          <p className="m-0 text-sm text-text-secondary">Typed refs: {plan.typedRefs.join(', ')}</p>
          <p className="m-0 text-sm font-semibold text-text-primary">Next action: {plan.nextAction}</p>
        </div>
        <CompactMetadata
          items={[
            { label: 'Status', value: formatValue(plan.status) },
            { label: 'Risk', value: plan.risk },
            { label: 'Gate distribution', value: plan.gateDistribution },
            { label: 'Drivers', value: plan.actors.drivers.join(', ') || 'Unassigned' },
            { label: 'Reviewers', value: plan.actors.reviewers.join(', ') || 'Unassigned' },
            { label: 'Responsible roles', value: plan.actors.responsibleRoles.join(', ') || 'Unassigned' },
            { label: 'Updated', value: formatDate(planRow?.updated_at) },
          ]}
        />
        <Section title="Selected Plan Item" variant="subtle">
          <div className="grid gap-2 text-sm">
            <p className="m-0 font-semibold text-text-primary">{selectedItem.title}</p>
            <p className="m-0 text-text-secondary">{selectedItem.summary}</p>
            <p className="m-0 text-text-primary">Current gate: {selectedItem.currentGate}</p>
            <p className="m-0 text-text-primary">Blocker: {selectedItem.blocker}</p>
          </div>
        </Section>
      </div>
    </PreviewPane>
  );
}

function DevelopmentPlanIndexToolbar({
  filters,
  onFiltersChange,
  rows,
}: {
  filters: DevelopmentPlanFilterState;
  onFiltersChange: (filters: DevelopmentPlanFilterState) => void;
  rows: DevelopmentPlanListRow[];
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-end gap-2 pb-1 lg:flex-nowrap lg:overflow-x-auto">
      <DevelopmentPlanFilters filters={filters} rows={rows} onFiltersChange={onFiltersChange} />
    </div>
  );
}

function DevelopmentPlanFilters({
  filters,
  onFiltersChange,
  rows,
}: {
  filters: DevelopmentPlanFilterState;
  onFiltersChange: (filters: DevelopmentPlanFilterState) => void;
  rows: DevelopmentPlanListRow[];
}) {
  const updateFilter = (key: keyof DevelopmentPlanFilterState, value: string) => onFiltersChange({ ...filters, [key]: value });

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary lg:flex-nowrap">
      <FilterSelect label="Source type" options={sourceTypeOptions} value={filters.sourceType} onChange={(value) => updateFilter('sourceType', value)} />
      <FilterSelect label="Role" options={roleOptions} value={filters.role} onChange={(value) => updateFilter('role', value)} />
      <FilterSelect label="Driver" options={optionsFromValues(rows.flatMap((row) => row.driver_actor_ids ?? [row.driver_actor_id]).filter(nonEmpty), 'All drivers')} value={filters.driver} onChange={(value) => updateFilter('driver', value)} />
      <FilterSelect label="Reviewer" options={optionsFromValues(rows.flatMap((row) => row.reviewer_actor_ids ?? [row.reviewer_actor_id]).filter(nonEmpty), 'All reviewers')} value={filters.reviewer} onChange={(value) => updateFilter('reviewer', value)} />
      <FilterSelect label="Gate" options={gateOptions} value={filters.gate} onChange={(value) => updateFilter('gate', value)} />
      <FilterSelect label="Risk" options={riskOptions} value={filters.risk} onChange={(value) => updateFilter('risk', value)} />
      <FilterSelect label="Release impact" options={releaseImpactOptions} value={filters.releaseImpact} onChange={(value) => updateFilter('releaseImpact', value)} />
      <FilterSelect label="Status" options={statusOptions} value={filters.status} onChange={(value) => updateFilter('status', value)} />
    </div>
  );
}

function FilterSelect({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: Array<{ label: string; value: string }>; value: string }) {
  return (
    <label className="grid min-w-32 gap-1">
      <span>{label}</span>
      <Select aria-label={label} className="min-h-9 text-xs" options={options} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
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
    header: 'Typed refs',
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
  { key: 'items', header: 'Plan Items', cell: (row) => `${row.item_count ?? row.items?.length ?? 0} ${pluralize(row.item_count ?? row.items?.length ?? 0, 'Plan Item')}` },
  { key: 'role', header: 'Responsible roles', cell: (row) => formatValues(row.responsible_roles, row.responsible_role, 'mixed') },
  { key: 'gate', header: 'Gate distribution', cell: (row) => formatValues(row.gate_states, row.gate_state, 'boundary') },
  { key: 'risk', header: 'Risk', cell: (row) => <Badge tone={riskTone(row.risk)}>{formatValue(row.risk ?? 'medium')}</Badge> },
  { key: 'status', header: 'Status', cell: (row) => <StatusPill tone={planStatusTone(row.status)}>{formatValue(row.status)}</StatusPill> },
  { key: 'blocked', header: 'Blocked', cell: (row) => <Badge tone={row.blocked_count ? 'warning' : 'success'}>{row.blocked_count ?? 0}</Badge> },
  { key: 'updated', header: 'Updated', cell: (row) => formatDate(row.updated_at) },
];

function rowMatchesFilters(row: DevelopmentPlanListRow, filters: DevelopmentPlanFilterState): boolean {
  return (
    (filters.sourceType === 'all' || (row.source_refs?.some((ref) => ref.type === filters.sourceType) ?? false)) &&
    matchesProjectionFilter(row.responsible_roles, row.responsible_role, filters.role) &&
    matchesProjectionFilter(row.driver_actor_ids, row.driver_actor_id, filters.driver) &&
    matchesProjectionFilter(row.reviewer_actor_ids, row.reviewer_actor_id, filters.reviewer) &&
    matchesProjectionFilter(row.gate_states, row.gate_state, filters.gate) &&
    matchesProjectionFilter(row.risks, row.risk, filters.risk) &&
    matchesProjectionFilter(row.release_impacts, row.release_impact, filters.releaseImpact) &&
    (filters.status === 'all' || row.status === filters.status)
  );
}

function validateAuthoring(input: { sourceId: string; sourceObjectCount: number; sourceObjectsError: boolean; sourceObjectsLoading: boolean; title: string }) {
  const messages = [
    input.title.trim().length > 0 ? 'Title is ready.' : 'Title can be added now or inferred from source context.',
    sourceObjectSelectionMessage(input),
    'Plan Items remain the boundary for Spec, Execution Plan, execution, review, QA, and release readiness.',
  ];

  return {
    hasBlockingIssue: input.sourceObjectsLoading || input.sourceObjectsError || input.sourceObjectCount === 0 || input.sourceId.trim().length === 0,
    messages,
  };
}

function sourceObjectSelectionMessage(input: { sourceId: string; sourceObjectCount: number; sourceObjectsError: boolean; sourceObjectsLoading: boolean }) {
  if (input.sourceObjectsLoading) return 'Typed refs are loading from live project data.';
  if (input.sourceObjectsError) return 'Typed ref list failed to load.';
  if (input.sourceObjectCount === 0) return 'Create a typed ref before authoring a Development Plan.';
  return input.sourceId.trim().length > 0 ? 'Source object is selected.' : 'Source object selection is required.';
}

function sourceObjectOptions(sourceType: SourceObjectType, optionsByType: Record<SourceObjectType, SourceObjectOption[]>) {
  return optionsByType[sourceType] ?? [];
}

function sourceOptionsFromItems(items: readonly SourceObjectListItem[] | undefined, sourceType: SourceObjectType): SourceObjectOption[] {
  return (items ?? []).flatMap((item) => {
    const id = item.ref?.id ?? item.id;
    if (id === undefined || id.trim().length === 0) return [];
    return [{ label: item.title ?? item.ref?.title ?? `${formatValue(sourceType)} ${id}`, value: id }];
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

function planStatusTone(status: string | undefined): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
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

function optionsFromValues(values: string[], allLabel: string): Array<{ label: string; value: string }> {
  return [{ label: allLabel, value: 'all' }, ...[...new Set(values)].map((value) => ({ label: value, value }))];
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
