import { useState, type ReactElement, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  CheckCircle2,
  CirclePlay,
  FileCheck2,
  GitCompare,
  PauseCircle,
  RefreshCcw,
  RotateCw,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { createForgeloopCommandApi } from '../../shared/api/commands';
import { queryKeys } from '../../shared/api/query-keys';
import type { ProductObjectRef } from '../../shared/api/types';
import { useActorContext } from '../../shared/context/actor-context';
import { InlineActions, Section } from '../../shared/layout';
import { Badge, Button, InlineNotice, StatusPill } from '../../shared/ui';
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
      <PlanItemLifecycleActions item={item} />
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

function PlanItemLifecycleActions({ item }: { item: DevelopmentPlanItemProjection }) {
  const { actorId } = useActorContext();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [runningAction, setRunningAction] = useState<string>();
  const commandApi = createForgeloopCommandApi();
  const developmentPlanId = item.development_plan_ref?.id ?? item.object_ref?.development_plan_id ?? item.development_plan_id;
  const execution = item.executions?.[0];
  const codeReview = item.code_review_handoffs?.[0];
  const qaHandoff = item.qa_handoffs?.[0];
  const verificationEvidenceRefs = verificationEvidenceFor(execution);
  const hasExecutionEvidence = verificationEvidenceRefs.length > 0;
  const specComparePair = revisionComparePair(item.specs?.[0]);
  const implementationPlanComparePair = revisionComparePair(item.implementation_plan_docs?.[0]);
  const codeReviewApprovedOrException = item.review_status === 'approved' || codeReview?.status === 'approved' || codeReview?.audited_exception !== undefined;

  const state = {
    generateSpec: developmentPlanId !== undefined && isApproved(item.boundary_status) && isNotStarted(item.spec_status),
    submitSpec: developmentPlanId !== undefined && isSubmittable(item.spec_status),
    reviewSpec: developmentPlanId !== undefined && isInReview(item.spec_status),
    regenerateSpec: developmentPlanId !== undefined && isRegeneratable(item.spec_status),
    compareSpec: developmentPlanId !== undefined && specComparePair !== undefined,
    generateImplementationPlan: developmentPlanId !== undefined && isApproved(item.spec_status) && hasRequiredSpecQaStrategy(item) && isNotStarted(item.implementation_plan_status),
    submitImplementationPlan: developmentPlanId !== undefined && isSubmittable(item.implementation_plan_status),
    reviewImplementationPlan: developmentPlanId !== undefined && isInReview(item.implementation_plan_status),
    regenerateImplementationPlan: developmentPlanId !== undefined && isRegeneratable(item.implementation_plan_status),
    compareImplementationPlan: developmentPlanId !== undefined && implementationPlanComparePair !== undefined,
    startExecution: developmentPlanId !== undefined && isApproved(item.implementation_plan_status) && hasRunnableExecutionBoundary(item) && isNotStarted(item.execution_status),
    interruptExecution: execution !== undefined && canInterruptExecution(execution),
    continueExecution: execution !== undefined && canContinueExecution(execution),
    readyForCodeReview: execution !== undefined && item.execution_status === 'completed' && hasExecutionEvidence && !isReviewOpen(item.review_status),
    createQaHandoff: codeReview !== undefined && codeReviewApprovedOrException && qaHandoff === undefined,
    blockQaHandoff: qaHandoff?.status === 'pending',
    acceptQaHandoff: (qaHandoff?.status === 'pending' || qaHandoff?.status === 'blocked') && (item.review_status === 'approved' || codeReview?.status === 'approved') && hasExecutionEvidence,
  };

  async function run(label: string, operation: () => Promise<unknown>) {
    setRunningAction(label);
    setError(undefined);
    try {
      await operation();
      setMessage(`${label} command completed.`);
      await invalidateItem(queryClient, developmentPlanId, item.id);
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : `${label} command failed.`);
    } finally {
      setRunningAction(undefined);
    }
  }

  const disabled = developmentPlanId === undefined || runningAction !== undefined;

  return (
    <section aria-label="Development Plan Item lifecycle actions" className="mt-4 grid gap-4 rounded-md border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary">Lifecycle actions</h3>
        <StatusPill tone="info">Item scoped</StatusPill>
      </div>
      {message ? <InlineNotice title={message} tone="success" /> : null}
      {error ? <InlineNotice title={error} tone="danger" /> : null}
      {codeReview?.audited_exception !== undefined && codeReview.status !== 'approved' ? (
        <InlineNotice
          description={codeReview.audited_exception.reason ?? 'QA can be prepared early, but release readiness remains blocked until code review closes.'}
          title="Audited code review exception enables early QA preparation"
          tone="warning"
        />
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        <ActionGroup title="Spec">
          <LifecycleButton disabled={disabled || !state.generateSpec} icon={<FileCheck2 />} loading={runningAction === 'Generate Spec'} onClick={() => void run('Generate Spec', () => commandApi.generateItemSpecDraft(developmentPlanId!, item.id, { actor_id: actorId }))}>
            Generate Spec
          </LifecycleButton>
          <LifecycleButton disabled={disabled || !state.submitSpec} icon={<Send />} loading={runningAction === 'Submit Spec'} onClick={() => void run('Submit Spec', () => commandApi.submitItemSpecForApproval(developmentPlanId!, item.id, { actor_id: actorId }))}>
            Submit Spec for review
          </LifecycleButton>
          <LifecycleButton disabled={disabled || !state.reviewSpec} icon={<CheckCircle2 />} loading={runningAction === 'Approve Spec'} onClick={() => void run('Approve Spec', () => commandApi.approveItemSpec(developmentPlanId!, item.id, { actor_id: actorId, rationale: 'Approved from Development Plan Item gate.' }))}>
            Approve Spec
          </LifecycleButton>
          <LifecycleButton disabled={disabled || !state.reviewSpec} icon={<RotateCw />} loading={runningAction === 'Request Spec Changes'} onClick={() => void run('Request Spec Changes', () => commandApi.requestItemSpecChanges(developmentPlanId!, item.id, { actor_id: actorId, rationale: 'Changes requested from Development Plan Item gate.' }))}>
            Request Spec changes
          </LifecycleButton>
          <LifecycleButton disabled={disabled || !state.reviewSpec} icon={<XCircle />} loading={runningAction === 'Reject Spec'} onClick={() => void run('Reject Spec', () => commandApi.rejectItemSpec(developmentPlanId!, item.id, { actor_id: actorId, rationale: 'Rejected from Development Plan Item gate.' }))}>
            Reject Spec
          </LifecycleButton>
          <LifecycleButton disabled={disabled || !state.regenerateSpec} icon={<RefreshCcw />} loading={runningAction === 'Regenerate Spec'} onClick={() => void run('Regenerate Spec', () => commandApi.regenerateItemSpecDraft(developmentPlanId!, item.id, { actor_id: actorId, feedback: 'Regenerate while preserving approved boundary decisions.', preserve_prior_decisions: true }))}>
            Regenerate Spec
          </LifecycleButton>
          <LifecycleButton
            disabled={disabled || !state.compareSpec}
            icon={<GitCompare />}
            loading={runningAction === 'Compare Spec Revisions'}
            onClick={() =>
              specComparePair === undefined
                ? undefined
                : void run('Compare Spec Revisions', () =>
                    commandApi.compareItemSpecRevisions(developmentPlanId!, item.id, specComparePair),
                  )
            }
            variant="secondary"
          >
            Compare Spec revisions
          </LifecycleButton>
        </ActionGroup>
        <ActionGroup title="Implementation Plan Doc">
          <LifecycleButton
            describedBy="generate-implementation-plan-reason"
            disabled={disabled || !state.generateImplementationPlan}
            icon={<FileCheck2 />}
            loading={runningAction === 'Generate Implementation Plan Doc'}
            onClick={() => void run('Generate Implementation Plan Doc', () => commandApi.generateItemImplementationPlanDraft(developmentPlanId!, item.id, { actor_id: actorId }))}
          >
            Generate Implementation Plan Doc
          </LifecycleButton>
          <p className="sr-only" id="generate-implementation-plan-reason">{implementationPlanGenerationReason(item)}</p>
          <LifecycleButton disabled={disabled || !state.submitImplementationPlan} icon={<Send />} loading={runningAction === 'Submit Implementation Plan Doc'} onClick={() => void run('Submit Implementation Plan Doc', () => commandApi.submitItemImplementationPlanForApproval(developmentPlanId!, item.id, { actor_id: actorId }))}>
            Submit Implementation Plan Doc for review
          </LifecycleButton>
          <LifecycleButton disabled={disabled || !state.reviewImplementationPlan} icon={<CheckCircle2 />} loading={runningAction === 'Approve Implementation Plan Doc'} onClick={() => void run('Approve Implementation Plan Doc', () => commandApi.approveItemImplementationPlan(developmentPlanId!, item.id, { actor_id: actorId, rationale: 'Approved from Development Plan Item gate.' }))}>
            Approve Implementation Plan Doc
          </LifecycleButton>
          <LifecycleButton disabled={disabled || !state.reviewImplementationPlan} icon={<RotateCw />} loading={runningAction === 'Request Implementation Plan Doc Changes'} onClick={() => void run('Request Implementation Plan Doc Changes', () => commandApi.requestItemImplementationPlanChanges(developmentPlanId!, item.id, { actor_id: actorId, rationale: 'Changes requested from Development Plan Item gate.' }))}>
            Request Implementation Plan Doc changes
          </LifecycleButton>
          <LifecycleButton disabled={disabled || !state.reviewImplementationPlan} icon={<XCircle />} loading={runningAction === 'Reject Implementation Plan Doc'} onClick={() => void run('Reject Implementation Plan Doc', () => commandApi.rejectItemImplementationPlan(developmentPlanId!, item.id, { actor_id: actorId, rationale: 'Rejected from Development Plan Item gate.' }))}>
            Reject Implementation Plan Doc
          </LifecycleButton>
          <LifecycleButton disabled={disabled || !state.regenerateImplementationPlan} icon={<RefreshCcw />} loading={runningAction === 'Regenerate Implementation Plan Doc'} onClick={() => void run('Regenerate Implementation Plan Doc', () => commandApi.regenerateItemImplementationPlanDraft(developmentPlanId!, item.id, { actor_id: actorId, feedback: 'Regenerate while preserving approved Spec decisions.', preserve_prior_decisions: true }))}>
            Regenerate Implementation Plan Doc
          </LifecycleButton>
          <LifecycleButton
            disabled={disabled || !state.compareImplementationPlan}
            icon={<GitCompare />}
            loading={runningAction === 'Compare Implementation Plan Doc Revisions'}
            onClick={() =>
              implementationPlanComparePair === undefined
                ? undefined
                : void run('Compare Implementation Plan Doc Revisions', () =>
                    commandApi.compareItemImplementationPlanRevisions(developmentPlanId!, item.id, implementationPlanComparePair),
                  )
            }
            variant="secondary"
          >
            Compare Implementation Plan Doc revisions
          </LifecycleButton>
        </ActionGroup>
        <ActionGroup title="Execution and review">
          <LifecycleButton
            describedBy="start-execution-reason"
            disabled={disabled || !state.startExecution}
            icon={<CirclePlay />}
            loading={runningAction === 'Start Execution'}
            onClick={() => void run('Start Execution', () => commandApi.startItemExecution(developmentPlanId!, item.id, { actor_id: actorId }))}
          >
            Start execution
          </LifecycleButton>
          <p className="sr-only" id="start-execution-reason">{executionStartReason(item)}</p>
          <LifecycleButton disabled={disabled || !state.interruptExecution} icon={<PauseCircle />} loading={runningAction === 'Interrupt Execution'} onClick={() => execution === undefined ? undefined : void run('Interrupt Execution', () => commandApi.interruptExecution(execution.id, { actor_id: actorId }))}>
            Interrupt execution
          </LifecycleButton>
          <LifecycleButton disabled={disabled || !state.continueExecution} icon={<CirclePlay />} loading={runningAction === 'Continue Execution'} onClick={() => execution === undefined ? undefined : void run('Continue Execution', () => commandApi.continueExecution(execution.id, { actor_id: actorId }))}>
            Continue execution
          </LifecycleButton>
          <LifecycleButton disabled={disabled || !state.readyForCodeReview} icon={<ShieldCheck />} loading={runningAction === 'Ready For Code Review'} onClick={() => execution === undefined ? undefined : void run('Ready For Code Review', () => commandApi.markExecutionReadyForCodeReview(execution.id, { actor_id: actorId, summary: 'Execution is ready for code review from the Development Plan Item gate.', changed_surfaces: [item.title], verification_evidence_refs: verificationEvidenceRefs }))}>
            Ready for code review
          </LifecycleButton>
        </ActionGroup>
        <ActionGroup title="QA">
          <LifecycleButton disabled={disabled || !state.createQaHandoff} icon={<Send />} loading={runningAction === 'Create QA Handoff'} onClick={() => codeReview === undefined ? undefined : void run('Create QA Handoff', () => commandApi.createQaHandoff(codeReview.id, { actor_id: actorId, acceptance_criteria: ['Approved Spec acceptance criteria remain satisfied.'], test_strategy: 'Run the item-scoped QA plan and focused regression checks.', verification_evidence_refs: verificationEvidenceRefs }))}>
            Create QA handoff
          </LifecycleButton>
          <LifecycleButton disabled={disabled || !state.blockQaHandoff} icon={<XCircle />} loading={runningAction === 'Block QA Handoff'} onClick={() => qaHandoff === undefined ? undefined : void run('Block QA Handoff', () => commandApi.blockQaHandoff(qaHandoff.id, { actor_id: actorId, rationale: 'QA blocked from Development Plan Item gate.' }))}>
            Block QA handoff
          </LifecycleButton>
          <LifecycleButton disabled={disabled || !state.acceptQaHandoff} icon={<CheckCircle2 />} loading={runningAction === 'Accept QA Handoff'} onClick={() => qaHandoff === undefined ? undefined : void run('Accept QA Handoff', () => commandApi.acceptQaHandoff(qaHandoff.id, { actor_id: actorId, rationale: 'QA accepted from Development Plan Item gate.', verification_evidence_refs: verificationEvidenceRefs }))}>
            Accept QA handoff
          </LifecycleButton>
        </ActionGroup>
      </div>
    </section>
  );
}

function ActionGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="grid content-start gap-2 rounded-md border border-border bg-background p-3">
      <h4 className="text-xs font-semibold uppercase tracking-normal text-text-muted">{title}</h4>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function LifecycleButton({
  children,
  disabled,
  describedBy,
  icon,
  loading,
  onClick,
  variant,
}: {
  children: ReactNode;
  disabled: boolean;
  describedBy?: string;
  icon: ReactElement;
  loading?: boolean;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <Button aria-describedby={describedBy} disabled={disabled} loading={loading ?? false} onClick={onClick} type="button" variant={variant ?? 'secondary'}>
      {icon}
      {children}
    </Button>
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

function revisionComparePair(
  artifact: { current_revision_id?: string; approved_revision_id?: string } | undefined,
): { base_revision_id: string; compare_revision_id: string } | undefined {
  const compareRevisionId = artifact?.current_revision_id ?? artifact?.approved_revision_id;
  const baseRevisionId = artifact?.approved_revision_id ?? compareRevisionId;
  if (baseRevisionId === undefined || compareRevisionId === undefined) return undefined;
  return { base_revision_id: baseRevisionId, compare_revision_id: compareRevisionId };
}

function isNotStarted(status: string | undefined): boolean {
  return status === undefined || status === 'missing' || status === 'not_started' || status === 'pending';
}

function isSubmittable(status: string | undefined): boolean {
  return status === 'draft' || status === 'changes_requested';
}

function isInReview(status: string | undefined): boolean {
  return status === 'in_review';
}

function isRegeneratable(status: string | undefined): boolean {
  return status === 'changes_requested' || status === 'rejected' || status === 'blocked';
}

function canInterruptExecution(execution: NonNullable<DevelopmentPlanItemProjection['executions']>[number]): boolean {
  return execution.status === 'running' || execution.status === 'paused';
}

function canContinueExecution(execution: NonNullable<DevelopmentPlanItemProjection['executions']>[number]): boolean {
  return execution.status === 'paused' || execution.status === 'interrupted';
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

function implementationPlanGenerationReason(item: DevelopmentPlanItemProjection): string {
  if (!isApproved(item.spec_status)) return 'Implementation Plan Doc generation waits for an approved Spec.';
  if (!requiresSpecQaStrategy(item)) return 'Implementation Plan Doc generation is eligible. QA/test strategy is optional for low-risk, single-surface Plan Items.';
  if (!hasSpecQaStrategy(item)) return 'Implementation Plan Doc generation requires QA/Test Owner participation, a testability note, acceptance criteria, and a test strategy summary for higher-risk, release-impacting, or cross-surface Plan Items.';
  return 'Implementation Plan Doc generation is eligible from the approved Spec.';
}

function executionStartReason(item: DevelopmentPlanItemProjection): string {
  if (!isApproved(item.implementation_plan_status)) return 'Execution start waits for an approved Implementation Plan Doc.';
  if (!hasRunnableExecutionBoundary(item)) return 'Execution start requires a runnable internal execution boundary before Codex can run.';
  return 'Execution can start from the approved Implementation Plan Doc and runnable execution boundary.';
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

function verificationEvidenceFor(execution: NonNullable<DevelopmentPlanItemProjection['executions']>[number] | undefined): ProductObjectRef[] {
  if (execution === undefined) return [];
  return [...(execution.evidence_refs ?? []), ...(execution.test_evidence_refs ?? [])];
}

function invalidateItem(queryClient: ReturnType<typeof useQueryClient>, developmentPlanId: string | undefined, itemId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['development-plans'] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.developmentPlan(developmentPlanId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.developmentPlanItem(developmentPlanId, itemId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.developmentPlanItemRevisions(developmentPlanId, itemId) }),
    queryClient.invalidateQueries({ queryKey: ['document-review-queue'] }),
    queryClient.invalidateQueries({ queryKey: ['executions'] }),
    queryClient.invalidateQueries({ queryKey: ['code-review-handoffs'] }),
    queryClient.invalidateQueries({ queryKey: ['qa-handoffs'] }),
    queryClient.invalidateQueries({ queryKey: ['my-work'] }),
    queryClient.invalidateQueries({ queryKey: ['reports'] }),
    queryClient.invalidateQueries({ queryKey: ['release-readiness'] }),
  ]);
}

function decisionCount(revision: BoundarySummaryRevision): number {
  if (revision.decision_count !== undefined) return revision.decision_count;
  if (revision.decisions !== undefined) return revision.decisions.length;
  if (revision.decision_snapshot !== undefined) return revision.decision_snapshot.length;
  return 0;
}
