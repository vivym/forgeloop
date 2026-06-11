# Plan Item Session Operations Control Plane Design

## Status

Approved design for spec review.

## Purpose

This spec defines Wave 8 of
`2026-05-30-plan-item-codex-session-continuity-generation-loop-design.md`.

Waves 1-7 established the product path where a Plan Item Workflow owns one
active `CodexSession`, carries that same Codex session through Brainstorming,
Spec, Plan, execution, code review response, and review-fix loops, and refuses
hidden fallback to fresh sessions.

Wave 8 makes that model operable for real team usage. A team will eventually
see stale worker leases, orphaned queued actions, incomplete capsule lineage,
operator recovery needs, and explicit session forks. These must not become
separate ad hoc features. They need one product-level operations control plane that can
diagnose, recover, audit, and later support fork and retention decisions without
exposing raw Codex runtime internals.

The first implementation slice is **Recovery/Ops Foundation**:

```text
Plan Item Workflow
  -> active CodexSession
  -> queued action / worker lease / latest capsule
  -> SessionHealthProjection
  -> Operator dashboard and Plan Item diagnostics
  -> recover/scavenge control-only actions
  -> audited recovered state
  -> human explicitly continues, forks, or archives later
```

Recovery in this wave restores control and consistency. It does not invoke
Codex, create a new Codex session, automatically fork, or automatically advance
the Plan Item Workflow.

## Authority

This spec extends:

- `docs/superpowers/specs/2026-05-30-plan-item-codex-session-continuity-generation-loop-design.md`;
- `docs/superpowers/specs/2026-05-31-codex-session-data-model-and-lease-design.md`;
- `docs/superpowers/specs/2026-06-01-app-server-resume-protocol-support-design.md`;
- `docs/superpowers/specs/2026-06-02-codex-runtime-capsule-packaging-restore-design.md`;
- `docs/superpowers/specs/2026-06-03-plan-item-workflow-product-loop-design.md`;
- `docs/superpowers/specs/2026-06-06-plan-item-execution-handoff-continuity-design.md`;
- `docs/superpowers/specs/2026-06-07-plan-item-execution-continuation-review-fix-loop-design.md`;
- `docs/PRD_v1.md`.

This spec is authoritative for Wave 8 session health projection,
recover/scavenge semantics, operator diagnostics, Plan Item session diagnostics,
audit records for recovery operations, and the read-model hooks needed by later
fork and retention work.

It is not authoritative for GitHub PR synchronization, QA automation, release
automation, automatic session merging, raw Codex session browsing, or a generic
task extraction model.

## Scope

Wave 8 includes the complete design boundary for:

- explicit fork UI and API;
- active fork selection;
- inactive session archival;
- session recover/scavenge operations;
- capsule retention safety;
- session health dashboard for operators;
- Plan Item local diagnostics;
- administrative diagnostics for capsule, lease, worker, queued action, and
  session lineage;
- runbook updates.

The first implementation slice includes:

- a product-level `SessionHealthProjection` or equivalent read model;
- health states for healthy, attention-needed, and blocked sessions;
- stale worker lease and orphaned action detection;
- safe capsule/checkpoint lineage diagnostics;
- recover/scavenge operations that only repair control/state consistency;
- operator-scoped dashboard API and UI skeleton;
- Plan Item diagnostics projection;
- recovery audit records;
- no-baggage guards preventing legacy runtime bypasses.

The first implementation slice does not include:

- public fork creation routes;
- active fork selection routes;
- full fork comparison UI;
- automatic capsule deletion;
- full retention cleanup workers;
- automatic Codex continuation after recovery;
- raw Codex runtime capsule downloads;
- public exposure of raw capsule archives, raw `~/.codex` paths, secrets,
  connector credentials, or full thread state.

## Design Decision

Wave 8 uses an **Operations Control Plane First** design.

Fork, retention, and operator recovery all depend on the same facts:

- which `CodexSession` is active for a `PlanItemWorkflow`;
- whether that session has an active lease;
- whether a queued action or turn is still valid;
- whether the latest capsule is present and digest-consistent;
- whether a checkpoint or fork point pins a capsule;
- whether a human has explicitly chosen a session or fork;
- whether an operation already recovered or terminalized a stale condition.

Those facts must be computed once through a product-level operations control plane, not
reimplemented independently by fork UI, retention jobs, dashboard widgets, and
CLI commands.

The operations control plane has four responsibilities:

1. derive a safe health projection from existing workflow/session/runtime state;
2. execute control-only recovery operations with fencing and idempotency;
3. expose safe diagnostics to the right role and surface;
4. write audit events for every operational decision.

Later fork and retention features must consume this control plane. They must not create
parallel health-state logic or raw runtime endpoints.

## Roles And Permissions

Wave 8 separates product decisions from runtime operations:

- **Tech Lead**
  - can view Plan Item diagnostics only for workflows in projects where the
    actor has Tech Lead or equivalent project authority;
  - can continue the current active session when the workflow is recoverable and
    the actor is authorized for that Plan Item Workflow, repo binding, and
    credential binding;
  - can later create forks from productized checkpoints;
  - can later choose the active fork;
  - cannot run global scavenge or release arbitrary worker leases.
- **Developer**
  - can view Plan Item diagnostics for assigned work, explicitly shared
    workflows, or projects where the actor has developer membership;
  - can continue or respond within the current active session when authorized by
    the Plan Item Workflow;
  - can request Operator recovery;
  - cannot select active forks or run recovery directly unless explicitly
    granted later.
- **Operator/Admin**
  - can view the global session health dashboard only within the operator's
    organization, project, or explicitly assigned support scope;
  - can run recover/scavenge operations only for sessions in that scope;
  - can mark unrecoverable runtime conditions only for sessions in that scope;
  - can view safe capsule, worker, lease, queued action, and lineage metadata in
    that scope;
  - cannot use recovery actions to silently continue Codex execution.

This split is intentional. Fork/select-fork is a product and technical
direction decision. Recover/scavenge is an operational safety decision.

All API implementations must derive actor identity and resource scope from
authenticated server context. Request bodies may carry a reason, idempotency
key, or `candidate_predicate`; they must not be trusted as the source of actor
identity or authorization.

## Fork Semantics For Wave 8

The complete Wave 8 design supports explicit forks, but the first
Recovery/Ops slice only prepares the health/read-model foundation.

Fork rules:

- A fork can only be created from a productized checkpoint, not from an
  arbitrary raw Codex turn.
- Supported fork points include approved Brainstorming boundary, committed Spec
  document, committed Implementation Plan document, and the latest successful
  execution or review checkpoint.
- A fork creates a child `CodexSession` with lineage to parent session, parent
  turn, fork point capsule, fork point digest, actor, reason, and creation time.
- The child does not replace the active session until a Tech Lead explicitly
  chooses it.
- Choosing an active fork records a decision event.
- The previously active session becomes `inactive_retained`.
- `inactive_retained` sessions remain visible and auditable, but cannot continue
  execution by default.
- Continuing an inactive session requires an explicit later "resume as fork" or
  equivalent action.
- Forks are never automatically merged.

The first implementation slice must not expose half-complete public fork
routes. It may add safe metadata fields or projection hooks only when they are
needed for health, diagnostics, or future compatibility with this fork model.

## Health Projection

The health projection is a product read model. It should be named around
session operations, for example `PlanItemSessionHealth`,
`SessionHealthProjection`, or a local equivalent that fits the codebase.

At minimum it is keyed by:

- `workflow_id`;
- `development_plan_item_id`;
- `active_codex_session_id`.

It projects:

- product health state;
- severity;
- blocking reason code;
- public-safe reason summary;
- latest checked time;
- latest capsule id and digest prefix or full internal digest where only
  server-side code sees it;
- latest checkpoint or pinned capsule reference where present;
- active worker lease id, status, worker id, heartbeat, expiry, and lease age;
- pending queued action id, kind, status, idempotency key, and update time;
- latest Codex turn id;
- current runtime job id, status, worker id, launch lease id, expiry, and update
  time where present;
- current run session id, status, remote runtime job id, remote run worker lease
  id, and update time where present;
- current `CodexSession` runner ownership fields where present;
- checkpoint pin source and capsule retention pin summary;
- recovery availability and allowed recovery operation labels;
- whether Operator intervention is required;
- whether any retention risk exists;
- whether any lineage risk exists.

The health projection must not expose:

- raw Codex thread ids;
- raw capsule archive contents;
- raw `~/.codex` filesystem paths;
- connector/app credentials;
- secret values;
- complete restored runtime manifests unless explicitly redacted.

### Health States

Use product-level states rather than raw worker states:

```text
healthy
attention_needed
blocked_stale_lease
blocked_orphaned_action
blocked_missing_capsule
blocked_lineage_conflict
recovered
unrecoverable
```

`healthy`

- Active session, workflow, lease, queued action, latest turn, and latest capsule
  are consistent.

`attention_needed`

- A non-blocking inconsistency exists. Examples include capsule sync lag,
  missing optional diagnostic metadata, or stale projection timestamp.
- Users can continue through normal workflow actions if every required
  invariant is still valid.

`blocked_stale_lease`

- A worker lease is expired or has lost heartbeat and prevents the queued or
  running action from completing.

`blocked_orphaned_action`

- A queued action, turn, runtime job, or run attempt no longer has a valid
  owner/worker/session binding.

`blocked_missing_capsule`

- A required capsule, checkpoint, or artifact ref is missing, inaccessible, or
  digest-inconsistent.

`blocked_lineage_conflict`

- The active session, fork lineage, checkpoint pin, latest turn, or capsule
  reference graph is inconsistent.

`recovered`

- A recover/scavenge action repaired control/state consistency. The product must
  now wait for a human to explicitly continue, fork, archive, or mark the next
  workflow action.

`unrecoverable`

- The system can prove the state cannot be safely repaired without human
  intervention outside the product action path, for example a required active
  capsule is missing and no pinned checkpoint can satisfy the resume contract.

## Recovery Semantics

Recovery is control-only.

Allowed recovery effects:

- release or fence stale leases;
- terminalize orphaned queued actions, turns, runtime jobs, or run attempts with
  explicit stale/orphan reason codes;
- mark a missing capsule or lineage conflict as unrecoverable when the invariant
  cannot be repaired;
- publish a safe recovery recommendation that points at the latest valid
  productized checkpoint when one exists;
- refresh the health projection;
- write audit events for every change.

Checkpoint recovery is advisory in the first Recovery/Ops slice. Recovery may
record that a specific checkpoint is the latest safe resume/fork/archive
candidate, but it must not mutate `PlanItemWorkflow.active_*_revision_id`,
`execution_package_id`, document revision pointers, or other product evidence
fields. Any future operation that changes those fields must go through an
explicit `PlanItemWorkflowTransition` or `WorkflowManualDecision` with evidence
object type, evidence object id, evidence digest, transition id, actor, and
reason. This prevents a recovery action from becoming a hidden workflow jump.

Forbidden recovery effects:

- invoke Codex;
- create a new Codex session;
- fork automatically;
- choose an active fork automatically;
- advance the Plan Item Workflow to another product stage;
- silently retry execution;
- delete capsules;
- mutate raw capsule archives;
- replace a missing capsule with a guessed or worker-local copy.

Recovery must be idempotent. Re-running the same recovery operation against the
same stale condition must not duplicate terminalization, release a new active
lease, or rewrite already recovered state with a contradictory reason.

Recovery must be fenced. A stale recovery candidate captured at time T must be
revalidated immediately before execution. If a fresh lease, queued action,
turn, runtime job, run session, runner owner, workflow revision pointer, or
capsule has appeared, the recovery operation must stop or recompute rather than
acting on stale assumptions.

### Recovery Candidate Predicate

Every recover/scavenge execute request must carry a `candidate_predicate`
captured from the health projection. The predicate is not a secret token; it is
a compact optimistic-concurrency contract that makes the operation safe to retry
and safe to reject when state changed.

Suggested shape:

```ts
type ObservedRef<T> =
  | { checked: true; state: 'absent' }
  | ({ checked: true; state: 'present' } & T);

type SessionRecoveryCandidatePredicate = {
  codex_session_id: string;
  workflow_id: string;
  expected_health_state: PlanItemSessionHealthState;
  operation_idempotency_key: string;
  projection_digest: string;
  workflow: {
    id: string;
    status: PlanItemWorkflowStatus;
    updated_at: string;
    active_codex_session_id: string;
    active_boundary_summary_revision_id: string | null;
    active_spec_doc_revision_id: string | null;
    active_implementation_plan_doc_revision_id: string | null;
    execution_package_id: string | null;
  };
  session: {
    id: string;
    status: string;
    role: string;
    updated_at: string;
    active_lease_id: string | null;
    lease_epoch: number;
    runner_worker_id: string | null;
    runner_launch_lease_id: string | null;
    runner_runtime_job_id: string | null;
    runner_expires_at: string | null;
    latest_turn_id: string | null;
    latest_capsule_id: string | null;
    latest_capsule_digest: string | null;
  };
  active_lease: ObservedRef<{
    id: string;
    status: string;
    lease_epoch: number;
    worker_id: string;
    worker_session_digest: string;
    heartbeat_at: string | null;
    expires_at: string;
    updated_at: string;
  }>;
  pending_queued_action: ObservedRef<{
    id: string;
    kind: string;
    status: string;
    idempotency_key: string;
    codex_session_turn_id: string | null;
    expected_input_capsule_digest: string | null;
    updated_at: string;
  }>;
  latest_turn: ObservedRef<{
    id: string;
    status: string;
    lease_id: string | null;
    lease_epoch: number | null;
    runtime_job_id: string | null;
    expected_input_capsule_digest: string | null;
    input_capsule_digest: string | null;
    output_capsule_digest: string | null;
    updated_at: string;
  }>;
  runtime_job: ObservedRef<{
    id: string;
    status: string;
    terminal_status: string | null;
    worker_id: string;
    launch_lease_id: string;
    accepted_worker_session_digest: string | null;
    expires_at: string;
    updated_at: string;
  }>;
  run_session: ObservedRef<{
    id: string;
    status: string;
    codex_session_id: string | null;
    codex_session_turn_id: string | null;
    remote_runtime_job_id: string | null;
    remote_run_worker_lease_id: string | null;
    updated_at: string;
  }>;
  latest_capsule: ObservedRef<{
    id: string;
    digest: string;
    sequence: number;
    created_from_turn_id: string;
    created_at: string;
  }>;
  observed_at: string;
};
```

Before applying recovery, the service must reload the workflow, session, lease,
queued action, turn, runtime job, run attempt, and capsule records referenced by
the predicate. `ObservedRef` values use `state: 'absent'` to mean the projection
checked and found no record; missing fields are not allowed to mean "not
checked." If any expected id, epoch, digest, status, update timestamp, expiry,
idempotency key, worker session digest, runner ownership field, or active
workflow revision pointer no longer matches, the candidate is skipped with a
stale-candidate result.

`operation_idempotency_key` is stable for the exact recovery request. Repeating
the same key with the same `candidate_predicate` returns the original recovery
record. Repeating the same key with a different predicate, reason, operation, or
target session is an idempotency conflict and must fail closed without changing
state.

## Scavenge Semantics

Scavenge is the batch form of recovery candidate detection.

The API and CLI/runbook should support:

- dry-run candidate listing;
- filtered scan by project, Plan Item, workflow, health state, lease age,
  worker id, or severity;
- execute mode for candidates that still match their stale/orphan predicates;
- safe result reporting with per-candidate applied/skipped/blocked status.

Dry-run must never mutate state.

Execute mode must behave as a sequence of individually fenced recover
operations. Partial success is allowed, but every applied, skipped, or blocked
candidate must be reported and audited where state changed.

## Operator Dashboard

The global Operator Session Health Dashboard is for Operator/Admin users.

It should show:

- blocked sessions grouped by severity and reason;
- stale leases with heartbeat and expiry age;
- orphaned queued actions and runtime jobs;
- missing capsule or digest conflict diagnostics;
- lineage conflicts;
- recovered sessions waiting for human product action;
- retention-risk indicators for active/fork/checkpoint capsules;
- recent recovery/scavenge audit events.

It should allow:

- open Plan Item diagnostics;
- recover control for one session;
- run scavenge dry-run;
- execute selected scavenge candidates when authorized;
- mark unrecoverable with reason;
- view safe audit trail.

It must not allow:

- continue Codex execution from the operator dashboard;
- create or choose active fork in the first implementation slice;
- browse raw capsule archive contents;
- reveal secrets, local paths, raw thread ids, or credential material.

## Plan Item Diagnostics

Plan Item diagnostics are local to one Plan Item Workflow. They are intended for
Tech Lead and Developer workflows, not global operations.

They should show:

- active session health state and summary;
- latest product checkpoint;
- latest capsule/checkpoint continuity summary;
- pending queued action or recovered action state;
- whether normal continue/respond/request-fix actions are available;
- whether Operator recovery is needed;
- a future placeholder for explicit fork from checkpoint when Wave 8 fork slice
  is implemented.

Plan Item diagnostics can link to the Operator dashboard only when the viewer is
authorized. Non-operator users should see a request-recovery action or a clear
"Operator intervention required" state instead.

`GET /plan-items/:planItemId/session-diagnostics` must resolve the active
`PlanItemWorkflow` for that Plan Item deterministically. If the Plan Item has no
active workflow, diagnostics return a no-active-workflow state. If multiple
non-archived workflows exist, diagnostics must fail closed with a lineage
conflict or require the caller to use an explicit workflow-scoped route. It must
not pick an arbitrary workflow.

## Retention Safety

Wave 8 uses two retention classes:

- **Pinned product state**: active session capsules, fork points, approved
  Brainstorming boundaries, committed Spec docs, committed Implementation Plan
  docs, execution/review checkpoints, audit-referenced capsules, and
  unrecoverable evidence.
- **Unpinned raw process state**: intermediate runtime capsules that no product
  checkpoint, fork point, active session, recovery record, or audit event
  references.

The first implementation slice only builds the read-model and safety metadata
needed to identify pinned state. It does not delete capsules.

Retention safety is modeled per capsule, not as a single session-level boolean.
The health projection may summarize retention risk, but the operator projection
must expose each relevant capsule pin:

```ts
type CapsuleRetentionPin = {
  capsule_id: string;
  capsule_digest: string;
  pin_state: 'pinned' | 'not_cleanable' | 'unpinned_candidate' | 'unknown';
  pin_reasons: Array<
    | 'active_session_latest'
    | 'fork_point'
    | 'brainstorming_boundary'
    | 'spec_doc'
    | 'implementation_plan_doc'
    | 'execution_checkpoint'
    | 'review_checkpoint'
    | 'workflow_transition'
    | 'recovery_record'
    | 'object_event'
    | 'unrecoverable_evidence'
  >;
  referenced_by: Array<{
    object_type: string;
    object_id: string;
    relation: string;
  }>;
};
```

`retention_risk` in a health row is only a summary flag. It is true when any
capsule needed by the active session, fork lineage, checkpoint, recovery record,
or audit trail is missing a pin, has an unknown pin state, or is incorrectly
classified as an `unpinned_candidate`.

Later cleanup workers must prove that a capsule is not referenced by any active
session, fork lineage, product checkpoint, workflow transition, recovery record,
or audit event before it can be compressed or deleted.

Pure time-window cleanup is not acceptable for active AI-native sessions.

## API Shape

Use product-level session operations naming. Do not expose worker/runtime
internals as public route names.

Suggested routes:

```text
GET  /session-operations/health
GET  /session-operations/:sessionId/audit
POST /session-operations/:sessionId/recover
POST /session-operations/scavenge
GET  /plan-items/:planItemId/session-diagnostics
```

`GET /session-operations/health`

- Operator/Admin only.
- Supports filters for health state, severity, project, Plan Item, workflow,
  lease age, worker id, and recovered/unrecoverable state.
- Returns safe projections only.

`GET /session-operations/:sessionId/audit`

- Operator/Admin only unless a narrower Plan Item audit view already authorizes
  the caller.
- Returns recovery/scavenge/future fork-select audit events with safe payloads.

`POST /session-operations/:sessionId/recover`

- Operator/Admin only.
- Actor id is derived from authenticated server context.
- Requires reason, operation idempotency key, and `candidate_predicate`.
- Revalidates candidate predicates before changing state.
- Returns before/after health projection and audit id.

`POST /session-operations/scavenge`

- Operator/Admin only.
- Defaults to dry-run.
- Execute mode requires explicit confirmation and candidate predicates.
- Returns per-candidate result.
- CLI/runbook scavenge support belongs to the first slice as an operator wrapper
  around the same API semantics. It must not bypass authorization, predicate
  fencing, idempotency, or audit behavior.

`GET /plan-items/:planItemId/session-diagnostics`

- Authorized Plan Item viewers.
- Returns local diagnostics for the Plan Item Workflow without exposing global
  operator controls.
- Resolves exactly one active Plan Item Workflow or fails closed as described in
  Plan Item Diagnostics.

Names may be adapted to existing Nest modules and web command conventions, but
the route semantics must remain product-level session operations.

## Data Model Additions

The first slice should prefer durable domain records over UI-only computed
state, while avoiding premature persistence of redundant fields.

Suggested model:

```ts
type PlanItemSessionHealthState =
  | 'healthy'
  | 'attention_needed'
  | 'blocked_stale_lease'
  | 'blocked_orphaned_action'
  | 'blocked_missing_capsule'
  | 'blocked_lineage_conflict'
  | 'recovered'
  | 'unrecoverable';

type PlanItemSessionHealth = {
  id: string;
  project_id: string;
  organization_id?: string;
  workflow_id: string;
  development_plan_item_id: string;
  codex_session_id: string;
  state: PlanItemSessionHealthState;
  severity: 'none' | 'info' | 'warning' | 'blocked' | 'critical';
  reason_code?: string;
  summary: string;
  latest_capsule_id?: string;
  latest_capsule_digest?: string;
  capsule_retention_pins: CapsuleRetentionPin[];
  latest_checkpoint_object_type?: string;
  latest_checkpoint_object_id?: string;
  latest_checkpoint_digest?: string;
  latest_checkpoint_pin_source?: string;
  active_lease_id?: string;
  active_lease_status?: string;
  active_lease_worker_id?: string;
  active_lease_worker_session_digest?: string;
  active_lease_heartbeat_at?: string;
  active_lease_expires_at?: string;
  pending_queued_action_id?: string;
  pending_queued_action_kind?: string;
  pending_queued_action_status?: string;
  pending_queued_action_idempotency_key?: string;
  pending_queued_action_updated_at?: string;
  latest_codex_turn_id?: string;
  latest_codex_turn_status?: string;
  latest_codex_turn_updated_at?: string;
  runtime_job_id?: string;
  runtime_job_status?: string;
  runtime_job_terminal_status?: string;
  runtime_job_worker_id?: string;
  runtime_job_launch_lease_id?: string;
  runtime_job_expires_at?: string;
  runtime_job_updated_at?: string;
  run_session_id?: string;
  run_session_status?: string;
  run_session_remote_runtime_job_id?: string;
  run_session_remote_worker_lease_id?: string;
  run_session_updated_at?: string;
  session_runner_worker_id?: string;
  session_runner_launch_lease_id?: string;
  session_runner_runtime_job_id?: string;
  session_runner_expires_at?: string;
  recovery_available: boolean;
  recovery_operation_labels: string[];
  operator_intervention_required: boolean;
  retention_risk: boolean;
  lineage_risk: boolean;
  candidate_predicate?: SessionRecoveryCandidatePredicate;
  projection_digest: string;
  checked_at: string;
  updated_at: string;
};

type SessionRecoveryRecord = {
  id: string;
  operation_idempotency_key: string;
  codex_session_id: string;
  workflow_id: string;
  development_plan_item_id: string;
  operation: 'recover' | 'scavenge' | 'mark_unrecoverable';
  actor_id: string;
  reason: string;
  before_state: PlanItemSessionHealthState;
  after_state: PlanItemSessionHealthState;
  before_projection_digest: string;
  after_projection_digest: string;
  affected_lease_ids: string[];
  affected_queued_action_ids: string[];
  affected_turn_ids: string[];
  affected_runtime_job_ids: string[];
  affected_run_session_ids: string[];
  affected_capsule_ids: string[];
  candidate_predicate: SessionRecoveryCandidatePredicate;
  result: 'applied' | 'skipped' | 'blocked';
  result_code: string;
  object_event_id?: string;
  created_at: string;
};
```

Equivalent names are acceptable if they match existing repository conventions.
The important part is that recovery is a first-class audited product operation,
not a hidden side effect of a dashboard refresh.

The public Plan Item diagnostics DTO, Operator dashboard DTO, and internal
recovery predicate DTO must be separate:

- Public Plan Item diagnostics redacts worker session digests, idempotency keys,
  runtime job internals, full capsule digests, and candidate predicates.
- Operator dashboard projection includes safe operational metadata needed for
  diagnosis and candidate creation.
- Internal recovery predicate includes full fencing fields and is accepted only
  by recover/scavenge execute routes.

## Audit Events

Every recover/scavenge operation that changes state must write an `ObjectEvent`.

`SessionRecoveryRecord` is written for applied, skipped, and blocked attempts.
`object_event_id` is required for `result = 'applied'` because product state
changed. It may be omitted for skipped or blocked stale-candidate attempts when
no state changed, unless the implementation chooses to audit no-op attempts as
events. In either case, API responses must make the no-op reason explicit.

Full `candidate_predicate` payloads are internal recovery-record material.
`ObjectEvent` payloads must include only a public-safe/redacted predicate
summary, such as projection digest, operation idempotency key, expected health
state, affected object ids, and result code. They must not copy worker session
digests, raw thread ids, local paths, or other internal predicate details into
public evidence.

Required audit payload:

- actor id;
- operation idempotency key;
- operation;
- reason;
- before health state;
- after health state;
- before projection digest;
- after projection digest;
- affected session id;
- affected workflow id;
- affected lease/action/turn/runtime-job/run-session/capsule ids;
- candidate predicate used for fencing;
- result code;
- timestamp.

Audit payloads must be public-safe. They may include capsule ids, digest
prefixes or server-internal digests where existing contracts allow them, object
ids, and lineage relation labels. They must not include raw capsule contents,
secret values, raw local paths, credential material, or raw Codex thread ids.

## No-Baggage Constraints

ForgeLoop is not launched yet. Architecture quality is more important than
backwards compatibility.

Wave 8 must not:

- reintroduce retired subsystem naming;
- add compatibility aliases for retired execution package starts;
- expose legacy public execution routes that can resume, retry, fork, or rerun
  outside Plan Item Workflow semantics;
- build a second execution runner;
- treat generic Work Item Owner as the workflow authority;
- infer Brainstorming/Spec/Plan states by scraping arbitrary Codex messages;
- create hidden sessions to mask continuity failures.

All operations must respect the Plan Item Workflow as the product owner of the
active Codex session.

## Error Handling

Recover/scavenge should fail closed for:

- missing active workflow;
- multiple non-archived workflows for a Plan Item diagnostics request unless the
  route is workflow-scoped;
- missing active session;
- archived workflow or archived session;
- unauthorized actor;
- stale `candidate_predicate` or expected state mismatch;
- active fresh lease that supersedes the stale candidate;
- mismatched worker session digest, queued action idempotency key, run session
  status, runtime job status, or updated timestamp;
- capsule digest mismatch;
- missing required capsule;
- lineage conflict that cannot be repaired from productized checkpoints;
- unsupported fork or retention operation in the first slice.

Errors returned to product UI should use safe reason codes and short summaries.
Detailed operator diagnostics must still avoid raw secrets and raw capsule
contents.

## Testing Strategy

Implementation must include focused tests for:

- health projection for healthy sessions;
- health projection for stale leases;
- health projection for orphaned queued actions;
- health projection for missing capsules;
- health projection for lineage conflicts;
- redaction of raw thread ids, raw paths, secrets, and capsule contents from
  public projections;
- recovery idempotency for repeated stale lease recovery;
- recovery fencing when a fresh lease appears after candidate capture;
- recovery fencing when an optional predicate field would otherwise hide the
  difference between observed-absent and not-checked;
- recovery fencing for changed workflow active revision fields;
- recovery fencing for changed queued action idempotency, turn status, runtime
  job status, run session status, runner ownership, and worker session digest;
- orphan action terminalization with audit event;
- orphan runtime-job and run-session recovery audit;
- scavenge dry-run without mutations;
- scavenge execute with per-candidate applied/skipped/blocked results;
- skipped/blocked recovery records with explicit no-op audit behavior;
- retention pin projection for active session, fork point, checkpoint, recovery
  record, and ObjectEvent-referenced capsules;
- Operator authorization for recover/scavenge/dashboard scoped by organization,
  project, or assigned support scope;
- Tech Lead and Developer access to Plan Item diagnostics without global
  recovery powers;
- actor identity derived from authenticated context rather than request body;
- Plan Item diagnostics fail closed when no active workflow or multiple active
  workflows would make workflow selection ambiguous;
- recovered state does not enable continue/fork/archive without a separate
  human product action;
- API route tests for every session operations and Plan Item diagnostics route;
- browser or component-level UI verification for Operator dashboard and Plan Item
  diagnostics, including at least one blocked state and one recovered state;
- no-baggage guards for retired legacy runtime entrypoints.

Broader gates should include the existing domain/contracts/API/web/build checks
used by prior Plan Item Workflow waves.

## Acceptance Criteria

Wave 8 Recovery/Ops Foundation is accepted when:

1. Operators can see blocked/stale/orphaned Codex sessions without opening raw
   Codex runtime files.
2. A stale worker lease can be recovered safely and idempotently.
3. An orphaned queued action can be terminalized with a clear product-safe
   reason.
4. Scavenge dry-run reports candidates without mutation.
5. Scavenge execute revalidates candidates before applying changes.
6. Plan Item diagnostics show whether the active session is healthy, blocked,
   recovered, or needs Operator intervention.
7. Recovery never invokes Codex, creates sessions, forks, advances workflow
   status, or retries execution automatically.
8. Recovery and scavenge actions are auditable through recovery records; applied
   state changes also have `ObjectEvent` evidence, while skipped or blocked
   no-op attempts expose explicit no-op result codes.
9. Capsule/checkpoint diagnostics do not expose raw capsule contents, raw
   `~/.codex` paths, secrets, or raw thread ids.
10. Retention projection marks each active/fork/checkpoint/recovery/audit
    referenced capsule with a `CapsuleRetentionPin`; no cleanup deletes capsules
    in this slice.
11. A recovered session cannot continue, fork, archive, or change product stage
    until a separate authorized human product action is submitted.
12. No retired subsystem name or execution-package public route can bypass Plan
    Item Workflow or Session Operations semantics.

## Later Wave 8 Slices

After Recovery/Ops Foundation, Wave 8 can continue with:

1. **Fork Productization**
   - explicit fork creation from product checkpoints;
   - active fork selection;
   - inactive retained session handling;
   - fork audit and Plan Item UI.
2. **Retention Enforcement**
   - capsule reference graph;
   - checkpoint pinning;
   - compression/deletion policy for unpinned raw process state;
   - operator retention diagnostics.
3. **Operations Polish**
   - dashboard filtering and bulk actions;
   - runbook hardening;
   - richer operator audit views;
   - integration with incident and release workflows if needed.

Each slice must keep the same no-baggage and AI-native constraints: Codex can
freely progress inside a real session, but product state changes happen only
through explicit Plan Item Workflow or Session Operations actions.
