import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createDefaultLocalCodexEnvironment,
  snapshotSourceRepoStatus,
  verifySourceRepoUnchanged,
} from '../../packages/executor/src/index';

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

const makeTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'forgeloop-source-guard-'));
  tempRoots.push(dir);
  return dir;
};

const execGit = async (cwd: string, args: readonly string[]) => execFileAsync('git', [...args], { cwd });

const createGitRepo = async () => {
  const repo = await makeTempDir();

  await execGit(repo, ['init', '-b', 'main']);
  await execGit(repo, ['config', 'user.email', 'test@example.com']);
  await execGit(repo, ['config', 'user.name', 'Test User']);
  await writeFile(join(repo, 'README.md'), '# Source Repo\n');
  await execGit(repo, ['add', '.']);
  await execGit(repo, ['commit', '-m', 'initial']);

  return repo;
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('source repo guard', () => {
  it('does not report .worktrees contents as source checkout dirtiness', async () => {
    const repo = await createGitRepo();
    await mkdir(join(repo, '.worktrees', 'run-session-1'), { recursive: true });
    await writeFile(join(repo, '.worktrees', 'run-session-1', 'README.md'), '# Worktree Copy\n');

    const snapshot = await snapshotSourceRepoStatus(createDefaultLocalCodexEnvironment(), repo);

    expect(snapshot.beforePorcelain).toBe('');
  });

  it('keeps the dirty fingerprint stable when only ignored .worktrees contents change', async () => {
    const repo = await createGitRepo();
    await mkdir(join(repo, '.worktrees', 'run-session-1'), { recursive: true });
    await writeFile(join(repo, '.worktrees', 'run-session-1', 'before.txt'), 'before\n');
    const environment = createDefaultLocalCodexEnvironment();
    const snapshot = await snapshotSourceRepoStatus(environment, repo);

    await writeFile(join(repo, '.worktrees', 'run-session-1', 'after.txt'), 'after\n');
    const result = await verifySourceRepoUnchanged(environment, snapshot);

    expect(result.unchanged).toBe(true);
    expect(result.afterPorcelain).toBe('');
    expect(result.beforeDirtyFingerprint).toBe(result.afterDirtyFingerprint);
  });
});
