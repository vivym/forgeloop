import { describe, expect, it } from 'vitest';

import type { CodexDriverStartInput, CodexDriverStreamItem, CodexSessionDriver } from '@forgeloop/executor';

import { createLeasedRunSessionCodexDriver } from '../../packages/codex-worker-runtime/src/run-session-driver';

const runSession = {
  id: 'run-session-1',
  execution_package_id: 'package-1',
  status: 'running',
  updated_at: '2026-05-21T00:00:00.000Z',
  run_spec: {
    run_session_id: 'run-session-1',
    execution_package_id: 'package-1',
    expected_package_version: 1,
    executor_type: 'local_codex',
    workflow_only: false,
    project_id: 'project-1',
    repo: { repo_id: 'repo-1', local_path: '/host/repo', base_commit_sha: 'abc123' },
    objective: 'Do the work.',
  },
} as any;

const startInput = {
  runSpec: runSession.run_spec,
  workspacePath: '/host/repo',
  runtimeMetadata: {
    durability_mode: 'durable',
    recovery_attempt_count: 0,
    effective_dangerous_mode: 'confirmed',
  },
} satisfies CodexDriverStartInput;

describe('createLeasedRunSessionCodexDriver', () => {
  it('delegates with the container workspace and terminalizes the Docker session with the stream terminal status once', async () => {
    const closed: Array<{ status: string; summary: string }> = [];
    const innerInputs: CodexDriverStartInput[] = [];
    const innerDriver: CodexSessionDriver = {
      kind: 'app_server',
      async *startRun(input) {
        innerInputs.push(input);
        yield { kind: 'terminal', status: 'succeeded', summary: 'done' } satisfies CodexDriverStreamItem;
      },
      async *resumeRun(input) {
        innerInputs.push(input);
        yield { kind: 'terminal', status: 'failed', summary: 'unexpected' } satisfies CodexDriverStreamItem;
      },
      sendInput: async () => ({}),
      cancelRun: async () => ({}),
      close: async () => undefined,
    };
    const driver = createLeasedRunSessionCodexDriver(
      {
        workerIdentity: 'worker-identity-1',
        createLaunchLease: async () => ({ leaseId: 'lease-1', launchToken: 'launch-token-1' }),
        launcher: {
          launchFromLease: async () => ({
            endpoint: 'unix:/safe/codex.sock',
            containerWorkspacePath: '/workspace',
            publicEvidence: {
              launch_lease_id: 'lease-1',
              runtime_profile_id: 'profile-1',
              runtime_profile_revision_id: 'profile-rev-1',
              runtime_profile_digest: `sha256:${'a'.repeat(64)}`,
              runtime_target_kind: 'run_execution',
              source_access_mode: 'path_policy_scoped',
              environment: 'test',
              worker_id: 'worker-1',
              docker_image_digest: `sha256:${'b'.repeat(64)}`,
              container_id_digest: `sha256:${'c'.repeat(64)}`,
              app_server_effective_config_digest: `sha256:${'d'.repeat(64)}`,
              docker_policy_self_check_digest: `sha256:${'e'.repeat(64)}`,
              app_server_attempted: true,
              selected_execution_mode: 'app_server',
            },
            close: async (status, summary) => {
              closed.push({ status, summary });
            },
          }),
        },
        innerDriverFactory: () => innerDriver,
      } as any,
      {
        runSession,
        runtimeMetadata: startInput.runtimeMetadata,
        workerLease: {
          workerId: 'run-worker-1',
          runSessionId: 'run-session-1',
          leaseToken: 'run-worker-lease-token',
        },
      },
    );

    const emitted: CodexDriverStreamItem[] = [];
    for await (const item of driver.startRun(startInput)) {
      emitted.push(item);
    }
    await driver.close?.();

    expect(emitted).toEqual([{ kind: 'terminal', status: 'succeeded', summary: 'done' }]);
    expect(innerInputs).toHaveLength(1);
    expect(innerInputs[0]?.workspacePath).toBe('/workspace');
    expect(closed).toEqual([{ status: 'succeeded', summary: 'done' }]);
  });
});
