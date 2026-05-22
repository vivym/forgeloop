import { Link, useParams, useSearchParams } from 'react-router';
import type { ReactNode } from 'react';

import {
  usePlanQuery,
  usePlanReplayQuery,
  usePlanRevisionQuery,
  usePlanRevisionsQuery,
  usePlansQuery,
  useSpecQuery,
  useSpecReplayQuery,
  useSpecRevisionQuery,
  useSpecRevisionsQuery,
  useSpecsQuery,
} from '../../shared/api/hooks';
import type { PlanRevision, ProductListItem, SpecPlan, SpecRevision, TimelineEntry } from '../../shared/api/types';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { ActionRail, DetailLayout, InlineActions, Metric, MetricGrid, PageHeader, Section } from '../../shared/layout';
import { Badge, Button, DataTable, InlineNotice, StatusPill, Timeline, type TimelineItem } from '../../shared/ui';
import { SpecPlanLifecycleActions } from './spec-plan-lifecycle-actions';

type ArtifactKind = 'spec' | 'plan';

const primaryLinkClass =
  'inline-flex min-h-10 items-center justify-center rounded-md border border-primary bg-primary px-4 text-sm font-semibold text-white transition-colors duration-base ease-standard hover:bg-primary-hover';
const selectedSegmentClass =
  'inline-flex min-h-9 items-center justify-center rounded-md border border-primary bg-primary px-3 text-sm font-semibold text-white transition-colors duration-base ease-standard';
const unselectedSegmentClass =
  'inline-flex min-h-9 items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-semibold text-text-primary transition-colors duration-base ease-standard hover:border-border-strong hover:bg-surface-muted';

interface RegistryFilters {
  status?: string;
}

export function SpecsRegistry() {
  const { projectId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const filters = parseRegistryFilters(searchParams);
  const query = useSpecsQuery({ project_id: projectId, ...filters, limit: 100 });
  const list = normalizeProductList(query.data);
  const specs = filterArtifacts(list.items, filters);

  return (
    <>
      <PageHeader
        actions={
          <Link className={primaryLinkClass} to="/work-items">
            Create from Work Item
          </Link>
        }
        subtitle="Find specification records across active Work Items and review their current planning state."
        title="Specs"
      />
      <RegistryFiltersBar basePath="/specs" selectedStatus={filters.status} />
      <Section
        description="Rows open the direct Spec route. New Specs still start from Work Item context."
        title="Spec registry"
      >
        <RegistryState isError={query.isError} isPending={query.status === 'pending'} kind="Spec" />
        {query.status !== 'pending' && !query.isError ? (
          <>
            <DegradedNotice hasDegradedSources={list.degradedSources.length > 0} />
            <ArtifactTable artifacts={specs} basePath="/specs" emptyMessage="No Specs match the current product filters." />
          </>
        ) : null}
      </Section>
    </>
  );
}

export function PlansRegistry() {
  const { projectId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const filters = parseRegistryFilters(searchParams);
  const query = usePlansQuery({ project_id: projectId, ...filters, limit: 100 });
  const list = normalizeProductList(query.data);
  const plans = filterArtifacts(list.items, filters);

  return (
    <>
      <PageHeader
        actions={
          <Link className={primaryLinkClass} to="/work-items">
            Create from Work Item
          </Link>
        }
        subtitle="Review implementation plans by delivery state and open their current revision."
        title="Plans"
      />
      <RegistryFiltersBar basePath="/plans" selectedStatus={filters.status} />
      <Section
        description="Rows open the direct Plan route. New Plans still start from Work Item context after a Spec exists."
        title="Plan registry"
      >
        <RegistryState isError={query.isError} isPending={query.status === 'pending'} kind="Plan" />
        {query.status !== 'pending' && !query.isError ? (
          <>
            <DegradedNotice hasDegradedSources={list.degradedSources.length > 0} />
            <ArtifactTable artifacts={plans} basePath="/plans" emptyMessage="No Plans match the current product filters." />
          </>
        ) : null}
      </Section>
    </>
  );
}

export function SpecDetail() {
  const { specId } = useParams();

  if (specId === undefined) {
    return <InvalidRoute title="Spec" message="This Spec route is missing a Spec." />;
  }

  return <SpecArtifactDetail artifactId={specId} />;
}

export function PlanDetail() {
  const { planId } = useParams();

  if (planId === undefined) {
    return <InvalidRoute title="Plan" message="This Plan route is missing a Plan." />;
  }

  return <PlanArtifactDetail artifactId={planId} />;
}

export function SpecRevisionDetail() {
  const { revisionId, specId } = useParams();

  if (specId === undefined || revisionId === undefined) {
    return <InvalidRoute title="Spec Revision" message="This Spec revision route is missing route context." />;
  }

  return <SpecRevisionReadOnly specId={specId} revisionId={revisionId} />;
}

export function PlanRevisionDetail() {
  const { planId, revisionId } = useParams();

  if (planId === undefined || revisionId === undefined) {
    return <InvalidRoute title="Plan Revision" message="This Plan revision route is missing route context." />;
  }

  return <PlanRevisionReadOnly planId={planId} revisionId={revisionId} />;
}

function SpecArtifactDetail({ artifactId }: { artifactId: string }) {
  const detailQuery = useSpecQuery(artifactId);
  const revisionsQuery = useSpecRevisionsQuery(artifactId);
  const replayQuery = useSpecReplayQuery(artifactId);

  return (
    <ArtifactDetailView
      artifact={detailQuery.data}
      artifactId={artifactId}
      detailIsError={detailQuery.isError}
      detailStatus={detailQuery.status}
      kind="spec"
      replay={replayQuery.data}
      replayIsError={replayQuery.isError}
      replayStatus={replayQuery.status}
      revisions={revisionsQuery.data}
      revisionsIsError={revisionsQuery.isError}
      revisionsStatus={revisionsQuery.status}
    />
  );
}

function PlanArtifactDetail({ artifactId }: { artifactId: string }) {
  const detailQuery = usePlanQuery(artifactId);
  const revisionsQuery = usePlanRevisionsQuery(artifactId);
  const replayQuery = usePlanReplayQuery(artifactId);

  return (
    <ArtifactDetailView
      artifact={detailQuery.data}
      artifactId={artifactId}
      detailIsError={detailQuery.isError}
      detailStatus={detailQuery.status}
      kind="plan"
      replay={replayQuery.data}
      replayIsError={replayQuery.isError}
      replayStatus={replayQuery.status}
      revisions={revisionsQuery.data}
      revisionsIsError={revisionsQuery.isError}
      revisionsStatus={revisionsQuery.status}
    />
  );
}

function ArtifactDetailView({
  artifact,
  artifactId,
  detailIsError,
  detailStatus,
  kind,
  replay,
  replayIsError,
  replayStatus,
  revisions,
  revisionsIsError,
  revisionsStatus,
}: {
  artifact: SpecPlan | undefined;
  artifactId: string;
  detailIsError: boolean;
  detailStatus: 'pending' | 'error' | 'success';
  kind: ArtifactKind;
  replay: TimelineEntry[] | undefined;
  replayIsError: boolean;
  replayStatus: 'pending' | 'error' | 'success';
  revisions: Array<SpecRevision | PlanRevision> | undefined;
  revisionsIsError: boolean;
  revisionsStatus: 'pending' | 'error' | 'success';
}) {
  const { actorId } = useActorContext();
  const artifactName = kind === 'spec' ? 'Spec' : 'Plan';
  const revisionBasePath = kind === 'spec' ? `/specs/${encodeURIComponent(artifactId)}` : `/plans/${encodeURIComponent(artifactId)}`;

  if (detailStatus === 'pending') {
    return <LoadingDetail title={artifactName} />;
  }

  if (detailIsError) {
    return (
      <DetailLayout header={<PageHeader subtitle={`${artifactName} detail could not be loaded.`} title={artifactName} />}>
        <Section title="Unavailable">
          <InlineNotice title={`${artifactName} data is temporarily unavailable.`} tone="danger" />
        </Section>
      </DetailLayout>
    );
  }

  if (artifact === undefined) {
    return (
      <DetailLayout header={<PageHeader subtitle={`No ${artifactName.toLowerCase()} was found for this route.`} title={artifactName} />}>
        <Section title="Empty">
          <InlineNotice title={`No ${artifactName} data is available.`} />
        </Section>
      </DetailLayout>
    );
  }

  const revisionList = revisions ?? [];
  const currentRevision = findCurrentRevision(revisionList, artifact.current_revision_id);

  return (
    <DetailLayout
      actionRail={
        <ActionRail title={`${artifactName} actions`}>
          <div className="grid gap-3">
            {artifact.current_revision_id ? (
              <Link
                className={primaryLinkClass}
                to={`${revisionBasePath}/revisions/${encodeURIComponent(artifact.current_revision_id)}`}
              >
                Open current revision
              </Link>
            ) : (
              <Button disabled variant="primary">
                Open current revision
              </Button>
            )}
            <SpecPlanLifecycleActions actorId={actorId} artifact={artifact} kind={kind} workItemId={artifact.work_item_id} />
            <InlineNotice title="Creation and edits start from the parent Work Item planning flow." tone="info" />
          </div>
        </ActionRail>
      }
      header={
        <PageHeader
          eyebrow={<StatusPill tone={statusTone(artifact.status)}>{formatValue(artifact.status)}</StatusPill>}
          subtitle={`${artifactName} planning state and direct revision history.`}
          title={`${artifactName} Detail`}
        />
      }
    >
      <Section title="Overview">
        <MetricGrid>
          <Metric label="Status" value={formatValue(artifact.status)} />
          <Metric label="Gate" value={formatValue(artifact.gate_state)} />
          <Metric label="Resolution" value={formatValue(artifact.resolution)} />
          <Metric label="Current revision" value={currentRevision ? revisionLabel(currentRevision) : artifact.current_revision_id ? 'Current revision' : 'Not created'} />
        </MetricGrid>
      </Section>
      <Section title="Parent context">
        <InlineActions>
          <Link to={`/work-items/${encodeURIComponent(artifact.work_item_id)}`}>Work Item</Link>
        </InlineActions>
      </Section>
      {kind === 'plan' ? <PlanPackageState plan={artifact} /> : null}
      <Section
        description="Direct route history uses product replay events. Revision state remains available separately when replay cannot be loaded."
        title="History / Timeline"
      >
        {replayStatus === 'pending' ? <InlineNotice title="Loading event timeline." tone="info" /> : null}
        {replayIsError ? (
          <>
            <InlineNotice title="History / Timeline replay is temporarily unavailable." tone="danger" />
            <InlineNotice title="Revision list remains available, but the full event timeline could not be loaded." tone="info" />
          </>
        ) : null}
        {replayStatus !== 'pending' && !replayIsError ? (
          replay?.length ? (
            <Timeline items={replayTimelineItems(replay, artifact.work_item_id)} />
          ) : (
            <InlineNotice title="No replay events are available for this direct route yet." />
          )
        ) : null}
        {revisionsStatus === 'pending' ? <InlineNotice title="Loading revision list." tone="info" /> : null}
        {revisionsIsError ? <InlineNotice title="Revision list is temporarily unavailable." tone="warning" /> : null}
        {revisionsStatus !== 'pending' && !revisionsIsError && revisionList.length ? <RevisionSummaryList revisions={revisionList} /> : null}
      </Section>
    </DetailLayout>
  );
}

function SpecRevisionReadOnly({ revisionId, specId }: { revisionId: string; specId: string }) {
  const revisionQuery = useSpecRevisionQuery(revisionId);
  const specQuery = useSpecQuery(specId);
  const revision = revisionQuery.data;

  if (revisionQuery.status === 'pending') {
    return <LoadingDetail title="Spec Revision" />;
  }

  if (revisionQuery.isError || revision === undefined || revision.spec_id !== specId) {
    return <RevisionUnavailable title="Spec Revision" />;
  }

  return (
    <ReadOnlyRevisionLayout
      artifactLink={`/specs/${encodeURIComponent(specId)}`}
      artifactLabel="Spec"
      meta={<RevisionMeta artifactStatus={specQuery.data?.status} createdAt={revision.created_at} revisionNumber={revision.revision_number} />}
      summary={revision.summary}
      title="Spec Revision"
      workItemId={revision.work_item_id}
    >
      <Section title="Document">
        <div className="grid gap-2 rounded-card border border-border bg-surface p-4">
          <p>{revision.content}</p>
        </div>
      </Section>
      <Section title="Background">
        <p>{revision.background}</p>
      </Section>
      <StructuredList items={revision.goals} title="Goals" />
      <StructuredList items={revision.scope_in} title="In scope" />
      <StructuredList items={revision.scope_out} title="Out of scope" />
      <StructuredList items={revision.acceptance_criteria} title="Acceptance criteria" />
      <StructuredList items={revision.risk_notes ?? []} title="Risk notes" />
      <Section title="Test strategy">
        <p>{revision.test_strategy_summary}</p>
      </Section>
    </ReadOnlyRevisionLayout>
  );
}

function PlanRevisionReadOnly({ planId, revisionId }: { planId: string; revisionId: string }) {
  const revisionQuery = usePlanRevisionQuery(revisionId);
  const planQuery = usePlanQuery(planId);
  const revision = revisionQuery.data;

  if (revisionQuery.status === 'pending') {
    return <LoadingDetail title="Plan Revision" />;
  }

  if (revisionQuery.isError || revision === undefined || revision.plan_id !== planId) {
    return <RevisionUnavailable title="Plan Revision" />;
  }

  return (
    <ReadOnlyRevisionLayout
      artifactLink={`/plans/${encodeURIComponent(planId)}`}
      artifactLabel="Plan"
      meta={<RevisionMeta artifactStatus={planQuery.data?.status} createdAt={revision.created_at} revisionNumber={revision.revision_number} />}
      summary={revision.summary}
      title="Plan Revision"
      workItemId={revision.work_item_id}
    >
      <Section title="Document">
        <div className="grid gap-2 rounded-card border border-border bg-surface p-4">
          <p>{revision.content}</p>
        </div>
      </Section>
      <Section title="Implementation summary">
        <p>{revision.implementation_summary}</p>
      </Section>
      <Section title="Split strategy">
        <p>{revision.split_strategy}</p>
      </Section>
      <StructuredList items={revision.dependency_order ?? []} title="Dependency order" />
      <StructuredList items={revision.test_matrix} title="Test matrix" />
      <StructuredList items={revision.risk_mitigations ?? []} title="Risk mitigations" />
      <Section title="Rollback notes">
        <p>{revision.rollback_notes}</p>
      </Section>
    </ReadOnlyRevisionLayout>
  );
}

function ReadOnlyRevisionLayout({
  artifactLabel,
  artifactLink,
  children,
  meta,
  summary,
  title,
  workItemId,
}: {
  artifactLabel: string;
  artifactLink: string;
  children: ReactNode;
  meta: ReactNode;
  summary: string;
  title: string;
  workItemId: string;
}) {
  return (
    <DetailLayout
      header={
        <PageHeader
          eyebrow={<Badge tone="info">Read-only revision</Badge>}
          subtitle={summary}
          title={title}
        />
      }
    >
      <Section title="Revision metadata">
        {meta}
        <InlineActions>
          <Link to={`/work-items/${encodeURIComponent(workItemId)}`}>Work Item</Link>
          <Link to={artifactLink}>{artifactLabel}</Link>
        </InlineActions>
      </Section>
      {children}
    </DetailLayout>
  );
}

function ArtifactTable({ artifacts, basePath, emptyMessage }: { artifacts: ProductListItem[]; basePath: '/specs' | '/plans'; emptyMessage: string }) {
  return (
    <DataTable
      columns={[
        {
          key: 'revision',
          header: 'Current revision',
          cell: (artifact) => (
            <Link to={`${basePath}/${encodeURIComponent(artifact.id)}`}>{revisionLabelFromArtifact(artifact)}</Link>
          ),
        },
        { key: 'status', header: 'Status', cell: (artifact) => <StatusPill tone={statusTone(artifact.status)}>{formatValue(artifact.status)}</StatusPill> },
        { key: 'gate', header: 'Gate', cell: (artifact) => formatValue(artifact.gate_state) },
        { key: 'resolution', header: 'Resolution', cell: (artifact) => formatValue(artifact.resolution) },
        {
          key: 'work-item',
          header: 'Parent',
          cell: (artifact) =>
            artifact.parent ? (
              <Link to={`/work-items/${encodeURIComponent(artifact.parent.id)}`}>{artifact.parent.title ?? 'Work Item'}</Link>
            ) : (
              'Not linked'
            ),
        },
      ]}
      emptyMessage={emptyMessage}
      getRowKey={(artifact) => artifact.id}
      rows={artifacts}
    />
  );
}

function RegistryFiltersBar({ basePath, selectedStatus }: { basePath: '/specs' | '/plans'; selectedStatus: string | undefined }) {
  const statuses = ['approved', 'draft', 'submitted'];

  return (
    <Section title="Filters">
      <InlineActions aria-label="Status filters">
        <Link className={selectedStatus === undefined ? selectedSegmentClass : unselectedSegmentClass} to={basePath}>
          All
        </Link>
        {statuses.map((status) => (
          <Link
            className={selectedStatus === status ? selectedSegmentClass : unselectedSegmentClass}
            key={status}
            to={`${basePath}?status=${encodeURIComponent(status)}`}
          >
            {formatValue(status)}
          </Link>
        ))}
      </InlineActions>
    </Section>
  );
}

function RegistryState({ isError, isPending, kind }: { isError: boolean; isPending: boolean; kind: string }) {
  if (isPending) {
    return <InlineNotice title={`Loading ${kind.toLowerCase()} registry.`} tone="info" />;
  }

  if (isError) {
    return <InlineNotice title={`${kind} registry data is temporarily unavailable.`} tone="danger" />;
  }

  return null;
}

function DegradedNotice({ hasDegradedSources }: { hasDegradedSources: boolean }) {
  if (!hasDegradedSources) {
    return null;
  }

  return (
    <InlineNotice
      title="Registry data is available, but History / Timeline detail may be incomplete until parent Work Item replay is available."
      tone="warning"
    />
  );
}

function PlanPackageState({ plan }: { plan: SpecPlan }) {
  if (plan.status !== 'approved') {
    return (
      <Section title="Downstream package">
        <InlineNotice title="Package generation becomes available after Plan approval." />
      </Section>
    );
  }

  if (plan.approved_revision_id === undefined) {
    return (
      <Section title="Downstream package">
        <InlineActions>
          <span>This approved Plan does not have an approved revision recorded yet.</span>
          <Link to="/packages">View package inventory</Link>
        </InlineActions>
        <InlineNotice title="Open the package inventory to find packages that may already exist for this work." tone="info" />
      </Section>
    );
  }

  return (
    <Section title="Downstream package">
      <InlineActions>
        <span>Package generation starts from the Packages workspace.</span>
        <Link to={`/packages?plan_revision_id=${encodeURIComponent(plan.approved_revision_id)}`}>View package readiness</Link>
      </InlineActions>
      <InlineNotice title="Package generation is ready for this approved Plan. Open package readiness to continue." tone="success" />
    </Section>
  );
}

function LoadingDetail({ title }: { title: string }) {
  return (
    <DetailLayout header={<PageHeader subtitle="Loading product context." title={title} />}>
      <Section title="Loading">
        <InlineNotice title={`Loading ${title.toLowerCase()}.`} tone="info" />
      </Section>
    </DetailLayout>
  );
}

function InvalidRoute({ message, title }: { message: string; title: string }) {
  return (
    <DetailLayout header={<PageHeader subtitle="Route context is required for this page." title={title} />}>
      <Section title="Invalid route">
        <InlineNotice title={message} />
      </Section>
    </DetailLayout>
  );
}

function RevisionUnavailable({ title }: { title: string }) {
  return (
    <DetailLayout header={<PageHeader subtitle="The revision could not be loaded." title={title} />}>
      <Section title="Unavailable">
        <InlineNotice title="Revision data is temporarily unavailable." tone="danger" />
      </Section>
    </DetailLayout>
  );
}

function RevisionMeta({
  artifactStatus,
  createdAt,
  revisionNumber,
}: {
  artifactStatus: string | undefined;
  createdAt: string | undefined;
  revisionNumber: number;
}) {
  return (
    <MetricGrid>
      <Metric label="Revision" value={`Revision ${revisionNumber}`} />
      <Metric label="Created" value={formatDate(createdAt)} />
      <Metric label="Artifact status" value={formatValue(artifactStatus)} />
    </MetricGrid>
  );
}

function StructuredList({ items, title }: { items: string[]; title: string }) {
  return (
    <Section title={title}>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <InlineNotice title={`No ${title.toLowerCase()} are recorded for this revision.`} />
      )}
    </Section>
  );
}

function parseRegistryFilters(searchParams: URLSearchParams): RegistryFilters {
  const status = searchParams.get('status')?.trim();
  return status ? { status } : {};
}

function filterArtifacts(artifacts: ProductListItem[], filters: RegistryFilters) {
  return artifacts.filter((artifact) => filters.status === undefined || artifact.status === filters.status);
}

function normalizeProductList(data: { items?: ProductListItem[]; degraded_sources?: unknown[] } | undefined) {
  return {
    degradedSources: data?.degraded_sources ?? [],
    items: data?.items ?? [],
  };
}

function findCurrentRevision<T extends SpecRevision | PlanRevision>(revisions: T[], revisionId: string | undefined) {
  if (revisionId === undefined) {
    return undefined;
  }

  return revisions.find((revision) => revision.id === revisionId);
}

function replayTimelineItems(events: TimelineEntry[], workItemId: string): TimelineItem[] {
  return events.map((event) => ({
    id: event.id,
    title: event.summary,
    description: eventTimelineDescription(event, workItemId),
    meta: formatDate(event.created_at),
  }));
}

function revisionLabel(revision: SpecRevision | PlanRevision) {
  return `Revision ${revision.revision_number}`;
}

function RevisionSummaryList({ revisions }: { revisions: Array<SpecRevision | PlanRevision> }) {
  return (
    <div className="grid gap-2 rounded-card border border-border bg-surface p-4">
      <strong>Revision list</strong>
      <ul>
        {revisions.map((revision) => (
          <li key={revision.id}>
            {revisionLabel(revision)}: {revision.summary}
          </li>
        ))}
      </ul>
    </div>
  );
}

function eventParentContext(event: TimelineEntry, workItemId: string) {
  const payloadWorkItemId = typeof event.payload?.work_item_id === 'string' ? event.payload.work_item_id : undefined;

  if ((event.object_type === 'work_item' && event.object_id === workItemId) || payloadWorkItemId === workItemId) {
    return 'Parent: Work Item';
  }

  return 'Parent context: Work Item linkage not recorded on this event';
}

function eventTimelineDescription(event: TimelineEntry, workItemId: string) {
  return [eventParentContext(event, workItemId), eventActorLabel(event)].filter(Boolean).join(' | ');
}

function eventActorLabel(event: TimelineEntry) {
  const actorId =
    eventActorValue(event, 'actor_id') ??
    eventActorValue(event, 'decided_by_actor_id') ??
    eventActorValue(event, 'created_by_actor_id') ??
    eventActorValue(event, 'updated_by_actor_id') ??
    eventActorValue(event, 'reviewed_by_actor_id') ??
    eventActorValue(event, 'author_actor_id') ??
    eventActorValue(event, 'requested_by_actor_id');

  return `Actor: ${actorId ?? 'Not recorded'}`;
}

function eventActorValue(event: TimelineEntry, field: string) {
  const eventRecord = event as unknown as Record<string, unknown>;
  const eventValue = eventRecord[field];

  if (typeof eventValue === 'string' && eventValue.trim().length > 0) {
    return eventValue;
  }

  const payloadValue = event.payload?.[field];

  if (typeof payloadValue === 'string' && payloadValue.trim().length > 0) {
    return payloadValue;
  }

  return undefined;
}

function revisionLabelFromArtifact(artifact: ProductListItem) {
  const revisionNumber = artifact.revision_state?.revision_number;

  if (revisionNumber !== undefined) {
    return `Revision ${revisionNumber}`;
  }

  return artifact.revision_state?.current_revision_id ? 'Current revision' : 'No revision yet';
}

function statusTone(status: string | undefined) {
  if (status === 'approved') return 'success';
  if (status === 'draft') return 'warning';
  if (status === 'blocked' || status === 'rejected') return 'danger';
  return 'info';
}

function formatDate(value: string | undefined) {
  if (value === undefined || value.trim().length === 0) {
    return 'Not recorded';
  }

  return value;
}

function formatValue(value: string | undefined, fallback = 'Not set') {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  return value
    .split(/[_ -]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}
