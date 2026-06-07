# Plan Item Execution Continuation Review Fix Loop Design

## Status

Approved design for spec review.

## Purpose

This spec defines Wave 7 of `2026-05-30-plan-item-codex-session-continuity-generation-loop-design.md`.

Waves 1-6 established the foundation for one Plan Item Workflow to use one continuous Codex session through:

```text
Source Documents
  -> Development Plan
  -> Plan Item
  -> PlanItemWorkflow
  -> one active CodexSession
  -> Brainstorming
  -> Boundary Summary
  -> Spec Doc
  -> Implementation Plan Doc
  -> Execution Ready
  -> first run_execution handoff
  -> code_review
```

Wave 7 closes the practical delivery loop after the first execution result exists. Real AI-native delivery does not end at the first execution. A worker may be interrupted, a reviewer may need a read-only response before approving, or the reviewer may request changes and ask the same Codex session to continue fixing the code.

The target path is:

```text
Execution Running
  -> Continue same session after interruption
  -> Code Review
  -> Respond to review, read-only
  -> Request fix
  -> new RunSession attempt
  -> same CodexSession and same Codex thread resumed
  -> Code Review
  -> QA
```

Wave 7 stops at the handoff into existing or later-wave QA behavior. It must make the delivery state ready for QA, but it does not implement QA automation.

The core requirement is continuity with auditability. The Codex thread and session must remain continuous across execution continuation, review response, and fix attempts. Each code-mutating attempt must still be a distinct `RunSession` so reviewers can tell which patch, checks, and Review Packet belong to each attempt.

## Authority

This spec extends:

- `docs/superpowers/specs/2026-05-30-plan-item-codex-session-continuity-generation-loop-design.md`;
- `docs/superpowers/specs/2026-05-31-codex-session-data-model-and-lease-design.md`;
- `docs/superpowers/specs/2026-06-01-app-server-resume-protocol-support-design.md`;
- `docs/superpowers/specs/2026-06-02-codex-runtime-capsule-packaging-restore-design.md`;
- `docs/superpowers/specs/2026-06-03-plan-item-workflow-product-loop-design.md`;
- `docs/superpowers/specs/2026-06-06-plan-item-execution-handoff-continuity-design.md`;
- `docs/PRD_v1.md`.

This spec is authoritative for Wave 7 execution continuation, code review response turns, Review Packet driven fix loops, stale terminalization handling for continued execution, and the minimal product recovery panel.

It is not authoritative for full fork productization, inactive fork archival, session scavenging operations, snapshot retention policy, operator dashboards, administrative diagnostics, PR creation, PR merge automation, GitHub review-thread synchronization, QA automation, or release automation.

## Scope

Wave 7 includes:

- workflow-scoped `Continue execution` from interrupted, stalled, waiting-for-input, or resumable execution states;
- workflow-scoped `Respond to review` from `PlanItemWorkflow.status = code_review`;
- workflow-scoped `Request fix` from a canonical Review Packet with `decision = changes_requested`;
- a Review Packet evidence model that can attach external comments or files as refs while keeping Review Packet as the canonical input;
- distinct `RunSession` attempts for fix loops under the same active `CodexSession`;
- read-only Codex review response turns that cannot mutate code or create execution patches;
- continuation-specific stale terminalization behavior for old execution workers;
- explicit human fallback to abandon the current session and start a new session with a continuity-loss warning;
- product recovery UI for continue, abandon/new-session, existing workflow archive, and visible fork deferral;
- deterministic fake dogfood for execution continuation, review response, and fix loop;
- credentialed real-runtime dogfood proving the same Codex thread across first execution, review response, and fix attempt.

Wave 7 does not include:

- full fork creation, active fork selection, inactive fork archival, or fork comparison UI;
- session scavenge commands, capsule retention policy, or operator health dashboards;
- direct GitHub PR comment ingestion, PR review-thread resolve, PR creation, PR merge, or GitHub status automation;
- generic task extraction from Implementation Plan Doc checkbox content;
- a new execution runner parallel to the existing `run_execution` worker path;
- public run-session resume routes;
- public compatibility aliases from legacy execution routes;
- automatic fallback to a fresh Codex session.

## Design Decision

Wave 7 must keep product actions explicit while sharing one session-continuation infrastructure path.

The product actions are:

- `Continue execution`;
- `Respond to review`;
- `Request fix`;
- `Abandon current session and start new session`.

They are not interchangeable. They have different product meaning, audit evidence, permissions, mutation capability, and state transitions.

The infrastructure they share is:

- active `PlanItemWorkflow` lookup;
- active `CodexSession` lookup;
- latest safe capsule selection;
- session lease claim and fencing;
- Codex thread resume through the verified app-server resume protocol;
- terminalization by lease, capsule, turn, runtime job, and worker predicates;
- public-safe projection without raw thread ids, capsule refs, local paths, or credentials.

Do not create a second Plan Item execution runner. `Continue execution` and `Request fix` must continue to use the existing `run_execution` runtime channel. `Respond to review` is read-only and must use a generation/read-only runtime target, not a `run_execution` job.

## Product Commands

Wave 7 introduces these workflow-scoped product commands:

```text
POST /plan-item-workflows/:workflowId/execution/continue
POST /plan-item-workflows/:workflowId/code-review/respond
POST /plan-item-workflows/:workflowId/code-review/request-fix
POST /plan-item-workflows/:workflowId/recovery/abandon-and-new-session
```

All commands must:

1. require an authenticated product actor authorized for the Plan Item Workflow, Plan Item, repo binding where relevant, and credential binding where relevant;
2. reject cross-tenant, cross-workflow, cross-plan-item, cross-repo, and cross-credential attempts;
3. require the target workflow to have one active `CodexSession`;
4. reject archived workflows and archived sessions;
5. reject concurrent active Codex actions unless the command is the valid recovery path for that exact active or stalled action;
6. use durable state changes and runtime jobs, not direct Codex execution inside the HTTP request;
7. return only public-safe workflow projections.

### Continue Execution

`POST /plan-item-workflows/:workflowId/execution/continue`

This command resumes an interrupted or waiting execution attempt in the same `RunSession`.

It is allowed only when:

- `PlanItemWorkflow.status = execution_running` or the workflow is `blocked` with `previous_status = execution_running`;
- the active `CodexSession` is the workflow's active session;
- the latest `RunSession` for the active session is `waiting_for_input`, `stalled`, `resuming`, or `cancel_requested`;
- the latest capsule, memory bundle, and environment manifest are safe and digest-matched;
- no newer successful continuation already advanced the session past the run attempt;
- exactly one row of the recoverability matrix below is satisfied.

Recoverability matrix:

The writer predicate column is a composite predicate. `CodexSessionLease` may use session-level terminal or fenced states. `RunWorkerLease` must use only supported run-worker states: `active`, `released`, `expired`, or absent. The implementation must not add fake run-worker states to satisfy this table.

| RunSession status | CodexSessionTurn status | RuntimeJob status | Writer predicate | Capsule state | Command outcome |
| --- | --- | --- | --- | --- | --- |
| `waiting_for_input` | `running` | `running` | Codex session lease and run-worker lease are active and match run/session/worker | latest capsule matches current input | existing-job input continuation only |
| `waiting_for_input` | `running` | `queued`, `accepted`, or `materializing` | Codex session lease and run-worker lease are active and matching, but no app-server input channel exists yet | latest capsule matches current input | reject with `workflow_execution_not_ready_for_input` |
| `stalled` | `running` | `running` | Codex session lease is still active, run-worker lease is active, and worker heartbeat is expired | latest capsule matches current input | block until the session lease is fenced or worker heartbeat recovers |
| `stalled` | `running`, `failed`, `cancelled`, or `stale` | `terminal` | Codex session lease is `released`, `expired`, `fenced`, or `stale`; run-worker lease is `released`, `expired`, or absent | latest safe capsule exists | relaunch after fencing |
| `resuming` | `running` | `queued`, `accepted`, `materializing`, or `running` | Codex session lease and run-worker lease are active and matching | latest capsule matches current input | replay current continuation command, do not create a new runtime job |
| `resuming` | `stale`, `failed`, or `cancelled` | `terminal` | Codex session lease is `released`, `expired`, `fenced`, or `stale`; run-worker lease is `released`, `expired`, or absent | latest safe capsule exists | relaunch after fencing |
| `cancel_requested` | `queued` or `running` | `queued`, `accepted`, `materializing`, or `running` | a matching Codex session lease or run-worker lease can still terminalize | any | reject with `workflow_execution_cancel_pending` |
| `cancel_requested` | `cancelled` or `stale` | `terminal` | Codex session lease is `released`, `expired`, `fenced`, or `stale`; run-worker lease is `released`, `expired`, or absent | latest safe capsule exists | relaunch after fencing only if actor chooses recover instead of accepting cancellation |
| `queued`, `running`, `succeeded`, `failed`, `timed_out`, or `cancelled` | `queued`, `running`, `succeeded`, `failed`, `cancelled`, or `stale` | `queued`, `accepted`, `materializing`, `running`, or `terminal` | any supported Codex session lease or run-worker lease state | any | reject; use start, review, fix, or abandon path instead |

Any state not listed in this table must fail closed. Implementations must not broaden recoverability by inference.

Continuation mode 1: existing-job input continuation.

Use this mode only for the `waiting_for_input` row in the recoverability matrix.

The existing runtime job, run worker lease, Codex session lease, worker id, worker session digest, run session id, and Codex session turn id must all match durable state. The existing worker protocol must support appending input or reattaching without creating a new runtime job. The old worker must remain the only writer allowed to mutate the active Codex session.

In this mode, the command must not create a new `CodexRuntimeJob`, new `RunSession`, or new Codex session lease. It must create or reuse a `PlanItemWorkflowQueuedAction` with kind `continue_execution` and may send a trusted continuation signal to the existing runtime job.

Continuation mode 2: relaunch after fencing.

Use this mode only for the relaunch rows in the recoverability matrix.

The previous runtime job must be terminal. The previous Codex session lease must be `released`, `expired`, `fenced`, or `stale`. The previous run worker lease must be `released`, `expired`, or absent. The active `CodexSession` must have no live `active_lease_id`, `runner_runtime_job_id`, or `runner_launch_lease_id` capable of terminalizing successfully. The latest safe capsule must be the only allowed input state for the next worker.

Only this mode may create a new workflow-owned `CodexRuntimeJob` for the same `RunSession`.

It must:

1. create or reuse a `PlanItemWorkflowQueuedAction` with kind `continue_execution` and an idempotency key scoped to workflow, run session, session, latest capsule digest, and actor;
2. select exactly one continuation mode and persist that decision in audit evidence;
3. in existing-job input continuation mode, attach the human input or continue signal to the existing runtime job without changing the active writer;
4. in relaunch-after-fencing mode, create a `CodexSessionTurn` with intent `continue_execution` only after previous writer fences prove a second live worker cannot exist;
5. in relaunch-after-fencing mode, create a workflow-owned `CodexRuntimeJob` with `target_kind = run_execution`;
6. in relaunch-after-fencing mode, set `codex_session_runtime_context.continuation.kind = resume_thread`;
7. in relaunch-after-fencing mode, restore the latest capsule before worker execution;
8. keep `RunSession.id` unchanged for the continued attempt;
9. transition the workflow from `blocked` back to `execution_running` only through a recovery decision with evidence;
10. record a continuation audit event.

It must not:

- start a new Codex thread;
- create a replacement session;
- create a new `RunSession` for the same interrupted attempt;
- create a second live `run_execution` worker for the same active `CodexSession`;
- enqueue a new runtime job while an old runtime job, Codex session lease, or run worker lease can still terminalize successfully;
- reinterpret Review Packet changes as execution continuation;
- hide resume failure by starting fresh.

### Respond To Review

`POST /plan-item-workflows/:workflowId/code-review/respond`

This command asks Codex to read the current canonical Review Packet and produce a response for the reviewer. It is read-only.

It is allowed only when:

- `PlanItemWorkflow.status = code_review`;
- the active `CodexSession` is idle and claimable;
- a current workflow-owned Review Packet exists for the workflow-owned execution package;
- the Review Packet is `ready`, `in_review`, or `completed` with `decision = changes_requested`;
- no queued or running workflow action exists for the active session;
- the Review Packet and its evidence refs pass public/internal visibility validation.

`current Review Packet` is a canonical workflow selection, not a synonym for the existing open-packet repository helper. It must be selected by workflow id, current execution package id, previous workflow-owned run session id, Review Packet digest, and supersession state. It may have `status = completed` when `decision = changes_requested`. Wave 7 commands that allow completed Review Packets must not call helpers whose contract is "open only" unless those helpers are renamed and widened in the same change.

It must:

1. create a durable `PlanItemWorkflowQueuedAction` record with kind `respond_to_review`;
2. create a `CodexSessionTurn` with intent `address_review_feedback`;
3. use a generation/read-only runtime target with a prompt that forbids source mutation, shell writes, git changes, PR changes, and file edits;
4. include the Review Packet id, Review Packet digest, previous run session id, changed files summary, checks summary, risk notes, and evidence ref summaries in the signed context;
5. persist a first-class `ReviewResponse` record linked to the Review Packet and Codex turn, with an optional rendered markdown artifact ref;
6. update the latest Codex capsule, memory bundle, and environment manifest when the read-only turn succeeds;
7. keep `PlanItemWorkflow.status = code_review`;
8. show the response in the Code Review lens as analysis, not as an execution result.

It must not:

- create a `RunSession`;
- create a `run_execution` runtime job;
- create patches, commits, workspace bundles, or changed-file artifacts;
- mark requested changes resolved;
- approve the Review Packet or advance to QA.

### Request Fix

`POST /plan-item-workflows/:workflowId/code-review/request-fix`

This command asks the same Codex session to implement requested changes from the canonical Review Packet.

It is allowed only when:

- `PlanItemWorkflow.status = code_review`;
- the active `CodexSession` is idle and claimable;
- a current Review Packet exists with `status = completed` and `decision = changes_requested`;
- the Review Packet has at least one requested change;
- the Review Packet belongs to the workflow-owned execution package;
- the Review Packet references the previous workflow-owned `RunSession`;
- the previous run session is terminal;
- the latest capsule, memory bundle, and environment manifest are safe and digest-matched;
- no queued or running workflow action exists for the active session.

It must:

1. create a new workflow-owned `RunSession` attempt;
2. create a new `CodexSessionTurn` for the fix attempt;
3. use the same active `CodexSession` and same `codex_thread_id_digest`;
4. create a `CodexRuntimeJob` with `target_kind = run_execution`;
5. set runtime continuation to `resume_thread`;
6. include `previous_run_session_id`, `previous_review_packet_id`, requested changes, `ReviewResponse` record ids if present, approved Spec Doc revision, approved Implementation Plan Doc revision, execution package, path policy, and required checks in the signed context;
7. preserve the previous run session, previous Review Packet, previous patches, and previous check results unchanged;
8. transition the workflow from `code_review` to `execution_running`;
9. on success, transition back to `code_review` with a new Review Packet for the new attempt;
10. record attempt lineage so product UI can show attempt history.

It must not:

- continue the old run session for code-mutating fix work;
- overwrite the previous Review Packet;
- mutate Review Packet requested changes during execution;
- fork or replace the Codex session;
- create a fresh Codex thread;
- bypass Execution Package path policy or required checks.

### Abandon And New Session

`POST /plan-item-workflows/:workflowId/recovery/abandon-and-new-session`

This command is the explicit human fallback when the active Codex session cannot be safely resumed.

It is allowed only when:

- the workflow is blocked because the active Codex session cannot continue safely;
- the blocker is caused by missing capsule, unsafe capsule, rejected resume, unrecoverable lease, or explicit human abandonment;
- there is no active non-terminal runtime job that can still terminalize successfully;
- the request includes a human confirmation token or typed confirmation phrase acknowledging loss of Codex thread continuity.

It must:

1. record a manual decision with a dedicated abandon/new-session kind;
2. archive or deactivate the old active `CodexSession` so it is no longer the active workflow session;
3. create a new active `CodexSession` under the same Plan Item Workflow;
4. start the new session from product artifacts, not from the old unsafe capsule;
5. preserve the old session, turns, capsule refs, run sessions, review packets, and stale terminalization attempts for audit;
6. mark all queued actions tied to the old session stale;
7. return a public warning that subsequent AI work is not the same Codex thread as earlier stages;
8. require the user to rerun the appropriate next action rather than silently continuing.

It must not:

- run automatically after resume failure;
- copy unsafe capsule contents into the new session;
- reuse the old raw Codex thread id;
- disguise the fallback as same-session continuation;
- implement full fork selection semantics.

## Review Packet Canonical Input

Review Packet is the canonical input for review response and fix loops.

External review material may be attached to a Review Packet as evidence refs, including:

- GitHub PR review comment URL;
- GitHub PR review thread URL;
- markdown excerpt pasted by a reviewer;
- screenshot or image attachment;
- local or internal artifact ref produced by prior execution;
- check log summary ref.

Codex must consume the Review Packet snapshot and its validated evidence refs, not live external PR state. The command must compute a Review Packet input digest that covers:

- Review Packet id;
- decision;
- requested changes;
- summary;
- risk notes;
- changed file summary;
- check result summary;
- self-review result summary;
- evidence ref ids and digests;
- previous run session id;
- execution package id and version;
- active Spec Doc and Implementation Plan Doc revision ids.

If a GitHub adapter is added later, it must map external comments into Review Packet evidence before Codex sees them. The adapter must not become the canonical input source for Wave 7.

## Data Model And Lineage

Wave 7 must extend existing workflow and runtime records rather than introduce a parallel execution model.

Required additions:

- `PlanItemWorkflowQueuedActionKind` must include explicit action kinds for `continue_execution`, `respond_to_review`, and `request_fix`. Wave 7 must reuse the existing queued-action claim/replay/terminalization pattern instead of introducing a parallel workflow action table.
- `WorkflowManualDecisionKind` must include a dedicated abandon/new-session decision kind.
- `assertPlanItemWorkflowTransitionAllowed` and workflow authorization must be extended for `abandon_new_session`. It must allow `blocked -> <target status from fallback matrix>` only when the manual decision kind is `abandon_new_session` and the deterministic fallback helper returns that target. It must not reuse the existing `recover` path, because `recover` only returns to `previous_status`.
- Same-status Wave 7 commands must not go through the generic same-status transition path that currently means `fork_select`. `Continue execution` and `Respond to review` must be recorded through `PlanItemWorkflowQueuedAction` terminalization plus command-specific `ObjectEvent` records. They must not create `PlanItemWorkflowTransition` rows and service authorization must not map these commands to `select_fork`.
- `CodexSessionTurnIntent` must distinguish read-only review response from code-mutating fix. `address_review_feedback` may remain the read-only response intent. Fix loop must use a separate explicit intent such as `fix_review_feedback` or `execute_review_fix`. Reusing one intent for both read-only response and code-mutating fix is forbidden.
- A first-class `ReviewResponse` record must be added. It must link to `workflow_id`, `codex_session_id`, `codex_session_turn_id`, `review_packet_id`, `previous_run_session_id`, response content digest, and optional internal artifact ref for the rendered markdown. Do not store review responses only as untyped internal artifacts.
- The workflow action or `ObjectEvent` evidence object type must include a typed `review_response` evidence type. This may be a shared evidence-object enum only if the enum name does not imply that same-status events create `PlanItemWorkflowTransition` rows. `Respond to review` evidence must attach to `PlanItemWorkflowQueuedAction` terminalization plus a command-specific `ObjectEvent`, not to a `PlanItemWorkflowTransition`.
- `CodexLaunchTarget.target_type` must add `plan_item_workflow_action`, and `validateCodexLaunchTargetKind` must allow `plan_item_workflow_action + generation`. Review response must use this target type. It must not be routed through unrelated `automation_action_run` records.
- `CodexGenerationTaskKind` must add `review_response`, with output schema `review_response.v1`.
- `CodexGenerationWorkloadV1` and its strict validator must support a discriminated launch target for `plan_item_workflow_action + generation`. For review response workloads it must require `plan_item_workflow_action_id`, `plan_item_workflow_id`, `codex_session_id`, `codex_session_turn_id`, `review_packet_id`, and Review Packet digest. It must forbid `action_run_id` for this target type.
- Generation fence repository and service APIs must support `target_type = plan_item_workflow_action` with `target_id = plan_item_workflow_action_id`. Fence acquisition, replay, and terminalization must be keyed by that target and the generation task kind. Implementations must not create dummy `automation_action_run` rows or map review response through the existing `automation_action_run` fence.
- `CodexRunExecutionWorkloadV1` and its strict validator must add fix-loop lineage fields `previous_run_session_id`, `previous_review_packet_id`, and `review_packet_digest`. These fields are required for `request_fix` workloads and forbidden for first execution or pure continuation workloads.
- Add a typed `RunSessionAttemptLineage` record or table. It must have one row per workflow-owned code-mutating run session attempt. `attempt_kind` is only `first_execution` or `review_fix`; continuation of the same interrupted `RunSession` must not create a second run-session attempt row. The record must include `run_session_id`, `workflow_id`, `codex_session_id`, optional `previous_run_session_id`, optional `previous_review_packet_id`, optional `review_response_id`, `created_by_actor_id`, and `created_at`. `request_fix` requires `attempt_kind = review_fix`, `previous_run_session_id`, and `previous_review_packet_id`.
- Add a typed `ExecutionContinuationLineage` record or table. It must have one row per `continue_execution` command that continues the same `RunSession`. It must include required `queued_action_id` as a foreign key to the `PlanItemWorkflowQueuedAction`, `workflow_id`, `run_session_id`, `codex_session_id`, `continuation_kind` (`existing_job_input`, `replay_current_continuation`, or `relaunch_after_fencing`), `previous_runtime_job_id`, optional `new_runtime_job_id`, optional `codex_session_turn_id`, previous and expected capsule digests, previous Codex session lease id, optional previous run-worker lease id, `created_by_actor_id`, and `created_at`. `existing_job_input` and `replay_current_continuation` must keep `new_runtime_job_id` empty. `relaunch_after_fencing` must set `new_runtime_job_id` and must prove previous writer predicates before the new job is claimable.
- Add a typed `ReviewPacketEvidenceRef` record or table. It must include `review_packet_id`, `workflow_id`, `ref_kind` (`github_comment_url`, `github_thread_url`, `markdown_excerpt`, `image_attachment`, `internal_artifact`, `check_log_summary`), public-safe display text, optional URL, optional internal object ref, digest, created_by_actor_id, and created_at. Review Packet input digest must be computed from these typed evidence rows in deterministic order.
- `RunSpec.review_context` must include canonical Review Packet requested changes for fix attempts.
- Runtime workload inputs for fix attempts must include attempt lineage and Review Packet digest.
- `CodexSessionStaleTerminalizationAttempt` must add Wave 7 audit fields: `workflow_id`, `run_session_id`, `runtime_job_id`, `expected_workflow_status`, `actual_workflow_status`, `expected_run_session_status`, `actual_run_session_status`, `expected_run_session_updated_at`, `actual_run_session_updated_at`, and `expected_codex_thread_id_digest`. These fields are required when stale detection occurs for workflow-owned execution or fix-loop terminalization.
- Public workflow projection must expose attempt history, current review response summary, and recovery options without raw runtime refs.

The following invariants must hold:

- one active `CodexSession` owns the workflow unless the human explicitly abandons it;
- only one active run execution may exist per active Codex session;
- only one live runtime writer may be capable of mutating an active Codex session at any time;
- a relaunch continuation requires `RuntimeJob.status = terminal`, the previous Codex session lease status to be `released`, `expired`, `fenced`, or `stale`, and the run worker lease status to be `released`, `expired`, or absent before the new runtime job is claimable;
- `Respond to review` creates no `RunSession`;
- `Request fix` creates a new `RunSession`;
- fix attempts keep the same `CodexSession.id`;
- fix attempts keep the same `codex_thread_id_digest` unless the user explicitly abandons the session and starts a new one;
- stale queued actions and stale runtime jobs cannot target the new session after abandonment.

## Workflow Transitions And Events

Wave 7 must support these status changes and same-status workflow events:

```text
execution_running -> execution_running
  kind: same-status workflow event, not generic transition
  evidence: run_session or workflow action
  reason: continue execution after waiting/stalled/resuming

blocked -> execution_running
  evidence: manual_decision(recover) + run_session or workflow action
  reason: continue same session after recoverable interruption

code_review -> code_review
  kind: same-status workflow event, not generic transition
  evidence: review_response
  reason: read-only response to review

code_review -> execution_running
  evidence: review_packet + run_session
  reason: requested changes fix attempt

execution_running -> code_review
  evidence: run_session
  reason: fix attempt completed and produced new Review Packet

blocked -> brainstorming/spec_generation_queued/spec_review/implementation_plan_generation_queued/implementation_plan_review/execution_ready/code_review
  evidence: manual_decision(abandon_new_session)
  reason: explicit human fallback to new session, returning to the safest product stage
```

Same-status workflow events must be persisted as `PlanItemWorkflowQueuedAction` terminalization plus command-specific `ObjectEvent` records. They must not create `PlanItemWorkflowTransition` rows and must not call the existing generic same-status transition path.

The stage after abandonment must be deterministic. Use this mapping, evaluated from top to bottom against current trusted product artifacts and current workflow-owned review state:

1. if a current workflow-owned Review Packet exists for the current execution package and the approved Spec Doc, Implementation Plan Doc, execution package, and previous run session remain trustworthy, return to `code_review`;
2. otherwise, if a current `ExecutionReadinessRecord` still evaluates to ready for the approved Spec Doc, approved Implementation Plan Doc, current Plan Item revision, execution package, repo binding, QA/test strategy, and path policy, return to `execution_ready`;
3. otherwise, if an Implementation Plan Doc revision exists but is not approved or is awaiting review, return to `implementation_plan_review`;
4. otherwise, if an approved Spec Doc exists and no current Implementation Plan Doc revision is awaiting review, return to `implementation_plan_generation_queued`;
5. otherwise, if a Spec Doc revision exists but is not approved or is awaiting review, return to `spec_review`;
6. otherwise, if an approved Boundary Summary exists and no current Spec Doc revision is awaiting review, return to `spec_generation_queued`;
7. otherwise return to `brainstorming`.

This mapping must be implemented in one named service helper and covered by tests for each branch. It must not silently skip required document approval gates.

Abandon/new-session fallback matrix:

| Current trusted artifact state | Queued action state | Explicit next action on request | Target workflow status |
| --- | --- | --- | --- |
| Current Review Packet exists and approved documents, execution package, previous run session, and review evidence remain trustworthy | no queued action for old session remains active | `respond_to_review` or `request_fix` | `code_review` |
| Execution readiness is still valid for current approved documents, current Plan Item revision, execution package, repo binding, QA/test strategy, and path policy | no queued action for old session remains active | `start_execution` | `execution_ready` |
| Current Implementation Plan Doc revision exists and is awaiting review or changes were requested | no queued action for old session remains active | `review_implementation_plan` | `implementation_plan_review` |
| Approved Spec Doc exists and no current Implementation Plan Doc revision is awaiting review | create a new queued action for the new session | `generate_implementation_plan` | `implementation_plan_generation_queued` |
| Current Spec Doc revision exists and is awaiting review or changes were requested | no queued action for old session remains active | `review_spec` | `spec_review` |
| Approved Boundary Summary exists and no current Spec Doc revision is awaiting review | create a new queued action for the new session | `generate_spec` | `spec_generation_queued` |
| No approved Boundary Summary exists | create a new `continue_brainstorming` queued action for the new session | `brainstorm` | `brainstorming` |

`abandon-and-new-session` request body must include `next_action` using the values in this matrix. If the requested next action does not match the highest applicable trusted artifact row, the command must reject with `workflow_abandon_next_action_mismatch`. This keeps product recovery explicit and prevents the server from silently choosing a stage the user did not intend.

## Runtime Behavior

### Execution Continuation Runtime

Relaunch-after-fencing execution continuation must use `CodexRunExecutionWorkloadV1` with workflow-owned runtime context:

- `schema_version = codex_run_execution_workload.v1`;
- `target_kind = run_execution`;
- `codex_session_runtime_context.continuation.kind = resume_thread`;
- `turn_group_status = complete`;
- `expected_input_capsule_digest = active session latest capsule digest`;
- `run_session_id = existing run session id`;
- `plan_item_workflow_id = workflow id`;
- `codex_session_id = active session id`;
- `codex_session_turn_id = continuation turn id`.

The worker must restore the latest capsule before Docker app-server startup and before `resumeRun`.

Existing-job input continuation must not create this workload. It must use the already-created runtime job and append or reattach input through the existing trusted worker/app-server continuation channel.

### Review Response Runtime

Review response must use a read-only Codex generation workload with `CodexLaunchTarget.target_type = plan_item_workflow_action` and `target_kind = generation`.

The implementation must add a distinct read-only task kind and output schema, for example:

- `CodexGenerationTaskKind = review_response`;
- `output_schema_version = review_response.v1`.

The workload must:

- resume the same Codex thread;
- restore the latest capsule;
- include the signed Review Packet context;
- carry `plan_item_workflow_action_id` as the generation target id, not `action_run_id`;
- set the read-only task kind and output schema for review response;
- fail if the runtime attempts to emit patch, changed files, run execution result, commit, PR, or workspace mutation artifacts.

Successful terminalization must update the latest capsule and persist a first-class `ReviewResponse` record, with an optional rendered markdown artifact. It must not transition away from `code_review`.

### Fix Loop Runtime

Fix loop must use `CodexRunExecutionWorkloadV1` with a new run session:

- `run_session_id = new run session id`;
- `previous_run_session_id = previous terminal run session id`;
- `previous_review_packet_id = canonical Review Packet id`;
- `review_packet_digest = canonical Review Packet input digest`;
- `codex_session_runtime_context.continuation.kind = resume_thread`;
- `expected_input_capsule_digest = latest capsule digest`;
- `codex_session_turn_id = fix turn id`.

The strict workload validator must accept `previous_run_session_id`, `previous_review_packet_id`, and `review_packet_digest` only for fix-loop workloads. Missing or extra lineage fields must fail closed.

The worker must run the normal execution path, collect patches, checks, artifacts, and self-review, then terminalize like Wave 6. Success creates a new Review Packet for the new run session. Failure blocks or reports failure through the same workflow-owned terminalization predicates as Wave 6.

## Stale Terminalization

Wave 7 must harden stale terminalization for continuation.

A terminalization attempt is stale when any of these diverge from durable state:

- workflow id;
- active Codex session id;
- Codex session turn id;
- run session id;
- runtime job id;
- lease id;
- lease epoch;
- worker id;
- worker session digest;
- expected input capsule digest;
- expected run session status and `updated_at`;
- expected workflow status;
- expected codex thread digest.

When stale terminalization is detected:

1. record `CodexSessionStaleTerminalizationAttempt`;
2. retain the Wave 7 stale audit fields listed in Data Model And Lineage;
3. retain attempted output capsule digest if present;
4. terminalize the runtime job only if the runtime job itself is still terminalizable without mutating the active session;
5. do not update `CodexSession.latest_capsule_*`;
6. do not update latest memory or environment refs;
7. do not update active `RunSession` attempt;
8. do not update `PlanItemWorkflow.status`;
9. do not overwrite Review Packet records, `ReviewResponse` records, or their linked artifacts;
10. expose only public-safe blocker or diagnostic codes.

Old execution terminalization must not overwrite a newer fix attempt or a newer continuation.

## Product UI

Plan Item workspace must make the delivery loop understandable by role.

Execution lens:

- show current run attempt;
- show interrupted/stalled/waiting states;
- show `Continue same session` only when continuation predicates are satisfied;
- show the same-session digest indicator as public-safe continuity evidence;
- show blocked recovery options when continuation is unsafe.

Code Review lens:

- show current Review Packet as the canonical review input;
- show attached external evidence refs as secondary context;
- show `Respond to review` for read-only AI analysis;
- show the latest `ReviewResponse` summary and rendered response;
- show `Request fix` only when Review Packet decision is `changes_requested`;
- show fix attempts as separate attempt rows or timeline entries;
- keep previous attempts visible and immutable.

Recovery panel:

- show `Continue same session` when safe;
- show `Abandon current session and start new session` only with explicit warning and confirmation;
- show existing workflow archive as a destructive close action when the product already supports archiving the workflow;
- show fork as a future capability or unavailable operation if the user asks for fork before Wave 8;
- do not present inactive fork archival, session retention, or operator archive controls as Wave 7 functionality;
- never imply an automatic fallback happened.

UI route tests must verify visible actions, disabled reasons, warning copy, attempt history, and no raw runtime refs.

Public workflow DTOs must add explicit safe projections for:

- attempt history with run session id, attempt kind, previous attempt relation, status, timestamps, and nested continuation events from `ExecutionContinuationLineage`;
- latest Review Response summary with response id, review packet id, previous run session id, status, and created time;
- recovery options with action ids, enabled/disabled state, blocker code, warning copy, and required confirmation kind.

These projections must not expose raw runtime refs and must not present continuation of the same `RunSession` as a separate run attempt.

## Public Safety And No Baggage

Public DTOs and product screens must not expose:

- raw `codex_thread_id`;
- raw capsule artifact refs;
- raw memory bundle refs;
- raw environment manifest refs;
- local filesystem paths;
- credential binding payloads;
- worker session tokens;
- lease tokens;
- app-server payloads.

Forbidden public routes:

- direct run-session resume;
- direct run-session retry;
- direct execution package rerun for workflow-owned Plan Items;
- direct review packet rerun outside Plan Item Workflow;
- legacy execution start routes;
- direct fork/select-fork routes before Wave 8;
- public scavenge/recover operations.

Existing internal worker endpoints may remain only if they claim or terminalize already-created workflow-owned runtime jobs and enforce trusted worker authentication.

No compatibility wrappers are allowed. If an old public route overlaps with Wave 7 behavior, it must fail closed or be removed from public modules.

## Failure Handling

Wave 7 must fail closed for:

- missing latest capsule;
- unsafe capsule manifest;
- capsule digest mismatch;
- missing memory bundle when required;
- missing environment manifest when required;
- app-server resume rejection;
- stale session lease;
- stale runtime job;
- stale run session status;
- stale workflow status;
- Review Packet digest mismatch;
- Review Packet no longer current;
- external evidence ref unavailable or unsafe;
- read-only review response emits mutation artifacts;
- fix attempt tries to reuse previous run session;
- abandon/new-session request missing explicit confirmation.

Failure outcomes:

- recoverable continuation problems move workflow to `blocked` with previous status retained;
- read-only review response failures keep workflow in `code_review` and block only the action;
- fix-loop runtime failures follow Wave 6 execution terminalization semantics;
- unsafe fallback attempts do not create a new session;
- public responses expose stable blocker codes and human-safe summaries only.

## Dogfood And Verification

Wave 7 acceptance requires deterministic and credentialed real-runtime evidence.

Deterministic fake dogfood must prove:

1. a workflow reaches `code_review` through first execution;
2. an execution interruption can be continued from the latest safe capsule;
3. `Respond to review` creates a read-only `ReviewResponse` record and no run session;
4. `Request fix` creates a new run session attempt;
5. the fix attempt uses the same active Codex session and same thread digest;
6. a stale terminalization from the old execution cannot overwrite the newer continuation or fix attempt;
7. abandon/new-session requires explicit human confirmation and records a continuity-loss decision.

Credentialed real-runtime dogfood must prove:

- the same real `codex_thread_id_digest` across generation, first execution, review response, and fix attempt;
- monotonic capsule sequence across these turns;
- `expected_input_capsule_digest` equals the previous successful output capsule digest for each turn;
- the read-only review response produces no patch or changed-file artifacts;
- the fix attempt produces its own run session and Review Packet.

Required automated checks:

- contract tests for new action kinds, command DTOs, Review Response projection, and public no-raw-ref projection;
- domain tests for transitions, idempotency keys, same-session fix attempt lineage, and invalid transitions;
- repository tests for typed attempt lineage, continuation lineage, Review Packet evidence refs, stale terminalization records, and abandon/new-session state changes;
- API tests for all four product commands and forbidden legacy routes;
- worker/runtime tests for resume, read-only response rejection of mutation artifacts, fix-loop workload lineage, and stale terminalization;
- web route tests for Execution lens, Code Review lens, Recovery panel, disabled reasons, and attempt timeline;
- no-baggage smoke tests for public route retirement and forbidden raw refs;
- `pnpm test`;
- `pnpm build`;
- `git diff --check`.

## Acceptance Criteria

Wave 7 is accepted when:

- `Continue execution` resumes a recoverable interrupted attempt without creating a new Codex session or replacement thread;
- `Respond to review` is read-only, produces a `ReviewResponse` record, and keeps workflow in `code_review`;
- `Request fix` creates a new `RunSession` attempt under the same active `CodexSession`;
- Review Packet is the canonical input for review response and fix loops;
- external comments are attached as Review Packet evidence refs, not live runtime dependencies;
- same-session evidence proves stable `codex_thread_id_digest` across first execution, review response, and fix attempt;
- stale terminalization cannot overwrite newer continuation state;
- fallback to a new session requires explicit human confirmation and warning;
- public DTOs expose no raw thread ids, capsule refs, local paths, or credentials;
- no public legacy route can resume, retry, fork, or rerun workflow-owned execution outside Plan Item Workflow commands;
- deterministic fake dogfood passes;
- credentialed real-runtime dogfood passes in the acceptance environment;
- targeted tests, `pnpm test`, `pnpm build`, and `git diff --check` pass.

## Later Waves

Wave 8 should add:

- explicit fork creation and active fork selection;
- archive inactive sessions;
- session recover/scavenge operations;
- capsule retention policy;
- operator session health dashboard;
- administrative diagnostics for capsule, lease, worker, and session lineage;
- GitHub adapter work may be planned separately if product review needs live PR synchronization.
