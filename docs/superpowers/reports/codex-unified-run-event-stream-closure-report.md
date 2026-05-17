> Superseded historical migration note: this document mentions the old subsystem name for audit history only. Current commands, routes, files, and product docs use delivery terminology.

# Codex Unified Run Event Stream Closure Report

Generated: 2026-05-09T06:15:22Z
Verified repository state: `b6e5649c635f9466c4771ea26b2770dee69a982e`

## Scope

- Close the Phase 1 read-stream work from `docs/superpowers/specs/2026-05-09-codex-unified-run-event-stream-design.md`.
- Reconcile the implementation plan with current code and tests.
- Avoid overlap with durable revision lookup work in `docs/superpowers/specs/2026-05-09-p0-durable-revision-lookup-design.md`.

## Status

Status: `PASS`

Phase 1 is implemented:

- `RunSession` remains the canonical stream unit.
- `RunEventListResponse.next_cursor` is required and returned for empty, filtered, and populated backfill responses.
- SSE without `after` starts at the live tail; normal Web and CLI consumers use backfill-first and then subscribe with `after=<next_cursor>`.
- Web merges events by cursor and reconnects from the last confirmed cursor.
- The repo-local `tail:run-events` command uses the same backfill, stream-token, SSE, and default timeline classifier path as Web.
- The shared classifier keeps internal and low-signal operational events out of the default timeline without changing the public stream contract.

## Verification

- `pnpm test tests/contracts/run-events.test.ts tests/contracts/run-event-rendering.test.ts tests/api/run-events.test.ts tests/web/api.test.ts tests/web/run-console-state.test.ts tests/smoke/tail-run-events-script.test.ts tests/e2e/run-console.e2e.test.ts`: `PASS` - 7 files, 55 tests.
- `pnpm test`: `PASS` - 44 files, 512 tests.
- `pnpm build`: `PASS`.
- `git diff --check`: `PASS`.

## Evidence

- Contract: `packages/contracts/src/api.ts` requires `next_cursor`; `packages/contracts/src/run-event-rendering.ts` exports the shared default timeline classifier.
- API: `apps/control-plane-api/src/p0/p0.service.ts` returns a high-watermark cursor from the same raw event query and resolves SSE live-tail baselines from the latest durable event cursor.
- Web: `apps/web/src/App.tsx` performs backfill first, records `response.next_cursor`, and opens SSE with that cursor; `apps/web/src/workbenchState.ts` merges run events by cursor.
- CLI: `scripts/tail-run-events.ts` builds the same backfill, stream-token, and SSE URL flow and formats only classifier-visible events.
- Tests: `tests/contracts/run-event-rendering.test.ts`, `tests/api/run-events.test.ts`, `tests/web/api.test.ts`, `tests/web/run-console-state.test.ts`, `tests/smoke/tail-run-events-script.test.ts`, and `tests/e2e/run-console.e2e.test.ts` cover the stream contract and consumer behavior.

## Deferred

- Phase 2 write-side steering/input expansion remains deferred. The phase-1 stream consumes existing `user_input` and `waiting_for_input` events but does not emit new `steer_requested`, `steer_applied`, `command_queued`, or `command_acked` event contracts.
- Manual CLI smoke against an externally running API was not run in this closure pass; the repo-local CLI request builders, formatting, and backfill-first stream URL behavior are covered by automated smoke tests.
- Durable revision lookup is separate concurrent work and was not touched.
