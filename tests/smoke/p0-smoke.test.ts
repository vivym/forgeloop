import { setTimeout as delay } from 'node:timers/promises';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { P0Service, RUN_WORKER } from '../../apps/control-plane-api/src/p0/p0.service';
import type { ReviewPacket, RunSession } from '../../packages/domain/src';
import type { RunWorker } from '../../packages/run-worker/src';

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

type PublicRunEvent = {
  event_type: string;
};

const createApprovedSpecAndPlan = async (
  app: INestApplication,
  kind: 'requirement' | 'bug' | 'tech_debt' = 'requirement',
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

const expectAcceptedRunWithVisibleLiveEvent = async (
  app: INestApplication,
  run: Record<string, unknown>,
): Promise<{ run_session_id: string }> => {
  expect(run).toMatchObject({ status: 'accepted', run_session_id: expect.any(String) });
  expect(run).not.toHaveProperty('workflow_result');

  const runSessionId = run.run_session_id;
  if (typeof runSessionId !== 'string') {
    throw new Error('Run response did not include a run_session_id');
  }

  const events = (
    await request(app.getHttpServer()).get(`/run-sessions/${runSessionId}/events`).query({ actor_id: actorOwner }).expect(200)
  ).body.events as PublicRunEvent[];
  expect(events.map((event) => event.event_type)).toEqual(expect.arrayContaining(['run_queued']));
  expect(events.some((event) => event.event_type === 'run_queued' || event.event_type === 'driver_started')).toBe(true);

  return { run_session_id: runSessionId };
};

const repositoryFor = (app: INestApplication) =>
  (app.get(P0Service) as unknown as {
    repository: {
      getRunSession(runSessionId: string): Promise<RunSession | undefined>;
      listReviewPacketsForPackage(executionPackageId: string): Promise<ReviewPacket[]>;
    };
  }).repository;

const waitForReviewPacket = async (app: INestApplication, runSessionId: string): Promise<ReviewPacket> => {
  const worker = app.get(RUN_WORKER) as RunWorker;
  const repository = repositoryFor(app);
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
    const acceptedRun = await expectAcceptedRunWithVisibleLiveEvent(app, run);
    const reviewPacketId = (await waitForReviewPacket(app, acceptedRun.run_session_id)).id;
    expect(reviewPacketId).toEqual(expect.stringContaining('review-packet'));

    const runSession = (await request(server).get(`/run-sessions/${acceptedRun.run_session_id}`).expect(200)).body;
    expect(runSession).toMatchObject({
      status: 'succeeded',
      executor_type: 'mock',
    });
    expect(runSession).not.toHaveProperty('run_spec');
    expect(await repositoryFor(app).getRunSession(acceptedRun.run_session_id)).toMatchObject({
      run_spec: {
        spec_revision_id: specRevisionId,
        plan_revision_id: planRevisionId,
        workflow_only: true,
      },
      artifacts: expect.arrayContaining([expect.objectContaining({ kind: 'diff' })]),
    });
    expect(runSession.changed_files).not.toHaveLength(0);
    expect(runSession.check_results).toEqual([expect.objectContaining({ check_id: 'smoke', status: 'succeeded' })]);
    expect(runSession.artifacts).toEqual([]);

    const reviewPacket = (await request(server).get(`/review-packets/${reviewPacketId}`).expect(200)).body;
    expect(reviewPacket).toMatchObject({
      status: 'ready',
      decision: 'none',
      spec_revision_id: specRevisionId,
      plan_revision_id: planRevisionId,
    });
    expect(reviewPacket.changed_files).toEqual(runSession.changed_files);

    await approveReviewPacket(app, reviewPacket.id);

    const cockpit = (await request(server).get(`/query/work-item-cockpit/${workItem.id}`).expect(200)).body;
    expect(cockpit.packages[0]).toMatchObject({
      id: executionPackage.id,
      phase: 'release',
      gate_state: 'release_ready',
      resolution: 'completed',
    });
    expect(cockpit.review_packets[0]).toMatchObject({ id: reviewPacket.id, status: 'completed', decision: 'approved' });

    const timeline = (await request(server).get(`/query/replay/work_item/${workItem.id}`).expect(200)).body;
    const timelineSources = timeline.map((entry: { source: string }) => entry.source);
    expect(timelineSources).toEqual(expect.arrayContaining(['object_event', 'status_history', 'decision']));
    expect(timelineSources).not.toContain('artifact');
  });

  it('records changes_requested, reruns with a new run session and review packet, then approves the rerun', async () => {
    const server = app.getHttpServer();
    const { workItem, planRevisionId } = await createApprovedSpecAndPlan(app, 'bug');
    const executionPackage = await createReadyPackage(app, planRevisionId, 'Fix the P0 smoke bug.');

    const firstRun = await runPackage(app, executionPackage.id);
    const firstAcceptedRun = await expectAcceptedRunWithVisibleLiveEvent(app, firstRun);
    const firstReviewPacketId = (await waitForReviewPacket(app, firstAcceptedRun.run_session_id)).id;
    await request(server)
      .post(`/review-packets/${firstReviewPacketId}/request-changes`)
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

    const rerun = await runPackage(app, executionPackage.id, 'rerun', { previous_run_session_id: firstAcceptedRun.run_session_id });
    const acceptedRerun = await expectAcceptedRunWithVisibleLiveEvent(app, rerun);
    const rerunReviewPacketId = (await waitForReviewPacket(app, acceptedRerun.run_session_id)).id;
    expect(acceptedRerun.run_session_id).not.toBe(firstAcceptedRun.run_session_id);
    expect(rerunReviewPacketId).not.toBe(firstReviewPacketId);

    const rerunSession = (await request(server).get(`/run-sessions/${acceptedRerun.run_session_id}`).expect(200)).body;
    expect(rerunSession).not.toHaveProperty('run_spec');
    expect((await repositoryFor(app).getRunSession(acceptedRerun.run_session_id))?.run_spec?.review_context).toEqual({
      latest_decision: 'changes_requested',
      requested_changes: [
        expect.objectContaining({
          title: 'Add rerun evidence',
          file_path: 'tests/smoke/p0-smoke.test.ts',
        }),
      ],
    });

    await approveReviewPacket(app, rerunReviewPacketId, '2026-05-05T03:00:00.000Z');

    const cockpit = (await request(server).get(`/query/work-item-cockpit/${workItem.id}`).expect(200)).body;
    expect(cockpit.run_sessions.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining([firstAcceptedRun.run_session_id, acceptedRerun.run_session_id]),
    );
    expect(cockpit.review_packets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstReviewPacketId, decision: 'changes_requested' }),
        expect.objectContaining({ id: rerunReviewPacketId, decision: 'approved' }),
      ]),
    );
    expect(cockpit.packages[0]).toMatchObject({ phase: 'release', gate_state: 'release_ready', resolution: 'completed' });
  });

  it('archives the open review packet when force-rerun creates replacement run evidence before a decision', async () => {
    const server = app.getHttpServer();
    const { planRevisionId } = await createApprovedSpecAndPlan(app, 'tech_debt');
    const executionPackage = await createReadyPackage(app, planRevisionId, 'Refresh P0 smoke coverage.');

    const firstRun = await runPackage(app, executionPackage.id);
    const firstAcceptedRun = await expectAcceptedRunWithVisibleLiveEvent(app, firstRun);
    const firstReviewPacketId = (await waitForReviewPacket(app, firstAcceptedRun.run_session_id)).id;
    const forceRun = await runPackage(app, executionPackage.id, 'force-rerun', {
      previous_run_session_id: firstAcceptedRun.run_session_id,
      force: true,
      force_reason: 'Replace stale packet before human review.',
    });
    const acceptedForceRun = await expectAcceptedRunWithVisibleLiveEvent(app, forceRun);
    const forceReviewPacketId = (await waitForReviewPacket(app, acceptedForceRun.run_session_id)).id;

    expect(acceptedForceRun.run_session_id).not.toBe(firstAcceptedRun.run_session_id);
    expect(forceReviewPacketId).not.toBe(firstReviewPacketId);

    const archivedPacket = (await request(server).get(`/review-packets/${firstReviewPacketId}`).expect(200)).body;
    const replacementPacket = (await request(server).get(`/review-packets/${forceReviewPacketId}`).expect(200)).body;
    expect(archivedPacket).toMatchObject({ status: 'archived', decision: 'none' });
    expect(replacementPacket).toMatchObject({ status: 'ready', decision: 'none' });

    await approveReviewPacket(app, replacementPacket.id, '2026-05-05T04:00:00.000Z');
    const replacementRunSession = (await request(server).get(`/run-sessions/${acceptedForceRun.run_session_id}`).expect(200)).body;
    expect(replacementRunSession).toMatchObject({
      status: 'succeeded',
      executor_result: { status: 'succeeded' },
    });
  });
});
