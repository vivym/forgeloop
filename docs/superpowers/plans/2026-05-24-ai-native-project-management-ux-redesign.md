# AI-Native Project Management UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the remaining generic Task/Work Item product flow with a typed, AI-native project-management loop where source objects create Development Plans, Development Plan Items pass boundary brainstorming, and approved Execution Plan documents drive Codex execution.

**Architecture:** Build contracts and persistence first, then move API gates to Development Plan Item scope, then destructively replace Web routes and UI with the new IA. Public product surfaces use typed refs only; legacy `work_item`, generic `/tasks`, direct source-object Spec/Plan generation, and raw runtime route families are removed from product navigation and product URLs rather than redirected or hidden behind compatibility code.

**Tech Stack:** TypeScript, Zod, NestJS, Drizzle ORM, PostgreSQL, React 19, React Router framework mode, Vite, Tailwind CSS v4, Radix/shadcn-style primitives, lucide-react, TanStack Query, TanStack Table, React Hook Form, MDXEditor, Testing Library, Vitest, Playwright.

---

## Scope Check

This is a large but single product-closure subsystem. Splitting it into independent PRs is allowed only if every PR leaves a runnable product surface and the final PR deletes the old surfaces. Do not ship a partial branch that keeps `/tasks`, public `work_item` refs, direct `POST /work-items/:id/specs`, direct `POST /work-items/:id/plans`, or top-level `/plans` route compatibility.

Resolved implementation questions:

- Development Plan Item detail is a full deep-linkable page from day one. A drawer can be added later, but commands and reviews must work through stable URLs first.
- Context manifests are persisted as first-class product records with deterministic local collectors in this slice. Raw Codex transcript storage is deferred, but gates must never depend on unavailable raw transcript data.
- The existing `Task` model is retired from product IA. If old task-shaped records are needed for migration or dev diagnostics, they are accessible only through explicit Dev Tools paths and are not referenced by product navigation, queue DTOs, or product links.
- Public `plan` naming becomes `execution_plan` / `execution_plan_revision` in contracts and routes. `Development Plan` always means the product planning table.

## Source Spec

- `docs/superpowers/specs/2026-05-23-ai-native-project-management-ux-redesign-design.md`

## Existing Structure To Understand First

- Web route config: `apps/web/src/app/routes.ts`
- Web product shell: `apps/web/src/app/routes/_layout.tsx`
- Current Dashboard placeholder: `apps/web/src/app/routes/dashboard/index.tsx`
- Current source object pages: `apps/web/src/features/requirements/requirements-routes.tsx`, `apps/web/src/features/bugs/bugs-routes.tsx`, `apps/web/src/features/tech-debt/tech-debt-routes.tsx`, `apps/web/src/features/initiatives/initiatives-routes.tsx`
- Current generic object layout: `apps/web/src/features/project-management/object-detail-layout.tsx`
- Current Spec/Plan UI: `apps/web/src/features/spec-plan/specs-plans-route.tsx`, `apps/web/src/features/spec-plan/spec-plan-direct-routes.tsx`, `apps/web/src/features/spec-plan/spec-plan-lifecycle-actions.tsx`
- Current product Task UI to retire: `apps/web/src/features/tasks/tasks-routes.tsx`, `apps/web/src/features/tasks/task-evidence-routes.tsx`
- Current direct routes to retire or replace: `/tasks/**`, `/plans/**`, `/specs/**`, `/requirements/:id/spec`, `/requirements/:id/plan`
- Current direct API to retire: `apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts`
- Current Spec/Plan service tied to Work Item storage: `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`
- Current Task API to remove from product surface: `apps/control-plane-api/src/modules/tasks/tasks.controller.ts`, `apps/control-plane-api/src/modules/tasks/tasks.service.ts`
- Public refs and project-management schemas: `packages/contracts/src/product-object-ref.ts`, `packages/contracts/src/project-management.ts`
- Domain types and transitions: `packages/domain/src/types.ts`, `packages/domain/src/states.ts`, `packages/domain/src/task.ts`
- DB schemas: `packages/db/src/schema/work-item.ts`, `packages/db/src/schema/spec.ts`, `packages/db/src/schema/plan.ts`, `packages/db/src/schema/task.ts`, `packages/db/src/schema/execution-package.ts`
- Repository interfaces and implementations: `packages/db/src/repositories/delivery-repository.ts`, `packages/db/src/repositories/in-memory-delivery-repository.ts`, `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Query projections: `packages/db/src/queries/project-management-queries.ts`, `packages/db/src/queries/web-product-queries.ts`, `packages/db/src/queries/product-lane-queries.ts`
- Web API clients: `apps/web/src/shared/api/types.ts`, `apps/web/src/shared/api/query.ts`, `apps/web/src/shared/api/commands.ts`, `apps/web/src/shared/api/hooks.ts`, `apps/web/src/shared/api/query-keys.ts`
- Shared visual primitives: `apps/web/src/shared/layout/**`, `apps/web/src/shared/ui/**`
- Focused tests to update: `tests/contracts/project-management-contracts.test.ts`, `tests/api/spec-plan-service.test.ts`, `tests/api/tasks.test.ts`, `tests/api/project-management-query.test.ts`, `tests/web/project-management-routes.test.tsx`, `tests/web/app-shell-routing.test.tsx`, `tests/web/responsive-layout.test.tsx`, `tests/web/spec-plan-lifecycle-actions.test.tsx`, `tests/e2e/web-product-routes.e2e.test.ts`

## Target File Structure

### Contracts

- Modify: `packages/contracts/src/product-object-ref.ts`
  - Public product refs include source objects, Development Plan, Development Plan Item, Brainstorming Session, Boundary Summary, Spec, Spec Revision, Execution Plan, Execution Plan Revision, Execution, Code Review Handoff, QA Handoff, Release, and Attachment.
  - Public product refs do not include `work_item`, `task`, `plan`, `execution_package`, `run_session`, or `review_packet`.
  - Create separate internal/dev-only refs for raw runtime evidence if existing modules still need them.
- Create: `packages/contracts/src/ai-project-management.ts`
  - Owns Development Plan, Development Plan Item, Brainstorming Session, Boundary Summary, Context Manifest, Execution, Code Review Handoff, QA Handoff, queue, command, and route DTO schemas.
- Modify: `packages/contracts/src/project-management.ts`
  - Remove public Task list/detail models from product queues.
  - Add Dashboard, source-object detail relationship, My Work, Board, and Reports projections for Development Plans, Specs & Execution Plans, Executions, QA, Release, and Evidence.
- Modify: `packages/contracts/src/web-product-query.ts`
  - Replace old `plan`/raw runtime product rows with Development Plan, Execution Plan, and Execution rows.
- Modify: `packages/contracts/src/index.ts`
  - Export the new contract module.

Core contract shape to implement:

```ts
const sourceObjectRefOptions = [
  z.object({ type: z.literal('initiative'), id: nonEmpty, revision_id: nonEmpty.optional(), title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('requirement'), id: nonEmpty, revision_id: nonEmpty.optional(), title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('bug'), id: nonEmpty, revision_id: nonEmpty.optional(), title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('tech_debt'), id: nonEmpty, revision_id: nonEmpty.optional(), title: nonEmpty.optional() }).strict(),
] as const;

export const sourceObjectRefSchema = z.discriminatedUnion('type', sourceObjectRefOptions);

export const productObjectRefSchema = z.discriminatedUnion('type', [
  ...sourceObjectRefOptions,
  z.object({ type: z.literal('development_plan'), id: nonEmpty, revision_id: nonEmpty.optional(), title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('development_plan_item'), id: nonEmpty, development_plan_id: nonEmpty, revision_id: nonEmpty.optional(), title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('brainstorming_session'), id: nonEmpty, revision_id: nonEmpty.optional(), title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('boundary_summary'), id: nonEmpty, revision_id: nonEmpty.optional(), title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('spec'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('spec_revision'), id: nonEmpty, spec_id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('execution_plan'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('execution_plan_revision'), id: nonEmpty, execution_plan_id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('execution'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('code_review_handoff'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('qa_handoff'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('release'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('attachment'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
]);
```

### Domain And DB

- Create: `packages/domain/src/development-plan.ts`
  - Owns Development Plan, item, revision, gate status, role lens, and status transition types.
- Create: `packages/domain/src/brainstorming.ts`
  - Owns Brainstorming Session and Boundary Summary domain types.
- Create: `packages/domain/src/execution-supervision.ts`
  - Owns product `Execution`, Code Review Handoff, and QA Handoff domain types.
- Modify: `packages/domain/src/types.ts`
  - Remove public reliance on `Plan` as product Execution Plan naming. Keep any old shape internal until all callers move, then delete exports.
- Modify: `packages/domain/src/states.ts`
  - Add explicit gate helpers:
    - `canGenerateSpecFromPlanItem(item, brainstorming, boundary)`
    - `canGenerateExecutionPlanFromPlanItem(item, spec)`
    - `canStartExecutionFromPlanItem(item, executionPlan)`
- Modify: `packages/domain/src/index.ts`
  - Export new types and helpers.
- Create: `packages/db/src/schema/development-plan.ts`
  - Tables: `development_plans`, `development_plan_source_links`, `development_plan_revisions`, `development_plan_items`, `development_plan_item_revisions`.
- Create: `packages/db/src/schema/brainstorming.ts`
  - Tables: `brainstorming_sessions`, `brainstorming_questions`, `brainstorming_answers`, `brainstorming_decisions`, `boundary_summaries`, `boundary_summary_revisions`.
- Create: `packages/db/src/schema/context-manifest.ts`
  - Table: `context_manifests`.
- Create: `packages/db/src/schema/execution-plan.ts`
  - Tables: `execution_plans`, `execution_plan_revisions`.
- Create: `packages/db/src/schema/execution-supervision.ts`
  - Tables: `executions`, `code_review_handoffs`, `qa_handoffs`.
- Modify: `packages/db/src/schema/spec.ts`
  - Add nullable `developmentPlanId`, `developmentPlanItemId`, `boundarySummaryId`, `contextManifestId`.
  - Make new creation paths require Development Plan Item linkage in service/domain tests.
- Modify: `packages/db/src/schema/execution-package.ts`
  - Add nullable `developmentPlanItemId`, `executionPlanRevisionId`, and `executionId`.
  - Stop product projections from using `taskId`.
- Modify: `packages/db/src/schema/index.ts`
  - Export all new schemas.
- Modify: `packages/db/src/repositories/delivery-repository.ts`
  - Add Development Plan, Development Plan Item revision, source link, brainstorming, Boundary Summary revision, context manifest, execution plan, execution, review handoff, and QA handoff methods.
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
  - Implement new repository methods with clone-on-read/write.
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
  - Implement new repository methods using Drizzle tables.

### API

- Create: `apps/control-plane-api/src/modules/development-plans/development-plans.controller.ts`
- Create: `apps/control-plane-api/src/modules/development-plans/development-plans.service.ts`
- Create: `apps/control-plane-api/src/modules/development-plans/development-plans.module.ts`
  - Owns manual create, source-object link/unlink, AI-assisted draft generation, and explicit regeneration with feedback.
- Create: `apps/control-plane-api/src/modules/brainstorming/brainstorming.controller.ts`
- Create: `apps/control-plane-api/src/modules/brainstorming/brainstorming.service.ts`
- Create: `apps/control-plane-api/src/modules/brainstorming/brainstorming.module.ts`
- Create: `apps/control-plane-api/src/modules/executions/executions.controller.ts`
- Create: `apps/control-plane-api/src/modules/executions/executions.service.ts`
- Create: `apps/control-plane-api/src/modules/executions/executions.module.ts`
  - Owns execution start/continue/interrupt plus code-review handoff and QA handoff commands.
- Modify: `apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts`
  - Delete direct `POST work-items/:workItemId/specs`.
  - Delete direct `POST work-items/:workItemId/plans`.
  - Replace direct draft generation with item-scoped routes.
- Modify: `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`
  - Generate Spec only from approved Boundary Summary.
  - Generate Execution Plan document only from approved Spec revision.
  - Persist context manifest chain before returning generated revisions.
- Modify: `apps/control-plane-api/src/modules/tasks/tasks.controller.ts`
  - Remove from product module routing or move to `dev-tools/tasks` behind `devToolsEnabled`.
- Modify: `apps/control-plane-api/src/modules/query/query.controller.ts`
  - Add query routes for Dashboard, Development Plans, Development Plan Items, Specs & Execution Plans queue, Executions queue, My Work, Board, and Reports.
  - Remove product query routes for `/query/tasks/**`.
- Modify: `apps/control-plane-api/src/app.module.ts`
  - Import new modules and remove product Task module if no longer needed.

### Web

- Modify: `apps/web/src/app/routes.ts`
  - Add `/development-plans/**` and `/executions/**`.
  - Remove product `/tasks/**`, `/specs/**`, `/plans/**`, `/requirements/:id/spec`, `/requirements/:id/plan`.
- Modify: `apps/web/src/app/routes/_layout.tsx`
  - Navigation groups: Home, Discovery, Planning, Delivery, Intelligence.
  - Add Development Plans and Executions.
  - Remove Tasks.
- Modify: `apps/web/src/app/routes/dashboard/index.tsx`
  - Replace placeholder dashboard with a product health cockpit over typed AI-native delivery objects.
- Create: `apps/web/src/features/development-plans/development-plans-route.tsx`
- Create: `apps/web/src/features/development-plans/development-plan-detail-route.tsx`
- Create: `apps/web/src/features/development-plans/development-plan-item-detail-route.tsx`
- Create: `apps/web/src/features/development-plans/development-plan-table.tsx`
- Create: `apps/web/src/features/development-plans/plan-item-gates.tsx`
- Create: `apps/web/src/features/brainstorming/brainstorming-panel.tsx`
- Create: `apps/web/src/features/executions/executions-route.tsx`
- Create: `apps/web/src/features/executions/execution-detail-route.tsx`
- Create: `apps/web/src/features/code-review/code-review-handoff-panel.tsx`
- Create: `apps/web/src/features/qa/qa-handoff-panel.tsx`
- Create: `apps/web/src/features/spec-plan/spec-execution-plan-queue.tsx`
- Modify: `apps/web/src/features/my-work/my-work-route.tsx`
  - Render the default role-aware inbox with source objects, Development Plan Items, Execution Plans, Executions, Code Review Handoffs, QA Handoffs, and Releases.
- Create: `apps/web/src/features/dashboard/dashboard-route.tsx`
  - Render flow health, blocked work, aging, role load, release confidence, and report links without generic Work Item/Task assumptions.
- Modify: `apps/web/src/features/board/board-route.tsx`
  - Render a mixed-type board that does not assume source objects and Development Plan Items share the same schema.
- Modify: `apps/web/src/features/reports/reports-routes.tsx`
  - Render Development Plan throughput, brainstorming bottleneck, Spec/Execution Plan review aging, execution continuation, code review, QA handoff, and release readiness panels.
- Modify: `apps/web/src/features/project-management/object-detail-layout.tsx`
  - Replace generic metadata card pattern with object workspace header, role lens segmented control, relationship tabs, primary document column, structured panel, and action rail.
- Modify: source object routes under `apps/web/src/features/requirements`, `apps/web/src/features/bugs`, `apps/web/src/features/tech-debt`, `apps/web/src/features/initiatives`
  - Relationship projections link to Development Plan Item gate surfaces.
  - No direct generate Spec/Execution Plan actions.
- Delete product Task feature routes:
  - `apps/web/src/features/tasks/tasks-routes.tsx`
  - `apps/web/src/features/tasks/task-evidence-routes.tsx`
- Modify Web API clients:
  - `apps/web/src/shared/api/types.ts`
  - `apps/web/src/shared/api/query.ts`
  - `apps/web/src/shared/api/commands.ts`
  - `apps/web/src/shared/api/hooks.ts`
  - `apps/web/src/shared/api/query-keys.ts`
- Modify tests and fixtures:
  - `tests/web/fixtures/product-data.ts`
  - `tests/web/router-test-utils.tsx`
  - `tests/web/ai-native-surface-states.test.tsx`

### Required Surface States

Every major Web surface must implement and test these states:

- loading;
- empty;
- error;
- stale;
- blocked;
- approved;
- running;
- interrupted/resumable.

Applies to:

- Source Object Workspace;
- Dashboard;
- Development Plan Page;
- Development Plan Item Detail;
- Specs & Execution Plans Queue;
- Executions Queue and Execution Detail;
- My Work;
- Board;
- Reports.

## Implementation Rules

- Do not add compatibility redirects from old product routes.
- Do not keep a primary `Tasks` navigation item.
- Do not use `Work Item Owner`, `owner_actor_id`, or public `work_item` refs in product DTOs, UI copy, queue rows, action payloads, or route links. Existing Project owner and Release Owner terminology is allowed only in their existing domains.
- Do not call a Development Plan Item a Task in product UI.
- Do not expose raw Execution Packages, Run Sessions, Review Packets, Replay, or traces as primary navigation.
- Use Tailwind classes through shared primitives. Limit vanilla CSS to global tokens and MDXEditor integration.
- Use lucide icons inside action buttons. No emoji icons.
- Use MDXEditor only through `ForgeMarkdownEditor`.
- Every task below ends with a focused commit unless the step explicitly says to wait for the next task.

## Task 0: Baseline And Branch Safety

**Files:**
- Read: `docs/superpowers/specs/2026-05-23-ai-native-project-management-ux-redesign-design.md`
- Read: `apps/web/src/app/routes.ts`
- Read: `apps/web/src/app/routes/dashboard/index.tsx`
- Read: `apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts`
- Read: `packages/contracts/src/product-object-ref.ts`
- Read: `tests/web/project-management-routes.test.tsx`

- [ ] **Step 1: Confirm branch and clean worktree**

Run:

```bash
git status --short --branch
```

Expected: implementation branch is active and no unrelated uncommitted changes are present.

- [ ] **Step 2: Run the focused current baseline**

Run:

```bash
pnpm vitest run tests/contracts/project-management-contracts.test.ts tests/api/spec-plan-service.test.ts tests/web/project-management-routes.test.tsx tests/web/app-shell-routing.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS on the starting branch. If it fails before edits, record the failing test and do not change implementation until the pre-existing failure is understood.

- [ ] **Step 3: Confirm current legacy product surfaces**

Run:

```bash
rg -n "\"/tasks|path: 'tasks'|work-items/.*/specs|work-items/.*/plans|owner_actor_id|type: z.literal\\('task'\\)|type: z.literal\\('plan'\\)" apps packages tests
```

Expected: matches exist. Use this as the cleanup checklist for later tasks.

## Task 1: Public Contract Model For AI-Native Project Management

**Files:**
- Modify: `packages/contracts/src/product-object-ref.ts`
- Create: `packages/contracts/src/ai-project-management.ts`
- Modify: `packages/contracts/src/project-management.ts`
- Modify: `packages/contracts/src/web-product-query.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `tests/contracts/project-management-contracts.test.ts`

- [ ] **Step 1: Write failing contract tests for public refs**

Add assertions to `tests/contracts/project-management-contracts.test.ts`:

```ts
it('uses AI-native typed product refs and rejects legacy task/plan/work_item refs', () => {
  expect(productObjectRefSchema.parse({ type: 'development_plan', id: 'dp-1' })).toMatchObject({ type: 'development_plan' });
  expect(productObjectRefSchema.parse({ type: 'development_plan_item', id: 'dpi-1', development_plan_id: 'dp-1' })).toMatchObject({
    type: 'development_plan_item',
  });
  expect(productObjectRefSchema.parse({ type: 'execution_plan_revision', id: 'epr-1', execution_plan_id: 'ep-1' })).toMatchObject({
    type: 'execution_plan_revision',
  });
  expect(() => productObjectRefSchema.parse({ type: 'work_item', id: 'wi-1' })).toThrow();
  expect(() => productObjectRefSchema.parse({ type: 'task', id: 'task-1' })).toThrow();
  expect(() => productObjectRefSchema.parse({ type: 'plan', id: 'plan-1' })).toThrow();
});
```

Import `productObjectRefSchema` from `@forgeloop/contracts`.

- [ ] **Step 2: Write failing contract tests for Development Plan and brainstorming**

Add:

```ts
it('requires persisted brainstorming evidence before a boundary can approve Spec generation', () => {
  const session = brainstormingSessionSchema.parse({
    id: 'bs-1',
    revision_id: 'bs-rev-1',
    source_ref: { type: 'requirement', id: 'req-1', revision_id: 'req-rev-1' },
    development_plan_id: 'dp-1',
    development_plan_item_id: 'dpi-1',
    development_plan_item_revision_id: 'dpi-rev-1',
    context_manifest_id: 'cm-1',
    context_manifest_revision_id: 'cm-rev-1',
    questions: [{ id: 'q-1', text: 'Which repo is in scope?', author_id: 'codex-runtime', created_at: '2026-05-24T00:00:00.000Z', status: 'answered' }],
    answers: [{ id: 'a-1', question_id: 'q-1', text: 'Only apps/web.', actor_id: 'actor-tech', created_at: '2026-05-24T00:01:00.000Z' }],
    decisions: [{ id: 'd-1', text: 'Keep backend out of scope.', actor_id: 'actor-tech', rationale: 'UI-only item.', created_at: '2026-05-24T00:02:00.000Z' }],
    approval_state: 'approved',
    boundary_summary_id: 'boundary-1',
    approver_actor_id: 'actor-tech',
    approved_at: '2026-05-24T00:03:00.000Z',
  });
  expect(session.approval_state).toBe('approved');
});

it('rejects boundary approval without recorded questions, answers, and decisions', () => {
  expect(() =>
    brainstormingSessionSchema.parse({
      id: 'bs-1',
      revision_id: 'bs-rev-1',
      source_ref: { type: 'requirement', id: 'req-1' },
      development_plan_id: 'dp-1',
      development_plan_item_id: 'dpi-1',
      development_plan_item_revision_id: 'dpi-rev-1',
      context_manifest_id: 'cm-1',
      context_manifest_revision_id: 'cm-rev-1',
      questions: [],
      answers: [],
      decisions: [],
      approval_state: 'approved',
      boundary_summary_id: 'boundary-1',
      approver_actor_id: 'actor-tech',
      approved_at: '2026-05-24T00:03:00.000Z',
    }),
  ).toThrow(/questions/i);
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm vitest run tests/contracts/project-management-contracts.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because schemas do not exist or still accept old refs.

- [ ] **Step 4: Implement contract schemas**

Create `packages/contracts/src/ai-project-management.ts` with these exported schemas and types:

```ts
export const developmentPlanStatusSchema = z.enum(['draft', 'active', 'approved', 'archived']);
export const developmentPlanItemBoundaryStatusSchema = z.enum(['not_started', 'in_progress', 'approved', 'changes_requested', 'stale']);
export const artifactReviewStatusSchema = z.enum(['missing', 'draft', 'in_review', 'approved', 'changes_requested', 'stale', 'blocked']);
export const executionStatusSchema = z.enum(['not_started', 'ready', 'running', 'paused', 'interrupted', 'failed', 'completed', 'awaiting_code_review', 'qa_handoff_pending']);

export const contextManifestSchema = z.object({
  id: nonEmpty,
  revision_id: nonEmpty,
  source_ref: sourceObjectRefSchema,
  development_plan_id: nonEmpty.optional(),
  development_plan_revision_id: nonEmpty.optional(),
  development_plan_item_id: nonEmpty.optional(),
  development_plan_item_revision_id: nonEmpty.optional(),
  brainstorming_session_id: nonEmpty.optional(),
  brainstorming_session_revision_id: nonEmpty.optional(),
  boundary_summary_id: nonEmpty.optional(),
  boundary_summary_revision_id: nonEmpty.optional(),
  boundary_approver_actor_id: nonEmpty.optional(),
  boundary_approved_at: isoDateTimeSchema.optional(),
  approved_spec_revision_id: nonEmpty.optional(),
  sources: z.array(z.object({ type: nonEmpty, ref: nonEmpty, digest: nonEmpty.optional() }).strict()).default([]),
  generated_at: isoDateTimeSchema,
  runtime_identity: nonEmpty.optional(),
}).strict();

export const developmentPlanItemSchema = z.object({
  id: nonEmpty,
  development_plan_id: nonEmpty,
  revision_id: nonEmpty,
  title: nonEmpty,
  summary: nonEmpty,
  driver_actor_id: nonEmpty.optional(),
  responsible_role: z.enum(['product', 'tech_lead', 'developer', 'qa', 'release_owner', 'manager']),
  reviewer_actor_id: nonEmpty.optional(),
  risk: z.enum(['low', 'medium', 'high', 'critical']),
  dependency_hints: z.array(nonEmpty).default([]),
  affected_surfaces: z.array(nonEmpty).default([]),
  boundary_status: developmentPlanItemBoundaryStatusSchema,
  spec_status: artifactReviewStatusSchema,
  execution_plan_status: artifactReviewStatusSchema,
  execution_status: executionStatusSchema,
  review_status: artifactReviewStatusSchema,
  qa_handoff_status: artifactReviewStatusSchema,
  release_impact: z.enum(['none', 'release_scoped', 'release_blocking']),
  next_action: nonEmpty,
  updated_at: isoDateTimeSchema,
}).strict();
```

Add `superRefine` checks so approved brainstorming requires at least one question, one answer, one decision, `boundary_summary_id`, approver, and `approved_at`.

- [ ] **Step 5: Remove old public Task/Plan refs from product refs**

In `packages/contracts/src/product-object-ref.ts`, keep raw runtime refs only in a separate exported internal schema:

```ts
export const runtimeEvidenceObjectRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('execution_package'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('run_session'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('review_packet'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
]);
```

Do not include these in `productObjectRefSchema`.

- [ ] **Step 6: Run contract tests**

Run:

```bash
pnpm vitest run tests/contracts/project-management-contracts.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src tests/contracts/project-management-contracts.test.ts
git commit -m "feat: define ai-native project management contracts"
```

## Task 2: Domain, DB Schema, And Repository Persistence

**Files:**
- Create: `packages/domain/src/development-plan.ts`
- Create: `packages/domain/src/brainstorming.ts`
- Create: `packages/domain/src/execution-supervision.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/src/states.ts`
- Create: `packages/db/src/schema/development-plan.ts`
- Create: `packages/db/src/schema/brainstorming.ts`
- Create: `packages/db/src/schema/context-manifest.ts`
- Create: `packages/db/src/schema/execution-plan.ts`
- Create: `packages/db/src/schema/execution-supervision.ts`
- Modify: `packages/db/src/schema/spec.ts`
- Modify: `packages/db/src/schema/execution-package.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Test: `tests/db/schema.test.ts`
- Test: `tests/db/repository.test.ts`
- Test: `tests/db/repository-contract.ts`

DB migration note: this repo currently uses Drizzle TypeScript schema as the local source of truth and does not keep checked-in Drizzle SQL migration files. Do not invent a new migrations directory in this task. Verify durable schema compatibility with `pnpm db:push` against a disposable local database after the schema files compile.

- [ ] **Step 1: Write failing repository contract tests**

In `tests/db/repository-contract.ts`, add a reusable test:

```ts
export function itPersistsAiNativePlanningGraph(factory: RepositoryFactory) {
  it('persists Development Plan, Item, brainstorming, boundary, execution plan, and execution linkage', async () => {
    const repository = await factory();
    await repository.saveContextManifest(contextManifestFixture({ id: 'cm-1', revision_id: 'cm-rev-1' }));
    await repository.saveDevelopmentPlan(developmentPlanFixture({ id: 'dp-1' }));
    await repository.saveDevelopmentPlanSourceLink({
      id: 'dp-link-1',
      development_plan_id: 'dp-1',
      source_ref: { type: 'requirement', id: 'req-1', revision_id: 'req-rev-1' },
      link_type: 'primary',
      created_by_actor_id: 'actor-product',
      created_at: '2026-05-24T00:00:00.000Z',
    });
    await repository.saveDevelopmentPlanSourceLink({
      id: 'dp-link-2',
      development_plan_id: 'dp-1',
      source_ref: { type: 'bug', id: 'bug-1', revision_id: 'bug-rev-1' },
      link_type: 'related',
      created_by_actor_id: 'actor-product',
      created_at: '2026-05-24T00:01:00.000Z',
    });
    await repository.saveDevelopmentPlanItem(developmentPlanItemFixture({ id: 'dpi-1', development_plan_id: 'dp-1' }));
    await repository.saveDevelopmentPlanItemRevision(developmentPlanItemRevisionFixture({
      id: 'dpi-rev-1',
      development_plan_item_id: 'dpi-1',
      development_plan_id: 'dp-1',
      revision_number: 1,
      change_reason: 'Initial generated row',
      edited_by_actor_id: 'actor-tech',
      created_at: '2026-05-24T00:02:00.000Z',
    }));
    await repository.saveDevelopmentPlanItemRevision(developmentPlanItemRevisionFixture({
      id: 'dpi-rev-2',
      development_plan_item_id: 'dpi-1',
      development_plan_id: 'dp-1',
      revision_number: 2,
      change_reason: 'Boundary refinement',
      edited_by_actor_id: 'actor-tech',
      created_at: '2026-05-24T00:03:00.000Z',
    }));
    await repository.saveBrainstormingSession(brainstormingSessionFixture({ id: 'bs-1', development_plan_item_id: 'dpi-1' }));
    await repository.saveBoundarySummary(boundarySummaryFixture({ id: 'boundary-1', brainstorming_session_id: 'bs-1', development_plan_item_id: 'dpi-1' }));
    await repository.saveBoundarySummaryRevision(boundarySummaryRevisionFixture({
      id: 'boundary-rev-1',
      boundary_summary_id: 'boundary-1',
      brainstorming_session_id: 'bs-1',
      development_plan_item_id: 'dpi-1',
      revision_number: 1,
      decision_count: 2,
      approved_by_actor_id: 'actor-tech-lead',
      approved_at: '2026-05-24T00:04:00.000Z',
    }));
    await repository.saveSpec(specFixture({ id: 'spec-1', development_plan_item_id: 'dpi-1', boundary_summary_id: 'boundary-1' }));
    await repository.saveSpecRevision(specRevisionFixture({ id: 'spec-rev-1', spec_id: 'spec-1', development_plan_item_id: 'dpi-1', context_manifest_id: 'cm-1' }));
    await repository.saveExecutionPlan(executionPlanFixture({ id: 'ep-1', development_plan_item_id: 'dpi-1' }));
    await repository.saveExecutionPlanRevision(executionPlanRevisionFixture({ id: 'epr-1', execution_plan_id: 'ep-1', based_on_spec_revision_id: 'spec-rev-1' }));
    await repository.saveExecution(executionFixture({ id: 'exec-1', execution_plan_revision_id: 'epr-1', development_plan_item_id: 'dpi-1' }));

    expect(await repository.getDevelopmentPlanItem('dpi-1')).toMatchObject({ id: 'dpi-1', development_plan_id: 'dp-1' });
    expect(await repository.listDevelopmentPlanSourceLinksForSource({ type: 'bug', id: 'bug-1' })).toEqual([
      expect.objectContaining({ development_plan_id: 'dp-1', link_type: 'related' }),
    ]);
    expect(await repository.listDevelopmentPlanSourceLinks('dp-1')).toHaveLength(2);
    expect(await repository.listDevelopmentPlanItemRevisions('dpi-1')).toEqual([
      expect.objectContaining({ id: 'dpi-rev-1', revision_number: 1 }),
      expect.objectContaining({ id: 'dpi-rev-2', revision_number: 2 }),
    ]);
    expect(await repository.compareDevelopmentPlanItemRevisions({ base_revision_id: 'dpi-rev-1', compare_revision_id: 'dpi-rev-2' })).toMatchObject({
      base_revision_id: 'dpi-rev-1',
      compare_revision_id: 'dpi-rev-2',
    });
    expect(await repository.getBoundarySummary('boundary-1')).toMatchObject({ development_plan_item_id: 'dpi-1' });
    expect(await repository.listBoundarySummaryRevisions('boundary-1')).toEqual([
      expect.objectContaining({ id: 'boundary-rev-1', revision_number: 1 }),
    ]);
    expect(await repository.compareBoundarySummaryRevisions({ base_revision_id: 'boundary-rev-1', compare_revision_id: 'boundary-rev-1' })).toMatchObject({
      base_revision_id: 'boundary-rev-1',
      compare_revision_id: 'boundary-rev-1',
    });
    expect(await repository.getExecution('exec-1')).toMatchObject({ execution_plan_revision_id: 'epr-1' });
  });
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm vitest run tests/db/repository.test.ts tests/db/schema.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because repository methods and schemas do not exist.

- [ ] **Step 3: Implement domain types and gate helpers**

Use narrow pure helpers:

```ts
export function canGenerateSpecFromPlanItem(input: {
  item: DevelopmentPlanItem;
  brainstormingSession?: BrainstormingSession;
  boundarySummary?: BoundarySummary;
}): GateResult {
  if (input.item.boundary_status !== 'approved') return { ok: false, reason: 'boundary_not_approved' };
  if (input.brainstormingSession?.approval_state !== 'approved') return { ok: false, reason: 'brainstorming_not_approved' };
  if (input.boundarySummary?.approval_actor_id === undefined) return { ok: false, reason: 'boundary_summary_missing_approval' };
  return { ok: true };
}
```

Add analogous helpers for Execution Plan generation and execution start.

- [ ] **Step 4: Implement Drizzle schemas**

Use JSONB for structured lists and typed refs. Every product object table must have `createdAt` and `updatedAt`; revision tables must have immutable `revisionNumber`.

Critical columns:

```ts
export const development_plan_items = pgTable('development_plan_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  developmentPlanId: uuid('development_plan_id').notNull(),
  sourceRef: jsonb('source_ref').$type<SourceObjectRef>().notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  driverActorId: uuid('driver_actor_id').references(() => actors.id),
  responsibleRole: text('responsible_role').notNull(),
  reviewerActorId: uuid('reviewer_actor_id').references(() => actors.id),
  risk: text('risk').notNull(),
  boundaryStatus: text('boundary_status').notNull(),
  specStatus: text('spec_status').notNull(),
  executionPlanStatus: text('execution_plan_status').notNull(),
  executionStatus: text('execution_status').notNull(),
  reviewStatus: text('review_status').notNull(),
  qaHandoffStatus: text('qa_handoff_status').notNull(),
  releaseImpact: text('release_impact').notNull(),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});

export const development_plan_source_links = pgTable('development_plan_source_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  developmentPlanId: uuid('development_plan_id').notNull(),
  sourceRef: jsonb('source_ref').$type<SourceObjectRef>().notNull(),
  linkType: text('link_type').notNull(),
  rationale: text('rationale'),
  createdByActorId: uuid('created_by_actor_id').references(() => actors.id),
  createdAt: timestampColumn('created_at').notNull(),
});

export const boundary_summary_revisions = pgTable('boundary_summary_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  boundarySummaryId: uuid('boundary_summary_id').notNull(),
  brainstormingSessionId: uuid('brainstorming_session_id').notNull(),
  developmentPlanItemId: uuid('development_plan_item_id').notNull(),
  revisionNumber: integer('revision_number').notNull(),
  summaryMarkdown: text('summary_markdown').notNull(),
  decisionSnapshot: jsonb('decision_snapshot').$type<BrainstormingDecision[]>().notNull(),
  approvedByActorId: uuid('approved_by_actor_id').references(() => actors.id),
  approvedAt: timestampColumn('approved_at'),
  createdAt: timestampColumn('created_at').notNull(),
});
```

- [ ] **Step 5: Implement repository interface and in-memory methods**

Add methods such as:

```ts
saveDevelopmentPlan(plan: DevelopmentPlan): Promise<void>;
getDevelopmentPlan(id: string): Promise<DevelopmentPlan | undefined>;
listDevelopmentPlans(projectId: string): Promise<DevelopmentPlan[]>;
saveDevelopmentPlanSourceLink(link: DevelopmentPlanSourceLink): Promise<void>;
listDevelopmentPlanSourceLinks(developmentPlanId: string): Promise<DevelopmentPlanSourceLink[]>;
listDevelopmentPlanSourceLinksForSource(sourceRef: SourceObjectRef): Promise<DevelopmentPlanSourceLink[]>;
saveDevelopmentPlanItem(item: DevelopmentPlanItem): Promise<void>;
getDevelopmentPlanItem(id: string): Promise<DevelopmentPlanItem | undefined>;
listDevelopmentPlanItems(developmentPlanId: string): Promise<DevelopmentPlanItem[]>;
saveDevelopmentPlanItemRevision(revision: DevelopmentPlanItemRevision): Promise<void>;
listDevelopmentPlanItemRevisions(itemId: string): Promise<DevelopmentPlanItemRevision[]>;
compareDevelopmentPlanItemRevisions(query: RevisionCompareQuery): Promise<StructuredRevisionDiff>;
saveBrainstormingSession(session: BrainstormingSession): Promise<void>;
saveBoundarySummary(summary: BoundarySummary): Promise<void>;
saveBoundarySummaryRevision(revision: BoundarySummaryRevision): Promise<void>;
listBoundarySummaryRevisions(boundarySummaryId: string): Promise<BoundarySummaryRevision[]>;
compareBoundarySummaryRevisions(query: RevisionCompareQuery): Promise<StructuredRevisionDiff>;
saveExecutionPlan(plan: ExecutionPlanDocument): Promise<void>;
saveExecutionPlanRevision(revision: ExecutionPlanRevision): Promise<void>;
saveExecution(execution: Execution): Promise<void>;
```

Use `clone()` on every in-memory read/write.

- [ ] **Step 6: Implement Drizzle methods**

Map camelCase domain fields to snake_case schema columns consistently. Keep reads sorted by `createdAt` or `updatedAt` where queues depend on order.

- [ ] **Step 7: Run DB tests**

Run:

```bash
pnpm vitest run tests/db/repository.test.ts tests/db/schema.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 8: Verify Drizzle schema push against a disposable DB**

Use the repo's existing schema-push workflow, not a generated SQL migration file:

```bash
FORGELOOP_DATABASE_URL=postgres://forgeloop:forgeloop@127.0.0.1:<free-port>/forgeloop_ai_native pnpm db:push
```

Expected: PASS and Drizzle accepts the new tables/columns. If no disposable PostgreSQL is available, document the skipped durable push in the task notes and keep the in-memory/repository contract tests green.

- [ ] **Step 9: Commit**

```bash
git add packages/domain/src packages/db/src tests/db
git commit -m "feat: persist development planning graph"
```

## Task 3: Development Plan And Boundary Brainstorming API

**Files:**
- Create: `apps/control-plane-api/src/modules/development-plans/development-plans.controller.ts`
- Create: `apps/control-plane-api/src/modules/development-plans/development-plans.service.ts`
- Create: `apps/control-plane-api/src/modules/development-plans/development-plans.module.ts`
- Create: `apps/control-plane-api/src/modules/brainstorming/brainstorming.controller.ts`
- Create: `apps/control-plane-api/src/modules/brainstorming/brainstorming.service.ts`
- Create: `apps/control-plane-api/src/modules/brainstorming/brainstorming.module.ts`
- Modify: `apps/control-plane-api/src/app.module.ts`
- Test: `tests/api/development-plans.test.ts`
- Test: `tests/api/brainstorming.test.ts`

- [ ] **Step 1: Write failing API tests for manual Development Plan authoring**

Create `tests/api/development-plans.test.ts`:

```ts
it('creates a Development Plan from a Requirement and manually adds a plan item', async () => {
  const { project, requirement } = await seedRequirement(app);
  const plan = (await request(server)
    .post('/development-plans')
    .send({
      project_id: project.id,
      source_ref: { type: 'requirement', id: requirement.id },
      title: 'Checkout development plan',
      actor_id: 'actor-product',
    })
    .expect(201)).body;

  const item = (await request(server)
    .post(`/development-plans/${plan.id}/items`)
    .send({
      title: 'Build checkout validation flow',
      summary: 'Implement validation and route tests.',
      responsible_role: 'tech_lead',
      driver_actor_id: 'actor-tech',
      reviewer_actor_id: 'actor-reviewer',
      risk: 'medium',
      dependency_hints: [],
      affected_surfaces: ['apps/web'],
      release_impact: 'release_scoped',
    })
    .expect(201)).body;

  expect(item).toMatchObject({
    development_plan_id: plan.id,
    boundary_status: 'not_started',
    spec_status: 'missing',
    execution_plan_status: 'missing',
    execution_status: 'not_started',
  });
});
```

- [ ] **Step 2: Write failing API tests for source-object linking and AI-assisted Development Plan generation**

Add tests to `tests/api/development-plans.test.ts`:

```ts
it('links an existing Development Plan from a source object without creating a duplicate', async () => {
  const { requirement, bug } = await seedRequirementAndBug(app);
  const plan = await createDevelopmentPlan(app, { source_ref: { type: 'requirement', id: requirement.id } });

  const link = (await request(server)
    .post(`/source-objects/bug/${bug.id}/development-plans/${plan.id}/link`)
    .send({ actor_id: 'actor-product', rationale: 'Bug belongs to the same checkout plan.' })
    .expect(201)).body;

  expect(link).toMatchObject({
    source_ref: { type: 'bug', id: bug.id },
    development_plan_id: plan.id,
  });
});

it('generates and regenerates a draft Development Plan with a context manifest and feedback', async () => {
  const { requirement } = await seedRequirement(app);
  const generated = (await request(server)
    .post('/development-plans/generate-draft')
    .send({
      project_id: requirement.project_id,
      source_ref: { type: 'requirement', id: requirement.id },
      actor_id: 'actor-product',
      guidance: 'Split into a UI planning item and a validation item.',
    })
    .expect(201)).body;

  expect(generated).toMatchObject({
    source_ref: { type: 'requirement', id: requirement.id },
    generation_state: 'draft_generated',
    context_manifest_id: expect.any(String),
  });

  const regenerated = (await request(server)
    .post(`/development-plans/${generated.id}/regenerate-draft`)
    .send({
      actor_id: 'actor-tech',
      feedback: 'Preserve the UI item, add a QA handoff item.',
      preserve_prior_decisions: true,
    })
    .expect(201)).body;

  expect(regenerated.revision_id).not.toBe(generated.revision_id);
  expect(regenerated.context_manifest_id).toEqual(expect.any(String));
});
```

- [ ] **Step 3: Write failing API tests for brainstorming persistence**

Create `tests/api/brainstorming.test.ts`:

```ts
it('persists questions, answers, decisions, and approved boundary summary before Spec generation', async () => {
  const { plan, item } = await seedDevelopmentPlanItem(app);
  const session = (await request(server)
    .post(`/development-plans/${plan.id}/items/${item.id}/brainstorming-sessions`)
    .send({ actor_id: 'actor-tech' })
    .expect(201)).body;

  for (const question of session.questions) {
    await request(server)
      .post(`/brainstorming-sessions/${session.id}/answers`)
      .send({
        question_id: question.id,
        text: `Answered boundary question: ${question.text}`,
        actor_id: 'actor-tech',
      })
      .expect(201);
  }

  await request(server)
    .post(`/brainstorming-sessions/${session.id}/decisions`)
    .send({
      text: 'Keep implementation scoped to Web IA and route tests.',
      rationale: 'The item is a UI planning slice.',
      actor_id: 'actor-tech',
    })
    .expect(201);

  const approved = (await request(server)
    .post(`/brainstorming-sessions/${session.id}/approve-boundary`)
    .send({
      confirmed_scope: ['Web IA and Development Plan Item gate UX'],
      confirmed_out_of_scope: ['Runtime scheduler changes'],
      accepted_assumptions: ['Mock Codex question generation is sufficient for this slice'],
      open_risks: ['Execution queue depends on existing runtime adapters'],
      validation_expectations: ['Route tests and screenshot checks pass'],
      actor_id: 'actor-tech',
    })
    .expect(201)).body;

  expect(approved).toMatchObject({ approval_state: 'approved', boundary_summary_id: expect.any(String) });
});
```

- [ ] **Step 4: Run tests and verify failure**

Run:

```bash
pnpm vitest run tests/api/development-plans.test.ts tests/api/brainstorming.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because modules do not exist.

- [ ] **Step 5: Implement Development Plans controller and service**

Routes:

```ts
@Post('development-plans')
createDevelopmentPlan(@Body(new ZodValidationPipe(createDevelopmentPlanCommandSchema)) body: CreateDevelopmentPlanCommandDto) {
  return this.service.createDevelopmentPlan(body);
}

@Post('development-plans/:developmentPlanId/items')
createDevelopmentPlanItem(
  @Param('developmentPlanId') developmentPlanId: string,
  @Body(new ZodValidationPipe(createDevelopmentPlanItemCommandSchema)) body: CreateDevelopmentPlanItemCommandDto,
) {
  return this.service.createDevelopmentPlanItem(developmentPlanId, body);
}

@Post('development-plans/generate-draft')
generateDevelopmentPlanDraft(@Body(new ZodValidationPipe(generateDevelopmentPlanDraftCommandSchema)) body: GenerateDevelopmentPlanDraftCommandDto) {
  return this.service.generateDevelopmentPlanDraft(body);
}

@Post('development-plans/:developmentPlanId/regenerate-draft')
regenerateDevelopmentPlanDraft(
  @Param('developmentPlanId') developmentPlanId: string,
  @Body(new ZodValidationPipe(regenerateDevelopmentPlanDraftCommandSchema)) body: RegenerateDevelopmentPlanDraftCommandDto,
) {
  return this.service.regenerateDevelopmentPlanDraft(developmentPlanId, body);
}

@Post('source-objects/:sourceType/:sourceId/development-plans/:developmentPlanId/link')
linkSourceObjectToDevelopmentPlan(
  @Param('sourceType') sourceType: SourceObjectType,
  @Param('sourceId') sourceId: string,
  @Param('developmentPlanId') developmentPlanId: string,
  @Body(new ZodValidationPipe(linkDevelopmentPlanCommandSchema)) body: LinkDevelopmentPlanCommandDto,
) {
  return this.service.linkSourceObjectToDevelopmentPlan({ sourceType, sourceId, developmentPlanId, ...body });
}
```

Service rules:

- Require source object type to be initiative, requirement, bug, or tech_debt.
- Persist a Development Plan revision after create and after item changes.
- AI-assisted generation creates a Development Plan draft plus item rows, stores `generation_state`, stores actor guidance, and persists a Context Manifest covering source object revision, PRD/product docs, repository paths when available, historical related requirements/bugs, and runtime identity.
- Regeneration is explicit and versioned. It must not overwrite an approved Development Plan revision; it creates a new revision and records feedback plus `preserve_prior_decisions`.
- Linking an existing Development Plan to another source object must create a typed source link record and must not duplicate the plan or convert either object to a generic Work Item.
- Default item statuses to `boundary_status: 'not_started'`, `spec_status: 'missing'`, `execution_plan_status: 'missing'`, `execution_status: 'not_started'`.
- Add audit object events for plan/item creation.

- [ ] **Step 6: Implement Brainstorming controller and service**

Routes:

```ts
@Post('development-plans/:developmentPlanId/items/:itemId/brainstorming-sessions')
startSession(...)

@Post('brainstorming-sessions/:sessionId/answers')
answerQuestion(...)

@Post('brainstorming-sessions/:sessionId/decisions')
recordDecision(...)

@Post('brainstorming-sessions/:sessionId/approve-boundary')
approveBoundary(...)

@Get('development-plans/:developmentPlanId/items/:itemId/revisions')
listDevelopmentPlanItemRevisions(...)

@Get('development-plans/:developmentPlanId/items/:itemId/revisions/compare')
compareDevelopmentPlanItemRevisions(...)

@Get('boundary-summaries/:boundarySummaryId/revisions')
listBoundarySummaryRevisions(...)

@Get('boundary-summaries/:boundarySummaryId/revisions/compare')
compareBoundarySummaryRevisions(...)
```

Initial question generator can be deterministic:

```ts
const defaultBoundaryQuestions = [
  'Which repos, modules, and product surfaces are in scope?',
  'What is explicitly out of scope for this Development Plan Item?',
  'Which acceptance criteria and validation commands must pass?',
  'What risks or dependency constraints should block generation?',
];
```

Approval must fail unless every question has an answer and at least one decision is recorded. `approve-boundary` may also record an additional final decision from the submitted boundary summary, but it must not be the only decision if no prior decision exists.

Every manual Development Plan Item update, AI regeneration, and boundary approval must persist a structured revision. Boundary approval creates both the current `BoundarySummary` and an immutable `BoundarySummaryRevision` linked to the approved Brainstorming Session, Development Plan Item revision, decisions, approver, and approval timestamp. Compare routes return structured field diffs for item revisions and boundary revisions; they must not synthesize diffs from UI fixtures.

- [ ] **Step 7: Run API tests**

Run:

```bash
pnpm vitest run tests/api/development-plans.test.ts tests/api/brainstorming.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/control-plane-api/src/modules/development-plans apps/control-plane-api/src/modules/brainstorming apps/control-plane-api/src/app.module.ts tests/api/development-plans.test.ts tests/api/brainstorming.test.ts
git commit -m "feat: add development plan and brainstorming APIs"
```

## Task 4: Item-Scoped Spec And Execution Plan Gates

**Files:**
- Modify: `apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts`
- Modify: `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`
- Modify: `apps/control-plane-api/src/modules/delivery/dto.ts`
- Modify: `apps/web/src/shared/api/commands.ts`
- Modify: `apps/web/src/shared/api/hooks.ts`
- Test: `tests/api/spec-plan-service.test.ts`
- Test: `tests/contracts/project-management-contracts.test.ts`

- [ ] **Step 1: Write failing negative tests for direct source-object generation**

In `tests/api/spec-plan-service.test.ts`, replace old happy path direct creation with:

```ts
it('rejects direct source-object to Spec and Execution Plan generation', async () => {
  const { workItem } = await createProjectRepoWorkItem(app);
  await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(404);
  await request(server).post(`/work-items/${workItem.id}/plans`).send({}).expect(404);
});
```

- [ ] **Step 2: Write failing item-scoped gate tests**

Add:

```ts
it('generates Spec only from an approved Development Plan Item boundary', async () => {
  const { plan, item, boundary } = await seedApprovedBoundary(app);
  const specRevision = (await request(server)
    .post(`/development-plans/${plan.id}/items/${item.id}/spec/generate-draft`)
    .send({ actor_id: 'actor-tech' })
    .expect(201)).body;

  expect(specRevision).toMatchObject({
    development_plan_item_id: item.id,
    boundary_summary_id: boundary.id,
    context_manifest_id: expect.any(String),
  });
});

it('rejects Execution Plan generation until Spec is approved', async () => {
  const { plan, item } = await seedApprovedBoundary(app);
  await request(server)
    .post(`/development-plans/${plan.id}/items/${item.id}/execution-plan/generate-draft`)
    .send({ actor_id: 'actor-tech' })
    .expect(400);
});

it('supports requested changes, rejection, regeneration, and revision comparison for Spec and Execution Plan reviews', async () => {
  const { plan, item } = await seedApprovedBoundary(app);
  const firstSpecRevision = await generateItemSpecDraft(app, plan.id, item.id);
  await request(server)
    .post(`/development-plans/${plan.id}/items/${item.id}/spec/submit-for-approval`)
    .send({ actor_id: 'actor-tech' })
    .expect(201);
  await request(server)
    .post(`/development-plans/${plan.id}/items/${item.id}/spec/request-changes`)
    .send({ actor_id: 'actor-reviewer', rationale: 'Clarify acceptance criteria.' })
    .expect(201);
  const secondSpecRevision = (await request(server)
    .post(`/development-plans/${plan.id}/items/${item.id}/spec/regenerate-draft`)
    .send({ actor_id: 'actor-tech', feedback: 'Add explicit route and API validation.', preserve_prior_decisions: true })
    .expect(201)).body;
  const specDiff = (await request(server)
    .get(`/development-plans/${plan.id}/items/${item.id}/spec/revisions/compare`)
    .query({ base_revision_id: firstSpecRevision.id, compare_revision_id: secondSpecRevision.id })
    .expect(200)).body;
  expect(specDiff).toMatchObject({ base_revision_id: firstSpecRevision.id, compare_revision_id: secondSpecRevision.id });

  await request(server)
    .post(`/development-plans/${plan.id}/items/${item.id}/spec/submit-for-approval`)
    .send({ actor_id: 'actor-tech' })
    .expect(201);
  await request(server)
    .post(`/development-plans/${plan.id}/items/${item.id}/spec/approve`)
    .send({ actor_id: 'actor-reviewer', rationale: 'Spec approved.' })
    .expect(201);

  const firstExecutionPlanRevision = await generateItemExecutionPlanDraft(app, plan.id, item.id);
  await request(server)
    .post(`/development-plans/${plan.id}/items/${item.id}/execution-plan/submit-for-approval`)
    .send({ actor_id: 'actor-tech' })
    .expect(201);
  await request(server)
    .post(`/development-plans/${plan.id}/items/${item.id}/execution-plan/reject`)
    .send({ actor_id: 'actor-reviewer', rationale: 'Plan does not include QA handoff validation.' })
    .expect(201);
  const secondExecutionPlanRevision = (await request(server)
    .post(`/development-plans/${plan.id}/items/${item.id}/execution-plan/regenerate-draft`)
    .send({ actor_id: 'actor-tech', feedback: 'Add QA handoff validation and visual checks.', preserve_prior_decisions: true })
    .expect(201)).body;
  const executionPlanDiff = (await request(server)
    .get(`/development-plans/${plan.id}/items/${item.id}/execution-plan/revisions/compare`)
    .query({ base_revision_id: firstExecutionPlanRevision.id, compare_revision_id: secondExecutionPlanRevision.id })
    .expect(200)).body;
  expect(executionPlanDiff).toMatchObject({
    base_revision_id: firstExecutionPlanRevision.id,
    compare_revision_id: secondExecutionPlanRevision.id,
  });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm vitest run tests/api/spec-plan-service.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because direct routes still exist and item routes do not.

- [ ] **Step 4: Replace controller routes**

Keep `GET` routes only if they are item-scoped or needed by queue detail. Add:

```ts
@Post('development-plans/:developmentPlanId/items/:itemId/spec/generate-draft')
generateItemSpecDraft(...)

@Post('development-plans/:developmentPlanId/items/:itemId/spec/submit-for-approval')
submitItemSpec(...)

@Post('development-plans/:developmentPlanId/items/:itemId/spec/approve')
approveItemSpec(...)

@Post('development-plans/:developmentPlanId/items/:itemId/spec/request-changes')
requestItemSpecChanges(...)

@Post('development-plans/:developmentPlanId/items/:itemId/spec/reject')
rejectItemSpec(...)

@Post('development-plans/:developmentPlanId/items/:itemId/spec/regenerate-draft')
regenerateItemSpecDraft(...)

@Get('development-plans/:developmentPlanId/items/:itemId/spec/revisions/compare')
compareItemSpecRevisions(...)

@Post('development-plans/:developmentPlanId/items/:itemId/execution-plan/generate-draft')
generateItemExecutionPlanDraft(...)

@Post('development-plans/:developmentPlanId/items/:itemId/execution-plan/submit-for-approval')
submitItemExecutionPlan(...)

@Post('development-plans/:developmentPlanId/items/:itemId/execution-plan/approve')
approveItemExecutionPlan(...)

@Post('development-plans/:developmentPlanId/items/:itemId/execution-plan/request-changes')
requestItemExecutionPlanChanges(...)

@Post('development-plans/:developmentPlanId/items/:itemId/execution-plan/reject')
rejectItemExecutionPlan(...)

@Post('development-plans/:developmentPlanId/items/:itemId/execution-plan/regenerate-draft')
regenerateItemExecutionPlanDraft(...)

@Get('development-plans/:developmentPlanId/items/:itemId/execution-plan/revisions/compare')
compareItemExecutionPlanRevisions(...)
```

Delete direct `work-items/:workItemId/*` creation routes.

- [ ] **Step 5: Implement item gate service logic**

Spec generation must:

- Load Development Plan Item.
- Load approved Brainstorming Session and Boundary Summary.
- Create Context Manifest with source object, Development Plan revision, item revision, Brainstorming Session, Boundary Summary, boundary approver, PRD docs, repo paths, actor guidance, runtime identity, generated timestamp.
- Create Spec and Spec Revision linked to `development_plan_item_id`, `boundary_summary_id`, and `context_manifest_id`.
- Set item `spec_status` to `draft`.

Execution Plan generation must:

- Load approved Spec revision for the item.
- Create Context Manifest with approved Spec revision plus upstream boundary chain.
- Create Execution Plan and Execution Plan Revision linked to item.
- Set item `execution_plan_status` to `draft`.

Review loop rules:

- Submit moves the artifact to `in_review`.
- Approve records reviewer, rationale, approved revision id, and updates item status to `approved`.
- Request changes records reviewer, rationale, and updates artifact/item status to `changes_requested`; generation remains blocked until a new revision is created or the previous revision is resubmitted where allowed.
- Reject records reviewer and rationale, marks the current revision rejected, and requires regeneration before resubmission.
- Regeneration is explicit, versioned, accepts feedback and `preserve_prior_decisions`, creates a new Context Manifest, and never overwrites an approved revision.
- Revision compare returns Markdown diff metadata for reviewer UI and test assertions.

- [ ] **Step 6: Update Web command hooks to item-scoped methods**

Replace:

```ts
createSpec(workItemId)
createPlan(workItemId)
generatePlanDraft(planId)
```

with:

```ts
generateItemSpecDraft(developmentPlanId, itemId)
generateItemExecutionPlanDraft(developmentPlanId, itemId)
approveItemSpec(developmentPlanId, itemId, body)
approveItemExecutionPlan(developmentPlanId, itemId, body)
requestItemSpecChanges(developmentPlanId, itemId, body)
rejectItemSpec(developmentPlanId, itemId, body)
regenerateItemSpecDraft(developmentPlanId, itemId, body)
compareItemSpecRevisions(developmentPlanId, itemId, query)
requestItemExecutionPlanChanges(developmentPlanId, itemId, body)
rejectItemExecutionPlan(developmentPlanId, itemId, body)
regenerateItemExecutionPlanDraft(developmentPlanId, itemId, body)
compareItemExecutionPlanRevisions(developmentPlanId, itemId, query)
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm vitest run tests/api/spec-plan-service.test.ts tests/contracts/project-management-contracts.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/control-plane-api/src/modules/spec-plan apps/control-plane-api/src/modules/delivery apps/web/src/shared/api tests/api/spec-plan-service.test.ts tests/contracts/project-management-contracts.test.ts
git commit -m "feat: gate specs and execution plans by plan item"
```

## Task 5: Product Executions, Code Review, And QA Handoff API

**Files:**
- Create: `apps/control-plane-api/src/modules/executions/executions.controller.ts`
- Create: `apps/control-plane-api/src/modules/executions/executions.service.ts`
- Create: `apps/control-plane-api/src/modules/executions/executions.module.ts`
- Modify: `apps/control-plane-api/src/app.module.ts`
- Modify: `apps/control-plane-api/src/modules/execution-packages/execution-package.service.ts`
- Modify: `apps/control-plane-api/src/modules/run-control/execution-package-runs.controller.ts`
- Test: `tests/api/executions.test.ts`
- Test: `tests/api/code-review-qa-handoff.test.ts`
- Test: `tests/api/execution-package-service.test.ts`

- [ ] **Step 1: Write failing execution gate tests**

Create `tests/api/executions.test.ts`:

```ts
it('starts execution only from an approved Execution Plan revision', async () => {
  const { plan, item, executionPlanRevision } = await seedApprovedExecutionPlan(app);

  const execution = (await request(server)
    .post(`/development-plans/${plan.id}/items/${item.id}/execution/start`)
    .send({ actor_id: 'actor-dev' })
    .expect(201)).body;

  expect(execution).toMatchObject({
    development_plan_item_id: item.id,
    execution_plan_revision_id: executionPlanRevision.id,
    status: 'running',
  });
});

it('fails closed for missing, draft, stale, or unapproved Execution Plan revisions', async () => {
  const { plan, item } = await seedApprovedSpecWithoutExecutionPlan(app);
  await request(server)
    .post(`/development-plans/${plan.id}/items/${item.id}/execution/start`)
    .send({ actor_id: 'actor-dev' })
    .expect(400);
});
```

- [ ] **Step 2: Write failing Code Review and QA handoff tests**

Create `tests/api/code-review-qa-handoff.test.ts`:

```ts
it('moves a completed execution into code review and then QA handoff', async () => {
  const { execution } = await seedCompletedExecution(app);

  const review = (await request(server)
    .post(`/executions/${execution.id}/ready-for-code-review`)
    .send({
      actor_id: 'actor-dev',
      summary: 'Diff is ready for review.',
      changed_surfaces: ['apps/web/src/features/development-plans'],
      verification_evidence_refs: [{ type: 'execution', id: execution.id }],
    })
    .expect(201)).body;

  expect(review).toMatchObject({
    execution_id: execution.id,
    status: 'in_review',
    reviewer_actor_id: expect.any(String),
  });

  await request(server)
    .post(`/code-review-handoffs/${review.id}/approve`)
    .send({ actor_id: 'actor-reviewer', rationale: 'Code review passed.' })
    .expect(201);

  const qa = (await request(server)
    .post(`/code-review-handoffs/${review.id}/qa-handoff`)
    .send({
      actor_id: 'actor-reviewer',
      acceptance_criteria: ['Development Plan Item gate flow works'],
      test_strategy: 'Route tests plus visual checks',
      known_risks: ['Runtime adapter is still mocked locally'],
    })
    .expect(201)).body;

  expect(qa).toMatchObject({
    code_review_handoff_id: review.id,
    status: 'pending',
    source_ref: expect.objectContaining({ type: 'requirement' }),
    development_plan_item_id: expect.any(String),
  });
});

it('supports code review changes requested, QA block, QA accept, and audited exception paths', async () => {
  const { execution } = await seedCompletedExecution(app);
  const review = await markExecutionReadyForCodeReview(app, execution.id);

  await request(server)
    .post(`/code-review-handoffs/${review.id}/request-changes`)
    .send({ actor_id: 'actor-reviewer', rationale: 'Test evidence is missing.' })
    .expect(201);

  await request(server)
    .post(`/code-review-handoffs/${review.id}/audited-exception`)
    .send({
      actor_id: 'actor-tech-lead',
      reason: 'QA may prepare test data before final review approval.',
      risk: 'medium',
      rollback_plan: 'Hold QA acceptance until review passes.',
    })
    .expect(201);

  const qa = await createQaHandoffWithAuditedException(app, review.id);
  await request(server)
    .post(`/qa-handoffs/${qa.id}/block`)
    .send({ actor_id: 'actor-qa', rationale: 'Acceptance evidence is incomplete.' })
    .expect(201);
  await request(server)
    .post(`/qa-handoffs/${qa.id}/accept`)
    .send({
      actor_id: 'actor-qa',
      rationale: 'Regression evidence accepted.',
      verification_evidence_refs: [{ type: 'execution', id: execution.id }],
    })
    .expect(201);
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm vitest run tests/api/executions.test.ts tests/api/code-review-qa-handoff.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because execution, code review, and QA handoff commands do not exist.

- [ ] **Step 4: Implement execution start/continue API**

Routes:

```ts
@Post('development-plans/:developmentPlanId/items/:itemId/execution/start')
startExecution(...)

@Post('executions/:executionId/continue')
continueExecution(...)

@Post('executions/:executionId/interrupt')
interruptExecution(...)
```

Rules:

- Load item and approved Execution Plan revision.
- Reject if revision is missing, draft, in review, stale, or not the current approved revision for the item.
- Create product `Execution` before creating or linking raw runtime package/run data.
- Store `execution_plan_revision_id` on execution and package.
- Show raw runtime identifiers only as secondary evidence metadata.

- [ ] **Step 5: Implement code review and QA handoff commands**

Routes:

```ts
@Post('executions/:executionId/ready-for-code-review')
markReadyForCodeReview(...)

@Post('code-review-handoffs/:handoffId/approve')
approveCodeReview(...)

@Post('code-review-handoffs/:handoffId/request-changes')
requestCodeReviewChanges(...)

@Post('code-review-handoffs/:handoffId/audited-exception')
recordCodeReviewAuditedException(...)

@Post('code-review-handoffs/:handoffId/qa-handoff')
createQaHandoff(...)

@Post('qa-handoffs/:qaHandoffId/block')
blockQaHandoff(...)

@Post('qa-handoffs/:qaHandoffId/accept')
acceptQaHandoff(...)
```

Rules:

- `ready-for-code-review` requires completed execution evidence, changed surfaces, and at least one verification evidence ref.
- Code review approval or changes requested must be made by a trusted human reviewer actor.
- QA handoff normally requires approved code review; an audited exception may allow early QA preparation but must not mark QA accepted or release ready.
- QA handoff includes source object, Development Plan Item, approved Spec revision, approved Execution Plan revision, acceptance criteria, test strategy, evidence refs, known risks, changed surfaces, and release impact.
- QA `accept` requires at least one test/verification evidence ref; QA `block` requires a rationale.

- [ ] **Step 6: Bridge existing runtime package launch**

Update package/run services so execution start creates or reuses a package linked by `development_plan_item_id` and `execution_plan_revision_id`. Do not require a structured Task.

- [ ] **Step 7: Run API tests**

Run:

```bash
pnpm vitest run tests/api/executions.test.ts tests/api/code-review-qa-handoff.test.ts tests/api/execution-package-service.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/control-plane-api/src/modules/executions apps/control-plane-api/src/modules/execution-packages apps/control-plane-api/src/modules/run-control apps/control-plane-api/src/app.module.ts tests/api/executions.test.ts tests/api/code-review-qa-handoff.test.ts tests/api/execution-package-service.test.ts
git commit -m "feat: supervise executions through review and qa"
```

## Task 6: Query Projections And Product No-Baggage Cleanup

**Files:**
- Modify: `packages/db/src/queries/project-management-queries.ts`
- Modify: `packages/db/src/queries/web-product-queries.ts`
- Modify: `packages/db/src/queries/product-lane-queries.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.controller.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.service.ts`
- Modify: `apps/control-plane-api/src/modules/tasks/tasks.controller.ts`
- Modify: `apps/control-plane-api/src/modules/tasks/tasks.module.ts`
- Test: `tests/api/project-management-query.test.ts`
- Test: `tests/contracts/project-management-contracts.test.ts`
- Test: `tests/api/tasks.test.ts`

- [ ] **Step 1: Write failing query tests**

Update `tests/api/project-management-query.test.ts`:

```ts
it('lists My Work using source objects and Development Plan Items, not generic Tasks', async () => {
  const { item } = await seedDevelopmentPlanItem(repository, { driver_actor_id: 'actor-dev' });
  const response = await request(server).get('/query/my-work').query({ project_id: 'project-1', actor_id: 'actor-dev' }).expect(200);

  expect(response.body.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        object_ref: { type: 'development_plan_item', id: item.id, development_plan_id: item.development_plan_id },
        href: `/development-plans/${item.development_plan_id}/items/${item.id}`,
      }),
    ]),
  );
  expect(JSON.stringify(response.body)).not.toContain('"type":"task"');
  expect(JSON.stringify(response.body)).not.toContain('"type":"work_item"');
});
```

Add query tests for:

- `/query/dashboard`
- `/query/development-plans`
- `/query/development-plans/:id`
- `/query/development-plans/:id/items/:itemId`
- `/query/specs-execution-plans`
- `/query/executions`
- `/query/code-review-handoffs`
- `/query/qa-handoffs`
- `/query/board`
- `/query/reports/development-plan-throughput`
- `/query/reports/brainstorming-bottlenecks`
- `/query/reports/spec-review-aging`
- `/query/reports/execution-plan-review-aging`
- `/query/reports/execution-continuation`
- `/query/reports/execution-outcomes`
- `/query/reports/code-review`
- `/query/reports/qa-handoff-readiness`
- `/query/reports/release-readiness`
- `/query/reports/quality-bug-escape`

Add:

```ts
it('projects Board and Reports from mixed typed objects without assuming one schema', async () => {
  await seedSourceObject(repository, { kind: 'requirement', id: 'req-1' });
  await seedDevelopmentPlanItem(repository, { id: 'dpi-1', responsible_role: 'tech_lead' });
  await seedExecution(repository, { id: 'exec-1', status: 'interrupted' });

  const dashboard = await request(server).get('/query/dashboard').query({ project_id: 'project-1' }).expect(200);
  expect(dashboard.body).toMatchObject({
    sections: expect.arrayContaining([
      expect.objectContaining({ id: 'flow-health' }),
      expect.objectContaining({ id: 'blocked-work' }),
      expect.objectContaining({ id: 'aging' }),
      expect.objectContaining({ id: 'role-load' }),
      expect.objectContaining({ id: 'release-confidence' }),
    ]),
  });
  expect(JSON.stringify(dashboard.body)).not.toContain('"type":"task"');
  expect(JSON.stringify(dashboard.body)).not.toContain('"type":"work_item"');

  const board = await request(server).get('/query/board').query({ project_id: 'project-1' }).expect(200);
  expect(board.body.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ object_ref: { type: 'requirement', id: 'req-1' } }),
      expect.objectContaining({ object_ref: { type: 'development_plan_item', id: 'dpi-1', development_plan_id: expect.any(String) } }),
    ]),
  );

  const report = await request(server)
    .get('/query/reports/execution-continuation')
    .query({ project_id: 'project-1' })
    .expect(200);
  expect(report.body).toMatchObject({
    id: 'execution-continuation',
    groups: expect.arrayContaining([expect.objectContaining({ id: 'interrupted_or_resumable' })]),
  });

  const executionOutcomeReport = await request(server)
    .get('/query/reports/execution-outcomes')
    .query({ project_id: 'project-1' })
    .expect(200);
  expect(executionOutcomeReport.body).toMatchObject({
    id: 'execution-outcomes',
    groups: expect.arrayContaining([
      expect.objectContaining({ id: 'succeeded' }),
      expect.objectContaining({ id: 'failed' }),
    ]),
  });

  const specReviewReport = await request(server)
    .get('/query/reports/spec-review-aging')
    .query({ project_id: 'project-1' })
    .expect(200);
  expect(specReviewReport.body).toMatchObject({ id: 'spec-review-aging' });

  const executionPlanReviewReport = await request(server)
    .get('/query/reports/execution-plan-review-aging')
    .query({ project_id: 'project-1' })
    .expect(200);
  expect(executionPlanReviewReport.body).toMatchObject({ id: 'execution-plan-review-aging' });

  const releaseReadinessReport = await request(server)
    .get('/query/reports/release-readiness')
    .query({ project_id: 'project-1' })
    .expect(200);
  expect(releaseReadinessReport.body).toMatchObject({ id: 'release-readiness' });

  const qualityReport = await request(server)
    .get('/query/reports/quality-bug-escape')
    .query({ project_id: 'project-1' })
    .expect(200);
  expect(qualityReport.body).toMatchObject({
    id: 'quality-bug-escape',
    groups: expect.arrayContaining([
      expect.objectContaining({ id: 'escaped_bugs' }),
      expect.objectContaining({ id: 'qa_blockers' }),
    ]),
  });
});
```

- [ ] **Step 2: Write failing product Task route/API retirement tests**

In `tests/api/tasks.test.ts`, replace product create expectations with:

```ts
it('does not expose generic Task creation as a product API', async () => {
  await request(app.getHttpServer())
    .post('/tasks')
    .send({
      project_id: 'project-1',
      title: 'Legacy task',
      execution_brief: 'Should not be product-visible.',
    })
    .expect(404);
});
```

If a dev-only route is needed, assert it is under `/dev-tools/tasks` and requires dev tools configuration.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm vitest run tests/api/project-management-query.test.ts tests/api/tasks.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because current query still exposes tasks.

- [ ] **Step 4: Implement new query projections**

Projection rules:

- Dashboard projects flow health, blocked work, aging, role load, release confidence, trend/report links, and concrete unblock/escalate/reprioritize next actions.
- My Work rows can target source objects, Development Plans, Development Plan Items, Specs, Execution Plans, Executions, QA Handoffs, and Releases.
- Board cards can mix source objects and Development Plan Items with type-specific status fields.
- Specs & Execution Plans queue rows must show artifact type, source object, Development Plan Item, reviewer, age, risk, stale/blocked state, and next action.
- Development Plan Item detail query must include persisted Development Plan Item revisions, persisted Boundary Summary revisions, and compare links backed by repository/API compare methods.
- Executions queue rows must show approved Execution Plan revision, worker state, current step, last event, PR/diff/test evidence, and continue/inspect action.
- Code Review Handoff rows must show execution, reviewer, review decision, changed surfaces, blocking comments, and QA handoff availability.
- QA Handoff rows must show source object, Development Plan Item, approved Spec, approved Execution Plan, acceptance criteria, test strategy, evidence, risk, changed surfaces, release impact, and accept/block action state.
- Reports must produce non-placeholder sections for Development Plan throughput, brainstorming bottlenecks, Spec review aging, Execution Plan review aging, execution success/failure outcomes, execution continuation, code review turnaround, QA handoff readiness, release readiness, and quality/bug escape.
- Source object details expose relationship projections only; generation/start commands link to item gate routes.

- [ ] **Step 5: Retire Task product API**

Remove `TasksModule` from product imports. If runtime internals still need old task-shaped data, move controller behind `dev-tools` and ensure it is not imported unless dev tools are explicitly enabled.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm vitest run tests/api/project-management-query.test.ts tests/api/tasks.test.ts tests/contracts/project-management-contracts.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/queries apps/control-plane-api/src/modules/query apps/control-plane-api/src/modules/tasks tests/api tests/contracts
git commit -m "feat: project ai-native planning projections"
```

## Task 7: Web API Clients And Test Fixtures

**Files:**
- Modify: `apps/web/src/shared/api/types.ts`
- Modify: `apps/web/src/shared/api/query.ts`
- Modify: `apps/web/src/shared/api/commands.ts`
- Modify: `apps/web/src/shared/api/hooks.ts`
- Modify: `apps/web/src/shared/api/query-keys.ts`
- Modify: `tests/web/fixtures/product-data.ts`
- Modify: `tests/e2e/web-product-routes.e2e.test.ts`
- Test: `tests/web/api-client-contract.test.ts`

- [ ] **Step 1: Write failing API client and fixture tests**

Create `tests/web/api-client-contract.test.ts`:

```ts
it('exposes AI-native command and query client methods without product Task/direct Spec Plan commands', () => {
  const commands = createForgeloopCommandApi();
  const query = createForgeloopQueryApi();

  for (const method of [
    'generateDevelopmentPlanDraft',
    'regenerateDevelopmentPlanDraft',
    'linkSourceObjectToDevelopmentPlan',
    'generateItemSpecDraft',
    'regenerateItemSpecDraft',
    'generateItemExecutionPlanDraft',
    'startItemExecution',
    'markExecutionReadyForCodeReview',
    'acceptQaHandoff',
  ]) {
    expect(commands).toHaveProperty(method);
  }

  for (const method of ['getDashboard', 'listDevelopmentPlans', 'getDevelopmentPlanItem', 'listSpecExecutionPlanQueue', 'listExecutions']) {
    expect(query).toHaveProperty(method);
  }

  expect(commands).not.toHaveProperty('createTask');
  expect(commands).not.toHaveProperty('createSpec');
  expect(commands).not.toHaveProperty('createPlan');
});
```

- [ ] **Step 2: Run client tests and verify failure**

Run:

```bash
pnpm vitest run tests/web/api-client-contract.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because client methods and fixtures are old.

- [ ] **Step 3: Update Web API clients**

Add methods:

```ts
getDashboard(query)
listDevelopmentPlans(query)
getDevelopmentPlan(developmentPlanId)
getDevelopmentPlanItem(developmentPlanId, itemId)
listDevelopmentPlanItemRevisions(developmentPlanId, itemId)
compareDevelopmentPlanItemRevisions(developmentPlanId, itemId, query)
listBoundarySummaryRevisions(boundarySummaryId)
compareBoundarySummaryRevisions(boundarySummaryId, query)
generateDevelopmentPlanDraft(body)
regenerateDevelopmentPlanDraft(developmentPlanId, body)
linkSourceObjectToDevelopmentPlan(sourceType, sourceId, developmentPlanId, body)
listSpecExecutionPlanQueue(query)
listExecutions(query)
getExecution(executionId)
listCodeReviewHandoffs(query)
listQaHandoffs(query)
createDevelopmentPlan(body)
createDevelopmentPlanItem(developmentPlanId, body)
startBrainstormingSession(developmentPlanId, itemId, body)
answerBrainstormingQuestion(sessionId, body)
approveBoundary(sessionId, body)
generateItemSpecDraft(developmentPlanId, itemId, body)
generateItemExecutionPlanDraft(developmentPlanId, itemId, body)
startItemExecution(developmentPlanId, itemId, body)
continueExecution(executionId, body)
interruptExecution(executionId, body)
markExecutionReadyForCodeReview(executionId, body)
approveCodeReviewHandoff(handoffId, body)
requestCodeReviewChanges(handoffId, body)
recordCodeReviewAuditedException(handoffId, body)
createQaHandoff(handoffId, body)
blockQaHandoff(qaHandoffId, body)
acceptQaHandoff(qaHandoffId, body)
```

Remove product client methods for `/tasks`, direct `/work-items/:id/specs`, direct `/work-items/:id/plans`, direct `/plans/:id/generate-draft`.

- [ ] **Step 4: Keep route activation deferred**

Do not add `/development-plans/**` or `/executions/**` routes in this task because their route modules are created in Tasks 9 and 10. Remove no client-side imports that are still required by currently active routes. Final route activation and old route deletion happen with the route modules so each commit can run focused tests.

- [ ] **Step 5: Update deterministic fixtures**

In `tests/web/fixtures/product-data.ts`, add fixtures for:

- `dashboard`
- `developmentPlan`
- `developmentPlanItem`
- `brainstormingSession`
- `boundarySummary`
- `executionPlan`
- `executionPlanRevision`
- `execution`
- `codeReviewHandoff`
- `qaHandoff`

Remove Task fixtures from product route smoke tests.

- [ ] **Step 6: Run client and fixture tests**

Run:

```bash
pnpm vitest run tests/web/api-client-contract.test.ts tests/e2e/web-product-routes.e2e.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/shared/api tests/web tests/e2e/web-product-routes.e2e.test.ts
git commit -m "feat: add ai-native web clients and fixtures"
```

## Task 8: Product Shell, Dashboard, Source Object Workspace, And Role Lenses

**Files:**
- Modify: `apps/web/src/app/routes/dashboard/index.tsx`
- Modify: `apps/web/src/app/routes/_layout.tsx`
- Modify: `apps/web/src/shared/layout/app-shell/app-shell.tsx`
- Modify: `apps/web/src/shared/layout/sidebar-nav/sidebar-nav.tsx`
- Modify: `apps/web/src/shared/layout/topbar/topbar.tsx`
- Modify: `apps/web/src/shared/layout/detail-layout/detail-layout.tsx`
- Create: `apps/web/src/shared/ui/segmented-control/segmented-control.tsx`
- Modify: `apps/web/src/shared/ui/index.ts`
- Modify: `apps/web/src/features/project-management/object-detail-layout.tsx`
- Modify: source object feature routes under `apps/web/src/features/requirements`, `apps/web/src/features/bugs`, `apps/web/src/features/tech-debt`, `apps/web/src/features/initiatives`
- Create: `apps/web/src/features/dashboard/dashboard-route.tsx`
- Modify: `apps/web/src/features/my-work/my-work-route.tsx`
- Modify: `apps/web/src/features/board/board-route.tsx`
- Modify: `apps/web/src/features/reports/reports-routes.tsx`
- Test: `tests/web/project-management-routes.test.tsx`
- Test: `tests/web/my-work-board-reports.test.tsx`
- Test: `tests/web/ai-native-accessibility.test.tsx`
- Test: `tests/web/ai-native-surface-states.test.tsx`
- Test: `tests/web/responsive-layout.test.tsx`
- Test: `tests/web/design-system.test.tsx`

- [ ] **Step 1: Write failing UI contract tests**

Add source workspace assertions:

```ts
it('renders source object workspace with role lens and item-scoped downstream actions', async () => {
  const screen = await renderRoute('/requirements/req-1');
  expect(await screen.findByRole('heading', { name: /^Requirement$/ })).toBeTruthy();
  expect(screen.getByRole('tablist', { name: /source object sections/i })).toBeTruthy();
  expect(screen.getByRole('tab', { name: /brief/i })).toBeTruthy();
  expect(screen.getByRole('tab', { name: /development plan/i })).toBeTruthy();
  expect(screen.getByRole('radiogroup', { name: /role lens/i })).toBeTruthy();
  expect(screen.getByRole('complementary', { name: /next action/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /create development plan/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /generate development plan/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /link existing development plan/i })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /generate spec/i })).toBeNull();
  expect(screen.getByRole('link', { name: /open development plan item/i })).toHaveAttribute('href', '/development-plans/dp-1/items/dpi-1');
});
```

Create `tests/web/ai-native-accessibility.test.tsx`:

```ts
it('supports keyboard operation for role lens and action rail commands', async () => {
  const user = userEvent.setup();
  const screen = await renderRoute('/requirements/req-1');
  const roleLens = screen.getByRole('radiogroup', { name: /role lens/i });
  roleLens.focus();
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('radio', { name: /tech lead/i })).toHaveAttribute('aria-checked', 'true');

  await user.tab();
  expect(screen.getByRole('button', { name: /create development plan/i })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('dialog', { name: /create development plan/i })).toBeTruthy();
});
```

Create `tests/web/my-work-board-reports.test.tsx`:

```ts
it('renders My Work as a role-aware inbox with typed targets and reasons', async () => {
  const screen = await renderRoute('/my-work');
  expect(await screen.findByRole('heading', { name: 'My Work' })).toBeTruthy();
  expect(screen.getByText(/Needs boundary approval/i)).toBeTruthy();
  expect(screen.getByRole('link', { name: /open development plan item/i })).toHaveAttribute('href', '/development-plans/dp-1/items/dpi-1');
  expect(document.body.textContent).not.toMatch(/\bTasks\b|Work Item Owner|owner_actor_id/);
});

it('renders Dashboard as an operational cockpit, not a placeholder', async () => {
  const screen = await renderRoute('/dashboard');
  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
  for (const label of [
    'Flow health',
    'Blocked work',
    'Aging',
    'Role load',
    'Release confidence',
    'Trend reports',
  ]) {
    expect(screen.getByText(label)).toBeTruthy();
  }
  expect(screen.getByRole('link', { name: /inspect bottleneck reports/i })).toHaveAttribute('href', '/reports');
  expect(screen.getByRole('button', { name: /reprioritize/i })).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/\bTasks\b|Work Item Owner|owner_actor_id|coming soon|placeholder/i);
});

it('renders Board with mixed source objects and Development Plan Items', async () => {
  const screen = await renderRoute('/board');
  expect(await screen.findByRole('heading', { name: 'Board' })).toBeTruthy();
  expect(screen.getByText(/Requirement/i)).toBeTruthy();
  expect(screen.getByText(/Development Plan Item/i)).toBeTruthy();
  expect(screen.getByText(/Next action/i)).toBeTruthy();
});

it('renders Reports as product metrics, not placeholders', async () => {
  const screen = await renderRoute('/reports');
  expect(await screen.findByRole('heading', { name: 'Reports' })).toBeTruthy();
  for (const label of [
    'Development Plan throughput',
    'Brainstorming bottlenecks',
    'Spec review aging',
    'Execution Plan review aging',
    'Execution outcomes',
    'Execution continuation',
    'Code review turnaround',
    'QA handoff readiness',
    'Release readiness',
    'Quality and bug escape',
  ]) {
    expect(screen.getByText(label)).toBeTruthy();
  }
  expect(document.body.textContent).not.toMatch(/coming soon|placeholder/i);
});
```

Create `tests/web/ai-native-surface-states.test.tsx` with reusable state fixtures:

```ts
it.each([
  ['/requirements/req-1', 'Source Object Workspace'],
  ['/dashboard', 'Dashboard'],
  ['/my-work', 'My Work'],
  ['/board', 'Board'],
  ['/reports', 'Reports'],
] as const)('renders loading, empty, error, stale, blocked, approved, running, and resumable states for %s', async (route) => {
  for (const state of ['loading', 'empty', 'error', 'stale', 'blocked', 'approved', 'running', 'resumable'] as const) {
    const screen = await renderRoute(route, { fixtureState: state });
    expect(await screen.findByTestId(`surface-state-${state}`)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/color only status/i);
    cleanup();
  }
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm vitest run tests/web/project-management-routes.test.tsx tests/web/my-work-board-reports.test.tsx tests/web/ai-native-accessibility.test.tsx tests/web/ai-native-surface-states.test.tsx tests/web/responsive-layout.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because layout is too generic.

- [ ] **Step 3: Implement grouped navigation and topbar**

Use grouped sections:

- Home: Dashboard, My Work
- Discovery: Initiatives, Requirements, Bugs, Tech Debt
- Planning: Specs & Execution Plans now; Development Plans is added in Task 9 when its route modules exist.
- Delivery: Board, Releases now; Executions is added in Task 10 when its route modules exist.
- Intelligence: Reports

Topbar must expose command search placeholder, project context, role lens, and runtime state without raw IDs as primary text.

- [ ] **Step 4: Implement Source Object Workspace**

Layout:

- Header: type, title, state, risk, driver, release, freshness, role lens.
- Tabs: Brief, Development Plan, Specs & Execution Plans, Execution, QA, Release, Evidence.
- Main canvas: MDXEditor narrative through `ForgeMarkdownEditor`.
- Structured panel: typed fields and relationship summary.
- Action rail: next best action, blocking gates, stale warnings, and deep links to Development Plan Items.
- Source-object action rail includes create Development Plan, AI-generate Development Plan, link existing Development Plan, and add row to existing Development Plan.
- AI-generated Development Plan actions call the versioned generation APIs and display context manifest and regeneration feedback controls.

Disabled source-object downstream actions must explain that Spec/Execution Plan generation requires selecting a Development Plan Item.

Implement the Required Surface States matrix for Source Object Workspace, Dashboard, My Work, Board, and Reports in this task. Use `InlineNotice`, `Skeleton`, `EmptyState`, `StatusPill`, and action rail disabled reasons rather than color-only indicators.

- [ ] **Step 5: Implement Dashboard, My Work, Board, and Reports as real product surfaces**

Dashboard:

- Replace the existing placeholder notice with a compact operational cockpit.
- Sections show flow health, blocked work, aging, risk concentration, role load, release confidence, and trend/report links.
- Primary actions include unblock, escalate, reprioritize, and inspect bottleneck reports.
- Rows and cards must target typed source objects, Development Plan Items, Execution Plans, Executions, QA Handoffs, and Releases, not generic Tasks.

My Work:

- Group by attention reason, not object table type.
- Rows show target type, title, why visible, blocking gate, age, responsible role, and next action.
- Targets link to source object, Development Plan Item, Execution Plan queue row, Execution, Code Review Handoff, QA Handoff, or Release.

Board:

- Cards show object type, title, lens-specific status, risk, blocker, and next action.
- Cards must not assume every item has the same fields.

Reports:

- Render metric sections for Development Plan throughput, brainstorming bottlenecks, Spec review aging, Execution Plan review aging, Codex execution success/failure outcomes, Codex execution continuation, code review turnaround, QA handoff readiness, release readiness, and quality/bug escape.
- Empty data states still show metric definitions and next useful actions; they must not be blank placeholder cards.

- [ ] **Step 6: Run UI tests**

Run:

```bash
pnpm vitest run tests/web/project-management-routes.test.tsx tests/web/my-work-board-reports.test.tsx tests/web/ai-native-accessibility.test.tsx tests/web/ai-native-surface-states.test.tsx tests/web/responsive-layout.test.tsx tests/web/design-system.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/routes/dashboard apps/web/src/app/routes/_layout.tsx apps/web/src/shared/layout apps/web/src/shared/ui apps/web/src/features/project-management apps/web/src/features/requirements apps/web/src/features/bugs apps/web/src/features/tech-debt apps/web/src/features/initiatives apps/web/src/features/dashboard apps/web/src/features/my-work apps/web/src/features/board apps/web/src/features/reports tests/web
git commit -m "feat: build source object workspace shell"
```

## Task 9: Development Plan Table And Item Gate Pages

**Files:**
- Modify: `apps/web/src/app/routes.ts`
- Create: `apps/web/src/app/routes/development-plans/index.tsx`
- Create: `apps/web/src/app/routes/development-plans/new.tsx`
- Create: `apps/web/src/app/routes/development-plans/$developmentPlanId.tsx`
- Create: `apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId.tsx`
- Create: `apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/brainstorming.tsx`
- Create: `apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/spec.tsx`
- Create: `apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/execution-plan.tsx`
- Create: `apps/web/src/app/routes/development-plans/$developmentPlanId/items/$itemId/execution.tsx`
- Create: `apps/web/src/features/development-plans/development-plans-route.tsx`
- Create: `apps/web/src/features/development-plans/development-plan-detail-route.tsx`
- Create: `apps/web/src/features/development-plans/development-plan-item-detail-route.tsx`
- Create: `apps/web/src/features/development-plans/development-plan-table.tsx`
- Create: `apps/web/src/features/development-plans/plan-item-gates.tsx`
- Create: `apps/web/src/features/brainstorming/brainstorming-panel.tsx`
- Test: `tests/web/development-plan-routes.test.tsx`
- Test: `tests/web/ai-native-accessibility.test.tsx`
- Test: `tests/web/ai-native-surface-states.test.tsx`

- [ ] **Step 1: Write failing Development Plan route tests**

Create `tests/web/development-plan-routes.test.tsx`:

```ts
it('renders a table-first Development Plan page with gate columns and next actions', async () => {
  const screen = await renderRoute('/development-plans/dp-1');
  expect(await screen.findByRole('heading', { name: /checkout development plan/i })).toBeTruthy();
  for (const column of ['Plan item', 'Role', 'Driver', 'Boundary', 'Spec', 'Execution Plan', 'Execution', 'Risk', 'Next action']) {
    expect(screen.getByRole('columnheader', { name: column })).toBeTruthy();
  }
  expect(screen.getByRole('button', { name: /add row/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /regenerate with ai/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /show context manifest/i })).toBeTruthy();
  expect(screen.getByRole('link', { name: /open item/i })).toHaveAttribute('href', '/development-plans/dp-1/items/dpi-1');
});

it('renders Development Plan Item gate detail without calling it a Task', async () => {
  const screen = await renderRoute('/development-plans/dp-1/items/dpi-1');
  expect(await screen.findByRole('heading', { name: /build checkout validation flow/i })).toBeTruthy();
  expect(screen.getByText(/Boundary brainstorming/i)).toBeTruthy();
  expect(screen.getByText(/Spec document/i)).toBeTruthy();
  expect(screen.getByText(/Execution Plan document/i)).toBeTruthy();
  expect(screen.getByRole('region', { name: /development plan item revisions/i })).toBeTruthy();
  expect(screen.getByText(/Item revision 3/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: /compare item revisions/i })).toBeTruthy();
  expect(screen.getByRole('region', { name: /boundary summary revisions/i })).toBeTruthy();
  expect(screen.getByText(/Boundary summary revision 2/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: /compare boundary revisions/i })).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/\bTask\b|Work Item Owner|owner_actor_id/);
});
```

Extend `tests/web/ai-native-accessibility.test.tsx`:

```ts
it('supports keyboard navigation in the Development Plan table', async () => {
  const user = userEvent.setup();
  const screen = await renderRoute('/development-plans/dp-1');
  const table = await screen.findByRole('table', { name: /development plan items/i });
  expect(table).toBeTruthy();
  await user.tab();
  expect(screen.getByRole('row', { name: /build checkout validation flow/i })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('heading', { name: /build checkout validation flow/i })).toBeTruthy();
});
```

Extend `tests/web/ai-native-surface-states.test.tsx`:

```ts
it.each([
  ['/development-plans/dp-1', 'Development Plan Page'],
  ['/development-plans/dp-1/items/dpi-1', 'Development Plan Item Detail'],
] as const)('renders the required state matrix for %s', async (route) => {
  for (const state of ['loading', 'empty', 'error', 'stale', 'blocked', 'approved', 'running', 'resumable'] as const) {
    const screen = await renderRoute(route, { fixtureState: state });
    expect(await screen.findByTestId(`surface-state-${state}`)).toBeTruthy();
    expect(screen.getByTestId(`surface-state-${state}`)).toHaveAccessibleName();
    cleanup();
  }
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm vitest run tests/web/development-plan-routes.test.tsx tests/web/ai-native-surface-states.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Activate Development Plan route config and implement list/detail**

Add the Development Plan routes to `apps/web/src/app/routes.ts` only in this task, when their route files exist:

```ts
route('development-plans', './routes/development-plans/index.tsx'),
route('development-plans/new', './routes/development-plans/new.tsx'),
route('development-plans/:developmentPlanId', './routes/development-plans/$developmentPlanId.tsx'),
route('development-plans/:developmentPlanId/items/:itemId', './routes/development-plans/$developmentPlanId/items/$itemId.tsx'),
route('development-plans/:developmentPlanId/items/:itemId/brainstorming', './routes/development-plans/$developmentPlanId/items/$itemId/brainstorming.tsx'),
route('development-plans/:developmentPlanId/items/:itemId/spec', './routes/development-plans/$developmentPlanId/items/$itemId/spec.tsx'),
route('development-plans/:developmentPlanId/items/:itemId/execution-plan', './routes/development-plans/$developmentPlanId/items/$itemId/execution-plan.tsx'),
route('development-plans/:developmentPlanId/items/:itemId/execution', './routes/development-plans/$developmentPlanId/items/$itemId/execution.tsx'),
```

Add the Development Plans navigation entry to the Planning section in this task.

Use TanStack Table for the plan table. Row height target is 44-56px. Desktop detail is a split pane; mobile rows become compact cards.

Columns:

- Plan item
- Responsible role
- Driver
- Boundary
- Spec
- Execution Plan
- Execution
- Risk
- Next action

Actions:

- Manual add row.
- AI-assisted generate missing rows.
- Regenerate with feedback.
- Preserve prior decisions toggle.
- Context manifest drawer.

- [ ] **Step 4: Implement item gate detail**

Sections:

- Row summary and structured fields.
- Development Plan Item revision history with revision number, editor, timestamp, change reason, stale/current marker, and compare action.
- Boundary brainstorming panel.
- Boundary Summary revision history with approver, approval timestamp, source Brainstorming Session, decision count, and compare action.
- Spec document panel.
- Execution Plan document panel.
- Execution supervision panel.
- Code review and QA handoff panel.
- Evidence timeline.

Gate buttons must show disabled reasons.
Development Plan Item and Boundary Summary revision histories must remain visible or one click away from the item gate detail; do not hide these behind the Markdown editor revision drawer because they are structured governance artifacts.
Implement the Required Surface States matrix for Development Plan Page and Development Plan Item Detail in this task. State indicators must include accessible text and must not rely on color alone.

- [ ] **Step 5: Implement brainstorming panel commands**

Use `useStartBrainstormingSessionMutation`, `useAnswerBrainstormingQuestionMutation`, and `useApproveBoundaryMutation`. After approval, invalidate item and queue queries.

- [ ] **Step 6: Run Development Plan tests**

Run:

```bash
pnpm vitest run tests/web/development-plan-routes.test.tsx tests/web/ai-native-accessibility.test.tsx tests/web/ai-native-surface-states.test.tsx tests/web/project-management-routes.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/routes.ts apps/web/src/app/routes/development-plans apps/web/src/features/development-plans apps/web/src/features/brainstorming tests/web/development-plan-routes.test.tsx tests/web/ai-native-accessibility.test.tsx tests/web/ai-native-surface-states.test.tsx tests/web/project-management-routes.test.tsx
git commit -m "feat: add development plan item gate UI"
```

## Task 10: Specs & Execution Plans Queue, Executions, Code Review, And QA UI

**Files:**
- Modify: `apps/web/src/app/routes.ts`
- Modify: `apps/web/src/app/routes/specs-plans/index.tsx`
- Create: `apps/web/src/app/routes/executions/index.tsx`
- Create: `apps/web/src/app/routes/executions/$executionId.tsx`
- Create: `apps/web/src/features/spec-plan/spec-execution-plan-queue.tsx`
- Create: `apps/web/src/features/executions/executions-route.tsx`
- Create: `apps/web/src/features/executions/execution-detail-route.tsx`
- Create: `apps/web/src/features/code-review/code-review-handoff-panel.tsx`
- Create: `apps/web/src/features/qa/qa-handoff-panel.tsx`
- Modify: `apps/web/src/features/spec-plan/specs-plans-route.tsx`
- Delete or stop importing: `apps/web/src/features/spec-plan/spec-plan-direct-routes.tsx`
- Delete product route imports from old plan/spec direct pages.
- Test: `tests/web/spec-plan-lifecycle-actions.test.tsx`
- Test: `tests/web/executions-routes.test.tsx`
- Test: `tests/web/code-review-qa-handoff-routes.test.tsx`
- Test: `tests/web/ai-native-surface-states.test.tsx`

- [ ] **Step 1: Write failing queue tests**

Update `tests/web/spec-plan-lifecycle-actions.test.tsx`:

```ts
it('renders governance queues scoped to Development Plan Items', async () => {
  const screen = await renderRoute('/specs-plans');
  expect(await screen.findByRole('heading', { name: 'Specs & Execution Plans' })).toBeTruthy();
  expect(screen.getByText(/Spec needs generation/i)).toBeTruthy();
  expect(screen.getByText(/Execution Plan needs review/i)).toBeTruthy();
  expect(screen.getByRole('link', { name: /open plan item/i })).toHaveAttribute('href', '/development-plans/dp-1/items/dpi-1/spec');
  expect(document.body.textContent).not.toMatch(/\/plans\/|\/specs\/|\/tasks\//);
});

it.each([
  '/plans',
  '/plans/plan-1',
  '/specs',
  '/specs/spec-1',
  '/requirements/req-1/spec',
  '/requirements/req-1/plan',
  '/bugs/bug-1/spec',
  '/bugs/bug-1/plan',
  '/tech-debt/td-1/spec',
  '/tech-debt/td-1/plan',
  '/initiatives/init-1/spec',
  '/initiatives/init-1/plan',
])('does not expose legacy or direct artifact route %s', async (route) => {
  const screen = await renderRoute(route);
  expect(await screen.findByText(/not found|route retired|use a development plan item/i)).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/generate spec|generate execution plan|start execution/i);
});
```

Create `tests/web/executions-routes.test.tsx`:

```ts
it('renders product Executions queue instead of raw runtime browser', async () => {
  const screen = await renderRoute('/executions');
  expect(await screen.findByRole('heading', { name: 'Executions' })).toBeTruthy();
  expect(screen.getByText(/Approved Execution Plan/i)).toBeTruthy();
  expect(screen.getByRole('link', { name: /inspect execution/i })).toHaveAttribute('href', '/executions/exec-1');
  expect(document.body.textContent).not.toMatch(/Execution Package Browser|Run Session Browser|Review Packet Browser/);
});
```

Create `tests/web/code-review-qa-handoff-routes.test.tsx`:

```ts
it('renders code review and QA handoff controls from an execution detail', async () => {
  const screen = await renderRoute('/executions/exec-1');
  expect(await screen.findByRole('heading', { name: /Execution/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /ready for code review/i })).toBeTruthy();
  expect(screen.getByText(/Code review handoff/i)).toBeTruthy();
  expect(screen.getByText(/QA handoff/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: /request changes/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /accept qa handoff/i })).toBeTruthy();
});
```

Extend `tests/web/ai-native-surface-states.test.tsx`:

```ts
it.each([
  ['/specs-plans', 'Specs & Execution Plans Queue'],
  ['/executions', 'Executions Queue'],
  ['/executions/exec-1', 'Execution Detail'],
] as const)('renders the required state matrix for %s', async (route) => {
  for (const state of ['loading', 'empty', 'error', 'stale', 'blocked', 'approved', 'running', 'resumable'] as const) {
    const screen = await renderRoute(route, { fixtureState: state });
    expect(await screen.findByTestId(`surface-state-${state}`)).toBeTruthy();
    expect(screen.getByTestId(`surface-state-${state}`)).toHaveAccessibleName();
    cleanup();
  }
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm vitest run tests/web/spec-plan-lifecycle-actions.test.tsx tests/web/executions-routes.test.tsx tests/web/code-review-qa-handoff-routes.test.tsx tests/web/ai-native-surface-states.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because UI still uses old document queues and no executions route.

- [ ] **Step 3: Implement Specs & Execution Plans queue**

Update `apps/web/src/app/routes.ts` in this task to add the Executions routes and to ensure `/specs-plans` points at the governance queue. Do not add raw runtime product routes.

```ts
route('executions', './routes/executions/index.tsx'),
route('executions/:executionId', './routes/executions/$executionId.tsx'),
```

Add the Executions navigation entry to the Delivery section in this task.

Groups:

- Spec needs generation
- Spec needs review
- Spec approved
- Execution Plan needs generation
- Execution Plan needs review
- Execution Plan approved
- Stale
- Blocked

Rows show artifact type, source object, Development Plan Item, reviewer, age, risk, stale/blocked state, and next action.
Implement the Required Surface States matrix for the Specs & Execution Plans Queue in this task. Empty and loading states must preserve the queue layout so columns do not jump between states.

- [ ] **Step 4: Implement Executions queue and detail**

Groups:

- Active
- Resumable
- Failed
- Awaiting code review
- QA handoff pending

Rows show approved Execution Plan revision, worker state, current step, last event time, PR/diff/test evidence, and continue/inspect actions.
Implement the Required Surface States matrix for the Executions Queue and Execution Detail in this task. Resumable state must expose an interrupt/continue history, and running state must expose progress without depending on raw runtime IDs as the page title.

- [ ] **Step 5: Implement code review and QA handoff panels**

Code Review panel:

- Shows execution, approved Execution Plan revision, changed surfaces, verification evidence, reviewer, status, and comments/changes requested.
- Commands: ready for code review, approve, request changes, audited exception.

QA panel:

- Shows source object, Development Plan Item, approved Spec, approved Execution Plan, acceptance criteria, test strategy, evidence refs, known risks, changed surfaces, and release impact.
- Commands: create QA handoff, block, accept.
- Early QA preparation through audited exception is visible and never marks release readiness as passed.

- [ ] **Step 6: Run route tests**

Run:

```bash
pnpm vitest run tests/web/spec-plan-lifecycle-actions.test.tsx tests/web/executions-routes.test.tsx tests/web/code-review-qa-handoff-routes.test.tsx tests/web/ai-native-surface-states.test.tsx tests/e2e/web-product-routes.e2e.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/routes.ts apps/web/src/app/routes/specs-plans apps/web/src/app/routes/executions apps/web/src/features/spec-plan apps/web/src/features/executions apps/web/src/features/code-review apps/web/src/features/qa tests/web tests/e2e/web-product-routes.e2e.test.ts
git commit -m "feat: add governance queues and executions UI"
```

## Task 11: Authoring UX, Attachments, And Lifecycle Actions

**Files:**
- Modify: `apps/web/src/shared/ui/markdown-editor/markdown-editor.tsx`
- Modify: `apps/web/src/shared/ui/markdown-editor/attachment-plugin.ts`
- Modify: `apps/web/src/shared/ui/evidence-attachments/evidence-attachments.tsx`
- Modify: `apps/web/src/features/project-management/object-detail-layout.tsx`
- Modify: `apps/web/src/features/development-plans/development-plan-item-detail-route.tsx`
- Modify: `apps/web/src/features/development-plans/plan-item-gates.tsx`
- Test: `tests/web/markdown-editor.test.tsx`
- Test: `tests/web/development-plan-routes.test.tsx`

- [ ] **Step 1: Write failing editor UX tests**

Add:

```ts
it('keeps MDXEditor behind ForgeMarkdownEditor and supports source mode, image upload, and revision affordances', async () => {
  const screen = render(<ForgeMarkdownEditor {...editorPropsWithAttachmentsAndRevisions} />);
  expect(screen.getByRole('button', { name: /source/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /insert image/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /attachments/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /revisions/i })).toBeTruthy();
});

it('supports keyboard operation and visible focus for editor toolbar controls', async () => {
  const user = userEvent.setup();
  const screen = render(<ForgeMarkdownEditor {...editorPropsWithAttachmentsAndRevisions} />);
  await user.tab();
  expect(screen.getByRole('button', { name: /source/i })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('textbox', { name: /markdown source/i })).toBeTruthy();
  await user.tab();
  expect(screen.getByRole('button', { name: /insert image/i })).toHaveFocus();
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm vitest run tests/web/markdown-editor.test.tsx tests/web/development-plan-routes.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL if toolbar or gate actions are incomplete.

- [ ] **Step 3: Polish editor controls**

Use lucide icons with accessible labels for:

- Source/rich mode.
- Insert image.
- Attachments.
- Revisions.
- Save.

Keep text labels where icon-only would be ambiguous in tests or accessibility.

- [ ] **Step 4: Wire lifecycle actions to item gates**

On Development Plan Item detail:

- Generate Spec enabled only after boundary approval.
- Submit/approve Spec updates item status and queue.
- Request changes, reject, regenerate, and revision compare actions update item status and queue without overwriting approved revisions.
- Generate Execution Plan enabled only after Spec approval.
- Execution Plan request changes, reject, regenerate, and revision compare actions mirror the Spec review loop.
- Start execution enabled only after Execution Plan approval.
- Continue/interrupt actions appear only for execution states that support them.
- Ready for code review enabled only after execution completion and required verification evidence exists.
- QA handoff enabled only after approved code review or a visible audited exception for early QA preparation.
- QA accept/block actions update the Development Plan Item, My Work, Reports, and Release readiness projections.
- Manual item edits, AI regeneration of Development Plan rows, boundary decision changes, and boundary approval create new Development Plan Item or Boundary Summary revisions without overwriting approved history.
- Revision compare actions for Development Plan Item and Boundary Summary structured revisions remain available from the item gate surface after Spec/Execution Plan generation, so reviewers can audit what changed between boundary approval and execution.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm vitest run tests/web/markdown-editor.test.tsx tests/web/development-plan-routes.test.tsx tests/web/spec-plan-lifecycle-actions.test.tsx tests/web/executions-routes.test.tsx tests/web/code-review-qa-handoff-routes.test.tsx tests/web/my-work-board-reports.test.tsx tests/web/ai-native-surface-states.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/shared/ui/markdown-editor apps/web/src/shared/ui/evidence-attachments apps/web/src/features/project-management apps/web/src/features/development-plans tests/web
git commit -m "feat: polish planning authoring and gate actions"
```

## Task 12: Visual QA, Screenshots, And No-Baggage Gates

**Files:**
- Create: `tests/e2e/ai-native-project-management-visual.e2e.test.ts`
- Create: `tests/e2e/helpers/capture-route-screenshots.ts`
- Modify: `tests/web/responsive-layout.test.tsx`
- Modify: `tests/web/design-system.test.tsx`
- Modify: `tests/web/project-management-routes.test.tsx`
- Modify: `tests/e2e/web-product-routes.e2e.test.ts`

- [ ] **Step 1: Write failing no-baggage scans**

Add a test that scans rendered product routes:

```ts
const forbiddenProductStrings = [
  '/tasks',
  'Work Item Owner',
  'owner_actor_id',
  'Execution Package Browser',
  'Run Session Browser',
  'Review Packet Browser',
  'Raw Replay Browser',
  '/replay',
];

const forbiddenPrimaryNavLabels = [
  'Execution Packages',
  'Run Sessions',
  'Review Packets',
  'Replay',
  'Traces',
];
```

Allow `Release Owner` only on release pages. Plain `Replay` is allowed only inside scoped reports or evidence explanations; it must not appear as primary navigation, a raw browser title, or a public route.

- [ ] **Step 2: Write screenshot smoke**

Create a Playwright-based helper that starts from the already running dev server or `FORGELOOP_WEB_BASE_URL`, visits these routes at 375, 768, 1024, and 1440 widths:

- `/dashboard`
- `/plans`
- `/plans/plan-1`
- `/specs`
- `/specs/spec-1`
- `/requirements/req-1`
- `/requirements/req-1/spec`
- `/requirements/req-1/plan`
- `/development-plans/dp-1`
- `/development-plans/dp-1/items/dpi-1`
- `/specs-plans`
- `/executions`
- `/executions/exec-1`
- `/reports`

The helper should write PNGs under `test-results/ai-native-project-management/` and assert:

- no horizontal page scroll;
- no element with `[data-card-in-card="true"]`;
- primary heading visible;
- action rail or mobile action section visible;
- role lens labels visible on source object page.
- every route has a visible non-color-only state affordance for the route's default status.
- loading, empty, error, stale, blocked, approved, running, and resumable variants are covered by `tests/web/ai-native-surface-states.test.tsx`.
- top-level legacy artifact routes such as `/plans`, `/plans/plan-1`, `/specs`, and `/specs/spec-1` render product-safe not-found/retired-route states and do not show legacy document browsers.
- direct source-object artifact routes such as `/requirements/req-1/spec` and `/requirements/req-1/plan` render product-safe not-found/retired-route states and do not show generation commands.

Also create a Playwright happy-path smoke in the same file:

```ts
it('creates and links Development Plans from a Requirement and manually adds a row', async () => {
  const { page, baseUrl } = await startAiNativeProjectManagementFixture();
  await page.goto(`${baseUrl}/requirements/req-1`);

  await page.getByRole('button', { name: /create development plan/i }).click();
  await page.getByRole('textbox', { name: /development plan title/i }).fill('Checkout manual development plan');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/development-plans\/dp-manual/);

  await page.getByRole('button', { name: /add row/i }).click();
  await page.getByRole('textbox', { name: /plan item title/i }).fill('Manual checkout validation item');
  await page.getByRole('textbox', { name: /summary/i }).fill('Validate checkout states before execution.');
  await page.getByRole('button', { name: /save row/i }).click();
  await expect(page.getByRole('row', { name: /manual checkout validation item/i })).toBeVisible();

  await page.goto(`${baseUrl}/requirements/req-2`);
  await page.getByRole('button', { name: /link existing development plan/i }).click();
  await page.getByRole('combobox', { name: /development plan/i }).selectOption('dp-manual');
  await page.getByRole('button', { name: /^link$/i }).click();
  await expect(page.getByRole('link', { name: /checkout manual development plan/i })).toHaveAttribute('href', /\/development-plans\/dp-manual/);
});

it('completes the AI-native planning happy path through QA handoff', async () => {
  const { page, baseUrl } = await startAiNativeProjectManagementFixture();
  await page.goto(`${baseUrl}/requirements/req-1`);
  await page.getByRole('button', { name: /generate development plan/i }).click();
  await page.getByRole('button', { name: /show context manifest/i }).click();
  await page.getByRole('link', { name: /open development plan item/i }).click();
  await page.getByRole('button', { name: /start boundary brainstorming/i }).click();
  for (const answerBox of await page.getByRole('textbox', { name: /answer boundary question/i }).all()) {
    await answerBox.fill('Keep the change scoped to apps/web and route tests.');
  }
  await page.getByRole('textbox', { name: /decision rationale/i }).fill('The approved boundary is limited to Web IA and route tests.');
  await page.getByRole('button', { name: /record decision/i }).click();
  await page.getByRole('button', { name: /approve boundary/i }).click();
  await page.getByRole('button', { name: /generate spec/i }).click();
  await page.getByRole('button', { name: /approve spec/i }).click();
  await page.getByRole('button', { name: /generate execution plan/i }).click();
  await page.getByRole('button', { name: /approve execution plan/i }).click();
  await page.getByRole('button', { name: /start execution/i }).click();
  await page.getByRole('button', { name: /interrupt execution/i }).click();
  await expect(page.getByText(/resumable/i)).toBeVisible();
  await page.getByRole('button', { name: /continue execution/i }).click();
  await page.getByRole('button', { name: /ready for code review/i }).click();
  await page.getByRole('button', { name: /approve code review/i }).click();
  await page.getByRole('button', { name: /create qa handoff/i }).click();
  await page.getByRole('button', { name: /accept qa handoff/i }).click();
  await expect(page.getByText(/QA accepted/i)).toBeVisible();
});
```

Implement `startAiNativeProjectManagementFixture()` using the existing `tests/e2e/run-console.e2e.test.ts` pattern: start a Nest app on a free port, seed the in-memory repository, start `pnpm --filter @forgeloop/web dev` with `VITE_FORGELOOP_API_URL`, launch Playwright Chromium, and close all processes in `afterEach`. Use fixture-backed mocked APIs only if the real API route for a command is intentionally not implemented in this slice.

- [ ] **Step 3: Run screenshot test and verify failure if layout is not ready**

Run:

```bash
FORGELOOP_WEB_BASE_URL=http://localhost:5173 pnpm vitest run tests/e2e/ai-native-project-management-visual.e2e.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS only if a dev server is running and layouts satisfy viewport checks. If no dev server is running, start one with `pnpm dev:web` before rerunning.

- [ ] **Step 4: Fix visual defects**

Fix any:

- horizontal scroll;
- overlapping labels;
- card-in-card composition;
- action rail covering content;
- color-only status;
- large empty primary surfaces;
- raw runtime IDs as dominant titles.

- [ ] **Step 5: Run rendered route and route-definition no-baggage scans**

Run:

```bash
rg -n "Work Item Owner|owner_actor_id|/tasks|path: 'tasks'|route\\(['\"]plans|route\\(['\"]specs|path: ['\"]plans['\"]|path: ['\"]specs['\"]|/plans(/|['\"[:space:]]|$)|/specs(/|['\"[:space:]]|$)|work-items/.*/specs|work-items/.*/plans|requirements/.*/(spec|plan)|bugs/.*/(spec|plan)|tech-debt/.*/(spec|plan)|initiatives/.*/(spec|plan)|Execution Package Browser|Run Session Browser|Review Packet Browser|Raw Replay Browser|/replay|path: 'replay'" apps/web/src/app apps/web/src/features tests/web/router-test-utils.tsx tests/e2e/web-product-routes.e2e.test.ts tests/e2e/ai-native-project-management-visual.e2e.test.ts
```

Expected: no active product route, nav, rendered-route, or fixture matches. This step intentionally does not scan all API/workflow/test helpers because Task 13 migrates remaining legacy callers next. Allowed matches must be limited to:

- negative tests;
- Release Owner or Project owner domains;
- comments explaining forbidden strings in tests.

- [ ] **Step 6: Run full focused product verification**

Run:

```bash
pnpm vitest run tests/contracts/project-management-contracts.test.ts tests/api/development-plans.test.ts tests/api/brainstorming.test.ts tests/api/spec-plan-service.test.ts tests/api/executions.test.ts tests/api/code-review-qa-handoff.test.ts tests/api/project-management-query.test.ts tests/web/app-shell-routing.test.tsx tests/web/project-management-routes.test.tsx tests/web/my-work-board-reports.test.tsx tests/web/ai-native-accessibility.test.tsx tests/web/ai-native-surface-states.test.tsx tests/web/development-plan-routes.test.tsx tests/web/spec-plan-lifecycle-actions.test.tsx tests/web/executions-routes.test.tsx tests/web/code-review-qa-handoff-routes.test.tsx tests/web/responsive-layout.test.tsx tests/web/design-system.test.tsx tests/e2e/web-product-routes.e2e.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 7: Run build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps packages tests
git commit -m "test: verify ai-native project management product closure"
```

## Task 13: Legacy Caller Migration And Full Test Integration

**Files:**
- Modify as needed after inventory:
  - `tests/helpers/**`
  - `tests/api/**`
  - `tests/db/**`
  - `tests/e2e/**`
  - `tests/web/**`
  - `scripts/**`
  - `apps/control-plane-api/src/modules/**`
  - `apps/web/src/shared/api/**`
  - `packages/db/src/queries/**`
  - `packages/workflow/src/**`

- [ ] **Step 1: Inventory every remaining legacy caller**

Run:

```bash
rg -n "post\\(`/work-items/\\$\\{[^}]+\\}/(specs|plans)|post\\('/work-items/[^']+/(specs|plans)|/work-items/.*/(specs|plans)|\\.post\\('/tasks'|\\.post\\(`/tasks|/query/tasks|/tasks/|route\\(['\"]plans|route\\(['\"]specs|path: ['\"]plans['\"]|path: ['\"]specs['\"]|/plans(/|['\"[:space:]]|$)|/specs(/|['\"[:space:]]|$)|createTask\\(|createSpec\\(|createPlan\\(|generatePlanDraft\\(|work_item_id|task_id|requirements/.*/(spec|plan)|bugs/.*/(spec|plan)|tech-debt/.*/(spec|plan)|initiatives/.*/(spec|plan)" tests apps packages scripts
```

Expected: matches may remain at the start of this task. Copy the matched file list into the task notes and classify each match as:

- product-facing caller to migrate;
- runtime/internal storage field that remains internal-only;
- negative no-baggage test that should remain;
- dev-tools-only caller.

- [ ] **Step 2: Update shared test helpers and seeders first**

Migrate helper functions that currently create approved Spec/Plan through direct Work Item routes or Task APIs. Preferred replacement helpers:

```ts
seedDevelopmentPlanItem(app, sourceRef)
seedApprovedBoundary(app, itemRef)
seedApprovedItemSpec(app, itemRef)
seedApprovedExecutionPlan(app, itemRef)
seedStartedExecution(app, itemRef)
seedCompletedExecution(app, itemRef)
```

These helpers must use the new Development Plan Item APIs and repository methods, not direct `/work-items/:id/specs`, direct `/work-items/:id/plans`, `/tasks`, or `/query/tasks`.

- [ ] **Step 3: Migrate API, workflow, automation, and runtime tests**

Update tests that still depend on legacy routes or task-shaped product APIs, including delivery/runtime fixtures, delivery-flow tests, automation-command tests, query-module tests, durable revision/id tests, product-lane tests, and execution package tests. Keep internal DB `work_item_id` or `task_id` only when the test explicitly covers migration/dev-only storage behavior.

Run after migration:

```bash
pnpm vitest run tests/api tests/workflow tests/db tests/contracts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 4: Migrate Web route helpers and E2E tests**

Update `tests/web/router-test-utils.tsx`, `tests/web/fixtures/product-data.ts`, `tests/e2e/web-product-routes.e2e.test.ts`, and any route fixtures still linking to `/tasks`, direct `/specs/:id`, direct `/plans/:id`, `/requirements/:id/spec`, `/requirements/:id/plan`, `/bugs/:id/spec`, `/bugs/:id/plan`, `/tech-debt/:id/spec`, `/tech-debt/:id/plan`, `/query/tasks`, raw execution package browser routes, run browser routes, or review browser routes.

Run:

```bash
pnpm vitest run tests/web tests/e2e/web-product-routes.e2e.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 5: Run strict legacy caller scan**

Run:

```bash
rg -n "post\\(`/work-items/\\$\\{[^}]+\\}/(specs|plans)|post\\('/work-items/[^']+/(specs|plans)|/work-items/.*/(specs|plans)|\\.post\\('/tasks'|\\.post\\(`/tasks|/query/tasks|/tasks/|route\\(['\"]plans|route\\(['\"]specs|path: ['\"]plans['\"]|path: ['\"]specs['\"]|/plans(/|['\"[:space:]]|$)|/specs(/|['\"[:space:]]|$)|createTask\\(|createSpec\\(|createPlan\\(|generatePlanDraft\\(|requirements/.*/(spec|plan)|bugs/.*/(spec|plan)|tech-debt/.*/(spec|plan)|initiatives/.*/(spec|plan)" tests apps packages scripts
```

Expected: no matches except explicit negative tests and dev-tools-only routes. If any product-facing caller remains, migrate it before continuing.

- [ ] **Step 6: Run full suite before final verification**

Run:

```bash
pnpm test
```

Expected: PASS. If a failure is from an old helper path, do not patch around it; update the helper to the new Development Plan Item flow.

- [ ] **Step 7: Commit**

```bash
git add tests apps packages scripts
git commit -m "test: migrate legacy planning callers"
```

## Final Verification

- [ ] **Step 1: Confirm no uncommitted changes except intended final artifacts**

Run:

```bash
git status --short --branch
```

Expected: clean worktree on the implementation branch.

- [ ] **Step 2: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS. A known Nest negative-path log about `FORGELOOP_DEV_AUTH_SECRET` is acceptable only if the process exits 0.

- [ ] **Step 2a: Run the full AI-native product focused suite**

Run:

```bash
pnpm vitest run tests/contracts/project-management-contracts.test.ts tests/api/development-plans.test.ts tests/api/brainstorming.test.ts tests/api/spec-plan-service.test.ts tests/api/executions.test.ts tests/api/code-review-qa-handoff.test.ts tests/api/project-management-query.test.ts tests/web/app-shell-routing.test.tsx tests/web/project-management-routes.test.tsx tests/web/my-work-board-reports.test.tsx tests/web/ai-native-accessibility.test.tsx tests/web/ai-native-surface-states.test.tsx tests/web/development-plan-routes.test.tsx tests/web/spec-plan-lifecycle-actions.test.tsx tests/web/executions-routes.test.tsx tests/web/code-review-qa-handoff-routes.test.tsx tests/web/responsive-layout.test.tsx tests/web/design-system.test.tsx tests/e2e/web-product-routes.e2e.test.ts tests/e2e/ai-native-project-management-visual.e2e.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Run final naming and route scans**

Run:

```bash
rg -n "Work Item Owner|owner_actor_id|type: z.literal\\('work_item'\\)|type: z.literal\\('task'\\)|type: z.literal\\('plan'\\)|/tasks|route\\(['\"]plans|route\\(['\"]specs|path: ['\"]plans['\"]|path: ['\"]specs['\"]|/plans(/|['\"[:space:]]|$)|/specs(/|['\"[:space:]]|$)|work-items/.*/specs|work-items/.*/plans|requirements/.*/(spec|plan)|bugs/.*/(spec|plan)|tech-debt/.*/(spec|plan)|initiatives/.*/(spec|plan)|Execution Package Browser|Run Session Browser|Review Packet Browser|Raw Replay Browser|/replay|path: 'replay'" apps packages tests
```

Expected: no product-facing matches. Any remaining match must be an explicit negative test, internal-only storage schema, or existing Project/Release Owner domain where the wording is legitimate.

- [ ] **Step 5: Capture final screenshots**

Run:

```bash
FORGELOOP_WEB_BASE_URL=http://localhost:5173 pnpm vitest run tests/e2e/ai-native-project-management-visual.e2e.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS and screenshots written under `test-results/ai-native-project-management/`.

- [ ] **Step 6: Final commit if verification changes test fixtures or screenshots metadata**

```bash
git add tests test-results
git commit -m "test: capture ai-native project management visual baseline"
```

Skip this commit if screenshot artifacts are ignored and no files changed.
