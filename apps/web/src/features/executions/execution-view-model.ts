import type { ProductPageViewModel, ViewModelEvidence } from '../product-surfaces/view-model-types';

type EvidenceRef = { id?: string; title?: string };

interface ExecutionProjection {
  id: string;
  title?: string;
  ref?: { title?: string };
  status?: string;
  worker_state?: string;
  current_step?: string;
  updated_at?: string;
  development_plan_item_ref?: { id?: string; title?: string; development_plan_id?: string };
  execution_plan_revision_ref?: { id?: string; title?: string };
  evidence_refs?: readonly EvidenceRef[];
  runtime_evidence_refs?: readonly EvidenceRef[];
  pr_refs?: readonly EvidenceRef[];
  diff_refs?: readonly EvidenceRef[];
  test_evidence_refs?: readonly EvidenceRef[];
  interrupt_history?: readonly unknown[];
  continuation_history?: readonly unknown[];
}

export function executionViewModel(execution: ExecutionProjection): ProductPageViewModel {
  const evidence = executionEvidence(execution);

  return {
    objectLabel: execution.title ?? execution.ref?.title ?? execution.id,
    objectType: 'Execution',
    currentState: execution.worker_state ?? execution.status ?? 'Status unavailable',
    nextAction: nextExecutionAction(execution),
    disabledReason: undefined,
    primaryActorOrRole: execution.development_plan_item_ref?.title ?? 'Execution owner',
    riskSignal: execution.status === 'failed' || execution.status === 'blocked' ? 'Execution blocked' : 'Execution evidence tracked',
    gateProgress: [
      { label: 'Execution Plan', state: execution.execution_plan_revision_ref === undefined ? 'unavailable' : 'linked' },
      { label: 'Worker', state: execution.worker_state ?? execution.status ?? 'unavailable' },
      { label: 'Review handoff', state: execution.status === 'completed' ? 'ready' : 'pending' },
    ],
    criticalEvidence: evidence,
    secondaryMetadata: [
      { label: 'Execution Plan revision', value: execution.execution_plan_revision_ref?.title ?? execution.execution_plan_revision_ref?.id ?? 'Unavailable' },
      { label: 'Development Plan Item', value: execution.development_plan_item_ref?.title ?? execution.development_plan_item_ref?.id ?? 'Unavailable' },
    ],
    previewSummary: execution.current_step ?? 'Execution step unavailable',
    timelineSummary: execution.updated_at === undefined ? 'Timeline unavailable' : `Updated ${execution.updated_at}`,
  };
}

function executionEvidence(execution: ExecutionProjection): ViewModelEvidence[] {
  const prCount = execution.pr_refs?.length ?? 0;
  const diffCount = execution.diff_refs?.length ?? 0;
  const testCount = execution.test_evidence_refs?.length ?? 0;
  const recoveryHref = developmentPlanItemHref(execution);

  if (prCount + diffCount + testCount === 0) {
    return [
      {
        label: 'PR, diff, and test evidence',
        state: 'unavailable',
        compactText: 'Evidence unavailable',
        recoveryHref,
      },
    ];
  }

  return [
    { label: 'PR evidence', state: prCount === 0 ? 'unavailable' : 'available', compactText: prCount === 0 ? 'Evidence unavailable' : evidenceTitles(execution.pr_refs) },
    { label: 'Diff evidence', state: diffCount === 0 ? 'unavailable' : 'available', compactText: diffCount === 0 ? 'Evidence unavailable' : evidenceTitles(execution.diff_refs) },
    { label: 'Test evidence', state: testCount === 0 ? 'unavailable' : 'available', compactText: testCount === 0 ? 'Evidence unavailable' : evidenceTitles(execution.test_evidence_refs) },
  ];
}

function evidenceTitles(refs: readonly EvidenceRef[] | undefined): string {
  return refs?.map((ref) => ref.title ?? ref.id).filter(Boolean).join(', ') || 'Evidence unavailable';
}

function developmentPlanItemHref(execution: ExecutionProjection): string | undefined {
  const ref = execution.development_plan_item_ref;
  if (ref?.id === undefined || ref.development_plan_id === undefined) return undefined;
  return `/development-plans/${ref.development_plan_id}/items/${ref.id}`;
}

function nextExecutionAction(execution: ExecutionProjection): string {
  const text = `${execution.status ?? ''} ${execution.worker_state ?? ''}`.toLowerCase();
  if (text.includes('interrupted') || text.includes('paused') || text.includes('resumable')) return 'Continue execution';
  if (text.includes('completed')) return 'Prepare review handoff';
  if (text.includes('failed') || text.includes('blocked')) return 'Recover execution';
  return execution.current_step ?? 'Inspect execution';
}
