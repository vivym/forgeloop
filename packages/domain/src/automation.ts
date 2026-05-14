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
  canGeneratePlanDraft: boolean;
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
  automation_settings_version: number;
  capability_fingerprint: string;
  required_capability: AutomationPreconditionCapability;
  actor_class: AutomationActorClass;
  daemon_identity?: string;
}

export type RuntimeHardLimitMode = 'unavailable' | 'test_only_mock' | 'enforcing';

export type RuntimeSafetyEnvironment = 'production' | 'local_dogfood' | 'test';

export type RuntimeGovernorProvenance = 'external_sandbox' | 'test_only_mock' | 'unavailable';

export interface RuntimeSafetyAttestation {
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
  reason_code?: string;
}

export type ValidationStrategy = 'checks_required' | 'allow_all_repo' | 'custom';

export type PackagePolicySnapshotStatus = 'captured' | 'missing' | 'stale' | 'superseded';

export interface PackageRuntimePolicySnapshot {
  policy_snapshot_version: number;
  policy_digest: string;
  policy_source_path: string;
  policy_loaded_at: IsoDateTime;
  policy_last_known_good: boolean;
  hooks: unknown;
  command_policy: unknown;
  check_policy: unknown;
  env_policy: unknown;
  path_policy: unknown;
  codex_runtime_mode: unknown;
  fallback_policy: unknown;
  validation_strategy: ValidationStrategy;
  validation_public_summary: string;
  policy_snapshot_status?: PackagePolicySnapshotStatus;
  frozen_hook_specs?: readonly unknown[];
  frozen_command_check_policy?: Record<string, unknown>;
  frozen_env_policy?: Record<string, unknown>;
  frozen_codex_runtime_mode?: string;
  validation_strategy_version?: number;
  validation_evidence_refs?: ArtifactRef[];
}

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
  target_status: string;
  idempotency_key: string;
  automation_scope: AutomationScope;
  automation_settings_version: number;
  capability_fingerprint: string;
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
  evidence_refs?: ArtifactRef[];
  next_generation_key?: string;
  completed_at?: IsoDateTime;
  created_at?: IsoDateTime;
  updated_at?: IsoDateTime;
}

const automationCapabilityByPreset: Record<AutomationPreset, AutomationCapabilities> = {
  off: {
    canProjectRuntimeState: false,
    canGeneratePlanDraft: false,
    canGeneratePackageDrafts: false,
    canEnqueueRuns: false,
  },
  ready_projection: {
    canProjectRuntimeState: true,
    canGeneratePlanDraft: false,
    canGeneratePackageDrafts: false,
    canEnqueueRuns: false,
  },
  draft_only: {
    canProjectRuntimeState: true,
    canGeneratePlanDraft: true,
    canGeneratePackageDrafts: true,
    canEnqueueRuns: false,
  },
  run_enqueue: {
    canProjectRuntimeState: true,
    canGeneratePlanDraft: true,
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

export const automationCapabilitiesForPreset = (preset: AutomationPreset): AutomationCapabilities => ({
  ...automationCapabilityByPreset[preset],
});

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

export const capabilityFingerprint = (capabilities: AutomationCapabilities): string => fingerprint(capabilities);

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
