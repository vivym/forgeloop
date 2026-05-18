import { createHash } from 'node:crypto';

import {
  DomainError,
  type ExecutionPackage,
  type ExecutionPackageDependency,
  type Project,
  type ReviewPacket,
} from './types.js';
import { isOpenReviewPacketStatus } from './automation.js';

export interface ExecutionPackageValidationOptions {
  referenced_repo_ids?: readonly string[];
}

const hasText = (value: string) => value.trim().length > 0;

const readyOrRunEligiblePhases = new Set<ExecutionPackage['phase']>([
  'ready',
  'queued',
  'execution',
  'review',
  'integration',
  'test_gate',
  'release',
]);

const hasApprovalEvidence = (executionPackage: ExecutionPackage): boolean =>
  hasText(executionPackage.validation_approved_by ?? '') &&
  hasText(executionPackage.validation_approved_at ?? '') &&
  (executionPackage.validation_evidence_refs?.length ?? 0) > 0;

const isFiniteNonNegativeInteger = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && Number.isInteger(value) && value >= 0;

const sourceMutationPolicies = new Set(['path_policy_scoped', 'no_source_changes']);

const isSourceMutationPolicy = (value: unknown): value is ExecutionPackage['source_mutation_policy'] =>
  typeof value === 'string' && sourceMutationPolicies.has(value);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringArrayProperty = (value: unknown, key: string): string[] | undefined => {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const property = value[key];
  return Array.isArray(property) && property.every((item) => typeof item === 'string') ? property : undefined;
};

const stringProperty = (value: unknown, key: string): string | undefined => {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const property = value[key];
  return typeof property === 'string' ? property : undefined;
};

const objectIsEmpty = (value: unknown): boolean => isPlainObject(value) && Object.keys(value).length === 0;

const objectHasExactKeys = (value: object, keys: readonly string[]): boolean => {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
};

type CanonicalJsonValue = null | boolean | number | string | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue };

const compareCodeUnits = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const canonicalize = (value: unknown): CanonicalJsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isPlainObject(value)) {
    return Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .reduce<Record<string, CanonicalJsonValue>>((accumulator, [key, entry]) => {
        accumulator[key] = canonicalize(entry);
        return accumulator;
      }, {});
  }
  return null;
};

const stableJson = (value: unknown): string => JSON.stringify(canonicalize(value));

const digest = (value: unknown): string => `sha256:${createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex')}`;

const hardDefaultTimeoutMs = 120_000;
const hardDefaultOutputLimitBytes = 1_000_000;

const pathPolicyIsDenyAll = (pathPolicy: unknown): boolean => {
  if (!isPlainObject(pathPolicy) || !objectHasExactKeys(pathPolicy, ['allowed_paths', 'forbidden_paths'])) {
    return false;
  }

  const allowedPaths = stringArrayProperty(pathPolicy, 'allowed_paths');
  const forbiddenPaths = stringArrayProperty(pathPolicy, 'forbidden_paths');
  return allowedPaths !== undefined && forbiddenPaths !== undefined && allowedPaths.length === 0 && forbiddenPaths.length === 0;
};

const arrayPropertyLength = (value: unknown, key: string): number | undefined => {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const property = value[key];
  return Array.isArray(property) ? property.length : undefined;
};

const hookSpecsAreEmpty = (hooks: unknown): boolean => {
  if (!isPlainObject(hooks) || !objectHasExactKeys(hooks, ['before_run', 'after_run'])) {
    return false;
  }

  return arrayPropertyLength(hooks, 'before_run') === 0 && arrayPropertyLength(hooks, 'after_run') === 0;
};

const frozenHookSpecsAreEmpty = (hooks: unknown): boolean => {
  if (!isPlainObject(hooks) || !objectHasExactKeys(hooks, ['before_run', 'after_run'])) {
    return false;
  }

  const beforeRun = hooks.before_run;
  const afterRun = hooks.after_run;
  return Array.isArray(beforeRun) && beforeRun.length === 0 && Array.isArray(afterRun) && afterRun.length === 0;
};

const frozenHookSpecsAreObject = (hooks: unknown): boolean => {
  if (!isPlainObject(hooks) || !objectHasExactKeys(hooks, ['before_run', 'after_run'])) {
    return false;
  }

  return Array.isArray(hooks.before_run) && Array.isArray(hooks.after_run);
};

const fallbackIsDisabled = (fallbackPolicy: unknown): boolean =>
  isPlainObject(fallbackPolicy) && objectHasExactKeys(fallbackPolicy, ['mode']) && fallbackPolicy.mode === 'disabled';

const safeDefaultSourceWritePolicies = new Set(['read_only', 'artifact_only']);

const frozenCommandChecksAreReadOnlyOrArtifactOnly = (checkPolicy: unknown): boolean => {
  if (checkPolicy === undefined) {
    return true;
  }
  if (!isPlainObject(checkPolicy) || !Array.isArray(checkPolicy.required_checks)) {
    return false;
  }

  return checkPolicy.required_checks.every((check) => {
    if (!isPlainObject(check)) {
      return false;
    }

    const checkSourceWritePolicy = check.source_write_policy;
    const commandSourceWritePolicy = isPlainObject(check.command) ? check.command.source_write_policy : undefined;
    return [checkSourceWritePolicy, commandSourceWritePolicy].every(
      (sourceWritePolicy) =>
        sourceWritePolicy === undefined || (typeof sourceWritePolicy === 'string' && safeDefaultSourceWritePolicies.has(sourceWritePolicy)),
    );
  });
};

const envAllowlistIsEmpty = (envPolicy: unknown): boolean => {
  if (!isPlainObject(envPolicy)) {
    return false;
  }

  return objectHasExactKeys(envPolicy, ['allow']) && stringArrayProperty(envPolicy, 'allow')?.length === 0;
};

const networkIsDisabled = (snapshot: NonNullable<ExecutionPackage['package_policy_snapshot']>): boolean =>
  snapshot.network_policy_digest === 'network-disabled' &&
  (isPlainObject(snapshot.codex_runtime_mode) &&
    objectHasExactKeys(snapshot.codex_runtime_mode, ['primary_executor', 'network_mode']) &&
    ['cli', 'app_server', 'mock'].includes(stringProperty(snapshot.codex_runtime_mode, 'primary_executor') ?? '') &&
    snapshot.codex_runtime_mode.network_mode === 'disabled');

const artifactVisibilityIsInternal = (artifactVisibilityPolicy: unknown): boolean =>
  isPlainObject(artifactVisibilityPolicy) &&
  objectHasExactKeys(artifactVisibilityPolicy, ['default_visibility']) &&
  artifactVisibilityPolicy.default_visibility === 'internal';

const safeDefaultEvidenceTypes = new Set(['decision', 'artifact', 'object_event']);
const safeDefaultApprovalActorClasses = new Set(['human', 'human_admin', 'system_bootstrap']);

const hasSafeDefaultApprovalEvidence = (
  evidence: NonNullable<ExecutionPackage['package_policy_snapshot']>['safe_default_approval_evidence'],
): boolean =>
  isPlainObject(evidence) &&
  objectHasExactKeys(evidence, [
    'evidence_type',
    'ref_id',
    'approved_by_actor_id',
    'approved_by_actor_class',
    'approved_at',
    'summary',
  ]) &&
  safeDefaultEvidenceTypes.has(stringProperty(evidence, 'evidence_type') ?? '') &&
  safeDefaultApprovalActorClasses.has(stringProperty(evidence, 'approved_by_actor_class') ?? '') &&
  hasText(stringProperty(evidence, 'ref_id') ?? '') &&
  hasText(stringProperty(evidence, 'approved_by_actor_id') ?? '') &&
  hasText(stringProperty(evidence, 'approved_at') ?? '') &&
  hasText(stringProperty(evidence, 'summary') ?? '');

const normalizedPayloadRepresentsMissingWorkflow = (payload: unknown): boolean =>
  isPlainObject(payload) &&
  objectHasExactKeys(payload, [
    'parser_version',
    'policy_source_path',
    'normalized_front_matter',
    'normalized_markdown_body',
    'normalized_body_digest',
    'normalized_payload_digest',
  ]) &&
  stringProperty(payload, 'policy_source_path') === 'WORKFLOW.md' &&
  objectIsEmpty(payload.normalized_front_matter) &&
  stringProperty(payload, 'normalized_markdown_body') === '' &&
  hasText(stringProperty(payload, 'parser_version') ?? '') &&
  hasText(stringProperty(payload, 'normalized_body_digest') ?? '') &&
  hasText(stringProperty(payload, 'normalized_payload_digest') ?? '');

const validationEvidenceRefsAreEmpty = (
  refs: NonNullable<ExecutionPackage['package_policy_snapshot']>['validation_evidence_refs'],
): boolean => refs === undefined || (Array.isArray(refs) && refs.length === 0);

const normalizedPayloadDigestMatches = (
  snapshot: NonNullable<ExecutionPackage['package_policy_snapshot']>,
): boolean => {
  const payload = snapshot.normalized_policy_payload;
  if (
    !isPlainObject(payload) ||
    !objectHasExactKeys(payload, [
      'parser_version',
      'policy_source_path',
      'normalized_front_matter',
      'normalized_markdown_body',
      'normalized_body_digest',
      'normalized_payload_digest',
    ])
  ) {
    return false;
  }

  const parserVersion = stringProperty(payload, 'parser_version');
  const policySourcePath = stringProperty(payload, 'policy_source_path');
  const normalizedMarkdownBody = stringProperty(payload, 'normalized_markdown_body');
  const normalizedBodyDigest = stringProperty(payload, 'normalized_body_digest');
  const normalizedPayloadDigest = stringProperty(payload, 'normalized_payload_digest');
  if (
    policySourcePath !== 'WORKFLOW.md' ||
    !hasText(parserVersion ?? '') ||
    !isPlainObject(payload.normalized_front_matter) ||
    normalizedMarkdownBody === undefined ||
    !hasText(normalizedBodyDigest ?? '') ||
    !hasText(normalizedPayloadDigest ?? '')
  ) {
    return false;
  }

  const recomputedBodyDigest = digest(normalizedMarkdownBody);
  const recomputedPayloadDigest = digest({
    parser_version: parserVersion,
    policy_source_path: policySourcePath,
    normalized_front_matter: payload.normalized_front_matter,
    normalized_markdown_body: normalizedMarkdownBody,
    normalized_body_digest: normalizedBodyDigest,
  });

  return (
    normalizedBodyDigest === recomputedBodyDigest &&
    normalizedPayloadDigest === recomputedPayloadDigest &&
    snapshot.policy_digest === normalizedPayloadDigest
  );
};

const networkPolicyDigest = (codexRuntimeMode: unknown): string | undefined => {
  if (!isPlainObject(codexRuntimeMode)) {
    return undefined;
  }
  const networkMode = stringProperty(codexRuntimeMode, 'network_mode');
  if (networkMode === 'disabled') {
    return 'network-disabled';
  }
  if (networkMode === 'egress_allowlist') {
    const egressAllowlistDigest = stringProperty(codexRuntimeMode, 'egress_allowlist_digest');
    return hasText(egressAllowlistDigest ?? '')
      ? digest({ network_mode: 'egress_allowlist', egress_allowlist_digest: egressAllowlistDigest })
      : undefined;
  }
  return undefined;
};

const runtimePolicySectionDigestsMatch = (
  snapshot: NonNullable<ExecutionPackage['package_policy_snapshot']>,
): boolean => {
  const sourceSnapshot = isPlainObject(snapshot.workspace_policy) ? snapshot.workspace_policy.source_snapshot : undefined;
  return (
    snapshot.env_policy_digest === digest({ environment: snapshot.env_policy }) &&
    snapshot.command_policy_digest ===
      digest({
        commands: snapshot.command_policy,
        defaults: { timeout_ms: hardDefaultTimeoutMs, output_limit_bytes: hardDefaultOutputLimitBytes },
      }) &&
    snapshot.mount_policy_digest ===
      digest({
        workspace: snapshot.workspace_policy,
        artifacts: snapshot.artifact_visibility_policy,
        source_snapshot: sourceSnapshot,
      }) &&
    snapshot.network_policy_digest === networkPolicyDigest(snapshot.codex_runtime_mode)
  );
};

const runtimePolicyObjectIsFrozen = (snapshot: NonNullable<ExecutionPackage['package_policy_snapshot']>): boolean =>
  snapshot.snapshot_origin === 'workflow_md' &&
  snapshot.policy_source_path === 'WORKFLOW.md' &&
  normalizedPayloadDigestMatches(snapshot) &&
  runtimePolicySectionDigestsMatch(snapshot) &&
  isPlainObject(snapshot.hooks) &&
  isPlainObject(snapshot.command_policy) &&
  isPlainObject(snapshot.check_policy) &&
  isPlainObject(snapshot.env_policy) &&
  isPlainObject(snapshot.workspace_policy) &&
  isPlainObject(snapshot.path_policy) &&
  isPlainObject(snapshot.codex_runtime_mode) &&
  isPlainObject(snapshot.prompt_policy) &&
  isPlainObject(snapshot.artifact_visibility_policy) &&
  isPlainObject(snapshot.fallback_policy) &&
  hasText(snapshot.env_policy_digest ?? '') &&
  hasText(snapshot.command_policy_digest ?? '') &&
  hasText(snapshot.mount_policy_digest ?? '') &&
  hasText(snapshot.network_policy_digest ?? '') &&
  snapshot.safe_git_profile === 'forgeloop_default' &&
  isPlainObject(snapshot.frozen_command_check_policy) &&
  Array.isArray(snapshot.frozen_command_check_policy.required_checks) &&
  frozenHookSpecsAreObject(snapshot.frozen_hook_specs);

const validateExecutionPackagePolicy = (executionPackage: ExecutionPackage): void => {
  if (!readyOrRunEligiblePhases.has(executionPackage.phase)) {
    return;
  }

  const effectiveValidationStrategy = executionPackage.validation_strategy ?? 'checks_required';
  const sourceMutationPolicy = executionPackage.source_mutation_policy;

  if (!isSourceMutationPolicy(sourceMutationPolicy)) {
    throw new DomainError(
      'EXECUTION_PACKAGE_POLICY_INVALID',
      `Package ${executionPackage.id} must use a valid source mutation policy before ${executionPackage.phase}.`,
      {
        execution_package_id: executionPackage.id,
        phase: executionPackage.phase,
        source_mutation_policy: sourceMutationPolicy,
      },
    );
  }

  if (sourceMutationPolicy === 'path_policy_scoped' && executionPackage.allowed_paths.length === 0) {
    throw new DomainError(
      'EXECUTION_PACKAGE_POLICY_INVALID',
      `Package ${executionPackage.id} requires allowed paths for source mutation.`,
      { execution_package_id: executionPackage.id },
    );
  }

  if (executionPackage.policy_snapshot_status !== 'captured') {
    throw new DomainError(
      'EXECUTION_PACKAGE_POLICY_INVALID',
      `Package ${executionPackage.id} must capture a policy snapshot before ${executionPackage.phase}.`,
      {
        execution_package_id: executionPackage.id,
        phase: executionPackage.phase,
        policy_snapshot_status: executionPackage.policy_snapshot_status,
      },
    );
  }

  if (executionPackage.package_policy_snapshot === undefined) {
    throw new DomainError(
      'EXECUTION_PACKAGE_POLICY_INVALID',
      `Package ${executionPackage.id} must include a captured policy snapshot before ${executionPackage.phase}.`,
      {
        execution_package_id: executionPackage.id,
        phase: executionPackage.phase,
      },
    );
  }

  if (!isFiniteNonNegativeInteger(executionPackage.policy_snapshot_version)) {
    throw new DomainError(
      'EXECUTION_PACKAGE_POLICY_INVALID',
      `Package ${executionPackage.id} must use a valid policy snapshot version before ${executionPackage.phase}.`,
      {
        execution_package_id: executionPackage.id,
        phase: executionPackage.phase,
        policy_snapshot_version: executionPackage.policy_snapshot_version,
      },
    );
  }

  if (executionPackage.package_policy_snapshot.policy_snapshot_version !== executionPackage.policy_snapshot_version) {
    throw new DomainError(
      'EXECUTION_PACKAGE_POLICY_INVALID',
      `Package ${executionPackage.id} must align its policy snapshot metadata before ${executionPackage.phase}.`,
      {
        execution_package_id: executionPackage.id,
        phase: executionPackage.phase,
        policy_snapshot_version: executionPackage.policy_snapshot_version,
        package_policy_snapshot_version: executionPackage.package_policy_snapshot.policy_snapshot_version,
      },
    );
  }

  if (
    executionPackage.package_policy_snapshot.policy_snapshot_status !== undefined &&
    executionPackage.package_policy_snapshot.policy_snapshot_status !== 'captured'
  ) {
    throw new DomainError(
      'EXECUTION_PACKAGE_POLICY_INVALID',
      `Package ${executionPackage.id} must use a captured policy snapshot before ${executionPackage.phase}.`,
      {
        execution_package_id: executionPackage.id,
        phase: executionPackage.phase,
        package_policy_snapshot_status: executionPackage.package_policy_snapshot.policy_snapshot_status,
      },
    );
  }

  if (executionPackage.package_policy_snapshot.validation_strategy !== effectiveValidationStrategy) {
    throw new DomainError(
      'EXECUTION_PACKAGE_POLICY_INVALID',
      `Package ${executionPackage.id} must freeze the effective validation strategy before ${executionPackage.phase}.`,
      {
        execution_package_id: executionPackage.id,
        phase: executionPackage.phase,
        validation_strategy: effectiveValidationStrategy,
        package_policy_snapshot_validation_strategy: executionPackage.package_policy_snapshot.validation_strategy,
      },
    );
  }

  if (
    !isSourceMutationPolicy(executionPackage.package_policy_snapshot.source_mutation_policy) ||
    executionPackage.package_policy_snapshot.source_mutation_policy !== sourceMutationPolicy
  ) {
    throw new DomainError(
      'EXECUTION_PACKAGE_POLICY_INVALID',
      `Package ${executionPackage.id} must align source mutation policy with its snapshot.`,
      { execution_package_id: executionPackage.id },
    );
  }

  const snapshot = executionPackage.package_policy_snapshot;
  if (snapshot.snapshot_origin === 'reviewed_safe_default') {
    const safeDefaultValid =
      snapshot.policy_source_path === 'WORKFLOW.md' &&
      normalizedPayloadDigestMatches(snapshot) &&
      normalizedPayloadRepresentsMissingWorkflow(snapshot.normalized_policy_payload) &&
      effectiveValidationStrategy === 'checks_required' &&
      snapshot.validation_strategy === 'checks_required' &&
      validationEvidenceRefsAreEmpty(snapshot.validation_evidence_refs) &&
      sourceMutationPolicy === 'no_source_changes' &&
      snapshot.source_mutation_policy === 'no_source_changes' &&
      executionPackage.allowed_paths.length === 0 &&
      pathPolicyIsDenyAll(snapshot.path_policy) &&
      frozenCommandChecksAreReadOnlyOrArtifactOnly(snapshot.frozen_command_check_policy) &&
      hookSpecsAreEmpty(snapshot.hooks) &&
      frozenHookSpecsAreEmpty(snapshot.frozen_hook_specs) &&
      fallbackIsDisabled(snapshot.fallback_policy) &&
      envAllowlistIsEmpty(snapshot.env_policy) &&
      networkIsDisabled(snapshot) &&
      runtimePolicySectionDigestsMatch(snapshot) &&
      artifactVisibilityIsInternal(snapshot.artifact_visibility_policy) &&
      snapshot.safe_git_profile === 'forgeloop_default' &&
      hasSafeDefaultApprovalEvidence(snapshot.safe_default_approval_evidence);

    if (!safeDefaultValid) {
      throw new DomainError(
        'EXECUTION_PACKAGE_POLICY_INVALID',
        `Package ${executionPackage.id} has an invalid reviewed safe-default policy snapshot.`,
        { execution_package_id: executionPackage.id },
      );
    }
  } else if (!runtimePolicyObjectIsFrozen(snapshot)) {
    throw new DomainError(
      'EXECUTION_PACKAGE_POLICY_INVALID',
      `Package ${executionPackage.id} has an invalid frozen runtime policy snapshot.`,
      { execution_package_id: executionPackage.id },
    );
  }

  if (executionPackage.validation_strategy === 'allow_all_repo' && !hasApprovalEvidence(executionPackage)) {
    throw new DomainError(
      'EXECUTION_PACKAGE_POLICY_INVALID',
      `Package ${executionPackage.id} requires reviewed approval before allow_all_repo can run.`,
      {
        execution_package_id: executionPackage.id,
        validation_strategy: executionPackage.validation_strategy,
      },
    );
  }

  if (
    executionPackage.validation_strategy === 'custom' &&
    (!hasText(executionPackage.validation_public_summary ?? '') ||
      !isFiniteNonNegativeInteger(executionPackage.validation_strategy_version))
  ) {
    throw new DomainError(
      'EXECUTION_PACKAGE_POLICY_INVALID',
      `Package ${executionPackage.id} requires a frozen custom validation strategy before ${executionPackage.phase}.`,
      {
        execution_package_id: executionPackage.id,
        validation_strategy: executionPackage.validation_strategy,
        validation_strategy_version: executionPackage.validation_strategy_version,
      },
    );
  }
};

export const validateRepoBelongsToProject = (project: Project, repoId: string): void => {
  if (!project.repo_ids.includes(repoId)) {
    throw new DomainError('REPO_NOT_BOUND', `Repo ${repoId} is not bound to project ${project.id}`, {
      project_id: project.id,
      repo_id: repoId,
    });
  }
};

export const validateExecutionPackage = (
  project: Project,
  executionPackage: ExecutionPackage,
  options: ExecutionPackageValidationOptions = {},
): void => {
  if (executionPackage.project_id !== project.id) {
    throw new DomainError('PROJECT_MISMATCH', `Package ${executionPackage.id} belongs to project ${executionPackage.project_id}`, {
      execution_package_id: executionPackage.id,
      project_id: project.id,
      execution_package_project_id: executionPackage.project_id,
    });
  }

  validateRepoBelongsToProject(project, executionPackage.repo_id);

  if (!Number.isInteger(executionPackage.version) || executionPackage.version < 0) {
    throw new DomainError(
      'EXECUTION_PACKAGE_VERSION_INVALID',
      `Package ${executionPackage.id} must have a non-negative integer version.`,
      {
        execution_package_id: executionPackage.id,
        version: executionPackage.version,
      },
    );
  }

  const referencedRepoIds = new Set(options.referenced_repo_ids ?? [executionPackage.repo_id]);
  if (referencedRepoIds.size > 1 || !referencedRepoIds.has(executionPackage.repo_id)) {
    throw new DomainError('PACKAGE_MULTIPLE_REPOS', `Package ${executionPackage.id} must bind exactly one repo`, {
      execution_package_id: executionPackage.id,
      repo_ids: [...referencedRepoIds],
    });
  }

  for (const repoId of referencedRepoIds) {
    validateRepoBelongsToProject(project, repoId);
  }

  if (
    (executionPackage.validation_strategy === undefined || executionPackage.validation_strategy === 'checks_required') &&
    executionPackage.required_checks.length === 0
  ) {
    throw new DomainError('REQUIRED_CHECK_MISSING', `Package ${executionPackage.id} must define required checks`, {
      execution_package_id: executionPackage.id,
    });
  }

  if (!hasText(executionPackage.owner_actor_id)) {
    throw new DomainError('OWNER_REQUIRED', `Package ${executionPackage.id} must have an owner`, {
      execution_package_id: executionPackage.id,
    });
  }

  if (!hasText(executionPackage.reviewer_actor_id)) {
    throw new DomainError('REVIEWER_REQUIRED', `Package ${executionPackage.id} must have a reviewer`, {
      execution_package_id: executionPackage.id,
    });
  }

  if (!hasText(executionPackage.qa_owner_actor_id)) {
    throw new DomainError('QA_OWNER_REQUIRED', `Package ${executionPackage.id} must have a QA owner`, {
      execution_package_id: executionPackage.id,
    });
  }

  if (!hasText(executionPackage.objective)) {
    throw new DomainError('EXECUTION_OBJECTIVE_REQUIRED', `Package ${executionPackage.id} must have an objective`, {
      execution_package_id: executionPackage.id,
    });
  }

  validateExecutionPackagePolicy(executionPackage);
};

export const validatePackageDependencyGraph = (
  packages: readonly ExecutionPackage[],
  dependencies: readonly ExecutionPackageDependency[],
): void => {
  const packageIds = new Set(packages.map((executionPackage) => executionPackage.id));
  const graph = new Map<string, string[]>();

  for (const packageId of packageIds) {
    graph.set(packageId, []);
  }

  for (const dependency of dependencies) {
    if (packageIds.has(dependency.package_id) && packageIds.has(dependency.depends_on_package_id)) {
      graph.get(dependency.package_id)?.push(dependency.depends_on_package_id);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (packageId: string, path: string[]): void => {
    if (visiting.has(packageId)) {
      throw new DomainError('DEPENDENCY_CYCLE', `Package dependency cycle detected: ${[...path, packageId].join(' -> ')}`, {
        package_id: packageId,
      });
    }

    if (visited.has(packageId)) {
      return;
    }

    visiting.add(packageId);
    for (const dependencyId of graph.get(packageId) ?? []) {
      visit(dependencyId, [...path, packageId]);
    }
    visiting.delete(packageId);
    visited.add(packageId);
  };

  for (const packageId of packageIds) {
    visit(packageId, []);
  }
};

export const validatePackageEditAllowed = (executionPackage: ExecutionPackage): void => {
  if (executionPackage.phase !== 'draft' && executionPackage.phase !== 'ready') {
    throw new DomainError('EDIT_NOT_ALLOWED', `Package ${executionPackage.id} cannot be edited while ${executionPackage.phase}`, {
      execution_package_id: executionPackage.id,
      phase: executionPackage.phase,
    });
  }
};

export const validateForceRerunAllowed = (
  executionPackage: ExecutionPackage,
  reviewPackets: readonly ReviewPacket[],
  actorId: string,
): void => {
  const packageReviewPackets = reviewPackets.filter(
    (reviewPacket) => reviewPacket.execution_package_id === executionPackage.id,
  );

  const hasCurrentOpenReviewPacket =
    executionPackage.last_run_session_id !== undefined &&
    packageReviewPackets.some(
      (reviewPacket) =>
        reviewPacket.run_session_id === executionPackage.last_run_session_id &&
        reviewPacket.decision === 'none' &&
        isOpenReviewPacketStatus(reviewPacket.status),
    );

  if (
    executionPackage.phase !== 'review' ||
    executionPackage.resolution !== 'none' ||
    executionPackage.owner_actor_id !== actorId ||
    !hasCurrentOpenReviewPacket
  ) {
    throw new DomainError('FORCE_RERUN_FORBIDDEN', `Actor ${actorId} cannot force-rerun package ${executionPackage.id}`, {
      execution_package_id: executionPackage.id,
      actor_id: actorId,
    });
  }
};
