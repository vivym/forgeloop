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

- Do not expand or redesign the active user-input write path in this phase. Existing input, cancel, and resume endpoints may continue to produce public events, but this phase only standardizes how readers consume those events.
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
- In phase 1, backfill is single-shot: without `after`, it returns the full public event history for the run; with `after`, it returns public events strictly after that cursor.
- `has_more` is always `false`, and `next_cursor` is the durable stream high-watermark for the query, even when `events` is empty. If the stream has no durable events yet, return a beginning-of-stream sentinel cursor that can safely be used as `after` for the live subscription.
- Serves SSE for live delivery; when `after` is present, it resumes from that cursor, and when `after` is omitted it starts from the current live tail.
- Starting from the current live tail means the SSE subscription establishes its baseline at the latest durable cursor at connection open and only emits later events.
- Respects a caller-provided `after` cursor for both reads.
- Treats `last_event_cursor` as a live-tail recovery hint only; it must not be used to truncate the initial backfill history.

`apps/web`

- Opens a backfill request first, records the returned `next_cursor`, then opens an SSE stream with `after=<next_cursor>`.
- Omits `after` only when intentionally tailing from the current live tail and accepting that earlier output is not part of that subscription.
- Updates its confirmed cursor from the backfill `next_cursor`, then after every successfully processed SSE event.
- Uses the latest confirmed cursor as the `after` value for subsequent reconnects.
- If the client loses its local cursor, it performs a fresh backfill instead of relying on `last_event_cursor` to skip history.
- Renders a compact, readable event timeline.

CLI consumer

- Uses the same API shape as the Web client.
- Tails the same event envelope.
- Does not require a separate transport or event format.
- Follows the same backfill-first, confirmed-cursor update sequence as the Web client.
- Uses the same auth/stream-token flow as the Web client for the same user context: each SSE connection mints a short-lived stream token, and reconnects mint a fresh token when needed. It does not introduce a CLI-specific read protocol.
- In phase 1, CLI means a developer-facing tail command or script in this repository, not a separately distributed product binary.

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

These input-adjacent names are reserved so phase 2 can reuse the same stream contract:

- `waiting_for_input`
- `user_input`
- `steer_requested`
- `steer_applied`
- `command_queued`
- `command_acked`

`waiting_for_input` is a single persisted event kind. Phase 1 may emit it as a read-side observation when a run pauses for user attention; Phase 2 may also emit the same kind as part of the write-side input flow. Consumers treat it the same way in both phases.

`user_input` already exists in the current write path. Phase 1 must consume and render existing `user_input` events without expanding or redesigning input delivery.

`steer_requested`, `steer_applied`, `command_queued`, and `command_acked` are phase-2 write-side semantics. Phase 1 should document the names as reserved only; it should not add them to the emitted event contract or produce them as first-class events.

### 6.3 Hidden by Default

These should stay out of the default user-facing stream:

- Heartbeat noise.
- Lease internals.
- Low-level transport chatter.
- Other operational details that do not help a user understand progress.

The data can still exist durably for diagnostics, but the default render path should stay focused.

`visibility: "public"` remains a redaction and authorization boundary. It is not the same as "show by default." Phase 1 should implement a shared renderer classifier over `event_type` and `visibility`; it should not add a second persisted visibility field unless planning proves the current event vocabulary is insufficient. Web and CLI may coalesce or hide public-but-low-signal events without making them internal.

## 7. Reconnect and Backfill

Reconnect behavior should be deterministic and cheap.

- The client first performs an initial backfill without `after` to load the full public event history for the run.
- The client records the backfill response `next_cursor` even when no events are returned and uses it as the initial SSE `after` cursor, avoiding a gap between the backfill response and the live subscription.
- The client updates its confirmed cursor from each successful backfill response `next_cursor`, then after every successfully processed SSE event.
- A reconnect uses `after=<cursor>` to continue from that point when the client still has its cursor.
- If the client has lost its cursor after a disconnect, the server-stored `last_event_cursor` is a recovery hint for live-tail bookkeeping only; it must not truncate the initial history load.
- The server must not emit the same cursor more than once within a single list response or SSE subscription.
- Cross-reconnect overlap is expected when a client reconnects with a stale cursor; clients are responsible for merging that overlap by cursor.
- Clients must also merge events by cursor, not only by id, because reconnects can replay already-rendered events when a client reconnects with a stale cursor.

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

The public event stream means events the current caller is authorized to read after redaction, currently represented by `visibility: "public"`. The default visible timeline means the subset or coalesced view of that public stream that the shared renderer classifier treats as user-facing. API backfill and SSE deliver the public stream; Web and CLI render the default visible timeline.

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
- standardized `user_input` write-side semantics, plus `steer_requested`, `steer_applied`, `command_queued`, and `command_acked` as first-class write-side behaviors
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
- Initial backfill loads the full public event history for a run and returns a usable `next_cursor` high-watermark even when no events are returned, including the empty-stream sentinel case.
- Web and CLI open live SSE with the backfill `next_cursor` as `after`; SSE without `after` starts from the live tail at connection open and is not the normal backfill-to-live path.
- Reconnects resume from the latest client-confirmed cursor when available and do not rely on `last_event_cursor` to skip initial history.
- Server responses and live streams do not duplicate a cursor within a single response/subscription, and Web/CLI clients merge by cursor across reconnects.
- Web and CLI use the same backfill-first sequence and the same short-lived SSE stream-token flow.
- Web and CLI share a renderer classifier over `event_type` and `visibility` so the default stream stays focused on user-comprehensible output.
- Existing `user_input` events remain consumable in phase 1 without expanding the input write path.
- Phase-2-only steering and command event names are reserved in the design but are not added to the phase-1 emitted event contract.
