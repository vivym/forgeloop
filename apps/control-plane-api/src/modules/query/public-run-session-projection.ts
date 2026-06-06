import { Injectable } from '@nestjs/common';
import type { CheckResult, ExecutorResult } from '@forgeloop/contracts';
import { serializePublicArtifactRef, serializePublicArtifactRefs } from '@forgeloop/db';
import { validateCodexDockerRuntimeEvidence } from '@forgeloop/domain';
import type { RunSession } from '@forgeloop/domain';

type PublicRuntimeMetadata = NonNullable<RunSession['runtime_metadata']>;

const publicDockerRuntimeEvidenceKeys = [
  'runtime_profile_id',
  'runtime_profile_revision_id',
  'runtime_profile_digest',
  'runtime_target_kind',
  'source_access_mode',
  'environment',
  'credential_binding_id',
  'credential_binding_version_id',
  'credential_payload_digest',
  'launch_lease_id',
  'worker_id',
  'docker_image_digest',
  'container_id_digest',
  'app_server_effective_config_digest',
  'network_policy_digest',
  'network_policy_self_test_digest',
  'docker_policy_self_check_digest',
  'workspace_isolation_digest',
  'app_server_attempted',
  'selected_execution_mode',
] as const;

const publicDockerRuntimeEvidence = (runtimeMetadata: PublicRuntimeMetadata): Partial<PublicRuntimeMetadata> => {
  const candidate = publicDockerRuntimeEvidenceKeys.reduce<Partial<PublicRuntimeMetadata>>((metadata, key) => {
    const value = runtimeMetadata[key];
    if (value !== undefined) {
      (metadata as Record<string, unknown>)[key] = value;
    }
    return metadata;
  }, {});
  try {
    const {
      credential_binding_id: _credentialBindingId,
      credential_binding_version_id: _credentialBindingVersionId,
      credential_payload_digest: _credentialPayloadDigest,
      launch_lease_id: _launchLeaseId,
      worker_id: _workerId,
      ...publicEvidence
    } = validateCodexDockerRuntimeEvidence(candidate);
    return publicEvidence as unknown as Partial<PublicRuntimeMetadata>;
  } catch {
    return {};
  }
};

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
    ...publicDockerRuntimeEvidence(runtimeMetadata),
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

@Injectable()
export class PublicRunSessionProjection {
  serialize(runSession: RunSession): RunSession {
    return serializePublicRunSession(runSession);
  }
}
