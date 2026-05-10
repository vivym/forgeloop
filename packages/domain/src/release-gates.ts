import type {
  ExecutionPackage,
  Release,
  ReleaseBlocker,
  ReleaseBlockerCategory,
  ReleaseBlockerCode,
  ReleaseBlockerSnapshot,
  ReleaseEvidence,
  ReviewPacket,
  RunSession,
  WorkItem,
} from './types.js';
import { releaseBlockerCodes } from './types.js';

export { releaseBlockerCodes };

export type ReleaseResolvedLinkStatus = 'resolved' | 'missing' | 'archived' | 'deleted' | 'unauthorized';

export interface ReleaseResolvedWorkItemLink {
  object_id: string;
  status: ReleaseResolvedLinkStatus;
  reason?: string;
  work_item?: WorkItem;
}

export interface ReleaseResolvedExecutionPackageLink {
  object_id: string;
  status: ReleaseResolvedLinkStatus;
  reason?: string;
  execution_package?: ExecutionPackage;
}

export interface ReleaseGateContext {
  release?: Release;
  work_items?: readonly WorkItem[];
  work_item_links?: readonly ReleaseResolvedWorkItemLink[];
  execution_packages?: readonly ExecutionPackage[];
  execution_package_links?: readonly ReleaseResolvedExecutionPackageLink[];
  run_sessions?: readonly RunSession[];
  review_packets?: readonly ReviewPacket[];
  evidence?: readonly ReleaseEvidence[];
}

const overrideableCodes = new Set<ReleaseBlockerCode>([
  'work_item_not_complete',
  'package_not_release_ready',
  'missing_approved_review_packet',
  'failed_required_check',
  'missing_required_artifact',
  'evidence_redacted',
  'stale_or_superseded_evidence',
  'missing_rollout_strategy',
  'missing_rollback_plan',
  'missing_observation_plan',
]);

const categoryByCode: Record<ReleaseBlockerCode, ReleaseBlockerCategory> = {
  missing_work_item: 'structural',
  missing_execution_package: 'structural',
  empty_release_scope: 'structural',
  work_item_not_complete: 'risk',
  package_not_release_ready: 'risk',
  missing_approved_review_packet: 'evidence',
  failed_required_check: 'evidence',
  missing_required_artifact: 'evidence',
  evidence_redacted: 'evidence',
  stale_or_superseded_evidence: 'evidence',
  missing_rollout_strategy: 'planning',
  missing_rollback_plan: 'planning',
  missing_observation_plan: 'planning',
};

export const isReleaseBlockerOverrideable = (code: ReleaseBlockerCode): boolean => overrideableCodes.has(code);

const blocker = (code: ReleaseBlockerCode, message: string, object?: { type: string; id: string }): ReleaseBlocker => ({
  code,
  category: categoryByCode[code],
  overrideable: isReleaseBlockerOverrideable(code),
  message,
  ...(object !== undefined ? { object_type: object.type, object_id: object.id } : {}),
});

const hasText = (value: string | undefined): value is string => value !== undefined && value.trim().length > 0;

const isVisible = (object: { archived_at?: string; deleted_at?: string }): boolean =>
  object.archived_at === undefined && object.deleted_at === undefined;

const sortNewestFirst = <T extends { created_at: string }>(items: readonly T[]): T[] =>
  [...items].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));

const stableBlockerValue = (blocker: ReleaseBlocker) => ({
  category: blocker.category,
  code: blocker.code,
  message: blocker.message,
  object_id: blocker.object_id ?? '',
  object_type: blocker.object_type ?? '',
  overrideable: blocker.overrideable,
});

export const fingerprintReleaseBlockers = (blockers: readonly ReleaseBlocker[]): string => {
  const stableJson = JSON.stringify(
    blockers
      .map(stableBlockerValue)
      .sort((left, right) =>
        `${left.code}\0${left.object_type}\0${left.object_id}\0${left.message}`.localeCompare(
          `${right.code}\0${right.object_type}\0${right.object_id}\0${right.message}`,
        ),
      ),
  );
  let hash = 5381;
  for (let index = 0; index < stableJson.length; index += 1) {
    hash = (hash * 33) ^ stableJson.charCodeAt(index);
  }

  return `release-blockers:v1:${(hash >>> 0).toString(16)}`;
};

export const createReleaseBlockerSnapshot = (input: {
  release_id: string;
  generated_at: string;
  blockers: readonly ReleaseBlocker[];
}): ReleaseBlockerSnapshot => ({
  release_id: input.release_id,
  generated_at: input.generated_at,
  blocker_fingerprint: fingerprintReleaseBlockers(input.blockers),
  blockers: input.blockers.map((item) => ({ ...item })),
});

export const isReleaseBlockerSnapshotInternallyConsistent = (snapshot: ReleaseBlockerSnapshot): boolean =>
  snapshot.blocker_fingerprint === fingerprintReleaseBlockers(snapshot.blockers);

export const selectReleaseReviewPacket = (
  release: Pick<Release, 'current_review_packet_ids' | 'current_run_session_ids'>,
  executionPackage: Pick<ExecutionPackage, 'id' | 'last_run_session_id'>,
  reviewPackets: readonly ReviewPacket[],
): ReviewPacket | undefined => {
  const packagePackets = reviewPackets.filter(
    (reviewPacket) => reviewPacket.execution_package_id === executionPackage.id && reviewPacket.status !== 'archived',
  );

  const currentReviewPacket = packagePackets.find(
    (reviewPacket) => release.current_review_packet_ids?.includes(reviewPacket.id) === true,
  );
  if (currentReviewPacket !== undefined) {
    return currentReviewPacket;
  }

  const currentRunReviewPacket = sortNewestFirst(packagePackets).find(
    (reviewPacket) => release.current_run_session_ids?.includes(reviewPacket.run_session_id) === true,
  );
  if (currentRunReviewPacket !== undefined) {
    return currentRunReviewPacket;
  }

  if (executionPackage.last_run_session_id !== undefined) {
    const lastRunPacket = sortNewestFirst(packagePackets).find(
      (reviewPacket) => reviewPacket.run_session_id === executionPackage.last_run_session_id,
    );
    if (lastRunPacket !== undefined) {
      return lastRunPacket;
    }
  }

  return sortNewestFirst(packagePackets)[0];
};

const runForReviewPacket = (reviewPacket: ReviewPacket | undefined, runSessions: readonly RunSession[]) =>
  reviewPacket === undefined ? undefined : runSessions.find((runSession) => runSession.id === reviewPacket.run_session_id);

const missingRequiredArtifactKinds = (
  executionPackage: Pick<ExecutionPackage, 'required_artifact_kinds'>,
  runSession: Pick<RunSession, 'artifacts' | 'log_refs'> | undefined,
): string[] => {
  if (runSession === undefined) {
    return [...executionPackage.required_artifact_kinds];
  }

  const artifactKinds = new Set(runSession.artifacts.map((artifact) => artifact.kind));
  const logKinds = new Set(runSession.log_refs.map((artifact) => artifact.kind));
  return executionPackage.required_artifact_kinds.filter((kind) =>
    kind === 'logs' ? !logKinds.has(kind) : !artifactKinds.has(kind),
  );
};

const hasFailedOrMissingRequiredCheck = (
  executionPackage: Pick<ExecutionPackage, 'required_checks'>,
  runSession: Pick<RunSession, 'check_results'> | undefined,
): boolean => {
  if (runSession === undefined) {
    return false;
  }

  const checkResultsById = new Map(runSession.check_results.map((check) => [check.check_id, check]));
  return executionPackage.required_checks.some((requiredCheck) => {
    const result = checkResultsById.get(requiredCheck.check_id);
    return result === undefined || result.status !== 'succeeded';
  });
};

const resolveWorkItemLinks = (
  release: Release,
  workItems: readonly WorkItem[],
  explicitLinks: readonly ReleaseResolvedWorkItemLink[] | undefined,
): ReleaseResolvedWorkItemLink[] => {
  if (explicitLinks !== undefined) {
    return release.work_item_ids.map((workItemId) => {
      const explicit = explicitLinks.find((link) => link.object_id === workItemId);
      if (explicit !== undefined) {
        return explicit;
      }

      return { object_id: workItemId, status: 'missing' };
    });
  }

  return release.work_item_ids.map((workItemId) => {
    const item = workItems.find((workItem) => workItem.id === workItemId);
    if (item === undefined) {
      return { object_id: workItemId, status: 'missing' };
    }
    if (item.archived_at !== undefined) {
      return { object_id: workItemId, status: 'archived', work_item: item };
    }
    if (item.deleted_at !== undefined) {
      return { object_id: workItemId, status: 'deleted', work_item: item };
    }

    return { object_id: workItemId, status: 'resolved', work_item: item };
  });
};

const resolveExecutionPackageLinks = (
  release: Release,
  executionPackages: readonly ExecutionPackage[],
  explicitLinks: readonly ReleaseResolvedExecutionPackageLink[] | undefined,
): ReleaseResolvedExecutionPackageLink[] => {
  if (explicitLinks !== undefined) {
    return release.execution_package_ids.map((executionPackageId) => {
      const explicit = explicitLinks.find((link) => link.object_id === executionPackageId);
      if (explicit !== undefined) {
        return explicit;
      }

      return { object_id: executionPackageId, status: 'missing' };
    });
  }

  return release.execution_package_ids.map((executionPackageId) => {
    const item = executionPackages.find((executionPackage) => executionPackage.id === executionPackageId);
    if (item === undefined) {
      return { object_id: executionPackageId, status: 'missing' };
    }
    if (item.archived_at !== undefined) {
      return { object_id: executionPackageId, status: 'archived', execution_package: item };
    }
    if (item.deleted_at !== undefined) {
      return { object_id: executionPackageId, status: 'deleted', execution_package: item };
    }

    return { object_id: executionPackageId, status: 'resolved', execution_package: item };
  });
};

export const deriveReleaseBlockers = (context: ReleaseGateContext): ReleaseBlocker[] => {
  const release = context.release;
  const workItems = context.work_items ?? [];
  const executionPackages = context.execution_packages ?? [];
  const runSessions = context.run_sessions ?? [];
  const reviewPackets = context.review_packets ?? [];
  const evidence = context.evidence ?? [];
  const blockers: ReleaseBlocker[] = [];

  if (release === undefined) {
    return blockers;
  }

  const validWorkItems = resolveWorkItemLinks(release, workItems, context.work_item_links)
    .map((link) => {
      if (link.status !== 'resolved' || link.work_item === undefined || !isVisible(link.work_item)) {
        blockers.push(blocker('missing_work_item', `Release is missing valid work item ${link.object_id}.`, {
          type: 'work_item',
          id: link.object_id,
        }));
        return undefined;
      }
      return link.work_item;
    })
    .filter((workItem): workItem is WorkItem => workItem !== undefined);

  const validExecutionPackages = resolveExecutionPackageLinks(
    release,
    executionPackages,
    context.execution_package_links,
  )
    .map((link) => {
      if (link.status !== 'resolved' || link.execution_package === undefined || !isVisible(link.execution_package)) {
        blockers.push(
          blocker('missing_execution_package', `Release is missing valid execution package ${link.object_id}.`, {
            type: 'execution_package',
            id: link.object_id,
          }),
        );
        return undefined;
      }
      return link.execution_package;
    })
    .filter((executionPackage): executionPackage is ExecutionPackage => executionPackage !== undefined);

  if (validWorkItems.length === 0 || validExecutionPackages.length === 0) {
    blockers.push(blocker('empty_release_scope', 'Release requires at least one valid work item and execution package.'));
  }

  for (const workItem of validWorkItems) {
    if (workItem.resolution !== 'completed') {
      blockers.push(blocker('work_item_not_complete', `Work item ${workItem.id} is not complete.`, {
        type: 'work_item',
        id: workItem.id,
      }));
    }
  }

  for (const executionPackage of validExecutionPackages) {
    if (executionPackage.gate_state !== 'release_ready' && executionPackage.gate_state !== 'released') {
      blockers.push(blocker('package_not_release_ready', `Execution package ${executionPackage.id} is not release-ready.`, {
        type: 'execution_package',
        id: executionPackage.id,
      }));
    }

    const selectedReviewPacket = selectReleaseReviewPacket(release, executionPackage, reviewPackets);
    if (
      selectedReviewPacket === undefined ||
      selectedReviewPacket.status !== 'completed' ||
      selectedReviewPacket.decision !== 'approved'
    ) {
      blockers.push(
        blocker('missing_approved_review_packet', `Execution package ${executionPackage.id} has no approved review packet.`, {
          type: 'execution_package',
          id: executionPackage.id,
        }),
      );
    }

    const selectedRunSession = runForReviewPacket(selectedReviewPacket, runSessions);
    if (
      hasFailedOrMissingRequiredCheck(executionPackage, selectedRunSession) ||
      selectedRunSession?.check_results.some((check) => check.blocks_review && check.status !== 'succeeded') === true
    ) {
      blockers.push(blocker('failed_required_check', `Execution package ${executionPackage.id} has a failed required check.`, {
        type: 'execution_package',
        id: executionPackage.id,
      }));
    }

    if (missingRequiredArtifactKinds(executionPackage, selectedRunSession).length > 0) {
      blockers.push(
        blocker('missing_required_artifact', `Execution package ${executionPackage.id} is missing required artifacts.`, {
          type: 'execution_package',
          id: executionPackage.id,
        }),
      );
    }
  }

  for (const item of evidence) {
    if (item.release_id !== release.id) {
      continue;
    }
    if (item.redacted) {
      blockers.push(blocker('evidence_redacted', `Release evidence ${item.id} is redacted.`, {
        type: 'release_evidence',
        id: item.id,
      }));
    }
    if (item.status !== 'current') {
      blockers.push(blocker('stale_or_superseded_evidence', `Release evidence ${item.id} is stale or superseded.`, {
        type: 'release_evidence',
        id: item.id,
      }));
    }
  }

  if (!hasText(release.rollout_strategy)) {
    blockers.push(blocker('missing_rollout_strategy', 'Release is missing a rollout strategy.'));
  }
  if (!hasText(release.rollback_plan)) {
    blockers.push(blocker('missing_rollback_plan', 'Release is missing a rollback plan.'));
  }
  if (!hasText(release.observation_plan)) {
    blockers.push(blocker('missing_observation_plan', 'Release is missing an observation plan.'));
  }

  return blockers;
};
