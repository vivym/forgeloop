import { setTimeout as delay } from 'node:timers/promises';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ExecutorResult, RunSpec } from '@forgeloop/contracts';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { actorClassHeaderName, actorHeaderName } from '../../apps/control-plane-api/src/modules/auth/actor-context';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import type { DeliveryRepository } from '../../packages/db/src';
import { FakeCodexSessionDriver, RunWorker } from '../../packages/run-worker/src';

const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const actorQa = 'actor-qa';
const ownerHeaders = { [actorHeaderName]: actorOwner, [actorClassHeaderName]: 'human_admin' };
const reviewerHeaders = { [actorHeaderName]: actorReviewer, [actorClassHeaderName]: 'human' };

const requiredChecks = [
  {
    check_id: 'unit',
    display_name: 'Unit tests',
    command: 'pnpm test tests/api/local-codex-routing.test.ts',
    timeout_seconds: 120,
    blocks_review: true,
  },
];

const resultFor = (runSpec: RunSpec, executorType: 'mock' | 'local_codex'): ExecutorResult => ({
  run_session_id: runSpec.run_session_id,
  executor_type: executorType,
  executor_version: `test-${executorType}`,
  status: 'succeeded',
  started_at: '2026-05-05T00:00:00.000Z',
  finished_at: '2026-05-05T00:00:01.000Z',
  summary: `${executorType} test adapter completed.`,
  changed_files: [
    {
      repo_id: runSpec.repo.repo_id,
      path: 'docs/superpowers/reports/local-codex-routing.md',
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
      kind: 'diff',
      name: 'local-codex-routing.patch',
      content_type: 'text/x-diff',
      local_ref: `/tmp/forgeloop-test/${runSpec.run_session_id}/diff.patch`,
    },
    {
      kind: 'execution_summary',
      name: 'local-codex-routing.md',
      content_type: 'text/markdown',
      local_ref: `/tmp/forgeloop-test/${runSpec.run_session_id}/summary.md`,
    },
  ],
  raw_metadata:
    executorType === 'local_codex'
      ? {
          workspace_path: `/tmp/forgeloop-test/${runSpec.run_session_id}/workspace`,
          base_ref: runSpec.repo.base_commit_sha,
        }
      : { workflow_only: runSpec.workflow_only },
});

const createApprovedPlanRevision = async (app: INestApplication) => {
  const server = app.getHttpServer();
  const project = (
    await request(server).post('/projects').send({ name: 'Local codex routing', owner_actor_id: actorOwner }).expect(201)
  ).body;
  await request(server)
    .post(`/projects/${project.id}/repos`)
    .send({
      repo_id: 'repo-1',
      name: 'forgeloop',
      local_path: '/workspace/forgeloop',
      default_branch: 'main',
      base_commit_sha: 'abc123',
    })
    .expect(201);
  const workItem = (
    await request(server)
      .post('/work-items')
      .send({
        project_id: project.id,
        kind: 'requirement',
        title: 'Route local_codex through adapter',
        goal: 'Use the real local_codex executor path for non-workflow runs.',
        success_criteria: ['local_codex run sessions retain workspace evidence.'],
        priority: 'P0',
        risk: 'high',
        owner_actor_id: actorOwner,
      })
      .expect(201)
  ).body;

  const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;
  await request(server).post(`/specs/${spec.id}/generate-draft`).send({}).expect(201);
  await request(server).post(`/specs/${spec.id}/submit-for-approval`).set(ownerHeaders).send({ actor_id: actorOwner }).expect(201);
  await request(server).post(`/specs/${spec.id}/approve`).set(reviewerHeaders).send({ actor_id: actorReviewer }).expect(201);

  const plan = (await request(server).post(`/work-items/${workItem.id}/plans`).send({}).expect(201)).body;
  const planRevision = (await request(server).post(`/plans/${plan.id}/generate-draft`).send({}).expect(201)).body;
  await request(server).post(`/plans/${plan.id}/submit-for-approval`).set(ownerHeaders).send({ actor_id: actorOwner }).expect(201);
  await request(server).post(`/plans/${plan.id}/approve`).set(reviewerHeaders).send({ actor_id: actorReviewer }).expect(201);

  return planRevision.id as string;
};

const createReadyPackage = async (app: INestApplication, planRevisionId: string) => {
  const server = app.getHttpServer();
  const executionPackage = (
    await request(server)
      .post(`/plan-revisions/${planRevisionId}/execution-packages`)
      .send({
        repo_id: 'repo-1',
        objective: 'Produce local_codex routing evidence.',
        owner_actor_id: actorOwner,
        reviewer_actor_id: actorReviewer,
        qa_owner_actor_id: actorQa,
        required_checks: requiredChecks,
        required_artifact_kinds: ['diff', 'execution_summary'],
        allowed_paths: ['docs/superpowers/reports/**'],
        forbidden_paths: ['apps/control-plane-api/**'],
      })
      .expect(201)
  ).body;
  await request(server)
    .post(`/execution-packages/${executionPackage.id}/mark-ready`)
    .set(ownerHeaders)
    .send({ actor_id: actorOwner, expected_package_version: executionPackage.version })
    .expect(201);
  return executionPackage.id as string;
};

const waitForTerminalRunSession = async (app: INestApplication, runSessionId: string): Promise<Record<string, unknown>> => {
  const worker = app.get(DELIVERY_RUN_WORKER) as RunWorker;
  void worker.drainOnce();

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const runSession = (await request(app.getHttpServer()).get(`/run-sessions/${runSessionId}`).expect(200)).body;
    if (['succeeded', 'failed', 'timed_out', 'cancelled'].includes(runSession.status)) {
      return runSession;
    }
    await delay(10);
  }

  throw new Error(`Timed out waiting for terminal RunSession ${runSessionId}`);
};

const repositoryFor = (app: INestApplication): DeliveryRepository => app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

describe('control-plane local_codex routing', () => {
  let app: INestApplication;
  const mockAdapter = vi.fn((runSpec: RunSpec) => Promise.resolve(resultFor(runSpec, 'mock')));
  const localCodexAdapter = vi.fn((runSpec: RunSpec) => Promise.resolve(resultFor(runSpec, 'local_codex')));

  beforeEach(async () => {
    mockAdapter.mockClear();
    localCodexAdapter.mockClear();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DELIVERY_RUN_WORKER)
      .useFactory({
        inject: [DELIVERY_REPOSITORY],
        factory: (repository: DeliveryRepository) =>
          new RunWorker({
            repository,
            workerId: 'local-codex-routing-test-worker',
            driverFactory: () =>
              new FakeCodexSessionDriver({
                kind: 'fake',
                script: [{ kind: 'terminal', status: 'succeeded', summary: 'Test fake driver completed.' }],
              }),
            evidenceCollector: (input) =>
              input.runSpec.executor_type === 'local_codex' && input.runSpec.workflow_only !== true
                ? localCodexAdapter(input.runSpec)
                : mockAdapter(input.runSpec),
            selfReview: (input) =>
              Promise.resolve({
                status: 'succeeded',
                summary: `Self-review completed for ${input.run_session_id}.`,
                spec_plan_alignment: 'Run spec matches the approved package.',
                test_assessment: 'Required checks passed.',
                risk_notes: [],
                follow_up_questions: [],
              }),
          }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('delegates local_codex non-workflow package runs to the local_codex adapter and persists workspace evidence', async () => {
    const server = app.getHttpServer();
    const planRevisionId = await createApprovedPlanRevision(app);
    const packageId = await createReadyPackage(app, planRevisionId);

    const run = (
      await request(server)
        .post(`/execution-packages/${packageId}/run`)
        .set(ownerHeaders)
        .send({ executor_type: 'local_codex', workflow_only: false })
        .expect(201)
    ).body;
    expect(run).toMatchObject({ status: 'accepted', run_session_id: expect.any(String) });
    expect(run).not.toHaveProperty('workflow_result');
    const runSession = await waitForTerminalRunSession(app, run.run_session_id);

    expect(localCodexAdapter).toHaveBeenCalledTimes(1);
    expect(mockAdapter).not.toHaveBeenCalled();
    expect(runSession).toMatchObject({
      status: 'succeeded',
      executor_type: 'local_codex',
      executor_result: {
        executor_type: 'local_codex',
        executor_version: 'test-local_codex',
        raw_metadata: {},
      },
    });
    expect(runSession).not.toHaveProperty('run_spec');
    expect(runSession.artifacts).toEqual([]);

    const persistedRunSession = await repositoryFor(app).getRunSession(run.run_session_id);
    expect(persistedRunSession).toMatchObject({
      run_spec: {
        executor_type: 'local_codex',
        workflow_only: false,
      },
      executor_result: {
        executor_type: 'local_codex',
        executor_version: 'test-local_codex',
        raw_metadata: {
          workspace_path: `/tmp/forgeloop-test/${run.run_session_id}/workspace`,
          base_ref: 'abc123',
        },
      },
      artifacts: [expect.objectContaining({ kind: 'diff' }), expect.objectContaining({ kind: 'execution_summary' })],
    });
  });

  it('keeps workflow-only runs on the deterministic mock adapter even when local_codex is requested', async () => {
    const server = app.getHttpServer();
    const planRevisionId = await createApprovedPlanRevision(app);
    const packageId = await createReadyPackage(app, planRevisionId);

    const run = (
      await request(server)
        .post(`/execution-packages/${packageId}/run`)
        .set(ownerHeaders)
        .send({ executor_type: 'local_codex', workflow_only: true })
        .expect(201)
    ).body;
    expect(run).toMatchObject({ status: 'accepted', run_session_id: expect.any(String) });
    expect(run).not.toHaveProperty('workflow_result');
    const runSession = await waitForTerminalRunSession(app, run.run_session_id);

    expect(mockAdapter).toHaveBeenCalledTimes(1);
    expect(localCodexAdapter).not.toHaveBeenCalled();
    expect(runSession).toMatchObject({
      status: 'succeeded',
      executor_type: 'mock',
      executor_result: {
        executor_type: 'mock',
        executor_version: 'test-mock',
        raw_metadata: {},
      },
    });
    expect(runSession).not.toHaveProperty('run_spec');

    const persistedRunSession = await repositoryFor(app).getRunSession(run.run_session_id);
    expect(persistedRunSession).toMatchObject({
      run_spec: {
        executor_type: 'mock',
        workflow_only: true,
      },
      executor_result: {
        executor_type: 'mock',
        executor_version: 'test-mock',
        raw_metadata: { workflow_only: true },
      },
    });
  });
});
