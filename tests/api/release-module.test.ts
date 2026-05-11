import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  Artifact,
  Decision,
  ExecutionPackage,
  Project,
  Release,
  ReleaseEvidenceType,
  ReviewPacket,
  RunSession,
  WorkItem,
} from '@forgeloop/domain';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import {
  P0_REPOSITORY,
  P0_DEMO_ACTOR_ID_FALLBACK,
  RUN_DURABILITY_MODE,
  RUN_WORKER,
  type RunDurabilityMode,
} from '../../apps/control-plane-api/src/p0/p0.service';
import { actorHeaderName } from '../../apps/control-plane-api/src/p0/actor-context';
import { InMemoryP0Repository } from '../../packages/db/src/index';

const now = '2026-05-05T00:00:00.000Z';
const later = '2026-05-05T00:01:00.000Z';
const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const project = (overrides: Partial<Project> = {}): Project => ({
  id: 'project-1',
  name: 'Forgeloop',
  repo_ids: ['repo-1'],
  owner_actor_id: actorOwner,
  created_at: now,
  updated_at: now,
  ...overrides,
});

const workItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: 'work-item-1',
  project_id: 'project-1',
  kind: 'requirement',
  title: 'Ship release radar',
  goal: 'Expose release risk controls.',
  success_criteria: ['Release owner can approve a release.'],
  priority: 'P1',
  risk: 'medium',
  owner_actor_id: actorOwner,
  phase: 'done',
  activity_state: 'idle',
  gate_state: 'none',
  resolution: 'completed',
  created_at: now,
  updated_at: now,
  ...overrides,
});

const executionPackage = (overrides: Partial<ExecutionPackage> = {}): ExecutionPackage => ({
  id: 'execution-package-1',
  work_item_id: 'work-item-1',
  spec_id: 'spec-1',
  spec_revision_id: 'spec-revision-1',
  plan_id: 'plan-1',
  plan_revision_id: 'plan-revision-1',
  project_id: 'project-1',
  repo_id: 'repo-1',
  objective: 'Implement release radar.',
  owner_actor_id: actorOwner,
  reviewer_actor_id: actorReviewer,
  qa_owner_actor_id: 'actor-qa',
  phase: 'release',
  activity_state: 'idle',
  gate_state: 'release_ready',
  resolution: 'completed',
  required_checks: [
    {
      check_id: 'unit-tests',
      display_name: 'Unit tests',
      command: 'pnpm vitest',
      timeout_seconds: 120,
      blocks_review: true,
    },
  ],
  required_artifact_kinds: ['execution_summary'],
  allowed_paths: ['apps/control-plane-api/**'],
  forbidden_paths: ['packages/db/**'],
  last_run_session_id: 'run-session-1',
  current_run_session_id: 'run-session-1',
  created_at: now,
  updated_at: now,
  ...overrides,
});

const runSession = (overrides: Partial<RunSession> = {}): RunSession => ({
  id: 'run-session-1',
  execution_package_id: 'execution-package-1',
  requested_by_actor_id: actorOwner,
  status: 'succeeded',
  executor_type: 'mock',
  changed_files: [],
  check_results: [
    {
      check_id: 'unit-tests',
      command: 'pnpm vitest',
      status: 'succeeded',
      exit_code: 0,
      duration_seconds: 2,
      blocks_review: true,
    },
  ],
  artifacts: [
    {
      kind: 'execution_summary',
      name: 'Execution summary',
      content_type: 'text/markdown',
      storage_uri: 'https://example.test/releases/summary.md',
    },
  ],
  log_refs: [],
  summary: 'Package completed.',
  created_at: now,
  updated_at: later,
  started_at: now,
  finished_at: later,
  ...overrides,
});

const reviewPacket = (overrides: Partial<ReviewPacket> = {}): ReviewPacket => ({
  id: 'review-packet-1',
  run_session_id: 'run-session-1',
  execution_package_id: 'execution-package-1',
  reviewer_actor_id: actorReviewer,
  spec_revision_id: 'spec-revision-1',
  plan_revision_id: 'plan-revision-1',
  status: 'completed',
  decision: 'approved',
  summary: 'Approved for release.',
  changed_files: [],
  check_result_summary: 'Required checks passed.',
  self_review: {
    status: 'succeeded',
    summary: 'Looks good.',
    spec_plan_alignment: 'Aligned.',
    test_assessment: 'Covered.',
    risk_notes: [],
    follow_up_questions: [],
  },
  risk_notes: [],
  reviewed_by_actor_id: actorReviewer,
  reviewed_at: later,
  requested_changes: [],
  created_at: now,
  updated_at: later,
  completed_at: later,
  ...overrides,
});

describe('release module', () => {
  const apps: INestApplication[] = [];

  const track = async <T extends { app: INestApplication }>(value: Promise<T>): Promise<T> => {
    const resolved = await value;
    apps.push(resolved.app);
    return resolved;
  };

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  const createTestApp = async (durabilityMode: RunDurabilityMode = 'volatile_demo') => {
    const repo = new InMemoryP0Repository();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(P0_REPOSITORY)
      .useValue(repo)
      .overrideProvider(RUN_DURABILITY_MODE)
      .useValue(durabilityMode)
      .overrideProvider(P0_DEMO_ACTOR_ID_FALLBACK)
      .useValue(durabilityMode === 'volatile_demo')
      .overrideProvider(RUN_WORKER)
      .useValue({ kick: () => undefined, drainOnce: async () => undefined })
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return { app, repo };
  };

  const seedProject = async (repo: InMemoryP0Repository, id = 'project-1') => {
    await repo.saveProject(project({ id, repo_ids: [`repo-${id}`] }));
  };

  const seedReadyScope = async (
    repo: InMemoryP0Repository,
    overrides: {
      work_item?: Partial<WorkItem>;
      execution_package?: Partial<ExecutionPackage>;
      run_session?: Partial<RunSession>;
      review_packet?: Partial<ReviewPacket>;
    } = {},
  ) => {
    const item = workItem(overrides.work_item);
    const pkg = executionPackage({
      work_item_id: item.id,
      ...overrides.execution_package,
    });
    const run = runSession({
      execution_package_id: pkg.id,
      ...overrides.run_session,
    });
    const packet = reviewPacket({
      execution_package_id: pkg.id,
      run_session_id: run.id,
      ...overrides.review_packet,
    });
    await repo.saveWorkItem(item);
    await repo.saveExecutionPackage(pkg);
    await repo.saveRunSession(run);
    await repo.saveReviewPacket(packet);
    return { workItem: item, executionPackage: pkg, runSession: run, reviewPacket: packet };
  };

  const createRelease = async (
    app: INestApplication,
    body: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ): Promise<{ id: string; body: Record<string, any> }> => {
    const requestBuilder = request(app.getHttpServer()).post('/releases');
    for (const [name, value] of Object.entries(headers)) {
      requestBuilder.set(name, value);
    }
    const response = await requestBuilder.send({
      actor_id: actorOwner,
      project_id: 'project-1',
      title: 'Release Radar',
      ...body,
    }).expect(201);
    return { id: response.body.release.id as string, body: response.body };
  };

  const createReadyRelease = async (
    app: INestApplication,
    repo: InMemoryP0Repository,
    headers: Record<string, string> = {},
  ) => {
    const scope = await seedReadyScope(repo);
    const { id } = await createRelease(app, {
      rollout_strategy: 'Ship behind a feature flag.',
      rollback_plan: 'Disable the feature flag.',
      observation_plan: 'Watch latency for 30 minutes.',
    }, headers);
    await request(app.getHttpServer())
      .post(`/releases/${id}/work-items/${scope.workItem.id}`)
      .set(headers)
      .send({ actor_id: actorOwner })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/releases/${id}/execution-packages/${scope.executionPackage.id}`)
      .set(headers)
      .send({ actor_id: actorOwner })
      .expect(201);
    return { releaseId: id, ...scope };
  };

  it('creates and reads project-scoped release resources with planning blockers', async () => {
    const { app, repo } = await track(createTestApp());
    await seedProject(repo);
    await seedProject(repo, 'other-project');

    const { id, body } = await createRelease(app);

    expect(body.release).toMatchObject({
      id,
      project_id: 'project-1',
      title: 'Release Radar',
      release_owner_actor_id: actorOwner,
      phase: 'draft',
      gate_state: 'not_submitted',
    });
    expect(body.blockers.map((blocker: { code: string }) => blocker.code)).toEqual(
      expect.arrayContaining(['missing_rollout_strategy', 'missing_rollback_plan', 'missing_observation_plan']),
    );

    const list = await request(app.getHttpServer()).get('/releases').query({ project_id: 'project-1' }).expect(200);
    expect(list.body.releases).toEqual([expect.objectContaining({ id })]);

    await request(app.getHttpServer()).get(`/releases/${id}`).query({ project_id: 'other-project' }).expect(404);
  });

  it('uses durable-safe ids and clocks for release-owned rows in durable mode', async () => {
    const { app, repo } = await track(createTestApp('durable'));
    await seedProject(repo);
    const headers = { [actorHeaderName]: actorOwner };

    const { id, body } = await createRelease(app, {}, headers);
    expect(id).toMatch(uuidPattern);
    expect(body.release.created_at).not.toBe('2026-05-05T00:00:01.000Z');

    await request(app.getHttpServer())
      .post(`/releases/${id}/evidences`)
      .set(headers)
      .send({
        actor_id: actorOwner,
        evidence_type: 'observation_note',
        summary: 'Durable observation.',
        extra: {
          observation: {
            source: 'human',
            severity: 'info',
            observed_at: later,
            summary: 'Durable evidence id should be a UUID.',
          },
        },
      })
      .expect(201);
    expect((await repo.listReleaseEvidences(id))[0]?.id).toMatch(uuidPattern);

    const ready = await createReadyRelease(app, repo, headers);
    await request(app.getHttpServer())
      .post(`/releases/${ready.releaseId}/submit-for-approval`)
      .set(headers)
      .send({ actor_id: actorOwner })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/releases/${ready.releaseId}/approve`)
      .set({ [actorHeaderName]: actorReviewer })
      .send({ actor_id: actorOwner })
      .expect(201);
    const decisions = await repo.listDecisionsForObject('release', ready.releaseId);
    expect(decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringMatching(uuidPattern),
          decision_type: 'release_approval',
          decision: 'approved',
        }),
      ]),
    );
  });

  it('requires authenticated actor headers for durable release mutations and ignores spoofed body actors', async () => {
    const { app, repo } = await track(createTestApp('durable'));
    await seedProject(repo);

    await request(app.getHttpServer())
      .post('/releases')
      .send({
        actor_id: actorOwner,
        project_id: 'project-1',
        title: 'Body-only durable release',
      })
      .expect(401);

    const created = await request(app.getHttpServer())
      .post('/releases')
      .set(actorHeaderName, actorReviewer)
      .send({
        actor_id: 'actor-spoofed',
        project_id: 'project-1',
        title: 'Header-authenticated release',
      })
      .expect(201);
    expect(created.body.release).toMatchObject({
      created_by_actor_id: actorReviewer,
      updated_by_actor_id: actorReviewer,
      release_owner_actor_id: actorReviewer,
    });

    await request(app.getHttpServer())
      .patch(`/releases/${created.body.release.id}`)
      .set(actorHeaderName, actorReviewer)
      .send({ actor_id: 'actor-spoofed', title: 'Header actor wins' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.release.updated_by_actor_id).toBe(actorReviewer);
      });

    await request(app.getHttpServer())
      .post(`/releases/${created.body.release.id}/evidences`)
      .set(actorHeaderName, actorReviewer)
      .send({
        actor_id: 'actor-spoofed',
        evidence_type: 'observation_note',
        summary: 'Header actor should own the observation.',
        extra: {
          observation: {
            source: 'human',
            severity: 'info',
            observed_at: later,
            summary: 'Nested actor cannot override durable auth.',
            actor_id: 'actor-spoofed',
          },
        },
      })
      .expect(201);
    expect((await repo.listReleaseEvidences(created.body.release.id))[0]?.extra).toMatchObject({
      observation: { actor_id: actorReviewer },
    });

    const events = await repo.listObjectEvents(created.body.release.id, 'release');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: 'release_created', actor_id: actorReviewer }),
        expect.objectContaining({ event_type: 'release_patched', actor_id: actorReviewer }),
      ]),
    );
  });

  it('filters release lists and paginates with next_cursor', async () => {
    const { app, repo } = await track(createTestApp());
    await seedProject(repo);
    const scope = await seedReadyScope(repo, {
      execution_package: { gate_state: 'not_submitted', phase: 'ready', resolution: 'none' },
    });
    const first = await createRelease(app);
    const second = await createRelease(app, { title: 'Release Radar second' });
    for (const releaseId of [first.id, second.id]) {
      await request(app.getHttpServer()).post(`/releases/${releaseId}/work-items/${scope.workItem.id}`).send({ actor_id: actorOwner }).expect(201);
      await request(app.getHttpServer())
        .post(`/releases/${releaseId}/execution-packages/${scope.executionPackage.id}`)
        .send({ actor_id: actorOwner })
        .expect(201);
      await request(app.getHttpServer()).post(`/releases/${releaseId}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
    }

    const firstPage = await request(app.getHttpServer())
      .get('/releases')
      .query({
        project_id: 'project-1',
        release_owner_actor_id: actorOwner,
        phase: 'approval',
        gate_state: 'awaiting_approval',
        resolution: 'none',
        limit: '1',
      })
      .expect(200);

    expect(firstPage.body.releases).toHaveLength(1);
    expect(firstPage.body.next_cursor).toEqual(expect.any(String));

    const secondPage = await request(app.getHttpServer())
      .get('/releases')
      .query({ project_id: 'project-1', limit: '1', cursor: firstPage.body.next_cursor })
      .expect(200);
    expect(secondPage.body.releases).toHaveLength(1);

    await request(app.getHttpServer()).get('/releases').query({ project_id: 'project-1', limit: '101' }).expect(400);
  });

  it('returns only PublicReleaseSummary fields and filters stale stored scope ids', async () => {
    const { app, repo } = await track(createTestApp());
    await seedProject(repo);
    await seedProject(repo, 'project-2');
    await seedReadyScope(repo);
    await repo.saveWorkItem(workItem({ id: 'work-item-archived', archived_at: later }));
    await repo.saveWorkItem(workItem({ id: 'work-item-deleted', deleted_at: later }));
    await repo.saveWorkItem(workItem({ id: 'work-item-cross-project', project_id: 'project-2' }));
    await repo.saveExecutionPackage(executionPackage({ id: 'package-archived', archived_at: later }));
    await repo.saveExecutionPackage(executionPackage({ id: 'package-deleted', deleted_at: later }));
    await repo.saveExecutionPackage(executionPackage({ id: 'package-cross-project', project_id: 'project-2' }));
    const stored: Release = {
      id: 'release-stale-scope',
      org_id: 'org-1',
      project_id: 'project-1',
      title: 'Stored release',
      phase: 'candidate',
      activity_state: 'idle',
      gate_state: 'not_submitted',
      resolution: 'none',
      work_item_ids: ['work-item-1', 'work-item-archived', 'work-item-deleted', 'work-item-cross-project', 'missing-work-item'],
      execution_package_ids: [
        'execution-package-1',
        'package-archived',
        'package-deleted',
        'package-cross-project',
        'missing-package',
      ],
      extra: { internal: 'do not expose' },
      created_by_actor_id: actorOwner,
      created_at: now,
      updated_at: later,
    };
    await repo.saveRelease(stored);

    const detail = await request(app.getHttpServer())
      .get('/releases/release-stale-scope')
      .query({ project_id: 'project-1' })
      .expect(200);

    expect(detail.body.release.work_item_ids).toEqual(['work-item-1']);
    expect(detail.body.release.execution_package_ids).toEqual(['execution-package-1']);
    expect(Object.keys(detail.body.release).sort()).toEqual(
      [
        'activity_state',
        'created_at',
        'created_by_actor_id',
        'execution_package_ids',
        'gate_state',
        'id',
        'key',
        'org_id',
        'phase',
        'project_id',
        'release_owner_actor_id',
        'release_type',
        'resolution',
        'title',
        'updated_at',
        'updated_by_actor_id',
        'work_item_ids',
      ].sort(),
    );
    expect(detail.body.release).not.toHaveProperty('extra');
    expect(detail.body).not.toHaveProperty('evidences');
    expect(detail.body).not.toHaveProperty('decisions');
    expect(detail.body).not.toHaveProperty('checklist');

    const list = await request(app.getHttpServer()).get('/releases').query({ project_id: 'project-1' }).expect(200);
    expect(list.body.releases).toEqual([
      expect.objectContaining({
        id: 'release-stale-scope',
        work_item_ids: ['work-item-1'],
        execution_package_ids: ['execution-package-1'],
      }),
    ]);
  });

  it('patches mutable release fields and writes audit history', async () => {
    const { app, repo } = await track(createTestApp());
    await seedProject(repo);
    const { id } = await createRelease(app);

    await request(app.getHttpServer())
      .patch(`/releases/${id}`)
      .send({
        actor_id: actorOwner,
        title: 'Release Radar v2',
        scope_summary: 'Updated scope.',
        rollout_strategy: 'Ship behind a feature flag.',
        rollback_plan: 'Disable the feature flag.',
        observation_plan: 'Watch latency for 30 minutes.',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.release).toMatchObject({
          id,
          title: 'Release Radar v2',
          scope_summary: 'Updated scope.',
          rollout_strategy: 'Ship behind a feature flag.',
          rollback_plan: 'Disable the feature flag.',
          observation_plan: 'Watch latency for 30 minutes.',
          updated_by_actor_id: actorOwner,
        });
      });

    await request(app.getHttpServer()).patch(`/releases/${id}`).send({ actor_id: actorOwner }).expect(400);
    await request(app.getHttpServer()).patch('/releases/missing-release').send({ actor_id: actorOwner, title: 'No such release' }).expect(404);

    const events = await repo.listObjectEvents(id, 'release');
    const history = await repo.listStatusHistory(id, 'release');
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ event_type: 'release_patched' })]));
    expect(history).toEqual(expect.arrayContaining([expect.objectContaining({ field_name: 'title', to_value: 'Release Radar v2' })]));
  });

  it('links and unlinks release work items and execution packages with exact responses', async () => {
    const { app, repo } = await track(createTestApp());
    await seedProject(repo);
    const scope = await seedReadyScope(repo);
    const { id } = await createRelease(app);

    await request(app.getHttpServer())
      .post(`/releases/${id}/work-items/${scope.workItem.id}`)
      .send({ actor_id: actorOwner })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual({ release_id: id, object_type: 'work_item', object_id: scope.workItem.id, linked: true });
      });
    await request(app.getHttpServer())
      .delete(`/releases/${id}/work-items/${scope.workItem.id}`)
      .send({ actor_id: actorOwner })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ release_id: id, object_type: 'work_item', object_id: scope.workItem.id, linked: false });
      });
    await request(app.getHttpServer())
      .post(`/releases/${id}/execution-packages/${scope.executionPackage.id}`)
      .send({ actor_id: actorOwner })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual({
          release_id: id,
          object_type: 'execution_package',
          object_id: scope.executionPackage.id,
          linked: true,
        });
      });
    await request(app.getHttpServer())
      .delete(`/releases/${id}/execution-packages/${scope.executionPackage.id}`)
      .send({ actor_id: actorOwner })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          release_id: id,
          object_type: 'execution_package',
          object_id: scope.executionPackage.id,
          linked: false,
        });
      });
  });

  it('rejects missing archived deleted and cross-project links', async () => {
    const { app, repo } = await track(createTestApp());
    await seedProject(repo);
    await seedProject(repo, 'project-2');
    const { id } = await createRelease(app);
    await repo.saveWorkItem(workItem({ id: 'work-item-archived', archived_at: later }));
    await repo.saveWorkItem(workItem({ id: 'work-item-deleted', deleted_at: later }));
    await repo.saveWorkItem(workItem({ id: 'work-item-cross-project', project_id: 'project-2' }));
    await repo.saveExecutionPackage(executionPackage({ id: 'package-archived', archived_at: later }));
    await repo.saveExecutionPackage(executionPackage({ id: 'package-deleted', deleted_at: later }));
    await repo.saveExecutionPackage(executionPackage({ id: 'package-cross-project', project_id: 'project-2' }));

    await request(app.getHttpServer()).post(`/releases/${id}/work-items/missing-work-item`).send({ actor_id: actorOwner }).expect(404);
    await request(app.getHttpServer()).post(`/releases/${id}/work-items/work-item-archived`).send({ actor_id: actorOwner }).expect(422);
    await request(app.getHttpServer()).post(`/releases/${id}/work-items/work-item-deleted`).send({ actor_id: actorOwner }).expect(422);
    await request(app.getHttpServer()).post(`/releases/${id}/work-items/work-item-cross-project`).send({ actor_id: actorOwner }).expect(422);
    await request(app.getHttpServer())
      .post(`/releases/${id}/execution-packages/missing-package`)
      .send({ actor_id: actorOwner })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/releases/${id}/execution-packages/package-archived`)
      .send({ actor_id: actorOwner })
      .expect(422);
    await request(app.getHttpServer())
      .post(`/releases/${id}/execution-packages/package-deleted`)
      .send({ actor_id: actorOwner })
      .expect(422);
    await request(app.getHttpServer())
      .post(`/releases/${id}/execution-packages/package-cross-project`)
      .send({ actor_id: actorOwner })
      .expect(422);
  });

  it('submits, approves, override-approves, requests changes, and re-submits releases', async () => {
    const { app, repo } = await track(createTestApp());
    await seedProject(repo);
    const blockingScope = await seedReadyScope(repo, {
      execution_package: { gate_state: 'not_submitted', phase: 'ready', resolution: 'none' },
    });
    const blocked = await createRelease(app);
    await request(app.getHttpServer()).post(`/releases/${blocked.id}/work-items/${blockingScope.workItem.id}`).send({ actor_id: actorOwner });
    await request(app.getHttpServer())
      .post(`/releases/${blocked.id}/execution-packages/${blockingScope.executionPackage.id}`)
      .send({ actor_id: actorOwner });
    const submitted = await request(app.getHttpServer())
      .post(`/releases/${blocked.id}/submit-for-approval`)
      .send({ actor_id: actorOwner })
      .expect(201);
    expect(submitted.body.release).toMatchObject({ phase: 'approval', gate_state: 'awaiting_approval' });
    await request(app.getHttpServer()).post(`/releases/${blocked.id}/approve`).send({ actor_id: actorReviewer }).expect(422);

    const overridden = await request(app.getHttpServer())
      .post(`/releases/${blocked.id}/override-approve`)
      .send({ actor_id: actorReviewer, rationale: 'Accepted for limited rollout.', blocker_snapshot: submitted.body.blocker_snapshot })
      .expect(201);
    expect(overridden.body.release).toMatchObject({ phase: 'rollout', gate_state: 'approved' });
    expect(overridden.body.overridden_blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'package_not_release_ready' })]),
    );

    const cockpit = await request(app.getHttpServer()).get(`/query/release-cockpit/${blocked.id}`).expect(200);
    expect(cockpit.body.overridden_blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'package_not_release_ready' })]),
    );
    expect(cockpit.body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decision_type: 'manual_override',
          blocker_snapshot: expect.objectContaining({
            blockers: expect.arrayContaining([expect.objectContaining({ code: 'package_not_release_ready' })]),
          }),
        }),
      ]),
    );

    const replay = await request(app.getHttpServer()).get(`/query/replay/release/${blocked.id}`).expect(200);
    expect(replay.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'decision',
          payload: expect.objectContaining({
            decision_type: 'manual_override',
            blocker_snapshot: expect.objectContaining({
              blockers: expect.arrayContaining([expect.objectContaining({ code: 'package_not_release_ready' })]),
            }),
          }),
        }),
      ]),
    );

    const ready = await createReadyRelease(app, repo);
    await request(app.getHttpServer()).post(`/releases/${ready.releaseId}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
    const approved = await request(app.getHttpServer())
      .post(`/releases/${ready.releaseId}/approve`)
      .send({ actor_id: actorReviewer, rationale: 'Release risks are acceptable.' })
      .expect(201);
    expect(approved.body.release).toMatchObject({ phase: 'rollout', gate_state: 'approved' });
    expect(await repo.listDecisionsForObject('release', ready.releaseId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decision_type: 'release_approval',
          decision: 'approved',
          summary: 'Release risks are acceptable.',
          rationale: 'Release risks are acceptable.',
        }),
      ]),
    );

    const staleScope = await seedReadyScope(repo, {
      execution_package: { id: 'execution-package-stale', gate_state: 'not_submitted', phase: 'ready', resolution: 'none' },
      run_session: { id: 'run-session-stale', execution_package_id: 'execution-package-stale' },
      review_packet: { id: 'review-packet-stale', execution_package_id: 'execution-package-stale', run_session_id: 'run-session-stale' },
    });
    const stale = await createRelease(app);
    await request(app.getHttpServer()).post(`/releases/${stale.id}/work-items/${staleScope.workItem.id}`).send({ actor_id: actorOwner });
    await request(app.getHttpServer())
      .post(`/releases/${stale.id}/execution-packages/${staleScope.executionPackage.id}`)
      .send({ actor_id: actorOwner });
    const staleSubmit = await request(app.getHttpServer())
      .post(`/releases/${stale.id}/submit-for-approval`)
      .send({ actor_id: actorOwner })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/releases/${stale.id}`)
      .send({ actor_id: actorOwner, rollout_strategy: 'Added after snapshot.' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/releases/${stale.id}/override-approve`)
      .send({ actor_id: actorReviewer, rationale: 'Old snapshot.', blocker_snapshot: staleSubmit.body.blocker_snapshot })
      .expect(409);

    const changed = await createReadyRelease(app, repo);
    await request(app.getHttpServer()).post(`/releases/${changed.releaseId}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
    const changes = await request(app.getHttpServer())
      .post(`/releases/${changed.releaseId}/request-changes`)
      .send({ actor_id: actorReviewer, rationale: 'Tighten rollout.' })
      .expect(201);
    expect(changes.body.release).toMatchObject({ gate_state: 'changes_requested' });
    await request(app.getHttpServer()).post(`/releases/${changed.releaseId}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
  });

  it('records evidence, validates strict backlinks, and enforces evidence type minimums', async () => {
    const { app, repo } = await track(createTestApp());
    await seedProject(repo);
    const scope = await seedReadyScope(repo);
    const { id } = await createRelease(app);
    await request(app.getHttpServer()).post(`/releases/${id}/work-items/${scope.workItem.id}`).send({ actor_id: actorOwner }).expect(201);
    await request(app.getHttpServer())
      .post(`/releases/${id}/execution-packages/${scope.executionPackage.id}`)
      .send({ actor_id: actorOwner })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post(`/releases/${id}/evidences`)
      .send({
        actor_id: actorReviewer,
        evidence_type: 'observation_note',
        summary: 'Latency looks normal.',
        extra: {
          observation: {
            source: 'human',
            severity: 'info',
            observed_at: later,
            summary: 'No regressions.',
            links: [
              { object_type: 'release', object_id: id, relationship: 'observed' },
              { object_type: 'work_item', object_id: 'work-item-1', relationship: 'affected' },
            ],
          },
        },
      })
      .expect(201);
    expect(response.body.release.updated_by_actor_id).toBe(actorReviewer);
    expect((await repo.getRelease(id))?.updated_by_actor_id).toBe(actorReviewer);
    expect(response.body.blockers.map((blocker: { code: string }) => blocker.code)).not.toContain(
      'unsafe_or_redacted_evidence_backlink',
    );
    expect((await repo.listReleaseEvidences(id))[0]?.extra).toMatchObject({
      observation: { actor_id: actorReviewer },
    });

    await request(app.getHttpServer())
      .post(`/releases/${id}/evidences`)
      .send({
        actor_id: actorOwner,
        evidence_type: 'test_report',
        summary: 'Public test report.',
        artifact_id: 'artifact-public-report',
      })
      .expect(201);
    const testReportEvidence = (await repo.listReleaseEvidences(id)).find(
      (evidence) => evidence.artifact_id === 'artifact-public-report',
    );
    expect(testReportEvidence).toBeDefined();
    const publicArtifact: Artifact = {
      id: 'artifact-public-report',
      object_type: 'release_evidence',
      object_id: testReportEvidence!.id,
      ref: {
        kind: 'execution_summary',
        name: 'release-test-report.md',
        content_type: 'text/markdown',
        storage_uri: 'https://example.test/releases/test-report.md',
      },
      created_at: later,
    };
    await repo.saveArtifact(publicArtifact);
    const publicDecision: Decision = {
      id: 'decision-public-release',
      object_type: 'release',
      object_id: id,
      actor_id: actorReviewer,
      decided_by_actor_id: actorReviewer,
      decision_type: 'release_approval',
      outcome: 'approved',
      decision: 'approved',
      summary: 'Approved for observation link.',
      created_at: later,
    };
    await repo.saveDecision(publicDecision);
    const publicArtifactDecision: Decision = {
      id: 'decision-public-artifact',
      object_type: 'artifact',
      object_id: publicArtifact.id,
      actor_id: actorReviewer,
      decided_by_actor_id: actorReviewer,
      decision_type: 'release_approval',
      outcome: 'approved',
      decision: 'approved',
      summary: 'Public artifact supports the release.',
      created_at: later,
    };
    await repo.saveDecision(publicArtifactDecision);
    const publicReviewDecision: Decision = {
      id: 'decision-public-review-packet',
      object_type: 'review_packet',
      object_id: scope.reviewPacket.id,
      actor_id: actorReviewer,
      decided_by_actor_id: actorReviewer,
      decision_type: 'release_approval',
      outcome: 'approved',
      decision: 'approved',
      summary: 'Selected review packet supports the release.',
      created_at: later,
    };
    await repo.saveDecision(publicReviewDecision);
    const publicBacklinks = await request(app.getHttpServer())
      .post(`/releases/${id}/evidences`)
      .send({
        actor_id: actorOwner,
        evidence_type: 'observation_note',
        summary: 'Public artifact and decision backlinks.',
        extra: {
          observation: {
            source: 'human',
            severity: 'info',
            observed_at: later,
            summary: 'All public refs.',
            links: [
              { object_type: 'artifact', object_id: publicArtifact.id, relationship: 'generated_by' },
              { object_type: 'decision', object_id: publicDecision.id, relationship: 'supports' },
              { object_type: 'decision', object_id: publicArtifactDecision.id, relationship: 'supports' },
              { object_type: 'decision', object_id: publicReviewDecision.id, relationship: 'supports' },
            ],
          },
        },
      })
      .expect(201);
    expect(publicBacklinks.body.blockers.map((blocker: { code: string }) => blocker.code)).not.toContain(
      'unsafe_or_redacted_evidence_backlink',
    );

    await repo.saveRunSession(
      runSession({
        id: 'run-session-old-touch',
        execution_package_id: scope.executionPackage.id,
        created_at: now,
        updated_at: later,
      }),
    );
    await repo.saveRunSession(
      runSession({
        id: 'run-session-new-created',
        execution_package_id: scope.executionPackage.id,
        created_at: later,
        updated_at: now,
      }),
    );
    const runtimeSelection = await request(app.getHttpServer())
      .post(`/releases/${id}/evidences`)
      .send({
        actor_id: actorOwner,
        evidence_type: 'observation_note',
        summary: 'Newly created runtime should be public.',
        extra: {
          observation: {
            source: 'human',
            severity: 'warning',
            observed_at: later,
            summary: 'Created order should win over a later touch.',
            links: [
              { object_type: 'release', object_id: id, relationship: 'observed' },
              { object_type: 'work_item', object_id: scope.workItem.id, relationship: 'affected' },
              { object_type: 'run_session', object_id: 'run-session-new-created', relationship: 'generated_by' },
            ],
          },
        },
      })
      .expect(201);
    expect(runtimeSelection.body.blockers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'unsafe_or_redacted_evidence_backlink',
          object_id: 'run-session-new-created',
        }),
      ]),
    );

    await request(app.getHttpServer())
      .post(`/releases/${id}/evidences`)
      .send({
        actor_id: actorOwner,
        evidence_type: 'observation_note',
        summary: 'Stale artifact id should not be inferred from other artifacts.',
        extra: {
          observation: {
            source: 'human',
            severity: 'warning',
            observed_at: later,
            summary: 'Only the explicit artifact id should count.',
            links: [
              { object_type: 'release', object_id: id, relationship: 'observed' },
              { object_type: 'work_item', object_id: scope.workItem.id, relationship: 'affected' },
              { object_type: 'artifact', object_id: 'artifact-stale', relationship: 'generated_by' },
            ],
          },
        },
      })
      .expect(201);
    const staleArtifactEvidence = (await repo.listReleaseEvidences(id)).find(
      (evidence) => evidence.summary === 'Stale artifact id should not be inferred from other artifacts.',
    );
    expect(staleArtifactEvidence).toBeDefined();
    await repo.saveArtifact({
      id: 'artifact-attached-public',
      object_type: 'release_evidence',
      object_id: staleArtifactEvidence!.id,
      ref: {
        kind: 'execution_summary',
        name: 'attached-summary.md',
        content_type: 'text/markdown',
        storage_uri: 'https://example.test/releases/attached-summary.md',
      },
      created_at: later,
    });
    const patched = await request(app.getHttpServer())
      .patch(`/releases/${id}`)
      .send({
        actor_id: actorOwner,
        title: 'Release Radar v2',
      })
      .expect(200);
    expect(patched.body.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'unsafe_or_redacted_evidence_backlink',
          object_id: staleArtifactEvidence!.id,
        }),
      ]),
    );

    await request(app.getHttpServer())
      .post(`/releases/${id}/evidences`)
      .send({ actor_id: actorOwner, evidence_type: 'observation_note', summary: 'bad', related_object_refs: [] })
      .expect(400);

    const unsafe = await request(app.getHttpServer())
      .post(`/releases/${id}/evidences`)
      .send({
        actor_id: actorOwner,
        evidence_type: 'observation_note',
        summary: 'Backlink points to a non-public object.',
        extra: {
          observation: {
            source: 'human',
            severity: 'warning',
            observed_at: later,
            summary: 'Follow-up needed.',
            links: [
              { object_type: 'release', object_id: id, relationship: 'observed' },
              { object_type: 'work_item', object_id: 'missing-work-item', relationship: 'affected' },
            ],
          },
        },
      })
      .expect(201);
    expect(unsafe.body.blockers.map((blocker: { code: string }) => blocker.code)).toContain(
      'unsafe_or_redacted_evidence_backlink',
    );

    await repo.saveRunSession(runSession({ id: 'run-session-not-current', execution_package_id: scope.executionPackage.id }));
    await repo.saveReviewPacket(
      reviewPacket({
        id: 'review-packet-not-current',
        execution_package_id: scope.executionPackage.id,
        run_session_id: 'run-session-not-current',
      }),
    );
    const staleRuntimeRefs = await request(app.getHttpServer())
      .post(`/releases/${id}/evidences`)
      .send({
        actor_id: actorOwner,
        evidence_type: 'observation_note',
        summary: 'Backlink points to non-current runtime evidence.',
        extra: {
          observation: {
            source: 'human',
            severity: 'warning',
            observed_at: later,
            summary: 'Runtime refs should match cockpit public projection.',
            links: [
              { object_type: 'release', object_id: id, relationship: 'observed' },
              { object_type: 'work_item', object_id: scope.workItem.id, relationship: 'affected' },
              { object_type: 'run_session', object_id: 'run-session-not-current', relationship: 'generated_by' },
              { object_type: 'review_packet', object_id: 'review-packet-not-current', relationship: 'supports' },
            ],
          },
        },
      })
      .expect(201);
    const staleRuntimeEvidence = (await repo.listReleaseEvidences(id)).find(
      (evidence) => evidence.summary === 'Backlink points to non-current runtime evidence.',
    );
    expect(staleRuntimeRefs.body.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'unsafe_or_redacted_evidence_backlink',
          object_id: staleRuntimeEvidence?.id,
        }),
      ]),
    );

    const staleObjectRef = await request(app.getHttpServer())
      .post(`/releases/${id}/evidences`)
      .send({
        actor_id: actorOwner,
        evidence_type: 'observation_note',
        summary: 'Top-level object ref points to non-current runtime evidence.',
        object_ref: { object_type: 'run_session', object_id: 'run-session-not-current', relationship: 'generated_by' },
        extra: {
          observation: {
            source: 'human',
            severity: 'warning',
            observed_at: later,
            summary: 'Top-level object ref should match cockpit public projection.',
            links: [
              { object_type: 'release', object_id: id, relationship: 'observed' },
              { object_type: 'work_item', object_id: scope.workItem.id, relationship: 'affected' },
            ],
          },
        },
      })
      .expect(201);
    const staleObjectRefEvidence = (await repo.listReleaseEvidences(id)).find(
      (evidence) => evidence.summary === 'Top-level object ref points to non-current runtime evidence.',
    );
    expect(staleObjectRef.body.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'unsafe_or_redacted_evidence_backlink',
          object_id: staleObjectRefEvidence?.id,
        }),
      ]),
    );

    await request(app.getHttpServer())
      .post(`/releases/${id}/evidences`)
      .send({ actor_id: actorOwner, evidence_type: 'review_packet', summary: 'bad', object_ref: { object_type: 'work_item', object_id: 'x', relationship: 'supports' } })
      .expect(400);
    await request(app.getHttpServer()).post(`/releases/${id}/evidences`).send({ actor_id: actorOwner, evidence_type: 'test_report', summary: 'bad' }).expect(400);
    await request(app.getHttpServer()).post(`/releases/${id}/evidences`).send({ actor_id: actorOwner, evidence_type: 'build', summary: 'bad' }).expect(400);
    await request(app.getHttpServer()).post(`/releases/${id}/evidences`).send({ actor_id: actorOwner, evidence_type: 'deployment', summary: 'bad' }).expect(400);
    await request(app.getHttpServer())
      .post(`/releases/${id}/evidences`)
      .send({ actor_id: actorOwner, evidence_type: 'metric_snapshot', summary: 'bad', extra: { observation: { source: 'script', severity: 'info', observed_at: later, summary: 'No metrics.' } } })
      .expect(400);
    await request(app.getHttpServer()).post(`/releases/${id}/evidences`).send({ actor_id: actorOwner, evidence_type: 'rollback_record', summary: 'bad' }).expect(400);
    await request(app.getHttpServer())
      .post(`/releases/${id}/evidences`)
      .send({ actor_id: actorOwner, evidence_type: 'rollback_record', summary: 'bad', extra: { rollback: {} } })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/releases/${id}/evidences`)
      .send({ actor_id: actorOwner, evidence_type: 'observation_note', summary: 'bad', extra: { observation: { source: 'human', severity: 'info', observed_at: later } } })
      .expect(400);

    const valid: Array<{ evidence_type: ReleaseEvidenceType; body: Record<string, unknown> }> = [
      {
        evidence_type: 'review_packet',
        body: { object_ref: { object_type: 'review_packet', object_id: 'review-packet-1', relationship: 'supports' } },
      },
      {
        evidence_type: 'test_report',
        body: { object_ref: { object_type: 'artifact', object_id: 'artifact-test-report', relationship: 'generated_by' } },
      },
      { evidence_type: 'test_report', body: { extra: { check_refs: [{ check_id: 'unit-tests', status: 'succeeded' }] } } },
      {
        evidence_type: 'build',
        body: { object_ref: { object_type: 'artifact', object_id: 'artifact-build', relationship: 'generated_by' } },
      },
      { evidence_type: 'build', body: { extra: { build: { build_id: 'build-1', result: 'succeeded' } } } },
      { evidence_type: 'deployment', body: { extra: { deployment: { environment: 'prod', result: 'succeeded' } } } },
      {
        evidence_type: 'metric_snapshot',
        body: {
          extra: {
            observation: { source: 'script', severity: 'info', observed_at: later, summary: 'Healthy.', metrics: { p95: 123 } },
          },
        },
      },
      { evidence_type: 'rollback_record', body: { extra: { rollback: { result: 'not_required' } } } },
      {
        evidence_type: 'observation_note',
        body: { extra: { observation: { source: 'human', severity: 'info', observed_at: later, summary: 'Looks healthy.' } } },
      },
    ];
    for (const item of valid) {
      await request(app.getHttpServer())
        .post(`/releases/${id}/evidences`)
        .send({ actor_id: actorOwner, evidence_type: item.evidence_type, summary: `${item.evidence_type} ok`, ...item.body })
        .expect(201);
    }
  });

  it('starts observing and closes releases with observation or explicit override', async () => {
    const { app, repo } = await track(createTestApp());
    await seedProject(repo);

    const beforeApproval = await createRelease(app);
    await request(app.getHttpServer()).post(`/releases/${beforeApproval.id}/start-observing`).send({ actor_id: actorOwner }).expect(409);

    const completed = await createReadyRelease(app, repo);
    await request(app.getHttpServer()).post(`/releases/${completed.releaseId}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
    await request(app.getHttpServer()).post(`/releases/${completed.releaseId}/approve`).send({ actor_id: actorReviewer }).expect(201);
    await request(app.getHttpServer()).post(`/releases/${completed.releaseId}/start-observing`).send({ actor_id: actorOwner }).expect(201);
    await request(app.getHttpServer())
      .post(`/releases/${completed.releaseId}/close`)
      .send({ actor_id: actorOwner, resolution: 'completed' })
      .expect(422);
    await request(app.getHttpServer())
      .post(`/releases/${completed.releaseId}/evidences`)
      .send({
        actor_id: actorOwner,
        evidence_type: 'observation_note',
        summary: 'Release is healthy.',
        extra: {
          observation: {
            source: 'human',
            severity: 'info',
            observed_at: later,
            summary: 'No regressions.',
            links: [
              { object_type: 'release', object_id: completed.releaseId, relationship: 'observed' },
              { object_type: 'work_item', object_id: completed.workItem.id, relationship: 'affected' },
            ],
          },
        },
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/releases/${completed.releaseId}/close`)
      .send({ actor_id: actorOwner, resolution: 'completed', summary: 'Observed stable after rollout.' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.release).toMatchObject({ phase: 'completed', resolution: 'completed' });
      });
    expect(await repo.listDecisionsForObject('release', completed.releaseId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decision_type: 'release_close',
          decision: 'completed',
          summary: 'Observed stable after rollout.',
        }),
      ]),
    );

    const override = await createReadyRelease(app, repo);
    await request(app.getHttpServer()).post(`/releases/${override.releaseId}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
    await request(app.getHttpServer()).post(`/releases/${override.releaseId}/approve`).send({ actor_id: actorReviewer }).expect(201);
    await request(app.getHttpServer()).post(`/releases/${override.releaseId}/start-observing`).send({ actor_id: actorOwner }).expect(201);
    await request(app.getHttpServer())
      .post(`/releases/${override.releaseId}/close`)
      .send({
        actor_id: actorOwner,
        resolution: 'completed',
        override_without_observation: true,
        override_rationale: 'Manual observation completed in incident room.',
      })
      .expect(201);
    const overrideDecisions = await repo.listDecisionsForObject('release', override.releaseId);
    expect(overrideDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ decision_type: 'manual_override', decision: 'override_approved' }),
        expect.objectContaining({ decision_type: 'release_close', decision: 'completed' }),
      ]),
    );

    const rolledBack = await createReadyRelease(app, repo);
    await request(app.getHttpServer()).post(`/releases/${rolledBack.releaseId}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
    await request(app.getHttpServer()).post(`/releases/${rolledBack.releaseId}/approve`).send({ actor_id: actorReviewer }).expect(201);
    await request(app.getHttpServer())
      .post(`/releases/${rolledBack.releaseId}/close`)
      .send({ actor_id: actorOwner, resolution: 'rolled_back' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.release).toMatchObject({ phase: 'closed', resolution: 'rolled_back', gate_state: 'rollout_failed' });
      });

    const cancelled = await createRelease(app);
    await request(app.getHttpServer())
      .post(`/releases/${cancelled.id}/close`)
      .send({ actor_id: actorOwner, resolution: 'cancelled' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.release).toMatchObject({ phase: 'closed', resolution: 'cancelled' });
      });
  });
});
