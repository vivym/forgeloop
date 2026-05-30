import type { ProductPageViewModel, ViewModelGate } from '../product-surfaces/view-model-types';

type QueueArtifactType = 'spec' | 'implementation_plan_doc';
export type DocumentReviewQueueGroupId = 'needs-generation' | 'needs-review' | 'changes-requested' | 'approved-ready' | 'stale-blocked';

interface DocumentReviewRef {
  type?: string;
  id?: string;
  title?: string;
  development_plan_id?: string;
}

export interface DocumentReviewQueueItem {
  id: string;
  artifact_type?: QueueArtifactType | string;
  title?: string;
  summary?: string;
  status?: string;
  gate_state?: string;
  reviewer_actor_id?: string;
  age_label?: string;
  risk?: string;
  stale?: boolean;
  blocked?: boolean;
  next_action?: string;
  command?: string;
  href?: string;
  source_ref?: DocumentReviewRef;
  development_plan_item_ref?: DocumentReviewRef;
  updated_at?: string;
}

interface DocumentReviewQueueProjection {
  items?: readonly DocumentReviewQueueItem[];
  degraded_sources?: readonly string[];
}

export interface DocumentReviewQueueRow {
  id: string;
  artifactType: QueueArtifactType;
  artifactLabel: string;
  title: string;
  groupId: DocumentReviewQueueGroupId;
  groupLabel: string;
  sourceInput: string;
  developmentPlanItem: string;
  reviewer: string;
  age: string;
  risk: string;
  status: string;
  gateStatus: string;
  stale: boolean;
  blocked: boolean;
  nextAction: string;
  command: string;
  developmentPlanId?: string;
  developmentPlanItemId?: string;
  documentSummary: string;
  href: string;
  searchText: string;
}

export interface DocumentReviewQueueGroup {
  id: DocumentReviewQueueGroupId;
  label: string;
  rows: DocumentReviewQueueRow[];
}

export interface DocumentReviewQueueViewModel extends ProductPageViewModel {
  rows: DocumentReviewQueueRow[];
  groups: DocumentReviewQueueGroup[];
}

export const documentReviewQueueGroupDefinitions: Array<{ id: DocumentReviewQueueGroupId; label: string }> = [
  { id: 'needs-generation', label: 'Needs generation' },
  { id: 'needs-review', label: 'Needs review' },
  { id: 'changes-requested', label: 'Changes requested' },
  { id: 'approved-ready', label: 'Approved / ready' },
  { id: 'stale-blocked', label: 'Stale / blocked' },
];

export function documentReviewQueueViewModel(queue: DocumentReviewQueueProjection): DocumentReviewQueueViewModel {
  const items = queue.items ?? [];
  const rows = items.map(documentReviewQueueRow);
  const firstRow = rows[0];
  const blockedCount = rows.filter((row) => row.blocked).length;
  const staleCount = rows.filter((row) => row.stale).length;
  const highRiskCount = rows.filter((row) => /high|critical/i.test(row.risk)).length;
  const activeGroupCount = documentReviewQueueGroups(rows).filter((group) => group.rows.length > 0).length;

  return {
    objectLabel: 'Document Reviews',
    objectType: 'Governance Queue',
    currentState: queue.degraded_sources?.length
      ? 'Degraded governance signal'
      : `${rows.length} governance row${rows.length === 1 ? '' : 's'} across ${activeGroupCount} queue group${activeGroupCount === 1 ? '' : 's'}`,
    nextAction: firstRow?.nextAction ?? 'No pending Spec or Implementation Plan Doc action',
    disabledReason: undefined,
    primaryActorOrRole: firstRow?.reviewer ?? 'Technical reviewer',
    riskSignal: riskSignal(blockedCount, staleCount, highRiskCount),
    gateProgress: gateProgress(rows),
    criticalEvidence: [
      {
        label: 'Governance queue',
        state: rows.length === 0 ? 'unavailable' : blockedCount > 0 ? 'blocked' : staleCount > 0 ? 'stale' : 'available',
        compactText: rows.length === 0 ? 'No governance signal' : `${rows.length} row(s)`,
      },
    ],
    secondaryMetadata: [
      { label: 'Spec rows', value: String(rows.filter((row) => row.artifactType === 'spec').length) },
      { label: 'Implementation Plan Doc rows', value: String(rows.filter((row) => row.artifactType === 'implementation_plan_doc').length) },
      { label: 'Stale rows', value: String(staleCount) },
      { label: 'Blocked rows', value: String(blockedCount) },
    ],
    previewSummary: firstRow?.documentSummary ?? 'Queue empty',
    timelineSummary: queue.degraded_sources?.length ? `Degraded sources: ${queue.degraded_sources.join(', ')}` : 'Queue projection current',
    rows,
    groups: documentReviewQueueGroups(rows),
  };
}

export function documentReviewQueueGroups(rows: readonly DocumentReviewQueueRow[]): DocumentReviewQueueGroup[] {
  return documentReviewQueueGroupDefinitions.map((definition) => ({
    ...definition,
    rows: rows.filter((row) => row.groupId === definition.id),
  }));
}

export function documentReviewQueueRow(item: DocumentReviewQueueItem): DocumentReviewQueueRow {
  const artifactType = item.artifact_type === 'implementation_plan_doc' ? 'implementation_plan_doc' : 'spec';
  const groupId = groupForItem(item);
  const groupLabel = documentReviewQueueGroupDefinitions.find((group) => group.id === groupId)?.label ?? 'Needs review';
  const status = formatValue(item.status);
  const gateStatus = formatValue(item.gate_state);
  const sourceInput = refLabel(item.source_ref, 'Planning input not linked');
  const developmentPlanItem = refLabel(item.development_plan_item_ref, 'Development Plan Item not linked');
  const developmentPlanId = item.development_plan_item_ref?.development_plan_id;
  const developmentPlanItemId = item.development_plan_item_ref?.id;
  const title = item.title ?? `${artifactLabel(artifactType)} governance row`;
  const nextAction = item.next_action ?? defaultNextAction(artifactType, groupId);
  const row: DocumentReviewQueueRow = {
    id: item.id,
    artifactType,
    artifactLabel: artifactLabel(artifactType),
    title,
    groupId,
    groupLabel,
    sourceInput,
    developmentPlanItem,
    reviewer: item.reviewer_actor_id ?? 'Unassigned reviewer',
    age: item.age_label ?? relativeAge(item.updated_at),
    risk: formatValue(item.risk),
    status,
    gateStatus,
    stale: item.stale === true || normalized(item.status) === 'stale' || normalized(item.gate_state) === 'stale',
    blocked: item.blocked === true || normalized(item.status) === 'blocked' || normalized(item.gate_state) === 'blocked',
    nextAction,
    command: item.command ?? defaultCommand(artifactType, groupId),
    ...(developmentPlanId === undefined ? {} : { developmentPlanId }),
    ...(developmentPlanItemId === undefined ? {} : { developmentPlanItemId }),
    documentSummary: item.summary ?? `${title} for ${developmentPlanItem} from ${sourceInput}.`,
    href: queueItemHref(item, artifactType),
    searchText: '',
  };
  return {
    ...row,
    searchText: [
      row.title,
      row.artifactLabel,
      row.groupLabel,
      row.sourceInput,
      row.developmentPlanItem,
      row.reviewer,
      row.age,
      row.risk,
      row.status,
      row.gateStatus,
      row.nextAction,
      row.command,
      row.documentSummary,
    ].join(' ').toLowerCase(),
  };
}

function gateProgress(rows: readonly DocumentReviewQueueRow[]): ViewModelGate[] {
  if (rows.length === 0) return [{ label: 'Governance', state: 'empty' }];
  return documentReviewQueueGroups(rows).map((group) => ({
    label: group.label,
    state: group.rows.length === 0 ? 'empty' : `${group.rows.length} row${group.rows.length === 1 ? '' : 's'}`,
    owner: firstAssignedReviewer(group.rows),
  }));
}

function groupForItem(item: DocumentReviewQueueItem): DocumentReviewQueueGroupId {
  const status = normalized(item.status);
  const gateState = normalized(item.gate_state);
  if (item.blocked === true || item.stale === true || status === 'blocked' || status === 'stale' || gateState === 'blocked' || gateState === 'stale') {
    return 'stale-blocked';
  }
  if (status === 'changes_requested' || status === 'rejected' || gateState === 'changes_requested') return 'changes-requested';
  if (status === 'approved' || status === 'accepted' || gateState === 'approved' || gateState === 'ready') return 'approved-ready';
  if (status === 'in_review' || status === 'submitted' || gateState === 'awaiting_review' || gateState === 'awaiting_approval') return 'needs-review';
  return 'needs-generation';
}

function queueItemHref(item: DocumentReviewQueueItem, artifactType: QueueArtifactType): string {
  const planId = item.development_plan_item_ref?.development_plan_id;
  const itemId = item.development_plan_item_ref?.id;
  const suffix = artifactType === 'spec' ? 'spec' : 'implementation-plan';
  if (planId !== undefined && itemId !== undefined) {
    return `/development-plans/${encodeURIComponent(planId)}/items/${encodeURIComponent(itemId)}/${suffix}`;
  }
  return `/reviews?tab=${artifactType === 'spec' ? 'specs' : 'implementation-plans'}`;
}

function riskSignal(blockedCount: number, staleCount: number, highRiskCount: number): string {
  if (blockedCount > 0) return `${blockedCount} blocked governance row${blockedCount === 1 ? '' : 's'}`;
  if (staleCount > 0) return `${staleCount} stale governance row${staleCount === 1 ? '' : 's'}`;
  if (highRiskCount > 0) return `${highRiskCount} high-risk governance row${highRiskCount === 1 ? '' : 's'}`;
  return 'No stale or blocked governance signal';
}

function firstAssignedReviewer(rows: readonly DocumentReviewQueueRow[]): string | undefined {
  return rows.find((row) => row.reviewer !== 'Unassigned reviewer')?.reviewer;
}

function artifactLabel(artifactType: QueueArtifactType): string {
  return artifactType === 'spec' ? 'Spec' : 'Implementation Plan Doc';
}

function defaultNextAction(artifactType: QueueArtifactType, groupId: DocumentReviewQueueGroupId): string {
  if (groupId === 'needs-generation') return artifactType === 'spec' ? 'Generate Spec from approved boundary.' : 'Generate Implementation Plan Doc from approved Spec.';
  if (groupId === 'needs-review') return `Review ${artifactLabel(artifactType)} revision.`;
  if (groupId === 'changes-requested') return `Revise ${artifactLabel(artifactType)} and resubmit.`;
  if (groupId === 'approved-ready') return artifactType === 'spec' ? 'Generate or review the Implementation Plan Doc.' : 'Start execution from the approved Implementation Plan Doc.';
  return `Resolve stale or blocked ${artifactLabel(artifactType)} governance.`;
}

function defaultCommand(artifactType: QueueArtifactType, groupId: DocumentReviewQueueGroupId): string {
  if (groupId === 'needs-generation') return artifactType === 'spec' ? 'Generate Spec' : 'Generate Implementation Plan Doc';
  if (groupId === 'needs-review') return artifactType === 'spec' ? 'Review Spec' : 'Review Implementation Plan Doc';
  if (groupId === 'changes-requested') return artifactType === 'spec' ? 'Revise Spec' : 'Revise Implementation Plan Doc';
  if (groupId === 'approved-ready') return artifactType === 'spec' ? 'Open Spec gate' : 'Open Implementation Plan Doc gate';
  return artifactType === 'spec' ? 'Regenerate Spec' : 'Regenerate Implementation Plan Doc';
}

function refLabel(ref: DocumentReviewRef | undefined, fallback: string): string {
  if (ref?.title !== undefined && ref.title.trim().length > 0) return ref.title;
  if (ref?.id !== undefined && ref.id.trim().length > 0) return ref.id;
  return fallback;
}

function relativeAge(updatedAt: string | undefined): string {
  if (updatedAt === undefined) return 'Age not recorded';
  return `Updated ${updatedAt.slice(0, 10)}`;
}

function normalized(value: string | undefined): string {
  return value?.toLowerCase().replaceAll(' ', '_') ?? '';
}

function formatValue(value: string | undefined): string {
  return value === undefined ? 'Not recorded' : value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}
