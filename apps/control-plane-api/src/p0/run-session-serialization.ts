import type { CheckResult, ExecutorResult } from '@forgeloop/contracts';
import { serializePublicArtifactRef, serializePublicArtifactRefs } from '@forgeloop/db';
import type { RunSession } from '@forgeloop/domain';

type PublicRuntimeMetadata = NonNullable<RunSession['runtime_metadata']>;

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
