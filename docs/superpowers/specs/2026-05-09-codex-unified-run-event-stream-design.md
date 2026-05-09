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

- Serves historical backfill for a `RunSession`.
- Serves SSE for live delivery.
- Respects a caller-provided `after` cursor.
- Falls back to the server-known cursor when the client does not provide one.

`apps/web`

- Opens an SSE stream for live output.
- Backfills from the latest known cursor before or during reconnect.
- Renders a compact, readable event timeline.

CLI consumer

- Uses the same API shape as the Web client.
- Tails the same event envelope.
- Does not require a separate transport or event format.

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

Phase 1 does not need to implement the full write path for these states, but the event model should not block them.

### 6.3 Hidden by Default

These should stay out of the default user-facing stream:

- Heartbeat noise.
- Lease internals.
- Low-level transport chatter.
- Other operational details that do not help a user understand progress.

The data can still exist durably for diagnostics, but the default render path should stay focused.

## 7. Reconnect and Backfill

Reconnect behavior should be deterministic and cheap.

- The client stores the most recent confirmed cursor.
- A reconnect uses `after=<cursor>` to continue from that point.
- If the client has no cursor, the server uses its stored `last_event_cursor` when available.
- If no stored cursor exists, the server can backfill the full visible history for the run.
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
- reserved input semantics in the schema

### Phase 2

Add the write path:

- user input commands
- steering into active turns when available
- queued command persistence
- `waiting_for_input` and related operational transitions as first-class write-side behavior

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

