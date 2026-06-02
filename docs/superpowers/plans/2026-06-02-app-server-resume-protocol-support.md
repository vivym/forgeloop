# App-Server Resume Protocol Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ForgeLoop CodexSession generation turns continue in one live Codex app-server thread by starting once, binding the returned `Thread.id`, and resuming that same thread for later stage-like turns.

**Architecture:** Add a trusted internal continuation contract from the control plane scheduler through the remote worker and codex-runtime driver. The first CodexSession turn uses `thread/start`; later turns use `thread/resume` on the same session-bound runner and fail closed if the live runner or thread binding is unavailable. Repository terminalization remains the only writer of session thread binding, and raw `codex_thread_id` stays out of normal product DTOs and UI.

**Tech Stack:** TypeScript, pnpm, Vitest, NestJS control-plane API, Drizzle, ForgeLoop domain/db/runtime packages, Codex app-server protocol.

---

## Scope Check

This plan implements Wave 3 from `docs/superpowers/specs/2026-06-01-app-server-resume-protocol-support-design.md`.

In scope:

- Codex app-server protocol fixture/tests for `thread/start`, `thread/resume`, and `turn/start`.
- Runtime continuation types, digest helper, driver `start_thread` and `resume_thread` behavior.
- Session-bound app-server runner lifecycle for CodexSession generation workloads.
- Trusted runtime workload context carrying per-turn lease fencing and continuation metadata.
- Scheduler and daemon routing that preserves same-worker/live-runner ownership.
- Repository/API terminalization invariants for first binding, later equality assertions, stale attempts, and blocked failures.
- Opt-in real app-server dogfood command proving one start, multiple resumes, stable digest, and no replacement thread.

Out of scope:

- Cross-worker `CODEX_HOME` snapshot packaging or restore.
- Codex session file whitelist.
- Fork creation/merge/active-fork UI.
- Parsing Codex natural-language output for automatic workflow status.
- Exposing raw `codex_thread_id` in normal product DTOs or web UI.

## Current Critical Facts

- ForgeLoop `CodexSession.id` is the control-plane object.
- Codex app-server `Thread.id` is persisted internally as `CodexSession.codex_thread_id` and is the resume key.
- Codex app-server `Thread.sessionId` is session-tree metadata only and must not be used to resume turns.
- First turn request shape must include:

```ts
{
  approvalPolicy: 'never',
  sandbox: 'read-only',
  experimentalRawEvents: false,
  persistExtendedHistory: false,
}
```

- Later turn request shape must include:

```ts
{
  threadId: codex_thread_id,
  excludeTurns: true,
  persistExtendedHistory: false,
}
```

- Normal Wave 3 resume requests must omit `history` and `path`.
- Later-turn failures must not fall back to `thread/start`.
- `CodexSessionLease` is per-turn and must not be held across human review gaps.
- The session-bound app-server launch/runtime ownership is separate and is finalized once when the accepted turn group succeeds, fails, cancels, or blocks.

## Runtime Ownership Model

Wave 3 has two different runtime concepts that must not be collapsed:

| Concept | Lifetime | Identifier | Writer | Close rule |
| --- | --- | --- | --- | --- |
| Turn runtime job | One product generation action / one CodexSession turn | Current `CodexRuntimeJob.id` | Product scheduler | Terminalized after that turn result is accepted/rejected |
| Session-bound runner | One live app-server process for an accepted CodexSession turn group | `CodexSession.runner_runtime_job_id` + `runner_launch_lease_id` | Trusted worker/control-plane runner endpoints | Closed once when `turn_group_status === 'complete'`, or on failed/cancelled/blocked turn, explicit close, or expiry |
| CodexSession turn lease | One `CodexSessionTurn` terminalization fence | `CodexSessionLease.id` + `lease_token` | PlanItemWorkflow lease service | Terminalized/released with that turn only |

First turn sequence:

| Step | Runtime job | Launch lease | Runner owner row | CodexSession turn |
| --- | --- | --- | --- | --- |
| Scheduler creates turn job | `runtime-job-1` queued | `launch-lease-1` active | empty | `turn-1` running with per-turn lease |
| Worker starts app-server | `runtime-job-1` running | `launch-lease-1` materialized | mark `{runner_runtime_job_id: runtime-job-1, runner_launch_lease_id: launch-lease-1}` | unchanged |
| Worker succeeds intermediate turn | `runtime-job-1` terminal | `launch-lease-1` remains materialized because it owns the live runner | owner row remains and renews expiry | control-plane terminalization bridge binds `codex_thread_id` and terminalizes `turn-1` |
| Worker succeeds complete turn or fails/blocks | current turn job terminal | runner launch lease terminalized | owner row cleared | control-plane terminalization bridge terminalizes current CodexSession turn |

Later turn sequence:

| Step | Runtime job | Launch lease | Runner owner row | CodexSession turn |
| --- | --- | --- | --- | --- |
| Scheduler creates turn job | `runtime-job-2` queued | `launch-lease-2` active for audit/worker slot only | existing owner row must match selected worker and be unexpired | `turn-2` running with a fresh per-turn lease |
| Worker attaches to live runner | `runtime-job-2` running through `attachCodexSessionRunnerRuntimeJob()` | `launch-lease-2` is logically materialized for the turn job using existing runner evidence, but no app-server process starts | unchanged except expiry renewal | unchanged |
| Worker resumes thread | `runtime-job-2` running | `launch-lease-2` is terminalized when this turn job terminalizes | same runner entry in worker memory | unchanged |
| Worker terminalizes runtime job | `runtime-job-2` terminal | `launch-lease-2` terminalized normally | retained for `intermediate`, cleared/closed for `complete` or failure | control-plane terminalization bridge asserts thread id/digest equality and terminalizes `turn-2` |

The scheduler may create a new turn runtime job per action for audit, idempotency, and result application. It must not create or route to a replacement session-bound app-server launch for `resume_thread`. The remote worker must skip `claimLaunchTokenEnvelope()` and `launcher.startFromMaterialization()` for `resume_thread` jobs; it attaches the current runtime job to the existing in-memory runner and control-plane owner row instead. The attach operation must put the current job and its own launch lease into the same repository state that successful runtime-job terminalization already requires (`status: running`, lease `status: materialized`, runtime evidence, and launch materialization digest) without starting a replacement app-server.

`runner_expires_at` is a live-owner heartbeat timeout, not a human-review deadline. Each accepted intermediate turn and each worker heartbeat for an open runner renews it. If it expires, the next later-turn scheduling attempt fails closed with `codex_session_runner_unavailable`; Wave 3 does not auto-restore or fork from snapshots.

## Failure Codes

All runtime, scheduler, terminalization, and dogfood code must use these product-safe codes exactly:

- `codex_session_resume_without_binding`
- `codex_session_thread_binding_partial`
- `codex_session_runner_unavailable`
- `codex_app_server_resume_failed`
- `codex_app_server_thread_mismatch`
- `codex_session_thread_digest_mismatch`
- `codex_session_thread_start_for_bound_session`
- `codex_session_thread_binding_stale`
- `codex_app_server_thread_id_missing`

Important distinction:

- Driver-detected resume failures and mismatches block the active session.
- Repository-rejected stale writes record a stale terminalization attempt and mark only the attempted running turn stale. They do not block a newer valid session.

## File Structure

- Modify `tests/codex-runtime/codex-app-server-schema-smoke.test.ts`
  - Verifies current generated Codex protocol contracts and ForgeLoop request shapes.
- Modify `tests/codex-runtime/app-server-generation-driver.test.ts`
  - Owns fake-transport TDD for first-turn start, later-turn resume, mismatch, resume failure, and retry behavior.
- Modify `packages/codex-runtime/src/app-server-generation-driver.ts`
  - Owns app-server `thread/start`, `thread/resume`, `turn/start`, active turn tracking, output metadata, and thread id digesting.
- Modify `packages/codex-runtime/src/generation-safety-factory.ts`
  - Keeps generation command safety strict and allows `thread/resume` only for trusted session-bound contexts.
- Modify `packages/codex-runtime/src/generation-safety.ts`
  - Adds the safety flag or context needed to authorize `thread/resume`.
- Modify `packages/codex-runtime/src/types.ts`
  - Carries trusted session runtime context on generation task input when a CodexSession workload is present.
- Modify `packages/codex-runtime/src/runtime.ts`
  - Passes continuation context into the driver and exposes a session-bound runtime factory.
- Create `packages/codex-runtime/src/session-bound-generation-runner.ts`
  - Owns one live transport/driver lifecycle for a CodexSession accepted turn group.
- Modify `packages/codex-runtime/src/index.ts`
  - Exports new continuation and runner types/helpers.
- Modify `packages/domain/src/codex-runtime.ts`
  - Adds internal workload context types, validation helpers, and public blocker codes.
- Modify `packages/domain/src/types.ts`
  - Adds `codex_session_thread_binding_stale` to domain error codes.
- Modify `apps/control-plane-api/src/modules/http/domain-error.filter.ts`
  - Maps the new thread-binding stale code to conflict responses.
- Modify `packages/domain/src/plan-item-workflow.ts`
  - Adds internal runner ownership fields to `CodexSession` and helper invariants.
- Modify `packages/contracts/src/plan-item-workflow.ts`
  - Keeps public DTOs free of raw thread ids and runner internals.
- Modify `packages/db/src/schema/plan-item-workflow.ts`
  - Persists internal session-bound runner owner fields on `codex_sessions`.
- Modify generated migration under `packages/db/drizzle/`
  - Adds nullable internal runner owner columns and indexes.
- Modify `packages/db/src/repositories/delivery-repository.ts`
  - Adds repository inputs for runner ownership claim/finalization and attaching later turn jobs to a live runner.
- Modify `packages/db/src/repositories/in-memory-delivery-repository.ts`
  - Mirrors Drizzle behavior for thread binding, runner ownership, and attached runtime-job lifecycle.
- Modify `packages/db/src/repositories/drizzle-delivery-repository.ts`
  - Enforces the same invariants against the database.
- Modify `tests/db/plan-item-workflow-repository.test.ts`
  - Covers both in-memory and Drizzle thread-binding and runner-owner cases.
- Modify `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts`
  - Tightens trusted terminalization DTO validation.
- Modify `apps/control-plane-api/src/modules/plan-item-workflows/codex-session-lease.service.ts`
  - Keeps terminalization as the internal HTTP boundary and records stale attempts.
- Modify `apps/control-plane-api/src/modules/codex-runtime/product-generation-runtime-scheduler.service.ts`
  - Derives trusted continuation after action/workflow/lease checks and routes bound sessions only to the live runner owner.
- Modify control-plane runtime job worker-control DTO/controller/service files under `apps/control-plane-api/src/modules/codex-runtime/`
  - Adds trusted worker-facing mark/clear/attach runner owner operations.
- Modify `apps/control-plane-api/src/modules/automation/product-generation-result.service.ts`
  - Bridges runtime job terminal results into `CodexSessionLeaseService.terminalize()` before applying generated product payload.
- Modify `packages/codex-worker-runtime/src/runtime-job-artifacts.ts`
  - Includes trusted thread evidence in terminal results without exposing it as generated payload.
- Add `tests/api/codex-runtime-product-generation-scheduler.test.ts`
  - Covers continuation derivation, runner owner routing, and fail-closed blocks.
- Modify `packages/codex-worker-runtime/src/remote-worker-client.ts`
  - Validates trusted workload context, attaches later jobs to live runners, and returns trusted thread evidence through runtime-job terminal results.
- Modify `apps/automation-daemon/src/generation-runtime.ts`
  - Adds a per-`CodexSession.id` session-bound runner registry and returns runner/thread evidence through trusted runtime-job results.
- Add `tests/automation-daemon/generation-runtime.test.ts`
  - Covers one-shot path remains one-shot and CodexSession path reuses one runner.
- Add `scripts/codex-app-server-resume-dogfood.ts`
  - Opt-in real app-server smoke proving start/resume continuity.
- Modify `package.json`
  - Adds `dogfood:codex-app-server-resume`.

## Task 1: Lock The Protocol Contract

**Files:**
- Modify: `tests/codex-runtime/codex-app-server-schema-smoke.test.ts`
- Modify: `tests/codex-runtime/app-server-generation-driver.test.ts`
- Modify: `packages/codex-runtime/src/app-server-generation-driver.ts`

- [ ] **Step 1: Write failing schema assertions for `thread/resume`**

In `tests/codex-runtime/codex-app-server-schema-smoke.test.ts`, extend the real schema smoke test to read:

```ts
const threadResume = await readJson(join(schemaDir, 'v2', 'ThreadResumeParams.json'));
const threadStartSource = await readFile(join(tsDir, 'v2', 'ThreadStartParams.ts'), 'utf8');
const threadResumeSource = await readFile(join(tsDir, 'v2', 'ThreadResumeParams.ts'), 'utf8');
const threadSource = await readFile(join(tsDir, 'v2', 'Thread.ts'), 'utf8');

expect(threadStart.required).toEqual(expect.arrayContaining(['experimentalRawEvents', 'persistExtendedHistory']));
expect(threadResume.required).toEqual(expect.arrayContaining(['threadId', 'persistExtendedHistory']));
expect(Object.keys((threadResume.properties as Record<string, unknown>) ?? {})).toEqual(
  expect.arrayContaining(['threadId', 'excludeTurns', 'history', 'path', 'persistExtendedHistory']),
);
expect(threadStartSource).toContain('experimentalRawEvents: boolean');
expect(threadStartSource).toContain('persistExtendedHistory: boolean');
expect(threadResumeSource).toContain('threadId: string');
expect(threadResumeSource).toContain('persistExtendedHistory: boolean');
expect(threadResumeSource).toContain('excludeTurns?: boolean');
expect(threadResumeSource).toContain('history?: Array<ResponseItem> | null');
expect(threadResumeSource).toContain('path?: string | null');
expect(threadSource).toContain('id: string');
expect(threadSource).toContain('sessionId: string');
```

- [ ] **Step 2: Update generated TypeScript contract snippet**

In the same test, import and satisfy `ThreadResumeParams`:

```ts
import type { ThreadResumeParams } from './ts/v2/ThreadResumeParams';

const threadStart = {
  approvalPolicy: 'never',
  sandbox: 'read-only',
  experimentalRawEvents: false,
  persistExtendedHistory: false,
} satisfies ThreadStartParams;

const threadResume = {
  threadId: 'thread-1',
  excludeTurns: true,
  persistExtendedHistory: false,
} satisfies ThreadResumeParams;

const invalidThreadResume = {
  // @ts-expect-error thread/resume requires threadId.
  excludeTurns: true,
  persistExtendedHistory: false,
} satisfies ThreadResumeParams;
```

Expected initial result: the test fails because current ForgeLoop captured `thread/start` params omit `experimentalRawEvents` and `persistExtendedHistory`.

- [ ] **Step 3: Update driver start request to include required fields**

In `packages/codex-runtime/src/app-server-generation-driver.ts`, change the first-turn `thread/start` request to:

```ts
await this.transport.request('thread/start', {
  approvalPolicy: 'never',
  sandbox: 'read-only',
  experimentalRawEvents: false,
  persistExtendedHistory: false,
});
```

- [ ] **Step 4: Update unit test expectations**

In `tests/codex-runtime/app-server-generation-driver.test.ts`, update the `requests no approvals and read-only sandbox before collecting generated output` expectation to include:

```ts
expect(request).toHaveBeenNthCalledWith(1, 'thread/start', {
  approvalPolicy: 'never',
  sandbox: 'read-only',
  experimentalRawEvents: false,
  persistExtendedHistory: false,
});
```

- [ ] **Step 5: Run targeted tests**

Run:

```bash
pnpm test -- tests/codex-runtime/app-server-generation-driver.test.ts tests/codex-runtime/codex-app-server-schema-smoke.test.ts
```

Expected: app-server driver unit tests pass; schema smoke remains skipped unless `FORGELOOP_RUN_REAL_CODEX_APP_SERVER_SCHEMA=1`.

- [ ] **Step 6: Commit**

```bash
git add tests/codex-runtime/codex-app-server-schema-smoke.test.ts tests/codex-runtime/app-server-generation-driver.test.ts packages/codex-runtime/src/app-server-generation-driver.ts
git commit -m "test: lock codex app-server resume protocol"
```

## Task 2: Add Runtime Continuation Types And Driver Resume Behavior

**Files:**
- Modify: `packages/codex-runtime/src/app-server-generation-driver.ts`
- Modify: `packages/codex-runtime/src/generation-safety.ts`
- Modify: `packages/codex-runtime/src/generation-safety-factory.ts`
- Modify: `packages/codex-runtime/src/index.ts`
- Modify: `tests/codex-runtime/app-server-generation-driver.test.ts`

- [ ] **Step 1: Write failing first-turn metadata test**

Add a test in `tests/codex-runtime/app-server-generation-driver.test.ts`:

```ts
it('starts and returns internal thread metadata for an unbound CodexSession turn', async () => {
  const request = vi.fn(async (method: string) => {
    if (method === 'thread/start') {
      return { thread: { id: 'thread-1', sessionId: 'session-tree-1' }, effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
    }
    if (method === 'turn/start') {
      return { turn: { id: 'turn-1' }, effectiveConfig: { sandboxPolicy: { type: 'readOnly', networkAccess: false } } };
    }
    return {};
  });
  const driver = new AppServerGenerationDriver({
    transport: {
      request,
      notifications: async function* () {
        yield { type: 'assistant_message_delta', delta: '{"schema_version":"plan_draft.v1","summary":"ok"}' };
        yield { type: 'turn_completed', status: 'completed' };
      },
    },
    runtimeSafety: fakeSafety(),
  });

  const result = await driver.generate({
    taskKind: 'plan_draft',
    prompt: '{}',
    outputSchemaVersion: 'plan_draft.v1',
    continuation: { kind: 'start_thread' },
  });

  expect(result.codexThread).toMatchObject({
    codex_thread_id: 'thread-1',
    codex_thread_id_digest: codexThreadIdDigest('thread-1'),
    app_server_turn_id: 'turn-1',
  });
});
```

Expected: TypeScript fails because continuation/output metadata do not exist.

- [ ] **Step 2: Add continuation and metadata types**

In `packages/codex-runtime/src/app-server-generation-driver.ts`, export:

```ts
export type CodexThreadContinuation =
  | { kind: 'start_thread' }
  | {
      kind: 'resume_thread';
      codex_thread_id: string;
      codex_thread_id_digest: string;
    };

export interface CodexThreadMetadata {
  codex_thread_id: string;
  codex_thread_id_digest: string;
  app_server_turn_id?: string;
}

export const codexThreadIdDigest = (threadId: string): string => digest({ kind: 'codex_app_server_thread_id', thread_id: threadId });
```

Extend:

```ts
export interface AppServerGenerateInput {
  // existing fields...
  continuation?: CodexThreadContinuation;
}

export interface AppServerGenerateOutput {
  // existing fields...
  codexThread?: CodexThreadMetadata;
}
```

Export these from `packages/codex-runtime/src/index.ts`.

- [ ] **Step 3: Write failing later-turn resume test**

Add:

```ts
it('resumes an existing thread before starting a later turn', async () => {
  const request = vi.fn(async (method: string) => {
    if (method === 'thread/resume') {
      return { thread: { id: 'thread-1', sessionId: 'session-tree-1' }, effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
    }
    if (method === 'turn/start') {
      return { turn: { id: 'turn-2' }, effectiveConfig: { sandboxPolicy: { type: 'readOnly', networkAccess: false } } };
    }
    throw new Error(`unexpected:${method}`);
  });
  const driver = new AppServerGenerationDriver({
    transport: {
      request,
      notifications: async function* () {
        yield { type: 'assistant_message_delta', delta: '{"schema_version":"plan_draft.v1","summary":"ok"}' };
        yield { type: 'turn_completed', status: 'completed' };
      },
    },
    runtimeSafety: { ...fakeSafety(), allowThreadResume: true },
  });

  const result = await driver.generate({
    taskKind: 'plan_draft',
    prompt: '{}',
    outputSchemaVersion: 'plan_draft.v1',
    continuation: {
      kind: 'resume_thread',
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: codexThreadIdDigest('thread-1'),
    },
  });

  expect(request.mock.calls.map(([method]) => method)).toEqual(['thread/resume', 'turn/start']);
  expect(request).toHaveBeenNthCalledWith(1, 'thread/resume', {
    threadId: 'thread-1',
    excludeTurns: true,
    persistExtendedHistory: false,
  });
  expect(result.codexThread?.codex_thread_id_digest).toBe(codexThreadIdDigest('thread-1'));
});
```

Expected: fails because `thread/resume` is unsupported and safety rejects it.

- [ ] **Step 4: Authorize `thread/resume` only for trusted contexts**

In `packages/codex-runtime/src/generation-safety.ts`, add:

```ts
allowThreadResume?: boolean;
```

to `CodexGenerationRuntimeSafety`.

In `packages/codex-runtime/src/generation-safety-factory.ts`, add:

```ts
trustedContinuation?: 'session_bound';
```

to `CreateCodexGenerationRuntimeSafetyInput`, and set `allowThreadResume: input.trustedContinuation === 'session_bound'`.

Update `consumeGenerationCommand`:

```ts
if (method === 'thread/resume' && input.trustedContinuation === 'session_bound') return;
if (!allowedGenerationCommands.has(method)) throw new Error('codex_generation_command_invalid');
```

Do not add `thread/resume` to the global allowed set.

- [ ] **Step 5: Implement driver resume path**

In `AppServerGenerationDriver.generate()`:

- default `continuation` to `{ kind: 'start_thread' }`;
- if `continuation.kind === 'start_thread'`, call `thread/start` exactly once for the attempt;
- if `continuation.kind === 'resume_thread'`, call `runtimeSafety.consumeGenerationCommand({ method: 'thread/resume', ... })` and then:

```ts
const resumeResponse = await this.transport.request('thread/resume', {
  threadId: continuation.codex_thread_id,
  excludeTurns: true,
  persistExtendedHistory: false,
});
const resumedThreadId = extractThreadId(resumeResponse);
if (resumedThreadId === undefined) throw new Error('codex_app_server_thread_id_missing');
if (resumedThreadId !== continuation.codex_thread_id) throw new Error('codex_app_server_thread_mismatch');
```

Then call `turn/start` with `threadId: continuation.codex_thread_id`.

The resume request must not include `history` or `path`.

- [ ] **Step 6: Add mismatch, missing id, and resume failure tests**

Add tests that assert:

- `thread/resume` returning `thread-2` rejects with `codex_app_server_thread_mismatch`;
- `thread/resume` returning no thread id rejects with `codex_app_server_thread_id_missing`;
- transport throwing on `thread/resume` rejects with `codex_app_server_resume_failed` or a `CodexGenerationError` whose public subcode maps to that failure;
- no test observes a fallback `thread/start` after a failed resume.

Use:

```ts
expect(request.mock.calls.map(([method]) => method)).not.toContain('thread/start');
```

- [ ] **Step 7: Add retry constraint test**

Add a fake transport test where first later-turn `turn/start` or notification stream fails with a retryable app-server stream error. Assert the second attempt is:

```ts
['thread/resume', 'turn/start', 'thread/resume', 'turn/start']
```

and never `thread/start`.

- [ ] **Step 8: Run targeted tests**

```bash
pnpm test -- tests/codex-runtime/app-server-generation-driver.test.ts
```

Expected: all driver tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/codex-runtime/src/app-server-generation-driver.ts packages/codex-runtime/src/generation-safety.ts packages/codex-runtime/src/generation-safety-factory.ts packages/codex-runtime/src/index.ts tests/codex-runtime/app-server-generation-driver.test.ts
git commit -m "feat: support trusted app-server thread resume"
```

## Task 3: Add Session Runtime Context And Public-Safe Blocker Codes

**Files:**
- Modify: `packages/domain/src/codex-runtime.ts`
- Modify: `packages/codex-runtime/src/types.ts`
- Modify: `packages/codex-worker-runtime/src/remote-worker-client.ts`
- Modify: `tests/domain/codex-runtime.test.ts`

- [ ] **Step 1: Write failing domain validation tests**

Add tests for a valid internal context:

```ts
const context: CodexSessionRuntimeContextV1 = {
  schema_version: 'codex_session_runtime_context.v1',
  codex_session_id: 'session-1',
  codex_session_turn_id: 'turn-1',
  lease_id: 'lease-1',
  lease_epoch: 1,
  worker_id: 'worker-1',
    worker_session_digest: 'sha256:worker-session',
    turn_group_status: 'intermediate',
    continuation: { kind: 'start_thread' },
};

expect(validateCodexSessionRuntimeContext(context)).toEqual(context);
```

and invalid cases:

```ts
expect(() =>
  validateCodexSessionRuntimeContext({
    ...context,
    continuation: { kind: 'resume_thread', codex_thread_id: 'thread-1' },
  }),
).toThrow(/codex_session_thread_binding_partial/);

expect(() =>
  validateCodexSessionRuntimeContext({
    ...context,
    continuation: { kind: 'resume_thread', codex_thread_id_digest: 'sha256:thread-1' },
  }),
).toThrow(/codex_session_thread_binding_partial/);
```

- [ ] **Step 2: Add context interfaces and validators**

In `packages/domain/src/codex-runtime.ts`, add:

```ts
export type CodexThreadContinuationV1 =
  | { kind: 'start_thread' }
  | {
      kind: 'resume_thread';
      codex_thread_id: string;
      codex_thread_id_digest: string;
    };

export interface CodexSessionRuntimeContextV1 {
  schema_version: 'codex_session_runtime_context.v1';
  codex_session_id: string;
  codex_session_turn_id: string;
  lease_id: string;
  lease_epoch: number;
  worker_id: string;
  worker_session_digest: string;
  expected_previous_snapshot_digest?: string;
  runner_runtime_job_id?: string;
  runner_launch_lease_id?: string;
  turn_group_status: 'intermediate' | 'complete';
  continuation: CodexThreadContinuationV1;
}
```

Add `validateCodexSessionRuntimeContext(value: unknown): CodexSessionRuntimeContextV1`.

Rules:

- `start_thread` must not carry raw thread fields.
- `resume_thread` must carry both raw id and digest.
- all ids and digests must be non-empty strings.
- `lease_epoch` must be a positive integer.
- `runner_runtime_job_id` and `runner_launch_lease_id` are required when `continuation.kind === 'resume_thread'` and forbidden for `start_thread`.
- `turn_group_status` must be `intermediate` or `complete`.
- throw `DomainError('codex_session_thread_binding_partial', ...)` for partial resume binding.
- throw `DomainError('codex_generation_workload_unsupported', ...)` for malformed unrelated values.

- [ ] **Step 3: Add trusted context to workload**

Extend `CodexGenerationWorkloadV1`:

```ts
codex_session_runtime_context?: CodexSessionRuntimeContextV1;
codex_session_terminalization?: {
  schema_version: 'codex_session_terminalization.v1';
  lease_token: string;
  expected_previous_snapshot_digest?: string;
};
```

`codex_session_terminalization` is trusted runtime-job input only. It must be present exactly when `codex_session_runtime_context` is present. It carries the opaque per-turn lease token needed to call the internal CodexSession terminalization boundary after runtime job completion. Do not add either field to public product DTOs, public runtime-job projections, UI data, logs, or generated artifacts.

- [ ] **Step 4: Add blocker codes**

Add the Wave 3 codes to `codexPublicBlockerCodes` in `packages/domain/src/codex-runtime.ts`.

Add `codex_session_thread_binding_stale` to `DomainErrorCode` and the HTTP conflict set because the spec requires this exact product-safe stale overwrite code. Do not reuse `codex_session_stale_terminalization` for thread-binding overwrite attempts; keep that older code only for generic lease/snapshot/turn stale terminalization races that are not thread-binding-specific.

- [ ] **Step 5: Thread the context through runtime task input**

In `packages/codex-runtime/src/types.ts`, add:

```ts
codexSessionRuntimeContext?: CodexSessionRuntimeContextV1;
```

to `CodexGenerationRuntimeTaskInput<TContext>`, importing the type from `@forgeloop/domain` if this does not create a package cycle. If it creates a cycle, define a narrow local structural type and convert at package boundaries.

- [ ] **Step 6: Validate worker workload**

In `packages/codex-worker-runtime/src/remote-worker-client.ts`, update `requiredGenerationWorkload()`:

```ts
if (workload.codex_session_runtime_context !== undefined) {
  validateCodexSessionRuntimeContext(workload.codex_session_runtime_context);
}
```

Expected invalid workloads throw `codex_runtime_job_unavailable` or `codex_generation_workload_unsupported`, not raw validation traces.

- [ ] **Step 7: Run targeted tests**

```bash
pnpm test -- tests/domain tests/codex-worker-runtime
```

If there is no `tests/domain` directory, run the exact new domain test file and existing worker-runtime tests.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/codex-runtime.ts packages/codex-runtime/src/types.ts packages/codex-worker-runtime/src/remote-worker-client.ts tests
git commit -m "feat: add trusted codex session runtime context"
```

## Task 4: Persist Session-Bound Runner Ownership

**Files:**
- Modify: `packages/domain/src/plan-item-workflow.ts`
- Modify: `packages/contracts/src/plan-item-workflow.ts`
- Modify: `packages/db/src/schema/plan-item-workflow.ts`
- Add: `packages/db/drizzle/<generated-migration>.sql`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Modify: `tests/db/plan-item-workflow-repository.test.ts`

- [ ] **Step 1: Write failing repository tests for owner fields**

Add tests in `tests/db/plan-item-workflow-repository.test.ts` covering:

```ts
await repository.markCodexSessionRunnerOwner({
  session_id: 'session-1',
  runner_worker_id: 'worker-1',
  runner_launch_lease_id: 'launch-lease-1',
  runner_runtime_job_id: 'runtime-job-1',
  runner_expires_at: '2026-05-31T00:20:00.000Z',
  now: '2026-05-31T00:00:00.000Z',
});

await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
  runner_worker_id: 'worker-1',
  runner_launch_lease_id: 'launch-lease-1',
  runner_runtime_job_id: 'runtime-job-1',
  runner_expires_at: '2026-05-31T00:20:00.000Z',
});
```

and:

```ts
await repository.clearCodexSessionRunnerOwner({
  session_id: 'session-1',
  runner_launch_lease_id: 'launch-lease-1',
  terminal_reason_code: 'succeeded',
  now: '2026-05-31T00:10:00.000Z',
});

await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
  runner_worker_id: undefined,
  runner_launch_lease_id: undefined,
  runner_runtime_job_id: undefined,
  runner_expires_at: undefined,
});
```

Expected: methods/types do not exist.

- [ ] **Step 2: Add internal runner owner fields**

In `packages/domain/src/plan-item-workflow.ts`, extend `CodexSession`:

```ts
runner_worker_id?: string;
runner_launch_lease_id?: string;
runner_runtime_job_id?: string;
runner_expires_at?: IsoDateTime;
```

These are internal DB/domain fields, not public DTO fields.

- [ ] **Step 3: Keep public contracts clean**

In `packages/contracts/src/plan-item-workflow.ts`, assert that `codexSessionPublicDtoSchema` does not expose:

- `codex_thread_id`
- `runner_worker_id`
- `runner_launch_lease_id`
- `runner_runtime_job_id`
- `runner_expires_at`

If tests are missing, add contract tests that parse a public DTO and use:

```ts
expect(publicSession).not.toHaveProperty('codex_thread_id');
expect(publicSession).not.toHaveProperty('runner_worker_id');
```

- [ ] **Step 4: Add DB schema columns**

In `packages/db/src/schema/plan-item-workflow.ts`, add nullable columns to `codex_sessions`:

```ts
runnerWorkerId: uuid('runner_worker_id'),
runnerLaunchLeaseId: uuid('runner_launch_lease_id'),
runnerRuntimeJobId: uuid('runner_runtime_job_id'),
runnerExpiresAt: timestampColumn('runner_expires_at'),
```

Add indexes:

```ts
index('codex_sessions_runner_worker_idx').on(table.runnerWorkerId),
index('codex_sessions_runner_launch_lease_idx').on(table.runnerLaunchLeaseId),
```

Run:

```bash
pnpm db:generate
```

Expected: one new migration under `packages/db/drizzle/`.

- [ ] **Step 5: Add repository interface methods**

In `packages/db/src/repositories/delivery-repository.ts`:

```ts
markCodexSessionRunnerOwner(input: {
  session_id: string;
  runner_worker_id: string;
  runner_launch_lease_id: string;
  runner_runtime_job_id: string;
  runner_expires_at: string;
  now: string;
}): Promise<CodexSession>;

clearCodexSessionRunnerOwner(input: {
  session_id: string;
  runner_launch_lease_id: string;
  terminal_reason_code: string;
  now: string;
}): Promise<CodexSession>;

renewCodexSessionRunnerOwner(input: {
  session_id: string;
  runner_worker_id: string;
  runner_launch_lease_id: string;
  runner_runtime_job_id: string;
  runner_expires_at: string;
  now: string;
}): Promise<CodexSession>;

attachCodexSessionRunnerRuntimeJob(input: {
  session_id: string;
  runner_launch_lease_id: string;
  runner_runtime_job_id: string;
  attached_runtime_job_id: string;
  worker_id: string;
  runtime_evidence_digest: string;
  launch_materialization_digest: string;
  idempotency_key: string;
  request_digest: string;
  now: string;
}): Promise<CodexRuntimeJob>;
```

Implement in both repositories.

Rules:

- `clearCodexSessionRunnerOwner` must ignore stale launch lease ids by throwing `DomainError('codex_session_runner_unavailable', ...)` or by returning unchanged only if tests explicitly require idempotent stale cleanup. Prefer fail-closed for active scheduler paths.
- `renewCodexSessionRunnerOwner` only extends the same persisted owner tuple; it cannot switch worker/runtime job/launch lease.
- `attachCodexSessionRunnerRuntimeJob` starts a later turn runtime job by logically materializing that job's own launch lease with existing runner evidence, without starting a new app-server process. It verifies the session owner row matches `runner_launch_lease_id`, `runner_runtime_job_id`, and `worker_id`; the attached runtime job is assigned to the same worker, targets the same CodexSession, is accepted, and is not terminal/cancelled/expired.
- The attached runtime job records `started_at`, `runtime_evidence_digest`, and `launch_materialization_digest` using the live runner's public evidence. Its own `launch_lease_id` is set to `materialized` for repository compatibility and is terminalized by normal runtime job terminalization at the end of this later turn.
- This method must not create, materialize, or terminalize the session-bound runner launch lease.

- [ ] **Step 6: Run repository tests**

```bash
pnpm test -- tests/db/plan-item-workflow-repository.test.ts
```

Expected: in-memory and Drizzle cases pass.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/plan-item-workflow.ts packages/contracts/src/plan-item-workflow.ts packages/db/src/schema/plan-item-workflow.ts packages/db/drizzle packages/db/src/repositories/delivery-repository.ts packages/db/src/repositories/in-memory-delivery-repository.ts packages/db/src/repositories/drizzle-delivery-repository.ts tests/db/plan-item-workflow-repository.test.ts
git commit -m "feat: persist codex session runner ownership"
```

## Task 5: Tighten Terminalization Invariants

**Files:**
- Modify: `tests/db/plan-item-workflow-repository.test.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Modify: `packages/domain/src/types.ts`
- Modify: `apps/control-plane-api/src/modules/http/domain-error.filter.ts`
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts`
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/codex-session-lease.service.ts`

- [ ] **Step 1: Write failing app-server-backed success tests**

Add repository tests that distinguish successful app-server-backed terminalization from non-app-server terminalization:

```ts
await expectDomainErrorCode(
  () =>
    repository.terminalizeCodexSessionTurn({
      ...successfulTerminalizationInput,
      app_server_thread_binding_required: true,
      codex_thread_id: undefined,
      codex_thread_id_digest: undefined,
    }),
  'codex_app_server_thread_id_missing',
);
```

If adding `app_server_thread_binding_required` to repository input is too invasive, enforce this in `CodexSessionLeaseService.terminalize()` when the runtime workload/session context indicates an app-server-backed CodexSession turn. Do not break non-app-server historical tests that terminalize without thread metadata unless those tests represent CodexSession app-server turns.

- [ ] **Step 2: Add later-turn equality tests**

Seed a session with:

```ts
codex_thread_id: 'thread-1',
codex_thread_id_digest: 'sha256:thread-1',
```

Then assert later successful terminalization must provide both raw id and digest and must match both:

```ts
await expectDomainErrorCode(
  () => repository.terminalizeCodexSessionTurn({ ...input, codex_thread_id: 'thread-2', codex_thread_id_digest: 'sha256:thread-1' }),
  'codex_session_thread_binding_stale',
);
```

Also assert the generic stale-terminalization code still applies to non-thread-binding stale cases such as wrong lease epoch or stale previous snapshot. This prevents collapsing all stale paths into the new thread-binding-specific code.

- [ ] **Step 3: Add stale overwrite recording service test**

Add or update a `CodexSessionLeaseService` test so a stale terminalization attempting a different thread binding:

- records `attempted_codex_thread_id_digest`;
- marks only the attempted running turn stale;
- does not block or mutate the newer valid session.

- [ ] **Step 4: Tighten DTO partial binding validation**

In `terminalizeCodexSessionTurnSchema`, extend `superRefine`:

```ts
const hasThreadId = body.codex_thread_id !== undefined;
const hasThreadDigest = body.codex_thread_id_digest !== undefined;
if (hasThreadId !== hasThreadDigest) {
  ctx.addIssue({
    code: 'custom',
    path: hasThreadId ? ['codex_thread_id_digest'] : ['codex_thread_id'],
    message: 'codex_thread_id and codex_thread_id_digest must be provided together',
  });
}
```

If `failure_code` is present, validate it against `codexPublicBlockerCodes`.

- [ ] **Step 5: Implement repository/service tightening**

Preserve the existing stale-terminalization path. Do not turn repository-rejected stale writes into active session blocks.

Implementation rules:

- one of raw id/digest without the other rejects before mutation;
- existing partial session binding rejects before mutation;
- first successful app-server-backed terminalization binds both raw id and digest;
- later successful app-server-backed terminalization treats raw id and digest as equality assertions;
- thread-binding overwrite/equality failures throw `codex_session_thread_binding_stale`;
- generic lease/snapshot/turn stale failures keep their existing stale codes;
- stale terminalization attempts are saved by `CodexSessionLeaseService.recordStaleTerminalizationAttempt()`.

- [ ] **Step 6: Run targeted tests**

```bash
pnpm test -- tests/db/plan-item-workflow-repository.test.ts tests/api
```

If `tests/api` is too broad or absent, run the exact PlanItemWorkflow lease service test file.

- [ ] **Step 7: Commit**

```bash
git add tests/db/plan-item-workflow-repository.test.ts packages/db/src/repositories/in-memory-delivery-repository.ts packages/db/src/repositories/drizzle-delivery-repository.ts packages/domain/src/types.ts apps/control-plane-api/src/modules/http/domain-error.filter.ts apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts apps/control-plane-api/src/modules/plan-item-workflows/codex-session-lease.service.ts
git commit -m "fix: enforce codex thread terminalization invariants"
```

## Task 6: Derive Continuation In The Product Scheduler

**Files:**
- Modify: `apps/control-plane-api/src/modules/codex-runtime/product-generation-runtime-scheduler.service.ts`
- Modify: `apps/control-plane-api/src/modules/automation/product-generation-result.service.ts`
- Modify: `packages/domain/src/codex-runtime.ts`
- Add: `tests/api/codex-runtime-product-generation-scheduler.test.ts`

- [ ] **Step 1: Write failing scheduler tests**

Add tests for:

1. Unbound active session builds workload with:

```ts
codex_session_runtime_context: {
  schema_version: 'codex_session_runtime_context.v1',
  codex_session_id: 'session-1',
  codex_session_turn_id: 'turn-1',
  lease_id: 'lease-1',
  lease_epoch: 1,
  worker_id: 'worker-1',
  worker_session_digest: 'sha256:worker-session',
  turn_group_status: 'intermediate',
  continuation: { kind: 'start_thread' },
}
```

2. Bound active session builds:

```ts
continuation: {
  kind: 'resume_thread',
  codex_thread_id: 'thread-1',
  codex_thread_id_digest: 'sha256:thread-1',
},
runner_runtime_job_id: 'runtime-job-1',
runner_launch_lease_id: 'launch-lease-1',
```

3. Partial binding fails with `codex_session_thread_binding_partial`.
4. Later bound turn with missing/expired/different runner owner fails with `codex_session_runner_unavailable`.
5. Scheduler never accepts a product request body containing raw thread ids.
6. Runtime-job success application terminalizes the matching `CodexSessionTurn` with `codex_thread_id` and `codex_thread_id_digest` from trusted runtime evidence before completing the product action run.

- [ ] **Step 2: Acquire or validate per-turn `CodexSessionLease` before workload creation**

In `ProductGenerationRuntimeSchedulerService.schedule()`, after `assertWorkflowContextMatchesActionRun()` and before creating the runtime job:

- load the active `CodexSession` and `CodexSessionTurn`;
- claim or validate the per-turn `CodexSessionLease` using the internal lease service/repository path;
- derive `expected_previous_snapshot_digest` from the turn/session state;
- keep lease token/hash handling inside trusted control-plane/runtime boundaries.

If the scheduler cannot directly call `CodexSessionLeaseService` without HTTP/request concerns, add a narrow collaborator with the same repository semantics.

The scheduler must persist the opaque per-turn `lease_token` only in trusted runtime job input. Do not expose the token in public `PublicProductGenerationRuntimeJob` output or normal workflow DTOs.

- [ ] **Step 3: Derive continuation from repository state**

Rules:

```ts
if (session.codex_thread_id === undefined && session.codex_thread_id_digest === undefined) {
  continuation = { kind: 'start_thread' };
} else if (session.codex_thread_id !== undefined && session.codex_thread_id_digest !== undefined) {
  continuation = { kind: 'resume_thread', codex_thread_id: session.codex_thread_id, codex_thread_id_digest: session.codex_thread_id_digest };
} else {
  block with codex_session_thread_binding_partial;
}
```

Do not inspect or use `Thread.sessionId`.

- [ ] **Step 4: Derive explicit turn group lifecycle**

Add `turn_group_status` to `codex_session_runtime_context`.

Rules:

- `intermediate` means the daemon must keep the session-bound runner open after successful generation.
- `complete` means the daemon must close and clear the runner after successful generation.
- failed, cancelled, and blocked turns always close/clear runner regardless of `turn_group_status`.
- explicit trusted control-plane close uses Task 8A `closeCodexSessionRunner()`.

The scheduler/control-plane must derive this from workflow stage semantics, not from generated text. For this Wave 3 scope:

- Boundary/brainstorming continuation, Spec generation, and Implementation Plan generation default to `intermediate` while the product workflow may still request changes and continue the same Codex context.
- A turn is `complete` only when the control plane is scheduling an explicitly final accepted turn for the current stage-like group, such as a terminal "handoff to human execution readiness review" generation action.
- If no explicit final accepted turn exists yet, keep successful turns `intermediate` and close via Task 8A `closeCodexSessionRunner()` when the workflow leaves the accepted stage-like group.
- Future execution/code-review continuity may extend this enum in a later wave; do not implement that extension here.

- [ ] **Step 5: Enforce live runner owner for bound sessions**

For `resume_thread`, require:

- `session.runner_worker_id === selectedWorkerId`;
- `session.runner_launch_lease_id` present;
- `session.runner_runtime_job_id` present and referencing the runtime job that materialized the live session-bound runner;
- `session.runner_expires_at > now`.

If not, do not schedule a replacement runtime job. Terminalize/block with `codex_session_runner_unavailable` using the existing failure semantics.

When the scheduler blocks before creating a runtime job, it must still use the same CodexSession terminalization path as runtime-job failures: call `CodexSessionLeaseService.terminalize()` with the current turn lease fence, `status: 'failed'`, `failure_code: 'codex_session_runner_unavailable'`, and no raw thread id. Then complete/fail the product action run consistently with the existing runtime failure path. Do not leave the `CodexSessionTurn` running just because no runtime job was created.

For a bound session that passes the live owner check, schedule a new per-turn runtime job for the current action but force:

```ts
workerId = session.runner_worker_id;
runner_runtime_job_id = session.runner_runtime_job_id;
runner_launch_lease_id = session.runner_launch_lease_id;
```

inside `codex_session_runtime_context`. The new turn job's own `launch_lease_id` is audit/terminalization state for that turn job only; Task 8A attach logically materializes it with existing runner evidence so current terminalization invariants still hold, and the worker must not materialize it into a replacement app-server launch.

- [ ] **Step 6: Add context to workload**

Extend the workload construction:

```ts
const workload: CodexGenerationWorkloadV1 = {
  schema_version: 'codex_generation_workload.v1',
  // existing fields...
  codex_session_runtime_context,
  codex_session_terminalization,
};
```

Raw `codex_thread_id` is allowed only here because this is a trusted runtime job payload.

For app-server-backed CodexSession turns, include enough trusted terminalization fields for the control plane to call `CodexSessionLeaseService.terminalize()` after the runtime job terminalizes:

```ts
codex_session_terminalization: {
  schema_version: 'codex_session_terminalization.v1',
  lease_token: '<opaque per-turn lease token>',
  expected_previous_snapshot_digest?: string;
}
```

The public runtime-job projection must redact `codex_session_runtime_context`, `codex_session_terminalization`, and raw thread ids. Public callers may see only input digest/schema version and product-safe continuity status.

- [ ] **Step 7: Bridge runtime job success to CodexSession turn terminalization**

In `apps/control-plane-api/src/modules/automation/product-generation-result.service.ts` or a narrow collaborator called from it, after stored runtime job terminal result validation and before completing the product action run:

- if `runtimeJob.input_json.codex_session_runtime_context` is absent, keep existing product generation result behavior;
- if present, validate the trusted context and require `runtimeJob.codex_session_id` and `runtimeJob.codex_session_turn_id` to match it;
- read internal thread metadata from a trusted terminal evidence object, not from public generated payload:

```ts
type CodexSessionThreadTerminalEvidence = {
  codex_thread_id: string;
  codex_thread_id_digest: string;
  app_server_turn_id?: string;
};
```

- add this evidence either as `codex_session_thread` on `CodexGenerationRuntimeJobResult` after extending its validator/public-safe omission rules, or as a trusted internal runtime-job artifact referenced by `terminal_result_json.generation_artifacts`;
- inject `CodexSessionLeaseService` or a narrow `CodexSessionRuntimeTerminalizer` collaborator and call `terminalize(sessionId, turnId, dto, trustedAutomationRequest)` with `codex_session_terminalization.lease_token`, context lease fields, output snapshot fields when produced, and the trusted thread evidence;
- map terminalization errors through the stale-attempt path already owned by `CodexSessionLeaseService`;
- only then apply generated product payload and complete the product action run.

For failed/cancelled runtime jobs, extend `failProductGenerationActionRunForRuntimeTerminal()` or an adjacent collaborator so a CodexSession workload terminalizes the current turn with `status: 'failed' | 'cancelled'`, `failure_code: input.reasonCode`, and the same lease fence. Do not rely on runtime job terminalization alone; it does not mutate `CodexSessionTurn`.

If the runtime job fails before the worker could produce thread evidence, the terminalizer must omit `codex_thread_id` and `codex_thread_id_digest`; failed first turns must not bind a thread id.

- [ ] **Step 8: Run scheduler tests**

```bash
pnpm test -- tests/api/codex-runtime-product-generation-scheduler.test.ts
```

Expected: continuation derivation and fail-closed routing tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/control-plane-api/src/modules/codex-runtime/product-generation-runtime-scheduler.service.ts apps/control-plane-api/src/modules/automation/product-generation-result.service.ts packages/domain/src/codex-runtime.ts tests/api/codex-runtime-product-generation-scheduler.test.ts
git commit -m "feat: schedule codex session continuation workloads"
```

## Task 7: Add Session-Bound Runtime Runner

**Files:**
- Create: `packages/codex-runtime/src/session-bound-generation-runner.ts`
- Modify: `packages/codex-runtime/src/runtime.ts`
- Modify: `packages/codex-runtime/src/index.ts`
- Modify: `tests/codex-runtime/app-server-generation-driver.test.ts` or add `tests/codex-runtime/session-bound-generation-runner.test.ts`

- [ ] **Step 1: Write failing runner lifecycle tests**

Create `tests/codex-runtime/session-bound-generation-runner.test.ts` with:

```ts
it('reuses one transport for multiple CodexSession turns', async () => {
  const close = vi.fn(async () => {});
  const transport = { request, notifications, close };
  const runner = createSessionBoundGenerationRunner({
    codexSessionId: 'session-1',
    transport,
    runtimeSafety: { ...fakeSafety(), allowThreadResume: true },
  });

  await runner.generate('development_plan_item_execution_plan_revision', taskInputWith({ continuation: { kind: 'start_thread' } }));
  await runner.generate(
    'development_plan_item_execution_plan_revision',
    taskInputWith({ continuation: { kind: 'resume_thread', codex_thread_id: 'thread-1', codex_thread_id_digest: codexThreadIdDigest('thread-1') } }),
  );
  await runner.close('succeeded', 'group complete');

  expect(close).toHaveBeenCalledTimes(1);
});
```

Expected: runner factory does not exist.

- [ ] **Step 2: Implement runner**

In `packages/codex-runtime/src/session-bound-generation-runner.ts`, create a small wrapper around one `AppServerGenerationDriver`:

```ts
export interface SessionBoundGenerationRunner {
  readonly codexSessionId: string;
  generate<TContext extends Record<string, unknown>>(
    taskKind: CodexGenerationTaskKind,
    input: CodexGenerationRuntimeTaskInput<TContext>,
  ): Promise<CodexGenerationResult<unknown>>;
  close(status: 'succeeded' | 'failed' | 'cancelled' | 'blocked', reason: string): Promise<void>;
}
```

The runner:

- owns one transport/driver;
- forwards `input.codexSessionRuntimeContext.continuation` to the driver;
- sets safety `trustedContinuation: 'session_bound'`;
- does not close between turns;
- closes once and ignores duplicate close calls.

- [ ] **Step 3: Wire runtime facade**

In `packages/codex-runtime/src/runtime.ts`, keep `createCodexGenerationRuntime()` as one-shot compatible for isolated generation.

Add:

```ts
export const createSessionBoundCodexGenerationRuntime = (input: SessionBoundRuntimeConfig): CodexGenerationRuntime => { ... };
```

The session-bound runtime must select the runner path only when `input.codexSessionRuntimeContext` is present. Isolated generation must not require this context.

This package-level runner is an in-process abstraction for one live transport/driver. The worker/daemon layer still owns the cross-turn registry and the actual Docker app-server session. Do not make this runner materialize launch leases or call control-plane APIs directly.

- [ ] **Step 4: Add no-start-for-bound guard**

If `input.codexSessionRuntimeContext.continuation.kind === 'resume_thread'`, assert the driver path cannot call `thread/start`. Throw/block with `codex_session_thread_start_for_bound_session` if a code path attempts it.

- [ ] **Step 5: Run targeted tests**

```bash
pnpm test -- tests/codex-runtime/session-bound-generation-runner.test.ts tests/codex-runtime/app-server-generation-driver.test.ts
```

Expected: session-bound runner and driver tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/codex-runtime/src/session-bound-generation-runner.ts packages/codex-runtime/src/runtime.ts packages/codex-runtime/src/index.ts tests/codex-runtime
git commit -m "feat: add session-bound generation runner"
```

## Task 8A: Add Trusted Runner Ownership Control-Plane Boundary

**Files:**
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.controller.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Modify: `packages/codex-worker-runtime/src/remote-worker-client.ts`
- Modify: `tests/api/codex-runtime-control-plane.test.ts`
- Modify: `tests/db/plan-item-workflow-repository.test.ts`

- [ ] **Step 1: Write failing API tests for mark, attach, and clear**

In `tests/api/codex-runtime-control-plane.test.ts`, add worker-facing tests for:

```http
POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/codex-session-runner
POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/codex-session-runner/attach
POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/codex-session-runner/renew
POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/codex-session-runner/clear
```

The mark test should set up a generation runtime job with `input_json.codex_session_runtime_context`, then post:

```ts
{
  body_digest,
  codex_session_id: 'session-1',
  runner_launch_lease_id: 'launch-lease-1',
  runner_runtime_job_id: 'runtime-job-1',
  runner_expires_at: '2026-05-31T00:20:00.000Z',
}
```

Assert the service calls repository state so `CodexSession` has:

```ts
{
  runner_worker_id: workerId,
  runner_launch_lease_id: 'launch-lease-1',
  runner_runtime_job_id: 'runtime-job-1',
  runner_expires_at: '2026-05-31T00:20:00.000Z',
}
```

The clear test should delete the runner owner and assert those fields are absent.

The attach test should set up:

- an existing persisted runner owner `{runner_runtime_job_id: 'runtime-job-1', runner_launch_lease_id: 'launch-lease-1', runner_worker_id: workerId}`;
- a second accepted generation runtime job `runtime-job-2` for the next CodexSession turn whose input context has `continuation.kind === 'resume_thread'`, `runner_runtime_job_id: 'runtime-job-1'`, and `runner_launch_lease_id: 'launch-lease-1'`.

Then post to `runtime-job-2`:

```ts
{
  body_digest,
  codex_session_id: 'session-1',
  runner_launch_lease_id: 'launch-lease-1',
  runner_runtime_job_id: 'runtime-job-1',
  runtime_evidence_digest: 'sha256:...',
  launch_materialization_digest: 'sha256:...',
}
```

Assert `runtime-job-2` becomes `running` and its own launch lease becomes `materialized` through attach without calling app-server materialization/start, and assert stale/mismatched runner ids fail with `codex_session_runner_unavailable`.

Also add a control-plane initiated close test for the case where no final generation turn exists yet:

```http
POST /internal/codex-sessions/:sessionId/runner/close
```

This endpoint should clear persisted runner owner and make the next bound turn block with `codex_session_runner_unavailable` unless a future wave adds restore/fork recovery.

Expected initial result: routes and DTOs do not exist.

- [ ] **Step 2: Add DTO schemas**

In `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts`, add strict schemas:

```ts
export const markCodexSessionRunnerOwnerSchema = z
  .object({
    body_digest: nonEmpty,
    codex_session_id: nonEmpty,
    runner_launch_lease_id: nonEmpty,
    runner_runtime_job_id: nonEmpty,
    runner_expires_at: z.string().datetime(),
  })
  .strict();

export const attachCodexSessionRunnerRuntimeJobSchema = z
  .object({
    body_digest: nonEmpty,
    codex_session_id: nonEmpty,
    runner_launch_lease_id: nonEmpty,
    runner_runtime_job_id: nonEmpty,
    runtime_evidence_digest: sha256DigestSchema,
    launch_materialization_digest: sha256DigestSchema,
  })
  .strict();

export const renewCodexSessionRunnerOwnerSchema = z
  .object({
    body_digest: nonEmpty,
    codex_session_id: nonEmpty,
    runner_launch_lease_id: nonEmpty,
    runner_runtime_job_id: nonEmpty,
    runner_expires_at: z.string().datetime(),
  })
  .strict();

export const clearCodexSessionRunnerOwnerSchema = z
  .object({
    body_digest: nonEmpty,
    codex_session_id: nonEmpty,
    runner_launch_lease_id: nonEmpty,
    terminal_reason_code: nonEmpty,
  })
  .strict();

export const closeCodexSessionRunnerSchema = z
  .object({
    body_digest: nonEmpty,
    reason_code: nonEmpty,
  })
  .strict();
```

Use the existing worker replay-protection/body digest style.

`clearCodexSessionRunnerOwnerSchema` does not repeat `runner_runtime_job_id`; the route `:jobId` and service fence already bind the clear request to the runtime job.

- [ ] **Step 3: Add internal controller routes**

In `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.controller.ts`, add routes under the existing internal worker runtime-job area:

```ts
@Post('/internal/codex-workers/:workerId/runtime-jobs/:jobId/codex-session-runner')
markCodexSessionRunnerOwner(...)

@Post('/internal/codex-workers/:workerId/runtime-jobs/:jobId/codex-session-runner/attach')
attachCodexSessionRunnerRuntimeJob(...)

@Post('/internal/codex-workers/:workerId/runtime-jobs/:jobId/codex-session-runner/renew')
renewCodexSessionRunnerOwner(...)

@Post('/internal/codex-workers/:workerId/runtime-jobs/:jobId/codex-session-runner/clear')
clearCodexSessionRunnerOwner(...)

@Post('/internal/codex-sessions/:sessionId/runner/close')
closeCodexSessionRunner(...)
```

The first two are trusted worker endpoints. The close endpoint is trusted control-plane/operator automation only; do not add a normal product UI route for raw runner details.

- [ ] **Step 4: Implement service methods with fences**

In `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`, implement:

```ts
markCodexSessionRunnerOwner(workerId: string, jobId: string, input: MarkCodexSessionRunnerOwnerDto)
attachCodexSessionRunnerRuntimeJob(workerId: string, jobId: string, input: AttachCodexSessionRunnerRuntimeJobDto)
renewCodexSessionRunnerOwner(workerId: string, jobId: string, input: RenewCodexSessionRunnerOwnerDto)
clearCodexSessionRunnerOwner(workerId: string, jobId: string, input: ClearCodexSessionRunnerOwnerDto)
closeCodexSessionRunner(sessionId: string, input: CloseCodexSessionRunnerDto)
```

The worker-facing methods must:

- call `requireWorkerRuntimeJob(workerId, jobId)`;
- verify the runtime job is assigned to `workerId`;
- verify `runtimeJob.target_kind === 'generation'`;
- verify `runtimeJob.input_json.codex_session_runtime_context.codex_session_id === input.codex_session_id`;
- use worker replay protection with the exact route and `body_digest`;
- call the matching repository method.

`markCodexSessionRunnerOwner()` additionally verifies:

- `input.runner_runtime_job_id === jobId`;
- `input.runner_launch_lease_id === runtimeJob.launch_lease_id`.

`attachCodexSessionRunnerRuntimeJob()` additionally verifies:

- runtime job context has `continuation.kind === 'resume_thread'`;
- `input.runner_runtime_job_id === context.runner_runtime_job_id`;
- `input.runner_launch_lease_id === context.runner_launch_lease_id`;
- `runtimeJob.launch_lease_id !== input.runner_launch_lease_id` for later turns;
- repository owner row still points at the same worker, runner runtime job, and runner launch lease;
- it starts the current later-turn runtime job and logically materializes the current job's own launch lease with the live runner evidence without creating a replacement app-server launch.

`renewCodexSessionRunnerOwner()` additionally verifies the input owner tuple matches the persisted owner row and extends only `runner_expires_at`.

`clearCodexSessionRunnerOwner()` additionally verifies `input.runner_launch_lease_id` matches the persisted owner row and the runtime job context/owner for the closing worker.

If any fence fails, throw a product-safe `ForbiddenException` or `DomainError('codex_session_runner_unavailable', ...)`.

`closeCodexSessionRunner()` must:

- load the session;
- require a current runner owner;
- clear the owner through `clearCodexSessionRunnerOwner()` repository semantics or a repository method dedicated to operator close;
- not expose the raw runner fields in its response;
- return only product-safe status and reason code.

- [ ] **Step 5: Add remote worker client methods**

In `packages/codex-worker-runtime/src/remote-worker-client.ts`, extend `RemoteControlPlaneClient`:

```ts
markCodexSessionRunnerOwner?(workerId: string, jobId: string, input: Record<string, unknown>): Promise<unknown>;
attachCodexSessionRunnerRuntimeJob?(workerId: string, jobId: string, input: Record<string, unknown>): Promise<unknown>;
renewCodexSessionRunnerOwner?(workerId: string, jobId: string, input: Record<string, unknown>): Promise<unknown>;
clearCodexSessionRunnerOwner?(workerId: string, jobId: string, input: Record<string, unknown>): Promise<unknown>;
```

If the concrete HTTP client is in another file, add matching methods there too.

- [ ] **Step 6: Run targeted API tests**

```bash
pnpm test -- tests/api/codex-runtime-control-plane.test.ts
```

Expected: new mark/attach/clear API tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts apps/control-plane-api/src/modules/codex-runtime/codex-runtime.controller.ts apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts packages/db/src/repositories/delivery-repository.ts packages/db/src/repositories/in-memory-delivery-repository.ts packages/db/src/repositories/drizzle-delivery-repository.ts packages/codex-worker-runtime/src/remote-worker-client.ts tests/api/codex-runtime-control-plane.test.ts tests/db/plan-item-workflow-repository.test.ts
git commit -m "feat: add codex session runner owner control boundary"
```

## Task 8: Route Worker And Daemon Through The Session-Bound Runner

**Files:**
- Modify: `packages/codex-worker-runtime/src/remote-worker-client.ts`
- Modify: `packages/codex-worker-runtime/src/runtime-job-artifacts.ts`
- Modify: `packages/domain/src/codex-runtime.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
- Modify: `apps/automation-daemon/src/generation-runtime.ts`
- Modify: control-plane worker/runtime-job client types added in Task 8A.
- Add: `tests/automation-daemon/generation-runtime.test.ts`
- Modify: `tests/codex-worker-runtime/remote-worker-client.test.ts`

This task depends on Task 8A. Do not make daemon code import `DeliveryRepository` or mutate `codex_sessions` directly.

- [ ] **Step 1: Write failing daemon registry tests**

Add daemon tests that assert:

- isolated generation still launches and closes per generation;
- CodexSession workload `turn 1` creates a registry entry;
- CodexSession workload `turn 2` with the same session id reuses the same runner/transport;
- session-bound launch close is called once after group finalization;
- missing runner for a bound resume returns `codex_session_runner_unavailable`.

Example assertion:

```ts
expect(launcher.launchFromLease).toHaveBeenCalledTimes(1);
expect(session.close).toHaveBeenCalledTimes(1);
expect(result.codexThread?.codex_thread_id_digest).toBe('sha256:thread-1');
```

- [ ] **Step 2: Pass trusted context from remote worker to runtime**

In `packages/codex-worker-runtime/src/remote-worker-client.ts`, after `requiredGenerationWorkload()` validates the workload, pass:

```ts
codexSessionRuntimeContext: workload.codex_session_runtime_context
```

into the generation runtime task input.

Validate that `workload.codex_session_terminalization` is present when `workload.codex_session_runtime_context` is present, but do not pass the lease token into codex-runtime task input, generated output, logs, artifacts, public summaries, or any worker-to-control-plane callback. The control plane reads the stored workload when bridging runtime job terminalization to `CodexSessionLeaseService.terminalize()`.

- [ ] **Step 2A: Make the remote worker session-bound too**

In `packages/codex-worker-runtime/src/remote-worker-client.ts`, add a `sessionBoundRunners` registry equivalent to the daemon registry because the remote worker is the path that currently calls `claimLaunchTokenEnvelope()`, `materializeRuntimeJob()`, `launcher.startFromMaterialization()`, `closeAfterGeneration()`, and `terminalizeRuntimeJob()`.

Rules:

- isolated generation keeps the existing one-runtime-job/one-app-server path;
- `start_thread` generation claims/materializes/starts exactly as today, then creates the registry entry and marks runner ownership;
- `resume_thread` generation must skip `claimLaunchTokenEnvelope()`, `materializeRuntimeJob()`, and `launcher.startFromMaterialization()`; Task 8A attach performs the repository state transition that replaces materialization for this later-turn job;
- `resume_thread` generation must call Task 8A `attachCodexSessionRunnerRuntimeJob()` to mark the current turn runtime job `running` using the existing runner evidence;
- `resume_thread` generation must reuse the existing in-memory runner/transport and never call `thread/start`;
- existing `closeAfterGeneration()` must not run for successful `intermediate` session-bound turns.

Add remote-worker tests proving the second turn does not call `claimLaunchTokenEnvelope`, `materializeRuntimeJob`, or `launcher.startFromMaterialization`, does call `attachCodexSessionRunnerRuntimeJob`, and still calls `terminalizeRuntimeJob` for the current turn job.

- [ ] **Step 3: Add daemon runner registry**

In `apps/automation-daemon/src/generation-runtime.ts`, add:

```ts
type SessionBoundRunnerEntry = {
  codexSessionId: string;
  workerId: string;
  launchLeaseId: string;
  runtimeJobId: string;
  publicEvidence: CodexDockerRuntimeEvidence;
  launchMaterializationDigest: string;
  turnGroupStatus: 'intermediate' | 'complete';
  runner: CodexGenerationRuntime;
  close(status: 'succeeded' | 'failed' | 'cancelled' | 'blocked', reason: string): Promise<void>;
};

const sessionBoundRunners = new Map<string, SessionBoundRunnerEntry>();
```

Key by `CodexSession.id`.

Update `turnGroupStatus` from each incoming turn context. Do not treat the first turn's value as durable session state.

- [ ] **Step 4: Select path based on trusted context**

In `createLeasedDockerCodexGenerationRuntime()`:

- if `input.codexSessionRuntimeContext === undefined`, keep current one-shot behavior;
- if context continuation is `start_thread`, launch app-server, create a runner entry, and call the trusted Task 8A control-plane method to mark runner ownership;
- if context continuation is `resume_thread`, require an existing registry entry with matching session id, worker id, `runner_runtime_job_id`, and `runner_launch_lease_id`;
- if missing/mismatch, throw a `CodexGenerationError` or terminal result with `codex_session_runner_unavailable`;
- do not create a replacement launch for `resume_thread`.

- [ ] **Step 5: Return trusted thread metadata**

When generation succeeds, include trusted thread metadata in the runtime job terminal result or a trusted internal artifact:

```ts
codex_thread_id: result.codexThread.codex_thread_id,
codex_thread_id_digest: result.codexThread.codex_thread_id_digest,
```

Concrete data path:

- runtime success still terminalizes the current `CodexRuntimeJob` with public-safe `terminal_result_json`;
- trusted thread metadata is passed either as validated `terminal_result_json.codex_session_thread` after extending the domain validator to omit it from public-safe projections, or as a trusted internal runtime-job artifact referenced from `generation_artifacts`;
- `ProductGenerationResultService` reads that trusted evidence and calls internal `CodexSessionLeaseService.terminalize()` with `codex_thread_id`, `codex_thread_id_digest`, per-turn lease fields, and snapshot fields;
- the worker must never put raw thread ids in generated payloads, public summaries, normal product artifacts, or UI DTOs.

For failures:

- resume failure uses `codex_app_server_resume_failed`;
- mismatch uses `codex_app_server_thread_mismatch`;
- missing id uses `codex_app_server_thread_id_missing`;
- runner unavailable uses `codex_session_runner_unavailable`.

Raw ids must not be written to normal public artifacts.
Public `PublicRuntimeJob` and `PublicProductGenerationRuntimeJob` output must continue to omit trusted `codex_session_thread` evidence if that evidence is stored on `terminal_result_json`.

- [ ] **Step 6: Finalize runner once**

Close and clear the runner only when the accepted turn group succeeds, fails, cancels, or blocks. Do not close after every turn. Use `input.codexSessionRuntimeContext.turn_group_status`:

- keep runner open after successful turns with `turn_group_status === 'intermediate'`;
- close after successful turns with `turn_group_status === 'complete'`;
- close on blocked/failure/cancelled;
- call the trusted Task 8A clear-runner-owner control-plane method when closing;
- call the trusted renew-runner-owner control-plane/repository path after successful intermediate turns or heartbeat while the runner remains open;
- terminalize the current turn runtime job normally even when the session-bound runner remains open;
- terminalize the session-bound runner launch lease only when the runner closes, not after each intermediate turn;
- if the control plane calls Task 8A `closeCodexSessionRunner()` while the daemon still has a registry entry, the next control poll/turn should close the local runner idempotently and remove the map entry.

Do not infer group completion from generated text.

- [ ] **Step 7: Run targeted tests**

```bash
pnpm test -- tests/automation-daemon/generation-runtime.test.ts tests/codex-worker-runtime
```

Use exact test files if the directories differ.

- [ ] **Step 8: Commit**

```bash
git add packages/codex-worker-runtime/src/remote-worker-client.ts apps/automation-daemon/src/generation-runtime.ts tests/automation-daemon tests/codex-worker-runtime
git commit -m "feat: route codex sessions through live runners"
```

## Task 9: Add Real App-Server Resume Dogfood

**Files:**
- Add: `scripts/codex-app-server-resume-dogfood.ts`
- Modify: `package.json`
- Add: `tests/smoke/codex-app-server-resume-dogfood-script.test.ts`

- [ ] **Step 1: Write failing script tests**

Create tests that call the script helpers without launching a real app-server:

```ts
expect(skipOutput).toContain(
  'SKIP codex app-server resume dogfood: set FORGELOOP_CODEX_APP_SERVER_RESUME_DOGFOOD=1',
);
```

and validate report redaction:

```ts
expect(report).toMatchObject({
  status: 'passed',
  thread_start_count: 1,
  replacement_thread_start_count: 0,
});
expect(report.thread_resume_count).toBeGreaterThanOrEqual(2);
expect(JSON.stringify(report)).not.toContain('thread-raw');
expect(JSON.stringify(report)).not.toContain('prompt transcript');
```

- [ ] **Step 2: Add package script**

In `package.json`:

```json
"dogfood:codex-app-server-resume": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-app-server-resume-dogfood.ts"
```

- [ ] **Step 3: Implement skip path**

In `scripts/codex-app-server-resume-dogfood.ts`:

```ts
if (process.env.FORGELOOP_CODEX_APP_SERVER_RESUME_DOGFOOD !== '1') {
  console.log('SKIP codex app-server resume dogfood: set FORGELOOP_CODEX_APP_SERVER_RESUME_DOGFOOD=1');
  process.exit(0);
}
```

- [ ] **Step 4: Implement real smoke path**

The real path should:

- create one ForgeLoop `CodexSession.id`;
- run three stage-like turns:
  - brainstorming follow-up;
  - spec generation;
  - implementation plan generation;
- record app-server request counters;
- assert `thread_start_count === 1`;
- assert `thread_resume_count >= 2`;
- assert `replacement_thread_start_count === 0`;
- assert one stable `codex_thread_id_digest`;
- omit raw thread ids, prompt transcripts, credentials, app-server endpoints, and raw payloads from output.

- [ ] **Step 5: Write report**

Write:

```text
test-results/codex-app-server-resume-dogfood.json
```

with product-safe shape:

```ts
{
  status: 'passed' | 'failed' | 'skipped';
  codex_session_id: string;
  codex_thread_id_digest?: string;
  thread_start_count: number;
  thread_resume_count: number;
  replacement_thread_start_count: number;
  blocker_codes: string[];
  report_generated_at: string;
}
```

- [ ] **Step 6: Run dogfood skip and tests**

```bash
pnpm test -- tests/smoke/codex-app-server-resume-dogfood-script.test.ts
pnpm dogfood:codex-app-server-resume
```

Expected:

```text
SKIP codex app-server resume dogfood: set FORGELOOP_CODEX_APP_SERVER_RESUME_DOGFOOD=1
```

- [ ] **Step 7: Run real dogfood when environment is available**

```bash
FORGELOOP_CODEX_APP_SERVER_RESUME_DOGFOOD=1 pnpm dogfood:codex-app-server-resume
```

Expected: report status `passed`, `thread_start_count: 1`, `thread_resume_count >= 2`, `replacement_thread_start_count: 0`.

- [ ] **Step 8: Commit**

```bash
git add package.json scripts/codex-app-server-resume-dogfood.ts tests/smoke/codex-app-server-resume-dogfood-script.test.ts test-results/.gitkeep
git commit -m "test: add app-server resume dogfood"
```

Do not commit generated `test-results/codex-app-server-resume-dogfood.json` unless the repository already tracks dogfood reports.

## Task 10: No-Baggage Scan And Full Verification

**Files:**
- Modify only files required by failing checks.

- [ ] **Step 1: Run raw id exposure scan**

```bash
rg -n "codex_thread_id" apps/web packages/contracts apps/control-plane-api/src/modules -g '!**/*.test.*'
```

Expected:

- no hits in `apps/web`;
- no hits in normal public contract DTOs;
- hits allowed only in trusted internal terminalization DTO/service, runtime job workload schema, or operator diagnostics.

If a normal product DTO exposes raw `codex_thread_id`, remove it and expose only digest/status.

- [ ] **Step 2: Run targeted suites**

```bash
pnpm test -- tests/codex-runtime/app-server-generation-driver.test.ts tests/codex-runtime/codex-app-server-schema-smoke.test.ts
pnpm test -- tests/db/plan-item-workflow-repository.test.ts
pnpm test -- tests/smoke/codex-app-server-resume-dogfood-script.test.ts
```

Expected: all pass, with real schema smoke skipped unless enabled.

- [ ] **Step 3: Run full test and build**

```bash
pnpm test
pnpm build
git diff --check
```

Expected: all pass.

- [ ] **Step 4: Run dogfood command**

```bash
pnpm dogfood:codex-app-server-resume
```

Expected normal local output:

```text
SKIP codex app-server resume dogfood: set FORGELOOP_CODEX_APP_SERVER_RESUME_DOGFOOD=1
```

Before Wave 3 is accepted as complete, also run:

```bash
FORGELOOP_CODEX_APP_SERVER_RESUME_DOGFOOD=1 pnpm dogfood:codex-app-server-resume
```

Expected report:

- `status: "passed"`;
- `thread_start_count: 1`;
- `thread_resume_count >= 2`;
- `replacement_thread_start_count: 0`;
- one stable `codex_thread_id_digest`;
- no raw thread ids.

- [ ] **Step 5: Commit final fixes**

```bash
git add .
git commit -m "chore: verify app-server resume protocol support"
```

Only create this commit if verification required additional tracked fixes. Do not create an empty commit.

## Implementation Guardrails

- Do not use `Thread.sessionId` as a resume key.
- Do not call `thread/start` after a session has a bound thread.
- Do not send `history` or `path` in normal Wave 3 `thread/resume`.
- Do not expose raw `codex_thread_id` in `apps/web` or public contracts.
- Do not hold `CodexSessionLease` across human review gaps.
- Do not close the session-bound app-server launch after every CodexSession turn.
- Do not implement Wave 4 snapshot packaging/restore in this plan.
- Do not hide stale terminalization races by overwriting newer session state.
- Do not let fake transport tests be the only acceptance evidence.

## Final Acceptance Checklist

- [ ] Protocol tests document current `ThreadStartParams`, `ThreadResumeParams`, and `TurnStartParams`.
- [ ] First CodexSession turn calls `thread/start` once and terminalizes with raw thread id plus digest.
- [ ] Later CodexSession turns call `thread/resume` then `turn/start`.
- [ ] Later-turn path never calls `thread/start`.
- [ ] Driver verifies resumed `Thread.id` equals requested `codex_thread_id`.
- [ ] Resume failure blocks with a product-safe failure code and no replacement thread.
- [ ] Repository first binding and later equality assertions are enforced in memory and Drizzle.
- [ ] Stale terminalization attempts are recorded without mutating newer valid sessions.
- [ ] Scheduler routes bound later turns only to the live runner owner.
- [ ] Daemon keeps a session-bound runner open across accepted stage-like turns and finalizes once.
- [ ] `pnpm dogfood:codex-app-server-resume` exists and skips by default.
- [ ] Real dogfood pass proves one stable digest, one start, at least two resumes, and zero replacement starts.
- [ ] Raw thread ids remain trusted-internal only.
