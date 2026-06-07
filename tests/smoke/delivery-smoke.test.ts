import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { actorClassHeaderName, actorHeaderName } from '../../apps/control-plane-api/src/modules/auth/actor-context';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { RunWorkerLifecycleService } from '../../apps/control-plane-api/src/modules/run-control/run-worker-lifecycle.service';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import type { InMemoryDeliveryRepository } from '../../packages/db/src';
import { seedItemScopedSpecPlan } from '../helpers/item-scoped-artifact-fixtures';
import { createWorkflowPolicyRepoRoot } from '../helpers/runtime-policy-repo';

const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const actorQa = 'actor-qa';
const ownerHeaders = { [actorHeaderName]: actorOwner, [actorClassHeaderName]: 'human_admin' };
const repoId = 'repo-1';
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

type SmokeContext = {
  project: { id: string };
  workItem: { id: string };
  specRevisionId: string;
  planRevisionId: string;
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

const expectPublicPackageRunDisabled = async (
  app: INestApplication,
  executionPackageId: string,
  path: 'run' | 'rerun' | 'force-rerun',
  body: Record<string, unknown> = {},
) => {
  const response = await request(app.getHttpServer())
    .post(`/execution-packages/${executionPackageId}/${path}`)
    .set(ownerHeaders)
    .send({ workflow_only: true, ...body })
    .expect(410);
  expect(response.body).toMatchObject({
    code: 'legacy_execution_entrypoint_disabled',
  });
};

const repositoryFor = (app: INestApplication) =>
  app.get(DELIVERY_REPOSITORY) as {
    listRunSessionsForPackage(executionPackageId: string): Promise<unknown[]>;
    listReviewPacketsForPackage(executionPackageId: string): Promise<unknown[]>;
  };

const expectNoExecutionRuntimeSideEffects = async (app: INestApplication, executionPackageId: string) => {
  const repository = repositoryFor(app);
  await expect(repository.listRunSessionsForPackage(executionPackageId)).resolves.toHaveLength(0);
  await expect(repository.listReviewPacketsForPackage(executionPackageId)).resolves.toHaveLength(0);
};

const expectPackageStillReady = async (app: INestApplication, executionPackageId: string) => {
  await request(app.getHttpServer()).get(`/execution-packages/${executionPackageId}`).expect(200).expect(({ body }) => {
    expect(body).toMatchObject({
      id: executionPackageId,
      phase: 'ready',
      activity_state: 'idle',
      gate_state: 'not_submitted',
      resolution: 'none',
    });
  });
};

describe('Delivery smoke delivery loop', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RunWorkerLifecycleService)
      .useValue({ onModuleInit: () => undefined, onModuleDestroy: () => undefined })
      .overrideProvider(DELIVERY_RUN_WORKER)
      .useValue({ kick: () => undefined, drainOnce: async () => undefined })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('keeps public package run disabled and leaves ready package state untouched', async () => {
    const { planRevisionId } = await createApprovedSpecAndPlan(app);
    const executionPackage = await createReadyPackage(app, planRevisionId);

    await expectPublicPackageRunDisabled(app, executionPackage.id, 'run');
    await expectNoExecutionRuntimeSideEffects(app, executionPackage.id);
    await expectPackageStillReady(app, executionPackage.id);
  });

  it('keeps public package rerun disabled and does not create replacement evidence', async () => {
    const { planRevisionId } = await createApprovedSpecAndPlan(app, 'bug');
    const executionPackage = await createReadyPackage(app, planRevisionId, 'Fix the Delivery smoke bug.');

    await expectPublicPackageRunDisabled(app, executionPackage.id, 'rerun', {
      previous_run_session_id: 'run-session-seeded',
    });
    await expectNoExecutionRuntimeSideEffects(app, executionPackage.id);
    await expectPackageStillReady(app, executionPackage.id);
  });

  it('keeps public package force-rerun disabled without archiving review evidence', async () => {
    const { planRevisionId } = await createApprovedSpecAndPlan(app, 'tech_debt');
    const executionPackage = await createReadyPackage(app, planRevisionId, 'Refresh Delivery smoke coverage.');

    await expectPublicPackageRunDisabled(app, executionPackage.id, 'force-rerun', {
      previous_run_session_id: 'run-session-seeded',
      force: true,
      force_reason: 'Public force-rerun must stay closed in Wave 5.',
    });
    await expectNoExecutionRuntimeSideEffects(app, executionPackage.id);
    await expectPackageStillReady(app, executionPackage.id);
  });
});
