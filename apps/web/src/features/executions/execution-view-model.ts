import type { ProductPageViewModel, ViewModelAction, ViewModelEvidence } from '../product-surfaces/view-model-types';
import type { ProductObjectRef } from '../../shared/api/types';

type EvidenceRef = { id?: string; title?: string };
type ProductRef = ProductObjectRef & { development_plan_id?: string; implementation_plan_id?: string };

export type ExecutionLaneId = 'active' | 'resumable' | 'review-pending' | 'failed-blocked' | 'completed-recent';

export interface ExecutionProjection {
  id: string;
  title?: string;
  ref?: ProductRef;
  status?: string;
  worker_state?: string;
  current_step?: string;
  last_event_at?: string;
  last_event_summary?: string;
  updated_at?: string;
  created_at?: string;
  href?: string;
  stale?: boolean;
  blocked?: boolean;
  development_plan_item_ref?: ProductRef;
  implementation_plan_revision_id?: string;
  implementation_plan_revision_ref?: ProductRef;
  evidence_refs?: ProductRef[];
  runtime_evidence_refs?: readonly EvidenceRef[];
  pr_refs?: readonly EvidenceRef[];
  diff_refs?: readonly EvidenceRef[];
  test_evidence_refs?: readonly EvidenceRef[];
  interrupt_history?: readonly { at?: string; reason?: string }[];
  continuation_history?: readonly { at?: string; summary?: string }[];
}

export interface ExecutionSupervisionAction extends ViewModelAction {
  kind: 'interrupt' | 'continue' | 'retry' | 'inspect';
}

export interface ExecutionSupervisionRow {
  id: string;
  href: string;
  title: string;
  laneId: ExecutionLaneId;
  approvedImplementationPlanRevision: string;
  developmentPlanItem: string;
  developmentPlanItemHref: string | undefined;
  workerState: string;
  currentStep: string;
  lastEvent: string;
  evidenceSummary: string;
  allowedAction: ExecutionSupervisionAction;
  actions: ExecutionSupervisionAction[];
  statusTone: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  compactMetadata: string;
}

export interface ExecutionSupervisionDetail extends ProductPageViewModel {
  id: string;
  title: string;
  status: string;
  statusTone: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  approvedImplementationPlanRevision: string;
  developmentPlanItem: string;
  developmentPlanItemHref: string | undefined;
  workerState: string;
  currentStep: string;
  lastMeaningfulEvent: string;
  evidenceSummary: string;
  compactMetadata: string;
  actions: ExecutionSupervisionAction[];
  interruptHistory: string;
  continueHistory: string;
}

export const executionSupervisionLanes: Array<{ id: ExecutionLaneId; label: string }> = [
  { id: 'active', label: 'Active' },
  { id: 'resumable', label: 'Resumable' },
  { id: 'review-pending', label: 'Review pending' },
  { id: 'failed-blocked', label: 'Failed / blocked' },
  { id: 'completed-recent', label: 'Completed / recent' },
];

export function executionSupervisionRow(execution: ExecutionProjection): ExecutionSupervisionRow {
  const actions = executionActions(execution, 'list');
  const allowedAction = actions.find((action) => action.enabled) ?? actions[actions.length - 1]!;

  return {
    id: execution.id,
    href: execution.href ?? `/executions/${execution.id}`,
    title: productTitle(execution),
    laneId: executionLane(execution),
    approvedImplementationPlanRevision: implementationPlanRevisionLabel(execution),
    developmentPlanItem: developmentPlanItemLabel(execution),
    developmentPlanItemHref: developmentPlanItemHref(execution),
    workerState: formatValue(execution.worker_state ?? execution.status),
    currentStep: execution.current_step ?? 'Awaiting execution event',
    lastEvent: lastMeaningfulEvent(execution),
    evidenceSummary: executionEvidenceSummary(execution),
    allowedAction,
    actions,
    statusTone: statusTone(execution.status ?? execution.worker_state),
    compactMetadata: compactMetadata(execution),
  };
}

export function executionSupervisionDetail(execution: ExecutionProjection): ExecutionSupervisionDetail {
  const actions = executionActions(execution, 'detail');
  const evidence = executionEvidence(execution);
  const state = formatValue(execution.worker_state ?? execution.status);
  const title = productTitle(execution);
  const currentStep = execution.current_step ?? 'Awaiting execution event';
  const lastEvent = lastMeaningfulEvent(execution);
  const evidenceSummary = executionEvidenceSummary(execution);
  const planItem = developmentPlanItemLabel(execution);
  const implementationPlanRevision = implementationPlanRevisionLabel(execution);

  return {
    id: execution.id,
    title,
    objectLabel: title,
    objectType: 'Execution supervision',
    currentState: `Worker state ${state}; approved Implementation Plan Doc ${implementationPlanRevision}`,
    nextAction: `Allowed action: ${nextActionLabel(actions)}`,
    disabledReason: disabledReasons(actions).join(' '),
    primaryActorOrRole: `Linked Plan Item: ${planItem}`,
    riskSignal: executionRiskSignal(execution),
    gateProgress: [
      { label: 'Approved Implementation Plan Doc revision', state: implementationPlanRevision },
      { label: 'Development Plan Item', state: planItem, href: developmentPlanItemHref(execution) },
      { label: 'Worker state', state },
    ],
    criticalEvidence: evidence,
    secondaryMetadata: [
      { label: 'Compact metadata', value: compactMetadata(execution) },
      { label: 'Execution status', value: formatValue(execution.status) },
    ],
    previewSummary: `Current step: ${currentStep}. Last meaningful event: ${lastEvent}. PR, diff, and test evidence: ${evidenceSummary}.`,
    timelineSummary: lastEvent,
    status: formatValue(execution.status),
    statusTone: statusTone(execution.status ?? execution.worker_state),
    approvedImplementationPlanRevision: implementationPlanRevision,
    developmentPlanItem: planItem,
    developmentPlanItemHref: developmentPlanItemHref(execution),
    workerState: state,
    currentStep,
    lastMeaningfulEvent: lastEvent,
    evidenceSummary,
    compactMetadata: compactMetadata(execution),
    actions,
    interruptHistory: historySummary(execution.interrupt_history, 'reason'),
    continueHistory: historySummary(execution.continuation_history, 'summary'),
  };
}

export function executionViewModel(execution: ExecutionProjection): ProductPageViewModel {
  return executionSupervisionDetail(execution);
}

function executionActions(execution: ExecutionProjection, surface: 'list' | 'detail'): ExecutionSupervisionAction[] {
  const stateText = executionStateText(execution);
  const failedOrBlocked = isFailedOrBlockedExecution(execution);
  const interruptEnabled = !failedOrBlocked && (stateText.includes('running') || stateText.includes('active'));
  const continueEnabled = !failedOrBlocked && isResumableExecution(execution);

  return [
    {
      id: 'interrupt',
      kind: 'interrupt',
      label: 'Interrupt execution',
      enabled: interruptEnabled,
      disabledReason: interruptEnabled ? undefined : 'Interrupt disabled: execution is not actively running.',
    },
    {
      id: 'continue',
      kind: 'continue',
      label: 'Continue execution',
      enabled: continueEnabled,
      disabledReason: continueEnabled ? undefined : continueDisabledReason(execution, surface),
    },
    {
      id: 'retry',
      kind: 'retry',
      label: 'Retry execution',
      enabled: false,
      disabledReason: 'Retry unavailable: inspect execution evidence before restarting from the approved Implementation Plan Doc path.',
    },
    {
      id: 'inspect',
      kind: 'inspect',
      label: 'Inspect execution',
      enabled: true,
      href: execution.href ?? `/executions/${execution.id}`,
    },
  ];
}

function continueDisabledReason(execution: ExecutionProjection, surface: 'list' | 'detail'): string {
  const stateText = executionStateText(execution);
  if (stateText.includes('running') || stateText.includes('active')) {
    return surface === 'list'
      ? 'Continue disabled: execution is still running.'
      : 'Continue disabled: execution is currently running.';
  }
  if (isFailedOrBlockedExecution(execution)) return 'Continue disabled: retry is required before continuation.';
  if (stateText.includes('completed') || stateText.includes('accepted')) return 'Continue disabled: execution already completed.';
  return 'Continue disabled: execution is not paused or resumable.';
}

function nextActionLabel(actions: readonly ExecutionSupervisionAction[]): string {
  const action = actions.find((candidate) => candidate.enabled && candidate.kind !== 'inspect') ?? actions.find((candidate) => candidate.enabled);
  return action?.label ?? 'Inspect execution';
}

function disabledReasons(actions: readonly ExecutionSupervisionAction[]): string[] {
  return actions.map((action) => action.disabledReason).filter((reason): reason is string => reason !== undefined);
}

function executionLane(execution: ExecutionProjection): ExecutionLaneId {
  const stateText = executionStateText(execution);
  if (isFailedOrBlockedExecution(execution)) return 'failed-blocked';
  if (isResumableExecution(execution)) return 'resumable';
  if (stateText.includes('awaiting_code_review') || stateText.includes('awaiting code review') || stateText.includes('review')) return 'review-pending';
  if (stateText.includes('completed') || stateText.includes('accepted') || stateText.includes('qa')) return 'completed-recent';
  return 'active';
}

function productTitle(execution: ExecutionProjection): string {
  const planItem = execution.development_plan_item_ref?.title;
  if (isPresent(planItem)) return planItem;
  const planRevision = execution.implementation_plan_revision_ref?.title;
  if (isPresent(planRevision)) return planRevision;
  const refTitle = execution.ref?.title;
  if (isPresent(refTitle)) return refTitle;
  const title = execution.title;
  if (isPresent(title)) return title;
  return 'Execution supervision';
}

function implementationPlanRevisionLabel(execution: ExecutionProjection): string {
  if (isPresent(execution.implementation_plan_revision_ref?.title)) return execution.implementation_plan_revision_ref.title;
  return execution.implementation_plan_revision_ref?.id !== undefined || execution.implementation_plan_revision_id !== undefined ? 'Linked revision' : 'Not linked';
}

function developmentPlanItemLabel(execution: ExecutionProjection): string {
  if (isPresent(execution.development_plan_item_ref?.title)) return execution.development_plan_item_ref.title;
  return execution.development_plan_item_ref?.id !== undefined ? 'Linked Plan Item' : 'Not linked';
}

function developmentPlanItemHref(execution: ExecutionProjection): string | undefined {
  const ref = execution.development_plan_item_ref;
  if (ref?.id === undefined || ref.development_plan_id === undefined) return undefined;
  return `/development-plans/${ref.development_plan_id}/items/${ref.id}`;
}

function executionRiskSignal(execution: ExecutionProjection): string {
  if (execution.blocked === true || isFailedOrBlockedExecution(execution)) return 'Execution blocked: inspect failed step and retry path.';
  if (execution.stale === true) return 'Execution stale: last event is outside the supervision window.';
  if (isResumableExecution(execution)) return 'Execution resumable: continuation is available.';
  return 'No blocker: PR, diff, and test evidence remain visible for supervision.';
}

function executionEvidence(execution: ExecutionProjection): ViewModelEvidence[] {
  const groups = [
    { label: 'PR evidence', refs: execution.pr_refs },
    { label: 'Diff evidence', refs: execution.diff_refs },
    { label: 'Test evidence', refs: execution.test_evidence_refs },
  ];

  return groups.map((group) => {
    const compactText = evidenceTitles(group.refs);
    return {
      label: group.label,
      state: compactText === 'Evidence unavailable' ? 'unavailable' : 'available',
      compactText,
      recoveryHref: developmentPlanItemHref(execution),
    };
  });
}

function executionEvidenceSummary(execution: ExecutionProjection): string {
  return [
    `PR: ${evidenceTitles(execution.pr_refs)}`,
    `Diff: ${evidenceTitles(execution.diff_refs)}`,
    `Test: ${evidenceTitles(execution.test_evidence_refs)}`,
  ].join(' · ');
}

function evidenceTitles(refs: readonly EvidenceRef[] | undefined): string {
  return refs?.map((ref) => ref.title ?? (ref.id === undefined ? undefined : 'Linked evidence')).filter(isPresent).join(', ') || 'Evidence unavailable';
}

function lastMeaningfulEvent(execution: ExecutionProjection): string {
  if (isPresent(execution.last_event_summary)) return roleSafeEventText(execution.last_event_summary);
  const events = [
    ...(execution.interrupt_history ?? []).map((entry) => ({ at: entry.at, text: entry.reason ?? 'Interrupted' })),
    ...(execution.continuation_history ?? []).map((entry) => ({ at: entry.at, text: entry.summary ?? 'Continued' })),
  ].sort((left, right) => timestamp(right.at) - timestamp(left.at));
  const latest = events[0];
  if (latest !== undefined) return `${roleSafeEventText(latest.text)}${latest.at === undefined ? '' : ` at ${formatDate(latest.at)}`}`;
  return formatDate(execution.last_event_at ?? execution.updated_at ?? execution.created_at);
}

function historySummary<T extends { at?: string }>(history: readonly T[] | undefined, textKey: keyof T): string {
  return history?.map((entry) => `${roleSafeEventText(String(entry[textKey] ?? 'Recorded'))}${entry.at === undefined ? '' : ` at ${formatDate(entry.at)}`}`).join(', ') || 'None recorded';
}

function compactMetadata(execution: ExecutionProjection): string {
  const ids = [
    `execution id ${execution.id}`,
    execution.implementation_plan_revision_ref?.id === undefined ? undefined : `revision id ${execution.implementation_plan_revision_ref.id}`,
  ];
  return ids.filter(isPresent).join(' · ');
}

function isResumableExecution(execution: ExecutionProjection): boolean {
  const stateText = executionStateText(execution);
  return stateText.includes('interrupted') || stateText.includes('resumable') || stateText.includes('paused');
}

function isFailedOrBlockedExecution(execution: ExecutionProjection): boolean {
  const stateText = executionStateText(execution);
  return execution.blocked === true || stateText.includes('failed') || stateText.includes('blocked');
}

function executionStateText(execution: ExecutionProjection): string {
  return `${execution.status ?? ''} ${execution.worker_state ?? ''}`.toLowerCase();
}

function formatDate(value: string | undefined): string {
  if (value === undefined) return 'Not recorded';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function timestamp(value: string | undefined): number {
  if (value === undefined) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatValue(value: string | undefined): string {
  return value === undefined ? 'Not recorded' : value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

function statusTone(status: string | undefined): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  const text = status?.toLowerCase() ?? '';
  if (text.includes('completed') || text.includes('accepted')) return 'success';
  if (text.includes('failed') || text.includes('blocked')) return 'danger';
  if (text.includes('interrupted') || text.includes('resumable') || text.includes('paused')) return 'warning';
  if (text.includes('running') || text.includes('active') || text.includes('review')) return 'info';
  return 'neutral';
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function roleSafeEventText(value: string): string {
  return value.replace(/\bactor-[a-z0-9-]+\b/gi, 'assigned operator');
}
