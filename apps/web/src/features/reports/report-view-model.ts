import type { ProductPageViewModel, ViewModelAction } from '../product-surfaces/view-model-types';

interface ReportRow {
  label?: string;
  value?: string | number;
  risk?: string;
  conclusion?: string;
  suggested_action?: {
    id?: string;
    label?: string;
    href?: string;
    enabled?: boolean;
    disabledReason?: string;
  };
}

interface ReportProjection {
  id: string;
  title?: string;
  project_id?: string;
  generated_at?: string;
  rows?: readonly ReportRow[];
  degraded_sources?: readonly string[];
  risk_counts?: Record<string, number>;
  linked_object_refs?: readonly { id?: string; title?: string; type?: string }[];
}

export function reportViewModel(report: ReportProjection): ProductPageViewModel {
  const rows = report.rows ?? [];
  const hasSignal = rows.length > 0 && (report.degraded_sources?.length ?? 0) === 0;
  const firstSuggestedAction = hasSignal ? rows.find((row) => row.suggested_action !== undefined)?.suggested_action : undefined;
  const suggestedAction = firstSuggestedAction === undefined ? undefined : toAction(firstSuggestedAction);
  const conclusion = hasSignal ? rows.find((row) => row.conclusion !== undefined)?.conclusion ?? 'Signal available' : 'Insufficient signal';

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
        label: 'Report signal',
        state: hasSignal ? 'available' : 'unavailable',
        compactText: hasSignal ? `${rows.length} row(s)` : 'Insufficient signal',
      },
    ],
    secondaryMetadata: [
      { label: 'Rows', value: String(rows.length) },
      { label: 'Linked objects', value: String(report.linked_object_refs?.length ?? 0) },
    ],
    previewSummary: rows.map((row) => `${row.label ?? 'Metric'}: ${row.value ?? row.conclusion ?? 'Available'}`).join(', ') || 'Report signal unavailable',
    timelineSummary: report.generated_at === undefined ? 'Timeline unavailable' : `Generated ${report.generated_at}`,
    conclusion,
    suggestedAction,
  };
}

function toAction(action: NonNullable<ReportRow['suggested_action']>): ViewModelAction {
  return {
    id: action.id ?? 'report-suggested-action',
    label: action.label ?? 'Review report action',
    enabled: action.enabled ?? true,
    disabledReason: action.disabledReason,
    href: action.href,
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
  const counts = report.risk_counts;
  if (counts === undefined) return (report.degraded_sources?.length ?? 0) === 0 ? 'Risk signal unavailable' : 'Degraded report signal';
  const highRisk = (counts.high ?? 0) + (counts.critical ?? 0);
  return highRisk === 0 ? 'No high risk report signal' : `${highRisk} high risk signal(s)`;
}
