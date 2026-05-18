# Delivery Loop Verification

Generated: 2026-05-17T18:51:07.768Z
Dogfood status: PASS
Source commit: d57718a650451ad701c2177907928442eb575c27
Source tree before report write: clean

## Commands

- `pnpm dogfood:delivery`

## Expected Outcomes

- `pnpm dogfood:delivery`: exits 0 only when fake-driver live events, SSE append, input/cancel/resume commands, event backfill, lease takeover, final evidence, and Review Packet approval pass. Durable public API auth and repository checks run when `FORGELOOP_DATABASE_URL` is set.
- Durable dogfood invokes `pnpm e2e:run-console` internally and records the web app/browser checks under DB and Manual/Web Verification.
- Repository-wide `pnpm test`, `pnpm build`, and `pnpm smoke:delivery` are final release gates outside this dogfood report.

## Dogfood Preconditions

- API URL: http://127.0.0.1:55074
- Repo path: redacted local workspace
- Repo id: forgeloop
- Volatile dogfood uses an in-process volatile_demo API and deterministic fake drivers for repeatable long-running run verification.
- Durable dogfood uses X-Forgeloop-Actor-Id for public run APIs and stream_token for SSE when `FORGELOOP_DATABASE_URL` is set.
- Durable repository dogfood uses fresh Drizzle repository instances over the same Postgres database only when `FORGELOOP_DATABASE_URL` is set.
- Real local_codex acceptance is separate from this deterministic fake-driver dogfood pass and requires a local Codex runtime.

## Dogfood Results

- live-input-fake-driver: PASSED
  - Package: ebb98592-43ea-4c4b-9d97-350b329e545e
  - RunSession: 18d84612-4741-4bd1-bb0a-be4a9d1c4750
  - ReviewPacket: 25f820df-6ab4-5f20-aa6e-20604a87c516
  - Evidence checks passed.
- restart-backfill-lease-takeover: PASSED
  - Package: b8701a26-78a2-48fa-913a-b0a6ba99f060
  - RunSession: 0df8e369-bca0-46fa-aaae-e414d178501d
  - ReviewPacket: 1d92edc9-740d-5be2-befb-dd38682e81e6
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
  - RunSession f9358872-a216-41d2-b148-3989ed687555 backfilled events by cursor, reclaimed an expired lease, and completed without duplicate input delivery.
  - Verified terminal changed files, checks, artifacts, and Review Packet readiness through repository reads.
- Web app probe: PASSED
  - `pnpm e2e:run-console` started the API and Vite web app in-process and exercised the browser workbench.
- Browser visual/text-overflow verification: PASSED
  - `pnpm e2e:run-console` asserted Run Console usability at desktop and mobile viewports.

## Actual Results

- Last dogfood run finished with status PASS.
