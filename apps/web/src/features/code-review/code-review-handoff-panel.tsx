import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { createForgeloopCommandApi } from '../../shared/api/commands';
import { queryKeys } from '../../shared/api/query-keys';
import type { ProductObjectRef } from '../../shared/api/types';
import { useActorContext } from '../../shared/context/actor-context';
import { InlineActions, Section } from '../../shared/layout';
import { Button, InlineNotice, StatusPill, Textarea } from '../../shared/ui';

type ProductRef = ProductObjectRef;
type ExecutionSummary = {
  id: string;
  development_plan_item_id?: string;
  execution_plan_revision_id?: string;
  development_plan_item_ref?: ProductRef & { development_plan_id?: string };
  execution_plan_revision_ref?: ProductRef & { execution_plan_id?: string };
  evidence_refs?: ProductRef[];
  status?: string;
};
export type CodeReviewHandoffProjection = {
  id: string;
  execution_id: string;
  execution_plan_revision_id?: string;
  reviewer_actor_id?: string;
  status?: string;
  summary?: string;
  changed_surfaces?: string[];
  verification_evidence_refs?: ProductRef[];
  comments?: string[];
  changes_requested?: string[];
  audited_exception?: { reason?: string; risk?: string; rollback_plan?: string };
};

export function CodeReviewHandoffPanel({
  execution,
  handoff,
}: {
  execution: ExecutionSummary;
  handoff?: CodeReviewHandoffProjection | undefined;
}) {
  const { actorId } = useActorContext();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string>();
  const [rationale, setRationale] = useState('');
  const commandApi = createForgeloopCommandApi();
  const executionEvidenceRefs = execution.evidence_refs ?? [];
  const evidenceRefs: ProductObjectRef[] = handoff?.verification_evidence_refs ?? execution.evidence_refs ?? [{ type: 'execution', id: execution.id, title: `Execution ${execution.id}` }];
  const changedSurfaces = handoff?.changed_surfaces ?? ['Implementation diff'];
  const canReadyForCodeReview = execution.status === 'completed' && executionEvidenceRefs.length > 0 && handoff === undefined;
  const canResolveCodeReview = handoff?.status === 'in_review';

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.execution(execution.id) }),
      queryClient.invalidateQueries({ queryKey: ['executions'] }),
      queryClient.invalidateQueries({ queryKey: ['code-review-handoffs'] }),
    ]);
  }

  async function readyForCodeReview() {
    if (!canReadyForCodeReview) return;
    await commandApi.markExecutionReadyForCodeReview(execution.id, {
      actor_id: actorId,
      summary: 'Execution is ready for code review.',
      changed_surfaces: changedSurfaces,
      verification_evidence_refs: executionEvidenceRefs,
    });
    setMessage('Execution marked ready for code review.');
    await refresh();
  }

  async function approve() {
    if (!canResolveCodeReview || handoff === undefined) return;
    await commandApi.approveCodeReviewHandoff(handoff.id, { actor_id: actorId, rationale: rationale.trim() || 'Code review passed.' });
    setMessage('Code review approved.');
    await refresh();
  }

  async function requestChanges() {
    if (!canResolveCodeReview || handoff === undefined) return;
    await commandApi.requestCodeReviewChanges(handoff.id, { actor_id: actorId, rationale: rationale.trim() || 'Address review findings before QA.' });
    setMessage('Code review changes requested.');
    await refresh();
  }

  async function auditedException() {
    if (handoff === undefined) return;
    await commandApi.recordCodeReviewAuditedException(handoff.id, {
      actor_id: actorId,
      reason: rationale.trim() || 'Audited exception for early QA preparation.',
      risk: 'medium',
      rollback_plan: 'Keep release readiness blocked until review risk is resolved.',
    });
    setMessage('Audited code review exception recorded.');
    await refresh();
  }

  return (
    <Section
      actions={<StatusPill tone={handoff?.status === 'approved' ? 'success' : 'info'}>{handoff?.status ?? 'not started'}</StatusPill>}
      title="Code review handoff"
    >
      <div className="grid gap-4">
        {message ? <InlineNotice title={message} tone="success" /> : null}
        <dl className="grid gap-3 text-sm md:grid-cols-2">
          <Definition label="Execution" value={execution.id} />
          <Definition label="Approved Execution Plan revision" value={execution.execution_plan_revision_ref?.title ?? execution.execution_plan_revision_id ?? 'Not linked'} />
          <Definition label="Reviewer" value={handoff?.reviewer_actor_id ?? 'Unassigned'} />
          <Definition label="Changed surfaces" value={changedSurfaces.join(', ')} />
          <Definition label="Verification evidence" value={evidenceRefs.map((ref) => ref.title ?? ref.id).join(', ')} />
          <Definition label="Comments or requested changes" value={[...(handoff?.comments ?? []), ...(handoff?.changes_requested ?? [])].join(', ') || 'None recorded'} />
        </dl>
        {handoff?.audited_exception ? (
          <InlineNotice
            description="This exception only permits QA preparation. Release readiness remains blocked until the review risk is resolved."
            title="Audited review exception"
            tone="warning"
          />
        ) : null}
        {!canReadyForCodeReview ? (
          <InlineNotice
            title="Ready for code review requires a completed execution, verification evidence, and no existing handoff."
            tone="warning"
          />
        ) : null}
        <Textarea aria-label="Code review rationale" onChange={(event) => setRationale(event.target.value)} placeholder="Review rationale or requested change details" value={rationale} />
        <InlineActions>
          <Button disabled={!canReadyForCodeReview} onClick={() => void readyForCodeReview()} type="button">Ready for code review</Button>
          <Button disabled={!canResolveCodeReview} onClick={() => void approve()} type="button" variant="secondary">Approve code review</Button>
          <Button disabled={!canResolveCodeReview} onClick={() => void requestChanges()} type="button" variant="secondary">Request changes</Button>
          <Button disabled={handoff === undefined} onClick={() => void auditedException()} type="button" variant="secondary">Audited exception</Button>
        </InlineActions>
      </div>
    </Section>
  );
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-md border border-border bg-background p-3">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="font-semibold text-text-primary">{value}</dd>
    </div>
  );
}
