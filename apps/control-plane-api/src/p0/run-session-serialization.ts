import type { ArtifactRef, CheckResult, EvidenceChainRedactionReason, ExecutorResult } from '@forgeloop/contracts';
import type { RunSession } from '@forgeloop/domain';

type ArtifactWithRawRef = ArtifactRef & { raw_ref?: unknown };
type PublicRuntimeMetadata = NonNullable<RunSession['runtime_metadata']>;

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

const serializePublicCheckResult = (checkResult: CheckResult): CheckResult => {
  const { stdout, stderr, ...publicCheckResult } = checkResult;
  const publicStdout = stdout === undefined ? undefined : serializePublicArtifactRef(stdout);
  const publicStderr = stderr === undefined ? undefined : serializePublicArtifactRef(stderr);

  return {
    ...publicCheckResult,
    ...(publicStdout === undefined ? {} : { stdout: publicStdout }),
    ...(publicStderr === undefined ? {} : { stderr: publicStderr }),
  };
};

const serializePublicExecutorResult = (executorResult: ExecutorResult): ExecutorResult => ({
  ...executorResult,
  checks: executorResult.checks.map(serializePublicCheckResult),
  artifacts: serializePublicArtifactRefs(executorResult.artifacts),
  raw_metadata: {},
});

const serializePublicRuntimeMetadata = (
  runtimeMetadata: RunSession['runtime_metadata'],
): RunSession['runtime_metadata'] | undefined => {
  if (runtimeMetadata === undefined) {
    return undefined;
  }

  const publicMetadata: Partial<PublicRuntimeMetadata> = {
    durability_mode: runtimeMetadata.durability_mode,
    ...(runtimeMetadata.driver_kind === undefined ? {} : { driver_kind: runtimeMetadata.driver_kind }),
    ...(runtimeMetadata.driver_status === undefined ? {} : { driver_status: runtimeMetadata.driver_status }),
    ...(runtimeMetadata.worker_id === undefined ? {} : { worker_id: runtimeMetadata.worker_id }),
    ...(runtimeMetadata.worker_lease_status === undefined ? {} : { worker_lease_status: runtimeMetadata.worker_lease_status }),
    ...(runtimeMetadata.worker_lease_heartbeat_at === undefined
      ? {}
      : { worker_lease_heartbeat_at: runtimeMetadata.worker_lease_heartbeat_at }),
    ...(runtimeMetadata.worker_lease_expires_at === undefined
      ? {}
      : { worker_lease_expires_at: runtimeMetadata.worker_lease_expires_at }),
    ...(runtimeMetadata.last_event_cursor === undefined ? {} : { last_event_cursor: runtimeMetadata.last_event_cursor }),
    ...(runtimeMetadata.last_event_at === undefined ? {} : { last_event_at: runtimeMetadata.last_event_at }),
    recovery_attempt_count: runtimeMetadata.recovery_attempt_count,
  };

  return publicMetadata as RunSession['runtime_metadata'];
};

export const serializePublicRunSession = (runSession: RunSession): RunSession => {
  const { executor_result: executorResult, run_spec: _runSpec, runtime_metadata: runtimeMetadata, ...rest } = runSession;
  const publicRuntimeMetadata = serializePublicRuntimeMetadata(runtimeMetadata);
  const base: RunSession = {
    ...rest,
    check_results: runSession.check_results.map(serializePublicCheckResult),
    artifacts: serializePublicArtifactRefs(runSession.artifacts),
    log_refs: [],
    ...(publicRuntimeMetadata === undefined ? {} : { runtime_metadata: publicRuntimeMetadata }),
  };

  return executorResult === undefined
    ? base
    : {
        ...base,
        executor_result: serializePublicExecutorResult(executorResult),
      };
};
