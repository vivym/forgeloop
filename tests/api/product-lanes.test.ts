import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExecutionPackage, ExecutionPackageDependency, Release, ReviewPacket, RunSession, SpecRevision } from '@forgeloop/domain';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import {
  getProductLane,
  getWorkItemActions,
  InMemoryDeliveryRepository,
  resolveLaneFilters,
} from '../../packages/db/src/index';
import { seedReadyExecutionPackageThroughApi, succeededSelfReview } from '../helpers/delivery-runtime-fixtures';

const now = '2026-05-05T00:00:00.000Z';
const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const actorQa = 'actor-qa';
const ownerHeaders = { 'x-forgeloop-actor-id': actorOwner, 'x-forgeloop-actor-class': 'human_admin' };
const reviewerHeaders = { 'x-forgeloop-actor-id': actorReviewer, 'x-forgeloop-actor-class': 'human' };
const cockpitOptions = {
  run_session_metadata_fallback: {
    driver: 'fake' as const,
    workflow_only: false,
    executor_type: 'mock' as const,
  },
};

const createTestApp = async (): Promise<{ app: INestApplication; repo: InMemoryDeliveryRepository }> => {
  const repo = new InMemoryDeliveryRepository();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DELIVERY_REPOSITORY)
    .useValue(repo)
    .overrideProvider(DELIVERY_RUN_WORKER)
    .useValue({ kick: () => undefined, drainOnce: async () => undefined })
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();

  return { app, repo };
};

const seedDraftWorkItem = async (
  app: INestApplication,
  kind: 'initiative' | 'requirement' | 'bug' | 'tech_debt' = 'bug',
) => {
  const server = app.getHttpServer();
  const project = (await request(server).post('/projects').send({ name: 'Product Lane Project', owner_actor_id: actorOwner }).expect(201))
    .body;

  await request(server)
    .post(`/projects/${project.id}/repos`)
    .send({
      repo_id: `repo-${kind}`,
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
        title: `Triage ${kind} product lane item`,
        goal: 'Exercise the product lane projection.',
        success_criteria: ['The item appears in the lane.'],
        priority: 'P1',
        risk: kind === 'bug' ? 'high' : 'medium',
        owner_actor_id: actorOwner,
      })
      .expect(201)
  ).body;

  return { project, workItem };
};

const seedSubmittedSpec = async (app: INestApplication) => {
  const { project, workItem } = await seedDraftWorkItem(app, 'requirement');
  const server = app.getHttpServer();
  const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;

  await request(server).post(`/specs/${spec.id}/generate-draft`).send({}).expect(201);
  await request(server).post(`/specs/${spec.id}/submit-for-approval`).set(ownerHeaders).send({ actor_id: actorOwner }).expect(201);

  return { project, workItem, spec };
};

const seedSubmittedPlan = async (app: INestApplication) => {
  const { project, workItem } = await seedDraftWorkItem(app, 'requirement');
  const server = app.getHttpServer();
  const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;

  await request(server).post(`/specs/${spec.id}/generate-draft`).send({}).expect(201);
  await request(server).post(`/specs/${spec.id}/submit-for-approval`).set(ownerHeaders).send({ actor_id: actorOwner }).expect(201);
  await request(server).post(`/specs/${spec.id}/approve`).set(reviewerHeaders).send({ actor_id: actorReviewer }).expect(201);

  const plan = (await request(server).post(`/work-items/${workItem.id}/plans`).send({}).expect(201)).body;
  await request(server).post(`/plans/${plan.id}/generate-draft`).send({}).expect(201);
  await request(server).post(`/plans/${plan.id}/submit-for-approval`).set(ownerHeaders).send({ actor_id: actorOwner }).expect(201);

  return { project, workItem, plan };
};

const seedApprovedPlanWithoutPackages = async (app: INestApplication) => {
  const { workItem } = await seedDraftWorkItem(app, 'requirement');
  const server = app.getHttpServer();
  const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;

  await request(server).post(`/specs/${spec.id}/generate-draft`).send({}).expect(201);
  await request(server).post(`/specs/${spec.id}/submit-for-approval`).set(ownerHeaders).send({ actor_id: actorOwner }).expect(201);
  await request(server).post(`/specs/${spec.id}/approve`).set(reviewerHeaders).send({ actor_id: actorReviewer }).expect(201);

  const plan = (await request(server).post(`/work-items/${workItem.id}/plans`).send({}).expect(201)).body;
  const planRevision = (await request(server).post(`/plans/${plan.id}/generate-draft`).send({}).expect(201)).body;

  await request(server).post(`/plans/${plan.id}/submit-for-approval`).set(ownerHeaders).send({ actor_id: actorOwner }).expect(201);
  await request(server).post(`/plans/${plan.id}/approve`).set(reviewerHeaders).send({ actor_id: actorReviewer }).expect(201);

  return { workItem, planRevision };
};

const saveReviewPacket = async (
  repo: InMemoryDeliveryRepository,
  executionPackage: ExecutionPackage,
): Promise<{ runSession: RunSession; reviewPacket: ReviewPacket }> => {
  const runSession: RunSession = {
    id: 'run-session-product-lane-review',
    execution_package_id: executionPackage.id,
    requested_by_actor_id: actorOwner,
    status: 'succeeded',
    executor_type: 'mock',
    changed_files: [{ repo_id: executionPackage.repo_id, path: 'apps/control-plane-api/src/app.module.ts', change_kind: 'modified' }],
    check_results: [
      {
        check_id: executionPackage.required_checks[0]?.check_id ?? 'unit',
        command: executionPackage.required_checks[0]?.command ?? 'pnpm vitest run tests/api/product-lanes.test.ts',
        status: 'succeeded',
        exit_code: 0,
        duration_seconds: 3,
        blocks_review: true,
      },
    ],
    artifacts: [],
    log_refs: [],
    summary: 'Run completed for review.',
    created_at: now,
    updated_at: now,
    finished_at: now,
  };
  const reviewPacket: ReviewPacket = {
    id: 'review-packet-product-lane',
    run_session_id: runSession.id,
    execution_package_id: executionPackage.id,
    reviewer_actor_id: executionPackage.reviewer_actor_id,
    spec_revision_id: executionPackage.spec_revision_id,
    plan_revision_id: executionPackage.plan_revision_id,
    status: 'ready',
    decision: 'none',
    changed_files: [{ repo_id: executionPackage.repo_id, path: 'apps/control-plane-api/src/app.module.ts', change_kind: 'modified' }],
    check_result_summary: 'Required checks passed.',
    self_review: succeededSelfReview(),
    risk_notes: [],
    requested_changes: [
      {
        title: 'Tighten evidence summary',
        description: 'Expose the public-safe check and file summary.',
        file_path: 'tests/api/product-lanes.test.ts',
        severity: 'minor',
      },
    ],
    created_at: now,
    updated_at: now,
  };

  await repo.saveRunSession(runSession);
  await repo.saveReviewPacket(reviewPacket);
  await repo.saveExecutionPackage({
    ...executionPackage,
    current_run_session_id: runSession.id,
    current_review_packet_id: reviewPacket.id,
    phase: 'review',
    activity_state: 'awaiting_human',
    gate_state: 'awaiting_human_review',
    updated_at: now,
  });

  return { runSession, reviewPacket };
};

const seedLinkedRelease = async (app: INestApplication, executionPackage: ExecutionPackage) => {
  const server = app.getHttpServer();
  const release = (
    await request(server)
      .post('/releases')
      .set(ownerHeaders)
      .send({
        actor_id: actorOwner,
        project_id: executionPackage.project_id,
        title: 'Product Lane Release',
        scope_summary: 'Ship the product lane package.',
        rollout_strategy: 'Ship behind a flag.',
        rollback_plan: 'Disable the flag.',
        observation_plan: 'Watch metrics.',
        release_owner_actor_id: actorOwner,
      })
      .expect(201)
  ).body.release;

  await request(server)
    .post(`/releases/${release.id}/work-items/${executionPackage.work_item_id}`)
    .set(ownerHeaders)
    .send({ actor_id: actorOwner })
    .expect(201);
  await request(server)
    .post(`/releases/${release.id}/execution-packages/${executionPackage.id}`)
    .set(ownerHeaders)
    .send({ actor_id: actorOwner })
    .expect(201);

  return release;
};

const collectKeys = (value: unknown, keys = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
    return keys;
  }
  if (typeof value !== 'object' || value === null) {
    return keys;
  }
  Object.entries(value).forEach(([key, child]) => {
    keys.add(key);
    collectKeys(child, keys);
  });
  return keys;
};

describe('product lane projections', () => {
  const apps: INestApplication[] = [];

  const track = async <T extends { app: INestApplication }>(value: Promise<T>): Promise<T> => {
    const resolved = await value;
    apps.push(resolved.app);
    return resolved;
  };

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('serves Product Lane and Work Item actions endpoints and removes old workbench routes', async () => {
    const { app } = await track(createTestApp());
    const { project, workItem } = await seedDraftWorkItem(app);

    const laneResponse = await request(app.getHttpServer())
      .get(`/query/product-lanes/bugs?project_id=${project.id}&kind=bug&limit=5`)
      .expect(200);
    expect(laneResponse.body).toMatchObject({
      lane_id: 'bugs',
      items: [expect.objectContaining({ object: { type: 'work_item', id: workItem.id } })],
    });

    const actionsResponse = await request(app.getHttpServer()).get(`/query/work-items/${workItem.id}/actions?lane=bugs`).expect(200);
    expect(actionsResponse.body).toMatchObject({
      work_item_id: workItem.id,
      lane_id: 'bugs',
      default_lane_id: 'bugs',
    });

    const removedEndpoint = `/query/${'work'}${'benches'}/spec-approver?project_id=${project.id}`;
    await request(app.getHttpServer()).get(removedEndpoint).expect(404);
  });

  it('rejects invalid Product Lane and Work Item actions query parameters', async () => {
    const { app } = await track(createTestApp());
    const { project, workItem } = await seedDraftWorkItem(app);
    const server = app.getHttpServer();

    await request(server).get(`/query/product-lanes/bugs?project_id=${project.id}&kind=requirement`).expect(400);
    await request(server).get(`/query/product-lanes/bugs?project_id=${project.id}&blocked=yes`).expect(400);
    await request(server).get(`/query/product-lanes/bugs?project_id=${project.id}&unknown=value`).expect(400);
    await request(server).get('/query/product-lanes/bugs?project_id=').expect(400);
    await request(server).get(`/query/product-lanes/bugs?project_id=${project.id}&project_id=other-project`).expect(400);
    await request(server).get(`/query/product-lanes/bugs?project_id=${project.id}&limit=1&limit=2`).expect(400);
    await request(server).get(`/query/product-lanes/bugs?project_id[bad]=${project.id}`).expect(400);
    await request(server).get(`/query/product-lanes/unknown?project_id=${project.id}`).expect(400);
    await request(server).get(`/query/product-lanes/bugs?project_id=${project.id}&kind=not-a-kind`).expect(400);
    await request(server)
      .get(`/query/product-lanes/execution-owner?project_id=${project.id}&actor_id=actor-a&owner_actor_id=actor-b`)
      .expect(400);
    await request(server)
      .get(`/query/product-lanes/reviewer?project_id=${project.id}&actor_id=actor-a&reviewer_actor_id=actor-b`)
      .expect(400);
    await request(server)
      .get(`/query/product-lanes/qa-test-owner?project_id=${project.id}&actor_id=actor-a&qa_owner_actor_id=actor-b`)
      .expect(400);
    await request(server)
      .get(`/query/product-lanes/release-owner?project_id=${project.id}&actor_id=actor-a&release_owner_actor_id=actor-b`)
      .expect(400);

    await request(server).get(`/query/work-items/${workItem.id}/actions?lane=`).expect(400);
    await request(server).get(`/query/work-items/${workItem.id}/actions?lane=bugs&lane=reviewer`).expect(400);
    await request(server).get(`/query/work-items/${workItem.id}/actions?foo=bar`).expect(400);
    await request(server).get(`/query/work-items/${workItem.id}/actions?lane=unknown`).expect(400);
  });

  it('returns work item type lanes as strict ProductLaneResponse DTOs', async () => {
    const { app, repo } = await track(createTestApp());
    const seeded = [
      await seedDraftWorkItem(app, 'requirement'),
      await seedDraftWorkItem(app, 'bug'),
      await seedDraftWorkItem(app, 'tech_debt'),
      await seedDraftWorkItem(app, 'initiative'),
    ];

    const lanes = [
      { lane: 'requirements' as const, kind: 'requirement', seeded: seeded[0] },
      { lane: 'bugs' as const, kind: 'bug', seeded: seeded[1] },
      { lane: 'tech-debt' as const, kind: 'tech_debt', seeded: seeded[2] },
      { lane: 'initiatives' as const, kind: 'initiative', seeded: seeded[3] },
    ];

    for (const { lane, kind, seeded: laneSeed } of lanes) {
      const filters = resolveLaneFilters(lane, {
        project_id: laneSeed.project.id,
        kind,
        owner_actor_id: actorOwner,
        reviewer_actor_id: actorReviewer,
        limit: 5,
      });

      expect(filters.conflicts).toEqual([]);
      expect(filters.unsupported_filters).toEqual(['reviewer_actor_id']);

      const response = await getProductLane(repo, lane, filters);

      expect(response).toMatchObject({
        lane_id: lane,
        unsupported_filters: ['reviewer_actor_id'],
        summary: { total: 1, blocked: 0, high_risk: kind === 'bug' ? 1 : 0, stale: expect.any(Number) },
      });
      expect(response.items[0]).toMatchObject({
        id: laneSeed.workItem.id,
        kind,
        object: { type: 'work_item', id: laneSeed.workItem.id },
        actions: [
          expect.objectContaining({
            lane_id: lane,
            kind: 'navigate',
            priority: 'primary',
            enabled: true,
            target: expect.objectContaining({ kind: 'object', object_type: 'work_item', object_id: laneSeed.workItem.id }),
          }),
        ],
      });
    }
  });

  it('returns product lanes for approval execution review QA release and manager surfaces', async () => {
    const { app, repo } = await track(createTestApp());
    const { project, spec } = await seedSubmittedSpec(app);
    const server = app.getHttpServer();
    const currentSpec = await repo.getSpec(spec.id);
    const currentRevision = (await repo.getSpecRevision(currentSpec?.current_revision_id ?? 'missing')) as SpecRevision;
    await repo.saveSpecRevision({
      ...currentRevision,
      summary: 'Current changes-requested spec revision',
      test_strategy_summary: 'Run API product lane tests.',
      risk_notes: ['Approval should verify product lane projections.'],
    });
    await request(server)
      .post(`/specs/${spec.id}/request-changes`)
      .set(reviewerHeaders)
      .send({ actor_id: actorReviewer, rationale: 'Verify product lane projections before approval.' })
      .expect(201);

    const executionPackage = await seedReadyExecutionPackageThroughApi(app);
    const upstreamPackage: ExecutionPackage = {
      ...executionPackage,
      id: 'execution-package-product-lane-upstream',
      objective: 'Prepare upstream dependency.',
      phase: 'ready',
      gate_state: 'not_submitted',
      current_run_session_id: undefined,
      last_run_session_id: undefined,
      current_review_packet_id: undefined,
      updated_at: now,
    };
    const dependency: ExecutionPackageDependency = {
      package_id: executionPackage.id,
      depends_on_package_id: upstreamPackage.id,
      dependency_type: 'blocks_run_enqueue',
      reason: 'Upstream package must complete first.',
      created_at: now,
      updated_at: now,
    };
    await repo.saveExecutionPackage(upstreamPackage);
    await repo.saveExecutionPackageDependency(dependency);
    const { reviewPacket } = await saveReviewPacket(repo, executionPackage);
    const release = await seedLinkedRelease(app, executionPackage);
    const olderRelease: Release = {
      ...release,
      id: 'release-product-lane-older',
      title: 'Older Product Lane Release',
      updated_at: '2026-05-04T00:00:00.000Z',
    };
    const newerRelease: Release = {
      ...release,
      id: 'release-product-lane-newer',
      title: 'Newer Product Lane Release',
      updated_at: '2026-05-06T00:00:00.000Z',
    };
    await repo.saveRelease({
      ...release,
      updated_at: '2026-05-05T00:00:00.000Z',
    });
    await repo.saveRelease(olderRelease);
    await repo.saveRelease(newerRelease);
    const secondaryQaOwner = 'actor-qa-secondary';
    const secondaryQaPackage: ExecutionPackage = {
      ...executionPackage,
      id: 'execution-package-secondary-qa-owner',
      objective: 'Validate secondary QA owner filtering.',
      qa_owner_actor_id: secondaryQaOwner,
      updated_at: now,
    };
    await repo.saveExecutionPackage(secondaryQaPackage);
    await repo.saveRelease({
      ...release,
      execution_package_ids: [executionPackage.id, secondaryQaPackage.id],
      updated_at: now,
    });

    const specLane = await getProductLane(
      repo,
      'spec-approver',
      resolveLaneFilters('spec-approver', { project_id: project.id, status: 'changes_requested' }),
    );
    expect(specLane.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object: { type: 'spec', id: spec.id },
          status: 'changes_requested',
          actions: expect.arrayContaining([
            expect.objectContaining({
              kind: 'navigate',
              target: expect.objectContaining({ kind: 'object', object_type: 'spec', object_id: spec.id }),
            }),
          ]),
        }),
      ]),
    );
    await expect(
      getProductLane(repo, 'spec-approver', resolveLaneFilters('spec-approver', { project_id: project.id, actor_id: actorReviewer })),
    ).resolves.toMatchObject({ summary: expect.objectContaining({ total: 1 }) });
    await expect(
      getProductLane(repo, 'spec-approver', resolveLaneFilters('spec-approver', { project_id: project.id, actor_id: actorOwner })),
    ).resolves.toMatchObject({ summary: expect.objectContaining({ total: 0 }) });

    const executionLane = await getProductLane(
      repo,
      'execution-owner',
      resolveLaneFilters('execution-owner', { project_id: executionPackage.project_id, actor_id: actorOwner }),
    );
    expect(executionLane.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object: { type: 'execution_package', id: upstreamPackage.id },
          actions: expect.arrayContaining([
            expect.objectContaining({
              kind: 'command',
              command: expect.objectContaining({ type: 'run_package', package_id: upstreamPackage.id }),
            }),
          ]),
        }),
      ]),
    );

    const reviewerLane = await getProductLane(
      repo,
      'reviewer',
      resolveLaneFilters('reviewer', { project_id: executionPackage.project_id, reviewer_actor_id: actorReviewer }),
    );
    expect(reviewerLane.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object: { type: 'review_packet', id: reviewPacket.id },
          actions: expect.arrayContaining([
            expect.objectContaining({
              kind: 'navigate',
              target: expect.objectContaining({ kind: 'object', object_type: 'review_packet', object_id: reviewPacket.id }),
            }),
          ]),
        }),
      ]),
    );

    const qaLane = await getProductLane(
      repo,
      'qa-test-owner',
      resolveLaneFilters('qa-test-owner', { project_id: executionPackage.project_id, qa_owner_actor_id: actorQa }),
    );
    expect(qaLane.items.map((item) => item.object.type)).toEqual(
      expect.arrayContaining(['work_item', 'execution_package', 'release']),
    );
    await expect(
      getProductLane(
        repo,
        'qa-test-owner',
        resolveLaneFilters('qa-test-owner', { project_id: executionPackage.project_id, qa_owner_actor_id: secondaryQaOwner }),
      ),
    ).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ object: { type: 'work_item', id: executionPackage.work_item_id } }),
        expect.objectContaining({ object: { type: 'release', id: release.id } }),
      ]),
    });

    const releaseLane = await getProductLane(
      repo,
      'release-owner',
      resolveLaneFilters('release-owner', { project_id: executionPackage.project_id, release_owner_actor_id: actorOwner }),
    );
    expect(releaseLane.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object: { type: 'release', id: release.id },
          actions: expect.arrayContaining([
            expect.objectContaining({
              kind: 'navigate',
              target: expect.objectContaining({ kind: 'object', object_type: 'release', object_id: release.id }),
            }),
          ]),
        }),
      ]),
    );
    const firstReleasePage = await getProductLane(
      repo,
      'release-owner',
      resolveLaneFilters('release-owner', { project_id: executionPackage.project_id, release_owner_actor_id: actorOwner, limit: 1 }),
    );
    expect(firstReleasePage.items).toHaveLength(1);
    expect(firstReleasePage.items[0]?.object).toEqual({ type: 'release', id: newerRelease.id });
    expect(firstReleasePage.next_cursor).toBe(newerRelease.id);

    const managerLane = await getProductLane(
      repo,
      'manager',
      resolveLaneFilters('manager', { project_id: executionPackage.project_id, risk: 'medium' }),
    );
    expect(managerLane.items.length).toBeGreaterThan(0);
    expect(managerLane.summary.total).toBeGreaterThan(managerLane.items.length);
    expect(managerLane.items.every((item) => item.object.type === 'lane_summary')).toBe(true);
    expect([...collectKeys(managerLane)]).not.toEqual(expect.arrayContaining(['score', 'rank', 'ranking', 'actor_score']));

    const pagedManagerLane = await getProductLane(
      repo,
      'manager',
      resolveLaneFilters('manager', { project_id: executionPackage.project_id, risk: 'medium', limit: 1 }),
    );
    expect(pagedManagerLane.items).toHaveLength(1);
    expect(pagedManagerLane.next_cursor).toBe(pagedManagerLane.items[0]?.id);
    expect(pagedManagerLane.summary).toEqual(managerLane.summary);
  });

  it('returns lane-aware Work Item actions without legacy create aliases', async () => {
    const { app, repo } = await track(createTestApp());
    const { workItem } = await seedDraftWorkItem(app, 'bug');

    const response = await getWorkItemActions(repo, workItem.id, undefined, { cockpit: cockpitOptions });

    expect(response).toMatchObject({
      work_item_id: workItem.id,
      lane_id: 'bugs',
      default_lane_id: 'bugs',
      actions: [
        expect.objectContaining({
          lane_id: 'bugs',
          kind: 'navigate',
          target: expect.objectContaining({ kind: 'object', object_type: 'work_item', object_id: workItem.id }),
        }),
      ],
    });
    expect(response?.actions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: expect.objectContaining({ type: expect.stringContaining('create') }) }),
      ]),
    );
  });

  it('filters Spec and Plan approval attention by persisted review actor decisions', async () => {
    const { app, repo } = await track(createTestApp());
    const specSeed = await seedSubmittedSpec(app);
    const planSeed = await seedSubmittedPlan(app);

    await request(app.getHttpServer())
      .post(`/specs/${specSeed.spec.id}/request-changes`)
      .set(reviewerHeaders)
      .send({ actor_id: actorReviewer, rationale: 'Spec needs clearer acceptance criteria.' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/plans/${planSeed.plan.id}/request-changes`)
      .set(reviewerHeaders)
      .send({ actor_id: actorReviewer, rationale: 'Plan needs smaller implementation packages.' })
      .expect(201);

    await expect(
      getProductLane(
        repo,
        'spec-approver',
        resolveLaneFilters('spec-approver', { project_id: specSeed.project.id, actor_id: actorReviewer }),
      ),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ object: { type: 'spec', id: specSeed.spec.id } })],
      summary: expect.objectContaining({ total: 1 }),
    });
    await expect(
      getProductLane(
        repo,
        'spec-approver',
        resolveLaneFilters('spec-approver', { project_id: planSeed.project.id, actor_id: actorReviewer }),
      ),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ object: { type: 'plan', id: planSeed.plan.id } })],
      summary: expect.objectContaining({ total: 1 }),
    });
    await expect(
      getProductLane(
        repo,
        'spec-approver',
        resolveLaneFilters('spec-approver', { project_id: planSeed.project.id, actor_id: actorOwner }),
      ),
    ).resolves.toMatchObject({ items: [], summary: expect.objectContaining({ total: 0 }) });
  });

  it('returns package generation actions only after an approved Plan revision exists', async () => {
    const { app, repo } = await track(createTestApp());
    const { workItem, planRevision } = await seedApprovedPlanWithoutPackages(app);

    const response = await getWorkItemActions(repo, workItem.id, undefined, { cockpit: cockpitOptions });

    expect(response?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'command',
          command: expect.objectContaining({
            type: 'generate_packages',
            work_item_id: workItem.id,
            plan_revision_id: planRevision.id,
          }),
        }),
      ]),
    );
    expect(response?.actions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: expect.objectContaining({ type: 'generate_plan_draft' }) }),
      ]),
    );
  });
});
