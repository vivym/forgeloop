# Trace / Evidence Plane 设计方案

## 0. 设计定位

Trace / Evidence Plane 是 Forgeloop 的通用研发轨迹与证据底座，不是单独的事故复盘平台。

它服务于以下场景：

- Work Item / Spec / Plan / Execution Package 的全链路追踪
- RunSession、ReviewPacket、Release 的证据沉淀
- Incident / Postmortem 的证据聚合、冻结与审计
- 员工工作轨迹、AI 代执行轨迹、平台自动执行轨迹
- Repo 级代码演化、PR、CI/CD、部署与事故之间的因果回放
- 组织学习闭环：从轨迹中提炼规则、模板、Skill、流程改进建议

Codex provenance 是第一接入源，但不是唯一来源。后续 CI/CD、Git provider、deploy、review、approval、manual path、其他 agent runtime 都进入同一套底座。

这与 PRD 中的以下原则对齐：

- Everything Traceable
- Learning Loop Built-in
- Execution and Evolution in Closed Loop
- Human Override in Exceptional Cases

---

## 1. 与现有对象模型的关系

Forgeloop 的主链路仍然是：

**Work Item -> Spec -> Plan -> Execution Package -> AI Run -> Review -> Test / Integration Gate -> Release -> Observation -> Incident / Replay / Rule Feedback**

Trace / Evidence Plane 不替代这些业务对象，也不把追踪字段塞进它们的主表。

推荐新增一个独立子域：

- `trace_streams`
- `trace_events`
- `trace_spans`
- `trace_blobs`
- `trace_blob_refs`
- `trace_links`
- `workspace_states`
- `workspace_state_deltas`
- `code_revisions`
- `revision_aliases`
- `recorded_state_aliases`
- `code_range_provenance_index`
- `actors`
- `actor_identities`
- `raw_content_entitlements`

现有业务对象只负责自身业务状态，通过 `TraceLink` 关联证据：

- WorkItem
- Spec / SpecRevision
- Plan / PlanRevision
- ExecutionPackage
- RunSession
- ReviewPacket
- TestEvidence
- Release / ReleaseEvidence
- Incident / Postmortem
- Decision
- ContractRevision

### 1.1 与 ObjectEvent / Artifact 的关系

现有 `ObjectEvent` 和 `Artifact` 继续保留，但它们不是 Trace / Evidence Plane 的底层真相源。

采用如下分工：

- `TraceEvent`：底层不可变研发事实，覆盖技术事件、执行事件、代码 provenance、权限审计和系统链接。
- `TraceBlob`：底层内容寻址 blob 对象，保存完整代码片段、对话、工具输出、日志摘录、证据副本。
- `TraceLink`：底层证据到业务对象的链接投影。
- `ObjectEvent`：业务对象视角的生命周期事件投影，用于 WorkItem / ExecutionPackage / Release / Incident 等页面展示和状态历史。
- `Artifact`：业务对象视角的证据附件投影，背后可以引用一个或多个 `TraceBlobRef`。

规则：

1. 不做无约束 dual-write。
2. 对于来自 Codex、CI/CD、deploy、Git provider 的外部/技术事件，先写 `TraceEvent`，再由投影器生成 `ObjectEvent`、`Artifact`、`StatusHistory` 或业务视图。
3. 对于用户在 Forgeloop 内执行的业务命令，命令事务可以先生成业务事件，但必须同步写入对应 `TraceEvent`，并以 `trace_event_id` 作为审计根。
4. `Artifact.storage_uri` 不直接成为长期真相；它应指向 `TraceBlobRef` 或由 `TraceBlobRef` 派生。
5. `ObjectEvent` 不承载大 payload，大内容必须进入 `TraceBlob`。

这样可以让现有实体设计保持产品语义，同时避免 TraceEvent / TraceBlob 与 ObjectEvent / Artifact 互相抢主权。

---

## 2. 核心原则

### 2.1 Append-only Event Log 是真相源

`TraceEvent` 采用 append-only 事件日志模型。所有关键研发事实先进入 Ledger，再派生出查询索引、时间线、repo view、actor timeline、incident snapshot。

不要把可变状态表当唯一真相源。原因是：

- 审计、回放、复盘需要保留事件历史
- 多源接入天然更适合 append-only ingestion
- 查询模型未来会变化，派生索引可以重建
- incident snapshot 可以从稳定事件集物化

### 2.2 投影表不是事实源

以下表都是投影或索引，不是唯一真相源：

- `trace_spans`
- `trace_links`
- `workspace_states`
- `code_range_provenance_index`
- `actor_timeline`
- `repo_view`
- `ObjectEvent`
- `Artifact`
- `StatusHistory`

它们必须能从 `TraceEvent`、`TraceBlobRef`、外部 provider 快照和明确的 projection version 重建。

### 2.3 TraceSpan / Activity 是主展示单元

`TraceEvent` 是最小事实，但直接展示会过碎。

默认 UI、actor timeline、repo view、incident timeline 应展示 `TraceSpan / Activity`，需要时再 drill down 到 raw events。

v1 span 边界按来源系统天然边界生成，不做重 AI 猜测式聚合。

### 2.4 大内容进入 Blob

`TraceEvent` 本体只内联小型结构化字段。完整对话正文、工具输出、代码片段、日志摘录、artifact 内容等大对象进入 `TraceBlob`，事件只保存 `TraceBlobRef`。

Blob 使用内容寻址和去重存储，但去重边界必须受租户、权限、retention 和 legal hold 约束。

### 2.5 先入账，后关联

事件可以先进入 Ledger，不要求 ingest 时必须绑定所有业务对象。

后续通过 `TraceLink` 关联到 WorkItem、ExecutionPackage、RunSession、Release、Incident 等对象。

但 Codex 执行类事件有更强约束：如果它来自 Forgeloop 调度的正式执行，ingest 时必须携带 `spec_revision_id`、`plan_revision_id`、`execution_package_id`、`run_session_id` 中可用的强链接上下文。否则只能标记为 `unbound_external_trace`，不能进入产品 MVP 的正式执行视图。

### 2.6 CodeRevision 和 WorkspaceState 都是一等代码坐标

代码查询不能只依赖裸 `path + line/range`。

平台必须同时支持：

- `CodeRevision`：用于历史代码、PR、发布、事故回看，对应不可变 Git commit/tree
- `WorkspaceState`：用于未提交代码、AI 连续修改、人工接管、执行中状态

### 2.7 RunSession 和 TraceSpan 分层

`RunSession` 是业务执行对象，面向 ExecutionPackage、审批、编排和工作台。

`TraceSpan` 是证据与时间线对象，面向 replay、actor timeline、repo view、incident evidence。

二者允许强关联，常见情况可以 1:1，但模型上不能强制等同。

---

## 3. SaaS Enrollment 与租户边界

全量上传 + SaaS 托管要求 ingest 边界必须由服务端控制，不能信任客户端声明的 `org_id` / `repo_id`。

### 3.1 RepoEnrollment

Repo 只有被显式 enroll 后才允许上传。

```ts
type RepoEnrollment = {
  id: string;
  org_id: string;
  repo_id: string;
  canonical_remote: string;
  provider_repo_id?: string | null;
  enrollment_mode: 'git_provider_verified' | 'admin_declared';
  enrolled_by_actor_id: string;
  enrolled_at: string;
  status: 'active' | 'paused' | 'revoked';
};
```

规则：

- 优先通过 Git provider 验证 repo 所有权和 org 授权。
- 用户指定 `repo_id` 只作为 enrollment 输入，最终归属由服务端确认。
- 客户端上传时不得自行决定 `org_id` / `repo_id`。

### 3.2 TraceStreamRegistration

每个本地 workspace 实例首次上传前必须注册 stream。

```ts
type TraceStreamRegistration = {
  id: string;
  org_id: string;
  repo_id: string;
  stream_id: string;
  stream_epoch: number;
  workspace_instance_id: string;
  device_id: string;
  actor_id: string;
  enrollment_id: string;
  canonical_remote: string;
  worktree_fingerprint: string;
  registered_at: string;
  revoked_at?: string | null;
};
```

注册流程：

1. 客户端提交 canonical remote、Git root fingerprint、device identity、authenticated user。
2. 服务端解析 repo enrollment，验证 actor 对 repo 的上传权限。
3. 服务端生成 stream token，绑定 `org_id + repo_id + stream_id + stream_epoch + device_id + actor_id`。
4. 后续 ingest 的 org/repo/actor context 从 token 派生，不从 payload 信任。
5. 如果客户端 payload 中的 repo/org/source identity 与 token 不一致，拒绝 ingest 并写入安全审计事件。

### 3.3 Stream epoch

`stream_epoch` 用于处理本地 WAL 损坏、workspace 重建、stream token 轮换。

- `(org_id, stream_id, stream_epoch, seq_no)` 是事件顺序键。
- 同一个 epoch 内 `seq_no` 必须 gapless monotonic。
- 新 epoch 不继承旧 epoch 的 seq，但必须有 `previous_epoch_last_seq_no` 或服务端 revocation record。
- 旧 epoch 被 revoke 后只能补传未确认事件，不能写入新事件。

---

## 4. 核心实体

## 4.0 共享基础类型

下面这些类型被多个实体引用，必须在实现前收敛成统一 schema。

```ts
type ActorRef = {
  actor_id: string;
  actor_kind: 'human' | 'ai_agent' | 'platform' | 'external_service';
  identity_id?: string | null;
};
```

```ts
type ExternalRef = {
  provider: string;
  resource_type: string;
  resource_id: string;
  url?: string | null;
};
```

```ts
type LineRange = {
  start_line: number;
  end_line: number;
  start_column?: number | null;
  end_column?: number | null;
};
```

```ts
type SourceToolRef = {
  source_system: string;
  tool_call_id: string;
  item_id?: string | null;
};
```

```ts
type TraceBlobRefInline = {
  blob_ref_id: string;
  required_for_reconstruction: boolean;
  status: 'pending' | 'available' | 'missing' | 'redacted' | 'expired' | 'checksum_mismatch';
};
```

```ts
type TraceEventPayload =
  | Record<string, unknown>
  | CodeHunkObservedPayload;
```

```ts
type VersionedEvidenceRef = {
  subject_type: 'event' | 'span' | 'blob_ref' | 'workspace_state' | 'code_revision';
  subject_id: string;
  digest?: string | null;
  projection_version?: number | null;
};
```

## 4.1 TraceStream

上传、顺序和恢复的边界。

v1 以本地 workspace 实例为 stream：每个 clone / worktree / device 一条独立 stream。线上再按 repo 聚合。

```ts
type TraceStream = {
  id: string;
  org_id: string;
  repo_id: string;
  workspace_instance_id: string;
  device_id: string;
  stream_epoch: number;
  source_system: 'codex' | 'manual' | 'ci' | 'deploy' | 'git_provider' | 'other_agent';
  canonical_remote: string;
  enrollment_id: string;
  status: 'active' | 'paused' | 'revoked' | 'quarantined';
  last_accepted_seq_no: number;
  last_acked_seq_no: number;
  last_event_hash?: string | null;
  registered_at: string;
  created_at: string;
  updated_at: string;
};
```

关键约束：

- stream 内用 `seq_no` 表达真实顺序。
- 服务端按 `(org_id, stream_id, stream_epoch, seq_no)` 幂等 ingest。
- repo view 不改写 stream 原始事件，只做派生聚合。
- 如果相同顺序键对应不同 `event_hash`，stream 进入 `quarantined`，等待人工或自动修复。

## 4.2 TraceEvent

最小不可变事实。

```ts
type TraceEvent = {
  id: string;
  org_id: string;
  repo_id?: string | null;
  stream_id: string;
  stream_epoch: number;
  seq_no: number;

  schema_version: number;
  event_hash: string;
  previous_event_hash?: string | null;
  idempotency_key: string;

  category:
    | 'execution'
    | 'code_provenance'
    | 'review_quality'
    | 'delivery'
    | 'incident_postmortem'
    | 'system_linkage'
    | 'security_audit'
    | 'identity';

  event_type: string;
  occurred_at: string;
  received_at: string;

  attribution: Attribution;
  source_context: SourceContext;
  causality: EventCausality;

  payload: TraceEventPayload;
  blob_refs: TraceBlobRefInline[];

  scope: TraceScope;
  sensitivity: TraceSensitivity;
};
```

幂等规则：

- 同一 `(stream_id, stream_epoch, seq_no)` + same `event_hash`：返回已有 ack。
- 同一顺序键 + different `event_hash`：拒绝，stream quarantine。
- `seq_no` gap：接受方不得推进 ack cursor，可暂存 out-of-order event，但 projection 不消费。
- `previous_event_hash` 不匹配：拒绝或 quarantine，避免 WAL fork 悄悄污染 ledger。

## 4.3 TraceSpan / Activity

默认展示、回放和时间线单元。

`TraceSpan` 是投影表，由 span lifecycle events 派生。

```ts
type TraceSpan = {
  id: string;
  org_id: string;
  repo_id?: string | null;
  stream_id?: string | null;

  span_type:
    | 'codex_session'
    | 'codex_thread'
    | 'codex_turn'
    | 'ci_pipeline'
    | 'ci_job'
    | 'deploy_run'
    | 'review_session'
    | 'manual_session'
    | 'incident_phase';

  title: string;
  summary?: string | null;
  status: 'open' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'sealed';

  start_event_id: string;
  end_event_id?: string | null;
  started_at: string;
  ended_at?: string | null;

  actor_refs: ActorRef[];
  source_context: SourceContext;
  projection_version: number;
};
```

Source-of-truth events：

- `span.started`
- `span.updated`
- `span.ended`
- `span.summary_generated`
- `span.sealed`

v1 span 边界：

- Codex：session / thread / turn
- CI：pipeline / run / job
- Deploy：deploy run
- Review：review packet / review session
- Human manual work：manual session 或显式操作批次
- Incident：incident lifecycle phase

## 4.4 TraceBlob 与 TraceBlobRef

`TraceBlob` 是内容对象，`TraceBlobRef` 是某个事件/对象对内容的引用和策略承载点。

```ts
type TraceBlob = {
  id: string;
  org_id: string;
  tenant_scoped_hash: string;
  content_digest: string;
  digest_algorithm: 'sha256';
  content_type: string;
  byte_size: number;
  storage_uri: string;
  encryption_key_ref: string;
  status: 'pending' | 'available' | 'checksum_mismatch' | 'redacted' | 'expired' | 'deleted';
  created_at: string;
};
```

```ts
type TraceBlobRef = {
  id: string;
  org_id: string;
  blob_id?: string | null;
  expected_digest: string;
  digest_algorithm: 'sha256';
  expected_byte_size?: number | null;
  content_type: string;
  ref_kind:
    | 'conversation_full'
    | 'conversation_excerpt'
    | 'tool_output'
    | 'code_fragment'
    | 'file_snapshot'
    | 'patch'
    | 'diff'
    | 'ci_log_excerpt'
    | 'deploy_log_excerpt'
    | 'artifact'
    | 'postmortem_evidence_copy';
  required_for_reconstruction: boolean;
  sensitivity: TraceSensitivity;
  scope: TraceScope;
  retention_policy_id?: string | null;
  legal_hold: boolean;
  status: 'pending' | 'available' | 'missing' | 'redacted' | 'expired' | 'checksum_mismatch';
  created_at: string;
};
```

去重与保留规则：

- v1 只做 org 内去重，不做跨 tenant 明文 hash 去重。
- `tenant_scoped_hash = HMAC(org_blob_salt, content_digest)`，避免跨 tenant 内容存在性泄漏。
- retention / legal hold 挂在 `TraceBlobRef` 上，物理 blob 的有效保留期是所有引用策略的最强约束。
- 所有引用过期且无法律保留后，才能删除或 crypto-shred 物理 blob。
- 查询必须区分 `available`、`pending`、`missing`、`redacted`、`expired`、`checksum_mismatch`，不能静默降级成空内容。

适合放入 Blob 的内容：

- 完整对话正文
- 工具输出
- 代码片段 / 文件片段
- CI / deploy 日志摘录
- artifact 引用或小型 artifact 内容
- postmortem snapshot 中物化的证据副本

## 4.5 TraceLink

把证据关联到业务对象。

`TraceLink` 是投影表，source of truth 是 link lifecycle events。

```ts
type TraceLink = {
  id: string;
  org_id: string;

  subject_type: 'event' | 'span' | 'blob_ref' | 'workspace_state' | 'code_revision';
  subject_id: string;

  object_type:
    | 'work_item'
    | 'spec_revision'
    | 'plan_revision'
    | 'execution_package'
    | 'run_session'
    | 'review_packet'
    | 'test_evidence'
    | 'release'
    | 'release_evidence'
    | 'incident'
    | 'postmortem_snapshot'
    | 'decision'
    | 'contract_revision';
  object_id: string;

  link_type:
    | 'origin'
    | 'evidence'
    | 'caused_by'
    | 'verified_by'
    | 'deployed_by'
    | 'regressed_by'
    | 'fixed_by'
    | 'reviewed_by'
    | 'approved_by'
    | 'related';

  confidence: 'explicit' | 'derived' | 'suggested';
  status: 'active' | 'removed' | 'superseded';
  created_by_event_id: string;
  removed_by_event_id?: string | null;
  created_at: string;
  removed_at?: string | null;
};
```

Source-of-truth events：

- `trace_link.created`
- `trace_link.removed`
- `trace_link.superseded`
- `trace_link.confidence_changed`

不要把 `actor_timeline` 和 `repo_view` 作为 TraceLink 目标，因为它们是派生视图。若需要冻结某个视图，必须先生成 versioned snapshot，再链接 snapshot。

## 4.6 WorkspaceState

未提交代码状态的一等坐标。

```ts
type WorkspaceState = {
  id: string;
  org_id: string;
  repo_id: string;
  stream_id: string;
  stream_epoch: number;

  state_ref: string;
  parent_state_ref?: string | null;
  projection_version: number;

  base_code_revision_id?: string | null;
  git_commit_oid?: string | null;
  git_tree_oid?: string | null;

  checkpoint_blob_ref_id?: string | null;
  created_by_event_id: string;
  created_at: string;
};
```

`WorkspaceState` 是逻辑一等对象，但底层不默认保存每个状态的完整文件树。

### 4.6.1 WorkspaceStateDelta

```ts
type WorkspaceStateDelta = {
  id: string;
  org_id: string;
  workspace_state_id: string;
  parent_state_ref?: string | null;

  path_before?: string | null;
  path_after?: string | null;
  change_kind: 'add' | 'update' | 'delete' | 'rename' | 'mode_change' | 'ambiguous';

  before_blob_ref_id?: string | null;
  after_blob_ref_id?: string | null;
  patch_blob_ref_id?: string | null;

  before_content_digest?: string | null;
  after_content_digest?: string | null;
  mode_before?: string | null;
  mode_after?: string | null;

  hunk_ids: string[];
  created_by_event_id: string;
};
```

重建规则：

- 每个 state 必须能沿 `parent_state_ref` 回到一个 checkpoint 或 CodeRevision。
- 每条 delta 必须说明 path、change kind、before/after content digest。
- rename/delete/recreate 无法证明时标记 `ambiguous`，不能猜测 file identity。
- required blob pending/missing 时，range 查询返回 `Unavailable` 或 `Partial`，不得给出伪精确 lineage。
- 系统应按距离或大小策略生成 checkpoint，避免 parent chain 无限增长。

## 4.7 CodeRevision 与 RevisionAlias

`CodeRevision` 表示不可变 Git revision。

```ts
type CodeRevision = {
  id: string;
  org_id: string;
  repo_id: string;
  commit_oid: string;
  tree_oid: string;
  parent_commit_oids: string[];
  authored_at?: string | null;
  committed_at?: string | null;
  provider_ref?: ExternalRef | null;
  created_at: string;
};
```

`RevisionAlias` 表示某个可变 ref 在某一时刻解析到哪个 immutable revision。

```ts
type RevisionAlias = {
  id: string;
  org_id: string;
  repo_id: string;
  alias_type: 'branch' | 'tag' | 'pull_request' | 'release' | 'deploy_ref';
  alias_name: string;
  code_revision_id: string;
  resolved_at: string;
  source: 'git_provider' | 'client' | 'deploy_system';
  provider_ref?: ExternalRef | null;
};
```

`RecordedStateAlias` 把真实 Git revision/tree 映射到系统记录过的 WorkspaceState 或 projection。

```ts
type RecordedStateAlias = {
  id: string;
  org_id: string;
  repo_id: string;
  code_revision_id?: string | null;
  tree_oid: string;
  workspace_state_id: string;
  exact: boolean;
  created_by_event_id: string;
  created_at: string;
};
```

历史查询规则：

- branch / tag / PR 可以作为输入，但必须先解析到确定 `CodeRevision`。
- 只有命中 exact `RecordedStateAlias` 或可重建 state 时，才返回 range provenance。
- 不做 fuzzy match。

## 4.8 CodeRangeProvenanceIndex

范围查询的派生索引，不是真相源。

支持：

```text
repo + (CodeRevision | WorkspaceState) + path + line/range -> lineage
```

查询结果回到：

- TraceEvent
- TraceSpan
- Codex turn / tool refs
- WorkspaceState
- CodeRevision
- TraceBlobRef
- TraceLink

### 4.8.1 Canonical code provenance payload

范围索引必须从 canonical code provenance events 派生，不能从泛型 JSON 猜。

```ts
type CodeHunkObservedPayload = {
  workspace_state_id: string;
  code_revision_id?: string | null;

  file_identity_id: string;
  change_kind: 'add' | 'update' | 'delete' | 'rename' | 'move' | 'ambiguous';

  path_before?: string | null;
  path_after?: string | null;

  hunk_id: string;
  parent_hunk_ids: string[];
  origin_hunk_id?: string | null;

  before_range?: LineRange | null;
  after_range?: LineRange | null;

  before_content_digest?: string | null;
  after_content_digest?: string | null;
  before_context_digest?: string | null;
  after_context_digest?: string | null;

  patch_blob_ref_id?: string | null;
  before_blob_ref_id?: string | null;
  after_blob_ref_id?: string | null;

  tool_call_refs: SourceToolRef[];
  observation_confidence: 'exact' | 'ambiguous' | 'partial';
};
```

必须覆盖的 event types：

- `code.workspace_state_created`
- `code.file_delta_observed`
- `code.hunk_observed`
- `code.revision_alias_resolved`
- `code.recorded_state_alias_created`
- `code.provenance_repair_applied`
- `code.provenance_marked_ambiguous`

---

## 5. 事件分类与 payload 合同

事件一级分类按证据语义划分，而不是按来源系统划分。

### Execution events

- `execution.run_queued`
- `execution.run_started`
- `execution.tool_call_started`
- `execution.tool_call_completed`
- `execution.manual_action_recorded`
- `execution.handoff_requested`
- `execution.run_succeeded`
- `execution.run_failed`

### Code provenance events

- `code.workspace_state_created`
- `code.file_delta_observed`
- `code.hunk_observed`
- `code.revision_alias_resolved`
- `code.recorded_state_alias_created`
- `code.provenance_repair_applied`
- `code.provenance_marked_ambiguous`

### Review / quality events

- `review.packet_created`
- `review.ai_self_review_completed`
- `review.ai_independent_review_completed`
- `review.human_decision_recorded`
- `quality.test_evidence_recorded`
- `quality.gate_passed`
- `quality.gate_failed`
- `ci.run_observed`

### Delivery events

- `delivery.build_observed`
- `delivery.artifact_recorded`
- `delivery.deploy_started`
- `delivery.deploy_succeeded`
- `delivery.deploy_failed`
- `delivery.rollback_started`
- `delivery.rollback_completed`
- `delivery.environment_observed`

### Incident / postmortem events

- `incident.created`
- `incident.evidence_attached`
- `incident.evidence_detached`
- `incident.snapshot_sealed`
- `postmortem.revision_added`
- `postmortem.ai_artifact_generated`

### System linkage events

- `trace_link.created`
- `trace_link.removed`
- `trace_link.superseded`
- `alias.resolved`
- `external_ref.attached`

### Security / audit events

- `security.stream_registered`
- `security.stream_revoked`
- `security.ingest_rejected`
- `security.raw_access_requested`
- `security.raw_access_granted`
- `security.raw_access_denied`
- `security.raw_access_used`
- `security.raw_access_revoked`
- `security.break_glass_used`
- `security.export_attempted`
- `security.retention_policy_changed`
- `security.legal_hold_changed`
- `security.blob_redacted`
- `security.blob_deleted`

### Identity events

- `identity.claimed`
- `identity.verified`
- `identity.merged`
- `identity.split`
- `identity.disabled`

---

## 6. 归因模型

每个事件至少拆以下维度：

```ts
type Attribution = {
  initiator: ActorRef;
  accountable_actor?: ActorRef | null;
  effective_executor: ActorRef;

  on_behalf_of?: ActorRef | null;
  delegated_by?: ActorRef | null;
  requested_by?: ActorRef | null;
  approved_by?: ActorRef | null;

  accountable_source:
    | 'explicit_owner'
    | 'execution_package_owner'
    | 'run_session_owner'
    | 'repo_owner_rule'
    | 'platform_rule'
    | 'manual_override'
    | 'unknown';

  attribution_reason?: string | null;
  attribution_confidence: 'explicit' | 'derived' | 'suggested' | 'unknown';
};
```

含义：

- `initiator`：谁触发动作。可能是 human、platform_rule、external_event、system_admin。
- `accountable_actor`：动作最终归属给谁。通常是 owner、员工或平台系统账号。
- `effective_executor`：实际执行者。可能是 human、codex、other_agent、ci、deploy。
- `on_behalf_of`：AI 或系统动作代表谁执行。
- `delegated_by/requested_by/approved_by`：用于解释自动执行或代执行链路。
- `attribution_confidence`：用于员工轨迹和绩效参考，避免把推断结果当硬事实。

员工轨迹至少分四条 lane：

- initiated
- accountable
- executed
- reviewed / approved

平台自动发起的动作同时进入：

- system / platform timeline
- accountable owner 的个人轨迹

但在个人轨迹中必须标注 `platform-initiated`，不能伪装成人工动作。

---

## 7. Actor 与身份归并

## 7.1 Actor

统一主体模型。

```ts
type Actor = {
  id: string;
  org_id: string;
  kind: 'human' | 'ai_agent' | 'platform' | 'external_service';
  display_name: string;
  status: 'active' | 'disabled' | 'archived';
  created_at: string;
};
```

## 7.2 ActorIdentity

外部身份归并。`ActorIdentity` 是投影表，身份变化必须来自 identity events。

```ts
type ActorIdentity = {
  id: string;
  org_id: string;
  actor_id: string;
  provider:
    | 'forgeloop'
    | 'codex'
    | 'git'
    | 'github'
    | 'gitlab'
    | 'ci'
    | 'deploy'
    | 'lark'
    | 'email';
  external_id: string;
  external_display?: string | null;
  verified: boolean;
  effective_from: string;
  effective_to?: string | null;
  created_by_event_id: string;
};
```

查询必须声明身份归并模式：

- `as_of_event_time`：按事件发生时的身份映射查询，适合审计和历史复盘。
- `current_mapping`：按当前身份归并查询，适合当前员工工作台。

绩效相关视图默认使用 `as_of_event_time`，并展示后续身份合并/拆分造成的解释信息。

---

## 8. SourceContext

`SourceContext` 承接来源系统细节。它是查询维度，不是业务主对象。

Codex 事件应包含：

```ts
type CodexSourceContext = {
  source_system: 'codex';
  codex_session_id?: string | null;
  codex_thread_id?: string | null;
  codex_turn_id?: string | null;
  codex_item_id?: string | null;
  codex_tool_call_id?: string | null;
  workspace_state_id?: string | null;
  projection_version?: number | null;
  git_commit_oid?: string | null;
};
```

Forgeloop 执行上下文应包含：

```ts
type ForgeloopExecutionContext = {
  source_system: 'forgeloop';
  work_item_id?: string | null;
  spec_revision_id?: string | null;
  plan_revision_id?: string | null;
  execution_package_id?: string | null;
  run_session_id?: string | null;
  review_packet_id?: string | null;
  release_id?: string | null;
};
```

CI 事件可包含：

```ts
type CiSourceContext = {
  source_system: 'ci';
  provider: 'github_actions' | 'gitlab_ci' | 'buildkite' | 'jenkins' | 'other';
  pipeline_id?: string | null;
  run_id?: string | null;
  job_id?: string | null;
  step_id?: string | null;
};
```

Deploy 事件可包含：

```ts
type DeploySourceContext = {
  source_system: 'deploy';
  provider: string;
  deployment_id: string;
  environment: string;
  artifact_ref?: string | null;
};
```

---

## 9. EventCausality 与 repo 排序

Repo view 采用 `causal order first, event time second`，但正确性不能依赖 wall-clock。

```ts
type EventCausality = {
  parent_event_ids: string[];
  follows_event_ids: string[];
  caused_by_event_ids: string[];
  workspace_parent_state_ref?: string | null;
  code_parent_commit_oids: string[];
  external_parent_refs: ExternalRef[];
};
```

排序规则：

1. 同一 stream epoch 内按 gapless `seq_no` 排序。
2. 显式 `parent_event_ids/follows_event_ids/caused_by_event_ids` 形成跨 stream partial order。
3. WorkspaceState parent chain 形成代码状态因果边。
4. Git commit DAG 形成 revision 因果边。
5. CI/deploy/provider 的 parent/run dependency 形成外部系统因果边。
6. 如果两组事件没有可靠因果边，只能展示为 `concurrent / uncertain`，不得强行给出确定先后。

---

## 10. Codex v1 接入范围

Codex 是第一接入方，v1 至少采集：

- session
- thread
- turn
- item
- tool call
- workspace state anchor
- code provenance observations
- conversation excerpts / full content blob refs
- artifact refs
- Forgeloop execution context：`spec_revision_id`、`plan_revision_id`、`execution_package_id`、`run_session_id`

Codex 的 session / thread / turn 是可查询技术对象和 drill-down 维度，但不是员工轨迹的主对象。

员工轨迹默认看 `TraceSpan / Activity`，再下钻到 Codex turn、tool call、code provenance。

### 10.1 Codex provenance 的核心要求

Codex provenance 不应只提供 git blame 式答案。

它需要回答：

- 某个 repo/revision/path/range 对应哪些 hunk lineage
- 哪个 turn 首次引入
- 后续哪些 turn 修改
- 关联哪些 tool call、patch、command、artifact
- 当时的用户意图和 assistant 上下文是什么

### 10.2 Codex 到 Forgeloop 的职责边界

Codex 负责：

- 本地采集代码与对话 provenance
- 形成 workspace stream
- 先本地 durable outbox / WAL
- 上传 metadata / lineage / blob refs
- 上传完整内容 blob

Forgeloop 负责：

- stream enrollment 与 token 校验
- 多租户 ingest
- repo 聚合
- actor 归并
- range provenance index
- business object linking
- incident / postmortem / actor timeline / repo view
- 权限、审计、retention、legal hold

---

## 11. 本地 outbox / WAL 与上传协议

已定策略：metadata / lineage 近实时上传，大 blob 异步上传。本地机器未永久损坏时，链路不能主动丢失。

### 11.1 LocalOutboxRecord

```ts
type LocalOutboxRecord = {
  stream_id: string;
  stream_epoch: number;
  seq_no: number;
  event_id: string;
  event_hash: string;
  previous_event_hash?: string | null;
  event_payload_path: string;
  blob_manifest_paths: string[];
  status: 'pending' | 'sent' | 'acked' | 'conflict' | 'blocked';
  created_at: string;
  last_attempt_at?: string | null;
};
```

本地规则：

- 事件 record 和 blob manifest 必须先 durable 落盘，再允许上传。
- 事件 record 与对应 blob manifest 的写入需要同一事务语义；至少要有 recoverable two-phase marker。
- 本地 blob 文件写入必须 atomic rename，避免半文件被引用。
- 敏感 blob 在本地缓冲中也必须加密。
- 默认不丢链路数据；磁盘达到阈值时告警、暂停新采集或降级 UI，但不得静默删除已采集事件。
- GC 必须以 server ack + blob ack + retention/local policy 为前提。

### 11.2 服务端 ingest 状态机

事件状态：

- `received`
- `accepted_pending_blobs`
- `accepted_complete`
- `duplicate_same`
- `duplicate_conflict`
- `rejected`
- `quarantined`

Blob 状态：

- `manifest_received`
- `uploading`
- `available`
- `checksum_mismatch`
- `missing`
- `redacted`
- `expired`

Ack 语义：

- event ack：事件已在服务端 durable commit，并通过顺序/hash 校验。
- blob ack：blob content 已通过 checksum 校验并 durable commit。
- cursor ack：服务端已连续接受到某个 seq_no，客户端可以推进 `last_acked_seq_no`。
- projection ack：不作为客户端 GC 的必要条件。

### 11.3 Blob pending 查询行为

- 如果 blob 只影响 raw 展开，聚合视图可显示 metadata，并标注 `content_pending`。
- 如果 blob 是重建 WorkspaceState 或 provenance index 必需内容，range 查询必须返回 `Unavailable` 或 `Partial`。
- checksum mismatch 必须触发 security/audit event，并阻止对应内容进入索引。

---

## 12. 云端同步策略

已定策略：

- SaaS 托管
- 全量上传能力
- 只允许显式 enrolled repo 上传
- 客户端进入 enrolled repo 后自动采集和上传
- 上传以 workspace stream 为主
- repo view 是服务端派生聚合
- metadata / lineage 近实时上传
- 大 blob 异步上传
- 本地 append-only outbox / WAL 优先，不主动丢链路
- repo enroll 后，best-effort 回传本地仍存在的历史 provenance
- 内容寻址去重，但 v1 仅 org 内去重
- 服务端明文索引仅限通过安全策略允许的内容
- 长期保留，支持 retention policy 和 legal hold

### 12.1 可靠性边界

当前不要求覆盖“终端永久损坏且未同步完成”的极端场景。

v1 要保证：

- 本地进程崩溃可恢复
- 客户端重启可恢复
- 网络波动可补传
- 服务端短期不可用可积压
- 不主动丢弃链路数据

---

## 13. 隐私、安全与明文索引边界

全量上传不等于所有内容都可明文索引、默认可看、默认可长期保留。

### 13.1 加密与 KMS

- `TraceBlob.encryption_key_ref` 必填。
- v1 使用 org-scoped KMS key；高敏 org 可升级到 repo-scoped key。
- 明文索引只在受控 indexer 内发生，索引本身也要记录 sensitivity 和 policy scope。
- secret/PII/credential 命中后，默认不进入全文索引，只保留 redacted excerpt 和安全审计。

### 13.2 本地排除与扫描

客户端和服务端都需要支持：

- repo-level exclude rules
- file glob denylist
- max file size / max output size
- binary file skip
- secret scanning
- PII scanning
- credential redaction

扫描结果写入 `security.audit` 事件。

### 13.3 TraceScope

```ts
type TraceScope = {
  org_id: string;
  repo_id?: string | null;
  project_id?: string | null;
  owner_actor_id?: string | null;
  visibility: 'private_actor' | 'run_session' | 'execution_package' | 'repo' | 'project' | 'incident' | 'org_audit';
};
```

### 13.4 TraceSensitivity

```ts
type TraceSensitivity =
  | 'metadata'
  | 'source_excerpt'
  | 'source_full'
  | 'conversation_excerpt'
  | 'conversation_full'
  | 'tool_output'
  | 'secret_suspected'
  | 'regulated'
  | 'security_audit';
```

默认规则：

- unlinked event 的 metadata 默认只对 stream owner、repo admin、org audit 可见。
- unlinked raw blob 默认不可展开。
- 多个 link 关联同一证据时，raw 访问采用最严格 policy；metadata 摘要采用最小必要原则。
- repo/actor 派生视图可以展示 restricted raw 的非敏感摘要，但必须标注内容受限，且摘要生成也受权限过滤。

---

## 14. Raw content entitlement 与审计

由于 Phase 1 就会接收 raw blobs，最小 raw-content 权限闭环必须进入 Phase 1。

```ts
type RawContentEntitlement = {
  id: string;
  org_id: string;
  subject_actor_id: string;
  scope: TraceScope;
  allowed_sensitivity: TraceSensitivity[];
  reason: string;
  granted_by_actor_id: string;
  approved_by_actor_id?: string | null;
  starts_at: string;
  expires_at: string;
  revoked_at?: string | null;
  status: 'active' | 'expired' | 'revoked';
};
```

必须审计的操作：

- raw access request / grant / deny / use / revoke
- break-glass access
- export attempt
- blob redaction / deletion
- retention policy change
- legal hold change
- snapshot seal
- stream registration / revocation
- ingest rejection / quarantine

原始内容默认不可导出。导出尝试即使被拒绝，也必须写审计事件。

---

## 15. Retention、Legal Hold 与 Redaction

Retention 适用于：

- TraceEvent metadata
- TraceBlob
- TraceBlobRef
- derived indexes
- postmortem snapshots
- local WAL / outbox
- temporary caches

规则：

- retention clock 默认从 `created_at` 开始；incident snapshot 可从 `sealed_at` 开始单独计算。
- legal hold 挂在 `TraceBlobRef`、snapshot、incident 或 org policy 上。
- append-only ledger 中不能直接物理修改历史事件；需要通过 redaction/tombstone event 表达。
- blob 可通过 crypto-shred 或删除物理对象完成内容删除，ledger 保留 redacted metadata。
- derived index 必须响应 redaction/tombstone，移除或降级对应内容。
- local WAL 在 server ack + policy 允许后才能清理。

---

## 16. 权限模型

不要在每个 `TraceEvent` 上维护复杂 ACL。

推荐：

- `TraceEvent / TraceBlobRef` 自带 `scope` 和 `sensitivity`
- 访问控制主要通过 linked object policy 派生
- 原始内容展开走额外 entitlement / approval
- snapshot 物化时复制当时访问策略和审计记录

已定权限原则：

- repo 权限可看聚合复盘视图
- 原始对话、工具输出、代码片段展开需要更高权限
- 少数审计管理员可直接展开
- 其他人按次申请
- 原始内容默认不可导出，只能在线查看
- 默认长期保留，支持组织级 retention policy 和 legal hold

---

## 17. Forgeloop 状态投影合同

Trace 事件不能只“记录事实”，还必须定义如何影响业务对象状态。

### 17.1 ExecutionPackage / RunSession

- `execution.run_queued` -> RunSession `queued`
- `execution.run_started` -> RunSession `running`，ExecutionPackage `AI Running`
- `execution.run_failed` -> RunSession `failed`，ExecutionPackage 进入失败/重试分支
- `execution.run_succeeded` -> RunSession `succeeded`，触发 ReviewPacket 生成
- `execution.handoff_requested` -> RunSession `handed_over`，ExecutionPackage 进入 manual path

### 17.2 Review / quality

- `review.packet_created` -> ReviewPacket `draft/ready`
- `review.human_decision_recorded` + approved -> ExecutionPackage `Approved`
- `review.human_decision_recorded` + changes_requested -> ExecutionPackage `Changes Requested`
- `quality.gate_failed` -> ExecutionPackage `Awaiting Test Gate` 或回退
- `quality.gate_passed` -> ExecutionPackage `Ready for Release`

### 17.3 Release / observation

- `delivery.deploy_started` -> Release `deploying`
- `delivery.deploy_succeeded` -> Release evidence recorded
- `delivery.rollback_completed` -> Release / ExecutionPackage `Rolled Back`
- observation/incident link -> 回链 WorkItem / Package / Release

所有状态变化必须同时生成：

- `TraceEvent`
- `ObjectEvent` projection
- `StatusHistory` projection

---

## 18. Repo 聚合与外部系统接入

## 18.1 Repo View

原始真相源是 workspace stream。repo view 是派生索引。

Repo 归并键：

- 默认使用 canonical remote repo identity
- 支持用户显式指定 `repo_id`，但必须经服务端 enrollment 确认

Repo view 排序：

- causal order first
- event time second
- 无法可靠比较顺序时显示 concurrent / uncertain

不要用 wall-clock 时间决定 lineage 正确性。时间只用于展示和 tie-break。

## 18.2 Git provider

服务端主动接 Git provider，补充：

- repo
- branch
- commit DAG
- PR
- author
- merge

代码、对话和工具输出的真相仍以客户端上传为准。

## 18.3 CI/CD 与部署

CI/CD 与部署事件是一等对象。

默认长期保留：

- pipeline / job / run 元数据
- 状态变化
- commit / PR / artifact / deploy / environment 关联
- 失败步骤
- 关键错误摘要
- 外部日志链接

默认不长期保留：

- 全量原始 CI 日志
- 全量原始部署日志

但以下情况必须 snapshot 关键日志摘录到 `TraceBlobRef`：

- 失败 CI run 被链接到 ReviewPacket / Release / Incident
- deploy failure / rollback
- incident open window 内的相关 CI/deploy
- legal hold 涉及的 run
- 外部日志即将过期但仍被 snapshot 引用

snapshot 内容至少包含：摘录、hash、provider URL、拉取时间、权限上下文。

---

## 19. Incident / Postmortem

Incident 是线上平台的一等对象，但不是 Codex 内核模型。

v1 策略：

- 手动创建 incident
- 先限定单 repo
- incident 打开期间，相关证据可以继续自动挂入
- incident 关闭后生成冻结的 postmortem snapshot
- snapshot 物化关键结论和关键证据副本
- 证据包不可改写
- 结论正文通过修订版 / 补充说明追加

### 19.1 SealedSnapshotManifest

关闭 incident 时必须生成 sealed manifest。

```ts
type SealedSnapshotManifest = {
  id: string;
  org_id: string;
  incident_id: string;
  sealed_at: string;
  sealed_by_actor_id: string;

  event_refs: VersionedEvidenceRef[];
  span_refs: VersionedEvidenceRef[];
  blob_ref_ids: string[];
  trace_link_ids: string[];

  evidence_hash: string;
  projection_versions: Record<string, number>;
  access_policy_snapshot: unknown;
  retention_policy_snapshot: unknown;

  ai_artifact_ids: string[];
  human_revision_ids: string[];
};
```

snapshot 规则：

- 关键证据要么复制为 `postmortem_evidence_copy` blob ref，要么保存不可变 blob ref + digest。
- snapshot seal 后证据集合不可改写。
- 后续纠错只能追加 amendment / postmortem revision，不修改 sealed evidence set。
- snapshot seal、raw access、policy snapshot 都必须审计。

AI 生成的时间线、根因假设、结论草稿也作为 artifact 保存，并记录：

- 模型版本
- 输入证据范围
- 生成时间
- 后续人工修订链

---

## 20. 查询视图

### 20.1 Actor Timeline

按 actor 聚合一段时间内活动：

- 发起或负责的 Work Item / Spec / Plan
- 发起的 Execution Package
- 关联的 RunSession
- Codex session / thread / turn
- 代码 range / hunk lineage
- review / approval
- CI / deploy / incident

AI 代员工执行的动作计入员工轨迹，但必须标注：

- human action
- AI-on-behalf-of action
- platform-initiated action
- system-only action

### 20.2 Repo View

按 repo 聚合：

- workspace streams
- code revisions
- PR / merge
- range provenance
- execution spans
- CI / deploy
- incidents

### 20.3 Range Provenance Query

查询形式：

```text
repo + (CodeRevision | WorkspaceState) + path + line/range
```

返回：

- matched segments
- hunk lineage
- origin span / turn
- modifying spans / turns
- related blob refs and status
- business links
- query completeness：`Complete | Partial | Unavailable | Ambiguous`

### 20.4 Incident Evidence View

按 incident 聚合：

- manually attached evidence
- suggested evidence
- linked code ranges
- linked PR / release / deploy
- related actor timeline slices
- postmortem snapshot

---

## 21. 分阶段落地

### Phase 0：安全与数据合同定型

目标：先把不可逆的 SaaS ingest、安全和事件合同定住。

范围：

- RepoEnrollment
- TraceStreamRegistration
- stream token / epoch
- TraceEvent envelope + event hash
- TraceBlob / TraceBlobRef
- TraceScope / TraceSensitivity
- RawContentEntitlement 最小版
- ObjectEvent / Artifact 映射规则

### Phase 1：Execution-bound Codex Trace MVP

目标：打通正式 ExecutionPackage / RunSession 下的 Codex 执行轨迹，不做孤立 infra。

范围：

- TraceStream
- TraceEvent
- TraceSpan projection
- TraceBlobRef
- TraceLink projection
- Actor / ActorIdentity 最小版
- Codex session / thread / turn / tool ingestion
- explicit links to SpecRevision / PlanRevision / ExecutionPackage / RunSession
- basic span drilldown
- raw access audit and entitlement
- ObjectEvent / Artifact / StatusHistory basic projection

Phase 1 不要求完整 repo view，也不要求跨 revision 的高性能 range query。

### Phase 2：Code provenance index

范围：

- WorkspaceState
- WorkspaceStateDelta
- CodeRevision
- RevisionAlias
- RecordedStateAlias
- canonical hunk provenance events
- CodeRangeProvenanceIndex
- range query with completeness status

### Phase 3：Forgeloop 业务证据视图

范围：

- ReviewPacket evidence view
- Release evidence view for Codex-only evidence
- Actor timeline
- initial repo view
- phase/gate projection refinement

### Phase 4：外部系统接入

范围：

- Git provider
- CI/CD
- deploy
- artifact refs
- external log snapshot rules

### Phase 5：Incident / Postmortem 产品化

范围：

- 手动 incident
- evidence recommendation
- frozen snapshot manifest
- AI postmortem artifact
- amendment workflow

### Phase 6：组织学习闭环

范围：

- 从复盘生成规则、模板、Skill、workflow 改进建议
- 回灌 Spec / Plan / Review / ExecutionPackage 生成流程
- 组织级质量趋势与改进建议

---

## 22. 非目标

v1 不做：

- 自动创建 incident
- 跨 repo incident
- 全量 CI / deploy 日志长期保存
- 重 AI 猜测式 span 聚合
- 将 Codex thread / turn 作为员工轨迹主对象
- 将 trace 字段直接内嵌到 WorkItem / ExecutionPackage / Incident 主表
- 用 git blame 作为代码 provenance 真相源
- 跨 tenant blob 去重
- 没有 enrollment 的任意 repo 自动上传
- 没有 raw entitlement / audit 的原始内容展开

---

## 23. 关键结论

Trace / Evidence Plane 应作为 Forgeloop 的独立基础子域建设。

它的核心价值不是“事故复盘页面”，而是让 Forgeloop 的交付主线和进化主线共享同一套可审计、可回放、可重建的证据系统。

复盘、员工轨迹、repo 演化、release evidence、review context、组织学习，都是这套底座上的不同消费视图。

这套底座必须先保证四件事正确：

1. SaaS ingest 的租户和 repo enrollment 边界不能信任客户端。
2. TraceEvent / Blob / Link / Span 必须有 append-only source-of-truth 和可重建投影语义。
3. Code provenance 必须有 canonical hunk/workspace/revision payload，不能靠泛型 JSON 推断。
4. Phase 1 必须锚定 ExecutionPackage / RunSession，而不是先做脱离产品主链路的技术账本。
