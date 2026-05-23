import { useState } from 'react';

import {
  useApproveItemExecutionPlanMutation,
  useApproveItemSpecMutation,
  useRequestItemExecutionPlanChangesMutation,
  useRequestItemSpecChangesMutation,
  useSubmitItemExecutionPlanForApprovalMutation,
  useSubmitItemSpecForApprovalMutation,
} from '../../shared/api/hooks';
import type { SpecPlan } from '../../shared/api/types';
import { Button, InlineNotice, Textarea } from '../../shared/ui';

export type SpecPlanLifecycleKind = 'spec' | 'plan';

export interface SpecPlanLifecycleActionsProps {
  artifact: SpecPlan | null | undefined;
  actorId: string;
  developmentPlanId?: string;
  itemId?: string;
  kind: SpecPlanLifecycleKind;
}

export function isStrictlyApproved(artifact: SpecPlan | null | undefined) {
  return Boolean(
    artifact &&
      artifact.status === 'approved' &&
      artifact.resolution === 'approved' &&
      artifact.approved_revision_id &&
      artifact.current_revision_id === artifact.approved_revision_id,
  );
}

function canSubmit(artifact: SpecPlan | null | undefined) {
  return Boolean(
    artifact &&
      artifact.current_revision_id &&
      artifact.status === 'draft' &&
      (artifact.gate_state === 'not_submitted' || artifact.gate_state === 'changes_requested'),
  );
}

function canReview(artifact: SpecPlan | null | undefined) {
  return Boolean(
    artifact &&
      artifact.current_revision_id &&
      artifact.status === 'in_review' &&
      artifact.gate_state === 'awaiting_approval',
  );
}

export function SpecPlanLifecycleActions({
  actorId,
  artifact,
  developmentPlanId,
  itemId,
  kind,
}: SpecPlanLifecycleActionsProps) {
  const label = kind === 'spec' ? 'Spec' : 'Plan';
  const [approveRationale, setApproveRationale] = useState('');
  const [changeRationale, setChangeRationale] = useState('');
  const [lastError, setLastError] = useState<string | null>(null);
  const itemScopedInput = { developmentPlanId: developmentPlanId ?? '', itemId: itemId ?? '' };
  const submitSpec = useSubmitItemSpecForApprovalMutation(itemScopedInput);
  const approveSpec = useApproveItemSpecMutation(itemScopedInput);
  const requestSpecChanges = useRequestItemSpecChangesMutation(itemScopedInput);
  const submitPlan = useSubmitItemExecutionPlanForApprovalMutation(itemScopedInput);
  const approvePlan = useApproveItemExecutionPlanMutation(itemScopedInput);
  const requestPlanChanges = useRequestItemExecutionPlanChangesMutation(itemScopedInput);
  const submitMutation = kind === 'spec' ? submitSpec : submitPlan;
  const approveMutation = kind === 'spec' ? approveSpec : approvePlan;
  const requestChangesMutation = kind === 'spec' ? requestSpecChanges : requestPlanChanges;
  const isPending = submitMutation.isPending || approveMutation.isPending || requestChangesMutation.isPending;
  const changeRationaleReady = changeRationale.trim().length > 0;
  const mutationOptions = {
    onError: (error: Error) => setLastError(error.message),
    onSuccess: () => {
      setLastError(null);
      setApproveRationale('');
      setChangeRationale('');
    },
  };

  if (artifact === null || artifact === undefined) {
    return (
      <div className="grid gap-3">
        <InlineNotice title={`No ${label} artifact is available for lifecycle actions.`} />
      </div>
    );
  }

  if (developmentPlanId === undefined || itemId === undefined) {
    return (
      <div className="grid gap-3">
        <InlineNotice title={`${label} lifecycle actions require Development Plan Item context.`} tone="info" />
      </div>
    );
  }

  if (!artifact.current_revision_id) {
    return (
      <div className="grid gap-3">
        <InlineNotice title={missingRevisionMessage(label)} />
      </div>
    );
  }

  if (isStrictlyApproved(artifact)) {
    return (
      <div className="grid gap-3">
        <InlineNotice title={`${label} approved at revision ${artifact.approved_revision_id}.`} tone="success" />
      </div>
    );
  }

  if (canSubmit(artifact)) {
    return (
      <div className="grid gap-3">
        <Button
          disabled={isPending}
          loading={submitMutation.isPending}
          onClick={() => submitMutation.mutate({ actor_id: actorId }, mutationOptions)}
          variant="primary"
        >
          Submit {label} for approval
        </Button>
        <LifecycleFeedback error={lastError} pending={submitMutation.isPending ? `${label} is being submitted.` : null} />
      </div>
    );
  }

  if (canReview(artifact)) {
    return (
      <div className="grid gap-3">
        <label className="grid gap-2">
          <span className="text-sm font-medium text-text-secondary">{label} approval rationale</span>
          <Textarea
            onChange={(event) => setApproveRationale(event.currentTarget.value)}
            rows={2}
            value={approveRationale}
          />
        </label>
        <Button
          disabled={isPending}
          loading={approveMutation.isPending}
          onClick={() =>
            approveMutation.mutate(
              {
                actor_id: actorId,
                ...(approveRationale.trim() ? { rationale: approveRationale.trim() } : {}),
              },
              mutationOptions,
            )
          }
          variant="primary"
        >
          Approve {label}
        </Button>
        <label className="grid gap-2">
          <span className="text-sm font-medium text-text-secondary">{label} change rationale</span>
          <Textarea
            invalid={!changeRationaleReady && changeRationale.length > 0}
            onChange={(event) => setChangeRationale(event.currentTarget.value)}
            rows={3}
            value={changeRationale}
          />
        </label>
        <Button
          disabled={isPending || !changeRationaleReady}
          loading={requestChangesMutation.isPending}
          onClick={() =>
            requestChangesMutation.mutate({ actor_id: actorId, rationale: changeRationale.trim() }, mutationOptions)
          }
          variant="secondary"
        >
          Request {label} changes
        </Button>
        <LifecycleFeedback
          error={lastError}
          pending={
            approveMutation.isPending
              ? `${label} approval is being recorded.`
              : requestChangesMutation.isPending
                ? `${label} change request is being recorded.`
                : null
          }
        />
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <InlineNotice
        title={`${label} lifecycle actions are blocked while status is ${artifact.status} and gate is ${artifact.gate_state}.`}
        tone="warning"
      />
    </div>
  );
}

function missingRevisionMessage(label: 'Spec' | 'Plan') {
  if (label === 'Spec') {
    return 'Create a current Spec revision before submitting for approval.';
  }

  return 'Plan approval is available after a current Plan revision exists.';
}

function LifecycleFeedback({ error, pending }: { error: string | null; pending: string | null }) {
  if (error) {
    return <InlineNotice title={error} tone="danger" />;
  }

  if (pending) {
    return <InlineNotice title={pending} tone="info" />;
  }

  return null;
}
