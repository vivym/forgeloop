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
- `FORGELOOP_API_URL`: API URL used by scripts, default `http://localhost:3000`.
- `VITE_FORGELOOP_API_URL`: API URL used by the web client, default `http://localhost:3000`.
- `FORGELOOP_REPO_PATH`: local repo checkout used for dogfood local_codex runs.
- `FORGELOOP_REPO_ID`: repo id bound to a ForgeLoop project, default `forgeloop`.
- `FORGELOOP_BASE_COMMIT_SHA`: base commit for dogfood local_codex runs, default `git rev-parse HEAD`.
- `FORGELOOP_DEFAULT_BRANCH`: default branch for repo binding, default current git branch or `main`.

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

Start the API first:

```bash
pnpm dev:api
```

Then run:

```bash
FORGELOOP_REPO_PATH=/path/to/forgeloop pnpm dogfood:p0
```

`pnpm dogfood:p0` creates three Work Items against the running API:

- Feature through `local_codex`.
- Bugfix through `local_codex`, including `changes_requested -> rerun -> approve`.
- Test/refactor through `mock` workflow-only execution.

local_codex dogfood acceptance is strict. The script exits non-zero unless the two local_codex items produce approved review packets with changed files, required-check results, a diff artifact, and retained workspace/base-ref evidence from a server-configured local repo checkout. Codex CLI must be available through `codex --version`. Mock/control-flow validation is useful, but it does not replace the required local_codex evidence.

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

## P0 Boundaries

P0 stops at persisted evidence and review-approved handoff. It does not push branches, open pull requests, merge changes, deploy, release, or promote to production. Those actions belong to later workflow stages outside the P0 boundary.
