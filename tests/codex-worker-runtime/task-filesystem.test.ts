import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  assertInsideWorkerTempRoot,
  cleanupCodexTaskFilesystem,
  prepareCodexTaskFilesystem,
} from '../../packages/codex-worker-runtime/src/task-filesystem';

describe('codex task filesystem', () => {
  it('creates per-lease CODEX_HOME files with restricted permissions and cleans them up', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-worker-'));
    const prepared = await prepareCodexTaskFilesystem({
      workerTempRoot: tempRoot,
      workerId: 'worker-1',
      launchLeaseId: 'lease-1',
      codexConfigToml: 'approval_policy = "never"',
      authJson: { OPENAI_API_KEY: 'sk-test' },
    });

    expect(prepared.codexHomeHostPath).toBe(join(tempRoot, 'lease-1', 'codex-home'));
    await expect(readFile(join(prepared.codexHomeHostPath, 'config.toml'), 'utf8')).resolves.toContain('approval_policy');
    await expect(readFile(join(prepared.codexHomeHostPath, 'auth.json'), 'utf8')).resolves.toContain('OPENAI_API_KEY');
    expect((await stat(prepared.leaseTempRoot)).mode & 0o777).toBe(0o700);
    expect((await stat(prepared.codexHomeHostPath)).mode & 0o777).toBe(0o700);
    expect((await stat(join(prepared.codexHomeHostPath, 'auth.json'))).mode & 0o777).toBe(0o600);
    await expect(readFile(join(prepared.leaseTempRoot, '.forgeloop-resource.json'), 'utf8')).resolves.toBe(
      `${JSON.stringify({ workerId: 'worker-1', launchLeaseId: 'lease-1' })}\n`,
    );

    await cleanupCodexTaskFilesystem({ leaseTempRoot: prepared.leaseTempRoot });
    await expect(stat(prepared.leaseTempRoot)).rejects.toThrow();
  });

  it('creates a missing worker temp root with restricted permissions', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'forgeloop-worker-parent-'));
    const tempRoot = join(parent, 'worker-root');

    const prepared = await prepareCodexTaskFilesystem({
      workerTempRoot: tempRoot,
      workerId: 'worker-1',
      launchLeaseId: 'lease-1',
      codexConfigToml: 'approval_policy = "never"',
      authJson: {},
    });

    expect((await stat(tempRoot)).mode & 0o777).toBe(0o700);
    expect(prepared.leaseTempRoot).toBe(join(tempRoot, 'lease-1'));

    await cleanupCodexTaskFilesystem({ leaseTempRoot: prepared.leaseTempRoot });
  });

  it('rebuilds a stale owned deterministic lease root without preserving old task state', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-worker-'));
    const first = await prepareCodexTaskFilesystem({
      workerTempRoot: tempRoot,
      workerId: 'worker-1',
      launchLeaseId: 'lease-1',
      codexConfigToml: 'approval_policy = "never"',
      authJson: { OPENAI_API_KEY: 'sk-old' },
    });
    await writeFile(join(first.leaseTempRoot, 'old-state'), 'stale');

    const rebuilt = await prepareCodexTaskFilesystem({
      workerTempRoot: tempRoot,
      workerId: 'worker-1',
      launchLeaseId: 'lease-1',
      codexConfigToml: 'approval_policy = "on-request"',
      authJson: { OPENAI_API_KEY: 'sk-new' },
    });

    expect(rebuilt.leaseTempRoot).toBe(first.leaseTempRoot);
    await expect(stat(join(rebuilt.leaseTempRoot, 'old-state'))).rejects.toThrow();
    await expect(readFile(join(rebuilt.codexHomeHostPath, 'config.toml'), 'utf8')).resolves.toContain('on-request');
    await expect(readFile(join(rebuilt.codexHomeHostPath, 'auth.json'), 'utf8')).resolves.toContain('sk-new');

    await cleanupCodexTaskFilesystem({ leaseTempRoot: rebuilt.leaseTempRoot });
  });

  it('does not remove an existing lease root owned by another worker', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-worker-'));
    const leaseRoot = join(tempRoot, 'lease-1');
    await mkdir(leaseRoot);
    await writeFile(join(leaseRoot, '.forgeloop-resource.json'), `${JSON.stringify({ workerId: 'worker-2', launchLeaseId: 'lease-1' })}\n`);

    await expect(
      prepareCodexTaskFilesystem({
        workerTempRoot: tempRoot,
        workerId: 'worker-1',
        launchLeaseId: 'lease-1',
        codexConfigToml: '',
        authJson: {},
      }),
    ).rejects.toThrow();
    await expect(readFile(join(leaseRoot, '.forgeloop-resource.json'), 'utf8')).resolves.toContain('worker-2');
  });

  it('rejects symlinked lease roots and paths outside the worker temp root', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-worker-'));
    await symlink(tmpdir(), join(tempRoot, 'lease-link'));
    await expect(
      prepareCodexTaskFilesystem({
        workerTempRoot: tempRoot,
        workerId: 'worker-1',
        launchLeaseId: 'lease-link',
        codexConfigToml: '',
        authJson: {},
      }),
    ).rejects.toThrow(/symlink/);

    expect(() => assertInsideWorkerTempRoot(tempRoot, join(tmpdir(), 'outside'))).toThrow(/outside worker temp root/);
  });
});
