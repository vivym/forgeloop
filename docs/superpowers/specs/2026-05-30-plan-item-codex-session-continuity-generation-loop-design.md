# Plan Item Codex Session Continuity And Generation Loop Design

## Status

Draft umbrella design for multi-wave implementation.

## Purpose

ForgeLoop now has the document-native product model and a strict Codex runtime dogfood path on `main`, but the product loop still lacks one foundational capability: a Plan Item must be able to move through Brainstorming, Spec Doc generation, Implementation Plan Doc generation, and execution inside one continuous Codex conversation.

This spec defines the larger architecture needed to make that true across multiple implementation waves. It is intentionally broader than one implementation slice.

## Authority

This spec extends and supersedes conflicting runtime-continuity assumptions from:

- `docs/superpowers/specs/2026-05-25-codex-runtime-superpowers-dogfood-closure-design.md`;
- `docs/superpowers/specs/2026-05-28-codex-runtime-real-dogfood-pass-design.md`;
- `docs/superpowers/specs/2026-05-29-document-native-product-model-redesign-design.md`.

Those specs remain authoritative for:

- document-native product hierarchy;
- Boundary Brainstorming product semantics;
- current generation and run-execution runtime fences;
- no-shared-filesystem worker safety;
- public-safe dogfood evidence requirements.

This spec is authoritative for:

- ForgeLoop-managed Codex Session objects;
- binding a Plan Item workflow to a real Codex thread/session id returned by Codex;
- persisting and restoring Codex session state across worker processes;
- internal artifact store requirements for Codex session snapshots;
- single-writer session leases;
- session fork semantics;
- Plan Item Workflow source-of-truth rules;
- multi-wave implementation order.

## Problem

The current remote generation runtime is safe but not session-continuous.

Current behavior:

- each generation action can materialize a fresh per-task `CODEX_HOME`;
- Dockerized Codex app-server receives centralized config/auth;
- the app-server creates a thread and turn for the current generation;
- the worker terminalizes evidence and cleans up the task filesystem;
- generated payloads and public-safe evidence are stored as artifacts or artifact refs.

That is not enough for the product goal.

The user requirement is stricter:

```text
One Plan Item workflow must use one continuous Codex session across
Brainstorming -> Spec Doc -> Implementation Plan Doc -> Execution.
```

Starting a fresh Codex session for every stage is not acceptable because:

- it wastes Codex quota and context budget;
- it loses the conversational state accumulated during Superpowers brainstorming;
- it makes the product look continuous while the runtime is actually discontinuous;
- it diverges from the user's expected Superpowers workflow, where brainstorming, spec, plan, and execution remain part of one coherent working context.

The product can still expose multiple gate stages. The runtime must preserve one Codex session unless the user explicitly forks or abandons it.

## Core Decision

ForgeLoop must introduce a first-class `CodexSession` control object and a private Codex session snapshot mechanism.

Product stages are separate:

```text
Plan Item Workflow
  -> Boundary Brainstorming
  -> Spec Doc Review
  -> Implementation Plan Doc Review
  -> Execution
  -> Code Review
  -> QA
  -> Release Readiness
```

Codex conversation continuity is not separate:

```text
one active CodexSession
  -> one real Codex thread/session id
  -> many turns
  -> many stage outputs
  -> one latest private session snapshot
```

ForgeLoop must not generate fake Codex session ids. Codex creates the real thread/session id. ForgeLoop binds it after the first successful app-server response.

## Non-Goals

- No direct source document to Spec, Implementation Plan Doc, or execution path.
- No return to generic Work Item Owner semantics or generic task pages.
- No generic Task extraction from Implementation Plan Doc checkbox content.
- No automatic hidden session recreation after session loss.
- No automatic merge of forked Codex sessions.
- No public download of raw Codex session snapshots.
- No use of product Attachments for Codex session snapshots.
- No requirement to introduce S3, R2, GCS, or MinIO in the first wave.
- No long-lived worker process held open while a human reviewer waits for hours.
- No reliance on worker-local `~/.codex` at runtime.

## Product Semantics

### Plan Item Workflow

A `PlanItemWorkflow` is the product workflow instance for one Plan Item entering the Superpowers path.

It belongs to exactly one Development Plan and exactly one Plan Item.

This is not an optional UI helper. It is the authoritative workflow contract and persisted DB/API object for Superpowers-backed Plan Item work.

Contract shape:

```ts
type PlanItemWorkflow = {
  id: string;
  development_plan_id: string;
  plan_item_id: string;
  status:
    | 'not_started'
    | 'brainstorming'
    | 'boundary_review'
    | 'spec_generation_queued'
    | 'spec_review'
    | 'implementation_plan_generation_queued'
    | 'implementation_plan_review'
    | 'execution_ready'
    | 'execution_running'
    | 'code_review'
    | 'qa'
    | 'release_ready'
    | 'blocked'
    | 'archived';
  active_codex_session_id?: string;
  active_boundary_summary_revision_id?: string;
  active_spec_doc_revision_id?: string;
  active_implementation_plan_doc_revision_id?: string;
  execution_package_id?: string;
  created_by_actor_id: string;
  created_at: string;
  updated_at: string;
};
```

The workflow is the product object. The Codex session is the runtime continuity object.

Source-of-truth rules:

- `PlanItemWorkflow.status` is the only source of truth for Superpowers workflow stage.
- Existing `DevelopmentPlanItem` status fields may show projections for list views, but they must not own Superpowers transitions.
- Existing `BrainstormingSession`, Spec Doc, Implementation Plan Doc, automation action run, runtime job, run session, and review packet records may reference a `PlanItemWorkflow`.
- Those records must not own `active_codex_session_id`.
- Only the Plan Item Workflow service may transition between Boundary, Spec Doc, Implementation Plan Doc, execution, code review, QA, and release-readiness stages.
- Source documents, Requirement Documents, Bug Documents, Tech Debt Documents, and Initiative Documents may feed a Development Plan and Plan Item context package, but they cannot enqueue Spec Doc, Implementation Plan Doc, or execution directly.
- API and UI routes that mutate Superpowers state must address the Plan Item Workflow or a child object under it.
- Migrations must delete or replace any public route, DTO, or command that can start Superpowers generation outside the Plan Item Workflow path.

### Codex Session

`CodexSession` is ForgeLoop's control-plane object for one continuous Codex conversation.

Suggested shape:

```ts
type CodexSession = {
  id: string;
  owner_type: 'plan_item_workflow';
  owner_id: string;
  parent_session_id?: string;
  forked_from_snapshot_id?: string;
  fork_reason?: string;
  codex_thread_id?: string;
  codex_thread_id_digest?: string;
  status:
    | 'starting'
    | 'idle'
    | 'running'
    | 'blocked'
    | 'recovering'
    | 'forked'
    | 'archived';
  latest_snapshot_id?: string;
  latest_snapshot_digest?: string;
  latest_turn_id?: string;
  latest_turn_digest?: string;
  lease_epoch: number;
  runtime_profile_id: string;
  runtime_profile_revision_id: string;
  credential_binding_id: string;
  credential_binding_version_id: string;
  active_lease_id?: string;
  locked_by_worker_id?: string;
  lock_expires_at?: string;
  created_at: string;
  updated_at: string;
};
```

Rules:

- ForgeLoop creates `CodexSession.id`.
- Codex creates `codex_thread_id`.
- `codex_thread_id` is written only after Codex returns it.
- Raw Codex thread ids are internal runtime metadata and should not be shown in normal product UI.
- Product UI may show creation time, last continuation time, and product-safe continuity status.
- Raw thread ids, snapshot refs, manifest metadata, and digests belong in trusted worker protocols and admin/operator diagnostics only.
- One active Plan Item Workflow may have only one active CodexSession.
- Forks create additional CodexSession records but do not replace the active session until a human explicitly chooses the fork.

### Stage Turns

Every Codex interaction is represented as a stage turn.

Suggested shape:

```ts
type CodexSessionTurn = {
  id: string;
  codex_session_id: string;
  workflow_id: string;
  stage:
    | 'boundary_brainstorming'
    | 'boundary_change_request'
    | 'spec_generation'
    | 'spec_change_request'
    | 'implementation_plan_generation'
    | 'implementation_plan_change_request'
    | 'execution'
    | 'execution_continue'
    | 'code_review_response';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'stale';
  input_digest: string;
  expected_previous_snapshot_digest?: string;
  output_snapshot_digest?: string;
  codex_thread_id_digest?: string;
  lease_id?: string;
  lease_epoch?: number;
  automation_action_run_id?: string;
  runtime_job_id?: string;
  created_by_actor_id: string;
  created_at: string;
  updated_at: string;
};
```

Turns are not independent sessions. They are resumptions of the same CodexSession.

## Internal Artifact Store

ForgeLoop needs an internal artifact store abstraction before session snapshots can be reliable.

### Store Interface

The first implementation should define an object-store-shaped interface:

```ts
interface ArtifactStore {
  putObject(input: PutArtifactObjectInput): Promise<ArtifactObjectRef>;
  getObject(ref: ArtifactObjectRef): Promise<ReadableStream | NodeJS.ReadableStream>;
  statObject(ref: ArtifactObjectRef): Promise<ArtifactObjectMetadata>;
  deleteObject(ref: ArtifactObjectRef): Promise<void>;
}
```

Non-authoritative high-level metadata, with exact DTO/storage contracts owned by the Wave 1 Internal Artifact Store spec:

```ts
type ArtifactObject = {
  id: string;
  ref: string;
  kind:
    | 'codex_session_snapshot'
    | 'codex_runtime_job_artifact'
    | 'workspace_bundle'
    | 'generated_payload'
    | 'execution_patch'
    | 'review_packet'
    | 'logs'
    | 'raw_metadata';
  content_type: string;
  size_bytes: string;
  digest: string;
  visibility: 'internal' | 'private';
  owner_type: string;
  owner_id: string;
  created_at: string;
};
```

Wave 1's dedicated Internal Artifact Store spec is authoritative for canonical ref shape, upload transport, idempotency, local filesystem layout, and runtime-job/workspace-bundle migration. This umbrella intentionally defers to that spec for detailed store mechanics.

This store is broader than existing generated-payload or runtime-job artifacts. Implementers may adapt the current `CodexRuntimeJobArtifact` upload path as a backend detail, but they must not create a second product-visible artifact model for session snapshots. `CodexSessionSnapshot.artifact_ref` must point to an internal ArtifactStore object with internal/private visibility, digest verification, and trusted worker access controls.

### v0 Backend

v0 should use a local filesystem backend:

```text
FORGELOOP_ARTIFACT_STORE_ROOT=/var/lib/forgeloop/artifacts
```

The interface must not expose local absolute paths to product DTOs. Returned refs use `artifact://` URIs.

Canonical refs are defined by the Wave 1 Internal Artifact Store spec. Examples:

```text
artifact://internal/codex_session_snapshot/codex_session/{codex_session_id}/{snapshot_id}
artifact://internal/codex_runtime_job_artifact/codex_runtime_job/{runtime_job_id}/{artifact_id}
artifact://internal/workspace_bundle/run_session/{run_session_id}/{bundle_id}
```

Future backends may include S3, R2, GCS, or MinIO without changing product models.

### Why Not Attachments

Codex session snapshots must not be stored as product Attachments.

Attachments are user-visible evidence or document assets. Codex session snapshots are internal runtime state that can include:

- raw conversation history;
- tool call traces;
- local file names;
- repository context;
- model/tool metadata;
- potentially sensitive prompts or command output.

They require a stricter visibility and access model.

## Codex Session Snapshot

### Snapshot Purpose

A `CodexSessionSnapshot` is the private portable state needed to resume the same Codex session on a later worker.

It is not a public transcript. It is not a user attachment. It is not a substitute for normalized product artifacts.

Suggested shape:

```ts
type CodexSessionSnapshot = {
  id: string;
  codex_session_id: string;
  codex_thread_id_digest: string;
  sequence: number;
  artifact_ref: ArtifactObjectRef;
  digest: string;
  size_bytes: string;
  manifest_digest: string;
  codex_version?: string;
  runtime_profile_revision_id: string;
  created_from_turn_id?: string;
  created_at: string;
};
```

### Snapshot Manifest

Every snapshot archive includes a manifest:

```json
{
  "schema_version": "codex_session_snapshot_manifest.v1",
  "codex_session_id": "forge-session-1",
  "codex_thread_id_digest": "sha256:...",
  "snapshot_sequence": 3,
  "included_files": [
    {
      "path": "sessions/2026/05/30/rollout-....jsonl",
      "digest": "sha256:...",
      "size_bytes": "123456"
    }
  ],
  "excluded_patterns": [
    "auth.json",
    "config.toml",
    "cache/**",
    "tmp/**",
    "run/**"
  ]
}
```

### Snapshot Whitelist

The worker must package only the Codex state required to resume the conversation.

Allowed examples:

- Codex session/thread JSONL files;
- Codex rollout/session metadata required by app-server resume;
- safe index metadata required to locate the thread.

Forbidden examples:

- `auth.json`;
- `config.toml`;
- provider tokens;
- refresh tokens;
- API keys;
- sockets;
- temp files;
- caches not required for resume;
- raw worker environment dumps;
- repository worktree contents;
- Docker/container metadata beyond digests;
- absolute host paths in manifest fields.

If the worker cannot distinguish required session state from forbidden material, it must fail closed and mark the CodexSession `blocked`.

### Snapshot Restore

To resume:

1. Worker claims a CodexSession lease.
2. Control plane returns latest snapshot ref, digest, runtime profile, credential binding, and the next turn payload.
3. Worker downloads the snapshot through ArtifactStore.
4. Worker verifies digest and manifest.
5. Worker restores snapshot files into a freshly materialized `CODEX_HOME`.
6. Worker writes only current centralized config/auth into `CODEX_HOME`.
7. Worker starts Codex app-server.
8. Worker resumes the existing Codex thread id.
9. Worker runs the next turn.
10. Worker packages and uploads a new snapshot.
11. Worker terminalizes the turn and CAS-updates the session latest snapshot.

Config/auth are never sourced from the snapshot.

### Worker `CODEX_HOME` Topology

The current disposable `CODEX_HOME` topology is insufficient for snapshots if the live state only exists inside container tmpfs. The worker must use one of these explicit topologies:

1. Preferred v0 topology: create a host-owned, snapshotable state directory under the task root, restore snapshot files there, bind-mount it as `/codex-home`, and bind-mount centralized config/auth from a separate read-only secret seed directory.
2. Accepted fallback: keep container tmpfs for `/codex-home`, but perform a mandatory `docker cp` or container-side archive extraction from live `/codex-home` before stopping the container.

In both topologies:

- restore happens before app-server start;
- config/auth are copied or mounted after restore and are never included in the next snapshot;
- snapshot packaging happens before launcher `close()` and before task-root cleanup;
- packaging rejects symlinks, hardlinks, device files, path escapes, absolute paths, and files outside the whitelist;
- packaging produces relative manifest paths only;
- live state extraction failure marks the session `blocked` and must not silently continue without a snapshot;
- worker logs may include public-safe failure codes but must not print raw snapshot contents, token material, or raw Codex thread ids.

The implementation plan must update the Docker command, app-server launcher, task filesystem lifecycle, and remote worker runbook together. A wave is not complete if snapshots only work in non-Docker unit tests.

## Single-Writer Session Lease

Only one worker may run a CodexSession at a time.

Why:

- two workers restoring the same snapshot would create divergent local session state;
- two concurrent turns against the same Codex thread can interleave unpredictably;
- two uploaded snapshots cannot be safely merged automatically.

Lease acquisition must be compare-and-set:

```text
claim session where
  status = idle
  latest_snapshot_digest = expected_previous_snapshot_digest
  active_lease_id is null
```

On success:

```text
status = running
active_lease_id = lease-id
locked_by_worker_id = worker-id
lease_epoch = previous lease_epoch + 1
lock_expires_at = now + ttl
```

First-turn acquisition uses `expected_previous_snapshot_digest = null` and requires `latest_snapshot_digest is null`.

Every session mutation after acquisition must carry lease fencing fields:

```text
codex_session_id
active_lease_id
locked_by_worker_id
lease_epoch
worker_session_digest
```

The control plane must reject mutation, snapshot upload finalization, terminalization, status transition, or first-thread-id binding unless the current session row still matches all lease fencing fields.

On terminal success:

```text
expected_previous_snapshot_digest must still match
active_lease_id must still match
locked_by_worker_id must still match
lease_epoch must still match
latest_snapshot_id = new_snapshot_id
latest_snapshot_digest = new_snapshot_digest
status = idle or next product status
active_lease_id = null
```

On failure:

- recoverable runtime failure moves session to `idle` or `blocked` depending on failure code;
- missing snapshot, digest mismatch, unsafe snapshot, or resume failure moves session to `blocked`;
- user-visible UI shows a public-safe blocker code and next action.

Lease expiry is a recovery signal, not permission to run a second concurrent turn. When a lease expires:

- no new worker may immediately start another turn against the same session;
- the session moves to `recovering` or `blocked`;
- operators or recovery automation must fence or cancel the old runtime job first;
- terminalization from a non-current, expired, or fenced lease is recorded as `stale` and must not update `latest_snapshot_*`, product stage, or active thread binding;
- TTL and renewal cadence must be shorter than runtime job timeout and documented in the runbook.

## Fork Semantics

Fork is required, but it must be explicit.

Supported fork reasons:

- explore alternative technical approach;
- preserve a rejected Spec or Plan direction;
- recover from a confused AI path without destroying history;
- retry execution from an approved checkpoint;
- compare two implementation approaches before selecting one.

Suggested shape:

```ts
type CodexSessionFork = {
  id: string;
  parent_session_id: string;
  child_session_id: string;
  fork_point_snapshot_id: string;
  fork_point_snapshot_digest: string;
  reason: string;
  created_by_actor_id: string;
  created_at: string;
};
```

Fork rules:

- a fork creates a new CodexSession from a selected snapshot;
- child and parent sessions advance independently;
- no automatic merge of snapshots is allowed;
- product users may choose which fork is active for the Plan Item Workflow;
- inactive forks are archived or kept as alternatives;
- choosing a fork must be recorded as a decision event.

## Product Gate Automation

The selected automation behavior is:

```text
human approval gates remain mandatory;
approved gates auto-enqueue the next generation turn.
```

Flow:

1. Tech Lead starts Brainstorming from Plan Item.
2. CodexSession starts and asks questions.
3. Human answers in the Plan Item workspace.
4. Same CodexSession continues until Boundary Summary is proposed.
5. Human approves Boundary Summary.
6. System automatically enqueues Spec Doc generation in the same CodexSession.
7. Human reviews or requests changes on Spec Doc.
8. Approved Spec Doc automatically enqueues Implementation Plan Doc generation in the same CodexSession.
9. Human reviews or requests changes on Implementation Plan Doc.
10. Approved Implementation Plan Doc unlocks execution-readiness evaluation.
11. Execution Ready requires approved Spec Doc revision, approved Implementation Plan Doc revision, current Plan Item revision, required QA or test-strategy signoff for the Plan Item risk class, a validated runnable internal Execution Package boundary, and release or QA handoff links where applicable.
12. Execution runs in the same CodexSession when started.

Request changes are turns in the same session. They do not create a new session.

Approved documents are necessary but not sufficient for execution. The gate must preserve PRD shift-left QA responsibilities and must not allow "approved plan" to bypass test strategy, runnable package validation, or handoff requirements.

## UI Requirements

### Plan Item Workspace

The Plan Item page must show:

- current workflow stage;
- active CodexSession status;
- last turn time;
- whether the next action is waiting on human or AI;
- Boundary transcript;
- Spec Doc revision and review state;
- Implementation Plan Doc revision and review state;
- Execution readiness;
- blocked reason and recovery actions;
- explicit fork action;
- session history/fork list for technical leaders.

### Context Visibility

The user does not need to inspect raw snapshots, but they need trust.

Show a Context Preview before generation and execution:

- linked source documents;
- Development Plan and Plan Item revision;
- approved Boundary Summary revision;
- approved Spec Doc revision;
- approved Implementation Plan Doc revision;
- repo/ref/worktree policy;
- product-safe continuity state such as "Codex context continuity verified", "last successful continuation", or "continuity stale/blocked";
- stale blockers.

Do not expose raw Codex session files, snapshot digests, manifest metadata, snapshot refs, or raw thread ids in the normal Plan Item workspace. Technical leaders may open an explicitly technical diagnostics drawer if needed; admin/operator screens may show digests and refs for support.

### Recovery Actions

Blocked session UI must offer only explicit actions:

- retry same turn if the snapshot is safe and lease is clear;
- fork from latest good snapshot;
- fork from approved Boundary Summary;
- fork from approved Spec Doc;
- archive session;
- explicitly abandon and start a new CodexSession.

Starting a new session must warn that it breaks continuous Codex context and may spend extra quota.

## Runtime Changes

### App-Server Driver

The app-server generation driver must support:

- starting a new thread only for the first turn of a CodexSession;
- resuming an existing thread for later turns;
- returning raw thread id internally;
- persisting only a digest or internal-only field to public-facing records;
- producing enough metadata for snapshot validation.

Thread binding is a trusted protocol contract:

- first-turn terminalization must return `codex_thread_id`, `codex_thread_id_digest`, and Codex turn id through an internal-only worker/control-plane field or trusted session endpoint;
- the control plane binds `CodexSession.codex_thread_id` only when it is currently null and all lease fencing fields match;
- later-turn workloads include `existing_codex_thread_id` or an internal handle that resolves to it;
- the driver must skip `thread/start` for later turns and use the verified app-server resume/turn method;
- if restored state cannot resume the requested thread id, the session becomes `blocked`;
- resume failure must never fall back to creating a replacement thread;
- replacing a thread is allowed only through explicit abandon/new-session or fork action recorded on the Plan Item Workflow.

### Worker Filesystem

The worker must change from purely disposable `CODEX_HOME` to restore-and-snapshot `CODEX_HOME`:

```text
fresh task root
  -> restore previous snapshot if present
  -> write centralized config/auth
  -> run app-server turn
  -> package sanitized session snapshot
  -> upload snapshot
  -> cleanup task root
```

The task root is still disposable. Continuity comes from snapshots.

### Remote Worker Protocol

Accepted generation jobs for session turns must include:

- `codex_session_id`;
- `turn_id`;
- `stage`;
- `lease_id`;
- `lease_epoch`;
- `worker_session_digest`;
- `expected_previous_snapshot_digest`;
- latest snapshot ref when present;
- `existing_codex_thread_id` or trusted internal thread handle when this is not the first turn;
- runtime profile and credential binding ids;
- owner workflow and Plan Item refs;
- product precondition fingerprint.

Terminalization must include:

- lease fencing fields;
- first-turn raw thread id through internal-only transport when binding is needed;
- Codex thread id digest;
- Codex turn id;
- new snapshot ref;
- new snapshot digest;
- snapshot sequence;
- output artifact refs;
- public-safe evidence;
- failure code when blocked.

Existing runtime job artifact upload APIs may be reused behind the store implementation only if they satisfy the internal ArtifactStore visibility, digest, and access contract. They must not become a parallel public artifact path for Codex session snapshots.

## Security And Privacy

Hard requirements:

- session snapshots are internal visibility only;
- public APIs never return raw snapshot URIs unless the caller is a trusted worker or admin-only internal endpoint;
- normal Plan Item product DTOs must not expose raw thread ids, snapshot refs, manifest metadata, or snapshot digests;
- snapshot package and manifest must not contain credentials;
- snapshot restore verifies digest before use;
- snapshot upload computes digest after packaging;
- session lock updates use lease-fenced CAS;
- unsafe snapshots fail closed;
- public-safe blocker reports contain only codes, counts, and high-level status;
- digest-level troubleshooting data appears only in trusted worker payloads, technical diagnostics drawers, or admin/operator screens.

The no-shared-filesystem rule still applies. Snapshot transfer must go through the control-plane ArtifactStore, not direct worker-to-worker filesystem sharing.

## Wave Plan

### Wave 1: Internal Artifact Store Foundation

Goal: introduce a reusable internal artifact store abstraction with a local filesystem backend.

Deliverables:

- `ArtifactStore` interface;
- `FileSystemArtifactStore` implementation;
- metadata table or repository methods for internal artifact objects;
- `artifact://` URI validation and safe key rules;
- internal-only visibility support;
- worker/control-plane upload and download APIs for trusted workers;
- tests for path traversal, local path leakage, digest mismatch, and visibility fences.

Acceptance:

- workers can upload and download internal artifacts by ref;
- public DTOs do not expose local paths;
- no product Attachment path is used for session snapshots.

### Wave 2: Codex Session Data Model And Lease

Goal: create `CodexSession`, `CodexSessionTurn`, `CodexSessionSnapshot`, and lease semantics.

Deliverables:

- authoritative `PlanItemWorkflow` contract schema, DB model, repository, and transition service;
- contract schemas;
- DB schema and repository APIs;
- create CodexSession only through Plan Item Workflow service;
- ensure existing BrainstormingSession, Spec Doc, Implementation Plan Doc, automation action run, runtime job, and run session records reference workflow/session instead of owning workflow status;
- claim/release session lease with lease epoch and worker session digest fencing;
- CAS update of latest snapshot;
- session blocked/recovering/retry/archive states;
- fork metadata model;
- tests for single-writer behavior, first-turn null snapshot CAS, expired lease fencing, and stale snapshot rejection.

Acceptance:

- two workers cannot claim or terminalize the same session concurrently;
- expired leases cannot be overtaken until recovery fences or cancels the old runtime job;
- stale terminal updates cannot overwrite newer snapshots;
- no public route, DTO, or service can start Superpowers generation outside Plan Item Workflow;
- fork creates a separate child session without mutating the parent.

### Wave 3: App-Server Resume Protocol Support

Goal: stop starting a new Codex thread for every generation stage and define the trusted thread-binding protocol before snapshot restore depends on it.

Deliverables:

- verify the current Codex app-server resume method and payload;
- driver input supports `existing_codex_thread_id` or trusted internal thread handle;
- first turn captures Codex thread id, digest, and Codex turn id through internal-only terminalization;
- first-turn thread binding uses lease-fenced CAS where `CodexSession.codex_thread_id` is null;
- later turns skip `thread/start` and call the verified resume/turn method;
- resume failure produces a blocked session without creating a replacement thread;
- tests cover first-turn start/bind, later-turn resume, resume failure, and no fallback to replacement thread.

Acceptance:

- Brainstorming follow-up, Spec generation, and Implementation Plan Doc generation can run as turns in one live Codex thread within one worker lifecycle;
- terminal evidence records one stable `codex_thread_id_digest`;
- first-turn thread binding cannot be overwritten by stale terminalization;
- app-server resume failure moves session to blocked and does not create a replacement thread automatically.

### Wave 4: Snapshot Packaging And Restore

Goal: make worker runtime preserve Codex session continuity across separate worker processes.

Deliverables:

- inspect Codex app-server session file layout;
- whitelist required session files;
- implement the worker `CODEX_HOME` topology change for Docker runtime;
- package snapshot archive with manifest;
- exclude config/auth/secrets/cache/tmp/socket files;
- restore snapshot into fresh `CODEX_HOME`;
- verify manifest and digest;
- upload new snapshot after each turn;
- public-safe blocked reasons for unsafe, missing, or unextractable live state.

Acceptance:

- same real Codex thread can be resumed across separate worker runs;
- snapshot sequence increments monotonically;
- config/auth are re-materialized from centralized records, not snapshot;
- deleting, corrupting, or making the snapshot unsafe blocks the session instead of silently starting a new one;
- Docker integration proves the worker can extract and upload live `/codex-home` state before cleanup.

### Wave 5: Plan Item Workflow Product Loop

Goal: expose the session-continuous workflow on Plan Item pages and APIs.

Deliverables:

- Plan Item Workflow API;
- start/resume Brainstorming action;
- answer/request-change/approve actions;
- auto-enqueue next generation after approval;
- Spec Doc generation in same CodexSession;
- Implementation Plan Doc generation in same CodexSession;
- execution-ready state;
- Context Preview;
- blocked recovery actions;
- route tests and product fixture updates.

Acceptance:

- Source Documents cannot generate Spec/Plan/execution directly;
- Plan Item is the only entry point;
- approved Boundary Summary auto-enqueues Spec generation;
- approved Spec Doc auto-enqueues Implementation Plan Doc generation;
- approved Implementation Plan Doc unlocks execution-readiness evaluation but does not bypass QA/test-strategy and Execution Package gates;
- all actions reference the same active CodexSession unless an explicit fork is selected;
- persisted evidence shows one stable `codex_thread_id_digest`, monotonic `CodexSessionSnapshot.sequence`, and each turn's `expected_previous_snapshot_digest` equals the previous successful output;
- no stage creates a replacement Codex thread unless an explicit fork or abandon/new-session action is recorded.

### Wave 6: Execution Handoff Continuity

Goal: prove the approved Implementation Plan Doc hands a runnable execution turn into the run-execution boundary without losing the Codex session.

Deliverables:

- execution-readiness evaluator;
- required QA/test-strategy signoff model for Plan Item risk classes;
- internal Execution Package boundary validation;
- execution turn creation from approved Plan Item Workflow;
- generation-to-execution handoff contract mapping runtime job, run session, workspace bundle, snapshot ref, lease fields, and Plan Item Workflow refs;
- run-execution worker restores the latest session snapshot and resumes the same `codex_thread_id_digest`;
- execution artifacts link to the same Plan Item Workflow.

Acceptance:

- execution cannot start until Spec Doc, Implementation Plan Doc, Plan Item revision, QA/test strategy, and Execution Package gates pass;
- implementation work is not started in a fresh unrelated Codex session;
- the first execution turn records the same stable `codex_thread_id_digest` as generation turns;
- handoff tests prove snapshot ref, lease fencing, run session, and execution artifacts stay under the same Plan Item Workflow.

### Wave 7: Execution Continuation, Review Response, And Fix Loops

Goal: support interruption, continuation, code review response, and fix loops without breaking session continuity.

Deliverables:

- continue-after-interruption action;
- code review response turn action;
- fix-loop continuation action;
- stale terminalization handling for interrupted execution turns;
- recovery tests for interrupted execution worker, missing snapshot, stale lease, and rejected resume;
- product recovery UI for continue, fork, abandon/new-session, and archive choices.

Acceptance:

- interruptions can resume from the latest safe snapshot;
- code review response and fix loops continue the same Codex session;
- stale execution terminalization cannot overwrite a newer continuation;
- fallback to a new session requires explicit human action and warning.

### Wave 8: Fork, Recovery, And Operations

Goal: make the system robust for real team usage.

Deliverables:

- explicit fork UI and API;
- choose active fork action;
- archive inactive sessions;
- session recover/scavenge command;
- snapshot retention policy;
- session health dashboard for operators;
- runbook updates.

Acceptance:

- forks are auditable;
- old worker leases can be recovered safely;
- snapshot retention does not delete active session state;
- operators can diagnose blocked sessions without raw secret exposure.

## Verification Strategy

Each implementation wave must include:

- contract tests for new DTOs and enums;
- repository tests for lease-fenced CAS behavior;
- runtime unit tests for snapshot package/restore safety;
- worker integration tests for upload/download;
- API tests for Plan Item workflow actions;
- fixture or dogfood evidence that the same real Codex thread digest is preserved whenever the wave claims continuity;
- no-baggage scans for retired public names;
- `pnpm test`;
- `pnpm build`;
- `git diff --check`.

Waves touching UI must include route tests and browser/screenshot verification for the affected Plan Item workflow screens.

Waves touching runtime session continuity must include at least one dogfood or smoke path that proves separate worker processes can resume the same Codex thread.

## Acceptance Criteria For The Full Program

The program is complete when:

- every Plan Item workflow has at most one active CodexSession unless explicitly forked;
- Brainstorming, Spec Doc generation, Implementation Plan Doc generation, and execution can run as turns in the same Codex session;
- Codex-created thread/session id is bound after the first turn and reused later;
- acceptance evidence proves the same real `codex_thread_id_digest` across stages, not only the same ForgeLoop `CodexSession.id`;
- session state survives worker cleanup through private snapshots;
- workers restore session state only through ArtifactStore, not shared local filesystem;
- snapshots exclude config/auth/secrets and fail closed on unsafe content;
- one session can be claimed and terminalized by only one current lease at a time;
- approved gates auto-enqueue the next generation turn without skipping human review, QA/test-strategy signoff, or Execution Package validation;
- forks are explicit, auditable, and never auto-merged;
- product UI makes session status, blocked reasons, and context preview understandable to Tech Leads without exposing raw runtime metadata in normal workflows;
- starting a replacement session is explicit and warns about lost context and extra quota.

## Open Questions For Implementation Planning

- The exact Codex app-server method and payload for resuming an existing thread must be verified against the current bundled Codex version before Wave 3 is implemented.
- The exact Codex session file whitelist must be discovered empirically during Wave 4.
- Snapshot archive format should be chosen during Wave 1 or Wave 4. `tar.zst` is preferred for production, but `tar.gz` may be acceptable if project dependencies make zstd awkward.
- Retention policy should default conservative: keep all snapshots for active sessions until a later operations wave defines pruning.
- The first implementation may keep raw thread id in internal DB fields. Normal product DTOs must expose only product-safe continuity status. Digest-level metadata may appear only in trusted worker payloads, explicitly technical diagnostics DTOs, or admin/operator endpoints.
