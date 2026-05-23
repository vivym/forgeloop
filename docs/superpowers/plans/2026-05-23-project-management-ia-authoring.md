# Project Management IA And Authoring Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use @superpowers:subagent-driven-development (recommended) or @superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the lane/runtime-object Web product surface with a project-management IA, first-class Task workflow, MDXEditor narrative authoring, and safe Evidence Attachments without preserving legacy navigation or Work Item Owner baggage.

**Architecture:** Build the new product contract first, then make DB/API projections explicit, then replace Web API clients, routes, and pages destructively. Keep the existing Work Item storage shell for Initiative/Requirement/Bug/Tech Debt behind repository mappings, add Task and Attachment as first-class product objects, and move package/run/review pages under task-scoped evidence routes. The final branch must not contain active old route families, aliases, old/new switches, or product-facing generic Work Item Owner fields.

**Tech Stack:** TypeScript, Zod, NestJS, Drizzle ORM, PostgreSQL, React 19, React Router framework mode, Vite, Tailwind CSS v4, TanStack Query, React Hook Form, MDXEditor (`@mdxeditor/editor`), Testing Library, Vitest, Playwright.

---

## Scope Check

This spec spans contracts, DB/API, and Web, but it is one product-closure subsystem: the IA and authoring loop only works if the contracts, read models, routes, editor, attachments, and no-baggage cleanup land together. Do not split this into separate PRs that leave old routes, old public DTOs, or runtime object browsers active.

Implementation can use intermediate commits, but every committed task must pass its focused tests and the final branch must pass all no-baggage gates.

## Source Spec

- `docs/superpowers/specs/2026-05-23-project-management-ia-authoring-design.md`

## External Reference Checked

- MDXEditor package docs use `@mdxeditor/editor`, require a single `@mdxeditor/editor/style.css` import, and enable features through plugins such as `headingsPlugin`, `listsPlugin`, `quotePlugin`, `thematicBreakPlugin`, `tablePlugin`, `linkPlugin`, `linkDialogPlugin`, `imagePlugin`, `diffSourcePlugin`, `toolbarPlugin`, and `markdownShortcutPlugin`.
- MDXEditor image support accepts an `imageUploadHandler` for paste/drop/upload flows. The handler must return the Markdown image URL, so ForgeLoop must return only `attachment://<id>` from that handler, never a raw storage URL.
- MDXEditor toolbar controls require the corresponding feature plugins. Add toolbar controls only for the first-phase allowed Markdown subset.

## Existing Structure To Understand First

- Web route config is `apps/web/src/app/routes.ts`.
- Web app shell route is `apps/web/src/app/routes/_layout.tsx`.
- Current old route modules live under:
  - `apps/web/src/app/routes/lanes/**`
  - `apps/web/src/app/routes/pipeline/**`
  - `apps/web/src/app/routes/work-items/**`
  - `apps/web/src/app/routes/packages/**`
  - `apps/web/src/app/routes/runs/**`
  - `apps/web/src/app/routes/reviews/**`
  - `apps/web/src/app/routes/specs/index.tsx`
  - `apps/web/src/app/routes/plans/index.tsx`
- Current Web feature modules live under `apps/web/src/features/**`.
- Shared Web API clients live under `apps/web/src/shared/api/**`.
- Shared Web UI primitives live under `apps/web/src/shared/ui/**`.
- Shared Web layout primitives live under `apps/web/src/shared/layout/**`.
- Public contracts live under `packages/contracts/src/**`.
- Domain types live mainly in `packages/domain/src/types.ts` and related files.
- DB schemas live under `packages/db/src/schema/**`.
- DB repository contract is `packages/db/src/repositories/delivery-repository.ts`.
- In-memory and Drizzle repositories are:
  - `packages/db/src/repositories/in-memory-delivery-repository.ts`
  - `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Query projections live under `packages/db/src/queries/**`.
- Control-plane API modules live under `apps/control-plane-api/src/modules/**`.
- Web route tests and fixtures live under `tests/web/**`.
- API, contracts, DB, and naming tests live under `tests/api/**`, `tests/contracts/**`, `tests/db/**`, and `tests/naming/**`.

## Target File Structure

### Contracts

- Create: `packages/contracts/src/product-object-ref.ts`
  - Owns public `ObjectRef`, `EditableObjectRef`, and internal-only `LegacyWorkItemStorageRef` schemas.
- Create: `packages/contracts/src/attachments.ts`
  - Owns attachment upload metadata, public `AttachmentRef`, `AttachmentRenderRef`, and attachment API request/response schemas.
- Create: `packages/contracts/src/markdown-document.ts`
  - Owns `MarkdownDocument`, allowed Markdown policy schemas, safe link validation helpers, and shared validator entry points.
- Create: `packages/contracts/src/project-management.ts`
  - Owns typed list/detail read models: `MyWorkQueueItem`, `InitiativeListItem`, `InitiativeDetail`, `RequirementListItem`, `RequirementDetail`, `TechDebtListItem`, `TechDebtDetail`, `TaskListItem`, `TaskDetail`, `BugListItem`, `BugDetail`, `BoardCard`, and release readiness evidence refs.
- Modify: `packages/contracts/src/web-product-query.ts`
  - Replace public `ProductObjectRef` shape so product surfaces use typed refs rather than public `work_item` refs.
- Modify: `packages/contracts/src/index.ts`
  - Export new contracts.

### Domain And DB

- Create: `packages/domain/src/task.ts`
  - Owns Task domain type and task authority helpers.
- Create: `packages/domain/src/attachment.ts`
  - Owns Attachment domain type and safe status helpers.
- Modify: `packages/domain/src/types.ts`
  - Add `narrative_markdown` to Work Item domain shape for Initiative/Requirement/Bug/Tech Debt storage-backed typed surfaces.
- Modify: `packages/domain/src/index.ts`
  - Export Task and Attachment domain types.
- Modify: `packages/db/src/schema/work-item.ts`
  - Add `narrativeMarkdown` for typed Work Item narrative Markdown bodies.
- Create: `packages/db/src/schema/task.ts`
  - Adds first-class `tasks` table.
- Create: `packages/db/src/schema/attachment.ts`
  - Adds first-class `attachments` table and attachment links table.
- Modify: `packages/db/src/schema/execution-package.ts`
  - Add nullable `taskId` relation so packages can be task-scoped without changing historic Work Item storage into a public route.
- Modify: `packages/db/src/schema/index.ts`
  - Export new schemas.
- Modify: `packages/db/src/repositories/delivery-repository.ts`
  - Add Task and Attachment methods.
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
  - Implement Task and Attachment methods.
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
  - Implement Task and Attachment methods.
- Create: `packages/db/src/queries/project-management-queries.ts`
  - Owns new product read-model projections for My Work, typed object lists/details, task evidence ownership checks, board, and reports.

### API

- Create: `apps/control-plane-api/src/modules/tasks/tasks.controller.ts`
- Create: `apps/control-plane-api/src/modules/tasks/tasks.service.ts`
- Create: `apps/control-plane-api/src/modules/tasks/tasks.module.ts`
- Create: `apps/control-plane-api/src/modules/attachments/attachments.controller.ts`
- Create: `apps/control-plane-api/src/modules/attachments/attachments.service.ts`
- Create: `apps/control-plane-api/src/modules/attachments/attachments.module.ts`
- Create: `apps/control-plane-api/src/modules/markdown/markdown-document.service.ts`
- Create: `apps/control-plane-api/src/modules/markdown/markdown.module.ts`
- Modify: `apps/control-plane-api/src/modules/work-items/work-items.controller.ts`
  - Add typed narrative write endpoints for Requirements, Initiatives, Tech Debt, and Bugs without exposing product routes as generic Work Items.
- Modify: `apps/control-plane-api/src/modules/work-items/work-item.service.ts`
  - Persist Markdown narrative bodies through `MarkdownDocumentService`.
- Modify: `apps/control-plane-api/src/modules/tasks/tasks.controller.ts`
  - Add Task narrative write endpoint.
- Modify: `apps/control-plane-api/src/modules/tasks/tasks.service.ts`
  - Persist Task execution narrative through `MarkdownDocumentService`.
- Modify: `apps/control-plane-api/src/modules/delivery/delivery.module.ts`
  - Import Tasks, Attachments, and Markdown modules.
- Modify: `apps/control-plane-api/src/modules/query/query.controller.ts`
  - Add new project-management query endpoints and task-scoped evidence endpoints.
- Modify: `apps/control-plane-api/src/modules/query/query.service.ts`
  - Delegate to `project-management-queries.ts`.

### Web Shared API And Editor

- Modify: `apps/web/package.json`
  - Add `@mdxeditor/editor`.
- Modify: `pnpm-lock.yaml`
  - Updated by `pnpm --filter @forgeloop/web add @mdxeditor/editor`.
- Modify: `apps/web/src/shared/api/common.ts`
  - Add non-JSON multipart/raw request support.
- Create: `apps/web/src/shared/api/attachments.ts`
  - Attachment upload/list/metadata/link/update/delete/render-url client.
- Modify: `apps/web/src/shared/api/query.ts`
  - Add project-management query methods and remove product-facing old registry helpers once routes no longer use them.
- Modify: `apps/web/src/shared/api/commands.ts`
  - Add Task command methods and route old Work Item commands behind typed create flows only where still storage-backed.
- Modify: `apps/web/src/shared/api/query-keys.ts`
  - Add typed object and attachment query keys; remove old route-family keys after route migration.
- Modify: `apps/web/src/shared/api/types.ts`
  - Export new contract types.
- Create: `apps/web/src/shared/ui/markdown-editor/markdown-policy.ts`
- Create: `apps/web/src/shared/ui/markdown-editor/attachment-plugin.ts`
- Create: `apps/web/src/shared/ui/markdown-editor/markdown-editor.tsx`
- Create: `apps/web/src/shared/ui/markdown-editor/index.ts`
- Create: `apps/web/src/shared/ui/evidence-attachments/evidence-attachments.tsx`
- Create: `apps/web/src/shared/ui/evidence-attachments/index.ts`

### Web Routes And Features

- Create: `apps/web/src/app/routes/_index.tsx`
- Modify: `apps/web/src/app/routes.ts`
- Modify: `apps/web/src/app/routes/_layout.tsx`
- Create or modify route modules:
  - `apps/web/src/app/routes/dashboard/index.tsx`
  - `apps/web/src/app/routes/my-work/index.tsx`
  - `apps/web/src/app/routes/requirements/index.tsx`
  - `apps/web/src/app/routes/requirements/new.tsx`
  - `apps/web/src/app/routes/requirements/$requirementId.tsx`
  - `apps/web/src/app/routes/requirements/$requirementId/spec.tsx`
  - `apps/web/src/app/routes/requirements/$requirementId/plan.tsx`
  - `apps/web/src/app/routes/requirements/$requirementId/evidence.tsx`
  - `apps/web/src/app/routes/initiatives/index.tsx`
  - `apps/web/src/app/routes/initiatives/new.tsx`
  - `apps/web/src/app/routes/initiatives/$initiativeId.tsx`
  - `apps/web/src/app/routes/initiatives/$initiativeId/evidence.tsx`
  - `apps/web/src/app/routes/tech-debt/index.tsx`
  - `apps/web/src/app/routes/tech-debt/new.tsx`
  - `apps/web/src/app/routes/tech-debt/$techDebtId.tsx`
  - `apps/web/src/app/routes/tech-debt/$techDebtId/evidence.tsx`
  - `apps/web/src/app/routes/specs-plans/index.tsx`
  - `apps/web/src/app/routes/tasks/index.tsx`
  - `apps/web/src/app/routes/tasks/new.tsx`
  - `apps/web/src/app/routes/tasks/$taskId.tsx`
  - `apps/web/src/app/routes/tasks/$taskId/packages/$packageId.tsx`
  - `apps/web/src/app/routes/tasks/$taskId/runs/$runSessionId.tsx`
  - `apps/web/src/app/routes/tasks/$taskId/reviews/$reviewPacketId.tsx`
  - `apps/web/src/app/routes/bugs/index.tsx`
  - `apps/web/src/app/routes/bugs/new.tsx`
  - `apps/web/src/app/routes/bugs/$bugId.tsx`
  - `apps/web/src/app/routes/bugs/$bugId/evidence.tsx`
  - `apps/web/src/app/routes/board/index.tsx`
  - `apps/web/src/app/routes/releases/index.tsx`
  - `apps/web/src/app/routes/releases/$releaseId.tsx`
  - `apps/web/src/app/routes/releases/$releaseId/evidence.tsx`
  - `apps/web/src/app/routes/reports/index.tsx`
  - `apps/web/src/app/routes/reports/delivery.tsx`
  - `apps/web/src/app/routes/reports/quality.tsx`
  - `apps/web/src/app/routes/reports/release-readiness.tsx`
  - `apps/web/src/app/routes/reports/observation.tsx`
  - `apps/web/src/app/routes/reports/replay.tsx`
- Delete old active route modules after their replacements are passing:
  - `apps/web/src/app/routes/lanes/**`
  - `apps/web/src/app/routes/pipeline/**`
  - `apps/web/src/app/routes/work-items/**`
  - `apps/web/src/app/routes/packages/**`
  - `apps/web/src/app/routes/runs/**`
  - `apps/web/src/app/routes/reviews/**`
  - `apps/web/src/app/routes/specs/index.tsx`
  - `apps/web/src/app/routes/plans/index.tsx`
- Create feature folders:
  - `apps/web/src/features/project-management/**`
  - `apps/web/src/features/my-work/**`
  - `apps/web/src/features/requirements/**`
  - `apps/web/src/features/initiatives/**`
  - `apps/web/src/features/tech-debt/**`
  - `apps/web/src/features/tasks/**`
  - `apps/web/src/features/bugs/**`
  - `apps/web/src/features/board/**`
  - `apps/web/src/features/reports/**`
- Modify/keep:
  - `apps/web/src/features/spec-plan/spec-plan-direct-routes.tsx`
  - `apps/web/src/features/spec-plan/spec-plan-lifecycle-actions.tsx`
  - `apps/web/src/features/releases/release-routes.tsx`
  - `apps/web/src/features/releases/release-action-rail.tsx`
- Delete/refactor after replacements are active:
  - `apps/web/src/features/product-lanes/**`
  - `apps/web/src/features/pipeline/**`
  - `apps/web/src/features/work-items/work-items-list.tsx`
  - `apps/web/src/features/work-items/work-item-detail.tsx`
  - `apps/web/src/features/work-items/create-work-item-form.tsx`
  - `apps/web/src/features/work-items/delivery-cockpit/**`
  - `apps/web/src/features/execution-packages/execution-package-routes.tsx`
  - `apps/web/src/features/run-console/run-console-routes.tsx`
  - `apps/web/src/features/review-packets/review-packet-routes.tsx`
  - `apps/web/src/features/spec-plan/spec-plan-work-item-flow.tsx`

### Tests

- Create:
  - `tests/contracts/project-management-contracts.test.ts`
  - `tests/contracts/project-management-readiness.test.ts`
  - `tests/contracts/attachments.test.ts`
  - `tests/contracts/markdown-document.test.ts`
  - `tests/db/task-repository.test.ts`
  - `tests/db/attachment-repository.test.ts`
  - `tests/api/tasks.test.ts`
  - `tests/api/attachments.test.ts`
  - `tests/api/markdown-document.test.ts`
  - `tests/api/project-management-query.test.ts`
  - `tests/api/task-scoped-evidence.test.ts`
  - `tests/api/project-management-release-readiness.test.ts`
  - `tests/web/markdown-editor.test.tsx`
  - `tests/web/markdown-editor-attachments.test.tsx`
  - `tests/web/attachment-api.test.ts`
  - `tests/web/attachment-evidence-rendering.test.tsx`
  - `tests/web/my-work-route.test.tsx`
  - `tests/web/project-management-routes.test.tsx`
  - `tests/web/task-scoped-evidence-routes.test.tsx`
  - `tests/web/board-reports-release-readiness.test.tsx`
- Modify:
  - `tests/web/router-test-utils.tsx`
  - `tests/web/app-shell-routing.test.tsx`
  - `tests/web/a11y-gates.test.tsx`
  - `tests/web/responsive-layout.test.tsx`
  - `tests/web/dev-tools-gating.test.tsx`
  - `tests/web/api-hooks.test.tsx`
  - `tests/web/fixtures/product-api-mock.ts`
  - `tests/web/fixtures/product-data.ts`
  - `tests/e2e/web-product-routes.e2e.test.ts`
  - `tests/e2e/run-console.e2e.test.ts`
  - `tests/web/no-legacy-web-ui.test.ts`
  - `tests/naming/delivery-naming.test.ts`
- Delete or replace:
  - `tests/web/product-lanes-route.test.tsx`
  - `tests/web/pipeline-product-route.test.tsx`
  - `tests/web/work-item-product-route.test.tsx`
  - `tests/web/work-item-intake-form.test.tsx`
  - `tests/web/work-item-delivery-cockpit.test.tsx`
  - `tests/web/package-run-product-routes.test.tsx`
  - `tests/web/review-release-product-routes.test.tsx`
  - `tests/web/spec-plan-product-route.test.tsx`
  - `tests/web/spec-plan-direct-routes.test.tsx`

## Implementation Rules

- Do not create route aliases, redirects, or compatibility components for removed route families.
- `/` may redirect only to `/my-work`.
- Removed route families must no-match: `/lanes`, `/pipeline`, `/work-items`, `/packages`, `/runs`, `/reviews`, `/specs`, and `/plans` exact list routes.
- Direct `/specs/:specId`, `/specs/:specId/revisions/:revisionId`, `/plans/:planId`, and `/plans/:planId/revisions/:revisionId` remain active.
- Public product DTOs must use typed refs such as `{ type: 'requirement', id }`, not public `{ type: 'work_item', kind }`.
- `LegacyWorkItemStorageRef` is allowed only inside repository/storage mapping code.
- Product-facing Work Item types use `driver_actor_id`, never public `owner_actor_id`.
- Legitimate non-Work-Item owner fields remain allowed for Project, Execution Package, QA/Test, Release, and review ownership.
- Task is a first-class developer object and must not be represented as a Work Item kind.
- Runtime package generation and enqueue from Task require current approved SpecRevision and PlanRevision.
- `manual_exception` is audit/manual-work tracking only; it must not authorize package generation, enqueue, review/test gates, or release readiness.
- Markdown validation must be enforced server-side through shared contracts. Browser validation is fast feedback only.
- Control-plane controller tests use unprefixed API routes such as `/attachments` and `/tasks`; browser-facing attachment render URLs returned in DTOs must be same-origin `/api/attachments/...` proxy URLs. Do not add `/api` to controller route declarations just because render URLs contain it.
- Attachments must use opaque same-origin render URLs. Do not expose `storage_uri`, object-store hostnames, signed query params, or private origins in public DTOs, Markdown, href, or src.
- MDXEditor must be wrapped in ForgeLoop-owned components. Do not scatter raw MDXEditor imports across product pages.
- The final implementation must not leave old route modules imported by `apps/web/src/app/routes.ts` or `tests/web/router-test-utils.tsx`.
- DB schema changes are destructive source-of-truth changes in this pre-launch slice. After adding or changing Drizzle schema files, apply them to a safe local/dev database with `pnpm db:push`; if no safe `DATABASE_URL` is available, record that as a blocker and do not claim durable DB runtime readiness.

## Task 0: Baseline And Dependency Check

**Files:**
- Read: `docs/superpowers/specs/2026-05-23-project-management-ia-authoring-design.md`
- Read: `apps/web/src/app/routes.ts`
- Read: `apps/web/src/shared/api/query.ts`
- Read: `packages/contracts/src/web-product-query.ts`
- Read: `packages/contracts/src/work-item-intake.ts`
- Read: `packages/db/src/repositories/delivery-repository.ts`
- Read: `tests/web/router-test-utils.tsx`

- [ ] **Step 1: Confirm branch and worktree**

Run:

```bash
git status --short --branch
```

Expected: implementation branch is selected and no unrelated uncommitted files are present.

- [ ] **Step 2: Install dependencies**

Run:

```bash
pnpm --filter @forgeloop/web add @mdxeditor/editor
```

Expected: `apps/web/package.json` and `pnpm-lock.yaml` change, and no other files change.

- [ ] **Step 3: Verify baseline type/test commands still start**

Run:

```bash
pnpm vitest run tests/contracts/work-item-intake.test.ts tests/web/app-shell-routing.test.tsx
pnpm --filter @forgeloop/web typecheck
```

Expected: baseline may pass or fail only because the branch is about to replace old route assertions. Record failures before editing so implementation failures are not confused with existing state.

- [ ] **Step 4: Commit dependency-only change**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore: add mdxeditor dependency"
```

## Task 1: Contract Foundation For Typed Product Objects, Markdown, Attachments, And Tasks

**Files:**
- Create: `packages/contracts/src/product-object-ref.ts`
- Create: `packages/contracts/src/attachments.ts`
- Create: `packages/contracts/src/markdown-document.ts`
- Create: `packages/contracts/src/project-management.ts`
- Modify: `packages/contracts/src/web-product-query.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `tests/contracts/project-management-contracts.test.ts`
- Test: `tests/contracts/project-management-readiness.test.ts`
- Test: `tests/contracts/attachments.test.ts`
- Test: `tests/contracts/markdown-document.test.ts`

- [ ] **Step 1: Write failing contract tests for typed refs and no public Work Item owner**

Add tests like:

```ts
import { describe, expect, it } from 'vitest';
import {
  editableObjectRefSchema,
  legacyWorkItemStorageRefSchema,
  objectRefSchema,
  productListItemSchema,
  taskDetailSchema,
} from '@forgeloop/contracts';

describe('project management typed object contracts', () => {
  it('accepts typed product refs and keeps work_item storage refs internal only', () => {
    expect(objectRefSchema.parse({ type: 'requirement', id: 'wi-req' })).toEqual({ type: 'requirement', id: 'wi-req' });
    expect(objectRefSchema.parse({ type: 'task', id: 'task-1' })).toEqual({ type: 'task', id: 'task-1' });
    expect(() => objectRefSchema.parse({ type: 'work_item', id: 'wi-1' })).toThrow();
    expect(legacyWorkItemStorageRefSchema.parse({ type: 'work_item', id: 'wi-1', work_item_kind: 'initiative' })).toEqual({
      type: 'work_item',
      id: 'wi-1',
      work_item_kind: 'initiative',
    });
  });

  it('uses driver_actor_id on editable Work Item typed surfaces', () => {
    expect(editableObjectRefSchema.parse({ type: 'tech_debt', id: 'td-1', driver_actor_id: 'actor-tech' })).toMatchObject({
      type: 'tech_debt',
      driver_actor_id: 'actor-tech',
    });
    expect(() => editableObjectRefSchema.parse({ type: 'requirement', id: 'req-1', owner_actor_id: 'actor-owner' })).toThrow();
  });

  it('requires approved Spec and Plan authority for runtime package eligible tasks', () => {
    const task = taskDetailSchema.parse({
      id: 'task-1',
      title: 'Implement checkout validation',
      parent_ref: { type: 'requirement', id: 'req-1' },
      controlling_spec_revision_id: 'spec-rev-1',
      controlling_plan_revision_id: 'plan-rev-1',
      stale_state: 'current',
      package_generation_eligible: true,
    });
    expect(task.package_generation_eligible).toBe(true);
  });

  it('does not let manual exceptions authorize runtime packages', () => {
    expect(() =>
      taskDetailSchema.parse({
        id: 'task-manual',
        title: 'Emergency manual follow-up',
        stale_state: 'manual_exception',
        package_generation_eligible: true,
        audited_exception: {
          exception_id: 'ex-1',
          actor_id: 'actor-tech',
          reason: 'Manual work before plan approval',
          risk: 'high',
          rollback_plan: 'Revert manual change',
          verification_ref: { type: 'audited_exception_decision', id: 'decision-1' },
          supporting_attachment_refs: [],
          release_impact: 'release_scoped',
          created_at: '2026-05-23T00:00:00.000Z',
        },
      }),
    ).toThrow(/manual_exception/i);
  });

  it('rejects public product list items that expose work_item refs or owner_actor_id', () => {
    expect(() =>
      productListItemSchema.parse({
        id: 'row-1',
        object: { type: 'work_item', id: 'wi-1', title: 'Legacy row' },
        title: 'Legacy row',
        owner_actor_id: 'actor-owner',
        updated_at: '2026-05-23T00:00:00.000Z',
      }),
    ).toThrow();
  });
});
```

Run:

```bash
pnpm vitest run tests/contracts/project-management-contracts.test.ts
```

Expected: FAIL because new exports do not exist.

- [ ] **Step 2: Write failing release readiness contract tests**

In `tests/contracts/project-management-readiness.test.ts`, add:

```ts
import { describe, expect, it } from 'vitest';
import {
  evidenceRequirementStatusSchema,
  releaseReadinessDetailSchema,
  reviewEvidenceRefSchema,
  testAcceptanceEvidenceRefSchema,
} from '@forgeloop/contracts';

const releaseScope = [
  { type: 'initiative', id: 'init-1' },
  { type: 'requirement', id: 'req-1' },
  { type: 'tech_debt', id: 'td-1' },
  { type: 'task', id: 'task-1' },
  { type: 'bug', id: 'bug-1' },
] as const;

describe('project management release readiness contracts', () => {
  it('accepts typed review and test evidence authority', () => {
    expect(reviewEvidenceRefSchema.parse({
      id: 'review-evidence-1',
      authority_type: 'human_review_decision',
      authority_ref: { type: 'human_review_decision', id: 'decision-1' },
      scope_ref: { type: 'requirement', id: 'req-1' },
      status: 'approved',
      required: true,
      attachment_refs: [],
    })).toMatchObject({ status: 'approved' });

    expect(testAcceptanceEvidenceRefSchema.parse({
      id: 'qa-evidence-1',
      scope_ref: { type: 'task', id: 'task-1' },
      evidence_type: 'qa_acceptance',
      status: 'passed',
      required: true,
      attachment_refs: [],
    })).toMatchObject({ status: 'passed' });
  });

  it('rejects freeform notes, ai self-review, and bare attachments as gate authority', () => {
    expect(() => reviewEvidenceRefSchema.parse({
      id: 'review-evidence-2',
      authority_type: 'ai_self_review_approval',
      scope_ref: { type: 'requirement', id: 'req-1' },
      status: 'approved',
      required: true,
      attachment_refs: [],
    })).toThrow();

    expect(() => evidenceRequirementStatusSchema.parse({
      requirement_id: 'gate-1',
      scope_ref: { type: 'requirement', id: 'req-1' },
      kind: 'review',
      status: 'passed',
      evidence_ref: { type: 'attachment', id: 'att-1' },
    })).toThrow();
  });

  it('models disabled reasons for missing, stale, wrong-scope, unauthorized, and tombstoned evidence', () => {
    const readiness = releaseReadinessDetailSchema.parse({
      release_id: 'release-1',
      scope_refs: releaseScope,
      ready: false,
      required_review_evidence: [
        gate('missing_required_review', 'review', 'missing'),
        gate('evidence_stale', 'review', 'stale'),
        gate('evidence_scope_mismatch', 'review', 'blocked'),
      ],
      required_test_acceptance_evidence: [
        gate('missing_required_test_acceptance', 'qa_acceptance', 'missing'),
        gate('evidence_unauthorized', 'qa_acceptance', 'unauthorized'),
        gate('evidence_tombstoned', 'qa_acceptance', 'tombstoned'),
      ],
      package_run_evidence: [],
      observation_evidence: [],
      disabled_reasons: [
        disabled('missing_required_review'),
        disabled('evidence_stale'),
        disabled('evidence_scope_mismatch'),
        disabled('missing_required_test_acceptance'),
        disabled('evidence_unauthorized'),
        disabled('evidence_tombstoned'),
      ],
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.disabled_reasons.map((reason) => reason.code)).toContain('evidence_scope_mismatch');
  });
});
```

Define local helpers `gate()` and `disabled()` in the test file. They should return schema-shaped objects with typed `scope_ref` and product-safe messages.

Run:

```bash
pnpm vitest run tests/contracts/project-management-readiness.test.ts
```

Expected: FAIL until readiness schemas are implemented.

- [ ] **Step 3: Write failing attachment contract tests**

Add tests like:

```ts
import { describe, expect, it } from 'vitest';
import {
  attachmentRefSchema,
  attachmentRenderRefSchema,
  attachmentUploadMetadataSchema,
} from '@forgeloop/contracts';

describe('attachment contracts', () => {
  it('accepts typed owner objects and public metadata without storage_uri', () => {
    const attachment = attachmentRefSchema.parse({
      id: 'att-1',
      owner_object_type: 'requirement',
      owner_object_id: 'req-1',
      linked_object_refs: [{ type: 'task', id: 'task-1' }],
      filename: 'checkout.png',
      content_type: 'image/png',
      size_bytes: 1200,
      checksum_sha256: 'a'.repeat(64),
      uploaded_by_actor_id: 'actor-product',
      created_at: '2026-05-23T00:00:00.000Z',
      evidence_category: 'image',
      visibility: 'object',
      safety_status: 'passed',
      reference_status: 'active',
    });
    expect('storage_uri' in attachment).toBe(false);
  });

  it('rejects raw storage render urls', () => {
    expect(() =>
      attachmentRenderRefSchema.parse({
        attachment_id: 'att-1',
        render_url: 'https://bucket.example.com/private/key?signature=raw',
        expires_at: '2026-05-23T00:05:00.000Z',
        content_type: 'image/png',
        disposition: 'inline',
      }),
    ).toThrow(/same-origin/i);
  });

  it('parses upload metadata without accepting binary content in JSON', () => {
    expect(attachmentUploadMetadataSchema.parse({
      object_type: 'tech_debt',
      object_id: 'td-1',
      evidence_category: 'log',
      visibility: 'object',
    })).toMatchObject({ object_type: 'tech_debt' });
  });
});
```

Run:

```bash
pnpm vitest run tests/contracts/attachments.test.ts
```

Expected: FAIL because attachment schemas do not exist.

- [ ] **Step 4: Write failing Markdown contract tests**

Add tests like:

```ts
import { describe, expect, it } from 'vitest';
import {
  markdownDocumentSchema,
  validateMarkdownDocument,
} from '@forgeloop/contracts';

const baseDocument = {
  object_ref: { type: 'requirement', id: 'req-1', driver_actor_id: 'actor-product' },
  allowed_blocks: ['paragraph', 'heading', 'list', 'link', 'image'],
  attachment_refs: [
    {
      id: 'att-1',
      owner_object_type: 'requirement',
      owner_object_id: 'req-1',
      linked_object_refs: [],
      filename: 'flow.png',
      content_type: 'image/png',
      size_bytes: 42,
      checksum_sha256: 'b'.repeat(64),
      uploaded_by_actor_id: 'actor-product',
      created_at: '2026-05-23T00:00:00.000Z',
      evidence_category: 'image',
      visibility: 'object',
      safety_status: 'passed',
      reference_status: 'active',
    },
  ],
  validation_version: '2026-05-23',
} as const;

describe('MarkdownDocument validation', () => {
  it('accepts attachment references and safe product links', () => {
    const result = validateMarkdownDocument({
      ...baseDocument,
      markdown: 'See [task](/tasks/task-1)\\n\\n![flow](attachment://att-1)',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects raw html, javascript links, data urls, blob urls, and raw storage urls', () => {
    for (const markdown of [
      '<iframe src="https://example.com"></iframe>',
      '[bad](javascript:alert(1))',
      '![bad](data:image/png;base64,aaaa)',
      '![bad](blob:https://example.com/1)',
      '![bad](https://bucket.example.com/private/key?signature=raw)',
    ]) {
      expect(validateMarkdownDocument({ ...baseDocument, markdown }).ok).toBe(false);
    }
  });

  it('rejects unresolved attachment refs', () => {
    const result = validateMarkdownDocument({
      ...baseDocument,
      markdown: '![missing](attachment://att-missing)',
    });
    expect(result.ok).toBe(false);
  });

  it('exposes a strict persisted document schema', () => {
    expect(() => markdownDocumentSchema.parse({ ...baseDocument, markdown: 'body', raw_html: '<b>bad</b>' })).toThrow();
  });
});
```

Run:

```bash
pnpm vitest run tests/contracts/markdown-document.test.ts
```

Expected: FAIL because Markdown contracts do not exist.

- [ ] **Step 5: Implement product object refs**

In `packages/contracts/src/product-object-ref.ts`, add:

```ts
import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);

export const objectRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('initiative'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('requirement'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('bug'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('tech_debt'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('task'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('spec'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('spec_revision'), id: nonEmpty, spec_id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('plan'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('plan_revision'), id: nonEmpty, plan_id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('execution_package'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('run_session'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('review_packet'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('release'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('attachment'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
]);
export type ObjectRef = z.infer<typeof objectRefSchema>;

export const editableObjectRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('initiative'), id: nonEmpty, driver_actor_id: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('requirement'), id: nonEmpty, driver_actor_id: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('bug'), id: nonEmpty, driver_actor_id: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('tech_debt'), id: nonEmpty, driver_actor_id: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('task'), id: nonEmpty }).strict(),
  z.object({ type: z.literal('spec'), id: nonEmpty }).strict(),
  z.object({ type: z.literal('plan'), id: nonEmpty }).strict(),
  z.object({ type: z.literal('release'), id: nonEmpty }).strict(),
]);
export type EditableObjectRef = z.infer<typeof editableObjectRefSchema>;

export const legacyWorkItemStorageRefSchema = z
  .object({
    type: z.literal('work_item'),
    id: nonEmpty,
    work_item_kind: z.enum(['initiative', 'requirement', 'bug', 'tech_debt']),
  })
  .strict();
export type LegacyWorkItemStorageRef = z.infer<typeof legacyWorkItemStorageRefSchema>;
```

- [ ] **Step 6: Implement attachment contracts**

In `packages/contracts/src/attachments.ts`, add schemas for owner object type, category, upload metadata, public ref, render ref, link, patch, and delete responses. `attachmentRenderRefSchema` must reject non-same-origin API/proxy paths:

```ts
const sameOriginRenderUrlSchema = z.string().trim().min(1).superRefine((value, ctx) => {
  if (!value.startsWith('/api/attachments/')) {
    ctx.addIssue({ code: 'custom', message: 'render_url must be a same-origin attachment API URL' });
  }
  if (/storage|bucket|s3|signature|X-Amz|https?:\/\//i.test(value)) {
    ctx.addIssue({ code: 'custom', message: 'render_url must not expose raw storage details' });
  }
});
```

- [ ] **Step 7: Implement MarkdownDocument validator**

In `packages/contracts/src/markdown-document.ts`, implement:

```ts
export type MarkdownValidationIssue = {
  code:
    | 'raw_html'
    | 'unsafe_protocol'
    | 'raw_storage_url'
    | 'base64_or_blob'
    | 'unresolved_attachment'
    | 'unsupported_block';
  message: string;
};

export type MarkdownValidationResult =
  | { ok: true; markdown: string; attachment_ids: string[] }
  | { ok: false; issues: MarkdownValidationIssue[] };
```

Use conservative string scanning for the first implementation:

```ts
const htmlPattern = /<\/?[a-z][\s\S]*?>/i;
const unsafeDestinationPattern = /\]\((?:javascript:|data:|file:|blob:|https?:\/\/[^)\s]*(?:bucket|storage|s3|signature|X-Amz)[^)\s]*)\)/i;
const imageUnsafePattern = /!\[[^\]]*]\((?:data:|file:|blob:|https?:\/\/[^)\s]*(?:bucket|storage|s3|signature|X-Amz)[^)\s]*)\)/i;
const attachmentRefPattern = /attachment:\/\/([A-Za-z0-9_-]+)/g;
```

Return all issues found; do not stop at the first failure.

- [ ] **Step 8: Implement project-management read models**

In `packages/contracts/src/project-management.ts`, add the read models from the spec. Important schema rules:

```ts
const reviewedAuthoritySchema = z.enum(['review_packet_approval', 'human_review_decision']);
const taskStaleStateSchema = z.enum(['current', 'stale_spec', 'stale_plan', 'stale_parent', 'manual_exception']);

export const taskDetailSchema = z
  .object({
    id: nonEmpty,
    title: nonEmpty,
    parent_ref: objectRefSchema.optional(),
    controlling_spec_revision_id: nonEmpty.optional(),
    controlling_plan_revision_id: nonEmpty.optional(),
    stale_state: taskStaleStateSchema,
    package_generation_eligible: z.boolean().default(false),
    audited_exception: auditedExceptionSchema.optional(),
  })
  .strict()
  .superRefine((task, ctx) => {
    if (task.package_generation_eligible) {
      if (!task.controlling_spec_revision_id || !task.controlling_plan_revision_id || task.stale_state !== 'current') {
        ctx.addIssue({
          code: 'custom',
          path: ['package_generation_eligible'],
          message: 'package generation requires current approved Spec and Plan revision authority',
        });
      }
    }
    if (task.stale_state === 'manual_exception' && task.package_generation_eligible) {
      ctx.addIssue({
        code: 'custom',
        path: ['audited_exception'],
        message: 'manual_exception cannot authorize runtime package generation',
      });
    }
  });
```

- [ ] **Step 9: Replace public ProductObjectRef**

In `packages/contracts/src/web-product-query.ts`, import `objectRefSchema` and replace the old enum that includes `work_item`. Keep `ProductListQuery` internal filters only where they still support non-product registries, but remove public `owner_actor_id` from product list item output.

- [ ] **Step 10: Export contracts**

In `packages/contracts/src/index.ts`, export:

```ts
export * from './product-object-ref.js';
export * from './attachments.js';
export * from './markdown-document.js';
export * from './project-management.js';
```

- [ ] **Step 11: Run contract tests**

Run:

```bash
pnpm vitest run tests/contracts/project-management-contracts.test.ts tests/contracts/project-management-readiness.test.ts tests/contracts/attachments.test.ts tests/contracts/markdown-document.test.ts
pnpm --filter @forgeloop/contracts build
```

Expected: PASS.

- [ ] **Step 12: Commit contracts**

```bash
git add packages/contracts/src tests/contracts/project-management-contracts.test.ts tests/contracts/project-management-readiness.test.ts tests/contracts/attachments.test.ts tests/contracts/markdown-document.test.ts
git commit -m "feat: add project management product contracts"
```

## Task 2: DB And Domain Foundation For Task And Attachment

**Files:**
- Create: `packages/domain/src/task.ts`
- Create: `packages/domain/src/attachment.ts`
- Modify: `packages/domain/src/types.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/db/src/schema/work-item.ts`
- Create: `packages/db/src/schema/task.ts`
- Create: `packages/db/src/schema/attachment.ts`
- Modify: `packages/db/src/schema/execution-package.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Test: `tests/db/task-repository.test.ts`
- Test: `tests/db/attachment-repository.test.ts`
- Test: `tests/db/schema.test.ts`

- [ ] **Step 1: Write failing Task repository tests**

Add tests using the existing repository fixture style from `tests/db/repository-contract.ts`. Cover the in-memory repository directly and any Drizzle repository harness already used by adjacent `tests/db/*` files; if no Drizzle harness exists for this specific file, keep durable Postgres coverage in Step 9 through `pnpm db:push`. Minimal behavior:

```ts
it('saves and reads first-class Tasks with approved revision authority', async () => {
  const repository = createRepository();
  await seedProjectActorWorkItemSpecPlan(repository);
  await repository.saveTask({
    id: 'task-1',
    project_id: 'project-1',
    title: 'Implement checkout guard',
    execution_brief: 'Add validation and tests.',
    acceptance_checklist: ['Validation rejects unsafe input'],
    status: 'ready',
    parent_ref: { type: 'requirement', id: 'req-1' },
    controlling_spec_revision_id: 'spec-rev-1',
    controlling_plan_revision_id: 'plan-rev-1',
    stale_state: 'current',
    created_at: '2026-05-23T00:00:00.000Z',
    updated_at: '2026-05-23T00:00:00.000Z',
  });

  expect(await repository.getTask('task-1')).toMatchObject({
    id: 'task-1',
    parent_ref: { type: 'requirement', id: 'req-1' },
    stale_state: 'current',
  });
});

it('links execution packages to tasks without exposing package registries as product pages', async () => {
  await repository.linkExecutionPackageToTask({ task_id: 'task-1', execution_package_id: 'pkg-1' });
  expect(await repository.getTaskForExecutionPackage('pkg-1')).toMatchObject({ id: 'task-1' });
});

it('persists narrative Markdown on storage-backed typed Work Items and Tasks', async () => {
  await repository.saveWorkItem({ ...requirementFixture, id: 'req-1', narrative_markdown: '# Requirement brief' });
  await repository.saveTask({ ...taskFixture, id: 'task-1', narrative_markdown: '# Task execution brief' });

  expect(await repository.getWorkItem('req-1')).toMatchObject({ narrative_markdown: '# Requirement brief' });
  expect(await repository.getTask('task-1')).toMatchObject({ narrative_markdown: '# Task execution brief' });
});
```

Define `requirementFixture` and `taskFixture` in this test file using the existing repository fixture pattern from `tests/db/repository-contract.ts`; they must include all required fields so the snippets compile.

Run:

```bash
pnpm vitest run tests/db/task-repository.test.ts
```

Expected: FAIL because repository methods and task schema do not exist.

- [ ] **Step 2: Write failing Attachment repository tests**

Add tests:

```ts
it('stores attachments with internal storage_uri and returns public refs without storage_uri', async () => {
  await repository.saveAttachment({
    id: 'att-1',
    owner_object_type: 'requirement',
    owner_object_id: 'req-1',
    linked_object_refs: [],
    filename: 'flow.png',
    content_type: 'image/png',
    size_bytes: 42,
    storage_uri: 'memory://attachments/att-1',
    checksum_sha256: 'c'.repeat(64),
    uploaded_by_actor_id: 'actor-product',
    created_at: '2026-05-23T00:00:00.000Z',
    evidence_category: 'image',
    visibility: 'object',
    safety_status: 'passed',
    reference_status: 'active',
  });

  const attachment = await repository.getAttachment('att-1');
  expect(attachment?.storage_uri).toBe('memory://attachments/att-1');
  expect(await repository.listAttachmentsForObject('requirement', 'req-1')).toHaveLength(1);
});

it('archives referenced attachments instead of hard deleting them', async () => {
  await repository.linkAttachmentToObject('att-1', { type: 'task', id: 'task-1' });
  await repository.archiveAttachment('att-1', '2026-05-23T00:05:00.000Z');
  expect(await repository.getAttachment('att-1')).toMatchObject({ reference_status: 'archived' });
});
```

Run:

```bash
pnpm vitest run tests/db/attachment-repository.test.ts
```

Expected: FAIL because attachment schema and methods do not exist.

- [ ] **Step 3: Add domain Task type**

In `packages/domain/src/task.ts`, add:

```ts
import type { AttachmentRef, ObjectRef } from '@forgeloop/contracts';

export type TaskStatus = 'draft' | 'ready' | 'in_progress' | 'blocked' | 'review' | 'done' | 'cancelled';
export type TaskStaleState = 'current' | 'stale_spec' | 'stale_plan' | 'stale_parent' | 'manual_exception';

export interface Task {
  id: string;
  project_id: string;
  title: string;
  narrative_markdown: string;
  execution_brief: string;
  acceptance_checklist: string[];
  status: TaskStatus;
  parent_ref?: ObjectRef;
  controlling_spec_revision_id?: string;
  controlling_plan_revision_id?: string;
  stale_state: TaskStaleState;
  audited_exception?: {
    exception_id: string;
    actor_id: string;
    reason: string;
    risk: 'low' | 'medium' | 'high' | 'critical';
    rollback_plan: string;
    verification_ref: { type: 'audited_exception_decision'; id: string };
    supporting_attachment_refs: AttachmentRef[];
    release_impact: 'none' | 'release_scoped';
    created_at: string;
  };
  created_at: string;
  updated_at: string;
}

export function canGenerateRuntimePackageForTask(task: Task): boolean {
  return (
    task.stale_state === 'current' &&
    task.controlling_spec_revision_id !== undefined &&
    task.controlling_plan_revision_id !== undefined
  );
}
```

- [ ] **Step 4: Add domain Attachment type**

In `packages/domain/src/attachment.ts`, mirror `AttachmentRecord` from the spec including internal `storage_uri`.

- [ ] **Step 5: Add narrative Markdown to storage-backed Work Items**

In `packages/domain/src/types.ts`, add `narrative_markdown: string` to `WorkItem`.

In `packages/db/src/schema/work-item.ts`, add:

```ts
narrativeMarkdown: text('narrative_markdown').notNull().default(''),
```

Update all Work Item serialization/mapping code in in-memory and Drizzle repositories. Existing fixtures can use an empty string by default, but public typed detail read models must expose narrative Markdown.

- [ ] **Step 6: Add DB schemas**

In `packages/db/src/schema/task.ts`, add a first-class table:

```ts
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  title: text('title').notNull(),
  narrativeMarkdown: text('narrative_markdown').notNull().default(''),
  executionBrief: text('execution_brief').notNull(),
  acceptanceChecklist: jsonb('acceptance_checklist').$type<string[]>().notNull(),
  status: text('status').notNull(),
  parentRef: jsonb('parent_ref').$type<ObjectRef>(),
  controllingSpecRevisionId: uuid('controlling_spec_revision_id'),
  controllingPlanRevisionId: uuid('controlling_plan_revision_id'),
  staleState: text('stale_state').notNull(),
  auditedException: jsonb('audited_exception').$type<Task['audited_exception']>(),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});
```

In `packages/db/src/schema/attachment.ts`, add:

```ts
export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerObjectType: text('owner_object_type').notNull(),
  ownerObjectId: text('owner_object_id').notNull(),
  linkedObjectRefs: jsonb('linked_object_refs').$type<ObjectRef[]>().notNull(),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageUri: text('storage_uri').notNull(),
  checksumSha256: text('checksum_sha256').notNull(),
  uploadedByActorId: text('uploaded_by_actor_id').notNull(),
  createdAt: timestampColumn('created_at').notNull(),
  evidenceCategory: text('evidence_category').notNull(),
  caption: text('caption'),
  altText: text('alt_text'),
  visibility: text('visibility').notNull(),
  safetyStatus: text('safety_status').notNull(),
  referenceStatus: text('reference_status').notNull(),
});
```

- [ ] **Step 7: Add package to task relation**

In `packages/db/src/schema/execution-package.ts`, add nullable `taskId`. Update Drizzle mappings so old rows remain readable, but new task-scoped packages can be validated by `taskId`.

- [ ] **Step 8: Extend repository interface and implementations**

Add methods to `DeliveryRepository`:

```ts
saveTask(task: Task): Promise<void>;
getTask(taskId: string): Promise<Task | undefined>;
listTasks(projectId?: string): Promise<Task[]>;
listTasksForParent(parentRef: ObjectRef): Promise<Task[]>;
updateWorkItemNarrative(input: { work_item_id: string; markdown: string; updated_at: string }): Promise<WorkItem>;
updateTaskNarrative(input: { task_id: string; markdown: string; updated_at: string }): Promise<Task>;
linkExecutionPackageToTask(input: { task_id: string; execution_package_id: string }): Promise<void>;
getTaskForExecutionPackage(executionPackageId: string): Promise<Task | undefined>;

saveAttachment(attachment: Attachment): Promise<void>;
getAttachment(attachmentId: string): Promise<Attachment | undefined>;
listAttachmentsForObject(objectType: string, objectId: string): Promise<Attachment[]>;
linkAttachmentToObject(attachmentId: string, objectRef: ObjectRef): Promise<Attachment>;
archiveAttachment(attachmentId: string, archivedAt: string): Promise<Attachment>;
```

Implement the same methods in the in-memory and Drizzle repositories.

- [ ] **Step 9: Apply schema to a safe local/dev database**

Confirm the database target before applying schema:

```bash
printenv DATABASE_URL
```

Expected: value points to a disposable local/dev database, not production or a shared teammate environment.

Apply the destructive schema-source changes:

```bash
pnpm db:push
```

Expected: Drizzle applies `tasks`, `attachments`, `work_items.narrative_markdown`, and `execution_packages.task_id` changes successfully.

If `DATABASE_URL` is unset or not safe, stop this task and record the missing safe DB target as a blocker. Do not claim durable DB readiness from in-memory tests alone.

- [ ] **Step 10: Run DB and domain tests**

Run:

```bash
pnpm vitest run tests/db/task-repository.test.ts tests/db/attachment-repository.test.ts tests/db/schema.test.ts tests/domain/validators.test.ts
pnpm --filter @forgeloop/db build
pnpm --filter @forgeloop/domain build
```

Expected: PASS.

- [ ] **Step 11: Commit DB/domain foundation**

```bash
git add packages/domain/src packages/db/src tests/db tests/domain
git commit -m "feat: add task and attachment persistence foundation"
```

## Task 3: Attachment And Markdown API Enforcement

**Files:**
- Create: `apps/control-plane-api/src/modules/attachments/attachments.controller.ts`
- Create: `apps/control-plane-api/src/modules/attachments/attachments.service.ts`
- Create: `apps/control-plane-api/src/modules/attachments/attachments.module.ts`
- Create: `apps/control-plane-api/src/modules/markdown/markdown-document.service.ts`
- Create: `apps/control-plane-api/src/modules/markdown/markdown.module.ts`
- Modify: `apps/control-plane-api/src/modules/work-items/work-items.controller.ts`
- Modify: `apps/control-plane-api/src/modules/work-items/work-item.service.ts`
- Modify: `apps/control-plane-api/src/modules/work-items/work-items.module.ts`
- Modify: `apps/control-plane-api/src/modules/delivery/delivery.module.ts`
- Test: `tests/api/attachments.test.ts`
- Test: `tests/api/markdown-document.test.ts`

- [ ] **Step 1: Write failing API tests for multipart-only uploads**

In `tests/api/attachments.test.ts`, add tests:

```ts
it('rejects JSON/base64 attachment uploads', async () => {
  await request(app.getHttpServer())
    .post('/attachments')
    .send({
      object_type: 'requirement',
      object_id: 'req-1',
      evidence_category: 'image',
      file: 'data:image/png;base64,aaaa',
    })
    .expect(400);
});

it('accepts multipart uploads and returns AttachmentRef without storage_uri', async () => {
  const response = await request(app.getHttpServer())
    .post('/attachments')
    .field('metadata', JSON.stringify({
      object_type: 'requirement',
      object_id: 'req-1',
      evidence_category: 'image',
      alt_text: 'Checkout flow',
      visibility: 'object',
    }))
    .attach('file', Buffer.from('png-bytes'), { filename: 'flow.png', contentType: 'image/png' })
    .expect(201);

  expect(response.body).toMatchObject({ owner_object_type: 'requirement', filename: 'flow.png' });
  expect(response.body).not.toHaveProperty('storage_uri');
});

it('returns only opaque same-origin render urls', async () => {
  const response = await request(app.getHttpServer()).post('/attachments/att-1/render-url').send({ disposition: 'inline' }).expect(201);
  expect(response.body.render_url).toMatch(/^\/api\/attachments\/att-1\/render\//);
  expect(response.body.render_url).not.toMatch(/storage|bucket|s3|signature|https?:\/\//i);
});

it('serves binary content through the safe render url without exposing storage_uri', async () => {
  await seedAttachmentBinary({
    id: 'att-1',
    owner_object_type: 'requirement',
    owner_object_id: 'req-1',
    content_type: 'image/png',
    bytes: Buffer.from('png-bytes'),
  });

  const renderRef = await request(app.getHttpServer()).post('/attachments/att-1/render-url').send({ disposition: 'inline' }).expect(201);
  const binary = await request(app.getHttpServer()).get(renderRef.body.render_url.replace(/^\/api/, '')).expect(200);

  expect(binary.headers['content-type']).toContain('image/png');
  expect(binary.headers['content-disposition']).toContain('inline');
  expect(binary.text ?? binary.body.toString()).not.toContain('storage_uri');
  expect(binary.text ?? binary.body.toString()).not.toContain('memory://attachments');
});

it('fetches metadata and lists object attachments without exposing storage_uri', async () => {
  await seedAttachment({ id: 'att-1', owner_object_type: 'requirement', owner_object_id: 'req-1' });

  const metadata = await request(app.getHttpServer()).get('/attachments/att-1').expect(200);
  const list = await request(app.getHttpServer()).get('/attachments').query({ object_type: 'requirement', object_id: 'req-1' }).expect(200);

  expect(metadata.body).toMatchObject({ id: 'att-1', owner_object_type: 'requirement' });
  expect(JSON.stringify(metadata.body)).not.toContain('storage_uri');
  expect(JSON.stringify(list.body)).not.toContain('storage_uri');
});

it('updates public metadata without replacing binary content', async () => {
  await seedAttachment({ id: 'att-1', owner_object_type: 'requirement', owner_object_id: 'req-1' });

  const response = await request(app.getHttpServer())
    .patch('/attachments/att-1')
    .send({ caption: 'Checkout failure', alt_text: 'Checkout modal error', visibility: 'project' })
    .expect(200);

  expect(response.body).toMatchObject({ caption: 'Checkout failure', alt_text: 'Checkout modal error', visibility: 'project' });
  expect(response.body).not.toHaveProperty('storage_uri');
});

it('links reused evidence only through typed object refs', async () => {
  await seedAttachment({ id: 'att-1', owner_object_type: 'requirement', owner_object_id: 'req-1' });

  const response = await request(app.getHttpServer())
    .post('/attachments/att-1/links')
    .send({ object_ref: { type: 'task', id: 'task-1' } })
    .expect(201);

  expect(response.body.linked_object_refs).toEqual(expect.arrayContaining([{ type: 'task', id: 'task-1' }]));
});

it('archives referenced attachments instead of silently breaking Markdown references', async () => {
  await seedAttachmentReferencedByMarkdown({ id: 'att-1', owner_object_type: 'requirement', owner_object_id: 'req-1' });

  const response = await request(app.getHttpServer()).delete('/attachments/att-1').expect(200);
  expect(response.body).toMatchObject({ id: 'att-1', reference_status: 'archived' });
});
```

Run:

```bash
pnpm vitest run tests/api/attachments.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Write failing API tests for server-side Markdown validation**

In `tests/api/markdown-document.test.ts`, add:

```ts
it('rejects unsafe Markdown on narrative write endpoints', async () => {
  await request(app.getHttpServer())
    .patch('/markdown-documents')
    .send({
      object_ref: { type: 'requirement', id: 'req-1', driver_actor_id: 'actor-product' },
      markdown: '![bad](data:image/png;base64,aaaa)',
      allowed_blocks: ['paragraph', 'image'],
      attachment_refs: [],
      validation_version: '2026-05-23',
    })
    .expect(400);
});

it('accepts safe attachment references resolved against metadata', async () => {
  await seedAttachment({ id: 'att-1', owner_object_type: 'requirement', owner_object_id: 'req-1' });
  await request(app.getHttpServer())
    .patch('/requirements/req-1/narrative')
    .send({
      object_ref: { type: 'requirement', id: 'req-1', driver_actor_id: 'actor-product' },
      markdown: '![flow](attachment://att-1)',
      allowed_blocks: ['paragraph', 'image'],
      attachment_refs: [publicAttachmentRef('att-1')],
      validation_version: '2026-05-23',
    })
    .expect(200);
});

```

Run:

```bash
pnpm vitest run tests/api/markdown-document.test.ts
```

Expected: FAIL because markdown module and endpoint do not exist.

Task narrative validation is intentionally not tested in this task because `TasksModule` does not exist yet. Add that assertion in Task 4 after creating the Task API and `/query/tasks/:taskId` detail endpoint.

- [ ] **Step 3: Implement Attachments service**

Implementation rules:

- `POST /attachments` rejects non-`multipart/form-data`.
- The file part must be named `file`.
- The metadata part must be named `metadata` and parse with `attachmentUploadMetadataSchema`.
- Reject empty files, unsupported content types, mismatched extension/content-type pairs, and oversized files according to first-phase category limits.
- Enforce object write permission for upload/update/link/delete and object read permission for list/metadata/render-url creation.
- Store binary content in the first implementation with a deterministic local/memory URI such as `memory://attachments/<id>` or an existing test storage helper. Do not expose that URI.
- Compute `checksum_sha256`.
- Return `AttachmentRef`.
- `POST /attachments/:attachmentId/render-url` returns `/api/attachments/:attachmentId/render/:token`.
- `GET /attachments/:attachmentId/render/:token` validates the token, permission, expiry, and disposition, then streams or returns binary content without exposing `storage_uri`.
- `GET /attachments?object_type=&object_id=` lists public refs only.
- `GET /attachments/:attachmentId` returns public metadata only.
- `PATCH /attachments/:attachmentId` updates caption, alt text, category, and visibility metadata without replacing binary content.
- `POST /attachments/:attachmentId/links` links reused evidence after validating a typed `ObjectRef`.
- `DELETE /attachments/:attachmentId` archives referenced attachments and hard-deletes only unreferenced attachments if implemented.

Controller method signatures:

```ts
@Post('attachments')
@UseInterceptors(FileInterceptor('file'))
uploadAttachment(@UploadedFile() file: Express.Multer.File, @Body('metadata') metadata: string) {
  return this.service.upload(file, metadata);
}

@Post('attachments/:attachmentId/render-url')
createRenderUrl(@Param('attachmentId') attachmentId: string, @Body() body: { disposition?: 'inline' | 'download' }) {
  return this.service.createRenderUrl(attachmentId, body.disposition ?? 'inline');
}

@Get('attachments/:attachmentId/render/:token')
renderAttachment(@Param('attachmentId') attachmentId: string, @Param('token') token: string, @Res() response: Response) {
  return this.service.renderAttachment(attachmentId, token, response);
}

@Get('attachments/:attachmentId')
getAttachment(@Param('attachmentId') attachmentId: string) {
  return this.service.getPublicMetadata(attachmentId);
}

@Patch('attachments/:attachmentId')
updateAttachment(@Param('attachmentId') attachmentId: string, @Body(new ZodValidationPipe(attachmentPatchSchema)) body: AttachmentPatch) {
  return this.service.updateMetadata(attachmentId, body);
}

@Post('attachments/:attachmentId/links')
linkAttachment(@Param('attachmentId') attachmentId: string, @Body(new ZodValidationPipe(attachmentLinkRequestSchema)) body: AttachmentLinkRequest) {
  return this.service.linkToObject(attachmentId, body.object_ref);
}

@Delete('attachments/:attachmentId')
deleteAttachment(@Param('attachmentId') attachmentId: string) {
  return this.service.archiveOrDelete(attachmentId);
}
```

`renderAttachment` must not trust the token shape alone. It must resolve the render-token record or signed token payload, check the attachment id, actor/object read permission, expiry, safety status, reference status, and requested disposition before streaming bytes. Expired, mismatched, archived without tombstone rendering, unauthorized, or missing binary content must return product-safe 404/403/410 responses with no raw storage details.

- [ ] **Step 4: Implement MarkdownDocument service and narrative write endpoints**

`MarkdownDocumentService` must call `validateMarkdownDocument` from contracts, then verify every `attachment://` id exists, is readable for the object, is not deleted/tombstoned unless preserving a tombstone block, and belongs to or is linked to the target object.

The generic validation endpoint is allowed for shared tests and fast client validation, but it must not be the only write path:

```ts
@Patch('markdown-documents')
validateAndEcho(@Body(new ZodValidationPipe(markdownDocumentSchema)) body: MarkdownDocument) {
  return this.service.validateForWrite(body);
}
```

Add typed narrative write endpoints that persist Markdown after validation:

```ts
@Patch('requirements/:requirementId/narrative')
updateRequirementNarrative(@Param('requirementId') requirementId: string, @Body(new ZodValidationPipe(markdownDocumentSchema)) body: MarkdownDocument) {
  return this.workItemService.updateTypedNarrative('requirement', requirementId, body);
}

@Patch('initiatives/:initiativeId/narrative')
updateInitiativeNarrative(@Param('initiativeId') initiativeId: string, @Body(new ZodValidationPipe(markdownDocumentSchema)) body: MarkdownDocument) {
  return this.workItemService.updateTypedNarrative('initiative', initiativeId, body);
}

@Patch('tech-debt/:techDebtId/narrative')
updateTechDebtNarrative(@Param('techDebtId') techDebtId: string, @Body(new ZodValidationPipe(markdownDocumentSchema)) body: MarkdownDocument) {
  return this.workItemService.updateTypedNarrative('tech_debt', techDebtId, body);
}

@Patch('bugs/:bugId/narrative')
updateBugNarrative(@Param('bugId') bugId: string, @Body(new ZodValidationPipe(markdownDocumentSchema)) body: MarkdownDocument) {
  return this.workItemService.updateTypedNarrative('bug', bugId, body);
}

```

`WorkItemService.updateTypedNarrative` must check that the stored Work Item kind matches the typed endpoint. For example, `/requirements/:id/narrative` must reject a stored `bug`.

Do not add `/tasks/:taskId/narrative` here. Task narrative writes depend on `TasksModule`, `TasksService`, and the task detail query endpoint, which are introduced in Task 4.

- [ ] **Step 5: Wire modules**

Wire provider visibility explicitly:

- `MarkdownModule` must provide and export `MarkdownDocumentService`.
- `AttachmentsModule` must provide and export `AttachmentsService` if `MarkdownDocumentService` resolves attachment metadata through it.
- `WorkItemsModule` must import `MarkdownModule` because `WorkItemService.updateTypedNarrative` injects `MarkdownDocumentService`; importing `MarkdownModule` only into `DeliveryModule` is not enough for Nest provider visibility.
- `DeliveryModule` must import `AttachmentsModule` and `MarkdownModule` so controllers and shared services are registered in the API slice.

- [ ] **Step 6: Run API tests**

Run:

```bash
pnpm vitest run tests/api/attachments.test.ts tests/api/markdown-document.test.ts
pnpm --filter @forgeloop/control-plane-api build
```

Expected: PASS.

- [ ] **Step 7: Commit API enforcement**

```bash
git add apps/control-plane-api/src/modules/attachments apps/control-plane-api/src/modules/markdown apps/control-plane-api/src/modules/work-items apps/control-plane-api/src/modules/delivery tests/api/attachments.test.ts tests/api/markdown-document.test.ts
git commit -m "feat: enforce attachment and markdown api safety"
```

## Task 4: Project Management Query Projections And Task Authority

**Files:**
- Create: `packages/db/src/queries/project-management-queries.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.controller.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.service.ts`
- Create: `apps/control-plane-api/src/modules/tasks/tasks.controller.ts`
- Create: `apps/control-plane-api/src/modules/tasks/tasks.service.ts`
- Create: `apps/control-plane-api/src/modules/tasks/tasks.module.ts`
- Modify: `apps/control-plane-api/src/modules/execution-packages/execution-packages.module.ts`
- Modify: `apps/control-plane-api/src/modules/markdown/markdown.module.ts`
- Modify: `apps/control-plane-api/src/modules/delivery/delivery.module.ts`
- Test: `tests/api/project-management-query.test.ts`
- Test: `tests/api/tasks.test.ts`
- Test: `tests/api/task-scoped-evidence.test.ts`
- Test: `tests/api/project-management-release-readiness.test.ts`

- [ ] **Step 1: Write failing My Work and typed list query tests**

In `tests/api/project-management-query.test.ts`, add:

```ts
it('returns role-aware My Work rows with concrete object types', async () => {
  await seedProjectManagementFixture();
  const response = await request(app.getHttpServer())
    .get('/query/my-work')
    .query({ project_id: 'project-1', actor_id: 'actor-product' })
    .expect(200);

  expect(response.body.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ object_ref: { type: 'requirement', id: 'req-1' } }),
      expect.objectContaining({ object_ref: { type: 'task', id: 'task-1' } }),
    ]),
  );
  expect(JSON.stringify(response.body)).not.toContain('"type":"work_item"');
  expect(JSON.stringify(response.body)).not.toContain('owner_actor_id');
});

it('lists requirements, initiatives, tech debt, bugs, and tasks through typed endpoints', async () => {
  for (const route of ['/query/requirements', '/query/initiatives', '/query/tech-debt', '/query/bugs', '/query/tasks']) {
    await request(app.getHttpServer()).get(route).query({ project_id: 'project-1' }).expect(200);
  }
});
```

Run:

```bash
pnpm vitest run tests/api/project-management-query.test.ts
```

Expected: FAIL because endpoints do not exist.

- [ ] **Step 2: Write failing Task authority tests**

In `tests/api/tasks.test.ts`, add:

```ts
it('creates a Task as first-class developer work, not as a Work Item kind', async () => {
  const response = await request(app.getHttpServer())
    .post('/tasks')
    .send({
      project_id: 'project-1',
      title: 'Implement checkout guard',
      execution_brief: 'Add validation and route tests.',
      acceptance_checklist: ['Route test passes'],
      parent_ref: { type: 'requirement', id: 'req-1' },
      controlling_spec_revision_id: 'spec-rev-1',
      controlling_plan_revision_id: 'plan-rev-1',
    })
    .expect(201);

  expect(response.body).toMatchObject({ object_ref: { type: 'task' }, stale_state: 'current' });
});

it('rejects package generation for manual_exception tasks', async () => {
  await seedManualExceptionTask('task-manual');
  await request(app.getHttpServer()).post('/tasks/task-manual/packages').send({ actor_id: 'actor-dev' }).expect(409);
});

it('persists Task narrative Markdown only after shared validation passes', async () => {
  await seedTask({ id: 'task-1' });
  await request(app.getHttpServer())
    .patch('/tasks/task-1/narrative')
    .send({
      object_ref: { type: 'task', id: 'task-1' },
      markdown: 'Execution context with [package](/tasks/task-1/packages/pkg-1).',
      allowed_blocks: ['paragraph', 'link'],
      attachment_refs: [],
      validation_version: '2026-05-23',
    })
    .expect(200);

  const response = await request(app.getHttpServer()).get('/query/tasks/task-1').expect(200);
  expect(response.body.narrative_markdown).toContain('Execution context');
});
```

Run:

```bash
pnpm vitest run tests/api/tasks.test.ts
```

Expected: FAIL because Task API does not exist.

- [ ] **Step 3: Write failing task-scoped evidence tests**

In `tests/api/task-scoped-evidence.test.ts`, add:

```ts
it('serves package evidence only when package belongs to the requested task', async () => {
  await seedTaskPackageRunReview({ task_id: 'task-1', package_id: 'pkg-1', run_id: 'run-1', review_id: 'review-1' });
  await request(app.getHttpServer()).get('/query/tasks/task-1/packages/pkg-1').expect(200);
  await request(app.getHttpServer()).get('/query/tasks/task-other/packages/pkg-1').expect(404);
});

it('serves run and review evidence only through matching task scope', async () => {
  await request(app.getHttpServer()).get('/query/tasks/task-1/runs/run-1').expect(200);
  await request(app.getHttpServer()).get('/query/tasks/task-other/runs/run-1').expect(404);
  await request(app.getHttpServer()).get('/query/tasks/task-1/reviews/review-1').expect(200);
  await request(app.getHttpServer()).get('/query/tasks/task-other/reviews/review-1').expect(404);
});
```

Run:

```bash
pnpm vitest run tests/api/task-scoped-evidence.test.ts
```

Expected: FAIL because task-scoped evidence endpoints do not exist.

- [ ] **Step 4: Write failing Release readiness API tests**

In `tests/api/project-management-release-readiness.test.ts`, add tests that exercise the backend readiness gate directly, not only the Release page UI:

```ts
it('blocks release readiness when required review or test acceptance evidence is missing', async () => {
  await seedReleaseScope({
    release_id: 'release-1',
    scope_refs: [
      { type: 'requirement', id: 'req-1' },
      { type: 'task', id: 'task-1' },
      { type: 'bug', id: 'bug-1' },
    ],
  });

  const response = await request(app.getHttpServer()).get('/query/releases/release-1/readiness').expect(200);

  expect(response.body.ready).toBe(false);
  expect(response.body.disabled_reasons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'missing_required_review' }),
      expect.objectContaining({ code: 'missing_required_test_acceptance' }),
    ]),
  );
});

it('rejects non-authoritative review evidence and bare attachments', async () => {
  await seedReleaseScopeWithEvidence({
    release_id: 'release-1',
    review_evidence: [
      { authority_type: 'ai_self_review_approval', scope_ref: { type: 'requirement', id: 'req-1' } },
      { authority_type: 'attachment_only', scope_ref: { type: 'task', id: 'task-1' }, attachment_id: 'att-1' },
    ],
  });

  const response = await request(app.getHttpServer()).get('/query/releases/release-1/readiness').expect(200);

  expect(response.body.ready).toBe(false);
  expect(response.body.disabled_reasons.map((reason: { code: string }) => reason.code)).toEqual(
    expect.arrayContaining(['evidence_unauthorized', 'missing_required_review']),
  );
});

it('blocks stale, wrong-scope, unauthorized, and tombstoned evidence', async () => {
  await seedReleaseScopeWithEvidence({
    release_id: 'release-1',
    review_evidence: [
      { status: 'approved', scope_ref: { type: 'requirement', id: 'req-other' }, freshness: 'current' },
      { status: 'approved', scope_ref: { type: 'requirement', id: 'req-1' }, freshness: 'stale' },
    ],
    test_evidence: [
      { status: 'passed', scope_ref: { type: 'task', id: 'task-1' }, authorization: 'unauthorized' },
      { status: 'passed', scope_ref: { type: 'bug', id: 'bug-1' }, reference_status: 'tombstoned' },
    ],
  });

  const response = await request(app.getHttpServer()).get('/query/releases/release-1/readiness').expect(200);

  expect(response.body.ready).toBe(false);
  expect(response.body.disabled_reasons.map((reason: { code: string }) => reason.code)).toEqual(
    expect.arrayContaining(['evidence_scope_mismatch', 'evidence_stale', 'evidence_unauthorized', 'evidence_tombstoned']),
  );
});

it('unblocks release readiness when all required evidence is scoped, current, authorized, and passing', async () => {
  await seedReadyReleaseEvidence({
    release_id: 'release-1',
    scope_refs: [
      { type: 'requirement', id: 'req-1' },
      { type: 'task', id: 'task-1' },
      { type: 'bug', id: 'bug-1' },
    ],
  });

  const response = await request(app.getHttpServer()).get('/query/releases/release-1/readiness').expect(200);

  expect(response.body).toMatchObject({
    release_id: 'release-1',
    ready: true,
    disabled_reasons: [],
  });
});
```

Run:

```bash
pnpm vitest run tests/api/project-management-release-readiness.test.ts
```

Expected: FAIL because the readiness projection endpoint does not exist yet.

- [ ] **Step 5: Implement projection helpers**

In `packages/db/src/queries/project-management-queries.ts`, implement:

```ts
export async function listMyWorkQueue(repository: DeliveryRepository, query: { project_id: string; actor_id?: string }) {
  const [workItems, tasks, releases] = await Promise.all([
    repository.listWorkItems(query.project_id),
    repository.listTasks(query.project_id),
    repository.listReleases(query.project_id),
  ]);

  return {
    items: [
      ...workItems.map(workItemToMyWorkQueueItem),
      ...tasks.map(taskToMyWorkQueueItem),
      ...releases.map(releaseToMyWorkQueueItem),
    ].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    degraded_sources: [],
  };
}
```

Add typed list/detail helpers:

- `listRequirements`
- `getRequirementDetail`
- `listInitiatives`
- `getInitiativeDetail`
- `listTechDebt`
- `getTechDebtDetail`
- `listBugs`
- `getBugDetail`
- `listTasks`
- `getTaskDetail`
- `getTaskPackageEvidence`
- `getTaskRunEvidence`
- `getTaskReviewEvidence`
- `getReleaseReadinessDetail`
- `listBoardCards`
- `getReport`

Map Work Item storage kinds to typed refs:

```ts
function workItemKindToObjectType(kind: WorkItem['kind']): 'initiative' | 'requirement' | 'bug' | 'tech_debt' {
  return kind;
}
```

Do not emit `{ type: 'work_item' }`.

Implement `getReleaseReadinessDetail` so it returns `ReleaseReadinessDetail` from `packages/contracts/src/project-management.ts` and fails closed for:

- missing required review evidence;
- missing required Test/Acceptance evidence;
- freeform, untyped, AI self-review, or attachment-only evidence;
- stale Spec/Plan revision evidence;
- wrong-scope evidence;
- unauthorized evidence;
- tombstoned or deleted evidence.

It may reuse existing release gate/query helpers where they already encode the same semantics, but the public output must be the typed project-management readiness contract and must not expose raw runtime internals.

- [ ] **Step 6: Implement Tasks module**

`TasksModule` provider wiring:

- Import `MarkdownModule` so `TasksService.updateNarrative` can inject `MarkdownDocumentService`.
- Import `ExecutionPackagesModule` so `TasksService.createPackageForTask` can delegate package generation through the existing `ExecutionPackageService`.
- If `ExecutionPackageService` does not already expose a package-generation method that accepts explicit `spec_revision_id` and `plan_revision_id`, add a narrow method there rather than hand-rolling package creation inside `TasksService`.
- Export `TasksService` only if another module needs it.

`TasksService.createTask` must:

- validate parent ref if present;
- compute `stale_state`;
- set `package_generation_eligible` only when current approved Spec and Plan revisions are present;
- persist Task through repository;
- append object event with object_type `task`.

`TasksService.updateNarrative` must:

- call `MarkdownDocumentService.validateForWrite`;
- require `body.object_ref` to be `{ type: 'task', id: taskId }`;
- persist through `repository.updateTaskNarrative`;
- return `TaskDetail` with updated `narrative_markdown`.

`TasksService.createPackageForTask` must:

- load the Task;
- reject when `stale_state !== 'current'`;
- reject missing `controlling_spec_revision_id` or missing `controlling_plan_revision_id`;
- reject `manual_exception`;
- delegate package generation to `ExecutionPackageService` using the Task's approved `controlling_spec_revision_id` and `controlling_plan_revision_id`;
- link the generated package to the Task through `repository.linkExecutionPackageToTask`;
- return a Task-scoped package response or ProductAction target whose href is `/tasks/:taskId/packages/:packageId`, never `/packages/:packageId`.

- [ ] **Step 7: Add query endpoints**

In `QueryController`, add:

```ts
@Get('my-work')
listMyWork(@Query(new ZodValidationPipe(myWorkQuerySchema)) query: MyWorkQuery) {
  return this.service.listMyWork(query);
}

@Get('requirements')
listRequirements(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
  return this.service.listRequirements(query);
}

@Get('tasks/:taskId/packages/:packageId')
getTaskPackageEvidence(@Param('taskId') taskId: string, @Param('packageId') packageId: string) {
  return this.service.getTaskPackageEvidence(taskId, packageId);
}
```

Add equivalent endpoints for initiatives, tech-debt, bugs, board, reports, task detail (`GET /query/tasks/:taskId`), task run evidence, and task review evidence.

Also add typed detail endpoints:

- `GET /query/requirements/:requirementId`
- `GET /query/initiatives/:initiativeId`
- `GET /query/tech-debt/:techDebtId`
- `GET /query/bugs/:bugId`
- `GET /query/tasks/:taskId`

Add Release readiness endpoint:

```ts
@Get('releases/:releaseId/readiness')
getReleaseReadiness(@Param('releaseId') releaseId: string, @Query('project_id') projectId?: string) {
  return this.service.getReleaseReadinessDetail(releaseId, { project_id: projectId });
}
```

- [ ] **Step 8: Run API/query tests**

Run:

```bash
pnpm vitest run tests/api/project-management-query.test.ts tests/api/tasks.test.ts tests/api/task-scoped-evidence.test.ts tests/api/project-management-release-readiness.test.ts tests/contracts/project-management-contracts.test.ts tests/contracts/project-management-readiness.test.ts
pnpm --filter @forgeloop/control-plane-api build
```

Expected: PASS.

- [ ] **Step 9: Commit query, Task API, and Release readiness API**

```bash
git add packages/db/src/queries/project-management-queries.ts packages/db/src/index.ts apps/control-plane-api/src/modules/query apps/control-plane-api/src/modules/tasks apps/control-plane-api/src/modules/execution-packages apps/control-plane-api/src/modules/markdown apps/control-plane-api/src/modules/delivery tests/api/project-management-query.test.ts tests/api/tasks.test.ts tests/api/task-scoped-evidence.test.ts tests/api/project-management-release-readiness.test.ts
git commit -m "feat: add project management queries task authority and release readiness"
```

## Task 5: Web API Clients, MDXEditor Wrapper, And Evidence Attachments

**Files:**
- Modify: `apps/web/src/shared/api/common.ts`
- Create: `apps/web/src/shared/api/attachments.ts`
- Modify: `apps/web/src/shared/api/query.ts`
- Modify: `apps/web/src/shared/api/commands.ts`
- Modify: `apps/web/src/shared/api/query-keys.ts`
- Modify: `apps/web/src/shared/api/types.ts`
- Create: `apps/web/src/shared/ui/markdown-editor/markdown-policy.ts`
- Create: `apps/web/src/shared/ui/markdown-editor/attachment-plugin.ts`
- Create: `apps/web/src/shared/ui/markdown-editor/markdown-editor.tsx`
- Create: `apps/web/src/shared/ui/markdown-editor/index.ts`
- Create: `apps/web/src/shared/ui/evidence-attachments/evidence-attachments.tsx`
- Create: `apps/web/src/shared/ui/evidence-attachments/index.ts`
- Modify: `apps/web/src/shared/ui/index.ts`
- Test: `tests/web/api-hooks.test.tsx`
- Test: `tests/web/attachment-api.test.ts`
- Test: `tests/web/markdown-editor.test.tsx`
- Test: `tests/web/markdown-editor-attachments.test.tsx`
- Test: `tests/web/attachment-evidence-rendering.test.tsx`

- [ ] **Step 1: Write failing attachment API client tests**

In `tests/web/attachment-api.test.ts`, add:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createForgeloopAttachmentApi } from '../../apps/web/src/shared/api/attachments';

describe('attachment Web API client', () => {
  it('uploads using multipart FormData without JSON content-type', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(publicAttachmentFixture()), { status: 201 }));
    const api = createForgeloopAttachmentApi({ baseUrl: 'http://api.test', fetch: fetch as typeof globalThis.fetch });

    await api.uploadAttachment({
      file: new File(['bytes'], 'flow.png', { type: 'image/png' }),
      metadata: { object_type: 'requirement', object_id: 'req-1', evidence_category: 'image' },
      actorId: 'actor-product',
    });

    const [, init] = fetch.mock.calls[0];
    expect(init.body).toBeInstanceOf(FormData);
    expect(new Headers(init.headers).get('content-type')).toBeNull();
  });

  it('rejects render refs that expose raw storage urls', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      attachment_id: 'att-1',
      render_url: 'https://bucket.example.com/raw?signature=x',
      expires_at: '2026-05-23T00:05:00.000Z',
      content_type: 'image/png',
      disposition: 'inline',
    }), { status: 200 }));
    const api = createForgeloopAttachmentApi({ baseUrl: 'http://api.test', fetch: fetch as typeof globalThis.fetch });
    await expect(api.createRenderUrl('att-1', { disposition: 'inline' })).rejects.toThrow();
  });

  it('fetches safe render URLs as binary content without leaking raw storage details', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        attachment_id: 'att-1',
        render_url: '/api/attachments/att-1/render/render-token',
        expires_at: '2026-05-23T00:05:00.000Z',
        content_type: 'image/png',
        disposition: 'inline',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Blob(['png-bytes'], { type: 'image/png' }), {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-disposition': 'inline; filename=\"flow.png\"' },
      }));
    const api = createForgeloopAttachmentApi({ baseUrl: 'http://api.test', fetch: fetch as typeof globalThis.fetch });

    const renderRef = await api.createRenderUrl('att-1', { disposition: 'inline' });
    const binary = await api.fetchRenderContent(renderRef);

    expect(binary.contentType).toBe('image/png');
    expect(fetch.mock.calls[1][0]).toBe('http://api.test/api/attachments/att-1/render/render-token');
  });

  it('supports metadata fetch, patch, link, and archive/delete operations', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(publicAttachmentFixture({ id: 'att-1' })), { status: 200 }));
    const api = createForgeloopAttachmentApi({ baseUrl: 'http://api.test', fetch: fetch as typeof globalThis.fetch });

    await api.getAttachment('att-1');
    await api.updateAttachment('att-1', { caption: 'Checkout failure', visibility: 'project' });
    await api.linkAttachment('att-1', { type: 'task', id: 'task-1' });
    await api.deleteAttachment('att-1');

    expect(fetch.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${String(url)}`)).toEqual([
      'GET http://api.test/attachments/att-1',
      'PATCH http://api.test/attachments/att-1',
      'POST http://api.test/attachments/att-1/links',
      'DELETE http://api.test/attachments/att-1',
    ]);
  });
});
```

Run:

```bash
pnpm vitest run tests/web/attachment-api.test.ts
```

Expected: FAIL because attachment API client does not exist.

- [ ] **Step 2: Write failing Markdown editor tests**

In `tests/web/markdown-editor.test.tsx`, add:

```tsx
// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ForgeMarkdownEditor } from '../../apps/web/src/shared/ui/markdown-editor';

describe('ForgeMarkdownEditor', () => {
  it('renders read-only Markdown and hides editing toolbar', () => {
    render(
      <ForgeMarkdownEditor
        allowedBlocks={['paragraph', 'heading']}
        mode="read"
        objectRef={{ type: 'requirement', id: 'req-1', driver_actor_id: 'actor-product' }}
        onChange={vi.fn()}
        onUploadAttachment={vi.fn()}
        validationPolicy={{ validation_version: '2026-05-23' }}
        value="# Requirement brief"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Requirement brief' })).toBeTruthy();
    expect(screen.queryByLabelText(/editor toolbar/i)).toBeNull();
  });

  it('rejects unsafe source mode content before save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <ForgeMarkdownEditor
        allowedBlocks={['paragraph', 'image']}
        mode="edit"
        objectRef={{ type: 'requirement', id: 'req-1', driver_actor_id: 'actor-product' }}
        onChange={vi.fn()}
        onSave={onSave}
        onUploadAttachment={vi.fn()}
        validationPolicy={{ validation_version: '2026-05-23' }}
        value="Initial"
      />,
    );

    await user.click(screen.getByRole('button', { name: /source/i }));
    await user.clear(screen.getByRole('textbox', { name: /markdown source/i }));
    await user.type(screen.getByRole('textbox', { name: /markdown source/i }), '![bad](data:image/png;base64,aaaa)');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/unsafe/i)).toBeTruthy();
  });

  it('autosaves drafts and guards navigation when edits are unsaved', async () => {
    const user = userEvent.setup();
    const onAutosaveDraft = vi.fn();
    const onBeforeUnload = vi.spyOn(window, 'addEventListener');
    render(
      <ForgeMarkdownEditor
        allowedBlocks={['paragraph']}
        autosave={{ debounceMs: 10, onAutosaveDraft }}
        mode="edit"
        objectRef={{ type: 'task', id: 'task-1' }}
        onChange={vi.fn()}
        onUploadAttachment={vi.fn()}
        validationPolicy={{ validation_version: '2026-05-23' }}
        value="Initial"
      />,
    );

    await user.type(screen.getByRole('textbox', { name: /markdown editor/i }), ' updated');

    await waitFor(() => expect(onAutosaveDraft).toHaveBeenCalledWith(expect.stringContaining('updated')));
    expect(onBeforeUnload).toHaveBeenCalledWith('beforeunload', expect.any(Function));
  });

  it('shows revision history and Markdown diff without changing the saved body', async () => {
    const user = userEvent.setup();
    render(
      <ForgeMarkdownEditor
        allowedBlocks={['paragraph']}
        mode="edit"
        objectRef={{ type: 'requirement', id: 'req-1', driver_actor_id: 'actor-product' }}
        onChange={vi.fn()}
        onUploadAttachment={vi.fn()}
        revisions={[
          { revision_id: 'rev-1', markdown: 'Old body', created_at: '2026-05-22T00:00:00.000Z', author_actor_id: 'actor-product' },
          { revision_id: 'rev-2', markdown: 'New body', created_at: '2026-05-23T00:00:00.000Z', author_actor_id: 'actor-product' },
        ]}
        validationPolicy={{ validation_version: '2026-05-23' }}
        value="New body"
      />,
    );

    await user.click(screen.getByRole('button', { name: /revision history/i }));
    await user.click(screen.getByRole('button', { name: /compare rev-1 to rev-2/i }));

    expect(screen.getByText(/Old body/)).toBeTruthy();
    expect(screen.getByText(/New body/)).toBeTruthy();
  });
});
```

Run:

```bash
pnpm vitest run tests/web/markdown-editor.test.tsx
```

Expected: FAIL because editor wrapper does not exist.

- [ ] **Step 3: Write failing image upload editor tests**

In `tests/web/markdown-editor-attachments.test.tsx`, add:

```tsx
it('uploads pasted images before inserting attachment references', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const onUploadAttachment = vi.fn(async () => publicAttachmentFixture({ id: 'att-paste' }));
  render(<EditableEditor onChange={onChange} onUploadAttachment={onUploadAttachment} />);

  const editor = screen.getByRole('textbox', { name: /markdown editor/i });
  await user.click(editor);
  await user.paste(new File(['bytes'], 'paste.png', { type: 'image/png' }));

  expect(onUploadAttachment).toHaveBeenCalled();
  expect(onChange).toHaveBeenCalledWith(expect.stringContaining('attachment://att-paste'));
});

it('does not insert broken markdown when upload fails', async () => {
  const onChange = vi.fn();
  const onUploadAttachment = vi.fn(async () => {
    throw new Error('Upload failed');
  });
  render(<EditableEditor onChange={onChange} onUploadAttachment={onUploadAttachment} />);

  await pasteImage(screen.getByRole('textbox', { name: /markdown editor/i }));
  expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining('attachment://'));
  expect(screen.getByText(/upload failed/i)).toBeTruthy();
});

it('uploads dropped and toolbar-selected images before inserting attachment references', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const onUploadAttachment = vi.fn(async () => publicAttachmentFixture({ id: 'att-toolbar' }));
  render(<EditableEditor onChange={onChange} onUploadAttachment={onUploadAttachment} />);

  await user.click(screen.getByRole('button', { name: /insert image/i }));
  await uploadFile(screen.getByLabelText(/image file/i), new File(['bytes'], 'toolbar.png', { type: 'image/png' }));
  await dropImage(screen.getByRole('textbox', { name: /markdown editor/i }), new File(['bytes'], 'drop.png', { type: 'image/png' }));

  expect(onUploadAttachment).toHaveBeenCalledTimes(2);
  expect(onChange).toHaveBeenCalledWith(expect.stringContaining('attachment://att-toolbar'));
});

it('inserts non-image attachments through the attachment picker as link references', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <EditableEditor
      attachments={[publicAttachmentFixture({ id: 'att-log', filename: 'ci.log', content_type: 'text/plain', evidence_category: 'log' })]}
      onChange={onChange}
      onUploadAttachment={vi.fn()}
    />,
  );

  await user.click(screen.getByRole('button', { name: /attachments/i }));
  await user.click(screen.getByRole('menuitem', { name: /ci.log/i }));

  expect(onChange).toHaveBeenCalledWith(expect.stringContaining('[ci.log](attachment://att-log)'));
});
```

Run:

```bash
pnpm vitest run tests/web/markdown-editor-attachments.test.tsx
```

Expected: FAIL.

- [ ] **Step 4: Add raw request support**

In `apps/web/src/shared/api/common.ts`, extend `ApiRequestInit`:

```ts
export interface ApiRequestInit {
  method?: string;
  body?: unknown;
  rawBody?: BodyInit;
  headers?: HeadersInit;
  actorId?: string;
}
```

When `rawBody` is present, do not set `content-type: application/json` and do not call `JSON.stringify`.

Also expose a low-level `rawRequest(pathOrUrl, init?)` helper for same-origin binary fetches. It must use the same base URL and auth/actor headers as JSON requests, but it must not parse JSON. `attachments.ts` uses this for `fetchRenderContent`.

- [ ] **Step 5: Implement attachment API client**

In `apps/web/src/shared/api/attachments.ts`, implement:

```ts
export function createForgeloopAttachmentApi(options: ForgeloopApiOptions = {}) {
  const { request, rawRequest } = createApiContext(options);
  return {
    uploadAttachment: ({ file, metadata, actorId }: UploadAttachmentInput) => {
      const form = new FormData();
      form.set('file', file);
      form.set('metadata', JSON.stringify(attachmentUploadMetadataSchema.parse(metadata)));
      return request<AttachmentRef>('/attachments', { method: 'POST', rawBody: form, actorId });
    },
    listAttachments: (query: { object_type: string; object_id: string }) =>
      request<AttachmentRef[]>(`/attachments?${new URLSearchParams(query)}`),
    getAttachment: (attachmentId: string) =>
      request<AttachmentRef>(`/attachments/${encodeURIComponent(attachmentId)}`),
    updateAttachment: (attachmentId: string, body: AttachmentPatch) =>
      request<AttachmentRef>(`/attachments/${encodeURIComponent(attachmentId)}`, { method: 'PATCH', body }),
    linkAttachment: (attachmentId: string, objectRef: ObjectRef) =>
      request<AttachmentRef>(`/attachments/${encodeURIComponent(attachmentId)}/links`, {
        method: 'POST',
        body: { object_ref: objectRef },
      }),
    deleteAttachment: (attachmentId: string) =>
      request<AttachmentRef | { deleted: true }>(`/attachments/${encodeURIComponent(attachmentId)}`, { method: 'DELETE' }),
    fetchRenderContent: async (renderRef: AttachmentRenderRef) => {
      const response = await rawRequest(renderRef.render_url);
      return {
        blob: await response.blob(),
        contentType: response.headers.get('content-type') ?? renderRef.content_type,
        disposition: response.headers.get('content-disposition') ?? renderRef.disposition,
      };
    },
    createRenderUrl: async (attachmentId: string, body: { disposition: 'inline' | 'download' }) =>
      attachmentRenderRefSchema.parse(
        await request<unknown>(`/attachments/${encodeURIComponent(attachmentId)}/render-url`, { method: 'POST', body }),
      ),
  };
}
```

In `apps/web/src/shared/api/commands.ts`, add typed narrative update methods. Do not call generic `/work-items/:id` from product pages:

```ts
updateRequirementNarrative: (requirementId: string, body: MarkdownDocument) =>
  request<RequirementDetail>(`/requirements/${encodeURIComponent(requirementId)}/narrative`, { method: 'PATCH', body }),
updateInitiativeNarrative: (initiativeId: string, body: MarkdownDocument) =>
  request<InitiativeDetail>(`/initiatives/${encodeURIComponent(initiativeId)}/narrative`, { method: 'PATCH', body }),
updateTechDebtNarrative: (techDebtId: string, body: MarkdownDocument) =>
  request<TechDebtDetail>(`/tech-debt/${encodeURIComponent(techDebtId)}/narrative`, { method: 'PATCH', body }),
updateBugNarrative: (bugId: string, body: MarkdownDocument) =>
  request<BugDetail>(`/bugs/${encodeURIComponent(bugId)}/narrative`, { method: 'PATCH', body }),
updateTaskNarrative: (taskId: string, body: MarkdownDocument) =>
  request<TaskDetail>(`/tasks/${encodeURIComponent(taskId)}/narrative`, { method: 'PATCH', body }),
```

- [ ] **Step 6: Implement Markdown policy**

`markdown-policy.ts` should call `validateMarkdownDocument` and expose:

```ts
export function validateEditorMarkdown(input: {
  markdown: string;
  objectRef: EditableObjectRef;
  allowedBlocks: MarkdownBlockKind[];
  attachments: AttachmentRef[];
  validationVersion: string;
}): MarkdownValidationResult {
  return validateMarkdownDocument({
    markdown: input.markdown,
    object_ref: input.objectRef,
    allowed_blocks: input.allowedBlocks,
    attachment_refs: input.attachments,
    validation_version: input.validationVersion,
  });
}
```

- [ ] **Step 7: Implement ForgeMarkdownEditor**

Use MDXEditor only inside `markdown-editor.tsx`. Import styles once:

```ts
import '@mdxeditor/editor/style.css';
```

Use plugins:

```tsx
plugins={[
  headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4] }),
  listsPlugin(),
  quotePlugin(),
  thematicBreakPlugin(),
  tablePlugin(),
  linkPlugin(),
  linkDialogPlugin(),
  imagePlugin({ imageUploadHandler }),
  diffSourcePlugin({ viewMode: sourceMode ? 'source' : 'rich-text' }),
  toolbarPlugin({ toolbarContents: ToolbarContents }),
  markdownShortcutPlugin(),
]}
```

The `imageUploadHandler` must call `onUploadAttachment` and return `attachment://<attachment.id>`.

The wrapper must also implement the first-phase authoring controls from the spec:

- attachment picker that inserts image refs as `![alt](attachment://id)` and non-image refs as `[filename](attachment://id)`;
- paste, drag/drop, and toolbar-selected image upload paths that all use the same upload-first helper;
- autosave draft callback through the `autosave` prop without changing approved revisions;
- explicit save/publish callback through `onSave`;
- unsaved-change guard using `beforeunload` and route-transition blocking where available;
- revision history panel from a `revisions` prop;
- Markdown diff between two selected revisions using MDXEditor's `diffSourcePlugin` or a repo-local diff renderer;
- keyboard labels/focus states for toolbar, source toggle, attachment picker, revision history, and save actions.

- [ ] **Step 8: Implement EvidenceAttachments**

`EvidenceAttachments` accepts public `AttachmentRef[]`, resolves safe render URLs with `createRenderUrl`, renders images inline with alt text, renders documents/logs as download/open actions, and renders archived/tombstoned/unavailable refs as unavailable evidence blocks.

- [ ] **Step 9: Run Web editor/API tests**

Run:

```bash
pnpm vitest run tests/web/attachment-api.test.ts tests/web/markdown-editor.test.tsx tests/web/markdown-editor-attachments.test.tsx tests/web/attachment-evidence-rendering.test.tsx tests/web/api-hooks.test.tsx
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit Web editor/API foundation**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/shared/api apps/web/src/shared/ui/markdown-editor apps/web/src/shared/ui/evidence-attachments tests/web/attachment-api.test.ts tests/web/markdown-editor.test.tsx tests/web/markdown-editor-attachments.test.tsx tests/web/attachment-evidence-rendering.test.tsx tests/web/api-hooks.test.tsx
git commit -m "feat: add markdown editor and attachment web foundation"
```

## Task 6: Destructive Route IA And App Shell Replacement

**Files:**
- Create: `apps/web/src/app/routes/_index.tsx`
- Modify: `apps/web/src/app/routes.ts`
- Modify: `apps/web/src/app/routes/_layout.tsx`
- Modify: `apps/web/src/shared/layout/sidebar-nav/sidebar-nav.tsx`
- Modify: `apps/web/src/shared/layout/app-shell/app-shell.tsx`
- Create temporary target route modules for all target routes listed under Target File Structure.
- Modify: `tests/web/router-test-utils.tsx`
- Modify: `tests/web/app-shell-routing.test.tsx`
- Modify: `tests/web/dev-tools-gating.test.tsx`
- Test: `tests/web/project-management-routes.test.tsx`

- [ ] **Step 1: Write failing route config tests**

In `tests/web/app-shell-routing.test.tsx`, replace old route assertions with:

```tsx
it('uses My Work as the default route through a redirect module', async () => {
  const routeConfigModule = await import('../../apps/web/src/app/routes');
  const layoutRoute = routeConfigModule.default.find((route) => route.file === './routes/_layout.tsx');

  expect(layoutRoute?.children).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ index: true, file: './routes/_index.tsx' }),
      expect.objectContaining({ path: 'my-work', file: './routes/my-work/index.tsx' }),
    ]),
  );
});

it('does not include removed route families in canonical route config', async () => {
  const routeConfigModule = await import('../../apps/web/src/app/routes');
  const layoutRoute = routeConfigModule.default.find((route) => route.file === './routes/_layout.tsx');
  const serialized = JSON.stringify(layoutRoute);

  for (const forbidden of ['lanes', 'pipeline', 'work-items', 'packages', 'runs', 'reviews']) {
    expect(serialized).not.toContain(`"path":"${forbidden}`);
    expect(serialized).not.toContain(`/routes/${forbidden}`);
  }
  expect(serialized).not.toContain(`"path":"specs"`);
  expect(serialized).not.toContain(`"path":"plans"`);
});
```

Run:

```bash
pnpm vitest run tests/web/app-shell-routing.test.tsx
```

Expected: FAIL because route config still uses old route families.

- [ ] **Step 2: Write failing router utility and removed route tests**

In `tests/web/project-management-routes.test.tsx`, add:

```tsx
// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { renderRoute } from './router-test-utils';

const removedRoutes = [
  '/lanes',
  '/lanes/requirements',
  '/pipeline',
  '/work-items',
  '/work-items/wi-1',
  '/work-items/wi-1/spec-plan',
  '/specs',
  '/plans',
  '/packages',
  '/packages/pkg-1',
  '/runs',
  '/runs/run-1',
  '/reviews',
  '/reviews/review-1',
];

describe('project management route IA', () => {
  it('renders target primary navigation only', async () => {
    const screen = await renderRoute('/my-work');
    for (const label of ['Dashboard', 'My Work', 'Requirements', 'Specs & Plans', 'Tasks', 'Bugs', 'Board', 'Releases', 'Reports']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
    for (const label of ['Lanes', 'Pipeline', 'Work Items', 'Packages', 'Runs', 'Reviews']) {
      expect(screen.queryByRole('link', { name: label })).toBeNull();
    }
  });

  it.each(removedRoutes)('does not resolve removed product route %s', async (route) => {
    const screen = await renderRoute(route);
    expect(screen.getByRole('heading', { name: /not found|404/i })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /lanes|pipeline|work items|packages|runs|reviews/i })).toBeNull();
  });
});
```

Run:

```bash
pnpm vitest run tests/web/project-management-routes.test.tsx
```

Expected: FAIL because router utility still imports old route modules.

- [ ] **Step 3: Add root redirect**

Create `apps/web/src/app/routes/_index.tsx`:

```tsx
import { Navigate } from 'react-router';

export default function RootIndexRoute() {
  return <Navigate replace to="/my-work" />;
}
```

- [ ] **Step 4: Replace route config**

Replace `apps/web/src/app/routes.ts` with the route map from the spec. Ensure exact list route paths `/specs` and `/plans` are not present, but detail routes `/specs/:specId` and `/plans/:planId` remain.

- [ ] **Step 5: Update app shell nav**

In `_layout.tsx`, replace `navItems` with:

```ts
const navItems = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'My Work', to: '/my-work', activeOn: ['/', '/my-work'] },
  { label: 'Requirements', to: '/requirements', activeOn: ['/requirements', '/initiatives', '/tech-debt'] },
  { label: 'Specs & Plans', to: '/specs-plans', activeOn: ['/specs-plans', '/specs', '/plans'] },
  { label: 'Tasks', to: '/tasks' },
  { label: 'Bugs', to: '/bugs' },
  { label: 'Board', to: '/board' },
  { label: 'Releases', to: '/releases' },
  { label: 'Reports', to: '/reports' },
];
```

Do not add Initiative or Tech Debt as first-level sidebar entries.

- [ ] **Step 6: Create temporary target route modules**

For each new route module, render a real product scaffold using existing layout primitives, for example:

```tsx
import { PageHeader, Section } from '../../../shared/layout';
import { InlineNotice } from '../../../shared/ui';

export default function MyWorkRoute() {
  return (
    <>
      <PageHeader subtitle="Role-aware product inbox." title="My Work" />
      <Section title="Attention queue">
        <InlineNotice title="My Work queue is loading from project management read models." tone="info" />
      </Section>
    </>
  );
}
```

These scaffold routes are temporary only until Task 7 replaces them with data-backed pages. They are allowed because they are target routes, not old-route compatibility.

- [ ] **Step 7: Update `tests/web/router-test-utils.tsx`**

Remove imports from old route modules. Import new route modules. The route tree must match the final route map and must not include old route families.

- [ ] **Step 8: Delete old route modules from active config**

After route tests pass, delete old route modules and any feature imports that become unreachable. If deleting now causes type errors in old tests, update or delete those old tests in the same task. Removed routes must resolve through the app's product-safe not-found state; they must not redirect to replacements and must not render hidden compatibility components.

- [ ] **Step 9: Run route tests**

Run:

```bash
pnpm vitest run tests/web/app-shell-routing.test.tsx tests/web/project-management-routes.test.tsx tests/web/dev-tools-gating.test.tsx
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit route IA**

```bash
git add apps/web/src/app/routes.ts apps/web/src/app/routes apps/web/src/shared/layout tests/web/router-test-utils.tsx tests/web/app-shell-routing.test.tsx tests/web/project-management-routes.test.tsx tests/web/dev-tools-gating.test.tsx
git commit -m "feat: replace web route ia with project management navigation"
```

## Task 7: Data-Backed My Work And Typed Object Pages

**Files:**
- Create: `apps/web/src/features/project-management/object-detail-layout.tsx`
- Create: `apps/web/src/features/project-management/object-list.tsx`
- Create: `apps/web/src/features/project-management/object-forms.tsx`
- Create: `apps/web/src/features/my-work/my-work-route.tsx`
- Create: `apps/web/src/features/requirements/requirements-routes.tsx`
- Create: `apps/web/src/features/initiatives/initiatives-routes.tsx`
- Create: `apps/web/src/features/tech-debt/tech-debt-routes.tsx`
- Create: `apps/web/src/features/tasks/tasks-routes.tsx`
- Create: `apps/web/src/features/bugs/bugs-routes.tsx`
- Modify: new route modules from Task 6 to import the feature routes.
- Modify: `apps/web/src/shared/api/query.ts`
- Modify: `apps/web/src/shared/api/hooks.ts`
- Modify: `apps/web/src/shared/api/query-keys.ts`
- Modify: `apps/web/src/shared/api/commands.ts`
- Test: `tests/web/my-work-route.test.tsx`
- Test: `tests/web/project-management-routes.test.tsx`
- Test: `tests/web/fixtures/product-data.ts`
- Test: `tests/web/fixtures/product-api-mock.ts`

- [ ] **Step 1: Write failing My Work route tests**

In `tests/web/my-work-route.test.tsx`, add:

```tsx
// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { renderRoute } from './router-test-utils';

describe('My Work route', () => {
  it('groups role-aware attention items without generic Work Items copy', async () => {
    const screen = await renderRoute('/my-work');
    expect(await screen.findByRole('heading', { name: 'My Work' })).toBeTruthy();
    for (const group of ['Product attention', 'Tech Lead attention', 'Developer attention', 'QA attention', 'Release Owner attention', 'Manager attention']) {
      expect(screen.getByText(group)).toBeTruthy();
    }
    expect(screen.queryByText('Work Items')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Work Item Owner|owner_actor_id/);
  });

  it('links queue rows to typed object routes', async () => {
    const screen = await renderRoute('/my-work');
    expect(await screen.findByRole('link', { name: /checkout requirement/i })).toHaveAttribute('href', '/requirements/req-1');
    expect(screen.getByRole('link', { name: /developer task/i })).toHaveAttribute('href', '/tasks/task-1');
  });
});
```

Run:

```bash
pnpm vitest run tests/web/my-work-route.test.tsx
```

Expected: FAIL because My Work is still a scaffold route.

- [ ] **Step 2: Write failing typed page tests**

Extend `tests/web/project-management-routes.test.tsx`:

```tsx
it('renders typed list and detail surfaces', async () => {
  for (const [route, heading] of [
    ['/requirements', 'Requirements'],
    ['/requirements/req-1', 'Requirement'],
    ['/initiatives', 'Initiatives'],
    ['/initiatives/init-1', 'Initiative'],
    ['/tech-debt', 'Tech Debt'],
    ['/tech-debt/td-1', 'Tech Debt'],
    ['/tasks', 'Tasks'],
    ['/tasks/task-1', 'Task'],
    ['/bugs', 'Bugs'],
    ['/bugs/bug-1', 'Bug'],
  ] as const) {
    const screen = await renderRoute(route);
    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
  }
});

it('renders typed create forms with structured fields and object templates', async () => {
  for (const [route, fields] of [
    ['/requirements/new', ['Stakeholder problem', 'Desired outcome', 'Acceptance criteria', 'Requirement Driver']],
    ['/initiatives/new', ['Business outcome', 'Scope', 'Milestone intent', 'Initiative Driver']],
    ['/tech-debt/new', ['Current pain', 'Desired invariant', 'Affected modules', 'Validation strategy', 'Tech Debt Driver']],
    ['/tasks/new', ['Execution brief', 'Acceptance checklist', 'Parent context']],
    ['/bugs/new', ['Observed behavior', 'Expected behavior', 'Reproduction steps', 'Environment', 'Severity', 'Bug Driver']],
  ] as const) {
    const screen = await renderRoute(route);
    for (const field of fields) {
      expect(await screen.findByLabelText(new RegExp(field, 'i'))).toBeTruthy();
    }
    expect(screen.getByRole('textbox', { name: /narrative markdown/i })).toBeTruthy();
  }
});
```

Run:

```bash
pnpm vitest run tests/web/project-management-routes.test.tsx
```

Expected: FAIL until pages are data-backed.

- [ ] **Step 3: Add query client methods and hooks**

In `query.ts`, add:

```ts
listMyWork: (query: MyWorkQuery) => projectManagementQueueResponseSchema.parse(await request(`/query/my-work${queryString(query)}`)),
listRequirements: (query: ProductListQuery) => requirementListResponseSchema.parse(await request(`/query/requirements${queryString(query)}`)),
getRequirement: (requirementId: string) => requirementDetailSchema.parse(await request(`/query/requirements/${encodeURIComponent(requirementId)}`)),
listTasks: (query: ProductListQuery) => taskListResponseSchema.parse(await request(`/query/tasks${queryString(query)}`)),
getTask: (taskId: string) => taskDetailSchema.parse(await request(`/query/tasks/${encodeURIComponent(taskId)}`)),
```

Add equivalent methods for initiatives, tech debt, and bugs.

In `hooks.ts`, add `useMyWorkQuery`, `useRequirementsQuery`, `useRequirementQuery`, `useInitiativesQuery`, `useInitiativeQuery`, `useTechDebtQuery`, `useTechDebtDetailQuery`, `useTasksQuery`, `useTaskQuery`, `useBugsQuery`, and `useBugQuery`.

- [ ] **Step 4: Implement shared object list/detail primitives**

`object-list.tsx` should render:

- filter bar;
- `DataTable`;
- typed object route links;
- empty/loading/error states.

`object-detail-layout.tsx` should render:

- `DetailLayout`;
- header with type, lifecycle state, risk, and driver/responsible label;
- metadata strip;
- MDXEditor narrative;
- structured sections;
- `EvidenceAttachments`.
- explicit save behavior that calls the typed narrative mutation for the current object and invalidates the typed detail query key.

`object-forms.tsx` should render typed create forms with structured fields that remain outside Markdown:

- Requirement: stakeholder problem, desired outcome, acceptance criteria, in-scope/out-of-scope, Requirement Driver, narrative Markdown template.
- Initiative: business outcome, scope, milestone intent, release intent, Initiative Driver, narrative Markdown template.
- Tech Debt: current pain, desired invariant, affected modules, validation strategy, release impact, Tech Debt Driver, narrative Markdown template.
- Task: execution brief, acceptance checklist, parent context, repo/package readiness context, narrative Markdown template.
- Bug: observed behavior, expected behavior, reproduction steps, environment, severity, suspected area, verification path, Bug Driver, narrative Markdown template.

Templates seed Markdown only for narrative context. Structured fields must remain validated form fields so filtering, reporting, acceptance, and workflow gates do not depend on parsing Markdown prose.

- [ ] **Step 5: Implement My Work**

`my-work-route.tsx` must group rows by the role bucket from the read model. It must not create role-specific pages or route fragments. Row links use `href` from read models and must be typed routes only.

- [ ] **Step 6: Implement typed list/detail pages**

Use a single generic pattern, but keep user-facing components typed:

- `RequirementListRoute`, `RequirementDetailRoute`, `NewRequirementRoute`.
- `InitiativeListRoute`, `InitiativeDetailRoute`, `NewInitiativeRoute`.
- `TechDebtListRoute`, `TechDebtDetailRoute`, `NewTechDebtRoute`.
- `TaskListRoute`, `TaskDetailRoute`, `NewTaskRoute`.
- `BugListRoute`, `BugDetailRoute`, `NewBugRoute`.

Create flows:

- Requirement/Bug/Initiative/Tech Debt can call the existing Work Item create API only through typed wrappers that set `kind` and preserve `driver_actor_id` and `intake_context`.
- Task create calls `/tasks` and must not call `/work-items`.

Cancel buttons must return to typed list routes, not `/work-items`.

- [ ] **Step 7: Wire route modules to feature routes**

Each app route module should be a thin import:

```tsx
import { RequirementsRoute } from '../../../features/requirements/requirements-routes';

export default RequirementsRoute;
```

- [ ] **Step 8: Run typed page tests**

Run:

```bash
pnpm vitest run tests/web/my-work-route.test.tsx tests/web/project-management-routes.test.tsx tests/web/api-hooks.test.tsx
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit typed pages**

```bash
git add apps/web/src/features/project-management apps/web/src/features/my-work apps/web/src/features/requirements apps/web/src/features/initiatives apps/web/src/features/tech-debt apps/web/src/features/tasks apps/web/src/features/bugs apps/web/src/app/routes apps/web/src/shared/api tests/web
git commit -m "feat: add typed project management pages"
```

## Task 8: Specs & Plans Queue And Task-Scoped Runtime Evidence

**Files:**
- Modify: `apps/web/src/features/spec-plan/spec-plan-direct-routes.tsx`
- Delete/refactor: `apps/web/src/features/spec-plan/spec-plan-work-item-flow.tsx`
- Create: `apps/web/src/features/spec-plan/specs-plans-route.tsx`
- Create: `apps/web/src/features/tasks/task-evidence-routes.tsx`
- Delete/refactor: `apps/web/src/features/execution-packages/execution-package-routes.tsx`
- Delete/refactor: `apps/web/src/features/run-console/run-console-routes.tsx`
- Delete/refactor: `apps/web/src/features/review-packets/review-packet-routes.tsx`
- Modify: `apps/web/src/app/routes/specs-plans/index.tsx`
- Modify: task-scoped route modules under `apps/web/src/app/routes/tasks/$taskId/**`
- Test: `tests/web/task-scoped-evidence-routes.test.tsx`
- Test: `tests/web/project-management-routes.test.tsx`

- [ ] **Step 1: Write failing Specs & Plans route tests**

Add:

```tsx
it('renders Specs & Plans as one queue with separate tabs', async () => {
  const screen = await renderRoute('/specs-plans');
  expect(await screen.findByRole('heading', { name: 'Specs & Plans' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Specs' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Plans' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Specs registry' })).toBeNull();
});
```

Run:

```bash
pnpm vitest run tests/web/project-management-routes.test.tsx
```

Expected: FAIL until `/specs-plans` is implemented.

- [ ] **Step 2: Write failing task-scoped evidence route tests**

In `tests/web/task-scoped-evidence-routes.test.tsx`, add:

```tsx
it('renders package evidence under task scope and not as a registry', async () => {
  const screen = await renderRoute('/tasks/task-1/packages/pkg-1');
  expect(await screen.findByRole('heading', { name: /package evidence/i })).toBeTruthy();
  expect(screen.getByText(/Task task-1/i)).toBeTruthy();
  expect(screen.queryByRole('link', { name: /Packages/i })).toBeNull();
});

it('renders product-safe not found for mismatched task and evidence ids', async () => {
  const screen = await renderRoute('/tasks/task-other/packages/pkg-1', {
    apiOverrides: {
      'GET /query/tasks/task-other/packages/pkg-1': new Response(JSON.stringify({ message: 'Not found' }), { status: 404 }),
    },
  });
  expect(await screen.findByText(/not found|access denied/i)).toBeTruthy();
});
```

Run:

```bash
pnpm vitest run tests/web/task-scoped-evidence-routes.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement Specs & Plans queue**

`SpecsPlansRoute` should:

- fetch spec and plan queues from query API;
- show tabs/segmented control for Specs and Plans;
- group by needs authoring, needs review, approved, stale, and blocked;
- link details to `/specs/:specId` and `/plans/:planId`;
- show source typed object context, not generic Work Item context.

- [ ] **Step 4: Refactor Spec/Plan detail context labels**

Keep direct detail routes. Update `spec-plan-direct-routes.tsx` to use `Source Object Context` and typed links instead of Work Item route links. New-create links should point to source typed object detail pages, not `/work-items`.

- [ ] **Step 5: Implement task evidence routes**

`task-evidence-routes.tsx` should export:

- `TaskPackageEvidenceRoute`
- `TaskRunEvidenceRoute`
- `TaskReviewEvidenceRoute`

Each route must:

- read both `taskId` and evidence id from route params;
- call task-scoped query endpoint;
- render product-safe not-found/access-denied on mismatch;
- render package/run/review detail as evidence inside `DetailLayout`;
- keep runtime actions fail-closed if readiness query is loading/erroring.

- [ ] **Step 6: Remove top-level runtime route usage**

Delete or stop importing old runtime registry feature files. ProductAction href generation in fixtures and API clients must emit task-scoped paths:

```ts
href: `/tasks/${taskId}/packages/${packageId}`
href: `/tasks/${taskId}/runs/${runSessionId}`
href: `/tasks/${taskId}/reviews/${reviewPacketId}`
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm vitest run tests/web/task-scoped-evidence-routes.test.tsx tests/web/project-management-routes.test.tsx tests/web/api-hooks.test.tsx
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Specs & Plans and task evidence**

```bash
git add apps/web/src/features/spec-plan apps/web/src/features/tasks apps/web/src/app/routes tests/web
git commit -m "feat: move runtime evidence under tasks"
```

## Task 9: Board, Releases, Reports, And Final No-Baggage Cleanup

**Files:**
- Create: `apps/web/src/features/board/board-route.tsx`
- Create: `apps/web/src/features/reports/reports-routes.tsx`
- Modify: `apps/web/src/features/releases/release-routes.tsx`
- Modify: `apps/web/src/features/releases/release-action-rail.tsx`
- Modify: `apps/web/src/app/routes/board/index.tsx`
- Modify: report route modules under `apps/web/src/app/routes/reports/**`
- Modify: `apps/web/src/app/routes/releases/$releaseId.tsx`
- Modify: `apps/web/src/app/routes/releases/$releaseId/evidence.tsx`
- Modify: `tests/web/board-reports-release-readiness.test.tsx`
- Modify: `tests/web/a11y-gates.test.tsx`
- Modify: `tests/web/responsive-layout.test.tsx`
- Modify: `tests/web/no-legacy-web-ui.test.ts`
- Modify: `tests/naming/delivery-naming.test.ts`
- Modify: `tests/e2e/web-product-routes.e2e.test.ts`
- Modify: `tests/e2e/run-console.e2e.test.ts`

- [ ] **Step 1: Write failing Board/Reports/Release tests**

In `tests/web/board-reports-release-readiness.test.tsx`, add:

```tsx
it('renders cross-object board cards without assuming one schema', async () => {
  const screen = await renderRoute('/board');
  expect(await screen.findByRole('heading', { name: 'Board' })).toBeTruthy();
  for (const label of ['Requirement', 'Initiative', 'Tech Debt', 'Task', 'Bug', 'Spec', 'Plan', 'Release']) {
    expect(screen.getByText(label)).toBeTruthy();
  }
});

it('shows release readiness by typed object and scoped evidence', async () => {
  const screen = await renderRoute('/releases/release-1');
  expect(await screen.findByRole('heading', { name: /release readiness/i })).toBeTruthy();
  for (const label of ['Initiative', 'Requirement', 'Tech Debt', 'Task', 'Bug']) {
    expect(screen.getByText(label)).toBeTruthy();
  }
  expect(document.body.textContent).not.toContain('/packages/');
});

it('renders report index and report families', async () => {
  for (const [route, heading] of [
    ['/reports', 'Reports'],
    ['/reports/delivery', 'Delivery Flow'],
    ['/reports/quality', 'Quality'],
    ['/reports/release-readiness', 'Release Readiness'],
    ['/reports/observation', 'Observation'],
    ['/reports/replay', 'Replay'],
  ] as const) {
    const screen = await renderRoute(route);
    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
  }
});
```

Run:

```bash
pnpm vitest run tests/web/board-reports-release-readiness.test.tsx
```

Expected: FAIL until pages are implemented.

- [ ] **Step 2: Implement Board route**

Board must fetch `BoardCard[]`, render columns or saved view, and support cards for Requirements, Initiatives, Tech Debt, Tasks, Bugs, Specs, Plans, and Releases. Cards link to typed routes only.

- [ ] **Step 3: Update Releases**

Release detail must:

- show typed scope refs for Initiative, Requirement, Tech Debt, Task, Bug;
- show package/run/review evidence as scoped evidence, not top-level route links;
- keep Release Owner copy as legitimate release ownership, not Work Item owner;
- show disabled reasons from `ReleaseReadinessDetail`.

- [ ] **Step 4: Implement Reports**

Reports should be product summaries:

- Delivery flow and bottlenecks.
- Quality and bug escape.
- Release readiness and risk.
- Observation and post-release signals.
- Replay and retrospective evidence.

No report may link to `/packages`, `/runs`, or `/reviews` top-level routes.

- [ ] **Step 5: Update no-baggage scans**

In `tests/web/no-legacy-web-ui.test.ts`, add route and file assertions:

```ts
it('does not keep old product route modules', () => {
  for (const path of [
    'apps/web/src/app/routes/lanes',
    'apps/web/src/app/routes/pipeline',
    'apps/web/src/app/routes/work-items',
    'apps/web/src/app/routes/packages',
    'apps/web/src/app/routes/runs',
    'apps/web/src/app/routes/reviews',
    'apps/web/src/features/product-lanes',
    'apps/web/src/features/pipeline',
    'apps/web/src/features/execution-packages/execution-package-routes.tsx',
    'apps/web/src/features/run-console/run-console-routes.tsx',
    'apps/web/src/features/review-packets/review-packet-routes.tsx',
  ]) {
    expect(existsSync(path), path).toBe(false);
  }
});

it('does not keep removed top-level product route hrefs or labels on active Web surfaces', () => {
  expect(productSourceText()).not.toMatch(
    /(?:to=|href=|href:|target:\s*{[\s\S]{0,120}href:)\s*['"`]\/(?:lanes|pipeline|work-items|packages|runs|reviews)(?:\/|\?|['"`])/,
  );
  expect(productSourceText()).not.toMatch(/>Lanes<|>Pipeline<|>Work Items<|>Packages<|>Runs<|>Reviews</);
});
```

Update `tests/naming/delivery-naming.test.ts` to scan new project-management routes and allow legacy terms only inside explicit negative tests and historical docs.

- [ ] **Step 6: Update e2e route smoke**

`tests/e2e/web-product-routes.e2e.test.ts` must visit:

- `/my-work`
- `/requirements`
- `/requirements/req-1`
- `/initiatives`
- `/initiatives/init-1`
- `/tech-debt`
- `/tech-debt/td-1`
- `/specs-plans`
- `/specs/spec-1`
- `/plans/plan-1`
- `/tasks`
- `/tasks/task-1`
- `/tasks/task-1/packages/pkg-1`
- `/tasks/task-1/runs/run-1`
- `/tasks/task-1/reviews/review-1`
- `/bugs`
- `/bugs/bug-1`
- `/board`
- `/releases`
- `/releases/release-1`
- `/reports`

It must assert removed routes no-match. Refactor `tests/e2e/run-console.e2e.test.ts` to open the task-scoped run evidence route `/tasks/task-1/runs/run-1` for product navigation coverage. If runtime-only behavior still needs a separate e2e check, create a non-product API/runtime smoke under a different test name in the same commit; do not keep `/runs/:runSessionId` as a browser product route.

- [ ] **Step 7: Run focused Web gates**

Run:

```bash
pnpm vitest run tests/web/board-reports-release-readiness.test.tsx tests/web/a11y-gates.test.tsx tests/web/responsive-layout.test.tsx tests/web/no-legacy-web-ui.test.ts tests/naming/delivery-naming.test.ts
pnpm vitest run tests/e2e/web-product-routes.e2e.test.ts tests/e2e/run-console.e2e.test.ts
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Board, Reports, Releases, and cleanup**

```bash
git add apps/web/src/features/board apps/web/src/features/reports apps/web/src/features/releases apps/web/src/app/routes tests/web tests/e2e tests/naming
git add -u apps/web/src/app/routes apps/web/src/features
git commit -m "feat: finish project management web ia cleanup"
```

## Task 10: Final Verification, Visual QA, And No-Baggage Audit

**Files:**
- Verify all changed files.
- Do not create new source files unless fixing verification failures.

- [ ] **Step 1: Run targeted contract/API/DB/Web tests**

Run:

```bash
pnpm vitest run \
  tests/contracts/project-management-contracts.test.ts \
  tests/contracts/project-management-readiness.test.ts \
  tests/contracts/attachments.test.ts \
  tests/contracts/markdown-document.test.ts \
  tests/db/schema.test.ts \
  tests/db/task-repository.test.ts \
  tests/db/attachment-repository.test.ts \
  tests/api/tasks.test.ts \
  tests/api/attachments.test.ts \
  tests/api/markdown-document.test.ts \
  tests/api/project-management-query.test.ts \
  tests/api/task-scoped-evidence.test.ts \
  tests/api/project-management-release-readiness.test.ts \
  tests/web/attachment-api.test.ts \
  tests/web/markdown-editor.test.tsx \
  tests/web/markdown-editor-attachments.test.tsx \
  tests/web/attachment-evidence-rendering.test.tsx \
  tests/web/my-work-route.test.tsx \
  tests/web/project-management-routes.test.tsx \
  tests/web/task-scoped-evidence-routes.test.tsx \
  tests/web/board-reports-release-readiness.test.tsx \
  tests/web/app-shell-routing.test.tsx \
  tests/web/api-hooks.test.tsx \
  tests/web/no-legacy-web-ui.test.ts \
  tests/naming/delivery-naming.test.ts
```

Expected: PASS.

- [ ] **Step 2: Verify destructive schema against a safe local/dev database**

Run:

```bash
printenv DATABASE_URL
pnpm db:push
```

Expected: `DATABASE_URL` points to a safe local/dev database, and Drizzle applies or confirms the current schema without errors. If no safe DB is available, document this as a release blocker instead of treating the build as complete.

- [ ] **Step 3: Run package builds**

Run:

```bash
pnpm --filter @forgeloop/contracts build
pnpm --filter @forgeloop/domain build
pnpm --filter @forgeloop/db build
pnpm --filter @forgeloop/control-plane-api build
pnpm --filter @forgeloop/web typecheck
pnpm --filter @forgeloop/web build
```

Expected: PASS.

- [ ] **Step 4: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS. If the combined suite shows isolated 404/timeouts, rerun the exact failing file in isolation before changing code.

- [ ] **Step 5: Run route/no-baggage grep audit**

Run:

```bash
pnpm vitest run tests/naming/delivery-naming.test.ts tests/web/no-legacy-web-ui.test.ts
rg -n "Work Item Owner|work-item-owner|workItemOwner|work_item_owner" apps packages tests
rg -n "\\bowner_actor_id\\b" apps/web/src/features apps/web/src/app/routes tests/web
rg -n "(to=|href=|href:|target:[\\s\\S]{0,160}href:)\\s*['\\\"]/((lanes|pipeline|work-items|packages|runs|reviews)(/|\\?|['\\\"]|$))" apps/web/src tests/web tests/e2e
rg -n "prefix\\('lanes'|route\\('pipeline'|prefix\\('work-items'|prefix\\('packages'|prefix\\('runs'|prefix\\('reviews'|prefix\\('specs', \\[index|prefix\\('plans', \\[index" apps/web/src/app/routes.ts
```

Expected:

- Historical subsystem naming guard passes.
- Work Item Owner terms have no hits except explicit negative/no-baggage tests if unavoidable.
- `owner_actor_id` appears only for legitimate non-Work-Item ownership or explicit rejection tests.
- Removed top-level route hrefs appear only in negative route tests/no-baggage assertions, not active Web source. Task-scoped routes such as `/tasks/:taskId/packages/:packageId` are valid and must not be flagged.
- `routes.ts` has no forbidden route-family entries.
- For grep commands whose expected result is "no hits", `rg` exits with code `1`; treat no output as PASS and any matching output as a failure to inspect.

- [ ] **Step 6: Run browser visual QA**

Start the app:

```bash
pnpm dev:web
```

Open the dev server and validate screenshots at 375, 768, 1024, and 1440 px for:

- `/my-work`
- `/requirements`
- `/requirements/req-1`
- `/tasks/task-1`
- `/tasks/task-1/packages/pkg-1`
- `/specs-plans`
- `/releases/release-1`
- `/reports`

Expected:

- No text overlap.
- No horizontal scroll at 375 px.
- Sidebar collapses cleanly on mobile.
- Editor toolbar is keyboard reachable.
- Attachment unavailable states do not expose raw URLs.
- Runtime evidence is discoverable under Task details.
- Primary nav remains exactly `Dashboard / My Work / Requirements / Specs & Plans / Tasks / Bugs / Board / Releases / Reports`.

- [ ] **Step 7: Final status and commit any verification fixes**

If verification required fixes:

```bash
git add apps/control-plane-api apps/web packages tests package.json pnpm-lock.yaml
git commit -m "fix: close project management ia verification gaps"
```

Then rerun the failed verification commands.

- [ ] **Step 8: Final implementation summary**

Prepare a concise implementation summary with:

- contract/API changes;
- DB migrations/schema additions;
- route families removed;
- typed pages added;
- MDXEditor and attachment behavior;
- verification commands and results;
- known non-blocking follow-ups, if any.

## Final Acceptance Checklist

- [ ] `apps/web/src/app/routes.ts` uses the final route map and no old route family.
- [ ] `/` redirects to `/my-work` through `apps/web/src/app/routes/_index.tsx`.
- [ ] Primary nav is exactly `Dashboard / My Work / Requirements / Specs & Plans / Tasks / Bugs / Board / Releases / Reports`.
- [ ] Initiative and Tech Debt are typed routes and pages but not first-level sidebar items.
- [ ] Task is first-class and backed by Task API/read models, not a Work Item kind.
- [ ] Task package generation/enqueue requires current approved SpecRevision and PlanRevision.
- [ ] `manual_exception` cannot authorize runtime package generation, runtime enqueue, review/test gates, or release readiness.
- [ ] Package/run/review evidence routes validate Task ownership.
- [ ] Removed route families no-match and are not redirects or aliases.
- [ ] Public product DTOs use typed object refs, not public `work_item` refs.
- [ ] Product-facing typed Work Item surfaces use `driver_actor_id` and typed `intake_context`.
- [ ] No product-facing Work Item Owner or public Work Item `owner_actor_id` remains.
- [ ] MDXEditor is wrapped by ForgeLoop-owned editor components.
- [ ] Markdown is canonical persisted narrative content.
- [ ] Server-side Markdown validation rejects raw HTML, unsafe protocols, base64/data/blob/file URLs, raw storage URLs, and unresolved attachment refs.
- [ ] Attachment API is multipart-only for upload and never exposes `storage_uri`.
- [ ] `AttachmentRenderRef.render_url` is same-origin and opaque.
- [ ] Evidence Attachments render unavailable/tombstoned states safely.
- [ ] Board, Releases, and Reports use typed lifecycle objects and do not route users to top-level runtime object browsers.
- [ ] Focused tests, package builds, full `pnpm test`, route/no-baggage grep audit, and browser visual QA pass.
