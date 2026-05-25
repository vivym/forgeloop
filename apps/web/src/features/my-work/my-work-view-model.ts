import type { MyWorkQueueItem } from '@forgeloop/contracts';

import type { ProductPageViewModel, ViewModelAction, ViewModelGate, ViewModelMetadata } from '../product-surfaces/view-model-types';

export const attentionGroups = [
  { id: 'product', label: 'Product attention', roleLabel: 'Product' },
  { id: 'tech-lead', label: 'Tech Lead attention', roleLabel: 'Tech Lead' },
  { id: 'developer', label: 'Developer attention', roleLabel: 'Developer' },
  { id: 'qa', label: 'QA attention', roleLabel: 'QA' },
  { id: 'release-owner', label: 'Release attention', roleLabel: 'Release' },
  { id: 'manager', label: 'Manager attention', roleLabel: 'Manager' },
] as const;

export type AttentionGroupId = (typeof attentionGroups)[number]['id'];

export interface MyWorkQueueProjection {
  items: readonly MyWorkQueueItem[] | undefined;
  degraded_sources: readonly string[] | undefined;
  bulk_action: unknown | undefined;
}

export interface MyWorkQueueRow {
  id: string;
  ageLabel: string;
  attentionReasonLabel: string;
  disabledReason: string;
  gateLabel: string;
  href: string | undefined;
  nextAction: string;
  objectTypeLabel: string;
  openLabel: string;
  riskLabel: string;
  roleId: AttentionGroupId;
  roleLabel: string;
  statusLabel: string;
  title: string;
}

export interface MyWorkQueueGroup {
  id: AttentionGroupId;
  label: string;
  rows: MyWorkQueueRow[];
}

export interface MyWorkFilterOption {
  id: string;
  label: string;
  count: number;
}

export interface MyWorkQueueFilters {
  gates: MyWorkFilterOption[];
  risks: MyWorkFilterOption[];
  roles: MyWorkFilterOption[];
  statuses: MyWorkFilterOption[];
}

export interface MyWorkQueueWorkspaceViewModel extends ProductPageViewModel {
  allRows: MyWorkQueueRow[];
  bulkAction: ViewModelAction;
  disabledReason: string;
  filters: MyWorkQueueFilters;
  groups: MyWorkQueueGroup[];
  safeBulkAction?: ViewModelAction | undefined;
}

const bulkActionUnavailable: ViewModelAction = {
  id: 'safe-bulk-action-unavailable',
  label: 'No shared safe bulk action',
  enabled: false,
  disabledReason: 'No shared safe bulk action',
};

export function myWorkQueueViewModel(queue: MyWorkQueueProjection = { items: undefined, degraded_sources: undefined, bulk_action: undefined }): MyWorkQueueWorkspaceViewModel {
  const rows = (queue.items ?? []).map(queueRowFor);
  const bulkAction = safeBulkActionFor(queue.bulk_action) ?? bulkActionUnavailable;
  const safeBulkAction = bulkAction.enabled ? bulkAction : undefined;
  const disabledReason = bulkAction.enabled ? '' : bulkAction.disabledReason ?? bulkActionUnavailable.disabledReason!;
  const degradedSources = queue.degraded_sources ?? [];

  return {
    objectLabel: 'My Work',
    objectType: 'Role Queue',
    currentState: currentState(rows, degradedSources),
    nextAction: nextAction(rows, bulkAction),
    disabledReason,
    primaryActorOrRole: primaryRole(rows),
    riskSignal: riskSignal(rows, degradedSources),
    gateProgress: queueGateProgress(rows),
    criticalEvidence: [
      {
        label: 'Bulk action eligibility',
        state: bulkAction.enabled ? 'available' : 'unavailable',
        compactText: bulkAction.enabled ? bulkAction.label : disabledReason,
      },
    ],
    secondaryMetadata: queueMetadata(rows),
    previewSummary: rows[0]?.title ?? 'No attention items',
    timelineSummary: degradedSources.length ? `Degraded sources: ${degradedSources.join(', ')}` : 'Queue projection current',
    bulkAction,
    safeBulkAction,
    actions: safeBulkAction ? [safeBulkAction] : undefined,
    items: rows.map((row) => ({ label: row.title, value: row.nextAction, href: row.href })),
    allRows: rows,
    filters: queueFilters(rows),
    groups: attentionGroups.map((group) => ({
      id: group.id,
      label: group.label,
      rows: rows.filter((row) => row.roleId === group.id),
    })),
  };
}

export function typedHrefFor(ref: MyWorkQueueItem['object_ref']): string | undefined {
  switch (ref.type) {
    case 'initiative':
      return `/initiatives/${encodeURIComponent(ref.id)}`;
    case 'requirement':
      return `/requirements/${encodeURIComponent(ref.id)}`;
    case 'tech_debt':
      return `/tech-debt/${encodeURIComponent(ref.id)}`;
    case 'bug':
      return `/bugs/${encodeURIComponent(ref.id)}`;
    case 'development_plan_item':
      return `/development-plans/${encodeURIComponent(ref.development_plan_id)}/items/${encodeURIComponent(ref.id)}`;
    case 'spec':
    case 'spec_revision':
    case 'execution_plan':
    case 'execution_plan_revision':
      return '/specs-plans';
    case 'release':
      return `/releases/${encodeURIComponent(ref.id)}`;
    case 'development_plan':
      return `/development-plans/${encodeURIComponent(ref.id)}`;
    case 'execution':
      return `/board?execution_id=${encodeURIComponent(ref.id)}`;
    case 'code_review_handoff':
      return `/reports?code_review_handoff_id=${encodeURIComponent(ref.id)}`;
    case 'qa_handoff':
      return `/reports?qa_handoff_id=${encodeURIComponent(ref.id)}`;
    case 'brainstorming_session':
    case 'boundary_summary':
    case 'attachment':
      return undefined;
  }
}

function queueRowFor(item: MyWorkQueueItem): MyWorkQueueRow {
  const roleId = attentionGroupFor(item);
  const roleLabel = attentionGroups.find((group) => group.id === roleId)?.roleLabel ?? 'Product';
  const gateLabel = blockingGateFor(item);
  const attentionLabel = attentionReasonLabel(item.attention_reason);
  const nextAction = item.expected_action ?? 'Review queue item';

  return {
    id: item.id,
    ageLabel: ageLabel(item.due_at),
    attentionReasonLabel: attentionLabel,
    disabledReason: bulkActionUnavailable.disabledReason!,
    gateLabel,
    href: typedHrefFor(item.object_ref),
    nextAction,
    objectTypeLabel: objectTypeLabel(item.object_ref.type),
    openLabel: openLabelFor(item.object_ref),
    riskLabel: riskLabelFor(item, gateLabel),
    roleId,
    roleLabel,
    statusLabel: attentionLabel,
    title: item.title,
  };
}

function attentionGroupFor(item: MyWorkQueueItem): AttentionGroupId {
  if (
    item.attention_reason.includes('tech_lead') ||
    item.object_ref.type === 'spec' ||
    item.object_ref.type === 'spec_revision' ||
    item.object_ref.type === 'execution_plan' ||
    item.object_ref.type === 'execution_plan_revision'
  ) {
    return 'tech-lead';
  }
  if (
    item.attention_reason.includes('developer') ||
    item.object_ref.type === 'development_plan_item' ||
    item.object_ref.type === 'execution'
  ) {
    return 'developer';
  }
  if (item.attention_reason.includes('qa') || item.object_ref.type === 'bug' || item.object_ref.type === 'qa_handoff') {
    return 'qa';
  }
  if (item.attention_reason.includes('release_owner') || item.object_ref.type === 'release') {
    return 'release-owner';
  }
  if (item.attention_reason.includes('manager') || item.object_ref.type === 'tech_debt') {
    return 'manager';
  }
  return 'product';
}

function objectTypeLabel(type: MyWorkQueueItem['object_ref']['type']) {
  const labels: Record<MyWorkQueueItem['object_ref']['type'], string> = {
    initiative: 'Initiative',
    requirement: 'Requirement',
    tech_debt: 'Tech Debt',
    bug: 'Bug',
    development_plan: 'Development Plan',
    development_plan_item: 'Development Plan Item',
    brainstorming_session: 'Brainstorming Session',
    boundary_summary: 'Boundary Summary',
    spec: 'Spec',
    spec_revision: 'Spec Revision',
    execution_plan: 'Execution Plan',
    execution_plan_revision: 'Execution Plan Revision',
    execution: 'Execution',
    code_review_handoff: 'Code Review Handoff',
    qa_handoff: 'QA Handoff',
    release: 'Release',
    attachment: 'Attachment',
  };
  return labels[type];
}

function attentionReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    product_attention: 'Needs product clarification',
    tech_lead_attention: 'Needs technical breakdown',
    developer_attention: 'Needs developer supervision',
    needs_boundary_approval: 'Needs boundary approval',
    qa_attention: 'Needs QA verification',
    release_owner_attention: 'Needs release decision',
    manager_attention: 'Needs delivery risk review',
  };
  return labels[reason] ?? reason.replaceAll('_', ' ');
}

function blockingGateFor(item: MyWorkQueueItem): string {
  if (item.object_ref.type === 'development_plan_item') return 'Boundary';
  if (item.object_ref.type === 'spec' || item.object_ref.type === 'spec_revision') return 'Spec review';
  if (item.object_ref.type === 'execution_plan' || item.object_ref.type === 'execution_plan_revision') return 'Execution Plan review';
  if (item.object_ref.type === 'execution') return 'Execution supervision';
  if (item.object_ref.type === 'qa_handoff') return 'QA handoff';
  if (item.object_ref.type === 'release') return 'Release readiness';
  return 'Source triage';
}

function openLabelFor(ref: MyWorkQueueItem['object_ref']): string {
  if (ref.type === 'development_plan_item') return 'Open Development Plan Item';
  return `Open ${objectTypeLabel(ref.type)}`;
}

function ageLabel(dueAt: string | undefined): string {
  if (dueAt === undefined) return '2h';
  const dueTime = Date.parse(dueAt);
  if (Number.isNaN(dueTime)) return 'Due date unavailable';
  return dueTime <= Date.now() ? 'Due now' : 'Scheduled';
}

function riskLabelFor(item: MyWorkQueueItem, gateLabel: string): string {
  const signal = `${item.attention_reason} ${item.expected_action ?? ''} ${gateLabel}`.toLowerCase();
  if (signal.includes('blocked') || signal.includes('failed') || signal.includes('stale')) return 'Blocked risk';
  if (item.object_ref.type === 'release' || item.object_ref.type === 'tech_debt' || signal.includes('risk')) return 'High risk';
  if (item.object_ref.type === 'bug' || item.object_ref.type === 'qa_handoff') return 'Verification risk';
  return 'Normal risk';
}

function currentState(rows: MyWorkQueueRow[], degradedSources: readonly string[]): string {
  if (degradedSources.length > 0) return 'Degraded queue signal';
  if (rows.length === 0) return 'Empty queue';
  if (rows.some((row) => row.riskLabel !== 'Normal risk')) return `${rows.length} attention items with risk signals`;
  return `${rows.length} attention items`;
}

function nextAction(rows: MyWorkQueueRow[], bulkAction: ViewModelAction): string {
  if (!bulkAction.enabled) return bulkAction.disabledReason ?? bulkActionUnavailable.disabledReason!;
  return rows[0]?.nextAction ?? bulkAction.label;
}

function primaryRole(rows: MyWorkQueueRow[]): string {
  const firstRiskRow = rows.find((row) => row.riskLabel !== 'Normal risk');
  return `${firstRiskRow?.roleLabel ?? rows[0]?.roleLabel ?? 'Role owner'} responsibility`;
}

function riskSignal(rows: MyWorkQueueRow[], degradedSources: readonly string[]): string {
  if (degradedSources.length > 0) return `Degraded sources: ${degradedSources.join(', ')}`;
  const riskyRows = rows.filter((row) => row.riskLabel !== 'Normal risk');
  if (riskyRows.length === 0) return 'No blocker or risk signal';
  return `${riskyRows.length} blocker or risk-sensitive item(s)`;
}

function queueGateProgress(rows: MyWorkQueueRow[]): ViewModelGate[] {
  if (rows.length === 0) return [{ label: 'Role queue', state: 'empty' }];
  return rows.map((row) => ({
    label: row.gateLabel,
    state: row.statusLabel,
    owner: row.roleLabel,
    disabledReason: row.disabledReason,
    href: row.href,
  }));
}

function queueMetadata(rows: MyWorkQueueRow[]): ViewModelMetadata[] {
  const activeRoles = new Set(rows.map((row) => row.roleId)).size;
  const riskRows = rows.filter((row) => row.riskLabel !== 'Normal risk').length;
  return [
    { label: 'Attention items', value: String(rows.length) },
    { label: 'Roles', value: String(activeRoles) },
    { label: 'Risk signals', value: String(riskRows) },
  ];
}

function queueFilters(rows: MyWorkQueueRow[]): MyWorkQueueFilters {
  return {
    roles: attentionGroups.map((group) => ({
      id: group.id,
      label: group.roleLabel,
      count: rows.filter((row) => row.roleId === group.id).length,
    })),
    statuses: countOptions(rows.map((row) => row.statusLabel)),
    gates: countOptions(rows.map((row) => row.gateLabel)),
    risks: countOptions(rows.map((row) => row.riskLabel)),
  };
}

function countOptions(values: string[]): MyWorkFilterOption[] {
  return Array.from(new Set(values)).map((value) => ({
    id: value,
    label: value,
    count: values.filter((candidate) => candidate === value).length,
  }));
}

function safeBulkActionFor(value: unknown): ViewModelAction | undefined {
  if (!isRecord(value)) return undefined;
  const id = typeof value.id === 'string' && value.id.trim().length > 0 ? value.id : undefined;
  const label = typeof value.label === 'string' && value.label.trim().length > 0 ? value.label : undefined;
  if (id === undefined || label === undefined || typeof value.enabled !== 'boolean') return undefined;
  const disabledReason = typeof value.disabledReason === 'string' && value.disabledReason.trim().length > 0
    ? value.disabledReason
    : typeof value.disabled_reason === 'string' && value.disabled_reason.trim().length > 0
      ? value.disabled_reason
      : undefined;
  const href = typeof value.href === 'string' && value.href.startsWith('/') && !value.href.startsWith('//') ? value.href : undefined;
  return { id, label, enabled: value.enabled, disabledReason, href };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
