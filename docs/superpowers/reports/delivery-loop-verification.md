# Delivery Loop Verification

Generated: 2026-05-17T17:41:55.426Z
Dogfood status: PASS
Source commit: c60107be095c86415186a5ac8bf33abd4d13040b
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

- API URL: http://127.0.0.1:53220
- Repo path: redacted local workspace
- Repo id: forgeloop
- Volatile dogfood uses an in-process volatile_demo API and deterministic fake drivers for repeatable long-running run verification.
- Durable dogfood uses X-Forgeloop-Actor-Id for public run APIs and stream_token for SSE when `FORGELOOP_DATABASE_URL` is set.
- Durable repository dogfood uses fresh Drizzle repository instances over the same Postgres database only when `FORGELOOP_DATABASE_URL` is set.
- Real local_codex acceptance is separate from this deterministic fake-driver dogfood pass and requires a local Codex runtime.

## Dogfood Results

- live-input-fake-driver: PASSED
  - Package: eb191d9f-4cc6-459a-92e6-aa0707c872d6
  - RunSession: 8b3c9eaf-497a-495b-a38d-9ebddbbd4c35
  - ReviewPacket: 58e53d95-7820-5864-92cf-2743c6de2c30
  - Evidence checks passed.
- restart-backfill-lease-takeover: PASSED
  - Package: 37bed0b3-12a8-4b49-b448-fb4ff5d7ca0a
  - RunSession: 4e198795-5cce-4472-9f36-55a1ba06af00
  - ReviewPacket: 1e7c0ba9-90da-5cf8-bce9-6fcfbf81545c
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
  - RunSession b1ecf59b-e2fb-4e63-be5f-d7d388e1f5f7 backfilled events by cursor, reclaimed an expired lease, and completed without duplicate input delivery.
  - Verified terminal changed files, checks, artifacts, and Review Packet readiness through repository reads.
- Web app probe: PASSED
  - `pnpm e2e:run-console` started the API and Vite web app in-process and exercised the browser workbench.
- Browser visual/text-overflow verification: PASSED
  - `pnpm e2e:run-console` asserted Run Console usability at desktop and mobile viewports.

## Actual Results

- Last dogfood run finished with status PASS.
