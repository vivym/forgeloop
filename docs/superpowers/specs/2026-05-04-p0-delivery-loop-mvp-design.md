> Superseded historical migration note: this document mentions the old subsystem name for audit history only. Current commands, routes, files, and product docs use delivery terminology.

# Forgeloop P0 Delivery Loop MVP Design

## 1. Purpose

Forgeloop P0 validates the shortest usable AI-native delivery loop for a small engineering team.

The product hypothesis is that a Work Item can be constrained by an approved Spec and Plan, split into bounded Execution Packages, executed by Codex through a stable executor contract, reviewed with AI self-review plus human judgment, and replayed through a minimum evidence timeline.

The P0 loop is:

```text
Work Item -> Spec -> Plan -> Execution Package -> RunSession -> AI Self-review -> Review Packet -> Human Review -> Timeline/Evidence
```

This design intentionally uses a thin complete slice. Each layer is present, but each layer is kept to the minimum needed for team dogfood.

## 2. Product Scope

### 2.1 In Scope

P0 includes:

- Small-team collaboration fields for Work Item Owner, Spec Approver, Execution Owner, Reviewer, QA Owner, and AI Agent.
- A minimum Web workbench for Work Item, Spec/Plan, Execution Package, Run, and Review pages.
- Manual create/edit as the baseline for Spec, Plan, and Package content.
- AI draft adapters for Spec, Plan, and Package generation. P0 may start with mock AI draft behavior behind stable contracts.
- Executor adapters for `mock` and `local_codex`.
- Temporal only for `package_execution_workflow`.
- Project-level multi-repo binding, with each Execution Package bound to exactly one repo.
- PlanRevision test matrix and Package-level required checks.
- RunSession storage for execution result, check result, changed files, artifacts, logs, summaries, and failure reasons.
- Review Packet generation with AI self-review and human `approve` / `changes_requested` decisions.
- Minimum business evidence using ObjectEvent, StatusHistory, Artifact, and Decision.
- Timeline views derived from the business evidence entities.
- A review-approved patch/evidence handoff for local Codex runs. P0 does not merge, push, or release code.

### 2.2 Out of Scope

P0 excludes:

- Full Release, Incident, Contract, or Trace / Evidence Plane productization.
- A single Execution Package changing multiple repos.
- Full authorization and permission policy. P0 keeps role fields and basic ownership checks, but does not build a complete policy engine.
- Independent AI reviewer.
- QA Center, test case management, and full quality gate productization.
- Role-specific dashboards, complex status boards, and manager reporting.
- GraphQL.
- Performance scoring, Daily Replay, and retrospective learning loops.
- Automatic multi-end integration readiness inference.

## 3. Success Criteria

P0 is successful when the team can dogfood at least 3 Work Items backed by real repo context:

- One feature Work Item.
- One bugfix Work Item.
- One test or refactor Work Item.

Each Work Item must produce:

- Approved SpecRevision.
- Approved PlanRevision.
- One or more Execution Packages.
- At least one RunSession result.
- At least one Review Packet.
- A human review decision.
- A timeline with state transitions, decisions, and artifacts.

Acceptance must also include:

- At least two Work Items using the `local_codex` executor against server-configured local repo checkouts.
- At least one Work Item using the `mock` executor to validate the fallback/control-flow path.
- At least one flow that goes through `changes_requested -> rerun -> approve`.
- For each `local_codex` Work Item, a review-approved patch/diff artifact, changed-files list, required-check results, and retained workspace or artifact reference.
- For the `mock` Work Item, a clear `workflow_only=true` marker in RunSession metadata so it cannot be mistaken for real code evidence.

P0 completion does not require in-system branch push, PR creation, merge, deployment, Release object creation, or Incident/observation flow. Manual merge outside Forgeloop is allowed during dogfood, but it is not a P0 product capability.

## 4. Recommended Approach

P0 uses a thin complete loop rather than an object-only or executor-only implementation.

The rejected alternatives were:

- Object-flow first: faster UI validation, but real Codex execution risk would be discovered too late.
- Execution-first: validates executor risk early, but would not validate the team collaboration and review workflow.

The selected approach is a complete vertical slice:

- Build the minimum object model.
- Build the minimum Web workflow.
- Build a stable executor contract with mock and local Codex adapters.
- Use Temporal only where durable execution matters.
- Persist enough evidence to audit and replay the flow.

This keeps P0 focused on the product's core closed loop, not on any single subsystem.

## 5. Architecture

P0 uses a modular monorepo. It does not split into microservices, but it keeps deployable and package boundaries explicit.

### 5.1 Applications

`apps/control-plane-api`

- NestJS REST API.
- Owns command APIs for Work Item, Spec, Plan, Execution Package, Run, Review, and Query/Timeline.
- Writes business state and evidence.

`apps/web`

- Minimum Web workbench.
- Supports object creation, approval, execution trigger, run result inspection, and human review.

`apps/workflow-worker`

- Temporal worker.
- Runs only `package_execution_workflow` in P0.

`apps/executor-gateway`

- Stable execution boundary.
- Accepts RunSpec and returns ExecutorResult.
- Supports `mock` and `local_codex` adapters.

### 5.2 Packages

`packages/db`

- Drizzle schema, relations, migrations, and query functions.
- Contains cockpit and timeline query helpers.

`packages/contracts`

- RunSpec.
- ExecutorResult.
- AI draft request/result contracts.
- Review Packet generation input/output contracts.

`packages/domain`

- Enums.
- Role types.
- State transition rules.
- Domain validation such as single-repo Package enforcement and dependency cycle checks.

`packages/shared`

- Shared primitives, config helpers, error codes, and utility types.

## 6. API Style

P0 uses REST for command and query APIs.

Write operations use explicit command endpoints such as:

- `submit-for-approval`
- `approve`
- `request-changes`
- `generate-draft`
- `generate-packages`
- `run`
- `decide`

Read APIs use REST aggregation endpoints, such as:

- Work Item cockpit.
- Package timeline.
- Review Packet detail.

GraphQL is intentionally deferred until read-side aggregation complexity justifies it.

### 6.1 P0 Command Inventory

The implementation plan should slice API work around these commands and queries.

Project / repo:

- `POST /projects`
- `POST /projects/:projectId/repos`
- `GET /projects/:projectId/repos`
- `GET /projects/:projectId`

Work Item:

- `POST /work-items`
- `GET /work-items`
- `GET /work-items/:workItemId`
- `GET /work-items/:workItemId/cockpit`
- `GET /work-items/:workItemId/timeline`

Spec:

- `POST /work-items/:workItemId/specs`
- `GET /specs/:specId`
- `GET /specs/:specId/revisions`
- `GET /spec-revisions/:specRevisionId`
- `POST /specs/:specId/revisions`
- `POST /specs/:specId/generate-draft`
- `POST /specs/:specId/submit-for-approval`
- `POST /specs/:specId/approve`
- `POST /specs/:specId/request-changes`

Plan:

- `POST /work-items/:workItemId/plans`
- `GET /plans/:planId`
- `GET /plans/:planId/revisions`
- `GET /plan-revisions/:planRevisionId`
- `POST /plans/:planId/revisions`
- `POST /plans/:planId/generate-draft`
- `POST /plans/:planId/submit-for-approval`
- `POST /plans/:planId/approve`
- `POST /plans/:planId/request-changes`

Execution Package:

- `POST /plan-revisions/:planRevisionId/generate-packages`
- `POST /plan-revisions/:planRevisionId/execution-packages`
- `GET /work-items/:workItemId/execution-packages`
- `GET /execution-packages/:packageId`
- `PATCH /execution-packages/:packageId`
- `POST /execution-packages/:packageId/mark-ready`
- `POST /execution-packages/:packageId/run`
- `POST /execution-packages/:packageId/rerun`
- `POST /execution-packages/:packageId/force-rerun`

Run / review:

- `GET /run-sessions/:runSessionId`
- `GET /review-packets/:reviewPacketId`
- `POST /review-packets/:reviewPacketId/approve`
- `POST /review-packets/:reviewPacketId/request-changes`

Executor-gateway internal API, called only by `package_execution_workflow`:

- `POST /internal/executions`
- `GET /internal/executions/:executionId`

The executor-gateway does not write Forgeloop domain tables in P0. Only the workflow persists RunSession progress, ExecutorResult, artifacts, Package state, and Review Packet data.

## 7. Core Components

### 7.1 Project / Repo

Project is the P0 container object. A Project can bind multiple repos. Each Execution Package must select exactly one repo from the Project's repo bindings.

P0 only validates that a repo belongs to the Project. It does not implement deep repo enrollment, provider verification, or Trace Stream registration.

Minimum `ProjectRepo` fields:

- `id`
- `project_id`
- `repo_id`
- `name`
- `local_path`
- `default_branch`
- `base_commit_sha`
- `status`: `active`, `paused`, or `archived`
- `created_at`
- `updated_at`

`local_path` is required for `local_codex` dogfood. Remote clone/provisioning is out of scope; operators configure the local checkout before running a `local_codex` Package.

### 7.2 Work Item

Work Item is the business collaboration object. It records:

- Kind: feature, bugfix, tech debt, or test/refactor.
- Goal and success criteria.
- Priority and risk.
- Owner fields.
- Current Spec and Plan pointers.
- Aggregated phase, gate, activity, and resolution.

Work Item does not contain execution detail. Execution detail belongs to Execution Package and RunSession.

### 7.3 Spec / Plan

Spec and Plan are revisioned definition objects.

SpecRevision stores:

- Background.
- Goals.
- Scope in and out.
- Acceptance criteria.
- Risk notes.
- Test strategy summary.
- Raw markdown and optional structured document data.

PlanRevision stores:

- Implementation summary.
- Split strategy.
- Dependency order.
- Test matrix.
- Risk mitigations.
- Rollback notes.
- Raw markdown and optional structured document data.

Both Spec and Plan support manual editing as the baseline and AI draft through adapters.

### 7.4 Execution Package

Execution Package is the execution unit. It freezes:

- Work Item ID.
- Spec ID and SpecRevision ID.
- Plan ID and PlanRevision ID.
- Repo ID.
- Objective.
- Allowed paths and forbidden paths.
- Required checks inherited from the PlanRevision test matrix.
- Execution owner, reviewer, and QA owner.
- Dependency links to other packages.

An Execution Package must not span multiple repos.

Manual Package creation and editing are in scope:

- `POST /plan-revisions/:planRevisionId/execution-packages` creates one Package manually from an approved PlanRevision.
- `PATCH /execution-packages/:packageId` edits Package content only while the Package is `draft` or `ready`.
- After `changes_requested`, the Package returns to `ready`; users may edit it before rerun.
- Editing a Package with an open Review Packet archives that Review Packet.
- Editing does not delete old RunSessions; it only ensures the next run gets a new RunSpec snapshot.
- `force-rerun` is an owner-only P0 escape hatch for an open Review Packet that is still `ready` or `in_review`; it archives that open packet and starts a new RunSession. It is not available after a completed review decision.

The QA Owner is field-level in P0. They own or review the test matrix / required checks, but P0 does not include a separate QA queue or QA gate UI.

### 7.5 RunSession

RunSession records one execution attempt for one Execution Package.

It stores:

- Executor type: `mock` or `local_codex`.
- RunSpec snapshot.
- Status.
- Started and finished timestamps.
- Changed files.
- Check results.
- Artifact refs.
- Log refs.
- Summary.
- Failure reason and failure kind.

RunSession is the factual record of each attempt. The Package points to its current RunSession.

### 7.6 Review Packet

Review Packet is generated from a specific RunSession.

It contains:

- Package and RunSession references.
- SpecRevision and PlanRevision references.
- Changed files.
- Check result summary.
- AI self-review.
- Risk notes.
- Human review decision and requested-change payload.

Review Packet uses `status + decision`:

- `status`: `ready`, `in_review`, `completed`, or `archived`
- `decision`: `none`, `approved`, or `changes_requested`

P0 supports `approve` and `changes_requested` decisions. `changes_requested` is a decision, not a status. If a newer RunSession is created, older non-completed Review Packets become `status=archived` with `decision=none`.

The `request-changes` command must capture:

- `summary`
- `requested_changes`: one or more structured items with title, description, optional file path, optional severity, and optional suggested validation
- `reviewed_by_actor_id`
- `reviewed_at`

The next rerun includes the latest requested-change decision in RunSpec context so the executor does not repeat the same attempt blindly.

### 7.7 Evidence / Timeline

P0 evidence is business-facing and minimal.

Entities:

- ObjectEvent for important actions.
- StatusHistory for state changes.
- Artifact for logs, diffs, check output, and run/review assets.
- Decision for approvals and review outcomes.

Artifacts include future trace link fields such as `trace_subject_type` and `trace_subject_id`, but P0 does not build the full TraceEvent ledger.

### 7.8 Executor Contracts

`RunSpec` is the stable input from the control plane and workflow to executor-gateway. P0 must define it in `packages/contracts` before implementing either executor.

Minimum `RunSpec` fields:

- `run_session_id`
- `execution_package_id`
- `work_item_id`
- `spec_revision_id`
- `plan_revision_id`
- `executor_type`: `mock` or `local_codex`
- `repo`: `repo_id`, `local_path`, `base_branch`, `base_commit_sha`
- `objective`
- `context`: frozen SpecRevision summary, PlanRevision summary, Package instructions, and required checks
- `review_context`: latest requested changes when rerunning after a review decision, otherwise empty
- `allowed_paths`
- `forbidden_paths`
- `required_checks`: stable check ID, display name, command, timeout seconds, and whether failure blocks review
- `artifact_policy`: requested artifacts such as diff, changed files, check output, logs, and execution summary
- `timeout_seconds`
- `idempotency_key`

Minimum `ExecutorResult` fields:

- `run_session_id`
- `executor_type`
- `executor_version`
- `status`: `succeeded`, `failed`, `cancelled`, or `timed_out`
- `started_at`
- `finished_at`
- `summary`
- `changed_files`: repo ID, path, and change kind
- `checks`: check ID, command, status, exit code, duration, and stdout/stderr artifact refs
- `artifacts`: kind, name, content type, storage URI or local ref, digest if available
- `failure`: failure kind, message, and retryable flag when status is not succeeded
- `raw_metadata`: JSON for executor-specific diagnostics that must not drive core state transitions

The workflow persists the complete RunSpec snapshot before execution and persists the complete ExecutorResult after execution. Review Packet generation reads only persisted RunSession data, not live executor state.

Required-check semantics:

- Blocking check failure produces `ExecutorResult.status=failed`, failure kind `required_check_failed`, and no Review Packet.
- Non-blocking check failure produces `ExecutorResult.status=succeeded` with failed check entries. The workflow still generates AI self-review and Review Packet, and the Review Packet must highlight the failed non-blocking checks as risks.
- Mixed check results follow the strictest failing check. If any blocking check fails, the ExecutorResult is failed.
- A check that cannot run because its tool or command is missing is treated as blocking unless the RunSpec explicitly marks that check as non-blocking.

### 7.9 AI Self-review Contract

AI self-review is a mandatory Review Packet input, but P0 treats self-review failure as review context degradation, not as execution failure.

Minimum `SelfReviewInput` fields:

- `run_session_id`
- `execution_package_id`
- `spec_revision_id`
- `plan_revision_id`
- `run_summary`
- `changed_files`
- `check_results`
- `artifact_refs`
- `requested_changes_context` when this run is a rerun after review changes

Minimum `SelfReviewResult` fields:

- `status`: `succeeded` or `failed`
- `summary`
- `spec_plan_alignment`
- `test_assessment`
- `risk_notes`
- `follow_up_questions`
- `failure_message` when status is `failed`

P0 must provide a deterministic mock self-review adapter. A failed self-review still creates a Review Packet with `ai_self_review.status=failed`, records an ObjectEvent, and adds a visible risk note for the human reviewer.

### 7.10 `local_codex` Executor Semantics

`local_codex` runs against one server-configured repo checkout for the Package's `repo_id`.

P0 rules:

- The ProjectRepo record must provide `local_path`; remote provider clone/provisioning is out of scope.
- The executor-gateway creates a disposable worktree or workspace for `run_session_id` from `base_commit_sha` or the configured base branch.
- The executor must enforce the Package's single repo, `allowed_paths`, and `forbidden_paths` boundaries before returning success.
- The executor runs Codex with the frozen RunSpec context and required checks.
- The executor returns changed files, diff/log/check artifacts, and summary through ExecutorResult.
- The executor returns a patch/diff artifact and a retained workspace reference for human inspection.
- The executor does not push branches, open PRs, merge code, or publish releases in P0.
- If the workspace cannot be prepared cleanly, the result is `failed` with failure kind `workspace_prepare_failed`.

`mock` executor uses the same RunSpec and ExecutorResult contracts, but generates deterministic success, failure, and check-failed outputs for tests and demos.

### 7.11 `local_codex` Preflight Contract

Before starting Codex, executor-gateway must validate:

- ProjectRepo `local_path` exists and is a Git repo.
- Git is available.
- Codex runtime/CLI is available and authenticated for local execution.
- Executor-level tools needed to run Codex and capture artifacts are available.
- `base_commit_sha` resolves; if omitted, the configured `default_branch` resolves to a commit.
- A disposable worktree/workspace can be created for `run_session_id`.
- Artifact storage root is configured and writable.
- The disposable workspace starts clean.

Dirty source checkouts are acceptable because P0 executes in a disposable worktree. Dirty disposable workspaces are not acceptable.

Preflight failure returns `ExecutorResult.status=failed` with failure kind `preflight_failed` and does not invoke Codex. Missing tools or commands for individual required checks are not preflight failures; they are recorded as check results and then interpreted by the blocking/non-blocking required-check rules in section 7.8. After execution, the workspace is retained until artifacts are captured and the run is reviewable; automatic cleanup can be a separate maintenance command outside P0 user flows.

## 8. Data Model Boundary

P0 creates only shortest-loop tables plus extension fields.

Required P0 entities:

- Project.
- ProjectRepo.
- WorkItem.
- Spec.
- SpecRevision.
- Plan.
- PlanRevision.
- ExecutionPackage.
- ExecutionPackageDependency.
- RunSession.
- ReviewPacket.
- ObjectEvent.
- StatusHistory.
- Artifact.
- Decision.

Deferred entities:

- Release.
- Incident.
- Contract.
- TestEvidence.
- TraceStream.
- TraceEvent.
- TraceSpan.
- TraceBlob.
- TraceLink.
- WorkspaceState.
- CodeRevision.

P0 must not make deferred entities hard to add. The most important extension points are:

- Package and RunSession keep repo and commit fields.
- Artifact can reference future trace subjects.
- SpecRevision, PlanRevision, Package, RunSession, and ReviewPacket IDs are stable enough to become TraceLink object targets.
- PlanRevision test matrix can later map to TestEvidence and QA gates.

P0 ReviewPacket schema must include both processing status and decision fields. Do not model review outcomes as statuses.

## 9. Workflow Design

### 9.1 Application Commands

The control plane handles these flows through application commands:

- Work Item creation.
- Spec draft generation.
- Spec revision creation and editing.
- Spec submission and approval.
- Plan draft generation.
- Plan revision creation and editing.
- Plan submission and approval.
- Package generation.
- Manual Package creation and editing.
- Package readiness changes.
- Owner force-rerun from open review.

These flows are synchronous or short asynchronous commands in P0.

### 9.2 Temporal Workflow

Only package execution uses Temporal.

`package_execution_workflow`:

1. Load Package, approved SpecRevision, approved PlanRevision, and repo context.
2. Build and persist a RunSpec snapshot.
3. Update the existing RunSession as queued/running.
4. Call executor-gateway with selected executor type and `run_session_id` as the idempotency key.
5. Poll executor-gateway or wait for the call to complete, depending on adapter behavior.
6. Persist ExecutorResult into RunSession.
7. Persist artifacts and status history.
8. On success, generate AI self-review.
9. Create Review Packet.
10. Move Package to awaiting human review.
11. On failure, mark RunSession failed or timed out and move Package to a rerunnable or blocked state.

The workflow must be idempotent for repeated starts, executor polling retries, and result persistence retries.

The control plane is the authoritative creator of RunSession. The `run` command creates the RunSession with status `queued`, stores the initial RunSpec snapshot or the data needed to build it, and starts the Temporal workflow with `run_session_id`. The workflow is authoritative for execution progress and result persistence after that point.

The workflow is the only component allowed to write RunSession execution progress or final ExecutorResult in P0. Executor-gateway stores only transient execution state needed to return or poll the result. P0 does not expose cancellation as a user API; `cancelled` is an internal RunSession state reserved for system shutdown or future cancellation support.

`force-rerun` uses the same Temporal workflow as `run`. Before creating the new RunSession, the control plane archives the Package's current open Review Packet if its status is `ready` or `in_review`. Completed Review Packets cannot be archived by force-rerun.

## 10. Data Flow

### 10.1 Intake

A user creates a Work Item in the Web app. The API stores WorkItem, initial StatusHistory, and ObjectEvent.

### 10.2 Spec

A user manually creates a SpecRevision or requests an AI draft. Submission moves Spec into review. Approval writes a Decision, updates approved/current revision pointers, and updates WorkItem's current Spec pointer.

### 10.3 Plan

A user manually creates a PlanRevision or requests an AI draft based on the approved SpecRevision. The PlanRevision includes a test matrix and split strategy. Approval writes a Decision and updates WorkItem's current Plan pointer.

### 10.4 Package Build

A user manually creates/edits Packages or uses the AI draft adapter to generate Packages from the approved PlanRevision. The system validates repo membership, single-repo Package scope, required checks, and dependency cycles.

### 10.5 Execution

A user triggers a Package run. The control plane creates a RunSession and starts the Temporal workflow. The executor-gateway runs either mock execution or local Codex execution. Results are written back to the same RunSession and artifacts.

### 10.6 Review

Successful execution creates a Review Packet. The reviewer inspects the packet and decides `approve` or `changes_requested`. Decisions are persisted and reflected in Package state and timeline. Requested changes are included in the next rerun's RunSpec context.

## 11. State Model

P0 uses the state model from `docs/architecture-design/v0/status_design.md`, narrowed to the transitions below. The implementation plan must treat these transitions as the P0 source of truth.

WorkItem:

- `phase`
- `activity_state`
- `gate_state`
- `resolution`

Spec and Plan:

- `status`
- `editing_state`
- `gate_state`
- `resolution`

ExecutionPackage:

- `phase`
- `activity_state`
- `gate_state`
- `resolution`

RunSession:

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`
- `timed_out`

ReviewPacket:

- `status`: `ready`, `in_review`, `completed`, or `archived`
- `decision`: `none`, `approved`, or `changes_requested`

Instant actions are not encoded as statuses. They are written as ObjectEvent, StatusHistory, or Decision.

### 11.1 Required P0 Transitions

WorkItem:

| Trigger | From | To |
| --- | --- | --- |
| create work item | none | `phase=draft`, `activity_state=idle`, `gate_state=none`, `resolution=none` |
| submit spec | `draft` or `triage` | `phase=spec`, `gate_state=awaiting_spec_approval` |
| approve spec | `phase=spec` | `phase=plan`, `gate_state=none` |
| request spec changes | `phase=spec` | `phase=spec`, `gate_state=spec_changes_requested` |
| resubmit spec | `phase=spec`, `gate_state=spec_changes_requested` | `phase=spec`, `gate_state=awaiting_spec_approval` |
| submit plan | `phase=plan` | `phase=plan`, `gate_state=awaiting_plan_approval` |
| approve plan | `phase=plan` | `phase=execution`, `gate_state=none` |
| request plan changes | `phase=plan` | `phase=plan`, `gate_state=plan_changes_requested` |
| resubmit plan | `phase=plan`, `gate_state=plan_changes_requested` | `phase=plan`, `gate_state=awaiting_plan_approval` |
| all packages review-approved with successful runs and required artifacts | `phase=execution` | `phase=done`, `resolution=completed` |

Spec / Plan:

| Trigger | From | To |
| --- | --- | --- |
| create | none | `status=draft`, `editing_state=idle`, `gate_state=not_submitted`, `resolution=none` |
| generate draft start | `status=draft` | `editing_state=ai_drafting` |
| generate draft success/failure | `editing_state=ai_drafting` | `editing_state=idle` |
| submit for approval | `status=draft` | `status=in_review`, `gate_state=awaiting_approval` |
| approve | `status=in_review` | `status=approved`, `gate_state=approved`, `resolution=approved` |
| request changes | `status=in_review` | `status=draft`, `gate_state=changes_requested`, `resolution=none` |

ExecutionPackage:

| Trigger | From | To |
| --- | --- | --- |
| generate package | none | `phase=draft`, `activity_state=idle`, `gate_state=not_submitted`, `resolution=none` |
| mark ready | `phase=draft` | `phase=ready`, `gate_state=not_submitted` |
| run or rerun | `phase=ready` or rerunnable after changes | `phase=queued`, `activity_state=awaiting_ai` |
| force-rerun | `phase=review` with open Review Packet | `phase=queued`, `activity_state=awaiting_ai`, archive open Review Packet |
| workflow starts executor | `phase=queued` | `phase=execution`, `activity_state=ai_running` |
| execution failed retryable | `phase=execution` | `phase=ready`, `activity_state=idle`, with last failure summary |
| execution failed blocked | `phase=execution` | `phase=execution`, `activity_state=blocked`, with blocked reason |
| execution succeeded, including non-blocking check failures | `phase=execution` | `phase=review`, `activity_state=awaiting_human`, `gate_state=awaiting_human_review` |
| execution failed due to blocking check failure | `phase=execution` | `phase=ready`, `activity_state=idle`, with last failure summary |
| review approved | `phase=review` | `phase=review`, `activity_state=idle`, `gate_state=review_approved`, `resolution=completed` |
| review changes requested | `phase=review` | `phase=ready`, `activity_state=idle`, `gate_state=changes_requested`, `resolution=none` |

RunSession:

| Trigger | From | To |
| --- | --- | --- |
| run command creates session | none | `queued` |
| workflow starts executor | `queued` | `running` |
| executor success | `running` | `succeeded` |
| executor failure | `running` | `failed` |
| executor timeout | `running` | `timed_out` |
| user/system cancellation | `queued` or `running` | `cancelled` |

ReviewPacket:

| Trigger | From | To |
| --- | --- | --- |
| execution success creates packet | none | `status=ready`, `decision=none` |
| reviewer starts review | `status=ready` | `status=in_review`, `decision=none` |
| reviewer approves | `status=ready` or `in_review` | `status=completed`, `decision=approved` |
| reviewer requests changes | `status=ready` or `in_review` | `status=completed`, `decision=changes_requested` |
| newer RunSession created before decision | `status=ready` or `in_review` | `status=archived`, `decision=none` |

## 12. Error Handling

### 12.1 AI Draft Failures

AI draft failures do not mutate approved content. The system records an ObjectEvent and returns a structured error summary. Users can continue with manual editing.

### 12.2 Package Generation Failures

Package generation is atomic. The system does not create partial package sets.

Structured errors include:

- Repo not bound to Project.
- Package spans multiple repos.
- Missing required checks.
- Missing owner or reviewer.
- Dependency cycle.
- Package lacks execution objective.

### 12.3 Execution Failures

Every execution attempt is preserved as a RunSession.

Failure kinds include:

- Executor timeout.
- Executor process failure.
- Codex output parse failure.
- Required check failure.
- Artifact upload failure.
- Preflight failure.
- Unknown executor failure.

Package state moves to rerunnable or blocked with a clear failure summary. Users can rerun, switch executor, or manually edit before rerun.

### 12.4 Review Staleness

Review Packets are tied to a specific RunSession. When a newer RunSession is created, older open Review Packets are archived. Completed Review Packets remain immutable historical decisions.

### 12.5 AI Self-review Failures

AI self-review failures do not fail an otherwise successful RunSession. They create Review Packet context with `ai_self_review.status=failed`, record an ObjectEvent, and surface a warning to the human reviewer.

### 12.6 Evidence

Large logs and detailed outputs are stored as Artifact refs. ObjectEvent and StatusHistory store concise summaries only.

## 13. Web Workbench

P0 Web screens:

- Work Item list.
- Work Item detail / cockpit.
- Spec detail and revision editor.
- Plan detail and revision editor.
- Execution Package list for a Work Item.
- Execution Package detail.
- RunSession detail.
- Review Packet detail.
- Timeline view.

P0 UI expectations:

- Keep pages operational and dense.
- Prefer clear workflow actions over dashboard decoration.
- Do not build role-specific homepages in P0.
- Show current state, blockers, owner/reviewer, and next action clearly.

## 14. Testing Strategy

### 14.1 Domain Tests

Cover:

- State transitions.
- Approval rules.
- Single-repo Package enforcement.
- Required check validation.
- Dependency cycle detection.
- Archiving stale Review Packets.
- Work Item aggregate status derivation.

### 14.2 API Tests

Cover:

- Create Work Item.
- Create and approve Spec.
- Create and approve Plan.
- Generate Packages.
- Manually create and edit a Package.
- Trigger Run.
- Persist ExecutorResult.
- Generate Review Packet.
- Approve review.
- Request changes.
- Rerun with requested changes in RunSpec context.
- Query timeline.

### 14.3 Workflow Tests

Cover:

- Successful package execution.
- Executor failure.
- Executor timeout.
- Required check failure.
- Non-blocking required check failure still creates Review Packet.
- Blocking required check failure does not create Review Packet.
- Result polling and idempotent persistence replay.
- Duplicate workflow start idempotency.

### 14.4 Executor Adapter Tests

Mock executor must support:

- Success result.
- Failure result.
- Required check failure result.

Local Codex executor should use contract tests for RunSpec and ExecutorResult. It does not need to run in default CI if the local environment is unavailable.

Preflight tests must cover missing Codex runtime/auth, missing repo path, unresolved base commit, unwritable artifact root, and workspace prepare failure. Required-check command missing tests belong under workflow/executor result tests because they depend on each check's blocking flag.

### 14.5 Self-review Adapter Tests

Cover:

- Successful mock self-review.
- Failed self-review still creates Review Packet.
- Requested-change context appears in self-review input on rerun.

### 14.6 Web Smoke Tests

Cover two end-to-end browser flows:

```text
Work Item -> Spec approval -> Plan approval -> Package run -> Review decision
```

```text
Work Item -> Spec approval -> Plan approval -> Package run -> changes_requested -> edit Package or rerun -> new RunSession -> new Review Packet -> approve
```

The second flow must verify that the completed `changes_requested` Review Packet remains immutable, the new RunSpec includes requested-change context, and the Work Item reaches `done` only after all Packages have successful runs, review-approved decisions, and required artifacts.

A separate stale-packet test should use `force-rerun` to verify that an open `ready` or `in_review` Review Packet is archived when a newer RunSession is created before a human decision.

### 14.7 Dogfood Environment Checklist

Before `local_codex` acceptance runs, verify:

- ProjectRepo local checkout path exists.
- Codex runtime is installed and authenticated.
- Git is available.
- Required check commands exist.
- Artifact storage root is writable.
- Base branch or base commit resolves.
- Disposable workspace creation succeeds.
- The test operator knows that merge/push/PR is manual and outside P0.

## 15. Implementation Planning Notes

The next implementation plan should preserve this order:

1. Monorepo, apps, packages, and local infrastructure.
2. Drizzle schema for P0 entities.
3. Domain enums and state transition helpers.
4. Control-plane command APIs.
5. Minimum Web workbench pages.
6. Executor contracts and mock executor.
7. Self-review contract and mock self-review adapter.
8. Temporal package execution workflow.
9. Local Codex executor and preflight checks.
10. Review Packet generation and human review.
11. Timeline queries.
12. Dogfood acceptance flows.

Do not implement Release, Incident, Contract, or full Trace Plane in the P0 plan. They should be separate specs after the delivery loop is validated.

## 16. Open Decisions Already Resolved

These decisions are fixed for P0:

- Small-team collaboration rather than single-user dogfood.
- Thin complete loop rather than object-only or executor-only.
- Minimum Web workbench rather than API-only.
- Mock and local Codex executor adapters.
- Manual editing plus AI draft adapters.
- P0 schema only, with extension points for future Release, Contract, and Trace.
- Business evidence minimum rather than full Trace Plane.
- Project multi-repo, Package single-repo.
- AI self-review plus human review.
- PlanRevision test matrix plus Package required checks.
- Temporal only for Package execution.
- Team-internal dogfood success criteria with 3 real Work Items.
