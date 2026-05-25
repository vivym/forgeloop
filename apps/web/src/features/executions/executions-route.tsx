import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import { createForgeloopCommandApi } from '../../shared/api/commands';
import { useExecutionsQuery } from '../../shared/api/hooks';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { Section, WorkspacePage } from '../../shared/layout';
import { Badge, Button, EmptyState, InlineNotice, StatusPill } from '../../shared/ui';
import { SurfaceStateIndicator, type SurfaceState } from '../project-management/surface-state';
import {
  executionSupervisionLanes,
  executionSupervisionRow,
  type ExecutionLaneId,
  type ExecutionProjection,
  type ExecutionSupervisionAction,
  type ExecutionSupervisionRow,
} from './execution-view-model';

export function ExecutionsRoute() {
  const { projectId } = useProjectContext();
  const { actorId } = useActorContext();
  const queryClient = useQueryClient();
  const query = useExecutionsQuery({ project_id: projectId, limit: 100 });
  const items = (query.data?.items ?? []) as unknown as ExecutionProjection[];
  const rows = useMemo(() => items.map(executionSupervisionRow), [items]);
  const degradedSources = Array.isArray(query.data?.degraded_sources) ? (query.data.degraded_sources as string[]) : [];
  const [message, setMessage] = useState<string>();
  const commandApi = createForgeloopCommandApi();

  async function refresh(executionId: string) {
    await queryClient.invalidateQueries({ queryKey: ['executions'] });
    await queryClient.invalidateQueries({ queryKey: ['execution', executionId] });
  }

  async function continueExecution(executionId: string) {
    await commandApi.continueExecution(executionId, { actor_id: actorId });
    setMessage('Execution continued.');
    await refresh(executionId);
  }

  async function interruptExecution(executionId: string) {
    await commandApi.interruptExecution(executionId, { actor_id: actorId });
    setMessage('Execution interrupted and resumable.');
    await refresh(executionId);
  }

  function retryExecution() {
    setMessage('Retry requested. Inspect execution evidence before restarting the worker.');
  }

  const focusedRow = rows[0];
  const pageState = query.isLoading
    ? 'Loading execution supervision'
    : query.isError
      ? 'Execution supervision unavailable'
      : focusedRow === undefined
        ? 'No execution supervision rows'
        : `Worker state ${focusedRow.workerState}; approved Execution Plan ${focusedRow.approvedExecutionPlanRevision}`;

  return (
    <WorkspacePage
      as="div"
      blockerRisk={executionRisk(rows, query.isError)}
      family="execution-list"
      heading="Executions"
      layout="supervision-lanes"
      nextAction={focusedRow === undefined ? 'Allowed action: wait for an approved Execution Plan to start' : `Allowed action: ${focusedRow.allowedAction.label}`}
      roleResponsibility={focusedRow === undefined ? 'Execution owner supervises Development Plan Item delivery.' : `Development Plan Item: ${focusedRow.developmentPlanItem}`}
      state={pageState}
      subtitle="Supervision lanes for workers started from approved Execution Plan revisions."
    >
      <SurfaceStateIndicator label="Executions Queue" state={executionsSurfaceState(query.isLoading, query.isError, rows, degradedSources)} />
      {message ? <InlineNotice title={message} tone="success" /> : null}
      {query.isLoading ? <InlineNotice title="Loading execution supervision lanes." tone="info" /> : null}
      {query.isError ? <InlineNotice title="Execution supervision data is temporarily unavailable." tone="danger" /> : null}
      {!query.isLoading && !query.isError ? (
        <SupervisionLanes
          onContinueExecution={continueExecution}
          onInterruptExecution={interruptExecution}
          onRetryExecution={retryExecution}
          rows={rows}
        />
      ) : null}
    </WorkspacePage>
  );
}

function SupervisionLanes({
  rows,
  onContinueExecution,
  onInterruptExecution,
  onRetryExecution,
}: {
  rows: ExecutionSupervisionRow[];
  onContinueExecution: (executionId: string) => Promise<void>;
  onInterruptExecution: (executionId: string) => Promise<void>;
  onRetryExecution: () => void;
}) {
  const grouped = groupRows(rows);

  if (rows.length === 0) {
    return <EmptyState description="Approved Execution Plans will appear here when execution starts." title="No executions yet." />;
  }

  return (
    <div className="grid gap-4">
      {executionSupervisionLanes.map((lane) => (
        <Section description={`${grouped[lane.id].length} execution${grouped[lane.id].length === 1 ? '' : 's'}.`} key={lane.id} title={lane.label} variant="panel">
          {grouped[lane.id].length ? (
            <div className="grid gap-2">
              {grouped[lane.id].map((row) => (
                <ExecutionRow
                  key={row.id}
                  onContinueExecution={onContinueExecution}
                  onInterruptExecution={onInterruptExecution}
                  onRetryExecution={onRetryExecution}
                  row={row}
                />
              ))}
            </div>
          ) : (
            <InlineNotice title={`No ${lane.label.toLowerCase()} executions.`} />
          )}
        </Section>
      ))}
    </div>
  );
}

function ExecutionRow({
  row,
  onContinueExecution,
  onInterruptExecution,
  onRetryExecution,
}: {
  row: ExecutionSupervisionRow;
  onContinueExecution: (executionId: string) => Promise<void>;
  onInterruptExecution: (executionId: string) => Promise<void>;
  onRetryExecution: () => void;
}) {
  return (
    <article className="grid gap-3 rounded-md border border-border bg-surface p-3" data-execution-supervision-row="">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="grid min-w-0 gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="m-0 min-w-0 text-sm font-semibold text-text-primary">{row.title}</h3>
            <StatusPill tone={row.statusTone}>{row.workerState}</StatusPill>
            <Badge tone="info">Approved Execution Plan</Badge>
          </div>
          <dl className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
            <Definition label="Execution Plan revision" value={row.approvedExecutionPlanRevision} />
            <Definition label="Development Plan Item" value={row.developmentPlanItem} />
            <Definition label="Worker state" value={row.workerState} />
            <Definition label="Current step" value={row.currentStep} />
            <Definition label="Last event" value={row.lastEvent} />
            <Definition label="PR, diff, and test evidence" value={row.evidenceSummary} />
            <Definition label="Allowed action" value={row.allowedAction.label} />
          </dl>
        </div>
        <div className="grid gap-2 sm:min-w-[13rem]">
          <ActionControl
            action={row.allowedAction}
            executionId={row.id}
            onContinueExecution={onContinueExecution}
            onInterruptExecution={onInterruptExecution}
            onRetryExecution={onRetryExecution}
          />
          <Link className="inline-flex min-h-9 items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-semibold text-primary hover:bg-surface-muted" to={row.href}>
            Inspect execution
          </Link>
        </div>
      </div>
      <div className="text-xs text-text-secondary">Compact metadata: {row.compactMetadata}</div>
      <DisabledReasons actions={row.actions} />
    </article>
  );
}

function ActionControl({
  action,
  executionId,
  onContinueExecution,
  onInterruptExecution,
  onRetryExecution,
}: {
  action: ExecutionSupervisionAction;
  executionId: string;
  onContinueExecution: (executionId: string) => Promise<void>;
  onInterruptExecution: (executionId: string) => Promise<void>;
  onRetryExecution: () => void;
}) {
  if (action.kind === 'inspect') {
    return (
      <Link className="inline-flex min-h-9 items-center justify-center rounded-md border border-primary bg-primary px-3 text-sm font-semibold text-white" to={action.href ?? `/executions/${executionId}`}>
        {action.label}
      </Link>
    );
  }

  const onClick = action.kind === 'continue'
    ? () => void onContinueExecution(executionId)
    : action.kind === 'interrupt'
      ? () => void onInterruptExecution(executionId)
      : onRetryExecution;

  return (
    <Button disabled={!action.enabled} onClick={onClick} type="button" variant={action.kind === 'retry' ? 'danger' : 'primary'}>
      {action.label}
    </Button>
  );
}

function DisabledReasons({ actions }: { actions: readonly ExecutionSupervisionAction[] }) {
  const reasons = actions.map((action) => action.disabledReason).filter((reason): reason is string => reason !== undefined);
  if (reasons.length === 0) return null;
  return <div className="text-xs text-text-secondary">{reasons.join(' ')}</div>;
}

function groupRows(rows: ExecutionSupervisionRow[]): Record<ExecutionLaneId, ExecutionSupervisionRow[]> {
  return rows.reduce<Record<ExecutionLaneId, ExecutionSupervisionRow[]>>(
    (grouped, row) => {
      grouped[row.laneId].push(row);
      return grouped;
    },
    {
      active: [],
      resumable: [],
      'review-pending': [],
      'failed-blocked': [],
      'completed-recent': [],
    },
  );
}

function executionsSurfaceState(isLoading: boolean, isError: boolean, rows: ExecutionSupervisionRow[], degradedSources: string[]): SurfaceState | undefined {
  if (isLoading) return 'loading';
  if (isError) return 'error';
  if (rows.length === 0) return 'empty';
  const text = `${degradedSources.join(' ')} ${rows.map((row) => `${row.laneId} ${row.workerState}`).join(' ')}`.toLowerCase();
  if (text.includes('stale')) return 'stale';
  if (text.includes('blocked') || text.includes('failed')) return 'blocked';
  if (text.includes('resumable')) return 'resumable';
  if (text.includes('running') || text.includes('active')) return 'running';
  if (text.includes('completed')) return 'approved';
  return undefined;
}

function executionRisk(rows: ExecutionSupervisionRow[], isError: boolean): string {
  if (isError) return 'Execution supervision could not be loaded.';
  if (rows.some((row) => row.laneId === 'failed-blocked')) return 'Failed or blocked executions need retry review.';
  if (rows.some((row) => row.laneId === 'resumable')) return 'Resumable executions are paused until continued.';
  return 'No blocker: execution supervision lanes expose worker state, current step, and evidence.';
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1 rounded-md border border-border bg-background p-2">
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className="truncate font-semibold text-text-primary">{value}</dd>
    </div>
  );
}
