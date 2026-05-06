# Codex Long-Running Execution Design

## 1. Purpose

Forgeloop must treat Codex execution as an observable, resumable, user-steerable long-running job.

The immediate problem is not just that a Codex process can exceed a short timeout. A Codex run can legitimately take hours or days, can ask a user for input, can spawn subagents, can run long shell commands, and can produce useful progress long before it reaches a terminal result. The Web UI must show that progress in real time.

This design replaces the current synchronous `await runCodex()` black box with a durable execution runtime:

```text
ExecutionPackage run command
  -> RunSession + worker job
  -> Codex app-server thread/turn
  -> append-only RunEvent stream
  -> Web Run Console via SSE
  -> terminal evidence and Review Packet
```

The design keeps the first implementation to a production-shaped local slice. It does not attempt to build a complete distributed job platform in the first pass.

## 2. Goals

- Run Codex tasks for hours or days without classifying them as failed because a fixed wall-clock timeout elapsed.
- Show live Codex output in the Web UI while the run is still active.
- Capture actual progress signals from Codex, shell commands, app-server notifications, and worker heartbeats.
- Let users provide input to an active Codex run from the Web UI.
- Prefer preserving live subagent continuity by using Codex app-server `thread` / `turn` APIs instead of ending every interaction and resuming with a fresh process.
- Resume or diagnose runs after API or worker restart without losing already produced output.
- Persist run state, event history, worker leases, and operator commands in durable storage. In-memory storage is valid only for unit tests and explicit fake/demo runs that do not claim restart recovery.
- Run Codex from a dedicated persistent `.worktrees/<run-session-id>` worktree while using yolo/dangerous permissions, with detection for source repo mutations outside that run worktree.
- Preserve the existing terminal evidence model: changed files, diffs, check results, artifacts, execution summary, and review packet.

## 3. Non-Goals

- Do not require strong checkpointing of Codex internal state or subagent memory in the first version.
- Do not guarantee live subagent continuity after app-server or worker process death. The system should preserve transcript, events, worktree, and thread metadata, then resume best effort.
- Do not implement multi-machine worker scheduling in the first version.
- Do not merge, push, open PRs, or release code from this workflow.
- Do not feed arbitrary stdin into shell commands started by Codex. User input goes to Codex as a steer or follow-up message.
- Do not expose raw JSONL or raw app-server notifications in the first Web UI. Raw logs are retained as local artifacts for debugging, while the UI consumes normalized and redacted events.

## 4. Recommended Approach

Use Codex app-server as the primary execution channel and keep `codex exec` / `codex exec resume` as a fallback.

### 4.1 Accepted Alternatives

#### A. `codex exec` / `resume` only

This is the smallest implementation. It can capture JSONL and resume the same thread id. It is not enough as the primary design because every user input becomes a new process or turn, and live in-memory subagent continuity is weak.

#### B. Codex app-server primary plus `exec` fallback

This is the selected approach.

The worker owns a supervised app-server connection. It starts or resumes a Codex thread, starts a turn, listens to app-server notifications, normalizes them into `RunEvent` rows, and streams them to the Web UI. When a user sends input while a turn is active, the worker uses `turn/steer` so the current turn can continue where possible.

If app-server is unavailable or cannot resume, the driver can fall back to `codex exec --json` / `codex exec resume --json`.

#### C. Full checkpointed execution platform

This adds mandatory checkpoints, multi-worker scheduling, stronger process recovery, and eventually multi-machine orchestration. It is directionally useful, but too large for the first implementation. The data model should not block this future, but the first version should not depend on it.

## 5. Architecture

### 5.1 Components

`apps/control-plane-api`

- Creates `RunSession` records and durable worker jobs.
- Returns `run_session_id` immediately from run commands.
- Exposes run event backfill and SSE streaming endpoints.
- Accepts user input, cancel, and resume commands.
- Persists operator commands before worker delivery so commands are not lost if no worker is connected at request time.
- Projects concise run events into existing Work Item timeline where useful.

`run worker`

- Owns active Codex execution for a `RunSession`.
- Holds a worker lease for the run.
- Starts or reconnects to Codex app-server.
- Uses `CodexSessionDriver` to start, steer, resume, or cancel a Codex run.
- Polls or subscribes to durable pending run commands such as input, cancel, and resume.
- Persists normalized events as they arrive.
- Produces terminal `ExecutorResult` only after Codex reaches terminal state and required checks/evidence capture finish.

`CodexSessionDriver`

- Abstracts over app-server primary mode and exec fallback mode.
- Captures effective driver kind, driver version, dangerous/yolo mode, thread id, active turn id, and recovery mode.
- Provides a stable interface to the worker:
  - `startRun(runSpec, workspacePath)`
  - `resumeRun(runtimeMetadata)`
  - `sendInput(runSessionId, input)`
  - `cancelRun(runSessionId)`
  - `subscribeEvents(runSessionId)`

`CodexEventNormalizer`

- Converts Codex app-server notifications and fallback JSONL into stable Forgeloop `RunEvent` objects.
- Applies redaction, truncation, event classification, cursor assignment, and raw-log linking.

`apps/web`

- Adds a Run Console for live progress.
- Connects to SSE, backfills with cursor, renders structured event stream, and provides an input box for continuing instructions.

### 5.2 Durability Boundary

Long-running execution cannot rely on process memory for authoritative state.

The first implementation must persist these records in a storage layer that survives API and worker process restart:

- `RunSession` status and runtime metadata
- queued run dispatch intent or worker job record
- `RunEvent` rows and cursors
- worker leases
- pending and processed operator commands
- artifact references
- review/finalization state

The existing in-memory repository can remain available for unit tests, fake drivers, and explicit demo-only paths. It must not be used for any flow that claims restart recovery, multi-day execution, or durable user input. If the project keeps a local-only development mode before a production database is wired in, that mode needs a file-backed or database-backed durable repository for these execution records.

The implementation may model the queued worker job as the `RunSession` itself, as long as workers can discover `queued`, `stalled`, `resuming`, and other non-terminal recoverable runs by reading durable storage after restart. It must not rely on an in-memory queue as the only dispatch mechanism.

### 5.3 Worktree Execution Boundary

Every non-mock `local_codex` run uses a persistent Git worktree:

```text
.worktrees/<run-session-id>
```

The worktree is created from the run's base commit/ref. Codex runs with this worktree as its working directory.

The worktree is a Git and evidence boundary, not a security sandbox. Because yolo/dangerous mode grants broad filesystem capability, implementation must not claim that `.worktrees/<run-session-id>` prevents writes outside the worktree. The first version accepts this local trust model and detects violations rather than preventing every possible filesystem write.

The worker must record the source repo's pre-run status and verify after the run that the source repo outside the run worktree was not modified. Any source repo mutation outside the run worktree is a run failure that requires operator attention.

The existing evidence gates still apply after Codex finishes:

- allowed paths
- forbidden paths
- changed file capture
- diff capture
- required checks
- review packet
- human approval

`.worktrees/` must stay ignored by Git.

If stronger filesystem containment becomes required, it belongs in a later OS sandbox or container layer. That later layer must preserve the same `CodexSessionDriver` and `RunEvent` interfaces.

### 5.4 Dangerous / Yolo Mode

For fallback exec mode, the driver uses:

```text
codex exec --json --dangerously-bypass-approvals-and-sandbox ...
codex exec resume <thread_id> --json --dangerously-bypass-approvals-and-sandbox ...
```

For app-server mode, the driver uses the app-server protocol equivalent:

- `approvalPolicy: never`
- `sandbox: danger-full-access`
- any required configuration override needed for the current Codex CLI to match the same effective yolo behavior

The effective mode is recorded in runtime metadata. If the driver cannot confirm the intended dangerous/yolo mode, preflight fails before the run starts.

## 6. RunSession Lifecycle

### 6.1 Statuses

Extend `RunSessionStatus` with non-terminal states:

- `queued`
- `running`
- `waiting_for_input`
- `stalled`
- `resuming`
- `cancel_requested`
- `succeeded`
- `failed`
- `timed_out`
- `cancelled`

`waiting_for_input`, `stalled`, `resuming`, and `cancel_requested` are not terminal states.

### 6.2 State Semantics

`queued`

The API created the `RunSession` and a worker job. No worker has started the Codex run yet.

`running`

A worker lease is active and Codex is running, resuming, executing a turn, or running required checks.

`waiting_for_input`

Codex asked for user input or the system detected that progress requires an operator instruction. This is not a failure and should not count against idle watchdogs in the same way as silent execution.

`stalled`

The system cannot prove progress from events, heartbeats, or process state. This is attention-required, not a terminal executor result. Operators can inspect, send input, resume, or cancel.

`resuming`

A worker is attempting to reconnect to app-server, resume the Codex thread, or fall back to exec resume.

`cancel_requested`

A user requested cancellation. The worker should attempt graceful turn/job cancellation and then transition to `cancelled` when complete.

`timed_out` remains a terminal state for bounded sub-operations such as required checks or explicit operator-configured maximum runtime policies. It is not the default result for a long Codex main run that is merely idle. Idle main execution should first become `stalled`.

Terminal states keep their existing meanings otherwise.

## 7. User Input

User input is a first-class run command, not shell stdin.

### 7.1 Active App-Server Turn

If the run has an active app-server turn, Web input calls:

```text
POST /run-sessions/:runSessionId/input
```

The API records a `user_input` event and forwards the instruction to the worker. The worker uses app-server `turn/steer` with the active thread id and turn id.

This preserves live continuity where Codex and its subagents can accept steering during the current turn.

### 7.2 Inactive Turn or Fallback Mode

If no active turn is available, the worker starts a new turn on the same thread or uses fallback:

```text
codex exec resume <thread_id> --json --dangerously-bypass-approvals-and-sandbox "<user input>"
```

The UI must label this as a continuation that does not guarantee live subagent continuity.

### 7.3 No Direct Shell Stdin

The system does not write user input directly to shell commands launched by Codex.

If a command appears to be waiting for interactive stdin, the run should surface the last command, last output, and attention state. The user can then instruct Codex how to proceed. This keeps the interaction auditable and avoids sending secrets or unsafe confirmations into arbitrary processes.

### 7.4 Permissions and Audit

In the first version:

- All users who can view the Work Item can view the event stream.
- Only the owner or reviewer can send continuation input.
- Each input stores actor id, target run id, target thread id, target turn id if available, created time, and input content or retained artifact reference.
- Production authorization must derive actor identity from authenticated server context, not trust a client-submitted `actor_id`. If the P0 demo keeps the existing actor-id-in-body pattern, it must be treated as a demo shortcut and not as a security boundary.

### 7.5 Durable Command Inbox

User input, cancel, and resume are durable run commands.

The API must persist each command before attempting delivery to a worker. A command has at least:

- `id`
- `run_session_id`
- `command_type`: `input`, `cancel`, or `resume`
- `status`: `pending`, `claimed`, `applied`, `failed`, or `superseded`
- `actor_id`
- `payload`
- `target_thread_id`
- `target_turn_id`
- `created_at`
- `claimed_by_worker_id`
- `applied_at`
- `failure_reason`

Workers consume pending commands while holding the run lease. If no worker is connected, the command remains pending until a worker resumes the run. This prevents Web input from being acknowledged by the API but lost before Codex sees it.

Commands must be idempotent. Retrying a command after worker restart must not inject the same input twice into the same Codex turn. The worker records the target thread/turn and the driver acknowledgement before marking a command `applied`.

## 8. Progress and Watchdog Semantics

The old `timeout_seconds` field must not be treated as a short hard timeout for Codex's main execution.

### 8.1 Progress Signals

The worker considers these signals evidence of progress:

- app-server thread or turn notifications
- agent message deltas
- plan updates
- item started/completed notifications
- command output deltas
- command completed notifications
- raw warning events
- worker heartbeat
- app-server connection heartbeat
- explicit `waiting_for_input`
- required check output

Worker and app-server heartbeats prove runtime liveness, but they do not by themselves prove that Codex is making user-visible progress. Watchdog logic must track both liveness and Codex activity so a healthy worker heartbeat does not hide a stuck Codex turn.

### 8.2 Idle Detection

Idle is suspicious, not immediately failed.

If no progress event arrives past the configured idle threshold, the worker should:

1. Check app-server connection state.
2. Check worker lease ownership.
3. Check child process state if fallback mode is used.
4. Append a `watchdog_idle_detected` event.
5. Move the run to `stalled` if the system cannot prove progress.

The UI should show:

- last event age
- last command
- last output excerpt
- driver kind
- worker lease owner
- available actions

### 8.3 Required Check Timeouts

Required checks still use per-command timeouts. A check timeout can fail the executor result if the check blocks review.

This is distinct from the Codex main run watchdog.

## 9. Recovery

### 9.1 Runtime Metadata

Persist runtime metadata on the `RunSession` or an associated runtime record:

- `driver_kind`: `app_server` or `exec_fallback`
- `driver_status`
- `codex_thread_id`
- `active_turn_id`
- `workspace_path`
- `app_server_endpoint` if relevant
- `worker_id`
- `last_event_cursor`
- `last_event_at`
- `recovery_attempt_count`
- `effective_dangerous_mode`

### 9.2 Worker Lease

Introduce a worker lease for each non-terminal run:

- `run_session_id`
- `worker_id`
- `heartbeat_at`
- `expires_at`
- `status`

Only the lease owner can drive Codex. Another worker can claim the lease after expiry and then attempt recovery.

### 9.3 Pending Commands During Recovery

When a worker acquires or reclaims a run lease, it must load pending run commands before or during Codex recovery.

The recovery path must preserve command order within the same run. A pending `cancel` can supersede older pending input commands. A pending `resume` can trigger the recovery flow but must not clear pending input unless the worker applies or explicitly fails those input commands.

### 9.4 Recovery Order

When a worker takes over a non-terminal run:

1. Reconnect to existing app-server and active thread/turn if possible.
2. If not possible, use app-server `thread/resume`.
3. Load and apply pending commands that are still valid for the recovered thread/turn state.
4. If app-server is not usable, use `codex exec resume <thread_id> --json --dangerously-bypass-approvals-and-sandbox`.
5. If resume fails, move to `stalled` with a clear reason.

The worker must never mark the run `succeeded` solely because a process exited. Success requires terminal Codex completion plus final evidence capture.

## 10. Event Model

Add an append-only `RunEvent` stream.

### 10.1 RunEvent Fields

Minimum fields:

- `id`
- `run_session_id`
- `sequence`
- `cursor`
- `event_type`
- `source`
- `visibility`
- `summary`
- `payload`
- `raw_ref`
- `created_at`

`sequence` is monotonic within a run. `cursor` is the public resume token for REST backfill and SSE reconnection.

`raw_ref` is internal-only in the first version. Public event API responses must omit it unless the same implementation slice also adds explicit raw-log authorization and redaction policy.

### 10.2 Event Types

Initial event types:

- `run_queued`
- `worker_lease_acquired`
- `driver_started`
- `thread_started`
- `thread_resumed`
- `turn_started`
- `turn_status_changed`
- `agent_message_delta`
- `agent_message_completed`
- `plan_updated`
- `tool_call_started`
- `tool_call_progress`
- `tool_call_completed`
- `command_started`
- `command_output_delta`
- `command_completed`
- `waiting_for_input`
- `user_input`
- `watchdog_heartbeat`
- `watchdog_idle_detected`
- `stalled`
- `resuming`
- `cancel_requested`
- `cancelled`
- `codex_warning`
- `driver_fallback_used`
- `executor_result_started`
- `required_check_started`
- `required_check_completed`
- `artifact_captured`
- `run_succeeded`
- `run_failed`

### 10.3 Raw Logs

Raw app-server notifications and fallback JSONL are retained as `logs` artifacts for local operator debugging and later audit tooling.

The first Web UI must not link to or render raw log artifacts by default, because command output can contain secrets. The UI reads normalized events only. Normalized event payloads must be redacted and size-limited before public persistence. If an implementation adds a raw-log download endpoint, it must add explicit authorization and redaction policy in the same slice.

### 10.4 Relation to ObjectEvent

`RunEvent` is the technical execution event stream.

`ObjectEvent` remains the business lifecycle projection used for Work Item cockpit and timeline. A small subset of run events can project into `ObjectEvent`, such as run started, waiting for input, stalled, succeeded, and failed.

## 11. API

### 11.1 Run Command

`POST /execution-packages/:packageId/run`

The endpoint creates `RunSession`, queues a worker job, and returns immediately:

```json
{
  "status": "accepted",
  "run_session_id": "run-session-123",
  "execution_package_id": "package-123"
}
```

It does not wait for Codex completion.

Queueing must be durable. If no worker is connected when the API accepts the run, a later worker startup must still discover and claim the queued run from storage.

The same asynchronous behavior applies to rerun and force-rerun.

### 11.2 Backfill

`GET /run-sessions/:runSessionId/events?after=<cursor>`

Returns events after the cursor. If `after` is omitted, returns the most recent 200 events in ascending order, plus enough cursor metadata for the client to continue from the newest returned event. Older history can be loaded through an explicit historical pagination mode in a later slice.

### 11.3 SSE

`GET /run-sessions/:runSessionId/events/stream?after=<cursor>`

Streams normalized run events using Server-Sent Events. The client sends the latest cursor on reconnect, and the server backfills before continuing live.

### 11.4 User Input

`POST /run-sessions/:runSessionId/input`

Body:

```json
{
  "message": "Use the simpler migration path and continue.",
  "target_turn_id": "optional-active-turn"
}
```

The API derives the actor from authenticated context where available, validates permission, creates a durable pending `input` command, appends a `user_input` event with command metadata, and then notifies the worker if one is connected. If the P0 demo accepts `actor_id` in the body to match existing endpoints, the implementation must keep that clearly scoped as demo identity and not rely on it for production authorization semantics.

### 11.5 Operator Controls

Add:

- `POST /run-sessions/:runSessionId/cancel`
- `POST /run-sessions/:runSessionId/resume`

Cancel creates a durable pending `cancel` command and requests graceful stop. Resume creates a durable pending `resume` command and asks the worker to re-enter the recovery flow for a stalled run.

## 12. Web UI

Add a Run Console area to the existing workbench.

### 12.1 Layout

The console shows:

- run status
- driver kind
- dangerous/yolo mode
- worker lease state
- Codex thread id
- active turn id
- last event age
- current plan step if available
- live event stream
- input box
- cancel/resume controls

### 12.2 Event Rendering

Default rendering is structured:

- Agent messages as readable text.
- Tool calls and commands as collapsible rows.
- Command output deltas as terminal-style excerpts.
- Warnings highlighted.
- Heartbeats shown compactly or hidden by default.
- Raw logs are not linked in the first UI. The UI can show sanitized excerpts from normalized events.

### 12.3 Reconnect

The client tracks the last event cursor. On SSE disconnect, it reconnects with `after=<cursor>`. The API must backfill missed events before live streaming new ones.

## 13. Executor Result Integration

The terminal evidence flow remains compatible with the current contract:

1. Codex reaches a terminal turn state or is cancelled/failed.
2. The worker captures changed files and diff from the run worktree.
3. The worker validates path rules.
4. Required checks run with command-level timeouts.
5. The worker writes artifacts.
6. The worker persists `ExecutorResult`.
7. The workflow or equivalent package-run finalizer creates the Review Packet for successful runs.

The finalizer must be idempotent because worker recovery can retry after partial persistence.

## 14. Testing Strategy

### 14.1 Unit Tests

- `CodexEventNormalizer` converts app-server notifications into stable `RunEvent` rows.
- Fallback JSONL parser handles thread, turn, item, warning, command, and final events.
- Redaction and truncation are applied before public event persistence.
- Run status transition rules accept new non-terminal states and reject invalid terminal reversals.
- Worker lease claim, heartbeat, expiry, and takeover are deterministic.
- Run command inbox claim/apply/fail/supersede behavior is idempotent.

### 14.2 Integration Tests

- Fake app-server emits a long event stream while the API exposes live events before terminal result.
- SSE reconnect with cursor backfills missed events.
- Run enters `waiting_for_input`; user input routes to active `turn/steer`.
- If active turn is unavailable, user input starts a continuation turn on the same thread or uses exec fallback.
- User input submitted while no worker is connected remains pending and is applied after worker recovery.
- Retried input commands are not injected twice into the same Codex turn.
- Worker restart can reclaim the lease and resume from persisted metadata.
- A process exit without terminal evidence becomes `stalled` or `failed`, never fake success.
- Source repo mutations outside `.worktrees/<run-session-id>` are detected and fail the run with operator attention.
- Required checks retain command timeout behavior.

### 14.3 Web Tests

- Run Console appends events without losing order.
- Reconnect uses the latest cursor.
- Waiting-for-input state enables the input box for authorized actors.
- Command output excerpts are visually contained and do not break layout.

### 14.4 Dogfood Acceptance

Dogfood must prove:

- A local Codex run emits visible Web events while still running.
- At least one run shows command output or agent message before terminal result.
- A simulated user-input pause can be continued from the Web UI.
- A simulated worker restart does not lose prior events.
- Final diff, checks, artifacts, and Review Packet still work.

## 15. Rollout

### 15.1 First Slice

- Add data model and repository support for `RunEvent`, runtime metadata, and worker lease.
- Add durable storage support for run state, run dispatch, run events, worker leases, and run command inbox records; in-memory storage is test/demo-only for these flows.
- Add app-server driver with fake-driver tests first.
- Add asynchronous run command behavior.
- Add event backfill and SSE endpoints.
- Add Web Run Console.
- Add fallback exec/resume driver.
- Wire local Codex executor into the worker path.

### 15.2 Deferred Enhancements

- Strong checkpoint protocol.
- Multi-machine worker scheduling.
- Rich Trace / Evidence Plane integration.
- User comments and discussion threads around input requests.
- More granular permission policy.
- App-server protocol version negotiation beyond basic preflight.

## 16. Open Risks

- Codex app-server is currently marked experimental. The driver boundary and exec fallback reduce but do not remove this risk.
- Effective yolo/dangerous behavior differs between app-server protocol and exec flags. Preflight must record and validate the actual mode.
- Live subagent continuity is best effort. If the app-server process dies, the system resumes from thread transcript and worktree rather than from in-memory subagent state.
- Long raw logs can grow quickly. Retention and truncation policies are required before broad usage.
- Secrets can appear in command output. Redaction must happen before public normalized event persistence, and raw artifacts must remain hidden from the first Web UI until explicit access controls exist.

## 17. Acceptance Criteria

This design is implemented when:

- Run command returns immediately with `run_session_id`.
- Web UI shows live normalized Codex output while the run is active.
- Run events are persisted and can be backfilled by cursor.
- SSE reconnect does not lose events.
- User can send a continuation instruction from Web.
- Active app-server turns use steer when available.
- Fallback resume is available and visibly labeled.
- `timeout_seconds` is no longer the primary Codex-main-run stuck detector.
- Worker lease prevents duplicate active drivers for one RunSession.
- Worker restart can recover or mark the run stalled without losing prior events.
- Codex runs in `.worktrees/<run-session-id>` using effective yolo/dangerous mode.
- Terminal evidence and Review Packet generation still pass existing P0 acceptance.
