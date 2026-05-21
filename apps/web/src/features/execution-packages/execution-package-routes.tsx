import { useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import {
  useCreateExecutionPackageMutation,
  useExecutionPackageReplayQuery,
  useForceRerunPackageMutation,
  useGeneratePackagesMutation,
  useMarkPackageReadyMutation,
  usePackageQuery,
  usePackagesQuery,
  usePatchExecutionPackageMutation,
  useRerunPackageMutation,
  useRunPackageMutation,
} from '../../shared/api/hooks';
import type {
  ArtifactKind,
  CreateExecutionPackageBody,
  ExecutionPackage,
  PatchExecutionPackageBody,
  ProductListItem,
  RequiredCheck,
  TimelineEntry,
} from '../../shared/api/types';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { ActionRail, DetailLayout, PageHeader, Section } from '../../shared/layout';
import { Badge, Button, Checkbox, DataTable, Input, StatusPill, Tabs, Textarea, Timeline, type TimelineItem } from '../../shared/ui';

const supportedPackageFilters = [
  'work_item_id',
  'plan_revision_id',
  'owner_actor_id',
  'reviewer_actor_id',
  'qa_owner_actor_id',
  'phase',
  'status',
  'gate_state',
  'resolution',
  'blocked',
] as const;

type PackageFilters = Record<string, string | boolean | number>;

interface PackageFormState {
  repoId: string;
  objective: string;
  ownerActorId: string;
  reviewerActorId: string;
  qaOwnerActorId: string;
  checkId: string;
  checkName: string;
  checkCommand: string;
  checkTimeoutSeconds: string;
  checkBlocksReview: boolean;
  requiredArtifactKinds: string;
  allowedPaths: string;
  forbiddenPaths: string;
}

export function PackagesRegistry() {
  const { projectId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const filters = packageFiltersFromSearch(searchParams);
  const query = usePackagesQuery({
    project_id: projectId,
    ...filters,
    limit: typeof filters.limit === 'number' ? filters.limit : 100,
  });
  const items = query.data?.items ?? [];
  const unsupportedFilters = unsupportedPackageFilters(searchParams);
  const planRevisionId = searchParams.get('plan_revision_id')?.trim() || undefined;

  return (
    <>
      <PageHeader
        subtitle="Track execution packages by Work Item, ownership, lifecycle state, and blocking state."
        title="Packages"
      />
      {planRevisionId ? (
        <Section
          description="Create execution-ready packages from the selected plan version."
          title="Plan package actions"
        >
          <PlanRevisionPackageActions planRevisionId={planRevisionId} />
        </Section>
      ) : null}
      <Section
        description="Server-side filters are sent for project, work item, plan version, owner, reviewer, QA owner, phase, status, gate state, resolution, and blocked status."
        title="Execution package registry"
      >
        <RegistryState isError={query.isError} isPending={query.status === 'pending'} kind="packages" />
        <FilterSummary filters={filters} unsupportedFilters={unsupportedFilters} />
        {query.status !== 'pending' && !query.isError ? (
          <>
            <DegradedNotice degradedSources={query.data?.degraded_sources ?? []} />
            <PackageTable items={items} />
          </>
        ) : null}
      </Section>
    </>
  );
}

export function PackageDetail() {
  const { packageId } = useParams();

  if (!packageId) {
    return <InvalidDetail title="Package" message="This package route is missing a package id." />;
  }

  return <PackageDetailView packageId={packageId} />;
}

function PackageDetailView({ packageId }: { packageId: string }) {
  const { actorId } = useActorContext();
  const [searchParams] = useSearchParams();
  const detailQuery = usePackageQuery(packageId);
  const replayQuery = useExecutionPackageReplayQuery(packageId);
  const markReady = useMarkPackageReadyMutation(packageId);
  const runPackage = useRunPackageMutation(packageId);
  const rerunPackage = useRerunPackageMutation(packageId);
  const forceRerunPackage = useForceRerunPackageMutation(packageId);
  const [forceReason, setForceReason] = useState('');
  const [showEditPackage, setShowEditPackage] = useState(false);
  const planRevisionId = searchParams.get('plan_revision_id')?.trim() || detailQuery.data?.plan_revision_id;

  if (detailQuery.status === 'pending') {
    return <LoadingDetail title="Package" />;
  }

  if (detailQuery.isError || detailQuery.data === undefined) {
    return <InvalidDetail title="Package" message="Execution package data is temporarily unavailable." />;
  }

  const executionPackage = detailQuery.data;
  const actionPending = markReady.isPending || runPackage.isPending || rerunPackage.isPending || forceRerunPackage.isPending;
  const previousRunSessionId = executionPackage.last_run_session_id;
  const canForceRerun = previousRunSessionId !== undefined && forceReason.trim().length > 0;

  return (
    <DetailLayout
      actionRail={
        <ActionRail title="Package actions">
          <div className="stack-form compact">
            <Button
              disabled={actionPending}
              loading={markReady.isPending}
              onClick={() =>
                markReady.mutate({
                  actor_id: actorId,
                  expected_package_version: executionPackage.version,
                })
              }
              variant="primary"
            >
              Mark ready
            </Button>
            <Button
              disabled={actionPending}
              loading={runPackage.isPending}
              onClick={() => runPackage.mutate({ actorId })}
              variant="primary"
            >
              Run
            </Button>
            <Button
              disabled={actionPending || !executionPackage.last_run_session_id}
              loading={rerunPackage.isPending}
              onClick={() =>
                rerunPackage.mutate({
                  actorId,
                  ...(executionPackage.last_run_session_id === undefined
                    ? {}
                    : { previousRunSessionId: executionPackage.last_run_session_id }),
                })
              }
              variant="secondary"
            >
              Rerun
            </Button>
            <label className="field">
              Force rerun reason
              <Textarea
                onChange={(event) => setForceReason(event.currentTarget.value)}
                placeholder="Required for force rerun governance"
                rows={4}
                value={forceReason}
              />
            </label>
            <p className="empty">
              {previousRunSessionId === undefined
                ? 'Force rerun is available after this package has a previous run.'
                : 'Force rerun bypasses normal freshness checks and must include a reason for the evidence trail.'}
            </p>
            <Button
              disabled={actionPending || !canForceRerun}
              loading={forceRerunPackage.isPending}
              onClick={() => {
                if (previousRunSessionId === undefined) return;
                forceRerunPackage.mutate({
                  actorId,
                  reason: forceReason.trim(),
                  previousRunSessionId,
                });
              }}
              variant="danger"
            >
              Force rerun
            </Button>
            <Button onClick={() => setShowEditPackage((current) => !current)} variant="secondary">
              Edit package details
            </Button>
            {showEditPackage ? <PackageEditForm executionPackage={executionPackage} onSaved={() => setShowEditPackage(false)} /> : null}
          </div>
          {planRevisionId ? (
            <div className="stack-form compact">
              <h3>Plan package actions</h3>
              <PlanRevisionPackageActions planRevisionId={planRevisionId} />
            </div>
          ) : null}
        </ActionRail>
      }
      header={
        <PageHeader
          actions={
            <Link className="fl-button fl-button--secondary" to={`/work-items/${encodeURIComponent(executionPackage.work_item_id)}`}>
              Open Work Item
            </Link>
          }
          eyebrow={
            <span className="fl-inline-actions">
              <span>Package</span>
              <StatusPill tone={deliverySurfaceStateTone(executionPackage.phase)}>{executionPackage.phase}</StatusPill>
              <StatusPill tone={deliverySurfaceStateTone(executionPackage.gate_state)}>{executionPackage.gate_state}</StatusPill>
            </span>
          }
          subtitle={`Repository ${executionPackage.repo_id} / Work Item ${executionPackage.work_item_id}`}
          title={executionPackage.objective}
        />
      }
    >
      <Tabs
        items={[
          {
            content: <PackageOverview executionPackage={executionPackage} />,
            label: 'Overview',
            value: 'overview',
          },
          {
            content: <PackageRuns executionPackage={executionPackage} />,
            label: 'Runs',
            value: 'runs',
          },
          {
            content: <PackageReview executionPackage={executionPackage} />,
            label: 'Review',
            value: 'review',
          },
          {
            content: <PackageArtifacts executionPackage={executionPackage} />,
            label: 'Artifacts',
            value: 'artifacts',
          },
          {
            content: (
              <PackageTimeline
                isError={replayQuery.isError}
                isPending={replayQuery.status === 'pending'}
                timeline={replayQuery.data ?? []}
              />
            ),
            label: 'Timeline',
            value: 'timeline',
          },
          {
            content: <PackagePolicy executionPackage={executionPackage} />,
            label: 'Policy',
            value: 'policy',
          },
        ]}
      />
    </DetailLayout>
  );
}

function PlanRevisionPackageActions({ planRevisionId }: { planRevisionId: string }) {
  const generatePackages = useGeneratePackagesMutation(planRevisionId);
  const [showCreatePackage, setShowCreatePackage] = useState(false);

  return (
    <div className="stack-form compact">
      <div className="fl-inline-actions">
        <Button
          disabled={generatePackages.isPending}
          loading={generatePackages.isPending}
          onClick={() => generatePackages.mutate()}
          variant="primary"
        >
          Generate packages
        </Button>
        <Button onClick={() => setShowCreatePackage((current) => !current)} variant="secondary">
          Create package
        </Button>
      </div>
      {generatePackages.isError ? <p className="empty">Package generation is temporarily unavailable.</p> : null}
      {showCreatePackage ? <PackageCreateForm onCreated={() => setShowCreatePackage(false)} planRevisionId={planRevisionId} /> : null}
    </div>
  );
}

function PackageCreateForm({ onCreated, planRevisionId }: { onCreated: () => void; planRevisionId: string }) {
  const createPackage = useCreateExecutionPackageMutation(planRevisionId);
  const [form, setForm] = useState<PackageFormState>(() => emptyPackageForm());
  const canSubmit = isPackageFormReady(form, true);

  function update<K extends keyof PackageFormState>(key: K, value: PackageFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    createPackage.mutate(createExecutionPackageBodyFromForm(form), {
      onSuccess: () => {
        setForm(emptyPackageForm());
        onCreated();
      },
    });
  }

  return (
    <form className="stack-form compact" onSubmit={onSubmit}>
      <label className="field">
        Repository
        <Input onChange={(event) => update('repoId', event.currentTarget.value)} value={form.repoId} />
      </label>
      <PackageEditableFields form={form} onUpdate={update} />
      {createPackage.isError ? <p className="empty">Package creation is temporarily unavailable.</p> : null}
      <Button disabled={!canSubmit} loading={createPackage.isPending} type="submit" variant="primary">
        Create execution package
      </Button>
    </form>
  );
}

function PackageEditForm({ executionPackage, onSaved }: { executionPackage: ExecutionPackage; onSaved: () => void }) {
  const patchPackage = usePatchExecutionPackageMutation(executionPackage.id);
  const [form, setForm] = useState<PackageFormState>(() => packageFormFromPackage(executionPackage));
  const canSubmit = isPackageFormReady(form, false);

  function update<K extends keyof PackageFormState>(key: K, value: PackageFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    patchPackage.mutate(patchExecutionPackageBodyFromForm(form, executionPackage.required_checks), {
      onSuccess: onSaved,
    });
  }

  return (
    <form className="stack-form compact" onSubmit={onSubmit}>
      <PackageEditableFields form={form} onUpdate={update} />
      {patchPackage.isError ? <p className="empty">Package details are temporarily unavailable for editing.</p> : null}
      <Button disabled={!canSubmit} loading={patchPackage.isPending} type="submit" variant="primary">
        Save package details
      </Button>
    </form>
  );
}

function PackageEditableFields({
  form,
  onUpdate,
}: {
  form: PackageFormState;
  onUpdate: <K extends keyof PackageFormState>(key: K, value: PackageFormState[K]) => void;
}) {
  return (
    <>
      <label className="field">
        Objective
        <Textarea onChange={(event) => onUpdate('objective', event.currentTarget.value)} rows={3} value={form.objective} />
      </label>
      <label className="field">
        Owner
        <Input onChange={(event) => onUpdate('ownerActorId', event.currentTarget.value)} value={form.ownerActorId} />
      </label>
      <label className="field">
        Reviewer
        <Input onChange={(event) => onUpdate('reviewerActorId', event.currentTarget.value)} value={form.reviewerActorId} />
      </label>
      <label className="field">
        QA owner
        <Input onChange={(event) => onUpdate('qaOwnerActorId', event.currentTarget.value)} value={form.qaOwnerActorId} />
      </label>
      <label className="field">
        Check id
        <Input onChange={(event) => onUpdate('checkId', event.currentTarget.value)} value={form.checkId} />
      </label>
      <label className="field">
        Check name
        <Input onChange={(event) => onUpdate('checkName', event.currentTarget.value)} value={form.checkName} />
      </label>
      <label className="field">
        Check command
        <Input onChange={(event) => onUpdate('checkCommand', event.currentTarget.value)} value={form.checkCommand} />
      </label>
      <label className="field">
        Timeout seconds
        <Input
          min={1}
          onChange={(event) => onUpdate('checkTimeoutSeconds', event.currentTarget.value)}
          type="number"
          value={form.checkTimeoutSeconds}
        />
      </label>
      <Checkbox
        checked={form.checkBlocksReview}
        label="Required before review"
        onChange={(event) => onUpdate('checkBlocksReview', event.currentTarget.checked)}
      />
      <label className="field">
        Required artifacts
        <Textarea
          onChange={(event) => onUpdate('requiredArtifactKinds', event.currentTarget.value)}
          placeholder="One artifact kind per line"
          rows={3}
          value={form.requiredArtifactKinds}
        />
      </label>
      <label className="field">
        Allowed paths
        <Textarea
          onChange={(event) => onUpdate('allowedPaths', event.currentTarget.value)}
          placeholder="One path pattern per line"
          rows={3}
          value={form.allowedPaths}
        />
      </label>
      <label className="field">
        Forbidden paths
        <Textarea
          onChange={(event) => onUpdate('forbiddenPaths', event.currentTarget.value)}
          placeholder="One path pattern per line"
          rows={3}
          value={form.forbiddenPaths}
        />
      </label>
    </>
  );
}

function PackageTable({ items }: { items: ProductListItem[] }) {
  return (
    <DataTable
      columns={[
        {
          key: 'objective',
          header: 'Objective',
          cell: (item) => (
            <div className="stack-form compact">
              <strong>{item.title}</strong>
              <Link to={`/packages/${encodeURIComponent(item.object.id)}`}>Open package</Link>
            </div>
          ),
        },
        { key: 'work-item', header: 'Work Item', cell: (item) => item.parent?.title ?? item.parent?.id ?? 'unknown' },
        { key: 'surface', header: 'Surface', cell: (item) => item.package_state?.surface_type ?? 'unspecified' },
        { key: 'state', header: 'State', cell: (item) => <StatusPill>{item.phase ?? item.status ?? 'unknown'}</StatusPill> },
        {
          key: 'last-run',
          header: 'Last run',
          cell: (item) => {
            const runId = item.package_state?.last_run_session_id ?? item.related.find((ref) => ref.type === 'run_session')?.id;
            return runId ? <Link to={`/runs/${encodeURIComponent(runId)}`}>{runId}</Link> : 'none';
          },
        },
        { key: 'reviewer', header: 'Reviewer / QA', cell: (item) => `${item.reviewer_actor_id ?? 'unassigned'} / ${item.qa_owner_actor_id ?? 'unassigned'}` },
        { key: 'updated', header: 'Updated', cell: (item) => formatAge(item.updated_at) },
      ]}
      emptyMessage="No Execution Packages match the current filters."
      getRowKey={(item) => item.id}
      rows={items}
    />
  );
}

function PackageOverview({ executionPackage }: { executionPackage: ExecutionPackage }) {
  return (
    <Section description="Primary package state for execution owners, reviewers, and QA." title="Overview">
      <dl className="fl-metadata-grid">
        <Metadata label="Objective" value={executionPackage.objective} />
        <Metadata label="Repository" value={executionPackage.repo_id} />
        <Metadata label="Owner" value={executionPackage.owner_actor_id} />
        <Metadata label="Reviewer" value={executionPackage.reviewer_actor_id} />
        <Metadata label="QA owner" value={executionPackage.qa_owner_actor_id} />
        <Metadata label="Lifecycle state" value={`${executionPackage.phase} / ${executionPackage.gate_state}`} />
        <Metadata label="Blocked reason" value={executionPackage.blocked_reason ?? 'none'} />
        <Metadata label="Last failure" value={executionPackage.last_failure_summary ?? 'none'} />
      </dl>
    </Section>
  );
}

function PackageRuns({ executionPackage }: { executionPackage: ExecutionPackage }) {
  return (
    <Section title="Runs" description="Latest run context for this package.">
      {executionPackage.last_run_session_id ? (
        <Link className="fl-button fl-button--secondary" to={`/runs/${encodeURIComponent(executionPackage.last_run_session_id)}`}>
          Open latest run
        </Link>
      ) : (
        <p className="empty">No run has been recorded for this package.</p>
      )}
    </Section>
  );
}

function PackageReview({ executionPackage }: { executionPackage: ExecutionPackage }) {
  return (
    <Section title="Review" description="Review routing and handoff ownership.">
      <dl className="fl-metadata-grid">
        <Metadata label="Reviewer" value={executionPackage.reviewer_actor_id} />
        <Metadata label="QA owner" value={executionPackage.qa_owner_actor_id} />
        <Metadata label="Resolution" value={executionPackage.resolution} />
      </dl>
    </Section>
  );
}

function PackageArtifacts({ executionPackage }: { executionPackage: ExecutionPackage }) {
  return (
    <Section title="Artifacts" description="Required evidence expected from runs and review.">
      <PillList empty="No required artifact kinds" values={executionPackage.required_artifact_kinds} />
      <h3>Required checks</h3>
      <PillList
        empty="No required checks"
        values={executionPackage.required_checks.map((check) => `${check.display_name}: ${check.command}`)}
      />
    </Section>
  );
}

function PackageTimeline({
  isError,
  isPending,
  timeline,
}: {
  isError: boolean;
  isPending: boolean;
  timeline: TimelineEntry[];
}) {
  if (isPending) {
    return <Section title="Timeline"><p className="empty">Loading package history...</p></Section>;
  }

  if (isError) {
    return <Section title="Timeline"><p className="empty">Package history is temporarily unavailable.</p></Section>;
  }

  const items: TimelineItem[] = timeline.map((entry) => ({
    id: entry.id,
    title: entry.summary,
    description: packageTimelineLabel(entry),
    meta: formatDate(entry.created_at),
  }));

  return (
    <Section title="Timeline" description="Product history for this package.">
      {items.length ? <Timeline items={items} /> : <p className="empty">No package timeline events are available yet.</p>}
    </Section>
  );
}

function packageTimelineLabel(entry: TimelineEntry) {
  if (entry.object_type === 'execution_package') return 'Package update';
  if (entry.object_type === 'run_session') return 'Run update';
  if (entry.object_type === 'review_packet') return 'Review update';
  return 'History update';
}

function PackagePolicy({ executionPackage }: { executionPackage: ExecutionPackage }) {
  return (
    <Section title="Policy" description="Path policy and required package evidence.">
      <h3>Allowed paths</h3>
      <PillList empty="No allowed paths recorded" values={executionPackage.allowed_paths} />
      <h3>Forbidden paths</h3>
      <PillList empty="No forbidden paths recorded" values={executionPackage.forbidden_paths} />
      <h3>Required artifact kinds</h3>
      <PillList empty="No required artifact kinds" values={executionPackage.required_artifact_kinds} />
    </Section>
  );
}

function RegistryState({ isError, isPending, kind }: { isError: boolean; isPending: boolean; kind: string }) {
  if (isPending) return <p className="empty">Loading {kind}...</p>;
  if (isError) return <p className="empty">{kind} are temporarily unavailable.</p>;
  return null;
}

function FilterSummary({
  filters,
  unsupportedFilters,
}: {
  filters: PackageFilters;
  unsupportedFilters: string[];
}) {
  const entries = Object.entries(filters);
  if (entries.length === 0 && unsupportedFilters.length === 0) return null;

  return (
    <div className="stack-form compact">
      {entries.length ? (
        <div className="fl-inline-actions">
          {entries.map(([key, value]) => (
            <Badge key={key}>{key}: {String(value)}</Badge>
          ))}
        </div>
      ) : null}
      {unsupportedFilters.length ? (
        <p className="empty">
          {formatUnsupportedFilters(unsupportedFilters)} {unsupportedFilters.length === 1 ? 'is' : 'are'} not applied to the package inventory yet.
        </p>
      ) : null}
    </div>
  );
}

function DegradedNotice({ degradedSources }: { degradedSources: string[] }) {
  if (degradedSources.length === 0) return null;
  return <p className="empty">This package list is degraded: {degradedSources.join(', ')}.</p>;
}

function PillList({ empty, values }: { empty: string; values: string[] }) {
  return values.length ? (
    <div className="fl-inline-actions">
      {values.map((value) => <Badge key={value}>{value}</Badge>)}
    </div>
  ) : (
    <p className="empty">{empty}</p>
  );
}

function Metadata({ label, value }: { label: string; value: string | number | boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{String(value)}</dd>
    </div>
  );
}

function deliverySurfaceStateTone(value: string | undefined) {
  const normalized = value?.toLowerCase() ?? '';
  if (['approved', 'completed', 'passed', 'ready', 'resolved', 'succeeded'].includes(normalized)) return 'success';
  if (['blocked', 'cancelled', 'failed', 'rejected'].includes(normalized)) return 'danger';
  if (['open', 'pending', 'queued', 'running', 'submitted'].includes(normalized)) return 'warning';
  return 'info';
}

function LoadingDetail({ title }: { title: string }) {
  return (
    <DetailLayout header={<PageHeader subtitle="Loading data." title={title} />}>
      <Section title="Loading">
        <p className="empty">Loading {title.toLowerCase()}...</p>
      </Section>
    </DetailLayout>
  );
}

function InvalidDetail({ title, message }: { title: string; message: string }) {
  return (
    <DetailLayout header={<PageHeader subtitle={message} title={title} />}>
      <Section title="Unavailable">
        <p className="empty">{message}</p>
      </Section>
    </DetailLayout>
  );
}

function emptyPackageForm(): PackageFormState {
  return {
    repoId: '',
    objective: '',
    ownerActorId: '',
    reviewerActorId: '',
    qaOwnerActorId: '',
    checkId: '',
    checkName: '',
    checkCommand: '',
    checkTimeoutSeconds: '600',
    checkBlocksReview: true,
    requiredArtifactKinds: '',
    allowedPaths: '',
    forbiddenPaths: '',
  };
}

function packageFormFromPackage(executionPackage: ExecutionPackage): PackageFormState {
  const firstCheck = executionPackage.required_checks[0];
  return {
    repoId: executionPackage.repo_id,
    objective: executionPackage.objective,
    ownerActorId: executionPackage.owner_actor_id,
    reviewerActorId: executionPackage.reviewer_actor_id,
    qaOwnerActorId: executionPackage.qa_owner_actor_id,
    checkId: firstCheck?.check_id ?? '',
    checkName: firstCheck?.display_name ?? '',
    checkCommand: firstCheck?.command ?? '',
    checkTimeoutSeconds: String(firstCheck?.timeout_seconds ?? 600),
    checkBlocksReview: firstCheck?.blocks_review ?? true,
    requiredArtifactKinds: executionPackage.required_artifact_kinds.join('\n'),
    allowedPaths: executionPackage.allowed_paths.join('\n'),
    forbiddenPaths: executionPackage.forbidden_paths.join('\n'),
  };
}

function createExecutionPackageBodyFromForm(form: PackageFormState): CreateExecutionPackageBody {
  return {
    repo_id: form.repoId.trim(),
    objective: form.objective.trim(),
    owner_actor_id: form.ownerActorId.trim(),
    reviewer_actor_id: form.reviewerActorId.trim(),
    qa_owner_actor_id: form.qaOwnerActorId.trim(),
    required_checks: [requiredCheckFromForm(form)],
    required_artifact_kinds: splitLines(form.requiredArtifactKinds) as ArtifactKind[],
    allowed_paths: splitLines(form.allowedPaths),
    forbidden_paths: splitLines(form.forbiddenPaths),
  };
}

function patchExecutionPackageBodyFromForm(
  form: PackageFormState,
  existingRequiredChecks: RequiredCheck[],
): PatchExecutionPackageBody {
  const [, ...remainingRequiredChecks] = existingRequiredChecks;

  return {
    objective: form.objective.trim(),
    owner_actor_id: form.ownerActorId.trim(),
    reviewer_actor_id: form.reviewerActorId.trim(),
    qa_owner_actor_id: form.qaOwnerActorId.trim(),
    required_checks: [requiredCheckFromForm(form), ...remainingRequiredChecks],
    required_artifact_kinds: splitLines(form.requiredArtifactKinds) as ArtifactKind[],
    allowed_paths: splitLines(form.allowedPaths),
    forbidden_paths: splitLines(form.forbiddenPaths),
  };
}

function requiredCheckFromForm(form: PackageFormState): RequiredCheck {
  return {
    check_id: form.checkId.trim(),
    display_name: form.checkName.trim(),
    command: form.checkCommand.trim(),
    timeout_seconds: Number.parseInt(form.checkTimeoutSeconds, 10),
    blocks_review: form.checkBlocksReview,
  };
}

function isPackageFormReady(form: PackageFormState, includeRepo: boolean) {
  const timeoutSeconds = Number.parseInt(form.checkTimeoutSeconds, 10);
  return (
    (!includeRepo || form.repoId.trim().length > 0) &&
    form.objective.trim().length > 0 &&
    form.ownerActorId.trim().length > 0 &&
    form.reviewerActorId.trim().length > 0 &&
    form.qaOwnerActorId.trim().length > 0 &&
    form.checkId.trim().length > 0 &&
    form.checkName.trim().length > 0 &&
    form.checkCommand.trim().length > 0 &&
    Number.isInteger(timeoutSeconds) &&
    timeoutSeconds > 0 &&
    splitLines(form.requiredArtifactKinds).length > 0
  );
}

function splitLines(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function packageFiltersFromSearch(searchParams: URLSearchParams) {
  const filters: PackageFilters = {};
  for (const key of supportedPackageFilters) {
    const value = searchParams.get(key)?.trim();
    if (!value) continue;
    if (key === 'blocked') {
      if (isStrictBooleanFilter(value)) {
        filters[key] = value === 'true';
      }
      continue;
    }
    filters[key] = value;
  }
  const cursor = searchParams.get('cursor')?.trim();
  if (cursor) {
    filters.cursor = cursor;
  }
  const limit = searchParams.get('limit')?.trim();
  if (limit && isSupportedLimitFilter(limit)) {
    filters.limit = Number.parseInt(limit, 10);
  }
  return filters;
}

function unsupportedPackageFilters(searchParams: URLSearchParams) {
  const allowed = new Set<string>([...supportedPackageFilters, 'project_id', 'cursor', 'limit']);
  const unsupported = new Set([...searchParams.keys()].filter((key) => !allowed.has(key)));
  const blocked = searchParams.get('blocked')?.trim();
  if (blocked && !isStrictBooleanFilter(blocked)) {
    unsupported.add('blocked');
  }
  const limit = searchParams.get('limit')?.trim();
  if (limit && !isSupportedLimitFilter(limit)) {
    unsupported.add('limit');
  }
  return [...unsupported];
}

function isStrictBooleanFilter(value: string) {
  return value === 'true' || value === 'false';
}

function isSupportedLimitFilter(value: string) {
  if (!/^\d+$/.test(value)) return false;
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 && parsed <= 100;
}

function formatUnsupportedFilters(filters: string[]) {
  if (filters.length <= 1) return filters[0] ?? 'Unsupported filters';
  if (filters.length === 2) return `${filters[0]} and ${filters[1]}`;
  return `${filters.slice(0, -1).join(', ')}, and ${filters[filters.length - 1]}`;
}

function formatAge(value?: string) {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDate(value?: string) {
  if (!value) return 'unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
