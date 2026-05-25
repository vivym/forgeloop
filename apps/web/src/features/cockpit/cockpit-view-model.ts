import { canonicalProductRoutes } from '../product-surfaces/route-contract';
import type { ProductPageViewModel, ViewModelEvidence, ViewModelGate, ViewModelMetadata } from '../product-surfaces/view-model-types';

type DashboardSection = {
  id?: string;
  label?: string;
  value?: unknown;
  metrics?: readonly { label?: string; value?: unknown }[];
};
type DashboardAction = { id?: string; label?: string; href?: string; enabled?: boolean };

interface DashboardCockpitProjection {
  project_id: string;
  sections?: readonly DashboardSection[];
  next_actions?: readonly DashboardAction[];
  report_links?: readonly DashboardAction[];
  degraded_sources?: readonly string[];
}

export interface DashboardCockpitViewModel extends ProductPageViewModel {
  roleSelectedQueue: ViewModelMetadata[];
  blockerAndStaleGates: ViewModelGate[];
  activeExecutionItems: ViewModelMetadata[];
  specExecutionPlanItems: ViewModelMetadata[];
  qaReleaseAttentionItems: ViewModelMetadata[];
  compactHealthIndicators: ViewModelMetadata[];
}

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
  const explicitEnabledAction = readiness?.next_actions?.find((action) => action.enabled === true);
  const hasActionWithoutEligibility = readiness?.next_actions?.some((action) => action.enabled !== true) ?? false;
  const nextAction = explicitEnabledAction?.label ?? firstBlockingLabel(readiness?.stages) ?? 'Review cockpit readiness';

  return {
    objectLabel: cockpit.item.title ?? cockpit.item.id,
    objectType: objectTypeLabel(cockpit.item.kind),
    currentState: readiness?.overall_state ?? cockpit.item.phase ?? 'State unavailable',
    nextAction,
    disabledReason: blockers[0]?.label ?? (hasActionWithoutEligibility ? 'Next action eligibility unavailable' : undefined),
    primaryActorOrRole: cockpit.item.driver_actor_id ?? readiness?.active_lane ?? 'Unassigned',
    riskSignal: riskLabel(cockpit.item.risk, blockers.length),
    gateProgress: gateProgress(readiness?.stages),
    criticalEvidence: evidenceSummary(readiness),
    secondaryMetadata: cockpitMetadata(cockpit),
    previewSummary: `${cockpit.packages?.length ?? 0} package(s), ${cockpit.run_sessions?.length ?? 0} run(s), ${cockpit.review_packets?.length ?? 0} review packet(s)`,
    timelineSummary: cockpit.item.updated_at === undefined ? 'Timeline unavailable' : `Updated ${cockpit.item.updated_at}`,
  };
}

export function dashboardCockpitViewModel(cockpit: DashboardCockpitProjection): DashboardCockpitViewModel {
  const sections = cockpit.sections ?? [];
  const degradedSources = cockpit.degraded_sources ?? [];
  const roleSelectedQueue = roleQueueItems(cockpit.next_actions, cockpit.report_links);
  const blockerAndStaleGates = dashboardGateProgress(sections, degradedSources);
  const compactHealthIndicators = dashboardHealthIndicators(cockpit.project_id, sections, degradedSources);
  const blockedWork = sectionNumericValue(sections, 'blocked-work');
  const releaseConfidence = sectionNumericValue(sections, 'release-confidence');
  const nextAction = roleSelectedQueue[0]?.label ?? 'Review role-selected cockpit queue';

  return {
    objectLabel: 'Cockpit',
    objectType: 'Workspace',
    currentState: dashboardCurrentState(sections, degradedSources, blockedWork, releaseConfidence),
    nextAction,
    disabledReason: degradedSources.length > 0 ? 'Cockpit signal includes stale sources' : undefined,
    primaryActorOrRole: roleForDashboardAction(nextAction),
    riskSignal: dashboardRiskSignal(sections, degradedSources, blockedWork),
    gateProgress: blockerAndStaleGates,
    criticalEvidence: dashboardEvidenceSummary(cockpit.report_links, degradedSources),
    secondaryMetadata: compactHealthIndicators,
    previewSummary: `${roleSelectedQueue.length} queue item(s), ${sections.length} health indicator(s)`,
    timelineSummary: degradedSources.length > 0 ? `Degraded sources: ${degradedSources.join(', ')}` : 'Cockpit projection current',
    roleSelectedQueue,
    blockerAndStaleGates,
    activeExecutionItems: categorizedItems(roleSelectedQueue, /execution|resumable|continuation|run/i, {
      label: 'Execution supervision',
      value: 'No active or resumable execution signal',
      href: '/executions',
    }),
    specExecutionPlanItems: categorizedItems(roleSelectedQueue, /spec|execution plan|plan review/i, {
      label: 'Spec / Execution Plan review',
      value: 'No pending review signal',
      href: '/specs-plans',
    }),
    qaReleaseAttentionItems: qaReleaseItems(sections, roleSelectedQueue),
    compactHealthIndicators,
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

function roleQueueItems(
  nextActions: readonly DashboardAction[] | undefined,
  reportLinks: readonly DashboardAction[] | undefined,
): ViewModelMetadata[] {
  const actions = (nextActions ?? []).map((action, index) => ({
    label: action.label ?? `Next action ${index + 1}`,
    value: 'Next action',
    href: safeProductHref(action.href),
  }));
  const reports = (reportLinks ?? []).map((link, index) => ({
    label: link.label ?? `Report ${index + 1}`,
    value: 'Report follow-up',
    href: reportHref(link),
  }));

  const items = [...actions, ...reports];
  return items.length > 0
    ? items
    : [{ label: 'Review Cockpit', value: 'No role-selected queue signal', href: '/my-work' }];
}

function dashboardGateProgress(sections: readonly DashboardSection[], degradedSources: readonly string[]): ViewModelGate[] {
  const gates = sections
    .filter((section) => /blocked|aging|risk|release/i.test(`${section.id ?? ''} ${section.label ?? ''}`))
    .map((section) => ({
      label: section.label ?? section.id ?? 'Gate',
      state: dashboardGateState(section),
      disabledReason: section.id === 'aging' && sectionNumericValue([section], 'aging') > 0 ? 'Aging threshold exceeded' : undefined,
    }));

  if (degradedSources.length > 0) {
    gates.push({
      label: 'Stale sources',
      state: 'stale',
      disabledReason: degradedSources.join(', '),
    });
  }

  return gates.length > 0 ? gates : [{ label: 'Cockpit gates', state: 'current' }];
}

function dashboardHealthIndicators(
  projectId: string,
  sections: readonly DashboardSection[],
  degradedSources: readonly string[],
): ViewModelMetadata[] {
  const indicators = sections.map((section) => ({
    label: section.label ?? section.id ?? 'Signal',
    value: sectionValueLabel(section.value),
  }));

  return [
    { label: 'Project', value: projectId },
    ...indicators,
    { label: 'Stale sources', value: String(degradedSources.length) },
  ];
}

function dashboardEvidenceSummary(
  reportLinks: readonly DashboardAction[] | undefined,
  degradedSources: readonly string[],
): ViewModelEvidence[] {
  const reportCount = reportLinks?.length ?? 0;
  if (degradedSources.length > 0) {
    return [{ label: 'Cockpit evidence', state: 'stale', compactText: 'Evidence degraded' }];
  }
  return [
    {
      label: 'Cockpit evidence',
      state: reportCount > 0 ? 'available' : 'unavailable',
      compactText: reportCount > 0 ? `${reportCount} report link(s)` : 'Evidence unavailable',
    },
  ];
}

function dashboardCurrentState(
  sections: readonly DashboardSection[],
  degradedSources: readonly string[],
  blockedWork: number,
  releaseConfidence: number,
): string {
  if (degradedSources.length > 0) return 'Stale cockpit signal';
  if (blockedWork > 0) return 'Blocked work present';
  if (sections.length === 0) return 'Cockpit signal unavailable';
  if (releaseConfidence > 0) return 'Release confidence available';
  return 'Delivery signals current';
}

function dashboardRiskSignal(
  sections: readonly DashboardSection[],
  degradedSources: readonly string[],
  blockedWork: number,
): string {
  const riskCount = sectionNumericValue(sections, 'risk-concentration');
  if (degradedSources.length > 0) return 'Stale source risk';
  if (blockedWork > 0) return `${blockedWork} blocked work item(s)`;
  if (riskCount > 0) return `${riskCount} risk concentration signal(s)`;
  return 'No blocker signal';
}

function qaReleaseItems(sections: readonly DashboardSection[], queue: readonly ViewModelMetadata[]): ViewModelMetadata[] {
  const sectionItems = sections
    .filter((section) => /qa|quality|release/i.test(`${section.id ?? ''} ${section.label ?? ''}`))
    .map((section) => ({
      label: section.label ?? section.id ?? 'QA / release signal',
      value: sectionValueLabel(section.value),
      href: /release/i.test(`${section.id ?? ''} ${section.label ?? ''}`) ? '/reports/release-readiness' : '/reports/quality',
    }));
  const queueItems = categorizedItems(queue, /qa|quality|release/i, undefined);
  const items = [...sectionItems, ...queueItems];
  return items.length > 0
    ? items
    : [{ label: 'QA and release readiness', value: 'No readiness attention signal', href: '/reports/release-readiness' }];
}

function categorizedItems(
  items: readonly ViewModelMetadata[],
  pattern: RegExp,
  fallback: ViewModelMetadata | undefined,
): ViewModelMetadata[] {
  const matched = items.filter((item) => pattern.test(`${item.label} ${item.value} ${item.href ?? ''}`));
  return matched.length > 0 ? matched : fallback === undefined ? [] : [fallback];
}

function roleForDashboardAction(action: string): string {
  const text = action.toLowerCase();
  if (text.includes('execution') || text.includes('run')) return 'Developer';
  if (text.includes('qa') || text.includes('quality')) return 'QA';
  if (text.includes('release')) return 'Release owner';
  if (text.includes('spec') || text.includes('plan')) return 'Tech Lead';
  return 'Product owner';
}

function dashboardGateState(section: DashboardSection): string {
  const value = sectionNumericValue([section], section.id);
  if (value === 0) return 'current';
  if (/blocked|risk|aging/i.test(`${section.id ?? ''} ${section.label ?? ''}`)) return `${value} signal(s)`;
  return sectionValueLabel(section.value);
}

function sectionNumericValue(sections: readonly DashboardSection[], sectionId: string | undefined): number {
  const section = sections.find((candidate) => candidate.id === sectionId);
  if (section === undefined) return 0;
  return asNumber(section.value);
}

function sectionValueLabel(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string' && value.trim().length > 0) return value;
  return 'Unavailable';
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

const registeredReportHrefs = new Set(['/reports', '/reports/delivery', '/reports/quality', '/reports/release-readiness', '/reports/observation']);
const canonicalCockpitRoutePatterns = canonicalProductRoutes.map((route) => route.path.split('/').filter(Boolean));

function reportHref(link: DashboardAction): string | undefined {
  if (link.href !== undefined) {
    const href = safeProductHref(link.href);
    if (href === undefined) return undefined;
    const reportPathname = new URL(href, 'https://forgeloop.local').pathname;
    return registeredReportHrefs.has(reportPathname) ? href : undefined;
  }

  return inferredReportHref(link) ?? '/reports';
}

function inferredReportHref(link: DashboardAction): string | undefined {
  const id = `${link.id ?? ''} ${link.label ?? ''}`.toLowerCase();
  if (id.includes('release')) return '/reports/release-readiness';
  if (id.includes('quality') || id.includes('qa') || id.includes('code-review')) return '/reports/quality';
  if (id.includes('observation')) return '/reports/observation';
  if (id.includes('delivery') || id.includes('execution') || id.includes('spec') || id.includes('brainstorming')) return '/reports/delivery';
  return undefined;
}

function safeProductHref(href: string | undefined): string | undefined {
  if (href === undefined) return undefined;
  if (!href.startsWith('/') || href.startsWith('//')) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(href, 'https://forgeloop.local');
  } catch {
    return undefined;
  }
  if (parsed.origin !== 'https://forgeloop.local' || parsed.hash.length > 0) return undefined;
  if (!isCanonicalCockpitProductPath(parsed.pathname)) return undefined;
  return `${parsed.pathname}${parsed.search}`;
}

function isCanonicalCockpitProductPath(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  return canonicalCockpitRoutePatterns.some((pattern) => productPathSegmentsMatch(pattern, segments));
}

function productPathSegmentsMatch(pattern: string[], segments: string[]): boolean {
  if (pattern.length !== segments.length) return false;
  return pattern.every((segment, index) => segment.startsWith(':') || segment === segments[index]);
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
