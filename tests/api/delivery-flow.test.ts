import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { P0Service, RUN_WORKER } from '../../apps/control-plane-api/src/p0/p0.service';
import { InMemoryP0Repository, type TraceEventRecord } from '../../packages/db/src/index';
import type { ReviewPacket, RunSession } from '../../packages/domain/src/index';
import type { RunWorker } from '../../packages/run-worker/src';

const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const actorQa = 'actor-qa';

const requiredChecks = [
  {
    check_id: 'unit',
    display_name: 'Unit tests',
    command: 'pnpm test tests/api',
    timeout_seconds: 120,
    blocks_review: true,
  },
];

const createProjectRepoWorkItem = async (app: INestApplication) => {
  const server = app.getHttpServer();
  const project = (
    await request(server).post('/projects').send({ name: 'Forgeloop', owner_actor_id: actorOwner }).expect(201)
  ).body;
  const repo = (
    await request(server)
      .post(`/projects/${project.id}/repos`)
      .send({
        repo_id: 'repo-1',
        name: 'forgeloop',
        local_path: '/workspace/forgeloop',
        default_branch: 'main',
        base_commit_sha: 'abc123',
      })
      .expect(201)
  ).body;
  const workItem = (
    await request(server)
      .post('/work-items')
      .send({
        project_id: project.id,
        kind: 'feature',
        title: 'Ship P0 control plane API',
        goal: 'Expose the delivery loop commands over REST.',
        success_criteria: ['Spec, plan, package, run, and review commands are available.'],
        priority: 'P0',
        risk: 'medium',
        owner_actor_id: actorOwner,
      })
      .expect(201)
  ).body;

  return { project, repo, workItem };
};

const approveSpec = async (app: INestApplication, workItemId: string) => {
  const server = app.getHttpServer();
  const spec = (await request(server).post(`/work-items/${workItemId}/specs`).send({}).expect(201)).body;
  const manualRevision = (
    await request(server)
      .post(`/specs/${spec.id}/revisions`)
      .send({
        summary: 'Manual API spec',
        content: 'Manual control plane API spec.',
        background: 'P0 needs command coverage.',
        goals: ['Expose P0 commands'],
        scope_in: ['Control plane API'],
        scope_out: ['Web UI'],
        acceptance_criteria: ['API tests cover the delivery flow'],
        risk_notes: ['Keep P0 in-memory for tests'],
        test_strategy_summary: 'Nest + Supertest API tests',
        author_actor_id: actorOwner,
      })
      .expect(201)
  ).body;
  const generatedRevision = (await request(server).post(`/specs/${spec.id}/generate-draft`).send({}).expect(201)).body;

  expect(generatedRevision.id).not.toBe(manualRevision.id);
  expect(generatedRevision.acceptance_criteria).toContain('Spec, plan, package, run, and review commands are available.');
  await request(server).get(`/specs/${spec.id}`).expect(200);
  await request(server).get(`/specs/${spec.id}/revisions`).expect(200);
  await request(server).get(`/spec-revisions/${generatedRevision.id}`).expect(200);
  await request(server).post(`/specs/${spec.id}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
  await request(server).post(`/specs/${spec.id}/approve`).send({ actor_id: actorReviewer }).expect(201);

  return { specId: spec.id, specRevisionId: generatedRevision.id };
};

const approvePlan = async (app: INestApplication, workItemId: string) => {
  const server = app.getHttpServer();
  const plan = (await request(server).post(`/work-items/${workItemId}/plans`).send({}).expect(201)).body;
  const manualRevision = (
    await request(server)
      .post(`/plans/${plan.id}/revisions`)
      .send({
        summary: 'Manual API plan',
        content: 'Manual control plane API plan.',
        implementation_summary: 'Add Nest controller and service.',
        split_strategy: 'One API package.',
        dependency_order: ['api-package'],
        test_matrix: ['pnpm test tests/api'],
        risk_mitigations: ['Use in-memory repository in tests'],
        rollback_notes: 'Revert API app changes.',
        author_actor_id: actorOwner,
      })
      .expect(201)
  ).body;
  const generatedRevision = (await request(server).post(`/plans/${plan.id}/generate-draft`).send({}).expect(201)).body;

  expect(generatedRevision.id).not.toBe(manualRevision.id);
  expect(generatedRevision.test_matrix).toContain('pnpm test tests/api');
  await request(server).get(`/plans/${plan.id}`).expect(200);
  await request(server).get(`/plans/${plan.id}/revisions`).expect(200);
  await request(server).get(`/plan-revisions/${generatedRevision.id}`).expect(200);
  await request(server).post(`/plans/${plan.id}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
  await request(server).post(`/plans/${plan.id}/approve`).send({ actor_id: actorReviewer }).expect(201);

  return { planId: plan.id, planRevisionId: generatedRevision.id };
};

const createManualPackage = async (
  app: INestApplication,
  planRevisionId: string,
  overrides: Record<string, unknown> = {},
) => {
  const body = {
    repo_id: 'repo-1',
    objective: 'Implement the P0 API package.',
    owner_actor_id: actorOwner,
    reviewer_actor_id: actorReviewer,
    qa_owner_actor_id: actorQa,
    required_checks: requiredChecks,
    required_artifact_kinds: ['execution_summary'],
    allowed_paths: ['apps/control-plane-api/**', 'tests/api/**'],
    forbidden_paths: ['packages/db/**'],
    ...overrides,
  };

  return (await request(app.getHttpServer()).post(`/plan-revisions/${planRevisionId}/execution-packages`).send(body).expect(201))
    .body;
};

const repositoryFor = (app: INestApplication): InMemoryP0Repository =>
  (app.get(P0Service) as unknown as { repository: InMemoryP0Repository }).repository;

const waitForReviewPacket = async (app: INestApplication, runSessionId: string): Promise<ReviewPacket> => {
  const repository = repositoryFor(app);
  const worker = app.get(RUN_WORKER) as RunWorker;
  void worker.drainOnce();

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const runSession = await repository.getRunSession(runSessionId);
    if (runSession !== undefined) {
      const packet = (await repository.listReviewPacketsForPackage(runSession.execution_package_id)).find(
        (item) => item.run_session_id === runSessionId,
      );
      if (packet !== undefined) {
        return packet;
      }
    }
    await delay(10);
  }

  throw new Error(`Timed out waiting for ReviewPacket for ${runSessionId}`);
};

const getAvailablePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'string' || address === null) {
        server.close(() => reject(new Error('Unable to allocate an API smoke test port')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });

const stopProcess = async (child: ChildProcessWithoutNullStreams): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }, 1_000).unref();
  });
};

const startRuntimeApi = async (): Promise<{ child: ChildProcessWithoutNullStreams; port: number; logs: () => string }> => {
  const port = await getAvailablePort();
  const child = spawn('pnpm', ['exec', 'tsx', 'src/main.ts'], {
    cwd: 'apps/control-plane-api',
    env: { ...process.env, PORT: String(port) },
  });
  const output: string[] = [];
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()));

  return { child, port, logs: () => output.join('') };
};

const waitForRuntimeCreateProject = async (
  port: number,
): Promise<request.Response> => {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 8_000) {
    try {
      return await request(`http://127.0.0.1:${port}`).post('/projects').send({ name: 'Runtime smoke' });
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Timed out waiting for runtime API');
};

class SequencingRepository extends InMemoryP0Repository {
  readonly operations: string[] = [];

  override async saveRunSession(runSession: RunSession): Promise<void> {
    this.operations.push(`saveRunSession:${runSession.id}`);
    await super.saveRunSession(runSession);
  }

  override async saveReviewPacket(reviewPacket: ReviewPacket): Promise<void> {
    if (reviewPacket.status === 'archived') {
      this.operations.push(`archiveReviewPacket:${reviewPacket.id}`);
    }
    await super.saveReviewPacket(reviewPacket);
  }
}

class FailingTraceRepository extends InMemoryP0Repository {
  override async saveTraceEvent(_event: TraceEventRecord): Promise<void> {
    throw new Error('trace store unavailable');
  }
}

describe('P0 control plane API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('runs the P0 delivery flow through the command inventory and read APIs', async () => {
    const server = app.getHttpServer();
    const { project, workItem } = await createProjectRepoWorkItem(app);

    expect((await request(server).get(`/projects/${project.id}`).expect(200)).body.repo_ids).toEqual(['repo-1']);
    expect((await request(server).get(`/projects/${project.id}/repos`).expect(200)).body).toHaveLength(1);
    expect((await request(server).get('/work-items').query({ project_id: project.id }).expect(200)).body[0].id).toBe(
      workItem.id,
    );
    await request(server).get(`/work-items/${workItem.id}`).expect(200);

    const { specRevisionId } = await approveSpec(app, workItem.id);
    const { planRevisionId } = await approvePlan(app, workItem.id);
    expect(specRevisionId).toContain('spec-revision');

    const generatedPackages = (await request(server).post(`/plan-revisions/${planRevisionId}/generate-packages`).send({}).expect(201))
      .body;
    expect(generatedPackages).toHaveLength(1);
    expect(generatedPackages[0].phase).toBe('draft');

    const executionPackage = await createManualPackage(app, planRevisionId);
    expect((await request(server).get(`/work-items/${workItem.id}/execution-packages`).expect(200)).body.length).toBeGreaterThanOrEqual(
      2,
    );
    await request(server).get(`/execution-packages/${executionPackage.id}`).expect(200);
    await request(server).patch(`/execution-packages/${executionPackage.id}`).send({ objective: 'Edited before ready.' }).expect(200);
    await request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`).send({ actor_id: actorOwner }).expect(201);

    const firstRun = (
      await request(server)
        .post(`/execution-packages/${executionPackage.id}/run`)
        .send({ requested_by_actor_id: actorOwner, workflow_only: true })
        .expect(201)
    ).body;
    expect(firstRun).toMatchObject({ status: 'accepted', run_session_id: expect.any(String) });
    expect(firstRun).not.toHaveProperty('workflow_result');
    const firstReviewPacketId = (await waitForReviewPacket(app, firstRun.run_session_id)).id;
    await request(server).get(`/run-sessions/${firstRun.run_session_id}`).expect(200);
    await request(server).get(`/review-packets/${firstReviewPacketId}`).expect(200);

    await request(server)
      .post(`/review-packets/${firstReviewPacketId}/request-changes`)
      .send({
        summary: 'Please tighten the API assertions.',
        reviewed_by_actor_id: actorReviewer,
        reviewed_at: '2026-05-05T01:00:00.000Z',
        requested_changes: [
          {
            title: 'Add rerun coverage',
            description: 'Verify requested changes are carried into reruns.',
            file_path: 'tests/api/delivery-flow.test.ts',
            severity: 'major',
            suggested_validation: 'pnpm test tests/api',
          },
        ],
      })
      .expect(201);

    const rerun = (
      await request(server)
        .post(`/execution-packages/${executionPackage.id}/rerun`)
        .send({ requested_by_actor_id: actorOwner, previous_run_session_id: firstRun.run_session_id, workflow_only: true })
        .expect(201)
    ).body;
    const rerunReviewPacketId = (await waitForReviewPacket(app, rerun.run_session_id)).id;
    const rerunSession = (await request(server).get(`/run-sessions/${rerun.run_session_id}`).expect(200)).body;
    expect(rerunSession).not.toHaveProperty('run_spec');
    expect((await repositoryFor(app).getRunSession(rerun.run_session_id))?.run_spec?.review_context.latest_decision).toBe(
      'changes_requested',
    );

    await request(server)
      .post(`/review-packets/${rerunReviewPacketId}/approve`)
      .send({
        summary: 'Approved for handoff.',
        reviewed_by_actor_id: actorReviewer,
        reviewed_at: '2026-05-05T02:00:00.000Z',
      })
      .expect(201);

    const cockpit = (await request(server).get(`/query/work-item-cockpit/${workItem.id}`).expect(200)).body;
    expect(cockpit.current_spec.current_revision_id).toBe(specRevisionId);
    expect(cockpit.current_plan.current_revision_id).toBe(planRevisionId);
    expect(cockpit.packages.find((item: { id: string }) => item.id === executionPackage.id).resolution).toBe('completed');
    expect(cockpit.completion_state.done).toBe(false);
    expect(cockpit.next_actions).toContain('mark_packages_ready');

    const timeline = (await request(server).get(`/query/replay/work_item/${workItem.id}`).expect(200)).body;
    const timelineSources = timeline.map((entry: { source: string }) => entry.source);
    expect(timelineSources).toEqual(expect.arrayContaining(['object_event', 'status_history', 'decision']));
    expect(timelineSources).not.toContain('artifact');
  });

  it('serves POST /projects when booted through the tsx runtime entrypoint', async () => {
    const runtime = await startRuntimeApi();
    try {
      const response = await waitForRuntimeCreateProject(runtime.port);

      expect(response.status, runtime.logs()).toBe(201);
      expect(response.body).toMatchObject({ id: expect.stringContaining('project'), name: 'Runtime smoke' });
    } finally {
      await stopProcess(runtime.child);
    }
  });

  it('maps invalid domain transitions and package validators to 4xx responses', async () => {
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);

    const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;
    await request(server).post(`/specs/${spec.id}/approve`).send({ actor_id: actorReviewer }).expect(400);

    await approveSpec(app, workItem.id);
    const { planRevisionId } = await approvePlan(app, workItem.id);
    const executionPackage = await createManualPackage(app, planRevisionId);
    await request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`).send({ actor_id: actorOwner }).expect(201);
    await request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`).send({ actor_id: actorOwner }).expect(400);

    const run = (
      await request(server)
        .post(`/execution-packages/${executionPackage.id}/run`)
        .send({ requested_by_actor_id: actorOwner, workflow_only: true })
        .expect(201)
    ).body;
    const reviewPacketId = (await waitForReviewPacket(app, run.run_session_id)).id;
    await request(server)
      .post(`/review-packets/${reviewPacketId}/approve`)
      .send({
        summary: 'Approved once.',
        reviewed_by_actor_id: actorReviewer,
        reviewed_at: '2026-05-05T05:00:00.000Z',
      })
      .expect(201);
    await request(server)
      .post(`/review-packets/${reviewPacketId}/approve`)
      .send({
        summary: 'Approved twice.',
        reviewed_by_actor_id: actorReviewer,
        reviewed_at: '2026-05-05T05:01:00.000Z',
      })
      .expect(400);

    await request(server).patch(`/execution-packages/${executionPackage.id}`).send({ owner_actor_id: '' }).expect(400);
  });

  it('rejects malformed request bodies with 400 responses and does not persist invalid objects', async () => {
    const server = app.getHttpServer();

    await request(server).post('/projects').send({ name: { text: 'Forgeloop' } }).expect(400);
    await request(server).post('/projects').send(null).expect(400);

    const { project, workItem } = await createProjectRepoWorkItem(app);
    await request(server)
      .post('/work-items')
      .send({
        project_id: project.id,
        kind: 'feature',
        title: 'Invalid success criteria',
        goal: 'This should not persist.',
        success_criteria: 'not-an-array',
        priority: 'P0',
        risk: 'medium',
        owner_actor_id: actorOwner,
      })
      .expect(400);
    expect((await request(server).get('/work-items').query({ project_id: project.id }).expect(200)).body).toHaveLength(1);

    await approveSpec(app, workItem.id);
    const { planRevisionId } = await approvePlan(app, workItem.id);
    await request(server)
      .post(`/plan-revisions/${planRevisionId}/execution-packages`)
      .send({
        repo_id: 'repo-1',
        objective: 'Invalid package.',
        owner_actor_id: actorOwner,
        reviewer_actor_id: actorReviewer,
        qa_owner_actor_id: actorQa,
        required_checks: 'pnpm test',
        required_artifact_kinds: ['execution_summary'],
        allowed_paths: ['apps/control-plane-api/**'],
        forbidden_paths: [],
      })
      .expect(400);
    expect((await request(server).get(`/work-items/${workItem.id}/execution-packages`).expect(200)).body).toHaveLength(0);

    const executionPackage = await createManualPackage(app, planRevisionId);
    await request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`).send({ actor_id: actorOwner }).expect(201);
    const run = (
      await request(server)
        .post(`/execution-packages/${executionPackage.id}/run`)
        .send({ requested_by_actor_id: actorOwner, workflow_only: true })
        .expect(201)
    ).body;
    const reviewPacketId = (await waitForReviewPacket(app, run.run_session_id)).id;
    await request(server)
      .post(`/review-packets/${reviewPacketId}/request-changes`)
      .send({
        summary: 'Invalid review decision.',
        reviewed_by_actor_id: actorReviewer,
        reviewed_at: '2026-05-05T06:00:00.000Z',
        requested_changes: { title: 'Wrong shape' },
      })
      .expect(400);
    expect((await request(server).get(`/review-packets/${reviewPacketId}`).expect(200)).body).toMatchObject({
      status: 'ready',
      decision: 'none',
    });
  });

  it('archives an open ReviewPacket on package edit while preserving old RunSessions and completed packets', async () => {
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);
    await approveSpec(app, workItem.id);
    const { planRevisionId } = await approvePlan(app, workItem.id);
    const executionPackage = await createManualPackage(app, planRevisionId);

    await request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`).send({ actor_id: actorOwner }).expect(201);
    const run = (
      await request(server)
        .post(`/execution-packages/${executionPackage.id}/run`)
        .send({ requested_by_actor_id: actorOwner, workflow_only: true })
        .expect(201)
    ).body;
    const reviewPacketId = (await waitForReviewPacket(app, run.run_session_id)).id;
    await request(server)
      .patch(`/execution-packages/${executionPackage.id}`)
      .send({ objective: 'Edited package creates a fresh run spec.' })
      .expect(200);

    const oldRun = (await request(server).get(`/run-sessions/${run.run_session_id}`).expect(200)).body;
    const archivedPacket = (await request(server).get(`/review-packets/${reviewPacketId}`).expect(200)).body;
    expect(oldRun.status).toBe('succeeded');
    expect(archivedPacket.status).toBe('archived');

    await request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`).send({ actor_id: actorOwner }).expect(201);
    const newRun = (
      await request(server)
        .post(`/execution-packages/${executionPackage.id}/run`)
        .send({ requested_by_actor_id: actorOwner, workflow_only: true })
        .expect(201)
    ).body;
    const newRunSession = (await request(server).get(`/run-sessions/${newRun.run_session_id}`).expect(200)).body;

    expect(newRun.run_session_id).not.toBe(run.run_session_id);
    expect(newRunSession).not.toHaveProperty('run_spec');
    expect((await repositoryFor(app).getRunSession(newRun.run_session_id))?.run_spec?.objective).toBe(
      'Edited package creates a fresh run spec.',
    );
  });

  it('archives an in-review ReviewPacket on package edit and preserves the previous RunSession', async () => {
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);
    await approveSpec(app, workItem.id);
    const { planRevisionId } = await approvePlan(app, workItem.id);
    const executionPackage = await createManualPackage(app, planRevisionId);
    const service = app.get(P0Service);
    const repository = (service as unknown as { repository: InMemoryP0Repository }).repository;

    await request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`).send({ actor_id: actorOwner }).expect(201);
    const run = (
      await request(server)
        .post(`/execution-packages/${executionPackage.id}/run`)
        .send({ requested_by_actor_id: actorOwner, workflow_only: true })
        .expect(201)
    ).body;
    const reviewPacketId = (await waitForReviewPacket(app, run.run_session_id)).id;
    const readyPacket = await repository.getReviewPacket(reviewPacketId);
    await repository.saveReviewPacket({ ...readyPacket!, status: 'in_review' });

    await request(server)
      .patch(`/execution-packages/${executionPackage.id}`)
      .send({ objective: 'Edit while human review has started.' })
      .expect(200);

    expect((await request(server).get(`/run-sessions/${run.run_session_id}`).expect(200)).body.status).toBe('succeeded');
    expect((await request(server).get(`/review-packets/${reviewPacketId}`).expect(200)).body.status).toBe('archived');
  });

  it('validates run, rerun, and force-rerun request bodies and previous run ids', async () => {
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);
    await approveSpec(app, workItem.id);
    const { planRevisionId } = await approvePlan(app, workItem.id);
    const executionPackage = await createManualPackage(app, planRevisionId);

    await request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`).send({ actor_id: actorOwner }).expect(201);
    await request(server).post(`/execution-packages/${executionPackage.id}/run`).send({ workflow_only: true }).expect(400);

    const run = (
      await request(server)
        .post(`/execution-packages/${executionPackage.id}/run`)
        .send({ requested_by_actor_id: actorOwner, workflow_only: true })
        .expect(201)
    ).body;
    const reviewPacketId = (await waitForReviewPacket(app, run.run_session_id)).id;
    await request(server)
      .post(`/review-packets/${reviewPacketId}/request-changes`)
      .send({
        summary: 'Rerun required.',
        reviewed_by_actor_id: actorReviewer,
        reviewed_at: '2026-05-05T03:00:00.000Z',
        requested_changes: [{ title: 'Rerun', description: 'Exercise validation.' }],
      })
      .expect(201);

    await request(server)
      .post(`/execution-packages/${executionPackage.id}/rerun`)
      .send({ requested_by_actor_id: actorOwner, workflow_only: true })
      .expect(400);
    await request(server)
      .post(`/execution-packages/${executionPackage.id}/rerun`)
      .send({ requested_by_actor_id: actorOwner, previous_run_session_id: 'run-session-stale', workflow_only: true })
      .expect(400);

    const rerun = (
      await request(server)
        .post(`/execution-packages/${executionPackage.id}/rerun`)
        .send({ requested_by_actor_id: actorOwner, previous_run_session_id: run.run_session_id, workflow_only: true })
        .expect(201)
    ).body;
    await waitForReviewPacket(app, rerun.run_session_id);

    await request(server)
      .post(`/execution-packages/${executionPackage.id}/force-rerun`)
      .send({ requested_by_actor_id: actorOwner, previous_run_session_id: rerun.run_session_id, workflow_only: true })
      .expect(400);
    await request(server)
      .post(`/execution-packages/${executionPackage.id}/force-rerun`)
      .send({
        requested_by_actor_id: actorOwner,
        previous_run_session_id: 'run-session-stale',
        force: true,
        force_reason: 'Stale run id.',
        workflow_only: true,
      })
      .expect(400);
  });

  it('records rerun replacement trace links and updates the payload when the new ReviewPacket is created', async () => {
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);
    await approveSpec(app, workItem.id);
    const { planRevisionId } = await approvePlan(app, workItem.id);
    const executionPackage = await createManualPackage(app, planRevisionId);

    await request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`).send({ actor_id: actorOwner }).expect(201);
    const firstRun = (
      await request(server)
        .post(`/execution-packages/${executionPackage.id}/run`)
        .send({ requested_by_actor_id: actorOwner, workflow_only: true })
        .expect(201)
    ).body;
    const firstReviewPacketId = (await waitForReviewPacket(app, firstRun.run_session_id)).id;
    await request(server)
      .post(`/review-packets/${firstReviewPacketId}/request-changes`)
      .send({
        summary: 'Rerun required.',
        reviewed_by_actor_id: actorReviewer,
        reviewed_at: '2026-05-05T03:00:00.000Z',
        requested_changes: [{ title: 'Rerun', description: 'Exercise trace replacement links.' }],
      })
      .expect(201);

    const rerun = (
      await request(server)
        .post(`/execution-packages/${executionPackage.id}/rerun`)
        .send({ requested_by_actor_id: actorOwner, previous_run_session_id: firstRun.run_session_id, workflow_only: true })
        .expect(201)
    ).body;
    const repository = repositoryFor(app);
    const queuedReplacementEvent = (await repository.listTraceEventsForSubject('run_session', rerun.run_session_id)).find(
      (event) => event.event_type === 'run_replacement_recorded',
    );

    expect(queuedReplacementEvent).toMatchObject({
      subject_type: 'run_session',
      subject_id: rerun.run_session_id,
      payload: {
        mode: 'rerun_package',
        execution_package_id: executionPackage.id,
        work_item_id: workItem.id,
        new_run_session_id: rerun.run_session_id,
        previous_run_session_id: firstRun.run_session_id,
        previous_review_packet_id: firstReviewPacketId,
        triggering_review_packet_id: firstReviewPacketId,
      },
    });
    expect(queuedReplacementEvent?.payload).not.toHaveProperty('new_review_packet_id');
    expect(await repository.listTraceLinks(queuedReplacementEvent!.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relationship: 'belongs_to', object_type: 'work_item', object_id: workItem.id }),
        expect.objectContaining({
          relationship: 'belongs_to',
          object_type: 'execution_package',
          object_id: executionPackage.id,
        }),
        expect.objectContaining({ relationship: 'generated_by', object_type: 'run_session', object_id: rerun.run_session_id }),
        expect.objectContaining({ relationship: 'supersedes', object_type: 'run_session', object_id: firstRun.run_session_id }),
        expect.objectContaining({ relationship: 'replaces', object_type: 'review_packet', object_id: firstReviewPacketId }),
      ]),
    );

    const rerunReviewPacketId = (await waitForReviewPacket(app, rerun.run_session_id)).id;
    const updatedReplacementEvent = (await repository.listTraceEventsForSubject('run_session', rerun.run_session_id)).find(
      (event) => event.event_type === 'run_replacement_recorded',
    );

    expect(updatedReplacementEvent?.payload).toMatchObject({ new_review_packet_id: rerunReviewPacketId });
    expect(await repository.listTraceLinks(updatedReplacementEvent!.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relationship: 'generated_by', object_type: 'review_packet', object_id: rerunReviewPacketId }),
      ]),
    );
  });

  it('commits rerun primary records when replacement trace writes fail', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const service = app.get(P0Service);
      const repository = new FailingTraceRepository();
      (service as unknown as { repository: FailingTraceRepository }).repository = repository;
      (app.get(RUN_WORKER) as unknown as { repository: FailingTraceRepository }).repository = repository;
      const server = app.getHttpServer();
      const { workItem } = await createProjectRepoWorkItem(app);
      await approveSpec(app, workItem.id);
      const { planRevisionId } = await approvePlan(app, workItem.id);
      const executionPackage = await createManualPackage(app, planRevisionId);

      await request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`).send({ actor_id: actorOwner }).expect(201);
      const firstRun = (
        await request(server)
          .post(`/execution-packages/${executionPackage.id}/run`)
          .send({ requested_by_actor_id: actorOwner, workflow_only: true })
          .expect(201)
      ).body;
      const firstReviewPacketId = (await waitForReviewPacket(app, firstRun.run_session_id)).id;
      await request(server)
        .post(`/review-packets/${firstReviewPacketId}/request-changes`)
        .send({
          summary: 'Rerun required.',
          reviewed_by_actor_id: actorReviewer,
          reviewed_at: '2026-05-05T03:00:00.000Z',
          requested_changes: [{ title: 'Rerun', description: 'Primary records must survive trace failure.' }],
        })
        .expect(201);

      warnSpy.mockClear();
      const rerun = (
        await request(server)
          .post(`/execution-packages/${executionPackage.id}/rerun`)
          .send({ requested_by_actor_id: actorOwner, previous_run_session_id: firstRun.run_session_id, workflow_only: true })
          .expect(201)
      ).body;
      const rerunReviewPacketId = (await waitForReviewPacket(app, rerun.run_session_id)).id;
      const persistedPackage = await repository.getExecutionPackage(executionPackage.id);
      const persistedRerun = await repository.getRunSession(rerun.run_session_id);
      const reviewPackets = await repository.listReviewPacketsForPackage(executionPackage.id);

      expect(persistedPackage?.last_run_session_id).toBe(rerun.run_session_id);
      expect(persistedRerun?.run_spec?.review_context.latest_decision).toBe('changes_requested');
      expect(reviewPackets.map((packet) => packet.id)).toEqual(expect.arrayContaining([firstReviewPacketId, rerunReviewPacketId]));
      expect(warnSpy).toHaveBeenCalledWith(
        '[forgeloop:p0.trace] best-effort trace write failed',
        expect.objectContaining({ source: 'control-plane-api', error: 'trace store unavailable' }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('enforces owner-only force-rerun and archives the current open ReviewPacket', async () => {
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);
    await approveSpec(app, workItem.id);
    const { planRevisionId } = await approvePlan(app, workItem.id);
    const executionPackage = await createManualPackage(app, planRevisionId);

    await request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`).send({ actor_id: actorOwner }).expect(201);
    const run = (
      await request(server)
        .post(`/execution-packages/${executionPackage.id}/run`)
        .send({ requested_by_actor_id: actorOwner, workflow_only: true })
        .expect(201)
    ).body;
    const reviewPacketId = (await waitForReviewPacket(app, run.run_session_id)).id;
    await request(server)
      .post(`/execution-packages/${executionPackage.id}/force-rerun`)
      .send({
        requested_by_actor_id: actorReviewer,
        previous_run_session_id: run.run_session_id,
        force: true,
        force_reason: 'Reviewer is not the owner.',
        workflow_only: true,
      })
      .expect(403);

    const forceRun = (
      await request(server)
        .post(`/execution-packages/${executionPackage.id}/force-rerun`)
        .send({
          requested_by_actor_id: actorOwner,
          previous_run_session_id: run.run_session_id,
          force: true,
          force_reason: 'Owner wants a fresh run before review.',
          workflow_only: true,
        })
        .expect(201)
    ).body;

    const forceReviewPacketId = (await waitForReviewPacket(app, forceRun.run_session_id)).id;
    expect((await request(server).get(`/review-packets/${reviewPacketId}`).expect(200)).body.status).toBe('archived');
    expect(forceReviewPacketId).not.toBe(reviewPacketId);
  });

  it('rejects force-rerun after completed review and leaves the completed packet immutable', async () => {
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);
    await approveSpec(app, workItem.id);
    const { planRevisionId } = await approvePlan(app, workItem.id);
    const executionPackage = await createManualPackage(app, planRevisionId);

    await request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`).send({ actor_id: actorOwner }).expect(201);
    const run = (
      await request(server)
        .post(`/execution-packages/${executionPackage.id}/run`)
        .send({ requested_by_actor_id: actorOwner, workflow_only: true })
        .expect(201)
    ).body;
    const reviewPacketId = (await waitForReviewPacket(app, run.run_session_id)).id;
    await request(server)
      .post(`/review-packets/${reviewPacketId}/approve`)
      .send({
        summary: 'Completed review.',
        reviewed_by_actor_id: actorReviewer,
        reviewed_at: '2026-05-05T04:00:00.000Z',
      })
      .expect(201);

    await request(server)
      .post(`/execution-packages/${executionPackage.id}/force-rerun`)
      .send({
        requested_by_actor_id: actorOwner,
        previous_run_session_id: run.run_session_id,
        force: true,
        force_reason: 'Cannot force-rerun after completed review.',
        workflow_only: true,
      })
      .expect(400);

    expect((await request(server).get(`/review-packets/${reviewPacketId}`).expect(200)).body).toMatchObject({
      status: 'completed',
      decision: 'approved',
      summary: 'Completed review.',
    });
  });

  it('archives the current open ReviewPacket before saving the force-rerun RunSession', async () => {
    const service = app.get(P0Service);
    const repository = new SequencingRepository();
    (service as unknown as { repository: SequencingRepository }).repository = repository;
    (app.get(RUN_WORKER) as unknown as { repository: SequencingRepository }).repository = repository;
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);
    await approveSpec(app, workItem.id);
    const { planRevisionId } = await approvePlan(app, workItem.id);
    const executionPackage = await createManualPackage(app, planRevisionId);

    await request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`).send({ actor_id: actorOwner }).expect(201);
    const run = (
      await request(server)
        .post(`/execution-packages/${executionPackage.id}/run`)
        .send({ requested_by_actor_id: actorOwner, workflow_only: true })
        .expect(201)
    ).body;
    const reviewPacketId = (await waitForReviewPacket(app, run.run_session_id)).id;
    repository.operations.length = 0;

    const forceRun = (
      await request(server)
        .post(`/execution-packages/${executionPackage.id}/force-rerun`)
        .send({
          requested_by_actor_id: actorOwner,
          previous_run_session_id: run.run_session_id,
          force: true,
          force_reason: 'Owner wants a fresh run before review.',
          workflow_only: true,
        })
        .expect(201)
    ).body;

    expect(repository.operations.indexOf(`archiveReviewPacket:${reviewPacketId}`)).toBeLessThan(
      repository.operations.indexOf(`saveRunSession:${forceRun.run_session_id}`),
    );
  });

  it('supports Spec and Plan request-changes command paths', async () => {
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);

    const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;
    await request(server)
      .post(`/specs/${spec.id}/revisions`)
      .send({
        summary: 'Spec for changes',
        content: 'Spec body',
        background: 'Background',
        goals: ['Goal'],
        scope_in: ['Scope'],
        scope_out: [],
        acceptance_criteria: ['Criteria'],
        test_strategy_summary: 'Tests',
      })
      .expect(201);
    await request(server).post(`/specs/${spec.id}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
    expect(
      (await request(server).post(`/specs/${spec.id}/request-changes`).send({ actor_id: actorReviewer }).expect(201)).body,
    ).toMatchObject({ status: 'draft', gate_state: 'changes_requested' });

    const { workItem: planWorkItem } = await createProjectRepoWorkItem(app);
    const approvedSpec = await approveSpec(app, planWorkItem.id);
    expect(approvedSpec.specId).toContain('spec');
    const plan = (await request(server).post(`/work-items/${planWorkItem.id}/plans`).send({}).expect(201)).body;
    await request(server)
      .post(`/plans/${plan.id}/revisions`)
      .send({
        summary: 'Plan for changes',
        content: 'Plan body',
        implementation_summary: 'Implementation',
        split_strategy: 'One package',
        test_matrix: ['pnpm test tests/api'],
        rollback_notes: 'Revert',
      })
      .expect(201);
    await request(server).post(`/plans/${plan.id}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
    expect(
      (await request(server).post(`/plans/${plan.id}/request-changes`).send({ actor_id: actorReviewer }).expect(201)).body,
    ).toMatchObject({ status: 'draft', gate_state: 'changes_requested' });
  });
});
