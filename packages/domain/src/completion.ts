import type { ExecutionPackage, ReviewPacket, RunSession, WorkItem, WorkItemResolution } from './types';

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
    const successfulRuns = runSessions.filter(
      (runSession) => runSession.execution_package_id === executionPackage.id && runSession.status === 'succeeded',
    );

    if (successfulRuns.length === 0) {
      incompleteReasons.push(`package ${executionPackage.id} has no successful run`);
      continue;
    }

    const approvedRun = successfulRuns.find((runSession) =>
      hasApprovedReviewForRun(executionPackage, runSession, reviewPackets),
    );

    if (approvedRun === undefined) {
      incompleteReasons.push(`package ${executionPackage.id} has no approved review decision`);
      continue;
    }

    const artifactKinds = new Set(approvedRun.artifacts.map((artifact) => artifact.kind));
    for (const requiredArtifactKind of executionPackage.required_artifact_kinds) {
      if (!artifactKinds.has(requiredArtifactKind)) {
        incompleteReasons.push(`package ${executionPackage.id} is missing artifact ${requiredArtifactKind}`);
      }
    }
  }

  return {
    done: incompleteReasons.length === 0,
    resolution: incompleteReasons.length === 0 ? 'completed' : 'none',
    incomplete_reasons: incompleteReasons,
  };
};
