import { Link, useSearchParams } from 'react-router';

import { useSpecExecutionPlanQueueQuery } from '../../shared/api/hooks';
import { useProjectContext } from '../../shared/context/project-context';
import { InlineActions, PageHeader, Section } from '../../shared/layout';
import { Badge, InlineNotice, StatusPill } from '../../shared/ui';

type QueueKind = 'spec' | 'plan';
type QueueGroupId = 'needs-authoring' | 'needs-review' | 'approved' | 'stale' | 'blocked';
type QueueRef = { type: string; id: string; title?: string; development_plan_id?: string };
type QueueItem = {
  id: string;
  title: string;
  status?: string;
  gate_state?: string;
  stale?: boolean;
  blocked?: boolean;
  href?: string;
  artifact_type: 'spec' | 'execution_plan';
  source_ref?: QueueRef;
  development_plan_item_ref?: QueueRef;
};

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
  const focusedDevelopmentPlanId = searchParams.get('development_plan_id');
  const focusedDevelopmentPlanItemId = searchParams.get('development_plan_item_id');
  const queueQuery = useSpecExecutionPlanQueueQuery({ project_id: projectId, limit: 100 });
  const activeItems = ((queueQuery.data?.items ?? []) as QueueItem[])
    .filter((item) => (activeKind === 'spec' ? item.artifact_type === 'spec' : item.artifact_type === 'execution_plan'))
    .filter((item) => isFocusedQueueItem(item, focusedDevelopmentPlanId, focusedDevelopmentPlanItemId));

  return (
    <>
      <PageHeader
        subtitle="Spec and Execution Plan authoring queues grouped by typed source object state."
        title="Specs & Execution Plans"
      />
      <Section title="Authoring queue">
        <InlineActions aria-label="Specs and Execution Plans tabs" role="tablist">
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
            Execution Plans
          </Link>
        </InlineActions>
        <QueueStatus
          isError={queueQuery.isError}
          isPending={queueQuery.status === 'pending'}
          kind={activeKind}
        />
        {focusedDevelopmentPlanId !== null || focusedDevelopmentPlanItemId !== null ? (
          <InlineNotice
            description={queueFocusDescription(focusedDevelopmentPlanId, focusedDevelopmentPlanItemId)}
            title="Focused governance queue"
            tone="info"
          />
        ) : null}
      </Section>
      {queueQuery.status !== 'pending' && !queueQuery.isError ? (
        <GroupedQueue items={activeItems} kind={activeKind} />
      ) : null}
    </>
  );
}

function isFocusedQueueItem(item: QueueItem, developmentPlanId: string | null, developmentPlanItemId: string | null): boolean {
  if (developmentPlanId !== null && item.development_plan_item_ref?.development_plan_id !== developmentPlanId) return false;
  if (developmentPlanItemId !== null && item.development_plan_item_ref?.id !== developmentPlanItemId) return false;
  return true;
}

function queueFocusDescription(developmentPlanId: string | null, developmentPlanItemId: string | null): string {
  if (developmentPlanId !== null && developmentPlanItemId !== null) {
    return `Showing governance rows for Development Plan ${developmentPlanId} and Development Plan Item ${developmentPlanItemId}.`;
  }
  if (developmentPlanId !== null) return `Showing governance rows for Development Plan ${developmentPlanId}.`;
  if (developmentPlanItemId !== null) return `Showing governance rows for Development Plan Item ${developmentPlanItemId}.`;
  return 'Showing all governance rows.';
}

function GroupedQueue({ items, kind }: { items: QueueItem[]; kind: QueueKind }) {
  const groupedItems = groupItems(items);

  return (
    <>
      {queueGroups.map((group) => (
        <Section
          description={`${groupedItems[group.id].length} ${kind === 'spec' ? 'Spec' : 'Execution Plan'} item${groupedItems[group.id].length === 1 ? '' : 's'}.`}
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

function QueueItemCard({ item, kind }: { item: QueueItem; kind: QueueKind }) {
  const detailHref = queueItemHref(item, kind);

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
          Open {kind === 'spec' ? 'Spec' : 'Execution Plan'}
        </Link>
      </div>
      <div className="grid gap-2 text-sm text-text-secondary">
        <div>
          <span className="font-semibold text-text-primary">Source Object Context: </span>
          {item.source_ref ? <Link to={sourceObjectHref(item.source_ref)}>{sourceObjectLabel(item.source_ref)}</Link> : 'Not linked'}
        </div>
        <div>
          Gate: {formatValue(item.gate_state)}
          {item.development_plan_item_ref ? ` | Development Plan Item: ${item.development_plan_item_ref.id}` : ''}
        </div>
      </div>
    </article>
  );
}

function queueItemHref(item: QueueItem, kind: QueueKind): string {
  const tab = kind === 'spec' ? 'specs' : 'plans';
  if (item.development_plan_item_ref?.development_plan_id !== undefined) {
    const searchParams = new URLSearchParams({
      tab,
      development_plan_id: item.development_plan_item_ref.development_plan_id,
      development_plan_item_id: item.development_plan_item_ref.id,
    });
    return `/specs-plans?${searchParams.toString()}`;
  }
  return `/specs-plans?tab=${tab}`;
}

function QueueStatus({ isError, isPending, kind }: { isError: boolean; isPending: boolean; kind: QueueKind }) {
  const label = kind === 'spec' ? 'Specs' : 'Execution Plans';

  if (isPending) {
    return <InlineNotice title={`Loading ${label.toLowerCase()} queue.`} tone="info" />;
  }

  if (isError) {
    return <InlineNotice title={`${label} queue data is temporarily unavailable.`} tone="danger" />;
  }

  return null;
}

function groupItems(items: QueueItem[]): Record<QueueGroupId, QueueItem[]> {
  const grouped: Record<QueueGroupId, QueueItem[]> = {
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

function groupForItem(item: QueueItem): QueueGroupId {
  const status = item.status?.toLowerCase();
  const gate = item.gate_state?.toLowerCase();
  const flags = item as QueueItem & { stale_state?: string };

  if (flags.blocked || status === 'blocked' || gate === 'blocked') {
    return 'blocked';
  }
  if (flags.stale || flags.stale_state === 'stale' || status === 'stale') {
    return 'stale';
  }
  if (status === 'approved' || gate === 'approved') {
    return 'approved';
  }
  if (status === 'submitted' || status === 'in_review' || gate === 'awaiting_review' || gate === 'review') {
    return 'needs-review';
  }
  return 'needs-authoring';
}

function sourceObjectHref(ref: QueueRef): string {
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
      return ref.development_plan_id === undefined
        ? '/specs-plans'
        : `/specs-plans?development_plan_id=${encodeURIComponent(ref.development_plan_id)}&development_plan_item_id=${encodeURIComponent(ref.id)}`;
    case 'execution_plan':
      return '/specs-plans';
    case 'release':
      return `/releases/${encodeURIComponent(ref.id)}`;
    default:
      return '/my-work';
  }
}

function sourceObjectLabel(ref: QueueRef) {
  return `${formatValue(ref.type)} ${ref.title ?? ref.id}`;
}

function revisionLabel(item: QueueItem) {
  return item.artifact_type === 'spec' ? 'Spec artifact' : 'Execution plan artifact';
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
