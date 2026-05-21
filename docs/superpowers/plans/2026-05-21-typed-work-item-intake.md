# Typed Work Item Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace generic Work Item creation with type-specific intake for Initiative, Requirement, Bug, and Tech Debt, while destructively moving the Work Item product contract from Owner to Driver.

**Architecture:** Add shared typed-intake Zod contracts, promote `driver_actor_id` into the Work Item domain/read model/schema, and keep Owner terminology only for Project, Execution Package, QA/Test, and Release roles. The Web `/work-items/new` route becomes one typed intake workflow that derives normalized `goal` and `success_criteria`, submits structured `intake_context`, and routes the user to the correct Work Item lane. Product Lane filtering is lane-aware: Work Item type lanes use `driver_actor_id`, while execution/review/QA/release lanes keep their existing role-specific filters.

**Tech Stack:** TypeScript, Zod, NestJS, Drizzle ORM, React Router, React Hook Form, Vitest, Testing Library.

---

## Spec And Scope

Implement the Stream B spec at `docs/superpowers/specs/2026-05-21-typed-work-item-intake-design.md`.

Hard requirements:

- No Work Item `owner_actor_id` compatibility endpoint, alias, double-read path, fallback query key, or public read model.
- No old generic Work Item create form.
- No Work Item Owner page, lane, route, query key, fixture, happy-path test, or UI copy.
- Preserve non-Work-Item Owner concepts: Project Owner, Execution Owner, QA/Test Owner, Release Owner.
- Do not redesign Delivery Action, Review, Release, Package, Run, or Delivery Cockpit typed brief UI in this stream.
- Do not implement Work Item Brief generation automation here.

Chosen implementation direction:

- Rename the Work Item persistence column from `owner_actor_id` to `driver_actor_id` in `packages/db/src/schema/work-item.ts`. This avoids carrying a hidden Work Item Owner persistence concept.
- Because this repo does not currently keep Drizzle migration files, this is a destructive schema-source change. Local/dev databases should be reset or updated with `pnpm db:push`; there is no compatibility migration in this plan.

## File Map

Create:

- `packages/contracts/src/work-item-intake.ts` - shared Work Item kind, intake-context schemas, request/read schemas, and type exports.
- `tests/contracts/work-item-intake.test.ts` - contract tests for typed contexts, Work Item create/patch/read payloads, trimming, kind/context mismatch, and old Owner rejection.
- `apps/web/src/features/work-items/intake/intake-model.ts` - Web labels, defaults, normalization helpers, field descriptors, and lane mapping for intake.
- `apps/web/src/features/work-items/intake/intake-fields.tsx` - type-specific field groups rendered by the create form.
- `tests/web/work-item-intake-form.test.tsx` - route-level form tests for all four Work Item kinds.

Modify:

- `packages/contracts/src/index.ts` - export typed intake contracts.
- `packages/contracts/src/work-item-delivery-readiness.ts` - Work Item cockpit read model uses `driver_actor_id` and `intake_context`.
- `packages/contracts/src/web-product-query.ts` - add `driver_actor_id` for product list/lane query/read surfaces while keeping Owner filters for non-Work-Item roles.
- `packages/contracts/src/api.ts` - add `driver_actor_id` to supported Product Lane query keys without modifying ProductAction command schemas.
- `packages/domain/src/types.ts` - `WorkItem` uses `driver_actor_id` and `intake_context`.
- `packages/domain/src/states.ts` - Work Item create transition uses `driver_actor_id` and `intake_context`.
- `packages/db/src/schema/work-item.ts` - rename Work Item actor column to `driver_actor_id`; add `intake_context` JSONB.
- `packages/db/src/repositories/in-memory-delivery-repository.ts` - no storage adapter shape change expected beyond type fallout.
- `packages/db/src/repositories/drizzle-delivery-repository.ts` - confirm generic snake/camel mapping still works after schema rename; add explicit Work Item mapping only if tests prove it is needed.
- `packages/db/src/queries/work-item-cockpit-queries.ts` - expose `driver_actor_id` and `intake_context` in the cockpit read model.
- `packages/db/src/queries/product-lane-types.ts` - add `driver_actor_id`; Work Item type lanes use it as actor filter.
- `packages/db/src/queries/product-lane-filters.ts` - support `driver_actor_id`; reject unsupported `owner_actor_id` for Work Item type lanes through existing unsupported-filter flow/API parser.
- `packages/db/src/queries/product-lane-queries.ts` - Work Item lane projection populates `driver_actor_id`; execution packages still populate `owner_actor_id`.
- `packages/db/src/queries/web-product-queries.ts` - `/query/work-items` filters and list items use `driver_actor_id`; package/run/release registries keep Owner fields.
- `apps/control-plane-api/src/modules/delivery/dto.ts` - Work Item create/patch DTOs import shared typed-intake schemas and reject `owner_actor_id`.
- `apps/control-plane-api/src/modules/work-items/work-item.service.ts` - create/patch/read Work Items with Driver and structured intake.
- `apps/control-plane-api/src/modules/query/query.service.ts` - reject `/query/work-items?owner_actor_id=...` and allow `/query/work-items?driver_actor_id=...`.
- `apps/control-plane-api/src/modules/query/product-lane-query-parser.ts` - parse `driver_actor_id`; keep `owner_actor_id` only where lane metadata supports it.
- `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts` - use `workItem.driver_actor_id` for Work Item-authored Spec/Plan events/revisions.
- `apps/control-plane-api/src/modules/automation/automation-command.service.ts` - use Work Item Driver where old code referenced the Work Item owner; keep execution package Owner fields intact.
- `apps/control-plane-api/src/modules/execution-packages/execution-package.service.ts` - derive default execution-package Owner/Reviewer/QA from `workItem.driver_actor_id` where applicable, but do not rename execution-package Owner fields.
- `apps/control-plane-api/src/modules/run-control/run-control.service.ts` - use `workItem.driver_actor_id` for Work Item driver checks/logging.
- `apps/web/src/shared/api/types.ts` - `CreateWorkItemBody`, `WorkItem`, and `ProductLaneQuery` use Driver/intake fields.
- `apps/web/src/shared/api/query-keys.ts` - normalize `driver_actor_id`.
- `apps/web/src/shared/api/query.ts` - product lane query sends `driver_actor_id`.
- `apps/web/src/shared/api/hooks.ts` - product Work Item registry hooks accept and cache Driver filters.
- `apps/web/src/shared/api/commands.ts` - create Work Item payload type only; endpoint unchanged.
- `apps/web/src/features/product-lanes/product-lanes.ts` - supported search params include `driver_actor_id`.
- `apps/web/src/features/product-lanes/product-lane-route.tsx` - parse/link Driver filters for Work Item type lanes and avoid carrying `owner_actor_id` into those lanes.
- `apps/web/src/features/work-items/create-work-item-form.tsx` - replace generic form with typed intake workflow using the new intake helpers/fields.
- `tests/api/work-items.test.ts` - valid typed creates for all kinds, Driver patching, old Owner rejection, intake validation.
- `tests/api/product-lanes.test.ts` - Work Item type lanes filter by Driver and reject Owner fallback; Execution Owner lane remains Owner-based.
- `tests/api/query-module.test.ts` - `/query/work-items` uses Driver filters/read items and rejects Work Item Owner filters.
- `tests/contracts/contracts.test.ts` - import/export sanity for new contracts if needed.
- `tests/contracts/product-actions.test.ts` - add compile/runtime assertion that ProductAction command schemas did not change.
- `tests/db/schema.test.ts` - expect `work_items.driver_actor_id` and `work_items.intake_context`; reject Work Item `owner_actor_id`.
- `tests/db/repository-contract.ts` - Work Item fixtures use Driver/intake context.
- `tests/db/repository.test.ts` - follows repository contract fallout.
- `tests/web/api.test.ts` - create Work Item sends Driver/intake payload.
- `tests/web/api-hooks.test.tsx` - query-key/filter fallout.
- `tests/web/product-lanes-route.test.tsx` - Driver filter preservation/dropping behavior.
- `tests/web/fixtures/product-data.ts` - Work Item fixture uses Driver/intake; execution package fixtures keep Owner.
- `tests/web/fixtures/product-api-mock.ts` - fixture API responses match new Work Item shape.
- `tests/helpers/delivery-runtime-fixtures.ts` - Work Item helper payloads use Driver/intake; execution packages keep Owner.
- `tests/domain/states.test.ts` - Work Item create transition fixture uses Driver/intake.
- `tests/naming/delivery-naming.test.ts` - add guard for active Work Item Owner names/fields with allowed exceptions.
- `tests/web/no-legacy-web-ui.test.ts` - add Web guard for Work Item Owner copy/field usage.

Do not modify except for required compile fallout:

- `apps/web/src/features/work-items/delivery-cockpit/*` typed brief rendering.
- Delivery Action and ProductAction command behavior.
- Package, Run, Review, and Release route UX.
- `docs/superpowers/specs/2026-05-21-delivery-action-decision-ux-closure-design.md`.
- `docs/superpowers/specs/2026-05-21-full-page-ui-cleanup-design.md`.

## Shared Contract Shape

Use these exact public shapes as the implementation target:

```ts
export type WorkItemKind = 'initiative' | 'requirement' | 'bug' | 'tech_debt';

export type WorkItemIntakeContext =
  | {
      type: 'requirement';
      stakeholder_problem: string;
      desired_outcome: string;
      acceptance_criteria: string[];
      in_scope: string[];
      out_of_scope?: string[];
      dependencies?: string[];
      rollout_notes?: string;
    }
  | {
      type: 'bug';
      impact_summary: string;
      observed_behavior: string;
      expected_behavior: string;
      reproduction_steps: string[];
      affected_environment: string;
      verification_path: string;
      suspected_area?: string;
      regression_risk?: string;
    }
  | {
      type: 'tech_debt';
      current_pain: string;
      desired_invariant: string;
      affected_modules: string[];
      behavior_preservation: string;
      validation_strategy: string;
      migration_constraints?: string;
      rollback_notes?: string;
    }
  | {
      type: 'initiative';
      business_outcome: string;
      scope_narrative: string;
      success_metrics: string[];
      milestone_intent?: string;
      child_breakdown_assumptions?: string;
      major_risks?: string;
      cross_item_coordination_notes?: string;
    };
```

Create body:

```ts
{
  project_id: string;
  kind: WorkItemKind;
  title: string;
  goal: string;
  success_criteria: string[];
  priority: string;
  risk: string;
  driver_actor_id: string;
  intake_context: WorkItemIntakeContext;
}
```

Patch body:

```ts
{
  goal?: string;
  success_criteria?: string[];
  priority?: string;
  risk?: string;
  driver_actor_id?: string;
  intake_context?: WorkItemIntakeContext;
  phase?: 'draft' | 'triage';
}
```

Read model:

```ts
{
  id: string;
  project_id: string;
  kind: WorkItemKind;
  title: string;
  goal: string;
  success_criteria: string[];
  priority: string;
  risk: string;
  driver_actor_id: string;
  intake_context: WorkItemIntakeContext;
  phase: string;
  activity_state: string;
  gate_state: string;
  resolution: string;
}
```

Validation rules:

- Zod `.strict()` everywhere public.
- Required strings are `.trim().min(1)`.
- Required arrays are trimmed and must contain at least one non-empty item.
- Optional empty strings and optional empty arrays are omitted from stored context.
- `kind` must match `intake_context.type`.
- `owner_actor_id` in a Work Item create/patch body must fail as an unknown key, not be ignored.

## Task 1: Add Typed Intake Contracts

**Files:**

- Create: `packages/contracts/src/work-item-intake.ts`
- Create: `tests/contracts/work-item-intake.test.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write failing contract tests**

Add tests that cover:

```ts
import {
  createWorkItemRequestSchema,
  patchWorkItemRequestSchema,
  publicWorkItemSchema,
  workItemIntakeContextSchema,
} from '@forgeloop/contracts';

expect(workItemIntakeContextSchema.parse({
  type: 'bug',
  impact_summary: ' Checkout fails ',
  observed_behavior: 'Submit returns 500',
  expected_behavior: 'Order is created',
  reproduction_steps: [' Sign in ', '', 'Submit checkout'],
  affected_environment: 'production',
  verification_path: 'Regression test',
})).toMatchObject({
  type: 'bug',
  impact_summary: 'Checkout fails',
  reproduction_steps: ['Sign in', 'Submit checkout'],
});

expect(createWorkItemRequestSchema.safeParse({
  project_id: 'project-1',
  kind: 'bug',
  title: 'Checkout fails',
  goal: 'Fix checkout',
  success_criteria: ['Regression passes'],
  priority: 'P0',
  risk: 'high',
  driver_actor_id: 'actor-driver',
  owner_actor_id: 'actor-owner',
  intake_context: validBugIntake,
}).success).toBe(false);

expect(createWorkItemRequestSchema.safeParse({
  ...validRequirementCreate,
  kind: 'bug',
  intake_context: validRequirementIntake,
}).success).toBe(false);
```

Also assert:

- all four context variants parse;
- missing required fields fail;
- empty required arrays fail after trimming;
- patch accepts `driver_actor_id` but rejects `owner_actor_id`;
- public Work Item read model requires `driver_actor_id` and `intake_context`.

- [ ] **Step 2: Run contract test and verify it fails**

Run:

```bash
pnpm exec vitest run tests/contracts/work-item-intake.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because `packages/contracts/src/work-item-intake.ts` does not exist or exports are missing.

- [ ] **Step 3: Implement shared schemas**

Create `packages/contracts/src/work-item-intake.ts` with:

- `workItemKindSchema`
- `workItemIntakeContextSchema`
- `createWorkItemRequestSchema`
- `patchWorkItemRequestSchema`
- `publicWorkItemSchema`
- type exports for each schema
- helper preprocessors for trimmed optional strings and non-empty trimmed arrays

Implementation notes:

- Use `z.preprocess` for arrays so `[' value ', '']` normalizes to `['value']`.
- Use `.superRefine()` on create/patch schemas to enforce `kind === intake_context.type` when both are known.
- Keep generic fields in create/patch schemas because API and Web submit normalized `goal` and `success_criteria`.

- [ ] **Step 4: Export contracts**

Modify:

```ts
// packages/contracts/src/index.ts
export * from './work-item-intake.js';
```

Do not update Work Item read-model schemas in this task. Those schemas depend on the domain and fixture migration in Task 2.

- [ ] **Step 5: Run focused contract tests**

Run:

```bash
pnpm exec vitest run tests/contracts/work-item-intake.test.ts tests/contracts/contracts.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/work-item-intake.ts packages/contracts/src/index.ts tests/contracts/work-item-intake.test.ts
git commit -m "feat: add typed work item intake contracts"
```

## Task 2: Migrate Domain And Persistence To Work Item Driver

**Files:**

- Modify: `packages/domain/src/types.ts`
- Modify: `packages/domain/src/states.ts`
- Modify: `packages/contracts/src/work-item-delivery-readiness.ts`
- Modify: `packages/db/src/schema/work-item.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts` if generic mapping is insufficient
- Modify: `packages/db/src/queries/work-item-cockpit-queries.ts`
- Modify: `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation-command.service.ts`
- Modify: `apps/control-plane-api/src/modules/execution-packages/execution-package.service.ts`
- Modify: `apps/control-plane-api/src/modules/run-control/run-control.service.ts`
- Modify: `tests/domain/states.test.ts`
- Modify: `tests/db/schema.test.ts`
- Modify: `tests/db/repository-contract.ts`
- Modify: `tests/db/repository.test.ts`
- Modify: `tests/helpers/delivery-runtime-fixtures.ts`

- [ ] **Step 1: Write/update failing domain and DB tests**

Update `tests/domain/states.test.ts` Work Item create expectations:

```ts
expect(created).toMatchObject({
  driver_actor_id: 'actor-driver',
  intake_context: validRequirementIntake,
});
expect(created).not.toHaveProperty('owner_actor_id');
```

Update `tests/db/schema.test.ts`:

```ts
expect(columnType(work_items, 'driver_actor_id')).toBe('PgUUID');
expect(columnType(work_items, 'intake_context')).toBe('PgJsonb');
expect(Object.keys(getTableColumns(work_items))).not.toContain('ownerActorId');
expect(hasForeignKey(work_items, 'driver_actor_id', column(actors, 'id'))).toBe(true);
```

Update `tests/db/repository-contract.ts` Work Item fixtures to include:

```ts
driver_actor_id: ids.human,
intake_context: {
  type: 'requirement',
  stakeholder_problem: 'Repository contract needs durable Work Item data.',
  desired_outcome: 'Memory and Drizzle adapters round-trip the same shape.',
  acceptance_criteria: ['Repository contract passes for memory and Drizzle.'],
  in_scope: ['Work Item repository persistence'],
},
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
pnpm exec vitest run tests/domain/states.test.ts tests/db/schema.test.ts tests/db/repository.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because domain and schema still use Work Item `owner_actor_id`.

- [ ] **Step 3: Update domain WorkItem shape and transition**

In `packages/domain/src/types.ts`:

- import `type WorkItemIntakeContext` from `@forgeloop/contracts`;
- replace `owner_actor_id: string` on `WorkItem` with `driver_actor_id: string`;
- add `intake_context: WorkItemIntakeContext`.

In `packages/domain/src/states.ts`:

- Work Item create transition takes `driver_actor_id` and `intake_context`;
- created Work Item stores those fields;
- do not add an `owner_actor_id` fallback path.

In `packages/contracts/src/work-item-delivery-readiness.ts`:

- import `workItemIntakeContextSchema`;
- replace `owner_actor_id: nonEmpty` with `driver_actor_id: nonEmpty` in `workItemCockpitWorkItemSchema`;
- add `intake_context: workItemIntakeContextSchema`;
- keep execution package Owner fields unchanged in the same file.

- [ ] **Step 4: Update Work Item DB schema**

In `packages/db/src/schema/work-item.ts`:

```ts
driverActorId: uuid('driver_actor_id')
  .notNull()
  .references(() => actors.id),
intakeContext: jsonb('intake_context').$type<WorkItem['intake_context']>().notNull(),
```

Remove `ownerActorId` from the Work Item table. Do not add a legacy nullable column.

- [ ] **Step 5: Update Work Item read projections and internal code references**

Use this search:

```bash
rg -n "workItem\\.owner_actor_id|WorkItem[^\\n]*owner_actor_id|owner_actor_id: workItem|owner_actor_id: context\\.workItem" apps packages tests
```

For Work Item references only:

- replace with `driver_actor_id`;
- update event actors for Spec/Plan generation to use the Work Item Driver;
- where code creates execution packages from a Work Item, set the execution package `owner_actor_id`, `reviewer_actor_id`, and `qa_owner_actor_id` from `workItem.driver_actor_id` if that was the previous behavior;
- keep execution package field names as Owner/Reviewer/QA Owner.

In `packages/db/src/queries/work-item-cockpit-queries.ts`, project:

```ts
driver_actor_id: workItem.driver_actor_id,
intake_context: workItem.intake_context,
```

Remove `owner_actor_id` from the projected Work Item.

- [ ] **Step 6: Run focused domain/DB tests**

Run:

```bash
pnpm exec vitest run tests/domain/states.test.ts tests/contracts/work-item-delivery-readiness.test.ts tests/db/schema.test.ts tests/db/repository.test.ts tests/db/work-item-delivery-readiness.test.ts tests/db/work-item-delivery-selection.test.ts tests/db/work-item-release-readiness.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS after all Work Item fixtures and projections are migrated. Failures in execution package/release owner fixtures should be fixed only when they are actually Work Item fixtures.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/types.ts packages/domain/src/states.ts packages/contracts/src/work-item-delivery-readiness.ts packages/db/src/schema/work-item.ts packages/db/src/repositories/drizzle-delivery-repository.ts packages/db/src/queries/work-item-cockpit-queries.ts apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts apps/control-plane-api/src/modules/automation/automation-command.service.ts apps/control-plane-api/src/modules/execution-packages/execution-package.service.ts apps/control-plane-api/src/modules/run-control/run-control.service.ts tests/domain/states.test.ts tests/contracts/work-item-delivery-readiness.test.ts tests/db/schema.test.ts tests/db/repository-contract.ts tests/db/repository.test.ts tests/helpers/delivery-runtime-fixtures.ts
git commit -m "feat: migrate work items to driver identity"
```

## Task 3: Update Work Item API DTOs And Service

**Files:**

- Modify: `apps/control-plane-api/src/modules/delivery/dto.ts`
- Modify: `apps/control-plane-api/src/modules/work-items/work-item.service.ts`
- Modify: `apps/control-plane-api/src/modules/work-items/work-item-types.ts`
- Modify: `tests/api/work-items.test.ts`

- [ ] **Step 1: Write failing API tests**

Replace the generic `createInitiative` helper with a typed helper:

```ts
const typedIntakeByKind = {
  requirement: {
    type: 'requirement',
    stakeholder_problem: 'Users cannot see release readiness.',
    desired_outcome: 'Release readiness is visible before approval.',
    acceptance_criteria: ['Readiness state is visible'],
    in_scope: ['Work Item cockpit entry point'],
  },
  bug: {
    type: 'bug',
    impact_summary: 'Checkout fails for signed-in users',
    observed_behavior: 'Submit returns 500',
    expected_behavior: 'Order is created or validation is shown',
    reproduction_steps: ['Sign in', 'Add item', 'Submit checkout'],
    affected_environment: 'production',
    verification_path: 'Regression test for checkout submit',
  },
  tech_debt: {
    type: 'tech_debt',
    current_pain: 'Delivery query filters conflate Work Item and package actors.',
    desired_invariant: 'Work Item driver filters are lane-specific.',
    affected_modules: ['packages/db/src/queries/product-lane-filters.ts'],
    behavior_preservation: 'Execution Owner filters keep existing semantics.',
    validation_strategy: 'Product lane API tests cover both filters.',
  },
  initiative: {
    type: 'initiative',
    business_outcome: 'Close typed intake for the delivery product.',
    scope_narrative: 'Capture structured context before spec generation.',
    success_metrics: ['All Work Item kinds can be created'],
  },
} as const;
```

Assert:

- creating each kind with matching context returns `driver_actor_id` and `intake_context`;
- response does not include `owner_actor_id`;
- patching `driver_actor_id` updates status history/audit actor;
- `owner_actor_id` create and patch payloads return 400;
- `kind=bug` with `intake_context.type=requirement` returns 400;
- missing required context field returns 400 with a field-specific validation path.

- [ ] **Step 2: Run API tests and verify they fail**

Run:

```bash
pnpm exec vitest run tests/api/work-items.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because the API still expects `owner_actor_id` and has no `intake_context`.

- [ ] **Step 3: Use shared contracts in DTOs**

In `apps/control-plane-api/src/modules/delivery/dto.ts`:

- import `createWorkItemRequestSchema` and `patchWorkItemRequestSchema`;
- export `createWorkItemSchema = createWorkItemRequestSchema`;
- export `updateWorkItemSchema = patchWorkItemRequestSchema.extend({ phase: z.enum(workItemReadinessPhases).optional() }).strict()` if phase is not already covered by the shared patch contract;
- do not define any Work Item `owner_actor_id` schema.

Keep Project and Execution Package DTOs unchanged where they legitimately use Owner fields.

- [ ] **Step 4: Update service behavior**

In `apps/control-plane-api/src/modules/work-items/work-item.service.ts`:

- create transition uses `driver_actor_id` and `intake_context`;
- audit event actor is `workItem.driver_actor_id`;
- patch updates `driver_actor_id` and `intake_context`;
- status history actor is `dto.driver_actor_id ?? workItem.driver_actor_id`;
- return the updated Work Item without serializing old Owner fields.

- [ ] **Step 5: Update type metadata copy**

In `apps/control-plane-api/src/modules/work-items/work-item-types.ts`:

- remove any Owner wording if present;
- include Driver-oriented hints only if the file already exposes type metadata;
- do not add default priority/risk fields unless current tests require them.

- [ ] **Step 6: Run focused API tests**

Run:

```bash
pnpm exec vitest run tests/api/work-items.test.ts tests/api/delivery-flow.test.ts tests/api/product-lanes.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS after all API helper payloads are migrated. If `tests/api/delivery-flow.test.ts` fails only because Work Item fixture payloads use `owner_actor_id`, update those Work Item creates to Driver/intake and keep execution package Owner fields.

- [ ] **Step 7: Commit**

```bash
git add apps/control-plane-api/src/modules/delivery/dto.ts apps/control-plane-api/src/modules/work-items/work-item.service.ts apps/control-plane-api/src/modules/work-items/work-item-types.ts tests/api/work-items.test.ts tests/api/delivery-flow.test.ts tests/api/product-lanes.test.ts
git commit -m "feat: enforce typed work item intake API"
```

## Task 4: Make Work Item Query Filters Driver-Aware

**Files:**

- Modify: `packages/contracts/src/api.ts`
- Modify: `packages/contracts/src/web-product-query.ts`
- Modify: `packages/db/src/queries/product-lane-types.ts`
- Modify: `packages/db/src/queries/product-lane-filters.ts`
- Modify: `packages/db/src/queries/product-lane-queries.ts`
- Modify: `packages/db/src/queries/web-product-queries.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.service.ts`
- Modify: `apps/control-plane-api/src/modules/query/product-lane-query-parser.ts`
- Modify: `tests/api/product-lanes.test.ts`
- Modify: `tests/api/query-module.test.ts`
- Modify: `tests/contracts/product-actions.test.ts`

- [ ] **Step 1: Write failing Product Lane filter tests**

In `tests/api/product-lanes.test.ts`, add/adjust tests:

```ts
await request(server)
  .get(`/query/product-lanes/bugs?project_id=${project.id}&driver_actor_id=${actorOwner}`)
  .expect(200);

await request(server)
  .get(`/query/product-lanes/bugs?project_id=${project.id}&owner_actor_id=${actorOwner}`)
  .expect(400);

await request(server)
  .get(`/query/product-lanes/bugs?project_id=${project.id}&actor_id=actor-a&driver_actor_id=actor-b`)
  .expect(400);

await request(server)
  .get(`/query/product-lanes/execution-owner?project_id=${project.id}&owner_actor_id=${actorOwner}`)
  .expect(200);
```

In direct DB filter tests:

```ts
const filters = resolveLaneFilters('requirements', {
  project_id: laneSeed.project.id,
  kind: 'requirement',
  driver_actor_id: actorOwner,
  owner_actor_id: actorOwner,
  limit: 5,
});
expect(filters.unsupported_filters).toEqual(['owner_actor_id']);
```

Add a ProductAction guard in `tests/contracts/product-actions.test.ts` that snapshots or parses command schemas and proves no new typed-intake command was added to ProductAction.

- [ ] **Step 2: Write failing product registry tests**

In `tests/api/query-module.test.ts`, add a Work Item registry case:

```ts
const driverResponse = await request(server)
  .get(`/query/work-items?project_id=${project.id}&driver_actor_id=${actorOwner}`)
  .expect(200);

expect(driverResponse.body.items).toEqual([
  expect.objectContaining({
    object: { type: 'work_item', id: workItem.id, title: workItem.title },
    driver_actor_id: actorOwner,
  }),
]);
expect(driverResponse.body.items[0]).not.toHaveProperty('owner_actor_id');

await request(server)
  .get(`/query/work-items?project_id=${project.id}&owner_actor_id=${actorOwner}`)
  .expect(400);
```

Also assert non-Work-Item registry filters still work:

```ts
await request(server)
  .get(`/query/execution-packages?project_id=${project.id}&owner_actor_id=${actorExecutionOwner}`)
  .expect(200);
await request(server)
  .get(`/query/review-packets?project_id=${project.id}&reviewer_actor_id=${actorReviewer}`)
  .expect(200);
```

- [ ] **Step 3: Run query tests and verify they fail**

Run:

```bash
pnpm exec vitest run tests/api/product-lanes.test.ts tests/api/query-module.test.ts tests/contracts/product-actions.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because `driver_actor_id` is not a known query key and Work Item lane/registry paths still use Owner.

- [ ] **Step 4: Update shared Product Lane and product registry query contracts**

In `packages/contracts/src/api.ts`, add `driver_actor_id` to `supportedProductLaneQueryKeys`.

In `packages/contracts/src/web-product-query.ts`:

- add `driver_actor_id` to `productListQuerySchema`;
- add `driver_actor_id` to `productListItemSchema`;
- keep `owner_actor_id`, `reviewer_actor_id`, `qa_owner_actor_id`, and `release_owner_actor_id` because non-Work-Item registries still use them;
- do not attempt endpoint-specific rejection in this shared schema because `/query/execution-packages` still needs `owner_actor_id`.

In `packages/db/src/queries/product-lane-types.ts`:

- add `driver_actor_id` to `productLaneQueryKeys`;
- update `ProductLaneActorFilterKey` to include `driver_actor_id`;
- update `ProductLaneFilterSubject` with `driver_actor_id` and `driver_actor_id_values`;
- update `workItemTypeLaneFilters` to use `driver_actor_id` instead of `owner_actor_id`;
- set `actor_filter: 'driver_actor_id'` for `requirements`, `bugs`, `tech-debt`, and `initiatives`;
- keep `execution-owner.actor_filter = 'owner_actor_id'`.

- [ ] **Step 5: Update Product Lane matching and projections**

In `packages/db/src/queries/product-lane-filters.ts`:

- add matching for `applied.driver_actor_id`;
- keep existing matching for `owner_actor_id`;
- rely on `unsupported_filters` for `owner_actor_id` when the lane is a Work Item type lane.

In `packages/db/src/queries/product-lane-queries.ts`:

- `itemBase` accepts and projects `driverActorId`/`driver_actor_id`;
- `workItemLaneItem` projects `workItem.driver_actor_id`;
- package/review/release projections keep their role-specific Owner fields.

- [ ] **Step 6: Update product registry Work Item queries**

In `packages/db/src/queries/web-product-queries.ts`:

- change `supportedFiltersByList.workItems` from `owner_actor_id` to `driver_actor_id`;
- change Work Item filtering from `workItem.owner_actor_id` to `workItem.driver_actor_id`;
- change `workItemListItem()` to emit `driver_actor_id: workItem.driver_actor_id`;
- remove `owner_actor_id` from Work Item list items;
- keep execution-package, run, review, QA, and release Owner fields unchanged.

In `apps/control-plane-api/src/modules/query/query.service.ts`:

- before calling `listProductWorkItems`, reject `query.owner_actor_id !== undefined` with `BadRequestException`;
- allow `query.driver_actor_id`;
- do not reject `owner_actor_id` in `listExecutionPackages`.

This API-level rejection is required because `productListQuerySchema` is shared across multiple registry endpoints and must still accept `owner_actor_id` for execution packages.

- [ ] **Step 7: Update Product Lane API parser**

In `apps/control-plane-api/src/modules/query/product-lane-query-parser.ts`:

- parse `driver_actor_id`;
- pass it into `resolveLaneFilters`;
- keep `owner_actor_id` parsing because execution-owner still uses it;
- after `resolveLaneFilters`, if `resolved.unsupported_filters.length > 0`, throw `BadRequestException` for query endpoints instead of silently returning a response. This makes Work Item type lane `owner_actor_id` fail hard as required.

If changing unsupported filter behavior would break existing UI expectations, apply it only for `owner_actor_id` on Work Item type lanes and keep current response-level unsupported reporting for other filters. The spec requirement only mandates no Owner fallback for type-lane Driver filtering.

- [ ] **Step 8: Run focused query tests**

Run:

```bash
pnpm exec vitest run tests/api/product-lanes.test.ts tests/api/query-module.test.ts tests/contracts/product-actions.test.ts tests/contracts/contracts.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/contracts/src/api.ts packages/contracts/src/web-product-query.ts packages/db/src/queries/product-lane-types.ts packages/db/src/queries/product-lane-filters.ts packages/db/src/queries/product-lane-queries.ts packages/db/src/queries/web-product-queries.ts apps/control-plane-api/src/modules/query/query.service.ts apps/control-plane-api/src/modules/query/product-lane-query-parser.ts tests/api/product-lanes.test.ts tests/api/query-module.test.ts tests/contracts/product-actions.test.ts
git commit -m "feat: route work item queries by driver"
```

## Task 5: Build Typed Web Intake Flow

**Files:**

- Create: `apps/web/src/features/work-items/intake/intake-model.ts`
- Create: `apps/web/src/features/work-items/intake/intake-fields.tsx`
- Create: `tests/web/work-item-intake-form.test.tsx`
- Modify: `apps/web/src/features/work-items/create-work-item-form.tsx`
- Modify: `apps/web/src/shared/api/types.ts`
- Modify: `apps/web/src/shared/api/commands.ts`
- Modify: `apps/web/src/shared/api/query.ts`
- Modify: `apps/web/src/shared/api/query-keys.ts`
- Modify: `apps/web/src/shared/api/hooks.ts`
- Modify: `apps/web/src/features/product-lanes/product-lanes.ts`
- Modify: `apps/web/src/features/product-lanes/product-lane-route.tsx`
- Modify: `tests/web/api.test.ts`
- Modify: `tests/web/api-hooks.test.tsx`
- Modify: `tests/web/product-lanes-route.test.tsx`
- Modify: `tests/web/fixtures/product-data.ts`
- Modify: `tests/web/fixtures/product-api-mock.ts`

- [ ] **Step 1: Write failing Web API and form tests**

In `tests/web/api.test.ts`, update create payload expectation to:

```ts
await api.createWorkItem({
  project_id: 'project-1',
  kind: 'bug',
  title: 'Checkout fails',
  goal: 'Checkout fails for signed-in users; expected order creation or validation.',
  success_criteria: ['Order is created or validation is shown', 'Regression test for checkout submit'],
  priority: 'P0',
  risk: 'high',
  driver_actor_id: 'actor-driver',
  intake_context: validBugIntake,
});
```

In `tests/web/work-item-intake-form.test.tsx`, test:

- default route renders Requirement intake fields and Driver context;
- switching to Bug shows bug-only fields and default risk `high`;
- each kind can submit valid data;
- empty required arrays show field errors;
- after create, the route navigates to `/work-items/<id>?lane=<default-lane>`;
- body includes `driver_actor_id`, `intake_context`, normalized `goal`, and normalized `success_criteria`;
- body does not include `owner_actor_id`.

Use `renderRoute('/work-items/new', { actorId: 'actor-driver', projectId })` and `userEvent`.

In `tests/web/product-lanes-route.test.tsx`, assert:

```ts
expect(fetch).toHaveBeenCalledWith(
  `http://localhost:3000/query/product-lanes/requirements?project_id=${projectId}&driver_actor_id=actor-driver`,
  expect.objectContaining({ method: 'GET' }),
);
expect(screen.getByRole('link', { name: 'Bugs' }).getAttribute('href')).toBe(
  `/lanes/bugs?project_id=${projectId}&driver_actor_id=actor-driver`,
);
```

In `tests/web/api-hooks.test.tsx`, assert `useProductWorkItemsQuery` uses `driver_actor_id` in its query key and request URL, and does not include `owner_actor_id` for Work Item registry queries.

- [ ] **Step 2: Run Web tests and verify they fail**

Run:

```bash
pnpm exec vitest run tests/web/api.test.ts tests/web/api-hooks.test.tsx tests/web/product-lanes-route.test.tsx tests/web/work-item-intake-form.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because Web still submits the generic Owner-based form and does not know `driver_actor_id`.

- [ ] **Step 3: Add intake model helpers**

Create `apps/web/src/features/work-items/intake/intake-model.ts` with:

- type labels for Initiative, Requirement, Bug, Tech Debt;
- `defaultRiskByKind`;
- `laneForWorkItemKind`;
- default empty intake values per kind;
- `normalizeList(value: string): string[]`;
- `normalizeIntakeDraft(kind, raw)` that trims and omits empty optional values;
- `deriveGoal(kind, intake)`:
  - requirement: stakeholder problem plus desired outcome;
  - bug: impact, observed behavior, expected behavior;
  - tech debt: current pain plus desired invariant;
  - initiative: business outcome plus scope narrative;
- `deriveSuccessCriteria(kind, intake)`:
  - requirement: acceptance criteria;
  - bug: expected behavior plus verification path;
  - tech debt: desired invariant plus validation strategy;
  - initiative: success metrics.

Keep helpers pure so tests can cover them without rendering if form tests become too large.

- [ ] **Step 4: Add type-specific field renderer**

Create `apps/web/src/features/work-items/intake/intake-fields.tsx`.

Rules:

- Use existing `Input` and `Textarea` primitives.
- No card-in-card layout.
- Labels should be concise product copy, not documentation.
- Required list fields use a textarea with one item per line.
- Error messages are field-specific.

Suggested props:

```ts
type IntakeFieldsProps = {
  kind: WorkItemKind;
  register: UseFormRegister<CreateWorkItemVisibleFormValues>;
  errors: FieldErrors<CreateWorkItemVisibleFormValues>;
};
```

If that type creates circular imports, move the form value type to `intake-model.ts`.

- [ ] **Step 5: Replace generic create form**

In `apps/web/src/features/work-items/create-work-item-form.tsx`:

- use the shared or local typed Zod schema;
- form values include common fields and nested intake fields;
- hidden `project_id` and `driver_actor_id` come from context;
- when kind changes:
  - reset type-specific fields to that kind's empty defaults;
  - update risk to default only if the user has not edited risk;
  - keep title/priority stable;
  - recompute success criteria preview until the user edits it manually;
- submit `CreateWorkItemBody` with normalized context;
- navigate to `/work-items/${created.id}?lane=${laneForWorkItemKind(values.kind)}`.

Use visible copy:

- Page title: `New Work Item`
- Context metric label: `Driver`
- Submit button: `Create Work Item`

Do not show `Owner` anywhere on this page.

- [ ] **Step 6: Update Web API types and Product Lane query helpers**

In `apps/web/src/shared/api/types.ts`:

- import/export `WorkItemIntakeContext`, `CreateWorkItemRequest`, and `PublicWorkItem` from contracts where possible;
- replace `CreateWorkItemBody.owner_actor_id` with `driver_actor_id` and `intake_context`;
- add `driver_actor_id` to `ProductLaneQuery`.

In `apps/web/src/shared/api/query-keys.ts` and `apps/web/src/shared/api/query.ts`:

- normalize/send `driver_actor_id`;
- keep `owner_actor_id` for non-Work-Item product registry queries.

In `apps/web/src/shared/api/hooks.ts`:

- change `useProductWorkItemsQuery` input from `owner_actor_id` to `driver_actor_id`;
- normalize/cache `driver_actor_id`;
- keep `normalizePackageRunQuery()` Owner fields unchanged for package/run registries.

In `apps/web/src/features/product-lanes/product-lanes.ts`:

- add `driver_actor_id` to `supportedProductLaneSearchParams`.

In `apps/web/src/features/product-lanes/product-lane-route.tsx`:

- parse `driver_actor_id`;
- when linking into Work Item type lanes, preserve `driver_actor_id` and drop `owner_actor_id`;
- when linking into execution-owner, preserve `owner_actor_id` and do not translate it to Driver.

- [ ] **Step 7: Run focused Web tests**

Run:

```bash
pnpm exec vitest run tests/web/api.test.ts tests/web/api-hooks.test.tsx tests/web/product-lanes-route.test.tsx tests/web/work-item-intake-form.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 8: Run Web typecheck**

Run:

```bash
pnpm --filter @forgeloop/web typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/features/work-items/create-work-item-form.tsx apps/web/src/features/work-items/intake/intake-model.ts apps/web/src/features/work-items/intake/intake-fields.tsx apps/web/src/shared/api/types.ts apps/web/src/shared/api/commands.ts apps/web/src/shared/api/query.ts apps/web/src/shared/api/query-keys.ts apps/web/src/shared/api/hooks.ts apps/web/src/features/product-lanes/product-lanes.ts apps/web/src/features/product-lanes/product-lane-route.tsx tests/web/api.test.ts tests/web/api-hooks.test.tsx tests/web/product-lanes-route.test.tsx tests/web/work-item-intake-form.test.tsx tests/web/fixtures/product-data.ts tests/web/fixtures/product-api-mock.ts
git commit -m "feat: add typed work item intake UI"
```

## Task 6: Clean Up Fixtures And Naming Guards

**Files:**

- Modify: `tests/naming/delivery-naming.test.ts`
- Modify: `tests/web/no-legacy-web-ui.test.ts`
- Modify: broad tests/fixtures found by search
- Modify: any product docs touched by this stream, if they mention active Work Item Owner copy

- [ ] **Step 1: Add failing naming guards**

In `tests/naming/delivery-naming.test.ts`, add Work Item Driver guard patterns.

Scan roots:

```ts
const workItemOwnerScanRoots = ['apps', 'packages', 'tests', 'docs/PRD_v1.md'];
```

Forbidden active patterns:

```ts
[
  /Work Item Owner/,
  /work item owner/i,
  /work-item-owner/,
  /workItemOwner/,
  /work_item_owner/,
  /owner_actor_id/,
]
```

Allowed exceptions:

- Project Owner files and tests.
- Execution Package `owner_actor_id`.
- `qa_owner_actor_id`.
- `release_owner_actor_id`.
- `requested_by_actor_id`.
- negative tests that prove Work Item `owner_actor_id` is rejected.
- this plan/spec path if keeping historical discussion is necessary.

Implement exceptions by path plus local line context, not by globally ignoring all `owner_actor_id`.

In `tests/web/no-legacy-web-ui.test.ts`, add a Web-specific guard:

```ts
expect(productSourceText()).not.toMatch(/Work Item Owner|work item owner|work-item-owner|owner_actor_id/);
```

If Web execution package pages legitimately contain `owner_actor_id`, scope the guard to Work Item create/list/detail/product-lane files and route tests instead of all Web files.

- [ ] **Step 2: Run naming tests and verify they fail**

Run:

```bash
pnpm exec vitest run tests/naming/delivery-naming.test.ts tests/web/no-legacy-web-ui.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL with remaining Work Item Owner/product-facing `owner_actor_id` references.

- [ ] **Step 3: Clean all active Work Item Owner references**

Use:

```bash
rg -n "Work Item Owner|work item owner|work-item-owner|workItemOwner|work_item_owner|owner_actor_id" apps packages tests docs/PRD_v1.md
```

For each match:

- if it is a Work Item create/update/read/lane/filter fixture, change to Driver;
- if it is Project, Execution Package, QA/Test, Release, Run requester, or a negative test, keep it and add a narrow guard exception if needed;
- do not rewrite non-Work-Item Owner product concepts to Driver.

- [ ] **Step 4: Run targeted naming and broad fallout tests**

Run:

```bash
pnpm exec vitest run tests/naming/delivery-naming.test.ts tests/web/no-legacy-web-ui.test.ts tests/api/work-items.test.ts tests/api/product-lanes.test.ts tests/api/query-module.test.ts tests/db/repository.test.ts tests/web/api-hooks.test.tsx tests/web/work-item-intake-form.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/naming/delivery-naming.test.ts tests/web/no-legacy-web-ui.test.ts tests tests/helpers apps packages docs/PRD_v1.md
git commit -m "test: guard work item driver naming"
```

## Task 7: Final Verification And Integration Check

**Files:**

- No planned source files beyond fixing failures from verification.

- [ ] **Step 1: Run full focused test matrix**

Run:

```bash
pnpm exec vitest run tests/contracts/work-item-intake.test.ts tests/contracts/contracts.test.ts tests/contracts/work-item-delivery-readiness.test.ts tests/contracts/product-actions.test.ts tests/domain/states.test.ts tests/api/work-items.test.ts tests/api/product-lanes.test.ts tests/api/query-module.test.ts tests/api/delivery-flow.test.ts tests/db/schema.test.ts tests/db/repository.test.ts tests/db/work-item-delivery-readiness.test.ts tests/db/work-item-delivery-selection.test.ts tests/db/work-item-release-readiness.test.ts tests/web/api.test.ts tests/web/api-hooks.test.tsx tests/web/product-lanes-route.test.tsx tests/web/work-item-intake-form.test.tsx tests/web/work-item-delivery-cockpit.test.tsx tests/web/work-item-product-route.test.tsx tests/naming/delivery-naming.test.ts tests/web/no-legacy-web-ui.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 2: Run package builds**

Run:

```bash
pnpm --filter @forgeloop/contracts build
pnpm --filter @forgeloop/domain build
pnpm --filter @forgeloop/db build
pnpm --filter @forgeloop/control-plane-api build
pnpm --filter @forgeloop/web typecheck
```

Expected: all commands PASS.

- [ ] **Step 3: Run full test suite if time allows**

Run:

```bash
pnpm test
```

Expected: PASS. If it is too slow for the execution session, record the focused matrix and package builds in the final handoff and explicitly state that full `pnpm test` was not run.

- [ ] **Step 4: Final no-baggage searches**

Run:

```bash
rg -n "owner_actor_id" apps/control-plane-api/src/modules/work-items apps/web/src/features/work-items packages/contracts/src/work-item-intake.ts packages/contracts/src/work-item-delivery-readiness.ts tests/api/work-items.test.ts tests/web/work-item-intake-form.test.tsx
rg -n "owner_actor_id" packages/db/src/queries/web-product-queries.ts apps/web/src/shared/api/hooks.ts tests/api/query-module.test.ts tests/web/api-hooks.test.tsx
rg -n "Work Item Owner|work item owner|work-item-owner|workItemOwner|work_item_owner" apps packages tests docs/PRD_v1.md
rg -n "driver_actor_id" apps packages tests | wc -l
```

Expected:

- first command returns no matches;
- second command returns only negative tests proving Work Item Owner rejection, never Work Item list/query implementation code;
- third command returns only approved historical/spec/negative-test exceptions;
- fourth command returns non-zero matches.

- [ ] **Step 5: Optional local UI smoke**

If the execution session includes browser verification:

```bash
pnpm dev:web
```

Open `/work-items/new`, create screenshots at desktop and mobile widths, and verify:

- type switcher is readable;
- no horizontal scroll on mobile;
- no card-in-card layout;
- Driver appears in context copy;
- Owner does not appear on the Work Item create surface;
- submit body has `driver_actor_id` and `intake_context`.

- [ ] **Step 6: Commit final verification fixes**

If verification required changes:

```bash
git add <fixed-files>
git commit -m "fix: close typed work item intake verification"
```

If no changes were needed, do not create an empty commit.

## Implementation Notes

- Use `driver_actor_id` for Work Item Driver only. Do not rename `owner_actor_id` on `projects`, `execution_packages`, pipeline QA owner queues, or release owner surfaces.
- Work Item product registries are public surfaces too. `/query/work-items`, `useProductWorkItemsQuery`, and `ProductListItem` Work Item rows must use Driver and must not expose Work Item Owner.
- `tech_debt` is the Work Item kind and context `type`; the default lane is `tech-debt`.
- Default risk:
  - requirement: `medium`
  - bug: `high`
  - tech_debt: `medium`
  - initiative: `medium`
- The API should validate generic normalized fields and structured context. The Web may derive them, but the API must not depend on the Web for correctness.
- The create flow navigates to `/work-items/:id?lane=<default-lane-for-kind>`. It does not create separate `/requirements`, `/bugs`, `/tech-debt`, or `/initiatives` routes.
- The Work Item cockpit may receive `intake_context` in its read model, but this stream does not render a typed brief in the cockpit.
- If a broad test fails because it constructs a Work Item directly, update the fixture to include `driver_actor_id` and a minimal matching `intake_context`. If it constructs an Execution Package, keep `owner_actor_id`.

## Review Checklist

Before implementation is considered complete:

- [ ] Public Work Item create/patch/read payloads use `driver_actor_id`.
- [ ] Public Work Item create/patch/read payloads include `intake_context`.
- [ ] Work Item type lanes support `driver_actor_id`.
- [ ] Work Item type lanes reject `owner_actor_id`.
- [ ] `/query/work-items` supports `driver_actor_id`.
- [ ] `/query/work-items` rejects `owner_actor_id`.
- [ ] Work Item product list rows expose `driver_actor_id`, not `owner_actor_id`.
- [ ] Execution Owner lane still supports `owner_actor_id`.
- [ ] QA/Test Owner and Release Owner filters still work.
- [ ] No compatibility create path accepts both Owner and Driver.
- [ ] No old generic create form remains.
- [ ] ProductAction command schemas are unchanged.
- [ ] Delivery Cockpit typed brief rendering is not redesigned in this stream.
- [ ] Naming guards prevent Work Item Owner baggage from returning.
