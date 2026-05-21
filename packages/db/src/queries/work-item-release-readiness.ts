import { createHash } from 'node:crypto';

import type { ExecutionPackage, Release, WorkItem } from '@forgeloop/domain';

export type WorkItemPreReleaseState = 'not_applicable' | 'missing' | 'blocked' | 'ready';

export interface DeliveryBlockerLike {
  code: string;
  message: string;
  category?: string;
  overrideable?: boolean;
  object_type?: string;
  object_id?: string;
}

export interface ReleaseBlockerLike extends DeliveryBlockerLike {
  status?: string;
  state?: string;
  resolution?: string;
}

export interface ReleaseTestAcceptanceEvidenceLike {
  release_id: string;
  gate_id?: string;
  state?: string;
  status?: string;
  result?: string;
  scope_fingerprint?: string;
  acknowledged?: boolean;
  rationale?: string;
  reason?: string;
  required?: boolean;
}

export interface ReleaseEvidenceLike {
  release_id: string;
  evidence_type?: string;
  status?: string;
  object_ref?: {
    object_type: string;
    object_id: string;
    relationship?: string;
  };
  extra?: Record<string, unknown>;
}

export interface DecisionLike {
  id?: string;
  object_type?: string;
  object_id: string;
  actor_id?: string;
  decision_type?: string;
  decision?: string;
  outcome?: string;
  summary?: string;
  evidence_refs?: unknown;
  created_at?: string;
}

export interface WorkItemPreReleaseReadinessInput {
  workItem: WorkItem;
  packages: readonly ExecutionPackage[];
  releases: readonly Release[];
  releaseBlockers: readonly ReleaseBlockerLike[];
  releaseTestAcceptance: readonly ReleaseTestAcceptanceEvidenceLike[];
  releaseEvidence: readonly ReleaseEvidenceLike[];
  decisions: readonly DecisionLike[];
  qualityGatePassed: boolean;
  handoffExpected: boolean;
}

export interface WorkItemPreReleaseReadiness {
  state: WorkItemPreReleaseState;
  release_id?: string;
  work_item_id: string;
  package_ids: string[];
  scope_fingerprint?: string;
  blocker_fingerprint: string;
  blockers: DeliveryBlockerLike[];
}

const observationOnlyBlockerCodes = new Set([
  'missing_observation_plan',
  'missing_observation_evidence',
  'missing_metric_snapshot',
  'observation_failed',
]);

const passedTestAcceptanceStates = new Set(['passed', 'succeeded', 'acknowledged']);
const notRequiredTestAcceptanceStates = new Set(['not_required']);

const preReleaseBlockerCodes = new Set([
  'missing_work_item',
  'missing_execution_package',
  'empty_work_item_scope',
  'empty_execution_package_scope',
  'work_item_not_complete',
  'package_not_release_ready',
  'missing_approved_review_packet',
  'failed_required_check',
  'missing_required_artifact',
  'evidence_redacted',
  'stale_or_superseded_evidence',
  'missing_required_evidence_backlink',
  'unsafe_or_redacted_evidence_backlink',
  'missing_rollout_strategy',
  'missing_rollback_plan',
  'missing_linked_release',
  'missing_release_work_item_scope',
  'partial_release_scope',
  'quality_gate_not_passed',
  'missing_release_test_acceptance',
]);

const preReleaseBlockerSignals = [
  'scope',
  'handoff',
  'approval',
  'revision',
  'check',
  'artifact',
  'evidence',
  'evidence_chain',
  'backlink',
  'rollout',
  'rollback',
  'test_acceptance',
  'acceptance',
];

const hasText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const fingerprint = (prefix: string, value: unknown): string =>
  `${prefix}:v1:sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;

const uniqueSorted = (items: readonly string[]): string[] => [...new Set(items.filter(hasText))].sort();

const stableBlockerValue = (blocker: DeliveryBlockerLike) => ({
  category: blocker.category ?? '',
  code: blocker.code,
  message: blocker.message,
  object_id: blocker.object_id ?? '',
  object_type: blocker.object_type ?? '',
  overrideable: blocker.overrideable ?? false,
});

const blockerSortKey = (blocker: DeliveryBlockerLike): string =>
  stableJson(stableBlockerValue(blocker));

const sortBlockers = <Blocker extends DeliveryBlockerLike>(blockers: readonly Blocker[]): Blocker[] =>
  [...blockers].sort((left, right) => blockerSortKey(left).localeCompare(blockerSortKey(right)));

const dedupeBlockers = <Blocker extends DeliveryBlockerLike>(blockers: readonly Blocker[]): Blocker[] => {
  const seen = new Set<string>();
  const result: Blocker[] = [];
  for (const blocker of sortBlockers(blockers)) {
    const key = stableJson(stableBlockerValue(blocker));
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(blocker);
  }
  return result;
};

export const preReleaseBlockerFingerprint = (blockers: readonly DeliveryBlockerLike[]): string =>
  fingerprint('work-item-pre-release-blockers', dedupeBlockers(blockers).map(stableBlockerValue));

const preReleaseScopeFingerprint = (
  release: Pick<Release, 'id'>,
  workItem: Pick<WorkItem, 'id'>,
  packages: readonly Pick<ExecutionPackage, 'id'>[],
): string =>
  fingerprint('work-item-pre-release-scope', {
    release_id: release.id,
    work_item_id: workItem.id,
    execution_package_ids: uniqueSorted(packages.map((item) => item.id)),
  });

const scopedBlocker = (
  code: string,
  message: string,
  objectType: string,
  objectId: string,
  category = 'structural',
  overrideable = false,
): DeliveryBlockerLike => ({
  code,
  message,
  category,
  overrideable,
  object_type: objectType,
  object_id: objectId,
});

const activeBlocker = (blocker: ReleaseBlockerLike): boolean => {
  const status = [blocker.status, blocker.state, blocker.resolution].find(hasText)?.trim().toLowerCase();
  return status === undefined || !['resolved', 'closed', 'inactive', 'completed', 'cleared'].includes(status);
};

const observationOrCloseReadinessOnly = (blocker: ReleaseBlockerLike): boolean => {
  const code = blocker.code.trim().toLowerCase();
  const normalizedCode = code.replaceAll('-', '_');
  if (
    observationOnlyBlockerCodes.has(code) ||
    ['observation', 'close_readiness', 'release_close', 'post_release'].some((signal) =>
      normalizedCode.includes(signal),
    )
  ) {
    return true;
  }

  if (code !== 'missing_required_evidence_backlink') {
    return false;
  }

  const genericCloseReadinessText = [blocker.category, blocker.message].filter(hasText).join(' ').toLowerCase();
  const normalizedText = genericCloseReadinessText.replaceAll('-', '_');
  const hasPreReleaseSignal = ['rollback', 'rollout', 'revision', 'check', 'artifact', 'acceptance', 'scope'].some(
    (signal) => normalizedText.includes(signal),
  );
  if (hasPreReleaseSignal) {
    return false;
  }
  return ['close_readiness', 'release_close', 'post_release', 'completed close', 'completed_close'].some(
    (signal) => normalizedText.includes(signal),
  );
};

const isPreReleaseBlocker = (blocker: ReleaseBlockerLike): boolean => {
  if (observationOrCloseReadinessOnly(blocker)) {
    return false;
  }
  const code = blocker.code.trim().toLowerCase();
  if (preReleaseBlockerCodes.has(code)) {
    return true;
  }
  if (blocker.category?.trim().toLowerCase() === 'evidence') {
    return true;
  }
  const searchable = [blocker.code, blocker.category, blocker.message].filter(hasText).join(' ').toLowerCase();
  return preReleaseBlockerSignals.some((signal) => searchable.includes(signal));
};

const blockerMatchesScope = (
  blocker: ReleaseBlockerLike,
  release: Pick<Release, 'id'>,
  workItem: Pick<WorkItem, 'id'>,
  packageIds: ReadonlySet<string>,
): boolean => {
  if (!hasText(blocker.object_type) || !hasText(blocker.object_id)) {
    return true;
  }
  if (blocker.object_type === 'release') {
    return blocker.object_id === release.id;
  }
  if (blocker.object_type === 'work_item') {
    return blocker.object_id === workItem.id;
  }
  if (blocker.object_type === 'execution_package') {
    return packageIds.has(blocker.object_id);
  }
  return true;
};

const preReleaseBlockersFromInput = (
  input: WorkItemPreReleaseReadinessInput,
  release: Release,
): DeliveryBlockerLike[] => {
  const packageIds = new Set(input.packages.map((item) => item.id));
  return dedupeBlockers(
    input.releaseBlockers.filter(
      (blocker) =>
        activeBlocker(blocker) &&
        isPreReleaseBlocker(blocker) &&
        blockerMatchesScope(blocker, release, input.workItem, packageIds),
    ),
  );
};

const evidenceRefsRecord = (decision: DecisionLike): Record<string, unknown> | undefined =>
  isRecord(decision.evidence_refs) ? decision.evidence_refs : undefined;

const decisionCompleted = (decision: DecisionLike): boolean =>
  decision.decision === 'completed' && decision.outcome === 'completed';

const matchingManualOverride = (
  decisions: readonly DecisionLike[],
  release: Pick<Release, 'id'>,
  blockerFingerprint: string,
  scopeFingerprint: string,
): boolean =>
  decisions.some((decision) => {
    if (
      decision.decision_type !== 'manual_override' ||
      decision.object_id !== release.id ||
      decision.decision !== 'override_approved' ||
      decision.outcome !== 'override_approved'
    ) {
      return false;
    }
    const refs = evidenceRefsRecord(decision);
    const snapshot = isRecord(refs?.blocker_snapshot) ? refs.blocker_snapshot : undefined;
    const snapshotScopeFingerprint = snapshot?.scope_fingerprint;
    const scopeFingerprintRef =
      refs?.scope_fingerprint ?? (typeof snapshotScopeFingerprint === 'string' ? snapshotScopeFingerprint : undefined);
    return (
      snapshot?.release_id === release.id &&
      snapshot.blocker_fingerprint === blockerFingerprint &&
      typeof snapshot.blocker_fingerprint === 'string' &&
      snapshot.blocker_fingerprint.startsWith('work-item-pre-release-blockers:v1:sha256:') &&
      scopeFingerprintRef === scopeFingerprint
    );
  });

const matchingTestAcceptanceAcknowledgement = (
  decisions: readonly DecisionLike[],
  release: Pick<Release, 'id'>,
  scopeFingerprint: string,
): boolean =>
  decisions.some((decision) => {
    if (
      decision.decision_type !== 'test_acceptance_acknowledged' ||
      !decisionCompleted(decision) ||
      decision.object_id !== release.id
    ) {
      return false;
    }
    const refs = evidenceRefsRecord(decision);
    return refs?.release_id === release.id && refs.scope_fingerprint === scopeFingerprint;
  });

const normalizedTestAcceptanceState = (evidence: ReleaseTestAcceptanceEvidenceLike): string | undefined =>
  [evidence.state, evidence.status, evidence.result].find(hasText)?.trim().toLowerCase();

const matchingScope = (evidence: ReleaseTestAcceptanceEvidenceLike, scopeFingerprint: string): boolean =>
  evidence.scope_fingerprint === scopeFingerprint;

const hasNotRequiredRationale = (evidence: ReleaseTestAcceptanceEvidenceLike): boolean =>
  hasText(evidence.rationale) || hasText(evidence.reason);

const testAcceptanceSatisfied = (
  evidence: ReleaseTestAcceptanceEvidenceLike,
  scopeFingerprint: string,
): boolean => {
  const state = normalizedTestAcceptanceState(evidence);
  if (state === undefined || !matchingScope(evidence, scopeFingerprint)) {
    return false;
  }
  if (passedTestAcceptanceStates.has(state)) {
    return true;
  }
  return notRequiredTestAcceptanceStates.has(state) && hasNotRequiredRationale(evidence);
};

const releaseHasSatisfiedTestAcceptance = (
  input: WorkItemPreReleaseReadinessInput,
  release: Release,
  scopeFingerprint: string,
): boolean =>
  input.releaseTestAcceptance
    .filter((evidence) => evidence.release_id === release.id)
    .some((evidence) => testAcceptanceSatisfied(evidence, scopeFingerprint));

const linkedReleaseIdsFromInput = (input: WorkItemPreReleaseReadinessInput): string[] =>
  uniqueSorted([
    input.workItem.current_release_id,
    ...input.packages.map((executionPackage) => executionPackage.current_release_id),
  ].filter(hasText));

const releaseContainsWorkItemScope = (
  release: Release,
  workItem: Pick<WorkItem, 'id'>,
  packages: readonly Pick<ExecutionPackage, 'id'>[],
): boolean => {
  const packageIds = new Set(release.execution_package_ids);
  return release.work_item_ids.includes(workItem.id) || packages.some((executionPackage) => packageIds.has(executionPackage.id));
};

const selectLinkedRelease = (input: WorkItemPreReleaseReadinessInput): Release | undefined => {
  const releaseById = new Map(input.releases.map((release) => [release.id, release] as const));
  for (const releaseId of linkedReleaseIdsFromInput(input)) {
    const release = releaseById.get(releaseId);
    if (release !== undefined) {
      return release;
    }
  }
  return [...input.releases]
    .filter((release) => releaseContainsWorkItemScope(release, input.workItem, input.packages))
    .sort((left, right) => left.id.localeCompare(right.id))[0];
};

const completeReleasePackageScope = (
  release: Pick<Release, 'execution_package_ids'>,
  packages: readonly Pick<ExecutionPackage, 'id'>[],
): boolean => {
  const releasePackageIds = new Set(release.execution_package_ids);
  return packages.every((executionPackage) => releasePackageIds.has(executionPackage.id));
};

const completeReleaseWorkItemScope = (
  release: Pick<Release, 'work_item_ids'>,
  workItem: Pick<WorkItem, 'id'>,
): boolean => release.work_item_ids.includes(workItem.id);

const result = (
  input: WorkItemPreReleaseReadinessInput,
  state: WorkItemPreReleaseState,
  blockers: readonly DeliveryBlockerLike[],
  release?: Release,
  scopeFingerprint?: string,
): WorkItemPreReleaseReadiness => {
  const sortedBlockers = dedupeBlockers(blockers);
  return {
    state,
    ...(release !== undefined ? { release_id: release.id } : {}),
    work_item_id: input.workItem.id,
    package_ids: uniqueSorted(input.packages.map((executionPackage) => executionPackage.id)),
    ...(scopeFingerprint !== undefined ? { scope_fingerprint: scopeFingerprint } : {}),
    blocker_fingerprint: preReleaseBlockerFingerprint(sortedBlockers),
    blockers: sortedBlockers,
  };
};

export const deriveWorkItemPreReleaseReadiness = (
  input: WorkItemPreReleaseReadinessInput,
): WorkItemPreReleaseReadiness => {
  const linkedRelease = selectLinkedRelease(input);
  const handoffExpected = input.handoffExpected || input.qualityGatePassed || linkedRelease !== undefined;

  if (linkedRelease === undefined) {
    if (!handoffExpected) {
      return result(input, 'not_applicable', []);
    }
    return result(input, 'missing', [
      scopedBlocker(
        'missing_linked_release',
        'Work item handoff is expected but no linked release was found.',
        'work_item',
        input.workItem.id,
      ),
    ]);
  }

  const scopeFingerprint = preReleaseScopeFingerprint(linkedRelease, input.workItem, input.packages);
  const blockers: DeliveryBlockerLike[] = [];

  if (!input.qualityGatePassed) {
    blockers.push(
      scopedBlocker(
        'quality_gate_not_passed',
        'Work item Quality Gate must pass before linked release readiness can be evaluated.',
        'work_item',
        input.workItem.id,
        'risk',
        false,
      ),
    );
  }

  if (
    !completeReleaseWorkItemScope(linkedRelease, input.workItem) ||
    !completeReleasePackageScope(linkedRelease, input.packages)
  ) {
    blockers.push(
      scopedBlocker(
        'partial_release_scope',
        'Linked release does not include the full Work Item and package scope.',
        'release',
        linkedRelease.id,
        'structural',
        false,
      ),
    );
  }

  const preReleaseBlockers = preReleaseBlockersFromInput(input, linkedRelease);
  const preReleaseFingerprint = preReleaseBlockerFingerprint(preReleaseBlockers);
  if (!matchingManualOverride(input.decisions, linkedRelease, preReleaseFingerprint, scopeFingerprint)) {
    blockers.push(...preReleaseBlockers);
  }

  const testAcceptanceAcknowledged = matchingTestAcceptanceAcknowledgement(
    input.decisions,
    linkedRelease,
    scopeFingerprint,
  );
  if (!testAcceptanceAcknowledged && !releaseHasSatisfiedTestAcceptance(input, linkedRelease, scopeFingerprint)) {
    blockers.push(
      scopedBlocker(
        'missing_release_test_acceptance',
        'Release Test/Acceptance evidence is missing, failed, unacknowledged, or scoped to a stale Work Item package set.',
        'release',
        linkedRelease.id,
        'evidence',
        true,
      ),
    );
  }

  return result(input, blockers.length === 0 ? 'ready' : 'blocked', blockers, linkedRelease, scopeFingerprint);
};
