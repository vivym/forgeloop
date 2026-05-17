> Superseded historical migration note: this document mentions the old subsystem name for audit history only. Current commands, routes, files, and product docs use delivery terminology.

# Codex Execution Verification Closure Design

## 1. Purpose

The long-running Codex execution slice now has durable run records, live run events, a Web Run Console, deterministic dogfood, and DB-backed repository recovery checks. Four gaps remain before this can be treated as a complete local production-shaped loop:

- durable public API/SSE paths do not have an authenticated actor injection mechanism
- Run Console behavior is not verified in a real browser viewport
- DB-backed dogfood is manually reproducible but not a stable one-command workflow
- real `local_codex` execution is documented as separate from deterministic fake-driver dogfood

This design closes those gaps without introducing a full production identity system, distributed worker scheduler, or CI dependency on a real Codex runtime.

## 2. Goals

- Support authenticated actors in durable mode for run, event backfill, SSE stream, input, cancel, and resume endpoints.
- Keep `actor_id` request body/query fallback limited to explicit `volatile_demo` mode.
- Provide browser E2E coverage for the actual Web Run Console, including desktop and narrow viewport layout checks.
- Provide a one-command durable DB dogfood path that creates or uses a temporary Postgres database, runs schema push, verifies durable recovery, and cleans up.
- Provide an opt-in real `local_codex` dogfood path using Codex app-server first and `codex exec --json --dangerously-bypass-approvals-and-sandbox` fallback.
- Keep deterministic fake-driver dogfood as the default fast verification path.

## 3. Non-Goals

- Do not build a full user account, OAuth, RBAC, or production session management system.
- Do not require real Codex dogfood in default `pnpm test`, default `pnpm dogfood:p0`, or normal CI.
- Do not use the browser visual E2E as a replacement for API and worker tests.
- Do not claim `.worktrees/<run-session-id>` is a security sandbox.
- Do not make durable public API/SSE tests rely on `volatile_demo` actor fallback.

## 4. Architecture

### 4.1 Local Actor Authentication

Add a small development/test actor context boundary for the control-plane API.

For non-SSE HTTP requests, local and test clients can provide:

```text
X-Forgeloop-Actor-Id: actor-owner
```

For browser SSE, use a short-lived stream token because browser `EventSource` cannot set custom headers. The flow is:

```text
Web client with actor header
  -> POST /run-sessions/:id/events/stream-token
  -> returns short-lived token
  -> EventSource /run-sessions/:id/events/stream?stream_token=...
```

The token is a local HMAC-signed payload containing:

- run session id
- actor id
- expiry timestamp
- random nonce

The token secret is read from `FORGELOOP_DEV_AUTH_SECRET` and can fall back to an in-process test/dev secret only outside production. The first implementation does not need a token revocation store because the token is short-lived.

`P0Service.resolveRunActor()` remains the policy gate:

- if an authenticated actor is present, use it
- else if `durabilityMode === 'volatile_demo'` and demo fallback is enabled, use body/query `actor_id`
- otherwise throw `401`

Viewer/operator authorization remains unchanged after actor resolution.

### 4.2 Web Client Actor Flow

The Web app gets a local actor id from existing form state or a compact local setting. API calls send `X-Forgeloop-Actor-Id`. Run Console SSE first requests a stream token, then opens `EventSource` with that token.

In `volatile_demo`, the current `actor_id` query/body flow can remain as a compatibility path, but the Web client should prefer the authenticated actor path so the same UI works in durable mode.

### 4.3 Browser E2E Verification

Add Playwright-based E2E tests that start the API and Web app on random local ports. The test should:

- create a project, repo, approved spec/plan/package, and workflow-only run
- open the Web workbench
- select the run in the Run Console
- verify backfilled events render
- verify SSE appends a new event
- submit input from the UI and verify a visible `user_input` event
- click cancel and resume controls and verify accepted command events
- run at desktop and narrow viewport sizes
- fail if Run Console text overlaps controls or produces horizontal document overflow

The browser E2E should use fake-driver workflow-only runs. Real Codex is covered separately.

### 4.4 Durable DB Dogfood

Add a stable durable dogfood command:

```text
pnpm dogfood:p0:durable
```

It should:

1. Use `FORGELOOP_DATABASE_URL` if provided.
2. Otherwise, discover a reachable local Docker Postgres container by port and environment metadata, then create a temporary database inside that existing server.
3. Run `pnpm db:push`.
4. Run `pnpm dogfood:p0` with `FORGELOOP_DATABASE_URL` and a report path.
5. Verify the report contains `DB schema push: PASSED` and `Durable repository restart recovery: PASSED`.
6. Clean up only databases it created.

The command must not silently skip durable verification. If no `FORGELOOP_DATABASE_URL` is provided and no compatible local Docker Postgres server is reachable, it fails with an actionable message that says how to provide `FORGELOOP_DATABASE_URL` or start a local Postgres. It may optionally start its own disposable Postgres container only behind an explicit opt-in flag such as `FORGELOOP_DOGFOOD_START_POSTGRES=1`; without that flag, it must not create long-lived containers.

The deterministic `pnpm dogfood:p0` remains valid without DB and should still record durable checks as skipped when no database is configured.

### 4.5 Real Local Codex Dogfood

Add an opt-in real Codex dogfood command:

```text
FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1 pnpm dogfood:p0:local-codex
```

The script should fail fast unless the env flag is set. When enabled, it should create a bounded package that asks Codex to make a small allowed-path change, then verify:

- the run uses executor type `local_codex`
- app-server is attempted first
- exec fallback command includes `--json --dangerously-bypass-approvals-and-sandbox` when fallback is used
- `.worktrees/<run-session-id>` is used as the working tree
- runtime metadata records effective dangerous mode
- public run events appear before terminal state
- terminal changed files, checks, artifacts, and Review Packet are produced

Source repo guard verification should be deterministic and should not depend on real Codex choosing to mutate the source checkout. The real Codex dogfood should include a separate guard-injection phase that creates or uses a controlled test hook around evidence capture to mutate a harmless temporary file in the source checkout outside `.worktrees/<run-session-id>`, then asserts the run fails with operator-attention metadata and leaves the source checkout clean after cleanup. The normal successful real Codex run remains a small allowed-path change inside the run worktree.

This command is intentionally excluded from default verification because it depends on the local Codex runtime and can take longer than deterministic tests.

## 5. API Changes

Add these control-plane endpoints:

```text
POST /run-sessions/:runSessionId/events/stream-token
GET  /run-sessions/:runSessionId/events/stream?stream_token=...
```

Existing run event and operator endpoints continue to exist. Their actor resolution changes from body/query-only demo fallback to authenticated actor first.

The token endpoint requires authenticated actor resolution. The stream endpoint accepts either a valid stream token or, in `volatile_demo`, the existing `actor_id` query fallback.

## 6. Data and Security Notes

No persistent auth table is required for this local slice. Stream tokens are signed and short-lived. They should not include secrets beyond actor id, run id, expiry, and nonce.

The actor header is a development/test authentication mechanism, not a production identity provider. Production auth can replace the actor context extractor later without changing `P0Service` authorization rules.

## 7. Testing Strategy

Add tests in this order:

- unit tests for actor context extraction and stream token signing/verification
- API tests for durable mode 401/403/200 behavior on run/events/SSE/input/cancel/resume
- Web API client tests for actor header and SSE token flow
- Playwright Run Console E2E for desktop and narrow viewport
- durable dogfood script tests or smoke assertions for report PASS markers
- gated real Codex dogfood preflight tests that verify disabled-by-default behavior without needing Codex installed

Final verification should include:

```text
pnpm test
pnpm smoke:p0
pnpm build
pnpm dogfood:p0
pnpm dogfood:p0:durable
pnpm e2e:run-console
```

The real Codex dogfood is run separately when the local machine has Codex runtime available:

```text
FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1 pnpm dogfood:p0:local-codex
```

## 8. Acceptance Criteria

- Durable mode rejects body/query-only `actor_id` for protected run endpoints.
- Durable mode accepts authenticated actor requests for run, event backfill, SSE stream token, SSE stream, input, cancel, and resume.
- Forbidden authenticated actors receive `403`.
- Web Run Console works against authenticated actor flow.
- Browser E2E verifies Run Console behavior and layout at desktop and narrow viewport sizes.
- `pnpm dogfood:p0:durable` passes against a temporary DB and cleans up the DB it created.
- `pnpm dogfood:p0:durable` fails with an actionable setup message when no DB URL, reachable Docker Postgres, or explicit disposable-container opt-in is available.
- `pnpm dogfood:p0` remains deterministic and passes without DB or real Codex.
- Real local Codex dogfood is opt-in and fails fast when not enabled.
- When enabled, real local Codex dogfood verifies `executor_type: local_codex`, app-server is attempted before exec fallback, fallback exec uses `--json --dangerously-bypass-approvals-and-sandbox`, `.worktrees/<run-session-id>` is used, dangerous mode is recorded, live events appear before terminal state, terminal evidence is captured, and a Review Packet is produced.
- Real local Codex dogfood also verifies source repo guard behavior through a deterministic guard-injection phase that safely creates and cleans up a harmless source-checkout mutation outside the run worktree.
- Verification reports no longer leave the four closure items as unresolved unless the real Codex opt-in command is intentionally skipped.
