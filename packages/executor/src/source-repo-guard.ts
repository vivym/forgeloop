import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, readlink } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import type { LocalCodexEnvironment } from './local-codex-preflight.js';
import { CODEX_RUN_WORKTREE_DIR } from './codex-worktree.js';

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

export const isIgnoredRunWorktreePath = (path: string): boolean =>
  path === CODEX_RUN_WORKTREE_DIR || path.startsWith(`${CODEX_RUN_WORKTREE_DIR}/`);

const decodeGitQuotedPath = (path: string): string => {
  const trimmed = path.trim();
  if (trimmed.length < 2 || trimmed[0] !== '"' || trimmed[trimmed.length - 1] !== '"') {
    return trimmed;
  }

  let result = '';
  for (let index = 1; index < trimmed.length - 1; index += 1) {
    const current = trimmed[index];
    if (current !== '\\') {
      result += current;
      continue;
    }

    index += 1;
    if (index >= trimmed.length - 1) {
      break;
    }

    const escaped = trimmed[index];
    if (escaped >= '0' && escaped <= '7') {
      let octal = escaped;
      while (index + 1 < trimmed.length - 1 && octal.length < 3) {
        const next = trimmed[index + 1];
        if (next < '0' || next > '7') {
          break;
        }
        index += 1;
        octal += next;
      }
      result += String.fromCharCode(Number.parseInt(octal, 8));
      continue;
    }

    switch (escaped) {
      case 'n':
        result += '\n';
        break;
      case 't':
        result += '\t';
        break;
      case 'r':
        result += '\r';
        break;
      case 'b':
        result += '\b';
        break;
      case 'f':
        result += '\f';
        break;
      case 'a':
        result += '\u0007';
        break;
      case 'v':
        result += '\v';
        break;
      case '\\':
        result += '\\';
        break;
      case '"':
        result += '"';
        break;
      default:
        result += escaped;
        break;
    }
  }

  return result;
};

const porcelainPayload = (line: string): string => (line.length > 3 ? line.slice(3) : line);

const porcelainPayloadPaths = (line: string): string[] => porcelainPayload(line)
  .split(' -> ')
  .map(decodeGitQuotedPath);

const porcelainLineIsSourceContent = (line: string): boolean =>
  porcelainPayloadPaths(line).every((path) => !isIgnoredRunWorktreePath(path));

const normalizeSourcePorcelain = (porcelain: string): string =>
  porcelain
    .split('\n')
    .filter((line) => line.length > 0)
    .filter(porcelainLineIsSourceContent)
    .map((line) => porcelainPayloadPaths(line).join(' -> '))
    .join('\n');

const unique = (values: string[]): string[] => [...new Set(values)];

export const sourceDirtyEntriesFromPorcelain = (porcelain: string): string[] =>
  unique(
    porcelain
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .flatMap(porcelainPayloadPaths)
      .map((path) => path.trim())
      .filter(Boolean)
      .filter((path) => !isIgnoredRunWorktreePath(path)),
  );

const hashUntrackedPath = async (hash: ReturnType<typeof createHash>, repoPath: string, path: string) => {
  if (isIgnoredRunWorktreePath(path)) {
    hash.update('ignored-run-worktree\0');
    hash.update(path);
    hash.update('\0');
    return;
  }

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

  if (stats.isDirectory()) {
    hash.update('directory\0');
    const entries = await readdir(resolvedPath, { withFileTypes: true });

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      await hashUntrackedPath(hash, repoPath, join(path, entry.name));
    }
    hash.update('end-directory\0');
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
  hash.update(normalizeSourcePorcelain(porcelain));
  hash.update('\0worktree-diff\0');
  hash.update(worktreeDiff.stdout);
  hash.update('\0cached-diff\0');
  hash.update(cachedDiff.stdout);
  hash.update('\0untracked\0');

  for (const path of splitNul(untracked.stdout).filter((path) => !isIgnoredRunWorktreePath(path)).sort()) {
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
  const beforePorcelain = normalizeSourcePorcelain(stdout);
  const beforeDirtyFingerprint = await dirtyFingerprint(environment, repoPath, stdout);

  return {
    repoPath,
    beforePorcelain,
    beforeDirtyFingerprint,
  };
};

export const sourceRepoWasMutated = (input: {
  beforePorcelain: string;
  afterPorcelain: string;
  beforeDirtyFingerprint?: string;
  afterDirtyFingerprint?: string;
}): boolean =>
  normalizeSourcePorcelain(input.beforePorcelain) !== normalizeSourcePorcelain(input.afterPorcelain) ||
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
  const afterPorcelain = normalizeSourcePorcelain(stdout);
  const afterDirtyFingerprint = await dirtyFingerprint(environment, snapshot.repoPath, stdout);

  return {
    unchanged: !sourceRepoWasMutated({
      beforePorcelain: snapshot.beforePorcelain,
      afterPorcelain,
      beforeDirtyFingerprint: snapshot.beforeDirtyFingerprint,
      afterDirtyFingerprint,
    }),
    beforePorcelain: snapshot.beforePorcelain,
    afterPorcelain,
    beforeDirtyFingerprint: snapshot.beforeDirtyFingerprint,
    afterDirtyFingerprint,
  };
};
