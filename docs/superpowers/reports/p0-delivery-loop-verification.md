# P0 Delivery Loop Verification

Generated: 2026-05-05T15:53:30.000Z
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

- API URL: http://localhost:3112
- Repo path: /Users/viv/projs/forgeloop/.worktrees/p0-delivery-loop-mvp
- Repo id: forgeloop
- local_codex acceptance requires Codex CLI, a server-configured local repo checkout, changed files, required-check results, a diff artifact, and retained workspace/base-ref evidence.
- Mock/control-flow validation does not replace the two required local_codex acceptance items.

## Preflight

- Codex CLI available: codex-cli 0.128.0.

## Dogfood Results

- No dogfood work items completed in this run.

## Actual Results

- `pnpm test tests/api/local-codex-routing.test.ts`: PASS, 1 file and 2 tests passed.
- `pnpm test`: PASS, 18 test files and 250 tests passed.
- `pnpm build`: PASS, all workspace build scripts completed.
- `pnpm smoke:p0`: PASS, 1 smoke test file and 3 tests passed.
- `pnpm dogfood:p0`: attempted against `FORGELOOP_API_URL=http://localhost:3112` with `FORGELOOP_CODEX_HOME=$HOME/.codex` and `FORGELOOP_EXECUTOR_ARTIFACT_ROOT=/tmp/forgeloop-p0-dogfood-artifacts`. The control plane launched a real `codex exec` process for the first local_codex item with the narrowed report-file objective, but it did not complete after more than five minutes and only created hermetic Codex env files. The attempt was stopped, so no local dogfood acceptance is claimed from this run.
