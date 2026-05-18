import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { PathSafety } from '../../packages/executor/src/index';

const tempRoots: string[] = [];

const makeTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'forgeloop-path-safety-'));
  tempRoots.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('PathSafety', () => {
  it('rejects paths that are not safe repo-relative inputs', async () => {
    const repoRoot = await makeTempDir();
    const pathSafety = await PathSafety.create({ repoRoot });

    expect(() => pathSafety.normalizeRepoRelativePath('')).toThrowError(
      expect.objectContaining({ code: 'path_not_repo_relative' }),
    );
    expect(() => pathSafety.normalizeRepoRelativePath('/absolute/path')).toThrowError(
      expect.objectContaining({ code: 'path_not_repo_relative' }),
    );
    expect(() => pathSafety.normalizeRepoRelativePath('../secret')).toThrowError(
      expect.objectContaining({ code: 'path_not_repo_relative' }),
    );
    expect(() => pathSafety.normalizeRepoRelativePath('src/../secret')).toThrowError(
      expect.objectContaining({ code: 'path_not_repo_relative' }),
    );
    expect(() => pathSafety.normalizeRepoRelativePath('src\\file.ts')).toThrowError(
      expect.objectContaining({ code: 'path_not_repo_relative' }),
    );
    expect(() => pathSafety.normalizeRepoRelativePath('src/\x1ffile.ts')).toThrowError(
      expect.objectContaining({ code: 'path_contains_control_character' }),
    );
    await expect(pathSafety.assertSafeChildPath('.')).rejects.toMatchObject({ code: 'workspace_equals_root' });
  });

  it('classifies an ordinary workspace root escape separately from symlink escapes', async () => {
    const parent = await makeTempDir();
    const repoRoot = join(parent, 'repo');
    const outsideRoot = join(parent, 'outside-worktrees');
    await mkdir(repoRoot);
    await mkdir(outsideRoot);

    await expect(PathSafety.create({ repoRoot, worktreeRoot: outsideRoot })).rejects.toMatchObject({
      code: 'workspace_path_escape',
    });
  });

  it('classifies repo symlink escapes as workspace_symlink_escape', async () => {
    const parent = await makeTempDir();
    const repoRoot = join(parent, 'repo');
    const outsideRoot = join(parent, 'outside');
    await mkdir(repoRoot);
    await mkdir(outsideRoot);
    await writeFile(join(outsideRoot, 'secret.txt'), 'secret\n');
    await symlink(outsideRoot, join(repoRoot, 'link-out'), 'dir');
    const pathSafety = await PathSafety.create({ repoRoot });

    await expect(pathSafety.resolveRepoRelativePath('link-out/secret.txt')).rejects.toMatchObject({
      code: 'workspace_symlink_escape',
    });
  });

  it('validates artifact roots separately from the repo root', async () => {
    const parent = await makeTempDir();
    const repoRoot = join(parent, 'repo');
    const artifactRoot = join(parent, 'artifacts');
    await mkdir(repoRoot);
    await mkdir(artifactRoot);
    const pathSafety = await PathSafety.create({ repoRoot, artifactRoot });
    const realRepoRoot = await realpath(repoRoot);
    const realArtifactRoot = await realpath(artifactRoot);

    await expect(pathSafety.resolveRepoRelativePath('run/output.txt')).resolves.toBe(
      join(realRepoRoot, 'run', 'output.txt'),
    );
    await expect(pathSafety.artifactPath('run/output.txt')).resolves.toBe(join(realArtifactRoot, 'run', 'output.txt'));
    await expect(pathSafety.artifactPath('../repo/secret.txt')).rejects.toMatchObject({
      code: 'path_not_repo_relative',
    });
  });

  it('revalidates destructive targets at operation time before recursive removal', async () => {
    const parent = await makeTempDir();
    const repoRoot = join(parent, 'repo');
    const outsideRoot = join(parent, 'outside');
    await mkdir(repoRoot);
    await mkdir(outsideRoot);
    const pathSafety = await PathSafety.create({ repoRoot });
    const realRepoRoot = await realpath(repoRoot);

    await expect(pathSafety.prepareDestructiveChildPath('safe-child')).resolves.toBe(join(realRepoRoot, 'safe-child'));

    await symlink(outsideRoot, join(repoRoot, 'safe-child'), 'dir');
    await expect(pathSafety.prepareDestructiveChildPath('safe-child')).rejects.toMatchObject({
      code: 'workspace_symlink_escape',
    });
  });

  it('rejects a symlink race immediately before destructive removal', async () => {
    const parent = await makeTempDir();
    const repoRoot = join(parent, 'repo');
    const outsideRoot = join(parent, 'outside');
    await mkdir(join(repoRoot, 'safe-child'), { recursive: true });
    await mkdir(outsideRoot);
    const pathSafety = await PathSafety.create({ repoRoot });

    await expect(
      pathSafety.removeDestructiveChildPath('safe-child', {
        beforeRemove: async (preparedPath) => {
          await rm(preparedPath, { recursive: true, force: true });
          await symlink(outsideRoot, preparedPath, 'dir');
        },
      }),
    ).rejects.toMatchObject({
      code: 'workspace_symlink_escape',
    });
  });

  it('rejects nested paths for operation-time artifact writes', async () => {
    const parent = await makeTempDir();
    const repoRoot = join(parent, 'repo');
    const artifactRoot = join(parent, 'artifacts');
    await mkdir(repoRoot);
    await mkdir(artifactRoot);
    const pathSafety = await PathSafety.create({ repoRoot, artifactRoot });

    await expect(pathSafety.writeArtifactFile('run-session-1/check/stdout.txt', Buffer.from('unsafe write\n'))).rejects.toMatchObject({
      code: 'workspace_path_escape',
    });
  });

  it('does not write or clean up artifact temp paths through a raced symlink final path', async () => {
    const parent = await makeTempDir();
    const repoRoot = join(parent, 'repo');
    const artifactRoot = join(parent, 'artifacts');
    const outsideRoot = join(parent, 'outside');
    await mkdir(repoRoot);
    await mkdir(artifactRoot);
    await mkdir(outsideRoot);
    const pathSafety = await PathSafety.create({ repoRoot, artifactRoot });
    const outsideTempPath = join(outsideRoot, 'outside-temp.txt');
    await writeFile(outsideTempPath, 'outside temp must survive\n');

    await expect(
      pathSafety.writeArtifactFile('stdout.txt', Buffer.from('unsafe write\n'), {
        beforeWrite: async ({ tempPath }) => {
          await symlink(outsideTempPath, tempPath);
        },
      }),
    ).rejects.toMatchObject({
      code: 'workspace_symlink_escape',
    });
    await expect(readFile(outsideTempPath, 'utf8')).resolves.toBe('outside temp must survive\n');
  });

  it('rejects artifact temp replacement before installing the final artifact', async () => {
    const parent = await makeTempDir();
    const repoRoot = join(parent, 'repo');
    const artifactRoot = join(parent, 'artifacts');
    const outsideRoot = join(parent, 'outside');
    await mkdir(repoRoot);
    await mkdir(artifactRoot);
    await mkdir(outsideRoot);
    const outsideFile = join(outsideRoot, 'outside.txt');
    await writeFile(outsideFile, 'outside bytes must not be linked\n');
    const pathSafety = await PathSafety.create({ repoRoot, artifactRoot });

    await expect(
      pathSafety.writeArtifactFile('stdout.txt', Buffer.from('safe write\n'), {
        beforeRename: async ({ tempPath }) => {
          await rm(tempPath, { force: true });
          await symlink(outsideFile, tempPath);
        },
      }),
    ).rejects.toMatchObject({
      code: 'workspace_symlink_escape',
    });
    await expect(readFile(join(artifactRoot, 'stdout.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside bytes must not be linked\n');
  });

  it('rejects artifact root replacement before opening the temp file', async () => {
    const parent = await makeTempDir();
    const repoRoot = join(parent, 'repo');
    const artifactRoot = join(parent, 'artifacts');
    const outsideRoot = join(parent, 'outside');
    await mkdir(repoRoot);
    await mkdir(artifactRoot);
    await mkdir(outsideRoot);
    const pathSafety = await PathSafety.create({ repoRoot, artifactRoot });

    await expect(
      pathSafety.writeArtifactFile('stdout.txt', Buffer.from('unsafe write\n'), {
        beforeWrite: async () => {
          await rm(artifactRoot, { recursive: true, force: true });
          await symlink(outsideRoot, artifactRoot, 'dir');
        },
      }),
    ).rejects.toMatchObject({
      code: 'workspace_symlink_escape',
    });
    await expect(readFile(join(outsideRoot, 'stdout.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects symlink-to-file intermediate segments instead of treating them as missing paths', async () => {
    const parent = await makeTempDir();
    const repoRoot = join(parent, 'repo');
    await mkdir(repoRoot);
    await writeFile(join(repoRoot, 'target-file'), 'file\n');
    await symlink(join(repoRoot, 'target-file'), join(repoRoot, 'link-file'));
    const pathSafety = await PathSafety.create({ repoRoot });

    await expect(pathSafety.resolveRepoRelativePath('link-file/child.txt')).rejects.toMatchObject({
      code: 'workspace_path_escape',
    });
  });

  it('prepares artifact writes under a validated parent with a sibling temp path', async () => {
    const parent = await makeTempDir();
    const repoRoot = join(parent, 'repo');
    const artifactRoot = join(parent, 'artifacts');
    await mkdir(repoRoot);
    await mkdir(artifactRoot);
    const pathSafety = await PathSafety.create({ repoRoot, artifactRoot });
    const realArtifactRoot = await realpath(artifactRoot);

    const prepared = await pathSafety.prepareArtifactWrite('stdout.txt');

    expect(prepared.finalPath).toBe(join(realArtifactRoot, 'stdout.txt'));
    expect(dirname(prepared.tempPath)).toBe(dirname(prepared.finalPath));
    expect(prepared.tempPath).not.toBe(prepared.finalPath);
    expect(prepared.tempPath.startsWith(`${dirname(prepared.finalPath)}/.`)).toBe(true);
  });

  it('writes artifact files through the contained operation helper', async () => {
    const parent = await makeTempDir();
    const repoRoot = join(parent, 'repo');
    const artifactRoot = join(parent, 'artifacts');
    await mkdir(repoRoot);
    await mkdir(artifactRoot);
    const pathSafety = await PathSafety.create({ repoRoot, artifactRoot });

    const finalPath = await pathSafety.writeArtifactFile('stdout.txt', Buffer.from('safe write\n'));

    await expect(readFile(finalPath, 'utf8')).resolves.toBe('safe write\n');
  });
});
