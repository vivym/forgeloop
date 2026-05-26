# Product-Grade Visual System Closure Review

## Scope

This review covers the final Task 17 closure for `docs/superpowers/specs/2026-05-25-product-grade-visual-system-closure-design.md` and `docs/superpowers/plans/2026-05-25-product-grade-visual-system-closure.md`.

The reviewed product surfaces are Cockpit, My Work, source object lists/create/detail/evidence routes, Development Plans, Development Plan Item gates, Specs and Execution Plans, Executions, Board, Releases, and Reports.

## Screenshot Coverage

- Screenshot directory: `test-results/ai-native-project-management`
- PNG screenshots reviewed by the E2E gate: 160
- Zero-byte screenshots: 0
- Viewports covered: 1440, 1024, 768, and 375 px
- Required route families covered: canonical product routes plus the retired `/dashboard` smoke target

The screenshot helper now uses the route contract manifest and fails if a required route or viewport is skipped, if a PNG is missing or empty, if a product route lacks the first-viewport contract, or if retired route coverage is omitted.

## First-Viewport Contract

Every required product route family exposes:

- a visible accessible `h1`;
- a current-state region with non-empty text;
- a next-action region with an action or explicit disabled reason;
- role or responsibility context where the surface needs ownership clarity;
- blocker, risk, stale, running, approved, empty, loading, and error state text where applicable;
- a route-family marker used by route and screenshot gates.

Additional closure fixes in this pass made the first-viewport state explicit on My Work, source object lists/create/evidence routes, Development Plan index/create/detail, Specs and Execution Plans, Executions, Board, Releases, and Reports.

## Information Priority

Low-priority or internal information is no longer primary visual real estate on the reviewed routes:

- raw source object IDs were removed from the Development Plan create workspace in favor of a typed Source object selector;
- raw execution IDs remain secondary compact metadata, while execution detail headings use the product/Plan Item title;
- report affected objects come from typed `ProductObjectRef` values rather than parsed display strings or fake group labels;
- evidence and replay-like context stays scoped to report/evidence sections rather than becoming raw browser routes;
- page-level metadata sprawl is kept below current state, next action, role, and risk.

## Degraded Pages

No intentionally degraded product page remains as a normal happy-path surface.

Retired routes such as `/dashboard`, `/plans`, `/plans/:id`, `/specs`, `/specs/:id`, `/tasks`, and `/tasks/:id` are covered as product-safe retired/not-found states. They are not navigation, command-search, or happy-path product entries.

## Remaining Visual Debt

No blocker-level visual debt remains for this closure.

The Vite production build still reports the existing large chunk warning for the Web bundle. This is non-blocking for this visual-system closure because it does not affect route correctness, first-viewport quality, no-baggage requirements, accessibility gates, or screenshot coverage.

## Verification

Latest verification on this branch:

- `pnpm vitest run tests/e2e/ai-native-project-management-visual.e2e.test.ts`
- `pnpm vitest run tests/web/product-grade-route-contract.test.tsx tests/web/product-grade-layout-primitives.test.tsx tests/web/product-grade-view-models.test.ts tests/web/product-grade-first-viewport.test.tsx tests/web/my-work-route.test.tsx tests/web/project-management-routes.test.tsx tests/web/development-plan-routes.test.tsx tests/web/executions-routes.test.tsx tests/web/my-work-board-reports.test.tsx tests/web/board-reports-release-readiness.test.tsx tests/web/app-shell-routing.test.tsx tests/web/responsive-layout.test.tsx tests/web/a11y-gates.test.tsx tests/web/no-legacy-web-ui.test.ts`
- `pnpm vitest run tests/naming/delivery-naming.test.ts tests/web/no-legacy-web-ui.test.ts`
- `pnpm vitest run tests/web/ai-native-surface-states.test.tsx tests/web/ai-native-accessibility.test.tsx tests/e2e/web-product-routes.e2e.test.ts tests/web/design-system.test.tsx`
- `pnpm vitest run tests/api/project-management-query.test.ts tests/web/my-work-board-reports.test.tsx tests/web/board-reports-release-readiness.test.tsx tests/web/ai-native-surface-states.test.tsx tests/web/product-grade-view-models.test.ts`
- `pnpm test`
- `pnpm build`
- `git diff --check`

All commands above pass on the final working tree. The full test suite reports 171 passed files, 4 skipped files, 2576 passed tests, and 20 skipped tests.
