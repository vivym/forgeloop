import type { ProductPageViewModel, ViewModelGate } from '../product-surfaces/view-model-types';

type QueueArtifactType = 'spec' | 'execution_plan';
export type SpecPlanQueueGroupId = 'needs-generation' | 'needs-review' | 'changes-requested' | 'approved-ready' | 'stale-blocked';

interface SpecPlanRef {
  type?: string;
  id?: string;
  title?: string;
  development_plan_id?: string;
}

export interface SpecPlanQueueItem {
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
  source_ref?: SpecPlanRef;
  development_plan_item_ref?: SpecPlanRef;
  updated_at?: string;
}

interface SpecPlanQueueProjection {
  items?: readonly SpecPlanQueueItem[];
  degraded_sources?: readonly string[];
}

export interface SpecPlanQueueRow {
  id: string;
  artifactType: QueueArtifactType;
  artifactLabel: string;
  title: string;
  groupId: SpecPlanQueueGroupId;
  groupLabel: string;
  sourceObject: string;
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
  documentSummary: string;
  href: string;
  searchText: string;
}

export interface SpecPlanQueueGroup {
  id: SpecPlanQueueGroupId;
  label: string;
  rows: SpecPlanQueueRow[];
}

export interface SpecPlanQueueWorkspaceViewModel extends ProductPageViewModel {
  rows: SpecPlanQueueRow[];
  groups: SpecPlanQueueGroup[];
}

export const specPlanQueueGroupDefinitions: Array<{ id: SpecPlanQueueGroupId; label: string }> = [
  { id: 'needs-generation', label: 'Needs generation' },
  { id: 'needs-review', label: 'Needs review' },
  { id: 'changes-requested', label: 'Changes requested' },
  { id: 'approved-ready', label: 'Approved / ready' },
  { id: 'stale-blocked', label: 'Stale / blocked' },
];

export function specPlanQueueViewModel(queue: SpecPlanQueueProjection): SpecPlanQueueWorkspaceViewModel {
  const items = queue.items ?? [];
  const rows = items.map(specPlanQueueRow);
  const firstRow = rows[0];
  const blockedCount = rows.filter((row) => row.blocked).length;
  const staleCount = rows.filter((row) => row.stale).length;
  const highRiskCount = rows.filter((row) => /high|critical/i.test(row.risk)).length;
  const activeGroupCount = specPlanQueueGroups(rows).filter((group) => group.rows.length > 0).length;

  return {
    objectLabel: 'Specs & Execution Plans',
    objectType: 'Governance Queue',
    currentState: queue.degraded_sources?.length
      ? 'Degraded governance signal'
      : `${rows.length} governance row${rows.length === 1 ? '' : 's'} across ${activeGroupCount} queue group${activeGroupCount === 1 ? '' : 's'}`,
    nextAction: firstRow?.nextAction ?? 'No pending Spec or Execution Plan action',
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
      { label: 'Execution Plan rows', value: String(rows.filter((row) => row.artifactType === 'execution_plan').length) },
      { label: 'Stale rows', value: String(staleCount) },
      { label: 'Blocked rows', value: String(blockedCount) },
    ],
    previewSummary: firstRow?.documentSummary ?? 'Queue empty',
    timelineSummary: queue.degraded_sources?.length ? `Degraded sources: ${queue.degraded_sources.join(', ')}` : 'Queue projection current',
    rows,
    groups: specPlanQueueGroups(rows),
  };
}

export function specPlanQueueGroups(rows: readonly SpecPlanQueueRow[]): SpecPlanQueueGroup[] {
  return specPlanQueueGroupDefinitions.map((definition) => ({
    ...definition,
    rows: rows.filter((row) => row.groupId === definition.id),
  }));
}

export function specPlanQueueRow(item: SpecPlanQueueItem): SpecPlanQueueRow {
  const artifactType = item.artifact_type === 'execution_plan' ? 'execution_plan' : 'spec';
  const groupId = groupForItem(item);
  const groupLabel = specPlanQueueGroupDefinitions.find((group) => group.id === groupId)?.label ?? 'Needs review';
  const status = formatValue(item.status);
  const gateStatus = formatValue(item.gate_state);
  const sourceObject = refLabel(item.source_ref, 'Source object not linked');
  const developmentPlanItem = refLabel(item.development_plan_item_ref, 'Development Plan Item not linked');
  const title = item.title ?? `${artifactLabel(artifactType)} governance row`;
  const nextAction = item.next_action ?? defaultNextAction(artifactType, groupId);
  const row: SpecPlanQueueRow = {
    id: item.id,
    artifactType,
    artifactLabel: artifactLabel(artifactType),
    title,
    groupId,
    groupLabel,
    sourceObject,
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
    documentSummary: item.summary ?? `${title} for ${developmentPlanItem} from ${sourceObject}.`,
    href: item.href ?? queueItemHref(item, artifactType),
    searchText: '',
  };
  return {
    ...row,
    searchText: [
      row.title,
      row.artifactLabel,
      row.groupLabel,
      row.sourceObject,
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

function gateProgress(rows: readonly SpecPlanQueueRow[]): ViewModelGate[] {
  if (rows.length === 0) return [{ label: 'Governance', state: 'empty' }];
  return specPlanQueueGroups(rows).map((group) => ({
    label: group.label,
    state: group.rows.length === 0 ? 'empty' : `${group.rows.length} row${group.rows.length === 1 ? '' : 's'}`,
    owner: firstAssignedReviewer(group.rows),
  }));
}

function groupForItem(item: SpecPlanQueueItem): SpecPlanQueueGroupId {
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

function queueItemHref(item: SpecPlanQueueItem, artifactType: QueueArtifactType): string {
  const planId = item.development_plan_item_ref?.development_plan_id;
  const itemId = item.development_plan_item_ref?.id;
  const suffix = artifactType === 'spec' ? 'spec' : 'execution-plan';
  if (planId !== undefined && itemId !== undefined) {
    return `/development-plans/${encodeURIComponent(planId)}/items/${encodeURIComponent(itemId)}/${suffix}`;
  }
  return `/specs-plans?tab=${artifactType === 'spec' ? 'specs' : 'plans'}`;
}

function riskSignal(blockedCount: number, staleCount: number, highRiskCount: number): string {
  if (blockedCount > 0) return `${blockedCount} blocked governance row${blockedCount === 1 ? '' : 's'}`;
  if (staleCount > 0) return `${staleCount} stale governance row${staleCount === 1 ? '' : 's'}`;
  if (highRiskCount > 0) return `${highRiskCount} high-risk governance row${highRiskCount === 1 ? '' : 's'}`;
  return 'No stale or blocked governance signal';
}

function firstAssignedReviewer(rows: readonly SpecPlanQueueRow[]): string | undefined {
  return rows.find((row) => row.reviewer !== 'Unassigned reviewer')?.reviewer;
}

function artifactLabel(artifactType: QueueArtifactType): string {
  return artifactType === 'spec' ? 'Spec' : 'Execution Plan';
}

function defaultNextAction(artifactType: QueueArtifactType, groupId: SpecPlanQueueGroupId): string {
  if (groupId === 'needs-generation') return artifactType === 'spec' ? 'Generate Spec from approved boundary.' : 'Generate Execution Plan from approved Spec.';
  if (groupId === 'needs-review') return `Review ${artifactLabel(artifactType)} revision.`;
  if (groupId === 'changes-requested') return `Revise ${artifactLabel(artifactType)} and resubmit.`;
  if (groupId === 'approved-ready') return artifactType === 'spec' ? 'Generate or review the Execution Plan.' : 'Start execution from the approved plan.';
  return `Resolve stale or blocked ${artifactLabel(artifactType)} governance.`;
}

function defaultCommand(artifactType: QueueArtifactType, groupId: SpecPlanQueueGroupId): string {
  if (groupId === 'needs-generation') return artifactType === 'spec' ? 'Generate Spec' : 'Generate Execution Plan';
  if (groupId === 'needs-review') return artifactType === 'spec' ? 'Review Spec' : 'Review Execution Plan';
  if (groupId === 'changes-requested') return artifactType === 'spec' ? 'Revise Spec' : 'Revise Execution Plan';
  if (groupId === 'approved-ready') return artifactType === 'spec' ? 'Open Spec gate' : 'Open Execution Plan gate';
  return artifactType === 'spec' ? 'Regenerate Spec' : 'Regenerate Execution Plan';
}

function refLabel(ref: SpecPlanRef | undefined, fallback: string): string {
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
