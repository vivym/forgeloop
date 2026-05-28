import type { ProductPageViewModel, ViewModelEvidence, ViewModelGate, ViewModelMetadata } from '../product-surfaces/view-model-types';

type SourceRef = { type?: string | undefined; id?: string | undefined; title?: string | undefined; development_plan_id?: string | undefined };

interface SourceObjectProjection {
  id: string;
  ref?: SourceRef | undefined;
  title?: string | undefined;
  status?: string | undefined;
  priority?: string | undefined;
  risk?: string | undefined;
  driver_actor_id?: string | undefined;
  updated_at?: string | undefined;
  narrative_markdown?: string | undefined;
  evidence_refs?: readonly SourceRef[] | undefined;
  attachment_refs?: readonly SourceRef[] | undefined;
  relationship_refs?: readonly SourceRef[] | undefined;
  release_refs?: readonly SourceRef[] | undefined;
  child_refs?: readonly SourceRef[] | undefined;
  bug_refs?: readonly SourceRef[] | undefined;
}

export function sourceObjectListViewModel(source: SourceObjectProjection): ProductPageViewModel {
  const objectType = objectTypeLabel(source.ref?.type);
  const relationshipsKnown = source.relationship_refs !== undefined;
  const linkedPlan = source.relationship_refs?.find((ref) => ref.type === 'development_plan' || ref.type === 'development_plan_item');
  const evidence = sourceEvidence(source);

  return {
    objectLabel: source.title ?? source.id,
    objectType,
    currentState: source.status ?? 'State unavailable',
    nextAction: sourceNextAction(relationshipsKnown, linkedPlan),
    disabledReason: undefined,
    primaryActorOrRole: source.driver_actor_id ?? 'Unassigned',
    riskSignal: riskLabel(source.risk),
    gateProgress: sourceGateProgress(source, relationshipsKnown, linkedPlan),
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

function sourceNextAction(relationshipsKnown: boolean, linkedPlan: SourceRef | undefined): string {
  if (!relationshipsKnown) return 'Open source object to inspect planning state';
  return linkedPlan === undefined ? 'Create Development Plan from source object' : 'Review linked Development Plan';
}

function sourceGateProgress(source: SourceObjectProjection, relationshipsKnown: boolean, linkedPlan: SourceRef | undefined): ViewModelGate[] {
  return [
    { label: 'Source triage', state: source.status ?? 'unavailable', owner: source.driver_actor_id },
    {
      label: 'Development Plan',
      state: !relationshipsKnown ? 'unknown' : linkedPlan === undefined ? 'missing' : 'linked',
      href: developmentPlanHref(linkedPlan),
    },
  ];
}

function developmentPlanHref(linkedPlan: SourceRef | undefined): string | undefined {
  if (linkedPlan?.type === 'development_plan' && linkedPlan.id !== undefined) return `/development-plans/${linkedPlan.id}`;
  if (linkedPlan?.type === 'development_plan_item' && linkedPlan.development_plan_id !== undefined && linkedPlan.id !== undefined) {
    return `/development-plans/${linkedPlan.development_plan_id}/items/${linkedPlan.id}`;
  }
  return undefined;
}

function sourceMetadata(source: SourceObjectProjection): ViewModelMetadata[] {
  return [
    { label: 'Priority', value: source.priority ?? 'Unavailable' },
    { label: 'Related objects', value: relatedObjectCount(source) },
    { label: 'Release refs', value: source.release_refs === undefined ? 'Unavailable' : String(source.release_refs.length) },
  ];
}

function relatedObjectCount(source: SourceObjectProjection): string {
  if (source.relationship_refs === undefined) return 'Unavailable';
  return String(source.relationship_refs.length + (source.child_refs?.length ?? 0) + (source.bug_refs?.length ?? 0));
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
