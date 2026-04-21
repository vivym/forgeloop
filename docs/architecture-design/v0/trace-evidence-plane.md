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
- `trace_links`
- `workspace_states`
- `code_revisions`
- `code_range_provenance_index`
- `actors`
- `actor_identities`

现有业务对象只负责自身业务状态，通过 `TraceLink` 关联证据：

- WorkItem
- Spec / SpecRevision
- Plan / PlanRevision
- ExecutionPackage
- RunSession
- ReviewPacket
- Release
- Incident / Postmortem

这样可以避免把复盘能力做成 Incident 私有能力，也避免把 Codex 专用字段污染 ExecutionPackage。

---

## 2. 核心原则

### 2.1 Append-only Event Log 是真相源

`TraceEvent` 采用 append-only 事件日志模型。所有关键研发事实先进入 Ledger，再派生出查询索引、时间线、repo view、actor timeline、incident snapshot。

不要把可变状态表当唯一真相源。原因是：

- 审计、回放、复盘需要保留事件历史
- 多源接入天然更适合 append-only ingestion
- 查询模型未来会变化，派生索引可以重建
- incident snapshot 可以从稳定事件集物化

### 2.2 TraceSpan / Activity 是主展示单元

`TraceEvent` 是最小事实，但直接展示会过碎。

默认 UI、actor timeline、repo view、incident timeline 应展示 `TraceSpan / Activity`，需要时再 drill down 到 raw events。

v1 span 边界按来源系统天然边界生成，不做重 AI 猜测式聚合。

### 2.3 大内容进入 Blob

`TraceEvent` 本体只内联小型结构化字段。完整对话正文、工具输出、代码片段、日志摘录、artifact 内容等大对象进入 `TraceBlob`，事件只保存 `blob_ref`。

Blob 使用内容寻址和去重存储。

### 2.4 先入账，后关联

事件可以先进入 Ledger，不要求 ingest 时必须绑定业务对象。

后续通过 `TraceLink` 关联到 WorkItem、ExecutionPackage、RunSession、Release、Incident 等对象。

这支持：

- Codex / CI / deploy 事件先发生，业务对象链接后补
- 新建 incident 后把历史证据重新挂入
- 同一证据被多个对象复用

### 2.5 GitRevision 和 WorkspaceState 都是一等代码坐标

代码查询不能只依赖裸 `path + line/range`。

平台必须同时支持：

- `GitRevision`：用于历史代码、PR、发布、事故回看
- `WorkspaceState`：用于未提交代码、AI 连续修改、人工接管、执行中状态

### 2.6 RunSession 和 TraceSpan 分层

`RunSession` 是业务执行对象，面向 ExecutionPackage、审批、编排和工作台。

`TraceSpan` 是证据与时间线对象，面向 replay、actor timeline、repo view、incident evidence。

二者允许强关联，常见情况可以 1:1，但模型上不能强制等同。

---

## 3. 核心实体

## 3.1 TraceStream

上传、顺序和恢复的边界。

v1 以本地 workspace 实例为 stream：每个 clone / worktree / device 一条独立 stream。线上再按 repo 聚合。

建议字段：

```ts
type TraceStream = {
  id: string;
  org_id: string;
  repo_id: string;
  workspace_instance_id: string;
  source_system: 'codex' | 'manual' | 'ci' | 'deploy' | 'git_provider' | 'other_agent';
  canonical_remote?: string | null;
  user_specified_repo_id?: string | null;
  enrolled_at: string;
  last_acked_seq_no?: number | null;
  created_at: string;
  updated_at: string;
};
```

关键约束：

- stream 内用 `seq_no` 表达真实顺序
- 服务端按 `(org_id, stream_id, seq_no)` 幂等 ingest
- repo view 不改写 stream 原始事件，只做派生聚合

## 3.2 TraceEvent

最小不可变事实。

建议字段：

```ts
type TraceEvent = {
  id: string;
  org_id: string;
  stream_id: string;
  seq_no: number;

  category:
    | 'execution'
    | 'code_provenance'
    | 'review_quality'
    | 'delivery'
    | 'incident_postmortem'
    | 'system_linkage';

  event_type: string;
  occurred_at: string;
  received_at: string;

  initiator: ActorRef;
  accountable_actor?: ActorRef | null;
  effective_executor: ActorRef;

  source_context: SourceContext;
  payload: Record<string, unknown>;
  blob_refs: string[];

  scope: TraceScope;
  sensitivity: TraceSensitivity;
};
```

事件一级分类按证据语义划分，而不是按来源系统划分。

### Execution events

- agent run
- tool call
- manual action
- approval
- handoff

### Code provenance events

- file / range / hunk lineage
- revision anchor
- workspace observation

### Review / quality events

- review decision
- test evidence
- quality gate
- CI result

### Delivery events

- build
- artifact
- deploy
- rollback
- environment observation

### Incident / postmortem events

- incident created
- evidence attached
- snapshot sealed
- postmortem revision

### System linkage events

- object linked / unlinked
- alias resolved
- external reference attached

## 3.3 TraceSpan / Activity

默认展示、回放和时间线单元。

建议字段：

```ts
type TraceSpan = {
  id: string;
  org_id: string;
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

  start_event_id?: string | null;
  end_event_id?: string | null;
  started_at: string;
  ended_at?: string | null;

  actor_refs: ActorRef[];
  source_context: SourceContext;
  primary_object_link_id?: string | null;
};
```

v1 span 边界：

- Codex：session / thread / turn
- CI：pipeline / run / job
- Deploy：deploy run
- Review：review packet / review session
- Human manual work：manual session 或显式操作批次
- Incident：incident lifecycle phase

## 3.4 TraceBlob

大内容与证据附件。

建议字段：

```ts
type TraceBlob = {
  id: string;
  org_id: string;
  content_hash: string;
  content_type: string;
  byte_size: number;
  storage_uri: string;
  encryption_key_ref?: string | null;
  sensitivity: TraceSensitivity;
  scope: TraceScope;
  retention_policy_id?: string | null;
  legal_hold: boolean;
  created_at: string;
};
```

适合放入 Blob 的内容：

- 完整对话正文
- 工具输出
- 代码片段 / 文件片段
- CI / deploy 日志摘录
- artifact 引用或小型 artifact 内容
- postmortem snapshot 中物化的证据副本

## 3.5 TraceLink

把证据关联到业务对象。

建议字段：

```ts
type TraceLink = {
  id: string;
  org_id: string;

  subject_type: 'event' | 'span' | 'blob' | 'workspace_state' | 'code_revision';
  subject_id: string;

  object_type:
    | 'work_item'
    | 'spec_revision'
    | 'plan_revision'
    | 'execution_package'
    | 'run_session'
    | 'review_packet'
    | 'release'
    | 'incident'
    | 'postmortem_snapshot'
    | 'actor_timeline'
    | 'repo_view';
  object_id: string;

  link_type:
    | 'origin'
    | 'evidence'
    | 'caused_by'
    | 'verified_by'
    | 'deployed_by'
    | 'regressed_by'
    | 'fixed_by'
    | 'related';

  confidence: 'explicit' | 'derived' | 'suggested';
  created_by_actor_id: string;
  created_at: string;
};
```

Link 本身也应写入 `TraceEvent`，用于审计。

## 3.6 WorkspaceState

未提交代码状态的一等坐标。

建议字段：

```ts
type WorkspaceState = {
  id: string;
  org_id: string;
  repo_id: string;
  stream_id: string;

  state_ref: string;
  parent_state_ref?: string | null;
  projection_version: number;

  base_git_revision_id?: string | null;
  git_commit_oid?: string | null;
  git_tree_oid?: string | null;

  changed_blob_refs: string[];
  created_by_event_id: string;
  created_at: string;
};
```

`WorkspaceState` 是逻辑一等对象，但底层不默认保存每个状态的完整文件树。

底层策略：

- `state_ref`
- `parent_state_ref`
- revision anchor
- changed blobs
- range / hunk observations
- 必要时物化关键快照

## 3.7 CodeRevision

Git commit / tree / tag / resolved branch ref。

建议字段：

```ts
type CodeRevision = {
  id: string;
  org_id: string;
  repo_id: string;
  commit_oid?: string | null;
  tree_oid: string;
  ref_name?: string | null;
  ref_type?: 'commit' | 'branch' | 'tag' | 'pull_request' | null;
  resolved_at: string;
  provider_ref?: ExternalRef | null;
};
```

规则：

- branch / tag 可以作为输入，但查询时必须解析为确定 commit / tree
- 历史查询必须命中 recorded state 或 exact revision alias
- 不做 fuzzy match

## 3.8 CodeRangeProvenanceIndex

范围查询的派生索引，不是真相源。

支持：

```text
repo + GitRevision/WorkspaceState + path + line/range -> lineage
```

查询结果回到：

- TraceEvent
- TraceSpan
- Codex turn / tool refs
- WorkspaceState
- CodeRevision
- TraceBlob

## 3.9 Actor

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

## 3.10 ActorIdentity

外部身份归并。

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
  created_at: string;
};
```

同一个员工可能有 Forgeloop、Codex、Git author、GitHub/GitLab、CI/deploy、飞书、邮箱等多套身份。轨迹归并必须先落到 `ActorIdentity`，再归并到 canonical `Actor`。

---

## 4. 归因模型

每个事件至少拆四个维度：

```ts
type Attribution = {
  initiator: ActorRef;
  accountable_actor?: ActorRef | null;
  effective_executor: ActorRef;
  source_context: SourceContext;
};
```

含义：

- `initiator`：谁触发动作。可能是 human、platform_rule、external_event、system_admin。
- `accountable_actor`：动作最终归属给谁。通常是 owner、员工或平台系统账号。
- `effective_executor`：实际执行者。可能是 human、codex、other_agent、ci、deploy。
- `source_context`：技术上下文。例如 Codex session/thread/turn/tool_call、workflow run、CI run、deploy id。

平台自动发起的动作同时进入：

- system / platform timeline
- accountable owner 的个人轨迹

但在个人轨迹中必须标注 `platform-initiated`，不能伪装成人工动作。

---

## 5. SourceContext

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

## 6. Codex v1 接入范围

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

Codex 的 session / thread / turn 是可查询技术对象和 drill-down 维度，但不是员工轨迹的主对象。

员工轨迹默认看 `TraceSpan / Activity`，再下钻到 Codex turn、tool call、code provenance。

### 6.1 Codex provenance 的核心要求

Codex provenance 不应只提供 git blame 式答案。

它需要回答：

- 某个 repo/revision/path/range 对应哪些 hunk lineage
- 哪个 turn 首次引入
- 后续哪些 turn 修改
- 关联哪些 tool call、patch、command、artifact
- 当时的用户意图和 assistant 上下文是什么

### 6.2 Codex 到 Forgeloop 的职责边界

Codex 负责：

- 本地采集代码与对话 provenance
- 形成 workspace stream
- 上传 metadata / lineage / blob refs
- 上传完整内容 blob

Forgeloop 负责：

- 多租户 ingest
- repo 聚合
- actor 归并
- range provenance index
- business object linking
- incident / postmortem / actor timeline / repo view

---

## 7. 云端同步策略

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
- 内容寻址去重
- 服务端明文索引
- 长期保留，支持 retention policy 和 legal hold

### 7.1 可靠性边界

当前不要求覆盖“终端永久损坏且未同步完成”的极端场景。

v1 要保证：

- 本地进程崩溃可恢复
- 客户端重启可恢复
- 网络波动可补传
- 服务端短期不可用可积压
- 不主动丢弃链路数据

### 7.2 上传协议原则

- 事件上传幂等
- 每条 stream 维护 ack cursor
- metadata / lineage 先上传
- blob 可以 pending 后补
- 只有 event ack 和 blob ack 都完成后，客户端才能 GC 对应本地数据

---

## 8. Repo 聚合与排序

原始真相源是 workspace stream。repo view 是派生索引。

Repo 归并键：

- 默认使用 canonical remote repo identity
- 支持用户显式指定 `repo_id`

Repo view 排序：

- causal order first
- event time second
- 无法可靠比较顺序时显示 concurrent / uncertain

不要用 wall-clock 时间决定 lineage 正确性。时间只用于展示和 tie-break。

---

## 9. 外部系统接入

### 9.1 Git provider

服务端主动接 Git provider，补充：

- repo
- branch
- commit DAG
- PR
- author
- merge

代码、对话和工具输出的真相仍以客户端上传为准。

### 9.2 CI/CD 与部署

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

原始日志按需拉取、限额缓存或短期保留。

---

## 10. 权限模型

不要在每个 `TraceEvent` 上维护复杂 ACL。

推荐：

- `TraceEvent / TraceBlob` 自带 `scope` 和 `sensitivity`
- 访问控制主要通过 linked object policy 派生
- 原始内容展开走额外 entitlement / approval
- snapshot 物化时复制当时访问策略和审计记录

### 10.1 已定权限原则

- repo 权限可看聚合复盘视图
- 原始对话、工具输出、代码片段展开需要更高权限
- 少数审计管理员可直接展开
- 其他人按次申请
- 原始内容默认不可导出，只能在线查看
- 默认长期保留，支持组织级 retention policy 和 legal hold

---

## 11. Incident / Postmortem

Incident 是线上平台的一等对象，但不是 Codex 内核模型。

v1 策略：

- 手动创建 incident
- 先限定单 repo
- incident 打开期间，相关证据可以继续自动挂入
- incident 关闭后生成冻结的 postmortem snapshot
- snapshot 物化关键结论和关键证据副本
- 证据包不可改写
- 结论正文通过修订版 / 补充说明追加

AI 生成的时间线、根因假设、结论草稿也作为 artifact 保存，并记录：

- 模型版本
- 输入证据范围
- 生成时间
- 后续人工修订链

---

## 12. 查询视图

### 12.1 Actor Timeline

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

### 12.2 Repo View

按 repo 聚合：

- workspace streams
- code revisions
- PR / merge
- range provenance
- execution spans
- CI / deploy
- incidents

### 12.3 Range Provenance Query

查询形式：

```text
repo + (GitRevision | WorkspaceState) + path + line/range
```

返回：

- matched segments
- hunk lineage
- origin span / turn
- modifying spans / turns
- related blobs
- business links

### 12.4 Incident Evidence View

按 incident 聚合：

- manually attached evidence
- suggested evidence
- linked code ranges
- linked PR / release / deploy
- related actor timeline slices
- postmortem snapshot

---

## 13. 分阶段落地

### Phase 1：Codex provenance + Trace Ledger MVP

目标：打通 Codex 到 Forgeloop 的通用证据底座。

范围：

- TraceStream
- TraceEvent
- TraceSpan
- TraceBlob
- TraceLink
- Actor / ActorIdentity 最小版
- WorkspaceState
- CodeRevision
- CodeRangeProvenanceIndex 最小版
- Codex session / thread / turn / tool / code provenance 接入
- repo + workspace state + range 查询

### Phase 2：Forgeloop 业务对象联动

范围：

- ExecutionPackage / RunSession 链接 TraceSpan
- ReviewPacket evidence view
- Actor timeline
- Repo view
- Release evidence view

### Phase 3：外部系统接入

范围：

- Git provider
- CI/CD
- deploy
- artifact refs

### Phase 4：Incident / Postmortem 产品化

范围：

- 手动 incident
- evidence recommendation
- frozen snapshot
- AI postmortem artifact
- 权限审批与审计

### Phase 5：组织学习闭环

范围：

- 从复盘生成规则、模板、Skill、workflow 改进建议
- 回灌 Spec / Plan / Review / ExecutionPackage 生成流程
- 组织级质量趋势与改进建议

---

## 14. 非目标

v1 不做：

- 自动创建 incident
- 跨 repo incident
- 全量 CI / deploy 日志长期保存
- 重 AI 猜测式 span 聚合
- 将 Codex thread / turn 作为员工轨迹主对象
- 将 trace 字段直接内嵌到 WorkItem / ExecutionPackage / Incident 主表
- 用 git blame 作为代码 provenance 真相源

---

## 15. 关键结论

Trace / Evidence Plane 应作为 Forgeloop 的独立基础子域建设。

它的核心价值不是“事故复盘页面”，而是让 Forgeloop 的交付主线和进化主线共享同一套可审计、可回放、可重建的证据系统。

复盘、员工轨迹、repo 演化、release evidence、review context、组织学习，都是这套底座上的不同消费视图。
