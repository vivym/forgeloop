import type { ProductPageViewModel, ViewModelAction, ViewModelGate, ViewModelMetadata } from '../product-surfaces/view-model-types';

type MyWorkRef = { type: string; id: string; development_plan_id?: string };

interface MyWorkQueueProjection {
  items?: readonly {
    id: string;
    object_ref: MyWorkRef;
    title: string;
    attention_reason: string;
    expected_action?: string;
    actor_id?: string;
    href?: string;
  }[];
  degraded_sources?: readonly string[];
  bulk_action?: ViewModelAction;
}

export function myWorkQueueViewModel(queue: MyWorkQueueProjection): ProductPageViewModel {
  const items = queue.items ?? [];
  const firstItem = items[0];
  const bulkAction = queue.bulk_action ?? {
    id: 'safe-bulk-action-unavailable',
    label: 'No shared safe bulk action',
    enabled: false,
    disabledReason: 'No shared safe bulk action',
  };

  return {
    objectLabel: 'My Work',
    objectType: 'Role Queue',
    currentState: queue.degraded_sources?.length ? 'Degraded' : `${items.length} attention item${items.length === 1 ? '' : 's'}`,
    nextAction: firstItem?.expected_action ?? 'Review role queue',
    disabledReason: bulkAction.enabled ? undefined : bulkAction.disabledReason,
    primaryActorOrRole: firstItem?.actor_id ?? 'Role owner',
    riskSignal: riskSignal(items),
    gateProgress: queueGateProgress(items),
    criticalEvidence: [
      {
        label: 'Bulk action eligibility',
        state: bulkAction.enabled ? 'available' : 'unavailable',
        compactText: bulkAction.enabled ? bulkAction.label : 'No shared safe bulk action',
      },
    ],
    secondaryMetadata: queueMetadata(items),
    previewSummary: items.map((item) => item.title).join(', ') || 'No attention items',
    timelineSummary: queue.degraded_sources?.length ? `Degraded sources: ${queue.degraded_sources.join(', ')}` : 'Queue projection current',
    bulkAction,
    items: items.map((item) => ({ label: item.title, value: item.expected_action ?? 'Review', href: item.href })),
  };
}

function queueGateProgress(items: NonNullable<MyWorkQueueProjection['items']>): ViewModelGate[] {
  if (items.length === 0) return [{ label: 'Role queue', state: 'empty' }];
  return items.map((item) => ({
    label: objectTypeLabel(item.object_ref.type),
    state: item.attention_reason,
    owner: item.actor_id,
    href: item.href,
  }));
}

function queueMetadata(items: NonNullable<MyWorkQueueProjection['items']>): ViewModelMetadata[] {
  const roleCount = new Set(items.map((item) => item.actor_id ?? 'unassigned')).size;
  return [
    { label: 'Attention items', value: String(items.length) },
    { label: 'Actors', value: String(roleCount) },
  ];
}

function riskSignal(items: NonNullable<MyWorkQueueProjection['items']>): string {
  const blocked = items.filter((item) => item.attention_reason.includes('blocked') || item.attention_reason.includes('release')).length;
  return blocked === 0 ? 'No explicit blocker signal' : `${blocked} blocker-sensitive item(s)`;
}

function objectTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    requirement: 'Requirement',
    initiative: 'Initiative',
    tech_debt: 'Tech Debt',
    bug: 'Bug',
    development_plan_item: 'Development Plan Item',
    release: 'Release',
  };
  return labels[type] ?? type.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}
