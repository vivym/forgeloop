import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ExecutorResult, RunSpec } from '@forgeloop/contracts';
import { executorResultSchema } from '@forgeloop/contracts';
import { resourceLimitDigest, type RuntimeSafetyAttestation } from '../../packages/domain/src';
import { sandboxWrapperEnvironmentDigest } from '../../packages/executor/src';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/executor-gateway/src/app.module';
import {
  EXECUTOR_ADAPTERS,
  createDefaultExecutorAdapters,
  type ExecutorAdapter,
  type ExecutorAdapterRegistry,
  type ExecutorExecutionRequest,
} from '../../apps/executor-gateway/src/executor.service';
import { createRunSpec } from '../executor/test-fixtures';

const resultFor = (runSpec: RunSpec, summary = `fake ${runSpec.executor_type} completed`): ExecutorResult => ({
  run_session_id: runSpec.run_session_id,
  executor_type: runSpec.executor_type,
  executor_version: 'test-adapter',
  status: 'succeeded',
  started_at: '2026-05-05T00:00:00.000Z',
  finished_at: '2026-05-05T00:00:01.000Z',
  summary,
  changed_files: [
    {
      repo_id: runSpec.repo.repo_id,
      path: 'apps/executor-gateway/src/executor.service.ts',
      change_kind: 'modified',
    },
  ],
  checks: runSpec.required_checks.map((check) => ({
    check_id: check.check_id,
    command: check.command,
    status: 'succeeded',
    exit_code: 0,
    duration_seconds: 0.01,
    blocks_review: check.blocks_review,
  })),
  artifacts: [
    {
      kind: 'execution_summary',
      name: 'summary.md',
      content_type: 'text/markdown',
      local_ref: `fake://${runSpec.run_session_id}/summary.md`,
    },
  ],
  raw_metadata: {},
});

const createCountingAdapter = (name: 'mock' | 'local_codex') => {
  const calls: Parameters<ExecutorAdapter>[0][] = [];
  let implementation: ExecutorAdapter = async ({ runSpec }) => resultFor(runSpec, `${name} adapter completed`);
  const adapter: ExecutorAdapter = async (input) => {
    calls.push(input);
    return implementation(input);
  };

  return {
    adapter,
    calls,
    useImplementation: (next: ExecutorAdapter) => {
      implementation = next;
    },
  };
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

const digest = (char: string) => `sha256:${char.repeat(64)}`;

const attestedResourceLimits = {
  cpu_ms: 10_000,
  memory_mb: 512,
  pids: 64,
  fds: 256,
  workspace_bytes: 1_000_000,
  artifact_bytes: 500_000,
  timeout_ms: 30_000,
  output_limit_bytes: 100_000,
  run_output_limit_bytes: 200_000,
};

const runtimeSafetyRouting = (
  overrides: Partial<NonNullable<ExecutorExecutionRequest['runtime_safety_routing']>> = {},
): NonNullable<ExecutorExecutionRequest['runtime_safety_routing']> => ({
  workspace_root: '/tmp/forgeloop/workspaces/run-local-codex',
  artifact_root: '/tmp/forgeloop/artifacts/run-local-codex',
  sandbox_output_root: '/tmp/forgeloop/sandbox/run-local-codex',
  runtime_environment: 'test',
  network_mode: 'disabled',
  policy_digest: digest('a'),
  env_policy_digest: digest('b'),
  command_policy_digest: digest('c'),
  mount_policy_digest: digest('d'),
  network_policy_digest: digest('e'),
  resource_limit_digest: resourceLimitDigest(attestedResourceLimits),
  governor_id: 'governor-1',
  sandbox_id: 'sandbox-1',
  sandbox_version: '1.0.0',
  sandbox_binary_digest: digest('1'),
  sandbox_config_digest: digest('2'),
  sandbox_wrapper_environment_digest: digest('3'),
  package_policy_snapshot: {
    policy_snapshot_version: 1,
    policy_digest: digest('a'),
  } as NonNullable<ExecutorExecutionRequest['runtime_safety_routing']>['package_policy_snapshot'],
  ...overrides,
});

const runExecutionAttestation = (
  runSpec: RunSpec,
  routing = runtimeSafetyRouting(),
  overrides: Partial<RuntimeSafetyAttestation> = {},
): RuntimeSafetyAttestation => {
  const now = Date.now();

  return {
    attestation_scope: 'run_execution',
    hard_limit_mode: 'enforcing',
    environment: routing.runtime_environment,
    executor_type: runSpec.executor_type,
    workflow_only: runSpec.workflow_only,
    governor_id: routing.governor_id,
    governor_provenance: 'external_sandbox',
    checked_at: new Date(now).toISOString(),
    max_command_timeout_ms: 60_000,
    max_hook_timeout_ms: 60_000,
    max_command_output_bytes: 1_000_000,
    max_run_output_bytes: 2_000_000,
    supports_cpu_limit: true,
    supports_memory_limit: true,
    supports_process_limit: true,
    supports_fd_limit: true,
    supports_workspace_disk_limit: true,
    supports_artifact_size_limit: true,
    supports_filesystem_containment: true,
    supports_host_secret_isolation: true,
    supports_network_policy: true,
    supports_wrapper_env_isolation: true,
    supports_process_tree_kill: true,
    network_mode: 'disabled',
    project_id: runSpec.project_id,
    repo_id: runSpec.repo.repo_id,
    execution_package_id: runSpec.execution_package_id,
    expected_package_version: runSpec.expected_package_version,
    run_id: runSpec.run_session_id,
    policy_digest: routing.policy_digest,
    policy_snapshot_version: routing.package_policy_snapshot.policy_snapshot_version,
    env_policy_digest: routing.env_policy_digest,
    command_policy_digest: routing.command_policy_digest,
    mount_policy_digest: routing.mount_policy_digest,
    network_policy_digest: routing.network_policy_digest,
    resource_limit_digest: routing.resource_limit_digest,
    resource_limits: attestedResourceLimits,
    sandbox_id: routing.sandbox_id,
    sandbox_version: routing.sandbox_version,
    sandbox_binary_digest: routing.sandbox_binary_digest,
    sandbox_config_digest: routing.sandbox_config_digest,
    sandbox_wrapper_environment_digest: routing.sandbox_wrapper_environment_digest,
    workspace_root: routing.workspace_root,
    artifact_root: routing.artifact_root,
    sandbox_output_root: routing.sandbox_output_root,
    expires_at: new Date(now + 5 * 60_000).toISOString(),
    ...overrides,
  };
};

describe('default executor adapters', () => {
  it('rejects local_codex when the accepted routing sandbox binding differs from runtime config', async () => {
    const envKeys = [
      'FORGELOOP_EXECUTOR_SANDBOX_EXECUTABLE',
      'FORGELOOP_EXECUTOR_SANDBOX_BINARY_DIGEST',
      'FORGELOOP_EXECUTOR_SANDBOX_CONFIG_DIGEST',
      'FORGELOOP_EXECUTOR_ARTIFACT_ROOT',
      'FORGELOOP_EXECUTOR_TRUSTED_TOOLCHAINS',
      'FORGELOOP_EXECUTOR_DEFAULT_CPU_MS',
      'FORGELOOP_EXECUTOR_DEFAULT_MEMORY_MB',
      'FORGELOOP_EXECUTOR_DEFAULT_PIDS',
      'FORGELOOP_EXECUTOR_DEFAULT_FDS',
      'FORGELOOP_EXECUTOR_DEFAULT_WORKSPACE_BYTES',
      'FORGELOOP_EXECUTOR_DEFAULT_ARTIFACT_BYTES',
    ] as const;
    const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
    const artifactRoot = join(process.cwd(), '.tmp-executor-gateway-runtime-safety');
    mkdirSync(artifactRoot, { recursive: true });

    try {
      process.env.FORGELOOP_EXECUTOR_SANDBOX_EXECUTABLE = '/bin/echo';
      process.env.FORGELOOP_EXECUTOR_SANDBOX_BINARY_DIGEST = digest('8');
      process.env.FORGELOOP_EXECUTOR_SANDBOX_CONFIG_DIGEST = digest('2');
      process.env.FORGELOOP_EXECUTOR_ARTIFACT_ROOT = artifactRoot;
      process.env.FORGELOOP_EXECUTOR_TRUSTED_TOOLCHAINS = JSON.stringify({
        system: {
          root_paths: ['/bin', '/usr/bin'],
          executable_names: ['codex', 'echo', 'git'],
          config_digest: digest('4'),
        },
      });
      process.env.FORGELOOP_EXECUTOR_DEFAULT_CPU_MS = '10000';
      process.env.FORGELOOP_EXECUTOR_DEFAULT_MEMORY_MB = '512';
      process.env.FORGELOOP_EXECUTOR_DEFAULT_PIDS = '64';
      process.env.FORGELOOP_EXECUTOR_DEFAULT_FDS = '256';
      process.env.FORGELOOP_EXECUTOR_DEFAULT_WORKSPACE_BYTES = '1000000';
      process.env.FORGELOOP_EXECUTOR_DEFAULT_ARTIFACT_BYTES = '500000';

      const adapters = createDefaultExecutorAdapters();
      const runSpec = createRunSpec({
        executor_type: 'local_codex',
        run_session_id: 'run-local-codex-runtime-config-mismatch',
        idempotency_key: 'idem-local-codex-runtime-config-mismatch',
      });
      const routing = runtimeSafetyRouting({
        artifact_root: join(artifactRoot, 'run-local-codex-runtime-config-mismatch'),
        sandbox_binary_digest: digest('9'),
        sandbox_config_digest: digest('2'),
        sandbox_wrapper_environment_digest: sandboxWrapperEnvironmentDigest(),
      });

      await expect(adapters.local_codex({ runSpec, runtimeSafetyRouting: routing })).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'runtime_safety_routing_mismatch',
          mismatched_field: 'sandbox_binary_digest',
        }),
      });
    } finally {
      for (const key of envKeys) {
        const previous = previousEnv.get(key);
        if (previous === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous;
        }
      }
      rmSync(artifactRoot, { recursive: true, force: true });
    }
  });
});

describe('executor gateway internal API', () => {
  let app: INestApplication;
  let mock: ReturnType<typeof createCountingAdapter>;
  let localCodex: ReturnType<typeof createCountingAdapter>;

  beforeEach(async () => {
    mock = createCountingAdapter('mock');
    localCodex = createCountingAdapter('local_codex');

    const adapters: ExecutorAdapterRegistry = {
      mock: mock.adapter,
      local_codex: localCodex.adapter,
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EXECUTOR_ADAPTERS)
      .useValue(adapters)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('runs a mock RunSpec, returns a valid ExecutorResult, and stores it for polling', async () => {
    const runSpec = createRunSpec({
      executor_type: 'mock',
      run_session_id: 'run-gateway-mock',
      idempotency_key: 'idem-gateway-mock',
    });

    const created = await request(app.getHttpServer()).post('/internal/executions').send(runSpec).expect(201);

    expect(created.body).toMatchObject({
      execution_id: 'idem-gateway-mock',
      idempotency_key: 'idem-gateway-mock',
      status: 'succeeded',
      idempotent_replay: false,
    });
    expect(executorResultSchema.parse(created.body.result).run_session_id).toBe('run-gateway-mock');

    const polled = await request(app.getHttpServer()).get('/internal/executions/idem-gateway-mock').expect(200);
    expect(polled.body).toEqual(created.body);
    expect(mock.calls).toHaveLength(1);
  });

  it('reuses an existing transient record for the same idempotency key without rerunning the adapter', async () => {
    const runSpec = createRunSpec({
      executor_type: 'mock',
      run_session_id: 'run-idem-key',
      idempotency_key: 'same-idempotency-key',
    });

    const first = await request(app.getHttpServer()).post('/internal/executions').send(runSpec).expect(201);
    const second = await request(app.getHttpServer()).post('/internal/executions').send(runSpec).expect(201);

    expect(first.body.idempotent_replay).toBe(false);
    expect(second.body).toMatchObject({
      execution_id: 'same-idempotency-key',
      idempotency_key: 'same-idempotency-key',
      idempotent_replay: true,
    });
    expect(second.body.result).toEqual(first.body.result);
    expect(mock.calls).toHaveLength(1);
  });

  it('serializes concurrent duplicate executions under the same idempotency key and run session', async () => {
    const runSpec = createRunSpec({
      executor_type: 'mock',
      run_session_id: 'run-concurrent-idem',
      idempotency_key: 'concurrent-idempotency-key',
    });
    const adapterResult = deferred<ExecutorResult>();
    const adapterStarted = deferred<void>();
    const duplicateAdapterStarted = deferred<void>();
    let adapterStartCount = 0;
    mock.useImplementation(async () => {
      adapterStartCount += 1;
      if (adapterStartCount === 1) {
        adapterStarted.resolve();
      } else {
        duplicateAdapterStarted.resolve();
      }
      return adapterResult.promise;
    });
    const sendExecution = () =>
      new Promise<request.Response>((resolve, reject) => {
        request(app.getHttpServer())
          .post('/internal/executions')
          .send(runSpec)
          .expect(201)
          .end((error, response) => (error == null ? resolve(response) : reject(error)));
      });

    const firstRequest = sendExecution();
    await adapterStarted.promise;
    const secondRequest = sendExecution();

    await Promise.race([duplicateAdapterStarted.promise, new Promise((resolve) => setTimeout(resolve, 50))]);
    const adapterCallsBeforeCompletion = mock.calls.length;
    adapterResult.resolve(resultFor(runSpec, 'serialized adapter completed'));

    const [first, second] = await Promise.all([firstRequest, secondRequest]);

    expect(adapterCallsBeforeCompletion).toBe(1);
    expect(mock.calls).toHaveLength(1);
    expect(first.body.idempotent_replay).toBe(false);
    expect(second.body).toMatchObject({
      execution_id: 'concurrent-idempotency-key',
      run_session_id: 'run-concurrent-idem',
      idempotent_replay: true,
    });
    expect(second.body.result).toEqual(first.body.result);
  });

  it('returns 409 when an idempotency key is reused for a different run session', async () => {
    const firstRunSpec = createRunSpec({
      executor_type: 'mock',
      run_session_id: 'run-idempotency-key-owner',
      idempotency_key: 'colliding-idempotency-key',
    });
    const collisionRunSpec = createRunSpec({
      executor_type: 'mock',
      run_session_id: 'run-idempotency-key-intruder',
      idempotency_key: 'colliding-idempotency-key',
    });

    await request(app.getHttpServer()).post('/internal/executions').send(firstRunSpec).expect(201);
    const collision = await request(app.getHttpServer()).post('/internal/executions').send(collisionRunSpec).expect(409);

    expect(collision.body.message).toContain('idempotency_key');
    expect(mock.calls).toHaveLength(1);
  });

  it('returns 409 when a run session is reused with an incompatible idempotency key', async () => {
    const firstRunSpec = createRunSpec({
      executor_type: 'mock',
      run_session_id: 'run-session-idem',
      idempotency_key: 'first-key',
    });
    const replayRunSpec = createRunSpec({
      executor_type: 'mock',
      run_session_id: 'run-session-idem',
      idempotency_key: 'second-key',
    });

    await request(app.getHttpServer()).post('/internal/executions').send(firstRunSpec).expect(201);
    const collision = await request(app.getHttpServer()).post('/internal/executions').send(replayRunSpec).expect(409);

    expect(collision.body.message).toContain('run_session_id');
    expect(mock.calls).toHaveLength(1);
  });

  it('rejects a bare local_codex RunSpec without run_execution runtime safety routing', async () => {
    const runSpec = createRunSpec({
      executor_type: 'local_codex',
      run_session_id: 'run-local-codex',
      idempotency_key: 'idem-local-codex',
    });

    const response = await request(app.getHttpServer()).post('/internal/executions').send(runSpec).expect(400);

    expect(response.body).toMatchObject({
      code: 'primary_executor_governor_unavailable',
    });
    expect(localCodex.calls).toHaveLength(0);
    expect(mock.calls).toHaveLength(0);
  });

  it('rejects enqueue preflight attestations for local_codex execution', async () => {
    const runSpec = createRunSpec({
      executor_type: 'local_codex',
      run_session_id: 'run-local-codex-enqueue-attestation',
      idempotency_key: 'idem-local-codex-enqueue-attestation',
    });
    const routing = runtimeSafetyRouting();

    const response = await request(app.getHttpServer())
      .post('/internal/executions')
      .send({
        run_spec: runSpec,
        runtime_safety_routing: routing,
        runtime_safety_attestation: runExecutionAttestation(runSpec, routing, { attestation_scope: 'enqueue_preflight' }),
      })
      .expect(400);

    expect(response.body.code).toBe('runtime_safety_attestation_scope_invalid');
    expect(localCodex.calls).toHaveLength(0);
  });

  it('rejects local_codex execution when attested roots do not match routing', async () => {
    const runSpec = createRunSpec({
      executor_type: 'local_codex',
      run_session_id: 'run-local-codex-root-mismatch',
      idempotency_key: 'idem-local-codex-root-mismatch',
    });
    const routing = runtimeSafetyRouting({ workspace_root: '/tmp/forgeloop/workspaces/expected' });

    const response = await request(app.getHttpServer())
      .post('/internal/executions')
      .send({
        run_spec: runSpec,
        runtime_safety_routing: routing,
        runtime_safety_attestation: runExecutionAttestation(runSpec, routing, {
          workspace_root: '/tmp/forgeloop/workspaces/actual',
        }),
      })
      .expect(400);

    expect(response.body.code).toBe('runtime_safety_attestation_mismatch');
    expect(localCodex.calls).toHaveLength(0);
  });

  it('runs local_codex only when a run_execution envelope matches runtime safety routing', async () => {
    const runSpec = createRunSpec({
      executor_type: 'local_codex',
      run_session_id: 'run-local-codex-envelope',
      idempotency_key: 'idem-local-codex-envelope',
    });
    const routing = runtimeSafetyRouting();

    const response = await request(app.getHttpServer())
      .post('/internal/executions')
      .send({
        run_spec: runSpec,
        runtime_safety_routing: routing,
        runtime_safety_attestation: runExecutionAttestation(runSpec, routing),
      })
      .expect(201);

    expect(response.body.status).toBe('succeeded');
    expect(response.body.result.executor_type).toBe('local_codex');
    expect(localCodex.calls).toEqual([
      expect.objectContaining({
        runSpec: expect.objectContaining({ run_session_id: 'run-local-codex-envelope' }),
        runtimeSafetyRouting: routing,
        runtimeSafetyAttestation: expect.objectContaining({ attestation_scope: 'run_execution' }),
      }),
    ]);
    expect(mock.calls).toHaveLength(0);
  });

  it('returns 400 for an invalid RunSpec and 404 for an unknown execution id', async () => {
    await request(app.getHttpServer())
      .post('/internal/executions')
      .send({ ...createRunSpec({ executor_type: 'mock' }), objective: '' })
      .expect(400);

    await request(app.getHttpServer()).get('/internal/executions/missing-execution').expect(404);
  });
});
