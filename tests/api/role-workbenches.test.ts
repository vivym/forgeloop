import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExecutionPackage, ExecutionPackageDependency, ReviewPacket, RunSession, SpecRevision } from '@forgeloop/domain';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import { InMemoryDeliveryRepository } from '../../packages/db/src/index';
import { seedReadyExecutionPackageThroughApi, succeededSelfReview } from '../helpers/delivery-runtime-fixtures';

const now = '2026-05-05T00:00:00.000Z';
const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const actorQa = 'actor-qa';
const ownerHeaders = { 'x-forgeloop-actor-id': actorOwner, 'x-forgeloop-actor-class': 'human_admin' };

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

const seedDraftWorkItem = async (app: INestApplication, kind: 'requirement' | 'bug' | 'tech_debt' = 'bug') => {
  const server = app.getHttpServer();
  const project = (await request(server).post('/projects').send({ name: 'Workbench Project', owner_actor_id: actorOwner }).expect(201))
    .body;

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
        kind,
        title: 'Triage workbench item',
        goal: 'Exercise the intake workbench.',
        success_criteria: ['The item appears in the queue.'],
        priority: 'P1',
        risk: 'high',
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

const saveReviewPacket = async (
  repo: InMemoryDeliveryRepository,
  executionPackage: ExecutionPackage,
): Promise<{ runSession: RunSession; reviewPacket: ReviewPacket }> => {
  const runSession: RunSession = {
    id: 'run-session-workbench-review',
    execution_package_id: executionPackage.id,
    requested_by_actor_id: actorOwner,
    status: 'succeeded',
    executor_type: 'mock',
    changed_files: [{ repo_id: executionPackage.repo_id, path: 'apps/control-plane-api/src/app.module.ts', change_kind: 'modified' }],
    check_results: [
      {
        check_id: executionPackage.required_checks[0]?.check_id ?? 'unit',
        command: executionPackage.required_checks[0]?.command ?? 'pnpm vitest run tests/api/role-workbenches.test.ts',
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
    id: 'review-packet-workbench',
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
        file_path: 'tests/api/role-workbenches.test.ts',
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
        title: 'Workbench Release',
        scope_summary: 'Ship the role workbench package.',
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

describe('role workbench query routes', () => {
  const apps: INestApplication[] = [];

  const track = async <T extends { app: INestApplication }>(value: Promise<T>): Promise<T> => {
    const resolved = await value;
    apps.push(resolved.app);
    return resolved;
  };

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('returns typed intake queues with real action descriptors', async () => {
    const { app } = await track(createTestApp());
    const { project, workItem } = await seedDraftWorkItem(app);

    const response = await request(app.getHttpServer())
      .get(`/query/workbenches/intake?project_id=${project.id}&kind=bug&limit=5`)
      .expect(200);

    expect(response.body.summary).toMatchObject({ workbench_id: 'intake', total: 1 });
    expect(response.body.summary.type_metadata).toMatchObject({
      bug: expect.objectContaining({
        required_fields: expect.arrayContaining([
          'project_id',
          'title',
          'goal',
          'success_criteria',
          'priority',
          'risk',
          'owner_actor_id',
        ]),
      }),
    });
    expect(response.body.summary.type_groups).toMatchObject({
      bug: expect.objectContaining({ total: 1, ready_for_spec: 1 }),
    });
    expect(response.body.items[0]).toMatchObject({
      queue: 'intake:bug:ready_for_spec',
      object: { type: 'work_item', id: workItem.id },
      project_id: project.id,
      kind: 'bug',
      type_group: 'bug',
      stage_group: 'ready_for_spec',
      missing_required_fields: [],
      owner_assignment_status: 'assigned',
      risk_status: 'set',
      success_criteria_status: 'present',
      work_item_brief_status: 'ready',
      actions: expect.arrayContaining([
        expect.objectContaining({ label: expect.any(String), method: 'PATCH', path: `/work-items/${workItem.id}`, enabled: true }),
      ]),
    });
  });

  it('returns spec approval changes-requested items with revision and test-strategy summaries', async () => {
    const { app, repo } = await track(createTestApp());
    const { project, spec } = await seedSubmittedSpec(app);
    const server = app.getHttpServer();
    const currentSpec = await repo.getSpec(spec.id);
    const currentRevision = (await repo.getSpecRevision(currentSpec?.current_revision_id ?? 'missing')) as SpecRevision;

    await repo.saveSpecRevision({
      ...currentRevision,
      summary: 'Current changes-requested spec revision',
      test_strategy_summary: 'Run API role workbench tests.',
      risk_notes: ['Approval should verify workbench projections.'],
    });
    await request(server)
      .post(`/specs/${spec.id}/request-changes`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner, rationale: 'Verify workbench projections before approval.' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get(`/query/workbenches/spec-approver?project_id=${project.id}&status=changes_requested`)
      .expect(200);

    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          queue: 'spec_approval',
          object: { type: 'spec', id: spec.id },
          current_revision: expect.objectContaining({
            id: currentRevision.id,
            summary: 'Current changes-requested spec revision',
          }),
          test_strategy: expect.objectContaining({
            summary: 'Run API role workbench tests.',
            missing: false,
          }),
          risk_notes: ['Approval should verify workbench projections.'],
          actions: expect.arrayContaining([
            expect.objectContaining({ method: 'POST', path: `/specs/${spec.id}/approve`, enabled: true }),
            expect.objectContaining({ method: 'POST', path: `/specs/${spec.id}/request-changes`, enabled: true }),
          ]),
        }),
      ]),
    );
  });

  it('filters spec approval items by work item actor phase and spec status with cursor pagination', async () => {
    const { app } = await track(createTestApp());
    const first = await seedSubmittedSpec(app);
    const second = await seedSubmittedSpec(app);

    const firstPage = await request(app.getHttpServer())
      .get(
        `/query/workbenches/spec-approver?actor_id=${actorOwner}&phase=spec&status=awaiting_approval&limit=1`,
      )
      .expect(200);

    expect(firstPage.body.items).toHaveLength(1);
    expect(firstPage.body.next_cursor).toBe(firstPage.body.items[0].id);

    const secondPage = await request(app.getHttpServer())
      .get(
        `/query/workbenches/spec-approver?actor_id=${actorOwner}&phase=spec&status=awaiting_approval&limit=1&cursor=${firstPage.body.next_cursor}`,
      )
      .expect(200);

    expect([first.spec.id, second.spec.id]).toEqual(expect.arrayContaining(firstPage.body.items.map((item: { id: string }) => item.id)));
    expect([first.spec.id, second.spec.id]).toEqual(expect.arrayContaining(secondPage.body.items.map((item: { id: string }) => item.id)));
    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.items[0].id).not.toBe(firstPage.body.items[0].id);
    expect(secondPage.body.next_cursor).toBeUndefined();

    const actorFiltered = await request(app.getHttpServer())
      .get('/query/workbenches/spec-approver?actor_id=actor-unassigned&phase=spec&status=awaiting_approval')
      .expect(200);
    expect(actorFiltered.body.items).toEqual([]);

    const phaseFiltered = await request(app.getHttpServer())
      .get(`/query/workbenches/spec-approver?actor_id=${actorOwner}&phase=closed&status=awaiting_approval`)
      .expect(200);
    expect(phaseFiltered.body.items).toEqual([]);

    const statusFiltered = await request(app.getHttpServer())
      .get(`/query/workbenches/spec-approver?actor_id=${actorOwner}&phase=spec&status=changes_requested`)
      .expect(200);
    expect(statusFiltered.body.items).toEqual([]);
  });

  it('returns execution-owner packages with package command actions', async () => {
    const { app, repo } = await track(createTestApp());
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);
    const upstreamPackage: ExecutionPackage = {
      ...executionPackage,
      id: 'execution-package-workbench-upstream',
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
    const { runSession, reviewPacket } = await saveReviewPacket(repo, executionPackage);

    const response = await request(app.getHttpServer())
      .get(`/query/workbenches/execution-owner?project_id=${executionPackage.project_id}&actor_id=${actorOwner}`)
      .expect(200);

    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          queue: expect.stringMatching(/^(draft|ready|active_run|blocked|review_handoff)$/),
          object: { type: 'execution_package', id: executionPackage.id },
          owner_actor_id: actorOwner,
          dependency_status: expect.objectContaining({
            total: 1,
            blocked: true,
            dependencies: expect.arrayContaining([
              expect.objectContaining({ package_id: upstreamPackage.id, completed: false }),
            ]),
          }),
          latest_run_summary: expect.objectContaining({
            id: runSession.id,
            status: runSession.status,
            summary: runSession.summary,
          }),
          current_review_packet: expect.objectContaining({
            id: reviewPacket.id,
            status: reviewPacket.status,
            decision: reviewPacket.decision,
          }),
          actions: expect.arrayContaining([
            expect.objectContaining({ method: 'PATCH', path: `/execution-packages/${executionPackage.id}` }),
            expect.objectContaining({ method: 'POST', path: `/execution-packages/${executionPackage.id}/run` }),
            expect.objectContaining({ method: 'POST', path: `/execution-packages/${executionPackage.id}/rerun` }),
            expect.objectContaining({ method: 'POST', path: `/execution-packages/${executionPackage.id}/force-rerun` }),
          ]),
        }),
      ]),
    );
  });

  it('returns reviewer packets with review decision actions', async () => {
    const { app, repo } = await track(createTestApp());
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);
    const { reviewPacket } = await saveReviewPacket(repo, executionPackage);

    const response = await request(app.getHttpServer())
      .get(`/query/workbenches/reviewer?project_id=${executionPackage.project_id}&actor_id=${actorReviewer}`)
      .expect(200);

    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          queue: 'review',
          object: { type: 'review_packet', id: reviewPacket.id },
          changed_file_count: 1,
          check_summary: 'Required checks passed.',
          self_review_summary: 'The implementation follows the approved package plan.',
          requested_changes: [
            expect.objectContaining({
              title: 'Tighten evidence summary',
              severity: 'minor',
            }),
          ],
          actions: expect.arrayContaining([
            expect.objectContaining({ method: 'POST', path: `/review-packets/${reviewPacket.id}/approve`, enabled: true }),
            expect.objectContaining({ method: 'POST', path: `/review-packets/${reviewPacket.id}/request-changes`, enabled: true }),
          ]),
        }),
      ]),
    );
  });

  it('returns QA test-owner work item package and release evidence gaps with acknowledgement action when required', async () => {
    const { app, repo } = await track(createTestApp());
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);
    const orphan = await seedDraftWorkItem(app, 'tech_debt');
    const workItem = await repo.getWorkItem(executionPackage.work_item_id);
    const spec = await repo.getSpec(executionPackage.spec_id);
    const specRevision = (await repo.getSpecRevision(spec?.current_revision_id ?? 'missing')) as SpecRevision;
    await repo.saveWorkItem({ ...workItem!, risk: 'high', updated_at: now });
    await repo.saveSpec({ ...spec!, approved_revision_id: specRevision.id });
    await repo.saveSpecRevision({ ...specRevision, test_strategy_summary: '   ' });
    await repo.saveExecutionPackage({
      ...executionPackage,
      phase: 'ready',
      gate_state: 'not_submitted',
      activity_state: 'awaiting_human',
      updated_at: now,
    });
    const release = await seedLinkedRelease(app, { ...executionPackage, phase: 'ready' });

    const response = await request(app.getHttpServer())
      .get(`/query/workbenches/qa-test-owner?actor_id=${actorQa}`)
      .expect(200);

    expect(response.body.items.map((item: { object: { type: string } }) => item.object.type)).toEqual(
      expect.arrayContaining(['work_item', 'execution_package', 'release']),
    );
    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          queue: 'qa_test_work_item',
          object: { type: 'work_item', id: executionPackage.work_item_id },
          test_strategy: expect.objectContaining({ missing: true }),
          missing_artifacts: expect.arrayContaining(['spec_test_strategy_summary']),
        }),
        expect.objectContaining({
          queue: 'qa_test_work_item',
          object: { type: 'work_item', id: orphan.workItem.id },
          missing_artifacts: expect.arrayContaining(['spec_test_strategy_summary', 'spec_acceptance_criteria']),
        }),
        expect.objectContaining({
          queue: 'qa_test_package',
          object: { type: 'execution_package', id: executionPackage.id },
          phase: 'ready',
          qa_owner_actor_id: actorQa,
          required_checks: expect.objectContaining({ missing: expect.any(Number) }),
          missing_artifacts: expect.arrayContaining(['execution_summary']),
          actions: expect.arrayContaining([
            expect.objectContaining({ method: 'PATCH', path: `/execution-packages/${executionPackage.id}` }),
            expect.objectContaining({ method: 'GET', path: `/query/replay/execution_package/${executionPackage.id}` }),
          ]),
        }),
        expect.objectContaining({
          queue: 'qa_test_release',
          object: { type: 'release', id: release.id },
          release_blocker_refs: expect.any(Array),
          evidence_chain_links: expect.any(Array),
          actions: expect.arrayContaining([
            expect.objectContaining({ method: 'POST', path: `/releases/${release.id}/test-acceptance/acknowledge` }),
          ]),
        }),
      ]),
    );
  });

  it('returns release-owner releases with release command actions', async () => {
    const { app } = await track(createTestApp());
    const { project } = await seedDraftWorkItem(app);
    const release = (
      await request(app.getHttpServer())
        .post('/releases')
        .set(ownerHeaders)
        .send({
          actor_id: actorOwner,
          project_id: project.id,
          title: 'Workbench Release',
          rollout_strategy: 'Ship behind a flag.',
          rollback_plan: 'Disable the flag.',
          observation_plan: 'Watch metrics.',
          release_owner_actor_id: actorOwner,
        })
        .expect(201)
    ).body.release;

    const response = await request(app.getHttpServer())
      .get(`/query/workbenches/release-owner?project_id=${project.id}&actor_id=${actorOwner}`)
      .expect(200);

    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          queue: expect.not.stringMatching(/^release$/),
          object: { type: 'release', id: release.id },
          rollout_strategy_summary: 'Ship behind a flag.',
          rollback_plan_summary: 'Disable the flag.',
          release_decision_summary: expect.any(Object),
          missing_release_plan_blockers: expect.any(Array),
          test_evidence_summary: expect.any(Object),
          observation_backlinks: expect.any(Array),
          actions: expect.arrayContaining([
            expect.objectContaining({ method: 'PATCH', path: `/releases/${release.id}` }),
            expect.objectContaining({ method: 'POST', path: `/releases/${release.id}/submit-for-approval` }),
            expect.objectContaining({ method: 'POST', path: `/releases/${release.id}/override-approve` }),
            expect.objectContaining({ method: 'POST', path: `/releases/${release.id}/start-observing` }),
            expect.objectContaining({ method: 'POST', path: `/releases/${release.id}/close` }),
          ]),
        }),
      ]),
    );

    const allProjectsResponse = await request(app.getHttpServer())
      .get(`/query/workbenches/release-owner?actor_id=${actorOwner}`)
      .expect(200);

    expect(allProjectsResponse.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          queue: expect.not.stringMatching(/^release$/),
          object: { type: 'release', id: release.id },
        }),
      ]),
    );
  });

  it('returns manager health projections without personal scoring or rankings', async () => {
    const { app } = await track(createTestApp());
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);

    const response = await request(app.getHttpServer())
      .get(`/query/workbenches/manager-health?project_id=${executionPackage.project_id}&risk=medium`)
      .expect(200);

    expect(response.body.summary).toMatchObject({ workbench_id: 'manager-health' });
    expect(response.body.items.length).toBeGreaterThan(0);
    expect(response.body.items.every((item: { object: { type: string } }) => item.object.type === 'manager_health_group')).toBe(true);
    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'stage_counts', stage_counts: expect.any(Object) }),
        expect.objectContaining({ id: 'blocker_groups', blocker_groups: expect.any(Object) }),
        expect.objectContaining({ id: 'review_backlog', review_backlog: expect.any(Object) }),
        expect.objectContaining({ id: 'run_failure_distribution', run_failure_distribution: expect.any(Object) }),
        expect.objectContaining({ id: 'release_readiness_distribution', release_readiness_distribution: expect.any(Object) }),
        expect.objectContaining({ id: 'quality_gaps', quality_gaps: expect.any(Object) }),
      ]),
    );
    expect(response.body.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object: { type: 'work_item', id: executionPackage.work_item_id },
        }),
      ]),
    );
    expect(collectKeys(response.body)).not.toEqual(expect.arrayContaining(['score', 'rank', 'ranking', 'actor_score']));

    const actorFilteredOut = await request(app.getHttpServer())
      .get(`/query/workbenches/manager-health?project_id=${executionPackage.project_id}&actor_id=actor-unassigned`)
      .expect(200);
    expect(actorFilteredOut.body.items).toEqual([]);

    const phaseFilteredOut = await request(app.getHttpServer())
      .get(`/query/workbenches/manager-health?project_id=${executionPackage.project_id}&phase=closed`)
      .expect(200);
    expect(phaseFilteredOut.body.items).toEqual([]);

    const statusFilteredOut = await request(app.getHttpServer())
      .get(`/query/workbenches/manager-health?project_id=${executionPackage.project_id}&status=spec_changes_requested`)
      .expect(200);

    expect(statusFilteredOut.body.items).toEqual([]);
    expect(collectKeys(statusFilteredOut.body)).not.toEqual(expect.arrayContaining(['score', 'rank', 'ranking', 'actor_score']));
  });
});
