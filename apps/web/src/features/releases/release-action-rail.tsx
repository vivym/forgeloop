import { useState, type FormEvent, type ReactNode } from 'react';

import {
  useApproveReleaseMutation,
  useCloseReleaseMutation,
  useOverrideApproveReleaseMutation,
  usePatchReleaseMutation,
  useRequestReleaseChangesMutation,
  useStartReleaseObservingMutation,
  useSubmitReleaseMutation,
} from '../../shared/api/hooks';
import type {
  PatchReleaseBody,
  ReleaseBlockerSnapshot,
  ReleaseCockpitResponse,
} from '../../shared/api/types';
import { ActionRail } from '../../shared/layout';
import { Button, Drawer, Input, Select, Textarea } from '../../shared/ui';
import type { ReleaseActionModel } from './release-action-model';

export function ReleaseActionRail({
  actorId,
  cockpit,
  model,
}: {
  actorId: string;
  cockpit: ReleaseCockpitResponse;
  model: ReleaseActionModel;
}) {
  const releaseId = cockpit.release.id;
  const submit = useSubmitReleaseMutation(releaseId);
  const approve = useApproveReleaseMutation(releaseId);
  const overrideApprove = useOverrideApproveReleaseMutation(releaseId);
  const requestChanges = useRequestReleaseChangesMutation(releaseId);
  const startObserving = useStartReleaseObservingMutation(releaseId);
  const closeRelease = useCloseReleaseMutation(releaseId);
  const [showEditRelease, setShowEditRelease] = useState(false);
  const [approveRationale, setApproveRationale] = useState('');
  const [overrideRationale, setOverrideRationale] = useState('');
  const [overrideConfirmation, setOverrideConfirmation] = useState('');
  const [changesRationale, setChangesRationale] = useState('');
  const [closeSummary, setCloseSummary] = useState('');
  const [closeConfirmation, setCloseConfirmation] = useState('');
  const [closeResolution, setCloseResolution] = useState<'completed' | 'rolled_back' | 'cancelled'>('completed');
  const [closeObservationOverrideRationale, setCloseObservationOverrideRationale] = useState('');
  const canOverrideApprove =
    model.approvalActions.override_approve.enabled &&
    overrideRationale.trim().length > 0 &&
    overrideConfirmation.trim().toLowerCase() === 'override approve';
  const canRequestChanges = model.approvalActions.request_changes.enabled && changesRationale.trim().length > 0;
  const requiresObservationOverride = closeResolution === 'completed' && cockpit.observations.length === 0;
  const canCloseRelease =
    model.groups.close_release.enabled &&
    closeConfirmation.trim().toLowerCase() === model.closeConfirmationText &&
    (!requiresObservationOverride || closeObservationOverrideRationale.trim().length > 0);

  return (
    <ActionRail title="Release decisions">
      <div className="stack-form compact">
        {model.groups.edit_planning.visible ? (
          <Drawer
            content={<EditReleaseForm actorId={actorId} onSaved={() => setShowEditRelease(false)} release={cockpit.release} />}
            description="Update release title and planning details."
            onOpenChange={setShowEditRelease}
            open={showEditRelease}
            title="Edit release details"
          >
            <Button disabled={!model.groups.edit_planning.enabled} variant="secondary">
              Edit release
            </Button>
          </Drawer>
        ) : null}

        {model.groups.submit_for_approval.visible ? (
          <DecisionGroup title="Submit for approval">
            {model.groups.submit_for_approval.reason ? <p className="empty">{model.groups.submit_for_approval.reason}</p> : null}
            {submit.isError ? <p className="empty">Release submission is temporarily unavailable.</p> : null}
            <Button
              disabled={!model.groups.submit_for_approval.enabled}
              loading={submit.isPending}
              onClick={() => submit.mutate({ actor_id: actorId })}
              variant="primary"
            >
              Submit for approval
            </Button>
          </DecisionGroup>
        ) : null}

        {model.groups.approval_decision.visible ? (
          <DecisionGroup title="Approval decision">
            {model.approvalActions.approve.visible ? (
              <>
                <label className="field">
                  Approval rationale
                  <Textarea onChange={(event) => setApproveRationale(event.currentTarget.value)} rows={2} value={approveRationale} />
                </label>
                {model.approvalActions.approve.reason ? <p className="empty">{model.approvalActions.approve.reason}</p> : null}
                {approve.isError ? <p className="empty">Approval is temporarily unavailable.</p> : null}
                <Button
                  disabled={!model.approvalActions.approve.enabled}
                  loading={approve.isPending}
                  onClick={() =>
                    approve.mutate({
                      actor_id: actorId,
                      ...(approveRationale.trim() ? { rationale: approveRationale.trim() } : {}),
                    })
                  }
                  variant="primary"
                >
                  Approve
                </Button>
              </>
            ) : null}

            {model.approvalActions.override_approve.visible ? (
              <>
                <label className="field">
                  Override rationale
                  <Textarea onChange={(event) => setOverrideRationale(event.currentTarget.value)} rows={3} value={overrideRationale} />
                </label>
                <label className="field">
                  Override confirmation
                  <Input
                    onChange={(event) => setOverrideConfirmation(event.currentTarget.value)}
                    placeholder="Type override approve"
                    value={overrideConfirmation}
                  />
                </label>
                {overrideApprove.isError ? <p className="empty">Override approval is temporarily unavailable.</p> : null}
                <Button
                  disabled={!canOverrideApprove}
                  loading={overrideApprove.isPending}
                  onClick={() =>
                    overrideApprove.mutate({
                      actor_id: actorId,
                      rationale: overrideRationale.trim(),
                      blocker_snapshot: cockpit.blocker_snapshot as ReleaseBlockerSnapshot,
                    })
                  }
                  variant="danger"
                >
                  Override approve
                </Button>
              </>
            ) : null}

            {model.approvalActions.request_changes.visible ? (
              <>
                <label className="field">
                  Change request rationale
                  <Textarea onChange={(event) => setChangesRationale(event.currentTarget.value)} rows={3} value={changesRationale} />
                </label>
                {requestChanges.isError ? <p className="empty">Change request is temporarily unavailable.</p> : null}
                <Button
                  disabled={!canRequestChanges}
                  loading={requestChanges.isPending}
                  onClick={() => requestChanges.mutate({ actor_id: actorId, rationale: changesRationale.trim() })}
                  variant="secondary"
                >
                  Request changes
                </Button>
              </>
            ) : null}
          </DecisionGroup>
        ) : null}

        {model.groups.qa_test_acceptance.visible ? (
          <DecisionGroup title="Test acceptance">
            {model.groups.qa_test_acceptance.reason ? <p className="empty">{model.groups.qa_test_acceptance.reason}</p> : null}
            {model.groups.qa_test_acceptance.enabled ? <a href="#release-test-acceptance">Review test acceptance</a> : null}
          </DecisionGroup>
        ) : null}

        {model.groups.observation_transition.visible ? (
          <DecisionGroup title="Observation transition">
            {startObserving.isError ? <p className="empty">Observation transition is temporarily unavailable.</p> : null}
            <Button
              disabled={!model.groups.observation_transition.enabled}
              loading={startObserving.isPending}
              onClick={() => startObserving.mutate({ actor_id: actorId })}
              variant="primary"
            >
              Start observing
            </Button>
          </DecisionGroup>
        ) : null}

        {model.groups.close_release.visible ? (
          <DecisionGroup title="Close release">
            <label className="field">
              Close resolution
              <Select
                onChange={(event) => setCloseResolution(event.currentTarget.value as 'completed' | 'rolled_back' | 'cancelled')}
                options={[
                  { label: 'Completed', value: 'completed' },
                  { label: 'Rolled back', value: 'rolled_back' },
                  { label: 'Cancelled', value: 'cancelled' },
                ]}
                value={closeResolution}
              />
            </label>
            <label className="field">
              Close summary
              <Textarea onChange={(event) => setCloseSummary(event.currentTarget.value)} rows={2} value={closeSummary} />
            </label>
            <label className="field">
              Close confirmation
              <Input
                onChange={(event) => setCloseConfirmation(event.currentTarget.value)}
                placeholder="Type close release"
                value={closeConfirmation}
              />
            </label>
            {requiresObservationOverride ? (
              <>
                <p className="empty">Completion needs an observation override because no observation evidence is recorded.</p>
                <label className="field">
                  Observation override rationale
                  <Textarea
                    onChange={(event) => setCloseObservationOverrideRationale(event.currentTarget.value)}
                    rows={3}
                    value={closeObservationOverrideRationale}
                  />
                </label>
              </>
            ) : null}
            {closeRelease.isError ? <p className="empty">Release closure is temporarily unavailable.</p> : null}
            <Button
              disabled={!canCloseRelease}
              loading={closeRelease.isPending}
              onClick={() =>
                closeRelease.mutate({
                  actor_id: actorId,
                  resolution: closeResolution,
                  ...(closeSummary.trim() ? { summary: closeSummary.trim() } : {}),
                  override_without_observation: requiresObservationOverride,
                  ...(requiresObservationOverride ? { override_rationale: closeObservationOverrideRationale.trim() } : {}),
                })
              }
              variant="danger"
            >
              Close release
            </Button>
          </DecisionGroup>
        ) : null}
      </div>
    </ActionRail>
  );
}

function DecisionGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="stack-form compact">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

function EditReleaseForm({
  actorId,
  onSaved,
  release,
}: {
  actorId: string;
  onSaved: () => void;
  release: ReleaseCockpitResponse['release'];
}) {
  const patchRelease = usePatchReleaseMutation(release.id);
  const [title, setTitle] = useState(release.title);
  const [scopeSummary, setScopeSummary] = useState(release.scope_summary ?? '');
  const [rolloutStrategy, setRolloutStrategy] = useState(release.rollout_strategy ?? '');
  const [rollbackPlan, setRollbackPlan] = useState(release.rollback_plan ?? '');
  const [observationPlan, setObservationPlan] = useState(release.observation_plan ?? '');

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const body = releasePatchBody({
      actorId,
      title,
      scopeSummary,
      rolloutStrategy,
      rollbackPlan,
      observationPlan,
    });
    if (body === undefined) return;
    patchRelease.mutate(body, { onSuccess: onSaved });
  }

  return (
    <form className="stack-form compact" onSubmit={onSubmit}>
      <label className="field">
        Release title
        <Input onChange={(event) => setTitle(event.currentTarget.value)} value={title} />
      </label>
      <label className="field">
        Scope summary
        <Textarea onChange={(event) => setScopeSummary(event.currentTarget.value)} rows={3} value={scopeSummary} />
      </label>
      <label className="field">
        Rollout strategy
        <Textarea onChange={(event) => setRolloutStrategy(event.currentTarget.value)} rows={2} value={rolloutStrategy} />
      </label>
      <label className="field">
        Rollback plan
        <Textarea onChange={(event) => setRollbackPlan(event.currentTarget.value)} rows={2} value={rollbackPlan} />
      </label>
      <label className="field">
        Observation plan
        <Textarea onChange={(event) => setObservationPlan(event.currentTarget.value)} rows={2} value={observationPlan} />
      </label>
      {patchRelease.isError ? <p className="empty">Release update is temporarily unavailable.</p> : null}
      <Button
        disabled={releasePatchBody({ actorId, title, scopeSummary, rolloutStrategy, rollbackPlan, observationPlan }) === undefined}
        loading={patchRelease.isPending}
        type="submit"
        variant="primary"
      >
        Save release
      </Button>
    </form>
  );
}

function releasePatchBody(input: {
  actorId: string;
  title: string;
  scopeSummary: string;
  rolloutStrategy: string;
  rollbackPlan: string;
  observationPlan: string;
}): PatchReleaseBody | undefined {
  const body = {
    actor_id: input.actorId,
    ...(input.title.trim() ? { title: input.title.trim() } : {}),
    ...(input.scopeSummary.trim() ? { scope_summary: input.scopeSummary.trim() } : {}),
    ...(input.rolloutStrategy.trim() ? { rollout_strategy: input.rolloutStrategy.trim() } : {}),
    ...(input.rollbackPlan.trim() ? { rollback_plan: input.rollbackPlan.trim() } : {}),
    ...(input.observationPlan.trim() ? { observation_plan: input.observationPlan.trim() } : {}),
  };

  return Object.keys(body).length > 1 ? body : undefined;
}
