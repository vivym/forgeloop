import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';

import type { ArtifactRef, RequiredCheckSpec } from '@forgeloop/contracts';
import type { AutomationActorClass, PackageRuntimePolicySnapshot, SourceMutationPolicy, ValidationStrategy } from '@forgeloop/domain';
import { parse as parseYaml } from 'yaml';
import { compileEffectivePathPolicy, compilePathPolicy, PathPolicyError, type RawPathPolicy } from './path-policy.js';
import {
  legacyRequiredCheckToStructuredCommand as renderLegacyRequiredCheckCommand,
  materializeCommandReference,
  StructuredCommandError,
  validateStructuredCommandSpec as validateSharedStructuredCommandSpec,
  type CommandReference,
  type CwdPolicy,
  type SourceWritePolicy,
  type StructuredCommandSpec,
  type Visibility,
} from './structured-command.js';

export const RUNTIME_POLICY_PARSER_VERSION = 'executor-runtime-policy/v1';
export const RUNTIME_POLICY_SOURCE_PATH = 'WORKFLOW.md';

export type NetworkMode = 'disabled' | 'egress_allowlist';
export type FallbackMode = 'disabled' | 'codex_exec';

export interface PolicyRequiredCheckSpec {
  check_id: string;
  display_name?: string;
  command_template?: string;
  command?: StructuredCommandSpec;
  timeout_ms?: number;
  output_limit_bytes?: number;
  visibility?: Visibility;
  source_write_policy?: SourceWritePolicy;
  blocks_review?: boolean;
}

export interface HookSpec {
  hook_id?: string;
  command_template?: string;
  command?: StructuredCommandSpec;
  timeout_ms?: number;
  output_limit_bytes?: number;
  visibility?: Visibility;
  source_write_policy?: SourceWritePolicy;
}

export interface FallbackSpec {
  mode?: FallbackMode;
  command_template?: string;
  command?: StructuredCommandSpec;
  timeout_ms?: number;
  output_limit_bytes?: number;
  visibility?: Visibility;
  source_write_policy?: SourceWritePolicy;
}

export interface RuntimePolicyDocument {
  codex?: { primary_executor?: 'cli' | 'app_server' | 'mock'; network_mode?: NetworkMode; egress_allowlist_digest?: string };
  workspace?: { worktree_dir?: '.worktrees'; cleanup?: 'run_workspace_only' | 'disabled'; source_snapshot?: 'required' };
  path_policy?: { allowed_paths?: string[]; forbidden_paths?: string[]; allow_all_repo?: boolean };
  commands?: {
    trusted_toolchain: string;
    templates?: Record<string, StructuredCommandSpec>;
    default_timeout_ms?: number;
    default_output_limit_bytes?: number;
    safe_git_profile?: 'forgeloop_default';
  };
  environment?: { allow?: string[]; path_toolchain?: string };
  checks?: { required?: PolicyRequiredCheckSpec[] };
  hooks?: { before_run?: HookSpec[]; after_run?: HookSpec[] };
  fallback?: FallbackSpec;
  artifacts?: { default_visibility?: Visibility; max_artifact_bytes?: number; max_run_artifact_bytes?: number; public_safe_kinds?: string[] };
  prompt_policy?: { include_workflow_body?: boolean; body_visibility?: Visibility };
  observability?: { public_summary?: string };
}

export interface FrozenRuntimePolicyPayload {
  parser_version: string;
  policy_source_path: typeof RUNTIME_POLICY_SOURCE_PATH;
  normalized_front_matter: RuntimePolicyDocument;
  normalized_markdown_body: string;
  normalized_body_digest: string;
  normalized_payload_digest: string;
}

export interface RuntimePolicyDiagnostic {
  code: 'runtime_policy_missing' | 'runtime_policy_invalid';
  message: string;
  retryable: boolean;
}

export interface RuntimePolicyLoaded {
  status: 'loaded';
  policy: RuntimePolicyDocument;
  policy_digest: string;
  policy_source_path: typeof RUNTIME_POLICY_SOURCE_PATH;
  policy_loaded_at: string;
  policy_last_known_good: true;
  normalized_policy_payload: FrozenRuntimePolicyPayload;
  diagnostics: RuntimePolicyDiagnostic[];
  env_policy_digest: string;
  command_policy_digest: string;
  mount_policy_digest: string;
  network_policy_digest: string;
  reload_status?: 'invalid_preserved_last_known_good' | 'missing_preserved_last_known_good';
}

export interface RuntimePolicyBlocked {
  status: 'missing' | 'invalid';
  policy_source_path: typeof RUNTIME_POLICY_SOURCE_PATH;
  policy_loaded_at: string;
  policy_last_known_good: false;
  blocker_code: 'runtime_policy_missing' | 'runtime_policy_invalid';
  diagnostics: RuntimePolicyDiagnostic[];
}

export type LoadedRuntimePolicy = RuntimePolicyLoaded | RuntimePolicyBlocked;

export class RuntimePolicyError extends Error {
  constructor(
    readonly public_code: 'required_check_command_invalid' | 'policy_snapshot_invalid',
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'RuntimePolicyError';
  }
}

interface LoadRuntimePolicyInput {
  repoRoot: string;
  loadedAt: string;
  policySourcePath?: string;
  lastKnownGood?: LoadedRuntimePolicy;
  defaultPrimaryExecutor?: 'cli' | 'app_server' | 'mock';
}

interface RuntimePolicyFromDocumentInput {
  document: RuntimePolicyDocument;
  markdownBody: string;
  loadedAt: string;
  defaultPrimaryExecutor?: 'cli' | 'app_server' | 'mock';
}

const hardDefaultTimeoutMs = 120_000;
const hardDefaultOutputLimitBytes = 1_000_000;

const acceptedTopLevelKeys = new Set([
  'codex',
  'workspace',
  'path_policy',
  'commands',
  'environment',
  'checks',
  'hooks',
  'fallback',
  'artifacts',
  'prompt_policy',
  'observability',
]);

const dangerousExactEnvNames = new Set([
  'PATH',
  'NODE_OPTIONS',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'GIT_ASKPASS',
  'SSH_AUTH_SOCK',
  'BASH_ENV',
  'ENV',
]);

export const loadRuntimePolicy = async (input: LoadRuntimePolicyInput): Promise<LoadedRuntimePolicy> => {
  const policySourcePath = input.policySourcePath ?? RUNTIME_POLICY_SOURCE_PATH;
  if (policySourcePath !== RUNTIME_POLICY_SOURCE_PATH || policySourcePath !== posix.normalize(policySourcePath)) {
    return blockedPolicy('invalid', input.loadedAt, `Runtime policy source path must be ${RUNTIME_POLICY_SOURCE_PATH}.`);
  }

  let content: string;
  try {
    content = await readFile(join(input.repoRoot, RUNTIME_POLICY_SOURCE_PATH), 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      if (input.lastKnownGood?.status === 'loaded') {
        return {
          ...input.lastKnownGood,
          reload_status: 'missing_preserved_last_known_good',
          diagnostics: [diagnostic('runtime_policy_missing', `${RUNTIME_POLICY_SOURCE_PATH} is missing.`)],
        };
      }
      return blockedPolicy('missing', input.loadedAt, `${RUNTIME_POLICY_SOURCE_PATH} is missing.`);
    }
    throw error;
  }

  try {
    const parsed = parseFrontMatter(content);
    return runtimePolicyFromDocument({
      document: parsed.frontMatter,
      markdownBody: parsed.body,
      loadedAt: input.loadedAt,
      ...(input.defaultPrimaryExecutor === undefined ? {} : { defaultPrimaryExecutor: input.defaultPrimaryExecutor }),
    });
  } catch (error) {
    if (input.lastKnownGood?.status === 'loaded') {
      return {
        ...input.lastKnownGood,
        reload_status: 'invalid_preserved_last_known_good',
        diagnostics: [diagnostic('runtime_policy_invalid', error instanceof Error ? error.message : 'Invalid runtime policy.')],
      };
    }
    return blockedPolicy('invalid', input.loadedAt, error instanceof Error ? error.message : 'Invalid runtime policy.');
  }
};

export const runtimePolicyFromDocument = (input: RuntimePolicyFromDocumentInput): RuntimePolicyLoaded => {
  const policy = normalizeRuntimePolicyDocument(input.document, input.defaultPrimaryExecutor ?? 'mock');
  validateRuntimePolicy(policy);
  const normalizedBody = normalizeMarkdownBody(input.markdownBody);
  const normalizedBodyDigest = digest(normalizedBody);
  const payloadWithoutDigest = {
    parser_version: RUNTIME_POLICY_PARSER_VERSION,
    policy_source_path: RUNTIME_POLICY_SOURCE_PATH as typeof RUNTIME_POLICY_SOURCE_PATH,
    normalized_front_matter: policy,
    normalized_markdown_body: normalizedBody,
    normalized_body_digest: normalizedBodyDigest,
  };
  const normalizedPayloadDigest = digest(payloadWithoutDigest);
  const normalizedPolicyPayload: FrozenRuntimePolicyPayload = {
    ...payloadWithoutDigest,
    normalized_payload_digest: normalizedPayloadDigest,
  };

  return {
    status: 'loaded',
    policy,
    policy_digest: normalizedPayloadDigest,
    policy_source_path: RUNTIME_POLICY_SOURCE_PATH,
    policy_loaded_at: input.loadedAt,
    policy_last_known_good: true,
    normalized_policy_payload: normalizedPolicyPayload,
    diagnostics: [],
    env_policy_digest: digest({ environment: policy.environment }),
    command_policy_digest: digest({
      commands: policy.commands,
      defaults: { timeout_ms: hardDefaultTimeoutMs, output_limit_bytes: hardDefaultOutputLimitBytes },
    }),
    mount_policy_digest: digest({
      workspace: policy.workspace,
      artifacts: policy.artifacts,
      source_snapshot: policy.workspace?.source_snapshot,
    }),
    network_policy_digest:
      policy.codex?.network_mode === 'egress_allowlist'
        ? digest({ network_mode: 'egress_allowlist', egress_allowlist_digest: policy.codex.egress_allowlist_digest })
        : 'network-disabled',
  };
};

export function buildPackageRuntimePolicySnapshot(input: {
  loadedPolicy: LoadedRuntimePolicy;
  executionPackageChecks: readonly RequiredCheckSpec[];
  executionPackagePathPolicy: RawPathPolicy;
  validationStrategy: ValidationStrategy;
  sourceMutationPolicy: SourceMutationPolicy;
  validationEvidenceRefs?: readonly ArtifactRef[];
  safeDefaultApprovalEvidence?: {
    evidence_type: 'decision' | 'artifact' | 'object_event';
    ref_id: string;
    approved_by_actor_id: string;
    approved_by_actor_class: AutomationActorClass;
    approved_at: string;
    summary: string;
  };
}): PackageRuntimePolicySnapshot {
  if (input.loadedPolicy.status === 'missing') {
    return buildSafeDefaultSnapshot(input);
  }
  if (input.loadedPolicy.status !== 'loaded') {
    throw snapshotError('policy_snapshot_invalid', 'Cannot capture an invalid runtime policy snapshot.');
  }

  const policy = input.loadedPolicy.policy;
  assertSnapshotPathPolicyAllowed(policy, input);
  const frozenCommandCheckPolicy = buildFrozenCommandCheckPolicy(policy, input.executionPackageChecks);
  const frozenHookSpecs = buildFrozenHookSpecs(policy);
  const fallbackPolicy = buildFrozenFallbackPolicy(policy);

  return deepCloneJson({
    policy_snapshot_version: 1,
    snapshot_origin: 'workflow_md',
    policy_digest: input.loadedPolicy.policy_digest,
    policy_source_path: input.loadedPolicy.policy_source_path,
    policy_loaded_at: input.loadedPolicy.policy_loaded_at,
    policy_last_known_good: input.loadedPolicy.policy_last_known_good,
    normalized_policy_payload: input.loadedPolicy.normalized_policy_payload as unknown as Record<string, unknown>,
    hooks: policy.hooks ?? { before_run: [], after_run: [] },
    frozen_hook_specs: frozenHookSpecs,
    command_policy: policy.commands ?? defaultCommandPolicy(),
    check_policy: policy.checks ?? { required: [] },
    env_policy: policy.environment ?? { allow: [] },
    workspace_policy: policy.workspace ?? defaultWorkspacePolicy(),
    path_policy: policy.path_policy ?? { allowed_paths: [], forbidden_paths: [] },
    codex_runtime_mode: policy.codex ?? defaultCodexPolicy('mock'),
    prompt_policy: policy.prompt_policy ?? defaultPromptPolicy(),
    artifact_visibility_policy: policy.artifacts ?? defaultArtifactPolicy(),
    fallback_policy: fallbackPolicy,
    env_policy_digest: input.loadedPolicy.env_policy_digest,
    command_policy_digest: input.loadedPolicy.command_policy_digest,
    mount_policy_digest: input.loadedPolicy.mount_policy_digest,
    network_policy_digest: input.loadedPolicy.network_policy_digest,
    safe_git_profile: policy.commands?.safe_git_profile ?? 'forgeloop_default',
    frozen_command_check_policy: frozenCommandCheckPolicy as unknown as Record<string, unknown>,
    source_mutation_policy: input.sourceMutationPolicy,
    validation_strategy_version: 1,
    validation_strategy: input.validationStrategy,
    validation_public_summary:
      policy.observability?.public_summary ?? 'Required checks and runtime policy are frozen for this package.',
    validation_evidence_refs: [...(input.validationEvidenceRefs ?? [])],
  });
}

const buildSafeDefaultSnapshot = (input: Parameters<typeof buildPackageRuntimePolicySnapshot>[0]): PackageRuntimePolicySnapshot => {
  if (input.sourceMutationPolicy !== 'no_source_changes') {
    throw snapshotError('policy_snapshot_invalid', 'Reviewed safe-default snapshots require no_source_changes.');
  }
  if (input.validationStrategy !== 'checks_required') {
    throw snapshotError('policy_snapshot_invalid', 'Reviewed safe-default snapshots require checks_required validation.');
  }
  if (input.safeDefaultApprovalEvidence === undefined) {
    throw snapshotError('policy_snapshot_invalid', 'Reviewed safe-default snapshots require approval evidence.');
  }
  assertSafeDefaultApprovalEvidence(input.safeDefaultApprovalEvidence);
  if ((input.validationEvidenceRefs?.length ?? 0) > 0) {
    throw snapshotError('policy_snapshot_invalid', 'Reviewed safe-default snapshots must not include unbound validation evidence.');
  }
  try {
    compilePathPolicy(input.executionPackagePathPolicy, {
      validationStrategy: 'checks_required',
      sourceMutationPolicy: 'no_source_changes',
    });
  } catch (error) {
    if (error instanceof PathPolicyError) {
      throw snapshotError('policy_snapshot_invalid', error.message, error.details);
    }
    throw error;
  }

  const emptyPayload = emptyRuntimePolicyPayload();
  const emptyPolicy = runtimePolicyFromDocument({ document: {}, markdownBody: '', loadedAt: input.loadedPolicy.policy_loaded_at });
  return deepCloneJson({
    policy_snapshot_version: 1,
    snapshot_origin: 'reviewed_safe_default',
    policy_digest: emptyPayload.normalized_payload_digest,
    policy_source_path: RUNTIME_POLICY_SOURCE_PATH,
    policy_loaded_at: input.loadedPolicy.policy_loaded_at,
    policy_last_known_good: false,
    normalized_policy_payload: emptyPayload as unknown as Record<string, unknown>,
    hooks: { before_run: [], after_run: [] },
    frozen_hook_specs: { before_run: [], after_run: [] },
    command_policy: defaultCommandPolicy(),
    check_policy: { required: [] },
    env_policy: { allow: [] },
    workspace_policy: defaultWorkspacePolicy(),
    path_policy: { allowed_paths: [], forbidden_paths: [] },
    codex_runtime_mode: defaultCodexPolicy('mock'),
    prompt_policy: defaultPromptPolicy(),
    artifact_visibility_policy: { default_visibility: 'internal' },
    fallback_policy: { mode: 'disabled' },
    env_policy_digest: emptyPolicy.env_policy_digest,
    command_policy_digest: emptyPolicy.command_policy_digest,
    mount_policy_digest: emptyPolicy.mount_policy_digest,
    network_policy_digest: 'network-disabled',
    safe_git_profile: 'forgeloop_default',
    safe_default_approval_evidence: input.safeDefaultApprovalEvidence,
    frozen_command_check_policy: buildFrozenCommandCheckPolicy(emptyPolicy.policy, input.executionPackageChecks) as unknown as Record<string, unknown>,
    source_mutation_policy: 'no_source_changes',
    validation_strategy_version: 1,
    validation_strategy: 'checks_required',
    validation_public_summary: 'Reviewed safe default for missing WORKFLOW.md.',
    validation_evidence_refs: [...(input.validationEvidenceRefs ?? [])],
  });
};

const buildFrozenCommandCheckPolicy = (
  policy: RuntimePolicyDocument,
  packageChecks: readonly RequiredCheckSpec[],
): { required_checks: FrozenRequiredCheckSpec[] } => {
  const repoChecks = policy.checks?.required ?? [];
  assertUniqueCheckIds(repoChecks, 'repo policy');
  assertUniqueCheckIds(packageChecks, 'execution package');
  const repoChecksById = new Map(repoChecks.map((check) => [check.check_id, check]));
  const frozen: FrozenRequiredCheckSpec[] = [];

  for (const packageCheck of packageChecks) {
    const repoCheck = repoChecksById.get(packageCheck.check_id);
    const packageTimeoutMs = packageCheck.timeout_seconds * 1000;
    if (repoCheck !== undefined) {
      frozen.push(freezePackageCheckWithRepoCommand(policy, packageCheck, repoCheck, packageTimeoutMs));
      repoChecksById.delete(packageCheck.check_id);
      continue;
    }

    const command = materializePolicyCommandReference(
      policy,
      {
        command: legacyRequiredCheckToStructuredCommand(packageCheck.command),
        timeout_ms: packageTimeoutMs,
        visibility: 'internal',
      },
      'read_only',
      { defaultTimeoutMs: packageTimeoutMs },
    );
    frozen.push({
      check_id: packageCheck.check_id,
      display_name: packageCheck.display_name,
      source: 'execution_package',
      blocks_review: packageCheck.blocks_review,
      timeout_ms: packageTimeoutMs,
      command,
      visibility: 'internal',
    });
  }

  for (const repoCheck of repoChecksById.values()) {
    const command = materializePolicyCommandReference(
      policy,
      {
        ...repoCheck,
        visibility: repoCheck.visibility ?? 'internal',
        source_write_policy: repoCheck.source_write_policy ?? 'read_only',
      },
      'read_only',
    );
    frozen.push({
      check_id: repoCheck.check_id,
      display_name: repoCheck.display_name ?? repoCheck.check_id,
      source: 'repo_policy',
      blocks_review: true,
      timeout_ms: repoCheck.timeout_ms ?? command.timeout_ms ?? hardDefaultTimeoutMs,
      command,
      visibility: 'internal',
    });
  }

  return { required_checks: frozen };
};

interface FrozenHookSpec {
  hook_id?: string;
  command: StructuredCommandSpec;
}

const buildFrozenHookSpecs = (policy: RuntimePolicyDocument): { before_run: FrozenHookSpec[]; after_run: FrozenHookSpec[] } => ({
  before_run: (policy.hooks?.before_run ?? []).map((hook) => freezeHookSpec(policy, hook, 'read_only')),
  after_run: (policy.hooks?.after_run ?? []).map((hook) => freezeHookSpec(policy, hook, 'artifact_only')),
});

const freezeHookSpec = (
  policy: RuntimePolicyDocument,
  hook: HookSpec,
  defaultSourceWritePolicy: SourceWritePolicy,
): FrozenHookSpec => {
  const command = materializePolicyCommandReference(policy, hook, defaultSourceWritePolicy);
  return omitUndefined({
    hook_id: hook.hook_id,
    command,
  }) as FrozenHookSpec;
};

const buildFrozenFallbackPolicy = (policy: RuntimePolicyDocument): unknown => {
  const fallback = policy.fallback ?? { mode: 'disabled' };
  if (fallback.mode === undefined || fallback.mode === 'disabled') {
    const hasCommandSource = fallback.command !== undefined || fallback.command_template !== undefined;
    const hasOverrides =
      fallback.timeout_ms !== undefined ||
      fallback.output_limit_bytes !== undefined ||
      fallback.visibility !== undefined ||
      fallback.source_write_policy !== undefined;
    if (hasCommandSource || hasOverrides) {
      throw snapshotError('policy_snapshot_invalid', 'Disabled fallback policy must not define command materialization fields.');
    }
    return { mode: 'disabled' };
  }

  return {
    mode: fallback.mode,
    command: materializePolicyCommandReference(policy, fallback, 'read_only'),
  };
};

interface FrozenRequiredCheckSpec {
  check_id: string;
  display_name: string;
  source: 'execution_package' | 'repo_policy';
  blocks_review: boolean;
  timeout_ms: number;
  command: StructuredCommandSpec;
  visibility: Visibility;
}

const freezePackageCheckWithRepoCommand = (
  policy: RuntimePolicyDocument,
  packageCheck: RequiredCheckSpec,
  repoCheck: PolicyRequiredCheckSpec,
  packageTimeoutMs: number,
): FrozenRequiredCheckSpec => {
  if (repoCheck.display_name !== undefined && repoCheck.display_name !== packageCheck.display_name) {
    throw snapshotError('policy_snapshot_invalid', 'Repo policy check cannot change package display_name.');
  }
  if (packageCheck.blocks_review && repoCheck.blocks_review === false) {
    throw snapshotError('policy_snapshot_invalid', 'Repo policy check cannot weaken blocks_review.');
  }
  if (repoCheck.timeout_ms !== undefined && repoCheck.timeout_ms > packageTimeoutMs) {
    throw snapshotError('policy_snapshot_invalid', 'Repo policy check cannot raise package timeout.');
  }

  const command = materializePolicyCommandReference(
    policy,
    {
      ...repoCheck,
      visibility: repoCheck.visibility ?? 'internal',
      source_write_policy: repoCheck.source_write_policy ?? 'read_only',
    },
    'read_only',
    {
      defaultTimeoutMs: packageTimeoutMs,
    },
  );
  if (command.timeout_ms !== undefined && command.timeout_ms > packageTimeoutMs) {
    throw snapshotError('policy_snapshot_invalid', 'Repo policy check cannot raise package timeout.');
  }
  return {
    check_id: packageCheck.check_id,
    display_name: packageCheck.display_name,
    source: 'execution_package',
    blocks_review: packageCheck.blocks_review,
    timeout_ms: command.timeout_ms ?? packageTimeoutMs,
    command,
    visibility: command.visibility ?? 'internal',
  };
};

const materializePolicyCommandReference = (
  policy: RuntimePolicyDocument,
  reference: CommandReference,
  defaultSourceWritePolicy: SourceWritePolicy,
  defaults: {
    defaultTimeoutMs?: number;
    defaultOutputLimitBytes?: number;
    defaultVisibility?: Visibility;
  } = {},
): StructuredCommandSpec => {
  try {
    return materializeCommandReference({
      reference,
      defaultSourceWritePolicy,
      defaultVisibility: defaults.defaultVisibility ?? 'internal',
      hardCaps: { allowedEnv: policy.environment?.allow ?? [] },
      ...(policy.commands?.templates === undefined ? {} : { templates: policy.commands.templates }),
      ...(defaults.defaultTimeoutMs !== undefined
        ? { defaultTimeoutMs: defaults.defaultTimeoutMs }
        : policy.commands?.default_timeout_ms === undefined
          ? {}
          : { defaultTimeoutMs: policy.commands.default_timeout_ms }),
      ...(defaults.defaultOutputLimitBytes !== undefined
        ? { defaultOutputLimitBytes: defaults.defaultOutputLimitBytes }
        : policy.commands?.default_output_limit_bytes === undefined
        ? {}
        : { defaultOutputLimitBytes: policy.commands.default_output_limit_bytes }),
    });
  } catch (error) {
    if (error instanceof StructuredCommandError) {
      throw snapshotError('policy_snapshot_invalid', error.message, error.details);
    }
    throw error;
  }
};

const assertSnapshotPathPolicyAllowed = (
  policy: RuntimePolicyDocument,
  input: Parameters<typeof buildPackageRuntimePolicySnapshot>[0],
): void => {
  try {
    compilePathPolicy(policy.path_policy ?? { allowed_paths: [], forbidden_paths: [] }, {
      validationStrategy: input.validationStrategy,
      reviewedAllowAllRepo: (input.validationEvidenceRefs?.length ?? 0) > 0,
      sourceMutationPolicy: input.sourceMutationPolicy,
    });
    const effectivePathPolicy = compileEffectivePathPolicy({
      packagePolicy: input.executionPackagePathPolicy,
      snapshotPolicy: policy.path_policy ?? { allowed_paths: [], forbidden_paths: [] },
      packageValidationStrategy: 'checks_required',
      snapshotValidationStrategy: input.validationStrategy,
      snapshotReviewedAllowAllRepo: (input.validationEvidenceRefs?.length ?? 0) > 0,
      sourceMutationPolicy: input.sourceMutationPolicy,
    });
    const declaredScopeResult = effectivePathPolicy.validateDeclaredScope(input.executionPackagePathPolicy.allowed_paths ?? []);
    if (!declaredScopeResult.allowed) {
      throw snapshotError('policy_snapshot_invalid', 'Package declared source scope is outside the frozen runtime path policy.', {
        code: declaredScopeResult.code,
        path: declaredScopeResult.path,
        reason: declaredScopeResult.reason,
      });
    }
  } catch (error) {
    if (error instanceof PathPolicyError) {
      throw snapshotError('policy_snapshot_invalid', error.message, error.details);
    }
    throw error;
  }
};

const safeDefaultApprovalActorClasses = new Set<AutomationActorClass>(['human', 'human_admin', 'system_bootstrap']);

const assertSafeDefaultApprovalEvidence = (
  evidence: NonNullable<Parameters<typeof buildPackageRuntimePolicySnapshot>[0]['safeDefaultApprovalEvidence']>,
): void => {
  if (!safeDefaultApprovalActorClasses.has(evidence.approved_by_actor_class)) {
    throw snapshotError('policy_snapshot_invalid', 'Reviewed safe-default snapshots require trusted human/admin/bootstrap approval.');
  }
};

const legacyRequiredCheckToStructuredCommand = (command: string): StructuredCommandSpec => {
  try {
    return renderLegacyRequiredCheckCommand(command);
  } catch (error) {
    if (error instanceof StructuredCommandError) {
      throw snapshotError('required_check_command_invalid', error.message, error.details);
    }
    throw error;
  }
};

const validateStructuredCommandSpec = (
  input: unknown,
  commandValidation: StructuredCommandValidationContext = { allowedEnv: [] },
): StructuredCommandSpec => {
  try {
    return validateSharedStructuredCommandSpec(input, commandValidation);
  } catch (error) {
    if (error instanceof StructuredCommandError) {
      throw snapshotError('policy_snapshot_invalid', error.message, error.details);
    }
    throw error;
  }
};

const parseFrontMatter = (content: string): { frontMatter: RuntimePolicyDocument; body: string } => {
  const openDelimiterLength = content.startsWith('---\n') ? 4 : content.startsWith('---\r\n') ? 5 : undefined;
  if (openDelimiterLength === undefined) {
    if (content.startsWith('---')) {
      throw new Error('Runtime policy front matter opening delimiter is malformed.');
    }
    return { frontMatter: {}, body: content };
  }

  let lineStart = openDelimiterLength;
  while (lineStart <= content.length) {
    const nextLineFeed = content.indexOf('\n', lineStart);
    const lineEnd = nextLineFeed === -1 ? content.length : nextLineFeed;
    const rawLine = content.slice(lineStart, lineEnd);
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '---') {
      const rawFrontMatter = content.slice(openDelimiterLength, lineStart).replace(/\r?\n$/, '');
      const rawBody = nextLineFeed === -1 ? '' : content.slice(nextLineFeed + 1);
      const parsed = parseYaml(rawFrontMatter);
      if (parsed === null || parsed === undefined) {
        return { frontMatter: {}, body: rawBody };
      }
      assertPlainObject(parsed, 'Runtime policy front matter must be an object.');
      return { frontMatter: parsed as RuntimePolicyDocument, body: rawBody };
    }
    if (line.startsWith('---')) {
      throw new Error('Runtime policy front matter closing delimiter is malformed.');
    }
    if (nextLineFeed === -1) {
      break;
    }
    lineStart = nextLineFeed + 1;
  }

  throw new Error('Runtime policy front matter is not closed.');
};

const normalizeRuntimePolicyDocument = (
  input: RuntimePolicyDocument,
  defaultPrimaryExecutor: 'cli' | 'app_server' | 'mock',
): RuntimePolicyDocument => {
  assertExactKeys(input, [...acceptedTopLevelKeys]);
  const environment = normalizeEnvironmentPolicy(input.environment);
  const commandValidation = { allowedEnv: environment.allow ?? [] };

  return {
    codex: normalizeCodexPolicy(input.codex, defaultPrimaryExecutor),
    workspace: normalizeWorkspacePolicy(input.workspace),
    path_policy: normalizePathPolicy(input.path_policy),
    commands: normalizeCommandPolicy(input.commands, commandValidation),
    environment,
    checks: normalizeChecksPolicy(input.checks, commandValidation),
    hooks: normalizeHooksPolicy(input.hooks, commandValidation),
    fallback: normalizeFallbackPolicy(input.fallback, commandValidation),
    artifacts: normalizeArtifactPolicy(input.artifacts),
    prompt_policy: normalizePromptPolicy(input.prompt_policy),
    observability: normalizeObservabilityPolicy(input.observability),
  };
};

const normalizeCodexPolicy = (
  input: RuntimePolicyDocument['codex'],
  defaultPrimaryExecutor: 'cli' | 'app_server' | 'mock',
): NonNullable<RuntimePolicyDocument['codex']> => {
  if (input === undefined) {
    return defaultCodexPolicy(defaultPrimaryExecutor);
  }
  assertPlainObject(input, 'codex must be an object.');
  assertExactKeys(input, ['primary_executor', 'network_mode', 'egress_allowlist_digest']);
  const primaryExecutor = optionalEnumField(input, 'primary_executor', ['cli', 'app_server', 'mock']) ?? defaultPrimaryExecutor;
  const networkMode = optionalEnumField(input, 'network_mode', ['disabled', 'egress_allowlist']) ?? 'disabled';
  const egressAllowlistDigest = optionalStringField(input, 'egress_allowlist_digest');
  if (networkMode === 'egress_allowlist' && egressAllowlistDigest === undefined) {
    throw new Error('codex.egress_allowlist_digest is required for egress_allowlist network mode.');
  }
  return {
    primary_executor: primaryExecutor,
    network_mode: networkMode,
    ...(egressAllowlistDigest === undefined ? {} : { egress_allowlist_digest: egressAllowlistDigest }),
  };
};

const normalizeWorkspacePolicy = (input: RuntimePolicyDocument['workspace']): NonNullable<RuntimePolicyDocument['workspace']> => {
  if (input === undefined) {
    return defaultWorkspacePolicy();
  }
  assertPlainObject(input, 'workspace must be an object.');
  assertExactKeys(input, ['worktree_dir', 'cleanup', 'source_snapshot']);
  return {
    worktree_dir: optionalEnumField(input, 'worktree_dir', ['.worktrees']) ?? '.worktrees',
    cleanup: optionalEnumField(input, 'cleanup', ['run_workspace_only', 'disabled']) ?? 'run_workspace_only',
    source_snapshot: optionalEnumField(input, 'source_snapshot', ['required']) ?? 'required',
  };
};

const normalizePathPolicy = (input: RuntimePolicyDocument['path_policy']): NonNullable<RuntimePolicyDocument['path_policy']> => {
  if (input === undefined) {
    return { allowed_paths: [], forbidden_paths: [] };
  }
  assertPlainObject(input, 'path_policy must be an object.');
  assertExactKeys(input, ['allowed_paths', 'forbidden_paths', 'allow_all_repo']);
  return {
    allowed_paths: optionalStringArrayField(input, 'allowed_paths') ?? [],
    forbidden_paths: optionalStringArrayField(input, 'forbidden_paths') ?? [],
    ...(optionalBooleanField(input, 'allow_all_repo') === true ? { allow_all_repo: true } : {}),
  };
};

const normalizeCommandPolicy = (
  input: RuntimePolicyDocument['commands'],
  commandValidation: StructuredCommandValidationContext,
): NonNullable<RuntimePolicyDocument['commands']> => {
  if (input === undefined) {
    return defaultCommandPolicy();
  }
  assertPlainObject(input, 'commands must be an object.');
  assertExactKeys(input, ['trusted_toolchain', 'templates', 'default_timeout_ms', 'default_output_limit_bytes', 'safe_git_profile']);
  const templates = input.templates;
  const normalizedTemplates: Record<string, StructuredCommandSpec> = {};
  if (templates !== undefined) {
    assertPlainObject(templates, 'commands.templates must be an object.');
    for (const [name, command] of Object.entries(templates)) {
      if (name.trim().length === 0) {
        throw new Error('Command template names must not be empty.');
      }
      normalizedTemplates[name] = validateStructuredCommandSpec(command, commandValidation);
    }
  }
  return omitUndefined({
    trusted_toolchain: stringField(input, 'trusted_toolchain'),
    templates: normalizedTemplates,
    default_timeout_ms: optionalPositiveIntegerField(input, 'default_timeout_ms'),
    default_output_limit_bytes: optionalPositiveIntegerField(input, 'default_output_limit_bytes'),
    safe_git_profile: optionalEnumField(input, 'safe_git_profile', ['forgeloop_default']) ?? 'forgeloop_default',
  }) as NonNullable<RuntimePolicyDocument['commands']>;
};

const normalizeEnvironmentPolicy = (input: RuntimePolicyDocument['environment']): NonNullable<RuntimePolicyDocument['environment']> => {
  if (input === undefined) {
    return { allow: [] };
  }
  assertPlainObject(input, 'environment must be an object.');
  assertExactKeys(input, ['allow', 'path_toolchain']);
  const allow = optionalStringArrayField(input, 'allow') ?? [];
  validateEnvironmentAllow(allow);
  return omitUndefined({
    allow,
    path_toolchain: optionalStringField(input, 'path_toolchain'),
  }) as NonNullable<RuntimePolicyDocument['environment']>;
};

interface StructuredCommandValidationContext {
  allowedEnv: readonly string[];
}

const normalizeChecksPolicy = (
  input: RuntimePolicyDocument['checks'],
  commandValidation: StructuredCommandValidationContext,
): NonNullable<RuntimePolicyDocument['checks']> => {
  if (input === undefined) {
    return { required: [] };
  }
  assertPlainObject(input, 'checks must be an object.');
  assertExactKeys(input, ['required']);
  const required = optionalArrayField(input, 'required') ?? [];
  return { required: required.map((check) => normalizePolicyRequiredCheck(check, commandValidation)) };
};

const normalizePolicyRequiredCheck = (
  input: unknown,
  commandValidation: StructuredCommandValidationContext,
): PolicyRequiredCheckSpec => {
  assertPlainObject(input, 'checks.required entries must be objects.');
  assertExactKeys(input, [
    'check_id',
    'display_name',
    'command_template',
    'command',
    'timeout_ms',
    'output_limit_bytes',
    'visibility',
    'source_write_policy',
    'blocks_review',
  ]);
  return omitUndefined({
    check_id: stringField(input, 'check_id'),
    display_name: optionalStringField(input, 'display_name'),
    command_template: optionalStringField(input, 'command_template'),
    command: input.command === undefined ? undefined : validateStructuredCommandSpec(input.command, commandValidation),
    timeout_ms: optionalPositiveIntegerField(input, 'timeout_ms'),
    output_limit_bytes: optionalPositiveIntegerField(input, 'output_limit_bytes'),
    visibility: optionalEnumField(input, 'visibility', ['internal', 'public_safe']),
    source_write_policy: optionalEnumField(input, 'source_write_policy', ['read_only', 'path_policy_scoped', 'artifact_only']),
    blocks_review: optionalBooleanField(input, 'blocks_review'),
  }) as PolicyRequiredCheckSpec;
};

const normalizeHooksPolicy = (
  input: RuntimePolicyDocument['hooks'],
  commandValidation: StructuredCommandValidationContext,
): NonNullable<RuntimePolicyDocument['hooks']> => {
  if (input === undefined) {
    return { before_run: [], after_run: [] };
  }
  assertPlainObject(input, 'hooks must be an object.');
  assertExactKeys(input, ['before_run', 'after_run']);
  return {
    before_run: (optionalArrayField(input, 'before_run') ?? []).map((hook) => normalizeHookSpec(hook, commandValidation)),
    after_run: (optionalArrayField(input, 'after_run') ?? []).map((hook) => normalizeHookSpec(hook, commandValidation)),
  };
};

const normalizeHookSpec = (input: unknown, commandValidation: StructuredCommandValidationContext): HookSpec => {
  assertPlainObject(input, 'hook entries must be objects.');
  assertExactKeys(input, ['hook_id', 'command_template', 'command', 'timeout_ms', 'output_limit_bytes', 'visibility', 'source_write_policy']);
  return omitUndefined({
    hook_id: optionalStringField(input, 'hook_id'),
    command_template: optionalStringField(input, 'command_template'),
    command: input.command === undefined ? undefined : validateStructuredCommandSpec(input.command, commandValidation),
    timeout_ms: optionalPositiveIntegerField(input, 'timeout_ms'),
    output_limit_bytes: optionalPositiveIntegerField(input, 'output_limit_bytes'),
    visibility: optionalEnumField(input, 'visibility', ['internal', 'public_safe']),
    source_write_policy: optionalEnumField(input, 'source_write_policy', ['read_only', 'path_policy_scoped', 'artifact_only']),
  }) as HookSpec;
};

const normalizeFallbackPolicy = (
  input: RuntimePolicyDocument['fallback'],
  commandValidation: StructuredCommandValidationContext,
): NonNullable<RuntimePolicyDocument['fallback']> => {
  if (input === undefined) {
    return { mode: 'disabled' };
  }
  assertPlainObject(input, 'fallback must be an object.');
  assertExactKeys(input, ['mode', 'command_template', 'command', 'timeout_ms', 'output_limit_bytes', 'visibility', 'source_write_policy']);
  return omitUndefined({
    mode: optionalEnumField(input, 'mode', ['disabled', 'codex_exec']) ?? 'disabled',
    command_template: optionalStringField(input, 'command_template'),
    command: input.command === undefined ? undefined : validateStructuredCommandSpec(input.command, commandValidation),
    timeout_ms: optionalPositiveIntegerField(input, 'timeout_ms'),
    output_limit_bytes: optionalPositiveIntegerField(input, 'output_limit_bytes'),
    visibility: optionalEnumField(input, 'visibility', ['internal', 'public_safe']),
    source_write_policy: optionalEnumField(input, 'source_write_policy', ['read_only', 'path_policy_scoped', 'artifact_only']),
  }) as FallbackSpec;
};

const normalizeArtifactPolicy = (input: RuntimePolicyDocument['artifacts']): NonNullable<RuntimePolicyDocument['artifacts']> => {
  if (input === undefined) {
    return defaultArtifactPolicy();
  }
  assertPlainObject(input, 'artifacts must be an object.');
  assertExactKeys(input, ['default_visibility', 'max_artifact_bytes', 'max_run_artifact_bytes', 'public_safe_kinds']);
  return omitUndefined({
    default_visibility: optionalEnumField(input, 'default_visibility', ['internal', 'public_safe']) ?? 'internal',
    max_artifact_bytes: optionalPositiveIntegerField(input, 'max_artifact_bytes'),
    max_run_artifact_bytes: optionalPositiveIntegerField(input, 'max_run_artifact_bytes'),
    public_safe_kinds: optionalStringArrayField(input, 'public_safe_kinds'),
  }) as NonNullable<RuntimePolicyDocument['artifacts']>;
};

const normalizePromptPolicy = (input: RuntimePolicyDocument['prompt_policy']): NonNullable<RuntimePolicyDocument['prompt_policy']> => {
  if (input === undefined) {
    return defaultPromptPolicy();
  }
  assertPlainObject(input, 'prompt_policy must be an object.');
  assertExactKeys(input, ['include_workflow_body', 'body_visibility']);
  return {
    include_workflow_body: optionalBooleanField(input, 'include_workflow_body') ?? true,
    body_visibility: optionalEnumField(input, 'body_visibility', ['internal', 'public_safe']) ?? 'internal',
  };
};

const normalizeObservabilityPolicy = (input: RuntimePolicyDocument['observability']): NonNullable<RuntimePolicyDocument['observability']> => {
  if (input === undefined) {
    return {};
  }
  assertPlainObject(input, 'observability must be an object.');
  assertExactKeys(input, ['public_summary']);
  return omitUndefined({ public_summary: optionalStringField(input, 'public_summary') }) as NonNullable<RuntimePolicyDocument['observability']>;
};

const validateRuntimePolicy = (policy: RuntimePolicyDocument): void => {
  validateEnvironmentAllow(policy.environment?.allow ?? []);
  if (policy.codex?.network_mode === 'egress_allowlist' && policy.codex.egress_allowlist_digest === undefined) {
    throw new Error('codex.egress_allowlist_digest is required for egress_allowlist network mode.');
  }
};

const validateEnvironmentAllow = (allow: readonly string[]): void => {
  for (const name of allow) {
    if (name.includes('*')) {
      throw new Error(`Environment allowlist entry ${name} must not use wildcards.`);
    }
    if (dangerousExactEnvNames.has(name) || name.startsWith('DYLD_') || name.startsWith('GIT_CONFIG_')) {
      throw new Error(`Environment allowlist entry ${name} is dangerous by default.`);
    }
    if (/(^|_)(TOKEN|KEY|SECRET|PASSWORD)$/i.test(name)) {
      throw new Error(`Environment allowlist entry ${name} looks secret-bearing.`);
    }
  }
};

const defaultCodexPolicy = (primaryExecutor: 'cli' | 'app_server' | 'mock'): NonNullable<RuntimePolicyDocument['codex']> => ({
  primary_executor: primaryExecutor,
  network_mode: 'disabled',
});

const defaultWorkspacePolicy = (): NonNullable<RuntimePolicyDocument['workspace']> => ({
  worktree_dir: '.worktrees',
  cleanup: 'run_workspace_only',
  source_snapshot: 'required',
});

const defaultCommandPolicy = (): NonNullable<RuntimePolicyDocument['commands']> => ({
  trusted_toolchain: 'node',
  templates: {},
  safe_git_profile: 'forgeloop_default',
});

const defaultPromptPolicy = (): NonNullable<RuntimePolicyDocument['prompt_policy']> => ({
  include_workflow_body: true,
  body_visibility: 'internal',
});

const defaultArtifactPolicy = (): NonNullable<RuntimePolicyDocument['artifacts']> => ({
  default_visibility: 'internal',
});

const emptyRuntimePolicyPayload = (): FrozenRuntimePolicyPayload => {
  const normalizedBodyDigest = digest('');
  const withoutPayloadDigest = {
    parser_version: RUNTIME_POLICY_PARSER_VERSION,
    policy_source_path: RUNTIME_POLICY_SOURCE_PATH as typeof RUNTIME_POLICY_SOURCE_PATH,
    normalized_front_matter: {},
    normalized_markdown_body: '',
    normalized_body_digest: normalizedBodyDigest,
  };
  return {
    ...withoutPayloadDigest,
    normalized_payload_digest: digest(withoutPayloadDigest),
  };
};

const blockedPolicy = (status: 'missing' | 'invalid', loadedAt: string, message: string): RuntimePolicyBlocked => ({
  status,
  policy_source_path: RUNTIME_POLICY_SOURCE_PATH,
  policy_loaded_at: loadedAt,
  policy_last_known_good: false,
  blocker_code: status === 'missing' ? 'runtime_policy_missing' : 'runtime_policy_invalid',
  diagnostics: [diagnostic(status === 'missing' ? 'runtime_policy_missing' : 'runtime_policy_invalid', message)],
});

const diagnostic = (code: RuntimePolicyDiagnostic['code'], message: string): RuntimePolicyDiagnostic => ({
  code,
  message,
  retryable: false,
});

const snapshotError = (
  publicCode: 'required_check_command_invalid' | 'policy_snapshot_invalid',
  message: string,
  details: Record<string, unknown> = {},
): RuntimePolicyError => new RuntimePolicyError(publicCode, message, details);

const assertUniqueCheckIds = (checks: readonly { check_id: string }[], label: string): void => {
  const seen = new Set<string>();
  for (const check of checks) {
    if (seen.has(check.check_id)) {
      throw snapshotError('policy_snapshot_invalid', `${label} check ids must be unique.`);
    }
    seen.add(check.check_id);
  }
};

const normalizeMarkdownBody = (body: string): string => body.replace(/\r\n/g, '\n').trimEnd();

type CanonicalJsonValue = null | boolean | number | string | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue };

const canonicalize = (value: unknown): CanonicalJsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .reduce<Record<string, CanonicalJsonValue>>((accumulator, [key, entry]) => {
        accumulator[key] = canonicalize(entry);
        return accumulator;
      }, {});
  }
  return null;
};

const compareCodeUnits = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const stableJson = (value: unknown): string => JSON.stringify(canonicalize(value));

const digest = (value: unknown): string => `sha256:${createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex')}`;

const deepCloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const assertPlainObject: (value: unknown, message: string) => asserts value is Record<string, unknown> = (value, message) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(message);
  }
};

const assertExactKeys = (value: object, allowedKeys: readonly string[]): void => {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`Unknown runtime policy field: ${key}.`);
    }
  }
};

const stringField = (value: object, key: string): string => {
  const field = (value as Record<string, unknown>)[key];
  if (typeof field !== 'string' || field.length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return field;
};

const optionalStringField = (value: object, key: string): string | undefined => {
  const field = (value as Record<string, unknown>)[key];
  if (field === undefined) {
    return undefined;
  }
  if (typeof field !== 'string' || field.length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return field;
};

const stringArrayField = (value: object, key: string): string[] => {
  const field = (value as Record<string, unknown>)[key];
  if (!Array.isArray(field) || !field.every((entry) => typeof entry === 'string')) {
    throw new Error(`${key} must be a string array.`);
  }
  return field;
};

const optionalStringArrayField = (value: object, key: string): string[] | undefined => {
  const field = (value as Record<string, unknown>)[key];
  if (field === undefined) {
    return undefined;
  }
  return stringArrayField(value, key);
};

const optionalStringRecordField = (value: object, key: string): Record<string, string> | undefined => {
  const field = (value as Record<string, unknown>)[key];
  if (field === undefined) {
    return undefined;
  }
  assertPlainObject(field, `${key} must be an object.`);
  if (!Object.values(field).every((entry) => typeof entry === 'string')) {
    throw new Error(`${key} values must be strings.`);
  }
  return field as Record<string, string>;
};

const optionalPositiveIntegerField = (value: object, key: string): number | undefined => {
  const field = (value as Record<string, unknown>)[key];
  if (field === undefined) {
    return undefined;
  }
  if (!Number.isInteger(field) || typeof field !== 'number' || field <= 0) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return field;
};

const optionalBooleanField = (value: object, key: string): boolean | undefined => {
  const field = (value as Record<string, unknown>)[key];
  if (field === undefined) {
    return undefined;
  }
  if (typeof field !== 'boolean') {
    throw new Error(`${key} must be a boolean.`);
  }
  return field;
};

const optionalArrayField = (value: object, key: string): unknown[] | undefined => {
  const field = (value as Record<string, unknown>)[key];
  if (field === undefined) {
    return undefined;
  }
  if (!Array.isArray(field)) {
    throw new Error(`${key} must be an array.`);
  }
  return field;
};

const optionalEnumField = <T extends string>(value: object, key: string, values: readonly T[]): T | undefined => {
  const field = (value as Record<string, unknown>)[key];
  if (field === undefined) {
    return undefined;
  }
  if (typeof field !== 'string' || !values.includes(field as T)) {
    throw new Error(`${key} must be one of ${values.join(', ')}.`);
  }
  return field as T;
};

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  typeof error === 'object' && error !== null && 'code' in error;

const omitUndefined = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
