# ForgeLoop

ForgeLoop is a delivery-loop control plane for taking a Work Item through approved spec, approved plan, execution package, run evidence, AI self-review, review packet, and human review handoff.

## Install

```bash
pnpm install
cp .env.example .env
```

## Local Infra

The repository includes local defaults for Postgres, Redis, and Temporal:

```bash
docker compose up -d postgres redis temporal
```

Default endpoints:

- Postgres: `postgresql://forgeloop:forgeloop@localhost:35432/forgeloop`
- Redis: `redis://localhost:6379`
- Temporal: `localhost:7233`

The current delivery control-plane API test path uses an in-memory repository. Local infra is still useful when running worker and executor processes together.

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
- `FORGELOOP_POSTGRES_PORT`: local Docker Compose host port for Postgres, default `35432`.
- `FORGELOOP_DATABASE_URL`: Postgres connection string for durable mode, for example `postgresql://forgeloop:forgeloop@localhost:35432/forgeloop`.
- `FORGELOOP_ATTACHMENT_STORAGE_ROOT`: local directory for attachment binaries, default `.forgeloop/attachments`.
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
pnpm smoke:delivery
```

`pnpm smoke:delivery` runs the smoke suite, including `tests/smoke/delivery-smoke.test.ts`. It covers:

- Work Item -> Spec approval -> Plan approval -> ready package evidence.
- Public package `run`, `rerun`, and `force-rerun` routes returning the retired-entrypoint 410 response without creating run state.
- Review evidence remaining stable when retired package rerun routes are requested.

## Dogfood

Run the deterministic Plan Item Workflow product-loop dogfood flow with:

```bash
pnpm dogfood:plan-item-workflow-product-loop
```

`pnpm dogfood:plan-item-workflow-product-loop` starts an in-process `volatile_demo` API, creates a workflow-backed Plan Item, drives Superpowers-style document gates, and starts execution through the workflow-owned command path. It verifies:

- `POST /plan-item-workflows/:workflowId/execution/start` returns workflow-owned execution continuity evidence.
- `POST /execution-packages/:packageId/run`, `/rerun`, and `/force-rerun` are retired public entrypoints that return `410` with `legacy_execution_entrypoint_disabled`.
- `/run-sessions/:id/events` backfills `run_queued` and live driver events.
- `waiting_for_input` is visible before terminal status.
- `POST /run-sessions/:id/input` persists a `user_input` event before worker delivery.
- Rebuilding the API with the same repository preserves event cursor backfill.
- A replacement worker reclaims an expired recoverable run lease and does not duplicate already-applied input.
- Final changed files, checks, artifacts, and Review Packet approval still complete.

Real runtime acceptance is separate from the deterministic fake-driver dogfood pass. It is opt-in and disabled by default:

```bash
pnpm dogfood:plan-item-workflow-product-loop:real
FORGELOOP_REAL_RUNTIME_ACCEPTANCE=1 pnpm dogfood:plan-item-workflow-product-loop:real
```

`pnpm dogfood:plan-item-workflow-product-loop:real` exits with a documented skipped status unless `FORGELOOP_REAL_RUNTIME_ACCEPTANCE=1` is set. When enabled, it uses the workflow-owned Plan Item command path, proves single Codex session continuity across Brainstorming, Spec Doc, and Implementation Plan Doc turns, and verifies that execution package runtime state is not created before the workflow reaches `execution_ready`.

The old package-run dogfood commands were retired with the public package run routes. Product execution must enter through `POST /plan-item-workflows/:workflowId/execution/start`, not through an Execution Package `run`, `rerun`, or `force-rerun` command.

## API

Core delivery endpoints include:

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
- `POST /plan-item-workflows/:workflowId/execution/start`
- Retired tombstone routes: `POST /execution-packages/:packageId/run`, `/rerun`, and `/force-rerun` return `410 legacy_execution_entrypoint_disabled`.
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

The web workbench targets the control-plane API and exposes delivery objects, Plan Item Workflow execution, review decisions, cockpit, and evidence views.

To start a workflow-owned execution in the web app:

1. Start `pnpm dev:api` and `pnpm dev:web`.
2. Open the Vite URL, create or select a Plan Item, and drive the workflow through Brainstorming, Spec, and Implementation Plan approval.
3. When the workflow reaches execution readiness, start execution from the Plan Item Workflow execution gate.
4. Select the created run from the run view. The Run Console backfills prior events before the SSE stream appends new ones.
5. Use the Run Console input, cancel, and resume controls to create accepted run commands and visible run events.

## Delivery Boundaries

Delivery stops at persisted evidence and review-approved handoff. It does not push branches, open pull requests, merge changes, deploy, release, or promote to production. Those actions belong to later workflow stages outside the delivery boundary.

Non-mock local Codex runs use `.worktrees/<run-session-id>` below the configured source repo as their Git and evidence boundary. That worktree boundary protects the source checkout from normal run mutations and makes evidence collection explicit, but it is not a security sandbox. Treat permissions, dangerous/yolo mode, and host filesystem access as operator-controlled preflight concerns.
