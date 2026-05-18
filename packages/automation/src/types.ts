import type { AutomationActorClass, AutomationActionRunStatus, AutomationPrecondition, AutomationScope } from '@forgeloop/domain';

export type AutomationActionType =
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
  manualPathScopeKey?: string;
  manualPathReasonCode?: string;
  policyDigest?: string;
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
  ensurePlanDraft(workItemId: string, input: EnsurePlanDraftCommandInput): Promise<unknown>;
  ensurePackageDrafts(planRevisionId: string, input: EnsurePackageDraftsCommandInput): Promise<unknown>;
  requestManualPathHold(input: RequestManualPathCommandInput): Promise<unknown>;
}
