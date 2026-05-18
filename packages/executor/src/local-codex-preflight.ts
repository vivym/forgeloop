import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

import type { ExecutorFailure, RunSpec } from '../../contracts/src/executor.js';
import type { PackageRuntimePolicySnapshot, RuntimeSafetyEnvironment } from '@forgeloop/domain';
import { preparePersistentGitWorktree } from './codex-worktree.js';
import type { ArtifactWriter } from './artifact-writer.js';
import type { ExecutorRuntimeSafetyConfig } from './runtime-safety-config.js';
import type { HookRunner, HookRunnerCommandContext } from './hook-runner.js';
import type { FrozenHookSpecs } from './hook-runner.js';
import type { PathSafety } from './path-safety.js';
import { compileEffectivePathPolicy, PathPolicyError, type RawPathPolicy } from './path-policy.js';
import type { ResourceGovernor, ResourceGovernorReadinessInput } from './resource-governor.js';
import { legacyRequiredCheckToStructuredCommand, StructuredCommandError } from './structured-command.js';
import { sourceDirtyEntriesFromPorcelain } from './source-repo-guard.js';

export type CommandChecker = (command: string) => Promise<boolean>;

export interface CommandRunOptions {
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
}

export interface CommandRunResult {
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: CommandRunOptions,
) => Promise<CommandRunResult>;

export interface CodexRuntimeReadyOptions {
  env?: NodeJS.ProcessEnv;
}

export interface CodexInvocation {
  workspacePath: string;
  prompt: string;
  env?: NodeJS.ProcessEnv;
}

export interface WorkspacePrepareSuccess {
  ok: true;
  workspacePath: string;
}

export interface WorkspacePrepareFailure {
  ok: false;
  message: string;
}

export type WorkspacePrepareResult = WorkspacePrepareSuccess | WorkspacePrepareFailure;

export interface LocalCodexEnvironment {
  commandExists: CommandChecker;
  isCodexRuntimeReady: (options?: CodexRuntimeReadyOptions) => Promise<boolean>;
  isGitRepo: (repoPath: string) => Promise<boolean>;
  resolveGitRef: (repoPath: string, ref: string) => Promise<boolean>;
  prepareWorkspace: (input: {
    repoPath: string;
    baseRef: string;
    runSessionId: string;
  }) => Promise<WorkspacePrepareResult>;
  isWorkspaceClean: (workspacePath: string) => Promise<boolean>;
  isWritableDirectory: (path: string) => Promise<boolean>;
  runCodex: (input: CodexInvocation) => Promise<void>;
  runCommand: CommandRunner;
}

export interface LocalCodexPreflightOptions {
  artifactRoot: string;
  environment?: LocalCodexEnvironment;
  codexEnv?: NodeJS.ProcessEnv;
  runtimeSafety?: LocalCodexRuntimeSafety;
}

export interface LocalCodexRuntimeSafety {
  config: ExecutorRuntimeSafetyConfig;
  frozenSnapshot?: PackageRuntimePolicySnapshot;
  pathSafety: PathSafety;
  artifactWriter: ArtifactWriter;
  bootstrapGovernor: ResourceGovernor;
  runGovernor: ResourceGovernor;
  hookRunner: HookRunner;
  hookCommandContext: HookRunnerCommandContext;
  maxHookTimeoutMs: number;
  runtimeEnvironment?: RuntimeSafetyEnvironment;
  mockRunContext?: ResourceGovernorReadinessInput;
}

export interface LocalCodexPreflightSuccess {
  ok: true;
  blockers: [];
  workspacePath: string;
  resolvedBaseRef: string;
}

export type StrictPreflightBlockerCode =
  | 'missing_codex_command'
  | 'codex_not_authenticated'
  | 'dangerous_mode_unconfirmed'
  | 'source_dirty_blocked'
  | 'durable_repo_unavailable'
  | 'worktree_create_failed'
  | 'policy_snapshot_missing'
  | 'policy_snapshot_invalid'
  | 'path_policy_declared_scope_rejected'
  | 'required_check_command_invalid'
  | 'runtime_hard_limits_unavailable'
  | 'primary_executor_governor_unavailable'
  | 'before_run_hook_failed'
  | 'before_run_hook_timed_out'
  | 'structured_command_invalid'
  | 'runtime_attestation_invalid'
  | 'sandbox_isolation_unavailable';

export interface StrictPreflightBlocker {
  code: StrictPreflightBlockerCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface StrictPreflightResult {
  ok: boolean;
  blockers: StrictPreflightBlocker[];
}

export interface LocalCodexPreflightFailure {
  ok: false;
  failure: ExecutorFailure;
  blockers: StrictPreflightBlocker[];
}

export type LocalCodexPreflightResult = LocalCodexPreflightSuccess | LocalCodexPreflightFailure;

export interface DefaultLocalCodexEnvironmentOptions {
  workspaceRoot?: string;
  commandRunner?: CommandRunner;
}

const failure = (
  message: string,
  retryable = false,
  blockers: StrictPreflightBlocker[] = [],
): LocalCodexPreflightFailure => ({
  ok: false,
  failure: {
    kind: 'preflight_failed',
    message,
    retryable,
  },
  blockers,
});

const blockerFailure = (
  code: StrictPreflightBlockerCode,
  message: string,
  details?: Record<string, unknown>,
  retryable = false,
): LocalCodexPreflightFailure =>
  failure(
    message,
    retryable,
    [
      {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    ],
  );

const runtimeSafetyBlockerFailure = (
  code: StrictPreflightBlockerCode,
  message: string,
  details?: Record<string, unknown>,
  retryable = false,
): LocalCodexPreflightFailure => blockerFailure(code, message, details, retryable);

const execFileCommandRunner: CommandRunner = async (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = execFile(command, [...args], options, (error, stdout, stderr) => {
      const result = {
        stdout: String(stdout),
        stderr: String(stderr),
      };

      if (error !== null) {
        const errorWithOutput = error as Error & { stdout?: string; stderr?: string };
        errorWithOutput.stdout = result.stdout;
        errorWithOutput.stderr = result.stderr;
        reject(errorWithOutput);
        return;
      }

      resolve(result);
    });

    child.stdin?.end();
  });

const commandExists = (runCommand: CommandRunner): CommandChecker => async (command) => {
  try {
    await runCommand(command, ['--version']);
    return true;
  } catch {
    return false;
  }
};

const isCodexRuntimeReady = (runCommand: CommandRunner) => async (options: CodexRuntimeReadyOptions = {}): Promise<boolean> => {
  try {
    await runCommand('codex', ['login', 'status'], options.env === undefined ? undefined : { env: options.env });
    return true;
  } catch {
    return false;
  }
};

const isGitRepo = (runCommand: CommandRunner) => async (repoPath: string): Promise<boolean> => {
  try {
    await runCommand('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoPath });
    return true;
  } catch {
    return false;
  }
};

const resolveGitRef = (runCommand: CommandRunner) => async (repoPath: string, ref: string): Promise<boolean> => {
  try {
    await runCommand('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: repoPath });
    return true;
  } catch {
    return false;
  }
};

const isWorkspaceClean = (runCommand: CommandRunner) => async (workspacePath: string): Promise<boolean> => {
  const { stdout } = await runCommand('git', ['status', '--porcelain'], { cwd: workspacePath });

  return stdout.trim().length === 0;
};

const isWritableDirectory = async (path: string): Promise<boolean> => {
  const probe = join(path, `.forgeloop-write-test-${Date.now()}`);

  try {
    await mkdir(path, { recursive: true });
    await writeFile(probe, '');
    await rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
};

export const createDefaultLocalCodexEnvironment = (
  options: DefaultLocalCodexEnvironmentOptions = {},
): LocalCodexEnvironment => {
  const runCommand = options.commandRunner ?? execFileCommandRunner;
  const environment: LocalCodexEnvironment = {
    commandExists: commandExists(runCommand),
    isCodexRuntimeReady: isCodexRuntimeReady(runCommand),
    isGitRepo: isGitRepo(runCommand),
    resolveGitRef: resolveGitRef(runCommand),
    isWorkspaceClean: isWorkspaceClean(runCommand),
    isWritableDirectory,
    runCodex: async () => {
      throw new Error('primary_executor_governor_unavailable: direct local Codex execution is disabled.');
    },
    runCommand,
    prepareWorkspace: async ({ repoPath, baseRef, runSessionId }) => {
      const input = { repoPath, baseRef, runSessionId };

      return preparePersistentGitWorktree(environment, input);
    },
  };

  return environment;
};

const validateRuntimeSafetyPreflight = async (
  runSpec: RunSpec,
  runtimeSafety: LocalCodexRuntimeSafety,
): Promise<LocalCodexPreflightFailure | undefined> => {
  const snapshot = runtimeSafety.frozenSnapshot;
  if (snapshot === undefined || snapshot === null) {
    return runtimeSafetyBlockerFailure('policy_snapshot_missing', 'Runtime policy snapshot is missing.');
  }
  if (snapshot.policy_snapshot_status !== undefined && snapshot.policy_snapshot_status !== 'captured') {
    return runtimeSafetyBlockerFailure('policy_snapshot_invalid', 'Runtime policy snapshot is not captured.', {
      policy_snapshot_status: snapshot.policy_snapshot_status,
    });
  }
  if (!isFrozenCheckPolicy(snapshot.frozen_command_check_policy) || !isFrozenHookSpecs(snapshot.frozen_hook_specs)) {
    return runtimeSafetyBlockerFailure('policy_snapshot_invalid', 'Runtime policy snapshot is missing frozen execution policy.');
  }

  for (const check of runSpec.required_checks) {
    try {
      legacyRequiredCheckToStructuredCommand(check.command, {
        hardMaxTimeoutMs: runtimeSafety.hookCommandContext.resourceLimits.timeout_ms,
        hardMaxOutputLimitBytes: runtimeSafety.hookCommandContext.resourceLimits.output_limit_bytes,
      });
    } catch (error) {
      if (error instanceof StructuredCommandError && error.code === 'required_check_command_invalid') {
        return runtimeSafetyBlockerFailure('required_check_command_invalid', 'Required check command is invalid.', {
          check_id: check.check_id,
        });
      }
      throw error;
    }
  }

  try {
    const effectivePolicy = compileEffectivePathPolicy({
      packagePolicy: {
        allowed_paths: runSpec.allowed_paths,
        forbidden_paths: runSpec.forbidden_paths,
      },
      snapshotPolicy: snapshot.path_policy as RawPathPolicy,
      packageValidationStrategy: snapshot.validation_strategy,
      snapshotValidationStrategy: snapshot.validation_strategy,
      sourceMutationPolicy: snapshot.source_mutation_policy,
    });
    const declaredScope = effectivePolicy.validateDeclaredScope(runSpec.allowed_paths);
    if (!declaredScope.allowed) {
      return runtimeSafetyBlockerFailure('path_policy_declared_scope_rejected', 'Declared package scope is rejected by the frozen PathPolicy.', {
        path: declaredScope.path,
        reason: declaredScope.reason,
      });
    }
  } catch (error) {
    if (error instanceof PathPolicyError) {
      return runtimeSafetyBlockerFailure('path_policy_declared_scope_rejected', error.message, error.details);
    }
    throw error;
  }

  const readiness = await runtimeSafety.runGovernor.checkReadiness({
    executorType: runSpec.executor_type,
    workflowOnly: runSpec.workflow_only,
    environment: runtimeSafety.runtimeEnvironment ?? 'test',
    networkMode: runtimeSafety.hookCommandContext.networkMode,
  });
  if (readiness.status !== 'ready') {
    return runtimeSafetyBlockerFailure(readiness.reason_code, 'Runtime hard-limit governor is unavailable.', {
      governor_id: readiness.governor_id,
      provenance: readiness.provenance,
    }, true);
  }

  const beforeRun = await runtimeSafety.hookRunner.runBeforeRun({
    frozenHookSpecs: snapshot.frozen_hook_specs as FrozenHookSpecs,
    runGovernor: runtimeSafety.runGovernor,
    commandContext: runtimeSafety.hookCommandContext,
    maxHookTimeoutMs: runtimeSafety.maxHookTimeoutMs,
    ...(runtimeSafety.mockRunContext === undefined ? {} : { mockRunContext: runtimeSafety.mockRunContext }),
  });
  if (!beforeRun.ok) {
    return runtimeSafetyBlockerFailure(beforeRun.blocker.code, beforeRun.blocker.summary, {
      hook_id: beforeRun.blocker.hook_id,
    }, beforeRun.blocker.retryable);
  }

  return undefined;
};

const isFrozenCheckPolicy = (value: unknown): value is { required_checks: readonly unknown[] } =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { required_checks?: unknown }).required_checks);

const isFrozenHookSpecs = (value: unknown): value is { before_run: readonly unknown[]; after_run: readonly unknown[] } =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { before_run?: unknown }).before_run) &&
  Array.isArray((value as { after_run?: unknown }).after_run);

export const runLocalCodexPreflight = async (
  runSpec: RunSpec,
  options: LocalCodexPreflightOptions,
): Promise<LocalCodexPreflightResult> => {
  const environment = options.environment ?? createDefaultLocalCodexEnvironment();

  try {
    await access(runSpec.repo.local_path);
  } catch {
    return failure(`Project repo path does not exist: ${runSpec.repo.local_path}`);
  }

  if (options.runtimeSafety !== undefined) {
    const runtimeSafetyFailure = await validateRuntimeSafetyPreflight(runSpec, options.runtimeSafety);
    if (runtimeSafetyFailure !== undefined) {
      return runtimeSafetyFailure;
    }
  }

  if (!(await environment.commandExists('git'))) {
    return failure('Missing required command: git');
  }

  if (!(await environment.commandExists('codex'))) {
    return blockerFailure('missing_codex_command', 'Missing required command: codex');
  }

  if (!(await environment.isCodexRuntimeReady(options.codexEnv === undefined ? undefined : { env: options.codexEnv }))) {
    return blockerFailure(
      'codex_not_authenticated',
      'Codex runtime is not authenticated or ready for local execution',
    );
  }

  if (!(await environment.isGitRepo(runSpec.repo.local_path))) {
    return failure(`Project repo path is not a Git repo: ${runSpec.repo.local_path}`);
  }

  if (!(await environment.isWritableDirectory(options.artifactRoot))) {
    return failure(`Artifact root is not writable: ${options.artifactRoot}`);
  }

  const baseRef = runSpec.repo.base_commit_sha.trim().length > 0 ? runSpec.repo.base_commit_sha : runSpec.repo.base_branch;

  if (!(await environment.resolveGitRef(runSpec.repo.local_path, baseRef))) {
    return failure(`Cannot resolve Git ref ${baseRef} in ${runSpec.repo.local_path}`);
  }

  let dirtyEntries: string[];
  try {
    const { stdout } = await environment.runCommand('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: runSpec.repo.local_path,
      maxBuffer: 1024 * 1024 * 10,
    });
    dirtyEntries = sourceDirtyEntriesFromPorcelain(stdout);
  } catch (error) {
    return blockerFailure('source_dirty_blocked', 'Unable to inspect source checkout cleanliness', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (dirtyEntries.length > 0) {
    return blockerFailure('source_dirty_blocked', 'Source checkout is dirty', {
      allowed_dirty_entries: [],
      blocked_dirty_entries: dirtyEntries,
    });
  }

  const prepared = await environment.prepareWorkspace({
    repoPath: runSpec.repo.local_path,
    baseRef,
    runSessionId: runSpec.run_session_id,
  });

  if (!prepared.ok) {
    return blockerFailure(
      'worktree_create_failed',
      `Persistent workspace preparation failed: ${prepared.message}`,
      { error: prepared.message },
      true,
    );
  }

  if (!(await environment.isWorkspaceClean(prepared.workspacePath))) {
    return failure(`Persistent workspace is not clean: ${prepared.workspacePath}`);
  }

  return {
    ok: true,
    blockers: [],
    workspacePath: prepared.workspacePath,
    resolvedBaseRef: baseRef,
  };
};
