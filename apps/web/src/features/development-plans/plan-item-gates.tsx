import { useNavigate } from 'react-router';

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
  risk?: string;
  boundary_status?: string;
  spec_status?: string;
  execution_plan_status?: string;
  execution_status?: string;
  review_status?: string;
  qa_handoff_status?: string;
  next_action?: string;
  source_ref?: { type: string; id: string; title?: string };
  development_plan_ref?: { id: string; title?: string };
  boundary_summary_revisions?: BoundarySummaryRevision[];
  specs?: Array<{ id: string; title?: string }>;
  execution_plans?: Array<{ id: string; title?: string }>;
  executions?: Array<{ id: string; title?: string; status?: string }>;
  qa_handoffs?: Array<{ id: string; title?: string; status?: string }>;
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
  const href = (suffix: string) => `${itemHref(item)}${suffix}`;
  const gates = [
    gateConfig('Boundary', item.boundary_status, href('/brainstorming'), true),
    gateConfig('Spec document', item.spec_status, href('/spec'), isApproved(item.boundary_status)),
    gateConfig('Execution Plan document', item.execution_plan_status, href('/execution-plan'), isApproved(item.spec_status)),
    gateConfig('Execution', item.execution_status, href('/execution'), isApproved(item.execution_plan_status)),
    gateConfig('Code review', item.review_status, `/reports?development_plan_item_id=${item.id}`, item.execution_status === 'completed' || isReviewOpen(item.review_status)),
    gateConfig('QA handoff', item.qa_handoff_status, `/reports?development_plan_item_id=${item.id}`, item.review_status === 'approved' || isQaOpen(item.qa_handoff_status)),
  ] as const;

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
          ['Source object', item.source_ref?.title ?? item.source_ref?.id ?? 'Not linked'],
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

function gateConfig(label: string, status: string | undefined, href: string, prerequisiteMet: boolean) {
  const enabled = prerequisiteMet || status === 'blocked' || status === 'changes_requested' || status === 'in_review';
  return {
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
  return status === 'in_review' || status === 'changes_requested' || status === 'approved';
}

function isQaOpen(status: string | undefined): boolean {
  return status === 'pending' || status === 'blocked' || status === 'accepted';
}

function decisionCount(revision: BoundarySummaryRevision): number {
  if (revision.decision_count !== undefined) return revision.decision_count;
  if (revision.decisions !== undefined) return revision.decisions.length;
  if (revision.decision_snapshot !== undefined) return revision.decision_snapshot.length;
  return 0;
}
