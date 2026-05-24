import { useState } from 'react';
import { useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import { createForgeloopCommandApi } from '../../shared/api/commands';
import { useCodeReviewHandoffsQuery, useExecutionQuery, useQaHandoffsQuery } from '../../shared/api/hooks';
import { queryKeys } from '../../shared/api/query-keys';
import type { ProductObjectRef } from '../../shared/api/types';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { PageHeader, Section } from '../../shared/layout';
import { Button, InlineNotice, StatusPill } from '../../shared/ui';
import { CodeReviewHandoffPanel, type CodeReviewHandoffProjection } from '../code-review/code-review-handoff-panel';
import { SurfaceStateIndicator, type SurfaceState } from '../project-management/surface-state';
import { QaHandoffPanel, type QaHandoffProjection } from '../qa/qa-handoff-panel';

type ProductRef = ProductObjectRef;
type RuntimeEvidenceRef = { type: string; id: string; title?: string };
type ExecutionDetail = {
  id: string;
  ref?: ProductRef;
  title?: string;
  status?: string;
  worker_state?: string;
  current_step?: string;
  stale?: boolean;
  blocked?: boolean;
  interrupt_history?: Array<{ at?: string; reason?: string }>;
  continuation_history?: Array<{ at?: string; summary?: string }>;
  source_ref?: ProductRef;
  development_plan_item_id?: string;
  development_plan_item_ref?: ProductRef;
  execution_plan_revision_id?: string;
  execution_plan_revision_ref?: ProductRef;
  evidence_refs?: ProductRef[];
  runtime_evidence_refs?: RuntimeEvidenceRef[];
};

export function ExecutionDetailRoute() {
  const { executionId } = useParams();
  const { projectId } = useProjectContext();
  const { actorId } = useActorContext();
  const queryClient = useQueryClient();
  const executionQuery = useExecutionQuery(executionId);
  const handoffQuery = { project_id: projectId, ...(executionId === undefined ? {} : { execution_id: executionId }), limit: 100 };
  const reviewQuery = useCodeReviewHandoffsQuery(handoffQuery);
  const qaQuery = useQaHandoffsQuery(handoffQuery);
  const executionCandidate = executionQuery.data as ExecutionDetail | undefined;
  const execution = executionCandidate?.id === undefined ? undefined : executionCandidate;
  const codeReview = ((reviewQuery.data?.items ?? []) as CodeReviewHandoffProjection[]).find((handoff) => handoff.execution_id === executionId);
  const qaHandoff = ((qaQuery.data?.items ?? []) as QaHandoffProjection[]).find((handoff) => handoff.execution_id === executionId);
  const canInterruptExecution = execution === undefined ? false : canInterrupt(execution);
  const canContinueExecution = execution === undefined ? false : canContinue(execution);
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

  return (
    <div className="grid gap-6">
      <PageHeader
        subtitle="Supervise progress from the approved Execution Plan revision through review and QA."
        title="Execution"
      />
      <SurfaceStateIndicator label="Execution Detail" state={executionSurfaceState(executionQuery.isLoading, executionQuery.isError, execution)} />
      {message ? <InlineNotice title={message} tone="success" /> : null}
      {executionQuery.isError ? <InlineNotice title="Execution detail could not be loaded." tone="danger" /> : null}
      {execution === undefined && !executionQuery.isLoading ? <InlineNotice title="Execution not found." tone="warning" /> : null}
      {execution ? (
        <>
          <Section
            actions={<StatusPill tone={execution.status === 'completed' ? 'success' : 'info'}>{execution.status ?? 'not started'}</StatusPill>}
            title={execution.ref?.title ?? execution.title ?? 'Execution'}
          >
            <div className="grid gap-4">
              <dl className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
                <Definition label="Approved Execution Plan revision" value={execution.execution_plan_revision_ref?.title ?? execution.execution_plan_revision_id ?? 'Not linked'} />
                <Definition label="Worker state" value={formatValue(execution.worker_state ?? execution.status)} />
                <Definition label="Current step" value={execution.current_step ?? 'Awaiting event'} />
                <Definition label="Progress" value={execution.status === 'running' ? 'Running with live supervision available.' : formatValue(execution.status)} />
                <Definition label="Interrupt history" value={(execution.interrupt_history ?? []).map((entry) => entry.reason ?? entry.at).join(', ') || 'None recorded'} />
                <Definition label="Continue history" value={(execution.continuation_history ?? []).map((entry) => entry.summary ?? entry.at).join(', ') || 'None recorded'} />
              </dl>
              <div className="flex flex-wrap gap-2">
                {canInterruptExecution ? <Button onClick={() => void interrupt()} type="button" variant="secondary">Interrupt execution</Button> : null}
                {canContinueExecution ? <Button onClick={() => void continueExecution()} type="button">Continue execution</Button> : null}
              </div>
            </div>
          </Section>
          <CodeReviewHandoffPanel execution={execution} handoff={codeReview} />
          <QaHandoffPanel codeReview={codeReview} execution={execution} handoff={qaHandoff} />
        </>
      ) : null}
    </div>
  );
}

function canInterrupt(execution: ExecutionDetail): boolean {
  const text = `${execution.status ?? ''} ${execution.worker_state ?? ''}`.toLowerCase();
  return text.includes('running') || text.includes('active');
}

function canContinue(execution: ExecutionDetail): boolean {
  const text = `${execution.status ?? ''} ${execution.worker_state ?? ''}`.toLowerCase();
  return text.includes('interrupted') || text.includes('resumable') || text.includes('paused');
}

function executionSurfaceState(isLoading: boolean, isError: boolean, execution: ExecutionDetail | undefined): SurfaceState | undefined {
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
    <div className="grid gap-1 rounded-md border border-border bg-background p-3">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="font-semibold text-text-primary">{value}</dd>
    </div>
  );
}

function formatValue(value: string | undefined): string {
  return value === undefined ? 'Not recorded' : value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}
