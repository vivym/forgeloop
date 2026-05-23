import { Link, useParams } from 'react-router';
import type { ReactNode } from 'react';

import {
  usePlanQuery,
  usePlanReplayQuery,
  usePlanRevisionQuery,
  usePlanRevisionsQuery,
  useSpecQuery,
  useSpecReplayQuery,
  useSpecRevisionQuery,
  useSpecRevisionsQuery,
} from '../../shared/api/hooks';
import type { ObjectRef, PlanRevision, SpecPlan, SpecRevision, TimelineEntry } from '../../shared/api/types';
import { useActorContext } from '../../shared/context/actor-context';
import { ActionRail, DetailLayout, InlineActions, Metric, MetricGrid, PageHeader, Section } from '../../shared/layout';
import { Badge, Button, InlineNotice, StatusPill, Timeline, type TimelineItem } from '../../shared/ui';
import { SpecPlanLifecycleActions } from './spec-plan-lifecycle-actions';

type ArtifactKind = 'spec' | 'plan';

const primaryLinkClass =
  'inline-flex min-h-10 items-center justify-center rounded-md border border-primary bg-primary px-4 text-sm font-semibold text-white transition-colors duration-base ease-standard hover:bg-primary-hover';

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
            <SpecPlanLifecycleActions actorId={actorId} artifact={artifact} kind={kind} />
            <InlineNotice title="Creation and edits start from the typed parent planning flow." tone="info" />
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
      <Section title="Source Object Context">
        <InlineActions>
          <Link to={productScopeHref(artifact.scope_ref)}>{scopeLabel(artifact.scope_ref)}</Link>
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
            <Timeline items={replayTimelineItems(replay, artifact.scope_ref)} />
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

function productScopeHref(scopeRef: ObjectRef): string {
  switch (scopeRef.type) {
    case 'initiative':
      return `/initiatives/${encodeURIComponent(scopeRef.id)}`;
    case 'requirement':
      return `/requirements/${encodeURIComponent(scopeRef.id)}`;
    case 'bug':
      return `/bugs/${encodeURIComponent(scopeRef.id)}`;
    case 'tech_debt':
      return `/tech-debt/${encodeURIComponent(scopeRef.id)}`;
    case 'task':
      return `/tasks/${encodeURIComponent(scopeRef.id)}`;
    default:
      return '/my-work';
  }
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
      scopeRef={revision.scope_ref}
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
      scopeRef={revision.scope_ref}
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
  scopeRef,
}: {
  artifactLabel: string;
  artifactLink: string;
  children: ReactNode;
  meta: ReactNode;
  summary: string;
  title: string;
  scopeRef: ObjectRef;
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
          <Link to={productScopeHref(scopeRef)}>{scopeLabel(scopeRef)}</Link>
          <Link to={artifactLink}>{artifactLabel}</Link>
        </InlineActions>
      </Section>
      {children}
    </DetailLayout>
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
        <InlineNotice
          title="This approved Plan does not have an approved revision recorded yet. Task-scoped package evidence opens from Tasks."
          tone="info"
        />
      </Section>
    );
  }

  return (
    <Section title="Downstream package">
      <InlineNotice title="Package generation is ready for this approved Plan. Continue from the relevant Task evidence route." tone="success" />
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

function findCurrentRevision<T extends SpecRevision | PlanRevision>(revisions: T[], revisionId: string | undefined) {
  if (revisionId === undefined) {
    return undefined;
  }

  return revisions.find((revision) => revision.id === revisionId);
}

function replayTimelineItems(events: TimelineEntry[], scopeRef: ObjectRef): TimelineItem[] {
  return events.map((event) => ({
    id: event.id,
    title: event.summary,
    description: eventTimelineDescription(event, scopeRef),
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

function eventParentContext(event: TimelineEntry, scopeRef: ObjectRef) {
  const payloadScopeRef = parseTimelineScopeRef(event.payload?.scope_ref);

  if (
    (event.object_type === scopeRef.type && event.object_id === scopeRef.id) ||
    (payloadScopeRef !== undefined && payloadScopeRef.type === scopeRef.type && payloadScopeRef.id === scopeRef.id)
  ) {
    return `Source Object Context: ${scopeLabel(scopeRef)}`;
  }

  return 'Source Object Context: typed source linkage not recorded on this event';
}

function eventTimelineDescription(event: TimelineEntry, scopeRef: ObjectRef) {
  return [eventParentContext(event, scopeRef), eventActorLabel(event)].filter(Boolean).join(' | ');
}

function parseTimelineScopeRef(value: unknown): Pick<ObjectRef, 'type' | 'id'> | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const ref = value as { type?: unknown; id?: unknown };
  if (typeof ref.type !== 'string' || typeof ref.id !== 'string') {
    return undefined;
  }

  return { type: ref.type as ObjectRef['type'], id: ref.id };
}

function scopeLabel(scopeRef: ObjectRef): string {
  switch (scopeRef.type) {
    case 'initiative':
      return 'Initiative';
    case 'requirement':
      return 'Requirement';
    case 'bug':
      return 'Bug';
    case 'tech_debt':
      return 'Tech Debt';
    case 'task':
      return 'Task';
    default:
      return 'Source object';
  }
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
