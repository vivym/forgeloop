import type { ProductPageViewModel, ViewModelEvidence, ViewModelGate, ViewModelMetadata } from '../product-surfaces/view-model-types';

type SourceRef = { type?: string; id?: string; title?: string; development_plan_id?: string };

interface SourceObjectProjection {
  id: string;
  ref?: SourceRef;
  title?: string;
  status?: string;
  priority?: string;
  risk?: string;
  driver_actor_id?: string;
  updated_at?: string;
  narrative_markdown?: string;
  evidence_refs?: readonly SourceRef[];
  attachment_refs?: readonly SourceRef[];
  relationship_refs?: readonly SourceRef[];
  release_refs?: readonly SourceRef[];
  child_refs?: readonly SourceRef[];
  bug_refs?: readonly SourceRef[];
}

export function sourceObjectListViewModel(source: SourceObjectProjection): ProductPageViewModel {
  const objectType = objectTypeLabel(source.ref?.type);
  const relationships = source.relationship_refs ?? [];
  const linkedPlan = relationships.find((ref) => ref.type === 'development_plan' || ref.type === 'development_plan_item');
  const evidence = sourceEvidence(source);

  return {
    objectLabel: source.title ?? source.id,
    objectType,
    currentState: source.status ?? 'State unavailable',
    nextAction: linkedPlan === undefined ? 'Create Development Plan from source object' : 'Review linked Development Plan',
    disabledReason: undefined,
    primaryActorOrRole: source.driver_actor_id ?? 'Unassigned',
    riskSignal: riskLabel(source.risk),
    gateProgress: sourceGateProgress(source, linkedPlan),
    criticalEvidence: [evidence],
    secondaryMetadata: sourceMetadata(source),
    previewSummary: source.narrative_markdown ?? `${objectType} summary unavailable`,
    timelineSummary: source.updated_at === undefined ? 'Timeline unavailable' : `Updated ${source.updated_at}`,
  };
}

function sourceEvidence(source: SourceObjectProjection): ViewModelEvidence {
  const evidenceCount = uniqueRefCount([...(source.evidence_refs ?? []), ...(source.attachment_refs ?? [])]);
  if (evidenceCount === 0) {
    return {
      label: 'Source evidence',
      state: 'unavailable',
      compactText: 'Evidence readiness unavailable',
      recoveryHref: evidenceHref(source),
    };
  }
  return {
    label: 'Source evidence',
    state: 'available',
    compactText: `${evidenceCount} evidence reference${evidenceCount === 1 ? '' : 's'}`,
    href: evidenceHref(source),
  };
}

function uniqueRefCount(refs: readonly SourceRef[]): number {
  return new Set(refs.map((ref) => `${ref.type ?? 'ref'}:${ref.id ?? ref.title ?? 'unknown'}`)).size;
}

function sourceGateProgress(source: SourceObjectProjection, linkedPlan: SourceRef | undefined): ViewModelGate[] {
  return [
    { label: 'Source triage', state: source.status ?? 'unavailable', owner: source.driver_actor_id },
    {
      label: 'Development Plan',
      state: linkedPlan === undefined ? 'missing' : 'linked',
      href: linkedPlan?.type === 'development_plan' ? `/development-plans/${linkedPlan.id}` : undefined,
    },
  ];
}

function sourceMetadata(source: SourceObjectProjection): ViewModelMetadata[] {
  return [
    { label: 'Priority', value: source.priority ?? 'Unavailable' },
    { label: 'Related objects', value: String((source.relationship_refs?.length ?? 0) + (source.child_refs?.length ?? 0) + (source.bug_refs?.length ?? 0)) },
    { label: 'Release refs', value: String(source.release_refs?.length ?? 0) },
  ];
}

function evidenceHref(source: SourceObjectProjection): string | undefined {
  const type = source.ref?.type;
  if (type === 'requirement') return `/requirements/${source.id}/evidence`;
  if (type === 'initiative') return `/initiatives/${source.id}/evidence`;
  if (type === 'bug') return `/bugs/${source.id}/evidence`;
  if (type === 'tech_debt') return `/tech-debt/${source.id}/evidence`;
  return undefined;
}

function objectTypeLabel(type: string | undefined): string {
  const labels: Record<string, string> = {
    requirement: 'Requirement',
    bug: 'Bug',
    tech_debt: 'Tech Debt',
    initiative: 'Initiative',
  };
  return type === undefined ? 'Source Object' : labels[type] ?? formatValue(type);
}

function riskLabel(risk: string | undefined): string {
  return risk === undefined ? 'Risk unavailable' : `${formatValue(risk)} risk`;
}

function formatValue(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}
