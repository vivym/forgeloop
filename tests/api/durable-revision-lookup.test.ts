import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import {
  DELIVERY_REPOSITORY,
  RUN_DURABILITY_MODE,
} from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import { createDbClient, DrizzleDeliveryRepository, type ForgeloopDb, plan_revisions, plans, specs } from '../../packages/db/src';
import { seedItemScopedSpecPlan } from '../helpers/item-scoped-artifact-fixtures';
import { createWorkflowPolicyRepoRoot } from '../helpers/runtime-policy-repo';

const connectionString =
  process.env.FORGELOOP_TEST_DATABASE_URL?.trim() || process.env.FORGELOOP_DATABASE_URL?.trim() || undefined;

const assertSafeTestDatabaseUrl = (url: string): void => {
  const parsed = new URL(url);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!databaseName.toLowerCase().includes('test')) {
    throw new Error(
      `durable revision lookup tests truncate delivery tables; refusing database "${databaseName}". ` +
        'Set FORGELOOP_TEST_DATABASE_URL or FORGELOOP_DATABASE_URL to a disposable database whose name contains "test".',
    );
  }
};

if (connectionString !== undefined) {
  assertSafeTestDatabaseUrl(connectionString);
}

const describeIfDb = describe.skipIf(connectionString === undefined);
const requirementIntakeContext = {
  type: 'requirement',
  stakeholder_problem: 'Durable revision lookup fixtures need typed intake context.',
  desired_outcome: 'Revision lookup tests create valid requirement Work Items.',
  acceptance_criteria: ['Spec and plan revisions can be looked up durably.'],
  in_scope: ['Durable revision lookup tests'],
};

describeIfDb('durable revision lookup', () => {
  const apps: INestApplication[] = [];
  const pools: Pool[] = [];

  const organizationId = '11111111-1111-4111-8111-111111111111';
  const actorOwner = '11111111-1111-4111-8111-111111111112';
  const actorReviewer = '11111111-1111-4111-8111-111111111113';
  const actorItemReviewer = '11111111-1111-4111-8111-111111111114';
  const missingSpecRevisionId = '00000000-0000-4000-8000-00000000dead';
  const stalePlanRevisionId = '00000000-0000-4000-8000-00000000cafe';
  const missingPlanRevisionId = '00000000-0000-4000-8000-00000000beef';

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
    const repository = new DrizzleDeliveryRepository(db);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DELIVERY_REPOSITORY)
      .useValue(repository)
      .overrideProvider(DELIVERY_RUN_WORKER)
      .useValue({ kick: () => undefined, drainOnce: async () => undefined })
      .overrideProvider(RUN_DURABILITY_MODE)
      .useValue('durable')
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    expect(app.get(DELIVERY_REPOSITORY)).toBe(repository);
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
          executions,
          execution_plan_revisions,
          execution_plans,
          plan_revisions,
          plans,
          spec_revisions,
          specs,
          boundary_summary_revisions,
          boundary_summaries,
          brainstorming_sessions,
          context_manifests,
          development_plan_item_revisions,
          development_plan_items,
          development_plan_source_links,
          development_plan_revisions,
          development_plans,
          work_items,
          project_repos,
          projects
        restart identity cascade
      `);
    });

  const createProjectRepoWorkItem = async (app: INestApplication) => {
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DrizzleDeliveryRepository;
    const now = '2026-05-24T00:00:00.000Z';
    await repository.saveOrganization({
      id: organizationId,
      name: 'ForgeLoop Durable Revision Test Org',
      created_at: now,
      updated_at: now,
    });
    await repository.saveActor({
      id: actorOwner,
      org_id: organizationId,
      display_name: 'Durable Revision Owner',
      actor_type: 'human',
      email: 'owner@example.test',
      created_at: now,
      updated_at: now,
    });
    await repository.saveActor({
      id: actorReviewer,
      org_id: organizationId,
      display_name: 'Durable Revision Reviewer',
      actor_type: 'human',
      email: 'reviewer@example.test',
      created_at: now,
      updated_at: now,
    });
    await repository.saveActor({
      id: actorItemReviewer,
      org_id: organizationId,
      display_name: 'Durable Revision Item Reviewer',
      actor_type: 'human',
      email: 'item-reviewer@example.test',
      created_at: now,
      updated_at: now,
    });

    const project = (
      await request(server).post('/projects').send({ name: 'Forgeloop', owner_actor_id: actorOwner }).expect(201)
    ).body;
    const repo = (
      await request(server)
        .post(`/projects/${project.id}/repos`)
        .send({
          repo_id: 'repo-1',
          name: 'forgeloop',
          local_path: await createWorkflowPolicyRepoRoot(),
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
          title: 'Ship delivery control plane API',
          goal: 'Expose the delivery loop commands over REST.',
          success_criteria: ['Spec, plan, package, run, and review commands are available.'],
          priority: 'P0',
          risk: 'medium',
          driver_actor_id: actorOwner,
          intake_context: requirementIntakeContext,
        })
        .expect(201)
    ).body;

    return { project, repo, workItem };
  };

  const approveSpec = async (app: INestApplication, workItemId: string) => {
    const server = app.getHttpServer();
    const { spec, specRevision } = await seedItemScopedSpecPlan(app, workItemId, {
      actorId: actorOwner,
      reviewerActorId: actorReviewer,
      includePlan: false,
    });
    const generatedRevisionResponse = await request(server).get(`/spec-revisions/${specRevision.id}`).expect(200);
    expect(generatedRevisionResponse.body.id).toBe(specRevision.id);

    return { specId: spec.id, specRevisionId: specRevision.id };
  };

  const seedApprovedSpecItem = async (app: INestApplication, workItemId: string) =>
    seedItemScopedSpecPlan(app, workItemId, {
      actorId: actorOwner,
      reviewerActorId: actorReviewer,
      includePlan: false,
    });

  const approvePlan = async (app: INestApplication, workItemId: string) => {
    const server = app.getHttpServer();
    const { plan, planRevision } = await seedItemScopedSpecPlan(app, workItemId, {
      actorId: actorOwner,
      reviewerActorId: actorReviewer,
      itemReviewerActorId: actorItemReviewer,
    });
    const generatedRevisionResponse = await request(server).get(`/plan-revisions/${planRevision!.id}`).expect(200);
    expect(generatedRevisionResponse.body.id).toBe(planRevision!.id);

    return { planId: plan.id, planRevisionId: planRevision!.id, manualPlanRevisionId: planRevision!.id };
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

  it('generates item-scoped Implementation Plan Doc drafts after restart', async () => {
    const firstApp = await createDurableApp();
    const { workItem } = await createProjectRepoWorkItem(firstApp);
    const seed = await seedApprovedSpecItem(firstApp, workItem.id);

    await closeApp(firstApp);

    const secondApp = await createDurableApp();
    await request(secondApp.getHttpServer())
      .post(`/development-plans/${seed.developmentPlan.id}/items/${seed.item.id}/implementation-plan/generate-draft`)
      .send({ actor_id: actorOwner })
      .expect(201);
  });

  it('generates packages after restart', async () => {
    const firstApp = await createDurableApp();
    const { workItem } = await createProjectRepoWorkItem(firstApp);
    await approveSpec(firstApp, workItem.id);
    const { planRevisionId } = await approvePlan(firstApp, workItem.id);

    await closeApp(firstApp);

    const secondApp = await createDurableApp();
    const response = await request(secondApp.getHttpServer()).post(`/plan-revisions/${planRevisionId}/generate-packages`).send({}).expect(201);
    expect(response.body[0]).toMatchObject({
      reviewer_actor_id: actorItemReviewer,
      qa_owner_actor_id: actorOwner,
    });
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
    const seed = await seedApprovedSpecItem(app, workItem.id);
    await withDb(async (db) => {
      await db.update(specs).set({ currentRevisionId: null }).where(eq(specs.id, seed.spec.id));
    });

    const response = await request(app.getHttpServer())
      .post(`/development-plans/${seed.developmentPlan.id}/items/${seed.item.id}/implementation-plan/generate-draft`)
      .send({ actor_id: actorOwner })
      .expect(400);
    expect(response.body.message).toContain('approved_spec_not_current');
  });

  it('returns 400 when the approved spec revision row is missing for item-scoped Implementation Plan Doc generation', async () => {
    const app = await createDurableApp();
    const { workItem } = await createProjectRepoWorkItem(app);
    const seed = await seedApprovedSpecItem(app, workItem.id);
    await withDb(async (db) => {
      await db
        .update(specs)
        .set({ approvedRevisionId: missingSpecRevisionId, currentRevisionId: missingSpecRevisionId })
        .where(eq(specs.id, seed.spec.id));
    });

    const response = await request(app.getHttpServer())
      .post(`/development-plans/${seed.developmentPlan.id}/items/${seed.item.id}/implementation-plan/generate-draft`)
      .send({ actor_id: actorOwner })
      .expect(400);
    expect(response.body.message).toContain('approved_spec_revision_not_loaded');
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
    const { planId, planRevisionId } = await approvePlan(app, workItem.id);
    await withDb(async (db) => {
      await db.update(plans).set({ currentRevisionId: stalePlanRevisionId }).where(eq(plans.id, planId));
    });

    const response = await request(app.getHttpServer()).post(`/plan-revisions/${planRevisionId}/generate-packages`).send({}).expect(400);
    expect(response.body.message).toContain(`PlanRevision ${planRevisionId} is not current approved revision`);
  });

  it('returns 400 when approved plan current_revision_id points to a missing revision id', async () => {
    const app = await createDurableApp();
    const { workItem } = await createProjectRepoWorkItem(app);
    await approveSpec(app, workItem.id);
    const { planId, planRevisionId } = await approvePlan(app, workItem.id);
    await withDb(async (db) => {
      await db.update(plans).set({ currentRevisionId: missingPlanRevisionId }).where(eq(plans.id, planId));
    });

    const response = await request(app.getHttpServer()).post(`/plan-revisions/${planRevisionId}/generate-packages`).send({}).expect(400);
    expect(response.body.message).toContain(`PlanRevision ${planRevisionId} is not current approved revision`);
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
