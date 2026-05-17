# Delivery Loop Verification

Generated: 2026-05-17T16:17:26.455Z
Dogfood status: PASS
Source commit: b146880da6eaf37b39c5003cbca77823d714f1d6
Source tree before report write: clean

## Commands

- `pnpm test`
- `pnpm build`
- `pnpm smoke:delivery`
- `pnpm e2e:run-console`
- `pnpm dogfood:delivery`

## Expected Outcomes

- `pnpm test`: all Vitest suites pass.
- `pnpm build`: all workspace packages and apps compile.
- `pnpm smoke:delivery`: Delivery smoke suite passes and observes public run events before waiting for terminal evidence.
- `pnpm e2e:run-console`: browser Run Console E2E passes at desktop and mobile widths.
- `pnpm dogfood:delivery`: exits 0 only when fake-driver live events, SSE append, input/cancel/resume commands, event backfill, lease takeover, final evidence, and Review Packet approval pass. Durable public API auth and repository checks run when `FORGELOOP_DATABASE_URL` is set.

## Dogfood Preconditions

- API URL: http://127.0.0.1:61754
- Repo path: redacted local workspace
- Repo id: forgeloop
- Volatile dogfood uses an in-process volatile_demo API and deterministic fake drivers for repeatable long-running run verification.
- Durable dogfood uses X-Forgeloop-Actor-Id for public run APIs and stream_token for SSE when `FORGELOOP_DATABASE_URL` is set.
- Durable repository dogfood uses fresh Drizzle repository instances over the same Postgres database only when `FORGELOOP_DATABASE_URL` is set.
- Real local_codex acceptance is separate from this deterministic fake-driver dogfood pass and requires a local Codex runtime.

## Dogfood Results

- live-input-fake-driver: PASSED
  - Package: 3e6c937e-adac-448c-b6b0-e65cab63f277
  - RunSession: e6d3bdf5-1b33-49ad-9ca9-b9205c2557da
  - ReviewPacket: 064a80fd-e8c2-58d4-8d75-13bfd70ac38d
  - Evidence checks passed.
- restart-backfill-lease-takeover: PASSED
  - Package: bae64ee2-30db-4b63-ab33-4299eaccaaff
  - RunSession: 12eb6f44-0cc0-4c8b-8952-95d5cb975c98
  - ReviewPacket: 35787ed2-3ec3-5ba4-b0db-226c7c152fa7
  - Evidence checks passed.

## DB And Manual/Web Verification

- DB schema push: PASSED
  - FORGELOOP_DATABASE_URL is set and `pnpm db:push` completed.
- Run Console HTTP/SSE command semantics: PASSED
  - Verified event backfill, SSE append, input submission/delivery, resume command, and cancel command through public run APIs.
- Durable public API actor header auth: PASSED
  - Run, event backfill, input, cancel, and resume public APIs were exercised with X-Forgeloop-Actor-Id.
- Durable SSE stream-token auth: PASSED
  - SSE first requested a stream token with X-Forgeloop-Actor-Id and opened the stream with stream_token.
- Durable repository restart recovery: PASSED
  - Used fresh Drizzle repository instances over the same Postgres database, with the pool closed and reopened across the restart boundary.
  - RunSession eadfe526-ff83-4a05-a3d9-5447d0277c66 backfilled events by cursor, reclaimed an expired lease, and completed without duplicate input delivery.
  - Verified terminal changed files, checks, artifacts, and Review Packet readiness through repository reads.
- Web app probe: PASSED
  - `pnpm e2e:run-console` started the API and Vite web app in-process and exercised the browser workbench.
- Browser visual/text-overflow verification: PASSED
  - `pnpm e2e:run-console` asserted Run Console usability at desktop and mobile viewports.

## Actual Results

- Last dogfood run finished with status PASS.
