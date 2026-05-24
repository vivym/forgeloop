import { createHash } from 'node:crypto';

import type { ArtifactRef } from '@forgeloop/contracts';
import type { IsoDateTime } from './types.js';
import { DomainError, type WorkItem, type ReviewPacket, type RunSession } from './types.js';

export type AutomationPreset = 'off' | 'ready_projection' | 'draft_only' | 'run_enqueue';

export type AutomationActorClass =
  | 'human_admin'
  | 'human'
  | 'system_bootstrap'
  | 'migration'
  | 'automation_daemon'
  | 'source_adapter'
  | 'external_tracker'
  | 'repo_policy';

export interface AutomationCapabilities {
  canProjectRuntimeState: boolean;
  canGeneratePackageDrafts: boolean;
  canEnqueueRuns: boolean;
}

export interface AutomationActorContext {
  actor_class: AutomationActorClass;
  actor_id: string;
  daemon_identity?: string;
  source?: string;
}

export type AutomationPreconditionCapability = keyof AutomationCapabilities;

export type AutomationScope = `project:${string}` | `repo:${string}:${string}`;

export interface AutomationPrecondition {
  automation_scope: AutomationScope;
  project_id: string;
  repo_id?: string;
  target_object_type?: string;
  target_object_id?: string;
  target_revision_id?: string;
  target_version?: number;
  target_status?: string;
  automation_settings_version: number;
  capability_fingerprint: string;
  active_hold_fingerprint?: string;
  required_capability: AutomationPreconditionCapability;
  command_concurrency_token?: string;
  actor_class: AutomationActorClass;
  daemon_identity?: string;
}

export type RuntimeHardLimitMode = 'unavailable' | 'test_only_mock' | 'enforcing';

export type RuntimeSafetyEnvironment = 'production' | 'local_dogfood' | 'test';

export type RuntimeGovernorProvenance = 'external_sandbox' | 'test_only_mock' | 'unavailable';

export type RuntimeSafetyAttestationScope = 'enqueue_preflight' | 'run_execution';

export type NetworkMode = 'disabled' | 'egress_allowlist';

export type SourceMutationPolicy = 'path_policy_scoped' | 'no_source_changes';

export type PolicySnapshotOrigin = 'workflow_md' | 'reviewed_safe_default';

export interface ResourceLimitVector {
  readonly cpu_ms: number;
  readonly memory_mb: number;
  readonly pids: number;
  readonly fds: number;
  readonly workspace_bytes: number;
  readonly artifact_bytes: number;
  readonly timeout_ms: number;
  readonly output_limit_bytes: number;
  readonly run_output_limit_bytes: number;
}

export interface SafeDefaultApprovalEvidence {
  evidence_type: 'decision' | 'artifact' | 'object_event';
  ref_id: string;
  approved_by_actor_id: string;
  approved_by_actor_class: AutomationActorClass;
  approved_at: IsoDateTime;
  summary: string;
}

export interface RuntimeSafetyAttestation {
  attestation_scope?: RuntimeSafetyAttestationScope;
  hard_limit_mode: RuntimeHardLimitMode;
  environment: RuntimeSafetyEnvironment;
  executor_type: string;
  workflow_only: boolean;
  governor_id: string;
  governor_provenance: RuntimeGovernorProvenance;
  checked_at: IsoDateTime;
  max_command_timeout_ms: number;
  max_hook_timeout_ms: number;
  max_command_output_bytes: number;
  max_run_output_bytes: number;
  supports_cpu_limit: boolean;
  supports_memory_limit: boolean;
  supports_process_limit: boolean;
  supports_fd_limit: boolean;
  supports_workspace_disk_limit: boolean;
  supports_artifact_size_limit: boolean;
  network_mode?: NetworkMode;
  project_id?: string;
  repo_id?: string;
  execution_package_id?: string;
  expected_package_version?: number;
  run_id?: string;
  policy_digest?: string;
  policy_snapshot_version?: number;
  env_policy_digest?: string;
  command_policy_digest?: string;
  mount_policy_digest?: string;
  network_policy_digest?: string;
  resource_limit_digest?: string;
  resource_limits?: ResourceLimitVector;
  sandbox_id?: string;
  sandbox_version?: string;
  sandbox_binary_digest?: string;
  sandbox_config_digest?: string;
  sandbox_wrapper_environment_digest?: string;
  workspace_root?: string;
  artifact_root?: string;
  sandbox_output_root?: string;
  supports_filesystem_containment?: boolean;
  supports_host_secret_isolation?: boolean;
  supports_network_policy?: boolean;
  supports_wrapper_env_isolation?: boolean;
  supports_process_tree_kill?: boolean;
  expires_at?: IsoDateTime;
  reason_code?: string;
}

export type ValidationStrategy = 'checks_required' | 'allow_all_repo' | 'custom';

export type PackagePolicySnapshotStatus = 'captured' | 'missing' | 'stale' | 'superseded';

export interface PackageRuntimePolicySnapshot {
  snapshot_origin?: PolicySnapshotOrigin;
  policy_snapshot_version: number;
  policy_digest: string;
  policy_source_path: string;
  policy_loaded_at: IsoDateTime;
  policy_last_known_good: boolean;
  normalized_policy_payload?: Record<string, unknown>;
  hooks: unknown;
  command_policy: unknown;
  check_policy: unknown;
  env_policy: unknown;
  workspace_policy?: unknown;
  path_policy: unknown;
  codex_runtime_mode: unknown;
  prompt_policy?: unknown;
  artifact_visibility_policy?: unknown;
  fallback_policy: unknown;
  env_policy_digest?: string;
  command_policy_digest?: string;
  mount_policy_digest?: string;
  network_policy_digest?: string;
  safe_git_profile?: 'forgeloop_default';
  safe_default_approval_evidence?: SafeDefaultApprovalEvidence;
  source_mutation_policy: SourceMutationPolicy;
  validation_strategy: ValidationStrategy;
  validation_public_summary: string;
  policy_snapshot_status?: PackagePolicySnapshotStatus;
  frozen_hook_specs?: { before_run: readonly unknown[]; after_run: readonly unknown[] };
  frozen_command_check_policy?: Record<string, unknown>;
  frozen_env_policy?: Record<string, unknown>;
  frozen_codex_runtime_mode?: string;
  validation_strategy_version?: number;
  validation_evidence_refs?: ArtifactRef[];
}

export interface EnqueuePreflightAttestationBinding {
  executorType: string;
  workflowOnly: boolean;
  executionPackageId: string;
  expectedPackageVersion: number;
  projectId: string;
  repoId: string;
  policySnapshot?: PackageRuntimePolicySnapshot;
  policySnapshotVersion?: number;
  maxAgeMs?: number;
}

export type RuntimeSafetyAttestationValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: string;
      message: string;
      httpStatus: 400 | 422;
      details?: Record<string, unknown>;
    };

export interface AutomationProjectSettings {
  id: string;
  project_id: string;
  repo_id?: string;
  preset: AutomationPreset;
  capabilities_json: AutomationCapabilities;
  capability_fingerprint: string;
  scope_type: 'project' | 'repo';
  version: number;
  enabled_by?: string;
  enabled_at?: IsoDateTime;
  updated_by?: string;
  updated_at?: IsoDateTime;
  reason?: string;
  evidence_refs: ArtifactRef[];
}

export interface ManualPathHold {
  id: string;
  object_type: string;
  object_id: string;
  scope_key: string;
  status: 'active' | 'resolved' | 'cancelled';
  reason_code: string;
  reason: string;
  source_automation_action_id?: string;
  evidence_refs: ArtifactRef[];
  requested_by: string;
  requested_at: IsoDateTime;
  resolved_by?: string;
  resolved_at?: IsoDateTime;
  resolution?: string;
  metadata_json?: Record<string, unknown>;
}

export interface CommandIdempotencyRecord {
  id: string;
  command_name: string;
  idempotency_key: string;
  target_object_type: string;
  target_object_id: string;
  target_revision_id?: string;
  target_version?: number;
  precondition_json?: Record<string, unknown>;
  precondition_fingerprint?: string;
  actor_scope?: string;
  result_json?: Record<string, unknown>;
  status: 'running' | 'succeeded' | 'failed' | 'skipped' | 'blocked';
  locked_until?: IsoDateTime;
  last_heartbeat_at?: IsoDateTime;
  claim_token?: string;
  created_by?: string;
  started_at?: IsoDateTime;
  finished_at?: IsoDateTime;
  created_at?: IsoDateTime;
  updated_at?: IsoDateTime;
}

export type AutomationActionRunStatus = 'pending' | 'running' | 'gate_pending' | 'succeeded' | 'failed' | 'skipped' | 'blocked';

export interface AutomationActionRun {
  id: string;
  action_type: string;
  target_object_type: string;
  target_object_id: string;
  target_revision_id?: string;
  target_version?: number;
  target_status: string;
  idempotency_key: string;
  automation_scope: AutomationScope;
  automation_settings_version: number;
  capability_fingerprint: string;
  precondition_fingerprint: string;
  action_input_json: Record<string, unknown>;
  status: AutomationActionRunStatus;
  claim_token?: string;
  attempt: number;
  locked_until?: IsoDateTime;
  last_heartbeat_at?: IsoDateTime;
  next_attempt_at?: IsoDateTime;
  retryable?: boolean;
  result_json?: Record<string, unknown>;
  metadata_json?: Record<string, unknown>;
  reason?: string;
  error_code?: string;
  error_message?: string;
  policy_digest?: string;
  created_by?: string;
  claimed_at?: IsoDateTime;
  started_at?: IsoDateTime;
  finished_at?: IsoDateTime;
  created_at?: IsoDateTime;
  updated_at?: IsoDateTime;
}

export interface ExecutionPackageGenerationRun {
  execution_package_set_id: string;
  plan_revision_id: string;
  generation_key: string;
  version: number;
  generator_version?: string;
  policy_digest?: string;
  manifest_digest?: string;
  expected_package_count?: number;
  expected_package_keys?: string[];
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'skipped' | 'superseded';
  result_json?: Record<string, unknown>;
  locked_until?: IsoDateTime;
  last_heartbeat_at?: IsoDateTime;
  claim_token?: string;
  superseded_by?: string;
  superseded_at?: IsoDateTime;
  superseded_reason?: string;
  supersede_command_id?: string;
  evidence_refs?: ArtifactRef[];
  next_generation_key?: string;
  completed_at?: IsoDateTime;
  created_at?: IsoDateTime;
  updated_at?: IsoDateTime;
}

const automationCapabilityByPreset: Record<AutomationPreset, AutomationCapabilities> = {
  off: {
    canProjectRuntimeState: false,
    canGeneratePackageDrafts: false,
    canEnqueueRuns: false,
  },
  ready_projection: {
    canProjectRuntimeState: true,
    canGeneratePackageDrafts: false,
    canEnqueueRuns: false,
  },
  draft_only: {
    canProjectRuntimeState: true,
    canGeneratePackageDrafts: true,
    canEnqueueRuns: false,
  },
  run_enqueue: {
    canProjectRuntimeState: true,
    canGeneratePackageDrafts: true,
    canEnqueueRuns: true,
  },
};

const hasText = (value: string): boolean => value.trim().length > 0;

const automationActorClasses = new Set<AutomationActorClass>([
  'human_admin',
  'human',
  'system_bootstrap',
  'migration',
  'automation_daemon',
  'source_adapter',
  'external_tracker',
  'repo_policy',
]);

const automationCapabilityRejectedActorClasses = new Set<AutomationActorClass>([
  'automation_daemon',
  'source_adapter',
  'external_tracker',
  'repo_policy',
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeForFingerprint = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForFingerprint(item));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((accumulator, key) => {
      accumulator[key] = normalizeForFingerprint(value[key]);
      return accumulator;
    }, {});
};

const fingerprint = (value: unknown): string => {
  const normalized = normalizeForFingerprint(value);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
};

const ensureNonBlank = (label: string, value: string): void => {
  if (!hasText(value) || value.trim() !== value) {
    throw new DomainError('MANUAL_PATH_SCOPE_INVALID', `${label} must be a canonical non-blank string`, {
      label,
      value,
    });
  }
};

export const normalizeAutomationCapabilities = (
  value: Partial<AutomationCapabilities> | undefined,
): AutomationCapabilities => ({
  canProjectRuntimeState: value?.canProjectRuntimeState === true,
  canGeneratePackageDrafts: value?.canGeneratePackageDrafts === true,
  canEnqueueRuns: value?.canEnqueueRuns === true,
});

export const automationCapabilitiesForPreset = (preset: AutomationPreset): AutomationCapabilities =>
  normalizeAutomationCapabilities(automationCapabilityByPreset[preset]);

export const assertAutomationCapabilityActor = (actor: AutomationActorContext): void => {
  if (!hasText(actor.actor_id)) {
    throw new DomainError('AUTOMATION_CAPABILITY_REJECTED', 'Automation capability updates require a non-empty actor id.', {
      actor_class: actor.actor_class,
    });
  }

  if (!automationActorClasses.has(actor.actor_class) || automationCapabilityRejectedActorClasses.has(actor.actor_class)) {
    throw new DomainError('AUTOMATION_CAPABILITY_REJECTED', `Actor class ${actor.actor_class} cannot update automation capabilities.`, {
      actor_class: actor.actor_class,
      actor_id: actor.actor_id,
    });
  }
};

export const capabilityFingerprint = (capabilities: AutomationCapabilities): string =>
  fingerprint(normalizeAutomationCapabilities(capabilities));

export const buildManualScopeKey = (
  scope:
    | { object_type: 'work_item'; object_id: string }
    | { object_type: 'spec_revision'; object_id: string }
    | { object_type: 'plan_revision'; object_id: string }
    | { object_type: 'package_generation'; object_id: string; generation_key: string }
    | { object_type: 'execution_package'; object_id: string }
    | { object_type: 'run_session'; object_id: string }
    | { object_type: 'review_packet'; object_id: string }
    | { object_type: 'release_gate'; object_id: string; gate_key: string },
): string => {
  ensureNonBlank('object_id', scope.object_id);

  switch (scope.object_type) {
    case 'work_item':
    case 'spec_revision':
    case 'plan_revision':
    case 'execution_package':
    case 'run_session':
    case 'review_packet':
      return `${scope.object_type}:${scope.object_id}`;
    case 'package_generation':
      ensureNonBlank('generation_key', scope.generation_key);
      return `${scope.object_type}:${scope.object_id}:${scope.generation_key}`;
    case 'release_gate':
      ensureNonBlank('gate_key', scope.gate_key);
      return `${scope.object_type}:${scope.object_id}:${scope.gate_key}`;
  }
};

export const assertCanonicalManualScopeKey = (
  scopeKey: string,
  scope:
    | { object_type: 'work_item'; object_id: string }
    | { object_type: 'spec_revision'; object_id: string }
    | { object_type: 'plan_revision'; object_id: string }
    | { object_type: 'package_generation'; object_id: string; generation_key: string }
    | { object_type: 'execution_package'; object_id: string }
    | { object_type: 'run_session'; object_id: string }
    | { object_type: 'review_packet'; object_id: string }
    | { object_type: 'release_gate'; object_id: string; gate_key: string },
): void => {
  const canonicalScopeKey = buildManualScopeKey(scope);
  if (scopeKey !== canonicalScopeKey) {
    throw new DomainError('MANUAL_PATH_SCOPE_INVALID', 'Manual path scope key must be canonical for the target object.', {
      scope_key: scopeKey,
      canonical_scope_key: canonicalScopeKey,
    });
  }
};

export const automationPreconditionFingerprint = (precondition: AutomationPrecondition): string => fingerprint(precondition);

export const resourceLimitDigest = (vector: ResourceLimitVector): string => `sha256:${fingerprint(validateResourceLimitVector(vector))}`;

export const validateResourceLimitVector = (value: unknown): ResourceLimitVector => {
  if (!isResourceLimitVector(value)) {
    throw new Error('Resource limit vector must contain exactly the supported positive integer fields.');
  }
  return resourceLimitKeys.reduce<Record<keyof ResourceLimitVector, number>>((accumulator, key) => {
    accumulator[key] = value[key];
    return accumulator;
  }, {} as Record<keyof ResourceLimitVector, number>);
};

export const validateEnqueuePreflightAttestation = (input: {
  attestation: RuntimeSafetyAttestation | undefined;
  expected: EnqueuePreflightAttestationBinding;
  now: string;
}): RuntimeSafetyAttestationValidationResult => {
  const attestation = input.attestation;
  if (
    !isAttestationObject(attestation) ||
    !isRuntimeHardLimitMode(attestation.hard_limit_mode) ||
    attestation.hard_limit_mode === 'unavailable'
  ) {
    return runtimeSafetyFailure(422, 'runtime_hard_limits_unavailable', 'Runtime hard limits are unavailable.');
  }

  if (attestation.attestation_scope !== 'enqueue_preflight') {
    return runtimeSafetyFailure(400, 'runtime_safety_attestation_scope_invalid', 'Run enqueue requires an enqueue_preflight runtime safety attestation.');
  }
  if (attestation.executor_type !== input.expected.executorType || attestation.workflow_only !== input.expected.workflowOnly) {
    return runtimeSafetyFailure(400, 'runtime_safety_attestation_mismatch', 'Runtime safety attestation does not match the enqueue request.');
  }
  if (!isRuntimeSafetyEnvironment(attestation.environment)) {
    return runtimeSafetyFailure(400, 'runtime_safety_attestation_mismatch', 'Runtime safety attestation environment is invalid.');
  }
  if (attestation.project_id !== input.expected.projectId || attestation.repo_id !== input.expected.repoId) {
    return runtimeSafetyFailure(400, 'runtime_safety_attestation_mismatch', 'Runtime safety attestation does not match the package scope.');
  }
  if (
    attestation.execution_package_id !== input.expected.executionPackageId ||
    attestation.expected_package_version !== input.expected.expectedPackageVersion
  ) {
    return runtimeSafetyFailure(
      400,
      'runtime_safety_attestation_package_mismatch',
      'Runtime safety attestation does not match the execution package version.',
    );
  }

  const requiredDigests = [
    ['policy_digest', attestation.policy_digest],
    ['env_policy_digest', attestation.env_policy_digest],
    ['command_policy_digest', attestation.command_policy_digest],
    ['mount_policy_digest', attestation.mount_policy_digest],
    ['network_policy_digest', attestation.network_policy_digest],
  ] as const;
  const missingDigest = requiredDigests.find(([, value]) => !isNonBlankString(value));
  if (missingDigest !== undefined || !isFiniteNonNegativeInteger(attestation.policy_snapshot_version)) {
    return runtimeSafetyFailure(400, 'runtime_policy_attestation_digest_missing', 'Run enqueue requires package policy snapshot digests.', {
      missing_field: missingDigest?.[0] ?? 'policy_snapshot_version',
    });
  }
  if (
    input.expected.policySnapshot === undefined ||
    !isFiniteNonNegativeInteger(input.expected.policySnapshotVersion) ||
    input.expected.policySnapshot.policy_snapshot_version !== input.expected.policySnapshotVersion
  ) {
    return runtimeSafetyFailure(400, 'runtime_policy_snapshot_missing', 'Run enqueue requires a captured package policy snapshot.');
  }

  const mismatchedDigest = (
    [
      ['policy_digest', attestation.policy_digest, input.expected.policySnapshot.policy_digest],
      ['env_policy_digest', attestation.env_policy_digest, input.expected.policySnapshot.env_policy_digest],
      ['command_policy_digest', attestation.command_policy_digest, input.expected.policySnapshot.command_policy_digest],
      ['mount_policy_digest', attestation.mount_policy_digest, input.expected.policySnapshot.mount_policy_digest],
      ['network_policy_digest', attestation.network_policy_digest, input.expected.policySnapshot.network_policy_digest],
    ] as const
  ).find(([, actual, expected]) => actual !== expected);
  if (attestation.policy_snapshot_version !== input.expected.policySnapshotVersion || mismatchedDigest !== undefined) {
    return runtimeSafetyFailure(
      400,
      'runtime_policy_attestation_digest_mismatch',
      'Runtime safety attestation does not match the captured package policy snapshot.',
      { mismatched_field: mismatchedDigest?.[0] ?? 'policy_snapshot_version' },
    );
  }

  const expectedNetworkMode = input.expected.policySnapshot.network_policy_digest === 'network-disabled' ? 'disabled' : 'egress_allowlist';
  if (!isRuntimeNetworkMode(attestation.network_mode) || attestation.network_mode !== expectedNetworkMode) {
    return runtimeSafetyFailure(
      400,
      'runtime_safety_attestation_mismatch',
      'Runtime safety attestation network mode does not match the captured package policy snapshot.',
    );
  }

  const resourceLimitValidation = validateAttestedResourceLimits(attestation);
  if (!resourceLimitValidation.ok) {
    return resourceLimitValidation;
  }

  if ((attestation.environment === 'production' || input.expected.executorType === 'local_codex') && attestation.hard_limit_mode !== 'enforcing') {
    return runtimeSafetyFailure(
      400,
      'runtime_hard_limits_not_enforcing',
      'Production and local Codex run enqueue require enforcing runtime hard limits.',
    );
  }
  if (attestation.hard_limit_mode === 'enforcing' && !hasCompleteEnforcingIsolation(attestation)) {
    return runtimeSafetyFailure(
      400,
      'runtime_hard_limits_not_enforcing',
      'Production and local Codex run enqueue require complete runtime hard-limit and sandbox isolation support.',
    );
  }
  if (
    attestation.hard_limit_mode === 'test_only_mock' &&
    !(
      input.expected.executorType === 'mock' &&
      input.expected.workflowOnly === true &&
      (attestation.environment === 'test' || attestation.environment === 'local_dogfood') &&
      attestation.governor_provenance === 'test_only_mock'
    )
  ) {
    return runtimeSafetyFailure(
      400,
      'runtime_test_only_mock_forbidden',
      'test_only_mock runtime safety attestation is only valid for mock workflow-only local/test runs.',
    );
  }

  const freshness = validateAttestationFreshness(attestation, input.now, input.expected.maxAgeMs);
  if (!freshness.ok) {
    return freshness;
  }

  return { ok: true };
};

export const isOpenReviewPacketStatus = (status: ReviewPacket['status']): boolean =>
  status === 'draft' || status === 'ready' || status === 'in_review' || status === 'escalated';

export const isActiveRunSessionStatus = (status: RunSession['status']): boolean =>
  status === 'queued' ||
  status === 'running' ||
  status === 'waiting_for_input' ||
  status === 'stalled' ||
  status === 'resuming' ||
  status === 'cancel_requested';

export const isWorkItemAutomationTerminal = (
  workItem: Pick<WorkItem, 'phase' | 'resolution' | 'archived_at' | 'deleted_at'>,
): boolean =>
  workItem.phase === 'done' ||
  workItem.phase === 'closed' ||
  workItem.resolution !== 'none' ||
  workItem.archived_at !== undefined ||
  workItem.deleted_at !== undefined;

const runtimeHardLimitModes = new Set<RuntimeHardLimitMode>(['unavailable', 'test_only_mock', 'enforcing']);
const runtimeSafetyEnvironments = new Set<RuntimeSafetyEnvironment>(['production', 'local_dogfood', 'test']);
const runtimeNetworkModes = new Set<NetworkMode>(['disabled', 'egress_allowlist']);
const resourceLimitKeys = [
  'cpu_ms',
  'memory_mb',
  'pids',
  'fds',
  'workspace_bytes',
  'artifact_bytes',
  'timeout_ms',
  'output_limit_bytes',
  'run_output_limit_bytes',
] as const satisfies ReadonlyArray<keyof ResourceLimitVector>;

const runtimeSafetyFailure = (
  httpStatus: 400 | 422,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): RuntimeSafetyAttestationValidationResult =>
  details === undefined ? { ok: false, httpStatus, code, message } : { ok: false, httpStatus, code, message, details };

const isAttestationObject = (value: unknown): value is RuntimeSafetyAttestation => isPlainObject(value);

const isRuntimeHardLimitMode = (value: unknown): value is RuntimeHardLimitMode =>
  typeof value === 'string' && runtimeHardLimitModes.has(value as RuntimeHardLimitMode);

const isRuntimeSafetyEnvironment = (value: unknown): value is RuntimeSafetyEnvironment =>
  typeof value === 'string' && runtimeSafetyEnvironments.has(value as RuntimeSafetyEnvironment);

const isRuntimeNetworkMode = (value: unknown): value is NetworkMode =>
  typeof value === 'string' && runtimeNetworkModes.has(value as NetworkMode);

const isNonBlankString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const isFiniteNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;

const isFinitePositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0;

const isResourceLimitVector = (value: unknown): value is ResourceLimitVector => {
  if (!isPlainObject(value)) {
    return false;
  }
  const actualKeys = Object.keys(value);
  if (actualKeys.length !== resourceLimitKeys.length || actualKeys.some((key) => !resourceLimitKeys.includes(key as keyof ResourceLimitVector))) {
    return false;
  }
  return resourceLimitKeys.every((key) => isFinitePositiveInteger(value[key]));
};

const validateAttestedResourceLimits = (attestation: RuntimeSafetyAttestation): RuntimeSafetyAttestationValidationResult => {
  if (!isSha256Digest(attestation.resource_limit_digest)) {
    return runtimeSafetyFailure(400, 'runtime_resource_limit_digest_missing', 'Run enqueue requires a resource limit digest.');
  }
  let resourceLimits: ResourceLimitVector;
  try {
    resourceLimits = validateResourceLimitVector(attestation.resource_limits);
  } catch {
    return runtimeSafetyFailure(400, 'runtime_resource_limits_missing', 'Run enqueue requires resource limit details.');
  }
  if (resourceLimitDigest(resourceLimits) !== attestation.resource_limit_digest) {
    return runtimeSafetyFailure(
      400,
      'runtime_resource_limit_digest_mismatch',
      'Runtime safety attestation resource limit digest does not match resource limits.',
    );
  }
  const hardMaxValidation = validateAttestedHardMaxima(attestation);
  if (!hardMaxValidation.ok) {
    return hardMaxValidation;
  }
  if (
    resourceLimits.timeout_ms > attestation.max_command_timeout_ms ||
    resourceLimits.output_limit_bytes > attestation.max_command_output_bytes ||
    resourceLimits.run_output_limit_bytes > attestation.max_run_output_bytes
  ) {
    return runtimeSafetyFailure(
      400,
      'runtime_resource_limits_exceed_hard_max',
      'Runtime resource limits exceed the attested hard maxima.',
    );
  }
  return { ok: true };
};

const validateAttestedHardMaxima = (attestation: RuntimeSafetyAttestation): RuntimeSafetyAttestationValidationResult => {
  const hardMaxFields = [
    ['max_command_timeout_ms', attestation.max_command_timeout_ms],
    ['max_hook_timeout_ms', attestation.max_hook_timeout_ms],
    ['max_command_output_bytes', attestation.max_command_output_bytes],
    ['max_run_output_bytes', attestation.max_run_output_bytes],
  ] as const;
  const invalidField = hardMaxFields.find(([, value]) => !isFinitePositiveInteger(value));
  if (invalidField !== undefined) {
    return runtimeSafetyFailure(422, 'runtime_hard_limits_unavailable', 'Runtime hard-limit maxima are unavailable.', {
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
  isNonBlankString(attestation.sandbox_id) &&
  isNonBlankString(attestation.sandbox_version) &&
  isNonBlankString(attestation.sandbox_binary_digest) &&
  isNonBlankString(attestation.sandbox_config_digest) &&
  isNonBlankString(attestation.sandbox_wrapper_environment_digest);

const validateAttestationFreshness = (
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
    (expiresAt !== undefined && Number.isNaN(expiresAt)) ||
    checkedAt + maxAgeMs < now ||
    (expiresAt !== undefined && expiresAt <= now)
  ) {
    return runtimeSafetyFailure(400, 'runtime_safety_attestation_stale', 'Runtime safety attestation is stale.');
  }
  return { ok: true };
};

const isSha256Digest = (value: unknown): value is string => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
