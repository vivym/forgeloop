import { setTimeout as delay } from 'node:timers/promises';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ExecutorResult, SelfReviewInput, SelfReviewResult } from '@forgeloop/contracts';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { actorClassHeaderName, actorHeaderName } from '../../apps/control-plane-api/src/modules/auth/actor-context';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { RunWorkerLifecycleService } from '../../apps/control-plane-api/src/modules/run-control/run-worker-lifecycle.service';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import type { InMemoryDeliveryRepository } from '../../packages/db/src';
import type { ReviewPacket, RunSession } from '../../packages/domain/src';
import { FakeCodexSessionDriver, RunWorker } from '../../packages/run-worker/src';
import { seedItemScopedSpecPlan } from '../helpers/item-scoped-artifact-fixtures';
import { createWorkflowPolicyRepoRoot } from '../helpers/runtime-policy-repo';

const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const actorQa = 'actor-qa';
const ownerHeaders = { [actorHeaderName]: actorOwner, [actorClassHeaderName]: 'human_admin' };
const reviewerHeaders = { [actorHeaderName]: actorReviewer, [actorClassHeaderName]: 'human' };
const repoId = 'repo-1';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const intakeContextByKind = {
  requirement: {
    type: 'requirement',
    stakeholder_problem: 'Smoke delivery fixtures need typed intake context.',
    desired_outcome: 'The smoke loop can create a valid requirement Work Item.',
    acceptance_criteria: ['Spec, plan, package, run, review, and timeline evidence are persisted.'],
    in_scope: ['Delivery smoke workflow'],
  },
  bug: {
    type: 'bug',
    impact_summary: 'The smoke loop must handle bug Work Items.',
    observed_behavior: 'Legacy fixtures omitted typed intake context.',
    expected_behavior: 'Bug smoke fixtures create valid Work Items.',
    reproduction_steps: ['Create a bug smoke Work Item', 'Run the delivery loop'],
    affected_environment: 'delivery smoke test',
    verification_path: 'Delivery smoke assertions',
  },
  tech_debt: {
    type: 'tech_debt',
    current_pain: 'The smoke loop must handle technical debt Work Items.',
    desired_invariant: 'Tech debt smoke fixtures use typed intake context.',
    affected_modules: ['delivery-smoke.test.ts'],
    behavior_preservation: 'Existing smoke workflow assertions still pass.',
    validation_strategy: 'Focused delivery smoke test',
  },
} as const;

const requiredChecks = [
  {
    check_id: 'smoke',
    display_name: 'Delivery smoke',
    command: 'pnpm smoke:delivery',
    timeout_seconds: 120,
    blocks_review: true,
  },
];

const safePathSegment = (value: string): string => {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.\.+/g, '-')
    .replace(/^\.+/, '')
    .replace(/^-+|-+$/g, '');

  return sanitized.length > 0 ? sanitized : 'artifact';
};

const evidenceChangedFilePath = (allowedPaths: string[]): string => {
  const firstAllowedPath = allowedPaths[0] ?? 'forgeloop-generated.txt';
  return firstAllowedPath.replace(/\/\*\*$/, '/forgeloop-generated.txt').replace(/\*+$/, 'forgeloop-generated.txt');
};

const mockSelfReview = (input: SelfReviewInput): SelfReviewResult => ({
  status: 'succeeded',
  summary: `Smoke self-review completed for run ${input.run_session_id}.`,
  spec_plan_alignment: 'The smoke run uses the approved spec and plan revision ids.',
  test_assessment: `${input.check_results.length} required checks were reported.`,
  risk_notes: [],
  follow_up_questions: [],
});

const mockEvidence = (input: Parameters<ConstructorParameters<typeof RunWorker>[0]['evidenceCollector']>[0]): ExecutorResult => ({
  run_session_id: input.runSpec.run_session_id,
  executor_type: input.runSpec.executor_type,
  executor_version: 'delivery-smoke-test-driver',
  status: 'succeeded',
  started_at: input.startedAt,
  finished_at: input.startedAt,
  summary: input.summary,
  changed_files: [
    {
      repo_id: input.runSpec.repo.repo_id,
      path: evidenceChangedFilePath(input.runSpec.allowed_paths),
      change_kind: 'modified',
    },
  ],
  checks: input.runSpec.required_checks.map((check) => ({
    check_id: check.check_id,
    command: check.command,
    status: 'succeeded',
    exit_code: 0,
    duration_seconds: 0,
    blocks_review: check.blocks_review,
  })),
  artifacts: [...new Set(input.runSpec.artifact_policy.requested_artifacts)].map((kind) => ({
    kind,
    name: `${kind}.txt`,
    content_type: 'text/plain',
    local_ref: `/tmp/forgeloop-delivery-smoke/${safePathSegment(input.runSpec.run_session_id)}/${kind}.txt`,
  })),
  raw_metadata: { workflow_only: input.runSpec.workflow_only },
});

class ManualDrainRunWorker extends RunWorker {
  override kick(): void {
    return undefined;
  }
}

const createTestRunWorker = (repository: InMemoryDeliveryRepository): RunWorker =>
  new ManualDrainRunWorker({
    repository,
    workerId: 'delivery-smoke-test-worker',
    driverFactory: () =>
      new FakeCodexSessionDriver({
        kind: 'fake',
        script: [{ kind: 'terminal', status: 'succeeded', summary: 'Smoke fake driver completed.' }],
      }),
    evidenceCollector: (input) => Promise.resolve(mockEvidence(input)),
    selfReview: (input) => Promise.resolve(mockSelfReview(input)),
    heartbeatIntervalMs: 1,
    commandPollIntervalMs: 1,
    leaseDurationMs: 1_000,
    idleThresholdMs: 1_000,
    artifactRoot: '/tmp/forgeloop-delivery-smoke',
  });

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
    await request(server).post('/projects').send({ name: `Delivery smoke ${kind}`, owner_actor_id: actorOwner }).expect(201)
  ).body;

  await request(server)
    .post(`/projects/${project.id}/repos`)
    .send({
      repo_id: repoId,
      name: 'forgeloop',
      local_path: await createWorkflowPolicyRepoRoot(),
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
        title: `Delivery ${kind} smoke item`,
        goal: 'Exercise the approved delivery loop.',
        success_criteria: ['Spec, plan, package, run, review, and timeline evidence are persisted.'],
        priority: 'P0',
        risk: 'medium',
        driver_actor_id: actorOwner,
        intake_context: intakeContextByKind[kind],
      })
      .expect(201)
  ).body;

  const { specRevision, planRevision } = await seedItemScopedSpecPlan(app, workItem.id, {
    actorId: actorOwner,
    reviewerActorId: actorReviewer,
  });

  return {
    project,
    workItem,
    specRevisionId: specRevision.id,
    planRevisionId: planRevision!.id,
  };
};

const createReadyPackage = async (app: INestApplication, planRevisionId: string, objective = 'Deliver the Delivery smoke package.') => {
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

  await request(server)
    .post(`/execution-packages/${executionPackage.id}/mark-ready`)
    .set(ownerHeaders)
    .send({ actor_id: actorOwner, expected_package_version: executionPackage.version })
    .expect(201);

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
      .set(ownerHeaders)
      .send({ workflow_only: true, ...body })
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
    await request(app.getHttpServer()).get(`/run-sessions/${runSessionId}/events`).set(ownerHeaders).expect(200)
  ).body.events as PublicRunEvent[];
  expect(events.map((event) => event.event_type)).toEqual(expect.arrayContaining(['run_queued']));
  expect(events.some((event) => event.event_type === 'run_queued' || event.event_type === 'driver_started')).toBe(true);

  return { run_session_id: runSessionId };
};

const repositoryFor = (app: INestApplication) =>
  app.get(DELIVERY_REPOSITORY) as {
    getRunSession(runSessionId: string): Promise<RunSession | undefined>;
    listReviewPacketsForPackage(executionPackageId: string): Promise<ReviewPacket[]>;
  };

const waitForReviewPacket = async (app: INestApplication, runSessionId: string): Promise<ReviewPacket> => {
  const worker = app.get(DELIVERY_RUN_WORKER) as RunWorker;
  const repository = repositoryFor(app);
  await worker.drainOnce();

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
    .set(reviewerHeaders)
    .send({
      summary: 'Approved for delivery handoff.',
      reviewed_by_actor_id: actorReviewer,
      reviewed_at: reviewedAt,
    })
    .expect(201);

describe('Delivery smoke delivery loop', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RunWorkerLifecycleService)
      .useValue({ onModuleInit: () => undefined, onModuleDestroy: () => undefined })
      .overrideProvider(DELIVERY_RUN_WORKER)
      .useFactory({
        inject: [DELIVERY_REPOSITORY],
        factory: (repository: InMemoryDeliveryRepository) => createTestRunWorker(repository),
      })
      .compile();
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
    expect(reviewPacketId).toMatch(uuidPattern);

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

    const updatedPackage = (await request(server).get(`/execution-packages/${executionPackage.id}`).expect(200)).body;
    expect(updatedPackage).toMatchObject({
      id: executionPackage.id,
      phase: 'release',
      gate_state: 'release_ready',
      resolution: 'completed',
    });
    const updatedReview = (await request(server).get(`/review-packets/${reviewPacket.id}`).expect(200)).body;
    expect(updatedReview).toMatchObject({ id: reviewPacket.id, status: 'completed', decision: 'approved' });
    await request(server).get(`/query/work-item-cockpit/${workItem.id}`).expect(404);
    await request(server).get(`/query/replay/work_item/${workItem.id}`).expect(404);
  });

  it('records changes_requested, reruns with a new run session and review packet, then approves the rerun', async () => {
    const server = app.getHttpServer();
    const { workItem, planRevisionId } = await createApprovedSpecAndPlan(app, 'bug');
    const executionPackage = await createReadyPackage(app, planRevisionId, 'Fix the Delivery smoke bug.');

    const firstRun = await runPackage(app, executionPackage.id);
    const firstAcceptedRun = await expectAcceptedRunWithVisibleLiveEvent(app, firstRun);
    const firstReviewPacketId = (await waitForReviewPacket(app, firstAcceptedRun.run_session_id)).id;
    await request(server)
      .post(`/review-packets/${firstReviewPacketId}/request-changes`)
      .set(reviewerHeaders)
      .send({
        summary: 'Tighten the validation evidence.',
        reviewed_by_actor_id: actorReviewer,
        reviewed_at: '2026-05-05T02:00:00.000Z',
        requested_changes: [
          {
            title: 'Add rerun evidence',
            description: 'Show that review feedback is carried into the replacement run.',
            file_path: 'tests/smoke/delivery-smoke.test.ts',
            severity: 'major',
            suggested_validation: 'pnpm smoke:delivery',
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
          file_path: 'tests/smoke/delivery-smoke.test.ts',
        }),
      ],
    });

    await approveReviewPacket(app, rerunReviewPacketId, '2026-05-05T03:00:00.000Z');

    await request(server).get(`/run-sessions/${firstAcceptedRun.run_session_id}`).expect(200);
    await request(server).get(`/run-sessions/${acceptedRerun.run_session_id}`).expect(200);
    expect((await request(server).get(`/review-packets/${firstReviewPacketId}`).expect(200)).body).toMatchObject({
      id: firstReviewPacketId,
      decision: 'changes_requested',
    });
    expect((await request(server).get(`/review-packets/${rerunReviewPacketId}`).expect(200)).body).toMatchObject({
      id: rerunReviewPacketId,
      decision: 'approved',
    });
    expect((await request(server).get(`/execution-packages/${executionPackage.id}`).expect(200)).body).toMatchObject({
      phase: 'release',
      gate_state: 'release_ready',
      resolution: 'completed',
    });
    await request(server).get(`/query/work-item-cockpit/${workItem.id}`).expect(404);
  });

  it('archives the open review packet when force-rerun creates replacement run evidence before a decision', async () => {
    const server = app.getHttpServer();
    const { planRevisionId } = await createApprovedSpecAndPlan(app, 'tech_debt');
    const executionPackage = await createReadyPackage(app, planRevisionId, 'Refresh Delivery smoke coverage.');

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
