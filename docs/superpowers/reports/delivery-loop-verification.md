# Delivery Loop Verification

Generated: 2026-05-17T18:39:30.475Z
Dogfood status: PASS
Source commit: 33c9d0a6808f14b7fc53800452d145470a759c40
Source tree before report write: clean

## Commands

- `pnpm dogfood:delivery`

## Expected Outcomes

- `pnpm dogfood:delivery`: exits 0 only when fake-driver live events, SSE append, input/cancel/resume commands, event backfill, lease takeover, final evidence, and Review Packet approval pass. Durable public API auth and repository checks run when `FORGELOOP_DATABASE_URL` is set.
- Durable dogfood invokes `pnpm e2e:run-console` internally and records the web app/browser checks under DB and Manual/Web Verification.
- Repository-wide `pnpm test`, `pnpm build`, and `pnpm smoke:delivery` are final release gates outside this dogfood report.

## Dogfood Preconditions

- API URL: http://127.0.0.1:54713
- Repo path: redacted local workspace
- Repo id: forgeloop
- Volatile dogfood uses an in-process volatile_demo API and deterministic fake drivers for repeatable long-running run verification.
- Durable dogfood uses X-Forgeloop-Actor-Id for public run APIs and stream_token for SSE when `FORGELOOP_DATABASE_URL` is set.
- Durable repository dogfood uses fresh Drizzle repository instances over the same Postgres database only when `FORGELOOP_DATABASE_URL` is set.
- Real local_codex acceptance is separate from this deterministic fake-driver dogfood pass and requires a local Codex runtime.

## Dogfood Results

- live-input-fake-driver: PASSED
  - Package: 4a319f3d-99e8-41bc-ad3c-52f47cf73c39
  - RunSession: fd8e1dc1-10a3-4c3a-8c09-c0ca50179957
  - ReviewPacket: e9f3d248-9dc6-5724-b10a-0f6fc04c0a88
  - Evidence checks passed.
- restart-backfill-lease-takeover: PASSED
  - Package: 52c2fb4f-14fa-4a4e-8890-45ee7f8f74c3
  - RunSession: afd5fc1b-e342-4d78-8a46-7b8347d58181
  - ReviewPacket: f6f805f3-0479-5ff0-85f6-36d49a9f99f6
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
  - RunSession 7ad7b703-2a35-4fa9-9293-a15f59db70d3 backfilled events by cursor, reclaimed an expired lease, and completed without duplicate input delivery.
  - Verified terminal changed files, checks, artifacts, and Review Packet readiness through repository reads.
- Web app probe: PASSED
  - `pnpm e2e:run-console` started the API and Vite web app in-process and exercised the browser workbench.
- Browser visual/text-overflow verification: PASSED
  - `pnpm e2e:run-console` asserted Run Console usability at desktop and mobile viewports.

## Actual Results

- Last dogfood run finished with status PASS.
