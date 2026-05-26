# Product Architecture Visual Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild ForgeLoop Web into the approved AI-native product-management experience: typed source objects, Development Plans, Plan Items, brainstorming, Spec and Execution Plan review, AI execution supervision, code review, QA, release readiness, and reports with seeded product-quality visual evidence.

**Architecture:** Implement the spec from the contract inward. First update route contracts, seeded data, and visual gates so the old generic `WorkspacePage` pattern cannot pass. Then migrate each page family to family-owned layouts with `data-primary-work-surface`, and finish with seeded screenshot/report closure.

**Tech Stack:** React Router, React, TypeScript, Tailwind CSS, Vitest, Testing Library, Playwright, Nest test app, in-memory demo repository fixtures.

---

## Spec And Guardrails

Spec: `docs/superpowers/specs/2026-05-26-product-architecture-visual-rebuild-design.md`

Hard requirements:

- No compatibility shell, old/new switch, or legacy route alias.
- No top-level `/tasks`, `/work-items`, `/packages`, `/runs`, `/reviews`, `/plans`, `/specs`, `/dashboard`, or replay product surface.
- Navigation label for `/specs-plans` is `Document Reviews`.
- Public product boundaries use typed refs: `initiative`, `requirement`, `bug`, `tech_debt`.
- Internal `work_item` mappings are allowed only in storage/domain/runtime/backfill/migration internals and must project outward as typed refs.
- Every product route maps to exactly one page family and one visible `data-primary-work-surface`.
- Product routes must reject the old first-viewport acceptance markers: `data-first-viewport`, `data-priority-summary`, `data-action-strip`, `current-state`, `role-responsibility`, `blocker-risk`, `next-action`.
- Screenshots use seeded product data, not empty fixtures.

## File Structure

### Product Contract And Navigation

- Modify `apps/web/src/app/routes.ts`
  - Add Plan Item `/review` and `/qa` routes.
- Create `apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/review.tsx`
- Create `apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/qa.tsx`
- Modify `apps/web/src/shared/navigation/product-navigation.ts`
  - Rename `Specs & Execution Plans` to `Document Reviews`.
- Modify `apps/web/src/features/product-surfaces/route-contract.ts`
  - Replace old family names with spec families.
  - Use stable seeded ids from the spec.
  - Include review/QA routes and all screenshot routes.
- Modify `apps/web/src/features/product-surfaces/first-viewport-contract.ts`
  - Replace old summary quartet contract with page-family and primary work-surface contract.
- Modify `tests/web/product-grade-route-contract.test.tsx`
- Modify `tests/web/product-grade-first-viewport.test.tsx`
- Modify `tests/web/helpers/first-viewport-contract.ts`

### Seeded Product Data

- Modify `tests/web/fixtures/product-data.ts`
  - Replace current checkout/web-product demo with the deterministic spec scenario.
- Modify `tests/web/fixtures/product-api-mock.ts`
  - Serve every canonical seeded route and query.
  - Reject retired query modes such as `/reports?report=replay`.
- Modify `tests/e2e/helpers/capture-route-screenshots.ts`
  - Use seeded ids and screenshot route manifest.
  - Emit route/viewport/landmark/geometry report data.
- Create `scripts/product-review-preview.ts`
  - Start API and Web on free ports with seeded in-memory data.
  - Print seed id and URLs.
- Create `tests/smoke/product-review-preview-script.test.ts`
- Modify `package.json`
  - Add `preview:product-review`.

### Shared Layout And Visual System

- Create `apps/web/src/shared/layout/product-page/product-page.tsx`
  - Semantic page root with family and primary work-surface support.
- Create `apps/web/src/shared/layout/page-families/page-families.tsx`
  - Family wrappers: `CockpitLayout`, `InboxLayout`, `DatabaseViewLayout`, `DocumentWorkspaceLayout`, `SourceEvidenceLayout`, `PlanningTableLayout`, `PlanAuthoringLayout`, `GateFlowLayout`, `DocumentReviewLayout`, `CodeReviewLayout`, `QaHandoffLayout`, `DocumentGovernanceLayout`, `DeliveryBoardLayout`, `ExecutionSupervisionLayout`, `ReleaseReadinessLayout`, `ReleaseEvidenceLayout`, `ReportInsightLayout`.
- Modify `apps/web/src/shared/layout/workspace-page/workspace-page.tsx`
  - Remove first-viewport visual composition from product usage or deprecate to semantic-only.
- Modify `apps/web/src/shared/layout/index.ts`
- Modify `apps/web/src/shared/styles/theme.css`
- Modify `tests/web/product-grade-layout-primitives.test.tsx`
- Modify `tests/web/responsive-layout.test.tsx`
- Delete after route migration proves zero imports:
  - `apps/web/src/shared/layout/action-strip/action-strip.tsx`
  - `apps/web/src/shared/layout/priority-summary/priority-summary.tsx`
  - `apps/web/src/shared/layout/object-workspace/object-workspace.tsx`
  - `apps/web/src/shared/layout/queue-workspace/queue-workspace.tsx`
  - `apps/web/src/shared/layout/planning-table-workspace/planning-table-workspace.tsx`
  - `apps/web/src/shared/layout/gate-workspace/gate-workspace.tsx`
  - `apps/web/src/shared/layout/workspace-page/workspace-page.tsx`

### Page Families

- Modify `apps/web/src/features/cockpit/cockpit-route.tsx`
- Modify `apps/web/src/features/cockpit/cockpit-view-model.ts`
- Modify `apps/web/src/features/my-work/my-work-route.tsx`
- Modify `apps/web/src/features/my-work/my-work-view-model.ts`
- Modify `apps/web/src/features/board/board-route.tsx`
- Modify `apps/web/src/features/project-management/object-list.tsx`
- Modify `apps/web/src/features/project-management/object-detail-layout.tsx`
- Modify `apps/web/src/features/project-management/object-evidence-route.tsx`
- Modify `apps/web/src/features/project-management/object-forms.tsx`
- Modify typed source routes:
  - `apps/web/src/features/requirements/requirements-routes.tsx`
  - `apps/web/src/features/bugs/bugs-routes.tsx`
  - `apps/web/src/features/initiatives/initiatives-routes.tsx`
  - `apps/web/src/features/tech-debt/tech-debt-routes.tsx`
- Modify Development Plan routes:
  - `apps/web/src/features/development-plans/development-plans-route.tsx`
  - `apps/web/src/features/development-plans/development-plan-detail-route.tsx`
  - `apps/web/src/features/development-plans/development-plan-item-detail-route.tsx`
  - `apps/web/src/features/development-plans/development-plan-table.tsx`
  - `apps/web/src/features/development-plans/plan-item-gates.tsx`
- Modify review/QA panels:
  - `apps/web/src/features/code-review/code-review-handoff-panel.tsx`
  - `apps/web/src/features/qa/qa-handoff-panel.tsx`
- Modify document governance:
  - `apps/web/src/features/spec-plan/specs-plans-route.tsx`
  - `apps/web/src/features/spec-plan/spec-execution-plan-queue.tsx`
  - `apps/web/src/features/spec-plan/spec-plan-view-model.ts`
- Modify execution, release, and report routes:
  - `apps/web/src/features/executions/executions-route.tsx`
  - `apps/web/src/features/executions/execution-detail-route.tsx`
  - `apps/web/src/features/executions/execution-view-model.ts`
  - `apps/web/src/features/releases/release-routes.tsx`
  - `apps/web/src/features/releases/release-view-model.ts`
  - `apps/web/src/features/reports/reports-routes.tsx`
  - `apps/web/src/features/reports/report-view-model.ts`

### Verification Artifacts

- Modify `tests/e2e/ai-native-project-management-visual.e2e.test.ts`
- Modify `tests/e2e/web-product-routes.e2e.test.ts`
- Modify `tests/web/no-legacy-web-ui.test.ts`
- Modify `tests/naming/delivery-naming.test.ts` only if the new spec requires additional allowed negative-test wording.
- Create or update `docs/superpowers/reports/product-architecture-visual-rebuild-review.md` during the final screenshot closure task.

### Snippet Buildability Rule

Every component name in the task snippets must either already exist in the touched file/imports, come from the new shared layout primitives in Task 3, or be created as a local helper in the same feature file before use. Do not add placeholder imports for helper names that are not implemented. When extracting helpers, keep them file-local unless two migrated routes in the same feature folder share the helper.

---

## Task 1: Route Contract, Navigation, And Retired Surface Gates

**Files:**
- Modify: `apps/web/src/app/routes.ts`
- Delete: `apps/web/src/app/routes/dashboard/index.tsx`
- Create: `apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/review.tsx`
- Create: `apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/qa.tsx`
- Modify: `apps/web/src/shared/navigation/product-navigation.ts`
- Modify: `apps/web/src/features/product-surfaces/route-contract.ts`
- Modify: `tests/web/product-grade-route-contract.test.tsx`
- Modify: `tests/e2e/ai-native-project-management-visual.e2e.test.ts`

- [ ] **Step 1: Write the failing route contract test**

Add the new routes, the new navigation label, the retired route assertions, and the retired query-mode assertion in `tests/web/product-grade-route-contract.test.tsx`:

```ts
import appRouteConfig from '../../apps/web/src/app/routes';
import {
  canonicalProductRoutes,
  productCommandItems,
  requiredScreenshotRoutes,
  retiredProductQueryStates,
  retiredProductRoutes,
} from '../../apps/web/src/features/product-surfaces/route-contract';
import { productNavigationGroups } from '../../apps/web/src/shared/navigation/product-navigation';
import { duplicateProductRoutePaths, flattenProductRouteConfig } from './helpers/product-route-config';

const expectedProductRoutes = [
  '/',
  '/cockpit',
  '/my-work',
  '/initiatives',
  '/initiatives/new',
  '/initiatives/:id',
  '/initiatives/:id/evidence',
  '/requirements',
  '/requirements/new',
  '/requirements/:id',
  '/requirements/:id/evidence',
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
  '/development-plans/:id/items/:itemId/review',
  '/development-plans/:id/items/:itemId/qa',
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
  '/work-items',
  '/work-items/:id',
  '/packages',
  '/packages/:id',
  '/runs',
  '/runs/:id',
  '/reviews',
  '/reviews/:id',
  '/plans',
  '/plans/:id',
  '/specs',
  '/specs/:id',
  '/tasks',
  '/tasks/:id',
];

const expectedScreenshotRoutes = expectedProductRoutes;
const expectedConcreteScreenshotRoutes = [
  '/',
  '/cockpit',
  '/my-work',
  '/initiatives',
  '/initiatives/new',
  '/initiatives/init-ai-native-rollout',
  '/initiatives/init-ai-native-rollout/evidence',
  '/requirements',
  '/requirements/new',
  '/requirements/req-plan-item-governance',
  '/requirements/req-plan-item-governance/evidence',
  '/bugs',
  '/bugs/new',
  '/bugs/bug-execution-review-context',
  '/bugs/bug-execution-review-context/evidence',
  '/tech-debt',
  '/tech-debt/new',
  '/tech-debt/td-retire-workspace-page-template',
  '/tech-debt/td-retire-workspace-page-template/evidence',
  '/development-plans',
  '/development-plans/new',
  '/development-plans/dp-product-architecture-visual-rebuild',
  '/development-plans/dp-product-architecture-visual-rebuild/items/dpi-cockpit-command-center',
  '/development-plans/dp-product-architecture-visual-rebuild/items/dpi-development-plan-table-inspector/brainstorming',
  '/development-plans/dp-product-architecture-visual-rebuild/items/dpi-cockpit-command-center/spec',
  '/development-plans/dp-product-architecture-visual-rebuild/items/dpi-requirements-database-view/execution-plan',
  '/development-plans/dp-product-architecture-visual-rebuild/items/dpi-demo-seed-visual-review/execution',
  '/development-plans/dp-product-architecture-visual-rebuild/items/dpi-cockpit-command-center/review',
  '/development-plans/dp-product-architecture-visual-rebuild/items/dpi-requirements-database-view/qa',
  '/specs-plans',
  '/executions',
  '/executions/exec-demo-seed-visual-review',
  '/board',
  '/releases',
  '/releases/rel-product-architecture-preview',
  '/releases/rel-product-architecture-preview/evidence',
  '/reports',
  '/reports/delivery',
  '/reports/quality',
  '/reports/release-readiness',
  '/reports/observation',
];

it('uses the approved primary navigation labels', () => {
  const labels = productNavigationGroups({ devToolsEnabled: false }).flatMap((group) => group.items.map((item) => item.label));
  expect(labels).toContain('Document Reviews');
  expect(labels).not.toContain('Specs & Execution Plans');
  expect(labels).not.toContain('Specs and Execution Plans');
});

it('does not register retired product routes as active route config entries', () => {
  const activeRoutePaths = flattenProductRouteConfig(appRouteConfig);
  expect(activeRoutePaths).not.toContain('dashboard');
  expect(activeRoutePaths).not.toContain('tasks');
  expect(activeRoutePaths).not.toContain('work-items');
  expect(activeRoutePaths).not.toContain('packages');
  expect(activeRoutePaths).not.toContain('runs');
  expect(activeRoutePaths).not.toContain('reviews');
  expect(activeRoutePaths).not.toContain('plans');
  expect(activeRoutePaths).not.toContain('specs');
});

it('classifies retired query product modes as dev-only or rejected', () => {
  expect(retiredProductRoutes.map((route) => route.path)).toEqual(expectedRetiredSmokeRoutes);
  expect(retiredProductQueryStates).toContain('/reports?report=replay');
});

it('keeps retired routes out of the screenshot manifest', () => {
  expect(requiredScreenshotRoutes.map((route) => route.path)).toEqual(expectedScreenshotRoutes);
  expect(requiredScreenshotRoutes.map((route) => route.concretePath)).toEqual(expectedConcreteScreenshotRoutes);
});
```

- [ ] **Step 2: Run the route contract test to verify it fails**

Run: `pnpm vitest run tests/web/product-grade-route-contract.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because `/dashboard` is still registered, `/review`, `/qa`, `Document Reviews`, retired screenshot exclusion, and `retiredProductQueryStates` are not implemented yet.

- [ ] **Step 3: Remove retired React Router entries and add review/QA entries**

Modify `apps/web/src/app/routes.ts`:

```ts
// Remove this retired product route entirely:
// route('dashboard', './routes/dashboard/index.tsx'),

route('development-plans/:developmentPlanId/items/:itemId/review', './routes/development-plans/$developmentPlanId/items/$itemId/review.tsx'),
route('development-plans/:developmentPlanId/items/:itemId/qa', './routes/development-plans/$developmentPlanId/items/$itemId/qa.tsx'),
```

Delete `apps/web/src/app/routes/dashboard/index.tsx`. Do not replace it with a redirect, compatibility alias, or dev-only product-looking route.

Create `apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/review.tsx`:

```ts
import { DevelopmentPlanItemDetailRoute } from '../../../../../../features/development-plans/development-plan-item-detail-route';

export default DevelopmentPlanItemDetailRoute;
```

Create `apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/qa.tsx`:

```ts
import { DevelopmentPlanItemDetailRoute } from '../../../../../../features/development-plans/development-plan-item-detail-route';

export default DevelopmentPlanItemDetailRoute;
```

Task 1 only locks the public URL contract and keeps route modules buildable by pointing to the existing item detail surface. Task 6 changes these modules to the dedicated `review` and `qa` exports after those exports exist.

- [ ] **Step 4: Update navigation label**

Modify `apps/web/src/shared/navigation/product-navigation.ts`:

```ts
{
  label: 'Planning',
  items: [
    { label: 'Development Plans', to: '/development-plans' },
    { label: 'Document Reviews', to: '/specs-plans' },
  ],
},
```

- [ ] **Step 5: Update the canonical route contract**

Modify `apps/web/src/features/product-surfaces/route-contract.ts`:

```ts
export type ProductPageFamily =
  | 'cockpit'
  | 'inbox'
  | 'source-database'
  | 'source-document'
  | 'source-evidence'
  | 'planning-table'
  | 'plan-authoring'
  | 'gate-flow'
  | 'document-review'
  | 'code-review'
  | 'qa-handoff'
  | 'document-governance'
  | 'delivery-board'
  | 'execution-supervision'
  | 'release-readiness'
  | 'release-evidence'
  | 'report-insight';

export const retiredProductQueryStates = ['/reports?report=replay'] as const;
```

Use the seeded ids from the spec:

```ts
const requirementId = 'req-plan-item-governance';
const initiativeId = 'init-ai-native-rollout';
const bugId = 'bug-execution-review-context';
const techDebtId = 'td-retire-workspace-page-template';
const developmentPlanId = 'dp-product-architecture-visual-rebuild';
const boundaryItemId = 'dpi-development-plan-table-inspector';
const reviewItemId = 'dpi-cockpit-command-center';
const executionPlanItemId = 'dpi-requirements-database-view';
const executionItemId = 'dpi-demo-seed-visual-review';
const qaItemId = 'dpi-requirements-database-view';
const executionId = 'exec-demo-seed-visual-review';
const releaseId = 'rel-product-architecture-preview';
```

Keep `/dashboard`, `/work-items`, `/packages`, `/runs`, `/reviews`, `/plans`, `/specs`, and `/tasks` inside `retiredProductRoutes`, but remove all retired routes from `requiredScreenshotRoutes`. `requiredScreenshotRoutes` must be derived from `canonicalProductRoutes` only, so visual acceptance never spends screenshots on a retired product route. Parameterized screenshot concrete paths must use the exact seeded IDs from `expectedConcreteScreenshotRoutes`; in particular, the brainstorming screenshot route must use `dpi-development-plan-table-inspector`, not the default Cockpit Plan Item.

- [ ] **Step 6: Remove product-visible replay query expectations**

Modify `tests/e2e/ai-native-project-management-visual.e2e.test.ts` so `/reports?report=replay` is no longer in the visual route loop and is asserted as retired/dev-only through route/query contract tests.

- [ ] **Step 7: Run the route contract test to verify it passes**

Run: `pnpm vitest run tests/web/product-grade-route-contract.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/routes.ts \
  apps/web/src/app/routes/dashboard/index.tsx \
  apps/web/src/app/routes/development-plans/\$developmentPlanId/items/\$itemId/review.tsx \
  apps/web/src/app/routes/development-plans/\$developmentPlanId/items/\$itemId/qa.tsx \
  apps/web/src/shared/navigation/product-navigation.ts \
  apps/web/src/features/product-surfaces/route-contract.ts \
  tests/web/product-grade-route-contract.test.tsx \
  tests/e2e/ai-native-project-management-visual.e2e.test.ts
git commit -m "test: lock product architecture route contract"
```

---

## Task 2: Seeded Product Architecture Demo Data

**Files:**
- Modify: `tests/web/fixtures/product-data.ts`
- Modify: `tests/web/fixtures/product-api-mock.ts`
- Modify: `tests/e2e/helpers/capture-route-screenshots.ts`
- Create: `scripts/product-review-preview.ts`
- Create: `tests/smoke/product-review-preview-script.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing fixture tests**

Create `tests/web/product-architecture-demo-data.test.ts` with focused assertions:

```ts
import {
  bugDetail,
  codeReviewHandoff,
  developmentPlan,
  developmentPlanItemsById,
  execution,
  executionPackage,
  executionPlanRevision,
  initiativeDetail,
  productArchitectureSeedId,
  qaHandoff,
  release,
  reportFixtures,
  requirementDetail,
  specRevision,
  techDebtDetail,
} from './fixtures/product-data';
import { defaultProductApiResponses } from './fixtures/product-api-mock';

it('uses the deterministic product architecture demo seed', () => {
  expect(productArchitectureSeedId).toBe('project-product-architecture-demo');
  expect(initiativeDetail).toMatchObject({
    id: 'init-ai-native-rollout',
    title: 'AI-native project management rollout',
  });
  expect(requirementDetail.id).toBe('req-plan-item-governance');
  expect(bugDetail).toMatchObject({
    id: 'bug-execution-review-context',
    title: 'Execution continuation loses review context',
  });
  expect(techDebtDetail).toMatchObject({
    id: 'td-retire-workspace-page-template',
    title: 'Retire generic WorkspacePage visual template',
  });
  expect(developmentPlan.id).toBe('dp-product-architecture-visual-rebuild');
  expect(Object.keys(developmentPlanItemsById)).toEqual([
    'dpi-cockpit-command-center',
    'dpi-requirements-database-view',
    'dpi-demo-seed-visual-review',
    'dpi-development-plan-table-inspector',
  ]);
  expect(developmentPlanItemsById['dpi-cockpit-command-center'].title).toBe('Rebuild Cockpit into operational command center');
  expect(developmentPlanItemsById['dpi-requirements-database-view'].title).toBe('Replace Requirements list with database view');
  expect(developmentPlanItemsById['dpi-demo-seed-visual-review'].title).toBe('Seed demo project state for visual review');
  expect(developmentPlanItemsById['dpi-development-plan-table-inspector'].title).toBe('Rewrite Development Plan table and inspector');
  expect(specRevision).toMatchObject({
    id: 'specrev-cockpit-command-center-v1',
    summary: 'Cockpit operational command center Spec',
  });
  expect(executionPlanRevision).toMatchObject({
    id: 'planrev-requirements-database-view-v1',
    summary: 'Requirements database view Execution Plan',
  });
  expect(executionPackage).toMatchObject({
    id: 'pkg-demo-seed-visual-review-v1',
    objective: 'Seed demo project state execution boundary',
  });
  expect(execution.id).toBe('exec-demo-seed-visual-review');
  expect(execution.title).toBe('Codex worker is seeding visual review data');
  expect(codeReviewHandoff).toMatchObject({
    id: 'review-cockpit-requested-changes',
    title: 'Requested changes on Cockpit layout density',
  });
  expect(qaHandoff).toMatchObject({
    id: 'qa-requirements-authoring-mdx',
    title: 'QA pending MDX image insertion acceptance',
  });
  expect(release.id).toBe('rel-product-architecture-preview');
  expect(release.title).toBe('Product architecture preview release');
  expect(reportFixtures.delivery).toMatchObject({
    id: 'report-delivery-risk',
    title: 'Delivery risk: visual rebuild blocked by generic template debt',
  });
  expect(requirementDetail.attachment_refs).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 'att-requirement-flow-image', alt_text: 'Plan Item generation flow' })]),
  );
  expect(bugDetail.attachment_refs).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 'att-bug-reproduction-screenshot', alt_text: 'Continuation loses review context' })]),
  );
  expect(execution.evidence_refs).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 'evidence-exec-demo-seed-checks' })]),
  );
});

it('exposes required seeded labels through product route API responses', () => {
  const responseText = JSON.stringify(defaultProductApiResponses);
  for (const label of [
    'Seed demo project state for visual review',
    'Requested changes on Cockpit layout density',
    'Product architecture preview release',
    'Plan Item governed Spec and Execution Plan generation',
    'Plan Item generation flow',
    'Execution continuation loses review context',
    'Retire generic WorkspacePage visual template',
    'Rewrite Development Plan table and inspector',
    'Codex worker is seeding visual review data',
    'QA pending MDX image insertion acceptance',
    'Delivery risk: visual rebuild blocked by generic template debt',
  ]) {
    expect(responseText).toContain(label);
  }
});
```

- [ ] **Step 2: Run the fixture test to verify it fails**

Run: `pnpm vitest run tests/web/product-architecture-demo-data.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because the current fixtures still use checkout/web-product ids.

- [ ] **Step 3: Replace demo ids and visible labels**

Modify `tests/web/fixtures/product-data.ts` around the existing exported fixture objects. Keep the current object shapes to reduce backend mock churn, but replace IDs and labels:

```ts
export const productArchitectureSeedId = 'project-product-architecture-demo';
export const projectId = productArchitectureSeedId;

export const requirementDetail = {
  id: 'req-plan-item-governance',
  ref: { type: 'requirement', id: 'req-plan-item-governance' },
  title: 'Plan Item governed Spec and Execution Plan generation',
  narrative_markdown: 'Product teams need a governed path from source object to Development Plan Item, brainstorming, Spec, Execution Plan, execution, review, QA, and release.',
  attachment_refs: [
    {
      id: 'att-requirement-flow-image',
      filename: 'plan-item-generation-flow.png',
      content_type: 'image/png',
      alt_text: 'Plan Item generation flow',
      caption: 'Plan Item generation flow',
      owner_object_type: 'requirement',
      owner_object_id: 'req-plan-item-governance',
      // Preserve the remaining AttachmentRef fields from existing fixture helpers.
    },
  ],
  // Preserve relationship_refs, release_refs, risk, status, driver_actor_id.
} as const;
```

Create an indexed helper:

```ts
export const developmentPlanItemsById = {
  'dpi-cockpit-command-center': cockpitCommandCenterItem,
  'dpi-requirements-database-view': requirementsDatabaseViewItem,
  'dpi-demo-seed-visual-review': demoSeedVisualReviewItem,
  'dpi-development-plan-table-inspector': developmentPlanTableInspectorItem,
} as const;
```

- [ ] **Step 4: Update API mock responses for every canonical route**

Modify `tests/web/fixtures/product-api-mock.ts` so these paths resolve:

```ts
[`GET /query/development-plans/${developmentPlan.id}/items/dpi-cockpit-command-center`]: itemProjectionFor(developmentPlanItemsById['dpi-cockpit-command-center']),
[`GET /query/development-plans/${developmentPlan.id}/items/dpi-requirements-database-view`]: itemProjectionFor(developmentPlanItemsById['dpi-requirements-database-view']),
[`GET /query/development-plans/${developmentPlan.id}/items/dpi-demo-seed-visual-review`]: itemProjectionFor(developmentPlanItemsById['dpi-demo-seed-visual-review']),
[`GET /query/development-plans/${developmentPlan.id}/items/dpi-development-plan-table-inspector`]: itemProjectionFor(developmentPlanItemsById['dpi-development-plan-table-inspector']),
```

Add a rejected response path for retired query mode:

```ts
[`GET /query/reports?project_id=${projectId}&report=replay`]: () =>
  new Response(JSON.stringify({ message: 'Replay report is dev-only in product architecture rebuild.' }), { status: 404 }),
```

- [ ] **Step 5: Write failing product-review preview script test**

Create `tests/smoke/product-review-preview-script.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { productReviewPreviewEnv, renderProductReviewPreviewSummary } from '../../scripts/product-review-preview';

describe('product review preview script', () => {
  it('defaults to seeded in-memory review mode without fixed Postgres ports', () => {
    const env = productReviewPreviewEnv({ apiPort: 58988, webPort: 58772 });
    expect(env.FORGELOOP_DEMO_SEED_ID).toBe('project-product-architecture-demo');
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.VITE_FORGELOOP_API_URL).toBe('http://127.0.0.1:58988');
    expect(renderProductReviewPreviewSummary({ apiUrl: 'http://127.0.0.1:58988', webUrl: 'http://127.0.0.1:58772' })).toContain(
      'Seed: project-product-architecture-demo',
    );
  });
});
```

- [ ] **Step 6: Implement the product-review preview script**

Create `scripts/product-review-preview.ts` with exported pure helpers first:

```ts
export const productArchitectureSeedId = 'project-product-architecture-demo';

export function productReviewPreviewEnv({ apiPort, webPort }: { apiPort: number; webPort: number }) {
  return {
    FORGELOOP_DEMO_SEED_ID: productArchitectureSeedId,
    FORGELOOP_REPOSITORY_MODE: 'memory',
    VITE_FORGELOOP_API_URL: `http://127.0.0.1:${apiPort}`,
    VITE_FORGELOOP_QUERY_RETRY: 'false',
    FORGELOOP_WEB_PORT: String(webPort),
  } satisfies Record<string, string>;
}

export function renderProductReviewPreviewSummary({ apiUrl, webUrl }: { apiUrl: string; webUrl: string }) {
  return [`Seed: ${productArchitectureSeedId}`, `API: ${apiUrl}`, `Web: ${webUrl}`].join('\n');
}
```

Then add process-spawning code using `node:child_process` and free ports. Keep the CLI path thin and covered by smoke tests through pure helpers.

- [ ] **Step 7: Add package script**

Modify `package.json`:

```json
"preview:product-review": "tsx --tsconfig tsconfig.node.json scripts/product-review-preview.ts"
```

- [ ] **Step 8: Run fixture and script tests**

Run:

```bash
pnpm vitest run tests/web/product-architecture-demo-data.test.ts tests/smoke/product-review-preview-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add tests/web/fixtures/product-data.ts \
  tests/web/fixtures/product-api-mock.ts \
  tests/web/product-architecture-demo-data.test.ts \
  tests/e2e/helpers/capture-route-screenshots.ts \
  scripts/product-review-preview.ts \
  tests/smoke/product-review-preview-script.test.ts \
  package.json
git commit -m "test: seed product architecture review data"
```

---

## Task 3: Page-Family Layout Primitives And Primary Surface Gates

**Files:**
- Create: `apps/web/src/shared/layout/product-page/product-page.tsx`
- Create: `apps/web/src/shared/layout/page-families/page-families.tsx`
- Modify: `apps/web/src/shared/layout/workspace-page/workspace-page.tsx`
- Modify: `apps/web/src/shared/layout/index.ts`
- Modify: `apps/web/src/shared/styles/theme.css`
- Modify: `apps/web/src/features/product-surfaces/first-viewport-contract.ts`
- Modify: `tests/web/helpers/first-viewport-contract.ts`
- Modify: `tests/web/product-grade-layout-primitives.test.tsx`

- [ ] **Step 1: Replace primitive tests with the new contract**

In `tests/web/product-grade-layout-primitives.test.tsx`, replace the `WorkspacePage` summary test with:

```tsx
import { ProductPage, CockpitLayout } from '../../apps/web/src/shared/layout';

it('renders ProductPage without old first viewport summary markers', () => {
  render(
    <ProductPage family="cockpit" heading="Cockpit">
      <CockpitLayout
        attentionQueue={<section>Attention queue</section>}
        commandStrip={<div>Command strip</div>}
        healthRail={<aside>Health</aside>}
        riskColumn={<section>Risks</section>}
      />
    </ProductPage>,
  );

  expect(screen.getByRole('main', { name: 'Cockpit' }).getAttribute('data-page-family')).toBe('cockpit');
  expect(document.querySelectorAll('[data-primary-work-surface]')).toHaveLength(1);
  expect(document.querySelector('[data-primary-work-surface]')?.textContent).toBe('Attention queue');
  expect(document.querySelector('[data-first-viewport]')).toBeNull();
  expect(screen.queryByTestId('current-state')).toBeNull();
  expect(screen.queryByTestId('next-action')).toBeNull();
});
```

- [ ] **Step 2: Run primitive test to verify it fails**

Run: `pnpm vitest run tests/web/product-grade-layout-primitives.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because `ProductPage` and `CockpitLayout` do not exist.

- [ ] **Step 3: Implement ProductPage**

Create `apps/web/src/shared/layout/product-page/product-page.tsx`:

```tsx
import { useId, type ReactNode } from 'react';
import { cn } from '../../utils/cn';

export interface ProductPageProps {
  children: ReactNode;
  className?: string | undefined;
  family: string;
  heading: ReactNode;
  headingClassName?: string | undefined;
  toolbar?: ReactNode;
}

export function ProductPage({ children, className, family, heading, headingClassName, toolbar }: ProductPageProps) {
  const headingId = useId();
  const label = typeof heading === 'string' ? heading : undefined;

  return (
    <main
      aria-label={label}
      aria-labelledby={label ? undefined : headingId}
      className={cn('grid min-w-0 gap-4 px-4 py-4 md:px-6 md:py-5', className)}
      data-page-family={family}
    >
      <header className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className={cn('m-0 text-lg font-semibold leading-tight text-text-primary', headingClassName)} id={headingId}>
          {heading}
        </h1>
        {toolbar ? <div className="flex min-w-0 flex-wrap items-center gap-2">{toolbar}</div> : null}
      </header>
      {children}
    </main>
  );
}
```

- [ ] **Step 4: Implement page-family wrappers**

Create `apps/web/src/shared/layout/page-families/page-families.tsx` with small composition wrappers. Start with the shared helper and two examples:

```tsx
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../utils/cn';

function PrimarySurface({
  children,
  className,
  ...landmarkProps
}: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return (
    <section {...landmarkProps} className={cn('min-w-0', className)} data-primary-work-surface="">
      {children}
    </section>
  );
}

export function CockpitLayout({
  attentionQueue,
  commandStrip,
  healthRail,
  riskColumn,
}: {
  attentionQueue: ReactNode;
  commandStrip: ReactNode;
  healthRail: ReactNode;
  riskColumn: ReactNode;
}) {
  return (
    <div className="grid gap-4" data-command-strip="">
      <div>{commandStrip}</div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)_18rem]">
        <PrimarySurface className="content-start" data-attention-queue="">
          {attentionQueue}
        </PrimarySurface>
        <section data-risk-column="">{riskColumn}</section>
        <aside data-health-rail="">{healthRail}</aside>
      </div>
    </div>
  );
}

export function DatabaseViewLayout({
  inspector,
  table,
  toolbar,
}: {
  inspector?: ReactNode;
  table: ReactNode;
  toolbar: ReactNode;
}) {
  return (
    <div className="grid gap-3">
      <div data-database-toolbar="">{toolbar}</div>
      <div className={inspector ? 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]' : 'grid gap-4'}>
        <PrimarySurface data-data-table="">
          {table}
        </PrimarySurface>
        {inspector ? <aside data-row-preview="">{inspector}</aside> : null}
      </div>
    </div>
  );
}
```

Then add the remaining wrappers with these exact prop contracts and primary-surface targets. Each wrapper must render exactly one `PrimarySurface`; optional slots render only when provided.

```tsx
export function InboxLayout({
  groups,
  inspector,
  list,
  toolbar,
}: {
  groups?: ReactNode;
  inspector?: ReactNode;
  list: ReactNode;
  toolbar?: ReactNode;
}) {
  return (
    <div className="grid gap-3">
      {toolbar ? <div data-inbox-toolbar="">{toolbar}</div> : null}
      {groups ? <div data-inbox-groups="">{groups}</div> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <PrimarySurface data-inbox-list="">{list}</PrimarySurface>
        {inspector ? <aside data-inspector-panel="">{inspector}</aside> : null}
      </div>
    </div>
  );
}

export function DocumentWorkspaceLayout({
  attachments,
  document,
  properties,
}: {
  attachments?: ReactNode;
  document: ReactNode;
  properties?: ReactNode;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <PrimarySurface data-document-surface="">{document}</PrimarySurface>
      <aside className="grid content-start gap-3">
        {properties ? <div data-property-rail="">{properties}</div> : null}
        {attachments ? <div data-attachment-strip="">{attachments}</div> : null}
      </aside>
    </div>
  );
}

export function SourceEvidenceLayout({
  attachments,
  rawDetails,
  summary,
}: {
  attachments?: ReactNode;
  rawDetails?: ReactNode;
  summary: ReactNode;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)]">
      <PrimarySurface data-evidence-summary="">{summary}</PrimarySurface>
      <section className="grid content-start gap-3">
        {attachments ? <div data-attachment-list="">{attachments}</div> : null}
        {rawDetails ? <div data-raw-evidence-details="">{rawDetails}</div> : null}
      </section>
    </div>
  );
}

export function PlanningTableLayout({ inspector, table, toolbar }: { inspector?: ReactNode; table: ReactNode; toolbar?: ReactNode }) {
  return (
    <div className="grid gap-3">
      {toolbar ? <div data-planning-toolbar="">{toolbar}</div> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <PrimarySurface data-plan-items-table="">{table}</PrimarySurface>
        {inspector ? <aside data-inspector-panel="">{inspector}</aside> : null}
      </div>
    </div>
  );
}

export function PlanAuthoringLayout({
  aiAssist,
  preview,
  primarySurface = 'source-context',
  sourceContext,
}: {
  aiAssist?: ReactNode;
  preview?: ReactNode;
  primarySurface?: 'source-context' | 'preview';
  sourceContext: ReactNode;
}) {
  const sourceContextNode =
    primarySurface === 'source-context'
      ? <PrimarySurface data-source-context-picker="">{sourceContext}</PrimarySurface>
      : <section data-source-context-picker="">{sourceContext}</section>;
  const previewNode =
    preview === undefined
      ? null
      : primarySurface === 'preview'
        ? <PrimarySurface data-plan-preview="">{preview}</PrimarySurface>
        : <div data-plan-preview="">{preview}</div>;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1fr)]">
      {sourceContextNode}
      <section className="grid content-start gap-3">
        {aiAssist ? <div data-ai-assist-panel="">{aiAssist}</div> : null}
        {previewNode}
      </section>
    </div>
  );
}

export function GateFlowLayout({
  contextRail,
  gateStepper,
  workspace,
}: {
  contextRail?: ReactNode;
  gateStepper?: ReactNode;
  workspace: ReactNode;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid gap-3">
        {gateStepper ? <div data-gate-stepper="">{gateStepper}</div> : null}
        <PrimarySurface data-gate-workspace="">{workspace}</PrimarySurface>
      </div>
      {contextRail ? <aside data-context-rail="">{contextRail}</aside> : null}
    </div>
  );
}

export function DocumentReviewLayout({
  commentSummary,
  document,
  reviewState,
  toolbar,
}: {
  commentSummary?: ReactNode;
  document: ReactNode;
  reviewState?: ReactNode;
  toolbar?: ReactNode;
}) {
  return (
    <div className="grid gap-3">
      {toolbar ? <div data-review-toolbar="">{toolbar}</div> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <PrimarySurface data-document-surface="">{document}</PrimarySurface>
        <aside className="grid content-start gap-3">
          {reviewState ? <div data-review-state="">{reviewState}</div> : null}
          {commentSummary ? <div data-comment-summary="">{commentSummary}</div> : null}
        </aside>
      </div>
    </div>
  );
}

export function CodeReviewLayout({ controls, evidence, workspace }: { controls?: ReactNode; evidence?: ReactNode; workspace: ReactNode }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <PrimarySurface data-code-review-workspace="">{workspace}</PrimarySurface>
      <aside className="grid content-start gap-3">
        {evidence ? <div data-review-evidence="">{evidence}</div> : null}
        {controls ? <div data-review-decision-controls="">{controls}</div> : null}
      </aside>
    </div>
  );
}

export function QaHandoffLayout({ controls, evidence, workspace }: { controls?: ReactNode; evidence?: ReactNode; workspace: ReactNode }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <PrimarySurface data-qa-handoff-workspace="">{workspace}</PrimarySurface>
      <aside className="grid content-start gap-3">
        {evidence ? <div data-qa-acceptance-evidence="">{evidence}</div> : null}
        {controls ? <div data-qa-decision-controls="">{controls}</div> : null}
      </aside>
    </div>
  );
}

export function DocumentGovernanceLayout({ groups, inspector, queue }: { groups?: ReactNode; inspector?: ReactNode; queue: ReactNode }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid gap-3">
        {groups ? <div data-document-review-groups="">{groups}</div> : null}
        <PrimarySurface data-document-queue="">{queue}</PrimarySurface>
      </div>
      {inspector ? <aside data-inspector-panel="">{inspector}</aside> : null}
    </div>
  );
}

export function DeliveryBoardLayout({ columns, toolbar }: { columns: ReactNode; toolbar?: ReactNode }) {
  return (
    <div className="grid gap-3">
      {toolbar ? <div data-board-toolbar="">{toolbar}</div> : null}
      <PrimarySurface className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4" data-board-columns="">
        {columns}
      </PrimarySurface>
    </div>
  );
}

export function ExecutionSupervisionLayout({
  controls,
  evidence,
  lanes,
  primarySurface = 'lanes',
}: {
  controls?: ReactNode;
  evidence?: ReactNode;
  lanes: ReactNode;
  primarySurface?: 'lanes' | 'evidence';
}) {
  const lanesNode =
    primarySurface === 'lanes'
      ? <PrimarySurface data-execution-lanes="">{lanes}</PrimarySurface>
      : <section data-execution-lanes="">{lanes}</section>;
  const evidenceNode =
    evidence === undefined
      ? null
      : primarySurface === 'evidence'
        ? <PrimarySurface data-run-evidence="">{evidence}</PrimarySurface>
        : <div data-run-evidence="">{evidence}</div>;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      {lanesNode}
      <aside className="grid content-start gap-3">
        {evidenceNode}
        {controls ? <div data-worker-controls="">{controls}</div> : null}
      </aside>
    </div>
  );
}

export function ReleaseReadinessLayout({
  blockers,
  evidence,
  rolloutPlan,
  scope,
}: {
  blockers: ReactNode;
  evidence?: ReactNode;
  rolloutPlan?: ReactNode;
  scope?: ReactNode;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <PrimarySurface data-readiness-blockers="">{blockers}</PrimarySurface>
      <aside className="grid content-start gap-3">
        {scope ? <div data-release-scope="">{scope}</div> : null}
        {evidence ? <div data-qa-evidence="">{evidence}</div> : null}
        {rolloutPlan ? <div data-rollout-plan="">{rolloutPlan}</div> : null}
      </aside>
    </div>
  );
}

export function ReleaseEvidenceLayout({ evidence, rawEvidence, summary }: { evidence?: ReactNode; rawEvidence?: ReactNode; summary: ReactNode }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)]">
      <PrimarySurface data-release-evidence-summary="">{summary}</PrimarySurface>
      <section className="grid content-start gap-3">
        {evidence ? <div data-release-evidence-list="">{evidence}</div> : null}
        {rawEvidence ? <div data-release-raw-evidence="">{rawEvidence}</div> : null}
      </section>
    </div>
  );
}

export function ReportInsightLayout({ actions, conclusion, signals }: { actions?: ReactNode; conclusion: ReactNode; signals?: ReactNode }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
      <PrimarySurface data-report-conclusion="">{conclusion}</PrimarySurface>
      <section className="grid content-start gap-3">
        {signals ? <div data-report-signals="">{signals}</div> : null}
        {actions ? <div data-recommended-actions="">{actions}</div> : null}
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Export new primitives**

Modify `apps/web/src/shared/layout/index.ts`:

```ts
export { ProductPage, type ProductPageProps } from './product-page/product-page';
export {
  CockpitLayout,
  InboxLayout,
  DatabaseViewLayout,
  DocumentWorkspaceLayout,
  SourceEvidenceLayout,
  PlanningTableLayout,
  PlanAuthoringLayout,
  GateFlowLayout,
  DocumentReviewLayout,
  CodeReviewLayout,
  QaHandoffLayout,
  DocumentGovernanceLayout,
  DeliveryBoardLayout,
  ExecutionSupervisionLayout,
  ReleaseReadinessLayout,
  ReleaseEvidenceLayout,
  ReportInsightLayout,
} from './page-families/page-families';
```

- [ ] **Step 6: Add a temporary compile bridge for WorkspacePage during migration**

Do not change the exported `WorkspacePageProps` shape in this task. Existing `ObjectWorkspace`, `QueueWorkspace`, `PlanningTableWorkspace`, and `GateWorkspace` consumers still compile through later route migration tasks and still pass props such as `state`, `nextAction`, `roleResponsibility`, and `blockerRisk`.

Instead, make `WorkspacePage` semantic-only while route migration is in progress:

```tsx
export function WorkspacePage(props: WorkspacePageProps) {
  const { as: Root = 'main', children, family, heading, layout, subtitle, toolbar } = props;
  return (
    <Root className="grid min-w-0 gap-4 px-4 py-4 md:px-6 md:py-5" data-page-family={family} data-workspace-layout={layout}>
      <header className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1>{heading}</h1>
        {toolbar}
        {subtitle}
      </header>
      {children}
    </Root>
  );
}
```

Remove `PrioritySummary`, `ActionStrip`, and old `data-first-viewport` rendering from `WorkspacePage`, but keep the old props accepted and ignored only as a temporary compile bridge for Tasks 4-7. This is not a final compatibility surface: Task 9 must remove `WorkspacePage`, `ObjectWorkspace`, `QueueWorkspace`, `PlanningTableWorkspace`, `GateWorkspace`, `PrioritySummary`, and `ActionStrip` exports/files after route migration has removed every import. Product route tests must still reject old markers throughout the branch.

- [ ] **Step 7: Update first-viewport contract helper**

Modify `apps/web/src/features/product-surfaces/first-viewport-contract.ts`:

```ts
export const firstViewportContract = {
  pageFamilyAttribute: 'data-page-family',
  primaryWorkSurfaceAttribute: 'data-primary-work-surface',
  forbiddenAttributes: ['data-first-viewport', 'data-priority-summary', 'data-action-strip'],
  forbiddenTestIds: ['current-state', 'role-responsibility', 'blocker-risk', 'next-action'],
} as const;
```

Modify `tests/web/helpers/first-viewport-contract.ts` to require exactly one visible primary work surface.

- [ ] **Step 8: Run layout tests**

Run:

```bash
pnpm vitest run tests/web/product-grade-layout-primitives.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS. Do not require `tests/web/product-grade-first-viewport.test.tsx` to pass in Task 3; that route-wide suite becomes green only after Tasks 4-7 migrate every product route to the new family contract.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/shared/layout apps/web/src/shared/styles/theme.css \
  apps/web/src/features/product-surfaces/first-viewport-contract.ts \
  tests/web/helpers/first-viewport-contract.ts \
  tests/web/product-grade-layout-primitives.test.tsx
git commit -m "feat: add page-family visual contracts"
```

---

## Task 4: Cockpit, My Work, And Delivery Board Layouts

**Files:**
- Modify: `apps/web/src/features/cockpit/cockpit-route.tsx`
- Modify: `apps/web/src/features/cockpit/cockpit-view-model.ts`
- Modify: `apps/web/src/features/my-work/my-work-route.tsx`
- Modify: `apps/web/src/features/my-work/my-work-view-model.ts`
- Modify: `apps/web/src/features/board/board-route.tsx`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`
- Modify: `tests/web/my-work-board-reports.test.tsx`

- [ ] **Step 1: Write failing page-family tests**

Add expectations:

```ts
expect(document.querySelector('[data-page-family="cockpit"]')).toBeTruthy();
expect(document.querySelector('[data-attention-queue][data-primary-work-surface]')).toBeTruthy();
expect(document.querySelector('[data-first-viewport]')).toBeNull();

expect(document.querySelector('[data-page-family="inbox"]')).toBeTruthy();
expect(document.querySelector('[data-inbox-list][data-primary-work-surface]')).toBeTruthy();

expect(document.querySelector('[data-page-family="delivery-board"]')).toBeTruthy();
expect(document.querySelector('[data-board-columns][data-primary-work-surface]')).toBeTruthy();
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `pnpm vitest run tests/web/product-grade-first-viewport.test.tsx tests/web/my-work-board-reports.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because routes still use `WorkspacePage` and old family names.

- [ ] **Step 3: Rewrite Cockpit with `ProductPage` and `CockpitLayout`**

Replace the `WorkspacePage` root in `apps/web/src/features/cockpit/cockpit-route.tsx`:

```tsx
return (
  <ProductPage family="cockpit" heading="Cockpit" toolbar={<StatusPill tone="info">{viewModel.objectType}</StatusPill>}>
    <CockpitLayout
      commandStrip={<MetadataActionList items={viewModel.roleSelectedQueue} />}
      attentionQueue={
        <div className="grid gap-3">
          <AttentionSection description="Execution continuity and resumability signals." items={viewModel.activeExecutionItems} title="Active and resumable executions" />
          <AttentionSection description="Item-scoped Spec and Execution Plan review attention." items={viewModel.specExecutionPlanItems} title="Spec / Execution Plan review queue" />
          <AttentionSection description="QA handoff, release confidence, and readiness evidence attention." items={viewModel.qaReleaseAttentionItems} title="QA and release readiness attention" />
        </div>
      }
      riskColumn={
        <GateProgress
          gates={viewModel.blockerAndStaleGates.map((gate) => ({
            id: String(gate.label),
            label: gate.label,
            status: gate.disabledReason === undefined ? gate.state : `${gate.state}: ${gate.disabledReason}`,
          }))}
        />
      }
      healthRail={<CompactMetadata items={viewModel.compactHealthIndicators} />}
    />
  </ProductPage>
);
```

Keep existing data loading hooks and existing local helpers such as `MetadataActionList` and `AttentionSection`. Move low-priority explanatory copy below the primary layout.

- [ ] **Step 4: Rewrite My Work as inbox plus inspector**

In `apps/web/src/features/my-work/my-work-route.tsx`, render:

```tsx
<ProductPage
  family="inbox"
  heading="My Work"
  toolbar={<QueueFilterToolbar label="Role" options={baseViewModel.filters.roles} selected={roleFilter} setSelected={setRoleFilter} />}
>
  <InboxLayout
    groups={<QueueFilterToolbar label="Gate" options={baseViewModel.filters.gates} selected={gateFilter} setSelected={setGateFilter} />}
    list={filteredGroups.map((group) => (
      <MyWorkGroup
        focusedRowKey={focusedRow?.id}
        group={group}
        key={group.id}
        onFocusRow={(row) => setFocusedRowKey(row.id)}
        onToggleSelectedRow={toggleSelectedRow}
        selectedRowIds={selectedRowIds}
      />
    ))}
    inspector={<SelectedItemPreview disabledReason={viewModel.disabledReason} row={focusedRow} selectedCount={selectedRows.length} />}
  />
</ProductPage>
```

Reuse existing local helpers `QueueFilterToolbar`, `MyWorkGroup`, and `SelectedItemPreview`. Do not render one empty table per role.

- [ ] **Step 5: Rewrite Board as Plan Item gate board**

In `apps/web/src/features/board/board-route.tsx`, render:

```tsx
<ProductPage family="delivery-board" heading="Board">
  <DeliveryBoardLayout
    toolbar={activeFocus === undefined ? null : <InlineNotice title={boardFocusTitle(activeFocus)} tone="info" />}
    columns={groupByGate(cards).map(({ cards: columnCards, column }) => (
      <section aria-label={`${column.label} cards`} className="grid min-w-0 content-start gap-3 border-t border-border pt-3" key={column.id}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="m-0 text-sm font-semibold text-text-primary">{column.label}</h2>
          <Badge tone={columnCards.length > 0 ? 'primary' : 'neutral'}>{columnCards.length}</Badge>
        </div>
        {columnCards.map((card) => <BoardObjectCard card={card} key={card.id} />)}
      </section>
    ))}
  />
</ProductPage>
```

Reuse existing `groupByGate`, `boardFocusTitle`, and `BoardObjectCard`. Rename the first board column label from intake wording to `Planning`; the full columns are `Planning`, `Boundary`, `Spec`, `Execution Plan`, `Running`, `Review`, `QA`, `Release`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm vitest run tests/web/product-grade-first-viewport.test.tsx tests/web/my-work-board-reports.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/cockpit apps/web/src/features/my-work apps/web/src/features/board \
  tests/web/product-grade-first-viewport.test.tsx tests/web/my-work-board-reports.test.tsx
git commit -m "feat: rebuild workspace entry surfaces"
```

---

## Task 5: Typed Source Object Database, Document, Evidence, And MDX Editing

**Files:**
- Modify: `apps/web/src/features/project-management/object-list.tsx`
- Modify: `apps/web/src/features/project-management/object-detail-layout.tsx`
- Modify: `apps/web/src/features/project-management/object-evidence-route.tsx`
- Modify: `apps/web/src/features/project-management/object-forms.tsx`
- Modify: `apps/web/src/features/requirements/requirements-routes.tsx`
- Modify: `apps/web/src/features/bugs/bugs-routes.tsx`
- Modify: `apps/web/src/features/initiatives/initiatives-routes.tsx`
- Modify: `apps/web/src/features/tech-debt/tech-debt-routes.tsx`
- Modify: `apps/web/src/shared/ui/markdown-editor/markdown-editor.tsx`
- Modify: `tests/web/project-management-routes.test.tsx`
- Modify: `tests/web/markdown-editor.test.tsx`
- Modify: `tests/web/markdown-editor-rich-mode.test.tsx`
- Modify: `tests/web/markdown-editor-attachments.test.tsx`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`

- [ ] **Step 1: Write failing source object layout tests**

Add route tests:

```ts
expect(document.querySelector('[data-page-family="source-database"]')).toBeTruthy();
expect(document.querySelector('[data-database-toolbar]')).toBeTruthy();
expect(document.querySelector('[data-data-table][data-primary-work-surface]')).toBeTruthy();
expect(document.querySelector('[data-page-family="source-document"]')).toBeTruthy();
expect(document.querySelector('[data-document-surface][data-primary-work-surface]')).toBeTruthy();
expect(document.querySelector('[data-page-family="source-evidence"]')).toBeTruthy();
expect(document.querySelector('[data-evidence-summary][data-primary-work-surface]')).toBeTruthy();
```

- [ ] **Step 2: Write failing MDX image editing tests**

In `tests/web/markdown-editor-attachments.test.tsx`, assert paste, drag/drop, and file-picker metadata on source-object document refs:

```tsx
it('persists pasted image refs with alt text and caption metadata', async () => {
  const onChange = vi.fn();
  const onUploadAttachment = vi.fn(async (file: File, objectRef) =>
    publicAttachmentFixture({
      id: 'att-plan-flow',
      owner_object_type: objectRef.type,
      owner_object_id: objectRef.id,
      filename: file.name,
      content_type: file.type,
      alt_text: 'Plan Item generation flow',
      caption: 'Plan Item generation flow',
    }),
  );
  render(
    <EditableEditor
      allowedBlocks={['paragraph', 'heading', 'link', 'image']}
      objectRef={{ type: 'requirement', id: 'req-plan-item-governance' }}
      onChange={onChange}
      onUploadAttachment={onUploadAttachment}
      value=""
    />,
  );
  const editor = screen.getByRole('textbox', { name: /markdown editor/i });
  fireEvent.paste(editor, {
    clipboardData: {
      files: [new File(['image'], 'flow.png', { type: 'image/png' })],
      getData: () => '',
    },
  });
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.stringContaining('attachment://att-plan-flow')));
  expect(onUploadAttachment).toHaveBeenCalledWith(expect.any(File), { type: 'requirement', id: 'req-plan-item-governance' });
});

it('persists dropped and file-picker image refs with alt text and caption metadata', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const onUploadAttachment = vi
    .fn()
    .mockImplementationOnce(async (file: File, objectRef) =>
      publicAttachmentFixture({
        id: 'att-file-picker-flow',
        owner_object_type: objectRef.type,
        owner_object_id: objectRef.id,
        filename: file.name,
        content_type: file.type,
        alt_text: 'Plan Item file picker flow',
        caption: 'Plan Item file picker flow',
      }),
    )
    .mockImplementationOnce(async (file: File, objectRef) =>
      publicAttachmentFixture({
        id: 'att-drop-flow',
        owner_object_type: objectRef.type,
        owner_object_id: objectRef.id,
        filename: file.name,
        content_type: file.type,
        alt_text: 'Plan Item dropped flow',
        caption: 'Plan Item dropped flow',
      }),
    );

  render(
    <EditableEditor
      allowedBlocks={['paragraph', 'heading', 'link', 'image']}
      objectRef={{ type: 'requirement', id: 'req-plan-item-governance' }}
      onChange={onChange}
      onUploadAttachment={onUploadAttachment}
      value=""
    />,
  );

  await user.click(screen.getByRole('button', { name: /insert image/i }));
  await uploadFile(screen.getByLabelText(/image file/i), new File(['image'], 'picker.png', { type: 'image/png' }));
  await dropImage(screen.getByRole('textbox', { name: /markdown editor/i }), new File(['image'], 'drop.png', { type: 'image/png' }));

  await waitFor(() => expect(onUploadAttachment).toHaveBeenCalledTimes(2));
  expect(onChange).toHaveBeenCalledWith(expect.stringContaining('attachment://att-file-picker-flow'));
  expect(onChange).toHaveBeenCalledWith(expect.stringContaining('attachment://att-drop-flow'));
});

it('keeps source-object edits recoverable after failed upload and failed save', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockRejectedValueOnce(new Error('save failed')).mockResolvedValueOnce(undefined);
  const onUploadAttachment = vi
    .fn()
    .mockRejectedValueOnce(new Error('upload failed'))
    .mockResolvedValueOnce(
      publicAttachmentFixture({
        id: 'att-source-recovered',
        owner_object_type: 'requirement',
        owner_object_id: 'req-plan-item-governance',
        filename: 'recovered.png',
        content_type: 'image/png',
        alt_text: 'Recovered source object image',
      }),
    );

  render(
    <EditableEditor
      allowedBlocks={['paragraph', 'heading', 'link', 'image']}
      guardRouteTransitions
      objectRef={{ type: 'requirement', id: 'req-plan-item-governance' }}
      onSave={onSave}
      onUploadAttachment={onUploadAttachment}
      value="Initial requirement narrative"
    />,
  );

  await pasteImage(screen.getByRole('textbox', { name: /markdown editor/i }));
  expect(await screen.findByText(/upload failed/i)).toBeVisible();

  await pasteImage(screen.getByRole('textbox', { name: /markdown editor/i }));
  await waitFor(() => expect((screen.getByRole('textbox', { name: /markdown editor/i }) as HTMLTextAreaElement).value).toContain('attachment://att-source-recovered'));

  await user.type(screen.getByRole('textbox', { name: /markdown editor/i }), '\nRecoverable source edit');
  await user.click(screen.getByRole('button', { name: /save/i }));
  expect(await screen.findByText(/save failed/i)).toBeVisible();
  expect((screen.getByRole('textbox', { name: /markdown editor/i }) as HTMLTextAreaElement).value).toContain('Recoverable source edit');

  await user.click(screen.getByRole('button', { name: /save/i }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
});
```

In `tests/web/markdown-editor.test.tsx`, add preview/render safety and fidelity coverage for read-only and preview rendering. First add the local attachment fixture import/helper near the top of the file so the test is buildable:

```ts
import type { AttachmentRef } from '@forgeloop/contracts';

const publicAttachmentFixture = (overrides: Partial<AttachmentRef> = {}): AttachmentRef => ({
  id: 'att-1',
  owner_object_type: 'requirement',
  owner_object_id: 'req-plan-item-governance',
  linked_object_refs: [],
  filename: 'flow.png',
  content_type: 'image/png',
  size_bytes: 128,
  checksum_sha256: 'a'.repeat(64),
  uploaded_by_actor_id: 'actor-product',
  created_at: '2026-05-23T00:00:00.000Z',
  evidence_category: 'image',
  visibility: 'object',
  safety_status: 'passed',
  reference_status: 'active',
  ...overrides,
});
```

Then add the preview test:

```tsx
it('sanitizes unsafe script content while preserving code blocks, tables, links, and attachment image refs in preview', () => {
  const previewAttachment = publicAttachmentFixture({
    id: 'att-preview-flow',
    owner_object_type: 'requirement',
    owner_object_id: 'req-plan-item-governance',
    filename: 'flow.png',
    content_type: 'image/png',
    alt_text: 'Preview flow',
  });
  render(
    <ForgeMarkdownEditor
      allowedBlocks={['paragraph', 'heading', 'link', 'image', 'table', 'code_block', 'inline_code']}
      attachments={[previewAttachment]}
      mode="read"
      objectRef={{ type: 'requirement', id: 'req-plan-item-governance' }}
      onChange={vi.fn()}
      onUploadAttachment={vi.fn()}
      validationPolicy={{ validation_version: '2026-05-23' }}
      value={[
        '# Requirement',
        '<script>alert(1)</script>',
        '[safe link](https://example.com)',
        '| Gate | State |',
        '| --- | --- |',
        '| Spec | Approved |',
        '```ts',
        'const value = \"<script>kept as code text\";',
        '```',
        '![Preview flow](attachment://att-preview-flow)',
      ].join('\n')}
    />,
  );

  expect(document.querySelector('script')).toBeNull();
  expect(screen.queryByText(/alert\(1\)/)).toBeNull();
  expect(screen.getByRole('link', { name: /safe link/i })).toHaveAttribute('href', 'https://example.com');
  expect(screen.getByRole('table')).toHaveTextContent(/Spec/);
  expect(screen.getByText(/const value/)).toBeTruthy();
  expect(screen.getByRole('img', { name: /preview flow/i })).toHaveAttribute('src', 'attachment://att-preview-flow');
});
```

- [ ] **Step 3: Run focused tests to verify they fail**

Run:

```bash
pnpm vitest run tests/web/project-management-routes.test.tsx tests/web/markdown-editor.test.tsx tests/web/markdown-editor-rich-mode.test.tsx tests/web/markdown-editor-attachments.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL on page-family landmarks, image insertion/recovery coverage, and preview/render safety/fidelity coverage.

- [ ] **Step 4: Migrate source object list to `DatabaseViewLayout`**

In `object-list.tsx`, replace `QueueWorkspace` with:

```tsx
<ProductPage
  family="source-database"
  heading={title}
  toolbar={
    <>
      <Link className={primaryLinkClass} to={createHref}>Create source object</Link>
      <Link className={secondaryButtonClass} to={planningHref}>Plan source object</Link>
    </>
  }
>
  <DatabaseViewLayout
    toolbar={
      <div className="flex min-w-0 flex-wrap items-center gap-2" data-filter-toolbar="">
        <Input aria-label={`Search ${title}`} onChange={(event) => setSearch(event.target.value)} role="searchbox" value={search} />
        <FilterChip label="Risk: All" onClick={() => setRiskFilter('all')} selected={riskFilter === 'all'} />
        <FilterChip label="Status: All" onClick={() => setStatusFilter('all')} selected={statusFilter === 'all'} />
      </div>
    }
    table={<DataTable ariaLabel={`${title} source object database`} columns={columns} rows={filteredRows} density="compact" stickyHeader />}
    inspector={focusedRow ? <SourceObjectPreview row={focusedRow} /> : undefined}
  />
</ProductPage>
```

Reuse existing `Link`, `Input`, `FilterChip`, `DataTable`, and `SourceObjectPreview` helpers from this file. Keep filters in one toolbar row at desktop.

- [ ] **Step 5: Migrate source object detail and authoring to document workspace**

In `object-detail-layout.tsx` and `object-forms.tsx`, replace `ObjectWorkspace` with `ProductPage` plus `DocumentWorkspaceLayout`:

```tsx
<ProductPage family="source-document" heading={objectLabel} toolbar={<SourceObjectActionBar detail={detail} />}>
  <DocumentWorkspaceLayout
    document={
      <ForgeMarkdownEditor
        allowedBlocks={sourceObjectAllowedBlocks}
        attachments={detail.attachment_refs ?? []}
        mode={canEdit ? 'edit' : 'read'}
        objectRef={{ type: detail.type, id: detail.id, driver_actor_id: detail.driver_actor_id }}
        onChange={setMarkdown}
        onSave={saveDraftOnly}
        onUploadAttachment={uploadAttachmentForObject}
        validationPolicy={{ validation_version: '2026-05-23' }}
        value={markdown}
      />
    }
    properties={<SourceObjectPropertyRail detail={detail} />}
    attachments={<EvidenceAttachments attachments={detail.attachment_refs ?? []} />}
  />
</ProductPage>
```

Create `SourceObjectActionBar` and `SourceObjectPropertyRail` as local helpers in `object-detail-layout.tsx` before using them. `SourceObjectActionBar` owns existing create/link/generate Development Plan actions; `SourceObjectPropertyRail` renders the existing status, risk, role, linked Development Plan, release, and evidence metadata.

- [ ] **Step 6: Migrate evidence route to `SourceEvidenceLayout`**

Use the readiness summary as the primary work surface:

```tsx
<ProductPage family="source-evidence" heading={heading}>
  <SourceEvidenceLayout
    summary={<EvidenceReadinessSummary readiness={readiness} />}
    attachments={<EvidenceAttachments attachments={attachmentRefs} />}
    rawDetails={<RawEvidenceDetails refs={sourceEvidenceRefs(detail)} />}
  />
</ProductPage>
```

If `EvidenceReadinessSummary`, `RawEvidenceDetails`, or `sourceEvidenceRefs` do not already exist, create them as local helpers in `object-evidence-route.tsx` with props matching the snippet. They must render existing attachment/evidence data, not introduce new API calls.

- [ ] **Step 7: Implement MDX image insertion metadata**

Extend `ForgeMarkdownEditor` so image paste/drop/file picker creates attachment refs with:

```ts
type PendingImageAttachment = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  alt_text: string;
  caption?: string;
  status: 'pending' | 'uploaded' | 'error';
};
```

Keep save separate from submit/approve.

- [ ] **Step 8: Run focused tests**

Run:

```bash
pnpm vitest run tests/web/project-management-routes.test.tsx tests/web/markdown-editor.test.tsx tests/web/markdown-editor-rich-mode.test.tsx tests/web/markdown-editor-attachments.test.tsx tests/web/product-grade-first-viewport.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/features/project-management apps/web/src/features/requirements apps/web/src/features/bugs \
  apps/web/src/features/initiatives apps/web/src/features/tech-debt apps/web/src/shared/ui/markdown-editor \
  tests/web/project-management-routes.test.tsx tests/web/markdown-editor.test.tsx tests/web/markdown-editor-rich-mode.test.tsx \
  tests/web/markdown-editor-attachments.test.tsx tests/web/product-grade-first-viewport.test.tsx
git commit -m "feat: rebuild typed source object workspaces"
```

---

## Task 6: Development Plans, Plan Item Gates, Review, And QA

**Files:**
- Modify: `apps/web/src/features/development-plans/development-plans-route.tsx`
- Modify: `apps/web/src/features/development-plans/development-plan-detail-route.tsx`
- Modify: `apps/web/src/features/development-plans/development-plan-item-detail-route.tsx`
- Modify: `apps/web/src/features/development-plans/development-plan-table.tsx`
- Modify: `apps/web/src/features/development-plans/plan-item-gates.tsx`
- Modify: `apps/web/src/features/code-review/code-review-handoff-panel.tsx`
- Modify: `apps/web/src/features/qa/qa-handoff-panel.tsx`
- Modify: `apps/web/src/shared/ui/markdown-editor/markdown-editor.tsx`
- Modify: `tests/web/development-plan-routes.test.tsx`
- Modify: `tests/web/code-review-qa-handoff-routes.test.tsx`
- Modify: `tests/web/markdown-editor-rich-mode.test.tsx`
- Modify: `tests/web/markdown-editor-attachments.test.tsx`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`

- [ ] **Step 1: Write failing tests for planning and gate landmarks**

Add expectations:

```ts
expect(document.querySelector('[data-page-family="planning-table"]')).toBeTruthy();
expect(document.querySelector('[data-plan-items-table][data-primary-work-surface]')).toBeTruthy();
expect(document.querySelector('[data-page-family="plan-authoring"]')).toBeTruthy();
expect(document.querySelector('[data-source-context-picker][data-primary-work-surface], [data-plan-preview][data-primary-work-surface]')).toBeTruthy();
expect(document.querySelector('[data-page-family="gate-flow"]')).toBeTruthy();
expect(document.querySelector('[data-gate-workspace][data-primary-work-surface]')).toBeTruthy();
```

For review and QA:

```ts
await renderRoute(`/development-plans/${developmentPlan.id}/items/dpi-cockpit-command-center/review`);
expect(document.querySelector('[data-page-family="code-review"]')).toBeTruthy();
expect(document.querySelector('[data-code-review-workspace][data-primary-work-surface]')).toBeTruthy();

await renderRoute(`/development-plans/${developmentPlan.id}/items/dpi-requirements-database-view/qa`);
expect(document.querySelector('[data-page-family="qa-handoff"]')).toBeTruthy();
expect(document.querySelector('[data-qa-handoff-workspace][data-primary-work-surface]')).toBeTruthy();
```

- [ ] **Step 2: Write failing tests for Spec and Execution Plan document editing**

In `tests/web/development-plan-routes.test.tsx`, cover both document review focus routes:

```ts
for (const focus of ['spec', 'execution-plan'] as const) {
  await renderRoute(`/development-plans/${developmentPlan.id}/items/dpi-cockpit-command-center/${focus}`);
  expect(document.querySelector('[data-page-family="document-review"]')).toBeTruthy();
  expect(document.querySelector('[data-document-surface][data-primary-work-surface]')).toBeTruthy();
  expect(screen.getByLabelText(/editor toolbar/i)).toBeVisible();
  expect(screen.getByRole('button', { name: /source mode|rich mode/i })).toBeVisible();
  expect(screen.getByRole('button', { name: /insert image/i })).toBeVisible();
  expect(screen.getByRole('button', { name: /save/i })).toBeVisible();
}
```

In `tests/web/markdown-editor-attachments.test.tsx`, reuse the source-object image insertion helper against item-scoped document refs:

```tsx
async function insertImageByPaste(filename: string, contentType: string) {
  const editor = screen.getByRole('textbox', { name: /markdown/i });
  fireEvent.paste(editor, {
    clipboardData: {
      files: [new File(['image'], filename, { type: contentType })],
      getData: () => '',
    },
  });
}

async function insertImageByDrop(filename: string, contentType: string) {
  const editor = screen.getByRole('textbox', { name: /markdown/i });
  fireEvent.drop(editor, {
    dataTransfer: {
      files: [new File(['image'], filename, { type: contentType })],
      items: [],
    },
  });
}

async function insertImageByFilePicker(filename: string, contentType: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /insert image/i }));
  await uploadFile(screen.getByLabelText(/image file/i), new File(['image'], filename, { type: contentType }));
}

it('keeps Spec and Execution Plan image refs stable across save, failed upload, and recovery', async () => {
  const onChange = vi.fn();
  const onUploadAttachment = vi
    .fn()
    .mockRejectedValueOnce(new Error('upload failed'))
    .mockResolvedValueOnce(
      publicAttachmentFixture({
        id: 'att-gate-state',
        owner_object_type: 'spec_revision',
        owner_object_id: 'specrev-cockpit-command-center-v1',
        filename: 'gate.png',
        content_type: 'image/png',
        alt_text: 'Gate state diagram',
      }),
    );
  render(
    <ForgeMarkdownEditor
      allowedBlocks={['paragraph', 'heading', 'link', 'image', 'table', 'code_block']}
      mode="edit"
      objectRef={{ type: 'spec_revision', id: 'specrev-cockpit-command-center-v1', spec_id: 'spec-cockpit-command-center' }}
      onChange={onChange}
      onUploadAttachment={onUploadAttachment}
      validationPolicy={{ validation_version: '2026-05-23' }}
      value="## Spec"
      attachments={[]}
    />,
  );

  await insertImageByPaste('gate.png', 'image/png');
  expect(await screen.findByText(/upload failed/i)).toBeVisible();
  expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining('attachment://'));

  await insertImageByPaste('gate.png', 'image/png');
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.stringContaining('attachment://att-gate-state')));
});

it('keeps item-scoped document image refs stable for drop and file-picker insertion', async () => {
  const onChange = vi.fn();
  const onUploadAttachment = vi
    .fn()
    .mockResolvedValueOnce(
      publicAttachmentFixture({
        id: 'att-execution-plan-drop',
        owner_object_type: 'execution_plan_revision',
        owner_object_id: 'planrev-requirements-database-view-v1',
        filename: 'drop.png',
        content_type: 'image/png',
        alt_text: 'Execution Plan dropped image',
      }),
    )
    .mockResolvedValueOnce(
      publicAttachmentFixture({
        id: 'att-execution-plan-picker',
        owner_object_type: 'execution_plan_revision',
        owner_object_id: 'planrev-requirements-database-view-v1',
        filename: 'picker.png',
        content_type: 'image/png',
        alt_text: 'Execution Plan picker image',
      }),
    );

  render(
    <ForgeMarkdownEditor
      allowedBlocks={['paragraph', 'heading', 'link', 'image', 'table', 'code_block']}
      mode="edit"
      objectRef={{ type: 'execution_plan_revision', id: 'planrev-requirements-database-view-v1', execution_plan_id: 'plan-requirements-database-view' }}
      onChange={onChange}
      onUploadAttachment={onUploadAttachment}
      validationPolicy={{ validation_version: '2026-05-23' }}
      value="## Execution Plan"
      attachments={[]}
    />,
  );

  await insertImageByDrop('drop.png', 'image/png');
  await insertImageByFilePicker('picker.png', 'image/png');

  await waitFor(() => expect(onUploadAttachment).toHaveBeenCalledTimes(2));
  expect(onChange).toHaveBeenCalledWith(expect.stringContaining('attachment://att-execution-plan-drop'));
  expect(onChange).toHaveBeenCalledWith(expect.stringContaining('attachment://att-execution-plan-picker'));
});

it('keeps item-scoped document edits recoverable after failed draft save', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockRejectedValueOnce(new Error('save failed')).mockResolvedValueOnce(undefined);
  render(
    <ForgeMarkdownEditor
      allowedBlocks={['paragraph', 'heading', 'link', 'image', 'table', 'code_block']}
      mode="edit"
      objectRef={{ type: 'spec_revision', id: 'specrev-cockpit-command-center-v1', spec_id: 'spec-cockpit-command-center' }}
      onChange={vi.fn()}
      onSave={onSave}
      onUploadAttachment={vi.fn()}
      validationPolicy={{ validation_version: '2026-05-23' }}
      value="## Spec"
      attachments={[]}
    />,
  );

  await user.click(screen.getByRole('button', { name: /source mode/i }));
  await user.type(screen.getByRole('textbox', { name: /markdown source/i }), '\nRecoverable draft note');
  await user.click(screen.getByRole('button', { name: /save/i }));

  expect(await screen.findByText(/save failed/i)).toBeVisible();
  expect((screen.getByRole('textbox', { name: /markdown source/i }) as HTMLTextAreaElement).value).toContain('Recoverable draft note');

  await user.click(screen.getByRole('button', { name: /save/i }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
});
```

In `tests/web/markdown-editor-rich-mode.test.tsx`, assert dirty-state navigation guard for the same item-scoped document editor:

```tsx
it('guards navigation away from dirty Spec and Execution Plan documents without submitting or approving', async () => {
  render(
    <ForgeMarkdownEditor
      allowedBlocks={['paragraph', 'heading', 'link', 'image', 'table', 'code_block']}
      guardRouteTransitions
      mode="edit"
      objectRef={{ type: 'execution_plan_revision', id: 'planrev-requirements-database-view-v1', execution_plan_id: 'plan-requirements-database-view' }}
      onChange={vi.fn()}
      onUploadAttachment={vi.fn()}
      validationPolicy={{ validation_version: '2026-05-23' }}
      value="Draft"
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: /source mode/i }));
  await userEvent.type(screen.getByRole('textbox', { name: /markdown source/i }), '\nUnsaved acceptance notes');
  expect(screen.getByLabelText(/editor toolbar/i)).toBeVisible();
  expect(screen.queryByRole('button', { name: /^approve/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /^submit/i })).toBeNull();
});
```

- [ ] **Step 3: Run focused tests to verify they fail**

Run:

```bash
pnpm vitest run tests/web/development-plan-routes.test.tsx tests/web/code-review-qa-handoff-routes.test.tsx tests/web/markdown-editor-rich-mode.test.tsx tests/web/markdown-editor-attachments.test.tsx tests/web/product-grade-first-viewport.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because old gate routes and old workspace wrappers are still used, and Spec/Execution Plan document routes do not yet expose the required MDX editing behavior.

- [ ] **Step 4: Migrate Development Plans index and detail**

Use `PlanningTableLayout` for `/development-plans` and `/development-plans/:id`.

```tsx
<ProductPage family="planning-table" heading="Development Plans" toolbar={<DevelopmentPlanToolbar />}>
  <PlanningTableLayout
    toolbar={<PlanFilterToolbar />}
    table={<DevelopmentPlanTable rows={rows} selectedId={selectedId} />}
    inspector={<DevelopmentPlanInspector plan={selectedPlan} />}
  />
</ProductPage>
```

Create or extract `DevelopmentPlanToolbar`, `PlanFilterToolbar`, and `DevelopmentPlanInspector` as local helpers in `development-plans-route.tsx` / `development-plan-detail-route.tsx` before using them. They must wrap the existing create/generate/filter/selected-plan metadata behavior already present in those files.

- [ ] **Step 5: Migrate `/development-plans/new`**

Use `PlanAuthoringLayout`:

```tsx
<ProductPage family="plan-authoring" heading="New Development Plan">
  <PlanAuthoringLayout
    sourceContext={<SourceContextPicker sources={sources} />}
    aiAssist={<DevelopmentPlanAiAssist />}
    preview={<GeneratedPlanPreview draft={draft} />}
  />
</ProductPage>
```

Create `SourceContextPicker`, `DevelopmentPlanAiAssist`, and `GeneratedPlanPreview` as local helpers in `development-plans-route.tsx` if they do not already exist. Each helper should use the existing Development Plan form state and command APIs; do not add a separate direct Spec or Execution Plan generation action here.

- [ ] **Step 6: Add `review` and `qa` focuses to Plan Item route**

In `development-plan-item-detail-route.tsx`:

```ts
export function DevelopmentPlanItemReviewRoute() {
  return <DevelopmentPlanItemSurface focus="review" />;
}

export function DevelopmentPlanItemQaRoute() {
  return <DevelopmentPlanItemSurface focus="qa" />;
}

type DevelopmentPlanItemFocus = 'overview' | 'brainstorming' | 'spec' | 'execution-plan' | 'execution' | 'review' | 'qa';
```

Render `CodeReviewLayout` and `QaHandoffLayout` for those focuses.

Update the route modules created in Task 1 after these exports exist:

```ts
// apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/review.tsx
import { DevelopmentPlanItemReviewRoute } from '../../../../../../features/development-plans/development-plan-item-detail-route';

export default DevelopmentPlanItemReviewRoute;

// apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/qa.tsx
import { DevelopmentPlanItemQaRoute } from '../../../../../../features/development-plans/development-plan-item-detail-route';

export default DevelopmentPlanItemQaRoute;
```

- [ ] **Step 7: Migrate gate routes to `GateFlowLayout` and document routes to `DocumentReviewLayout`**

Overview/brainstorming/execution use `GateFlowLayout`. Spec and Execution Plan focus routes render document body inside `DocumentReviewLayout` with `data-document-surface data-primary-work-surface`.

- [ ] **Step 8: Add MDXEditor document behavior to Spec and Execution Plan routes**

For `/development-plans/:id/items/:itemId/spec` and `/execution-plan`, render the same `ForgeMarkdownEditor` wrapper used by source-object documents, but bind it to item-scoped document revision refs:

```tsx
<DocumentReviewLayout
  document={
    <ForgeMarkdownEditor
      value={documentRevision.markdown}
      onChange={setMarkdown}
      onSave={saveDraftOnly}
      objectRef={{ type: focus === 'spec' ? 'spec_revision' : 'execution_plan_revision', id: documentRevision.id }}
      attachments={documentRevision.attachment_refs ?? []}
      allowedBlocks={['paragraph', 'heading', 'bold', 'italic', 'list', 'link', 'image', 'table', 'code_block', 'inline_code']}
      guardRouteTransitions
      mode={canEditDocument ? 'edit' : 'read'}
      onUploadAttachment={uploadAttachmentForDocumentRevision}
      validationPolicy={{ validation_version: '2026-05-23' }}
    />
  }
  toolbar={<DocumentReviewToolbar mode={mode} onModeChange={setMode} onInsertImage={openImagePicker} />}
  reviewState={<DocumentGateState status={document.status} />}
  commentSummary={<DocumentCommentSummary comments={comments} />}
/>
```

Create or extract `DocumentReviewToolbar`, `DocumentGateState`, and `DocumentCommentSummary` as local helpers in `development-plan-item-detail-route.tsx`. They must be view-only gate/document controls around the existing Spec/Execution Plan state; submit and approve remain separate existing gate actions.

Rules:

- Rich/source mode, image paste/drop/file-picker insertion, attachment refs, alt/caption metadata, dirty-state guard, and failed upload/save recovery must work on both item-scoped routes.
- Save draft, submit for review, and approve gate stay as separate controls. Saving must not submit or approve.
- Inserted images must render through stable attachment refs after save, not temporary blob URLs.

- [ ] **Step 9: Run focused tests**

Run:

```bash
pnpm vitest run tests/web/development-plan-routes.test.tsx tests/web/code-review-qa-handoff-routes.test.tsx tests/web/markdown-editor-rich-mode.test.tsx tests/web/markdown-editor-attachments.test.tsx tests/web/product-grade-first-viewport.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/features/development-plans apps/web/src/features/code-review apps/web/src/features/qa \
  apps/web/src/shared/ui/markdown-editor \
  apps/web/src/app/routes/development-plans/\$developmentPlanId/items/\$itemId/review.tsx \
  apps/web/src/app/routes/development-plans/\$developmentPlanId/items/\$itemId/qa.tsx \
  tests/web/development-plan-routes.test.tsx tests/web/code-review-qa-handoff-routes.test.tsx \
  tests/web/markdown-editor-rich-mode.test.tsx tests/web/markdown-editor-attachments.test.tsx \
  tests/web/product-grade-first-viewport.test.tsx
git commit -m "feat: rebuild planning and gate workspaces"
```

---

## Task 7: Document Reviews, Executions, Releases, And Reports

**Files:**
- Modify: `apps/web/src/features/spec-plan/specs-plans-route.tsx`
- Modify: `apps/web/src/features/spec-plan/spec-execution-plan-queue.tsx`
- Modify: `apps/web/src/features/spec-plan/spec-plan-view-model.ts`
- Modify: `apps/web/src/features/executions/executions-route.tsx`
- Modify: `apps/web/src/features/executions/execution-detail-route.tsx`
- Modify: `apps/web/src/features/executions/execution-view-model.ts`
- Modify: `apps/web/src/features/releases/release-routes.tsx`
- Modify: `apps/web/src/features/releases/release-view-model.ts`
- Modify: `apps/web/src/features/reports/reports-routes.tsx`
- Modify: `apps/web/src/features/reports/report-view-model.ts`
- Modify: `tests/web/executions-routes.test.tsx`
- Modify: `tests/web/board-reports-release-readiness.test.tsx`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`

- [ ] **Step 1: Write failing tests for remaining page families**

Add checks for:

```ts
expect(document.querySelector('[data-page-family="document-governance"]')).toBeTruthy();
expect(document.querySelector('[data-document-queue][data-primary-work-surface]')).toBeTruthy();
expect(document.querySelector('[data-page-family="execution-supervision"]')).toBeTruthy();
expect(document.querySelector('[data-execution-lanes][data-primary-work-surface], [data-run-evidence][data-primary-work-surface]')).toBeTruthy();
expect(document.querySelector('[data-page-family="release-readiness"]')).toBeTruthy();
expect(document.querySelector('[data-page-family="release-evidence"]')).toBeTruthy();
expect(document.querySelector('[data-page-family="report-insight"]')).toBeTruthy();
expect(document.querySelector('[data-report-conclusion][data-primary-work-surface]')).toBeTruthy();
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run:

```bash
pnpm vitest run tests/web/executions-routes.test.tsx tests/web/board-reports-release-readiness.test.tsx tests/web/product-grade-first-viewport.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL on old layouts and `/reports?report=replay` visibility.

- [ ] **Step 3: Migrate `/specs-plans` to `DocumentGovernanceLayout`**

The page heading stays route-specific, but navigation label is `Document Reviews`.

```tsx
<ProductPage family="document-governance" heading="Document Reviews">
  <DocumentGovernanceLayout
    queue={<SpecExecutionPlanQueue rows={rows} selectedId={selectedId} />}
    groups={<DocumentReviewGroups groups={groups} />}
    inspector={<DocumentReviewInspector row={selectedRow} />}
  />
</ProductPage>
```

Create or extract `DocumentReviewGroups` and `DocumentReviewInspector` as local helpers in `specs-plans-route.tsx` or `spec-execution-plan-queue.tsx`. They must use the existing `SpecExecutionPlanQueue` rows and selected row state; do not create standalone `/specs` or `/plans` routes.

- [ ] **Step 4: Migrate executions**

Use `ExecutionSupervisionLayout` for list and detail:

```tsx
<ProductPage family="execution-supervision" heading="Executions">
  <ExecutionSupervisionLayout
    lanes={<ExecutionLanes lanes={viewModel.lanes} />}
    evidence={<ExecutionEvidence execution={selectedExecution} />}
    controls={<WorkerControls execution={selectedExecution} />}
  />
</ProductPage>
```

Create or extract `ExecutionLanes`, `ExecutionEvidence`, and `WorkerControls` as local helpers in `executions-route.tsx` and `execution-detail-route.tsx`. They should wrap the existing `SupervisionLanes`, `ExecutionRow`, command buttons, changed-file/check evidence, and continue/interrupt/retry behavior rather than inventing new execution APIs.

- [ ] **Step 5: Migrate releases and release evidence**

Use `ReleaseReadinessLayout` for `/releases` and `/releases/:id`, and `ReleaseEvidenceLayout` for `/releases/:id/evidence`.

- [ ] **Step 6: Migrate reports and reject replay query mode**

Remove product-visible replay query mode from `reports-routes.tsx`. If `report=replay` remains for dev tools, guard it behind explicit dev mode.

```tsx
if (searchParams.get('report') === 'replay') {
  return runtimeFlags.devToolsEnabled ? <ReplayDevOnlyPanel /> : <Navigate replace to="/reports" />;
}
```

Reports must render conclusion first:

```tsx
<ProductPage family="report-insight" heading={report.title}>
  <ReportInsightLayout
    conclusion={<ReportConclusion report={report} />}
    signals={<ReportSignals signals={report.signals} />}
    actions={<RecommendedActions actions={report.recommendedActions} />}
  />
</ProductPage>
```

Create `ReportConclusion`, `ReportSignals`, and `RecommendedActions` as local helpers in `reports-routes.tsx` or `report-view-model.ts` before using them. These helpers must render the existing report view-model data with conclusion first, signals second, recommended actions third.

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm vitest run tests/web/executions-routes.test.tsx tests/web/board-reports-release-readiness.test.tsx tests/web/product-grade-first-viewport.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/spec-plan apps/web/src/features/executions apps/web/src/features/releases apps/web/src/features/reports \
  tests/web/executions-routes.test.tsx tests/web/board-reports-release-readiness.test.tsx tests/web/product-grade-first-viewport.test.tsx
git commit -m "feat: rebuild delivery and intelligence surfaces"
```

---

## Task 8: Visual Geometry Gates And Screenshot Report Closure

**Files:**
- Modify: `tests/e2e/helpers/capture-route-screenshots.ts`
- Modify: `tests/e2e/ai-native-project-management-visual.e2e.test.ts`
- Modify: `tests/e2e/web-product-routes.e2e.test.ts`
- Create or update: `docs/superpowers/reports/product-architecture-visual-rebuild-review.md`

- [ ] **Step 1: Write failing geometry gate helper tests**

Add helper logic in `tests/e2e/helpers/capture-route-screenshots.ts`:

```ts
const tableListFamilies = new Set<ProductPageFamily>([
  'inbox',
  'source-database',
  'planning-table',
  'delivery-board',
  'document-governance',
  'execution-supervision',
  'release-readiness',
  'report-insight',
]);

const documentFamilies = new Set<ProductPageFamily>([
  'source-document',
  'document-review',
]);

export async function assertPrimaryWorkSurfaceGeometry(page: Page, route: VisualRoute, width: number) {
  const primary = page.locator('[data-primary-work-surface]');
  await expectPage(primary).toHaveCount(1);
  const box = await primary.boundingBox();
  if (box === null) throw new Error(`${route.path} missing primary work surface geometry`);

  const viewport = page.viewportSize();
  if (viewport === null) throw new Error(`${route.path} has no viewport`);
  const contentViewportArea = viewport.width * viewport.height;
  const primaryArea = box.width * box.height;

  expect(box.y, `${route.path} primary work surface starts too low at ${width}px`).toBeLessThanOrEqual(220);
  if (width >= 1024 && route.family !== undefined && tableListFamilies.has(route.family)) {
    expect(primaryArea / contentViewportArea, `${route.path} table/list primary surface is too small at ${width}px`).toBeGreaterThanOrEqual(0.45);
  }
  if (width >= 1024 && route.family !== undefined && documentFamilies.has(route.family)) {
    expect(primaryArea / contentViewportArea, `${route.path} document primary surface is too small at ${width}px`).toBeGreaterThanOrEqual(0.5);
  }

  const headerBox = await page.locator('main > header').first().boundingBox();
  if (headerBox !== null && width >= 1024) {
    expect(headerBox.height, `${route.path} page header is too tall`).toBeLessThanOrEqual(96);
  }

  for (const banner of await page.locator('[data-state-banner], [data-readiness-banner], [data-empty-workflow-banner]').all()) {
    const bannerBox = await banner.boundingBox();
    if (bannerBox !== null && width >= 1024) {
      expect(bannerBox.height, `${route.path} routine banner is too tall`).toBeLessThanOrEqual(72);
    }
  }

  for (const toolbar of await page.locator('[data-database-toolbar], [data-filter-toolbar], [data-review-toolbar]').all()) {
    const toolbarBox = await toolbar.boundingBox();
    if (toolbarBox !== null && width >= 1024) {
      expect(toolbarBox.height, `${route.path} filter toolbar wraps into a panel`).toBeLessThanOrEqual(56);
    }
  }

  if (width === 375) {
    const explanatoryCopy = await page.locator('[data-explanatory-copy], [data-secondary-summary]').first().boundingBox();
    if (explanatoryCopy !== null) {
      expect(box.y, `${route.path} primary surface appears after explanatory copy on mobile`).toBeLessThan(explanatoryCopy.y);
    }
  }

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(horizontalOverflow, `${route.path} creates horizontal page scroll at ${width}px`).toBeLessThanOrEqual(1);

  expect(await page.locator('[data-first-viewport]').count()).toBe(0);
  expect(await page.locator('[data-priority-summary]').count()).toBe(0);
  expect(await page.locator('[data-action-strip]').count()).toBe(0);
}
```

Also assert seeded desktop inspector behavior in the same helper: when a route has a selected seeded row and `width >= 1024`, `[data-inspector-panel], [data-row-preview]` must be visible; when `width === 375`, the inspector must move below content or into a drawer without changing the primary surface order.

- [ ] **Step 2: Run e2e visual test to verify it fails where routes are not migrated**

Run: `pnpm vitest run tests/e2e/ai-native-project-management-visual.e2e.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL before all route migrations are complete; PASS after Tasks 4-7.

- [ ] **Step 3: Add screenshot report artifact generation**

In `capture-route-screenshots.ts`, collect:

```ts
export interface ScreenshotReviewRecord {
  route: string;
  viewport: number;
  seededProjectId: string;
  selectedObjectId?: string;
  screenshotPath: string;
  landmarks: Record<string, boolean>;
  geometry: {
    primaryWorkSurfaceY: number;
    primaryWorkSurfaceArea: number;
    viewportArea: number;
    pageHeaderHeight?: number;
    tallestRoutineBannerHeight?: number;
    tallestToolbarHeight?: number;
    horizontalOverflowPx: number;
  };
  visibleSeededLabels: string[];
  decision: 'pass' | 'needs_fix' | 'blocked';
  blockerNotes: string[];
}

export interface ManualReviewChecklistRecord {
  item: string;
  decision: 'pass' | 'needs_fix' | 'blocked';
  notes: string;
}

export interface ProductArchitectureScreenshotReviewReport {
  records: ScreenshotReviewRecord[];
  manualReviewChecklist: ManualReviewChecklistRecord[];
}
```

Write a Markdown report to `docs/superpowers/reports/product-architecture-visual-rebuild-review.md`:

```md
# Product Architecture Visual Rebuild Review

## Seed

- Seed: project-product-architecture-demo

## Route Decisions

| Route | Viewport | Decision | Notes |
| --- | ---: | --- | --- |

## Manual Review Checklist

- Cockpit operational command center: pass | needs_fix | blocked
- My Work role inbox: pass | needs_fix | blocked
- Typed source object database/document surfaces: pass | needs_fix | blocked
- Development Plans planning table: pass | needs_fix | blocked
- Plan Item governed AI-native gate flow: pass | needs_fix | blocked
- Spec and Execution Plan document review surfaces: pass | needs_fix | blocked
- Reports intelligence surfaces: pass | needs_fix | blocked
- Removed `WorkspacePage` visual assumptions: <summary>
- Remaining empty states and rationale: <summary>
```

- [ ] **Step 4: Assert report is complete**

In `tests/e2e/ai-native-project-management-visual.e2e.test.ts`, assert every screenshot route and viewport has a pass record:

```ts
expect(report.records.every((record) => record.decision === 'pass')).toBe(true);
expect(new Set(report.records.map((record) => record.route))).toEqual(new Set(requiredScreenshotRoutes.map((route) => route.concretePath)));
expect(requiredScreenshotRoutes.map((route) => route.concretePath)).toEqual([
  '/',
  '/cockpit',
  '/my-work',
  '/initiatives',
  '/initiatives/new',
  '/initiatives/init-ai-native-rollout',
  '/initiatives/init-ai-native-rollout/evidence',
  '/requirements',
  '/requirements/new',
  '/requirements/req-plan-item-governance',
  '/requirements/req-plan-item-governance/evidence',
  '/bugs',
  '/bugs/new',
  '/bugs/bug-execution-review-context',
  '/bugs/bug-execution-review-context/evidence',
  '/tech-debt',
  '/tech-debt/new',
  '/tech-debt/td-retire-workspace-page-template',
  '/tech-debt/td-retire-workspace-page-template/evidence',
  '/development-plans',
  '/development-plans/new',
  '/development-plans/dp-product-architecture-visual-rebuild',
  '/development-plans/dp-product-architecture-visual-rebuild/items/dpi-cockpit-command-center',
  '/development-plans/dp-product-architecture-visual-rebuild/items/dpi-development-plan-table-inspector/brainstorming',
  '/development-plans/dp-product-architecture-visual-rebuild/items/dpi-cockpit-command-center/spec',
  '/development-plans/dp-product-architecture-visual-rebuild/items/dpi-requirements-database-view/execution-plan',
  '/development-plans/dp-product-architecture-visual-rebuild/items/dpi-demo-seed-visual-review/execution',
  '/development-plans/dp-product-architecture-visual-rebuild/items/dpi-cockpit-command-center/review',
  '/development-plans/dp-product-architecture-visual-rebuild/items/dpi-requirements-database-view/qa',
  '/specs-plans',
  '/executions',
  '/executions/exec-demo-seed-visual-review',
  '/board',
  '/releases',
  '/releases/rel-product-architecture-preview',
  '/releases/rel-product-architecture-preview/evidence',
  '/reports',
  '/reports/delivery',
  '/reports/quality',
  '/reports/release-readiness',
  '/reports/observation',
]);
expect(
  new Set(report.records.map((record) => `${record.route} @ ${record.viewport}`)),
).toEqual(
  new Set(requiredScreenshotRoutes.flatMap((route) => route.viewports.map((viewport) => `${route.concretePath} @ ${viewport}`))),
);
expect(report.records).toHaveLength(requiredScreenshotRoutes.reduce((sum, route) => sum + route.viewports.length, 0));
expect(report.records.every((record) => record.geometry.horizontalOverflowPx <= 1)).toBe(true);
expect(report.records.filter((record) => record.viewport >= 1024).every((record) => (record.geometry.pageHeaderHeight ?? 0) <= 96)).toBe(true);
expect(report.manualReviewChecklist.every((item) => item.decision === 'pass')).toBe(true);
```

- [ ] **Step 5: Run visual tests**

Run:

```bash
pnpm vitest run tests/e2e/ai-native-project-management-visual.e2e.test.ts tests/e2e/web-product-routes.e2e.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/helpers/capture-route-screenshots.ts \
  tests/e2e/ai-native-project-management-visual.e2e.test.ts \
  tests/e2e/web-product-routes.e2e.test.ts \
  docs/superpowers/reports/product-architecture-visual-rebuild-review.md
git commit -m "test: close product architecture visual review"
```

---

## Task 9: No-Baggage, Accessibility, Responsive, And Full Verification

**Files:**
- Modify if needed: `tests/web/no-legacy-web-ui.test.ts`
- Modify if needed: `tests/web/a11y-gates.test.tsx`
- Modify if needed: `tests/web/responsive-layout.test.tsx`
- Modify if needed: `tests/naming/delivery-naming.test.ts`
- Modify if needed: `tests/contracts/project-management-contracts.test.ts`
- Modify if needed: `tests/contracts/product-actions.test.ts`
- Modify if needed: `tests/api/project-management-query.test.ts`
- Modify if needed: `tests/api/executions.test.ts`
- Delete legacy layout files after every import is removed:
  - `apps/web/src/shared/layout/action-strip/action-strip.tsx`
  - `apps/web/src/shared/layout/priority-summary/priority-summary.tsx`
  - `apps/web/src/shared/layout/object-workspace/object-workspace.tsx`
  - `apps/web/src/shared/layout/queue-workspace/queue-workspace.tsx`
  - `apps/web/src/shared/layout/planning-table-workspace/planning-table-workspace.tsx`
  - `apps/web/src/shared/layout/gate-workspace/gate-workspace.tsx`
  - `apps/web/src/shared/layout/workspace-page/workspace-page.tsx`
- Modify: `apps/web/src/shared/layout/index.ts`
- No other production files unless a verification failure proves a gap.

- [ ] **Step 1: Prove and delete old generic layout baggage**

Run:

```bash
rg -n "WorkspacePage|ObjectWorkspace|QueueWorkspace|PlanningTableWorkspace|GateWorkspace|PrioritySummary|ActionStrip|data-first-viewport|data-priority-summary|data-action-strip" apps/web/src tests/web
```

Expected before deletion: no `apps/web/src/features/**` imports or product-route usage remain. Any remaining test references must be negative assertions only. If production imports remain, migrate those call sites to `ProductPage`, a page-family layout, or a lower-level primitive before continuing.

Then delete the old generic layout files and remove their exports from `apps/web/src/shared/layout/index.ts`:

```bash
git rm apps/web/src/shared/layout/action-strip/action-strip.tsx \
  apps/web/src/shared/layout/priority-summary/priority-summary.tsx \
  apps/web/src/shared/layout/object-workspace/object-workspace.tsx \
  apps/web/src/shared/layout/queue-workspace/queue-workspace.tsx \
  apps/web/src/shared/layout/planning-table-workspace/planning-table-workspace.tsx \
  apps/web/src/shared/layout/gate-workspace/gate-workspace.tsx \
  apps/web/src/shared/layout/workspace-page/workspace-page.tsx
```

This deletion is mandatory for the no-baggage requirement. Do not keep a deprecated export, compatibility alias, or old/new layout switch.

- [ ] **Step 2: Run no-baggage tests**

Run:

```bash
pnpm vitest run tests/naming/delivery-naming.test.ts tests/web/no-legacy-web-ui.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS with no product-facing `Work Item Owner`, `owner_actor_id`, `/tasks`, standalone `/plans`, standalone `/specs`, package/run/review raw browsers, or replay product route.

- [ ] **Step 3: Run typed-ref public boundary contract tests**

Run:

```bash
pnpm vitest run \
  tests/contracts/project-management-contracts.test.ts \
  tests/contracts/product-actions.test.ts \
  tests/api/project-management-query.test.ts \
  tests/api/executions.test.ts \
  --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS with public DTO/query/action/evidence projections using typed source refs, rejecting generic `work_item` refs or owner baggage at product boundaries, and proving execution start links Plan Item, approved Spec revision, approved Execution Plan revision, and an internal Execution Package before a worker run starts.

- [ ] **Step 4: Run accessibility and responsive tests**

Run:

```bash
pnpm vitest run tests/web/a11y-gates.test.tsx tests/web/ai-native-accessibility.test.tsx tests/web/responsive-layout.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS with visible labels, focus order, no non-color-only states, no horizontal page scroll, and stable mobile/tablet layouts.

- [ ] **Step 5: Run focused product route suite**

Run:

```bash
pnpm vitest run \
  tests/web/product-grade-route-contract.test.tsx \
  tests/web/product-grade-layout-primitives.test.tsx \
  tests/web/product-grade-first-viewport.test.tsx \
  tests/web/project-management-routes.test.tsx \
  tests/web/development-plan-routes.test.tsx \
  tests/web/code-review-qa-handoff-routes.test.tsx \
  tests/web/executions-routes.test.tsx \
  tests/web/board-reports-release-readiness.test.tsx \
  --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 6: Run build or typecheck**

First inspect available package scripts:

```bash
pnpm --filter @forgeloop/web run
```

Then run the best available Web verification, usually:

```bash
pnpm --filter @forgeloop/web build
```

Expected: exit 0.

- [ ] **Step 7: Run repo-level naming and diff checks**

Run:

```bash
git diff --check
rg -n "WorkspacePage|ObjectWorkspace|QueueWorkspace|PlanningTableWorkspace|GateWorkspace|PrioritySummary|ActionStrip|data-first-viewport|data-priority-summary|data-action-strip" apps/web/src/shared apps/web/src/features
pnpm vitest run tests/naming/delivery-naming.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: `git diff --check` passes; the `rg` command returns no production hits; naming tests pass.

- [ ] **Step 8: Commit verification-only fixes if any**

If fixes were required:

```bash
git add apps/web/src/shared/layout apps/web/src/shared/layout/index.ts tests/web/no-legacy-web-ui.test.ts tests/web/a11y-gates.test.tsx tests/web/responsive-layout.test.tsx tests/naming/delivery-naming.test.ts tests/contracts/project-management-contracts.test.ts tests/contracts/product-actions.test.ts tests/api/project-management-query.test.ts tests/api/executions.test.ts
git commit -m "test: verify product architecture visual rebuild"
```

If no fixes were required, do not create an empty commit.

---

## Final Verification Before PR

Run these commands after all tasks:

```bash
git status --short
git diff --check
rg -n "WorkspacePage|ObjectWorkspace|QueueWorkspace|PlanningTableWorkspace|GateWorkspace|PrioritySummary|ActionStrip|data-first-viewport|data-priority-summary|data-action-strip" apps/web/src/shared apps/web/src/features
pnpm vitest run tests/naming/delivery-naming.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm vitest run tests/contracts/project-management-contracts.test.ts tests/contracts/product-actions.test.ts tests/api/project-management-query.test.ts tests/api/executions.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm vitest run tests/web/product-grade-route-contract.test.tsx tests/web/product-grade-layout-primitives.test.tsx tests/web/product-grade-first-viewport.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
pnpm vitest run tests/web/project-management-routes.test.tsx tests/web/development-plan-routes.test.tsx tests/web/code-review-qa-handoff-routes.test.tsx tests/web/executions-routes.test.tsx tests/web/board-reports-release-readiness.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
pnpm vitest run tests/e2e/ai-native-project-management-visual.e2e.test.ts tests/e2e/web-product-routes.e2e.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/web build
```

Expected:

- `git status --short` shows only intended files before final commit and is clean after commit.
- No whitespace errors.
- Old generic layout names and first-viewport markers have no production hits.
- All focused tests pass.
- Web build exits 0.
- `docs/superpowers/reports/product-architecture-visual-rebuild-review.md` exists and records pass decisions for every seeded screenshot route and viewport.

## Execution Notes

- Do not implement Evolution Loop, learning-rule authoring, structured executable Task extraction, or raw runtime object browsers.
- Do not preserve old `WorkspacePage` wrappers for product-route first viewports.
- Keep backend/API changes limited to read projection and seed exposure gaps. Do not rewrite core lifecycle semantics.
- Prefer subagent-driven implementation with disjoint ownership:
  - Contract/seed agent: Tasks 1-2.
  - Layout primitive agent: Task 3.
  - Entry/source object agent: Tasks 4-5.
  - Planning/gate agent: Task 6.
  - Delivery/report/visual closure agent: Tasks 7-8.
- Review after each task before moving to the next task.
