# HTTP Automation Daemon MVP

The automation daemon is a standalone HTTP-only sidecar for the ForgeLoop control plane. It reads the internal runtime snapshot, plans eligible automation actions, creates or replays durable `automation_action_runs`, claims one action, and executes it through `/internal/automation/*` HTTP commands.

The control plane remains the only authoritative product-state writer. The daemon must not import delivery command services, Nest control-plane modules, database schemas, or repository implementations for product writes.

## Runtime Boundary

- The daemon calls the control plane only through `AutomationHttpClient`.
- Every `/internal/automation/*` request is signed with the trusted automation actor HMAC headers.
- Durable recovery uses `automation_action_runs` only. There is no daemon-local cursor, cache, snapshot table, or `automation_cursors` state.
- The MVP can create Plan drafts, create ExecutionPackage drafts, request manual-path holds, and project runtime policy observations.
- `run_enqueue` is disabled in this MVP. Ready packages can appear in runtime snapshot projections as `run_enqueue_disabled_by_scope`, but the daemon planner and executor must not enqueue runs.

## Required Environment

The daemon process reads configuration from environment variables:

| Variable | Required | Meaning |
| --- | --- | --- |
| `FORGELOOP_CONTROL_PLANE_URL` | yes | Base URL for the control-plane API, for example `http://localhost:3000`. |
| `FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET` | yes | Shared HMAC secret. The control plane must use the same value for internal automation auth. |
| `FORGELOOP_AUTOMATION_DAEMON_IDENTITY` | yes | Stable daemon identity included in signed internal requests and action metadata. |
| `FORGELOOP_AUTOMATION_ACTOR_ID` | yes | Actor id used for automation command attribution. |
| `FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS` | yes | `path.delimiter` separated list of local repo roots the daemon may inspect for `WORKFLOW.md`. |
| `FORGELOOP_AUTOMATION_LOOP_INTERVAL_MS` | no | Main loop delay after a normal iteration. Defaults to `5000`. |
| `FORGELOOP_AUTOMATION_NO_CLAIM_BACKOFF_MS` | no | Backoff delay after no claimable action or an iteration error. Defaults to `10000`. |

Example local startup:

```bash
pnpm dev:api

FORGELOOP_CONTROL_PLANE_URL=http://localhost:3000 \
FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET=local-automation-secret \
FORGELOOP_AUTOMATION_DAEMON_IDENTITY=local-automation-daemon \
FORGELOOP_AUTOMATION_ACTOR_ID=local-automation-actor \
FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS="$PWD" \
pnpm dev:automation-daemon
```

## Allowed Repo Roots

The daemon receives repo local paths from the control-plane runtime snapshot. Before reading any repo-owned policy file, it realpath-resolves the repo root and verifies that it is inside one of `FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS`.

The production loader always reads the fixed repo-relative path `WORKFLOW.md`. It rejects absolute paths, paths that escape the repo, non-file targets, unavailable paths, and symlink escapes. Missing, unsafe, or parse-failed files are reported as policy projection status, not as permission to change execution behavior.

## `WORKFLOW.md` Is Observability Only

`WORKFLOW.md` is read only to compute a normalized digest and parse status for `project_runtime_snapshot` actions. In this MVP, `WORKFLOW.md` must not affect:

- checks, hooks, commands, or executor choice;
- allowed paths or resource limits;
- Plan draft content or ExecutionPackage content;
- package readiness or run eligibility;
- `run_enqueue` behavior.

The only action identity that includes the policy observation is `project_runtime_snapshot`. Draft-generating actions exclude the `WORKFLOW.md` digest from their idempotency keys and command preconditions.

## Dogfood

Run the deterministic automation daemon dogfood with:

```bash
pnpm automation:dogfood
```

The dogfood script boots an in-process in-memory control plane, seeds draft-only automation state, runs the daemon deterministically, and prints a public-safe summary. It exits nonzero unless all MVP conditions are met:

- one Plan draft was created;
- exactly one ExecutionPackage draft was created;
- the completed action types are exactly `ensure_plan_draft`, `ensure_package_drafts`, and `project_runtime_snapshot`;
- restart recovery works through existing `automation_action_runs`;
- no RunSession was enqueued.

The summary intentionally omits raw local paths, HMAC headers, raw repository rows, raw command output, and raw action metadata.
