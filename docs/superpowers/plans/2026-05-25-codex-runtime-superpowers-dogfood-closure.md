# Codex Runtime Superpowers Dogfood Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the strict Codex app-server dogfood path for the Superpowers product loop: Development Plan Item -> multi-round Boundary Brainstorming -> approved Boundary Summary -> generated Spec revision -> generated Execution Plan revision -> Execution.

**Architecture:** This plan keeps product generation behind the existing `automation_action_run` generation fence and keeps source-changing execution behind the existing `run_session` / `run_execution` fence. Boundary Brainstorming becomes a persisted multi-round Leader-AI process, Codex config/auth are centrally imported and materialized into per-job Docker `CODEX_HOME`, and strict dogfood proves the full loop without host `~/.codex` or CLI fallback.

**Tech Stack:** TypeScript, NestJS, Zod, Drizzle ORM, Vitest, pnpm, Dockerized Codex app-server, existing `@forgeloop/domain`, `@forgeloop/contracts`, `@forgeloop/db`, `@forgeloop/codex-runtime`, and `@forgeloop/codex-worker-runtime` packages.

---

## Spec Reference

Primary spec: `docs/superpowers/specs/2026-05-25-codex-runtime-superpowers-dogfood-closure-design.md`

Related product direction:

- `docs/superpowers/specs/2026-05-23-ai-native-project-management-ux-redesign-design.md`
- `docs/superpowers/plans/2026-05-24-ai-native-project-management-ux-redesign.md`

## Implementation Notes

- Use TDD for every task. Write the failing test first, run it, implement the smallest change, rerun the target, then commit.
- Keep public API/report vocabulary in the Superpowers product model. Do not add new public Work Item / Task / raw Run Session surfaces.
- Local `~/.codex/config.toml` and `~/.codex/auth.json` are import sources only. Runtime workers must receive config/auth from the control plane and materialize them under per-task `CODEX_HOME`.
- `unsafe_db` credential persistence is allowed only behind `FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE=1` plus explicit acknowledgement.
- The old `spec_draft`, `plan_draft`, and `package_drafts` runtime task kinds remain for legacy internal behavior, but the new closure path must use the three new task kinds and must not fall through to old draft generators.

## File Structure

### Contracts And Domain

- Modify `packages/contracts/src/ai-project-management.ts`
  - Add Leader/delegate fields to Development Plan Item.
  - Add Boundary Session status, Leader/delegate snapshot fields, current/latest/approved round pointers, Boundary Round, round-scoped question/answer/decision schemas, and expanded Boundary Summary Revision contract.
  - Add required `approved_spec_revision_id` and public approved Spec revision ref on product `Execution`.
  - Keep compatibility fields for old session-level arrays while new callers use row-level artifacts.
- Modify `packages/domain/src/brainstorming.ts`
  - Export `BoundaryRound`, `BoundaryQuestion`, `BoundaryAnswer`, `BoundaryDecision`, expanded `BoundarySummaryRevision`.
  - Add helpers for required-question closure and Leader/delegate authorization.
- Modify `packages/domain/src/development-plan.ts`
  - Add gate helper variants that require approved `BoundarySummaryRevision.status === 'approved'`.
- Modify `packages/domain/src/codex-runtime.ts`
  - Expand `CodexGenerationWorkloadV1.task_kind`.
  - Add typed runtime job result validation for the three new product generation payloads.

### Database And Repository

- Modify `packages/db/src/schema/development-plan.ts`
  - Persist `leaderActorId` and `leaderDelegateActorIds` on `development_plan_items`.
- Modify `packages/db/src/schema/brainstorming.ts`
  - Add columns on `brainstorming_sessions`.
  - Add `boundary_rounds`, `boundary_questions`, `boundary_answers`, `boundary_decisions`.
  - Expand `boundary_summary_revisions` fields.
- Modify `packages/db/src/repositories/delivery-repository.ts`
  - Add repository methods for rounds/questions/answers/decisions.
  - Update save/list mappings and revision compare snapshots.
  - Add migration/backfill helper for synthetic round 1 and summary revision eligibility.
- Modify `packages/db/src/repositories/in-memory-delivery-repository.ts`
  - Implement all new repository methods for API/unit tests that use the in-memory repository.
- Modify `packages/db/src/repositories/drizzle-delivery-repository.ts`
  - Implement Drizzle persistence/mappers for the new tables, fields, and backfill helper.
- Test in `tests/contracts/project-management-contracts.test.ts`
- Test in `tests/db/brainstorming-repository.test.ts`
- Update existing fixtures in `tests/helpers/*` as needed.

### Product API And Services

- Modify `apps/control-plane-api/src/modules/brainstorming/brainstorming.controller.ts`
  - Add spec routes while keeping backward-compatible aliases if existing tests depend on them.
  - Add start body fields for Leader/delegates and initial Leader context.
  - Add continue and summary revision request-change/approve routes.
- Modify `apps/control-plane-api/src/modules/brainstorming/brainstorming.service.ts`
  - Replace fixed one-shot question flow with persisted round flow.
  - Resolve Leader/delegates safely and prevent delegate self-escalation.
  - Schedule `AutomationActionRun` + runtime job for each AI turn.
  - Apply worker terminal results under action-run/product revision fences.
- Modify `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`
  - Add generated Spec revision writer from `GeneratedSpecRevisionV1`.
  - Add generated Execution Plan revision writer from `GeneratedExecutionPlanRevisionV1`.
  - Persist generated Execution Plan structured path policy fields into `ExecutionPlanRevision.structured_document`.
  - Re-check approved Boundary Summary / Spec preconditions at write time.
- Modify `apps/control-plane-api/src/modules/executions/executions.service.ts`
  - Ensure product Execution public linkage contains required approved Spec, approved Execution Plan revision, and internal backing refs only as evidence.
  - Ensure run execution path policy derives from approved Execution Plan revision.
  - Bridge Start Execution into the existing run runtime queue.
- Modify `apps/control-plane-api/src/modules/executions/executions.module.ts`
  - Import/export the existing run-control dependency needed by Start Execution.
- Modify `apps/control-plane-api/src/modules/run-control/run-control.service.ts`
  - Reuse `enqueueRunWithRepository(...)` for product Execution start.
- Modify `packages/db/src/schema/execution-supervision.ts`
  - Persist required approved Spec revision linkage on `executions`.
- Test in `tests/api/brainstorming.test.ts`
- Test in `tests/api/spec-plan-service.test.ts`
- Test in `tests/api/executions.test.ts`
- Test in `tests/db/repository-contract.ts`

### Automation Action And Runtime Launch

- Modify `apps/control-plane-api/src/modules/automation/automation.dto.ts`
  - Add three action types and input schemas:
    - `run_boundary_brainstorming_round`
    - `generate_development_plan_item_spec_revision`
    - `generate_development_plan_item_execution_plan_revision`
- Modify `apps/control-plane-api/src/modules/automation/automation-action.service.ts`
  - Ensure create/claim filters handle new action types.
- Modify or add `apps/control-plane-api/src/modules/automation/product-generation-result.service.ts`
  - Route terminal runtime results to product writers.
  - Reject stale preconditions and public-unsafe payloads.
- Modify `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
  - After worker-authenticated terminalization, invoke product result writer for generation jobs.
  - Keep terminal endpoint at `/internal/codex-workers/:workerId/runtime-jobs/:jobId/terminal`.

### Codex Runtime Package And Worker

- Modify `packages/codex-runtime/src/types.ts`
  - Add result interfaces for boundary round, Spec revision, and Execution Plan revision.
  - Add runtime methods for the three new task kinds.
- Modify `packages/codex-runtime/src/payloads.ts`
  - Add Zod validators and public-safe checks for new payloads.
- Modify `packages/codex-runtime/src/runtime.ts`
  - Add fake and app-server implementations for the new runtime methods.
- Modify `packages/codex-runtime/src/fake-driver.ts`
  - Add deterministic fake payload builders for tests only.
- Modify `packages/codex-worker-runtime/src/remote-worker-client.ts`
  - Replace generation dispatch fallthrough with exhaustive switch.
  - Unknown `task_kind` terminalizes as unsupported workload.
- Test in `tests/codex-runtime/payloads.test.ts`
- Test in `tests/codex-runtime/runtime.test.ts`
- Test in `tests/codex-worker-runtime/remote-worker-client.test.ts`

### Runtime Import, Worker Isolation, Scripts, Runbooks

- Modify `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts`
  - Add import-profile/import-credential/import-local-codex schemas.
  - Require `unsafe_db_acknowledgement` for raw auth imports.
- Modify `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.controller.ts`
  - Add:
    - `POST /internal/codex-runtime/import-profile`
    - `POST /internal/codex-runtime/import-credential`
    - `POST /internal/codex-runtime/import-local-codex`
- Modify `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
  - Build runtime profile revisions from imported TOML.
  - Fail closed when unsafe DB store is disabled.
  - Reject production `unsafe_db` imports.
- Create `scripts/codex-runtime-import.ts`
  - Operator CLI for explicit file/body/local import.
- Modify `scripts/codex-runtime-dogfood-bootstrap.ts`
  - Delegate to import APIs and remove hardcoded `approval_policy = "never"` config.
- Modify `scripts/codex-remote-worker-dogfood.ts`
  - Add no-shared-filesystem worker mode.
  - Reject control-plane repo path/config/auth path in strict mode.
- Modify `docs/runbooks/codex-remote-worker-runtime.md`
  - Use real script aliases and explicit config/auth import.
- Modify `package.json`
  - Add required aliases:
    - `codex:runtime:import`
    - `codex:runtime:bootstrap`
    - `codex:remote-worker`
    - `dogfood:codex-runtime:superpowers`
    - `check:codex-runtime-superpowers-no-baggage`
    - `check:runbook-scripts`
- Test in `tests/api/codex-runtime-import.test.ts`
- Test in `tests/codex-worker-runtime/workspace-isolation.test.ts`
- Test in `tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts`

### Dogfood And Guard Scripts

- Create `scripts/check-runbook-scripts.ts`
  - Parse active runbooks and `package.json` to fail missing `pnpm <script>` aliases.
- Create `scripts/check-codex-runtime-superpowers-no-baggage.ts`
  - Run focused scans with documented allowlist.
- Create `scripts/codex-runtime-superpowers-dogfood.ts`
  - Drive strict end-to-end product loop and emit public-safe report.
- Create `tests/smoke/codex-runtime-no-baggage-gate.test.ts`
- Create `tests/smoke/runbook-script-consistency.test.ts`

---

### Task 1: Contract And Domain Model Foundation

**Files:**
- Modify: `packages/contracts/src/ai-project-management.ts`
- Modify: `packages/domain/src/brainstorming.ts`
- Modify: `packages/domain/src/development-plan.ts`
- Test: `tests/contracts/project-management-contracts.test.ts`
- Test: `tests/domain/ai-native-planning-gates.test.ts`

- [ ] **Step 1: Write failing contract tests for Leader/delegates and round artifacts**

Append tests that parse a Development Plan Item with Leader fields and reject unsafe approved Boundary Summary revisions.

```ts
import {
  brainstormingSessionSchema,
  boundarySummaryRevisionSchema,
  boundaryRoundSchema,
  developmentPlanItemSchema,
  executionSchema,
} from '../packages/contracts/src/ai-project-management';

it('accepts Leader and delegate fields on Development Plan Item', () => {
  expect(
    developmentPlanItemSchema.parse({
      id: 'item-1',
      development_plan_id: 'plan-1',
      revision_id: 'item-rev-1',
      title: 'Runtime closure',
      summary: 'Close runtime dogfood',
      driver_actor_id: 'actor-driver',
      reviewer_actor_id: 'actor-reviewer',
      leader_actor_id: 'actor-leader',
      leader_delegate_actor_ids: ['actor-delegate'],
      responsible_role: 'tech_lead',
      risk: 'high',
      dependency_hints: [],
      affected_surfaces: [],
      boundary_status: 'in_progress',
      spec_status: 'missing',
      execution_plan_status: 'missing',
      execution_status: 'not_started',
      review_status: 'missing',
      qa_handoff_status: 'missing',
      release_impact: 'release_scoped',
      next_action: 'boundary_brainstorming',
      updated_at: '2026-05-25T00:00:00.000Z',
    }),
  ).toMatchObject({
    leader_actor_id: 'actor-leader',
    leader_delegate_actor_ids: ['actor-delegate'],
  });
});

it('accepts Boundary Brainstorming session process fields and Leader snapshot', () => {
  expect(
    brainstormingSessionSchema.parse({
      id: 'session-1',
      revision_id: 'session-rev-1',
      source_ref: { type: 'requirement', id: 'req-1', revision_id: 'req-rev-1' },
      development_plan_id: 'plan-1',
      development_plan_revision_id: 'plan-rev-1',
      development_plan_item_id: 'item-1',
      development_plan_item_revision_id: 'item-rev-1',
      leader_actor_id: 'actor-leader',
      leader_delegate_actor_ids: ['actor-delegate'],
      context_manifest_id: 'context-1',
      context_manifest_revision_id: 'context-rev-1',
      status: 'waiting_for_leader',
      current_round_id: 'round-1',
      latest_summary_revision_id: undefined,
      approved_summary_revision_id: undefined,
      questions: [],
      answers: [],
      decisions: [],
      approval_state: 'questions_open',
      created_at: '2026-05-25T00:00:00.000Z',
      updated_at: '2026-05-25T00:00:00.000Z',
    }),
  ).toMatchObject({
    leader_actor_id: 'actor-leader',
    current_round_id: 'round-1',
    status: 'waiting_for_leader',
  });
});

it('requires product Execution to publicly link approved Spec revision', () => {
  expect(() =>
    executionSchema.parse({
      id: 'execution-1',
      development_plan_item_id: 'item-1',
      execution_plan_revision_id: 'execution-plan-rev-1',
      ref: { type: 'execution', id: 'execution-1' },
      development_plan_item_ref: {
        type: 'development_plan_item',
        id: 'item-1',
        development_plan_id: 'plan-1',
        revision_id: 'item-rev-1',
      },
      execution_plan_revision_ref: {
        type: 'execution_plan_revision',
        id: 'execution-plan-rev-1',
        execution_plan_id: 'execution-plan-1',
      },
      status: 'running',
      evidence_refs: [],
      runtime_evidence_refs: [],
      interrupt_history: [],
      continuation_history: [],
      pr_refs: [],
      diff_refs: [],
      test_evidence_refs: [],
      created_at: '2026-05-25T00:00:00.000Z',
      updated_at: '2026-05-25T00:00:00.000Z',
    }),
  ).toThrow(/approved_spec_revision_id/i);
});

it('accepts product Execution with approved Spec revision linkage and internal runtime evidence refs', () => {
  expect(
    executionSchema.parse({
      id: 'execution-1',
      development_plan_item_id: 'item-1',
      approved_spec_revision_id: 'spec-rev-1',
      approved_spec_revision_ref: {
        type: 'spec_revision',
        id: 'spec-rev-1',
        spec_id: 'spec-1',
      },
      execution_plan_revision_id: 'execution-plan-rev-1',
      ref: { type: 'execution', id: 'execution-1' },
      development_plan_item_ref: {
        type: 'development_plan_item',
        id: 'item-1',
        development_plan_id: 'plan-1',
        revision_id: 'item-rev-1',
      },
      execution_plan_revision_ref: {
        type: 'execution_plan_revision',
        id: 'execution-plan-rev-1',
        execution_plan_id: 'execution-plan-1',
      },
      status: 'running',
      evidence_refs: [{ type: 'spec_revision', id: 'spec-rev-1', spec_id: 'spec-1' }],
      runtime_evidence_refs: [{ type: 'execution_package', id: 'package-1' }],
      interrupt_history: [],
      continuation_history: [],
      pr_refs: [],
      diff_refs: [],
      test_evidence_refs: [],
      created_at: '2026-05-25T00:00:00.000Z',
      updated_at: '2026-05-25T00:00:00.000Z',
    }),
  ).toMatchObject({ approved_spec_revision_id: 'spec-rev-1' });
});

it('rejects approved Boundary Summary revisions without round and context evidence', () => {
  expect(() =>
    boundarySummaryRevisionSchema.parse({
      id: 'boundary-rev-1',
      boundary_summary_id: 'boundary-1',
      session_id: 'session-1',
      session_revision_id: 'session-rev-1',
      source_round_id: 'round-1',
      development_plan_id: 'plan-1',
      development_plan_item_id: 'item-1',
      development_plan_item_revision_id: 'item-rev-1',
      revision_number: 1,
      status: 'approved',
      summary_markdown: 'Summary',
      confirmed_scope: ['runtime closure'],
      confirmed_out_of_scope: [],
      accepted_assumptions: [],
      open_risks: [],
      validation_expectations: ['pnpm test'],
      question_answer_snapshot: [],
      decision_snapshot: [],
      context_manifest_id: 'context-1',
      context_manifest_revision_id: 'context-rev-1',
      approved_by_actor_id: 'actor-leader',
      approved_at: '2026-05-25T00:00:00.000Z',
      created_at: '2026-05-25T00:00:00.000Z',
    }),
  ).toThrow(/approved Boundary Summary must include question and decision evidence/i);
});

it('accepts approved Boundary Summary revisions with persisted evidence snapshots', () => {
  expect(
    boundarySummaryRevisionSchema.parse({
      id: 'boundary-rev-2',
      boundary_summary_id: 'boundary-1',
      session_id: 'session-1',
      session_revision_id: 'session-rev-1',
      source_round_id: 'round-2',
      development_plan_id: 'plan-1',
      development_plan_item_id: 'item-1',
      development_plan_item_revision_id: 'item-rev-1',
      revision_number: 2,
      status: 'approved',
      summary_markdown: 'Summary',
      confirmed_scope: ['runtime closure'],
      confirmed_out_of_scope: ['CLI fallback'],
      accepted_assumptions: ['centralized Codex config import is available'],
      open_risks: ['worker registry bootstrap may be flaky'],
      validation_expectations: ['pnpm dogfood:codex-runtime:superpowers'],
      question_answer_snapshot: [
        {
          question_id: 'question-1',
          answer_id: 'answer-1',
          text: 'Which runtime boundary owns Codex config?',
        },
      ],
      decision_snapshot: [
        {
          decision_id: 'decision-1',
          text: 'Use centralized config distribution only.',
        },
      ],
      context_manifest_id: 'context-1',
      context_manifest_revision_id: 'context-rev-1',
      approved_by_actor_id: 'actor-leader',
      approved_at: '2026-05-25T00:00:00.000Z',
      created_at: '2026-05-25T00:00:00.000Z',
    }),
  ).toMatchObject({ status: 'approved' });
});
```

- [ ] **Step 2: Run the failing contract tests**

Run:

```bash
pnpm vitest run tests/contracts/project-management-contracts.test.ts tests/domain/ai-native-planning-gates.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because `leader_actor_id`, `leader_delegate_actor_ids`, `development_plan_revision_id`, session `status` / round pointers, `boundaryRoundSchema`, and approved Boundary Summary evidence guards do not exist yet.

- [ ] **Step 3: Add contract schemas**

In `packages/contracts/src/ai-project-management.ts`, add these schemas near the current brainstorming schemas:

```ts
export const boundarySessionStatusSchema = z.enum([
  'draft',
  'ai_turn_running',
  'waiting_for_leader',
  'summary_proposed',
  'approved',
  'changes_requested',
  'stale',
  'cancelled',
]);

const boundaryBrainstormingSessionProcessShape = {
  development_plan_revision_id: nonEmpty,
  leader_actor_id: nonEmpty,
  leader_delegate_actor_ids: z.array(nonEmpty).default([]),
  status: boundarySessionStatusSchema,
  current_round_id: nonEmpty.optional(),
  latest_summary_revision_id: nonEmpty.optional(),
  approved_summary_revision_id: nonEmpty.optional(),
  closed_at: isoDateTimeSchema.optional(),
} satisfies z.ZodRawShape;

export const boundaryRoundSchema = z
  .object({
    id: nonEmpty,
    session_id: nonEmpty,
    session_revision_id: nonEmpty,
    round_number: z.number().int().positive(),
    trigger: z.enum(['start', 'leader_answer', 'leader_revision_request', 'ai_follow_up', 'summary_proposal', 'approval_request']),
    leader_input_markdown: nonEmpty.optional(),
    ai_output_markdown: nonEmpty.optional(),
    runtime_job_id: nonEmpty.optional(),
    runtime_profile_revision_id: nonEmpty.optional(),
    credential_binding_version_id: nonEmpty.optional(),
    app_server_thread_digest: nonEmpty.optional(),
    app_server_turn_digest: nonEmpty.optional(),
    status: z.enum(['queued', 'running', 'waiting_for_leader', 'summary_proposed', 'terminal', 'failed']),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
  })
  .strict();
```

Merge `boundaryBrainstormingSessionProcessShape` into the existing `brainstormingSessionSchema` object before `.strict().superRefine(...)`, preserving read-only compatibility arrays `questions`, `answers`, and `decisions`.

Also:

- Add `leader_actor_id: nonEmpty.optional()` and `leader_delegate_actor_ids: z.array(nonEmpty).default([])` to `developmentPlanItemSchema`.
- Add `development_plan_revision_id`, `leader_actor_id`, `leader_delegate_actor_ids`, explicit `status`, `current_round_id`, `latest_summary_revision_id`, `approved_summary_revision_id`, and `closed_at` to `brainstormingSessionSchema` and exported `BrainstormingSession` type.
- Add required `approved_spec_revision_id: nonEmpty` and `approved_spec_revision_ref` with `{ type: 'spec_revision', id, spec_id }` to `executionSchema` and exported `Execution` type. Keep execution package and run session ids in `runtime_evidence_refs`, not as primary public identity.
- Add `round_id`, `required`, `rationale`, `answered_by_answer_id`, `waived_by_decision_id`, and `superseded` status support to question schema.
- Add `round_id` and Leader/delegate actor semantics fields to answer/decision schemas.
- Add `boundarySummaryRevisionSchema` and export its type.

- [ ] **Step 4: Add domain types and gate helpers**

In `packages/domain/src/brainstorming.ts`, export contract-backed interfaces and helper functions:

- `BrainstormingSession` must expose the contract fields `development_plan_revision_id`, `leader_actor_id`, `leader_delegate_actor_ids`, `status`, `current_round_id`, `latest_summary_revision_id`, and `approved_summary_revision_id`; do not keep these only in repository JSON.

```ts
export const actorCanActForBoundaryLeader = (
  session: Pick<BrainstormingSession, 'leader_actor_id' | 'leader_delegate_actor_ids'>,
  actorId: string,
): boolean => session.leader_actor_id === actorId || session.leader_delegate_actor_ids.includes(actorId);

export const requiredBoundaryQuestionsClosed = (input: {
  questions: BoundaryQuestion[];
  answers: BoundaryAnswer[];
  decisions: BoundaryDecision[];
}): boolean => {
  const answerIds = new Set(input.answers.map((answer) => answer.id));
  const acceptedWaiverIds = new Set(
    input.decisions
      .filter((decision) => decision.state === 'accepted' && decision.source !== 'ai_proposed')
      .map((decision) => decision.id),
  );
  return input.questions
    .filter((question) => question.required && question.status !== 'superseded')
    .every((question) =>
      (question.answered_by_answer_id !== undefined && answerIds.has(question.answered_by_answer_id)) ||
      (question.waived_by_decision_id !== undefined && acceptedWaiverIds.has(question.waived_by_decision_id)),
    );
};
```

In `packages/domain/src/development-plan.ts`, update `canGenerateSpecFromPlanItem` to accept an optional `boundarySummaryRevision` and reject non-approved revisions:

```ts
if (input.boundarySummaryRevision?.status !== 'approved') {
  return { ok: false, reason: 'boundary_summary_missing_approval' };
}
```

- [ ] **Step 5: Run targeted tests**

Run:

```bash
pnpm vitest run tests/contracts/project-management-contracts.test.ts tests/domain/ai-native-planning-gates.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add packages/contracts/src/ai-project-management.ts packages/domain/src/brainstorming.ts packages/domain/src/development-plan.ts tests/contracts/project-management-contracts.test.ts tests/domain/ai-native-planning-gates.test.ts
git commit -m "feat: add boundary brainstorming product contracts"
```

---

### Task 2: Database Schema And Repository Persistence

**Files:**
- Modify: `packages/db/src/schema/development-plan.ts`
- Modify: `packages/db/src/schema/brainstorming.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Create: `tests/db/brainstorming-repository.test.ts`
- Modify: `tests/helpers/*` only where existing fixtures fail type checks.

- [ ] **Step 1: Write failing repository tests**

Create `tests/db/brainstorming-repository.test.ts` with a focused repository test that saves a session, a round, a required question, an answer, a decision, and an approved summary revision.

Add migration/default tests proving:

- existing Development Plan Items with `reviewer_actor_id` get `leader_actor_id = reviewer_actor_id`;
- items without reviewer but with `driver_actor_id` get `leader_actor_id = driver_actor_id`;
- items with neither reviewer nor driver remain without a Leader and start requests fail until explicitly assigned;
- existing active Brainstorming Sessions receive a stored Leader/delegate snapshot from the item default, not from the actor making the migration.

```ts
it('persists round-scoped Boundary Brainstorming evidence', async () => {
  const repository = createInMemoryDeliveryRepository();
  const seeded = await seedDevelopmentPlanItemForRepository(repository);

  await repository.saveBrainstormingSession({
    id: 'session-1',
    revision_id: 'session-rev-1',
    source_ref: seeded.item.source_ref,
    development_plan_id: seeded.plan.id,
    development_plan_revision_id: seeded.plan.revision_id,
    development_plan_item_id: seeded.item.id,
    development_plan_item_revision_id: seeded.item.revision_id,
    leader_actor_id: 'actor-leader',
    leader_delegate_actor_ids: ['actor-delegate'],
    context_manifest_id: 'context-1',
    context_manifest_revision_id: 'context-rev-1',
    status: 'waiting_for_leader',
    questions: [],
    answers: [],
    decisions: [],
    approval_state: 'questions_open',
    created_at: at,
    updated_at: at,
  });

  await repository.saveBoundaryRound({
    id: 'round-1',
    session_id: 'session-1',
    session_revision_id: 'session-rev-1',
    round_number: 1,
    trigger: 'start',
    status: 'waiting_for_leader',
    created_at: at,
    updated_at: at,
  });

  await repository.saveBoundaryQuestion({
    id: 'question-1',
    session_id: 'session-1',
    round_id: 'round-1',
    sequence: 1,
    text: 'What is in scope?',
    required: true,
    author_id: 'runtime',
    status: 'open',
    created_at: at,
  });

  expect(await repository.listBoundaryRounds('session-1')).toHaveLength(1);
  expect(await repository.listBoundaryQuestions('session-1')).toHaveLength(1);
});
```

- [ ] **Step 2: Run the failing repository test**

Run:

```bash
pnpm vitest run tests/db/brainstorming-repository.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because repository methods and tables are missing.

- [ ] **Step 3: Add Drizzle schema fields and tables**

In `packages/db/src/schema/development-plan.ts`:

```ts
leaderActorId: uuid('leader_actor_id').references(() => actors.id),
leaderDelegateActorIds: jsonb('leader_delegate_actor_ids').$type<DevelopmentPlanItem['leader_delegate_actor_ids']>().notNull(),
```

In `packages/db/src/schema/brainstorming.ts`:

- Add `developmentPlanRevisionId`, `leaderActorId`, `leaderDelegateActorIds`, `status`, `currentRoundId`, `latestSummaryRevisionId`, `approvedSummaryRevisionId`, `closedAt` to `brainstorming_sessions`.
- Add `boundary_rounds`.
- Add `boundary_questions`.
- Add `boundary_answers`.
- Add `boundary_decisions`.
- Add expanded fields to `boundary_summary_revisions`: `sourceRoundId`, `developmentPlanId`, `status`, structured arrays, snapshots, context manifest refs, `proposedByRuntimeJobId`.

- [ ] **Step 4: Add repository interface methods**

In `packages/db/src/repositories/delivery-repository.ts`, add methods:

```ts
saveBoundaryRound(round: BoundaryRound): Promise<void>;
listBoundaryRounds(sessionId: string): Promise<BoundaryRound[]>;
saveBoundaryQuestion(question: BoundaryQuestion): Promise<void>;
listBoundaryQuestions(sessionId: string): Promise<BoundaryQuestion[]>;
saveBoundaryAnswer(answer: BoundaryAnswer): Promise<void>;
listBoundaryAnswers(sessionId: string): Promise<BoundaryAnswer[]>;
saveBoundaryDecision(decision: BoundaryDecision): Promise<void>;
listBoundaryDecisions(sessionId: string): Promise<BoundaryDecision[]>;
```

Implement mapping functions next to the existing brainstorming mappers, then implement every new method in both concrete repositories:

- `packages/db/src/repositories/in-memory-delivery-repository.ts` must store the new rows in deterministic arrays/maps and return sorted lists for round/question/answer/decision sequence tests.
- `packages/db/src/repositories/drizzle-delivery-repository.ts` must map the new Drizzle tables/columns and preserve the same replay/update semantics as existing product objects.
- Add a repository contract assertion that calls the interface through `createInMemoryDeliveryRepository()` and through the Drizzle test repository so missing concrete methods fail before API tests run.

- [ ] **Step 5: Add Leader/default and summary revision backfill helpers**

Add a repository helper:

```ts
backfillBoundaryLeaderDefaults(input: {
  now: string;
}): Promise<{ updated_item_ids: string[]; updated_session_ids: string[]; blocked_item_ids: string[] }>;

backfillBoundarySummaryRevisionEligibility(input: {
  session_id: string;
  boundary_summary_id: string;
  now: string;
}): Promise<{ downgraded_revision_ids: string[]; approved_revision_ids: string[] }>;
```

Rules:

- `backfillBoundaryLeaderDefaults` sets item `leader_actor_id` from `reviewer_actor_id ?? driver_actor_id` only when present.
- `backfillBoundaryLeaderDefaults` writes `leader_delegate_actor_ids: []` for legacy rows with missing delegates.
- `backfillBoundaryLeaderDefaults` writes the same Leader/delegate snapshot to active sessions that do not yet have one.
- It must not invent a Leader when both reviewer and driver are absent; report those item ids in `blocked_item_ids`.
- Create synthetic round 1 when no rounds exist.
- Attach old session arrays to round 1.
- Keep `approved` status only when new required fields can be populated.
- Downgrade unsafe approved rows to `draft` or `superseded` and report ids.

- [ ] **Step 6: Run repository tests**

Run:

```bash
pnpm vitest run tests/db/brainstorming-repository.test.ts tests/api/brainstorming.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS after updating existing API fixtures for new required fields.

- [ ] **Step 7: Commit Task 2**

```bash
git add packages/db/src/schema/development-plan.ts packages/db/src/schema/brainstorming.ts packages/db/src/repositories/delivery-repository.ts packages/db/src/repositories/in-memory-delivery-repository.ts packages/db/src/repositories/drizzle-delivery-repository.ts tests/db/brainstorming-repository.test.ts tests/api/brainstorming.test.ts tests/helpers
git commit -m "feat: persist boundary brainstorming rounds"
```

---

### Task 3: Boundary Brainstorming API And Leader-Governed Process

**Files:**
- Modify: `apps/control-plane-api/src/modules/brainstorming/brainstorming.controller.ts`
- Modify: `apps/control-plane-api/src/modules/brainstorming/brainstorming.service.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation.dto.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation-action.service.ts`
- Test: `tests/api/brainstorming.test.ts`

- [ ] **Step 1: Write failing API tests for Leader resolution and delegate escalation**

Add tests covering:

- start with explicit Leader and delegates stores them on the item and session;
- non-Leader cannot add themselves as delegate in start request when item already has delegates;
- non-Leader cannot add themselves as delegate when the item has no existing Leader/delegates and the same request names another actor as Leader;
- non-Leader cannot answer, decide, continue, approve, or request changes;
- Leader/delegate changes to item after session start do not silently alter the session snapshot.

Example assertion:

```ts
await request(server)
  .post(`/development-plans/${plan.id}/items/${item.id}/boundary-brainstorming`)
  .send({
    actor_id: 'actor-random',
    leader_actor_id: 'actor-leader',
    leader_delegate_actor_ids: ['actor-random'],
  })
  .expect(403);
```

- [ ] **Step 2: Write failing API tests for multi-round AI process**

Mock the runtime scheduling boundary and verify:

- start creates round 1 and action type `run_boundary_brainstorming_round`;
- terminal result creates required questions and puts session into `waiting_for_leader`;
- Leader answer plus continue creates round 2;
- round 2 can propose a Boundary Summary revision;
- request changes supersedes/rejects proposal and creates another round;
- approval requires all required questions answered or waived.

- [ ] **Step 3: Run failing brainstorming API tests**

Run:

```bash
pnpm vitest run tests/api/brainstorming.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because routes and round scheduling are not implemented.

- [ ] **Step 4: Add new route schemas and aliases**

In `brainstorming.controller.ts`, add:

```ts
@Post('development-plans/:developmentPlanId/items/:itemId/boundary-brainstorming')
startBoundaryBrainstorming(...)

@Post('boundary-brainstorming-sessions/:sessionId/answers')
answerBoundaryQuestion(...)

@Post('boundary-brainstorming-sessions/:sessionId/decisions')
recordBoundaryDecision(...)

@Post('boundary-brainstorming-sessions/:sessionId/continue')
continueBoundaryBrainstorming(...)

@Post('boundary-brainstorming-sessions/:sessionId/summary-revisions/:revisionId/approve')
approveBoundarySummaryRevision(...)

@Post('boundary-brainstorming-sessions/:sessionId/summary-revisions/:revisionId/request-changes')
requestBoundarySummaryChanges(...)
```

Keep current `/brainstorming-sessions/*` routes as compatibility aliases only if existing tests still require them.

- [ ] **Step 5: Add action input schemas**

In `automation.dto.ts`, add input schemas:

```ts
import { sourceObjectRefSchema } from '@forgeloop/contracts';

const productGenerationPreconditionFingerprintJsonSchema = z.object({
  source_object_ref: sourceObjectRefSchema,
  source_object_revision_id: nonBlankString,
  development_plan_id: nonBlankString,
  development_plan_revision_id: nonBlankString,
  development_plan_item_id: nonBlankString,
  development_plan_item_revision_id: nonBlankString,
  boundary_session_id: nonBlankString.optional(),
  boundary_session_revision_id: nonBlankString.optional(),
  boundary_round_id: nonBlankString.optional(),
  approved_boundary_summary_revision_id: nonBlankString.optional(),
  approved_spec_revision_id: nonBlankString.optional(),
  context_manifest_id: nonBlankString,
  context_manifest_revision_id: nonBlankString,
  requested_by_actor_id: nonBlankString,
}).strict();

const boundaryRoundActionInputSchema = z.object({
  development_plan_id: nonBlankString,
  development_plan_revision_id: nonBlankString,
  development_plan_item_id: nonBlankString,
  development_plan_item_revision_id: nonBlankString,
  session_id: nonBlankString,
  session_revision_id: nonBlankString,
  round_id: nonBlankString,
  operation: z.enum(['start', 'continue', 'revise_summary']),
  context_manifest_id: nonBlankString,
  context_manifest_revision_id: nonBlankString,
  requested_by_actor_id: nonBlankString,
  precondition_fingerprint_json: productGenerationPreconditionFingerprintJsonSchema.extend({
    boundary_session_id: nonBlankString,
    boundary_session_revision_id: nonBlankString,
    boundary_round_id: nonBlankString,
  }).strict(),
}).strict();

const generateDevelopmentPlanItemSpecRevisionActionInputSchema = z.object({
  development_plan_id: nonBlankString,
  development_plan_revision_id: nonBlankString,
  development_plan_item_id: nonBlankString,
  development_plan_item_revision_id: nonBlankString,
  boundary_session_id: nonBlankString,
  boundary_session_revision_id: nonBlankString,
  approved_boundary_summary_revision_id: nonBlankString,
  context_manifest_id: nonBlankString,
  context_manifest_revision_id: nonBlankString,
  requested_by_actor_id: nonBlankString,
  precondition_fingerprint_json: productGenerationPreconditionFingerprintJsonSchema.extend({
    boundary_session_id: nonBlankString,
    boundary_session_revision_id: nonBlankString,
    approved_boundary_summary_revision_id: nonBlankString,
  }).strict(),
}).strict();

const generateDevelopmentPlanItemExecutionPlanRevisionActionInputSchema = z.object({
  development_plan_id: nonBlankString,
  development_plan_revision_id: nonBlankString,
  development_plan_item_id: nonBlankString,
  development_plan_item_revision_id: nonBlankString,
  boundary_session_id: nonBlankString,
  boundary_session_revision_id: nonBlankString,
  approved_boundary_summary_revision_id: nonBlankString,
  approved_spec_revision_id: nonBlankString,
  context_manifest_id: nonBlankString,
  context_manifest_revision_id: nonBlankString,
  requested_by_actor_id: nonBlankString,
  precondition_fingerprint_json: productGenerationPreconditionFingerprintJsonSchema.extend({
    boundary_session_id: nonBlankString,
    boundary_session_revision_id: nonBlankString,
    approved_boundary_summary_revision_id: nonBlankString,
    approved_spec_revision_id: nonBlankString,
  }).strict(),
}).strict();
```

Extend `createAutomationActionRunSchema` and `claimNextAutomationActionRunSchema` action type enum with the three new action types, and dispatch each action type to exactly one input schema. The existing top-level `precondition_fingerprint: string` remains the canonical digest over `action_input_json.precondition_fingerprint_json`; do not replace it with an object. Add tests that reject missing `precondition_fingerprint_json` for all three action types, stale `development_plan_item_revision_id`, missing `boundary_round_id` on Boundary Brainstorming, missing `approved_boundary_summary_revision_id` on Spec generation, missing `approved_spec_revision_id` on Execution Plan generation, and a top-level `precondition_fingerprint` that does not match the canonical digest of `precondition_fingerprint_json`.

- [ ] **Step 6: Implement Leader resolution**

In `brainstorming.service.ts`, add a helper:

```ts
private resolveLeader(input: {
  item: DevelopmentPlanItem;
  actorId: string;
  canAdministerItem?: boolean;
  requestedLeaderActorId?: string;
  requestedDelegateActorIds?: string[];
}): { leader_actor_id: string; leader_delegate_actor_ids: string[]; updatedItem?: DevelopmentPlanItem } {
  const existingLeader = input.item.leader_actor_id;
  const existingDelegates = input.item.leader_delegate_actor_ids ?? [];
  const requestedDelegates = input.requestedDelegateActorIds ?? existingDelegates;
  const canChangeLeader = input.canAdministerItem === true;
  if (existingLeader !== undefined && input.requestedLeaderActorId !== undefined && input.requestedLeaderActorId !== existingLeader && !canChangeLeader) {
    throw new ForbiddenException('Boundary Leader cannot be changed by this request');
  }
  const requestedLeader = input.requestedLeaderActorId ?? existingLeader ?? input.item.reviewer_actor_id ?? input.item.driver_actor_id;
  const actorIsRequestedLeader = requestedLeader === input.actorId;
  const canChangeDelegates = input.canAdministerItem === true || input.actorId === existingLeader || actorIsRequestedLeader;
  if (input.requestedDelegateActorIds !== undefined && !sameStringSet(existingDelegates, requestedDelegates) && !canChangeDelegates) {
    throw new ForbiddenException('Boundary delegates cannot be changed by this request');
  }
  if (
    input.requestedDelegateActorIds?.includes(input.actorId) === true &&
    !actorIsRequestedLeader &&
    input.actorId !== existingLeader &&
    input.canAdministerItem !== true
  ) {
    throw new ForbiddenException('Boundary delegate self-escalation is not allowed');
  }
  const leader = requestedLeader;
  if (leader === undefined) {
    throw new BadRequestException('Boundary Leader is required');
  }
  return { leader_actor_id: leader, leader_delegate_actor_ids: requestedDelegates };
}
```

- [ ] **Step 7: Implement round creation and runtime scheduling**

Create private helpers in `brainstorming.service.ts`:

- `createBoundaryRound(...)`
- `createBoundaryActionRun(...)`
- `createBoundaryRuntimeJob(...)`
- `applyBoundaryRoundTerminalResult(...)`

Use action type `run_boundary_brainstorming_round`, `target_type: 'automation_action_run'`, and runtime job input schema `boundary_brainstorming_round.v1`.

- [ ] **Step 8: Implement required-question closure**

Approval must call `requiredBoundaryQuestionsClosed` over persisted rows. It must not trust session status alone.

- [ ] **Step 9: Run targeted API tests**

Run:

```bash
pnpm vitest run tests/api/brainstorming.test.ts tests/contracts/project-management-contracts.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 10: Commit Task 3**

```bash
git add apps/control-plane-api/src/modules/brainstorming apps/control-plane-api/src/modules/automation tests/api/brainstorming.test.ts
git commit -m "feat: add leader governed boundary brainstorming"
```

---

### Task 4: Runtime Import APIs, Import CLI, And Unsafe DB Gate

**Files:**
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.controller.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
- Create: `scripts/codex-runtime-import.ts`
- Modify: `scripts/codex-runtime-dogfood-bootstrap.ts`
- Test: `tests/api/codex-runtime-import.test.ts`
- Test: `tests/api/codex-runtime-control-plane.test.ts`

- [ ] **Step 1: Write failing import API tests**

Create tests proving:

- `POST /internal/codex-runtime/import-profile` accepts raw TOML content and returns profile/revision ids and digests.
- `POST /internal/codex-runtime/import-credential` rejects without `FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE=1`.
- import credential rejects without `unsafe_db_acknowledgement: true`.
- `POST /internal/codex-runtime/import-local-codex` accepts explicit `codex_config_toml` and `auth_json` content, marks the source as local import, and returns only ids/digests.
- import local Codex rejects `provider: 'unsafe_db'` in `NODE_ENV=production`.
- import local Codex succeeds in local dogfood mode when the unsafe DB flag and acknowledgement are both present.
- public result does not include raw TOML or auth JSON.
- public result does not include host paths such as `~/.codex/config.toml` or `~/.codex/auth.json`.
- materialization rejects unsafe DB credentials if the server-side unsafe flag is off.

- [ ] **Step 2: Run failing import tests**

Run:

```bash
pnpm vitest run tests/api/codex-runtime-import.test.ts tests/api/codex-runtime-control-plane.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because import endpoints do not exist and acknowledgement is missing.

- [ ] **Step 3: Add DTO schemas**

In `codex-runtime.dto.ts`, add:

```ts
export const importCodexRuntimeProfileSchema = z.object({
  profile_name: z.string().min(1),
  target_kind: runtimeTargetKindSchema,
  codex_config_toml: z.string().min(1),
  project_id: z.string().min(1),
  repo_id: z.string().min(1).optional(),
  docker_image: z.string().min(1),
  docker_image_digest: sha256DigestSchema,
  expected_effective_config_digest: sha256DigestSchema,
  allowed_scopes: z.array(scopeSchema).min(1),
  network_policy: networkPolicySchema,
  created_by: actorSchema,
}).strict();

export const importCodexCredentialSchema = z.object({
  profile_id: z.string().min(1),
  project_id: z.string().min(1),
  repo_id: z.string().min(1).optional(),
  purpose: z.enum(['model_provider', 'package_registry', 'git_remote', 'other']),
  auth_json: z.unknown(),
  provider: z.literal('unsafe_db'),
  unsafe_db_acknowledgement: z.literal(true),
  created_by: actorSchema,
}).strict();

export const importLocalCodexSchema = z.object({
  profile_name: z.string().min(1),
  target_kind: runtimeTargetKindSchema,
  local_source_label: z.string().min(1),
  codex_config_toml: z.string().min(1),
  auth_json: z.unknown(),
  project_id: z.string().min(1),
  repo_id: z.string().min(1).optional(),
  docker_image: z.string().min(1),
  docker_image_digest: sha256DigestSchema,
  expected_effective_config_digest: sha256DigestSchema,
  allowed_scopes: z.array(scopeSchema).min(1),
  network_policy: networkPolicySchema,
  provider: z.literal('unsafe_db'),
  unsafe_db_acknowledgement: z.literal(true),
  created_by: actorSchema,
}).strict();
```

- [ ] **Step 4: Add controller endpoints**

Add routes under `TrustedCodexRuntimeSetupGuard`:

```ts
@Post('/internal/codex-runtime/import-profile')
importProfile(...) { return this.service.importProfile(body); }

@Post('/internal/codex-runtime/import-credential')
importCredential(...) { return this.service.importCredential(body); }

@Post('/internal/codex-runtime/import-local-codex')
importLocalCodex(...) { return this.service.importLocalCodex(body); }
```

- [ ] **Step 5: Implement service import logic**

In `codex-runtime.service.ts`:

- `importProfile` computes `codex_config_digest` from supplied TOML.
- Profile revision uses supplied TOML, never hardcoded defaults.
- `importCredential` calls `requireUnsafeDbCredentialStore()` and rejects unless acknowledgement is true.
- `importLocalCodex` validates the same unsafe DB gate and acknowledgement, then calls the same `importProfile` and `importCredential` internals in one transaction.
- `importLocalCodex` records import-source metadata as `{ kind: 'local_codex_import', label, imported_by_actor_id }`; it must never persist, log, or return a worker/host filesystem path.
- `importLocalCodex` returns only profile ids, revision ids, credential binding ids, credential version ids, and digests.
- Add production guard:

```ts
if (process.env.NODE_ENV === 'production') {
  throw new ForbiddenException('unsafe_db Codex credentials are rejected in production');
}
```

- Return only public-safe ids/digests.

- [ ] **Step 6: Implement operator CLI**

Create `scripts/codex-runtime-import.ts` with:

- `--config-path`
- `--auth-path`
- `--from-local-codex-home`
- `--unsafe-db-acknowledgement`
- explicit POSTs to import APIs using setup signing.

The CLI may read `~/.codex` only when `--from-local-codex-home` is present, and even then it must POST file contents plus a source label to `POST /internal/codex-runtime/import-local-codex`. The worker and runtime jobs must never receive host `~/.codex` paths.

- [ ] **Step 7: Update bootstrap script**

Modify `scripts/codex-runtime-dogfood-bootstrap.ts`:

- add `FORGELOOP_CODEX_CONFIG_TOML_PATH`;
- parse config TOML with the same protected-file rules as auth;
- call import endpoints;
- pass `unsafe_db_acknowledgement: true`;
- remove hardcoded `const codexConfigToml = 'approval_policy = "never"\n';`.

- [ ] **Step 8: Run import tests**

Run:

```bash
pnpm vitest run tests/api/codex-runtime-import.test.ts tests/api/codex-runtime-control-plane.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

```bash
git add apps/control-plane-api/src/modules/codex-runtime scripts/codex-runtime-import.ts scripts/codex-runtime-dogfood-bootstrap.ts tests/api/codex-runtime-import.test.ts tests/api/codex-runtime-control-plane.test.ts
git commit -m "feat: import codex runtime config and auth"
```

---

### Task 5: Generation Workload Schemas, Runtime Methods, And Worker Dispatch

**Files:**
- Modify: `packages/domain/src/codex-runtime.ts`
- Modify: `packages/codex-runtime/src/types.ts`
- Modify: `packages/codex-runtime/src/payloads.ts`
- Modify: `packages/codex-runtime/src/runtime.ts`
- Modify: `packages/codex-runtime/src/fake-driver.ts`
- Modify: `packages/codex-worker-runtime/src/remote-worker-client.ts`
- Test: `tests/domain/codex-runtime.test.ts`
- Test: `tests/codex-runtime/payloads.test.ts`
- Test: `tests/codex-runtime/runtime.test.ts`
- Test: `tests/codex-worker-runtime/remote-worker-client.test.ts`

- [x] **Step 1: Write failing payload and domain tests**

Add tests for:

- `boundary_brainstorming_round` terminal result validation.
- `development_plan_item_spec_revision` terminal result validation.
- `development_plan_item_execution_plan_revision` terminal result validation.
- public-safe rejection for raw config/auth/path/endpoints/log fields.
- unknown worker task kind does not call `generatePackageDrafts`.

- [x] **Step 2: Run failing runtime tests**

Run:

```bash
pnpm vitest run tests/domain/codex-runtime.test.ts tests/codex-runtime/payloads.test.ts tests/codex-worker-runtime/remote-worker-client.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because task kinds and validators are missing.

- [x] **Step 3: Extend domain runtime task kinds**

In `packages/domain/src/codex-runtime.ts`, change:

```ts
export type CodexGenerationTaskKind =
  | 'spec_draft'
  | 'plan_draft'
  | 'package_drafts'
  | 'boundary_brainstorming_round'
  | 'development_plan_item_spec_revision'
  | 'development_plan_item_execution_plan_revision';
```

Update `CodexGenerationWorkloadV1.task_kind`, `CodexGenerationRuntimeJobResult.task_kind`, and `requireCodexGenerationRuntimeJobResult`.

- [x] **Step 4: Add codex-runtime payload interfaces and schemas**

In `packages/codex-runtime/src/types.ts`, add:

```ts
export interface BoundaryRoundRuntimeResultV1 {
  schema_version: 'boundary_round_result.v1';
  session_id: string;
  round_id: string;
  questions: Array<{ text: string; required: boolean; rationale?: string }>;
  proposed_decisions: Array<{ text: string; rationale?: string }>;
  summary_proposal?: {
    summary_markdown: string;
    confirmed_scope: string[];
    confirmed_out_of_scope: string[];
    accepted_assumptions: string[];
    open_risks: string[];
    validation_expectations: string[];
  };
  needs_leader_input: boolean;
  public_summary: string;
  artifacts: ArtifactRef[];
}
```

Add `GeneratedSpecRevisionV1` and `GeneratedExecutionPlanRevisionV1` exactly as in the spec.

- [x] **Step 5: Add payload validators**

In `payloads.ts`, add:

- `boundaryRoundRuntimeResultSchema`
- `generatedSpecRevisionSchema`
- `generatedExecutionPlanRevisionSchema`
- `validateBoundaryRoundRuntimeResult`
- `validateGeneratedSpecRevision`
- `validateGeneratedExecutionPlanRevision`

Use existing `assertPublicSafeText` / `assertPlanPublicSafeText` style checks. Reject `~/.codex`, `/tmp/...`, `endpoint`, `container_id`, `auth_json`, and raw logs in public fields.

- [x] **Step 6: Extend runtime methods**

In `runtime.ts`, add methods:

```ts
generateBoundaryBrainstormingRound: (input) =>
  generateWithAppServer('boundary_brainstorming_round', input, validateBoundaryRoundRuntimeResult),
generateDevelopmentPlanItemSpecRevision: (input) =>
  generateWithAppServer('development_plan_item_spec_revision', input, validateGeneratedSpecRevision),
generateDevelopmentPlanItemExecutionPlanRevision: (input) =>
  generateWithAppServer('development_plan_item_execution_plan_revision', input, validateGeneratedExecutionPlanRevision),
```

In fake mode, call deterministic fake builders.

- [x] **Step 7: Make worker dispatch exhaustive**

In `remote-worker-client.ts`, replace fallthrough with:

```ts
switch (workload.task_kind) {
  case 'spec_draft':
    return runtime.generateSpecDraft(input) as Promise<CodexGenerationResult<Record<string, unknown>>>;
  case 'plan_draft':
    return runtime.generatePlanDraft(input) as Promise<CodexGenerationResult<Record<string, unknown>>>;
  case 'package_drafts':
    return runtime.generatePackageDrafts(input) as Promise<CodexGenerationResult<Record<string, unknown>>>;
  case 'boundary_brainstorming_round':
    return runtime.generateBoundaryBrainstormingRound(input) as Promise<CodexGenerationResult<Record<string, unknown>>>;
  case 'development_plan_item_spec_revision':
    return runtime.generateDevelopmentPlanItemSpecRevision(input) as Promise<CodexGenerationResult<Record<string, unknown>>>;
  case 'development_plan_item_execution_plan_revision':
    return runtime.generateDevelopmentPlanItemExecutionPlanRevision(input) as Promise<CodexGenerationResult<Record<string, unknown>>>;
  default:
    return assertNeverGenerationTaskKind(workload.task_kind);
}
```

Also update workload validation to allow the three new task kinds.

- [x] **Step 8: Run runtime tests**

Run:

```bash
pnpm vitest run tests/domain/codex-runtime.test.ts tests/codex-runtime/payloads.test.ts tests/codex-runtime/runtime.test.ts tests/codex-worker-runtime/remote-worker-client.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [x] **Step 9: Commit Task 5**

```bash
git add packages/domain/src/codex-runtime.ts packages/codex-runtime/src packages/codex-worker-runtime/src/remote-worker-client.ts tests/domain/codex-runtime.test.ts tests/codex-runtime tests/codex-worker-runtime/remote-worker-client.test.ts
git commit -m "feat: add superpowers generation runtime tasks"
```

---

### Task 6: Product Generation Result Writers And API Command Flow

**Files:**
- Modify: `apps/control-plane-api/src/modules/brainstorming/brainstorming.service.ts`
- Modify: `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`
- Modify: `apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
- Create: `apps/control-plane-api/src/modules/automation/product-generation-result.service.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation.module.ts`
- Test: `tests/api/spec-plan-service.test.ts`
- Test: `tests/api/brainstorming.test.ts`
- Test: `tests/api/codex-runtime-control-plane.test.ts`

- [x] **Step 1: Write failing product result writer tests**

Add tests proving:

- terminal boundary round result writes questions/decisions/proposed summary to product rows;
- stale action run stores evidence but does not mutate product state;
- Spec generation terminal result creates a draft Spec revision only from approved Boundary Summary revision;
- Spec generation terminal result with a mismatched `precondition_fingerprint_json.development_plan_item_revision_id` or `approved_boundary_summary_revision_id` stores evidence but does not create a Spec revision;
- Execution Plan generation terminal result creates a draft Execution Plan revision only from approved Spec revision;
- Execution Plan generation terminal result with a mismatched `precondition_fingerprint_json.approved_spec_revision_id`, item revision, or approved Boundary Summary revision stores evidence but does not create an Execution Plan revision;
- generated revisions are not auto-approved.

- [x] **Step 2: Run failing result writer tests**

Run:

```bash
pnpm vitest run tests/api/spec-plan-service.test.ts tests/api/brainstorming.test.ts tests/api/codex-runtime-control-plane.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because result writer orchestration is missing.

- [x] **Step 3: Create product generation result service**

Create `product-generation-result.service.ts` with:

```ts
@Injectable()
export class ProductGenerationResultService {
  async handleGenerationRuntimeTerminal(input: {
    runtimeJobId: string;
    actionRunId: string;
    terminalResult: CodexGenerationRuntimeJobResult;
  }): Promise<{ applied: boolean; reason?: string }> {
    switch (input.terminalResult.task_kind) {
      case 'boundary_brainstorming_round':
        return this.applyBoundaryRoundResult(input);
      case 'development_plan_item_spec_revision':
        return this.applySpecRevisionResult(input);
      case 'development_plan_item_execution_plan_revision':
        return this.applyExecutionPlanRevisionResult(input);
      default:
        return { applied: false, reason: 'legacy_generation_task_kind' };
    }
  }
}
```

Inject `DeliveryRepository`, `BrainstormingService`, and `SpecPlanService` or extract writer methods into smaller services if circular dependencies appear.

- [x] **Step 4: Add writer methods to BrainstormingService**

Add:

- `applyBoundaryRoundRuntimeResult(...)`
- `approveBoundarySummaryRevision(...)`
- `requestBoundarySummaryRevisionChanges(...)`
- `continueBoundaryBrainstorming(...)`

Each writer must re-read action run, item, session, and precondition fingerprint before mutation.

- [x] **Step 5: Add generated revision writers to SpecPlanService**

Add:

```ts
type ProductGenerationApplyResult<T> =
  | { applied: true; revision: T }
  | { applied: false; reason: 'stale_precondition_fingerprint' | 'invalid_precondition' | 'public_unsafe_payload' };

writeGeneratedItemSpecRevision(input: {
  action_run_id: string;
  generated: GeneratedSpecRevisionV1;
  runtime_job_id: string;
  actor_id?: string;
}): Promise<ProductGenerationApplyResult<SpecRevision>>
```

and:

```ts
writeGeneratedItemExecutionPlanRevision(input: {
  action_run_id: string;
  generated: GeneratedExecutionPlanRevisionV1;
  runtime_job_id: string;
  actor_id?: string;
}): Promise<ProductGenerationApplyResult<ExecutionPlanRevision>>
```

Both methods must:

- re-check item revision;
- re-check approved Boundary Summary / Spec revision;
- verify top-level `actionRun.precondition_fingerprint` equals the canonical digest of `action_input_json.precondition_fingerprint_json`, then compare `precondition_fingerprint_json` against the currently loaded source object revision, Development Plan revision, Development Plan Item revision, approved Boundary Summary revision, approved Spec revision when applicable, and context manifest revision;
- return `{ applied: false, reason: 'stale_precondition_fingerprint' }` after storing terminal evidence if any fingerprint member differs;
- write draft revision;
- for `GeneratedExecutionPlanRevisionV1`, persist `implementation_sequence`, `validation_strategy`, `allowed_paths`, `forbidden_paths`, `required_checks`, `rollback_notes`, and `handoff_criteria` into `ExecutionPlanRevision.structured_document` in addition to rendering `content_markdown`; Task 7 must not have to re-parse markdown to recover these fields;
- update Development Plan Item status to `draft`;
- record object events;
- reject raw runtime evidence in public fields.

- [x] **Step 6: Wire terminalization to writer**

In `codex-runtime.service.ts`, after `repository.terminalizeCodexRuntimeJob`, call result writer only for:

```ts
runtimeJob.target_type === 'automation_action_run' &&
runtimeJob.target_kind === 'generation' &&
input.terminal_status === 'succeeded' &&
input.terminal_result_json !== undefined
```

Never bypass the worker-authenticated terminal endpoint.

- [x] **Step 7: Add product generate endpoints**

In `spec-plan.controller.ts`, ensure endpoints:

- `POST /development-plans/:developmentPlanId/items/:itemId/spec-revisions/generate`
- `POST /development-plans/:developmentPlanId/items/:itemId/execution-plan-revisions/generate`

These should schedule action run + runtime job. If existing endpoints generate synchronous drafts, keep them as compatibility helpers but route strict dogfood through runtime-backed endpoints.

The Spec generation endpoint must create an `AutomationActionRun` with `action_type: 'generate_development_plan_item_spec_revision'` and `action_input_json` matching `generateDevelopmentPlanItemSpecRevisionActionInputSchema`, including the approved Boundary Summary revision id and full `precondition_fingerprint_json`; the top-level `precondition_fingerprint` must be the digest of that JSON. The Execution Plan generation endpoint must create `action_type: 'generate_development_plan_item_execution_plan_revision'` with `action_input_json` matching `generateDevelopmentPlanItemExecutionPlanRevisionActionInputSchema`, including both approved Boundary Summary and approved Spec revision ids. Add controller/service tests that inspect the created action run input before the runtime job is claimed.

- [x] **Step 8: Run targeted product generation tests**

Run:

```bash
pnpm vitest run tests/api/brainstorming.test.ts tests/api/spec-plan-service.test.ts tests/api/codex-runtime-control-plane.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [x] **Step 9: Commit Task 6**

```bash
git add apps/control-plane-api/src/modules/automation apps/control-plane-api/src/modules/brainstorming apps/control-plane-api/src/modules/spec-plan apps/control-plane-api/src/modules/codex-runtime tests/api/brainstorming.test.ts tests/api/spec-plan-service.test.ts tests/api/codex-runtime-control-plane.test.ts
git commit -m "feat: apply product generation runtime results"
```

---

### Task 7: Product Execution Bridge And No-Shared-Filesystem Worker Evidence

**Files:**
- Modify: `apps/control-plane-api/src/modules/executions/executions.service.ts`
- Modify: `apps/control-plane-api/src/modules/executions/executions.module.ts`
- Modify: `apps/control-plane-api/src/modules/execution-packages/execution-package.service.ts`
- Modify: `apps/control-plane-api/src/modules/run-control/run-control.service.ts`
- Modify: `packages/db/src/schema/execution-supervision.ts`
- Modify: `packages/codex-worker-runtime/src/workspace-bundle.ts`
- Modify: `packages/codex-worker-runtime/src/workspace-isolation.ts`
- Modify: `packages/codex-worker-runtime/src/remote-worker-client.ts`
- Modify: `scripts/codex-remote-worker-dogfood.ts`
- Test: `tests/api/executions.test.ts`
- Test: `tests/api/execution-package-service.test.ts`
- Test: `tests/db/repository.test.ts`
- Test: `tests/db/schema.test.ts`
- Test: `tests/codex-worker-runtime/workspace-bundle.test.ts`
- Test: `tests/codex-worker-runtime/workspace-isolation.test.ts`

- [x] **Step 1: Write failing execution bridge tests**

Add tests proving:

- `startExecution` fails without approved current Execution Plan revision.
- internal package policy derives `allowed_paths`, `forbidden_paths`, required checks, and objective from approved Execution Plan revision.
- product Execution response includes required `approved_spec_revision_id` / `approved_spec_revision_ref` and approved `execution_plan_revision_ref`.
- product Execution response does not expose raw package/run ids as primary public identity.
- `startExecution` creates or reuses the execution package, enqueues a `RunSession` through `RunControlService.enqueueRunWithRepository(...)`, and stores the run session as runtime evidence after it exists.
- with remote run runtime enabled, the queued run path creates a `run_execution` Codex runtime job for the run session.
- docs-only dogfood plan without `docs/**` allowlist fails before launch.

- [x] **Step 2: Write failing no-shared-filesystem worker tests**

Add tests proving:

- no-shared-filesystem mode rejects `FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS`;
- worker run execution downloads workspace bundle from control-plane endpoint;
- mounted task workspace digest matches bundle manifest digest;
- report includes archive/manifest/mounted workspace digests and no local repo path.

- [x] **Step 3: Run failing execution tests**

Run:

```bash
pnpm vitest run tests/api/executions.test.ts tests/api/execution-package-service.test.ts tests/db/repository.test.ts tests/db/schema.test.ts tests/codex-worker-runtime/workspace-bundle.test.ts tests/codex-worker-runtime/workspace-isolation.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL until bridge and worker evidence are tightened.

- [x] **Step 4: Tighten product Execution linkage**

Using the required `Execution` fields added in Task 1, update `executions.service.ts` to make the approved Spec revision chain explicit:

- `executionSchema` requires `approved_spec_revision_id`.
- `executionSchema` includes `approved_spec_revision_ref: { type: 'spec_revision'; id: string; spec_id: string; title?: string }`.
- `buildExecution(...)` sets both from the approved current Spec revision already loaded by `requireApprovedExecutionPlanContext(...)`.
- `evidence_refs` includes the approved Spec revision and approved Execution Plan revision.
- `runtime_evidence_refs` includes execution package and run session refs only after those internal records exist.

Do not make `approved_spec_revision_id` optional, and do not hide the approved Spec chain only in generic evidence refs. Public DTOs must keep `Execution` as identity while exposing the approved Spec/Execution Plan chain as product fields.

- [x] **Step 5: Persist Execution linkage in DB schema and repository fixtures**

In `packages/db/src/schema/execution-supervision.ts`, add columns:

```ts
import { spec_revisions } from './spec';

approvedSpecRevisionId: uuid('approved_spec_revision_id').notNull().references(() => spec_revisions.id),
approvedSpecRevisionRef: jsonb('approved_spec_revision_ref').$type<Execution['approved_spec_revision_ref']>().notNull(),
```

Update Drizzle/in-memory repository fixtures and `tests/db/repository-contract.ts` so `saveExecution` / `getExecution` round-trip the required approved Spec fields. Add `tests/db/schema.test.ts` coverage for the new `executions.approved_spec_revision_id` and `executions.approved_spec_revision_ref` columns. This catches contract/schema drift before API tests.

For existing execution rows, add a migration/backfill that loads each execution's `execution_plan_revision_id`, reads `ExecutionPlanRevision.based_on_spec_revision_id`, and writes `approved_spec_revision_id` / `approved_spec_revision_ref` before enforcing non-null constraints. If the chain cannot be reconstructed, the migration must fail loudly rather than inventing a Spec revision.

- [x] **Step 6: Bridge Start Execution into run runtime**

In `executions.module.ts`, import `RunControlModule` so `ExecutionsService` can inject `RunControlService`.

In `executions.service.ts`, after creating or reusing the execution package inside the same object lock, call:

```ts
const run = await this.runControlService.enqueueRunWithRepository(repository, executionPackage, {
  actorContext: actorContextFromExecutionCommand(dto),
  automationPrecondition: {},
  executorType: 'local_codex',
  workflowOnly: false,
});
```

Then:

- add a small local helper that maps the product command actor to `ActorContext` without requiring raw auth headers in this service;
- save the product `Execution` with a runtime evidence ref for the execution package;
- after `enqueueRunWithRepository` returns, add a run-session runtime evidence ref and keep `Execution.status = 'running'`;
- keep duplicate start idempotent by returning the existing Execution and not enqueueing a second active run session;
- when remote run runtime is enabled, preserve the existing run worker path that turns the queued run session into a `target_type: 'run_session'`, `target_kind: 'run_execution'` runtime job.

- [x] **Step 7: Derive package policy from approved Execution Plan revision**

In `execution-package.service.ts`, parse `executionPlanRevision.structured_document` for:

```ts
{
  allowed_paths: string[];
  forbidden_paths: string[];
  required_checks: RequiredCheckSpec[];
  implementation_sequence: string[];
}
```

If structured fields are absent, derive conservative defaults from `content`, but strict dogfood must require structured fields and fail closed.

- [x] **Step 8: Add no-shared-filesystem worker mode**

In `scripts/codex-remote-worker-dogfood.ts`, add env:

```ts
FORGELOOP_CODEX_NO_SHARED_FILESYSTEM=1
```

When enabled:

- `allowedRepoRoots` must be empty;
- config/auth path env vars must be absent;
- the worker must depend on workspace bundle acquisition for run execution;
- public start summary prints only digests.

- [x] **Step 9: Add mounted workspace digest evidence**

In `remote-worker-client.ts` or workspace isolation helpers, compute digest over the mounted task workspace manifest and include it in run-execution terminal result public evidence:

```ts
workspace_bundle_digest: workload.workspace_bundle_digest,
workspace_bundle_manifest_digest: workspace.manifestDigest,
mounted_task_workspace_digest: workspace.mountedWorkspaceDigest,
```

Only include digests, never absolute paths.

- [x] **Step 10: Run targeted execution tests**

Run:

```bash
pnpm vitest run tests/api/executions.test.ts tests/api/execution-package-service.test.ts tests/db/repository.test.ts tests/db/schema.test.ts tests/codex-worker-runtime/workspace-bundle.test.ts tests/codex-worker-runtime/workspace-isolation.test.ts tests/codex-worker-runtime/remote-worker-client.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [x] **Step 11: Commit Task 7**

```bash
git add apps/control-plane-api/src/modules/executions apps/control-plane-api/src/modules/execution-packages apps/control-plane-api/src/modules/run-control packages/db/src/schema/execution-supervision.ts packages/codex-worker-runtime/src scripts/codex-remote-worker-dogfood.ts tests/api/executions.test.ts tests/api/execution-package-service.test.ts tests/db/repository-contract.ts tests/db/repository.test.ts tests/db/schema.test.ts tests/codex-worker-runtime
git commit -m "feat: harden execution bridge workspace isolation"
```

---

### Task 8: Strict Superpowers Dogfood Script, Guard Scripts, And Runbook Aliases

**Files:**
- Create: `scripts/codex-runtime-superpowers-dogfood.ts`
- Create: `scripts/check-codex-runtime-superpowers-no-baggage.ts`
- Create: `scripts/check-runbook-scripts.ts`
- Modify: `package.json`
- Modify: `docs/runbooks/codex-remote-worker-runtime.md`
- Modify: `apps/control-plane-api/src/modules/brainstorming/brainstorming.controller.ts`
- Modify: `apps/control-plane-api/src/modules/brainstorming/brainstorming.service.ts`
- Modify: `apps/control-plane-api/src/modules/development-plans/development-plans.controller.ts`
- Modify: `apps/control-plane-api/src/modules/development-plans/development-plans.service.ts`
- Modify: `packages/db/src/queries/project-management-queries.ts`
- Test: `tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts`
- Test: `tests/smoke/codex-runtime-no-baggage-gate.test.ts`
- Test: `tests/smoke/runbook-script-consistency.test.ts`
- Test: `tests/api/executions.test.ts`

- [x] **Step 1: Write failing guard tests**

Add smoke tests proving:

- `package.json` contains every required alias;
- runbook `pnpm <script>` entries exist in `package.json`;
- no-baggage gate flags active strict dogfood use of `/work-items`, `/tasks`, host `~/.codex` as worker setup, `exec_fallback`, or `codex exec`;
- allowlist entries must include owner/comment.

- [x] **Step 2: Write failing dogfood script test**

Mock API/worker boundaries and assert strict dogfood sequence:

1. import config/auth;
2. same-host generation worker smoke;
3. no-shared-filesystem run worker;
4. seed source object, Development Plan, Development Plan Item;
5. two Boundary Brainstorming AI rounds;
6. Leader answer;
7. Boundary Summary proposal;
8. mutate or supersede the Development Plan Item and verify Spec generation is blocked because the boundary is stale;
9. rebase or restart Boundary Brainstorming and capture the new session/revision evidence;
10. Boundary Summary approval;
11. Spec generation and approval;
12. Execution Plan generation and approval;
13. Execution from approved plan;
14. docs-only source change;
15. report under `docs/superpowers/reports/`.

- [x] **Step 3: Run failing smoke tests**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts tests/smoke/codex-runtime-no-baggage-gate.test.ts tests/smoke/runbook-script-consistency.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because scripts/aliases are missing.

- [x] **Step 4: Add `package.json` aliases**

Add:

```json
"codex:runtime:import": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-runtime-import.ts",
"codex:runtime:bootstrap": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-runtime-dogfood-bootstrap.ts",
"codex:remote-worker": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-remote-worker-dogfood.ts",
"dogfood:codex-runtime:superpowers": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-runtime-superpowers-dogfood.ts",
"check:codex-runtime-superpowers-no-baggage": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/check-codex-runtime-superpowers-no-baggage.ts",
"check:runbook-scripts": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/check-runbook-scripts.ts"
```

- [x] **Step 5: Implement runbook script checker**

`check-runbook-scripts.ts` should:

- read `package.json`;
- scan `docs/runbooks/*.md` for `pnpm <script>`;
- fail if script is not in `package.json`;
- print public-safe missing script names.

- [x] **Step 6: Implement no-baggage gate**

`check-codex-runtime-superpowers-no-baggage.ts` should run the focused scans from the spec and classify allowed matches.

Required allowlist entry shape:

```ts
type AllowedMatch = {
  file: string;
  pattern: string;
  owner: 'legacy-local-executor' | 'negative-test' | 'internal-runtime-storage' | 'historical-doc';
  reason: string;
};
```

Fail any match not covered by allowlist.

- [x] **Step 7: Implement strict dogfood driver**

`codex-runtime-superpowers-dogfood.ts` should orchestrate the product loop and write a report:

```ts
const report = {
  status: 'PASS',
  development_plan_item_id,
  boundary_brainstorming_session_id,
  boundary_summary_revision_id,
  spec_revision_id,
  execution_plan_revision_id,
  execution_id,
  runtime_profile_revision_digests,
  credential_binding_version_digests,
  no_shared_filesystem_worker: true,
  workspace_bundle_digest,
  mounted_task_workspace_digest,
  stale_boundary_negative_check: {
    blocked: true,
    blocker_code: 'STALE_BOUNDARY_SUMMARY',
    rebased_session_id,
    rebased_boundary_summary_revision_id,
  },
  changed_files,
};
```

The markdown report must use product object names and public-safe digests only.

- [x] **Step 8: Update runbook**

Update `docs/runbooks/codex-remote-worker-runtime.md`:

- add `FORGELOOP_CODEX_CONFIG_TOML_PATH`;
- replace missing aliases with required aliases;
- describe no-shared-filesystem worker mode;
- state local `~/.codex` is import-only.

- [x] **Step 9: Run smoke tests and gates**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts tests/smoke/codex-runtime-no-baggage-gate.test.ts tests/smoke/runbook-script-consistency.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm check:codex-runtime-superpowers-no-baggage
pnpm check:runbook-scripts
```

Expected: PASS.

- [x] **Step 10: Commit Task 8**

```bash
git add package.json apps/control-plane-api/src/modules/brainstorming/brainstorming.controller.ts apps/control-plane-api/src/modules/brainstorming/brainstorming.service.ts apps/control-plane-api/src/modules/development-plans/development-plans.controller.ts apps/control-plane-api/src/modules/development-plans/development-plans.service.ts packages/db/src/queries/project-management-queries.ts scripts/codex-runtime-superpowers-dogfood.ts scripts/check-codex-runtime-superpowers-no-baggage.ts scripts/check-runbook-scripts.ts docs/runbooks/codex-remote-worker-runtime.md tests/smoke tests/api/executions.test.ts
git commit -m "feat: add codex runtime superpowers dogfood"
```

---

### Task 9: End-To-End Verification And Baseline Flake Handling

**Files:**
- Modify only files needed to fix verification failures.
- Create report output under `docs/superpowers/reports/` only if strict dogfood succeeds and the report is intended to be committed.

- [x] **Step 1: Run product/API focused suite**

Run:

```bash
pnpm vitest run tests/contracts/project-management-contracts.test.ts tests/api/brainstorming.test.ts tests/api/spec-plan-service.test.ts tests/api/executions.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [x] **Step 2: Run runtime focused suite**

Run:

```bash
pnpm vitest run tests/api/codex-runtime*.test.ts tests/codex-runtime tests/codex-worker-runtime --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [x] **Step 3: Run guard scripts**

Run:

```bash
pnpm check:codex-runtime-superpowers-no-baggage
pnpm check:runbook-scripts
```

Expected: PASS.

- [ ] **Step 4: Run strict dogfood**

Run with real Codex app-server config/auth imported through the service path:

```bash
FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE=1 pnpm dogfood:codex-runtime:superpowers
```

Expected:

- PASS report under `docs/superpowers/reports/`;
- no CLI fallback;
- no worker-local `~/.codex`;
- no-shared-filesystem worker evidence present;
- stale-boundary negative check shows Spec generation was blocked before rebase/restart and then proceeded only from current Boundary Summary evidence;
- source-changing execution limited to the dogfood allowlist.

- [x] **Step 5: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

If `tests/automation/daemon.test.ts` fails with the known timing shape where an expected single sleep splits into `[999, 1]`, rerun the exact failing test in isolation before changing code:

```bash
pnpm vitest run tests/automation/daemon.test.ts -t "caps remote runtime job polling sleep to the configured wait deadline" --pool=forks --no-file-parallelism --maxWorkers=1
```

If the isolated rerun passes, document it as a baseline timing flake in the final implementation notes and do not change unrelated runtime code.

- [ ] **Step 6: Run diff hygiene**

Run:

```bash
git diff --check
git status --short --branch
```

Expected:

- `git diff --check` exits 0;
- only intended implementation files and dogfood report are changed.

- [ ] **Step 7: Final commit**

If Task 9 required fixes or report updates:

```bash
git status --short
git add docs/superpowers/reports
git commit -m "test: verify codex runtime superpowers dogfood"
```

If verification fixes changed implementation files, stage only those exact files shown by `git status --short` for the failed-check fix before committing. If no changes were needed, do not create an empty commit.

---

## Final Verification Checklist

- [ ] Contract and domain tests pass.
- [ ] Boundary Brainstorming API supports at least two AI rounds and a Leader answer round.
- [ ] Non-Leader self-add as delegate is rejected.
- [ ] Approved Boundary Summary revision requires round/question/answer/decision evidence.
- [ ] Spec generation is impossible without approved Boundary Summary revision.
- [ ] Execution Plan generation is impossible without approved Spec revision.
- [ ] Execution start is impossible without approved current Execution Plan revision.
- [ ] `config.toml` and `auth.json` import through centralized service storage.
- [ ] Unsafe DB credential import fails closed without env flag and acknowledgement.
- [ ] Worker materializes config/auth only under per-task `CODEX_HOME`.
- [ ] Worker does not read or mount host `~/.codex`.
- [ ] New generation task kinds dispatch to dedicated runtime methods.
- [ ] Unknown generation task kinds do not fall through to `generatePackageDrafts`.
- [ ] Strict dogfood uses Dockerized Codex app-server for every AI/runtime step.
- [ ] Strict dogfood includes no-shared-filesystem run-execution evidence.
- [ ] Dogfood report uses Development Plan Item, Boundary Brainstorming, Spec revision, Execution Plan revision, and Execution vocabulary.
- [ ] `pnpm check:codex-runtime-superpowers-no-baggage` passes.
- [ ] `pnpm check:runbook-scripts` passes.
- [ ] `pnpm dogfood:codex-runtime:superpowers` passes or reports a public-safe strict blocker.
- [ ] `pnpm test` passes, or any timing flake is isolated with rerun evidence.
- [ ] `git diff --check` passes.
