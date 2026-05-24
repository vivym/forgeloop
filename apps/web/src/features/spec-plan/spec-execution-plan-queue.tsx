import { Link, useSearchParams } from 'react-router';

import { useSpecExecutionPlanQueueQuery } from '../../shared/api/hooks';
import { useProjectContext } from '../../shared/context/project-context';
import { InlineActions, PageHeader, Section } from '../../shared/layout';
import { Badge, EmptyState, InlineNotice, StatusPill } from '../../shared/ui';
import { SurfaceStateIndicator, type SurfaceState } from '../project-management/surface-state';

type QueueArtifactType = 'spec' | 'execution_plan';
type QueueGroupId =
  | 'spec-needs-generation'
  | 'spec-needs-review'
  | 'spec-approved'
  | 'execution-plan-needs-generation'
  | 'execution-plan-needs-review'
  | 'execution-plan-approved'
  | 'stale'
  | 'blocked';
type QueueRef = { type: string; id: string; title?: string; development_plan_id?: string };
type QueueItem = {
  id: string;
  title: string;
  artifact_type: QueueArtifactType;
  status?: string;
  gate_state?: string;
  stale?: boolean;
  blocked?: boolean;
  reviewer_actor_id?: string;
  age_label?: string;
  risk?: string;
  next_action?: string;
  source_ref?: QueueRef;
  development_plan_item_ref?: QueueRef;
};

const groups: Array<{ id: QueueGroupId; label: string }> = [
  { id: 'spec-needs-generation', label: 'Spec needs generation' },
  { id: 'spec-needs-review', label: 'Spec needs review' },
  { id: 'spec-approved', label: 'Spec approved' },
  { id: 'execution-plan-needs-generation', label: 'Execution Plan needs generation' },
  { id: 'execution-plan-needs-review', label: 'Execution Plan needs review' },
  { id: 'execution-plan-approved', label: 'Execution Plan approved' },
  { id: 'stale', label: 'Stale' },
  { id: 'blocked', label: 'Blocked' },
];

const selectedSegmentClass =
  'inline-flex min-h-9 items-center justify-center rounded-md border border-primary bg-primary px-3 text-sm font-semibold text-white transition-colors duration-base ease-standard';
const unselectedSegmentClass =
  'inline-flex min-h-9 items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-semibold text-text-primary transition-colors duration-base ease-standard hover:border-border-strong hover:bg-surface-muted';

export function SpecExecutionPlanQueue() {
  const { projectId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'plans' ? 'plans' : 'specs';
  const focusedDevelopmentPlanId = searchParams.get('development_plan_id');
  const focusedDevelopmentPlanItemId = searchParams.get('development_plan_item_id');
  const query = useSpecExecutionPlanQueueQuery({ project_id: projectId, limit: 100 });
  const items = ((query.data?.items ?? []) as QueueItem[])
    .filter((item) => (activeTab === 'specs' ? item.artifact_type === 'spec' : item.artifact_type === 'execution_plan'))
    .filter((item) => isFocusedQueueItem(item, focusedDevelopmentPlanId, focusedDevelopmentPlanItemId));
  const degradedSources = Array.isArray(query.data?.degraded_sources) ? (query.data.degraded_sources as string[]) : [];

  return (
    <div className="grid gap-6">
      <PageHeader
        subtitle="Governance queue for item-scoped Spec and Execution Plan documents."
        title="Specs & Execution Plans"
      />
      <SurfaceStateIndicator label="Specs & Execution Plans Queue" state={queueSurfaceState(query.isLoading, query.isError, items, degradedSources)} />
      <Section title="Governance queue">
        <InlineActions aria-label="Specs and Execution Plans tabs" role="tablist">
          <Link aria-selected={activeTab === 'specs'} className={activeTab === 'specs' ? selectedSegmentClass : unselectedSegmentClass} role="tab" to={tabHref('specs', focusedDevelopmentPlanId, focusedDevelopmentPlanItemId)}>
            Specs
          </Link>
          <Link aria-selected={activeTab === 'plans'} className={activeTab === 'plans' ? selectedSegmentClass : unselectedSegmentClass} role="tab" to={tabHref('plans', focusedDevelopmentPlanId, focusedDevelopmentPlanItemId)}>
            Execution Plans
          </Link>
        </InlineActions>
        {query.isLoading ? <InlineNotice title="Loading Specs & Execution Plans queue." tone="info" /> : null}
        {query.isError ? <InlineNotice title="Specs & Execution Plans queue data is temporarily unavailable." tone="danger" /> : null}
        {focusedDevelopmentPlanId !== null || focusedDevelopmentPlanItemId !== null ? (
          <InlineNotice
            description={queueFocusDescription(focusedDevelopmentPlanId, focusedDevelopmentPlanItemId)}
            title="Focused governance queue"
            tone="info"
          />
        ) : null}
      </Section>
      {!query.isError ? <GroupedQueue isLoading={query.isLoading} items={items} /> : null}
    </div>
  );
}

function tabHref(tab: 'specs' | 'plans', developmentPlanId: string | null, developmentPlanItemId: string | null): string {
  const params = new URLSearchParams({ tab });
  if (developmentPlanId !== null) params.set('development_plan_id', developmentPlanId);
  if (developmentPlanItemId !== null) params.set('development_plan_item_id', developmentPlanItemId);
  return `/specs-plans?${params.toString()}`;
}

function GroupedQueue({ isLoading, items }: { isLoading?: boolean; items: QueueItem[] }) {
  const groupedItems = groupItems(items);

  return (
    <div className="grid gap-4">
      {items.length === 0 && isLoading !== true ? (
        <EmptyState description="No Spec or Execution Plan rows currently need governance action." title="No governance rows." />
      ) : null}
      {groups.map((group) => (
        <Section
          description={`${groupedItems[group.id].length} row${groupedItems[group.id].length === 1 ? '' : 's'}.`}
          key={group.id}
          title={group.label}
        >
          {isLoading === true ? (
            <InlineNotice title={`Loading ${group.label.toLowerCase()} rows.`} tone="info" />
          ) : groupedItems[group.id].length ? (
            <div className="grid gap-3">
              {groupedItems[group.id].map((item) => (
                <QueueItemCard item={item} key={item.id} />
              ))}
            </div>
          ) : (
            <InlineNotice title={`No ${group.label.toLowerCase()} rows.`} />
          )}
        </Section>
      ))}
    </div>
  );
}

function QueueItemCard({ item }: { item: QueueItem }) {
  const detailHref = queueItemHref(item);

  return (
    <article className="grid gap-3 rounded-card border border-border bg-surface p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid min-w-0 gap-2">
          <h3 className="text-base font-semibold text-text-primary">{item.title}</h3>
          <div className="flex flex-wrap gap-2">
            <Badge tone="info">{item.artifact_type === 'spec' ? 'Spec' : 'Execution Plan'}</Badge>
            <StatusPill tone={statusTone(item.status)}>{formatValue(item.status)}</StatusPill>
            {item.blocked ? <Badge tone="warning">Blocked</Badge> : null}
            {item.stale ? <Badge tone="warning">Stale</Badge> : null}
          </div>
        </div>
        <Link className={unselectedSegmentClass} to={detailHref}>
          Open plan item
        </Link>
      </div>
      <dl className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
        <Definition label="Source object" value={item.source_ref?.title ?? item.source_ref?.id ?? 'Not linked'} />
        <Definition label="Development Plan Item" value={item.development_plan_item_ref?.title ?? item.development_plan_item_ref?.id ?? 'Not linked'} />
        <Definition label="Reviewer" value={item.reviewer_actor_id ?? 'Unassigned'} />
        <Definition label="Age" value={item.age_label ?? 'Not recorded'} />
        <Definition label="Risk" value={formatValue(item.risk)} />
        <Definition label="Next action" value={item.next_action ?? 'Review queue state'} />
      </dl>
    </article>
  );
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-md border border-border bg-background p-3">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="font-semibold text-text-primary">{value}</dd>
    </div>
  );
}

function groupItems(items: QueueItem[]): Record<QueueGroupId, QueueItem[]> {
  const grouped: Record<QueueGroupId, QueueItem[]> = {
    'spec-needs-generation': [],
    'spec-needs-review': [],
    'spec-approved': [],
    'execution-plan-needs-generation': [],
    'execution-plan-needs-review': [],
    'execution-plan-approved': [],
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
  const gateState = item.gate_state?.toLowerCase();
  if (item.blocked || status === 'blocked' || gateState === 'blocked') return 'blocked';
  if (item.stale || status === 'stale' || gateState === 'stale') return 'stale';
  if (item.artifact_type === 'spec') {
    if (status === 'approved' || gateState === 'approved') return 'spec-approved';
    if (status === 'in_review' || status === 'submitted' || gateState === 'awaiting_review') return 'spec-needs-review';
    return 'spec-needs-generation';
  }
  if (status === 'approved' || gateState === 'approved') return 'execution-plan-approved';
  if (status === 'in_review' || status === 'submitted' || gateState === 'awaiting_review') return 'execution-plan-needs-review';
  return 'execution-plan-needs-generation';
}

function queueItemHref(item: QueueItem): string {
  const planId = item.development_plan_item_ref?.development_plan_id;
  const itemId = item.development_plan_item_ref?.id;
  const suffix = item.artifact_type === 'spec' ? 'spec' : 'execution-plan';
  if (planId !== undefined && itemId !== undefined) {
    return `/development-plans/${encodeURIComponent(planId)}/items/${encodeURIComponent(itemId)}/${suffix}`;
  }
  return `/specs-plans?tab=${item.artifact_type === 'spec' ? 'specs' : 'plans'}`;
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

function queueSurfaceState(isLoading: boolean, isError: boolean, items: QueueItem[], degradedSources: string[]): SurfaceState | undefined {
  if (isLoading) return 'loading';
  if (isError) return 'error';
  if (items.length === 0) return 'empty';
  const text = `${degradedSources.join(' ')} ${items.map((item) => `${item.status ?? ''} ${item.gate_state ?? ''}`).join(' ')}`.toLowerCase();
  if (text.includes('stale')) return 'stale';
  if (items.some((item) => item.blocked) || text.includes('blocked')) return 'blocked';
  if (text.includes('interrupted') || text.includes('resumable')) return 'resumable';
  if (text.includes('running')) return 'running';
  if (text.includes('approved')) return 'approved';
  return undefined;
}

function statusTone(status: string | undefined): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'approved' || status === 'accepted' || status === 'completed') return 'success';
  if (status === 'blocked' || status === 'failed' || status === 'rejected') return 'danger';
  if (status === 'in_review' || status === 'submitted' || status === 'running') return 'info';
  if (status === 'stale' || status === 'changes_requested' || status === 'interrupted') return 'warning';
  return 'neutral';
}

function formatValue(value: string | undefined): string {
  return value === undefined ? 'Not recorded' : value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}
