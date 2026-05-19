# Role-Based Workbench Product Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the coarse legacy workbench surface with canonical Product Lanes and one strict ProductAction model shared by Workbench and Work Item Detail.

**Architecture:** This is a destructive migration across contracts, DB projections, API query endpoints, Web API/cache keys, Workbench UI, and Work Item Detail. The new contract is the ownership boundary: backend projections validate outbound responses before returning, and Web consumes only ProductLane/ProductAction DTOs without compatibility shims or fallback routes.

**Tech Stack:** TypeScript, Zod, NestJS, Drizzle-backed repository queries, React Router, React Query, Vitest, Testing Library, Supertest.

---

## Source Of Truth

- Spec: `docs/superpowers/specs/2026-05-19-role-based-workbench-product-actions-design.md`
- PRD context: `docs/PRD_v1.md`
- Required implementation skill: @superpowers:subagent-driven-development for execution, or @superpowers:executing-plans for inline execution.
- Hard constraint: no compatibility endpoint, route alias, type adapter, deprecated wrapper, fallback query, double-read path, or renamed historical boundary survives this slice.
- Parallel branch boundary: do not touch or depend on `feature/codex-generation-runtime-plan-package`.

## File Structure

### Contracts

- Modify: `packages/contracts/src/api.ts`
  - Add `productLaneIdSchema`, `productHrefSchema`, `productActionTargetSchema`, `productCommandSchema`, `productActionSchema`, `productLaneItemSchema`, `productLaneResponseSchema`, and `workItemActionsResponseSchema`.
  - Export `ProductLaneId`, `ProductHref`, `ProductActionTarget`, `ProductCommand`, `ProductAction`, `ProductLaneItem`, `ProductLaneResponse`, and `WorkItemActionsResponse`.
  - Remove the superseded workbench response/action contract exports listed in the Explicit Deletion Checklist.
- Modify: `packages/contracts/src/index.ts`
  - Keep exporting `api.ts`; no new barrel file is required unless `api.ts` grows too large during implementation.
- Create: `tests/contracts/product-actions.test.ts`
  - Contract tests for lane ids, href validation, discriminated ProductAction rules, command payload consistency, response cross-field invariants, duplicate ids, and absence of removed exports.

### DB Query Projection

- Create: `packages/db/src/queries/product-lane-types.ts`
  - Internal projection types, lane metadata, filter matrix, canonical Work Item kind mapping, priority ordering constants.
- Create: `packages/db/src/queries/product-action-builders.ts`
  - Pure action builder helpers that always emit contract-shaped ProductActions and never infer Web hrefs outside allowed product UI routes.
- Create: `packages/db/src/queries/product-lane-filters.ts`
  - Apply parsed Product Lane filters to normalized lane items and compute `unsupported_filters` in declaration order.
- Create: `packages/db/src/queries/product-lane-queries.ts`
  - Public DB query functions: `getProductLane(repository, laneId, filters)` and lane-specific projection orchestration.
- Create: `packages/db/src/queries/work-item-action-queries.ts`
  - Public DB query function: `getWorkItemActions(repository, workItemId, laneId?, options)`.
  - Loads Work Item cockpit context with required runtime metadata options and augments it with related Releases linked directly to the Work Item or to its Execution Packages.
- Modify: `packages/db/src/index.ts`
  - Export the new product-lane query modules.
  - Remove the old query export listed in the Explicit Deletion Checklist.

### API

- Create: `apps/control-plane-api/src/modules/query/product-lane-query-parser.ts`
  - Strict request parser for Product Lane and Work Item actions query strings.
  - Reject unknown keys, duplicate/array values, empty strings, invalid booleans, invalid lanes, and non-integer limits.
  - Clamp `limit` to `1..100` with default `50`.
- Modify: `apps/control-plane-api/src/modules/query/query.service.ts`
  - Replace the previous queue service method with `getProductLane(laneId, rawQuery)` and `getWorkItemActions(workItemId, rawQuery)`.
  - Own the API-to-DB options boundary for Work Item actions by passing `run_session_metadata_fallback: this.initialRuntimeMetadata()` into the DB query.
  - Validate outbound payloads with contract schemas before returning.
- Modify: `apps/control-plane-api/src/modules/query/query.controller.ts`
  - Add `GET /query/product-lanes/:laneId`.
  - Add `GET /query/work-items/:workItemId/actions`.
  - Remove the old controller methods listed in the Explicit Deletion Checklist.
- Test: `tests/api/product-lanes.test.ts`
  - New Supertest coverage for all ten lanes, filter matrix behavior, strict query parsing, response validation failures, Work Item actions, and removed endpoint behavior.
- Modify: `tests/api/query-module.test.ts`
  - Update route registration assertions to use Product Lane endpoint names only.

### Web API And Cache

- Modify: `apps/web/src/shared/api/types.ts`
  - Re-export Product Lane and ProductAction contract types.
  - Add `ProductLaneQuery` and `WorkItemActionsQuery`.
  - Remove old Web type aliases listed in the Explicit Deletion Checklist.
- Modify: `apps/web/src/shared/api/query.ts`
  - Add `getProductLane(laneId, query)` using `productLaneResponseSchema.parse`.
  - Add `getWorkItemActions(workItemId, query)` using `workItemActionsResponseSchema.parse`.
  - Remove old API helper listed in the Explicit Deletion Checklist.
- Modify: `apps/web/src/shared/api/query-keys.ts`
  - Add `normalizeProductLaneQuery`.
  - Add `queryKeys.productLane(laneId, query)` and `queryKeys.workItemActions(workItemId, laneId?)`.
  - Keep prefix-friendly keys so invalidation can target all lane query variants by project.
- Modify: `apps/web/src/shared/api/hooks.ts`
  - Add `useProductLaneQuery`.
  - Add `useWorkItemActionsQuery`.
  - Add ProductAction command mutation helpers that map only the allowed command union to existing hooks and perform the required invalidations.
  - Remove old hook and mapping imports listed in the Explicit Deletion Checklist.
- Test: `tests/web/api.test.ts`
  - URL construction and schema parsing tests for the new query helpers.
- Test: `tests/web/api-hooks.test.tsx`
  - Query key normalization, hook calls, and command invalidation tests.

### Web Product Lane UI

- Create: `apps/web/src/features/product-lanes/product-lanes.ts`
  - Lane metadata, route segment parsing, labels, descriptions, default lane, Work Item kind to default lane mapping, and local lane validation.
- Create: `apps/web/src/features/product-actions/product-actions.ts`
  - ProductAction sorting, button state mapping, and narrow command capability mapping.
- Create: `apps/web/src/features/product-actions/product-action-list.tsx`
  - Shared renderer for navigate, command, disabled, and blocked ProductActions.
- Create: `apps/web/src/features/product-lanes/product-lane-view-model.ts`
  - Convert `ProductLaneResponse` into table rows, summary stats, unsupported filter notices, and selected item state.
- Create: `apps/web/src/features/product-lanes/product-lane-table.tsx`
  - Queue table with object, kind/surface, state, risk, updated age, and primary ProductAction CTA.
- Create: `apps/web/src/features/product-lanes/product-lane-workbench.tsx`
  - Route body for `/workbench/:laneId`, including lane nav, filters from search params, selection resolution, summary, table, and ActionRail.
- Create: `apps/web/src/app/routes/workbench/$laneId.tsx`
  - Route module for canonical lane routes.
- Modify: `apps/web/src/app/routes/workbench/index.tsx`
  - Redirect `/workbench` to `/workbench/requirements`, preserving supported query params and stripping old route/query state listed in the Explicit Deletion Checklist.
- Modify: `apps/web/src/app/routes.ts`
  - Register `workbench/:laneId`.
- Test: `tests/web/workbench-product-route.test.tsx`
  - Route redirect, unknown lane state, enabled lane navigation, API calls, unsupported filter notice, action sorting, selection re-resolution, and no disabled lane tabs.

### Work Item Detail Next Actions

- Create: `apps/web/src/features/work-items/work-item-next-actions.tsx`
  - Derive lane from `?lane=` or Work Item kind, validate lane locally, fetch actions, render unavailable/loading/empty/error states, and reuse `ProductActionList`.
- Modify: `apps/web/src/features/work-items/work-item-detail.tsx`
  - Replace placeholder action rail with `WorkItemNextActions`.
  - Keep the main Work Item cockpit content as a summary, not lifecycle forms.
- Test: `tests/web/work-item-product-route.test.tsx`
  - Default lane derivation, valid lane query, invalid lane local handling without fetch, shared action rendering, and removal of placeholder actions.

### Fixtures, E2E, And Guards

- Modify: `tests/web/fixtures/product-api-mock.ts`
  - Replace workbench route mocks with Product Lane and Work Item actions mocks.
- Modify: `tests/web/fixtures/product-data.ts`
  - Add ProductAction and ProductLane fixtures covering navigate, command, disabled, blocked, manager lane, and target lane cases.
- Modify: `tests/e2e/web-product-routes.e2e.test.ts`
  - Update mocked network requests and assertions to the new Workbench route/API surface.
- Modify: `tests/web/no-legacy-web-ui.test.ts`
  - Expand guard coverage for the deleted names and product-facing routes listed below.
- Modify: `tests/naming/delivery-naming.test.ts`
  - If needed, exclude historical docs and this migration spec while enforcing active code/test naming cleanup.

## Explicit Deletion Checklist

All legacy names in this section are deletion targets only. Do not copy them into new active code, fixtures, route mocks, query keys, or non-checklist plan text.

- Delete file: `packages/db/src/queries/role-workbench-queries.ts`
- Delete directory: `apps/web/src/features/role-workbench/`
- Rename file: `tests/api/role-workbenches.test.ts` -> `tests/api/product-lanes.test.ts`
- Delete file: `apps/web/src/app/routes/workbench/index.tsx` only if replacing it with a redirect module at the same path would be less clear; otherwise rewrite it completely.
- Delete endpoint family: `GET /query/workbenches/*`
- Delete product route/query aliases: `/workbench/work-item-owner`, `?role=`
- Delete product-facing lane ids: `intake`, `manager-health`, `work-item-owner`
- Delete exports/types/symbols:
  - `RoleWorkbenchAction`
  - `RoleWorkbenchResponse`
  - `RoleWorkbenchId`
  - `RoleWorkbenchFilters`
  - `RoleWorkbenchRoute`
  - `RoleQueue*`
  - `roleWorkbench*`
  - `RoleWorkbench*`
  - `getRoleWorkbench`
  - `useWorkbenchQuery`
  - `workbenchIdForProductRole`
  - `productRoleToWorkbenchId`
  - `workItemOwnerRole`
  - `workItemOwnerWorkbenchId`
- Delete Web placeholder copy/buttons:
  - `Update brief`
  - `Attach evidence`
  - `Available after a draft exists`

## Task 0: Baseline Safety Check

**Files:**
- Read only: root workspace

- [ ] **Step 0.1: Confirm branch and clean baseline**

Run:

```bash
git status --short --branch
```

Expected: branch is `feature/role-based-workbench-product-actions-spec`; no unrelated modified files.

- [ ] **Step 0.2: Capture current legacy references**

Run:

```bash
pnpm vitest run tests/web/no-legacy-web-ui.test.ts tests/naming/delivery-naming.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: the current guard may fail before implementation; use the failure output only to confirm active migration targets match the Explicit Deletion Checklist.

## Task 1: ProductAction Contracts

**Files:**
- Modify: `packages/contracts/src/api.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `tests/contracts/product-actions.test.ts`

- [ ] **Step 1.1: Write failing contract tests**

Add tests that assert:

```ts
import {
  productActionSchema,
  productLaneIdSchema,
  productLaneResponseSchema,
  workItemActionsResponseSchema,
} from '@forgeloop/contracts';

expect(productLaneIdSchema.options).toEqual([
  'requirements',
  'bugs',
  'tech-debt',
  'initiatives',
  'spec-approver',
  'execution-owner',
  'reviewer',
  'qa-test-owner',
  'release-owner',
  'manager',
]);

expect(() =>
  productActionSchema.parse({
    id: 'open-work-item',
    lane_id: 'bugs',
    priority: 'primary',
    label: 'Open bug',
    enabled: true,
    kind: 'navigate',
    target: {
      kind: 'object',
      object_type: 'work_item',
      object_id: 'wi_1',
      href: '/work-items/wi_1#replay',
    },
  }),
).not.toThrow();
```

Also add negative tests for:

- unknown object fields;
- empty trimmed strings;
- navigate action with `command`;
- command action without `command`;
- enabled action carrying `disabled_reason` or `blocked_reason`;
- disabled action missing `disabled_reason`;
- blocked action missing `blocked_reason`;
- manager lane command action;
- target lane href that does not match `lane_id`;
- external, protocol-relative, traversal, `/query/*`, and mutating endpoint hrefs;
- command `object_id` mismatches;
- duplicate `ProductLaneItem.id`;
- duplicate action ids inside one item and inside Work Item actions response;
- removed contract exports are absent from `Object.keys(await import('@forgeloop/contracts'))`.

- [ ] **Step 1.2: Run tests and verify they fail**

Run:

```bash
pnpm vitest run tests/contracts/product-actions.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because the ProductAction schemas are not implemented.

- [ ] **Step 1.3: Implement ProductAction schemas**

In `packages/contracts/src/api.ts`, add the schemas near the existing query DTO exports:

```ts
const nonEmptyTrimmedStringSchema = z.string().trim().min(1);

export const productLaneIds = [
  'requirements',
  'bugs',
  'tech-debt',
  'initiatives',
  'spec-approver',
  'execution-owner',
  'reviewer',
  'qa-test-owner',
  'release-owner',
  'manager',
] as const;

export const productLaneIdSchema = z.enum(productLaneIds);
export type ProductLaneId = z.infer<typeof productLaneIdSchema>;

export const productActionPrioritySchema = z.enum(['primary', 'secondary', 'tertiary']);
export const productObjectTypeSchema = z.enum([
  'work_item',
  'spec',
  'spec_revision',
  'plan',
  'plan_revision',
  'execution_package',
  'run_session',
  'review_packet',
  'release',
]);
```

Implement `productHrefSchema` as a string transform/refinement that parses against a fixed base, rejects non-relative and normalized forbidden paths, and accepts only allowed UI route bases.

Implement command variants with `z.discriminatedUnion('type', [...])`, then add a `superRefine` that checks `object_id` equals the concrete id field for each command type.

Implement `productActionSchema` as a `z.discriminatedUnion('kind', [navigate, command])` and add cross-field `superRefine` rules for enabled/disabled/blocked and manager lane.

Implement response schemas with `superRefine` checks for action lane match and duplicate ids.

- [ ] **Step 1.4: Remove old contract exports**

Remove only the superseded contract schemas and exported types from `packages/contracts/src/api.ts`. Keep command inventory and existing command request/response contracts untouched.

- [ ] **Step 1.5: Run contract tests**

Run:

```bash
pnpm vitest run tests/contracts/product-actions.test.ts tests/contracts/contracts.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 1.6: Commit contracts checkpoint**

Run:

```bash
git add packages/contracts/src/api.ts packages/contracts/src/index.ts tests/contracts/product-actions.test.ts
git commit -m "feat: add product action contracts"
```

Expected: commit succeeds. If root typecheck is red because consumers still reference removed exports, defer this commit and include Task 2/3 consumer changes in the same commit per the spec green-state rule.

## Task 2: Product Lane DB Projection

**Files:**
- Create: `packages/db/src/queries/product-lane-types.ts`
- Create: `packages/db/src/queries/product-action-builders.ts`
- Create: `packages/db/src/queries/product-lane-filters.ts`
- Create: `packages/db/src/queries/product-lane-queries.ts`
- Create: `packages/db/src/queries/work-item-action-queries.ts`
- Modify: `packages/db/src/index.ts`
- Replace tests: previous API queue test file -> `tests/api/product-lanes.test.ts`

- [ ] **Step 2.1: Rename the API test file before editing assertions**

Run:

```bash
source_path=$(awk -F'`' '/Rename file:/ { print $2; exit }' docs/superpowers/plans/2026-05-19-role-based-workbench-product-actions.md)
git mv "$source_path" tests/api/product-lanes.test.ts
```

Expected: file is moved and history is preserved.

- [ ] **Step 2.2: Write failing DB/API projection assertions in the renamed test**

Add or rewrite tests so they call the new API route names once Task 3 lands, but isolate expected projection shape now:

```ts
expect(response.body).toMatchObject({
  lane_id: 'bugs',
  unsupported_filters: [],
  summary: expect.objectContaining({
    total: 1,
    blocked: expect.any(Number),
    high_risk: expect.any(Number),
    stale: expect.any(Number),
  }),
});

expect(response.body.items[0]).toMatchObject({
  kind: 'bug',
  object: { type: 'work_item' },
});

expect(response.body.items[0].actions[0]).toMatchObject({
  lane_id: 'bugs',
  kind: 'navigate',
  priority: 'primary',
  enabled: true,
});
```

Cover each lane with at least one seeded object or lane summary. Preserve the valuable old fixture setup, but change expected DTOs to `ProductLaneResponse`.

- [ ] **Step 2.3: Run renamed tests and verify they fail**

Run:

```bash
pnpm vitest run tests/api/product-lanes.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because new DB query exports and endpoints do not exist yet.

- [ ] **Step 2.4: Add product lane internal types**

In `product-lane-types.ts`, define:

```ts
export const productLaneQueryKeys = [
  'project_id',
  'actor_id',
  'owner_actor_id',
  'reviewer_actor_id',
  'qa_owner_actor_id',
  'release_owner_actor_id',
  'cursor',
  'limit',
  'kind',
  'phase',
  'status',
  'gate_state',
  'resolution',
  'risk',
  'blocked',
  'stale',
] as const;

export const workItemKindByLane = {
  requirements: 'requirement',
  bugs: 'bug',
  'tech-debt': 'tech_debt',
  initiatives: 'initiative',
} as const;
```

Define the filter matrix in data, not nested conditionals, so API and DB tests can reason about `unsupported_filters` order.

- [ ] **Step 2.5: Add ProductAction builder helpers**

In `product-action-builders.ts`, create pure helpers:

```ts
export const navigateAction = (input: NavigateActionInput): ProductAction => productActionSchema.parse({
  id: input.id,
  lane_id: input.laneId,
  priority: input.priority,
  label: input.label,
  description: input.description,
  enabled: input.enabled,
  disabled_reason: input.disabledReason,
  blocked_reason: input.blockedReason,
  kind: 'navigate',
  target: input.target,
});
```

Create one command builder per allowed command type. Each command builder must require all concrete ids in its TypeScript input, including `work_item_id`.

- [ ] **Step 2.6: Add filter helpers**

In `product-lane-filters.ts`, implement:

- `resolveLaneFilters(laneId, query)` returning applied filters, conflicts, and `unsupported_filters`;
- `matchesProductLaneFilters(item, filters)` using normalized item fields only;
- pagination over filtered items with summary computed before pagination.

Use declaration-order sorting for `unsupported_filters` via `productLaneQueryKeys`.

- [ ] **Step 2.7: Add product lane query orchestration**

In `product-lane-queries.ts`, implement:

```ts
export async function getProductLane(
  repository: DeliveryRepository,
  laneId: ProductLaneId,
  filters: ParsedProductLaneFilters,
): Promise<ProductLaneResponse> {
  const candidates = await loadLaneCandidates(repository, laneId, filters);
  const normalized = candidates.map((candidate) => toProductLaneItem(repository, laneId, candidate));
  return productLaneResponseSchema.parse(buildProductLaneResponse(laneId, normalized, filters));
}
```

Use extracted helper logic from the previous projection only after moving it under product-lane-named functions. Do not import from the deleted module.

- [ ] **Step 2.8: Add Work Item actions query**

In `work-item-action-queries.ts`, implement:

```ts
export interface WorkItemActionQueryOptions {
  cockpit: WorkItemCockpitOptions;
}

export async function getWorkItemActions(
  repository: DeliveryRepository,
  workItemId: string,
  laneId: ProductLaneId | undefined,
  options: WorkItemActionQueryOptions,
): Promise<WorkItemActionsResponse | undefined> {
  const cockpit = await getWorkItemCockpit(repository, workItemId, options.cockpit);
  if (cockpit === undefined) return undefined;

  const packageIds = new Set(cockpit.packages.map((executionPackage) => executionPackage.id));
  const releases = (await repository.listReleases(cockpit.work_item.project_id)).filter(
    (release) =>
      release.work_item_ids.includes(cockpit.work_item.id) ||
      release.execution_package_ids.some((executionPackageId) => packageIds.has(executionPackageId)),
  );

  const defaultLaneId = laneForWorkItemKind(cockpit.work_item.kind);
  const effectiveLaneId = laneId ?? defaultLaneId;
  return workItemActionsResponseSchema.parse({
    work_item_id: workItemId,
    lane_id: effectiveLaneId,
    default_lane_id: defaultLaneId,
    actions: buildActionsForWorkItemLane({ cockpit, releases }, effectiveLaneId),
  });
}
```

Missing Spec/Plan record actions must navigate to the Work Item Spec/Plan flow; they must not emit create or draft-generation commands. Release Owner, QA, and Manager lane Work Item actions must use the `releases` context above so linked release blockers and acceptance gates can produce navigation actions.

- [ ] **Step 2.9: Update DB exports and remove old export**

Modify `packages/db/src/index.ts` so only the new product lane modules are exported for this surface.

- [ ] **Step 2.10: Run DB/API projection tests**

Run:

```bash
pnpm vitest run tests/api/product-lanes.test.ts tests/api/query-module.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: Product projection assertions may still fail at route level until Task 3; type errors should point only to missing API wiring.

- [ ] **Step 2.11: Commit DB checkpoint**

Run:

```bash
git add packages/db/src/queries/product-lane-types.ts packages/db/src/queries/product-action-builders.ts packages/db/src/queries/product-lane-filters.ts packages/db/src/queries/product-lane-queries.ts packages/db/src/queries/work-item-action-queries.ts packages/db/src/index.ts tests/api/product-lanes.test.ts
git commit -m "feat: add product lane projections"
```

Expected: commit succeeds only if the workspace is green. Otherwise defer until Task 3 in the same coordinated commit.

## Task 3: Product Lane API Endpoints

**Files:**
- Create: `apps/control-plane-api/src/modules/query/product-lane-query-parser.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.service.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.controller.ts`
- Modify: `tests/api/product-lanes.test.ts`
- Modify: `tests/api/query-module.test.ts`

- [ ] **Step 3.1: Add strict parser tests**

In `tests/api/product-lanes.test.ts`, add Supertest cases:

```ts
await request(app.getHttpServer())
  .get(`/query/product-lanes/bugs?project_id=${project.id}&kind=requirement`)
  .expect(400);

await request(app.getHttpServer())
  .get(`/query/product-lanes/bugs?project_id=${project.id}&blocked=yes`)
  .expect(400);

await request(app.getHttpServer())
  .get(`/query/product-lanes/bugs?project_id=${project.id}&unknown=value`)
  .expect(400);

await request(app.getHttpServer())
  .get(`/query/work-items/${workItem.id}/actions?lane=`)
  .expect(400);
```

Add a removed endpoint test using the deleted endpoint family from the Explicit Deletion Checklist:

```ts
const deletedEndpoint = `/query/${'workbenches'}/spec-approver?project_id=p`;
await request(app.getHttpServer()).get(deletedEndpoint).expect(404);
```

- [ ] **Step 3.2: Run tests and verify they fail**

Run:

```bash
pnpm vitest run tests/api/product-lanes.test.ts tests/api/query-module.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because the new endpoints/parser are missing and the removed route still exists.

- [ ] **Step 3.3: Implement the strict parser**

In `product-lane-query-parser.ts`, implement:

```ts
export function parseProductLaneQuery(laneId: ProductLaneId, raw: RawQuery): ParsedProductLaneFilters {
  assertKnownKeys(raw, productLaneQueryKeys);
  const projectId = requiredString(raw, 'project_id');
  const limit = parseLimit(optionalString(raw, 'limit')) ?? 50;
  const blocked = parseBoolean(optionalString(raw, 'blocked'), 'blocked');
  const stale = parseBoolean(optionalString(raw, 'stale'), 'stale');
  return resolveLaneFilters(laneId, {
    project_id: projectId,
    limit,
    blocked,
    stale,
    actor_id: optionalString(raw, 'actor_id'),
    owner_actor_id: optionalString(raw, 'owner_actor_id'),
    reviewer_actor_id: optionalString(raw, 'reviewer_actor_id'),
    qa_owner_actor_id: optionalString(raw, 'qa_owner_actor_id'),
    release_owner_actor_id: optionalString(raw, 'release_owner_actor_id'),
    cursor: optionalString(raw, 'cursor'),
    kind: optionalString(raw, 'kind'),
    phase: optionalString(raw, 'phase'),
    status: optionalString(raw, 'status'),
    gate_state: optionalString(raw, 'gate_state'),
    resolution: optionalString(raw, 'resolution'),
    risk: optionalString(raw, 'risk'),
  });
}
```

All `optionalString` calls must reject arrays, duplicates, and empty trimmed values.

- [ ] **Step 3.4: Wire service methods**

In `query.service.ts`:

- import `getProductLane` and `getWorkItemActions` from `@forgeloop/db`;
- parse `laneId` with `productLaneIdSchema`;
- parse query with the strict parser;
- pass `{ cockpit: { run_session_metadata_fallback: this.initialRuntimeMetadata() } }` into `getWorkItemActions`;
- throw `NotFoundException` when Work Item actions query returns `undefined`;
- validate response with `productLaneResponseSchema` or `workItemActionsResponseSchema` before returning.

- [ ] **Step 3.5: Wire controller methods and remove old methods**

In `query.controller.ts`, add:

```ts
@Get('product-lanes/:laneId')
getProductLane(
  @Param('laneId') laneId: string,
  @Query() query: Record<string, string | string[] | undefined>,
) {
  return this.service.getProductLane(laneId, query);
}

@Get('work-items/:workItemId/actions')
getWorkItemActions(
  @Param('workItemId') workItemId: string,
  @Query() query: Record<string, string | string[] | undefined>,
) {
  return this.service.getWorkItemActions(workItemId, query);
}
```

Remove every previous queue controller method in the same edit.

- [ ] **Step 3.6: Run API tests**

Run:

```bash
pnpm vitest run tests/api/product-lanes.test.ts tests/api/query-module.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 3.7: Commit API checkpoint**

Run:

```bash
git add apps/control-plane-api/src/modules/query/product-lane-query-parser.ts apps/control-plane-api/src/modules/query/query.service.ts apps/control-plane-api/src/modules/query/query.controller.ts tests/api/product-lanes.test.ts tests/api/query-module.test.ts
git commit -m "feat: expose product lane query endpoints"
```

Expected: commit succeeds.

## Task 4: Web API, Query Keys, And Cache Surface

**Files:**
- Modify: `apps/web/src/shared/api/types.ts`
- Modify: `apps/web/src/shared/api/query.ts`
- Modify: `apps/web/src/shared/api/query-keys.ts`
- Modify: `apps/web/src/shared/api/hooks.ts`
- Modify: `tests/web/api.test.ts`
- Modify: `tests/web/api-hooks.test.tsx`

- [ ] **Step 4.1: Write failing Web API helper tests**

In `tests/web/api.test.ts`, replace previous queue helper assertions with:

```ts
await queryApi.getProductLane('execution-owner', {
  project_id: 'project 1',
  actor_id: 'actor-owner',
  limit: 25,
  blocked: true,
});

expect(fetchMock).toHaveBeenCalledWith(
  'http://api.local/root/query/product-lanes/execution-owner?project_id=project+1&actor_id=actor-owner&limit=25&blocked=true',
  expect.any(Object),
);
```

Add Work Item actions helper assertion:

```ts
await queryApi.getWorkItemActions('wi/1', { lane: 'bugs' });
expect(fetchMock).toHaveBeenCalledWith(
  'http://api.local/root/query/work-items/wi%2F1/actions?lane=bugs',
  expect.any(Object),
);
```

- [ ] **Step 4.2: Write failing query-key/hook tests**

In `tests/web/api-hooks.test.tsx`, assert:

```ts
expect(queryKeys.productLane('bugs', { project_id: 'proj', blocked: true })).toEqual([
  'product-lanes',
  'bugs',
  { project_id: 'proj', blocked: true },
]);

expect(queryKeys.workItemActions('wi_1', 'bugs')).toEqual(['work-item-actions', 'wi_1', { lane: 'bugs' }]);
```

Add mutation invalidation tests that assert command success/failure invalidates:

- all product lane query variants for the current `project_id`;
- all Work Item actions variants for `work_item_id`;
- Work Item cockpit;
- command object query;
- target object or target lane query when present.

- [ ] **Step 4.3: Run Web API tests and verify they fail**

Run:

```bash
pnpm vitest run tests/web/api.test.ts tests/web/api-hooks.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because new helpers and keys do not exist.

- [ ] **Step 4.4: Update Web shared types**

In `types.ts`, import and re-export the contract DTOs:

```ts
export type {
  ProductAction,
  ProductCommand,
  ProductHref,
  ProductLaneId,
  ProductLaneItem,
  ProductLaneResponse,
  WorkItemActionsResponse,
} from '@forgeloop/contracts';

export interface ProductLaneQuery {
  project_id: string;
  actor_id?: string;
  owner_actor_id?: string;
  reviewer_actor_id?: string;
  qa_owner_actor_id?: string;
  release_owner_actor_id?: string;
  cursor?: string;
  limit?: number;
  kind?: 'initiative' | 'requirement' | 'bug' | 'tech_debt';
  phase?: string;
  status?: string;
  gate_state?: string;
  resolution?: string;
  risk?: string;
  blocked?: boolean;
  stale?: boolean;
}

export interface WorkItemActionsQuery {
  lane?: ProductLaneId;
}
```

- [ ] **Step 4.5: Update Web query API**

In `query.ts`, import `productLaneResponseSchema` and `workItemActionsResponseSchema`, then add:

```ts
getProductLane: async (laneId: ProductLaneId, query: ProductLaneQuery) =>
  productLaneResponseSchema.parse(
    await request<unknown>(`/query/product-lanes/${encodeURIComponent(laneId)}${queryString(query)}`),
  ) as ProductLaneResponse,
getWorkItemActions: async (workItemId: string, query: WorkItemActionsQuery = {}) =>
  workItemActionsResponseSchema.parse(
    await request<unknown>(`/query/work-items/${encodeURIComponent(workItemId)}/actions${queryString(query)}`),
  ) as WorkItemActionsResponse,
```

- [ ] **Step 4.6: Update query keys**

In `query-keys.ts`, add normalized keys:

```ts
export const normalizeProductLaneQuery = (query: ProductLaneQuery): ProductLaneQuery => ({
  project_id: query.project_id,
  ...(query.actor_id === undefined ? {} : { actor_id: query.actor_id }),
  ...(query.owner_actor_id === undefined ? {} : { owner_actor_id: query.owner_actor_id }),
  ...(query.reviewer_actor_id === undefined ? {} : { reviewer_actor_id: query.reviewer_actor_id }),
  ...(query.qa_owner_actor_id === undefined ? {} : { qa_owner_actor_id: query.qa_owner_actor_id }),
  ...(query.release_owner_actor_id === undefined ? {} : { release_owner_actor_id: query.release_owner_actor_id }),
  ...(query.kind === undefined ? {} : { kind: query.kind }),
  ...(query.phase === undefined ? {} : { phase: query.phase }),
  ...(query.status === undefined ? {} : { status: query.status }),
  ...(query.gate_state === undefined ? {} : { gate_state: query.gate_state }),
  ...(query.resolution === undefined ? {} : { resolution: query.resolution }),
  ...(query.risk === undefined ? {} : { risk: query.risk }),
  ...(query.blocked === undefined ? {} : { blocked: query.blocked }),
  ...(query.stale === undefined ? {} : { stale: query.stale }),
  ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
  ...(query.limit === undefined ? {} : { limit: query.limit }),
});
```

Add:

```ts
productLane: (laneId: ProductLaneId, query: ProductLaneQuery) => [
  'product-lanes',
  laneId,
  normalizeProductLaneQuery(query),
],
workItemActions: (workItemId: string, laneId?: ProductLaneId) => [
  'work-item-actions',
  workItemId,
  laneId === undefined ? {} : { lane: laneId },
],
```

- [ ] **Step 4.7: Update hooks**

In `hooks.ts`, add:

```ts
export function useProductLaneQuery(laneId: ProductLaneId, query: ProductLaneQuery) {
  const normalizedQuery = normalizeProductLaneQuery(query);
  return useQuery({
    queryKey: queryKeys.productLane(laneId, normalizedQuery),
    queryFn: () => createQueryApi().getProductLane(laneId, normalizedQuery),
  });
}

export function useWorkItemActionsQuery(workItemId: string | undefined, laneId: ProductLaneId | undefined) {
  return useQuery({
    queryKey: queryKeys.workItemActions(workItemId ?? '', laneId),
    queryFn: () => createQueryApi().getWorkItemActions(requiredId(workItemId, 'workItemId'), laneId === undefined ? {} : { lane: laneId }),
    enabled: workItemId !== undefined,
  });
}
```

Add invalidation helpers:

```ts
export async function invalidateProductActionTargets(
  queryClient: QueryClient,
  input: ProductActionInvalidationInput,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['product-lanes'], predicate: productLaneProjectPredicate(input.projectId) }),
    queryClient.invalidateQueries({ queryKey: ['work-item-actions', input.workItemId] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.workItemCockpit(input.workItemId) }),
    invalidateObjectQuery(queryClient, input.command.object_type, input.command.object_id),
    input.target === undefined ? Promise.resolve() : invalidateTargetQuery(queryClient, input.target),
  ]);
}
```

Then create an explicit ProductAction command mutation hook that switches on the command union and calls only the existing command hooks/API methods.

- [ ] **Step 4.8: Remove old Web API surface**

Remove old imports, type aliases, helpers, and hook exports listed in the Explicit Deletion Checklist from active Web API code and tests.

- [ ] **Step 4.9: Run Web API tests**

Run:

```bash
pnpm vitest run tests/web/api.test.ts tests/web/api-hooks.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 4.10: Commit Web API checkpoint**

Run:

```bash
git add apps/web/src/shared/api/types.ts apps/web/src/shared/api/query.ts apps/web/src/shared/api/query-keys.ts apps/web/src/shared/api/hooks.ts tests/web/api.test.ts tests/web/api-hooks.test.tsx
git commit -m "feat: add product lane web api"
```

Expected: commit succeeds.

## Task 5: Shared ProductAction UI And Command Execution

**Files:**
- Create: `apps/web/src/features/product-actions/product-actions.ts`
- Create: `apps/web/src/features/product-actions/product-action-list.tsx`
- Modify: `apps/web/src/shared/api/hooks.ts`
- Modify: `tests/web/api-hooks.test.tsx`
- Modify: `tests/web/workbench-product-route.test.tsx`
- Modify: `tests/web/work-item-product-route.test.tsx`

- [ ] **Step 5.1: Write failing ProductAction UI tests**

Add tests that render a mixed action list and assert:

- action order is `primary`, then `secondary`, then `tertiary`, preserving backend order within each priority;
- disabled and blocked actions stay visible;
- blocked primary remains the visible primary CTA;
- disabled command click does not call a mutation;
- command success does not navigate even if `target` exists;
- navigate action uses `target.href` directly.

- [ ] **Step 5.2: Run tests and verify they fail**

Run:

```bash
pnpm vitest run tests/web/workbench-product-route.test.tsx tests/web/work-item-product-route.test.tsx tests/web/api-hooks.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because shared ProductAction UI is missing.

- [ ] **Step 5.3: Implement action sorting and view mapping**

In `product-actions.ts`, implement:

```ts
const priorityRank: Record<ProductAction['priority'], number> = {
  primary: 0,
  secondary: 1,
  tertiary: 2,
};

export const sortProductActions = (actions: readonly ProductAction[]) =>
  actions
    .map((action, index) => ({ action, index }))
    .sort((left, right) => priorityRank[left.action.priority] - priorityRank[right.action.priority] || left.index - right.index)
    .map(({ action }) => action);
```

Add `isCommandAction`, `isNavigateAction`, `actionStateLabel`, and `primaryActionForItem` helpers.

- [ ] **Step 5.4: Implement ProductActionList**

In `product-action-list.tsx`, render:

- `<Link>` for navigate actions when enabled;
- disabled button or disabled link-styled control for disabled/blocked navigate actions, still showing `target.href` as non-clicking metadata only if the existing UI pattern supports it;
- `<Button>` for command actions;
- inline pending/error state per command action id;
- `disabled_reason` and `blocked_reason` text when present;
- optional post-success follow-up link only as a separate user action when command target exists.

Do not infer a route from object ids.

- [ ] **Step 5.5: Implement command mapping**

In `hooks.ts`, implement a switch that is exhaustive over `ProductCommand['type']`:

```ts
export async function executeProductCommand(input: { command: ProductCommand; actorId: string }) {
  const { command } = input;
  switch (command.type) {
    case 'generate_spec_draft':
      return createCommandApi().generateSpecDraft(command.spec_id);
    case 'generate_plan_draft':
      return createCommandApi().generatePlanDraft(command.plan_id);
    case 'generate_packages':
      return createCommandApi().generatePackages(command.plan_revision_id);
    case 'mark_package_ready':
      return createCommandApi().markPackageReady(command.package_id, {
        expected_package_version: command.expected_package_version,
      });
    case 'run_package':
      return createCommandApi().runPackage(command.package_id, input.actorId, { workflow_only: false });
  }
}
```

Use the same authenticated Web actor context already used by `useRunPackageMutation`; ProductCommand must not carry a user-editable actor id. If TypeScript requires a default case, use an `assertNever(command)` helper so unsupported commands are compile-time failures.

- [ ] **Step 5.6: Run ProductAction tests**

Run:

```bash
pnpm vitest run tests/web/workbench-product-route.test.tsx tests/web/work-item-product-route.test.tsx tests/web/api-hooks.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS for ProductAction-specific assertions. Route-level tests may still fail until Task 6/7 route components are wired.

- [ ] **Step 5.7: Commit ProductAction UI checkpoint**

Run:

```bash
git add apps/web/src/features/product-actions/product-actions.ts apps/web/src/features/product-actions/product-action-list.tsx apps/web/src/shared/api/hooks.ts tests/web/api-hooks.test.tsx tests/web/workbench-product-route.test.tsx tests/web/work-item-product-route.test.tsx
git commit -m "feat: render product actions"
```

Expected: commit succeeds only if affected tests are green; otherwise combine with Task 6/7 route wiring in one green commit.

## Task 6: Product Lane Workbench Route

**Files:**
- Create: `apps/web/src/features/product-lanes/product-lanes.ts`
- Create: `apps/web/src/features/product-lanes/product-lane-view-model.ts`
- Create: `apps/web/src/features/product-lanes/product-lane-table.tsx`
- Create: `apps/web/src/features/product-lanes/product-lane-workbench.tsx`
- Create: `apps/web/src/app/routes/workbench/$laneId.tsx`
- Modify: `apps/web/src/app/routes/workbench/index.tsx`
- Modify: `apps/web/src/app/routes.ts`
- Modify: `tests/web/workbench-product-route.test.tsx`

- [ ] **Step 6.1: Write failing route tests**

In `tests/web/workbench-product-route.test.tsx`, assert:

```ts
expect(renderedRouterAt('/workbench?project_id=p1&kind=bug&role=old')).toRedirectTo('/workbench/requirements?project_id=p1');
expect(screen.getByRole('link', { name: /bugs/i })).toHaveAttribute('href', '/workbench/bugs?project_id=p1');
```

Add tests for:

- unknown lane unavailable state with link to `/workbench/requirements`;
- all ten lane nav items enabled;
- API request path includes `/query/product-lanes/:laneId`;
- unsupported filter notice renders;
- selected row re-resolves after a refetch returns different items;
- ActionRail clears when no selected item remains;
- mobile layout does not render nested cards for actions.

- [ ] **Step 6.2: Run route tests and verify they fail**

Run:

```bash
pnpm vitest run tests/web/workbench-product-route.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because the route still points at the previous implementation.

- [ ] **Step 6.3: Implement lane metadata**

In `product-lanes.ts`, implement:

```ts
export const defaultProductLaneId: ProductLaneId = 'requirements';

export const productLanes: readonly ProductLaneDefinition[] = [
  { id: 'requirements', label: 'Requirements', description: 'Requirement intake and planning progression.' },
  { id: 'bugs', label: 'Bugs', description: 'Bug triage, repair planning, verification, and regression follow-up.' },
  { id: 'tech-debt', label: 'Tech Debt', description: 'Debt scoping, refactor planning, risk control, and validation.' },
  { id: 'initiatives', label: 'Initiatives', description: 'Strategic work intake and requirement breakdown readiness.' },
  { id: 'spec-approver', label: 'Spec Approver', description: 'Spec and Plan approval attention.' },
  { id: 'execution-owner', label: 'Execution Owner', description: 'Package readiness, runs, and package blockers.' },
  { id: 'reviewer', label: 'Reviewer', description: 'Review packet decisions and evidence gaps.' },
  { id: 'qa-test-owner', label: 'QA / Test Owner', description: 'Test strategy gaps, QA gates, and acceptance.' },
  { id: 'release-owner', label: 'Release Owner', description: 'Release readiness, blockers, and gates.' },
  { id: 'manager', label: 'Manager', description: 'Read-only delivery health and bottleneck drill-down.' },
];
```

Add `parseProductLaneId`, `laneForWorkItemKind`, and `supportedWorkbenchSearchParams`.

- [ ] **Step 6.4: Implement default redirect route**

In `routes/workbench/index.tsx`, read `useSearchParams`, keep supported product-lane query params, strip `kind` when redirecting to the default lane, and return `<Navigate replace to={target} />`.

- [ ] **Step 6.5: Register canonical lane route**

In `routes.ts`, change workbench routing to:

```ts
route('workbench', './routes/workbench/index.tsx'),
route('workbench/:laneId', './routes/workbench/$laneId.tsx'),
```

- [ ] **Step 6.6: Implement Workbench view model and table**

In `product-lane-view-model.ts`, convert response items into rows:

- stable sorted actions via `sortProductActions`;
- first sorted action as table primary;
- row state from `status`, `phase`, `gate_state`, or `resolution`;
- updated age from `updated_at`;
- selected item resolution by `selected` search param, current item id, then first item.

In `product-lane-table.tsx`, render predictable columns and keyboard-selectable rows. Keep buttons and labels sized for compact operational UI.

- [ ] **Step 6.7: Implement ProductLaneWorkbench**

In `product-lane-workbench.tsx`, wire:

- lane parsing from route param;
- project id from search params or project context;
- query params from search params;
- `useProductLaneQuery(laneId, query)`;
- summary metrics;
- lane nav;
- unsupported filter notice;
- table;
- ActionRail using `ProductActionList`.

Unknown lane must not fetch; it renders an unavailable state.

- [ ] **Step 6.8: Remove previous Web workbench directory**

Delete the directory listed in the Explicit Deletion Checklist after new route tests pass locally.

- [ ] **Step 6.9: Run Workbench tests**

Run:

```bash
pnpm vitest run tests/web/workbench-product-route.test.tsx tests/web/api-hooks.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 6.10: Commit Workbench checkpoint**

Run:

```bash
git add apps/web/src/features/product-lanes apps/web/src/features/product-actions apps/web/src/app/routes.ts apps/web/src/app/routes/workbench tests/web/workbench-product-route.test.tsx
git add -u apps/web/src/features
git commit -m "feat: replace workbench with product lanes"
```

Expected: commit succeeds.

## Task 7: Work Item Detail Next Actions

**Files:**
- Create: `apps/web/src/features/work-items/work-item-next-actions.tsx`
- Modify: `apps/web/src/features/work-items/work-item-detail.tsx`
- Modify: `tests/web/work-item-product-route.test.tsx`

- [ ] **Step 7.1: Write failing Work Item next-action tests**

In `tests/web/work-item-product-route.test.tsx`, assert:

- a bug Work Item without `?lane=` calls `/query/work-items/:id/actions?lane=bugs`;
- a valid `?lane=reviewer` calls the actions endpoint with `lane=reviewer`;
- an invalid `?lane=unknown` does not call the actions endpoint and shows a link to the derived default lane URL;
- action list renders command, navigate, blocked, and disabled states;
- placeholder buttons/copy listed in the Explicit Deletion Checklist are absent.

- [ ] **Step 7.2: Run test and verify it fails**

Run:

```bash
pnpm vitest run tests/web/work-item-product-route.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because the action rail still contains placeholders.

- [ ] **Step 7.3: Implement WorkItemNextActions**

In `work-item-next-actions.tsx`, implement:

```tsx
export function WorkItemNextActions({ workItem }: { workItem: WorkItem }) {
  const [searchParams] = useSearchParams();
  const queryLane = searchParams.get('lane');
  const defaultLaneId = laneForWorkItemKind(workItem.kind);
  const parsedLane = queryLane === null ? defaultLaneId : parseProductLaneId(queryLane);

  if (parsedLane === undefined) {
    return (
      <ActionRail title="Next actions">
        <p className="empty">This lane is not available for this Work Item.</p>
        <Link to={`/work-items/${encodeURIComponent(workItem.id)}?lane=${defaultLaneId}`}>Open default lane</Link>
      </ActionRail>
    );
  }

  return <WorkItemNextActionsContent workItemId={workItem.id} laneId={parsedLane} />;
}
```

The content component uses `useWorkItemActionsQuery` and renders `ProductActionList`.

- [ ] **Step 7.4: Replace Work Item Detail action rail**

In `work-item-detail.tsx`, replace the entire current action rail with:

```tsx
actionRail={<WorkItemNextActions workItem={workItem} />}
```

Remove now-unused `Link`/`Button` imports.

- [ ] **Step 7.5: Run Work Item tests**

Run:

```bash
pnpm vitest run tests/web/work-item-product-route.test.tsx tests/web/workbench-product-route.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 7.6: Commit Work Item checkpoint**

Run:

```bash
git add apps/web/src/features/work-items/work-item-next-actions.tsx apps/web/src/features/work-items/work-item-detail.tsx tests/web/work-item-product-route.test.tsx
git commit -m "feat: add work item next actions"
```

Expected: commit succeeds.

## Task 8: Fixtures, E2E Mocks, And No-Legacy Guards

**Files:**
- Modify: `tests/web/fixtures/product-api-mock.ts`
- Modify: `tests/web/fixtures/product-data.ts`
- Modify: `tests/e2e/web-product-routes.e2e.test.ts`
- Modify: `tests/web/no-legacy-web-ui.test.ts`
- Modify: `tests/naming/delivery-naming.test.ts`

- [ ] **Step 8.1: Write failing guard tests**

Expand `tests/web/no-legacy-web-ui.test.ts` with a product workbench cleanup assertion that scans:

- `apps/web`;
- `tests/web`;
- `tests/e2e`.

The assertion should fail on the deletion targets listed in the Explicit Deletion Checklist, except inside the guard test itself.

Add a naming test update that scans active product code and product tests while excluding historical specs/plans and this current migration spec/plan.

- [ ] **Step 8.2: Run guards and verify they fail**

Run:

```bash
pnpm vitest run tests/web/no-legacy-web-ui.test.ts tests/naming/delivery-naming.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL until fixtures/e2e mocks and any active leftovers are migrated.

- [ ] **Step 8.3: Update Web fixtures**

In `product-data.ts`, add fixtures:

- one Work Item type lane item for each Work Item kind;
- one functional lane item for Spec/Plan approval, package execution, review, QA, release, and manager summary;
- action fixtures for navigate, command, disabled, blocked, target lane, and command target follow-up.

In `product-api-mock.ts`, register only:

- `GET /query/product-lanes/:laneId?...`;
- `GET /query/work-items/:workItemId/actions?...`;
- existing object/cockpit/replay routes.

- [ ] **Step 8.4: Update E2E mocks**

In `web-product-routes.e2e.test.ts`, update route visits and network mocks:

- default route should land on `/workbench/requirements`;
- lane route should request `/query/product-lanes/requirements`;
- Work Item Detail should request `/query/work-items/:id/actions?lane=:laneId`;
- no deleted endpoint mock remains.

- [ ] **Step 8.5: Delete remaining active legacy files**

Run:

```bash
pnpm vitest run tests/web/no-legacy-web-ui.test.ts tests/naming/delivery-naming.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS, proving active product code, product tests, fixtures, and e2e mocks are clean.

Delete any remaining active files from the Explicit Deletion Checklist.

- [ ] **Step 8.6: Run fixtures, E2E, and guard tests**

Run:

```bash
pnpm vitest run tests/e2e/web-product-routes.e2e.test.ts tests/web/no-legacy-web-ui.test.ts tests/naming/delivery-naming.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS. Fixture modules are validated through the Web/e2e tests that import them.

- [ ] **Step 8.7: Commit cleanup checkpoint**

Run:

```bash
git add tests/web/fixtures/product-api-mock.ts tests/web/fixtures/product-data.ts tests/e2e/web-product-routes.e2e.test.ts tests/web/no-legacy-web-ui.test.ts tests/naming/delivery-naming.test.ts
git add -u
git commit -m "test: guard product lane migration cleanup"
```

Expected: commit succeeds.

## Task 9: Final Verification

**Files:**
- All files touched by Tasks 1-8

- [ ] **Step 9.1: Run targeted migration suite**

Run:

```bash
pnpm vitest run tests/contracts/product-actions.test.ts tests/api/product-lanes.test.ts tests/api/query-module.test.ts tests/web/api.test.ts tests/web/api-hooks.test.tsx tests/web/workbench-product-route.test.tsx tests/web/work-item-product-route.test.tsx tests/e2e/web-product-routes.e2e.test.ts tests/web/no-legacy-web-ui.test.ts tests/naming/delivery-naming.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 9.2: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 9.3: Run build**

Run:

```bash
pnpm -r build
```

Expected: PASS.

- [ ] **Step 9.4: Run final legacy scan**

Run:

```bash
pnpm vitest run tests/web/no-legacy-web-ui.test.ts tests/naming/delivery-naming.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS, proving no active product code, product tests, fixtures, or e2e mocks retain deleted vocabulary.

- [ ] **Step 9.5: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: only intentional product lane migration files are changed.

- [ ] **Step 9.6: Commit final verification fixes if needed**

If Steps 9.1-9.5 required fixes:

```bash
git add <fixed-files>
git commit -m "fix: complete product lane migration verification"
```

Expected: commit succeeds. If no fixes were needed, no commit is required.

## Execution Notes

- Keep commits green. If removing contract exports breaks Web/API consumers before their replacement exists, combine the dependent tasks into one commit instead of committing a red intermediate.
- Do not add a generic command runner. ProductAction command execution is intentionally a narrow explicit switch.
- Do not invent Web hrefs from partial ids. Backend owns ProductAction target hrefs, and contracts reject malformed hrefs.
- Manager lane is read-only. A manager command action is a backend contract failure.
- Work Item type lanes are not aliases for a single owner role. They are distinct product queues with kind-specific semantics.
- Historical docs may keep historical vocabulary. Active code, product tests, fixtures, e2e mocks, and current non-checklist plan sections must not.
