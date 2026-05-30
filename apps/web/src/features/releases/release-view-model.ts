import type { ProductPageViewModel, ViewModelAction, ViewModelEvidence } from '../product-surfaces/view-model-types';

type DisabledReason = { message?: string | undefined; code?: string | undefined };
type ReleaseReadinessItem = {
  status?: string | undefined;
  disabled_reason?: DisabledReason | undefined;
  evidence_ref?: unknown | undefined;
};

interface ReleaseProjection {
  id: string;
  title?: string;
  phase?: string;
  activity_state?: string;
  gate_state?: string;
  resolution?: string;
  release_owner_actor_id?: string | undefined;
  scope_summary?: string | undefined;
  rollback_plan?: string | undefined;
  updated_at?: string | undefined;
}

interface ReleaseReadinessProjection {
  ready?: boolean | undefined;
  disabled_reasons?: readonly DisabledReason[];
  scope_refs?: readonly { title?: string | undefined; id?: string | undefined; type?: string | undefined }[];
  required_review_evidence?: readonly ReleaseReadinessItem[];
  required_test_acceptance_evidence?: readonly ReleaseReadinessItem[];
  package_run_evidence?: readonly ReleaseReadinessItem[];
  observation_evidence?: readonly ReleaseReadinessItem[];
}

export function releaseViewModel(input: { release: ReleaseProjection; readiness: ReleaseReadinessProjection }): ProductPageViewModel {
  const { release, readiness } = input;
  const launchDisabledReason = launchDisabledReasonFor(readiness);
  const rollbackDisabledReason = release.rollback_plan === undefined || release.rollback_plan.trim() === '' ? 'Rollback details unavailable' : undefined;

  return {
    objectLabel: release.title ?? release.id,
    objectType: 'Release',
    currentState: release.phase ?? release.activity_state ?? 'Status unavailable',
    nextAction: launchDisabledReason === undefined ? 'Launch release' : 'Resolve release blockers',
    disabledReason: launchDisabledReason,
    primaryActorOrRole: 'Release owner',
    riskSignal: readiness.ready ? 'Release ready' : `${readiness.disabled_reasons?.length ?? 1} release blocker(s)`,
    gateProgress: [
      { label: 'Spec', state: evidenceState(readiness.required_review_evidence) },
      { label: 'Implementation Plan Doc', state: evidenceState(readiness.required_review_evidence) },
      { label: 'Execution', state: evidenceState(readiness.package_run_evidence) },
      { label: 'Code review', state: evidenceState(readiness.required_review_evidence), disabledReason: launchDisabledReason },
      { label: 'QA', state: evidenceState(readiness.required_test_acceptance_evidence), disabledReason: firstEvidenceDisabledReason(readiness) },
      { label: 'Approval', state: approvalState(readiness), disabledReason: launchDisabledReason },
      { label: 'Release blockers', state: launchDisabledReason === undefined ? 'clear' : 'blocked', disabledReason: launchDisabledReason },
      { label: 'Evidence', state: combinedEvidenceState(readiness), disabledReason: firstEvidenceDisabledReason(readiness) },
      { label: 'Rollback plan', state: rollbackDisabledReason === undefined ? 'available' : 'unavailable', disabledReason: rollbackDisabledReason },
      { label: 'Observation', state: evidenceState(readiness.observation_evidence) },
    ],
    criticalEvidence: releaseEvidence(readiness),
    secondaryMetadata: [
      { label: 'Scope refs', value: String(readiness.scope_refs?.length ?? 0) },
      { label: 'Gate', value: release.gate_state ?? 'Unavailable' },
      { label: 'Resolution', value: release.resolution ?? 'Unavailable' },
    ],
    previewSummary: release.scope_summary ?? 'Release scope unavailable',
    timelineSummary: release.updated_at === undefined ? 'Timeline unavailable' : `Updated ${release.updated_at}`,
    actions: [
      { id: 'launch', label: 'Launch release', enabled: launchDisabledReason === undefined, disabledReason: launchDisabledReason },
      { id: 'rollback', label: 'Rollback release', enabled: rollbackDisabledReason === undefined, disabledReason: rollbackDisabledReason },
    ],
  };
}

function launchDisabledReasonFor(readiness: ReleaseReadinessProjection): string | undefined {
  const missingEvidenceReason = missingReadinessEvidenceReason(readiness);
  if (missingEvidenceReason !== undefined) return missingEvidenceReason;
  if ((readiness.required_review_evidence?.length ?? 0) === 0) return 'Release approval evidence unavailable';
  const blockedEvidenceReason = firstEvidenceDisabledReason(readiness);
  if (blockedEvidenceReason !== undefined) return blockedEvidenceReason;
  if (hasBlockedEvidence(readiness)) return 'Release evidence is blocked';
  if (readiness.ready) return undefined;
  return readiness.disabled_reasons?.[0]?.message ?? firstEvidenceDisabledReason(readiness) ?? 'Release approval is blocked';
}

function missingReadinessEvidenceReason(readiness: ReleaseReadinessProjection): string | undefined {
  if ((readiness.required_review_evidence?.length ?? 0) === 0) return 'Release approval evidence unavailable';
  if ((readiness.required_test_acceptance_evidence?.length ?? 0) === 0) return 'Test acceptance evidence unavailable';
  if ((readiness.package_run_evidence?.length ?? 0) === 0) return 'Package run evidence unavailable';
  if ((readiness.observation_evidence?.length ?? 0) === 0) return 'Observation evidence unavailable';
  return undefined;
}

function firstEvidenceDisabledReason(readiness: ReleaseReadinessProjection): string | undefined {
  const groups = [
    readiness.required_review_evidence,
    readiness.required_test_acceptance_evidence,
    readiness.package_run_evidence,
    readiness.observation_evidence,
  ];
  return groups.flatMap((group) => group ?? []).find((item) => item.disabled_reason !== undefined)?.disabled_reason?.message;
}

function releaseEvidence(readiness: ReleaseReadinessProjection): ViewModelEvidence[] {
  return [
    { label: 'Review approval', state: evidenceState(readiness.required_review_evidence), compactText: evidenceText(readiness.required_review_evidence) },
    { label: 'Test acceptance', state: evidenceState(readiness.required_test_acceptance_evidence), compactText: evidenceText(readiness.required_test_acceptance_evidence) },
    { label: 'Execution evidence', state: evidenceState(readiness.package_run_evidence), compactText: evidenceText(readiness.package_run_evidence) },
  ];
}

function approvalState(readiness: ReleaseReadinessProjection): string {
  if ((readiness.required_review_evidence?.length ?? 0) === 0) return 'unavailable';
  return readiness.ready && launchDisabledReasonFor(readiness) === undefined ? 'approved' : 'blocked';
}

function hasBlockedEvidence(readiness: ReleaseReadinessProjection): boolean {
  const groups = [
    readiness.required_review_evidence,
    readiness.required_test_acceptance_evidence,
    readiness.package_run_evidence,
    readiness.observation_evidence,
  ];
  return groups.flatMap((group) => group ?? []).some((item) => item.status === 'missing' || item.disabled_reason !== undefined);
}

function evidenceState(items: readonly ReleaseReadinessItem[] | undefined): ViewModelEvidence['state'] {
  if (items === undefined || items.length === 0) return 'unavailable';
  if (items.some((item) => item.status === 'missing' || item.disabled_reason !== undefined)) return 'blocked';
  return 'available';
}

function combinedEvidenceState(readiness: ReleaseReadinessProjection): ViewModelEvidence['state'] {
  const groups = [
    readiness.required_review_evidence,
    readiness.required_test_acceptance_evidence,
    readiness.package_run_evidence,
    readiness.observation_evidence,
  ];
  if (groups.some((group) => group === undefined || group.length === 0)) return 'unavailable';
  return hasBlockedEvidence(readiness) ? 'blocked' : 'available';
}

function evidenceText(items: readonly ReleaseReadinessItem[] | undefined): string {
  if (items === undefined || items.length === 0) return 'Evidence unavailable';
  const blocked = items.find((item) => item.disabled_reason !== undefined);
  return blocked?.disabled_reason?.message ?? `${items.length} evidence requirement(s)`;
}
