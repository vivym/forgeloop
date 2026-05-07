import type { ArtifactRef } from '@forgeloop/contracts';
import type { RunSession } from '@forgeloop/domain';

type ArtifactWithRawRef = ArtifactRef & { raw_ref?: unknown };

export const serializePublicArtifactRef = (artifact: ArtifactRef): ArtifactRef | undefined => {
  const candidate = artifact as ArtifactWithRawRef;
  if (artifact.kind === 'logs' || candidate.raw_ref !== undefined) {
    return undefined;
  }

  const { raw_ref: _rawRef, ...publicArtifact } = candidate;
  return publicArtifact;
};

export const serializePublicArtifactRefs = (artifacts: ArtifactRef[]): ArtifactRef[] =>
  artifacts.flatMap((artifact) => {
    const publicArtifact = serializePublicArtifactRef(artifact);
    return publicArtifact === undefined ? [] : [publicArtifact];
  });

export const serializePublicRunSession = (runSession: RunSession): RunSession => {
  const { executor_result: executorResult, ...rest } = runSession;
  const base: RunSession = {
    ...rest,
    artifacts: serializePublicArtifactRefs(runSession.artifacts),
    log_refs: [],
  };

  return executorResult === undefined
    ? base
    : {
        ...base,
        executor_result: {
          ...executorResult,
          artifacts: serializePublicArtifactRefs(executorResult.artifacts),
        },
      };
};
