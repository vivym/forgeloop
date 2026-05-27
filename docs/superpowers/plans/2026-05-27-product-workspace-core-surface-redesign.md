# Product Workspace Core Surface Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild ForgeLoop Web's core product surfaces into a polished AI-native delivery workspace with typed source workspaces, Development Plans, Plan Item gate workspaces, role-aware attention, and screenshot-verifiable product density.

**Architecture:** Implement from contracts and route guardrails inward: expand typed source projections and seeded product data first, then replace generic page composition with page-family shells, then migrate Cockpit, typed source workspaces, Development Plans, and Plan Item gates. No compatibility shell, no old/new toggle, no public generic Work Item Owner/source-object fallback, and no direct typed source object to Spec/Execution Plan/execution path.

**Tech Stack:** React Router, React, TypeScript, Tailwind CSS, Zod contracts, Nest/control-plane query API, in-memory delivery repository fixtures, Vitest, Testing Library, Playwright, MDXEditor-backed Markdown editing.

---

## Spec And Non-Negotiable Guardrails

Spec: `docs/superpowers/specs/2026-05-27-product-workspace-core-surface-redesign-design.md`

Hard requirements:

- Product-facing object families are `Initiative`, `Requirement`, `Bug`, and `Tech Debt`; public UI must not collapse them into a generic Work Item surface.
- The product flow stays `Typed Source Object -> Development Plan -> Plan Item -> Brainstorming -> Spec -> Execution Plan -> Codex Execution -> Code Review -> QA -> Release`.
- There is no direct Requirement/Bug/Tech Debt/Initiative to Spec, Execution Plan, or execution action.
- `Development Plan` is the planning bridge. `Plan Item` is the governed delivery unit. `Execution Package` remains internal runtime authority and must not become primary navigation or a raw object browser.
- Execution actions are disabled unless the Plan Item has an approved Boundary Summary, approved Spec revision, approved Execution Plan revision, required QA/test-strategy participation, and a runnable internal Execution Package boundary.
- QA/Test Owner participation and test strategy visibility are required in Spec review before Execution Plan generation for medium/high/critical/release-impact/cross-surface Plan Items.
- Role lens must reuse or extend the existing actor-filter model: `driver_actor_id`, `execution_owner_actor_id`, `reviewer_actor_id`, `qa_owner_actor_id`, `release_owner_actor_id`.
- `requiredScreenshotRoutes` must remain exactly aligned to `canonicalProductRoutes`, including typed source index/new/detail/evidence routes and every Plan Item gate route.
- Core page routes must use page-specific shells with stable DOM markers:
  - `data-product-shell="cockpit-command-center"`
  - `data-product-shell="requirement-workspace"`
  - `data-product-shell="initiative-workspace"`
  - `data-product-shell="bug-workspace"`
  - `data-product-shell="tech-debt-workspace"`
  - `data-product-shell="development-plan-workspace"`
  - `data-product-shell="plan-item-gate-workspace"`
- Core routes must not directly use `ProductPage` unless it is reduced to a semantic wrapper with no page-family visual decisions.
- Core routes must not render `SurfaceStateIndicator` for normal loaded, approved, or current states.
- Tailwind utilities and design tokens are the default styling mechanism. Do not introduce broad one-off vanilla CSS page classes.

## Scope Check

This is one integrated implementation slice because the product-quality failure crosses contracts, seeded preview data, route contracts, shared layout primitives, and the four core route families. The task boundaries below keep changes reviewable and can be executed by separate subagents with disjoint write ownership, but the final acceptance must be integrated because route contracts and screenshots cover the whole product surface.

## File Structure

### Contracts, Query API, And Seed Data

- Modify `packages/contracts/src/project-management.ts`
  - Add typed planning coverage, downstream gate summary, next action, audit metadata, evidence/attachment/release refs, and type-specific narrative schemas for Requirement, Initiative, Bug, and Tech Debt list/detail projections.
- Modify `packages/contracts/src/web-product-query.ts`
  - Add role-lens/query fields only where missing, keeping strict Zod parsing.
- Modify `packages/contracts/src/index.ts`
  - Export any new shared projection types.
- Modify `packages/db/src/queries/project-management-queries.ts`
  - Build typed source list/detail projections from WorkItems, Development Plans, Plan Items, specs, execution plans, executions, reviews, QA handoffs, releases, evidence, and attachments.
  - Apply page-local actor filters for typed source and planning queries where contracts expose them.
- Modify `apps/control-plane-api/src/modules/query/query.service.ts`
  - Pass expanded typed query parameters to the project-management query layer.
- Modify `apps/control-plane-api/src/modules/query/query.controller.ts`
  - Keep strict request parsing and response shapes aligned with contracts.
- Modify `apps/web/src/shared/api/query.ts`
  - Parse expanded typed source responses with the updated schemas.
- Modify `apps/web/src/shared/api/types.ts`
  - Update client-side query types and `isProductLaneSearchParamSupported` so role lens support is explicit and tested.
- Modify `tests/web/fixtures/product-data.ts`
  - Replace thin demo rows with realistic seeded product density: at least 4 Requirements, at least 1 Initiative, 1 Bug, 1 Tech Debt, at least 2 Development Plans, at least 8 Plan Items across boundary/spec/execution/review/QA/release states, active and resumable executions, requested changes, QA pending/blocked, release blocker, narrative Markdown, evidence, and attachments.
- Modify `tests/web/fixtures/product-api-mock.ts`
  - Serve all canonical seeded routes and strict response shapes.

### Route Contracts, Role Lens, And Guard Tests

- Modify `apps/web/src/features/product-surfaces/route-contract.ts`
  - Replace generic page-family route expectations with product-specific shell expectations and current seeded ids.
  - Keep `requiredScreenshotRoutes` equal to `canonicalProductRoutes`.
- Modify `apps/web/src/features/product-surfaces/first-viewport-contract.ts`
  - Require product shell markers and current-work landmarks instead of generic state banners.
- Modify `apps/web/src/shared/navigation/product-navigation.ts`
  - Ensure navigation stays typed and does not introduce top-level `Work Items` or `Tasks`.
- Create `apps/web/src/features/product-surfaces/role-lens.ts`
  - Centralize supported role lens values, URL state parsing, and actor-filter mapping.
- Modify `tests/web/product-grade-route-contract.test.tsx`
- Modify `tests/web/product-grade-first-viewport.test.tsx`
- Modify `tests/web/helpers/first-viewport-contract.ts`
- Modify `tests/web/no-legacy-web-ui.test.ts`
  - Add guards for forbidden public labels on typed source and Plan Item routes.
- Create `tests/web/product-workspace-shell-boundaries.test.tsx`
  - Guard shell markers, no direct generic page composition in core routes, and no normal-state `SurfaceStateIndicator`.
- Modify `tests/web/api-client-contract.test.ts`
- Modify `tests/api/project-management-query.test.ts`
- Modify `tests/api/product-lanes.test.ts`
- Modify `tests/contracts/project-management-contracts.test.ts`

### Shared Layout And UI Primitives

- Create `apps/web/src/shared/layout/product-workspace-shells.tsx`
  - Page-specific shell roots: `CockpitCommandCenter`, `RequirementWorkspace`, `InitiativeWorkspace`, `BugWorkspace`, `TechDebtWorkspace`, `DevelopmentPlanWorkspace`, `PlanItemGateWorkspace`.
- Create `apps/web/src/shared/layout/workspace-primitives.tsx`
  - Neutral primitives only: split pane, dense toolbar, inspector rail, property list, gate rail, status dot/pill wrappers, evidence rail, document workspace frame.
- Modify `apps/web/src/shared/layout/index.ts`
  - Export shells and primitives.
- Modify `apps/web/src/shared/layout/product-page/product-page.tsx` or current `ProductPage` file if present
  - Reduce to semantic-only root if still used outside core product routes.
- Modify `apps/web/src/shared/styles/theme.css`
  - Keep only global tokens/base/MDXEditor integration; avoid broad page-layout CSS.
- Modify `tests/web/product-grade-layout-primitives.test.tsx`
- Modify `tests/web/responsive-layout.test.tsx`

### Page Family Implementations

- Modify `apps/web/src/features/cockpit/cockpit-view-model.ts`
  - Produce `cockpitCommandCenterViewModel` with attention queue, role lens, flow strip, risk/readiness rail, active/resumable execution signals, and compact degraded states.
- Modify `apps/web/src/features/cockpit/cockpit-route.tsx`
  - Render command center shell without generic page state banners.
- Replace or reduce `apps/web/src/features/project-management/object-list.tsx`
  - It may remain only as a neutral table engine with no copy/action/empty-state ownership.
- Modify `apps/web/src/features/project-management/object-detail-layout.tsx`
- Modify `apps/web/src/features/project-management/object-evidence-route.tsx`
- Modify `apps/web/src/features/project-management/object-forms.tsx`
- Modify or replace `apps/web/src/features/project-management/source-object-view-model.ts`
  - Split typed view models so business-critical values are not inferred from titles or fallback copy.
- Modify typed routes:
  - `apps/web/src/features/requirements/requirements-routes.tsx`
  - `apps/web/src/features/initiatives/initiatives-routes.tsx`
  - `apps/web/src/features/bugs/bugs-routes.tsx`
  - `apps/web/src/features/tech-debt/tech-debt-routes.tsx`
- Modify Development Plan routes:
  - `apps/web/src/features/development-plans/development-plan-view-model.ts`
  - `apps/web/src/features/development-plans/development-plans-route.tsx`
  - `apps/web/src/features/development-plans/development-plan-detail-route.tsx`
  - `apps/web/src/features/development-plans/development-plan-table.tsx`
- Modify Plan Item gate routes:
  - `apps/web/src/features/development-plans/development-plan-item-detail-route.tsx`
  - `apps/web/src/features/development-plans/plan-item-gates.tsx`
- Modify gate panels where needed:
  - `apps/web/src/features/brainstorming/brainstorming-panel.tsx`
  - `apps/web/src/features/spec-plan/spec-plan-lifecycle-actions.tsx`
  - `apps/web/src/features/code-review/code-review-handoff-panel.tsx`
  - `apps/web/src/features/qa/qa-handoff-panel.tsx`
- Preserve existing Markdown editor and attachment integration:
  - `apps/web/src/shared/ui/markdown-editor/*` or current Markdown editor files.

### Visual Verification And Reports

- Modify `tests/e2e/ai-native-project-management-visual.e2e.test.ts`
- Modify `tests/e2e/web-product-routes.e2e.test.ts`
- Modify `tests/e2e/helpers/capture-route-screenshots.ts`
- Create or update `docs/superpowers/reports/product-workspace-core-surface-redesign-review.md`
  - Store visual acceptance notes, screenshot route list, viewport evidence, and any deferred non-blocking polish.

---

## Task 1: Expand Typed Source Contracts And Query Projections

**Files:**
- Modify: `packages/contracts/src/project-management.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/db/src/queries/project-management-queries.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.service.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.controller.ts`
- Modify: `apps/web/src/shared/api/query.ts`
- Modify: `tests/contracts/project-management-contracts.test.ts`
- Modify: `tests/api/project-management-query.test.ts`
- Modify: `tests/web/api-client-contract.test.ts`

- [ ] **Step 1: Write failing contract tests for typed source list/detail projections**

Add assertions in `tests/contracts/project-management-contracts.test.ts` that parse representative Requirement, Initiative, Bug, and Tech Debt list/detail objects with the new required fields. The Requirement assertions must include the exact fields named in the spec.

```ts
import {
  requirementDetailSchema,
  requirementListItemSchema,
  bugDetailSchema,
  initiativeDetailSchema,
  techDebtDetailSchema,
} from '../../packages/contracts/src/project-management';

it('requires product-grade Requirement list projection fields', () => {
  expect(() =>
    requirementListItemSchema.parse({
      id: 'req-checkout-risk',
      ref: { type: 'requirement', id: 'req-checkout-risk', title: 'Checkout risk controls' },
      title: 'Checkout risk controls',
      status: 'ready_for_planning',
      priority: 'high',
      risk: 'high',
      driver_actor_id: 'actor-product',
      planning_coverage: { development_plan_count: 1, plan_item_count: 3, uncovered: false },
      downstream_gate_summary: {
        current_gate_counts: { boundary: 1, spec: 1, execution_plan: 1, execution: 0, code_review: 0, qa: 0, release: 0 },
        blocker_count: 1,
      },
      last_meaningful_update_at: '2026-05-27T08:00:00.000Z',
      next_action: 'Review Spec test strategy',
      release_refs: [{ type: 'release', id: 'rel-preview', title: 'Preview release' }],
      updated_at: '2026-05-27T08:00:00.000Z',
    }),
  ).not.toThrow();
});

it('requires Requirement detail narrative, coverage, evidence, attachments, audit, and next action', () => {
  expect(() =>
    requirementDetailSchema.parse({
      id: 'req-checkout-risk',
      ref: { type: 'requirement', id: 'req-checkout-risk', title: 'Checkout risk controls' },
      title: 'Checkout risk controls',
      status: 'ready_for_planning',
      priority: 'high',
      risk: 'high',
      driver_actor_id: 'actor-product',
      stakeholder_problem: 'Product needs confidence that risky checkout changes are reviewed before release.',
      desired_outcome: 'Every release-impacting checkout change carries approved Spec, plan, QA, and release evidence.',
      acceptance_criteria_summary: 'Risky paths have approved test strategy and QA handoff before release readiness clears.',
      scope_summary: {
        in_scope: 'Checkout requirements, delivery plan links, QA evidence, and release blockers.',
        out_of_scope: 'External Jira sync and retro learning loop.',
      },
      planning_coverage: { development_plan_count: 1, plan_item_count: 3, uncovered: false },
      downstream_gate_summary: {
        current_gate_counts: { boundary: 1, spec: 1, execution_plan: 1, execution: 0, code_review: 0, qa: 0, release: 0 },
        blocker_count: 1,
      },
      linked_development_plans: [{ type: 'development_plan', id: 'dp-core', title: 'Core redesign plan' }],
      linked_plan_items: [{ type: 'development_plan_item', id: 'dpi-core', development_plan_id: 'dp-core', title: 'Requirement workspace' }],
      evidence_refs: [{ type: 'attachment', id: 'att-1', title: 'Research screenshot' }],
      attachment_refs: [{
        id: 'att-1',
        owner_object_type: 'requirement',
        owner_object_id: 'req-checkout-risk',
        linked_object_refs: [{ type: 'requirement', id: 'req-checkout-risk', title: 'Checkout risk controls' }],
        filename: 'scope.png',
        content_type: 'image/png',
        size_bytes: 128,
        checksum_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        uploaded_by_actor_id: 'actor-product',
        created_at: '2026-05-27T08:00:00.000Z',
        evidence_category: 'image',
        visibility: 'object',
        safety_status: 'passed',
        reference_status: 'active',
      }],
      release_refs: [{ type: 'release', id: 'rel-preview', title: 'Preview release' }],
      audit: { created_at: '2026-05-27T08:00:00.000Z', updated_at: '2026-05-27T08:30:00.000Z', updated_by_actor_id: 'actor-product' },
      last_meaningful_update_at: '2026-05-27T08:30:00.000Z',
      next_action: 'Open linked Plan Item',
      updated_at: '2026-05-27T08:30:00.000Z',
    }),
  ).not.toThrow();
});
```

Expected: the tests fail because current schemas are too thin.

- [ ] **Step 2: Write failing API projection tests**

In `tests/api/project-management-query.test.ts`, seed WorkItems, Development Plans, Plan Items, releases, evidence, and attachments through existing test helpers/repository setup. Assert `/query/requirements` and detail responses include real projection fields, not inferred or unavailable copy.

Run: `pnpm vitest run tests/contracts/project-management-contracts.test.ts tests/api/project-management-query.test.ts tests/web/api-client-contract.test.ts`

Expected: FAIL on missing `planning_coverage`, `downstream_gate_summary`, narrative, audit, evidence, or strict client parse fields.

- [ ] **Step 3: Add contract schemas and exported types**

In `packages/contracts/src/project-management.ts`, add shared strict schemas:

```ts
const sourcePlanningCoverageSchema = z
  .object({
    development_plan_count: z.number().int().nonnegative(),
    plan_item_count: z.number().int().nonnegative(),
    uncovered: z.boolean(),
  })
  .strict();

const downstreamGateSummarySchema = z
  .object({
    current_gate_counts: z
      .object({
        boundary: z.number().int().nonnegative().default(0),
        spec: z.number().int().nonnegative().default(0),
        execution_plan: z.number().int().nonnegative().default(0),
        execution: z.number().int().nonnegative().default(0),
        code_review: z.number().int().nonnegative().default(0),
        qa: z.number().int().nonnegative().default(0),
        release: z.number().int().nonnegative().default(0),
      })
      .strict(),
    blocker_count: z.number().int().nonnegative(),
  })
  .strict();

const sourceAuditSchema = z
  .object({
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
    updated_by_actor_id: nonEmpty.optional(),
  })
  .strict();
```

Extend each typed list/detail schema with type-specific fields from the spec. Do not make required product-grade fields optional to avoid hiding missing backend projections with UI fallbacks.

- [ ] **Step 4: Implement projection builders in the query layer**

In `packages/db/src/queries/project-management-queries.ts`, replace thin `workItemToRequirementListItem`, `workItemToRequirementDetail`, `workItemToInitiative*`, `workItemToBug*`, and `workItemToTechDebt*` mappings with projections that compute:

- typed driver, status, priority/severity/risk;
- linked Development Plan count and Plan Item count;
- downstream gate distribution and blocker count from `DevelopmentPlanItem` gate statuses;
- linked Development Plans and Plan Items from `source_refs`;
- release refs from release scope and Plan Item release impact;
- evidence and attachment refs from repository data;
- audit and `last_meaningful_update_at`;
- `next_action` from the highest-priority blocked or active downstream gate.

Keep helper names typed, for example:

```ts
async function typedSourceProjectionContext(repository: DeliveryRepository, projectId: string) {
  const [plans, planItems, releases] = await Promise.all([
    repository.listDevelopmentPlans(projectId),
    listDevelopmentPlanItemsForProject(repository, projectId),
    repository.listReleases(projectId),
  ]);
  return { plans, planItems, releases };
}
```

- [ ] **Step 5: Update API client strict parsing**

Update `apps/web/src/shared/api/query.ts` so typed source list/detail methods parse the expanded schemas from `@forgeloop/contracts`. Remove any client-side fallback that fabricates business-critical fields such as planning coverage, next action, or unavailable narrative.

- [ ] **Step 6: Run focused contract/API/client tests**

Run: `pnpm vitest run tests/contracts/project-management-contracts.test.ts tests/api/project-management-query.test.ts tests/web/api-client-contract.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add packages/contracts/src/project-management.ts packages/contracts/src/index.ts packages/db/src/queries/project-management-queries.ts apps/control-plane-api/src/modules/query/query.service.ts apps/control-plane-api/src/modules/query/query.controller.ts apps/web/src/shared/api/query.ts tests/contracts/project-management-contracts.test.ts tests/api/project-management-query.test.ts tests/web/api-client-contract.test.ts
git commit -m "feat: expand typed source workspace projections"
```

---

## Task 2: Build Realistic Preview Data And Route Coverage

**Files:**
- Modify: `tests/web/fixtures/product-data.ts`
- Modify: `tests/web/fixtures/product-api-mock.ts`
- Modify: `apps/web/src/features/product-surfaces/route-contract.ts`
- Modify: `tests/web/product-grade-route-contract.test.tsx`
- Modify: `tests/e2e/ai-native-project-management-visual.e2e.test.ts`
- Modify: `tests/e2e/web-product-routes.e2e.test.ts`

- [ ] **Step 1: Write failing preview-density tests**

In `tests/web/product-grade-route-contract.test.tsx` or a focused fixture test, first add an exported scenario summary in `tests/web/fixtures/product-data.ts` so tests do not depend on scattered legacy fixture names:

```ts
export const productWorkspacePreviewScenario = {
  requirements,
  initiatives,
  bugs,
  techDebt,
  developmentPlans,
  developmentPlanItems,
  executions,
  codeReviews,
  qaHandoffs,
  releases,
} as const;
```

Then assert against that exported scenario:

```ts
expect(productWorkspacePreviewScenario.requirements.length).toBeGreaterThanOrEqual(4);
expect(productWorkspacePreviewScenario.initiatives.length).toBeGreaterThanOrEqual(1);
expect(productWorkspacePreviewScenario.bugs.length).toBeGreaterThanOrEqual(1);
expect(productWorkspacePreviewScenario.techDebt.length).toBeGreaterThanOrEqual(1);
expect(productWorkspacePreviewScenario.developmentPlans.length).toBeGreaterThanOrEqual(2);
expect(productWorkspacePreviewScenario.developmentPlanItems.length).toBeGreaterThanOrEqual(8);
expect(productWorkspacePreviewScenario.executions.some((execution) => execution.status === 'running')).toBe(true);
expect(productWorkspacePreviewScenario.executions.some((execution) => execution.status === 'interrupted')).toBe(true);
expect(productWorkspacePreviewScenario.codeReviews.some((review) => review.status === 'changes_requested')).toBe(true);
expect(productWorkspacePreviewScenario.qaHandoffs.some((handoff) => handoff.status === 'blocked' || handoff.status === 'pending')).toBe(true);
expect(productWorkspacePreviewScenario.releases.some((release) => release.blockers.length > 0)).toBe(true);
```

Run: `pnpm vitest run tests/web/product-grade-route-contract.test.tsx`

Expected: FAIL because current fixtures are too thin.

- [ ] **Step 2: Update seeded ids and screenshot route manifest**

In `apps/web/src/features/product-surfaces/route-contract.ts`, keep all canonical product routes but update concrete ids to the new seeded scenario. Verify:

```ts
expect(requiredScreenshotRoutes).toEqual(canonicalProductRoutes);
```

Do not remove typed source index/new/detail/evidence routes or Plan Item gate routes.

- [ ] **Step 3: Expand fixture data**

In `tests/web/fixtures/product-data.ts`, create a deterministic scenario with:

- `req-product-workspace-clarity`, `req-ai-native-delivery-flow`, `req-qa-shift-left`, `req-release-readiness`;
- `init-product-workspace-redesign`;
- `bug-plan-item-action-eligibility`;
- `td-retire-generic-product-page`;
- `dp-product-workspace-core-surface-redesign`;
- `dp-release-risk-closure`;
- at least 8 Plan Items across boundary/spec/execution-plan/execution/code-review/QA/release;
- narrative Markdown and at least one image attachment ref on a Requirement;
- active execution, interrupted execution, requested code-review changes, pending/blocked QA, and release blocker.

Use meaningful titles and short copy so screenshots do not look like placeholders. Do not seed dominant strings such as `summary unavailable`, `planning state unknown`, or `evidence unavailable`.

- [ ] **Step 4: Update mock API responses**

In `tests/web/fixtures/product-api-mock.ts`, serve expanded typed source responses and route-specific Plan Item gate data. Keep strict mock coverage so every `canonicalProductRoutes` concrete path has seeded data.

- [ ] **Step 5: Run route and mock coverage tests**

Run: `pnpm vitest run tests/web/product-grade-route-contract.test.tsx tests/e2e/web-product-routes.e2e.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add tests/web/fixtures/product-data.ts tests/web/fixtures/product-api-mock.ts apps/web/src/features/product-surfaces/route-contract.ts tests/web/product-grade-route-contract.test.tsx tests/e2e/ai-native-project-management-visual.e2e.test.ts tests/e2e/web-product-routes.e2e.test.ts
git commit -m "test: seed product workspace preview data"
```

---

## Task 3: Add Role Lens Mapping And Product-Surface Guardrails

**Files:**
- Create: `apps/web/src/features/product-surfaces/role-lens.ts`
- Modify: `packages/contracts/src/web-product-query.ts`
- Modify: `apps/web/src/shared/api/types.ts`
- Modify: `packages/db/src/queries/product-lane-filters.ts`
- Modify: `packages/db/src/queries/product-lane-types.ts`
- Modify: `tests/api/product-lanes.test.ts`

- [ ] **Step 1: Write failing role-lens tests**

In `tests/api/product-lanes.test.ts`, assert role filters map to existing actor fields and that unsupported filters are not silently ignored. Include:

- `product -> driver_actor_id`;
- `developer -> execution_owner_actor_id`;
- `reviewer -> reviewer_actor_id`;
- `qa -> qa_owner_actor_id`;
- `release -> release_owner_actor_id`;
- `manager -> no actor narrowing, risk/blocker/release-impact sort`;
- `tech-lead -> reviewer/approver filters only where present`.

Run: `pnpm vitest run tests/api/product-lanes.test.ts`

Expected: FAIL on incomplete mapping or client restrictions.

- [ ] **Step 2: Implement role-lens parser and mapping**

Create `apps/web/src/features/product-surfaces/role-lens.ts`:

```ts
export const roleLensValues = ['all', 'product', 'tech-lead', 'developer', 'reviewer', 'qa', 'release', 'manager'] as const;
export type RoleLens = (typeof roleLensValues)[number];

export function parseRoleLens(value: string | null | undefined): RoleLens {
  return roleLensValues.includes(value as RoleLens) ? (value as RoleLens) : 'all';
}

export function roleLensActorFilter(role: RoleLens, actorId: string | undefined) {
  if (actorId === undefined || role === 'all' || role === 'manager' || role === 'tech-lead') return {};
  if (role === 'product') return { driver_actor_id: actorId };
  if (role === 'developer') return { execution_owner_actor_id: actorId };
  if (role === 'reviewer') return { reviewer_actor_id: actorId };
  if (role === 'qa') return { qa_owner_actor_id: actorId };
  if (role === 'release') return { release_owner_actor_id: actorId };
  return {};
}
```

Extend as needed for tech-lead where reviewer/approver fields exist. Keep manager as a sorting lens, not an owner fallback.

- [ ] **Step 3: Extend query types and filters**

Update `packages/contracts/src/web-product-query.ts`, `apps/web/src/shared/api/types.ts`, and db query filters so actor filters are accepted only where supported and rejected or ignored intentionally with tests. Remove the current client-side restriction that hides `execution_owner_actor_id` except for one lane when the route now has a real execution-oriented Plan Item view.

- [ ] **Step 4: Run focused role-lens tests**

Run: `pnpm vitest run tests/api/product-lanes.test.ts tests/web/api-client-contract.test.ts`

Expected: PASS. Do not add route-render shell or no-baggage tests in this task unless this task also makes those routes pass; those guards are introduced in Tasks 4, 6, 7, and 8 at the point they can turn green.

- [ ] **Step 5: Commit Task 3**

Commit only role-lens implementation and tests that pass now.

```bash
git add apps/web/src/features/product-surfaces/role-lens.ts packages/contracts/src/web-product-query.ts apps/web/src/shared/api/types.ts packages/db/src/queries/product-lane-filters.ts packages/db/src/queries/product-lane-types.ts tests/api/product-lanes.test.ts
git commit -m "feat: add product role lens query mapping"
```

---

## Task 4: Introduce Page-Specific Shells And Neutral Primitives

**Files:**
- Create: `apps/web/src/shared/layout/product-workspace-shells.tsx`
- Create: `apps/web/src/shared/layout/workspace-primitives.tsx`
- Modify: `apps/web/src/shared/layout/index.ts`
- Modify: `apps/web/src/shared/layout/product-page/product-page.tsx` or the current `ProductPage` implementation path
- Modify: `apps/web/src/shared/styles/theme.css`
- Modify: `tests/web/product-grade-layout-primitives.test.tsx`
- Modify: `tests/web/responsive-layout.test.tsx`
- Create: `tests/web/product-workspace-shell-boundaries.test.tsx`

- [ ] **Step 1: Write failing shell primitive tests**

In `tests/web/product-grade-layout-primitives.test.tsx`, add tests that each shell renders its marker and does not inject headings, toolbars, state banners, or page-family-specific columns by default.

```tsx
render(
  <RequirementWorkspace
    toolbar={<button type="button">Create Requirement</button>}
    table={<div>Requirement rows</div>}
    inspector={<aside>Selected requirement</aside>}
  />,
);
expect(screen.getByTestId('requirement-workspace')).toHaveAttribute('data-product-shell', 'requirement-workspace');
expect(screen.queryByText(/approved state/i)).not.toBeInTheDocument();
```

Expected: FAIL because shells do not exist.

- [ ] **Step 2: Implement `workspace-primitives.tsx`**

Add neutral primitives:

- `WorkspaceSplitPane`;
- `DenseToolbar`;
- `InspectorRail`;
- `PropertyList`;
- `GateRail`;
- `EvidenceRail`;
- `DocumentWorkspaceFrame`;
- `StatusDot`.

All layout should use Tailwind utilities. Keep props explicit and small. Do not add default explanatory copy.

- [ ] **Step 3: Implement `product-workspace-shells.tsx`**

Implement the required shells as composition wrappers:

```tsx
export function RequirementWorkspace({ toolbar, table, inspector }: TypedWorkspaceProps) {
  return (
    <section
      className="grid min-h-0 gap-3"
      data-product-shell="requirement-workspace"
      data-testid="requirement-workspace"
    >
      {toolbar}
      <WorkspaceSplitPane primary={table} secondary={inspector} />
    </section>
  );
}
```

Repeat for Initiative, Bug, Tech Debt, Development Plan, Cockpit, and Plan Item shells with distinct composition slots. Shared primitives are allowed; shell markers and slot names must remain page-family-specific.

- [ ] **Step 4: Reduce `ProductPage` to semantic-only or remove from core paths**

If `ProductPage` remains exported, ensure it does not own:

- first-viewport spacing;
- heading/toolbar visual composition;
- state banners;
- page-family columns;
- explanatory helper copy.

Any old visual decisions must move into page-specific route components or be deleted.

- [ ] **Step 5: Add import-boundary scaffolding without requiring unmigrated routes**

Create `tests/web/product-workspace-shell-boundaries.test.tsx` with file-scan assertions that can pass immediately:

- `ProductPage` has no required `heading` prop and no `<header>`/`<h1>`/toolbar composition after semantic reduction; or core routes do not import it after later migration.
- shared shells export all required `data-product-shell` marker strings;
- `SurfaceStateIndicator` is not exported from new workspace shell files.

Do not yet assert that every core route renders the new marker; route-level marker assertions are added in Tasks 5-8 when each family migrates.

- [ ] **Step 6: Run layout primitive tests**

Run: `pnpm vitest run tests/web/product-grade-layout-primitives.test.tsx tests/web/responsive-layout.test.tsx tests/web/product-workspace-shell-boundaries.test.tsx`

Expected: PASS. No red tests should be committed.

- [ ] **Step 7: Commit Task 4**

```bash
git add apps/web/src/shared/layout/product-workspace-shells.tsx apps/web/src/shared/layout/workspace-primitives.tsx apps/web/src/shared/layout/index.ts apps/web/src/shared/layout/product-page/product-page.tsx apps/web/src/shared/styles/theme.css tests/web/product-grade-layout-primitives.test.tsx tests/web/responsive-layout.test.tsx tests/web/product-workspace-shell-boundaries.test.tsx
git commit -m "feat: add product workspace shell primitives"
```

---

## Task 5: Rebuild Cockpit As A Command Center

**Files:**
- Modify: `apps/web/src/features/cockpit/cockpit-view-model.ts`
- Modify: `apps/web/src/features/cockpit/cockpit-route.tsx`
- Modify: `tests/web/product-grade-view-models.test.ts`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`
- Modify: `tests/e2e/ai-native-project-management-visual.e2e.test.ts`

- [ ] **Step 1: Write failing Cockpit view-model tests**

In `tests/web/product-grade-view-models.test.ts`, assert the view model returns:

- 3-7 priority attention items;
- role lens metadata;
- delivery flow strip counts;
- risk/readiness rail items;
- active/resumable Codex executions;
- compact degraded states only when real.

```ts
expect(model.attentionItems.length).toBeGreaterThanOrEqual(3);
expect(model.attentionItems.length).toBeLessThanOrEqual(7);
expect(model.attentionItems[0]).toMatchObject({
  typed_ref: expect.objectContaining({ type: expect.stringMatching(/requirement|bug|tech_debt|initiative|development_plan_item/) }),
  next_action: expect.any(String),
  severity: expect.any(String),
});
expect(model.flowStrip.some((stage) => stage.id === 'spec')).toBe(true);
expect(model.riskRail.some((item) => item.kind === 'release_blocker')).toBe(true);
```

Run: `pnpm vitest run tests/web/product-grade-view-models.test.ts`

Expected: FAIL on missing command-center model.

- [ ] **Step 2: Implement `cockpitCommandCenterViewModel`**

In `cockpit-view-model.ts`, build the model from existing query/cockpit data and seeded product data. Priority sort:

1. release blockers;
2. requested code-review changes;
3. QA blockers/pending release-impacting handoffs;
4. missing Spec/Execution Plan approvals;
5. interrupted/resumable executions;
6. stale context or degraded data.

Do not include generic rows named `Report 1`, `Report 2`, or report follow-ups as primary attention.

- [ ] **Step 3: Rewrite Cockpit route layout**

In `cockpit-route.tsx`, render:

- compact top toolbar with project, role lens, command search, runtime status, create/action menu;
- dominant left attention queue;
- center delivery flow strip;
- right risk/readiness rail.

Use `CockpitCommandCenter` shell and Tailwind utility classes. Remove `ProductPage` and normal-state `SurfaceStateIndicator` from the route.

- [ ] **Step 4: Run focused Cockpit tests**

Run: `pnpm vitest run tests/web/product-grade-view-models.test.ts tests/web/product-grade-first-viewport.test.tsx tests/e2e/ai-native-project-management-visual.e2e.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS for Cockpit-specific assertions. If the full e2e file still includes unmigrated routes, run the Cockpit test name only and keep the remaining failures for later tasks.

- [ ] **Step 5: Commit Task 5**

```bash
git add apps/web/src/features/cockpit/cockpit-view-model.ts apps/web/src/features/cockpit/cockpit-route.tsx tests/web/product-grade-view-models.test.ts tests/web/product-grade-first-viewport.test.tsx tests/e2e/ai-native-project-management-visual.e2e.test.ts
git commit -m "feat: rebuild cockpit command center"
```

---

## Task 6: Replace Generic Typed Source Workspaces

**Files:**
- Modify or reduce: `apps/web/src/features/project-management/object-list.tsx`
- Modify: `apps/web/src/features/project-management/object-detail-layout.tsx`
- Modify: `apps/web/src/features/project-management/object-evidence-route.tsx`
- Modify: `apps/web/src/features/project-management/object-forms.tsx`
- Modify or split: `apps/web/src/features/project-management/source-object-view-model.ts`
- Modify: `apps/web/src/features/requirements/requirements-routes.tsx`
- Modify: `apps/web/src/features/initiatives/initiatives-routes.tsx`
- Modify: `apps/web/src/features/bugs/bugs-routes.tsx`
- Modify: `apps/web/src/features/tech-debt/tech-debt-routes.tsx`
- Modify: `tests/web/project-management-routes.test.tsx`
- Modify: `tests/web/no-legacy-web-ui.test.ts`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`
- Modify: `tests/web/product-workspace-shell-boundaries.test.tsx`
- Modify: `tests/web/markdown-editor-attachments.test.tsx`

- [ ] **Step 1: Write failing typed workspace route tests**

In `tests/web/project-management-routes.test.tsx`, assert:

- `/requirements` has `data-product-shell="requirement-workspace"`;
- `/requirements/:id` renders a Markdown document area and right property rail;
- `/initiatives`, `/bugs`, and `/tech-debt` have their own shell markers;
- typed route actions use typed labels, not `Create source object` or `Plan source object`.

```tsx
expect(await screen.findByText(/Requirement Driver/i)).toBeInTheDocument();
expect(screen.getByRole('link', { name: /Create Requirement/i })).toBeInTheDocument();
expect(screen.getByRole('link', { name: /Create Development Plan/i })).toBeInTheDocument();
expect(screen.queryByText(/source object/i)).not.toBeInTheDocument();
```

Expected: FAIL on current generic `ObjectList`.

- [ ] **Step 2: Add no-baggage guards for typed source routes**

Extend `tests/web/no-legacy-web-ui.test.ts` for typed source index/new/detail/evidence routes. These routes must fail if rendered public text includes:

```ts
const forbiddenTypedSourceCopy = [
  /source object database/i,
  /create source object/i,
  /plan source object/i,
  /source object context/i,
  /work item owner/i,
  /responsibility:\s*actor-owner/i,
  /requirement summary unavailable/i,
  /planning state unknown/i,
  /evidence unavailable/i,
];
```

Allow isolated negative tests to mention forbidden labels only inside test source. Do not scan repository internals where migration/history tests legitimately mention retired names.

- [ ] **Step 3: Add route shell assertions for typed source routes**

Extend `tests/web/product-workspace-shell-boundaries.test.tsx` so typed source routes render:

- `data-product-shell="requirement-workspace"`;
- `data-product-shell="initiative-workspace"`;
- `data-product-shell="bug-workspace"`;
- `data-product-shell="tech-debt-workspace"`.

Only add these assertions in the same task that migrates the routes so the task ends green.

- [ ] **Step 4: Split typed view models**

Replace `sourceObjectListViewModel` with typed adapters:

- `requirementWorkspaceViewModel`;
- `initiativeWorkspaceViewModel`;
- `bugWorkspaceViewModel`;
- `techDebtWorkspaceViewModel`.

Each adapter must map only contract fields to display fields. Do not infer stakeholder problem, coverage, next action, or release refs from titles. Missing required data should produce a compact degraded-data model and should normally fail tests because Task 1 supplies the data.

- [ ] **Step 5: Convert `ObjectList` into a neutral table engine or remove product use**

If keeping `object-list.tsx`, strip it down so it accepts fully formed columns, rows, toolbar, inspector, empty state, and actions from the typed adapter. It must not own public copy, `source object` wording, generic owner language, or generic planning actions.

- [ ] **Step 6: Implement Requirement index and detail workspace**

Requirement index:

- dense table with title, Requirement Driver, priority, risk, status, Development Plan coverage, Plan Item coverage, downstream gate summary, last meaningful update, next action;
- toolbar with search, status, priority, risk, driver, planning coverage, release link, role filter, view controls;
- right inspector for selected Requirement.

Requirement detail:

- center MDXEditor-backed narrative document;
- right property rail with driver, priority, risk, status, Development Plan coverage, evidence, attachments, releases, audit;
- planning actions: create Development Plan, generate Development Plan draft with AI, link existing Development Plan, open linked Plan Item.

Preserve existing attachment upload/render behavior and Markdown editor tests.

- [ ] **Step 7: Implement Initiative, Bug, and Tech Debt workspaces**

Use their typed shells and type-specific fields:

- Initiative: business outcome, milestone intent, child Requirements/Bugs/Tech Debt, Initiative Driver, release coverage.
- Bug: observed behavior, expected behavior, reproduction, severity, Bug Driver, fix planning coverage.
- Tech Debt: affected modules, risk rationale, validation strategy, Tech Debt Driver, remediation planning coverage.

All index/new/detail/evidence routes must avoid generic source-object copy and generic owner language.

- [ ] **Step 8: Run typed source tests**

Run:

```bash
pnpm vitest run tests/web/project-management-routes.test.tsx tests/web/no-legacy-web-ui.test.ts tests/web/product-grade-first-viewport.test.tsx tests/web/product-workspace-shell-boundaries.test.tsx tests/web/markdown-editor-attachments.test.tsx
```

Expected: PASS for typed source route families.

- [ ] **Step 9: Commit Task 6**

```bash
git add apps/web/src/features/project-management/object-list.tsx apps/web/src/features/project-management/object-detail-layout.tsx apps/web/src/features/project-management/object-evidence-route.tsx apps/web/src/features/project-management/object-forms.tsx apps/web/src/features/project-management/source-object-view-model.ts apps/web/src/features/requirements/requirements-routes.tsx apps/web/src/features/initiatives/initiatives-routes.tsx apps/web/src/features/bugs/bugs-routes.tsx apps/web/src/features/tech-debt/tech-debt-routes.tsx tests/web/project-management-routes.test.tsx tests/web/no-legacy-web-ui.test.ts tests/web/product-grade-first-viewport.test.tsx tests/web/product-workspace-shell-boundaries.test.tsx tests/web/markdown-editor-attachments.test.tsx
git commit -m "feat: replace generic typed source workspaces"
```

---

## Task 7: Upgrade Development Plan Workspace

**Files:**
- Modify: `apps/web/src/features/development-plans/development-plan-view-model.ts`
- Modify: `apps/web/src/features/development-plans/development-plans-route.tsx`
- Modify: `apps/web/src/features/development-plans/development-plan-detail-route.tsx`
- Modify: `apps/web/src/features/development-plans/development-plan-table.tsx`
- Modify: `tests/web/development-plan-routes.test.tsx`
- Modify: `tests/web/product-grade-view-models.test.ts`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`
- Modify: `tests/web/no-legacy-web-ui.test.ts`
- Modify: `tests/web/product-workspace-shell-boundaries.test.tsx`

- [ ] **Step 1: Write failing Development Plan workspace tests**

Assert `/development-plans` and `/development-plans/:id` render:

- `data-product-shell="development-plan-workspace"`;
- compact summary bar: total plans, active plans, blocked items, review aging, execution in progress;
- filters: source type, role, driver, reviewer, gate, risk, release impact, status;
- table-first Plan Item workspace on detail;
- selected Plan Item inspector;
- AI/manual planning actions.

```tsx
expect(screen.getByRole('button', { name: /AI generate missing rows/i })).toBeInTheDocument();
expect(screen.getByRole('button', { name: /Regenerate with guidance/i })).toBeInTheDocument();
expect(screen.queryByText(/source object context/i)).not.toBeInTheDocument();
expect(screen.queryByText(/\brow\b/i)).not.toBeInTheDocument();
```

Expected: FAIL on generic row/source-object copy or missing density.

- [ ] **Step 2: Add route shell and no-baggage guards for Development Plan routes**

Extend `tests/web/product-workspace-shell-boundaries.test.tsx` so `/development-plans` and `/development-plans/:id` render `data-product-shell="development-plan-workspace"`.

Extend `tests/web/no-legacy-web-ui.test.ts` so Development Plan routes reject public generic copy such as `source object context`, dominant `row` terminology for user actions, and normal loaded/approved state banners.

- [ ] **Step 3: Implement `developmentPlanWorkspaceViewModel`**

Build plan index and detail models with:

- linked Requirements/Bugs/Tech Debt/Initiatives;
- item count, blocked count, gate distribution;
- responsible roles, driver/reviewer/QA/release actors;
- risk/status/updated date;
- selected Plan Item summary, current gate, blocker, next action, typed source context, artifacts/evidence links.

- [ ] **Step 4: Rewrite Development Plan index**

Use `DevelopmentPlanWorkspace` shell. Keep metrics compact and table dominant. Toolbar filters must not consume the whole first viewport.

- [ ] **Step 5: Rewrite Development Plan detail**

Use a table-first split pane:

- sticky toolbar with Add Plan Item, AI generate missing rows, Regenerate with guidance, show context manifest;
- dense Plan Item rows with source refs, current gate, gate progress, risk, driver, responsible role, reviewer, affected surfaces, dependencies, release impact, next action;
- selected Plan Item inspector on the right.

Use `Plan Item` in public copy, not generic `row` where the user is acting on a delivery unit.

- [ ] **Step 6: Run Development Plan tests**

Run:

```bash
pnpm vitest run tests/web/development-plan-routes.test.tsx tests/web/product-grade-view-models.test.ts tests/web/product-grade-first-viewport.test.tsx tests/web/no-legacy-web-ui.test.ts tests/web/product-workspace-shell-boundaries.test.tsx
```

Expected: PASS for Development Plan routes.

- [ ] **Step 7: Commit Task 7**

```bash
git add apps/web/src/features/development-plans/development-plan-view-model.ts apps/web/src/features/development-plans/development-plans-route.tsx apps/web/src/features/development-plans/development-plan-detail-route.tsx apps/web/src/features/development-plans/development-plan-table.tsx tests/web/development-plan-routes.test.tsx tests/web/product-grade-view-models.test.ts tests/web/product-grade-first-viewport.test.tsx tests/web/no-legacy-web-ui.test.ts tests/web/product-workspace-shell-boundaries.test.tsx
git commit -m "feat: upgrade development plan workspace"
```

---

## Task 8: Rebuild Plan Item Gate Workspace And Action Eligibility

**Files:**
- Modify: `apps/web/src/features/development-plans/development-plan-item-detail-route.tsx`
- Modify: `apps/web/src/features/development-plans/plan-item-gates.tsx`
- Modify: `apps/web/src/features/brainstorming/brainstorming-panel.tsx`
- Modify: `apps/web/src/features/spec-plan/spec-plan-lifecycle-actions.tsx`
- Modify: `apps/web/src/features/code-review/code-review-handoff-panel.tsx`
- Modify: `apps/web/src/features/qa/qa-handoff-panel.tsx`
- Modify: `tests/web/development-plan-routes.test.tsx`
- Modify: `tests/web/code-review-qa-handoff-routes.test.tsx`
- Modify: `tests/api/development-plans.test.ts`
- Modify: `tests/api/spec-plan-service.test.ts`
- Modify: `tests/api/execution-package-service.test.ts`
- Modify: `tests/domain/ai-native-planning-gates.test.ts`
- Modify: `tests/web/product-workspace-shell-boundaries.test.tsx`
- Modify: `tests/web/no-legacy-web-ui.test.ts`

- [ ] **Step 1: Write failing Plan Item overview tests**

In `tests/web/development-plan-routes.test.tsx`, assert overview route:

- has `data-product-shell="plan-item-gate-workspace"`;
- renders compact identity row;
- renders a gate rail with Boundary, Spec, Execution Plan, Execution, Code Review, QA, Release;
- renders exactly one active gate body in the center;
- does not render every gate body sequentially;
- puts decisions/evidence/activity/context in the side rail.

```tsx
expect(screen.getByTestId('active-gate-workspace')).toHaveTextContent(/Spec|Execution Plan|QA|Code Review|Brainstorming/i);
expect(screen.getByTestId('gate-rail')).toHaveTextContent(/Release/i);
expect(screen.queryAllByTestId('full-gate-body')).toHaveLength(1);
expect(screen.queryByText(/Development Plan Item Detail: Approved state/i)).not.toBeInTheDocument();
```

Expected: FAIL on current stacked layout.

- [ ] **Step 2: Add route shell and no-baggage guards for Plan Item gate routes**

Extend `tests/web/product-workspace-shell-boundaries.test.tsx` so `/development-plans/:id/items/:itemId` and all gate subroutes render `data-product-shell="plan-item-gate-workspace"` or a document/review/QA shell nested under that gate workspace root.

Extend `tests/web/no-legacy-web-ui.test.ts` so Plan Item routes reject public generic copy such as `Development Plan Item Detail: Approved state`, duplicated dominant `Gate progress` blocks, raw `Package`/`Run`/`Trace` navigation labels, and `source object context`.

- [ ] **Step 3: Write failing gate eligibility tests**

Add tests for disabled actions:

- Spec generation disabled until Boundary Summary approved.
- Execution Plan generation disabled until Spec approved and required QA/test-strategy participation is complete.
- Execution start disabled until Execution Plan approved and runnable internal Execution Package boundary exists.
- Direct execution from Development Plan content, draft Spec, or draft Execution Plan is not available.

API/domain tests should assert the same conditions where command eligibility is built, not only in the UI.

- [ ] **Step 4: Implement `planItemGateWorkspaceViewModel`**

In `plan-item-gates.tsx` or a new focused helper, build a view model that exposes:

- identity row fields;
- current gate id;
- gate rail entries through Release;
- active gate payload;
- contextual actions with compact disabled reason;
- evidence and decision rail;
- revision history as secondary/collapsed content.

Keep Execution Package as an internal authority link/eligibility field, not a new primary route.

- [ ] **Step 5: Rewrite overview and gate shell**

In `development-plan-item-detail-route.tsx`:

- replace `ProductPage`, `GateFlowLayout`, route chrome banners, duplicated gate progress, and `SupportingGateBodies`;
- render `PlanItemGateWorkspace`;
- show one active gate in the center;
- show adjacent gates as compact rail entries;
- move evidence/activity/context/revisions into right rail or lower secondary region.

- [ ] **Step 6: Preserve document editing routes**

For `/spec` and `/execution-plan`:

- keep MDXEditor-backed draft/edit state;
- keep attachments and images;
- show approval status and reviewer comments;
- add QA/Test Owner participation, testability note, acceptance criteria, risk scenarios, and test strategy summary when required;
- keep document actions separated from gate eligibility.

- [ ] **Step 7: Update execution, review, QA, and release gate content**

Execution route:

- worker status, current step, last event, interrupt/continue, changed files, verification evidence, PR/diff links.

Code Review route:

- decision panel, requested changes, audited exception path where allowed, verification evidence.

QA route:

- QA handoff status, acceptance criteria, accepted test strategy, verification evidence, block/accept path.

Release gate/context:

- release linkage, release impact, readiness blockers, QA/test evidence required for release inclusion, link to owning Release.

- [ ] **Step 8: Run Plan Item and eligibility tests**

Run:

```bash
pnpm vitest run tests/web/development-plan-routes.test.tsx tests/web/code-review-qa-handoff-routes.test.tsx tests/web/product-workspace-shell-boundaries.test.tsx tests/web/no-legacy-web-ui.test.ts tests/api/development-plans.test.ts tests/api/spec-plan-service.test.ts tests/api/execution-package-service.test.ts tests/domain/ai-native-planning-gates.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 8**

```bash
git add apps/web/src/features/development-plans/development-plan-item-detail-route.tsx apps/web/src/features/development-plans/plan-item-gates.tsx apps/web/src/features/brainstorming/brainstorming-panel.tsx apps/web/src/features/spec-plan/spec-plan-lifecycle-actions.tsx apps/web/src/features/code-review/code-review-handoff-panel.tsx apps/web/src/features/qa/qa-handoff-panel.tsx tests/web/development-plan-routes.test.tsx tests/web/code-review-qa-handoff-routes.test.tsx tests/web/product-workspace-shell-boundaries.test.tsx tests/web/no-legacy-web-ui.test.ts tests/api/development-plans.test.ts tests/api/spec-plan-service.test.ts tests/api/execution-package-service.test.ts tests/domain/ai-native-planning-gates.test.ts
git commit -m "feat: rebuild plan item gate workspace"
```

---

## Task 9: Visual Acceptance, Responsive Pass, And Final Verification

**Files:**
- Modify: `tests/e2e/ai-native-project-management-visual.e2e.test.ts`
- Modify: `tests/e2e/web-product-routes.e2e.test.ts`
- Modify: `tests/e2e/helpers/capture-route-screenshots.ts`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`
- Modify: `tests/web/no-legacy-web-ui.test.ts`
- Create or update: `docs/superpowers/reports/product-workspace-core-surface-redesign-review.md`

- [ ] **Step 1: Run full product route guard suite**

Run:

```bash
pnpm vitest run tests/web/product-grade-route-contract.test.tsx tests/web/product-grade-first-viewport.test.tsx tests/web/product-workspace-shell-boundaries.test.tsx tests/web/no-legacy-web-ui.test.ts tests/web/project-management-routes.test.tsx tests/web/development-plan-routes.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Start local preview on a free port**

Use the repo's existing preview/dev command. If the default port is occupied, choose a free port. If a local database is needed, do not use occupied ports `5432`, `15432`, or `25432`; pick a free high port and document it in the report.

Run one of:

```bash
pnpm preview:product-review
```

or, if that command is unavailable:

```bash
pnpm --filter @forgeloop/web dev --host 127.0.0.1 --port 0
```

Expected: preview prints the selected URL and seeded product scenario.

- [ ] **Step 3: Capture screenshots across required viewports**

Run the existing Vitest-backed screenshot helper/e2e flow. If the helper still writes the previous product-architecture report path, update `tests/e2e/helpers/capture-route-screenshots.ts` or the test caller so this slice writes `docs/superpowers/reports/product-workspace-core-surface-redesign-review.md`.

```bash
pnpm vitest run tests/e2e/ai-native-project-management-visual.e2e.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Required viewport evidence:

- 375x812 mobile;
- 768x1024 tablet;
- 1280x720 desktop;
- 1440x900 desktop.

Expected: screenshots cover every `requiredScreenshotRoutes` entry, with no route omitted.

- [ ] **Step 4: Manually review visual output against the spec**

Open representative screenshots or the live preview for:

- `/cockpit`;
- `/requirements`;
- `/requirements/:id`;
- `/development-plans`;
- `/development-plans/:id`;
- `/development-plans/:id/items/:itemId`;
- `/development-plans/:id/items/:itemId/spec`;
- `/development-plans/:id/items/:itemId/execution-plan`;
- `/development-plans/:id/items/:itemId/qa`.

Record findings in `docs/superpowers/reports/product-workspace-core-surface-redesign-review.md`:

- route;
- viewport;
- pass/fail;
- screenshot path when generated;
- any overlap/clipping/card-in-card/excessive banner/low-density issue;
- whether the issue was fixed or intentionally deferred as non-blocking.

- [ ] **Step 5: Run full verification**

Run:

```bash
pnpm test
pnpm build
git diff --check
```

Expected: all commands pass.

- [ ] **Step 6: Request blocker-focused code review**

Use `superpowers:requesting-code-review` or the repo's established review workflow. The review prompt must include:

- spec path;
- this plan path;
- screenshot report path;
- commit range;
- explicit blocker checks for no historical baggage, typed object semantics, role lens, QA shift-left, Execution Package eligibility, route contracts, screenshots, and Tailwind-first styling.

Fix blockers and rerun review until approved. Do not merge with known blockers.

- [ ] **Step 7: Commit final verification/report updates**

```bash
git add docs/superpowers/reports/product-workspace-core-surface-redesign-review.md tests/e2e/ai-native-project-management-visual.e2e.test.ts tests/e2e/web-product-routes.e2e.test.ts tests/e2e/helpers/capture-route-screenshots.ts tests/web/product-grade-first-viewport.test.tsx tests/web/no-legacy-web-ui.test.ts
git commit -m "test: verify product workspace visual redesign"
```

---

## Final Acceptance Checklist

- [ ] Contract schemas and query projections expose real typed source workspace data with strict parsing.
- [ ] Seeded preview data has realistic density and no dominant unavailable placeholders.
- [ ] Cockpit first viewport is a role-aware command center with attention queue, flow strip, and risk/readiness rail.
- [ ] Requirements index/detail are typed, document-centric, MDXEditor-backed where editing occurs, and connected to Development Plan coverage.
- [ ] Initiatives, Bugs, and Tech Debt routes use type-specific language, fields, and actions.
- [ ] Development Plans are dense planning workspaces with Plan Item table, filters, inspector, and AI/manual planning actions.
- [ ] Plan Item overview and gate routes show one active gate, compact gate rail through Release, and right decision/evidence context.
- [ ] Spec review visibly includes QA/Test Owner and test-strategy state where required before Execution Plan generation.
- [ ] Execution is disabled until approved Boundary, approved Spec, approved Execution Plan, required QA/test-strategy gates, and runnable internal Execution Package boundary exist.
- [ ] No top-level Work Items or Tasks route is introduced.
- [ ] No public generic `source object`, `Work Item Owner`, generic `owner`, generic `row`, raw `Package`, raw `Run`, raw `Trace`, or raw `Review Packet` navigation leaks into primary surfaces.
- [ ] Core routes expose required `data-product-shell` markers and do not use generic page templates for visible first-viewport composition.
- [ ] `requiredScreenshotRoutes` equals `canonicalProductRoutes`.
- [ ] Screenshots pass at 375, 768, 1280, and 1440 widths with no overlapping text, clipped controls, incoherent overflow, card-in-card sections, oversized normal-state banners, or decorative hero treatment.
- [ ] Styling is Tailwind-first with global CSS limited to tokens/base/MDXEditor integration.
- [ ] `pnpm test`, `pnpm build`, `git diff --check`, and blocker-focused review pass before merge.
