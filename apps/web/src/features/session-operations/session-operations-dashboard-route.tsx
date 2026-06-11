import { useMemo, useState } from 'react';

import {
  useRecoverSessionMutation,
  useScavengeSessionOperationsMutation,
  useSessionOperationsAuditQuery,
  useSessionOperationsHealthQuery,
} from '../../shared/api/hooks';
import type {
  OperatorSessionHealthProjection,
  PlanItemSessionHealthState,
  RecoverSessionRequest,
  ScavengeSessionOperationsRequest,
  SessionOperationsAuditResponse,
  SessionOperationsHealthQuery,
  SessionRecoveryCandidatePredicate,
} from '../../shared/api/types';
import { PageHeader, Section } from '../../shared/layout';
import { Button, InlineNotice, StatusPill } from '../../shared/ui';

export interface SessionOperationsDashboardRouteProps {
  initialHealth?: OperatorSessionHealthProjection[];
}

type ScopeFilterKey =
  | 'project_id'
  | 'development_plan_id'
  | 'development_plan_item_id'
  | 'workflow_id'
  | 'codex_session_id'
  | 'worker_id';

type SessionOperationScopeFilters = Partial<Record<ScopeFilterKey, string>>;

const scopeFilterFields: Array<{ key: ScopeFilterKey; label: string; placeholder: string }> = [
  { key: 'project_id', label: 'Project ID', placeholder: 'project-1' },
  { key: 'development_plan_id', label: 'Development Plan ID', placeholder: 'development-plan-1' },
  { key: 'development_plan_item_id', label: 'Plan Item ID', placeholder: 'item-1' },
  { key: 'workflow_id', label: 'Workflow ID', placeholder: 'workflow-1' },
  { key: 'codex_session_id', label: 'Session ID', placeholder: 'session-1' },
  { key: 'worker_id', label: 'Worker ID', placeholder: 'worker-1' },
];

export function SessionOperationsDashboardRoute({ initialHealth }: SessionOperationsDashboardRouteProps) {
  if (initialHealth !== undefined) {
    return (
      <SessionOperationsDashboardView
        auditResponse={{ items: [] }}
        health={initialHealth}
        onDryRunScavenge={noopSessionOperation}
        onRecoverSession={noopSessionRecovery}
        onScavenge={noopSessionOperation}
      />
    );
  }

  return <ConnectedSessionOperationsDashboard />;
}

async function noopSessionOperation(_request: ScavengeSessionOperationsRequest) {
  return undefined;
}

async function noopSessionRecovery(_sessionId: string, _request: RecoverSessionRequest) {
  return undefined;
}

function ConnectedSessionOperationsDashboard() {
  const [stateFilter, setStateFilter] = useState<PlanItemSessionHealthState | 'all'>('all');
  const [scopeFilters, setScopeFilters] = useState<SessionOperationScopeFilters>({});
  const [auditSessionId, setAuditSessionId] = useState<string | undefined>();
  const healthFilters = useMemo(
    () => ({
      ...buildSessionOperationsFilters(stateFilter, scopeFilters),
      include_recovered: true,
      include_unrecoverable: true,
    }),
    [scopeFilters, stateFilter],
  );
  const healthQuery = useSessionOperationsHealthQuery(healthFilters);
  const recoverMutation = useRecoverSessionMutation();
  const scavengeMutation = useScavengeSessionOperationsMutation();
  const auditQuery = useSessionOperationsAuditQuery(auditSessionId);

  const auditProps = auditQuery.data === undefined ? {} : { auditResponse: auditQuery.data };

  return (
    <SessionOperationsDashboardView
      auditError={auditQuery.isError}
      auditLoading={auditQuery.isLoading}
      health={healthQuery.data?.items ?? []}
      healthError={healthQuery.isError}
      healthLoading={healthQuery.isLoading}
      mutationError={recoverMutation.isError || scavengeMutation.isError}
      mutationPending={recoverMutation.isPending || scavengeMutation.isPending}
      onAuditSessionChange={setAuditSessionId}
      onDryRunScavenge={(request) => scavengeMutation.mutateAsync(request)}
      onRecoverSession={(sessionId, request) => {
        setAuditSessionId(sessionId);
        return recoverMutation.mutateAsync({ sessionId, request });
      }}
      onScavenge={(request) => scavengeMutation.mutateAsync(request)}
      onScopeFiltersChange={setScopeFilters}
      onStateFilterChange={setStateFilter}
      scopeFilters={scopeFilters}
      stateFilter={stateFilter}
      {...auditProps}
    />
  );
}

export interface SessionOperationsDashboardViewProps {
  auditError?: boolean;
  auditLoading?: boolean;
  auditResponse?: SessionOperationsAuditResponse;
  health: OperatorSessionHealthProjection[];
  healthError?: boolean;
  healthLoading?: boolean;
  mutationError?: boolean;
  mutationPending?: boolean;
  onAuditSessionChange?: (sessionId: string) => void;
  onDryRunScavenge: (request: ScavengeSessionOperationsRequest) => Promise<unknown>;
  onRecoverSession: (sessionId: string, request: RecoverSessionRequest) => Promise<unknown>;
  onScavenge: (request: ScavengeSessionOperationsRequest) => Promise<unknown>;
  onScopeFiltersChange?: (filters: SessionOperationScopeFilters) => void;
  onStateFilterChange?: (state: PlanItemSessionHealthState | 'all') => void;
  scopeFilters?: SessionOperationScopeFilters;
  stateFilter?: PlanItemSessionHealthState | 'all';
}

export function SessionOperationsDashboardView({
  auditError = false,
  auditLoading = false,
  auditResponse,
  health,
  healthError = false,
  healthLoading = false,
  mutationError = false,
  mutationPending = false,
  onAuditSessionChange,
  onDryRunScavenge,
  onRecoverSession,
  onScavenge,
  onScopeFiltersChange,
  onStateFilterChange,
  scopeFilters: controlledScopeFilters,
  stateFilter: controlledStateFilter,
}: SessionOperationsDashboardViewProps) {
  const [localStateFilter, setLocalStateFilter] = useState<PlanItemSessionHealthState | 'all'>('all');
  const [localScopeFilters, setLocalScopeFilters] = useState<SessionOperationScopeFilters>({});
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(() => new Set());
  const [scavengeReason, setScavengeReason] = useState('');
  const [idempotencyPrefix, setIdempotencyPrefix] = useState('');
  const [confirmExecute, setConfirmExecute] = useState(false);
  const [recoveryReason, setRecoveryReason] = useState('');
  const [auditSessionId, setAuditSessionId] = useState<string | undefined>(health[0]?.codex_session_id);
  const stateFilter = controlledStateFilter ?? localStateFilter;
  const scopeFilters = controlledScopeFilters ?? localScopeFilters;
  const visibleHealth = useMemo(
    () =>
      health.filter(
        (item) =>
          (stateFilter === 'all' || item.state === stateFilter) && matchesSessionOperationsScopeFilters(item, scopeFilters),
      ),
    [health, scopeFilters, stateFilter],
  );
  const selectedCandidates = visibleHealth.filter(
    (item) => selectedSessionIds.has(item.codex_session_id) && item.candidate_predicate !== undefined,
  );
  const executeEnabled =
    selectedCandidates.length > 0 &&
    scavengeReason.trim().length > 0 &&
    idempotencyPrefix.trim().length > 0 &&
    confirmExecute;
  const blockedCount = visibleHealth.filter((item) => item.severity === 'blocked' || item.severity === 'critical').length;
  const attentionCount = visibleHealth.filter((item) => item.operator_intervention_required).length;
  const recoveredCount = visibleHealth.filter((item) => item.state === 'recovered' || item.state === 'unrecoverable').length;

  function updateStateFilter(next: PlanItemSessionHealthState | 'all') {
    if (onStateFilterChange !== undefined) {
      onStateFilterChange(next);
    } else {
      setLocalStateFilter(next);
    }
  }

  function updateAuditSessionId(sessionId: string) {
    setAuditSessionId(sessionId);
    onAuditSessionChange?.(sessionId);
  }

  function updateScopeFilter(key: ScopeFilterKey, value: string) {
    const next = { ...scopeFilters, [key]: value };
    if (onScopeFiltersChange !== undefined) {
      onScopeFiltersChange(next);
    } else {
      setLocalScopeFilters(next);
    }
  }

  function toggleSelection(sessionId: string) {
    setSelectedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }

  async function executeScavenge() {
    if (!executeEnabled) return;

    await onScavenge({
      mode: 'execute',
      reason: scavengeReason.trim(),
      operation_idempotency_key_prefix: idempotencyPrefix.trim(),
      confirm_execute: true,
      candidates: selectedCandidates.map((item) => ({
        codex_session_id: item.codex_session_id,
        candidate_predicate: requiredPredicate(item),
      })),
    });
  }

  async function dryRunScavenge() {
    await onDryRunScavenge({
      mode: 'dry_run',
      filters: {
        ...buildSessionOperationsFilters(stateFilter, scopeFilters),
        candidate_only: true,
      },
    });
  }

  async function recover(item: OperatorSessionHealthProjection, operation: 'recover' | 'mark_unrecoverable') {
    if (item.candidate_predicate === undefined || recoveryReason.trim().length === 0) return;
    updateAuditSessionId(item.codex_session_id);

    await onRecoverSession(item.codex_session_id, {
      operation,
      reason: recoveryReason.trim(),
      operation_idempotency_key: item.candidate_predicate.operation_idempotency_key,
      candidate_predicate: item.candidate_predicate,
    });
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Operator controls"
        subtitle="Recover, mark, and scavenge control-state issues without exposing raw runtime internals."
        title="Session Operations"
      />

      {healthError ? <InlineNotice title="Session Operations health could not be loaded." tone="danger" /> : null}
      {mutationError ? <InlineNotice title="Session operation failed." tone="danger" /> : null}

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Session operations summary">
        <Metric label="Blocked" value={blockedCount} tone={blockedCount > 0 ? 'danger' : 'success'} />
        <Metric label="Needs operator" value={attentionCount} tone={attentionCount > 0 ? 'warning' : 'neutral'} />
        <Metric label="Terminal" value={recoveredCount} tone="info" />
      </section>

      <Section
        actions={
          <Button loading={mutationPending} onClick={dryRunScavenge} variant="secondary">
            Dry-run scavenge
          </Button>
        }
        title="Filters"
        variant="panel"
      >
        <label className="grid max-w-xs gap-1 text-sm font-semibold text-text-primary">
          Health state
          <select
            className="min-h-10 rounded-md border border-border bg-surface px-3 text-sm"
            onChange={(event) => updateStateFilter(event.target.value as PlanItemSessionHealthState | 'all')}
            value={stateFilter}
          >
            <option value="all">All states</option>
            <option value="blocked_stale_lease">Blocked stale lease</option>
            <option value="blocked_orphaned_action">Blocked orphaned action</option>
            <option value="blocked_missing_capsule">Blocked missing capsule</option>
            <option value="blocked_lineage_conflict">Blocked lineage conflict</option>
            <option value="attention_needed">Attention needed</option>
            <option value="recovered">Recovered</option>
            <option value="unrecoverable">Unrecoverable</option>
          </select>
        </label>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Session operation scope filters">
          {scopeFilterFields.map((field) => (
            <label className="grid gap-1 text-sm font-semibold text-text-primary" key={field.key}>
              {field.label}
              <input
                className="min-h-10 rounded-md border border-border bg-surface px-3 text-sm"
                onChange={(event) => updateScopeFilter(field.key, event.target.value)}
                placeholder={field.placeholder}
                value={scopeFilters[field.key] ?? ''}
              />
            </label>
          ))}
        </div>
      </Section>

      <Section title="Health candidates" variant="panel">
        {healthLoading ? <InlineNotice title="Loading session health." tone="info" /> : null}
        {visibleHealth.length === 0 ? <InlineNotice title="No session operations candidates." tone="neutral" /> : null}
        <div className="grid gap-3">
          {visibleHealth.map((item) => (
            <article className="grid gap-4 rounded-card border border-border bg-surface-muted/60 p-4" key={item.codex_session_id}>
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="grid gap-2">
                  <label className="inline-flex items-center gap-2 text-sm font-semibold">
                    <input
                      aria-label={`Select ${item.codex_session_id}`}
                      checked={selectedSessionIds.has(item.codex_session_id)}
                      disabled={item.candidate_predicate === undefined}
                      onChange={() => toggleSelection(item.codex_session_id)}
                      type="checkbox"
                    />
                    <span>{item.codex_session_id}</span>
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={statusTone(item.severity)}>{formatLabel(item.state)}</StatusPill>
                    <StatusPill tone={item.recovery_available ? 'success' : 'neutral'}>
                      {item.recovery_available ? 'Recovery available' : 'Advisory only'}
                    </StatusPill>
                  </div>
                  <p className="text-sm text-text-secondary">{item.summary}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={!item.recovery_operation_labels.includes('recover') || item.candidate_predicate === undefined || recoveryReason.trim().length === 0}
                    onClick={() => recover(item, 'recover')}
                    variant="primary"
                  >
                    Recover
                  </Button>
                  <Button
                    disabled={
                      !item.recovery_operation_labels.includes('mark_unrecoverable') ||
                      item.candidate_predicate === undefined ||
                      recoveryReason.trim().length === 0
                    }
                    onClick={() => recover(item, 'mark_unrecoverable')}
                    variant="danger"
                  >
                    Mark unrecoverable
                  </Button>
                  <Button onClick={() => updateAuditSessionId(item.codex_session_id)} variant="secondary">
                    Audit
                  </Button>
                </div>
              </div>
              <CandidateSummary predicate={item.candidate_predicate} />
            </article>
          ))}
        </div>
      </Section>

      <Section
        description="Execute mode requires explicit selection, reason, idempotency prefix, and confirmation."
        title="Scavenge execute"
        variant="panel"
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
          <label className="grid gap-1 text-sm font-semibold text-text-primary">
            Scavenge reason
            <input
              className="min-h-10 rounded-md border border-border bg-surface px-3 text-sm"
              onChange={(event) => setScavengeReason(event.target.value)}
              value={scavengeReason}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-text-primary">
            Idempotency prefix
            <input
              className="min-h-10 rounded-md border border-border bg-surface px-3 text-sm"
              onChange={(event) => setIdempotencyPrefix(event.target.value)}
              value={idempotencyPrefix}
            />
          </label>
          <label className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold">
            <input
              aria-label="Confirm execute"
              checked={confirmExecute}
              onChange={(event) => setConfirmExecute(event.target.checked)}
              type="checkbox"
            />
            Confirm execute
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button disabled={!executeEnabled} loading={mutationPending} onClick={executeScavenge} variant="danger">
            Execute selected scavenge
          </Button>
          <StatusPill tone="neutral">{selectedCandidates.length} selected</StatusPill>
        </div>
      </Section>

      <Section title="Recovery reason" variant="panel">
        <label className="grid gap-1 text-sm font-semibold text-text-primary">
          Operator reason
          <textarea
            className="min-h-24 rounded-md border border-border bg-surface px-3 py-2 text-sm"
            onChange={(event) => setRecoveryReason(event.target.value)}
            value={recoveryReason}
          />
        </label>
      </Section>

      <Section title="Audit preview" variant="panel">
        {auditSessionId === undefined ? <InlineNotice title="Select a session to preview audit records." /> : null}
        {auditLoading ? <InlineNotice title="Loading audit records." tone="info" /> : null}
        {auditError ? <InlineNotice title="Audit records could not be loaded." tone="warning" /> : null}
        <ul className="grid gap-2 text-sm">
          {(auditResponse?.items ?? []).slice(0, 5).map((record) => (
            <li className="flex flex-wrap items-center gap-2" key={record.id}>
              <StatusPill tone={record.result === 'applied' ? 'success' : record.result === 'blocked' ? 'danger' : 'warning'}>
                {formatLabel(record.result)}
              </StatusPill>
              <span>{formatLabel(record.operation)}</span>
              <span className="text-text-secondary">{record.result_code}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }) {
  return (
    <div className="grid gap-1 rounded-card border border-border bg-surface p-4">
      <span className="text-xs font-semibold uppercase text-text-secondary">{label}</span>
      <span className="text-2xl font-semibold text-text-primary">{value}</span>
      <StatusPill tone={tone}>{label}</StatusPill>
    </div>
  );
}

function CandidateSummary({ predicate }: { predicate: SessionRecoveryCandidatePredicate | undefined }) {
  if (predicate === undefined) {
    return <InlineNotice title="No fenced candidate predicate is available for this row." tone="warning" />;
  }

  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4" aria-label="Candidate summary">
      <SafeDetail label="Expected state" value={formatLabel(predicate.expected_health_state)} />
      <SafeDetail label="Workflow" value={safeObservedLabel(predicate.workflow)} />
      <SafeDetail label="Session" value={safeObservedLabel(predicate.session)} />
      <SafeDetail label="Active lease" value={safeObservedLabel(predicate.active_lease)} />
      <SafeDetail label="Queued action" value={safeObservedLabel(predicate.pending_queued_action)} />
      <SafeDetail label="Capsule" value={safeObservedLabel(predicate.latest_capsule)} />
      <SafeDetail label="Projection" value={predicate.projection_digest.slice(0, 19)} />
      <SafeDetail label="Observed" value={new Date(predicate.observed_at).toLocaleString()} />
    </dl>
  );
}

function SafeDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-card border border-border bg-surface px-3 py-2">
      <dt className="text-xs font-semibold uppercase text-text-secondary">{label}</dt>
      <dd className="truncate text-text-primary">{value}</dd>
    </div>
  );
}

function requiredPredicate(item: OperatorSessionHealthProjection): SessionRecoveryCandidatePredicate {
  if (item.candidate_predicate === undefined) {
    throw new Error(`candidate predicate is required for ${item.codex_session_id}`);
  }
  return item.candidate_predicate;
}

function safeObservedLabel(ref: { state?: string } | undefined) {
  return ref?.state === 'present' ? 'Observed present' : 'Observed absent';
}

function buildSessionOperationsFilters(
  stateFilter: PlanItemSessionHealthState | 'all',
  scopeFilters: SessionOperationScopeFilters,
): SessionOperationsHealthQuery {
  const filters: SessionOperationsHealthQuery = stateFilter === 'all' ? {} : { state: stateFilter };
  for (const field of scopeFilterFields) {
    const value = scopeFilters[field.key]?.trim();
    if (value !== undefined && value.length > 0) {
      filters[field.key] = value;
    }
  }
  return filters;
}

function matchesSessionOperationsScopeFilters(
  item: OperatorSessionHealthProjection,
  scopeFilters: SessionOperationScopeFilters,
) {
  const itemValues: Partial<Record<ScopeFilterKey, string | undefined>> = {
    project_id: item.project_id,
    development_plan_id: item.development_plan_id,
    development_plan_item_id: item.development_plan_item_id,
    workflow_id: item.workflow_id,
    codex_session_id: item.codex_session_id,
    worker_id:
      item.candidate_predicate?.active_lease.state === 'present'
        ? item.candidate_predicate.active_lease.value.worker_id
        : undefined,
  };

  return scopeFilterFields.every((field) => {
    const expected = scopeFilters[field.key]?.trim();
    return expected === undefined || expected.length === 0 || itemValues[field.key] === expected;
  });
}

function statusTone(severity: OperatorSessionHealthProjection['severity']) {
  switch (severity) {
    case 'none':
      return 'success';
    case 'info':
      return 'info';
    case 'warning':
      return 'warning';
    case 'blocked':
    case 'critical':
      return 'danger';
  }
}

function formatLabel(value: string) {
  return value.replaceAll('_', ' ');
}
