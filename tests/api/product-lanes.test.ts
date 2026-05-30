import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, ExecutionPackage, ExecutionPackageDependency, Plan, Release, ReviewPacket, RunSession, Spec, SpecRevision, Task } from '@forgeloop/domain';
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
import { seedItemScopedSpecPlan } from '../helpers/item-scoped-artifact-fixtures';

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
  const project = (await request(server).post('/projects').set(ownerHeaders).send({ name: 'Product Lane Project', owner_actor_id: actorOwner }).expect(201))
    .body;

  await request(server)
    .post(`/projects/${project.id}/repos`)
    .set(ownerHeaders)
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
      .set(ownerHeaders)
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
  const { spec } = await seedItemScopedSpecPlan(app, workItem.id, {
    actorId: actorOwner,
    reviewerActorId: actorReviewer,
    includePlan: false,
    specStatus: 'in_review',
  });

  return { project, workItem, spec };
};

const seedSubmittedPlan = async (app: INestApplication) => {
  const { project, workItem } = await seedDraftWorkItem(app, 'requirement');
  const { plan } = await seedItemScopedSpecPlan(app, workItem.id, {
    actorId: actorOwner,
    reviewerActorId: actorReviewer,
    planStatus: 'in_review',
  });

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

const recordChangesRequested = async (
  repo: InMemoryDeliveryRepository,
  objectType: 'spec' | 'plan',
  artifact: Spec | Plan,
  rationale: string,
) => {
  const updated = {
    ...artifact,
    status: 'draft' as const,
    gate_state: 'changes_requested' as const,
    resolution: 'none' as const,
    updated_at: now,
  };
  if (objectType === 'spec') {
    await repo.saveSpec(updated as Spec);
  } else {
    await repo.savePlan(updated as Plan);
  }
  const decision: Decision = {
    id: `decision-${objectType}-${artifact.id}-changes-requested`,
    object_type: objectType,
    object_id: artifact.id,
    actor_id: actorReviewer,
    decision: 'changes_requested',
    summary: rationale,
    created_at: now,
  };
  await repo.saveDecision(decision);
  return updated;
};

const saveTaskScopedPackage = async (
  repo: InMemoryDeliveryRepository,
  executionPackage: ExecutionPackage,
): Promise<ExecutionPackage> => {
  const task: Task = {
    id: `task-${executionPackage.id}`,
    project_id: executionPackage.project_id,
    title: 'Implement product lane task',
    narrative_markdown: '',
    execution_brief: 'Verify product lane evidence links are task scoped.',
    acceptance_checklist: ['Task-scoped product actions only use real task ids.'],
    status: 'ready',
    parent_ref: { type: 'requirement', id: executionPackage.work_item_id },
    controlling_spec_revision_id: executionPackage.spec_revision_id,
    controlling_plan_revision_id: executionPackage.plan_revision_id,
    stale_state: 'current',
    created_at: now,
    updated_at: now,
  };
  await repo.saveTask(task);
  const taskScopedPackage = { ...executionPackage, task_id: task.id, updated_at: now };
  await repo.saveExecutionPackage(taskScopedPackage);
  return taskScopedPackage;
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
      items: [expect.objectContaining({ object: { type: 'bug', id: workItem.id } })],
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
      .get(`/query/product-lanes/execution-owner?project_id=${project.id}&owner_actor_id=actor-b`)
      .expect(400);
    await request(server)
      .get(`/query/product-lanes/execution-owner?project_id=${project.id}&actor_id=actor-a&execution_owner_actor_id=actor-b`)
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

  it('filters Work Item type lanes by driver_actor_id and reports unsupported execution_owner_actor_id explicitly', async () => {
    const { app } = await track(createTestApp());
    const { project, workItem } = await seedDraftWorkItem(app, 'bug');
    const server = app.getHttpServer();

    const response = await request(server)
      .get(`/query/product-lanes/bugs?project_id=${project.id}&driver_actor_id=${actorOwner}`)
      .expect(200);
    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object: { type: 'bug', id: workItem.id },
          driver_actor_id: actorOwner,
        }),
      ]),
    );
    expect(JSON.stringify(response.body.items)).not.toContain('owner_actor_id');

    const unsupportedResponse = await request(server)
      .get(`/query/product-lanes/bugs?project_id=${project.id}&execution_owner_actor_id=${actorOwner}`)
      .expect(200);
    expect(unsupportedResponse.body.unsupported_filters).toContain('execution_owner_actor_id');
    expect(unsupportedResponse.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ object: { type: 'bug', id: workItem.id } })]),
    );
  });

  it('keeps execution-owner lane execution_owner_actor_id filtering for execution packages', async () => {
    const { app } = await track(createTestApp());
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);

    await request(app.getHttpServer())
      .get(`/query/product-lanes/execution-owner?project_id=${executionPackage.project_id}&execution_owner_actor_id=${actorOwner}`)
      .expect(200);
  });

  it('disables Product Lane run package actions when local Codex runtime readiness is blocked', async () => {
    const { app, repo } = await track(createTestApp());
    const executionPackage = await seedReadyLocalCodexExecutionPackage(repo);

    for (const path of [
      `/query/product-lanes/execution-owner?project_id=${executionPackage.project_id}&execution_owner_actor_id=${actorOwner}`,
      `/query/product-lanes/qa-test-owner?project_id=${executionPackage.project_id}&qa_owner_actor_id=${actorQa}`,
    ]) {
      const response = await request(app.getHttpServer()).get(path).expect(200);
      const item = response.body.items.find(
        (candidate: { object: { type: string; id: string } }) =>
          candidate.object.type === 'execution' && candidate.object.id === (executionPackage.execution_id ?? executionPackage.id),
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

  it('does not expose Work Item Cockpit action compatibility from Product Lane tests', async () => {
    const { app } = await track(createTestApp());
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);

    await request(app.getHttpServer())
      .get(`/query/work-item-cockpit/${executionPackage.work_item_id}?lane=reviewer`)
      .expect(404);
  });

  it('keeps unsupported execution_owner_actor_id response metadata for non-execution-owner lanes', async () => {
    const { app } = await track(createTestApp());
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);

    const response = await request(app.getHttpServer())
      .get(`/query/product-lanes/reviewer?project_id=${executionPackage.project_id}&execution_owner_actor_id=${actorOwner}`)
      .expect(200);

    expect(response.body.unsupported_filters).toContain('execution_owner_actor_id');
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
        object: { type: kind, id: laneSeed.workItem.id },
        actions: [
          expect.objectContaining({
            lane_id: lane,
            kind: 'navigate',
            priority: 'primary',
            enabled: true,
            target: expect.objectContaining({ kind: 'object', object_type: kind, object_id: laneSeed.workItem.id }),
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
    await recordChangesRequested(repo, 'spec', spec, 'Verify product lane projections before approval.');

    const executionPackage = await saveTaskScopedPackage(repo, await seedReadyExecutionPackageThroughApi(app));
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
          object: { type: 'execution', id: upstreamPackage.execution_id ?? upstreamPackage.id },
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
          object: { type: 'code_review_handoff', id: reviewPacket.id },
          actions: [],
        }),
      ]),
    );

    const qaLane = await getProductLane(
      repo,
      'qa-test-owner',
      resolveLaneFilters('qa-test-owner', { project_id: executionPackage.project_id, qa_owner_actor_id: actorQa }),
    );
    expect(qaLane.items.map((item) => item.object.type)).toEqual(expect.arrayContaining(['requirement', 'execution', 'release']));
    await expect(
      getProductLane(
        repo,
        'qa-test-owner',
        resolveLaneFilters('qa-test-owner', { project_id: executionPackage.project_id, qa_owner_actor_id: secondaryQaOwner }),
      ),
    ).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ object: { type: 'requirement', id: executionPackage.work_item_id } }),
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

    await recordChangesRequested(repo, 'spec', specSeed.spec, 'Spec needs clearer acceptance criteria.');
    await recordChangesRequested(repo, 'plan', planSeed.plan, 'Plan needs smaller implementation packages.');

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
      items: [expect.objectContaining({ object: { type: 'implementation_plan_doc', id: planSeed.plan.id } })],
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

  it('reports execution_owner_actor_id as unsupported for direct Work Item lane filter resolution', async () => {
    const { app } = await track(createTestApp());
    const { project } = await seedDraftWorkItem(app, 'requirement');

    const filters = resolveLaneFilters('requirements', {
      project_id: project.id,
      kind: 'requirement',
      driver_actor_id: actorOwner,
      execution_owner_actor_id: actorOwner,
      limit: 5,
    });

    expect(filters.unsupported_filters).toContain('execution_owner_actor_id');
  });

});
