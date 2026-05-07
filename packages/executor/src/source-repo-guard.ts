import { createHash } from 'node:crypto';
import { lstat, readFile, readlink } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import type { LocalCodexEnvironment } from './local-codex-preflight.js';

export interface SourceRepoSnapshot {
  repoPath: string;
  beforePorcelain: string;
  beforeDirtyFingerprint: string;
}

export interface SourceRepoGuardResult {
  unchanged: boolean;
  beforePorcelain: string;
  afterPorcelain: string;
  beforeDirtyFingerprint: string;
  afterDirtyFingerprint: string;
}

const GIT_OUTPUT_MAX_BUFFER = 1024 * 1024 * 50;

const assertSafeRepoPath = (repoPath: string, path: string): string => {
  const resolvedRepo = resolve(repoPath);
  const resolvedPath = resolve(resolvedRepo, path);
  const relativePath = relative(resolvedRepo, resolvedPath);

  if (relativePath.startsWith('..') || relativePath === '..' || resolve(relativePath) === relativePath) {
    throw new Error(`Unsafe source repo path in dirty fingerprint: ${path}`);
  }

  return resolvedPath;
};

const splitNul = (value: string): string[] => value.split('\0').filter(Boolean);

const hashUntrackedPath = async (hash: ReturnType<typeof createHash>, repoPath: string, path: string) => {
  const resolvedPath = assertSafeRepoPath(repoPath, path);
  const stats = await lstat(resolvedPath);

  hash.update('untracked-path\0');
  hash.update(path);
  hash.update('\0');

  if (stats.isSymbolicLink()) {
    hash.update('symlink\0');
    hash.update(await readlink(resolvedPath));
    hash.update('\0');
    return;
  }

  if (stats.isFile()) {
    hash.update('file\0');
    hash.update(await readFile(resolvedPath));
    hash.update('\0');
    return;
  }

  hash.update(`other:${stats.mode}:${stats.size}\0`);
};

const dirtyFingerprint = async (
  environment: LocalCodexEnvironment,
  repoPath: string,
  porcelain: string,
): Promise<string> => {
  const [worktreeDiff, cachedDiff, untracked] = await Promise.all([
    environment.runCommand('git', ['diff', '--binary', '--no-ext-diff'], {
      cwd: repoPath,
      maxBuffer: GIT_OUTPUT_MAX_BUFFER,
    }),
    environment.runCommand('git', ['diff', '--cached', '--binary', '--no-ext-diff'], {
      cwd: repoPath,
      maxBuffer: GIT_OUTPUT_MAX_BUFFER,
    }),
    environment.runCommand('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
      cwd: repoPath,
      maxBuffer: GIT_OUTPUT_MAX_BUFFER,
    }),
  ]);
  const hash = createHash('sha256');

  hash.update('porcelain\0');
  hash.update(porcelain);
  hash.update('\0worktree-diff\0');
  hash.update(worktreeDiff.stdout);
  hash.update('\0cached-diff\0');
  hash.update(cachedDiff.stdout);
  hash.update('\0untracked\0');

  for (const path of splitNul(untracked.stdout).sort()) {
    await hashUntrackedPath(hash, repoPath, path);
  }

  return hash.digest('hex');
};

export const snapshotSourceRepoStatus = async (
  environment: LocalCodexEnvironment,
  repoPath: string,
): Promise<SourceRepoSnapshot> => {
  const { stdout } = await environment.runCommand('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: repoPath,
    maxBuffer: 1024 * 1024 * 10,
  });
  const beforeDirtyFingerprint = await dirtyFingerprint(environment, repoPath, stdout);

  return {
    repoPath,
    beforePorcelain: stdout,
    beforeDirtyFingerprint,
  };
};

export const sourceRepoWasMutated = (input: {
  beforePorcelain: string;
  afterPorcelain: string;
  beforeDirtyFingerprint?: string;
  afterDirtyFingerprint?: string;
}): boolean =>
  input.beforePorcelain !== input.afterPorcelain ||
  (input.beforeDirtyFingerprint !== undefined &&
    input.afterDirtyFingerprint !== undefined &&
    input.beforeDirtyFingerprint !== input.afterDirtyFingerprint);

export const verifySourceRepoUnchanged = async (
  environment: LocalCodexEnvironment,
  snapshot: SourceRepoSnapshot,
): Promise<SourceRepoGuardResult> => {
  const { stdout } = await environment.runCommand('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: snapshot.repoPath,
    maxBuffer: 1024 * 1024 * 10,
  });
  const afterDirtyFingerprint = await dirtyFingerprint(environment, snapshot.repoPath, stdout);

  return {
    unchanged: !sourceRepoWasMutated({
      beforePorcelain: snapshot.beforePorcelain,
      afterPorcelain: stdout,
      beforeDirtyFingerprint: snapshot.beforeDirtyFingerprint,
      afterDirtyFingerprint,
    }),
    beforePorcelain: snapshot.beforePorcelain,
    afterPorcelain: stdout,
    beforeDirtyFingerprint: snapshot.beforeDirtyFingerprint,
    afterDirtyFingerprint,
  };
};
