import type {
  ExecutionPackage,
  Release,
  ReleaseBlocker,
  ReleaseBlockerCategory,
  ReleaseBlockerCode,
  ReleaseEvidence,
  ReviewPacket,
  RunSession,
  WorkItem,
} from './types.js';
import { releaseBlockerCodes } from './types.js';

export { releaseBlockerCodes };

export interface ReleaseGateContext {
  release?: Release;
  work_items?: readonly WorkItem[];
  execution_packages?: readonly ExecutionPackage[];
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

const isVisible = (object: { archived_at?: string; deleted_at?: string; authorized?: boolean }): boolean =>
  object.archived_at === undefined && object.deleted_at === undefined && object.authorized !== false;

const sortNewestFirst = <T extends { created_at: string }>(items: readonly T[]): T[] =>
  [...items].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));

export const selectReleaseReviewPacket = (
  release: Pick<Release, 'current_review_packet_ids'>,
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

  const validWorkItems = release.work_item_ids
    .map((workItemId) => {
      const linked = workItems.find((workItem) => workItem.id === workItemId);
      if (linked === undefined || !isVisible(linked)) {
        blockers.push(blocker('missing_work_item', `Release is missing valid work item ${workItemId}.`, {
          type: 'work_item',
          id: workItemId,
        }));
        return undefined;
      }
      return linked;
    })
    .filter((workItem): workItem is WorkItem => workItem !== undefined);

  const validExecutionPackages = release.execution_package_ids
    .map((executionPackageId) => {
      const linked = executionPackages.find((executionPackage) => executionPackage.id === executionPackageId);
      if (linked === undefined || !isVisible(linked)) {
        blockers.push(
          blocker('missing_execution_package', `Release is missing valid execution package ${executionPackageId}.`, {
            type: 'execution_package',
            id: executionPackageId,
          }),
        );
        return undefined;
      }
      return linked;
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
    if (executionPackage.gate_state !== 'release_ready') {
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
    if (selectedRunSession?.check_results.some((check) => check.blocks_review && check.status !== 'succeeded') === true) {
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
