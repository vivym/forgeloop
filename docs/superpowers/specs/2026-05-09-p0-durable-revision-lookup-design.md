# P0 Durable Revision Lookup Design

## Status

Draft for review.

## 1. Purpose

ForgeLoop needs revision lookup to survive API restarts in durable mode.

Today `GET /spec-revisions/:specRevisionId` and `GET /plan-revisions/:planRevisionId` depend on in-memory reverse indexes inside `P0Service`. That works only while the process stays alive. After an API restart, the service can still list revisions by parent object, but it can no longer resolve a revision id directly, which breaks restart-safe reads and any flow that needs a revision id to be rehydrated later.

This design makes spec and plan revision lookup a repository responsibility instead of a service-memory responsibility.

## 2. Problem

The current revision path has two different lookup shapes:

- collection lookup by parent id, such as `listSpecRevisions(specId)` and `listPlanRevisions(planId)`
- direct lookup by revision id, such as `getSpecRevision(specRevisionId)` and `getPlanRevision(planRevisionId)`

Only the collection lookup is durable today. `P0Service` keeps `specRevisionIndex` and `planRevisionIndex` in memory, so direct lookup disappears after restart even though the revision rows still exist in storage.

That creates a restart bug in two places:

- the public `spec-revisions/:id` and `plan-revisions/:id` routes
- internal plan/package flows that need to rehydrate the approved current revision after a restart

## 3. Goals

- Make spec revision lookup by id restart-safe in durable mode.
- Make plan revision lookup by id restart-safe in durable mode.
- Remove the need for `P0Service` to remember parent pointers for revision ids.
- Keep the public API shape unchanged.
- Keep both in-memory and Drizzle repository adapters consistent.
- Preserve existing revision ordering, parent-child relationships, and current-revision semantics.

## 4. Non-Goals

- Do not change the public route paths or payload shapes.
- Do not add a generic revision registry table.
- Do not add a schema migration.
- Do not change collection views such as `listSpecRevisions` or `listPlanRevisions`.
- Do not change the spec/plan approval state machine.
- Do not solve unrelated bootstrap, strict-dogfood, or documentation sync issues in this change.

## 5. Recommended Approach

Use the repository as the source of truth for direct revision lookup.

### A. Add direct repository methods

Add `getSpecRevision(specRevisionId)` and `getPlanRevision(planRevisionId)` to `P0Repository`, then implement them in both adapters.

This is the recommended approach. It matches the existing data model, keeps direct lookup durable, and removes the service-side memory dependency entirely.

### B. Rebuild in-memory indexes at startup

This would keep the current service shape but still depend on process-local state. It also leaves restart safety split across service boot logic and repository behavior, which is the wrong boundary.

### C. Fall back to scanning collection lists

This would work functionally, but it bakes a slower and less explicit lookup path into the service. It also makes the contract ambiguous: revision lookup should be a primary-key operation, not a parent-list scan.

## 6. Architecture

### 6.1 Repository contract

Extend `P0Repository` with:

- `getSpecRevision(specRevisionId: string): Promise<SpecRevision | undefined>`
- `getPlanRevision(planRevisionId: string): Promise<PlanRevision | undefined>`

The existing collection methods remain unchanged:

- `listSpecRevisions(specId)`
- `listPlanRevisions(planId)`

Collection methods stay responsible for ordered revision history. Direct methods stay responsible for id-based rehydration.

### 6.2 In-memory adapter

`InMemoryP0Repository` should resolve revision ids directly from its revision maps.

That keeps restart tests honest because the repository itself remains the durable lookup boundary for the lifetime of the injected repository instance.

### 6.3 Drizzle adapter

`DrizzleP0Repository` should query the revision tables by primary key.

No schema changes are required because both revision tables already model revisions as their own durable records.

### 6.4 Service layer

`P0Service.getSpecRevision()` and `P0Service.getPlanRevision()` should call the repository directly.

`specRevisionIndex` and `planRevisionIndex` should be removed from service state.

The rest of the service stays the same:

- `saveSpecRevision()` and `savePlanRevision()` still create the revision row and update the parent object’s `current_revision_id`
- `generatePlanDraft()` still resolves the approved current spec revision before generating a plan draft
- `packageContext()` still resolves the approved current plan revision before generating packages

### 6.5 Read paths

Read paths that already operate by parent id should keep doing that:

- `listSpecRevisions(specId)`
- `listPlanRevisions(planId)`
- timeline assembly over a spec or plan and its revision history

The design only changes direct lookup by revision id.

## 7. Data Flow

1. A spec or plan revision is created.
2. The repository persists the revision row.
3. The parent spec or plan is updated with the new `current_revision_id`.
4. Later, a route or internal flow needs the revision by id.
5. `P0Service` calls the repository directly by revision id.
6. The repository returns the durable row, even after API restart.

This makes the direct revision path independent of process memory.

## 8. Error Handling

- If a revision id does not exist, the service should continue to return `NotFoundException`.
- If a parent object exists but is not pointing at the requested current revision, existing validation errors should remain in place.
- The service should not silently fall back to scanning a parent collection when direct lookup fails.

The key rule is that missing process memory must not masquerade as a missing database row.

## 9. Testing

Add focused coverage in three places:

- repository adapter tests for `getSpecRevision` and `getPlanRevision`
- API restart regression coverage that reuses the same repository instance across a fresh app boot
- existing plan/spec flow tests to confirm draft generation still works after the direct lookup change

The regression should prove that:

- a revision route still works after the API restarts
- `generatePlanDraft()` can rehydrate the approved spec revision after restart
- `generatePackages()` can rehydrate the approved plan revision after restart

## 10. Acceptance Criteria

- `P0Repository` exposes durable `getSpecRevision` and `getPlanRevision` methods.
- Both repository adapters implement those methods.
- `P0Service` no longer keeps revision reverse indexes in memory.
- `GET /spec-revisions/:id` and `GET /plan-revisions/:id` work after restarting the API with the same durable repository.
- Plan package generation and spec/plan draft flows still resolve current revisions correctly after restart.
- Collection revision listing behavior is unchanged.
- No schema migration is required.
