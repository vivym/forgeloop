# Web Product UI Architecture Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current monolithic Web workbench with a product-grade React Router Framework Mode app that covers the full delivery loop without legacy UI baggage.

**Architecture:** Add the missing product read models first, then migrate the Web app to React Router Framework Mode with shared providers, design tokens, route modules, TanStack Query, and focused feature modules. Build each product surface as a route-backed vertical slice, delete the old `App.tsx` workbench shape, and finish with visual, accessibility, and no-legacy verification.

**Tech Stack:** React 19, React Router Framework Mode, Vite, Tailwind CSS, shadcn/Radix primitives, lucide-react, TanStack Query, TanStack Table, React Hook Form, Zod, Vitest, Playwright.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-05-18-web-product-ui-architecture-redesign-design.md`
- PRD: `docs/PRD_v1.md`
- Current Web app: `apps/web/src/App.tsx`
- Current Web styles: `apps/web/src/styles.css`
- Current Web API client: `apps/web/src/api/commands.ts`, `apps/web/src/api/query.ts`, `apps/web/src/api/types.ts`
- Current query service: `apps/control-plane-api/src/modules/query/query.controller.ts`, `apps/control-plane-api/src/modules/query/query.service.ts`
- Current repository contract: `packages/db/src/repositories/delivery-repository.ts`

## Scope Check

This is one product slice: replace the Web product architecture and UI. It touches backend/query read models only where the approved spec needs truthful route data. It does not redesign the backend object model, add Evolution Loop/retrospective learning, add dark-mode switching, or preserve old UI compatibility.

## File Structure And Ownership

### Backend / Contracts

- Create `packages/contracts/src/web-product-query.ts`
  - Zod schemas and types for Web product query pages: pipeline, spec list, plan list, package list, run list, review list, Spec/Plan history.
- Modify `packages/contracts/src/index.ts`
  - Export the new Web product query contracts.
- Modify `packages/db/src/repositories/delivery-repository.ts`
  - Add repository read methods needed for global product lists.
- Modify `packages/db/src/repositories/in-memory-delivery-repository.ts`
  - Implement the new read methods for tests.
- Modify `packages/db/src/repositories/drizzle-delivery-repository.ts`
  - Implement the new read methods for durable mode.
- Create `packages/db/src/queries/web-product-queries.ts`
  - Pure query builders that compose repository data into UI read models.
- Modify `packages/db/src/index.ts`
  - Export `web-product-queries`.
- Modify `apps/control-plane-api/src/modules/query/query.controller.ts`
  - Add `/query/pipeline`, `/query/specs`, `/query/plans`, `/query/execution-packages`, `/query/runs`, `/query/review-packets`, `/query/replay/spec/:id`, `/query/replay/plan/:id`.
- Modify `apps/control-plane-api/src/modules/query/query.service.ts`
  - Validate query params, call DB query builders, serialize public run metadata.
- Test `tests/api/query-module.test.ts`
  - Add coverage for all new query endpoints and degraded markers.

### Web Tooling / Framework

- Modify `apps/web/package.json`
  - Add React Router, Tailwind, shadcn/Radix, TanStack Query/Table, React Hook Form, Zod resolver, lucide-react, class utility, and test dependencies.
  - Replace scripts with React Router CLI path.
- Create `apps/web/react-router.config.ts`
  - Set `appDirectory: "src/app"`, `buildDirectory: "dist/react-router"`, `ssr: false`.
- Modify `apps/web/vite.config.ts`
  - Use `reactRouter()` from `@react-router/dev/vite`.
- Modify `apps/web/tsconfig.json`
  - Include `.react-router/types/**/*`; set `rootDirs`.
- Modify `.gitignore`
  - Ignore `.react-router/`.
- Delete or replace `apps/web/src/main.tsx`
  - Remove direct `createRoot(<App />)` path.
- Delete `apps/web/src/App.tsx` by the final cleanup task
  - It must not own product UI or command state.

### Web App Structure

- Create `apps/web/src/app/root.tsx`
  - Framework root route, providers, stylesheet links, error boundary.
- Create `apps/web/src/app/providers.tsx`
  - QueryClient, actor/project context, runtime flags, toast provider.
- Create `apps/web/src/app/routes.ts`
  - Explicit route config if file routes are not enough.
- Create route modules under `apps/web/src/app/routes/**`
  - Product page composition only; no API business logic.
- Create `apps/web/src/shared/api/**`
  - API context, command client, query client, query keys, query hooks, mutation hooks.
- Create `apps/web/src/shared/design-system/**`
  - Tokens, CSS variables, Tailwind preset, component guidance.
- Create `apps/web/src/shared/ui/**`
  - Business-agnostic UI primitives.
- Create `apps/web/src/shared/layout/**`
  - AppShell, Sidebar, Topbar, DetailLayout, ActionRail, Section.
- Create feature modules under `apps/web/src/features/**`
  - Domain view models, forms, route body components, feature tests.

### Tests

- Create `tests/web/router-test-utils.tsx`
  - Router-aware test helper with QueryClient and context providers.
- Replace `tests/web/release-owner-surface.test.tsx`
  - Stop server-rendering old `App`.
- Add/modify route and feature tests under `tests/web/**`.
- Modify `tests/e2e/run-console.e2e.test.ts`
  - Boot Web through the React Router dev/build path, not raw Vite config.
- Create `tests/e2e/web-product-routes.e2e.test.ts`
  - Route, responsive, Dev Tools, visual smoke coverage.
- Create `tests/web/no-legacy-web-ui.test.ts`
  - No `/legacy`, old classes, old `App` imports, or manual ID controls on product routes.

## Implementation Rules

- Use @superpowers:test-driven-development for each task: write failing tests first, run them, implement, rerun.
- Use @superpowers:verification-before-completion before every commit.
- Use @superpowers:requesting-code-review after each task if implementing with subagents.
- Do not keep a `/legacy` route, feature flag to old UI, old `App` fallback, or active/dead `.panel` / `.workbench-grid` styling.
- Do not productize raw manual ID loaders. Put raw loaders and direct low-level link/unlink in `/dev-tools` only.
- Product pages use route params, search params, and TanStack Query. Avoid app-root reload orchestration.
- Every task ends with a focused commit.

---

### Task 1: Add Product Query Contracts And API Read Models

**Files:**
- Create: `packages/contracts/src/web-product-query.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Create: `packages/db/src/queries/web-product-queries.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.controller.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.service.ts`
- Test: `tests/api/query-module.test.ts`

- [ ] **Step 1: Write failing contract tests for new query endpoint shapes**

Add tests in `tests/api/query-module.test.ts`:

```ts
it('serves the product pipeline read model with all PRD stages', async () => {
  const response = await request(app.getHttpServer())
    .get('/query/pipeline')
    .query({ project_id: projectId })
    .expect(200);

  expect(response.body.stages.map((stage: { id: string }) => stage.id)).toEqual([
    'intake',
    'spec_plan',
    'execution',
    'review',
    'integration_validation',
    'test_acceptance',
    'release',
    'observation',
  ]);
  expect(response.body.degraded_sources).toEqual(expect.any(Array));
});

it('serves product list read models for specs, plans, packages, runs, and reviews', async () => {
  await request(app.getHttpServer()).get('/query/specs').query({ project_id: projectId }).expect(200);
  await request(app.getHttpServer()).get('/query/plans').query({ project_id: projectId }).expect(200);
  await request(app.getHttpServer()).get('/query/execution-packages').query({ project_id: projectId }).expect(200);
  await request(app.getHttpServer()).get('/query/runs').query({ project_id: projectId }).expect(200);
  await request(app.getHttpServer()).get('/query/review-packets').query({ project_id: projectId }).expect(200);
});

it('serves Spec and Plan history through replay-compatible endpoints', async () => {
  await request(app.getHttpServer()).get(`/query/replay/spec/${specId}`).expect(200);
  await request(app.getHttpServer()).get(`/query/replay/plan/${planId}`).expect(200);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/api/query-module.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL with 404s or missing routes for the new `/query/*` endpoints.

- [ ] **Step 3: Define Web product query contracts**

Create `packages/contracts/src/web-product-query.ts` with this shape:

```ts
import { z } from 'zod';

const isoDateTimeSchema = z.string().datetime();

export const productObjectRefSchema = z
  .object({
    type: z.enum(['work_item', 'spec', 'plan', 'execution_package', 'run_session', 'review_packet', 'release']),
    id: z.string().min(1),
    title: z.string().min(1).optional(),
  })
  .strict();

export const productListQuerySchema = z
  .object({
    project_id: z.string().min(1),
    actor_id: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    phase: z.string().min(1).optional(),
    gate_state: z.string().min(1).optional(),
    resolution: z.string().min(1).optional(),
    risk: z.string().min(1).optional(),
    owner_actor_id: z.string().min(1).optional(),
    reviewer_actor_id: z.string().min(1).optional(),
    qa_owner_actor_id: z.string().min(1).optional(),
    release_owner_actor_id: z.string().min(1).optional(),
    work_item_id: z.string().min(1).optional(),
    spec_id: z.string().min(1).optional(),
    plan_id: z.string().min(1).optional(),
    spec_revision_id: z.string().min(1).optional(),
    plan_revision_id: z.string().min(1).optional(),
    execution_package_id: z.string().min(1).optional(),
    run_session_id: z.string().min(1).optional(),
    review_packet_id: z.string().min(1).optional(),
    release_id: z.string().min(1).optional(),
    surface_type: z.string().min(1).optional(),
    executor_type: z.string().min(1).optional(),
    decision: z.string().min(1).optional(),
    blocked: z.coerce.boolean().optional(),
    stale: z.coerce.boolean().optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(50),
  })
  .strict();
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const productListItemSchema = z
  .object({
    id: z.string().min(1),
    object: productObjectRefSchema,
    title: z.string().min(1),
    status: z.string().min(1).optional(),
    phase: z.string().min(1).optional(),
    gate_state: z.string().min(1).optional(),
    resolution: z.string().min(1).optional(),
    risk: z.string().min(1).optional(),
    owner_actor_id: z.string().min(1).optional(),
    reviewer_actor_id: z.string().min(1).optional(),
    qa_owner_actor_id: z.string().min(1).optional(),
    release_owner_actor_id: z.string().min(1).optional(),
    parent: productObjectRefSchema.optional(),
    related: z.array(productObjectRefSchema).default([]),
    revision_state: z
      .object({
        current_revision_id: z.string().min(1).optional(),
        approved_revision_id: z.string().min(1).optional(),
        revision_number: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    package_state: z
      .object({
        work_item_id: z.string().min(1),
        spec_revision_id: z.string().min(1).optional(),
        plan_revision_id: z.string().min(1).optional(),
        surface_type: z.string().min(1).optional(),
        blocked_reason: z.string().min(1).optional(),
        last_run_session_id: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    run_state: z
      .object({
        execution_package_id: z.string().min(1),
        executor_type: z.string().min(1).optional(),
        started_at: isoDateTimeSchema.optional(),
        finished_at: isoDateTimeSchema.optional(),
      })
      .strict()
      .optional(),
    review_state: z
      .object({
        execution_package_id: z.string().min(1),
        run_session_id: z.string().min(1),
        decision: z.string().min(1).optional(),
        changed_file_count: z.number().int().nonnegative().default(0),
      })
      .strict()
      .optional(),
    release_state: z
      .object({
        work_item_count: z.number().int().nonnegative().default(0),
        execution_package_count: z.number().int().nonnegative().default(0),
        rollout_complete: z.boolean().default(false),
        rollback_complete: z.boolean().default(false),
        observation_complete: z.boolean().default(false),
      })
      .strict()
      .optional(),
    counts: z.record(z.string(), z.number()).default({}),
    updated_at: isoDateTimeSchema,
  })
  .strict();

export const productListResponseSchema = z
  .object({
    items: z.array(productListItemSchema),
    next_cursor: z.string().min(1).optional(),
    degraded_sources: z.array(z.string()).default([]),
  })
  .strict();
export type ProductListResponse = z.infer<typeof productListResponseSchema>;

export const pipelineStageIdSchema = z.enum([
  'intake',
  'spec_plan',
  'execution',
  'review',
  'integration_validation',
  'test_acceptance',
  'release',
  'observation',
]);

export const pipelineStageSchema = z
  .object({
    id: pipelineStageIdSchema,
    label: z.string().min(1),
    item_count: z.number().int().nonnegative(),
    blocked_count: z.number().int().nonnegative(),
    high_risk_count: z.number().int().nonnegative(),
    stale_count: z.number().int().nonnegative(),
    representative_items: z.array(productListItemSchema).default([]),
    degraded: z.boolean().default(false),
  })
  .strict();

export const pipelineResponseSchema = z
  .object({
    stages: z.array(pipelineStageSchema),
    degraded_sources: z.array(z.string()).default([]),
  })
  .strict();
export type PipelineResponse = z.infer<typeof pipelineResponseSchema>;
```

Export it from `packages/contracts/src/index.ts`:

```ts
export * from './web-product-query.js';
```

- [ ] **Step 4: Add repository global list methods**

Extend `DeliveryRepository`:

```ts
listSpecs(projectId?: string): Promise<Spec[]>;
listPlans(projectId?: string): Promise<Plan[]>;
listExecutionPackages(projectId?: string): Promise<ExecutionPackage[]>;
listRunSessions(projectId?: string): Promise<RunSession[]>;
listReviewPackets(projectId?: string): Promise<ReviewPacket[]>;
```

Implement in `in-memory-delivery-repository.ts` by filtering in-memory maps. Implement in `drizzle-delivery-repository.ts` with `listWhere` filters where the table has `project_id`. For Specs and Plans, filter by joining or looking up their parent Work Items because those rows are scoped by `work_item_id`, not a direct project column. For run sessions and review packets, join through execution packages in memory after listing packages if there is no direct `project_id` column.

- [ ] **Step 5: Implement pure query builders**

Create `packages/db/src/queries/web-product-queries.ts`:

```ts
import {
  pipelineResponseSchema,
  productListResponseSchema,
  type PipelineResponse,
  type ProductListQuery,
  type ProductListResponse,
} from '@forgeloop/contracts';
import type { DeliveryRepository } from '../repositories/delivery-repository';

const page = <T extends { id: string }>(items: T[], query: ProductListQuery): { items: T[]; next_cursor?: string } => {
  const start = query.cursor === undefined ? 0 : Math.max(0, items.findIndex((item) => item.id === query.cursor) + 1);
  const sliced = items.slice(start, start + query.limit);
  return {
    items: sliced,
    ...(items[start + query.limit] !== undefined && sliced.length > 0 ? { next_cursor: sliced[sliced.length - 1]!.id } : {}),
  };
};

export async function getProductPipeline(repository: DeliveryRepository, query: ProductListQuery): Promise<PipelineResponse> {
  const [workItems, packages, reviews, releases] = await Promise.all([
    repository.listWorkItems(query.project_id),
    repository.listExecutionPackages(query.project_id),
    repository.listReviewPackets(query.project_id),
    repository.listReleases(query.project_id),
  ]);

  return pipelineResponseSchema.parse({
    stages: [
      { id: 'intake', label: 'Intake', item_count: workItems.filter((w) => w.phase === 'draft' || w.phase === 'triage').length },
      { id: 'spec_plan', label: 'Spec / Plan', item_count: workItems.filter((w) => w.phase === 'spec' || w.phase === 'plan').length },
      { id: 'execution', label: 'Execution', item_count: packages.filter((p) => ['ready', 'queued', 'execution'].includes(p.phase)).length },
      { id: 'review', label: 'Review', item_count: reviews.filter((r) => r.status !== 'completed').length },
      { id: 'integration_validation', label: 'Integration / Cross-end Validation', item_count: packages.filter((p) => p.phase === 'integration').length },
      { id: 'test_acceptance', label: 'Test / Acceptance', item_count: packages.filter((p) => p.phase === 'test_gate').length },
      { id: 'release', label: 'Release', item_count: releases.filter((r) => r.phase !== 'observing' && r.phase !== 'closed').length },
      { id: 'observation', label: 'Observation', item_count: releases.filter((r) => r.phase === 'observing').length },
    ].map((stage) => ({ blocked_count: 0, high_risk_count: 0, stale_count: 0, representative_items: [], degraded: true, ...stage })),
    degraded_sources: ['blocker/high-risk/stale aggregation is approximate until richer read model fields exist'],
  });
}

export async function listProductSpecs(repository: DeliveryRepository, query: ProductListQuery): Promise<ProductListResponse> {
  const items = (await repository.listSpecs(query.project_id)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const paged = page(items, query);
  return productListResponseSchema.parse({
    items: paged.items.map((spec) => ({
      id: spec.id,
      object: { type: 'spec', id: spec.id },
      title: `Spec ${spec.id}`,
      status: spec.status,
      gate_state: spec.gate_state,
      parent: { type: 'work_item', id: spec.work_item_id },
      counts: {},
      updated_at: spec.updated_at,
    })),
    next_cursor: paged.next_cursor,
    degraded_sources: [],
  });
}
```

Use the same list response shape for plans, packages, runs, reviews, and releases, filling the typed `revision_state`, `package_state`, `run_state`, `review_state`, and `release_state` objects where the domain already has the data. Keep the implementation small; do not invent fields the domain does not have. If a required UI filter has no backend field yet, return a degraded marker and leave the unsupported filter inactive in the UI rather than silently filtering wrong data.

- [ ] **Step 6: Wire query controller/service endpoints**

Add methods to `QueryController`:

```ts
@Get('pipeline')
getPipeline(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
  return this.service.getPipeline(query);
}

@Get('specs')
listSpecs(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
  return this.service.listSpecs(query);
}
```

Repeat for plans, execution packages, runs, and review packets. Add `getSpecReplay` and `getPlanReplay` as explicit `@Get('replay/spec/:specId')` and `@Get('replay/plan/:planId')` routes that call a service method deriving history from object events/status history plus parent Work Item replay.

- [ ] **Step 7: Run query tests**

Run: `pnpm vitest run tests/api/query-module.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 8: Run related API regression tests**

Run:

```bash
pnpm vitest run tests/api/query-module.test.ts tests/api/role-workbenches.test.ts tests/api/release-module.test.ts tests/api/test-acceptance-gate.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/contracts/src/index.ts packages/contracts/src/web-product-query.ts packages/db/src apps/control-plane-api/src/modules/query tests/api/query-module.test.ts
git commit -m "feat: add web product query read models"
```

---

### Task 2: Migrate Web Tooling To React Router Framework Mode

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/react-router.config.ts`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/tsconfig.json`
- Modify: `.gitignore`
- Create: `apps/web/src/app/root.tsx`
- Create: `apps/web/src/app/providers.tsx`
- Create: `apps/web/src/app/routes.ts`
- Create: `apps/web/src/app/routes/_layout.tsx`
- Create: `apps/web/src/app/routes/workbench/index.tsx`
- Create: `apps/web/src/shared/design-system/theme/css-variables.css`
- Test: `tests/web/router-test-utils.tsx`
- Test: `tests/web/app-shell-routing.test.tsx`

- [ ] **Step 1: Write failing router smoke test**

Create `tests/web/app-shell-routing.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { renderRoute } from './router-test-utils';

describe('React Router product shell', () => {
  it('renders Workbench through route modules, not the legacy App', async () => {
    const screen = await renderRoute('/workbench');
    expect(screen.getByRole('heading', { name: /workbench/i })).toBeTruthy();
    expect(screen.queryByText('Load role queue')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/web/app-shell-routing.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because `router-test-utils.tsx` and route modules do not exist.

- [ ] **Step 3: Update Web dependencies and scripts**

Install Web runtime dependencies:

```bash
pnpm --filter @forgeloop/web add \
  react-router @react-router/node \
  @tanstack/react-query @tanstack/react-table \
  react-hook-form @hookform/resolvers \
  @radix-ui/react-checkbox @radix-ui/react-dialog @radix-ui/react-dropdown-menu \
  @radix-ui/react-label @radix-ui/react-select @radix-ui/react-slot \
  @radix-ui/react-tabs @radix-ui/react-toast \
  lucide-react class-variance-authority clsx tailwind-merge
```

Install Web dev dependencies:

```bash
pnpm --filter @forgeloop/web add -D \
  @react-router/dev @testing-library/dom @testing-library/react @testing-library/user-event \
  @tailwindcss/vite tailwindcss
```

Then modify `apps/web/package.json` scripts:

```json
{
  "scripts": {
    "build": "react-router typegen && tsc --noEmit && react-router build",
    "dev": "react-router dev",
    "typecheck": "react-router typegen && tsc --noEmit"
  }
}
```

Accept the exact versions resolved by `pnpm` into `pnpm-lock.yaml`. Keep `react-router`, `@react-router/node`, and `@react-router/dev` on the same major/minor if the resolver ever diverges.

- [ ] **Step 4: Add React Router config and Vite plugin**

Create `apps/web/react-router.config.ts`:

```ts
import type { Config } from '@react-router/dev/config';

export default {
  appDirectory: 'src/app',
  buildDirectory: 'dist/react-router',
  ssr: false,
} satisfies Config;
```

Modify `apps/web/vite.config.ts`:

```ts
import tailwindcss from '@tailwindcss/vite';
import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [reactRouter(), tailwindcss()],
});
```

- [ ] **Step 5: Wire route typegen tsconfig and gitignore**

Modify `apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.web.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDirs": [".", "./.react-router/types"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", ".react-router/types/**/*"]
}
```

Add to `.gitignore`:

```gitignore
.react-router/
```

- [ ] **Step 6: Add root route, providers, and placeholder workbench route**

Create the minimal stylesheet imported by `root.tsx` now; Task 3 will expand it into the full token set:

```css
@import "tailwindcss";

:root {
  color: #0f172a;
  background: #f6f8fb;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  margin: 0;
}
```

This is the canonical Tailwind entry for the Web app. Do not create a second global stylesheet; all global CSS flows through this file and the React Router root import.

Create `apps/web/src/app/root.tsx`:

```tsx
import type { LinksFunction } from 'react-router';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import { AppProviders } from './providers';
import '../shared/design-system/theme/css-variables.css';

export const links: LinksFunction = () => [];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  return (
    <AppProviders>
      <Outlet />
    </AppProviders>
  );
}
```

Create `apps/web/src/app/providers.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

Create `apps/web/src/app/routes/workbench/index.tsx`:

```tsx
export default function WorkbenchRoute() {
  return <h1>Workbench</h1>;
}
```

- [ ] **Step 7: Add router test utility**

Create `tests/web/router-test-utils.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

export async function renderRoute(_path: string, element?: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{element ?? <h1>Workbench</h1>}</QueryClientProvider>);
  return screen;
}
```

Replace this helper with React Router's route stub in Task 5 after route modules are real. This temporary helper exists only to make the Framework Mode migration testable early.

- [ ] **Step 8: Run install/typegen/build checks**

Run:

```bash
pnpm install
pnpm --filter @forgeloop/web typecheck
pnpm --filter @forgeloop/web build
pnpm vitest run tests/web/app-shell-routing.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add .gitignore pnpm-lock.yaml apps/web/package.json apps/web/react-router.config.ts apps/web/vite.config.ts apps/web/tsconfig.json apps/web/src/app apps/web/src/shared/design-system/theme/css-variables.css tests/web/router-test-utils.tsx tests/web/app-shell-routing.test.tsx
git commit -m "feat: migrate web to react router framework mode"
```

---

### Task 3: Build Design System, Shared UI, And Layout Primitives

**Files:**
- Create: `apps/web/src/shared/design-system/tokens/colors.ts`
- Create: `apps/web/src/shared/design-system/tokens/typography.ts`
- Create: `apps/web/src/shared/design-system/tokens/spacing.ts`
- Create: `apps/web/src/shared/design-system/tokens/radius.ts`
- Create: `apps/web/src/shared/design-system/tokens/shadows.ts`
- Create: `apps/web/src/shared/design-system/tokens/zIndex.ts`
- Create: `apps/web/src/shared/design-system/tokens/motion.ts`
- Create: `apps/web/src/shared/design-system/theme/css-variables.css`
- Create: `apps/web/src/shared/design-system/theme/tailwind-preset.ts`
- Create: `apps/web/src/shared/design-system/docs/component-guidelines.md`
- Create: `apps/web/src/shared/ui/**`
- Create: `apps/web/src/shared/layout/**`
- Test: `tests/web/design-system.test.tsx`

- [ ] **Step 1: Write failing design-system tests**

Create `tests/web/design-system.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '../../apps/web/src/shared/ui/button/button';
import { Section } from '../../apps/web/src/shared/layout/section/section';

describe('design system primitives', () => {
  it('renders semantic buttons with stable accessible names', () => {
    render(<Button iconLeading={null}>Create Spec</Button>);
    expect(screen.getByRole('button', { name: 'Create Spec' })).toBeTruthy();
  });

  it('renders page sections without nested card markup', () => {
    render(<Section title="Release scope">Content</Section>);
    expect(screen.getByRole('heading', { name: 'Release scope' })).toBeTruthy();
    expect(document.querySelector('.panel')).toBeNull();
    expect(document.querySelector('.workbench-grid')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/web/design-system.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because components do not exist.

- [ ] **Step 3: Add design tokens**

Create token files with named exports. Example `colors.ts`:

```ts
export const colors = {
  background: '#f6f8fb',
  surface: '#ffffff',
  surfaceMuted: '#f1f5f9',
  border: '#d9e2ec',
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#64748b',
  primary: '#2563eb',
  primaryHover: '#1d4ed8',
  success: '#15803d',
  warning: '#b45309',
  danger: '#dc2626',
  info: '#0369a1',
} as const;
```

Create `css-variables.css` with CSS variables for every token and base body styles. Do not copy old `styles.css` classes.

Keep the Tailwind import from Task 2 at the top of `css-variables.css`, then add a small Tailwind theme bridge so utility classes and custom CSS read from the same source of truth:

```css
@import "tailwindcss";

@theme {
  --color-fl-background: #f6f8fb;
  --color-fl-surface: #ffffff;
  --color-fl-border: #d9e2ec;
  --color-fl-primary: #2563eb;
  --radius-fl-card: 8px;
}
```

Use `tailwind-preset.ts` only for shared token exports or future extraction. Do not introduce a parallel Tailwind config unless a package requires it; the active processing path is `@tailwindcss/vite` plus the root CSS import.

- [ ] **Step 4: Add shared UI primitives**

Implement minimal components:

```tsx
// apps/web/src/shared/ui/button/button.tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../utils/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  iconLeading?: ReactNode;
  iconTrailing?: ReactNode;
}

export function Button({ variant = 'secondary', loading = false, iconLeading, iconTrailing, className, children, ...props }: ButtonProps) {
  return (
    <button className={cn('fl-button', `fl-button--${variant}`, className)} disabled={loading || props.disabled} {...props}>
      <span className="fl-button__slot">{iconLeading}</span>
      <span className="fl-button__label">{loading ? 'Loading' : children}</span>
      <span className="fl-button__slot">{iconTrailing}</span>
    </button>
  );
}
```

Create matching components for `IconButton`, `Input`, `Textarea`, `Select`, `Checkbox`, `Tabs`, `Badge`, `StatusPill`, `Table`, `Timeline`, `Drawer`, `Dialog`, `EmptyState`, `Skeleton`, `Toast`.

- [ ] **Step 5: Add layout primitives**

Implement `AppShell`, `SidebarNav`, `Topbar`, `PageHeader`, `DetailLayout`, `ActionRail`, `Section`, `SplitPane`. Example:

```tsx
export function DetailLayout({ header, children, actionRail }: { header: React.ReactNode; children: React.ReactNode; actionRail?: React.ReactNode }) {
  return (
    <main id="main-content" className="fl-detail-layout">
      <div className="fl-detail-layout__header">{header}</div>
      <div className="fl-detail-layout__body">
        <div className="fl-detail-layout__content">{children}</div>
        {actionRail ? <aside className="fl-detail-layout__rail">{actionRail}</aside> : null}
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Add component guidelines**

Create `apps/web/src/shared/design-system/docs/component-guidelines.md` and include:

- `.panel` replacement map: `Section`, `DetailLayout`, `ActionRail`, `Table`, `Drawer`, `DevToolsRawPanel`.
- No card-in-card rule.
- Icon button accessible-label rule.
- Status color plus text rule.

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm vitest run tests/web/design-system.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/shared tests/web/design-system.test.tsx
git commit -m "feat: add web design system primitives"
```

---

### Task 4: Add Shared API Clients, Query Hooks, Context, And Test Fixtures

**Files:**
- Create: `apps/web/src/shared/api/common.ts`
- Create: `apps/web/src/shared/api/commands.ts`
- Create: `apps/web/src/shared/api/query.ts`
- Create: `apps/web/src/shared/api/query-keys.ts`
- Create: `apps/web/src/shared/api/hooks.ts`
- Create: `apps/web/src/shared/context/actor-context.tsx`
- Create: `apps/web/src/shared/context/project-context.tsx`
- Create: `apps/web/src/shared/context/runtime-flags.tsx`
- Create: `tests/web/fixtures/product-data.ts`
- Test: `tests/web/api-hooks.test.tsx`

- [ ] **Step 1: Write failing query hook tests**

Create `tests/web/api-hooks.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { queryKeys } from '../../apps/web/src/shared/api/query-keys';
import { productRoleToWorkbenchId } from '../../apps/web/src/features/role-workbench/role-labels';

describe('Web product API hooks', () => {
  it('uses stable query keys for route-backed product data', () => {
    expect(queryKeys.workbench({ role: 'work-item-owner', projectId: 'proj' })).toEqual([
      'workbench',
      'intake',
      { projectId: 'proj' },
    ]);
  });

  it('maps product role labels to backend workbench ids without leaking Intake', () => {
    expect(productRoleToWorkbenchId('Work Item Owner')).toBe('intake');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/web/api-hooks.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Move API clients into shared API**

Copy and refactor current `apps/web/src/api/common.ts`, `commands.ts`, `query.ts`, and `types.ts` into `apps/web/src/shared/api/**`. Keep old files temporarily as re-export shims only if existing tests still import them:

```ts
// apps/web/src/api/query.ts
export * from '../shared/api/query';
```

Delete the shims in Task 11.

- [ ] **Step 4: Add query keys**

Create `apps/web/src/shared/api/query-keys.ts`:

```ts
export const queryKeys = {
  workbench: (input: { role: 'work-item-owner' | string; projectId?: string }) => [
    'workbench',
    input.role === 'work-item-owner' ? 'intake' : input.role,
    { projectId: input.projectId },
  ],
  pipeline: (projectId: string) => ['pipeline', { projectId }],
  workItem: (workItemId: string) => ['work-item', workItemId],
  workItemCockpit: (workItemId: string) => ['work-item-cockpit', workItemId],
  specs: (projectId: string) => ['specs', { projectId }],
  spec: (specId: string) => ['spec', specId],
  specHistory: (specId: string) => ['spec-history', specId],
  plans: (projectId: string) => ['plans', { projectId }],
  plan: (planId: string) => ['plan', planId],
  planHistory: (planId: string) => ['plan-history', planId],
  packages: (projectId: string) => ['packages', { projectId }],
  package: (packageId: string) => ['package', packageId],
  runs: (projectId: string) => ['runs', { projectId }],
  run: (runSessionId: string) => ['run', runSessionId],
  reviews: (projectId: string) => ['reviews', { projectId }],
  review: (reviewPacketId: string) => ['review', reviewPacketId],
  releases: (projectId: string) => ['releases', { projectId }],
  releaseCockpit: (releaseId: string) => ['release-cockpit', releaseId],
} as const;
```

- [ ] **Step 5: Add role label mapping**

Create `apps/web/src/features/role-workbench/role-labels.ts`:

```ts
export const productRoles = [
  'Work Item Owner',
  'Spec Approver',
  'Execution Owner',
  'Reviewer',
  'QA / Test Owner',
  'Release Owner',
  'Manager',
] as const;

export type ProductRole = (typeof productRoles)[number];

export const productRoleToWorkbenchId = (role: ProductRole) =>
  ({
    'Work Item Owner': 'intake',
    'Spec Approver': 'spec-approver',
    'Execution Owner': 'execution-owner',
    Reviewer: 'reviewer',
    'QA / Test Owner': 'qa-test-owner',
    'Release Owner': 'release-owner',
    Manager: 'manager-health',
  })[role];
```

- [ ] **Step 6: Add hooks and contexts**

Add TanStack Query hooks in `apps/web/src/shared/api/hooks.ts`, starting with:

```ts
import { useQuery } from '@tanstack/react-query';
import { createForgeloopQueryApi } from './query';
import { queryKeys } from './query-keys';

const queryApi = createForgeloopQueryApi();

export function usePipelineQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.pipeline(projectId),
    queryFn: () => queryApi.getPipeline({ project_id: projectId }),
  });
}
```

Implement the hook names from the spec. Use mutation hooks only when the corresponding page task needs them.

Create `apps/web/src/shared/context/runtime-flags.tsx` and compose it into `AppProviders`:

```tsx
import { createContext, useContext } from 'react';

export interface RuntimeFlags {
  devToolsEnabled: boolean;
}

const defaultRuntimeFlags: RuntimeFlags = {
  devToolsEnabled: import.meta.env.DEV || import.meta.env.VITE_FORGELOOP_ENABLE_DEV_TOOLS === 'true',
};

const RuntimeFlagsContext = createContext<RuntimeFlags>(defaultRuntimeFlags);

export function RuntimeFlagsProvider({ value, children }: { value?: RuntimeFlags; children: React.ReactNode }) {
  return <RuntimeFlagsContext.Provider value={value ?? defaultRuntimeFlags}>{children}</RuntimeFlagsContext.Provider>;
}

export function useRuntimeFlags() {
  return useContext(RuntimeFlagsContext);
}
```

Also add actor/project context providers here and wrap them from `apps/web/src/app/providers.tsx`. `AppProviders` may accept optional test overrides, but production defaults must read from route/search params and environment, not hard-coded fixtures.

- [ ] **Step 7: Add fixtures**

Create `tests/web/fixtures/product-data.ts` with reusable objects:

```ts
export const projectId = 'project-web-product';
export const actorId = 'actor-owner';
export const workItem = {
  id: 'wi-1',
  project_id: projectId,
  kind: 'requirement',
  title: 'Improve release cockpit',
  goal: 'Make release decisions readable',
  success_criteria: ['Release owner can inspect blockers'],
  priority: 'high',
  risk: 'medium',
  owner_actor_id: actorId,
  phase: 'triage',
  gate_state: 'none',
  resolution: 'none',
  updated_at: '2026-05-18T00:00:00.000Z',
};
```

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm vitest run tests/web/api-hooks.test.tsx tests/web/workbench-state.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/shared/api apps/web/src/shared/context apps/web/src/features/role-workbench tests/web/fixtures tests/web/api-hooks.test.tsx apps/web/src/api
git commit -m "feat: add web product api hooks"
```

---

### Task 5: Build App Shell, Navigation, Dev Tools Gating, And Route Skeletons

**Files:**
- Modify: `apps/web/src/app/root.tsx`
- Modify: `apps/web/src/app/providers.tsx`
- Modify: `apps/web/src/app/routes.ts`
- Create/modify: `apps/web/src/app/routes/_layout.tsx`
- Create/modify: `apps/web/src/app/routes/dev-tools/index.tsx`
- Create route skeletons under `apps/web/src/app/routes/**`
- Create: `apps/web/src/features/dev-tools/dev-tools-gate.ts`
- Create: `apps/web/src/features/dev-tools/dev-tools-route.tsx`
- Test: `tests/web/app-shell-routing.test.tsx`
- Test: `tests/web/dev-tools-gating.test.tsx`

- [ ] **Step 1: Write failing shell and Dev Tools tests**

Add to `tests/web/app-shell-routing.test.tsx`:

```tsx
it('shows product nav labels and does not show Intake as user-facing role copy', async () => {
  const screen = await renderRoute('/workbench');
  expect(screen.getByRole('link', { name: 'Workbench' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Specs & Plans' })).toBeTruthy();
  expect(screen.queryByText('Intake')).toBeNull();
});
```

Create `tests/web/dev-tools-gating.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { isDevToolsEnabled } from '../../apps/web/src/features/dev-tools/dev-tools-gate';

describe('Dev Tools gate', () => {
  it('is disabled in production unless explicitly enabled', () => {
    expect(isDevToolsEnabled({ dev: false, flag: undefined })).toBe(false);
    expect(isDevToolsEnabled({ dev: false, flag: 'true' })).toBe(true);
  });
});
```

Add enabled-mode coverage:

```tsx
it('renders raw/debug tools only when Dev Tools are enabled', async () => {
  const screen = await renderRoute('/dev-tools', { devToolsEnabled: true });
  expect(screen.getByRole('heading', { name: 'Dev Tools' })).toBeTruthy();
  expect(screen.getByLabelText('Object ID')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Load raw replay' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Send API smoke request' })).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/web/app-shell-routing.test.tsx tests/web/dev-tools-gating.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because real AppShell and Dev Tools gate do not exist.

- [ ] **Step 3: Implement AppShell navigation**

Create `apps/web/src/app/routes/_layout.tsx`:

```tsx
import { Outlet } from 'react-router';
import { AppShell } from '../../shared/layout/app-shell/app-shell';

const navItems = [
  { label: 'Workbench', to: '/workbench' },
  { label: 'Pipeline', to: '/pipeline' },
  { label: 'Work Items', to: '/work-items' },
  { label: 'Specs & Plans', to: '/specs' },
  { label: 'Packages', to: '/packages' },
  { label: 'Runs', to: '/runs' },
  { label: 'Reviews', to: '/reviews' },
  { label: 'Releases', to: '/releases' },
];

export default function ProductLayoutRoute() {
  return (
    <AppShell navItems={navItems}>
      <Outlet />
    </AppShell>
  );
}
```

- [ ] **Step 4: Add route skeletons**

Create route files for every route in the spec. Each skeleton uses `PageHeader`, `Section`, and truthful loading/empty copy, not old raw forms:

```tsx
export default function PipelineRoute() {
  return (
    <>
      <h1>Pipeline</h1>
      <p>Delivery stages and blockers.</p>
    </>
  );
}
```

- [ ] **Step 5: Define the concrete React Router route tree**

Create or update `apps/web/src/app/routes.ts` so the real app registers every product route:

```ts
import { index, layout, prefix, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  layout('./routes/_layout.tsx', [
    index('./routes/workbench/index.tsx'),
    route('workbench', './routes/workbench/index.tsx'),
    route('pipeline', './routes/pipeline/index.tsx'),
    ...prefix('work-items', [
      index('./routes/work-items/index.tsx'),
      route('new', './routes/work-items/new.tsx'),
      route(':workItemId', './routes/work-items/$workItemId.tsx'),
      route(':workItemId/spec-plan', './routes/work-items/$workItemId/spec-plan.tsx'),
    ]),
    ...prefix('specs', [
      index('./routes/specs/index.tsx'),
      route(':specId', './routes/specs/$specId.tsx'),
      route(':specId/revisions/:revisionId', './routes/specs/$specId/revisions/$revisionId.tsx'),
    ]),
    ...prefix('plans', [
      index('./routes/plans/index.tsx'),
      route(':planId', './routes/plans/$planId.tsx'),
      route(':planId/revisions/:revisionId', './routes/plans/$planId/revisions/$revisionId.tsx'),
    ]),
    ...prefix('packages', [index('./routes/packages/index.tsx'), route(':packageId', './routes/packages/$packageId.tsx')]),
    ...prefix('runs', [index('./routes/runs/index.tsx'), route(':runSessionId', './routes/runs/$runSessionId.tsx')]),
    ...prefix('reviews', [index('./routes/reviews/index.tsx'), route(':reviewPacketId', './routes/reviews/$reviewPacketId.tsx')]),
    ...prefix('releases', [index('./routes/releases/index.tsx'), route(':releaseId', './routes/releases/$releaseId.tsx')]),
    route('dev-tools', './routes/dev-tools/index.tsx'),
  ]),
] satisfies RouteConfig;
```

Run `pnpm --filter @forgeloop/web typecheck` after route tree creation to catch dead route modules.

- [ ] **Step 6: Replace the temporary router test helper**

Update `tests/web/router-test-utils.tsx` to use React Router route stubs with a default full product route tree. Later tests should be able to keep calling `renderRoute('/path')`; pass an explicit route array only for isolated edge cases.

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import type { RouteObject } from 'react-router';
import { RuntimeFlagsProvider } from '../../apps/web/src/shared/context/runtime-flags';
import ProductLayoutRoute from '../../apps/web/src/app/routes/_layout';
import DevToolsRoute from '../../apps/web/src/app/routes/dev-tools';
import PackageDetailRoute from '../../apps/web/src/app/routes/packages/$packageId';
import PackagesRoute from '../../apps/web/src/app/routes/packages';
import PipelineRoute from '../../apps/web/src/app/routes/pipeline';
import PlanDetailRoute from '../../apps/web/src/app/routes/plans/$planId';
import PlanRevisionRoute from '../../apps/web/src/app/routes/plans/$planId/revisions/$revisionId';
import PlansRoute from '../../apps/web/src/app/routes/plans';
import ReleaseDetailRoute from '../../apps/web/src/app/routes/releases/$releaseId';
import ReleasesRoute from '../../apps/web/src/app/routes/releases';
import ReviewDetailRoute from '../../apps/web/src/app/routes/reviews/$reviewPacketId';
import ReviewsRoute from '../../apps/web/src/app/routes/reviews';
import RunDetailRoute from '../../apps/web/src/app/routes/runs/$runSessionId';
import RunsRoute from '../../apps/web/src/app/routes/runs';
import SpecDetailRoute from '../../apps/web/src/app/routes/specs/$specId';
import SpecRevisionRoute from '../../apps/web/src/app/routes/specs/$specId/revisions/$revisionId';
import SpecsRoute from '../../apps/web/src/app/routes/specs';
import WorkbenchRoute from '../../apps/web/src/app/routes/workbench';
import WorkItemDetailRoute from '../../apps/web/src/app/routes/work-items/$workItemId';
import WorkItemSpecPlanRoute from '../../apps/web/src/app/routes/work-items/$workItemId/spec-plan';
import WorkItemsRoute from '../../apps/web/src/app/routes/work-items';
import NewWorkItemRoute from '../../apps/web/src/app/routes/work-items/new';

const productRoutes: RouteObject[] = [
  {
    path: '/',
    Component: ProductLayoutRoute,
    children: [
      { index: true, Component: WorkbenchRoute },
      { path: 'workbench', Component: WorkbenchRoute },
      { path: 'pipeline', Component: PipelineRoute },
      { path: 'work-items', Component: WorkItemsRoute },
      { path: 'work-items/new', Component: NewWorkItemRoute },
      { path: 'work-items/:workItemId', Component: WorkItemDetailRoute },
      { path: 'work-items/:workItemId/spec-plan', Component: WorkItemSpecPlanRoute },
      { path: 'specs', Component: SpecsRoute },
      { path: 'specs/:specId', Component: SpecDetailRoute },
      { path: 'specs/:specId/revisions/:revisionId', Component: SpecRevisionRoute },
      { path: 'plans', Component: PlansRoute },
      { path: 'plans/:planId', Component: PlanDetailRoute },
      { path: 'plans/:planId/revisions/:revisionId', Component: PlanRevisionRoute },
      { path: 'packages', Component: PackagesRoute },
      { path: 'packages/:packageId', Component: PackageDetailRoute },
      { path: 'runs', Component: RunsRoute },
      { path: 'runs/:runSessionId', Component: RunDetailRoute },
      { path: 'reviews', Component: ReviewsRoute },
      { path: 'reviews/:reviewPacketId', Component: ReviewDetailRoute },
      { path: 'releases', Component: ReleasesRoute },
      { path: 'releases/:releaseId', Component: ReleaseDetailRoute },
      { path: 'dev-tools', Component: DevToolsRoute },
    ],
  },
];

export async function renderRoute(path: string, options: { routes?: RouteObject[]; devToolsEnabled?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const RoutesStub = createRoutesStub(options.routes ?? productRoutes);
  render(
    <QueryClientProvider client={queryClient}>
      <RuntimeFlagsProvider value={{ devToolsEnabled: options.devToolsEnabled ?? false }}>
        <RoutesStub initialEntries={[path]} />
      </RuntimeFlagsProvider>
    </QueryClientProvider>,
  );
  return screen;
}
```

If a later task replaces a route skeleton with a new route file path, update this default route stub in the same task before relying on `renderRoute('/path')`.

- [ ] **Step 7: Implement Dev Tools gate**

Create `apps/web/src/features/dev-tools/dev-tools-gate.ts`:

```ts
export function isDevToolsEnabled(input: { dev: boolean; flag?: string }) {
  return input.dev || input.flag === 'true';
}
```

Create `/dev-tools` route that reads `useRuntimeFlags()` and renders "Dev Tools are not enabled" when disabled. Sidebar only includes Dev Tools when enabled.

When enabled, `apps/web/src/features/dev-tools/dev-tools-route.tsx` must be the explicit home for raw/debug operations removed from the old workbench:

- manual object lookup by object type and ID;
- raw replay reads for Work Item, Execution Package, Review Packet, Release, Spec, and Plan;
- direct release scope link/unlink helpers for debugging data repair only;
- patch/debug payload inspector for commands that should not be primary product flows;
- API smoke request utility for local development;
- raw JSON payload viewer with copy controls.

Do not move normal product governance actions here. Force rerun, override approve, release close, observation evidence, and Test Acceptance acknowledgement still live on the relevant product detail pages with proper confirmation UX.

- [ ] **Step 8: Run shell tests and typecheck**

Run:

```bash
pnpm vitest run tests/web/app-shell-routing.test.tsx tests/web/dev-tools-gating.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app apps/web/src/features/dev-tools tests/web/app-shell-routing.test.tsx tests/web/dev-tools-gating.test.tsx
git commit -m "feat: add product app shell and route skeletons"
```

---

### Task 6: Implement Workbench, Work Items, Intake Brief, And Spec/Plan Work Item Flow

**Files:**
- Create/modify: `apps/web/src/app/routes/workbench/index.tsx`
- Create/modify: `apps/web/src/app/routes/work-items/index.tsx`
- Create/modify: `apps/web/src/app/routes/work-items/new.tsx`
- Create/modify: `apps/web/src/app/routes/work-items/$workItemId.tsx`
- Create/modify: `apps/web/src/app/routes/work-items/$workItemId/spec-plan.tsx`
- Create: `apps/web/src/features/role-workbench/**`
- Create: `apps/web/src/features/work-items/**`
- Create: `apps/web/src/features/spec-plan/**`
- Test: `tests/web/workbench-product-route.test.tsx`
- Test: `tests/web/work-item-product-route.test.tsx`
- Test: `tests/web/spec-plan-product-route.test.tsx`

- [ ] **Step 1: Write failing route tests**

Create `tests/web/workbench-product-route.test.tsx`:

```tsx
it('renders Work Item Owner role queue with object kinds and no Intake copy', async () => {
  const screen = await renderRoute('/workbench?project_id=project-web-product');
  expect(screen.getByRole('heading', { name: /workbench/i })).toBeTruthy();
  expect(screen.getByText('Work Item Owner')).toBeTruthy();
  expect(screen.queryByText('Intake')).toBeNull();
  expect(screen.queryByText('Load role queue')).toBeNull();
});
```

Create `tests/web/work-item-product-route.test.tsx`:

```tsx
it('renders Work Item detail with Brief / Intake and Validation sections', async () => {
  const screen = await renderRoute('/work-items/wi-1');
  expect(screen.getByRole('heading', { name: /improve release cockpit/i })).toBeTruthy();
  expect(screen.getByText('Brief / Intake')).toBeTruthy();
  expect(screen.getByText('Validation')).toBeTruthy();
  expect(screen.queryByText('raw JSON')).toBeNull();
});
```

Create `tests/web/spec-plan-product-route.test.tsx`:

```tsx
it('renders Work Item scoped Spec & Plan actions without raw loaders', async () => {
  const screen = await renderRoute('/work-items/wi-1/spec-plan');
  expect(screen.getByRole('heading', { name: 'Spec & Plan' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Create Spec' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Create Plan' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Open revision history' })).toBeTruthy();
  expect(screen.queryByLabelText('spec_id')).toBeNull();
  expect(screen.queryByLabelText('plan_id')).toBeNull();
  expect(screen.queryByText('raw JSON')).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm vitest run tests/web/workbench-product-route.test.tsx tests/web/work-item-product-route.test.tsx tests/web/spec-plan-product-route.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because feature routes are placeholders.

- [ ] **Step 3: Implement role workbench feature**

Create components:

- `RoleSwitcher`
- `RoleQueueTable`
- `RoleQueuePreview`
- `role-workbench-view-model.ts`

Use `productRoleToWorkbenchId('Work Item Owner')` for query calls, but render `Work Item Owner` in UI.

- [ ] **Step 4: Implement Work Items list and create flow**

Use React Hook Form + Zod:

```ts
const createWorkItemFormSchema = z.object({
  project_id: z.string().min(1),
  kind: z.enum(['initiative', 'requirement', 'bug', 'tech_debt']),
  title: z.string().min(1),
  goal: z.string().min(1),
  success_criteria: z.array(z.string().min(1)).min(1),
  priority: z.string().min(1),
  risk: z.string().min(1),
  owner_actor_id: z.string().min(1),
  raw_request: z.string().optional(),
});
```

After successful create, navigate to `/work-items/:workItemId`.

- [ ] **Step 5: Implement Work Item detail**

Use `DetailLayout`, tabs, and `ActionRail`. Include:

- Overview
- Brief / Intake degraded state
- Spec & Plan summary
- Packages summary
- Validation section
- Timeline
- Evidence

Do not expose raw JSON or manual ID loaders.

- [ ] **Step 6: Implement Work Item-scoped Spec & Plan page**

Preserve:

- Create Spec when no Spec exists.
- Create Plan when Spec exists and Plan does not.
- Generate draft only when object exists.
- Revision drawer/dialog.
- Submit/approve/request changes commands.

- [ ] **Step 7: Run route tests**

Run:

```bash
pnpm vitest run tests/web/workbench-product-route.test.tsx tests/web/work-item-product-route.test.tsx tests/web/spec-plan-product-route.test.tsx tests/web/api-hooks.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/routes/workbench apps/web/src/app/routes/work-items apps/web/src/features/role-workbench apps/web/src/features/work-items apps/web/src/features/spec-plan tests/web/*product-route.test.tsx
git commit -m "feat: add workbench and work item product flows"
```

---

### Task 7: Implement Spec/Plan Registries, Direct Routes, And History

**Files:**
- Create/modify: `apps/web/src/app/routes/specs/index.tsx`
- Create/modify: `apps/web/src/app/routes/specs/$specId.tsx`
- Create/modify: `apps/web/src/app/routes/specs/$specId/revisions/$revisionId.tsx`
- Create/modify: `apps/web/src/app/routes/plans/index.tsx`
- Create/modify: `apps/web/src/app/routes/plans/$planId.tsx`
- Create/modify: `apps/web/src/app/routes/plans/$planId/revisions/$revisionId.tsx`
- Create/modify: `apps/web/src/features/spec-plan/**`
- Test: `tests/web/spec-plan-direct-routes.test.tsx`

- [ ] **Step 1: Write failing direct route tests**

Create `tests/web/spec-plan-direct-routes.test.tsx`:

```tsx
it('renders direct Spec detail with parent link and History / Timeline', async () => {
  const screen = await renderRoute('/specs/spec-1');
  expect(screen.getByRole('heading', { name: /spec/i })).toBeTruthy();
  expect(screen.getByText('History / Timeline')).toBeTruthy();
  expect(screen.getByRole('link', { name: /work item/i })).toBeTruthy();
});

it('renders direct Plan revision as read-only structured content', async () => {
  const screen = await renderRoute('/plans/plan-1/revisions/plan-rev-1');
  expect(screen.getByText('Read-only revision')).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/web/spec-plan-direct-routes.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL.

- [ ] **Step 3: Implement registry list pages**

Use `useSpecsQuery` and `usePlansQuery`; render TanStack Table with filters in search params. Empty/degraded states must say when list data is incomplete.

- [ ] **Step 4: Implement direct detail pages**

Spec detail:

- Status/current revision.
- Parent Work Item link.
- Allowed commands.
- History / Timeline using `useSpecHistoryQuery`.

Plan detail mirrors Spec and includes downstream package generation link/action when approved.

- [ ] **Step 5: Implement revision read-only pages**

Render structured content and metadata. Do not show edit textareas directly on first load.

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm vitest run tests/web/spec-plan-direct-routes.test.tsx tests/web/spec-plan-product-route.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/routes/specs apps/web/src/app/routes/plans apps/web/src/features/spec-plan tests/web/spec-plan-direct-routes.test.tsx
git commit -m "feat: add spec and plan direct routes"
```

---

### Task 8: Implement Execution Package And Run Surfaces

**Files:**
- Create/modify: `apps/web/src/app/routes/packages/index.tsx`
- Create/modify: `apps/web/src/app/routes/packages/$packageId.tsx`
- Create/modify: `apps/web/src/app/routes/runs/index.tsx`
- Create/modify: `apps/web/src/app/routes/runs/$runSessionId.tsx`
- Create: `apps/web/src/features/execution-packages/**`
- Create: `apps/web/src/features/run-console/**`
- Test: `tests/web/package-run-product-routes.test.tsx`
- Modify: `tests/e2e/run-console.e2e.test.ts`

- [ ] **Step 1: Write failing package/run route tests**

Create `tests/web/package-run-product-routes.test.tsx`:

```tsx
it('renders package detail actions outside Dev Tools', async () => {
  const screen = await renderRoute('/packages/pkg-1');
  expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Force rerun' })).toBeTruthy();
  expect(screen.getByText('Timeline / Replay')).toBeTruthy();
});

it('renders run command center without raw debug metadata by default', async () => {
  const screen = await renderRoute('/runs/run-1');
  expect(screen.getByText('Run Console')).toBeTruthy();
  expect(screen.queryByText('raw payload')).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/web/package-run-product-routes.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL.

- [ ] **Step 3: Implement packages list and detail**

List page:

- Uses `usePackagesQuery`.
- Filters project, Work Item, PlanRevision, surface type, owner, reviewer, QA, phase, risk, and blocked status.
- Shows truthful degraded state if data is partial.

Detail page:

- Overview/Runs/Review/Artifacts/Timeline/Policy tabs.
- Generate packages and manual create flows where PlanRevision context is present.
- Mark ready/run/rerun/force rerun/edit actions.
- Force rerun requires reason.

- [ ] **Step 4: Implement run list and detail**

Runs list:

- Uses `useRunsQuery`.
- If global list data is incomplete, render a clear deep-link/search degraded state.

Run detail:

- Metadata rail, event stream, artifact/check panel.
- SSE lifecycle remains in `features/run-console`.
- Input/cancel/resume controls use stable dimensions.

- [ ] **Step 5: Update E2E harness startup**

In `tests/e2e/run-console.e2e.test.ts`, replace raw Vite server startup:

```ts
const server = await createViteServer({ configFile: resolve('apps/web/vite.config.ts'), root: resolve('apps/web') });
```

with a helper that runs:

```ts
const webProcess = spawn('pnpm', ['--filter', '@forgeloop/web', 'dev', '--host', '127.0.0.1', '--port', String(port)], {
  env: { ...process.env, VITE_FORGELOOP_API_URL: apiUrl },
});
```

Wait for the dev server URL before launching Chromium.

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm vitest run tests/web/package-run-product-routes.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
pnpm e2e:run-console
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/routes/packages apps/web/src/app/routes/runs apps/web/src/features/execution-packages apps/web/src/features/run-console tests/web/package-run-product-routes.test.tsx tests/e2e/run-console.e2e.test.ts
git commit -m "feat: add package and run product surfaces"
```

---

### Task 9: Implement Review And Release Surfaces

**Files:**
- Create/modify: `apps/web/src/app/routes/reviews/index.tsx`
- Create/modify: `apps/web/src/app/routes/reviews/$reviewPacketId.tsx`
- Create/modify: `apps/web/src/app/routes/releases/index.tsx`
- Create/modify: `apps/web/src/app/routes/releases/$releaseId.tsx`
- Create: `apps/web/src/features/review-packets/**`
- Create: `apps/web/src/features/releases/**`
- Test: `tests/web/review-release-product-routes.test.tsx`
- Replace: `tests/web/release-owner-surface.test.tsx`

- [ ] **Step 1: Write failing review/release route tests**

Create `tests/web/review-release-product-routes.test.tsx`:

```tsx
it('renders release list from listReleases without manual release id loading', async () => {
  const screen = await renderRoute('/releases?project_id=project-web-product');
  expect(screen.getByRole('heading', { name: 'Releases' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Create release' })).toBeTruthy();
  expect(screen.queryByLabelText('release_id')).toBeNull();
  expect(screen.queryByText('Load cockpit')).toBeNull();
});

it('renders Release Cockpit product governance actions', async () => {
  const screen = await renderRoute('/releases/rel-1');
  expect(screen.getByText('Test Acceptance')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Acknowledge test acceptance' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Override approve' })).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/web/review-release-product-routes.test.tsx tests/web/release-owner-surface.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because routes are placeholders and old release test still asserts old UI.

- [ ] **Step 3: Implement Reviews list/detail**

List page:

- Uses `useReviewPacketsQuery`.
- Filters reviewer, decision state, risk, related package, stale status.

Detail page:

- Summary/decision/status.
- Changed files/check summary/self-review/risk notes/requested changes.
- Timeline via `useReviewPacketReplayQuery`.
- Approve/request changes actions.

- [ ] **Step 4: Implement Releases list**

Use existing `listReleases` API through `useReleasesQuery`:

- Filters project, release owner, phase, gate state, resolution, release type, updated age.
- Table rows show title/key, phase, gate state, resolution, owner, linked counts, rollout/rollback/observation completeness, acceptance summary, updated age.
- Row click to `/releases/:releaseId`.
- Create release drawer/dialog.
- No manual `release_id` loaders or raw replay controls.

- [ ] **Step 5: Implement Release Cockpit**

Detail page:

- Header with phase/gate/resolution/owner/blocker fingerprint.
- Scope summary, linked Work Items, linked packages.
- Productized pickers for add/remove Work Items and Execution Packages.
- Blockers/checklist/risk/evidence/observations/decisions/replay timeline.
- Actions: submit, approve, acknowledge test acceptance, override approve, request changes, start observing, close release, submit observation evidence.

For Test Acceptance, use supported API fields:

```ts
type TestAcceptanceForm = {
  actor_id: string;
  summary: string;
  evidence_refs: Array<{ kind: string; ref: string }>;
};
```

If separate risk notes are needed, add an explicit backend/API task before using unsupported payload fields.

- [ ] **Step 6: Replace old release owner SSR test**

Update `tests/web/release-owner-surface.test.tsx` so it imports route helpers, not `../../apps/web/src/App`, and asserts absence of old raw controls.

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm vitest run tests/web/review-release-product-routes.test.tsx tests/web/release-owner-surface.test.tsx tests/web/evidence-chain-state.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/routes/reviews apps/web/src/app/routes/releases apps/web/src/features/review-packets apps/web/src/features/releases tests/web/review-release-product-routes.test.tsx tests/web/release-owner-surface.test.tsx
git commit -m "feat: add review and release product surfaces"
```

---

### Task 10: Implement Pipeline, Responsive Behavior, Accessibility Gates, And Visual Smoke

**Files:**
- Create/modify: `apps/web/src/app/routes/pipeline/index.tsx`
- Create: `apps/web/src/features/pipeline/**`
- Modify: `apps/web/src/shared/layout/**`
- Modify: `apps/web/src/shared/design-system/theme/css-variables.css`
- Create: `tests/web/responsive-layout.test.tsx`
- Create: `tests/web/a11y-gates.test.tsx`
- Create: `tests/e2e/web-product-routes.e2e.test.ts`

- [ ] **Step 1: Write failing pipeline/responsive/a11y tests**

Create `tests/web/a11y-gates.test.tsx`:

```tsx
it('renders skip link and labelled dialogs', async () => {
  const screen = await renderRoute('/workbench');
  expect(screen.getByRole('link', { name: 'Skip to main content' })).toBeTruthy();
});
```

Create `tests/web/responsive-layout.test.tsx`:

```tsx
it('renders the shell with stable responsive landmarks', async () => {
  const screen = await renderRoute('/workbench');
  expect(screen.getByRole('banner')).toBeTruthy();
  expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy();
  expect(screen.getByRole('main')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy();
});

it('renders dense tables with a card fallback contract', async () => {
  const screen = await renderRoute('/runs');
  expect(screen.getByRole('table', { name: 'Runs' })).toBeTruthy();
  expect(document.querySelector('[data-responsive-card-list]')).not.toBeNull();
});
```

Add `axe-core` as a Web dev dependency if it is not already available:

```bash
pnpm --filter @forgeloop/web add -D axe-core
```

Then include a lightweight automated check:

```tsx
import axe from 'axe-core';

it('has no automated axe violations on the Workbench shell', async () => {
  await renderRoute('/workbench');
  const result = await axe.run(document.body);
  expect(result.violations).toEqual([]);
});
```

Create `tests/e2e/web-product-routes.e2e.test.ts` with the repo's existing Vitest + Playwright manual browser style. Do not use Playwright Test fixtures because this file is run with Vitest:

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';

import { chromium, expect as expectPage, type Browser } from '@playwright/test';
import { afterEach, describe, expect, it } from 'vitest';

const routes = ['/workbench', '/pipeline', '/work-items', '/specs', '/plans', '/packages', '/runs', '/reviews', '/releases'];
const viewports = [
  { width: 375, height: 900 },
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1440, height: 1000 },
];

describe('web product routes visual smoke', () => {
  let browser: Browser | undefined;
  let webProcess: ChildProcess | undefined;

  afterEach(async () => {
    await browser?.close();
    if (webProcess !== undefined) await stopProcess(webProcess);
    browser = undefined;
    webProcess = undefined;
  });

  it('renders product routes without horizontal overflow', async () => {
    const web = await startReactRouterWeb();
    webProcess = web.process;
    browser = await chromium.launch();
    const page = await browser.newPage();

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      for (const route of routes) {
        await page.goto(`${web.url}${route}`);
        await expectPage(page.getByRole('main')).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        expect(overflow).toBe(false);
        await mkdir(join('test-results', 'web-product-routes'), { recursive: true });
        await page.screenshot({
          path: join('test-results', 'web-product-routes', `${route.replaceAll('/', '_').replace(/^_$/, 'index')}-${viewport.width}.png`),
          fullPage: true,
        });
      }
    }
  }, 60_000);
});

async function startReactRouterWeb(): Promise<{ process: ChildProcess; url: string }> {
  const port = await freePort();
  const webProcess = spawn(
    'pnpm',
    ['--filter', '@forgeloop/web', 'dev', '--host', '127.0.0.1', '--port', String(port)],
    { env: { ...process.env, VITE_FORGELOOP_API_URL: 'http://127.0.0.1:1' }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  webProcess.stderr.resume();
  webProcess.stdout.resume();
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return { process: webProcess, url };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await stopProcess(webProcess);
  throw new Error(`React Router Web dev server did not start at ${url}`);
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 1000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address !== 'object' || address === null) {
        server.close(() => reject(new Error('Unable to allocate a TCP port')));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm vitest run tests/web/a11y-gates.test.tsx tests/web/responsive-layout.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
pnpm vitest run tests/e2e/web-product-routes.e2e.test.ts
```

Expected: FAIL until route/layout behavior is implemented.

- [ ] **Step 3: Implement Pipeline page**

Use `usePipelineQuery` and render all eight stages:

- Intake
- Spec / Plan
- Execution
- Review
- Integration / Cross-end Validation
- Test / Acceptance
- Release
- Observation

Each stage shows counts, blockers, high-risk count, stale/SLA hint, and representative rows. If stage data is degraded, display a non-blocking degraded badge.

- [ ] **Step 4: Implement responsive layout contract**

In layout CSS:

- Desktop >= 1200px: persistent sidebar + optional Action Rail.
- Tablet 768-1199px: collapsible sidebar; Action Rail inline/drawer.
- Mobile <= 767px: sidebar sheet trigger; table rows become cards.
- Run detail stream is primary on mobile.

- [ ] **Step 5: Implement accessibility gates**

- Add skip-to-main link in AppShell.
- Ensure drawers/dialogs have title/description and focus return.
- Ensure IconButton requires `aria-label`.
- Add text labels to every status pill.
- Add validation messages with text, not color only.

- [ ] **Step 6: Add visual smoke artifact generation**

In `tests/e2e/web-product-routes.e2e.test.ts`, save screenshots for:

```ts
const viewports = [
  { width: 375, height: 900 },
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1440, height: 1000 },
];
```

Routes:

`/workbench`, `/pipeline`, `/work-items`, `/work-items/wi-1`, `/work-items/wi-1/spec-plan`, `/specs`, `/plans`, `/packages`, `/packages/pkg-1`, `/runs`, `/runs/run-1`, `/reviews`, `/reviews/review-1`, `/releases`, `/releases/rel-1`.

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm vitest run tests/web/a11y-gates.test.tsx tests/web/responsive-layout.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
pnpm vitest run tests/e2e/web-product-routes.e2e.test.ts
pnpm --filter @forgeloop/web build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/routes/pipeline apps/web/src/features/pipeline apps/web/src/shared tests/web/a11y-gates.test.tsx tests/web/responsive-layout.test.tsx tests/e2e/web-product-routes.e2e.test.ts
git commit -m "feat: add pipeline and visual quality gates"
```

---

### Task 11: Delete Legacy Web App Surface And Add No-Legacy Verification

**Files:**
- Delete: `apps/web/src/App.tsx`
- Delete/replace: `apps/web/src/styles.css`
- Delete/replace: old `apps/web/src/api.ts` or old shim files if unused
- Modify: `apps/web/src/app/root.tsx`
- Create: `tests/web/no-legacy-web-ui.test.ts`
- Modify: `tests/web/release-owner-surface.test.tsx`
- Modify: any tests importing `apps/web/src/App`

- [ ] **Step 1: Write failing no-legacy tests**

Create `tests/web/no-legacy-web-ui.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const textFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (path.includes('.react-router')) return [];
    if (statSync(path).isDirectory()) return textFiles(path);
    return /\.(ts|tsx|css)$/.test(path) ? [path] : [];
  });

const sourceText = () =>
  textFiles('apps/web/src')
    .concat(textFiles('tests/web').filter((file) => !file.endsWith('no-legacy-web-ui.test.ts')))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

describe('no legacy Web UI baggage', () => {
  it('does not keep old workbench classes or legacy routes', () => {
    expect(sourceText()).not.toMatch(/workbench-grid|className="panel"|\\.panel\\b|\\/legacy/);
  });

  it('does not import the old monolithic App', () => {
    expect(sourceText()).not.toMatch(/from ['"].*src\\/App['"]/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/web/no-legacy-web-ui.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL while old `App.tsx` / `styles.css` / tests remain.

- [ ] **Step 3: Delete old Web app files**

Delete:

- `apps/web/src/App.tsx`
- `apps/web/src/styles.css`

Remove imports/re-exports that only exist for the old app. Keep only focused shared API files and feature modules.

- [ ] **Step 4: Replace old CSS with token/theme imports**

Ensure `apps/web/src/app/root.tsx` imports only:

```ts
import '../shared/design-system/theme/css-variables.css';
```

No old `.panel`, `.workbench-grid`, or broad debug form-grid selectors remain.

- [ ] **Step 5: Run no-legacy and full Web tests**

Run:

```bash
pnpm vitest run tests/web --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/web build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web/src tests/web
git commit -m "refactor: remove legacy web workbench"
```

---

### Task 12: Final Verification, Full Test Suite, And Delivery Evidence

**Files:**
- Modify if needed: `docs/superpowers/specs/2026-05-18-web-product-ui-architecture-redesign-design.md`
- Create if useful: `docs/superpowers/reports/2026-05-18-web-product-ui-architecture-redesign-delivery.md`

- [ ] **Step 1: Run focused Web verification**

Run:

```bash
pnpm --filter @forgeloop/web typecheck
pnpm --filter @forgeloop/web build
pnpm vitest run tests/web --pool=forks --no-file-parallelism --maxWorkers=1
pnpm e2e:run-console
pnpm vitest run tests/e2e/web-product-routes.e2e.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run backend/query regression suite**

Run:

```bash
pnpm vitest run tests/api/query-module.test.ts tests/api/role-workbenches.test.ts tests/api/release-module.test.ts tests/api/test-acceptance-gate.test.ts tests/api/work-items.test.ts tests/api/spec-plan-service.test.ts tests/api/execution-package-service.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 3: Run full repo verification**

Run:

```bash
pnpm test
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Run no-legacy scans manually**

Run:

```bash
rg -n "workbench-grid|className=\"panel\"|\\.panel\\b|/legacy|Load role queue|Load cockpit|Load replay" apps/web/src tests/web -g '!no-legacy-web-ui.test.ts'
rg -n "label=\"release_id\"|aria-label=\"release_id\"|placeholder=\"release_id\"|>release_id<" apps/web/src tests/web -g '!no-legacy-web-ui.test.ts'
rg -n "from ['\"].*src/App['\"]|<App\\b" apps/web/src tests -g '!no-legacy-web-ui.test.ts'
```

Expected: no matches, except deliberate Dev Tools labels if scoped under `apps/web/src/app/routes/dev-tools` or `apps/web/src/features/dev-tools`.

- [ ] **Step 5: Inspect visual screenshots**

Open the Playwright screenshot output from `tests/e2e/web-product-routes.e2e.test.ts`. Check:

- no horizontal overflow at 375/768/1024/1440;
- no card-in-card page composition;
- no old debug panel styling;
- no clipped buttons/tabs/table cells/action rails;
- no raw controls on product routes;
- focus states visible in captured focus cases.

- [ ] **Step 6: Update delivery report if the project uses one**

If useful, create `docs/superpowers/reports/2026-05-18-web-product-ui-architecture-redesign-delivery.md` with:

```md
# Web Product UI Architecture Redesign Delivery

- Source spec: `docs/superpowers/specs/2026-05-18-web-product-ui-architecture-redesign-design.md`
- Source plan: `docs/superpowers/plans/2026-05-18-web-product-ui-architecture-redesign.md`
- Verification:
  - `pnpm test`
  - `pnpm build`
  - `pnpm e2e:run-console`
  - `pnpm vitest run tests/e2e/web-product-routes.e2e.test.ts`
- No-legacy scan results:
  - old `App.tsx`: removed
  - old `.panel` / `.workbench-grid`: removed
  - `/legacy`: absent
```

- [ ] **Step 7: Commit final evidence**

```bash
git add docs/superpowers/reports/2026-05-18-web-product-ui-architecture-redesign-delivery.md
git commit -m "docs: record web product ui delivery evidence"
```

Skip this commit if no report is created.

---

## Completion Criteria

- React Router Framework Mode is the only Web route/runtime entry.
- No old `App.tsx` workbench, old debug CSS, `/legacy`, old/new UI switch, or manual raw product controls remain.
- Product route coverage exists for Workbench, Pipeline, Work Items, Specs, Plans, Packages, Runs, Reviews, Releases, and gated Dev Tools.
- Pipeline includes Intake, Spec / Plan, Execution, Review, Integration / Cross-end Validation, Test / Acceptance, Release, and Observation.
- Release list/detail includes scope management and Test Acceptance acknowledgement outside Dev Tools.
- Work Item Intake/Brief is represented with truthful backend-gap handling.
- Spec/Plan detail has History / Timeline.
- Dev Tools are hidden unless development or explicit flag enables them.
- Visual, responsive, accessibility, no-legacy, Web build, API regression, and full repo tests pass.
