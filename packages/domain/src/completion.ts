import type { ArtifactKind } from '@forgeloop/contracts';

import type {
  ExecutionPackage,
  RequiredArtifactPresence,
  ReviewPacket,
  RunSession,
  WorkItem,
  WorkItemResolution,
} from './types.js';

export interface WorkItemCompletion {
  done: boolean;
  resolution: WorkItemResolution;
  incomplete_reasons: string[];
}

export interface RequiredArtifactPresenceContext {
  reviewPackets?: readonly Pick<ReviewPacket, 'execution_package_id' | 'run_session_id' | 'status' | 'decision'>[];
}

const hasApprovedReviewForRun = (
  executionPackage: Pick<ExecutionPackage, 'id'>,
  runSession: Pick<RunSession, 'id'>,
  reviewPackets: readonly Pick<ReviewPacket, 'execution_package_id' | 'run_session_id' | 'status' | 'decision'>[],
): boolean =>
  reviewPackets.some(
    (reviewPacket) =>
      reviewPacket.execution_package_id === executionPackage.id &&
      reviewPacket.run_session_id === runSession.id &&
      reviewPacket.status === 'completed' &&
      reviewPacket.decision === 'approved',
  );

export const deriveRequiredArtifactPresence = (
  executionPackage: Pick<ExecutionPackage, 'required_artifact_kinds'> & Partial<Pick<ExecutionPackage, 'id'>>,
  runSession: Pick<RunSession, 'artifacts' | 'log_refs'> & Partial<Pick<RunSession, 'id'>>,
  context: RequiredArtifactPresenceContext = {},
): RequiredArtifactPresence => {
  const artifactKinds = new Set<ArtifactKind>(runSession.artifacts.map((artifact) => artifact.kind));
  const logKinds = new Set<ArtifactKind>(runSession.log_refs.map((artifact) => artifact.kind));
  const presentArtifactKinds = new Set<ArtifactKind>();
  const missingArtifactKinds: ArtifactKind[] = [];

  for (const requiredArtifactKind of executionPackage.required_artifact_kinds) {
    const isPresent =
      requiredArtifactKind === 'logs'
        ? logKinds.has(requiredArtifactKind)
        : artifactKinds.has(requiredArtifactKind) ||
          (requiredArtifactKind === 'review_packet' &&
            executionPackage.id !== undefined &&
            runSession.id !== undefined &&
            hasApprovedReviewForRun(
              { id: executionPackage.id },
              { id: runSession.id },
              context.reviewPackets ?? [],
            ));

    if (isPresent) {
      presentArtifactKinds.add(requiredArtifactKind);
    } else {
      missingArtifactKinds.push(requiredArtifactKind);
    }
  }

  return {
    required_artifact_kinds: [...executionPackage.required_artifact_kinds],
    present_artifact_kinds: [...presentArtifactKinds],
    missing_artifact_kinds: missingArtifactKinds,
  };
};

const missingRequiredArtifactReasons = (
  executionPackage: ExecutionPackage,
  runSession: RunSession,
  reviewPackets: readonly ReviewPacket[],
): string[] => {
  const artifactPresence = deriveRequiredArtifactPresence(executionPackage, runSession, { reviewPackets });

  return artifactPresence.missing_artifact_kinds
    .map((requiredArtifactKind) => `package ${executionPackage.id} is missing artifact ${requiredArtifactKind}`);
};

export const deriveWorkItemCompletion = (
  workItem: WorkItem,
  executionPackages: readonly ExecutionPackage[],
  runSessions: readonly RunSession[],
  reviewPackets: readonly ReviewPacket[],
): WorkItemCompletion => {
  const packagesForWorkItem = executionPackages.filter(
    (executionPackage) => executionPackage.work_item_id === workItem.id,
  );
  const incompleteReasons: string[] = [];

  if (packagesForWorkItem.length === 0) {
    incompleteReasons.push(`work item ${workItem.id} has no execution packages`);
  }

  for (const executionPackage of packagesForWorkItem) {
    const packageRuns = runSessions.filter((runSession) => runSession.execution_package_id === executionPackage.id);
    const evaluateRun = (runSession: RunSession | undefined): string[] => {
      if (runSession === undefined || runSession.status !== 'succeeded') {
        return [`package ${executionPackage.id} has no successful run`];
      }

      if (!hasApprovedReviewForRun(executionPackage, runSession, reviewPackets)) {
        return [`package ${executionPackage.id} has no approved review decision`];
      }

      return missingRequiredArtifactReasons(executionPackage, runSession, reviewPackets);
    };

    if (executionPackage.last_run_session_id !== undefined) {
      incompleteReasons.push(
        ...evaluateRun(packageRuns.find((runSession) => runSession.id === executionPackage.last_run_session_id)),
      );
      continue;
    }

    const successfulRuns = packageRuns.filter((runSession) => runSession.status === 'succeeded');

    if (successfulRuns.length === 0) {
      incompleteReasons.push(`package ${executionPackage.id} has no successful run`);
      continue;
    }

    const approvedRuns = successfulRuns.filter((runSession) =>
      hasApprovedReviewForRun(executionPackage, runSession, reviewPackets),
    );

    if (approvedRuns.length === 0) {
      incompleteReasons.push(`package ${executionPackage.id} has no approved review decision`);
      continue;
    }

    const approvedRunWithArtifacts = approvedRuns.find(
      (runSession) => missingRequiredArtifactReasons(executionPackage, runSession, reviewPackets).length === 0,
    );

    if (approvedRunWithArtifacts === undefined) {
      const firstApprovedRun = approvedRuns[0];
      if (firstApprovedRun !== undefined) {
        incompleteReasons.push(...missingRequiredArtifactReasons(executionPackage, firstApprovedRun, reviewPackets));
      }
    }
  }

  return {
    done: incompleteReasons.length === 0,
    resolution: incompleteReasons.length === 0 ? 'completed' : 'none',
    incomplete_reasons: incompleteReasons,
  };
};
