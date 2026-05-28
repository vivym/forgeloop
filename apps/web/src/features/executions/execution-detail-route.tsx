import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import { createForgeloopCommandApi } from '../../shared/api/commands';
import { useCodeReviewHandoffsQuery, useExecutionQuery, useQaHandoffsQuery } from '../../shared/api/hooks';
import { queryKeys } from '../../shared/api/query-keys';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { ExecutionSupervisionLayout, ProductPage, Section } from '../../shared/layout';
import { Button, EmptyState, InlineNotice, StatusPill } from '../../shared/ui';
import { CodeReviewHandoffPanel, type CodeReviewHandoffProjection } from '../code-review/code-review-handoff-panel';
import { SurfaceStateIndicator, type SurfaceState } from '../project-management/surface-state';
import { QaHandoffPanel, type QaHandoffProjection } from '../qa/qa-handoff-panel';
import {
  executionSupervisionDetail,
  type ExecutionProjection,
  type ExecutionSupervisionAction,
  type ExecutionSupervisionDetail,
} from './execution-view-model';

export function ExecutionDetailRoute() {
  const { executionId } = useParams();
  const { projectId } = useProjectContext();
  const { actorId } = useActorContext();
  const queryClient = useQueryClient();
  const executionQuery = useExecutionQuery(executionId);
  const handoffQuery = { project_id: projectId, ...(executionId === undefined ? {} : { execution_id: executionId }), limit: 100 };
  const reviewQuery = useCodeReviewHandoffsQuery(handoffQuery);
  const qaQuery = useQaHandoffsQuery(handoffQuery);
  const executionCandidate = executionQuery.data as ExecutionProjection | undefined;
  const execution = executionCandidate?.id === undefined ? undefined : executionCandidate;
  const viewModel = execution === undefined ? undefined : executionSupervisionDetail(execution);
  const codeReview = ((reviewQuery.data?.items ?? []) as CodeReviewHandoffProjection[]).find((handoff) => handoff.execution_id === executionId);
  const qaHandoff = ((qaQuery.data?.items ?? []) as QaHandoffProjection[]).find((handoff) => handoff.execution_id === executionId);
  const [message, setMessage] = useState<string>();
  const commandApi = createForgeloopCommandApi();

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.execution(executionId) }),
      queryClient.invalidateQueries({ queryKey: ['executions'] }),
      queryClient.invalidateQueries({ queryKey: ['code-review-handoffs'] }),
      queryClient.invalidateQueries({ queryKey: ['qa-handoffs'] }),
    ]);
  }

  async function interrupt() {
    if (executionId === undefined) return;
    await commandApi.interruptExecution(executionId, { actor_id: actorId });
    setMessage('Execution interrupted and resumable.');
    await refresh();
  }

  async function continueExecution() {
    if (executionId === undefined) return;
    await commandApi.continueExecution(executionId, { actor_id: actorId });
    setMessage('Execution continued.');
    await refresh();
  }

  function retryExecution() {
    setMessage('Retry requested. Inspect execution evidence before restarting the worker.');
  }
  const routeState = (
    <div className="grid gap-3">
      <SurfaceStateIndicator label="Execution Detail" state={executionSurfaceState(executionQuery.isLoading, executionQuery.isError, execution)} />
      {message ? <InlineNotice title={message} tone="success" /> : null}
      {executionQuery.isError ? <InlineNotice title="Execution detail could not be loaded." tone="danger" /> : null}
      {execution === undefined && !executionQuery.isLoading ? <InlineNotice title="Execution not found." tone="warning" /> : null}
    </div>
  );

  return (
    <ProductPage family="execution-supervision" ariaLabel={viewModel?.title ?? 'Execution supervision'}>
      <h1 className="mb-3 text-xl font-semibold text-text-primary">{viewModel?.title ?? 'Execution supervision'}</h1>
      <div className="sr-only">
        {[
          viewModel === undefined
            ? 'Execution supervision cannot be evaluated until detail data loads.'
            : `${viewModel.riskSignal} Current step: ${viewModel.currentStep}. Last meaningful event: ${viewModel.lastMeaningfulEvent}. PR, diff, and test evidence: ${viewModel.evidenceSummary}.`,
          viewModel?.nextAction ?? 'Allowed action: load execution supervision',
          viewModel?.primaryActorOrRole ?? 'Linked Plan Item unavailable',
          viewModel?.currentState ?? (executionQuery.isLoading ? 'Loading execution supervision' : 'Execution supervision unavailable'),
        ].join(' ')}
      </div>
      {execution !== undefined && viewModel !== undefined ? (
        <ExecutionSupervisionLayout
          controls={
            <WorkerControls
              onContinueExecution={continueExecution}
              onInterruptExecution={interrupt}
              onRetryExecution={retryExecution}
              viewModel={viewModel}
            />
          }
          evidence={
            <div className="grid gap-3">
              {routeState}
              <ExecutionEvidence viewModel={viewModel} />
            </div>
          }
          lanes={<ExecutionHandoffLanes codeReview={codeReview} execution={execution} qaHandoff={qaHandoff} />}
          primarySurface="evidence"
        />
      ) : (
        <ExecutionSupervisionLayout
          evidence={routeState}
          lanes={<EmptyState description="Execution handoff lanes appear after execution detail data loads." title="No execution detail loaded." />}
          primarySurface="evidence"
        />
      )}
    </ProductPage>
  );
}

function ExecutionEvidence({
  viewModel,
}: {
  viewModel: ExecutionSupervisionDetail;
}) {
  return (
    <Section actions={<StatusPill tone={viewModel.statusTone}>{viewModel.status}</StatusPill>} title="Execution evidence" variant="panel">
      <div className="grid gap-4">
        <dl className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
          <Definition label="Approved Execution Plan revision" value={viewModel.approvedExecutionPlanRevision} />
          <Definition label="Linked Plan Item" value={viewModel.developmentPlanItem} />
          <Definition label="Worker state" value={viewModel.workerState} />
          <Definition label="Current step" value={viewModel.currentStep} />
          <Definition label="Last meaningful event" value={viewModel.lastMeaningfulEvent} />
          <Definition label="PR, diff, and test evidence" value={viewModel.evidenceSummary} />
          <Definition label="Interrupt history" value={viewModel.interruptHistory} />
          <Definition label="Continue history" value={viewModel.continueHistory} />
        </dl>
        <div className="text-xs text-text-secondary">Compact metadata: {viewModel.compactMetadata}</div>
      </div>
    </Section>
  );
}

function ExecutionHandoffLanes({
  codeReview,
  execution,
  qaHandoff,
}: {
  codeReview: CodeReviewHandoffProjection | undefined;
  execution: ExecutionProjection;
  qaHandoff: QaHandoffProjection | undefined;
}) {
  return (
    <div className="grid gap-4">
      <CodeReviewHandoffPanel execution={execution} handoff={codeReview} />
      <QaHandoffPanel codeReview={codeReview} execution={execution} handoff={qaHandoff} />
    </div>
  );
}

function WorkerControls({
  viewModel,
  onInterruptExecution,
  onContinueExecution,
  onRetryExecution,
}: {
  viewModel: ExecutionSupervisionDetail;
  onInterruptExecution: () => Promise<void>;
  onContinueExecution: () => Promise<void>;
  onRetryExecution: () => void;
}) {
  return (
    <div className="grid max-w-xl gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {viewModel.actions.map((action) => (
          <DetailAction
            action={action}
            key={action.id}
            onContinueExecution={onContinueExecution}
            onInterruptExecution={onInterruptExecution}
            onRetryExecution={onRetryExecution}
          />
        ))}
      </div>
      <DisabledReasons actions={viewModel.actions} />
    </div>
  );
}

function DetailAction({
  action,
  onInterruptExecution,
  onContinueExecution,
  onRetryExecution,
}: {
  action: ExecutionSupervisionAction;
  onInterruptExecution: () => Promise<void>;
  onContinueExecution: () => Promise<void>;
  onRetryExecution: () => void;
}) {
  if (action.kind === 'inspect') {
    return (
      <Link className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-semibold text-primary hover:bg-surface-muted" to={action.href ?? '#'}>
        Inspect execution
      </Link>
    );
  }

  const onClick = action.kind === 'interrupt'
    ? () => void onInterruptExecution()
    : action.kind === 'continue'
      ? () => void onContinueExecution()
      : onRetryExecution;

  return (
    <Button disabled={!action.enabled} onClick={onClick} type="button" variant={action.kind === 'retry' ? 'danger' : action.kind === 'interrupt' ? 'secondary' : 'primary'}>
      {action.label}
    </Button>
  );
}

function DisabledReasons({ actions }: { actions: readonly ExecutionSupervisionAction[] }) {
  const reasons = actions.map((action) => action.disabledReason).filter((reason): reason is string => reason !== undefined);
  if (reasons.length === 0) return null;
  return <InlineNotice description={reasons.join(' ')} title="Disabled reasons" tone="info" />;
}

function executionSurfaceState(isLoading: boolean, isError: boolean, execution: ExecutionProjection | undefined): SurfaceState | undefined {
  if (isLoading) return 'loading';
  if (isError) return 'error';
  if (execution?.id === undefined) return 'empty';
  if (execution.stale === true) return 'stale';
  if (execution.blocked === true) return 'blocked';
  const text = `${execution.status ?? ''} ${execution.worker_state ?? ''}`.toLowerCase();
  if (text.includes('stale')) return 'stale';
  if (text.includes('blocked') || text.includes('failed')) return 'blocked';
  if (text.includes('interrupted') || text.includes('resumable')) return 'resumable';
  if (text.includes('running') || text.includes('active')) return 'running';
  if (text.includes('approved') || text.includes('completed')) return 'approved';
  return undefined;
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1 rounded-md border border-border bg-background p-3">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="break-words font-semibold text-text-primary">{value}</dd>
    </div>
  );
}
