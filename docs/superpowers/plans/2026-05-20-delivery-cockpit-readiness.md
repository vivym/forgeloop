# Delivery Cockpit Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the typed Work Item Delivery Cockpit with backend-owned readiness, no legacy Workbench/action compatibility, and product-grade responsive delivery UI.

**Architecture:** Move the contract boundary first: Product Lane action targets become `/lanes/:laneId`, Work Item cockpit responses gain shared `delivery_readiness`, and the old Work Item actions query is removed. Then implement strict backend readiness helpers for package/run/review selection, Integration Readiness, Quality Gate, and pre-release Release Readiness. Finally replace the Work Item detail page with presentational cockpit components and browser-level viewport tests.

**Tech Stack:** TypeScript, Zod, `@forgeloop/contracts`, `@forgeloop/domain`, `@forgeloop/db`, NestJS query module, React 19, React Router, TanStack Query, Vitest, Testing Library, Playwright.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-05-20-delivery-cockpit-execution-review-qa-design.md`
- PRD: `docs/PRD_v1.md`
- Current Work Item cockpit query: `packages/db/src/queries/work-item-cockpit-queries.ts`
- Current separate Work Item actions query: `packages/db/src/queries/work-item-action-queries.ts`
- Current ProductAction contract: `packages/contracts/src/api.ts`
- Current Work Item page: `apps/web/src/features/work-items/work-item-detail.tsx`
- Current Work Item action component: `apps/web/src/features/work-items/work-item-next-actions.tsx`
- Current visual browser smoke: `tests/e2e/web-product-routes.e2e.test.ts`

## Scope Check

This is one integrated product slice. It touches contracts, domain helpers, DB read models, API query surfaces, and Web UI, but those pieces form one delivery contract: `/work-items/:workItemId` cannot become the canonical cockpit unless the response schema, action source, route migration, readiness rules, and layout ship together.

This plan intentionally excludes Observation, Retrospective, Evolution Loop, full Test Center asset management, unrelated page redesigns, compatibility aliases, old Workbench routes, and any priority-code subsystem naming.

## File Structure And Ownership

### Contracts

- Modify `packages/contracts/src/api.ts`
  - Replace Product Lane target href validation from `/workbench/:laneId` to `/lanes/:laneId`.
  - Remove `/workbench` from `productHrefPrefixes`.
  - Keep object target routes unchanged.
- Create `packages/contracts/src/work-item-delivery-readiness.ts`
  - Own `deliveryStageIdSchema`, `deliveryStageStateSchema`, `deliveryOverallStateSchema`, `deliveryObjectRefSchema`, `deliveryEvidenceSchema`, `deliveryBlockerSchema`, `workItemDeliveryReadinessSchema`, `workItemCockpitResponseSchema`.
  - Export inferred types for DB and Web.
- Modify `packages/contracts/src/review.ts`
  - Add independent AI Review evidence to the shared Review Packet contract.
  - Add selected-run test mapping evidence to the shared Review Packet contract.
  - If no full Review Packet Zod schema exists yet, create and export `reviewPacketSchema` in this module so API/cockpit schemas can parse and preserve `independent_ai_review` and `test_mapping`.
- Modify `packages/contracts/src/index.ts`
  - Export the new readiness module.
- Tests:
  - Modify `tests/contracts/product-actions.test.ts`.
  - Create `tests/contracts/work-item-delivery-readiness.test.ts`.
  - Create `tests/contracts/review-packet.test.ts`.

### Domain

- Create `packages/domain/src/work-item-delivery-readiness.ts`
  - Own pure helpers that are independent of repositories:
    - `isStrictApprovedSpecPlan`
    - `normalizeRequiredTestGate`
    - `normalizeIntegrationReadiness`
    - `hasCompleteReviewEvidence`
    - `deriveInitiativeAggregationState`
    - `deriveRequiredArtifactPresence` wrapper usage notes only where needed
  - No repository calls and no React types.
- Modify `packages/domain/src/types.ts`
  - Add or expose the Review Packet independent AI Review evidence field if needed.
  - Prefer a focused optional field such as `independent_ai_review?: IndependentAiReviewResult` over overloading `self_review`.
  - Add or expose `test_mapping?: ReviewPacketTestMapping[]` on `ReviewPacket`; Review/Quality Gate helpers must block when it is missing or empty.
- Modify `packages/domain/src/index.ts`
  - Export the new helpers.
- Tests:
  - Create `tests/domain/work-item-delivery-readiness.test.ts`.

### DB Read Models

- Modify `packages/db/src/schema/review-packet.ts`
  - Add `independentAiReview` JSONB column typed as `ReviewPacket['independent_ai_review']`.
  - Add `testMapping` JSONB column typed as `ReviewPacket['test_mapping']`.
  - Preserve optional field semantics for existing rows.
- Modify `packages/db/src/repositories/drizzle-delivery-repository.ts`
  - Ensure `saveReviewPacket`, `getReviewPacket`, and list methods round-trip `independent_ai_review` and `test_mapping` through `toDbRecord`/`fromDbRecord`.
- Modify `tests/db/schema.test.ts`
  - Assert the Review Packet independent AI review and test mapping columns are JSONB.
- Modify `tests/db/repository.test.ts`
  - Assert the Drizzle row mapper preserves `independent_ai_review` and `test_mapping`.
- Modify `tests/db/repository-contract.ts`
  - Add `independent_ai_review` and `test_mapping` to the canonical Review Packet contract fixture.
- Create `packages/db/src/queries/work-item-delivery-selection.ts`
  - Select current approved-plan packages.
  - Select Work Item authoritative run: `current_run_session_id`, then `last_run_session_id`, then latest `created_at`.
  - Select Work Item authoritative Review Packet: `current_review_packet_id`, then selected-run review, then latest package review.
- Create `packages/db/src/queries/work-item-release-readiness.ts`
  - Compute strict pre-release Release Readiness for a Work Item.
  - Use strict current-approved Spec/Plan revision checks.
  - Compute a dedicated pre-release blocker fingerprint/scope.
  - Exclude Observation, close-readiness, and post-release blockers.
  - Do not call `deriveReleaseTestAcceptanceGate` directly.
- Create `packages/db/src/queries/work-item-delivery-readiness.ts`
  - Aggregate Work Item readiness stages, blockers, evidence, degraded sources, and lane-aware actions.
  - Own the only public action source for Work Item detail: `delivery_readiness.next_actions`.
- Modify `packages/db/src/queries/work-item-cockpit-queries.ts`
  - Attach `delivery_readiness`.
  - Accept active lane.
  - Remove public `next_actions: string[]`.
  - Stop using `deriveWorkItemCompletion` as readiness source.
- Modify `packages/db/src/queries/work-item-action-queries.ts`
  - Delete the public query path or reduce to private action helper functions imported by `work-item-delivery-readiness.ts`.
  - Do not export `getWorkItemActions` as a public DB query.
- Modify `packages/db/src/index.ts`
  - Remove the public export for `./queries/work-item-action-queries`.
  - Export the new delivery readiness/selection/release readiness query modules needed by API code.
- Tests:
  - Modify `tests/db/schema.test.ts`.
  - Modify `tests/db/repository.test.ts`.
  - Modify `tests/db/repository-contract.ts`.
  - Create `tests/db/work-item-delivery-selection.test.ts`.
  - Create `tests/db/work-item-release-readiness.test.ts`.
  - Create `tests/db/work-item-delivery-readiness.test.ts`.
  - Modify `tests/api/query-module.test.ts`.
  - Modify `tests/api/product-lanes.test.ts`.

### API Query Surface

- Modify `apps/control-plane-api/src/modules/query/query.controller.ts`
  - Add lane query validation to `getWorkItemCockpit`.
  - Remove `GET /query/work-items/:workItemId/actions`.
- Modify `apps/control-plane-api/src/modules/query/query.service.ts`
  - Pass active lane into `getWorkItemCockpit`.
  - Remove public `getWorkItemActions` service method or make it unreachable.
- Modify `apps/control-plane-api/src/modules/query/product-lane-query-parser.ts`
  - Remove `parseWorkItemActionsQuery`; the endpoint it served is gone.
- Tests:
  - Modify `tests/api/query-module.test.ts`.
  - Modify `tests/api/delivery-flow.test.ts`.
  - Modify `tests/api/product-lanes.test.ts`.

### Web API And Routing

- Modify `apps/web/src/shared/api/types.ts`
  - Export the new readiness/cockpit types from contracts instead of local loose `CockpitResponse`.
  - Add `current_run_session_id`, `current_review_packet_id`, `integration_readiness`, and `required_test_gates` to Web package types if still used by fixtures.
- Modify `apps/web/src/shared/api/query.ts`
  - Parse Work Item cockpit responses with `workItemCockpitResponseSchema`.
  - Add optional active-lane query support to `getWorkItemCockpit`.
  - Remove `getWorkItemActions` and the `workItemActionsResponseSchema` import.
- Modify `apps/web/src/shared/api/hooks.ts`
  - Make `useWorkItemCockpitQuery(workItemId, laneId)` request `/query/work-item-cockpit/:id?lane=...`.
  - Use lane-aware cache keys for Work Item cockpit queries; different active lanes must never share cached readiness/actions.
  - When command mutations update a Work Item cockpit without knowing the active lane, update or invalidate every cached lane variant for that Work Item.
  - Remove `useWorkItemActionsQuery`.
  - Stop invalidating `['work-item-actions', id]`.
- Modify `apps/web/src/shared/api/query-keys.ts`
  - Change `workItemCockpit` from an id-only key to an id-plus-lane key factory.
- Modify `apps/web/src/app/routes.ts`
  - Replace `workbench` routes with `lanes` routes.
  - Remove old Workbench route aliases and redirects.
- Modify `tests/web/router-test-utils.tsx`
  - Replace Workbench route imports and route entries with Lanes imports and route entries.
- Move or replace route files:
  - Rename `apps/web/src/app/routes/workbench/index.tsx` to `apps/web/src/app/routes/lanes/index.tsx`.
  - Rename `apps/web/src/app/routes/workbench/$laneId.tsx` to `apps/web/src/app/routes/lanes/$laneId.tsx`.
- Modify `apps/web/src/app/routes/_layout.tsx`
  - Rename visible nav label from `Workbench` to `Lanes`.
  - Link to `/lanes`.
- Modify `apps/web/src/features/product-lanes/product-lane-workbench.tsx`
  - Rename component/file to `product-lane-route.tsx`.
  - Replace all `/workbench` hrefs with `/lanes`.
- Tests:
  - Modify `tests/web/api-hooks.test.tsx`.
  - Modify `tests/web/app-shell-routing.test.tsx`.
  - Replace `tests/web/workbench-product-route.test.tsx` with `tests/web/product-lanes-route.test.tsx`.
  - Modify `tests/e2e/web-product-routes.e2e.test.ts`.

### Web Cockpit UI

- Modify `apps/web/src/features/work-items/work-item-view-model.ts`
  - Convert `WorkItemDeliveryReadiness` into display models only.
  - Do not derive business readiness in React.
- Replace `apps/web/src/features/work-items/work-item-next-actions.tsx`
  - Make it a pure `DeliveryActionRail` component receiving actions from `delivery_readiness.next_actions`.
  - No internal query.
- Create `apps/web/src/features/work-items/delivery-cockpit/stage-rail.tsx`
- Create `apps/web/src/features/work-items/delivery-cockpit/action-summary.tsx`
- Create `apps/web/src/features/work-items/delivery-cockpit/action-rail.tsx`
- Create `apps/web/src/features/work-items/delivery-cockpit/typed-brief.tsx`
- Create `apps/web/src/features/work-items/delivery-cockpit/initiative-breakdown.tsx`
- Create `apps/web/src/features/work-items/delivery-cockpit/package-matrix.tsx`
- Create `apps/web/src/features/work-items/delivery-cockpit/execution-summary.tsx`
- Create `apps/web/src/features/work-items/delivery-cockpit/review-summary.tsx`
- Create `apps/web/src/features/work-items/delivery-cockpit/integration-readiness-panel.tsx`
- Create `apps/web/src/features/work-items/delivery-cockpit/quality-gate-panel.tsx`
- Create `apps/web/src/features/work-items/delivery-cockpit/release-readiness-panel.tsx`
- Create `apps/web/src/features/work-items/delivery-cockpit/evidence-timeline.tsx`
- Create `apps/web/src/features/work-items/delivery-cockpit/index.ts`
- Modify `apps/web/src/features/work-items/work-item-detail.tsx`
  - Compose the cockpit.
  - Keep object route links to package/run/review/release details.
  - Add mobile/tablet Action Summary before the Stage Rail.
  - Make stage targets focusable and hash-addressable.
- Modify `apps/web/src/features/spec-plan/spec-plan-work-item-flow.tsx`
  - Keep using the Work Item cockpit query for planning flow data, but parse the strict shared cockpit response and request a deterministic planning/default lane when needed.
- Modify `tests/web/fixtures/product-api-mock.ts`
  - Update every mocked `GET /query/work-item-cockpit/*` response to include `delivery_readiness` and remove top-level `next_actions`.
- Modify `tests/web/spec-plan-product-route.test.tsx`
  - Update inline Work Item cockpit fixtures to the strict shared response shape.
- Tests:
  - Modify `tests/web/work-item-product-route.test.tsx`.
  - Modify `tests/web/spec-plan-product-route.test.tsx`.
  - Create `tests/web/work-item-delivery-cockpit.test.tsx`.

### Linked Delivery Page Visual Baseline

- Modify `apps/web/src/app/routes/packages/$packageId.tsx`
- Modify `apps/web/src/app/routes/runs/$runSessionId.tsx`
- Modify `apps/web/src/app/routes/reviews/$reviewPacketId.tsx`
- Modify `apps/web/src/app/routes/releases/$releaseId.tsx`
  - Apply the visual clarity baseline from the spec.
  - No Workbench labels or links.
  - No card-in-card, decorative layout, or color-only status.
- Tests:
  - Modify `tests/web/package-run-product-routes.test.tsx`.
  - Modify `tests/web/review-release-product-routes.test.tsx`.
  - Modify `tests/e2e/web-product-routes.e2e.test.ts`.

## Implementation Rules

- Use @superpowers:test-driven-development for each task: write a failing test, run it to fail, implement minimum code, run it to pass.
- Use @superpowers:verification-before-completion before every commit.
- Keep commits task-scoped. Do not stage unrelated files.
- Do not preserve `/workbench` aliases, redirects, or compatibility shims.
- Do not keep `/query/work-items/:id/actions`.
- Do not add route families such as `/requirements/:id` or `/bugs/:id`.
- Do not put readiness derivation in React components.
- Do not use `deriveWorkItemCompletion`, `selectReleaseReviewPacket`, or `deriveReleaseTestAcceptanceGate` as Work Item readiness sources.
- Use object route actions unless a Product Lane target uses `/lanes/:laneId`.

---

### Task 1: Migrate Product Lane Target Contract From Workbench To Lanes

**Files:**
- Modify: `packages/contracts/src/api.ts`
- Modify: `packages/db/src/queries/product-action-builders.ts`
- Modify: `packages/db/src/queries/product-lane-queries.ts`
- Test: `tests/contracts/product-actions.test.ts`
- Test: `tests/api/product-lanes.test.ts`

- [ ] **Step 1: Write failing contract tests for `/lanes` targets**

In `tests/contracts/product-actions.test.ts`, change `validLaneTarget` and add explicit rejection coverage:

```ts
const validLaneTarget = {
  kind: 'lane',
  lane_id: 'bugs',
  href: '/lanes/bugs?project_id=p1',
} as const;

it('rejects legacy Workbench lane targets', () => {
  expect(
    productActionSchema.safeParse({
      ...validNavigateAction,
      target: { kind: 'lane', lane_id: 'bugs', href: '/workbench/bugs?project_id=p1' },
    }).success,
  ).toBe(false);
});
```

Also update route prefix rejection in the href test so `/workbench/bugs` is invalid and `/lanes/bugs` is valid.

- [ ] **Step 2: Run contract tests and verify failure**

Run: `pnpm vitest run tests/contracts/product-actions.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because `productActionLaneTargetSchema` currently requires `/workbench/:laneId`.

- [ ] **Step 3: Implement the contract migration**

In `packages/contracts/src/api.ts`:

```ts
const productHrefPrefixes = [
  '/lanes',
  '/work-items',
  '/specs',
  '/plans',
  '/packages',
  '/runs',
  '/reviews',
  '/releases',
  '/pipeline',
] as const;
```

Update lane target validation:

```ts
if (pathname === undefined || pathname !== `/lanes/${target.lane_id}`) {
  ctx.addIssue({
    code: 'custom',
    path: ['href'],
    message: 'lane target href must match lane_id',
  });
}
```

In `packages/db/src/queries/product-action-builders.ts`, change:

```ts
export const laneTarget = (laneId: ProductLaneId, href = `/lanes/${laneId}`): ProductActionTarget => ({
  kind: 'lane',
  lane_id: laneId,
  href,
});
```

- [ ] **Step 4: Run contract tests and verify pass**

Run: `pnpm vitest run tests/contracts/product-actions.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 5: Update Product Lane API tests for no Workbench route assumptions**

In `tests/api/product-lanes.test.ts`, rename the test text from `removes old workbench routes` to `serves Product Lane endpoints without Workbench action targets`. Add:

```ts
expect(JSON.stringify(laneResponse.body)).not.toContain('/workbench');
expect(JSON.stringify(actionsResponse.body)).not.toContain('/workbench');
```

Keep the old backend endpoint assertion:

```ts
const removedEndpoint = `/query/${'work'}${'benches'}/spec-approver?project_id=${project.id}`;
await request(app.getHttpServer()).get(removedEndpoint).expect(404);
```

- [ ] **Step 6: Run Product Lane API tests**

Run: `pnpm vitest run tests/api/product-lanes.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/api.ts packages/db/src/queries/product-action-builders.ts tests/contracts/product-actions.test.ts tests/api/product-lanes.test.ts
git commit -m "feat: migrate product lane action targets"
```

---

### Task 2: Add Shared Work Item Delivery Readiness Contracts

**Files:**
- Create: `packages/contracts/src/work-item-delivery-readiness.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/web-product-query.ts`
- Modify: `apps/web/src/shared/api/types.ts`
- Test: `tests/contracts/work-item-delivery-readiness.test.ts`

- [ ] **Step 1: Write failing contract tests for readiness schemas**

Create `tests/contracts/work-item-delivery-readiness.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  deliveryStageIdSchema,
  deliveryStageStateSchema,
  productListItemSchema,
  workItemCockpitResponseSchema,
  workItemDeliveryReadinessSchema,
} from '@forgeloop/contracts';

const action = {
  id: 'open-package',
  lane_id: 'execution-owner',
  priority: 'primary',
  label: 'Open Package',
  enabled: true,
  kind: 'navigate',
  target: { kind: 'object', object_type: 'execution_package', object_id: 'pkg-1', href: '/packages/pkg-1' },
} as const;

const stage = {
  id: 'execution',
  label: 'Execution',
  state: 'passed',
  owner_lane: 'execution-owner',
  object_refs: [{ object_type: 'execution_package', object_id: 'pkg-1', href: '/packages/pkg-1' }],
  blockers: [],
  evidence_refs: [],
  primary_action: action,
} as const;

const readiness = {
  work_item_id: 'wi-1',
  work_item_kind: 'requirement',
  active_lane: 'execution-owner',
  overall_state: 'ready_for_release',
  stages: [stage],
  blockers: [],
  evidence: [],
  next_actions: [action],
  degraded_sources: [],
} as const;

describe('Work Item delivery readiness contracts', () => {
  it('parses all stage ids and states', () => {
    expect(deliveryStageIdSchema.options).toEqual([
      'spec',
      'plan',
      'packages',
      'execution',
      'review',
      'integration_readiness',
      'quality_gate',
      'release_readiness',
    ]);
    expect(deliveryStageStateSchema.options).toContain('not_applicable');
  });

  it('parses readiness and full cockpit responses', () => {
    expect(workItemDeliveryReadinessSchema.parse(readiness)).toEqual(readiness);
    expect(
      workItemCockpitResponseSchema.parse({
        work_item: { id: 'wi-1', project_id: 'project-1', kind: 'requirement', title: 'Title', goal: 'Goal', success_criteria: ['Done'], priority: 'high', risk: 'medium', owner_actor_id: 'actor-1', phase: 'execution', activity_state: 'idle', gate_state: 'none', resolution: 'none' },
        current_spec: null,
        current_plan: null,
        packages: [],
        run_sessions: [],
        review_packets: [],
        delivery_readiness: readiness,
      }),
    ).toMatchObject({ delivery_readiness: readiness });
  });

  it('rejects the old public next_actions array on cockpit responses', () => {
    const result = workItemCockpitResponseSchema.safeParse({
      work_item: { id: 'wi-1', project_id: 'project-1', kind: 'requirement', title: 'Title', goal: 'Goal', success_criteria: ['Done'], priority: 'high', risk: 'medium', owner_actor_id: 'actor-1', phase: 'execution', activity_state: 'idle', gate_state: 'none', resolution: 'none' },
      current_spec: null,
      current_plan: null,
      packages: [],
      run_sessions: [],
      review_packets: [],
      next_actions: ['run_ready_packages'],
      delivery_readiness: readiness,
    });
    expect(result.success).toBe(false);
  });

  it('accepts only known degraded source keys', () => {
    expect(workItemDeliveryReadinessSchema.parse({ ...readiness, degraded_sources: ['run_sessions'] }).degraded_sources).toEqual(['run_sessions']);
    expect(workItemDeliveryReadinessSchema.safeParse({ ...readiness, degraded_sources: ['unknown_source'] }).success).toBe(false);
  });

  it('parses product package list state needed by delivery cockpit fixtures', () => {
    expect(
      productListItemSchema.parse({
        id: 'pkg-1',
        object: { type: 'execution_package', id: 'pkg-1', title: 'Package 1' },
        title: 'Package 1',
        package_state: {
          work_item_id: 'wi-1',
          spec_revision_id: 'spec-r1',
          plan_revision_id: 'plan-r1',
          current_run_session_id: 'run-1',
          current_review_packet_id: 'review-1',
          integration_readiness: { status: 'ready' },
          required_test_gates: [{ gate_id: 'regression' }],
        },
        counts: {},
        updated_at: '2026-05-20T00:00:00.000Z',
      }),
    ).toMatchObject({ package_state: { current_run_session_id: 'run-1', current_review_packet_id: 'review-1' } });
  });
});
```

- [ ] **Step 2: Run contract tests and verify failure**

Run: `pnpm vitest run tests/contracts/work-item-delivery-readiness.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because the new schemas do not exist.

- [ ] **Step 3: Add readiness schemas**

Create `packages/contracts/src/work-item-delivery-readiness.ts` with strict Zod objects:

```ts
import { z } from 'zod';
import { productActionSchema, productLaneIdSchema } from './api.js';
import { artifactKindSchema, checkResultSchema, jsonObjectSchema } from './executor.js';
import { reviewPacketStatusSchema, reviewDecisionSchema } from './review.js';

const isoDateTimeSchema = z.string().datetime();
const nonEmpty = z.string().trim().min(1);

export const workItemKindSchema = z.enum(['initiative', 'requirement', 'bug', 'tech_debt']);
export const deliveryOverallStateSchema = z.enum(['not_started', 'blocked', 'in_progress', 'ready_for_release', 'released']);
export const deliveryStageIdSchema = z.enum([
  'spec',
  'plan',
  'packages',
  'execution',
  'review',
  'integration_readiness',
  'quality_gate',
  'release_readiness',
]);
export const deliveryStageStateSchema = z.enum(['missing', 'blocked', 'ready', 'running', 'passed', 'failed', 'not_applicable']);
export const degradedSourceKeySchema = z.enum([
  'work_item',
  'spec',
  'spec_revision',
  'plan',
  'plan_revision',
  'execution_packages',
  'package_dependencies',
  'run_sessions',
  'review_packets',
  'integration_readiness',
  'release_scope',
  'release_blockers',
  'release_test_acceptance',
  'decisions',
]);
```

Add object/evidence/blocker/stage/readiness schemas with `.strict()` and exported types. Reuse `productActionSchema` for `next_actions` and `primary_action`.

Define `workItemCockpitResponseSchema` with only:

- `work_item`
- `current_spec`
- `current_plan`
- `packages`
- `run_sessions`
- `review_packets`
- `delivery_readiness`

Use schemas that match the current serialized object shapes enough to parse existing responses, but keep the top-level object strict so `next_actions` is rejected.

- [ ] **Step 4: Update Product List package state contract**

In `packages/contracts/src/web-product-query.ts`, extend `productListItemSchema.package_state` with the delivery fields already emitted or needed by Product Lane and Web fixtures:

```ts
current_run_session_id: z.string().min(1).optional(),
current_review_packet_id: z.string().min(1).optional(),
integration_readiness: z.record(z.string(), z.unknown()).optional(),
required_test_gates: z.array(z.record(z.string(), z.unknown())).default([]),
```

Do not add Workbench or owner aliases.

- [ ] **Step 5: Export schemas**

In `packages/contracts/src/index.ts`:

```ts
export * from './work-item-delivery-readiness.js';
```

- [ ] **Step 6: Update Web shared API types**

In `apps/web/src/shared/api/types.ts`, export:

```ts
export type {
  WorkItemDeliveryReadiness,
  DeliveryStage,
  DeliveryStageId,
  DeliveryStageState,
  DeliveryBlocker,
  DeliveryEvidence,
  WorkItemCockpitResponse as CockpitResponse,
} from '@forgeloop/contracts';
```

Keep local raw object interfaces only if they are not yet exported from contracts; do not maintain a separate loose `CockpitResponse`.

- [ ] **Step 7: Run tests and builds**

Run:

```bash
pnpm vitest run tests/contracts/work-item-delivery-readiness.test.ts tests/contracts/product-actions.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/contracts build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src/work-item-delivery-readiness.ts packages/contracts/src/web-product-query.ts packages/contracts/src/index.ts apps/web/src/shared/api/types.ts tests/contracts/work-item-delivery-readiness.test.ts
git commit -m "feat: add work item delivery readiness contracts"
```

---

### Task 3: Add Domain Normalizers For Review, Test Gates, And Integration

**Files:**
- Create: `packages/domain/src/work-item-delivery-readiness.ts`
- Modify: `packages/domain/src/types.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/contracts/src/review.ts`
- Modify: `packages/db/src/schema/review-packet.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Test: `tests/db/schema.test.ts`
- Test: `tests/db/repository.test.ts`
- Test: `tests/db/repository-contract.ts`
- Test: `tests/domain/work-item-delivery-readiness.test.ts`
- Test: `tests/contracts/work-item-delivery-readiness.test.ts`
- Test: `tests/contracts/review-packet.test.ts`

- [ ] **Step 1: Write failing domain and Review Packet contract tests**

Create `tests/domain/work-item-delivery-readiness.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  deriveInitiativeAggregationState,
  hasCompleteReviewEvidence,
  normalizeIntegrationReadiness,
  normalizeRequiredTestGate,
} from '@forgeloop/domain';

describe('Work Item delivery readiness domain helpers', () => {
  it('requires selected-run review evidence mapped to approved revisions', () => {
    expect(
      hasCompleteReviewEvidence(
        {
          status: 'completed',
          decision: 'approved',
          execution_package_id: 'pkg-1',
          run_session_id: 'run-1',
          spec_revision_id: 'spec-r1',
          plan_revision_id: 'plan-r1',
          test_mapping: [{ gate_id: 'regression', result: 'passed' }],
          risk_notes: [],
          self_review: { status: 'succeeded', summary: 'ok', spec_plan_alignment: 'ok', test_assessment: 'ok', risk_notes: [], follow_up_questions: [] },
          independent_ai_review: { status: 'approved', run_session_id: 'run-1', execution_package_id: 'pkg-1', summary: 'independent review ok' },
        },
        { selectedRunId: 'run-1', packageId: 'pkg-1', approvedSpecRevisionId: 'spec-r1', approvedPlanRevisionId: 'plan-r1' },
      ),
    ).toEqual({ complete: true, blockers: [] });

    expect(
      hasCompleteReviewEvidence(
        {
          status: 'completed',
          decision: 'approved',
          execution_package_id: 'pkg-1',
          run_session_id: 'stale-run',
          spec_revision_id: 'spec-r1',
          plan_revision_id: 'plan-r1',
          self_review: { status: 'succeeded', summary: 'ok', spec_plan_alignment: 'ok', test_assessment: 'ok', risk_notes: [], follow_up_questions: [] },
        },
        { selectedRunId: 'run-1', packageId: 'pkg-1', approvedSpecRevisionId: 'spec-r1', approvedPlanRevisionId: 'plan-r1' },
      ),
    ).toMatchObject({
      complete: false,
      blockers: expect.arrayContaining(['stale_review_run', 'missing_independent_ai_review', 'missing_review_test_mapping', 'missing_review_risk_notes']),
    });
  });

  it('normalizes required test gates only with matching evidence', () => {
    expect(
      normalizeRequiredTestGate(
        { gate_id: 'regression' },
        {
          runChecks: [{ check_id: 'regression', status: 'succeeded' }],
          reviewTestMappings: [],
          releaseTestAcceptance: [],
        },
      ),
    ).toEqual({
      gate_id: 'regression',
      state: 'passed',
      blocker: undefined,
    });

    expect(
      normalizeRequiredTestGate(
        { gate_id: 'regression', status: 'passed' },
        { runChecks: [], reviewTestMappings: [], releaseTestAcceptance: [] },
      ),
    ).toMatchObject({ state: 'blocked', blocker: 'missing_required_test_gate_evidence' });

    expect(normalizeRequiredTestGate({ status: 'passed' }, { runChecks: [], reviewTestMappings: [], releaseTestAcceptance: [] })).toMatchObject({
      state: 'blocked',
      blocker: 'unknown_required_test_gate',
    });

    expect(
      normalizeRequiredTestGate(
        { gate_id: 'manual-qa' },
        { runChecks: [], reviewTestMappings: [], releaseTestAcceptance: [{ gate_id: 'manual-qa', state: 'not_required', rationale: 'covered by upstream certification' }] },
      ),
    ).toMatchObject({ state: 'passed' });
  });

  it('does not pass integration readiness from top-level status alone', () => {
    expect(normalizeIntegrationReadiness({ status: 'ready' })).toMatchObject({
      state: 'blocked',
      blockers: expect.arrayContaining(['missing_contract_readiness']),
    });
  });

  it('passes integration readiness with full dimension evidence', () => {
    expect(
      normalizeIntegrationReadiness({
        status: 'ready',
        contract: { status: 'frozen' },
        mock_fixture: { status: 'ready' },
        environment: { status: 'ready' },
        dependencies: { status: 'ready' },
        cross_end_validation: { status: 'validated' },
        blockers: [],
      }),
    ).toMatchObject({ state: 'passed', blockers: [] });
  });

  it('normalizes running, failed, and unknown Integration Readiness records', () => {
    expect(
      normalizeIntegrationReadiness({
        status: 'validating',
        contract: { status: 'frozen' },
        mock_fixture: { status: 'ready' },
        environment: { status: 'ready' },
        dependencies: { status: 'ready' },
        cross_end_validation: { status: 'validating' },
        blockers: [],
      }),
    ).toMatchObject({ state: 'running', blockers: [] });

    expect(
      normalizeIntegrationReadiness({
        status: 'failed',
        contract: { status: 'failed' },
        mock_fixture: { status: 'ready' },
        environment: { status: 'ready' },
        dependencies: { status: 'ready' },
        cross_end_validation: { status: 'validated' },
        blockers: [],
      }),
    ).toMatchObject({ state: 'failed', blockers: expect.arrayContaining(['failed_contract_readiness']) });

    expect(
      normalizeIntegrationReadiness({
        status: 'mystery',
        contract: { status: 'frozen' },
        mock_fixture: { status: 'ready' },
        environment: { status: 'ready' },
        dependencies: { status: 'ready' },
        cross_end_validation: { status: 'validated' },
        blockers: [],
      }),
    ).toMatchObject({ state: 'blocked', blockers: expect.arrayContaining(['unknown_integration_readiness_status']) });
  });

  it('marks Initiative child aggregation unavailable when no child readiness evidence exists', () => {
    expect(deriveInitiativeAggregationState({ kind: 'initiative', currentPackages: [], childReadiness: undefined })).toEqual({
      mode: 'unavailable',
      label: 'Child-work aggregation unavailable',
    });
  });
});
```

Create `tests/contracts/review-packet.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { reviewPacketSchema } from '@forgeloop/contracts';

describe('Review Packet contract', () => {
  it('preserves independent AI review evidence', () => {
    const parsed = reviewPacketSchema.parse({
      id: 'review-1',
      run_session_id: 'run-1',
      execution_package_id: 'pkg-1',
      reviewer_actor_id: 'reviewer-1',
      spec_revision_id: 'spec-r1',
      plan_revision_id: 'plan-r1',
      status: 'completed',
      decision: 'approved',
      changed_files: [],
      check_result_summary: 'All checks passed',
      self_review: { status: 'succeeded', summary: 'ok', spec_plan_alignment: 'ok', test_assessment: 'ok', risk_notes: [], follow_up_questions: [] },
      independent_ai_review: { status: 'approved', run_session_id: 'run-1', execution_package_id: 'pkg-1', summary: 'independent ok', risk_notes: [] },
      test_mapping: [{ gate_id: 'regression', result: 'passed', evidence_ref: 'run-check:regression' }],
      risk_notes: [],
      requested_changes: [],
      created_at: '2026-05-20T00:00:00.000Z',
      updated_at: '2026-05-20T00:00:00.000Z',
    });

    expect(parsed.independent_ai_review).toMatchObject({
      status: 'approved',
      run_session_id: 'run-1',
      execution_package_id: 'pkg-1',
    });
    expect(parsed.test_mapping).toEqual([
      expect.objectContaining({ gate_id: 'regression', result: 'passed' }),
    ]);
  });
});
```

- [ ] **Step 2: Run domain test and verify failure**

Run: `pnpm vitest run tests/domain/work-item-delivery-readiness.test.ts tests/contracts/review-packet.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because helpers and `reviewPacketSchema.independent_ai_review` / `reviewPacketSchema.test_mapping` support do not exist.

- [ ] **Step 3: Add independent AI review contract**

In `packages/contracts/src/review.ts`, add:

```ts
export const reviewPacketTestMappingSchema = z
  .object({
    gate_id: z.string().min(1),
    result: z.enum(['passed', 'failed', 'not_required']),
    evidence_ref: z.string().min(1).optional(),
    rationale: z.string().min(1).optional(),
  })
  .strict();
export type ReviewPacketTestMapping = z.infer<typeof reviewPacketTestMappingSchema>;

export const independentAiReviewResultSchema = z
  .object({
    status: z.enum(['approved', 'changes_requested', 'failed']),
    summary: z.string().min(1),
    run_session_id: z.string().min(1).optional(),
    execution_package_id: z.string().min(1).optional(),
    risk_notes: z.array(z.string().min(1)).default([]),
    failure_message: z.string().min(1).optional(),
  })
  .strict();
export type IndependentAiReviewResult = z.infer<typeof independentAiReviewResultSchema>;
```

In `packages/domain/src/types.ts`, add it to `ReviewPacket`:

```ts
independent_ai_review?: IndependentAiReviewResult;
test_mapping?: ReviewPacketTestMapping[];
```

In the shared Review Packet schema in `packages/contracts/src/review.ts`, add:

```ts
independent_ai_review: independentAiReviewResultSchema.optional(),
test_mapping: z.array(reviewPacketTestMappingSchema).optional(),
```

If `reviewPacketSchema` does not exist, create and export it in `review.ts` using the current `ReviewPacket` public shape. Include `self_review: selfReviewResultSchema`, `independent_ai_review`, `test_mapping`, `risk_notes`, `requested_changes`, timestamps, run/package/spec/plan revision ids, status, and decision. Update any Work Item cockpit response schema from Task 2 so `review_packets` parse through `z.array(reviewPacketSchema)` or a compatible strict public Review Packet schema that preserves `independent_ai_review` and `test_mapping`.

- [ ] **Step 4: Implement pure helper functions**

Before implementing the helper functions, update Review Packet DB persistence:

- In `packages/db/src/schema/review-packet.ts`, add:

```ts
independentAiReview: jsonb('independent_ai_review').$type<ReviewPacket['independent_ai_review']>(),
testMapping: jsonb('test_mapping').$type<ReviewPacket['test_mapping']>(),
```

- In `tests/db/schema.test.ts`, add:

```ts
expect(columnType(review_packets, 'independentAiReview')).toBe('PgJsonb');
expect(columnType(review_packets, 'testMapping')).toBe('PgJsonb');
```

- In `tests/db/repository.test.ts`, update the `reviewPacket` fixture and `reviewPacketRow` mapper fixture with `independent_ai_review` / `independentAiReview` and `test_mapping` / `testMapping`, then assert:

```ts
expect(mappedReviewPacket?.independent_ai_review).toEqual(reviewPacket.independent_ai_review);
expect(mappedReviewPacket?.test_mapping).toEqual(reviewPacket.test_mapping);
```

- In `tests/db/repository-contract.ts`, add `independent_ai_review` and `test_mapping` to the canonical `ReviewPacket` fixture so both in-memory and Drizzle repositories must round-trip both evidence fields.

Because `DrizzleDeliveryRepository` uses `toDbRecord`/`fromDbRecord`, adding the schema columns should be enough for save/get/list round-trips. If the implementation finds custom row mapping for Review Packets, update it explicitly. Do not leave independent AI Review or test mapping as contract-only data.

Create `packages/domain/src/work-item-delivery-readiness.ts`:

```ts
const positive = new Set(['ready', 'passed', 'validated', 'succeeded', 'acknowledged']);
const failed = new Set(['failed', 'invalid', 'rejected']);
const running = new Set(['running', 'in_progress', 'validating']);

export const normalizeToken = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : undefined;
```

Implement:

- `hasCompleteReviewEvidence(reviewPacket, context)` returns `{ complete: boolean; blockers: string[] }`.
- `normalizeRequiredTestGate(gate, evidence)` returns `{ gate_id?: string; state: 'passed' | 'blocked'; blocker?: string }`.
- `normalizeIntegrationReadiness(value)` returns `{ state: 'passed' | 'running' | 'failed' | 'blocked'; blockers: string[]; summary_status?: string }`.
- `deriveInitiativeAggregationState(input)` returns `{ mode: 'direct_packages' | 'aggregated_children' | 'unavailable'; label: string }`.

Rules:

- Required test gate package metadata only declares a requirement; it cannot satisfy itself.
- A required test gate passes only when it has a stable gate id/key and matching selected-run check evidence, selected Review Packet test mapping, or pre-release Test/Acceptance evidence.
- Unknown test gate records block.
- `not_required` requires a non-empty rationale.
- Review evidence must match the selected run, package id, approved Spec revision, and approved Plan revision.
- Review evidence must include implementer self-review, independent AI review, test mapping, and a `risk_notes` property even when it is an empty array.
- Stale or release-scoped Review Packets that do not match the selected Work Item run block Review.
- Top-level integration status is summary only.
- Integration Readiness returns `running` when any required dimension is in progress and no dimension has failed or is missing.
- Integration Readiness returns `failed` when any required dimension reports a failed/invalid/rejected status.
- Unknown summary or dimension statuses block with `unknown_integration_readiness_status`.
- Missing contract/mock/environment/dependency/cross-end evidence returns specific blockers.
- Empty explicit `blockers` is required for integration pass.
- Initiative child aggregation is explicit: if no child readiness evidence is available in this slice, return `unavailable`; never infer aggregate readiness from an empty package list.

- [ ] **Step 5: Export helpers**

In `packages/domain/src/index.ts`:

```ts
export * from './work-item-delivery-readiness.js';
```

- [ ] **Step 6: Run tests and builds**

Run:

```bash
pnpm vitest run tests/domain/work-item-delivery-readiness.test.ts tests/contracts/review-packet.test.ts tests/contracts/work-item-delivery-readiness.test.ts tests/db/schema.test.ts tests/db/repository.test.ts tests/db/repository-contract.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/domain build
pnpm --filter @forgeloop/contracts build
pnpm --filter @forgeloop/db build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/review.ts packages/domain/src/types.ts packages/domain/src/work-item-delivery-readiness.ts packages/domain/src/index.ts packages/db/src/schema/review-packet.ts packages/db/src/repositories/drizzle-delivery-repository.ts tests/domain/work-item-delivery-readiness.test.ts tests/contracts/review-packet.test.ts tests/contracts/work-item-delivery-readiness.test.ts tests/db/schema.test.ts tests/db/repository.test.ts tests/db/repository-contract.ts
git commit -m "feat: add delivery readiness domain gates"
```

---

### Task 4: Implement Deterministic Work Item Package, Run, And Review Selection

**Files:**
- Create: `packages/db/src/queries/work-item-delivery-selection.ts`
- Test: `tests/db/work-item-delivery-selection.test.ts`

- [ ] **Step 1: Write failing selection tests**

Create `tests/db/work-item-delivery-selection.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  currentApprovedPlanPackages,
  selectWorkItemReviewPacket,
  selectWorkItemRunSession,
} from '../../packages/db/src/queries/work-item-delivery-selection';

describe('Work Item delivery selection', () => {
  it('selects only current approved-plan packages', () => {
    const packages = [
      packageFixture({ id: 'current', spec_revision_id: 'spec-r1', plan_revision_id: 'plan-r1' }),
      packageFixture({ id: 'stale-plan', spec_revision_id: 'spec-r1', plan_revision_id: 'plan-r0' }),
      packageFixture({ id: 'deleted', spec_revision_id: 'spec-r1', plan_revision_id: 'plan-r1', deleted_at: '2026-05-20T00:00:00.000Z' }),
    ];
    expect(currentApprovedPlanPackages(packages, { workItemId: 'wi-1', approvedSpecRevisionId: 'spec-r1', approvedPlanRevisionId: 'plan-r1' }).map((item) => item.id)).toEqual(['current']);
  });

  it('selects current run, then last run, then latest created run', () => {
    const runs = [
      runFixture({ id: 'latest', created_at: '2026-05-20T00:03:00.000Z' }),
      runFixture({ id: 'last', created_at: '2026-05-20T00:02:00.000Z' }),
      runFixture({ id: 'current', created_at: '2026-05-20T00:01:00.000Z' }),
    ];
    expect(selectWorkItemRunSession(packageFixture({ current_run_session_id: 'current', last_run_session_id: 'last' }), runs)?.id).toBe('current');
    expect(selectWorkItemRunSession(packageFixture({ last_run_session_id: 'last' }), runs)?.id).toBe('last');
    expect(selectWorkItemRunSession(packageFixture({}), runs)?.id).toBe('latest');
  });

  it('selects current review, selected-run review, then latest package review', () => {
    const reviews = [
      reviewFixture({ id: 'latest', run_session_id: 'run-2', updated_at: '2026-05-20T00:03:00.000Z' }),
      reviewFixture({ id: 'selected-run', run_session_id: 'run-1', updated_at: '2026-05-20T00:02:00.000Z' }),
      reviewFixture({ id: 'current', run_session_id: 'run-0', updated_at: '2026-05-20T00:01:00.000Z' }),
    ];
    expect(selectWorkItemReviewPacket(packageFixture({ current_review_packet_id: 'current' }), runFixture({ id: 'run-1' }), reviews)?.id).toBe('current');
    expect(selectWorkItemReviewPacket(packageFixture({}), runFixture({ id: 'run-1' }), reviews)?.id).toBe('selected-run');
    expect(selectWorkItemReviewPacket(packageFixture({}), runFixture({ id: 'missing' }), reviews)?.id).toBe('latest');
  });
});
```

Keep fixtures local to the test file and include only fields used by helpers.

- [ ] **Step 2: Run selection tests and verify failure**

Run: `pnpm vitest run tests/db/work-item-delivery-selection.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because helper file does not exist.

- [ ] **Step 3: Implement selection helpers**

Create `packages/db/src/queries/work-item-delivery-selection.ts` with pure functions:

```ts
export const currentApprovedPlanPackages = (
  packages: readonly ExecutionPackage[],
  input: { workItemId: string; approvedSpecRevisionId: string; approvedPlanRevisionId: string },
): ExecutionPackage[] =>
  packages.filter(
    (item) =>
      item.work_item_id === input.workItemId &&
      item.archived_at === undefined &&
      item.deleted_at === undefined &&
      item.spec_revision_id === input.approvedSpecRevisionId &&
      item.plan_revision_id === input.approvedPlanRevisionId,
  );
```

Use created/updated sorting helpers that are deterministic and do not mutate inputs.

- [ ] **Step 4: Run selection tests**

Run: `pnpm vitest run tests/db/work-item-delivery-selection.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/queries/work-item-delivery-selection.ts tests/db/work-item-delivery-selection.test.ts
git commit -m "feat: add work item delivery selection helpers"
```

---

### Task 5: Implement Strict Pre-Release Work Item Release Readiness

**Files:**
- Create: `packages/db/src/queries/work-item-release-readiness.ts`
- Test: `tests/db/work-item-release-readiness.test.ts`

- [ ] **Step 1: Write failing release readiness tests**

Create `tests/db/work-item-release-readiness.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deriveWorkItemPreReleaseReadiness } from '../../packages/db/src/queries/work-item-release-readiness';

describe('Work Item pre-release readiness', () => {
  it('is missing when handoff is expected and no release is linked', () => {
    expect(deriveWorkItemPreReleaseReadiness(releaseInput({ handoffExpected: true, releases: [] }))).toMatchObject({
      state: 'missing',
      blockers: [expect.objectContaining({ code: 'missing_linked_release' })],
    });
  });

  it('blocks partial release scope', () => {
    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({
          packages: [packageRef('pkg-1'), packageRef('pkg-2')],
          releases: [releaseFixture({ execution_package_ids: ['pkg-1'] })],
        }),
      ),
    ).toMatchObject({ state: 'blocked', blockers: [expect.objectContaining({ code: 'partial_release_scope' })] });
  });

  it('excludes observation-only blockers from pre-release readiness', () => {
    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({
          releases: [releaseFixture({ execution_package_ids: ['pkg-1'] })],
          releaseBlockers: [{ code: 'missing_observation_plan', message: 'Observation needed', object_type: 'release', object_id: 'rel-1' }],
        }),
      ).blockers,
    ).toEqual([]);
  });

  it('requires override fingerprints to match the pre-release blocker scope', () => {
    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({
          releases: [releaseFixture({ execution_package_ids: ['pkg-1'] })],
          releaseBlockers: [{ code: 'missing_rollout_strategy', message: 'Rollout needed', object_type: 'release', object_id: 'rel-1' }],
          overrideFingerprint: 'release-blockers:v1:stale',
        }),
      ),
    ).toMatchObject({ state: 'blocked' });
  });

  it('blocks when linked release Test/Acceptance evidence is missing or unacknowledged', () => {
    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({
          packages: [packageRef('pkg-1')],
          releases: [releaseFixture({ id: 'rel-1', execution_package_ids: ['pkg-1'] })],
          releaseTestAcceptance: [{ release_id: 'rel-1', gate_id: 'qa-ack', state: 'missing', scope_fingerprint: 'scope-1' }],
          decisions: [],
        }),
      ),
    ).toMatchObject({
      state: 'blocked',
      blockers: [expect.objectContaining({ code: 'missing_release_test_acceptance' })],
    });
  });
});
```

Use local fixtures. The helper input should be plain objects; do not instantiate repositories.

- [ ] **Step 2: Run release readiness tests and verify failure**

Run: `pnpm vitest run tests/db/work-item-release-readiness.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement pre-release readiness helper**

Create `packages/db/src/queries/work-item-release-readiness.ts`.

Required exports:

```ts
export type WorkItemPreReleaseState = 'not_applicable' | 'missing' | 'blocked' | 'ready';
export const preReleaseBlockerFingerprint = (blockers: readonly DeliveryBlockerLike[]): string => ...
export const deriveWorkItemPreReleaseReadiness = (input: WorkItemPreReleaseReadinessInput): WorkItemPreReleaseReadiness => ...
```

The `WorkItemPreReleaseReadinessInput` must include the data needed by the strict pre-release calculation:

```ts
export interface WorkItemPreReleaseReadinessInput {
  workItem: WorkItem;
  packages: readonly ExecutionPackage[];
  releases: readonly Release[];
  releaseBlockers: readonly ReleaseBlockerLike[];
  releaseTestAcceptance: readonly ReleaseTestAcceptanceEvidenceLike[];
  releaseEvidence: readonly ReleaseEvidenceLike[];
  decisions: readonly DecisionLike[];
  qualityGatePassed: boolean;
  handoffExpected: boolean;
}
```

Rules:

- Full Work Item release readiness only.
- Handoff expected when all required packages pass Quality Gate or a release is already linked.
- Missing linked release after expected handoff -> `missing`.
- Linked release before Quality Gate -> `blocked` by upstream.
- Partial package scope -> `blocked`.
- Pre-release blockers include revision/check/artifact/evidence-chain/rollout/rollback/Test-Acceptance/scope blockers.
- Release Test/Acceptance evidence must be scoped to the same linked release and Work Item/package scope fingerprint.
- Override and acknowledgement decisions must match the dedicated pre-release blocker or Test/Acceptance scope fingerprint; stale full-release cockpit decisions do not apply.
- Observation-only blockers are ignored.
- Overrides clear blockers only when the pre-release fingerprint matches.
- Do not call `deriveReleaseBlockers` and then apply override blindly.
- Do not call `deriveReleaseTestAcceptanceGate` directly.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/db/work-item-release-readiness.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/queries/work-item-release-readiness.ts tests/db/work-item-release-readiness.test.ts
git commit -m "feat: add work item pre-release readiness"
```

---

### Task 6: Implement Backend Work Item Delivery Readiness Aggregator

**Files:**
- Create: `packages/db/src/queries/work-item-delivery-readiness.ts`
- Modify: `packages/db/src/queries/work-item-cockpit-queries.ts`
- Modify: `packages/db/src/queries/work-item-action-queries.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.controller.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.service.ts`
- Modify: `apps/control-plane-api/src/modules/query/product-lane-query-parser.ts`
- Test: `tests/db/work-item-delivery-readiness.test.ts`
- Test: `tests/api/query-module.test.ts`
- Test: `tests/api/delivery-flow.test.ts`
- Test: `tests/api/product-lanes.test.ts`

- [ ] **Step 1: Write failing read model tests**

Create `tests/db/work-item-delivery-readiness.test.ts` with focused cases:

```ts
import { describe, expect, it } from 'vitest';
import { deriveWorkItemDeliveryReadiness } from '../../packages/db/src/queries/work-item-delivery-readiness';

describe('Work Item delivery readiness', () => {
  it('returns all eight stages for a requirement', () => {
    const readiness = deriveWorkItemDeliveryReadiness(readyInput({ kind: 'requirement' }));
    expect(readiness.stages.map((stage) => stage.id)).toEqual([
      'spec',
      'plan',
      'packages',
      'execution',
      'review',
      'integration_readiness',
      'quality_gate',
      'release_readiness',
    ]);
  });

  it('marks initiative package stages not applicable without current packages', () => {
    const readiness = deriveWorkItemDeliveryReadiness(readyInput({ kind: 'initiative', packages: [] }));
    expect(readiness.stages.find((stage) => stage.id === 'packages')).toMatchObject({ state: 'not_applicable' });
  });

  it('marks Requirement integration readiness not applicable for simple single-package scope', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({
        kind: 'requirement',
        risk: 'medium',
        packages: [packageFixture({ integration_readiness: undefined })],
        packageDependencies: [],
      }),
    );
    expect(readiness.stages.find((stage) => stage.id === 'integration_readiness')).toMatchObject({
      state: 'not_applicable',
    });
    expect(readiness.stages.find((stage) => stage.id === 'quality_gate')).not.toMatchObject({
      blockers: [expect.objectContaining({ code: 'missing_integration_readiness' })],
    });
  });

  it('requires Requirement integration readiness for high-risk or multi-package scope', () => {
    const highRisk = deriveWorkItemDeliveryReadiness(
      readyInput({
        kind: 'requirement',
        risk: 'high',
        packages: [packageFixture({ integration_readiness: undefined })],
        packageDependencies: [],
      }),
    );
    expect(highRisk.stages.find((stage) => stage.id === 'integration_readiness')).toMatchObject({
      state: 'missing',
      blockers: [expect.objectContaining({ code: 'missing_integration_readiness' })],
    });

    const multiPackage = deriveWorkItemDeliveryReadiness(
      readyInput({
        kind: 'requirement',
        risk: 'medium',
        packages: [packageFixture({ id: 'pkg-1' }), packageFixture({ id: 'pkg-2' })],
        packageDependencies: [],
      }),
    );
    expect(multiPackage.stages.find((stage) => stage.id === 'integration_readiness')).toMatchObject({
      state: 'missing',
      blockers: [expect.objectContaining({ code: 'missing_integration_readiness' })],
    });
  });

  it('marks Bug integration readiness not applicable unless regression or cross-end evidence requires it', () => {
    const simpleBug = deriveWorkItemDeliveryReadiness(
      readyInput({
        kind: 'bug',
        risk: 'medium',
        packages: [packageFixture({ integration_readiness: undefined })],
        packageDependencies: [],
      }),
    );
    expect(simpleBug.stages.find((stage) => stage.id === 'integration_readiness')).toMatchObject({
      state: 'not_applicable',
    });

    const crossEndBug = deriveWorkItemDeliveryReadiness(
      readyInput({
        kind: 'bug',
        packages: [packageFixture({ integration_readiness: { status: 'required', surface: 'regression_cross_end' } })],
      }),
    );
    expect(crossEndBug.stages.find((stage) => stage.id === 'integration_readiness')).toMatchObject({
      state: 'blocked',
      blockers: [expect.objectContaining({ code: 'missing_contract_readiness' })],
    });
  });

  it('keeps Bug delivery validation stages required', () => {
    const readiness = deriveWorkItemDeliveryReadiness(readyInput({ kind: 'bug', packages: [] }));
    expect(readiness.stages.find((stage) => stage.id === 'packages')).toMatchObject({ state: 'missing' });
    expect(readiness.stages.find((stage) => stage.id === 'execution')).toMatchObject({ state: 'blocked' });
    expect(readiness.stages.find((stage) => stage.id === 'review')).toMatchObject({ state: 'blocked' });
    expect(readiness.stages.find((stage) => stage.id === 'quality_gate')).toMatchObject({ state: 'blocked' });
  });

  it('reaches ready for release only when all required stages and linked release readiness pass', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({
        kind: 'requirement',
        risk: 'medium',
        packages: [packageFixture({ integration_readiness: undefined })],
        packageDependencies: [],
        linkedRelease: releaseFixture({ id: 'rel-ready', execution_package_ids: ['pkg-1'] }),
        releaseBlockers: [],
        releaseTestAcceptance: [releaseTestAcceptanceFixture({ package_id: 'pkg-1', state: 'passed' })],
        releaseEvidence: [releaseEvidenceFixture({ package_id: 'pkg-1', kind: 'pre_release_validation' })],
      }),
    );
    expect(readiness.stages.find((stage) => stage.id === 'integration_readiness')).toMatchObject({ state: 'not_applicable' });
    expect(readiness.stages.find((stage) => stage.id === 'release_readiness')).toMatchObject({ state: 'ready' });
    expect(readiness.overall_state).toBe('ready_for_release');
  });

  it('requires Tech Debt integration readiness for shared or migration-sensitive packages', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({
        kind: 'tech_debt',
        packages: [packageFixture({ integration_readiness: { status: 'ready', surface: 'shared_contract_migration' } })],
      }),
    );
    expect(readiness.stages.find((stage) => stage.id === 'integration_readiness')).toMatchObject({
      state: 'blocked',
      blockers: [expect.objectContaining({ code: 'missing_contract_readiness' })],
    });
    expect(readiness.stages.find((stage) => stage.id === 'quality_gate')).toMatchObject({ state: 'blocked' });
  });

  it('blocks quality gate when required test gates are unknown', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({ packages: [packageFixture({ required_test_gates: [{ status: 'passed' }] })] }),
    );
    expect(readiness.stages.find((stage) => stage.id === 'quality_gate')).toMatchObject({ state: 'blocked' });
  });

  it('blocks execution and downstream readiness when selected-run required checks are missing or failed', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({
        packages: [packageFixture({ required_checks: [{ check_id: 'unit', display_name: 'Unit', command: 'pnpm test', timeout_seconds: 60, blocks_review: true }] })],
        runSessions: [runFixture({ id: 'run-1', status: 'succeeded', check_results: [{ check_id: 'unit', status: 'failed', blocks_review: true }] })],
      }),
    );
    expect(readiness.stages.find((stage) => stage.id === 'execution')).toMatchObject({
      state: 'blocked',
      blockers: [expect.objectContaining({ code: 'failed_required_check' })],
    });
    expect(readiness.stages.find((stage) => stage.id === 'quality_gate')).toMatchObject({
      state: 'blocked',
      blockers: [expect.objectContaining({ code: 'failed_required_check' })],
    });
    expect(readiness.stages.find((stage) => stage.id === 'release_readiness')).toMatchObject({ state: 'blocked' });

    const missing = deriveWorkItemDeliveryReadiness(
      readyInput({
        packages: [packageFixture({ required_checks: [{ check_id: 'unit', display_name: 'Unit', command: 'pnpm test', timeout_seconds: 60, blocks_review: true }] })],
        runSessions: [runFixture({ id: 'run-1', status: 'succeeded', check_results: [] })],
      }),
    );
    expect(missing.stages.find((stage) => stage.id === 'execution')).toMatchObject({
      state: 'blocked',
      blockers: [expect.objectContaining({ code: 'missing_required_check' })],
    });
  });

  it('blocks review when selected Review Packet is stale or incomplete', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({
        packages: [packageFixture({ current_review_packet_id: 'review-1' })],
        runSessions: [runFixture({ id: 'run-1', status: 'succeeded' })],
        reviewPackets: [reviewFixture({ id: 'review-1', run_session_id: 'stale-run', status: 'completed', decision: 'approved', independent_ai_review: undefined })],
      }),
    );
    expect(readiness.stages.find((stage) => stage.id === 'review')).toMatchObject({
      state: 'blocked',
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'stale_review_run' }),
        expect.objectContaining({ code: 'missing_independent_ai_review' }),
      ]),
    });
  });

  it('blocks quality gate when required artifacts are absent from selected-run evidence', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({
        packages: [packageFixture({ required_artifact_kinds: ['logs', 'review_packet'] })],
        runSessions: [runFixture({ id: 'run-1', status: 'succeeded', artifacts: [], log_refs: [] })],
        reviewPackets: [reviewFixture({ run_session_id: 'run-1', status: 'completed', decision: 'approved' })],
      }),
    );
    expect(readiness.stages.find((stage) => stage.id === 'quality_gate')).toMatchObject({
      state: 'blocked',
      blockers: [expect.objectContaining({ code: 'missing_required_artifact' })],
    });
  });

  it('blocks downstream stages when strict Spec or Plan content checks fail', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({
        approvedSpecRevision: specRevisionFixture({ id: 'spec-r1', acceptance_criteria: [], test_strategy_summary: '' }),
        approvedPlanRevision: planRevisionFixture({ id: 'plan-r1', based_on_spec_revision_id: 'stale-spec-r0', test_matrix: [], rollback_notes: '' }),
      }),
    );
    expect(readiness.stages.find((stage) => stage.id === 'spec')).toMatchObject({ state: 'blocked' });
    expect(readiness.stages.find((stage) => stage.id === 'plan')).toMatchObject({ state: 'blocked' });
    expect(readiness.stages.find((stage) => stage.id === 'quality_gate')).toMatchObject({ state: 'blocked' });
    expect(readiness.stages.find((stage) => stage.id === 'release_readiness')).toMatchObject({ state: 'blocked' });
  });

  it('requires package dependencies to trigger Integration Readiness even when packages have no inline integration record', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({
        kind: 'requirement',
        risk: 'medium',
        packages: [packageFixture({ id: 'pkg-1', integration_readiness: undefined })],
        packageDependencies: [
          dependencyFixture({
            execution_package_id: 'pkg-1',
            depends_on_package_id: 'pkg-shared-api',
          }),
        ],
      }),
    );
    expect(readiness.stages.find((stage) => stage.id === 'integration_readiness')).toMatchObject({
      state: 'missing',
      blockers: [expect.objectContaining({ code: 'missing_integration_readiness' })],
    });
    expect(readiness.stages.find((stage) => stage.id === 'quality_gate')).toMatchObject({ state: 'blocked' });
  });

  it('turns consumed degraded sources into stage blockers instead of ready states', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({ degradedSources: ['package_dependencies', 'integration_readiness', 'release_scope', 'release_blockers', 'release_test_acceptance'] }),
    );
    expect(readiness.stages.find((stage) => stage.id === 'integration_readiness')).toMatchObject({ state: 'blocked' });
    expect(readiness.stages.find((stage) => stage.id === 'quality_gate')).toMatchObject({ state: 'blocked' });
    expect(readiness.stages.find((stage) => stage.id === 'release_readiness')).toMatchObject({ state: 'blocked' });
    expect(readiness.overall_state).not.toBe('ready_for_release');
  });

  it('makes manager lane read-only', () => {
    const readiness = deriveWorkItemDeliveryReadiness(readyInput({ activeLane: 'manager' }));
    expect(readiness.next_actions.every((action) => action.kind === 'navigate')).toBe(true);
  });

  it('returns responsibility-aware next actions for delivery lanes', () => {
    const cases = [
      { lane: 'spec-approver', label: /spec|plan|test strategy/i, objectType: 'spec' },
      { lane: 'execution-owner', label: /package|run/i, objectType: 'execution_package' },
      { lane: 'reviewer', label: /review/i, objectType: 'review_packet' },
      { lane: 'qa-test-owner', label: /quality|gate|acceptance/i, objectType: 'work_item' },
      { lane: 'release-owner', label: /release/i, objectType: 'release' },
    ] as const;

    for (const item of cases) {
      const readiness = deriveWorkItemDeliveryReadiness(readyInput({ activeLane: item.lane, linkedRelease: releaseFixture({ id: 'rel-1' }) }));
      expect(readiness.next_actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            lane_id: item.lane,
            kind: 'navigate',
            label: expect.stringMatching(item.label),
            target: expect.objectContaining({ kind: 'object', object_type: item.objectType }),
          }),
        ]),
      );
    }
  });

  it('returns package generation as delivery_readiness next action only after approved Plan revision exists', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({
        packages: [],
        currentPlan: planFixture({ approved_revision_id: 'plan-r1', current_revision_id: 'plan-r1' }),
        approvedPlanRevision: planRevisionFixture({ id: 'plan-r1' }),
        activeLane: 'requirements',
      }),
    );
    expect(readiness.next_actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'command',
          command: expect.objectContaining({
            type: 'generate_packages',
            plan_revision_id: 'plan-r1',
          }),
        }),
      ]),
    );
    expect(readiness.next_actions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: expect.objectContaining({ type: expect.stringContaining('create') }) }),
      ]),
    );

    const missingApprovedRevision = deriveWorkItemDeliveryReadiness(
      readyInput({
        packages: [],
        currentPlan: planFixture({ approved_revision_id: undefined, current_revision_id: 'plan-r1' }),
        approvedPlanRevision: planRevisionFixture({ id: 'plan-r1' }),
        activeLane: 'requirements',
      }),
    );
    expect(missingApprovedRevision.next_actions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: expect.objectContaining({ type: 'generate_packages' }) }),
      ]),
    );
  });
});
```

Keep fixture helpers local to this test file. Include only fields consumed by `deriveWorkItemDeliveryReadiness`; add small helpers for package dependencies, release Test/Acceptance evidence, release evidence, and decisions when the relevant assertions need them.

- [ ] **Step 2: Run read model tests and verify failure**

Run: `pnpm vitest run tests/db/work-item-delivery-readiness.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because aggregator does not exist.

- [ ] **Step 3: Implement `deriveWorkItemDeliveryReadiness`**

Create `packages/db/src/queries/work-item-delivery-readiness.ts`.

Use pure input/output first:

```ts
export interface WorkItemDeliveryReadinessInput {
  workItem: WorkItem;
  activeLane?: ProductLaneId;
  currentSpec: Spec | null;
  currentSpecRevision: SpecRevision | null;
  approvedSpecRevision: SpecRevision | null;
  currentPlan: Plan | null;
  currentPlanRevision: PlanRevision | null;
  approvedPlanRevision: PlanRevision | null;
  packages: readonly ExecutionPackage[];
  packageDependencies: readonly ExecutionPackageDependency[];
  runSessions: readonly RunSession[];
  reviewPackets: readonly ReviewPacket[];
  releases: readonly Release[];
  releaseBlockers: readonly ReleaseBlockerLike[];
  releaseTestAcceptance: readonly ReleaseTestAcceptanceEvidenceLike[];
  releaseEvidence: readonly ReleaseEvidenceLike[];
  decisions: readonly DecisionLike[];
  degradedSources?: readonly DegradedSourceKey[];
}
```

Implementation requirements:

- Use strict current approved revision checks.
- Spec cannot pass unless `currentSpec.status/resolution` are approved, `currentSpec.current_revision_id === currentSpec.approved_revision_id`, `approvedSpecRevision?.id === currentSpec.approved_revision_id`, and that approved Spec Revision has test strategy summary and acceptance criteria.
- Plan cannot pass unless `currentPlan.status/resolution` are approved, `currentPlan.current_revision_id === currentPlan.approved_revision_id`, `approvedPlanRevision?.id === currentPlan.approved_revision_id`, `approvedPlanRevision.based_on_spec_revision_id === approvedSpecRevision.id`, and that approved Plan Revision has test matrix and rollback notes.
- Use Task 4 selection helpers.
- Use Task 3 normalizers.
- Use Task 5 Release Readiness helper.
- If no active lane is provided, derive the default lane from Work Item kind inside the backend readiness aggregator: `requirement -> requirements`, `bug -> bugs`, `tech_debt -> tech-debt`, `initiative -> initiatives`.
- Always set the resolved lane on `delivery_readiness.active_lane`; callers should render from that value rather than duplicating default-lane logic.
- Apply Work Item kind applicability for all four kinds in backend readiness, not only UI labels:
  - Requirement uses the full delivery mainline, but Integration Readiness is required only when the Work Item is high risk, has more than one current package, has package dependencies, or any current package has non-empty `integration_readiness`; otherwise the Integration Readiness stage is `not_applicable`.
  - Bug keeps Spec/Plan, Packages, Execution, Review, and Quality Gate required for fix validation and regression safety, but follows the same Integration Readiness requirement rule as Requirement. Regression or cross-end impact recorded in package `integration_readiness` makes Integration Readiness required; a simple single-package Bug without those signals must show Integration Readiness as `not_applicable`.
  - Tech Debt keeps the same required delivery stages and requires Integration Readiness when the package touches shared contracts, migrations, dependencies, multiple packages, or explicit package `integration_readiness`; otherwise Integration Readiness is `not_applicable`.
  - Initiative without direct packages marks Packages through Release Readiness `not_applicable` and emits explicit aggregation-unavailable evidence when child links are not available.
- Execution must evaluate required blocking checks on the selected run; missing or failed required check results make Execution `blocked`, and downstream Quality Gate and Release Readiness inherit that blocker.
- Review must use selected-run-aware evidence validation: the selected Review Packet must match the selected run, package id, approved Spec revision, and approved Plan revision, and must include self-review, independent AI review, test mapping, and risk notes.
- Quality Gate must evaluate selected-run `required_checks`, selected-run required artifact presence through `deriveRequiredArtifactPresence`, Review evidence, Integration Readiness, and required test gates.
- Quality Gate must call `normalizeRequiredTestGate(gate, evidence)` with matching selected-run checks, selected Review Packet test mappings, and pre-release Test/Acceptance evidence; package `required_test_gates.status = "passed"` alone is not evidence.
- Quality Gate and Release Readiness must receive release blockers, Release Test/Acceptance evidence, release evidence, and decisions/overrides as explicit inputs; do not compute Release Readiness from `releases` alone.
- Consumed degraded sources must block their stage and downstream readiness. At minimum:
  - `package_dependencies` and `integration_readiness` block Integration Readiness and Quality Gate.
  - `run_sessions` blocks Execution and downstream stages.
  - `review_packets` blocks Review and downstream stages.
  - `release_scope`, `release_blockers`, and `release_test_acceptance` block Release Readiness.
- Stage state precedence follows the spec.
- `delivery_readiness.next_actions` is built here.
- Manager actions are navigate-only.
- Generate at least one responsibility-aware navigate action for each active delivery lane when relevant evidence exists:
  - `spec-approver`: Spec/Plan review gaps, risk requirements, or test-strategy gaps;
  - `execution-owner`: current package or selected run console;
  - `reviewer`: selected Review Packet or requested-change context;
  - `qa-test-owner`: Quality Gate blocker context or linked release Test/Acceptance context;
  - `release-owner`: linked Release detail or Release inventory/create-link surface.
- Avoid generic default-only actions for responsibility lanes; lane-specific actions must be tested against `delivery_readiness.next_actions`.
- Release Owner create/link is a navigate action to `/releases` or `/releases/:id`, never a command.
- No action target uses `/workbench`.

- [ ] **Step 4: Modify cockpit query to attach readiness**

In `packages/db/src/queries/work-item-cockpit-queries.ts`:

- Remove `deriveWorkItemCompletion` import.
- Remove `nextActions`.
- Remove `completion_state` and top-level `next_actions`.
- Add active lane to options or argument.
- Fetch current/approved `SpecRevision` and `PlanRevision` records for the current Spec/Plan. If an approved revision id is set but the revision record is missing, pass `null` and let the readiness aggregator block the relevant stage.
- Fetch package dependencies for every current approved-plan package with `repository.listExecutionPackageDependencies(package.id)` and pass the flattened result into `deriveWorkItemDeliveryReadiness`.
- Query releases linked to Work Item/package ids.
- Query or derive the strict pre-release release inputs needed by `deriveWorkItemPreReleaseReadiness`: release blockers, release Test/Acceptance evidence, release evidence, decisions/override decisions, and scope fingerprints for linked Work Item/package scope.
- Wrap non-authoritative downstream reads in a stable degraded-source collector:
  - `listExecutionPackagesForWorkItem` failure adds `execution_packages` and passes `[]`;
  - `listExecutionPackageDependencies` failure adds `package_dependencies` and passes `[]`;
  - package `integration_readiness` lookup/parsing failure adds `integration_readiness`;
  - run-session reads failure adds `run_sessions`;
  - Review Packet reads failure adds `review_packets`;
  - linked release scope reads failure adds `release_scope`;
  - release blocker reads failure adds `release_blockers`;
  - release Test/Acceptance reads failure adds `release_test_acceptance`.
- Do not swallow missing Work Item/project base data; return the existing not-found behavior for absent canonical Work Item records. Degraded sources are for partial downstream readiness reads only.
- Attach `delivery_readiness`.
- Parse with `workItemCockpitResponseSchema`.

- [ ] **Step 5: Thread active lane through the API query module**

In `apps/control-plane-api/src/modules/query/query.controller.ts`:

- Add `@Query('lane') lane?: string` to the `work-item-cockpit/:workItemId` handler.
- Validate the optional lane with `productLaneIdSchema.safeParse`.
- Return a 400 response for unknown lane ids using the existing controller error pattern.
- Pass the parsed lane to the service. Leave it `undefined` when the query parameter is absent so the DB readiness query derives the Work Item kind default.

In `apps/control-plane-api/src/modules/query/query.service.ts`:

- Change `getWorkItemCockpit(workItemId)` to `getWorkItemCockpit(workItemId, options?: { lane?: ProductLaneId })`.
- Pass `options?.lane` into `packages/db/src/queries/work-item-cockpit-queries.ts`.
- Preserve `undefined` when no lane query parameter is supplied; do not compute the default lane in the controller, service, or Web client.

Do not wait until the Web hook task for this; the API tests in this task must prove the lane query works end to end.

- [ ] **Step 6: Remove public Work Item actions query**

In `apps/control-plane-api/src/modules/query/query.controller.ts`, remove:

```ts
@Get('work-items/:workItemId/actions')
getWorkItemActions(...)
```

In `apps/control-plane-api/src/modules/query/query.service.ts`, remove the corresponding `getWorkItemActions` service method and imports.

In `apps/control-plane-api/src/modules/query/product-lane-query-parser.ts`, remove `parseWorkItemActionsQuery`.

In `packages/db/src/queries/work-item-action-queries.ts`:

- Delete the file if the action builders have moved into `work-item-delivery-readiness.ts`.
- If helper code remains useful, move it into a non-legacy file name such as `work-item-delivery-action-builders.ts`.
- Rename exports to internal builder names consumed by `work-item-delivery-readiness.ts`.
- Do not return `WorkItemActionsResponse` from this file.
- Do not leave a file named `work-item-action-queries.ts` in active product code.

In `packages/db/src/index.ts`:

- Remove `export * from './queries/work-item-action-queries';`.
- Add exports for the new public read model helpers required by the API:

```ts
export * from './queries/work-item-delivery-selection';
export * from './queries/work-item-release-readiness';
export * from './queries/work-item-delivery-readiness';
```

Do not keep a public DB export whose name exposes `work-item-action-queries`.

- [ ] **Step 7: Update API query tests**

In `tests/api/product-lanes.test.ts`, update the old Work Item actions coverage in this backend task, because the endpoint/service and DB export are removed here:

- Remove `getWorkItemActions` from the `../../packages/db/src/index` import.
- Rename `serves Product Lane and Work Item actions endpoints and removes old workbench routes` to `serves Product Lane endpoints without Work Item action endpoint compatibility`.
- Keep Product Lane response assertions.
- Replace the old actions endpoint `200` assertion with:

```ts
await request(app.getHttpServer()).get(`/query/work-items/${workItem.id}/actions?lane=bugs`).expect(404);
```

- In `rejects invalid Product Lane and Work Item actions query parameters`, delete all invalid-query assertions for `/query/work-items/:id/actions`; because the endpoint is gone, query-shape validation there is no longer a public behavior.
- Delete or port the direct DB action tests:
  - `returns lane-aware Work Item actions without legacy create aliases`;
  - `returns package generation actions only after an approved Plan revision exists`;
  - `does not create package generation actions from approved Plans without approved revisions`.
- Port the behavior that still matters to `delivery_readiness.next_actions` assertions in `tests/db/work-item-delivery-readiness.test.ts` or `tests/api/query-module.test.ts`.

In `tests/api/query-module.test.ts`, change cockpit assertions:

```ts
expect(response.body.delivery_readiness).toMatchObject({
  work_item_id: executionPackage.work_item_id,
  active_lane: 'requirements',
});
expect(response.body).not.toHaveProperty('next_actions');
expect(response.body).not.toHaveProperty('completion_state');
```

Add:

```ts
await request(app.getHttpServer())
  .get(`/query/work-item-cockpit/${executionPackage.work_item_id}?lane=execution-owner`)
  .expect(200)
  .expect(({ body }) => {
    expect(body.delivery_readiness.active_lane).toBe('execution-owner');
  });
```

Add invalid lane validation:

```ts
await request(app.getHttpServer())
  .get(`/query/work-item-cockpit/${executionPackage.work_item_id}?lane=unknown`)
  .expect(400);
```

Add query-level degraded-source coverage by stubbing the same test repository instance used by the app so `listExecutionPackageDependencies` throws for the selected package:

```ts
vi.spyOn(repo, 'listExecutionPackageDependencies').mockRejectedValueOnce(new Error('dependency read failed'));

const degraded = await request(app.getHttpServer())
  .get(`/query/work-item-cockpit/${executionPackage.work_item_id}?lane=execution-owner`)
  .expect(200);
expect(degraded.body.delivery_readiness.degraded_sources).toContain('package_dependencies');
expect(degraded.body.delivery_readiness.stages.find((stage: { id: string }) => stage.id === 'integration_readiness')).toMatchObject({
  state: 'blocked',
});
```

Use the existing test setup style in `tests/api/query-module.test.ts`; the point is to prove the cockpit query returns a partial response with stable `degraded_sources` instead of failing the request or marking Integration Readiness ready.

Add a second query-level degraded-source case for package reads:

```ts
vi.spyOn(repo, 'listExecutionPackagesForWorkItem').mockRejectedValueOnce(new Error('package read failed'));

const degradedPackages = await request(app.getHttpServer())
  .get(`/query/work-item-cockpit/${executionPackage.work_item_id}?lane=execution-owner`)
  .expect(200);
expect(degradedPackages.body.delivery_readiness.degraded_sources).toContain('execution_packages');
expect(degradedPackages.body.delivery_readiness.stages.find((stage: { id: string }) => stage.id === 'packages')).toMatchObject({
  state: 'blocked',
});
```

In `tests/api/delivery-flow.test.ts`, update any Work Item cockpit assertions that still expect `completion_state` or top-level `next_actions`:

```ts
expect(cockpit.body.delivery_readiness).toMatchObject({
  work_item_id: workItem.id,
});
expect(cockpit.body).not.toHaveProperty('completion_state');
expect(cockpit.body).not.toHaveProperty('next_actions');
expect(cockpit.body.delivery_readiness.next_actions).toEqual(expect.any(Array));
```

- [ ] **Step 8: Run focused tests**

Run:

```bash
pnpm vitest run tests/db/work-item-delivery-readiness.test.ts tests/api/query-module.test.ts tests/api/delivery-flow.test.ts tests/api/product-lanes.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/db build
pnpm --filter @forgeloop/control-plane-api build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/queries/work-item-delivery-readiness.ts packages/db/src/queries/work-item-cockpit-queries.ts packages/db/src/queries/work-item-delivery-action-builders.ts packages/db/src/index.ts apps/control-plane-api/src/modules/query/query.controller.ts apps/control-plane-api/src/modules/query/query.service.ts apps/control-plane-api/src/modules/query/product-lane-query-parser.ts tests/db/work-item-delivery-readiness.test.ts tests/api/query-module.test.ts tests/api/delivery-flow.test.ts tests/api/product-lanes.test.ts
git rm packages/db/src/queries/work-item-action-queries.ts
git commit -m "feat: add work item delivery readiness read model"
```

---

### Task 7: Remove Public Work Item Actions API And Update Web API Hooks

**Files:**
- Modify: `packages/contracts/src/api.ts`
- Modify: `apps/web/src/shared/api/query.ts`
- Modify: `apps/web/src/shared/api/hooks.ts`
- Modify: `apps/web/src/shared/api/query-keys.ts`
- Modify: `apps/web/src/shared/api/types.ts`
- Modify: `apps/web/src/features/spec-plan/spec-plan-work-item-flow.tsx`
- Modify: `apps/web/src/features/work-items/work-item-detail.tsx`
- Modify: `apps/web/src/features/work-items/work-item-next-actions.tsx`
- Modify: `tests/web/fixtures/product-data.ts`
- Modify: `tests/web/fixtures/product-api-mock.ts`
- Test: `tests/contracts/product-actions.test.ts`
- Test: `tests/web/api.test.ts`
- Test: `tests/web/api-hooks.test.tsx`
- Test: `tests/web/work-item-product-route.test.tsx`
- Test: `tests/web/spec-plan-product-route.test.tsx`

- [ ] **Step 1: Write failing contract and Web hook tests**

In `tests/web/api-hooks.test.tsx`, also assert the no-lane key remains the backend-default query key:

```ts
expect(queryKeys.workItemCockpit('wi-1')).toEqual(['work-item-cockpit', 'wi-1']);
```

In `tests/web/api-hooks.test.tsx`, assert:

```ts
it('uses lane-aware Work Item cockpit cache keys', () => {
  expect(queryKeys.workItemCockpit('wi-1', 'execution-owner')).toEqual([
    'work-item-cockpit',
    'wi-1',
    { lane: 'execution-owner' },
  ]);
  expect(queryKeys.workItemCockpit('wi-1', 'reviewer')).not.toEqual(
    queryKeys.workItemCockpit('wi-1', 'execution-owner'),
  );
});

it('loads Work Item cockpit with active lane and no separate actions query', async () => {
  const fetchMock = installProductApiMock({
    [`GET /query/work-item-cockpit/${workItem.id}?lane=execution-owner`]: cockpitFixture,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const { result, unmount } = renderHook(() => useWorkItemCockpitQuery(workItem.id, 'execution-owner'), { wrapper });

  await waitFor(() => expect(result.current.isSuccess).toBe(true));

  expect(fetchMock).toHaveBeenCalledWith(
    `http://localhost:3000/query/work-item-cockpit/${workItem.id}?lane=execution-owner`,
    expect.objectContaining({ method: 'GET' }),
  );
  expect(fetchMock).not.toHaveBeenCalledWith(
    `http://localhost:3000/query/work-items/${workItem.id}/actions?lane=execution-owner`,
    expect.anything(),
  );

  unmount();
  queryClient.clear();
});
```

Use the existing `installProductApiMock`/`vi.stubGlobal('fetch', ...)` style already present in the file; do not introduce MSW or another mock stack.

Add a mutation/cache test that seeds at least two cached lane variants, runs an update/invalidation path used by command mutations, and proves both lane caches are updated or invalidated. The stale-cache failure to prevent is `manager` still rendering old actions after `execution-owner` was refreshed.

In `tests/web/api.test.ts`:

- Update the `getWorkItemCockpit` client test to call `getWorkItemCockpit('work item/1', { lane: 'execution-owner' })` and expect `/query/work-item-cockpit/work%20item%2F1?lane=execution-owner`.
- Remove the `getWorkItemActions('wi/1', { lane: 'bugs' })` call and the expected `/query/work-items/wi%2F1/actions?lane=bugs` fetch.
- Remove `getWorkItemActions` from the query API method surface expectation.
- Keep command API expectations unchanged.

In `tests/web/spec-plan-product-route.test.tsx`, update every inline `GET /query/work-item-cockpit/*` fixture:

- include a minimal valid `delivery_readiness`;
- remove top-level `next_actions`;
- assert the Spec/Plan flow still renders its Work Item planning content after strict parsing.

In `tests/web/work-item-product-route.test.tsx`, update the current Work Item detail route tests so the active page consumes cockpit actions directly:

- mock `GET /query/work-item-cockpit/wi-1?lane=requirements` and `?lane=reviewer` with strict responses containing `delivery_readiness.next_actions`;
- remove `GET /query/work-items/wi-1/actions?...` overrides;
- assert the expected action labels still render from `delivery_readiness.next_actions`;
- assert the old actions endpoint is not fetched:

```ts
expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
  expect.stringContaining('/query/work-items/wi-1/actions'),
  expect.anything(),
);
```

In `tests/contracts/product-actions.test.ts`, remove tests that validate `workItemActionsResponseSchema`; replace them with assertions that the contract module no longer exports `workItemActionsResponseSchema` or `WorkItemActionsResponse`.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm vitest run tests/contracts/product-actions.test.ts tests/web/api.test.ts tests/web/api-hooks.test.tsx tests/web/work-item-product-route.test.tsx tests/web/spec-plan-product-route.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because Web hooks, Work Item detail, and contract exports still expose the old Work Item actions surface.

- [ ] **Step 3: Remove shared contract and Web client APIs**

In `packages/contracts/src/api.ts`:

- Delete `workItemActionsResponseSchema`.
- Delete `WorkItemActionsResponse`.
- Delete any helper schema that exists only for the removed Work Item actions response.
- Keep `ProductAction` and command/target schemas; they are still used by `delivery_readiness.next_actions`.

In `apps/web/src/shared/api/query.ts`:

- Import `workItemCockpitResponseSchema`.
- Remove `workItemActionsResponseSchema`, `WorkItemActionsQuery`, and `WorkItemActionsResponse` imports.
- Delete `getWorkItemActions`.
- Change `getWorkItemCockpit` to accept an optional query object:

```ts
getWorkItemCockpit: async (workItemId: string, query: { lane?: ProductLaneId } = {}) =>
  workItemCockpitResponseSchema.parse(
    await request<unknown>(`/query/work-item-cockpit/${encodeURIComponent(workItemId)}${queryString(query)}`),
  ) as CockpitResponse,
```

In `apps/web/src/shared/api/hooks.ts`:

- Change `useWorkItemCockpitQuery(workItemId)` to accept an optional lane.
- Call `queryApi.getWorkItemCockpit(id, { lane })`.
- Remove `useWorkItemActionsQuery`.
- Remove invalidation of `['work-item-actions', objectId]`.
- Replace id-only Work Item cockpit updates with lane-aware policy:

```ts
queryClient.setQueriesData(
  { queryKey: ['work-item-cockpit', workItemId] },
  (current: CockpitResponse | undefined) => (current ? applyCockpitUpdate(current, update) : current),
);
```

Use `setQueriesData` or `invalidateQueries` with the `['work-item-cockpit', workItemId]` prefix when the active lane is unknown. If the caller knows the active lane, it may use `queryKeys.workItemCockpit(workItemId, lane)` for the exact query, but shared mutation helpers must not leave other lane variants stale.

In `apps/web/src/shared/api/query-keys.ts`, remove old Work Item actions key helpers if present and define:

```ts
workItemCockpit: (workItemId: string, lane?: ProductLaneId) =>
  lane === undefined ? ['work-item-cockpit', workItemId] : ['work-item-cockpit', workItemId, { lane }],
```

- [ ] **Step 4: Move current Work Item detail off the old actions hook**

In `apps/web/src/features/work-items/work-item-next-actions.tsx`:

- Remove `useWorkItemActionsQuery`.
- Convert the component into a pure presentational action list that receives `actions: ProductAction[]`, `activeLane`, and loading/error display props from its parent.
- Do not fetch `/query/work-items/:id/actions`.

In `apps/web/src/features/work-items/work-item-detail.tsx`:

- Parse the `lane` query param. If the URL has no valid lane, pass `undefined`; do not infer a Work Item kind default in Web before fetching.
- Call `useWorkItemCockpitQuery(workItemId, parsedLane)`.
- Render lane label/actions from `cockpit.delivery_readiness.active_lane`.
- Pass `cockpit.delivery_readiness.next_actions` into `WorkItemNextActions`.
- Preserve the existing non-cockpit summary layout in this task; the full visual replacement happens in Task 10.
- Do not import or call `useWorkItemActionsQuery`.

In `apps/web/src/features/spec-plan/spec-plan-work-item-flow.tsx`, keep the planning flow on the cockpit query, but pass a deterministic lane or no-lane default consistently with the backend query. Do not add a fallback parser for old top-level `next_actions`.

In `tests/web/fixtures/product-api-mock.ts` and `tests/web/spec-plan-product-route.test.tsx`, update every mocked Work Item cockpit response to the strict shared shape. The public action source is always `delivery_readiness.next_actions`.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm vitest run tests/contracts/product-actions.test.ts tests/web/api.test.ts tests/web/api-hooks.test.tsx tests/web/work-item-product-route.test.tsx tests/web/spec-plan-product-route.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/contracts build
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/api.ts apps/web/src/shared/api/query.ts apps/web/src/shared/api/hooks.ts apps/web/src/shared/api/query-keys.ts apps/web/src/shared/api/types.ts apps/web/src/features/spec-plan/spec-plan-work-item-flow.tsx apps/web/src/features/work-items/work-item-detail.tsx apps/web/src/features/work-items/work-item-next-actions.tsx tests/contracts/product-actions.test.ts tests/web/api.test.ts tests/web/api-hooks.test.tsx tests/web/work-item-product-route.test.tsx tests/web/spec-plan-product-route.test.tsx tests/web/fixtures/product-data.ts tests/web/fixtures/product-api-mock.ts
git commit -m "feat: remove separate work item action query"
```

---

### Task 8: Migrate Web Product Lane Routes From Workbench To Lanes

**Files:**
- Modify: `apps/web/src/app/routes.ts`
- Modify: `apps/web/src/app/routes/_layout.tsx`
- Create: `apps/web/src/app/routes/lanes/index.tsx`
- Create: `apps/web/src/app/routes/lanes/$laneId.tsx`
- Delete: `apps/web/src/app/routes/workbench/index.tsx`
- Delete: `apps/web/src/app/routes/workbench/$laneId.tsx`
- Modify or rename: `apps/web/src/features/product-lanes/product-lane-workbench.tsx`
- Modify: `apps/web/src/features/product-lanes/product-lanes.ts`
- Modify: `apps/web/src/features/pipeline/pipeline-route.tsx`
- Modify: `tests/web/fixtures/product-data.ts`
- Modify: `tests/web/router-test-utils.tsx`
- Test: `tests/web/app-shell-routing.test.tsx`
- Test: `tests/web/pipeline-product-route.test.tsx`
- Test: `tests/web/product-lanes-route.test.tsx`
- Test: `tests/web/responsive-layout.test.tsx`
- Test: `tests/web/a11y-gates.test.tsx`
- Test: `tests/web/dev-tools-gating.test.tsx`
- Delete or replace: `tests/web/workbench-product-route.test.tsx`
- Test: `tests/e2e/web-product-routes.e2e.test.ts`

- [ ] **Step 1: Write failing Web route tests**

Create `tests/web/product-lanes-route.test.tsx` by adapting `tests/web/workbench-product-route.test.tsx`:

- Replace `/workbench` with `/lanes`.
- Replace visible `Workbench` nav label expectations with `Lanes`.
- Add:

```ts
expect(screen.queryByText('Workbench')).not.toBeInTheDocument();
expect(container.innerHTML).not.toContain('/workbench');
```

In `tests/web/app-shell-routing.test.tsx`, assert `/lanes` is the nav route and `/workbench` is absent.

In `tests/web/pipeline-product-route.test.tsx`, add a representative unknown object or pipeline link assertion that the Pipeline route does not emit `/workbench` fallback links:

```ts
expect(document.body.innerHTML).not.toContain('/workbench');
```

In `tests/web/responsive-layout.test.tsx`, `tests/web/a11y-gates.test.tsx`, and `tests/web/dev-tools-gating.test.tsx`, replace `/workbench` route coverage with `/lanes` or `/lanes/requirements` coverage.

In `tests/e2e/web-product-routes.e2e.test.ts`, replace routes:

```ts
const routes = [
  '/lanes',
  '/lanes/requirements',
  // ...
];
```

- [ ] **Step 2: Run Web route tests and verify failure**

Run:

```bash
pnpm vitest run tests/web/app-shell-routing.test.tsx tests/web/product-lanes-route.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because the Web app still registers Workbench routes.

- [ ] **Step 3: Migrate route files**

Update `apps/web/src/app/routes.ts`:

```ts
index('./routes/lanes/index.tsx', { id: 'routes/lanes/_index' }),
route('lanes', './routes/lanes/index.tsx'),
route('lanes/:laneId', './routes/lanes/$laneId.tsx'),
```

Remove `workbench` route entries.

In `_layout.tsx`:

```ts
{ label: 'Lanes', to: '/lanes', activeOn: ['/', '/lanes'] },
```

Move route files from `workbench` to `lanes` and update internal links from `/workbench` to `/lanes`.

In `apps/web/src/features/product-lanes/product-lanes.ts`, rename `supportedWorkbenchSearchParams` to `supportedProductLaneSearchParams` and update imports. Do not keep a Workbench-named export.

In `apps/web/src/features/pipeline/pipeline-route.tsx`, replace the fallback route:

```ts
default:
  return '/lanes';
```

In `tests/web/fixtures/product-data.ts`, replace fixture ProductAction hrefs such as `/workbench/reviewer?...` with `/lanes/reviewer?...`.

Update `tests/web/router-test-utils.tsx`:

```ts
import ProductLaneIndexRoute from '../../apps/web/src/app/routes/lanes';
import ProductLaneRoute from '../../apps/web/src/app/routes/lanes/$laneId';
```

Replace route entries:

```ts
{ index: true, Component: ProductLaneIndexRoute },
{ path: 'lanes', Component: ProductLaneIndexRoute },
{ path: 'lanes/:laneId', Component: ProductLaneRoute },
```

Remove `workbench` route imports and route entries from the test stub.

- [ ] **Step 4: Rename the Product Lane route component**

Rename `apps/web/src/features/product-lanes/product-lane-workbench.tsx` to `apps/web/src/features/product-lanes/product-lane-route.tsx` and update imports. Do not leave active product code in a `workbench`-named file.

- [ ] **Step 5: Run Web route tests**

Run:

```bash
pnpm vitest run tests/web/app-shell-routing.test.tsx tests/web/pipeline-product-route.test.tsx tests/web/product-lanes-route.test.tsx tests/web/responsive-layout.test.tsx tests/web/a11y-gates.test.tsx tests/web/dev-tools-gating.test.tsx tests/web/no-legacy-web-ui.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/routes.ts apps/web/src/app/routes/_layout.tsx apps/web/src/app/routes/lanes apps/web/src/features/product-lanes apps/web/src/features/pipeline/pipeline-route.tsx tests/web/fixtures/product-data.ts tests/web/router-test-utils.tsx tests/web/app-shell-routing.test.tsx tests/web/pipeline-product-route.test.tsx tests/web/product-lanes-route.test.tsx tests/web/responsive-layout.test.tsx tests/web/a11y-gates.test.tsx tests/web/dev-tools-gating.test.tsx tests/web/no-legacy-web-ui.test.ts tests/e2e/web-product-routes.e2e.test.ts
git rm apps/web/src/app/routes/workbench/index.tsx apps/web/src/app/routes/workbench/'$laneId.tsx' tests/web/workbench-product-route.test.tsx
git commit -m "feat: migrate product lane routes"
```

---

### Task 9: Build Delivery Cockpit Presentational Components

**Files:**
- Create: `apps/web/src/features/work-items/delivery-cockpit/stage-rail.tsx`
- Create: `apps/web/src/features/work-items/delivery-cockpit/action-summary.tsx`
- Create: `apps/web/src/features/work-items/delivery-cockpit/action-rail.tsx`
- Create: `apps/web/src/features/work-items/delivery-cockpit/typed-brief.tsx`
- Create: `apps/web/src/features/work-items/delivery-cockpit/initiative-breakdown.tsx`
- Create: `apps/web/src/features/work-items/delivery-cockpit/package-matrix.tsx`
- Create: `apps/web/src/features/work-items/delivery-cockpit/execution-summary.tsx`
- Create: `apps/web/src/features/work-items/delivery-cockpit/review-summary.tsx`
- Create: `apps/web/src/features/work-items/delivery-cockpit/integration-readiness-panel.tsx`
- Create: `apps/web/src/features/work-items/delivery-cockpit/quality-gate-panel.tsx`
- Create: `apps/web/src/features/work-items/delivery-cockpit/release-readiness-panel.tsx`
- Create: `apps/web/src/features/work-items/delivery-cockpit/evidence-timeline.tsx`
- Create: `apps/web/src/features/work-items/delivery-cockpit/index.ts`
- Modify: `apps/web/src/features/work-items/work-item-view-model.ts`
- Test: `tests/web/work-item-delivery-cockpit.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `tests/web/work-item-delivery-cockpit.test.tsx`:

```tsx
it('renders all eight stages with keyboard anchor behavior', async () => {
  const user = userEvent.setup();
  render(
    <>
      <DeliveryStageRail stages={readinessFixture.stages} />
      {readinessFixture.stages.map((stage) => (
        <section key={stage.id} id={`delivery-stage-${stage.id}`} tabIndex={-1}>
          <h2>{stage.label}</h2>
        </section>
      ))}
    </>,
  );
  const execution = screen.getByRole('link', { name: /Execution passed/i });
  expect(execution).toHaveAttribute('href', '#delivery-stage-execution');
  execution.focus();
  await user.keyboard('{Enter}');
  expect(document.activeElement).toHaveAttribute('id', 'delivery-stage-execution');
  const qualityGate = screen.getByRole('link', { name: /Quality Gate/i });
  qualityGate.focus();
  await user.keyboard(' ');
  expect(document.activeElement).toHaveAttribute('id', 'delivery-stage-quality_gate');
});

it('renders mobile action summary data before the stage rail', () => {
  render(<DeliveryActionSummary readiness={readinessFixture} />);
  expect(screen.getByText(/Execution Owner/i)).toBeInTheDocument();
  expect(screen.getByText(/0 blockers/i)).toBeInTheDocument();
});

it('renders package mobile card hierarchy and hides empty blocker rows', () => {
  render(<PackageMatrix packages={[packageDisplayFixture({ blockingReason: undefined })]} />);
  expect(screen.getByText(/Owner/i).compareDocumentPosition(screen.getByText(/Latest run/i))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(screen.queryByText(/Blocking reason/i)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Open package/i })).toHaveAttribute('href', '/packages/pkg-1');
});

it('renders Initiative breakdown unavailable state without implying release readiness', () => {
  render(<InitiativeBreakdown aggregation={{ mode: 'unavailable', label: 'Child-work aggregation unavailable' }} />);
  expect(screen.getByText(/Initiative breakdown/i)).toBeInTheDocument();
  expect(screen.getByText(/Child-work aggregation unavailable/i)).toBeInTheDocument();
  expect(screen.queryByText(/Ready for release/i)).not.toBeInTheDocument();
});

it('hides mutating actions in the manager perspective even if the backend returns them', () => {
  render(
    <DeliveryActionRail
      activeLane="manager"
      actions={[
        {
          id: 'bad-command',
          lane_id: 'execution-owner',
          priority: 'primary',
          label: 'Run package',
          enabled: true,
          kind: 'command',
          command: { type: 'run_package', object_type: 'execution_package', object_id: 'pkg-1', work_item_id: 'wi-1', package_id: 'pkg-1' },
        },
        { id: 'open-package', lane_id: 'manager', priority: 'secondary', label: 'Open package', enabled: true, kind: 'navigate', target: { kind: 'object', object_type: 'execution_package', object_id: 'pkg-1', href: '/packages/pkg-1' } },
      ]}
    />,
  );
  expect(screen.queryByRole('button', { name: /Run package/i })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Open package/i })).toHaveAttribute('href', '/packages/pkg-1');
});
```

Use exported components and local fixtures.

- [ ] **Step 2: Run component tests and verify failure**

Run: `pnpm vitest run tests/web/work-item-delivery-cockpit.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because components do not exist.

- [ ] **Step 3: Implement components**

Component rules:

- Use existing design-system primitives: `Badge`, `StatusPill`, `Button`, `Skeleton`, `Section`, `ActionRail`.
- No cards inside cards.
- No gradients/orbs/hero layout.
- Status is text plus tone, never color-only.
- Stage targets use deterministic ids: `delivery-stage-${stage.id}`.
- Target sections accept `tabIndex={-1}` and focus on activation.
- Action Rail groups primary and secondary actions.
- Action Rail applies a frontend manager-perspective safeguard: when `activeLane === "manager"`, command/mutating actions are hidden or downgraded to non-mutating drill-down links when an object target is available, even if a bad response includes a command action from another lane.
- Mobile package cards use the hierarchy in the spec.
- `InitiativeBreakdown` renders child readiness summaries when provided and an explicit unavailable state when child aggregation is not available; it never converts an empty package list into ready/releasable messaging.

- [ ] **Step 4: Update view model**

In `work-item-view-model.ts`, map `WorkItemDeliveryReadiness` into display props:

- format labels;
- group actions by priority;
- sanitize manager-perspective display actions so mutating actions cannot be triggered from UI even if bad backend data slips through;
- produce package display rows from backend evidence/object refs where possible;
- pass through readiness state, blockers, and evidence without deriving pass/fail rules.

- [ ] **Step 5: Run component tests**

Run: `pnpm vitest run tests/web/work-item-delivery-cockpit.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/work-items/delivery-cockpit apps/web/src/features/work-items/work-item-view-model.ts tests/web/work-item-delivery-cockpit.test.tsx
git commit -m "feat: add delivery cockpit components"
```

---

### Task 10: Replace Work Item Detail With Typed Delivery Cockpit

**Files:**
- Modify: `apps/web/src/features/work-items/work-item-detail.tsx`
- Modify: `apps/web/src/features/work-items/work-item-next-actions.tsx`
- Modify: `tests/web/fixtures/product-data.ts`
- Modify: `tests/web/fixtures/product-api-mock.ts`
- Modify: `tests/web/work-item-product-route.test.tsx`
- Modify: `tests/web/spec-plan-product-route.test.tsx`
- Modify: `tests/web/review-release-product-routes.test.tsx`
- Test: `tests/e2e/web-product-routes.e2e.test.ts`

- [ ] **Step 1: Update fixtures with delivery readiness**

In `tests/web/fixtures/product-data.ts`, add `deliveryReadiness` with all eight stages and `next_actions`.

In `tests/web/fixtures/product-api-mock.ts`, update `GET /query/work-item-cockpit/wi-1` fixture to include `delivery_readiness` and remove top-level `next_actions`.

Before adding new cockpit variants, run `rg -n "GET /query/work-item-cockpit|next_actions|delivery_readiness" tests/web apps/web/src/features/spec-plan apps/web/src/features/work-items` and update every Work Item cockpit fixture found in route tests or MSW fixtures. Every mocked cockpit response must include `delivery_readiness`, and no mocked cockpit response may expose top-level `next_actions`.

Add fixtures for:

- an Initiative with no current packages and no child readiness evidence;
- `cockpitFixtureWithManagerCommandAction`, used only to prove the UI hardens a bad manager-perspective response containing a mutating command before rendering commands.
- a cockpit response with `delivery_readiness.degraded_sources = ['run_sessions']` and an Execution stage blocker.

- [ ] **Step 2: Write failing Work Item route tests**

In `tests/web/work-item-product-route.test.tsx`, assert:

```tsx
expect(screen.getByRole('heading', { name: /Delivery Cockpit/i })).toBeInTheDocument();
expect(screen.getByText('Integration Readiness')).toBeInTheDocument();
expect(screen.getByText('Quality Gate')).toBeInTheDocument();
expect(screen.getByText('Release Readiness')).toBeInTheDocument();
expect(screen.getByText(/Execution Owner/i)).toBeInTheDocument();
expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
  expect.stringContaining('/query/work-items/wi-1/actions'),
  expect.anything(),
);
```

Add kind-specific brief assertions for Requirement, Bug, Tech Debt, and Initiative fixtures.

Add an Initiative-without-packages route case:

```tsx
expect(screen.getByText(/Initiative breakdown/i)).toBeInTheDocument();
expect(screen.getByText(/Child-work aggregation unavailable/i)).toBeInTheDocument();
expect(screen.queryByText(/Ready for release/i)).not.toBeInTheDocument();
```

Add a manager-perspective hardening route case where the mocked cockpit response includes a valid mutating command action while the active lane is `manager`:

```tsx
await renderWorkItemRoute('/work-items/wi-1?lane=manager', {
  cockpit: cockpitFixtureWithManagerCommandAction,
});
expect(screen.queryByRole('button', { name: /Run package/i })).not.toBeInTheDocument();
expect(screen.getByRole('link', { name: /Open package/i })).toBeInTheDocument();
```

Add a degraded-source notice case:

```tsx
await renderWorkItemRoute('/work-items/wi-1?lane=execution-owner', {
  cockpit: cockpitFixtureWithDegradedRunSource,
});
expect(screen.getByText(/Delivery readiness degraded/i)).toBeInTheDocument();
expect(screen.getByText(/run_sessions/i)).toBeInTheDocument();
expect(screen.queryByText(/Ready for release/i)).not.toBeInTheDocument();
```

- [ ] **Step 3: Run route tests and verify failure**

Run: `pnpm vitest run tests/web/work-item-product-route.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because current page is still the generic summary and does not render the full Delivery Cockpit layout.

- [ ] **Step 4: Replace Work Item detail composition**

In `work-item-detail.tsx`:

- Parse active lane from the `lane` query param. If absent, pass `undefined` to `useWorkItemCockpitQuery`; the backend returns the resolved default in `delivery_readiness.active_lane`.
- Call `useWorkItemCockpitQuery(workItemId, parsedLane)`.
- Render lane labels and action sanitization from `delivery_readiness.active_lane`.
- Render skeletons for stage rail, action summary, and matrices while loading.
- Render Context Header, mobile Action Summary, Stage Rail, main sections, desktop Action Rail.
- Render a clear degraded-source notice when `delivery_readiness.degraded_sources` is non-empty; affected stages must not display ready/pass copy.
- Pass `delivery_readiness.next_actions` into the action components.
- Apply the same manager-perspective action sanitizer used by the Action Rail before rendering mobile Action Summary or desktop Action Rail.
- For `initiative` Work Items with no current packages, render an Initiative Breakdown section. If child readiness evidence is unavailable in this slice, show `Child-work aggregation unavailable` and do not display a releasable/ready summary from empty package data.
- Do not call `useWorkItemActionsQuery`.

In `work-item-next-actions.tsx`:

- Reuse the pure presentational component from Task 7, refine it to match the cockpit visual baseline, or delete it in favor of `delivery-cockpit/action-rail.tsx`.

- [ ] **Step 5: Run route tests**

Run:

```bash
pnpm vitest run tests/web/work-item-product-route.test.tsx tests/web/work-item-delivery-cockpit.test.tsx tests/web/spec-plan-product-route.test.tsx tests/web/review-release-product-routes.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/work-items/work-item-detail.tsx apps/web/src/features/work-items/work-item-next-actions.tsx tests/web/fixtures/product-data.ts tests/web/fixtures/product-api-mock.ts tests/web/work-item-product-route.test.tsx tests/web/spec-plan-product-route.test.tsx tests/web/review-release-product-routes.test.tsx
git commit -m "feat: replace work item detail with delivery cockpit"
```

---

### Task 11: Apply Delivery-Surface Visual Baseline To Linked Detail Pages

**Files:**
- Modify: `apps/web/src/app/routes/packages/$packageId.tsx`
- Modify: `apps/web/src/features/execution-packages/execution-package-routes.tsx`
- Modify: `apps/web/src/app/routes/runs/$runSessionId.tsx`
- Modify: `apps/web/src/features/run-console/run-console-routes.tsx`
- Modify: `apps/web/src/app/routes/reviews/$reviewPacketId.tsx`
- Modify: `apps/web/src/features/review-packets/review-packet-routes.tsx`
- Modify: `apps/web/src/app/routes/releases/$releaseId.tsx`
- Modify: `apps/web/src/features/releases/release-routes.tsx`
- Modify: `tests/web/package-run-product-routes.test.tsx`
- Modify: `tests/web/review-release-product-routes.test.tsx`

- [ ] **Step 1: Write failing visual baseline tests**

In `tests/web/package-run-product-routes.test.tsx`, add assertions for package and run detail pages:

```tsx
expect(screen.getByRole('heading', { name: /Package/i })).toBeInTheDocument();
expect(screen.getByRole('link', { name: /Open Work Item/i })).toBeInTheDocument();
expect(screen.queryByText(/Workbench/i)).not.toBeInTheDocument();
expect(container.querySelector('.card .card')).toBeNull();
```

In `tests/web/review-release-product-routes.test.tsx`, add equivalent review/release assertions:

- object header visible;
- primary action or clear terminal state near top;
- no Workbench text;
- no color-only status (assert status text exists);
- no nested card selector.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm vitest run tests/web/package-run-product-routes.test.tsx tests/web/review-release-product-routes.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL where pages still lack the baseline.

- [ ] **Step 3: Update detail pages**

For each linked page:

- Treat route wrapper files as wiring only. The actual page UI lives in:
  - `apps/web/src/features/execution-packages/execution-package-routes.tsx` for package detail;
  - `apps/web/src/features/run-console/run-console-routes.tsx` for run detail;
  - `apps/web/src/features/review-packets/review-packet-routes.tsx` for review detail;
  - `apps/web/src/features/releases/release-routes.tsx` for release detail.
- Use `PageHeader` with object title/state.
- Keep primary action or terminal state near top.
- Use `StatusPill` with visible text.
- Avoid nested cards.
- Ensure long IDs/log lines wrap or live in scroll-contained blocks that do not create document-level overflow.
- Remove any `/workbench` links or labels.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm vitest run tests/web/package-run-product-routes.test.tsx tests/web/review-release-product-routes.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/routes/packages/'$packageId.tsx' apps/web/src/features/execution-packages/execution-package-routes.tsx apps/web/src/app/routes/runs/'$runSessionId.tsx' apps/web/src/features/run-console/run-console-routes.tsx apps/web/src/app/routes/reviews/'$reviewPacketId.tsx' apps/web/src/features/review-packets/review-packet-routes.tsx apps/web/src/app/routes/releases/'$releaseId.tsx' apps/web/src/features/releases/release-routes.tsx tests/web/package-run-product-routes.test.tsx tests/web/review-release-product-routes.test.tsx
git commit -m "feat: polish linked delivery detail pages"
```

---

### Task 12: Add Browser-Level Viewport Verification

**Files:**
- Modify: `tests/e2e/web-product-routes.e2e.test.ts`
- Modify: `tests/web/fixtures/product-api-mock.ts`
- Modify: `tests/web/fixtures/product-data.ts`

- [ ] **Step 1: Write failing browser assertions**

In `tests/e2e/web-product-routes.e2e.test.ts`:

- Replace `/workbench` routes with `/lanes`.
- Add cockpit-specific assertions:

```ts
await page.goto(`${web.url}/work-items/${workItem.id}?lane=execution-owner`);
await expectPage(page.getByText('Delivery Cockpit')).toBeVisible();
await expectPage(page.getByText('Integration Readiness')).toBeVisible();
await expectPage(page.getByText('Execution Owner')).toBeVisible();
await expectPage(page.getByRole('link', { name: /Execution/i })).toBeVisible();
```

- Add stage focus behavior:

```ts
await page.getByRole('link', { name: /Quality Gate/i }).press('Enter');
await expectPage(page).toHaveURL(/#delivery-stage-quality_gate$/);
expect(await page.evaluate(() => document.activeElement?.id)).toBe('delivery-stage-quality_gate');
await page.getByRole('link', { name: /Release Readiness/i }).press('Space');
await expectPage(page).toHaveURL(/#delivery-stage-release_readiness$/);
expect(await page.evaluate(() => document.activeElement?.id)).toBe('delivery-stage-release_readiness');
```

- Add ordering check:

```ts
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${web.url}/work-items/${workItem.id}?lane=execution-owner`);
const summaryTop = await page.getByTestId('delivery-action-summary').evaluate((node) => node.getBoundingClientRect().top);
const railTop = await page.getByTestId('delivery-stage-rail').evaluate((node) => node.getBoundingClientRect().top);
expect(summaryTop).toBeLessThan(railTop);
```

- Keep overflow assertions for `/packages/:id`, `/runs/:id`, `/reviews/:id`, `/releases/:id`.
- Add `expect(await page.locator('body').innerText()).not.toContain('Workbench');`.

- [ ] **Step 2: Run browser test and verify failure**

Run: `pnpm vitest run tests/e2e/web-product-routes.e2e.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL until route migration and cockpit DOM/test ids are implemented.

- [ ] **Step 3: Add stable test ids only where they represent layout landmarks**

In cockpit components, add:

- `data-testid="delivery-action-summary"`
- `data-testid="delivery-stage-rail"`
- `data-testid="delivery-action-rail"`

Do not add test ids for content that can be selected by role/text.

- [ ] **Step 4: Run browser test**

Run: `pnpm vitest run tests/e2e/web-product-routes.e2e.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS and screenshots written under `test-results/web-product-routes`.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/web-product-routes.e2e.test.ts tests/web/fixtures/product-api-mock.ts tests/web/fixtures/product-data.ts apps/web/src/features/work-items/delivery-cockpit
git commit -m "test: add delivery cockpit viewport coverage"
```

---

### Task 13: Final Legacy Cleanup And Full Verification

**Files:**
- Modify only files required by failed verification.
- No new feature files unless verification exposes a real missing path.

- [ ] **Step 1: Run no-legacy scans**

Run:

```bash
active_product_files="$(rg --files apps/web/src apps/control-plane-api/src packages/contracts/src packages/db/src packages/domain/src | rg -v '(^apps/web/src/app/routes/workbench/|product-lane-workbench\\.tsx$)' || true)"
if [ -n "$active_product_files" ]; then
  active_matches="$(printf '%s\n' "$active_product_files" | xargs rg -n '/workbench|Workbench|work-item-actions|work-item-action-queries|WorkItemActions|workItemActions|workItemActionsResponseSchema|useWorkItemActionsQuery|getWorkItemActions|parseWorkItemActionsQuery|next_actions: string\\[\\]|Role Workbench|Work Item Owner' || true)"
  test -z "$active_matches" || { printf '%s\n' "$active_matches"; exit 1; }
fi

for legacy_file in \
  apps/web/src/app/routes/workbench/index.tsx \
  apps/web/src/app/routes/workbench/'$laneId.tsx' \
  apps/web/src/features/product-lanes/product-lane-workbench.tsx \
  tests/web/workbench-product-route.test.tsx
do
  test ! -e "$legacy_file" || { echo "legacy file remains: $legacy_file"; exit 1; }
done

changed_product_files="$(git diff --name-only origin/main...HEAD -- apps packages | rg '^(apps|packages)/' || true)"
if [ -n "$changed_product_files" ]; then
  old_priority_code="$(printf 'p%s|P%s' 0 0)"
  priority_matches="$(printf '%s\n' "$changed_product_files" | xargs rg -n "$old_priority_code" || true)"
  test -z "$priority_matches" || { printf '%s\n' "$priority_matches"; exit 1; }
fi

rg -n "GET /query/work-item-cockpit|next_actions|delivery_readiness" tests/web apps/web/src/features/spec-plan apps/web/src/features/work-items
```

Expected:

- Expected active product scan output is empty. The temporary exclusion for deleted `routes/workbench/*` and `product-lane-workbench.tsx` is only to allow the scan command to run before the `git rm` in the same task; those files must be gone by final status.
- No active product code refers to `/workbench` or `Workbench`, including Pipeline fallback links and ProductAction builders.
- No public Work Item actions query remains.
- `packages/contracts/src/api.ts` does not export `workItemActionsResponseSchema`, `WorkItemActionsResponse`, or any `WorkItemActions` public type.
- `packages/db/src/index.ts` does not export `work-item-action-queries`.
- Deleted Workbench route/component/test files do not exist on disk.
- Every mocked Work Item cockpit response under `tests/web` includes `delivery_readiness`.
- No mocked Work Item cockpit response exposes a top-level `next_actions`; action fixtures live under `delivery_readiness.next_actions`.
- No priority-code naming remains in changed `apps/` or `packages/` product surfaces.
- Do not chase unrelated pre-existing fixtures, generated screenshots, or guard tests outside active product code for Workbench cleanup.

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm vitest run \
  tests/contracts/product-actions.test.ts \
  tests/contracts/review-packet.test.ts \
  tests/contracts/work-item-delivery-readiness.test.ts \
  tests/domain/work-item-delivery-readiness.test.ts \
  tests/db/work-item-delivery-selection.test.ts \
  tests/db/work-item-release-readiness.test.ts \
  tests/db/work-item-delivery-readiness.test.ts \
  tests/api/query-module.test.ts \
  tests/api/delivery-flow.test.ts \
  tests/api/product-lanes.test.ts \
  tests/web/api.test.ts \
  tests/web/api-hooks.test.tsx \
  tests/web/product-lanes-route.test.tsx \
  tests/web/spec-plan-product-route.test.tsx \
  tests/web/work-item-delivery-cockpit.test.tsx \
  tests/web/work-item-product-route.test.tsx \
  tests/web/package-run-product-routes.test.tsx \
  tests/web/review-release-product-routes.test.tsx \
  tests/e2e/web-product-routes.e2e.test.ts \
  --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 3: Run package builds**

Run:

```bash
pnpm --filter @forgeloop/contracts build
pnpm --filter @forgeloop/domain build
pnpm --filter @forgeloop/db build
pnpm --filter @forgeloop/control-plane-api build
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 4: Run broader safety tests**

Run:

```bash
pnpm test
```

Expected: PASS. If this is too slow for the environment, run the affected package test set plus document exactly which broader command was not run and why.

- [ ] **Step 5: Final commit**

If verification required fixes, commit the actual fixed file list:

```bash
git add docs/superpowers/plans/2026-05-20-delivery-cockpit-readiness.md
git commit -m "fix: complete delivery cockpit verification"
```

Replace the `git add` path above with the implementation files that were actually fixed. If no fixes were needed, do not create an empty commit.

---

## Final Delivery Checklist

- [ ] `/work-items/:workItemId` returns and renders `delivery_readiness`.
- [ ] Work Item cockpit response has no top-level `next_actions`.
- [ ] Web fixtures and strict consumers parse Work Item cockpit data only through `delivery_readiness`, including Spec/Plan route tests.
- [ ] Work Item cockpit query cache keys include active lane and shared mutation helpers invalidate/update all lane variants when lane is unknown.
- [ ] When the URL omits `lane`, Web passes no lane, backend resolves the Work Item kind default, and UI renders from `delivery_readiness.active_lane`.
- [ ] `/query/work-items/:workItemId/actions` is gone.
- [ ] Product Lane actions use `/lanes/:laneId`, never `/workbench/:laneId`.
- [ ] Active Web product code has no `/workbench` fallback links, including Pipeline representative item fallbacks.
- [ ] Readiness is derived in backend query logic, not React.
- [ ] Spec/Plan strict approved revision checks are enforced.
- [ ] Current package set excludes stale/archived/deleted packages.
- [ ] Selected run/review precedence is deterministic.
- [ ] Shared Review Packet contract parses and persists `independent_ai_review` and `test_mapping`.
- [ ] Review cannot pass without self-review and independent AI Review evidence.
- [ ] Review cannot pass when the Review Packet is stale, unmapped to approved revisions, missing test mapping, or missing explicit risk notes.
- [ ] Quality Gate cannot pass with missing, failing, or unknown `required_test_gates`.
- [ ] Required test gates cannot pass from package metadata alone; they require matching run, review, or pre-release Test/Acceptance evidence.
- [ ] Execution is blocked by missing or failed selected-run required checks.
- [ ] Bug and Tech Debt backend applicability rules are tested, not only rendered as UI labels.
- [ ] Integration Readiness requires full dimension evidence when applicable.
- [ ] Integration Readiness correctly handles `running`, `failed`, and unknown statuses, including `unknown_integration_readiness_status`.
- [ ] Package dependencies are fetched by the Work Item cockpit query and make Integration Readiness required.
- [ ] Downstream read failures populate stable `delivery_readiness.degraded_sources` and block affected stages without failing the whole cockpit response.
- [ ] Release Readiness is pre-release only and excludes Observation blockers.
- [ ] Release Readiness consumes explicit release blockers, Release Test/Acceptance evidence, release evidence, decisions, and matching fingerprints.
- [ ] Responsibility lanes produce tested lane-aware next actions for Spec Approver, Execution Owner, Reviewer, QA/Test Owner, and Release Owner.
- [ ] Manager lane actions are read-only.
- [ ] Manager-perspective UI hides or downgrades mutating actions even if bad backend data slips through.
- [ ] Initiative Work Items without direct packages show child-work aggregation or an explicit unavailable state, never false releasable readiness from empty package data.
- [ ] Degraded readiness sources are visible in the cockpit and cannot render ready/pass copy for affected stages.
- [ ] Mobile/tablet Action Summary appears before the Stage Rail.
- [ ] Stage rail supports keyboard activation, hash/scroll, and focus movement.
- [ ] Package mobile cards follow the curated hierarchy and do not overflow.
- [ ] Linked package/run/review/release pages meet the visual clarity baseline.
- [ ] Focused tests, browser viewport tests, package builds, and legacy scans pass.
