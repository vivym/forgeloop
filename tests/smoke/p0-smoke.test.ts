import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';

const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const actorQa = 'actor-qa';
const repoId = 'repo-1';

const requiredChecks = [
  {
    check_id: 'smoke',
    display_name: 'P0 smoke',
    command: 'pnpm smoke:p0',
    timeout_seconds: 120,
    blocks_review: true,
  },
];

type SmokeContext = {
  project: { id: string };
  workItem: { id: string };
  specRevisionId: string;
  planRevisionId: string;
};

const createApprovedSpecAndPlan = async (
  app: INestApplication,
  kind: 'feature' | 'bugfix' | 'test_refactor' = 'feature',
): Promise<SmokeContext> => {
  const server = app.getHttpServer();
  const project = (
    await request(server).post('/projects').send({ name: `P0 smoke ${kind}`, owner_actor_id: actorOwner }).expect(201)
  ).body;

  await request(server)
    .post(`/projects/${project.id}/repos`)
    .send({
      repo_id: repoId,
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
        kind,
        title: `P0 ${kind} smoke item`,
        goal: 'Exercise the approved P0 delivery loop.',
        success_criteria: ['Spec, plan, package, run, review, and timeline evidence are persisted.'],
        priority: 'P0',
        risk: 'medium',
        owner_actor_id: actorOwner,
      })
      .expect(201)
  ).body;

  const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;
  const specRevision = (await request(server).post(`/specs/${spec.id}/generate-draft`).send({}).expect(201)).body;
  await request(server).post(`/specs/${spec.id}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
  await request(server).post(`/specs/${spec.id}/approve`).send({ actor_id: actorReviewer }).expect(201);

  const plan = (await request(server).post(`/work-items/${workItem.id}/plans`).send({}).expect(201)).body;
  const planRevision = (await request(server).post(`/plans/${plan.id}/generate-draft`).send({}).expect(201)).body;
  await request(server).post(`/plans/${plan.id}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
  await request(server).post(`/plans/${plan.id}/approve`).send({ actor_id: actorReviewer }).expect(201);

  return {
    project,
    workItem,
    specRevisionId: specRevision.id,
    planRevisionId: planRevision.id,
  };
};

const createReadyPackage = async (app: INestApplication, planRevisionId: string, objective = 'Deliver the P0 smoke package.') => {
  const server = app.getHttpServer();
  const executionPackage = (
    await request(server)
      .post(`/plan-revisions/${planRevisionId}/execution-packages`)
      .send({
        repo_id: repoId,
        objective,
        owner_actor_id: actorOwner,
        reviewer_actor_id: actorReviewer,
        qa_owner_actor_id: actorQa,
        required_checks: requiredChecks,
        required_artifact_kinds: ['diff', 'execution_summary'],
        allowed_paths: ['apps/control-plane-api/**', 'tests/smoke/**'],
        forbidden_paths: ['packages/db/**'],
      })
      .expect(201)
  ).body;

  await request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`).send({ actor_id: actorOwner }).expect(201);

  return executionPackage;
};

const runPackage = async (
  app: INestApplication,
  executionPackageId: string,
  path: 'run' | 'rerun' | 'force-rerun' = 'run',
  body: Record<string, unknown> = {},
) =>
  (
    await request(app.getHttpServer())
      .post(`/execution-packages/${executionPackageId}/${path}`)
      .send({ requested_by_actor_id: actorOwner, workflow_only: true, ...body })
      .expect(201)
  ).body;

const approveReviewPacket = async (app: INestApplication, reviewPacketId: string, reviewedAt = '2026-05-05T01:00:00.000Z') =>
  request(app.getHttpServer())
    .post(`/review-packets/${reviewPacketId}/approve`)
    .send({
      summary: 'Approved for P0 handoff.',
      reviewed_by_actor_id: actorReviewer,
      reviewed_at: reviewedAt,
    })
    .expect(201);

describe('P0 smoke delivery loop', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('moves a work item through approved spec, approved plan, package run, and approved review', async () => {
    const server = app.getHttpServer();
    const { workItem, specRevisionId, planRevisionId } = await createApprovedSpecAndPlan(app);
    const executionPackage = await createReadyPackage(app, planRevisionId);

    const run = await runPackage(app, executionPackage.id);
    expect(run).toMatchObject({ status: 'accepted', workflow_result: { status: 'succeeded' } });
    expect(run.workflow_result.reviewPacketId).toEqual(expect.stringContaining('review-packet'));

    const runSession = (await request(server).get(`/run-sessions/${run.run_session_id}`).expect(200)).body;
    expect(runSession).toMatchObject({
      status: 'succeeded',
      executor_type: 'mock',
      run_spec: {
        spec_revision_id: specRevisionId,
        plan_revision_id: planRevisionId,
        workflow_only: true,
      },
    });
    expect(runSession.changed_files).not.toHaveLength(0);
    expect(runSession.check_results).toEqual([expect.objectContaining({ check_id: 'smoke', status: 'succeeded' })]);

    const reviewPacket = (await request(server).get(`/review-packets/${run.workflow_result.reviewPacketId}`).expect(200)).body;
    expect(reviewPacket).toMatchObject({
      status: 'ready',
      decision: 'none',
      spec_revision_id: specRevisionId,
      plan_revision_id: planRevisionId,
    });
    expect(reviewPacket.changed_files).toEqual(runSession.changed_files);

    await approveReviewPacket(app, reviewPacket.id);

    const cockpit = (await request(server).get(`/work-items/${workItem.id}/cockpit`).expect(200)).body;
    expect(cockpit.packages[0]).toMatchObject({
      id: executionPackage.id,
      phase: 'review',
      gate_state: 'review_approved',
      resolution: 'completed',
    });
    expect(cockpit.review_packets[0]).toMatchObject({ id: reviewPacket.id, status: 'completed', decision: 'approved' });

    const timeline = (await request(server).get(`/work-items/${workItem.id}/timeline`).expect(200)).body;
    expect(timeline.map((entry: { source: string }) => entry.source)).toEqual(
      expect.arrayContaining(['object_event', 'status_history', 'decision', 'artifact']),
    );
  });

  it('records changes_requested, reruns with a new run session and review packet, then approves the rerun', async () => {
    const server = app.getHttpServer();
    const { workItem, planRevisionId } = await createApprovedSpecAndPlan(app, 'bugfix');
    const executionPackage = await createReadyPackage(app, planRevisionId, 'Fix the P0 smoke bug.');

    const firstRun = await runPackage(app, executionPackage.id);
    await request(server)
      .post(`/review-packets/${firstRun.workflow_result.reviewPacketId}/request-changes`)
      .send({
        summary: 'Tighten the validation evidence.',
        reviewed_by_actor_id: actorReviewer,
        reviewed_at: '2026-05-05T02:00:00.000Z',
        requested_changes: [
          {
            title: 'Add rerun evidence',
            description: 'Show that review feedback is carried into the replacement run.',
            file_path: 'tests/smoke/p0-smoke.test.ts',
            severity: 'major',
            suggested_validation: 'pnpm smoke:p0',
          },
        ],
      })
      .expect(201);

    const rerun = await runPackage(app, executionPackage.id, 'rerun', { previous_run_session_id: firstRun.run_session_id });
    expect(rerun.run_session_id).not.toBe(firstRun.run_session_id);
    expect(rerun.workflow_result.reviewPacketId).not.toBe(firstRun.workflow_result.reviewPacketId);

    const rerunSession = (await request(server).get(`/run-sessions/${rerun.run_session_id}`).expect(200)).body;
    expect(rerunSession.run_spec.review_context).toEqual({
      latest_decision: 'changes_requested',
      requested_changes: [
        expect.objectContaining({
          title: 'Add rerun evidence',
          file_path: 'tests/smoke/p0-smoke.test.ts',
        }),
      ],
    });

    await approveReviewPacket(app, rerun.workflow_result.reviewPacketId, '2026-05-05T03:00:00.000Z');

    const cockpit = (await request(server).get(`/work-items/${workItem.id}/cockpit`).expect(200)).body;
    expect(cockpit.run_sessions.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining([firstRun.run_session_id, rerun.run_session_id]),
    );
    expect(cockpit.review_packets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstRun.workflow_result.reviewPacketId, decision: 'changes_requested' }),
        expect.objectContaining({ id: rerun.workflow_result.reviewPacketId, decision: 'approved' }),
      ]),
    );
    expect(cockpit.packages[0]).toMatchObject({ gate_state: 'review_approved', resolution: 'completed' });
  });

  it('archives the open review packet when force-rerun creates replacement run evidence before a decision', async () => {
    const server = app.getHttpServer();
    const { planRevisionId } = await createApprovedSpecAndPlan(app, 'test_refactor');
    const executionPackage = await createReadyPackage(app, planRevisionId, 'Refresh P0 smoke coverage.');

    const firstRun = await runPackage(app, executionPackage.id);
    const forceRun = await runPackage(app, executionPackage.id, 'force-rerun', {
      previous_run_session_id: firstRun.run_session_id,
      force: true,
      force_reason: 'Replace stale packet before human review.',
    });

    expect(forceRun.run_session_id).not.toBe(firstRun.run_session_id);
    expect(forceRun.workflow_result.reviewPacketId).not.toBe(firstRun.workflow_result.reviewPacketId);

    const archivedPacket = (await request(server).get(`/review-packets/${firstRun.workflow_result.reviewPacketId}`).expect(200)).body;
    const replacementPacket = (await request(server).get(`/review-packets/${forceRun.workflow_result.reviewPacketId}`).expect(200)).body;
    expect(archivedPacket).toMatchObject({ status: 'archived', decision: 'none' });
    expect(replacementPacket).toMatchObject({ status: 'ready', decision: 'none' });

    await approveReviewPacket(app, replacementPacket.id, '2026-05-05T04:00:00.000Z');
    const replacementRunSession = (await request(server).get(`/run-sessions/${forceRun.run_session_id}`).expect(200)).body;
    expect(replacementRunSession).toMatchObject({
      status: 'succeeded',
      executor_result: { status: 'succeeded' },
    });
  });
});
