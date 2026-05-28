# Codex Runtime Superpowers Dogfood Closure Design

## Status

User-approved design draft.

This spec defines the next Codex runtime closure slice after the AI-native project-management redesign merged to `main`. It aligns runtime dogfood with the Superpowers-style product loop:

```text
SourceObject
  -> DevelopmentPlan
    -> DevelopmentPlanItem
      -> BoundaryBrainstormingSession
      -> approved BoundarySummaryRevision
      -> SpecRevision
      -> ExecutionPlanRevision
      -> Execution
```

The goal is not to preserve the old Work Item / Task product flow. Runtime internals may still use Execution Packages, Run Sessions, runtime jobs, launch leases, and review packets where needed, but public product commands, dogfood reports, and readiness gates must speak in Development Plan Item, Boundary Brainstorming, Spec revision, Execution Plan revision, and Execution terms.

## Context

The current product direction is now anchored by:

- `docs/superpowers/specs/2026-05-23-ai-native-project-management-ux-redesign-design.md`;
- `docs/superpowers/plans/2026-05-24-ai-native-project-management-ux-redesign.md`.

Those documents establish that source objects do not directly generate Specs, Execution Plans, or Codex executions. Every executable unit is a Development Plan Item. Each item passes through Boundary Brainstorming, Spec review, Execution Plan review, Codex execution, code review, QA handoff, and release readiness.

The current runtime layer has useful foundations:

- centrally stored Codex runtime profiles and unsafe DB credential bindings;
- launch leases and remote runtime jobs;
- Dockerized app-server worker materialization;
- same-host remote worker dogfood scripts;
- runbook language that already says local `~/.codex` is only a bootstrap input, not a runtime dependency.

However, the runtime and dogfood closure still has gaps:

- operator bootstrap imports `auth.json` but hardcodes `config.toml` behavior instead of importing an explicit profile config;
- runbook command names have drifted from `package.json` script names;
- dogfood scripts and runtime fixtures still describe old Work Item / Execution Package / Run Session paths as the product loop;
- Boundary Brainstorming is currently too close to a fixed question list plus one approval action;
- Codex generation runtime still names `spec_draft`, `plan_draft`, and `package_drafts` around the old draft sequence;
- strict dogfood does not yet prove that a real Codex app-server task can move a Development Plan Item through multi-round boundary clarification, generated Spec, generated Execution Plan, and execution from the approved Execution Plan revision.

## Product Semantics

### Boundary Brainstorming Is The Process

`Boundary Brainstorming` is a multi-round collaboration between a human Leader and AI. It is not a single summary document.

The normal shape is:

1. AI collects context and asks focused boundary questions.
2. The Leader answers.
3. AI may ask follow-up questions, challenge weak scope, or propose tradeoffs.
4. The Leader answers, revises, rejects, or confirms.
5. The loop repeats until the boundary is sufficiently clear.
6. AI proposes a Boundary Summary revision.
7. The Leader approves, requests changes, or continues another round.

The product must preserve the process, not only the final text. A `BoundarySummaryRevision` is the approved or proposed output of one convergence point. It is not the conversation itself.

The Leader is the accountable human approver for this boundary. In v0 this can be the Tech Lead or another explicitly assigned reviewer on the Development Plan Item. Product and runtime services must store `leader_actor_id` and must reject approval attempts from an actor who is not the assigned Leader or an explicitly authorized delegate.

Leader assignment is a product contract, not an implementation guess:

- add `leader_actor_id?: string` and `leader_delegate_actor_ids: string[]` to the Development Plan Item contract;
- when starting Boundary Brainstorming, the request may set `leader_actor_id` and `leader_delegate_actor_ids`;
- if the item already has `leader_actor_id`, the start request must either omit Leader fields or match the existing Leader unless the caller has item-admin authority;
- if the item already has `leader_delegate_actor_ids`, the start request must either omit delegate fields or exactly match the existing delegate set unless the caller is the assigned Leader or has item-admin authority;
- delegate additions must be persisted on the Development Plan Item before the session snapshot is created; a caller must not gain delegate authority by adding themselves only in the start-session payload;
- if the item lacks `leader_actor_id`, the service may default to `reviewer_actor_id`, then `driver_actor_id`; if both are absent it must reject the start request until a Leader is explicitly assigned;
- the Boundary Brainstorming session stores a snapshot of `leader_actor_id` and `leader_delegate_actor_ids`;
- answer, decision, continue, approve, and request-change APIs must reject actors outside the stored Leader/delegate set unless an explicit product admin override is recorded as an audit event.

Required negative tests: non-Leader approval is rejected, non-delegate answer is rejected, non-Leader self-add as delegate at session start is rejected, stale item Leader/delegate changes do not silently rewrite an active session, and migration defaults use `reviewer_actor_id ?? driver_actor_id` only when present.

### Product Naming

User-facing naming:

- Boundary Brainstorming;
- Boundary Summary;
- Development Plan;
- Development Plan Item;
- Spec;
- Execution Plan;
- Execution.

Internal naming may use:

- `boundary_session`;
- `boundary_round`;
- `boundary_question`;
- `boundary_answer`;
- `boundary_decision`;
- `boundary_summary_revision`.

Avoid `task`, `work_item`, old generic `plan` surfaces, `execution_package`, `run_session`, and `review_packet` in public product copy, URLs, DTOs, dogfood reports, and readiness payloads unless the context is explicitly dev-only or internal runtime evidence. `Development Plan` and `Execution Plan` remain approved product terms.

## Goals

- Close the Codex runtime loop against the new Development Plan Item product model.
- Support explicit import of Codex `config.toml` and `auth.json` into centralized service-side runtime profile and credential storage.
- Treat local `~/.codex` only as an optional import source. Workers and runtime tasks must not require, mount, or read host `~/.codex`.
- Run Codex tasks inside Dockerized app-server with per-task `CODEX_HOME` materialized from the selected runtime profile and credential binding.
- Support remote workers on the same host for dogfood and on another machine through the same outbound worker protocol.
- Make Boundary Brainstorming a multi-round Leader-AI workflow backed by structured rounds, questions, answers, decisions, proposed summaries, and approved Boundary Summary revisions.
- Generate Spec revisions only from approved Boundary Summary revisions.
- Generate Execution Plan revisions only from approved Spec revisions.
- Start Execution only from an approved, current, non-stale Execution Plan revision.
- Add a strict real dogfood path that proves the full Development Plan Item loop with Codex app-server, not CLI fallback.
- Add no-baggage scans and tests that prevent old product routes, old helper calls, and host-local Codex config usage from reappearing in the product closure path.

## Non-Goals

- No external secret manager. v0 continues to use the intentionally unsafe DB credential store when explicitly enabled.
- No production-grade credential rotation UI.
- No generic Task backlog restoration.
- No direct source-object to Spec, Execution Plan, or Execution generation.
- No structured executable task extraction from Execution Plan documents.
- No requirement to implement AI-assisted Development Plan generation in this slice. The dogfood may seed or manually create the source object, Development Plan, and Development Plan Item.
- No raw replay, raw run-session browser, or raw runtime trace product surface.
- No reliance on `codex exec` or CLI fallback for strict success.
- No live app-server container held open while waiting indefinitely for human answers in v0.

## Design Choices

### Choice 1: Round-Scoped App-Server Jobs For Boundary Brainstorming

Boundary Brainstorming needs multi-round interaction, but remote workers must not hold Docker containers, launch leases, and per-task `CODEX_HOME` directories open for hours while waiting for a Leader response.

v0 therefore uses a round-scoped model:

- each AI turn is a Codex runtime job using Dockerized app-server;
- the job receives the canonical structured transcript so far;
- it produces the next questions, challenges, decisions, or summary proposal;
- the runtime job terminalizes after that AI turn;
- the worker destroys the per-task `CODEX_HOME` and container;
- the product waits for the Leader's next answer or approval before scheduling another AI turn.

This keeps the existing per-task isolation model intact and still uses app-server mode for every AI turn. App-server thread and turn ids may be stored as internal evidence for a round, but v0 must not depend on live app-server process continuity across human wait states.

Future optimization can add a short-lived live brainstorming meeting mode with sticky app-server continuity, but it must use the same persisted round model and must not become a correctness dependency.

### Choice 2: Product Generation Uses Automation Action Run Fences

The existing launch contract validates generation jobs through `automation_action_run` targets and source-changing jobs through `run_session` targets. This spec keeps that fence instead of adding a third target type.

Boundary Brainstorming, Spec generation, and Execution Plan generation are non-source-mutating AI tasks. Product commands create an internal `AutomationActionRun` that wraps the product target and precondition fingerprint:

- `run_boundary_brainstorming_round`;
- `generate_development_plan_item_spec_revision`;
- `generate_development_plan_item_execution_plan_revision`.

The runtime launch target remains:

```ts
{
  target_type: 'automation_action_run';
  target_id: actionRun.id;
  target_kind: 'generation';
  project_id: string;
  repo_id?: string;
}
```

The action run metadata must include:

- source object typed ref and revision;
- Development Plan id and revision;
- Development Plan Item id and revision;
- Boundary Brainstorming session id and revision for boundary continuation and downstream generation;
- Boundary Round id for boundary AI turns;
- approved Boundary Summary revision id for Spec generation;
- approved Spec revision id for Execution Plan generation;
- actor id that requested the action;
- precondition fingerprint covering every product revision that must still match when the terminal result is written.

Generation jobs still use `target_kind: 'generation'`, but distinguish product task behavior through runtime job input schemas:

- `boundary_brainstorming_round.v1`;
- `spec_revision_generation.v1`;
- `execution_plan_revision_generation.v1`.

`run_execution` remains the runtime target kind for source-changing Codex execution.

Terminal result writers must re-read the action run and product target before mutating product state. If the action run is no longer active, the Development Plan Item revision changed, the approved Boundary Summary changed, or the approved Spec changed, the terminal result is stored as evidence but must not satisfy the product gate.

### Choice 3: Execution Uses Product Execution As The Public Object

Execution may still be backed by Execution Packages, Run Sessions, runtime jobs, artifacts, and review packets. Product APIs and dogfood reports must present the public object as `Execution` linked to an approved `ExecutionPlanRevision`.

Any returned runtime metadata must be public-safe: digests, artifact names, high-level statuses, and timing buckets are allowed; raw secrets, raw `config.toml`, raw `auth.json`, local paths, raw app-server endpoints, and raw container ids are not.

## Data Model Changes

### Boundary Brainstorming Session

Extend the current `BrainstormingSession` model into a real process object.

Required fields:

```ts
type BoundaryBrainstormingSession = {
  id: string;
  revision_id: string;
  source_ref: SourceObjectRef;
  development_plan_id: string;
  development_plan_revision_id: string;
  development_plan_item_id: string;
  development_plan_item_revision_id: string;
  leader_actor_id: string;
  leader_delegate_actor_ids: string[];
  context_manifest_id: string;
  context_manifest_revision_id: string;
  status:
    | 'draft'
    | 'ai_turn_running'
    | 'waiting_for_leader'
    | 'summary_proposed'
    | 'approved'
    | 'changes_requested'
    | 'stale'
    | 'cancelled';
  current_round_id?: string;
  latest_summary_revision_id?: string;
  approved_summary_revision_id?: string;
  created_at: string;
  updated_at: string;
  approved_at?: string;
  closed_at?: string;
};
```

The existing `approval_state` can be kept during migration, but new product and runtime code should use the explicit session `status`. The old JSON-array `questions`, `answers`, and `decisions` fields are read-only compatibility projections after migration; new writes go through row-level round/question/answer/decision tables.

### Boundary Rounds

Add first-class `BoundaryRound` rows. A round is one AI-human exchange boundary, not necessarily one message.

Required fields:

```ts
type BoundaryRound = {
  id: string;
  session_id: string;
  session_revision_id: string;
  round_number: number;
  trigger:
    | 'start'
    | 'leader_answer'
    | 'leader_revision_request'
    | 'ai_follow_up'
    | 'summary_proposal'
    | 'approval_request';
  leader_input_markdown?: string;
  ai_output_markdown?: string;
  runtime_job_id?: string;
  runtime_profile_revision_id?: string;
  credential_binding_version_id?: string;
  app_server_thread_digest?: string;
  app_server_turn_digest?: string;
  status: 'queued' | 'running' | 'waiting_for_leader' | 'summary_proposed' | 'terminal' | 'failed';
  created_at: string;
  updated_at: string;
};
```

Store digests for app-server thread and turn identifiers if needed. Do not expose raw app-server ids in product DTOs.

If the Development Plan Item revision changes after a session starts, the session becomes stale until the Leader explicitly rebases it onto the new item revision or starts a new session. Rebase must create a new round that shows the item diff and asks AI to identify whether previous answers and decisions still apply.

Persistence requirements:

- add DB tables for `boundary_rounds`, `boundary_questions`, `boundary_answers`, and `boundary_decisions`;
- each table carries `session_id`, `session_revision_id`, and `round_id`, with foreign keys or repository-level integrity checks when the local DB driver cannot enforce the whole graph;
- add repository methods for saving/listing rounds, questions, answers, and decisions by session and by round;
- product contracts expose `round_id`, question `required`, question `rationale`, question `waived_by_decision_id`, and decision `state`;
- API serializers rebuild the old session-level arrays only as compatibility views while product callers migrate.

Migration must create a synthetic round 1 per existing session and attach every existing question, answer, and decision to it. Required flags default to `true` for unanswered open questions and `false` for historical resolved questions. Existing approved sessions must fail the new invariant unless the migration can attach each required question to an answer or accepted waiver decision.

### Questions, Answers, And Decisions

Move away from a flat session-only list by adding `round_id` to questions, answers, and decisions.

Question fields:

- id;
- session id;
- round id;
- sequence;
- text;
- required boolean;
- rationale from the AI when the question is required or when it supersedes an earlier question;
- author identity, usually runtime identity;
- status: `open | answered | resolved | superseded`;
- answered_by_answer_id when answered;
- waived_by_decision_id when an assigned Leader explicitly decides the question no longer needs an answer;
- created at.

Answer fields:

- id;
- session id;
- round id;
- question id;
- answer text;
- actor id, which must be the Leader or an authorized delegate;
- created at.

Decision fields:

- id;
- session id;
- round id;
- text;
- source: `leader | ai_proposed | leader_confirmed`;
- state: `proposed | accepted | rejected | superseded`;
- actor id for Leader-authored or Leader-confirmed decisions;
- rationale;
- created at.

An approved Boundary Summary must prove that every non-superseded required question has either `answered_by_answer_id` or `waived_by_decision_id`. The waiver decision must be accepted, must be made by the assigned Leader or authorized delegate, and must name the question being waived. Spec generation must re-check this invariant from persisted question, answer, and decision rows, not only trust session status.

### Boundary Summary Revisions

`BoundarySummary` remains the stable container for the latest boundary object. `BoundarySummaryRevision` becomes the auditable versioned artifact.

Required revision fields:

```ts
type BoundarySummaryRevision = {
  id: string;
  boundary_summary_id: string;
  session_id: string;
  session_revision_id: string;
  source_round_id: string;
  development_plan_id: string;
  development_plan_item_id: string;
  development_plan_item_revision_id: string;
  revision_number: number;
  status: 'draft' | 'proposed' | 'approved' | 'rejected' | 'superseded';
  summary_markdown: string;
  confirmed_scope: string[];
  confirmed_out_of_scope: string[];
  accepted_assumptions: string[];
  open_risks: string[];
  validation_expectations: string[];
  question_answer_snapshot: unknown[];
  decision_snapshot: unknown[];
  context_manifest_id: string;
  context_manifest_revision_id: string;
  proposed_by_runtime_job_id?: string;
  approved_by_actor_id?: string;
  approved_at?: string;
  created_at: string;
};
```

Only `status: 'approved'` can unlock Spec generation.

### Runtime Profile And Credential Import

Add an explicit import surface for centralized Codex runtime setup.

Internal API:

```text
POST /internal/codex-runtime/import-profile
POST /internal/codex-runtime/import-credential
POST /internal/codex-runtime/import-local-codex
```

The API must support:

- config TOML content in the request body;
- auth JSON content in the request body;
- operator CLI reading explicit file paths and posting content to the API;
- optional local default source through an explicit `--from-local-codex-home` flag.

The API must not require a host `~/.codex`. Local `~/.codex/config.toml` and `~/.codex/auth.json` are only import sources when explicitly selected by the operator. The bootstrap path must import both config and auth; it must not synthesize `config.toml` such as a hardcoded `approval_policy = "never"` profile unless that exact TOML was supplied by the operator or by a named fixture in a non-strict test.

Imported config creates a runtime profile revision with:

- raw config digest;
- materialized config digest;
- expected effective config digest;
- target kind;
- allowed scopes;
- Docker image digest;
- network policy digest;
- public-safe compatibility diagnostics.

Imported auth creates or updates a credential binding version with:

- payload digest;
- provider `unsafe_db`;
- purpose;
- project and optional repo scope;
- active version pointer.

Unsafe DB credential storage is fail-closed:

- `POST /internal/codex-runtime/import-credential` must reject raw credential payloads unless `FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE=1` is enabled on the control plane;
- the request must include an explicit `unsafe_db_acknowledgement: true`;
- production environments must reject `provider: 'unsafe_db'` unless a separate production-breakglass flag is explicitly set by an operator; this slice does not add that breakglass path;
- worker materialization must also reject unsafe DB credentials when the server-side unsafe store flag is disabled, even if stale rows exist;
- tests must cover disabled flag, missing acknowledgement, production rejection, and enabled local-dogfood success.

Public projections must never return raw config or raw auth. Internal materialization may return config/auth only to an authenticated worker holding the accepted launch lease and runtime job envelope.

### Generation Workload And Result Schemas

Extend the remote generation workload contract rather than creating an unrelated worker path. The existing `codex_generation_workload.v1` envelope remains the outer workload for `automation_action_run` targets, but `task_kind` is expanded:

```ts
type CodexGenerationTaskKind =
  | 'spec_draft'
  | 'plan_draft'
  | 'package_drafts'
  | 'boundary_brainstorming_round'
  | 'development_plan_item_spec_revision'
  | 'development_plan_item_execution_plan_revision';
```

The worker must dispatch the three new task kinds to `packages/codex-runtime` methods instead of the old draft generators.

Schema and dispatch ownership is part of this slice:

- `apps/control-plane-api/src/modules/automation/automation.dto.ts` must extend `CreateAutomationActionRun` with the three action types and action input schemas;
- `packages/domain/src/codex-runtime.ts` must extend `CodexGenerationWorkloadV1.task_kind`, workload validation, terminal result validation, and typed error messages for the three new task kinds;
- `packages/codex-runtime/src/types.ts`, `packages/codex-runtime/src/runtime.ts`, and `packages/codex-runtime/src/payloads.ts` must add dedicated methods/payload validators for boundary round, Spec revision, and Execution Plan revision generation;
- `packages/codex-worker-runtime/src/remote-worker-client.ts` must use an exhaustive task-kind switch; falling through to `generatePackageDrafts` is forbidden and unknown task kinds must terminalize as unsupported workload errors;
- the control-plane terminal result writer must route each new task kind to a product-state writer that re-checks the action run, preconditions, and product revision chain before mutation.

Implementation sequencing: land DTO/domain schema support before worker dispatch, then runtime method wiring, then result writers and API command handlers. Tests must prove a new task kind never enters the old `spec_draft`, `plan_draft`, or `package_drafts` handlers.

#### Boundary Round Input

The signed context for `boundary_brainstorming_round` must include:

- action run id and claim token digest;
- source object typed ref and revision;
- Development Plan id/revision;
- Development Plan Item id/revision;
- session id/revision;
- current round id/number;
- full structured transcript so far, including questions, answers, decisions, and summary revision history;
- Leader actor id;
- requested operation: `start | continue | revise_summary`;
- context manifest id/revision.

The terminal `generated_payload` must parse as `BoundaryRoundRuntimeResultV1`.

#### Spec Revision Generation Input And Result

The signed context for `development_plan_item_spec_revision` must include:

- action run id and claim token digest;
- source object typed ref and revision;
- Development Plan id/revision;
- Development Plan Item id/revision;
- approved Boundary Brainstorming session id/revision;
- approved Boundary Summary id/revision;
- approved question/answer/decision snapshots;
- context manifest id/revision;
- requested reviewer actor id when known.

The terminal `generated_payload` must parse as:

```ts
type GeneratedSpecRevisionV1 = {
  schema_version: 'spec_revision.v1';
  development_plan_item_id: string;
  boundary_summary_revision_id: string;
  summary: string;
  content_markdown: string;
  problem_context: string;
  scope_in: string[];
  scope_out: string[];
  acceptance_criteria: string[];
  test_strategy: string[];
  risks: string[];
  assumptions: string[];
  unresolved_questions: string[];
  public_summary: string;
};
```

The result writer validates the item id and approved boundary revision id against the action run precondition fingerprint, then writes a draft Spec revision linked to the Development Plan Item. The generated Spec revision must not become approved automatically.

#### Execution Plan Revision Generation Input And Result

The signed context for `development_plan_item_execution_plan_revision` must include:

- action run id and claim token digest;
- source object typed ref and revision;
- Development Plan id/revision;
- Development Plan Item id/revision;
- approved Boundary Summary id/revision;
- approved Spec id/revision;
- Spec approval actor and timestamp;
- context manifest id/revision;
- repo/module/path constraints from the Development Plan Item and Spec.

The terminal `generated_payload` must parse as:

```ts
type GeneratedExecutionPlanRevisionV1 = {
  schema_version: 'execution_plan_revision.v1';
  development_plan_item_id: string;
  based_on_spec_revision_id: string;
  summary: string;
  content_markdown: string;
  implementation_sequence: string[];
  validation_strategy: string[];
  allowed_paths: string[];
  forbidden_paths: string[];
  required_checks: Array<{ check_id: string; command: string; timeout_seconds: number; blocks_review: boolean }>;
  rollback_notes: string;
  handoff_criteria: string[];
  public_summary: string;
};
```

The result writer validates the item id and approved Spec revision id against the action run precondition fingerprint, then writes a draft Execution Plan revision linked to the Development Plan Item. The generated Execution Plan revision must not become approved automatically.

All three result writers must reject payloads that contain raw config, auth, app-server endpoints, local paths outside the allowed workspace abstraction, raw container ids, or raw logs.

### Product Execution

Add or tighten the product `Execution` linkage:

```ts
type Execution = {
  id: string;
  development_plan_id: string;
  development_plan_item_id: string;
  execution_plan_id: string;
  execution_plan_revision_id: string;
  approved_spec_revision_id: string;
  status:
    | 'queued'
    | 'running'
    | 'interrupted'
    | 'failed'
    | 'completed'
    | 'awaiting_code_review'
    | 'qa_handoff_pending';
  runtime_job_id?: string;
  internal_execution_package_id?: string;
  internal_run_session_id?: string;
  public_evidence_refs: ProductEvidenceRef[];
  created_at: string;
  updated_at: string;
};
```

The internal ids are not product refs. Product routes and queue rows must identify the row as an Execution.

## Command And API Flow

### Import Codex Runtime Config And Auth

Operator CLI:

```bash
pnpm codex:runtime:import \
  --profile-name local-dogfood-generation \
  --target-kind generation \
  --config-path /path/to/config.toml \
  --auth-path /path/to/auth.json \
  --unsafe-db-acknowledgement \
  --project-id project-1 \
  --repo-id repo-1 \
  --docker-image ghcr.io/... \
  --docker-image-digest sha256:...
```

Convenience local import:

```bash
pnpm codex:runtime:import --from-local-codex-home --project-id project-1 --repo-id repo-1
```

The convenience flag may resolve `~/.codex/config.toml` and `~/.codex/auth.json` on the operator machine. It must still post content into centralized storage. It must not configure workers to read those paths.

Strict import success requires:

- both config and auth were imported from explicit content, explicit file paths, or the explicit local import flag;
- the imported config digest is the digest later materialized into each runtime job's per-task `CODEX_HOME`;
- no strict path can fall back to a generated default config profile;
- public output prints profile, revision, credential binding, and digest ids only.

Required `package.json` aliases:

- `codex:runtime:import`;
- `codex:runtime:bootstrap`;
- `codex:remote-worker`;
- `dogfood:codex-runtime:superpowers`;
- `check:codex-runtime-superpowers-no-baggage`;
- `check:runbook-scripts`.

The implementation slice must add these aliases before dogfood can be considered operable. The intended script mapping is:

- `codex:runtime:import` -> a CLI that imports explicit `config.toml` and `auth.json` content into centralized runtime storage;
- `codex:runtime:bootstrap` -> the dogfood bootstrap path after it delegates to the same import APIs and no longer hardcodes config;
- `codex:remote-worker` -> the outbound remote worker launcher;
- `dogfood:codex-runtime:superpowers` -> the strict end-to-end Superpowers product-loop dogfood.

Existing runbooks must use these actual aliases or be updated in the same implementation slice. Any runbook command that is not present in `package.json` is a blocking verification failure.

### Boundary Brainstorming

Start:

```text
POST /development-plans/:developmentPlanId/items/:itemId/boundary-brainstorming
```

The service:

1. validates the Development Plan Item exists and is not boundary-approved;
2. creates or updates a context manifest;
3. creates a Boundary Brainstorming session;
4. creates round 1;
5. creates and claims an internal `AutomationActionRun` with action type `run_boundary_brainstorming_round`;
6. creates a generation runtime job for that action run with signed context schema `boundary_brainstorming_round.v1`;
7. returns the session and current round status.

Request body:

```ts
type StartBoundaryBrainstormingRequest = {
  source_ref?: SourceObjectRef;
  leader_actor_id?: string;
  leader_delegate_actor_ids?: string[];
  initial_leader_context_markdown?: string;
};
```

Leader resolution follows the product contract in `Product Semantics`. The response must include the resolved `leader_actor_id`, delegate actor ids, session id/revision, and current round id.

AI round output:

```text
POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/terminal
```

Only the accepted worker session can terminalize the runtime job. Product services and automation writers must not bypass the worker-authenticated terminal endpoint. After terminalization, the product generation result writer consumes the validated terminal result and applies the product-state mutation under the action-run and precondition fences.

The terminal result for a boundary round includes public-safe structured data:

```ts
type BoundaryRoundRuntimeResultV1 = {
  schema_version: 'boundary_round_result.v1';
  session_id: string;
  round_id: string;
  questions: Array<{ text: string; required: boolean; rationale?: string }>;
  proposed_decisions: Array<{ text: string; rationale?: string }>;
  summary_proposal?: {
    summary_markdown: string;
    confirmed_scope: string[];
    confirmed_out_of_scope: string[];
    accepted_assumptions: string[];
    open_risks: string[];
    validation_expectations: string[];
  };
  needs_leader_input: boolean;
  public_summary: string;
  artifacts: ProductEvidenceRef[];
};
```

Leader answer:

```text
POST /boundary-brainstorming-sessions/:sessionId/answers
POST /boundary-brainstorming-sessions/:sessionId/decisions
POST /boundary-brainstorming-sessions/:sessionId/continue
```

Continue creates a new internal `AutomationActionRun` and schedules another round-scoped Codex runtime job. It must include all previous structured questions, answers, decisions, and summary revisions in the signed prompt context.

Approve:

```text
POST /boundary-brainstorming-sessions/:sessionId/summary-revisions/:revisionId/approve
```

Request changes:

```text
POST /boundary-brainstorming-sessions/:sessionId/summary-revisions/:revisionId/request-changes
```

Requesting changes marks the proposed summary revision as `rejected` or `superseded`, records the Leader feedback, and schedules another round-scoped Codex runtime job. It must not overwrite the rejected proposal because reviewers need to see why the boundary changed.

Approval:

- sets the Boundary Summary revision to `approved`;
- links it to the Development Plan Item;
- marks the item boundary status approved;
- records an object event;
- enables Spec generation.

### Spec Generation

```text
POST /development-plans/:developmentPlanId/items/:itemId/spec-revisions/generate
```

Preconditions:

- Development Plan Item current revision matches the boundary summary revision;
- Boundary Brainstorming session is approved;
- Boundary Summary revision is approved;
- every required, non-superseded question in the approved session snapshot is answered or explicitly waived by an accepted Leader decision;
- context manifest includes the session, approved summary revision, Leader approval actor, and approval timestamp.

The generated Spec revision must include context manifest refs and must remain draft/error if any chain element is missing.

The command creates and claims an internal `AutomationActionRun` with action type `generate_development_plan_item_spec_revision`, then creates a generation runtime job using `codex_generation_workload.v1` and `task_kind: 'development_plan_item_spec_revision'`. The terminal writer persists the generated draft Spec revision only after re-checking the action claim, item revision, approved Boundary Summary revision, and context manifest chain.

### Execution Plan Generation

```text
POST /development-plans/:developmentPlanId/items/:itemId/execution-plan-revisions/generate
```

Preconditions:

- approved Spec revision;
- Spec revision references the approved Boundary Summary revision;
- Execution Plan context manifest includes the upstream chain.

The generated Execution Plan revision must be explicitly reviewed and approved before execution.

The command creates and claims an internal `AutomationActionRun` with action type `generate_development_plan_item_execution_plan_revision`, then creates a generation runtime job using `codex_generation_workload.v1` and `task_kind: 'development_plan_item_execution_plan_revision'`. The terminal writer persists the generated draft Execution Plan revision only after re-checking the action claim, item revision, approved Spec revision, approved Boundary Summary revision, and context manifest chain.

### Start Execution

```text
POST /development-plans/:developmentPlanId/items/:itemId/executions
```

Preconditions:

- approved current Execution Plan revision;
- approved Spec revision;
- approved Boundary Summary revision;
- runtime readiness for target kind `run_execution`;
- exactly one active compatible runtime profile and credential binding unless explicitly selected by internal policy;
- available worker capability, Docker image digest, and network policy digest.

The service creates the product `Execution`, then creates or replays the internal runtime execution backing. It must fail closed for missing, draft, stale, superseded, or unapproved Execution Plan revisions.

### Execution Bridge To Existing Run Runtime

The product `Execution` is the public command target, but strict run execution must still use the existing run-execution runtime contract. Starting an Execution must therefore create a private bridge:

1. Create or reuse an internal Execution Package bound to the Development Plan Item, approved Spec revision, approved Execution Plan revision, and product Execution id.
2. Derive package prompt, required checks, allowed paths, forbidden paths, and source mutation policy from the approved Execution Plan revision.
3. Create a Run Session for the internal package.
4. Have the run-worker claim a RunWorkerLease.
5. Build `workspace_bundle.v1` after the lease is active.
6. Create a runtime job with target `{ target_type: 'run_session', target_kind: 'run_execution' }`.
7. Remote worker downloads and verifies the workspace bundle, runs Dockerized app-server, and uploads patch/check/evidence artifacts.
8. Run-worker/control-plane consumes the terminal result and updates RunSession, ReviewPacket, package evidence, and product Execution status.

The bridge is internal. Product APIs, reports, and routes must use the product Execution id and approved Execution Plan revision id. Internal package/run ids may appear only in dev-only diagnostics or public-safe evidence metadata where raw runtime objects are not the primary identity.

For dogfood, the approved Execution Plan revision must explicitly include `docs/**` in `allowed_paths` if the expected source mutation is a docs-only change. The internal package path policy must be derived from that approved Execution Plan revision rather than from the old default package service allowlist. If the plan omits the dogfood path, strict dogfood must fail before launch with a public-safe path-policy blocker.

## Runtime Materialization Rules

Workers must:

- register through the outbound remote worker protocol;
- advertise target capabilities and pinned Docker image/network digests;
- receive runtime jobs by polling or long-polling;
- claim an envelope before seeing launch material;
- materialize config and auth only after holding the accepted launch lease;
- write `config.toml` and `auth.json` only under the per-task `CODEX_HOME`;
- start Dockerized `codex app-server`;
- record effective config digest before prompt delivery;
- upload public-safe artifacts and terminal evidence;
- destroy container, socket dirs, workspace bundle temp dirs, and task-local `CODEX_HOME` after terminal status.

For a worker on another machine, run execution must use the existing workspace bundle acquisition path. The control plane or run-worker creates a bounded bundle after holding the correct execution lease, the remote worker downloads it through the accepted runtime job, verifies archive and manifest digests, and mounts only that task workspace. It must not depend on a shared filesystem path from the control-plane host.

Strict dogfood must include a no-shared-filesystem worker mode. If a second physical host is unavailable, this mode can run a worker in a separate container or temp-root sandbox that receives only:

- control-plane URL;
- worker id/session/bootstrap token;
- Docker image and network policy digests;
- project/repo scope;
- a temp root owned by the worker process.

That worker mode must not receive the control-plane repo path, run-worker workspace path, operator `~/.codex`, imported config path, or imported auth path. Run execution passes only if the worker downloads the workspace bundle over the runtime channel and proves the mounted task workspace digest matches the bundle manifest.

Workers must not:

- read host `~/.codex`;
- mount host `~/.codex`;
- accept `CODEX_HOME`, `FORGELOOP_CODEX_HOME`, `host_config_path`, or `host_auth_path` as strict runtime inputs;
- pass auth through environment variables, argv, Docker labels, image args, or logs;
- count CLI fallback as strict success.

## Dogfood Requirements

Add a strict dogfood script:

```bash
pnpm dogfood:codex-runtime:superpowers
```

Required dogfood path:

1. Import config/auth into centralized runtime profile and credential storage.
2. Start a same-host remote worker using the outbound remote protocol for generation smoke coverage.
3. Start a no-shared-filesystem remote worker mode for the run-execution leg.
4. Create or seed a source object, Development Plan, and Development Plan Item.
5. Start Boundary Brainstorming.
6. Run a real Codex app-server AI round that asks boundary questions.
7. Script Leader answers to those questions.
8. Run at least one follow-up AI round.
9. Produce a Boundary Summary proposal.
10. Approve the Boundary Summary revision as the Leader.
11. Generate a Spec revision from the approved Boundary Summary revision.
12. Approve the Spec revision.
13. Generate an Execution Plan revision from the approved Spec revision.
14. Approve the Execution Plan revision.
15. Start Execution from the approved Execution Plan revision.
16. Run a real Dockerized Codex app-server execution through the no-shared-filesystem worker mode that makes a narrow docs-only change under an allowed path.
17. Record test/check evidence and terminal runtime evidence.
18. Produce a report under `docs/superpowers/reports/`.

Strict success requires:

- selected execution mode is app-server for every AI/runtime step;
- no CLI fallback;
- no host `~/.codex` runtime usage;
- per-task `CODEX_HOME` created and destroyed for each runtime job;
- centralized profile and credential version ids present in internal evidence;
- no-shared-filesystem worker evidence for the source-changing execution leg;
- workspace bundle archive, manifest, and mounted-task-workspace digests match;
- public report uses only product object names and public-safe digests;
- Development Plan Item gate chain is complete;
- Execution links to approved Execution Plan revision;
- changed files are limited to the dogfood allowlist.

The dogfood report must include a stale-boundary negative check: mutate or supersede the Development Plan Item after a boundary proposal, verify Spec generation is blocked, then rebase or restart Boundary Brainstorming before proceeding with the happy path.

If Docker, worker, profile, credential, network policy, or effective config is missing, dogfood must report a public-safe blocker and exit non-zero in strict mode. It must not silently downgrade to fake generation or CLI execution.

## No-Baggage Guards

Add a scripted no-baggage gate for the new runtime closure path:

```bash
pnpm check:codex-runtime-superpowers-no-baggage
```

The gate should classify matches with an allowlist instead of failing on every historical token. It must scan the new product closure code, strict dogfood script, active runbook, public DTOs, API routes, and product reports. It may ignore unrelated historical specs, superseded dogfood scripts, and legacy local executor files that are not reachable from the strict Superpowers dogfood path.

The gate should include these underlying focused scans:

```bash
rg -n "post\\('/work-items|post\\(`/work-items|/query/tasks|/tasks/|createTask\\(|generatePlanDraft\\(|type: z.literal\\('work_item'\\)|type: z.literal\\('task'\\)|type: z.literal\\('plan'\\)" \
  scripts packages/codex-runtime packages/codex-worker-runtime packages/workflow packages/run-worker apps/control-plane-api/src/modules tests
```

Product route and raw-runtime scan:

```bash
rg -n "route\\(['\"]plans|route\\(['\"]specs|path: ['\"]plans['\"]|path: ['\"]specs['\"]|/plans(/|['\"[:space:]]|$)|/specs(/|['\"[:space:]]|$)|requirements/.*/(spec|plan)|bugs/.*/(spec|plan)|tech-debt/.*/(spec|plan)|initiatives/.*/(spec|plan)|Execution Package Browser|Run Session Browser|Review Packet Browser|Raw Replay Browser|/replay|path: 'replay'" \
  apps packages tests scripts docs/runbooks
```

Allowed matches:

- internal storage fields in DB/domain/runtime implementation;
- explicit negative no-baggage tests;
- dev-tools-only diagnostics;
- historical docs outside active runbooks and active specs.

Host-Codex guard:

```bash
rg -n "CODEX_HOME|FORGELOOP_CODEX_HOME|host_codex_home|host_config_path|host_auth_path|~/.codex|exec_fallback|codex exec" \
  scripts packages/codex-runtime packages/codex-worker-runtime packages/run-worker apps/control-plane-api/src/modules docs/runbooks tests
```

Allowed matches:

- import-only bootstrap docs or CLI flags;
- negative tests proving host-local runtime use is rejected;
- code that asserts public evidence did not leak host paths;
- legacy local executor or run-worker fallback code only when it is not reachable from `dogfood:codex-runtime:superpowers` and is listed in the gate allowlist with a comment naming the owning cleanup stream;
- historical superseded docs outside active runbooks.

The active runbook and strict dogfood path must not present host `~/.codex` as worker setup. `exec_fallback` and `codex exec` must be fatal in the strict Superpowers dogfood path even if they remain in legacy local fallback code.

## Implementation Verification

Required test coverage:

- contract tests for Boundary Session, Boundary Round, question/answer/decision round linkage, and Boundary Summary revision status;
- API tests proving multi-round Boundary Brainstorming can ask, answer, continue, propose, request changes, and approve;
- negative tests proving Spec generation is blocked without approved Boundary Summary revision;
- negative tests proving Execution Plan generation is blocked without approved Spec revision;
- negative tests proving Execution start is blocked without approved current Execution Plan revision;
- runtime import tests for explicit config path, auth path, stdin/body import, and explicit local codex home import;
- tests proving import APIs do not expose raw config/auth in public projections;
- worker tests proving per-task `CODEX_HOME` materialization and cleanup;
- worker tests proving host `~/.codex` is not read or mounted;
- app-server schema smoke tests for `boundary_brainstorming_round.v1`, `spec_revision_generation.v1`, and `execution_plan_revision_generation.v1`;
- dogfood tests proving product report contains Development Plan Item, Boundary Brainstorming, Spec revision, Execution Plan revision, and Execution ids rather than raw runtime object names;
- runbook/script consistency tests proving documented command aliases exist in `package.json`.

Verification commands for the implementation plan should include:

```bash
pnpm vitest run tests/contracts/project-management-contracts.test.ts tests/api/brainstorming.test.ts tests/api/spec-plan-service.test.ts tests/api/executions.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm vitest run tests/api/codex-runtime*.test.ts tests/codex-runtime tests/codex-worker-runtime --pool=forks --no-file-parallelism --maxWorkers=1
pnpm check:codex-runtime-superpowers-no-baggage
pnpm check:runbook-scripts
pnpm dogfood:codex-runtime:superpowers
pnpm test
git diff --check
```

The implementation plan must also isolate known flaky timing tests. If the full suite fails but the targeted failing test passes in isolation, record the failure and rerun before changing unrelated runtime code.

## Migration Notes

- Existing `BrainstormingSession.questions`, `answers`, and `decisions` arrays can be migrated by assigning all entries to a synthetic round 1.
- Existing `BoundarySummaryRevision` rows must be backfilled before any row can remain eligible for downstream generation:
  - `source_round_id` comes from the migrated synthetic round 1 unless a later persisted proposal round can be derived;
  - `development_plan_id` comes from the session, summary, or Development Plan Item parent and must be non-null for active rows;
  - `status` may be `approved` only when `approved_at` exists and every required new field below is populated; otherwise use `draft` for editable current rows or `superseded` for historical rows that cannot safely be reused;
  - `confirmed_scope`, `confirmed_out_of_scope`, `accepted_assumptions`, `open_risks`, and `validation_expectations` are derived from existing structured fields when present; otherwise non-approved rows use empty arrays and approved rows are downgraded to `draft` until the Leader re-approves a regenerated summary;
  - `question_answer_snapshot` is rebuilt from migrated question/answer rows;
  - `decision_snapshot` reuses the existing revision snapshot plus migrated decision row ids;
  - `context_manifest_id` and `context_manifest_revision_id` copy from the session; rows without a session context manifest cannot stay `approved`;
  - migration emits a report of downgraded summary revisions, and Spec generation must reject any downgraded or superseded revision.
- Existing Spec and Execution Plan generation helpers must migrate to Development Plan Item scoped helpers.
- Existing strict local Codex dogfood scripts should either be retired or wrapped by the new `dogfood:codex-runtime:superpowers` script so there is one authoritative dogfood entry point.
- Existing runbook references to missing aliases must be fixed in the implementation slice.
- Product reports should stop naming "Work Item dogfood" for active closure paths.

## Acceptance Criteria

- Operators can import `config.toml` and `auth.json` into centralized service storage without relying on worker-local files.
- A worker on a machine without `~/.codex` can register, receive work, materialize per-task config/auth, and run Dockerized app-server.
- Boundary Brainstorming supports at least two AI rounds and one Leader answer round before approval.
- A Boundary Summary revision cannot approve without preserved round, question, answer, and decision evidence.
- Spec generation is impossible without an approved Boundary Summary revision.
- Execution Plan generation is impossible without an approved Spec revision.
- Execution start is impossible without an approved current Execution Plan revision.
- Strict dogfood proves real Codex app-server execution from the new product chain.
- Public product surfaces and dogfood reports use Development Plan Item and Execution vocabulary, not old Work Item/Task/raw runtime vocabulary.
- `pnpm test` passes, or any baseline flake is isolated, rerun, and documented with no unrelated code change.
