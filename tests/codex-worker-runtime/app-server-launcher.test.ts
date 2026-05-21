import { describe, expect, it } from 'vitest';
import { mkdtemp, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { codexCanonicalDigest, type CodexLaunchMaterialization } from '@forgeloop/domain';

import { DockerizedCodexAppServerLauncher } from '../../packages/codex-worker-runtime/src/app-server-launcher';
import { FakeDockerRunner } from '../../packages/codex-worker-runtime/src/fake-docker-runner';

const digest = (char: string) => `sha256:${char.repeat(64)}`;

const materialization = (tempRoot: string): CodexLaunchMaterialization => ({
  launch_target: {
    target_type: 'automation_action_run',
    target_id: 'action-1',
    target_kind: 'generation',
    project_id: 'proj',
    repo_id: 'repo',
  },
  lease_id: 'lease-1',
  expires_at: '2026-05-21T00:15:00.000Z',
  materialized_at: '2026-05-21T00:00:00.000Z',
  resolved_credentials: [
    {
      binding_id: 'cred-1',
      binding_version_id: 'cred-v1',
      payload: { OPENAI_API_KEY: 'sk-test' },
      payload_digest: digest('e'),
    },
  ],
  profile_revision: {
    id: 'profile-rev-1',
    profile_id: 'profile-1',
    revision_number: 1,
    status: 'active',
    environment: 'test',
    docker_image: 'ghcr.io/forgeloop/codex',
    docker_image_digest: digest('a'),
    target_kind: 'generation',
    source_access_mode: 'artifact_only',
    codex_config_toml: 'approval_policy = "never"',
    codex_config_digest: codexCanonicalDigest('approval_policy = "never"'),
    expected_effective_config_digest: codexCanonicalDigest({
      target_kind: 'generation',
      approval_policy: 'never',
      source_write_policy: 'artifact_only',
      forbidden_writable_roots: ['workspace'],
    }),
    effective_config_assertions: {
      target_kind: 'generation',
      approval_policy: 'never',
      source_write_policy: 'artifact_only',
      forbidden_writable_roots: ['workspace'],
    },
    app_server_required: true,
    allowed_driver_kind: 'app_server',
    network_policy: { mode: 'disabled' },
    resource_limits: {
      cpu_ms: 1000,
      memory_mb: 512,
      pids: 64,
      fds: 128,
      workspace_bytes: 0,
      artifact_bytes: 1000,
      timeout_ms: 60_000,
      output_limit_bytes: 1000,
      run_output_limit_bytes: 1000,
    },
    docker_policy: {
      app_server_only: true,
      rootless: true,
      read_only_rootfs: true,
      no_new_privileges: true,
      drop_capabilities: ['ALL'],
    },
    allowed_scopes: [{ project_id: 'proj', repo_id: 'repo' }],
    profile_digest: digest('f'),
    created_by_actor_id: 'actor',
    created_at: '2026-05-21T00:00:00.000Z',
  },
});

describe('DockerizedCodexAppServerLauncher', () => {
  it('materializes once, writes per-task files, starts Docker, returns internal endpoint and public-safe evidence', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-worker-'));
    const runner = new FakeDockerRunner({
      effectiveConfig: {
        target_kind: 'generation',
        approval_policy: 'never',
        source_write_policy: 'artifact_only',
        forbidden_writable_roots: ['workspace'],
      },
    });
    const terminalized: unknown[] = [];
    const launcher = new DockerizedCodexAppServerLauncher({
      dockerBin: 'docker',
      workerId: 'worker-1',
      workerSessionToken: 'session-1',
      workerTempRoot,
      dockerRunner: runner,
      controlPlaneClient: {
        materializeLaunchLease: async () => materialization(workerTempRoot),
        terminalizeLaunchLease: async (input: unknown) => {
          terminalized.push(input);
          return {};
        },
      },
      hostUid: 501,
      hostGid: 20,
      nonceFactory: () => 'nonce-1',
      now: () => '2026-05-21T00:00:00.000Z',
    });

    const session = await launcher.launchFromLease({ leaseId: 'lease-1', launchToken: 'launch-secret' });

    expect(session.endpoint).toMatch(/^unix:/);
    expect(JSON.stringify(session.publicEvidence)).not.toContain(workerTempRoot);
    expect(session.publicEvidence).toMatchObject({
      runtime_profile_id: 'profile-1',
      runtime_profile_revision_id: 'profile-rev-1',
      launch_lease_id: 'lease-1',
      docker_image_digest: digest('a'),
    });
    expect(runner.startedCommands).toHaveLength(1);
    await expect(stat(join(workerTempRoot, 'lease-1', 'codex-home', 'auth.json'))).resolves.toBeDefined();

    await session.close('succeeded', 'done');
    expect(terminalized).toHaveLength(1);
    await expect(stat(join(workerTempRoot, 'lease-1'))).rejects.toThrow();
  });

  it('cleans task files and stops Docker even when terminalization fails', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-worker-'));
    const runner = new FakeDockerRunner({
      effectiveConfig: {
        target_kind: 'generation',
        approval_policy: 'never',
        source_write_policy: 'artifact_only',
        forbidden_writable_roots: ['workspace'],
      },
    });
    const launcher = new DockerizedCodexAppServerLauncher({
      dockerBin: 'docker',
      workerId: 'worker-1',
      workerSessionToken: 'session-1',
      workerTempRoot,
      dockerRunner: runner,
      controlPlaneClient: {
        materializeLaunchLease: async () => materialization(workerTempRoot),
        terminalizeLaunchLease: async () => {
          throw new Error('terminalize failed');
        },
      },
      hostUid: 501,
      hostGid: 20,
      nonceFactory: () => 'nonce-1',
      now: () => '2026-05-21T00:00:00.000Z',
    });

    const session = await launcher.launchFromLease({ leaseId: 'lease-1', launchToken: 'launch-secret' });

    await expect(session.close('failed', 'failed')).rejects.toThrow(/terminalize failed/);
    expect(runner.stoppedContainerDigests).toHaveLength(1);
    await expect(stat(join(workerTempRoot, 'lease-1'))).rejects.toThrow();
  });

  it('terminalizes a materialized lease when Docker startup assertions fail', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-worker-'));
    const runner = new FakeDockerRunner({
      effectiveConfig: {
        target_kind: 'generation',
        approval_policy: 'on-request',
        source_write_policy: 'artifact_only',
        forbidden_writable_roots: ['workspace'],
      },
    });
    const terminalized: unknown[] = [];
    const launcher = new DockerizedCodexAppServerLauncher({
      dockerBin: 'docker',
      workerId: 'worker-1',
      workerSessionToken: 'session-1',
      workerTempRoot,
      dockerRunner: runner,
      controlPlaneClient: {
        materializeLaunchLease: async () => materialization(workerTempRoot),
        terminalizeLaunchLease: async (_workerId, _leaseId, input) => {
          terminalized.push(input);
          return {};
        },
      },
      hostUid: 501,
      hostGid: 20,
      nonceFactory: () => 'nonce-1',
      now: () => '2026-05-21T00:00:00.000Z',
    });

    await expect(launcher.launchFromLease({ leaseId: 'lease-1', launchToken: 'launch-secret' })).rejects.toThrow(
      /codex_app_server_effective_config_mismatch/,
    );

    expect(terminalized).toHaveLength(1);
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'terminal',
      reason_code: 'codex_app_server_effective_config_mismatch',
      evidence_summary: {
        launch_lease_id: 'lease-1',
        app_server_attempted: true,
        selected_execution_mode: 'app_server',
        startup_blocker_code: 'codex_app_server_effective_config_mismatch',
      },
    });
    expect(runner.stoppedContainerDigests).toHaveLength(1);
    await expect(stat(join(workerTempRoot, 'lease-1'))).rejects.toThrow();
  });
});
