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

Suggested shape:

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
  created_by_actor_id: string;
  created_at: string;
  updated_at: string;
};
```

The workflow is the product object. The Codex session is the runtime continuity object.

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
    | 'forked'
    | 'archived';
  latest_snapshot_id?: string;
  latest_snapshot_digest?: string;
  latest_turn_id?: string;
  latest_turn_digest?: string;
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
- Product UI may show a short digest, creation time, last turn time, and status.
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

Suggested metadata:

```ts
type ArtifactObject = {
  id: string;
  storage_uri: string;
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
  size_bytes: number;
  digest: string;
  visibility: 'internal' | 'private' | 'public';
  owner_type: string;
  owner_id: string;
  created_at: string;
};
```

### v0 Backend

v0 should use a local filesystem backend:

```text
FORGELOOP_ARTIFACT_STORE_ROOT=/var/lib/forgeloop/artifacts
```

The interface must not expose local absolute paths to product DTOs. Returned refs use `artifact://` URIs.

Example keys:

```text
artifact://codex-sessions/{codex_session_id}/snapshots/{snapshot_id}.tar.zst
artifact://codex-runtime-jobs/{runtime_job_id}/artifacts/{artifact_id}
artifact://workspace-bundles/{bundle_id}.tar.zst
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
  size_bytes: number;
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
      "size_bytes": 123456
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
  active_lease_id is null or expired
```

On success:

```text
status = running
active_lease_id = lease-id
locked_by_worker_id = worker-id
lock_expires_at = now + ttl
```

On terminal success:

```text
expected_previous_snapshot_digest must still match
latest_snapshot_id = new_snapshot_id
latest_snapshot_digest = new_snapshot_digest
status = idle or next product status
active_lease_id = null
```

On failure:

- recoverable runtime failure moves session to `idle` or `blocked` depending on failure code;
- missing snapshot, digest mismatch, unsafe snapshot, or resume failure moves session to `blocked`;
- user-visible UI shows a public-safe blocker code and next action.

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
10. Approved Implementation Plan Doc marks execution ready.
11. Execution runs in the same CodexSession when started.

Request changes are turns in the same session. They do not create a new session.

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
- latest CodexSession snapshot digest;
- stale blockers.

Do not expose raw Codex session files.

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
- `expected_previous_snapshot_digest`;
- latest snapshot ref when present;
- runtime profile and credential binding ids;
- owner workflow and Plan Item refs;
- product precondition fingerprint.

Terminalization must include:

- new snapshot ref;
- new snapshot digest;
- output artifact refs;
- public-safe evidence;
- failure code when blocked.

## Security And Privacy

Hard requirements:

- session snapshots are internal visibility only;
- public APIs never return raw snapshot URIs unless the caller is a trusted worker or admin-only internal endpoint;
- snapshot package and manifest must not contain credentials;
- snapshot restore verifies digest before use;
- snapshot upload computes digest after packaging;
- session lock updates use CAS;
- unsafe snapshots fail closed;
- public blocker reports contain only codes, digests, counts, and high-level status.

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

- contract schemas;
- DB schema and repository APIs;
- create session for Plan Item Workflow;
- claim/release session lease;
- CAS update of latest snapshot;
- session blocked/retry/archive states;
- fork metadata model;
- tests for single-writer behavior and stale snapshot rejection.

Acceptance:

- two workers cannot claim the same session concurrently;
- stale terminal updates cannot overwrite newer snapshots;
- fork creates a separate child session without mutating the parent.

### Wave 3: Snapshot Packaging And Restore

Goal: make worker runtime preserve Codex session continuity.

Deliverables:

- inspect Codex app-server session file layout;
- whitelist required session files;
- package snapshot archive with manifest;
- exclude config/auth/secrets/cache/tmp/socket files;
- restore snapshot into fresh `CODEX_HOME`;
- verify manifest and digest;
- upload new snapshot after each turn;
- public-safe blocked reasons for unsafe or missing snapshots.

Acceptance:

- same Codex thread can be resumed across separate worker runs;
- config/auth are re-materialized from centralized records, not snapshot;
- deleting or corrupting the snapshot blocks the session instead of silently starting a new one.

### Wave 4: App-Server Resume Support

Goal: stop starting a new Codex thread for every generation stage.

Deliverables:

- driver input supports `existing_codex_thread_id`;
- first turn captures Codex thread id;
- later turns resume the same thread id;
- turn evidence links to CodexSessionTurn;
- tests cover first-turn start, later-turn resume, and resume failure.

Acceptance:

- Brainstorming follow-up, Spec generation, and Implementation Plan Doc generation can run as turns in one Codex thread;
- app-server resume failure moves session to blocked and does not create a replacement thread automatically.

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
- all actions reference the same active CodexSession unless an explicit fork is selected.

### Wave 6: Execution Continuity

Goal: continue from approved Implementation Plan Doc into execution without losing the Codex session.

Deliverables:

- execution turn uses active CodexSession;
- run-execution worker can restore the latest session snapshot;
- execution artifacts link to the same Plan Item Workflow;
- continue-after-interruption uses the same session;
- code review response and fix loops can continue the session.

Acceptance:

- implementation work is not started in a fresh unrelated Codex session;
- interruptions can resume from the latest snapshot;
- fallback to a new session requires explicit human action.

### Wave 7: Fork, Recovery, And Operations

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
- repository tests for lease/CAS behavior;
- runtime unit tests for snapshot package/restore safety;
- worker integration tests for upload/download;
- API tests for Plan Item workflow actions;
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
- session state survives worker cleanup through private snapshots;
- workers restore session state only through ArtifactStore, not shared local filesystem;
- snapshots exclude config/auth/secrets and fail closed on unsafe content;
- one session can be claimed by only one worker at a time;
- approved gates auto-enqueue the next generation turn without skipping human review;
- forks are explicit, auditable, and never auto-merged;
- product UI makes session status, blocked reasons, and context preview understandable to Tech Leads;
- starting a replacement session is explicit and warns about lost context and extra quota.

## Open Questions For Implementation Planning

- The exact Codex app-server method and payload for resuming an existing thread must be verified against the current bundled Codex version before Wave 4.
- The exact Codex session file whitelist must be discovered empirically during Wave 3.
- Snapshot archive format should be chosen during Wave 1 or Wave 3. `tar.zst` is preferred for production, but `tar.gz` may be acceptable if project dependencies make zstd awkward.
- Retention policy should default conservative: keep all snapshots for active sessions until a later operations wave defines pruning.
- The first implementation may keep raw thread id in internal DB fields, but public DTOs must expose only digest-level metadata.
