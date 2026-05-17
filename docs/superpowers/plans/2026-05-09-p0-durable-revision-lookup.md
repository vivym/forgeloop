> Superseded historical migration note: this document mentions the old subsystem name for audit history only. Current commands, routes, files, and product docs use delivery terminology.

# P0 Durable Revision Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make spec and plan revision lookup restart-safe by moving direct revision fetches into the repository and proving the public revision routes and plan generation flows survive a fresh API boot against a durable Postgres-backed repository.

**Architecture:** Treat `P0Repository` as the source of truth for both parent-scoped revision history and direct revision-id lookup. `P0Service` should stop carrying reverse indexes in memory and should resolve revisions through the repository on demand. A separate durable API regression test should boot two fresh Nest apps with separate tracked Drizzle repository instances pointed at the same Postgres database URL to prove restart behavior and the stale/missing `current_revision_id` error semantics.

**Tech Stack:** TypeScript, pnpm workspaces, NestJS, Drizzle ORM, Postgres, Vitest, Supertest, Docker Compose.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-05-09-p0-durable-revision-lookup-design.md`
- Relevant implementation skills: @superpowers:subagent-driven-development, @superpowers:test-driven-development, @superpowers:verification-before-completion

## Current Worktree Status

This worktree has already executed the first implementation slice:

- `167f084 fix: add durable revision lookup to repositories` completed the repository contract and adapter work from Task 1.
- `8d5458a fix: make durable revision lookup restart-safe` completed the initial service refactor and durable API regression test scaffold from Task 2.

The original red/green steps below still document the intended TDD path when replaying from the pre-change baseline. When continuing from this current worktree, do not treat Task 1 or Task 2 Steps 3/5/7 as expected failures. Treat them as verification gates that should pass.

Final review fixes applied in the follow-up commit:

- direct route tests assert the returned revision id, not only HTTP 200
- direct revision routes still resolve existing revision rows when the parent `current_revision_id` is missing or stale
- `packageContext()` dereferences a nonmatching approved plan `current_revision_id` before returning the current-approved mismatch error
- missing approved plan `current_revision_id` rows surface `NotFoundException`
- durable API test cleanup is guarded behind a disposable database URL whose database name contains `test`; prefer `FORGELOOP_TEST_DATABASE_URL` for the test run

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

- [x] **Step 1: Write the failing in-memory repository tests**

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

- [x] **Step 2: Run the focused in-memory repository tests**

Run:

```bash
pnpm vitest run tests/db/repository.test.ts -t "gets spec revisions by id and returns undefined|gets plan revisions by id and returns undefined"
```

Expected from the pre-change baseline: FAIL because `P0Repository` does not yet expose direct revision lookup and `InMemoryP0Repository` does not implement it.

Current worktree status after `167f084`: PASS. Do not report this as an expected failure when continuing from this worktree.

- [x] **Step 3: Add the repository contract and in-memory implementation**

Update `P0Repository` with:

```ts
getSpecRevision(specRevisionId: string): Promise<SpecRevision | undefined>;
getPlanRevision(planRevisionId: string): Promise<PlanRevision | undefined>;
```

Implement both methods in `InMemoryP0Repository` by reading the stored revision maps. Return cloned records with the existing `cloneMaybe()` helper so direct lookup preserves the adapter's no-mutable-reference behavior.

- [x] **Step 4: Rerun the in-memory repository tests and confirm they pass**

Run:

```bash
pnpm vitest run tests/db/repository.test.ts -t "gets spec revisions by id and returns undefined|gets plan revisions by id and returns undefined"
```

Expected: PASS.

- [x] **Step 5: Write the failing Drizzle mapping tests**

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

- [x] **Step 6: Run the focused Drizzle mapping tests**

Run:

```bash
pnpm vitest run tests/db/repository.test.ts -t "maps spec revisions fetched by id|maps plan revisions fetched by id|returns undefined for missing spec revisions fetched by id|returns undefined for missing plan revisions fetched by id"
```

Expected from the pre-change baseline: FAIL because `DrizzleP0Repository` does not yet implement direct revision lookup.

Current worktree status after `167f084`: PASS. Do not report this as an expected failure when continuing from this worktree.

- [x] **Step 7: Add the Drizzle adapter implementation**

Implement both methods in `DrizzleP0Repository` by querying the revision tables by primary key.

- [x] **Step 8: Rerun all repository lookup tests and confirm they pass**

Run:

```bash
pnpm vitest run tests/db/repository.test.ts -t "gets spec revisions by id and returns undefined|gets plan revisions by id and returns undefined|maps spec revisions fetched by id|maps plan revisions fetched by id|returns undefined for missing spec revisions fetched by id|returns undefined for missing plan revisions fetched by id"
```

Expected: PASS.

- [x] **Step 9: Commit the repository boundary change**

```bash
git add packages/db/src/repositories/p0-repository.ts packages/db/src/repositories/in-memory-p0-repository.ts packages/db/src/repositories/drizzle-p0-repository.ts tests/db/repository.test.ts
git commit -m "fix: add durable revision lookup to repositories"
```

Current worktree status: completed in `167f084`.

## Task 2: Remove service reverse indexes and prove restart-safe API behavior

**Files:**
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
- Create: `tests/api/durable-revision-lookup.test.ts`

- [ ] **Step 1: Create the durable API test harness**

Create `tests/api/durable-revision-lookup.test.ts` with a local bootstrap helper that:

- requires `FORGELOOP_TEST_DATABASE_URL` or `FORGELOOP_DATABASE_URL` to point at a disposable database whose database name contains `test`
- uses `describe.skipIf(!connectionString)` so the normal test suite skips cleanly without Postgres
- trims the configured URL before use and throws before truncating if the database name is not clearly test-only
- creates a `DrizzleP0Repository` from `createDbClient({ connectionString })`
- tracks every returned `pool` and closes each one with `await pool.end()` in `afterEach`
- boots two fresh `AppModule` instances, each with a new tracked `DrizzleP0Repository` and pool against the same test database URL
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
  const generatedRevisionResponse = await request(server).get(`/plan-revisions/${generatedRevision.id}`).expect(200);
  expect(generatedRevisionResponse.body.id).toBe(generatedRevision.id);
  await request(server).post(`/plans/${plan.id}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
  await request(server).post(`/plans/${plan.id}/approve`).send({ actor_id: actorReviewer }).expect(201);

  return { planId: plan.id, planRevisionId: generatedRevision.id, manualPlanRevisionId: manualRevision.id };
};
```

Do not add unused helpers such as `createManualPackage()` in this test file. If an earlier implementation copied it but does not call it, remove the helper and any unused constants before final verification.

- [ ] **Step 2: Write the route-restart regression test**

Add this exact test name so the Step 3 `-t` filter runs it:

```ts
it('resolves revision routes after restart', async () => {
  const firstApp = await createDurableApp();
  const { workItem } = await createProjectRepoWorkItem(firstApp);
  const { specRevisionId } = await approveSpec(firstApp, workItem.id);
  const { planRevisionId } = await approvePlan(firstApp, workItem.id);

  await closeApp(firstApp);

  const secondApp = await createDurableApp();
  const specResponse = await request(secondApp.getHttpServer()).get(`/spec-revisions/${specRevisionId}`).expect(200);
  expect(specResponse.body.id).toBe(specRevisionId);
  const planResponse = await request(secondApp.getHttpServer()).get(`/plan-revisions/${planRevisionId}`).expect(200);
  expect(planResponse.body.id).toBe(planRevisionId);
});
```

- [ ] **Step 3: Prepare the durable local database and run the route test in red**

Run:

```bash
docker compose up -d postgres redis temporal
docker compose exec -T postgres createdb -U forgeloop forgeloop_test || true
FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop_test pnpm db:push
FORGELOOP_TEST_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop_test pnpm vitest run tests/api/durable-revision-lookup.test.ts -t "resolves revision routes after restart"
```

Expected from the pre-service-refactor baseline: FAIL while `P0Service` still depends on the in-memory reverse indexes.

Current worktree status after `8d5458a`: this should PASS after the review fixes in this plan are applied. Do not report this as an expected failure when continuing from this worktree.

- [ ] **Step 4: Write the plan-draft restart regression test**

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
FORGELOOP_TEST_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop_test pnpm vitest run tests/api/durable-revision-lookup.test.ts -t "generates plan drafts after restart"
```

Expected from the pre-service-refactor baseline: FAIL while `generatePlanDraft()` still resolves the approved current spec revision through the in-memory reverse index.

Current worktree status after `8d5458a`: this should PASS after the review fixes in this plan are applied. Do not report this as an expected failure when continuing from this worktree.

- [ ] **Step 6: Write the package-generation restart regression test**

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
FORGELOOP_TEST_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop_test pnpm vitest run tests/api/durable-revision-lookup.test.ts -t "generates packages after restart"
```

Expected from the pre-service-refactor baseline: FAIL while `packageContext()` still resolves the approved current plan revision through the in-memory reverse index.

Current worktree status after `8d5458a`: this should PASS after the review fixes in this plan are applied. Do not report this as an expected failure when continuing from this worktree.

- [ ] **Step 8: Write error-semantics characterization/regression tests**

Add focused tests for the spec/plan pointer distinctions:

- missing parent `current_revision_id` on an approved parent fails the current-approved flow with HTTP 400 and a response message from the existing `BadRequestException`; this may already pass before the service refactor and exists to preserve current behavior
- parent `current_revision_id` points at a missing revision row and the current-approved flow surfaces HTTP 404 with a response message from `NotFoundException`; this test may directly mutate Postgres state to create the otherwise-unreachable stale pointer or missing row fixture
- for spec pointer cases, use the plan-draft flow (`POST /plans/:planId/generate-draft`) because it calls `requireApprovedCurrentSpec()` and then rehydrates `spec.current_revision_id`
- for plan pointer cases, use the package-generation flow (`POST /plan-revisions/:planRevisionId/generate-packages`) because it calls `packageContext()` and rehydrates the current plan revision
- assert these cases through HTTP status and response message rather than by inspecting internal exception classes
- also prove direct revision routes remain independent of the parent pointer: if the parent `current_revision_id` is missing or stale but the requested revision row exists, `GET /spec-revisions/:id` and `GET /plan-revisions/:id` must still return that exact revision id

Use these exact test names and fixture mutations:

```ts
it('resolves direct spec revision lookup when parent current_revision_id is missing', async () => {
  const app = await createDurableApp();
  const { workItem } = await createProjectRepoWorkItem(app);
  const { specId, specRevisionId } = await approveSpec(app, workItem.id);
  await withDb(async (db) => {
    await db.update(specs).set({ currentRevisionId: null }).where(eq(specs.id, specId));
  });

  const response = await request(app.getHttpServer()).get(`/spec-revisions/${specRevisionId}`).expect(200);
  expect(response.body.id).toBe(specRevisionId);
});

it('resolves direct plan revision lookup when parent current_revision_id is stale', async () => {
  const app = await createDurableApp();
  const { workItem } = await createProjectRepoWorkItem(app);
  await approveSpec(app, workItem.id);
  const { planId, planRevisionId, manualPlanRevisionId } = await approvePlan(app, workItem.id);
  await withDb(async (db) => {
    await db.update(plans).set({ currentRevisionId: manualPlanRevisionId }).where(eq(plans.id, planId));
  });

  const response = await request(app.getHttpServer()).get(`/plan-revisions/${planRevisionId}`).expect(200);
  expect(response.body.id).toBe(planRevisionId);
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
```

- [ ] **Step 9: Run the error-semantics tests before the refactor**

Run:

```bash
FORGELOOP_TEST_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop_test pnpm vitest run tests/api/durable-revision-lookup.test.ts -t "current_revision_id|missing revision"
```

Expected: treat these as characterization/regression tests. If any fixture returns an unexpected status or message, fix the fixture before refactoring. From the pre-service-refactor baseline, Steps 3, 5, and 7 are the red gates for the restart bug; in the current worktree after `8d5458a`, this command should be a regression verification and must pass after the review fixes above are applied.

- [ ] **Step 10: Refactor or verify `P0Service` direct lookup behavior**

In `apps/control-plane-api/src/p0/p0.service.ts`:

- make the smallest service change needed for direct revision lookup; if unrelated behavior appears necessary, stop and re-check the spec before broadening the change
- remove `specRevisionIndex` and `planRevisionIndex`
- change `getSpecRevision()` to call `repository.getSpecRevision(specRevisionId)` directly
- change `getPlanRevision()` to call `repository.getPlanRevision(planRevisionId)` directly
- keep `NotFoundException` for missing revision rows
- keep `BadRequestException` only when a flow requires the current approved revision and the parent pointer is missing or points at a different existing revision
- let a parent pointer that points at a missing revision row surface `NotFoundException`
- in `packageContext()`, do not compare `plan.current_revision_id` to the requested revision id before lookup; first require an approved plan with a non-empty `current_revision_id`, then call `getPlanRevision(plan.current_revision_id)` so a missing current revision row surfaces `NotFoundException`, and only then compare the resolved current revision id to the requested `planRevisionId`
- leave `saveSpecRevision()` and `savePlanRevision()` responsible for updating the parent object’s `current_revision_id`
- leave list endpoints and timeline assembly unchanged

Current worktree status after `8d5458a`: `getSpecRevision()` and `getPlanRevision()` already call repository direct lookup and reverse index state has been removed. Continue from this state by verifying the bullets above and applying only the missing `packageContext()` current-revision dereference fix if needed.

- [ ] **Step 11: Run each durable regression and confirm it passes**

Run:

```bash
FORGELOOP_TEST_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop_test pnpm vitest run tests/api/durable-revision-lookup.test.ts -t "resolves revision routes after restart"
FORGELOOP_TEST_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop_test pnpm vitest run tests/api/durable-revision-lookup.test.ts -t "generates plan drafts after restart"
FORGELOOP_TEST_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop_test pnpm vitest run tests/api/durable-revision-lookup.test.ts -t "generates packages after restart"
FORGELOOP_TEST_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop_test pnpm vitest run tests/api/durable-revision-lookup.test.ts -t "current_revision_id|missing revision"
```

Expected: PASS.

- [ ] **Step 12: Commit the service and durable regression change**

```bash
git add apps/control-plane-api/src/p0/p0.service.ts tests/api/durable-revision-lookup.test.ts
git commit -m "fix: make durable revision lookup restart-safe"
```

Current worktree status: the initial service and durable regression change was committed in `8d5458a`. After applying the review fixes above, amend that commit or create a follow-up commit with the strengthened tests and any required `packageContext()` correction.

## Task 3: Final verification and handoff

**Files:**
- None (verification only)

- [ ] **Step 1: Run the focused regression set**

Run:

```bash
pnpm vitest run tests/db/repository.test.ts tests/api/durable-revision-lookup.test.ts
```

Expected: PASS, with the durable API test only running when `FORGELOOP_TEST_DATABASE_URL` or a safe `FORGELOOP_DATABASE_URL` is present.

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
docker compose exec -T postgres createdb -U forgeloop forgeloop_test || true
FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop_test pnpm db:push
FORGELOOP_TEST_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop_test pnpm vitest run tests/api/durable-revision-lookup.test.ts
```

Expected: PASS with the durable API tests actually executed, not skipped.
