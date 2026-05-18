import { createHash } from 'node:crypto';

import {
  deriveReleaseBlockers,
  releaseBlockerTruthTable,
  type Decision,
  type ExecutionPackage,
  type Release,
  type ReleaseBlocker,
  type ReleaseBlockerCode,
  type ReleaseGateContext,
  type ReviewPacket,
  type RunSession,
  type WorkItem,
} from '@forgeloop/domain';

import type { DeliveryRepository, TraceEventRecord, TraceLinkRecord } from '../repositories/delivery-repository';

export type ReleaseTestAcceptanceGate = {
  passed: boolean;
  blockers: string[];
  external_blockers: ReleaseBlocker[];
  high_risk_requires_acknowledgement: boolean;
  acknowledged: boolean;
  scope_fingerprint: string;
  qa_owner_actor_ids: string[];
};

const testAcceptanceReleaseBlockerCodes = new Set<ReleaseBlockerCode>(['failed_required_check', 'missing_required_artifact']);
const highRiskValues = new Set(['high', 'critical', 'p' + '0']);
const truthTable = releaseBlockerTruthTable();

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

const fingerprint = (value: unknown): string =>
  `release-test-acceptance-scope:v1:sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;

const uniqueSorted = (items: readonly string[]): string[] => [...new Set(items.filter(hasText))].sort();

const releaseBlocker = (
  code: ReleaseBlockerCode,
  message: string,
  objectType?: string,
  objectId?: string,
): ReleaseBlocker => ({
  code,
  category: truthTable[code].category,
  overrideable: truthTable[code].overrideable,
  message,
  ...(objectType !== undefined && objectId !== undefined ? { object_type: objectType, object_id: objectId } : {}),
});

const stableBlockerValue = (blocker: ReleaseBlocker) => ({
  category: blocker.category,
  code: blocker.code,
  message: blocker.message,
  object_id: blocker.object_id ?? '',
  object_type: blocker.object_type ?? '',
  overrideable: blocker.overrideable,
});

const mergeReleaseBlockers = (...groups: readonly (readonly ReleaseBlocker[])[]): ReleaseBlocker[] => {
  const seen = new Set<string>();
  const merged: ReleaseBlocker[] = [];
  for (const blocker of groups.flat()) {
    const key = stableJson(stableBlockerValue(blocker));
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(blocker);
  }
  return merged;
};

const isHighRiskWorkItem = (workItem: WorkItem): boolean =>
  [workItem.risk, workItem.priority].some((value) => hasText(value) && highRiskValues.has(value.trim().toLowerCase()));

const isHighRiskExecutionPackage = (executionPackage: ExecutionPackage): boolean => {
  const readiness = isRecord(executionPackage.integration_readiness) ? executionPackage.integration_readiness : {};
  return [readiness.risk, readiness.risk_level, readiness.severity].some(
    (value) => hasText(value) && highRiskValues.has(value.trim().toLowerCase()),
  );
};

const approvedPlanRevisionId = (
  plan: { status: string; resolution: string; approved_revision_id?: string } | undefined,
): string | undefined => (plan?.status === 'approved' && plan.resolution === 'approved' ? plan.approved_revision_id : undefined);

const approvedSpecRevisionId = (
  spec: { status: string; resolution: string; approved_revision_id?: string } | undefined,
): string | undefined => (spec?.status === 'approved' && spec.resolution === 'approved' ? spec.approved_revision_id : undefined);

const isActiveBlocker = (blocker: Record<string, unknown>): boolean => {
  const status = [blocker.status, blocker.state, blocker.resolution].find(hasText);
  return status === undefined || !['resolved', 'closed', 'inactive', 'completed', 'cleared'].includes(status.trim().toLowerCase());
};

const isTestAcceptanceBlocker = (blocker: Record<string, unknown>): boolean => {
  const searchable = [blocker.code, blocker.category, blocker.kind, blocker.type, blocker.summary, blocker.message]
    .filter(hasText)
    .join(' ')
    .toLowerCase();
  return ['test', 'qa', 'readiness', 'artifact', 'evidence'].some((needle) => searchable.includes(needle));
};

const activeTestAcceptanceReleaseBlockers = (release: Release): string[] => {
  const extra = isRecord(release.extra) ? release.extra : {};
  const candidates = [extra.active_blockers, extra.release_blockers, extra.blockers].flatMap((value) =>
    Array.isArray(value) ? value : [],
  );
  return candidates.flatMap((candidate) => {
    if (!isRecord(candidate) || !isActiveBlocker(candidate) || !isTestAcceptanceBlocker(candidate)) {
      return [];
    }
    return [`active_release_blocker:${hasText(candidate.code) ? candidate.code : 'release_blocker'}`];
  });
};

const evidenceChainObjectKey = (objectType: 'work_item' | 'execution_package', objectId: string): string =>
  `${objectType}:${objectId}`;

type EvidenceChainLinks = {
  objectKeys: Set<string>;
  traceRefs: string[];
};

const objectRefKey = (objectType: string, objectId: string): string => `${objectType}:${objectId}`;

const releaseContextObjectRefKeys = (release: Release, context: ReleaseGateContext): Set<string> =>
  new Set([
    objectRefKey('release', release.id),
    ...(context.work_items ?? []).map((workItem) => objectRefKey('work_item', workItem.id)),
    ...(context.execution_packages ?? []).map((executionPackage) =>
      objectRefKey('execution_package', executionPackage.id),
    ),
    ...(context.run_sessions ?? []).map((runSession) => objectRefKey('run_session', runSession.id)),
    ...(context.review_packets ?? []).map((reviewPacket) => objectRefKey('review_packet', reviewPacket.id)),
  ]);

const traceEventIsReleaseAcceptanceEvidence = (
  context: ReleaseGateContext,
  contextObjectRefKeys: ReadonlySet<string>,
  event: TraceEventRecord,
  links: readonly TraceLinkRecord[],
): boolean => {
  if (event.event_type !== 'run_terminal_evidence_recorded') {
    return false;
  }

  const contextRunSessionIds = new Set((context.run_sessions ?? []).map((runSession) => runSession.id));
  const hasCurrentRunSession =
    (event.subject_type === 'run_session' && contextRunSessionIds.has(event.subject_id)) ||
    links.some((link) => link.object_type === 'run_session' && contextRunSessionIds.has(link.object_id));
  if (!hasCurrentRunSession) {
    return false;
  }

  return links.some((link) => contextObjectRefKeys.has(objectRefKey(link.object_type, link.object_id)));
};

const evidenceChainLinkedObjectKeysWithRepository = async (
  repository: DeliveryRepository,
  release: Release,
  context: ReleaseGateContext,
): Promise<EvidenceChainLinks> => {
  const objectKeys = new Set<string>();
  const traceRefs = new Set<string>();
  const contextObjectRefKeys = releaseContextObjectRefKeys(release, context);

  const add = (objectType: unknown, objectId: unknown) => {
    if (
      (objectType === 'work_item' || objectType === 'execution_package') &&
      hasText(objectId) &&
      contextObjectRefKeys.has(objectRefKey(objectType, objectId))
    ) {
      objectKeys.add(evidenceChainObjectKey(objectType, objectId));
    }
  };
  const addTraceObjectRef = (source: string, objectType: unknown, objectId: unknown) => {
    if (hasText(objectType) && hasText(objectId) && contextObjectRefKeys.has(objectRefKey(objectType, objectId))) {
      traceRefs.add(`${source}:${objectType}:${objectId}`);
    }
  };
  const addPayloadRefs = (payload: unknown) => {
    if (!isRecord(payload)) {
      return;
    }
    addTraceObjectRef('payload:release', 'release', payload.release_id);
    addTraceObjectRef('payload:work_item', 'work_item', payload.work_item_id);
    addTraceObjectRef('payload:execution_package', 'execution_package', payload.execution_package_id);
    addTraceObjectRef('payload:run_session', 'run_session', payload.run_session_id);
    addTraceObjectRef('payload:review_packet', 'review_packet', payload.review_packet_id);
  };

  const subjects = [
    { objectType: 'release', objectId: release.id },
    ...(context.work_items ?? []).map((workItem) => ({ objectType: 'work_item', objectId: workItem.id })),
    ...(context.execution_packages ?? []).map((executionPackage) => ({
      objectType: 'execution_package',
      objectId: executionPackage.id,
    })),
    ...(context.run_sessions ?? []).map((runSession) => ({ objectType: 'run_session', objectId: runSession.id })),
    ...(context.review_packets ?? []).map((reviewPacket) => ({ objectType: 'review_packet', objectId: reviewPacket.id })),
  ];

  await Promise.all(
    subjects.map(async (subject) => {
      const traceEvents = await repository.listTraceEventsForSubject(subject.objectType, subject.objectId);
      await Promise.all(
        traceEvents.map(async (event) => {
          const links = await repository.listTraceLinks(event.id);
          if (!traceEventIsReleaseAcceptanceEvidence(context, contextObjectRefKeys, event, links)) {
            return;
          }
          traceRefs.add(`event:${event.id}:${event.event_type}`);
          addTraceObjectRef('subject', event.subject_type, event.subject_id);
          addPayloadRefs(event.payload);
          for (const link of links) {
            add(link.object_type, link.object_id);
            if (contextObjectRefKeys.has(objectRefKey(link.object_type, link.object_id))) {
              traceRefs.add(`link:${link.id}:${link.relationship}:${link.object_type}:${link.object_id}`);
            }
          }
        }),
      );
    }),
  );

  return { objectKeys, traceRefs: [...traceRefs].sort() };
};

const artifactRefFingerprintValue = (artifact: unknown) => {
  if (!isRecord(artifact)) {
    return artifact;
  }
  return {
    kind: artifact.kind ?? null,
    name: artifact.name ?? null,
    content_type: artifact.content_type ?? null,
    storage_uri: artifact.storage_uri ?? null,
    local_ref: artifact.local_ref ?? null,
    digest: artifact.digest ?? null,
  };
};

const runSessionFingerprintValue = (runSession: RunSession) => ({
  id: runSession.id,
  execution_package_id: runSession.execution_package_id,
  status: runSession.status,
  check_results: [...runSession.check_results]
    .map((check) => ({
      check_id: check.check_id,
      command: check.command ?? null,
      status: check.status,
      exit_code: check.exit_code,
      blocks_review: check.blocks_review,
      stdout: artifactRefFingerprintValue(check.stdout),
      stderr: artifactRefFingerprintValue(check.stderr),
    }))
    .sort((left, right) => left.check_id.localeCompare(right.check_id) || (left.command ?? '').localeCompare(right.command ?? '')),
  artifacts: [...runSession.artifacts]
    .map(artifactRefFingerprintValue)
    .sort((left, right) => stableJson(left).localeCompare(stableJson(right))),
  log_refs: [...runSession.log_refs].map(artifactRefFingerprintValue).sort((left, right) => stableJson(left).localeCompare(stableJson(right))),
});

const reviewPacketFingerprintValue = (reviewPacket: ReviewPacket) => ({
  id: reviewPacket.id,
  run_session_id: reviewPacket.run_session_id,
  execution_package_id: reviewPacket.execution_package_id,
  status: reviewPacket.status,
  decision: reviewPacket.decision,
  check_result_summary: reviewPacket.check_result_summary,
});

const executionPackageGateInputFingerprintValue = (executionPackage: ExecutionPackage) => ({
  id: executionPackage.id,
  required_checks: [...executionPackage.required_checks]
    .map((check) => ({
      check_id: check.check_id,
      display_name: check.display_name,
      command: check.command,
      timeout_seconds: check.timeout_seconds,
      blocks_review: check.blocks_review,
    }))
    .sort((left, right) => left.check_id.localeCompare(right.check_id) || left.command.localeCompare(right.command)),
  required_artifact_kinds: [...executionPackage.required_artifact_kinds].sort(),
});

const acknowledgementScopeFingerprint = (input: {
  release: Release;
  workItems: readonly WorkItem[];
  executionPackages: readonly ExecutionPackage[];
  runSessions: readonly RunSession[];
  reviewPackets: readonly ReviewPacket[];
  highRiskWorkItems: readonly WorkItem[];
  highRiskPackages: readonly ExecutionPackage[];
  approvedSpecRevisionIds: ReadonlyMap<string, string | undefined>;
  approvedWorkItemPlanRevisionIds: ReadonlyMap<string, string | undefined>;
  approvedPackagePlanRevisionIds: ReadonlyMap<string, string | undefined>;
  evidenceChainLinks: EvidenceChainLinks;
  qaOwnerActorIds: readonly string[];
}): string =>
  fingerprint({
    release_id: input.release.id,
    high_risk_work_item_ids: input.highRiskWorkItems.map((item) => item.id).sort(),
    high_risk_execution_package_ids: input.highRiskPackages.map((item) => item.id).sort(),
    approved_spec_revision_ids: input.highRiskWorkItems
      .map((item) => [item.id, input.approvedSpecRevisionIds.get(item.id) ?? null] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
    approved_work_item_plan_revision_ids: input.workItems
      .map((item) => [item.id, input.approvedWorkItemPlanRevisionIds.get(item.id) ?? null] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
    approved_execution_package_plan_revision_ids: input.executionPackages
      .map((item) => [item.id, input.approvedPackagePlanRevisionIds.get(item.id) ?? null] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
    run_sessions: input.runSessions.map(runSessionFingerprintValue).sort((left, right) => left.id.localeCompare(right.id)),
    review_packets: input.reviewPackets.map(reviewPacketFingerprintValue).sort((left, right) => left.id.localeCompare(right.id)),
    execution_package_gate_inputs: input.executionPackages
      .map(executionPackageGateInputFingerprintValue)
      .sort((left, right) => left.id.localeCompare(right.id)),
    evidence_chain_links: [...input.evidenceChainLinks.objectKeys].sort(),
    evidence_chain_trace_refs: input.evidenceChainLinks.traceRefs,
    qa_owner_actor_ids: uniqueSorted(input.qaOwnerActorIds),
  });

const decisionMatchesAcknowledgementScope = (decision: Decision, release: Release, scopeFingerprint: string): boolean => {
  if (
    decision.decision_type !== 'test_acceptance_acknowledged' ||
    decision.decision !== 'completed' ||
    decision.outcome !== 'completed' ||
    decision.object_id !== release.id
  ) {
    return false;
  }
  const refs = isRecord(decision.evidence_refs) ? decision.evidence_refs : undefined;
  return refs?.release_id === release.id && refs.scope_fingerprint === scopeFingerprint;
};

const testAcceptanceGateBlockerToReleaseBlocker = (
  release: Release,
  gateBlocker: string,
  currentBlockers: readonly ReleaseBlocker[],
): ReleaseBlocker[] => {
  if (testAcceptanceReleaseBlockerCodes.has(gateBlocker as ReleaseBlockerCode)) {
    const code = gateBlocker as ReleaseBlockerCode;
    if (currentBlockers.some((blocker) => blocker.code === code)) {
      return [];
    }
    return [releaseBlocker(code, `Release Test/Acceptance gate is blocked by ${code}.`, 'release', release.id)];
  }

  if (gateBlocker.startsWith('missing_approved_spec_revision:')) {
    const workItemId = gateBlocker.slice('missing_approved_spec_revision:'.length);
    return [
      releaseBlocker(
        'missing_required_evidence_backlink',
        `Work item ${workItemId} is missing an approved spec revision for release Test/Acceptance.`,
        'work_item',
        workItemId,
      ),
    ];
  }

  if (gateBlocker.startsWith('missing_approved_plan_revision:work_item:')) {
    const workItemId = gateBlocker.slice('missing_approved_plan_revision:work_item:'.length);
    return [
      releaseBlocker(
        'missing_required_evidence_backlink',
        `Work item ${workItemId} is missing an approved plan revision for release Test/Acceptance.`,
        'work_item',
        workItemId,
      ),
    ];
  }

  if (gateBlocker.startsWith('missing_approved_plan_revision:execution_package:')) {
    const packageId = gateBlocker.slice('missing_approved_plan_revision:execution_package:'.length);
    return [
      releaseBlocker(
        'missing_required_evidence_backlink',
        `Execution package ${packageId} is missing an approved plan revision for release Test/Acceptance.`,
        'execution_package',
        packageId,
      ),
    ];
  }

  if (gateBlocker.startsWith('stale_plan_spec_revision:work_item:')) {
    const workItemId = gateBlocker.slice('stale_plan_spec_revision:work_item:'.length);
    return [
      releaseBlocker(
        'missing_required_evidence_backlink',
        `Work item ${workItemId} approved plan revision is not based on the approved spec revision for release Test/Acceptance.`,
        'work_item',
        workItemId,
      ),
    ];
  }

  if (gateBlocker.startsWith('stale_plan_spec_revision:execution_package:')) {
    const packageId = gateBlocker.slice('stale_plan_spec_revision:execution_package:'.length);
    return [
      releaseBlocker(
        'missing_required_evidence_backlink',
        `Execution package ${packageId} approved plan revision is not based on the approved spec revision for release Test/Acceptance.`,
        'execution_package',
        packageId,
      ),
    ];
  }

  if (gateBlocker.startsWith('stale_execution_package_plan_revision:')) {
    const packageId = gateBlocker.slice('stale_execution_package_plan_revision:'.length);
    return [
      releaseBlocker(
        'missing_required_evidence_backlink',
        `Execution package ${packageId} does not reference the approved plan revision for release Test/Acceptance.`,
        'execution_package',
        packageId,
      ),
    ];
  }

  if (gateBlocker.startsWith('missing_spec_test_strategy_summary:')) {
    const workItemId = gateBlocker.slice('missing_spec_test_strategy_summary:'.length);
    return [
      releaseBlocker(
        'missing_required_evidence_backlink',
        `Work item ${workItemId} is missing a spec test strategy summary for release Test/Acceptance.`,
        'work_item',
        workItemId,
      ),
    ];
  }

  if (gateBlocker.startsWith('missing_spec_acceptance_criteria:')) {
    const workItemId = gateBlocker.slice('missing_spec_acceptance_criteria:'.length);
    return [
      releaseBlocker(
        'missing_required_evidence_backlink',
        `Work item ${workItemId} is missing spec acceptance criteria for release Test/Acceptance.`,
        'work_item',
        workItemId,
      ),
    ];
  }

  if (gateBlocker.startsWith('missing_evidence_chain_link:')) {
    const [, objectType, objectId] = gateBlocker.split(':');
    if ((objectType === 'work_item' || objectType === 'execution_package') && hasText(objectId)) {
      return [
        releaseBlocker(
          'missing_required_evidence_backlink',
          `${objectType === 'work_item' ? 'Work item' : 'Execution package'} ${objectId} is missing a release Test/Acceptance evidence chain link.`,
          objectType,
          objectId,
        ),
      ];
    }
  }

  if (gateBlocker.startsWith('active_release_blocker:')) {
    const code = gateBlocker.slice('active_release_blocker:'.length);
    return [
      releaseBlocker(
        'missing_required_evidence_backlink',
        `Release has an active Test/Acceptance readiness blocker: ${code}.`,
        'release',
        release.id,
      ),
    ];
  }

  return [
    releaseBlocker(
      'missing_required_evidence_backlink',
      `Release Test/Acceptance gate is blocked by ${gateBlocker}.`,
      'release',
      release.id,
    ),
  ];
};

export const withReleaseTestAcceptanceExternalBlockers = (
  release: Release,
  context: ReleaseGateContext,
  gate: ReleaseTestAcceptanceGate,
): ReleaseGateContext => ({
  ...context,
  external_blockers: mergeReleaseBlockers(context.external_blockers ?? [], gate.external_blockers),
});

export const deriveReleaseTestAcceptanceGate = async (
  repository: DeliveryRepository,
  release: Release,
  context: ReleaseGateContext,
): Promise<ReleaseTestAcceptanceGate> => {
  const blockers = new Set<string>();
  const baseBlockers = deriveReleaseBlockers(context);
  for (const blocker of baseBlockers) {
    if (testAcceptanceReleaseBlockerCodes.has(blocker.code)) {
      blockers.add(blocker.code);
    }
  }

  const workItems = context.work_items ?? [];
  const executionPackages = context.execution_packages ?? [];
  const workItemsById = new Map(workItems.map((workItem) => [workItem.id, workItem] as const));
  const approvedSpecRevisionIds = new Map<string, string | undefined>();
  await Promise.all(
    workItems.map(async (workItem) => {
      if (!hasText(workItem.current_spec_id)) {
        approvedSpecRevisionIds.set(workItem.id, undefined);
        blockers.add(`missing_approved_spec_revision:${workItem.id}`);
        return;
      }
      const spec = await repository.getSpec(workItem.current_spec_id);
      const revisionId = approvedSpecRevisionId(spec);
      approvedSpecRevisionIds.set(workItem.id, revisionId);
      if (!hasText(revisionId)) {
        blockers.add(`missing_approved_spec_revision:${workItem.id}`);
        return;
      }
      const specRevision = await repository.getSpecRevision(revisionId);
      if (specRevision === undefined) {
        blockers.add(`missing_approved_spec_revision:${workItem.id}`);
        return;
      }
      if (!hasText(specRevision.test_strategy_summary)) {
        blockers.add(`missing_spec_test_strategy_summary:${workItem.id}`);
      }
      if (!specRevision.acceptance_criteria.some((criterion) => hasText(criterion))) {
        blockers.add(`missing_spec_acceptance_criteria:${workItem.id}`);
      }
    }),
  );

  const approvedWorkItemPlanRevisionIds = new Map<string, string | undefined>();
  await Promise.all(
    workItems.map(async (workItem) => {
      if (!hasText(workItem.current_plan_id)) {
        approvedWorkItemPlanRevisionIds.set(workItem.id, undefined);
        blockers.add(`missing_approved_plan_revision:work_item:${workItem.id}`);
        return;
      }
      const plan = await repository.getPlan(workItem.current_plan_id);
      const revisionId = approvedPlanRevisionId(plan);
      approvedWorkItemPlanRevisionIds.set(workItem.id, revisionId);
      if (!hasText(revisionId)) {
        blockers.add(`missing_approved_plan_revision:work_item:${workItem.id}`);
        return;
      }
      const planRevision = await repository.getPlanRevision(revisionId);
      if (planRevision === undefined) {
        blockers.add(`missing_approved_plan_revision:work_item:${workItem.id}`);
        return;
      }
      const approvedSpecRevisionId = approvedSpecRevisionIds.get(workItem.id);
      if (hasText(approvedSpecRevisionId) && planRevision.based_on_spec_revision_id !== approvedSpecRevisionId) {
        blockers.add(`stale_plan_spec_revision:work_item:${workItem.id}`);
      }
    }),
  );

  const approvedPackagePlanRevisionIds = new Map<string, string | undefined>();
  await Promise.all(
    executionPackages.map(async (executionPackage) => {
      const plan = hasText(executionPackage.plan_id) ? await repository.getPlan(executionPackage.plan_id) : undefined;
      const revisionId = approvedPlanRevisionId(plan);
      approvedPackagePlanRevisionIds.set(executionPackage.id, revisionId);
      if (!hasText(revisionId)) {
        blockers.add(`missing_approved_plan_revision:execution_package:${executionPackage.id}`);
        return;
      }
      const planRevision = await repository.getPlanRevision(revisionId);
      if (planRevision === undefined) {
        blockers.add(`missing_approved_plan_revision:execution_package:${executionPackage.id}`);
        return;
      }
      if (executionPackage.plan_revision_id !== revisionId) {
        blockers.add(`stale_execution_package_plan_revision:${executionPackage.id}`);
      }

      const workItem = workItemsById.get(executionPackage.work_item_id) ?? (await repository.getWorkItem(executionPackage.work_item_id));
      const currentSpec = hasText(workItem?.current_spec_id) ? await repository.getSpec(workItem.current_spec_id) : undefined;
      const packageSpec = await repository.getSpec(executionPackage.spec_id);
      const approvedSpecRevision = approvedSpecRevisionId(currentSpec) ?? approvedSpecRevisionId(packageSpec);
      if (hasText(approvedSpecRevision) && planRevision.based_on_spec_revision_id !== approvedSpecRevision) {
        blockers.add(`stale_plan_spec_revision:execution_package:${executionPackage.id}`);
      }
    }),
  );

  for (const blocker of activeTestAcceptanceReleaseBlockers(release)) {
    blockers.add(blocker);
  }

  const highRiskWorkItems = workItems.filter(isHighRiskWorkItem);
  const highRiskPackages = executionPackages.filter(isHighRiskExecutionPackage);
  const evidenceChainLinks = await evidenceChainLinkedObjectKeysWithRepository(repository, release, context);

  for (const workItem of highRiskWorkItems) {
    if (!evidenceChainLinks.objectKeys.has(evidenceChainObjectKey('work_item', workItem.id))) {
      blockers.add(`missing_evidence_chain_link:work_item:${workItem.id}`);
    }
  }
  for (const executionPackage of highRiskPackages) {
    if (!evidenceChainLinks.objectKeys.has(evidenceChainObjectKey('execution_package', executionPackage.id))) {
      blockers.add(`missing_evidence_chain_link:execution_package:${executionPackage.id}`);
    }
  }

  const highRiskRequiresAcknowledgement = highRiskWorkItems.length > 0 || highRiskPackages.length > 0;
  const highRiskWorkItemIds = new Set(highRiskWorkItems.map((workItem) => workItem.id));
  const highRiskPackageIds = new Set(highRiskPackages.map((executionPackage) => executionPackage.id));
  const qaOwnerActorIds = uniqueSorted(
    executionPackages.flatMap((executionPackage) =>
      highRiskPackageIds.has(executionPackage.id) || highRiskWorkItemIds.has(executionPackage.work_item_id)
        ? [executionPackage.qa_owner_actor_id]
        : [],
    ),
  );
  const scopeFingerprint = acknowledgementScopeFingerprint({
    release,
    highRiskWorkItems,
    highRiskPackages,
    approvedSpecRevisionIds,
    workItems,
    executionPackages,
    runSessions: context.run_sessions ?? [],
    reviewPackets: context.review_packets ?? [],
    approvedWorkItemPlanRevisionIds,
    approvedPackagePlanRevisionIds,
    evidenceChainLinks,
    qaOwnerActorIds,
  });
  const decisions = await repository.listDecisionsForObject('release', release.id);
  const acknowledged =
    highRiskRequiresAcknowledgement &&
    decisions.some((decision) => decisionMatchesAcknowledgementScope(decision, release, scopeFingerprint));

  const sortedBlockers = [...blockers].sort();
  const externalBlockers = sortedBlockers.flatMap((gateBlocker) =>
    testAcceptanceGateBlockerToReleaseBlocker(release, gateBlocker, baseBlockers),
  );
  if (highRiskRequiresAcknowledgement && !acknowledged) {
    externalBlockers.push(
      releaseBlocker(
        'missing_required_evidence_backlink',
        'Release is missing high-risk QA acknowledgement.',
        'release',
        release.id,
      ),
    );
  }

  return {
    passed: blockers.size === 0,
    blockers: sortedBlockers,
    external_blockers: mergeReleaseBlockers(externalBlockers),
    high_risk_requires_acknowledgement: highRiskRequiresAcknowledgement,
    acknowledged,
    scope_fingerprint: scopeFingerprint,
    qa_owner_actor_ids: qaOwnerActorIds,
  };
};
