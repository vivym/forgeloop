import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

import type { ExecutorFailure, RunSpec } from '../../contracts/src/executor.js';
import { preparePersistentGitWorktree } from './codex-worktree.js';
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
  | 'worktree_create_failed';

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
    runCodex: async ({ workspacePath, prompt, env }) => {
      const commandOptions: CommandRunOptions = {
        cwd: workspacePath,
        maxBuffer: 1024 * 1024 * 10,
      };
      if (env !== undefined) {
        commandOptions.env = env;
      }

      await runCommand('codex', ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', prompt], commandOptions);
    },
    runCommand,
    prepareWorkspace: async ({ repoPath, baseRef, runSessionId }) => {
      const input = { repoPath, baseRef, runSessionId };

      return preparePersistentGitWorktree(environment, input);
    },
  };

  return environment;
};

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
