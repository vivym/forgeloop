import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createDefaultLocalCodexEnvironment,
  snapshotSourceRepoStatus,
  sourceRepoWasMutated,
  verifySourceRepoUnchanged,
  worktreePathForRun,
} from '../../packages/executor/src/index';

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

const makeTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'forgeloop-worktree-'));
  tempRoots.push(dir);
  return dir;
};

const execGit = async (cwd: string, args: readonly string[]) => execFileAsync('git', [...args], { cwd });

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Codex persistent worktrees', () => {
  it('uses a stable per-run worktree path under the source repo', () => {
    expect(worktreePathForRun('/Users/viv/projs/forgeloop', 'run-session-1')).toBe(
      '/Users/viv/projs/forgeloop/.worktrees/run-session-1',
    );
  });

  it('ignores outside workspaceRoot overrides for the local Codex worktree boundary', () => {
    expect(worktreePathForRun('/Users/viv/projs/forgeloop', 'run-session-1', '/tmp/outside-worktrees')).toBe(
      '/Users/viv/projs/forgeloop/.worktrees/run-session-1',
    );
  });

  it('detects source repo mutation from porcelain status changes', () => {
    expect(
      sourceRepoWasMutated({
        beforePorcelain: '',
        afterPorcelain: ' M packages/domain/src/types.ts\n',
      }),
    ).toBe(true);
  });

  it('ignores run worktree porcelain while still detecting normal source porcelain changes', () => {
    expect(
      sourceRepoWasMutated({
        beforePorcelain: '',
        afterPorcelain: '?? .worktrees/run-b/packages/executor/src/file.ts\n',
      }),
    ).toBe(false);
    expect(
      sourceRepoWasMutated({
        beforePorcelain: '',
        afterPorcelain: '?? packages/executor/src/file.ts\n',
      }),
    ).toBe(true);
  });

  it('detects source repo mutation when dirty porcelain stays the same but content changes', async () => {
    const repo = await makeTempDir();
    await execGit(repo, ['init', '-b', 'main']);
    await execGit(repo, ['config', 'user.email', 'test@example.com']);
    await execGit(repo, ['config', 'user.name', 'Test User']);
    await writeFile(join(repo, 'tracked.txt'), 'clean\n');
    await execGit(repo, ['add', '.']);
    await execGit(repo, ['commit', '-m', 'initial']);
    await writeFile(join(repo, 'tracked.txt'), 'dirty before\n');
    await writeFile(join(repo, 'untracked.txt'), 'untracked before\n');

    const environment = createDefaultLocalCodexEnvironment();
    const snapshot = await snapshotSourceRepoStatus(environment, repo);
    await writeFile(join(repo, 'tracked.txt'), 'dirty after\n');
    await writeFile(join(repo, 'untracked.txt'), 'untracked after\n');
    const result = await verifySourceRepoUnchanged(environment, snapshot);

    expect(result.beforePorcelain).toBe(result.afterPorcelain);
    expect(result.unchanged).toBe(false);
  });

  it('detects source repo mutation inside an untracked nested repository directory', async () => {
    const repo = await makeTempDir();
    await execGit(repo, ['init', '-b', 'main']);
    await execGit(repo, ['config', 'user.email', 'test@example.com']);
    await execGit(repo, ['config', 'user.name', 'Test User']);
    await writeFile(join(repo, 'tracked.txt'), 'clean\n');
    await execGit(repo, ['add', '.']);
    await execGit(repo, ['commit', '-m', 'initial']);
    const nestedRepo = join(repo, 'vendor', 'nested');
    await mkdir(nestedRepo, { recursive: true });
    await execGit(nestedRepo, ['init', '-b', 'main']);
    await writeFile(join(nestedRepo, 'nested.txt'), 'nested before\n');

    const environment = createDefaultLocalCodexEnvironment();
    const snapshot = await snapshotSourceRepoStatus(environment, repo);
    await writeFile(join(nestedRepo, 'nested.txt'), 'nested after\n');
    const result = await verifySourceRepoUnchanged(environment, snapshot);

    expect(result.beforePorcelain).toBe(result.afterPorcelain);
    expect(result.unchanged).toBe(false);
  });

  it('keeps local worktree and superpowers directories ignored', () => {
    const gitignore = readFileSync('.gitignore', 'utf8');

    expect(gitignore).toContain('.worktrees/');
    expect(gitignore).toContain('.superpowers/');
  });
});
