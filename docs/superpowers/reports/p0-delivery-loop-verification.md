# P0 Delivery Loop Verification

Generated: 2026-05-09T03:26:26Z
Deterministic dogfood status: PASS
Strict local_codex status: FAILED

## Commands

- `pnpm test`
- `pnpm build`
- `pnpm install --frozen-lockfile`
- `pnpm smoke:p0`
- `pnpm dogfood:p0`
- `FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm db:push`
- `FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm dogfood:p0:durable`
- `pnpm e2e:run-console`

## Expected Outcomes

- `pnpm test`: all Vitest suites pass.
- `pnpm build`: all workspace packages and apps compile.
- `pnpm install --frozen-lockfile`: the CI dependency install path succeeds without lockfile changes.
- `pnpm smoke:p0`: P0 smoke suite passes and observes public run events before waiting for terminal evidence.
- `pnpm dogfood:p0`: exits 0 only when fake-driver live events, SSE append, input/cancel/resume commands, event backfill, lease takeover, final evidence, and Review Packet approval pass. Durable public API auth and repository checks run when `FORGELOOP_DATABASE_URL` is set.
- `pnpm db:push`: Drizzle schema push applies successfully against the local Postgres durable database.
- `pnpm dogfood:p0:durable`: durable dogfood exits 0 using the provided Postgres database.
- `pnpm e2e:run-console`: browser Run Console E2E passes at desktop and mobile widths.

## Dogfood Preconditions

- API URL: http://127.0.0.1:63100
- Repo path: /Users/viv/projs/forgeloop/.worktrees/p0-dogfood-readiness
- Repo id: forgeloop
- Volatile dogfood uses an in-process volatile_demo API and deterministic fake drivers for repeatable long-running run verification.
- Durable dogfood uses X-Forgeloop-Actor-Id for public run APIs and stream_token for SSE when `FORGELOOP_DATABASE_URL` is set.
- Durable repository dogfood uses fresh Drizzle repository instances over the same Postgres database only when `FORGELOOP_DATABASE_URL` is set.
- Real local_codex acceptance is separate from this deterministic fake-driver dogfood pass and requires a local Codex runtime.

## Dogfood Results

- live-input-fake-driver: PASSED
  - Package: execution-package-27
  - RunSession: run-session-30
  - ReviewPacket: review-packet:run-session-30
  - Evidence checks passed.
- restart-backfill-lease-takeover: PASSED
  - Package: execution-package-63
  - RunSession: run-session-66
  - ReviewPacket: review-packet:run-session-66
  - Evidence checks passed.

## DB And Manual/Web Verification

- DB schema push: PASSED
  - `FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm db:push` applied changes successfully against Docker Postgres.
- Run Console HTTP/SSE command semantics: PASSED
  - Verified event backfill, SSE append, input submission/delivery, resume command, and cancel command through public run APIs.
- Volatile public API actor fallback: PASSED
  - Volatile demo public APIs were exercised with legacy body/query actor fallback.
- Durable repository restart recovery: PASSED
  - `FORGELOOP_DATABASE_URL=postgresql://forgeloop:forgeloop@localhost:5432/forgeloop pnpm dogfood:p0:durable` exited 0 with: "Durable P0 dogfood passed using provided database forgeloop."
- Strict local_codex dogfood: FAILED
  - Command: `FORGELOOP_DATABASE_URL=... FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1 FORGELOOP_LOCAL_CODEX_DOGFOOD_CONFIRM_DANGEROUS_MODE=1 FORGELOOP_REPO_PATH="$CLOSURE_REPO_PATH" pnpm dogfood:p0:work-items`
  - Report: `docs/superpowers/reports/p0-dogfood-work-items-completion.md`
  - Failure: `strict_review_packet_timeout` - timed out waiting for ReviewPacket for `run-session-27b5e015731a-28`; command did not render a new strict report before remaining alive and was terminated with exit code 143.
- Web app probe: PASSED
  - `pnpm e2e:run-console` started the API and Vite web app in-process and exercised the browser workbench.
- Browser visual/text-overflow verification: PASSED
  - `pnpm e2e:run-console` asserted Run Console usability at 1280x800 and 390x844 viewports.

## Actual Results

- Deterministic dogfood run finished with status PASS.
- Strict local_codex dogfood finished with status FAILED: `strict_review_packet_timeout`.
