# Plan Item Workflow Product Loop Design

## Status

Approved design for spec review.

## Purpose

This spec defines Wave 5 of `2026-05-30-plan-item-codex-session-continuity-generation-loop-design.md`.

Waves 1-4 established the lower runtime foundation: internal artifacts, Codex session data and leases, app-server resume, and Codex runtime capsule packaging/restore. Wave 5 turns that foundation into the first user-facing product loop:

```text
Source Documents
  -> Development Plan
  -> Plan Item
  -> PlanItemWorkflow
  -> one active CodexSession
  -> Brainstorming
  -> Spec Doc
  -> Implementation Plan Doc
  -> Execution Ready
```

The central product correction in this wave is that the Plan Item workspace is an AI-native conversation workspace. Spec Doc and Implementation Plan Doc are generated artifacts attached to one continuous Codex session. They are not standalone entry points, and they do not replace the conversation as the primary work surface.

## Authority

This spec extends:

- `docs/superpowers/specs/2026-05-30-plan-item-codex-session-continuity-generation-loop-design.md`;
- `docs/superpowers/specs/2026-05-31-codex-session-data-model-and-lease-design.md`;
- `docs/superpowers/specs/2026-06-01-app-server-resume-protocol-support-design.md`;
- `docs/superpowers/specs/2026-06-02-codex-runtime-capsule-packaging-restore-design.md`;
- `docs/superpowers/specs/2026-05-29-document-native-product-model-redesign-design.md`;
- `docs/PRD_v1.md`, especially the document-native template constraint that the public product path is:

```text
Requirement / Bug / Tech Debt / Initiative Document(s)
  -> Development Plan
  -> Plan Item
  -> Spec Doc
  -> Implementation Plan Doc
  -> Execution Package
```

This spec is authoritative for the Wave 5 product/API/UI slice. It is not authoritative for Wave 6 execution handoff internals, execution worker workspace bundle restore, code-writing continuation, or code-review fix loops.

## Scope

This wave includes:

- A chat-first Plan Item workspace for the Superpowers loop.
- `PlanItemWorkflow` as the only public Superpowers workflow entry point.
- Workflow-scoped Brainstorming, Spec Doc generation, Implementation Plan Doc generation, review, request-changes, and approval actions.
- Explicit action selection for chat input.
- Durable queued generation actions after approval gates.
- Manual `Run generation` for queued actions.
- Read-only Context Preview.
- Artifact drawer review for Boundary Summary, Spec Doc, and Implementation Plan Doc revisions.
- Lightweight role lenses over the same workspace.
- Execution Ready evaluation and public-safe blockers.
- Fake runtime dogfood and real runtime dogfood expectations proving same-session continuity through document generation.
- No-baggage tests that reject public paths which bypass `PlanItemWorkflow`.

This wave does not include:

- Starting a real execution turn.
- Execution worker handoff continuity.
- Code-writing run session workspace bundle restore.
- Execution continuation after interruption.
- Code review response or fix loops.
- Automatic daemon claim/run of queued actions.
- Editable context package selection.
- Automatic parsing of free chat text into hidden workflow state transitions.
- Product UI for raw capsule, raw thread, memory bundle, prompt transcript, or private runtime internals.
- Generic task-list extraction from Implementation Plan Doc checkbox content.

## Core Product Model

### Product Path

The product path is:

```text
Source Documents -> Development Plan -> Plan Item -> PlanItemWorkflow -> CodexSession -> generated artifacts
```

Source Documents include Requirement Documents, Bug Documents, Tech Debt Documents, and Initiative Documents. They feed Development Plans and Plan Items. They must not directly enqueue Spec Doc generation, Implementation Plan Doc generation, or execution.

Development Plan is the planning container. Plan Item is the executable planning unit. `PlanItemWorkflow` is the authoritative product workflow instance for one Plan Item entering the Superpowers path.

### Source Of Truth

`PlanItemWorkflow.status` is the only source of truth for the Superpowers workflow stage.

Existing Plan Item projection fields such as `boundary_status`, `spec_status`, `implementation_plan_status`, and `execution_status` may remain as list/report projections. They must not own Superpowers transitions, and public mutation paths must not use them as independent workflow state.

Existing Brainstorming sessions, Boundary Summary revisions, Spec Doc revisions, Implementation Plan Doc revisions, automation action runs, runtime jobs, and execution readiness records may reference a `PlanItemWorkflow`. They must not own `active_codex_session_id`.

### Codex Session Role

`CodexSession` is the runtime continuity object. It is not the product workflow state.

Normal product UI and public DTOs may show:

- continuity state such as `same_session`, `queued`, `running`, `blocked`, or `ready`;
- last turn time;
- current stage;
- public-safe blocker code;
- capsule sequence number or presence when safe;
- evidence that a stable thread digest exists.

They must not show:

- raw Codex thread id;
- raw capsule ref;
- raw memory bundle ref or content;
- raw prompt transcript;
- raw app-server payload;
- raw artifact store local path;
- private credential or connector metadata.

### Document Artifacts

Boundary Summary, Spec Doc, and Implementation Plan Doc are artifacts/revisions produced or reviewed within the workflow. They are not alternate workflow roots.

Document approval and request-changes actions must:

- validate that the revision belongs to the current workflow and Plan Item;
- update the current `PlanItemWorkflow`;
- create a durable queued action when the next Codex-producing turn is required;
- never call Codex synchronously from the approval or request-changes route.

## API And Queue Design

### Public Workflow Commands

Wave 5 should converge public Superpowers commands onto workflow-scoped routes.

Required command shape:

```text
POST /development-plans/:developmentPlanId/items/:itemId/workflow/start-brainstorming
POST /plan-item-workflows/:workflowId/messages
POST /plan-item-workflows/:workflowId/actions/:actionId/run
POST /plan-item-workflows/:workflowId/artifacts/:artifactType/revisions/:revisionId/approve
POST /plan-item-workflows/:workflowId/artifacts/:artifactType/revisions/:revisionId/request-changes
POST /plan-item-workflows/:workflowId/execution-readiness/evaluate
```

Existing workflow-scoped routes may be kept when they already satisfy this contract. Existing non-workflow public Superpowers routes must be migrated, disabled, or made test-only. Compatibility wrappers are not allowed for public product paths.

### Explicit Chat Action

The workflow message route accepts free text plus an explicit action selector. It records the human input and, when appropriate, creates a durable queued action. It must not call Codex, claim a CodexSession lease, restore capsules, or terminalize a Codex turn.

Required message action family:

```ts
type WorkflowMessageAction =
  | 'answer_boundary_question'
  | 'continue_ai';
```

The action selector is part of the audit record. It determines:

- required workflow status;
- required artifact/revision evidence;
- actor permission check;
- queued Codex turn intent;
- whether a durable queued action is created or only a non-runtime audit record is written.

Every action that talks to Codex is a queued action and runs only through `POST /plan-item-workflows/:workflowId/actions/:actionId/run`.

Required state/action matrix:

| User command | Route | Required workflow evidence | Runtime effect | Durable result |
| --- | --- | --- | --- | --- |
| start Brainstorming | `POST /development-plans/:developmentPlanId/items/:itemId/workflow/start-brainstorming` | Plan Item belongs to Development Plan and has no active workflow, or existing workflow is not started | no Codex call in request route | workflow created, active CodexSession created, queued `continue_brainstorming` action created |
| `answer_boundary_question` | `POST /plan-item-workflows/:workflowId/messages` | active workflow, active CodexSession, current Brainstorming turn can accept input, no queued or running Codex action exists | no Codex call in message route | human message recorded, queued `continue_brainstorming` action created |
| `continue_ai` | `POST /plan-item-workflows/:workflowId/messages` | active workflow, active CodexSession, no queued or running Codex action exists | no Codex call in message route | human continue intent recorded, queued `continue_brainstorming` action created |
| run queued Brainstorming continuation | `POST /plan-item-workflows/:workflowId/actions/:actionId/run` | queued `continue_brainstorming` action | runs one Codex turn after user clicks Run | AI message, capsule evidence, and optional Boundary Summary revision |
| run queued Boundary Summary generation | `POST /plan-item-workflows/:workflowId/actions/:actionId/run` | queued `generate_boundary_summary` action, enough Brainstorming evidence exists | runs one Codex turn after user clicks Run | Boundary Summary revision or blocked queued action |
| request Boundary Summary changes | `POST /plan-item-workflows/:workflowId/artifacts/boundary-summary/revisions/:revisionId/request-changes` | current Boundary Summary revision exists and belongs to workflow, no running Codex action exists | no Codex call in request route | revision marked changes requested, downstream artifacts/readiness/evidence invalidated, dependent queued actions staled, queued `revise_boundary_summary` action created |
| run queued Boundary Summary revision | `POST /plan-item-workflows/:workflowId/actions/:actionId/run` | queued `revise_boundary_summary` action | runs one Codex turn after user clicks Run | revised Boundary Summary revision or blocked queued action |
| run queued Spec Doc generation | `POST /plan-item-workflows/:workflowId/actions/:actionId/run` | approved Boundary Summary revision and queued Spec Doc action | runs the queued action only after user clicks Run generation | Spec Doc revision or blocked queued action |
| request Spec Doc changes | `POST /plan-item-workflows/:workflowId/artifacts/spec-doc/revisions/:revisionId/request-changes` | current Spec Doc revision exists and belongs to workflow, no running Codex action exists | no Codex call in request route | revision marked changes requested, downstream Implementation Plan/readiness/evidence invalidated, dependent queued actions staled, queued `revise_spec_doc` action created |
| run queued Spec Doc revision | `POST /plan-item-workflows/:workflowId/actions/:actionId/run` | queued `revise_spec_doc` action | runs one Codex turn after user clicks Run | revised Spec Doc revision or blocked queued action |
| run queued Implementation Plan Doc generation | `POST /plan-item-workflows/:workflowId/actions/:actionId/run` | approved Spec Doc revision and queued Implementation Plan Doc action | runs the queued action only after user clicks Run generation | Implementation Plan Doc revision or blocked queued action |
| request Implementation Plan Doc changes | `POST /plan-item-workflows/:workflowId/artifacts/implementation-plan-doc/revisions/:revisionId/request-changes` | current Implementation Plan Doc revision exists and belongs to workflow, no queued or running Codex action exists | no Codex call in request route | revision marked changes requested, readiness/evidence invalidated, queued `revise_implementation_plan_doc` action created |
| run queued Implementation Plan Doc revision | `POST /plan-item-workflows/:workflowId/actions/:actionId/run` | queued `revise_implementation_plan_doc` action | runs one Codex turn after user clicks Run | revised Implementation Plan Doc revision or blocked queued action |

Generation is not a `WorkflowMessageAction`. The `/messages` route must reject Spec Doc, Implementation Plan Doc, artifact revision, and direct Codex generation attempts. UI commands labeled Run generation must call `/actions/:actionId/run` with a queued action id. Artifact approval routes are not chat inference. They are explicit gate commands. Approval can create the next queued action, but the queued action remains idle until a user runs it. Request-changes routes never create hidden generation work; they only record provenance, mark the revision, atomically stale any dependent queued action, create the visible queued revision action, and return the workflow to the relevant conversational stage.

When any Codex action is `queued` or `running`, the message route must reject `answer_boundary_question` and `continue_ai`. This prevents an idle queued action from being invalidated by an unrelated chat turn. If the user wants to change direction, they must use the relevant artifact request-changes command, which records provenance and stales the dependent queued action in the same transaction.

### Approval Gate Behavior

Approval requests must not synchronously run long AI generation.

Boundary approval:

1. approves the Boundary Summary revision;
2. transitions the workflow to `spec_generation_queued`;
3. creates a durable queued generation action for Spec Doc generation;
4. returns the queued action in the workflow projection.

Spec Doc approval:

1. approves the Spec Doc revision;
2. transitions the workflow to `implementation_plan_generation_queued`;
3. creates a durable queued generation action for Implementation Plan Doc generation;
4. returns the queued action in the workflow projection.

Implementation Plan Doc approval:

1. approves the Implementation Plan Doc revision;
2. unlocks the explicit Execution Ready evaluation route;
3. does not start execution.

Implementation Plan Doc approval must not automatically mark the workflow ready. It may return enough projection data for the UI to show the Evaluate readiness action, but readiness is decided only by `POST /plan-item-workflows/:workflowId/execution-readiness/evaluate`.

### Request-changes Cascade

Request-changes commands must invalidate downstream evidence in the same repository transaction that records the change request and creates the queued revision action.

| Change request | Must mark stale or invalid | Next queued action |
| --- | --- | --- |
| Boundary Summary changes requested | active Spec Doc revision, active Implementation Plan Doc revision, execution readiness record, internal Execution Package evidence, dependent queued actions | `revise_boundary_summary` |
| Spec Doc changes requested | active Implementation Plan Doc revision, execution readiness record, internal Execution Package evidence, dependent queued actions | `revise_spec_doc` |
| Implementation Plan Doc changes requested | execution readiness record, internal Execution Package evidence, dependent queued actions | `revise_implementation_plan_doc` |

Invalidated revisions can remain visible as historical revisions. They must not be treated as active gate evidence after the cascade.

### Queued Action Contract

A queued action is durable and workflow-owned. It is the only object that can trigger a Codex-producing turn in Wave 5.

Required fields:

```ts
type PlanItemWorkflowQueuedAction = {
  id: string;
  workflow_id: string;
  codex_session_id: string;
  kind:
    | 'continue_brainstorming'
    | 'generate_boundary_summary'
    | 'revise_boundary_summary'
    | 'generate_spec_doc'
    | 'revise_spec_doc'
    | 'generate_implementation_plan_doc'
    | 'revise_implementation_plan_doc';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'cancelled' | 'stale';
  source_revision_id?: string;
  change_request_id?: string;
  created_from_message_id?: string;
  expected_input_capsule_digest?: string;
  context_preview_digest: string;
  idempotency_key: string;
  codex_session_turn_id?: string;
  output_capsule_id?: string;
  output_capsule_digest?: string;
  output_capsule_sequence?: number;
  codex_thread_id_digest?: string;
  created_by_actor_id: string;
  created_at: string;
  updated_at: string;
};
```

Running a queued action must prove:

- the action belongs to the workflow;
- the action targets the active CodexSession;
- the per-turn CodexSession generation lease is claimable;
- the expected input capsule digest matches the latest successful capsule;
- the context preview digest matches the queued action context digest;
- the runtime turn uses the active session continuation;
- terminalization writes a new capsule sequence;
- the generated revision is associated with the same workflow and session;
- stale terminalization cannot update workflow stage, active artifact refs, queued action state, or latest capsule fields.
- raw Codex thread ids, capsule refs, prompt text, memory contents, and local artifact paths are not exposed through public reports.

Every generated artifact revision and terminal queued action record must retain queryable internal evidence:

- `codex_session_turn_id`;
- input capsule id, digest, and sequence;
- output capsule id, digest, and sequence;
- `codex_thread_id_digest`;
- internal Artifact Store object kind and digest evidence.

Public DTOs and reports may expose safe digests, counts, status codes, and stage ids. They must not expose raw internal refs or raw runtime content.

Queued action idempotency is scoped by workflow id, action kind, source revision id, change request id, context preview digest, and expected input capsule digest. Duplicate approval or duplicate request-changes commands return the existing queued action when the scoped key matches and the action is still active. Duplicate run commands use compare-and-set from `queued` to `running`; later duplicate runs return the current terminal/running state and must not create a second Codex turn.

Wave 5 supports manual `Run generation` from the UI. Automatic daemon claim/run is out of scope and remains a later automation wave.

### Legacy Entrypoint Removal

The implementation must remove or disable public mutation paths that can generate Spec Doc, generate Implementation Plan Doc, request changes, approve documents, or start execution outside `PlanItemWorkflow`.

Disabled paths should fail with a clear product-safe code such as `workflow_legacy_entrypoint_disabled`. They must not silently route through old behavior.

## Chat-first Plan Item Workspace

### Layout

The Plan Item workspace has three regions:

```text
Left: workflow timeline
Center: continuous Codex conversation
Right: artifact drawer, context preview, evidence, blockers
```

The center conversation is the primary surface. It remains visible across Brainstorming, Spec Doc generation, Implementation Plan Doc generation, request-changes, and readiness evaluation.

The document area must not replace the conversation as the default workspace.

### Left Workflow Timeline

The timeline shows:

- Brainstorming;
- Spec Doc;
- Implementation Plan Doc;
- Execution Ready.

Each stage shows:

- status;
- current actor, when known;
- next action;
- blocked reason summary, when blocked;
- whether the stage has an artifact revision.

Clicking a timeline item changes the active context in the workspace but does not navigate away from the Plan Item workspace.

### Center Conversation

The conversation stream includes:

- human messages;
- AI messages;
- workflow events;
- queued action created events;
- runtime started/completed/blocked events;
- artifact generated events;
- approval/request-changes events;
- readiness evaluation events.

The input area includes:

- free text message body;
- explicit action selector;
- send/continue affordance based on action;
- disabled reason when the selected action is invalid for the current state.

Examples:

- Answer Boundary Question;
- Continue AI.

The composer must not show artifact gate actions or queued generation run actions. Run generation appears on queued-action events or the left timeline next-action control. Approve and Request Changes appear in the right artifact drawer.

The product must not rely on hidden natural-language intent recognition to mutate workflow status.

### Right Artifact Drawer

The right rail shows:

- Context Preview;
- Artifacts;
- Evidence;
- Blocked Reasons;
- Review Actions.

Clicking a Boundary Summary, Spec Doc, or Implementation Plan Doc artifact opens an artifact drawer in the right rail. The drawer may expand or overlay the right rail. It must not replace the center conversation.

Artifact drawer capabilities:

- view Markdown revision;
- compare current and previous revision when data exists;
- approve revision;
- request changes with message;
- show revision provenance;
- show workflow/session-safe evidence;
- show queued next action after approval.

Request changes from the drawer records the change request, invalidates downstream evidence, creates the relevant queued revision action, and returns the user to the conversation flow. The queued revision action still requires an explicit Run command before Codex is called.

### Context Preview

Context Preview is read-only in Wave 5.

It shows:

- linked Source Documents;
- Development Plan and revision;
- Plan Item and revision;
- approved Boundary Summary revision;
- approved Spec Doc revision, when present;
- approved Implementation Plan Doc revision, when present;
- repo/ref/worktree policy;
- runtime profile;
- credential binding label or product-safe status;
- public-safe context digest.

It does not allow selecting or excluding context in this wave.

### Role Lenses

Wave 5 includes lightweight role lenses over one shared workspace. It must not create separate pages or divergent workflows for each role.

Required lenses:

- Product: emphasizes Source Documents, Requirement/Bug context, Boundary clarity, and user-facing scope.
- Tech Lead: default lens; emphasizes workflow gates, generation queue, artifact review, context preview, and session continuity.
- Developer: emphasizes Implementation Plan Doc, repository/runtime profile, execution readiness blockers, and handoff preparation.
- QA: emphasizes acceptance criteria, test strategy, risk, QA blockers, and release-impact blockers.

Role lenses change emphasis, ordering, and default open panels. They do not change the underlying `PlanItemWorkflow` state machine.

## Execution Ready Boundary

Wave 5 stops at Execution Ready.

It does not start a run session, restore an execution worker, write code, create a PR, run code review, or perform fix loops.

Execution Ready evaluates whether the Plan Item is ready for Wave 6 execution handoff.

The evaluator must check at least:

- approved Boundary Summary revision belongs to the workflow and Plan Item;
- approved Spec Doc revision belongs to the workflow and Plan Item;
- approved Implementation Plan Doc revision belongs to the workflow and Plan Item;
- Plan Item revision is current;
- QA/test strategy satisfies the Plan Item risk class;
- internal Execution Package boundary is structurally valid for future Wave 6 claim without invoking an execution worker;
- required release or QA handoff links exist when applicable;
- active CodexSession is healthy enough for handoff;
- latest capsule exists and has continuous sequence lineage.

The internal Execution Package check is Wave 5 readiness evidence only. It proves that the handoff boundary has enough normalized inputs for Wave 6 to claim later. Wave 5 may claim only per-turn CodexSession generation leases for queued Brainstorming, Spec Doc, and Implementation Plan Doc turns. It must not create or claim a RunSession, execution package run lease, execution worker job, workspace bundle, code-writing turn, PR, or review/fix loop.

If ready, the workflow enters `execution_ready` and the UI shows `Ready for execution handoff`.

If not ready, the UI shows public-safe blockers and next actions. It must not treat approved Implementation Plan Doc as sufficient by itself.

Execution Ready blockers must not expose raw runtime internals.

## Error Handling And Recovery

Wave 5 must fail closed.

Failure cases:

- missing active CodexSession;
- queued action targets a non-active session;
- expected capsule digest mismatch;
- stale queued action;
- stale terminalization;
- artifact revision not owned by workflow;
- actor lacks permission for selected action;
- legacy public path attempts to bypass workflow;
- app-server resume or capsule restore failure;
- context preview digest mismatch;
- readiness evidence missing or stale.

Public behavior:

- show a public-safe blocker code;
- show next action when known;
- preserve the conversation and artifact evidence already recorded;
- do not start a hidden replacement session;
- do not create a replacement Codex thread automatically;
- do not auto-merge forks;
- show recovery as a public-safe blocker or disabled future affordance only.

Fork, abandon, new-session, recovery, and scavenge mutations are Wave 8. Wave 5 must not expose public mutation routes for those operations. It may preserve enough evidence for those later operations to be designed safely.

## Verification Strategy

### Contract, API, And Repository Tests

Tests must cover:

- workflow-only public commands;
- explicit action selector validation;
- actor authorization;
- queued action idempotency;
- queued action run against the active CodexSession;
- stale queued action rejection;
- `/messages` rejects Spec Doc and Implementation Plan Doc generation attempts;
- `/messages` records chat/audit input only and never claims a CodexSession lease or terminalizes a turn;
- `answer_boundary_question` is rejected while any Codex action is queued or running;
- `continue_ai` is rejected while any Codex action is queued or running;
- context preview digest mismatch blocks queued action run;
- duplicate approval, request-changes, and run commands are idempotent under scoped idempotency keys;
- artifact request-changes atomically marks dependent queued generation actions stale;
- request-changes cascade invalidates downstream active revisions, readiness, and internal Execution Package evidence;
- durable queued revision flows exist for Boundary Summary, Spec Doc, and Implementation Plan Doc changes;
- artifact approval and request-changes provenance;
- workflow transitions after Boundary, Spec Doc, and Implementation Plan Doc approval;
- stale terminalization cannot overwrite newer workflow/capsule/action state;
- execution readiness ready and blocked cases;
- public-safe blocker serialization;
- no Source Document, Requirement, Bug, Tech Debt, Initiative, or raw Development Plan Item route can generate Spec Doc, generate Implementation Plan Doc, or start execution outside workflow;
- no public fork, abandon, new-session, recovery, or scavenge mutation route exists in Wave 5;
- disabled legacy paths return `workflow_legacy_entrypoint_disabled` or equivalent.

### Web Route Tests

Tests must cover:

- chat-first Plan Item workspace renders;
- left workflow timeline renders correct stage and next action;
- center conversation remains visible when artifact drawer opens;
- right artifact drawer opens Boundary Summary, Spec Doc, and Implementation Plan Doc revisions;
- approve and request-changes actions appear only when valid;
- queued action appears after approval;
- manual `Run generation` appears on queued-action event or timeline next action, not inside the composer;
- manual `Run generation` updates UI state;
- artifact Request Changes creates a visible queued revision action;
- Context Preview is read-only;
- role lenses change emphasis without changing workflow state;
- Execution Ready blockers render public-safe codes;
- raw thread ids, raw capsule refs, raw memories, raw prompt transcripts, and local artifact paths are not visible.

Browser/screenshot verification is required because this wave changes a primary product workspace.

### Deterministic Fake Runtime Dogfood

CI must include deterministic fake runtime dogfood that completes:

```text
start Brainstorming
create queued Brainstorming continuation action
run Brainstorming continuation
answer Boundary question
create queued Brainstorming continuation action
run Brainstorming continuation
create queued Boundary Summary action
run Boundary Summary generation
approve Boundary Summary
create queued Spec Doc action
run Spec Doc generation
request Spec Doc changes
create queued Spec Doc revision action
run Spec Doc revision
approve Spec Doc
create queued Implementation Plan Doc action
run Implementation Plan Doc generation
request Implementation Plan Doc changes
create queued Implementation Plan Doc revision action
run Implementation Plan Doc revision
approve Implementation Plan Doc
evaluate Execution Ready
```

Assertions:

- one `workflow_id`;
- one active `codex_session_id`;
- monotonic CodexSessionTurn sequence;
- monotonic capsule sequence or fake-capsule equivalent;
- each turn uses the previous successful output capsule digest as expected input when applicable;
- generated artifacts belong to the workflow and Plan Item;
- Execution Ready does not bypass QA/test strategy or Execution Package blockers.
- Execution Ready evaluation does not create or claim a RunSession, execution package run lease, execution worker job, workspace bundle, code-writing turn, PR, or review/fix loop.

### Real Runtime Dogfood

Local or credentialed environments must provide a real runtime dogfood path for:

```text
start Brainstorming -> Boundary -> Spec Doc -> Implementation Plan Doc -> approve Implementation Plan Doc -> evaluate Execution Ready
```

The real dogfood must prove:

- same real `codex_thread_id_digest` across stages;
- Codex runtime capsule sequence advances across document generation turns;
- runtime restore uses capsule state, not a fresh hidden thread;
- Execution Ready does not create or claim a RunSession, execution package run lease, execution worker job, workspace bundle, code-writing turn, PR, or review/fix loop;
- public report contains only safe digests, counts, ids, and blocker codes;
- raw prompt text, raw thread id, raw capsule refs, raw memory contents, and auth/config are not reported.

If credentials are unavailable, the command may skip the run for local developer convenience. A skipped real runtime dogfood is not acceptance evidence for Wave 5. Final acceptance requires either a passing credentialed real-runtime run or an explicitly documented non-acceptance status that blocks shipping this wave.

### Required Commands

Implementation must add these exact `package.json` scripts, or the spec and plan must be updated before implementation acceptance:

```text
pnpm test
pnpm build
git diff --check
pnpm dogfood:plan-item-workflow-product-loop
pnpm dogfood:plan-item-workflow-product-loop:real
pnpm check:codex-runtime-superpowers-no-baggage
```

`pnpm dogfood:plan-item-workflow-product-loop` must exit 0 only when the deterministic fake runtime loop passes. `pnpm dogfood:plan-item-workflow-product-loop:real` must exit 0 only when a credentialed real-runtime continuity run passes in acceptance mode. If local credentials are unavailable, the real command may emit a clear skipped/non-acceptance status for developer convenience, but that output blocks Wave 5 shipping until a credentialed acceptance run passes.

## No-baggage Requirements

Wave 5 must not leave historical product or runtime baggage.

Forbidden:

- public Spec Doc generation outside `PlanItemWorkflow`;
- public Implementation Plan Doc generation outside `PlanItemWorkflow`;
- public execution start outside `PlanItemWorkflow`;
- Work Item Owner as a public primary responsibility field in this slice;
- generic Work Items / Tasks as the primary navigation for this workflow;
- `CodexSessionSnapshot` naming in touched public product DTOs, UI labels, active runbooks, or user-facing docs;
- hidden fallback to a new session after continuity failure;
- public fork, abandon, new-session, recovery, or scavenge mutation in Wave 5;
- raw thread id or capsule ref in normal product UI;
- raw memory or prompt transcript in normal product UI;
- product Attachments as storage for runtime capsules;
- direct Source Document -> Spec/Plan/Execution mutation path;
- Implementation Plan Doc checkbox parsing into a structured task list;
- auto-run daemon behavior as a hidden side effect of approval.

Allowed:

- Work Item as internal umbrella language in legacy reports or old docs not touched by this wave;
- Plan Item projection fields for list/report display;
- existing internal `CodexSessionSnapshot` storage records from Waves 1-4 when they remain private runtime infrastructure and are not exposed as product UI concepts;
- disabled or future-labeled recovery affordance that does not mutate workflow state;
- admin/operator diagnostics that expose safe digests and refs behind a technical surface.

## Acceptance Criteria

Wave 5 is accepted when:

- Plan Item workspace is chat-first.
- Left timeline, center conversation, and right artifact/context rail work together on one Plan Item page.
- Brainstorming, Spec Doc generation, Implementation Plan Doc generation, request changes, approvals, and Execution Ready are all workflow-owned.
- Approving Boundary Summary creates a durable queued Spec Doc action.
- Running queued Spec Doc generation uses the active CodexSession and produces a workflow-owned Spec Doc revision.
- Approving Spec Doc creates a durable queued Implementation Plan Doc action.
- Running queued Implementation Plan Doc generation uses the active CodexSession and produces a workflow-owned Implementation Plan Doc revision.
- Approving Implementation Plan Doc unlocks Execution Ready evaluation but does not start execution.
- Execution Ready shows ready or public-safe blockers.
- Role lenses change emphasis without splitting workflow state.
- Context Preview is read-only and public-safe.
- Artifact review happens in the right drawer while the conversation remains visible.
- Fake dogfood proves the complete Wave 5 loop deterministically.
- Real runtime dogfood proves the same `codex_thread_id_digest` across document generation stages in the credentialed acceptance environment.
- No-baggage tests reject legacy public shortcuts and retired runtime naming.
- `pnpm test`, `pnpm build`, `git diff --check`, fake dogfood, real runtime dogfood in the credentialed acceptance environment, and no-baggage checks pass.

## Later Waves

Wave 6 should start from the approved Wave 5 Execution Ready state and implement execution handoff continuity.

Wave 7 should add execution continuation, review response, and fix loops without breaking Codex session continuity.

Wave 8 should add explicit fork selection, recovery/scavenge operations, retention policy, and operator dashboards.
