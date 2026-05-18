> Superseded historical migration note: this document mentions the old subsystem name for audit history only. Current commands, routes, files, and product docs use delivery terminology.

# P0 Query Surface Cleanup Implementation Plan

## Status

Completed and merged to `main` on 2026-05-09.

- Merge head: `dc2004b` (`chore: verify p0 query surface cleanup`)
- Verified after merge: `pnpm test`
- Verified after merge: `pnpm build`
- Verified after merge: `git diff --check`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make QueryModule the only HTTP and web-client boundary for P0 work item cockpit and replay reads, with no legacy read-route compatibility surface left.

**Architecture:** Keep command/object operations in `P0Controller` and `P0Service`, and move read-model aggregation into `packages/db/src/queries/*` behind `apps/control-plane-api/src/modules/query/*`. The web app will use a command API client for object/command routes and a separate query API client for cockpit/replay reads while preserving existing workbench state names and UI behavior.

**Tech Stack:** TypeScript, NestJS, Vitest, Supertest, React/Vite, pnpm workspaces, in-memory and Drizzle-backed P0 repositories.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-05-09-p0-query-surface-cleanup-design.md`
- Historical query architecture reference: `docs/architecture-design/v0/query.md`
- Current worktree: `/Users/viv/projs/forgeloop/.worktrees/p0-query-surface-cleanup`
- Current branch: `feature/p0-query-surface-cleanup`

Do not duplicate the exact legacy route strings or old client method names from spec Section 10.2 in this plan. The final verification scans active docs, and this plan should not become an allowed-match exception.

## Current Baseline

The query cleanup worktree currently contains useful WIP:

- `apps/control-plane-api/src/modules/query/query.module.ts`
- `apps/control-plane-api/src/modules/query/query.controller.ts`
- `apps/control-plane-api/src/modules/query/query.service.ts`
- `packages/db/src/queries/work-item-cockpit-queries.ts`
- `packages/db/src/queries/replay-queries.ts`
- `tests/api/query-module.test.ts`
- wiring edits in `apps/control-plane-api/src/app.module.ts`, `apps/control-plane-api/src/p0/p0.module.ts`, `apps/control-plane-api/src/p0/p0.service.ts`, and `packages/db/src/index.ts`

That WIP predates durable revision lookup on `main`. The first task must fast-forward to `main` while preserving this WIP.

## File Structure

### Backend Query Surface

- Create/keep `apps/control-plane-api/src/modules/query/query.module.ts`
  - Owns the Nest module for P0 read-model routes.
  - Imports `P0Module` only to reuse repository and durability providers.
- Create/keep `apps/control-plane-api/src/modules/query/query.controller.ts`
  - Owns `GET /query/work-item-cockpit/:workItemId`.
  - Owns `GET /query/replay/:objectType/:objectId`.
- Create/keep `apps/control-plane-api/src/modules/query/query.service.ts`
  - Validates supported replay object types before calling DB helpers.
  - Maps unsupported replay object types to `400`.
  - Maps missing supported objects to `404`.
  - Serializes public run session metadata for cockpit responses.
- Modify `apps/control-plane-api/src/app.module.ts`
  - Registers `QueryModule` alongside `P0Module`.
- Modify `apps/control-plane-api/src/p0/p0.module.ts`
  - Exports repository and durability providers needed by QueryModule.
- Modify `apps/control-plane-api/src/p0/p0.controller.ts`
  - Removes only the two legacy read routes named in spec Section 10.2.
  - Leaves all command, evidence-chain, run, revision, package, and review routes unchanged.
- Modify `apps/control-plane-api/src/p0/p0.service.ts`
  - Removes only legacy cockpit/replay wrapper methods and imports.
  - Preserves repository-backed durable revision lookup from current `main`.

### Database Read Models

- Create/keep `packages/db/src/queries/work-item-cockpit-queries.ts`
  - Builds the work item cockpit read model from `P0Repository`.
  - Adds run worker lease metadata before API-level public serialization.
- Create/keep `packages/db/src/queries/replay-queries.ts`
  - Builds work item replay timeline entries from object events, status history, decisions, and public artifact rows.
  - Redacts logs, raw metadata artifacts, raw refs, and local-ref-only artifact rows.
- Modify `packages/db/src/index.ts`
  - Exports the query helpers and their response types.

### Web Client Boundary

- Create `apps/web/src/api/types.ts`
  - Owns shared DTO and response TypeScript types currently in `apps/web/src/api.ts`.
- Create `apps/web/src/api/common.ts`
  - Owns `ForgeloopApiError`, base URL normalization, actor header handling, `request<T>()`, and JSON parsing.
- Create `apps/web/src/api/commands.ts`
  - Owns command/object client creation.
  - Must not export legacy cockpit/replay read methods.
- Create `apps/web/src/api/query.ts`
  - Owns `getWorkItemCockpit()` and `getWorkItemReplay()`.
  - Calls only `/query/*` routes.
- Modify `apps/web/src/api.ts`
  - Re-export types, common error type, command client factory/default, and query client factory/default.
  - Keep a command default named `api` only if it does not expose query read methods.
- Modify `apps/web/src/App.tsx`
  - Use command client for commands and ordinary object reads.
  - Use query client for workbench cockpit/replay refresh.
- Modify `apps/web/src/workbenchState.ts`
  - Import shared types from the new type module or `api.ts` re-export.

### Tests And Scripts

- Modify `tests/api/query-module.test.ts`
  - Assert query routes directly.
  - Stop comparing query output to legacy route output.
  - Cover cockpit success, cockpit missing, replay success, replay unsupported type, replay missing supported object, durable runtime metadata fallback, and negative legacy route behavior.
- Modify `tests/api/run-events.test.ts`
  - Move the existing raw-log timeline redaction assertion to the query replay route.
- Modify API/smoke tests that inspect cockpit/replay data:
  - `tests/api/delivery-flow.test.ts`
  - `tests/smoke/p0-smoke.test.ts`
- Modify scripts that fetch cockpit/replay data:
  - `scripts/p0-local-codex-dogfood.ts`
  - `scripts/p0-dogfood-work-items.ts`
- Modify `tests/web/api.test.ts`
  - Cover command client and query client separately.
  - Prove query client hits `/query/work-item-cockpit/:workItemId` and `/query/replay/work_item/:workItemId`.

---

### Task 0: Rebase The WIP Onto Current Main Without Losing It

**Files:**
- Potential conflict: `apps/control-plane-api/src/p0/p0.service.ts`
- Potential conflict: `packages/db/src/index.ts`
- Potential conflict: `tests/db/repository.test.ts`
- Potential conflict: `tests/api/durable-revision-lookup.test.ts`
- Preserve WIP files listed in Current Baseline.

- [ ] **Step 1: Confirm branch and dirty WIP**

Run:

```bash
git status --short --branch
git merge-base HEAD main
```

Expected:
- Branch is `feature/p0-query-surface-cleanup`.
- Worktree has the known query cleanup WIP.
- Merge base is `177b25ee40619fdf2cf085a592f593c5cc8aaf0c`.

- [ ] **Step 2: Stash current WIP with untracked files**

Run:

```bash
git stash push -u -m "p0-query-surface-cleanup-wip-before-main"
```

Expected: stash is created and `git status --short` is clean.

- [ ] **Step 3: Fast-forward to current main**

Run:

```bash
git merge --ff-only main
```

Expected: branch fast-forwards to the current local `main` commit. There should be no merge commit.

- [ ] **Step 4: Restore query cleanup WIP**

Run:

```bash
git stash pop
```

Expected: WIP is reapplied. If conflicts occur, resolve them by preserving:
- repository-backed `getSpecRevision()` and `getPlanRevision()` in `P0Service`
- no `specRevisionIndex` or `planRevisionIndex`
- durable lookup repository methods and tests from `main`
- query module files and exports from the WIP

- [ ] **Step 5: Verify durable lookup guardrails after conflict resolution**

Run:

```bash
rg -n 'specRevisionIndex|planRevisionIndex' apps/control-plane-api/src/p0 packages/db tests
pnpm vitest run tests/db/repository.test.ts tests/api/durable-revision-lookup.test.ts
```

Expected:
- `rg` has no output.
- Repository direct revision lookup tests pass.
- DB-backed durable API tests pass when `FORGELOOP_DATABASE_URL` is set, or are skipped only because that env var is not set.

- [ ] **Step 6: Commit reviewed spec and plan docs only**

Run:

```bash
git add docs/superpowers/specs/2026-05-09-p0-query-surface-cleanup-design.md docs/superpowers/plans/2026-05-09-p0-query-surface-cleanup.md
git commit -m "docs: add p0 query surface cleanup plan"
```

Expected: only the reviewed query cleanup spec and this plan are committed. QueryModule/code/test WIP remains uncommitted for the test-first implementation tasks below.

- [ ] **Step 7: Confirm implementation WIP remains uncommitted**

Run:

```bash
git status --short
```

Expected: the branch is now based on current `main`, reviewed docs are committed, and query cleanup code/test WIP remains uncommitted for the implementation tasks below.

---

### Task 1: Lock Query API Behavior With Failing Backend Tests

**Files:**
- Modify: `tests/api/query-module.test.ts`
- Modify: `tests/api/run-events.test.ts`

- [ ] **Step 1: Replace compatibility comparison tests with direct query assertions**

In `tests/api/query-module.test.ts`, replace the WIP test that compares query responses against legacy responses with tests that assert query response shape directly:

```ts
it('returns the work item cockpit from the query surface', async () => {
  const { app } = await track(createTestApp());
  const executionPackage = await seedReadyExecutionPackageThroughApi(app);

  const response = await request(app.getHttpServer())
    .get(`/query/work-item-cockpit/${executionPackage.work_item_id}`)
    .expect(200);

  expect(response.body.work_item).toMatchObject({ id: executionPackage.work_item_id });
  expect(response.body.packages).toEqual([expect.objectContaining({ id: executionPackage.id })]);
  expect(response.body.run_sessions).toEqual(expect.any(Array));
  expect(response.body.review_packets).toEqual(expect.any(Array));
  expect(response.body.next_actions).toEqual(expect.any(Array));
  expect(response.body.completion_state).toEqual(expect.any(Object));
});
```

- [ ] **Step 2: Add missing cockpit and replay object tests**

Add these tests to `tests/api/query-module.test.ts`:

```ts
it('returns 404 for a missing work item cockpit', async () => {
  const { app } = await track(createTestApp());

  await request(app.getHttpServer()).get('/query/work-item-cockpit/missing-work-item').expect(404);
});

it('returns the work item replay from the query surface', async () => {
  const { app } = await track(createTestApp());
  const executionPackage = await seedReadyExecutionPackageThroughApi(app);

  const response = await request(app.getHttpServer())
    .get(`/query/replay/work_item/${executionPackage.work_item_id}`)
    .expect(200);

  expect(response.body).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: 'object_event',
        object_type: 'work_item',
        object_id: executionPackage.work_item_id,
      }),
      expect.objectContaining({
        object_type: 'execution_package',
        object_id: executionPackage.id,
      }),
    ]),
  );
});

it('returns 404 for a missing supported replay object', async () => {
  const { app } = await track(createTestApp());

  await request(app.getHttpServer()).get('/query/replay/work_item/missing-work-item').expect(404);
});
```

- [ ] **Step 3: Add unsupported replay object type test**

Add this test to `tests/api/query-module.test.ts`:

```ts
it('rejects unsupported replay object types before lookup', async () => {
  const { app } = await track(createTestApp());

  const response = await request(app.getHttpServer()).get('/query/replay/release/missing-release').expect(400);

  expect(response.body.message).toContain('Unsupported replay object type');
});
```

This test must not seed any object. It proves the validation boundary runs before repository lookup.

- [ ] **Step 4: Add negative assertions for removed backend read routes**

In `tests/api/query-module.test.ts`, add one test that creates a real work item and then asserts the two legacy read paths named in spec Section 10.2 return `404`.

Implementation note: put the exact route strings in the test code only. Do not copy them into docs or plan files.

- [ ] **Step 5: Move raw artifact redaction test to query replay**

In `tests/api/run-events.test.ts`, find the existing raw-log work item timeline redaction test and change only the request path so it hits `/query/replay/work_item/:objectId`.

The assertion must continue to prove:

```ts
expect(response.body.filter((entry: { source: string }) => entry.source === 'artifact')).toEqual([
  expect.objectContaining({
    payload: {
      kind: 'diff',
      name: 'Diff',
      content_type: 'text/x-patch',
      storage_uri: 's3://forgeloop-test/diff.patch',
    },
  }),
]);
expect(JSON.stringify(response.body)).not.toContain('local_ref');
expect(JSON.stringify(response.body)).not.toContain('raw-codex.jsonl');
expect(JSON.stringify(response.body)).not.toContain('raw_ref');
```

- [ ] **Step 6: Run the focused tests and verify red**

Run:

```bash
pnpm vitest run tests/api/query-module.test.ts tests/api/run-events.test.ts
```

Expected before implementation:
- Unsupported replay object type test fails with `404` instead of `400`, or another equivalent pre-implementation failure.
- Negative legacy route test fails while legacy read routes still exist.
- No unrelated TypeScript compile failure.

---

### Task 2: Finalize QueryModule And Remove Backend Legacy Read Surface

**Files:**
- Modify: `apps/control-plane-api/src/modules/query/query.service.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.controller.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.module.ts`
- Modify: `apps/control-plane-api/src/app.module.ts`
- Modify: `apps/control-plane-api/src/p0/p0.module.ts`
- Modify: `apps/control-plane-api/src/p0/p0.controller.ts`
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
- Modify: `packages/db/src/queries/replay-queries.ts`
- Modify: `packages/db/src/queries/work-item-cockpit-queries.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Implement replay object type validation in QueryService**

Update `apps/control-plane-api/src/modules/query/query.service.ts` to use `BadRequestException` for unsupported object types:

```ts
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

const supportedReplayObjectTypes = new Set(['work_item']);

async getReplay(objectType: string, objectId: string) {
  if (!supportedReplayObjectTypes.has(objectType)) {
    throw new BadRequestException(`Unsupported replay object type: ${objectType}`);
  }

  const timeline = await getObjectReplayTimeline(this.repository, objectType, objectId);
  if (timeline === undefined) {
    throw new NotFoundException(`Replay ${objectType} ${objectId} not found`);
  }

  return timeline;
}
```

Keep the controller route as `GET /query/replay/:objectType/:objectId`.

- [ ] **Step 2: Keep query helper composition in `packages/db`**

Ensure `packages/db/src/queries/work-item-cockpit-queries.ts` owns cockpit composition and `packages/db/src/queries/replay-queries.ts` owns replay composition. Do not move this assembly back into `P0Service`.

Ensure `packages/db/src/index.ts` exports:

```ts
export * from './queries/work-item-cockpit-queries';
export * from './queries/replay-queries';
```

- [ ] **Step 3: Preserve replay artifact redaction in DB query helper**

In `packages/db/src/queries/replay-queries.ts`, keep or add public artifact serialization equivalent to:

```ts
const artifactRedactionReason = (artifact: Artifact['ref']): string | undefined => {
  const candidate = artifact as Artifact['ref'] & { raw_ref?: unknown };
  if (artifact.kind === 'logs') return 'logs_artifact';
  if (artifact.kind === 'raw_metadata') return 'raw_metadata_artifact';
  if (candidate.raw_ref !== undefined) return 'raw_ref';
  if (artifact.local_ref !== undefined && artifact.storage_uri === undefined) return 'local_ref_only';
  return undefined;
};

const serializePublicArtifactRef = (artifact: Artifact['ref']): Artifact['ref'] | undefined => {
  const candidate = artifact as Artifact['ref'] & { raw_ref?: unknown };
  if (artifactRedactionReason(artifact) !== undefined) return undefined;
  const { raw_ref: _rawRef, local_ref: _localRef, ...publicArtifact } = candidate;
  return publicArtifact;
};
```

Only public artifact rows with remote/public references should be replay entries.

- [ ] **Step 4: Remove legacy backend read routes**

In `apps/control-plane-api/src/p0/p0.controller.ts`, delete only the two legacy read controller methods named in spec Section 10.2.

Do not edit:
- spec revision routes
- plan revision routes
- evidence-chain route
- run session routes
- execution package routes
- review packet routes
- command routes

- [ ] **Step 5: Remove P0Service legacy read wrappers**

In `apps/control-plane-api/src/p0/p0.service.ts`, delete only the two legacy read wrapper methods and imports that exist only for them.

After this step:
- `P0Service.getSpecRevision()` must still be:

```ts
async getSpecRevision(specRevisionId: string): Promise<SpecRevision> {
  return this.requireFound(await this.repository.getSpecRevision(specRevisionId), `SpecRevision ${specRevisionId}`);
}
```

- `P0Service.getPlanRevision()` must still be:

```ts
async getPlanRevision(planRevisionId: string): Promise<PlanRevision> {
  return this.requireFound(await this.repository.getPlanRevision(planRevisionId), `PlanRevision ${planRevisionId}`);
}
```

- `packageContext()` must keep resolving the plan parent current revision through `getPlanRevision(plan.current_revision_id)`.

- [ ] **Step 6: Run focused backend tests and verify green**

Run:

```bash
pnpm vitest run tests/api/query-module.test.ts tests/api/run-events.test.ts tests/api/durable-revision-lookup.test.ts tests/db/repository.test.ts
```

Expected:
- Query module tests pass.
- Run event redaction test passes against query replay.
- Durable revision lookup tests pass when DB is configured, or skip only DB-backed cases because `FORGELOOP_DATABASE_URL` is unset.
- Repository tests pass.

- [ ] **Step 7: Commit backend query surface cleanup**

Run:

```bash
git add apps/control-plane-api/src/modules/query apps/control-plane-api/src/app.module.ts apps/control-plane-api/src/p0/p0.module.ts apps/control-plane-api/src/p0/p0.controller.ts apps/control-plane-api/src/p0/p0.service.ts packages/db/src/queries packages/db/src/index.ts tests/api/query-module.test.ts tests/api/run-events.test.ts
git commit -m "feat: make query module the p0 read surface"
```

---

### Task 3: Update Backend Tests, Scripts, And Dogfood Call Sites

**Files:**
- Modify: `tests/api/delivery-flow.test.ts`
- Modify: `tests/smoke/p0-smoke.test.ts`
- Modify: `scripts/p0-local-codex-dogfood.ts`
- Modify: `scripts/p0-dogfood-work-items.ts`

- [ ] **Step 1: Update API tests that inspect cockpit/replay data**

In `tests/api/delivery-flow.test.ts`, replace legacy read-route calls with:

```ts
const cockpit = (await request(server).get(`/query/work-item-cockpit/${workItem.id}`).expect(200)).body;
const timeline = (await request(server).get(`/query/replay/work_item/${workItem.id}`).expect(200)).body;
```

Keep all assertions about returned data unchanged unless they reference a removed route directly.

- [ ] **Step 2: Update smoke tests that inspect cockpit/replay data**

In `tests/smoke/p0-smoke.test.ts`, replace legacy read-route calls with the query routes:

```ts
const cockpit = (await request(server).get(`/query/work-item-cockpit/${workItem.id}`).expect(200)).body;
const timeline = (await request(server).get(`/query/replay/work_item/${workItem.id}`).expect(200)).body;
```

- [ ] **Step 3: Update dogfood scripts**

In both scripts, replace cockpit/replay fetches with:

```ts
`/query/work-item-cockpit/${encodeURIComponent(workItemId)}`
`/query/replay/work_item/${encodeURIComponent(workItemId)}`
```

Use the local variable already holding the work item id in each script. Keep the existing parsing and assertions.

- [ ] **Step 4: Run targeted tests and script type coverage**

Run:

```bash
pnpm vitest run tests/api/delivery-flow.test.ts tests/smoke/p0-smoke.test.ts tests/smoke/p0-local-codex-dogfood-script.test.ts tests/smoke/p0-dogfood-work-items-script.test.ts
pnpm --filter @forgeloop/control-plane-api build
```

Expected: all targeted tests pass and the control-plane API build passes.

- [ ] **Step 5: Commit call site migration**

Run:

```bash
git add tests/api/delivery-flow.test.ts tests/smoke/p0-smoke.test.ts scripts/p0-local-codex-dogfood.ts scripts/p0-dogfood-work-items.ts
git commit -m "test: move p0 read callers to query routes"
```

---

### Task 4: Split Web Command And Query API Clients

**Files:**
- Create: `apps/web/src/api/types.ts`
- Create: `apps/web/src/api/common.ts`
- Create: `apps/web/src/api/commands.ts`
- Create: `apps/web/src/api/query.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/workbenchState.ts`
- Modify: `tests/web/api.test.ts`
- Modify: `tests/e2e/run-console.e2e.test.ts`

- [ ] **Step 1: Move shared web API types**

Create `apps/web/src/api/types.ts` and move all exported interfaces and type aliases from the top of `apps/web/src/api.ts` into it.

Keep these re-exports in `apps/web/src/api.ts`:

```ts
export type * from './api/types';
```

- [ ] **Step 2: Move shared request infrastructure**

Create `apps/web/src/api/common.ts` with:

```ts
type FetchLike = typeof fetch;

export class ForgeloopApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ForgeloopApiError';
    this.status = status;
    this.details = details;
  }
}

export interface ForgeloopApiOptions {
  baseUrl?: string;
  fetch?: FetchLike;
}

const defaultBaseUrl = () => import.meta.env.VITE_FORGELOOP_API_URL || 'http://localhost:3000';
const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, '');

const requiredActorId = (actorId: string) => {
  const trimmed = actorId.trim();
  if (!trimmed) throw new Error('actorId is required');
  return trimmed;
};

export const actorHeader = (actorId?: string) =>
  actorId === undefined ? {} : { 'X-Forgeloop-Actor-Id': requiredActorId(actorId) };

export const createApiContext = (options: ForgeloopApiOptions = {}) => {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? defaultBaseUrl());
  const fetchImpl = options.fetch ?? fetch;

  async function request<T>(
    path: string,
    init: { method?: string; body?: unknown; actorId?: string } = {},
  ): Promise<T> {
    const headers = { 'content-type': 'application/json', ...actorHeader(init.actorId) };
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const text = await response.text();
    const payload = text ? parseJson(text) : undefined;

    if (!response.ok) {
      const message =
        typeof payload === 'object' && payload !== null && 'message' in payload && typeof payload.message === 'string'
          ? payload.message
          : `Forgeloop API request failed with ${response.status}`;
      throw new ForgeloopApiError(message, response.status, payload);
    }

    return payload as T;
  }

  return { baseUrl, request };
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
```

If `parseJson` already exists lower in `api.ts`, move it here instead of duplicating it.

- [ ] **Step 3: Create command API client**

Create `apps/web/src/api/commands.ts` from the existing `createForgeloopApi()` implementation, but remove the cockpit/replay read methods listed in spec Section 10.2.

The command factory should look like:

```ts
import { createApiContext, type ForgeloopApiOptions } from './common';
import type { WorkItem, CreateWorkItemBody } from './types';

export function createForgeloopCommandApi(options: ForgeloopApiOptions = {}) {
  const { baseUrl, request } = createApiContext(options);

  return {
    createWorkItem: (body: CreateWorkItemBody) => request<WorkItem>('/work-items', { method: 'POST', body }),
    // keep the existing command and ordinary object methods here
  };
}

export type ForgeloopCommandApi = ReturnType<typeof createForgeloopCommandApi>;
```

Keep all run event stream helpers and command helpers in this command client because they are command/object surface behavior, not cockpit/replay read models.
The `openRunEventStream()` helper must use the `baseUrl` returned by `createApiContext()` for its `EventSource` URL, preserving the existing stream-token behavior.

- [ ] **Step 4: Create query API client**

Create `apps/web/src/api/query.ts`:

```ts
import { createApiContext, type ForgeloopApiOptions } from './common';
import type { CockpitResponse, TimelineEntry } from './types';

export function createForgeloopQueryApi(options: ForgeloopApiOptions = {}) {
  const { request } = createApiContext(options);

  return {
    getWorkItemCockpit: (workItemId: string) =>
      request<CockpitResponse>(`/query/work-item-cockpit/${encodeURIComponent(workItemId)}`),
    getWorkItemReplay: (workItemId: string) =>
      request<TimelineEntry[]>(`/query/replay/work_item/${encodeURIComponent(workItemId)}`),
  };
}

export type ForgeloopQueryApi = ReturnType<typeof createForgeloopQueryApi>;
```

- [ ] **Step 5: Re-export public web API entrypoint**

Replace `apps/web/src/api.ts` with a compatibility entrypoint that does not combine command and query methods into one client object:

```ts
export type * from './api/types';
export { ForgeloopApiError, type ForgeloopApiOptions } from './api/common';
export { createForgeloopCommandApi, type ForgeloopCommandApi } from './api/commands';
export { createForgeloopQueryApi, type ForgeloopQueryApi } from './api/query';

export const api = createForgeloopCommandApi();
export const queryApi = createForgeloopQueryApi();
```

Add the needed imports at the top of the entrypoint:

```ts
import { createForgeloopCommandApi } from './api/commands';
import { createForgeloopQueryApi } from './api/query';
```

- [ ] **Step 6: Update App.tsx workbench refresh**

In `apps/web/src/App.tsx`, import `api` and `queryApi` from `./api`. Update `refreshWorkbench()` so only cockpit/replay reads use `queryApi`:

```ts
const [cockpitResponse, timelineResponse] = await Promise.all([
  queryApi.getWorkItemCockpit(workItemId),
  queryApi.getWorkItemReplay(workItemId),
]);
```

Keep `api.getEvidenceChain()`, revision list calls, run commands, package commands, and other object/command calls on the command client.

- [ ] **Step 7: Update type imports**

Update `apps/web/src/workbenchState.ts`, `apps/web/src/App.tsx`, and web tests so type imports continue to resolve from `apps/web/src/api.ts` re-exports or from `apps/web/src/api/types.ts`.

- [ ] **Step 8: Update web API tests**

In `tests/web/api.test.ts`:
- import `createForgeloopCommandApi` and `createForgeloopQueryApi`
- change existing command-client tests to call `createForgeloopCommandApi`
- add a query-client test:

```ts
it('fetches cockpit and replay through the query client', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
  const queryApi = createForgeloopQueryApi({ baseUrl: 'http://api.local/root/', fetch: fetchMock });

  await queryApi.getWorkItemCockpit('work item/1');
  await queryApi.getWorkItemReplay('work item/1');

  expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://api.local/root/query/work-item-cockpit/work%20item%2F1', {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
  });
  expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://api.local/root/query/replay/work_item/work%20item%2F1', {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
  });
});
```

- [ ] **Step 9: Update e2e route mocks**

In `tests/e2e/run-console.e2e.test.ts`, update `routeEvidenceWorkbench()` so its mocked cockpit and replay responses use query paths:

```ts
if (path === '/query/work-item-cockpit/work-item-1') return route.fulfill({ json: cockpit });
if (path === '/query/replay/work_item/work-item-1') return route.fulfill({ json: [] });
```

Do not change the evidence-chain mock path in this task.

- [ ] **Step 10: Run frontend checks**

Run:

```bash
pnpm vitest run tests/web/api.test.ts tests/e2e/run-console.e2e.test.ts
pnpm --filter @forgeloop/web build
```

Expected: tests and web build pass.

- [ ] **Step 11: Commit web query client split**

Run:

```bash
git add apps/web/src/api.ts apps/web/src/api apps/web/src/App.tsx apps/web/src/workbenchState.ts tests/web/api.test.ts tests/e2e/run-console.e2e.test.ts
git commit -m "feat: split web command and query api clients"
```

---

### Task 5: Legacy Reference Cleanup And Full Verification

**Files:**
- Modify any remaining files reported by the spec Section 10.2 verification command.
- Do not modify historical prior dated specs/plans unless they are active implementation guidance.

- [ ] **Step 1: Run the required legacy reference search from spec Section 10.2**

Run the exact command from `docs/superpowers/specs/2026-05-09-p0-query-surface-cleanup-design.md` Section 10.2.

Expected allowed matches only:
- the removal spec itself
- negative route assertions proving removed routes return `404`
- historical prior dated specs/plans that are not current implementation guidance

If this plan file appears in the output, remove or rewrite the matching wording from this plan.

- [ ] **Step 2: Remove or update remaining active matches**

For every non-allowed match:
- production code must move to query routes or command-safe names
- scripts must move to query routes
- positive tests must call query routes
- active docs must refer to the cleanup spec instead of copying legacy route strings

- [ ] **Step 3: Verify no durable lookup regression**

Run:

```bash
rg -n 'specRevisionIndex|planRevisionIndex' apps/control-plane-api/src/p0 packages/db tests
pnpm vitest run tests/db/repository.test.ts tests/api/durable-revision-lookup.test.ts
```

Expected:
- no reverse-index matches
- tests pass, or DB-backed durable API tests skip only because `FORGELOOP_DATABASE_URL` is unset

- [ ] **Step 4: Run focused changed-area tests**

Run:

```bash
pnpm vitest run tests/api/query-module.test.ts tests/api/run-events.test.ts tests/api/delivery-flow.test.ts tests/smoke/p0-smoke.test.ts tests/web/api.test.ts tests/e2e/run-console.e2e.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 5: Run full repo verification**

Run:

```bash
pnpm test
pnpm build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit final cleanup**

Run:

```bash
git status --short
git commit -m "chore: verify p0 query surface cleanup"
```

Before the commit command, stage only actual Task 5 cleanup files reported by `git status --short`. Use `git add --` followed by the concrete file paths shown by `git status`; do not copy an example placeholder.

Do not use `git add .` here. If there are no remaining changes after previous commits, skip this commit and record that no final cleanup commit was needed.

---

## Acceptance Checklist

- [ ] Worktree is based on current `main`.
- [ ] QueryModule owns cockpit and replay read-model HTTP routes.
- [ ] P0 command controller no longer exposes the two legacy read routes named in spec Section 10.2.
- [ ] P0Service no longer exposes legacy cockpit/replay wrappers.
- [ ] Durable direct revision lookup remains repository-backed.
- [ ] No reverse-index fields or writes exist in `P0Service`.
- [ ] Unsupported replay object types return `400`.
- [ ] Missing supported replay objects return `404`.
- [ ] Missing cockpit work item returns `404`.
- [ ] Query replay redacts local refs, raw refs, logs artifacts, raw metadata artifacts, and local-ref-only artifact rows.
- [ ] QueryModule tests assert query routes directly and do not compare against legacy routes.
- [ ] Web workbench refresh uses the query client for cockpit and replay.
- [ ] Command API client does not export cockpit/replay read methods.
- [ ] Spec Section 10.2 verification command has only allowed matches.
- [ ] `pnpm test`, `pnpm build`, and `git diff --check` pass.
