# HTTP Automation Daemon MVP Design

## Status

Draft approved for spec review.

## Context

The PRD-first automation foundation has landed in the control plane:

- automation capability settings;
- manual path holds;
- command idempotency records;
- execution package generation runs;
- automation action run storage;
- package version compare-and-set;
- daemon-safe plan/package/run command boundaries;
- release gate actor-class hardening.

That work made automatic advancement safe at the authoritative command boundary, but it did not create a real automation daemon. The repository still lacks:

- a standalone `apps/automation-daemon` process;
- a `packages/automation` planner/executor package;
- a dedicated `/internal/automation/*` HTTP boundary;
- a runtime snapshot usable by a daemon planner;
- a read-only repo runtime policy digest channel.

The next step is a narrow daemon MVP that proves ForgeLoop can run an independent PRD-first automation sidecar without copying Symphony's tracker-first workflow and without enabling automatic run enqueue.

## Decision Summary

Build a pure HTTP automation sidecar with draft-only behavior:

- `apps/automation-daemon` runs as an independent process.
- The daemon talks to the control plane only through `/internal/automation/*` HTTP endpoints.
- Internal automation endpoints require trusted actor HMAC signatures in every environment.
- The daemon computes `NextAction`s locally from a runtime snapshot, but the control-plane command boundary remains the final authority.
- `automation_action_runs` is the only durable daemon state.
- The MVP can generate plan drafts and execution package drafts, request manual path holds, and project runtime state.
- The MVP must not enqueue runs.
- `WORKFLOW.md` is read only for safe path validation, parsing status, and digest projection. It does not change checks, paths, hooks, resource limits, or execution behavior in this iteration.
- `P0Service` is treated as a legacy delivery-loop aggregate. This work extracts the automation command boundary into a new automation module but does not perform a full service decomposition.

## Goals

- Create a real automation-daemon process with a clean HTTP-only boundary.
- Keep the control plane as the sole authoritative writer for product state.
- Make daemon actions resumable and multi-instance-safe through `automation_action_runs`.
- Support draft-only PRD advancement:
  - approved current Spec without a Plan draft -> ensure Plan draft;
  - approved current PlanRevision without package generation -> ensure ExecutionPackage drafts;
  - ambiguous/stale/blocked target -> request a manual path hold when appropriate.
- Provide a runtime snapshot that explains why the daemon acted, skipped, retried, or blocked.
- Start a repo-owned runtime policy channel by reading `WORKFLOW.md` safely and projecting digest/status.
- Keep `run_enqueue` disabled and visibly blocked for this scope.
- Reduce new dependency on `P0Service` by extracting automation command logic behind `AutomationCommandService`.

## Non-Goals

- No automatic `run_enqueue`.
- No tracker adapters for Linear, GitHub Issues, Jira, or monitoring systems.
- No full `P0Service` rewrite.
- No executor hook runner, resource governor, structured command runner, or behavior-changing runtime policy.
- No UI redesign. The MVP may expose internal runtime snapshot APIs and smoke scripts, but not a full operator dashboard.
- No public exposure of daemon internals, raw command output, local paths, raw runtime metadata, or raw action-run payloads.

## Architecture

### Process Boundary

`apps/automation-daemon` is a standalone process. It must not import `P0Service`, Nest control-plane modules, repository implementations, or DB schema modules for product writes.

The daemon depends on:

- `packages/automation` for planner, executor, idempotency, HTTP client, and policy digest helpers;
- the control-plane API base URL;
- trusted actor signing configuration;
- configured allowed repo roots for daemon-local filesystem reads;
- local repo filesystem access for read-only `WORKFLOW.md` digest calculation.

All product mutations happen through `/internal/automation/*` HTTP endpoints.

The daemon must not trust `daemon_internal_local_path` just because it came from the control plane. Before reading any repo file, it canonicalizes the path with `realpath` and verifies that the repo root is equal to, or a child of, one of the daemon's configured allowed repo roots after those roots are canonicalized. Repos outside the allowed roots produce policy status `unsafe_path` and no filesystem read.

### Control-Plane Boundary

Add a shared control-plane provider module before adding the automation module:

- `apps/control-plane-api/src/modules/core/control-plane-core.module.ts`
- `apps/control-plane-api/src/modules/core/control-plane-tokens.ts`

The core module owns the existing repository/durability providers that are currently created inside `P0Module`:

- `P0_REPOSITORY`
- `RUN_DURABILITY_MODE`
- `P0_DEMO_ACTOR_ID_FALLBACK`

`P0Module` and the new `AutomationModule` both import this core module. Neither module re-provides the repository. `P0Module` continues to own `RUN_WORKER`, because run execution remains outside the daemon MVP. This avoids a Nest provider cycle and avoids split in-memory state in local/tests.

The shared provider tokens move out of `p0.service.ts` into the core token file so the core module does not import `P0Service`. `P0Service`, `P0Module`, and `AutomationModule` import the tokens from the core file.

Add `apps/control-plane-api/src/modules/automation/`:

- `automation.module.ts`
- `automation.controller.ts`
- `automation-command.service.ts`
- `runtime-snapshot.service.ts`
- `trusted-automation-actor.guard.ts`
- `automation.dto.ts`

The automation module owns new internal HTTP routes and command-boundary orchestration. Existing `/p0/...` automation routes may remain for compatibility, but they delegate to the new service and are not used by the daemon. The dependency direction is:

- `AutomationModule` imports only the core provider module and shared DTO/domain packages.
- `P0Module` imports the core provider module and, where legacy routes need compatibility delegation, `AutomationModule`.
- `AutomationModule` must not import `P0Module` or `P0Service`.

The module extracts these automation command responsibilities from `P0Service`:

- `setAutomationCapabilities`
- `disableAutomation`
- `requestManualPath`
- `resolveManualPath`
- `ensurePlanDraftForApprovedSpec`
- `ensureExecutionPackageDraftsForPlanRevision`
- `enqueueRunIfPackageStillReady`
- command idempotency precondition handling used by those commands
- active-hold and automation capability precondition checks used by those commands

`enqueueRunIfPackageStillReady` can move into the extracted service for architectural cleanliness, but the daemon-facing planner and endpoints do not enable it in this MVP.

### Automation Package

Create `packages/automation`:

- `types.ts`
  - `RuntimeSnapshot`
  - `RuntimeSnapshotRepo`
  - `NextAction`
  - `NoAction`
  - `AutomationPlannerInput`
  - `AutomationExecutorResult`
  - `WorkflowPolicyDigestStatus`
- `planner.ts`
  - pure `planNextActions(snapshot): NextAction[]`
  - no HTTP, filesystem, DB, or time access except through explicit inputs
- `idempotency.ts`
  - stable mutating-action idempotency key generation from action type, target, target revision/version, automation settings version, capability fingerprint, precondition fingerprint, and command-specific keys
  - stable `project_runtime_snapshot` idempotency key generation from action type plus stable policy observation identity only
- `http-client.ts`
  - typed client for `/internal/automation/*`
  - HMAC trusted actor header signing
- `executor.ts`
  - claim action run;
  - execute mapped command;
  - complete, gate-pend, block, or fail the action run
- `policy-digest.ts`
  - shared digest and status helpers for read-only `WORKFLOW.md`

### Automation Daemon

Create `apps/automation-daemon`:

- `package.json`
- `tsconfig.json`
- `src/main.ts`
- `src/automation-daemon.ts`
- `src/config.ts`
- `src/workflow-policy-loader.ts`

The daemon loop:

1. Fetch runtime snapshot.
2. Load read-only `WORKFLOW.md` digest for active repo scopes in the snapshot.
3. Merge digest status into planner input.
4. Compute `NextAction`s.
5. Create or replay action runs in the control plane.
6. Claim the next action run.
7. Execute the mapped action. Draft-generating actions call internal command endpoints; projection-only actions complete their action run with a public-safe projection payload.
8. Complete, gate-pend, block, or fail the action run.
9. Back off and repeat until shut down.

The daemon must handle `SIGINT` and `SIGTERM` by finishing or abandoning the current loop iteration without leaving local state that matters for recovery. Recovery comes from `automation_action_runs`.

## Internal HTTP API

All endpoints live under `/internal/automation`.

### Authentication

Every endpoint requires:

- `X-Forgeloop-Actor-Id`
- `X-Forgeloop-Actor-Class: automation_daemon`
- `X-Forgeloop-Daemon-Identity`
- `X-Forgeloop-Actor-Timestamp`
- `X-Forgeloop-Actor-Body-SHA256`
- `X-Forgeloop-Actor-Signature`

The guard verifies the signature using `FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET`. Missing or invalid signatures return `401`. Any actor class other than `automation_daemon` returns `403`, including `human_admin`.

This requirement applies in local, test, and production environments. Test helpers must sign headers instead of bypassing the guard.

The signed payload is versioned and canonical:

```text
v1
<HTTP method uppercase>
<path and query exactly as received by the control plane>
<lowercase hex SHA-256 of the raw request body, or the empty-body hash>
<X-Forgeloop-Actor-Id>
<X-Forgeloop-Actor-Class>
<X-Forgeloop-Daemon-Identity>
<X-Forgeloop-Actor-Timestamp>
```

`X-Forgeloop-Actor-Signature` is `v1=<lowercase hex HMAC-SHA256>`. Timestamps must be UTC ISO-8601 strings within a five-minute skew window. This MVP does not add a nonce replay table; replay safety inside the timestamp window comes from command idempotency keys, action-run idempotency keys, and claim tokens on all non-read effects.

The internal automation guard is separate from the existing trusted actor helper used by `/p0/...` routes. Slice 1 must add:

- raw-body capture in the Nest HTTP bootstrap and API test setup;
- a guard that recomputes the body SHA from captured raw bytes and rejects any mismatch with `X-Forgeloop-Actor-Body-SHA256`;
- a request helper that computes `X-Forgeloop-Actor-Body-SHA256` from the exact outbound bytes, not from a reparsed JSON object;
- canonical URL signing from `req.originalUrl` or an equivalent framework value that includes the exact path and query received by the control plane;
- shared client/test signing helpers used by `packages/automation` and API tests.

Existing `/p0/...` trusted actor signing can remain compatible while internal automation routes require the stronger v1 contract in every environment.

### Runtime Snapshot

`GET /internal/automation/runtime-snapshot`

Returns a planner-oriented view with:

- project and repo automation settings;
- settings version and capability fingerprint;
- repo local path as internal-only daemon input;
- approved current Specs missing Plan drafts;
- approved current PlanRevisions missing execution package generation;
- package generation status;
- execution package version and policy snapshot status;
- active manual path holds;
- claimable or recent automation action run summaries;
- disabled `run_enqueue` reason;
- policy digest status when available from the latest completed `project_runtime_snapshot` action run.

The response must omit raw DB rows, secrets, raw runtime metadata, raw command output, action-run `result_json`, action-run `metadata_json`, and public-unsafe local paths in any field intended for non-daemon projection.

### Action Run Lifecycle

`POST /internal/automation/actions`

Creates or replays an action run. The body includes:

- action type;
- target object type/id;
- target revision id or target version when applicable;
- target status summary;
- automation scope;
- automation settings version;
- capability fingerprint;
- idempotency key;
- precondition fingerprint;
- stable policy observation identity for `project_runtime_snapshot` only;
- allowlisted action input payload;
- public-safe reason/summary.

The control plane creates the row as `pending`. It returns the existing action run for a matching idempotency key and matching identity/precondition. It returns `409 command_idempotency_conflict` if the key is reused for a different mutating command target, target version, or precondition, or for a different `project_runtime_snapshot` stable policy observation identity.

This endpoint requires domain/schema/repository refinements in Slice 2:

- add `target_version` and `precondition_fingerprint` to `AutomationActionRun` and `automation_action_runs`;
- add `action_input_json` to `AutomationActionRun` and `automation_action_runs` for allowlisted command input needed after restart;
- add `createOrReplayAutomationActionRun(input)` that creates/replays `pending` rows without claiming them;
- for mutating actions, compare action type, target object type/id, target revision id, target version, target status, automation scope, automation settings version, capability fingerprint, precondition fingerprint, and full `action_input_json` when deciding replay vs conflict;
- for `project_runtime_snapshot`, compare only action type plus the stable policy observation identity when deciding replay vs conflict. Automation scope, settings version, capability fingerprint, observed timestamp, and last-known-good fields may be recorded for context/result projection, but they do not participate in idempotency or replay/conflict comparison.
- preserve the current `claimAutomationActionRun` behavior only as an internal helper if useful, not as the HTTP create/replay contract.

`action_input_json` is intentionally public-safe. For mutating actions, the full `action_input_json` is part of the durable action identity. For `project_runtime_snapshot`, only the stable policy observation identity fields are part of the durable identity; observation timestamp and last-known-good fields are result/projection details. It is the only durable command payload the daemon may use after a restart; the daemon must not re-plan from a newer snapshot to fill in missing command inputs for an already-created action.

`POST /internal/automation/actions:claim-next`

Claims one claimable action run. Claimable means:

- `pending`;
- `gate_pending` with `next_attempt_at` absent or due;
- `failed` or `blocked` only when `retryable=true` and `next_attempt_at` is absent or due;
- `running` only when `locked_until` has expired.

Request fields:

- daemon identity;
- optional automation scope filter;
- optional repo/project filter derived from daemon configuration;
- claim token;
- lease duration or explicit `locked_until`;
- current timestamp.

Response fields:

- action id;
- action type;
- target object type/id;
- target revision id or target version;
- automation scope;
- automation settings version;
- capability fingerprint;
- precondition fingerprint;
- idempotency key;
- allowlisted action input payload;
- claim token;
- attempt;
- locked until;
- public-safe reason/summary.

Claiming is repository-fenced so multiple daemons cannot execute the same action at the same time. Slice 2 must add an atomic `claimNextAutomationActionRun(input)` repository method. The method filters by scope/project/repo when provided, orders by `coalesce(next_attempt_at, created_at), created_at, id`, updates exactly one row to `running` with the new claim token and lease inside a transaction/object lock, and returns `undefined` when there is no claimable row. If another daemon wins the same candidate, the method retries the next candidate in the same call or returns `undefined`; it must not surface a spurious fatal error for normal claim races.

### Action Claim Binding

Every draft command endpoint validates the claimed action before product writes. Given `action_run_id`, `claim_token`, and the command request body, `AutomationCommandService` must load the action run and verify:

- status is `running`;
- claim token matches and lease has not expired;
- action type matches the endpoint (`ensure_plan_draft`, `ensure_package_drafts`, or `request_manual_path`);
- target object type/id and target revision/version match the command target;
- idempotency key matches the command idempotency key;
- automation settings version, capability fingerprint, and precondition fingerprint match;
- persisted `action_input_json` matches the command input fields needed by that endpoint.

If any check fails, the endpoint returns a stable `409` or `422` without writing product state. Projection-only actions do not call draft command endpoints; their binding is enforced by claim lifecycle plus completion with the same action id/idempotency key.

`POST /internal/automation/actions/:id/complete`

Marks a claimed action run as terminal success with public-safe result summary.

`POST /internal/automation/actions/:id/gate-pending`

Marks a claimed action run as waiting for a gate with an optional next attempt timestamp.

`POST /internal/automation/actions/:id/block`

Marks a claimed action run as blocked and non-retryable unless explicitly marked retryable by the control plane.

`POST /internal/automation/actions/:id/fail`

Marks a claimed action run as failed. Retryability and next attempt timestamp are explicit.

### Draft-Only Commands

`POST /internal/automation/work-items/:workItemId/ensure-plan-draft`

Requires:

- idempotency key;
- current SpecRevision id;
- automation settings version;
- capability fingerprint;
- automation precondition;
- action run id and claim token.

The command re-reads WorkItem, current Spec, current SpecRevision, automation settings, and active holds inside the authoritative command boundary before writing. It returns existing Plan/PlanRevision ids when the draft already exists.

`POST /internal/automation/plan-revisions/:planRevisionId/ensure-package-drafts`

Requires:

- idempotency key;
- generation key;
- automation settings version;
- capability fingerprint;
- automation precondition;
- action run id and claim token.

The command re-reads PlanRevision, Plan, WorkItem, current SpecRevision, automation settings, package generation run, and active holds before writing. It returns stable package ids for duplicate requests.

`POST /internal/automation/manual-path-holds`

Creates a daemon-origin manual path hold when the planner cannot safely advance. The daemon may request a hold, but it cannot resolve one. Hold creation requires a canonical `scope_key` and daemon-origin automation precondition.

### Durable Action Input

Each action type defines an allowlisted `action_input_json` envelope:

- `ensure_plan_draft`
  - `work_item_id`
  - `spec_revision_id`
- `ensure_package_drafts`
  - `plan_revision_id`
  - `generation_key`
- `request_manual_path`
  - `object_type`
  - `object_id`
  - `scope_key`
  - `reason_code`
  - `reason`
- `project_runtime_snapshot`
  - `repo_id`
  - `policy_status`
  - `policy_digest`
  - `parser_version`
  - `reason_code`

For `project_runtime_snapshot`, the stable policy observation identity is:

- `repo_id`
- `policy_status`
- `policy_digest`
- `parser_version`
- `reason_code`

The projection idempotency key, precondition fingerprint, and replay/conflict comparison all use exactly that stable observation identity. `observed_at`, `last_known_good_policy_digest`, and `last_known_good_observed_at` are completion-result fields only. They must not participate in idempotency, precondition, or replay comparison, so repeated observation of the same missing/loaded/failed policy does not create heartbeat rows or idempotency conflicts.

The executor uses this persisted envelope, plus the claim token and action identity fields, to call command endpoints. No action can be created unless its required action input envelope is complete. Controllers may return this envelope on create/replay/claim responses because it is public-safe by construction, but they still must not return raw `metadata_json`.

### Projection-Only Actions

`project_runtime_snapshot` has no separate product mutation endpoint. It uses only the action-run lifecycle:

1. `POST /internal/automation/actions` creates or replays an action run with `action_type=project_runtime_snapshot`, `target_object_type=repo`, the repo id, automation settings version, capability fingerprint, policy digest when available, and a precondition fingerprint equal to the stable policy observation identity.
2. `POST /internal/automation/actions:claim-next` claims it like any other action.
3. The executor does not call a draft command. It calls `POST /internal/automation/actions/:id/complete` with a public-safe result summary containing policy status, parser version, digest when loaded, reason code when not loaded, and observed timestamp.

The completed projection result envelope is allowlisted:

- `repo_id`
- `policy_status`
- `policy_digest`
- `parser_version`
- `reason_code`
- `observed_at`
- `last_known_good_policy_digest`
- `last_known_good_observed_at`

`RuntimeSnapshotService` may derive repo policy projection fields from the latest completed `project_runtime_snapshot` action run for that repo and stable policy observation identity, ordered by `finished_at desc, updated_at desc, id desc`. Projection lookup and duplicate suppression do not filter by automation scope. They must expose only curated projection fields, not raw action-run `result_json` or `metadata_json`. Slice 2/3 must add a repository query for latest completed projection action runs by repo plus stable policy observation identity. No separate runtime snapshot table, local daemon cache, `automation_cursors` state, or additional daemon recovery table is introduced for this MVP. The existing `automation_cursors` table remains unused.

### Response DTO Boundaries

Internal automation endpoints must return explicit DTOs, not raw `AutomationActionRun`, repository rows, exceptions, or runtime metadata objects.

Allowed action-run response fields are:

- action id, action type, target object type/id, target revision id, target version, target status;
- automation scope, automation settings version, capability fingerprint, precondition fingerprint;
- allowlisted `action_input_json`;
- status, attempt, retryable flag, next attempt timestamp, public-safe reason/error code;
- claim token and locked-until only on claim responses to the daemon that just claimed the action;
- curated public-safe result summary only for terminal responses that need it.

Forbidden response fields include raw `result_json`, raw `metadata_json`, raw command output, raw runtime metadata, raw stack traces, local paths outside daemon-internal snapshot input fields, HMAC signatures, and secret-bearing config/env values. Snapshot and action lifecycle controllers must serialize through allowlist mappers.

## Runtime Snapshot Semantics

The runtime snapshot is both daemon input and operator evidence. It is not a second source of truth.

Snapshot rows must include enough information for pure planning:

- target ids;
- current revision ids;
- target versions when revision ids are not the right concurrency token;
- package versions;
- settings versions;
- capability fingerprints;
- active hold fingerprints;
- latest relevant action run state;
- policy digest/status derived from the latest completed `project_runtime_snapshot` action run when known;
- disabled run enqueue reason.

The command boundary must treat snapshot values as preconditions, not as facts. Every mutating endpoint re-reads current state and rejects stale actions.

`run_enqueue` must appear as disabled in the snapshot for this MVP. Ready execution packages may be projected as `run_enqueue_disabled_by_scope`, but planner output must not include executable enqueue actions.

Minimum snapshot DTO shape:

- `RuntimeSnapshot`
  - `generated_at`
  - `projects[]`
  - `repos[]`
  - `work_items_requiring_plan[]`
  - `plan_revisions_requiring_packages[]`
  - `recent_action_runs[]`
  - `run_enqueue_disabled_reason`
- `RuntimeSnapshotRepo`
  - `project_id`
  - `repo_id`
  - `automation_scope`
  - `automation_settings_version`
  - `capability_fingerprint`
  - `daemon_internal_local_path`
  - `policy_projection`
- `RuntimeSnapshotTarget`
  - target object type/id
  - target revision id or target version
  - target status
  - repo/project scope
  - active hold fingerprint
  - latest matching action status
  - explicit blocked/no-action reason when not eligible

`daemon_internal_local_path` is for daemon input only and must never be copied into public projection fields.

## Planner Semantics

`planNextActions(snapshot)` can emit:

- `ensure_plan_draft`
- `ensure_package_drafts`
- `request_manual_path`
- `project_runtime_snapshot`

It must not emit:

- `enqueue_run`
- release gate mutation actions
- review approval actions
- capability update actions
- external tracker mutation actions

Eligibility rules:

- Plan draft generation requires `canGeneratePlanDraft`.
- Package draft generation requires `canGeneratePackageDrafts`.
- WorkItem, SpecRevision, PlanRevision, package generation, and relevant ancestor holds suppress mutating actions.
- Terminal WorkItems are not eligible.
- Multi-repo ambiguity produces `request_manual_path` or no action with a clear blocked reason, not guessed repo selection.
- Existing matching mutating action run in terminal success suppresses duplicate action creation unless target revision/version, settings version, capability fingerprint, or precondition fingerprint changes.
- Existing matching `project_runtime_snapshot` action run in terminal success suppresses duplicate action creation unless the stable policy observation identity changes.
- Existing pending/running action run suppresses duplicate creation and lets claim-next arbitrate execution.
- `project_runtime_snapshot` is emitted only when the daemon has a new or changed repo policy observation to project, or when no completed projection exists for a repo included in the snapshot. It is not a heartbeat action and must not create one durable row per loop when nothing changed.

Mutating action idempotency keys include:

- action type;
- target object type/id;
- target revision id or target version;
- automation scope;
- settings version;
- capability fingerprint;
- precondition fingerprint;
- generation key for package generation.

`project_runtime_snapshot` idempotency keys include only action type plus the stable policy observation identity: repo id, policy status, policy digest when present, parser version, and reason code when present. They exclude target revision/version, automation scope, settings version, capability fingerprint, observed timestamp, and last-known-good fields.

`NextAction` shape:

- `action_type`
- target object type/id
- target revision id or target version
- automation scope
- automation settings version
- capability fingerprint
- precondition fingerprint
- idempotency key
- allowlisted action input payload
- optional policy digest/status/parser version/reason code fields for `project_runtime_snapshot`
- public-safe reason code and summary

For mutating actions, `precondition_fingerprint` is computed from a canonical JSON object containing the target current revision/version, target status, automation settings version, capability fingerprint, active hold fingerprint, and command-specific concurrency token such as generation key. It excludes `WORKFLOW.md` policy digest. For `project_runtime_snapshot`, the precondition fingerprint is the stable policy observation identity because that action is only an observability projection.

Draft-generating actions must not include `policy_digest` in their idempotency key or command precondition. `WORKFLOW.md` changes are observability-only in this MVP and must not cause duplicate Plan drafts, duplicate ExecutionPackage drafts, or stale mutating command preconditions. `project_runtime_snapshot` is the only action type whose identity includes the stable policy observation identity.

## WORKFLOW.md Policy Digest

This MVP introduces only a read-only policy digest channel.

The daemon loads `WORKFLOW.md` from the repo root in the runtime snapshot. The loader:

- verifies the canonical repo root is under an allowed daemon repo root before reading;
- canonicalizes the repo root;
- resolves only the repo-relative `WORKFLOW.md` path;
- rejects absolute policy paths;
- rejects outside-repo paths;
- rejects symlink escapes;
- rejects root-equal policy paths;
- parses YAML front matter when present;
- computes a digest over the normalized policy content and parser version;
- records status.

The production daemon always calls the loader with the fixed repo-relative path `WORKFLOW.md`. `packages/automation/policy-digest.ts` also exposes a lower-level testable helper that accepts a candidate repo-relative policy path, defaulting to `WORKFLOW.md`, so unit tests can verify absolute path, root-equal path, outside-repo path, and symlink escape rejection without adding a runtime configuration surface.

Current-load statuses:

- `missing`
- `loaded`
- `parse_failed`
- `unsafe_path`

Snapshot projection can also report:

- `last_known_good`

Policy digest affects:

- snapshot observability;
- `project_runtime_snapshot` action idempotency/precondition fingerprint;
- diagnostics for future runtime safety.

Policy digest does not affect:

- required checks;
- allowed or forbidden paths;
- hooks;
- resource limits;
- executor choice;
- package generation content;
- run enqueue eligibility.

`last_known_good` is not daemon-local state. It is derived by `RuntimeSnapshotService` from the most recent completed `project_runtime_snapshot` action run for the same repo whose current-load status was `loaded`. When a later observation is `parse_failed` or `unsafe_path`, the completed projection action may include both the current failure status and the previous loaded digest/status returned by the runtime snapshot. If no prior loaded projection exists, the snapshot reports the current failure without `last_known_good`.

If policy loading fails, draft-only automation can still proceed unless another control-plane gate blocks it. The failure must remain visible in the snapshot and the public-safe action run result summary.

## Error Handling

### Authentication Errors

- Missing signed actor headers -> `401`.
- Invalid signature or expired timestamp -> `401`.
- Signed actor class not equal to `automation_daemon` -> `403`.
- Missing daemon identity -> `401`.

### Stale Preconditions

Return deterministic `409` or `422` responses with stable error codes:

- `automation_precondition_stale`
- `automation_gate_blocked`
- `automation_target_terminal`
- `automation_hold_active`
- `command_idempotency_conflict`

The daemon maps these to action run states:

- stale but likely transient -> `gate_pending`;
- active hold or manual intervention required -> `blocked`;
- idempotency conflict or schema mismatch -> `failed` with `retryable=false`.

### Manual Path Holds

Daemon-origin holds:

- must include source action id or idempotency key;
- must include canonical scope key;
- must include public-safe reason code and reason;
- must return the original hold for duplicate source action/idempotency;
- cannot be resolved by an automation daemon actor.

### Retry and Backoff

Retryable failures are limited to transport errors, 5xx responses, claim expiration, and explicit retryable gate-pending outcomes. Planner bugs, invalid target/precondition shape, and idempotency conflicts are terminal failures.

### Redaction

Internal automation responses and snapshots must not include:

- HMAC secrets or signatures;
- raw exception stack traces;
- raw command output;
- raw action result payloads;
- raw runtime metadata;
- local paths in public projection fields;
- secret-bearing env/config values.

Local repo paths may appear only in daemon-internal snapshot fields required for reading `WORKFLOW.md`, and those fields must never be reused by public query or web endpoints.

## Testing Strategy

### Control Plane Automation Module

Add API tests for:

- `/internal/automation/*` rejects unsigned requests;
- `/internal/automation/*` rejects signed non-daemon actors;
- `/internal/automation/*` rejects signatures with a mismatched raw body hash or altered query string;
- signed daemon actor can call snapshot/action endpoints;
- draft command endpoints reject missing, expired, or wrong claim tokens;
- draft command endpoints reject an action run whose action type, target, idempotency key, automation settings version, capability fingerprint, precondition fingerprint, or `action_input_json` does not match the command body;
- legacy `/p0/...` automation routes still pass existing tests;
- extracted `AutomationCommandService` preserves existing command behavior.

Focused commands:

```bash
pnpm test tests/api/automation-commands.test.ts tests/api/run-auth.test.ts
```

### Action Run Lifecycle

Add tests for:

- create stores a `pending` action run and does not claim it;
- create rejects missing required `action_input_json` fields;
- create/replay by idempotency key;
- idempotency conflict on target, target version, precondition fingerprint, mutating action input mismatch, or stable policy observation identity mismatch for `project_runtime_snapshot`;
- claim-next returns one action to one daemon;
- claim-next returns `undefined`/empty response when no action is claimable;
- concurrent claim-next calls cannot claim the same action;
- expired running action can be reclaimed;
- complete/gate-pending/block/fail require matching claim token;
- retryable failed/gate-pending action becomes claimable after `next_attempt_at`.

### Runtime Snapshot

Add tests for:

- approved Spec missing Plan draft appears;
- approved PlanRevision missing package drafts appears;
- active holds suppress mutating eligibility;
- terminal WorkItem is blocked or absent;
- ready package reports `run_enqueue_disabled_by_scope`;
- latest completed `project_runtime_snapshot` projection appears with last-known-good when applicable;
- snapshot redacts raw action results and runtime metadata.

### Automation Package

Add unit tests for:

- planner action selection;
- no `enqueue_run` output;
- idempotency key stability;
- mutating action idempotency key changes on settings version, capability fingerprint, and target revision/version changes;
- `project_runtime_snapshot` idempotency key changes on stable policy observation identity changes;
- HTTP client signs all required trusted actor headers;
- executor maps stale/gate/blocked/failure responses to correct action run completion calls.

### Automation Daemon

Add daemon integration tests using an in-process control-plane API server:

- seed approved Spec with `draft_only`;
- daemon creates Plan draft through HTTP;
- daemon creates ExecutionPackage drafts through HTTP;
- daemon creates or replays action runs;
- daemon does not enqueue a RunSession;
- daemon can restart and continue from `automation_action_runs`.

### WORKFLOW.md Digest

Add tests for:

- missing policy;
- repo root outside configured allowed roots -> `unsafe_path`;
- valid digest stability;
- invalid front matter -> `parse_failed`;
- symlink/outside/root-equal path -> `unsafe_path`;
- last-known-good retained after a later parse failure;
- draft-only action still planned while policy status is `parse_failed`.

### Full Verification

Required before merge:

```bash
pnpm test
pnpm -r build
git diff --check
pnpm automation:dogfood
```

The dogfood script must explicitly assert that no run session was enqueued by the daemon.

## Delivery Slices

### Slice 1: Automation Module Extraction

- Create `apps/control-plane-api/src/modules/core/control-plane-core.module.ts`.
- Move shared provider tokens out of `p0.service.ts` into the core module area.
- Move repository and durability providers from `P0Module` into the core module.
- Update existing modules and tests that import repository/durability tokens, including Query and Release modules, to import the new core tokens or a deliberate compatibility re-export.
- Create `apps/control-plane-api/src/modules/automation`.
- Move automation command boundary into `AutomationCommandService`.
- Add signed daemon guard, raw-body capture, and shared signing test helpers.
- Keep existing `/p0/...` compatibility routes.

### Slice 2: Automation Package Skeleton and Action Run HTTP Lifecycle

- Create `packages/automation` with shared types, idempotency, HMAC signing helpers, and policy digest helpers needed by tests and control-plane clients.
- Add `@forgeloop/automation` to `tsconfig.base.json` paths and update the bootstrap/path-alias contract test.
- Add `target_version` and `precondition_fingerprint` to domain/schema mappings for `automation_action_runs`.
- Add `action_input_json` to domain/schema mappings for `automation_action_runs`.
- Add repository methods for pending create/replay, atomic claim-next, and latest completed projection lookup.
- Add active action-claim binding validation helpers for draft command endpoints.
- Add action create/replay/claim/complete/gate-pending/block/fail endpoints.
- Back them with the refined repository action-run methods.
- Support `project_runtime_snapshot` as a projection-only action type through the same lifecycle.

### Slice 3: Runtime Snapshot

- Implement `RuntimeSnapshotService`.
- Replace repository placeholder `listRuntimeSnapshotRows()` usage with typed snapshot assembly or remove the placeholder if not needed.
- Derive policy projection and last-known-good status from completed `project_runtime_snapshot` action runs.
- Define and use allowlisted runtime snapshot, action-run, claim, and policy projection DTO mappers.
- Include redaction tests.

### Slice 4: Automation Daemon Loop

- Create `apps/automation-daemon`.
- Add daemon config and shutdown handling.
- Add `automation:dogfood` script.

### Slice 5: Read-Only WORKFLOW.md Digest

- Wire daemon `WORKFLOW.md` loading into the loop and enforce configured allowed repo roots.
- Include digest status in snapshot and `project_runtime_snapshot` action idempotency.
- Keep behavior-changing runtime policy out of scope.

## Definition Of Done

- The daemon is a separate process and uses HTTP only.
- Internal automation endpoints require signed `automation_daemon` actor headers in every environment.
- Draft-only automation can create Plan drafts and ExecutionPackage drafts from eligible PRD state.
- `automation_action_runs` is the only daemon recovery state.
- Runtime snapshot explains action eligibility, skip reasons, active holds, and run enqueue disabled state.
- `WORKFLOW.md` digest is visible and safe, but does not influence execution.
- No automatic RunSession enqueue occurs.
- Existing P0 compatibility tests pass.
- Full test/build/diff verification passes.
