import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import {
  P0_DEMO_ACTOR_ID_FALLBACK,
  P0_REPOSITORY,
  RUN_DURABILITY_MODE,
} from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { RUN_WORKER } from '../../apps/control-plane-api/src/p0/p0.service';
import { createDbClient, DrizzleP0Repository, type ForgeloopDb, plan_revisions, plans, specs } from '../../packages/db/src';

const connectionString =
  process.env.FORGELOOP_TEST_DATABASE_URL?.trim() || process.env.FORGELOOP_DATABASE_URL?.trim() || undefined;

const assertSafeTestDatabaseUrl = (url: string): void => {
  const parsed = new URL(url);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!databaseName.toLowerCase().includes('test')) {
    throw new Error(
      `durable revision lookup tests truncate P0 tables; refusing database "${databaseName}". ` +
        'Set FORGELOOP_TEST_DATABASE_URL or FORGELOOP_DATABASE_URL to a disposable database whose name contains "test".',
    );
  }
};

if (connectionString !== undefined) {
  assertSafeTestDatabaseUrl(connectionString);
}

const describeIfDb = describe.skipIf(connectionString === undefined);

describeIfDb('durable revision lookup', () => {
  const apps: INestApplication[] = [];
  const pools: Pool[] = [];

  const actorOwner = 'actor-owner';
  const actorReviewer = 'actor-reviewer';

  const createTrackedClient = () => {
    const client = createDbClient({ connectionString: connectionString! });
    pools.push(client.pool);
    return client;
  };

  const withDb = async <T>(write: (db: ForgeloopDb) => Promise<T>): Promise<T> => {
    const { db, pool } = createDbClient({ connectionString: connectionString! });
    try {
      return await write(db);
    } finally {
      await pool.end();
    }
  };

  const createDurableApp = async (): Promise<INestApplication> => {
    const { db } = createTrackedClient();
    const repository = new DrizzleP0Repository(db);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(P0_REPOSITORY)
      .useValue(repository)
      .overrideProvider(RUN_WORKER)
      .useValue({ kick: () => undefined, drainOnce: async () => undefined })
      .overrideProvider(RUN_DURABILITY_MODE)
      .useValue('durable')
      .overrideProvider(P0_DEMO_ACTOR_ID_FALLBACK)
      .useValue(false)
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    expect(app.get(P0_REPOSITORY)).toBe(repository);
    apps.push(app);
    return app;
  };

  const closeApp = async (app: INestApplication): Promise<void> => {
    await app.close();
    const index = apps.indexOf(app);
    if (index >= 0) {
      apps.splice(index, 1);
    }
  };

  const truncateDb = async (): Promise<void> =>
    withDb(async (db) => {
      await db.execute(sql`
        truncate table
          trace_artifact_refs,
          trace_links,
          trace_events,
          decisions,
          artifacts,
          status_histories,
          object_events,
          review_packets,
          run_worker_leases,
          run_commands,
          run_events,
          run_event_counters,
          run_sessions,
          execution_package_dependencies,
          execution_packages,
          plan_revisions,
          plans,
          spec_revisions,
          specs,
          work_items,
          project_repos,
          projects
        restart identity cascade
      `);
    });

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
          kind: 'requirement',
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
          risk_notes: ['Keep P0 durable for restart tests'],
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
    const generatedRevisionResponse = await request(server).get(`/spec-revisions/${generatedRevision.id}`).expect(200);
    expect(generatedRevisionResponse.body.id).toBe(generatedRevision.id);
    await request(server).post(`/specs/${spec.id}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
    await request(server).post(`/specs/${spec.id}/approve`).send({ actor_id: actorReviewer }).expect(201);

    return { specId: spec.id, specRevisionId: generatedRevision.id, manualSpecRevisionId: manualRevision.id };
  };

  const createDraftPlan = async (app: INestApplication, workItemId: string) => {
    return (await request(app.getHttpServer()).post(`/work-items/${workItemId}/plans`).send({}).expect(201)).body;
  };

  const approvePlan = async (app: INestApplication, workItemId: string) => {
    const server = app.getHttpServer();
    const plan = await createDraftPlan(app, workItemId);
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
          risk_mitigations: ['Use durable repository in restart tests'],
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
    const generatedRevisionResponse = await request(server).get(`/plan-revisions/${generatedRevision.id}`).expect(200);
    expect(generatedRevisionResponse.body.id).toBe(generatedRevision.id);
    await request(server).post(`/plans/${plan.id}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
    await request(server).post(`/plans/${plan.id}/approve`).send({ actor_id: actorReviewer }).expect(201);

    return { planId: plan.id, planRevisionId: generatedRevision.id, manualPlanRevisionId: manualRevision.id };
  };

  beforeEach(async () => {
    await truncateDb();
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(pools.splice(0).map((pool) => pool.end()));
  });

  it('resolves revision routes after restart', async () => {
    const firstApp = await createDurableApp();
    const { workItem } = await createProjectRepoWorkItem(firstApp);
    const { specRevisionId } = await approveSpec(firstApp, workItem.id);
    const { planRevisionId } = await approvePlan(firstApp, workItem.id);

    await closeApp(firstApp);

    const secondApp = await createDurableApp();
    const specRevisionResponse = await request(secondApp.getHttpServer()).get(`/spec-revisions/${specRevisionId}`).expect(200);
    expect(specRevisionResponse.body.id).toBe(specRevisionId);
    const planRevisionResponse = await request(secondApp.getHttpServer()).get(`/plan-revisions/${planRevisionId}`).expect(200);
    expect(planRevisionResponse.body.id).toBe(planRevisionId);
  });

  it('generates plan drafts after restart', async () => {
    const firstApp = await createDurableApp();
    const { workItem } = await createProjectRepoWorkItem(firstApp);
    await approveSpec(firstApp, workItem.id);
    const plan = await createDraftPlan(firstApp, workItem.id);

    await closeApp(firstApp);

    const secondApp = await createDurableApp();
    await request(secondApp.getHttpServer()).post(`/plans/${plan.id}/generate-draft`).send({}).expect(201);
  });

  it('generates packages after restart', async () => {
    const firstApp = await createDurableApp();
    const { workItem } = await createProjectRepoWorkItem(firstApp);
    await approveSpec(firstApp, workItem.id);
    const { planRevisionId } = await approvePlan(firstApp, workItem.id);

    await closeApp(firstApp);

    const secondApp = await createDurableApp();
    await request(secondApp.getHttpServer()).post(`/plan-revisions/${planRevisionId}/generate-packages`).send({}).expect(201);
  });

  it('resolves direct spec revision lookup when parent current_revision_id is missing', async () => {
    const app = await createDurableApp();
    const { workItem } = await createProjectRepoWorkItem(app);
    const { specId, specRevisionId } = await approveSpec(app, workItem.id);
    await withDb(async (db) => {
      await db.update(specs).set({ currentRevisionId: null }).where(eq(specs.id, specId));
    });

    const specRevisionResponse = await request(app.getHttpServer()).get(`/spec-revisions/${specRevisionId}`).expect(200);
    expect(specRevisionResponse.body.id).toBe(specRevisionId);
  });

  it('resolves direct plan revision lookup when parent current_revision_id is stale', async () => {
    const app = await createDurableApp();
    const { workItem } = await createProjectRepoWorkItem(app);
    await approveSpec(app, workItem.id);
    const { planId, planRevisionId, manualPlanRevisionId } = await approvePlan(app, workItem.id);
    await withDb(async (db) => {
      await db.update(plans).set({ currentRevisionId: manualPlanRevisionId }).where(eq(plans.id, planId));
    });

    const planRevisionResponse = await request(app.getHttpServer()).get(`/plan-revisions/${planRevisionId}`).expect(200);
    expect(planRevisionResponse.body.id).toBe(planRevisionId);
  });

  it('returns 400 when approved spec current_revision_id is missing', async () => {
    const app = await createDurableApp();
    const { workItem } = await createProjectRepoWorkItem(app);
    const { specId } = await approveSpec(app, workItem.id);
    const plan = await createDraftPlan(app, workItem.id);
    await withDb(async (db) => {
      await db.update(specs).set({ currentRevisionId: null }).where(eq(specs.id, specId));
    });

    const response = await request(app.getHttpServer()).post(`/plans/${plan.id}/generate-draft`).send({}).expect(400);
    expect(response.body.message).toContain(`Spec ${specId} is not approved`);
  });

  it('returns 404 when approved spec current_revision_id points to a missing revision', async () => {
    const app = await createDurableApp();
    const { workItem } = await createProjectRepoWorkItem(app);
    const { specId } = await approveSpec(app, workItem.id);
    const plan = await createDraftPlan(app, workItem.id);
    await withDb(async (db) => {
      await db.update(specs).set({ currentRevisionId: 'missing-spec-revision' }).where(eq(specs.id, specId));
    });

    const response = await request(app.getHttpServer()).post(`/plans/${plan.id}/generate-draft`).send({}).expect(404);
    expect(response.body.message).toContain('SpecRevision missing-spec-revision not found');
  });

  it('returns 400 when approved plan current_revision_id is missing', async () => {
    const app = await createDurableApp();
    const { workItem } = await createProjectRepoWorkItem(app);
    await approveSpec(app, workItem.id);
    const { planId, planRevisionId } = await approvePlan(app, workItem.id);
    await withDb(async (db) => {
      await db.update(plans).set({ currentRevisionId: null }).where(eq(plans.id, planId));
    });

    const response = await request(app.getHttpServer()).post(`/plan-revisions/${planRevisionId}/generate-packages`).send({}).expect(400);
    expect(response.body.message).toContain(`PlanRevision ${planRevisionId} is not current approved revision`);
  });

  it('returns 400 when approved plan current_revision_id points away from the requested revision', async () => {
    const app = await createDurableApp();
    const { workItem } = await createProjectRepoWorkItem(app);
    await approveSpec(app, workItem.id);
    const { planId, manualPlanRevisionId, planRevisionId } = await approvePlan(app, workItem.id);
    await withDb(async (db) => {
      await db.update(plans).set({ currentRevisionId: manualPlanRevisionId }).where(eq(plans.id, planId));
    });

    const response = await request(app.getHttpServer()).post(`/plan-revisions/${planRevisionId}/generate-packages`).send({}).expect(400);
    expect(response.body.message).toContain(`PlanRevision ${planRevisionId} is not current approved revision`);
  });

  it('returns 404 when approved plan current_revision_id points to a missing revision', async () => {
    const app = await createDurableApp();
    const { workItem } = await createProjectRepoWorkItem(app);
    await approveSpec(app, workItem.id);
    const { planId, planRevisionId } = await approvePlan(app, workItem.id);
    await withDb(async (db) => {
      await db.update(plans).set({ currentRevisionId: 'missing-plan-revision' }).where(eq(plans.id, planId));
    });

    const response = await request(app.getHttpServer()).post(`/plan-revisions/${planRevisionId}/generate-packages`).send({}).expect(404);
    expect(response.body.message).toContain('PlanRevision missing-plan-revision not found');
  });

  it('returns 404 when the approved plan revision row is missing', async () => {
    const app = await createDurableApp();
    const { workItem } = await createProjectRepoWorkItem(app);
    await approveSpec(app, workItem.id);
    const { planRevisionId } = await approvePlan(app, workItem.id);
    await withDb(async (db) => {
      await db.delete(plan_revisions).where(eq(plan_revisions.id, planRevisionId));
    });

    const response = await request(app.getHttpServer()).post(`/plan-revisions/${planRevisionId}/generate-packages`).send({}).expect(404);
    expect(response.body.message).toContain(`PlanRevision ${planRevisionId} not found`);
  });
});
