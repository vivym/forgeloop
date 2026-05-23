import { Link, useSearchParams } from 'react-router';

import { usePlansQuery, useSpecsQuery } from '../../shared/api/hooks';
import type { ProductListItem } from '../../shared/api/types';
import { useProjectContext } from '../../shared/context/project-context';
import { InlineActions, PageHeader, Section } from '../../shared/layout';
import { Badge, InlineNotice, StatusPill } from '../../shared/ui';

type QueueKind = 'spec' | 'plan';
type QueueGroupId = 'needs-authoring' | 'needs-review' | 'approved' | 'stale' | 'blocked';

const selectedSegmentClass =
  'inline-flex min-h-9 items-center justify-center rounded-md border border-primary bg-primary px-3 text-sm font-semibold text-white transition-colors duration-base ease-standard';
const unselectedSegmentClass =
  'inline-flex min-h-9 items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-semibold text-text-primary transition-colors duration-base ease-standard hover:border-border-strong hover:bg-surface-muted';

const queueGroups: Array<{ id: QueueGroupId; label: string }> = [
  { id: 'needs-authoring', label: 'Needs authoring' },
  { id: 'needs-review', label: 'Needs review' },
  { id: 'approved', label: 'Approved' },
  { id: 'stale', label: 'Stale' },
  { id: 'blocked', label: 'Blocked' },
];

export function SpecsPlansRoute() {
  const { projectId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const activeKind = searchParams.get('tab') === 'plans' ? 'plan' : 'spec';
  const specsQuery = useSpecsQuery({ project_id: projectId, limit: 100 });
  const plansQuery = usePlansQuery({ project_id: projectId, limit: 100 });
  const activeQuery = activeKind === 'spec' ? specsQuery : plansQuery;
  const activeItems = activeKind === 'spec' ? specsQuery.data?.items ?? [] : plansQuery.data?.items ?? [];

  return (
    <>
      <PageHeader
        subtitle="Spec and Plan authoring queues grouped by typed source object state."
        title="Specs & Plans"
      />
      <Section title="Authoring queue">
        <InlineActions aria-label="Specs and Plans tabs" role="tablist">
          <Link
            aria-selected={activeKind === 'spec'}
            className={activeKind === 'spec' ? selectedSegmentClass : unselectedSegmentClass}
            role="tab"
            to="/specs-plans?tab=specs"
          >
            Specs
          </Link>
          <Link
            aria-selected={activeKind === 'plan'}
            className={activeKind === 'plan' ? selectedSegmentClass : unselectedSegmentClass}
            role="tab"
            to="/specs-plans?tab=plans"
          >
            Plans
          </Link>
        </InlineActions>
        <QueueStatus
          isError={activeQuery.isError}
          isPending={activeQuery.status === 'pending'}
          kind={activeKind}
        />
      </Section>
      {activeQuery.status !== 'pending' && !activeQuery.isError ? (
        <GroupedQueue items={activeItems} kind={activeKind} />
      ) : null}
    </>
  );
}

function GroupedQueue({ items, kind }: { items: ProductListItem[]; kind: QueueKind }) {
  const groupedItems = groupItems(items);

  return (
    <>
      {queueGroups.map((group) => (
        <Section
          description={`${groupedItems[group.id].length} ${kind === 'spec' ? 'Spec' : 'Plan'} item${groupedItems[group.id].length === 1 ? '' : 's'}.`}
          key={group.id}
          title={group.label}
        >
          {groupedItems[group.id].length ? (
            <div className="grid gap-3">
              {groupedItems[group.id].map((item) => (
                <QueueItemCard item={item} key={item.id} kind={kind} />
              ))}
            </div>
          ) : (
            <InlineNotice title={`No ${group.label.toLowerCase()} items.`} />
          )}
        </Section>
      ))}
    </>
  );
}

function QueueItemCard({ item, kind }: { item: ProductListItem; kind: QueueKind }) {
  const detailHref = kind === 'spec' ? `/specs/${encodeURIComponent(item.id)}` : `/plans/${encodeURIComponent(item.id)}`;

  return (
    <article className="grid gap-3 rounded-card border border-border bg-surface p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-text-primary">
            <Link to={detailHref}>{item.title}</Link>
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusPill tone={statusTone(item.status)}>{formatValue(item.status)}</StatusPill>
            <Badge tone="info">{revisionLabel(item)}</Badge>
          </div>
        </div>
        <Link className={unselectedSegmentClass} to={detailHref}>
          Open {kind === 'spec' ? 'Spec' : 'Plan'}
        </Link>
      </div>
      <div className="grid gap-2 text-sm text-text-secondary">
        <div>
          <span className="font-semibold text-text-primary">Source Object Context: </span>
          {item.parent ? <Link to={sourceObjectHref(item.parent)}>{sourceObjectLabel(item.parent)}</Link> : 'Not linked'}
        </div>
        <div>Gate: {formatValue(item.gate_state)} | Resolution: {formatValue(item.resolution)}</div>
      </div>
    </article>
  );
}

function QueueStatus({ isError, isPending, kind }: { isError: boolean; isPending: boolean; kind: QueueKind }) {
  const label = kind === 'spec' ? 'Specs' : 'Plans';

  if (isPending) {
    return <InlineNotice title={`Loading ${label.toLowerCase()} queue.`} tone="info" />;
  }

  if (isError) {
    return <InlineNotice title={`${label} queue data is temporarily unavailable.`} tone="danger" />;
  }

  return null;
}

function groupItems(items: ProductListItem[]): Record<QueueGroupId, ProductListItem[]> {
  const grouped: Record<QueueGroupId, ProductListItem[]> = {
    'needs-authoring': [],
    'needs-review': [],
    approved: [],
    stale: [],
    blocked: [],
  };

  for (const item of items) {
    grouped[groupForItem(item)].push(item);
  }

  return grouped;
}

function groupForItem(item: ProductListItem): QueueGroupId {
  const status = item.status?.toLowerCase();
  const gate = item.gate_state?.toLowerCase();
  const resolution = item.resolution?.toLowerCase();
  const flags = item as ProductListItem & { stale?: boolean; stale_state?: string; blocked?: boolean };

  if (flags.blocked || status === 'blocked' || gate === 'blocked' || resolution === 'blocked') {
    return 'blocked';
  }
  if (flags.stale || flags.stale_state === 'stale' || status === 'stale') {
    return 'stale';
  }
  if (status === 'approved' || gate === 'approved' || resolution === 'approved') {
    return 'approved';
  }
  if (status === 'submitted' || status === 'in_review' || gate === 'awaiting_review' || gate === 'review') {
    return 'needs-review';
  }
  return 'needs-authoring';
}

function sourceObjectHref(ref: NonNullable<ProductListItem['parent']>): string {
  switch (ref.type) {
    case 'initiative':
      return `/initiatives/${encodeURIComponent(ref.id)}`;
    case 'requirement':
      return `/requirements/${encodeURIComponent(ref.id)}`;
    case 'bug':
      return `/bugs/${encodeURIComponent(ref.id)}`;
    case 'tech_debt':
      return `/tech-debt/${encodeURIComponent(ref.id)}`;
    case 'development_plan_item':
      return `/development-plans/${encodeURIComponent(ref.development_plan_id)}/items/${encodeURIComponent(ref.id)}`;
    case 'spec':
      return `/specs/${encodeURIComponent(ref.id)}`;
    case 'execution_plan':
      return `/plans/${encodeURIComponent(ref.id)}`;
    case 'release':
      return `/releases/${encodeURIComponent(ref.id)}`;
    default:
      return '/my-work';
  }
}

function sourceObjectLabel(ref: NonNullable<ProductListItem['parent']>) {
  return `${formatValue(ref.type)} ${ref.title ?? ref.id}`;
}

function revisionLabel(item: ProductListItem) {
  const revisionNumber = item.revision_state?.revision_number;
  if (revisionNumber !== undefined) {
    return `Revision ${revisionNumber}`;
  }
  return item.revision_state?.current_revision_id ? 'Current revision' : 'No revision';
}

function statusTone(status: string | undefined) {
  if (status === 'approved') return 'success';
  if (status === 'blocked' || status === 'rejected') return 'danger';
  if (status === 'draft' || status === 'submitted') return 'warning';
  return 'info';
}

function formatValue(value: string | undefined, fallback = 'Not set') {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  return value
    .split(/[_/ -]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}
