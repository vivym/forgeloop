# P0 Delivery Loop Verification

Generated: 2026-05-07T22:25:18.490Z
Dogfood status: PASS

## Commands

- `pnpm test`
- `pnpm build`
- `pnpm smoke:p0`
- `pnpm dogfood:p0`

## Expected Outcomes

- `pnpm test`: all Vitest suites pass.
- `pnpm build`: all workspace packages and apps compile.
- `pnpm smoke:p0`: P0 smoke suite passes and observes public run events before waiting for terminal evidence.
- `pnpm dogfood:p0`: exits 0 only when fake-driver live events, input delivery, event backfill, lease takeover, final evidence, and Review Packet approval pass.

## Dogfood Preconditions

- API URL: http://127.0.0.1:64597
- Repo path: /Users/viv/projs/forgeloop/.worktrees/codex-long-running-execution
- Repo id: forgeloop
- Dogfood uses an in-process volatile_demo API and deterministic fake drivers for repeatable long-running run verification.
- Real local_codex acceptance is separate from this deterministic dogfood pass and requires a local Codex runtime.

## Dogfood Results

- live-input-fake-driver: PASSED
  - Package: execution-package-27
  - RunSession: run-session-30
  - ReviewPacket: review-packet:run-session-30
  - Evidence checks passed.
- restart-backfill-lease-takeover: PASSED
  - Package: execution-package-59
  - RunSession: run-session-62
  - ReviewPacket: review-packet:run-session-62
  - Evidence checks passed.

## Actual Results

- Last dogfood run finished with status PASS.
