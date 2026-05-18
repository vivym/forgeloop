import { BadRequestException } from '@nestjs/common';
import type { DeliveryRepository } from '@forgeloop/db';
import type { ExecutionPackage } from '@forgeloop/domain';
import { buildPackageRuntimePolicySnapshot, loadRuntimePolicy, RuntimePolicyError } from '@forgeloop/executor';

export const DEFAULT_SOURCE_MUTATION_POLICY: ExecutionPackage['source_mutation_policy'] = 'path_policy_scoped';

export const assertAllowedPathsForSourceMutation = (
  sourceMutationPolicy: ExecutionPackage['source_mutation_policy'],
  allowedPaths: string[],
): void => {
  if (sourceMutationPolicy !== 'no_source_changes' && allowedPaths.length === 0) {
    throw new BadRequestException({
      code: 'source_mutation_policy_required',
      message: 'allowed_paths may be empty only when source_mutation_policy is no_source_changes.',
    });
  }
};

export const repoRootForPackagePolicy = async (
  repository: DeliveryRepository,
  projectId: string,
  repoId: string,
): Promise<string> => {
  const repo = (await repository.listProjectRepos(projectId)).find(
    (candidate) => candidate.repo_id === repoId && candidate.status === 'active',
  );
  if (repo === undefined) {
    throw new BadRequestException({
      code: 'runtime_policy_repo_unavailable',
      message: `Repo ${repoId} is not active for project ${projectId}.`,
    });
  }
  return repo.local_path;
};

export const defaultPackagePolicyFields = async (
  repository: DeliveryRepository,
  input: {
    projectId: string;
    repoId: string;
    loadedAt: string;
    requiredChecks: ExecutionPackage['required_checks'];
    allowedPaths: string[];
    forbiddenPaths: string[];
    sourceMutationPolicy: ExecutionPackage['source_mutation_policy'];
    policySnapshotVersion?: number;
  },
): Promise<
  Pick<
    ExecutionPackage,
    | 'validation_strategy'
    | 'validation_strategy_version'
    | 'validation_public_summary'
    | 'policy_snapshot_status'
    | 'policy_snapshot_version'
    | 'package_policy_snapshot'
  >
> => {
  const policySnapshotVersion = input.policySnapshotVersion ?? 1;
  const repoRoot = await repoRootForPackagePolicy(repository, input.projectId, input.repoId);
  const loadedPolicy = await loadRuntimePolicy({
    repoRoot,
    loadedAt: input.loadedAt,
    defaultPrimaryExecutor: 'mock',
  });
  if (loadedPolicy.status !== 'loaded') {
    throw new BadRequestException({
      code: loadedPolicy.blocker_code,
      message: loadedPolicy.diagnostics[0]?.message ?? 'Runtime policy cannot be loaded.',
    });
  }

  try {
    const packagePolicySnapshot = buildPackageRuntimePolicySnapshot({
      loadedPolicy,
      executionPackageChecks: input.requiredChecks,
      executionPackagePathPolicy: { allowed_paths: input.allowedPaths, forbidden_paths: input.forbiddenPaths },
      validationStrategy: 'checks_required',
      sourceMutationPolicy: input.sourceMutationPolicy,
    });
    return {
      validation_strategy: 'checks_required',
      validation_strategy_version: 1,
      validation_public_summary: packagePolicySnapshot.validation_public_summary,
      policy_snapshot_status: 'captured',
      policy_snapshot_version: policySnapshotVersion,
      package_policy_snapshot: {
        ...packagePolicySnapshot,
        policy_snapshot_version: policySnapshotVersion,
      },
    };
  } catch (error) {
    if (error instanceof RuntimePolicyError) {
      throw new BadRequestException({ code: error.public_code, message: error.message });
    }
    throw error;
  }
};
