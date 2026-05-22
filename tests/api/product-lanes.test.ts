import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExecutionPackage, ExecutionPackageDependency, Release, ReviewPacket, RunSession, SpecRevision } from '@forgeloop/domain';
import type { ProductLaneId } from '@forgeloop/contracts';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import {
  getProductLane,
  InMemoryDeliveryRepository,
  resolveLaneFilters,
} from '../../packages/db/src/index';
import {
  seedReadyExecutionPackageThroughApi,
  seedReadyLocalCodexExecutionPackage,
  succeededSelfReview,
} from '../helpers/delivery-runtime-fixtures';

const now = '2026-05-05T00:00:00.000Z';
const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const actorQa = 'actor-qa';
const ownerHeaders = { 'x-forgeloop-actor-id': actorOwner, 'x-forgeloop-actor-class': 'human_admin' };
const reviewerHeaders = { 'x-forgeloop-actor-id': actorReviewer, 'x-forgeloop-actor-class': 'human' };
const intakeContextByKind = {
  initiative: {
    type: 'initiative',
    business_outcome: 'Improve product lane delivery visibility.',
    scope_narrative: 'Group lane work across intake, approval, execution, QA, and release.',
    success_metrics: ['Each lane returns the seeded Work Item.'],
  },
  requirement: {
    type: 'requirement',
    stakeholder_problem: 'Approvers need lane attention to reflect Work Item context.',
    desired_outcome: 'Requirement lane fixtures include typed intake context.',
    acceptance_criteria: ['The item appears in the lane.'],
    in_scope: ['Product lane projections'],
  },
  bug: {
    type: 'bug',
    impact_summary: 'Lane projections can drop bug Work Items.',
    observed_behavior: 'Bug items require typed intake context.',
    expected_behavior: 'Bug items appear in the bug lane.',
    reproduction_steps: ['Seed a bug Work Item', 'Query the bug lane'],
    affected_environment: 'product lane API test',
    verification_path: 'Product lane API assertions',
  },
  tech_debt: {
    type: 'tech_debt',
    current_pain: 'Tech debt lane fixtures use legacy owner intake.',
    desired_invariant: 'Tech debt fixtures use typed intake context.',
    affected_modules: ['product-lanes.test.ts'],
    behavior_preservation: 'Existing product lane assertions still pass.',
    validation_strategy: 'Focused Product Lane API tests',
  },
} as const;
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
        driver_actor_id: actorOwner,
        intake_context: intakeContextByKind[kind],
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

const saveApprovedReviewPacket = async (
  repo: InMemoryDeliveryRepository,
  executionPackage: ExecutionPackage,
): Promise<{ runSession: RunSession; reviewPacket: ReviewPacket }> => {
  const { runSession, reviewPacket } = await saveReviewPacket(repo, executionPackage);
  const approvedReviewPacket: ReviewPacket = {
    ...reviewPacket,
    status: 'completed',
    decision: 'approved',
    reviewed_by_actor_id: actorReviewer,
    reviewed_at: now,
    completed_at: now,
    independent_ai_review: {
      status: 'approved',
      run_session_id: runSession.id,
      execution_package_id: executionPackage.id,
      summary: 'Independent review approved the selected run evidence.',
    },
    test_mapping: [{ gate_id: 'unit-tests', result: 'passed', evidence_ref: 'run-check:unit-tests' }],
    requested_changes: [],
    updated_at: now,
  };
  await repo.saveReviewPacket(approvedReviewPacket);

  return { runSession, reviewPacket: approvedReviewPacket };
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

const getPrimaryCockpitAction = async (app: INestApplication, workItemId: string, lane: ProductLaneId) => {
  const response = await request(app.getHttpServer()).get(`/query/work-item-cockpit/${workItemId}?lane=${lane}`).expect(200);
  const action = response.body.delivery_readiness.next_actions[0];
  expect(action).toBeDefined();
  return action;
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

  it('serves Product Lane endpoints without Work Item action endpoint compatibility', async () => {
    const { app } = await track(createTestApp());
    const { project, workItem } = await seedDraftWorkItem(app);

    const laneResponse = await request(app.getHttpServer())
      .get(`/query/product-lanes/bugs?project_id=${project.id}&kind=bug&limit=5`)
      .expect(200);
    expect(laneResponse.body).toMatchObject({
      lane_id: 'bugs',
      items: [expect.objectContaining({ object: { type: 'work_item', id: workItem.id } })],
    });

    await request(app.getHttpServer()).get(`/query/work-items/${workItem.id}/actions?lane=bugs`).expect(404);
    expect(JSON.stringify(laneResponse.body)).not.toContain('/workbench');

    const removedEndpoint = `/query/${'work'}${'benches'}/spec-approver?project_id=${project.id}`;
    await request(app.getHttpServer()).get(removedEndpoint).expect(404);
  });

  it('rejects invalid Product Lane query parameters', async () => {
    const { app } = await track(createTestApp());
    const { project } = await seedDraftWorkItem(app);
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
    await request(server)
      .get(`/query/product-lanes/bugs?project_id=${project.id}&actor_id=actor-a&driver_actor_id=actor-b`)
      .expect(400);
  });

  it('filters Work Item type lanes by driver_actor_id and rejects owner_actor_id', async () => {
    const { app } = await track(createTestApp());
    const { project, workItem } = await seedDraftWorkItem(app, 'bug');
    const server = app.getHttpServer();

    const response = await request(server)
      .get(`/query/product-lanes/bugs?project_id=${project.id}&driver_actor_id=${actorOwner}`)
      .expect(200);
    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object: { type: 'work_item', id: workItem.id },
          driver_actor_id: actorOwner,
        }),
      ]),
    );
    expect(JSON.stringify(response.body.items)).not.toContain('owner_actor_id');

    await request(server)
      .get(`/query/product-lanes/bugs?project_id=${project.id}&owner_actor_id=${actorOwner}`)
      .expect(400);
  });

  it('keeps execution-owner lane owner_actor_id filtering for execution packages', async () => {
    const { app } = await track(createTestApp());
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);

    await request(app.getHttpServer())
      .get(`/query/product-lanes/execution-owner?project_id=${executionPackage.project_id}&owner_actor_id=${actorOwner}`)
      .expect(200);
  });

  it('disables Product Lane run package actions when local Codex runtime readiness is blocked', async () => {
    const { app, repo } = await track(createTestApp());
    const executionPackage = await seedReadyLocalCodexExecutionPackage(repo);

    for (const path of [
      `/query/product-lanes/execution-owner?project_id=${executionPackage.project_id}&owner_actor_id=${actorOwner}`,
      `/query/product-lanes/qa-test-owner?project_id=${executionPackage.project_id}&qa_owner_actor_id=${actorQa}`,
    ]) {
      const response = await request(app.getHttpServer()).get(path).expect(200);
      const item = response.body.items.find(
        (candidate: { object: { type: string; id: string } }) =>
          candidate.object.type === 'execution_package' && candidate.object.id === executionPackage.id,
      );
      const action = item?.actions.find(
        (candidate: { kind: string; command?: { type: string } }) =>
          candidate.kind === 'command' && candidate.command?.type === 'run_package',
      );

      expect(action).toMatchObject({
        enabled: false,
        disabled_reason: 'A local Codex run execution profile must be active for this package scope.',
        blocked_reason: 'A local Codex run execution profile must be active for this package scope.',
        command: expect.objectContaining({ type: 'run_package', package_id: executionPackage.id }),
      });
      expect(JSON.stringify(action)).not.toContain('sha256:');
      expect(JSON.stringify(action)).not.toContain('/workspace');
      expect(JSON.stringify(action)).not.toContain('codex_config');
    }
  });

  it('returns reviewer Work Item Cockpit next actions that distinguish pending decisions from missing evidence', async () => {
    const { app, repo } = await track(createTestApp());
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);

    await expect(getPrimaryCockpitAction(app, executionPackage.work_item_id, 'reviewer')).resolves.toMatchObject({
      kind: 'navigate',
      label: 'Generate Review Packet evidence first',
      description: expect.stringMatching(/review evidence must be generated before the reviewer can decide/i),
      target: expect.objectContaining({
        kind: 'object',
        object_type: 'execution_package',
        object_id: executionPackage.id,
        href: `/packages/${executionPackage.id}`,
      }),
    });

    const { reviewPacket } = await saveReviewPacket(repo, executionPackage);

    await expect(getPrimaryCockpitAction(app, executionPackage.work_item_id, 'reviewer')).resolves.toMatchObject({
      kind: 'navigate',
      label: 'Decide Review Packet',
      description: expect.stringMatching(/approve.*request changes/i),
      target: expect.objectContaining({
        kind: 'object',
        object_type: 'review_packet',
        object_id: reviewPacket.id,
        href: `/reviews/${reviewPacket.id}`,
      }),
    });
  });

  it('returns QA Work Item Cockpit next actions for blocked quality gates and release test acceptance handoff', async () => {
    const { app, repo } = await track(createTestApp());
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);

    await expect(getPrimaryCockpitAction(app, executionPackage.work_item_id, 'qa-test-owner')).resolves.toMatchObject({
      kind: 'navigate',
      label: 'Review Quality Gate blockers',
      description: expect.stringMatching(/resolve.*quality gate blockers/i),
      target: expect.objectContaining({
        kind: 'object',
        object_type: 'work_item',
        object_id: executionPackage.work_item_id,
      }),
    });

    await saveApprovedReviewPacket(repo, executionPackage);
    const reviewedPackage = await repo.getExecutionPackage(executionPackage.id);
    await repo.saveExecutionPackage({
      ...(reviewedPackage ?? executionPackage),
      required_artifact_kinds: [],
      updated_at: now,
    });

    await expect(getPrimaryCockpitAction(app, executionPackage.work_item_id, 'qa-test-owner')).resolves.toMatchObject({
      kind: 'navigate',
      label: 'Open Release inventory',
      description: expect.stringMatching(/release scope.*established/i),
      target: {
        kind: 'route',
        href: '/releases',
      },
    });

    const createdRelease = await seedLinkedRelease(app, executionPackage);
    const release = (await repo.getRelease(createdRelease.id)) ?? createdRelease;

    await expect(getPrimaryCockpitAction(app, executionPackage.work_item_id, 'qa-test-owner')).resolves.toMatchObject({
      kind: 'navigate',
      label: 'Acknowledge Release Test Acceptance',
      description: expect.stringMatching(/acknowledge.*test acceptance/i),
      target: expect.objectContaining({
        kind: 'object',
        object_type: 'release',
        object_id: release.id,
        href: `/releases/${release.id}#release-test-acceptance`,
      }),
    });
  });

  it('returns release-owner Work Item Cockpit next actions with state-specific decisions', async () => {
    const { app, repo } = await track(createTestApp());
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);
    await saveApprovedReviewPacket(repo, executionPackage);
    const reviewedPackage = await repo.getExecutionPackage(executionPackage.id);
    await repo.saveExecutionPackage({
      ...(reviewedPackage ?? executionPackage),
      required_artifact_kinds: [],
      updated_at: now,
    });

    await expect(getPrimaryCockpitAction(app, executionPackage.work_item_id, 'release-owner')).resolves.toMatchObject({
      kind: 'navigate',
      label: 'Create or link Release',
      description: expect.stringMatching(/release scope must be established/i),
      target: {
        kind: 'route',
        href: '/releases',
      },
    });

    const createdRelease = await seedLinkedRelease(app, executionPackage);
    const release = (await repo.getRelease(createdRelease.id)) ?? createdRelease;
    const cases: Array<{ release: Release; label: string; description: RegExp }> = [
      {
        release: { ...release, phase: 'candidate', gate_state: 'not_submitted', activity_state: 'idle' },
        label: 'Submit Release for Approval',
        description: /submit.*release.*approval/i,
      },
      {
        release: { ...release, phase: 'approval', gate_state: 'awaiting_approval', activity_state: 'awaiting_human' },
        label: 'Approve or Request Release Changes',
        description: /approve.*request changes/i,
      },
      {
        release: { ...release, phase: 'rollout', gate_state: 'approved', activity_state: 'idle' },
        label: 'Start Release Observation',
        description: /start.*observation/i,
      },
      {
        release: { ...release, phase: 'observing', gate_state: 'rollout_succeeded', activity_state: 'idle' },
        label: 'Close Release',
        description: /close.*release/i,
      },
    ];

    for (const entry of cases) {
      await repo.saveRelease(entry.release);
      await expect(getPrimaryCockpitAction(app, executionPackage.work_item_id, 'release-owner')).resolves.toMatchObject({
        kind: 'navigate',
        label: entry.label,
        description: expect.stringMatching(entry.description),
        target: expect.objectContaining({
          kind: 'object',
          object_type: 'release',
          object_id: release.id,
          href: `/releases/${release.id}`,
        }),
      });
    }
  });

  it('keeps unsupported owner_actor_id response metadata for non-Work-Item lanes', async () => {
    const { app } = await track(createTestApp());
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);

    const response = await request(app.getHttpServer())
      .get(`/query/product-lanes/reviewer?project_id=${executionPackage.project_id}&owner_actor_id=${actorOwner}`)
      .expect(200);

    expect(response.body.unsupported_filters).toContain('owner_actor_id');
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
        driver_actor_id: actorOwner,
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

  it('reports owner_actor_id as unsupported for direct Work Item lane filter resolution', async () => {
    const { app } = await track(createTestApp());
    const { project } = await seedDraftWorkItem(app, 'requirement');

    const filters = resolveLaneFilters('requirements', {
      project_id: project.id,
      kind: 'requirement',
      driver_actor_id: actorOwner,
      owner_actor_id: actorOwner,
      limit: 5,
    });

    expect(filters.unsupported_filters).toContain('owner_actor_id');
  });

});
