# Delivery Loop Verification

Generated: 2026-05-17T15:54:59.092Z
Dogfood status: PASS
Source commit: 80e0243ebb378c74631eccec0496a4218b3a7fb1
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

- API URL: http://127.0.0.1:51957
- Repo path: redacted local workspace
- Repo id: forgeloop
- Volatile dogfood uses an in-process volatile_demo API and deterministic fake drivers for repeatable long-running run verification.
- Durable dogfood uses X-Forgeloop-Actor-Id for public run APIs and stream_token for SSE when `FORGELOOP_DATABASE_URL` is set.
- Durable repository dogfood uses fresh Drizzle repository instances over the same Postgres database only when `FORGELOOP_DATABASE_URL` is set.
- Real local_codex acceptance is separate from this deterministic fake-driver dogfood pass and requires a local Codex runtime.

## Dogfood Results

- live-input-fake-driver: PASSED
  - Package: fbb7ab71-b473-4cc4-99a0-4e98521c6128
  - RunSession: f6bfbe21-8e0e-4160-b470-6dbbe158389f
  - ReviewPacket: aa694005-0a01-5907-a9eb-398427d3c000
  - Evidence checks passed.
- restart-backfill-lease-takeover: PASSED
  - Package: df96e48f-f1aa-4bc7-b961-5361bb5e2740
  - RunSession: af917a92-a3e3-47fd-94e1-aff05ecb15e5
  - ReviewPacket: 4dfc7f53-2bfb-555a-b7d2-47a11326438c
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
  - RunSession 91de7b2b-ac6a-4cdd-bfc4-f0e7ba8a6f42 backfilled events by cursor, reclaimed an expired lease, and completed without duplicate input delivery.
  - Verified terminal changed files, checks, artifacts, and Review Packet readiness through repository reads.
- Web app probe: PASSED
  - `pnpm e2e:run-console` started the API and Vite web app in-process and exercised the browser workbench.
- Browser visual/text-overflow verification: PASSED
  - `pnpm e2e:run-console` asserted Run Console usability at desktop and mobile viewports.

## Actual Results

- Last dogfood run finished with status PASS.
