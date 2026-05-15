import type { AutomationActorClass, AutomationScope } from '@forgeloop/domain';

export type AutomationActionType =
  | 'ensure_plan_draft'
  | 'ensure_package_drafts'
  | 'request_manual_path'
  | 'project_runtime_snapshot';

export type JsonPrimitive = string | number | boolean | null;
export type ActionInputJson = JsonPrimitive | ActionInputJson[] | { readonly [key: string]: ActionInputJson };

export interface StablePolicyObservationIdentity {
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
  policyDigest?: string;
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

export interface RuntimeSnapshotTarget {
  targetObjectType: string;
  targetObjectId: string;
  targetRevisionId?: string;
  targetVersion?: number;
  targetStatus: string;
  projectId?: string;
  repoId?: string;
  automationScope: AutomationScope;
  activeHoldFingerprint?: string;
  latestMatchingActionStatus?: string;
  blockedReasonCode?: string;
  blockedSummary?: string;
  generationKey?: string;
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
