# Codex Generation Runtime and Generated Plan/Package Drafts Design

Date: 2026-05-19

## Status

Draft for Plan 2 of the Codex automation closed-loop foundation.

Plan 1 shipped the first automation generation slice:

- `canGenerateSpecDraft`;
- `ensure_spec_draft`;
- signed Spec draft generation context;
- fake Spec draft generation in the automation daemon;
- deterministic WorkItem -> Spec draft tests.

This design covers the next shippable slice: a production-shaped Codex app-server runtime and generated Plan/Package draft payloads. It keeps the PRD-first workflow authoritative and does not copy a tracker-first or Symphony-style process.

## Current State

The current system has the right control-plane boundaries but still has placeholder generation for downstream artifacts:

- `packages/automation` owns the planner, action idempotency, HTTP executor, and Spec draft fake generation.
- `apps/automation-daemon` runs planner iterations, claims actions, and calls signed internal control-plane commands.
- `apps/control-plane-api` owns the authoritative command boundaries for `ensure_spec_draft`, `ensure_plan_draft`, and `ensure_package_drafts`.
- `ensure_spec_draft` already requires a generated payload from the daemon.
- `ensure_plan_draft` still lets the control plane synthesize a fixed PlanRevision.
- `ensure_package_drafts` still lets the control plane synthesize one hard-coded `api-package`.
- `packages/executor` already contains Codex app-server protocol pieces such as `CodexAppServerDriver`, `CodexAppServerTransport`, notification normalization, raw log storage, and runtime safety lease handling.
- `apps/control-plane-api` currently wires source-changing run-worker app-server execution to `AppServerGovernorUnavailableDriver`; the actual fallback path is `CodexExecFallbackDriver`.
- `CodexAppServerProcessTransport` exists for tests and local experiments, but production use is guarded against unsafe direct spawn.

The main gap is not only missing generated Plan/Package payload support. The system also needs one shared, production-shaped Codex app-server generation runtime so automation draft generation and later source-changing execution do not grow incompatible Codex integrations.

## Goals

- Add a shared `packages/codex-runtime` package for Codex app-server generation tasks.
- Use Codex app-server mode for real generation, not `codex exec` or one-shot CLI fallback.
- Provide deterministic fake generation for tests and local development.
- Add `GeneratedPlanDraftV1` and `GeneratedPackageDraftSetV1` schemas and validators.
- Add signed Plan draft and Package draft generation-context endpoints.
- Extend daemon-origin `ensure_plan_draft` to require `generated_plan_draft` and `generation_artifacts`.
- Extend daemon-origin `ensure_package_drafts` to require `generated_package_drafts` and `generation_artifacts`.
- Move Plan draft content production from the control plane to the daemon generation runtime.
- Move Package draft set production from control-plane hard-coded `api-package` generation to daemon generation runtime.
- Persist package generation runs, package generation package records, ExecutionPackage drafts, and dependency rows from generated payloads.
- Keep Spec, Plan, Package readiness, run enqueue, review, release, and merge decisions human-gated.
- Leave run enqueue and source-changing work out of this plan while making the app-server runtime contracts reusable by Plan 3 and run-worker hardening.

## Non-Goals

- No `enqueue_package_run` action in this plan.
- No automatic Package ready transition.
- No source mutation by the automation daemon.
- No automatic Spec submit/approval.
- No automatic Plan submit/approval.
- No automatic review approval, release, merge, or push.
- No `codex exec` driver.
- No CLI fallback.
- No production path using unsafe direct `CodexAppServerProcessTransport` spawn.
- No broad UI work in `apps/web`.
- No historical subsystem names or compatibility aliases whose only value is preserving old naming.

## Design Summary

Plan 2 introduces a shared generation runtime and changes Plan/Package drafting to be payload-driven:

1. The daemon claims an automation action.
2. The daemon fetches a signed, public-safe generation context from the control plane.
3. The daemon runs a task-specific Codex generation task through `packages/codex-runtime`.
4. The runtime returns raw artifacts plus a parsed generated payload.
5. The daemon validates the payload schema.
6. The daemon calls the matching internal command with the generated payload and artifact refs.
7. The control plane revalidates preconditions, canonicalizes the payload where needed, and persists drafts.
8. The daemon completes, blocks, gate-pends, or fails the action with a public-safe result.

The control plane remains the only writer of product state. Codex generation is an input to the command boundary, not a bypass around it.

## Package Boundaries

### `packages/codex-runtime`

`packages/codex-runtime` owns generation-specific Codex integration:

- task definitions;
- prompt builders;
- JSON output extraction;
- output validators;
- fake generation driver;
- app-server generation driver;
- task timeout and cancellation control;
- artifact references for prompts, raw notifications, parsed output, and validation reports;
- public-safe error classification.

It must depend only on stable shared packages such as `@forgeloop/contracts`, `@forgeloop/domain` where needed, and small extracted app-server protocol primitives. It must not depend on `apps/*`.

### `packages/executor`

`packages/executor` currently owns app-server execution primitives. Plan 2 must avoid two divergent protocol implementations by extracting reusable app-server protocol types and notification helpers into `packages/codex-runtime` or into a small shared module that both packages use.

Acceptable implementation choices:

- move `CodexAppServerTransport`, app-server text input helpers, terminal notification parsing, and JSON-RPC message shapes into `packages/codex-runtime`, then have `packages/executor` import or re-export them; or
- keep low-level protocol code in `packages/executor` only if `packages/codex-runtime` imports a narrow stable interface and does not duplicate protocol logic.

The plan must not create a second independent app-server JSON-RPC implementation.

The generation runtime must not call the existing source-changing `CodexAppServerDriver.startRun` path as-is. That execution driver is shaped around `RunSpec`, mutable workspaces, dangerous source-changing sandbox settings, and fallback-to-exec metadata. Plan 2 may reuse its protocol types, JSON-RPC transport, notification normalization, raw log store, and lease patterns, but generation needs its own session adapter with generation-specific safety and sandbox settings.

### `packages/automation`

`packages/automation` keeps planner, action types, idempotency, executor orchestration, and HTTP client code. It calls a generic generation driver interface supplied by the daemon. It must not own app-server protocol details.

The existing Spec draft fake generator can either move into `packages/codex-runtime` or be adapted through a compatibility wrapper during 2A. By the end of 2A, there must be one generation runtime entrypoint for Spec, Plan, and Package tasks, not task-specific generator files in `packages/automation`.

### `apps/automation-daemon`

The daemon wires config, HTTP client, policy loader, and generation runtime together. It owns no product-state persistence. It calls the same signed internal control-plane commands as today.

## Runtime Architecture

`packages/codex-runtime` has four layers.

### Task Layer

Task kinds:

```ts
type CodexGenerationTaskKind = 'spec_draft' | 'plan_draft' | 'package_drafts';
```

Each task defines:

- context schema version;
- prompt version;
- output schema version;
- prompt builder;
- output validator;
- output extraction policy;
- public-safe success summary;
- public-safe failure mapping.

The output contract is JSON-only. Prompts must instruct Codex to return a single JSON object with no Markdown wrapper and no prose outside the object. The runtime must still defensively parse fenced JSON or extra text only if the parser can do so unambiguously; ambiguous output is invalid.

The task layer must define exactly where generated JSON is read from. For app-server mode, this is not the terminal notification itself. The runtime must collect assistant message deltas/completions or the app-server's explicit turn output fields, assemble the final assistant text for the turn, and extract exactly one JSON object from that assembled text. If the app-server protocol later exposes a structured output field, the task layer can prefer that field, but the implementation must still test that the collector rejects:

- no assistant output;
- multiple candidate JSON objects;
- JSON plus contradictory prose;
- truncated output;
- terminal success with invalid task output.

### Session Layer

`CodexGenerationSession` manages one app-server thread/turn for one generation task:

- initialize transport;
- start or allocate thread;
- start turn with task prompt;
- consume notifications;
- detect terminal success/failure/cancelled status;
- collect raw internal artifacts;
- enforce turn timeout;
- cancel on daemon shutdown;
- close transport when owned by the session.

Generation sessions are not long-lived product execution sessions. They produce a payload and artifact refs, then end.

The session result includes:

- terminal status;
- assembled assistant output;
- extracted JSON candidate;
- raw notification artifact refs;
- prompt/context/output digests;
- public-safe runtime metadata.

The session result must not be treated as valid generation until the task-specific validator accepts the extracted JSON candidate.

### Driver Layer

Supported drivers:

- `fake`: deterministic task outputs for tests and local no-Codex development.
- `app_server`: real production-shaped generation through a governed Codex app-server transport.

Explicitly unsupported:

- `exec_fallback`;
- `codex exec`;
- shelling out per task to a one-shot CLI command;
- unsafe direct app-server process spawn as the production path.

If app-server is unavailable, generation must fail, block, or gate-pend according to the error mapping. It must not silently fall back to CLI.

### Safety and Artifact Layer

Generation runtime is artifact-only and write-denied by default:

- no source mutation permission;
- no repo worktree modifications;
- no run enqueue;
- no merge/push/release operations;
- no direct DB writes.

The runtime records internal artifacts:

- prompt text or prompt artifact;
- prompt digest;
- generation context digest;
- raw app-server notifications;
- parsed JSON output;
- normalized validation report;
- runtime metadata.

Public action results may include:

- task kind;
- prompt version;
- output schema version;
- public reason code;
- artifact ref summaries;
- generated object ids returned by control-plane commands.

Public action results must not include:

- raw prompts;
- raw Codex logs;
- HMAC headers;
- claim tokens;
- secrets;
- local absolute paths;
- unredacted context objects;
- unredacted validation traces.

## App-Server Runtime Requirements

The real driver uses Codex app-server mode. The design distinguishes app-server mode from one-shot CLI execution:

- app-server is a JSON-RPC style long-lived session/turn protocol;
- `codex exec` is not allowed;
- CLI fallback is not allowed;
- an app-server process may only be used when launched or connected through a governed transport that enforces the runtime policy; unsafe direct spawn remains test-only or local explicit opt-in and does not satisfy production acceptance.
- generation app-server turns must request a read-only or artifact-only sandbox profile, not the source-changing `dangerFullAccess` profile used by local Codex execution.

The app-server transport contract must cover:

- initialization;
- request/response methods;
- notification stream;
- close/cancel semantics;
- transport identity;
- owned vs external transport lifecycle;
- raw notification capture hooks;
- public-safe transport failure classification.

The generation driver must enforce:

- maximum concurrent generation tasks;
- per-task timeout;
- output size limit;
- raw log size limit;
- cancellation on daemon stop;
- cleanup after terminal or timeout;
- retryable vs non-retryable classification;
- no CLI fallback.

The generation driver must reject any effective app-server config that reports `dangerFullAccess`, approval bypass for source-changing work, or any write permission outside the configured artifact root. Unlike source-changing run-worker execution, generation success must not require `effective_dangerous_mode=confirmed`.

The existing run-worker app-server stub is not required to be replaced in this plan, but this plan must define contracts that allow Plan 3 or runtime hardening work to swap run-worker from `AppServerGovernorUnavailableDriver` to the same governed app-server transport family.

### Generation Runtime Safety

Existing source-changing app-server code is shaped around `RunSpec`, `ExecutionPackage`, and run-worker leases. Draft generation needs a separate, narrower safety contract because it must not pretend to be a package run.

Add a generation-specific safety interface:

```ts
interface CodexGenerationRuntimeSafety {
  readonly taskKind: CodexGenerationTaskKind;
  readonly actionRunId: string;
  readonly projectId: string;
  readonly repoIds: string[];
  readonly artifactRoot: string;
  readonly workspaceRoot?: string;
  readonly policyDigests: Record<string, string>;
  createGenerationLease(input: {
    promptDigest: string;
    contextDigest: string;
    outputSchemaVersion: string;
    now: string;
    expiresAt: string;
  }): Promise<GenerationLease>;
  consumeGenerationCommand(input: {
    lease: GenerationLease;
    method: string;
    commandDigest: string;
    nonce: string;
    now: string;
  }): Promise<void>;
}
```

The governed app-server transport consumes this generation lease before `thread/start`, `turn/start`, `turn/steer`, and `turn/interrupt`. It must not reuse run-worker `RunSpec` leases or require an `ExecutionPackage` id for draft generation.

The generation lease binds:

- task kind;
- action run id;
- prompt digest;
- context digest;
- output schema version;
- project id;
- allowed repo ids;
- workspace root when provided;
- artifact root;
- sandbox/write policy;
- hard timeout and output limits.

If the runtime cannot create this narrower generation lease, real `codex` generation blocks with `codex_generation_safety_unavailable`.

## Configuration

Existing:

```text
FORGELOOP_CODEX_AUTOMATION_GENERATION=disabled|fake|codex
```

Plan 2 updates the interpretation:

- `disabled`: no generation actions can execute generated payload tasks.
- `fake`: deterministic fake runtime.
- `codex`: real app-server runtime.

Recommended additional config:

```text
FORGELOOP_CODEX_GENERATION_DRIVER=fake|app_server
FORGELOOP_CODEX_GENERATION_MAX_CONCURRENCY=1
FORGELOOP_CODEX_GENERATION_TURN_TIMEOUT_MS=300000
FORGELOOP_CODEX_GENERATION_OUTPUT_LIMIT_BYTES=1048576
FORGELOOP_CODEX_GENERATION_ARTIFACT_ROOT=/path/to/artifacts
FORGELOOP_CODEX_APP_SERVER_ENDPOINT=...
```

The exact app-server endpoint shape can be socket, local HTTP, JSON-RPC transport, or an injected process transport in tests. The production contract must be app-server, governed, and non-CLI.

Config compatibility rules:

- `FORGELOOP_CODEX_AUTOMATION_GENERATION=codex` implies `FORGELOOP_CODEX_GENERATION_DRIVER=app_server` unless the latter is explicitly set to the same value.
- `FORGELOOP_CODEX_AUTOMATION_GENERATION=fake` implies `FORGELOOP_CODEX_GENERATION_DRIVER=fake`.
- conflicting legacy/new driver settings fail daemon startup.
- `FORGELOOP_CODEX_GENERATION_DRIVER` must not accept `cli`, `exec`, `exec_fallback`, or `codex_exec`.

Invalid config must fail fast at daemon startup with a clear public-safe message:

- `codex` mode without app-server transport;
- app-server transport configured as unsafe direct spawn in production;
- `exec_fallback` configured for generation;
- timeout/output/concurrency values outside allowed ranges.

## Generation Context Endpoints

Context endpoints remain signed internal endpoints. They require trusted automation actor headers and query parameters:

- `action_run_id`;
- `claim_token`.

The endpoint loads the claimed action, verifies it is still actively leased, and verifies action identity before returning context. The command endpoint still revalidates all authoritative preconditions before writing state.

### Plan Draft Context

Endpoint:

```http
GET /internal/automation/generation-context/work-items/:workItemId/plan-draft?spec_revision_id=...&action_run_id=...&claim_token=...
```

Validation:

- claimed action type is `ensure_plan_draft`;
- target object type is `work_item`;
- target object id is `workItemId`;
- action input `work_item_id` matches `workItemId`;
- action input `spec_revision_id` matches the query;
- WorkItem is not terminal;
- WorkItem belongs to the precondition project;
- Spec exists and belongs to the WorkItem;
- Spec has `status === "approved"` and `resolution === "approved"`;
- Spec has `approved_revision_id` set;
- Spec `current_revision_id` still equals `approved_revision_id`;
- requested `spec_revision_id` equals `approved_revision_id`;
- active holds block context loading.

Context type:

```ts
interface AutomationGenerationPlanContextV1 {
  context_version: 'generation_context.plan.v1';
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
  spec_revision: {
    id: string;
    spec_id: string;
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
  };
  repos: AutomationGenerationRepoContextV1[];
}
```

### Package Draft Context

Endpoint:

```http
GET /internal/automation/generation-context/plan-revisions/:planRevisionId/package-drafts?generation_key=...&action_run_id=...&claim_token=...
```

Validation:

- claimed action type is `ensure_package_drafts`;
- target object type is `plan_revision`;
- target object id is `planRevisionId`;
- action input `plan_revision_id` matches `planRevisionId`;
- action input `generation_key` matches the query;
- PlanRevision exists and equals the Plan `approved_revision_id`;
- Plan has `status === "approved"` and `resolution === "approved"`;
- Plan `current_revision_id` still equals `approved_revision_id`;
- based-on SpecRevision equals the WorkItem Spec `approved_revision_id`;
- the WorkItem Spec has `status === "approved"`, `resolution === "approved"`, and `current_revision_id === approved_revision_id`;
- WorkItem is not terminal;
- project/repo scope still matches automation precondition;
- active holds block context loading;
- non-default generation keys remain human-controlled according to existing regeneration rules.

Context type:

```ts
interface AutomationGenerationPackageContextV1 {
  context_version: 'generation_context.package.v1';
  action_run_id: string;
  generation_key: string;
  work_item: AutomationGenerationPlanContextV1['work_item'];
  spec_revision: AutomationGenerationPlanContextV1['spec_revision'];
  plan_revision: {
    id: string;
    plan_id: string;
    summary: string;
    content: string;
    implementation_summary: string;
    split_strategy: string;
    dependency_order: string[];
    test_matrix: string[];
    risk_mitigations: string[];
    rollback_notes: string;
    structured_document?: Record<string, unknown>;
  };
  repos: AutomationGenerationRepoContextV1[];
  package_policy: {
    allowed_repo_ids: string[];
    path_policy_summary: string;
    required_check_policy_summary: string;
    source_mutation_policy_default: 'path_policy_scoped' | 'no_source_changes';
  };
}
```

Repo context must remain bounded and public-safe:

- repo id;
- default branch;
- policy status;
- policy digest;
- parser version;
- package manager if already known;
- bounded workspace summary if already safe.

It must not include raw local paths unless a later internal artifact explicitly requires them.

## Generated Plan Draft Payload

`GeneratedPlanDraftV1` maps directly to `PlanRevision` draft fields:

```ts
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
```

Validation:

- all strings must be non-blank;
- arrays must contain non-blank strings;
- `dependency_order` is the ordered list of planned package keys;
- `dependency_order` must be non-empty for daemon-generated plans;
- every dependency order entry must be stable and slug-like;
- duplicate dependency order entries are invalid;
- `structured_document` must be an object when present;
- no approval, merge, release, push, or run enqueue instructions;
- no local absolute paths in public fields;
- no secrets or claim tokens.

The generated Plan defines the package split contract. Later Package draft generation must either produce exactly the package keys listed in the approved PlanRevision `dependency_order` or block with `generated_package_manifest_invalid`. The Package generator may add dependency edges among those package keys, but it may not invent, omit, or rename package keys without a new approved Plan revision.

Command payload:

```json
{
  "action_run_id": "action-run-id",
  "claim_token": "claim-token",
  "idempotency_key": "action-idempotency-key",
  "automation_precondition": { "...": "precondition" },
  "spec_revision_id": "spec-revision-id",
  "generated_plan_draft": { "...": "GeneratedPlanDraftV1" },
  "generation_artifacts": [{ "...": "ArtifactRef" }]
}
```

For the signed internal automation endpoint, `generated_plan_draft` is required. If a separate human/manual helper still needs server-synthesized plan content, it must use a different public command path outside this daemon endpoint. Automation daemon commands must not synthesize Plan content in the control plane.

Before idempotent replay or persistence, the command handler computes a canonical `generated_payload_digest` over `GeneratedPlanDraftV1` plus public-safe `generation_artifacts` identity. Artifact identity includes stable artifact kind/id/content digest metadata, but excludes volatile local paths, raw prompts, raw outputs, and raw logs. The command idempotency identity/precondition metadata must store this digest.

The command handler must revalidate the writer boundary before replaying or writing:

- action claim is active and matches `ensure_plan_draft`;
- target WorkItem and `spec_revision_id` match the claimed action input;
- Spec has `status === "approved"` and `resolution === "approved"`;
- Spec has `approved_revision_id` set;
- Spec `current_revision_id === approved_revision_id`;
- requested `spec_revision_id === approved_revision_id`;
- active holds still block writes.

Persistence:

- create Plan if absent;
- create PlanRevision from generated fields;
- set `based_on_spec_revision_id`;
- set `author_actor_id` to daemon identity or a stable automation actor id;
- attach `generation_artifacts` to PlanRevision `artifact_refs`;
- leave Plan in draft state;
- do not submit or approve.

Idempotent replay returns an existing PlanRevision only when the same idempotency key, WorkItem, `spec_revision_id`, command scope/precondition fingerprint, and `generated_payload_digest` match. For Plan drafts, "compatible" means the same `spec_revision_id`, same generated payload digest, and same public-safe generation artifact identity. The same idempotency key with a different generated payload digest blocks as `generated_payload_idempotency_drift`.

## Generated Package Draft Set Payload

`GeneratedPackageDraftSetV1` describes one generated package set:

```ts
interface GeneratedPackageDraftSetV1 {
  schema_version: 'package_drafts.v1';
  manifest: {
    manifest_version: 'execution_package_manifest.v1';
    package_set_key: string;
    package_count: number;
    dependency_order: string[];
  };
  packages: GeneratedExecutionPackageDraftV1[];
  dependencies: GeneratedExecutionPackageDependencyV1[];
  structured_document?: Record<string, unknown>;
}

interface GeneratedExecutionPackageDraftV1 {
  package_key: string;
  repo_id: string;
  objective: string;
  required_checks: RequiredCheckSpec[];
  required_artifact_kinds: ArtifactKind[];
  allowed_paths: string[];
  forbidden_paths: string[];
  source_mutation_policy: 'path_policy_scoped' | 'no_source_changes';
  required_test_gates?: Record<string, unknown>[];
  validation_strategy?: 'checks_required';
  structured_document?: Record<string, unknown>;
}

interface GeneratedExecutionPackageDependencyV1 {
  package_key: string;
  depends_on_package_key: string;
  dependency_type?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}
```

Validation:

- `schema_version` and `manifest_version` must match supported versions;
- `package_count` equals `packages.length`;
- `packages` is non-empty;
- `package_key` values are unique, stable, and slug-like;
- manifest `dependency_order` exactly matches the approved PlanRevision `dependency_order`;
- manifest `dependency_order` exactly covers package keys;
- dependency rows only reference package keys in this set;
- dependency graph is acyclic;
- every package binds exactly one repo;
- every repo id belongs to the project and is eligible for the automation scope;
- `required_checks` is non-empty when `validation_strategy` is absent or `checks_required`;
- daemon-generated packages may only use `checks_required` validation in v1;
- required check ids are unique within a package;
- `allowed_paths` and `forbidden_paths` are repo-relative patterns;
- no absolute paths, parent traversal, home-relative paths, or control characters;
- source mutation policy is compatible with path policy;
- generated paths cannot exceed captured runtime policy constraints;
- public fields contain no secrets, claim tokens, HMACs, raw local paths, or raw logs.

Unsafe path or policy proposals block the action with reason `generated_package_policy_invalid`. They are not silently repaired by widening scope.

The v1 schema intentionally does not allow generated `allow_all_repo` or generated `custom` validation strategies. Those modes require explicit human-reviewed approval evidence in the domain model and must remain outside daemon-generated package drafts until a later spec adds a human approval flow for them.

Command payload:

```json
{
  "action_run_id": "action-run-id",
  "claim_token": "claim-token",
  "idempotency_key": "action-idempotency-key",
  "automation_precondition": { "...": "precondition" },
  "generation_key": "default:plan-revision-id",
  "generated_package_drafts": { "...": "GeneratedPackageDraftSetV1" },
  "generation_artifacts": [{ "...": "ArtifactRef" }]
}
```

For the signed internal automation endpoint, `generated_package_drafts` is required. If a separate human/manual helper still needs server-synthesized packages, it must use a different public command path outside this daemon endpoint. The control plane must not fall back to hard-coded `api-package` generation for automation daemon commands.

Before idempotent replay or persistence, the command handler computes a canonical `generated_payload_digest` over `GeneratedPackageDraftSetV1`, `generation_key`, and public-safe `generation_artifacts` identity. This digest is distinct from the package-set `manifest_digest`: `generated_payload_digest` protects command replay, while `manifest_digest` identifies the canonical persisted package set. The command idempotency identity/precondition metadata must store `generated_payload_digest`.

The command handler must revalidate the writer boundary before replaying or writing:

- action claim is active and matches `ensure_package_drafts`;
- target PlanRevision and `generation_key` match the claimed action input;
- PlanRevision exists and equals the Plan `approved_revision_id`;
- Plan has `status === "approved"` and `resolution === "approved"`;
- Plan `current_revision_id === approved_revision_id`;
- PlanRevision `based_on_spec_revision_id` equals the WorkItem Spec `approved_revision_id`;
- WorkItem Spec has `status === "approved"` and `resolution === "approved"`;
- WorkItem Spec `current_revision_id === approved_revision_id`;
- active holds still block writes.

## Manifest Canonicalization

The control plane canonicalizes the generated package set before persistence:

1. Sort object keys for digest purposes.
2. Preserve package sequence from manifest `dependency_order`.
3. Normalize package keys and reject unstable or duplicate keys.
4. Normalize path patterns without widening them.
5. Normalize required checks while preserving order.
6. Build a canonical manifest object containing:
   - schema version;
   - plan revision id;
   - generation key;
   - package set key;
   - package keys;
   - dependency order;
   - dependency edges;
   - per-package policy digests;
   - output schema version.
7. Compute `manifest_digest` from canonical JSON.

The manifest digest stored on `execution_package_generation_runs` must represent the generated set, not a hard-coded placeholder.

The generation run must retain public-safe generation metadata in `result_json` after completion:

- task kind;
- prompt version;
- output schema version;
- manifest digest;
- generated payload digest;
- package keys;
- generation artifact ref summaries.

Raw prompt, raw output, and raw app-server logs remain internal artifacts and must not be copied into `result_json`.

## Package Persistence

For each generated package:

- create or idempotently replay an ExecutionPackage draft for the same plan revision, generation key, and package key;
- fill common lineage fields from the authoritative WorkItem, Spec, SpecRevision, Plan, and PlanRevision;
- fill generated fields from payload;
- apply default owners from WorkItem owner for now unless the payload schema later supports actor assignment;
- validate generated paths and checks against the current repo runtime policy before snapshot capture;
- capture policy snapshot through existing `defaultPackagePolicyFields` or the current runtime policy projection path only after validation passes;
- set `execution_package_set_id`;
- set `generation_key`;
- set `package_key`;
- set `sequence`;
- set per-package `manifest_digest`;
- validate with existing `validateExecutionPackage`;
- save `execution_package_generation_packages`.

After all packages are created and mapped, save dependency rows:

- translate `package_key` to generated package id;
- save `execution_package_dependencies`;
- validate package dependency graph;
- include dependency metadata and reason when present.

Complete `execution_package_generation_runs` only after all packages and dependencies are persisted.

`generation_artifacts` from the command payload must be stored on `execution_package_generation_runs.evidence_refs`. Only public-safe artifact summaries and digests may be copied into `result_json`; full artifact contents and internal paths remain in the artifact store.

Policy validation must be authoritative in the control plane. The daemon may prevalidate generated paths, but the command handler must reload current repo policy/projection and reject payloads that would widen allowed paths, bypass forbidden paths, require checks not allowed by policy, request source changes when the policy is missing or safe-default read-only, or bind a package to an ineligible repo. When policy is missing, parse-failed, or unsafe-path, `path_policy_scoped` packages are blocked or routed to the existing manual path mechanism; they are not converted into broad defaults.

Idempotency must detect drift:

- same idempotency key and same generated payload digest replays;
- same idempotency key with a different generated payload digest blocks as `generated_payload_idempotency_drift`;
- same plan revision/generation key/package key with different generated package identity blocks as drift;
- existing succeeded generation for a plan revision suppresses duplicate package generation unless explicit regeneration approval exists.

## Planner and Idempotency

Planner action ordering remains:

1. `ensure_spec_draft`
2. `ensure_plan_draft`
3. `ensure_package_drafts`
4. `project_runtime_snapshot`

Plan 2 does not add `enqueue_package_run`.

The planner receives generation identity as explicit input from the daemon, not by importing app-server runtime details:

```ts
interface AutomationGenerationPlanningConfig {
  mode: 'disabled' | 'fake' | 'app_server';
  tasks: {
    spec_draft: { enabled: boolean; promptVersion: string; outputSchemaVersion: 'spec_draft.v1' };
    plan_draft: { enabled: boolean; promptVersion: string; outputSchemaVersion: 'plan_draft.v1' };
    package_drafts: { enabled: boolean; promptVersion: string; outputSchemaVersion: 'package_drafts.v1' };
  };
}
```

Final Plan 2 behavior:

- `disabled` suppresses `ensure_spec_draft`, `ensure_plan_draft`, and `ensure_package_drafts`;
- `fake` and `app_server` allow enabled generation tasks to be planned;
- a task with `enabled: false` is suppressed even when other tasks are enabled;
- the planner uses only `mode`, task enabled flags, prompt version, and output schema version for action identity;
- the planner must not import `packages/codex-runtime` app-server protocol code.

During 2A, only `plan_draft` must migrate to this generated-payload behavior. The daemon planning config must set `package_drafts.enabled=false` by default in 2A, and the planner must suppress `ensure_package_drafts` even when a generated Plan is later manually approved. This prevents a mixed flow where a generated Plan feeds the old daemon-origin hard-coded package synthesis path.

During 2B, `package_drafts` may be enabled only after `ensure_package_drafts` requires `generated_package_drafts`, command-side payload digest/idempotency drift detection is in place, and the remaining control-plane hard-coded package synthesis path for automation commands is removed.

Runtime snapshot projections must use stable approved revision ids:

- `work_items_requiring_plan` targets the WorkItem only when the current Spec is approved, `approved_revision_id` is present, and `current_revision_id === approved_revision_id`;
- the `ensure_plan_draft` target revision id and action input `spec_revision_id` use Spec `approved_revision_id`;
- `plan_revisions_requiring_packages` targets only approved Plan `approved_revision_id`;
- the `ensure_package_drafts` target object id and action input `plan_revision_id` use Plan `approved_revision_id`;
- projections must not treat a mutable current revision as approved when `approved_revision_id` is absent or differs.

Idempotency for generation actions must include:

- action type;
- target type/id/revision;
- automation scope;
- automation settings version;
- capability fingerprint;
- precondition fingerprint;
- generation key where applicable;
- generation mode;
- prompt version;
- output schema version;
- policy digest where applicable.

Changing prompt version or output schema version must produce a distinct action identity when the target still needs generation.

Planner action identity is computed before generation and therefore does not include `generated_payload_digest`. Command idempotency is checked after generation and must include the command-side `generated_payload_digest` rules defined for Plan and Package commands above.

## Daemon Execution Flow

For `ensure_plan_draft`:

1. Parse action input.
2. Fetch Plan generation context.
3. Run `plan_draft` generation task through configured runtime.
4. Validate `GeneratedPlanDraftV1`.
5. Call `ensurePlanDraft`.
6. Complete action with public-safe command result.

For `ensure_package_drafts`:

1. Parse action input.
2. Fetch Package generation context.
3. Run `package_drafts` generation task through configured runtime.
4. Validate `GeneratedPackageDraftSetV1`.
5. Call `ensurePackageDrafts`.
6. Complete action with public-safe command result.

For `ensure_spec_draft`:

- migrate or wrap existing fake Spec draft generation behind the same runtime interface;
- keep existing signed Spec context and command behavior;
- do not regress Plan 1 tests.

The daemon must never write product state directly.

## Error Handling

Error mapping:

| Condition | Action outcome | Retryable | Public reason |
| --- | --- | --- | --- |
| generation disabled | blocked | false | `generation_disabled` |
| generation safety lease unavailable | blocked | false | `codex_generation_safety_unavailable` |
| app-server transport unavailable | failed | true | `codex_app_server_unavailable` |
| app-server unsafe direct spawn requested in production | blocked | false | `codex_app_server_unsafe_transport` |
| app-server effective config allows source writes | blocked | false | `codex_generation_sandbox_invalid` |
| task timeout | failed | true | `codex_generation_timeout` |
| cancellation during daemon shutdown | failed | true | `codex_generation_cancelled` |
| invalid JSON output | failed | true by default | `generated_output_invalid_json` |
| app-server output schema validation failure | failed | true | `generated_output_schema_invalid` |
| schema validation failure from stable fake output | blocked | false | task-specific invalid payload code |
| command-side generated Plan payload invalid | blocked | false | `generated_plan_draft_invalid` |
| command-side generated Package paths unsafe | blocked | false | `generated_package_policy_invalid` |
| command-side generated Package dependency cycle | blocked | false | `generated_package_dependency_invalid` |
| command idempotency key reused with different generated payload digest | blocked | false | `generated_payload_idempotency_drift` |
| command precondition stale | gate_pending | true | existing stale precondition code |
| active hold | blocked | false | existing hold code |
| transport 5xx/429 equivalent | failed | true | `codex_app_server_unavailable` |

No error may expose raw prompt, raw app-server response, local absolute paths, claim token, or secrets in public projections.

## Security and Privacy

The generation context serializers must redact:

- internal action claim tokens;
- HMAC headers and secrets;
- local absolute paths unless internal-only artifacts explicitly require them;
- raw logs;
- private artifact contents;
- unbounded runtime metadata;
- credentials and environment variables.

The app-server driver must not receive broader filesystem permissions than needed for generation. For draft generation, the default is no source writes. If app-server requires a `cwd`, it must use a controlled read-only or artifact-only workspace rather than the mutable source checkout.

If the app-server transport cannot enforce artifact-only/write-denied semantics, real `codex` generation must be blocked until the governed transport supports it.

## Testing

Unit tests:

- `GeneratedPlanDraftV1` accepts valid payloads and rejects missing/blank/malformed fields.
- `GeneratedPackageDraftSetV1` accepts valid multi-package payloads.
- package validator rejects duplicate package keys.
- package validator rejects missing dependency order entries.
- package validator rejects dependency cycles.
- package validator rejects absolute or parent-traversal paths.
- package validator rejects duplicate required check ids.
- generation runtime rejects non-JSON or ambiguous output.
- generation runtime maps app-server unavailable without CLI fallback.
- generation runtime rejects `dangerFullAccess` or source-write-capable app-server effective config.
- generation runtime blocks real app-server mode when generation safety lease creation is unavailable.
- idempotency includes prompt and schema versions.
- planner suppresses Spec, Plan, and Package generation actions when generation mode is `disabled`.
- planner uses daemon-supplied prompt and output schema versions in generation action identity without importing app-server runtime code.
- app-server invalid JSON/schema output fails retryably with public-safe reason and does not call the command endpoint.
- stable fake invalid output blocks non-retryably so deterministic prompt/schema bugs are not retried forever.

Control-plane tests:

- Plan generation context requires active claim and matching `spec_revision_id`.
- Plan generation context rejects unapproved Spec state, missing `approved_revision_id`, or `current_revision_id !== approved_revision_id`.
- `ensure-plan-draft` daemon command requires `generated_plan_draft`.
- `ensure-plan-draft` daemon command revalidates approved Spec state, `approved_revision_id`, and `current_revision_id === approved_revision_id` before replaying or writing.
- `ensure-plan-draft` daemon command stores and compares `generated_payload_digest`, and blocks idempotency-key reuse with different generated Plan payload/artifact identity.
- generated Plan command persists generated fields and artifact refs.
- generated Plan command rejects or sanitizes claim tokens, HMACs, secrets, raw prompts/output/logs, and local absolute paths in generated public fields, `generation_artifacts`, and action `result_json`.
- Package generation context requires active claim and matching generation key.
- Package generation context rejects unapproved Plan state, missing `approved_revision_id`, `current_revision_id !== approved_revision_id`, or mismatch between PlanRevision and Spec `approved_revision_id`.
- `ensure-package-drafts` daemon command requires `generated_package_drafts`.
- `ensure-package-drafts` daemon command revalidates approved Plan state, `approved_revision_id`, `current_revision_id === approved_revision_id`, and PlanRevision-to-Spec approved revision lineage before replaying or writing.
- `ensure-package-drafts` daemon command stores and compares `generated_payload_digest`, and blocks idempotency-key reuse with different generated Package payload/artifact identity.
- generated Package command persists generation run with canonical manifest digest.
- generated Package command persists `generation_artifacts` to `execution_package_generation_runs.evidence_refs` and copies only public-safe summaries/digests to `result_json`.
- generated Package command persists multiple package records.
- generated Package command persists dependency rows using package-key mapping.
- generated Package command rejects unsafe paths and dependency cycles.
- generated Package command rejects or sanitizes claim tokens, HMACs, secrets, raw prompts/output/logs, and local absolute paths in generated public fields, `generation_artifacts`, package records, dependency metadata, generation run `result_json`, and runtime snapshot projections.
- hard-coded `api-package` fallback is not used for daemon-origin package generation.

Daemon tests:

- fake runtime creates Plan draft from approved Spec.
- fake runtime creates Package drafts from approved Plan.
- daemon fails retryably on invalid app-server generated Plan output with public-safe reason.
- daemon fails retryably on invalid app-server generated Package output with public-safe reason.
- daemon blocks stable fake invalid Plan/Package output non-retryably with public-safe reason.
- daemon does not call command endpoint when validation fails.
- daemon does not enqueue runs.
- daemon does not use CLI fallback when app-server is unavailable.
- daemon blocks real app-server generation when read-only/artifact-only sandbox enforcement is unavailable.
- daemon cancels or cleans up in-flight generation on shutdown.

Integration/E2E tests:

- WorkItem without Spec still reaches fake Spec draft as in Plan 1.
- after 2B, approved Spec -> generated Plan draft -> human approval -> generated Package drafts.
- generated Plan content differs from previous hard-coded service-side fallback and matches fake/Codex payload.
- after 2B, generated Package set can include at least two packages with one dependency.
- generated Spec draft does not cause a Plan action until the Spec is manually approved.
- generated Plan draft does not cause a Package action until the Plan is manually approved.
- in a 2A deployment with `package_drafts.enabled=false`, an approved generated Plan does not emit or execute `ensure_package_drafts`.
- daemon never performs Spec submit/approve or Plan submit/approve transitions.
- Package generation cannot occur in the same daemon run as Plan draft generation unless an approved PlanRevision was explicitly seeded before that run.
- no RunSession is created by Plan 2 flows.

Dogfood:

- fake dogfood proves deterministic command path.
- real app-server dogfood proves at least one approved Spec can produce a generated Plan draft.
- real app-server dogfood may also prove Package draft generation if the local app-server transport is available.
- dogfood report must state whether app-server mode passed, skipped, blocked, or failed.

## Rollout

Implementation checkpoints:

### 2A: Runtime and Plan Draft

- Add `packages/codex-runtime` skeleton.
- Move or wrap Spec fake generation under runtime interface.
- Add task definitions and fake/app-server driver contracts.
- Add app-server startup validation that rejects unsafe direct spawn, CLI/exec fallback, missing generation safety lease, source-write-capable effective config, and `dangerFullAccess`.
- Add `GeneratedPlanDraftV1` validator.
- Add Plan generation context endpoint.
- Extend `ensure_plan_draft` DTO and command.
- Add command-side generated payload digest, idempotency drift detection, and approved revision writer-boundary revalidation for Plan drafts.
- Wire daemon `ensure_plan_draft` through runtime.
- Add redaction validators for generated Plan public fields, `generation_artifacts`, action result JSON, and runtime snapshot projections.
- Add focused unit, API, daemon, and E2E tests.

Acceptance:

- approved Spec creates generated Plan draft through the daemon;
- Plan remains draft;
- existing non-daemon/manual Package draft behavior does not regress;
- `package_drafts.enabled=false` suppresses `ensure_package_drafts` for 2A, including after a generated Plan is manually approved;
- no CLI fallback exists;
- `codex` mode cannot start unless governed app-server read-only/artifact-only sandbox enforcement is available.

### 2B: Package Draft Set

- Add `GeneratedPackageDraftSetV1` validator.
- Add Package generation context endpoint.
- Extend `ensure_package_drafts` DTO and command.
- Add manifest canonicalization and digest.
- Persist generated packages and generation package records.
- Persist package generation artifact refs on `execution_package_generation_runs.evidence_refs`.
- Persist dependencies by package-key mapping.
- Add command-side generated payload digest, idempotency drift detection, and approved revision writer-boundary revalidation for Package drafts.
- Replace daemon-origin hard-coded `api-package` generation.
- Add redaction validators for generated Package public fields, dependency metadata, package records, `generation_artifacts`, generation run result JSON, and runtime snapshot projections.
- Add focused unit, API, daemon, and E2E tests.

Acceptance:

- approved Plan creates generated Package drafts through the daemon;
- `package_drafts.enabled` is turned on only after daemon-origin hard-coded package synthesis is removed;
- package manifest and dependency graph are persisted;
- no RunSession is created;
- unsafe generated package proposals are blocked.

### 2C: App-Server Hardening

- Solidify governed app-server transport contract.
- Expand timeout, cancellation, cleanup, raw log, concurrency, and long-running transport lifecycle tests.
- Add real app-server dogfood path where environment supports it.
- Document how Plan 3/run-worker will reuse the same transport family.

Acceptance:

- app-server mode is production-shaped and governed;
- unsafe direct spawn is rejected for production;
- action failures are public-safe;
- run-worker source-changing execution remains out of scope but is not blocked by incompatible runtime design.

## Acceptance Criteria

- A WorkItem can still receive a generated Spec draft through existing Plan 1 flow.
- A human-approved Spec can receive a generated Plan draft through the daemon.
- A human-approved Plan can receive generated Package drafts through the daemon.
- Plan and Package draft generation payloads are produced outside the control plane and applied through signed internal commands.
- Control-plane command handlers no longer synthesize daemon-origin Plan or Package content.
- Generated Package drafts persist generation runs, package records, package-key mapping, manifest digest, and dependency rows.
- Default daemon behavior still does not enqueue package runs.
- No source-changing work runs as part of this plan.
- Real generation uses Codex app-server mode, not `codex exec`.
- CLI fallback is absent and covered by tests.
- Public action results and errors are redacted.

## Open Follow-Ups

- Plan 3 will add `enqueue_package_run`, enqueue preflight attestation production, and dogfood autorun after Plan 2 is stable.
- Run-worker app-server replacement will use the app-server transport contracts established here, but source-changing execution remains outside this Plan 2 spec.
- The product UI may later expose generation artifacts, validation reports, and retry controls, but this spec does not add UI surfaces.
