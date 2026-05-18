import {
  resourceLimitDigest as domainResourceLimitDigest,
  validateEnqueuePreflightAttestation as validateDomainEnqueuePreflightAttestation,
  validateResourceLimitVector as validateDomainResourceLimitVector,
  type EnqueuePreflightAttestationBinding,
  type ResourceLimitVector,
  type RuntimeSafetyAttestation,
  type RuntimeSafetyAttestationValidationResult,
} from '@forgeloop/domain';

export type { EnqueuePreflightAttestationBinding, ResourceLimitVector, RuntimeSafetyAttestationValidationResult };

export interface RunExecutionAttestationBinding {
  executorType: string;
  workflowOnly: boolean;
  environment: RuntimeSafetyAttestation['environment'];
  projectId: string;
  repoId: string;
  executionPackageId: string;
  expectedPackageVersion: number;
  runId: string;
  policyDigest: string;
  policySnapshotVersion: number;
  envPolicyDigest: string;
  commandPolicyDigest: string;
  mountPolicyDigest: string;
  networkPolicyDigest: string;
  networkMode: RuntimeSafetyAttestation['network_mode'];
  resourceLimitDigest: string;
  governorId: string;
  sandboxId: string;
  sandboxVersion: string;
  sandboxBinaryDigest: string;
  sandboxConfigDigest: string;
  sandboxWrapperEnvironmentDigest: string;
  workspaceRoot: string;
  artifactRoot: string;
  sandboxOutputRoot?: string;
  now: string;
  maxAgeMs?: number;
}

export class ResourceLimitError extends Error {
  constructor(
    readonly code: 'runtime_resource_limits_missing' | 'runtime_resource_limit_digest_invalid',
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ResourceLimitError';
  }
}

const hardLimitModes = new Set(['unavailable', 'test_only_mock', 'enforcing']);
const runtimeEnvironments = new Set(['production', 'local_dogfood', 'test']);
const networkModes = new Set(['disabled', 'egress_allowlist']);
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;

export const validateResourceLimitVector = (input: unknown): ResourceLimitVector => {
  try {
    return validateDomainResourceLimitVector(input);
  } catch {
    throw new ResourceLimitError('runtime_resource_limits_missing', 'Resource limits must be an object.');
  }
};

export const resourceLimitDigest = (vector: ResourceLimitVector): string => {
  const normalized = validateResourceLimitVector(vector);
  return domainResourceLimitDigest(normalized);
};

export const validateEnqueuePreflightAttestation = (input: {
  attestation: RuntimeSafetyAttestation | undefined;
  expected: EnqueuePreflightAttestationBinding;
  now: string;
}): RuntimeSafetyAttestationValidationResult => validateDomainEnqueuePreflightAttestation(input);

export const validateRunExecutionAttestation = (input: {
  attestation: RuntimeSafetyAttestation | undefined;
  expected: RunExecutionAttestationBinding;
}): RuntimeSafetyAttestationValidationResult => {
  const attestation = input.attestation;
  if (
    !isPlainObject(attestation) ||
    !isRuntimeHardLimitMode(attestation.hard_limit_mode) ||
    attestation.hard_limit_mode === 'unavailable'
  ) {
    return failure(422, 'runtime_hard_limits_unavailable', 'Runtime hard limits are unavailable.');
  }
  if (attestation.attestation_scope !== 'run_execution') {
    return failure(400, 'runtime_safety_attestation_scope_invalid', 'Run execution requires a run_execution runtime safety attestation.');
  }
  if (attestation.executor_type !== input.expected.executorType || attestation.workflow_only !== input.expected.workflowOnly) {
    return failure(400, 'runtime_safety_attestation_mismatch', 'Runtime safety attestation does not match the execution request.');
  }
  if (!isRuntimeEnvironment(attestation.environment) || attestation.environment !== input.expected.environment) {
    return failure(400, 'runtime_safety_attestation_mismatch', 'Runtime safety attestation environment is invalid.');
  }
  if (
    attestation.project_id !== input.expected.projectId ||
    attestation.repo_id !== input.expected.repoId ||
    attestation.execution_package_id !== input.expected.executionPackageId ||
    attestation.expected_package_version !== input.expected.expectedPackageVersion ||
    attestation.run_id !== input.expected.runId
  ) {
    return failure(400, 'runtime_safety_attestation_mismatch', 'Runtime safety attestation does not match the run binding.');
  }

  const mismatchedDigest = (
    [
      ['policy_digest', attestation.policy_digest, input.expected.policyDigest],
      ['policy_snapshot_version', attestation.policy_snapshot_version, input.expected.policySnapshotVersion],
      ['env_policy_digest', attestation.env_policy_digest, input.expected.envPolicyDigest],
      ['command_policy_digest', attestation.command_policy_digest, input.expected.commandPolicyDigest],
      ['mount_policy_digest', attestation.mount_policy_digest, input.expected.mountPolicyDigest],
      ['network_policy_digest', attestation.network_policy_digest, input.expected.networkPolicyDigest],
    ] as const
  ).find(([, actual, expected]) => actual !== expected);
  if (mismatchedDigest !== undefined) {
    return failure(400, 'runtime_policy_attestation_digest_mismatch', 'Runtime safety attestation does not match the run policy binding.', {
      mismatched_field: mismatchedDigest[0],
    });
  }
  if (!isNetworkMode(attestation.network_mode) || attestation.network_mode !== input.expected.networkMode) {
    return failure(400, 'runtime_safety_attestation_mismatch', 'Runtime safety attestation network mode does not match the run binding.');
  }
  if (
    attestation.workspace_root !== input.expected.workspaceRoot ||
    attestation.artifact_root !== input.expected.artifactRoot ||
    (input.expected.sandboxOutputRoot !== undefined && attestation.sandbox_output_root !== input.expected.sandboxOutputRoot)
  ) {
    return failure(400, 'runtime_safety_attestation_mismatch', 'Runtime safety attestation runtime roots do not match the run binding.');
  }

  const mismatchedSandboxBinding = (
    [
      ['governor_id', attestation.governor_id, input.expected.governorId],
      ['sandbox_id', attestation.sandbox_id, input.expected.sandboxId],
      ['sandbox_version', attestation.sandbox_version, input.expected.sandboxVersion],
      ['sandbox_binary_digest', attestation.sandbox_binary_digest, input.expected.sandboxBinaryDigest],
      ['sandbox_config_digest', attestation.sandbox_config_digest, input.expected.sandboxConfigDigest],
      ['sandbox_wrapper_environment_digest', attestation.sandbox_wrapper_environment_digest, input.expected.sandboxWrapperEnvironmentDigest],
    ] as const
  ).find(([, actual, expected]) => actual !== expected);
  if (mismatchedSandboxBinding !== undefined) {
    return failure(400, 'runtime_safety_attestation_mismatch', 'Runtime safety attestation does not match the sandbox binding.', {
      mismatched_field: mismatchedSandboxBinding[0],
    });
  }

  const hardMaxValidation = validateHardMaxima(attestation);
  if (!hardMaxValidation.ok) {
    return hardMaxValidation;
  }

  const resourceLimitValidation = validateAttestationResourceLimits(attestation, input.expected.resourceLimitDigest);
  if (!resourceLimitValidation.ok) {
    return resourceLimitValidation;
  }
  if ((attestation.environment === 'production' || input.expected.executorType === 'local_codex') && attestation.hard_limit_mode !== 'enforcing') {
    return failure(400, 'runtime_hard_limits_not_enforcing', 'Production and local Codex run execution require enforcing runtime hard limits.');
  }
  if (attestation.hard_limit_mode === 'enforcing' && !hasCompleteEnforcingIsolation(attestation)) {
    return failure(
      400,
      'runtime_hard_limits_not_enforcing',
      'Production and local Codex run execution require complete runtime hard-limit and sandbox isolation support.',
    );
  }

  const freshness = validateFreshness(attestation, input.expected.now, input.expected.maxAgeMs);
  if (!freshness.ok) {
    return freshness;
  }
  return { ok: true };
};

const validateAttestationResourceLimits = (
  attestation: RuntimeSafetyAttestation,
  expectedDigest: string,
): RuntimeSafetyAttestationValidationResult => {
  if (!sha256Pattern.test(attestation.resource_limit_digest ?? '')) {
    return failure(400, 'runtime_resource_limit_digest_missing', 'Run execution requires a resource limit digest.');
  }
  if (attestation.resource_limit_digest !== expectedDigest) {
    return failure(400, 'runtime_resource_limit_digest_mismatch', 'Runtime safety attestation resource limit digest does not match the run binding.');
  }

  let vector: ResourceLimitVector;
  try {
    vector = validateResourceLimitVector(attestation.resource_limits);
  } catch {
    return failure(400, 'runtime_resource_limits_missing', 'Run execution requires resource limit details.');
  }
  if (resourceLimitDigest(vector) !== attestation.resource_limit_digest) {
    return failure(400, 'runtime_resource_limit_digest_mismatch', 'Runtime safety attestation resource limit digest does not match resource limits.');
  }
  if (
    vector.timeout_ms > attestation.max_command_timeout_ms ||
    vector.output_limit_bytes > attestation.max_command_output_bytes ||
    vector.run_output_limit_bytes > attestation.max_run_output_bytes
  ) {
    return failure(400, 'runtime_resource_limits_exceed_hard_max', 'Runtime resource limits exceed the attested hard maxima.');
  }
  return { ok: true };
};

const validateHardMaxima = (attestation: RuntimeSafetyAttestation): RuntimeSafetyAttestationValidationResult => {
  const hardMaxFields = [
    ['max_command_timeout_ms', attestation.max_command_timeout_ms],
    ['max_hook_timeout_ms', attestation.max_hook_timeout_ms],
    ['max_command_output_bytes', attestation.max_command_output_bytes],
    ['max_run_output_bytes', attestation.max_run_output_bytes],
  ] as const;
  const invalidField = hardMaxFields.find(([, value]) => !isPositiveInteger(value));
  if (invalidField !== undefined) {
    return failure(422, 'runtime_hard_limits_unavailable', 'Runtime hard-limit maxima are unavailable.', {
      missing_field: invalidField[0],
    });
  }
  return { ok: true };
};

const hasCompleteEnforcingIsolation = (attestation: RuntimeSafetyAttestation): boolean =>
  attestation.supports_cpu_limit === true &&
  attestation.supports_memory_limit === true &&
  attestation.supports_process_limit === true &&
  attestation.supports_fd_limit === true &&
  attestation.supports_workspace_disk_limit === true &&
  attestation.supports_artifact_size_limit === true &&
  attestation.supports_filesystem_containment === true &&
  attestation.supports_host_secret_isolation === true &&
  attestation.supports_network_policy === true &&
  attestation.supports_wrapper_env_isolation === true &&
  attestation.supports_process_tree_kill === true &&
  attestation.governor_provenance === 'external_sandbox' &&
  hasText(attestation.sandbox_id) &&
  hasText(attestation.sandbox_version) &&
  hasText(attestation.sandbox_binary_digest) &&
  hasText(attestation.sandbox_config_digest) &&
  hasText(attestation.sandbox_wrapper_environment_digest);

const validateFreshness = (
  attestation: RuntimeSafetyAttestation,
  nowInput: string,
  maxAgeMs = 5 * 60 * 1000,
): RuntimeSafetyAttestationValidationResult => {
  const checkedAt = Date.parse(attestation.checked_at);
  const expiresAt = attestation.expires_at === undefined ? undefined : Date.parse(attestation.expires_at);
  const now = Date.parse(nowInput);
  if (
    Number.isNaN(checkedAt) ||
    Number.isNaN(now) ||
    expiresAt === undefined ||
    Number.isNaN(expiresAt) ||
    checkedAt + maxAgeMs < now ||
    expiresAt <= now
  ) {
    return failure(400, 'runtime_safety_attestation_stale', 'Runtime safety attestation is stale.');
  }
  return { ok: true };
};

const failure = (
  httpStatus: 400 | 422,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): RuntimeSafetyAttestationValidationResult =>
  details === undefined ? { ok: false, httpStatus, code, message } : { ok: false, httpStatus, code, message, details };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRuntimeHardLimitMode = (value: unknown): value is RuntimeSafetyAttestation['hard_limit_mode'] =>
  typeof value === 'string' && hardLimitModes.has(value);

const isRuntimeEnvironment = (value: unknown): value is RuntimeSafetyAttestation['environment'] =>
  typeof value === 'string' && runtimeEnvironments.has(value);

const isNetworkMode = (value: unknown): value is RuntimeSafetyAttestation['network_mode'] =>
  typeof value === 'string' && networkModes.has(value);

const hasText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0;
