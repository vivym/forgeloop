# Codex Long-Running Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Forgeloop run Codex as an observable, durable, user-steerable long-running job with live Web output and preserved terminal evidence.

**Architecture:** Introduce durable run runtime records, append-only run events, worker leases, and a command inbox, then route package runs through a reusable run-worker package instead of synchronously awaiting `runCodex()`. Codex app-server is the primary driver, `codex exec --json --dangerously-bypass-approvals-and-sandbox` is the fallback, and every non-mock local run executes from `.worktrees/<run-session-id>` while evidence capture and Review Packet finalization stay compatible with the existing workflow contracts.

**Tech Stack:** pnpm workspaces, TypeScript, NestJS, Drizzle ORM/PostgreSQL schema, React/Vite, Vitest, Supertest, Server-Sent Events, Codex app-server JSON-RPC, Codex exec JSONL fallback, Git worktrees.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-05-06-codex-long-running-execution-design.md`
- Existing P0 plan: `docs/superpowers/plans/2026-05-04-p0-delivery-loop-mvp.md`
- Relevant skills for implementation: @superpowers:subagent-driven-development, @superpowers:executing-plans, @superpowers:test-driven-development, @superpowers:systematic-debugging, @superpowers:verification-before-completion

## Scope Guardrails

Implement the first production-shaped local slice from the spec. Do not add multi-machine worker scheduling, strong Codex checkpointing, PR creation, merge, deploy, release, or raw-log download UI.

Durability is a product requirement. `InMemoryP0Repository` can remain for tests and explicit fake/demo runs, but any code path that claims restart recovery, multi-day execution, durable input, or worker takeover must use the repository durability boundary. If the API is still configured with in-memory storage in local dev, label that mode as `volatile_demo` in runtime metadata and do not present it as restart-safe.

`timeout_seconds` remains valid for required checks and explicit bounded sub-operations. It must not kill the main Codex run.

The worktree boundary is not a security sandbox. Dangerous/yolo mode is accepted, and the implementation must record the effective dangerous mode and detect source repo mutations outside `.worktrees/<run-session-id>`.

`.worktrees/` and `.superpowers/` are already in `.gitignore`; keep them there and add regression coverage so they are not accidentally removed.

## Target File Structure

```text
packages/contracts/src/
  executor.ts                       # Existing executor contract; add runtime/raw metadata expectations where needed
  api.ts                            # Public API DTO contracts for events, commands, run accepted responses
  index.ts                          # Export new schemas and types

packages/domain/src/
  types.ts                          # Run runtime, event, command, lease domain types
  states.ts                         # RunSession transition rules for new non-terminal statuses
  index.ts                          # Export new domain types

packages/db/src/schema/
  _shared.ts                        # Extended run_session_status enum
  run-session.ts                    # Runtime metadata columns
  run-event.ts                      # New append-only run event table
  run-event-counter.ts              # Per-run atomic event sequence allocation
  run-command.ts                    # New durable command inbox table
  run-worker-lease.ts               # New worker lease table
  index.ts                          # Export new schema tables
packages/db/src/repositories/
  p0-repository.ts                  # Durable run APIs
  in-memory-p0-repository.ts        # Test/demo implementation of new APIs
  drizzle-p0-repository.ts          # PostgreSQL implementation of new APIs
packages/db/drizzle.config.ts       # Drizzle schema push config for durable local DB setup

packages/executor/src/
  codex-session-driver.ts           # Driver interface shared by app-server and exec fallback
  codex-event-normalizer.ts         # Stable normalized RunEvent conversion and redaction
  codex-raw-log-store.ts            # Internal raw notification/JSONL retention as logs artifacts
  codex-app-server-driver.ts        # App-server JSON-RPC driver
  codex-exec-fallback-driver.ts     # exec/resume --json fallback driver
  codex-worktree.ts                 # Persistent .worktrees/<run-session-id> preparation
  source-repo-guard.ts              # Source repo pre/post mutation detection
  local-codex-evidence.ts           # Workspace diff/check/artifact capture after Codex terminal state
  local-codex-preflight.ts          # Use persistent worktrees and dangerous mode preflight
  local-codex-executor.ts           # Reuse evidence capture around worker-driven Codex completion
  index.ts                          # Export new driver/worktree utilities

packages/workflow/src/
  activities.ts                     # Split synchronous executePackageRun into build/start/finalize helpers
  execution-finalizer.ts            # Idempotent terminal ExecutorResult -> ReviewPacket/package updates
  index.ts                          # Export finalizer helpers

packages/run-worker/
  package.json
  tsconfig.json
  src/index.ts
  src/run-worker.ts                 # Claim recoverable runs, drive Codex, process commands, finalize
  src/run-dispatcher.ts             # Durable queued-run discovery and in-process kick helper
  src/command-inbox.ts              # Idempotent input/cancel/resume command application
  src/lease.ts                      # Lease claim/heartbeat/expiry helpers
  src/watchdog.ts                   # Progress/liveness watchdog semantics
  src/fake-codex-session-driver.ts  # Test driver with scripted events/input pauses

apps/control-plane-api/src/p0/
  dto.ts                            # Input/cancel/resume DTO schemas
  run-session-serialization.ts      # Public run/session artifact and raw-log redaction
  p0.module.ts                      # Repository and run worker providers
  p0.service.ts                     # Async run acceptance, event backfill, command creation
  p0.controller.ts                  # Run event REST, SSE, input, cancel, resume endpoints
  run-worker-lifecycle.service.ts   # API-process polling wake-up for recoverable runs

apps/web/src/
  api.ts                            # RunEvent/command client and EventSource helpers
  workbenchState.ts                 # Cursor/reconnect/run-console state helpers
  App.tsx                           # Run Console UI
  styles.css                        # Console layout and event styling

tests/
  helpers/p0-runtime-fixtures.ts
  contracts/run-events.test.ts
  domain/run-session-states.test.ts
  db/run-runtime-repository.test.ts
  executor/codex-event-normalizer.test.ts
  executor/codex-session-driver.test.ts
  executor/codex-worktree.test.ts
  workflow/execution-finalizer.test.ts
  run-worker/run-worker.test.ts
  run-worker/command-inbox.test.ts
  run-worker/watchdog.test.ts
  api/run-events.test.ts
  api/async-run.test.ts
  web/run-console-state.test.ts
  smoke/p0-smoke.test.ts
scripts/p0-dogfood.ts
```

## Implementation Notes

- Prefer small exported helpers over making `P0Service` larger. `P0Service` should create durable records and expose API-level orchestration; `packages/run-worker` should own long-running execution.
- Keep app-server and fallback exec behind `CodexSessionDriver`; tests should use `FakeCodexSessionDriver` until the real Codex process is needed.
- `CodexSessionDriver` streams normalized events and a terminal Codex outcome. It does not create the final `ExecutorResult`; the worker calls an evidence collector after terminal Codex completion to capture diff, changed files, artifacts, and required checks.
- SSE must treat the database/repository as source of truth. A short polling loop that backfills new events from durable storage is acceptable for the first slice; an in-memory event bus can only be a wake-up optimization.
- Public event responses must omit `raw_ref`. Store raw references internally on `RunEvent`.
- Raw Codex logs are internal artifacts. Public API serializers and the first Web UI must filter `kind: 'logs'`, `raw_ref`, and raw-log `log_refs`; hiding them only in the Run Console is not sufficient.
- Worker lease ownership is a fencing boundary, not just a scheduling hint. Every worker-owned write after lease acquisition must be conditioned on the active `worker_id` and `lease_token` for that run.
- Commit after each task. If any task uncovers an architectural blocker, stop and use @superpowers:systematic-debugging before editing around it.

## Task 1: Contracts and Domain Runtime Model

**Files:**
- Modify: `packages/contracts/src/api.ts`
- Modify: `packages/contracts/src/executor.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/domain/src/types.ts`
- Modify: `packages/domain/src/states.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `tests/contracts/run-events.test.ts`
- Test: `tests/contracts/contracts.test.ts`
- Test: `tests/domain/run-session-states.test.ts`

- [ ] **Step 1: Write failing contract tests for public run event and command schemas**

Create `tests/contracts/run-events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  runAcceptedResponseSchema,
  runOperatorCommandResponseSchema,
  runEventListResponseSchema,
  publicRunEventSchema,
} from '../../packages/contracts/src';

describe('run event API contracts', () => {
  it('accepts async run accepted responses without workflow_result', () => {
    expect(
      runAcceptedResponseSchema.parse({
        status: 'accepted',
        run_session_id: 'run-session-1',
        execution_package_id: 'execution-package-1',
      }),
    ).toEqual({
      status: 'accepted',
      run_session_id: 'run-session-1',
      execution_package_id: 'execution-package-1',
    });
  });

  it('omits raw_ref from public run events', () => {
    const event = publicRunEventSchema.parse({
      id: 'run-event-1',
      run_session_id: 'run-session-1',
      sequence: 1,
      cursor: '0000000001',
      event_type: 'agent_message_delta',
      source: 'codex',
      visibility: 'public',
      summary: 'Codex wrote output.',
      payload: { text: 'hello' },
      created_at: '2026-05-07T00:00:00.000Z',
    });

    expect(event).not.toHaveProperty('raw_ref');
  });

  it('rejects internal events in the public event contract', () => {
    expect(
      publicRunEventSchema.safeParse({
        id: 'run-event-internal',
        run_session_id: 'run-session-1',
        sequence: 2,
        cursor: '0000000002',
        event_type: 'codex_warning',
        source: 'codex',
        visibility: 'internal',
        summary: 'Internal raw event.',
        payload: {},
        created_at: '2026-05-07T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('lists events with cursor metadata', () => {
    expect(
      runEventListResponseSchema.parse({
        events: [],
        next_cursor: '0000000002',
        has_more: false,
      }),
    ).toMatchObject({ events: [], has_more: false });
  });

  it('accepts durable run command responses', () => {
    expect(
      runOperatorCommandResponseSchema.parse({
        status: 'accepted',
        command_id: 'run-command-1',
        run_session_id: 'run-session-1',
        command_type: 'input',
      }),
    ).toMatchObject({ status: 'accepted', command_type: 'input' });
  });
});
```

- [ ] **Step 2: Run contract tests to verify they fail**

Run: `pnpm test tests/contracts/run-events.test.ts`

Expected: FAIL with missing exports such as `runAcceptedResponseSchema`.

- [ ] **Step 3: Add public API schemas**

In `packages/contracts/src/api.ts`, add these unions and schemas:

First extend the existing executor import:

```ts
import { executorTypeSchema, jsonObjectSchema } from './executor';
```

Then add:

```ts
export const runEventTypeSchema = z.enum([
  'run_queued',
  'worker_lease_acquired',
  'driver_started',
  'thread_started',
  'thread_resumed',
  'turn_started',
  'turn_status_changed',
  'agent_message_delta',
  'agent_message_completed',
  'plan_updated',
  'tool_call_started',
  'tool_call_progress',
  'tool_call_completed',
  'command_started',
  'command_output_delta',
  'command_completed',
  'waiting_for_input',
  'user_input',
  'watchdog_heartbeat',
  'watchdog_idle_detected',
  'stalled',
  'resuming',
  'cancel_requested',
  'cancelled',
  'codex_warning',
  'driver_fallback_used',
  'executor_result_started',
  'required_check_started',
  'required_check_completed',
  'artifact_captured',
  'run_succeeded',
  'run_failed',
]);
export type RunEventType = z.infer<typeof runEventTypeSchema>;

export const runEventSourceSchema = z.enum(['api', 'worker', 'codex', 'executor', 'watchdog', 'user']);
export type RunEventSource = z.infer<typeof runEventSourceSchema>;

export const runEventVisibilitySchema = z.enum(['public', 'internal']);
export type RunEventVisibility = z.infer<typeof runEventVisibilitySchema>;

export const publicRunEventSchema = z.object({
  id: z.string().min(1),
  run_session_id: z.string().min(1),
  sequence: z.number().int().positive(),
  cursor: z.string().min(1),
  event_type: runEventTypeSchema,
  source: runEventSourceSchema,
  visibility: z.literal('public'),
  summary: z.string().min(1),
  payload: jsonObjectSchema,
  created_at: z.string().datetime(),
});
export type PublicRunEvent = z.infer<typeof publicRunEventSchema>;

export const runEventListResponseSchema = z.object({
  events: z.array(publicRunEventSchema),
  next_cursor: z.string().min(1).optional(),
  has_more: z.boolean(),
});
export type RunEventListResponse = z.infer<typeof runEventListResponseSchema>;

export const runAcceptedResponseSchema = z.object({
  status: z.literal('accepted'),
  run_session_id: z.string().min(1),
  execution_package_id: z.string().min(1),
}).strict();
export type RunAcceptedResponse = z.infer<typeof runAcceptedResponseSchema>;

export const runCommandTypeSchema = z.enum(['input', 'cancel', 'resume']);
export type RunCommandType = z.infer<typeof runCommandTypeSchema>;

export const runOperatorCommandResponseSchema = z.object({
  status: z.literal('accepted'),
  command_id: z.string().min(1),
  run_session_id: z.string().min(1),
  command_type: runCommandTypeSchema,
}).strict();
export type RunOperatorCommandResponse = z.infer<typeof runOperatorCommandResponseSchema>;
```

Do not rename or overwrite the existing `runCommandResponseSchema` / `RunCommandResponse` symbol in `api.ts`; keeping it avoids a TypeScript name collision and preserves compatibility for any older internal callers during the transition. Export the new operator-command symbols from `packages/contracts/src/index.ts`.

Then update package-run response aliases to the async accepted shape required by the new spec:

```ts
export const runPackageResponseSchema = runAcceptedResponseSchema;
export type RunPackageResponse = RunAcceptedResponse;

export const rerunPackageResponseSchema = runAcceptedResponseSchema;
export type RerunPackageResponse = RunAcceptedResponse;

export const forceRerunPackageResponseSchema = runAcceptedResponseSchema;
export type ForceRerunPackageResponse = RunAcceptedResponse;
```

Keep `runCommandResponseSchema` exported as a deprecated legacy command response until all older callers are removed; do not use it for package run/rerun/force-rerun responses after this task.

- [ ] **Step 4: Update existing contract tests for async package responses**

In `tests/contracts/contracts.test.ts`, replace the old package command response examples with:

```ts
it('parses async package run responses', () => {
  const run = runPackageResponseSchema.parse({
    execution_package_id: 'exec-package-1',
    run_session_id: 'run-session-1',
    status: 'accepted',
  });
  const rerun = rerunPackageResponseSchema.parse({
    execution_package_id: 'exec-package-1',
    run_session_id: 'run-session-2',
    status: 'accepted',
  });
  const forceRerun = forceRerunPackageResponseSchema.parse({
    execution_package_id: 'exec-package-1',
    run_session_id: 'run-session-3',
    status: 'accepted',
  });

  expect([run.run_session_id, rerun.run_session_id, forceRerun.run_session_id]).toEqual([
    'run-session-1',
    'run-session-2',
    'run-session-3',
  ]);
});

it('rejects async package run responses with workflow_result', () => {
  expect(
    runPackageResponseSchema.safeParse({
      execution_package_id: 'exec-package-1',
      run_session_id: 'run-session-1',
      status: 'accepted',
      workflow_result: { status: 'succeeded' },
    }).success,
  ).toBe(false);
});
```

- [ ] **Step 5: Write failing domain state tests**

Create `tests/domain/run-session-states.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { transitionRunSession } from '../../packages/domain/src';

describe('long-running run session states', () => {
  it('moves through non-terminal progress and attention states', () => {
    const created = transitionRunSession(undefined, {
      type: 'create',
      id: 'run-session-1',
      execution_package_id: 'execution-package-1',
      requested_by_actor_id: 'actor-owner',
      at: '2026-05-07T00:00:00.000Z',
    });
    const running = transitionRunSession(created, { type: 'workflow_start', at: '2026-05-07T00:00:01.000Z' });
    const waiting = transitionRunSession(running, {
      type: 'waiting_for_input',
      reason: 'Codex requested direction.',
      at: '2026-05-07T00:00:02.000Z',
    });
    const resuming = transitionRunSession(waiting, { type: 'resume_requested', at: '2026-05-07T00:00:03.000Z' });

    expect(waiting.status).toBe('waiting_for_input');
    expect(resuming.status).toBe('resuming');
    expect(resuming.finished_at).toBeUndefined();
  });

  it('does not allow terminal runs to resume', () => {
    const cancelled = transitionRunSession(
      transitionRunSession(undefined, {
        type: 'create',
        id: 'run-session-1',
        execution_package_id: 'execution-package-1',
        requested_by_actor_id: 'actor-owner',
        at: '2026-05-07T00:00:00.000Z',
      }),
      { type: 'cancel', at: '2026-05-07T00:00:01.000Z' },
    );

    expect(() => transitionRunSession(cancelled, { type: 'resume_requested' })).toThrow(/Cannot apply/);
  });
});
```

- [ ] **Step 6: Run domain tests to verify they fail**

Run: `pnpm test tests/domain/run-session-states.test.ts`

Expected: FAIL because `waiting_for_input` and `resume_requested` transitions do not exist.

- [ ] **Step 7: Extend domain runtime types**

In `packages/domain/src/types.ts`, replace `RunSessionStatus` with:

```ts
export type RunSessionStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_input'
  | 'stalled'
  | 'resuming'
  | 'cancel_requested'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'cancelled';
```

Add:

```ts
export type RunDriverKind = 'app_server' | 'exec_fallback' | 'fake';
export type RunDriverStatus = 'not_started' | 'starting' | 'active' | 'waiting_for_input' | 'stalled' | 'terminal';
export type EffectiveDangerousMode = 'confirmed' | 'unconfirmed' | 'not_requested';

export interface RunRuntimeMetadata {
  durability_mode: 'durable' | 'volatile_demo';
  driver_kind?: RunDriverKind;
  driver_status?: RunDriverStatus;
  codex_thread_id?: string;
  active_turn_id?: string;
  workspace_path?: string;
  app_server_endpoint?: string;
  worker_id?: string;
  last_event_cursor?: string;
  last_event_at?: IsoDateTime;
  recovery_attempt_count: number;
  effective_dangerous_mode: EffectiveDangerousMode;
}
```

Add `runtime_metadata?: RunRuntimeMetadata` to `RunSession`.

Add `RunEvent`, `RunCommand`, and `RunWorkerLease` interfaces using the fields from spec sections 7.5, 9.2, and 10.1. Import event/command unions from `@forgeloop/contracts` rather than duplicating string unions. `RunWorkerLease` must include a random `lease_token` generated on acquisition and retained only in the lease table plus the worker's local context; do not copy the token into `RunRuntimeMetadata` or public API responses. `RunCommand` must include `claimed_at?: IsoDateTime` and `driver_ack?: Record<string, unknown>` so stale claimed commands can be reclaimed after a worker crash without injecting already-applied input twice.

- [ ] **Step 8: Add RunSession transitions**

In `packages/domain/src/states.ts`, extend `RunSessionTransition` with:

```ts
| (Timestamped & { type: 'worker_started'; runtime_metadata?: Partial<RunSession['runtime_metadata']> })
| (Timestamped & { type: 'waiting_for_input'; reason: string })
| (Timestamped & { type: 'stalled'; reason: string })
| (Timestamped & { type: 'resume_requested' | 'cancel_requested' })
| (Timestamped & { type: 'recovered'; runtime_metadata?: Partial<RunSession['runtime_metadata']> });
```

Implement these rules:

- `workflow_start` and `worker_started` move `queued`, `stalled`, or `resuming` to `running`.
- `waiting_for_input` and `stalled` are non-terminal and preserve `finished_at`.
- `resume_requested` moves `waiting_for_input` or `stalled` to `resuming`.
- `resume_requested` is idempotent when the run is already `resuming`.
- `cancel_requested` moves any non-terminal run to `cancel_requested` and is idempotent when the run is already `cancel_requested`.
- Existing `cancel` terminal transition can move from `cancel_requested`, `running`, `waiting_for_input`, `stalled`, or `resuming` to `cancelled`.
- Terminal runs cannot transition back to non-terminal states.

- [ ] **Step 9: Run focused tests**

Run: `pnpm test tests/contracts/run-events.test.ts tests/contracts/contracts.test.ts tests/domain/run-session-states.test.ts tests/domain/states.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/contracts/src packages/domain/src tests/contracts/run-events.test.ts tests/contracts/contracts.test.ts tests/domain/run-session-states.test.ts tests/domain/states.test.ts
git commit -m "feat: add long-running run domain model"
```

## Task 2: Durable Repository and Schema Support

**Files:**
- Modify: `packages/db/src/schema/_shared.ts`
- Modify: `packages/db/src/schema/run-session.ts`
- Create: `packages/db/src/schema/run-event.ts`
- Create: `packages/db/src/schema/run-event-counter.ts`
- Create: `packages/db/src/schema/run-command.ts`
- Create: `packages/db/src/schema/run-worker-lease.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/repositories/p0-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-p0-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-p0-repository.ts`
- Create: `packages/db/drizzle.config.ts`
- Modify: `package.json`
- Test: `tests/db/run-runtime-repository.test.ts`
- Test: `tests/db/schema.test.ts`
- Test: `tests/db/repository.test.ts`

- [ ] **Step 1: Write failing repository tests for events, commands, leases, and recoverable runs**

Create `tests/db/run-runtime-repository.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { InMemoryP0Repository } from '../../packages/db/src';
import type { RunCommand, RunEvent, RunSession, RunWorkerLease } from '../../packages/domain/src';

const now = '2026-05-07T00:00:00.000Z';

const runSession = (status: RunSession['status']): RunSession => ({
  id: `run-session-${status}`,
  execution_package_id: 'execution-package-1',
  requested_by_actor_id: 'actor-owner',
  status,
  changed_files: [],
  check_results: [],
  artifacts: [],
  log_refs: [],
  runtime_metadata: {
    durability_mode: 'durable',
    recovery_attempt_count: 0,
    effective_dangerous_mode: 'confirmed',
  },
  created_at: now,
  updated_at: now,
});

describe('run runtime repository', () => {
  it('assigns monotonic event sequences and supports cursor backfill', async () => {
    const repo = new InMemoryP0Repository();
    await repo.saveRunSession(runSession('running'));

    const first = await repo.appendRunEvent({
      id: 'run-event-1',
      run_session_id: 'run-session-running',
      event_type: 'driver_started',
      source: 'worker',
      visibility: 'public',
      summary: 'Driver started.',
      payload: {},
      created_at: now,
    } satisfies Omit<RunEvent, 'sequence' | 'cursor'>);
    const second = await repo.appendRunEvent({
      id: 'run-event-2',
      run_session_id: 'run-session-running',
      event_type: 'agent_message_delta',
      source: 'codex',
      visibility: 'public',
      summary: 'Codex output.',
      payload: { text: 'hi' },
      created_at: now,
    } satisfies Omit<RunEvent, 'sequence' | 'cursor'>);

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect((await repo.listRunEvents('run-session-running', { after: first.cursor })).map((event) => event.id)).toEqual([
      'run-event-2',
    ]);
  });

  it('allocates unique event sequences under concurrent append pressure', async () => {
    const repo = new InMemoryP0Repository();
    await repo.saveRunSession(runSession('running'));

    const events = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        repo.appendRunEvent({
          id: `run-event-${index}`,
          run_session_id: 'run-session-running',
          event_type: 'agent_message_delta',
          source: 'codex',
          visibility: 'public',
          summary: `Codex output ${index}.`,
          payload: { index },
          created_at: now,
        }),
      ),
    );

    expect(new Set(events.map((event) => event.sequence)).size).toBe(10);
    expect((await repo.listRunEvents('run-session-running')).map((event) => event.sequence)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it('claims pending commands idempotently and can reclaim stale claims after worker crash', async () => {
    const repo = new InMemoryP0Repository();
    await repo.saveRunSession(runSession('running'));
    await repo.claimRunWorkerLease({
      run_session_id: 'run-session-running',
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now,
      expires_at: '2026-05-07T00:00:01.000Z',
    });
    const command: RunCommand = {
      id: 'run-command-1',
      run_session_id: 'run-session-running',
      command_type: 'input',
      status: 'pending',
      actor_id: 'actor-owner',
      payload: { message: 'continue' },
      created_at: now,
    };
    await repo.saveRunCommand(command);

    expect((await repo.claimNextRunCommand('run-session-running', 'worker-1', 'lease-token-1', now))?.command.id).toBe(
      'run-command-1',
    );
    expect(await repo.claimNextRunCommand('run-session-running', 'worker-1', 'lease-token-1', now)).toBeUndefined();

    await repo.claimRunWorkerLease({
      run_session_id: 'run-session-running',
      worker_id: 'worker-2',
      lease_token: 'lease-token-2',
      now: '2026-05-07T00:10:00.000Z',
      expires_at: '2026-05-07T00:15:00.000Z',
    });

    const reclaimed = await repo.claimNextRunCommand(
      'run-session-running',
      'worker-2',
      'lease-token-2',
      '2026-05-07T00:10:00.000Z',
      {
        reclaim_claimed_before: '2026-05-07T00:05:00.000Z',
      },
    );
    expect(reclaimed).toMatchObject({
      reclaimed: true,
      command: { id: 'run-command-1', claimed_by_worker_id: 'worker-2' },
    });

    await repo.markRunCommandApplied(
      'run-command-1',
      { workerId: 'worker-2', leaseToken: 'lease-token-2' },
      '2026-05-07T00:10:01.000Z',
      { driver_ack_id: 'ack-1' },
    );
    expect(
      await repo.claimNextRunCommand('run-session-running', 'worker-2', 'lease-token-2', '2026-05-07T00:10:02.000Z'),
    ).toBeUndefined();
  });

  it('prioritizes cancel commands over older pending input commands', async () => {
    const repo = new InMemoryP0Repository();
    await repo.saveRunSession(runSession('running'));
    await repo.claimRunWorkerLease({
      run_session_id: 'run-session-running',
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now,
      expires_at: '2026-05-07T00:05:00.000Z',
    });
    await repo.saveRunCommand({
      id: 'run-command-input',
      run_session_id: 'run-session-running',
      command_type: 'input',
      status: 'pending',
      actor_id: 'actor-owner',
      payload: { message: 'continue' },
      created_at: '2026-05-07T00:00:00.000Z',
    });
    await repo.saveRunCommand({
      id: 'run-command-cancel',
      run_session_id: 'run-session-running',
      command_type: 'cancel',
      status: 'pending',
      actor_id: 'actor-owner',
      payload: { reason: 'stop' },
      created_at: '2026-05-07T00:00:10.000Z',
    });

    expect((await repo.claimNextRunCommand('run-session-running', 'worker-1', 'lease-token-1', now))?.command.id).toBe(
      'run-command-cancel',
    );
  });

  it('does not let concurrent claim attempts take the same command twice', async () => {
    const repo = new InMemoryP0Repository();
    await repo.saveRunSession(runSession('running'));
    await repo.claimRunWorkerLease({
      run_session_id: 'run-session-running',
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now,
      expires_at: '2026-05-07T00:05:00.000Z',
    });
    await repo.saveRunCommand({
      id: 'run-command-1',
      run_session_id: 'run-session-running',
      command_type: 'input',
      status: 'pending',
      actor_id: 'actor-owner',
      payload: { message: 'continue' },
      created_at: now,
    });

    const claims = await Promise.all(
      Array.from({ length: 3 }, () => repo.claimNextRunCommand('run-session-running', 'worker-1', 'lease-token-1', now)),
    );
    const claimed = claims.filter((claim): claim is NonNullable<typeof claim> => claim !== undefined);

    expect(claimed).toHaveLength(1);
    const [claim] = claimed;
    expect(claim).toBeDefined();
    expect(claim!.command.id).toBe('run-command-1');
  });

  it('claims expired leases and lists recoverable sessions from durable state', async () => {
    const repo = new InMemoryP0Repository();
    await repo.saveRunSession(runSession('queued'));
    await repo.saveRunSession(runSession('succeeded'));

    const lease: RunWorkerLease = await repo.claimRunWorkerLease({
      run_session_id: 'run-session-queued',
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now,
      expires_at: '2026-05-07T00:05:00.000Z',
    });

    expect(lease.worker_id).toBe('worker-1');
    expect((await repo.listRecoverableRunSessions()).map((run) => run.id)).toEqual(['run-session-queued']);
  });

  it('does not let concurrent workers own the same active lease', async () => {
    const repo = new InMemoryP0Repository();
    await repo.saveRunSession(runSession('queued'));

    const claims = await Promise.allSettled(
      ['worker-1', 'worker-2', 'worker-3'].map((workerId) =>
        repo.claimRunWorkerLease({
          run_session_id: 'run-session-queued',
          worker_id: workerId,
          lease_token: `${workerId}-lease-token`,
          now,
          expires_at: '2026-05-07T00:05:00.000Z',
        }),
      ),
    );

    expect(claims.filter((claim) => claim.status === 'fulfilled')).toHaveLength(1);
    expect(await repo.getRunWorkerLease('run-session-queued')).toMatchObject({ status: 'active' });
  });

  it('rejects stale worker-owned writes after another worker takes over the lease', async () => {
    const repo = new InMemoryP0Repository();
    await repo.saveRunSession(runSession('running'));
    await repo.claimRunWorkerLease({
      run_session_id: 'run-session-running',
      worker_id: 'worker-old',
      lease_token: 'lease-token-old',
      now: '2026-05-07T00:00:00.000Z',
      expires_at: '2026-05-07T00:00:01.000Z',
    });
    await repo.claimRunWorkerLease({
      run_session_id: 'run-session-running',
      worker_id: 'worker-new',
      lease_token: 'lease-token-new',
      now: '2026-05-07T00:10:00.000Z',
      expires_at: '2026-05-07T00:15:00.000Z',
    });

    await expect(
      repo.appendWorkerRunEvent(
        {
          id: 'run-event-stale',
          run_session_id: 'run-session-running',
          event_type: 'agent_message_delta',
          source: 'codex',
          visibility: 'public',
          summary: 'Stale worker output.',
          payload: {},
          created_at: now,
        },
        { workerId: 'worker-old', leaseToken: 'lease-token-old' },
      ),
    ).rejects.toThrow(/lease/i);
  });
});
```

- [ ] **Step 2: Run repository tests to verify they fail**

Run: `pnpm test tests/db/run-runtime-repository.test.ts`

Expected: FAIL with missing repository methods.

- [ ] **Step 3: Extend Drizzle schema**

In `_shared.ts`, replace `run_session_status_values` with all statuses from Task 1.

In `run-session.ts`, add:

```ts
runtimeMetadata: jsonb('runtime_metadata').$type<RunSession['runtime_metadata']>(),
```

Create `run-event.ts` with `run_events` table fields:

- `id text primary key`
- `runSessionId text not null`
- `sequence integer not null`
- `cursor text not null`
- `eventType text not null`
- `source text not null`
- `visibility text not null`
- `summary text not null`
- `payload jsonb not null`
- `rawRef jsonb`
- `createdAt timestamp not null`

Create `run-event-counter.ts` with one row per run:

- `runSessionId text primary key`
- `nextSequence integer not null`

This table is required because both API command endpoints and the worker append events for the same run. Do not allocate sequence numbers by querying `max(sequence)` outside an atomic update.

Create `run-command.ts` with `run_commands` table fields from spec section 7.5. Use JSONB for `payload` and `driver_ack`. Add `claimedAt timestamp` even though the spec lists only `claimed_by_worker_id`; stale claimed-command recovery needs an auditable claim timestamp.

Create `run-worker-lease.ts` with `run_worker_leases` table fields from spec section 9.2.

Add `leaseToken text not null` to `run_worker_leases` even though the spec only requires lease ownership conceptually. The token is the write fence that prevents an expired worker with the same `worker_id` from appending events or finalizing after a new lease has been issued.

Export all new tables from `schema/index.ts`.

Add a durable local DB setup path so `FORGELOOP_DATABASE_URL` does not point at an unmigrated database:

- add `drizzle-kit` as a dev dependency if it is not already present
- create `packages/db/drizzle.config.ts` pointing at `packages/db/src/schema/index.ts`
- make the config read `FORGELOOP_DATABASE_URL ?? DATABASE_URL`
- add root script `"db:push": "drizzle-kit push --config packages/db/drizzle.config.ts"`

Implementation agents must run `pnpm db:push` against a local Postgres database before claiming durable runtime mode works.

- [ ] **Step 4: Extend repository interface**

In `p0-repository.ts`, add:

```ts
appendRunEvent(event: Omit<RunEvent, 'sequence' | 'cursor'>): Promise<RunEvent>;
listRunEvents(runSessionId: string, options?: { after?: string; limit?: number }): Promise<RunEvent[]>;
getLatestRunEvent(runSessionId: string): Promise<RunEvent | undefined>;
appendWorkerRunEvent(
  event: Omit<RunEvent, 'sequence' | 'cursor'>,
  lease: { workerId: string; leaseToken: string },
): Promise<RunEvent>;

saveRunCommand(command: RunCommand): Promise<void>;
claimNextRunCommand(
  runSessionId: string,
  workerId: string,
  leaseToken: string,
  now: string,
  options?: { reclaim_claimed_before?: string },
): Promise<{ command: RunCommand; reclaimed: boolean } | undefined>;
recordRunCommandDriverAck(
  commandId: string,
  lease: { workerId: string; leaseToken: string },
  driverAck: Record<string, unknown>,
  acknowledgedAt: string,
): Promise<void>;
markRunCommandApplied(
  commandId: string,
  lease: { workerId: string; leaseToken: string },
  appliedAt: string,
  driverAck: Record<string, unknown>,
): Promise<void>;
markRunCommandFailed(
  commandId: string,
  lease: { workerId: string; leaseToken: string },
  failureReason: string,
  failedAt: string,
): Promise<void>;
supersedePendingRunCommands(runSessionId: string, commandTypes: RunCommand['command_type'][], now: string): Promise<void>;

claimRunWorkerLease(input: {
  run_session_id: string;
  worker_id: string;
  lease_token: string;
  now: string;
  expires_at: string;
}): Promise<RunWorkerLease>;
heartbeatRunWorkerLease(runSessionId: string, workerId: string, leaseToken: string, heartbeatAt: string, expiresAt: string): Promise<void>;
getRunWorkerLease(runSessionId: string): Promise<RunWorkerLease | undefined>;
releaseRunWorkerLease(runSessionId: string, workerId: string, leaseToken: string, releasedAt: string): Promise<void>;
assertActiveRunWorkerLease(runSessionId: string, workerId: string, leaseToken: string, now: string): Promise<void>;
withActiveRunWorkerLease<T>(
  runSessionId: string,
  lease: { workerId: string; leaseToken: string; now: string },
  write: (repository: P0Repository) => Promise<T>,
): Promise<T>;

listRecoverableRunSessions(): Promise<RunSession[]>;
```

- [ ] **Step 5: Implement in-memory runtime repository behavior**

Add maps for run events, commands, and leases.

Implementation details:

- In-memory `appendRunEvent` calculates the next sequence as `max(sequence) + 1` for the run because Vitest calls it synchronously inside one process; the Drizzle implementation must use `run_event_counters`.
- API-originated public events may use `appendRunEvent`; worker-originated driver/watchdog/finalizer events must use `appendWorkerRunEvent` or `withActiveRunWorkerLease`.
- `cursor` is a zero-padded sequence string such as `String(sequence).padStart(10, '0')`.
- `listRunEvents` returns public and internal rows because repository is internal; public filtering happens in the API service before parsing with `publicRunEventSchema`.
- `claimNextRunCommand` claims pending `cancel` commands before pending `input` or `resume` commands.
- Within the same priority, `claimNextRunCommand` preserves `created_at` ordering.
- If no pending command exists, `claimNextRunCommand` can reclaim the oldest `claimed` command whose `claimed_at` is older than `options.reclaim_claimed_before`.
- Reclaiming a stale command updates `claimed_by_worker_id` and `claimed_at`, returns `reclaimed: true`, and does not duplicate or alter the command payload.
- `cancel` supersedes older pending `input` commands at command creation time in `P0Service.createRunCancelCommand`; worker-side cancel processing also calls `supersedePendingRunCommands` as a defensive cleanup.
- `listRecoverableRunSessions` returns `queued`, `running`, `waiting_for_input`, `stalled`, `resuming`, and `cancel_requested` sorted by `created_at`.
- `assertActiveRunWorkerLease` throws `DomainError('INVALID_TRANSITION', ...)` unless the current lease row is active, unexpired, and matches both `worker_id` and `lease_token`.
- `withActiveRunWorkerLease` checks the fence immediately before and after `write`; the Drizzle implementation must run both checks and the write callback inside one transaction after locking the lease row, so a failed final check rolls back worker-owned writes instead of merely detecting them after commit.

- [ ] **Step 6: Implement Drizzle runtime repository behavior**

Update `drizzle-p0-repository.ts`:

- Import `sql`, `inArray`, `or`, `lt`, and the new tables.
- Use transactions for every operation that allocates event sequences, claims commands, claims leases, finalizes commands, or updates worker ownership.
- For event sequence, use a transaction with an atomic counter upsert:

```sql
insert into run_event_counters (run_session_id, next_sequence)
values ($1, 2)
on conflict (run_session_id)
do update set next_sequence = run_event_counters.next_sequence + 1
returning next_sequence - 1 as allocated_sequence
```

Use `allocated_sequence` for both `sequence` and cursor. This must be the only event sequence allocation path.

- For command claim, do not use a select-then-update pair. Use one transaction with row locking or a conditional `UPDATE ... RETURNING`:
  - first verify the caller owns an active, unexpired lease matching both `worker_id` and `lease_token`; if not, return no command or throw `DomainError('INVALID_TRANSITION', ...)`
  - first claim one pending command with `SELECT id ... ORDER BY CASE WHEN command_type = 'cancel' THEN 0 ELSE 1 END, created_at FOR UPDATE SKIP LOCKED LIMIT 1` inside a CTE, then `UPDATE run_commands SET status = 'claimed', claimed_by_worker_id = $workerId, claimed_at = $now WHERE id = (SELECT id FROM candidate) RETURNING *`
  - only when the pending-command update returns no row, run the same pattern for the oldest stale `claimed` command where `claimed_at <= reclaim_claimed_before`
  - if Drizzle cannot express `FOR UPDATE SKIP LOCKED`, use `tx.execute(sql<...>)`; do not emulate it with application-side filtering
  - return `{ command, reclaimed }` from the exact row returned by the atomic update
- For lease claim, do not select the current lease and then update it. Use an atomic insert/upsert with a `WHERE` clause on the conflict update:
  - require the caller to pass a fresh random `lease_token`; `acquireLeaseForRun` is responsible for generating it before calling the repository, and tests may pass deterministic tokens
  - insert `(run_session_id, worker_id, lease_token, status = 'active', heartbeat_at, expires_at)`
  - on conflict `(run_session_id)` update only when the existing lease is `released`, `expires_at <= now`, or already owned by the same worker
  - include `RETURNING *`; if no row is returned, throw `DomainError('INVALID_TRANSITION', ...)`
  - keep the returned `lease_token` in the worker's local `runOne` context and lease row only; update `run_session.runtime_metadata.worker_id` but never serialize the token into run metadata
  - `heartbeatRunWorkerLease`, `releaseRunWorkerLease`, `appendWorkerRunEvent`, command ack/apply/fail methods, and worker finalization writes must use conditional updates scoped to the current `worker_id`, `lease_token`, and active status so another or stale worker cannot refresh, release, append, or finalize someone else's lease
  - `withActiveRunWorkerLease` must use one Drizzle transaction that locks the matching lease row with `FOR UPDATE`, performs the worker-owned writes through a transaction-scoped repository, rechecks the same lease fence, and commits only if the fence still holds
- The Drizzle implementation must pass the concurrent command-claim and concurrent lease-claim tests against local Postgres, not only the in-memory repository.

- [ ] **Step 7: Update schema tests**

In `tests/db/schema.test.ts`, assert that:

```ts
expect(run_session_status_values).toContain('waiting_for_input');
expect(run_session_status_values).toContain('stalled');
expect(run_session_status_values).toContain('cancel_requested');
```

Also import the new schema tables to ensure they compile.

- [ ] **Step 8: Run focused DB tests**

Run: `pnpm test tests/db/run-runtime-repository.test.ts tests/db/schema.test.ts tests/db/repository.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml packages/db/src packages/db/drizzle.config.ts tests/db/run-runtime-repository.test.ts tests/db/schema.test.ts tests/db/repository.test.ts
git commit -m "feat: persist long-running run runtime state"
```

## Task 3: Codex Event Normalizer and Session Driver Interfaces

**Files:**
- Create: `packages/executor/src/codex-session-driver.ts`
- Create: `packages/executor/src/codex-event-normalizer.ts`
- Create: `packages/executor/src/codex-raw-log-store.ts`
- Create: `packages/executor/src/codex-app-server-driver.ts`
- Create: `packages/executor/src/codex-exec-fallback-driver.ts`
- Modify: `packages/executor/src/index.ts`
- Test: `tests/executor/codex-event-normalizer.test.ts`
- Test: `tests/executor/codex-session-driver.test.ts`

- [ ] **Step 1: Write failing normalizer tests**

Create `tests/executor/codex-event-normalizer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeCodexAppServerNotification, normalizeCodexExecJsonLine } from '../../packages/executor/src';

describe('Codex event normalizer', () => {
  it('normalizes app-server assistant deltas and redacts secrets', () => {
    const events = normalizeCodexAppServerNotification({
      method: 'codex/event',
      params: {
        type: 'agent_message_delta',
        text: 'token=sk-test-secret',
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    });

    expect(events).toEqual([
      expect.objectContaining({
        event_type: 'agent_message_delta',
        source: 'codex',
        visibility: 'public',
        summary: 'Codex message delta',
        payload: expect.objectContaining({ text: 'token=[REDACTED]' }),
      }),
    ]);
  });

  it('normalizes exec fallback JSONL command output', () => {
    const events = normalizeCodexExecJsonLine(
      JSON.stringify({
        type: 'command_output_delta',
        command: 'pnpm test',
        text: 'PASS tests/domain',
      }),
    );

    expect(events[0]).toMatchObject({
      event_type: 'command_output_delta',
      source: 'codex',
      summary: 'Command output',
      payload: { command: 'pnpm test', text: 'PASS tests/domain' },
    });
  });

  it('truncates large payload strings before public persistence', () => {
    const [event] = normalizeCodexExecJsonLine(JSON.stringify({ type: 'agent_message_delta', text: 'x'.repeat(20_000) }));
    expect(String(event?.payload.text).length).toBeLessThanOrEqual(8_200);
  });
});
```

- [ ] **Step 2: Run normalizer tests to verify they fail**

Run: `pnpm test tests/executor/codex-event-normalizer.test.ts`

Expected: FAIL with missing normalizer exports.

- [ ] **Step 3: Define the driver interface**

Create `codex-session-driver.ts`:

```ts
import type { ExecutorFailure, RunSpec } from '@forgeloop/contracts';
import type { RunRuntimeMetadata } from '@forgeloop/domain';

export interface NormalizedRunEventDraft {
  event_type: import('@forgeloop/contracts').RunEventType;
  source: import('@forgeloop/contracts').RunEventSource;
  visibility: import('@forgeloop/contracts').RunEventVisibility;
  summary: string;
  payload: Record<string, unknown>;
  raw_ref?: Record<string, unknown>;
}

export interface CodexDriverStartInput {
  runSpec: RunSpec;
  workspacePath: string;
  runtimeMetadata?: RunRuntimeMetadata;
}

export type CodexTerminalStatus = 'succeeded' | 'failed' | 'cancelled';

export type CodexDriverStreamItem =
  | { kind: 'event'; event: NormalizedRunEventDraft; runtimeMetadata?: Partial<RunRuntimeMetadata> }
  | {
      kind: 'terminal';
      status: CodexTerminalStatus;
      summary: string;
      runtimeMetadata?: Partial<RunRuntimeMetadata>;
      failure?: ExecutorFailure;
    };

export interface CodexSessionDriver {
  readonly kind: 'app_server' | 'exec_fallback' | 'fake';
  startRun(input: CodexDriverStartInput): AsyncIterable<CodexDriverStreamItem>;
  resumeRun(input: CodexDriverStartInput): AsyncIterable<CodexDriverStreamItem>;
  sendInput(input: { message: string; runtimeMetadata: RunRuntimeMetadata; targetTurnId?: string }): Promise<Record<string, unknown>>;
  cancelRun(input: { runtimeMetadata: RunRuntimeMetadata }): Promise<Record<string, unknown>>;
}
```

If TypeScript rejects circular type imports, move `NormalizedRunEventDraft` to a contracts-adjacent file and import type-only.

- [ ] **Step 4: Implement normalizer**

Create `codex-event-normalizer.ts` with:

- `normalizeCodexAppServerNotification(input: unknown): NormalizedRunEventDraft[]`
- `normalizeCodexExecJsonLine(line: string): NormalizedRunEventDraft[]`
- `redactForPublicPayload(value: unknown): Record<string, unknown>`
- `truncateString(value: string, max = 8_192): string`

Redact obvious API key/token/password shapes before returning public payloads:

```ts
const SECRET_PATTERNS = [
  /(sk-[A-Za-z0-9_-]{8,})/g,
  /(token=)[^\\s]+/gi,
  /(password=)[^\\s]+/gi,
];
```

Keep unknown app-server notifications as `codex_warning` with a concise summary and internal raw reference.

Create `codex-raw-log-store.ts` with:

```ts
export interface CodexRawLogStore {
  appendRawNotification(input: {
    runSessionId: string;
    source: 'app_server' | 'exec_fallback';
    payload: unknown;
  }): Promise<{ raw_ref: Record<string, unknown> }>;
  finalizeLogsArtifact(runSessionId: string): Promise<ArtifactRef | undefined>;
}
```

The default implementation writes newline-delimited raw app-server notifications or fallback JSONL under the run artifact root and returns a `logs` artifact from `finalizeLogsArtifact()`. Normalized public events may carry an internal `raw_ref`, but public API responses and the first Web UI must never expose or link it.

- [ ] **Step 5: Write failing driver tests for dangerous mode and fallback args**

Create `tests/executor/codex-session-driver.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildCodexExecArgs,
  confirmAppServerDangerousMode,
  createCodexAppServerDriverForTest,
  type CodexSessionDriver,
  resolveEffectiveDangerousMode,
} from '../../packages/executor/src';

class TestAppServerTransport {
  readonly driver: CodexSessionDriver;
  readonly calls: Array<{ method: string }> = [];
  constructor(input: {
    effectiveConfig?: { approvalPolicy: string; sandbox: { type: string } };
    threadId?: string;
    activeTurnId?: string;
  }) {
    this.driver = createCodexAppServerDriverForTest(this, input);
  }
}

	describe('Codex session drivers', () => {
  it('uses dangerous bypass for exec fallback, not workspace-write sandbox', () => {
    expect(buildCodexExecArgs({ prompt: 'continue' })).toContain(
      '--dangerously-bypass-approvals-and-sandbox',
    );
    expect(buildCodexExecArgs({ prompt: 'continue' })).toContain('--json');
    expect(buildCodexExecArgs({ prompt: 'continue' })).not.toContain('--sandbox');
  });

  it('records confirmed dangerous mode from app-server effective response config', () => {
    expect(
      resolveEffectiveDangerousMode({
        approvalPolicy: 'never',
        sandbox: { type: 'dangerFullAccess' },
      }),
    ).toBe('confirmed');
  });

  it('fails preflight when app-server cannot confirm effective dangerous mode', async () => {
    await expect(
      confirmAppServerDangerousMode(
        new TestAppServerTransport({
          effectiveConfig: { approvalPolicy: 'on-request', sandbox: { type: 'workspaceWrite' } },
        }),
      ),
    ).rejects.toThrow(/dangerous mode/i);
  });

  it('steers active app-server turns and starts continuation turns when inactive', async () => {
    const active = new TestAppServerTransport({ threadId: 'thread-1', activeTurnId: 'turn-1' });
    await active.driver.sendInput({
      message: 'Use option B.',
      runtimeMetadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        codex_thread_id: 'thread-1',
        active_turn_id: 'turn-1',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'confirmed',
      },
      targetTurnId: 'turn-1',
    });
    expect(active.calls.map((call) => call.method)).toContain('turn/steer');

    const inactive = new TestAppServerTransport({ threadId: 'thread-1' });
    await inactive.driver.sendInput({
      message: 'Continue.',
      runtimeMetadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        codex_thread_id: 'thread-1',
        recovery_attempt_count: 0,
        effective_dangerous_mode: 'confirmed',
      },
    });
    expect(inactive.calls.map((call) => call.method)).toContain('turn/start');
  });

  it('uses exec resume for fallback input continuation', async () => {
    expect(buildCodexExecArgs({ prompt: 'Continue.', threadId: 'thread-1' })).toEqual([
      'exec',
      'resume',
      'thread-1',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      'Continue.',
    ]);
  });
});
```

- [ ] **Step 6: Implement app-server and exec fallback skeletons**

Before coding app-server calls, capture the current local Codex protocol types:

```bash
mkdir -p .superpowers/codex-protocol
codex app-server generate-ts --out .superpowers/codex-protocol
```

Use the generated file only as local implementation reference because `.superpowers/` is ignored. Verify the method names and payload shapes for `thread/start`, `thread/resume`, `turn/start`, `turn/steer`, and `turn/interrupt` against this generated file. If the installed Codex CLI uses different names, adapt the driver and tests to the generated protocol instead of the names listed below.

In `codex-exec-fallback-driver.ts`, export `buildCodexExecArgs`:

```ts
export const buildCodexExecArgs = (input: { prompt: string; threadId?: string }): string[] =>
  input.threadId === undefined
    ? ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', input.prompt]
    : ['exec', 'resume', input.threadId, '--json', '--dangerously-bypass-approvals-and-sandbox', input.prompt];
```

Implement the driver using a spawned `codex` child process and parse stdout line-by-line through `normalizeCodexExecJsonLine`. Do not pass a timeout for the main Codex process.

In `codex-app-server-driver.ts`, implement a minimal JSON-RPC client around:

- `thread/start`
- `thread/resume`
- `turn/start`
- `turn/steer`
- `turn/interrupt`

Also export `createCodexAppServerDriverForTest(transport, options)` or an equivalent test factory used by `tests/executor/codex-session-driver.test.ts`. It should return a `CodexSessionDriver` backed by the fake transport without starting a real app-server process.

Export `resolveEffectiveDangerousMode(config)` and require:

```ts
{ approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } }
```

When app-server startup or resume fails, emit `driver_fallback_used` and let the caller switch to `CodexExecFallbackDriver`.

Before starting a Codex turn, the app-server driver must call `confirmAppServerDangerousMode()` against the current transport/session and fail preflight if the effective response config is not `approvalPolicy: never` and `sandbox.type: 'dangerFullAccess'`. Generated `ThreadStartParams.sandbox` may accept the request string `danger-full-access`, but generated `ThreadStartResponse.sandbox` is a `SandboxPolicy` object such as `{ type: 'dangerFullAccess' }`; implement confirmation against the response shape, not only the request shape.

Input routing rules:

- if `runtimeMetadata.active_turn_id` or `targetTurnId` is present, use app-server `turn/steer`
- if the thread exists but no active turn exists, start a new app-server turn on the same thread and return an acknowledgement with `continuity: 'thread_continuation'`
- in exec fallback mode, use `codex exec resume <thread_id> --json --dangerously-bypass-approvals-and-sandbox <message>` and return `continuity: 'resume_fallback'`

All raw app-server notifications and fallback JSONL lines must be passed to `CodexRawLogStore.appendRawNotification()` before normalization. On terminal driver completion, the worker adds the `logs` artifact returned by `finalizeLogsArtifact()` to `ExecutorResult.artifacts`; the finalizer then separates `kind: 'logs'` into `RunSession.log_refs` using the existing workflow convention. Public events and public API serializers continue to omit `raw_ref` and raw log refs.

- [ ] **Step 7: Run focused executor tests**

Run: `pnpm test tests/executor/codex-event-normalizer.test.ts tests/executor/codex-session-driver.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/executor/src tests/executor/codex-event-normalizer.test.ts tests/executor/codex-session-driver.test.ts
git commit -m "feat: add codex session driver boundary"
```

## Task 4: Persistent Worktree and Source Repo Mutation Guard

**Files:**
- Create: `packages/executor/src/codex-worktree.ts`
- Create: `packages/executor/src/source-repo-guard.ts`
- Create: `packages/executor/src/local-codex-evidence.ts`
- Modify: `packages/executor/src/local-codex-preflight.ts`
- Modify: `packages/executor/src/local-codex-executor.ts`
- Modify: `packages/executor/src/index.ts`
- Test: `tests/executor/codex-worktree.test.ts`
- Test: `tests/executor/local-codex-preflight.test.ts`

- [ ] **Step 1: Write failing worktree tests**

Create `tests/executor/codex-worktree.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { worktreePathForRun, sourceRepoWasMutated } from '../../packages/executor/src';

describe('Codex worktree boundary', () => {
  it('uses .worktrees/<run-session-id> under the source repo parent by default', () => {
    expect(worktreePathForRun('/Users/viv/projs/forgeloop', 'run-session-1')).toBe(
      '/Users/viv/projs/forgeloop/.worktrees/run-session-1',
    );
  });

  it('detects source repo status changes outside the run worktree', () => {
    expect(
      sourceRepoWasMutated({
        beforePorcelain: '',
        afterPorcelain: ' M packages/domain/src/types.ts\\n',
      }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run worktree tests to verify they fail**

Run: `pnpm test tests/executor/codex-worktree.test.ts`

Expected: FAIL with missing exports.

- [ ] **Step 3: Implement worktree helpers**

Create `codex-worktree.ts`:

- `worktreePathForRun(repoPath, runSessionId, workspaceRoot?)`
- `preparePersistentGitWorktree(environment, { repoPath, baseRef, runSessionId })`
- `cleanupExistingWorktreeForRun(environment, { repoPath, runSessionId, workspacePath })` for idempotent reruns only when the directory is already registered for the same run.

Use Git worktree commands:

```text
git worktree add --detach <workspacePath> <baseRef>
```

Never use random temp directories for non-mock local Codex runs.

- [ ] **Step 4: Implement source repo guard**

Create `source-repo-guard.ts`:

- `snapshotSourceRepoStatus(environment, repoPath): Promise<SourceRepoSnapshot>`
- `verifySourceRepoUnchanged(environment, snapshot): Promise<SourceRepoGuardResult>`
- `sourceRepoWasMutated({ beforePorcelain, afterPorcelain }): boolean`

The snapshot uses `git status --porcelain --untracked-files=all` in the source repo, not the run worktree.

- [ ] **Step 5: Extract local evidence capture**

Create `local-codex-evidence.ts` by moving diff, changed-file, required-check, artifact, and path-violation helpers out of `local-codex-executor.ts`.

Export:

```ts
export interface LocalCodexEvidenceInput {
  runSpec: RunSpec;
  workspacePath: string;
  baseRef: string;
  artifactRoot: string;
  summary: string;
  startedAt: string;
  environment: LocalCodexEnvironment;
  checkEnv: NodeJS.ProcessEnv;
  sourceRepoSnapshot: SourceRepoSnapshot;
  effectiveDangerousMode: 'confirmed' | 'unconfirmed' | 'not_requested';
}

export type CaptureLocalCodexEvidence = (input: LocalCodexEvidenceInput) => Promise<ExecutorResult>;
```

Implement and export `captureLocalCodexEvidence` with the `CaptureLocalCodexEvidence` signature above by moving the existing local-codex evidence implementation here. Do not leave a stub. `captureLocalCodexEvidence` is the only place that runs required checks, captures diffs/artifacts, validates allowed/forbidden paths, and checks source repo mutation after Codex terminal state.

- [ ] **Step 6: Refactor local preflight to use persistent worktree and dangerous mode**

In `local-codex-preflight.ts`:

- Replace `mkdtemp` clone behavior with the new worktree helper.
- Make `workspaceRoot` default to `.worktrees` under `runSpec.repo.local_path`.
- Remove main-run timeout from `runCodex`; keep timeout support only on required checks.
- Replace current args:

```text
codex exec --sandbox workspace-write --skip-git-repo-check <prompt>
```

with:

```text
codex exec --json --dangerously-bypass-approvals-and-sandbox <prompt>
```

or route through `CodexExecFallbackDriver`.

- [ ] **Step 7: Refactor local executor metadata and mutation failure**

In `local-codex-executor.ts`:

- Keep `runLocalCodexExecutor()` as the synchronous compatibility wrapper for existing tests.
- Make the compatibility wrapper call the driver/preflight path and then `captureLocalCodexEvidence()`.
- Record `workspace_path`, `base_ref`, `source_repo_before_status`, `source_repo_after_status`, and `effective_dangerous_mode` in `raw_metadata`.
- After Codex and required checks finish, verify the source repo snapshot. If mutated, return failed `ExecutorResult`:

```ts
failure: {
  kind: 'path_violation',
  message: 'Source repo changed outside the run worktree.',
  retryable: false,
}
```

- [ ] **Step 8: Add `.gitignore` regression assertion**

Add to `tests/executor/codex-worktree.test.ts`:

```ts
import { readFileSync } from 'node:fs';

it('keeps local worktree and superpowers directories ignored', () => {
  const gitignore = readFileSync('.gitignore', 'utf8');
  expect(gitignore).toContain('.worktrees/');
  expect(gitignore).toContain('.superpowers/');
});
```

- [ ] **Step 9: Run focused executor tests**

Run: `pnpm test tests/executor/codex-worktree.test.ts tests/executor/local-codex-preflight.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add .gitignore packages/executor/src tests/executor/codex-worktree.test.ts tests/executor/local-codex-preflight.test.ts
git commit -m "feat: run local codex from persistent worktrees"
```

## Task 5: Idempotent Execution Finalizer

**Files:**
- Create: `tests/helpers/p0-runtime-fixtures.ts`
- Create: `packages/workflow/src/execution-finalizer.ts`
- Modify: `packages/workflow/src/activities.ts`
- Modify: `packages/workflow/src/index.ts`
- Test: `tests/workflow/execution-finalizer.test.ts`
- Test: `tests/workflow/package-execution-workflow.test.ts`

- [ ] **Step 1: Create shared P0 runtime test fixtures**

Create `tests/helpers/p0-runtime-fixtures.ts` by extracting concrete seed builders from `tests/workflow/package-execution-workflow.test.ts` and API helper setup from `tests/api/delivery-flow.test.ts`.

It must export implemented functions with these names because later snippets import them directly:

- `succeededSelfReview(): SelfReviewResult`
- `succeededExecutorResult(runSessionId: string): ExecutorResult`
- `seedReadyStartedPackageRun(repository: P0Repository): Promise<{ executionPackage: ExecutionPackage; runSession: RunSession }>`
- `seedQueuedPackageRun(repository: P0Repository): Promise<{ executionPackage: ExecutionPackage; runSession: RunSession }>`
- `seedRunningRunWithCommand(repository: P0Repository, command: Partial<RunCommand>): Promise<{ runSession: RunSession; command: RunCommand }>`
- `monotonicTestClock(startIso: string, incrementMs?: number): () => string`
- `seedReadyExecutionPackageThroughApi(app: INestApplication): Promise<ExecutionPackage>`
- `seedAppWithRunSession(options?: { durabilityMode?: 'durable' | 'volatile_demo'; allowDemoActorIdFallback?: boolean }): Promise<{ app: INestApplication; repo: InMemoryP0Repository; runSessionId: string }>`

Do not leave these as stubs. The helper file must compile before any test using it is added. If a fixture needs many records, prefer reusing the existing API creation helpers from `tests/api/delivery-flow.test.ts` rather than inventing divergent test data.

- [ ] **Step 2: Write failing finalizer tests**

Create `tests/workflow/execution-finalizer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { InMemoryP0Repository } from '../../packages/db/src';
import { finalizePackageRunWithExecutorResult } from '../../packages/workflow/src';
import {
  seedReadyStartedPackageRun,
  succeededExecutorResult,
  succeededSelfReview,
} from '../helpers/p0-runtime-fixtures';

describe('execution finalizer', () => {
  it('is idempotent when retrying a succeeded executor result after partial persistence', async () => {
    const repo = new InMemoryP0Repository();
    const context = await seedReadyStartedPackageRun(repo);
    const result = succeededExecutorResult(context.runSession.id);

    const first = await finalizePackageRunWithExecutorResult({
      repository: repo,
      runSessionId: context.runSession.id,
      executorResult: result,
      selfReview: async () => succeededSelfReview(),
      now: () => '2026-05-07T00:00:00.000Z',
    });
    const second = await finalizePackageRunWithExecutorResult({
      repository: repo,
      runSessionId: context.runSession.id,
      executorResult: result,
      selfReview: async () => succeededSelfReview(),
      now: () => '2026-05-07T00:00:01.000Z',
    });

    expect(second).toEqual(first);
    expect(await repo.listReviewPacketsForPackage(context.executionPackage.id)).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run finalizer tests to verify they fail**

Run: `pnpm test tests/workflow/execution-finalizer.test.ts`

Expected: FAIL with missing `finalizePackageRunWithExecutorResult`.

- [ ] **Step 4: Extract finalizer helpers from `activities.ts`**

Move or wrap existing private logic so these public helpers exist:

```ts
export interface BuildPackageRunSpecInput {
  repository: PackageExecutionRepository;
  runSessionId: string;
  defaultExecutorType?: ExecutorType;
  workflowOnly?: boolean;
  now?: () => string;
  forceRerun?: boolean;
}

export interface StartPackageRunResult {
  runSession: RunSession;
  executionPackage: ExecutionPackage;
  runSpec: RunSpec;
}

export type BuildAndStartPackageRun = (input: BuildPackageRunSpecInput) => Promise<StartPackageRunResult>;

export type FinalizePackageRunWithExecutorResult = (input: {
  repository: PackageExecutionRepository;
  runSessionId: string;
  executorResult: ExecutorResult;
  selfReview: PackageRunSelfReview;
  workerLease?: { workerId: string; leaseToken: string };
  now?: () => string;
}) => Promise<ExecutePackageRunResult>;
```

Before adding these helpers, update workflow-local types so they line up with the domain model from Task 1:

- delete the private narrow `RunSessionStatus` union in `activities.ts` or replace it with `import type { RunSessionStatus } from '@forgeloop/domain'`
- keep using the existing exported `PackageRunSelfReview`; do not introduce a second self-review adapter type
- widen `PackageExecutionRepository` so it includes the Task 2 runtime fence method `withActiveRunWorkerLease`; otherwise the finalizer cannot type-check when called by `RunWorker`
- if `workerLease` is provided, all terminal run-session, artifact, review-packet, and status-history writes inside `finalizePackageRunWithExecutorResult` must run through `repository.withActiveRunWorkerLease(...)`
- the compatibility `executePackageRun()` wrapper may omit `workerLease` because it is only the old synchronous path during refactor; `RunWorker` must always pass it
- implement and export runtime values named `buildAndStartPackageRun` and `finalizePackageRunWithExecutorResult` with the type aliases above by moving existing `executePackageRun` logic; do not leave declaration-only exports or throwing stubs

Keep `executePackageRun()` as a compatibility wrapper:

```ts
const started = await buildAndStartPackageRun(input);
const executorResult = await runExecutorAndNormalize(input.executor, started.runSpec, started.runSession);
return finalizePackageRunWithExecutorResult({
  repository: input.repository,
  runSessionId: started.runSession.id,
  executorResult,
  selfReview: input.selfReview,
  ...(input.now === undefined ? {} : { now: input.now }),
});
```

- [ ] **Step 5: Make finalizer idempotent**

Rules:

- If the run is already terminal and has a matching `executor_result`, return the already persisted result.
- If a Review Packet already exists for a succeeded run, return its id instead of creating a duplicate.
- If the run failed, do not create a Review Packet.
- Do not mark success until terminal Codex completion plus evidence capture has produced a valid `ExecutorResult`.

- [ ] **Step 6: Run workflow tests**

Run: `pnpm test tests/workflow/execution-finalizer.test.ts tests/workflow/package-execution-workflow.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/workflow/src tests/helpers/p0-runtime-fixtures.ts tests/workflow/execution-finalizer.test.ts tests/workflow/package-execution-workflow.test.ts
git commit -m "refactor: extract idempotent package run finalizer"
```

## Task 6: Run Worker Package

**Files:**
- Create: `packages/run-worker/package.json`
- Create: `packages/run-worker/tsconfig.json`
- Create: `packages/run-worker/src/index.ts`
- Create: `packages/run-worker/src/lease.ts`
- Create: `packages/run-worker/src/command-inbox.ts`
- Create: `packages/run-worker/src/watchdog.ts`
- Create: `packages/run-worker/src/run-dispatcher.ts`
- Create: `packages/run-worker/src/run-worker.ts`
- Create: `packages/run-worker/src/fake-codex-session-driver.ts`
- Modify: `tsconfig.base.json`
- Test: `tests/run-worker/command-inbox.test.ts`
- Test: `tests/run-worker/watchdog.test.ts`
- Test: `tests/run-worker/run-worker.test.ts`

- [ ] **Step 1: Create package manifest**

Create `packages/run-worker/package.json`:

```json
{
  "name": "@forgeloop/run-worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "build": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@forgeloop/contracts": "workspace:*",
    "@forgeloop/db": "workspace:*",
    "@forgeloop/domain": "workspace:*",
    "@forgeloop/executor": "workspace:*",
    "@forgeloop/workflow": "workspace:*"
  }
}
```

Create `tsconfig.json` following the other package configs. Also update workspace wiring:

- `pnpm-workspace.yaml` already includes `packages/*`, so `packages/run-worker` is automatically included.
- Add `@forgeloop/run-worker` to `tsconfig.base.json` paths if the repo still uses explicit package path aliases.
- Add `@forgeloop/run-worker: workspace:*` to `apps/control-plane-api/package.json` when the API imports the worker package in Task 7.

- [ ] **Step 2: Write failing command inbox tests**

Create `tests/run-worker/command-inbox.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { InMemoryP0Repository } from '../../packages/db/src';
import { applyPendingRunCommands, FakeCodexSessionDriver } from '../../packages/run-worker/src';
import { seedRunningRunWithCommand } from '../helpers/p0-runtime-fixtures';

describe('run command inbox', () => {
  it('applies pending input exactly once to the active turn', async () => {
    const repo = new InMemoryP0Repository();
    await seedRunningRunWithCommand(repo, {
      command_type: 'input',
      payload: { message: 'Use the simpler migration path.' },
      target_turn_id: 'turn-1',
    });
    await repo.claimRunWorkerLease({
      run_session_id: 'run-session-1',
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now: '2026-05-07T00:00:00.000Z',
      expires_at: '2026-05-07T00:05:00.000Z',
    });
    const driver = new FakeCodexSessionDriver();

    await applyPendingRunCommands({
      repository: repo,
      runSessionId: 'run-session-1',
      workerId: 'worker-1',
      leaseToken: 'lease-token-1',
      driver,
      now: () => '2026-05-07T00:00:00.000Z',
    });
    await applyPendingRunCommands({
      repository: repo,
      runSessionId: 'run-session-1',
      workerId: 'worker-1',
      leaseToken: 'lease-token-1',
      driver,
      now: () => '2026-05-07T00:00:01.000Z',
    });

    expect(driver.inputs).toEqual(['Use the simpler migration path.']);
    expect((await repo.listRunEvents('run-session-1')).map((event) => event.payload)).toContainEqual(
      expect.objectContaining({ continuity: 'active_turn' }),
    );
  });

  it('emits a public delivery event with fallback continuity after driver acknowledgement', async () => {
    const repo = new InMemoryP0Repository();
    await seedRunningRunWithCommand(repo, {
      command_type: 'input',
      payload: { message: 'Continue.' },
    });
    await repo.claimRunWorkerLease({
      run_session_id: 'run-session-1',
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now: '2026-05-07T00:00:00.000Z',
      expires_at: '2026-05-07T00:05:00.000Z',
    });
    const driver = new FakeCodexSessionDriver({ inputAck: { continuity: 'resume_fallback' } });

    await applyPendingRunCommands({
      repository: repo,
      runSessionId: 'run-session-1',
      workerId: 'worker-1',
      leaseToken: 'lease-token-1',
      driver,
      now: () => '2026-05-07T00:00:00.000Z',
    });

    expect((await repo.listRunEvents('run-session-1')).map((event) => event.payload)).toContainEqual(
      expect.objectContaining({ continuity: 'resume_fallback' }),
    );
  });

  it('does not re-send a stale claimed input with unknown delivery state', async () => {
    const repo = new InMemoryP0Repository();
    await seedRunningRunWithCommand(repo, {
      command_type: 'input',
      status: 'claimed',
      claimed_by_worker_id: 'worker-crashed',
      claimed_at: '2026-05-07T00:00:00.000Z',
      payload: { message: 'Continue.' },
    });
    await repo.claimRunWorkerLease({
      run_session_id: 'run-session-1',
      worker_id: 'worker-crashed',
      lease_token: 'lease-token-crashed',
      now: '2026-05-07T00:00:00.000Z',
      expires_at: '2026-05-07T00:00:01.000Z',
    });
    await repo.claimRunWorkerLease({
      run_session_id: 'run-session-1',
      worker_id: 'worker-2',
      lease_token: 'lease-token-2',
      now: '2026-05-07T00:10:00.000Z',
      expires_at: '2026-05-07T00:15:00.000Z',
    });
    const driver = new FakeCodexSessionDriver();

    await applyPendingRunCommands({
      repository: repo,
      runSessionId: 'run-session-1',
      workerId: 'worker-2',
      leaseToken: 'lease-token-2',
      driver,
      reclaimClaimedBefore: '2026-05-07T00:05:00.000Z',
      now: () => '2026-05-07T00:10:00.000Z',
    });

    expect(driver.inputs).toEqual([]);
    expect((await repo.listRunEvents('run-session-1')).map((event) => event.event_type)).toContain('codex_warning');
  });
});
```

- [ ] **Step 3: Write failing worker tests**

Create `tests/run-worker/run-worker.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { InMemoryP0Repository } from '../../packages/db/src';
import { RunWorker, FakeCodexSessionDriver } from '../../packages/run-worker/src';
import {
  monotonicTestClock,
  seedQueuedPackageRun,
  succeededExecutorResult,
  succeededSelfReview,
} from '../helpers/p0-runtime-fixtures';

describe('run worker', () => {
  it('discovers queued runs, emits live events, and finalizes only after terminal driver completion', async () => {
    const repo = new InMemoryP0Repository();
    const seeded = await seedQueuedPackageRun(repo);
    const driver = new FakeCodexSessionDriver({
      events: [
        { event_type: 'driver_started', source: 'worker', visibility: 'public', summary: 'Driver started.', payload: {} },
        { event_type: 'agent_message_delta', source: 'codex', visibility: 'public', summary: 'Codex output.', payload: { text: 'working' } },
      ],
      terminal: { status: 'succeeded', summary: 'Codex completed.' },
    });

    const worker = new RunWorker({
      repository: repo,
      workerId: 'worker-1',
      driverFactory: () => driver,
      evidenceCollector: async () => succeededExecutorResult(seeded.runSession.id),
      selfReview: async () => succeededSelfReview(),
      now: () => '2026-05-07T00:00:00.000Z',
    });

    await worker.drainOnce();

    expect((await repo.listRunEvents(seeded.runSession.id)).map((event) => event.event_type)).toContain(
      'agent_message_delta',
    );
    expect((await repo.getRunSession(seeded.runSession.id))?.status).toBe('succeeded');
  });

  it('moves idle active runs to stalled instead of timed_out', async () => {
    const repo = new InMemoryP0Repository();
    const seeded = await seedQueuedPackageRun(repo);
    const driver = new FakeCodexSessionDriver({ neverCompletesUntilWatchdog: true });
    const worker = new RunWorker({
      repository: repo,
      workerId: 'worker-1',
      driverFactory: () => driver,
      evidenceCollector: async () => succeededExecutorResult(seeded.runSession.id),
      selfReview: async () => succeededSelfReview(),
      idleThresholdMs: 1,
      now: monotonicTestClock('2026-05-07T00:00:00.000Z', 10),
    });

    await worker.drainOnce();

    expect((await repo.getRunSession(seeded.runSession.id))?.status).toBe('stalled');
  });

  it('heartbeats the lease during long driver execution and releases it on terminal completion', async () => {
    const repo = new InMemoryP0Repository();
    const seeded = await seedQueuedPackageRun(repo);
    const driver = new FakeCodexSessionDriver({
      events: [
        { event_type: 'driver_started', source: 'worker', visibility: 'public', summary: 'Driver started.', payload: {} },
        { event_type: 'watchdog_heartbeat', source: 'watchdog', visibility: 'internal', summary: 'Heartbeat.', payload: {} },
        { event_type: 'agent_message_delta', source: 'codex', visibility: 'public', summary: 'Still working.', payload: {} },
      ],
      terminal: { status: 'succeeded', summary: 'Codex completed.' },
    });
    const worker = new RunWorker({
      repository: repo,
      workerId: 'worker-1',
      driverFactory: () => driver,
      evidenceCollector: async () => succeededExecutorResult(seeded.runSession.id),
      selfReview: async () => succeededSelfReview(),
      leaseDurationMs: 5_000,
      heartbeatIntervalMs: 1_000,
      now: monotonicTestClock('2026-05-07T00:00:00.000Z'),
    });

    await worker.drainOnce();

    expect(await repo.getRunWorkerLease(seeded.runSession.id)).toMatchObject({ status: 'released' });
    expect((await repo.listRunEvents(seeded.runSession.id)).map((event) => event.event_type)).toContain(
      'watchdog_heartbeat',
    );
  });

  it('reclaims an expired running lease before recovery', async () => {
    const repo = new InMemoryP0Repository();
    const seeded = await seedQueuedPackageRun(repo);
    await repo.claimRunWorkerLease({
      run_session_id: seeded.runSession.id,
      worker_id: 'worker-old',
      lease_token: 'lease-token-old',
      now: '2026-05-07T00:00:00.000Z',
      expires_at: '2026-05-07T00:00:01.000Z',
    });

    const worker = new RunWorker({
      repository: repo,
      workerId: 'worker-new',
      driverFactory: () =>
        new FakeCodexSessionDriver({
          events: [{ event_type: 'driver_started', source: 'worker', visibility: 'public', summary: 'Recovered.', payload: {} }],
          terminal: { status: 'succeeded', summary: 'Recovered run completed.' },
        }),
      evidenceCollector: async () => succeededExecutorResult(seeded.runSession.id),
      selfReview: async () => succeededSelfReview(),
      now: () => '2026-05-07T00:10:00.000Z',
    });

    await worker.drainOnce();

    expect(await repo.getRunWorkerLease(seeded.runSession.id)).toMatchObject({ worker_id: 'worker-new' });
  });
});
```

- [ ] **Step 4: Run worker tests to verify they fail**

Run: `pnpm test tests/run-worker`

Expected: FAIL with missing package exports.

- [ ] **Step 5: Implement lease helpers**

In `lease.ts`, add:

- `acquireLeaseForRun(repository, runSessionId, workerId, now, leaseDurationMs): Promise<{ lease: RunWorkerLease; leaseToken: string }>`
- `heartbeatLease(repository, runSessionId, workerId, leaseToken, now, leaseDurationMs)`
- `releaseLease(repository, runSessionId, workerId, leaseToken, now)`
- `assertLeaseStillOwned(repository, runSessionId, workerId, leaseToken, now)`

`acquireLeaseForRun` generates a fresh `leaseToken` and returns `{ lease, leaseToken }`. `heartbeatLease`, `releaseLease`, and `assertLeaseStillOwned` must take that `leaseToken`; `assertLeaseStillOwned` also takes `now` so expiry checks are deterministic. Do not identify ownership by `workerId` alone.

Append `worker_lease_acquired` and `watchdog_heartbeat` events through the worker using `appendWorkerRunEvent`, not directly inside repository methods.

- [ ] **Step 6: Implement command inbox**

In `command-inbox.ts`, export `applyPendingRunCommands(input)`.

Rules:

- Load one available command at a time through `claimNextRunCommand`.
- Require `workerId` and `leaseToken`; every claim, driver acknowledgement, applied update, failed update, and worker-originated event append must be fenced by that active lease.
- Pass `reclaim_claimed_before` when the current worker acquired a lease after another worker lease expired, so a crash between claim and apply does not strand acknowledged user input forever.
- `input` calls `driver.sendInput({ message, runtimeMetadata, ...(targetTurnId === undefined ? {} : { targetTurnId }) })`.
- `cancel` calls `driver.cancelRun(...)` and supersedes older pending input. Do not apply `cancel_requested` again when the API already moved the run to `cancel_requested`; only apply it defensively if the command was inserted by an older caller and the run is still cancellable.
- `resume` asks the worker loop to recover/resume the driver. Do not apply `resume_requested` again when the API already moved the run to `resuming`; only apply it defensively if the command was inserted by an older caller and the run is still `waiting_for_input` or `stalled`.
- For a freshly claimed `pending` command, send to the driver, then call `recordRunCommandDriverAck(commandId, { workerId, leaseToken }, ack, at)`, then mark command `applied` with the same lease fence.
- After driver acknowledgement, append a public `user_input` or `turn_status_changed` event containing sanitized `continuity` from the acknowledgement. This is the reliable event source the Web UI uses to label fallback or thread-continuation behavior.
- If a reclaimed command already has `driver_ack`, skip re-sending it and mark it `applied`; this prevents duplicate injection after a crash that happened after driver ack but before status persistence.
- If a reclaimed command has no `driver_ack`, do not re-send automatically. Mark it `failed` with `failure_reason: 'delivery_unknown_after_worker_crash'` and append a `codex_warning` event so the UI can ask the operator to resend if needed. This avoids injecting the same input twice when the previous worker may have sent it before crashing.
- Mark command `failed` with a reason if the driver rejects it.

- [ ] **Step 7: Implement watchdog semantics**

In `watchdog.ts`, export:

```ts
export function evaluateRunProgress(input: {
  status: RunSessionStatus;
  lastCodexActivityAt?: string;
  lastWorkerHeartbeatAt?: string;
  now: string;
  idleThresholdMs: number;
}): 'active' | 'waiting' | 'stalled' {
  // Implement using the rules below.
}
```

Heartbeats prove liveness, not user-visible Codex progress. If worker heartbeat is fresh but Codex activity is older than threshold, return `stalled` unless status is `waiting_for_input`.

- [ ] **Step 8: Implement `RunWorker`**

In `run-worker.ts`, implement:

- `drainOnce()`:
  - calls `repository.listRecoverableRunSessions()`
  - claims a lease for each run it can own and receives `{ leaseToken }`
  - calls `runOne({ runSessionId, workerId, leaseToken })`
- `kick()`:
  - schedules a non-blocking `drainOnce()` soon, guarded so overlapping kicks do not run concurrent drains in the same process
  - returns `void`
- `runOne({ runSessionId, workerId, leaseToken })`:
  - loads runtime metadata and pending commands
  - calls `buildAndStartPackageRun` for queued runs
  - prepares the worktree for non-mock local Codex runs
  - starts a heartbeat loop before awaiting long driver execution
  - starts a command polling loop before awaiting long driver execution; the loop calls `applyPendingRunCommands()` every 500-1000ms while the driver is active
  - forwards active-turn input through `driver.sendInput()` so app-server `turn/steer` can reach the current turn during multi-hour execution
  - fails or stalls the run if `assertLeaseStillOwned(repository, runSessionId, workerId, leaseToken, now())` shows another worker took over
  - starts or resumes the selected driver
  - appends every normalized `kind: 'event'` stream item through `repository.appendWorkerRunEvent(..., { workerId, leaseToken })`
  - updates `runtime_metadata.last_event_cursor` and `last_event_at`
  - handles `waiting_for_input`, `stalled`, `cancel_requested`, and `kind: 'terminal'` stream items
  - calls the injected `evidenceCollector` after a terminal `succeeded` driver outcome
  - for terminal `failed` or `cancelled` driver outcomes, captures available diff/log artifacts if safe, skips required checks and Review Packet creation, and creates a failed or cancelled `ExecutorResult`
  - calls `finalizePackageRunWithExecutorResult({ ..., workerLease: { workerId, leaseToken } })` only after a valid terminal `ExecutorResult`
  - stops command polling and heartbeat loops and releases the lease after terminal completion or unrecoverable failure

The worker must not use an in-memory queue as the dispatch source. `run-dispatcher.ts` can expose `kick()` as an optimization, but `drainOnce()` must always read durable state.

For a non-terminal run takeover, implement the spec recovery order exactly:

1. Reconnect to the existing app-server session and active thread/turn when `runtime_metadata.driver_kind === 'app_server'` and a thread or active turn id is present.
2. If the active turn cannot be reattached, call app-server `thread/resume` for the recorded thread.
3. Load and apply pending commands in durable command order for the recovered thread/turn state. `cancel` may supersede older pending input; `resume` must not clear pending input unless the worker applies or explicitly fails those input commands.
4. If app-server recovery is not usable, switch to `codex exec resume <thread_id> --json --dangerously-bypass-approvals-and-sandbox`.
5. If app-server and exec fallback resume both fail, transition to `stalled`, append a public `stalled` event with a clear operator-facing reason, and keep the run recoverable.

Add a worker test that seeds a non-terminal app-server run with `codex_thread_id`, `active_turn_id`, pending input, and an expired lease, then verifies the new worker reattaches/resumes before applying the command. Add a second test where app-server recovery and exec fallback both fail and the run becomes `stalled` rather than `succeeded` or `failed`.

`RunWorker` constructor input must include:

```ts
evidenceCollector: (input: LocalCodexEvidenceInput) => Promise<ExecutorResult>;
```

The production collector calls `captureLocalCodexEvidence()` for `local_codex` runs and a mock collector for `workflow_only` runs. `RunWorker` is responsible for passing the complete `LocalCodexEvidenceInput`, including `artifactRoot`, `environment`, `checkEnv`, `sourceRepoSnapshot`, and `effectiveDangerousMode`; do not narrow this to only `runSpec`, `workspacePath`, and summary fields.

`kick()` is an instance method implemented by `RunWorker`, not a constructor dependency. Tests should instantiate `new RunWorker(...)` without passing `kick`.

- [ ] **Step 9: Implement fake driver**

`FakeCodexSessionDriver` should support:

- scripted `events`
- `terminal`
- `pauseForInput`
- `inputAck` to simulate `active_turn`, `thread_continuation`, and `resume_fallback` acknowledgements
- `neverCompletesUntilWatchdog`
- arrays recording `inputs` and `cancelRequests`

This keeps API and worker tests deterministic.

- [ ] **Step 10: Run focused worker tests**

Run: `pnpm test tests/run-worker`

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/run-worker tests/run-worker tsconfig.base.json package.json pnpm-workspace.yaml
git commit -m "feat: add durable codex run worker"
```

## Task 7: Async Run API, Event Backfill, SSE, and Operator Commands

**Files:**
- Modify: `apps/control-plane-api/src/p0/dto.ts`
- Modify: `apps/control-plane-api/src/p0/p0.module.ts`
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
- Modify: `apps/control-plane-api/src/p0/p0.controller.ts`
- Create: `apps/control-plane-api/src/p0/run-session-serialization.ts`
- Create: `apps/control-plane-api/src/p0/run-worker-lifecycle.service.ts`
- Modify: `apps/control-plane-api/package.json`
- Modify: `tsconfig.base.json`
- Test: `tests/api/async-run.test.ts`
- Test: `tests/api/run-events.test.ts`
- Test: `tests/api/delivery-flow.test.ts`
- Test: `tests/api/local-codex-routing.test.ts`

- [ ] **Step 1: Write failing async run API tests**

Create `tests/api/async-run.test.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { seedReadyExecutionPackageThroughApi } from '../helpers/p0-runtime-fixtures';

describe('async package runs', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns immediately with run_session_id and no workflow_result', async () => {
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);
    const response = await request(app.getHttpServer())
      .post(`/execution-packages/${executionPackage.id}/run`)
      .send({ requested_by_actor_id: 'actor-owner', workflow_only: true })
      .expect(201);

    expect(response.body).toMatchObject({
      status: 'accepted',
      run_session_id: expect.stringContaining('run-session'),
      execution_package_id: executionPackage.id,
    });
    expect(response.body).not.toHaveProperty('workflow_result');
  });
});
```

- [ ] **Step 2: Write failing event API tests**

Create `tests/api/run-events.test.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { seedAppWithRunSession } from '../helpers/p0-runtime-fixtures';

describe('run event API', () => {
  const apps: INestApplication[] = [];
  const track = async <T extends { app: INestApplication }>(value: Promise<T>): Promise<T> => {
    const resolved = await value;
    apps.push(resolved.app);
    return resolved;
  };

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('backfills normalized events without raw_ref', async () => {
    const { app, runSessionId, repo } = await track(seedAppWithRunSession());
    await repo.appendRunEvent({
      id: 'run-event-1',
      run_session_id: runSessionId,
      event_type: 'agent_message_delta',
      source: 'codex',
      visibility: 'public',
      summary: 'Codex output.',
      payload: { text: 'hello' },
      raw_ref: { local_ref: '/tmp/raw.jsonl' },
      created_at: '2026-05-07T00:00:00.000Z',
    });

    const response = await request(app.getHttpServer())
      .get(`/run-sessions/${runSessionId}/events`)
      .query({ actor_id: 'actor-owner' })
      .expect(200);

    expect(response.body.events[0]).toMatchObject({ event_type: 'agent_message_delta' });
    expect(response.body.events[0]).not.toHaveProperty('raw_ref');
  });

  it('omits internal events from public backfill', async () => {
    const { app, runSessionId, repo } = await track(seedAppWithRunSession());
    await repo.appendRunEvent({
      id: 'run-event-internal',
      run_session_id: runSessionId,
      event_type: 'codex_warning',
      source: 'codex',
      visibility: 'internal',
      summary: 'Internal raw notification.',
      payload: { detail: 'hidden' },
      raw_ref: { local_ref: '/tmp/raw.jsonl' },
      created_at: '2026-05-07T00:00:00.000Z',
    });

    const response = await request(app.getHttpServer())
      .get(`/run-sessions/${runSessionId}/events`)
      .query({ actor_id: 'actor-owner' })
      .expect(200);

    expect(response.body.events).toEqual([]);
  });

  it('redacts internal logs from run-session detail responses', async () => {
    const { app, runSessionId, repo } = await track(seedAppWithRunSession());
    const runSession = await repo.getRunSession(runSessionId);
    await repo.saveRunSession({
      ...runSession!,
      artifacts: [
        { kind: 'diff', name: 'Diff', content_type: 'text/x-patch', local_ref: 'artifacts/diff.patch' },
        { kind: 'logs', name: 'Raw Codex log', content_type: 'application/jsonl', local_ref: 'artifacts/raw-codex.jsonl' },
      ],
      log_refs: [{ kind: 'logs', name: 'Raw Codex log', content_type: 'application/jsonl', local_ref: 'artifacts/raw-codex.jsonl' }],
    });

    const response = await request(app.getHttpServer()).get(`/run-sessions/${runSessionId}`).expect(200);

    expect(response.body.artifacts.map((artifact: { kind: string }) => artifact.kind)).toEqual(['diff']);
    expect(response.body.log_refs ?? []).toEqual([]);
    expect(JSON.stringify(response.body)).not.toContain('raw-codex.jsonl');
  });

  it('rejects event backfill for actors who cannot view the work item', async () => {
    const { app, runSessionId } = await track(seedAppWithRunSession());

    await request(app.getHttpServer())
      .get(`/run-sessions/${runSessionId}/events`)
      .query({ actor_id: 'actor-stranger' })
      .expect(403);
  });

  it('rejects demo actor_id fallback when durable mode has no authenticated actor', async () => {
    const { app, runSessionId } = await track(
      seedAppWithRunSession({ durabilityMode: 'durable', allowDemoActorIdFallback: false }),
    );

    await request(app.getHttpServer()).get(`/run-sessions/${runSessionId}/events`).query({ actor_id: 'actor-owner' }).expect(401);
  });

  it('persists user input as a pending command before delivery', async () => {
    const { app, runSessionId, repo } = await track(seedAppWithRunSession());
    const response = await request(app.getHttpServer())
      .post(`/run-sessions/${runSessionId}/input`)
      .send({ actor_id: 'actor-owner', message: 'Continue with option B.' })
      .expect(201);

    expect(response.body).toMatchObject({ status: 'accepted', command_type: 'input' });
    await repo.claimRunWorkerLease({
      run_session_id: runSessionId,
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now: '2026-05-07T00:00:00.000Z',
      expires_at: '2026-05-07T00:05:00.000Z',
    });
    expect(await repo.claimNextRunCommand(runSessionId, 'worker-1', 'lease-token-1', '2026-05-07T00:00:00.000Z')).toMatchObject({
      command: { command_type: 'input' },
    });
  });

  it('rejects run operator commands from actors who are not owner or reviewer', async () => {
    const { app, runSessionId } = await track(seedAppWithRunSession());

    await request(app.getHttpServer())
      .post(`/run-sessions/${runSessionId}/input`)
      .send({ actor_id: 'actor-stranger', message: 'Cancel the current approach.' })
      .expect(403);
  });
});
```

- [ ] **Step 3: Run API tests to verify they fail**

Run: `pnpm test tests/api/async-run.test.ts tests/api/run-events.test.ts`

Expected: FAIL because run still returns `workflow_result` and event endpoints do not exist.

- [ ] **Step 4: Add command DTO schemas**

In `dto.ts`, add:

```ts
export const runInputSchema = z.object({
  actor_id: nonEmptyString.optional(),
  message: nonEmptyString,
  target_turn_id: nonEmptyString.optional(),
}).strict();
export type RunInputDto = z.infer<typeof runInputSchema>;

export const runControlSchema = z.object({
  actor_id: nonEmptyString.optional(),
  reason: nonEmptyString.optional(),
}).strict();
export type RunControlDto = z.infer<typeof runControlSchema>;
```

Keep `actor_id` clearly scoped as a P0 demo shortcut. It is accepted only through `resolveRunActor()` when `allowDemoActorIdFallback === true` and `durabilityMode === 'volatile_demo'`; durable mode must rely on authenticated server context or reject the request.

- [ ] **Step 5: Inject repository and worker instead of constructing private in-memory state**

In `p0.service.ts`, replace:

```ts
private readonly repository: P0Repository = new InMemoryP0Repository();
```

with constructor injection:

```ts
export const P0_REPOSITORY = Symbol('P0_REPOSITORY');
export const RUN_WORKER = Symbol('RUN_WORKER');
export const RUN_DURABILITY_MODE = Symbol('RUN_DURABILITY_MODE');
export const P0_DEMO_ACTOR_ID_FALLBACK = Symbol('P0_DEMO_ACTOR_ID_FALLBACK');

constructor(
  @Inject(P0_REPOSITORY) private readonly repository: P0Repository,
  @Inject(RUN_WORKER) private readonly runWorker: RunWorker,
  @Inject(RUN_DURABILITY_MODE) private readonly durabilityMode: 'durable' | 'volatile_demo',
  @Inject(P0_DEMO_ACTOR_ID_FALLBACK) private readonly allowDemoActorIdFallback: boolean,
) {}
```

Remove `P0_EXECUTOR_ADAPTERS` from `P0Service` run execution. That registry represented the old synchronous executor path. If any API tests override it, migrate them to override the run worker, driver factory, or evidence collector instead.

In `p0.module.ts`, provide:

- `P0_REPOSITORY` with `InMemoryP0Repository` by default for tests/dev
- `RUN_WORKER` using the same repository, a driver factory, and an evidence collector
- `P0_DEMO_ACTOR_ID_FALLBACK` as `true` only for `volatile_demo` test/dev mode; durable mode without authenticated server context must set it to `false`
- for `workflow_only` tests, use `FakeCodexSessionDriver` plus a mock evidence collector that returns a valid mock `ExecutorResult`
- for `local_codex`, use the app-server driver first, exec fallback if needed, and `captureLocalCodexEvidence()` after terminal Codex completion

If `FORGELOOP_DATABASE_URL` is present, wire `createDbClient` and `createDrizzleP0Repository`. Ensure the API sets `runtime_metadata.durability_mode` to `durable` for Drizzle and `volatile_demo` for in-memory.

Update workspace imports:

- add `@forgeloop/run-worker` to `apps/control-plane-api/package.json`
- add `@forgeloop/run-worker` to `tsconfig.base.json` paths if it was not added in Task 6

Create `run-worker-lifecycle.service.ts` implementing `OnModuleInit` / `OnModuleDestroy`:

- on module init, call `runWorker.drainOnce()` immediately
- then poll `runWorker.drainOnce()` every 2-5 seconds for recoverable runs
- on module destroy, clear the interval

This polling loop is not the durability boundary; it only wakes the worker. The worker must still discover queued/recoverable runs from repository state on every `drainOnce()`.

Create `run-session-serialization.ts`:

```ts
export const serializePublicArtifactRef = (artifact: ArtifactRef): ArtifactRef | undefined => {
  if (artifact.kind === 'logs' || 'raw_ref' in artifact) {
    return undefined;
  }
  const { raw_ref: _rawRef, ...publicArtifact } = artifact as ArtifactRef & { raw_ref?: unknown };
  return publicArtifact;
};

export const serializePublicArtifactRefs = (artifacts: ArtifactRef[]): ArtifactRef[] =>
  artifacts.flatMap((artifact) => {
    const publicArtifact = serializePublicArtifactRef(artifact);
    return publicArtifact === undefined ? [] : [publicArtifact];
  });

export const serializePublicRunSession = (runSession: RunSession): RunSession => {
  const { executor_result: executorResult, ...rest } = runSession;
  const base = {
    ...rest,
    artifacts: serializePublicArtifactRefs(runSession.artifacts),
    log_refs: [],
  };
  return executorResult === undefined
    ? base
    : {
        ...base,
        executor_result: {
          ...executorResult,
          artifacts: serializePublicArtifactRefs(executorResult.artifacts),
        },
      };
};
```

If future internal operators need raw logs, add a separate explicitly authorized endpoint later. Do not expose raw Codex `logs` artifacts or `raw_ref` through existing public run-session, package, workbench, or event responses in this slice.

- [ ] **Step 6: Make run/rerun/force-rerun asynchronous**

In `P0Service.runPackage`:

- Keep validation and force-rerun review packet archival.
- Create `RunSession` with runtime metadata.
- Save execution package and run session.
- Append `run_queued` RunEvent.
- Do not call `executePackageRun`.
- Call `this.runWorker.kick()` as a best-effort in-process wake-up. Do not await terminal completion.
- Return `RunAcceptedResponse`.

Expected response:

```json
{
  "status": "accepted",
  "run_session_id": "run-session-123",
  "execution_package_id": "execution-package-123"
}
```

- [ ] **Step 7: Add event and command service methods**

Add to `P0Service`:

- `listRunEvents(runSessionId, options: { after?: string; actorId?: string })`
- `streamRunEvents(runSessionId, options: { after?: string; actorId?: string }): Observable<MessageEvent>`
- `createRunInputCommand(runSessionId, dto)`
- `createRunCancelCommand(runSessionId, dto)`
- `createRunResumeCommand(runSessionId, dto)`
- `assertRunOperatorAllowed(runSession, actorId)`
- `assertRunViewerAllowed(runSession, actorId)`
- `resolveRunActor(input: { authenticatedActorId?: string; demoActorId?: string }): string`
- `serializePublicRunSession(runSession)`

Event read methods:

- derive the viewer from authenticated server context when available
- accept query/body `actor_id` only when `allowDemoActorIdFallback === true` and `durabilityMode === 'volatile_demo'`
- when no authenticated actor exists and demo fallback is disabled, throw `UnauthorizedException`; do not treat a client-submitted `actor_id` as production authorization
- reject missing actor ids for event reads
- load the run session, execution package, and work item before returning events
- permit the work item owner, execution package owner, reviewer, or QA owner
- throw `ForbiddenException` for any other viewer
- filter repository rows to `visibility === 'public'`
- parse every returned row with `publicRunEventSchema`
- omit `raw_ref` from public responses
- serialize run-session detail responses through `serializePublicRunSession`, which removes internal `logs` artifacts, raw-log `log_refs`, and any `raw_ref` fields before returning `GET /run-sessions/:id`

Each command method:

- validates run exists and is non-terminal
- derives the actor from authenticated server context when available
- accepts `dto.actor_id` only when `allowDemoActorIdFallback === true` and `durabilityMode === 'volatile_demo'`; durable mode without authenticated actor throws `UnauthorizedException`
- rejects missing actor ids for mutating run commands
- loads the execution package for the run and permits only `owner_actor_id` or `reviewer_actor_id` to input, cancel, or resume
- throws `ForbiddenException` for any other actor
- saves `RunCommand` as `pending`
- for `createRunCancelCommand`, call `supersedePendingRunCommands(runSessionId, ['input'], now)` before saving the cancel command so older input cannot be delivered ahead of cancel
- appends a public event: `user_input`, `cancel_requested`, or `resuming`
- applies the appropriate `RunSession` transition for cancel/resume
- returns `RunOperatorCommandResponse`

- [ ] **Step 8: Add controller endpoints**

In `p0.controller.ts`, add:

```ts
@Get('run-sessions/:runSessionId/events')
listRunEvents(
  @Param('runSessionId') runSessionId: string,
  @Query('after') after?: string,
  @Query('actor_id') actorId?: string,
) {
  return this.service.listRunEvents(runSessionId, {
    ...(after === undefined ? {} : { after }),
    ...(actorId === undefined ? {} : { actorId }),
  });
}

@Sse('run-sessions/:runSessionId/events/stream')
streamRunEvents(
  @Param('runSessionId') runSessionId: string,
  @Query('after') after?: string,
  @Query('actor_id') actorId?: string,
): Observable<MessageEvent> {
  return this.service.streamRunEvents(runSessionId, {
    ...(after === undefined ? {} : { after }),
    ...(actorId === undefined ? {} : { actorId }),
  });
}

@Post('run-sessions/:runSessionId/input')
sendRunInput(@Param('runSessionId') runSessionId: string, @Body(new ZodValidationPipe(runInputSchema)) body: RunInputDto) {
  return this.service.createRunInputCommand(runSessionId, body);
}

@Post('run-sessions/:runSessionId/cancel')
cancelRun(@Param('runSessionId') runSessionId: string, @Body(new ZodValidationPipe(runControlSchema)) body: RunControlDto) {
  return this.service.createRunCancelCommand(runSessionId, body);
}

@Post('run-sessions/:runSessionId/resume')
resumeRun(@Param('runSessionId') runSessionId: string, @Body(new ZodValidationPipe(runControlSchema)) body: RunControlDto) {
  return this.service.createRunResumeCommand(runSessionId, body);
}
```

SSE implementation can poll `repository.listRunEvents(runSessionId, { after: cursor })` every 500ms and emit missed public events. Always backfill before waiting for new events. Apply the same viewer authorization and public-event filtering before opening the stream.

- [ ] **Step 9: Update existing delivery-flow assertions**

In `tests/api/delivery-flow.test.ts`, replace assertions that expect immediate `workflow_result` with:

```ts
expect(firstRun).toMatchObject({ status: 'accepted', run_session_id: expect.any(String) });
expect(firstRun).not.toHaveProperty('workflow_result');
```

Then explicitly drain the injected worker or poll the run session until terminal before asserting Review Packet behavior.

Also update `tests/api/local-codex-routing.test.ts`:

- remove overrides of `P0_EXECUTOR_ADAPTERS`
- override the run worker driver factory and evidence collector instead
- assert `POST /run` returns `accepted` immediately
- then drain/poll until terminal before asserting local_codex workspace metadata and artifacts

- [ ] **Step 10: Run focused API tests**

Run: `pnpm test tests/api/async-run.test.ts tests/api/run-events.test.ts tests/api/delivery-flow.test.ts tests/api/local-codex-routing.test.ts`

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add tsconfig.base.json apps/control-plane-api/package.json apps/control-plane-api/src tests/api/async-run.test.ts tests/api/run-events.test.ts tests/api/delivery-flow.test.ts tests/api/local-codex-routing.test.ts
git commit -m "feat: expose async run event API"
```

## Task 8: Web Run Console

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/workbenchState.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `tests/web/run-console-state.test.ts`
- Test: `tests/web/api.test.ts`
- Test: `tests/web/workbench-state.test.ts`

- [ ] **Step 1: Write failing run console state tests**

Create `tests/web/run-console-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  appendRunEvents,
  latestContinuationNotice,
  nextRunEventCursor,
  visibleRunArtifacts,
} from '../../apps/web/src/workbenchState';

describe('run console state', () => {
  it('appends events in sequence order without duplicates', () => {
    const events = appendRunEvents(
      [{ id: 'event-1', sequence: 1, cursor: '0000000001' }],
      [
        { id: 'event-1', sequence: 1, cursor: '0000000001' },
        { id: 'event-2', sequence: 2, cursor: '0000000002' },
      ],
    );

    expect(events.map((event) => event.id)).toEqual(['event-1', 'event-2']);
    expect(nextRunEventCursor(events)).toBe('0000000002');
  });

  it('detects fallback continuation mode for UI labeling', () => {
    const events = appendRunEvents([], [
      {
        id: 'event-1',
        sequence: 1,
        cursor: '0000000001',
        event_type: 'user_input',
        payload: { continuity: 'resume_fallback' },
      },
    ]);

    expect(latestContinuationNotice(events)).toBe(
      'Continuation resumed through fallback; live subagent continuity is not guaranteed.',
    );
  });

  it('detects same-thread continuation mode for UI labeling', () => {
    const events = appendRunEvents([], [
      {
        id: 'event-1',
        sequence: 1,
        cursor: '0000000001',
        event_type: 'user_input',
        payload: { continuity: 'thread_continuation' },
      },
    ]);

    expect(latestContinuationNotice(events)).toBe(
      'Continuation started as a new turn; live subagent continuity is not guaranteed.',
    );
  });

  it('filters internal logs and raw refs out of existing run artifact views', () => {
    const artifacts = visibleRunArtifacts([
      { kind: 'diff', path: 'artifacts/diff.patch' },
      { kind: 'logs', path: 'artifacts/raw-codex.jsonl' },
      { kind: 'trace', raw_ref: { path: 'artifacts/internal.jsonl' } },
    ]);

    expect(artifacts).toEqual([{ kind: 'diff', path: 'artifacts/diff.patch' }]);
  });
});
```

- [ ] **Step 2: Run web state tests to verify they fail**

Run: `pnpm test tests/web/run-console-state.test.ts`

Expected: FAIL with missing helpers.

- [ ] **Step 3: Add web API types and clients**

In `apps/web/src/api.ts`, add:

- `RunEvent`
- `RunEventListResponse`
- `RunOperatorCommandResponse`
- `listRunEvents(runSessionId, options: { after?: string; actorId: string })`
- `sendRunInput(runSessionId, actorId, message, targetTurnId?)`
- `cancelRun(runSessionId, actorId, reason?)`
- `resumeRun(runSessionId, actorId, reason?)`
- `openRunEventStream(runSessionId, options: { after?: string; actorId: string }, handlers)`

Every helper must propagate `actorId` to the API:

- event list and SSE calls send it as `actor_id` query param
- input/cancel/resume calls include `actor_id` in the JSON body
- helpers should reject an empty `actorId` before issuing the request so the UI cannot silently open an unauthenticated stream

`openRunEventStream` should wrap `EventSource` and call:

```ts
handlers.onEvent(JSON.parse(message.data) as RunEvent);
handlers.onError(error);
```

- [ ] **Step 4: Add state helpers**

In `workbenchState.ts`, implement:

```ts
export const appendRunEvents = <T extends { id: string; sequence: number }>(current: T[], incoming: T[]): T[] =>
  [...new Map([...current, ...incoming].map((event) => [event.id, event])).values()].sort(
    (left, right) => left.sequence - right.sequence,
  );

export const nextRunEventCursor = (events: Array<{ cursor?: string }>): string | undefined =>
  [...events].reverse().find((event) => event.cursor !== undefined)?.cursor;

export const latestContinuationNotice = (
  events: Array<{ payload?: Record<string, unknown> }>,
): string | undefined => {
  const continuity = [...events].reverse().find(
    (item) => item.payload?.continuity === 'resume_fallback' || item.payload?.continuity === 'thread_continuation',
  )?.payload?.continuity;
  if (continuity === 'resume_fallback') {
    return 'Continuation resumed through fallback; live subagent continuity is not guaranteed.';
  }
  if (continuity === 'thread_continuation') {
    return 'Continuation started as a new turn; live subagent continuity is not guaranteed.';
  }
  return undefined;
};

export const visibleRunArtifacts = <T extends { kind?: string; raw_ref?: unknown }>(artifacts: T[]): T[] =>
  artifacts.filter((artifact) => artifact.kind !== 'logs' && artifact.raw_ref === undefined);
```

- [ ] **Step 5: Add Run Console UI**

In `App.tsx`, add a Run Console area near the selected package/run detail, not a marketing section.

It must show:

- status
- driver kind
- dangerous/yolo mode
- worker lease owner/status if present
- Codex thread id and active turn id if present
- last event age
- current plan step from `plan_updated` events if present
- visible continuation notice when the latest input or driver event has `continuity: 'thread_continuation'` or `continuity: 'resume_fallback'`
- event stream
- input box
- cancel and resume buttons

Rendering rules:

- Agent messages are readable text.
- Tool calls and commands are compact rows.
- Command output deltas use a terminal-style excerpt with wrapping and max height.
- Heartbeats are compact or hidden by default.
- Fallback/continuation labels must be visible near the input area. For `resume_fallback`, show that live subagent continuity is not guaranteed.
- Do not link raw logs.
- Filter `run.log_refs`, selected-package artifacts, and any existing run-detail artifact lists so internal `logs` artifacts and `raw_ref` values are not rendered anywhere in `App.tsx`, not just inside the new Run Console.

- [ ] **Step 6: Wire SSE reconnect**

When a run is selected:

1. Resolve the current actor id from existing workbench state or the demo actor selector.
2. Call `listRunEvents(runSessionId, { actorId })` for backfill.
3. Track latest cursor using `nextRunEventCursor`.
4. Open `EventSource` at `/run-sessions/:id/events/stream?actor_id=<actorId>&after=<cursor>`.
5. On error/close, reconnect with the newest cursor.
6. On package/run or actor change, close the previous stream.
7. Send input/cancel/resume through helpers that include the same actor id.

- [ ] **Step 7: Add styles with stable dimensions**

In `styles.css`, add console styles with:

- fixed min-height for the event list
- `overflow: auto`
- `white-space: pre-wrap`
- `overflow-wrap: anywhere`
- buttons with stable width and no text overflow
- no nested cards inside cards

- [ ] **Step 8: Run web tests and build**

Run: `pnpm test tests/web/run-console-state.test.ts tests/web/api.test.ts tests/web/workbench-state.test.ts`

Expected: PASS.

Run: `pnpm --filter @forgeloop/web build`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src tests/web/run-console-state.test.ts tests/web/api.test.ts tests/web/workbench-state.test.ts
git commit -m "feat: add live run console"
```

## Task 9: Smoke, Dogfood, and Full Verification

**Files:**
- Modify: `tests/smoke/p0-smoke.test.ts`
- Modify: `scripts/p0-dogfood.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/reports/p0-delivery-loop-verification.md` if the current report documents obsolete synchronous behavior

- [ ] **Step 1: Update smoke tests for async live events**

In `tests/smoke/p0-smoke.test.ts`, assert:

- run command returns `status: accepted`
- at least one `run_queued` or `driver_started` event is visible before terminal run status
- terminal run still has changed files, checks, artifacts, and Review Packet when the fake/mock driver succeeds

Run: `pnpm smoke:p0`

Expected: PASS.

- [ ] **Step 2: Update dogfood script**

In `scripts/p0-dogfood.ts`, update flow:

- start API and Web if needed
- create/run a package
- print the `run_session_id`
- poll or stream `/run-sessions/:id/events`
- verify a live event arrives before terminal status
- simulate `waiting_for_input` with fake driver path
- POST `/run-sessions/:id/input`
- verify the command is applied and a later event appears
- simulate API/worker restart by stopping the in-process worker loop or rebuilding the Nest app with the same durable repository
- verify prior events remain backfillable by cursor after restart
- verify the worker reclaims the recoverable run lease and continues without duplicating already-applied input
- verify final diff/check/artifact/review packet flow still works

Run: `pnpm dogfood:p0`

Expected: PASS and console output includes event stream progress before terminal completion.

- [ ] **Step 3: Update docs**

In `README.md`, document:

- `pnpm dev:api`
- `pnpm dev:web`
- how to start a run
- where Run Console appears
- `FORGELOOP_DATABASE_URL` for durable mode
- in-memory local mode is `volatile_demo`
- `.worktrees/<run-session-id>` is a Git/evidence boundary, not a security sandbox

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm test
pnpm smoke:p0
pnpm build
```

Expected: all commands PASS.

When a local Postgres database is available, also run:

```bash
FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm db:push
```

Expected: schema push succeeds. If no local database is available, record that durable DB push was not run; do not claim durable restart recovery was manually verified.

- [ ] **Step 5: Manual browser verification**

Start:

```bash
pnpm dev:api
pnpm dev:web
```

Open the Web app. Start a workflow-only run, select its Run Console, and verify:

- event backfill appears
- SSE appends new events
- input box creates a visible `user_input` event
- cancel/resume buttons create accepted commands
- text does not overflow the console on desktop or narrow viewport

- [ ] **Step 6: Commit**

```bash
git add tests/smoke/p0-smoke.test.ts scripts/p0-dogfood.ts README.md docs/superpowers/reports/p0-delivery-loop-verification.md
git commit -m "test: dogfood long-running codex runs"
```

## Final Verification Checklist

- [ ] `pnpm test` passes.
- [ ] `pnpm smoke:p0` passes.
- [ ] `pnpm build` passes.
- [ ] Run command returns immediately without `workflow_result`.
- [ ] Durable repository can backfill run events by cursor.
- [ ] SSE reconnect backfills missed events.
- [ ] User input/cancel/resume are persisted before worker delivery.
- [ ] Worker restart/takeover tests prove queued or stalled runs are discovered from repository state.
- [ ] Main Codex run is not killed by `timeout_seconds`.
- [ ] Required checks still honor per-command `timeout_seconds`.
- [ ] Public event API omits `raw_ref`.
- [ ] Raw app-server notifications and fallback JSONL are retained as internal `logs` artifacts.
- [ ] Non-mock local Codex runs use `.worktrees/<run-session-id>`.
- [ ] Dangerous/yolo effective mode is recorded as confirmed or preflight fails.
- [ ] Source repo mutations outside the run worktree fail the run with operator attention.
- [ ] Terminal evidence and Review Packet creation still work.
