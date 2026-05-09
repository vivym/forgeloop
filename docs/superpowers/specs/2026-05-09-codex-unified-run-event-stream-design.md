# Codex Unified Run Event Stream Design

## 1. Purpose

Forgeloop needs a single canonical event stream for long-running Codex runs.

The goal is to make a `RunSession` observable while it is still running, recoverable after reconnects, and readable from both the Web UI and the CLI. The first phase of this work focuses on read paths only: live output, backfill, and replay. The input path is intentionally reserved for a second phase, but the event model must already be shaped so that input does not force a redesign later.

This design builds on the existing long-running execution model:

```text
RunSession
  -> append-only RunEvent stream
  -> cursor-based backfill
  -> SSE live delivery
  -> Web / CLI consumers
```

## 2. Goals

- Make a `RunSession` the canonical unit for live output and replay.
- Show Codex output in real time in the Web UI.
- Let the CLI tail the same event stream without inventing a separate protocol.
- Support reconnects and refreshes without losing already-seen output.
- Preserve a stable `cursor` so clients can resume from the last confirmed position.
- Keep the visible stream focused on user-comprehensible output and state.
- Reserve input-related semantics in the event model so the later write path can reuse the same stream.

## 3. Non-Goals

- Do not implement the active user-input write path in this phase.
- Do not build a general-purpose event broker or message bus.
- Do not guarantee byte-for-byte replay of raw app-server notifications.
- Do not expose heartbeat noise, lease internals, or command plumbing in the default user-facing stream.
- Do not switch the canonical unit away from `RunSession` to `WorkItem`.
- Do not require full replay from task start on every reconnect.

## 4. Recommended Approach

Use the existing `RunSession` / `RunEvent` model as the canonical stream and make it the shared read path for Web and CLI.

### 4.1 Options

#### A. Read stream first, reserve input semantics

This is the recommended approach.

The implementation hardens the current append-only event stream, backfill, and SSE delivery. It keeps the read path stable while reserving event kinds and runtime metadata for future input and steering. The stream stays centered on `RunSession`, and `WorkItem` remains a derived aggregate view.

#### B. Read stream and input together

This would produce a more complete user loop in one release, but it increases scope materially. Input adds authorization, command queuing, turn/steer integration, and new failure modes. Doing that in the same phase would make it harder to stabilize the stream contract itself.

#### C. Generic broker first

This is the largest option. It would introduce an extra abstraction before the product needs it and would delay the user-visible benefit.

## 5. Architecture

### 5.1 Canonical Shape

`RunSession` is the source of truth.

- One run, one canonical stream.
- Every event has a monotonic cursor.
- The stream is append-only.
- `WorkItem` views are derived from one or more `RunSession` streams, not the other way around.

### 5.2 Producers

The worker normalizes execution signals into `RunEvent` rows.

Inputs to the stream include:

- Codex app-server notifications.
- Fallback `codex exec` JSONL.
- Worker state transitions.
- Important progress milestones.

The worker does not need to preserve raw transport details in the public stream. It only needs to preserve enough metadata to support replay, debugging, and future input handling.

### 5.3 Consumers

`apps/control-plane-api`

- Serves historical backfill for a `RunSession` using the existing `events`, `next_cursor`, and `has_more` response shape.
- In phase 1, backfill is single-shot and returns the full visible history for the run; `has_more` is always `false`, and `next_cursor` is set to the last visible event cursor when events exist.
- Serves SSE for live delivery; when `after` is present, it resumes from that cursor, and when `after` is omitted it starts from the current live tail.
- Respects a caller-provided `after` cursor for both reads.
- Treats `last_event_cursor` as a live-tail recovery hint only; it must not be used to truncate the initial backfill history.

`apps/web`

- Opens a backfill request first, then an SSE stream for live output.
- Updates its confirmed cursor after every successfully processed backfill or SSE event.
- Uses the latest confirmed cursor as the `after` value for subsequent reconnects.
- If the client loses its local cursor, it performs a fresh backfill instead of relying on `last_event_cursor` to skip history.
- Renders a compact, readable event timeline.

CLI consumer

- Uses the same API shape as the Web client.
- Tails the same event envelope.
- Does not require a separate transport or event format.
- Uses the same auth/stream-token flow as the Web client for the same user context: each SSE connection mints a short-lived stream token, and reconnects mint a fresh token when needed. It does not introduce a CLI-specific read protocol.

## 6. Event Model

The stream should keep a small, stable event vocabulary.

### 6.1 Visible Event Classes

These are the default user-visible classes for phase 1:

- Codex output.
- Status changes.
- Progress milestones.
- User-facing warnings.
- Waiting or blocked states that explain why the run is paused.

### 6.2 Reserved Input Semantics

These kinds are reserved in the model so phase 2 can reuse the same stream contract:

- `waiting_for_input`
- `user_input`
- `steer_requested`
- `steer_applied`
- `command_queued`
- `command_acked`

`waiting_for_input` is a single persisted event kind. Phase 1 may emit it as a read-side observation when a run pauses for user attention; Phase 2 may also emit the same kind as part of the write-side input flow. Consumers treat it the same way in both phases.

The other reserved kinds are phase-2 write-side semantics and must not appear as first-class emitted events in phase 1.

### 6.3 Hidden by Default

These should stay out of the default user-facing stream:

- Heartbeat noise.
- Lease internals.
- Low-level transport chatter.
- Other operational details that do not help a user understand progress.

The data can still exist durably for diagnostics, but the default render path should stay focused.

## 7. Reconnect and Backfill

Reconnect behavior should be deterministic and cheap.

- The client first performs an initial backfill without `after` to load the full visible history for the run.
- The client updates its confirmed cursor after every successfully processed backfill or SSE event.
- A reconnect uses `after=<cursor>` to continue from that point when the client still has its cursor.
- If the client has lost its cursor after a disconnect, the server-stored `last_event_cursor` is a recovery hint for live-tail bookkeeping only; it must not truncate the initial history load.
- The server must dedupe by cursor so repeated reconnects do not duplicate visible output.

This gives the user a stable “continue from where I left off” experience without forcing every reconnect to replay hours of old output.

## 8. Visibility and Redaction

The default user-facing stream should show output that helps answer:

- What is the run doing?
- Is it making progress?
- Did it ask for help?
- Did it stall?
- Did it finish?

The default stream should not show:

- raw JSONL
- low-level app-server notices
- lease internals
- other implementation details that are only useful for debugging

This is the same principle used elsewhere in Forgeloop: keep the public surface comprehensible, and keep raw internals available only where they are explicitly needed.

## 9. Phase Split

This design intentionally splits the work into two phases.

### Phase 1

Deliver the canonical read stream:

- backfill by cursor
- SSE live output
- Web rendering
- CLI tailing
- stable visible event vocabulary
- `waiting_for_input` as the shared event kind for a paused run

### Phase 2

Add the write path:

- user input commands
- steering into active turns when available
- queued command persistence
- `user_input`, `steer_requested`, `steer_applied`, `command_queued`, and `command_acked` as first-class write-side behaviors
- `waiting_for_input` as the same event kind emitted by the write-side input flow when a run pauses for operator attention

The key constraint is that Phase 2 should extend the Phase 1 contract, not replace it.

## 10. Failure Modes

- If SSE disconnects, the client should reconnect with the last confirmed cursor.
- If the worker restarts, the run should continue from durable event state, not from memory.
- If the client misses events, the backfill endpoint should close the gap.
- If the worker cannot emit a normalized event, it should still preserve enough state for diagnosis and recovery.

## 11. Acceptance Criteria

This design is done when:

- `RunSession` is the canonical stream center.
- Web and CLI consume the same event envelope.
- Live delivery works through SSE.
- Backfill works through cursor-based replay.
- Reconnects do not require full replay every time.
- The default stream stays focused on user-comprehensible output.
- The event model is already ready for later input/steering work.
