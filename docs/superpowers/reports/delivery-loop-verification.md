# Delivery Loop Verification

Generated: 2026-05-17T17:38:30.627Z
Dogfood status: PASS
Source commit: 73b5cd0969310dd124513fd3c77835b7ce8dcb62
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

- API URL: http://127.0.0.1:52515
- Repo path: redacted local workspace
- Repo id: forgeloop
- Volatile dogfood uses an in-process volatile_demo API and deterministic fake drivers for repeatable long-running run verification.
- Durable dogfood uses X-Forgeloop-Actor-Id for public run APIs and stream_token for SSE when `FORGELOOP_DATABASE_URL` is set.
- Durable repository dogfood uses fresh Drizzle repository instances over the same Postgres database only when `FORGELOOP_DATABASE_URL` is set.
- Real local_codex acceptance is separate from this deterministic fake-driver dogfood pass and requires a local Codex runtime.

## Dogfood Results

- live-input-fake-driver: PASSED
  - Package: 3eb1d74d-be9e-4e86-ab23-33ac5ebaa522
  - RunSession: eb41a955-2baa-4e79-85de-af91ea7b9c6b
  - ReviewPacket: 77895a8b-0eb7-52ef-82a7-2b33762f8e5b
  - Evidence checks passed.
- restart-backfill-lease-takeover: PASSED
  - Package: 9ba930e7-8120-43f2-b2a4-f3a8b12dbaae
  - RunSession: a39566b9-ee6a-4928-a97d-1609d78b6694
  - ReviewPacket: eaa85b86-8bad-55b7-8525-6f67a7c1f045
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
  - RunSession c073b596-7a67-4c33-aed6-bd3ada6ed876 backfilled events by cursor, reclaimed an expired lease, and completed without duplicate input delivery.
  - Verified terminal changed files, checks, artifacts, and Review Packet readiness through repository reads.
- Web app probe: PASSED
  - `pnpm e2e:run-console` started the API and Vite web app in-process and exercised the browser workbench.
- Browser visual/text-overflow verification: PASSED
  - `pnpm e2e:run-console` asserted Run Console usability at desktop and mobile viewports.

## Actual Results

- Last dogfood run finished with status PASS.
