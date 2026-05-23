import {
  deliveryRunReadinessResponseSchema,
  type DeliveryRunReadinessBlocker,
  type DeliveryRunReadinessBlockerCode,
  type DeliveryRunReadinessResponse,
} from '@forgeloop/contracts';
import type { ExecutionPackage } from '@forgeloop/domain';

import type { CodexRuntimeProfileReadinessDiagnostic, DeliveryRepository } from '../repositories/delivery-repository';

export interface DeriveDeliveryRunReadinessInput {
  executionPackage: ExecutionPackage;
  now: string;
  runtime_selection?: DeliveryRunReadinessRuntimeSelection;
}

export interface DeliveryRunReadinessRuntimeSelection {
  runtime_profile_id?: string;
  credential_binding_id?: string;
}

const requiredTargetKind = 'run_execution' as const;

const blockerMessages: Record<DeliveryRunReadinessBlockerCode, { message: string; severity: 'warning' | 'blocking' }> = {
  runtime_profile_missing: {
    message: 'A local Codex run execution profile must be active for this package scope.',
    severity: 'blocking',
  },
  runtime_profile_invalid: {
    message: 'The active Codex runtime profile is not valid for package run execution.',
    severity: 'blocking',
  },
  runtime_target_incompatible: {
    message: 'The active Codex runtime profile for this scope is not compatible with package run execution.',
    severity: 'blocking',
  },
  credential_binding_unconfigured: {
    message: 'Exactly one active credential binding must match the package run execution profile and scope.',
    severity: 'blocking',
  },
  credential_binding_ambiguous: {
    message: 'More than one active credential binding matches the package run execution profile and scope.',
    severity: 'blocking',
  },
  worker_unavailable: {
    message: 'No online Codex worker is currently available for this package scope.',
    severity: 'blocking',
  },
  worker_target_unsupported: {
    message: 'An online Codex worker is available, but it does not support run execution.',
    severity: 'blocking',
  },
  worker_docker_capability_mismatch: {
    message: 'An online Codex worker is available, but it does not advertise the required Docker runtime.',
    severity: 'blocking',
  },
  worker_network_policy_mismatch: {
    message: 'An online Codex worker is available, but it does not advertise the required network policy.',
    severity: 'blocking',
  },
  package_policy_snapshot_missing: {
    message: 'Capture the package runtime policy before checking local Codex readiness.',
    severity: 'blocking',
  },
  package_runtime_target_incompatible: {
    message: 'This package policy is not configured for local Codex app-server execution.',
    severity: 'blocking',
  },
  runtime_status_unknown: {
    message: 'Runtime status could not be derived.',
    severity: 'warning',
  },
};

const packageHref = (executionPackage: ExecutionPackage): string | undefined =>
  executionPackage.task_id === undefined ? undefined : `/tasks/${executionPackage.task_id}/packages/${executionPackage.id}`;

const blocker = (code: DeliveryRunReadinessBlockerCode, executionPackage: ExecutionPackage): DeliveryRunReadinessBlocker => {
  const href = packageHref(executionPackage);
  return {
    code,
    ...blockerMessages[code],
    ...(href === undefined ? {} : { next_step_href: href }),
  };
};

const policyTargetsLocalCodexRun = (executionPackage: ExecutionPackage): boolean => {
  const snapshot = executionPackage.package_policy_snapshot;
  if (snapshot === undefined || executionPackage.policy_snapshot_status !== 'captured') {
    return false;
  }
  const codexRuntimeMode = snapshot.codex_runtime_mode;
  return (
    typeof codexRuntimeMode === 'object' &&
    codexRuntimeMode !== null &&
    'primary_executor' in codexRuntimeMode &&
    codexRuntimeMode.primary_executor === 'app_server'
  );
};

const selectRunProfile = (
  profiles: readonly CodexRuntimeProfileReadinessDiagnostic[],
): CodexRuntimeProfileReadinessDiagnostic | undefined =>
  profiles.find((profile) => profile.target_kind === requiredTargetKind);

export async function deriveDeliveryRunReadiness(
  repository: DeliveryRepository,
  input: DeriveDeliveryRunReadinessInput,
): Promise<DeliveryRunReadinessResponse> {
  const blockers: DeliveryRunReadinessBlocker[] = [];
  const { executionPackage, now } = input;

  if (executionPackage.package_policy_snapshot === undefined || executionPackage.policy_snapshot_status !== 'captured') {
    blockers.push(blocker('package_policy_snapshot_missing', executionPackage));
  } else if (!policyTargetsLocalCodexRun(executionPackage)) {
    blockers.push(blocker('package_runtime_target_incompatible', executionPackage));
  }

  const profiles = await repository.listActiveCodexRuntimeProfileReadinessDiagnostics({
    project_id: executionPackage.project_id,
    repo_id: executionPackage.repo_id,
    ...(input.runtime_selection?.runtime_profile_id === undefined
      ? {}
      : { runtime_profile_id: input.runtime_selection.runtime_profile_id }),
    now,
  });
  const profile = selectRunProfile(profiles);
  if (profile === undefined) {
    blockers.push(blocker(profiles.length === 0 ? 'runtime_profile_missing' : 'runtime_target_incompatible', executionPackage));
  } else if (profile.source_access_mode !== 'path_policy_scoped') {
    blockers.push(blocker('runtime_profile_invalid', executionPackage));
  } else {
    const credentialCandidates = await repository.listCodexCredentialBindingReadinessCandidates({
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      runtime_profile_id: profile.profile_id,
      target_kind: requiredTargetKind,
      ...(input.runtime_selection?.credential_binding_id === undefined
        ? {}
        : { credential_binding_id: input.runtime_selection.credential_binding_id }),
      now,
    });
    if (credentialCandidates.length === 0) {
      blockers.push(blocker('credential_binding_unconfigured', executionPackage));
    } else if (credentialCandidates.length > 1) {
      blockers.push(blocker('credential_binding_ambiguous', executionPackage));
    }

    const workerDiagnostic = await repository.getCodexWorkerReadinessDiagnostic({
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      target_kind: requiredTargetKind,
      docker_image_digest: profile.docker_image_digest,
      network_policy_digest: profile.network_policy_digest,
      ...(profile.network_provider_config_digest === undefined
        ? {}
        : { network_provider_config_digest: profile.network_provider_config_digest }),
      now,
    });
    if (workerDiagnostic !== 'ready') {
      blockers.push(blocker(workerDiagnostic, executionPackage));
    }
  }

  return deliveryRunReadinessResponseSchema.parse({
    executor_type: 'local_codex',
    target_kind: requiredTargetKind,
    state: blockers.length === 0 ? 'ready' : 'blocked',
    blockers,
    generated_at: now,
  });
}

export const deliveryRunReadinessDisabledReason = (
  readiness: DeliveryRunReadinessResponse | undefined,
): string | undefined => {
  if (readiness === undefined || readiness.state === 'ready') {
    return undefined;
  }
  return readiness.blockers.find((blocker) => blocker.severity === 'blocking')?.message ?? readiness.blockers[0]?.message;
};
