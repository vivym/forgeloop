import type { ProductPageViewModel, ViewModelGate } from '../product-surfaces/view-model-types';

interface SpecPlanQueueItem {
  id: string;
  artifact_type?: string;
  title?: string;
  status?: string;
  gate_state?: string;
  reviewer_actor_id?: string;
  risk?: string;
  next_action?: string;
  href?: string;
}

interface SpecPlanQueueProjection {
  items?: readonly SpecPlanQueueItem[];
  degraded_sources?: readonly string[];
}

export function specPlanQueueViewModel(queue: SpecPlanQueueProjection): ProductPageViewModel {
  const items = queue.items ?? [];
  const firstItem = items[0];
  const blockedCount = items.filter((item) => `${item.status ?? ''} ${item.gate_state ?? ''}`.includes('blocked')).length;

  return {
    objectLabel: 'Specs & Execution Plans',
    objectType: 'Governance Queue',
    currentState: queue.degraded_sources?.length ? 'Degraded' : `${items.length} governance item${items.length === 1 ? '' : 's'}`,
    nextAction: firstItem?.next_action ?? 'No pending Spec or Execution Plan action',
    disabledReason: undefined,
    primaryActorOrRole: firstItem?.reviewer_actor_id ?? 'Technical reviewer',
    riskSignal: blockedCount === 0 ? 'No blocked governance signal' : `${blockedCount} blocked governance item(s)`,
    gateProgress: gateProgress(items),
    criticalEvidence: [
      {
        label: 'Governance queue',
        state: items.length === 0 ? 'unavailable' : 'available',
        compactText: items.length === 0 ? 'No governance signal' : `${items.length} item(s)`,
      },
    ],
    secondaryMetadata: [
      { label: 'Spec rows', value: String(items.filter((item) => item.artifact_type === 'spec').length) },
      { label: 'Execution Plan rows', value: String(items.filter((item) => item.artifact_type === 'execution_plan').length) },
    ],
    previewSummary: items.map((item) => item.title ?? item.id).join(', ') || 'Queue empty',
    timelineSummary: queue.degraded_sources?.length ? `Degraded sources: ${queue.degraded_sources.join(', ')}` : 'Queue projection current',
  };
}

function gateProgress(items: readonly SpecPlanQueueItem[]): ViewModelGate[] {
  if (items.length === 0) return [{ label: 'Governance', state: 'empty' }];
  return items.map((item) => ({
    label: item.title ?? item.id,
    state: item.gate_state ?? item.status ?? 'unavailable',
    owner: item.reviewer_actor_id,
    href: item.href,
  }));
}
