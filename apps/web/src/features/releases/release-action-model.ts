import type { ReleaseBlocker, ReleaseCockpitResponse } from '../../shared/api/types';

export type ReleaseActionGroupId =
  | 'edit_planning'
  | 'submit_for_approval'
  | 'approval_decision'
  | 'qa_test_acceptance'
  | 'observation_transition'
  | 'close_release';

export type ReleaseDecisionActionId = 'approve' | 'override_approve' | 'request_changes';

export type ReleaseActionGroupState = {
  visible: boolean;
  enabled: boolean;
  reason?: string;
};

export type ReleaseDecisionActionState = ReleaseActionGroupState & {
  requiresConfirmationText?: string;
  requiresRationale?: boolean;
};

export type ReleaseActionModel = {
  groups: Record<ReleaseActionGroupId, ReleaseActionGroupState>;
  approvalActions: Record<ReleaseDecisionActionId, ReleaseDecisionActionState>;
  planningComplete: boolean;
  hasBlockers: boolean;
  missingPlanningFields: string[];
  closeConfirmationText: 'close release';
};

const planningFieldLabels = {
  scope_summary: 'scope summary',
  rollout_strategy: 'rollout strategy',
  rollback_plan: 'rollback plan',
  observation_plan: 'observation plan',
} as const;

export function releaseActionModel(cockpit: ReleaseCockpitResponse): ReleaseActionModel {
  const release = cockpit.release;
  const phase = normalizeState(release.phase);
  const gateState = normalizeState(release.gate_state);
  const resolution = normalizeState(release.resolution);
  const missingPlanningFields = Object.entries(planningFieldLabels)
    .filter(([field]) => !hasText(release[field as keyof typeof planningFieldLabels]))
    .map(([, label]) => label);
  const activeBlockers = releaseBlockers(cockpit);
  const planningComplete = missingPlanningFields.length === 0;
  const hasBlockers = activeBlockers.length > 0;
  const hasHighRiskQaAcknowledgementBlocker = activeBlockers.some(isHighRiskQaAcknowledgementBlocker);
  const onlyHighRiskQaAcknowledgementBlockers = hasBlockers && activeBlockers.every(isHighRiskQaAcknowledgementBlocker);
  const draftOrCandidate = phase === 'draft' || phase === 'candidate';
  const changesRequestedResubmission = phase === 'approval' && gateState === 'changes_requested' && resolution === 'none';
  const planningEditable = draftOrCandidate || changesRequestedResubmission;
  const approvalDecisionVisible = phase === 'approval' && gateState === 'awaiting_approval';
  const handoffRelevant = phase === 'rollout' || phase === 'observing';
  const qaTestAcceptanceVisible = handoffRelevant || (planningEditable && hasHighRiskQaAcknowledgementBlocker);
  const observationTransitionVisible = phase === 'rollout' && gateState === 'approved' && resolution === 'none';
  const closeReleaseVisible =
    phase === 'observing' && gateState === 'rollout_succeeded' && resolution === 'none';
  const planningReason = planningComplete
    ? undefined
    : `Complete ${formatList(missingPlanningFields)} before submitting.`;
  const upstreamBlockerReason = hasBlockers && !onlyHighRiskQaAcknowledgementBlockers
    ? 'Resolve upstream blockers before acknowledging test acceptance.'
    : undefined;

  return {
    groups: {
      edit_planning: {
        visible: planningEditable,
        enabled: true,
      },
      submit_for_approval: {
        visible: planningEditable,
        enabled: planningComplete,
        ...(planningReason === undefined ? {} : { reason: planningReason }),
      },
      approval_decision: {
        visible: approvalDecisionVisible,
        enabled: true,
      },
      qa_test_acceptance: {
        visible: qaTestAcceptanceVisible,
        enabled: upstreamBlockerReason === undefined,
        ...(upstreamBlockerReason === undefined ? {} : { reason: upstreamBlockerReason }),
      },
      observation_transition: {
        visible: observationTransitionVisible,
        enabled: true,
      },
      close_release: {
        visible: closeReleaseVisible,
        enabled: true,
      },
    },
    approvalActions: {
      approve: {
        visible: approvalDecisionVisible,
        enabled: approvalDecisionVisible && !hasBlockers,
        ...(hasBlockers ? { reason: 'Active blockers require override approval.' } : {}),
      },
      override_approve: {
        visible: approvalDecisionVisible && hasBlockers,
        enabled: true,
        requiresConfirmationText: 'override approve',
        requiresRationale: true,
      },
      request_changes: {
        visible: approvalDecisionVisible,
        enabled: true,
        requiresRationale: true,
      },
    },
    planningComplete,
    hasBlockers,
    missingPlanningFields,
    closeConfirmationText: 'close release',
  };
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function releaseBlockers(cockpit: ReleaseCockpitResponse) {
  return [...cockpit.blockers, ...cockpit.blocker_snapshot.blockers].filter((blocker, index, blockers) => {
    const identity = releaseBlockerIdentity(blocker);
    return blockers.findIndex((candidate) => releaseBlockerIdentity(candidate) === identity) === index;
  });
}

function releaseBlockerIdentity(blocker: ReleaseBlocker) {
  return [blocker.code, blocker.object_type ?? '', blocker.object_id ?? '', blocker.message].join('|');
}

function isHighRiskQaAcknowledgementBlocker(blocker: ReleaseBlocker) {
  return (
    blocker.code === 'missing_required_evidence_backlink' &&
    blocker.object_type === 'release' &&
    blocker.message === 'Release is missing high-risk QA acknowledgement.'
  );
}

function normalizeState(value: string | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function formatList(values: string[]) {
  if (values.length <= 1) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}
