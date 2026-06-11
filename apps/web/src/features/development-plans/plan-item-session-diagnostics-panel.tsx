import { AlertTriangle, CheckCircle2, Wrench } from 'lucide-react';

import { usePlanItemSessionDiagnosticsQuery } from '../../shared/api/hooks';
import type { PlanItemSessionDiagnostics } from '../../shared/api/types';
import { InlineNotice, StatusPill } from '../../shared/ui';

export function PlanItemSessionDiagnosticsPanel({ planItemId }: { planItemId: string }) {
  const diagnosticsQuery = usePlanItemSessionDiagnosticsQuery(planItemId);
  const diagnostics = diagnosticsQuery.data;

  if (diagnosticsQuery.isLoading) {
    return (
      <section aria-label="Session health" className="grid gap-2 rounded-md border border-border bg-background p-3">
        <p className="text-sm font-semibold text-text-primary">Session health</p>
        <p className="text-sm text-text-secondary">Loading session health...</p>
      </section>
    );
  }

  if (diagnosticsQuery.isError || diagnostics === undefined) {
    return <InlineNotice title="Session health unavailable." tone="warning" />;
  }

  if (diagnostics.workflow_resolution === 'no_active_workflow') {
    return <InlineNotice title="No active workflow session yet." tone="info" />;
  }

  if (diagnostics.workflow_resolution === 'ambiguous_workflows') {
    return <InlineNotice title="Workflow lineage needs operator review." tone="danger" />;
  }

  return (
    <section aria-label="Session health" className="grid gap-3 rounded-md border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-xs font-semibold uppercase tracking-normal text-text-muted">Session health</p>
          <h3 className="text-sm font-semibold text-text-primary">{diagnostics.summary}</h3>
        </div>
        {diagnostics.state ? <StatusPill tone={diagnosticsTone(diagnostics)}>{diagnostics.state}</StatusPill> : null}
      </div>

      {diagnostics.operator_intervention_required ? (
        <InlineNotice title="Operator intervention required before normal workflow actions can continue." tone="warning" />
      ) : null}

      <div className="grid gap-2 text-sm">
        <DiagnosticRow label="Workflow resolution" value={formatLabel(diagnostics.workflow_resolution)} />
        <DiagnosticRow label="Workflow actions" value={diagnostics.normal_workflow_actions_available ? 'Available' : 'Paused'} />
      </div>

      {diagnostics.latest_checkpoint ? (
        <p className="text-xs text-text-secondary">
          Latest checkpoint: {diagnostics.latest_checkpoint.checkpoint_id}
        </p>
      ) : null}

      <div className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-muted">
        {statusIcon(diagnostics)}
        <p>Continue, fork, and archive remain separate human actions.</p>
      </div>
    </section>
  );
}

function formatLabel(value: string) {
  return value.replaceAll('_', ' ');
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-semibold uppercase tracking-normal text-text-muted">{label}</span>
      <span className="break-words text-text-secondary">{value}</span>
    </div>
  );
}

function diagnosticsTone(diagnostics: PlanItemSessionDiagnostics) {
  if (diagnostics.severity === 'blocked' || diagnostics.severity === 'critical') return 'danger';
  if (diagnostics.severity === 'warning') return 'warning';
  if (diagnostics.state === 'healthy') return 'success';
  return 'info';
}

function statusIcon(diagnostics: PlanItemSessionDiagnostics) {
  if (diagnostics.operator_intervention_required) {
    return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />;
  }
  if (diagnostics.state === 'healthy') {
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />;
  }
  return <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />;
}
