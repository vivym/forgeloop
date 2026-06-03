# Plan Item Workflow Product Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Wave 5 Plan Item Superpowers product loop so one `PlanItemWorkflow` owns Brainstorming, Spec Doc generation, Implementation Plan Doc generation, review gates, durable queued actions, and Execution Ready evaluation without starting execution.

**Architecture:** Add a workflow-owned queued-action layer between user commands and Codex-producing turns, then route all public product generation through `POST /plan-item-workflows/:workflowId/actions/:actionId/run`. Keep `PlanItemWorkflow.status` as the source of truth, keep `CodexSession` as private runtime continuity, expose only public-safe workflow projections, and replace the current gate-card page with a chat-first Plan Item workspace.

**Tech Stack:** TypeScript, pnpm, Vitest, NestJS control-plane API, Drizzle/Postgres, Zod contracts, React 19, React Router 7, TanStack Query, Tailwind CSS, existing ForgeLoop domain/db/runtime packages, Codex runtime capsule infrastructure.

---

## Scope Check

This plan implements only `docs/superpowers/specs/2026-06-03-plan-item-workflow-product-loop-design.md`.

In scope:

- `PlanItemWorkflow` as the only public Superpowers workflow entry point for one Plan Item.
- Durable `PlanItemWorkflowQueuedAction` records for every Codex-producing turn in this wave.
- Explicit `/messages` chat input that records human/audit input and may create queued actions, but never calls Codex.
- Manual `/actions/:actionId/run` for Brainstorming continuation, Boundary Summary generation/revision, Spec Doc generation/revision, and Implementation Plan Doc generation/revision.
- Artifact approve and request-changes routes for Boundary Summary, Spec Doc, and Implementation Plan Doc revisions.
- Request-changes cascade invalidation for downstream active revisions, readiness, Execution Package evidence, and dependent queued actions.
- Explicit Execution Ready evaluation that never creates or claims execution/run-session/worker/PR/review-loop state.
- Chat-first Plan Item workspace with left timeline, center conversation, right artifact/context rail, role lenses, and public-safe evidence.
- Fake and real dogfood commands proving the workflow loop and same-session continuity.
- No-baggage guard updates rejecting legacy public bypasses and Wave 5 forbidden mutation surfaces.

Out of scope:

- Starting real execution.
- Creating or claiming `RunSession`, execution package run leases, execution worker jobs, workspace bundles, code-writing turns, PRs, or code-review/fix-loop work.
- Automatic daemon claim/run for queued actions.
- Public fork, abandon, new-session, recovery, or scavenge mutations.
- Editable context package selection.
- Parsing Implementation Plan Doc checkboxes into a structured task list.
- Public UI for raw capsule refs, raw thread ids, memory bundles, prompt transcripts, local artifact paths, or private app-server payloads.

## File Structure

### Domain And Contracts

- Modify `packages/contracts/src/plan-item-workflow.ts`
  - Add queued action, workflow message, artifact command, readiness evaluator, public event, role lens, and public projection schemas.
  - Keep public DTOs free of raw `codex_thread_id`, raw capsule refs, memory refs/content, prompt transcript, local artifact paths, lease tokens, and credential metadata.
- Modify `packages/domain/src/plan-item-workflow.ts`
  - Add `PlanItemWorkflowQueuedAction`, `PlanItemWorkflowMessage`, artifact change request, public timeline/event helpers, action-kind-to-turn-intent mapping, validation helpers, and no-raw-runtime projection helpers.
  - Tighten Wave 5 status transition helpers so approvals queue the next action and Implementation Plan approval only unlocks readiness evaluation.
- Modify `tests/contracts/plan-item-workflow.test.ts`
  - Contract tests for DTO validation, action kinds, message actions, public-safe projections, and forbidden generation actions in `/messages`.
- Modify `tests/domain/plan-item-workflow.test.ts`
  - Domain tests for queued action state machine, idempotency keys, stale rejection, message gating, request-changes cascade decisions, readiness boundary, and public projection safety.

### Database And Repository

- Modify `packages/db/src/schema/plan-item-workflow.ts`
  - Add `plan_item_workflow_messages`, `plan_item_workflow_queued_actions`, and `plan_item_workflow_artifact_change_requests`.
  - Add indexes and unique scoped idempotency constraint for active queued actions.
- Modify `packages/db/src/schema/index.ts`
  - Export new schema objects if needed by repository tests.
- Add `packages/db/migrations/0001_plan_item_workflow_queued_actions.sql`
  - Create the new Wave 5 tables and indexes.
- Modify `packages/db/src/reset.ts`
  - Reset queued actions/messages/change requests before parent workflow/session rows.
- Modify `packages/db/src/repositories/delivery-repository.ts`
  - Add repository inputs and methods for messages, queued actions, CAS run claim, terminalization, stale cascades, artifact change requests, and session turn listing used by Wave 5 tests/dogfood.
- Modify `packages/db/src/repositories/in-memory-delivery-repository.ts`
  - Implement the same repository contract with in-memory uniqueness and compare-and-set behavior.
- Modify `packages/db/src/repositories/drizzle-delivery-repository.ts`
  - Implement transactional persistence, row locking, scoped idempotency replay, and stale cascade updates.
- Modify `tests/db/plan-item-workflow-repository.test.ts`
  - Repository contract tests for in-memory and Drizzle paths.
- Modify `tests/db/schema.test.ts`
  - New table/index/schema assertions.
- Modify `tests/db/reset.test.ts`
  - Reset ordering assertions if this file already covers workflow tables.

### Control-Plane API And Services

- Modify `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts`
  - Add Zod DTOs for `/messages`, `/actions/:actionId/run`, artifact approval, artifact request changes, and readiness evaluation.
  - Remove or stop exporting public DTOs for Wave 5 forbidden routes.
- Modify `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.controller.ts`
  - Add the required Wave 5 public routes.
  - Disable/remove legacy public mutation routes that bypass queued actions.
  - Keep internal/admin routes only when they do not become product entry points.
- Modify `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts`
  - Own workflow start, message recording, queued action creation/replay, action run orchestration, artifact approval, request-changes cascade, readiness evaluation, and public projection.
  - Extract helper methods from old direct generation routes where useful, but do not leave public compatibility wrappers.
- Modify `apps/control-plane-api/src/modules/plan-item-workflows/codex-session-lease.service.ts`
  - Ensure queued action run claims one per-turn CodexSession lease and terminalizes with capsule evidence.
- Modify `apps/control-plane-api/src/modules/brainstorming/brainstorming.service.ts`
  - Provide service helpers usable by queued actions without exposing direct workflow mutation as public product behavior.
- Modify `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`
  - Provide service helpers usable by queued actions for Spec Doc and Implementation Plan Doc revisions.
  - Keep existing non-workflow public routes disabled for workflow-owned Plan Items.
- Modify `apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts`
  - Ensure legacy direct document generation endpoints fail with `workflow_legacy_entrypoint_disabled` for workflow-owned Plan Items.
- Modify `apps/control-plane-api/src/modules/executions/executions.service.ts`
  - Ensure Wave 5 readiness evaluation does not start execution; existing execution start paths remain disabled for workflow-owned Plan Items.
- Modify `apps/control-plane-api/src/modules/executions/executions.controller.ts`
  - Ensure public direct execution start remains disabled for workflow-owned Plan Items.
- Modify `apps/control-plane-api/src/modules/codex-runtime/product-generation-runtime-scheduler.service.ts`
  - Ensure action-run context is bound to the claimed queued action and active `CodexSession`.
- Modify `apps/control-plane-api/src/modules/automation/product-generation-result.service.ts`
  - Apply generated revisions only when the queued action/session/turn context matches.
- Modify `apps/control-plane-api/src/modules/http/domain-error.filter.ts`
  - Serialize new blocker codes with public-safe status codes.
- Modify `tests/api/plan-item-workflows.test.ts`
  - API route tests for Wave 5 workflow contract.
- Modify `tests/api/spec-plan-service.test.ts`, `tests/api/executions.test.ts`, and existing relevant API suites as needed
  - Legacy entrypoint and bypass prevention tests.

### Web Product Surface

- Modify `apps/web/src/shared/api/commands.ts`
  - Add command methods and types for messages, action run, artifact approve/request-changes, and readiness evaluation.
  - Remove UI calls to direct Spec/Implementation Plan generation for workflow-owned Plan Items.
- Modify `apps/web/src/shared/api/types.ts`
  - Add workflow projection, queued action, timeline event, artifact revision, context preview, blocker, and role lens types if not imported from contracts.
- Modify `apps/web/src/shared/api/hooks.ts`
  - Add query/mutation hooks for workflow projection and commands if existing hook structure fits.
- Modify `apps/web/src/shared/api/query-keys.ts`
  - Add stable workflow query keys.
- Modify `apps/web/src/features/development-plans/development-plan-item-detail-route.tsx`
  - Replace the gate-card detail layout for workflow-owned Plan Items with the chat-first workspace.
  - Keep route aliases (`/spec`, `/implementation-plan`, `/execution`) focused on the same workspace rather than separate document-first pages.
- Modify or replace `apps/web/src/features/development-plans/plan-item-gates.tsx`
  - Remove lifecycle action buttons that directly generate documents or start execution for workflow-owned items.
  - Keep only reusable gate/status helpers if they support the new timeline.
- Create `apps/web/src/features/development-plans/plan-item-workflow-workspace.tsx`
  - Owns left timeline, center conversation, right rail, artifact drawer, role lenses, composer, queued action cards, and readiness panel.
- Create `apps/web/src/features/development-plans/plan-item-workflow-view-model.ts`
  - Converts API projection into public-safe UI model and enforces no raw runtime display.
- Modify product mock/fixture code used by web tests
  - Provide a full Wave 5 workflow projection with queued actions, revisions, blockers, and role lens examples.
- Modify `tests/web/development-plan-routes.test.tsx`
  - Chat-first workspace and command behavior tests.
- Modify `tests/web/product-grade-first-viewport.test.tsx`
  - First viewport/layout quality and no-overlap assertions for the new workspace.

### Dogfood And Guards

- Create `scripts/plan-item-workflow-product-loop-dogfood.ts`
  - Deterministic fake runtime dogfood for the full Wave 5 loop.
- Create `scripts/plan-item-workflow-product-loop-real-dogfood.ts`
  - Real credentialed runtime dogfood for same-session continuity through Boundary, Spec Doc, Implementation Plan Doc, and readiness evaluation.
- Modify `package.json`
  - Add exact scripts:
    - `dogfood:plan-item-workflow-product-loop`
    - `dogfood:plan-item-workflow-product-loop:real`
- Modify `scripts/check-codex-runtime-superpowers-no-baggage.ts`
  - Add Wave 5 forbidden public route/UI/runtime naming patterns.
- Modify `tests/smoke/codex-runtime-no-baggage-gate.test.ts`
  - Negative tests for direct generation, direct execution, public fork/recover/scavenge, raw runtime refs, and composer generation actions.
- Modify `tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts` or add `tests/smoke/plan-item-workflow-product-loop-dogfood-script.test.ts`
  - Smoke tests for new script names and pass/skip reporting shape.

## Implementation Rules

- Do not start execution in this wave.
- Do not create or claim `RunSession`, execution package run lease, execution worker job, workspace bundle, code-writing turn, PR, or review/fix-loop state.
- Do not add public fork, abandon, new-session, recovery, or scavenge mutations.
- Do not keep public compatibility wrappers for direct Spec Doc generation, Implementation Plan Doc generation, or execution start.
- `/messages` must never call Codex, claim a CodexSession lease, restore capsules, create a CodexSessionTurn, terminalize a turn, or generate artifacts.
- Generation is never a `WorkflowMessageAction`.
- Every Codex-producing turn must run only from a durable queued action through `/actions/:actionId/run`.
- Artifact approval and request-changes routes must not synchronously call Codex.
- When any Codex action is `queued` or `running`, reject `answer_boundary_question` and `continue_ai`.
- Request-changes must stale dependent queued actions in the same transaction as downstream evidence invalidation and new revision action creation.
- Public projections must not expose raw Codex thread ids, raw capsule refs, raw memory bundle refs/content, raw prompt transcripts, local artifact paths, lease tokens, worker ids, credential metadata, or private app-server payloads.
- Role lenses must not create separate workflow states.
- Use TDD. Write failing tests first for each task.
- Commit after each task when tests for that task pass.

## Task 1: Domain And Contract Queued-Action Model

**Files:**
- Modify: `packages/contracts/src/plan-item-workflow.ts`
- Modify: `packages/domain/src/plan-item-workflow.ts`
- Modify: `tests/contracts/plan-item-workflow.test.ts`
- Modify: `tests/domain/plan-item-workflow.test.ts`

- [ ] **Step 1: Write failing contract tests**

Add tests in `tests/contracts/plan-item-workflow.test.ts`:

```ts
import {
  planItemWorkflowPublicDtoSchema,
  planItemWorkflowQueuedActionSchema,
  workflowMessageCommandSchema,
} from '@forgeloop/contracts';

it('validates only Wave 5 message actions', () => {
  expect(workflowMessageCommandSchema.parse({
    actor_id: 'actor-tech',
    action: 'answer_boundary_question',
    body_markdown: 'The boundary is API only.',
  }).action).toBe('answer_boundary_question');

  expect(() =>
    workflowMessageCommandSchema.parse({
      actor_id: 'actor-tech',
      action: 'generate_spec_doc',
      body_markdown: 'Generate the spec.',
    }),
  ).toThrow();
});

it('validates queued action public shape without raw runtime refs', () => {
  const parsed = planItemWorkflowQueuedActionSchema.parse({
    id: 'action-1',
    workflow_id: 'workflow-1',
    codex_session_id: 'session-1',
    kind: 'generate_spec_doc',
    status: 'queued',
    source_revision_id: 'boundary-revision-1',
    expected_input_capsule_digest: `sha256:${'a'.repeat(64)}`,
    context_preview_digest: `sha256:${'b'.repeat(64)}`,
    idempotency_key: `sha256:${'c'.repeat(64)}`,
    created_by_actor_id: 'actor-tech',
    created_at: '2026-06-03T00:00:00.000Z',
    updated_at: '2026-06-03T00:00:00.000Z',
  });

  expect(parsed.kind).toBe('generate_spec_doc');
  expect(JSON.stringify(parsed)).not.toContain('codex_thread_id');
  expect(JSON.stringify(parsed)).not.toContain('artifact_ref');
});

it('rejects public workflow DTOs that expose raw runtime internals', () => {
  expect(() =>
    planItemWorkflowPublicDtoSchema.parse({
      id: 'workflow-1',
      development_plan_id: 'plan-1',
      development_plan_item_id: 'item-1',
      status: 'spec_generation_queued',
      active_codex_session_id: 'session-1',
      session: {
        id: 'session-1',
        status: 'idle',
        role: 'active',
        continuity_state: 'ready',
        can_continue: true,
        codex_thread_id: 'raw-thread-id',
      },
      queued_actions: [],
      timeline_events: [],
      created_at: '2026-06-03T00:00:00.000Z',
      updated_at: '2026-06-03T00:00:00.000Z',
    }),
  ).toThrow();
});
```

- [ ] **Step 2: Write failing domain tests**

Add tests in `tests/domain/plan-item-workflow.test.ts`:

```ts
import {
  assertQueuedActionCanRun,
  assertWorkflowMessageAllowed,
  buildPlanItemWorkflowQueuedActionIdempotencyKey,
  mapQueuedActionKindToTurnIntent,
} from '@forgeloop/domain';

it('maps Wave 5 queued action kinds to Codex turn intents', () => {
  expect(mapQueuedActionKindToTurnIntent('continue_brainstorming')).toBe('continue_brainstorming');
  expect(mapQueuedActionKindToTurnIntent('generate_boundary_summary')).toBe('draft_boundary_summary');
  expect(mapQueuedActionKindToTurnIntent('generate_spec_doc')).toBe('draft_spec_doc');
  expect(mapQueuedActionKindToTurnIntent('generate_implementation_plan_doc')).toBe('draft_implementation_plan_doc');
});

it('blocks messages while a Codex action is queued or running', () => {
  expect(() =>
    assertWorkflowMessageAllowed({
      action: 'continue_ai',
      workflow_status: 'brainstorming',
      active_codex_session_id: 'session-1',
      active_codex_action_count: 1,
    }),
  ).toThrow(/workflow_action_already_pending/);
});

it('requires action/session/digest match before a queued action can run', () => {
  expect(() =>
    assertQueuedActionCanRun({
      action: {
        id: 'action-1',
        workflow_id: 'workflow-1',
        codex_session_id: 'session-1',
        kind: 'generate_spec_doc',
        status: 'queued',
        expected_input_capsule_digest: `sha256:${'a'.repeat(64)}`,
        context_preview_digest: `sha256:${'b'.repeat(64)}`,
      },
      workflow_id: 'workflow-1',
      active_codex_session_id: 'session-1',
      latest_capsule_digest: `sha256:${'x'.repeat(64)}`,
      context_preview_digest: `sha256:${'b'.repeat(64)}`,
    }),
  ).toThrow(/workflow_capsule_digest_mismatch/);
});

it('builds queued action idempotency key from every scoped input', () => {
  const first = buildPlanItemWorkflowQueuedActionIdempotencyKey({
    workflow_id: 'workflow-1',
    kind: 'generate_spec_doc',
    source_revision_id: 'boundary-revision-1',
    context_preview_digest: `sha256:${'b'.repeat(64)}`,
    expected_input_capsule_digest: `sha256:${'a'.repeat(64)}`,
  });
  const changedSource = buildPlanItemWorkflowQueuedActionIdempotencyKey({
    workflow_id: 'workflow-1',
    kind: 'generate_spec_doc',
    source_revision_id: 'boundary-revision-2',
    context_preview_digest: `sha256:${'b'.repeat(64)}`,
    expected_input_capsule_digest: `sha256:${'a'.repeat(64)}`,
  });
  const changedCapsule = buildPlanItemWorkflowQueuedActionIdempotencyKey({
    workflow_id: 'workflow-1',
    kind: 'generate_spec_doc',
    source_revision_id: 'boundary-revision-1',
    context_preview_digest: `sha256:${'b'.repeat(64)}`,
    expected_input_capsule_digest: `sha256:${'9'.repeat(64)}`,
  });

  expect(first).not.toBe(changedSource);
  expect(first).not.toBe(changedCapsule);
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
pnpm vitest run tests/contracts/plan-item-workflow.test.ts tests/domain/plan-item-workflow.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because queued action schemas/helpers do not exist yet.

- [ ] **Step 4: Implement contract schemas**

In `packages/contracts/src/plan-item-workflow.ts`, add:

```ts
export const planItemWorkflowQueuedActionKindSchema = z.enum([
  'continue_brainstorming',
  'generate_boundary_summary',
  'revise_boundary_summary',
  'generate_spec_doc',
  'revise_spec_doc',
  'generate_implementation_plan_doc',
  'revise_implementation_plan_doc',
]);
export type PlanItemWorkflowQueuedActionKind = z.infer<typeof planItemWorkflowQueuedActionKindSchema>;

export const planItemWorkflowQueuedActionStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'blocked',
  'cancelled',
  'stale',
]);
export type PlanItemWorkflowQueuedActionStatus = z.infer<typeof planItemWorkflowQueuedActionStatusSchema>;

export const workflowMessageActionSchema = z.enum(['answer_boundary_question', 'continue_ai']);
export type WorkflowMessageAction = z.infer<typeof workflowMessageActionSchema>;

export const workflowMessageCommandSchema = z
  .object({
    actor_id: nonEmpty,
    action: workflowMessageActionSchema,
    body_markdown: nonEmpty,
    client_message_id: nonEmpty.optional(),
  })
  .strict();
export type WorkflowMessageCommand = z.infer<typeof workflowMessageCommandSchema>;

export const planItemWorkflowQueuedActionSchema = z
  .object({
    id: nonEmpty,
    workflow_id: nonEmpty,
    codex_session_id: nonEmpty,
    kind: planItemWorkflowQueuedActionKindSchema,
    status: planItemWorkflowQueuedActionStatusSchema,
    source_revision_id: nonEmpty.optional(),
    change_request_id: nonEmpty.optional(),
    created_from_message_id: nonEmpty.optional(),
    expected_input_capsule_digest: nonEmpty.optional(),
    context_preview_digest: nonEmpty,
    idempotency_key: nonEmpty,
    codex_session_turn_id: nonEmpty.optional(),
    output_capsule_digest: nonEmpty.optional(),
    output_capsule_sequence: z.number().int().nonnegative().optional(),
    codex_thread_id_digest: nonEmpty.optional(),
    blocked_reason_code: nonEmpty.optional(),
    created_by_actor_id: nonEmpty,
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict();
export type PlanItemWorkflowQueuedAction = z.infer<typeof planItemWorkflowQueuedActionSchema>;
```

Extend `planItemWorkflowPublicDtoSchema` with `queued_actions`, `timeline_events`, `context_preview`, `readiness`, and `blockers` using strict schemas. Expose only safe digests and status codes.

- [ ] **Step 5: Implement domain interfaces and helpers**

In `packages/domain/src/plan-item-workflow.ts`, import the new contract types and add:

```ts
export interface PlanItemWorkflowQueuedAction {
  id: string;
  workflow_id: string;
  codex_session_id: string;
  kind: PlanItemWorkflowQueuedActionKind;
  status: PlanItemWorkflowQueuedActionStatus;
  source_revision_id?: string;
  change_request_id?: string;
  created_from_message_id?: string;
  expected_input_capsule_digest?: string;
  context_preview_digest: string;
  idempotency_key: string;
  codex_session_turn_id?: string;
  output_capsule_id?: string;
  output_capsule_digest?: string;
  output_capsule_sequence?: number;
  codex_thread_id_digest?: string;
  blocked_reason_code?: string;
  created_by_actor_id: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface PlanItemWorkflowMessage {
  id: string;
  workflow_id: string;
  codex_session_id: string;
  actor_id: string;
  action: WorkflowMessageAction;
  body_markdown: string;
  created_queued_action_id?: string;
  created_at: IsoDateTime;
}
```

Add helpers:

```ts
export const mapQueuedActionKindToTurnIntent = (kind: PlanItemWorkflowQueuedActionKind): CodexSessionTurnIntent => {
  switch (kind) {
    case 'continue_brainstorming':
      return 'continue_brainstorming';
    case 'generate_boundary_summary':
      return 'draft_boundary_summary';
    case 'revise_boundary_summary':
      return 'revise_boundary_summary';
    case 'generate_spec_doc':
      return 'draft_spec_doc';
    case 'revise_spec_doc':
      return 'revise_spec_doc';
    case 'generate_implementation_plan_doc':
      return 'draft_implementation_plan_doc';
    case 'revise_implementation_plan_doc':
      return 'revise_implementation_plan_doc';
  }
};
```

Add `assertWorkflowMessageAllowed`, `assertQueuedActionCanRun`, `buildPlanItemWorkflowQueuedActionIdempotencyKey`, and a strict public projection helper. Use `DomainError` codes:

- `workflow_invalid_message_action`
- `workflow_action_already_pending`
- `workflow_action_not_runnable`
- `workflow_action_not_active_session`
- `workflow_capsule_digest_mismatch`
- `workflow_context_digest_mismatch`

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm vitest run tests/contracts/plan-item-workflow.test.ts tests/domain/plan-item-workflow.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/plan-item-workflow.ts packages/domain/src/plan-item-workflow.ts tests/contracts/plan-item-workflow.test.ts tests/domain/plan-item-workflow.test.ts
git commit -m "feat: model plan item workflow queued actions"
```

## Task 2: DB Schema And Repository Persistence For Queued Actions

**Files:**
- Modify: `packages/db/src/schema/plan-item-workflow.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/reset.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Add: `packages/db/migrations/0001_plan_item_workflow_queued_actions.sql`
- Modify: `tests/db/plan-item-workflow-repository.test.ts`
- Modify: `tests/db/schema.test.ts`
- Modify: `tests/db/reset.test.ts` if reset tests cover workflow tables

- [ ] **Step 1: Write failing repository tests**

In `tests/db/plan-item-workflow-repository.test.ts`, add cases for both repository implementations used in that file:

```ts
it('creates or replays workflow queued actions by scoped idempotency key', async () => {
  const seeded = await seedRepositoryWorkflow(repository);
  const input = {
    id: 'action-1',
    workflow_id: seeded.workflow.id,
    codex_session_id: seeded.workflow.active_codex_session_id!,
    kind: 'generate_spec_doc' as const,
    status: 'queued' as const,
    source_revision_id: seeded.boundaryRevision.id,
    expected_input_capsule_digest: `sha256:${'a'.repeat(64)}`,
    context_preview_digest: `sha256:${'b'.repeat(64)}`,
    idempotency_key: `sha256:${'c'.repeat(64)}`,
    created_by_actor_id: seeded.ids.actorTech,
    created_at: '2026-06-03T00:00:00.000Z',
    updated_at: '2026-06-03T00:00:00.000Z',
  };

  const first = await repository.createOrReplayPlanItemWorkflowQueuedAction(input);
  const second = await repository.createOrReplayPlanItemWorkflowQueuedAction({ ...input, id: 'action-duplicate' });

  expect(second.id).toBe(first.id);
});

it('claims queued action by compare-and-set and replays duplicate run claims', async () => {
  const action = await repository.createOrReplayPlanItemWorkflowQueuedAction(queuedActionFixture);
  const first = await repository.claimOrReplayPlanItemWorkflowQueuedActionRun({
    workflow_id: action.workflow_id,
    action_id: action.id,
    now: '2026-06-03T00:01:00.000Z',
  });

  expect(first).toMatchObject({
    claimed: true,
    action: expect.objectContaining({ status: 'running' }),
  });

  const second = await repository.claimOrReplayPlanItemWorkflowQueuedActionRun({
    workflow_id: action.workflow_id,
    action_id: action.id,
    now: '2026-06-03T00:01:01.000Z',
  });

  expect(second).toMatchObject({
    claimed: false,
    action: expect.objectContaining({ id: action.id, status: 'running' }),
  });
});

it('marks dependent queued actions stale during request-changes cascade', async () => {
  const specAction = await repository.createOrReplayPlanItemWorkflowQueuedAction(specActionFixture);
  const planAction = await repository.createOrReplayPlanItemWorkflowQueuedAction(planActionFixture);

  const stale = await repository.markDependentPlanItemWorkflowQueuedActionsStale({
    workflow_id: specAction.workflow_id,
    reason: 'boundary_changes_requested',
    action_kinds: ['generate_spec_doc', 'generate_implementation_plan_doc'],
    now: '2026-06-03T00:02:00.000Z',
  });

  expect(stale.map((action) => action.id).sort()).toEqual([planAction.id, specAction.id].sort());
});
```

- [ ] **Step 2: Write failing schema tests**

In `tests/db/schema.test.ts`, add assertions that the Drizzle schema exports:

- `plan_item_workflow_messages`
- `plan_item_workflow_queued_actions`
- `plan_item_workflow_artifact_change_requests`

Expected columns include all spec-required queued action fields plus public-safe blocker/terminal metadata.

- [ ] **Step 3: Run failing DB tests**

Run:

```bash
pnpm vitest run tests/db/plan-item-workflow-repository.test.ts tests/db/schema.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because schema and repository methods do not exist.

- [ ] **Step 4: Add Drizzle schema**

In `packages/db/src/schema/plan-item-workflow.ts`, add:

```ts
export const plan_item_workflow_messages = pgTable(
  'plan_item_workflow_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id').notNull().references(() => plan_item_workflows.id),
    codexSessionId: uuid('codex_session_id').notNull().references(() => codex_sessions.id),
    actorId: uuid('actor_id').notNull().references(() => actors.id),
    action: text('action').$type<PlanItemWorkflowMessage['action']>().notNull(),
    bodyMarkdown: text('body_markdown').notNull(),
    createdQueuedActionId: uuid('created_queued_action_id'),
    clientMessageId: text('client_message_id'),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    index('plan_item_workflow_messages_workflow_created_idx').on(table.workflowId, table.createdAt),
    index('plan_item_workflow_messages_session_idx').on(table.codexSessionId),
  ],
);

export const plan_item_workflow_queued_actions = pgTable(
  'plan_item_workflow_queued_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id').notNull().references(() => plan_item_workflows.id),
    codexSessionId: uuid('codex_session_id').notNull().references(() => codex_sessions.id),
    kind: text('kind').$type<PlanItemWorkflowQueuedAction['kind']>().notNull(),
    status: text('status').$type<PlanItemWorkflowQueuedAction['status']>().notNull(),
    sourceRevisionId: uuid('source_revision_id'),
    changeRequestId: uuid('change_request_id'),
    createdFromMessageId: uuid('created_from_message_id').references(() => plan_item_workflow_messages.id),
    expectedInputCapsuleDigest: text('expected_input_capsule_digest'),
    contextPreviewDigest: text('context_preview_digest').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    codexSessionTurnId: uuid('codex_session_turn_id'),
    outputCapsuleId: uuid('output_capsule_id'),
    outputCapsuleDigest: text('output_capsule_digest'),
    outputCapsuleSequence: integer('output_capsule_sequence'),
    codexThreadIdDigest: text('codex_thread_id_digest'),
    blockedReasonCode: text('blocked_reason_code'),
    createdByActorId: uuid('created_by_actor_id').notNull().references(() => actors.id),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [
    index('plan_item_workflow_queued_actions_workflow_status_idx').on(table.workflowId, table.status),
    index('plan_item_workflow_queued_actions_session_idx').on(table.codexSessionId),
    index('plan_item_workflow_queued_actions_turn_idx').on(table.codexSessionTurnId),
    uniqueIndex('plan_item_workflow_queued_actions_active_idempotency_idx')
      .on(table.workflowId, table.idempotencyKey)
      .where(sql`${table.status} in ('queued', 'running')`),
  ],
);

export const plan_item_workflow_artifact_change_requests = pgTable(
  'plan_item_workflow_artifact_change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id').notNull().references(() => plan_item_workflows.id),
    artifactType: text('artifact_type').$type<'boundary-summary' | 'spec-doc' | 'implementation-plan-doc'>().notNull(),
    revisionId: uuid('revision_id').notNull(),
    reasonMarkdown: text('reason_markdown').notNull(),
    createdQueuedActionId: uuid('created_queued_action_id'),
    requestedByActorId: uuid('requested_by_actor_id').notNull().references(() => actors.id),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    index('plan_item_workflow_artifact_change_requests_workflow_created_idx').on(table.workflowId, table.createdAt),
    index('plan_item_workflow_artifact_change_requests_revision_idx').on(table.artifactType, table.revisionId),
  ],
);
```

Use project naming conventions for camelCase Drizzle fields and snake_case repository mapping.

- [ ] **Step 5: Add migration**

Create `packages/db/migrations/0001_plan_item_workflow_queued_actions.sql` matching the schema. Include:

- all three tables;
- foreign keys to workflow/session/actor/message;
- active idempotency unique index;
- workflow/status/session/turn/revision indexes.

Run `pnpm db:generate` only if the repo expects generated metadata for migrations. If it modifies unrelated snapshots, inspect carefully before committing.

- [ ] **Step 6: Add repository interfaces**

In `packages/db/src/repositories/delivery-repository.ts`, add inputs and methods:

```ts
export interface ClaimOrReplayPlanItemWorkflowQueuedActionRunInput {
  workflow_id: string;
  action_id: string;
  now: string;
}

export interface TerminalizePlanItemWorkflowQueuedActionInput {
  workflow_id: string;
  action_id: string;
  status: 'succeeded' | 'failed' | 'blocked' | 'cancelled' | 'stale';
  codex_session_turn_id?: string;
  output_capsule_id?: string;
  output_capsule_digest?: string;
  output_capsule_sequence?: number;
  codex_thread_id_digest?: string;
  blocked_reason_code?: string;
  now: string;
}

createOrReplayPlanItemWorkflowQueuedAction(action: PlanItemWorkflowQueuedAction): Promise<PlanItemWorkflowQueuedAction>;
getPlanItemWorkflowQueuedAction(input: { workflow_id: string; action_id: string }): Promise<PlanItemWorkflowQueuedAction | undefined>;
listPlanItemWorkflowQueuedActions(workflowId: string): Promise<PlanItemWorkflowQueuedAction[]>;
listActivePlanItemWorkflowQueuedActions(workflowId: string): Promise<PlanItemWorkflowQueuedAction[]>;
claimOrReplayPlanItemWorkflowQueuedActionRun(input: ClaimOrReplayPlanItemWorkflowQueuedActionRunInput): Promise<{
  action: PlanItemWorkflowQueuedAction;
  claimed: boolean;
}>;
terminalizePlanItemWorkflowQueuedAction(input: TerminalizePlanItemWorkflowQueuedActionInput): Promise<PlanItemWorkflowQueuedAction>;
markDependentPlanItemWorkflowQueuedActionsStale(input: {
  workflow_id: string;
  action_kinds: PlanItemWorkflowQueuedActionKind[];
  reason: string;
  now: string;
}): Promise<PlanItemWorkflowQueuedAction[]>;
savePlanItemWorkflowMessage(message: PlanItemWorkflowMessage): Promise<void>;
listPlanItemWorkflowMessages(workflowId: string): Promise<PlanItemWorkflowMessage[]>;
savePlanItemWorkflowArtifactChangeRequest(request: PlanItemWorkflowArtifactChangeRequest): Promise<void>;
listCodexSessionTurns(sessionId: string): Promise<CodexSessionTurn[]>;
```

- [ ] **Step 7: Implement in-memory repository**

In `packages/db/src/repositories/in-memory-delivery-repository.ts`:

- store queued actions/messages/change requests in maps;
- implement idempotent replay by `(workflow_id, idempotency_key)` only for `queued`/`running`;
- implement claim-or-replay as:
  - `queued -> running` with `{ claimed: true }`;
  - `running`, `succeeded`, `failed`, `blocked`, or `cancelled` returns the current action with `{ claimed: false }`;
  - `stale` returns `{ claimed: false }` only when it already has `codex_session_turn_id` evidence from a prior run; stale queued actions without a turn throw `workflow_action_not_runnable`;
  - missing/wrong-workflow action throws `workflow_action_not_found`;
- implement terminalization only from `running`;
- implement stale cascade only for `queued` or `running` dependent actions;
- implement `listCodexSessionTurns(sessionId)` sorted by `created_at` then `id` for API tests and dogfood continuity assertions;
- return sorted lists by `created_at` then `id`.

- [ ] **Step 8: Implement Drizzle repository**

In `packages/db/src/repositories/drizzle-delivery-repository.ts`:

- add row mappers;
- implement `createOrReplayPlanItemWorkflowQueuedAction` inside transaction or conflict handling;
- implement `claimOrReplayPlanItemWorkflowQueuedActionRun` with update condition `status = 'queued'`; when the update affects zero rows, re-read the action and return `{ claimed: false }` for existing running/terminal actions instead of throwing; reject stale queued actions that never created a turn;
- implement terminalization with update condition `status = 'running'`;
- implement stale cascade with one update scoped to workflow, status in active statuses, and action kinds;
- implement `listCodexSessionTurns(sessionId)` using `codex_session_turns_session_created_idx`;
- throw `DomainError('workflow_action_not_found', ...)` only when the action does not exist for the workflow.

- [ ] **Step 9: Run DB tests**

Run:

```bash
pnpm vitest run tests/db/plan-item-workflow-repository.test.ts tests/db/schema.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/db/src/schema/plan-item-workflow.ts packages/db/src/schema/index.ts packages/db/src/reset.ts packages/db/src/repositories/delivery-repository.ts packages/db/src/repositories/in-memory-delivery-repository.ts packages/db/src/repositories/drizzle-delivery-repository.ts packages/db/migrations/0001_plan_item_workflow_queued_actions.sql tests/db/plan-item-workflow-repository.test.ts tests/db/schema.test.ts tests/db/reset.test.ts
git commit -m "feat: persist plan item workflow queued actions"
```

## Task 3: Public API Routes And Legacy Entrypoint Removal

**Files:**
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts`
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.controller.ts`
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts`
- Modify: `apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts`
- Modify: `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`
- Modify: `apps/control-plane-api/src/modules/executions/executions.controller.ts`
- Modify: `apps/control-plane-api/src/modules/executions/executions.service.ts`
- Modify: `apps/control-plane-api/src/modules/http/domain-error.filter.ts`
- Modify: `tests/api/plan-item-workflows.test.ts`
- Modify: `tests/api/spec-plan-service.test.ts`
- Modify: `tests/api/executions.test.ts`

- [ ] **Step 1: Write failing API tests for required routes**

In `tests/api/plan-item-workflows.test.ts`, add:

```ts
it('start brainstorming creates workflow, active session, and queued continuation without creating a turn', async () => {
  const { plan, item, ids: fixtureIds } = await seedDevelopmentPlanItem(app, { idPrefix: '51515151' });
  const response = await request(app.getHttpServer())
    .post(`/development-plans/${plan.id}/items/${item.id}/workflow/start-brainstorming`)
    .send({
      actor_id: fixtureIds.actorTech,
      runtime_profile_id: fixtureIds.runtimeProfile,
      runtime_profile_revision_id: fixtureIds.runtimeProfileRevision,
      credential_binding_id: fixtureIds.credentialBinding,
      credential_binding_version_id: fixtureIds.credentialBindingVersion,
      reason: 'Start workflow.',
    })
    .expect(201);

  expect(response.body.status).toBe('brainstorming');
  expect(response.body.queued_actions).toEqual([
    expect.objectContaining({ kind: 'continue_brainstorming', status: 'queued' }),
  ]);

  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const turns = await repository.listCodexSessionTurns(response.body.active_codex_session_id);
  expect(turns).toHaveLength(0);
});

it('/messages records human input and creates queued continuation without claiming a lease', async () => {
  const seeded = await seedWorkflow(app, { idPrefix: '52525252' });
  await clearActiveQueuedActionsForTest(app, seeded.workflow.id);

  const response = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/messages`)
    .send({
      actor_id: seeded.ids.actorTech,
      action: 'answer_boundary_question',
      body_markdown: 'Scope is the workflow API and UI only.',
    })
    .expect(201);

  expect(response.body.queued_actions).toContainEqual(expect.objectContaining({
    kind: 'continue_brainstorming',
    status: 'queued',
  }));

  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const activeSession = await repository.getCodexSession(seeded.workflow.active_codex_session_id!);
  expect(activeSession?.active_lease_id).toBeUndefined();
});

it('/messages rejects generation actions', async () => {
  const seeded = await seedWorkflow(app, { idPrefix: '53535353' });
  await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/messages`)
    .send({
      actor_id: seeded.ids.actorTech,
      action: 'generate_spec_doc',
      body_markdown: 'Generate spec.',
    })
    .expect(400);
});
```

- [ ] **Step 2: Write failing API tests for legacy disabled routes**

In the same test file, assert these routes return `409` with `workflow_legacy_entrypoint_disabled` or `workflow_wave5_entrypoint_disabled` for workflow-owned items:

- `POST /plan-item-workflows/:workflowId/boundary-brainstorming`
- `POST /plan-item-workflows/:workflowId/boundary-brainstorming-sessions/:sessionId/answers`
- `POST /plan-item-workflows/:workflowId/boundary-brainstorming-sessions/:sessionId/continue`
- `POST /plan-item-workflows/:workflowId/spec/generate-draft`
- `POST /plan-item-workflows/:workflowId/spec-revisions/generate`
- `POST /plan-item-workflows/:workflowId/implementation-plan/generate-draft`
- `POST /plan-item-workflows/:workflowId/implementation-plan-revisions/generate`
- `POST /plan-item-workflows/:workflowId/approve-implementation-plan-and-mark-execution-ready`
- `POST /plan-item-workflows/:workflowId/recover`
- `POST /plan-item-workflows/:workflowId/codex-sessions/:sessionId/fork`
- `POST /plan-item-workflows/:workflowId/codex-sessions/:sessionId/select-active-fork`
- `POST /plan-item-workflows/:workflowId/execution/start`
- direct item routes in `spec-plan.controller.ts` and `executions.controller.ts` for workflow-owned Plan Items.

- [ ] **Step 3: Run failing API tests**

Run:

```bash
pnpm vitest run tests/api/plan-item-workflows.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because new routes and disabled-route behavior are not implemented.

- [ ] **Step 4: Add DTOs**

In `plan-item-workflow.dto.ts`, add:

```ts
export const workflowMessageCommandBodySchema = z
  .object({
    actor_id: nonEmpty,
    action: workflowMessageActionSchema,
    body_markdown: nonEmpty,
    client_message_id: nonEmpty.optional(),
  })
  .strict();

export const runQueuedWorkflowActionBodySchema = z
  .object({
    actor_id: nonEmpty,
    idempotency_key: nonEmpty.optional(),
  })
  .strict();

export const artifactTypeSchema = z.enum(['boundary-summary', 'spec-doc', 'implementation-plan-doc']);

export const approveWorkflowArtifactRevisionBodySchema = z
  .object({
    actor_id: nonEmpty,
    decision_markdown: nonEmpty.optional(),
  })
  .strict();

export const requestWorkflowArtifactChangesBodySchema = z
  .object({
    actor_id: nonEmpty,
    reason_markdown: nonEmpty,
  })
  .strict();

export const evaluateWorkflowExecutionReadinessBodySchema = z
  .object({
    actor_id: nonEmpty,
    rationale_markdown: nonEmpty.optional(),
  })
  .strict();
```

- [ ] **Step 5: Add required routes**

In `plan-item-workflow.controller.ts`, add:

```ts
@Post('plan-item-workflows/:workflowId/messages')
recordMessage(...) {
  return this.service.recordWorkflowMessage(workflowId, body);
}

@Post('plan-item-workflows/:workflowId/actions/:actionId/run')
runQueuedAction(...) {
  return this.service.runQueuedWorkflowAction(workflowId, actionId, body);
}

@Post('plan-item-workflows/:workflowId/artifacts/:artifactType/revisions/:revisionId/approve')
approveArtifactRevision(...) {
  return this.service.approveWorkflowArtifactRevision(workflowId, artifactType, revisionId, body);
}

@Post('plan-item-workflows/:workflowId/artifacts/:artifactType/revisions/:revisionId/request-changes')
requestArtifactChanges(...) {
  return this.service.requestWorkflowArtifactChanges(workflowId, artifactType, revisionId, body);
}

@Post('plan-item-workflows/:workflowId/execution-readiness/evaluate')
evaluateExecutionReadiness(...) {
  return this.service.evaluateExecutionReadiness(workflowId, body);
}
```

- [ ] **Step 6: Disable old public mutation routes**

For forbidden Wave 5 routes, either remove route decorators or route to a shared helper:

```ts
private legacyEntrypointDisabled(operation: string): never {
  throw new DomainError(
    'workflow_legacy_entrypoint_disabled',
    `workflow_legacy_entrypoint_disabled: ${operation} must use PlanItemWorkflow queued actions`,
  );
}
```

Prefer removing route methods when web/tests no longer call them. If a route is kept to provide clear failure, it must not call old behavior.

- [ ] **Step 7: Map new errors**

In `domain-error.filter.ts`, map:

- `workflow_legacy_entrypoint_disabled` -> `409`
- `workflow_wave5_entrypoint_disabled` -> `409`
- `workflow_action_already_pending` -> `409`
- `workflow_action_not_runnable` -> `409`
- `workflow_context_digest_mismatch` -> `409`
- `workflow_capsule_digest_mismatch` -> `409`

- [ ] **Step 8: Run API tests**

Run:

```bash
pnpm vitest run tests/api/plan-item-workflows.test.ts tests/api/spec-plan-service.test.ts tests/api/executions.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.controller.ts apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts apps/control-plane-api/src/modules/executions/executions.controller.ts apps/control-plane-api/src/modules/executions/executions.service.ts apps/control-plane-api/src/modules/http/domain-error.filter.ts tests/api/plan-item-workflows.test.ts tests/api/spec-plan-service.test.ts tests/api/executions.test.ts
git commit -m "feat: expose workflow queued action API"
```

## Task 4: Workflow Service Queue Orchestration And Request-Changes Cascades

**Files:**
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts`
- Modify: `apps/control-plane-api/src/modules/brainstorming/brainstorming.service.ts`
- Modify: `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`
- Modify: `packages/domain/src/plan-item-workflow.ts`
- Modify: `tests/api/plan-item-workflows.test.ts`
- Modify: `tests/helpers/plan-item-workflow-fixtures.ts`

- [ ] **Step 1: Write failing tests for approval queueing**

In `tests/api/plan-item-workflows.test.ts`, add:

```ts
it('approving Boundary Summary queues Spec Doc generation and does not run Codex', async () => {
  const seeded = await seedBoundaryReviewWorkflow(app, { idPrefix: '54545454' });
  const response = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/boundary-summary/revisions/${seeded.boundaryRevision.id}/approve`)
    .send({ actor_id: seeded.ids.actorTech, decision_markdown: 'Boundary accepted.' })
    .expect(201);

  expect(response.body.status).toBe('spec_generation_queued');
  expect(response.body.queued_actions).toContainEqual(expect.objectContaining({
    kind: 'generate_spec_doc',
    status: 'queued',
    source_revision_id: seeded.boundaryRevision.id,
  }));

  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const turns = await repository.listCodexSessionTurns(seeded.workflow.active_codex_session_id!);
  expect(turns).toHaveLength(0);
});

it('approving Spec Doc queues Implementation Plan Doc generation and does not run Codex', async () => {
  const seeded = await seedSpecReviewWorkflow(app, { idPrefix: '55555555' });
  const response = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/spec-doc/revisions/${seeded.specRevision.id}/approve`)
    .send({ actor_id: seeded.ids.actorTech, decision_markdown: 'Spec accepted.' })
    .expect(201);

  expect(response.body.status).toBe('implementation_plan_generation_queued');
  expect(response.body.queued_actions).toContainEqual(expect.objectContaining({
    kind: 'generate_implementation_plan_doc',
    status: 'queued',
    source_revision_id: seeded.specRevision.id,
  }));
});

it('approving Implementation Plan Doc unlocks readiness evaluation but does not mark ready', async () => {
  const seeded = await seedImplementationPlanReviewWorkflow(app, { idPrefix: '56565656' });
  const response = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/implementation-plan-doc/revisions/${seeded.implementationPlanRevision.id}/approve`)
    .send({ actor_id: seeded.ids.actorTech, decision_markdown: 'Plan accepted.' })
    .expect(201);

  expect(response.body.status).toBe('implementation_plan_review');
  expect(response.body.readiness?.can_evaluate).toBe(true);
  expect(response.body.status).not.toBe('execution_ready');
});
```

- [ ] **Step 2: Write failing tests for request-changes cascades**

Add cases:

```ts
it('Boundary Summary changes stale downstream evidence and queues boundary revision action', async () => {
  const seeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '57575757' });
  const response = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/boundary-summary/revisions/${seeded.boundaryRevision.id}/request-changes`)
    .send({ actor_id: seeded.ids.actorTech, reason_markdown: 'Boundary missed QA handoff.' })
    .expect(201);

  expect(response.body.status).toBe('brainstorming');
  expect(response.body.active_spec_doc_revision_id).toBeUndefined();
  expect(response.body.active_implementation_plan_doc_revision_id).toBeUndefined();
  expect(response.body.queued_actions).toContainEqual(expect.objectContaining({
    kind: 'revise_boundary_summary',
    status: 'queued',
    change_request_id: expect.any(String),
  }));
});

it('Spec Doc changes stale active Implementation Plan and queues Spec revision action', async () => {
  const seeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '58585858' });
  const response = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/spec-doc/revisions/${seeded.specRevision.id}/request-changes`)
    .send({ actor_id: seeded.ids.actorTech, reason_markdown: 'Acceptance criteria are incomplete.' })
    .expect(201);

  expect(response.body.status).toBe('spec_generation_queued');
  expect(response.body.active_implementation_plan_doc_revision_id).toBeUndefined();
  expect(response.body.queued_actions).toContainEqual(expect.objectContaining({ kind: 'revise_spec_doc' }));
});

it('Implementation Plan Doc changes stale readiness only and queues plan revision action', async () => {
  const seeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '59595959' });
  const response = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/artifacts/implementation-plan-doc/revisions/${seeded.implementationPlanRevision.id}/request-changes`)
    .send({ actor_id: seeded.ids.actorTech, reason_markdown: 'Test matrix is not enough.' })
    .expect(201);

  expect(response.body.status).toBe('implementation_plan_generation_queued');
  expect(response.body.active_spec_doc_revision_id).toBe(seeded.specRevision.id);
  expect(response.body.queued_actions).toContainEqual(expect.objectContaining({ kind: 'revise_implementation_plan_doc' }));
});
```

- [ ] **Step 3: Run failing orchestration tests**

Run:

```bash
pnpm vitest run tests/api/plan-item-workflows.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL until approval and request-changes orchestration exists.

- [ ] **Step 4: Implement queued action factory helpers**

In `PlanItemWorkflowService`, add helpers:

- `createQueuedActionForWorkflow(...)`
- `requireNoActiveQueuedOrRunningAction(workflowId)`
- `contextPreviewDigestForWorkflow(workflow)`
- `latestExpectedCapsuleDigestForSession(session)`
- `toWorkflowPublicProjection(workflow)`

Use repository idempotency for duplicates. Idempotency key inputs:

- workflow id;
- action kind;
- source revision id;
- change request id;
- context preview digest;
- expected input capsule digest.

- [ ] **Step 5: Update startBrainstorming**

Change `startBrainstorming` so it:

1. validates Plan Item belongs to Development Plan;
2. creates workflow and active CodexSession;
3. writes start transition;
4. creates queued `continue_brainstorming`;
5. returns projection.

It must not create `BrainstormingSession`, `BoundaryRound`, `CodexSessionTurn`, lease, capsule restore, or Codex runtime job inside the request route.

- [ ] **Step 6: Implement `recordWorkflowMessage`**

`recordWorkflowMessage` must:

1. load workflow and active session;
2. validate actor;
3. reject when any queued/running action exists;
4. validate selected action is `answer_boundary_question` or `continue_ai`;
5. persist `PlanItemWorkflowMessage`;
6. create queued `continue_brainstorming` with `created_from_message_id`;
7. patch the message with `created_queued_action_id` if repository supports update, or store both in one transaction;
8. return projection.

It must not call any runtime service.

- [ ] **Step 7: Implement Boundary Summary queue creation policy**

Add a single explicit service helper, `queueBoundarySummaryGenerationWhenReady(workflow, session, actorId)`, used only after a successful queued Brainstorming continuation result proves enough boundary evidence exists.

The helper must:

1. verify the workflow is still `brainstorming`;
2. verify there is no active queued/running action;
3. verify the active CodexSession matches the workflow;
4. create a queued `generate_boundary_summary` action with the latest capsule digest and context preview digest;
5. return the queued action in the public projection.

Do not create a Boundary Summary revision directly from `/messages`. The only direct route to a Boundary Summary revision is a queued action run (`continue_brainstorming` if the runtime explicitly returns final summary content, or `generate_boundary_summary` in the deterministic dogfood path). The fake dogfood must use the explicit `generate_boundary_summary` queue/run path from the spec.

- [ ] **Step 8: Implement artifact approval**

`approveWorkflowArtifactRevision` must dispatch by artifact type:

- Boundary Summary:
  - verify revision belongs to workflow and Plan Item;
  - mark revision approved using existing revision field patterns;
  - transition `boundary_review -> spec_generation_queued`;
  - set `active_boundary_summary_revision_id`;
  - create queued `generate_spec_doc`;
  - update Development Plan Item projection fields.
- Spec Doc:
  - verify revision belongs to workflow and Plan Item;
  - mark revision approved;
  - transition `spec_review -> implementation_plan_generation_queued`;
  - set `active_spec_doc_revision_id`;
  - create queued `generate_implementation_plan_doc`;
  - update projection fields.
- Implementation Plan Doc:
  - verify revision belongs to workflow and Plan Item;
  - mark revision approved;
  - keep workflow in `implementation_plan_review` or project to a status that clearly means approved-but-not-evaluated if the domain already supports it;
  - set `active_implementation_plan_doc_revision_id`;
  - return `readiness.can_evaluate = true`;
  - do not transition to `execution_ready`;
  - do not create queued execution action.

- [ ] **Step 9: Implement request-changes cascade**

`requestWorkflowArtifactChanges` must:

1. verify revision ownership;
2. reject if a queued/running action exists unless the active queued action is one of the dependent actions being staled by this request;
3. persist artifact change request;
4. mark revision changes requested;
5. clear downstream active revision ids and `execution_package_id`/readiness evidence as required;
6. mark dependent active queued actions stale in the same transaction;
7. transition workflow back to the relevant generation/conversation stage;
8. create visible queued revision action:
   - Boundary Summary -> `revise_boundary_summary`;
   - Spec Doc -> `revise_spec_doc`;
   - Implementation Plan Doc -> `revise_implementation_plan_doc`;
9. return projection with queued action visible.

- [ ] **Step 10: Run orchestration tests**

Run:

```bash
pnpm vitest run tests/api/plan-item-workflows.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts apps/control-plane-api/src/modules/brainstorming/brainstorming.service.ts apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts packages/domain/src/plan-item-workflow.ts tests/api/plan-item-workflows.test.ts tests/helpers/plan-item-workflow-fixtures.ts
git commit -m "feat: queue plan item workflow gate actions"
```

## Task 5: Queued Action Runner And Codex Runtime Integration

**Files:**
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts`
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/codex-session-lease.service.ts`
- Modify: `apps/control-plane-api/src/modules/brainstorming/brainstorming.service.ts`
- Modify: `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/product-generation-runtime-scheduler.service.ts`
- Modify: `apps/control-plane-api/src/modules/automation/product-generation-result.service.ts`
- Modify: `tests/api/plan-item-workflows.test.ts`
- Modify: `tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts` if it covers scheduler context

- [ ] **Step 1: Write failing action-run tests**

In `tests/api/plan-item-workflows.test.ts`, add:

```ts
it('runs queued Spec Doc generation against active session and terminalizes action', async () => {
  const seeded = await seedApprovedBoundaryWorkflow(app, { idPrefix: '60606060' });
  const action = await queueSpecGenerationForTest(app, seeded.workflow.id, seeded.boundaryRevision.id);

  const response = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${action.id}/run`)
    .send({ actor_id: seeded.ids.actorTech })
    .expect(201);

  expect(response.body.queued_actions).toContainEqual(expect.objectContaining({
    id: action.id,
    status: expect.stringMatching(/succeeded|blocked/),
    codex_session_turn_id: expect.any(String),
  }));

  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const turns = await repository.listCodexSessionTurns(seeded.workflow.active_codex_session_id!);
  expect(turns).toContainEqual(expect.objectContaining({
    intent: 'draft_spec_doc',
    workflow_id: seeded.workflow.id,
    codex_session_id: seeded.workflow.active_codex_session_id,
  }));
});

it('rejects queued action run when action targets non-active session', async () => {
  const seeded = await seedApprovedBoundaryWorkflow(app, { idPrefix: '61616161' });
  const action = await queueActionForDifferentSessionForTest(app, seeded.workflow.id);

  await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${action.id}/run`)
    .send({ actor_id: seeded.ids.actorTech })
    .expect(409)
    .expect(({ body }) => {
      expect(JSON.stringify(body)).toContain('workflow_action_not_active_session');
    });
});

it('blocks queued action run on context preview digest mismatch', async () => {
  const seeded = await seedApprovedBoundaryWorkflow(app, { idPrefix: '62626262' });
  const action = await queueSpecGenerationForTest(app, seeded.workflow.id, seeded.boundaryRevision.id, {
    context_preview_digest: `sha256:${'0'.repeat(64)}`,
  });

  await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${action.id}/run`)
    .send({ actor_id: seeded.ids.actorTech })
    .expect(409)
    .expect(({ body }) => {
      expect(JSON.stringify(body)).toContain('workflow_context_digest_mismatch');
    });
});

it('replays duplicate queued action run without creating a second Codex turn', async () => {
  const seeded = await seedApprovedBoundaryWorkflow(app, { idPrefix: '65656565' });
  const action = await queueSpecGenerationForTest(app, seeded.workflow.id, seeded.boundaryRevision.id);

  const first = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${action.id}/run`)
    .send({ actor_id: seeded.ids.actorTech })
    .expect(201);

  const second = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${action.id}/run`)
    .send({ actor_id: seeded.ids.actorTech })
    .expect(200);

  expect(second.body.queued_actions).toContainEqual(expect.objectContaining({
    id: action.id,
    status: first.body.queued_actions.find((candidate: { id: string }) => candidate.id === action.id)?.status,
  }));

  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const turns = await repository.listCodexSessionTurns(seeded.workflow.active_codex_session_id!);
  expect(turns.filter((turn) => turn.intent === 'draft_spec_doc')).toHaveLength(1);
});

it('rejects stale queued action run when no Codex turn was ever created', async () => {
  const seeded = await seedApprovedBoundaryWorkflow(app, { idPrefix: '66666666' });
  const action = await queueSpecGenerationForTest(app, seeded.workflow.id, seeded.boundaryRevision.id, {
    status: 'stale',
    codex_session_turn_id: undefined,
  });

  await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/actions/${action.id}/run`)
    .send({ actor_id: seeded.ids.actorTech })
    .expect(409)
    .expect(({ body }) => {
      expect(JSON.stringify(body)).toContain('workflow_action_not_runnable');
    });
});
```

- [ ] **Step 2: Write stale terminalization test**

Add a service/repository test proving a stale/older action terminalization cannot update:

- workflow status;
- active artifact refs;
- queued action terminal status;
- latest capsule fields.

Use an explicit two-action fixture where action A is marked stale after action B is created.

- [ ] **Step 3: Run failing runner tests**

Run:

```bash
pnpm vitest run tests/api/plan-item-workflows.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL until action runner exists.

- [ ] **Step 4: Implement action claim and validation**

In `PlanItemWorkflowService.runQueuedWorkflowAction`:

1. load workflow/session/action;
2. validate actor authorization;
3. validate action belongs to workflow;
4. validate action targets `workflow.active_codex_session_id`;
5. validate expected input capsule digest against latest session capsule when present for `queued` actions;
6. validate context preview digest for `queued` actions;
7. do not pre-reject `running`, `succeeded`, `failed`, `blocked`, or `cancelled` actions; let `claimOrReplayPlanItemWorkflowQueuedActionRun` return replay state for duplicate run requests;
8. call `claimOrReplayPlanItemWorkflowQueuedActionRun`;
9. if `{ claimed: false }`, return the current workflow projection with the existing running/terminal queued action and do not create a CodexSessionTurn;
10. if the repository reports a stale action without prior turn evidence, return `workflow_action_not_runnable`;
11. if `{ claimed: true }`, claim per-turn CodexSession lease;
12. create exactly one `CodexSessionTurn` with `intent = mapQueuedActionKindToTurnIntent(action.kind)`;
13. delegate to the action kind handler;
14. terminalize turn/session/capsule and queued action;
15. update workflow active revision/status only if action is still current and not stale.

- [ ] **Step 5: Implement action kind handlers**

Use existing service internals where possible:

- `continue_brainstorming`
  - create or continue workflow-scoped Brainstorming session records;
  - persist AI message or blocked event;
  - when the runtime response says the boundary is complete, either create a Boundary Summary revision only if that turn returned final summary content, or create a visible queued `generate_boundary_summary` action for the user to run. The deterministic fake dogfood must take the queued `generate_boundary_summary` branch.
- `generate_boundary_summary`
  - create Boundary Summary revision attached to workflow/session/turn.
- `revise_boundary_summary`
  - create revised Boundary Summary revision attached to change request.
- `generate_spec_doc`
  - create Spec Doc revision attached to workflow/session/turn.
- `revise_spec_doc`
  - create revised Spec Doc revision attached to change request.
- `generate_implementation_plan_doc`
  - create Implementation Plan Doc revision attached to workflow/session/turn.
- `revise_implementation_plan_doc`
  - create revised Implementation Plan Doc revision attached to change request.

Handlers may use fake runtime behavior in tests but must preserve the real runtime path through `ProductGenerationRuntimeSchedulerService` for credentialed dogfood.

- [ ] **Step 6: Bind scheduler/result context to queued action**

In runtime scheduler/result services:

- include `plan_item_workflow_action_id` in internal job/run metadata;
- reject result application unless workflow id, action id, CodexSession id, and CodexSessionTurn id match;
- ensure result application cannot update a stale queued action.

- [ ] **Step 7: Run action runner tests**

Run:

```bash
pnpm vitest run tests/api/plan-item-workflows.test.ts tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts apps/control-plane-api/src/modules/plan-item-workflows/codex-session-lease.service.ts apps/control-plane-api/src/modules/brainstorming/brainstorming.service.ts apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts apps/control-plane-api/src/modules/codex-runtime/product-generation-runtime-scheduler.service.ts apps/control-plane-api/src/modules/automation/product-generation-result.service.ts tests/api/plan-item-workflows.test.ts tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts
git commit -m "feat: run workflow queued actions through codex session"
```

## Task 6: Execution Ready Evaluator Without Execution Start

**Files:**
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts`
- Modify: `apps/control-plane-api/src/modules/executions/executions.service.ts`
- Modify: `packages/domain/src/plan-item-workflow.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Modify: `tests/api/plan-item-workflows.test.ts`
- Modify: `tests/api/executions.test.ts`

- [ ] **Step 1: Write failing readiness tests**

In `tests/api/plan-item-workflows.test.ts`, add:

```ts
it('evaluates Execution Ready only after approved Boundary, Spec, and Implementation Plan docs', async () => {
  const seeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '63636363' });

  const response = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/execution-readiness/evaluate`)
    .send({ actor_id: seeded.ids.actorTech, rationale_markdown: 'Ready for handoff.' })
    .expect(201);

  expect(response.body.status).toBe('execution_ready');
  expect(response.body.readiness).toMatchObject({
    state: 'ready',
    blocker_codes: [],
  });

  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const executions = await repository.listExecutions();
  expect(executions.filter((execution) => execution.development_plan_item_ref?.id === seeded.item.id)).toHaveLength(0);
});

it('returns public-safe blockers and does not mark ready when QA strategy is missing', async () => {
  const seeded = await seedWorkflowWithApprovedImplementationPlan(app, {
    idPrefix: '64646464',
    omitQaStrategy: true,
  });

  const response = await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/execution-readiness/evaluate`)
    .send({ actor_id: seeded.ids.actorTech })
    .expect(200);

  expect(response.body.status).not.toBe('execution_ready');
  expect(response.body.readiness.blocker_codes).toContain('qa_test_strategy_missing');
  expect(JSON.stringify(response.body)).not.toContain('codex_thread_id');
  expect(JSON.stringify(response.body)).not.toContain('artifact://');
});
```

- [ ] **Step 2: Write failing no-execution tests**

Add assertions that readiness evaluation does not create or claim:

- `RunSession`;
- execution package run lease;
- execution worker job;
- workspace bundle;
- code-writing turn;
- PR/review-loop records.

Use repository list/get methods already available for those surfaces.

- [ ] **Step 3: Run failing readiness tests**

Run:

```bash
pnpm vitest run tests/api/plan-item-workflows.test.ts tests/api/executions.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL until evaluator exists.

- [ ] **Step 4: Implement readiness checker**

In `PlanItemWorkflowService.evaluateExecutionReadiness`:

1. require active workflow/session;
2. require approved Boundary Summary revision belongs to workflow/item;
3. require approved Spec Doc revision belongs to workflow/item;
4. require approved Implementation Plan Doc revision belongs to workflow/item;
5. verify Plan Item revision is current;
6. verify QA/test strategy based on item risk;
7. verify internal Execution Package boundary can be structurally derived without creating a run;
8. verify required release/QA links when applicable;
9. verify session is healthy and latest capsule sequence lineage exists;
10. persist `ExecutionReadinessRecord`;
11. transition to `execution_ready` only when no blockers;
12. return public-safe blocker projection when blockers exist.

- [ ] **Step 5: Guard old execution paths**

In `executions.service.ts`, keep existing workflow-owned execution start guard or tighten it so any direct execution start for a workflow-owned Plan Item returns `workflow_legacy_entrypoint_disabled`.

Do not add a workflow execution-start replacement in this wave.

- [ ] **Step 6: Run readiness tests**

Run:

```bash
pnpm vitest run tests/api/plan-item-workflows.test.ts tests/api/executions.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts apps/control-plane-api/src/modules/executions/executions.service.ts packages/domain/src/plan-item-workflow.ts packages/db/src/repositories/delivery-repository.ts packages/db/src/repositories/in-memory-delivery-repository.ts packages/db/src/repositories/drizzle-delivery-repository.ts tests/api/plan-item-workflows.test.ts tests/api/executions.test.ts
git commit -m "feat: evaluate workflow execution readiness"
```

## Task 7: Chat-First Plan Item Workspace UI

**Files:**
- Modify: `apps/web/src/shared/api/commands.ts`
- Modify: `apps/web/src/shared/api/types.ts`
- Modify: `apps/web/src/shared/api/hooks.ts`
- Modify: `apps/web/src/shared/api/query-keys.ts`
- Modify: `apps/web/src/features/development-plans/development-plan-item-detail-route.tsx`
- Modify: `apps/web/src/features/development-plans/plan-item-gates.tsx`
- Add: `apps/web/src/features/development-plans/plan-item-workflow-workspace.tsx`
- Add: `apps/web/src/features/development-plans/plan-item-workflow-view-model.ts`
- Modify: web fixtures/mocks used by development plan route tests
- Modify: `tests/web/development-plan-routes.test.tsx`
- Modify: `tests/web/product-grade-first-viewport.test.tsx`

- [ ] **Step 1: Write failing workspace render tests**

In `tests/web/development-plan-routes.test.tsx`, add:

```ts
it('renders workflow-owned Plan Item as a chat-first workspace', async () => {
  renderDevelopmentPlanItemRoute({ route: '/development-plans/dp-1/items/dpi-1' });

  expect(await screen.findByRole('navigation', { name: /workflow timeline/i })).toBeInTheDocument();
  expect(screen.getByRole('log', { name: /codex conversation/i })).toBeInTheDocument();
  expect(screen.getByRole('complementary', { name: /artifact and context/i })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: /message/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /generate spec/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /start execution/i })).not.toBeInTheDocument();
});

it('keeps the conversation visible while artifact drawer is open', async () => {
  renderDevelopmentPlanItemRoute({ route: '/development-plans/dp-1/items/dpi-1' });

  await user.click(await screen.findByRole('button', { name: /open spec doc/i }));

  expect(screen.getByRole('log', { name: /codex conversation/i })).toBeVisible();
  expect(screen.getByRole('region', { name: /spec doc revision/i })).toBeVisible();
});

it('places Run generation on queued action events, not in the composer', async () => {
  renderDevelopmentPlanItemRoute({ route: '/development-plans/dp-1/items/dpi-1' });

  const composer = await screen.findByRole('form', { name: /workflow message/i });
  expect(within(composer).queryByRole('button', { name: /run generation/i })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /run generation for spec doc/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Write failing UI command tests**

Add tests for:

- composer only allows `Answer Boundary Question` and `Continue AI`;
- `Run generation` calls `POST /actions/:actionId/run`;
- artifact Approve calls `/artifacts/:artifactType/revisions/:revisionId/approve`;
- artifact Request Changes calls `/request-changes`;
- role lens switches emphasis without changing workflow id/status;
- raw thread id/capsule ref/memory/prompt/local path strings do not render.

- [ ] **Step 3: Run failing web tests**

Run:

```bash
pnpm vitest run tests/web/development-plan-routes.test.tsx tests/web/product-grade-first-viewport.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because current UI is gate-card/document-first and uses direct lifecycle actions.

- [ ] **Step 4: Add API client methods**

In `apps/web/src/shared/api/commands.ts`, add:

```ts
recordWorkflowMessage(workflowId: string, body: WorkflowMessageCommandBody) {
  return postJson(`/plan-item-workflows/${encodeURIComponent(workflowId)}/messages`, body);
}

runWorkflowQueuedAction(workflowId: string, actionId: string, body: RunQueuedWorkflowActionBody) {
  return postJson(`/plan-item-workflows/${encodeURIComponent(workflowId)}/actions/${encodeURIComponent(actionId)}/run`, body);
}

approveWorkflowArtifactRevision(workflowId: string, artifactType: WorkflowArtifactType, revisionId: string, body: ApproveWorkflowArtifactRevisionBody) {
  return postJson(`/plan-item-workflows/${encodeURIComponent(workflowId)}/artifacts/${artifactType}/revisions/${encodeURIComponent(revisionId)}/approve`, body);
}

requestWorkflowArtifactChanges(workflowId: string, artifactType: WorkflowArtifactType, revisionId: string, body: RequestWorkflowArtifactChangesBody) {
  return postJson(`/plan-item-workflows/${encodeURIComponent(workflowId)}/artifacts/${artifactType}/revisions/${encodeURIComponent(revisionId)}/request-changes`, body);
}

evaluateWorkflowExecutionReadiness(workflowId: string, body: EvaluateWorkflowExecutionReadinessBody) {
  return postJson(`/plan-item-workflows/${encodeURIComponent(workflowId)}/execution-readiness/evaluate`, body);
}
```

- [ ] **Step 5: Build view model**

In `plan-item-workflow-view-model.ts`, export:

- `toPlanItemWorkflowWorkspaceModel(projection)`
- `timelineStages`
- `conversationEvents`
- `artifactDrawerModel`
- `contextPreviewModel`
- `roleLensModel`
- `assertNoRawRuntimeFieldsForUi(model)`

The view model should convert raw projection into:

- stages: Brainstorming, Spec Doc, Implementation Plan Doc, Execution Ready;
- queue events and run labels;
- composer disabled reason;
- artifact review capabilities;
- public-safe evidence labels.

- [ ] **Step 6: Build workspace component**

Create `plan-item-workflow-workspace.tsx` with:

- `<aside aria-label="Workflow timeline">`;
- `<main role="log" aria-label="Codex conversation">`;
- `<aside aria-label="Artifact and context">`;
- role lens segmented control;
- composer form with action selector;
- queued action cards with Run generation buttons;
- artifact drawer region;
- Context Preview read-only panel;
- blockers/readiness panel.

Styling rules:

- use Tailwind tokens already in the app;
- avoid nested cards;
- keep center conversation visually dominant;
- right rail can scroll independently;
- no large metadata blocks before the primary conversation;
- no raw runtime refs.

- [ ] **Step 7: Replace detail route layout for workflow-owned items**

In `development-plan-item-detail-route.tsx`:

- detect `item.plan_item_workflow` or whichever projection field is added by API;
- render `PlanItemWorkflowWorkspace`;
- keep `/spec`, `/implementation-plan`, and `/execution` routes as focus parameters for the same workspace;
- remove direct `PlanItemLifecycleActions` for workflow-owned items.

- [ ] **Step 8: Remove old workflow-owned lifecycle buttons**

In `plan-item-gates.tsx`:

- stop rendering direct Generate Spec, Generate Implementation Plan, Start Execution, Recover, Fork, or Continue Execution actions for workflow-owned Plan Items;
- keep old actions only for non-workflow legacy/demo records if tests still need them, and label them outside this Wave 5 product path.

- [ ] **Step 9: Run web tests**

Run:

```bash
pnpm vitest run tests/web/development-plan-routes.test.tsx tests/web/product-grade-first-viewport.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 10: Browser verification**

Start the web app:

```bash
pnpm dev:web
```

Open the current local URL in the in-app Browser and inspect:

- `/development-plans/dp-product-architecture-visual-rebuild/items/dpi-cockpit-command-center` if fixture data exists;
- otherwise the test fixture route currently used by the app.

Verify:

- left timeline, center conversation, and right rail are visible above the fold;
- conversation remains visible when artifact drawer opens;
- composer does not show Run generation, Approve, Request Changes, or Start Execution;
- no text overlap at desktop and narrow widths;
- no raw thread/capsule/memory/prompt/local path values are visible.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/shared/api/commands.ts apps/web/src/shared/api/types.ts apps/web/src/shared/api/hooks.ts apps/web/src/shared/api/query-keys.ts apps/web/src/features/development-plans/development-plan-item-detail-route.tsx apps/web/src/features/development-plans/plan-item-gates.tsx apps/web/src/features/development-plans/plan-item-workflow-workspace.tsx apps/web/src/features/development-plans/plan-item-workflow-view-model.ts tests/web/development-plan-routes.test.tsx tests/web/product-grade-first-viewport.test.tsx
git commit -m "feat: add chat-first plan item workflow workspace"
```

## Task 8: Dogfood Scripts For Fake And Real Runtime Loops

**Files:**
- Add: `scripts/plan-item-workflow-product-loop-dogfood.ts`
- Add: `scripts/plan-item-workflow-product-loop-real-dogfood.ts`
- Modify: `package.json`
- Modify: `tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts` or add `tests/smoke/plan-item-workflow-product-loop-dogfood-script.test.ts`
- Modify: `tests/helpers/plan-item-workflow-fixtures.ts`

- [ ] **Step 1: Write failing smoke tests for scripts**

Add tests:

```ts
it('package.json exposes Wave 5 dogfood scripts', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  expect(packageJson.scripts['dogfood:plan-item-workflow-product-loop']).toContain('plan-item-workflow-product-loop-dogfood.ts');
  expect(packageJson.scripts['dogfood:plan-item-workflow-product-loop:real']).toContain('plan-item-workflow-product-loop-real-dogfood.ts');
});

it('fake dogfood output reports full Wave 5 loop', async () => {
  const result = await execa('pnpm', ['dogfood:plan-item-workflow-product-loop'], {
    env: { FORGELOOP_DOGFOOD_FAKE_RUNTIME: '1' },
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain('start Brainstorming');
  expect(result.stdout).toContain('run Spec Doc revision');
  expect(result.stdout).toContain('evaluate Execution Ready');
  expect(result.stdout).toContain('one active codex_session_id');
});
```

Adapt helper APIs to whatever smoke test utilities exist.

- [ ] **Step 2: Run failing smoke tests**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because scripts do not exist.

- [ ] **Step 3: Implement fake dogfood script**

Create `scripts/plan-item-workflow-product-loop-dogfood.ts`.

The script must run deterministic fake runtime flow:

```text
start Brainstorming
create queued Brainstorming continuation action
run Brainstorming continuation
answer Boundary question
create queued Brainstorming continuation action
run Brainstorming continuation
create queued Boundary Summary action
run Boundary Summary generation
approve Boundary Summary
create queued Spec Doc action
run Spec Doc generation
request Spec Doc changes
create queued Spec Doc revision action
run Spec Doc revision
approve Spec Doc
create queued Implementation Plan Doc action
run Implementation Plan Doc generation
request Implementation Plan Doc changes
create queued Implementation Plan Doc revision action
run Implementation Plan Doc revision
approve Implementation Plan Doc
evaluate Execution Ready
```

Assertions:

- one `workflow_id`;
- one active `codex_session_id`;
- monotonic `CodexSessionTurn` sequence;
- monotonic capsule/fake-capsule sequence;
- each turn expected input digest equals previous output digest when applicable;
- generated artifacts belong to workflow and Plan Item;
- readiness does not create execution/run-session/worker/job/PR/review-loop state.

- [ ] **Step 4: Implement real dogfood script**

Create `scripts/plan-item-workflow-product-loop-real-dogfood.ts`.

Behavior:

- require explicit acceptance env such as `FORGELOOP_REAL_RUNTIME_ACCEPTANCE=1`;
- if credentials/runtime are unavailable and acceptance env is not set, exit 0 with clear `SKIPPED_NON_ACCEPTANCE` output for local convenience;
- if acceptance env is set, exit nonzero unless the real runtime continuity run passes.

Required proof:

- same `codex_thread_id_digest` across Boundary/Spec/Implementation Plan generation stages;
- capsule sequence advances across document generation turns;
- restore uses capsule state and does not start a hidden replacement thread;
- public report contains only safe digests/status/counts/blocker codes;
- readiness does not create execution/run-session/worker/job/PR/review-loop state.

- [ ] **Step 5: Add package scripts**

In `package.json`:

```json
"dogfood:plan-item-workflow-product-loop": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/plan-item-workflow-product-loop-dogfood.ts",
"dogfood:plan-item-workflow-product-loop:real": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/plan-item-workflow-product-loop-real-dogfood.ts"
```

- [ ] **Step 6: Run dogfood smoke and fake dogfood**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm dogfood:plan-item-workflow-product-loop
```

Expected: PASS and fake dogfood exits 0.

- [ ] **Step 7: Run real dogfood locally**

Run:

```bash
pnpm dogfood:plan-item-workflow-product-loop:real
```

Expected local developer result may be `SKIPPED_NON_ACCEPTANCE` if credentials are unavailable.

For acceptance, run with credentialed environment:

```bash
FORGELOOP_REAL_RUNTIME_ACCEPTANCE=1 pnpm dogfood:plan-item-workflow-product-loop:real
```

Expected acceptance result: PASS. If it skips in acceptance mode, this wave is not shippable.

- [ ] **Step 8: Commit**

```bash
git add scripts/plan-item-workflow-product-loop-dogfood.ts scripts/plan-item-workflow-product-loop-real-dogfood.ts package.json tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts tests/helpers/plan-item-workflow-fixtures.ts
git commit -m "test: dogfood plan item workflow product loop"
```

## Task 9: No-Baggage Guard And Full Verification

**Files:**
- Modify: `scripts/check-codex-runtime-superpowers-no-baggage.ts`
- Modify: `tests/smoke/codex-runtime-no-baggage-gate.test.ts`
- Modify: `tests/api/plan-item-workflows.test.ts`
- Modify: `tests/web/development-plan-routes.test.tsx`

- [ ] **Step 1: Write failing no-baggage tests**

In `tests/smoke/codex-runtime-no-baggage-gate.test.ts`, add negative fixtures for:

- public `spec/generate-draft` product path outside queued action run;
- public `implementation-plan/generate-draft` product path outside queued action run;
- public `execution/start` for Wave 5 workflow-owned Plan Items;
- public `recover`, `fork`, `select-active-fork`, `new-session`, `abandon`, `scavenge`;
- composer label or command body containing `generate_spec_doc`, `generate_implementation_plan_doc`, `start_execution`;
- raw `codex_thread_id`, `output_capsule_id`, `artifact://`, `memory_bundle_ref`, `prompt_transcript`, or local `/Users/` path in public UI/DTO files;
- `CodexSessionSnapshot` in touched public product DTOs/UI/docs.

- [ ] **Step 2: Run failing no-baggage test**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-no-baggage-gate.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL until guard patterns are updated.

- [ ] **Step 3: Update guard**

In `scripts/check-codex-runtime-superpowers-no-baggage.ts`:

- add pattern categories:
  - `legacy_workflow_direct_spec_generation`
  - `legacy_workflow_direct_plan_generation`
  - `legacy_workflow_direct_execution_start`
  - `wave5_forbidden_session_mutation`
  - `workflow_composer_generation_action`
  - `public_raw_codex_runtime_ref`
- scan active public files:
  - `apps/control-plane-api/src/modules/plan-item-workflows`
  - `apps/control-plane-api/src/modules/spec-plan`
  - `apps/control-plane-api/src/modules/executions`
  - `apps/web/src/features/development-plans`
  - `apps/web/src/shared/api`
  - active scripts and docs touched by this wave.
- allow only negative tests, internal private storage, and historical docs explicitly outside touched product surfaces.

- [ ] **Step 4: Run no-baggage guard**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-no-baggage-gate.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm check:codex-runtime-superpowers-no-baggage
```

Expected: PASS.

- [ ] **Step 5: Run focused regression suites**

Run:

```bash
pnpm vitest run tests/contracts/plan-item-workflow.test.ts tests/domain/plan-item-workflow.test.ts tests/db/plan-item-workflow-repository.test.ts tests/api/plan-item-workflows.test.ts tests/web/development-plan-routes.test.tsx tests/web/product-grade-first-viewport.test.tsx tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts tests/smoke/codex-runtime-no-baggage-gate.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 6: Run required acceptance commands**

Run:

```bash
pnpm test
pnpm build
git diff --check
pnpm dogfood:plan-item-workflow-product-loop
pnpm dogfood:plan-item-workflow-product-loop:real
pnpm check:codex-runtime-superpowers-no-baggage
```

Expected:

- all commands pass except `pnpm dogfood:plan-item-workflow-product-loop:real` may emit `SKIPPED_NON_ACCEPTANCE` only in local uncredentialed development;
- before claiming Wave 5 shippable, a credentialed acceptance run of `FORGELOOP_REAL_RUNTIME_ACCEPTANCE=1 pnpm dogfood:plan-item-workflow-product-loop:real` must pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/check-codex-runtime-superpowers-no-baggage.ts tests/smoke/codex-runtime-no-baggage-gate.test.ts tests/api/plan-item-workflows.test.ts tests/web/development-plan-routes.test.tsx
git commit -m "test: enforce workflow product loop no-baggage guard"
```

## Task 10: Final Review, Browser Evidence, And PR Handoff

**Files:**
- No planned source changes unless verification exposes issues.

- [ ] **Step 1: Inspect git status**

Run:

```bash
git status --short --branch
```

Expected: on the feature branch with only intentional committed changes or a clean worktree.

- [ ] **Step 2: Run final required commands**

Run:

```bash
pnpm test
pnpm build
git diff --check
pnpm dogfood:plan-item-workflow-product-loop
pnpm check:codex-runtime-superpowers-no-baggage
```

Expected: PASS.

Run the real dogfood:

```bash
pnpm dogfood:plan-item-workflow-product-loop:real
```

Expected local: PASS or `SKIPPED_NON_ACCEPTANCE`. If skipped, document that this is not shipping acceptance.

Run credentialed acceptance before merge:

```bash
FORGELOOP_REAL_RUNTIME_ACCEPTANCE=1 pnpm dogfood:plan-item-workflow-product-loop:real
```

Expected: PASS.

- [ ] **Step 3: Browser verification**

Start the app if needed:

```bash
pnpm dev:web
```

Use the in-app Browser to verify the Plan Item workspace:

- chat is the center surface;
- timeline is left;
- artifact/context rail is right;
- artifact drawer does not replace chat;
- composer only has `Answer Boundary Question` and `Continue AI`;
- Run generation appears only on queued action/timeline;
- Approve/Request Changes are in artifact drawer;
- role lenses do not change workflow state;
- no raw runtime refs are visible;
- layout is visually clean at desktop and mobile widths.

Capture screenshots if the current workflow asks for PR evidence.

- [ ] **Step 4: Review against spec**

Read `docs/superpowers/specs/2026-06-03-plan-item-workflow-product-loop-design.md` and verify every Acceptance Criteria bullet is covered by implementation or explicitly blocked by a failing acceptance command.

- [ ] **Step 5: Commit any verification fixes**

If fixes were needed:

```bash
git add <changed-files>
git commit -m "fix: close plan item workflow product loop gaps"
```

- [ ] **Step 6: Prepare PR summary**

Include:

- the product path implemented;
- routes added/disabled;
- dogfood results;
- real runtime acceptance status;
- explicit statement that Wave 5 stops at Execution Ready and does not start execution.

## Acceptance Checklist

- [ ] `PlanItemWorkflow` is the only public Superpowers workflow entry point for Plan Item document generation.
- [ ] `start-brainstorming` creates workflow/session plus queued continuation, but no Codex turn.
- [ ] `/messages` records human input and may create queued `continue_brainstorming`, but never calls Codex or claims a lease.
- [ ] Every Codex-producing turn runs only through `/actions/:actionId/run`.
- [ ] Queued action idempotency and compare-and-set run claim are covered by tests.
- [ ] Request-changes cascades stale downstream evidence and dependent queued actions atomically.
- [ ] Boundary approval queues Spec Doc generation.
- [ ] Spec approval queues Implementation Plan Doc generation.
- [ ] Implementation Plan approval unlocks readiness evaluation but does not mark execution ready by itself.
- [ ] Execution Ready evaluation checks approved docs, Plan Item revision currency, QA/test strategy, internal Execution Package boundary, and session/capsule health.
- [ ] Execution Ready evaluation does not create/claim execution, run-session, worker, workspace bundle, code-writing, PR, or review-loop state.
- [ ] Chat-first UI has left timeline, center conversation, right artifact/context rail.
- [ ] Composer contains only message actions, not generation/gate/execution actions.
- [ ] Role lenses change emphasis only, not workflow state.
- [ ] Context Preview is read-only and public-safe.
- [ ] No raw thread id, capsule ref, memory content/ref, prompt transcript, local artifact path, or credential metadata appears in public DTO/UI.
- [ ] Fake dogfood passes.
- [ ] Real runtime dogfood passes in credentialed acceptance mode before shipping.
- [ ] `pnpm test`, `pnpm build`, `git diff --check`, and `pnpm check:codex-runtime-superpowers-no-baggage` pass.
