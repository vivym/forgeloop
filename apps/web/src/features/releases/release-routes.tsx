import { Link, useParams } from 'react-router';

import { useReleaseCockpitQuery, useReleaseReadinessQuery, useReleasesQuery } from '../../shared/api/hooks';
import type { ObjectRef, ReleaseReadinessDetail } from '../../shared/api/types';
import { useProjectContext } from '../../shared/context/project-context';
import { ActionRail, DetailLayout, MetadataGrid, PageHeader, Section } from '../../shared/layout';
import { DataTable, InlineNotice, StatusPill, type DataTableColumn } from '../../shared/ui';

type ReleaseListItem = {
  id: string;
  title: string;
  phase?: string;
  gate_state?: string;
  resolution?: string;
  release_owner_actor_id?: string | undefined;
  updated_at?: string;
};
type ReleaseScopeRef = Extract<ObjectRef, { type: 'initiative' | 'requirement' | 'tech_debt' | 'development_plan_item' | 'bug' }>;

export function ReleasesRoute() {
  const { projectId } = useProjectContext();
  const query = useReleasesQuery({ project_id: projectId, limit: 100 });
  const releases = query.data?.releases ?? [];
  const columns: DataTableColumn<ReleaseListItem>[] = [
    {
      key: 'title',
      header: 'Release',
      cell: (release) => (
        <Link className="font-semibold text-primary hover:underline" to={`/releases/${encodeURIComponent(release.id)}`}>
          {release.title}
        </Link>
      ),
    },
    { key: 'phase', header: 'Phase', cell: (release) => <StatusPill tone="neutral">{formatValue(release.phase)}</StatusPill> },
    { key: 'gate', header: 'Gate', cell: (release) => formatValue(release.gate_state) },
    { key: 'owner', header: 'Release Owner', cell: (release) => release.release_owner_actor_id ?? 'Unassigned' },
  ];

  return (
    <>
      <PageHeader subtitle="Release readiness, scope, ownership, and gate state." title="Releases" />
      <Section title="Release inventory">
        {query.isLoading ? <InlineNotice title="Loading releases." tone="info" /> : null}
        {query.isError ? <InlineNotice title="Releases could not be loaded." tone="danger" /> : null}
        <DataTable ariaLabel="Release list" columns={columns} emptyMessage="No releases match the current filters." getRowKey={(release) => release.id} rows={releases} />
      </Section>
    </>
  );
}

export function ReleaseDetailRoute() {
  const { releaseId } = useParams();

  if (releaseId === undefined) {
    return <ReleaseUnavailable title="Release" />;
  }

  return <ReleaseDetailContent releaseId={releaseId} />;
}

function ReleaseDetailContent({ releaseId }: { releaseId: string }) {
  const { projectId } = useProjectContext();
  const cockpitQuery = useReleaseCockpitQuery(releaseId);
  const readinessQuery = useReleaseReadinessQuery(releaseId, projectId);
  const release = cockpitQuery.data?.release;
  const readiness = readinessQuery.data;

  if (cockpitQuery.isLoading || readinessQuery.isLoading) {
    return <ReleaseLoading />;
  }

  if (cockpitQuery.isError || readinessQuery.isError || release === undefined || readiness === undefined) {
    return <ReleaseUnavailable title="Release" />;
  }

  return (
    <DetailLayout
      actionRail={
        <ActionRail title="Release controls">
          <MetadataGrid
            items={[
              { label: 'Release Owner', value: release.release_owner_actor_id ?? 'Unassigned' },
              { label: 'Gate', value: formatValue(release.gate_state) },
              { label: 'Resolution', value: formatValue(release.resolution) },
            ]}
          />
        </ActionRail>
      }
      header={
        <PageHeader
          eyebrow={<StatusPill tone={readiness.ready ? 'success' : 'warning'}>{readiness.ready ? 'Ready' : 'Blocked'}</StatusPill>}
          subtitle={release.scope_summary ?? 'Release readiness, typed scope, and execution evidence.'}
          title="Release Readiness"
        />
      }
    >
      <Section title={release.title}>
        <MetadataGrid
          items={[
            { label: 'Release', value: release.id },
            { label: 'Phase', value: formatValue(release.phase) },
            { label: 'Activity', value: formatValue(release.activity_state) },
            { label: 'Release Owner', value: release.release_owner_actor_id ?? 'Unassigned' },
          ]}
        />
      </Section>
      <TypedScopeSection scopeRefs={readiness.scope_refs} />
      <ReadinessSection readiness={readiness} />
    </DetailLayout>
  );
}

export function ReleaseEvidenceRoute() {
  return <ReleaseDetailRoute />;
}

function TypedScopeSection({ scopeRefs }: { scopeRefs: ObjectRef[] }) {
  const typedScopeRefs = scopeRefs.filter(isReleaseScopeRef);

  return (
    <Section title="Typed scope">
      <div className="grid gap-2 md:grid-cols-2">
        {typedScopeRefs.map((ref) => (
          <Link
            className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface p-3 text-sm hover:border-primary hover:bg-primary-soft"
            key={`${ref.type}:${ref.id}`}
            to={typedObjectHref(ref)}
          >
            <span className="font-semibold text-text-primary">{objectLabel(ref.type)}</span>
            <span className="text-text-secondary">{ref.title ?? ref.id}</span>
          </Link>
        ))}
      </div>
    </Section>
  );
}

function ReadinessSection({ readiness }: { readiness: ReleaseReadinessDetail }) {
  const groups = [
    { title: 'Review evidence', items: readiness.required_review_evidence },
    { title: 'Test acceptance evidence', items: readiness.required_test_acceptance_evidence },
    { title: 'Execution evidence', items: readiness.package_run_evidence },
    { title: 'Observation evidence', items: readiness.observation_evidence },
  ];

  return (
    <>
      {readiness.disabled_reasons.length > 0 ? (
        <Section title="Disabled reasons">
          <ul className="grid gap-2 text-sm text-text-secondary">
            {readiness.disabled_reasons.map((reason) => (
              <li key={`${reason.code}:${reason.target_ref?.type ?? 'release'}:${reason.target_ref?.id ?? readiness.release_id}`}>
                {reason.message}
                {reason.target_ref ? ` (${objectLabel(reason.target_ref.type)} ${reason.target_ref.id})` : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {groups.map((group) => (
        <Section key={group.title} title={group.title}>
          <div className="grid gap-2">
            {group.items.map((item) => (
              <ReadinessEvidenceCard item={item} key={item.requirement_id} />
            ))}
          </div>
        </Section>
      ))}
    </>
  );
}

function ReadinessEvidenceCard({ item }: { item: ReleaseReadinessDetail['required_review_evidence'][number] }) {
  const evidenceHref = executionEvidenceHref(item);

  return (
    <div className="grid gap-2 rounded-card border border-border bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={item.status === 'passed' ? 'success' : 'warning'}>{formatValue(item.status)}</StatusPill>
        <span className="font-semibold text-text-primary">{objectLabel(item.scope_ref.type)}</span>
        <span className="text-text-secondary">{item.scope_ref.title ?? item.scope_ref.id}</span>
      </div>
      <div className="text-text-secondary">{formatValue(item.kind)}</div>
      {evidenceHref ? (
        <Link className="text-primary hover:underline" to={evidenceHref}>
          Open execution evidence
        </Link>
      ) : null}
      {item.disabled_reason ? <p className="text-text-secondary">{item.disabled_reason.message}</p> : null}
    </div>
  );
}

function executionEvidenceHref(item: ReleaseReadinessDetail['required_review_evidence'][number]): string | undefined {
  if (item.scope_ref.type !== 'development_plan_item' || item.evidence_ref === undefined) {
    return undefined;
  }
  const itemId = encodeURIComponent(item.scope_ref.id);
  const evidenceRef = item.evidence_ref;
  if ('evidence_type' in evidenceRef && evidenceRef.evidence_type === 'package_run') {
    return `/board?development_plan_item_id=${itemId}`;
  }
  if ('authority_ref' in evidenceRef && evidenceRef.authority_ref.type === 'code_review_handoff') {
    return `/reports?development_plan_item_id=${itemId}&code_review_handoff_id=${encodeURIComponent(evidenceRef.authority_ref.id)}`;
  }
  if ('code_review_handoff_id' in evidenceRef && evidenceRef.code_review_handoff_id !== undefined) {
    return `/reports?development_plan_item_id=${itemId}&code_review_handoff_id=${encodeURIComponent(evidenceRef.code_review_handoff_id)}`;
  }
  return undefined;
}

function ReleaseLoading() {
  return (
    <DetailLayout header={<PageHeader subtitle="Loading release readiness." title="Release Readiness" />}>
      <InlineNotice title="Release readiness is loading." tone="info" />
    </DetailLayout>
  );
}

function ReleaseUnavailable({ title }: { title: string }) {
  return (
    <DetailLayout header={<PageHeader subtitle="This release could not be loaded." title={title} />}>
      <InlineNotice title="Release readiness is unavailable." tone="warning" />
    </DetailLayout>
  );
}

function isReleaseScopeRef(ref: ObjectRef): ref is ReleaseScopeRef {
  return (
    ref.type === 'initiative' ||
    ref.type === 'requirement' ||
    ref.type === 'tech_debt' ||
    ref.type === 'development_plan_item' ||
    ref.type === 'bug'
  );
}

function typedObjectHref(ref: ReleaseScopeRef): string {
  switch (ref.type) {
    case 'initiative':
      return `/initiatives/${encodeURIComponent(ref.id)}`;
    case 'requirement':
      return `/requirements/${encodeURIComponent(ref.id)}`;
    case 'tech_debt':
      return `/tech-debt/${encodeURIComponent(ref.id)}`;
    case 'development_plan_item':
      return `/development-plans/${encodeURIComponent(ref.development_plan_id)}/items/${encodeURIComponent(ref.id)}`;
    case 'bug':
      return `/bugs/${encodeURIComponent(ref.id)}`;
  }
}

function objectLabel(type: ObjectRef['type']): string {
  if (type === 'tech_debt') return 'Tech Debt';
  if (type === 'development_plan_item') return 'Development Plan Item';
  return formatValue(type);
}

function formatValue(value: string | undefined): string {
  return value === undefined ? 'Not recorded' : value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}
