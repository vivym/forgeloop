# Codex Execution Verification Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining Codex long-running execution verification gaps: durable actor auth, browser Run Console E2E, one-command durable DB dogfood, and opt-in real local Codex dogfood.

**Architecture:** Add a small local authenticated actor boundary for durable API/SSE paths, then route Web and dogfood checks through that boundary. Keep deterministic fake-driver dogfood as the default, add durable and browser verification commands, and make real `local_codex` dogfood explicit and gated.

**Tech Stack:** TypeScript, NestJS, React/Vite, Vitest, Supertest, Playwright, Node child processes, Docker/Postgres CLI, Server-Sent Events, Codex app-server and `codex exec --json --dangerously-bypass-approvals-and-sandbox`.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-05-08-codex-execution-verification-closure-design.md`
- Prior design: `docs/superpowers/specs/2026-05-06-codex-long-running-execution-design.md`
- Prior plan: `docs/superpowers/plans/2026-05-07-codex-long-running-execution.md`
- Required skills: @superpowers:test-driven-development, @superpowers:subagent-driven-development, @superpowers:systematic-debugging, @superpowers:verification-before-completion

## File Structure

```text
apps/control-plane-api/src/p0/
  actor-context.ts                 # New local actor extraction and stream token helpers
  dto.ts                           # Add stream-token response schema only if controller validation needs it
  p0.controller.ts                 # Read actor header, add stream token endpoint, pass authenticated actors
  p0.module.ts                     # Provide stream-token secret/config if service injection needs it
  p0.service.ts                    # Resolve actor from authenticated context first

packages/executor/src/
  source-repo-guard.ts             # Only if dogfood-only guard injection needs an executable seam
  local-codex-evidence.ts          # Only if dogfood-only evidence injection needs an executable seam

packages/run-worker/src/
  run-worker.ts                    # Only if the source mutation hook belongs at worker orchestration

apps/web/src/
  api.ts                           # Actor header support and stream-token EventSource flow
  App.tsx                          # Prefer authenticated actor flow for Run Console
  styles.css                       # Only if E2E finds overflow/layout issues

scripts/
  p0-dogfood.ts                    # Keep deterministic default; report durable public API status accurately
  p0-durable-dogfood.ts            # New one-command durable DB dogfood wrapper
  p0-local-codex-dogfood.ts        # New opt-in real local_codex dogfood

tests/
  api/run-auth.test.ts             # Durable actor auth and stream token coverage
  api/run-events.test.ts           # Update if stream behavior changes
  executor/source-repo-guard.test.ts # Add if executor/worker guard seam changes
  smoke/p0-dogfood-script.test.ts  # p0 dogfood auth/SSE helper coverage if helpers need extraction
  smoke/p0-durable-dogfood-script.test.ts # durable DB wrapper helper coverage
  web/api.test.ts                  # Actor header and stream token client coverage
  e2e/run-console.e2e.test.ts      # Playwright browser Run Console coverage

package.json                       # Add dogfood:p0:durable, dogfood:p0:local-codex, e2e:run-console
pnpm-lock.yaml                     # Update if @playwright/test or other dev dependencies are added
README.md                          # Document new verification commands
docs/superpowers/reports/p0-delivery-loop-verification.md
```

## Task 1: Durable Actor Context and Stream Tokens

**Files:**
- Create: `apps/control-plane-api/src/p0/actor-context.ts`
- Modify: `apps/control-plane-api/src/p0/p0.controller.ts`
- Modify: `apps/control-plane-api/src/p0/p0.module.ts` only if a provider is needed for the stream-token secret
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
- Test: `tests/api/run-auth.test.ts`
- Test: `tests/api/async-run.test.ts`

- [ ] **Step 1: Write failing actor-context unit/API tests**

Create `tests/api/run-auth.test.ts` with tests that:

- boot `AppModule` in durable mode with `P0_DEMO_ACTOR_ID_FALLBACK=false`
- seed a ready package using existing helper APIs
- assert body-only `requested_by_actor_id` returns `401`
- assert `X-Forgeloop-Actor-Id: actor-owner` can start a run in durable mode
- assert an unrelated authenticated actor gets `403` when listing events
- assert query/body-only actor fallback is rejected for durable event backfill, input, cancel, and resume
- assert the authenticated owner can list events, send input, cancel, and resume
- assert an authenticated non-operator viewer can list events but cannot send input, cancel, or resume
- assert owner can request a stream token and use it for SSE
- assert durable stream-token creation without `X-Forgeloop-Actor-Id` rejects body/query-only actor identity
- assert durable SSE `GET /run-sessions/:id/events/stream?actor_id=...` rejects query-only actor identity when no stream token or authenticated actor header is present
- assert an expired or wrong-run token returns `401`
- assert production mode without `FORGELOOP_DEV_AUTH_SECRET` rejects stream-token creation with a configuration error
- assert non-production mode can create and verify stream tokens through a deterministic fallback secret
- assert `volatile_demo` still accepts query/body `actor_id`

Use Supertest and existing `seedReadyExecutionPackageThroughApi()` where possible.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run tests/api/run-auth.test.ts
```

Expected: FAIL because `actor-context.ts`, stream token endpoint, and authenticated actor plumbing do not exist.

- [ ] **Step 3: Implement `actor-context.ts`**

Add helpers:

```ts
export const actorHeaderName = 'x-forgeloop-actor-id';

export interface ActorContext {
  authenticatedActorId?: string;
}

export interface RunEventStreamTokenPayload {
  run_session_id: string;
  actor_id: string;
  expires_at: string;
  nonce: string;
}

export const actorContextFromHeaders = (headers: Record<string, string | string[] | undefined>): ActorContext => {
  const raw = headers[actorHeaderName] ?? headers['X-Forgeloop-Actor-Id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === undefined || value.trim().length === 0 ? {} : { authenticatedActorId: value.trim() };
};
```

Also add HMAC helpers using Node `crypto`:

- `resolveRunEventStreamTokenSecret(env)`:
  - returns `FORGELOOP_DEV_AUTH_SECRET` when set
  - returns a deterministic fallback secret only when `NODE_ENV !== 'production'`
  - throws a configuration error in production when the secret is missing
- `createRunEventStreamToken(payload, secret)`
- `verifyRunEventStreamToken(token, secret, now)`

Token format can be `base64url(json).base64url(signature)`. Keep it local and deterministic for tests.

- [ ] **Step 4: Wire controller actor extraction**

In `p0.controller.ts`:

- import `Headers`
- for run/rerun/force-rerun, list events, stream events, input, cancel, resume, pass `actorContextFromHeaders(headers)` to service
- add:

```ts
@Post('run-sessions/:runSessionId/events/stream-token')
createRunEventStreamToken(...)
```

- update `@Sse` to accept `stream_token` query in addition to `actor_id`

- [ ] **Step 5: Wire service actor resolution**

In `p0.service.ts`:

- update `runPackage(packageId, dto, mode, actorContext = {})`
- update `listRunEvents(runSessionId, { after, actorId, actorContext, streamToken })`
- update `streamRunEvents(...)`
- update `createRunInputCommand`, `createRunCancelCommand`, `createRunResumeCommand`
- update `resolveRunActor()` call sites to pass `{ authenticatedActorId, demoActorId }`
- inject or resolve the stream-token secret via `resolveRunEventStreamTokenSecret(process.env)`; if constructor injection is cleaner in this Nest module, add the provider in `p0.module.ts`
- add `createRunEventStreamToken(runSessionId, actorContext)`:
  - resolve authenticated/demo actor
  - assert viewer allowed
  - return `{ token, expires_at }`
- add `resolveStreamActor()`:
  - if token exists, verify token run id and expiry, then use token actor
  - else use normal actor resolution for `volatile_demo` fallback

- [ ] **Step 6: Verify GREEN**

Run:

```bash
pnpm vitest run tests/api/run-auth.test.ts tests/api/async-run.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/control-plane-api/src/p0/actor-context.ts apps/control-plane-api/src/p0/p0.controller.ts apps/control-plane-api/src/p0/p0.module.ts apps/control-plane-api/src/p0/p0.service.ts tests/api/run-auth.test.ts tests/api/async-run.test.ts
git commit -m "feat: add durable run actor context"
```

## Task 2: Web Client Authenticated Run Console Flow

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `tests/web/api.test.ts`

- [ ] **Step 1: Write failing Web API client tests**

Update `tests/web/api.test.ts`:

- `listRunEvents` should send `X-Forgeloop-Actor-Id` instead of `actor_id` query when actor id is provided
- `sendRunInput`, `cancelRun`, `resumeRun`, and `runPackage` should send actor header and still include existing body fields only where the API contract requires them for backwards compatibility
- `openRunEventStream` should first call `POST /run-sessions/:id/events/stream-token` with actor header, then open EventSource with `stream_token`
- malformed stream token response should route to error handler

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run tests/web/api.test.ts
```

Expected: FAIL because the client still uses query/body actor flow for run event helpers and EventSource.

- [ ] **Step 3: Implement authenticated actor client support**

In `apps/web/src/api.ts`:

- add `actorHeader(actorId)` helper
- extend `request()` options with `actorId?: string`
- for run event and operator helpers, set `actorId` option so headers include `X-Forgeloop-Actor-Id`
- add `createRunEventStreamToken(runSessionId, actorId)`
- make `openRunEventStream` async or return a wrapper that opens EventSource after token fetch

Preserve enough compatibility that existing `App.tsx` call sites remain simple.

- [ ] **Step 4: Update `App.tsx` Run Console**

In `App.tsx`:

- keep using `selectedRunActorId`
- call updated API methods
- handle async stream opening by cancelling stale stream setup on run changes
- keep reconnect/backfill behavior intact

- [ ] **Step 5: Verify GREEN**

Run:

```bash
pnpm vitest run tests/web/api.test.ts tests/web/run-console-state.test.ts
pnpm --filter @forgeloop/web build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/App.tsx tests/web/api.test.ts
git commit -m "feat: authenticate run console client"
```

## Task 3: Browser Run Console E2E

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml` if `@playwright/test` is added
- Create: `tests/e2e/run-console.e2e.test.ts`
- Modify: `apps/web/src/App.tsx` only if stable selectors are needed
- Modify: `apps/web/src/styles.css` only if layout failures are found

- [ ] **Step 1: Add failing Playwright dependency check/test**

Add `@playwright/test` to `devDependencies` if it is not already available.

Create `tests/e2e/run-console.e2e.test.ts` that:

- starts the Nest API in-process on a random port with fake worker/noop worker
- starts Vite programmatically or via child process with `VITE_FORGELOOP_API_URL`
- creates P0 fixtures through the API
- opens the Web app in Chromium
- selects the run
- asserts Run Console renders at least `run_queued`
- records the latest rendered event cursor after the initial backfill
- observes the browser `EventSource` connection opening before creating the next event
- creates a new event through the API after the stream is open
- asserts the new cursor appears without page reload and without reselecting the run
- sends input and asserts a visible `user_input`
- clicks cancel and resume and asserts visible command events
- repeats layout checks at `1280x800` and `390x844`
- asserts `document.documentElement.scrollWidth <= document.documentElement.clientWidth`
- asserts Run Console controls and event list bounding boxes do not overlap

- [ ] **Step 2: Add script and verify RED**

In `package.json`, add:

```json
"e2e:run-console": "vitest run tests/e2e/run-console.e2e.test.ts"
```

Run:

```bash
pnpm e2e:run-console
```

Expected: FAIL until Playwright setup/client auth flow is implemented and selectors are stable.

- [ ] **Step 3: Add stable selectors if needed**

If the test cannot target Run Console reliably, add minimal `data-testid` attributes in `App.tsx`:

- `run-console`
- `run-console-events`
- `run-console-input`
- `run-console-send`
- `run-console-cancel`
- `run-console-resume`

- [ ] **Step 4: Fix layout only if E2E proves a problem**

If narrow viewport overflows:

- update `styles.css` with bounded grid/flex widths
- ensure event text uses `overflow-wrap: anywhere`
- ensure buttons do not shrink below usable sizes

- [ ] **Step 5: Verify GREEN**

Run:

```bash
pnpm e2e:run-console
pnpm --filter @forgeloop/web build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml tests/e2e/run-console.e2e.test.ts apps/web/src/App.tsx apps/web/src/styles.css
git commit -m "test: add run console browser e2e"
```

## Task 4: One-Command Durable DB Dogfood

**Files:**
- Modify: `scripts/p0-dogfood.ts`
- Create: `scripts/p0-durable-dogfood.ts`
- Modify: `package.json`
- Modify: `README.md`
- Test: `tests/smoke/p0-dogfood-script.test.ts`
- Test: `tests/smoke/p0-durable-dogfood-script.test.ts`

- [ ] **Step 1: Write failing dogfood auth and durable wrapper tests**

Create or update `tests/smoke/p0-dogfood-script.test.ts` for exported `p0-dogfood.ts` helpers:

- durable public API calls include `X-Forgeloop-Actor-Id`
- durable event backfill does not send `actor_id` query fallback
- durable SSE first requests `/run-sessions/:id/events/stream-token` with the actor header
- durable SSE opens EventSource with `stream_token`, not query-only `actor_id`
- report generation marks durable public API/SSE auth as PASS only when the header/token flow was exercised
- `volatile_demo` dogfood behavior remains compatible with body/query actor fallback

Create `tests/smoke/p0-durable-dogfood-script.test.ts` with unit-style tests for exported helpers:

- parses `FORGELOOP_DATABASE_URL`
- discovers a Docker Postgres candidate from `docker ps` / `docker inspect` shaped data
- refuses to proceed when no DB URL and no Docker candidate exist
- marks self-created database for cleanup
- does not mark externally provided DB for cleanup
- verifies report text contains durable PASS markers

Structure `scripts/p0-durable-dogfood.ts` so helpers can be imported without running `main()`.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run tests/smoke/p0-dogfood-script.test.ts tests/smoke/p0-durable-dogfood-script.test.ts
```

Expected: FAIL because the durable dogfood wrapper does not exist and `p0-dogfood.ts` still uses the legacy fallback flow for durable public API/SSE paths.

- [ ] **Step 3: Update `p0-dogfood.ts` durable API/SSE flow**

In `scripts/p0-dogfood.ts`:

- export small helpers needed by `tests/smoke/p0-dogfood-script.test.ts` without running `main()`
- when `FORGELOOP_DATABASE_URL` or durable mode is active, send `X-Forgeloop-Actor-Id` for run/event/input/cancel/resume public API calls
- request stream tokens before durable SSE checks
- open durable SSE with `stream_token`
- keep legacy query/body actor fallback only for `volatile_demo`
- make report markers distinguish authenticated durable public API/SSE PASS from volatile fallback PASS

- [ ] **Step 4: Implement `p0-durable-dogfood.ts`**

Script behavior:

- if `FORGELOOP_DATABASE_URL` exists, use it and do not clean/drop it
- else inspect Docker containers for a Postgres container with published port and env credentials
- if found, create a temp DB named `forgeloop_dogfood_<timestamp>`
- if not found and `FORGELOOP_DOGFOOD_START_POSTGRES=1`, start a disposable container with a unique name and create DB
- if none available, exit non-zero with actionable setup text
- run:

```bash
pnpm db:push
FORGELOOP_DATABASE_URL=<url> FORGELOOP_REPORT_PATH=<tmp/report> pnpm dogfood:p0
```

- parse report for `DB schema push: PASSED` and `Durable repository restart recovery: PASSED`
- clean up only DB/container created by this script

- [ ] **Step 5: Add script command**

In `package.json`:

```json
"dogfood:p0:durable": "tsx scripts/p0-durable-dogfood.ts"
```

- [ ] **Step 6: Verify GREEN**

Run:

```bash
pnpm vitest run tests/smoke/p0-dogfood-script.test.ts tests/smoke/p0-durable-dogfood-script.test.ts
pnpm dogfood:p0:durable
```

Expected: PASS on a machine with reachable Docker Postgres or provided `FORGELOOP_DATABASE_URL`; otherwise the script should fail with the expected actionable setup message.

- [ ] **Step 7: Commit**

```bash
git add scripts/p0-dogfood.ts scripts/p0-durable-dogfood.ts package.json README.md tests/smoke/p0-dogfood-script.test.ts tests/smoke/p0-durable-dogfood-script.test.ts
git commit -m "test: add durable dogfood command"
```

## Task 5: Opt-In Real Local Codex Dogfood

**Files:**
- Create: `scripts/p0-local-codex-dogfood.ts`
- Modify: `packages/executor/src/source-repo-guard.ts` only if the script cannot compose the guard injection externally
- Modify: `packages/executor/src/local-codex-evidence.ts` only if evidence capture needs an explicit dogfood-only hook
- Modify: `packages/run-worker/src/run-worker.ts` only if the hook must be triggered by worker orchestration
- Modify: `package.json`
- Modify: `README.md`
- Test: `tests/smoke/p0-local-codex-dogfood-script.test.ts`
- Test: `tests/executor/source-repo-guard.test.ts` if any executor/worker hook file changes

- [ ] **Step 1: Write failing local Codex dogfood preflight tests**

Create `tests/smoke/p0-local-codex-dogfood-script.test.ts`:

- disabled env exits with a clear skipped/disabled message and non-zero or documented neutral code
- preflight requires Codex command/runtime
- preflight refuses a dirty source checkout unless `FORGELOOP_LOCAL_CODEX_DOGFOOD_ALLOW_DIRTY=1` is set
- dirty override is accepted only when dirty files are limited to the Task 5 expected file set, and the report records the override
- builds fallback command with `codex exec --json --dangerously-bypass-approvals-and-sandbox`
- validates runtime metadata assertions for `local_codex`, worktree path, and dangerous mode
- validates app-server launch/connection is attempted before `codex exec` fallback
- validates fallback reason is recorded when app-server is unavailable and exec fallback is used
- validates public live events are observed before the terminal state, not only after polling completion
- validates terminal evidence includes changed files, checks, artifacts, and a Review Packet artifact/path
- validates source guard injection plan creates a harmless source-checkout mutation path and cleanup path

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run tests/smoke/p0-local-codex-dogfood-script.test.ts
```

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement disabled-by-default script**

In `scripts/p0-local-codex-dogfood.ts`:

- export testable helpers
- `main()` exits early unless `FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1`
- preflight checks `codex` availability and repo cleanliness
- refuse dirty source checkouts by default; only allow dirty state when `FORGELOOP_LOCAL_CODEX_DOGFOOD_ALLOW_DIRTY=1` and the dirty file list is a strict subset of:
  - `scripts/p0-local-codex-dogfood.ts`
  - `package.json`
  - `README.md`
  - `tests/smoke/p0-local-codex-dogfood-script.test.ts`
  - `packages/executor/src/source-repo-guard.ts`
  - `packages/executor/src/local-codex-evidence.ts`
  - `packages/run-worker/src/run-worker.ts`
  - `tests/executor/source-repo-guard.test.ts`
- record any dirty override and exact dirty file list in the dogfood report
- creates a bounded package with `executor_type: local_codex`
- attempts the `codex app-server` execution path first and records that attempt in runtime metadata
- falls back to `codex exec --json --dangerously-bypass-approvals-and-sandbox` only when app-server preflight/connection fails, recording the fallback reason
- starts run through API
- opens the public event stream or repeated public backfill immediately after run start and records at least one non-terminal live event before final status
- polls events until terminal without using timeout alone as the success signal
- validates runtime metadata includes `executor_type: local_codex`, source worktree path, app-server attempt, selected execution mode, and dangerous bypass mode where exec fallback is used
- validates terminal evidence includes changed files, checks, artifacts, and a Review Packet artifact/path suitable for review handoff

- [ ] **Step 4: Implement source guard injection phase**

Add an explicit dogfood-only env/config hook, for example:

```text
FORGELOOP_DOGFOOD_INJECT_SOURCE_MUTATION=1
```

Use it around evidence/source guard capture to create a harmless temp file outside `.worktrees/<run-session-id>`, assert the run fails with operator-attention/source mutation metadata, then remove the temp file.

Implementation order:

- first try to implement injection entirely inside `scripts/p0-local-codex-dogfood.ts` by composing a source snapshot, temporary mutation, and the existing source guard/evidence check
- if the current executor APIs do not expose a composition point, add the smallest dogfood-only injection seam in `source-repo-guard.ts`, `local-codex-evidence.ts`, or `run-worker.ts`
- if an executor/worker seam is added, cover it with `tests/executor/source-repo-guard.test.ts`

Do not ask real Codex to perform the forbidden mutation.

- [ ] **Step 5: Add script command**

In `package.json`:

```json
"dogfood:p0:local-codex": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/p0-local-codex-dogfood.ts"
```

- [ ] **Step 6: Verify GREEN without real Codex**

Run:

```bash
pnpm vitest run tests/smoke/p0-local-codex-dogfood-script.test.ts
pnpm dogfood:p0:local-codex
```

Expected: helper tests PASS. Command fails fast or exits with documented disabled status when the env flag is not set.

- [ ] **Step 7: Verify real Codex path if available**

Run only if local Codex runtime is available:

```bash
FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1 FORGELOOP_LOCAL_CODEX_DOGFOOD_ALLOW_DIRTY=1 pnpm dogfood:p0:local-codex
```

Expected: PASS only when the dirty override is limited to the expected Task 5 files above, or after committing Task 5 and rerunning without `FORGELOOP_LOCAL_CODEX_DOGFOOD_ALLOW_DIRTY`. If runtime is unavailable, record the exact preflight blocker and do not claim real Codex dogfood passed.

- [ ] **Step 8: Commit**

If the source guard/evidence hook required executor or worker changes, stage those touched files:

```bash
git add packages/executor/src/source-repo-guard.ts packages/executor/src/local-codex-evidence.ts packages/run-worker/src/run-worker.ts tests/executor/source-repo-guard.test.ts
```

Then stage the script/docs/test files and commit:

```bash
git add scripts/p0-local-codex-dogfood.ts package.json README.md tests/smoke/p0-local-codex-dogfood-script.test.ts
git commit -m "test: add opt-in local codex dogfood"
```

## Task 6: Reports and Full Verification

**Files:**
- Modify: `docs/superpowers/reports/p0-delivery-loop-verification.md`
- Modify: `README.md`

- [ ] **Step 1: Run verification before Task 6 edits**

Run the deterministic, durable, and browser commands before editing `README.md` or the verification report so optional real Codex preflight can see the clean post-Task-5 worktree:

```bash
pnpm dogfood:p0
pnpm dogfood:p0:durable
pnpm e2e:run-console
```

Run if local Codex runtime is available:

```bash
FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1 pnpm dogfood:p0:local-codex
```

Expected: PASS from the clean worktree. If runtime is unavailable, record the exact preflight blocker. If the command fails because the worktree is dirty, stop and inspect the unexpected dirty files instead of bypassing the preflight.

- [ ] **Step 2: Update report and README**

Update the committed report so it no longer shows DB durable checks as skipped when `pnpm dogfood:p0:durable` passed. If real Codex dogfood is not enabled or unavailable, report it as intentionally skipped with the exact env flag or preflight blocker.

Update `README.md` to document:

- `X-Forgeloop-Actor-Id`
- stream token SSE flow at a high level
- `pnpm e2e:run-console`
- `pnpm dogfood:p0:durable`
- `FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1 pnpm dogfood:p0:local-codex`
- durable dogfood DB setup/fallback behavior

- [ ] **Step 3: Run final verification**

Run:

```bash
pnpm test
pnpm smoke:p0
pnpm build
pnpm dogfood:p0
pnpm dogfood:p0:durable
pnpm e2e:run-console
git diff --check
```

Do not rerun optional real Codex here while `README.md` or the report are dirty; Step 1 is the canonical real-Codex check for Task 6 because it runs before docs edits. If real Codex becomes available only after Step 2, commit Task 6 docs first, rerun `FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1 pnpm dogfood:p0:local-codex` from the clean worktree, then amend the docs commit with any resulting report note. Expected: all required commands PASS. If real Codex is unavailable, record preflight blocker only for that opt-in command.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/reports/p0-delivery-loop-verification.md
git commit -m "docs: update execution verification report"
```

## Final Review

After Task 6:

- dispatch one full implementation code reviewer over the branch range from `7697ea1` to HEAD
- fix any Critical/Important findings
- rerun relevant verification
- only then present completion status
