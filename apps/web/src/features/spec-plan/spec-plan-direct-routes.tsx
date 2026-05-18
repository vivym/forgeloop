import { Link, useParams, useSearchParams } from 'react-router';
import type { ReactNode } from 'react';

import {
  usePlanHistoryQuery,
  usePlanQuery,
  usePlanRevisionQuery,
  usePlansQuery,
  useSpecHistoryQuery,
  useSpecQuery,
  useSpecRevisionQuery,
  useSpecsQuery,
} from '../../shared/api/hooks';
import type { PlanRevision, SpecPlan, SpecRevision } from '../../shared/api/types';
import { useProjectContext } from '../../shared/context/project-context';
import { ActionRail, DetailLayout, PageHeader, Section } from '../../shared/layout';
import { Badge, Button, DataTable, EmptyState, StatusPill, Timeline, type TimelineItem } from '../../shared/ui';

type ArtifactKind = 'spec' | 'plan';

interface ProductListResponse<T> {
  items?: T[];
  degraded_sources?: unknown[];
}

interface RegistryFilters {
  status?: string;
}

type RevisionBearingArtifact = SpecPlan & {
  revision_number?: number;
  revision_state?: {
    revision_number?: number;
  };
};

export function SpecsRegistry() {
  const { projectId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const query = useSpecsQuery(projectId);
  const filters = parseRegistryFilters(searchParams);
  const list = normalizeList(query.data);
  const specs = filterArtifacts(list.items, filters);

  return (
    <>
      <PageHeader
        actions={
          <Link className="fl-button fl-button--primary" to="/work-items">
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
  const query = usePlansQuery(projectId);
  const filters = parseRegistryFilters(searchParams);
  const list = normalizeList(query.data);
  const plans = filterArtifacts(list.items, filters);

  return (
    <>
      <PageHeader
        actions={
          <Link className="fl-button fl-button--primary" to="/work-items">
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
  const historyQuery = useSpecHistoryQuery(artifactId);

  return (
    <ArtifactDetailView
      artifact={detailQuery.data}
      artifactId={artifactId}
      detailIsError={detailQuery.isError}
      detailStatus={detailQuery.status}
      historyIsError={historyQuery.isError}
      history={historyQuery.data}
      historyStatus={historyQuery.status}
      kind="spec"
    />
  );
}

function PlanArtifactDetail({ artifactId }: { artifactId: string }) {
  const detailQuery = usePlanQuery(artifactId);
  const historyQuery = usePlanHistoryQuery(artifactId);

  return (
    <ArtifactDetailView
      artifact={detailQuery.data}
      artifactId={artifactId}
      detailIsError={detailQuery.isError}
      detailStatus={detailQuery.status}
      historyIsError={historyQuery.isError}
      history={historyQuery.data}
      historyStatus={historyQuery.status}
      kind="plan"
    />
  );
}

function ArtifactDetailView({
  artifact,
  artifactId,
  detailIsError,
  detailStatus,
  history,
  historyIsError,
  historyStatus,
  kind,
}: {
  artifact: SpecPlan | undefined;
  artifactId: string;
  detailIsError: boolean;
  detailStatus: 'pending' | 'error' | 'success';
  history: Array<SpecRevision | PlanRevision> | undefined;
  historyIsError: boolean;
  historyStatus: 'pending' | 'error' | 'success';
  kind: ArtifactKind;
}) {
  const artifactName = kind === 'spec' ? 'Spec' : 'Plan';
  const revisionBasePath = kind === 'spec' ? `/specs/${encodeURIComponent(artifactId)}` : `/plans/${encodeURIComponent(artifactId)}`;

  if (detailStatus === 'pending') {
    return <LoadingDetail title={artifactName} />;
  }

  if (detailIsError) {
    return (
      <DetailLayout header={<PageHeader subtitle={`${artifactName} detail could not be loaded.`} title={artifactName} />}>
        <Section title="Unavailable">
          <p className="empty">{artifactName} data is temporarily unavailable.</p>
        </Section>
      </DetailLayout>
    );
  }

  if (artifact === undefined) {
    return (
      <DetailLayout header={<PageHeader subtitle={`No ${artifactName.toLowerCase()} was found for this route.`} title={artifactName} />}>
        <Section title="Empty">
          <p className="empty">No {artifactName} data is available.</p>
        </Section>
      </DetailLayout>
    );
  }

  const revisions = history ?? [];
  const currentRevision = findCurrentRevision(revisions, artifact.current_revision_id);

  return (
    <DetailLayout
      actionRail={
        <ActionRail title={`${artifactName} actions`}>
          <div className="stack-form compact">
            {artifact.current_revision_id ? (
              <Link
                className="fl-button fl-button--primary"
                to={`${revisionBasePath}/revisions/${encodeURIComponent(artifact.current_revision_id)}`}
              >
                Open current revision
              </Link>
            ) : (
              <Button disabled variant="primary">
                Open current revision
              </Button>
            )}
            <Button disabled title="Available from the approval workflow." variant="secondary">
              Submit for approval
            </Button>
            <Button disabled title="Available to assigned approvers." variant="secondary">
              Approve
            </Button>
            <Button disabled title="Available to assigned approvers." variant="secondary">
              Request changes
            </Button>
            <p className="status-line">Creation and edits start from the parent Work Item planning flow.</p>
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
        <div className="state-grid">
          <Metric label="Status" value={formatValue(artifact.status)} />
          <Metric label="Gate" value={formatValue(artifact.gate_state)} />
          <Metric label="Resolution" value={formatValue(artifact.resolution)} />
          <Metric label="Current revision" value={currentRevision ? revisionLabel(currentRevision) : artifact.current_revision_id ? 'Current revision' : 'Not created'} />
        </div>
      </Section>
      <Section title="Parent context">
        <div className="artifact-list">
          <Link to={`/work-items/${encodeURIComponent(artifact.work_item_id)}`}>Work Item</Link>
        </div>
      </Section>
      {kind === 'plan' ? <PlanPackageState plan={artifact} /> : null}
      <Section
        description="Direct route history is built from revision data. Parent Work Item replay may add more timeline detail when available."
        title="History / Timeline"
      >
        {historyStatus === 'pending' ? <p className="empty">Loading revision history.</p> : null}
        {historyIsError ? (
          <p className="empty">History / Timeline is temporarily unavailable. Detail may be incomplete until parent Work Item replay is available.</p>
        ) : null}
        {historyStatus !== 'pending' && !historyIsError ? (
          revisions.length ? (
            <Timeline items={revisionTimelineItems(revisions)} />
          ) : (
            <p className="empty">No revision events are available for this direct route yet.</p>
          )
        ) : null}
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

  if (revisionQuery.isError || revision === undefined) {
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
        <div className="detail-block">
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

  if (revisionQuery.isError || revision === undefined) {
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
        <div className="detail-block">
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
        <div className="artifact-list">
          <Link to={`/work-items/${encodeURIComponent(workItemId)}`}>Work Item</Link>
          <Link to={artifactLink}>{artifactLabel}</Link>
        </div>
      </Section>
      {children}
    </DetailLayout>
  );
}

function ArtifactTable({ artifacts, basePath, emptyMessage }: { artifacts: SpecPlan[]; basePath: '/specs' | '/plans'; emptyMessage: string }) {
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
          cell: (artifact) => <Link to={`/work-items/${encodeURIComponent(artifact.work_item_id)}`}>Work Item</Link>,
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
      <div className="pill-list" aria-label="Status filters">
        <Link className={selectedStatus === undefined ? 'fl-button fl-button--primary' : 'fl-button fl-button--secondary'} to={basePath}>
          All
        </Link>
        {statuses.map((status) => (
          <Link
            className={selectedStatus === status ? 'fl-button fl-button--primary' : 'fl-button fl-button--secondary'}
            key={status}
            to={`${basePath}?status=${encodeURIComponent(status)}`}
          >
            {formatValue(status)}
          </Link>
        ))}
      </div>
    </Section>
  );
}

function RegistryState({ isError, isPending, kind }: { isError: boolean; isPending: boolean; kind: string }) {
  if (isPending) {
    return <p className="empty">Loading {kind.toLowerCase()} registry.</p>;
  }

  if (isError) {
    return <p className="empty">{kind} registry data is temporarily unavailable.</p>;
  }

  return null;
}

function DegradedNotice({ hasDegradedSources }: { hasDegradedSources: boolean }) {
  if (!hasDegradedSources) {
    return null;
  }

  return (
    <p className="status-line">
      Registry data is available, but History / Timeline detail may be incomplete until parent Work Item replay is available.
    </p>
  );
}

function PlanPackageState({ plan }: { plan: SpecPlan }) {
  if (plan.status !== 'approved') {
    return (
      <Section title="Downstream package">
        <p className="empty">Package generation becomes available after Plan approval.</p>
      </Section>
    );
  }

  return (
    <Section title="Downstream package">
      <div className="artifact-list">
        <span>Ready for package generation</span>
        <Link to={`/packages?plan=${encodeURIComponent(plan.id)}`}>View package readiness</Link>
      </div>
    </Section>
  );
}

function LoadingDetail({ title }: { title: string }) {
  return (
    <DetailLayout header={<PageHeader subtitle="Loading product context." title={title} />}>
      <Section title="Loading">
        <p className="empty">Loading {title.toLowerCase()}.</p>
      </Section>
    </DetailLayout>
  );
}

function InvalidRoute({ message, title }: { message: string; title: string }) {
  return (
    <DetailLayout header={<PageHeader subtitle="Route context is required for this page." title={title} />}>
      <Section title="Invalid route">
        <p className="empty">{message}</p>
      </Section>
    </DetailLayout>
  );
}

function RevisionUnavailable({ title }: { title: string }) {
  return (
    <DetailLayout header={<PageHeader subtitle="The revision could not be loaded." title={title} />}>
      <Section title="Unavailable">
        <p className="empty">Revision data is temporarily unavailable.</p>
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
    <div className="state-grid">
      <Metric label="Revision" value={`Revision ${revisionNumber}`} />
      <Metric label="Created" value={formatDate(createdAt)} />
      <Metric label="Artifact status" value={formatValue(artifactStatus)} />
    </div>
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
        <p className="empty">No {title.toLowerCase()} are recorded for this revision.</p>
      )}
    </Section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function parseRegistryFilters(searchParams: URLSearchParams): RegistryFilters {
  const status = searchParams.get('status')?.trim();
  return status ? { status } : {};
}

function filterArtifacts(artifacts: SpecPlan[], filters: RegistryFilters) {
  return artifacts.filter((artifact) => filters.status === undefined || artifact.status === filters.status);
}

function normalizeList(data: SpecPlan[] | ProductListResponse<SpecPlan> | undefined) {
  if (Array.isArray(data)) {
    return { degradedSources: [], items: data };
  }

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

function revisionTimelineItems(revisions: Array<SpecRevision | PlanRevision>): TimelineItem[] {
  return revisions.map((revision) => ({
    id: revision.id,
    title: `${revisionLabel(revision)} created`,
    description: revision.summary,
    meta: formatDate(revision.created_at),
  }));
}

function revisionLabel(revision: SpecRevision | PlanRevision) {
  return `Revision ${revision.revision_number}`;
}

function revisionLabelFromArtifact(artifact: SpecPlan) {
  const revisionNumber = (artifact as RevisionBearingArtifact).revision_state?.revision_number ?? (artifact as RevisionBearingArtifact).revision_number;

  if (revisionNumber !== undefined) {
    return `Revision ${revisionNumber}`;
  }

  return artifact.current_revision_id ? 'Current revision' : 'No revision yet';
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
