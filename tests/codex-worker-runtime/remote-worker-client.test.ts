import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  type CodexGenerationWorkloadV1,
  type CodexLaunchMaterialization,
  type CodexRuntimeJob,
} from '@forgeloop/domain';
import type { CodexAppServerTransport, CodexGenerationRuntime, GeneratedSpecDraftV1 } from '@forgeloop/codex-runtime';

import { createRemoteCodexWorkerClient } from '../../packages/codex-worker-runtime/src/remote-worker-client';
import { sealCodexLaunchTokenEnvelope, type SealedEnvelope } from '../../packages/codex-worker-runtime/src/envelope-crypto';

const digest = (char: string) => `sha256:${char.repeat(64)}`;

const generatedSpec = (patch: Partial<GeneratedSpecDraftV1> = {}): GeneratedSpecDraftV1 => ({
  schema_version: 'spec_draft.v1',
  summary: 'Public spec summary',
  content: 'Public spec content',
  background: 'Public background',
  goals: ['Ship remote worker generation'],
  scope_in: ['remote worker loop'],
  scope_out: ['run execution'],
  acceptance_criteria: ['terminal result is public safe'],
  risk_notes: ['none'],
  test_strategy_summary: 'unit tests',
  ...patch,
});

const generationWorkload = (): CodexGenerationWorkloadV1 => ({
  schema_version: 'codex_generation_workload.v1',
  runtime_job_id: 'runtime-job-1',
  action_run_id: 'action-run-1',
  task_kind: 'spec_draft',
  prompt_version: 'generation-prompt-v1',
  output_schema_version: 'spec_draft.v1',
  signed_context_ref: 'artifact://codex-runtime-jobs/runtime-job-1/workload/context',
  signed_context_digest: digest('1'),
  prompt_template_digest: digest('2'),
  created_at: '2026-05-23T00:00:00.000Z',
  expires_at: '2026-05-23T00:10:00.000Z',
});

const runtimeJob = (): CodexRuntimeJob => ({
  id: 'runtime-job-1',
  job_request_id: 'job-request-1',
  target_type: 'automation_action_run',
  target_id: 'action-run-1',
  target_kind: 'generation',
  project_id: 'project-1',
  repo_id: 'repo-1',
  worker_id: 'worker-1',
  launch_lease_id: 'lease-1',
  launch_attempt: 1,
  status: 'queued',
  input_digest: codexCanonicalDigest(generationWorkload()),
  input_json: generationWorkload(),
  expires_at: '2026-05-23T00:10:00.000Z',
  created_at: '2026-05-23T00:00:00.000Z',
  updated_at: '2026-05-23T00:00:00.000Z',
});

const materialization = (): CodexLaunchMaterialization => ({
  launch_target: {
    target_type: 'automation_action_run',
    target_id: 'action-run-1',
    target_kind: 'generation',
    project_id: 'project-1',
    repo_id: 'repo-1',
  },
  lease_id: 'lease-1',
  expires_at: '2026-05-23T00:10:00.000Z',
  materialized_at: '2026-05-23T00:00:01.000Z',
  resolved_credentials: [
    {
      binding_id: 'cred-1',
      binding_version_id: 'cred-v1',
      payload: { OPENAI_API_KEY: 'sk-test' },
      payload_digest: digest('3'),
    },
  ],
  profile_revision: {
    id: 'profile-rev-1',
    profile_id: 'profile-1',
    revision_number: 1,
    status: 'active',
    environment: 'test',
    docker_image: 'ghcr.io/forgeloop/codex',
    docker_image_digest: digest('4'),
    target_kind: 'generation',
    source_access_mode: 'artifact_only',
    codex_config_toml: 'approval_policy = "never"',
    codex_config_digest: digest('5'),
    expected_effective_config_digest: digest('6'),
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
      artifact_bytes: 10_000,
      timeout_ms: 60_000,
      output_limit_bytes: 100_000,
      run_output_limit_bytes: 100_000,
    },
    docker_policy: {
      app_server_only: true,
      rootless: true,
      read_only_rootfs: true,
      no_new_privileges: true,
      drop_capabilities: ['ALL'],
    },
    allowed_scopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
    profile_digest: digest('7'),
    created_by_actor_id: 'actor-1',
    created_at: '2026-05-23T00:00:00.000Z',
  },
});

const appServerTransport = (payload: unknown): CodexAppServerTransport => ({
  initialize: async () => undefined,
  request: async (method) => {
    if (method === 'thread/start') {
      return {
        thread_id: 'thread-1',
        config: { approval_policy: 'never', sandbox: 'read-only', writable_roots: [] },
      };
    }
    if (method === 'turn/start') {
      return {
        turn_id: 'turn-1',
        config: { approval_policy: 'never', sandbox_policy: 'read-only', writable_roots: [] },
      };
    }
    return {};
  },
  notifications: async function* () {
    yield { method: 'item/agentMessage/delta', params: { delta: JSON.stringify(payload) } };
    yield { method: 'turn/completed', params: { turn: { status: 'completed' } } };
  },
  close: async () => undefined,
});

describe('remote codex worker client', () => {
  it('registers, scavenges, runs one assigned generation job through app-server, uploads artifacts, and terminalizes', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-'));
    const calls: string[] = [];
    let sealedEnvelope: SealedEnvelope | undefined;
    const uploadedArtifacts: Record<string, unknown>[] = [];
    const terminalized: Record<string, unknown>[] = [];
    const sessionClose = vi.fn(async () => undefined);
    const controlPlaneClient = {
      registerWorker: async (input: Record<string, unknown>) => {
        calls.push('register');
        expect(input.session_public_key_algorithm).toBe('x25519');
        expect(typeof input.session_public_key_material).toBe('string');
        expect(String(input.session_public_key_material).length).toBeGreaterThan(10);
        sealedEnvelope = await sealCodexLaunchTokenEnvelope({
          plaintext_launch_token: 'launch-token-secret',
          runtime_job_id: 'runtime-job-1',
          launch_lease_id: 'lease-1',
          envelope_id: 'envelope-1',
          worker_id: 'worker-1',
          worker_public_key_material: String(input.session_public_key_material),
          key_id: String(input.session_public_key_id),
          expires_at: '2026-05-23T00:10:00.000Z',
        });
        return {
          worker: { session_epoch: 1 },
          session_token: 'session-1',
          session_expires_at: '2026-05-23T00:10:00.000Z',
        };
      },
      heartbeatWorker: async () => {
        calls.push('heartbeat');
        return {};
      },
      pollRuntimeJobs: async () => {
        calls.push('poll');
        return {
          runtime_jobs: [
            {
              runtime_job: runtimeJob(),
              envelope: { id: 'envelope-1' },
            },
          ],
        };
      },
      acceptRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
        calls.push('accept');
        expect(input.accepted_worker_session_digest).toBe(codexCredentialPayloadDigest('session-1'));
        return { runtime_job: { ...runtimeJob(), status: 'accepted' } };
      },
      getRuntimeJobControl: async () => {
        calls.push('control');
        return { control: { cancel_requested: false, drain_requested: false } };
      },
      claimLaunchTokenEnvelope: async () => {
        calls.push('claim');
        expect(sealedEnvelope).toBeDefined();
        return { envelope: sealedEnvelope };
      },
      fetchRuntimeJobWorkload: async () => {
        calls.push('workload');
        return { workload: generationWorkload() };
      },
      materializeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
        calls.push('materialize');
        expect(input.launch_token).toBe('launch-token-secret');
        return materialization();
      },
      startRuntimeJob: async () => {
        calls.push('start');
        return { runtime_job: { ...runtimeJob(), status: 'running' } };
      },
      appendRuntimeJobEvent: async () => {
        calls.push('event');
        return {};
      },
      uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
        calls.push(`artifact:${input.kind}`);
        uploadedArtifacts.push(input);
        return {
          artifact: {
            kind: input.kind,
            name: input.name,
            content_type: input.content_type,
            digest: input.digest,
            internal_ref: `artifact://codex-runtime-jobs/runtime-job-1/artifacts/${String(input.kind)}`,
          },
        };
      },
      terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
        calls.push('terminal');
        terminalized.push(input);
        return {};
      },
    };
    const launcher = {
      startFromMaterialization: vi.fn(async () => ({
        endpoint: 'docker-exec:' + digest('8'),
        createTransport: () => appServerTransport(generatedSpec()),
        containerWorkspacePath: '/workspace' as const,
        publicEvidence: {
          runtime_profile_id: 'profile-1',
          runtime_profile_revision_id: 'profile-rev-1',
          runtime_profile_digest: digest('7'),
          runtime_target_kind: 'generation' as const,
          source_access_mode: 'artifact_only' as const,
          environment: 'test' as const,
          launch_lease_id: 'lease-1',
          worker_id: 'worker-1',
          docker_image_digest: digest('4'),
          container_id_digest: digest('9'),
          app_server_effective_config_digest: digest('6'),
          docker_policy_self_check_digest: digest('a'),
          app_server_attempted: true as const,
          selected_execution_mode: 'app_server' as const,
        },
        close: sessionClose,
      })),
    };

    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot,
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient,
      launcher,
      scavenger: async () => {
        calls.push('scavenge');
      },
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => `nonce-${calls.length}`,
    });

    const result = await worker.runOnce();

    expect(result).toEqual({ processed: 1 });
    expect(calls.slice(0, 4)).toEqual(['register', 'scavenge', 'heartbeat', 'poll']);
    expect(calls).toContain('accept');
    expect(calls).toContain('claim');
    expect(calls).toContain('workload');
    expect(calls).toContain('materialize');
    expect(calls).toContain('start');
    expect(calls).toContain('terminal');
    expect(launcher.startFromMaterialization).toHaveBeenCalledWith(
      materialization(),
      expect.objectContaining({ workerSessionToken: 'session-1', terminalizeLaunchLeaseOnClose: false }),
    );
    expect(sessionClose).toHaveBeenCalledWith('succeeded', 'generation complete');
    expect(uploadedArtifacts.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(['generated_payload', 'generation_validation_report']),
    );
    expect(terminalized[0]).toMatchObject({
      launch_lease_id: 'lease-1',
      terminal_status: 'succeeded',
      terminal_result_json: {
        task_kind: 'spec_draft',
        generated_payload: generatedSpec(),
        generated_payload_digest: codexCanonicalDigest(generatedSpec()),
        generation_artifacts: expect.arrayContaining([
          expect.objectContaining({
            kind: 'generated_payload',
            internal_ref: 'artifact://codex-runtime-jobs/runtime-job-1/artifacts/generated_payload',
          }),
        ]),
      },
    });
    expect(JSON.stringify(terminalized[0])).not.toContain('launch-token-secret');
    await expect(stat(workerTempRoot)).resolves.toBeDefined();
  });

  it('terminalizes an accepted job as cancelled when control is cancelled before start', async () => {
    const terminalized: Record<string, unknown>[] = [];
    const launcher = {
      startFromMaterialization: vi.fn(),
    };
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async () => ({ worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' }),
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: true, drain_requested: true } }),
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher,
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-1',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(launcher.startFromMaterialization).not.toHaveBeenCalled();
    expect(terminalized).toHaveLength(1);
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'cancelled',
      reason_code: 'codex_runtime_job_cancelled',
    });
  });

  it('terminalizes startup failures with public-safe evidence', async () => {
    const terminalized: Record<string, unknown>[] = [];
    let sealedEnvelope: SealedEnvelope | undefined;
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => ({ workload: generationWorkload() }),
        materializeRuntimeJob: async () => materialization(),
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => {
          throw new Error('codex_app_server_unavailable: socket missing /tmp/private.sock');
        }),
      },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-1',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized).toHaveLength(1);
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_app_server_unavailable',
    });
    expect(JSON.stringify(terminalized[0])).not.toContain('/tmp/private.sock');
    expect(JSON.stringify(terminalized[0])).not.toContain('launch-token-secret');
  });

  it('supports an injected worker loop sleep and shutdown predicate', async () => {
    const calls: string[] = [];
    const sleeps: number[] = [];
    let shouldContinueChecks = 0;
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async () => {
          calls.push('register');
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => {
          calls.push('heartbeat');
          return {};
        },
        pollRuntimeJobs: async () => {
          calls.push('poll');
          return { runtime_jobs: [] };
        },
        acceptRuntimeJob: async () => ({}),
        getRuntimeJobControl: async () => ({ control: {} }),
        terminalizeRuntimeJob: async () => ({}),
      },
      launcher: {
        startFromMaterialization: vi.fn(),
      },
      scavenger: async () => {
        calls.push('scavenge');
      },
      sleep: async (durationMs) => {
        sleeps.push(durationMs);
      },
      pollIntervalMs: 25,
      shouldContinue: () => {
        shouldContinueChecks += 1;
        return shouldContinueChecks < 4;
      },
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-loop',
    });

    await expect(worker.runLoop()).resolves.toEqual({ iterations: 2, processed: 0 });

    expect(calls).toEqual(['register', 'scavenge', 'heartbeat', 'poll', 'poll']);
    expect(sleeps).toEqual([25]);
  });

  it('uses poll heartbeat intervals to keep idle worker registration fresh', async () => {
    const calls: string[] = [];
    let nowValue = '2026-05-23T00:00:00.000Z';
    let shouldContinueChecks = 0;
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async () => {
          calls.push('register');
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => {
          calls.push('heartbeat');
          return {};
        },
        pollRuntimeJobs: async () => {
          calls.push('poll');
          return { runtime_jobs: [], heartbeat_interval_ms: 25 };
        },
        acceptRuntimeJob: async () => ({}),
        getRuntimeJobControl: async () => ({ control: {} }),
        terminalizeRuntimeJob: async () => ({}),
      },
      launcher: {
        startFromMaterialization: vi.fn(),
      },
      scavenger: async () => {
        calls.push('scavenge');
      },
      sleep: async () => {
        nowValue = '2026-05-23T00:00:00.030Z';
      },
      pollIntervalMs: 30,
      shouldContinue: () => {
        shouldContinueChecks += 1;
        return shouldContinueChecks < 4;
      },
      now: () => nowValue,
      nonceFactory: () => `nonce-${calls.length}`,
    });

    await expect(worker.runLoop()).resolves.toEqual({ iterations: 2, processed: 0 });

    expect(calls).toEqual(['register', 'scavenge', 'heartbeat', 'poll', 'heartbeat', 'poll']);
  });

  it('refreshes an expired registered session before the next poll', async () => {
    const calls: string[] = [];
    const pollTokens: unknown[] = [];
    let nowValue = '2026-05-23T00:00:00.000Z';
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async () => {
          calls.push('register');
          return {
            worker: { session_epoch: 1 },
            session_token: 'session-1',
            session_expires_at: '2026-05-23T00:00:01.000Z',
          };
        },
        refreshWorkerSession: async (_workerId: string, input: Record<string, unknown>) => {
          calls.push('refresh');
          expect(input.workerSessionToken).toBe('session-1');
          expect(input.next_session_public_key_algorithm).toBe('x25519');
          return {
            worker: { session_epoch: 2 },
            session_token: 'session-2',
            session_expires_at: '2026-05-23T00:10:00.000Z',
          };
        },
        heartbeatWorker: async () => {
          calls.push('heartbeat');
          return {};
        },
        pollRuntimeJobs: async (_workerId: string, input: Record<string, unknown>) => {
          calls.push('poll');
          pollTokens.push(input.workerSessionToken);
          return { runtime_jobs: [] };
        },
        acceptRuntimeJob: async () => ({}),
        getRuntimeJobControl: async () => ({ control: {} }),
        terminalizeRuntimeJob: async () => ({}),
      },
      launcher: {
        startFromMaterialization: vi.fn(),
      },
      scavenger: async () => {
        calls.push('scavenge');
      },
      now: () => nowValue,
      nonceFactory: () => 'nonce-refresh',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 0 });
    nowValue = '2026-05-23T00:00:02.000Z';
    await expect(worker.runOnce()).resolves.toEqual({ processed: 0 });

    expect(calls).toEqual(['register', 'scavenge', 'heartbeat', 'poll', 'refresh', 'heartbeat', 'poll']);
    expect(pollTokens).toEqual(['session-1', 'session-2']);
  });

  it('polls control while generation is running and terminalizes cancellation', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const closed: Array<[string, string]> = [];
    let receivedSignal: AbortSignal | undefined;
    let controlCalls = 0;
    const eventTypes: unknown[] = [];
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => {
          controlCalls += 1;
          return { control: { cancel_requested: controlCalls >= 5, drain_requested: controlCalls >= 5 } };
        },
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => ({ workload: generationWorkload() }),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'running' } }),
        appendRuntimeJobEvent: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          eventTypes.push(input.event_type);
          return {};
        },
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => ({
          endpoint: 'docker-exec:' + digest('8'),
          createTransport: () => appServerTransport(generatedSpec()),
          containerWorkspacePath: '/workspace' as const,
          publicEvidence: {
            runtime_profile_id: 'profile-1',
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: digest('7'),
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: 'lease-1',
            worker_id: 'worker-1',
            docker_image_digest: digest('4'),
            container_id_digest: digest('9'),
            app_server_effective_config_digest: digest('6'),
            docker_policy_self_check_digest: digest('a'),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async (status, summary) => {
            closed.push([status, summary]);
          },
        })),
      },
      generationRuntimeFactory: () =>
        ({
          generateSpecDraft: async (input) => {
            receivedSignal = input.signal;
            return new Promise((resolve, reject) => {
              input.signal?.addEventListener('abort', () => reject(new Error('codex_generation_cancelled')), { once: true });
            });
          },
          generatePlanDraft: async () => {
            throw new Error('unexpected');
          },
          generatePackageDrafts: async () => {
            throw new Error('unexpected');
          },
        }) satisfies CodexGenerationRuntime,
      scavenger: async () => undefined,
      sleep: async () => undefined,
      controlPollIntervalMs: 1,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-control',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(receivedSignal?.aborted).toBe(true);
    expect(eventTypes).toContain('runtime_job_worker_heartbeat');
    expect(terminalized).toHaveLength(1);
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'cancelled',
      reason_code: 'codex_runtime_job_cancelled',
    });
    expect(closed).toEqual([['failed', 'codex_runtime_job_cancelled']]);
  });

  it('aborts generation when control polling fails while running', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    let receivedSignal: AbortSignal | undefined;
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => ({ workload: generationWorkload() }),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'running' } }),
        appendRuntimeJobEvent: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          if (input.event_type === 'runtime_job_worker_heartbeat') {
            throw new Error('codex_runtime_job_unavailable');
          }
          return {};
        },
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => ({
          endpoint: 'docker-exec:' + digest('8'),
          createTransport: () => appServerTransport(generatedSpec()),
          containerWorkspacePath: '/workspace' as const,
          publicEvidence: {
            runtime_profile_id: 'profile-1',
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: digest('7'),
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: 'lease-1',
            worker_id: 'worker-1',
            docker_image_digest: digest('4'),
            container_id_digest: digest('9'),
            app_server_effective_config_digest: digest('6'),
            docker_policy_self_check_digest: digest('a'),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async () => undefined,
        })),
      },
      generationRuntimeFactory: () =>
        ({
          generateSpecDraft: async (input) => {
            receivedSignal = input.signal;
            return new Promise((resolve, reject) => {
              input.signal?.addEventListener('abort', () => reject(new Error('codex_generation_cancelled')), { once: true });
            });
          },
          generatePlanDraft: async () => {
            throw new Error('unexpected');
          },
          generatePackageDrafts: async () => {
            throw new Error('unexpected');
          },
        }) satisfies CodexGenerationRuntime,
      scavenger: async () => undefined,
      sleep: async () => undefined,
      controlPollIntervalMs: 1,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-control-error',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(receivedSignal?.aborted).toBe(true);
    expect(terminalized).toHaveLength(1);
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_runtime_job_unavailable',
    });
  });

  it('maps materialization failures to cancellation when control was cancelled during startup', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    let controlCalls = 0;
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => {
          controlCalls += 1;
          return { control: { cancel_requested: controlCalls >= 3, drain_requested: controlCalls >= 3 } };
        },
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => ({ workload: generationWorkload() }),
        materializeRuntimeJob: async () => {
          throw new Error('codex_runtime_job_unavailable');
        },
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(),
      },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-startup-cancel',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized).toHaveLength(1);
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'cancelled',
      reason_code: 'codex_runtime_job_cancelled',
    });
  });

  it('does not overwrite successful generation with failed terminalization when success terminal response is lost', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => ({ workload: generationWorkload() }),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'running' } }),
        uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => ({
          artifact: {
            kind: input.kind,
            name: input.name,
            content_type: input.content_type,
            digest: input.digest,
            internal_ref: `artifact://codex-runtime-jobs/runtime-job-1/artifacts/${String(input.kind)}`,
          },
        }),
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          throw new Error('codex_control_plane_request_failed:502');
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => ({
          endpoint: 'docker-exec:' + digest('8'),
          createTransport: () => appServerTransport(generatedSpec()),
          containerWorkspacePath: '/workspace' as const,
          publicEvidence: {
            runtime_profile_id: 'profile-1',
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: digest('7'),
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: 'lease-1',
            worker_id: 'worker-1',
            docker_image_digest: digest('4'),
            container_id_digest: digest('9'),
            app_server_effective_config_digest: digest('6'),
            docker_policy_self_check_digest: digest('a'),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async () => undefined,
        })),
      },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-terminal-lost',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized).toHaveLength(2);
    expect(terminalized.every((entry) => entry.terminal_status === 'succeeded')).toBe(true);
  });

  it('terminalizes cancelled when cancellation races with success terminalization', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: terminalized.length > 0, drain_requested: terminalized.length > 0 } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => ({ workload: generationWorkload() }),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'running' } }),
        uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => ({
          artifact: {
            kind: input.kind,
            name: input.name,
            content_type: input.content_type,
            digest: input.digest,
            internal_ref: `artifact://codex-runtime-jobs/runtime-job-1/artifacts/${String(input.kind)}`,
          },
        }),
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          if (input.terminal_status === 'succeeded') {
            throw new Error('codex_runtime_job_unavailable');
          }
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => ({
          endpoint: 'docker-exec:' + digest('8'),
          createTransport: () => appServerTransport(generatedSpec()),
          containerWorkspacePath: '/workspace' as const,
          publicEvidence: {
            runtime_profile_id: 'profile-1',
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: digest('7'),
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: 'lease-1',
            worker_id: 'worker-1',
            docker_image_digest: digest('4'),
            container_id_digest: digest('9'),
            app_server_effective_config_digest: digest('6'),
            docker_policy_self_check_digest: digest('a'),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async () => undefined,
        })),
      },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => `nonce-terminal-cancel-${terminalized.length}`,
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized.map((entry) => entry.terminal_status)).toEqual(['succeeded', 'succeeded', 'cancelled']);
  });

  it('terminalizes cancelled when success terminal transport responses are unconfirmed and control is cancelled', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: terminalized.length > 0, drain_requested: terminalized.length > 0 } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => ({ workload: generationWorkload() }),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'running' } }),
        uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => ({
          artifact: {
            kind: input.kind,
            name: input.name,
            content_type: input.content_type,
            digest: input.digest,
            internal_ref: `artifact://codex-runtime-jobs/runtime-job-1/artifacts/${String(input.kind)}`,
          },
        }),
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          if (input.terminal_status === 'succeeded') {
            throw new Error('codex_control_plane_request_failed:502');
          }
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => ({
          endpoint: 'docker-exec:' + digest('8'),
          createTransport: () => appServerTransport(generatedSpec()),
          containerWorkspacePath: '/workspace' as const,
          publicEvidence: {
            runtime_profile_id: 'profile-1',
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: digest('7'),
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: 'lease-1',
            worker_id: 'worker-1',
            docker_image_digest: digest('4'),
            container_id_digest: digest('9'),
            app_server_effective_config_digest: digest('6'),
            docker_policy_self_check_digest: digest('a'),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async () => undefined,
        })),
      },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => `nonce-terminal-transport-cancel-${terminalized.length}`,
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized.map((entry) => entry.terminal_status)).toEqual(['succeeded', 'succeeded', 'cancelled']);
  });

  it('uses a generated payload artifact ref for oversized generation results', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => ({ workload: generationWorkload() }),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'running' } }),
        uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => ({
          artifact: {
            kind: input.kind,
            name: input.name,
            content_type: input.content_type,
            digest: input.digest,
            internal_ref: `artifact://codex-runtime-jobs/runtime-job-1/artifacts/${String(input.kind)}`,
          },
        }),
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => ({
          endpoint: 'docker-exec:' + digest('8'),
          createTransport: () => appServerTransport(generatedSpec({ content: 'x'.repeat(70_000) })),
          containerWorkspacePath: '/workspace' as const,
          publicEvidence: {
            runtime_profile_id: 'profile-1',
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: digest('7'),
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: 'lease-1',
            worker_id: 'worker-1',
            docker_image_digest: digest('4'),
            container_id_digest: digest('9'),
            app_server_effective_config_digest: digest('6'),
            docker_policy_self_check_digest: digest('a'),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async () => undefined,
        })),
      },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-oversized',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized[0]?.terminal_result_json).toMatchObject({
      generated_payload: {
        schema_version: 'generated_payload_ref.v1',
        artifact: {
          kind: 'generated_payload',
          internal_ref: 'artifact://codex-runtime-jobs/runtime-job-1/artifacts/generated_payload',
        },
      },
    });
    expect(JSON.stringify(terminalized[0]?.terminal_result_json)).not.toContain('x'.repeat(100));
  });

  it('fails oversized generation when generated payload artifact ref is unavailable', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => ({ workload: generationWorkload() }),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'running' } }),
        uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => ({
          artifact: {
            kind: input.kind,
            name: input.name,
            content_type: input.content_type,
            digest: input.digest,
          },
        }),
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => ({
          endpoint: 'docker-exec:' + digest('8'),
          createTransport: () => appServerTransport(generatedSpec({ content: 'x'.repeat(70_000) })),
          containerWorkspacePath: '/workspace' as const,
          publicEvidence: {
            runtime_profile_id: 'profile-1',
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: digest('7'),
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: 'lease-1',
            worker_id: 'worker-1',
            docker_image_digest: digest('4'),
            container_id_digest: digest('9'),
            app_server_effective_config_digest: digest('6'),
            docker_policy_self_check_digest: digest('a'),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async () => undefined,
        })),
      },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-oversized-no-ref',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized).toHaveLength(1);
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_runtime_job_unavailable',
    });
    expect(JSON.stringify(terminalized[0])).not.toContain('x'.repeat(100));
  });

  it('uploads cleanup failure evidence before terminal success and keeps success when cleanup fails', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const uploadedArtifacts: Record<string, unknown>[] = [];
    const operations: string[] = [];
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => ({ workload: generationWorkload() }),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'running' } }),
        uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          uploadedArtifacts.push(input);
          operations.push(`artifact:${String(input.kind)}`);
          return {
            artifact: {
              kind: input.kind,
              name: input.name,
              content_type: input.content_type,
              digest: input.digest,
              internal_ref: `artifact://codex-runtime-jobs/runtime-job-1/artifacts/${String(input.kind)}`,
            },
          };
        },
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          operations.push(`terminal:${String(input.terminal_status)}`);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => ({
          endpoint: 'docker-exec:' + digest('8'),
          createTransport: () => appServerTransport(generatedSpec()),
          containerWorkspacePath: '/workspace' as const,
          publicEvidence: {
            runtime_profile_id: 'profile-1',
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: digest('7'),
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: 'lease-1',
            worker_id: 'worker-1',
            docker_image_digest: digest('4'),
            container_id_digest: digest('9'),
            app_server_effective_config_digest: digest('6'),
            docker_policy_self_check_digest: digest('a'),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async () => {
            operations.push('cleanup');
            throw new Error('cleanup failed /tmp/private');
          },
        })),
      },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-cleanup',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized).toHaveLength(1);
    expect(terminalized[0]).toMatchObject({ terminal_status: 'succeeded' });
    expect(uploadedArtifacts.map((entry) => entry.kind)).toContain('cleanup_failure_evidence');
    expect(operations.indexOf('artifact:cleanup_failure_evidence')).toBeLessThan(operations.indexOf('terminal:succeeded'));
    expect(JSON.stringify(uploadedArtifacts)).not.toContain('/tmp/private');
  });
});
