import { useNavigate } from 'react-router';

import type { PlanItemWorkflowPublicDto, ProductObjectRef } from '../../shared/api/types';
import { InlineActions, Section } from '../../shared/layout';
import { Badge, Button, StatusPill } from '../../shared/ui';
import { formatValue, itemHref } from './development-plan-table';

export type DevelopmentPlanItemProjection = {
  id: string;
  development_plan_id?: string;
  object_ref?: { type?: string; id?: string; development_plan_id?: string; title?: string };
  href?: string;
  title: string;
  summary?: string;
  responsible_role?: string;
  driver_actor_id?: string;
  reviewer_actor_id?: string;
  priority?: string;
  risk?: string;
  dependency_hints?: string[];
  affected_surfaces?: string[];
  boundary_status?: string;
  spec_status?: string;
  implementation_plan_status?: string;
  execution_status?: string;
  review_status?: string;
  qa_handoff_status?: string;
  plan_item_workflow?: PlanItemWorkflowPublicDto;
  release_impact?: string;
  next_action?: string;
  source_ref?: { type: string; id: string; title?: string };
  development_plan_ref?: { id: string; title?: string };
  boundary_summary_revisions?: BoundarySummaryRevision[];
  specs?: Array<{ id: string; title?: string; current_revision_id?: string; approved_revision_id?: string }>;
  runtime_boundary?: {
    id: string;
    type?: string;
    phase?: string;
    activity_state?: string;
    gate_state?: string;
    implementation_plan_revision_id?: string;
  };
  release_context?: {
    release_refs?: Array<{ type?: string; id: string; title?: string; href?: string }>;
    readiness_blockers?: Array<{ code?: string; summary?: string }>;
    evidence_refs?: Array<{ type?: string; id: string; title?: string; evidence_type?: string; release_id?: string; status?: string; summary?: string }>;
    qa_test_evidence_required?: boolean;
  };
  implementation_plan_docs?: Array<{ id: string; title?: string; current_revision_id?: string; approved_revision_id?: string }>;
  executions?: Array<{
    id: string;
    title?: string;
    status?: string;
    worker_state?: string;
    development_plan_item_ref?: ProductObjectRef & { development_plan_id?: string };
    implementation_plan_revision_id?: string;
    implementation_plan_revision_ref?: ProductObjectRef & { implementation_plan_id?: string };
    evidence_refs?: ProductObjectRef[];
    test_evidence_refs?: ProductObjectRef[];
  }>;
  code_review_handoffs?: Array<{
    id: string;
    title?: string;
    execution_id?: string;
    implementation_plan_revision_id?: string;
    reviewer_actor_id?: string;
    status?: string;
    summary?: string;
    changed_surfaces?: string[];
    verification_evidence_refs?: ProductObjectRef[];
    comments?: string[];
    changes_requested?: string[];
    audited_exception?: { reason?: string; risk?: string; rollback_plan?: string };
  }>;
  qa_handoffs?: Array<{
    id: string;
    title?: string;
    code_review_handoff_id?: string;
    execution_id?: string;
    source_ref?: ProductObjectRef;
    development_plan_item_id?: string;
    development_plan_item_ref?: ProductObjectRef & { development_plan_id?: string };
    approved_spec_revision_ref?: ProductObjectRef & { spec_id?: string };
    approved_implementation_plan_revision_ref?: ProductObjectRef & { implementation_plan_id?: string };
    status?: string;
    acceptance_criteria?: string[];
    test_strategy?: string;
    verification_evidence_refs?: ProductObjectRef[];
    known_risks?: string[];
    changed_surfaces?: string[];
    release_impact?: string;
    audited_exception?: { reason?: string };
  }>;
};

export type PlanItemGateModel = {
  enabled: boolean;
  href: string;
  id: 'boundary' | 'spec' | 'implementation-plan' | 'execution' | 'code-review' | 'qa-handoff' | 'release';
  label: string;
  reason: string;
  reasonId: string;
  status: string | undefined;
};

export type DevelopmentPlanItemRevision = {
  id: string;
  revision_number: number;
  editor_actor_id?: string;
  created_at?: string;
  change_reason?: string;
  is_current?: boolean;
  stale?: boolean;
};

export type BoundarySummaryRevision = {
  id: string;
  boundary_summary_id?: string;
  revision_number: number;
  summary?: string;
  summary_markdown?: string;
  approved_by_actor_id?: string;
  approved_at?: string;
  brainstorming_session_id?: string;
  decision_count?: number;
  decisions?: unknown[];
  decision_snapshot?: unknown[];
};

export function PlanItemGateSummary({ item }: { item: DevelopmentPlanItemProjection }) {
  const navigate = useNavigate();
  const gates = planItemGateModels(item);

  return (
    <Section title="Gate summary">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {gates.map((gate) => (
          <article className="grid gap-3 rounded-card border border-border bg-background p-3" key={gate.label}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-text-primary">{gate.label}</span>
              <StatusPill tone={toneFor(gate.status)}>{formatValue(gate.status)}</StatusPill>
            </div>
            <p className="text-sm text-text-secondary" id={gate.reasonId}>{gate.reason}</p>
            <Button
              aria-describedby={gate.reasonId}
              disabled={!gate.enabled}
              onClick={() => navigate(gate.href)}
              type="button"
              variant="secondary"
            >
              {gate.enabled ? `Open ${gate.label}` : `${gate.label} unavailable`}
            </Button>
          </article>
        ))}
      </div>
    </Section>
  );
}

export function planItemGateModels(item: DevelopmentPlanItemProjection): PlanItemGateModel[] {
  const href = (suffix: string) => `${itemHref(item)}${suffix}`;
  return [
    gateConfig('boundary', 'Boundary', item.boundary_status, itemHref(item), true),
    gateConfig('spec', 'Spec', item.spec_status, href('/spec'), isApproved(item.boundary_status)),
    gateConfig('implementation-plan', 'Implementation Plan Doc', item.implementation_plan_status, href('/implementation-plan'), isApproved(item.spec_status) && hasRequiredSpecQaStrategy(item)),
    gateConfig('execution', 'Execution', item.execution_status, href('/execution'), isApproved(item.implementation_plan_status) && hasRunnableExecutionBoundary(item)),
    gateConfig('code-review', 'Code Review', item.review_status, codeReviewHref(item), item.execution_status === 'completed' || isReviewOpen(item.review_status)),
    gateConfig('qa-handoff', 'QA handoff', item.qa_handoff_status, '/qa', item.review_status === 'approved' || isQaOpen(item.qa_handoff_status)),
    gateConfig('release', 'Release', undefined, releaseHref(item), (item.qa_handoff_status === 'accepted' || item.qa_handoff_status === 'approved') && hasLinkedRelease(item)),
  ];
}

function codeReviewHref(item: DevelopmentPlanItemProjection): string {
  const executionId = item.code_review_handoffs?.[0]?.execution_id ?? item.executions?.[0]?.id;
  return executionId === undefined ? '/executions' : `/executions/${encodeURIComponent(executionId)}`;
}

export function PlanItemRevisionHistory({ revisions }: { revisions: DevelopmentPlanItemRevision[] }) {
  const latestRevision = Math.max(0, ...revisions.map((revision) => revision.revision_number));

  return (
    <Section title="Development Plan Item revisions" aria-label="Development Plan Item revisions">
      <div className="grid gap-3">
        {revisions.map((revision) => {
          const current = revision.is_current ?? (!revision.stale && revision.revision_number === latestRevision);
          return (
            <article className="grid gap-1 rounded-card border border-border bg-background p-3 text-sm" key={revision.id}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-text-primary">Item revision {revision.revision_number}</h3>
                <Badge tone={current ? 'info' : 'neutral'}>{current ? 'Current' : 'Stale'}</Badge>
              </div>
              <p className="text-text-secondary">Editor {revision.editor_actor_id ?? 'system'} - {formatDate(revision.created_at)}</p>
              <p className="text-text-secondary">{revision.change_reason ?? 'Initial structured row revision.'}</p>
            </article>
          );
        })}
        {revisions.length === 0 ? <p className="text-sm text-text-secondary">No item revisions recorded.</p> : null}
        <InlineActions>
          <Button type="button" variant="secondary">Compare item revisions</Button>
        </InlineActions>
      </div>
    </Section>
  );
}

export function BoundarySummaryRevisionHistory({ revisions }: { revisions: BoundarySummaryRevision[] }) {
  return (
    <Section title="Boundary summary revisions" aria-label="Boundary summary revisions">
      <div className="grid gap-3">
        {revisions.map((revision) => (
          <article className="grid gap-1 rounded-card border border-border bg-background p-3 text-sm" key={revision.id}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-text-primary">Boundary summary revision {revision.revision_number}</h3>
              <Badge tone="success">Approved</Badge>
            </div>
            <p className="text-text-secondary">Approver {revision.approved_by_actor_id ?? 'not recorded'} - {formatDate(revision.approved_at)}</p>
            <p className="text-text-secondary">Source Brainstorming Session {revision.brainstorming_session_id ?? 'not recorded'}</p>
            <p className="text-text-secondary">Decision count {decisionCount(revision)}</p>
            <p className="text-text-primary">{revision.summary_markdown ?? revision.summary ?? 'No boundary summary text recorded.'}</p>
          </article>
        ))}
        {revisions.length === 0 ? <p className="text-sm text-text-secondary">No boundary summary revisions recorded.</p> : null}
        <InlineActions>
          <Button type="button" variant="secondary">Compare boundary revisions</Button>
        </InlineActions>
      </div>
    </Section>
  );
}

export function ItemStructuredFields({ item }: { item: DevelopmentPlanItemProjection }) {
  return (
    <Section title="Structured fields">
      <dl className="grid gap-3 text-sm md:grid-cols-2">
        {[
          ['Responsible role', formatValue(item.responsible_role)],
          ['Driver', item.driver_actor_id ?? 'Unassigned'],
          ['Risk', formatValue(item.risk)],
          ['Planning input', item.source_ref?.title ?? item.source_ref?.id ?? 'Not linked'],
          ['Next action', item.next_action ?? 'Review gate state'],
          ['Development Plan', item.development_plan_ref?.title ?? item.object_ref?.development_plan_id ?? item.development_plan_id ?? 'Not linked'],
        ].map(([label, value]) => (
          <div className="grid gap-1 rounded-md border border-border bg-background p-3" key={label}>
            <dt className="text-text-secondary">{label}</dt>
            <dd className="font-semibold text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function gateConfig(
  id: PlanItemGateModel['id'],
  label: string,
  status: string | undefined,
  href: string,
  prerequisiteMet: boolean,
): PlanItemGateModel {
  const enabled = prerequisiteMet || status === 'blocked' || status === 'changes_requested' || status === 'in_review';
  return {
    id,
    label,
    status,
    href,
    enabled,
    reason: disabledReason(label, status, enabled),
    reasonId: `gate-reason-${label.toLowerCase().replaceAll(' ', '-')}`,
  };
}

function disabledReason(label: string, status: string | undefined, enabled: boolean): string {
  if (status === 'approved' || status === 'completed' || status === 'accepted') return `${label} gate is ready for the next product role.`;
  if (status === 'blocked') return `${label} gate is blocked and needs review.`;
  if (status === 'running') return `${label} is currently running.`;
  if (label === 'Release' && !enabled) return 'Release gate waits for an owning Release link.';
  if (!enabled) return `${label} depends on the previous approved gate.`;
  return `${label} is available for review.`;
}

function toneFor(status: string | undefined): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'approved' || status === 'completed' || status === 'accepted') return 'success';
  if (status === 'blocked' || status === 'failed' || status === 'changes_requested') return 'danger';
  if (status === 'running' || status === 'in_progress' || status === 'in_review') return 'info';
  if (status === 'stale' || status === 'pending' || status === 'interrupted') return 'warning';
  return 'neutral';
}

function formatDate(value: string | undefined): string {
  if (value === undefined) return 'not recorded';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function isApproved(status: string | undefined): boolean {
  return status === 'approved' || status === 'completed' || status === 'accepted';
}

function isReviewOpen(status: string | undefined): boolean {
  return status === 'in_review' || status === 'approved';
}

function isQaOpen(status: string | undefined): boolean {
  return status === 'pending' || status === 'blocked' || status === 'accepted';
}

function hasSpecQaStrategy(item: DevelopmentPlanItemProjection): boolean {
  const spec = item.specs?.[0] as (NonNullable<DevelopmentPlanItemProjection['specs']>[number] & {
    acceptance_criteria?: string[];
    qa_owner_actor_id?: string;
    test_owner_actor_id?: string;
    testability_note?: string;
    test_strategy_summary?: string;
  }) | undefined;
  if (spec === undefined) return false;
  return (
    hasText(spec.qa_owner_actor_id) ||
    hasText(spec.test_owner_actor_id)
  ) && hasText(spec.testability_note) && hasItems(spec.acceptance_criteria) && hasText(spec.test_strategy_summary);
}

function hasRequiredSpecQaStrategy(item: DevelopmentPlanItemProjection): boolean {
  return !requiresSpecQaStrategy(item) || hasSpecQaStrategy(item);
}

function requiresSpecQaStrategy(item: DevelopmentPlanItemProjection): boolean {
  const risk = item.risk?.toLowerCase();
  const affectedSurfaces = item.affected_surfaces ?? [];
  return (
    risk === 'medium' ||
    risk === 'high' ||
    risk === 'critical' ||
    item.release_impact === 'release_scoped' ||
    item.release_impact === 'release_blocking' ||
    affectedSurfaces.length > 1
  );
}

function hasRunnableExecutionBoundary(item: DevelopmentPlanItemProjection): boolean {
  const boundary = item.runtime_boundary;
  const approvedRevisionId = item.implementation_plan_docs?.[0]?.approved_revision_id ?? item.implementation_plan_docs?.[0]?.current_revision_id;
  return (
    boundary !== undefined &&
    boundary.type === 'execution_package' &&
    boundary.implementation_plan_revision_id === approvedRevisionId &&
    boundary.phase === 'ready' &&
    boundary.activity_state === 'idle' &&
    boundary.gate_state === 'not_submitted'
  );
}

function hasText(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function hasItems(values: readonly string[] | undefined): boolean {
  return values !== undefined && values.some((value) => value.trim().length > 0);
}

function releaseHref(item: DevelopmentPlanItemProjection): string {
  return item.release_context?.release_refs?.[0]?.href ?? itemHref(item);
}

function hasLinkedRelease(item: DevelopmentPlanItemProjection): boolean {
  return (item.release_context?.release_refs?.length ?? 0) > 0;
}

function decisionCount(revision: BoundarySummaryRevision): number {
  if (revision.decision_count !== undefined) return revision.decision_count;
  if (revision.decisions !== undefined) return revision.decisions.length;
  if (revision.decision_snapshot !== undefined) return revision.decision_snapshot.length;
  return 0;
}
