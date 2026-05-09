# P0 Query Surface Cleanup Design

## Status

Draft for review.

## 1. Purpose

ForgeLoop now has a dedicated QueryModule for work item cockpit and replay reads, but the web client and parts of the API still treat those reads as legacy `work-items` routes. Because the project is not live, this is the right time to remove the compatibility surface instead of carrying two ways to fetch the same read model.

This design makes the query/read-model boundary the only cockpit and replay boundary end to end.

## 2. Problem

The current code has two overlapping API shapes for the same data:

- legacy command-surface routes:
  - `GET /work-items/:workItemId/cockpit`
  - `GET /work-items/:workItemId/timeline`
- dedicated query-surface routes:
  - `GET /query/work-item-cockpit/:workItemId`
  - `GET /query/replay/work_item/:objectId`

That overlap creates three problems.

First, the API boundary is ambiguous. `P0Service` still exposes cockpit and timeline wrappers even though read-model composition belongs in `packages/db/src/queries/*` and the NestJS QueryModule.

Second, the web client still calls the legacy routes from the general API client. This keeps read-model fetches coupled to the command-oriented P0 surface.

Third, tests currently compare QueryModule output against the legacy routes. That proves compatibility, but it also makes the legacy routes look like the source of truth.

## 3. Goals

- Make QueryModule the only HTTP boundary for work item cockpit and replay reads.
- Remove legacy cockpit and timeline routes from the P0 command controller.
- Remove cockpit and timeline wrappers from `P0Service`.
- Refactor the web API client so command APIs and query/read-model APIs are separate.
- Keep the current workbench UI behavior and response shapes stable.
- Add explicit object type validation at the QueryModule boundary.
- Update tests so they assert the query surface directly instead of comparing to legacy routes.
- Keep this work independent from the durable revision lookup workstream.

## 4. Non-Goals

- Do not redesign the workbench UI.
- Do not implement release cockpit, incident replay, or manager dashboards.
- Do not change the database schema.
- Do not change spec or plan revision lookup semantics.
- Do not touch repository-level direct revision lookup work.
- Do not keep backward-compatible legacy cockpit or timeline routes.
- Do not change command routes for work items, specs, plans, packages, runs, reviews, or evidence chains.

## 5. Recommended Approach

Use a one-time cleanup instead of a compatibility migration.

### A. Endpoint-only switch

The smallest change would point the web client at `/query/*` and leave the legacy routes in place.

This reduces immediate risk, but it keeps two route families alive and leaves future contributors unsure which surface is canonical.

### B. Backend-only cleanup

The API could delete the legacy routes while leaving the web API client mostly as a single monolithic module.

This removes the biggest backend ambiguity, but it leaves the frontend boundary muddy.

### C. End-to-end Query Surface cleanup

This is the recommended approach.

Delete the legacy backend routes, make QueryModule the only cockpit/replay source, and split the web client so read-model calls are separate from command calls. This is a larger change than A or B, but it is still narrow: it affects the cockpit/replay path only and avoids future compatibility debt.

## 6. Architecture

### 6.1 API boundary

The API should have a clear boundary between P0 object operations and read-model aggregation.

The P0 object surface owns existing entity operations:

- work item CRUD
- spec and plan entity routes, including existing create/list/get revision routes and commands; durable direct revision lookup semantics remain separate
- execution package commands
- run and review commands
- existing evidence chain reads

The QueryModule owns read-model aggregation:

- work item cockpit
- object replay timeline

After this cleanup, the only supported cockpit and replay routes are:

- `GET /query/work-item-cockpit/:workItemId`
- `GET /query/replay/work_item/:objectId`

The following routes should be removed rather than kept as aliases:

- `GET /work-items/:workItemId/cockpit`
- `GET /work-items/:workItemId/timeline`

### 6.2 Query composition

`packages/db/src/queries/*` remains the read-model composition layer.

`QueryService` should call the query helpers, serialize public run session metadata, and map missing objects or invalid object types to HTTP errors. It should not duplicate query assembly logic.

Unsupported replay object type validation should live in `QueryService`. It should not require changes to repository revision lookup, revision listing, or durable revision semantics.

`P0Service` should no longer expose cockpit or timeline methods. Removing those methods should also remove any imports that exist only for cockpit or timeline assembly.

### 6.3 Object type validation

`GET /query/replay/:objectType/:objectId` should validate `objectType` before calling the database query helper.

For this spec, only `work_item` is in scope.

Unsupported types should return `400 Bad Request`. Supported types with missing objects should return `404 Not Found`.

This leaves an explicit extension point for future `release` or `incident` replay work without implementing those domains now.

### 6.4 Web client boundary

The web client should separate command APIs from query APIs.

The target shape should be conceptually equivalent to:

- `apps/web/src/api/commands.ts` for command and ordinary object routes
- `apps/web/src/api/query.ts` for cockpit and replay read-model routes
- shared request/error handling in a small common module
- shared DTO/domain response types in a common API types module when they are used by both command and query clients

The exact file split can follow the existing code style, but the required boundary is this: workbench refresh must call the query client for cockpit and replay, not the command client.

The command API export should not expose cockpit or replay/timeline functions after the cleanup. Those functions should be exported only from the query API client.

The UI can keep its current state names, including `cockpit` and `timeline`, because the user-facing model has not changed. Only the source route and client ownership changes.

## 7. Data Flow

1. A user selects a work item in the web workbench.
2. `refreshWorkbench(workItemId)` calls the query API:
   - `getWorkItemCockpit(workItemId)`
   - `getWorkItemReplay(workItemId)`
3. The query API sends:
   - `GET /query/work-item-cockpit/:workItemId`
   - `GET /query/replay/work_item/:workItemId`
4. The QueryModule calls the shared database query helpers.
5. The web UI stores the cockpit and replay responses.
6. Command actions still call command routes. After a successful command, the workbench refreshes through the same query flow.

The frontend should not manually compose current spec, current plan, package, run, or review state after command success. QueryModule is the source of truth for the refreshed read model.

## 8. Error Handling

- Missing work item cockpit returns `404 Not Found`.
- Missing supported replay object returns `404 Not Found`.
- Unsupported replay object type returns `400 Bad Request`.
- The web client should continue to use the existing `ForgeloopApiError` behavior.
- Workbench refresh should not silently fall back to legacy routes.
- Old cockpit and timeline route calls should fail because those routes no longer exist. If negative route assertions are added, `GET /work-items/:workItemId/cockpit` and `GET /work-items/:workItemId/timeline` should return `404 Not Found`.

The cleanup should not alter revision-specific errors such as missing `current_revision_id`, stale revision pointers, or direct `spec-revisions/:id` and `plan-revisions/:id` lookup behavior.

## 9. Durable Revision Lookup Coordination

This work is independent from the durable revision lookup work in the parallel worktree, currently represented by `/Users/viv/projs/forgeloop/.worktrees/p0-durable-revision-lookup-plan/docs/superpowers/plans/2026-05-09-p0-durable-revision-lookup.md` and the active-tree design `docs/superpowers/specs/2026-05-09-p0-durable-revision-lookup-design.md`.

That plan owns:

- `packages/db/src/repositories/p0-repository.ts`
- `packages/db/src/repositories/in-memory-p0-repository.ts`
- `packages/db/src/repositories/drizzle-p0-repository.ts`
- `tests/db/repository.test.ts`
- revision lookup behavior in `apps/control-plane-api/src/p0/p0.service.ts`
- `tests/api/durable-revision-lookup.test.ts`

This query cleanup must not modify repository direct revision lookup, durable restart tests, spec revision routes, plan revision routes, or plan/spec generation restart semantics.

This cleanup intentionally removes only legacy cockpit/timeline read routes. The durable revision lookup plan's route-path guardrail applies to spec/plan revision routes and generation flows, which this cleanup must not touch.

The only expected overlapping file is `apps/control-plane-api/src/p0/p0.service.ts`. In that file, this cleanup is limited to deleting cockpit/timeline wrappers and related imports. If durable revision lookup has already changed `getSpecRevision()` or `getPlanRevision()`, those changes must be preserved.

## 10. Testing

### 10.1 Backend API tests

Update QueryModule tests so they assert the query routes directly.

They should cover:

- successful work item cockpit response from `/query/work-item-cockpit/:workItemId`
- missing work item cockpit returning `404`
- successful work item replay response from `/query/replay/work_item/:objectId`
- unsupported replay object type returning `400`
- missing supported object returning `404`

The unsupported object type test should not depend on any seeded object existing. It should prove the request is rejected at the object-type boundary.

Tests should no longer compare QueryModule responses against legacy `work-items` cockpit or timeline routes.

Existing API tests that inspect cockpit or timeline data should call `/query/*` routes.

### 10.2 Legacy route removal checks

The implementation should search for and remove references in production code, scripts, active docs other than this removal spec, and positive tests to:

- `/work-items/:id/cockpit`
- `/work-items/:id/timeline`
- `/work-items/${...}/cockpit`
- `/work-items/${...}/timeline`
- `work-items/:workItemId/cockpit`
- `work-items/:workItemId/timeline`
- `cockpit(workItemId`
- `timeline(workItemId`
- `getCockpit`
- `getTimeline`

Negative route assertions may reference the removed routes. This removal spec may reference the routes it removes. Historical superseded specs may retain references only if they are clearly non-canonical.

### 10.3 Frontend checks

The web build should prove the API client split is type-safe.

If there are existing frontend unit tests around API routes or workbench refresh, update them to mock the query client. If there is no frontend test harness for this area, the implementation should at minimum rely on TypeScript/build coverage and the backend API tests.

### 10.4 Full verification

Before completion, run:

- `pnpm test`
- `pnpm build`
- `git diff --check`

If durable revision lookup tests exist in the active branch, this cleanup should not cause them to fail.

## 11. Acceptance Criteria

- Web workbench refresh uses `/query/work-item-cockpit/:workItemId`.
- Web workbench replay/timeline uses `/query/replay/work_item/:workItemId`.
- Cockpit and replay functions are exported from a query API client namespace or module separate from command APIs.
- `App.tsx` calls the query API client for workbench refresh.
- The command API export no longer exposes `getCockpit` or `getTimeline`.
- `P0Controller` no longer exposes legacy cockpit or timeline routes.
- `P0Service` no longer exposes cockpit or timeline methods.
- QueryModule validates replay object type before querying.
- Unsupported replay object types return `400`.
- Supported but missing replay objects return `404`.
- Missing work item cockpit returns `404`.
- QueryModule tests no longer depend on legacy routes.
- Existing cockpit/timeline API tests are updated to the query surface.
- No production code, scripts, active docs other than this removal spec, or positive tests reference legacy cockpit or timeline work-item routes. Negative route assertions may reference the removed routes. Historical superseded specs may retain references only if they are clearly non-canonical.
- Durable revision lookup files and semantics are left untouched except for deleting `P0Service` cockpit/timeline methods and their related imports.
- Any durable lookup changes to `getSpecRevision()`, `getPlanRevision()`, or reverse-index removal are preserved.
