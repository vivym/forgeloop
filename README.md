# ForgeLoop

ForgeLoop is a P0 delivery-loop control plane for taking a Work Item through approved spec, approved plan, execution package, run evidence, AI self-review, review packet, and human review handoff.

## Install

```bash
pnpm install
```

## Local Infra

The repository includes local defaults for Postgres, Redis, and Temporal:

```bash
docker compose up -d postgres redis temporal
```

Default endpoints:

- Postgres: `postgresql://forgeloop:forgeloop@localhost:5432/forgeloop`
- Redis: `redis://localhost:6379`
- Temporal: `localhost:7233`

The current P0 control-plane API test path uses an in-memory repository. Local infra is still useful when running worker and executor processes together.

## Local Services

```bash
pnpm dev:api
pnpm dev:web
pnpm dev:executor
pnpm dev:worker
```

The API defaults to `http://localhost:3000`. The web app is served by Vite, usually at `http://localhost:5173`.

Common environment variables:

- `PORT`: control-plane API port.
- `FORGELOOP_DATABASE_URL`: Postgres connection string for durable mode, for example `postgresql://forgeloop:forgeloop@localhost:5432/forgeloop`.
- `FORGELOOP_API_URL`: API URL used by scripts, default `http://localhost:3000`.
- `VITE_FORGELOOP_API_URL`: API URL used by the web client, default `http://localhost:3000`.
- `FORGELOOP_REPO_PATH`: local repo checkout used for dogfood local_codex runs.
- `FORGELOOP_REPO_ID`: repo id bound to a ForgeLoop project, default `forgeloop`.
- `FORGELOOP_BASE_COMMIT_SHA`: base commit for dogfood local_codex runs, default `git rev-parse HEAD`.
- `FORGELOOP_DEFAULT_BRANCH`: default branch for repo binding, default current git branch or `main`.

When `FORGELOOP_DATABASE_URL` is unset, the control-plane API runs in in-memory `volatile_demo` mode. That mode is useful for local UI smoke work, but API restarts reset data. Set `FORGELOOP_DATABASE_URL` before `pnpm dev:api` to persist projects, packages, run sessions, run events, commands, and worker leases across restarts.

## Test And Build

```bash
pnpm test
pnpm build
pnpm smoke:p0
```

`pnpm smoke:p0` runs `tests/smoke/p0-smoke.test.ts`. It covers:

- Work Item -> Spec approval -> Plan approval -> Package run -> Review approval.
- Work Item -> Spec approval -> Plan approval -> Package run -> changes_requested -> rerun -> new RunSession -> new ReviewPacket -> approve.
- Stale open ReviewPacket archival when `force-rerun` replaces run evidence before human decision.

## Dogfood

Run the deterministic P0 dogfood flow with:

```bash
pnpm dogfood:p0
```

`pnpm dogfood:p0` starts an in-process `volatile_demo` API, creates approved spec/plan/package fixtures, runs fake-driver packages through the async run API, and prints event progress before terminal completion. It verifies:

- `POST /execution-packages/:packageId/run` returns `status: accepted` with a `run_session_id` and no synchronous `workflow_result`.
- `/run-sessions/:id/events` backfills `run_queued` and live driver events.
- `waiting_for_input` is visible before terminal status.
- `POST /run-sessions/:id/input` persists a `user_input` event before worker delivery.
- Rebuilding the API with the same repository preserves event cursor backfill.
- A replacement worker reclaims an expired recoverable run lease and does not duplicate already-applied input.
- Final changed files, checks, artifacts, and Review Packet approval still complete.

Real `local_codex` acceptance is separate from the deterministic fake-driver dogfood pass. For non-mock local Codex runs, start `pnpm dev:api` with `FORGELOOP_DATABASE_URL` when durability matters, bind a repo whose `local_path` points at a local checkout, run a package with `executor_type: local_codex` and `workflow_only: false`, and confirm retained workspace/base-ref evidence.

The dogfood script writes `docs/superpowers/reports/p0-delivery-loop-verification.md` with preflight notes, expected outcomes, and the last dogfood result summary.

## API

Core P0 endpoints include:

- `POST /projects`
- `POST /projects/:projectId/repos`
- `POST /work-items`
- `POST /work-items/:workItemId/specs`
- `POST /specs/:specId/generate-draft`
- `POST /specs/:specId/submit-for-approval`
- `POST /specs/:specId/approve`
- `POST /work-items/:workItemId/plans`
- `POST /plans/:planId/generate-draft`
- `POST /plans/:planId/submit-for-approval`
- `POST /plans/:planId/approve`
- `POST /plan-revisions/:planRevisionId/execution-packages`
- `POST /execution-packages/:packageId/mark-ready`
- `POST /execution-packages/:packageId/run`
- `POST /execution-packages/:packageId/rerun`
- `POST /execution-packages/:packageId/force-rerun`
- `GET /run-sessions/:runSessionId`
- `GET /run-sessions/:runSessionId/events`
- `GET /run-sessions/:runSessionId/events/stream`
- `POST /run-sessions/:runSessionId/input`
- `POST /run-sessions/:runSessionId/cancel`
- `POST /run-sessions/:runSessionId/resume`
- `POST /review-packets/:reviewPacketId/approve`
- `POST /review-packets/:reviewPacketId/request-changes`
- `GET /work-items/:workItemId/cockpit`
- `GET /work-items/:workItemId/timeline`

## Web

Run the web app with:

```bash
pnpm dev:web
```

The web workbench targets the control-plane API and exposes the P0 objects, package run controls, review decisions, cockpit, and evidence views.

To start a local workflow-only run in the web app:

1. Start `pnpm dev:api` and `pnpm dev:web`.
2. Open the Vite URL, create or select a Work Item with approved Spec and Plan, then create and mark an Execution Package ready.
3. In the `Run/Review` panel, keep `Executor` as `mock`, keep `workflow only` checked, and choose `Run`.
4. Select the created run from the `Run` dropdown. The `Run Console` appears in the same `Run/Review` panel and backfills prior events before the SSE stream appends new ones.
5. Use the Run Console input, cancel, and resume controls to create accepted run commands and visible run events.

## P0 Boundaries

P0 stops at persisted evidence and review-approved handoff. It does not push branches, open pull requests, merge changes, deploy, release, or promote to production. Those actions belong to later workflow stages outside the P0 boundary.

Non-mock local Codex runs use `.worktrees/<run-session-id>` below the configured source repo as their Git and evidence boundary. That worktree boundary protects the source checkout from normal run mutations and makes evidence collection explicit, but it is not a security sandbox. Treat permissions, dangerous/yolo mode, and host filesystem access as operator-controlled preflight concerns.
