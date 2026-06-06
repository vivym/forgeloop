# Plan Item Execution Handoff Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start the first real Superpowers execution turn from a `PlanItemWorkflow` in `execution_ready` while preserving the same `CodexSession`, runtime capsule, and Codex thread continuity.

**Architecture:** Add a workflow-owned execution-start command to `PlanItemWorkflowService`, then route the existing `run_execution` runtime channel through workflow/session/turn lineage instead of package-owned legacy starts. Runtime work remains in the existing remote worker path, but workflow-owned jobs must restore the latest capsule before Docker startup, resume the same thread with `resumeRun`, terminalize behind lease/CAS predicates, and expose only public-safe supervision data.

**Tech Stack:** TypeScript, pnpm, Vitest, NestJS control-plane API, Drizzle/Postgres, Zod contracts, ForgeLoop domain/db/workflow packages, Codex runtime capsule infrastructure, `packages/codex-worker-runtime`, existing run-execution worker.

---

## Scope Check

This plan implements only `docs/superpowers/specs/2026-06-06-plan-item-execution-handoff-continuity-design.md`.

In scope:

- `POST /plan-item-workflows/:workflowId/execution/start` as the only public product execution start route.
- Workflow-owned creation or reuse of one ready `ExecutionPackage`.
- Creation of the first workflow-owned `RunSession`.
- Creation of one `CodexSessionTurn` with execution intent.
- Creation of one `CodexRuntimeJob` with `target_kind = run_execution`.
- Workspace bundle creation and binding to the runtime job.
- Worker-side restore of the latest Codex runtime capsule before execution.
- Worker-side resume of the same Codex thread through `driver.resumeRun`.
- Terminalization of runtime job, run session, execution turn, latest capsule, memory/environment refs, and workflow status.
- Public-safe execution supervision data in the Plan Item workspace.
- Deterministic fake dogfood and credentialed real-runtime dogfood for the handoff.
- No-baggage removal or fail-closed behavior for legacy public execution start routes.

Out of scope:

- Interruption continuation.
- Code review response turns.
- Fix-loop continuation.
- Human review comment handling.
- Explicit fork selection.
- Abandon/new-session recovery.
- PR creation or merge automation.
- Automatic QA handoff.
- Generic task extraction from Implementation Plan Doc checkbox content.
- New execution runner infrastructure parallel to the existing `run_execution` pipeline.

## File Structure

### Contracts And Domain

- Modify `packages/domain/src/codex-runtime.ts`
  - Extend `CodexRunExecutionWorkloadV1` with workflow/session continuity fields or a strictly validated companion envelope.
  - Extend `CodexRunExecutionRuntimeJobResult` with output capsule, memory bundle, memory delta, environment manifest, execution turn id, and thread digest evidence.
  - Add validators that reject workflow-owned run execution without continuity fields, capsule digest equality, and output capsule evidence.
- Modify `packages/domain/src/plan-item-workflow.ts`
  - Add helper predicates for execution start, execution terminalization, and blocked/code-review transitions if they are not already reusable.
  - Keep `ExecutionPackage.codex_session_turn_id` semantics as immutable package-generation provenance.
- Modify `packages/contracts/src/plan-item-workflow.ts`
  - Add public-safe execution run summary fields to `planItemWorkflowPublicDtoSchema` if the UI/API needs them.
  - Do not expose raw `codex_thread_id`, capsule refs, memory refs, environment refs, local paths, worker ids, lease tokens, credential payloads, or auth materialization.
- Modify `tests/domain/codex-runtime.test.ts`
  - Add workload and terminal result validator tests for workflow-owned run execution.
- Modify `tests/domain/plan-item-workflow.test.ts`
  - Add transition and no-baggage tests for execution handoff.
- Modify `tests/contracts/plan-item-workflow.test.ts`
  - Add public projection safety tests.

### Database And Repository

- Modify `packages/db/src/schema/run-session.ts`
  - Add a session-level active execution uniqueness invariant if current package-level uniqueness is insufficient.
- Modify `packages/db/src/schema/codex-runtime.ts`
  - Add partial unique/index support for active workflow-owned `run_execution` jobs by `codex_session_id` if needed.
- Add a migration under `packages/db/migrations/`
  - Add partial unique index or constraints for active execution per `codex_session_id`.
  - Add partial non-null/check constraints for workflow-owned execution package, run session, and runtime job lineage where feasible.
- Modify `packages/db/src/repositories/delivery-repository.ts`
  - Add repository methods for workflow execution start, runtime job lineage matching, active execution lookup, and guarded terminalization if existing methods cannot express the spec.
- Modify `packages/db/src/repositories/in-memory-delivery-repository.ts`
  - Implement the same constraints and compare-and-set semantics for tests.
- Modify `packages/db/src/repositories/drizzle-delivery-repository.ts`
  - Implement transactional locking, lineage guards, session-level active uniqueness, and terminalization predicates.
- Modify `tests/db/plan-item-workflow-repository.test.ts`
  - Add repository tests for lineage, idempotency, and stale terminalization.
- Modify `tests/db/codex-runtime-repository.test.ts`
  - Add runtime job lineage matching and worker-only workload projection tests.
- Modify `tests/db/schema.test.ts`
  - Add schema/index assertions.

### Control-Plane API And Services

- Modify `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts`
  - Add `startWorkflowExecutionBodySchema`.
- Modify `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.controller.ts`
  - Add `POST /plan-item-workflows/:workflowId/execution/start`.
- Modify `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts`
  - Add `startExecution`.
  - Validate `execution_ready`, actor authorization, approved current Spec/Implementation Plan revisions, current Plan Item revision, readiness record, active session, safe latest capsule, runtime binding, package reuse predicates, and duplicate-start idempotency.
  - Create execution turn, run session, workspace bundle, runtime job, audit event, and workflow transition in one transaction.
- Modify `apps/control-plane-api/src/modules/execution-packages/execution-package.service.ts`
  - Add strict workflow execution package reuse predicates.
  - Stop silently mutating workflow/session/turn refs on reusable packages.
  - Use `driver_actor_id` semantics for Plan Item execution packages and reject `owner_actor_id` public aliases.
- Modify `apps/control-plane-api/src/modules/run-control/execution-package-runs.controller.ts`
  - Remove public execution start behavior or make `run`, `rerun`, and `force-rerun` fail closed for workflow-owned packages.
- Modify `apps/control-plane-api/src/modules/run-control/run-control.service.ts`
  - Keep read-only run supervision.
  - Prevent direct run/rerun/force-rerun from becoming a workflow-owned execution start shim.
- Modify `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
  - When the trusted worker terminalizes a workflow-owned `run_execution` job, consume the validated terminal result and call a guarded workflow execution terminalizer.
  - On success, atomically terminalize runtime job, run session, execution turn, latest capsule/memory/environment refs, and workflow status.
  - On failure/cancellation, atomically terminalize failure state and transition workflow to `blocked` only when lease/capsule/workflow predicates match.
- Modify `apps/control-plane-api/src/modules/audit/audit-writer.service.ts`
  - Add or reuse immutable audit write for workflow execution start.
- Modify `apps/control-plane-api/src/modules/query/public-run-session-projection.ts`
  - Redact worker-only workload fields from public/admin/generic runtime projections.
- Modify `tests/api/plan-item-workflows.test.ts`
  - Add API tests for the workflow execution start command.
- Modify `tests/api/codex-runtime-control-plane.test.ts`
  - Add workflow-owned `run_execution` terminalizer tests for success, failure, cancellation, stale terminalization, and public-safe projection.
- Modify `tests/api/delivery-flow.test.ts` or existing run-control API tests
  - Add legacy route fail-closed tests.

### Runtime Worker

- Modify `packages/codex-worker-runtime/src/remote-worker-client.ts`
  - Require workflow-owned run-execution workload continuity fields.
  - Restore the input capsule before Docker app-server startup.
  - Validate input capsule, memory bundle, environment manifest, worker, lease, and thread digest continuity before Docker startup.
  - Use `driver.resumeRun` for `continuation.kind = resume_thread`.
  - Reject `driver.startRun`, `thread/start`, exec fallback, and replacement-thread behavior for workflow-owned jobs.
  - Package and upload output capsule, memory bundle, memory delta, and environment manifest evidence.
  - Include exact output capsule fields in `terminal_result_json`.
- Modify `packages/codex-worker-runtime/src/app-server-launcher.ts`
  - Ensure run-execution launch path accepts the same capsule restore options as generation.
- Modify `packages/codex-worker-runtime/src/codex-runtime-capsule/restorer.ts`
  - Reuse restore validation for run-execution input capsule.
- Modify `packages/codex-worker-runtime/src/codex-runtime-capsule/packager.ts`
  - Reuse output packaging for run-execution terminal results.
- Modify `tests/codex-worker-runtime/remote-worker-client.test.ts`
  - Add tests for restore ordering, `resumeRun`, digest checks, failure paths, and terminal result evidence.
- Modify `tests/domain/codex-runtime.test.ts`
  - Add runtime validator tests for new fields.

### Product UI

- Modify `apps/web/src/shared/api/commands.ts`
  - Add `startPlanItemWorkflowExecution`.
- Modify `apps/web/src/shared/api/types.ts`
  - Add public-safe execution run summary fields if contract types are not imported directly.
- Modify `apps/web/src/shared/api/hooks.ts`
  - Add mutation hook for start execution.
- Modify `apps/web/src/shared/api/query-keys.ts`
  - Invalidate workflow and run-session query keys after start.
- Modify `apps/web/src/features/development-plans/plan-item-workflow-workspace.tsx`
  - Show `Start execution` only when `workflow.status === 'execution_ready'`.
  - After start, show execution-running state, public-safe run summary, worker status, changed files/checks when available, and no raw runtime refs.
- Modify `apps/web/src/features/development-plans/plan-item-workflow-view-model.ts`
  - Map execution state into UI view model.
- Modify `tests/web/development-plan-routes.test.tsx`
  - Add Start execution UI and public-safe display tests.

### Dogfood And No-Baggage Guards

- Create `scripts/plan-item-execution-handoff-dogfood.ts`
  - Deterministic fake worker dogfood.
- Create `scripts/plan-item-execution-handoff-real-dogfood.ts`
  - Credentialed real-runtime dogfood.
- Modify `package.json`
  - Add:
    - `dogfood:plan-item-execution-handoff`
    - `dogfood:plan-item-execution-handoff:real`
- Modify `scripts/check-codex-runtime-superpowers-no-baggage.ts`
  - Add route/name checks for legacy public execution starts and old owner aliases.
- Add or modify `tests/smoke/plan-item-execution-handoff-dogfood-script.test.ts`
  - Validate script pass/skip reporting.
- Add or modify no-baggage smoke tests
  - Ensure forbidden public start routes and stale names are rejected.

## Implementation Rules

- Do not introduce `PlanItemExecutionRunner` or any second execution system.
- Do not keep public compatibility wrappers for `execution-packages/:packageId/run`, `/rerun`, or `/force-rerun` on workflow-owned packages.
- Do not start execution from Source Document, Spec Doc, Implementation Plan Doc, Execution Package page, generic Work Item, DevelopmentPlanItem, or old task route.
- Do not create a new Codex session or replacement thread when a valid workflow session exists.
- Do not reinterpret `ExecutionPackage.codex_session_turn_id` as the execution turn. It is package-generation provenance.
- For Plan Item execution packages, use `driver_actor_id` semantics. Do not expose, accept, or backfill `owner_actor_id` compatibility aliases for the Plan Item execution driver.
- `CodexRuntimeJob.workflow_id`, `codex_session_id`, and `codex_session_turn_id` must match trusted payload lineage exactly.
- Missing or inconsistent `codex_session_runtime_context` and `codex_session_terminalization` are hard validation failures for workflow-owned run execution.
- Runtime failure and cancellation terminalization must use the same guarded predicates as successful terminalization.
- Public DTOs and default admin/operator diagnostics must never expose raw thread ids, capsule refs, memory refs, environment refs, local filesystem paths, lease tokens, credential metadata, auth materialization, or raw worker payloads.
- Use TDD. Write failing tests first for each task.
- Commit after each task when targeted tests pass.

## Task 1: Runtime Contract Continuity Fields

**Files:**
- Modify: `packages/domain/src/codex-runtime.ts`
- Modify: `tests/domain/codex-runtime.test.ts`

- [ ] **Step 1: Write failing workload validator tests**

In `tests/domain/codex-runtime.test.ts`, add a valid workflow-owned run-execution workload fixture:

```ts
const workflowRunExecutionWorkload = {
  schema_version: 'codex_run_execution_workload.v1',
  runtime_job_id: 'runtime-job-1',
  plan_item_workflow_id: 'workflow-1',
  development_plan_id: 'development-plan-1',
  development_plan_item_id: 'item-1',
  run_session_id: 'run-session-1',
  execution_package_id: 'execution-package-1',
  execution_package_version: 1,
  workspace_bundle_id: 'workspace-bundle-1',
  workspace_bundle_digest: digestA,
  package_prompt_ref: 'artifact://codex-runtime-jobs/runtime-job-1/prompt',
  package_prompt_digest: digestB,
  execution_context_ref: 'artifact://codex-runtime-jobs/runtime-job-1/context',
  execution_context_digest: digestC,
  path_policy_digest: digestA,
  output_schema_version: 'codex_run_execution_result.v1',
  created_at: '2026-06-06T00:00:00.000Z',
  expires_at: '2026-06-06T00:10:00.000Z',
  workspace_acquisition_json: {
    manifest_digest: digestB,
    size_bytes: 128,
  },
  codex_session_runtime_context: {
    schema_version: 'codex_session_runtime_context.v1',
    codex_session_id: 'session-1',
    codex_session_turn_id: 'turn-execution-1',
    lease_id: 'lease-1',
    lease_epoch: 2,
    worker_id: 'worker-1',
    worker_session_digest: digestC,
    expected_input_capsule_digest: digestA,
    turn_group_status: 'complete',
    continuation: {
      kind: 'resume_thread',
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: 'thread-1' }),
    },
  },
  codex_session_terminalization: {
    schema_version: 'codex_session_terminalization.v1',
    lease_token: 'lease-token-secret',
    codex_session_id: 'session-1',
    codex_session_turn_id: 'turn-execution-1',
    input_capsule_id: 'capsule-1',
    input_capsule_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-1',
    input_capsule_digest: digestA,
    input_memory_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-1',
    input_memory_bundle_digest: digestB,
    input_environment_manifest_ref: 'artifact://internal/codex_environment_manifest/codex_session/session-1/env-1',
    input_environment_manifest_digest: digestC,
    expected_input_capsule_digest: digestA,
  },
} satisfies CodexRunExecutionWorkloadV1;
```

Assert:

```ts
expect(validateCodexRunExecutionWorkload(workflowRunExecutionWorkload)).toEqual(workflowRunExecutionWorkload);
expect(() =>
  validateCodexRunExecutionWorkload({
    ...workflowRunExecutionWorkload,
    codex_session_runtime_context: undefined,
  }),
).toThrow();
expect(() =>
  validateCodexRunExecutionWorkload({
    ...workflowRunExecutionWorkload,
    codex_session_runtime_context: {
      ...workflowRunExecutionWorkload.codex_session_runtime_context,
      continuation: { kind: 'start_thread' },
    },
  }),
).toThrow();
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm vitest run tests/domain/codex-runtime.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because `validateCodexRunExecutionWorkload` and new fields do not exist yet.

- [ ] **Step 3: Extend runtime workload types and validators**

In `packages/domain/src/codex-runtime.ts`:

- add `plan_item_workflow_id`, `development_plan_id`, `development_plan_item_id`, `workspace_acquisition_json`, `codex_session_runtime_context`, and `codex_session_terminalization` to `CodexRunExecutionWorkloadV1`;
- export `validateCodexRunExecutionWorkload`;
- reuse `validateCodexSessionRuntimeContext`;
- add strict key sets for run-execution workload continuity fields;
- require `continuation.kind === 'resume_thread'`;
- require `turn_group_status === 'complete'`;
- require matching `codex_session_id`, `codex_session_turn_id`, and expected/input capsule digests across context and terminalization;
- require input memory and environment refs/digests.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm vitest run tests/domain/codex-runtime.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/codex-runtime.ts tests/domain/codex-runtime.test.ts
git commit -m "feat: validate workflow run execution continuity workload"
```

## Task 2: Run Execution Terminal Result Continuation Evidence

**Files:**
- Modify: `packages/domain/src/codex-runtime.ts`
- Modify: `tests/domain/codex-runtime.test.ts`

- [ ] **Step 1: Write failing terminal-result tests**

In `tests/domain/codex-runtime.test.ts`, extend the run-execution terminal result fixture:

```ts
const workflowRunExecutionResult = {
  task_kind: 'run_execution',
  output_schema_version: 'codex_run_execution_result.v1',
  execution_package_id: 'execution-package-1',
  execution_package_version: 1,
  run_session_id: 'run-session-1',
  workspace_bundle_digest: digestA,
  workspace_bundle_manifest_digest: digestB,
  mounted_task_workspace_digest: digestC,
  changed_files: ['README.md'],
  check_results: [],
  execution_artifacts: [],
  output_capsule_id: 'capsule-2',
  output_capsule_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-2',
  output_capsule_digest: digestA,
  output_capsule_manifest_digest: digestB,
  output_memory_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-2',
  output_memory_bundle_digest: digestC,
  memory_delta_artifact_ref: 'artifact://internal/codex_memory_delta/codex_session/session-1/delta-2',
  memory_delta_digest: digestA,
  output_environment_manifest_ref: 'artifact://internal/codex_environment_manifest/codex_session/session-1/env-2',
  output_environment_manifest_digest: digestB,
  codex_session_turn_id: 'turn-execution-1',
  codex_thread_id_digest: digestC,
  public_summary: 'Execution completed.',
} satisfies CodexRunExecutionRuntimeJobResult;
```

Assert:

```ts
expect(validateCodexRuntimeJobTerminalResult(workflowRunExecutionResult)).toEqual(workflowRunExecutionResult);
expect(() =>
  validateCodexRuntimeJobTerminalResult({
    ...workflowRunExecutionResult,
    output_capsule_digest: undefined,
  }),
).toThrow();
expect(() =>
  validateCodexRuntimeJobTerminalResult({
    ...workflowRunExecutionResult,
    output_memory_bundle_ref: undefined,
  }),
).toThrow();
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm vitest run tests/domain/codex-runtime.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because the run-execution result validator currently does not require output capsule evidence.

- [ ] **Step 3: Extend result type and validator**

In `packages/domain/src/codex-runtime.ts`:

- add `output_capsule_id`, `output_capsule_ref`, `output_capsule_digest`, `output_capsule_manifest_digest`;
- add `output_memory_bundle_ref`, `output_memory_bundle_digest`;
- add `memory_delta_artifact_ref`, `memory_delta_digest`;
- add `output_environment_manifest_ref`, `output_environment_manifest_digest`;
- add `codex_session_turn_id` and `codex_thread_id_digest`;
- update `codexRunExecutionRuntimeJobResultKeys`;
- validate artifact refs with existing internal artifact helpers;
- require memory delta ref/digest together.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm vitest run tests/domain/codex-runtime.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/codex-runtime.ts tests/domain/codex-runtime.test.ts
git commit -m "feat: require run execution continuation evidence"
```

## Task 3: Repository Lineage And Terminalization Invariants

**Files:**
- Modify: `packages/db/src/schema/run-session.ts`
- Modify: `packages/db/src/schema/codex-runtime.ts`
- Add: `packages/db/migrations/0004_plan_item_execution_handoff.sql`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Modify: `tests/db/plan-item-workflow-repository.test.ts`
- Modify: `tests/db/codex-runtime-repository.test.ts`
- Modify: `tests/db/schema.test.ts`

- [ ] **Step 1: Write failing repository tests for active execution uniqueness**

In `tests/db/plan-item-workflow-repository.test.ts`, add a shared repository test:

```ts
it.each(repositoryCases)('rejects two active execution runs for one CodexSession in %s', async (_name, createRepository) => {
  const repository = await createRepository();
  await seedExecutionReadyWorkflow(repository);
  await repository.saveRunSession(activeWorkflowRunSession({ id: 'run-session-1', codex_session_id: 'session-1' }));

  await expect(
    repository.saveRunSession(activeWorkflowRunSession({ id: 'run-session-2', codex_session_id: 'session-1' })),
  ).rejects.toMatchObject({ code: 'workflow_execution_already_running' });
});
```

Use existing fixture helpers where possible. If no `repositoryCases` helper exists, mirror the existing in-memory/Drizzle pattern in the file.

- [ ] **Step 2: Write failing runtime job lineage tests**

In `tests/db/codex-runtime-repository.test.ts`, add:

```ts
await expect(
  repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope({
    ...validRunExecutionJobInput(),
    workflow_id: 'workflow-1',
    codex_session_id: 'session-1',
    codex_session_turn_id: 'turn-1',
    input_json: {
      ...validRunExecutionJobInput().input_json,
      plan_item_workflow_id: 'workflow-1',
      codex_session_id: 'session-1',
      codex_session_turn_id: 'different-turn',
    },
  }),
).rejects.toMatchObject({ code: 'codex_runtime_job_unavailable' });
```

- [ ] **Step 3: Write failing terminalization stale tests**

In `tests/db/plan-item-workflow-repository.test.ts`, add tests proving:

- success workflow execution terminalization updates `CodexSession.latest_capsule_id/latest_capsule_digest`, latest memory refs/digests, latest environment refs/digests, run session, execution turn, runtime job, and workflow only when all predicates match;
- success terminalization transitions `PlanItemWorkflow.status` from `execution_running` to `code_review`;
- failure terminalization transitions workflow to `blocked` only when identity, lease, input capsule, execution turn, run session, runtime job, and workflow predicates match;
- cancellation terminalization transitions workflow to `blocked` only when identity, lease, input capsule, execution turn, run session, runtime job, and workflow predicates match;
- stale failure/cancellation records stale evidence and does not mutate workflow/run/turn/job/latest capsule/lease fields.

- [ ] **Step 4: Run failing tests**

Run:

```bash
pnpm vitest run tests/db/plan-item-workflow-repository.test.ts tests/db/codex-runtime-repository.test.ts tests/db/schema.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because repository invariants and migration do not exist.

- [ ] **Step 5: Add schema and migration constraints**

Add `packages/db/migrations/0004_plan_item_execution_handoff.sql` with:

```sql
create unique index if not exists run_sessions_one_active_execution_per_codex_session
on run_sessions (codex_session_id)
where codex_session_id is not null
  and status in ('queued','running','waiting_for_input','stalled','resuming','cancel_requested');

create unique index if not exists codex_runtime_jobs_one_active_run_execution_per_codex_session
on codex_runtime_jobs (codex_session_id)
where target_kind = 'run_execution'
  and codex_session_id is not null
  and status in ('queued','accepted','materializing','running');
```

Add partial check constraints where Drizzle migration syntax and current data permit. If Postgres cannot express a clean partial check in this migration, enforce the non-null workflow-owned lineage in repository guards and document that in a migration comment.

- [ ] **Step 6: Implement in-memory repository guards**

In `packages/db/src/repositories/in-memory-delivery-repository.ts`:

- reject workflow-owned `ExecutionPackage`, `RunSession`, and `CodexRuntimeJob` rows with missing workflow/session/turn lineage;
- reject active run sessions with duplicate `codex_session_id`;
- reject active `run_execution` runtime jobs with duplicate `codex_session_id`;
- reject runtime job create/replay when first-class lineage differs from `input_json`;
- implement a guarded workflow execution terminalization primitive for success/failure/cancellation with identical lease/input capsule/turn/run/job/workflow predicates;
- ensure the primitive updates runtime job, run session, execution turn, latest capsule/memory/environment refs, and workflow status in one atomic operation or records stale evidence without mutating active state.

- [ ] **Step 7: Implement Drizzle repository guards**

In `packages/db/src/repositories/drizzle-delivery-repository.ts`:

- mirror the in-memory guards before insert/update;
- rely on DB indexes for race protection;
- convert unique violations into `DomainError('workflow_execution_already_running', ...)` or existing public-safe runtime error codes;
- implement the same guarded workflow execution terminalization primitive in one transaction with conditional updates.

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm vitest run tests/db/plan-item-workflow-repository.test.ts tests/db/codex-runtime-repository.test.ts tests/db/schema.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/schema/run-session.ts packages/db/src/schema/codex-runtime.ts packages/db/migrations/0004_plan_item_execution_handoff.sql packages/db/src/repositories/delivery-repository.ts packages/db/src/repositories/in-memory-delivery-repository.ts packages/db/src/repositories/drizzle-delivery-repository.ts tests/db/plan-item-workflow-repository.test.ts tests/db/codex-runtime-repository.test.ts tests/db/schema.test.ts
git commit -m "feat: enforce workflow execution lineage invariants"
```

## Task 4: Workflow Execution Start Command

**Files:**
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts`
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.controller.ts`
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts`
- Modify: `apps/control-plane-api/src/modules/execution-packages/execution-package.service.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
- Modify: `apps/control-plane-api/src/modules/audit/audit-writer.service.ts`
- Modify: `apps/control-plane-api/src/modules/query/public-run-session-projection.ts`
- Modify: `tests/api/plan-item-workflows.test.ts`
- Modify: `tests/api/codex-runtime-control-plane.test.ts`

- [ ] **Step 1: Write failing API tests for preconditions**

In `tests/api/plan-item-workflows.test.ts`, add tests for:

```ts
await request(app.getHttpServer())
  .post('/plan-item-workflows/workflow-1/execution/start')
  .send({ actor_id: 'actor-tech', idempotency_key: 'start-execution-1' })
  .expect(422)
  .expect(({ body }) => expect(body.code).toBe('workflow_invalid_transition'));
```

Add separate cases for:

- missing active session;
- stale Plan Item revision;
- missing approved Spec Doc;
- missing approved Implementation Plan Doc;
- not-ready `ExecutionReadinessRecord`;
- missing latest capsule;
- unauthorized actor;
- credential binding mismatch.

- [ ] **Step 2: Write failing API tests for successful start**

Add a test that seeds a full `execution_ready` workflow and asserts:

```ts
const response = await request(app.getHttpServer())
  .post('/plan-item-workflows/workflow-1/execution/start')
  .send({ actor_id: 'actor-tech', idempotency_key: 'start-execution-1' })
  .expect(201);

expect(response.body.status).toBe('execution_running');
expect(response.body.session.continuity_state).toBe('running');
expect(response.body.execution_run_summary).toMatchObject({
  run_session_id: expect.any(String),
  execution_package_id: expect.any(String),
  codex_thread_id_digest: expect.stringMatching(/^sha256:/),
});
expect(JSON.stringify(response.body)).not.toContain('codex_thread_id":"');
```

- [ ] **Step 3: Write failing API tests for idempotency and concurrency**

In `tests/api/plan-item-workflows.test.ts`, add cases that prove duplicate starts cannot fork execution:

```ts
const first = await request(app.getHttpServer())
  .post('/plan-item-workflows/workflow-1/execution/start')
  .send({ actor_id: 'actor-tech', idempotency_key: 'start-execution-1' })
  .expect(201);

const second = await request(app.getHttpServer())
  .post('/plan-item-workflows/workflow-1/execution/start')
  .send({ actor_id: 'actor-tech', idempotency_key: 'start-execution-1' })
  .expect(200);

expect(second.body.execution_run_summary).toMatchObject(first.body.execution_run_summary);
expect(await repository.listActiveRunSessionsForCodexSession('session-1')).toHaveLength(1);
expect(await repository.listActiveRunExecutionRuntimeJobsForCodexSession('session-1')).toHaveLength(1);
```

Add separate cases for:

- same-lineage duplicate requests with different HTTP retries returning the existing active execution projection;
- mismatched package/session/capsule/revision duplicate requests returning `409` or `422` with a public-safe code;
- two concurrent `Start execution` requests, using `Promise.allSettled`, creating exactly one active `RunSession`, one execution `CodexSessionTurn`, and one `CodexRuntimeJob`;
- terminal runtime job with complete run/session/workflow terminalization returning the completed lineage projection;
- terminal runtime job with incomplete run/session/workflow terminalization either safely terminalizing or returning a recovery-required blocker without creating new execution lineage.

- [ ] **Step 4: Write failing API tests for start audit evidence**

In `tests/api/plan-item-workflows.test.ts`, assert the immutable start audit event contains digest-level execution evidence:

```ts
expect(startAuditEvent).toMatchObject({
  actor_id: 'actor-tech',
  workflow_id: 'workflow-1',
  plan_item_id: 'item-1',
  codex_session_id: 'session-1',
  codex_session_turn_id: expect.any(String),
  run_session_id: expect.any(String),
  runtime_job_id: expect.any(String),
  workspace_bundle_digest: expect.stringMatching(/^sha256:/),
  input_capsule_digest: expect.stringMatching(/^sha256:/),
  codex_thread_id_digest: expect.stringMatching(/^sha256:/),
});
expect(JSON.stringify(startAuditEvent)).not.toContain('codex_thread_id":"');
expect(JSON.stringify(startAuditEvent)).not.toContain('artifact://internal');
expect(JSON.stringify(startAuditEvent)).not.toContain('lease-token');
```

- [ ] **Step 5: Write failing API tests for workflow-owned terminalization**

In `tests/api/codex-runtime-control-plane.test.ts`, add tests that call the real trusted worker endpoint:

```ts
await request(app.getHttpServer())
  .post(`/internal/codex-workers/worker-1/runtime-jobs/${runtimeJobId}/terminal`)
  .send(workerTerminalBody({
    terminal_status: 'succeeded',
    terminal_result_json: workflowRunExecutionResult,
  }))
  .expect(201);

expect(await repository.getRunSession(runSessionId)).toMatchObject({ status: 'succeeded' });
expect(await repository.getCodexSessionTurn(executionTurnId)).toMatchObject({ status: 'succeeded' });
expect(await repository.getPlanItemWorkflow(workflowId)).toMatchObject({ status: 'code_review' });
expect((await repository.getCodexSession(sessionId))?.latest_capsule_digest).toBe(workflowRunExecutionResult.output_capsule_digest);
```

Add separate cases for:

- required checks failed but runtime succeeded, transitioning workflow to `code_review` with failed-check evidence;
- runtime failure terminalization transitioning workflow to `blocked` and not updating latest capsule/memory/environment refs;
- cancellation terminalization transitioning workflow to `blocked` and not updating latest capsule/memory/environment refs;
- stale lease/capsule/workflow status terminalization recording stale evidence and not mutating workflow/run/turn/job/latest capsule fields;
- missing output capsule/memory/environment evidence rejecting or blocking without `code_review`.

- [ ] **Step 6: Write failing API tests for worker-payload redaction**

In `tests/api/codex-runtime-control-plane.test.ts`, add tests that seed a workflow-owned `run_execution` runtime job whose trusted `input_json` contains raw worker-only fields:

```ts
expect(JSON.stringify(response.body)).not.toContain('codex_thread_id":"thread-raw');
expect(JSON.stringify(response.body)).not.toContain('artifact://internal');
expect(JSON.stringify(response.body)).not.toContain('lease-token-secret');
expect(JSON.stringify(response.body)).not.toContain('/var/folders/');
expect(response.body.execution_run_summary.codex_thread_id_digest).toMatch(/^sha256:/);
```

Also add a direct projection test for `public-run-session-projection.ts` proving generic/public/admin-safe projections use explicit allowlisted fields and never serialize raw runtime job `input_json`, raw capsule refs, raw memory refs, raw environment refs, lease tokens, credential metadata, auth materialization, app-server payloads, or local filesystem paths.

- [ ] **Step 7: Run the failing API tests**

Run:

```bash
pnpm vitest run tests/api/plan-item-workflows.test.ts tests/api/codex-runtime-control-plane.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because route/service, idempotency behavior, worker terminalization integration, and projection redaction do not exist.

- [ ] **Step 8: Add DTO and route**

In `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts`:

```ts
export const startWorkflowExecutionBodySchema = z.object({
  actor_id: nonEmpty,
  idempotency_key: nonEmpty.optional(),
  rationale_markdown: nonEmpty.optional(),
}).strict();
export type StartWorkflowExecutionBodyDto = z.infer<typeof startWorkflowExecutionBodySchema>;
```

In `PlanItemWorkflowController`:

```ts
@Post('plan-item-workflows/:workflowId/execution/start')
startExecution(
  @Param('workflowId') workflowId: string,
  @Body(new ZodValidationPipe(startWorkflowExecutionBodySchema)) body: StartWorkflowExecutionBodyDto,
) {
  return this.service.startExecution(workflowId, body);
}
```

- [ ] **Step 9: Implement `startExecution` transaction**

In `PlanItemWorkflowService.startExecution`:

- acquire `withObjectLock('plan-item-workflow:${workflowId}')`;
- run inside `withDeliveryTransaction`;
- require workflow status `execution_ready`;
- call existing actor authorization helper with an execution action;
- require active session and latest capsule;
- reject session already running or already owned by a runner;
- validate approved current Spec Doc and Implementation Plan Doc revisions;
- validate current Plan Item revision;
- load ready current `ExecutionReadinessRecord`;
- create or strictly reuse `ExecutionPackage` through `ExecutionPackageService`;
- create `CodexSessionTurn` with `intent: 'execute_plan'`;
- create `RunSession` with workflow/session/execution turn lineage;
- create or bind workspace bundle;
- create `CodexRuntimeJob` with first-class lineage and matching workload lineage;
- write immutable audit event before job is claimable;
- transition workflow `execution_ready -> execution_running` with `execution_package` or `run_session` evidence;
- return public workflow projection.

- [ ] **Step 10: Implement duplicate start idempotency**

Add helper behavior:

- if workflow is already `execution_running` and existing active run lineage matches the same package/version/capsule/session, return existing projection;
- if runtime job terminalization is complete, return completed lineage projection;
- if runtime job is terminal but run/session/workflow projection is incomplete, call safe idempotent terminalizer or return recovery-required blocker;
- reject mismatched package/session/capsule/revision duplicate starts.

- [ ] **Step 11: Implement workflow-owned runtime terminalization integration**

In `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`:

- before the generic `repository.terminalizeCodexRuntimeJob` path mutates the runtime job, load the runtime job/workload and detect `runtimeJob.target_kind === 'run_execution'` with `workflow_id`, `codex_session_id`, and `codex_session_turn_id`;
- validate `terminal_result_json` as `CodexRunExecutionRuntimeJobResult` for successful workflow-owned execution;
- call the guarded workflow execution terminalization primitive from Task 3, passing the worker session token, replay protection, launch lease id, terminal status, reason code, terminal idempotency key, request digest, and terminal result so runtime job terminalization and workflow/session/run/turn terminalization happen in the same repository transaction;
- on success, pass output capsule, output memory bundle, memory delta, output environment manifest, execution turn id, thread digest, run session id, runtime job id, and workflow id into that same terminalizer;
- on runtime failure/cancellation, call the same guarded primitive with failure/cancellation status and public-safe reason code;
- convert stale terminalization into stale evidence without mutating workflow/run/turn/latest capsule state;
- keep generation and non-workflow runtime terminalization behavior on the existing generic path.

- [ ] **Step 12: Implement public-safe runtime projection redaction**

In `apps/control-plane-api/src/modules/query/public-run-session-projection.ts` and any generic Codex runtime control-plane serializers:

- replace runtime-job-input passthrough with explicit allowlisted summary fields;
- expose only digest-level continuity evidence, run/session/package ids, status, timestamps, changed files allowed by policy, check summaries, and artifact kinds;
- remove raw `codex_thread_id`, capsule refs, memory refs, environment refs, lease tokens, credential metadata, auth materialization, app-server payloads, and local paths from default public/admin/generic projections;
- keep trusted worker endpoints unchanged only where worker authentication requires raw internal payloads.

- [ ] **Step 13: Run API tests**

Run:

```bash
pnpm vitest run tests/api/plan-item-workflows.test.ts tests/api/codex-runtime-control-plane.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.controller.ts apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts apps/control-plane-api/src/modules/execution-packages/execution-package.service.ts apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts apps/control-plane-api/src/modules/audit/audit-writer.service.ts apps/control-plane-api/src/modules/query/public-run-session-projection.ts tests/api/plan-item-workflows.test.ts tests/api/codex-runtime-control-plane.test.ts
git commit -m "feat: add workflow execution start command"
```

## Task 5: Retire Legacy Public Execution Starts

**Files:**
- Modify: `apps/control-plane-api/src/modules/run-control/execution-package-runs.controller.ts`
- Modify: `apps/control-plane-api/src/modules/run-control/run-control.service.ts`
- Modify: `apps/control-plane-api/src/modules/execution-packages/execution-packages.controller.ts`
- Modify: `apps/web/src/features/development-plans/plan-item-gates.tsx`
- Modify: `apps/web/src/features/development-plans/plan-item-workflow-workspace.tsx`
- Modify: `tests/api/delivery-flow.test.ts`
- Modify: `tests/api/plan-item-workflows.test.ts`
- Modify: `tests/api/codex-runtime-control-plane.test.ts`
- Modify: `scripts/check-codex-runtime-superpowers-no-baggage.ts`

- [ ] **Step 1: Write failing legacy route tests**

Add tests proving workflow-owned execution packages cannot run through legacy routes:

```ts
for (const route of ['run', 'rerun', 'force-rerun']) {
  await request(app.getHttpServer())
    .post(`/execution-packages/${workflowOwnedPackageId}/${route}`)
    .send({ requested_by_actor_id: 'actor-tech' })
    .expect(410)
    .expect(({ body }) => expect(body.code).toBe('workflow_legacy_entrypoint_disabled'));
}
```

Also test that non-workflow legacy packages either remain read-only/test-only or fail according to the chosen product policy.

Add tests or no-baggage fixture cases proving the following forbidden public mutation roots cannot start workflow-owned execution and do not forward to `startExecution`:

- Source Document shortcuts;
- Spec Doc shortcuts;
- Implementation Plan Doc shortcuts;
- generic Work Item execution starts;
- DevelopmentPlanItem direct execution starts;
- old task execution-start routes.

For any route that does not currently exist, add a no-baggage guard assertion that fails if matching public route strings, UI command names, or DTO action names are introduced later.

- [ ] **Step 2: Run failing tests**

Run:

```bash
pnpm vitest run tests/api/delivery-flow.test.ts tests/api/plan-item-workflows.test.ts tests/api/codex-runtime-control-plane.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because routes still enqueue runs.

- [ ] **Step 3: Disable legacy public start behavior**

In `ExecutionPackageRunsController` or `RunControlService.assertPublicRunPackageMutationAllowed`:

- if package has `workflow_id`, throw `GoneException` or `UnprocessableEntityException` with `workflow_legacy_entrypoint_disabled`;
- do not forward legacy routes to `startExecution`;
- keep read-only run/session projections intact.

- [ ] **Step 4: Remove UI legacy calls**

In web files:

- remove buttons that call execution package `run/rerun/force-rerun` for workflow-owned Plan Items;
- ensure `Start execution` calls only `POST /plan-item-workflows/:workflowId/execution/start`;
- update labels to avoid Execution Package as a mutation root.

- [ ] **Step 5: Update no-baggage guard**

In `scripts/check-codex-runtime-superpowers-no-baggage.ts`, add checks for:

- public UI/API calls to `/execution-packages/:packageId/run`;
- `/rerun`;
- `/force-rerun`;
- Source Document, Spec Doc, Implementation Plan Doc, generic Work Item, DevelopmentPlanItem, or old task command names/routes that start workflow execution directly;
- `owner_actor_id` in public Plan Item execution DTOs or UI command payloads.

- [ ] **Step 6: Run tests and guard**

Run:

```bash
pnpm vitest run tests/api/delivery-flow.test.ts tests/api/plan-item-workflows.test.ts tests/api/codex-runtime-control-plane.test.ts tests/web/development-plan-routes.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
pnpm check:codex-runtime-superpowers-no-baggage
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/control-plane-api/src/modules/run-control/execution-package-runs.controller.ts apps/control-plane-api/src/modules/run-control/run-control.service.ts apps/control-plane-api/src/modules/execution-packages/execution-packages.controller.ts apps/web/src/features/development-plans/plan-item-gates.tsx apps/web/src/features/development-plans/plan-item-workflow-workspace.tsx tests/api/delivery-flow.test.ts tests/api/plan-item-workflows.test.ts tests/api/codex-runtime-control-plane.test.ts scripts/check-codex-runtime-superpowers-no-baggage.ts
git commit -m "feat: retire legacy workflow execution starts"
```

## Task 6: Worker Capsule Restore And ResumeRun Execution

**Files:**
- Modify: `packages/codex-worker-runtime/src/remote-worker-client.ts`
- Modify: `packages/codex-worker-runtime/src/app-server-launcher.ts`
- Modify: `packages/codex-worker-runtime/src/codex-runtime-capsule/restorer.ts`
- Modify: `packages/codex-worker-runtime/src/codex-runtime-capsule/packager.ts`
- Modify: `tests/codex-worker-runtime/remote-worker-client.test.ts`

- [ ] **Step 1: Write failing worker tests for restore before Docker**

In `tests/codex-worker-runtime/remote-worker-client.test.ts`, add a test with spies:

```ts
const calls: string[] = [];
const capsuleManager = {
  restore: vi.fn(async () => calls.push('restore')),
  package: vi.fn(async () => calls.push('package')),
};
const launcher = {
  startFromMaterialization: vi.fn(async () => {
    calls.push('docker-start');
    return appServerSession();
  }),
};

await worker.runOnce();

expect(calls.indexOf('restore')).toBeLessThan(calls.indexOf('docker-start'));
```

Use the existing remote worker fixture helpers and add missing fields to `runExecutionWorkload`.

- [ ] **Step 2: Write failing worker tests for `resumeRun`**

Add a fake driver:

```ts
const driver = {
  startRun: vi.fn(async function* () { throw new Error('startRun must not be called'); }),
  resumeRun: vi.fn(async function* () {
    yield { kind: 'terminal', status: 'succeeded', changedFiles: ['README.md'], checks: [] };
  }),
  cancelRun: vi.fn(),
  close: vi.fn(),
};

expect(driver.resumeRun).toHaveBeenCalledWith(expect.objectContaining({
  runtimeMetadata: expect.objectContaining({ codex_thread_id: 'thread-1' }),
}));
expect(driver.startRun).not.toHaveBeenCalled();
```

- [ ] **Step 3: Write failing worker tests for fail-closed continuity**

Add cases for:

- missing `codex_session_runtime_context`;
- `continuation.kind = start_thread`;
- capsule digest mismatch;
- thread digest mismatch;
- restore failure;
- `resumeRun` failure.

Each should terminalize failed with a public-safe blocker and should not call `startRun`.

- [ ] **Step 4: Run failing worker tests**

Run:

```bash
pnpm vitest run tests/codex-worker-runtime/remote-worker-client.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because current run-execution path starts Docker without capsule restore and calls `driver.startRun`.

- [ ] **Step 5: Implement restore ordering**

In `remote-worker-client.ts`:

- validate workload with `validateCodexRunExecutionWorkload`;
- parse `codex_session_terminalization` before Docker startup;
- require capsule manager for workflow-owned run execution;
- restore input capsule into fresh `CODEX_HOME`;
- write config/auth after restore from launch materialization;
- validate locator repair manifest before Docker startup;
- allow only bounded locator rewrite after startup and before `resumeRun` when container path is required.

In `app-server-launcher.ts`, expose the same capsule restore options for run execution that generation already uses.

- [ ] **Step 6: Implement `resumeRun` branch**

In `runRunExecutionWithControl` or its caller:

- branch on `codex_session_runtime_context.continuation.kind`;
- for `resume_thread`, call `driver.resumeRun`;
- pass `runtimeMetadata.codex_thread_id`;
- reject `start_thread` for workflow-owned Wave 6 execution;
- verify terminal/resumed thread digest where driver evidence is available;
- fail closed on fallback behavior.

- [ ] **Step 7: Implement output capsule packaging**

After successful execution:

- package new Codex runtime capsule;
- upload output memory bundle and environment manifest evidence;
- include `output_capsule_id/ref/digest/manifest_digest`, memory refs/digests, memory delta refs/digests, environment refs/digests, execution turn id, and thread digest in terminal result.

- [ ] **Step 8: Run worker tests**

Run:

```bash
pnpm vitest run tests/codex-worker-runtime/remote-worker-client.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/codex-worker-runtime/src/remote-worker-client.ts packages/codex-worker-runtime/src/app-server-launcher.ts packages/codex-worker-runtime/src/codex-runtime-capsule/restorer.ts packages/codex-worker-runtime/src/codex-runtime-capsule/packager.ts tests/codex-worker-runtime/remote-worker-client.test.ts
git commit -m "feat: resume workflow execution from runtime capsule"
```

## Task 7: Public-Safe Execution Supervision UI

**Files:**
- Modify: `packages/contracts/src/plan-item-workflow.ts`
- Modify: `apps/web/src/shared/api/commands.ts`
- Modify: `apps/web/src/shared/api/hooks.ts`
- Modify: `apps/web/src/shared/api/query-keys.ts`
- Modify: `apps/web/src/features/development-plans/plan-item-workflow-view-model.ts`
- Modify: `apps/web/src/features/development-plans/plan-item-workflow-workspace.tsx`
- Modify: `tests/web/development-plan-routes.test.tsx`

- [ ] **Step 1: Write failing UI/API tests**

In `tests/web/development-plan-routes.test.tsx`, add tests that render an `execution_ready` workflow:

```tsx
expect(screen.getByRole('button', { name: /start execution/i })).toBeEnabled();
await user.click(screen.getByRole('button', { name: /start execution/i }));
expect(api.startPlanItemWorkflowExecution).toHaveBeenCalledWith('workflow-1', expect.objectContaining({
  actor_id: 'actor-tech',
}));
```

Add another test for `execution_running` projection:

```tsx
expect(screen.getByText(/execution running/i)).toBeInTheDocument();
expect(screen.getByText(/run-session-1/i)).toBeInTheDocument();
expect(screen.queryByText(/thread-raw/i)).not.toBeInTheDocument();
expect(screen.queryByText(/artifact:\/\/internal/i)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run failing UI tests**

Run:

```bash
pnpm vitest run tests/web/development-plan-routes.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because command/hook/view model do not exist yet.

- [ ] **Step 3: Add command and hook**

In `apps/web/src/shared/api/commands.ts`:

```ts
export const startPlanItemWorkflowExecution = (workflowId: string, body: { actor_id: string; idempotency_key?: string }) =>
  apiPost<PlanItemWorkflowPublicDto>(`/plan-item-workflows/${workflowId}/execution/start`, body);
```

Wire a mutation hook in `hooks.ts` that invalidates workflow detail, development plan detail, and run-session projections.

- [ ] **Step 4: Update view model and workspace**

In `plan-item-workflow-view-model.ts`:

- expose `canStartExecution`;
- expose `executionRunSummary`;
- expose `executionContinuityProof` using digests only;
- exclude raw refs and local paths.

In `plan-item-workflow-workspace.tsx`:

- show Start execution action in `execution_ready`;
- show `execution_running` with public-safe run state;
- show `code_review` after success;
- keep Execution Package/RunSession ids read-only.

- [ ] **Step 5: Run UI tests**

Run:

```bash
pnpm vitest run tests/web/development-plan-routes.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/plan-item-workflow.ts apps/web/src/shared/api/commands.ts apps/web/src/shared/api/hooks.ts apps/web/src/shared/api/query-keys.ts apps/web/src/features/development-plans/plan-item-workflow-view-model.ts apps/web/src/features/development-plans/plan-item-workflow-workspace.tsx tests/web/development-plan-routes.test.tsx
git commit -m "feat: show workflow execution supervision"
```

## Task 8: Dogfood, No-Baggage Guard, And Final Verification

**Files:**
- Create: `scripts/plan-item-execution-handoff-dogfood.ts`
- Create: `scripts/plan-item-execution-handoff-real-dogfood.ts`
- Modify: `package.json`
- Modify: `scripts/check-codex-runtime-superpowers-no-baggage.ts`
- Add: `tests/smoke/plan-item-execution-handoff-dogfood-script.test.ts`
- Modify: `tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts` if shared helpers are needed
- Modify: `docs/superpowers/reports/` only if the dogfood pattern requires a committed report

- [ ] **Step 1: Write failing smoke tests for script entrypoints**

In `tests/smoke/plan-item-execution-handoff-dogfood-script.test.ts`:

```ts
it('prints a deterministic pass or public-safe skip summary', async () => {
  const result = await runScript('scripts/plan-item-execution-handoff-dogfood.ts');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('plan_item_execution_handoff');
  expect(result.stdout).not.toContain('codex_thread_id":"');
  expect(result.stdout).not.toContain('artifact://internal');
});
```

- [ ] **Step 2: Run failing smoke test**

Run:

```bash
pnpm vitest run tests/smoke/plan-item-execution-handoff-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because scripts do not exist.

- [ ] **Step 3: Implement deterministic fake dogfood**

Create `scripts/plan-item-execution-handoff-dogfood.ts` that:

- seeds a Plan Item Workflow through `execution_ready`;
- calls `POST /plan-item-workflows/:workflowId/execution/start`;
- runs a fake worker terminalization path;
- proves workflow reaches `code_review`;
- proves all objects share workflow/session lineage;
- proves no replacement thread/session is created;
- prints only public-safe digests and ids.

- [ ] **Step 4: Implement real-runtime dogfood**

Create `scripts/plan-item-execution-handoff-real-dogfood.ts` that:

- reuses existing runtime bootstrap helpers from `scripts/codex-runtime-superpowers-dogfood.ts` where practical;
- starts from a real workflow that has generated Boundary Summary, Spec Doc, and Implementation Plan Doc in one session;
- starts execution;
- invokes one `run_execution` remote worker pass;
- verifies same `codex_thread_id_digest`;
- verifies input capsule restored before execution and new capsule produced after execution;
- verifies workspace bundle/path policy;
- skips only when credentials/runtime are unavailable, and prints that skipped run is not acceptance evidence.

- [ ] **Step 5: Add package scripts**

In `package.json`:

```json
"dogfood:plan-item-execution-handoff": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/plan-item-execution-handoff-dogfood.ts",
"dogfood:plan-item-execution-handoff:real": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/plan-item-execution-handoff-real-dogfood.ts"
```

- [ ] **Step 6: Update no-baggage guard**

Extend `scripts/check-codex-runtime-superpowers-no-baggage.ts` to fail on:

- active public product calls to `execution-packages/:packageId/run`;
- active public product calls to `/rerun` or `/force-rerun`;
- active public product routes, UI commands, DTO actions, or labels that start workflow execution from Source Documents, Spec Docs, Implementation Plan Docs, generic Work Items, DevelopmentPlanItems, or old task surfaces;
- active use of `latest_snapshot_*`, `CodexSessionSnapshot`, or `codex_session_snapshot`;
- public Plan Item execution command DTOs that accept `owner_actor_id`;
- UI labels that make ExecutionPackage a start mutation root.

- [ ] **Step 7: Run targeted verification**

Run:

```bash
pnpm vitest run tests/smoke/plan-item-execution-handoff-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm dogfood:plan-item-execution-handoff
pnpm check:codex-runtime-superpowers-no-baggage
```

Expected: PASS.

- [ ] **Step 8: Run final verification**

Run:

```bash
pnpm vitest run tests/domain/codex-runtime.test.ts tests/db/plan-item-workflow-repository.test.ts tests/db/codex-runtime-repository.test.ts tests/api/plan-item-workflows.test.ts tests/codex-worker-runtime/remote-worker-client.test.ts tests/web/development-plan-routes.test.tsx tests/smoke/plan-item-execution-handoff-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm test
pnpm build
git diff --check
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add scripts/plan-item-execution-handoff-dogfood.ts scripts/plan-item-execution-handoff-real-dogfood.ts package.json scripts/check-codex-runtime-superpowers-no-baggage.ts tests/smoke/plan-item-execution-handoff-dogfood-script.test.ts
git commit -m "test: add plan item execution handoff dogfood"
```

## Final Acceptance Checklist

- [ ] `POST /plan-item-workflows/:workflowId/execution/start` is the only public product execution start route.
- [ ] Execution cannot start unless approved Spec Doc, approved Implementation Plan Doc, current Plan Item revision, ready Execution Readiness Record, ready Execution Package, latest safe capsule, active Codex Session, actor authorization, repo binding, and credential binding all pass validation.
- [ ] Start creates or reuses exactly one ExecutionPackage, RunSession, CodexSessionTurn, CodexRuntimeJob, and workspace bundle under the same workflow/session lineage.
- [ ] Runtime job first-class persisted lineage matches trusted workload lineage exactly.
- [ ] Worker restores latest capsule and resumes the same `codex_thread_id_digest`.
- [ ] Workflow-owned run execution uses `resumeRun` and never starts, falls back to, or replaces the Codex thread.
- [ ] Successful terminalization atomically advances output capsule, memory, environment, turn, run, job, and workflow state behind lease/capsule/workflow predicates.
- [ ] Failure and cancellation terminalization use the same guarded predicates and never mutate latest capsule/memory/environment refs on failure.
- [ ] Required check failures become code-review evidence, not infrastructure failure.
- [ ] Runtime failure, cancellation, unsafe capsule, missing capsule, digest mismatch, resume failure, stale lease, and stale terminalization fail closed.
- [ ] No public DTO leaks raw thread ids, raw capsule refs, local paths, credentials, lease tokens, memory refs, environment refs, or app-server payloads.
- [ ] No public legacy execution start route remains executable outside the workflow command.
- [ ] No active implementation or public contract reintroduces `latest_snapshot_*`, `CodexSessionSnapshot`, or `codex_session_snapshot`.
- [ ] Deterministic dogfood passes.
- [ ] Credentialed real-runtime dogfood passes in acceptance environment.
- [ ] `pnpm test`, `pnpm build`, `git diff --check`, no-baggage checks, and relevant runtime capsule tests pass.
