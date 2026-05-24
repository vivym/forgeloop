# Product-Grade Visual System Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current debug-like/card-heavy Web UI with a product-grade, action-first ForgeLoop interface across Cockpit, source objects, Development Plans, item gates, delivery, release, and reports.

**Architecture:** This is a Web-first closure pass. The implementation adds shared Tailwind/React layout primitives, explicit route/page-family contracts, feature-level presentation view-model adapters, and route screenshot/first-viewport gates before page rewrites. Backend/API changes are not planned; Task 3 records the projection inventory and degraded-state mapping up front, and any later field gap must pause implementation for a plan amendment with the smallest projection exception plus contract/API tests.

**Tech Stack:** React 19, React Router 7 route modules, Tailwind CSS v4 theme tokens, TanStack Query, TanStack Table, MDXEditor through the existing ForgeLoop wrapper, Vitest, Testing Library, axe-core, and Playwright.

---

## Source Spec

- Spec: `docs/superpowers/specs/2026-05-25-product-grade-visual-system-closure-design.md`
- Related prior specs:
  - `docs/superpowers/specs/2026-05-23-ai-native-project-management-ux-redesign-design.md`
  - `docs/superpowers/specs/2026-05-23-project-management-ia-authoring-design.md`
  - `docs/superpowers/specs/2026-05-18-web-product-ui-architecture-redesign-design.md`

## Scope Check

The spec covers many route families, but they are not independent subsystems. The no-baggage requirement, global route identity, shared primitives, role lens contract, screenshot manifest, and first-viewport test contract must land together or the product will keep inconsistent historical surfaces. Keep this as one coordinated plan, executed in narrow commits by page family after the shared contract and primitives are in place.

## Non-Negotiables

- Do not introduce an old/new switch, compatibility shell, or historical route alias as a product surface.
- Do not expose top-level direct task, legacy plan, legacy spec, raw replay, package browser, run browser, or review browser entries.
- Source objects create, generate, link, or add rows to Development Plans. They do not generate Spec or Execution Plan documents directly.
- Development Plan Item remains the governed unit for boundary brainstorming, Spec, Execution Plan, execution, review, QA, and release readiness.
- Role lenses may prioritize and filter; they must not change canonical routes, object truth, lifecycle state, or gate validity.
- Prefer Tailwind theme utilities and shared primitives. Avoid route-local vanilla CSS and one-off visual containers.
- Keep dynamic route screenshots deterministic by using seeded fixture IDs.

## Planned File Structure

### Shared Product Contract

- Create: `apps/web/src/features/product-surfaces/route-contract.ts`
  - Owns canonical product route families, retired route fixtures, screenshot route list, route-family metadata, and command/search entries.
- Create: `apps/web/src/features/product-surfaces/first-viewport-contract.ts`
  - Owns route-family marker names and page-family constants used by app code and tests.
- Create: `tests/web/helpers/first-viewport-contract.ts`
  - Testing Library helper that asserts heading, state, next action, role/owner, risk/blocker, and page-family marker.
- Create: `tests/web/helpers/product-route-config.ts`
  - Test-only helper that flattens `apps/web/src/app/routes.ts` so route-contract tests can reject unclassified public routes.
- Create: `tests/web/product-grade-first-viewport.test.tsx`
  - Shared first-viewport contract tests that every page-family task extends before broad screenshot checks run.
- Modify: `tests/e2e/helpers/capture-route-screenshots.ts`
  - Reuse route manifest and assert first-viewport contract for screenshots.

### Shared Layout And UI

- Modify: `apps/web/src/shared/styles/theme.css`
  - Tighten product-grade tokens and keep global CSS limited to Tailwind theme/base rules.
- Modify: `apps/web/src/shared/layout/index.ts`
  - Export new primitives.
- Modify: `apps/web/src/shared/layout/section/section.tsx`
  - Make `Section` an unframed page section by default, with explicit `variant="panel"` for bounded surfaces.
- Modify: `apps/web/src/shared/ui/table/table.tsx`
  - Add selected row, density, sticky header, and contained table-scroll support.
- Create: `apps/web/src/shared/layout/workspace-page/workspace-page.tsx`
- Create: `apps/web/src/shared/layout/object-workspace/object-workspace.tsx`
- Create: `apps/web/src/shared/layout/queue-workspace/queue-workspace.tsx`
- Create: `apps/web/src/shared/layout/planning-table-workspace/planning-table-workspace.tsx`
- Create: `apps/web/src/shared/layout/gate-workspace/gate-workspace.tsx`
- Create: `apps/web/src/shared/layout/action-strip/action-strip.tsx`
- Create: `apps/web/src/shared/layout/priority-summary/priority-summary.tsx`
- Create: `apps/web/src/shared/layout/compact-metadata/compact-metadata.tsx`
- Create: `apps/web/src/shared/layout/gate-progress/gate-progress.tsx`
- Create: `apps/web/src/shared/layout/preview-pane/preview-pane.tsx`
- Create: `apps/web/src/shared/layout/evidence-drawer/evidence-drawer.tsx`
- Create: `apps/web/src/shared/layout/revision-drawer/revision-drawer.tsx`
- Create: `apps/web/src/shared/ui/error-state/error-state.tsx`
- Modify: `apps/web/src/shared/design-system/docs/component-guidelines.md`
  - Document when to use each primitive and anti-patterns that fail review.

### Shell And Navigation

- Modify: `apps/web/src/app/routes.ts`
- Modify: `apps/web/src/app/routes/_index.tsx`
- Modify: `apps/web/src/app/routes/_layout.tsx`
- Modify: `apps/web/src/app/routes/dashboard/index.tsx`
- Create: `apps/web/src/app/routes/cockpit/index.tsx`
- Create: `apps/web/src/features/cockpit/cockpit-route.tsx`
- Create: `apps/web/src/shared/navigation/product-navigation.ts`
- Create: `apps/web/src/shared/navigation/command-search.tsx`
- Modify: `apps/web/src/shared/layout/app-shell/app-shell.tsx`
- Modify: `apps/web/src/shared/layout/sidebar-nav/sidebar-nav.tsx`
- Modify: `apps/web/src/shared/layout/topbar/topbar.tsx`

### Presentation View Models

- Create: `apps/web/src/features/product-surfaces/view-model-types.ts`
- Create: `apps/web/src/features/cockpit/cockpit-view-model.ts`
- Create: `apps/web/src/features/my-work/my-work-view-model.ts`
- Create: `apps/web/src/features/project-management/source-object-view-model.ts`
- Create: `apps/web/src/features/development-plans/development-plan-view-model.ts`
- Create: `apps/web/src/features/spec-plan/spec-plan-view-model.ts`
- Create: `apps/web/src/features/executions/execution-view-model.ts`
- Create: `apps/web/src/features/releases/release-view-model.ts`
- Create: `apps/web/src/features/reports/report-view-model.ts`
- Create: `docs/superpowers/reports/product-grade-visual-system-projection-inventory.md`
  - Documents, before page rewrites, which existing projections or derived adapter fields satisfy every UX-required field and confirms no fake fixture-only fields are allowed.

### Page Families

- Modify: `apps/web/src/features/my-work/my-work-route.tsx`
- Modify: `apps/web/src/features/project-management/object-list.tsx`
- Modify: `apps/web/src/features/project-management/object-detail-layout.tsx`
- Modify: `apps/web/src/features/project-management/object-forms.tsx`
- Modify source-object evidence route modules only:
  - `apps/web/src/app/routes/requirements/$requirementId/evidence.tsx`;
  - `apps/web/src/app/routes/initiatives/$initiativeId/evidence.tsx`;
  - `apps/web/src/app/routes/bugs/$bugId/evidence.tsx`;
  - `apps/web/src/app/routes/tech-debt/$techDebtId/evidence.tsx`.
- Modify: `apps/web/src/features/development-plans/development-plans-route.tsx`
- Modify: `apps/web/src/features/development-plans/development-plan-detail-route.tsx`
- Modify: `apps/web/src/features/development-plans/development-plan-table.tsx`
- Modify: `apps/web/src/features/development-plans/development-plan-item-detail-route.tsx`
- Modify: `apps/web/src/features/development-plans/plan-item-gates.tsx`
- Modify: `apps/web/src/features/spec-plan/spec-execution-plan-queue.tsx`
- Modify: `apps/web/src/features/executions/executions-route.tsx`
- Modify: `apps/web/src/features/executions/execution-detail-route.tsx`
- Modify: `apps/web/src/features/board/board-route.tsx`
- Modify: `apps/web/src/features/releases/release-routes.tsx`
- Modify: `apps/web/src/features/reports/reports-routes.tsx`

### Tests And Fixtures

- Create: `tests/web/product-grade-route-contract.test.tsx`
- Create: `tests/web/product-grade-layout-primitives.test.tsx`
- Create: `tests/web/product-grade-first-viewport.test.tsx`
- Create: `tests/web/product-grade-view-models.test.ts`
- Modify: `tests/web/router-test-utils.tsx`
- Modify: `tests/web/project-management-routes.test.tsx`
- Modify: `tests/web/development-plan-routes.test.tsx`
- Modify: `tests/web/my-work-route.test.tsx`
- Modify: `tests/web/board-reports-release-readiness.test.tsx`
- Modify: `tests/web/executions-routes.test.tsx`
- Modify: `tests/web/app-shell-routing.test.tsx`
- Modify: `tests/web/responsive-layout.test.tsx`
- Modify: `tests/web/a11y-gates.test.tsx`
- Modify: `tests/web/design-system.test.tsx`
- Modify: `tests/web/no-legacy-web-ui.test.ts`
- Modify: `tests/web/fixtures/product-data.ts`
- Modify: `tests/web/fixtures/product-api-mock.ts`
- Modify: `tests/e2e/ai-native-project-management-visual.e2e.test.ts`
- Modify: `tests/e2e/helpers/capture-route-screenshots.ts`

## Fixture IDs

Use these seeded IDs for dynamic route tests and screenshots:

- Requirement: `req-1`
- Initiative: `init-1`
- Bug: `bug-1`
- Tech Debt: `td-1`
- Development Plan: `development-plan-web-product`
- Development Plan Item: `development-plan-item-web-product`
- Execution: `execution-web-product`
- Release: `release-web-product`

## Task 1: Route Contract And First-Viewport Test Harness

**Files:**
- Create: `apps/web/src/features/product-surfaces/route-contract.ts`
- Create: `apps/web/src/features/product-surfaces/first-viewport-contract.ts`
- Create: `tests/web/helpers/first-viewport-contract.ts`
- Create: `tests/web/helpers/product-route-config.ts`
- Create: `tests/web/product-grade-route-contract.test.tsx`
- Create: `tests/web/product-grade-first-viewport.test.tsx`
- Modify: `tests/e2e/helpers/capture-route-screenshots.ts`

- [ ] **Step 1: Write the failing route-contract tests**

Add tests equivalent to:

```tsx
import { describe, expect, it } from 'vitest';

import {
  canonicalProductRoutes,
  productCommandItems,
  requiredScreenshotRoutes,
  retiredProductRoutes,
} from '../../apps/web/src/features/product-surfaces/route-contract';
import appRouteConfig from '../../apps/web/src/app/routes';
import { flattenProductRouteConfig } from './helpers/product-route-config';

describe('product-grade route contract', () => {
  const expectedProductRoutes = [
    '/',
    '/cockpit',
    '/my-work',
    '/requirements',
    '/requirements/new',
    '/requirements/:id',
    '/requirements/:id/evidence',
    '/initiatives',
    '/initiatives/new',
    '/initiatives/:id',
    '/initiatives/:id/evidence',
    '/bugs',
    '/bugs/new',
    '/bugs/:id',
    '/bugs/:id/evidence',
    '/tech-debt',
    '/tech-debt/new',
    '/tech-debt/:id',
    '/tech-debt/:id/evidence',
    '/development-plans',
    '/development-plans/new',
    '/development-plans/:id',
    '/development-plans/:id/items/:itemId',
    '/development-plans/:id/items/:itemId/brainstorming',
    '/development-plans/:id/items/:itemId/spec',
    '/development-plans/:id/items/:itemId/execution-plan',
    '/development-plans/:id/items/:itemId/execution',
    '/specs-plans',
    '/executions',
    '/executions/:id',
    '/board',
    '/releases',
    '/releases/:id',
    '/releases/:id/evidence',
    '/reports',
    '/reports/delivery',
    '/reports/quality',
    '/reports/release-readiness',
    '/reports/observation',
  ];

  const expectedRetiredSmokeRoutes = [
    '/dashboard',
    '/plans',
    '/plans/:id',
    '/specs',
    '/specs/:id',
    '/tasks',
    '/tasks/:id',
  ];

  const expectedScreenshotRoutes = [
    '/',
    '/cockpit',
    '/dashboard',
    '/my-work',
    ...expectedProductRoutes.filter((path) => !['/', '/cockpit', '/my-work'].includes(path)),
  ];

  it('covers every required product route family exactly', () => {
    expect(canonicalProductRoutes.map((route) => route.path)).toEqual(expectedProductRoutes);
    expect(requiredScreenshotRoutes.map((route) => route.path)).toEqual(expectedScreenshotRoutes);
  });

  it('keeps retired route families out of command search', () => {
    const commandText = JSON.stringify(productCommandItems);
    for (const route of retiredProductRoutes) {
      expect(commandText).not.toContain(route.path);
    }
    expect(retiredProductRoutes.map((route) => route.path)).toEqual(expectedRetiredSmokeRoutes);
  });

  it('requires screenshot fixtures for every route family', () => {
    expect(requiredScreenshotRoutes.every((route) => route.viewports.join(',') === '1440,1024,768,375')).toBe(true);
    expect(requiredScreenshotRoutes.every((route) => route.concretePath.length > 0)).toBe(true);
  });

  it('classifies every registered public router path', () => {
    const registeredPaths = flattenProductRouteConfig(appRouteConfig);
    const classified = new Set([
      ...canonicalProductRoutes.map((route) => route.path.replace(/^\//, '')),
      'dashboard',
      'dev-tools',
      '*',
      '',
    ]);

    expect(registeredPaths.filter((path) => !classified.has(path))).toEqual([]);
    expect(registeredPaths.join('\n')).not.toMatch(/(^|\/)(tasks|plans|specs|packages|runs|reviews|replay)(\/|$)/);
  });
});
```

- [ ] **Step 2: Run the route-contract test and verify it fails**

Run: `pnpm vitest run tests/web/product-grade-route-contract.test.tsx tests/web/product-grade-first-viewport.test.tsx`

Expected: FAIL because `route-contract.ts`, the route-config helper, first-viewport tests, and contract exports do not exist yet.

- [ ] **Step 3: Implement route contract exports**

Create `route-contract.ts` with typed route descriptors:

```ts
export type ProductRouteKind = 'product' | 'retired' | 'dev-tools';
export type ProductPageFamily =
  | 'cockpit'
  | 'queue'
  | 'source-object-list'
  | 'source-object-authoring'
  | 'source-object-detail'
  | 'evidence'
  | 'development-plan-index'
  | 'development-plan-detail'
  | 'gate-workspace'
  | 'governance-queue'
  | 'execution-list'
  | 'execution-detail'
  | 'board'
  | 'release'
  | 'report';

export interface ProductRouteContract {
  path: string;
  concretePath: string;
  label: string;
  family: ProductPageFamily;
  kind: ProductRouteKind;
  heading: RegExp;
  viewports: readonly [1440, 1024, 768, 375];
}

export const visualViewports = [1440, 1024, 768, 375] as const;
```

Populate `canonicalProductRoutes`, `requiredScreenshotRoutes`, `retiredProductRoutes`, and `productCommandItems` from the approved spec. Use concrete paths such as `/requirements/req-1` for dynamic screenshot fixtures. `requiredScreenshotRoutes` must equal the full spec screenshot manifest exactly, with `/dashboard` included as the retired-route screenshot, and it must spell out `/reports`, `/reports/delivery`, `/reports/quality`, `/reports/release-readiness`, and `/reports/observation` instead of using a catch-all label.

- [ ] **Step 4: Implement first-viewport shared contract constants**

Create `first-viewport-contract.ts` with:

```ts
export const firstViewportContract = {
  pageFamilyAttribute: 'data-page-family',
  workspaceLayoutAttribute: 'data-workspace-layout',
  currentStateTestId: 'current-state',
  nextActionTestId: 'next-action',
  roleResponsibilityTestId: 'role-responsibility',
  blockerRiskTestId: 'blocker-risk',
} as const;
```

- [ ] **Step 5: Implement the test helpers and first-viewport test file**

Create `tests/web/helpers/first-viewport-contract.ts` with an assertion helper that checks `h1`, `[data-testid="current-state"]`, `[data-testid="next-action"]`, `[data-testid="role-responsibility"]`, `[data-testid="blocker-risk"]`, and a page-family marker. The helper must assert that each required affordance is visible and has non-empty accessible/text content. Current state, disabled reason, blocker/risk, and status affordances must not be empty wrappers or color-only badges.

Create `tests/web/helpers/product-route-config.ts` to flatten `apps/web/src/app/routes.ts` into route paths for the route-contract test. It must normalize route parameter names to the canonical contract names before comparison, for example `requirements/:requirementId` becomes `requirements/:id`, `executions/:executionId` becomes `executions/:id`, and `development-plans/:developmentPlanId/items/:itemId` remains `development-plans/:id/items/:itemId`.

Create `tests/web/product-grade-first-viewport.test.tsx` with an initial fixture-page test for the helper itself. Page-family tasks extend this file as routes are upgraded; do not wait until final screenshot closure to introduce the first-viewport contract.

- [ ] **Step 6: Run the route-contract test and verify it passes**

Run: `pnpm vitest run tests/web/product-grade-route-contract.test.tsx tests/web/product-grade-first-viewport.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/product-surfaces/route-contract.ts apps/web/src/features/product-surfaces/first-viewport-contract.ts tests/web/helpers/first-viewport-contract.ts tests/web/helpers/product-route-config.ts tests/web/product-grade-route-contract.test.tsx tests/web/product-grade-first-viewport.test.tsx tests/e2e/helpers/capture-route-screenshots.ts
git commit -m "test: define product-grade route contract"
```

## Task 2: Visual-System Tokens And Shared Layout Primitives

**Files:**
- Modify: `apps/web/src/shared/styles/theme.css`
- Modify: `apps/web/src/shared/layout/index.ts`
- Modify: `apps/web/src/shared/layout/section/section.tsx`
- Modify: `apps/web/src/shared/ui/table/table.tsx`
- Create: `apps/web/src/shared/ui/error-state/error-state.tsx`
- Create: shared layout primitive files listed in "Shared Layout And UI"
- Modify: `apps/web/src/shared/design-system/docs/component-guidelines.md`
- Create: `tests/web/product-grade-layout-primitives.test.tsx`
- Modify: `tests/web/design-system.test.tsx`

- [ ] **Step 1: Write failing primitive contract tests**

Test the new primitives directly. Include checks that:

- `WorkspacePage` renders `data-page-family` and `data-workspace-layout`;
- `ActionStrip` exposes `data-testid="next-action"`;
- `PrioritySummary` exposes current state, role/responsibility, and blocker/risk affordances;
- `GateProgress` renders named gates with text labels, status text, and the current gate without relying on color alone;
- `EmptyState`, `Skeleton`, `InlineNotice`, and `ErrorState` preserve page layout and do not create large blank primary surfaces;
- `Section` default output is unframed and `variant="panel"` is explicit;
- `DataTable` keeps overflow inside its own container and supports selected rows.

Run: `pnpm vitest run tests/web/product-grade-layout-primitives.test.tsx tests/web/design-system.test.tsx`

Expected: FAIL because primitives and new Section/DataTable behavior do not exist yet.

- [ ] **Step 2: Update Tailwind theme tokens**

Keep `@import "tailwindcss";` and `@theme`, but tune tokens toward a mature neutral operational UI:

- background off-white/light slate;
- surface and subtle selected/preview surfaces;
- balanced blue, green, amber, red, info tokens;
- radius mostly 6-8px;
- shadows only for overlays, drawers, menus, and raised active surfaces;
- no viewport-scaled fonts and no negative letter spacing.

- [ ] **Step 3: Make `Section` unframed by default**

Change `SectionProps` to include `variant?: 'plain' | 'panel' | 'subtle'`. Default to `plain`. Use `panel` only for bounded summaries, previews, drawers, repeated item groups, and modals.

- [ ] **Step 4: Implement `WorkspacePage`**

Create a wrapper that owns page-family markers, first viewport, optional action strip, and content regions:

```tsx
export interface WorkspacePageProps {
  children: React.ReactNode;
  family: string;
  heading: React.ReactNode;
  state: React.ReactNode;
  nextAction: React.ReactNode;
  roleResponsibility: React.ReactNode;
  blockerRisk: React.ReactNode;
  layout: string;
  subtitle?: React.ReactNode;
  toolbar?: React.ReactNode;
}
```

- [ ] **Step 5: Implement specialized workspace primitives**

Build `ObjectWorkspace`, `QueueWorkspace`, `PlanningTableWorkspace`, and `GateWorkspace` by composing `WorkspacePage`, not by duplicating page scaffolding.

- [ ] **Step 6: Implement action, progress, and metadata primitives**

Build `ActionStrip`, `PrioritySummary`, `GateProgress`, `CompactMetadata`, `PreviewPane`, `EvidenceDrawer`, `RevisionDrawer`, and layout-preserving `ErrorState` variants. Use existing `Button`, `StatusPill`, `Drawer`, `InlineNotice`, and `Timeline`.

- [ ] **Step 7: Upgrade `DataTable`**

Add:

- `density?: 'compact' | 'normal'`;
- `selectedRowKey?: string`;
- `onSelectRow?: (row: T) => void`;
- `stickyHeader?: boolean`;
- `containedScroll?: boolean`;
- stable `data-table-scroll-container` marker.

Keep mobile cards but preserve title, state, next action, risk, and current gate ordering where supplied by columns.

- [ ] **Step 8: Update guidelines**

Document:

- page sections are not cards;
- cards are for repeated items, previews, drawers, and bounded summaries;
- first viewport must expose state/action/role/risk hooks;
- metadata must use `CompactMetadata`, not large card grids.
- anti-pattern tests must flag card-in-card markers, metadata-card-sprawl markers, and raw runtime dominant-title markers.

- [ ] **Step 9: Run primitive tests and typecheck**

Run:

```bash
pnpm vitest run tests/web/product-grade-layout-primitives.test.tsx tests/web/design-system.test.tsx
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/shared/styles/theme.css apps/web/src/shared/layout/index.ts apps/web/src/shared/layout/section/section.tsx apps/web/src/shared/ui/table/table.tsx apps/web/src/shared/ui/error-state/error-state.tsx apps/web/src/shared/layout/workspace-page/workspace-page.tsx apps/web/src/shared/layout/object-workspace/object-workspace.tsx apps/web/src/shared/layout/queue-workspace/queue-workspace.tsx apps/web/src/shared/layout/planning-table-workspace/planning-table-workspace.tsx apps/web/src/shared/layout/gate-workspace/gate-workspace.tsx apps/web/src/shared/layout/action-strip/action-strip.tsx apps/web/src/shared/layout/priority-summary/priority-summary.tsx apps/web/src/shared/layout/compact-metadata/compact-metadata.tsx apps/web/src/shared/layout/gate-progress/gate-progress.tsx apps/web/src/shared/layout/preview-pane/preview-pane.tsx apps/web/src/shared/layout/evidence-drawer/evidence-drawer.tsx apps/web/src/shared/layout/revision-drawer/revision-drawer.tsx apps/web/src/shared/design-system/docs/component-guidelines.md tests/web/product-grade-layout-primitives.test.tsx tests/web/design-system.test.tsx
git commit -m "feat: add product-grade layout primitives"
```

## Task 3: Presentation View Models, Projection Inventory, And Fixture Manifest

**Files:**
- Create: `apps/web/src/features/product-surfaces/view-model-types.ts`
- Create: `apps/web/src/features/cockpit/cockpit-view-model.ts`
- Create: `apps/web/src/features/my-work/my-work-view-model.ts`
- Create: view-model files listed in "Presentation View Models"
- Modify: `tests/web/fixtures/product-data.ts`
- Modify: `tests/web/fixtures/product-api-mock.ts`
- Create: `tests/web/product-grade-view-models.test.ts`
- Create: `docs/superpowers/reports/product-grade-visual-system-projection-inventory.md`

- [ ] **Step 1: Write failing view-model and projection-inventory tests**

Create tests for adapter output names:

```ts
expect(sourceObjectListViewModel(requirementDetail)).toMatchObject({
  objectLabel: 'Checkout requirement',
  objectType: 'Requirement',
  currentState: expect.any(String),
  nextAction: expect.any(String),
  primaryActorOrRole: expect.any(String),
  riskSignal: expect.any(String),
});
```

Also test Cockpit, My Work, Development Plan, Plan Item, Execution, Release, and Report adapters. Include negative tests proving adapters do not invent unavailable data from fixtures:

- missing bulk action eligibility renders a disabled "No shared safe bulk action" state;
- missing source evidence status renders an unavailable evidence summary instead of a fake ready state;
- missing execution PR/diff/test evidence renders "Evidence unavailable" compact text;
- missing release approval or rollback details renders disabled action reasons;
- missing report signal renders an "Insufficient signal" conclusion and no fake suggested action.

Run: `pnpm vitest run tests/web/product-grade-view-models.test.ts`

Expected: FAIL because adapters do not exist.

- [ ] **Step 2: Write the projection inventory before page rewrites**

Create `docs/superpowers/reports/product-grade-visual-system-projection-inventory.md` with a table for every projection-sensitive UX field. This visual closure plans no backend/API projection exceptions. Each required field must be satisfied by an existing projection, a derived adapter field, or a truthful degraded state:

| UX field | Existing or derived source | Required degraded fallback | Projection exception |
| --- | --- | --- | --- |
| Safe bulk action eligibility | Existing scoped `ProductAction` command metadata, selected-row object refs, and disabled reasons | Disabled bulk-action region with "No shared safe bulk action" | None planned |
| Source evidence status | Existing attachment, evidence, relationship, and unavailable/degraded source data | Evidence readiness unavailable/stale block | None planned |
| Execution PR/diff/test evidence | Existing execution evidence refs, changed-file summaries, check-result summaries, and lifecycle events where present | Compact "Evidence unavailable" state with recovery link if available | None planned |
| Release approvals and rollback disabled reasons | Existing release readiness/cockpit data plus command disabled reasons | Launch/rollback disabled with explicit missing approval or blocker reason | None planned |
| Report conclusions and suggested actions | Existing report rows, degraded source flags, risk counts, and linked object refs | "Insufficient signal" conclusion and no enabled action | None planned |

If implementation discovers a field that cannot be derived or truthfully degraded, stop before the page-family task that needs it and amend this plan with the smallest projection exception plus contract/API tests. Do not fake the field in fixtures or spread raw API payloads directly into page JSX.

- [ ] **Step 3: Define shared view-model types**

In `view-model-types.ts`, define `ProductPageViewModel` and `FirstViewportViewModel` with fields:

- `objectLabel`;
- `objectType`;
- `currentState`;
- `nextAction`;
- `disabledReason`;
- `primaryActorOrRole`;
- `riskSignal`;
- `gateProgress`;
- `criticalEvidence`;
- `secondaryMetadata`;
- `previewSummary`;
- `timelineSummary`.

- [ ] **Step 4: Implement feature-level adapters**

Keep adapters close to feature modules. Do not spread raw API payloads directly inside page JSX after this task.

- [ ] **Step 5: Expand fixtures**

Ensure `product-data.ts` and `product-api-mock.ts` include at least one populated example for every dynamic route family in the spec. Add release evidence and source-object evidence data so evidence routes are not skipped.

- [ ] **Step 6: Run view-model tests**

Run: `pnpm vitest run tests/web/product-grade-view-models.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/product-surfaces/view-model-types.ts apps/web/src/features/cockpit/cockpit-view-model.ts apps/web/src/features/my-work/my-work-view-model.ts apps/web/src/features/project-management/source-object-view-model.ts apps/web/src/features/development-plans/development-plan-view-model.ts apps/web/src/features/spec-plan/spec-plan-view-model.ts apps/web/src/features/executions/execution-view-model.ts apps/web/src/features/releases/release-view-model.ts apps/web/src/features/reports/report-view-model.ts tests/web/product-grade-view-models.test.ts tests/web/fixtures/product-data.ts tests/web/fixtures/product-api-mock.ts docs/superpowers/reports/product-grade-visual-system-projection-inventory.md
git commit -m "feat: add product presentation view models"
```

## Task 4: Shell, Cockpit Route, Retired Dashboard, Navigation, And Command Search

**Files:**
- Modify: `apps/web/src/app/routes.ts`
- Modify: `apps/web/src/app/routes/_index.tsx`
- Modify: `apps/web/src/app/routes/_layout.tsx`
- Modify: `apps/web/src/app/routes/dashboard/index.tsx`
- Create: `apps/web/src/app/routes/cockpit/index.tsx`
- Create: `apps/web/src/features/cockpit/cockpit-route.tsx`
- Modify: `apps/web/src/features/cockpit/cockpit-view-model.ts`
- Create: `apps/web/src/shared/navigation/product-navigation.ts`
- Create: `apps/web/src/shared/navigation/command-search.tsx`
- Modify: `apps/web/src/shared/layout/app-shell/app-shell.tsx`
- Modify: `apps/web/src/shared/layout/sidebar-nav/sidebar-nav.tsx`
- Modify: `apps/web/src/shared/layout/topbar/topbar.tsx`
- Modify: `tests/web/router-test-utils.tsx`
- Modify: `tests/web/app-shell-routing.test.tsx`
- Modify: `tests/web/a11y-gates.test.tsx`
- Modify: `tests/web/project-management-routes.test.tsx`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`
- Modify: `tests/e2e/helpers/capture-route-screenshots.ts`

- [ ] **Step 1: Write failing shell tests**

Update tests so:

- `/` routes to `/cockpit` or renders Cockpit;
- `/cockpit` renders heading `Cockpit`;
- primary nav shows `Cockpit`, not `Dashboard`;
- `/dashboard` renders a retired/not-found safe state and not the old dashboard UI;
- command search suggestions do not include retired routes;
- Dev Tools remains gated behind runtime flags;
- Cockpit first viewport exposes non-empty current state, next action, role/responsibility, and blocker/risk text through the shared first-viewport contract.

Run:

```bash
pnpm vitest run tests/web/app-shell-routing.test.tsx tests/web/project-management-routes.test.tsx tests/web/a11y-gates.test.tsx tests/web/product-grade-first-viewport.test.tsx
```

Expected: FAIL because current shell still uses Dashboard as the product entry.

- [ ] **Step 2: Move navigation config out of `_layout.tsx`**

Create `product-navigation.ts` with canonical groups:

- Workspace: Cockpit, My Work;
- Discovery: Initiatives, Requirements, Bugs, Tech Debt;
- Planning: Development Plans, Specs & Execution Plans;
- Delivery: Board, Executions, Releases;
- Intelligence: Reports;
- Tools: Dev Tools only when enabled.

- [ ] **Step 3: Add Cockpit route through its view model**

Create `apps/web/src/features/cockpit/cockpit-route.tsx` from the current dashboard data, but transform it through `cockpit-view-model.ts` and render it through `WorkspacePage` with action-first sections:

- role-selected next-action queue;
- blockers and stale gates;
- active/resumable executions;
- Spec/Execution Plan review queue;
- QA and release readiness attention;
- compact health indicators.

Do not spread raw dashboard/query payloads directly in the route component.

- [ ] **Step 4: Update route config**

Add `route('cockpit', './routes/cockpit/index.tsx')`. Change `_index.tsx` to navigate to `/cockpit`.

- [ ] **Step 5: Retire dashboard safely**

Replace `DashboardRoute` with a product-safe retired state using shared `WorkspacePage` or `ProductNotFound` copy. It must not render the old dashboard metrics or links.

- [ ] **Step 6: Implement command search**

Create a topbar `CommandSearch` component using `productCommandItems`. It should render a searchbox plus accessible suggestions on focus/filter. It must include canonical object/report/command destinations only and no retired product routes.

- [ ] **Step 7: Update shell layout density**

Tune `AppShell`, `SidebarNav`, and `Topbar` so:

- desktop uses compact 16-17rem sidebar;
- topbar prioritizes command search, role lens, project context, and actor menu;
- runtime/dev status is compact and lower weight;
- mobile nav remains accessible and not in keyboard order while closed.

- [ ] **Step 8: Run shell tests**

Run:

```bash
pnpm vitest run tests/web/app-shell-routing.test.tsx tests/web/project-management-routes.test.tsx tests/web/a11y-gates.test.tsx tests/web/responsive-layout.test.tsx tests/web/product-grade-first-viewport.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app/routes.ts apps/web/src/app/routes/_index.tsx apps/web/src/app/routes/_layout.tsx apps/web/src/app/routes/dashboard/index.tsx apps/web/src/app/routes/cockpit/index.tsx apps/web/src/features/cockpit/cockpit-route.tsx apps/web/src/features/cockpit/cockpit-view-model.ts apps/web/src/shared/navigation/product-navigation.ts apps/web/src/shared/navigation/command-search.tsx apps/web/src/shared/layout/app-shell/app-shell.tsx apps/web/src/shared/layout/sidebar-nav/sidebar-nav.tsx apps/web/src/shared/layout/topbar/topbar.tsx tests/web/router-test-utils.tsx tests/web/app-shell-routing.test.tsx tests/web/a11y-gates.test.tsx tests/web/project-management-routes.test.tsx tests/web/responsive-layout.test.tsx tests/web/product-grade-first-viewport.test.tsx tests/e2e/helpers/capture-route-screenshots.ts
git commit -m "feat: add cockpit shell and retire dashboard"
```

## Task 5: My Work Role-Aware Queue Workspace

**Files:**
- Modify: `apps/web/src/features/my-work/my-work-route.tsx`
- Modify: `apps/web/src/features/my-work/my-work-view-model.ts`
- Modify: `tests/web/my-work-route.test.tsx`
- Modify: `tests/web/my-work-board-reports.test.tsx`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`
- Modify: `tests/e2e/helpers/capture-route-screenshots.ts`

- [ ] **Step 1: Write failing My Work tests**

Assert `/my-work` renders:

- `data-page-family="queue"`;
- `data-workspace-layout="queue-workspace"`;
- visible `h1` heading;
- current-state affordance with non-empty text;
- next-action region with enabled action or disabled reason text;
- role/responsibility affordance with non-empty text;
- blocker/risk affordance with non-empty text when blocked, stale, failed, high-risk, or degraded;
- grouped queue rows for Product, Tech Lead, Developer, QA, Release, and Manager attention;
- filter chips for role, status, gate, and risk;
- selected item preview with next action and disabled reason;
- safe bulk action surface only when scoped actions are present.

Run:

```bash
pnpm vitest run tests/web/my-work-route.test.tsx tests/web/my-work-board-reports.test.tsx tests/web/product-grade-first-viewport.test.tsx
```

Expected: FAIL because `/my-work` still renders grouped sections without the product-grade queue workspace and preview contract.

- [ ] **Step 2: Refactor `/my-work` to `QueueWorkspace`**

Use the shared `QueueWorkspace`, `ActionStrip`, `PrioritySummary`, `PreviewPane`, `CompactMetadata`, and `DataTable` primitives. Keep the current role grouping logic, but make role lens filtering and row preview explicit. Render through `my-work-view-model.ts`; do not spread raw query payloads in the route component.

- [ ] **Step 3: Add safe bulk actions**

Render a compact bulk action region only when selected rows share the same scoped safe command. When no safe bulk action exists, show the disabled reason from `my-work-view-model.ts` in the next-action region instead of hiding the control.

- [ ] **Step 4: Preserve canonical object navigation**

Keep `typedHrefFor()` canonical: source objects go to typed source routes, Development Plan Items go to item gate routes, Specs and Execution Plans go to `/specs-plans`, executions go to product supervision routes or board focus, and raw runtime browsers remain absent.

- [ ] **Step 5: Run My Work tests**

Run:

```bash
pnpm vitest run tests/web/my-work-route.test.tsx tests/web/my-work-board-reports.test.tsx tests/web/product-grade-first-viewport.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/my-work/my-work-route.tsx apps/web/src/features/my-work/my-work-view-model.ts tests/web/my-work-route.test.tsx tests/web/my-work-board-reports.test.tsx tests/web/product-grade-first-viewport.test.tsx tests/e2e/helpers/capture-route-screenshots.ts
git commit -m "feat: upgrade my work queue workspace"
```

## Task 6: Source Object Lists

**Files:**
- Modify: `apps/web/src/features/project-management/object-list.tsx`
- Modify: `apps/web/src/features/requirements/requirements-routes.tsx`
- Modify: `apps/web/src/features/initiatives/initiatives-routes.tsx`
- Modify: `apps/web/src/features/bugs/bugs-routes.tsx`
- Modify: `apps/web/src/features/tech-debt/tech-debt-routes.tsx`
- Modify: `tests/web/project-management-routes.test.tsx`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`

- [ ] **Step 1: Write failing list tests**

Assert each source list renders:

- `data-page-family="source-object-list"`;
- heading;
- current-state affordance;
- next-action region;
- role/responsibility;
- blocker/risk;
- dense list/table rows with object type, gate/status, risk, role/actor, linked Development Plan state, next action, last meaningful update.

Run: `pnpm vitest run tests/web/project-management-routes.test.tsx tests/web/product-grade-first-viewport.test.tsx`

Expected: FAIL because current source lists still use a generic page header plus framed section.

- [ ] **Step 2: Refactor `ObjectList` to `QueueWorkspace`**

Render source lists with:

- compact toolbar: filter chips/search/view options;
- dense rows at desktop;
- compact mobile cards preserving priority order;
- preview affordance or primary link;
- empty state with create and planning action.

- [ ] **Step 3: Use source-object view models**

Transform API list items through `sourceObjectListViewModel`. Do not let raw `driver_actor_id` dominate the row; show it as responsibility text.

- [ ] **Step 4: Run list tests**

Run:

```bash
pnpm vitest run tests/web/project-management-routes.test.tsx tests/web/product-grade-first-viewport.test.tsx
```

Expected: PASS for source list routes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/project-management/object-list.tsx apps/web/src/features/requirements/requirements-routes.tsx apps/web/src/features/initiatives/initiatives-routes.tsx apps/web/src/features/bugs/bugs-routes.tsx apps/web/src/features/tech-debt/tech-debt-routes.tsx tests/web/project-management-routes.test.tsx tests/web/product-grade-first-viewport.test.tsx
git commit -m "feat: upgrade source object lists"
```

## Task 7: Source Object Detail And Authoring Workspaces

**Files:**
- Modify: `apps/web/src/features/project-management/object-detail-layout.tsx`
- Modify: `apps/web/src/features/project-management/object-forms.tsx`
- Modify source object route feature modules:
  - `apps/web/src/features/requirements/requirements-routes.tsx`;
  - `apps/web/src/features/initiatives/initiatives-routes.tsx`;
  - `apps/web/src/features/bugs/bugs-routes.tsx`;
  - `apps/web/src/features/tech-debt/tech-debt-routes.tsx`.
- Modify: `tests/web/project-management-routes.test.tsx`
- Modify: `tests/web/markdown-editor-rich-mode.test.tsx`
- Modify: `tests/web/markdown-editor-attachments.test.tsx`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`

- [ ] **Step 1: Write failing detail and authoring tests**

Assert:

- detail pages use `ObjectWorkspace`;
- direct Spec/Execution Plan generation buttons are absent;
- Development Plan create/generate/link/add-row actions are present;
- narrative is a document surface, not tiny artifact rows;
- structured fields use compact side metadata;
- authoring routes use `ForgeMarkdownEditor` through the shared wrapper, not a plain narrative textarea;
- unsaved-change state and validation summary are visible.

Run:

```bash
pnpm vitest run tests/web/project-management-routes.test.tsx tests/web/markdown-editor-rich-mode.test.tsx tests/web/markdown-editor-attachments.test.tsx tests/web/product-grade-first-viewport.test.tsx
```

Expected: FAIL because create routes still use a plain `Textarea` for narrative and detail pages still use old section/card patterns.

- [ ] **Step 2: Refactor detail layout to `ObjectWorkspace`**

Move the first viewport into:

- action strip;
- document column;
- compact properties side panel;
- linked Development Plans and Plan Items;
- evidence count/risk/release compact metadata.

- [ ] **Step 3: Move secondary context out of first viewport**

Revision history, full evidence timeline, attachments, and raw relationship lists must move to drawers, tabs below the action-first area, or lower sections.

- [ ] **Step 4: Replace authoring narrative textarea with `ForgeMarkdownEditor`**

Keep structured fields structured. Use the existing attachment/evidence model for image insertion. Preserve the current `createNarrativeDocument` behavior.

- [ ] **Step 5: Add unsaved and validation states**

Expose:

- inline field errors near fields;
- compact validation summary;
- visible unsaved-change notice when structured or narrative values change;
- destructive navigation warning or cancel confirmation if the implementation has an existing dialog pattern available.

- [ ] **Step 6: Run source detail/authoring tests**

Run:

```bash
pnpm vitest run tests/web/project-management-routes.test.tsx tests/web/markdown-editor-rich-mode.test.tsx tests/web/markdown-editor-attachments.test.tsx tests/web/product-grade-first-viewport.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/project-management/object-detail-layout.tsx apps/web/src/features/project-management/object-forms.tsx apps/web/src/features/requirements/requirements-routes.tsx apps/web/src/features/initiatives/initiatives-routes.tsx apps/web/src/features/bugs/bugs-routes.tsx apps/web/src/features/tech-debt/tech-debt-routes.tsx tests/web/project-management-routes.test.tsx tests/web/markdown-editor-rich-mode.test.tsx tests/web/markdown-editor-attachments.test.tsx tests/web/product-grade-first-viewport.test.tsx
git commit -m "feat: upgrade source object workspaces"
```

## Task 8: Source Object Evidence Routes

**Files:**
- Modify: `apps/web/src/app/routes/requirements/$requirementId/evidence.tsx`
- Modify: `apps/web/src/app/routes/initiatives/$initiativeId/evidence.tsx`
- Modify: `apps/web/src/app/routes/bugs/$bugId/evidence.tsx`
- Modify: `apps/web/src/app/routes/tech-debt/$techDebtId/evidence.tsx`
- Create: `apps/web/src/features/project-management/object-evidence-route.tsx`
- Modify: `tests/web/project-management-routes.test.tsx`
- Modify: `tests/web/attachment-evidence-rendering.test.tsx`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`

- [ ] **Step 1: Write failing evidence route tests**

Assert `/requirements/req-1/evidence`, `/initiatives/init-1/evidence`, `/bugs/bug-1/evidence`, and `/tech-debt/td-1/evidence` render product-grade evidence workspaces, not `ScaffoldRoute`.

Run:

```bash
pnpm vitest run tests/web/project-management-routes.test.tsx tests/web/attachment-evidence-rendering.test.tsx tests/web/product-grade-first-viewport.test.tsx
```

Expected: FAIL because source evidence routes are currently scaffold placeholders.

- [ ] **Step 2: Implement shared source evidence route**

Use `ObjectWorkspace` or `WorkspacePage` with:

- evidence readiness summary first;
- relevance and missing/stale/unavailable evidence states;
- attachments/evidence list below;
- raw artifact links secondary and scoped.

- [ ] **Step 3: Wire each source evidence route**

Each route should read its source object query and pass object type, ID, title, attachments, relationship refs, and evidence status to the shared component.

- [ ] **Step 4: Run evidence tests**

Run:

```bash
pnpm vitest run tests/web/project-management-routes.test.tsx tests/web/attachment-evidence-rendering.test.tsx tests/web/product-grade-first-viewport.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'apps/web/src/app/routes/requirements/$requirementId/evidence.tsx' 'apps/web/src/app/routes/initiatives/$initiativeId/evidence.tsx' 'apps/web/src/app/routes/bugs/$bugId/evidence.tsx' 'apps/web/src/app/routes/tech-debt/$techDebtId/evidence.tsx' apps/web/src/features/project-management/object-evidence-route.tsx tests/web/project-management-routes.test.tsx tests/web/attachment-evidence-rendering.test.tsx tests/web/product-grade-first-viewport.test.tsx
git commit -m "feat: add source evidence workspaces"
```

## Task 9: Development Plans Index And Create/Generate Workspace

**Files:**
- Modify: `apps/web/src/features/development-plans/development-plans-route.tsx`
- Modify: `apps/web/src/shared/api/commands.ts` only if existing command helpers already support the needed call shape and need typing alignment
- Modify: `tests/web/development-plan-routes.test.tsx`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`
- Modify: `tests/e2e/ai-native-project-management-visual.e2e.test.ts`

- [ ] **Step 1: Write failing index/new tests**

Assert:

- `/development-plans` uses `PlanningTableWorkspace` index;
- index has active plan table/list, filters, create action, AI-assisted generate action, risk/blocked summary, and useful empty state;
- `/development-plans/new` is a real authoring workspace, not an empty "pick source first" placeholder;
- create/generate controls collect source context without implying direct Spec or Execution Plan generation.

Run: `pnpm vitest run tests/web/development-plan-routes.test.tsx tests/web/product-grade-first-viewport.test.tsx`

Expected: FAIL because `/development-plans/new` is still mostly a placeholder.

- [ ] **Step 2: Upgrade `/development-plans` index**

Render with `PlanningTableWorkspace` and compact filters for source type, role, gate, risk, and status. Keep source links and plan item counts visible.

- [ ] **Step 3: Implement `/development-plans/new` authoring**

Support:

- manual title/source selection/guidance;
- AI-assisted plan generation inputs;
- validation summary;
- explicit copy that downstream artifacts are generated only from Plan Items after boundary approval.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm vitest run tests/web/development-plan-routes.test.tsx tests/web/product-grade-first-viewport.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/development-plans/development-plans-route.tsx tests/web/development-plan-routes.test.tsx tests/web/product-grade-first-viewport.test.tsx tests/e2e/ai-native-project-management-visual.e2e.test.ts
# If Step 3 touched command helper typing, also stage that exact file:
# git add apps/web/src/shared/api/commands.ts
git commit -m "feat: upgrade development plan index and authoring"
```

## Task 10: Development Plan Detail Table And Preview

**Files:**
- Modify: `apps/web/src/features/development-plans/development-plan-detail-route.tsx`
- Modify: `apps/web/src/features/development-plans/development-plan-table.tsx`
- Modify: `apps/web/src/features/development-plans/development-plan-view-model.ts`
- Modify: `tests/web/development-plan-routes.test.tsx`
- Modify: `tests/web/responsive-layout.test.tsx`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`

- [ ] **Step 1: Write failing table/preview tests**

Assert:

- desktop 1440 shows prioritized columns: Plan Item, role, risk, Boundary, Spec, Execution Plan, Execution, Review, QA, Release impact, Next action;
- 1024 view uses current gate/gate progress summary instead of cramming every field;
- table overflow is contained inside table region;
- first column and next-action affordance remain visible/reachable;
- selected-row preview shows title, summary, gate progress, next action, blockers, source/evidence context.

Run: `pnpm vitest run tests/web/development-plan-routes.test.tsx tests/web/responsive-layout.test.tsx tests/web/product-grade-first-viewport.test.tsx`

Expected: FAIL until the table model and layout are upgraded.

- [ ] **Step 2: Add column priority model**

Define column priority in `development-plan-view-model.ts`, with desktop/tablet/mobile mappings. Use it in `DevelopmentPlanTable`.

The model must own the full planning column set from the spec:

- Plan Item;
- responsible role;
- driver actor or role;
- reviewer;
- risk;
- dependency hints;
- affected surface;
- Boundary;
- Spec;
- Execution Plan;
- Execution;
- Review;
- QA;
- Release impact;
- Next action.

Default visible columns must follow the spec:

- 1440px and wider: Plan Item, role, risk, Boundary, Spec, Execution Plan, Execution, Review, QA, Release impact, Next action;
- 1024px to 1439px: Plan Item, role, risk, current gate, gate progress summary, Execution, QA/Review summary, Next action;
- below 1024px: selected-row preview moves below the table or into a drawer; rows become compact cards below 768px.

Secondary fields such as driver actor, reviewer, dependency hints, and affected surface must remain available through column configuration, selected-row preview, compact metadata, or the detail route. Do not drop those fields from the product surface.

- [ ] **Step 3: Upgrade table implementation**

Use the upgraded `DataTable` or TanStack Table directly with:

- contained scroll only within table surface;
- sticky header where useful;
- selected row;
- keyboard row selection;
- compact mobile cards below 768px.

- [ ] **Step 4: Upgrade selected-row preview**

Use `PreviewPane`, `GateProgress`, `PrioritySummary`, and compact source/evidence metadata.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm vitest run tests/web/development-plan-routes.test.tsx tests/web/responsive-layout.test.tsx tests/web/product-grade-first-viewport.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/development-plans/development-plan-detail-route.tsx apps/web/src/features/development-plans/development-plan-table.tsx apps/web/src/features/development-plans/development-plan-view-model.ts tests/web/development-plan-routes.test.tsx tests/web/responsive-layout.test.tsx tests/web/product-grade-first-viewport.test.tsx
git commit -m "feat: upgrade development plan table workspace"
```

## Task 11: Development Plan Item Gate Workspace And Focus Routes

**Files:**
- Modify: `apps/web/src/features/development-plans/development-plan-item-detail-route.tsx`
- Modify: `apps/web/src/features/development-plans/plan-item-gates.tsx`
- Modify: `apps/web/src/features/brainstorming/brainstorming-panel.tsx`
- Modify: `tests/web/development-plan-routes.test.tsx`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`

- [ ] **Step 1: Write failing gate workspace tests**

Assert:

- overview and focus routes use `GateWorkspace`;
- first viewport shows item title, compact source/plan context, gate progress, priority summary, current enabled action, disabled reasons, and evidence side context;
- focus routes prioritize the active gate body:
  - `/brainstorming` shows boundary brainstorming;
  - `/spec` shows Spec document surface;
  - `/execution-plan` shows Execution Plan document surface;
  - `/execution` shows execution supervision;
- revision/evidence history is lower priority or in drawers.

Run: `pnpm vitest run tests/web/development-plan-routes.test.tsx tests/web/product-grade-first-viewport.test.tsx`

Expected: FAIL until the item detail is reorganized.

- [ ] **Step 2: Build `GateWorkspace` composition**

Move the current `ItemStructuredFields`, `PlanItemGateSummary`, lifecycle actions, artifact lists, review/QA context, revision history, and evidence timeline into priority-ordered regions.

- [ ] **Step 3: Make the active gate body depend on focus route**

Do not render all large gate sections above the fold. Only the active/focused gate should dominate the first body region.

- [ ] **Step 4: Preserve lifecycle gating semantics**

Keep existing command enablement/disablement logic and tests. Do not make a command available if prerequisites are not satisfied.

- [ ] **Step 5: Run gate tests**

Run:

```bash
pnpm vitest run tests/web/development-plan-routes.test.tsx tests/web/product-grade-first-viewport.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/development-plans/development-plan-item-detail-route.tsx apps/web/src/features/development-plans/plan-item-gates.tsx apps/web/src/features/brainstorming/brainstorming-panel.tsx tests/web/development-plan-routes.test.tsx tests/web/product-grade-first-viewport.test.tsx
git commit -m "feat: upgrade plan item gate workspace"
```

## Task 12: Specs And Execution Plans Governance Queue

**Files:**
- Modify: `apps/web/src/features/spec-plan/spec-execution-plan-queue.tsx`
- Modify: `apps/web/src/features/spec-plan/spec-plan-view-model.ts`
- Modify: `tests/web/project-management-routes.test.tsx`
- Modify: `tests/web/spec-plan-lifecycle-actions.test.tsx`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`

- [ ] **Step 1: Write failing governance queue tests**

Assert:

- `/specs-plans` uses `QueueWorkspace`;
- rows are 44-56px on desktop;
- queue groups include needs generation, needs review, changes requested, approved/ready, stale/blocked;
- selected row preview shows document summary, gate status, reviewer, plan item, and command;
- direct document browser routes are still retired.

Run: `pnpm vitest run tests/web/project-management-routes.test.tsx tests/web/spec-plan-lifecycle-actions.test.tsx tests/web/product-grade-first-viewport.test.tsx`

Expected: FAIL until queue cards become compact rows with preview.

- [ ] **Step 2: Implement governance queue view model**

Map API items into compact queue rows with artifact type, source object, Development Plan Item, reviewer, age, risk, stale/blocked state, and next action.

- [ ] **Step 3: Replace grouped large cards**

Use `QueueWorkspace` plus `PreviewPane`; avoid large grouped card stacks.

- [ ] **Step 4: Run governance tests**

Run:

```bash
pnpm vitest run tests/web/project-management-routes.test.tsx tests/web/spec-plan-lifecycle-actions.test.tsx tests/web/product-grade-first-viewport.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/spec-plan/spec-execution-plan-queue.tsx apps/web/src/features/spec-plan/spec-plan-view-model.ts tests/web/project-management-routes.test.tsx tests/web/spec-plan-lifecycle-actions.test.tsx tests/web/product-grade-first-viewport.test.tsx
git commit -m "feat: upgrade spec execution plan queue"
```

## Task 13: Execution Supervision List And Detail

**Files:**
- Modify: `apps/web/src/features/executions/executions-route.tsx`
- Modify: `apps/web/src/features/executions/execution-detail-route.tsx`
- Modify: `apps/web/src/features/executions/execution-view-model.ts`
- Modify: `tests/web/executions-routes.test.tsx`
- Modify: `tests/web/code-review-qa-handoff-routes.test.tsx`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`

- [ ] **Step 1: Write failing execution tests**

Assert:

- `/executions` has active, resumable, review-pending, failed/blocked, completed/recent lanes;
- rows show approved Execution Plan revision, Development Plan Item, worker state, current step, last event, PR/diff/test evidence, and allowed action;
- `/executions/:id` uses product supervision detail, not raw runtime browser;
- detail title is derived from plan item/execution plan revision, not raw ID;
- unavailable actions show disabled reasons.

Run: `pnpm vitest run tests/web/executions-routes.test.tsx tests/web/code-review-qa-handoff-routes.test.tsx tests/web/product-grade-first-viewport.test.tsx`

Expected: FAIL until execution views are reorganized.

- [ ] **Step 2: Implement execution view model**

Normalize execution list/detail projections into product supervision fields. Keep raw IDs only in compact metadata.

- [ ] **Step 3: Upgrade `/executions`**

Use supervision lanes and compact rows/cards. Move low-value metadata below primary action/state.

- [ ] **Step 4: Upgrade `/executions/:id`**

First viewport must show:

- product title;
- worker state;
- current step;
- last meaningful event;
- interrupt/continue/retry/inspect actions where allowed;
- disabled reasons;
- PR/diff/test evidence summary;
- linked plan item and approved Execution Plan revision.

- [ ] **Step 5: Run execution tests**

Run:

```bash
pnpm vitest run tests/web/executions-routes.test.tsx tests/web/code-review-qa-handoff-routes.test.tsx tests/web/product-grade-first-viewport.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/executions/executions-route.tsx apps/web/src/features/executions/execution-detail-route.tsx apps/web/src/features/executions/execution-view-model.ts tests/web/executions-routes.test.tsx tests/web/code-review-qa-handoff-routes.test.tsx tests/web/product-grade-first-viewport.test.tsx
git commit -m "feat: upgrade execution supervision workspaces"
```

## Task 14: Board Flow View

**Files:**
- Modify: `apps/web/src/features/board/board-route.tsx`
- Modify: `tests/web/my-work-board-reports.test.tsx`
- Modify: `tests/web/board-reports-release-readiness.test.tsx`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`

- [ ] **Step 1: Write failing board tests**

Assert Board is a Development Plan Item/gate flow view with columns:

- Intake / Development Plan needed;
- Boundary;
- Spec;
- Execution Plan;
- Execution;
- Review;
- QA;
- Release.

Each card must show type, title, role/actor, blocker, risk, and next action.

Run: `pnpm vitest run tests/web/my-work-board-reports.test.tsx tests/web/board-reports-release-readiness.test.tsx tests/web/product-grade-first-viewport.test.tsx`

Expected: FAIL because current board columns are generic delivery states.

- [ ] **Step 2: Update board grouping**

Map cards by gate state rather than generic planning/ready/active/validation/done labels.

- [ ] **Step 3: Upgrade cards**

Cards should be compact and scannable, not nested sections. Use `StatusPill`, `Badge`, and compact metadata.

- [ ] **Step 4: Run board tests**

Run:

```bash
pnpm vitest run tests/web/my-work-board-reports.test.tsx tests/web/board-reports-release-readiness.test.tsx tests/web/product-grade-first-viewport.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/board/board-route.tsx tests/web/my-work-board-reports.test.tsx tests/web/board-reports-release-readiness.test.tsx tests/web/product-grade-first-viewport.test.tsx
git commit -m "feat: upgrade delivery flow board"
```

## Task 15: Release Readiness And Evidence Workspaces

**Files:**
- Modify: `apps/web/src/features/releases/release-routes.tsx`
- Modify: `apps/web/src/features/releases/release-view-model.ts`
- Modify: `tests/web/board-reports-release-readiness.test.tsx`
- Modify: `tests/web/release-owner-surface.test.tsx`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`

- [ ] **Step 1: Write failing release tests**

Assert:

- `/releases` is a compact release inventory, not sparse cards;
- `/releases/:id` uses release readiness cockpit layout;
- `/releases/:id/evidence` leads with evidence readiness and relevance;
- release page first viewport includes scope, readiness, high-risk changes, approvals, launch/rollback disabled reasons;
- Release Owner wording remains limited to release pages.

Run:

```bash
pnpm vitest run tests/web/board-reports-release-readiness.test.tsx tests/web/release-owner-surface.test.tsx tests/web/product-grade-first-viewport.test.tsx
```

Expected: FAIL until release surfaces use the new release view model and layout.

- [ ] **Step 2: Implement release view model**

Normalize cockpit/readiness query data into scope, blockers, readiness evidence, risk, approvals, launch/rollback action state, and observation state.

- [ ] **Step 3: Upgrade release routes**

Use `WorkspacePage`, `ActionStrip`, `PrioritySummary`, `CompactMetadata`, and evidence drawers/sections. Raw evidence and replay links stay secondary.

- [ ] **Step 4: Run release tests**

Run:

```bash
pnpm vitest run tests/web/board-reports-release-readiness.test.tsx tests/web/release-owner-surface.test.tsx tests/web/product-grade-first-viewport.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/releases/release-routes.tsx apps/web/src/features/releases/release-view-model.ts tests/web/board-reports-release-readiness.test.tsx tests/web/release-owner-surface.test.tsx tests/web/product-grade-first-viewport.test.tsx
git commit -m "feat: upgrade release readiness workspaces"
```

## Task 16: Reports As Operational Intelligence

**Files:**
- Modify: `apps/web/src/features/reports/reports-routes.tsx`
- Modify: `apps/web/src/features/reports/report-view-model.ts`
- Modify: `tests/web/my-work-board-reports.test.tsx`
- Modify: `tests/web/board-reports-release-readiness.test.tsx`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`

- [ ] **Step 1: Write failing report tests**

Assert every report surface shows:

- conclusion;
- supporting signal;
- affected objects;
- suggested action.

Reports must not be empty link panels or metric-only pages.

Run: `pnpm vitest run tests/web/my-work-board-reports.test.tsx tests/web/board-reports-release-readiness.test.tsx tests/web/product-grade-first-viewport.test.tsx`

Expected: FAIL because current reports are mostly catalog/metric summaries.

- [ ] **Step 2: Implement report view model**

Map report query data into intelligence cards/rows with conclusion, signal, affected objects, and action.

- [ ] **Step 3: Upgrade reports index and families**

Use `WorkspacePage` and dense intelligence sections. Keep scoped replay as query-scoped report context, not a raw replay browser.

- [ ] **Step 4: Run report tests**

Run:

```bash
pnpm vitest run tests/web/my-work-board-reports.test.tsx tests/web/board-reports-release-readiness.test.tsx tests/web/product-grade-first-viewport.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/reports/reports-routes.tsx apps/web/src/features/reports/report-view-model.ts tests/web/my-work-board-reports.test.tsx tests/web/board-reports-release-readiness.test.tsx tests/web/product-grade-first-viewport.test.tsx
git commit -m "feat: upgrade reports intelligence surfaces"
```

## Task 17: Final Screenshot, No-Baggage, A11y, Responsive, Build Closure

**Files:**
- Modify: `tests/e2e/ai-native-project-management-visual.e2e.test.ts`
- Modify: `tests/e2e/helpers/capture-route-screenshots.ts`
- Modify: `tests/web/no-legacy-web-ui.test.ts`
- Modify: `tests/web/responsive-layout.test.tsx`
- Modify: `tests/web/a11y-gates.test.tsx`
- Modify: `docs/superpowers/reports/product-grade-visual-system-closure-review.md` if this report file does not already exist

- [ ] **Step 1: Expand screenshot manifest**

Use `requiredScreenshotRoutes` from `route-contract.ts`. Include:

- `/`;
- `/cockpit`;
- `/dashboard`;
- `/my-work`;
- `/requirements`;
- `/requirements/new`;
- `/requirements/:id`;
- `/requirements/:id/evidence`;
- `/initiatives`;
- `/initiatives/new`;
- `/initiatives/:id`;
- `/initiatives/:id/evidence`;
- `/bugs`;
- `/bugs/new`;
- `/bugs/:id`;
- `/bugs/:id/evidence`;
- `/tech-debt`;
- `/tech-debt/new`;
- `/tech-debt/:id`;
- `/tech-debt/:id/evidence`;
- `/development-plans`;
- `/development-plans/new`;
- `/development-plans/:id`;
- `/development-plans/:id/items/:itemId`;
- `/development-plans/:id/items/:itemId/brainstorming`;
- `/development-plans/:id/items/:itemId/spec`;
- `/development-plans/:id/items/:itemId/execution-plan`;
- `/development-plans/:id/items/:itemId/execution`;
- `/specs-plans`;
- `/executions`;
- `/executions/:id`;
- `/board`;
- `/releases`;
- `/releases/:id`;
- `/releases/:id/evidence`;
- `/reports`;
- `/reports/delivery`;
- `/reports/quality`;
- `/reports/release-readiness`;
- `/reports/observation`.

- [ ] **Step 2: Add retired-route checks**

Ensure `/plans`, `/plans/:id`, `/specs`, `/specs/:id`, `/tasks`, `/tasks/:id`, and raw runtime browser routes if registered render safe retired/not-found states and do not appear in nav/search/product links/happy-path fixtures.

Also assert `apps/web/src/app/routes.ts` has no unclassified public route: each registered product path must be listed in `canonicalProductRoutes`, `retiredProductRoutes`, or an explicit Dev Tools-only allowlist. The check must fail for any extra public route containing legacy `tasks`, `plans`, `specs`, `packages`, `runs`, `reviews`, or raw `replay` path segments.

- [ ] **Step 3: Add first-viewport screenshot assertions**

In Playwright helper, assert for every product route:

- visible heading;
- current state with non-empty accessible text;
- next action region with enabled action text or explicit disabled reason text;
- role/responsibility where applicable, with non-empty accessible text;
- blocker/risk where applicable, with non-empty accessible text;
- route-family marker.

These assertions must reject empty test-id shells, aria-hidden-only status, and color-only state badges.

- [ ] **Step 4: Run full Web route contract suites**

Run:

```bash
pnpm vitest run \
  tests/web/product-grade-route-contract.test.tsx \
  tests/web/product-grade-layout-primitives.test.tsx \
  tests/web/product-grade-view-models.test.ts \
  tests/web/product-grade-first-viewport.test.tsx \
  tests/web/my-work-route.test.tsx \
  tests/web/project-management-routes.test.tsx \
  tests/web/development-plan-routes.test.tsx \
  tests/web/executions-routes.test.tsx \
  tests/web/my-work-board-reports.test.tsx \
  tests/web/board-reports-release-readiness.test.tsx \
  tests/web/app-shell-routing.test.tsx \
  tests/web/responsive-layout.test.tsx \
  tests/web/a11y-gates.test.tsx \
  tests/web/no-legacy-web-ui.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run screenshot E2E**

Run: `pnpm vitest run tests/e2e/ai-native-project-management-visual.e2e.test.ts`

Expected: PASS and screenshots written under `test-results/ai-native-project-management`. The E2E helper must fail if any `requiredScreenshotRoutes` route/viewport pair is not captured, if a PNG path is missing or zero bytes, or if a retired-route smoke target such as `/dashboard` is skipped.

- [ ] **Step 6: Run typecheck and build**

Run:

```bash
pnpm --filter @forgeloop/web typecheck
pnpm --filter @forgeloop/web build
```

Expected: PASS.

- [ ] **Step 7: Run naming/no-baggage guard**

Run: `pnpm vitest run tests/naming/delivery-naming.test.ts tests/web/no-legacy-web-ui.test.ts`

Expected: PASS.

- [ ] **Step 8: Run full verification**

Run:

```bash
pnpm test
pnpm build
```

Expected: PASS. If an unrelated transient failure appears, rerun the exact failing file in isolation before changing code.

- [ ] **Step 9: Write visual review note**

Create or update `docs/superpowers/reports/product-grade-visual-system-closure-review.md` with:

- screenshots reviewed;
- whether each first viewport shows current state, next action, owner/role, blocker/risk;
- low-priority information moved out of primary space;
- intentionally degraded pages, if any;
- remaining visual debt, if any, and why it is not a blocker.

- [ ] **Step 10: Commit final closure**

```bash
git status --short
git add tests/e2e/ai-native-project-management-visual.e2e.test.ts tests/e2e/helpers/capture-route-screenshots.ts tests/web/no-legacy-web-ui.test.ts tests/web/responsive-layout.test.tsx tests/web/a11y-gates.test.tsx docs/superpowers/reports/product-grade-visual-system-closure-review.md
# If final screenshot fixes touched app files, stage each changed file by exact path from `git diff --name-only`; do not stage `apps/web`, `tests/web`, or `tests/e2e` as directories.
git commit -m "test: close product-grade visual system verification"
```

## Final Acceptance Checklist

- [ ] `/cockpit` is canonical; `/` reaches Cockpit; `/dashboard` is retired/safe and not a primary product route.
- [ ] Primary navigation has no historical route families and no raw runtime browsers.
- [ ] Command search suggests only canonical product surfaces/actions.
- [ ] Every required route family exposes `h1`, current state, next action, role/responsibility, blocker/risk, and page-family markers.
- [ ] `/my-work` is a role-aware queue workspace with filters, selected-row preview, and safe scoped bulk actions.
- [ ] Source objects are typed and do not generate Spec or Execution Plan directly.
- [ ] Development Plan is table-first with responsive column priority and selected-row preview.
- [ ] Development Plan Item is the item-scoped gate workspace.
- [ ] Specs/Execution Plans are governance queues with preview, not direct document browsers.
- [ ] Executions are product supervision surfaces, not runtime browsers.
- [ ] Board, Releases, and Reports are operational product surfaces with action-first hierarchy.
- [ ] Evidence routes lead with evidence readiness and product-safe unavailable states.
- [ ] No page-level horizontal scroll at 375, 768, 1024, or 1440px.
- [ ] No card-in-card page composition or metadata-card sprawl.
- [ ] `pnpm test` and `pnpm build` pass.
