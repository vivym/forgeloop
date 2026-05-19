import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseExecutorRuntimeSafetyConfigFromEnv } from '../../packages/executor/src/index';

const sha = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';

const baseEnv = () => {
  const shellPath = realpathSync('/bin/sh');
  const shellRoot = dirname(shellPath);
  return {
    FORGELOOP_EXECUTOR_SANDBOX_EXECUTABLE: shellPath,
    FORGELOOP_EXECUTOR_SANDBOX_BINARY_DIGEST: sha,
    FORGELOOP_EXECUTOR_SANDBOX_CONFIG_DIGEST: sha,
    FORGELOOP_EXECUTOR_ARTIFACT_ROOT: realpathSync('/var'),
    FORGELOOP_EXECUTOR_TRUSTED_TOOLCHAINS: JSON.stringify({
      posix: {
        root_paths: [shellRoot],
        executable_names: [basename(shellPath)],
        config_digest: sha,
      },
    }),
    FORGELOOP_EXECUTOR_DEFAULT_CPU_MS: '1000',
    FORGELOOP_EXECUTOR_DEFAULT_MEMORY_MB: '512',
    FORGELOOP_EXECUTOR_DEFAULT_PIDS: '32',
    FORGELOOP_EXECUTOR_DEFAULT_FDS: '64',
    FORGELOOP_EXECUTOR_DEFAULT_WORKSPACE_BYTES: '1048576',
    FORGELOOP_EXECUTOR_DEFAULT_ARTIFACT_BYTES: '1048576',
  };
};

describe('Executor runtime safety config parsing', () => {
  it('reads only explicit FORGELOOP_EXECUTOR keys and never ambient PATH', () => {
    const env = {
      ...baseEnv(),
      PATH: '/tmp/attacker-bin',
      FORGELOOP_EXECUTOR_UNKNOWN: '/tmp/ignored',
    };

    const parsed = parseExecutorRuntimeSafetyConfigFromEnv(env, {
      workspaceRoot: '/workspace/repo',
      tempRoot: tmpdir(),
      packageControlledPaths: ['/workspace/repo/package'],
    });

    expect(parsed).toMatchObject({
      status: 'available',
      config: {
        sandbox: {
          executable_path: env.FORGELOOP_EXECUTOR_SANDBOX_EXECUTABLE,
          binary_digest: sha,
          config_digest: sha,
          default_cpu_ms: 1000,
        },
        artifact_root: realpathSync('/var'),
        trusted_toolchains: {
          posix: {
            root_paths: [dirname(env.FORGELOOP_EXECUTOR_SANDBOX_EXECUTABLE)],
            executable_names: [basename(env.FORGELOOP_EXECUTOR_SANDBOX_EXECUTABLE)],
            config_digest: sha,
          },
        },
      },
    });
  });

  it('selects unavailable governor config when required explicit settings are missing', () => {
    expect(parseExecutorRuntimeSafetyConfigFromEnv({ PATH: '/tmp/attacker-bin' })).toEqual(
      expect.objectContaining({
        status: 'unavailable',
        reason_code: 'runtime_hard_limits_unavailable',
        missing_keys: expect.arrayContaining([
          'FORGELOOP_EXECUTOR_SANDBOX_EXECUTABLE',
          'FORGELOOP_EXECUTOR_SANDBOX_BINARY_DIGEST',
          'FORGELOOP_EXECUTOR_SANDBOX_CONFIG_DIGEST',
          'FORGELOOP_EXECUTOR_ARTIFACT_ROOT',
          'FORGELOOP_EXECUTOR_TRUSTED_TOOLCHAINS',
        ]),
      }),
    );
  });

  it('rejects configured paths under workspace, artifact, temp, or package-controlled roots', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-runtime-config-'));
    const workspaceRoot = join(tempRoot, 'workspace');
    const artifactRoot = join(tempRoot, 'artifacts');
    const toolRoot = join(workspaceRoot, 'tools');
    const packageControlledRoot = join(workspaceRoot, 'package');
    const sandboxPath = join(packageControlledRoot, 'sandbox');
    try {
      await mkdir(toolRoot, { recursive: true });
      await mkdir(artifactRoot, { recursive: true });
      await mkdir(packageControlledRoot, { recursive: true });
      await writeFile(join(toolRoot, 'tool'), '#!/bin/sh\nexit 0\n');
      await writeFile(sandboxPath, '#!/bin/sh\nexit 0\n');
      await chmod(join(toolRoot, 'tool'), 0o755);
      await chmod(sandboxPath, 0o755);

      const env = {
        ...baseEnv(),
        FORGELOOP_EXECUTOR_SANDBOX_EXECUTABLE: sandboxPath,
        FORGELOOP_EXECUTOR_ARTIFACT_ROOT: artifactRoot,
        FORGELOOP_EXECUTOR_TRUSTED_TOOLCHAINS: JSON.stringify({
          repo: { root_paths: [toolRoot], executable_names: ['tool'], config_digest: sha },
        }),
      };

      expect(
        parseExecutorRuntimeSafetyConfigFromEnv(env, {
          workspaceRoot,
          tempRoot,
          packageControlledPaths: [packageControlledRoot],
        }),
      ).toMatchObject({
        status: 'invalid',
        reason_code: 'runtime_safety_config_invalid',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'runtime_safety_path_rejected' }),
        ]),
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
