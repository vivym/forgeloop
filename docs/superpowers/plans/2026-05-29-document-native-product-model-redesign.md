# Document-Native Product Model Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the public ForgeLoop product model around typed source documents, Development Plans, Plan Items, Superpowers Spec Docs, Implementation Plan Docs, and governed execution with no public legacy route, label, DTO, or fixture baggage.

**Architecture:** Treat document-native terminology as the public contract and isolate any remaining persistence/runtime `execution_plan` names behind explicit server-side adapters. The public path becomes `Requirement/Bug/Tech Debt/Initiative Document -> Development Plan -> Plan Item -> Brainstorming Session -> Spec Doc -> Implementation Plan Doc -> Execution Package -> Codex Run -> Review/QA/Release`, with Plan Item as the only public object that can enter Spec, Implementation Plan Doc, execution, review, QA, and release gates.

**Tech Stack:** React Router, React, TypeScript, TanStack Query, NestJS, Zod contracts, Drizzle schema, Vitest, Testing Library, existing ForgeMarkdownEditor/MDX document primitives.

---

## Authoritative Inputs

- Spec: `docs/superpowers/specs/2026-05-29-document-native-product-model-redesign-design.md`
- Alignment spec: `docs/superpowers/specs/2026-05-27-product-workspace-core-surface-redesign-design.md`
- PRD: `docs/PRD_v1.md`
- Existing product route contract: `apps/web/src/features/product-surfaces/route-contract.ts`
- Existing public route registry: `apps/web/src/app/routes.ts`

## Scope Boundaries

- This plan changes public product routes, public API endpoints used by Web, public DTOs consumed by Web, UI labels, fixtures, and tests.
- This plan must not add compatibility redirects, aliases, old route wrappers, feature flags, or "old/new" switches.
- Internal persistence tables may keep physical table names only when they are hidden behind adapter functions and never appear in public UI, public route contracts, Web DTOs, fixtures, or product tests.
- The checkbox steps inside an Implementation Plan Doc remain Markdown document content. This plan does not extract them into structured task records.
- Review, QA, and Release remain Plan Item lifecycle stages or top-level queues in this slice. They are not dedicated Plan Item child routes.

## File Structure Map

### Route And Navigation Contract

- Modify `apps/web/src/app/routes.ts`
  - Remove the public `brainstorming`, `execution-plan`, `review`, and `qa` Plan Item child route registrations.
  - Add the canonical `implementation-plan` Plan Item child route.
  - Replace old `/specs-plans` with top-level `/reviews` and `/qa` queues.
- Delete `apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/execution-plan.tsx`
- Delete `apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/brainstorming.tsx`
- Delete `apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/review.tsx`
- Delete `apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/qa.tsx`
- Create `apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/implementation-plan.tsx`
- Delete `apps/web/src/app/routes/specs-plans/index.tsx`
- Create `apps/web/src/app/routes/reviews/index.tsx`
- Create `apps/web/src/app/routes/qa/index.tsx`
- Modify `apps/web/src/features/product-surfaces/route-contract.ts`
  - Make `/development-plans/:id/items/:itemId/implementation-plan` canonical.
  - Remove Plan Item `/brainstorming`, `/review`, and `/qa` child routes from `canonicalProductRoutes`.
  - Reintroduce `/reviews` as the new document review queue route and remove it from retired raw review-packet semantics.
  - Add `/qa` as the top-level QA queue route.
  - Remove old `/brainstorming`, `/execution-plan`, `/review`, `/qa` Plan Item child paths and `/specs-plans` from both active and retired product route registries. Legacy path strings may exist only inside dedicated negative tests.
- Modify `apps/web/src/shared/navigation/product-navigation.ts`
  - Keep `Reviews`, `QA`, `Executions`, and Release queues aligned with the new route contract.
- Modify `tests/web/router-test-utils.tsx`
  - Register the new `implementation-plan` test route and remove the old child route wrappers.

### Public Web View Models And UI Surfaces

- Modify `apps/web/src/features/development-plans/development-plan-view-model.ts`
  - Rename public gate label from `Execution Plan` to `Implementation Plan Doc`.
  - Rename public projection fields to `implementation_plan_status` and `implementation_plan_docs`.
  - Do not read `execution_plan_status` in Web code, even as a fallback. Any unavoidable storage-name mapping must be private to the API/query serializer before data reaches Web DTOs.
- Modify `apps/web/src/features/development-plans/plan-item-gates.tsx`
  - Rename public gate id from `execution-plan` to `implementation-plan`.
  - Rename button, group, disabled reason, comparison, and status copy to `Implementation Plan Doc`.
  - Point gate hrefs at `/implementation-plan`.
- Modify `apps/web/src/features/development-plans/development-plan-item-detail-route.tsx`
  - Rename exported route component to `DevelopmentPlanItemImplementationPlanRoute`.
  - Change focus type from `execution-plan` to `implementation-plan`.
  - Render `Implementation Plan Doc` labels and Markdown document titles.
  - Remove direct dedicated `brainstorming`, `review`, and `qa` focus routes while keeping Boundary/Brainstorming, code review, and QA stage summaries inside the Plan Item workspace.
- Create: `apps/web/src/features/reviews/document-review-queue.tsx`
- Create: `apps/web/src/features/reviews/review-queue-view-model.ts`
- Create: `apps/web/src/features/reviews/reviews-route.tsx`
  - Move the active queue code into the `features/reviews` surface.
  - Use queue row type `implementation_plan_doc` for Implementation Plan Doc rows.
  - Use artifact labels, commands, defaults, tab fallback hrefs, and search text that say `Implementation Plan Doc`.
- Delete: `apps/web/src/features/spec-plan/spec-execution-plan-queue.tsx`
- Delete: `apps/web/src/features/spec-plan/spec-plan-view-model.ts`
- Delete: `apps/web/src/features/spec-plan/specs-plans-route.tsx`
  - Change tabs from `Specs` / `Execution Plans` to `Spec Docs` / `Implementation Plan Docs`.
  - Change query parameter from `tab=plans` to `tab=implementation-plans`.
- Create: `apps/web/src/features/qa/qa-route.tsx`
  - Show top-level QA queue/handoff readiness.
  - Do not expose a Plan Item child `/qa` route.
- Modify `apps/web/src/features/board`, `apps/web/src/features/cockpit`, `apps/web/src/features/executions`, `apps/web/src/features/releases`, and `apps/web/src/features/reports` files that still show product-facing `Execution Plan`
  - Use `Implementation Plan Doc` for product-facing document artifacts.
  - Keep `Execution Package` only in developer/runtime context panels.

### Source Document Workspaces

- Modify `apps/web/src/features/project-management/source-object-view-model.ts`
  - Rename public/test-facing concepts from "source object" to concrete typed document terminology.
  - Keep adapter names private if renaming the directory is too broad for this slice.
- Modify `apps/web/src/features/project-management/object-detail-layout.tsx`
  - Ensure Requirement/Bug/Tech Debt/Initiative detail pages are document-first.
  - Keep only Development Plan create/link actions on typed source document pages.
  - Remove or rename public "Source object" copy and the generic `/source-objects/...` command path.
- Modify `apps/web/src/features/project-management/typed-source-object-list.tsx`
  - Keep dense type-specific document tables.
  - Ensure every visible label uses `Requirement`, `Bug`, `Tech Debt`, or `Initiative`.
- Modify `apps/web/src/features/project-management/object-forms.tsx`
  - Keep MDX/Markdown body as primary content and image attachment affordances.
- Modify `apps/web/src/features/project-management/object-evidence-route.tsx`
  - Ensure evidence routes use concrete document labels.

### Public API And Contracts

- Modify `packages/contracts/src/ai-project-management.ts`
  - Replace public `execution_plan_status` with `implementation_plan_status`.
  - Replace public document/ref shapes exposed to Web with `implementation_plan_doc` and `implementation_plan_revision` names where the object is the Superpowers writing-plans output.
- Modify `packages/contracts/src/project-management.ts`
  - Add public `implementationPlanDocObjectRefSchema` and `implementationPlanRevisionObjectRefSchema`.
  - Keep old `execution_plan` refs only in internal/runtime schemas if they are not returned through product Web query DTOs.
- Modify `packages/contracts/src/product-object-ref.ts`
  - Add public Implementation Plan Doc ref variants.
  - Restrict Web editable refs to public names where used by ForgeMarkdownEditor.
- Modify `packages/contracts/src/markdown-document.ts`
  - Accept `/implementation-plan` as the public Plan Item document route segment.
  - Remove `/execution-plan` from public route validation; internal runtime validators must live outside this Web document route allow-list.
- Modify `apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts`
  - Replace public item document endpoints with `/implementation-plan/...`.
  - Replace revision read endpoint with `/implementation-plan-revisions/:implementationPlanRevisionId`.
  - Do not keep old `/execution-plan/...` or `/execution-plan-revisions/...` endpoints as aliases.
- Modify `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`
  - Keep storage calls private, but serialize public response names as Implementation Plan Doc.
  - Rename public methods used by controller to `generateItemImplementationPlanDraft`, `approveItemImplementationPlan`, and related names.
- Modify `apps/control-plane-api/src/modules/query/query.controller.ts`
  - Replace `/query/specs-execution-plans` with `/query/reviews`.
  - Do not keep the old query endpoint.
- Modify `packages/db/src/queries/project-management-queries.ts`
  - Serialize Web query projections with `implementation_plan_status`, `implementation_plan_docs`, and `implementation_plan_revision_ref`.
  - Keep any reads from storage `executionPlanStatus` in a private mapper.
- Modify `apps/web/src/shared/api/commands.ts`
  - Rename Web command methods to `getImplementationPlanRevision`, `generateItemImplementationPlanDraft`, `submitItemImplementationPlanForApproval`, `approveItemImplementationPlan`, `requestItemImplementationPlanChanges`, `rejectItemImplementationPlan`, `regenerateItemImplementationPlanDraft`, `saveItemImplementationPlanDraft`, and `compareItemImplementationPlanRevisions`.
  - Point all methods at `/implementation-plan` and `/implementation-plan-revisions`.
- Modify `apps/web/src/shared/api/query.ts`, `apps/web/src/shared/api/hooks.ts`, `apps/web/src/shared/api/query-keys.ts`, and `apps/web/src/shared/api/types.ts`
  - Rename the Web review query key and endpoint from spec/execution-plan wording to reviews.
  - Keep old internal string literals only in explicitly internal execution runtime types.

### Development Plan And Plan Item Invariants

- Modify `packages/contracts/src/ai-project-management.ts`
  - Change Plan Item public source association from singular `source_ref` to non-empty `source_refs`.
- Modify `packages/domain/src/development-plan.ts`
  - Add validation helpers for Plan Item parent/source invariants.
  - Rename public gate reason types from `ExecutionPlan...` to `ImplementationPlan...` where they leave the domain package.
- Modify `packages/db/src/schema/development-plan.ts`
  - Add persisted Development Plan Markdown body content.
  - Replace `development_plan_items.sourceRef` with `sourceRefs`; this branch owns the schema migration because the product is not launched and no-baggage is required.
- Modify `apps/control-plane-api/src/modules/development-plans/development-plans.controller.ts`
  - Accept and persist Development Plan Markdown body content.
  - Require `source_refs` when creating Plan Items.
- Modify `apps/control-plane-api/src/modules/development-plans/development-plans.service.ts`
  - Preserve Development Plan body content through create, generate-draft, regenerate, get, list, and revision snapshots.
  - Enforce: parent plan exists, item belongs to exactly one plan, item has at least one source ref, item source refs are a subset of parent `source_refs` unless the same command links the missing refs first.
  - Ensure every generated Spec Doc, Implementation Plan Doc, Execution, review, QA, and release link keeps both `developmentPlanId` and `planItemId`.

### Brainstorming Session As Plan Item Artifact

- Modify `apps/web/src/features/brainstorming/brainstorming-panel.tsx`
  - Show session status, question/answer log, accepted decisions, resume pointer, and generated Spec Doc link.
- Modify `packages/domain/src/brainstorming.ts`
  - Ensure public types expose Plan Item-owned artifact fields: `development_plan_id`, `development_plan_item_id`, `status`, `questions`, `answers`, `decisions`, `approved_summary_revision_id`, and generated Spec Doc link when present.
- Modify `apps/control-plane-api/src/modules/brainstorming/brainstorming.service.ts`
  - Return enough session data for the Plan Item workspace without requiring the UI to infer it from revisions.
- Modify `packages/db/src/schema/brainstorming.ts`
  - Keep existing Plan Item foreign keys and add explicit generated Spec Doc revision linkage.

### Execution Package And Codex Run Gate

- Modify `apps/control-plane-api/src/modules/executions/executions.service.ts`
  - Rename public-facing error messages, response refs, and evidence labels from Execution Plan to Implementation Plan Doc where they leave the service.
  - Keep internal execution package validation mandatory before a Codex run is enqueued.
  - Fail closed when approved Spec Doc revision, approved Implementation Plan Doc revision, current Plan Item revision, or runnable Execution Package boundary is missing or stale.
- Modify `apps/control-plane-api/src/modules/executions/executions.controller.ts`
  - Keep execution start only at `POST /development-plans/:developmentPlanId/items/:itemId/execution/start`.
  - Do not add source-document-level or Development-Plan-level execution start routes.
- Modify `apps/control-plane-api/src/modules/execution-packages/execution-package.service.ts`
  - Keep package materialization internal and Plan Item-owned.
  - Ensure package graph freshness checks reference approved Spec Doc and Implementation Plan Doc revisions.
- Test: `tests/api/executions.test.ts`
- Test helper: `tests/helpers/execution-supervision-fixtures.ts`
  - Lock the full `Execution Package -> Codex Run` gate and the no-direct-source/Development-Plan execution API matrix.
- Modify: `tests/helpers/execution-supervision-fixtures.ts`
  - Rename public fixture helpers and fixture fields from approved Execution Plan terminology to approved Implementation Plan Doc terminology while keeping internal storage adapters private.

### Fixtures, Test Helpers, And Guards

- Modify `tests/web/fixtures/product-data.ts`
  - Replace public `execution_plan_*` fields with `implementation_plan_*`.
  - Replace old route hrefs with `/implementation-plan`.
  - Keep realistic seeded density across Requirements, Bug, Tech Debt, Initiatives, Development Plans, Plan Items, active execution, review, QA, and release blockers.
- Modify `tests/web/fixtures/product-api-mock.ts`
  - Mock new API endpoint names and DTO fields.
- Modify `tests/web/product-grade-route-contract.test.tsx`
  - Lock canonical route list and screenshot route list.
  - Assert old child routes are retired or unregistered.
- Modify `tests/web/product-grade-first-viewport.test.tsx`
  - Replace `Execution Plan` public expectations with `Implementation Plan Doc`.
  - Assert `/brainstorming`, `/execution-plan`, `/review`, and `/qa` child routes are absent from first-viewport contract coverage.
- Modify `tests/web/development-plan-routes.test.tsx`
  - Cover `implementation-plan` route and Plan Item overview Review/QA stages.
  - Remove direct child route tests for `/brainstorming`, `/review`, and `/qa`.
- Modify `tests/web/spec-plan-lifecycle-actions.test.tsx`
  - Update command endpoints, buttons, and labels to Implementation Plan Doc.
- Modify `tests/web/product-workspace-shell-boundaries.test.tsx`, `tests/web/my-work-board-reports.test.tsx`, `tests/web/board-reports-release-readiness.test.tsx`, `tests/web/executions-routes.test.tsx`
  - Update public document artifact wording.
- Modify `tests/api/spec-plan-service.test.ts`, `tests/api/development-plans.test.ts`, `tests/api/project-management-query.test.ts`, `tests/api/brainstorming.test.ts`
  - Add API assertions for public endpoint/DTO reset and Plan Item invariants.
- Modify `tests/contracts/project-management-contracts.test.ts`, `tests/contracts/project-management-readiness.test.ts`
  - Lock public contract field names and public ref variants.
- Modify `tests/naming/delivery-naming.test.ts` and `tests/web/no-legacy-web-ui.test.ts`
  - Add document-native no-baggage guards for public files.

## Task 1: Lock The Public Route Contract

**Files:**
- Modify: `tests/web/product-grade-route-contract.test.tsx`
- Modify: `tests/web/router-test-utils.tsx`
- Modify: `tests/web/product-workspace-shell-boundaries.test.tsx`
- Modify: `apps/web/src/features/product-surfaces/route-contract.ts`
- Modify: `apps/web/src/app/routes.ts`
- Create: `apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/implementation-plan.tsx`
- Create: `apps/web/src/app/routes/reviews/index.tsx`
- Create: `apps/web/src/app/routes/qa/index.tsx`
- Delete: `apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/execution-plan.tsx`
- Delete: `apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/brainstorming.tsx`
- Delete: `apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/review.tsx`
- Delete: `apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/qa.tsx`
- Delete: `apps/web/src/app/routes/specs-plans/index.tsx`

- [ ] **Step 1: Write failing route contract expectations**

In `tests/web/product-grade-route-contract.test.tsx`, update the expected product route arrays so the only Plan Item child routes are:

```ts
'/development-plans/:id/items/:itemId/spec',
'/development-plans/:id/items/:itemId/implementation-plan',
'/development-plans/:id/items/:itemId/execution',
'/reviews',
'/qa',
```

Update `expectedConcreteScreenshotRoutes` to use:

```ts
`/development-plans/${developmentPlanId}/items/${implementationPlanItemId}/implementation-plan`
```

Add an assertion:

```ts
const retiredRoutePaths = retiredProductRoutes.map((route) => route.path);
expect(activeRoutePaths.join('\n')).not.toMatch(/specs-plans|brainstorming|execution-plan|\/items\/[^/]+\/review$|\/items\/[^/]+\/qa$/);
expect(retiredRoutePaths.join('\n')).not.toMatch(/specs-plans|brainstorming|execution-plan|\/items\/[^/]+\/review$|\/items\/[^/]+\/qa$/);
```

Keep legacy route strings out of `apps/web/src/features/product-surfaces/route-contract.ts`. If this test needs exact old path values, define them as a test-local negative route list and ensure they are not imported by route registration, screenshot registration, or navigation code.

- [ ] **Step 2: Run the route contract test and verify it fails**

Run: `pnpm test tests/web/product-grade-route-contract.test.tsx`

Expected: FAIL because active routes still include `/specs-plans`, `/brainstorming`, `/execution-plan`, Plan Item `/review`, and Plan Item `/qa`, and top-level `/reviews`, `/qa`, and `/implementation-plan` are not registered.

- [ ] **Step 3: Update the public route contract**

In `apps/web/src/features/product-surfaces/route-contract.ts`, replace the old route with:

```ts
productRoute(
  '/development-plans/:id/items/:itemId/implementation-plan',
  `/development-plans/${developmentPlanId}/items/${implementationPlanItemId}/implementation-plan`,
  'Implementation Plan Doc',
  'document-review',
  requirementsDatabaseItemHeading,
),
```

Remove the active `brainstorming`, `review`, and `qa` child route entries. Replace old `/specs-plans` with top-level `/reviews` and `/qa`. Move `/reviews` out of the retired route list and redefine it as the new document review queue, not the old raw review-packet route. Remove `/reviews/:id` unless a future spec introduces a concrete review detail route. Do not add `retiredRoute(...)` entries for `/specs-plans`, `/brainstorming`, `/execution-plan`, Plan Item `/review`, or Plan Item `/qa`; no legacy route registry should survive this slice.

- [ ] **Step 4: Update the React Router registry**

In `apps/web/src/app/routes.ts`, replace:

```ts
route('development-plans/:developmentPlanId/items/:itemId/execution-plan', './routes/development-plans/$developmentPlanId/items/$itemId/execution-plan.tsx'),
route('development-plans/:developmentPlanId/items/:itemId/brainstorming', './routes/development-plans/$developmentPlanId/items/$itemId/brainstorming.tsx'),
route('development-plans/:developmentPlanId/items/:itemId/review', './routes/development-plans/$developmentPlanId/items/$itemId/review.tsx'),
route('development-plans/:developmentPlanId/items/:itemId/qa', './routes/development-plans/$developmentPlanId/items/$itemId/qa.tsx'),
route('specs-plans', './routes/specs-plans/index.tsx'),
```

with:

```ts
route('development-plans/:developmentPlanId/items/:itemId/implementation-plan', './routes/development-plans/$developmentPlanId/items/$itemId/implementation-plan.tsx'),
route('reviews', './routes/reviews/index.tsx'),
route('qa', './routes/qa/index.tsx'),
```

- [ ] **Step 5: Replace route wrapper files**

Delete the old Plan Item `brainstorming.tsx`, `execution-plan.tsx`, `review.tsx`, and `qa.tsx` wrappers. Delete `routes/specs-plans/index.tsx`. Add `implementation-plan.tsx`:

```ts
import { DevelopmentPlanItemImplementationPlanRoute } from '../../../../../../features/development-plans/development-plan-item-detail-route';

export default DevelopmentPlanItemImplementationPlanRoute;
```

Add `routes/reviews/index.tsx`:

```ts
import { ReviewsRoute } from '../../../features/reviews/reviews-route';

export default ReviewsRoute;
```

Add `routes/qa/index.tsx`:

```ts
import { QaRoute } from '../../../features/qa/qa-route';

export default QaRoute;
```

- [ ] **Step 6: Update router test utilities**

In `tests/web/router-test-utils.tsx`, remove old child route imports and entries. Add the new `implementation-plan` route component.

- [ ] **Step 7: Run focused route tests**

Run:

```bash
pnpm test tests/web/product-grade-route-contract.test.tsx tests/web/product-workspace-shell-boundaries.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit route contract reset**

```bash
git add apps/web/src/app/routes.ts apps/web/src/app/routes/development-plans apps/web/src/app/routes/reviews apps/web/src/app/routes/qa apps/web/src/app/routes/specs-plans tests/web/product-grade-route-contract.test.tsx tests/web/router-test-utils.tsx tests/web/product-workspace-shell-boundaries.test.tsx apps/web/src/features/product-surfaces/route-contract.ts
git commit -m "feat: reset document-native plan item routes"
```

## Task 2: Rename Public Implementation Plan Doc UI And Web API Client

**Files:**
- Modify: `apps/web/src/features/development-plans/development-plan-view-model.ts`
- Modify: `apps/web/src/features/development-plans/plan-item-gates.tsx`
- Modify: `apps/web/src/features/development-plans/development-plan-item-detail-route.tsx`
- Create: `apps/web/src/features/reviews/review-queue-view-model.ts`
- Create: `apps/web/src/features/reviews/document-review-queue.tsx`
- Create: `apps/web/src/features/reviews/reviews-route.tsx`
- Delete: `apps/web/src/features/spec-plan/spec-plan-view-model.ts`
- Delete: `apps/web/src/features/spec-plan/spec-execution-plan-queue.tsx`
- Delete: `apps/web/src/features/spec-plan/specs-plans-route.tsx`
- Modify: `apps/web/src/features/spec-plan/spec-plan-lifecycle-actions.tsx`
- Modify: `apps/web/src/shared/api/commands.ts`
- Modify: `apps/web/src/shared/api/query.ts`
- Modify: `apps/web/src/shared/api/hooks.ts`
- Modify: `apps/web/src/shared/api/query-keys.ts`
- Modify: `apps/web/src/shared/api/types.ts`
- Test: `tests/web/development-plan-routes.test.tsx`
- Test: `tests/web/spec-plan-lifecycle-actions.test.tsx`
- Test: `tests/web/product-grade-first-viewport.test.tsx`
- Test: `tests/web/my-work-board-reports.test.tsx`
- Test: `tests/web/board-reports-release-readiness.test.tsx`
- Test: `tests/web/executions-routes.test.tsx`

- [ ] **Step 1: Write failing UI expectations**

Update `tests/web/development-plan-routes.test.tsx` so the document review route loop uses:

```ts
for (const focus of ['spec', 'implementation-plan'] as const) {
  const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/${focus}`);
  ...
  if (focus === 'spec') {
    expect(screen.getByRole('button', { name: /submit spec for review/i })).toBeTruthy();
  } else {
    expect(screen.getByRole('button', { name: /submit implementation plan doc for review/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /approve implementation plan doc/i })).toBeTruthy();
  }
}
```

Update all public expectations in focused Web tests from `Execution Plan` to `Implementation Plan Doc`.

- [ ] **Step 2: Run focused Web tests and verify they fail**

Run:

```bash
pnpm test tests/web/development-plan-routes.test.tsx tests/web/spec-plan-lifecycle-actions.test.tsx tests/web/product-grade-first-viewport.test.tsx
```

Expected: FAIL because existing UI still renders `Execution Plan` and calls `/execution-plan`.

- [ ] **Step 3: Rename Web command API methods and paths**

In `apps/web/src/shared/api/commands.ts`, replace `itemExecutionPlanPath(...)` with:

```ts
const itemImplementationPlanPath = (developmentPlanId: string, itemId: string, suffix: string) =>
  `/development-plans/${encodeURIComponent(developmentPlanId)}/items/${encodeURIComponent(itemId)}/implementation-plan/${suffix}`;
```

Rename public client types and methods:

```ts
export interface ImplementationPlanDocument { ... }
export interface ImplementationPlanRevision {
  id: string;
  implementation_plan_id: string;
  development_plan_item_id: string;
  based_on_spec_revision_id: string;
  revision_number: number;
  summary: string;
  content: string;
  attachment_refs?: AttachmentRef[];
  structured_document?: Record<string, unknown>;
  author_actor_id?: string;
  created_at?: string;
}
```

All item document methods should use `ImplementationPlan` in the method name and `/implementation-plan` in the path.

- [ ] **Step 4: Rename Plan Item gate model**

In `apps/web/src/features/development-plans/plan-item-gates.tsx`, change:

```ts
id: 'implementation-plan'
label: 'Implementation Plan Doc'
href('/implementation-plan')
```

Replace every visible action label:

```ts
Generate Implementation Plan Doc
Submit Implementation Plan Doc for review
Approve Implementation Plan Doc
Request Implementation Plan Doc changes
Reject Implementation Plan Doc
Regenerate Implementation Plan Doc
Compare Implementation Plan Doc revisions
```

Keep the state machine preconditions unchanged: approved Spec Doc and required QA/test strategy still gate Implementation Plan Doc generation.

- [ ] **Step 5: Rename Plan Item detail focus**

In `apps/web/src/features/development-plans/development-plan-item-detail-route.tsx`:

```ts
export function DevelopmentPlanItemImplementationPlanRoute() {
  return <DevelopmentPlanItemSurface focus="implementation-plan" />;
}
```

Update:

```ts
type DevelopmentPlanItemFocus = 'overview' | 'spec' | 'implementation-plan' | 'execution';
```

`pageFamilyForFocus`, `currentGateIdFor`, `ItemDocumentReviewSurface`, `documentRevisionFor`, `DocumentCommentSummary`, and `documentRevisionObjectRef` must all use `implementation-plan` as the public focus and `Implementation Plan Doc` as visible copy.

Move the old `brainstorming` focus behavior into the overview workspace: when the current gate is boundary work, `ActiveGateBody` should render `BrainstormingPanel` inside the Plan Item overview instead of requiring a `/brainstorming` child route.

- [ ] **Step 6: Rename view model fields at the Web boundary**

In `apps/web/src/features/development-plans/development-plan-view-model.ts`, replace the local projection contract and all public reads so Web only accepts `implementation_plan_status`:

```ts
interface DevelopmentPlanItemProjection {
  ...
  implementation_plan_status?: string;
  execution_status?: string;
  ...
}
```

Delete `execution_plan_status` from this Web projection instead of keeping a fallback. Public view models, table columns, artifact labels, blockers, next actions, and gate summaries must say `Implementation Plan Doc`. If storage still has `executionPlanStatus`, convert it in `packages/db/src/queries/project-management-queries.ts` before the response reaches Web.

- [ ] **Step 7: Move and rename the review queue surface**

Create `apps/web/src/features/reviews/review-queue-view-model.ts` from the active queue logic and use:

```ts
type QueueArtifactType = 'spec' | 'implementation_plan_doc';
```

Return `Implementation Plan Doc` from `artifactLabel(...)`. Change default commands to:

```ts
Generate Implementation Plan Doc
Review Implementation Plan Doc
Revise Implementation Plan Doc
Open Implementation Plan Doc gate
Regenerate Implementation Plan Doc
```

Create `apps/web/src/features/reviews/document-review-queue.tsx` from the active queue UI. Change the second tab to `Implementation Plan Docs`, route query parameter to `tab=implementation-plans`, and link the page from `/reviews`. Delete the old `apps/web/src/features/spec-plan/spec-execution-plan-queue.tsx`, `spec-plan-view-model.ts`, and `specs-plans-route.tsx` files after the new route is wired.

- [ ] **Step 8: Update adjacent public surfaces**

Replace product-facing `Execution Plan` copy in board, cockpit, execution, release, and reports tests and source files with `Implementation Plan Doc`. Do not rename `Execution Package` when the text is explicitly runtime/developer context.

- [ ] **Step 9: Run focused UI tests**

Run:

```bash
pnpm test tests/web/development-plan-routes.test.tsx tests/web/spec-plan-lifecycle-actions.test.tsx tests/web/my-work-board-reports.test.tsx tests/web/board-reports-release-readiness.test.tsx tests/web/executions-routes.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit UI terminology reset**

```bash
git add apps/web/src tests/web
git commit -m "feat: expose implementation plan docs in web UI"
```

## Task 3: Reset Public API Endpoints And Contracts

**Files:**
- Modify: `packages/contracts/src/ai-project-management.ts`
- Modify: `packages/contracts/src/project-management.ts`
- Modify: `packages/contracts/src/product-object-ref.ts`
- Modify: `packages/contracts/src/markdown-document.ts`
- Modify: `apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts`
- Modify: `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.controller.ts`
- Modify: `packages/db/src/queries/project-management-queries.ts`
- Test: `tests/api/spec-plan-service.test.ts`
- Test: `tests/api/project-management-query.test.ts`
- Test: `tests/contracts/project-management-contracts.test.ts`
- Test: `tests/contracts/project-management-readiness.test.ts`

- [ ] **Step 1: Write failing public contract tests**

In `tests/contracts/project-management-contracts.test.ts`, add assertions that public Plan Item contracts parse `implementation_plan_status` and reject `execution_plan_status`:

```ts
const parsed = developmentPlanItemSchema.parse({
  id: 'dpi-1',
  development_plan_id: 'dp-1',
  revision_id: 'rev-1',
  title: 'Governed item',
  summary: 'Item summary',
  responsible_role: 'developer',
  risk: 'medium',
  dependency_hints: [],
  affected_surfaces: ['apps/web'],
  boundary_status: 'approved',
  spec_status: 'approved',
  implementation_plan_status: 'draft',
  execution_status: 'not_started',
  review_status: 'missing',
  qa_handoff_status: 'missing',
  release_impact: 'none',
  next_action: 'Review Implementation Plan Doc',
  updated_at: '2026-05-29T00:00:00.000Z',
  source_refs: [{ type: 'requirement', id: 'req-1' }],
});
expect(parsed.implementation_plan_status).toBe('draft');
expect(() => developmentPlanItemSchema.parse({ ...parsed, execution_plan_status: 'draft' })).toThrow();
```

In `tests/api/spec-plan-service.test.ts`, add 404 expectations for old endpoints and success expectations for new endpoints:

```ts
await request(app.getHttpServer())
  .post(`/development-plans/${plan.id}/items/${item.id}/execution-plan/approve`)
  .send({ actor_id: executionActorReviewer })
  .expect(404);
```

- [ ] **Step 2: Run focused contract/API tests and verify they fail**

Run:

```bash
pnpm test tests/contracts/project-management-contracts.test.ts tests/api/spec-plan-service.test.ts tests/api/project-management-query.test.ts
```

Expected: FAIL because public schemas and controllers still expose `execution_plan`.

- [ ] **Step 3: Update public Zod contracts**

In `packages/contracts/src/ai-project-management.ts`, rename the public field:

```ts
implementation_plan_status: artifactReviewStatusSchema,
source_refs: z.array(sourceObjectRefSchema).min(1),
```

Remove `execution_plan_status` from the public `developmentPlanItemSchema`.

In `packages/contracts/src/product-object-ref.ts` and `packages/contracts/src/project-management.ts`, add public ref variants:

```ts
z.object({ type: z.literal('implementation_plan_doc'), id: nonEmpty, title: nonEmpty.optional() }).strict()
z.object({
  type: z.literal('implementation_plan_revision'),
  id: nonEmpty,
  implementation_plan_id: nonEmpty.optional(),
  title: nonEmpty.optional(),
}).strict()
```

- [ ] **Step 4: Update public Markdown route validation**

In `packages/contracts/src/markdown-document.ts`, replace the route segment allow-list:

```ts
['spec', 'implementation-plan', 'execution']
```

Do not keep `execution-plan` in the public route allow-list.

- [ ] **Step 5: Update public controller endpoints**

In `apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts`, rename endpoints:

```ts
@Get('implementation-plan-revisions/:implementationPlanRevisionId')
@Post('development-plans/:developmentPlanId/items/:itemId/implementation-plan/generate-draft')
@Post('development-plans/:developmentPlanId/items/:itemId/implementation-plan-revisions/generate')
@Post('development-plans/:developmentPlanId/items/:itemId/implementation-plan/submit-for-approval')
@Post('development-plans/:developmentPlanId/items/:itemId/implementation-plan/approve')
@Post('development-plans/:developmentPlanId/items/:itemId/implementation-plan/request-changes')
@Post('development-plans/:developmentPlanId/items/:itemId/implementation-plan/reject')
@Post('development-plans/:developmentPlanId/items/:itemId/implementation-plan/regenerate-draft')
@Patch('development-plans/:developmentPlanId/items/:itemId/implementation-plan/draft')
@Get('development-plans/:developmentPlanId/items/:itemId/implementation-plan/revisions/compare')
```

Remove the old controller methods instead of keeping aliases.

- [ ] **Step 6: Update service public method names and serializers**

In `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`, public methods called by the controller must use `ImplementationPlan` names. If the repository layer still uses execution-plan tables, isolate that in private helpers:

```ts
private implementationPlanRevisionFromStorage(revision: ExecutionPlanRevision): PublicImplementationPlanRevision {
  return {
    id: revision.id,
    implementation_plan_id: revision.execution_plan_id,
    development_plan_item_id: revision.development_plan_item_id,
    based_on_spec_revision_id: revision.based_on_spec_revision_id,
    revision_number: revision.revision_number,
    summary: revision.summary,
    content: revision.content,
    attachment_refs: revision.attachment_refs,
    structured_document: revision.structured_document,
    author_actor_id: revision.author_actor_id,
    created_at: revision.created_at,
  };
}
```

The adapter is private and must not leak old field names to API responses.

- [ ] **Step 7: Rename review query endpoint**

In `apps/control-plane-api/src/modules/query/query.controller.ts`, replace:

```ts
@Get('specs-execution-plans')
```

with:

```ts
@Get('reviews')
```

In `packages/db/src/queries/project-management-queries.ts`, serialize review queue rows with `artifact_type: 'implementation_plan_doc'` for Implementation Plan Doc rows.

- [ ] **Step 8: Run API and contract tests**

Run:

```bash
pnpm test tests/contracts/project-management-contracts.test.ts tests/contracts/project-management-readiness.test.ts tests/api/spec-plan-service.test.ts tests/api/project-management-query.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit public API contract reset**

```bash
git add packages/contracts apps/control-plane-api/src/modules/spec-plan apps/control-plane-api/src/modules/query packages/db/src/queries tests/contracts tests/api
git commit -m "feat: expose implementation plan doc contracts"
```

## Task 4: Make Development Plans Document-Backed And Enforce Plan Item Invariants

**Files:**
- Modify: `packages/domain/src/development-plan.ts`
- Modify: `packages/db/src/schema/development-plan.ts`
- Modify: `apps/control-plane-api/src/modules/development-plans/development-plans.controller.ts`
- Modify: `apps/control-plane-api/src/modules/development-plans/development-plans.service.ts`
- Modify: `packages/db/src/queries/project-management-queries.ts`
- Modify: `apps/web/src/shared/api/commands.ts`
- Modify: `apps/web/src/features/development-plans/development-plans-route.tsx`
- Modify: `apps/web/src/features/development-plans/development-plan-detail-route.tsx`
- Test: `tests/api/development-plans.test.ts`
- Test: `tests/api/project-management-query.test.ts`
- Test: `tests/web/development-plan-routes.test.tsx`
- Test: `tests/db/brainstorming-repository.test.ts`

- [ ] **Step 1: Write failing Development Plan document body tests**

In `tests/api/development-plans.test.ts`, add a test proving Development Plans persist Markdown body content through create and query:

```ts
it('persists Development Plan Markdown body content from create through query', async () => {
  const created = await request(app.getHttpServer())
    .post('/development-plans')
    .send({
      actor_id: 'actor-tech-lead',
      project_id: projectId,
      title: 'Document-backed plan',
      body_markdown: '# Strategy\n\nPlan the requirement before Plan Items enter Superpowers.',
      source_refs: [{ type: 'requirement', id: requirement.id, title: requirement.title }],
    })
    .expect(201);

  expect(created.body.body_markdown).toContain('# Strategy');

  const queried = await request(app.getHttpServer())
    .get(`/query/development-plans/${created.body.id}`)
    .expect(200);

  expect(queried.body.body_markdown).toContain('Plan the requirement before Plan Items enter Superpowers.');
});
```

In `tests/web/development-plan-routes.test.tsx`, assert the Development Plan detail has a document surface that is not confused with the Superpowers plan document:

```ts
expect(document.querySelector('[data-development-plan-document]')).toBeInstanceOf(HTMLElement);
expect(document.querySelector('[data-development-plan-document]')?.textContent).toMatch(/strategy|rationale|markdown/i);
expect(document.querySelector('[data-development-plan-document]')?.textContent).not.toMatch(/Implementation Plan Doc/i);
expect(document.querySelector('[data-plan-items-table][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
```

- [ ] **Step 2: Run document body tests and verify they fail**

Run:

```bash
pnpm test tests/api/development-plans.test.ts tests/web/development-plan-routes.test.tsx
```

Expected: FAIL because Development Plans currently expose title/status/source refs/items but no persisted Markdown body surface.

- [ ] **Step 3: Add Development Plan body fields to contracts, domain, and storage**

In `packages/contracts/src/ai-project-management.ts`, add this field to `developmentPlanSchema`:

```ts
body_markdown: z.string().default(''),
```

In `packages/domain/src/development-plan.ts`, ensure `DevelopmentPlan` and `DevelopmentPlanRevision` include:

```ts
body_markdown: string;
```

In `packages/db/src/schema/development-plan.ts`, add:

```ts
bodyMarkdown: text('body_markdown').notNull().default(''),
```

to `development_plans`, and add the matching `bodyMarkdown` column to `development_plan_revisions`.

- [ ] **Step 4: Persist and serialize Development Plan body content**

In `apps/control-plane-api/src/modules/development-plans/development-plans.controller.ts`, allow `body_markdown` on create/generate draft commands.

In `apps/control-plane-api/src/modules/development-plans/development-plans.service.ts`, persist `body_markdown` on create, generate draft, regenerate draft, revision creation, detail query, and list query. AI-assisted draft defaults should create a concise Markdown planning rationale such as:

```md
# Development strategy

## Source documents

## Delivery slices

## Risks and release considerations
```

- [ ] **Step 5: Render Development Plan as document plus table**

In `apps/web/src/features/development-plans/development-plan-detail-route.tsx`, render a first-class Development Plan document surface near the top of the workspace:

```tsx
<section data-development-plan-document="">
  <ForgeMarkdownEditor
    allowedBlocks={['paragraph', 'heading', 'bold', 'italic', 'list', 'link', 'image', 'table', 'code_block', 'inline_code']}
    mode="edit"
    objectRef={{ type: 'development_plan', id: plan.id }}
    value={plan.body_markdown}
  />
</section>
```

The Plan Item table remains the primary planning workspace (`data-plan-items-table` keeps `data-primary-work-surface`). The Development Plan document must be labeled `Development Plan`, never `Implementation Plan Doc`.

- [ ] **Step 6: Write failing Plan Item invariant tests**

In `tests/api/development-plans.test.ts`, add tests:

```ts
it('rejects Plan Items without source refs', async () => {
  await request(app.getHttpServer())
    .post(`/development-plans/${developmentPlan.id}/items`)
    .send({ ...validPlanItemBody, source_refs: [] })
    .expect(400);
});

it('rejects Plan Item source refs that are not linked to the parent Development Plan', async () => {
  await request(app.getHttpServer())
    .post(`/development-plans/${developmentPlan.id}/items`)
    .send({ ...validPlanItemBody, source_refs: [{ type: 'bug', id: 'bug-outside-plan' }] })
    .expect(409);
});
```

In `tests/api/project-management-query.test.ts`, assert Plan Item artifacts include both identifiers:

```ts
expect(response.body.items[0]).toMatchObject({
  development_plan_id: developmentPlan.id,
  source_refs: expect.arrayContaining([expect.objectContaining({ type: 'requirement' })]),
  specs: expect.arrayContaining([expect.objectContaining({ development_plan_id: developmentPlan.id, development_plan_item_id: item.id })]),
  implementation_plan_docs: expect.arrayContaining([expect.objectContaining({ development_plan_id: developmentPlan.id, development_plan_item_id: item.id })]),
});
```

- [ ] **Step 7: Run focused invariant tests and verify they fail**

Run:

```bash
pnpm test tests/api/development-plans.test.ts tests/api/project-management-query.test.ts
```

Expected: FAIL because Plan Item source refs are currently singular or not validated at the public boundary.

- [ ] **Step 8: Add domain validators**

In `packages/domain/src/development-plan.ts`, add:

```ts
export type PlanItemInvariantReason =
  | 'development_plan_missing'
  | 'plan_item_source_refs_missing'
  | 'plan_item_source_refs_not_subset';

export function validatePlanItemSourceRefs(input: {
  parentSourceRefs: readonly SourceObjectRef[];
  itemSourceRefs: readonly SourceObjectRef[];
}): GateResult<PlanItemInvariantReason> {
  if (input.itemSourceRefs.length === 0) return { ok: false, reason: 'plan_item_source_refs_missing' };
  const parentKeys = new Set(input.parentSourceRefs.map(sourceRefKey));
  const outsideParent = input.itemSourceRefs.some((ref) => !parentKeys.has(sourceRefKey(ref)));
  return outsideParent ? { ok: false, reason: 'plan_item_source_refs_not_subset' } : { ok: true };
}
```

- [ ] **Step 9: Update contracts and service input**

Update Plan Item create body to require:

```ts
source_refs: z.array(sourceObjectRefSchema).min(1)
```

In `apps/control-plane-api/src/modules/development-plans/development-plans.service.ts`, call `validatePlanItemSourceRefs(...)` before saving. Fail closed with `ConflictException` for subset violations.

- [ ] **Step 10: Update storage and mappers**

Update `packages/db/src/schema/development-plan.ts` so `development_plan_items` stores non-empty `sourceRefs`:

```ts
sourceRefs: jsonb('source_refs').$type<DevelopmentPlanItem['source_refs']>().notNull(),
```

No public DTO or fixture may expose `source_ref` for Plan Items after this task.

- [ ] **Step 11: Update Web item creation**

In `apps/web/src/features/development-plans/development-plan-detail-route.tsx`, require at least one typed source ref when adding a Plan Item. Pass `source_refs` to `createDevelopmentPlanItem(...)`.

- [ ] **Step 12: Run document body and invariant tests**

Run:

```bash
pnpm test tests/api/development-plans.test.ts tests/api/project-management-query.test.ts tests/contracts/project-management-contracts.test.ts tests/web/development-plan-routes.test.tsx
```

Expected: PASS.

- [ ] **Step 13: Commit document-backed planning and invariant enforcement**

```bash
git add packages/domain packages/db/src/schema/development-plan.ts apps/control-plane-api/src/modules/development-plans apps/web/src tests/api tests/contracts
git commit -m "feat: make development plans document backed"
```

## Task 5: Make Typed Source Documents Document-First And Gate-Safe

**Files:**
- Modify: `apps/web/src/features/project-management/object-detail-layout.tsx`
- Modify: `apps/web/src/features/project-management/typed-source-object-list.tsx`
- Modify: `apps/web/src/features/project-management/source-object-view-model.ts`
- Modify: `apps/web/src/features/project-management/object-forms.tsx`
- Modify: `apps/web/src/features/project-management/object-evidence-route.tsx`
- Modify: `apps/web/src/shared/api/commands.ts`
- Modify: `apps/control-plane-api/src/modules/development-plans/development-plans.controller.ts`
- Modify: `apps/control-plane-api/src/modules/development-plans/development-plans.service.ts`
- Test: `tests/web/project-management-routes.test.tsx`
- Test: `tests/web/product-grade-first-viewport.test.tsx`
- Test: `tests/api/project-management-query.test.ts`
- Test: `tests/api/spec-plan-service.test.ts`
- Test: `tests/api/development-plans.test.ts`
- Test: `tests/api/executions.test.ts`

- [ ] **Step 1: Write failing source document tests**

In `tests/web/project-management-routes.test.tsx`, assert each typed document detail page:

```ts
expect(document.querySelector('[data-document-surface][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
expect(screen.getByRole('button', { name: /create development plan/i })).toBeTruthy();
expect(screen.getByRole('button', { name: /generate development plan draft with ai/i })).toBeTruthy();
expect(screen.queryByRole('button', { name: /generate spec/i })).toBeNull();
expect(screen.queryByRole('button', { name: /generate implementation plan doc/i })).toBeNull();
expect(screen.queryByRole('button', { name: /^start execution$/i })).toBeNull();
expect(document.body.textContent).not.toMatch(/source object|source context|execution plan/i);
```

Add command API expectations that no Web command path includes `/source-objects/`.

In `tests/api/spec-plan-service.test.ts`, add fail-closed negative API tests proving every concrete typed source document cannot generate downstream documents directly:

```ts
const typedSourceDocs = [
  { basePath: 'requirements', id: requirement.id },
  { basePath: 'bugs', id: bug.id },
  { basePath: 'tech-debt', id: techDebt.id },
  { basePath: 'initiatives', id: initiative.id },
];

for (const doc of typedSourceDocs) {
  for (const suffix of ['spec/generate-draft', 'implementation-plan/generate-draft'] as const) {
    await request(app.getHttpServer())
      .post(`/${doc.basePath}/${doc.id}/${suffix}`)
      .send({ actor_id: 'actor-tech-lead' })
      .expect(404);
  }
}
```

In `tests/api/executions.test.ts`, add fail-closed negative API tests proving every concrete typed source document cannot start execution directly:

```ts
for (const doc of typedSourceDocs) {
  await request(app.getHttpServer())
    .post(`/${doc.basePath}/${doc.id}/execution/start`)
    .send({ actor_id: 'actor-developer' })
    .expect(404);
}
```

In `tests/api/development-plans.test.ts`, add fail-closed negative tests proving a Development Plan body cannot start downstream work directly:

```ts
await request(app.getHttpServer())
  .post(`/development-plans/${developmentPlan.id}/spec/generate-draft`)
  .send({ actor_id: 'actor-tech-lead' })
  .expect(404);

await request(app.getHttpServer())
  .post(`/development-plans/${developmentPlan.id}/implementation-plan/generate-draft`)
  .send({ actor_id: 'actor-tech-lead' })
  .expect(404);
```

In `tests/api/executions.test.ts`, also add a fail-closed negative test proving a Development Plan cannot start execution directly:

```ts
await request(app.getHttpServer())
  .post(`/development-plans/${developmentPlan.id}/execution/start`)
  .send({ actor_id: 'actor-developer' })
  .expect(404);
```

In `tests/api/executions.test.ts`, update the existing Plan Item execution tests from Execution Plan wording to Implementation Plan Doc wording and keep the full runtime gate explicit:

```ts
it('starts execution only from an approved Implementation Plan Doc revision, materializes an Execution Package, and enqueues a Codex Run', async () => {
  const { developmentPlan, item, specRevision, implementationPlanRevision } = await seedApprovedImplementationPlanDoc(app);

  const execution = (
    await request(app.getHttpServer())
      .post(`/development-plans/${developmentPlan.id}/items/${item.id}/execution/start`)
      .send({ actor_id: executionActorDeveloper })
      .expect(201)
  ).body;

  expect(execution).toMatchObject({
    development_plan_item_id: item.id,
    implementation_plan_revision_id: implementationPlanRevision.id,
    approved_spec_revision_id: specRevision.id,
    status: 'running',
    runtime_evidence_refs: expect.arrayContaining([
      expect.objectContaining({ type: 'execution_package' }),
      expect.objectContaining({ type: 'run_session' }),
    ]),
  });
});
```

Add or preserve negative tests for each required gate:

```ts
await expectStartExecutionToFail('approved_spec_revision_missing');
await expectStartExecutionToFail('approved_implementation_plan_revision_missing');
await expectStartExecutionToFail('approved_implementation_plan_not_current_item_revision');
await expectStartExecutionToFail('execution_package_boundary_missing');
await expectStartExecutionToFail('stale_execution_package_revision');
```

These tests must prove the Codex run is not enqueued unless approved Spec Doc revision, approved Implementation Plan Doc revision, current Plan Item revision, and runnable Execution Package boundary all exist.

- [ ] **Step 2: Run focused source document tests and verify they fail**

Run:

```bash
pnpm test tests/web/project-management-routes.test.tsx tests/web/product-grade-first-viewport.test.tsx tests/api/spec-plan-service.test.ts tests/api/development-plans.test.ts tests/api/executions.test.ts
```

Expected: FAIL on remaining generic source-object wording, old downstream artifact copy, and any forbidden direct API mutation that is still accidentally routable.

The fail-closed matrix must cover all four source document types (`requirements`, `bugs`, `tech-debt`, `initiatives`) against all three forbidden downstream mutations (`spec/generate-draft`, `implementation-plan/generate-draft`, `execution/start`).

- [ ] **Step 3: Replace generic source-object Web command path**

In `apps/web/src/shared/api/commands.ts`, replace `linkSourceObjectToDevelopmentPlan(...)` with concrete helpers:

```ts
linkRequirementToDevelopmentPlan(requirementId, developmentPlanId, body)
linkBugToDevelopmentPlan(bugId, developmentPlanId, body)
linkTechDebtToDevelopmentPlan(techDebtId, developmentPlanId, body)
linkInitiativeToDevelopmentPlan(initiativeId, developmentPlanId, body)
```

Paths should be:

```text
/requirements/:requirementId/development-plans/:developmentPlanId/link
/bugs/:bugId/development-plans/:developmentPlanId/link
/tech-debt/:techDebtId/development-plans/:developmentPlanId/link
/initiatives/:initiativeId/development-plans/:developmentPlanId/link
```

Do not keep `/source-objects/...` in Web commands.

- [ ] **Step 4: Update source document detail actions**

In `object-detail-layout.tsx`, switch by `detail.ref.type` and call the matching concrete link helper. Change the downstream gate notice to:

```tsx
<InlineNotice
  description="Spec Docs, Implementation Plan Docs, and execution start only from a selected Plan Item after brainstorming and document approvals."
  title="Plan Item gated workflow"
  tone="neutral"
/>
```

- [ ] **Step 5: Tighten typed source list and detail copy**

In `typed-source-object-list.tsx` and `source-object-view-model.ts`, keep visible labels concrete:

```ts
Requirement Driver
Bug Driver
Tech Debt Driver
Initiative Driver
Planning coverage
Plan Item coverage
```

Avoid public strings `source object`, `source context`, `source intent`, and generic `owner`.

- [ ] **Step 6: Add concrete backend link endpoints**

In `apps/control-plane-api/src/modules/development-plans/development-plans.controller.ts`, add concrete link endpoints that call the same service with concrete source refs. Remove the generic `/source-objects/...` route.

- [ ] **Step 7: Assert forbidden direct mutations fail closed at the API layer**

In `apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts`, do not add any typed source document document-generation route. The tests from Step 1 should pass by returning 404 for direct typed source to Spec Doc or Implementation Plan Doc generation.

In `apps/control-plane-api/src/modules/development-plans/development-plans.controller.ts`, do not add Development Plan-level Spec Doc, Implementation Plan Doc, or execution routes. Only Plan Item routes under `/development-plans/:developmentPlanId/items/:itemId/...` may call those services.

In `apps/control-plane-api/src/modules/executions/executions.service.ts`, keep the existing Plan Item execution preconditions, rename public-facing `execution_plan_*` response fields and error messages to `implementation_plan_*`, and keep Execution Package graph validation before `runControlService.enqueueRunWithRepository(...)`. Add controller-level tests so there is no `/development-plans/:developmentPlanId/execution/start`, no `/requirements/:id/execution/start`, no `/bugs/:id/execution/start`, no `/tech-debt/:id/execution/start`, and no `/initiatives/:id/execution/start` route.

- [ ] **Step 8: Run focused source tests**

Run:

```bash
pnpm test tests/web/project-management-routes.test.tsx tests/api/project-management-query.test.ts tests/web/product-grade-first-viewport.test.tsx tests/api/spec-plan-service.test.ts tests/api/development-plans.test.ts tests/api/executions.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit source document reset**

```bash
git add apps/web/src/features/project-management apps/web/src/shared/api/commands.ts apps/control-plane-api/src/modules/development-plans tests/web tests/api
git commit -m "feat: make source documents document first"
```

## Task 6: Expose Brainstorming Session As The Plan Item Boundary Artifact

**Files:**
- Modify: `apps/web/src/features/brainstorming/brainstorming-panel.tsx`
- Modify: `apps/web/src/features/development-plans/development-plan-item-detail-route.tsx`
- Modify: `packages/domain/src/brainstorming.ts`
- Modify: `packages/db/src/schema/brainstorming.ts`
- Modify: `apps/control-plane-api/src/modules/brainstorming/brainstorming.service.ts`
- Modify: `packages/db/src/queries/project-management-queries.ts`
- Test: `tests/api/brainstorming.test.ts`
- Test: `tests/db/brainstorming-repository.test.ts`
- Test: `tests/web/development-plan-routes.test.tsx`

- [ ] **Step 1: Write failing brainstorming artifact tests**

In `tests/web/development-plan-routes.test.tsx`, assert the Plan Item overview shows the Boundary/Brainstorming artifact when boundary work is current:

```ts
expect(document.querySelector('[data-brainstorming-session-artifact]')).toBeInstanceOf(HTMLElement);
expect(document.querySelector('[data-brainstorming-session-artifact]')?.textContent).toMatch(/session status|questions|answers|decisions|resume/i);
expect(document.querySelector('[data-brainstorming-session-artifact]')?.textContent).toMatch(/Spec Doc/i);
```

In `tests/api/brainstorming.test.ts`, assert returned session data includes `development_plan_id`, `development_plan_item_id`, questions, answers, decisions, summary revision ids, and generated Spec Doc link when available.

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
pnpm test tests/api/brainstorming.test.ts tests/web/development-plan-routes.test.tsx
```

Expected: FAIL because the Web panel currently shows only a thin session summary.

- [ ] **Step 3: Extend public brainstorming session projection**

In `packages/domain/src/brainstorming.ts` and `apps/control-plane-api/src/modules/brainstorming/brainstorming.service.ts`, ensure the public response has:

```ts
{
  id,
  development_plan_id,
  development_plan_item_id,
  status,
  questions,
  answers,
  decisions,
  current_round_id,
  latest_summary_revision_id,
  approved_summary_revision_id,
  resume_pointer,
  generated_spec_revision_ref
}
```

- [ ] **Step 4: Render artifact details in the Plan Item workspace**

In `brainstorming-panel.tsx`, wrap the session artifact in:

```tsx
<section data-brainstorming-session-artifact="">
```

Show compact sections for Session, Questions, Answers, Decisions, Boundary Summary, Resume, and Generated Spec Doc. Use existing `Button`, `StatusPill`, and `InlineNotice` components.

- [ ] **Step 5: Ensure generated Spec links use Plan Item routes**

When a Spec Doc link exists, the href must be:

```ts
`/development-plans/${developmentPlanId}/items/${itemId}/spec`
```

No source document page should link directly to Spec generation.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm test tests/api/brainstorming.test.ts tests/db/brainstorming-repository.test.ts tests/web/development-plan-routes.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit brainstorming artifact surface**

```bash
git add apps/web/src/features/brainstorming apps/web/src/features/development-plans packages/domain/src/brainstorming.ts packages/db/src/schema/brainstorming.ts apps/control-plane-api/src/modules/brainstorming packages/db/src/queries tests/api tests/db tests/web
git commit -m "feat: expose brainstorming as plan item artifact"
```

## Task 7: Update Fixtures, Naming Guards, And Visual Acceptance

**Files:**
- Modify: `tests/web/fixtures/product-data.ts`
- Modify: `tests/web/fixtures/product-api-mock.ts`
- Modify: `tests/naming/delivery-naming.test.ts`
- Modify: `tests/web/no-legacy-web-ui.test.ts`
- Modify: `tests/e2e/ai-native-project-management-visual.e2e.test.ts`
- Modify: `scripts/product-review-preview.ts` if it hard-codes routes.

- [ ] **Step 1: Write failing no-baggage guards**

In `tests/web/no-legacy-web-ui.test.ts`, add public Web scans:

```ts
const activeProductAndFixtureText = () =>
  textFiles('apps/web')
    .filter((file) => !file.includes('/features/dev-tools/') && !file.includes('/routes/dev-tools/'))
    .concat(textFiles('tests/web/fixtures'), textFiles('tests/e2e'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

expect(activeWebSourceText()).not.toMatch(/execution-plan|Execution Plan|execution_plan_status|source object|source-objects/i);
expect(activeProductAndFixtureText()).not.toMatch(/\/development-plans\/[^"']+\/items\/[^"']+\/(?:brainstorming|execution-plan|review|qa)/);
```

Allow `Execution Package` only in runtime/developer context:

```ts
expect(activeWebSourceText()).not.toMatch(/Execution Package Browser|raw Execution Package/i);
```

In `tests/naming/delivery-naming.test.ts`, add a product-surface guard that ignores internal DB schema files but scans `apps/web`, `tests/web`, `packages/contracts`, and API controller route strings.
Dedicated negative assertion files such as `tests/web/product-grade-route-contract.test.tsx`, `tests/web/no-legacy-web-ui.test.ts`, and API 404 tests may contain legacy literals only inside explicit rejection assertions; do not exclude fixtures, route registrations, navigation, API clients, public contracts, or controller route decorators.

- [ ] **Step 2: Run naming guards and verify they fail**

Run:

```bash
pnpm test tests/web/no-legacy-web-ui.test.ts tests/naming/delivery-naming.test.ts
```

Expected: FAIL until fixtures, tests, route strings, and public contracts are fully migrated.

- [ ] **Step 3: Update seeded preview data**

In `tests/web/fixtures/product-data.ts`:

- Rename `executionPlan` export to `implementationPlanDoc`.
- Rename public DTO fields to `implementation_plan_status` and `implementation_plan_docs`.
- Change hrefs to `/implementation-plan`.
- Keep at least:
  - four Requirements;
  - one Bug;
  - one Tech Debt item;
  - one Initiative;
  - two Development Plans;
  - eight or more Plan Items across different workflow states;
  - active/resumable execution;
  - code review changes requested;
  - QA pending and blocked;
  - release readiness blockers.

- [ ] **Step 4: Update API mocks and screenshot routes**

In `tests/web/fixtures/product-api-mock.ts`, update mocked endpoints:

```text
GET /query/reviews
GET /implementation-plan-revisions/:id
POST /development-plans/:developmentPlanId/items/:itemId/implementation-plan/...
PATCH /development-plans/:developmentPlanId/items/:itemId/implementation-plan/draft
```

In `tests/e2e/ai-native-project-management-visual.e2e.test.ts`, ensure screenshot routes come from the updated `requiredScreenshotRoutes`.

- [ ] **Step 5: Run full public Web test set**

Run:

```bash
pnpm test tests/web/product-grade-route-contract.test.tsx tests/web/product-grade-first-viewport.test.tsx tests/web/development-plan-routes.test.tsx tests/web/project-management-routes.test.tsx tests/web/spec-plan-lifecycle-actions.test.tsx tests/web/my-work-board-reports.test.tsx tests/web/board-reports-release-readiness.test.tsx tests/web/executions-routes.test.tsx tests/web/no-legacy-web-ui.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run naming guard**

Run:

```bash
pnpm test tests/naming/delivery-naming.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit fixtures and guards**

```bash
git add tests/web tests/e2e tests/naming scripts
git commit -m "test: lock document-native product model"
```

## Task 8: Final Verification And Branch Readiness

**Files:**
- All files changed in Tasks 1-7.

- [ ] **Step 1: Run contract/API focused suite**

Run:

```bash
pnpm test tests/contracts/project-management-contracts.test.ts tests/contracts/project-management-readiness.test.ts tests/api/spec-plan-service.test.ts tests/api/development-plans.test.ts tests/api/project-management-query.test.ts tests/api/brainstorming.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run Web focused suite**

Run:

```bash
pnpm test tests/web/product-grade-route-contract.test.tsx tests/web/product-grade-first-viewport.test.tsx tests/web/development-plan-routes.test.tsx tests/web/project-management-routes.test.tsx tests/web/spec-plan-lifecycle-actions.test.tsx tests/web/my-work-board-reports.test.tsx tests/web/board-reports-release-readiness.test.tsx tests/web/executions-routes.test.tsx tests/web/no-legacy-web-ui.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run naming guard**

Run:

```bash
pnpm test tests/naming/delivery-naming.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 5: Run build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 6: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output and exit 0.

- [ ] **Step 7: Optional visual preview**

Run:

```bash
pnpm preview:product-review
```

Expected: app starts with updated routes. Manually inspect:

- `/requirements`
- `/requirements/req-product-workspace-clarity`
- `/development-plans/dp-product-workspace-core-surface-redesign`
- `/development-plans/dp-product-workspace-core-surface-redesign/items/dpi-plan-item-gate-eligibility`
- `/development-plans/dp-product-workspace-core-surface-redesign/items/dpi-requirements-database-view/implementation-plan`
- `/reviews?tab=implementation-plans`
- `/executions`

The first viewport must show real work content and must not show `Execution Plan`, `/execution-plan`, `source object`, `Work Item Owner`, generic `Task`, raw package/run browsers, or direct source document to Spec/Implementation Plan Doc/execution actions.

- [ ] **Step 8: Final commit if verification changes were needed**

```bash
git status --short
git add <remaining changed files>
git commit -m "chore: verify document-native product model"
```

Only make this commit if verification required additional changes after Task 7.
