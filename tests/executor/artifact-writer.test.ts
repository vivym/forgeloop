import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ArtifactWriter, type ArtifactWriterPolicy } from '../../packages/executor/src/index';

const tempRoots: string[] = [];

const defaultPolicy: ArtifactWriterPolicy = {
  defaultVisibility: 'internal',
  perArtifactByteLimit: 1024,
  perRunByteLimit: 4096,
  publicSafeKinds: ['diff', 'execution_summary'],
  publicSafeRedactor: ({ bytes }) => bytes,
};

const makeTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'forgeloop-artifact-writer-'));
  tempRoots.push(dir);
  return dir;
};

const createRoots = async () => {
  const parent = await makeTempDir();
  const repoRoot = join(parent, 'repo');
  const artifactRoot = join(parent, 'artifacts');
  await mkdir(repoRoot);
  await mkdir(artifactRoot);

  return { parent, repoRoot, artifactRoot };
};

const createWriter = async (input: {
  repoRoot: string;
  artifactRoot: string;
  policy?: ArtifactWriterPolicy;
  packageControlledPaths?: readonly string[];
}) =>
  ArtifactWriter.create({
    runSessionId: 'run-session-1',
    repoRoot: input.repoRoot,
    artifactRoot: input.artifactRoot,
    packageControlledPaths: input.packageControlledPaths,
    policy: input.policy ?? defaultPolicy,
  });

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('ArtifactWriter', () => {
  it('rejects artifact roots overlapping the repo, git, worktree, or package-controlled paths', async () => {
    const parent = await makeTempDir();
    const repoRoot = join(parent, 'repo');
    await mkdir(join(repoRoot, '.git'), { recursive: true });
    await mkdir(join(repoRoot, '.worktrees', 'run-session-1'), { recursive: true });
    await mkdir(join(repoRoot, 'packages', 'executor'), { recursive: true });

    const overlappingRoots = [
      join(repoRoot, 'artifacts'),
      join(repoRoot, '.git', 'artifacts'),
      join(repoRoot, '.worktrees', 'artifacts'),
      join(repoRoot, 'packages', 'executor', 'artifacts'),
    ];

    for (const artifactRoot of overlappingRoots) {
      await mkdir(artifactRoot, { recursive: true });
      await expect(
        ArtifactWriter.create({
          runSessionId: 'run-session-1',
          repoRoot,
          artifactRoot,
          packageControlledPaths: ['packages/executor'],
          policy: defaultPolicy,
        }),
      ).rejects.toMatchObject({ code: 'artifact_root_overlap' });
    }
  });

  it('writes through a temp file and returns public-safe refs without absolute paths', async () => {
    const { repoRoot, artifactRoot } = await createRoots();
    const writer = await createWriter({ repoRoot, artifactRoot });
    const realArtifactRoot = await realpath(artifactRoot);

    const artifact = await writer.writeText({
      kind: 'diff',
      name: 'patch.diff',
      contentType: 'text/x-diff',
      content: 'diff --git a/file b/file\n',
      visibility: 'public_safe',
    });

    const expectedPath = join(realArtifactRoot, 'run-session-1-diff-patch.diff');
    await expect(readFile(expectedPath, 'utf8')).resolves.toBe('diff --git a/file b/file\n');
    await expect(readdir(realArtifactRoot)).resolves.toEqual(['run-session-1-diff-patch.diff']);
    expect(artifact).toMatchObject({
      kind: 'diff',
      name: 'patch.diff',
      content_type: 'text/x-diff',
      digest: `sha256:${createHash('sha256').update('diff --git a/file b/file\n').digest('hex')}`,
    });
    expect(artifact.local_ref).toBeUndefined();
    expect(artifact.storage_uri).toBe('artifacts/run-session-1-diff-patch.diff');
    expect(artifact.storage_uri).not.toContain(realArtifactRoot);
    expect(artifact.storage_uri?.startsWith('/')).toBe(false);
  });

  it('requires public-safe redaction and writes only redacted bytes', async () => {
    const { repoRoot, artifactRoot } = await createRoots();
    const writerWithoutRedactor = await createWriter({
      repoRoot,
      artifactRoot,
      policy: {
        ...defaultPolicy,
        publicSafeRedactor: undefined,
      },
    });

    await expect(
      writerWithoutRedactor.writeText({
        kind: 'diff',
        name: 'unsafe.diff',
        contentType: 'text/x-diff',
        content: 'SECRET_TOKEN=abc123\n',
        visibility: 'public_safe',
      }),
    ).rejects.toMatchObject({ code: 'artifact_visibility_denied' });

    const redactedRoots = await createRoots();
    const redactingWriter = await createWriter({
      repoRoot: redactedRoots.repoRoot,
      artifactRoot: redactedRoots.artifactRoot,
      policy: {
        ...defaultPolicy,
        publicSafeRedactor: ({ bytes }) =>
          Buffer.from(Buffer.from(bytes).toString('utf8').replace('SECRET_TOKEN=abc123', '[REDACTED]').slice(0, 20)),
      },
    });

    const artifact = await redactingWriter.writeText({
      kind: 'diff',
      name: 'redacted.diff',
      contentType: 'text/x-diff',
      content: 'SECRET_TOKEN=abc123 plus extra raw content\n',
      visibility: 'public_safe',
    });

    const expectedPath = join(await realpath(redactedRoots.artifactRoot), 'run-session-1-diff-redacted.diff');
    await expect(readFile(expectedPath, 'utf8')).resolves.toBe('[REDACTED] plus extr');
    expect(artifact.digest).toBe(`sha256:${createHash('sha256').update('[REDACTED] plus extr').digest('hex')}`);
    expect(artifact.storage_uri).toBe('artifacts/run-session-1-diff-redacted.diff');

    const denyingRoots = await createRoots();
    const denyingWriter = await createWriter({
      repoRoot: denyingRoots.repoRoot,
      artifactRoot: denyingRoots.artifactRoot,
      policy: {
        ...defaultPolicy,
        publicSafeRedactor: () => null,
      },
    });

    await expect(
      denyingWriter.writeText({
        kind: 'diff',
        name: 'denied.diff',
        contentType: 'text/x-diff',
        content: 'cannot be made public\n',
        visibility: 'public_safe',
      }),
    ).rejects.toMatchObject({ code: 'artifact_visibility_denied' });
  });

  it('does not allow later writes to overwrite an existing public-safe artifact ref', async () => {
    const { repoRoot, artifactRoot } = await createRoots();
    const writer = await createWriter({
      repoRoot,
      artifactRoot,
      policy: {
        ...defaultPolicy,
        publicSafeRedactor: ({ bytes }) =>
          Buffer.from(Buffer.from(bytes).toString('utf8').replace('SECRET=one', '[REDACTED]')),
      },
    });

    const publicArtifact = await writer.writeText({
      kind: 'diff',
      name: 'patch.diff',
      contentType: 'text/x-diff',
      content: 'SECRET=one\n',
      visibility: 'public_safe',
    });

    await expect(
      writer.writeText({
        kind: 'diff',
        name: 'patch.diff',
        contentType: 'text/x-diff',
        content: 'SECRET=two\n',
      }),
    ).rejects.toMatchObject({ code: 'artifact_write_conflict' });

    const expectedPath = join(await realpath(artifactRoot), 'run-session-1-diff-patch.diff');
    await expect(readFile(expectedPath, 'utf8')).resolves.toBe('[REDACTED]\n');
    expect(publicArtifact.storage_uri).toBe('artifacts/run-session-1-diff-patch.diff');
    expect(publicArtifact.digest).toBe(`sha256:${createHash('sha256').update('[REDACTED]\n').digest('hex')}`);
  });

  it('enforces per-artifact and per-run byte quotas', async () => {
    const { repoRoot, artifactRoot } = await createRoots();
    const writer = await createWriter({
      repoRoot,
      artifactRoot,
      policy: {
        ...defaultPolicy,
        perArtifactByteLimit: 4,
      },
    });

    await expect(
      writer.writeBytes({
        kind: 'logs',
        name: 'too-large.bin',
        contentType: 'application/octet-stream',
        bytes: new Uint8Array([1, 2, 3, 4, 5]),
      }),
    ).rejects.toMatchObject({ code: 'artifact_quota_exceeded' });

    const secondRoots = await createRoots();
    const runQuotaWriter = await createWriter({
      repoRoot: secondRoots.repoRoot,
      artifactRoot: secondRoots.artifactRoot,
      policy: {
        ...defaultPolicy,
        perArtifactByteLimit: 10,
        perRunByteLimit: 6,
      },
    });

    await runQuotaWriter.writeText({
      kind: 'logs',
      name: 'first.txt',
      contentType: 'text/plain',
      content: 'abc',
    });
    await expect(
      runQuotaWriter.writeText({
        kind: 'logs',
        name: 'second.txt',
        contentType: 'text/plain',
        content: 'defg',
      }),
    ).rejects.toMatchObject({ code: 'artifact_quota_exceeded' });
  });

  it('imports sandbox output only from the provided sandbox output root', async () => {
    const { repoRoot, artifactRoot, parent } = await createRoots();
    const sandboxOutputRoot = join(parent, 'sandbox-output');
    const outsideRoot = join(parent, 'outside');
    await mkdir(join(sandboxOutputRoot, 'nested'), { recursive: true });
    await mkdir(outsideRoot);
    await writeFile(join(sandboxOutputRoot, 'nested', 'out.txt'), 'sandbox output\n');
    await writeFile(join(outsideRoot, 'secret.txt'), 'secret\n');
    await symlink(outsideRoot, join(sandboxOutputRoot, 'link-out'), 'dir');
    const writer = await createWriter({ repoRoot, artifactRoot });

    const artifact = await writer.importSandboxOutput({
      sandboxOutputRoot,
      relativePath: 'nested/out.txt',
      kind: 'logs',
      name: 'sandbox-output.txt',
      contentType: 'text/plain',
    });
    await expect(readFile(artifact.local_ref ?? '', 'utf8')).resolves.toBe('sandbox output\n');

    await expect(
      writer.importSandboxOutput({
        sandboxOutputRoot,
        relativePath: join(outsideRoot, 'secret.txt'),
        kind: 'logs',
        name: 'absolute-secret.txt',
        contentType: 'text/plain',
      }),
    ).rejects.toMatchObject({ code: 'path_not_repo_relative' });
    await expect(
      writer.importSandboxOutput({
        sandboxOutputRoot,
        relativePath: '../outside/secret.txt',
        kind: 'logs',
        name: 'relative-secret.txt',
        contentType: 'text/plain',
      }),
    ).rejects.toMatchObject({ code: 'path_not_repo_relative' });
    await expect(
      writer.importSandboxOutput({
        sandboxOutputRoot,
        relativePath: 'link-out/secret.txt',
        kind: 'logs',
        name: 'symlink-secret.txt',
        contentType: 'text/plain',
      }),
    ).rejects.toMatchObject({ code: 'workspace_symlink_escape' });
  });

  it('keeps raw runtime artifacts internal by default unless public-safe kind policy explicitly allows them', async () => {
    const { repoRoot, artifactRoot } = await createRoots();
    const writer = await createWriter({
      repoRoot,
      artifactRoot,
      policy: {
        ...defaultPolicy,
        defaultVisibility: 'public_safe',
        publicSafeKinds: ['diff'],
      },
    });

    const implicitDiff = await writer.writeText({
      kind: 'diff',
      name: 'implicit-public.diff',
      contentType: 'text/x-diff',
      content: 'diff --git a/file b/file\n',
    });
    expect(implicitDiff.local_ref).toBeDefined();
    expect(implicitDiff.storage_uri).toBeUndefined();

    for (const kind of ['check_output', 'logs', 'raw_metadata'] as const) {
      const artifact = await writer.writeText({
        kind,
        name: `${kind}.txt`,
        contentType: 'text/plain',
        content: `raw ${kind} output\n`,
      });
      expect(artifact.local_ref).toBeDefined();
      expect(artifact.storage_uri).toBeUndefined();
    }

    await expect(
      writer.writeText({
        kind: 'check_output',
        name: 'public-stdout.txt',
        contentType: 'text/plain',
        content: 'raw check output\n',
        visibility: 'public_safe',
      }),
    ).rejects.toMatchObject({ code: 'artifact_visibility_denied' });

    const allowedRoots = await createRoots();
    const allowedWriter = await createWriter({
      repoRoot: allowedRoots.repoRoot,
      artifactRoot: allowedRoots.artifactRoot,
      policy: {
        ...defaultPolicy,
        publicSafeKinds: ['check_output'],
      },
    });
    const explicitlyPublicCheck = await allowedWriter.writeText({
      kind: 'check_output',
      name: 'allowed-stdout.txt',
      contentType: 'text/plain',
      content: 'redacted check output\n',
      visibility: 'public_safe',
    });

    expect(explicitlyPublicCheck.local_ref).toBeUndefined();
    expect(explicitlyPublicCheck.storage_uri).toBe('artifacts/run-session-1-check_output-allowed-stdout.txt');
  });
});
