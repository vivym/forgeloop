import type { ArtifactRef, EvidenceChainRedactionReason } from '@forgeloop/contracts';
import type { RunSession } from '@forgeloop/domain';

type ArtifactWithRawRef = ArtifactRef & { raw_ref?: unknown };

export const artifactRedactionReason = (artifact: ArtifactRef): EvidenceChainRedactionReason | undefined => {
  const candidate = artifact as ArtifactWithRawRef;
  if (artifact.kind === 'logs') {
    return 'logs_artifact';
  }
  if (artifact.kind === 'raw_metadata') {
    return 'raw_metadata_artifact';
  }
  if (candidate.raw_ref !== undefined) {
    return 'raw_ref';
  }
  if (artifact.local_ref !== undefined && artifact.storage_uri === undefined) {
    return 'local_ref_only';
  }

  return undefined;
};

export const serializePublicArtifactRef = (artifact: ArtifactRef): ArtifactRef | undefined => {
  const candidate = artifact as ArtifactWithRawRef;
  if (artifactRedactionReason(artifact) !== undefined) {
    return undefined;
  }

  const { raw_ref: _rawRef, local_ref: _localRef, ...publicArtifact } = candidate;
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
