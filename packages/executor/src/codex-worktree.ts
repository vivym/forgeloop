import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import type { LocalCodexEnvironment, WorkspacePrepareResult } from './local-codex-preflight.js';
import { PathSafety } from './path-safety.js';
import type { ResourceGovernor } from './resource-governor.js';
import { materializeSafeGitCommand, safeGitCommandSpec, type TrustedToolchainConfig } from './structured-command.js';

export const CODEX_RUN_WORKTREE_DIR = '.worktrees';

export interface CodexWorktreeCommandPolicy {
  bootstrapId: string;
  artifactRoot: string;
  trustedToolchains: TrustedToolchainConfig;
  tempRoot?: string;
}

export type GovernorOutputRefReader = (ref: string) => Promise<string>;

export interface GovernedPreparePersistentGitWorktreeInput {
  repoPath: string;
  baseRef: string;
  runSessionId: string;
  pathSafety: PathSafety;
  bootstrapGovernor: ResourceGovernor;
  commandPolicy: CodexWorktreeCommandPolicy;
  readCommandOutputRef: GovernorOutputRefReader;
}

interface LegacyPreparePersistentGitWorktreeInput {
  repoPath: string;
  baseRef: string;
  runSessionId: string;
  workspaceRoot?: string;
}

const safePathSegment = (value: string): string => {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.\.+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+/, '')
    .replace(/^-+|-+$/g, '');

  return sanitized.length > 0 ? sanitized : 'run-session';
};

const parseRegisteredWorktreePaths = (porcelain: string): string[] =>
  porcelain
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .filter(Boolean);

export const worktreeRootForRepo = (repoPath: string, _workspaceRoot?: string): string =>
  resolve(join(repoPath, CODEX_RUN_WORKTREE_DIR));

export const worktreePathForRun = (repoPath: string, runSessionId: string, workspaceRoot?: string): string =>
  join(worktreeRootForRepo(repoPath, workspaceRoot), safePathSegment(runSessionId));

export const createCodexWorktreePathSafety = async (repoPath: string): Promise<PathSafety> => {
  const worktreeRoot = worktreeRootForRepo(repoPath);
  await mkdir(worktreeRoot, { recursive: true });
  return PathSafety.create({ repoRoot: repoPath, worktreeRoot });
};

export async function cleanupExistingWorktreeForRun(
  input: GovernedPreparePersistentGitWorktreeInput & { workspacePath: string },
): Promise<void> {
  const runSegment = safePathSegment(input.runSessionId);
  if (basename(input.workspacePath) !== runSegment) {
    throw new Error('Run workspace segment does not match sanitized run session id.');
  }

  const listResult = await runBootstrapGitCommand(input, 'worktree-list', ['worktree', 'list', '--porcelain']);
  const stdout = await stdoutFromGovernorResult(listResult, input.readCommandOutputRef);
  const registered = parseRegisteredWorktreePaths(stdout).some((path) => resolve(path) === resolve(input.workspacePath));
  if (!registered) {
    return;
  }

  await input.pathSafety.removeDestructiveChildPath(runSegment, {
    beforeRemove: async (preparedPath) => {
      await runBootstrapGitCommand(input, 'worktree-remove', ['worktree', 'remove', '--force', preparedPath]);
    },
    remove: async (preparedPath) => {
      await rm(preparedPath, { recursive: true, force: true });
    },
  });
}

export async function preparePersistentGitWorktree(
  input: GovernedPreparePersistentGitWorktreeInput,
): Promise<WorkspacePrepareResult>;
export async function preparePersistentGitWorktree(
  environment: LocalCodexEnvironment,
  input: LegacyPreparePersistentGitWorktreeInput,
): Promise<WorkspacePrepareResult>;
export async function preparePersistentGitWorktree(
  first: GovernedPreparePersistentGitWorktreeInput | LocalCodexEnvironment,
  second?: LegacyPreparePersistentGitWorktreeInput,
): Promise<WorkspacePrepareResult> {
  if (second !== undefined) {
    return prepareLegacyPersistentGitWorktree(first as LocalCodexEnvironment, second);
  }

  try {
    const input = first as GovernedPreparePersistentGitWorktreeInput;
    const runSegment = safePathSegment(input.runSessionId);
    const workspacePath = await input.pathSafety.assertSafeChildPath(runSegment);
    await cleanupExistingWorktreeForRun({ ...input, workspacePath });
    await runBootstrapGitCommand(input, 'worktree-add', [
      'worktree',
      'add',
      '--detach',
      '--no-checkout',
      workspacePath,
      input.baseRef,
    ]);

    return { ok: true, workspacePath };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'git worktree add failed',
    };
  }
}

const prepareLegacyPersistentGitWorktree = async (
  environment: LocalCodexEnvironment,
  input: LegacyPreparePersistentGitWorktreeInput,
): Promise<WorkspacePrepareResult> => {
  const workspacePath = worktreePathForRun(input.repoPath, input.runSessionId, input.workspaceRoot);

  try {
    await cleanupLegacyExistingWorktreeForRun(environment, {
      repoPath: input.repoPath,
      runSessionId: input.runSessionId,
      workspacePath,
    });
    await environment.runCommand('git', ['worktree', 'add', '--detach', workspacePath, input.baseRef], {
      cwd: input.repoPath,
      maxBuffer: 1024 * 1024 * 10,
    });

    return { ok: true, workspacePath };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'git worktree add failed',
    };
  }
};

const cleanupLegacyExistingWorktreeForRun = async (
  environment: LocalCodexEnvironment,
  input: {
    repoPath: string;
    runSessionId: string;
    workspacePath: string;
  },
): Promise<void> => {
  if (basename(input.workspacePath) !== safePathSegment(input.runSessionId)) {
    return;
  }

  const { stdout } = await environment.runCommand('git', ['worktree', 'list', '--porcelain'], {
    cwd: input.repoPath,
    maxBuffer: 1024 * 1024 * 10,
  });
  const registered = parseRegisteredWorktreePaths(stdout).some((path) => resolve(path) === resolve(input.workspacePath));
  if (!registered) {
    return;
  }

  await environment.runCommand('git', ['worktree', 'remove', '--force', input.workspacePath], {
    cwd: input.repoPath,
    maxBuffer: 1024 * 1024 * 10,
  });
  await rm(input.workspacePath, { recursive: true, force: true });
};

const runBootstrapGitCommand = async (
  input: GovernedPreparePersistentGitWorktreeInput,
  commandId: string,
  gitArgs: string[],
) => {
  const command = materializeSafeGitCommand({
    command: safeGitCommandSpec({
      args: gitArgs,
      cwd: 'workspace_root',
      timeout_ms: 30_000,
      output_limit_bytes: 1_000_000,
      source_write_policy: 'read_only',
      visibility: 'internal',
    }),
    toolchain: input.commandPolicy.trustedToolchains,
    workspaceRoot: input.repoPath,
    artifactRoot: input.commandPolicy.artifactRoot,
    ...(input.commandPolicy.tempRoot === undefined ? {} : { tempRoot: input.commandPolicy.tempRoot }),
  });
  const workspaceParent = dirname(await input.pathSafety.assertSafeChildPath(safePathSegment(input.runSessionId)));
  return input.bootstrapGovernor.run({
    scope: 'bootstrap',
    command,
    bindings: {
      bootstrapId: input.commandPolicy.bootstrapId,
      commandId,
      commandDigest: bootstrapCommandDigest(commandId, command),
      repoRoot: input.repoPath,
      workspaceParent,
      artifactRoot: input.commandPolicy.artifactRoot,
      cwd: input.repoPath,
      safeGitProfile: 'forgeloop_default',
    },
  });
};

const stdoutFromGovernorResult = async (
  result: Awaited<ReturnType<ResourceGovernor['run']>>,
  readCommandOutputRef: GovernorOutputRefReader,
): Promise<string> => {
  if (result.timed_out || result.exit_code !== 0) {
    throw new Error(result.public_summary);
  }
  return result.stdout_ref === undefined ? '' : readCommandOutputRef(result.stdout_ref);
};

const bootstrapCommandDigest = (commandId: string, command: unknown): string =>
  `sha256:${createHash('sha256').update(JSON.stringify({ commandId, command })).digest('hex')}`;
