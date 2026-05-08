import { rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import type { LocalCodexEnvironment, WorkspacePrepareResult } from './local-codex-preflight.js';

export const CODEX_RUN_WORKTREE_DIR = '.worktrees';

const safePathSegment = (value: string): string => {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.\.+/g, '-')
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

export const worktreeRootForRepo = (repoPath: string, workspaceRoot?: string): string =>
  resolve(workspaceRoot ?? join(repoPath, CODEX_RUN_WORKTREE_DIR));

export const worktreePathForRun = (repoPath: string, runSessionId: string, workspaceRoot?: string): string =>
  join(worktreeRootForRepo(repoPath, workspaceRoot), safePathSegment(runSessionId));

export const cleanupExistingWorktreeForRun = async (
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
  const registered = parseRegisteredWorktreePaths(stdout).some(
    (path) => resolve(path) === resolve(input.workspacePath),
  );

  if (!registered) {
    return;
  }

  await environment.runCommand('git', ['worktree', 'remove', '--force', input.workspacePath], {
    cwd: input.repoPath,
    maxBuffer: 1024 * 1024 * 10,
  });
  await rm(input.workspacePath, { recursive: true, force: true });
};

export const preparePersistentGitWorktree = async (
  environment: LocalCodexEnvironment,
  input: {
    repoPath: string;
    baseRef: string;
    runSessionId: string;
    workspaceRoot?: string;
  },
): Promise<WorkspacePrepareResult> => {
  const workspacePath = worktreePathForRun(input.repoPath, input.runSessionId, input.workspaceRoot);

  try {
    await cleanupExistingWorktreeForRun(environment, {
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
