# Plan Item Execution Handoff Continuity Design

## Status

Approved design for spec review.

## Purpose

This spec defines Wave 6 of `2026-05-30-plan-item-codex-session-continuity-generation-loop-design.md`.

Wave 5 made the Plan Item workspace the user-facing Superpowers product loop through:

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

Wave 6 must close the next product gap: an approved Implementation Plan Doc and `execution_ready` workflow must start the first real execution turn without losing the Codex session.

The target path is:

```text
Execution Ready
  -> Start execution
  -> ExecutionPackage
  -> RunSession
  -> CodexSessionTurn(stage = execution)
  -> CodexRuntimeJob(target_kind = run_execution)
  -> WorkspaceBundle
  -> same Codex thread/session resumed by the worker
  -> code_review
```

The core requirement is continuity. The first execution turn must continue the same active `CodexSession` and the same stable `codex_thread_id_digest` that produced the approved Boundary Summary, Spec Doc, and Implementation Plan Doc. Wave 6 must not hide a new Codex session behind the product workflow.

## Authority

This spec extends:

- `docs/superpowers/specs/2026-05-30-plan-item-codex-session-continuity-generation-loop-design.md`;
- `docs/superpowers/specs/2026-05-31-codex-session-data-model-and-lease-design.md`;
- `docs/superpowers/specs/2026-06-01-app-server-resume-protocol-support-design.md`;
- `docs/superpowers/specs/2026-06-02-codex-runtime-capsule-packaging-restore-design.md`;
- `docs/superpowers/specs/2026-06-03-plan-item-workflow-product-loop-design.md`;
- `docs/PRD_v1.md`.

This spec is authoritative for the Wave 6 execution handoff slice.

It is not authoritative for Wave 7 execution continuation, review response, review comment handling, fix loops, PR creation, QA automation, fork selection, recovery UI, or operations dashboards.

## Scope

Wave 6 includes:

- workflow-scoped `Start execution` from `PlanItemWorkflow.status = execution_ready`;
- creation or reuse of the workflow-owned `ExecutionPackage`;
- creation of the first workflow-owned `RunSession`;
- creation of one `CodexSessionTurn` for execution;
- creation of one `CodexRuntimeJob` with `target_kind = run_execution`;
- workspace bundle creation from the approved Execution Package policy;
- worker-side restore of the latest Codex runtime capsule before execution;
- worker-side resume of the same Codex thread for the execution turn;
- terminalization that updates the runtime job, run session, execution turn, latest capsule, and workflow status;
- public-safe execution supervision data in the Plan Item workspace;
- deterministic fake dogfood for the handoff;
- credentialed real-runtime dogfood proving same-session generation to execution.

Wave 6 does not include:

- interruption continuation;
- code review response turns;
- fix-loop continuation;
- human review comment resolution;
- explicit fork selection;
- abandon/new-session recovery;
- PR creation or merge automation;
- automatic QA handoff;
- generic task extraction from Implementation Plan Doc checkbox content;
- new execution runner infrastructure parallel to the existing run-execution pipeline.

## Design Decision

Wave 6 must reuse the existing run-execution channel and make it workflow-owned.

Do not create a separate `PlanItemExecutionRunner` or a second runtime execution system. The existing `run_execution` worker path already owns workspace bundle acquisition, Docker app-server launch, Codex driver execution, patch collection, check result collection, runtime job terminalization, and failure artifacts. Wave 6 should extend that path with Plan Item Workflow lineage, Codex session capsule restore, lease fencing, and public-safe product projection.

The product entry point remains `PlanItemWorkflow`. `ExecutionPackage`, `RunSession`, `CodexRuntimeJob`, workspace bundles, and execution artifacts are mechanism records. They must not become product workflow sources of truth.

## Product Command

Wave 6 introduces a workflow-scoped command:

```text
POST /plan-item-workflows/:workflowId/execution/start
```

The command is the only public product route that starts Superpowers execution.

The command must:

1. require an authenticated product actor authorized for the Plan Item Workflow, Plan Item, repo binding, and execution credential binding;
2. reject cross-tenant, cross-workflow, cross-plan-item, cross-repo, and cross-credential start attempts;
3. require `PlanItemWorkflow.status = execution_ready`;
4. require one active `CodexSession`;
5. require the active session to be claimable and not already running;
6. require an approved current Spec Doc revision owned by the workflow;
7. require an approved current Implementation Plan Doc revision owned by the workflow;
8. require the current Plan Item revision to still match the approved document revisions;
9. require a ready `ExecutionReadinessRecord` owned by the workflow;
10. require or create a ready `ExecutionPackage` owned by the workflow;
11. require a latest safe Codex runtime capsule for the active session;
12. create a `CodexSessionTurn` with execution intent;
13. create a `RunSession` for the execution package;
14. create a `CodexRuntimeJob` with `target_kind = run_execution`;
15. create or attach the workspace bundle required by the runtime job;
16. write an immutable audit event before the job becomes claimable;
17. transition the workflow to `execution_running`;
18. return a public workflow projection with the execution run summary.

The command must not run Codex inside the HTTP request. It only creates durable execution work for a worker to claim.

The immutable start audit event must include `actor_id`, `workflow_id`, `plan_item_id`, `repo_binding_id`, credential binding identifier, `codex_session_id`, `codex_session_turn_id`, `run_session_id`, `runtime_job_id`, `workspace_bundle_digest`, `input_capsule_digest`, and `codex_thread_id_digest`. It must not include raw `codex_thread_id`, raw capsule refs, raw memory refs, raw environment refs, local filesystem paths, credential payloads, or auth materialization.

## Route Retirement And No Baggage

Any public route, command, DTO action, UI affordance, artifact shortcut, package shortcut, or document shortcut that can start run execution outside `POST /plan-item-workflows/:workflowId/execution/start` must be removed or changed to fail closed with `403` or `410`.

Do not keep public compatibility aliases, redirects, forwarding adapters, server-side shims, or migration wrappers from old start routes into the workflow start command. UI affordances may be rebuilt to call the workflow command, but old public command routes must not remain executable.

Allowed remaining surfaces:

- trusted worker endpoints that only claim already-created workflow-owned runtime jobs;
- read-only admin/operator diagnostics unless a future audited operations spec explicitly defines a mutation;
- tests that deliberately prove legacy routes are rejected;
- existing read-only execution projections.

Forbidden public product behavior:

- starting execution from a Source Document;
- starting execution from a Spec Doc;
- starting execution from an Implementation Plan Doc;
- starting execution directly from an Execution Package page;
- starting execution directly from a generic Work Item or old task route;
- creating a fresh Codex session for execution when a valid active workflow session exists;
- exposing raw thread ids, capsule refs, local paths, credential metadata, or app-server payloads in normal product DTOs.

## Data Model And Lineage

Starting execution must create or reuse one continuous lineage:

```text
PlanItemWorkflow
  -> active CodexSession
  -> approved Spec Doc revision
  -> approved Implementation Plan Doc revision
  -> ExecutionReadinessRecord
  -> ExecutionPackage
  -> RunSession
  -> CodexSessionTurn(stage = execution)
  -> CodexRuntimeJob(target_kind = run_execution)
  -> WorkspaceBundle
```

Required ownership fields:

- `ExecutionPackage.workflow_id = PlanItemWorkflow.id`;
- `ExecutionPackage.codex_session_id = active CodexSession.id`;
- `ExecutionPackage.codex_session_turn_id` remains immutable package-generation provenance. For packages derived from the approved Implementation Plan Doc, this is the turn that produced the approved Implementation Plan Doc revision used to derive the package, not the future execution turn;
- `RunSession.workflow_id = PlanItemWorkflow.id`;
- `RunSession.codex_session_id = active CodexSession.id`;
- `RunSession.codex_session_turn_id = execution CodexSessionTurn.id`;
- `CodexRuntimeJob.workflow_id = PlanItemWorkflow.id`;
- `CodexRuntimeJob.codex_session_id = active CodexSession.id`;
- `CodexRuntimeJob.codex_session_turn_id = execution CodexSessionTurn.id`;
- `CodexRuntimeJob.input_json.plan_item_workflow_id = PlanItemWorkflow.id`;
- `CodexRuntimeJob.input_json.codex_session_id = active CodexSession.id`;
- `CodexRuntimeJob.input_json.codex_session_turn_id = execution CodexSessionTurn.id`;
- `CodexRuntimeJob.input_json.execution_package_id = ExecutionPackage.id`;
- `CodexRuntimeJob.input_json.run_session_id = RunSession.id`.

Wave 6 must not overwrite or reinterpret package-generation provenance fields when starting execution. Execution-turn lineage belongs on `RunSession`, `CodexRuntimeJob.input_json`, `CodexSessionTurn`, and, if needed, a one-to-one execution lineage record such as `first_execution_turn_id`. Storing the linkage only in untyped runtime metadata is not enough for product correctness.

The first-class runtime job lineage columns and the trusted `CodexRuntimeJob.input_json` lineage fields must match exactly. Enqueue, claim, and terminalization must fail closed on any mismatch.

`ExecutionPackage.codex_session_turn_id` is immutable package-generation provenance. For Wave 6 packages derived from an approved Implementation Plan Doc, it must be the turn that produced the approved Implementation Plan Doc revision used to derive the package. If a later readiness or package derivation turn must be tracked, it needs a separate named field or lineage record. Reused packages must match the approved revision ids and provenance turn, or fail closed.

## Persistence And Migration Invariants

Wave 6-created workflow-owned rows must have non-null workflow, session, and turn lineage wherever the schema exposes those fields.

Implementation must either make the relevant columns non-null where legacy data permits, or add partial check constraints plus repository guards for workflow-owned rows. At minimum:

- workflow-owned `ExecutionPackage` rows must have non-null `workflow_id`, `codex_session_id`, and immutable package provenance `codex_session_turn_id`;
- workflow-owned `RunSession` rows must have non-null `workflow_id`, `codex_session_id`, and execution `codex_session_turn_id`;
- workflow-owned `CodexRuntimeJob` rows must have non-null first-class `workflow_id`, `codex_session_id`, and execution `codex_session_turn_id`;
- trusted runtime payload lineage must exactly match first-class persisted lineage.

Startup, backfill, or reuse validation must detect legacy rows missing required workflow/session lineage before they are reused by Wave 6. Reuse must fail closed on missing, nullable, or divergent lineage rather than silently repairing it during execution start.

## Execution Package Policy

The Execution Package used by Wave 6 must be derived from the approved Implementation Plan Doc revision and existing Execution Ready checks.

The package must include:

- objective;
- driver actor;
- reviewer actor;
- QA owner actor;
- required checks;
- allowed paths;
- forbidden paths;
- source mutation policy;
- required artifact kinds;
- repo binding;
- current Plan Item revision;
- current Spec Doc revision;
- current Implementation Plan Doc revision.

The workspace bundle manifest must be created from the same package policy. A runtime job whose workspace bundle manifest diverges from the package policy must fail closed.

For Plan Item execution packages, the execution driver is the Plan Item driver actor, stored and projected as `driver_actor_id`. Implementations must not expose, accept, or backfill `owner_actor_id` compatibility aliases for this role. Reviewer actor and QA owner actor remain separate package roles.

An existing ready `ExecutionPackage` may be reused only when all reuse predicates match:

- same workflow id;
- same active session id;
- same approved Spec Doc revision id;
- same approved Implementation Plan Doc revision id;
- same Plan Item revision id;
- same readiness record id;
- same package policy digest;
- same workspace manifest digest when the bundle already exists;
- same immutable package provenance turn;
- no mismatched active run, queued job, or terminalization gap exists for the workflow/session.

If any predicate differs, the command must create a new package when policy permits or fail closed. It must not reuse a stale ready package.

## Runtime Job Workload

The `run_execution` workload must include public-safe execution fields and trusted internal continuity fields.

Required workload fields:

```ts
type WorkflowExecutionRuntimeWorkload = {
  schema_version: 'codex_run_execution_workload.v1';
  plan_item_workflow_id: string;
  development_plan_id: string;
  development_plan_item_id: string;
  execution_package_id: string;
  execution_package_version: number;
  run_session_id: string;
  workspace_bundle_id: string;
  workspace_bundle_digest: string;
  workspace_acquisition_json: {
    manifest_digest: string;
    size_bytes: number;
  };
  codex_session_runtime_context: {
    schema_version: 'codex_session_runtime_context.v1';
    codex_session_id: string;
    codex_session_turn_id: string;
    lease_id: string;
    lease_epoch: number;
    worker_id: string;
    worker_session_digest: string;
    expected_input_capsule_digest: string;
    turn_group_status: 'complete';
    continuation: {
      kind: 'resume_thread';
      codex_thread_id: string;
      codex_thread_id_digest: string;
    };
  };
  codex_session_terminalization: {
    schema_version: 'codex_session_terminalization.v1';
    lease_token: string;
    codex_session_id: string;
    codex_session_turn_id: string;
    input_capsule_id: string;
    input_capsule_ref: string;
    input_capsule_digest: string;
    input_memory_bundle_ref: string;
    input_memory_bundle_digest: string;
    input_environment_manifest_ref: string;
    input_environment_manifest_digest: string;
    expected_input_capsule_digest: string;
  };
};
```

The exact contract may use existing names from `packages/contracts`, but it must extend the existing `CodexRunExecutionWorkloadV1`, `CodexSessionRuntimeContextV1`, and `CodexSessionTerminalizationV1` contracts rather than bypassing their validators. Wave 6 must update the canonical run-execution workload producer and validator so workflow-owned execution jobs cannot be enqueued as legacy fresh-thread `run_execution` jobs. In particular:

- `CodexRunExecutionWorkloadV1` itself must carry the continuity fields, or the runtime job workload envelope must carry them in a strictly validated companion object consumed by `requiredRunExecutionWorkload`;
- `codex_session_runtime_context.schema_version` must be `codex_session_runtime_context.v1`;
- `turn_group_status` must be `complete` for the Wave 6 terminal execution turn;
- `continuation.kind` must be `resume_thread`;
- lease and worker fencing fields must be present;
- `expected_input_capsule_digest` must equal the current `CodexSession.latest_capsule_digest`;
- `codex_session_runtime_context.expected_input_capsule_digest`, `codex_session_terminalization.expected_input_capsule_digest`, `codex_session_terminalization.input_capsule_digest`, and the resolved `CodexRuntimeCapsule.digest` must all equal the current `CodexSession.latest_capsule_digest`;
- `codex_session_terminalization.input_capsule_id` must resolve to that exact capsule digest;
- `input_memory_bundle_ref` and `input_memory_bundle_digest` must match the active session's latest memory continuation refs and digests;
- `input_environment_manifest_ref` and `input_environment_manifest_digest` must match the active session's latest environment continuation refs and digests;
- `workspace_acquisition_json.manifest_digest` is the trusted expected manifest digest for workspace bundle unpacking unless a stricter first-class field replaces it.

For workflow-owned execution jobs, missing or internally inconsistent `codex_session_runtime_context` and `codex_session_terminalization` are hard validation failures. The worker must not treat those jobs as ordinary legacy run-execution work.

The raw `codex_thread_id` is allowed only in trusted worker payloads. Normal product DTOs must expose at most digest-level continuity evidence.
`CodexRuntimeJob.input_json` and fetched workload payloads are trusted worker inputs, not product DTO sources. Public projections must be built from explicit public-safe serializers, never by returning runtime job input JSON.

Persisted workload fields containing raw `codex_thread_id`, raw capsule refs, raw memory refs, raw environment refs, lease tokens, auth materialization, credential metadata, or local filesystem paths must be worker-auth-only. They must be redacted from logs, generic job serializers, debug serializers, and default admin/operator diagnostics.

## Worker Execution Flow

The worker flow is:

1. claim the `run_execution` runtime job;
2. fetch workload and trusted launch materialization;
3. acquire the workspace bundle;
4. verify workspace bundle digest and manifest digest;
5. restore the input Codex runtime capsule into a fresh `CODEX_HOME`;
6. re-materialize config/auth from centralized runtime profile and credential binding;
7. repair thread locator state when required by the restored capsule;
8. start the Dockerized app-server;
9. resume the existing Codex thread;
10. execute the package prompt through the existing `run_execution` driver;
11. collect patch, changed files, check results, and execution artifacts;
12. package and upload the new Codex runtime capsule;
13. terminalize the runtime job;
14. terminalize the `RunSession`;
15. terminalize the `CodexSessionTurn`;
16. CAS update `CodexSession.latest_capsule_id` and `CodexSession.latest_capsule_digest`;
17. transition `PlanItemWorkflow.status` to `code_review` on success.

The `run_execution` path must reuse or mirror the generation capsule restore pipeline before app-server launch:

- parse `codex_session_terminalization` before starting Docker;
- require `capsuleManager` when an input capsule is present;
- call capsule restore into the fresh `CODEX_HOME`;
- write config/auth from launch materialization after restore, not from the capsule;
- validate the capsule archive, memory bundle, environment manifest, config/auth materialization, and locator repair manifest before starting Docker;
- run locator repair before app-server startup when the repair does not require a container-specific path;
- if the chosen locator repair strategy needs the container `CODEX_HOME` path, run only that bounded locator rewrite after app-server startup and before `driver.resumeRun`;
- proceed only after restore, config/auth materialization, and locator repair all succeed.

The existing run-execution launcher path must be changed as part of Wave 6. A launch path that calls Docker app-server startup with only workspace options and no capsule restore hook is not compliant for workflow-owned execution jobs.

The `run_execution` driver call must branch on trusted `codex_session_runtime_context.continuation`:

- for `resume_thread`, pass `runtimeMetadata.codex_thread_id` to the driver and invoke `driver.resumeRun`;
- reject any `thread/start`, `startRun`, exec-fallback, or replacement-thread behavior for a Wave 6 execution turn;
- verify the resumed thread id digest matches `continuation.codex_thread_id_digest`;
- fail closed on resume failure, digest mismatch, missing thread id, or driver fallback.

The existing run-execution control loop must be changed as part of Wave 6. A loop that always invokes `driver.startRun` is not compliant for workflow-owned execution jobs.

The worker must not fall back to `start_thread` when the resume path fails.

## Run Execution Terminal Result

Successful workflow-owned run execution must produce both execution result evidence and continuation evidence.

The run-execution terminal result contract must include, directly or through a strictly validated companion terminalization object:

- `output_capsule_id`;
- `output_capsule_ref`;
- `output_capsule_digest`;
- `output_capsule_manifest_digest`;
- `output_memory_bundle_ref`;
- `output_memory_bundle_digest`;
- `memory_delta_artifact_ref`;
- `memory_delta_digest`;
- `output_environment_manifest_ref`;
- `output_environment_manifest_digest`;
- the execution `codex_session_turn_id`;
- the same `codex_thread_id_digest`.

The control-plane terminalizer must use these fields to terminalize the execution `CodexSessionTurn` and CAS-update `CodexSession.latest_capsule_id` and `CodexSession.latest_capsule_digest`.

A successful run-execution result without output capsule evidence is invalid for workflow-owned execution jobs, even if patch/check collection succeeded.

## Terminalization Transaction

Successful terminalization must be one transaction guarded by all of these predicates:

- `CodexSession.id = codex_session_id`;
- `CodexSession.active_lease_id = lease_id`;
- `CodexSession.lease_epoch = lease_epoch`;
- `CodexSession.latest_capsule_digest = expected_input_capsule_digest`;
- `CodexSession.latest_capsule_id = input_capsule_id`;
- `CodexSessionTurn.id = codex_session_turn_id`;
- `CodexSessionTurn.status` is active for the claimed execution turn;
- `CodexSessionTurn.runtime_job_id = CodexRuntimeJob.id`;
- `RunSession.id = run_session_id`;
- `RunSession.status` is active;
- `RunSession.codex_session_turn_id = CodexSessionTurn.id`;
- `CodexRuntimeJob.id = runtime_job_id`;
- `CodexRuntimeJob.workflow_id`, `CodexRuntimeJob.codex_session_id`, and `CodexRuntimeJob.codex_session_turn_id` match the workflow/session/turn lineage;
- `PlanItemWorkflow.id = workflow_id`;
- `PlanItemWorkflow.status = execution_running`.

On success, the transaction must:

- write the execution turn output capsule fields;
- set `CodexSession.latest_capsule_id = output_capsule_id`;
- set `CodexSession.latest_capsule_digest = output_capsule_digest`;
- set the latest memory and environment continuation refs and digests;
- set the latest turn pointer if the data model has one;
- clear active lease/runner fields for the completed turn;
- terminalize the runtime job and run session;
- transition the workflow to `code_review`.

If any predicate fails, the terminalizer must record stale terminalization evidence only. It must not update the workflow, run session, execution turn, latest capsule fields, latest memory/environment refs, or latest turn pointer.

Failure and cancellation terminalization for workflow-owned execution jobs must also be one guarded transaction using the same identity, lease, input capsule, turn, run session, runtime job, and workflow predicates as successful terminalization.

Failure and cancellation terminalization must not update `CodexSession.latest_capsule_id`, `CodexSession.latest_capsule_digest`, latest memory refs, latest environment refs, or latest turn pointer. It may clear active lease or runner fields only when the guarded predicates match the claimed execution turn.

If any predicate fails, the failure or cancellation terminalizer must record stale failure/cancellation evidence only. It must not update workflow, run session, execution turn, runtime job terminal state, latest capsule fields, memory/environment refs, latest turn pointer, or lease fields.

## Terminal State Rules

Successful runtime execution:

- terminalizes the `CodexRuntimeJob` as succeeded;
- terminalizes the `RunSession` as succeeded;
- terminalizes the execution `CodexSessionTurn` as succeeded;
- writes the new Codex runtime capsule;
- records changed files, patch artifact, check results, and execution artifacts;
- transitions `PlanItemWorkflow.status` from `execution_running` to `code_review`.

Successful runtime execution with no code changes:

- still transitions to `code_review`;
- records a public-safe `no_changes` result;
- leaves acceptance to human review.

Required checks failed:

- still transitions to `code_review`;
- records failed checks in the run session and review surface;
- does not mark the runtime job failed only because product checks failed.

Runtime failure:

- terminalizes the runtime job as failed;
- terminalizes the run session as failed;
- terminalizes the execution turn as failed;
- transitions the workflow to `blocked`;
- records a public-safe blocker code.

Cancellation:

- terminalizes runtime records as cancelled;
- transitions the workflow to `blocked`;
- records `execution_cancelled`.

Stale terminalization:

- records a stale event;
- must not update the workflow status;
- must not update `RunSession`;
- must not update `CodexSession.latest_capsule_id` or `CodexSession.latest_capsule_digest`;
- must not overwrite a newer turn.

## Fail-Closed Conditions

Wave 6 must fail closed for:

- missing active Codex Session;
- active session already running;
- missing latest capsule;
- unsafe capsule;
- capsule digest mismatch;
- capsule thread digest mismatch;
- missing or invalid memory bundle;
- missing or invalid environment manifest;
- app-server resume failure;
- workspace bundle digest mismatch;
- workspace manifest mismatch against package policy;
- path policy violation;
- stale Plan Item revision;
- stale Spec Doc revision;
- stale Implementation Plan Doc revision;
- stale execution readiness record;
- stale lease;
- duplicate start execution request that does not match the existing active run lineage.

Fail closed means no replacement session, no replacement thread, no hidden retry with a new session, and no transition to `code_review`.

## Idempotency And Concurrency

`POST /plan-item-workflows/:workflowId/execution/start` must be idempotent under the same execution-ready inputs.

Duplicate requests should return the existing active execution if:

- the workflow is already `execution_running`;
- the existing run session belongs to the same workflow;
- the existing execution turn belongs to the same active session;
- the existing runtime job is queued, accepted, or running for the same package/version/capsule input.

If the runtime job is terminal and run/session/workflow terminalization is complete, duplicate requests should return the completed lineage projection. If the job is terminal but run/session/workflow terminalization is incomplete, the command must invoke idempotent terminalization when safe or return a recovery-required blocker. It must not treat the incomplete state as a normal active execution.

Duplicate requests must be rejected if:

- the workflow has moved back to document review;
- the active session changed;
- the latest capsule digest changed;
- the execution package version changed;
- another run session exists for a different package, revision, or session;
- the previous execution is terminal and the user is attempting a Wave 7 continuation or fix loop.

Only one active execution turn may run for one active `CodexSession`.

Implementation must enforce this with a transactional lock or partial unique invariant keyed by `codex_session_id` for active execution `RunSession` or `CodexSessionTurn` states, plus enqueue-time checks that no queued, accepted, or running `run_execution` runtime job exists for the same session. Duplicate starts may return only the exact same lineage; they must not create a second active execution turn.

## Product UI

The Plan Item workspace remains the primary surface.

When the workflow is `execution_ready`, the center conversation and right artifact rail should show:

- approved Boundary Summary;
- approved Spec Doc;
- approved Implementation Plan Doc;
- Execution Ready result;
- `Start execution` action;
- public-safe continuity status;
- expected reviewer and QA owner.

After `Start execution`, the workspace should show:

- workflow status `execution_running`;
- run session status;
- worker/runtime status;
- latest public-safe event;
- changed files summary when available;
- check results summary when available;
- patch/review evidence when available;
- no raw thread id, raw capsule ref, local path, or credential metadata.

On success, the workspace should move to the code review lens for the first execution result. Wave 7 may add response and fix-loop actions later.

## Security And Privacy

Normal product DTOs must not expose:

- raw Codex thread id;
- raw capsule ref;
- raw memory bundle ref;
- raw environment manifest ref;
- raw app-server payload;
- local filesystem paths;
- credential binding payload;
- auth JSON;
- connector tokens.

Trusted worker protocols may include raw internal refs and raw thread ids only when required to resume execution.

Public-safe projection may expose:

- continuity state;
- digest-level proof;
- capsule sequence;
- blocker codes;
- timestamps;
- run session id;
- execution package id;
- changed file names when allowed by policy;
- check results;
- artifact kinds.

Run session ids and execution package ids may be shown as read-only supervision references. They must not become public mutation roots for starting, retrying, continuing, or approving Superpowers execution outside `PlanItemWorkflow`.

## Testing Requirements

Wave 6 must add focused tests for:

- execution start requires actor authentication and workflow, plan item, repo binding, and credential binding authorization;
- execution start writes immutable audit evidence with digest-level continuity and no raw runtime refs;
- execution start rejects non-`execution_ready` workflows;
- execution start rejects workflows without active Codex Session;
- execution start rejects stale document or Plan Item revisions;
- execution start creates/reuses Execution Package, RunSession, CodexSessionTurn, CodexRuntimeJob, and workspace bundle under one workflow with first-class lineage matching trusted workload lineage;
- Execution Package reuse rejects stale approved revision ids, Plan Item revision, readiness record, package policy digest, workspace manifest digest, provenance turn, session id, and active-run lineage;
- workflow-owned rows cannot be created with nullable or divergent workflow/session/turn lineage;
- duplicate execution start returns the same active run;
- duplicate execution start rejects mismatched package/session/capsule inputs;
- concurrent duplicate execution starts cannot create two active execution turns for one active Codex Session;
- workflow-owned runtime jobs cannot be enqueued, claimed, or terminalized when first-class runtime job lineage differs from trusted payload lineage;
- run-execution worker restores the input capsule and resumes the same `codex_thread_id_digest`;
- run-execution workload validation rejects mismatched input capsule, memory bundle, environment manifest, lease, worker, or thread digest continuity fields before Docker startup;
- workflow-owned run execution uses `driver.resumeRun` and rejects `driver.startRun`, `thread/start`, exec fallback, and replacement-thread behavior;
- successful run-execution terminal result includes output capsule id/ref/digest/manifest digest, output memory bundle evidence, memory delta evidence, output environment manifest evidence, execution turn id, and matching thread digest;
- worker terminal success transitions workflow to `code_review`;
- required check failure still transitions to `code_review` with failed checks;
- runtime failure transitions workflow to `blocked`;
- unsafe capsule, missing capsule, digest mismatch, and resume failure block without replacement session;
- stale terminalization cannot mutate workflow, run session, or latest capsule fields;
- public DTOs do not leak raw thread ids, capsule refs, local paths, or credential metadata;
- public, admin, and generic runtime-job projections redact worker-only workload fields that contain raw thread ids, raw refs, lease tokens, auth materialization, credential metadata, or local paths;
- legacy public execution start shortcuts are rejected or test-only, including Source Document, Spec Doc, Implementation Plan Doc, ExecutionPackage `run`, ExecutionPackage `rerun`, ExecutionPackage `force-rerun`, generic Work Item, DevelopmentPlanItem, and old task execution-start routes;
- implementation does not introduce or depend on active `latest_snapshot_*`, `CodexSessionSnapshot`, or `codex_session_snapshot` names outside historical design references.

## Dogfood Requirements

Add a deterministic dogfood command for Wave 6, for example:

```text
pnpm dogfood:plan-item-execution-handoff
```

It must prove:

- a seeded Plan Item Workflow reaches `execution_ready`;
- `Start execution` creates the execution lineage;
- fake worker execution terminalizes the run;
- workflow reaches `code_review`;
- all objects share the same workflow id and active Codex session id;
- no replacement thread/session is created.

Add or extend a credentialed real-runtime dogfood command, for example:

```text
pnpm dogfood:plan-item-execution-handoff:real
```

It must prove:

- Boundary Summary, Spec Doc, Implementation Plan Doc, and execution use the same `codex_thread_id_digest`;
- the execution worker restores the latest capsule before running;
- a new capsule is produced after execution;
- the workspace bundle and path policy are enforced;
- no raw private runtime data is written to public reports.

If credentials are unavailable locally, the real command may skip for developer convenience, but a skipped run is not acceptance evidence.

## Acceptance Criteria

Wave 6 is accepted when:

- `POST /plan-item-workflows/:workflowId/execution/start` is the only public product execution start route;
- execution cannot start before approved Spec Doc, approved Implementation Plan Doc, current Plan Item revision, ready Execution Readiness Record, ready Execution Package, latest safe capsule, and active Codex Session all pass validation;
- execution cannot start unless the actor is authorized for the workflow, Plan Item, repo binding, and execution credential binding;
- starting execution creates or reuses exactly one Execution Package, RunSession, CodexSessionTurn, CodexRuntimeJob, and workspace bundle under the same workflow/session lineage;
- first-class persisted runtime job lineage, trusted workload lineage, run session lineage, and execution turn lineage match exactly;
- the run-execution worker restores the latest capsule and resumes the same `codex_thread_id_digest`;
- workflow-owned run execution uses `resumeRun` and never starts, falls back to, or replaces the Codex thread;
- successful terminalization atomically advances output capsule, memory, environment, turn, run, job, and workflow state behind lease/capsule/workflow predicates;
- successful execution transitions the workflow to `code_review`;
- failed checks are represented as review evidence, not as runtime infrastructure failure;
- runtime failure, cancellation, unsafe capsule, missing capsule, digest mismatch, resume failure, stale lease, and stale terminalization fail closed;
- no public DTO leaks raw thread ids, raw capsule refs, local paths, or credentials;
- no public legacy execution start route remains executable outside `POST /plan-item-workflows/:workflowId/execution/start`;
- no active implementation or public contract reintroduces `latest_snapshot_*`, `CodexSessionSnapshot`, or `codex_session_snapshot` terminology;
- deterministic dogfood passes;
- credentialed real-runtime dogfood passes in acceptance environment;
- `pnpm test`, `pnpm build`, `git diff --check`, no-baggage checks, and relevant runtime capsule tests pass.

## Later Waves

Wave 7 should add:

- execution continuation after interruption;
- code review response turns;
- fix-loop continuation;
- review comment handling;
- continuation-specific stale terminalization behavior;
- user-visible continue/fork/abandon choices.

Wave 8 should add:

- explicit fork selection;
- recovery and scavenge operations;
- retention policy;
- operator dashboards;
- administrative diagnostics for capsule and session lineage.
