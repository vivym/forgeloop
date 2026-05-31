# Codex Session Data Model And Lease Design

## Status

Approved design for implementation planning.

## Purpose

This spec defines Wave 2 of `2026-05-30-plan-item-codex-session-continuity-generation-loop-design.md`.

Wave 1 created the Internal Artifact Store foundation. Wave 2 must introduce the product and runtime control records that let one Plan Item move through the Superpowers path without fake continuity:

```text
Plan Item Workflow
  -> one active CodexSession
  -> many explicit turns
  -> manual, evidence-backed workflow transitions
```

The key point is architectural: ForgeLoop must stop treating Brainstorming, Spec Doc generation, Implementation Plan Doc generation, automation action runs, runtime jobs, and execution as independent state owners. They are child records under a Plan Item Workflow. The workflow owns product stage. The Codex Session owns runtime continuity.

## Scope

This wave includes:

- `PlanItemWorkflow` as the authoritative Superpowers product workflow object.
- `PlanItemWorkflowTransition` as an append-only transition ledger.
- `CodexSession` as the ForgeLoop runtime continuity object for a real Codex conversation.
- `CodexSessionTurn` as the audit record for a requested Codex interaction.
- `CodexSessionSnapshot` metadata records that reference Internal Artifact Store objects.
- `codex_session_leases` as an independent lease audit and fencing table.
- fork metadata for explicit alternative Codex sessions.
- repository, domain, contract, and service boundaries for state transitions.
- API route direction and DTO visibility rules.
- migration guardrails that remove or block legacy direct-generation entry points.
- tests for workflow uniqueness, transition evidence, lease CAS, stale terminalization, and bypass prevention.

This wave does not implement:

- real Codex app-server resume;
- packaging or restoring `CODEX_HOME`;
- automatic parsing of Codex or Superpowers dialogue to infer state;
- automatic hidden replacement sessions;
- structure extraction from Implementation Plan Doc checkbox lists;
- public access to Codex session snapshots;
- generic Work Item Owner semantics.

## Design Principles

### Product State Is Manual And Evidence-Backed

Codex and Superpowers skills do not emit a reliable structured event stream for product state. ForgeLoop must not infer that a workflow has reached boundary review, spec review, or plan review by parsing natural language dialogue.

Product state changes only through explicit product actions:

- start brainstorming;
- submit boundary summary;
- request boundary changes;
- approve boundary;
- submit Spec Doc revision;
- request Spec changes;
- approve Spec;
- submit Implementation Plan Doc revision;
- request Implementation Plan changes;
- approve Implementation Plan;
- mark execution ready;
- start execution;
- attach code review evidence;
- advance QA or release-readiness gates;
- block, recover, archive, abandon, or fork.

Each state change writes a transition ledger row with typed evidence. Manual advancement is allowed, but it is not a side door. Manually edited documents, manually selected commits, and manually linked pull requests must still be submitted as typed evidence through the workflow service.

### Codex Turns Are Audit, Not Product State

`CodexSessionTurn.intent` records what ForgeLoop asked Codex to do. It may help debugging, queueing, and future state suggestions. It must not be used as the source of truth for `PlanItemWorkflow.status`.

The source of truth is `PlanItemWorkflowTransition`.

### One Session Has One Writer

A `CodexSession` may be controlled by only one current lease at a time. All writes that mutate turns, snapshots, raw thread binding, runtime terminalization, or session status must carry lease fencing fields. Stale workers cannot update session state after lease loss or replacement.

### Forks Are Explicit

Forking creates a child `CodexSession`. It is not concurrent writing to the same session. The active workflow session changes only when a human selects the fork through an auditable decision.

## Domain Model

### PlanItemWorkflow

`PlanItemWorkflow` is the product workflow instance for one Development Plan Item entering the Superpowers path.

It belongs to exactly one `development_plan_id` and exactly one `development_plan_item_id`.

```ts
type PlanItemWorkflowStatus =
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

type PlanItemWorkflow = {
  id: string;
  development_plan_id: string;
  development_plan_item_id: string;
  status: PlanItemWorkflowStatus;
  previous_status?: PlanItemWorkflowStatus;
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

Rules:

- `PlanItemWorkflow.status` is the only product source of truth for the Superpowers stage.
- Existing Development Plan Item stage fields may remain as list-view projections.
- Projection fields must be updated only from workflow transitions or read-model sync logic.
- `BrainstormingSession`, `BoundarySummaryRevision`, Spec Doc, Implementation Plan Doc, automation action run, runtime job, run session, review packet, and release records may reference the workflow.
- Those child records must not own `active_codex_session_id` or product stage progression.
- A non-terminal Plan Item may have at most one active workflow.
- Creating a `PlanItemWorkflow` also creates its initial active `CodexSession` in the same transaction. This keeps transition and manual-decision evidence consistently session-bound, including pre-brainstorming block or archive decisions. The initial session starts with `status = 'idle'` and `role = 'active'`.

### PlanItemWorkflowTransition

`PlanItemWorkflowTransition` is an append-only ledger. It records every explicit product state transition.

```ts
type WorkflowTransitionEvidenceObjectType =
  | 'boundary_summary_revision'
  | 'spec_revision'
  | 'implementation_plan_revision'
  | 'execution_readiness_record'
  | 'execution_package'
  | 'run_session'
  | 'review_packet'
  | 'internal_artifact'
  | 'commit'
  | 'pull_request'
  | 'manual_decision';

type PlanItemWorkflowTransition = {
  id: string;
  workflow_id: string;
  from_status: PlanItemWorkflowStatus;
  to_status: PlanItemWorkflowStatus;
  actor_id: string;
  reason?: string;
  evidence_object_type: WorkflowTransitionEvidenceObjectType;
  evidence_object_id: string;
  evidence_digest?: string;
  supporting_evidence?: Array<{
    object_type: WorkflowTransitionEvidenceObjectType;
    object_id: string;
    digest?: string;
  }>;
  codex_session_id: string;
  codex_session_turn_id?: string;
  created_at: string;
};
```

Rules:

- The workflow service writes transition rows in the same transaction as the workflow status update.
- No direct update to `PlanItemWorkflow.status` is valid without a transition row.
- Every evidence object must be validated for type, existence, and ownership.
- Evidence must belong to the same workflow and, where applicable, the same active Codex Session.
- Commit hashes and pull requests are valid evidence only for execution, review, QA, release, or manual decision transitions. They do not satisfy boundary/spec/plan document gates by themselves.
- `manual_decision` references a persisted `WorkflowManualDecision` evidence record. It is for explicit human override, change request, recovery, archive, or fork-selection decisions and must include a reason.
- A transition has one primary evidence object. When a gate requires multiple proofs, the primary evidence must be an aggregate domain object such as `execution_readiness_record`, and supporting evidence may record the approved document revision, execution package, QA/test signoff, or other contributing object ids.

### CodexSession

`CodexSession` is ForgeLoop's runtime continuity object for one real Codex conversation.

```ts
type CodexSessionStatus =
  | 'starting'
  | 'idle'
  | 'running'
  | 'blocked'
  | 'recovering'
  | 'archived';

type CodexSessionRole =
  | 'active'
  | 'candidate_fork'
  | 'inactive_fork';

type CodexSession = {
  id: string;
  owner_type: 'plan_item_workflow';
  owner_id: string;
  status: CodexSessionStatus;
  role: CodexSessionRole;
  codex_thread_id?: string;
  codex_thread_id_digest?: string;
  latest_snapshot_id?: string;
  latest_snapshot_digest?: string;
  latest_turn_id?: string;
  latest_turn_digest?: string;
  runtime_profile_id: string;
  runtime_profile_revision_id: string;
  credential_binding_id: string;
  credential_binding_version_id: string;
  active_lease_id?: string;
  lease_epoch: number;
  forked_from_session_id?: string;
  forked_from_turn_id?: string;
  forked_from_snapshot_id?: string;
  fork_reason?: string;
  created_by_actor_id: string;
  created_at: string;
  updated_at: string;
  archived_at?: string;
};
```

Rules:

- ForgeLoop creates `CodexSession.id`.
- Codex creates the real `codex_thread_id`.
- The initial active Codex Session is created with the workflow, before the first real Codex turn, with `status = 'idle'` and `role = 'active'`. It may not have `codex_thread_id` until the first successful Codex app-server response in a later wave.
- Raw thread ids are internal runtime metadata.
- Product DTOs show continuity state, not raw thread ids.
- `codex_thread_id` is bound only through trusted lease-fenced terminalization.
- One active Plan Item Workflow may have only one active `CodexSession`.
- Forks create additional sessions and are inactive until a human selects them.
- `status` describes runtime lifecycle. `role` describes whether the session is the workflow's selected active session or a fork candidate. The two concepts must not be overloaded.

### CodexSessionTurn

`CodexSessionTurn` records each requested Codex interaction.

```ts
type CodexSessionTurnIntent =
  | 'continue_brainstorming'
  | 'draft_boundary_summary'
  | 'revise_boundary_summary'
  | 'draft_spec_doc'
  | 'revise_spec_doc'
  | 'draft_implementation_plan_doc'
  | 'revise_implementation_plan_doc'
  | 'execute_plan'
  | 'continue_execution'
  | 'address_review_feedback';

type CodexSessionTurnStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'stale';

type CodexSessionTurn = {
  id: string;
  codex_session_id: string;
  workflow_id: string;
  intent: CodexSessionTurnIntent;
  status: CodexSessionTurnStatus;
  input_digest: string;
  expected_previous_snapshot_digest?: string;
  output_snapshot_id?: string;
  output_snapshot_digest?: string;
  output_object_type?: WorkflowTransitionEvidenceObjectType;
  output_object_id?: string;
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

Rules:

- Turns are not independent sessions.
- Turns do not automatically change product status.
- A successful turn may produce an artifact or revision that becomes evidence for a later manual transition.
- Stale terminalization marks the turn `stale` and cannot update session snapshot or product status.

### CodexSessionSnapshot

Wave 2 defines snapshot metadata only. Actual snapshot packaging and restore belong to Wave 4.

```ts
type CodexSessionSnapshot = {
  id: string;
  codex_session_id: string;
  sequence: number;
  artifact_ref: string;
  digest: string;
  size_bytes: string;
  manifest_digest: string;
  codex_thread_id_digest?: string;
  runtime_profile_revision_id: string;
  created_from_turn_id?: string;
  created_at: string;
};
```

Rules:

- `artifact_ref` must reference an Internal Artifact Store object.
- Product Attachments must not store Codex session snapshots.
- Snapshot refs and digests are trusted-worker/admin metadata, not normal product DTO fields.
- `sequence` is monotonic per session.

### ExecutionReadinessRecord

`ExecutionReadinessRecord` is the aggregate evidence object for `implementation_plan_review -> execution_ready`.

Wave 2 only needs enough structure to make the transition service, evidence validation, and tests unambiguous. Later execution/QA specs may expand its checks.

```ts
type ExecutionReadinessRecord = {
  id: string;
  workflow_id: string;
  development_plan_id: string;
  development_plan_item_id: string;
  codex_session_id: string;
  approved_boundary_summary_revision_id: string;
  approved_spec_revision_id: string;
  approved_implementation_plan_revision_id: string;
  readiness_state: 'ready' | 'not_ready';
  blocker_codes: string[];
  supporting_evidence: Array<{
    object_type: WorkflowTransitionEvidenceObjectType;
    object_id: string;
    digest?: string;
  }>;
  created_by_actor_id: string;
  created_at: string;
};
```

Rules:

- `execution_ready` transition uses `execution_readiness_record` as primary evidence.
- The record must be `ready`.
- The approved Implementation Plan Doc revision must appear both as a direct field and supporting evidence.
- The record must point to the workflow's active approved Boundary Summary, Spec Doc, and Implementation Plan Doc revisions.
- Wave 2 may create this record through the workflow service using currently available readiness checks. It must not pretend to validate future execution-worker details that belong to later waves.

### WorkflowManualDecision

`WorkflowManualDecision` is the persisted evidence object for `manual_decision` transitions.

```ts
type WorkflowManualDecisionKind =
  | 'start_brainstorming'
  | 'change_request'
  | 'block'
  | 'recover'
  | 'archive'
  | 'fork_select'
  | 'override';

type WorkflowManualDecision = {
  id: string;
  workflow_id: string;
  codex_session_id: string;
  kind: WorkflowManualDecisionKind;
  reason: string;
  selected_codex_session_id?: string;
  related_object_type?: WorkflowTransitionEvidenceObjectType;
  related_object_id?: string;
  created_by_actor_id: string;
  created_at: string;
};
```

Rules:

- `reason` is required and must not be empty.
- `fork_select` requires `selected_codex_session_id`.
- The selected session must belong to the same workflow, must have `role = 'candidate_fork'` or `role = 'inactive_fork'`, and must have `status != 'archived'`.
- Change-request decisions may reference the rejected revision as `related_object_type` and `related_object_id`.
- `manual_decision` transitions validate the persisted `WorkflowManualDecision` record for ownership, actor, and decision kind.
- `override` is reserved for explicit human override paths such as code-review or QA gate progression when no stronger typed evidence is available. It must not be used for starting brainstorming, requesting document changes, blocking, recovering, archiving, or fork selection.

### CodexSessionLease

Leases are an independent table for auditability and fencing.

```ts
type CodexSessionLeaseStatus =
  | 'active'
  | 'released'
  | 'expired'
  | 'fenced'
  | 'stale';

type CodexSessionLease = {
  id: string;
  codex_session_id: string;
  lease_token_hash: string;
  lease_epoch: number;
  worker_id: string;
  worker_session_digest: string;
  status: CodexSessionLeaseStatus;
  acquired_at: string;
  heartbeat_at?: string;
  expires_at: string;
  released_at?: string;
  fenced_at?: string;
  created_at: string;
  updated_at: string;
};
```

Rules:

- At most one active lease may exist per `codex_session_id`.
- Lease tokens are stored hashed.
- Session mutation requires current lease id, token, epoch, worker id, and worker session digest.
- Lease claim is allowed only for the workflow's selected active session: `CodexSession.role = 'active'` and `PlanItemWorkflow.active_codex_session_id = codex_session_id`.
- `candidate_fork` and `inactive_fork` sessions cannot be claimed or run in Wave 2.
- Expiry alone is not permission to accept stale writes.
- A stale worker may finish locally, but its terminalization cannot update the current session.
- Recovery may create a new lease only after the old runtime job is fenced, cancelled, or declared unrecoverable by the workflow service or operator recovery command.

## Workflow Status Semantics

`brainstorming` means the Codex conversation is active or ready to continue, but no boundary summary revision has been explicitly submitted as product evidence.

`boundary_review` means a `BoundarySummaryRevision` has been submitted through the workflow service and is awaiting human approval or change request.

`spec_generation_queued` means boundary was approved and a turn to draft or revise the Spec Doc may be queued. It is not a document review state.

`spec_review` means a Spec revision has been submitted through the workflow service and is awaiting approval or change request.

`implementation_plan_generation_queued` means Spec was approved and a turn to draft or revise the Implementation Plan Doc may be queued.

`implementation_plan_review` means an Implementation Plan Doc revision has been submitted through the workflow service and is awaiting approval or change request.

`execution_ready` means required document gates and readiness checks have passed, but implementation has not started.

`execution_running`, `code_review`, `qa`, and `release_ready` are execution-side stages. Wave 2 defines their ledger and evidence model but does not complete execution handoff continuity.

`blocked` records a recoverable or human-action-required stop. `previous_status` records where recovery should return when valid.

`archived` is terminal for the workflow.

## Allowed Transitions And Required Evidence

The workflow service must encode an explicit transition table. The first implementation may reject transitions not listed here.

| From | To | Evidence |
| --- | --- | --- |
| `not_started` | `brainstorming` | `manual_decision` with `kind = 'start_brainstorming'` and active `CodexSession` |
| `brainstorming` | `boundary_review` | `boundary_summary_revision` |
| `boundary_review` | `brainstorming` | `manual_decision` with `kind = 'change_request'` |
| `boundary_review` | `spec_generation_queued` | approved `boundary_summary_revision` |
| `spec_generation_queued` | `spec_review` | `spec_revision` |
| `spec_review` | `spec_generation_queued` | `manual_decision` with `kind = 'change_request'` |
| `spec_review` | `implementation_plan_generation_queued` | approved `spec_revision` |
| `implementation_plan_generation_queued` | `implementation_plan_review` | `implementation_plan_revision` |
| `implementation_plan_review` | `implementation_plan_generation_queued` | `manual_decision` with `kind = 'change_request'` |
| `implementation_plan_review` | `execution_ready` | `execution_readiness_record` with approved `implementation_plan_revision` as supporting evidence |
| `execution_ready` | `execution_running` | `execution_package` |
| `execution_running` | `code_review` | `run_session` or `commit` |
| `code_review` | `qa` | `review_packet`, `pull_request`, or `manual_decision` with `kind = 'override'` |
| `qa` | `release_ready` | `manual_decision` with `kind = 'override'` or future QA evidence |
| any non-terminal | `blocked` | `manual_decision` with `kind = 'block'` |
| `blocked` | previous safe state | `manual_decision` with `kind = 'recover'` |
| same current status | same current status | `manual_decision` with `kind = 'fork_select'` for active Codex Session replacement only |
| any non-terminal | `archived` | `manual_decision` with `kind = 'archive'` |

Additional rules:

- Boundary approval sets `active_boundary_summary_revision_id`.
- Spec approval sets `active_spec_doc_revision_id`.
- Implementation Plan approval sets `active_implementation_plan_doc_revision_id`.
- A generated revision may be submitted for review without being approved.
- Approval is a separate transition from submission.
- All document approval transitions must verify that the evidence revision belongs to the current workflow, current Development Plan Item, and active Codex Session context.
- Directly setting child document approval state is not enough to move the workflow.
- `execution_readiness_record` is a Wave 2 domain record or equivalent persisted readiness object. It aggregates the approved Implementation Plan Doc revision and the readiness checks known in this wave. Later execution/QA specs may add more supporting evidence types, but the transition ledger still records one primary aggregate evidence object.
- The same-status fork-selection transition may only change `PlanItemWorkflow.active_codex_session_id` and session roles. It must not change document approvals or bypass any product gate.

## Evidence Attachment

Manual evidence attachment is a first-class product action.

Supported evidence inputs:

- existing ForgeLoop object id;
- internal artifact ref;
- generated document revision id;
- commit hash;
- pull request id or URL;
- run session id;
- review packet id;
- execution readiness record id;
- manual decision payload.

The workflow service must normalize these into `WorkflowTransitionEvidenceObjectType` plus `evidence_object_id`.

Validation rules:

- document revisions must belong to the current Development Plan Item;
- generated revisions must be linked to the current workflow, or explicitly imported through a manual decision with reason;
- commits must be valid git object names for the bound repository before they can satisfy execution/review evidence;
- pull requests must resolve to the bound repository before they can satisfy review or release evidence;
- internal artifact refs must resolve through the Internal Artifact Store and match the declared owner/kind;
- evidence type must match the requested transition;
- evidence from another workflow is rejected unless a future import/fork feature explicitly supports it.

## Service Boundary

Introduce `PlanItemWorkflowService` as the only public application service for Superpowers path state transitions.

Representative methods:

```ts
startBrainstorming(input): Promise<PlanItemWorkflow>;
submitBoundarySummary(input): Promise<PlanItemWorkflow>;
requestBoundaryChanges(input): Promise<PlanItemWorkflow>;
approveBoundary(input): Promise<PlanItemWorkflow>;
submitSpecRevision(input): Promise<PlanItemWorkflow>;
requestSpecChanges(input): Promise<PlanItemWorkflow>;
approveSpec(input): Promise<PlanItemWorkflow>;
submitImplementationPlanRevision(input): Promise<PlanItemWorkflow>;
requestImplementationPlanChanges(input): Promise<PlanItemWorkflow>;
approveImplementationPlan(input): Promise<PlanItemWorkflow>;
markExecutionReady(input): Promise<PlanItemWorkflow>;
startExecution(input): Promise<PlanItemWorkflow>;
blockWorkflow(input): Promise<PlanItemWorkflow>;
recoverWorkflow(input): Promise<PlanItemWorkflow>;
archiveWorkflow(input): Promise<PlanItemWorkflow>;
forkCodexSession(input): Promise<CodexSession>;
selectActiveCodexSessionFork(input): Promise<PlanItemWorkflow>;
```

Existing services become internal adapters:

- `BrainstormingService` may create/update Brainstorming child records.
- Spec/Plan service may create revisions and documents.
- Automation service may queue action runs.
- Codex runtime service may create runtime jobs.
- Execution service may create execution packages and run sessions.

They must not expose public routes that advance Superpowers workflow state outside `PlanItemWorkflowService`.

## API Direction

Public product routes should address the workflow:

```text
POST /development-plans/:planId/items/:itemId/workflow/start-brainstorming
POST /plan-item-workflows/:workflowId/boundary-summary-revisions/:revisionId/submit
POST /plan-item-workflows/:workflowId/boundary-summary-revisions/:revisionId/approve
POST /plan-item-workflows/:workflowId/spec-revisions/:revisionId/submit
POST /plan-item-workflows/:workflowId/spec-revisions/:revisionId/approve
POST /plan-item-workflows/:workflowId/implementation-plan-revisions/:revisionId/submit
POST /plan-item-workflows/:workflowId/implementation-plan-revisions/:revisionId/approve
POST /plan-item-workflows/:workflowId/evidence
POST /plan-item-workflows/:workflowId/transitions
POST /plan-item-workflows/:workflowId/codex-sessions/:sessionId/fork
POST /plan-item-workflows/:workflowId/codex-sessions/:sessionId/select-active-fork
```

Trusted worker/internal routes may address sessions and leases:

```text
POST /internal/codex-sessions/:sessionId/leases/claim
POST /internal/codex-sessions/:sessionId/leases/:leaseId/renew
POST /internal/codex-sessions/:sessionId/turns/:turnId/terminalize
POST /internal/codex-sessions/:sessionId/snapshots
```

Normal product DTOs may expose:

- workflow status;
- active product gate;
- whether the next action waits on human or AI;
- product-safe session continuity state;
- last turn time;
- blocked reason code;
- whether continue, retry, fork, or archive is available.

Normal product DTOs must not expose:

- raw Codex thread id;
- snapshot artifact refs;
- snapshot digest or manifest metadata;
- credential binding ids;
- lease token hashes;
- internal worker ids.

Technical diagnostics or admin endpoints may expose digests and refs behind explicit authorization.

## Storage Requirements

### New Tables

Add:

- `plan_item_workflows`;
- `plan_item_workflow_transitions`;
- `codex_sessions`;
- `codex_session_turns`;
- `codex_session_snapshots`;
- `codex_session_leases`;
- `execution_readiness_records`;
- `workflow_manual_decisions`;
- optional `codex_session_forks` if fork metadata is not stored only on `codex_sessions`.

### Required Indexes And Constraints

`plan_item_workflows`:

- primary key on `id`;
- index on `(development_plan_id, development_plan_item_id)`;
- partial unique index on `development_plan_item_id` where `status not in ('archived')`, or equivalent project-approved active-status list;
- index on `active_codex_session_id`.

`plan_item_workflow_transitions`:

- primary key on `id`;
- index on `(workflow_id, created_at)`;
- index on `(evidence_object_type, evidence_object_id)`;
- index on `codex_session_id`;
- immutable append-only repository behavior.

`codex_sessions`:

- primary key on `id`;
- index on `(owner_type, owner_id)`;
- partial unique index for one active session per workflow where `role = 'active'` and `status != 'archived'`;
- index on `(owner_id, role)`;
- index on `codex_thread_id_digest`;
- index on `latest_snapshot_id`;
- index on `active_lease_id`.

`codex_session_turns`:

- primary key on `id`;
- index on `(codex_session_id, created_at)`;
- index on `(workflow_id, created_at)`;
- index on `runtime_job_id`;
- index on `automation_action_run_id`;
- optional unique idempotency key if turn creation is retried.

`codex_session_snapshots`:

- primary key on `id`;
- unique index on `(codex_session_id, sequence)`;
- unique index on `artifact_ref`;
- index on `(codex_session_id, created_at)`;
- digest stored for CAS and verification.

`codex_session_leases`:

- primary key on `id`;
- partial unique index on `codex_session_id` where `status = 'active'`;
- index on `(codex_session_id, lease_epoch)`;
- index on `(worker_id, status)`;
- index on `expires_at`;
- token stored as hash only.

`execution_readiness_records`:

- primary key on `id`;
- index on `workflow_id`;
- index on `development_plan_item_id`;
- index on `codex_session_id`;
- index on `approved_implementation_plan_revision_id`;
- only records with `readiness_state = 'ready'` may satisfy `execution_ready`.

`workflow_manual_decisions`:

- primary key on `id`;
- index on `(workflow_id, created_at)`;
- index on `codex_session_id`;
- index on `(kind, created_at)`;
- `reason` is required by domain validation.

### Existing Table Additions

Add nullable workflow/session/turn references where records participate in the Superpowers path:

- `brainstorming_sessions.workflow_id`;
- `brainstorming_sessions.codex_session_id`;
- `boundary_rounds.codex_session_turn_id`;
- `boundary_summary_revisions.workflow_id`;
- `boundary_summary_revisions.codex_session_id`;
- `specs.workflow_id`;
- `spec_revisions.workflow_id`;
- `spec_revisions.codex_session_id`;
- `spec_revisions.codex_session_turn_id`;
- `execution_plans.workflow_id`;
- `execution_plan_revisions.workflow_id`;
- `execution_plan_revisions.codex_session_id`;
- `execution_plan_revisions.codex_session_turn_id`;
- `automation_action_runs.workflow_id`;
- `automation_action_runs.codex_session_id`;
- `automation_action_runs.codex_session_turn_id`;
- `codex_runtime_jobs.workflow_id`;
- `codex_runtime_jobs.codex_session_id`;
- `codex_runtime_jobs.codex_session_turn_id`;
- `run_sessions.workflow_id`;
- `run_sessions.codex_session_id`;
- `run_sessions.codex_session_turn_id`.

The implementation may add references in phases, but Wave 2 is not complete until current Brainstorming, Spec Doc generation, Implementation Plan Doc generation, automation action runs, runtime jobs, and run sessions can be associated with the workflow/session/turn model.

## Lease Algorithms

### Claim

To claim a session, the repository must perform an atomic CAS operation equivalent to:

```text
where codex_sessions.id = session_id
  and codex_sessions.role = 'active'
  and plan_item_workflows.active_codex_session_id = session_id
  and status in ('starting', 'idle', 'recovering')
  and active_lease_id is null
  and latest_snapshot_digest is not distinct from expected_previous_snapshot_digest
```

On success:

- create `codex_session_leases` row with status `active`;
- increment `codex_sessions.lease_epoch`;
- set `active_lease_id`;
- set session status `running`;
- set lease expiry.

First turn uses `expected_previous_snapshot_digest = null`.

### Renew

Renew requires:

- active lease row;
- matching token hash;
- matching session `active_lease_id`;
- matching epoch;
- `expires_at > now`.

Renew extends `expires_at` and updates `heartbeat_at`.

### Terminalize Success

Successful terminalization requires:

- active lease row;
- matching token hash;
- matching `active_lease_id`;
- matching epoch;
- matching expected previous snapshot digest;
- if binding thread id for first turn, `codex_thread_id is null`;
- new snapshot digest/ref when the turn claims snapshot output.

On success:

- create snapshot row if provided;
- update session latest snapshot fields;
- update latest turn fields;
- set raw thread id/digest only if allowed;
- clear active lease;
- mark lease released;
- set session `idle` unless a caller explicitly blocks or archives it;
- mark turn succeeded.

### Terminalize Failure

Recoverable failure:

- marks turn failed;
- clears lease;
- marks lease released or fenced;
- sets session `idle` or `blocked` based on public-safe failure code.

Unsafe snapshot, missing snapshot, digest mismatch, resume failure, and unknown live-state extraction failures:

- mark session `blocked`;
- record public-safe blocker code;
- do not silently continue without snapshot;
- do not start a replacement Codex thread.

### Stale Terminalization

If a worker terminalizes with a non-current lease, expired token, stale epoch, or stale expected snapshot digest:

- record the terminalization attempt as stale where possible;
- mark the turn stale if it is safe to do so;
- do not update `codex_sessions.latest_snapshot_*`;
- do not bind thread id;
- do not write workflow transition;
- do not change active session status except through a recovery path.

## Fork Semantics

Fork creation requires:

- source session id;
- fork point turn id or snapshot id;
- reason;
- actor id.

Rules:

- child session receives a new `CodexSession.id`;
- child records `forked_from_session_id`, `forked_from_turn_id`, and/or `forked_from_snapshot_id`;
- child starts with `role = 'candidate_fork'` unless the actor explicitly selects it in the same transaction;
- parent latest snapshot and state remain unchanged;
- choosing a child as active writes a `PlanItemWorkflowTransition` with `manual_decision` evidence;
- selecting a child requires `status != 'archived'`, requires both the previous active session and selected child session to be lease-free and not `running`, sets the previous active session role to `inactive_fork`, sets the child role to `active`, and updates `PlanItemWorkflow.active_codex_session_id` in one transaction;
- fork creation plus immediate selection writes one `fork_select` transition in that same transaction;
- inactive forks can be archived but not auto-merged.

## Entrypoint Migration

The implementation must audit and retire or wrap all direct state-changing entry points.

Current direct paths to inspect include:

- Boundary Brainstorming controller routes under `apps/control-plane-api/src/modules/brainstorming`;
- Spec/Plan generation and approval routes under `apps/control-plane-api/src/modules/spec-plan`;
- execution start paths under `apps/control-plane-api/src/modules/executions`;
- automation-daemon generation tasks for boundary/spec/implementation plan;
- runtime job terminalization paths that apply generated revisions.

Target behavior:

- public routes call `PlanItemWorkflowService`;
- legacy direct routes either become internal-only adapter methods or reject with a migration error;
- generated payload application creates child artifacts/revisions and then asks workflow service to transition if a transition is required;
- no route may mutate `DevelopmentPlanItem.next_action`, `boundary_status`, `spec_status`, `implementation_plan_status`, `execution_status`, `review_status`, `qa_handoff_status`, or child document gate states as the source of truth for Superpowers workflow.

Projection updates are allowed only as derived state from workflow transitions.

## Authorization

Minimum authorization rules:

- product/driver roles may start brainstorming and answer/request continuation where allowed by existing Plan Item role policy;
- Tech Lead or delegate may submit/approve boundary, Spec, and Implementation Plan gates;
- developer or assigned execution owner may start execution only after `execution_ready`;
- admin/operator may recover leases and blocked sessions;
- fork selection requires Tech Lead or explicit workflow owner permission;
- internal worker endpoints require trusted worker authentication and cannot be called with product-user tokens.

The exact role names should reuse existing actor and Plan Item role structures. The important requirement is that child service permissions cannot be broader than workflow service permissions.

## Error Handling

Public-safe error codes should include:

- `workflow_invalid_transition`;
- `workflow_evidence_missing`;
- `workflow_evidence_type_invalid`;
- `workflow_evidence_not_owned`;
- `workflow_active_session_missing`;
- `workflow_active_session_conflict`;
- `codex_session_lease_conflict`;
- `codex_session_lease_expired`;
- `codex_session_stale_terminalization`;
- `codex_session_snapshot_stale`;
- `codex_session_thread_binding_conflict`;
- `codex_session_fork_invalid`;
- `workflow_legacy_entrypoint_disabled`.

Errors exposed to normal UI must not include raw thread ids, snapshot refs, lease token hashes, or worker secrets.

## Testing Requirements

Domain and service tests:

- status transition table accepts only valid transitions;
- each transition requires the correct evidence type;
- missing evidence rejects;
- evidence from another workflow rejects;
- `manual_decision` requires reason for override/recovery;
- document approval transitions update active revision fields;
- `DevelopmentPlanItem` projection fields cannot be directly treated as source of truth.

Repository tests:

- one active workflow per Plan Item;
- one active session per workflow;
- workflow creation also creates an initial active Codex Session;
- one active lease per Codex Session;
- candidate and inactive forks cannot be claimed;
- lease claim rejects a session that is not `PlanItemWorkflow.active_codex_session_id`;
- claim CAS fails on mismatched expected snapshot digest;
- first-turn claim accepts null expected snapshot only when latest snapshot is null;
- renew fails after expiry or token mismatch;
- terminalize success updates latest snapshot only with current lease;
- stale terminalization cannot overwrite current snapshot;
- fork creation does not mutate parent.
- archived fork selection rejects.
- fork selection rejects while the previous active session or selected child session has an active lease or `status = 'running'`.

API tests:

- public workflow routes call workflow service and persist transition ledger rows;
- legacy direct public routes are removed or reject with `workflow_legacy_entrypoint_disabled`;
- normal product DTOs do not expose raw thread ids, snapshot refs, snapshot digests, credential bindings, or lease token data;
- technical diagnostics require explicit authorization.

Runtime integration-style tests:

- generated boundary/spec/implementation plan artifacts can be linked to workflow/session/turn records;
- automation action run and runtime job records can be traced back to workflow/session/turn;
- stale runtime job terminalization is rejected by lease fencing.

Verification commands for the implementation plan should include:

```text
pnpm test
pnpm build
git diff --check
```

## Acceptance Criteria

Wave 2 is complete when:

- `PlanItemWorkflow` exists and is the only product workflow source of truth for Superpowers stages.
- Every workflow transition writes an append-only transition row with typed evidence.
- Manual artifact association exists as typed evidence and is validated by ownership and transition type.
- `CodexSession`, `CodexSessionTurn`, `CodexSessionSnapshot`, and `CodexSessionLease` exist in contracts/domain/DB/repository layers.
- One Plan Item cannot have multiple active workflows.
- One active workflow cannot have multiple active sessions.
- One Codex Session cannot have multiple active leases.
- Lease-fenced writes reject stale workers.
- Fork creates a child session and does not mutate the parent.
- Existing Brainstorming, Spec Doc, Implementation Plan Doc, automation action run, runtime job, and run session records can reference workflow/session/turn.
- Public generation and approval entry points cannot bypass `PlanItemWorkflowService`.
- Public DTOs do not leak raw Codex thread ids, snapshot refs, snapshot digests, credential binding ids, or lease token data.
- Tests prove invalid transitions, wrong evidence, stale leases, and legacy bypasses are rejected.

## Implementation Planning Notes

The plan should implement this wave in small vertical slices:

1. Add contracts/domain enums and DTOs.
2. Add DB schema, migrations, and repository methods.
3. Add `PlanItemWorkflowService` transition ledger and evidence validation.
4. Add `CodexSession` lease repository/service CAS behavior.
5. Attach existing child records to workflow/session/turn.
6. Route public entry points through workflow service and disable bypasses.
7. Add DTO visibility filters and tests.

Do not implement app-server resume or `CODEX_HOME` snapshot packaging in this wave. Those belong to later specs and plans.
