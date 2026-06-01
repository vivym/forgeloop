# App-Server Resume Protocol Support Design

## Status

Ready for implementation planning.

## Purpose

Wave 1 introduced the Internal Artifact Store foundation. Wave 2 introduced `PlanItemWorkflow`, `CodexSession`, `CodexSessionTurn`, snapshots, leases, first-thread binding fields, and lease-fenced terminalization.

Wave 3 must stop treating every generation stage as a fresh Codex app-server thread. It must make the current worker/runtime path able to start the first Codex thread for a ForgeLoop `CodexSession`, bind that thread id through trusted terminalization, and run later stage turns by resuming the same live app-server thread.

This wave proves live app-server thread continuity. Cross-worker `CODEX_HOME` snapshot packaging and restore remain Wave 4.

Within Wave 3, "same worker/runtime lifecycle" means the runtime still has access to the same live app-server process for the accepted stage-like turn group. It does not mean a later worker can reconstruct context from ArtifactStore snapshots, and it does not accept portable `CODEX_HOME` restore as a substitute for live-thread proof. If the live app-server cannot resume the requested thread, the session is blocked.

## Authority

This spec implements only Wave 3: App-Server Resume Protocol Support.

It is authoritative for:

- Codex app-server protocol interpretation for start, resume, session-tree metadata, and turn start;
- the relationship between ForgeLoop `CodexSession.id` and Codex app-server `Thread.id`;
- first-turn `codex_thread_id` binding;
- same-worker later-turn resume behavior;
- runtime driver behavior when a session already has a bound thread;
- blocked semantics when app-server resume fails;
- tests and dogfood evidence required before accepting implementation.

It is not authoritative for:

- cross-worker snapshot packaging or restore;
- Codex session file whitelist;
- Docker `/codex-home` archive and restore lifecycle;
- full Plan Item Workflow product UI;
- execution handoff continuity;
- code-review continuation and fix loops;
- fork UI or active-fork selection.

## Verified Codex App-Server Protocol

The current local Codex app-server protocol was verified with:

```text
codex --version
codex app-server generate-ts --experimental --out /tmp/codex-app-server-protocol-ts-current
```

The installed CLI reports:

```text
codex-cli 0.133.0
```

Generated protocol evidence:

- `ClientRequest` includes `thread/start`, `thread/resume`, `thread/fork`, and `turn/start`.
- `ThreadStartResponse` and `ThreadResumeResponse` return `{ thread: Thread, ... }`.
- `ThreadStartParams` requires `experimentalRawEvents: boolean`.
- `ThreadStartParams` requires `persistExtendedHistory: boolean`.
- `ThreadResumeParams` requires `threadId: string`.
- `ThreadResumeParams` has optional `excludeTurns?: boolean`.
- `ThreadResumeParams` has optional `history?: Array<ResponseItem> | null`.
- `ThreadResumeParams` has optional `path?: string | null`.
- `ThreadResumeParams` requires `persistExtendedHistory: boolean`.
- `TurnStartParams` requires `threadId: string`.
- `TurnStartParams` requires `input: Array<UserInput>`.
- `Thread` has both:
  - `id: string`;
  - `sessionId: string`, described as the session id shared by threads that belong to the same session tree.

Important protocol interpretation:

- `Thread.id` is the continuation handle for `thread/resume`, `turn/start`, `turn/interrupt`, and `thread/fork`.
- `Thread.sessionId` is session-tree metadata. It is not the API handle for continuing a specific linear thread.
- Fork support means multiple threads may share one `sessionId`. Therefore `sessionId` cannot identify which branch a later turn should continue.
- `thread/resume` supports `history` and `path`, but both are unstable for this use case. Non-empty `path` may cause app-server to ignore `threadId` for non-running threads. Wave 3 must use `threadId` as the normal continuation key, omit `history` and `path` in normal resume requests, and leave `path`/`history` for future recovery work.
- Wave 3 only interprets fork/session-tree protocol enough to avoid treating `Thread.sessionId` as the continuation key. It does not implement fork creation, fork UI, fork merge, or active-fork selection.

## Problem

The current app-server generation driver starts a new thread for each generation attempt:

```text
thread/start
turn/start
collect assistant text
close transport
```

That is safe for isolated generation, but it breaks the product requirement that a Plan Item move through Superpowers stages in one continuous Codex context:

```text
Brainstorming follow-up
  -> Spec Doc generation
  -> Implementation Plan Doc generation
```

The repository layer already has `CodexSession.codex_thread_id`, `codex_thread_id_digest`, `CodexSessionTurn`, and lease-fenced terminalization. The missing piece is a runtime path that:

- starts a thread only when a ForgeLoop `CodexSession` has no bound `codex_thread_id`;
- binds the returned `Thread.id` exactly once through lease-fenced terminalization;
- resumes the existing `Thread.id` for later turns;
- never starts a replacement thread after resume failure.

## Goals

- Interpret the current Codex app-server protocol correctly and encode that interpretation in tests or fixtures.
- Keep ForgeLoop `CodexSession.id` as the product/control-plane object.
- Use `CodexSession.codex_thread_id` as the Codex app-server `Thread.id` continuation handle.
- Keep raw `codex_thread_id` internal to trusted runtime/control-plane paths.
- Support first-turn start and bind.
- Support later-turn resume and turn start in the same worker/runtime lifecycle.
- Verify the resumed `Thread.id` equals the requested `codex_thread_id`.
- Block the session on resume failure or thread mismatch.
- Prove the same `codex_thread_id_digest` across multiple stage-like turns.

## Non-Goals

- No cross-worker snapshot restore.
- No `CODEX_HOME` packaging.
- No app-server resume by `history`.
- No app-server resume by `path` as a normal path.
- No normal product DTO or UI exposure of raw thread ids.
- No automatic new-thread fallback.
- No automatic fork, merge, or active-fork selection.
- No parsing Codex natural-language output to infer workflow state.
- No broad rewrite of existing runtime generation types beyond what this wave needs.

## Core Decision

Use session-bound runtime continuation.

Upstream product and workflow services address a ForgeLoop `CodexSession` and `CodexSessionTurn`. Trusted runtime/control-plane code resolves the bound app-server thread when it builds the runtime context.

The app-server driver receives a trusted continuation mode:

```ts
type CodexThreadContinuation =
  | { kind: 'start_thread' }
  | {
      kind: 'resume_thread';
      codex_thread_id: string;
      codex_thread_id_digest: string;
    };
```

The driver does not accept raw thread ids from normal product API payloads. Raw ids may appear only in trusted worker payloads, trusted internal terminalization, repository state, and admin/operator diagnostics.

## Domain Semantics

### ForgeLoop CodexSession

`CodexSession.id` is ForgeLoop's stable control-plane id. It owns:

- Plan Item Workflow ownership;
- active/inactive/fork role;
- session lifecycle state;
- lease fencing;
- latest turn and snapshot pointers;
- credential/runtime profile binding;
- internal app-server thread binding.

### App-Server Thread

`codex_thread_id` stores Codex app-server `Thread.id`.

Rules:

- It is absent before the first successful app-server `thread/start`.
- It is written only by trusted lease-fenced terminalization.
- It is immutable for that `CodexSession` after binding.
- Later turns use it for `thread/resume` and `turn/start`.
- If a later turn observes a different thread id, the session is blocked.

### App-Server Session Tree Metadata

`Thread.sessionId` is not a continuation id.

Wave 3 does not need to persist it. A future wave may add `codex_session_tree_id` or `app_server_session_id` for diagnostics and fork lineage, but it must not be used as the resume key.

## Trusted Runtime Context

Wave 3 should introduce or tighten a trusted runtime context shaped like:

```ts
type CodexSessionRuntimeContext = {
  codex_session_id: string;
  codex_session_turn_id: string;
  lease_id: string;
  lease_epoch: number;
  worker_id: string;
  worker_session_digest: string;
  expected_previous_snapshot_digest?: string;
  continuation: CodexThreadContinuation;
};
```

Rules:

- Normal product routes never accept `CodexThreadContinuation`.
- Workflow and repository code derive it from current `CodexSession` state after lease acquisition.
- `start_thread` is valid only when `CodexSession.codex_thread_id` is absent.
- `resume_thread` is valid only when both `codex_thread_id` and `codex_thread_id_digest` are present.
- If the session row has a partial thread binding, terminalization and runtime context creation fail closed.
- The context must carry lease fencing data through runtime execution and terminalization.

## Runtime Flow

### First Turn

For a session with no bound thread:

```text
claim CodexSession lease
create/running CodexSessionTurn
driver continuation = start_thread
initialize app-server transport
thread/start {
  approvalPolicy: 'never',
  sandbox: 'read-only',
  experimentalRawEvents: false,
  persistExtendedHistory: false
}
extract ThreadStartResponse.thread.id
compute codex_thread_id_digest
turn/start { threadId, input }
collect assistant output
terminalize with codex_thread_id and codex_thread_id_digest
repository binds codex_thread_id only if current session binding is null
release lease
```

The driver returns raw `codex_thread_id` only in an internal output field. Public generation result artifacts must expose only digest-level or product-safe continuity status.

### Later Turn In Same Worker Lifecycle

For a session with a bound thread:

```text
claim CodexSession lease
create/running CodexSessionTurn
driver continuation = resume_thread(codex_thread_id)
initialize app-server transport
thread/resume {
  threadId: codex_thread_id,
  excludeTurns: true,
  persistExtendedHistory: false
}
verify ThreadResumeResponse.thread.id == codex_thread_id
turn/start { threadId: codex_thread_id, input }
collect assistant output
terminalize with codex_thread_id and codex_thread_id_digest
repository verifies raw id and digest match session binding
release lease
```

The driver must not call `thread/start` in the later-turn path. Normal Wave 3 resume requests must not send `history` or `path`.

### Retry Within A Turn

Existing retry behavior for retryable app-server stream failures may remain, but retries are constrained:

- first-turn retry may call `thread/start` again only before terminalization has bound a thread id;
- later-turn retry must continue to target the same `codex_thread_id`;
- no retry path may create a replacement thread for an already-bound session;
- after terminalization fails as stale, the runtime must not attempt a second terminalization that overwrites newer state.

### Same-Worker Runtime Lifetime

Wave 3 chooses one implementation topology: a session-bound app-server runner keeps one app-server launch, transport, and runtime ownership scope alive across the accepted stage-like turn group.

The current one-shot generation path may still exist for isolated generation, but session-bound workloads must use the session-bound runner. The runner owns:

- one app-server launch for the turn group;
- one transport lifecycle for `thread/start`, later `thread/resume`, and associated `turn/start` calls;
- cleanup only after the accepted turn group succeeds, fails, is cancelled, or blocks.

The current leased Docker generation path closes an app-server launch after each generation. Wave 3 must add a session-bound path for CodexSession workloads that does not call that per-generation close between turns. This is a same-worker lifetime change, not a cross-worker archive/restore feature.

The scheduler and daemon must preserve live-runner ownership explicitly:

- the scheduler may route a bound `CodexSession` later turn only to the worker/app-server launch that owns the live session-bound runner;
- if that owner is unavailable, unknown, expired, or different from the claimed worker, the turn is blocked with `codex_session_runner_unavailable`;
- the automation daemon owns a per-`CodexSession.id` session-bound runner registry for the accepted turn group;
- the app-server launch and Codex runtime launch lease are finalized exactly once when the accepted turn group succeeds, fails, is cancelled, or blocks;
- the per-turn `CodexSessionLease` is still acquired and released per turn and must not be held across human review gaps.

If the live app-server is lost before a later resume, that later resume is expected to block rather than create a replacement thread. Restarting app-server and relying on an uncleaned local `CODEX_HOME` is diagnostic-only in Wave 3 and is not sufficient acceptance evidence.

## Terminalization Rules

The existing lease-fenced terminalization is the authority for state mutation. Wave 3 must make the thread-binding invariants explicit.

First-turn successful app-server-backed terminalization must include:

```ts
{
  codex_thread_id: string;
  codex_thread_id_digest: string;
}
```

It succeeds only when:

- session, turn, and lease all match the current row;
- lease is active and unexpired;
- `lease_epoch`, `lease_id`, `worker_id`, and `worker_session_digest` match;
- `expected_previous_snapshot_digest` still matches;
- session has no existing `codex_thread_id` and no existing `codex_thread_id_digest`;
- turn belongs to the session and is running.

A successful app-server-backed first turn that lacks either `codex_thread_id` or `codex_thread_id_digest` is invalid for Wave 3 because later turns would have no verified continuation handle.

Later-turn successful terminalization in the trusted internal path must include both:

```ts
{
  codex_thread_id: string;
  codex_thread_id_digest: string;
}
```

The repository must treat the later-turn raw `codex_thread_id` as an equality assertion only. It must not rewrite or re-bind the existing session thread id.

It succeeds only when:

- all lease fencing fields match;
- session has a complete existing thread binding;
- provided digest equals `session.codex_thread_id_digest`;
- provided raw id equals `session.codex_thread_id`.

Rejected terminalizations are recorded as stale attempts and must not mutate:

- `CodexSession.codex_thread_id`;
- `CodexSession.codex_thread_id_digest`;
- latest turn pointers;
- latest snapshot pointers;
- workflow stage.

Repository-rejected stale terminalizations are not the same thing as active runtime blocking failures. A rejected stale terminalization records a stale attempt and marks only the attempted running turn stale through the existing stale-terminalization path. It must not block or otherwise mutate a newer valid `CodexSession`.

Failed or cancelled terminalization must still carry the `CodexSessionLease` fencing fields and a product-safe `failure_code`. A resume failure terminalization:

- releases or finalizes the current per-turn `CodexSessionLease` according to the existing lease semantics;
- marks the current turn failed or cancelled;
- moves the session to `blocked`;
- does not bind a new thread id;
- does not create a replacement thread.

The session-bound app-server launch and its Codex runtime launch lease are separate from the per-turn `CodexSessionLease`. They are finalized by the session-bound runner owner when the accepted turn group succeeds, fails, is cancelled, or blocks, not by each individual turn.

Thread binding is allowed only on successful first-turn terminalization. If a first-turn failure observes a raw app-server thread id before the turn succeeds, that raw id may appear only as internal diagnostic evidence and must not bind `CodexSession.codex_thread_id`.

## Failure Semantics

Wave 3 must fail closed.

Blocking failures include:

- later-turn context requested but session has no bound `codex_thread_id`;
- session has partial thread binding;
- `thread/resume` request fails;
- `thread/resume` returns a different `Thread.id`;
- later-turn digest does not match session digest;
- driver attempts `thread/start` for a bound session;
- terminalization tries to overwrite an existing thread binding;
- app-server protocol response lacks a thread id where one is required.

On blocking failures:

- the turn status becomes failed or cancelled according to existing status taxonomy;
- the session status becomes `blocked`;
- the public failure surface uses a product-safe blocker code;
- raw thread ids and raw app-server payloads remain internal.

Resume failure must never create a replacement thread automatically. Replacement requires an explicit abandon/new-session action or future fork action recorded on the Plan Item Workflow.

Required product-safe blocker codes:

| Blocking case | `failure_code` | Turn terminal status | Session status | Raw-id policy | Lease action |
| --- | --- | --- | --- | --- | --- |
| Later-turn context requested without a bound thread | `codex_session_resume_without_binding` | `failed` | `blocked` | Do not include raw id | Release/finalize per-turn `CodexSessionLease`; keep app-server launch state unchanged unless group is closed |
| Session has partial thread binding | `codex_session_thread_binding_partial` | `failed` | `blocked` | Do not include raw id | Release/finalize per-turn `CodexSessionLease`; close session-bound runner if it exists |
| Bound-session runner owner is unavailable, unknown, expired, or different | `codex_session_runner_unavailable` | `failed` | `blocked` | Do not include raw id | Release/finalize per-turn `CodexSessionLease`; finalize any stale launch ownership record without creating replacement |
| `thread/resume` request fails | `codex_app_server_resume_failed` | `failed` | `blocked` | Use digest only in public evidence; raw id stays trusted internal only if needed for the app-server call/equality evidence | Release/finalize per-turn `CodexSessionLease`; finalize session-bound app-server launch because continuity is lost |
| `thread/resume` returns a different `Thread.id` | `codex_app_server_thread_mismatch` | `failed` | `blocked` | Do not expose observed raw id; record digest/equality failure only | Release/finalize per-turn `CodexSessionLease`; finalize session-bound app-server launch |
| Later-turn digest does not match session digest | `codex_session_thread_digest_mismatch` | `failed` | `blocked` | Do not include raw id in public evidence | Release/finalize per-turn `CodexSessionLease`; close session-bound runner if it exists |
| Driver attempts `thread/start` for a bound session | `codex_session_thread_start_for_bound_session` | `failed` | `blocked` | Do not bind or expose any new raw id | Release/finalize per-turn `CodexSessionLease`; finalize session-bound app-server launch |
| Repository rejects stale terminalization that tried to overwrite an existing thread binding | `codex_session_thread_binding_stale` | Rejected; attempted running turn is marked `stale` by the stale-terminalization path | Unchanged | Existing raw id remains immutable; attempted raw id is not public | Record stale terminalization attempt; do not overwrite state through rejected terminalization; any lease recovery/release follows the existing stale/recovery path |
| App-server response lacks a required thread id | `codex_app_server_thread_id_missing` | `failed` | `blocked` | No raw id available | Release/finalize per-turn `CodexSessionLease`; finalize session-bound app-server launch |

Driver-detected mismatches and resume failures block the active session because the live continuity path is unsafe. Repository-rejected stale writes do not block a newer valid session because they are evidence of an older fenced attempt losing the race.

## Module Boundaries

### `packages/codex-runtime`

Required changes:

- Extend `AppServerGenerateInput` with trusted continuation metadata or add a session-bound generation input wrapper.
- Support `start_thread` and `resume_thread`.
- For `resume_thread`, call `thread/resume` before `turn/start`.
- Validate returned `thread.id`.
- Return internal thread metadata in `AppServerGenerateOutput`.
- Update generation command safety to allow `thread/resume` only for trusted session-bound generation contexts.
- Keep effective sandbox/config validation.
- Preserve output-size and raw-notification limits.
- Preserve best-effort `turn/interrupt` cleanup using the active `threadId` and `turnId`.

### `packages/domain`

Required changes:

- Encode thread-binding invariants in domain helpers where they can be tested without DB specifics.
- Treat raw thread binding as internal runtime evidence, not product workflow state.
- Keep `PlanItemWorkflow.status` manual and evidence-backed.

### `packages/db`

Required changes:

- Keep Drizzle and in-memory repository behavior identical.
- Enforce first-bind-only semantics.
- Enforce later-turn digest equality.
- Record stale terminalization attempts for rejected thread-binding writes.
- Add repository tests covering all thread-binding edge cases.

### Runtime Orchestration Owners

Required changes:

- `apps/control-plane-api/src/modules/codex-runtime/product-generation-runtime-scheduler.service.ts` claims the product action, resolves workflow/session/turn context, and creates the runtime job only after the workflow context matches the action run.
- The service or a narrow collaborator must acquire or validate the active `CodexSession` lease before building `CodexSessionRuntimeContext`.
- `packages/domain/src/codex-runtime.ts` and the runtime job workload schema carry the internal trusted continuation payload. Raw thread ids are allowed only in this runtime job workload and related trusted internal evidence, never in public product DTOs.
- `apps/control-plane-api/src/modules/plan-item-workflows/codex-session-lease.service.ts` remains the internal HTTP boundary for claiming, renewing, and terminalizing per-turn `CodexSessionLease` records. The runtime scheduler and daemon must use this boundary rather than bypassing stale-attempt recording.
- `apps/automation-daemon/src/generation-runtime.ts` consumes the trusted runtime job workload, selects the session-bound generation runner for CodexSession workloads, owns the per-`CodexSession.id` runner registry, preserves same-worker ownership between accepted turns, finalizes the app-server launch exactly once per accepted turn group, and returns terminal thread metadata or a product-safe `failure_code`.
- `packages/codex-runtime` owns the app-server protocol calls, same-worker session-bound runner, digest computation helper, and fake/real transport tests.
- `packages/db` owns lease-fenced terminalization and stale-attempt recording.
- Product/API callers cannot provide raw thread ids. They may only request product actions against a workflow/session/turn.

### Contracts

Required changes:

- Add internal/trusted DTO schemas only where needed.
- Do not expose raw `codex_thread_id` in normal product DTOs.
- If diagnostics need thread evidence, expose digests and product-safe continuity status by default.

## Security And Privacy

- Raw `codex_thread_id` is internal runtime metadata.
- Normal Plan Item product DTOs must not return raw thread ids.
- Logs should include thread digests and blocker codes, not raw thread ids.
- Trusted worker/control-plane payloads may carry raw thread ids only when needed to call app-server.
- `Thread.sessionId` must not be rebranded as a stable product id.
- App-server generated protocol fixtures are allowed in tests, but must not include real thread ids or user conversation content.

## Verification Strategy

### Protocol Verification

Add a lightweight protocol fixture or test that documents the current app-server contract:

- `ThreadResumeParams.threadId` exists as a required field.
- `ThreadResumeParams.excludeTurns` exists as an optional field.
- `ThreadResumeParams.persistExtendedHistory` exists as a required field and Wave 3 requests set it to `false`.
- `ThreadResumeParams.history` exists as an optional field and normal Wave 3 requests omit it.
- `ThreadResumeParams.path` exists as an optional field and normal Wave 3 requests omit it.
- `ThreadStartParams.experimentalRawEvents` exists as a required field and Wave 3 requests set it to `false`.
- `ThreadStartParams.persistExtendedHistory` exists as a required field and Wave 3 requests set it to `false`.
- `TurnStartParams.threadId` exists as a required field.
- `TurnStartParams.input` exists as a required field.
- `Thread.id` exists.
- `Thread.sessionId` is session-tree metadata and not used as the continuation key.
- protocol fixtures distinguish generated required fields from generated optional fields so future Codex CLI drift fails visibly.

This may be a checked-in fixture generated from `codex app-server generate-ts --experimental`, a focused schema assertion, or a scripted test that runs when Codex CLI is available and otherwise falls back to a committed fixture.

### Runtime Driver Tests

Use a fake transport that records requests and returns controlled responses.

Required cases:

- first turn calls `thread/start` then `turn/start`;
- first turn returns internal raw thread id and digest;
- later turn calls `thread/resume` then `turn/start`;
- later turn does not call `thread/start`;
- resume response thread id mismatch fails;
- resume failure fails without fallback to `thread/start`;
- retryable later-turn failure retries against the same thread id only.

### Repository Tests

Required cases for both Drizzle and in-memory repositories:

- first terminalization can bind thread id when session binding is null;
- successful app-server-backed first terminalization must provide both raw thread id and digest;
- stale first terminalization cannot overwrite an already-bound session;
- partial binding is rejected;
- later terminalization digest must match session digest;
- raw id mismatch is rejected if supplied;
- rejected binding attempts are recorded as stale terminalization attempts;
- lease expiry and lease epoch mismatch still fence terminalization.

### Integration Or Smoke Evidence

Wave 3 must include at least one same-worker continuity smoke path against a real Codex app-server process. Fake transports remain required for deterministic unit tests, but fake-only evidence is not sufficient to complete this wave.

The implementation must add:

```text
pnpm dogfood:codex-app-server-resume
```

backed by:

```text
scripts/codex-app-server-resume-dogfood.ts
```

The command is opt-in and must skip in normal CI unless this environment variable is set:

```text
FORGELOOP_CODEX_APP_SERVER_RESUME_DOGFOOD=1
```

When skipped, it must print:

```text
SKIP codex app-server resume dogfood: set FORGELOOP_CODEX_APP_SERVER_RESUME_DOGFOOD=1
```

The real smoke path should run:

```text
stage-like turn 1: brainstorming follow-up
stage-like turn 2: spec generation
stage-like turn 3: implementation plan generation
```

Evidence must show:

- one ForgeLoop `CodexSession.id`;
- one stable `codex_thread_id_digest`;
- `thread_start_count: 1`;
- `thread_resume_count >= 2`;
- `replacement_thread_start_count: 0`;
- later turns use `thread/resume`;
- no raw `codex_thread_id` in public output.

The smoke command should write a machine-readable report to:

```text
test-results/codex-app-server-resume-dogfood.json
```

The report must include product-safe identifiers and digests, request counters, skip/pass/fail status, and blocker codes. It must not include real raw thread ids, prompt transcripts, credentials, or raw app-server payloads.

This does not need to prove cross-worker restore. That evidence belongs to Wave 4.

### Standard Checks

Implementation must run:

```text
pnpm test
pnpm build
git diff --check
pnpm dogfood:codex-app-server-resume
```

The dogfood command may skip without credentials or without `FORGELOOP_CODEX_APP_SERVER_RESUME_DOGFOOD=1`, but Wave 3 cannot be accepted as complete until a real app-server run has produced passing same-worker resume evidence.

Also run a no-baggage scan such as:

```text
rg -n "codex_thread_id" apps/web packages/contracts apps/control-plane-api/src/modules -g '!**/*.test.*'
```

The scan should prove normal product DTOs and UI do not expose raw thread ids. Hits are allowed only in trusted internal controllers/DTOs, runtime job workload schemas, and lease terminalization boundaries; normal product DTOs, query responses, and UI must not expose raw thread ids.

## Acceptance Criteria

Wave 3 is complete when:

- implementation verifies the current Codex app-server resume protocol;
- first turn starts a thread and binds `CodexSession.codex_thread_id` through lease-fenced terminalization;
- later turns resume the existing `codex_thread_id` and then start a new turn in that thread;
- later-turn code path does not call `thread/start`;
- terminal evidence records one stable `codex_thread_id_digest`;
- stale first-turn terminalization cannot overwrite a bound thread id;
- resume failure blocks the session and never creates a replacement thread;
- raw thread ids remain internal to trusted runtime/control-plane code;
- same-worker smoke evidence demonstrates multiple stage-like turns under one stable app-server thread digest.

## Implementation Notes For The Plan

The implementation plan should keep this wave narrow:

1. Add runtime continuation types and driver behavior.
2. Add internal output metadata for thread id, digest, and turn id.
3. Tighten repository/domain invariants if current Wave 2 behavior is too permissive.
4. Add tests before broad integration.
5. Add the session-bound runner and route CodexSession workloads through it.
6. Add the opt-in real app-server resume dogfood command and report.

Do not start Wave 4 work in this plan. If the implementation discovers that app-server cannot resume a non-running thread without restored local state, that is not a Wave 3 blocker as long as same-worker live thread resume works through the session-bound runner and the failure mode for non-restored threads is blocked rather than replacement.

## Open Questions Deferred To Later Waves

- Exact `CODEX_HOME` file whitelist for portable snapshot restore.
- Whether to persist `Thread.sessionId` as `codex_session_tree_id` for diagnostics.
- Whether fork should call `thread/fork` directly or fork from a restored snapshot first.
- Operator UI for blocked session diagnosis.
- Snapshot retention and pruning policy.
