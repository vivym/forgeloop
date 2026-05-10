import {
  releaseCockpitResponseSchema,
  type PublicReleaseDecision,
  type PublicReleaseEvidenceProjection,
  type PublicReleaseExecutionPackageSummary,
  type PublicReleaseReviewPacketSummary,
  type PublicReleaseRunSessionSummary,
  type PublicReleaseSummary,
  type PublicReleaseWorkItemSummary,
  type ReleaseCockpitResponse,
} from '@forgeloop/contracts';
import {
  createReleaseBlockerSnapshot,
  deriveReleaseBlockers,
  deriveReleaseChecklist,
  deriveReleaseNextActions,
  deriveReleaseRiskSummary,
  selectReleaseReviewPacket,
  type Artifact,
  type Decision,
  type ExecutionPackage,
  type Release,
  type ReleaseEvidence,
  type ReleasePublicLinkVisibility,
  type ReleaseResolvedExecutionPackageLink,
  type ReleaseResolvedWorkItemLink,
  type ReviewPacket,
  type RunSession,
  type WorkItem,
} from '@forgeloop/domain';

import type { P0Repository } from '../repositories/p0-repository';
import {
  serializePublicArtifactRef,
  serializePublicDecision,
  serializePublicReleaseEvidence,
} from './public-evidence-serialization';

type ObservationLink = {
  object_type: string;
  object_id: string;
  relationship?: string;
};

const hasText = (value: string | undefined): value is string => value !== undefined && value.trim().length > 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const publicReleaseTypes = new Set(['normal', 'hotfix', 'emergency', 'gray']);

const byUpdatedAtDesc = <T extends { updated_at?: string; created_at: string; id: string }>(left: T, right: T): number => {
  const leftTime = Date.parse(left.updated_at ?? left.created_at);
  const rightTime = Date.parse(right.updated_at ?? right.created_at);
  return rightTime - leftTime || right.id.localeCompare(left.id);
};

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

const observationLinksFor = (evidence: ReleaseEvidence): ObservationLink[] => {
  const observation = isRecord(evidence.extra) ? evidence.extra.observation : undefined;
  if (!isRecord(observation) || !Array.isArray(observation.links)) {
    return [];
  }

  return observation.links.filter((link): link is ObservationLink => {
    if (!isRecord(link)) {
      return false;
    }
    return typeof link.object_type === 'string' && typeof link.object_id === 'string';
  });
};

const visibilityKey = (objectType: string, objectId: string): string => `${objectType}\0${objectId}`;

const isVisible = (object: { archived_at?: string; deleted_at?: string }): boolean =>
  object.archived_at === undefined && object.deleted_at === undefined;

const resolveWorkItemLinks = async (
  repository: P0Repository,
  release: Release,
): Promise<ReleaseResolvedWorkItemLink[]> =>
  Promise.all(
    release.work_item_ids.map(async (workItemId) => {
      const workItem = await repository.getWorkItem(workItemId);
      if (workItem === undefined) {
        return { object_id: workItemId, status: 'missing' };
      }
      if (workItem.project_id !== release.project_id) {
        return { object_id: workItemId, status: 'unauthorized', reason: 'project_mismatch', work_item: workItem };
      }
      if (workItem.archived_at !== undefined) {
        return { object_id: workItemId, status: 'archived', work_item: workItem };
      }
      if (workItem.deleted_at !== undefined) {
        return { object_id: workItemId, status: 'deleted', work_item: workItem };
      }
      return { object_id: workItemId, status: 'resolved', work_item: workItem };
    }),
  );

const resolveExecutionPackageLinks = async (
  repository: P0Repository,
  release: Release,
): Promise<ReleaseResolvedExecutionPackageLink[]> =>
  Promise.all(
    release.execution_package_ids.map(async (executionPackageId) => {
      const executionPackage = await repository.getExecutionPackage(executionPackageId);
      if (executionPackage === undefined) {
        return { object_id: executionPackageId, status: 'missing' };
      }
      if (executionPackage.project_id !== release.project_id) {
        return {
          object_id: executionPackageId,
          status: 'unauthorized',
          reason: 'project_mismatch',
          execution_package: executionPackage,
        };
      }
      if (executionPackage.archived_at !== undefined) {
        return { object_id: executionPackageId, status: 'archived', execution_package: executionPackage };
      }
      if (executionPackage.deleted_at !== undefined) {
        return { object_id: executionPackageId, status: 'deleted', execution_package: executionPackage };
      }
      return { object_id: executionPackageId, status: 'resolved', execution_package: executionPackage };
    }),
  );

const resolvedWorkItems = (links: readonly ReleaseResolvedWorkItemLink[]): WorkItem[] =>
  links.flatMap((link) => (link.status === 'resolved' && link.work_item !== undefined && isVisible(link.work_item) ? [link.work_item] : []));

const resolvedExecutionPackages = (links: readonly ReleaseResolvedExecutionPackageLink[]): ExecutionPackage[] =>
  links.flatMap((link) =>
    link.status === 'resolved' && link.execution_package !== undefined && isVisible(link.execution_package)
      ? [link.execution_package]
      : [],
  );

const latestRunSessionForPackage = async (
  repository: P0Repository,
  release: Release,
  executionPackage: ExecutionPackage,
): Promise<{ latest: RunSession | undefined; all: RunSession[] }> => {
  const runSessions = await repository.listRunSessionsForPackage(executionPackage.id);
  const selected =
    runSessions.find((runSession) => release.current_run_session_ids?.includes(runSession.id) === true) ??
    runSessions.find((runSession) => runSession.id === executionPackage.current_run_session_id) ??
    runSessions.find((runSession) => runSession.id === executionPackage.last_run_session_id) ??
    [...runSessions].sort(byUpdatedAtDesc)[0];

  return { latest: selected, all: runSessions };
};

const artifactForEvidence = async (
  repository: P0Repository,
  evidence: ReleaseEvidence,
): Promise<Artifact | undefined> => {
  const artifacts = await repository.listArtifactsForObject('release_evidence', evidence.id);
  if (evidence.artifact_id === undefined) {
    return artifacts[0];
  }
  return artifacts.find((artifact) => artifact.id === evidence.artifact_id) ?? artifacts[0];
};

const publicReleaseSummary = (
  release: Release,
  workItems: readonly WorkItem[],
  executionPackages: readonly ExecutionPackage[],
): PublicReleaseSummary => ({
  id: release.id,
  org_id: release.org_id,
  project_id: release.project_id,
  title: release.title,
  ...(hasText(release.scope_summary) ? { scope_summary: release.scope_summary } : {}),
  ...(hasText(release.release_owner_actor_id) ? { release_owner_actor_id: release.release_owner_actor_id } : {}),
  ...(release.release_type !== undefined && publicReleaseTypes.has(release.release_type)
    ? { release_type: release.release_type as PublicReleaseSummary['release_type'] }
    : {}),
  phase: release.phase,
  activity_state: release.activity_state,
  gate_state: release.gate_state,
  resolution: release.resolution,
  work_item_ids: workItems.map((workItem) => workItem.id),
  execution_package_ids: executionPackages.map((executionPackage) => executionPackage.id),
  ...(hasText(release.rollout_strategy) ? { rollout_strategy: release.rollout_strategy } : {}),
  ...(hasText(release.rollback_plan) ? { rollback_plan: release.rollback_plan } : {}),
  ...(hasText(release.observation_plan) ? { observation_plan: release.observation_plan } : {}),
  created_by_actor_id: release.created_by_actor_id,
  ...(hasText(release.updated_by_actor_id) ? { updated_by_actor_id: release.updated_by_actor_id } : {}),
  created_at: release.created_at,
  updated_at: release.updated_at,
  ...(hasText(release.closed_at) ? { closed_at: release.closed_at } : {}),
});

const publicWorkItemSummary = (workItem: WorkItem): PublicReleaseWorkItemSummary => ({
  id: workItem.id,
  project_id: workItem.project_id,
  title: workItem.title,
  kind: workItem.kind,
  phase: workItem.phase,
  activity_state: workItem.activity_state,
  gate_state: workItem.gate_state,
  resolution: workItem.resolution,
  ...(hasText(workItem.priority) ? { priority: workItem.priority } : {}),
  ...(hasText(workItem.risk) ? { risk: workItem.risk } : {}),
});

const requiredCheckSummary = (executionPackage: ExecutionPackage, runSession: RunSession | undefined) => {
  if (executionPackage.required_checks.length === 0) {
    return undefined;
  }

  const resultsByCheckId = new Map(runSession?.check_results.map((check) => [check.check_id, check]) ?? []);
  const passed = executionPackage.required_checks.filter((check) => resultsByCheckId.get(check.check_id)?.status === 'succeeded').length;
  const failed = executionPackage.required_checks.filter((check) => {
    const result = resultsByCheckId.get(check.check_id);
    return result !== undefined && result.status !== 'succeeded';
  }).length;

  return {
    total: executionPackage.required_checks.length,
    passed,
    failed,
    missing: executionPackage.required_checks.length - passed - failed,
  };
};

const requiredArtifactSummary = (executionPackage: ExecutionPackage, runSession: RunSession | undefined) => {
  if (executionPackage.required_artifact_kinds.length === 0) {
    return undefined;
  }

  const artifactKinds = new Set((runSession?.artifacts ?? []).map((artifact) => artifact.kind));
  const logKinds = new Set((runSession?.log_refs ?? []).map((artifact) => artifact.kind));
  const present = unique(
    executionPackage.required_artifact_kinds.filter((kind) =>
      kind === 'logs' ? logKinds.has(kind) : artifactKinds.has(kind),
    ),
  );
  const missing = executionPackage.required_artifact_kinds.filter((kind) =>
    kind === 'logs' ? !logKinds.has(kind) : !artifactKinds.has(kind),
  );

  return {
    required: executionPackage.required_artifact_kinds,
    present,
    missing,
  };
};

const publicExecutionPackageSummary = (
  executionPackage: ExecutionPackage,
  runSession: RunSession | undefined,
): PublicReleaseExecutionPackageSummary => ({
  id: executionPackage.id,
  work_item_id: executionPackage.work_item_id,
  project_id: executionPackage.project_id,
  objective: executionPackage.objective,
  phase: executionPackage.phase,
  activity_state: executionPackage.activity_state,
  gate_state: executionPackage.gate_state,
  resolution: executionPackage.resolution,
  ...(typeof executionPackage.integration_readiness?.summary === 'string' &&
  executionPackage.integration_readiness.summary.trim().length > 0
    ? { integration_readiness_summary: executionPackage.integration_readiness.summary }
    : {}),
  ...(requiredCheckSummary(executionPackage, runSession) !== undefined
    ? { required_check_summary: requiredCheckSummary(executionPackage, runSession) }
    : {}),
  ...(requiredArtifactSummary(executionPackage, runSession) !== undefined
    ? { required_artifact_summary: requiredArtifactSummary(executionPackage, runSession) }
    : {}),
});

const publicRunSessionSummary = (runSession: RunSession): PublicReleaseRunSessionSummary => ({
  id: runSession.id,
  execution_package_id: runSession.execution_package_id,
  status: runSession.status,
  ...(hasText(runSession.executor_type) ? { executor_type: runSession.executor_type } : {}),
  ...(hasText(runSession.summary) ? { summary: runSession.summary } : {}),
  check_results: runSession.check_results.map((check) => ({
    check_id: check.check_id,
    status: check.status,
    ...(check.blocks_review !== undefined ? { blocks_review: check.blocks_review } : {}),
  })),
  artifacts: runSession.artifacts.flatMap((artifact) => {
    const publicArtifact = serializePublicArtifactRef(artifact);
    return publicArtifact === undefined ? [] : [publicArtifact];
  }),
  created_at: runSession.created_at,
  updated_at: runSession.updated_at,
  ...(hasText(runSession.started_at) ? { started_at: runSession.started_at } : {}),
  ...(hasText(runSession.finished_at) ? { finished_at: runSession.finished_at } : {}),
});

const publicReviewPacketSummary = (reviewPacket: ReviewPacket): PublicReleaseReviewPacketSummary => ({
  id: reviewPacket.id,
  execution_package_id: reviewPacket.execution_package_id,
  run_session_id: reviewPacket.run_session_id,
  status: reviewPacket.status,
  decision: reviewPacket.decision,
  ...(hasText(reviewPacket.summary) ? { summary: reviewPacket.summary } : {}),
  ...(hasText(reviewPacket.check_result_summary) ? { check_result_summary: reviewPacket.check_result_summary } : {}),
  risk_notes: reviewPacket.risk_notes,
  created_at: reviewPacket.created_at,
  updated_at: reviewPacket.updated_at,
  ...(hasText(reviewPacket.completed_at) ? { completed_at: reviewPacket.completed_at } : {}),
});

const publicReleaseDecision = (decision: Decision): PublicReleaseDecision | undefined => {
  if (decision.object_type !== 'release') {
    return undefined;
  }

  const serialized = serializePublicDecision(decision);
  const parsed = releaseCockpitResponseSchema.shape.decisions.element.safeParse(serialized);
  return parsed.success ? parsed.data : undefined;
};

const publicLinkVisibility = (input: {
  release: Release;
  workItems: readonly WorkItem[];
  executionPackages: readonly ExecutionPackage[];
  runSessions: readonly RunSession[];
  reviewPackets: readonly ReviewPacket[];
  evidences: readonly ReleaseEvidence[];
  artifactsByEvidenceId: ReadonlyMap<string, Artifact | undefined>;
  decisions: readonly PublicReleaseDecision[];
}): ReleasePublicLinkVisibility[] => {
  const visibilityByRef = new Map<string, ReleasePublicLinkVisibility>();
  const workItemIds = new Set(input.workItems.map((workItem) => workItem.id));
  const executionPackageIds = new Set(input.executionPackages.map((executionPackage) => executionPackage.id));
  const runSessionIds = new Set(input.runSessions.map((runSession) => runSession.id));
  const reviewPacketIds = new Set(input.reviewPackets.map((reviewPacket) => reviewPacket.id));
  const decisionIds = new Set(input.decisions.map((decision) => decision.id));
  const publicArtifactIds = new Set(
    input.evidences.flatMap((evidence) => {
      const artifact = input.artifactsByEvidenceId.get(evidence.id);
      if (artifact === undefined || evidence.artifact_id === undefined || serializePublicArtifactRef(artifact.ref) === undefined) {
        return [];
      }
      return [evidence.artifact_id];
    }),
  );

  for (const evidence of input.evidences) {
    for (const link of observationLinksFor(evidence)) {
      const key = visibilityKey(link.object_type, link.object_id);
      if (visibilityByRef.has(key)) {
        continue;
      }

      const publicLink =
        (link.object_type === 'release' && link.object_id === input.release.id) ||
        (link.object_type === 'work_item' && workItemIds.has(link.object_id)) ||
        (link.object_type === 'execution_package' && executionPackageIds.has(link.object_id)) ||
        (link.object_type === 'run_session' && runSessionIds.has(link.object_id)) ||
        (link.object_type === 'review_packet' && reviewPacketIds.has(link.object_id)) ||
        (link.object_type === 'artifact' && publicArtifactIds.has(link.object_id)) ||
        (link.object_type === 'decision' && decisionIds.has(link.object_id));

      visibilityByRef.set(key, {
        object_type: link.object_type,
        object_id: link.object_id,
        public: publicLink,
      });
    }
  }

  return [...visibilityByRef.values()];
};

const filterUnsafeObservationLinks = (
  evidence: PublicReleaseEvidenceProjection,
  publicVisibility: readonly ReleasePublicLinkVisibility[],
): PublicReleaseEvidenceProjection => {
  const observation = evidence.extra.observation;
  if (observation?.links === undefined) {
    return evidence;
  }

  const visibilityByRef = new Map(
    publicVisibility.map((item) => [visibilityKey(item.object_type, item.object_id), item.public]),
  );
  const publicLinks = observation.links.filter((link) => visibilityByRef.get(visibilityKey(link.object_type, link.object_id)) === true);

  return {
    ...evidence,
    extra: {
      ...evidence.extra,
      observation: {
        source: observation.source,
        severity: observation.severity,
        summary: observation.summary,
        observed_at: observation.observed_at,
        ...(observation.actor_id !== undefined ? { actor_id: observation.actor_id } : {}),
        ...(publicLinks.length > 0 ? { links: publicLinks } : {}),
        ...(observation.metrics !== undefined ? { metrics: observation.metrics } : {}),
        ...(observation.notes !== undefined ? { notes: observation.notes } : {}),
      },
    },
  };
};

const productNextActions = (release: Release, blockers: readonly { overrideable: boolean }[], domainActions: readonly string[]): string[] => {
  const actions = new Set<string>();
  if (blockers.length === 0 && release.phase === 'rollout' && release.gate_state === 'approved') {
    actions.add('start_observing');
  }
  for (const action of domainActions) {
    actions.add(action);
  }
  return [...actions];
};

export async function getReleaseCockpit(
  repository: P0Repository,
  releaseId: string,
): Promise<ReleaseCockpitResponse | undefined> {
  const release = await repository.getRelease(releaseId);
  if (release === undefined) {
    return undefined;
  }

  const [workItemLinks, executionPackageLinks, evidences, rawDecisions] = await Promise.all([
    resolveWorkItemLinks(repository, release),
    resolveExecutionPackageLinks(repository, release),
    repository.listReleaseEvidences(release.id),
    repository.listDecisionsForObject('release', release.id),
  ]);

  const workItems = resolvedWorkItems(workItemLinks);
  const executionPackages = resolvedExecutionPackages(executionPackageLinks);
  const runSessionSelections = await Promise.all(
    executionPackages.map((executionPackage) => latestRunSessionForPackage(repository, release, executionPackage)),
  );
  const latestRunSessions = runSessionSelections.flatMap((selection) => (selection.latest === undefined ? [] : [selection.latest]));
  const allRunSessions = runSessionSelections.flatMap((selection) => selection.all);
  const allReviewPackets = (await Promise.all(
    executionPackages.map((executionPackage) => repository.listReviewPacketsForPackage(executionPackage.id)),
  )).flat();
  const currentReviewPackets = executionPackages.flatMap((executionPackage) => {
    const selected = selectReleaseReviewPacket(release, executionPackage, allReviewPackets);
    return selected === undefined ? [] : [selected];
  });
  const artifactEntries = await Promise.all(
    evidences.map(async (evidence) => [evidence.id, await artifactForEvidence(repository, evidence)] as const),
  );
  const artifactsByEvidenceId = new Map<string, Artifact | undefined>(artifactEntries);
  const decisions = rawDecisions.flatMap((decision) => {
    const publicDecision = publicReleaseDecision(decision);
    return publicDecision === undefined ? [] : [publicDecision];
  });
  const visibility = publicLinkVisibility({
    release,
    workItems,
    executionPackages,
    runSessions: latestRunSessions,
    reviewPackets: currentReviewPackets,
    evidences,
    artifactsByEvidenceId,
    decisions,
  });
  const context = {
    release,
    work_items: workItems,
    work_item_links: workItemLinks,
    execution_packages: executionPackages,
    execution_package_links: executionPackageLinks,
    run_sessions: allRunSessions,
    review_packets: allReviewPackets,
    evidence: evidences,
    public_link_visibility: visibility,
  };
  const blockers = deriveReleaseBlockers(context);
  const serializedEvidences = evidences.map((evidence) =>
    filterUnsafeObservationLinks(
      serializePublicReleaseEvidence(
        artifactsByEvidenceId.get(evidence.id) === undefined
          ? { evidence }
          : { evidence, artifact: artifactsByEvidenceId.get(evidence.id) as Artifact },
      ),
      visibility,
    ),
  );
  const observations = serializedEvidences.filter(
    (evidence) => evidence.evidence_type === 'observation_note' || evidence.evidence_type === 'metric_snapshot',
  );

  return releaseCockpitResponseSchema.parse({
    release: publicReleaseSummary(release, workItems, executionPackages),
    work_items: workItems.map(publicWorkItemSummary),
    execution_packages: executionPackages.map((executionPackage) =>
      publicExecutionPackageSummary(
        executionPackage,
        latestRunSessions.find((runSession) => runSession.execution_package_id === executionPackage.id),
      ),
    ),
    latest_run_sessions: latestRunSessions.map(publicRunSessionSummary),
    current_review_packets: currentReviewPackets.map(publicReviewPacketSummary),
    evidences: serializedEvidences,
    observations,
    decisions,
    blocker_snapshot: createReleaseBlockerSnapshot({
      release_id: release.id,
      generated_at: release.updated_at,
      blockers,
    }),
    blockers,
    overridden_blockers: [],
    risk_summary: deriveReleaseRiskSummary(context),
    checklist: deriveReleaseChecklist(context),
    next_actions: productNextActions(release, blockers, deriveReleaseNextActions(context)),
  });
}
