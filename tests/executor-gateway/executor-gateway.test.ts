import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ExecutorResult, RunSpec } from '@forgeloop/contracts';
import { executorResultSchema } from '@forgeloop/contracts';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/executor-gateway/src/app.module';
import {
  EXECUTOR_ADAPTERS,
  type ExecutorAdapter,
  type ExecutorAdapterRegistry,
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
  const calls: RunSpec[] = [];
  const adapter: ExecutorAdapter = async (runSpec) => {
    calls.push(runSpec);
    return resultFor(runSpec, `${name} adapter completed`);
  };

  return { adapter, calls };
};

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

  it('falls back to run_session_id for idempotency when the same run is posted with a different key', async () => {
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

    const first = await request(app.getHttpServer()).post('/internal/executions').send(firstRunSpec).expect(201);
    const replay = await request(app.getHttpServer()).post('/internal/executions').send(replayRunSpec).expect(201);

    expect(replay.body).toMatchObject({
      execution_id: 'first-key',
      run_session_id: 'run-session-idem',
      idempotent_replay: true,
    });
    expect(replay.body.result).toEqual(first.body.result);
    expect(mock.calls).toHaveLength(1);
  });

  it('selects the local_codex adapter from RunSpec.executor_type without invoking real Codex', async () => {
    const runSpec = createRunSpec({
      executor_type: 'local_codex',
      run_session_id: 'run-local-codex',
      idempotency_key: 'idem-local-codex',
    });

    const response = await request(app.getHttpServer()).post('/internal/executions').send(runSpec).expect(201);

    expect(response.body.status).toBe('succeeded');
    expect(response.body.result.executor_type).toBe('local_codex');
    expect(localCodex.calls).toHaveLength(1);
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
