# Codex Automation Closed Loop Foundation Design

## Status

Proposed design for implementation planning after spec review. This spec captures the approved direction: automatic Codex draft generation is allowed, Spec and Plan approval remain human-gated, and Package execution may be auto-enqueued only behind an explicit dogfood-only gate.

## Context

ForgeLoop has a PRD-first automation foundation on `main`:

- `apps/automation-daemon` can fetch a runtime snapshot, plan `NextAction`s, create or replay durable `automation_action_runs`, claim one action, and execute that action through signed internal control-plane HTTP commands.
- `packages/automation` owns the current pure planner and HTTP executor for `ensure_plan_draft`, `ensure_package_drafts`, `request_manual_path`, and `project_runtime_snapshot`.
- `apps/control-plane-api` owns the authoritative command boundary and persists product state. The daemon must not write delivery state directly.
- `packages/run-worker` and `packages/executor` own real `local_codex` source mutation. Workflow activities explicitly reject production `local_codex` execution outside the run-worker runtime safety boundary.
- `run_enqueue` is currently disabled in the daemon planner. Ready packages are projected as `run_enqueue_disabled_by_scope`.

The current automation loop proves the sidecar shape, but it is still mostly deterministic. It does not generate Specs from WorkItems, does not use Codex to draft Plans or Packages, and does not close the dogfood loop by automatically starting a Codex implementation run.

The next useful shared work is therefore not a broad production `run_enqueue` launch. It is a shared Codex automation substrate that supports:

1. Codex-generated Spec drafts from WorkItems.
2. Codex-generated Plan drafts from approved Specs.
3. Codex-generated ExecutionPackage drafts from approved Plans.
4. Dogfood-only automatic Package run enqueue that hands execution to `run-worker`.

## Decision Summary

Build a narrow Codex automation closed-loop foundation with three boundaries:

- **Generation boundary:** The daemon may invoke Codex to produce structured draft payloads for Spec, Plan, and Package generation actions. Generation tasks may read bounded context and write artifacts, but they do not mutate product state directly and do not mutate source code.
- **Command boundary:** The control plane remains the only product-state writer. It receives generated structured payloads through signed internal automation commands, validates claimed actions and preconditions, then persists revisions/packages.
- **Execution boundary:** Source-changing Codex work is only started by enqueueing a RunSession and is only executed by `run-worker`. The daemon must not run Codex against a source checkout for implementation work.

The first implementation should preserve human approval gates:

- WorkItem with no Spec draft -> daemon can create a Codex-generated Spec draft.
- Human approves Spec.
- Approved Spec with no Plan draft -> daemon can create a Codex-generated Plan draft.
- Human approves Plan.
- Approved Plan with no package draft -> daemon can create Codex-generated ExecutionPackage drafts.
- Ready Package -> daemon may enqueue a RunSession only when an explicit dogfood autorun gate is enabled and runtime safety preflight passes.
- Review remains human-gated after the RunSession completes.

## Goals

- Add a real shared Codex task substrate instead of scattering Codex invocation logic across daemon, control plane, and run-worker.
- Add `ensure_spec_draft` as a first-class automation action.
- Replace production deterministic draft content with Codex-generated structured draft payloads for Spec, Plan, and Package generation.
- Keep deterministic or fake generation available only as a test/dogfood fixture where explicitly selected.
- Preserve command idempotency, action idempotency, claim tokens, stale precondition handling, manual path holds, and automation capability checks.
- Add a dogfood-only `enqueue_package_run` action that calls the existing authoritative enqueue command and wakes `run-worker`.
- Keep automatic Spec approval and Plan approval out of scope.
- Keep production autonomous run enqueue out of scope.

## Implementation Plan Boundaries

This spec defines the full closed-loop foundation, but implementation must be planned as three separate plans. Do not write one monolithic implementation plan for the whole document.

### Plan 1: Spec Draft Foundation

First shippable slice:

- add `canGenerateSpecDraft`;
- add `work_items_requiring_spec` / `workItemsRequiringSpec` runtime snapshot projection;
- add `ensure_spec_draft` action type, idempotency, DTOs, planner, and executor support;
- add the `spec-draft` generation-context endpoint;
- add the internal `ensure-spec-draft` command;
- support a local minimal fake generation path for deterministic tests. The shared Codex runtime package lands in Plan 2.

This plan proves WorkItem -> generated Spec draft without changing Plan, Package, or run enqueue behavior.

### Plan 2: Codex Generation Runtime and Generated Plan/Package Payloads

Second shippable slice:

- add `packages/codex-runtime`;
- add schema validators and fake/Codex generation drivers;
- add generated Plan draft payload support;
- add generated Package draft set payload support;
- add package manifest canonicalization, package-key mapping, generation package records, and dependency row persistence;
- add plan/package generation-context endpoints.

This plan proves approved Spec -> generated Plan draft -> approved Plan -> generated Package drafts. It still does not enqueue runs.

### Plan 3: Dogfood Autorun Bridge

Third shippable slice:

- add canonical enqueue-preflight attestation production;
- add `enqueue_package_run` action type, idempotency, planner, executor, and endpoint wrapper;
- keep autorun default-off and dogfood-only;
- require a Package to be ready before planner emits `enqueue_package_run`;
- hand actual source-changing work to `run-worker`.

This plan proves Package ready -> queued RunSession -> run-worker execution -> ReviewPacket. It must not start until Plans 1 and 2 are stable.

## Non-Goals

- No automatic approval of Spec, Plan, ExecutionPackage, ReviewPacket, Release, or merge decisions.
- No daemon-side source mutation.
- No direct DB writes by the daemon.
- No public operator UI in this scope.
- No broad tracker integration or Symphony-style tracker-first workflow.
- No resurrection of historical service names or action names whose only value is compatibility. New names should describe the current ForgeLoop domain.
- No production default-on `run_enqueue`.
- No changes to `apps/web` in this scope, because separate worktrees are actively changing web product surfaces.

## Naming

Use names that describe the current delivery model:

- New automation action for package execution: `enqueue_package_run`.
- Existing automation preset/capability can continue to use `run_enqueue` / `canEnqueueRuns` because those are already part of the product settings model.
- Do not introduce historical subsystem names or compatibility aliases for old service boundaries.

## Architecture

### Shared Codex Task Runtime

Add a shared Codex task runtime used by the automation daemon for generation tasks and reusable by future workers. It should be a small library surface, not a product-state service.

Package shape:

- `packages/codex-runtime`
- It may reuse low-level Codex driver pieces from `packages/executor` when those pieces are source-mutation agnostic.
- It must not import control-plane Nest modules, DB repositories, or delivery command services.

Core concepts:

- `CodexTaskKind`
  - `spec_draft`
  - `plan_draft`
  - `package_drafts`
- `CodexTaskInput`
  - action identity
  - public-safe WorkItem, Spec, Plan, repo, and package-policy context
  - prompt version
  - required output schema version
  - artifact root
  - runtime limits
- `CodexTaskResult`
  - structured JSON payload matching the task output schema
  - internal artifact refs for prompt, raw output, normalized output, and validation diagnostics
  - public-safe summary
  - retryability classification

Generation tasks have an artifact-only write policy:

- Codex may write prompt/output artifacts under the configured artifact root.
- Codex must not be given a mutable source checkout for generation.
- If repo context is needed, the daemon supplies a bounded context bundle instead of giving Codex unrestricted filesystem access.
- Any generated content is applied only by a later internal control-plane command.

Execution tasks remain outside this generation runtime:

- Package implementation uses `RunSession` + `run-worker`.
- `run-worker` may continue using app-server and exec-fallback drivers through its existing runtime safety boundary.
- The shared runtime may share prompt/schema helpers with run-worker later, but v1 must not move implementation execution into the daemon.

### Codex Generation Drivers

The runtime should support a driver interface rather than hard-coding one Codex invocation:

```ts
interface CodexTaskDriver {
  readonly kind: 'app_server' | 'exec_fallback' | 'fake';
  runTask(input: CodexTaskInput): Promise<CodexTaskResult>;
}
```

Driver rules:

- `app_server` is the preferred local driver when available.
- `exec_fallback` is allowed only when explicitly enabled by policy/config and must be governed with the same structured-command and artifact limits used elsewhere.
- `fake` is allowed in unit tests and deterministic smoke tests only.
- Generation driver output must be parsed and validated before any command endpoint is called.
- Invalid JSON, schema mismatch, missing required fields, unsafe path proposals, or empty content marks the automation action failed or blocked according to retryability.

### Output Schemas

Codex output must be schema-first. The daemon sends only normalized, validated payloads to the control plane.

`GeneratedSpecDraft` maps to `CreateSpecRevisionDto` fields. The top-level `schema_version` value for v1 is `spec_draft.v1`. The daemon validates the wrapper and strips `schema_version` before passing fields into strict control-plane DTO mapping.

- `summary`
- `content`
- `background`
- `goals`
- `scope_in`
- `scope_out`
- `acceptance_criteria`
- `risk_notes`
- `test_strategy_summary`
- `structured_document`

`GeneratedPlanDraft` maps to `CreatePlanRevisionDto` fields. The top-level `schema_version` value for v1 is `plan_draft.v1`. The daemon validates the wrapper and strips `schema_version` before passing fields into strict control-plane DTO mapping.

- `summary`
- `content`
- `implementation_summary`
- `split_strategy`
- `dependency_order`
- `test_matrix`
- `risk_mitigations`
- `rollback_notes`
- `structured_document`

`GeneratedPackageDraftSet` maps to one or more ExecutionPackage drafts. The top-level `schema_version` value for v1 is `package_drafts.v1`.

- `schema_version`
- `packages`
  - `package_key`
  - `sequence`
  - `objective`
  - `repo_id`
  - `required_checks`
  - `required_artifact_kinds`
  - `allowed_paths`
  - `forbidden_paths`
  - `source_mutation_policy`
  - `validation_strategy`
  - `required_test_gates`
  - `public_summary`
  - `structured_manifest`
- `dependencies`
  - `package_key`
  - `depends_on_package_key`
  - `dependency_type`
  - `reason`

Ownership fields are not generated in v1. The control plane derives `owner_actor_id`, `reviewer_actor_id`, and `qa_owner_actor_id` from the WorkItem owner when persisting generated packages. A future spec can introduce assignment policy, but Codex output must not choose reviewers or QA owners in this scope.

Package draft validation must reject:

- no packages;
- duplicate package keys;
- repo ids outside the WorkItem project;
- absolute paths;
- path traversal;
- empty allowed path policy for source-changing packages;
- forbidden paths that conflict with allowed paths in a way that makes the package impossible to execute;
- required checks without command, timeout, or blocking semantics;
- package count or keys that do not match the normalized manifest;
- dependency references to unknown package keys;
- dependency cycles according to `validatePackageDependencyGraph`.

The control plane, not Codex, computes the canonical `manifest_digest` from the normalized package set. It creates one `ExecutionPackageGenerationRun` with `expected_package_count` and sorted `expected_package_keys`, persists one `ExecutionPackageGenerationPackageRecord` per package, maps `package_key` to the persisted package id, and persists `ExecutionPackageDependency` rows for every dependency edge after package ids are known. Dependency edges that block automatic execution use `dependency_type: 'blocks_run_enqueue'`.

Canonical manifest digest:

- normalize generated package set by removing undefined values and fields not persisted in v1;
- sort object keys recursively;
- sort packages by ascending `sequence`, then `package_key`;
- require `sequence` to be unique, zero-based, and contiguous after normalization;
- sort dependencies by `package_key`, then `depends_on_package_key`, then `dependency_type`;
- compute `manifest_digest = "sha256:" + sha256(JSON.stringify(normalized_manifest))`;
- set `expected_package_count = normalized_manifest.packages.length`;
- set `expected_package_keys = normalized_manifest.packages.map(package_key).sort()`.

Replay rule: for a completed generation run, the command replays the first persisted `execution_package_set_id`, package id list, expected package keys, and manifest digest. It must not accept a later Codex output with the same command idempotency key but a different normalized manifest.

## Schema Contracts

The implementation plan should convert these sketches into shared Zod schemas.
Validation ownership is explicit:

- `packages/codex-runtime` validates raw driver output into one of these generated payload schemas.
- `packages/automation` validates normalized generated payloads before calling internal command endpoints.
- `apps/control-plane-api` revalidates the command payload and generated payload before persisting state.

```ts
type AutomationGenerationArtifactRef = ArtifactRef;

interface GeneratedSpecDraftV1 {
  schema_version: 'spec_draft.v1';
  summary: string;
  content: string;
  background: string;
  goals: string[];
  scope_in: string[];
  scope_out: string[];
  acceptance_criteria: string[];
  risk_notes: string[];
  test_strategy_summary: string;
  structured_document?: Record<string, unknown>;
}

interface GeneratedPlanDraftV1 {
  schema_version: 'plan_draft.v1';
  summary: string;
  content: string;
  implementation_summary: string;
  split_strategy: string;
  dependency_order: string[];
  test_matrix: string[];
  risk_mitigations: string[];
  rollback_notes: string;
  structured_document?: Record<string, unknown>;
}

interface GeneratedPackageDraftV1 {
  package_key: string;
  sequence: number;
  objective: string;
  repo_id: string;
  required_checks: RequiredCheckSpec[];
  required_artifact_kinds: ArtifactKind[];
  allowed_paths: string[];
  forbidden_paths: string[];
  source_mutation_policy: SourceMutationPolicy;
  validation_strategy?: string;
  required_test_gates: string[];
  public_summary: string;
  structured_manifest?: Record<string, unknown>;
}

interface GeneratedPackageDependencyV1 {
  package_key: string;
  depends_on_package_key: string;
  dependency_type: 'blocks_run_enqueue' | 'blocks_release' | string;
  reason?: string;
}

interface GeneratedPackageDraftSetV1 {
  schema_version: 'package_drafts.v1';
  packages: GeneratedPackageDraftV1[];
  dependencies: GeneratedPackageDependencyV1[];
}

interface GenerationCommandPayload<TGenerated> {
  action_run_id: string;
  claim_token?: string;
  idempotency_key: string;
  automation_precondition: AutomationPrecondition;
  generated: TGenerated;
  generation_artifacts: AutomationGenerationArtifactRef[];
}

interface AutomationGenerationRepoContextV1 {
  project_id: string;
  repo_id: string;
  default_branch: string;
  policy_status: 'missing' | 'loaded' | 'parse_failed' | 'unsafe_path';
  policy_digest?: string;
  parser_version?: string;
  package_manager?: string;
  workspace_summary?: string;
}

interface AutomationGenerationWorkItemContextV1 {
  context_version: 'generation_context.work_item.v1';
  action_run_id: string;
  work_item: {
    id: string;
    project_id: string;
    title: string;
    goal: string;
    success_criteria: string[];
    risk?: string;
    priority?: string;
    kind?: string;
  };
  repos: AutomationGenerationRepoContextV1[];
}

interface AutomationGenerationPlanContextV1 {
  context_version: 'generation_context.plan.v1';
  action_run_id: string;
  work_item: AutomationGenerationWorkItemContextV1['work_item'];
  spec: {
    id: string;
    approved_revision_id: string;
  };
  spec_revision: {
    id: string;
    summary: string;
    content: string;
    background: string;
    goals: string[];
    scope_in: string[];
    scope_out: string[];
    acceptance_criteria: string[];
    risk_notes: string[];
    test_strategy_summary: string;
  };
  repos: AutomationGenerationRepoContextV1[];
}

interface AutomationGenerationPackageContextV1 {
  context_version: 'generation_context.package.v1';
  action_run_id: string;
  generation_key: string;
  work_item: AutomationGenerationWorkItemContextV1['work_item'];
  spec_revision: AutomationGenerationPlanContextV1['spec_revision'];
  plan_revision: {
    id: string;
    summary: string;
    content: string;
    implementation_summary: string;
    split_strategy: string;
    dependency_order: string[];
    test_matrix: string[];
    risk_mitigations: string[];
    rollback_notes: string;
  };
  repos: AutomationGenerationRepoContextV1[];
}
```

The wire field names remain task-specific (`generated_spec_draft`, `generated_plan_draft`, `generated_package_drafts`) for strict DTO clarity. `GenerationCommandPayload<TGenerated>` is only a planning shorthand.

### Runtime Snapshot and Planner

Extend the runtime snapshot with a Spec generation target:

```ts
workItemsRequiringSpec: RuntimeSnapshotTarget[]
```

The internal TypeScript model uses camel case. The HTTP DTO uses `work_items_requiring_spec` to match the existing runtime snapshot naming style.

A WorkItem requires a Spec draft when:

- the WorkItem is not terminal for automation;
- the WorkItem has no current Spec, or its current Spec has no current revision;
- no active manual path hold blocks the WorkItem or Spec;
- automation settings allow `canGenerateSpecDraft` for the resolved project/repo scope;
- no pending/running/succeeded `ensure_spec_draft` action already suppresses the target.

Add capability:

```ts
canGenerateSpecDraft: boolean
```

Preset behavior:

- `off`: all capabilities false.
- `ready_projection`: runtime projection only.
- `draft_only`: can project runtime state and generate Spec, Plan, and Package drafts.
- `run_enqueue`: same as `draft_only` plus `canEnqueueRuns`.

Existing persisted automation capability JSON must normalize missing `canGenerateSpecDraft` to `false` before applying preset-derived updates. Code that resolves presets should always materialize all capability booleans so older rows cannot accidentally inherit Spec draft generation.

Planner action order:

1. `ensure_spec_draft`
2. `ensure_plan_draft`
3. `ensure_package_drafts`
4. `enqueue_package_run` only when dogfood autorun is explicitly enabled in daemon configuration and target settings have `canEnqueueRuns`
5. `project_runtime_snapshot`

Ordering keeps upstream PRD artifacts ahead of downstream execution. It also makes daemon loops easier to reason about during dogfood: each run advances one product boundary at a time.

### Action Types

Add `ensure_spec_draft`:

- target object type: `work_item`
- target object id: WorkItem id
- target revision id: absent for a first draft; use current Spec id or a stable generation key only if planning later supports regenerating a draft
- required capability: `canGenerateSpecDraft`
- action input JSON:

```json
{
  "work_item_id": "work-item-id"
}
```

The command payload for `ensure_spec_draft` includes the generated draft:

```json
{
  "action_run_id": "action-run-id",
  "claim_token": "claim-token",
  "idempotency_key": "action-idempotency-key",
  "automation_precondition": { "...": "precondition" },
  "generated_spec_draft": { "...": "validated spec fields" },
  "generation_artifacts": [{ "...": "artifact ref" }]
}
```

Extend `ensure_plan_draft` command payload to include generated plan content:

```json
{
  "spec_revision_id": "spec-revision-id",
  "generated_plan_draft": { "...": "validated plan fields" },
  "generation_artifacts": [{ "...": "artifact ref" }]
}
```

Extend `ensure_package_drafts` command payload to include generated package draft set:

```json
{
  "generation_key": "default:plan-revision-id",
  "generated_package_drafts": { "...": "validated package set" },
  "generation_artifacts": [{ "...": "artifact ref" }]
}
```

Add `enqueue_package_run`:

- target object type: `execution_package`
- target object id: ExecutionPackage id
- target revision id: PlanRevision id
- target version: current `ExecutionPackage.version` from runtime snapshot projection
- required capability: `canEnqueueRuns`
- emitted only when dogfood autorun is enabled
- action input JSON:

```json
{
  "execution_package_id": "package-id",
  "expected_package_version": 3,
  "executor_type": "local_codex",
  "workflow_only": false
}
```

The action name is `enqueue_package_run`, not `run_enqueue`. The product setting remains `run_enqueue` because that setting already describes the automation level.
The runtime safety attestation is produced during action execution and sent to the enqueue command payload. It is not stored in action input JSON because it is execution-time evidence, not a stable planner identity.

### Wire Contract Summary

| Action | Target identity | Action input JSON | Command endpoint | Command payload addition | Result JSON |
| --- | --- | --- | --- | --- | --- |
| `ensure_spec_draft` | `work_item`, WorkItem id | `work_item_id` | `POST /internal/automation/work-items/:workItemId/ensure-spec-draft` | `generated_spec_draft`, `generation_artifacts` | `spec_id`, `spec_revision_id`, `status` |
| `ensure_plan_draft` | `work_item`, WorkItem id, approved SpecRevision id | `work_item_id`, `spec_revision_id` | `POST /internal/automation/work-items/:workItemId/ensure-plan-draft` | `generated_plan_draft`, `generation_artifacts` | `plan_id`, `plan_revision_id`, `status` |
| `ensure_package_drafts` | `plan_revision`, PlanRevision id, generation key | `plan_revision_id`, `generation_key` | `POST /internal/automation/plan-revisions/:planRevisionId/ensure-package-drafts` | `generated_package_drafts`, `generation_artifacts` | `execution_package_set_id`, `package_ids`, `status` |
| `enqueue_package_run` | `execution_package`, package id, package version | `execution_package_id`, `expected_package_version`, `executor_type`, `workflow_only` | `POST /internal/automation/execution-packages/:packageId/enqueue-run` | `runtime_safety_attestation` | `run_session_id`, `execution_package_id`, `status` |

### Control-Plane Commands

The control plane receives generated content but does not call Codex.

Add internal command:

```text
POST /internal/automation/work-items/:workItemId/ensure-spec-draft
```

It must:

- assert the active action claim;
- assert action type `ensure_spec_draft`;
- normalize and fingerprint the automation precondition;
- verify `canGenerateSpecDraft`;
- create a Spec if the WorkItem has no current Spec;
- reject if the WorkItem already has a current Spec revision;
- persist the generated SpecRevision;
- set the Spec current revision;
- leave Spec status at draft;
- record public-safe object events and trace artifacts for generation artifacts.

Update internal command:

```text
POST /internal/automation/work-items/:workItemId/ensure-plan-draft
```

It must:

- keep existing action claim and approved Spec checks;
- require a validated `generated_plan_draft` payload for automation-daemon actions;
- create a Plan if needed;
- persist a PlanRevision based on the approved SpecRevision;
- leave Plan status at draft;
- preserve idempotent replay behavior.

Update internal command:

```text
POST /internal/automation/plan-revisions/:planRevisionId/ensure-package-drafts
```

It must:

- keep generation run locking and default-generation-key rules;
- require a validated `generated_package_drafts` payload for automation-daemon actions;
- persist one or more ExecutionPackage drafts;
- compute or validate package policy snapshots through existing package policy helpers;
- persist generation package records;
- leave generated packages in draft; package readiness is a separate explicit product transition;
- preserve idempotent replay behavior.

Add internal command:

```text
POST /internal/automation/execution-packages/:packageId/enqueue-run
```

It should wrap the existing `enqueueRunIfPackageStillReady` command boundary.

It must:

- assert active action claim;
- assert action type `enqueue_package_run`;
- assert `canEnqueueRuns`;
- assert expected package version;
- assert package readiness, active holds, open review packets, active runs, release gates, and dependency blockers;
- validate runtime safety attestation;
- create a queued RunSession and wake `run-worker`;
- return the accepted RunSession id.

### Package Readiness Gate

Generated ExecutionPackages remain draft unless existing product validation already marks them ready through an explicit command. This spec does not add automatic package approval or automatic package-ready transition.

Dogfood autorun therefore has an explicit gate:

- planner emits `enqueue_package_run` only for packages already projected as ready;
- generated draft packages require a human or existing product command to mark them ready before autorun;
- deterministic dogfood scripts may include that explicit package-ready step, but the step must be recorded as a separate product transition and must not be hidden inside Codex generation;
- if no ready package exists, dogfood autorun is a no-op and reports `package_not_ready`.

This preserves the approved boundary: Codex can draft artifacts automatically, but execution starts only after package readiness is established.

### Daemon Executor Flow

For generation actions:

1. Claim action through the existing action run API.
2. Load the current public-safe target context from explicit signed internal generation-context endpoints.
3. Build a versioned Codex task prompt.
4. Run the shared Codex task runtime with artifact-only write policy.
5. Validate and normalize the result.
6. Call the matching internal command with the generated payload and artifact refs.
7. Complete the action run with public-safe result JSON.

For `enqueue_package_run`:

1. Claim action.
2. Produce or load enqueue preflight runtime safety attestation.
3. Call internal enqueue command.
4. Complete, gate-pend, block, or fail the action based on control-plane response.

The daemon must not directly invoke `run-worker` APIs except through the control-plane enqueue command's existing wake-up path.

### Human Gates

This spec intentionally keeps human approval as the transition authority:

- Generated Spec draft does not submit or approve itself.
- Generated Plan draft does not submit or approve itself.
- Generated Package drafts do not approve review decisions.
- Run completion creates or updates ReviewPacket through existing workflow finalization.
- Human review remains required after implementation.

Dogfood automation may enqueue a ready Package, but it must not approve review results or merge changes.

### Dogfood Autorun Gate

Add daemon configuration for local dogfood:

```text
FORGELOOP_CODEX_AUTOMATION_GENERATION=disabled|fake|codex
FORGELOOP_CODEX_AUTOMATION_DOGFOOD_AUTORUN=0|1
FORGELOOP_CODEX_AUTOMATION_DOGFOOD_EXECUTOR=local_codex|mock
```

Rules:

- Default generation mode is `disabled` in production-like config until explicitly enabled.
- Tests can use `fake`.
- Local dogfood can use `codex`.
- Autorun default is `0`.
- `local_codex` autorun requires an enforcing `enqueue_preflight` runtime safety attestation. If unavailable, the action must block with a public-safe runtime safety reason instead of bypassing safety.
- `mock` autorun is allowed only for deterministic smoke tests with `executor_type: 'mock'`, `workflow_only: true`, and `environment: 'test' | 'local_dogfood'`. It must be reported as not satisfying strict local Codex acceptance.

This preserves a fast deterministic dogfood path and a strict real Codex path without confusing one for the other.

### Enqueue Preflight Attestation Producer

Plan 3 must add a canonical producer for enqueue preflight attestations before enabling `enqueue_package_run`.

Add a helper in the runtime safety layer, for example:

```ts
interface EnqueuePreflightAttestationInput {
  executionPackageId: string;
  expectedPackageVersion: number;
  projectId: string;
  repoId: string;
  executorType: ExecutorType;
  workflowOnly: boolean;
  policySnapshot?: PackageRuntimePolicySnapshot;
  policySnapshotVersion?: number;
  environment: RuntimeSafetyEnvironment;
  maxAgeMs: number;
}

interface RuntimeSafetyPreflightProvider {
  createEnqueuePreflightAttestation(input: EnqueuePreflightAttestationInput): Promise<RuntimeSafetyAttestation>;
}
```

The returned attestation must have `attestation_scope: 'enqueue_preflight'` and must be validated by the existing domain enqueue validator. It is distinct from `run_execution` attestations, which remain reserved for run-worker/executor execution.

The daemon must call this canonical producer or a test fake implementing the same interface. It must not hand-build enqueue attestations inline. For `executor_type: 'local_codex'`, the producer must return `hard_limit_mode: 'enforcing'` or the daemon blocks the action with a public-safe runtime safety reason. For deterministic mock dogfood, the producer may return a `test_only_mock` attestation only when `executor_type: 'mock'`, `workflow_only: true`, and `environment: 'test' | 'local_dogfood'`; the dogfood report must state that strict local Codex acceptance was not satisfied.

### Prompting

Prompts must be versioned and task-specific.

Spec prompt inputs:

- WorkItem title, goal, success criteria, risk, priority, project context, repo summary, and relevant runtime policy digest status.
- Instruction to produce a bounded PRD-first spec, not a plan and not implementation code.

Plan prompt inputs:

- WorkItem summary.
- Approved SpecRevision fields.
- Repo summary.
- Explicit instruction to produce implementation steps and package split strategy without changing approval state.

Package prompt inputs:

- WorkItem summary.
- Approved SpecRevision.
- Approved PlanRevision.
- Repo summary.
- Existing runtime policy projection.
- Explicit path-policy and required-check constraints.

Every prompt must include:

- required JSON schema name and version;
- instruction to output only JSON for machine parsing;
- forbidden behavior: no approvals, no merge, no push, no release, no direct source edits;
- public-safe content constraint for generated summaries.

### Context Loading

Codex generation should not receive raw internal rows or unbounded local filesystem access.

Context must be loaded through signed internal read endpoints. Do not enrich the runtime snapshot with full prompt context in this scope; the snapshot remains a planning projection. Add these endpoints:

- `GET /internal/automation/generation-context/work-items/:workItemId/spec-draft`
- `GET /internal/automation/generation-context/work-items/:workItemId/plan-draft?spec_revision_id=...`
- `GET /internal/automation/generation-context/plan-revisions/:planRevisionId/package-drafts?generation_key=...`

Each endpoint must assert the trusted automation actor signature and require `action_run_id` plus `claim_token` query parameters. The endpoint verifies the claimed action is still active and matches the requested target before returning context. It then loads the current authoritative objects and returns a public-safe context object or a stale/gated error. The daemon calls the context endpoint after claiming an action and before invoking Codex. The control-plane command still revalidates preconditions when applying generated output, so context loading is an optimization for prompt construction, not the final authority boundary.

The endpoints use explicit serializers:

- `AutomationGenerationWorkItemContextV1`
- `AutomationGenerationPlanContextV1`
- `AutomationGenerationPackageContextV1`
- `AutomationGenerationRepoContextV1`

The serializers should redact:

- local absolute paths unless needed for internal artifacts;
- HMAC headers and secrets;
- raw action claim tokens;
- raw runtime metadata;
- internal-only logs;
- private artifact contents.

Repo context for v1 can be small:

- repo id;
- default branch;
- package manager and top-level workspace metadata when already available;
- runtime policy digest status;
- a bounded file list or repo summary only if safely available.

### Error Handling

Generation errors map to action outcomes:

- Codex runtime unavailable: `failed`, retryable.
- Invalid output JSON: `failed`, retryable for transient driver issues; non-retryable when the normalized validation error proves the prompt/schema contract is wrong.
- Unsafe package path proposal: `blocked`, non-retryable, public reason `generated_package_policy_invalid`.
- Stale command precondition: `gate_pending`, retryable, using existing stale precondition handling.
- Active manual hold or open review gate: `blocked`, non-retryable until human action changes state.
- Runtime hard limits unavailable for dogfood `local_codex` autorun: `blocked`, non-retryable for that action attempt.

No error response may expose raw prompts, raw Codex logs, local absolute paths, secrets, or unredacted command payloads.

### Idempotency

Action idempotency keys must include:

- action type;
- target object type/id;
- target revision id or generation key when present;
- target version when relevant;
- automation scope;
- automation settings version;
- capability fingerprint;
- precondition fingerprint;
- prompt version;
- output schema version;
- generation mode (`fake` or `codex`) for generation actions;
- package generation key for package actions.

Command idempotency remains authoritative inside the control plane. If Codex generates different content for a replayed action idempotency key, the command boundary must replay the first completed command result instead of overwriting product state.

### Runtime Safety

There are two different safety classes:

- **Generation safety:** artifact-only, no source mutation, bounded context, bounded output, no product writes except through commands.
- **Execution safety:** source mutation via RunSession, run-worker, path policy, runtime safety attestation, required checks, artifact capture, and review finalization.

The daemon may perform generation safety work. It must not perform execution safety work.

The dogfood enqueue command requires existing enqueue preflight attestation. For `local_codex`, hard limits must be enforcing according to the domain validator. If the environment cannot produce that attestation, the daemon reports a blocker rather than silently downgrading to unsafe execution.

### Observability

Each generation action should produce:

- action run lifecycle events;
- public-safe result JSON with generated object ids;
- internal artifact refs for prompt, raw output, normalized output, and validation diagnostics;
- object events on generated SpecRevision, PlanRevision, or ExecutionPackage;
- trace links from generated objects to generation artifacts where the trace plane supports it.

Public projections should show:

- current action status;
- generated draft ids;
- reason code for blocked/gated actions;
- whether strict local Codex autorun was enabled or skipped.

They should not show:

- raw prompts;
- raw Codex logs;
- local paths;
- secrets;
- claim tokens.

## Data Flow

### Spec Draft

1. Runtime snapshot projects WorkItem as `work_items_requiring_spec`.
2. Planner emits `ensure_spec_draft`.
3. Daemon claims action.
4. Daemon fetches signed generation context from `/internal/automation/generation-context/work-items/:id/spec-draft`.
5. Daemon runs Codex `spec_draft` task.
6. Daemon validates `GeneratedSpecDraft`.
7. Daemon calls `/internal/automation/work-items/:id/ensure-spec-draft`.
8. Control plane creates Spec if absent, writes SpecRevision, leaves Spec draft.
9. Action completes.
10. Human reviews and approves Spec through existing product command.

### Plan Draft

1. Runtime snapshot projects approved Spec as `work_items_requiring_plan`.
2. Planner emits `ensure_plan_draft`.
3. Daemon claims action.
4. Daemon fetches signed generation context from `/internal/automation/generation-context/work-items/:id/plan-draft`.
5. Daemon runs Codex `plan_draft` task with approved Spec context.
6. Daemon validates `GeneratedPlanDraft`.
7. Daemon calls existing plan draft command with generated payload.
8. Control plane writes PlanRevision, leaves Plan draft.
9. Action completes.
10. Human reviews and approves Plan.

### Package Drafts

1. Runtime snapshot projects approved PlanRevision as `plan_revisions_requiring_packages`.
2. Planner emits `ensure_package_drafts`.
3. Daemon claims action.
4. Daemon fetches signed generation context from `/internal/automation/generation-context/plan-revisions/:id/package-drafts`.
5. Daemon runs Codex `package_drafts` task.
6. Daemon validates package manifest and path policy.
7. Daemon calls package draft command with generated package set.
8. Control plane writes ExecutionPackage drafts and package generation run records.
9. Action completes.
10. Package readiness follows existing package validation and gate rules.

### Dogfood Package Run

1. Runtime snapshot projects ready package in `run_enqueue_disabled_packages`.
2. If dogfood autorun is enabled, the package is ready, and settings allow `canEnqueueRuns`, planner emits `enqueue_package_run`.
3. Daemon claims action and collects enqueue preflight attestation.
4. Daemon calls internal enqueue command.
5. Control plane creates queued RunSession and wakes run-worker.
6. Run-worker executes `local_codex` through runtime safety boundary.
7. Workflow finalization records run evidence and ReviewPacket.
8. Human reviewer approves or requests changes.

## Testing

Unit tests:

- planner emits `ensure_spec_draft` for eligible WorkItems;
- planner suppresses `ensure_spec_draft` for terminal WorkItems, active holds, missing capability, and existing current SpecRevision;
- planner keeps Spec -> Plan -> Package -> dogfood enqueue ordering;
- planner does not emit `enqueue_package_run` unless dogfood autorun is enabled and `canEnqueueRuns` is present;
- idempotency keys include prompt and schema versions;
- output schema validators reject malformed Spec, Plan, and Package generated payloads.

Control-plane tests:

- internal `ensure-spec-draft` asserts active action claim;
- generated Spec draft command creates Spec when missing;
- generated Spec draft command replays idempotently;
- generation artifact refs are accepted by internal command DTOs but are not leaked through public action result projections;
- generated Plan draft command requires approved current SpecRevision;
- generated Package draft command persists generation run and package records;
- package draft command rejects unsafe paths and invalid required checks;
- internal enqueue command calls existing enqueue boundary and rejects stale package versions;
- local Codex enqueue rejects missing or non-enforcing runtime safety attestation.

Daemon tests:

- fake generation mode advances WorkItem -> Spec draft, approved Spec -> Plan draft, approved Plan -> Package draft;
- daemon marks invalid generated output as failed or blocked with public-safe reason;
- daemon never writes product state without calling internal control-plane commands;
- daemon never emits enqueue action when autorun gate is disabled;
- daemon emits and executes `enqueue_package_run` in deterministic mock autorun mode only when explicitly configured.

Dogfood smoke:

- deterministic fake-generation dogfood proves the full command path without real Codex;
- strict local Codex dogfood proves at least one WorkItem can reach queued/running/completed `local_codex` RunSession when runtime safety is enforcing;
- smoke summary reports whether strict local Codex acceptance was enabled, skipped, blocked, or passed.

Regression guard:

- existing `run_enqueue` disabled tests remain, updated to distinguish production default from explicit dogfood autorun.
- workflow activity tests continue proving production `local_codex` cannot bypass run-worker.

## Rollout

Recommended implementation slices:

1. Add domain, DTO, snapshot, planner, and idempotency support for `canGenerateSpecDraft` and `ensure_spec_draft`.
2. Add schema-first Codex task runtime with fake driver and validators.
3. Add internal `ensure-spec-draft` command and generated-payload support for plan/package commands.
4. Wire daemon generation actions to the shared runtime.
5. Add dogfood-only `enqueue_package_run` planner/executor path and internal endpoint wrapper.
6. Add deterministic dogfood and strict local Codex dogfood reporting.

Each slice should be independently testable. Slices 1-4 can ship without dogfood autorun. Slice 5 must keep autorun default-off.

## Acceptance Criteria

- A WorkItem with automation `draft_only` can receive a Codex-generated Spec draft through the daemon without direct control-plane DB writes.
- Human-approved Spec triggers a Codex-generated Plan draft through the daemon.
- Human-approved Plan triggers Codex-generated ExecutionPackage drafts through the daemon.
- Spec and Plan approval remain human-only product gates.
- Default daemon behavior still does not enqueue package runs.
- Explicit dogfood autorun can enqueue a ready package through a signed internal command when `canEnqueueRuns` and runtime safety preflight are valid.
- Real source-changing Codex work is executed only by `run-worker`.
- Tests prove daemon generation actions are idempotent, gated, and public-safe.
- Existing runtime safety tests and `run_enqueue` disabled tests continue to pass after being updated for the explicit dogfood gate.

## Residual Risks

- Codex output quality may be poor even when schema-valid. Human approval gates are the mitigation for Spec and Plan; ReviewPacket gates are the mitigation after execution.
- Strict local Codex dogfood depends on a machine that can provide enforcing runtime safety. The deterministic mock/fake path must not be represented as strict local Codex success.
- Prompt/schema churn can break idempotency expectations. Prompt version and schema version are included in action identity to make this explicit.
- Package path policy generation is the highest-risk generation output. Control-plane validation must treat Codex proposals as untrusted input.
