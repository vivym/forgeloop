# P0 Durable Revision Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make spec and plan revision lookup restart-safe by moving direct revision fetches into the repository and proving the public revision routes and plan generation flows survive a fresh API boot against a durable Postgres-backed repository.

**Architecture:** Treat `P0Repository` as the source of truth for both parent-scoped revision history and direct revision-id lookup. `P0Service` should stop carrying reverse indexes in memory and should resolve revisions through the repository on demand. A separate durable API regression test should boot two fresh Nest apps against the same Postgres-backed repository to prove restart behavior and the stale/missing `current_revision_id` error semantics.

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
  - Boots two fresh API instances against the same durable repository backend and exercises the restart-safe revision routes and generation flows.

## Task 1: Add repository-level direct revision lookup

**Files:**
- Modify: `packages/db/src/repositories/p0-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-p0-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-p0-repository.ts`
- Modify: `tests/db/repository.test.ts`

- [ ] **Step 1: Write the failing in-memory repository tests**

Add focused in-memory tests in `tests/db/repository.test.ts` that prove revisions can be fetched directly by revision id:

```ts
it('gets spec revisions by id', async () => {
  const repository: P0Repository = new InMemoryP0Repository();
  await repository.saveSpec(spec);
  await repository.saveSpecRevision(specRevision);

  expect(await repository.getSpecRevision(specRevision.id)).toEqual(specRevision);
});

it('gets plan revisions by id', async () => {
  const repository: P0Repository = new InMemoryP0Repository();
  await repository.savePlan(plan);
  await repository.savePlanRevision(planRevision);

  expect(await repository.getPlanRevision(planRevision.id)).toEqual(planRevision);
});
```

- [ ] **Step 2: Run the focused in-memory repository tests and confirm they fail**

Run:

```bash
pnpm vitest run tests/db/repository.test.ts -t "gets spec revisions by id|gets plan revisions by id"
```

Expected: FAIL because `P0Repository` does not yet expose direct revision lookup and `InMemoryP0Repository` does not implement it.

- [ ] **Step 3: Add the repository contract and in-memory implementation**

Update `P0Repository` with:

```ts
getSpecRevision(specRevisionId: string): Promise<SpecRevision | undefined>;
getPlanRevision(planRevisionId: string): Promise<PlanRevision | undefined>;
```

Implement both methods in `InMemoryP0Repository` by reading the stored revision maps.

- [ ] **Step 4: Rerun the in-memory repository tests and confirm they pass**

Run:

```bash
pnpm vitest run tests/db/repository.test.ts -t "gets spec revisions by id|gets plan revisions by id"
```

Expected: PASS.

- [ ] **Step 5: Write the failing Drizzle mapping tests**

Add two Drizzle mapping tests near the existing `P0Repository Drizzle adapter persistence mapping` tests. Reuse `createSingleRowRepository()` so `getSpecRevision()` and `getPlanRevision()` return the mapped row for a single revision row:

```ts
it('maps spec revisions fetched by id', async () => {
  expect(await createSingleRowRepository({
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
  }).getSpecRevision(specRevision.id)).toEqual(specRevision);
});

it('maps plan revisions fetched by id', async () => {
  expect(await createSingleRowRepository({
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
  }).getPlanRevision(planRevision.id)).toEqual(planRevision);
});
```

- [ ] **Step 6: Run the focused Drizzle mapping tests and confirm they fail**

Run:

```bash
pnpm vitest run tests/db/repository.test.ts -t "maps spec revisions fetched by id|maps plan revisions fetched by id"
```

Expected: FAIL because `DrizzleP0Repository` does not yet implement direct revision lookup.

- [ ] **Step 7: Add the Drizzle adapter implementation**

Implement both methods in `DrizzleP0Repository` by querying the revision tables by primary key.

- [ ] **Step 8: Rerun all repository lookup tests and confirm they pass**

Run:

```bash
pnpm vitest run tests/db/repository.test.ts -t "gets spec revisions by id|gets plan revisions by id|maps spec revisions fetched by id|maps plan revisions fetched by id"
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
- boots two fresh `AppModule` instances with the same repository backend
- stubs `RUN_WORKER` so the test only exercises API and repository behavior
- truncates touched tables in `beforeEach` so repeated runs do not collide on fixed ids

Use a cleanup helper with an explicit table list:

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

- [ ] **Step 2: Write the first failing route-restart test**

Add one test that:

1. creates a project, repo, work item, spec, and plan through the API
2. generates and approves spec and plan revisions
3. closes the first app
4. boots a second fresh app against the same database
5. verifies `GET /spec-revisions/:id` and `GET /plan-revisions/:id` still resolve

- [ ] **Step 3: Prepare the durable local database and run the route test in red**

Run:

```bash
docker compose up -d postgres redis temporal
FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm db:push
FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm vitest run tests/api/durable-revision-lookup.test.ts -t "resolves revision routes after restart"
```

Expected: FAIL while `P0Service` still depends on the in-memory reverse indexes.

- [ ] **Step 4: Write the failing plan-draft restart test**

Add one test that reuses the same durable fixture and verifies `POST /plans/:planId/generate-draft` works after closing the first app and booting a second app.

- [ ] **Step 5: Run the plan-draft test in red**

Run:

```bash
FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm vitest run tests/api/durable-revision-lookup.test.ts -t "generates plan drafts after restart"
```

Expected: FAIL while `generatePlanDraft()` still resolves the approved current spec revision through the in-memory reverse index.

- [ ] **Step 6: Write the failing package-generation restart test**

Add one test that reuses the same durable fixture and verifies `POST /plan-revisions/:planRevisionId/generate-packages` works after closing the first app and booting a second app.

- [ ] **Step 7: Run the package-generation test in red**

Run:

```bash
FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm vitest run tests/api/durable-revision-lookup.test.ts -t "generates packages after restart"
```

Expected: FAIL while `packageContext()` still resolves the approved current plan revision through the in-memory reverse index.

- [ ] **Step 8: Write the failing error-semantics tests**

Add focused tests for the spec distinctions:

- missing parent `current_revision_id` on an approved parent fails the current-approved flow with `BadRequestException`; this may already pass before the service refactor and exists to preserve current behavior
- parent `current_revision_id` points at a missing revision row and the current-approved flow surfaces `NotFoundException`; this test may directly mutate Postgres state to create the otherwise-unreachable stale pointer or missing row fixture

- [ ] **Step 9: Run the error-semantics tests in red**

Run:

```bash
FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm vitest run tests/api/durable-revision-lookup.test.ts -t "current_revision_id|missing revision"
```

Expected: the missing-pointer behavior may already PASS, and the pointer-to-missing-row case should FAIL while the service still reports missing process memory as a missing index.

- [ ] **Step 10: Refactor `P0Service` to use repository direct lookup**

In `apps/control-plane-api/src/p0/p0.service.ts`:

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

If the durable regression was skipped because `FORGELOOP_DATABASE_URL` was unset, rerun it with the Postgres-backed environment before closing the task.
