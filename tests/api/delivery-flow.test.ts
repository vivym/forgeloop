import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { Test } from '../../apps/control-plane-api/node_modules/@nestjs/testing/index.js';

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
    expect(firstRun).toMatchObject({ status: 'accepted', workflow_result: { status: 'succeeded' } });
    const firstReviewPacketId = firstRun.workflow_result.reviewPacketId;
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
    const rerunSession = (await request(server).get(`/run-sessions/${rerun.run_session_id}`).expect(200)).body;
    expect(rerunSession.run_spec.review_context.latest_decision).toBe('changes_requested');

    await request(server)
      .post(`/review-packets/${rerun.workflow_result.reviewPacketId}/approve`)
      .send({
        summary: 'Approved for handoff.',
        reviewed_by_actor_id: actorReviewer,
        reviewed_at: '2026-05-05T02:00:00.000Z',
      })
      .expect(201);

    const cockpit = (await request(server).get(`/work-items/${workItem.id}/cockpit`).expect(200)).body;
    expect(cockpit.current_spec.current_revision_id).toBe(specRevisionId);
    expect(cockpit.current_plan.current_revision_id).toBe(planRevisionId);
    expect(cockpit.packages.find((item: { id: string }) => item.id === executionPackage.id).resolution).toBe('completed');
    expect(cockpit.completion_state.done).toBe(false);
    expect(cockpit.next_actions).toContain('mark_packages_ready');

    const timeline = (await request(server).get(`/work-items/${workItem.id}/timeline`).expect(200)).body;
    expect(timeline.map((entry: { source: string }) => entry.source)).toEqual(
      expect.arrayContaining(['object_event', 'status_history', 'decision', 'artifact']),
    );
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
    await request(server)
      .patch(`/execution-packages/${executionPackage.id}`)
      .send({ objective: 'Edited package creates a fresh run spec.' })
      .expect(200);

    const oldRun = (await request(server).get(`/run-sessions/${run.run_session_id}`).expect(200)).body;
    const archivedPacket = (await request(server).get(`/review-packets/${run.workflow_result.reviewPacketId}`).expect(200)).body;
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
    expect(newRunSession.run_spec.objective).toBe('Edited package creates a fresh run spec.');
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

    expect((await request(server).get(`/review-packets/${run.workflow_result.reviewPacketId}`).expect(200)).body.status).toBe(
      'archived',
    );
    expect(forceRun.workflow_result.reviewPacketId).not.toBe(run.workflow_result.reviewPacketId);
  });
});
