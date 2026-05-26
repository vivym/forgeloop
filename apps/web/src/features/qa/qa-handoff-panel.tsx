import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { createForgeloopCommandApi } from '../../shared/api/commands';
import { queryKeys } from '../../shared/api/query-keys';
import type { ProductObjectRef } from '../../shared/api/types';
import { useActorContext } from '../../shared/context/actor-context';
import { InlineActions, Section } from '../../shared/layout';
import { Button, InlineNotice, StatusPill, Textarea } from '../../shared/ui';
import type { CodeReviewHandoffProjection } from '../code-review/code-review-handoff-panel';

type ProductRef = ProductObjectRef;
export type QaHandoffProjection = {
  id: string;
  execution_id: string;
  source_ref?: ProductRef;
  development_plan_item_id?: string;
  development_plan_item_ref?: ProductRef & { development_plan_id?: string };
  approved_spec_revision_ref?: ProductRef & { spec_id?: string };
  approved_execution_plan_revision_ref?: ProductRef & { execution_plan_id?: string };
  status?: string;
  acceptance_criteria?: string[];
  test_strategy?: string;
  verification_evidence_refs?: ProductRef[];
  known_risks?: string[];
  changed_surfaces?: string[];
  release_impact?: string;
  audited_exception?: { reason?: string };
};
type ExecutionSummary = {
  id: string;
  source_ref?: ProductRef;
  development_plan_item_id?: string;
  development_plan_item_ref?: ProductRef & { development_plan_id?: string };
  execution_plan_revision_ref?: ProductRef & { execution_plan_id?: string };
  evidence_refs?: ProductRef[];
};

export function QaHandoffPanel({
  execution,
  codeReview,
  handoff,
}: {
  execution: ExecutionSummary;
  codeReview?: CodeReviewHandoffProjection | undefined;
  handoff?: QaHandoffProjection | undefined;
}) {
  const { actorId } = useActorContext();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string>();
  const [rationale, setRationale] = useState('');
  const commandApi = createForgeloopCommandApi();
  const evidenceRefs: ProductObjectRef[] = handoff?.verification_evidence_refs ?? execution.evidence_refs ?? [{ type: 'execution', id: execution.id, title: 'Linked execution evidence' }];
  const criteria = handoff?.acceptance_criteria ?? ['Approved Spec acceptance criteria remain satisfied'];
  const testStrategy = handoff?.test_strategy ?? 'Route tests, focused UI checks, and reviewer evidence.';
  const earlyQa = codeReview?.audited_exception !== undefined && codeReview.status !== 'approved';
  const canCreateHandoff = handoff === undefined && codeReview !== undefined && (codeReview.status === 'approved' || codeReview.audited_exception !== undefined);
  const canBlockHandoff = handoff?.status === 'pending';
  const canAcceptHandoff = codeReview?.status === 'approved' && (handoff?.status === 'pending' || handoff?.status === 'blocked');

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.execution(execution.id) }),
      queryClient.invalidateQueries({ queryKey: ['qa-handoffs'] }),
      queryClient.invalidateQueries({ queryKey: ['code-review-handoffs'] }),
    ]);
  }

  async function createHandoff() {
    if (codeReview === undefined) return;
    await commandApi.createQaHandoff(codeReview.id, {
      actor_id: actorId,
      acceptance_criteria: criteria,
      test_strategy: testStrategy,
      verification_evidence_refs: evidenceRefs,
      known_risks: handoff?.known_risks ?? [],
    });
    setMessage('QA handoff created.');
    await refresh();
  }

  async function blockQa() {
    if (!canBlockHandoff || handoff === undefined) return;
    await commandApi.blockQaHandoff(handoff.id, { actor_id: actorId, rationale: rationale.trim() || 'QA handoff is blocked.' });
    setMessage('QA handoff blocked.');
    await refresh();
  }

  async function acceptQa() {
    if (!canAcceptHandoff || handoff === undefined) return;
    await commandApi.acceptQaHandoff(handoff.id, {
      actor_id: actorId,
      rationale: rationale.trim() || 'QA handoff accepted.',
      verification_evidence_refs: evidenceRefs,
    });
    setMessage('QA accepted.');
    await refresh();
  }

  return (
    <Section
      actions={<StatusPill tone={handoff?.status === 'accepted' ? 'success' : 'info'}>{handoff?.status ?? 'not started'}</StatusPill>}
      title="QA handoff"
    >
      <div className="grid gap-4">
        {message ? <InlineNotice title={message} tone="success" /> : null}
        {earlyQa ? (
          <InlineNotice
            description="This prepares QA only. Release readiness is not passed until code review and QA both close."
            title="Early QA preparation through audited exception"
            tone="warning"
          />
        ) : null}
        {codeReview !== undefined && !canCreateHandoff ? (
          <InlineNotice
            title="QA handoff requires approved code review or an audited exception."
            tone="warning"
          />
        ) : null}
        <dl className="grid gap-3 text-sm md:grid-cols-2">
          <Definition label="Source object" value={handoff?.source_ref?.title ?? execution.source_ref?.title ?? 'Not linked'} />
          <Definition label="Development Plan Item" value={handoff?.development_plan_item_ref?.title ?? execution.development_plan_item_ref?.title ?? ((handoff?.development_plan_item_id ?? execution.development_plan_item_id) === undefined ? 'Not linked' : 'Linked Plan Item')} />
          <Definition label="Approved Spec" value={handoff?.approved_spec_revision_ref?.title ?? 'Not linked'} />
          <Definition label="Approved Execution Plan" value={handoff?.approved_execution_plan_revision_ref?.title ?? execution.execution_plan_revision_ref?.title ?? 'Not linked'} />
          <Definition label="Acceptance criteria" value={criteria.join(', ')} />
          <Definition label="Test strategy" value={testStrategy} />
          <Definition label="Verification evidence" value={evidenceRefs.map(evidenceLabel).join(', ')} />
          <Definition label="Known risks" value={(handoff?.known_risks ?? []).join(', ') || 'None recorded'} />
          <Definition label="Changed surfaces" value={(handoff?.changed_surfaces ?? codeReview?.changed_surfaces ?? []).join(', ') || 'Not recorded'} />
          <Definition label="Release impact" value={formatValue(handoff?.release_impact)} />
        </dl>
        <Textarea aria-label="QA handoff rationale" onChange={(event) => setRationale(event.target.value)} placeholder="QA decision rationale" value={rationale} />
        <InlineActions>
          <Button disabled={!canCreateHandoff} onClick={() => void createHandoff()} type="button">Create QA handoff</Button>
          <Button disabled={!canBlockHandoff} onClick={() => void blockQa()} type="button" variant="secondary">Block QA</Button>
          <Button disabled={!canAcceptHandoff} onClick={() => void acceptQa()} type="button" variant="secondary">Accept QA handoff</Button>
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

function formatValue(value: string | undefined): string {
  return value === undefined ? 'Not recorded' : value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

function evidenceLabel(ref: ProductObjectRef): string {
  return ref.title ?? (ref.id === undefined ? 'Linked evidence' : 'Linked evidence');
}
