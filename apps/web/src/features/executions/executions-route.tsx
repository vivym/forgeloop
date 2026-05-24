import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import { createForgeloopCommandApi } from '../../shared/api/commands';
import { useExecutionsQuery } from '../../shared/api/hooks';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { PageHeader, Section } from '../../shared/layout';
import { Badge, Button, EmptyState, InlineNotice, StatusPill } from '../../shared/ui';
import { SurfaceStateIndicator, type SurfaceState } from '../project-management/surface-state';

type ExecutionQueueItem = {
  id: string;
  title?: string;
  status?: string;
  worker_state?: string;
  current_step?: string;
  last_event_at?: string;
  href?: string;
  blocked?: boolean;
  stale?: boolean;
  execution_plan_revision_ref?: { id?: string; title?: string };
  development_plan_item_ref?: { id?: string; title?: string; development_plan_id?: string };
  pr_refs?: Array<{ id?: string; title?: string }>;
  diff_refs?: Array<{ id?: string; title?: string }>;
  test_evidence_refs?: Array<{ id?: string; title?: string }>;
};
type ExecutionGroupId = 'active' | 'resumable' | 'failed' | 'awaiting-code-review' | 'qa-handoff-pending';

const groups: Array<{ id: ExecutionGroupId; label: string }> = [
  { id: 'active', label: 'Active' },
  { id: 'resumable', label: 'Resumable' },
  { id: 'failed', label: 'Failed' },
  { id: 'awaiting-code-review', label: 'Awaiting code review' },
  { id: 'qa-handoff-pending', label: 'QA handoff pending' },
];

export function ExecutionsRoute() {
  const { projectId } = useProjectContext();
  const { actorId } = useActorContext();
  const queryClient = useQueryClient();
  const query = useExecutionsQuery({ project_id: projectId, limit: 100 });
  const items = (query.data?.items ?? []) as ExecutionQueueItem[];
  const degradedSources = Array.isArray(query.data?.degraded_sources) ? (query.data.degraded_sources as string[]) : [];
  const [message, setMessage] = useState<string>();
  const commandApi = createForgeloopCommandApi();

  async function continueExecution(executionId: string) {
    await commandApi.continueExecution(executionId, { actor_id: actorId });
    setMessage('Execution continued.');
    await queryClient.invalidateQueries({ queryKey: ['executions'] });
    await queryClient.invalidateQueries({ queryKey: ['execution', executionId] });
  }

  return (
    <div className="grid gap-6">
      <PageHeader subtitle="Product execution supervision from approved Execution Plan revisions." title="Executions" />
      <SurfaceStateIndicator label="Executions Queue" state={executionsSurfaceState(query.isLoading, query.isError, items, degradedSources)} />
      {message ? <InlineNotice title={message} tone="success" /> : null}
      {query.isLoading ? <InlineNotice title="Loading executions queue." tone="info" /> : null}
      {query.isError ? <InlineNotice title="Executions queue data is temporarily unavailable." tone="danger" /> : null}
      {!query.isLoading && !query.isError ? <GroupedExecutions items={items} onContinueExecution={continueExecution} /> : null}
    </div>
  );
}

function GroupedExecutions({
  items,
  onContinueExecution,
}: {
  items: ExecutionQueueItem[];
  onContinueExecution: (executionId: string) => Promise<void>;
}) {
  const grouped = groupItems(items);

  if (items.length === 0) {
    return <EmptyState description="Approved Execution Plans will appear here when execution starts." title="No executions yet." />;
  }

  return (
    <div className="grid gap-4">
      {groups.map((group) => (
        <Section description={`${grouped[group.id].length} execution${grouped[group.id].length === 1 ? '' : 's'}.`} key={group.id} title={group.label}>
          {grouped[group.id].length ? (
            <div className="grid gap-3">
              {grouped[group.id].map((item) => (
                <ExecutionCard item={item} key={item.id} onContinueExecution={onContinueExecution} />
              ))}
            </div>
          ) : (
            <InlineNotice title={`No ${group.label.toLowerCase()} executions.`} />
          )}
        </Section>
      ))}
    </div>
  );
}

function ExecutionCard({
  item,
  onContinueExecution,
}: {
  item: ExecutionQueueItem;
  onContinueExecution: (executionId: string) => Promise<void>;
}) {
  const href = item.href ?? `/executions/${item.id}`;
  const resumable = isResumable(item);

  return (
    <article className="grid gap-3 rounded-card border border-border bg-surface p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid min-w-0 gap-2">
          <h3 className="text-base font-semibold text-text-primary">{item.title ?? `Execution ${item.id}`}</h3>
          <div className="flex flex-wrap gap-2">
            <StatusPill tone={statusTone(item.status)}>{formatValue(item.status)}</StatusPill>
            <Badge tone="info">Approved Execution Plan</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {resumable ? (
            <Button onClick={() => void onContinueExecution(item.id)} type="button" variant="secondary">
              Continue execution
            </Button>
          ) : null}
          <Link className="inline-flex min-h-9 items-center rounded-md border border-border bg-surface px-3 text-sm font-semibold text-primary hover:bg-surface-muted" to={href}>
            Inspect execution
          </Link>
        </div>
      </div>
      <dl className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
        <Definition label="Execution Plan revision" value={item.execution_plan_revision_ref?.title ?? item.execution_plan_revision_ref?.id ?? 'Not linked'} />
        <Definition label="Worker state" value={formatValue(item.worker_state ?? item.status)} />
        <Definition label="Current step" value={item.current_step ?? 'Awaiting event'} />
        <Definition label="Last event" value={formatDate(item.last_event_at)} />
        <Definition label="PR, diff, and test evidence" value={evidenceSummary(item)} />
        <Definition label="Development Plan Item" value={item.development_plan_item_ref?.title ?? item.development_plan_item_ref?.id ?? 'Not linked'} />
      </dl>
    </article>
  );
}

function groupItems(items: ExecutionQueueItem[]): Record<ExecutionGroupId, ExecutionQueueItem[]> {
  const grouped: Record<ExecutionGroupId, ExecutionQueueItem[]> = {
    active: [],
    resumable: [],
    failed: [],
    'awaiting-code-review': [],
    'qa-handoff-pending': [],
  };
  for (const item of items) grouped[groupForItem(item)].push(item);
  return grouped;
}

function groupForItem(item: ExecutionQueueItem): ExecutionGroupId {
  const status = item.status?.toLowerCase();
  if (isResumable(item)) return 'resumable';
  if (status === 'failed' || status === 'blocked') return 'failed';
  if (status === 'completed' || status === 'awaiting_code_review') return 'awaiting-code-review';
  if (status === 'qa_pending' || status === 'qa_handoff_pending') return 'qa-handoff-pending';
  return 'active';
}

function isResumable(item: ExecutionQueueItem): boolean {
  const text = `${item.status ?? ''} ${item.worker_state ?? ''}`.toLowerCase();
  return text.includes('interrupted') || text.includes('resumable') || text.includes('paused');
}

function executionsSurfaceState(isLoading: boolean, isError: boolean, items: ExecutionQueueItem[], degradedSources: string[]): SurfaceState | undefined {
  if (isLoading) return 'loading';
  if (isError) return 'error';
  if (items.length === 0) return 'empty';
  const text = `${degradedSources.join(' ')} ${items.map((item) => `${item.status ?? ''} ${item.worker_state ?? ''}`).join(' ')}`.toLowerCase();
  if (text.includes('stale')) return 'stale';
  if (items.some((item) => item.blocked) || text.includes('blocked') || text.includes('failed')) return 'blocked';
  if (text.includes('interrupted') || text.includes('resumable')) return 'resumable';
  if (text.includes('running') || text.includes('active')) return 'running';
  if (text.includes('approved') || text.includes('completed')) return 'approved';
  return undefined;
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-md border border-border bg-background p-3">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="font-semibold text-text-primary">{value}</dd>
    </div>
  );
}

function evidenceSummary(item: ExecutionQueueItem): string {
  const evidence = [...(item.pr_refs ?? []), ...(item.diff_refs ?? []), ...(item.test_evidence_refs ?? [])];
  return evidence.map((ref) => ref.title ?? ref.id).filter(Boolean).join(', ') || 'Not recorded';
}

function formatDate(value: string | undefined): string {
  if (value === undefined) return 'Not recorded';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function formatValue(value: string | undefined): string {
  return value === undefined ? 'Not recorded' : value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

function statusTone(status: string | undefined): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'completed' || status === 'accepted') return 'success';
  if (status === 'failed' || status === 'blocked') return 'danger';
  if (status === 'interrupted' || status === 'resumable') return 'warning';
  if (status === 'running' || status === 'active') return 'info';
  return 'neutral';
}
