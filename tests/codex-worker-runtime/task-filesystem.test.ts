import { mkdtemp, readFile, stat, symlink } from 'node:fs/promises';
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
