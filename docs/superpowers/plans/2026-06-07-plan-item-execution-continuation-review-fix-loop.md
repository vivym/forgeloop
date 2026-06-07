# Plan Item Execution Continuation Review Fix Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Wave 7 so a Plan Item Workflow can continue interrupted execution, ask Codex for read-only review responses, request same-session fix attempts, and explicitly abandon unsafe sessions without exposing raw runtime internals.

**Architecture:** Extend the existing Plan Item Workflow, CodexSession, queued-action, runtime-job, and run-execution paths instead of adding a parallel runner. Same-status product actions are persisted through `PlanItemWorkflowQueuedAction` terminalization plus command-specific `ObjectEvent` records, while code-mutating attempts use distinct `RunSession` rows and continuations of the same interrupted attempt use `ExecutionContinuationLineage`.

**Tech Stack:** TypeScript, pnpm, Vitest, NestJS control-plane API, Drizzle/Postgres, Zod contracts, React, ForgeLoop domain/db/runtime packages, Codex runtime worker, internal artifact store.

---

## Scope Check

This plan implements `docs/superpowers/specs/2026-06-07-plan-item-execution-continuation-review-fix-loop-design.md`.

In scope:

- `POST /plan-item-workflows/:workflowId/execution/continue`
- `POST /plan-item-workflows/:workflowId/code-review/respond`
- `POST /plan-item-workflows/:workflowId/code-review/request-fix`
- `POST /plan-item-workflows/:workflowId/recovery/abandon-and-new-session`
- New typed `ReviewResponse`, `ReviewPacketEvidenceRef`, `RunSessionAttemptLineage`, and `ExecutionContinuationLineage` records.
- Review response generation through `plan_item_workflow_action + generation`, not `automation_action_run`.
- Fix-loop run-execution workloads with previous attempt and Review Packet lineage.
- Stale terminalization hardening for workflow-owned continuation and fix attempts.
- Public-safe workflow DTO projections for attempt history, latest review response, and recovery options.
- Product UI lenses for execution continuation, code review, and recovery.
- Deterministic dogfood, optional credentialed real-runtime dogfood, no-baggage route checks.

Out of scope:

- Full fork creation or active fork selection.
- Inactive fork archival.
- Session scavenging or operator diagnostics.
- GitHub live review-thread synchronization.
- PR creation, merge, or release automation.
- QA automation beyond handoff readiness.
- Generic task extraction from Implementation Plan Doc checkbox content.

This is one large wave, but it is not several independent products: every task depends on the same session-continuity and lineage contract. Keep it one sequential plan.

## File Structure

### Contracts And Domain

- Modify `packages/contracts/src/plan-item-workflow.ts`
  - Add queued action kinds `continue_execution`, `respond_to_review`, `request_fix`.
  - Add manual decision kind `abandon_new_session`.
  - Add turn intent for code-mutating review fixes, for example `fix_review_feedback`.
  - Add public DTO projections for attempt history, latest review response, recovery options.
  - Add command body schemas for continue, respond, request-fix, abandon/new-session.
- Modify `packages/domain/src/plan-item-workflow.ts`
  - Add domain interfaces for `ReviewResponse`, `ReviewPacketEvidenceRef`, `RunSessionAttemptLineage`, `ExecutionContinuationLineage`.
  - Add `abandon_new_session` transition helper.
  - Add recoverability and fallback mapping helpers.
  - Extend public projection without raw runtime refs.
- Modify `packages/domain/src/codex-runtime.ts`
  - Add `CodexLaunchTarget.target_type = plan_item_workflow_action`.
  - Make `CodexGenerationWorkloadV1` discriminated by target type.
  - Add `review_response` generation task kind and `review_response.v1`.
  - Add fix-loop fields to `CodexRunExecutionWorkloadV1`.
- Modify `packages/domain/src/types.ts`
  - Re-export the new review response and evidence object types from the existing aggregate type export surface.
  - Extend `ReviewPacket` with `superseded_by_review_packet_id?: string` and `current_digest?: string`.
  - Add Wave 7 domain error codes such as `workflow_review_packet_not_current`, `workflow_review_packet_digest_mismatch`, `workflow_review_packet_evidence_unsafe`, and `workflow_execution_cancel_pending`.
- Test:
  - `tests/contracts/plan-item-workflow.test.ts`
  - `tests/domain/plan-item-workflow.test.ts`
  - `tests/domain/codex-runtime.test.ts`

### Database And Repository

- Modify `packages/db/src/schema/plan-item-workflow.ts`
  - Add Wave 7 stale terminalization fields to `codex_session_stale_terminalization_attempts`.
  - Add first-class workflow-action turn linkage, for example `codex_session_turns.plan_item_workflow_action_id`, so `respond_to_review` and continuation/fix turns never need `automationActionRunId`.
- Modify `packages/db/src/schema/review-packet.ts`
  - Add `review_packet_evidence_refs`.
  - Add `review_responses`.
- Modify `packages/db/src/schema/run-session.ts`
  - Add `run_session_attempt_lineages`.
  - Add `execution_continuation_lineages`.
- Modify `packages/db/src/schema/codex-runtime.ts`
  - Ensure launch leases and runtime jobs allow `target_type = plan_item_workflow_action`.
- Add generated migration under `packages/db/migrations/`.
- Modify `packages/db/src/repositories/delivery-repository.ts`
  - Add typed repository methods for the new records.
  - Add current Review Packet lookup that is not open-only.
  - Add plan-item-workflow-action generation fence methods.
- Modify `packages/db/src/repositories/in-memory-delivery-repository.ts`
  - Mirror all new repository methods and constraints.
- Modify `packages/db/src/repositories/drizzle-delivery-repository.ts`
  - Implement transactional persistence, idempotency, and lineage predicates.
- Test:
  - `tests/db/plan-item-workflow-repository.test.ts`
  - `tests/db/codex-runtime-repository.test.ts`

### Control-Plane API

- Modify `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts`
  - Add command DTO schemas.
- Modify `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.controller.ts`
  - Add the four Wave 7 routes.
- Modify `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts`
  - Implement current Review Packet selection and digest creation.
  - Implement continue execution, respond to review, request fix, and abandon/new-session.
  - Add same-status `ObjectEvent` writes without `PlanItemWorkflowTransition` rows.
  - Add public workflow projection options for attempt history, review response, and recovery options.
- Modify `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
  - Support terminalization of `plan_item_workflow_action + generation`.
  - Reject review response terminal results that contain mutation artifacts.
  - Harden stale terminalization writes.
- Modify `apps/control-plane-api/src/modules/codex-runtime/product-generation-runtime-scheduler.service.ts`
  - Add a dedicated scheduler method for `review_response` generation workloads for plan item workflow actions.
  - Own runtime-job and fence creation for review responses without creating or claiming `automation_action_run` records.
- Test:
  - `tests/api/plan-item-workflows.test.ts`
  - `tests/api/codex-runtime-control-plane.test.ts`
  - `tests/api/codex-runtime-product-generation-scheduler.test.ts`

### Worker Runtime

- Modify `packages/codex-worker-runtime/src/remote-worker-client.ts`
  - Accept discriminated review-response generation workloads.
  - Reject mutation artifacts for read-only review response.
  - Preserve latest capsule, memory bundle, and environment manifest on review response success.
  - Validate fix-loop lineage fields in run-execution workloads.
- Modify `apps/automation-daemon/src/generation-runtime.ts`
  - Emit `review_response.v1` payloads with no changed files or patch artifacts.
- Test:
  - `tests/codex-worker-runtime/remote-worker-client.test.ts`
  - `tests/smoke/plan-item-execution-continuation-review-fix-loop-dogfood-script.test.ts`

### Product UI

- Modify `apps/web/src/shared/api/types.ts`
  - Add command body and DTO projection types if not imported directly from contracts.
- Modify `apps/web/src/shared/api/commands.ts`
  - Add continue/respond/request-fix/abandon command functions.
- Modify `apps/web/src/shared/api/hooks.ts`
  - Add mutations and invalidation.
- Modify `apps/web/src/features/development-plans/plan-item-workflow-view-model.ts`
  - Map execution lens, code-review lens, attempt history, review response, and recovery actions.
- Modify `apps/web/src/features/development-plans/plan-item-workflow-workspace.tsx`
  - Render role-appropriate controls and disabled reasons.
- Test:
  - `tests/web/development-plan-routes.test.tsx`
  - `tests/web/api-client-contract.test.ts`
  - `tests/web/no-legacy-web-ui.test.ts`

### Dogfood And Guards

- Create `scripts/plan-item-execution-continuation-review-fix-loop-dogfood.ts`.
- Create `scripts/plan-item-execution-continuation-review-fix-loop-real-dogfood.ts`.
- Modify `package.json`.
- Modify `scripts/check-codex-runtime-superpowers-no-baggage.ts`.
- Test:
  - `tests/smoke/plan-item-execution-continuation-review-fix-loop-dogfood-script.test.ts`
  - `tests/smoke/codex-runtime-no-baggage-gate.test.ts`

## Task 1: Contracts And Domain Surface

**Files:**
- Modify: `packages/contracts/src/plan-item-workflow.ts`
- Modify: `packages/domain/src/plan-item-workflow.ts`
- Modify: `packages/domain/src/codex-runtime.ts`
- Modify: `packages/domain/src/types.ts`
- Test: `tests/contracts/plan-item-workflow.test.ts`
- Test: `tests/domain/plan-item-workflow.test.ts`
- Test: `tests/domain/codex-runtime.test.ts`

- [ ] **Step 1: Write failing contract tests for new action and decision enums**

Add tests to `tests/contracts/plan-item-workflow.test.ts`:

```ts
it('accepts Wave 7 queued action kinds and abandon decision kind', () => {
  for (const kind of ['continue_execution', 'respond_to_review', 'request_fix']) {
    expect(() =>
      planItemWorkflowQueuedActionSchema.parse({
        id: `action-${kind}`,
        workflow_id: 'workflow-1',
        kind,
        status: 'queued',
        context_preview_digest: `sha256:${'1'.repeat(64)}`,
        idempotency_key: `sha256:${'2'.repeat(64)}`,
        created_by_actor_id: 'actor-tech',
        created_at: '2026-06-07T00:00:00.000Z',
        updated_at: '2026-06-07T00:00:00.000Z',
      }),
    ).not.toThrow();
  }

  expect(() =>
    workflowManualDecisionSchema.parse({
      id: 'decision-abandon',
      workflow_id: 'workflow-1',
      kind: 'abandon_new_session',
      reason: 'The session cannot be resumed safely.',
      created_by_actor_id: 'actor-tech',
      created_at: '2026-06-07T00:00:00.000Z',
    }),
  ).not.toThrow();
});
```

- [ ] **Step 2: Write failing contract tests for public projection fields**

Add a test that `planItemWorkflowPublicDtoSchema` accepts:

```ts
attempt_history: [
  {
    run_session_id: 'run-1',
    attempt_kind: 'first_execution',
    status: 'succeeded',
    continuation_events: [
      {
        queued_action_id: 'action-continue-1',
        continuation_kind: 'relaunch_after_fencing',
        created_at: '2026-06-07T00:01:00.000Z',
      },
    ],
    created_at: '2026-06-07T00:00:00.000Z',
    updated_at: '2026-06-07T00:02:00.000Z',
  },
],
latest_review_response: {
  id: 'review-response-1',
  review_packet_id: 'review-packet-1',
  previous_run_session_id: 'run-1',
  status: 'succeeded',
  created_at: '2026-06-07T00:03:00.000Z',
},
recovery_options: [
  {
    action_id: 'continue_same_session',
    enabled: false,
    blocker_code: 'workflow_execution_writer_still_active',
    warning_copy: 'The current writer can still terminalize.',
    required_confirmation_kind: 'none',
  },
],
```

Also assert that adding `codex_thread_id`, capsule refs, memory refs, local paths, worker ids, or lease tokens throws.

- [ ] **Step 3: Run contract tests to verify failure**

Run:

```bash
pnpm test tests/contracts/plan-item-workflow.test.ts
```

Expected: FAIL because schemas do not yet include the Wave 7 enums and projection fields.

- [ ] **Step 4: Write failing domain transition and projection tests**

In `tests/domain/plan-item-workflow.test.ts`, add tests for:

- `mapQueuedActionKindToTurnIntent('respond_to_review') === 'address_review_feedback'`
- `mapQueuedActionKindToTurnIntent('request_fix') === 'fix_review_feedback'`
- same-status commands are not valid through `assertPlanItemWorkflowTransitionAllowed`
- `abandon_new_session` allows only `blocked -> deterministic target`
- `planItemWorkflowPublicProjection` includes attempt history/recovery options without raw refs

Use this key assertion:

```ts
expect(() =>
  assertPlanItemWorkflowTransitionAllowed({
    from_status: 'code_review',
    to_status: 'code_review',
    evidence_object_type: 'review_response',
  }),
).toThrow(/workflow_invalid_transition/);
```

- [ ] **Step 5: Write failing runtime validator tests**

In `tests/domain/codex-runtime.test.ts`, add tests proving:

- `validateCodexLaunchTargetKind('plan_item_workflow_action', 'generation')` is accepted.
- `validateCodexLaunchTargetKind('plan_item_workflow_action', 'run_execution')` is rejected.
- `validateCodexGenerationWorkload` accepts review response workload with `plan_item_workflow_action_id` and rejects `action_run_id`.
- `validateCodexRunExecutionWorkload` accepts fix-loop fields only when all three are present.
- pure continuation workload rejects fix-loop lineage fields.

- [ ] **Step 6: Run domain/runtime tests to verify failure**

Run:

```bash
pnpm test tests/domain/plan-item-workflow.test.ts tests/domain/codex-runtime.test.ts
```

Expected: FAIL on missing enum values, missing validator support, and missing projection fields.

- [ ] **Step 7: Implement contract enums and DTO projections**

In `packages/contracts/src/plan-item-workflow.ts`:

```ts
export const planItemWorkflowQueuedActionKindSchema = z.enum([
  'continue_brainstorming',
  'generate_boundary_summary',
  'revise_boundary_summary',
  'generate_spec_doc',
  'revise_spec_doc',
  'generate_implementation_plan_doc',
  'revise_implementation_plan_doc',
  'continue_execution',
  'respond_to_review',
  'request_fix',
]);

export const workflowManualDecisionKindSchema = z.enum([
  'start_brainstorming',
  'change_request',
  'block',
  'recover',
  'archive',
  'fork_select',
  'abandon_new_session',
  'override',
]);
```

Add schemas:

```ts
export const planItemWorkflowAttemptHistorySchema = z.object({
  run_session_id: nonEmpty,
  attempt_kind: z.enum(['first_execution', 'review_fix']),
  previous_run_session_id: nonEmpty.optional(),
  previous_review_packet_id: nonEmpty.optional(),
  status: nonEmpty,
  continuation_events: z.array(z.object({
    queued_action_id: nonEmpty,
    continuation_kind: z.enum(['existing_job_input', 'replay_current_continuation', 'relaunch_after_fencing']),
    created_at: isoDateTime,
  }).strict()).default([]),
  created_at: isoDateTime,
  updated_at: isoDateTime,
}).strict();

export const planItemWorkflowLatestReviewResponseSchema = z.object({
  id: nonEmpty,
  review_packet_id: nonEmpty,
  previous_run_session_id: nonEmpty,
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'blocked']),
  created_at: isoDateTime,
}).strict();

export const planItemWorkflowRecoveryOptionSchema = z.object({
  action_id: z.enum(['continue_same_session', 'abandon_new_session', 'archive_workflow', 'fork_unavailable']),
  enabled: z.boolean(),
  blocker_code: nonEmpty.optional(),
  warning_copy: nonEmpty.optional(),
  required_confirmation_kind: z.enum(['none', 'typed_phrase', 'confirmation_token']),
}).strict();
```

Add the arrays to `planItemWorkflowPublicDtoSchema`.

- [ ] **Step 8: Implement domain interfaces and helpers**

In `packages/domain/src/plan-item-workflow.ts`, add interfaces:

```ts
export interface ReviewResponse {
  id: string;
  workflow_id: string;
  codex_session_id: string;
  codex_session_turn_id: string;
  review_packet_id: string;
  previous_run_session_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked';
  content_digest?: string;
  rendered_markdown_artifact_ref?: string;
  created_by_actor_id: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}
```

Add matching interfaces for `ReviewPacketEvidenceRef`, `RunSessionAttemptLineage`, and `ExecutionContinuationLineage`. Add `fix_review_feedback` to `CodexSessionTurnIntent` in contracts and map `request_fix` to it.

Add one helper:

```ts
export const isSameStatusWorkflowEventActionKind = (kind: PlanItemWorkflowQueuedActionKind): boolean =>
  kind === 'continue_execution' || kind === 'respond_to_review';
```

Do not make same-status transitions valid through `PlanItemWorkflowTransition`.

- [ ] **Step 9: Implement runtime target and workload validation**

In `packages/domain/src/codex-runtime.ts`:

- Extend `CodexLaunchTarget.target_type` with `plan_item_workflow_action`.
- Add `review_response` to `codexGenerationTaskKinds`.
- Convert `CodexGenerationWorkloadV1` into a discriminated shape:

```ts
type CodexAutomationGenerationWorkloadV1 = {
  schema_version: 'codex_generation_workload.v1';
  runtime_job_id: string;
  action_run_id: string;
  plan_item_workflow_action_id?: never;
  task_kind: Exclude<CodexGenerationTaskKind, 'review_response'>;
  // existing fields
};

type CodexPlanItemWorkflowActionGenerationWorkloadV1 = {
  schema_version: 'codex_generation_workload.v1';
  runtime_job_id: string;
  plan_item_workflow_action_id: string;
  plan_item_workflow_id: string;
  codex_session_id: string;
  codex_session_turn_id: string;
  review_packet_id: string;
  review_packet_digest: string;
  action_run_id?: never;
  task_kind: 'review_response';
  output_schema_version: 'review_response.v1';
  // existing signed context fields
};
```

Add fix-loop fields to `CodexRunExecutionWorkloadV1` and validator key sets.

- [ ] **Step 10: Run Task 1 tests**

Run:

```bash
pnpm test tests/contracts/plan-item-workflow.test.ts tests/domain/plan-item-workflow.test.ts tests/domain/codex-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit Task 1**

```bash
git add packages/contracts/src/plan-item-workflow.ts packages/domain/src/plan-item-workflow.ts packages/domain/src/codex-runtime.ts packages/domain/src/types.ts tests/contracts/plan-item-workflow.test.ts tests/domain/plan-item-workflow.test.ts tests/domain/codex-runtime.test.ts
git commit -m "feat: add Wave 7 workflow contracts"
```

## Task 2: Persistence And Repository Lineage

**Files:**
- Modify: `packages/db/src/schema/plan-item-workflow.ts`
- Modify: `packages/db/src/schema/review-packet.ts`
- Modify: `packages/db/src/schema/run-session.ts`
- Modify: `packages/db/src/schema/codex-runtime.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Create: generated Drizzle migration under `packages/db/migrations/` for `wave7_execution_continuation_review_fix_loop`.
- Test: `tests/db/plan-item-workflow-repository.test.ts`
- Test: `tests/db/codex-runtime-repository.test.ts`

- [ ] **Step 1: Write failing repository tests for typed records**

In `tests/db/plan-item-workflow-repository.test.ts`, add tests for both in-memory and drizzle repositories:

- `saveReviewPacketEvidenceRef` and `listReviewPacketEvidenceRefs` return deterministic order.
- `saveReviewResponse` and `getLatestReviewResponseForWorkflow` return only the latest workflow-owned response.
- `saveRunSessionAttemptLineage` rejects a duplicate `run_session_id`.
- `saveExecutionContinuationLineage` requires a queued action id and does not create a second run attempt.
- `saveStaleCodexSessionTerminalizationAttempt` persists Wave 7 audit fields.
- `findCurrentReviewPacketForWorkflow` returns a `completed + changes_requested` packet and does not use open-only semantics.
- `findCurrentReviewPacketForWorkflow` rejects a packet with `superseded_by_review_packet_id`.
- `findCurrentReviewPacketForWorkflow` rejects a packet whose stored or computed digest does not match `expected_review_packet_digest`.

- [ ] **Step 2: Write failing repository tests for generation fence target**

In `tests/db/codex-runtime-repository.test.ts`, add:

```ts
it('creates a generation runtime job for a plan item workflow action without automation action run', async () => {
  const target = {
    target_type: 'plan_item_workflow_action' as const,
    target_id: 'action-respond-1',
    target_kind: 'generation' as const,
    project_id: 'project-1',
  };

  const result = await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope({
    // existing fixture fields
    target,
    input_json: {
      schema_version: 'codex_generation_workload.v1',
      runtime_job_id: 'runtime-job-1',
      plan_item_workflow_action_id: 'action-respond-1',
      plan_item_workflow_id: 'workflow-1',
      codex_session_id: 'session-1',
      codex_session_turn_id: 'turn-1',
      review_packet_id: 'review-packet-1',
      review_packet_digest: `sha256:${'a'.repeat(64)}`,
      task_kind: 'review_response',
      output_schema_version: 'review_response.v1',
      prompt_version: 'review-response.v1',
      signed_context_ref: 'artifact://context',
      signed_context_digest: `sha256:${'b'.repeat(64)}`,
      prompt_template_digest: `sha256:${'c'.repeat(64)}`,
      created_at: now,
      expires_at: later,
    },
  });

  expect(result.runtime_job.target_type).toBe('plan_item_workflow_action');
});
```

- [ ] **Step 3: Run repository tests to verify failure**

Run:

```bash
pnpm test tests/db/plan-item-workflow-repository.test.ts tests/db/codex-runtime-repository.test.ts
```

Expected: FAIL because schema and repository methods do not exist.

- [ ] **Step 4: Add schema tables**

Add in `packages/db/src/schema/review-packet.ts`:

```ts
export const review_packet_evidence_refs = pgTable('review_packet_evidence_refs', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewPacketId: uuid('review_packet_id').notNull().references(() => review_packets.id),
  workflowId: uuid('workflow_id').notNull().references(() => plan_item_workflows.id),
  refKind: text('ref_kind').notNull(),
  displayText: text('display_text').notNull(),
  url: text('url'),
  internalObjectRef: text('internal_object_ref'),
  digest: text('digest').notNull(),
  createdByActorId: uuid('created_by_actor_id').notNull().references(() => actors.id),
  createdAt: timestampColumn('created_at').notNull(),
});
```

Add `review_responses` in `packages/db/src/schema/review-packet.ts` next to `review_packets` and `review_packet_evidence_refs`.

Extend `review_packets` with supersession metadata used by canonical selection:

```ts
supersededByReviewPacketId: uuid('superseded_by_review_packet_id'),
currentDigest: text('current_digest'),
```

`currentDigest` stores the canonical digest over the Review Packet snapshot, deterministic evidence refs, execution package id/version, active approved Spec revision id, and active approved Implementation Plan revision id at the time the packet becomes current. If the implementation computes this digest on read instead, the repository method must still compare the computed digest to `expected_review_packet_digest` before returning the packet.

Add in `packages/db/src/schema/run-session.ts`:

```ts
export const run_session_attempt_lineages = pgTable('run_session_attempt_lineages', {
  runSessionId: uuid('run_session_id').primaryKey().references(() => run_sessions.id),
  workflowId: uuid('workflow_id').notNull().references(() => plan_item_workflows.id),
  codexSessionId: uuid('codex_session_id').notNull().references(() => codex_sessions.id),
  attemptKind: text('attempt_kind').notNull(),
  previousRunSessionId: uuid('previous_run_session_id'),
  previousReviewPacketId: uuid('previous_review_packet_id'),
  reviewResponseId: uuid('review_response_id'),
  createdByActorId: uuid('created_by_actor_id').notNull().references(() => actors.id),
  createdAt: timestampColumn('created_at').notNull(),
});
```

Add `execution_continuation_lineages` with required `queuedActionId`.

- [ ] **Step 5: Add stale terminalization fields**

Extend `codex_session_stale_terminalization_attempts` with:

- `workflowId`
- `runSessionId`
- `runtimeJobId`
- `expectedWorkflowStatus`
- `actualWorkflowStatus`
- `expectedRunSessionStatus`
- `actualRunSessionStatus`
- `expectedRunSessionUpdatedAt`
- `actualRunSessionUpdatedAt`
- `expectedCodexThreadIdDigest`

- [ ] **Step 6: Generate migration**

Run:

```bash
pnpm db:generate
```

Expected: new migration file under `packages/db/migrations/`.

- [ ] **Step 7: Add repository interface methods**

In `packages/db/src/repositories/delivery-repository.ts`, add methods:

```ts
saveReviewPacketEvidenceRef(ref: ReviewPacketEvidenceRef): Promise<void>;
listReviewPacketEvidenceRefs(reviewPacketId: string): Promise<ReviewPacketEvidenceRef[]>;
saveReviewResponse(response: ReviewResponse): Promise<void>;
getReviewResponse(id: string): Promise<ReviewResponse | undefined>;
getLatestReviewResponseForWorkflow(workflowId: string): Promise<ReviewResponse | undefined>;
saveRunSessionAttemptLineage(lineage: RunSessionAttemptLineage): Promise<void>;
listRunSessionAttemptLineage(workflowId: string): Promise<RunSessionAttemptLineage[]>;
saveExecutionContinuationLineage(lineage: ExecutionContinuationLineage): Promise<void>;
listExecutionContinuationLineage(workflowId: string): Promise<ExecutionContinuationLineage[]>;
findCurrentReviewPacketForWorkflow(input: {
  workflow_id: string;
  execution_package_id: string;
  execution_package_version: number;
  previous_run_session_id: string;
  approved_spec_revision_id: string;
  approved_implementation_plan_revision_id: string;
  expected_review_packet_id?: string;
  expected_review_packet_digest?: string;
  allowed_statuses: Array<'ready' | 'in_review' | 'completed'>;
  allowed_completed_decisions: Array<'changes_requested'>;
}): Promise<ReviewPacket | undefined>;
```

- [ ] **Step 8: Implement in-memory repository**

Implement maps keyed by id and workflow id. Enforce:

- `RunSessionAttemptLineage` one row per run session.
- `ExecutionContinuationLineage.queued_action_id` exists in `planItemWorkflowQueuedActions`.
- `findCurrentReviewPacketForWorkflow` may return completed `changes_requested`.
- `findCurrentReviewPacketForWorkflow` never returns archived, superseded, wrong-run, wrong-package, wrong-package-version, wrong-workflow, wrong approved Spec revision, wrong approved Implementation Plan revision, or digest-mismatched packets.

- [ ] **Step 9: Implement Drizzle repository**

Implement equivalent methods in `packages/db/src/repositories/drizzle-delivery-repository.ts`.

Use deterministic ordering:

- Evidence refs by `createdAt`, then id.
- Attempt lineage by `createdAt`, then `runSessionId`.
- Continuation lineage by `createdAt`, then `queuedActionId`.

- [ ] **Step 10: Update runtime job replay/fence support**

Update runtime job create/replay predicates so `plan_item_workflow_action + generation` is legal and idempotent by target id, attempt, and request id.

Do not call or require `getActiveCodexGenerationActionRunFence` for this target. Add a new generic fence snapshot method or widen the existing method without retaining the `ActionRun` name in public/domain API.

- [ ] **Step 11: Run repository tests**

Run:

```bash
pnpm test tests/db/plan-item-workflow-repository.test.ts tests/db/codex-runtime-repository.test.ts
```

Expected: PASS.

- [ ] **Step 12: Commit Task 2**

```bash
git add packages/db/src/schema packages/db/src/repositories packages/db/migrations tests/db/plan-item-workflow-repository.test.ts tests/db/codex-runtime-repository.test.ts
git commit -m "feat: persist Wave 7 workflow lineage"
```

## Task 3: Runtime Workload And Worker Support

**Files:**
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/product-generation-runtime-scheduler.service.ts`
- Modify: `packages/codex-worker-runtime/src/remote-worker-client.ts`
- Modify: `apps/automation-daemon/src/generation-runtime.ts`
- Test: `tests/api/codex-runtime-control-plane.test.ts`
- Test: `tests/api/codex-runtime-product-generation-scheduler.test.ts`
- Test: `tests/codex-worker-runtime/remote-worker-client.test.ts`

- [ ] **Step 1: Write failing scheduler tests**

Add tests proving a queued `respond_to_review` action schedules a generation workload with:

- the dedicated `schedulePlanItemWorkflowReviewResponse` method, not the existing automation-action `schedule` method.
- `target_type = plan_item_workflow_action`
- `target_kind = generation`
- `task_kind = review_response`
- `output_schema_version = review_response.v1`
- `plan_item_workflow_action_id`, not `action_run_id`
- no created or claimed `automation_action_run`

- [ ] **Step 2: Write failing worker tests for read-only review response**

In `tests/codex-worker-runtime/remote-worker-client.test.ts`, add:

- valid `review_response.v1` output terminalizes.
- any `patch_artifact`, `changed_files`, `workspace_bundle`, commit, PR, or run-execution artifact fails with `read_only_review_response_mutation_artifact`.
- output capsule and memory/environment refs are passed through.

- [ ] **Step 3: Write failing worker tests for fix-loop workload lineage**

Add tests that `CodexRunExecutionWorkloadV1` carries:

- `previous_run_session_id`
- `previous_review_packet_id`
- `review_packet_digest`
- `codex_session_runtime_context.continuation.kind = resume_thread`
- `expected_input_capsule_digest`

and that missing or extra lineage fields fail according to Task 1 validators. Also assert worker launch restores the latest capsule before `resumeRun` for both continuation and fix-loop workloads.

- [ ] **Step 4: Run runtime tests to verify failure**

Run:

```bash
pnpm test tests/api/codex-runtime-product-generation-scheduler.test.ts tests/codex-worker-runtime/remote-worker-client.test.ts
```

Expected: FAIL on missing scheduler and worker support.

- [ ] **Step 5: Implement scheduler support**

In `product-generation-runtime-scheduler.service.ts`, add a dedicated method such as `schedulePlanItemWorkflowReviewResponse`.

Build the workload from the current Review Packet digest and the latest safe capsule. The method must call the new plan-item-workflow-action fence path and never create, claim, or require an automation action run.

Keep ownership split explicit:

- `PlanItemWorkflowService.respondToReview` owns product authorization, current Review Packet selection, queued action creation, Codex turn creation, and signed-context construction.
- `ProductGenerationRuntimeSchedulerService.schedulePlanItemWorkflowReviewResponse` owns `CodexRuntimeJob` creation/replay and generation launch lease/fence behavior for `target_type = plan_item_workflow_action`.
- `CodexRuntimeService` owns trusted worker terminalization and persistence of `ReviewResponse`.

- [ ] **Step 6: Implement read-only output validation**

In `packages/codex-worker-runtime/src/remote-worker-client.ts`, add a helper:

```ts
const assertReviewResponseOutputIsReadOnly = (result: CodexGenerationRuntimeJobResult): void => {
  const payload = result.generated_payload as Record<string, unknown>;
  if ('patch_artifact' in payload || 'changed_files' in payload || 'commit' in payload || 'pull_request' in payload) {
    throw new Error('read_only_review_response_mutation_artifact');
  }
  for (const artifact of result.generation_artifacts) {
    if (/patch|workspace|commit|pull_request|changed_file/i.test(`${artifact.kind}:${artifact.name}`)) {
      throw new Error('read_only_review_response_mutation_artifact');
    }
  }
};
```

Call it before terminalization for `task_kind === 'review_response'`.

- [ ] **Step 7: Implement review response terminalization**

In `codex-runtime.service.ts`, when terminalizing a `plan_item_workflow_action + generation` job:

1. Validate worker/session proof as today.
2. Reject mutation artifacts.
3. Update `CodexSession.latest_capsule_*`, latest memory bundle, and environment manifest refs.
4. Mark the queued action `succeeded`.
5. Persist `ReviewResponse`.
6. Append command-specific `ObjectEvent` with `evidence_object_type = review_response`.
7. Keep workflow status `code_review`.

- [ ] **Step 8: Implement fix-loop workload runtime fields**

Update run-execution workload creation and worker validation to preserve previous run and Review Packet context. This task only adds runtime support; Task 6 wires service command behavior.

The shared run-execution workload builder must require, for continuation and fix-loop workloads:

- `codex_session_runtime_context.continuation.kind = resume_thread`
- `expected_input_capsule_digest = active CodexSession.latest_capsule_digest`
- `codex_session_id = active CodexSession.id`
- `codex_session_turn_id = the continuation or fix turn id`
- `turn_group_status = complete`

The worker path must restore the latest capsule before Docker/app-server startup and before `resumeRun`. Missing or mismatched `expected_input_capsule_digest` must fail closed.

- [ ] **Step 9: Run Task 3 tests**

Run:

```bash
pnpm test tests/api/codex-runtime-control-plane.test.ts tests/api/codex-runtime-product-generation-scheduler.test.ts tests/codex-worker-runtime/remote-worker-client.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Task 3**

```bash
git add apps/control-plane-api/src/modules/codex-runtime packages/codex-worker-runtime/src/remote-worker-client.ts apps/automation-daemon/src/generation-runtime.ts tests/api/codex-runtime-control-plane.test.ts tests/api/codex-runtime-product-generation-scheduler.test.ts tests/codex-worker-runtime/remote-worker-client.test.ts
git commit -m "feat: support review response runtime jobs"
```

## Task 4: Shared Workflow Helpers And Public Projection

**Files:**
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts`
- Test: `tests/api/plan-item-workflows.test.ts`
- Test: `tests/domain/plan-item-workflow.test.ts`

- [ ] **Step 1: Write failing tests for current Review Packet selection**

In `tests/api/plan-item-workflows.test.ts`, seed:

- one completed `changes_requested` Review Packet tied to the workflow execution package and previous run session.
- one `ready` Review Packet tied to the workflow execution package and previous run session.
- one `in_review` Review Packet tied to the workflow execution package and previous run session.
- one open packet for another package.

Assert helper-backed command preflight:

- chooses the completed `changes_requested` current packet, not the open unrelated packet;
- accepts `ready` as current for `respond_to_review`;
- accepts `in_review` as current for `respond_to_review`;
- rejects completed Review Packets whose decision is not `changes_requested`;
- requires completed `changes_requested` for `request_fix`.
- rejects packets with the wrong workflow id, execution package id, previous run session id, expected packet id, or expected digest.
- rejects packets when the current Execution Package version differs from the packet's package version context.
- rejects packets when the active approved Spec Doc revision no longer matches `packet.spec_revision_id`.
- rejects packets when the active approved Implementation Plan Doc revision no longer matches `packet.plan_revision_id`.
- rejects packets with supersession metadata pointing to a newer Review Packet.
- rejects evidence refs whose visibility, URL/internal ref, or digest is not safe for the command context.

- [ ] **Step 2: Write failing tests for deterministic abandon mapping**

In `tests/domain/plan-item-workflow.test.ts`, add table tests for each fallback row:

- current Review Packet -> `code_review`
- valid readiness -> `execution_ready`
- unapproved Implementation Plan Doc -> `implementation_plan_review`
- approved Spec Doc only -> `implementation_plan_generation_queued`
- unapproved Spec Doc -> `spec_review`
- approved Boundary Summary only -> `spec_generation_queued`
- no Boundary Summary -> `brainstorming`

- [ ] **Step 3: Write failing tests for public projection**

Assert `toPublicWorkflowDto` includes:

- attempt history with nested continuations.
- latest review response.
- recovery options with stable disabled reasons.

Assert it excludes raw runtime refs.

- [ ] **Step 4: Run tests to verify failure**

Run:

```bash
pnpm test tests/domain/plan-item-workflow.test.ts tests/api/plan-item-workflows.test.ts
```

Expected: FAIL because helpers and projections are missing.

- [ ] **Step 5: Implement current Review Packet digest helper**

In `PlanItemWorkflowService`, add:

```ts
private async requireCurrentReviewPacketForWorkflow(
  repository: DeliveryRepository,
  workflow: PlanItemWorkflow,
  input: {
    previous_run_session_id: string;
    execution_package_version: number;
    approved_spec_revision_id: string;
    approved_implementation_plan_revision_id: string;
    expected_review_packet_id?: string;
    expected_review_packet_digest?: string;
    command_kind: 'respond_to_review' | 'request_fix';
  },
): Promise<{ packet: ReviewPacket; evidenceRefs: ReviewPacketEvidenceRef[]; digest: string }> {
  const executionPackageId = this.requireString(workflow.execution_package_id, 'Workflow execution package is missing');
  const packet = await repository.findCurrentReviewPacketForWorkflow({
    workflow_id: workflow.id,
    execution_package_id: executionPackageId,
    execution_package_version: input.execution_package_version,
    previous_run_session_id: input.previous_run_session_id,
    approved_spec_revision_id: input.approved_spec_revision_id,
    approved_implementation_plan_revision_id: input.approved_implementation_plan_revision_id,
    expected_review_packet_id: input.expected_review_packet_id,
    expected_review_packet_digest: input.expected_review_packet_digest,
    allowed_statuses: input.command_kind === 'respond_to_review' ? ['ready', 'in_review', 'completed'] : ['completed'],
    allowed_completed_decisions: ['changes_requested'],
  });
  if (packet === undefined) {
    throw new DomainError('workflow_review_packet_not_current', 'Current Review Packet is missing');
  }
  const evidenceRefs = await repository.listReviewPacketEvidenceRefs(packet.id);
  this.assertReviewPacketEvidenceRefsAreSafe(packet, evidenceRefs);
  if (packet.superseded_by_review_packet_id !== undefined) {
    throw new DomainError('workflow_review_packet_not_current', 'Review Packet has been superseded');
  }
  if (packet.spec_revision_id !== input.approved_spec_revision_id || packet.plan_revision_id !== input.approved_implementation_plan_revision_id) {
    throw new DomainError('workflow_review_packet_not_current', 'Review Packet document revisions are stale');
  }
  const digestInput = {
    packet,
    evidence_refs: evidenceRefs,
    execution_package_id: executionPackageId,
    execution_package_version: input.execution_package_version,
    approved_spec_revision_id: input.approved_spec_revision_id,
    approved_implementation_plan_revision_id: input.approved_implementation_plan_revision_id,
  };
  return {
    packet,
    evidenceRefs,
    digest: codexCanonicalDigest(digestInput),
  };
}
```

After computing the digest, compare it with `input.expected_review_packet_digest` when provided and fail with `workflow_review_packet_digest_mismatch` on mismatch. Do not return a packet whose computed digest differs from its stored current digest when the schema stores one.

- [ ] **Step 6: Implement deterministic fallback helper**

Add a helper named `determineAbandonNewSessionFallback` that returns `{ target_status, expected_next_action, queued_action_kind? }`.

Do not reuse `recover`; `recover` only returns to `previous_status`.

- [ ] **Step 7: Implement projection assembly**

Extend `toPublicWorkflowDto` options with:

- `attempt_history`
- `latest_review_response`
- `recovery_options`

Fetch these rows from the repository in every command path that returns a workflow projection and in the workflow/detail projection assembly path.

- [ ] **Step 8: Run Task 4 tests**

Run:

```bash
pnpm test tests/domain/plan-item-workflow.test.ts tests/api/plan-item-workflows.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

```bash
git add apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts tests/api/plan-item-workflows.test.ts tests/domain/plan-item-workflow.test.ts
git commit -m "feat: add Wave 7 workflow helpers"
```

## Task 5: Continue Execution Command

**Files:**
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts`
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.controller.ts`
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts`
- Test: `tests/api/plan-item-workflows.test.ts`
- Test: `tests/db/plan-item-workflow-repository.test.ts`

- [ ] **Step 1: Write failing API tests for continue execution matrix**

Add tests for:

- `waiting_for_input + running job + matching active leases` returns existing-job continuation and creates no new runtime job.
- `waiting_for_input + materializing job` rejects `workflow_execution_not_ready_for_input`.
- `stalled + active expired heartbeat` blocks with `workflow_execution_writer_still_active`.
- `stalled + terminal runtime job + released/expired run-worker lease` creates a relaunch runtime job for the same `RunSession`.
- relaunch runtime job uses `resume_thread`, the same active `CodexSession.id`, and `expected_input_capsule_digest` from the latest safe capsule.
- `resuming + active queued/accepted/materializing/running runtime job + matching leases` replays the current continuation command and creates no new runtime job.
- `resuming + terminal runtime job + released/expired run-worker lease` creates a relaunch runtime job for the same `RunSession`.
- `cancel_requested + queued/running turn or runtime job that can still terminalize` rejects `workflow_execution_cancel_pending`.
- `cancel_requested + cancelled/stale terminal runtime job + released/expired/absent run-worker lease` rejects unless the request explicitly chooses recovery rather than accepting cancellation.
- `cancel_requested` recovery requires both `cancel_recovery_decision` and `cancel_recovery_confirmation_phrase`.
- any unlisted state rejects.

- [ ] **Step 2: Add command DTO**

In `plan-item-workflow.dto.ts`:

```ts
export const continueWorkflowExecutionBodySchema = z.object({
  actor_id: nonEmpty,
  idempotency_key: nonEmpty.optional(),
  input_markdown: nonEmpty.optional(),
  cancel_recovery_decision: z.enum(['recover_instead_of_accept_cancel']).optional(),
  cancel_recovery_confirmation_phrase: z.literal('recover cancelled execution').optional(),
  recovery_rationale_markdown: nonEmpty.optional(),
}).strict();
```

- [ ] **Step 3: Add controller route**

In `plan-item-workflow.controller.ts`:

```ts
@Post('plan-item-workflows/:workflowId/execution/continue')
continueExecution(
  @Param('workflowId') workflowId: string,
  @Body(new ZodValidationPipe(continueWorkflowExecutionBodySchema)) body: ContinueWorkflowExecutionBodyDto,
) {
  return this.service.continueExecution(workflowId, body);
}
```

- [ ] **Step 4: Implement recoverability classifier**

In `PlanItemWorkflowService`, add a private classifier that returns:

```ts
type ContinuationDecision =
  | { mode: 'existing_job_input'; runSession: RunSession; runtimeJob: CodexRuntimeJob }
  | { mode: 'replay_current_continuation'; runSession: RunSession; runtimeJob: CodexRuntimeJob }
  | { mode: 'relaunch_after_fencing'; runSession: RunSession; previousRuntimeJob: CodexRuntimeJob }
  | { mode: 'reject'; code: string };
```

The classifier must inspect run session status, turn status, runtime job status, session lease, run-worker lease, capsule digest, and runner ownership fields.

- [ ] **Step 5: Implement existing-job input continuation**

For `existing_job_input`:

1. Create or reuse `PlanItemWorkflowQueuedAction(kind = continue_execution)`.
2. Persist `ExecutionContinuationLineage(continuation_kind = existing_job_input)`.
3. Append trusted input/continuation event to the existing runtime job if the current app-server channel supports it.
4. Append `ObjectEvent`.
5. Keep workflow status `execution_running`.
6. Return public projection.

If the channel cannot append input yet, fail closed with `workflow_execution_not_ready_for_input`.

- [ ] **Step 6: Implement replay-current-continuation**

For `replay_current_continuation`:

1. Require `RunSession.status = resuming`.
2. Verify the current continuation action, runtime job, Codex session lease, run-worker lease, worker id, worker session digest, run session id, and Codex session turn id still match durable state.
3. Create or reuse `PlanItemWorkflowQueuedAction(kind = continue_execution)` with the same continuation idempotency key.
4. Persist `ExecutionContinuationLineage(continuation_kind = replay_current_continuation)` with no `new_runtime_job_id`.
5. Append `ObjectEvent`.
6. Keep workflow status `execution_running`.
7. Return public projection.

This mode must never create a new `RunSession`, new `CodexRuntimeJob`, or replacement `CodexSessionTurn`.

- [ ] **Step 7: Implement cancel-pending safeguards**

For `cancel_requested` rows:

1. Reject with `workflow_execution_cancel_pending` while a queued/running turn, runtime job, Codex session lease, or run-worker lease can still terminalize.
2. Allow relaunch only when `cancel_recovery_decision = recover_instead_of_accept_cancel`, `cancel_recovery_confirmation_phrase = recover cancelled execution`, the turn is `cancelled` or `stale`, the runtime job is terminal, the session lease is `released | expired | fenced | stale`, and the run-worker lease is `released | expired | absent`.
3. Record the explicit recovery rationale in the continuation action context preview digest and `ObjectEvent`.
4. Reuse the same relaunch-after-fencing implementation path after the cancel-specific guards pass.

- [ ] **Step 8: Implement relaunch-after-fencing**

For `relaunch_after_fencing`:

1. Verify previous runtime job terminal.
2. Verify session lease `released | expired | fenced | stale`.
3. Verify run-worker lease `released | expired | absent`.
4. Create a new `CodexSessionTurn(intent = continue_execution)`.
5. Create a new `CodexRuntimeJob(target_kind = run_execution)` for the same `RunSession` with `codex_session_runtime_context.continuation.kind = resume_thread`, `expected_input_capsule_digest = active CodexSession.latest_capsule_digest`, and the latest capsule restore manifest.
6. Persist `ExecutionContinuationLineage(continuation_kind = relaunch_after_fencing)`.
7. If workflow is `blocked`, recover only through manual decision `recover` to `execution_running`.
8. Return public projection.

- [ ] **Step 9: Run Task 5 tests**

Run:

```bash
pnpm test tests/api/plan-item-workflows.test.ts tests/db/plan-item-workflow-repository.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Task 5**

```bash
git add apps/control-plane-api/src/modules/plan-item-workflows tests/api/plan-item-workflows.test.ts tests/db/plan-item-workflow-repository.test.ts
git commit -m "feat: continue Plan Item execution"
```

## Task 6: Review Response And Request Fix Commands

**Files:**
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts`
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.controller.ts`
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/product-generation-runtime-scheduler.service.ts`
- Test: `tests/api/plan-item-workflows.test.ts`
- Test: `tests/api/codex-runtime-product-generation-scheduler.test.ts`

- [ ] **Step 1: Write failing API tests for respond to review**

Assert:

- allowed only in `code_review`.
- rejects when another workflow action is queued or running for the active session.
- rejects when the active Codex session is not idle and claimable.
- accepts current `ready` Review Packet.
- accepts current `in_review` Review Packet.
- accepts current completed `changes_requested` Review Packet.
- rejects completed Review Packets whose decision is not `changes_requested`.
- creates queued action `respond_to_review`.
- creates turn intent `address_review_feedback`.
- creates generation runtime target `plan_item_workflow_action`.
- creates runtime job through `ProductGenerationRuntimeSchedulerService.schedulePlanItemWorkflowReviewResponse`, not through direct runtime repository calls from `PlanItemWorkflowService`.
- rejects cross-tenant, cross-workflow, cross-plan-item, cross-repo, and cross-credential attempts through the shared workflow authorization helper.
- creates no `RunSession`.
- creates no `PlanItemWorkflowTransition`.
- appends `ObjectEvent`.

- [ ] **Step 2: Write failing API tests for request fix**

Assert:

- allowed only when current Review Packet is completed `changes_requested`.
- rejects cross-tenant, cross-workflow, cross-plan-item, cross-repo, and cross-credential attempts through the shared workflow authorization helper.
- rejects when another workflow action is queued or running for the active session.
- rejects when the active Codex session is not idle and claimable.
- rejects when latest capsule, memory bundle, or environment manifest is missing, unsafe, or digest-mismatched.
- creates new `RunSession`.
- keeps same `CodexSession.id` and thread digest.
- creates turn intent `fix_review_feedback`.
- creates run-execution workload with previous run/review packet digest fields.
- creates run-execution workload with `codex_session_runtime_context.continuation.kind = resume_thread` and `expected_input_capsule_digest` from the latest safe capsule.
- includes canonical requested changes, ReviewResponse ids if present, approved Spec Doc revision id, approved Implementation Plan Doc revision id, execution package id/version, path policy digest, and required checks in the signed run-execution context.
- writes the same canonical review payload into `RunSpec.review_context`.
- persists `RunSessionAttemptLineage(attempt_kind = review_fix)`.
- preserves old Review Packet and old run session.

- [ ] **Step 3: Add command DTOs**

```ts
export const respondToWorkflowReviewBodySchema = z.object({
  actor_id: nonEmpty,
  idempotency_key: nonEmpty.optional(),
  expected_review_packet_id: nonEmpty,
  expected_review_packet_digest: nonEmpty,
  response_prompt_markdown: nonEmpty.optional(),
}).strict();

export const requestWorkflowReviewFixBodySchema = z.object({
  actor_id: nonEmpty,
  idempotency_key: nonEmpty.optional(),
  expected_review_packet_id: nonEmpty,
  expected_review_packet_digest: nonEmpty,
  rationale_markdown: nonEmpty.optional(),
}).strict();
```

- [ ] **Step 4: Add controller routes**

Add routes under:

- `POST /plan-item-workflows/:workflowId/code-review/respond`
- `POST /plan-item-workflows/:workflowId/code-review/request-fix`

- [ ] **Step 5: Implement respond to review**

In service:

1. Require `code_review`.
2. Require no queued or running workflow action for the active session.
3. Require idle, claimable active `CodexSession`.
4. Require safe latest capsule.
5. Load current Review Packet and evidence refs with `command_kind = respond_to_review`, request `expected_review_packet_id`, request `expected_review_packet_digest`, current execution package version, active approved Spec revision id, and active approved Implementation Plan revision id.
6. Create or replay `PlanItemWorkflowQueuedAction(kind = respond_to_review)`.
7. Create `CodexSessionTurn(intent = address_review_feedback)`.
8. Build signed context from the Review Packet snapshot, evidence refs, previous run session, changed files summary, checks summary, risk notes, latest safe capsule, execution package id/version, approved Spec revision id, and approved Implementation Plan revision id.
9. Call `ProductGenerationRuntimeSchedulerService.schedulePlanItemWorkflowReviewResponse` to create or replay the generation runtime job with `target_type = plan_item_workflow_action`.
10. Return `code_review` projection with queued action.

- [ ] **Step 6: Implement request fix**

In service:

1. Require `code_review`.
2. Require no queued or running workflow action for the active session.
3. Require idle, claimable active `CodexSession`.
4. Require safe latest capsule, required memory bundle, and required environment manifest with digest matches.
5. Load current Review Packet and evidence refs with `command_kind = request_fix`, request `expected_review_packet_id`, request `expected_review_packet_digest`, current execution package version, active approved Spec revision id, and active approved Implementation Plan revision id.
6. Require completed `changes_requested` packet with requested changes.
7. Require previous run session terminal.
8. Create new run session and `RunSessionAttemptLineage(review_fix)`.
9. Create turn intent `fix_review_feedback`.
10. Build canonical fix context from:
   - Review Packet id, digest, summary, risk notes, and requested changes.
   - `ReviewPacketEvidenceRef` rows in deterministic digest order.
   - latest `ReviewResponse` ids for the packet, if any.
   - previous workflow-owned run session id and terminal result summary.
   - approved Spec Doc revision id.
   - approved Implementation Plan Doc revision id.
   - execution package id and version.
   - path policy digest.
   - required checks and check strategy.
11. Store the canonical review payload in `RunSpec.review_context`.
12. Build run-execution workload with `previous_run_session_id`, `previous_review_packet_id`, `review_packet_digest`, `codex_session_runtime_context.continuation.kind = resume_thread`, `expected_input_capsule_digest = active CodexSession.latest_capsule_digest`, latest capsule restore metadata, and the signed fix context.
13. Transition `code_review -> execution_running`.
14. Return public attempt history.

- [ ] **Step 7: Run Task 6 tests**

Run:

```bash
pnpm test tests/api/plan-item-workflows.test.ts tests/api/codex-runtime-product-generation-scheduler.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

```bash
git add apps/control-plane-api/src/modules/plan-item-workflows apps/control-plane-api/src/modules/codex-runtime tests/api/plan-item-workflows.test.ts tests/api/codex-runtime-product-generation-scheduler.test.ts
git commit -m "feat: add review response and fix loop commands"
```

## Task 7: Abandon New Session And Stale Terminalization

**Files:**
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts`
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.controller.ts`
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Test: `tests/api/plan-item-workflows.test.ts`
- Test: `tests/api/codex-runtime-control-plane.test.ts`
- Test: `tests/db/plan-item-workflow-repository.test.ts`

- [ ] **Step 1: Write failing abandon/new-session tests**

Assert:

- missing confirmation rejects.
- mismatched `next_action` rejects `workflow_abandon_next_action_mismatch`.
- current Review Packet row returns `code_review`.
- valid readiness returns `execution_ready`.
- no approved Boundary Summary returns `brainstorming`.
- old session is archived/deactivated and queued actions tied to it become stale.
- new session starts from product artifacts, not unsafe capsule.

- [ ] **Step 2: Write failing stale terminalization tests**

Assert stale terminalization records Wave 7 fields and does not overwrite:

- latest capsule.
- latest memory/environment refs.
- active run session.
- workflow status.
- Review Packet.
- ReviewResponse.

- [ ] **Step 3: Add abandon DTO and route**

```ts
export const abandonWorkflowSessionBodySchema = z.object({
  actor_id: nonEmpty,
  next_action: z.enum([
    'respond_to_review',
    'request_fix',
    'start_execution',
    'review_implementation_plan',
    'generate_implementation_plan',
    'review_spec',
    'generate_spec',
    'brainstorm',
  ]),
  confirmation_phrase: z.literal('abandon current Codex session'),
  reason_markdown: nonEmpty,
}).strict();
```

- [ ] **Step 4: Implement abandon command**

In service:

1. Require blocked or unsafe active session state.
2. Require no active terminalizable runtime job.
3. Determine fallback through `determineAbandonNewSessionFallback`.
4. Verify request `next_action` matches.
5. Save manual decision `abandon_new_session`.
6. Archive old active session.
7. Mark old queued actions stale.
8. Create new active session from trusted product artifacts.
9. Move workflow to deterministic target status.
10. Queue the matrix-required next action if applicable.

- [ ] **Step 5: Harden stale terminalization**

In `codex-runtime.service.ts` and repositories, compare durable state before terminalization:

- workflow id.
- active session id.
- turn id.
- run session id.
- runtime job id.
- lease id/epoch.
- worker id/session digest.
- expected input capsule digest.
- expected run status/update time.
- expected workflow status.
- expected thread digest.

When stale, write `CodexSessionStaleTerminalizationAttempt` with Wave 7 fields and do not mutate active workflow/session/run/review state.

- [ ] **Step 6: Run Task 7 tests**

Run:

```bash
pnpm test tests/api/plan-item-workflows.test.ts tests/api/codex-runtime-control-plane.test.ts tests/db/plan-item-workflow-repository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 7**

```bash
git add apps/control-plane-api/src/modules/plan-item-workflows apps/control-plane-api/src/modules/codex-runtime packages/db/src/repositories tests/api/plan-item-workflows.test.ts tests/api/codex-runtime-control-plane.test.ts tests/db/plan-item-workflow-repository.test.ts
git commit -m "feat: add explicit workflow session abandonment"
```

## Task 8: Product UI And Public Commands

**Files:**
- Modify: `apps/web/src/shared/api/types.ts`
- Modify: `apps/web/src/shared/api/commands.ts`
- Modify: `apps/web/src/shared/api/hooks.ts`
- Modify: `apps/web/src/shared/api/query-keys.ts`
- Modify: `apps/web/src/features/development-plans/plan-item-workflow-view-model.ts`
- Modify: `apps/web/src/features/development-plans/plan-item-workflow-workspace.tsx`
- Test: `tests/web/development-plan-routes.test.tsx`
- Test: `tests/web/api-client-contract.test.ts`
- Test: `tests/web/no-legacy-web-ui.test.ts`

- [ ] **Step 1: Write failing API client tests**

In `tests/web/api-client-contract.test.ts`, assert commands call:

- `/plan-item-workflows/:workflowId/execution/continue`
- `/plan-item-workflows/:workflowId/code-review/respond`
- `/plan-item-workflows/:workflowId/code-review/request-fix`
- `/plan-item-workflows/:workflowId/recovery/abandon-and-new-session`

Assert request bodies contain only product-safe command fields:

- actor/idempotency fields;
- Review Packet id/digest concurrency fields for `respond_to_review` and `request_fix`;
- cancel-recovery confirmation fields for explicit cancelled-execution recovery;
- abandon/new-session typed confirmation fields;
- no raw runtime refs.

- [ ] **Step 2: Write failing UI route tests**

In `tests/web/development-plan-routes.test.tsx`, assert:

- Execution lens shows current run attempt and same-session digest.
- Continue button appears only when enabled by recovery options.
- Code Review lens shows current Review Packet, evidence refs, ReviewResponse summary, and Request fix button.
- Respond and Request fix commands send the current Review Packet id and digest from the view model.
- Recovery panel shows Abandon current session with typed confirmation.
- Fork is shown unavailable before Wave 8.
- No raw runtime refs or local paths appear.

- [ ] **Step 3: Add API command functions**

In `apps/web/src/shared/api/commands.ts`, add functions and types for four commands. Use existing `createApiContext` patterns.

- [ ] **Step 4: Add hook mutations**

In `apps/web/src/shared/api/hooks.ts`, extend `usePlanItemWorkflowCommandMutation`:

```ts
continueExecution
respondToReview
requestFix
abandonNewSession
```

Invalidate the development plan item detail and workflow query keys after each command.

- [ ] **Step 5: Extend view model**

In `plan-item-workflow-view-model.ts`, add:

- `executionLens`
- `codeReviewLens`
- `recoveryPanel`
- attempt timeline rows

Keep `assertNoRawRuntimeFieldsForUi` updated with new forbidden fields.

- [ ] **Step 6: Render UI controls**

In `plan-item-workflow-workspace.tsx`, add sections:

- Execution lens.
- Code Review lens.
- Recovery panel.

Use existing `Button`, `InlineNotice`, `StatusPill`, and layout primitives. Do not add card-inside-card nesting.

- [ ] **Step 7: Run Task 8 tests**

Run:

```bash
pnpm test tests/web/development-plan-routes.test.tsx tests/web/api-client-contract.test.ts tests/web/no-legacy-web-ui.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 8**

```bash
git add apps/web/src/shared/api apps/web/src/features/development-plans tests/web/development-plan-routes.test.tsx tests/web/api-client-contract.test.ts tests/web/no-legacy-web-ui.test.ts
git commit -m "feat: expose Wave 7 workflow actions in UI"
```

## Task 9: Dogfood, No-Baggage Guards, And Full Verification

**Files:**
- Create: `scripts/plan-item-execution-continuation-review-fix-loop-dogfood.ts`
- Create: `scripts/plan-item-execution-continuation-review-fix-loop-real-dogfood.ts`
- Modify: `package.json`
- Modify: `scripts/check-codex-runtime-superpowers-no-baggage.ts`
- Test: `tests/smoke/plan-item-execution-continuation-review-fix-loop-dogfood-script.test.ts`
- Test: `tests/smoke/codex-runtime-no-baggage-gate.test.ts`

- [ ] **Step 1: Write failing smoke tests**

Add deterministic dogfood test asserting report includes:

- first execution reaches `code_review`.
- continuation uses same run session.
- review response creates `ReviewResponse` and no run session.
- request fix creates new run session under same Codex session/thread digest.
- stale terminalization cannot overwrite newer continuation/fix attempt.
- abandon/new-session requires explicit confirmation.

- [ ] **Step 2: Add package scripts**

In `package.json`:

```json
"dogfood:plan-item-execution-continuation-review-fix-loop": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/plan-item-execution-continuation-review-fix-loop-dogfood.ts",
"dogfood:plan-item-execution-continuation-review-fix-loop:real": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/plan-item-execution-continuation-review-fix-loop-real-dogfood.ts"
```

- [ ] **Step 3: Implement deterministic fake dogfood**

Use the existing handoff dogfood style. Emit a marked JSON line:

```text
PLAN_ITEM_EXECUTION_CONTINUATION_REVIEW_FIX_LOOP_DOGFOOD_REPORT_JSON:
```

The report must contain only public-safe ids, digests, counts, statuses, and route names.

- [ ] **Step 4: Implement real dogfood skip/acceptance path**

Default to:

```json
{
  "status": "SKIPPED_NON_ACCEPTANCE",
  "reason_code": "plan_item_execution_continuation_review_fix_loop_real_runtime_acceptance_not_enabled"
}
```

Require explicit env vars before making network/control-plane calls.

- [ ] **Step 5: Add no-baggage guard checks**

Update `scripts/check-codex-runtime-superpowers-no-baggage.ts` to fail if public routes expose:

- direct run-session resume/retry.
- workflow-owned execution package rerun.
- public fork/select-fork before Wave 8.
- `automation_action_run` in review response product routes.
- raw thread/capsule/memory/env/lease/credential refs.

- [ ] **Step 6: Run smoke tests**

Run:

```bash
pnpm test tests/smoke/plan-item-execution-continuation-review-fix-loop-dogfood-script.test.ts tests/smoke/codex-runtime-no-baggage-gate.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run dogfood scripts**

Run:

```bash
pnpm dogfood:plan-item-execution-continuation-review-fix-loop
pnpm dogfood:plan-item-execution-continuation-review-fix-loop:real
```

Expected:

- Deterministic dogfood prints PASS report.
- Real dogfood prints skipped report unless acceptance env is explicitly enabled.

- [ ] **Step 8: Run full verification**

Run:

```bash
pnpm test
pnpm build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit Task 9**

```bash
git add scripts package.json tests/smoke
git commit -m "test: add Wave 7 workflow dogfood"
```

## Final Review Checklist

- [ ] `Continue execution` never creates a replacement Codex session.
- [ ] Existing-job continuation creates no new runtime job.
- [ ] Relaunch continuation keeps the same `RunSession.id` and writes `ExecutionContinuationLineage`.
- [ ] `Respond to review` creates no `RunSession`.
- [ ] `Respond to review` uses `plan_item_workflow_action + generation`, not `automation_action_run`.
- [ ] `Respond to review` persists first-class `ReviewResponse`.
- [ ] `Request fix` creates a new `RunSession` with `RunSessionAttemptLineage(review_fix)`.
- [ ] Fix attempt keeps same `CodexSession.id` and thread digest.
- [ ] Abandon/new-session requires explicit confirmation and deterministic `next_action`.
- [ ] Same-status events create no `PlanItemWorkflowTransition` rows.
- [ ] Stale terminalization cannot overwrite newer continuation/fix state.
- [ ] Public DTO and UI expose no raw thread ids, capsule refs, memory refs, environment refs, local paths, credential payloads, worker ids, or lease tokens.
- [ ] Forbidden legacy public routes fail closed.
- [ ] `pnpm test` passes.
- [ ] `pnpm build` passes.
- [ ] `git diff --check` passes.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-07-plan-item-execution-continuation-review-fix-loop.md`.

Two execution options:

1. Subagent-Driven (recommended) - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. Inline Execution - execute tasks in this session using executing-plans, batch execution with checkpoints.

Recommended choice: Subagent-Driven, because Tasks 1-9 touch distinct layers but must be reviewed after each boundary.
