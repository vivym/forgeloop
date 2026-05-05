import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ExecutorFailure, RunSpec } from '../../contracts/src/executor.js';

const execFileAsync = promisify(execFile);

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
  timeoutSeconds: number;
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
  workspacePath: string;
  resolvedBaseRef: string;
}

export interface LocalCodexPreflightFailure {
  ok: false;
  failure: ExecutorFailure;
}

export type LocalCodexPreflightResult = LocalCodexPreflightSuccess | LocalCodexPreflightFailure;

export interface DefaultLocalCodexEnvironmentOptions {
  workspaceRoot?: string;
  commandRunner?: CommandRunner;
}

const failure = (message: string, retryable = false): LocalCodexPreflightFailure => ({
  ok: false,
  failure: {
    kind: 'preflight_failed',
    message,
    retryable,
  },
});

const safePathSegment = (value: string): string => {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.\.+/g, '-')
    .replace(/^\.+/, '')
    .replace(/^-+|-+$/g, '');

  return sanitized.length > 0 ? sanitized : 'run-session';
};

const execFileCommandRunner: CommandRunner = async (command, args, options) => {
  const { stdout, stderr } = await execFileAsync(command, [...args], options);

  return {
    stdout: String(stdout),
    stderr: String(stderr),
  };
};

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
  const workspaceRoot = options.workspaceRoot ?? join(tmpdir(), 'forgeloop-workspaces');
  const runCommand = options.commandRunner ?? execFileCommandRunner;

  return {
    commandExists: commandExists(runCommand),
    isCodexRuntimeReady: isCodexRuntimeReady(runCommand),
    isGitRepo: isGitRepo(runCommand),
    resolveGitRef: resolveGitRef(runCommand),
    isWorkspaceClean: isWorkspaceClean(runCommand),
    isWritableDirectory,
    runCodex: async ({ workspacePath, prompt, timeoutSeconds, env }) => {
      const commandOptions: CommandRunOptions = {
        cwd: workspacePath,
        timeout: timeoutSeconds * 1000,
        maxBuffer: 1024 * 1024 * 10,
      };
      if (env !== undefined) {
        commandOptions.env = env;
      }

      await runCommand('codex', ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', prompt], commandOptions);
    },
    runCommand,
    prepareWorkspace: async ({ repoPath, baseRef, runSessionId }) => {
      try {
        await mkdir(workspaceRoot, { recursive: true });
        const workspacePath = await mkdtemp(join(workspaceRoot, `${safePathSegment(runSessionId)}-`));
        await rm(workspacePath, { recursive: true, force: true });
        await runCommand('git', ['clone', '--no-checkout', repoPath, workspacePath]);
        await runCommand('git', ['checkout', '--detach', baseRef], { cwd: workspacePath });

        return { ok: true, workspacePath };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : 'workspace prepare failed',
        };
      }
    },
  };
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
    return failure('Missing required command: codex');
  }

  if (!(await environment.isCodexRuntimeReady(options.codexEnv === undefined ? undefined : { env: options.codexEnv }))) {
    return failure('Codex runtime is not authenticated or ready for local execution');
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

  const prepared = await environment.prepareWorkspace({
    repoPath: runSpec.repo.local_path,
    baseRef,
    runSessionId: runSpec.run_session_id,
  });

  if (!prepared.ok) {
    return failure(`Disposable workspace preparation failed: ${prepared.message}`, true);
  }

  if (!(await environment.isWorkspaceClean(prepared.workspacePath))) {
    return failure(`Disposable workspace is not clean: ${prepared.workspacePath}`);
  }

  return {
    ok: true,
    workspacePath: prepared.workspacePath,
    resolvedBaseRef: baseRef,
  };
};
