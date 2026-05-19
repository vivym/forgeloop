import type { ArtifactRef } from '@forgeloop/contracts';
import type { GeneratedPlanDraftV1 } from '@forgeloop/codex-runtime';
import type { AutomationActorClass, AutomationActionRunStatus, AutomationPrecondition, AutomationScope } from '@forgeloop/domain';

export type AutomationActionType =
  | 'ensure_spec_draft'
  | 'ensure_plan_draft'
  | 'ensure_package_drafts'
  | 'request_manual_path'
  | 'project_runtime_snapshot';

export type JsonPrimitive = string | number | boolean | null;
export type ActionInputJson = JsonPrimitive | ActionInputJson[] | { readonly [key: string]: ActionInputJson };

export interface StablePolicyObservationIdentity {
  automationScope: AutomationScope;
  repoId: string;
  policyStatus: 'missing' | 'loaded' | 'parse_failed' | 'unsafe_path';
  policyDigest?: string;
  parserVersion: string;
  reasonCode?: string;
}

export interface MutatingActionIdentity {
  actionType: Exclude<AutomationActionType, 'project_runtime_snapshot'>;
  targetObjectType: string;
  targetObjectId: string;
  targetRevisionId?: string;
  targetVersion?: number;
  automationScope: AutomationScope;
  automationSettingsVersion: number;
  capabilityFingerprint: string;
  preconditionFingerprint: string;
  generationKey?: string;
  promptVersion?: string;
  outputSchemaVersion?: string;
  generationMode?: string;
  manualPathScopeKey?: string;
  manualPathReasonCode?: string;
  policyDigest?: string;
}

export interface AutomationGenerationPlanningConfig {
  mode: 'disabled' | 'fake' | 'app_server';
  tasks: {
    spec_draft: {
      enabled: boolean;
      promptVersion: string;
      outputSchemaVersion: 'spec_draft.v1';
    };
    plan_draft: {
      enabled: boolean;
      promptVersion: string;
      outputSchemaVersion: 'plan_draft.v1';
    };
    package_drafts: {
      enabled: boolean;
      promptVersion: string;
      outputSchemaVersion: 'package_drafts.v1';
    };
  };
}

export type WorkflowPolicyDigestStatus =
  | {
      status: 'loaded';
      policyDigest: string;
      parserVersion: string;
      reasonCode?: string;
      policyPath?: string;
      observedAt?: string;
    }
  | {
      status: 'missing' | 'parse_failed' | 'unsafe_path';
      parserVersion: string;
      reasonCode: string;
      policyPath?: string;
      observedAt?: string;
      publicSummary?: string;
    };

export interface GeneratedSpecDraftV1 {
  schema_version: 'spec_draft.v1';
  summary: string;
  content: string;
  background: string;
  goals: string[];
  scope_in: string[];
  scope_out: string[];
  acceptance_criteria: string[];
  risk_notes: string[];
  test_strategy_summary: string;
  structured_document?: Record<string, unknown>;
}

export interface AutomationGenerationRepoContextV1 {
  project_id: string;
  repo_id: string;
  default_branch: string;
  policy_status: 'missing' | 'loaded' | 'parse_failed' | 'unsafe_path';
  policy_digest?: string;
  parser_version?: string;
  package_manager?: string;
  workspace_summary?: string;
}

export interface AutomationGenerationWorkItemContextV1 {
  context_version: 'generation_context.work_item.v1';
  action_run_id: string;
  work_item: {
    id: string;
    project_id: string;
    title: string;
    goal: string;
    success_criteria: string[];
    risk?: string;
    priority?: string;
    kind?: string;
  };
  repos: AutomationGenerationRepoContextV1[];
}

export interface AutomationGenerationPlanContextV1 {
  context_version: 'generation_context.plan.v1';
  action_run_id: string;
  work_item: {
    id: string;
    project_id: string;
    title: string;
    goal: string;
    success_criteria: string[];
    risk?: string;
    priority?: string;
    kind?: string;
  };
  spec_revision: {
    id: string;
    spec_id: string;
    summary: string;
    content: string;
    background: string;
    goals: string[];
    scope_in: string[];
    scope_out: string[];
    acceptance_criteria: string[];
    risk_notes: string[];
    test_strategy_summary: string;
    structured_document?: Record<string, unknown>;
  };
  repos: AutomationGenerationRepoContextV1[];
}

export interface AutomationGenerationPackageContextV1 {
  context_version: 'generation_context.package.v1';
  action_run_id: string;
  generation_key: string;
  work_item: AutomationGenerationPlanContextV1['work_item'];
  spec_revision: AutomationGenerationPlanContextV1['spec_revision'];
  plan_revision: {
    id: string;
    plan_id: string;
    summary: string;
    content: string;
    implementation_summary: string;
    split_strategy: string;
    dependency_order: string[];
    test_matrix: string[];
    risk_mitigations: string[];
    rollback_notes: string;
    structured_document?: Record<string, unknown>;
  };
  repos: AutomationGenerationRepoContextV1[];
  package_policy: {
    allowed_repo_ids: string[];
    path_policy_summary: string;
    required_check_policy_summary: string;
    source_mutation_policy_default: 'path_policy_scoped' | 'no_source_changes';
  };
}

export interface RuntimePolicyProjection extends StablePolicyObservationIdentity {
  observedAt?: string;
  lastKnownGood?: StablePolicyObservationIdentity;
}

export interface RuntimeSnapshotRepo {
  projectId: string;
  repoId: string;
  automationScope: AutomationScope;
  automationSettingsVersion: number;
  capabilityFingerprint: string;
  daemonInternalLocalPath: string;
  policyProjection?: RuntimePolicyProjection;
}

export interface RuntimeSnapshotBlocker {
  targetObjectType: string;
  targetObjectId: string;
  targetRevisionId?: string;
  repoId?: string;
  blockedReasonCode: string;
  blockedSummary: string;
  retryable: boolean;
  policyDigest?: string;
  policySnapshotVersion?: number;
  diagnosticRef?: string;
}

export interface RuntimeSnapshotTarget {
  targetObjectType: string;
  targetObjectId: string;
  targetRevisionId?: string;
  targetVersion?: number;
  targetStatus: string;
  projectId?: string;
  repoId?: string;
  eligibleRepoIds?: string[];
  automationScope: AutomationScope;
  activeHoldFingerprint?: string;
  latestMatchingActionStatus?: string;
  blockedReasonCode?: string;
  blockedSummary?: string;
  blockers?: RuntimeSnapshotBlocker[];
  generationKey?: string;
  disabledReason?: 'run_enqueue_disabled_by_scope';
}

export interface RuntimeSnapshotManualHold {
  objectType: string;
  objectId: string;
  scopeKey: string;
  reasonCode: string;
  status: string;
  requestedAt: string;
  resolvedAt?: string;
  fingerprint: string;
}

export interface RuntimeSnapshotActionRun {
  id: string;
  actionType: AutomationActionType;
  targetObjectType: string;
  targetObjectId: string;
  targetRevisionId?: string;
  targetVersion?: number;
  status: string;
  idempotencyKey: string;
  automationScope: AutomationScope;
  automationSettingsVersion?: number;
  capabilityFingerprint?: string;
  preconditionFingerprint?: string;
}

export interface RuntimeSnapshotProject {
  projectId: string;
  automationScope: AutomationScope;
  automationSettingsVersion: number;
  capabilityFingerprint: string;
}

export interface RuntimeSnapshot {
  generatedAt: string;
  projects: RuntimeSnapshotProject[];
  repos: RuntimeSnapshotRepo[];
  workItemsRequiringSpec: RuntimeSnapshotTarget[];
  workItemsRequiringPlan: RuntimeSnapshotTarget[];
  planRevisionsRequiringPackages: RuntimeSnapshotTarget[];
  runEnqueueDisabledPackages?: RuntimeSnapshotTarget[];
  activeHolds?: RuntimeSnapshotManualHold[];
  recentActionRuns: RuntimeSnapshotActionRun[];
  runEnqueueDisabledReason: string;
}

export interface NextAction {
  actionType: AutomationActionType;
  targetObjectType: string;
  targetObjectId: string;
  targetRevisionId?: string;
  targetVersion?: number;
  targetStatus: string;
  automationScope: AutomationScope;
  automationSettingsVersion: number;
  capabilityFingerprint: string;
  preconditionFingerprint: string;
  idempotencyKey: string;
  actionInputJson: ActionInputJson;
  actorClass?: AutomationActorClass;
  policyStatus?: StablePolicyObservationIdentity['policyStatus'];
  policyDigest?: string;
  parserVersion?: string;
  reasonCode?: string;
  summary?: string;
}

export interface NoAction {
  targetObjectType?: string;
  targetObjectId?: string;
  reasonCode: string;
  summary: string;
}

export interface AutomationPlannerInput {
  snapshot: RuntimeSnapshot;
}

export type AutomationExecutorResultStatus = 'succeeded' | 'failed' | 'skipped' | 'blocked' | 'gate_pending';

export interface AutomationExecutorResult {
  actionRunId: string;
  status: AutomationExecutorResultStatus;
  retryable: boolean;
  reasonCode?: string;
  summary?: string;
}

export interface AutomationActionRunRecord {
  id: string;
  actionType: AutomationActionType;
  targetObjectType: string;
  targetObjectId: string;
  targetRevisionId?: string;
  targetVersion?: number;
  targetStatus: string;
  idempotencyKey: string;
  automationScope: AutomationScope;
  automationSettingsVersion: number;
  capabilityFingerprint: string;
  preconditionFingerprint: string;
  actionInputJson: Record<string, unknown>;
  status: AutomationActionRunStatus;
  attempt: number;
  retryable?: boolean;
  nextAttemptAt?: string;
  reason?: string;
  errorCode?: string;
  claimToken?: string;
  lockedUntil?: string;
}

export interface AutomationActionResponse {
  action: AutomationActionRunRecord | null;
}

export interface ClaimNextActionInput {
  claimToken: string;
  leaseMs?: number;
  limit?: number;
  actionType?: AutomationActionType;
  projectId?: string;
  repoId?: string;
  automationScope?: AutomationScope | string;
}

export interface CompleteActionInput {
  claim_token: string;
  idempotency_key: string;
  result_json?: Record<string, unknown>;
}

export interface GatePendingActionInput {
  claim_token: string;
  idempotency_key: string;
  reason: string;
  result_json?: Record<string, unknown>;
  next_attempt_at?: string;
}

export interface BlockActionInput {
  claim_token: string;
  idempotency_key: string;
  result_json?: Record<string, unknown>;
  retryable?: boolean;
  next_attempt_at?: string;
}

export interface FailActionInput {
  claim_token: string;
  idempotency_key: string;
  result_json?: Record<string, unknown>;
  retryable: boolean;
  next_attempt_at?: string;
}

export interface EnsurePlanDraftCommandInput {
  action_run_id: string;
  claim_token?: string;
  idempotency_key: string;
  automation_precondition: AutomationPrecondition;
  spec_revision_id: string;
  generated_plan_draft: GeneratedPlanDraftV1;
  generation_artifacts: ArtifactRef[];
}

export interface EnsureSpecDraftCommandInput {
  action_run_id: string;
  claim_token?: string;
  idempotency_key: string;
  automation_precondition: AutomationPrecondition;
  generated_spec_draft: GeneratedSpecDraftV1;
  generation_artifacts: ArtifactRef[];
}

export interface EnsurePackageDraftsCommandInput {
  action_run_id: string;
  claim_token?: string;
  idempotency_key: string;
  automation_precondition: AutomationPrecondition;
  generation_key?: string;
}

export interface RequestManualPathCommandInput {
  action_run_id: string;
  claim_token?: string;
  idempotency_key: string;
  automation_precondition: AutomationPrecondition;
  object_type: string;
  object_id: string;
  scope_key: string;
  reason_code: string;
  reason: string;
  evidence_refs: [];
  requested_by: string;
  generation_key?: string;
  gate_key?: string;
}

export interface AutomationExecutorClient {
  createOrReplayAction(action: NextAction): Promise<AutomationActionResponse>;
  claimNextAction(input: ClaimNextActionInput): Promise<AutomationActionResponse>;
  completeAction(actionRunId: string, input: CompleteActionInput): Promise<AutomationActionResponse>;
  gatePendingAction(actionRunId: string, input: GatePendingActionInput): Promise<AutomationActionResponse>;
  blockAction(actionRunId: string, input: BlockActionInput): Promise<AutomationActionResponse>;
  failAction(actionRunId: string, input: FailActionInput): Promise<AutomationActionResponse>;
  specDraftGenerationContext(
    workItemId: string,
    input: { actionRunId: string; claimToken: string },
  ): Promise<AutomationGenerationWorkItemContextV1>;
  planDraftGenerationContext(
    workItemId: string,
    input: { specRevisionId: string; actionRunId: string; claimToken: string },
  ): Promise<AutomationGenerationPlanContextV1>;
  packageDraftsGenerationContext(
    planRevisionId: string,
    input: { generationKey: string; actionRunId: string; claimToken: string },
  ): Promise<AutomationGenerationPackageContextV1>;
  ensureSpecDraft(workItemId: string, input: EnsureSpecDraftCommandInput): Promise<unknown>;
  ensurePlanDraft(workItemId: string, input: EnsurePlanDraftCommandInput): Promise<unknown>;
  ensurePackageDrafts(planRevisionId: string, input: EnsurePackageDraftsCommandInput): Promise<unknown>;
  requestManualPathHold(input: RequestManualPathCommandInput): Promise<unknown>;
}
