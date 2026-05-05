# P0 Delivery Loop Verification

Generated: 2026-05-05T15:24:33.372Z
Dogfood status: FAIL

## Commands

- `pnpm test`
- `pnpm build`
- `pnpm smoke:p0`
- `pnpm dogfood:p0`

## Expected Outcomes

- `pnpm test`: all Vitest suites pass.
- `pnpm build`: all workspace packages and apps compile.
- `pnpm smoke:p0`: P0 smoke suite passes for straight approval, changes-requested rerun approval, and stale packet force-rerun.
- `pnpm dogfood:p0`: exits 0 only when two local_codex dogfood items and one mock item complete with approved review evidence.

## Dogfood Preconditions

- API URL: http://localhost:3111
- Repo path: /Users/viv/projs/forgeloop/.worktrees/p0-delivery-loop-mvp
- Repo id: forgeloop
- local_codex acceptance requires Codex CLI, a server-configured local repo checkout, changed files, required-check results, a diff artifact, and retained workspace/base-ref evidence.
- Mock/control-flow validation does not replace the two required local_codex acceptance items.

## Preflight

- Codex CLI available: codex-cli 0.128.0.

## Dogfood Results

- feature-local-codex: FAILED (local_codex)
  - WorkItem: work-item-5
  - Package: execution-package-27
  - RunSession: run-session-30
  - ReviewPacket: review-packet:run-session-30
  - local_codex run is missing retained workspace_path/base_ref evidence.
- bugfix-local-codex: FAILED (local_codex)
  - WorkItem: work-item-35
  - Package: execution-package-57
  - RunSession: run-session-65
  - ReviewPacket: review-packet:run-session-65
  - local_codex run is missing retained workspace_path/base_ref evidence.
- test-refactor-mock: PASSED (mock)
  - WorkItem: work-item-70
  - Package: execution-package-92
  - RunSession: run-session-95
  - ReviewPacket: review-packet:run-session-95
  - Evidence checks passed.

## Actual Results

- `pnpm test`: PASS, 17 test files and 248 tests passed.
- `pnpm build`: PASS, all workspace build scripts completed.
- `pnpm smoke:p0`: PASS, 1 smoke test file and 3 tests passed.
- `pnpm dogfood:p0`: FAIL when run against `FORGELOOP_API_URL=http://localhost:3111`; Codex CLI was available, the mock item passed, and both local_codex items failed acceptance because retained `workspace_path`/`base_ref` evidence was missing.
