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

P0 is successful when the team can dogfood at least 3 real Work Items in real repos:

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

- At least one Work Item using the `mock` executor.
- At least one Work Item using the `local_codex` executor.
- At least one flow that goes through `changes_requested -> rerun -> approve`.

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

Work Item:

- `POST /work-items`
- `GET /work-items`
- `GET /work-items/:workItemId`
- `GET /work-items/:workItemId/cockpit`
- `GET /work-items/:workItemId/timeline`

Spec:

- `POST /work-items/:workItemId/specs`
- `POST /specs/:specId/revisions`
- `POST /specs/:specId/generate-draft`
- `POST /specs/:specId/submit-for-approval`
- `POST /specs/:specId/approve`
- `POST /specs/:specId/request-changes`

Plan:

- `POST /work-items/:workItemId/plans`
- `POST /plans/:planId/revisions`
- `POST /plans/:planId/generate-draft`
- `POST /plans/:planId/submit-for-approval`
- `POST /plans/:planId/approve`
- `POST /plans/:planId/request-changes`

Execution Package:

- `POST /plan-revisions/:planRevisionId/generate-packages`
- `GET /work-items/:workItemId/execution-packages`
- `GET /execution-packages/:packageId`
- `POST /execution-packages/:packageId/mark-ready`
- `POST /execution-packages/:packageId/run`
- `POST /execution-packages/:packageId/rerun`

Run / review:

- `GET /run-sessions/:runSessionId`
- `GET /review-packets/:reviewPacketId`
- `POST /review-packets/:reviewPacketId/approve`
- `POST /review-packets/:reviewPacketId/request-changes`

Internal executor callbacks:

- `POST /internal/executions`
- `POST /internal/executions/:executionId/result`
- `GET /internal/executions/:executionId`

## 7. Core Components

### 7.1 Project / Repo

Project is the P0 container object. A Project can bind multiple repos. Each Execution Package must select exactly one repo from the Project's repo bindings.

P0 only validates that a repo belongs to the Project. It does not implement deep repo enrollment, provider verification, or Trace Stream registration.

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
- Human review decision.

P0 supports `approve` and `changes_requested`. If a newer RunSession is created, older open Review Packets become superseded.

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

### 7.9 `local_codex` Executor Semantics

`local_codex` runs against one server-configured repo checkout for the Package's `repo_id`.

P0 rules:

- The ProjectRepo record must provide `local_path`; remote provider clone/provisioning is out of scope.
- The executor-gateway creates a disposable worktree or workspace for `run_session_id` from `base_commit_sha` or the configured base branch.
- The executor must enforce the Package's single repo, `allowed_paths`, and `forbidden_paths` boundaries before returning success.
- The executor runs Codex with the frozen RunSpec context and required checks.
- The executor returns changed files, diff/log/check artifacts, and summary through ExecutorResult.
- The executor does not push branches, open PRs, merge code, or publish releases in P0.
- If the workspace cannot be prepared cleanly, the result is `failed` with failure kind `workspace_prepare_failed`.

`mock` executor uses the same RunSpec and ExecutorResult contracts, but generates deterministic success, failure, and check-failed outputs for tests and demos.

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
- Package readiness changes.

These flows are synchronous or short asynchronous commands in P0.

### 9.2 Temporal Workflow

Only package execution uses Temporal.

`package_execution_workflow`:

1. Load Package, approved SpecRevision, approved PlanRevision, and repo context.
2. Build and persist a RunSpec snapshot.
3. Update the existing RunSession as queued/running.
4. Call executor-gateway with selected executor type.
5. Wait for result or callback.
6. Persist ExecutorResult into RunSession.
7. Persist artifacts and status history.
8. On success, generate AI self-review.
9. Create Review Packet.
10. Move Package to awaiting human review.
11. On failure, mark RunSession failed or timed out and move Package to a rerunnable or blocked state.

The workflow must be idempotent for repeated starts, callback retries, and result persistence retries.

The control plane is the authoritative creator of RunSession. The `run` command creates the RunSession with status `queued`, stores the initial RunSpec snapshot or the data needed to build it, and starts the Temporal workflow with `run_session_id`. The workflow is authoritative for execution progress and result persistence after that point.

## 10. Data Flow

### 10.1 Intake

A user creates a Work Item in the Web app. The API stores WorkItem, initial StatusHistory, and ObjectEvent.

### 10.2 Spec

A user manually creates a SpecRevision or requests an AI draft. Submission moves Spec into review. Approval writes a Decision, updates approved/current revision pointers, and updates WorkItem's current Spec pointer.

### 10.3 Plan

A user manually creates a PlanRevision or requests an AI draft based on the approved SpecRevision. The PlanRevision includes a test matrix and split strategy. Approval writes a Decision and updates WorkItem's current Plan pointer.

### 10.4 Package Build

A user or AI draft adapter generates packages from the approved PlanRevision. The system validates repo membership, single-repo Package scope, required checks, and dependency cycles.

### 10.5 Execution

A user triggers a Package run. The control plane creates a RunSession and starts the Temporal workflow. The executor-gateway runs either mock execution or local Codex execution. Results are written back to the same RunSession and artifacts.

### 10.6 Review

Successful execution creates a Review Packet. The reviewer inspects the packet and decides `approve` or `changes_requested`. Decisions are persisted and reflected in Package state and timeline.

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

- `draft`
- `awaiting_human_review`
- `approved`
- `changes_requested`
- `superseded`

Instant actions are not encoded as statuses. They are written as ObjectEvent, StatusHistory, or Decision.

### 11.1 Required P0 Transitions

WorkItem:

| Trigger | From | To |
| --- | --- | --- |
| create work item | none | `phase=draft`, `activity_state=idle`, `gate_state=none`, `resolution=none` |
| submit spec | `draft` or `triage` | `phase=spec`, `gate_state=awaiting_spec_approval` |
| approve spec | `phase=spec` | `phase=plan`, `gate_state=none` |
| submit plan | `phase=plan` | `phase=plan`, `gate_state=awaiting_plan_approval` |
| approve plan | `phase=plan` | `phase=execution`, `gate_state=none` |
| all packages approved | `phase=execution` | `phase=done`, `resolution=completed` |

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
| run | `phase=ready` or rerunnable after changes | `phase=execution`, `activity_state=ai_running` |
| execution failed retryable | `phase=execution` | `phase=ready`, `activity_state=idle`, with last failure summary |
| execution failed blocked | `phase=execution` | `phase=execution`, `activity_state=blocked`, with blocked reason |
| execution succeeded | `phase=execution` | `phase=review`, `activity_state=awaiting_human`, `gate_state=awaiting_human_review` |
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
| execution success creates packet | none | `awaiting_human_review` |
| reviewer approves | `awaiting_human_review` | `approved` |
| reviewer requests changes | `awaiting_human_review` | `changes_requested` |
| newer RunSession created | `awaiting_human_review` | `superseded` |

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
- Unknown executor failure.

Package state moves to rerunnable or blocked with a clear failure summary. Users can rerun, switch executor, or manually edit before rerun.

### 12.4 Review Staleness

Review Packets are tied to a specific RunSession. When a newer RunSession is created, older open Review Packets are superseded.

### 12.5 Evidence

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
- Superseding stale Review Packets.
- Work Item aggregate status derivation.

### 14.2 API Tests

Cover:

- Create Work Item.
- Create and approve Spec.
- Create and approve Plan.
- Generate Packages.
- Trigger Run.
- Persist ExecutorResult.
- Generate Review Packet.
- Approve review.
- Request changes.
- Query timeline.

### 14.3 Workflow Tests

Cover:

- Successful package execution.
- Executor failure.
- Executor timeout.
- Required check failure.
- Callback/result replay.
- Duplicate workflow start idempotency.

### 14.4 Executor Adapter Tests

Mock executor must support:

- Success result.
- Failure result.
- Required check failure result.

Local Codex executor should use contract tests for RunSpec and ExecutorResult. It does not need to run in default CI if the local environment is unavailable.

### 14.5 Web Smoke Tests

Cover one end-to-end browser flow:

```text
Work Item -> Spec approval -> Plan approval -> Package run -> Review decision
```

## 15. Implementation Planning Notes

The next implementation plan should preserve this order:

1. Monorepo, apps, packages, and local infrastructure.
2. Drizzle schema for P0 entities.
3. Domain enums and state transition helpers.
4. Control-plane command APIs.
5. Minimum Web workbench pages.
6. Executor contracts and mock executor.
7. Temporal package execution workflow.
8. Local Codex executor.
9. Review Packet generation and human review.
10. Timeline queries.
11. Dogfood acceptance flows.

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
