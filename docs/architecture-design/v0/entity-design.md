> Superseded historical migration note: this document mentions the old subsystem name for audit history only. Current commands, routes, files, and product docs use delivery terminology.

下面是一版**最终实体设计方案**。
它把我们前面讨论的几个关键结论都固化了：

* **Work Item 是跨角色业务主对象**
* **Spec / Plan 是定义对象，且必须 revision 化**
* **Execution Package 是执行主对象**
* **PlanRevision → ExecutionPackage 是 1-to-N，不是 1-to-1**
* **Release 是聚合交付对象**
* **Incident / Event / Artifact 支撑 replay 与 evolution**
* **状态采用“phase / activity / gate / resolution”分层，不做状态爆炸**

这和 PRD 里分层对象模型、Execution Package 为执行原语、Work Item/Release 为主要观察对象、全链路可追溯、双主线闭环的定义是一致的。

---

# 0. 设计目标

这套实体方案的目标不是做一个普通项目管理库，而是支撑下面这条主链路：

**Work Item → Spec → Plan → Execution Package → AI Run → Review → Test / Integration Gate → Release → Observation → Incident / Replay / Rule Feedback**

这正是 PRD 里“交付主线 + 进化主线”的核心。

---

# 1. 设计总原则

## 1.1 四层实体分层

我建议把实体分成四层：

### A. 容器层

承载团队、权限边界、阶段性范围。

* Project

### B. 业务定义层

承载业务目标、正式定义、实施方案。

* WorkItem
* Spec
* SpecRevision
* Plan
* PlanRevision

### C. 执行与交付层

承载真实执行、审查、门禁、交付。

* ExecutionPackage
* ExecutionPackageDependency
* RunSession
* ReviewPacket
* TestEvidence
* Release
* ReleaseWorkItem
* ReleaseExecutionPackage
* ReleaseEvidence

### D. 回放与进化层

承载轨迹、证据、事故、决策、复盘。

* Incident
* IncidentLink
* ObjectEvent
* StatusHistory
* Decision
* Artifact
* Contract
* ContractRevision
* PackageContractLink

---

## 1.2 revision 原则

下面这些对象都必须 revision 化：

* Spec → SpecRevision
* Plan → PlanRevision
* Contract → ContractRevision

因为 PRD 明确要求版本历史、审批、可追溯、Replay，并且 Execution Package 必须能回链到其上游定义版本。

---

## 1.3 状态原则

### 不做

* 每个阶段都拆成“进行中 / 已完成”
* 所有对象共用一个混杂 `status`

### 要做

* 主流程位置：`phase` 或 `status`
* 当前活动态：`activity_state`
* 门禁/审批态：`gate_state`
* 最终结局：`resolution`
* 瞬时动作进 `ObjectEvent`

---

## 1.4 基数原则

几个必须明确的关系：

* `WorkItem 1-N Spec`
* `Spec 1-N SpecRevision`
* `WorkItem 1-N Plan`
* `Plan 1-N PlanRevision`
* **`PlanRevision 1-N ExecutionPackage`**
* `ExecutionPackage 1-N RunSession`
* `ExecutionPackage 1-N ReviewPacket`
* `Release N-N WorkItem`
* `Release N-N ExecutionPackage`
* `Contract N-N ExecutionPackage`
* `Incident N-N Release / WorkItem / ExecutionPackage`

---

# 2. 核心实体总览

## 2.1 一级核心实体

* Project
* WorkItem
* Spec
* SpecRevision
* Plan
* PlanRevision
* ExecutionPackage
* ReviewPacket
* Release
* Incident

## 2.2 配套实体

* ExecutionPackageDependency
* RunSession
* TestEvidence
* Artifact
* ObjectEvent
* StatusHistory
* Decision
* Contract
* ContractRevision
* PackageContractLink
* ReleaseWorkItem
* ReleaseExecutionPackage
* ReleaseEvidence
* IncidentLink

---

# 3. 统一基类字段

所有一级实体都建议有统一基类字段：

```ts id="99j5hq"
type BaseEntity = {
  id: string;                       // UUID / ULID
  org_id: string;
  project_id?: string | null;

  key: string;                      // WI-123 / SPEC-3 / EP-42
  title?: string | null;
  description?: string | null;

  created_at: string;
  created_by_actor_id: string;
  updated_at: string;
  updated_by_actor_id: string;

  archived_at?: string | null;
  deleted_at?: string | null;

  visibility: "private" | "project" | "org";
  source_type?: string | null;      // manual / ai / import / monitoring / bug_report
  labels?: string[];
  extra?: Record<string, unknown>;
}
```

---

# 4. 最终实体设计

---

## 4.1 Project

容器层对象。PRD 中的 Project / Stream 在 V1 可以先统一成一个 Project，用 `kind` 区分。

```ts id="4o7crx"
type Project = BaseEntity & {
  kind: "project" | "stream";
  code: string;                         // 唯一短码
  owner_actor_id: string;
  team_id?: string | null;

  status: "active" | "paused" | "completed" | "archived";

  start_date?: string | null;
  end_date?: string | null;

  workflow_profile?: "backend_default" | "bugfix_fastlane" | "multi_end";
  default_repo_ids?: string[];
  default_branch?: string | null;
}
```

### 关系

* `Project 1-N WorkItem`
* `Project 1-N Release`
* `Project 1-N Incident`
* `Project 1-N Contract`

---

## 4.2 WorkItem

跨角色统一主对象。PRD 里 Requirement / Bug / Tech Debt / Initiative 都在这里统一抽象。

```ts id="0770vh"
type WorkItem = BaseEntity & {
  kind: "initiative" | "requirement" | "bug" | "tech_debt";

  phase:
    | "draft"
    | "triage"
    | "spec"
    | "plan"
    | "execution"
    | "release"
    | "observing"
    | "done"
    | "closed";

  activity_state:
    | "idle"
    | "in_progress"
    | "awaiting_ai"
    | "ai_running"
    | "awaiting_human"
    | "human_in_progress"
    | "blocked";

  gate_state:
    | "none"
    | "awaiting_spec_approval"
    | "spec_changes_requested"
    | "awaiting_plan_approval"
    | "plan_changes_requested"
    | "awaiting_release_approval"
    | "release_changes_requested";

  resolution:
    | "none"
    | "completed"
    | "cancelled"
    | "rejected"
    | "duplicate"
    | "superseded"
    | "won_t_do";

  owner_actor_id: string;
  reporter_actor_id?: string | null;

  priority: "p0" | "p1" | "p2" | "p3";
  risk_level: "low" | "medium" | "high" | "critical";

  background?: string | null;
  goal?: string | null;
  success_criteria?: unknown | null;     // JSONB
  out_of_scope?: unknown | null;         // JSONB

  current_spec_id?: string | null;
  current_spec_revision_id?: string | null;
  current_plan_id?: string | null;
  current_plan_revision_id?: string | null;
  current_release_id?: string | null;

  parent_work_item_id?: string | null;
  workflow_profile?: "backend_default" | "bugfix_fastlane" | "multi_end";

  blocked_reason?: string | null;
  blocked_at?: string | null;
  current_step_started_at?: string | null;
  last_transition_at?: string | null;
}
```

### 关系

* `WorkItem 1-N Spec`
* `WorkItem 1-N Plan`
* `WorkItem 1-N ExecutionPackage`
* `WorkItem N-N Release`
* `WorkItem N-N Incident`
* `WorkItem N-N Contract`（可选）

---

## 4.3 Spec

Spec 是逻辑对象，承载当前规范的身份与审批状态。内容存在 SpecRevision。PRD 明确要求版本、审批、风险、验收标准、测试策略摘要。

```ts id="g2o9f1"
type Spec = BaseEntity & {
  work_item_id: string;

  status:
    | "draft"
    | "in_review"
    | "approved"
    | "rejected"
    | "superseded"
    | "archived";

  editing_state:
    | "idle"
    | "ai_drafting"
    | "human_editing"
    | "co_editing";

  gate_state:
    | "not_submitted"
    | "awaiting_approval"
    | "changes_requested"
    | "approved";

  resolution:
    | "none"
    | "approved"
    | "rejected"
    | "superseded";

  approver_actor_id?: string | null;
  qa_owner_actor_id?: string | null;

  current_revision_id?: string | null;
  approved_revision_id?: string | null;
  approved_at?: string | null;
}
```

---

## 4.4 SpecRevision

```ts id="gnd369"
type SpecRevision = {
  id: string;
  spec_id: string;
  revision_no: number;

  drafted_by_actor_id: string;
  created_at: string;

  summary?: string | null;

  background?: string | null;
  goals?: unknown | null;                  // JSONB
  scope_in?: unknown | null;               // JSONB
  scope_out?: unknown | null;              // JSONB
  user_stories?: unknown | null;           // JSONB
  key_flows?: unknown | null;              // JSONB
  interface_changes?: unknown | null;      // JSONB
  acceptance_criteria?: unknown | null;    // JSONB
  test_strategy_summary?: unknown | null;  // JSONB
  risks?: unknown | null;                  // JSONB
  open_questions?: unknown | null;         // JSONB

  raw_markdown?: string | null;
  structured_doc?: unknown | null;         // JSONB
}
```

### 关系

* `Spec 1-N SpecRevision`
* `PlanRevision N-1 SpecRevision`
* `ExecutionPackage N-1 SpecRevision`
* `ReviewPacket N-1 SpecRevision`

---

## 4.5 Plan

Plan 是逻辑对象，承载实施方案本体。内容在 PlanRevision。它不是执行包本体，而是**执行包拆分和实施策略的上游定义**。

```ts id="di5nvo"
type Plan = BaseEntity & {
  work_item_id: string;
  spec_id: string;

  status:
    | "draft"
    | "in_review"
    | "approved"
    | "rejected"
    | "superseded"
    | "archived";

  editing_state:
    | "idle"
    | "ai_drafting"
    | "human_editing"
    | "co_editing";

  gate_state:
    | "not_submitted"
    | "awaiting_approval"
    | "changes_requested"
    | "approved";

  resolution:
    | "none"
    | "approved"
    | "rejected"
    | "superseded";

  reviewer_actor_id?: string | null;
  qa_owner_actor_id?: string | null;

  current_revision_id?: string | null;
  approved_revision_id?: string | null;
  approved_at?: string | null;
}
```

---

## 4.6 PlanRevision

```ts id="2pb69b"
type PlanRevision = {
  id: string;
  plan_id: string;
  based_on_spec_revision_id: string;

  revision_no: number;
  drafted_by_actor_id: string;
  created_at: string;

  implementation_summary?: string | null;
  split_strategy?: unknown | null;         // JSONB
  dependency_order?: unknown | null;       // JSONB
  test_matrix?: unknown | null;            // JSONB
  release_strategy?: unknown | null;       // JSONB
  rollback_plan?: unknown | null;          // JSONB
  qa_recommendations?: unknown | null;     // JSONB
  reviewer_recommendations?: unknown | null;
  risk_mitigations?: unknown | null;

  raw_markdown?: string | null;
  structured_doc?: unknown | null;
}
```

### 关键关系

* `Plan 1-N PlanRevision`
* **`PlanRevision 1-N ExecutionPackage`**
* `PlanRevision N-1 SpecRevision`

这是最终定稿里最关键的一条。
Execution Package 是从某个 PlanRevision 拆出来的，不是和 Plan 1-to-1。

---

## 4.7 ExecutionPackage

这是整套系统的执行主对象。PRD 明确说它是研发执行层的一等公民，是 AI 实施、Review、测试、发布控制与执行复盘的基本单元。

```ts id="nqv92b"
type ExecutionPackage = BaseEntity & {
  work_item_id: string;

  spec_id: string;
  spec_revision_id: string;

  plan_id: string;
  plan_revision_id: string;

  phase:
    | "draft"
    | "ready"
    | "queued"
    | "execution"
    | "review"
    | "integration"
    | "test_gate"
    | "release"
    | "archived";

  activity_state:
    | "idle"
    | "ai_running"
    | "ai_retrying"
    | "human_editing"
    | "awaiting_human"
    | "human_reviewing"
    | "blocked"
    | "handover";

  gate_state:
    | "not_submitted"
    | "self_review_pending"
    | "awaiting_human_review"
    | "changes_requested"
    | "review_approved"
    | "integration_failed"
    | "integration_passed"
    | "test_failed"
    | "test_passed"
    | "release_ready"
    | "released";

  resolution:
    | "none"
    | "completed"
    | "cancelled"
    | "rolled_back"
    | "superseded";

  execution_owner_actor_id: string;
  reviewer_actor_id?: string | null;
  qa_owner_actor_id?: string | null;

  surface_type:
    | "backend"
    | "web"
    | "ios"
    | "android"
    | "data"
    | "infra"
    | "qa"
    | "release";

  repo_id: string;
  deploy_unit?: string | null;
  base_branch?: string | null;
  base_commit_sha?: string | null;

  objective: string;
  non_goals?: unknown | null;

  allowed_paths: string[];
  forbidden_paths?: string[] | null;
  module_boundaries?: unknown | null;

  required_checks?: string[] | null;
  required_test_gates?: string[] | null;
  regression_scope?: unknown | null;

  integration_prerequisites?: unknown | null;
  environment_requirements?: unknown | null;

  integration_readiness:
    | "not_ready"
    | "contract_ready"
    | "mock_ready"
    | "partial_integration_ready"
    | "full_integration_ready"
    | "ready_for_release";

  risk_level: "low" | "medium" | "high" | "critical";
  risk_notes?: unknown | null;

  definition_of_done?: unknown | null;

  current_run_session_id?: string | null;
  current_review_packet_id?: string | null;
  current_release_id?: string | null;

  manual_override_enabled: boolean;

  origin_package_id?: string | null;       // lineage
  superseded_by_package_id?: string | null;

  retry_count?: number | null;
  blocked_reason?: string | null;
  blocked_at?: string | null;
  last_transition_at?: string | null;
}
```

### 核心说明

1. `spec_revision_id` 和 `plan_revision_id` **必须有**
2. `allowed_paths` / `forbidden_paths` 是 Codex 执行器和 sandbox 策略的关键
3. `integration_readiness` 单独存在，不和主 phase 混

---

## 4.8 ExecutionPackageDependency

```ts id="bbxuoq"
type ExecutionPackageDependency = {
  id: string;
  package_id: string;
  depends_on_package_id: string;

  dependency_type: "hard" | "soft" | "contract" | "environment";
  reason?: string | null;

  created_at: string;
  created_by_actor_id: string;
}
```

### 关系

* `ExecutionPackage N-N ExecutionPackage`

---

## 4.9 RunSession

RunSession 是 Package 的一次执行会话，承载 Codex 执行器、sandbox、prompt/skill/version、产物和结果。PRD 明确要求记录 AI 的上下文、输入、中间产物与结果。

```ts id="8jndwb"
type RunSession = BaseEntity & {
  package_id: string;

  status:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "handed_over";

  executor_type: "codex";
  executor_version?: string | null;

  sandbox_id?: string | null;
  sandbox_type?: "docker" | "k8s_job" | "microvm" | null;

  base_commit_sha?: string | null;
  working_branch?: string | null;

  run_spec?: unknown | null;              // JSONB
  model_input_summary?: unknown | null;
  prompt_refs?: unknown | null;
  skill_refs?: string[] | null;
  config_refs?: unknown | null;

  started_at?: string | null;
  ended_at?: string | null;

  result_summary?: string | null;
  changed_files?: string[] | null;

  output_patch_artifact_id?: string | null;
  test_report_artifact_id?: string | null;

  handover_reason?: string | null;
}
```

### 关系

* `ExecutionPackage 1-N RunSession`
* `RunSession 1-N Artifact`
* `RunSession 1-N TestEvidence`
* `RunSession 1-N ReviewPacket`（通常是一对一候选，但逻辑上可多）

---

## 4.10 ReviewPacket

ReviewPacket 是审查快照，不是 Package 上一个会被覆盖的 blob。PRD 里它是独立的审查包。

```ts id="jlwmci"
type ReviewPacket = BaseEntity & {
  package_id: string;
  run_session_id?: string | null;

  spec_revision_id: string;
  plan_revision_id: string;

  status:
    | "draft"
    | "ready"
    | "in_review"
    | "completed"
    | "escalated"
    | "archived";

  decision:
    | "none"
    | "approved"
    | "changes_requested"
    | "need_more_context"
    | "escalate";

  reviewer_actor_id?: string | null;
  review_started_at?: string | null;
  review_completed_at?: string | null;

  spec_refs?: unknown | null;
  plan_refs?: unknown | null;

  change_summary?: string | null;
  key_diffs?: unknown | null;
  changed_files?: string[] | null;

  ai_self_review?: unknown | null;
  ai_independent_review?: unknown | null;

  test_mapping?: unknown | null;
  risk_points?: unknown | null;
  human_decision_questions?: unknown | null;

  final_comments?: string | null;
}
```

### 关系

* `ExecutionPackage 1-N ReviewPacket`
* `RunSession 1-N ReviewPacket`
* `ReviewPacket N-1 SpecRevision`
* `ReviewPacket N-1 PlanRevision`

---

## 4.11 TestEvidence

PRD 把测试和质量作为主线组成部分，所以至少要有测试证据对象。

```ts id="vfq2j6"
type TestEvidence = BaseEntity & {
  work_item_id?: string | null;
  package_id?: string | null;
  run_session_id?: string | null;

  layer:
    | "unit"
    | "integration"
    | "contract"
    | "e2e"
    | "exploratory"
    | "post_release";

  status: "passed" | "failed" | "partial" | "skipped";

  summary?: string | null;
  metrics?: unknown | null;
  artifact_id?: string | null;
}
```

---

## 4.12 Release

Release 是聚合交付对象，不是普通 Work Item。PRD 明确写了它聚合一批 WorkItems / ExecutionPackages / 测试证据 / 灰度 / 回滚。

```ts id="7d0pym"
type Release = BaseEntity & {
  phase:
    | "draft"
    | "candidate"
    | "approval"
    | "rollout"
    | "observing"
    | "completed"
    | "closed";

  activity_state:
    | "idle"
    | "awaiting_human"
    | "human_in_progress"
    | "rolling_out"
    | "paused"
    | "blocked";

  gate_state:
    | "not_submitted"
    | "awaiting_approval"
    | "changes_requested"
    | "approved"
    | "rollout_failed"
    | "rollout_succeeded";

  resolution:
    | "none"
    | "completed"
    | "rolled_back"
    | "cancelled";

  release_owner_actor_id: string;
  release_type: "normal" | "hotfix" | "emergency" | "gray";

  scope_summary?: string | null;
  risk_summary?: unknown | null;
  rollout_strategy?: unknown | null;
  rollback_plan?: unknown | null;
  observation_plan?: unknown | null;

  rollout_started_at?: string | null;
  rollout_completed_at?: string | null;
  observed_until?: string | null;
}
```

---

## 4.13 ReleaseWorkItem / ReleaseExecutionPackage / ReleaseEvidence

```ts id="wl2v2d"
type ReleaseWorkItem = {
  release_id: string;
  work_item_id: string;
}
```

```ts id="m7hn53"
type ReleaseExecutionPackage = {
  release_id: string;
  package_id: string;
}
```

```ts id="hqag9d"
type ReleaseEvidence = BaseEntity & {
  release_id: string;
  evidence_type:
    | "test_report"
    | "review_packet"
    | "build"
    | "deployment"
    | "metric_snapshot"
    | "rollback_record";

  artifact_id?: string | null;
  summary?: string | null;
}
```

### 关系

* `Release N-N WorkItem`
* `Release N-N ExecutionPackage`
* `Release 1-N ReleaseEvidence`

---

## 4.14 Incident

Incident 是事故/异常对象，要求能回链到 Release / WorkItem / Package，并支持 Replay。

```ts id="uc1s58"
type Incident = BaseEntity & {
  severity: "sev0" | "sev1" | "sev2" | "sev3";

  status:
    | "open"
    | "triaging"
    | "mitigating"
    | "resolved"
    | "retrospecting"
    | "closed";

  activity_state:
    | "idle"
    | "human_in_progress"
    | "awaiting_input"
    | "blocked";

  resolution:
    | "none"
    | "resolved"
    | "false_alarm"
    | "duplicate"
    | "cancelled";

  detected_at: string;
  resolved_at?: string | null;

  impact_scope?: unknown | null;
  symptom_summary?: string | null;
  root_cause_summary?: string | null;

  primary_release_id?: string | null;
  primary_work_item_id?: string | null;
  primary_package_id?: string | null;

  mitigation_actions?: unknown | null;
  rollback_actions?: unknown | null;

  retrospective_doc_ref?: string | null;
}
```

---

## 4.15 IncidentLink

为了避免 Incident 只能挂一个对象，建议用关联表。

```ts id="m32slb"
type IncidentLink = {
  id: string;
  incident_id: string;

  object_type: "release" | "work_item" | "execution_package";
  object_id: string;

  role: "primary" | "related" | "root_cause" | "affected" | "fix";
}
```

### 关系

* `Incident N-N Release`
* `Incident N-N WorkItem`
* `Incident N-N ExecutionPackage`

---

## 4.16 Contract

Contract 是多端协作核心对象。PRD 中明确要求 version、compatibility、provider/consumer、sample payload、mock/fixture、冻结状态。

```ts id="cuz6v7"
type Contract = BaseEntity & {
  kind: "api" | "schema" | "event" | "state";

  status:
    | "draft"
    | "in_review"
    | "approved"
    | "frozen"
    | "deprecated"
    | "archived";

  gate_state:
    | "not_submitted"
    | "awaiting_approval"
    | "changes_requested"
    | "approved"
    | "frozen";

  resolution:
    | "none"
    | "approved"
    | "deprecated"
    | "superseded";

  current_revision_id?: string | null;
  approved_revision_id?: string | null;

  provider_package_id?: string | null;
}
```

---

## 4.17 ContractRevision

```ts id="x3d5ef"
type ContractRevision = {
  id: string;
  contract_id: string;
  revision_no: number;

  version: string;
  compatibility_mode: "backward" | "forward" | "breaking";

  summary?: string | null;
  payload_schema?: unknown | null;
  sample_payloads?: unknown | null;
  mock_assets?: unknown | null;

  approved_by_actor_id?: string | null;
  approved_at?: string | null;

  created_at: string;
  created_by_actor_id: string;
}
```

---

## 4.18 PackageContractLink

```ts id="ngn1vc"
type PackageContractLink = {
  id: string;
  package_id: string;
  contract_id: string;
  contract_revision_id?: string | null;

  role: "provider" | "consumer" | "depends_on";
}
```

### 关系

* `Contract N-N ExecutionPackage`

---

## 4.19 Artifact

Artifact 是所有证据的统一物理载体。PRD 中的日志、补丁、测试报告、截图、trace 都应该汇总到这里。

```ts id="fg1fac"
type Artifact = BaseEntity & {
  owner_object_type:
    | "run_session"
    | "review_packet"
    | "release"
    | "incident"
    | "spec_revision"
    | "plan_revision"
    | "test_evidence";

  owner_object_id: string;

  artifact_type:
    | "patch"
    | "diff"
    | "log"
    | "test_report"
    | "build_output"
    | "summary"
    | "trace"
    | "screenshot"
    | "deployment_record";

  storage_uri: string;
  content_type?: string | null;
  size_bytes?: number | null;
  checksum?: string | null;
}
```

---

## 4.20 ObjectEvent

ObjectEvent 用来表达“发生了什么动作”，不和主状态混。PRD 对 Replay / Trace 的要求必须靠它来实现。

```ts id="hwg1bj"
type ObjectEvent = {
  id: string;
  org_id: string;
  project_id?: string | null;

  object_type:
    | "work_item"
    | "spec"
    | "plan"
    | "execution_package"
    | "review_packet"
    | "release"
    | "incident"
    | "run_session"
    | "contract";

  object_id: string;

  event_type:
    | "created"
    | "updated"
    | "submitted"
    | "approved"
    | "rejected"
    | "superseded"
    | "phase_changed"
    | "gate_changed"
    | "run_started"
    | "run_failed"
    | "run_succeeded"
    | "retry_requested"
    | "handover"
    | "review_requested"
    | "review_completed"
    | "released"
    | "rolled_back"
    | "incident_linked";

  actor_type: "human" | "ai" | "system";
  actor_id?: string | null;

  occurred_at: string;
  reason?: string | null;
  payload?: unknown | null;
}
```

---

## 4.21 StatusHistory

状态变化单独记录，满足 PRD 对状态变化“触发者、时间、依据、上下文”的要求。

```ts id="bt8pyi"
type StatusHistory = {
  id: string;

  object_type:
    | "work_item"
    | "spec"
    | "plan"
    | "execution_package"
    | "review_packet"
    | "release"
    | "incident"
    | "contract";

  object_id: string;

  field_name: "phase" | "status" | "activity_state" | "gate_state" | "resolution";
  from_value?: string | null;
  to_value: string;

  changed_by_actor_type: "human" | "ai" | "system";
  changed_by_actor_id?: string | null;

  changed_at: string;
  reason?: string | null;
  context?: unknown | null;
}
```

---

## 4.22 Decision

Decision 用于存储关键人工/系统判断，比如审批、发布决策、人工接管、回滚。

```ts id="1j46by"
type Decision = BaseEntity & {
  object_type:
    | "spec"
    | "plan"
    | "review_packet"
    | "release"
    | "execution_package"
    | "incident";

  object_id: string;

  decision_type:
    | "spec_approval"
    | "plan_approval"
    | "review_decision"
    | "release_approval"
    | "manual_override"
    | "rollback_decision";

  outcome: string;
  decided_by_actor_id: string;
  rationale?: string | null;
  evidence_refs?: unknown | null;
}
```

---

# 5. 最终关系图（文字版）

## 核心关系

* `Project 1-N WorkItem`
* `Project 1-N Release`
* `Project 1-N Incident`
* `Project 1-N Contract`

## 定义层

* `WorkItem 1-N Spec`
* `Spec 1-N SpecRevision`
* `WorkItem 1-N Plan`
* `Plan 1-N PlanRevision`

## 执行层

* `WorkItem 1-N ExecutionPackage`
* `SpecRevision 1-N ExecutionPackage`
* **`PlanRevision 1-N ExecutionPackage`**
* `ExecutionPackage N-N ExecutionPackage`（Dependency）
* `ExecutionPackage 1-N RunSession`
* `ExecutionPackage 1-N ReviewPacket`
* `ExecutionPackage 1-N TestEvidence`

## 交付层

* `Release N-N WorkItem`
* `Release N-N ExecutionPackage`
* `Release 1-N ReleaseEvidence`

## 协同层

* `Contract 1-N ContractRevision`
* `Contract N-N ExecutionPackage`

## 回放层

* `Incident N-N Release`
* `Incident N-N WorkItem`
* `Incident N-N ExecutionPackage`
* `Artifact N-1 任意对象`
* `ObjectEvent N-1 任意对象`
* `StatusHistory N-1 任意对象`
* `Decision N-1 任意对象`

---

# 6. 状态设计最终结论

## WorkItem

* `phase`
* `activity_state`
* `gate_state`
* `resolution`

## Spec / Plan / Contract

* `status`
* `editing_state`（Spec/Plan）或省略（Contract）
* `gate_state`
* `resolution`

## ExecutionPackage

* `phase`
* `activity_state`
* `gate_state`
* `resolution`

## ReviewPacket

* `status`
* `decision`

## Release

* `phase`
* `activity_state`
* `gate_state`
* `resolution`

## Incident

* `status`
* `activity_state`
* `resolution`

## 瞬时动作

全部进 `ObjectEvent`

---

# 7. V1 / V2 边界建议

## V1 先做正式实体

* Project
* WorkItem
* Spec / SpecRevision
* Plan / PlanRevision
* ExecutionPackage
* ExecutionPackageDependency
* RunSession
* ReviewPacket
* TestEvidence
* Release / ReleaseWorkItem / ReleaseExecutionPackage / ReleaseEvidence
* Artifact
* ObjectEvent
* StatusHistory
* Decision

## V1 可以先弱化实现

* IncidentLink
* Contract / ContractRevision / PackageContractLink

## V2 再增强

* Contract 成熟化
* Environment / Version / Build 独立实体
* RuleProposal / SkillProposal / TemplateProposal 独立对象
* 更细的 Integration Readiness 自动推导

---

# 8. 最终一句话定义

这版最终实体方案可以概括为：

**Project 承载范围，WorkItem 承载业务意图，Spec/Plan 承载正式定义与版本，ExecutionPackage 承载可执行边界，RunSession 承载执行过程，ReviewPacket/TestEvidence/Release 承载交付门禁与证据，Incident/ObjectEvent/Artifact/Decision 承载回放、复盘与进化。**

这正好对应你 PRD 里的对象模型、流程模型和“执行 + 进化”双主线。

如果你愿意，下一步我建议直接继续做 **PostgreSQL 表结构草案**，把这一版实体设计落成：

* 表名
* 字段类型
* 主外键
* 唯一约束
* 索引建议
* revision 表与关系表的 DDL 轮廓

下面给你一版**PostgreSQL 可落库草案（V1）**。这版严格围绕你 PRD 里的分层对象模型来定：Project 作为容器层，Work Item 作为跨角色主对象，Execution Package 作为执行主对象，Release 作为交付编排对象；同时保留 Event / Trace / Decision / Artifact 这类回放与审计能力。PRD 也明确要求 Work Item 可关联多份 Spec / Plan、一个 Work Item 可拆成多个 Execution Packages、Release 聚合多个 Work Items 与 Packages、Incident 可回链到 Release / Work Item / Package。

我会先给结论，再给 DDL 轮廓。

---

## 先定 6 个落库决策

第一，**Spec / Plan / Contract 都做 revision 化**。
第二，**Execution Package 必须冻结到 `spec_revision_id` 和 `plan_revision_id`**。
第三，**PlanRevision → ExecutionPackage 是 1-to-N**，不是 1-to-1。
第四，**Work Item / Package / Release / Incident 的主表只保留当前态，所有状态变化进 history 表**。
第五，**细粒度动作不做 status，而是进 event 表**。
第六，**V1 不单独建 Iteration / Milestone / Environment 主对象**，先把主闭环跑通，后面再补。以上都符合你 PRD 的对象关系、状态机、Trace/Replay 和审计要求。

---

## 推荐技术前提

```sql
create extension if not exists pgcrypto;
create extension if not exists citext;
```

ID 我建议先直接用 `uuid`。
如果你们更喜欢可读性强的外部编号，额外保留 `key` 字段，比如 `WI-123`、`EP-42`。

---

# 1) Enum 定义

```sql
-- common
create type visibility_t as enum ('private', 'project', 'org');
create type actor_type_t as enum ('human', 'ai', 'system');

-- project
create type project_kind_t as enum ('project', 'stream');
create type project_status_t as enum ('active', 'paused', 'completed', 'archived');
create type workflow_profile_t as enum ('backend_default', 'bugfix_fastlane', 'multi_end');

-- work item
create type work_item_kind_t as enum ('initiative', 'requirement', 'bug', 'tech_debt');
create type priority_t as enum ('p0', 'p1', 'p2', 'p3');
create type risk_level_t as enum ('low', 'medium', 'high', 'critical');

create type work_item_phase_t as enum (
  'draft', 'triage', 'spec', 'plan', 'execution', 'release', 'observing', 'done', 'closed'
);
create type work_item_activity_state_t as enum (
  'idle', 'in_progress', 'awaiting_ai', 'ai_running', 'awaiting_human', 'human_in_progress', 'blocked'
);
create type work_item_gate_state_t as enum (
  'none',
  'awaiting_spec_approval', 'spec_changes_requested',
  'awaiting_plan_approval', 'plan_changes_requested',
  'awaiting_release_approval', 'release_changes_requested'
);
create type work_item_resolution_t as enum (
  'none', 'completed', 'cancelled', 'rejected', 'duplicate', 'superseded', 'won_t_do'
);

-- doc objects
create type doc_status_t as enum ('draft', 'in_review', 'approved', 'rejected', 'superseded', 'archived');
create type doc_editing_state_t as enum ('idle', 'ai_drafting', 'human_editing', 'co_editing');
create type doc_gate_state_t as enum ('not_submitted', 'awaiting_approval', 'changes_requested', 'approved');
create type doc_resolution_t as enum ('none', 'approved', 'rejected', 'superseded');

-- execution package
create type surface_type_t as enum ('backend', 'web', 'ios', 'android', 'data', 'infra', 'qa', 'release');

create type package_phase_t as enum (
  'draft', 'ready', 'queued', 'execution', 'review', 'integration', 'test_gate', 'release', 'archived'
);
create type package_activity_state_t as enum (
  'idle', 'ai_running', 'ai_retrying', 'human_editing', 'awaiting_human', 'human_reviewing', 'blocked', 'handover'
);
create type package_gate_state_t as enum (
  'not_submitted',
  'self_review_pending',
  'awaiting_human_review',
  'changes_requested',
  'review_approved',
  'integration_failed',
  'integration_passed',
  'test_failed',
  'test_passed',
  'release_ready',
  'released'
);
create type package_resolution_t as enum ('none', 'completed', 'cancelled', 'rolled_back', 'superseded');

create type integration_readiness_t as enum (
  'not_ready', 'contract_ready', 'mock_ready',
  'partial_integration_ready', 'full_integration_ready', 'ready_for_release'
);

create type package_dependency_type_t as enum ('hard', 'soft', 'contract', 'environment');

-- run
create type run_status_t as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'handed_over');
create type executor_type_t as enum ('codex');
create type sandbox_type_t as enum ('docker', 'k8s_job', 'microvm');

-- review
create type review_packet_status_t as enum ('draft', 'ready', 'in_review', 'completed', 'escalated', 'archived');
create type review_decision_t as enum ('none', 'approved', 'changes_requested', 'need_more_context', 'escalate');

-- test
create type test_layer_t as enum ('unit', 'integration', 'contract', 'e2e', 'exploratory', 'post_release');
create type test_status_t as enum ('passed', 'failed', 'partial', 'skipped');

-- release
create type release_phase_t as enum ('draft', 'candidate', 'approval', 'rollout', 'observing', 'completed', 'closed');
create type release_activity_state_t as enum ('idle', 'awaiting_human', 'human_in_progress', 'rolling_out', 'paused', 'blocked');
create type release_gate_state_t as enum ('not_submitted', 'awaiting_approval', 'changes_requested', 'approved', 'rollout_failed', 'rollout_succeeded');
create type release_resolution_t as enum ('none', 'completed', 'rolled_back', 'cancelled');
create type release_type_t as enum ('normal', 'hotfix', 'emergency', 'gray');

-- incident
create type incident_severity_t as enum ('sev0', 'sev1', 'sev2', 'sev3');
create type incident_status_t as enum ('open', 'triaging', 'mitigating', 'resolved', 'retrospecting', 'closed');
create type incident_activity_state_t as enum ('idle', 'human_in_progress', 'awaiting_input', 'blocked');
create type incident_resolution_t as enum ('none', 'resolved', 'false_alarm', 'duplicate', 'cancelled');
create type incident_link_object_type_t as enum ('release', 'work_item', 'execution_package');
create type incident_link_role_t as enum ('primary', 'related', 'root_cause', 'affected', 'fix');

-- contract
create type contract_kind_t as enum ('api', 'schema', 'event', 'state');
create type contract_status_t as enum ('draft', 'in_review', 'approved', 'frozen', 'deprecated', 'archived');
create type contract_gate_state_t as enum ('not_submitted', 'awaiting_approval', 'changes_requested', 'approved', 'frozen');
create type contract_resolution_t as enum ('none', 'approved', 'deprecated', 'superseded');
create type compatibility_mode_t as enum ('backward', 'forward', 'breaking');
create type contract_link_role_t as enum ('provider', 'consumer', 'depends_on');

-- artifact / event / decision
create type artifact_owner_type_t as enum ('run_session', 'review_packet', 'release', 'incident', 'spec_revision', 'plan_revision', 'test_evidence');
create type artifact_type_t as enum ('patch', 'diff', 'log', 'test_report', 'build_output', 'summary', 'trace', 'screenshot', 'deployment_record');

create type object_type_t as enum ('work_item', 'spec', 'plan', 'execution_package', 'review_packet', 'release', 'incident', 'run_session', 'contract');
create type object_event_type_t as enum (
  'created', 'updated', 'submitted', 'approved', 'rejected', 'superseded',
  'phase_changed', 'gate_changed', 'run_started', 'run_failed', 'run_succeeded',
  'retry_requested', 'handover', 'review_requested', 'review_completed',
  'released', 'rolled_back', 'incident_linked'
);

create type status_field_name_t as enum ('phase', 'status', 'activity_state', 'gate_state', 'resolution');

create type decision_type_t as enum (
  'spec_approval', 'plan_approval', 'review_decision', 'release_approval', 'manual_override', 'rollback_decision'
);
```

---

# 2) 通用基础表

V1 先不做复杂 IAM，但至少要有 `org_id`、`project_id`、`actor_id` 这些外键位。

```sql
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table actors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  actor_type actor_type_t not null,
  display_name text not null,
  email citext,
  created_at timestamptz not null default now()
);
```

---

# 3) 容器层

## projects

```sql
create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  key text not null,
  code text not null,
  title text not null,
  description text,

  kind project_kind_t not null,
  status project_status_t not null default 'active',
  workflow_profile workflow_profile_t not null default 'backend_default',

  owner_actor_id uuid not null references actors(id),
  team_id uuid,
  default_branch text,
  default_repo_ids jsonb,

  start_date date,
  end_date date,

  visibility visibility_t not null default 'project',
  source_type text,
  labels text[] not null default '{}',
  extra jsonb,

  created_at timestamptz not null default now(),
  created_by_actor_id uuid not null references actors(id),
  updated_at timestamptz not null default now(),
  updated_by_actor_id uuid not null references actors(id),
  archived_at timestamptz,
  deleted_at timestamptz,

  unique (org_id, key),
  unique (org_id, code)
);

create index idx_projects_org_status on projects(org_id, status);
```

---

# 4) 业务定义层

## work_items

Work Item 是跨角色主对象；它要能挂当前生效的 Spec / Plan / Release 指针，但不直接承载执行细节。PRD 里对它的定位很明确。

```sql
create table work_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  key text not null,
  title text not null,
  description text,

  kind work_item_kind_t not null,
  phase work_item_phase_t not null default 'draft',
  activity_state work_item_activity_state_t not null default 'idle',
  gate_state work_item_gate_state_t not null default 'none',
  resolution work_item_resolution_t not null default 'none',

  owner_actor_id uuid not null references actors(id),
  reporter_actor_id uuid references actors(id),

  priority priority_t not null default 'p2',
  risk_level risk_level_t not null default 'medium',

  background text,
  goal text,
  success_criteria jsonb,
  out_of_scope jsonb,

  current_spec_id uuid,
  current_spec_revision_id uuid,
  current_plan_id uuid,
  current_plan_revision_id uuid,
  current_release_id uuid,

  parent_work_item_id uuid references work_items(id),
  workflow_profile workflow_profile_t not null default 'backend_default',

  blocked_reason text,
  blocked_at timestamptz,
  current_step_started_at timestamptz,
  last_transition_at timestamptz,

  visibility visibility_t not null default 'project',
  source_type text,
  labels text[] not null default '{}',
  extra jsonb,

  created_at timestamptz not null default now(),
  created_by_actor_id uuid not null references actors(id),
  updated_at timestamptz not null default now(),
  updated_by_actor_id uuid not null references actors(id),
  archived_at timestamptz,
  deleted_at timestamptz,

  unique (org_id, key)
);

create index idx_work_items_project_phase on work_items(project_id, phase);
create index idx_work_items_owner_phase on work_items(owner_actor_id, phase);
create index idx_work_items_priority_risk on work_items(priority, risk_level);
```

> 注意：`current_spec_id/current_plan_id/...` 这些外键建议在后面所有表创建完后再 `alter table add constraint`，避免循环引用。

---

## specs

```sql
create table specs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  work_item_id uuid not null references work_items(id),
  key text not null,
  title text not null,
  description text,

  status doc_status_t not null default 'draft',
  editing_state doc_editing_state_t not null default 'idle',
  gate_state doc_gate_state_t not null default 'not_submitted',
  resolution doc_resolution_t not null default 'none',

  approver_actor_id uuid references actors(id),
  qa_owner_actor_id uuid references actors(id),

  current_revision_id uuid,
  approved_revision_id uuid,
  approved_at timestamptz,

  visibility visibility_t not null default 'project',
  source_type text,
  labels text[] not null default '{}',
  extra jsonb,

  created_at timestamptz not null default now(),
  created_by_actor_id uuid not null references actors(id),
  updated_at timestamptz not null default now(),
  updated_by_actor_id uuid not null references actors(id),
  archived_at timestamptz,
  deleted_at timestamptz,

  unique (org_id, key)
);

create index idx_specs_work_item on specs(work_item_id);
create index idx_specs_status on specs(project_id, status);
```

## spec_revisions

```sql
create table spec_revisions (
  id uuid primary key default gen_random_uuid(),
  spec_id uuid not null references specs(id) on delete cascade,
  revision_no int not null,
  drafted_by_actor_id uuid not null references actors(id),
  created_at timestamptz not null default now(),

  summary text,
  background text,
  goals jsonb,
  scope_in jsonb,
  scope_out jsonb,
  user_stories jsonb,
  key_flows jsonb,
  interface_changes jsonb,
  acceptance_criteria jsonb,
  test_strategy_summary jsonb,
  risks jsonb,
  open_questions jsonb,

  raw_markdown text,
  structured_doc jsonb,

  unique (spec_id, revision_no)
);

create index idx_spec_revisions_spec on spec_revisions(spec_id, revision_no desc);
```

---

## plans

Plan 是逻辑对象，Execution Package 是从某个 PlanRevision 拆出来的，而不是和 Plan 一对一。PRD 对拆分策略、依赖顺序、测试矩阵、发布/回滚方案有明确要求。

```sql
create table plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  work_item_id uuid not null references work_items(id),
  spec_id uuid not null references specs(id),
  key text not null,
  title text not null,
  description text,

  status doc_status_t not null default 'draft',
  editing_state doc_editing_state_t not null default 'idle',
  gate_state doc_gate_state_t not null default 'not_submitted',
  resolution doc_resolution_t not null default 'none',

  reviewer_actor_id uuid references actors(id),
  qa_owner_actor_id uuid references actors(id),

  current_revision_id uuid,
  approved_revision_id uuid,
  approved_at timestamptz,

  visibility visibility_t not null default 'project',
  source_type text,
  labels text[] not null default '{}',
  extra jsonb,

  created_at timestamptz not null default now(),
  created_by_actor_id uuid not null references actors(id),
  updated_at timestamptz not null default now(),
  updated_by_actor_id uuid not null references actors(id),
  archived_at timestamptz,
  deleted_at timestamptz,

  unique (org_id, key)
);

create index idx_plans_work_item on plans(work_item_id);
create index idx_plans_spec on plans(spec_id);
```

## plan_revisions

```sql
create table plan_revisions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  based_on_spec_revision_id uuid not null references spec_revisions(id),
  revision_no int not null,
  drafted_by_actor_id uuid not null references actors(id),
  created_at timestamptz not null default now(),

  implementation_summary text,
  split_strategy jsonb,
  dependency_order jsonb,
  test_matrix jsonb,
  release_strategy jsonb,
  rollback_plan jsonb,
  qa_recommendations jsonb,
  reviewer_recommendations jsonb,
  risk_mitigations jsonb,

  raw_markdown text,
  structured_doc jsonb,

  unique (plan_id, revision_no)
);

create index idx_plan_revisions_plan on plan_revisions(plan_id, revision_no desc);
create index idx_plan_revisions_spec_revision on plan_revisions(based_on_spec_revision_id);
```

---

# 5) 执行与交付层

## execution_packages

Execution Package 是执行主对象，字段要强结构化。PRD 也明确要求它包含修改边界、依赖、环境需求、联调 readiness、完成定义和状态。

```sql
create table execution_packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  work_item_id uuid not null references work_items(id),

  spec_id uuid not null references specs(id),
  spec_revision_id uuid not null references spec_revisions(id),

  plan_id uuid not null references plans(id),
  plan_revision_id uuid not null references plan_revisions(id),

  key text not null,
  title text not null,
  description text,

  phase package_phase_t not null default 'draft',
  activity_state package_activity_state_t not null default 'idle',
  gate_state package_gate_state_t not null default 'not_submitted',
  resolution package_resolution_t not null default 'none',

  execution_owner_actor_id uuid not null references actors(id),
  reviewer_actor_id uuid references actors(id),
  qa_owner_actor_id uuid references actors(id),

  surface_type surface_type_t not null,
  repo_id text not null,
  deploy_unit text,
  base_branch text,
  base_commit_sha text,

  objective text not null,
  non_goals jsonb,

  allowed_paths text[] not null default '{}',
  forbidden_paths text[] not null default '{}',
  module_boundaries jsonb,

  required_checks text[] not null default '{}',
  required_test_gates text[] not null default '{}',
  regression_scope jsonb,

  integration_prerequisites jsonb,
  environment_requirements jsonb,
  integration_readiness integration_readiness_t not null default 'not_ready',

  risk_level risk_level_t not null default 'medium',
  risk_notes jsonb,
  definition_of_done jsonb,

  current_run_session_id uuid,
  current_review_packet_id uuid,
  current_release_id uuid,

  manual_override_enabled boolean not null default true,
  origin_package_id uuid references execution_packages(id),
  superseded_by_package_id uuid references execution_packages(id),

  retry_count int not null default 0,
  blocked_reason text,
  blocked_at timestamptz,
  last_transition_at timestamptz,

  visibility visibility_t not null default 'project',
  source_type text,
  labels text[] not null default '{}',
  extra jsonb,

  created_at timestamptz not null default now(),
  created_by_actor_id uuid not null references actors(id),
  updated_at timestamptz not null default now(),
  updated_by_actor_id uuid not null references actors(id),
  archived_at timestamptz,
  deleted_at timestamptz,

  unique (org_id, key)
);

create index idx_packages_work_item on execution_packages(work_item_id);
create index idx_packages_plan_revision on execution_packages(plan_revision_id);
create index idx_packages_spec_revision on execution_packages(spec_revision_id);
create index idx_packages_phase on execution_packages(project_id, phase);
create index idx_packages_owner_phase on execution_packages(execution_owner_actor_id, phase);
create index idx_packages_surface_repo on execution_packages(surface_type, repo_id);
```

### 一个很重要的约束

如果你想强一点，可以加 trigger，保证：

* `plan_revisions.plan_id = execution_packages.plan_id`
* `spec_revisions.spec_id = execution_packages.spec_id`

单靠普通 FK 无法完全表达这个组合一致性。

---

## execution_package_dependencies

```sql
create table execution_package_dependencies (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references execution_packages(id) on delete cascade,
  depends_on_package_id uuid not null references execution_packages(id) on delete cascade,
  dependency_type package_dependency_type_t not null,
  reason text,
  created_at timestamptz not null default now(),
  created_by_actor_id uuid not null references actors(id),
  check (package_id <> depends_on_package_id),
  unique (package_id, depends_on_package_id)
);

create index idx_pkg_dep_package on execution_package_dependencies(package_id);
create index idx_pkg_dep_depends on execution_package_dependencies(depends_on_package_id);
```

---

## run_sessions

```sql
create table run_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  package_id uuid not null references execution_packages(id),

  key text not null,
  title text,
  description text,

  status run_status_t not null default 'queued',
  executor_type executor_type_t not null default 'codex',
  executor_version text,

  sandbox_id text,
  sandbox_type sandbox_type_t,
  base_commit_sha text,
  working_branch text,

  run_spec jsonb,
  model_input_summary jsonb,
  prompt_refs jsonb,
  skill_refs text[],
  config_refs jsonb,

  started_at timestamptz,
  ended_at timestamptz,

  result_summary text,
  changed_files text[],
  output_patch_artifact_id uuid,
  test_report_artifact_id uuid,
  handover_reason text,

  visibility visibility_t not null default 'project',
  source_type text,
  labels text[] not null default '{}',
  extra jsonb,

  created_at timestamptz not null default now(),
  created_by_actor_id uuid not null references actors(id),
  updated_at timestamptz not null default now(),
  updated_by_actor_id uuid not null references actors(id),
  archived_at timestamptz,
  deleted_at timestamptz,

  unique (org_id, key)
);

create index idx_run_sessions_package on run_sessions(package_id, created_at desc);
create index idx_run_sessions_status on run_sessions(status, started_at desc);
```

---

## review_packets

```sql
create table review_packets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  package_id uuid not null references execution_packages(id),
  run_session_id uuid references run_sessions(id),

  spec_revision_id uuid not null references spec_revisions(id),
  plan_revision_id uuid not null references plan_revisions(id),

  key text not null,
  title text,
  description text,

  status review_packet_status_t not null default 'draft',
  decision review_decision_t not null default 'none',

  reviewer_actor_id uuid references actors(id),
  review_started_at timestamptz,
  review_completed_at timestamptz,

  spec_refs jsonb,
  plan_refs jsonb,

  change_summary text,
  key_diffs jsonb,
  changed_files text[],

  ai_self_review jsonb,
  ai_independent_review jsonb,
  test_mapping jsonb,
  risk_points jsonb,
  human_decision_questions jsonb,
  final_comments text,

  visibility visibility_t not null default 'project',
  source_type text,
  labels text[] not null default '{}',
  extra jsonb,

  created_at timestamptz not null default now(),
  created_by_actor_id uuid not null references actors(id),
  updated_at timestamptz not null default now(),
  updated_by_actor_id uuid not null references actors(id),
  archived_at timestamptz,
  deleted_at timestamptz,

  unique (org_id, key)
);

create index idx_review_packets_package on review_packets(package_id, created_at desc);
create index idx_review_packets_run_session on review_packets(run_session_id);
create index idx_review_packets_status on review_packets(status, decision);
```

---

## test_evidences

```sql
create table test_evidences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),

  work_item_id uuid references work_items(id),
  package_id uuid references execution_packages(id),
  run_session_id uuid references run_sessions(id),

  key text not null,
  title text,
  description text,

  layer test_layer_t not null,
  status test_status_t not null,

  summary text,
  metrics jsonb,
  artifact_id uuid,

  visibility visibility_t not null default 'project',
  source_type text,
  labels text[] not null default '{}',
  extra jsonb,

  created_at timestamptz not null default now(),
  created_by_actor_id uuid not null references actors(id),
  updated_at timestamptz not null default now(),
  updated_by_actor_id uuid not null references actors(id),
  archived_at timestamptz,
  deleted_at timestamptz,

  unique (org_id, key)
);

create index idx_test_evidences_package on test_evidences(package_id);
create index idx_test_evidences_run on test_evidences(run_session_id);
create index idx_test_evidences_work_item on test_evidences(work_item_id);
```

---

## releases

Release 是交付编排对象，不是普通任务。PRD 要求它聚合多个 Work Items / Packages 和证据。

```sql
create table releases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  key text not null,
  title text not null,
  description text,

  phase release_phase_t not null default 'draft',
  activity_state release_activity_state_t not null default 'idle',
  gate_state release_gate_state_t not null default 'not_submitted',
  resolution release_resolution_t not null default 'none',

  release_owner_actor_id uuid not null references actors(id),
  release_type release_type_t not null default 'normal',

  scope_summary text,
  risk_summary jsonb,
  rollout_strategy jsonb,
  rollback_plan jsonb,
  observation_plan jsonb,

  rollout_started_at timestamptz,
  rollout_completed_at timestamptz,
  observed_until timestamptz,

  visibility visibility_t not null default 'project',
  source_type text,
  labels text[] not null default '{}',
  extra jsonb,

  created_at timestamptz not null default now(),
  created_by_actor_id uuid not null references actors(id),
  updated_at timestamptz not null default now(),
  updated_by_actor_id uuid not null references actors(id),
  archived_at timestamptz,
  deleted_at timestamptz,

  unique (org_id, key)
);

create index idx_releases_project_phase on releases(project_id, phase);
create index idx_releases_owner_phase on releases(release_owner_actor_id, phase);
```

## release_work_items / release_execution_packages / release_evidences

```sql
create table release_work_items (
  release_id uuid not null references releases(id) on delete cascade,
  work_item_id uuid not null references work_items(id) on delete cascade,
  primary key (release_id, work_item_id)
);

create table release_execution_packages (
  release_id uuid not null references releases(id) on delete cascade,
  package_id uuid not null references execution_packages(id) on delete cascade,
  primary key (release_id, package_id)
);

create table release_evidences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  release_id uuid not null references releases(id) on delete cascade,

  key text not null,
  title text,
  description text,

  evidence_type text not null,
  artifact_id uuid,
  summary text,

  visibility visibility_t not null default 'project',
  source_type text,
  labels text[] not null default '{}',
  extra jsonb,

  created_at timestamptz not null default now(),
  created_by_actor_id uuid not null references actors(id),
  updated_at timestamptz not null default now(),
  updated_by_actor_id uuid not null references actors(id),

  unique (org_id, key)
);

create index idx_release_evidences_release on release_evidences(release_id);
```

---

# 6) 回放与进化层

## incidents

PRD 要求 Incident 可回链到 Release / Work Item / Package，并用于全链路复盘。

```sql
create table incidents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  key text not null,
  title text not null,
  description text,

  severity incident_severity_t not null,
  status incident_status_t not null default 'open',
  activity_state incident_activity_state_t not null default 'idle',
  resolution incident_resolution_t not null default 'none',

  detected_at timestamptz not null,
  resolved_at timestamptz,

  impact_scope jsonb,
  symptom_summary text,
  root_cause_summary text,

  primary_release_id uuid references releases(id),
  primary_work_item_id uuid references work_items(id),
  primary_package_id uuid references execution_packages(id),

  mitigation_actions jsonb,
  rollback_actions jsonb,
  retrospective_doc_ref text,

  visibility visibility_t not null default 'project',
  source_type text,
  labels text[] not null default '{}',
  extra jsonb,

  created_at timestamptz not null default now(),
  created_by_actor_id uuid not null references actors(id),
  updated_at timestamptz not null default now(),
  updated_by_actor_id uuid not null references actors(id),
  archived_at timestamptz,
  deleted_at timestamptz,

  unique (org_id, key)
);

create index idx_incidents_project_status on incidents(project_id, status);
create index idx_incidents_severity_detected on incidents(severity, detected_at desc);
```

## incident_links

```sql
create table incident_links (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents(id) on delete cascade,
  object_type incident_link_object_type_t not null,
  object_id uuid not null,
  role incident_link_role_t not null default 'related',
  created_at timestamptz not null default now(),
  created_by_actor_id uuid not null references actors(id)
);

create index idx_incident_links_incident on incident_links(incident_id);
create index idx_incident_links_object on incident_links(object_type, object_id);
```

---

## contracts / contract_revisions / package_contract_links

多端联调和 Contract-first / Mock-first 是 PRD 的正式要求，所以 schema 里最好预留。

```sql
create table contracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  key text not null,
  title text not null,
  description text,

  kind contract_kind_t not null,
  status contract_status_t not null default 'draft',
  gate_state contract_gate_state_t not null default 'not_submitted',
  resolution contract_resolution_t not null default 'none',

  current_revision_id uuid,
  approved_revision_id uuid,
  provider_package_id uuid references execution_packages(id),

  visibility visibility_t not null default 'project',
  source_type text,
  labels text[] not null default '{}',
  extra jsonb,

  created_at timestamptz not null default now(),
  created_by_actor_id uuid not null references actors(id),
  updated_at timestamptz not null default now(),
  updated_by_actor_id uuid not null references actors(id),
  archived_at timestamptz,
  deleted_at timestamptz,

  unique (org_id, key)
);

create table contract_revisions (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts(id) on delete cascade,
  revision_no int not null,
  version text not null,
  compatibility_mode compatibility_mode_t not null,

  summary text,
  payload_schema jsonb,
  sample_payloads jsonb,
  mock_assets jsonb,

  approved_by_actor_id uuid references actors(id),
  approved_at timestamptz,

  created_at timestamptz not null default now(),
  created_by_actor_id uuid not null references actors(id),

  unique (contract_id, revision_no),
  unique (contract_id, version)
);

create table package_contract_links (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references execution_packages(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  contract_revision_id uuid references contract_revisions(id),
  role contract_link_role_t not null,
  created_at timestamptz not null default now(),
  created_by_actor_id uuid not null references actors(id),
  unique (package_id, contract_id, role)
);

create index idx_package_contract_links_package on package_contract_links(package_id);
create index idx_package_contract_links_contract on package_contract_links(contract_id);
```

---

## artifacts

PRD 中的日志、补丁、测试报告、trace、截图，本质上都应收敛到 Artifact。

```sql
create table artifacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  project_id uuid references projects(id),

  owner_object_type artifact_owner_type_t not null,
  owner_object_id uuid not null,

  artifact_type artifact_type_t not null,
  storage_uri text not null,
  content_type text,
  size_bytes bigint,
  checksum text,

  created_at timestamptz not null default now(),
  created_by_actor_id uuid not null references actors(id)
);

create index idx_artifacts_owner on artifacts(owner_object_type, owner_object_id);
create index idx_artifacts_type on artifacts(artifact_type);
```

---

## object_events

细粒度动作不要做状态，进事件表。PRD 对 Event / Trace / Replay 是强要求。

```sql
create table object_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  project_id uuid references projects(id),

  object_type object_type_t not null,
  object_id uuid not null,
  event_type object_event_type_t not null,

  actor_type actor_type_t not null,
  actor_id uuid references actors(id),

  occurred_at timestamptz not null default now(),
  reason text,
  payload jsonb
);

create index idx_object_events_object on object_events(object_type, object_id, occurred_at desc);
create index idx_object_events_project_time on object_events(project_id, occurred_at desc);
```

---

## status_histories

```sql
create table status_histories (
  id uuid primary key default gen_random_uuid(),

  object_type object_type_t not null,
  object_id uuid not null,

  field_name status_field_name_t not null,
  from_value text,
  to_value text not null,

  changed_by_actor_type actor_type_t not null,
  changed_by_actor_id uuid references actors(id),

  changed_at timestamptz not null default now(),
  reason text,
  context jsonb
);

create index idx_status_histories_object on status_histories(object_type, object_id, changed_at desc);
```

---

## decisions

```sql
create table decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  project_id uuid references projects(id),

  object_type object_type_t not null,
  object_id uuid not null,

  decision_type decision_type_t not null,
  outcome text not null,
  decided_by_actor_id uuid not null references actors(id),
  rationale text,
  evidence_refs jsonb,

  created_at timestamptz not null default now()
);

create index idx_decisions_object on decisions(object_type, object_id, created_at desc);
```

---

# 7) 循环外键补齐

前面故意把几个循环 FK 留到了最后。现在补上。

```sql
alter table work_items
  add constraint fk_work_items_current_spec
  foreign key (current_spec_id) references specs(id);

alter table work_items
  add constraint fk_work_items_current_spec_revision
  foreign key (current_spec_revision_id) references spec_revisions(id);

alter table work_items
  add constraint fk_work_items_current_plan
  foreign key (current_plan_id) references plans(id);

alter table work_items
  add constraint fk_work_items_current_plan_revision
  foreign key (current_plan_revision_id) references plan_revisions(id);

alter table work_items
  add constraint fk_work_items_current_release
  foreign key (current_release_id) references releases(id);

alter table specs
  add constraint fk_specs_current_revision
  foreign key (current_revision_id) references spec_revisions(id);

alter table specs
  add constraint fk_specs_approved_revision
  foreign key (approved_revision_id) references spec_revisions(id);

alter table plans
  add constraint fk_plans_current_revision
  foreign key (current_revision_id) references plan_revisions(id);

alter table plans
  add constraint fk_plans_approved_revision
  foreign key (approved_revision_id) references plan_revisions(id);

alter table execution_packages
  add constraint fk_packages_current_run
  foreign key (current_run_session_id) references run_sessions(id);

alter table execution_packages
  add constraint fk_packages_current_review_packet
  foreign key (current_review_packet_id) references review_packets(id);

alter table execution_packages
  add constraint fk_packages_current_release
  foreign key (current_release_id) references releases(id);

alter table contracts
  add constraint fk_contracts_current_revision
  foreign key (current_revision_id) references contract_revisions(id);

alter table contracts
  add constraint fk_contracts_approved_revision
  foreign key (approved_revision_id) references contract_revisions(id);
```

---

# 8) 3 个我强烈建议做 trigger 的地方

第一，`updated_at` 自动刷新。
第二，`status_histories` 和 `object_events` 自动记录。
第三，Execution Package 的 revision 一致性校验。

### revision 一致性 trigger 要保证

* package 的 `plan_id` 属于该 `plan_revision_id`
* package 的 `spec_id` 属于该 `spec_revision_id`
* `plan_revision.based_on_spec_revision_id` 与 package 的 `spec_revision_id` 一致，或者至少有明确定义的允许偏差策略

这个非常重要，不然你后面 replay 会漂。PRD 已经明确要求从任一核心对象双向追溯上下游及跨端依赖。

---

# 9) V1 暂不单独建的表

V1 我建议先不单独建这些一级对象：

* iterations
* milestones
* environments
* builds / versions
* test_strategies / test_assets 独立主表
* rule_proposals / skill_proposals / template_proposals 独立主表

原因不是它们不重要，而是你的 PRD 主闭环里，先把 Work Item → Spec → Plan → Package → Run → Review → Release → Incident/Replay 跑顺最重要。PRD 也允许流程深度、门禁、模板、策略可配置，所以这些都适合在 P2/P3 升级。

---

# 10) 我对这版 schema 的最终评价

这版的好处是：

* **对象分层清楚**：不会把 Work Item 和 Execution Package 混成一个大表
* **revision 清楚**：Spec / Plan / Contract 都能审计和回放
* **关系基数正确**：尤其是 **PlanRevision 1-N Packages**
* **状态不过载**：phase / activity / gate / resolution 分层
* **证据链完整**：RunSession / ReviewPacket / TestEvidence / Artifact / Event / Decision
* **兼容你后面用 Codex 做执行器**：`run_spec`、`skill_refs`、`sandbox`、`allowed_paths` 都留好了

它和你 PRD 里“Execution Package 是执行原语”“Review 是结构化判断”“Everything Traceable”“交付与进化双主线闭环”的要求是一致的。

---

## 下一步最应该做的事

不是继续加表，而是立刻做这 3 件事：

一是把这版 schema 收敛成 **真正的 migration 文件**。
二是把 `status transition rules` 写成应用层状态机。
三是把 `RunSpec JSON schema` 和 `ReviewPacket JSON schema` 定下来。

如果你要，我下一条我就直接给你一版 **Prisma / Drizzle / SQL migration 目录结构建议**。

