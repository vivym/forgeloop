import { describe, expect, it } from 'vitest';

import type { RunSession } from '@forgeloop/domain';

import { serializePublicRunSession } from '../../apps/control-plane-api/src/modules/query/public-run-session-projection';

describe('run session public serialization', () => {
  it('uses shared public artifact serialization for artifacts and check outputs', () => {
    const runSession: RunSession = {
      id: 'run-session-1',
      execution_package_id: 'package-1',
      requested_by_actor_id: 'actor-1',
      status: 'succeeded',
      executor_type: 'mock',
      changed_files: [],
      artifacts: [
        {
          kind: 'diff',
          name: 'Patch',
          content_type: 'text/x-patch',
          storage_uri: 's3://bucket/diff.patch',
          local_ref: 'artifacts/run/diff.patch',
        },
        {
          kind: 'diff',
          name: 'Unsafe',
          content_type: 'text/x-patch',
          storage_uri: 'https://example.test/diff.patch?token=secret',
        },
        {
          kind: 'execution_summary',
          name: '/Users/viv/projs/forgeloop/out.md',
          content_type: 'text/markdown',
          storage_uri: 's3://bucket/summary.md',
        },
      ],
      log_refs: [
        {
          kind: 'logs',
          name: 'Logs',
          content_type: 'text/plain',
          local_ref: 'artifacts/run/logs.txt',
        },
      ],
      check_results: [
        {
          check_id: 'contracts',
          command: 'pnpm vitest run tests/contracts',
          status: 'succeeded',
          exit_code: 0,
          duration_seconds: 1,
          blocks_review: true,
          stdout: {
            kind: 'check_output',
            name: 'stdout',
            content_type: 'text/plain',
            storage_uri: 'file:///Users/viv/stdout.txt',
          },
          stderr: {
            kind: 'check_output',
            name: 'stderr',
            content_type: 'text/plain',
            storage_uri: 'https://example.test/stderr.txt?token=secret',
          },
        },
      ],
      created_at: '2026-05-10T00:00:00.000Z',
      updated_at: '2026-05-10T00:00:01.000Z',
    };

    const serialized = serializePublicRunSession(runSession);

    expect(serialized.artifacts).toEqual([
      {
        kind: 'diff',
        name: 'Patch',
        content_type: 'text/x-patch',
        storage_uri: 's3://bucket/diff.patch',
      },
    ]);
    expect(serialized.log_refs).toEqual([]);
    expect(serialized.check_results[0]).not.toHaveProperty('stdout');
    expect(serialized.check_results[0]).not.toHaveProperty('stderr');
    expect(JSON.stringify(serialized)).not.toContain('token=secret');
    expect(JSON.stringify(serialized)).not.toContain('local_ref');
    expect(JSON.stringify(serialized)).not.toContain('/Users/viv/projs/forgeloop');
  });

  it('keeps only public-safe Dockerized Codex runtime evidence', () => {
    const runSession: RunSession = {
      id: 'run-session-1',
      execution_package_id: 'package-1',
      requested_by_actor_id: 'actor-1',
      status: 'running',
      executor_type: 'local_codex',
      changed_files: [],
      artifacts: [],
      log_refs: [],
      check_results: [],
      runtime_metadata: {
        durability_mode: 'durable',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'confirmed',
        driver_kind: 'app_server',
        driver_status: 'active',
        worker_id: 'worker-1',
        runtime_profile_id: 'profile-1',
        runtime_profile_revision_id: 'profile-rev-1',
        runtime_profile_digest: `sha256:${'a'.repeat(64)}`,
        runtime_target_kind: 'run_execution',
        source_access_mode: 'path_policy_scoped',
        environment: 'local_dogfood',
        credential_binding_id: 'credential-1',
        credential_binding_version_id: 'credential-v1',
        credential_payload_digest: `sha256:${'b'.repeat(64)}`,
        launch_lease_id: 'lease-1',
        docker_image_digest: `sha256:${'c'.repeat(64)}`,
        container_id_digest: `sha256:${'d'.repeat(64)}`,
        app_server_effective_config_digest: `sha256:${'e'.repeat(64)}`,
        network_policy_digest: `sha256:${'f'.repeat(64)}`,
        network_policy_self_test_digest: `sha256:${'1'.repeat(64)}`,
        docker_policy_self_check_digest: `sha256:${'2'.repeat(64)}`,
        workspace_isolation_digest: `sha256:${'3'.repeat(64)}`,
        app_server_attempted: true,
        selected_execution_mode: 'app_server',
        app_server_endpoint: 'unix:/Users/viv/private/codex.sock',
        workspace_path: '/Users/viv/projs/forgeloop/.worktrees/run-session-1',
        source_repo_path: '/Users/viv/projs/forgeloop',
        source_repo_before_status: ' M secret',
        source_repo_before_dirty_fingerprint: 'raw-dirty-fingerprint',
      },
      created_at: '2026-05-10T00:00:00.000Z',
      updated_at: '2026-05-10T00:00:01.000Z',
    };

    const serialized = serializePublicRunSession(runSession);

    expect(serialized.runtime_metadata).toMatchObject({
      runtime_profile_id: 'profile-1',
      runtime_profile_revision_id: 'profile-rev-1',
      credential_binding_id: 'credential-1',
      credential_binding_version_id: 'credential-v1',
      launch_lease_id: 'lease-1',
      worker_id: 'worker-1',
      app_server_attempted: true,
      selected_execution_mode: 'app_server',
    });
    expect(serialized.runtime_metadata).not.toHaveProperty('app_server_endpoint');
    expect(serialized.runtime_metadata).not.toHaveProperty('workspace_path');
    expect(serialized.runtime_metadata).not.toHaveProperty('source_repo_path');
    expect(serialized.runtime_metadata).not.toHaveProperty('source_repo_before_status');
    expect(serialized.runtime_metadata).not.toHaveProperty('source_repo_before_dirty_fingerprint');
    expect(JSON.stringify(serialized)).not.toContain('/Users/viv');
    expect(JSON.stringify(serialized)).not.toContain('codex.sock');
  });

  it('drops malformed Dockerized runtime evidence instead of projecting unsafe values', () => {
    const runSession: RunSession = {
      id: 'run-session-1',
      execution_package_id: 'package-1',
      requested_by_actor_id: 'actor-1',
      status: 'running',
      executor_type: 'local_codex',
      changed_files: [],
      artifacts: [],
      log_refs: [],
      check_results: [],
      runtime_metadata: {
        durability_mode: 'durable',
        recovery_attempt_count: 0,
        worker_id: '4f1e2d3c4f1e',
        runtime_profile_id: 'profile-1',
        runtime_profile_revision_id: 'profile-rev-1',
        runtime_profile_digest: `sha256:${'a'.repeat(64)}`,
        runtime_target_kind: 'run_execution',
        source_access_mode: 'path_policy_scoped',
        environment: 'local_dogfood',
        launch_lease_id: 'lease-1',
        docker_image_digest: `sha256:${'c'.repeat(64)}`,
        container_id_digest: '/var/run/docker.sock',
        app_server_effective_config_digest: `sha256:${'e'.repeat(64)}`,
        docker_policy_self_check_digest: `sha256:${'2'.repeat(64)}`,
        app_server_attempted: true,
        selected_execution_mode: 'app_server',
      },
      created_at: '2026-05-10T00:00:00.000Z',
      updated_at: '2026-05-10T00:00:01.000Z',
    };

    const serialized = serializePublicRunSession(runSession);

    expect(serialized.runtime_metadata).not.toHaveProperty('worker_id');
    expect(serialized.runtime_metadata).not.toHaveProperty('runtime_profile_id');
    expect(serialized.runtime_metadata).not.toHaveProperty('container_id_digest');
    expect(JSON.stringify(serialized)).not.toContain('/var/run/docker.sock');
  });
});
