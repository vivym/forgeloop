# Codex Unified Run Event Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing `RunSession` event stream the shared, lossless read path for Web and a repo-local CLI tail command, with deterministic backfill, SSE reconnects, cursor merging, and a shared user-facing renderer classifier.

**Architecture:** Keep `RunSession` / `RunEvent` as the canonical durable stream and avoid adding a new broker. The API returns public event backfill plus a durable high-watermark cursor, SSE uses the same cursor contract, Web and CLI both run backfill-first then tail with short-lived stream tokens, and a shared classifier decides what belongs in the default user-facing timeline.

**Tech Stack:** TypeScript, pnpm workspaces, NestJS, RxJS, Zod contracts, React/Vite, Node fetch/Web Streams, Server-Sent Events, Vitest, Supertest, Playwright E2E.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-05-09-codex-unified-run-event-stream-design.md`
- Related previous plan: `docs/superpowers/plans/2026-05-07-codex-long-running-execution.md`
- Relevant implementation skills: @superpowers:subagent-driven-development, @superpowers:executing-plans, @superpowers:test-driven-development, @superpowers:systematic-debugging, @superpowers:verification-before-completion

## Closure Status

Updated: 2026-05-09

This plan was implemented across later commits and verified in `docs/superpowers/reports/codex-unified-run-event-stream-closure-report.md`.

Status summary:

- Phase 1 read stream is implemented: required backfill `next_cursor`, live-tail SSE baseline, Web backfill-first reconnect flow, shared timeline classifier, and repo-local `tail:run-events` command.
- Focused verification passed on 2026-05-09: `pnpm test tests/contracts/run-events.test.ts tests/contracts/run-event-rendering.test.ts tests/api/run-events.test.ts tests/web/api.test.ts tests/web/run-console-state.test.ts tests/smoke/tail-run-events-script.test.ts tests/e2e/run-console.e2e.test.ts`.
- Phase 2 input/steering semantics remain intentionally out of scope. Existing `user_input` and `waiting_for_input` events are consumable; `steer_requested`, `steer_applied`, `command_queued`, and `command_acked` were not added as phase-1 emitted events.
- Durable revision lookup work is tracked separately in `docs/superpowers/specs/2026-05-09-p0-durable-revision-lookup-design.md`; do not infer any revision lookup task from this stream plan.

Do not infer open product scope from unchecked historical boxes below without checking the closure report and current tests.

## Baseline

This plan was written in a clean worktree:

```bash
/Users/viv/projs/forgeloop/.worktrees/codex-unified-run-event-stream-plan
```

Baseline setup and tests:

```bash
pnpm install
pnpm test
```

Expected current baseline: `Test Files 42 passed (42)` and `Tests 487 passed (487)`.

## Scope Guardrails

- Phase 1 is read-path only. Do not expand the input, cancel, or resume write path.
- Do not add `steer_requested`, `steer_applied`, `command_queued`, or `command_acked` to the phase-1 emitted event contract.
- Existing `waiting_for_input` and `user_input` events must remain consumable and renderable.
- API backfill and SSE deliver the public event stream. Web and CLI use a shared classifier to render the default visible timeline.
- `visibility: "public"` is an authorization/redaction boundary, not the same as "always show this row."
- Do not rely on `RunSession.runtime_metadata.last_event_cursor` to skip initial backfill history.
- Do not use `EventSource` for the Node CLI tail script; Node's built-in `fetch` plus Web Stream reader is enough and keeps the script dependency-free.
- Keep `.worktrees/` ignored. Do not touch unrelated dirty files in the original checkout.

## File Structure

- Modify `packages/contracts/src/api.ts`
  - Owns public event DTOs. Make `RunEventListResponse.next_cursor` required because the API must return a usable high-watermark cursor even when no public events are returned.
- Create `packages/contracts/src/run-event-rendering.ts`
  - Owns the shared default timeline classifier and compact event formatting primitives used by Web and CLI.
- Modify `packages/contracts/src/index.ts`
  - Exports the new rendering helper.
- Modify `apps/control-plane-api/src/p0/p0.service.ts`
  - Owns high-watermark cursor calculation, beginning-of-stream sentinel, list response semantics, and SSE live-tail baseline semantics.
- Modify `apps/web/src/api.ts`
  - Reflects required `next_cursor`, keeps stream token flow unchanged, and builds query strings using explicit `undefined` checks.
- Modify `apps/web/src/workbenchState.ts`
  - Owns cursor-based event merge, next-cursor helper, and default timeline filtering via the shared classifier.
- Modify `apps/web/src/App.tsx`
  - Owns the backfill-first Web flow: record backfill `next_cursor`, open SSE with `after=<next_cursor>`, reconnect with confirmed cursor, and render classifier-filtered events.
- Create `scripts/tail-run-events.ts`
  - Repo-local developer CLI tail command. It performs backfill, records `next_cursor`, mints stream tokens, opens SSE with `after`, renders classifier-visible events, and reconnects with the latest confirmed cursor.
- Modify `package.json`
  - Adds a repo-local script entry for the tail command.
- Modify or create tests:
  - `tests/contracts/run-events.test.ts`
  - `tests/contracts/run-event-rendering.test.ts`
  - `tests/api/run-events.test.ts`
  - `tests/web/api.test.ts`
  - `tests/web/run-console-state.test.ts`
  - `tests/e2e/run-console.e2e.test.ts`
  - `tests/smoke/tail-run-events-script.test.ts`

## Task 1: Contract and API Backfill Cursor Semantics

**Files:**
- Modify: `packages/contracts/src/api.ts`
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
- Test: `tests/contracts/run-events.test.ts`
- Test: `tests/api/run-events.test.ts`

- [ ] **Step 1: Write failing contract tests for required `next_cursor`**

In `tests/contracts/run-events.test.ts`, extend `parses run event list responses`:

```ts
it('requires a next cursor on run event list responses', () => {
  expect(
    runEventListResponseSchema.safeParse({
      events: [],
      has_more: false,
    }).success,
  ).toBe(false);

  const parsed = runEventListResponseSchema.parse({
    events: [],
    next_cursor: '0000000000',
    has_more: false,
  });

  expect(parsed.next_cursor).toBe('0000000000');
  expect(parsed.has_more).toBe(false);
});
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run:

```bash
pnpm vitest run tests/contracts/run-events.test.ts -t "requires a next cursor"
```

Expected: FAIL because `next_cursor` is currently optional.

- [ ] **Step 3: Make `next_cursor` required in the contract**

In `packages/contracts/src/api.ts`, change:

```ts
next_cursor: z.string().min(1).optional(),
```

to:

```ts
next_cursor: z.string().min(1),
```

- [ ] **Step 4: Run the contract test and verify it passes**

Run:

```bash
pnpm vitest run tests/contracts/run-events.test.ts -t "requires a next cursor"
```

Expected: PASS.

- [ ] **Step 5: Add an empty-run fixture helper**

In `tests/api/run-events.test.ts`, add a helper near the existing `track()` helper. This avoids reaching into private repository state:

```ts
async function seedEmptyRunSession(): Promise<{ app: INestApplication; repo: InMemoryP0Repository; runSessionId: string }> {
  const seeded = await seedAppWithRunSession();
  const source = await seeded.repo.getRunSession(seeded.runSessionId);
  const runSessionId = 'run-session-empty';
  await seeded.repo.saveRunSession({ ...source!, id: runSessionId });
  expect(await seeded.repo.listRunEvents(runSessionId)).toEqual([]);
  return { ...seeded, runSessionId };
}
```

Add these imports if they are not already present:

```ts
import type { InMemoryP0Repository } from '../../packages/db/src';
```

- [ ] **Step 6: Write failing API tests for high-watermark cursor responses**

In `tests/api/run-events.test.ts`, add tests near the existing backfill tests:

```ts
it('returns a beginning cursor when a run has no durable events after filtering', async () => {
  const { app, runSessionId } = await track(seedEmptyRunSession());

  const response = await request(app.getHttpServer())
    .get(`/run-sessions/${runSessionId}/events`)
    .query({ actor_id: 'actor-owner' })
    .expect(200);

  expect(response.body).toMatchObject({
    events: [],
    next_cursor: '0000000000',
    has_more: false,
  });
});
```

Add another test for durable high-watermark with internal trailing events:

```ts
it('returns the latest durable cursor as next_cursor even when the last event is internal', async () => {
  const { app, runSessionId, repo } = await track(seedAppWithRunSession());
  const internal = await repo.appendRunEvent({
    id: 'run-event-internal-tail',
    run_session_id: runSessionId,
    event_type: 'watchdog_heartbeat',
    source: 'watchdog',
    visibility: 'internal',
    summary: 'Internal heartbeat.',
    payload: {},
    created_at: '2026-05-07T00:01:00.000Z',
  });

  const response = await request(app.getHttpServer())
    .get(`/run-sessions/${runSessionId}/events`)
    .query({ actor_id: 'actor-owner' })
    .expect(200);

  expect(response.body.next_cursor).toBe(internal.cursor);
  expect(response.body.events.some((event: { id: string }) => event.id === internal.id)).toBe(false);
});
```

- [ ] **Step 7: Run the API tests and verify they fail**

Run:

```bash
pnpm vitest run tests/api/run-events.test.ts -t "next_cursor|beginning cursor|latest durable cursor"
```

Expected: FAIL because `listRunEvents()` currently omits `next_cursor` when no public events are returned and uses the last public event cursor instead of the durable high-watermark.

- [ ] **Step 8: Implement response cursor helper**

In `apps/control-plane-api/src/p0/p0.service.ts`, add near `streamPollMs`:

```ts
const beginningRunEventCursor = '0000000000';
```

Add a private helper near `publicRunEvents()`:

```ts
private runEventResponseCursor(queriedEvents: RunEvent[], floorCursor?: string): string {
  return queriedEvents.at(-1)?.cursor ?? floorCursor ?? beginningRunEventCursor;
}
```

Do not call `getLatestRunEvent()` here. `next_cursor` must be derived from the raw event set returned by the same list query, or from the caller's `after` floor when the query returned no rows. A later latest-cursor lookup is not safe because a concurrent append between the list query and lookup could advance `next_cursor` beyond an event that was not included in `events`.

Update `listRunEvents()`:

```ts
const rawEvents = await this.repository.listRunEvents(runSessionId, options.after === undefined ? {} : { after: options.after });
const events = this.publicRunEvents(rawEvents);
return {
  events,
  next_cursor: this.runEventResponseCursor(rawEvents, options.after),
  has_more: false,
};
```

- [ ] **Step 9: Run targeted tests**

Run:

```bash
pnpm vitest run tests/contracts/run-events.test.ts tests/api/run-events.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add packages/contracts/src/api.ts apps/control-plane-api/src/p0/p0.service.ts tests/contracts/run-events.test.ts tests/api/run-events.test.ts
git commit -m "feat: return run event high-watermark cursors"
```

## Task 2: SSE Live-Tail Baseline and Single-Subscription Cursor Boundaries

**Files:**
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
- Test: `tests/api/run-events.test.ts`

- [ ] **Step 1: Write failing service-level SSE tests**

In `tests/api/run-events.test.ts`, add:

```ts
it('starts SSE without after at the live tail instead of replaying history', async () => {
  const { app, runSessionId, repo } = await track(seedAppWithRunSession());
  const service = app.get(P0Service);
  const observable = await service.streamRunEvents(runSessionId, { actorId: 'actor-owner' });
  const seen: unknown[] = [];
  const subscription = observable.subscribe((event) => seen.push(event.data));

  await new Promise((resolve) => setTimeout(resolve, 2 * 500));
  expect(seen).toEqual([]);

  const live = await repo.appendRunEvent({
    id: 'run-event-live-after-subscribe',
    run_session_id: runSessionId,
    event_type: 'agent_message_delta',
    source: 'codex',
    visibility: 'public',
    summary: 'Live output.',
    payload: { text: 'hello after subscribe' },
    created_at: '2026-05-07T00:02:00.000Z',
  });

  await eventually(() => {
    expect(seen).toEqual([expect.objectContaining({ id: live.id, cursor: live.cursor })]);
  });

  subscription.unsubscribe();
});
```

Add this import:

```ts
import { P0Service } from '../../apps/control-plane-api/src/p0/p0.service';
```

Add this helper at file scope if no equivalent exists:

```ts
async function eventually(assertion: () => void, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError;
}
```

Also add:

```ts
it('resumes SSE strictly after the provided cursor', async () => {
  const { app, runSessionId, repo } = await track(seedAppWithRunSession());
  const first = await repo.appendRunEvent({
    id: 'run-event-before-after',
    run_session_id: runSessionId,
    event_type: 'agent_message_delta',
    source: 'codex',
    visibility: 'public',
    summary: 'Before cursor.',
    payload: { text: 'before' },
    created_at: '2026-05-07T00:02:00.000Z',
  });
  const second = await repo.appendRunEvent({
    id: 'run-event-after-after',
    run_session_id: runSessionId,
    event_type: 'agent_message_delta',
    source: 'codex',
    visibility: 'public',
    summary: 'After cursor.',
    payload: { text: 'after' },
    created_at: '2026-05-07T00:03:00.000Z',
  });

  const service = app.get(P0Service);
  const observable = await service.streamRunEvents(runSessionId, { actorId: 'actor-owner', after: first.cursor });
  const seen: unknown[] = [];
  const subscription = observable.subscribe((event) => seen.push(event.data));

  await eventually(() => {
    expect(seen).toEqual([expect.objectContaining({ id: second.id, cursor: second.cursor })]);
  });

  subscription.unsubscribe();
});
```

- [ ] **Step 2: Run tests and verify the first one fails**

Run:

```bash
pnpm vitest run tests/api/run-events.test.ts -t "SSE"
```

Expected: the no-`after` live-tail test FAILS because current SSE replays existing history.

- [ ] **Step 3: Implement the live-tail baseline**

In `apps/control-plane-api/src/p0/p0.service.ts`, add a separate live-tail helper near `runEventResponseCursor()`:

```ts
private async currentRunEventTailCursor(runSessionId: string): Promise<string> {
  return (await this.repository.getLatestRunEvent(runSessionId))?.cursor ?? beginningRunEventCursor;
}
```

This helper is only for the explicit "tail from now" SSE mode. It must not be used for backfill response `next_cursor`.

Then update `streamRunEvents()` before constructing the `Observable`:

```ts
const initialCursor = options.after ?? (await this.currentRunEventTailCursor(runSessionId));
```

Then change:

```ts
let cursor = options.after;
```

to:

```ts
let cursor = initialCursor;
```

The first poll will now call `listRunEvents(runSessionId, { after: initialCursor })`, so it only emits events after the connection-open baseline.

- [ ] **Step 4: Run targeted API tests**

Run:

```bash
pnpm vitest run tests/api/run-events.test.ts -t "SSE|backfills|omits internal|next_cursor"
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/control-plane-api/src/p0/p0.service.ts tests/api/run-events.test.ts
git commit -m "feat: start run event SSE from live tail"
```

## Task 3: Shared Default Timeline Classifier

**Files:**
- Create: `packages/contracts/src/run-event-rendering.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/web/src/workbenchState.ts`
- Modify: `apps/web/src/App.tsx`
- Test: `tests/contracts/run-event-rendering.test.ts`
- Test: `tests/web/run-console-state.test.ts`

- [ ] **Step 1: Write failing classifier tests**

Create `tests/contracts/run-event-rendering.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { classifyRunEventForTimeline, renderableRunEvents } from '@forgeloop/contracts';

describe('run event timeline rendering classifier', () => {
  it('hides internal events and low-signal public operational events by default', () => {
    expect(classifyRunEventForTimeline({ event_type: 'agent_message_delta', visibility: 'public' }).mode).toBe('visible');
    expect(classifyRunEventForTimeline({ event_type: 'user_input', visibility: 'public' }).mode).toBe('visible');
    expect(classifyRunEventForTimeline({ event_type: 'waiting_for_input', visibility: 'public' }).mode).toBe('visible');
    expect(classifyRunEventForTimeline({ event_type: 'watchdog_heartbeat', visibility: 'public' }).mode).toBe('hidden');
    expect(classifyRunEventForTimeline({ event_type: 'worker_lease_acquired', visibility: 'public' }).mode).toBe('hidden');
    expect(classifyRunEventForTimeline({ event_type: 'agent_message_delta', visibility: 'internal' }).mode).toBe('hidden');
  });

  it('filters renderable events without changing the public stream contract', () => {
    const events = [
      { id: 'event-1', event_type: 'watchdog_heartbeat', visibility: 'public' },
      { id: 'event-2', event_type: 'agent_message_completed', visibility: 'public' },
    ];

    expect(renderableRunEvents(events).map((event) => event.id)).toEqual(['event-2']);
  });
});
```

- [ ] **Step 2: Run classifier tests and verify they fail**

Run:

```bash
pnpm vitest run tests/contracts/run-event-rendering.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement classifier helper**

Create `packages/contracts/src/run-event-rendering.ts`:

```ts
import type { RunEventType, RunEventVisibility } from './api.js';

export type TimelineRenderMode = 'visible' | 'hidden';

export type TimelineClassifiableRunEvent = {
  event_type?: RunEventType | string;
  visibility?: RunEventVisibility | string;
};

export type TimelineClassification = {
  mode: TimelineRenderMode;
  reason?: 'internal' | 'low_signal';
};

const lowSignalTimelineEventTypes = new Set<string>(['watchdog_heartbeat', 'worker_lease_acquired']);

export const classifyRunEventForTimeline = (event: TimelineClassifiableRunEvent): TimelineClassification => {
  if (event.visibility !== 'public') return { mode: 'hidden', reason: 'internal' };
  if (event.event_type !== undefined && lowSignalTimelineEventTypes.has(event.event_type)) {
    return { mode: 'hidden', reason: 'low_signal' };
  }
  return { mode: 'visible' };
};

export const renderableRunEvents = <T extends TimelineClassifiableRunEvent>(events: T[]): T[] =>
  events.filter((event) => classifyRunEventForTimeline(event).mode === 'visible');
```

Update `packages/contracts/src/index.ts`:

```ts
export * from './run-event-rendering.js';
```

- [ ] **Step 4: Use the classifier in Web state/UI**

In `apps/web/src/workbenchState.ts`, import and re-export where useful:

```ts
import { renderableRunEvents } from '@forgeloop/contracts';

export { renderableRunEvents };
```

In `apps/web/src/App.tsx`, replace:

```ts
const displayEvents = events.filter((event) => event.event_type !== 'watchdog_heartbeat');
```

with:

```ts
const displayEvents = renderableRunEvents(events);
```

Make sure `renderableRunEvents` is imported from `./workbenchState`.

- [ ] **Step 5: Add Web state regression test**

In `tests/web/run-console-state.test.ts`, add:

```ts
it('uses the shared classifier for default run console timeline events', () => {
  const events = renderableRunEvents([
    { id: 'event-1', sequence: 1, event_type: 'watchdog_heartbeat', visibility: 'public' },
    { id: 'event-2', sequence: 2, event_type: 'worker_lease_acquired', visibility: 'public' },
    { id: 'event-3', sequence: 3, event_type: 'user_input', visibility: 'public' },
    { id: 'event-4', sequence: 4, event_type: 'agent_message_delta', visibility: 'internal' },
  ]);

  expect(events.map((event) => event.id)).toEqual(['event-3']);
});
```

- [ ] **Step 6: Run targeted tests**

Run:

```bash
pnpm vitest run tests/contracts/run-event-rendering.test.ts tests/web/run-console-state.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add packages/contracts/src/run-event-rendering.ts packages/contracts/src/index.ts apps/web/src/workbenchState.ts apps/web/src/App.tsx tests/contracts/run-event-rendering.test.ts tests/web/run-console-state.test.ts
git commit -m "feat: share run event timeline classifier"
```

## Task 4: Web Cursor Merge and Backfill-to-SSE Flow

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/workbenchState.ts`
- Modify: `apps/web/src/App.tsx`
- Test: `tests/web/api.test.ts`
- Test: `tests/web/run-console-state.test.ts`
- Test: `tests/e2e/run-console.e2e.test.ts`

- [ ] **Step 1: Write failing cursor-merge test**

In `tests/web/run-console-state.test.ts`, update the existing duplicate test and add a cursor-specific case:

```ts
it('merges run events by cursor before falling back to id', () => {
  const events = appendRunEvents(
    [{ id: 'event-old-id', sequence: 1, cursor: '0000000001', summary: 'old' }],
    [
      { id: 'event-new-id', sequence: 1, cursor: '0000000001', summary: 'replayed' },
      { id: 'event-2', sequence: 2, cursor: '0000000002', summary: 'next' },
    ],
  );

  expect(events).toEqual([
    expect.objectContaining({ id: 'event-new-id', cursor: '0000000001', summary: 'replayed' }),
    expect.objectContaining({ id: 'event-2', cursor: '0000000002' }),
  ]);
});
```

- [ ] **Step 2: Run state test and verify it fails**

Run:

```bash
pnpm vitest run tests/web/run-console-state.test.ts -t "merges run events by cursor"
```

Expected: FAIL because `appendRunEvents()` currently dedupes by `id`.

- [ ] **Step 3: Implement cursor-first merge**

In `apps/web/src/workbenchState.ts`, replace `appendRunEvents` with:

```ts
const runEventMergeKey = (event: { id: string; cursor?: string }): string => event.cursor ?? `id:${event.id}`;

export const appendRunEvents = <T extends { id: string; sequence: number; cursor?: string }>(current: T[], incoming: T[]): T[] =>
  [...new Map([...current, ...incoming].map((event) => [runEventMergeKey(event), event])).values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
```

- [ ] **Step 4: Make Web API response type require `next_cursor`**

In `apps/web/src/api.ts`, change:

```ts
next_cursor?: string;
```

to:

```ts
next_cursor: string;
```

Also change `runEventsQuery()` from truthy checks to explicit checks:

```ts
if (options.streamToken !== undefined) params.set('stream_token', options.streamToken);
if (options.after !== undefined) params.set('after', options.after);
```

Update `listRunEvents` query building:

```ts
const query = runEventsQuery({ ...(options.after === undefined ? {} : { after: options.after }) });
return request<RunEventListResponse>(
  `/run-sessions/${encodeURIComponent(runSessionId)}/events${query ? `?${query}` : ''}`,
  { actorId: options.actorId },
);
```

- [ ] **Step 5: Write failing API client test for explicit sentinel `after`**

In `tests/web/api.test.ts`, add near other API tests:

```ts
it('includes explicit run event after cursors even for sentinel values', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ events: [], next_cursor: '0000000000', has_more: false }), { status: 200 }));
  const api = createForgeloopApi({ baseUrl: 'http://api.local', fetch: fetchMock });

  await api.listRunEvents('run-1', { actorId: 'actor-owner', after: '0000000000' });

  expect(fetchMock).toHaveBeenCalledWith('http://api.local/run-sessions/run-1/events?after=0000000000', expect.any(Object));
});
```

- [ ] **Step 6: Update Web backfill-to-live cursor flow**

In `apps/web/src/App.tsx`, update `mergeRunEvents` to only merge event arrays:

```ts
const mergeRunEvents = (incoming: RunEvent[]) => {
  setRunEvents((current) => appendRunEvents(current, incoming));
};
```

In `onEvent`, after `mergeRunEvents([event])`, set the confirmed cursor directly:

```ts
runEventCursorRef.current = event.cursor ?? runEventCursorRef.current;
```

In `start()`, replace:

```ts
mergeRunEvents(response.events);
void openStream(nextRunEventCursor(response.events));
```

with:

```ts
mergeRunEvents(response.events);
runEventCursorRef.current = response.next_cursor;
void openStream(response.next_cursor);
```

Keep `nextRunEventCursor()` exported for tests and fallback helpers, but do not use it for the initial backfill-to-live handoff.

- [ ] **Step 7: Update E2E to assert the normal stream URL includes backfill cursor**

In `tests/e2e/run-console.e2e.test.ts`, after the initial rendered cursor assertion, inspect the stream response URL:

```ts
const streamResponse = await streamOpened;
expectValue(streamResponse.url()).toContain(`after=${initialCursor}`);
```

If the API returns a later internal durable high-watermark than the last rendered row, compare against the backfill response cursor instead by intercepting `/events` response in the page route or by adding a helper that fetches `/events` before selecting the run.

- [ ] **Step 8: Run targeted Web tests**

Run:

```bash
pnpm vitest run tests/web/api.test.ts tests/web/run-console-state.test.ts
pnpm vitest run tests/e2e/run-console.e2e.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add apps/web/src/api.ts apps/web/src/workbenchState.ts apps/web/src/App.tsx tests/web/api.test.ts tests/web/run-console-state.test.ts tests/e2e/run-console.e2e.test.ts
git commit -m "feat: bridge web run event backfill to SSE by cursor"
```

## Task 5: Repo-Local CLI Tail Command

**Files:**
- Create: `scripts/tail-run-events.ts`
- Modify: `package.json`
- Test: `tests/smoke/tail-run-events-script.test.ts`

- [ ] **Step 1: Write failing CLI helper tests**

Create `tests/smoke/tail-run-events-script.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import {
  buildBackfillRequest,
  buildStreamTokenRequest,
  buildStreamUrl,
  formatRunEventLine,
  parseTailArgs,
} from '../../scripts/tail-run-events';

describe('tail run events script helpers', () => {
  it('builds the backfill-first and stream-token request flow', () => {
    expect(buildBackfillRequest('http://api.local', 'run-1', { actorId: 'actor-owner' })).toEqual({
      url: 'http://api.local/run-sessions/run-1/events',
      init: { headers: { 'X-Forgeloop-Actor-Id': 'actor-owner' } },
    });
    expect(buildBackfillRequest('http://api.local', 'run-1', { actorId: 'actor-owner', after: '0000000000' }).url).toBe(
      'http://api.local/run-sessions/run-1/events?after=0000000000',
    );
    expect(buildStreamTokenRequest('http://api.local', 'run-1', 'actor-owner')).toEqual({
      url: 'http://api.local/run-sessions/run-1/events/stream-token',
      init: { method: 'POST', headers: { 'content-type': 'application/json', 'X-Forgeloop-Actor-Id': 'actor-owner' } },
    });
    expect(buildStreamUrl('http://api.local', 'run-1', { streamToken: 'token-1', after: '0000000000' })).toBe(
      'http://api.local/run-sessions/run-1/events/stream?stream_token=token-1&after=0000000000',
    );
  });

  it('formats only default timeline events', () => {
    expect(formatRunEventLine({ cursor: '0000000001', event_type: 'watchdog_heartbeat', visibility: 'public', summary: 'tick' })).toBeUndefined();
    expect(
      formatRunEventLine({
        cursor: '0000000002',
        event_type: 'agent_message_delta',
        visibility: 'public',
        summary: 'Codex output.',
        payload: { text: 'hello' },
      }),
    ).toBe('0000000002 agent_message_delta hello');
  });

  it('requires run id and actor id arguments', () => {
    expect(() => parseTailArgs(['--run-session-id', 'run-1'])).toThrow('actor id is required');
    expect(parseTailArgs(['--api-url', 'http://api.local', '--run-session-id', 'run-1', '--actor-id', 'actor-owner'])).toMatchObject({
      apiUrl: 'http://api.local',
      runSessionId: 'run-1',
      actorId: 'actor-owner',
    });
  });
});
```

- [ ] **Step 2: Run CLI tests and verify they fail**

Run:

```bash
pnpm vitest run tests/smoke/tail-run-events-script.test.ts
```

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement request builders and formatting helpers**

Create `scripts/tail-run-events.ts` with these exported helpers:

```ts
import { classifyRunEventForTimeline } from '@forgeloop/contracts';
import { fileURLToPath } from 'node:url';

type TailRunEvent = {
  cursor?: string;
  event_type?: string;
  visibility?: string;
  summary?: string;
  payload?: Record<string, unknown>;
};

type TailOptions = {
  apiUrl: string;
  runSessionId: string;
  actorId: string;
  after?: string;
  once: boolean;
};

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '');

const payloadText = (payload: Record<string, unknown> | undefined, keys: string[]): string | undefined => {
  if (payload === undefined) return undefined;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return undefined;
};

export const buildBackfillRequest = (
  apiUrl: string,
  runSessionId: string,
  options: { actorId: string; after?: string },
): { url: string; init: RequestInit } => {
  const params = new URLSearchParams();
  if (options.after !== undefined) params.set('after', options.after);
  const query = params.toString();
  return {
    url: `${normalizeBaseUrl(apiUrl)}/run-sessions/${encodeURIComponent(runSessionId)}/events${query ? `?${query}` : ''}`,
    init: { headers: { 'X-Forgeloop-Actor-Id': options.actorId } },
  };
};

export const buildStreamTokenRequest = (apiUrl: string, runSessionId: string, actorId: string): { url: string; init: RequestInit } => ({
  url: `${normalizeBaseUrl(apiUrl)}/run-sessions/${encodeURIComponent(runSessionId)}/events/stream-token`,
  init: { method: 'POST', headers: { 'content-type': 'application/json', 'X-Forgeloop-Actor-Id': actorId } },
});

export const buildStreamUrl = (apiUrl: string, runSessionId: string, options: { streamToken: string; after?: string }): string => {
  const params = new URLSearchParams();
  params.set('stream_token', options.streamToken);
  if (options.after !== undefined) params.set('after', options.after);
  return `${normalizeBaseUrl(apiUrl)}/run-sessions/${encodeURIComponent(runSessionId)}/events/stream?${params.toString()}`;
};

export const formatRunEventLine = (event: TailRunEvent): string | undefined => {
  if (classifyRunEventForTimeline(event).mode !== 'visible') return undefined;
  const cursor = event.cursor ?? 'no-cursor';
  const type = event.event_type ?? 'event';
  const text = payloadText(event.payload, ['text', 'message', 'content', 'status', 'reason']) ?? event.summary ?? '';
  return [cursor, type, text].filter(Boolean).join(' ');
};
```

- [ ] **Step 4: Implement argument parsing**

Continue in `scripts/tail-run-events.ts`:

```ts
export const parseTailArgs = (args: string[]): TailOptions => {
  const options: Partial<TailOptions> = {
    apiUrl: process.env.FORGELOOP_API_URL ?? 'http://localhost:3000',
    once: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };
    if (arg === '--api-url') options.apiUrl = next();
    else if (arg === '--run-session-id') options.runSessionId = next();
    else if (arg === '--actor-id') options.actorId = next();
    else if (arg === '--after') options.after = next();
    else if (arg === '--once') options.once = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.runSessionId?.trim()) throw new Error('run session id is required');
  if (!options.actorId?.trim()) throw new Error('actor id is required');

  return {
    apiUrl: normalizeBaseUrl(options.apiUrl ?? 'http://localhost:3000'),
    runSessionId: options.runSessionId,
    actorId: options.actorId,
    ...(options.after === undefined ? {} : { after: options.after }),
    once: options.once ?? false,
  };
};
```

- [ ] **Step 5: Implement backfill-first and SSE tailing**

Add:

```ts
const readJson = async <T>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
};

const emitEvent = (event: TailRunEvent): void => {
  const line = formatRunEventLine(event);
  if (line !== undefined) console.log(line);
};

type EventListResponse = { events: TailRunEvent[]; next_cursor: string; has_more: boolean };

export const runTail = async (options: TailOptions): Promise<void> => {
  const backfillRequest = buildBackfillRequest(options.apiUrl, options.runSessionId, {
    actorId: options.actorId,
    ...(options.after === undefined ? {} : { after: options.after }),
  });
  const backfill = await readJson<EventListResponse>(backfillRequest.url, backfillRequest.init);
  for (const event of backfill.events) emitEvent(event);
  let cursor = backfill.next_cursor;
  if (options.once) return;

  for (;;) {
    const tokenRequest = buildStreamTokenRequest(options.apiUrl, options.runSessionId, options.actorId);
    const tokenResponse = await readJson<{ token: string }>(tokenRequest.url, tokenRequest.init);
    const streamUrl = buildStreamUrl(options.apiUrl, options.runSessionId, { streamToken: tokenResponse.token, after: cursor });
    cursor = await readSseUntilDisconnect(streamUrl, cursor);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
};
```

Implement `readSseUntilDisconnect()` using `fetch(streamUrl, { headers: { accept: 'text/event-stream' } })`, `response.body.getReader()`, `TextDecoder`, parsing `data:` blocks split by blank lines, updating `cursor` after each parsed event with a cursor, and returning the latest cursor when the stream ends. Abort only on `SIGINT` or process termination; do not add a short timeout.

- [ ] **Step 6: Add executable entrypoint and package script**

At the bottom of `scripts/tail-run-events.ts`:

```ts
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runTail(parseTailArgs(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
```

In root `package.json`, add:

```json
"tail:run-events": "tsx scripts/tail-run-events.ts"
```

- [ ] **Step 7: Run targeted CLI tests**

Run:

```bash
pnpm vitest run tests/smoke/tail-run-events-script.test.ts
pnpm tail:run-events -- --run-session-id run-1 --actor-id actor-owner --once
```

Expected: the test passes. The manual command should fail with a connection error if no local API is running; that is acceptable. It must not fail from argument parsing.

- [ ] **Step 8: Commit**

Run:

```bash
git add scripts/tail-run-events.ts package.json tests/smoke/tail-run-events-script.test.ts
git commit -m "feat: add repo-local run event tail script"
```

## Task 6: Integration Coverage for Backfill/SSE Gap Avoidance

**Files:**
- Modify: `tests/api/run-events.test.ts`
- Modify: `tests/e2e/run-console.e2e.test.ts`
- Optionally modify: `tests/smoke/p0-dogfood-script.test.ts`
- Optionally modify: `scripts/p0-dogfood.ts`

- [ ] **Step 1: Add API test for empty-backfill high-watermark used as `after`**

In `tests/api/run-events.test.ts`, add a test that combines empty backfill and later event append:

```ts
it('lets clients bridge empty backfill to live SSE with the returned next cursor', async () => {
  const { app, repo, runSessionId } = await track(seedEmptyRunSession());
  const service = app.get(P0Service);

  const backfill = await service.listRunEvents(runSessionId, { actorId: 'actor-owner' });
  expect(backfill).toMatchObject({ events: [], next_cursor: '0000000000', has_more: false });

  const stream = await service.streamRunEvents(runSessionId, { actorId: 'actor-owner', after: backfill.next_cursor });
  const seen: unknown[] = [];
  const subscription = stream.subscribe((event) => seen.push(event.data));

  const live = await repo.appendRunEvent({
    id: 'run-event-first-live',
    run_session_id: runSessionId,
    event_type: 'agent_message_delta',
    source: 'codex',
    visibility: 'public',
    summary: 'First live event.',
    payload: { text: 'first' },
    created_at: '2026-05-07T00:04:00.000Z',
  });

  await eventually(() => {
    expect(seen).toEqual([expect.objectContaining({ id: live.id })]);
  });

  subscription.unsubscribe();
});
```

- [ ] **Step 2: Update E2E to check no duplicate visible rows after reconnect**

In `tests/e2e/run-console.e2e.test.ts`, after the live event is visible, force the stream error/reconnect path if practical by closing the API SSE connection from the page context. If that is too brittle, add a focused browser route test that serves the same event twice with the same cursor and verifies only one `[data-event-cursor="..."]` row exists:

```ts
await expectPage(page.locator(`[data-event-cursor="${liveCursor}"]`)).toHaveCount(1);
```

The important assertion is cursor uniqueness in the rendered DOM, not `id` uniqueness.

- [ ] **Step 3: Keep dogfood helpers compatible**

If TypeScript fails after `next_cursor` becomes required, update `scripts/p0-dogfood.ts` local response types so `listRunEvents()` preserves the response high-watermark when needed. Do not expand dogfood scope beyond compatibility.

- [ ] **Step 4: Run integration tests**

Run:

```bash
pnpm vitest run tests/api/run-events.test.ts tests/e2e/run-console.e2e.test.ts
pnpm smoke:p0
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add tests/api/run-events.test.ts tests/e2e/run-console.e2e.test.ts scripts/p0-dogfood.ts tests/smoke/p0-dogfood-script.test.ts
git commit -m "test: cover run event backfill live bridge"
```

Only include `scripts/p0-dogfood.ts` and `tests/smoke/p0-dogfood-script.test.ts` in the commit if they changed.

## Task 7: Final Verification and Handoff

**Files:**
- Read: all modified files.
- No planned code changes unless verification exposes a real issue.

- [ ] **Step 1: Run targeted test matrix**

Run:

```bash
pnpm vitest run tests/contracts/run-events.test.ts tests/contracts/run-event-rendering.test.ts
pnpm vitest run tests/api/run-events.test.ts tests/api/run-auth.test.ts
pnpm vitest run tests/web/api.test.ts tests/web/run-console-state.test.ts
pnpm vitest run tests/e2e/run-console.e2e.test.ts
pnpm vitest run tests/smoke/tail-run-events-script.test.ts tests/smoke/p0-dogfood-script.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Manual CLI smoke with a local API**

In terminal 1:

```bash
pnpm dev:api
```

In terminal 2, after creating or selecting a known run session:

```bash
pnpm tail:run-events -- --api-url http://localhost:3000 --run-session-id <run-session-id> --actor-id actor-owner --once
```

Expected: prints existing classifier-visible events and exits.

Then:

```bash
pnpm tail:run-events -- --api-url http://localhost:3000 --run-session-id <run-session-id> --actor-id actor-owner
```

Expected: prints backfill, opens SSE with stream token, and prints later classifier-visible events without duplicating the same cursor.

- [ ] **Step 6: Inspect commits and final diff**

Run:

```bash
git status --short --branch
git log --oneline --decorate -n 8
```

Expected: clean working tree and task commits present.

- [ ] **Step 7: If verification uncovered fixes, commit them**

Run:

```bash
git add <fixed-files>
git commit -m "fix: stabilize run event stream verification"
```

Expected: only if actual fixes were needed.

## Implementation Notes for Subagents

- Work task-by-task. Do not skip failing-test steps.
- Use the existing `P0Service` and `P0Repository` APIs; `getLatestRunEvent()` already exists in both repository implementations.
- The empty-stream sentinel should be lexically before real event cursors. Current cursors start at `0000000001`, so `0000000000` is valid for `gt(cursor, after)` repository queries.
- Backfill `next_cursor` must never advance beyond the raw event set represented by that response. Otherwise, an event appended between `listRunEvents()` and a separate latest-cursor lookup could be skipped when Web/CLI open SSE with `after=<next_cursor>`.
- If an API test needs a run with no events, prefer adding a local test fixture helper over weakening repository encapsulation.
- Treat `next_cursor` as the confirmed high-watermark after a successful backfill response, even when `events` is empty.
- Treat SSE event cursor as confirmed only after the event is successfully parsed and merged/rendered.
- If Web receives two events with the same cursor and different IDs during reconnect overlap, the later arrival should replace the earlier row for that cursor.
- Keep renderer classifier conservative. Hide `watchdog_heartbeat`, `worker_lease_acquired`, and all non-public events by default; avoid hiding user-facing status and output events without a product reason.
- Do not introduce phase-2 event names into `runEventTypeSchema` during this plan.
