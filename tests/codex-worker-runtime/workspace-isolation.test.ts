import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { prepareContainerWorkspace } from '../../packages/codex-worker-runtime/src/workspace-isolation';

describe('prepareContainerWorkspace', () => {
  it('does not mount source workspaces for artifact-only generation', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-lease-'));
    const prepared = await prepareContainerWorkspace({
      sourceAccessMode: 'artifact_only',
      leaseTempRoot: tempRoot,
      allowedRepoRoots: [],
    });

    expect(prepared.mode).toBe('artifact_only');
    expect(prepared.hostWorkspacePath).toBeUndefined();
    expect(prepared.publicSummary).toMatchObject({ mode: 'artifact_only' });
  });

  it('directly mounts a workspace with a real .git directory', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'forgeloop-repo-'));
    await mkdir(join(repo, '.git'));
    await writeFile(join(repo, 'file.txt'), 'hello');
    const prepared = await prepareContainerWorkspace({
      sourceAccessMode: 'path_policy_scoped',
      originalWorkspacePath: repo,
      leaseTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-lease-')),
      allowedRepoRoots: [repo],
    });

    expect(prepared).toMatchObject({ mode: 'direct_mount', hostWorkspacePath: repo, containerWorkspacePath: '/workspace' });
    expect(JSON.stringify(prepared.publicSummary)).not.toContain(repo);
  });

  it('turns .git file worktrees into self-contained copies under the lease root', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'forgeloop-worktree-'));
    const externalGitDir = await mkdtemp(join(tmpdir(), 'forgeloop-gitdir-'));
    await writeFile(join(repo, '.git'), `gitdir: ${externalGitDir}`);
    await writeFile(join(repo, 'src.txt'), 'copy-me');
    const leaseTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-lease-'));

    const prepared = await prepareContainerWorkspace({
      sourceAccessMode: 'path_policy_scoped',
      originalWorkspacePath: repo,
      leaseTempRoot,
      allowedRepoRoots: [repo, externalGitDir],
    });

    expect(prepared.mode).toBe('self_contained_clone');
    expect(prepared.hostWorkspacePath?.startsWith(leaseTempRoot)).toBe(true);
    await expect(readFile(join(prepared.hostWorkspacePath ?? '', 'src.txt'), 'utf8')).resolves.toBe('copy-me');
    expect(JSON.stringify(prepared.publicSummary)).not.toContain(repo);
    expect(JSON.stringify(prepared.publicSummary)).not.toContain(externalGitDir);
  });
});
