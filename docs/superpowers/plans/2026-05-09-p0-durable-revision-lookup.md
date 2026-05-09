# P0 Durable Revision Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make spec and plan revision lookup restart-safe by moving direct revision fetches into the repository and proving the public revision routes and plan generation flows survive a fresh API boot against a durable Postgres-backed repository.

**Architecture:** Treat `P0Repository` as the source of truth for both parent-scoped revision history and direct revision-id lookup. `P0Service` should stop carrying reverse indexes in memory and should resolve revisions through the repository on demand. A separate durable API regression test should boot two fresh Nest apps with separate tracked Drizzle repository instances pointed at the same Postgres database URL to prove restart behavior and the stale/missing `current_revision_id` error semantics.

**Tech Stack:** TypeScript, pnpm workspaces, NestJS, Drizzle ORM, Postgres, Vitest, Supertest, Docker Compose.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-05-09-p0-durable-revision-lookup-design.md`
- Relevant implementation skills: @superpowers:subagent-driven-development, @superpowers:test-driven-development, @superpowers:verification-before-completion

## Scope Guardrails

- Do not change route paths or response shapes.
- Do not add a schema migration.
- Do not add a separate revision registry table.
- Do not replace direct lookup with parent-list scanning.
- Keep collection listing behavior unchanged.
- Keep the stale/missing `current_revision_id` distinctions from the spec:
  - missing current revision pointer on the parent => existing `BadRequestException` from parent validation
  - pointer exists but revision row is missing => `NotFoundException` from direct lookup
- Keep the durable restart regression tied to the Postgres/Drizzle path, not the in-memory adapter.

## File Structure

- Modify `packages/db/src/repositories/p0-repository.ts`
  - Adds direct revision-id lookup to the repository contract.
- Modify `packages/db/src/repositories/in-memory-p0-repository.ts`
  - Implements direct lookup from the in-memory revision maps.
- Modify `packages/db/src/repositories/drizzle-p0-repository.ts`
  - Implements direct lookup by primary key in Postgres.
- Modify `tests/db/repository.test.ts`
  - Covers direct revision lookup in both adapters.
- Modify `apps/control-plane-api/src/p0/p0.service.ts`
  - Removes reverse indexes and uses repository direct lookup.
- Create `tests/api/durable-revision-lookup.test.ts`
  - Boots two fresh API instances with a new tracked `DrizzleP0Repository` and pool per app, all pointed at the same Postgres database URL, and exercises the restart-safe revision routes and generation flows.

## Task 1: Add repository-level direct revision lookup

**Files:**
- Modify: `packages/db/src/repositories/p0-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-p0-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-p0-repository.ts`
- Modify: `tests/db/repository.test.ts`

- [ ] **Step 1: Write the failing in-memory repository tests**

Add focused in-memory tests in `tests/db/repository.test.ts` that prove revisions can be fetched directly by revision id:

```ts
it('gets spec revisions by id and returns undefined for unknown ids', async () => {
  const repository: P0Repository = new InMemoryP0Repository();
  await repository.saveSpec(spec);
  await repository.saveSpecRevision(specRevision);

  const storedRevision = await repository.getSpecRevision(specRevision.id);
  expect(storedRevision).toEqual(specRevision);
  expect(storedRevision).not.toBe(specRevision);
  expect(await repository.getSpecRevision('missing-spec-revision')).toBeUndefined();
});

it('gets plan revisions by id and returns undefined for unknown ids', async () => {
  const repository: P0Repository = new InMemoryP0Repository();
  await repository.savePlan(plan);
  await repository.savePlanRevision(planRevision);

  const storedRevision = await repository.getPlanRevision(planRevision.id);
  expect(storedRevision).toEqual(planRevision);
  expect(storedRevision).not.toBe(planRevision);
  expect(await repository.getPlanRevision('missing-plan-revision')).toBeUndefined();
});
```

- [ ] **Step 2: Run the focused in-memory repository tests and confirm they fail**

Run:

```bash
pnpm vitest run tests/db/repository.test.ts -t "gets spec revisions by id and returns undefined|gets plan revisions by id and returns undefined"
```

Expected: FAIL because `P0Repository` does not yet expose direct revision lookup and `InMemoryP0Repository` does not implement it.

- [ ] **Step 3: Add the repository contract and in-memory implementation**

Update `P0Repository` with:

```ts
getSpecRevision(specRevisionId: string): Promise<SpecRevision | undefined>;
getPlanRevision(planRevisionId: string): Promise<PlanRevision | undefined>;
```

Implement both methods in `InMemoryP0Repository` by reading the stored revision maps. Return cloned records with the existing `cloneMaybe()` helper so direct lookup preserves the adapter's no-mutable-reference behavior.

- [ ] **Step 4: Rerun the in-memory repository tests and confirm they pass**

Run:

```bash
pnpm vitest run tests/db/repository.test.ts -t "gets spec revisions by id and returns undefined|gets plan revisions by id and returns undefined"
```

Expected: PASS.

- [ ] **Step 5: Write the failing Drizzle mapping tests**

Add Drizzle mapping tests near the existing `P0Repository Drizzle adapter persistence mapping` tests. Reuse `createSingleRowRepository()` only for the row-mapping cases, because that helper always returns its single row. Add a separate empty-select helper for the missing-row cases:

```ts
const createEmptySelectRepository = () => {
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
  };

  return new DrizzleP0Repository(db as never);
};

it('maps spec revisions fetched by id', async () => {
  const repository = createSingleRowRepository({
    id: specRevision.id,
    specId: specRevision.spec_id,
    workItemId: specRevision.work_item_id,
    revisionNumber: specRevision.revision_number,
    summary: specRevision.summary,
    content: specRevision.content,
    background: specRevision.background,
    goals: specRevision.goals,
    scopeIn: specRevision.scope_in,
    scopeOut: specRevision.scope_out,
    acceptanceCriteria: specRevision.acceptance_criteria,
    riskNotes: specRevision.risk_notes,
    testStrategySummary: specRevision.test_strategy_summary,
    structuredDocument: specRevision.structured_document,
    artifactRefs: specRevision.artifact_refs,
    authorActorId: null,
    createdAt: specRevision.created_at,
  });

  expect(await repository.getSpecRevision(specRevision.id)).toEqual(specRevision);
});

it('returns undefined for missing spec revisions fetched by id', async () => {
  expect(await createEmptySelectRepository().getSpecRevision('missing-spec-revision')).toBeUndefined();
});

it('maps plan revisions fetched by id', async () => {
  const repository = createSingleRowRepository({
    id: planRevision.id,
    planId: planRevision.plan_id,
    workItemId: planRevision.work_item_id,
    revisionNumber: planRevision.revision_number,
    summary: planRevision.summary,
    content: planRevision.content,
    implementationSummary: planRevision.implementation_summary,
    splitStrategy: planRevision.split_strategy,
    dependencyOrder: planRevision.dependency_order,
    testMatrix: planRevision.test_matrix,
    riskMitigations: planRevision.risk_mitigations,
    rollbackNotes: planRevision.rollback_notes,
    structuredDocument: planRevision.structured_document,
    artifactRefs: planRevision.artifact_refs,
    authorActorId: null,
    createdAt: planRevision.created_at,
  });

  expect(await repository.getPlanRevision(planRevision.id)).toEqual(planRevision);
});

it('returns undefined for missing plan revisions fetched by id', async () => {
  expect(await createEmptySelectRepository().getPlanRevision('missing-plan-revision')).toBeUndefined();
});
```

- [ ] **Step 6: Run the focused Drizzle mapping tests and confirm they fail**

Run:

```bash
pnpm vitest run tests/db/repository.test.ts -t "maps spec revisions fetched by id|maps plan revisions fetched by id|returns undefined for missing spec revisions fetched by id|returns undefined for missing plan revisions fetched by id"
```

Expected: FAIL because `DrizzleP0Repository` does not yet implement direct revision lookup.

- [ ] **Step 7: Add the Drizzle adapter implementation**

Implement both methods in `DrizzleP0Repository` by querying the revision tables by primary key.

- [ ] **Step 8: Rerun all repository lookup tests and confirm they pass**

Run:

```bash
pnpm vitest run tests/db/repository.test.ts -t "gets spec revisions by id and returns undefined|gets plan revisions by id and returns undefined|maps spec revisions fetched by id|maps plan revisions fetched by id|returns undefined for missing spec revisions fetched by id|returns undefined for missing plan revisions fetched by id"
```

Expected: PASS.

- [ ] **Step 9: Commit the repository boundary change**

```bash
git add packages/db/src/repositories/p0-repository.ts packages/db/src/repositories/in-memory-p0-repository.ts packages/db/src/repositories/drizzle-p0-repository.ts tests/db/repository.test.ts
git commit -m "fix: add durable revision lookup to repositories"
```

## Task 2: Remove service reverse indexes and prove restart-safe API behavior

**Files:**
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
- Create: `tests/api/durable-revision-lookup.test.ts`

- [ ] **Step 1: Create the durable API test harness**

Create `tests/api/durable-revision-lookup.test.ts` with a local bootstrap helper that:

- requires `FORGELOOP_DATABASE_URL`
- uses `describe.skipIf(!process.env.FORGELOOP_DATABASE_URL)` so the normal test suite skips cleanly without Postgres
- creates a `DrizzleP0Repository` from `createDbClient({ connectionString })`
- tracks every returned `pool` and closes each one with `await pool.end()` in `afterEach`
- boots two fresh `AppModule` instances, each with a new tracked `DrizzleP0Repository` and pool against the same `FORGELOOP_DATABASE_URL`
- uses explicit provider overrides so the module does not allocate an untracked database pool
- overrides `P0_REPOSITORY` with the tracked `DrizzleP0Repository`
- overrides `RUN_WORKER` with `{ kick: () => undefined, drainOnce: async () => undefined }` so the test only exercises API and repository behavior
- overrides `RUN_DURABILITY_MODE` with `'durable'`
- overrides `P0_DEMO_ACTOR_ID_FALLBACK` with `false`
- truncates touched tables in `beforeEach` so repeated runs do not collide on fixed ids

Use the existing API test override pattern from `tests/api/durable-id-generation.test.ts` as the model. Do not rely on `P0Module.createRepository()` for this test, because that factory creates a database client whose pool is not exposed to the test for teardown.

Start from this harness skeleton:

```ts
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
  RUN_WORKER,
} from '../../apps/control-plane-api/src/p0/p0.service';
import { createDbClient, DrizzleP0Repository, type ForgeloopDb, plans, specs } from '../../packages/db/src';

const connectionString = process.env.FORGELOOP_DATABASE_URL;
const describeIfDb = describe.skipIf(!connectionString);

describeIfDb('durable revision lookup', () => {
  const apps: INestApplication[] = [];
  const pools: Pool[] = [];

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

  beforeEach(async () => {
    await truncateDb();
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(pools.splice(0).map((pool) => pool.end()));
  });

  // fixture helpers and tests go here
});
```

The `truncateDb()` body must use this explicit table list:

```ts
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
```

Add these local fixture helpers. They intentionally mirror `tests/api/delivery-flow.test.ts`, but the plan includes the complete payloads so the implementer does not need to rediscover the state machine order.

```ts
const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const actorQa = 'actor-qa';

const requiredChecks = [
  {
    check_id: 'unit',
    display_name: 'Unit tests',
    command: 'pnpm test tests/api',
    timeout_seconds: 120,
    blocks_review: true,
  },
];

const createProjectRepoWorkItem = async (app: INestApplication) => {
  const server = app.getHttpServer();
  const project = (await request(server).post('/projects').send({ name: 'Forgeloop', owner_actor_id: actorOwner }).expect(201)).body;
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
        kind: 'feature',
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
  await request(server).get(`/spec-revisions/${generatedRevision.id}`).expect(200);
  await request(server).post(`/specs/${spec.id}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
  await request(server).post(`/specs/${spec.id}/approve`).send({ actor_id: actorReviewer }).expect(201);

  return { specId: spec.id, specRevisionId: generatedRevision.id };
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
  await request(server).get(`/plan-revisions/${generatedRevision.id}`).expect(200);
  await request(server).post(`/plans/${plan.id}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
  await request(server).post(`/plans/${plan.id}/approve`).send({ actor_id: actorReviewer }).expect(201);

  return { planId: plan.id, planRevisionId: generatedRevision.id };
};

const createManualPackage = async (
  app: INestApplication,
  planRevisionId: string,
  overrides: Record<string, unknown> = {},
) => {
  const body = {
    repo_id: 'repo-1',
    objective: 'Implement the P0 API package.',
    owner_actor_id: actorOwner,
    reviewer_actor_id: actorReviewer,
    qa_owner_actor_id: actorQa,
    required_checks: requiredChecks,
    required_artifact_kinds: ['execution_summary'],
    allowed_paths: ['apps/control-plane-api/**', 'tests/api/**'],
    forbidden_paths: ['packages/db/**'],
    ...overrides,
  };

  return (await request(app.getHttpServer()).post(`/plan-revisions/${planRevisionId}/execution-packages`).send(body).expect(201)).body;
};
```

- [ ] **Step 2: Write the first failing route-restart test**

Add this exact test name so the Step 3 `-t` filter runs it:

```ts
it('resolves revision routes after restart', async () => {
  const firstApp = await createDurableApp();
  const { workItem } = await createProjectRepoWorkItem(firstApp);
  const { specRevisionId } = await approveSpec(firstApp, workItem.id);
  const { planRevisionId } = await approvePlan(firstApp, workItem.id);

  await closeApp(firstApp);

  const secondApp = await createDurableApp();
  await request(secondApp.getHttpServer()).get(`/spec-revisions/${specRevisionId}`).expect(200);
  await request(secondApp.getHttpServer()).get(`/plan-revisions/${planRevisionId}`).expect(200);
});
```

- [ ] **Step 3: Prepare the durable local database and run the route test in red**

Run:

```bash
docker compose up -d postgres redis temporal
FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm db:push
FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm vitest run tests/api/durable-revision-lookup.test.ts -t "resolves revision routes after restart"
```

Expected: FAIL while `P0Service` still depends on the in-memory reverse indexes.

- [ ] **Step 4: Write the failing plan-draft restart test**

Add this exact test name so the Step 5 `-t` filter runs it. Create a fresh draft plan without generating or approving a plan revision before restart; the state machine only allows draft generation while the plan is still in `draft`.

```ts
it('generates plan drafts after restart', async () => {
  const firstApp = await createDurableApp();
  const { workItem } = await createProjectRepoWorkItem(firstApp);
  await approveSpec(firstApp, workItem.id);
  const plan = await createDraftPlan(firstApp, workItem.id);

  await closeApp(firstApp);

  const secondApp = await createDurableApp();
  await request(secondApp.getHttpServer()).post(`/plans/${plan.id}/generate-draft`).send({}).expect(201);
});
```

- [ ] **Step 5: Run the plan-draft test in red**

Run:

```bash
FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm vitest run tests/api/durable-revision-lookup.test.ts -t "generates plan drafts after restart"
```

Expected: FAIL while `generatePlanDraft()` still resolves the approved current spec revision through the in-memory reverse index.

- [ ] **Step 6: Write the failing package-generation restart test**

Add this exact test name so the Step 7 `-t` filter runs it:

```ts
it('generates packages after restart', async () => {
  const firstApp = await createDurableApp();
  const { workItem } = await createProjectRepoWorkItem(firstApp);
  await approveSpec(firstApp, workItem.id);
  const { planRevisionId } = await approvePlan(firstApp, workItem.id);

  await closeApp(firstApp);

  const secondApp = await createDurableApp();
  await request(secondApp.getHttpServer()).post(`/plan-revisions/${planRevisionId}/generate-packages`).send({}).expect(201);
});
```

- [ ] **Step 7: Run the package-generation test in red**

Run:

```bash
FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm vitest run tests/api/durable-revision-lookup.test.ts -t "generates packages after restart"
```

Expected: FAIL while `packageContext()` still resolves the approved current plan revision through the in-memory reverse index.

- [ ] **Step 8: Write error-semantics characterization/regression tests**

Add focused tests for the spec distinctions:

- missing parent `current_revision_id` on an approved parent fails the current-approved flow with HTTP 400 and a response message from the existing `BadRequestException`; this may already pass before the service refactor and exists to preserve current behavior
- parent `current_revision_id` points at a missing revision row and the current-approved flow surfaces HTTP 404 with a response message from `NotFoundException`; this test may directly mutate Postgres state to create the otherwise-unreachable stale pointer or missing row fixture
- for spec pointer cases, use the plan-draft flow (`POST /plans/:planId/generate-draft`) because it calls `requireApprovedCurrentSpec()` and then rehydrates `spec.current_revision_id`
- for plan pointer cases, use the package-generation flow (`POST /plan-revisions/:planRevisionId/generate-packages`) because it calls `packageContext()` and rehydrates the current plan revision
- assert these cases through HTTP status and response message rather than by inspecting internal exception classes

Use these exact test names and fixture mutations:

```ts
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

it('returns 404 when approved plan current_revision_id points to a missing revision', async () => {
  const app = await createDurableApp();
  const { workItem } = await createProjectRepoWorkItem(app);
  await approveSpec(app, workItem.id);
  const { planId } = await approvePlan(app, workItem.id);
  await withDb(async (db) => {
    await db.update(plans).set({ currentRevisionId: 'missing-plan-revision' }).where(eq(plans.id, planId));
  });

  const response = await request(app.getHttpServer()).post('/plan-revisions/missing-plan-revision/generate-packages').send({}).expect(404);
  expect(response.body.message).toContain('PlanRevision missing-plan-revision not found');
});
```

- [ ] **Step 9: Run the error-semantics tests before the refactor**

Run:

```bash
FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm vitest run tests/api/durable-revision-lookup.test.ts -t "current_revision_id|missing revision"
```

Expected: treat these as characterization/regression tests, not the red gate for the restart bug. If any fixture returns an unexpected status or message, fix the fixture before refactoring. The red gates for the bug are Steps 3, 5, and 7; these error-semantics tests may pass before the refactor and must pass after it.

- [ ] **Step 10: Refactor `P0Service` to use repository direct lookup**

In `apps/control-plane-api/src/p0/p0.service.ts`:

- make the smallest service change needed for direct revision lookup; if unrelated behavior appears necessary, stop and re-check the spec before broadening the change
- remove `specRevisionIndex` and `planRevisionIndex`
- change `getSpecRevision()` to call `repository.getSpecRevision(specRevisionId)` directly
- change `getPlanRevision()` to call `repository.getPlanRevision(planRevisionId)` directly
- keep `NotFoundException` for missing revision rows
- keep `BadRequestException` only when a flow requires the current approved revision and the parent pointer is missing or points at a different existing revision
- let a parent pointer that points at a missing revision row surface `NotFoundException`
- leave `saveSpecRevision()` and `savePlanRevision()` responsible for updating the parent object’s `current_revision_id`
- leave list endpoints and timeline assembly unchanged

- [ ] **Step 11: Run each durable regression and confirm it passes**

Run:

```bash
FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm vitest run tests/api/durable-revision-lookup.test.ts -t "resolves revision routes after restart"
FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm vitest run tests/api/durable-revision-lookup.test.ts -t "generates plan drafts after restart"
FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm vitest run tests/api/durable-revision-lookup.test.ts -t "generates packages after restart"
FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm vitest run tests/api/durable-revision-lookup.test.ts -t "current_revision_id|missing revision"
```

Expected: PASS.

- [ ] **Step 12: Commit the service and durable regression change**

```bash
git add apps/control-plane-api/src/p0/p0.service.ts tests/api/durable-revision-lookup.test.ts
git commit -m "fix: make durable revision lookup restart-safe"
```

## Task 3: Final verification and handoff

**Files:**
- None (verification only)

- [ ] **Step 1: Run the focused regression set**

Run:

```bash
pnpm vitest run tests/db/repository.test.ts tests/api/durable-revision-lookup.test.ts
```

Expected: PASS, with the durable API test only running when `FORGELOOP_DATABASE_URL` is present.

- [ ] **Step 2: Run the full repository checks**

Run:

```bash
pnpm test
pnpm build
git diff --check
```

Expected: PASS.

- [ ] **Step 3: Confirm the durable path one last time**

Do not close the task based only on a skipped no-env durable test. Rerun the durable regression with the Postgres-backed environment before closing:

```bash
docker compose up -d postgres redis temporal
FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm db:push
FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm vitest run tests/api/durable-revision-lookup.test.ts
```

Expected: PASS with the durable API tests actually executed, not skipped.
