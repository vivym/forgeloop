# PRD-first Automation Daemon Design

## Status

Draft for spec review.

## Context

ForgeLoop 的产品主线已经由 `docs/PRD_v1.md` 定义清楚：系统不是一个 issue runner，也不是 coding-agent 工作台，而是一个以 Work Item、Spec、Implementation Plan、Execution Package、Review Packet、Release 和 Trace 为核心对象的 AI-native 研发执行与进化系统。

本次设计来自对 OpenAI Symphony 的代码分析，但不会复制 Symphony 的产品流程。Symphony 的主要价值在于运行时工程经验：repo-owned runtime policy、last-known-good 配置热加载、workspace path safety、Codex app-server continuity、hook timeout、运行态 snapshot、token/rate-limit 观测，以及面向 daemon 的调度状态。

这些能力对 ForgeLoop 有借鉴意义，但必须下沉到 ForgeLoop 的执行与自动推进基础设施中。ForgeLoop 的流程权威仍然是 PRD 对象模型和控制平面状态机。

## PRD Alignment

本设计严格遵循 `docs/PRD_v1.md` 的交付主线：

`Work Item -> Spec -> Implementation Plan -> Execution Package -> AI Implementation -> AI Review -> Human Review -> Integration / Cross-end Validation -> Test / Acceptance -> Release -> Observation`

自动化 daemon 的职责是推动这条链路中已经满足门禁的下一步，而不是重新定义链路。它不能绕过：

- Spec approval
- Plan approval
- Execution Package readiness
- RunSession 执行证据
- ReviewPacket
- Human Review
- Integration/Test gate
- Release Owner 决策

外部 tracker 未来可以作为 Work Item intake/source adapter，但不能成为 ForgeLoop 的执行主对象。

## Problem

ForgeLoop 目前已经有强于 Symphony 的控制平面基础：

- durable repository
- `RunSession`
- `ReviewPacket`
- evidence chain
- worker lease / heartbeat
- stalled-run handling
- Codex app-server driver 和 exec fallback
- release gate 和 public evidence serialization

但在自动推进与执行 runtime 方面仍有缺口：

- 缺少 repo-owned runtime policy，让不同 repo 表达自己的 Codex/runtime/check/path/hook 约束。
- 缺少 last-known-good policy loader，配置解析失败时没有明确的安全降级策略。
- workspace path safety 还不完整，当前有 artifact root guard 和 source dirty fingerprint，但缺少逐段 symlink canonicalization、workspace root equality 拒绝、workspace escape 分类错误。
- required check/path policy 仍较粗糙，当前 glob 近似是 prefix-based，难以成为长期安全边界。
- 自动推进仍散落在 API/run-worker 生命周期中，没有可审计、可幂等的 `NextAction` / `automation_action_runs` 边界。
- 运维/产品视角缺少一个 PRD-first runtime snapshot，看清 package/run/review/release 的阻塞点。

## Goals

- 引入 PRD-first automation daemon，自动推进 ForgeLoop 内部对象的低争议步骤。
- 保持 `control-plane-api` 作为唯一权威写入口和状态机门禁。
- 保持 `run-worker` 作为 RunSession 执行、lease、heartbeat、recovery 的执行 daemon。
- 引入 repo runtime policy，但只影响执行策略，不定义产品流程。
- 增强 workspace/path/check/hook 安全边界。
- 记录自动动作的审计轨迹、幂等键、错误和 policy digest。
- 提供 Runtime Snapshot，让 Execution Owner、Reviewer 和 operator 看清当前系统卡在哪里。
- 为未来 Linear/GitHub/Jira intake 留出 source adapter，但第一期不接外部 tracker。

## Non-Goals

- 不复制 Symphony 的 Linear issue-driven workflow。
- 不让 agent 直接管理 Work Item lifecycle。
- 不让 `WORKFLOW.md` 定义 Work Item / Spec / Plan / Review / Release 状态机。
- 不自动批准 Spec、Plan、ReviewPacket 或 Release。
- 不自动把外部 tracker issue 置为 Done。
- 不在第一期构建完整 Linear/GitHub/Jira daemon。
- 不重写现有 P0 command API、repository、run-worker 或 evidence chain。
- 不引入 GraphQL。
- 不做微服务化拆分。

## Current Implementation Baseline

相关现有实现：

- `docs/PRD_v1.md`
- `README.md`
- `apps/control-plane-api/src/p0/p0.service.ts`
- `apps/control-plane-api/src/p0/run-worker-lifecycle.service.ts`
- `apps/control-plane-api/src/p0/run-session-serialization.ts`
- `apps/control-plane-api/src/modules/query/query.service.ts`
- `packages/workflow/src/activities.ts`
- `packages/run-worker/src/run-worker.ts`
- `packages/run-worker/src/lease.ts`
- `packages/run-worker/src/watchdog.ts`
- `packages/executor/src/codex-app-server-driver.ts`
- `packages/executor/src/codex-worktree.ts`
- `packages/executor/src/source-repo-guard.ts`
- `packages/executor/src/local-codex-evidence.ts`
- `packages/executor/src/local-codex-preflight.ts`
- `packages/contracts/src/executor.ts`
- `packages/domain/src/types.ts`
- `packages/db/src/schema/run-worker-lease.ts`
- `packages/db/src/schema/run-event.ts`
- `packages/db/src/schema/review-packet.ts`
- `packages/db/src/schema/release.ts`

Important existing strengths:

- `.worktrees/<run-session-id>` provides a persistent worktree boundary.
- Source repo mutation is guarded by dirty fingerprints before and after local Codex execution.
- Run worker leases fence writes and support recovery.
- Codex app-server thread/turn metadata is already recorded.
- Public run session serialization strips raw runtime internals.
- Release and public evidence redaction already exist.

## Recommended Approach

### A. PRD-first Automation Daemon With Runtime Policy

Implement a daemon-ready automation layer that advances ForgeLoop objects through PRD-defined gates and adds repo runtime policy/safety/snapshot foundations.

This is recommended because it gets the operational benefits of Symphony without replacing ForgeLoop's product model.

### B. Runtime Safety Only

Only implement runtime policy, path safety, hooks, and snapshot. This reduces risk, but leaves automatic PRD flow advancement unsolved.

### C. Full Symphony-style Tracker Daemon

Implement a daemon that watches Linear/GitHub/Jira and runs agents directly. This is not recommended because it conflicts with ForgeLoop's Work Item / Spec / Plan / Execution Package authority.

The selected approach is **A**.

## Architecture And Boundaries

### Control Plane Remains Authoritative

`control-plane-api` remains the only authoritative write surface for product object state transitions. The automation daemon must call existing service/repository command methods and domain transitions. It must not write status fields directly to bypass validation.

Automation safety cannot rely only on daemon-local action claims. Any daemon-triggered state change must be protected at the authoritative command boundary so manual/API callers and daemon callers share the same idempotency and compare-and-set rules.

Required command-boundary properties:

- re-read current object state inside the command transaction or repository critical section;
- verify the expected target revision/status still matches;
- reject, skip, or return the existing result when the object has already advanced;
- use unique constraints or repository-level compare-and-set where durable storage supports them;
- return stable existing object ids for duplicate idempotent requests;
- emit the same object events/status history regardless of whether the caller is human, API automation, or daemon.

The first implementation must add explicit idempotent command variants where current P0 methods are not safe enough to call directly.

### Automation Daemon Is A Sidecar

Add an `automation-daemon` process or app that can run independently from the API. Its responsibilities:

- scan or subscribe to eligible ForgeLoop objects;
- compute the next safe action;
- execute approved automatic actions through control-plane command boundaries;
- record every attempt;
- back off or escalate when blocked.

The daemon should be disabled by default until configured. It must be safe to run multiple instances as long as action idempotency and repository fencing are respected.

### Automation Levels

Automation must be configurable by project/repo and must default to the lowest useful level.

Initial levels are named presets over explicit capabilities, not an ordered enum:

| Preset | Project Runtime State | Generate Plan Draft | Generate Package Drafts | Enqueue Runs |
| --- | --- | --- | --- | --- |
| `off` | no | no | no | no |
| `ready_projection` | yes | no | no | no |
| `draft_only` | yes | yes | yes | no |
| `run_enqueue` | yes | yes | yes | yes |

Default:

- first implementation defaults to `draft_only` for local dogfood only;
- production/default project behavior is `off` unless explicitly enabled;
- `run_enqueue` is opt-in and must be separate from draft generation.

Planner rules must check capabilities directly, for example `canGeneratePlanDraft`, `canGeneratePackageDrafts`, and `canEnqueueRuns`. They must not rely on ordinal comparison between preset names. This separation preserves the current manual Run action while allowing the system to grow toward safe automation.

### Run Worker Keeps Execution Ownership

`run-worker` continues to own:

- claim/reclaim recoverable RunSessions;
- heartbeat leases;
- command input delivery;
- Codex app-server/fallback driver selection;
- terminal finalization;
- evidence collection;
- self-review and ReviewPacket generation.

The automation daemon may enqueue a new RunSession only at the ExecutionPackage boundary when `run_enqueue` is explicitly enabled. It does not resume live RunSessions, retry recoverable RunSessions, consume Codex streams, or compete with worker lease recovery.

### External Tracker Is Intake Only

Future Linear/GitHub/Jira integrations should implement `WorkItemSourceAdapter`. They may create, update, or link ForgeLoop Work Items. They must not replace Execution Package, RunSession, ReviewPacket, or Release as first-class objects.

## Core Components

### RepoRuntimePolicyLoader

Loads repo-owned runtime policy from `WORKFLOW.md` or a future explicitly named policy file.

Responsibilities:

- parse YAML front matter plus Markdown body;
- validate typed runtime settings;
- compute `policy_digest`;
- retain last-known-good policy;
- expose safe defaults when no policy exists if the caller allows default mode;
- emit/load failure diagnostics without crashing the daemon.

Policy data may include:

- Codex runtime config;
- workspace hooks;
- hook timeout;
- default required check templates;
- default path policy templates;
- prompt policy body;
- observability hints;
- raw log retention hints.

Policy data must not define:

- Work Item status lifecycle;
- Spec/Plan approval requirements;
- Review approval;
- Release gates;
- human override final authority.

### AutomationDaemon

Long-running process that periodically scans eligible objects and executes actions.

Initial scan targets:

- approved Spec without current Plan draft;
- approved Plan without generated Execution Packages;
- ready ExecutionPackage without active run/review blocker;
- stalled/failed RunSessions for projection and escalation only;
- ready ReviewPacket requiring notification/projection;
- Release readiness candidates in later phases.

### AutomationPlanner

Pure decision component. It converts object state into `NextAction` or `NoAction`.

Examples:

- `generate_plan_draft`
- `generate_execution_packages`
- `enqueue_package_run`
- `escalate_manual_path`
- `notify_review_ready`
- `project_runtime_snapshot`

Planner tests should be exhaustive because this is where PRD gate correctness lives.

### AutomationExecutor

Executes `NextAction`.

Rules:

- call idempotent service/repository command boundaries;
- use idempotency keys;
- update `automation_action_runs`;
- record terminal action status;
- preserve original errors for internal diagnostics;
- expose only public-safe summaries to API/UI.

### WorkItemSourceAdapter

Future extension point for external intake.

First implementation:

- `forgeloop` internal adapter.

Future implementations:

- Linear adapter;
- GitHub issue adapter;
- Jira adapter;
- monitoring/incident adapter.

These adapters are out of scope for first implementation beyond the interface shape and internal adapter.

### RuntimeSnapshotProjector

Builds a PRD-first runtime view:

- queued/running/stalled/retrying RunSessions;
- active worker leases, heartbeat, expiry;
- driver kind and fallback reason;
- last event cursor and time;
- retry count;
- ReviewPacket status;
- package dependency blockers;
- automation action status;
- policy digest and last-known-good state.

This should feed a query route and eventually the web workbench.

## Data Model Additions

### automation_cursors

Stores per-daemon scan cursors.

Suggested fields:

- `id`
- `cursor_key`
- `cursor_value`
- `daemon_id`
- `updated_at`

The first implementation may avoid cursors if queries are naturally idempotent and bounded, but the table is useful once external intake exists.

### automation_action_runs

Durable audit of automatic actions.

Suggested fields:

- `id`
- `action_type`
- `target_object_type`
- `target_object_id`
- `target_revision_id`
- `target_status`
- `idempotency_key`
- `status`: `pending | running | succeeded | failed | skipped | blocked`
- `claim_token`
- `attempt`
- `locked_until`
- `reason`
- `error_code`
- `error_message`
- `policy_digest`
- `created_by`: daemon identity
- `claimed_at`
- `started_at`
- `finished_at`
- `created_at`
- `updated_at`

Uniqueness:

- unique `idempotency_key`
- or unique `(action_type, target_object_type, target_object_id, idempotency_key)`

Claim protocol:

1. Planner computes `idempotency_key` from action type, target id, target revision id, target status, automation level, and policy digest when relevant.
2. Executor inserts or claims `automation_action_runs` before any side effect.
3. Claim must be transactional: only one daemon can transition an action from `pending` or expired `running` to `running` with a fresh `claim_token`.
4. Side effects may run only while the caller owns the current `claim_token`.
5. Terminal transitions require the same `claim_token`.
6. Expired locks may be reclaimed by a later daemon attempt, incrementing `attempt`.
7. Terminal `succeeded`, `skipped`, and non-retryable `blocked` rows must suppress duplicate side effects for the same key.

This protocol is required before running multiple daemon instances or before enabling `run_enqueue`.

The claim protocol does not replace product-object idempotency. It prevents duplicate daemon workers, but the control-plane command still must protect against a concurrent manual/API request operating on the same target object.

### runtime_policy_snapshot

Do not add a standalone table in the first phase unless implementation proves it necessary.

Record on `RunSession.runtime_metadata`:

- `policy_digest`
- `policy_source_path`
- `policy_loaded_at`
- `policy_last_known_good`

For generated ExecutionPackages, policy-derived defaults should be copied into the package at generation time and then frozen through existing approval/readiness flows.

## Automation Rules

### Spec Approved To Plan Draft

If a Work Item has an approved current Spec and no current Plan draft, daemon may generate Plan draft only when `canGeneratePlanDraft` is true.

Command sequence:

1. claim `generate_plan_draft` using key `generate_plan_draft:<work_item_id>:<spec_revision_id>`;
2. re-read Work Item, current Spec, and existing Plans inside the action transaction or immediately after claim;
3. call an idempotent control-plane command equivalent to `ensurePlanDraftForApprovedSpec(workItemId, specRevisionId, idempotencyKey)`;
4. the command may internally create the Plan, then create/generate the draft PlanRevision;
5. mark the action `succeeded` only after the new PlanRevision is persisted.

If a Plan already exists with a draft/current revision for the same approved Spec context, the action must become `skipped`, not generate a duplicate.

Current `createPlan(workItemId)` and `generatePlanDraft(planId)` style commands are not sufficient unless wrapped in a command that atomically checks the approved Spec revision and returns an existing Plan/PlanRevision on duplicate calls.

It must not approve the Plan.

### Plan Approved To Execution Packages

If a Work Item has approved current Plan and no generated Execution Packages for that Plan revision, daemon may generate package drafts only when `canGeneratePackageDrafts` is true.

Command sequence:

1. claim `generate_execution_packages` using key `generate_execution_packages:<work_item_id>:<plan_revision_id>`;
2. re-read current Spec, current Plan, and packages for the PlanRevision;
3. call an idempotent control-plane command equivalent to `ensureExecutionPackageDraftsForPlanRevision(planRevisionId, idempotencyKey)`;
4. mark generated packages as drafts/candidates requiring human review before readiness.

Package generation must remain PRD-aligned. A generated package must include or point to:

- split rationale;
- required checks or explicit validation strategy;
- allowed and forbidden paths;
- owner/reviewer/QA owner candidates when available;
- dependencies and dependency rationale when available;
- independent verification/review/rollback/retrospective notes.

Current hardcoded package generation may be reused only as a temporary draft generator. Such packages must not be auto-marked ready or auto-run until a human edits/reviews them through existing package readiness commands.

Current `generatePackages(planRevisionId)` behavior must be wrapped or replaced before daemon use so it cannot create duplicate packages when a human/API caller and daemon act concurrently.

First implementation must not auto `mark-ready` generated packages.

### Ready ExecutionPackage To Queued RunSession

Daemon may enqueue a run only when `canEnqueueRuns` is true and all of the following are true:

- Spec is approved;
- Plan is approved;
- ExecutionPackage is ready;
- required checks are non-empty or explicit validation strategy exists;
- allowed/forbidden paths are frozen;
- dependency packages are satisfied;
- no active/open RunSession exists for the package;
- no open ReviewPacket is waiting for human review;
- package is not already linked to a blocked release gate that forbids new execution.
- no `enqueue_package_run` action with the same package id and package revision/status has already succeeded or is currently claimed.

Command sequence:

1. claim `enqueue_package_run` using key `enqueue_package_run:<execution_package_id>:<package_updated_at_or_revision>:<executor_type>:<workflow_only>`;
2. re-read package, current open RunSessions, ReviewPackets, dependencies, and release blockers after claim;
3. if any run/review/dependency blocker appears, mark action `skipped` or `blocked`;
4. call an idempotent control-plane command equivalent to `enqueueRunIfPackageStillReady(packageId, expectedPackageRevision, idempotencyKey, actorContext)`;
5. record returned `run_session_id` in action metadata before marking `succeeded`.

`run_enqueue` must be disabled by default. Planner tests must prove ready packages do not enqueue without this explicit level.

The run enqueue command must be atomic against manual/API callers. It must reject or return an existing active RunSession if the package already has an active/open RunSession or open ReviewPacket. A durable implementation should enforce this with repository compare-and-set and, where practical, a unique active-run guard for non-terminal runs per ExecutionPackage.

### Stalled Or Failed Run Handling

First implementation must not retry or resume RunSessions. `run-worker` owns recoverable RunSession claim/reclaim, worker heartbeat, stream handling, stall detection, and recovery.

Daemon may only project or escalate:

- stalled runs that have exceeded worker recovery policy;
- terminal failed runs whose failure category requires manual path;
- repeated package failures across separate completed RunSessions.

Daemon must escalate/manual-path for:

- missing required tools/auth after worker/preflight evidence exists;
- dirty source checkout blocked by preflight;
- path violation;
- forbidden command;
- source repo mutation;
- repeated failure above threshold;
- any high-risk policy violation.

Future automatic package-level retry may be added only as a separate design. If added, it must create a new package rerun through existing package rerun commands and must not resume or duplicate an active RunSession.

### Review Ready

Run finalization already generates ReviewPacket. Daemon may notify, project, or surface it. It must not approve or request changes.

### Release Readiness

First implementation should not automatically create or close Releases. Later phases may mark Work Item/Package aggregate readiness for Release Owner, but release decisions remain explicit.

## Runtime Policy Semantics

Runtime policy is repo-owned execution configuration, not product process configuration.

Allowed sections:

- `codex`
- `workspace`
- `hooks`
- `checks`
- `path_policy`
- `prompt_policy`
- `observability`

Suggested behavior:

- relative policy paths resolve relative to policy file directory;
- invalid reload keeps last-known-good;
- invalid initial load blocks daemon or falls back to explicit default mode depending on deployment config;
- reload failure records an internal event and automation action diagnostic;
- every RunSession records the policy digest it used;
- policy changes do not mutate already approved/frozen ExecutionPackage boundaries.

Frozen fields:

- `required_checks`
- `allowed_paths`
- `forbidden_paths`
- package objective once approved/ready;
- package dependencies once ready.

Runtime-configurable fields:

- Codex command/runtime hints;
- hook commands/timeouts;
- observability/raw log hints;
- prompt policy appended to execution context if package generation captured it.

## Workspace Safety

Add a shared executor-level `PathSafety` module.

Required behavior:

- canonicalize paths by resolving symlinks segment by segment;
- reject workspace path equal to workspace root;
- reject workspace path outside canonical workspace root;
- classify symlink escape distinctly;
- protect stale non-directory cleanup by validating root first;
- reject paths containing null bytes or invalid control characters;
- ensure artifact paths stay inside canonical artifact root;
- preserve source repo dirty fingerprint guard.

Worktree rules:

- keep `.worktrees/<run-session-id>`;
- use sanitized run session safe segment;
- verify canonical workspace path is below canonical `.worktrees` root;
- before deletion or recreation, verify target is not root and does not escape root;
- record workspace path only in runtime metadata, and do not expose it publicly.

Check execution rules:

- run required checks with `cwd` set to canonical workspace path;
- verify cwd invariant before and after each command;
- forbidden commands fail with non-retryable policy error;
- command output is stored as artifacts and public-serialized through existing redaction.

Hook rules:

- support `before_run` and `after_run` first;
- later add `after_create` and `before_remove` if needed;
- `before_run` failure blocks run;
- `after_run` failure is logged but does not overwrite terminal run status;
- hook timeout is mandatory;
- hook output is truncated for logs;
- hook artifacts are internal by default unless explicitly public-safe.

## Runtime Snapshot

Add a query surface for PRD-first runtime health.

Possible route:

- `GET /query/runtime`

Payload groups:

- `generated_at`
- `counts`
- `automation`
- `run_sessions`
- `worker_leases`
- `review_packets`
- `package_blockers`
- `policy`

The projection must reuse `serializePublicRunSession` or the same redaction rules. It must not expose:

- local workspace paths;
- source repo absolute paths;
- raw logs;
- raw runtime metadata;
- secrets from policy, hooks, env, or command output.

## API And Process Boundaries

Potential command additions should be explicit and narrow:

- `POST /automation/refresh` for manual daemon scan trigger in local/dev mode.
- `GET /automation/action-runs` for internal/admin inspection, or include it under query module if public-safe.
- `GET /query/runtime` for product/operator runtime view.

The automation daemon may also operate directly on repository interfaces in-process, but every state change must share the same command/domain logic used by `control-plane-api`.

New or revised command boundaries required before daemon mutation:

- `ensurePlanDraftForApprovedSpec(workItemId, specRevisionId, idempotencyKey)`
- `ensureExecutionPackageDraftsForPlanRevision(planRevisionId, idempotencyKey)`
- `enqueueRunIfPackageStillReady(packageId, expectedPackageRevision, idempotencyKey, actorContext)`

These commands must be safe when called concurrently by:

- two daemon instances;
- daemon plus manual REST API caller;
- daemon plus test/dogfood script;
- repeated retry after daemon crash.

The command must be the final authority. `automation_action_runs` is audit and daemon coordination, not a substitute for object-level consistency.

## Error Handling

Error classes:

- `policy_missing`
- `policy_parse_failed`
- `policy_validation_failed`
- `policy_reload_failed`
- `automation_duplicate_action`
- `automation_claim_conflict`
- `automation_lock_expired`
- `command_idempotency_conflict`
- `command_revision_mismatch`
- `automation_precondition_failed`
- `automation_gate_blocked`
- `workspace_path_escape`
- `workspace_symlink_escape`
- `workspace_equals_root`
- `hook_failed`
- `hook_timed_out`
- `forbidden_command`
- `manual_path_required`

Rules:

- recoverable infrastructure errors may retry with backoff;
- PRD gate failures become skipped/blocked action runs, not run failures;
- safety violations are non-retryable until human intervention or policy/object change;
- daemon does not retry or resume live/recoverable RunSessions in the first implementation;
- package run enqueue is disabled unless `run_enqueue` is explicitly configured;
- control-plane command idempotency must protect against daemon/manual/API races;
- policy reload failure cannot modify frozen execution boundaries;
- action error summaries must be public-safe.

## Testing Strategy

### Unit Tests

Add focused tests for:

- runtime policy parse: front matter/body/defaults;
- last-known-good reload;
- invalid reload diagnostics;
- policy digest stability;
- automation level defaults and gating;
- path canonicalization;
- symlink escape;
- workspace root equality rejection;
- stale non-directory cleanup guard;
- artifact root guard;
- check cwd invariant;
- forbidden command policy;
- automation planner action/no-op matrix;
- idempotency key generation;
- action claim token and lock expiry behavior;
- idempotent command boundary duplicate-return behavior;
- action run status transitions.

### Integration Tests

Add integration coverage for:

- approved Spec generates Plan draft but not approval;
- approved Plan generates package draft/candidate but not automatic approval;
- `ready_projection` projects runtime state but never creates Plan drafts, package drafts, or runs;
- ready package does not enqueue by default;
- ready package enqueues only when `run_enqueue` is explicitly enabled and no blocker exists;
- open ReviewPacket blocks rerun;
- daemon does not retry/resume recoverable RunSessions owned by run-worker;
- worker/daemon recovery races do not create duplicate RunSessions or duplicate resume attempts;
- two daemon instances cannot execute the same action side effect;
- daemon/manual Plan draft races return one Plan/PlanRevision;
- daemon/manual package generation races return one package set for a PlanRevision;
- daemon/manual run enqueue races return one active RunSession or a deterministic skipped result;
- path violation escalates manual path and does not retry;
- RunSession records `policy_digest`;
- policy reload does not mutate frozen package checks/paths;
- public run/session/runtime serialization strips local paths and raw metadata.

### Smoke / Dogfood

Add a deterministic smoke path:

1. create Work Item;
2. approve Spec;
3. daemon generates Plan draft;
4. approve Plan;
5. daemon generates package draft;
6. mark package ready;
7. verify daemon does not enqueue RunSession while automation level is `draft_only`;
8. enable `run_enqueue`;
9. daemon enqueues RunSession;
10. run-worker completes mock or fake local path;
11. ReviewPacket becomes ready;
12. runtime snapshot shows terminal state without unsafe local data.

## Delivery Phases

### Phase 1: Runtime Safety And Policy

- `RepoRuntimePolicyLoader`
- policy digest in runtime metadata
- last-known-good behavior
- `PathSafety`
- hook timeout model
- check cwd invariant
- expanded executor tests

### Phase 2: PRD-first Automation Core

- `automation-daemon`
- `AutomationPlanner`
- `AutomationExecutor`
- `automation_action_runs`
- action claim/lock/idempotency protocol
- optional `automation_cursors`
- ForgeLoop internal source adapter
- automated Plan/package draft rules
- opt-in package run enqueue gate

### Phase 3: Runtime Snapshot

- `RuntimeSnapshotProjector`
- `GET /query/runtime`
- web workbench integration
- public-safe action/run/review/package blocker projection

### Phase 4: External Source Adapter

- `WorkItemSourceAdapter` contract hardening
- Linear/GitHub/Jira intake prototypes
- no external tracker as execution authority

## Acceptance Criteria

- The design preserves the PRD object model and does not introduce a Symphony-style issue runner.
- Automation daemon can advance only PRD-approved gates.
- No automatic approval exists for Spec, Plan, ReviewPacket, or Release.
- Automatic run enqueue is disabled unless a project/repo explicitly enables `run_enqueue`.
- Daemon does not retry or resume live/recoverable RunSessions owned by run-worker.
- Automation presets map to explicit capabilities; `ready_projection` never mutates Plan, Package, or Run state.
- Control-plane command boundaries are idempotent/CAS-protected against daemon/manual/API races.
- Runtime policy affects execution runtime, not product lifecycle.
- Frozen ExecutionPackage boundaries cannot be changed by policy reload.
- Workspace path safety rejects symlink escape, root equality, and outside-root paths.
- Required checks run only in canonical workspace cwd.
- Every automation action is idempotent, claimed before side effects, and auditable.
- Runtime snapshot exposes operational status without leaking local paths or raw metadata.
- Existing P0 delivery loop tests and dogfood flows continue to pass.

## Open Questions

- Should the repo-owned policy file remain `WORKFLOW.md`, or should ForgeLoop prefer a less process-loaded name such as `FORGELOOP.md` or `.forgeloop/runtime-policy.md`?
- Should Phase 1 introduce only `before_run/after_run` hooks, or include `after_create/before_remove` immediately?
- Should `automation-daemon` be a separate app package from day one, or start as a module within `control-plane-api` with a path to extraction?

## Decision

Proceed with a PRD-first automation daemon and runtime policy foundation. Use Symphony as an implementation reference for runtime safety, config reload, and observability, but keep ForgeLoop's PRD-defined object model and approval gates as the system of record.
