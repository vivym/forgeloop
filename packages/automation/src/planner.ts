import {
  automationPreconditionFingerprint,
  type AutomationPrecondition,
  type AutomationPreconditionCapability,
  type AutomationScope,
} from '@forgeloop/domain';

import { mutatingActionIdempotencyKey, projectRuntimeSnapshotIdempotencyKey } from './idempotency.js';
import {
  specDraftOutputSchemaVersion,
  specDraftPromptVersion,
} from './spec-draft-generation.js';
import type {
  ActionInputJson,
  AutomationGenerationPlanningConfig,
  AutomationActionType,
  NextAction,
  RuntimePolicyProjection,
  RuntimeSnapshot,
  RuntimeSnapshotRepo,
  RuntimeSnapshotTarget,
  StablePolicyObservationIdentity,
} from './types.js';

const suppressingStatuses = new Set(['pending', 'running', 'succeeded']);

export interface AutomationPlannerOptions {
  generation?: AutomationGenerationPlanningConfig;
}

const freezeGenerationPlanningConfig = (config: AutomationGenerationPlanningConfig): AutomationGenerationPlanningConfig => {
  Object.freeze(config.tasks.spec_draft);
  Object.freeze(config.tasks.plan_draft);
  Object.freeze(config.tasks.package_drafts);
  Object.freeze(config.tasks);
  return Object.freeze(config);
};

export const defaultGenerationPlanningConfig: AutomationGenerationPlanningConfig = freezeGenerationPlanningConfig({
  mode: 'disabled',
  tasks: {
    spec_draft: {
      enabled: false,
      promptVersion: specDraftPromptVersion,
      outputSchemaVersion: specDraftOutputSchemaVersion,
    },
    plan_draft: {
      enabled: false,
      promptVersion: 'plan-draft.fake.v1',
      outputSchemaVersion: 'plan_draft.v1',
    },
    package_drafts: {
      enabled: false,
      promptVersion: 'package-drafts.fake.v1',
      outputSchemaVersion: 'package_drafts.v1',
    },
  },
});

type GenerationTaskName = keyof AutomationGenerationPlanningConfig['tasks'];
type GenerationTaskConfig = AutomationGenerationPlanningConfig['tasks'][GenerationTaskName];

const generationPlanningFor = (options?: AutomationPlannerOptions): AutomationGenerationPlanningConfig =>
  options?.generation ?? defaultGenerationPlanningConfig;

const generationTaskFor = (
  config: AutomationGenerationPlanningConfig,
  task: GenerationTaskName,
): GenerationTaskConfig => (config.mode === 'disabled' ? { ...config.tasks[task], enabled: false } : config.tasks[task]);

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

const manualPathSettingsFor = (snapshot: RuntimeSnapshot, target: RuntimeSnapshotTarget) => {
  const projectId = target.projectId ?? projectIdFromScope(target.automationScope);
  const eligibleRepoIds = new Set(target.eligibleRepoIds ?? []);
  const repoFallback = snapshot.repos.find(
    (repo) => repo.projectId === projectId && (eligibleRepoIds.size === 0 || eligibleRepoIds.has(repo.repoId)),
  );
  if (target.repoId === undefined && repoFallback !== undefined) {
    // Ambiguous targets are project-scoped, but the repo capability is what made the target eligible.
    return {
      projectId,
      automationScope: repoFallback.automationScope,
      automationSettingsVersion: repoFallback.automationSettingsVersion,
      capabilityFingerprint: repoFallback.capabilityFingerprint,
    };
  }
  const exact = snapshot.projects.find((project) => project.automationScope === target.automationScope);
  if (exact !== undefined) {
    return exact;
  }
  if (repoFallback === undefined) {
    return undefined;
  }
  return repoFallback;
};

const targetPrecondition = (
  target: RuntimeSnapshotTarget,
  input: {
    automationScope: AutomationScope;
    automationSettingsVersion: number;
    capabilityFingerprint: string;
    requiredCapability: AutomationPreconditionCapability;
    commandConcurrencyToken?: string;
  },
): AutomationPrecondition => {
  const repoId = target.repoId ?? repoIdFromScope(input.automationScope);
  return {
    automation_scope: input.automationScope,
    project_id: target.projectId ?? projectIdFromScope(input.automationScope),
    ...(repoId === undefined ? {} : { repo_id: repoId }),
    target_object_type: target.targetObjectType,
    target_object_id: target.targetObjectId,
    ...(target.targetRevisionId === undefined ? {} : { target_revision_id: target.targetRevisionId }),
    ...(target.targetVersion === undefined ? {} : { target_version: target.targetVersion }),
    target_status: target.targetStatus,
    automation_settings_version: input.automationSettingsVersion,
    capability_fingerprint: input.capabilityFingerprint,
    required_capability: input.requiredCapability,
    ...(input.commandConcurrencyToken === undefined ? {} : { command_concurrency_token: input.commandConcurrencyToken }),
    actor_class: 'automation_daemon',
  };
};

const requestManualPathForAmbiguity = (snapshot: RuntimeSnapshot, target: RuntimeSnapshotTarget): NextAction | undefined => {
  const settings = manualPathSettingsFor(snapshot, target);
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
  const precondition = targetPrecondition(target, {
    automationScope: settings.automationScope,
    automationSettingsVersion: settings.automationSettingsVersion,
    capabilityFingerprint: settings.capabilityFingerprint,
    requiredCapability: 'canGeneratePackageDrafts',
    commandConcurrencyToken: `${scopeKey}:multi_repo_ambiguity`,
  });
  const preconditionFingerprint = automationPreconditionFingerprint(precondition);
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
  actionType: Extract<AutomationActionType, 'ensure_package_drafts'>,
  requiredCapability: AutomationPreconditionCapability,
  generation: AutomationGenerationPlanningConfig,
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

  const generationKey = target.generationKey ?? target.targetRevisionId;
  if (generationKey === undefined) {
    return undefined;
  }
  const precondition = targetPrecondition(target, {
    automationScope: repo.automationScope,
    automationSettingsVersion: repo.automationSettingsVersion,
    capabilityFingerprint: repo.capabilityFingerprint,
    requiredCapability,
    ...(generationKey === undefined ? {} : { commandConcurrencyToken: generationKey }),
  });
  const preconditionFingerprint = automationPreconditionFingerprint(precondition);
  const generationTask = generationTaskFor(generation, 'package_drafts');
  const actionInputJson = {
    plan_revision_id: target.targetObjectId,
    generation_key: generationKey,
    prompt_version: generationTask.promptVersion,
    output_schema_version: generationTask.outputSchemaVersion,
  } satisfies ActionInputJson;
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
    generationKey,
    generationMode: generation.mode,
    promptVersion: generationTask.promptVersion,
    outputSchemaVersion: generationTask.outputSchemaVersion,
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

export const planNextActions = (snapshot: RuntimeSnapshot, options: AutomationPlannerOptions = {}): NextAction[] => {
  const actions: NextAction[] = [];
  const generation = generationPlanningFor(options);
  const appendProjectRuntimeSnapshotActions = (): void => {
    for (const repo of snapshot.repos) {
      const action = projectRuntimeSnapshotAction(snapshot, repo);
      if (action !== undefined) {
        actions.push(action);
      }
    }
  };

  if (generation.mode === 'app_server') {
    appendProjectRuntimeSnapshotActions();
  }

  if (generationTaskFor(generation, 'package_drafts').enabled) {
    for (const target of snapshot.planRevisionsRequiringPackages) {
      const action = mutatingActionForTarget(
        snapshot,
        target,
        'ensure_package_drafts',
        'canGeneratePackageDrafts',
        generation,
      );
      if (action !== undefined) {
        actions.push(action);
      }
    }
  }

  if (generation.mode !== 'app_server') {
    appendProjectRuntimeSnapshotActions();
  }

  return actions;
};
