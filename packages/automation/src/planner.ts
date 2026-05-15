import { createHash } from 'node:crypto';

import type { AutomationPreconditionCapability, AutomationScope } from '@forgeloop/domain';

import { mutatingActionIdempotencyKey, projectRuntimeSnapshotIdempotencyKey } from './idempotency.js';
import type {
  ActionInputJson,
  AutomationActionType,
  NextAction,
  RuntimePolicyProjection,
  RuntimeSnapshot,
  RuntimeSnapshotRepo,
  RuntimeSnapshotTarget,
  StablePolicyObservationIdentity,
} from './types.js';

const suppressingStatuses = new Set(['pending', 'running', 'succeeded']);

type CanonicalJsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

const canonicalize = (value: CanonicalJsonValue): CanonicalJsonValue => {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : canonicalize(item)));
  }

  const record = value as { readonly [key: string]: CanonicalJsonValue };
  return Object.keys(record)
    .sort()
    .reduce<Record<string, CanonicalJsonValue>>((accumulator, key) => {
      const item = record[key];
      if (item !== undefined) {
        accumulator[key] = canonicalize(item);
      }
      return accumulator;
    }, {});
};

const canonicalHash = (value: CanonicalJsonValue): string =>
  createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');

const projectIdFromScope = (automationScope: AutomationScope): string => {
  const [, projectId] = automationScope.split(':');
  return projectId ?? '';
};

const repoIdFromScope = (automationScope: AutomationScope): string | undefined => {
  const [scopeType, , repoId] = automationScope.split(':');
  return scopeType === 'repo' ? repoId : undefined;
};

const hasSuppressingAction = (snapshot: RuntimeSnapshot, idempotencyKey: string): boolean =>
  snapshot.recentActionRuns.some(
    (actionRun) => actionRun.idempotencyKey === idempotencyKey && suppressingStatuses.has(actionRun.status),
  );

const matchingReposForTarget = (snapshot: RuntimeSnapshot, target: RuntimeSnapshotTarget): RuntimeSnapshotRepo[] => {
  if (target.repoId !== undefined) {
    return snapshot.repos.filter(
      (repo) =>
        repo.projectId === (target.projectId ?? projectIdFromScope(target.automationScope)) &&
        repo.repoId === target.repoId &&
        repo.automationScope === target.automationScope,
    );
  }

  return snapshot.repos.filter((repo) => repo.projectId === (target.projectId ?? projectIdFromScope(target.automationScope)));
};

const projectSettingsFor = (snapshot: RuntimeSnapshot, target: RuntimeSnapshotTarget) => {
  const exact = snapshot.projects.find((project) => project.automationScope === target.automationScope);
  if (exact !== undefined) {
    return exact;
  }
  const projectId = target.projectId ?? projectIdFromScope(target.automationScope);
  const repoFallback = snapshot.repos.find((repo) => repo.projectId === projectId);
  if (repoFallback === undefined) {
    return undefined;
  }
  return {
    projectId,
    automationScope: target.automationScope,
    automationSettingsVersion: repoFallback.automationSettingsVersion,
    capabilityFingerprint: repoFallback.capabilityFingerprint,
  };
};

const targetPreconditionFingerprint = (
  target: RuntimeSnapshotTarget,
  input: {
    automationScope: AutomationScope;
    automationSettingsVersion: number;
    capabilityFingerprint: string;
    requiredCapability: AutomationPreconditionCapability;
    commandConcurrencyToken?: string;
  },
): string =>
  {
    const repoId = target.repoId ?? repoIdFromScope(input.automationScope);
    return canonicalHash({
      automation_scope: input.automationScope,
      project_id: target.projectId ?? projectIdFromScope(input.automationScope),
      ...(repoId === undefined ? {} : { repo_id: repoId }),
      target_object_type: target.targetObjectType,
      target_object_id: target.targetObjectId,
      target_revision_id: target.targetRevisionId,
      target_version: target.targetVersion,
      target_status: target.targetStatus,
      automation_settings_version: input.automationSettingsVersion,
      capability_fingerprint: input.capabilityFingerprint,
      active_hold_fingerprint: target.activeHoldFingerprint,
      required_capability: input.requiredCapability,
      command_concurrency_token: input.commandConcurrencyToken,
      actor_class: 'automation_daemon',
    });
  };

const requestManualPathForAmbiguity = (snapshot: RuntimeSnapshot, target: RuntimeSnapshotTarget): NextAction | undefined => {
  const settings = projectSettingsFor(snapshot, target);
  if (settings === undefined) {
    return undefined;
  }

  const scopeKey = `${target.targetObjectType}:${target.targetObjectId}`;
  const actionInputJson = {
    object_type: target.targetObjectType,
    object_id: target.targetObjectId,
    scope_key: scopeKey,
    reason_code: 'multi_repo_ambiguity',
    reason: `Automation target ${target.targetObjectType}:${target.targetObjectId} matches multiple repos; choose the canonical path manually.`,
  } satisfies ActionInputJson;
  const preconditionFingerprint = targetPreconditionFingerprint(target, {
    automationScope: settings.automationScope,
    automationSettingsVersion: settings.automationSettingsVersion,
    capabilityFingerprint: settings.capabilityFingerprint,
    requiredCapability: target.targetObjectType === 'plan_revision' ? 'canGeneratePackageDrafts' : 'canGeneratePlanDraft',
    commandConcurrencyToken: `${scopeKey}:multi_repo_ambiguity`,
  });
  const idempotencyKey = mutatingActionIdempotencyKey({
    actionType: 'request_manual_path',
    targetObjectType: target.targetObjectType,
    targetObjectId: target.targetObjectId,
    ...(target.targetRevisionId === undefined ? {} : { targetRevisionId: target.targetRevisionId }),
    ...(target.targetVersion === undefined ? {} : { targetVersion: target.targetVersion }),
    automationScope: settings.automationScope,
    automationSettingsVersion: settings.automationSettingsVersion,
    capabilityFingerprint: settings.capabilityFingerprint,
    preconditionFingerprint,
    manualPathScopeKey: scopeKey,
    manualPathReasonCode: 'multi_repo_ambiguity',
  });
  if (hasSuppressingAction(snapshot, idempotencyKey)) {
    return undefined;
  }

  return {
    actionType: 'request_manual_path',
    targetObjectType: target.targetObjectType,
    targetObjectId: target.targetObjectId,
    ...(target.targetRevisionId === undefined ? {} : { targetRevisionId: target.targetRevisionId }),
    ...(target.targetVersion === undefined ? {} : { targetVersion: target.targetVersion }),
    targetStatus: target.targetStatus,
    automationScope: settings.automationScope,
    automationSettingsVersion: settings.automationSettingsVersion,
    capabilityFingerprint: settings.capabilityFingerprint,
    preconditionFingerprint,
    idempotencyKey,
    actionInputJson,
    actorClass: 'automation_daemon',
    reasonCode: 'multi_repo_ambiguity',
    summary: `Target ${target.targetObjectType}:${target.targetObjectId} matches multiple repos.`,
  };
};

const mutatingActionForTarget = (
  snapshot: RuntimeSnapshot,
  target: RuntimeSnapshotTarget,
  actionType: Extract<AutomationActionType, 'ensure_plan_draft' | 'ensure_package_drafts'>,
  requiredCapability: AutomationPreconditionCapability,
): NextAction | undefined => {
  if (target.activeHoldFingerprint !== undefined) {
    return undefined;
  }
  const repos = matchingReposForTarget(snapshot, target);
  if (repos.length > 1 && target.repoId === undefined) {
    return requestManualPathForAmbiguity(snapshot, target);
  }
  const repo = repos[0];
  if (repo === undefined) {
    return undefined;
  }

  const generationKey = actionType === 'ensure_package_drafts' ? (target.generationKey ?? target.targetRevisionId) : undefined;
  if (actionType === 'ensure_plan_draft' && target.targetRevisionId === undefined) {
    return undefined;
  }
  if (actionType === 'ensure_package_drafts' && generationKey === undefined) {
    return undefined;
  }
  const preconditionFingerprint = targetPreconditionFingerprint(target, {
    automationScope: repo.automationScope,
    automationSettingsVersion: repo.automationSettingsVersion,
    capabilityFingerprint: repo.capabilityFingerprint,
    requiredCapability,
    ...(generationKey === undefined ? {} : { commandConcurrencyToken: generationKey }),
  });
  const actionInputJson =
    actionType === 'ensure_plan_draft'
      ? ({
          work_item_id: target.targetObjectId,
          spec_revision_id: target.targetRevisionId ?? '',
        } satisfies ActionInputJson)
      : ({
          plan_revision_id: target.targetObjectId,
          generation_key: generationKey ?? '',
        } satisfies ActionInputJson);
  const idempotencyKey = mutatingActionIdempotencyKey({
    actionType,
    targetObjectType: target.targetObjectType,
    targetObjectId: target.targetObjectId,
    ...(target.targetRevisionId === undefined ? {} : { targetRevisionId: target.targetRevisionId }),
    ...(target.targetVersion === undefined ? {} : { targetVersion: target.targetVersion }),
    automationScope: repo.automationScope,
    automationSettingsVersion: repo.automationSettingsVersion,
    capabilityFingerprint: repo.capabilityFingerprint,
    preconditionFingerprint,
    ...(generationKey === undefined ? {} : { generationKey }),
  });
  if (hasSuppressingAction(snapshot, idempotencyKey)) {
    return undefined;
  }

  return {
    actionType,
    targetObjectType: target.targetObjectType,
    targetObjectId: target.targetObjectId,
    ...(target.targetRevisionId === undefined ? {} : { targetRevisionId: target.targetRevisionId }),
    ...(target.targetVersion === undefined ? {} : { targetVersion: target.targetVersion }),
    targetStatus: target.targetStatus,
    automationScope: repo.automationScope,
    automationSettingsVersion: repo.automationSettingsVersion,
    capabilityFingerprint: repo.capabilityFingerprint,
    preconditionFingerprint,
    idempotencyKey,
    actionInputJson,
    actorClass: 'automation_daemon',
  };
};

const stableProjectionIdentity = (projection: RuntimePolicyProjection): StablePolicyObservationIdentity => ({
  automationScope: projection.automationScope,
  repoId: projection.repoId,
  policyStatus: projection.policyStatus,
  ...(projection.policyDigest === undefined ? {} : { policyDigest: projection.policyDigest }),
  parserVersion: projection.parserVersion,
  ...(projection.reasonCode === undefined ? {} : { reasonCode: projection.reasonCode }),
});

const projectRuntimeSnapshotAction = (snapshot: RuntimeSnapshot, repo: RuntimeSnapshotRepo): NextAction | undefined => {
  const projection = repo.policyProjection;
  if (projection === undefined) {
    return undefined;
  }
  const identity = stableProjectionIdentity(projection);
  const idempotencyKey = projectRuntimeSnapshotIdempotencyKey(identity);
  if (hasSuppressingAction(snapshot, idempotencyKey)) {
    return undefined;
  }
  const actionInputJson = {
    repo_id: identity.repoId,
    policy_status: identity.policyStatus,
    ...(identity.policyDigest === undefined ? {} : { policy_digest: identity.policyDigest }),
    parser_version: identity.parserVersion,
    ...(identity.reasonCode === undefined ? {} : { reason_code: identity.reasonCode }),
  } satisfies ActionInputJson;

  return {
    actionType: 'project_runtime_snapshot',
    targetObjectType: 'repo',
    targetObjectId: repo.repoId,
    targetStatus: identity.policyStatus,
    automationScope: repo.automationScope,
    automationSettingsVersion: repo.automationSettingsVersion,
    capabilityFingerprint: repo.capabilityFingerprint,
    preconditionFingerprint: idempotencyKey,
    idempotencyKey,
    actionInputJson,
    actorClass: 'automation_daemon',
    policyStatus: identity.policyStatus,
    ...(identity.policyDigest === undefined ? {} : { policyDigest: identity.policyDigest }),
    parserVersion: identity.parserVersion,
    ...(identity.reasonCode === undefined ? {} : { reasonCode: identity.reasonCode }),
  };
};

export const planNextActions = (snapshot: RuntimeSnapshot): NextAction[] => {
  const actions: NextAction[] = [];

  for (const target of snapshot.workItemsRequiringPlan) {
    const action = mutatingActionForTarget(snapshot, target, 'ensure_plan_draft', 'canGeneratePlanDraft');
    if (action !== undefined) {
      actions.push(action);
    }
  }

  for (const target of snapshot.planRevisionsRequiringPackages) {
    const action = mutatingActionForTarget(snapshot, target, 'ensure_package_drafts', 'canGeneratePackageDrafts');
    if (action !== undefined) {
      actions.push(action);
    }
  }

  for (const repo of snapshot.repos) {
    const action = projectRuntimeSnapshotAction(snapshot, repo);
    if (action !== undefined) {
      actions.push(action);
    }
  }

  return actions;
};
