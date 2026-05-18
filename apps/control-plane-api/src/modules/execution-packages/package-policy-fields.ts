import type { ExecutionPackage } from '@forgeloop/domain';

export const DEFAULT_PACKAGE_POLICY_DIGEST = 'delivery-default-policy';
export const DEFAULT_PACKAGE_POLICY_SOURCE_PATH = 'forgeloop://delivery/default-package-policy';
export const MANUAL_PACKAGE_POLICY_DIGEST = 'delivery-manual-package-policy';
export const MANUAL_PACKAGE_POLICY_SOURCE_PATH = 'forgeloop://delivery/manual-package-policy';

export const defaultPackagePolicyFields = (input: {
  policyDigest: string;
  policySourcePath: string;
  loadedAt: string;
  requiredChecks: ExecutionPackage['required_checks'];
  allowedPaths: string[];
  forbiddenPaths: string[];
}): Pick<
  ExecutionPackage,
  | 'validation_strategy'
  | 'validation_strategy_version'
  | 'validation_public_summary'
  | 'policy_snapshot_status'
  | 'policy_snapshot_version'
  | 'package_policy_snapshot'
> => ({
  validation_strategy: 'checks_required',
  validation_strategy_version: 1,
  validation_public_summary: 'Required checks and package path policy are frozen for this package.',
  policy_snapshot_status: 'captured',
  policy_snapshot_version: 1,
  package_policy_snapshot: {
    policy_snapshot_version: 1,
    policy_digest: input.policyDigest,
    policy_source_path: input.policySourcePath,
    policy_loaded_at: input.loadedAt,
    policy_last_known_good: true,
    hooks: [],
    command_policy: { required_checks: input.requiredChecks.map((check) => check.check_id) },
    check_policy: { required_checks: input.requiredChecks.map((check) => check.check_id) },
    env_policy: {},
    path_policy: { allowed_paths: input.allowedPaths, forbidden_paths: input.forbiddenPaths },
    codex_runtime_mode: 'mock',
    fallback_policy: { allow_exec_fallback: false },
    validation_strategy_version: 1,
    validation_strategy: 'checks_required',
    validation_public_summary: 'Required checks and package path policy are frozen for this package.',
  },
});
