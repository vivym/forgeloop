import { createHash } from 'node:crypto';
import { accessSync, constants as fsConstants, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep, win32 } from 'node:path';

import type { ArtifactRef } from '@forgeloop/contracts';

export type Visibility = 'internal' | 'public_safe';
export type SourceWritePolicy = 'read_only' | 'path_policy_scoped' | 'artifact_only';
export type CwdPolicy = 'workspace_root' | { repo_relative: string };

export interface StructuredCommandSpec {
  executable: string;
  args: string[];
  cwd: CwdPolicy;
  timeout_ms?: number;
  output_limit_bytes?: number;
  env?: Record<string, string>;
  visibility?: Visibility;
  source_write_policy?: SourceWritePolicy;
}

export interface StructuredCommandResult {
  exit_code: number | null;
  timed_out: boolean;
  stdout_ref?: string;
  stderr_ref?: string;
  stdout_truncated: boolean;
  stderr_truncated: boolean;
  visibility: Visibility;
  public_summary: string;
  internal_diagnostic_ref?: string;
  output_artifacts?: StructuredCommandOutputArtifacts;
}

export interface StructuredCommandOutputArtifacts {
  stdout?: ArtifactRef;
  stderr?: ArtifactRef;
  internal_diagnostic?: ArtifactRef;
}

export interface StructuredCommandValidationOptions {
  hardMaxTimeoutMs?: number;
  hardMaxOutputLimitBytes?: number;
  allowedEnv?: readonly string[];
  reviewedSecretEnv?: readonly string[];
}

export interface CommandReference {
  command_template?: string;
  command?: StructuredCommandSpec;
  timeout_ms?: number;
  output_limit_bytes?: number;
  visibility?: Visibility;
  source_write_policy?: SourceWritePolicy;
}

export interface TrustedToolchainConfig {
  root_paths: readonly string[];
  executable_paths: Readonly<Record<string, string>>;
  path_entries?: readonly string[];
  writable?: boolean;
}

export interface SafeGitCommandSpecInput {
  args: string[];
  cwd: CwdPolicy;
  timeout_ms?: number;
  output_limit_bytes?: number;
  visibility?: Visibility;
  source_write_policy?: SourceWritePolicy;
}

export interface MaterializedStructuredCommand extends Omit<
  StructuredCommandSpec,
  'timeout_ms' | 'output_limit_bytes' | 'env' | 'visibility' | 'source_write_policy'
> {
  timeout_ms: number;
  output_limit_bytes: number;
  env: Record<string, string>;
  visibility: Visibility;
  source_write_policy: SourceWritePolicy;
  resolved_executable_path: string;
  executable_identity_digest: string;
  path_entries: string[];
}

export interface StructuredCommandDigestInput {
  command: MaterializedStructuredCommand;
  resource_limit_digest: string;
  run_id: string;
  workspace_root: string;
  artifact_root: string;
  sandbox_output_root_policy: string;
  artifact_quota_policy: string;
}

export interface PrimaryExecutorDigestBinding {
  executor_type: 'local_codex';
  prompt_ref: string;
  prompt_digest: string;
  run_spec_digest: string;
}

export class StructuredCommandError extends Error {
  constructor(
    readonly code: 'structured_command_invalid' | 'required_check_command_invalid',
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'StructuredCommandError';
  }
}

const hardDefaultTimeoutMs = 120_000;
const hardDefaultOutputLimitBytes = 1_000_000;
const controlCharacterPattern = /[\x00-\x1f\x7f]/;

const dangerousExactEnvNames = new Set([
  'PATH',
  'NODE_OPTIONS',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'GIT_ASKPASS',
  'SSH_AUTH_SOCK',
  'BASH_ENV',
  'ENV',
  'HOME',
]);

const safeInternalGitEnv: Record<string, string> = {
  GIT_ATTR_NOSYSTEM: '1',
  GIT_CONFIG: '/dev/null',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_PAGER: 'cat',
  GIT_TERMINAL_PROMPT: '0',
};

const safeGitProfileArgs = [
  '-c',
  'advice.detachedHead=false',
  '-c',
  'core.askPass=',
  '-c',
  'core.attributesFile=/dev/null',
  '-c',
  'core.excludesFile=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'credential.helper=',
  '-c',
  'diff.external=',
  '-c',
  'filter.lfs.clean=',
  '-c',
  'filter.lfs.smudge=',
  '-c',
  'filter.lfs.process=',
  '-c',
  'filter.lfs.required=false',
  '-c',
  'protocol.ext.allow=never',
  '-c',
  'protocol.file.allow=always',
  '-c',
  'submodule.recurse=false',
];

const sourceWriteStrictness: Record<SourceWritePolicy, number> = {
  read_only: 0,
  artifact_only: 1,
  path_policy_scoped: 2,
};

const commandError = (
  code: StructuredCommandError['code'],
  message: string,
  details: Record<string, unknown> = {},
): StructuredCommandError => new StructuredCommandError(code, message, details);

export const validateStructuredCommandSpec = (
  input: unknown,
  options: StructuredCommandValidationOptions = {},
): StructuredCommandSpec => {
  assertPlainObject(input, 'Structured command must be an object.');
  assertExactKeys(input, ['executable', 'args', 'cwd', 'timeout_ms', 'output_limit_bytes', 'env', 'visibility', 'source_write_policy']);

  const executable = stringField(input, 'executable');
  if (executable.length === 0 || executable.startsWith('/') || executable.includes('/') || executable.includes('\\')) {
    throw commandError('structured_command_invalid', 'Structured command executable must be a logical name.', { executable });
  }

  const args = stringArrayField(input, 'args');
  const cwd = normalizeCwd(input.cwd);
  const timeoutMs = optionalPositiveIntegerField(input, 'timeout_ms');
  const outputLimitBytes = optionalPositiveIntegerField(input, 'output_limit_bytes');
  const hardMaxTimeoutMs = options.hardMaxTimeoutMs ?? hardDefaultTimeoutMs;
  const hardMaxOutputLimitBytes = options.hardMaxOutputLimitBytes ?? hardDefaultOutputLimitBytes;
  if (timeoutMs !== undefined && timeoutMs > hardMaxTimeoutMs) {
    throw commandError('structured_command_invalid', 'Structured command timeout exceeds the hard maximum.', {
      timeout_ms: timeoutMs,
      hardMaxTimeoutMs,
    });
  }
  if (outputLimitBytes !== undefined && outputLimitBytes > hardMaxOutputLimitBytes) {
    throw commandError('structured_command_invalid', 'Structured command output limit exceeds the hard maximum.', {
      output_limit_bytes: outputLimitBytes,
      hardMaxOutputLimitBytes,
    });
  }

  const env = optionalStringRecordField(input, 'env');
  if (env !== undefined) {
    validateCommandEnv(env, options);
  }

  const visibility = optionalEnumField(input, 'visibility', ['internal', 'public_safe']);
  const sourceWritePolicy = optionalEnumField(input, 'source_write_policy', [
    'read_only',
    'path_policy_scoped',
    'artifact_only',
  ]);

  return {
    executable,
    args,
    cwd,
    ...(timeoutMs === undefined ? {} : { timeout_ms: timeoutMs }),
    ...(outputLimitBytes === undefined ? {} : { output_limit_bytes: outputLimitBytes }),
    ...(env === undefined ? {} : { env }),
    ...(visibility === undefined ? {} : { visibility }),
    ...(sourceWritePolicy === undefined ? {} : { source_write_policy: sourceWritePolicy }),
  };
};

export const legacyRequiredCheckToStructuredCommand = (
  command: string,
  options: StructuredCommandValidationOptions = {},
): StructuredCommandSpec => {
  if (controlCharacterPattern.test(command) || /["'`$<>|&;*()[\]{}?~]/.test(command) || /(^|\s)[A-Za-z_][A-Za-z0-9_]*=/.test(command)) {
    throw commandError('required_check_command_invalid', 'Legacy required check command uses shell syntax.');
  }
  const parts = command.trim().split(/\s+/).filter(Boolean);
  const executable = parts[0];
  if (executable === undefined || executable.startsWith('/') || executable.includes('\\') || executable.includes('/')) {
    throw commandError('required_check_command_invalid', 'Legacy required check command executable is invalid.');
  }
  try {
    return validateStructuredCommandSpec(
      {
        executable,
        args: parts.slice(1),
        cwd: 'workspace_root',
      },
      options,
    );
  } catch (error) {
    if (error instanceof StructuredCommandError) {
      throw commandError('required_check_command_invalid', error.message, error.details);
    }
    throw error;
  }
};

export const materializeCommandReference = (input: {
  reference: CommandReference;
  templates?: Readonly<Record<string, StructuredCommandSpec>>;
  defaultSourceWritePolicy: SourceWritePolicy;
  defaultVisibility?: Visibility;
  defaultTimeoutMs?: number;
  defaultOutputLimitBytes?: number;
  hardCaps?: StructuredCommandValidationOptions;
}): StructuredCommandSpec => {
  const hasTemplate = input.reference.command_template !== undefined;
  const hasInlineCommand = input.reference.command !== undefined;
  if (hasTemplate === hasInlineCommand) {
    throw commandError('structured_command_invalid', 'Command references must specify exactly one command source.');
  }

  const baseCommand = hasTemplate
    ? commandTemplate(input.templates ?? {}, input.reference.command_template)
    : input.reference.command;
  const validated = validateStructuredCommandSpec(baseCommand, input.hardCaps);
  const timeoutMs = stricterNumberOverride(
    validated.timeout_ms ?? input.defaultTimeoutMs,
    input.reference.timeout_ms,
    'timeout_ms',
  );
  const outputLimitBytes = stricterNumberOverride(
    validated.output_limit_bytes ?? input.defaultOutputLimitBytes,
    input.reference.output_limit_bytes,
    'output_limit_bytes',
  );
  const visibility = stricterVisibilityOverride(validated.visibility ?? input.defaultVisibility, input.reference.visibility);
  const sourceWritePolicy = stricterSourceWriteOverride(
    validated.source_write_policy ?? input.defaultSourceWritePolicy,
    input.reference.source_write_policy,
  );

  return validateStructuredCommandSpec(
    {
      ...validated,
      ...(timeoutMs === undefined ? {} : { timeout_ms: timeoutMs }),
      ...(outputLimitBytes === undefined ? {} : { output_limit_bytes: outputLimitBytes }),
      ...(visibility === undefined ? {} : { visibility }),
      source_write_policy: sourceWritePolicy,
    },
    input.hardCaps,
  );
};

export const materializeTrustedToolchainCommand = (input: {
  command: StructuredCommandSpec;
  toolchain: TrustedToolchainConfig;
  workspaceRoot: string;
  artifactRoot: string;
  tempRoot?: string;
  hardCaps?: StructuredCommandValidationOptions;
}): MaterializedStructuredCommand => {
  const command = validateStructuredCommandSpec(input.command, input.hardCaps);
  const trustedToolchain = validateTrustedToolchain(input.toolchain, {
    workspaceRoot: input.workspaceRoot,
    artifactRoot: input.artifactRoot,
    ...(input.tempRoot === undefined ? {} : { tempRoot: input.tempRoot }),
  });
  const executablePath = input.toolchain.executable_paths[command.executable];
  if (executablePath === undefined) {
    throw commandError('structured_command_invalid', 'Executable is not provided by the trusted toolchain.', {
      executable: command.executable,
    });
  }
  const normalizedExecutable = canonicalExecutableFile(executablePath, 'Trusted executable path must be an executable file.');
  assertOutsideDisallowedRuntimeRoots(normalizedExecutable, trustedToolchain.disallowed_roots);
  const matchingRoot = trustedToolchain.root_paths.find((root) => pathIsInside(normalizedExecutable, root));
  if (matchingRoot === undefined) {
    throw commandError('structured_command_invalid', 'Trusted executable must live under a trusted toolchain root.', {
      executable_path: executablePath,
    });
  }
  assertNonWritableAncestors(dirname(normalizedExecutable));

  return {
    ...command,
    timeout_ms: command.timeout_ms ?? input.hardCaps?.hardMaxTimeoutMs ?? hardDefaultTimeoutMs,
    output_limit_bytes: command.output_limit_bytes ?? input.hardCaps?.hardMaxOutputLimitBytes ?? hardDefaultOutputLimitBytes,
    env: command.env ?? {},
    visibility: command.visibility ?? 'internal',
    source_write_policy: command.source_write_policy ?? 'read_only',
    resolved_executable_path: normalizedExecutable,
    executable_identity_digest: executableFileDigest(normalizedExecutable),
    path_entries: trustedToolchain.path_entries,
  };
};

export const safeGitCommandSpec = (input: SafeGitCommandSpecInput): StructuredCommandSpec => {
  const command = validateStructuredCommandSpec({
    executable: 'git',
    args: [...safeGitProfileArgs, ...input.args],
    cwd: input.cwd,
    ...(input.timeout_ms === undefined ? {} : { timeout_ms: input.timeout_ms }),
    ...(input.output_limit_bytes === undefined ? {} : { output_limit_bytes: input.output_limit_bytes }),
    ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
    source_write_policy: input.source_write_policy ?? 'read_only',
  });
  return { ...command, env: { ...safeInternalGitEnv } };
};

export const materializeSafeGitCommand = (input: {
  command: StructuredCommandSpec;
  toolchain: TrustedToolchainConfig;
  workspaceRoot: string;
  artifactRoot: string;
  tempRoot?: string;
  hardCaps?: StructuredCommandValidationOptions;
}): MaterializedStructuredCommand => {
  const { env: _safeInternalEnv, ...commandWithoutEnv } = input.command;
  const materialized = materializeTrustedToolchainCommand({
    command: commandWithoutEnv,
    toolchain: input.toolchain,
    workspaceRoot: input.workspaceRoot,
    artifactRoot: input.artifactRoot,
    ...(input.tempRoot === undefined ? {} : { tempRoot: input.tempRoot }),
    ...(input.hardCaps === undefined ? {} : { hardCaps: input.hardCaps }),
  });
  return {
    ...materialized,
    env: { ...safeInternalGitEnv },
  };
};

export const structuredCommandDigest = (input: StructuredCommandDigestInput): string => {
  assertPlainObject(input, 'Structured command digest input must be an object.');
  assertExactKeys(input, [
    'command',
    'resource_limit_digest',
    'run_id',
    'workspace_root',
    'artifact_root',
    'sandbox_output_root_policy',
    'artifact_quota_policy',
  ]);
  assertPlainObject(input.command, 'Structured command digest requires a materialized command.');
  assertExactKeys(input.command, [
    'executable',
    'args',
    'cwd',
    'timeout_ms',
    'output_limit_bytes',
    'env',
    'visibility',
    'source_write_policy',
    'resolved_executable_path',
    'executable_identity_digest',
    'path_entries',
  ]);
  const env = validateMaterializedEnv(requiredStringRecordField(input.command, 'env'));
  const command = validateStructuredCommandSpec({
    executable: input.command.executable,
    args: input.command.args,
    cwd: input.command.cwd,
    timeout_ms: requiredPositiveIntegerField(input.command, 'timeout_ms'),
    output_limit_bytes: requiredPositiveIntegerField(input.command, 'output_limit_bytes'),
    visibility: requiredEnumField(input.command, 'visibility', ['internal', 'public_safe']),
    source_write_policy: requiredEnumField(input.command, 'source_write_policy', ['read_only', 'path_policy_scoped', 'artifact_only']),
  });
  const resolvedExecutablePath = normalizedAbsolutePath(
    stringField(input.command, 'resolved_executable_path'),
    'Structured command digest requires a resolved executable path.',
  );
  const executableIdentityDigest = digestSha256Field(input.command, 'executable_identity_digest');
  const pathEntries = stringArrayField(input.command, 'path_entries').map((entry) =>
    normalizedAbsolutePath(entry, 'Structured command digest PATH entries must be absolute.'),
  );

  return digest({
    command: {
      ...command,
      env,
      resolved_executable_path: resolvedExecutablePath,
      executable_identity_digest: executableIdentityDigest,
      path_entries: pathEntries,
    },
    resource_limit_digest: digestBindingString(input, 'resource_limit_digest'),
    run_id: digestBindingString(input, 'run_id'),
    workspace_root: normalizedAbsolutePath(digestBindingString(input, 'workspace_root'), 'Workspace root must be absolute.'),
    artifact_root: normalizedAbsolutePath(digestBindingString(input, 'artifact_root'), 'Artifact root must be absolute.'),
    sandbox_output_root_policy: digestBindingString(input, 'sandbox_output_root_policy'),
    artifact_quota_policy: digestBindingString(input, 'artifact_quota_policy'),
  });
};

export const primaryExecutorCommandDigest = (
  input: StructuredCommandDigestInput & { primary_executor: PrimaryExecutorDigestBinding },
): string => {
  const { primary_executor: primaryExecutor, ...structuredInput } = input;
  assertPlainObject(primaryExecutor, 'Primary executor digest binding must be an object.');
  assertExactKeys(primaryExecutor, ['executor_type', 'prompt_ref', 'prompt_digest', 'run_spec_digest']);
  const executorType = requiredEnumField(primaryExecutor, 'executor_type', ['local_codex']);
  const promptRef = digestBindingString(primaryExecutor, 'prompt_ref');
  const promptDigest = digestSha256Field(primaryExecutor, 'prompt_digest');
  const runSpecDigest = digestSha256Field(primaryExecutor, 'run_spec_digest');

  return digest({
    structured_command_digest: structuredCommandDigest(structuredInput),
    primary_executor: {
      executor_type: executorType,
      prompt_ref: promptRef,
      prompt_digest: promptDigest,
      run_spec_digest: runSpecDigest,
    },
  });
};

export const structuredCommandResultFromGovernor = (input: {
  exit_code: number | null;
  timed_out?: boolean;
  stdout_ref?: string;
  stderr_ref?: string;
  stdout_truncated?: boolean;
  stderr_truncated?: boolean;
  visibility?: Visibility;
  public_summary?: string;
  internal_diagnostic_ref?: string;
  output_artifacts?: StructuredCommandOutputArtifacts;
}): StructuredCommandResult => ({
  exit_code: input.exit_code,
  timed_out: input.timed_out ?? false,
  ...(input.stdout_ref === undefined ? {} : { stdout_ref: input.stdout_ref }),
  ...(input.stderr_ref === undefined ? {} : { stderr_ref: input.stderr_ref }),
  stdout_truncated: input.stdout_truncated ?? false,
  stderr_truncated: input.stderr_truncated ?? false,
  visibility: input.visibility ?? 'internal',
  public_summary: input.public_summary ?? (input.timed_out === true ? 'Command timed out.' : 'Command completed.'),
  ...(input.internal_diagnostic_ref === undefined ? {} : { internal_diagnostic_ref: input.internal_diagnostic_ref }),
  ...(input.output_artifacts === undefined ? {} : { output_artifacts: input.output_artifacts }),
});

const commandTemplate = (
  templates: Readonly<Record<string, StructuredCommandSpec>>,
  templateName: string | undefined,
): StructuredCommandSpec => {
  if (templateName === undefined || templateName.trim().length === 0) {
    throw commandError('structured_command_invalid', 'Command template name is required.');
  }
  const template = templates[templateName];
  if (template === undefined) {
    throw commandError('structured_command_invalid', `Missing command template ${templateName}.`);
  }
  return template;
};

const stricterNumberOverride = (
  base: number | undefined,
  override: number | undefined,
  field: 'timeout_ms' | 'output_limit_bytes',
): number | undefined => {
  if (override === undefined) {
    return base;
  }
  if (base !== undefined && override > base) {
    throw commandError('structured_command_invalid', `Command override cannot raise ${field}.`, {
      [field]: override,
      base,
    });
  }
  return override;
};

const stricterVisibilityOverride = (base: Visibility | undefined, override: Visibility | undefined): Visibility | undefined => {
  if (override === undefined) {
    return base;
  }
  const effectiveBase = base ?? 'internal';
  if (effectiveBase === 'internal' && override === 'public_safe') {
    throw commandError('structured_command_invalid', 'Command override cannot broaden visibility.');
  }
  return override;
};

const stricterSourceWriteOverride = (base: SourceWritePolicy, override: SourceWritePolicy | undefined): SourceWritePolicy => {
  if (override === undefined) {
    return base;
  }
  if (sourceWriteStrictness[override] > sourceWriteStrictness[base]) {
    throw commandError('structured_command_invalid', 'Command override cannot broaden source write policy.');
  }
  return override;
};

const normalizeCwd = (cwd: unknown): CwdPolicy => {
  if (cwd === 'workspace_root') {
    return cwd;
  }
  assertPlainObject(cwd, 'Structured command cwd must be workspace_root or repo_relative.');
  assertExactKeys(cwd, ['repo_relative']);
  const repoRelative = stringField(cwd, 'repo_relative');
  if (
    controlCharacterPattern.test(repoRelative) ||
    repoRelative.length === 0 ||
    repoRelative.startsWith('/') ||
    isAbsolute(repoRelative) ||
    win32.isAbsolute(repoRelative) ||
    repoRelative.includes('\\') ||
    repoRelative.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw commandError('structured_command_invalid', 'Structured command cwd must be repo-relative.', { cwd });
  }
  return { repo_relative: repoRelative };
};

const validateCommandEnv = (env: Record<string, string>, options: StructuredCommandValidationOptions): void => {
  const allowedEnv = new Set(options.allowedEnv ?? []);
  const reviewedSecretEnv = new Set(options.reviewedSecretEnv ?? []);
  for (const [name, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw commandError('structured_command_invalid', 'Command env names must be portable identifiers.', { env_name: name });
    }
    if (!allowedEnv.has(name)) {
      throw commandError('structured_command_invalid', 'Command env name is not allowed by policy.', { env_name: name });
    }
    if (dangerousExactEnvNames.has(name) || name.startsWith('DYLD_') || name.startsWith('GIT_CONFIG_')) {
      throw commandError('structured_command_invalid', 'Command env name is dangerous by default.', { env_name: name });
    }
    if (secretLikeEnvName(name) && !reviewedSecretEnv.has(name)) {
      throw commandError('structured_command_invalid', 'Command env name requires reviewed secret evidence.', { env_name: name });
    }
    if (value.includes('\0')) {
      throw commandError('structured_command_invalid', 'Command env values must not contain NUL bytes.', { env_name: name });
    }
  }
};

const validateMaterializedEnv = (env: Record<string, string>): Record<string, string> => {
  for (const [name, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw commandError('structured_command_invalid', 'Command env names must be portable identifiers.', { env_name: name });
    }
    if (safeInternalGitEnv[name] === value) {
      continue;
    }
    if (dangerousExactEnvNames.has(name) || name.startsWith('DYLD_') || name.startsWith('GIT_CONFIG_')) {
      throw commandError('structured_command_invalid', 'Command env name is dangerous by default.', { env_name: name });
    }
    if (value.includes('\0')) {
      throw commandError('structured_command_invalid', 'Command env values must not contain NUL bytes.', { env_name: name });
    }
  }
  return { ...env };
};

const validateTrustedToolchain = (
  toolchain: TrustedToolchainConfig,
  roots: { workspaceRoot: string; artifactRoot: string; tempRoot?: string },
): { root_paths: string[]; path_entries: string[]; disallowed_roots: string[] } => {
  if (toolchain.writable === true) {
    throw commandError('structured_command_invalid', 'Trusted toolchain roots must not be writable by runtime code.');
  }
  const disallowedRoots = [
    canonicalRootOrResolved(roots.workspaceRoot, 'Workspace root must be absolute.'),
    canonicalRootOrResolved(roots.artifactRoot, 'Artifact root must be absolute.'),
    ...(roots.tempRoot === undefined ? [] : [canonicalRootOrResolved(roots.tempRoot, 'Temp root must be absolute.')]),
  ];
  const rootPaths = toolchain.root_paths.map((root) => canonicalExistingDirectory(root, 'Toolchain root must be an existing directory.'));
  if (rootPaths.length === 0) {
    throw commandError('structured_command_invalid', 'Trusted toolchain must define at least one root.');
  }
  for (const root of rootPaths) {
    assertNonWritablePathAndAncestors(root);
    if (disallowedRoots.some((disallowedRoot) => pathIsInside(root, disallowedRoot))) {
      throw commandError('structured_command_invalid', 'Trusted toolchain root must not live under workspace, artifact, or temp roots.', {
        root,
      });
    }
  }
  const pathEntries = (toolchain.path_entries ?? []).map((entry) => {
    const normalizedEntry = canonicalExistingDirectory(entry, 'PATH entries must be existing directories.');
    assertOutsideDisallowedRuntimeRoots(normalizedEntry, disallowedRoots);
    if (!rootPaths.some((root) => pathIsInside(normalizedEntry, root))) {
      throw commandError('structured_command_invalid', 'PATH entries must live under trusted toolchain roots.', { entry });
    }
    assertNonWritablePathAndAncestors(normalizedEntry);
    return normalizedEntry;
  });

  return { root_paths: rootPaths, path_entries: pathEntries, disallowed_roots: disallowedRoots };
};

const secretLikeEnvName = (name: string): boolean => /(^|_)(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|AUTH)(_|$)/i.test(name);

const normalizedAbsolutePath = (path: string, message: string): string => {
  if (controlCharacterPattern.test(path) || !isAbsolute(path)) {
    throw commandError('structured_command_invalid', message, { path });
  }
  return resolve(path);
};

const canonicalRootOrResolved = (path: string, message: string): string => {
  const normalizedPath = normalizedAbsolutePath(path, message);
  try {
    return realpathSync(normalizedPath);
  } catch {
    return normalizedPath;
  }
};

const canonicalExistingDirectory = (path: string, message: string): string => {
  const normalizedPath = normalizedAbsolutePath(path, message);
  try {
    const canonicalPath = realpathSync(normalizedPath);
    if (!statSync(canonicalPath).isDirectory()) {
      throw commandError('structured_command_invalid', message, { path });
    }
    return canonicalPath;
  } catch (error) {
    if (error instanceof StructuredCommandError) {
      throw error;
    }
    throw commandError('structured_command_invalid', message, { path });
  }
};

const canonicalExecutableFile = (path: string, message: string): string => {
  const normalizedPath = normalizedAbsolutePath(path, message);
  try {
    const canonicalPath = realpathSync(normalizedPath);
    if (!statSync(canonicalPath).isFile()) {
      throw commandError('structured_command_invalid', message, { path });
    }
    accessSync(canonicalPath, fsConstants.X_OK);
    assertNonWritablePath(canonicalPath);
    assertNonWritableAncestors(dirname(canonicalPath));
    return canonicalPath;
  } catch (error) {
    if (error instanceof StructuredCommandError) {
      throw error;
    }
    throw commandError('structured_command_invalid', message, { path });
  }
};

const executableFileDigest = (path: string): string => `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;

const assertOutsideDisallowedRuntimeRoots = (path: string, disallowedRoots: readonly string[]): void => {
  const disallowedRoot = disallowedRoots.find((root) => pathIsInside(path, root));
  if (disallowedRoot !== undefined) {
    throw commandError('structured_command_invalid', 'Trusted toolchain paths must not live under workspace, artifact, or temp roots.', {
      path,
      disallowed_root: disallowedRoot,
    });
  }
};

const assertNonWritablePath = (path: string): void => {
  try {
    accessSync(path, fsConstants.W_OK);
  } catch {
    return;
  }
  throw commandError('structured_command_invalid', 'Trusted toolchain paths must not be writable by runtime code.', { path });
};

const assertNonWritablePathAndAncestors = (path: string): void => {
  assertNonWritablePath(path);
  assertNonWritableAncestors(dirname(path));
};

const assertNonWritableAncestors = (path: string): void => {
  let current = path;
  while (true) {
    assertNonWritablePath(current);
    const parent = dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
};

const pathIsInside = (candidate: string, root: string): boolean => {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && rel !== '..' && !isAbsolute(rel) && !rel.split(sep).includes('..'));
};

type CanonicalJsonValue = null | boolean | number | string | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue };

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
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .reduce<Record<string, CanonicalJsonValue>>((accumulator, [key, entry]) => {
        accumulator[key] = canonicalize(entry);
        return accumulator;
      }, {});
  }
  return null;
};

const digest = (value: unknown): string =>
  `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;

const digestBindingString = (value: Record<string, unknown>, key: string): string => {
  const binding = stringField(value, key);
  if (binding.length === 0 || controlCharacterPattern.test(binding)) {
    throw commandError('structured_command_invalid', 'Structured command digest binding is invalid.', { key });
  }
  return binding;
};

const digestSha256Field = (value: Record<string, unknown>, key: string): string => {
  const field = stringField(value, key);
  if (!/^sha256:[a-f0-9]{64}$/.test(field)) {
    throw commandError('structured_command_invalid', `Field ${key} must be a sha256 digest.`);
  }
  return field;
};

const assertPlainObject: (value: unknown, message: string) => asserts value is Record<string, unknown> = (value, message) => {
  if (!isPlainObject(value)) {
    throw commandError('structured_command_invalid', message);
  }
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertExactKeys = (value: Record<string, unknown>, keys: readonly string[]): void => {
  const actualKeys = Object.keys(value);
  const expected = new Set(keys);
  const unknownKeys = actualKeys.filter((key) => !expected.has(key));
  if (unknownKeys.length > 0) {
    throw commandError('structured_command_invalid', 'Unknown structured command field.', { unknown_keys: unknownKeys });
  }
};

const stringField = (value: Record<string, unknown>, key: string): string => {
  const field = value[key];
  if (typeof field !== 'string') {
    throw commandError('structured_command_invalid', `Field ${key} must be a string.`);
  }
  return field;
};

const optionalPositiveIntegerField = (value: Record<string, unknown>, key: string): number | undefined => {
  const field = value[key];
  if (field === undefined) {
    return undefined;
  }
  if (typeof field !== 'number' || !Number.isInteger(field) || field <= 0) {
    throw commandError('structured_command_invalid', `Field ${key} must be a positive integer.`);
  }
  return field;
};

const requiredPositiveIntegerField = (value: Record<string, unknown>, key: string): number => {
  const field = optionalPositiveIntegerField(value, key);
  if (field === undefined) {
    throw commandError('structured_command_invalid', `Field ${key} must be a positive integer.`);
  }
  return field;
};

const stringArrayField = (value: Record<string, unknown>, key: string): string[] => {
  const field = value[key];
  if (!Array.isArray(field) || !field.every((entry) => typeof entry === 'string')) {
    throw commandError('structured_command_invalid', `Field ${key} must be an array of strings.`);
  }
  return [...field];
};

const optionalStringRecordField = (value: Record<string, unknown>, key: string): Record<string, string> | undefined => {
  const field = value[key];
  if (field === undefined) {
    return undefined;
  }
  if (!isPlainObject(field) || !Object.values(field).every((entry) => typeof entry === 'string')) {
    throw commandError('structured_command_invalid', `Field ${key} must be a string record.`);
  }
  return { ...field } as Record<string, string>;
};

const requiredStringRecordField = (value: Record<string, unknown>, key: string): Record<string, string> => {
  const field = optionalStringRecordField(value, key);
  if (field === undefined) {
    throw commandError('structured_command_invalid', `Field ${key} must be a string record.`);
  }
  return field;
};

const optionalEnumField = <T extends string>(value: Record<string, unknown>, key: string, allowed: readonly T[]): T | undefined => {
  const field = value[key];
  if (field === undefined) {
    return undefined;
  }
  if (typeof field !== 'string' || !allowed.includes(field as T)) {
    throw commandError('structured_command_invalid', `Field ${key} is invalid.`);
  }
  return field as T;
};

const requiredEnumField = <T extends string>(value: Record<string, unknown>, key: string, allowed: readonly T[]): T => {
  const field = optionalEnumField(value, key, allowed);
  if (field === undefined) {
    throw commandError('structured_command_invalid', `Field ${key} is invalid.`);
  }
  return field;
};
