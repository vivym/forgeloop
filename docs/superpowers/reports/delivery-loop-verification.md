# Delivery Loop Verification

Generated: 2026-05-17T16:37:13.702Z
Dogfood status: PASS
Source commit: 850dc2844e853379a370dc566b92f451c32433a5
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

- API URL: http://127.0.0.1:60734
- Repo path: redacted local workspace
- Repo id: forgeloop
- Volatile dogfood uses an in-process volatile_demo API and deterministic fake drivers for repeatable long-running run verification.
- Durable dogfood uses X-Forgeloop-Actor-Id for public run APIs and stream_token for SSE when `FORGELOOP_DATABASE_URL` is set.
- Durable repository dogfood uses fresh Drizzle repository instances over the same Postgres database only when `FORGELOOP_DATABASE_URL` is set.
- Real local_codex acceptance is separate from this deterministic fake-driver dogfood pass and requires a local Codex runtime.

## Dogfood Results

- live-input-fake-driver: PASSED
  - Package: 15744bbe-aadb-4f15-95e8-5d7f333d0899
  - RunSession: 8df13dfb-ac82-4afa-87f8-8906e37cc22f
  - ReviewPacket: 9d3640e9-d6f7-5bc5-a44e-6fd62b3501b0
  - Evidence checks passed.
- restart-backfill-lease-takeover: PASSED
  - Package: 83b1229d-f13a-43ff-aec9-75c16cf6f0c6
  - RunSession: 6905f94d-7012-4620-a4e7-7aabb636cace
  - ReviewPacket: d234aab8-ab54-530b-8336-a76fb55f5462
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
  - RunSession e397d261-2884-41d9-9e61-2dc587daa5c5 backfilled events by cursor, reclaimed an expired lease, and completed without duplicate input delivery.
  - Verified terminal changed files, checks, artifacts, and Review Packet readiness through repository reads.
- Web app probe: PASSED
  - `pnpm e2e:run-console` started the API and Vite web app in-process and exercised the browser workbench.
- Browser visual/text-overflow verification: PASSED
  - `pnpm e2e:run-console` asserted Run Console usability at desktop and mobile viewports.

## Actual Results

- Last dogfood run finished with status PASS.
