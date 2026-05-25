import type { ProductPageViewModel, ViewModelEvidence, ViewModelGate, ViewModelMetadata } from '../product-surfaces/view-model-types';

type CockpitRef = { type?: string; id?: string; title?: string };
type CockpitStage = {
  id?: string;
  label?: string;
  state?: string;
  owner_lane?: string;
  blockers?: readonly { label?: string; severity?: string }[];
  evidence_refs?: readonly CockpitRef[];
};

interface CockpitProjection {
  item: {
    id: string;
    kind?: string;
    title?: string;
    phase?: string;
    risk?: string;
    driver_actor_id?: string;
    updated_at?: string;
  };
  packages?: readonly unknown[];
  run_sessions?: readonly unknown[];
  review_packets?: readonly unknown[];
  delivery_readiness?: {
    overall_state?: string;
    active_lane?: string;
    stages?: readonly CockpitStage[];
    blockers?: readonly { label?: string; severity?: string }[];
    evidence?: readonly CockpitRef[];
    degraded_sources?: readonly string[];
    next_actions?: readonly { label?: string; enabled?: boolean; disabled_reason?: string }[];
  };
}

export function cockpitViewModel(cockpit: CockpitProjection): ProductPageViewModel {
  const readiness = cockpit.delivery_readiness;
  const blockers = readiness?.blockers ?? [];
  const nextAction = readiness?.next_actions?.find((action) => action.enabled !== false)?.label ?? firstBlockingLabel(readiness?.stages) ?? 'Review cockpit readiness';

  return {
    objectLabel: cockpit.item.title ?? cockpit.item.id,
    objectType: objectTypeLabel(cockpit.item.kind),
    currentState: readiness?.overall_state ?? cockpit.item.phase ?? 'State unavailable',
    nextAction,
    disabledReason: blockers[0]?.label,
    primaryActorOrRole: cockpit.item.driver_actor_id ?? readiness?.active_lane ?? 'Unassigned',
    riskSignal: riskLabel(cockpit.item.risk, blockers.length),
    gateProgress: gateProgress(readiness?.stages),
    criticalEvidence: evidenceSummary(readiness),
    secondaryMetadata: cockpitMetadata(cockpit),
    previewSummary: `${cockpit.packages?.length ?? 0} package(s), ${cockpit.run_sessions?.length ?? 0} run(s), ${cockpit.review_packets?.length ?? 0} review packet(s)`,
    timelineSummary: cockpit.item.updated_at === undefined ? 'Timeline unavailable' : `Updated ${cockpit.item.updated_at}`,
  };
}

function gateProgress(stages: readonly CockpitStage[] | undefined): ViewModelGate[] {
  if (stages === undefined || stages.length === 0) {
    return [{ label: 'Delivery readiness', state: 'unavailable' }];
  }
  return stages.map((stage) => ({
    label: stage.label ?? stage.id ?? 'Gate',
    state: stage.state ?? 'unavailable',
    owner: stage.owner_lane,
    disabledReason: stage.blockers?.[0]?.label,
  }));
}

function evidenceSummary(readiness: CockpitProjection['delivery_readiness']): ViewModelEvidence[] {
  const evidenceCount = readiness?.evidence?.length ?? 0;
  if (evidenceCount === 0 || readiness?.degraded_sources?.length) {
    return [
      {
        label: 'Cockpit evidence',
        state: readiness?.degraded_sources?.length ? 'stale' : 'unavailable',
        compactText: readiness?.degraded_sources?.length ? 'Evidence degraded' : 'Evidence unavailable',
      },
    ];
  }
  return [{ label: 'Cockpit evidence', state: 'available', compactText: `${evidenceCount} evidence reference(s)` }];
}

function cockpitMetadata(cockpit: CockpitProjection): ViewModelMetadata[] {
  return [
    { label: 'Active lane', value: cockpit.delivery_readiness?.active_lane ?? 'Unavailable' },
    { label: 'Packages', value: String(cockpit.packages?.length ?? 0) },
    { label: 'Review packets', value: String(cockpit.review_packets?.length ?? 0) },
  ];
}

function firstBlockingLabel(stages: readonly CockpitStage[] | undefined): string | undefined {
  return stages?.flatMap((stage) => stage.blockers ?? [])[0]?.label;
}

function objectTypeLabel(type: string | undefined): string {
  const labels: Record<string, string> = {
    requirement: 'Requirement',
    bug: 'Bug',
    tech_debt: 'Tech Debt',
    initiative: 'Initiative',
  };
  return type === undefined ? 'Work Item' : labels[type] ?? formatValue(type);
}

function riskLabel(risk: string | undefined, blockerCount: number): string {
  const base = risk === undefined ? 'Risk unavailable' : `${formatValue(risk)} risk`;
  return blockerCount === 0 ? base : `${base}; ${blockerCount} blocker(s)`;
}

function formatValue(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}
