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

- run inside a durable transaction or repository object lock covering the target object and command idempotency row;
- re-read current object state inside the command transaction or repository critical section;
- verify the expected target revision/status still matches;
- reject, skip, or return the existing result when the object has already advanced;
- use unique constraints or repository-level compare-and-set for every invariant that can create duplicate product objects or unsafe state transitions;
- return stable existing object ids for duplicate idempotent requests;
- emit the same object events/status history regardless of whether the caller is human, API automation, or daemon.

For the durable repository this means explicit command methods that own the transaction, or a shared helper equivalent to `withP0Transaction` / `withObjectLock`. For the in-memory repository this means an equivalent mutex/critical section, not optimistic test-only behavior.

The first implementation must add explicit idempotent command variants where current P0 methods are not safe enough to call directly.

### Automation Daemon Is A Sidecar

Add an `automation-daemon` process or app that can run independently from the API. Its responsibilities:

- scan or subscribe to eligible ForgeLoop objects;
- compute the next safe action;
- execute approved automatic actions through control-plane command boundaries;
- record every attempt;
- back off or escalate when blocked.

The daemon must be disabled by default until configured. It must be safe to run multiple instances as long as action idempotency and repository fencing are respected.

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

### Automation Capability Configuration

Automation capability settings are control-plane-owned product configuration, not repo runtime policy.

Add an `automation_project_settings` object or equivalent scoped by project/repo.

Minimum fields:

- `id`
- `project_id`
- `repo_id`
- `preset`
- `capabilities_json`
- `capability_fingerprint`
- `scope_type`: `project | repo`
- `version`
- `enabled_by`
- `enabled_at`
- `updated_by`
- `updated_at`
- `reason`
- `evidence_refs`

Required commands:

- `setAutomationCapabilities(projectId, repoId, preset, explicitCapabilities, expectedVersion, reason, evidenceRefs, actorContext)`
- `disableAutomation(projectId, repoId, expectedVersion, reason, evidenceRefs, actorContext)`

Rules:

- production/default project behavior resolves to `off` when no settings row exists;
- local dogfood may seed `draft_only` only through explicit local/dev configuration or fixture data, never through repo policy;
- `run_enqueue` must be enabled through an audited control-plane command by an authorized human/admin actor;
- non-human system updates are allowed only for explicit fixture, migration, or deployment bootstrap paths with audit evidence and must not use the automation daemon identity;
- automation daemon identities, source adapter identities, repo policy, and external tracker identities must be rejected for capability updates;
- capability updates must be versioned/CAS-protected and recorded in status history or audit log;
- repo runtime policy, `WORKFLOW.md`, source adapters, and external trackers must not set or broaden `canGeneratePlanDraft`, `canGeneratePackageDrafts`, or `canEnqueueRuns`;
- planner input must include the resolved automation scope, `repo_id` when repo-scoped, `automation_settings_version`, and `capability_fingerprint`;
- for Work Item/Spec/Plan actions in multi-repo projects, planner must either resolve one unambiguous repo scope from the Work Item/package context or return `automation_gate_blocked` until a repo scope is selected;
- mutating commands must re-read automation settings in the same transaction/object lock before side effects and reject if capabilities were disabled, downgraded, or moved to a different repo scope after the daemon claimed the action;
- `NextAction` idempotency keys for mutating actions must include `automation_settings_version` and `capability_fingerprint`;
- `automation_settings_version` and `capability_fingerprint` are part of the action precondition fingerprint for any action whose authorization depends on automation capabilities.

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

Future Linear/GitHub/Jira integrations use `WorkItemSourceAdapter`. They may create intake candidates, attach source links, and propose metadata updates through ForgeLoop commands. They must not replace Execution Package, RunSession, ReviewPacket, or Release as first-class objects.

External source adapters must not directly mutate:

- Work Item phase, gate, resolution, or lifecycle status;
- Spec/Plan approval state;
- current Spec, Plan, Release, or revision pointers;
- Execution Package readiness, run, review, test, integration, or release state;
- Release gates, rollout decisions, or observation state.

Any external update that would change a lifecycle or gate must become a ForgeLoop reviewable proposal or a Work Item intake event, then pass through the same control-plane commands as a native ForgeLoop action.

### Manual Path And Automation Holds

The PRD requires human override in exceptional cases. Automation escalation must be modeled as an object-level hold, not only as a log message.

Add a `manual_path_holds` concept for Work Items, Spec/Plan revisions, Execution Packages, RunSessions, ReviewPackets, and Release gates.

Required commands:

- `requestManualPath(objectType, objectId, scopeKey, reasonCode, reason, evidenceRefs, requestedBy, idempotencyKey, sourceAutomationActionId?, automationPrecondition?)`
- `resolveManualPath(holdId, resolution, resolvedBy, evidenceRefs)`

Minimum fields:

- `id`
- `object_type`
- `object_id`
- `scope_key`
- `status`: `active | resolved | cancelled`
- `reason_code`
- `reason`
- `source_automation_action_id`
- `evidence_refs`
- `requested_by`
- `requested_at`
- `resolved_by`
- `resolved_at`
- `resolution`
- `metadata_json`

Uniqueness:

- at most one active hold per `(object_type, object_id, scope_key)`.
- globally unique daemon-origin `source_automation_action_id` when present, or an equivalent command idempotency record keyed by `idempotencyKey`.

Canonical `scope_key` values:

- `work_item:<work_item_id>`
- `spec_revision:<spec_revision_id>`
- `plan_revision:<plan_revision_id>`
- `package_generation:<plan_revision_id>:<generation_key>`
- `execution_package:<execution_package_id>`
- `run_session:<run_session_id>`
- `review_packet:<review_packet_id>`
- `release_gate:<release_id>:<gate_key>`

Required behavior:

- a manual-path hold suppresses daemon mutation on the held object and any dependent lower-level objects;
- dependency propagation must be explicit: a Work Item hold blocks Spec/Plan/package/run/review/release automation beneath it; a PlanRevision hold blocks package generation and run enqueue for packages derived from it; an ExecutionPackage hold blocks run enqueue and release-readiness projection for that package; a RunSession hold blocks daemon escalation beyond projection;
- projection-only actions may still surface status while a hold is active;
- holds must record actor, reason code, human-readable reason, source automation action id when applicable, evidence refs, created/resolved timestamps, and resolution;
- resolving a hold must be explicit and audited;
- `requestManualPath` must validate that `scopeKey` is canonical for the target object/scope and reject mismatched composite scopes;
- when the daemon requests a hold, `requestManualPath` must require `automationPrecondition` and re-read automation settings/version/fingerprint in the same transaction before creating the hold;
- `requestManualPath` must participate in command idempotency: duplicate `idempotencyKey` or duplicate daemon-origin `sourceAutomationActionId` must return the original hold/result, even if the hold has since been resolved;
- daemon may request a hold through `requestManualPath`, but it cannot clear its own manual-path hold without an authorized human/admin command or explicit bootstrap/migration system command approved for that purpose;
- runtime snapshot must expose public-safe hold state and reason code.

The planner and command boundaries must check active holds before every mutating action. Held, closed, archived, superseded, or otherwise terminal Work Items are not eligible for daemon-generated Plans, daemon-generated Packages, or run enqueue.

Active-hold lookup by action:

- `generate_plan_draft`: Work Item and current SpecRevision scope;
- `generate_execution_packages`: Work Item, current SpecRevision, current PlanRevision, and package generation scope;
- `enqueue_package_run`: Work Item, current SpecRevision, current PlanRevision, ExecutionPackage, relevant package generation scope, existing active RunSession scope if present, open ReviewPacket scope if present, and relevant Release gate scope;
- `escalate_manual_path`: target object scope plus Work Item ancestor scope; existing active hold makes the action idempotent;
- `notify_review_ready`: ReviewPacket, ExecutionPackage, Work Item, and relevant Release gate scope;
- `project_runtime_snapshot`: may read holds but must not mutate held objects;
- `release_readiness_projection`: Work Item, ExecutionPackage, ReviewPacket, Release, and Release gate scopes.

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
- resolve the policy source file under the canonical repo root using segment-by-segment symlink checks;
- reject absolute policy source paths, outside-repo paths, symlink escapes, root-equal policy paths, and policy-relative paths that escape the canonical repo root;
- store public `policy_source_path` values as repo-relative POSIX paths only.

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

Planner tests must be exhaustive because this is where PRD gate correctness lives.

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

Adapter contract:

- emit `WorkItemIntakeCandidate` records;
- attach external source links;
- propose title/body/priority/risk metadata through reviewable ForgeLoop commands;
- never write lifecycle state directly;
- never approve or change current Spec/Plan/Release pointers;
- never trigger ExecutionPackage readiness or run enqueue directly.

The adapter output is input to ForgeLoop's Work Item intake and triage flow, not an alternate workflow engine.

### RuntimeSnapshotProjector

Builds a PRD-first runtime view:

- queued/running/stalled/retrying RunSessions;
- active worker leases, heartbeat, expiry;
- driver kind and public-safe `fallback_reason_code`;
- last event cursor and time;
- retry count;
- ReviewPacket status;
- package dependency blockers;
- automation action status;
- policy digest and last-known-good state.

This feeds a query route and eventually the web workbench.

## Data Model Additions

### automation_project_settings

Control-plane-owned automation capability configuration as defined in `Automation Capability Configuration`.

Durable storage must enforce one active settings row per `(project_id, repo_id)` or an equivalent current pointer. Updates must be versioned and audited. The in-memory repository must enforce the same CAS behavior.

### manual_path_holds

Object-level manual override state as defined in `Manual Path And Automation Holds`.

Durable storage must enforce active-hold uniqueness per `(object_type, object_id, scope_key)`. Hold reads used by planner and command boundaries must participate in the same transaction/object-lock rules as other gate reads. The in-memory repository must enforce the same behavior.

### command_idempotency_records

Stores authoritative command idempotency at the control-plane boundary.

Minimum fields:

- `id`
- `command_name`
- `idempotency_key`
- `target_object_type`
- `target_object_id`
- `target_revision_id`
- `target_version`
- `precondition_json`
- `precondition_fingerprint`
- `actor_scope`
- `result_json`
- `status`: `running | succeeded | failed | skipped | blocked`
- `locked_until`
- `last_heartbeat_at`
- `claim_token`
- `created_by`
- `started_at`
- `finished_at`
- `created_at`
- `updated_at`

Uniqueness:

- globally unique `idempotency_key`

The durable repository must implement this with transaction/object-lock semantics. The in-memory repository must mirror conflict behavior with a mutex or critical section so tests cover the same races.

Status protocol:

1. command entry starts by looking up, inserting, or claiming the raw `idempotency_key` inside the same transaction/critical section as target-object precondition reads;
2. the command computes a deterministic `precondition_fingerprint` from command name, target object type/id, target revision/version, actor scope where relevant, and normalized precondition JSON;
3. if an existing idempotency record has the same key but different command name, target object, target revision/version, actor scope, or `precondition_fingerprint`, reject with `command_idempotency_conflict`;
4. if a matching `succeeded`, `skipped`, or non-retryable `blocked` record exists, return its stored `result_json` without re-running side effects;
5. if a matching `running` record is held by another live claim, return or throw a deterministic idempotency conflict instead of running in parallel;
6. long-running command work must renew `locked_until` and `last_heartbeat_at` with the current `claim_token`; an expired command lock may be reclaimed only after re-reading the target object, validating preconditions, and checking persisted side effects;
7. command implementations that cannot safely renew while doing external work must split long generation into a persisted generation job and use command idempotency only for short DB finalization;
8. terminal command results must store the stable created/returned object ids in `result_json`;
9. terminal failures that occurred before any side effect may be retryable; failures after an unknown side effect must become `blocked` and require manual reconciliation unless the command can prove the previous side effect from persisted state.

### product row versions

Mutable product rows that participate in automation compare-and-set need explicit monotonic versions. At minimum:

- `execution_packages.version`
- `plans.version` or equivalent command precondition on current revision id
- `work_items.version` or equivalent command precondition on current Spec/Plan pointers

`updated_at` is not sufficient for multi-process CAS.

Run enqueue must lock or CAS every mutable relation it uses as a gate, not only `execution_packages.version`.

The enqueue command transaction must cover, in a deterministic lock order:

1. command idempotency record claim for the raw idempotency key;
2. automation settings row/version/fingerprint for the resolved scope;
3. Work Item row/current Spec and Plan pointers;
4. ExecutionPackage row/version;
5. dependency rows for the package;
6. active manual-path holds in the relevant dependency scope;
7. release/package links and release blocker rows that can forbid execution;
8. ReviewPacket rows for the package;
9. RunSession rows for the package;
10. terminal command idempotency status, product status, and event writes.

Durable storage may satisfy this through row locks plus partial unique constraints or serializable transactions. The in-memory repository must model the same lock order with critical sections so race tests exercise the same behavior.

### package generation identity

Package generation for a PlanRevision can validly create multiple packages. The spec requires deterministic identity for the package set.

Add `execution_package_generation_runs` or an equivalent package-set manifest.

The default `generation_key` must be stable for the PlanRevision generation scope, for example `default:<plan_revision_id>`. It must not include `generator_version`, `policy_digest`, `manifest_digest`, timestamps, or daemon identity. Those values are manifest fields checked for drift, not key material.

Minimum generation-run fields:

- `execution_package_set_id`
- `plan_revision_id`
- `generation_key`
- `generator_version`
- `policy_digest`
- `manifest_digest`
- `expected_package_count`
- `expected_package_keys`
- `status`
- `result_json`
- `locked_until`
- `last_heartbeat_at`
- `claim_token`

Minimum package fields:

- `execution_package_set_id`
- `execution_package_version`
- `plan_revision_id`
- `generation_key`
- `package_key`
- `sequence`
- `manifest_digest`

Uniqueness:

- unique `(plan_revision_id, generation_key)`
- unique `(plan_revision_id, generation_key, package_key)`
- at most one current/succeeded package generation set per `plan_revision_id`

Generation protocol:

1. create or claim the generation-run row before inserting package rows;
2. compute `expected_package_keys`, expected count, and `manifest_digest` before package insertion;
3. reject a retry where `generator_version`, `policy_digest`, expected keys/count, or `manifest_digest` differ for the same `(plan_revision_id, generation_key)`;
4. insert package rows idempotently by deterministic `package_key`;
5. finalize the generation run only after all expected package rows exist and match the manifest;
6. resume after partial creation by reading the generation-run manifest, filling missing package rows, and returning the same package set;
7. a crash or generator change must not mix package rows from two manifests under one generation key;
8. creating a new generation key for the same PlanRevision requires an explicit human-approved regenerate/supersede command that marks the previous set superseded and records reason/evidence.

`ExecutionPackage.version` is the CAS value for readiness and enqueue commands. Revision ids identify Spec/Plan/package content lineage; `version` identifies the mutable package row state used by command preconditions.

Packages generated before Phase 1 runtime policy snapshot support must be marked `policy_snapshot_missing` or equivalent. They may remain draft candidates, but readiness and `run_enqueue` must be blocked until policy snapshots, validation strategy, checks, and path policy are generated, reviewed, frozen, and CAS-saved, or until packages are regenerated under the current package policy model.

### active run and open review uniqueness

Durable storage must enforce:

- at most one active RunSession per ExecutionPackage;
- at most one open ReviewPacket per ExecutionPackage.

Active RunSession statuses:

- `queued`
- `running`
- `waiting_for_input`
- `stalled`
- `resuming`
- `cancel_requested`

Open ReviewPacket statuses:

- `draft`
- `ready`
- `in_review`
- `escalated`

These statuses are blocking/open for daemon rerun decisions unless a migration makes one of them impossible before daemon rollout. The durable implementation must use partial unique indexes or an equivalent serializable constraint over the persisted enum values. The in-memory repository must enforce the same conflict behavior.

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

Minimum fields:

- `id`
- `action_type`
- `target_object_type`
- `target_object_id`
- `target_revision_id`
- `target_status`
- `idempotency_key`
- `automation_scope`
- `automation_settings_version`
- `capability_fingerprint`
- `status`: `pending | running | gate_pending | succeeded | failed | skipped | blocked`
- `claim_token`
- `attempt`
- `locked_until`
- `last_heartbeat_at`
- `next_attempt_at`
- `retryable`
- `result_json`
- `metadata_json`
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

1. Planner computes `idempotency_key` from action type, target id, target revision id, target status, automation scope, `automation_settings_version`, `capability_fingerprint`, and policy digest when relevant.
2. Executor inserts or claims `automation_action_runs` before any side effect.
3. Claim must be transactional: only one daemon can transition an action from claimable state to `running` with a fresh `claim_token`.
4. Side effects may run only while the caller owns the current `claim_token`.
5. Terminal transitions require the same `claim_token`.
6. Expired locks may be reclaimed by a later daemon attempt, incrementing `attempt`.
7. Terminal `succeeded`, permanent `skipped`, and non-retryable `blocked` rows must suppress duplicate side effects for the same key.
8. Long actions must renew `locked_until` and `last_heartbeat_at`; another daemon may reclaim only after lock expiry.
9. Retries must honor `retryable` and `next_attempt_at`.
10. Before repeating side effects, a reclaimed action must check the authoritative command idempotency record and return existing results where possible.

Gate blocker semantics:

- transient blockers such as dependency not satisfied, open review, active run, active hold, or release blocker that can change without package version changes must use `gate_pending` or retryable `blocked` with `next_attempt_at`;
- permanent `skipped` is reserved for already-advanced or structurally inapplicable actions, such as an existing PlanRevision for the same SpecRevision or an already-created package set for the same manifest;
- `enqueue_package_run` must not terminally skip only because a transient gate is present unless the idempotency key includes the relevant blocker-state version that will change when the blocker resolves.

Claimable states:

- `pending` with no owner;
- expired `running`;
- due `gate_pending` when `next_attempt_at <= now`;
- retryable `blocked` when `next_attempt_at <= now`;
- retryable `failed` when `next_attempt_at <= now`.

Reclaiming any claimable non-terminal state must increment `attempt`, write a new `claim_token`, update `claimed_at`, and re-read planner inputs including automation settings version/fingerprint before side effects. Planner/executor recovery queries must include due `gate_pending`, retryable `blocked`, and retryable `failed` rows.

This protocol is required before running multiple daemon instances or before enabling `run_enqueue`.

The claim protocol does not replace product-object idempotency. It prevents duplicate daemon workers, but the control-plane command still must protect against a concurrent manual/API request operating on the same target object.

### effective_runtime_policy_snapshot

Do not add a standalone table in the first phase unless implementation proves it necessary.

Record on `ExecutionPackage` metadata or an equivalent package policy snapshot:

- `policy_digest`
- `policy_source_path`
- `policy_loaded_at`
- `policy_last_known_good`
- `policy_snapshot_status`: `captured | missing | stale | superseded`
- frozen hook specs;
- frozen command/check policy;
- frozen env policy;
- frozen Codex runtime mode;
- fallback policy.
- frozen validation strategy fields, including `validation_strategy`, `validation_strategy_version`, `validation_public_summary`, and validation evidence refs.

Record on `RunSession.runtime_metadata`:

- `policy_digest`
- `policy_source_path`
- `policy_loaded_at`
- `policy_last_known_good`
- `package_policy_digest`

For generated ExecutionPackages, policy-derived defaults must be copied into the package at generation time and then frozen through existing approval/readiness flows.

At run enqueue/start time, the command must compare the package's frozen policy digest with the RunSession policy digest. If the repository policy has changed, the run still uses the frozen package snapshot. A digest mismatch caused by an attempted mutable policy override must block the run with `policy_digest_mismatch` unless the package is regenerated/reviewed or a human-approved command explicitly updates the frozen package policy.

## Automation Rules

### Spec Approved To Plan Draft

If a Work Item has an approved current Spec and no current Plan draft, daemon may generate Plan draft only when `canGeneratePlanDraft` is true and the Work Item is automation-eligible.

Required eligibility:

- Work Item is not closed, archived, cancelled, superseded, released, or in another terminal/resolved phase;
- Work Item phase/gate permits Plan drafting under the PRD state machine;
- no active manual-path hold exists on the Work Item or current SpecRevision;
- current SpecRevision is still the Work Item's approved current Spec revision.

Command sequence:

1. claim `generate_plan_draft` using key `generate_plan_draft:<work_item_id>:<spec_revision_id>:<automation_scope>:<automation_settings_version>:<capability_fingerprint>`;
2. re-read Work Item, current Spec, active holds, lifecycle state, and existing Plans inside the action transaction or immediately after claim;
3. call an idempotent control-plane command equivalent to `ensurePlanDraftForApprovedSpec(workItemId, specRevisionId, automationPrecondition, idempotencyKey)`;
4. the command may internally create the Plan, then create/generate the draft PlanRevision;
5. mark the action `succeeded` only after the new PlanRevision is persisted.

If a Plan already exists with a draft/current revision for the same approved Spec context, the action must become `skipped`, not generate a duplicate.

Current `createPlan(workItemId)` and `generatePlanDraft(planId)` style commands are not sufficient unless wrapped in a command that atomically checks the approved Spec revision and returns an existing Plan/PlanRevision on duplicate calls.

Generated PlanRevisions must store `based_on_spec_revision_id`. Duplicate detection must use typed revision fields, not timestamps or ad hoc `structured_document` fields.

It must not approve the Plan.

### Plan Approved To Execution Packages

If a Work Item has approved current Plan and no generated Execution Packages for that Plan revision, daemon may generate package drafts only when `canGeneratePackageDrafts` is true and the Work Item/Plan scope is automation-eligible.

Required eligibility:

- Work Item is not closed, archived, cancelled, superseded, released, or in another terminal/resolved phase;
- Work Item phase/gate permits package drafting under the PRD state machine;
- no active manual-path hold exists on the Work Item, current SpecRevision, current PlanRevision, or relevant package generation scope;
- current PlanRevision is still the Work Item's approved current Plan revision.

Command sequence:

1. claim `generate_execution_packages` using key `generate_execution_packages:<work_item_id>:<plan_revision_id>:<automation_scope>:<automation_settings_version>:<capability_fingerprint>`;
2. re-read Work Item lifecycle state, active holds, current Spec, current Plan, and packages for the PlanRevision;
3. call an idempotent control-plane command equivalent to `ensureExecutionPackageDraftsForPlanRevision(planRevisionId, automationPrecondition, idempotencyKey)`;
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

Package generation must use a deterministic generation key and per-package keys. A retry after partial package creation must resume or return the same package set, not create a second package set.

First implementation must not auto `mark-ready` generated packages.

### Ready ExecutionPackage To Queued RunSession

Daemon may enqueue a run only when `canEnqueueRuns` is true and all of the following are true:

- Work Item is not closed, archived, cancelled, superseded, released, or in another terminal/resolved phase;
- Work Item phase/gate permits ExecutionPackage execution under the PRD state machine;
- Spec is approved;
- Plan is approved;
- the Work Item's current approved Spec revision matches `ExecutionPackage.spec_revision_id`;
- the Work Item's current approved Plan revision matches `ExecutionPackage.plan_revision_id`;
- ExecutionPackage is ready;
- validation strategy is run-eligible: `checks_required` requires non-empty required checks; `allow_all_repo` requires reviewed approval/evidence; `custom` requires a frozen reviewed validation contract;
- allowed/forbidden paths are frozen;
- dependency packages are satisfied;
- no active/open RunSession exists for the package;
- no open ReviewPacket is waiting for human review;
- package is not already linked to a blocked release gate that forbids new execution.
- no `enqueue_package_run` action with the same package id and package revision/status has already succeeded or is currently claimed.
- no manual-path hold is active on the package, run, Work Item, current SpecRevision, current PlanRevision, or relevant release gate.

Command sequence:

1. claim `enqueue_package_run` using key `enqueue_package_run:<execution_package_id>:<package_version>:<executor_type>:<workflow_only>:<automation_scope>:<automation_settings_version>:<capability_fingerprint>`;
2. re-read Work Item lifecycle/gate state, current Spec/Plan pointers, active holds, package, current open RunSessions, ReviewPackets, dependencies, and release blockers after claim;
3. if any transient run/review/dependency/hold/release blocker appears, mark action `gate_pending` or retryable `blocked`; use permanent `skipped` only for already-advanced or structurally inapplicable outcomes;
4. call an idempotent control-plane command equivalent to `enqueueRunIfPackageStillReady(packageId, expectedPackageVersion, automationPrecondition, idempotencyKey, actorContext)`;
5. record returned `run_session_id` in action metadata before marking `succeeded`.

`run_enqueue` must be disabled by default. Planner tests must prove ready packages do not enqueue without this explicit level.

The run enqueue command must be atomic against manual/API callers. It must reject or return an existing active RunSession if the package already has an active/open RunSession or open ReviewPacket. A durable implementation must enforce this with repository compare-and-set and partial unique guards for non-terminal runs and open reviews per ExecutionPackage. The in-memory implementation must enforce the same guard in a critical section.

Stale packages must be blocked with `stale_execution_package_revision`, not run. The remediation is to regenerate/update the package from the current approved Spec/Plan or explicitly supersede/archive it through a human-approved command.

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

First implementation must not automatically create or close Releases. Later phases may project or propose Work Item/Package aggregate readiness for Release Owner, but release decisions remain explicit.

Daemon release-readiness behavior is projection/proposal-only. Integration Validation, Test Gate, Release Gate, rollout, and observation gate-passing commands must reject automation daemon actors, source adapter actors, repo-policy actors, and external tracker actors. The daemon must not directly set Work Item/Package release-ready lifecycle state, Integration gate pass/fail, Test gate pass/fail, Release gate state, rollout decision, or observation completion.

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

Required behavior:

- policy source path and policy-relative paths resolve relative to the canonical repo root or policy file directory, then must be proven under the canonical repo root by `PathSafety`;
- policy-relative paths must be rejected on symlink escape, absolute path, outside-repo normalization, root equality where a file/directory target is expected, null bytes, or control characters;
- invalid reload keeps last-known-good;
- invalid initial load blocks daemon unless deployment config explicitly allows audited safe-default mode;
- reload failure records an internal event and automation action diagnostic;
- every RunSession records the policy digest it used;
- policy changes do not mutate already approved/frozen ExecutionPackage boundaries.

Frozen fields:

- `required_checks`
- `allowed_paths`
- `forbidden_paths`
- `validation_strategy`
- package objective once approved/ready;
- package dependencies once ready.

Policy-derived runtime fields:

- Codex command/runtime hints;
- hook commands/timeouts;
- observability/raw log hints;
- prompt policy appended to execution context if package generation captured it.

These fields may change only for future package generation or explicitly re-approved package policy updates. They are not mutable for an already approved/ready ExecutionPackage or an already queued RunSession.

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

### Path Policy Semantics

`allowed_paths` and `forbidden_paths` must be typed `PathPolicy` entries, not prefix strings.

ExecutionPackage validation strategy fields:

- `validation_strategy`: `checks_required | allow_all_repo | custom`
- `validation_rationale`
- `validation_approved_by`
- `validation_approved_at`
- `validation_evidence_refs`
- `validation_public_summary`
- `validation_strategy_version`

Rules:

- `checks_required` is the default;
- `checks_required` is run-eligible only when required checks are non-empty and frozen;
- `allow_all_repo` is allowed only by explicit human-reviewed approval and must be represented in the package policy snapshot and command preconditions;
- `custom` must carry explicit allowed/forbidden checks or an alternative validation contract that is reviewable and frozen before run enqueue;
- validation strategy changes are CAS-protected and require package re-read before run enqueue;
- public runtime views expose only `validation_strategy` and safe summary, not free-form rationale.

Policy validation:

- accept only repo-relative POSIX patterns using `/` separators;
- reject absolute paths, empty patterns, `.` as a whole-workspace pattern, `..` segments, backslashes, null bytes, and ASCII control characters;
- reject patterns that normalize to outside the repository root;
- reject ambiguous trailing whitespace and normalize duplicate slashes before storage;
- compile patterns with a real glob engine such as minimatch/picomatch, using the normative options below.

Match semantics:

- normalize changed file paths to canonical Git-style repo-relative POSIX paths before matching;
- evaluate both old and new paths for rename/move operations;
- `forbidden_paths` take precedence over `allowed_paths`;
- if `allowed_paths` is non-empty, at least one allowed pattern must match every changed path;
- if `allowed_paths` is empty, the package must carry a reviewed `validation_strategy` before it can be run;
- generated packages may propose path policy, but readiness must freeze reviewed path policy before `run_enqueue`.

Path policy is a source mutation boundary. It does not authorize command execution, artifact writes, hook paths, or workspace cleanup paths.

Normative glob options:

- matching is case-sensitive on all platforms;
- dotfiles are matched only by patterns that explicitly include a dot segment, for example `.github/**`;
- `**` globstar is enabled for path segments;
- extglob, brace expansion, and pattern negation are disabled;
- leading `!` is rejected rather than interpreted as negation;
- directory patterns must be explicit: `src/**` matches descendants; `src` matches only the path named `src`;
- root-wide patterns `*`, `**`, `**/*`, and equivalent normalized forms are rejected unless the package has a human-reviewed `allow_all_repo` validation strategy;
- trailing slash has no special authorization meaning and is normalized or rejected consistently before compile;
- tests must pin the chosen glob library and options so a dependency upgrade cannot silently change policy behavior.

Worktree rules:

- keep `.worktrees/<run-session-id>`;
- use sanitized run session safe segment;
- verify canonical workspace path is below canonical `.worktrees` root;
- before deletion or recreation, verify target is not root and does not escape root;
- record workspace path only in runtime metadata, and do not expose it publicly.

### Command, Check, And Hook Execution Model

Checks and hooks must execute from structured specs or approved templates, not arbitrary shell strings.

Command spec shape:

- `executable`
- `args`
- `cwd_policy`
- `env_policy`
- `timeout_ms`
- `output_limit_bytes`
- `stdin_policy`
- `shell`: default `false`

Execution rules:

- use `execFile`/`spawn` with argument arrays by default;
- `executable` must be either a bare command resolved through the controlled `PATH` allowlist or an explicitly allowlisted repo-relative tool path;
- absolute executable paths and arbitrary relative executable paths are rejected unless they appear in an approved command template allowlist;
- repo-relative executable paths must be canonicalized with `PathSafety`, must not escape the repo, and must not resolve through an unapproved symlink;
- pass a sanitized environment allowlist, including a controlled `PATH` built from approved tool directories only;
- allowed `cwd_policy` values for first implementation are `workspace_root` and approved repo-relative subdirectories validated by `PathSafety`; parent-process cwd inheritance is forbidden;
- set `cwd` only through validated `cwd_policy`, normally the canonical workspace root;
- apply mandatory timeout, output byte, CPU, memory, process-count, file-descriptor, workspace-disk, and artifact-size limits with configured defaults and non-bypassable platform maximums;
- first implementation defaults: command timeout no more than 10 minutes, hook timeout no more than 2 minutes, per-command output limit no more than 1 MiB, per-run aggregate captured output/artifact-text limit no more than 10 MiB;
- a human-approved policy snapshot may set lower limits or explicitly reviewed higher per-command/per-run soft limits, but it must not exceed the platform hard maximums enforced by OS/container/cgroup/rlimit or an equivalent sandbox/resource governor;
- if the current deployment cannot enforce CPU, memory, process-count, fd, workspace-disk, and artifact-size hard limits, `run_enqueue` must remain disabled and command/check/hook execution must be limited to local/dev paths explicitly marked unsafe for production;
- output must be truncated while streaming, not only after process exit;
- on timeout, kill the process group or equivalent child-process tree, then mark the check/hook with a deterministic timeout error;
- deny shell metacharacters and `shell: true` unless the command comes from an explicitly approved template that records why shell execution is required;
- never interpolate untrusted Work Item, package, branch, file path, or policy text into a shell command;
- classify command template validation failures as non-retryable policy errors.

Approved templates may render structured args from package data only through typed placeholders that validate and escape by data type. Free-form string substitution is not allowed for first implementation.

Check execution rules:

- run required checks with `cwd` set to canonical workspace path;
- verify cwd invariant before and after each command;
- forbidden commands fail with non-retryable policy error;
- command output is stored as internal artifacts by default; public exposure requires `visibility: public_safe` plus content redaction/scanning.

Hook rules:

- support `before_run` and `after_run` first;
- later add `after_create` and `before_remove` if needed;
- `before_run` failure blocks run;
- `after_run` failure is logged but does not overwrite terminal run status;
- hook timeout is mandatory;
- hook output is truncated for logs;
- hook artifacts are internal by default unless explicitly public-safe.

### Codex App-Server Fallback Policy

Codex app-server continuity is preferred when available. Exec fallback must be policy-approved instead of silently broadening runtime behavior.

Policy fields:

- `allow_exec_fallback`
- `allowed_fallback_modes`: for example `start_new_turn`, `resume_existing_thread`
- `require_dangerous_mode_confirmation`
- `fallback_env_policy`
- `fallback_cwd_policy`
- `fallback_reason_visibility`

Rules:

- if app-server startup/resume fails and `allow_exec_fallback` is false, the RunSession must stall or request manual path with a public-safe reason code;
- fallback may not inherit arbitrary parent process env or cwd;
- fallback must use the same frozen package policy digest and command execution restrictions as normal runtime;
- dangerous mode, broad filesystem access, or network broadening requires an explicit human-approved command or pre-approved policy setting captured in the package snapshot;
- fallback reason details, stderr, auth errors, and config paths are internal by default and must be redacted before runtime snapshot or public evidence serialization.

### Artifact And Runtime Content Visibility

Runtime content must be internal by default.

Internal by default:

- check stdout/stderr;
- hook stdout/stderr;
- raw Codex logs and event streams;
- fallback reasons and driver errors;
- automation action `error_message`, `result_json`, and diagnostic metadata;
- command idempotency `result_json` when it includes runtime paths, tool output, or exception details;
- policy parse/validation diagnostics that may include file paths or secret-like values.

Public exposure requires an explicit `visibility: public_safe` marker plus redaction/scanning through the same policy used by public evidence serialization. Runtime snapshots may expose status, reason codes, object ids, timestamps, policy digests, and safe summaries, but not raw content.

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
- raw lease metadata;
- raw `automation_action_runs.result_json`, `metadata_json`, or `error_message`;
- raw command idempotency results;
- free-text fallback reasons or driver stderr;
- secrets from policy, hooks, env, or command output.

`GET /query/runtime` and any public query surface must return redacted DTOs only. They may expose status, object ids, timestamps, safe reason codes, safe summaries, and policy digests. They must not expose raw internal JSON blobs.

## API And Process Boundaries

Potential command additions are explicit and narrow:

- `POST /automation/refresh` for manual daemon scan trigger in local/dev mode.
- `GET /automation/action-runs` for internal/admin inspection only, with explicit auth and fail-closed DTO redaction.
- `GET /query/runtime` for product/operator runtime view.

The automation daemon may also operate directly on repository interfaces in-process, but every state change must share the same command/domain logic used by `control-plane-api`.

New or revised command boundaries required before daemon mutation:

- `setAutomationCapabilities(projectId, repoId, preset, explicitCapabilities, expectedVersion, reason, evidenceRefs, actorContext)`
- `disableAutomation(projectId, repoId, expectedVersion, reason, evidenceRefs, actorContext)`
- `requestManualPath(objectType, objectId, scopeKey, reasonCode, reason, evidenceRefs, requestedBy, idempotencyKey, sourceAutomationActionId?, automationPrecondition?)`
- `resolveManualPath(holdId, resolution, resolvedBy, evidenceRefs)`
- `ensurePlanDraftForApprovedSpec(workItemId, specRevisionId, automationPrecondition, idempotencyKey)`
- `ensureExecutionPackageDraftsForPlanRevision(planRevisionId, automationPrecondition, idempotencyKey)`
- `enqueueRunIfPackageStillReady(packageId, expectedPackageVersion, automationPrecondition, idempotencyKey, actorContext)`

`automationPrecondition` must include:

- `automation_scope`
- `project_id`
- `repo_id` when repo-scoped
- `automation_settings_version`
- `capability_fingerprint`
- required capability name
- actor class and daemon identity when applicable

These commands must be safe when called concurrently by:

- two daemon instances;
- daemon plus manual REST API caller;
- daemon plus test/dogfood script;
- repeated retry after daemon crash.

The command must be the final authority. `automation_action_runs` is audit and daemon coordination, not a substitute for object-level consistency.

Mutating commands must enforce the same lifecycle, active-hold, and gate preconditions as the planner. Planner eligibility is an optimization and explanation surface, not an authorization boundary.

## Error Handling

Error classes:

- `policy_missing`
- `policy_parse_failed`
- `policy_validation_failed`
- `policy_reload_failed`
- `automation_duplicate_action`
- `automation_claim_conflict`
- `automation_lock_expired`
- `automation_capability_disabled`
- `automation_capability_conflict`
- `command_idempotency_conflict`
- `command_revision_mismatch`
- `automation_precondition_failed`
- `automation_gate_blocked`
- `automation_gate_pending`
- `manual_path_hold_active`
- `work_item_not_automation_eligible`
- `stale_execution_package_revision`
- `policy_digest_mismatch`
- `path_policy_invalid`
- `workspace_path_escape`
- `workspace_symlink_escape`
- `workspace_equals_root`
- `command_template_invalid`
- `command_timed_out`
- `hook_failed`
- `hook_timed_out`
- `forbidden_command`
- `exec_fallback_not_allowed`
- `artifact_visibility_violation`
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
- automation capability settings default to `off` in production and local dogfood `draft_only` requires explicit local/dev config;
- automation capability updates require authorized actor, reason, evidence, audit, and version CAS;
- repo runtime policy and source adapters cannot set automation capabilities;
- `NextAction` and command precondition fingerprints include automation scope, settings version, and capability fingerprint;
- capability disable/downgrade after action claim blocks side effects;
- path canonicalization;
- symlink escape;
- workspace root equality rejection;
- stale non-directory cleanup guard;
- artifact root guard;
- policy source path and policy-relative paths reject absolute, outside-repo, root-equal, and symlink-escape targets;
- PathPolicy validation rejects absolute, empty, `..`, backslash, control-byte, root-wide patterns, leading `!`, extglob, and brace expansion;
- PathPolicy options are case-sensitive, explicit-dotfile, globstar-enabled, negation-disabled, and directory-pattern behavior is pinned;
- PathPolicy matching uses Git-style normalized paths and checks both old/new rename paths;
- forbidden path policy takes precedence over allowed policy;
- structured command specs reject shell strings, shell metacharacters, unapproved absolute executables, unapproved relative executables, and executable symlink escapes by default;
- command templates render typed args without free-form string interpolation;
- command timeout kills child process tree and records bounded streaming output;
- default and maximum timeout/output caps are enforced per command and per run;
- CPU, memory, process-count, file-descriptor, workspace-disk, and artifact-size hard limits are enforced or `run_enqueue` remains disabled;
- sanitized env/PATH does not inherit unapproved variables;
- cwd policy permits only canonical workspace root or approved repo-relative subdirectories;
- check cwd invariant;
- forbidden command policy;
- hook output/check output/fallback diagnostics are internal unless `visibility: public_safe`;
- exec fallback denied by policy stalls or manual-paths instead of changing runtime mode;
- automation planner action/no-op matrix;
- planner refuses held, closed, archived, cancelled, superseded, released, or otherwise terminal Work Items;
- idempotency key generation;
- action claim token and lock expiry behavior;
- action transient gate blockers use `gate_pending` or retryable `blocked`, not permanent `skipped`;
- due `gate_pending`, retryable `blocked`, and retryable `failed` rows are claimable after `next_attempt_at`;
- manual-path hold active uniqueness and dependency propagation;
- command idempotency status transitions and duplicate result replay;
- daemon-created manual-path holds require `automationPrecondition` and reject stale automation settings/fingerprint;
- duplicate daemon-origin manual-path hold requests replay the original hold result by `idempotencyKey` or `sourceAutomationActionId`;
- command idempotency rejects precondition fingerprint mismatch;
- command idempotency heartbeat/renewal or persisted generation-job split prevents overlapping long commands;
- idempotent command boundary duplicate-return behavior;
- object-lock / transaction helper rejects concurrent stale CAS writes;
- package generation manifest rejects generator/policy/manifest drift and resumes partial package sets;
- package generation default key is stable per PlanRevision and one current/succeeded set is allowed unless explicitly regenerated/superseded;
- validation strategy fields freeze reviewed `checks_required`, `allow_all_repo`, or `custom` strategy;
- `checks_required` with empty required checks is not run-eligible;
- `requestManualPath` validates canonical `scopeKey` including package-generation and release-gate composite scopes;
- action run status transitions.

### Integration Tests

Add integration coverage for:

- approved Spec generates Plan draft but not approval;
- held, closed, archived, cancelled, superseded, or released Work Items do not get daemon-generated Plans;
- approved Plan generates package draft/candidate but not automatic approval;
- active Work Item/Spec/Plan holds block package generation and dependent automation;
- manual-path holds resolve only through authorized human/admin command or explicit bootstrap/migration system command, and daemon cannot self-clear;
- `ready_projection` projects runtime state but never creates Plan drafts, package drafts, or runs;
- ready package does not enqueue by default;
- ready package enqueues only when `run_enqueue` is explicitly enabled and no blocker exists;
- claimed daemon actions stop before side effects if capabilities are disabled or downgraded concurrently;
- multi-repo Work Items without an unambiguous automation repo scope are blocked until scope is selected;
- packages generated before policy snapshot support cannot become ready or run until regenerated or explicitly reviewed with frozen policy snapshot;
- open ReviewPacket blocks rerun;
- `draft`, `ready`, `in_review`, and `escalated` ReviewPackets block rerun or are made impossible by migration before daemon rollout;
- daemon does not retry/resume recoverable RunSessions owned by run-worker;
- worker/daemon recovery races do not create duplicate RunSessions or duplicate resume attempts;
- two daemon instances cannot execute the same action side effect;
- daemon/manual Plan draft races return one Plan/PlanRevision;
- daemon/manual package generation races return one package set for a PlanRevision;
- daemon/manual run enqueue races return one active RunSession or a deterministic skipped result;
- enqueue command locks or CAS-checks dependency rows, release blockers, manual-path holds, RunSession rows, and ReviewPacket rows read as gates;
- ancestor/dependent holds block run enqueue and release-readiness projection;
- durable and in-memory repositories both enforce active RunSession and open ReviewPacket uniqueness;
- stale ExecutionPackage whose Spec/Plan revisions no longer match current approved Work Item revisions is blocked with `stale_execution_package_revision`;
- `enqueueRunIfPackageStillReady` uses `expectedPackageVersion` and rejects stale mutable package state;
- path violation escalates manual path and does not retry;
- RunSession records `policy_digest`;
- RunSession uses frozen package policy snapshot even after repo policy reload;
- mutable runtime policy override mismatch blocks with `policy_digest_mismatch`;
- exec fallback only runs when allowed by frozen policy and uses restricted env/cwd;
- raw check/hook logs and action diagnostics are absent from public runtime snapshot;
- `/automation/action-runs` is admin/internal only and redacts raw results unless explicitly authorized;
- policy reload does not mutate frozen package checks/paths;
- daemon release readiness is projection-only and cannot pass Integration/Test/Release gates;
- public run/session/runtime serialization strips local paths and raw metadata.
- validation strategy eligibility rejects empty required checks for `checks_required`, unapproved `allow_all_repo`, and unfrozen `custom` contracts.

### Smoke / Dogfood

Add a deterministic smoke path:

1. create Work Item;
2. approve Spec;
3. daemon generates Plan draft;
4. approve Plan;
5. daemon generates package draft;
6. mark package ready;
7. verify daemon does not enqueue RunSession while automation level is `draft_only`;
8. enable `run_enqueue` through audited control-plane capability command;
9. daemon enqueues RunSession;
10. run-worker completes mock or fake local path;
11. ReviewPacket becomes ready;
12. runtime snapshot shows terminal state without unsafe local data.

## Delivery Phases

### Phase 0: Command And Configuration Prerequisites

- `automation_project_settings` and audited capability update commands
- `manual_path_holds` and hold request/resolve commands
- `command_idempotency_records`
- product row versions/CAS fields
- package generation manifest identity
- active RunSession/open ReviewPacket uniqueness guards
- repository transaction/object-lock helpers for durable and in-memory repositories
- race tests for daemon/manual/API command boundaries

No daemon mutation beyond projection may ship before Phase 0 is complete.

### Phase 1: Runtime Safety And Policy

- `RepoRuntimePolicyLoader`
- policy digest in runtime metadata
- last-known-good behavior
- `PathSafety`
- typed `PathPolicy` validation and matching
- structured command/check/hook specs
- sanitized env/PATH and cwd policy
- timeout, process-tree kill, and output/artifact caps
- CPU, memory, process-count, file-descriptor, workspace-disk, and artifact-size hard limits through OS/container/cgroup/rlimit or equivalent sandbox/resource governor
- exec fallback policy
- artifact visibility/redaction model
- frozen package runtime policy snapshots
- hook timeout model
- check cwd invariant
- expanded executor tests

`run_enqueue` may not ship before Phase 1 is complete. Draft-only automation may ship after Phase 0 if it does not execute checks/hooks/Codex runtime.

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

Phase 2 mutating automation is blocked until Phase 0 command/configuration prerequisites exist and are race-tested. Phase 2 `run_enqueue` is additionally blocked until Phase 1 runtime safety prerequisites exist and are tested.

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
- Automation capabilities are control-plane-owned, audited, default-off, and cannot be broadened by repo runtime policy or source adapters.
- No automatic approval exists for Spec, Plan, ReviewPacket, or Release.
- Automatic run enqueue is disabled unless a project/repo explicitly enables `run_enqueue`.
- Daemon does not retry or resume live/recoverable RunSessions owned by run-worker.
- Automation presets map to explicit capabilities; `ready_projection` never mutates Plan, Package, or Run state.
- Active manual-path holds block daemon mutation across dependent object scopes and can be resolved only through authorized commands.
- Held or terminal/resolved Work Items cannot receive daemon-generated Plans, Packages, or runs.
- Control-plane command boundaries are idempotent/CAS-protected against daemon/manual/API races.
- Command idempotency replay validates target/precondition fingerprint and long-running commands cannot overlap after lock expiry.
- Package generation uses a deterministic manifest with generator version, policy digest, expected keys/count, and resume/finalize rules.
- Runtime policy affects execution runtime, not product lifecycle.
- Frozen ExecutionPackage boundaries cannot be changed by policy reload.
- Runtime policy source files and policy-relative paths cannot escape the canonical repo root and are public-exposed only as repo-relative paths.
- Workspace path safety rejects symlink escape, root equality, and outside-root paths.
- PathPolicy uses normative validated repo-relative POSIX glob semantics with forbidden precedence, explicit dotfile behavior, root-wide pattern control, and rename old/new path checks.
- Checks and hooks execute from structured command specs or approved templates, with controlled executable resolution, env/PATH, cwd, timeouts, process-tree kill, output caps, and hard resource quotas.
- Exec fallback is denied unless frozen runtime policy explicitly allows the fallback mode and safety envelope.
- Runtime artifacts, command output, hook output, fallback diagnostics, and automation errors are internal unless explicitly marked and scanned as `public_safe`.
- Required checks run only in canonical workspace cwd.
- Every automation action is idempotent, claimed before side effects, and auditable.
- Transient gate blockers do not permanently suppress future automation attempts.
- Command idempotency records persist terminal results and suppress duplicate side effects at the control-plane boundary.
- Durable and in-memory repositories enforce one active RunSession and one open ReviewPacket per ExecutionPackage.
- Runtime snapshot exposes operational status without leaking local paths or raw metadata.
- Daemon release readiness cannot pass Integration, Test, Release, rollout, or observation gates directly.
- Existing P0 delivery loop tests and dogfood flows continue to pass.

## Open Questions

- Should the repo-owned policy file remain `WORKFLOW.md`, or should ForgeLoop prefer a less process-loaded name such as `FORGELOOP.md` or `.forgeloop/runtime-policy.md`?
- Should Phase 1 introduce only `before_run/after_run` hooks, or include `after_create/before_remove` immediately?
- Should `automation-daemon` be a separate app package from day one, or start as a module within `control-plane-api` with a path to extraction?

## Decision

Proceed with a PRD-first automation daemon and runtime policy foundation. Use Symphony as an implementation reference for runtime safety, config reload, and observability, but keep ForgeLoop's PRD-defined object model and approval gates as the system of record.
