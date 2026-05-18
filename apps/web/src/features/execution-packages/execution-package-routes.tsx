import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import {
  useExecutionPackageReplayQuery,
  useForceRerunPackageMutation,
  useMarkPackageReadyMutation,
  usePackageQuery,
  usePackagesQuery,
  useRerunPackageMutation,
  useRunPackageMutation,
} from '../../shared/api/hooks';
import type { ExecutionPackage, ProductListItem, TimelineEntry } from '../../shared/api/types';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { ActionRail, DetailLayout, PageHeader, Section } from '../../shared/layout';
import { Badge, Button, DataTable, StatusPill, Tabs, Textarea, Timeline, type TimelineItem } from '../../shared/ui';

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

export function PackagesRegistry() {
  const { projectId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const filters = packageFiltersFromSearch(searchParams);
  const query = usePackagesQuery({ project_id: projectId, ...filters, limit: 100 });
  const items = query.data?.items ?? [];
  const unsupportedFilters = unsupportedPackageFilters(searchParams);
  const planRevisionId = searchParams.get('plan_revision_id')?.trim() || undefined;

  return (
    <>
      <PageHeader
        actions={
          planRevisionId ? (
            <div className="fl-inline-actions">
              <Button disabled variant="primary">
                Generate packages
              </Button>
              <Button disabled variant="secondary">
                Create manual package
              </Button>
            </div>
          ) : null
        }
        subtitle="Track execution packages by Work Item, ownership, lifecycle state, and blocking state."
        title="Packages"
      />
      {planRevisionId ? (
        <Section
          description="Generation and manual package creation start from the selected PlanRevision context. Manual ID entry stays in Dev Tools."
          title="PlanRevision package actions"
        >
          <div className="fl-inline-actions">
            <Button disabled variant="primary">
              Generate packages from this PlanRevision
            </Button>
            <Button disabled variant="secondary">
              Create manual package
            </Button>
          </div>
        </Section>
      ) : null}
      <Section
        description="Server-side filters are sent for project, Work Item, PlanRevision, owner, reviewer, QA owner, phase, status, gate state, resolution, and blocked status."
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
  const planRevisionId = searchParams.get('plan_revision_id')?.trim() || detailQuery.data?.plan_revision_id;

  if (detailQuery.status === 'pending') {
    return <LoadingDetail title="Package" />;
  }

  if (detailQuery.isError || detailQuery.data === undefined) {
    return <InvalidDetail title="Package" message="Execution package data is temporarily unavailable." />;
  }

  const executionPackage = detailQuery.data;
  const actionPending = markReady.isPending || runPackage.isPending || rerunPackage.isPending || forceRerunPackage.isPending;

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
              onClick={() => runPackage.mutate({ actorId, workflowOnly: true })}
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
              Force rerun bypasses normal freshness checks and must include a reason for the evidence trail.
            </p>
            <Button
              disabled={actionPending || forceReason.trim().length === 0}
              loading={forceRerunPackage.isPending}
              onClick={() =>
                forceRerunPackage.mutate({
                  actorId,
                  reason: forceReason.trim(),
                  ...(executionPackage.last_run_session_id === undefined
                    ? {}
                    : { previousRunSessionId: executionPackage.last_run_session_id }),
                })
              }
              variant="danger"
            >
              Force rerun
            </Button>
            <Button disabled title="Package editing opens in a governed edit dialog." variant="secondary">
              Edit package details
            </Button>
          </div>
          {planRevisionId ? (
            <div className="stack-form compact">
              <h3>PlanRevision context</h3>
              <Button disabled variant="secondary">
                Generate packages from this PlanRevision
              </Button>
              <Button disabled variant="secondary">
                Create manual package
              </Button>
            </div>
          ) : null}
        </ActionRail>
      }
      header={
        <PageHeader
          subtitle={`${executionPackage.repo_id} / ${executionPackage.work_item_id}`}
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
            label: 'Timeline / Replay',
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
    return <Section title="Timeline / Replay"><p className="empty">Loading package history...</p></Section>;
  }

  if (isError) {
    return <Section title="Timeline / Replay"><p className="empty">Package history is temporarily unavailable.</p></Section>;
  }

  const items: TimelineItem[] = timeline.map((entry) => ({
    id: entry.id,
    title: entry.summary,
    description: `${entry.source} / ${entry.object_type}`,
    meta: formatDate(entry.created_at),
  }));

  return (
    <Section title="Timeline / Replay" description="Product history assembled from the replay endpoint.">
      {items.length ? <Timeline items={items} /> : <p className="empty">No package timeline events are available yet.</p>}
    </Section>
  );
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
  filters: Record<string, string | boolean>;
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
          {formatUnsupportedFilters(unsupportedFilters)} are not applied to the package inventory yet.
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

function LoadingDetail({ title }: { title: string }) {
  return (
    <DetailLayout header={<PageHeader subtitle="Loading route-backed data." title={title} />}>
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

function packageFiltersFromSearch(searchParams: URLSearchParams) {
  const filters: Record<string, string | boolean> = {};
  for (const key of supportedPackageFilters) {
    const value = searchParams.get(key)?.trim();
    if (!value) continue;
    filters[key] = key === 'blocked' ? value === 'true' : value;
  }
  return filters;
}

function unsupportedPackageFilters(searchParams: URLSearchParams) {
  const allowed = new Set<string>([...supportedPackageFilters, 'project_id', 'cursor', 'limit']);
  return [...searchParams.keys()].filter((key) => !allowed.has(key));
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
