import { Buffer } from 'node:buffer';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  collectWorkspaceBundleChangedFiles,
  createWorkspaceBundleArchive,
  createWorkspaceBundleManifest,
  createWorkspaceBundlePatchArtifact,
  safeUnpackWorkspaceBundle,
  verifyWorkspaceBundleArchiveDigest,
  workspaceBundleArchiveDigest,
  workspaceBundleManifestDigest,
  type WorkspaceBundleArchiveEntry,
} from '../../packages/codex-worker-runtime/src/workspace-bundle';

const tempRoots: string[] = [];
const now = '2026-05-23T00:00:00.000Z';

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'forgeloop-workspace-bundle-'));
  tempRoots.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const unsafeArchive = (entries: WorkspaceBundleArchiveEntry[]) => {
  const manifest = {
    schema_version: 'workspace_bundle.v1',
    bundle_id: 'unsafe-bundle',
    created_at: now,
    allowed_paths: ['**'],
    forbidden_paths: [],
    entries: entries.map((entry) => ({
      path: entry.path,
      type: entry.type,
      size_bytes: entry.type === 'file' ? Buffer.from(entry.content_base64 ?? '', 'base64').byteLength : 0,
      digest:
        entry.type === 'file'
          ? workspaceBundleArchiveDigest(Buffer.from(entry.content_base64 ?? '', 'base64'))
          : workspaceBundleArchiveDigest(Buffer.from(`${entry.type}:${entry.path}`)),
    })),
  };
  return {
    archiveBytes: Buffer.from(
      JSON.stringify({
        schema_version: 'workspace_bundle_archive.v1',
        manifest,
        entries,
      }),
      'utf8',
    ),
    manifest,
  };
};

describe('workspace bundle validation and safe unpack', () => {
  it('validates a workspace_bundle.v1 manifest digest and unpacks only under the per-job temp root', async () => {
    const tempRoot = await makeTempDir();
    const manifest = createWorkspaceBundleManifest({
      bundleId: 'bundle-1',
      createdAt: now,
      allowedPaths: ['src/**', 'README.md'],
      forbiddenPaths: ['secrets/**'],
      files: [
        { path: 'README.md', content: '# Test\n' },
        { path: 'src/app.ts', content: 'export const value = 1;\n' },
      ],
    });
    const manifestDigest = workspaceBundleManifestDigest(manifest);
    const archive = createWorkspaceBundleArchive({
      manifest,
      files: [
        { path: 'README.md', content: '# Test\n' },
        { path: 'src/app.ts', content: 'export const value = 1;\n' },
      ],
    });
    const archiveDigest = workspaceBundleArchiveDigest(archive);

    expect(verifyWorkspaceBundleArchiveDigest(archive, archiveDigest)).toEqual({
      digest: archiveDigest,
      size_bytes: archive.byteLength,
    });

    const unpacked = await safeUnpackWorkspaceBundle({
      archiveBytes: archive,
      expectedArchiveDigest: archiveDigest,
      expectedManifestDigest: manifestDigest,
      tempRoot,
      runtimeJobId: 'runtime-job-1',
    });

    expect(relative(await realpath(tempRoot), unpacked.workspacePath)).toBe('runtime-job-1/workspace');
    await expect(readFile(join(unpacked.workspacePath, 'src/app.ts'), 'utf8')).resolves.toBe('export const value = 1;\n');
    expect(unpacked.manifest_digest).toBe(manifestDigest);
    expect(unpacked.archive_digest).toBe(archiveDigest);
  });

  it('rejects digest mismatch, path traversal, absolute paths, symlinks, special files, and unsafe .git indirection', async () => {
    const tempRoot = await makeTempDir();
    const archive = createWorkspaceBundleArchive({
      manifest: createWorkspaceBundleManifest({
        bundleId: 'bundle-digest',
        createdAt: now,
        allowedPaths: ['**'],
        forbiddenPaths: [],
        files: [{ path: 'safe.txt', content: 'safe\n' }],
      }),
      files: [{ path: 'safe.txt', content: 'safe\n' }],
    });

    await expect(
      safeUnpackWorkspaceBundle({
        archiveBytes: archive,
        expectedArchiveDigest: workspaceBundleArchiveDigest(Buffer.from('different')),
        tempRoot,
        runtimeJobId: 'runtime-job-digest',
      }),
    ).rejects.toThrow(/codex_workspace_bundle_invalid/);

    const unsafeCases: Array<{ name: string; entries: WorkspaceBundleArchiveEntry[] }> = [
      {
        name: 'path traversal',
        entries: [{ path: '../escape.txt', type: 'file', content_base64: Buffer.from('escape').toString('base64') }],
      },
      {
        name: 'absolute path',
        entries: [{ path: '/tmp/escape.txt', type: 'file', content_base64: Buffer.from('escape').toString('base64') }],
      },
      {
        name: 'symlink escape',
        entries: [{ path: 'src/link', type: 'symlink', link_target: '../../outside' }],
      },
      {
        name: 'special device',
        entries: [{ path: 'src/device', type: 'character_device' }],
      },
      {
        name: '.git indirection',
        entries: [{ path: '.git', type: 'file', content_base64: Buffer.from('gitdir: /tmp/outside.git\n').toString('base64') }],
      },
      {
        name: 'nested .git indirection',
        entries: [{ path: 'vendor/module/.git', type: 'file', content_base64: Buffer.from('gitdir: /tmp/outside.git\n').toString('base64') }],
      },
    ];

    for (const unsafeCase of unsafeCases) {
      const candidate = unsafeArchive(unsafeCase.entries);
      await expect(
        safeUnpackWorkspaceBundle({
          archiveBytes: candidate.archiveBytes,
          expectedArchiveDigest: workspaceBundleArchiveDigest(candidate.archiveBytes),
          tempRoot,
          runtimeJobId: `runtime-job-${unsafeCase.name.replaceAll(' ', '-')}`,
        }),
      ).rejects.toThrow(/codex_workspace_bundle_invalid/);
    }
  });

  it('rejects pre-existing symlinked per-job temp roots before unpacking', async () => {
    const tempRoot = await makeTempDir();
    const outside = await makeTempDir();
    await mkdir(join(outside, 'workspace'), { recursive: true });
    await symlink(outside, join(tempRoot, 'runtime-job-symlink'));
    const manifest = createWorkspaceBundleManifest({
      bundleId: 'bundle-symlink-root',
      createdAt: now,
      allowedPaths: ['**'],
      forbiddenPaths: [],
      files: [{ path: 'safe.txt', content: 'safe\n' }],
    });
    const archive = createWorkspaceBundleArchive({
      manifest,
      files: [{ path: 'safe.txt', content: 'safe\n' }],
    });

    await expect(
      safeUnpackWorkspaceBundle({
        archiveBytes: archive,
        expectedArchiveDigest: workspaceBundleArchiveDigest(archive),
        expectedManifestDigest: workspaceBundleManifestDigest(manifest),
        tempRoot,
        runtimeJobId: 'runtime-job-symlink',
      }),
    ).rejects.toThrow(/codex_workspace_bundle_invalid/);
    await expect(readFile(join(outside, 'workspace', 'safe.txt'), 'utf8')).rejects.toThrow();
  });

  it('path-policy checks returned changed files and patch artifact refs', () => {
    expect(
      collectWorkspaceBundleChangedFiles({
        changedFiles: ['src/app.ts', 'README.md'],
        allowedPaths: ['src/**', 'README.md'],
        forbiddenPaths: ['secrets/**'],
      }),
    ).toEqual(['README.md', 'src/app.ts']);

    expect(() =>
      collectWorkspaceBundleChangedFiles({
        changedFiles: ['src/app.ts', '../escape.txt'],
        allowedPaths: ['src/**'],
        forbiddenPaths: [],
      }),
    ).toThrow(/codex_workspace_bundle_invalid/);
    expect(() =>
      collectWorkspaceBundleChangedFiles({
        changedFiles: ['secrets/key.txt'],
        allowedPaths: ['**'],
        forbiddenPaths: ['secrets/**'],
      }),
    ).toThrow(/codex_workspace_bundle_invalid/);

    const patchArtifact = createWorkspaceBundlePatchArtifact({
      runtimeJobId: 'runtime-job-1',
      patch: 'diff --git a/src/app.ts b/src/app.ts\n',
      changedFiles: ['src/app.ts'],
      allowedPaths: ['src/**'],
      forbiddenPaths: [],
    });
    expect(patchArtifact).toMatchObject({
      content_type: 'text/x-diff',
      changed_files: ['src/app.ts'],
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      internal_ref: expect.stringMatching(/^artifact:\/\/codex-runtime-jobs\/runtime-job-1\/artifacts\//),
    });

    expect(() =>
      createWorkspaceBundlePatchArtifact({
        runtimeJobId: 'runtime-job-1',
        patch: 'diff --git a/secrets/key.txt b/secrets/key.txt\n',
        changedFiles: ['secrets/key.txt'],
        allowedPaths: ['**'],
        forbiddenPaths: ['secrets/**'],
      }),
    ).toThrow(/codex_workspace_bundle_invalid/);
  });
});
