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

const hasApprovedReviewForRun = (
  executionPackage: ExecutionPackage,
  runSession: RunSession,
  reviewPackets: readonly ReviewPacket[],
): boolean =>
  reviewPackets.some(
    (reviewPacket) =>
      reviewPacket.execution_package_id === executionPackage.id &&
      reviewPacket.run_session_id === runSession.id &&
      reviewPacket.status === 'completed' &&
      reviewPacket.decision === 'approved',
  );

export const deriveRequiredArtifactPresence = (
  executionPackage: Pick<ExecutionPackage, 'required_artifact_kinds'>,
  runSession: Pick<RunSession, 'artifacts' | 'log_refs'>,
): RequiredArtifactPresence => {
  const artifactKinds = new Set<ArtifactKind>(runSession.artifacts.map((artifact) => artifact.kind));
  const logKinds = new Set<ArtifactKind>(runSession.log_refs.map((artifact) => artifact.kind));
  const presentArtifactKinds = new Set<ArtifactKind>();
  const missingArtifactKinds: ArtifactKind[] = [];

  for (const requiredArtifactKind of executionPackage.required_artifact_kinds) {
    const isPresent =
      requiredArtifactKind === 'logs' ? logKinds.has(requiredArtifactKind) : artifactKinds.has(requiredArtifactKind);

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

const missingRequiredArtifactReasons = (executionPackage: ExecutionPackage, runSession: RunSession): string[] => {
  const artifactPresence = deriveRequiredArtifactPresence(executionPackage, runSession);

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

      return missingRequiredArtifactReasons(executionPackage, runSession);
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
      (runSession) => missingRequiredArtifactReasons(executionPackage, runSession).length === 0,
    );

    if (approvedRunWithArtifacts === undefined) {
      const firstApprovedRun = approvedRuns[0];
      if (firstApprovedRun !== undefined) {
        incompleteReasons.push(...missingRequiredArtifactReasons(executionPackage, firstApprovedRun));
      }
    }
  }

  return {
    done: incompleteReasons.length === 0,
    resolution: incompleteReasons.length === 0 ? 'completed' : 'none',
    incomplete_reasons: incompleteReasons,
  };
};
