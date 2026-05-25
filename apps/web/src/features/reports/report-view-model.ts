import type { ProductPageViewModel, ViewModelAction } from '../product-surfaces/view-model-types';

type ReportGroup = { id?: string; count?: number; items?: readonly unknown[] };
type ReportLink = { id?: string; href?: string };

interface ReportProjection {
  id: string;
  title?: string;
  project_id?: string;
  generated_at?: string;
  groups?: readonly ReportGroup[];
  links?: readonly ReportLink[];
  degraded_sources?: readonly string[];
}

export function reportViewModel(report: ReportProjection): ProductPageViewModel {
  const groups = report.groups ?? [];
  const links = report.links ?? [];
  const hasSignal = groups.length > 0 && (report.degraded_sources?.length ?? 0) === 0;
  const suggestedAction = hasSignal ? linkAction(links[0]) : undefined;
  const conclusion = hasSignal ? `${sentenceCase(reportTitle(report.id))} signal available` : 'Insufficient signal';

  return {
    objectLabel: report.title ?? reportTitle(report.id),
    objectType: 'Report',
    currentState: hasSignal ? 'Signal available' : 'Insufficient signal',
    nextAction: suggestedAction?.label ?? (hasSignal ? 'Review report' : 'Collect report signal'),
    disabledReason: hasSignal ? undefined : 'Insufficient signal',
    primaryActorOrRole: 'Manager',
    riskSignal: riskSignal(report),
    gateProgress: [
      { label: 'Report signal', state: hasSignal ? 'available' : 'unavailable' },
      { label: 'Suggested action', state: suggestedAction === undefined ? 'unavailable' : 'available' },
    ],
    criticalEvidence: [
      {
        label: 'Report groups',
        state: hasSignal ? 'available' : 'unavailable',
        compactText: hasSignal ? `${groups.length} populated group(s)` : 'Insufficient signal',
      },
    ],
    secondaryMetadata: [
      { label: 'Groups', value: String(groups.length) },
      { label: 'Links', value: String(links.length) },
    ],
    previewSummary: groups.map((group) => `${group.id ?? 'group'}: ${group.count ?? 0}`).join(', ') || 'Report signal unavailable',
    timelineSummary: report.generated_at === undefined ? 'Timeline unavailable' : `Generated ${report.generated_at}`,
    conclusion,
    suggestedAction,
  };
}

function linkAction(link: ReportLink | undefined): ViewModelAction | undefined {
  if (link?.id === undefined || link.href === undefined) return undefined;
  return {
    id: link.id,
    label: `Open ${reportTitle(link.id)} report`,
    enabled: true,
    href: link.href,
  };
}

function reportTitle(id: string): string {
  const labels: Record<string, string> = {
    'development-plan-throughput': 'Development Plan Throughput',
    'quality-bug-escape': 'Quality Bug Escape',
    'release-readiness': 'Release Readiness',
    'execution-outcomes': 'Execution Outcomes',
    'execution-continuation': 'Execution Continuation',
  };
  return labels[id] ?? id.replaceAll('-', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

function riskSignal(report: ReportProjection): string {
  if ((report.degraded_sources?.length ?? 0) > 0) return 'Degraded report signal';
  const total = (report.groups ?? []).reduce((sum, group) => sum + (group.count ?? 0), 0);
  return total === 0 ? 'No report count signal' : `${total} total report signal(s)`;
}

function sentenceCase(value: string): string {
  const lower = value.toLowerCase();
  return lower.length === 0 ? lower : `${lower[0]!.toUpperCase()}${lower.slice(1)}`;
}
