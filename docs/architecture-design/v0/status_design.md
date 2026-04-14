好，我给你一版**可直接落库的状态字段设计表**。
核心目标是两点：

1. **避免状态爆炸**
2. **又能表达 AI / 人类 / 审批 / 打回 / 重试 / 发布这些真实流程**

这和 PRD 里“Work Item 是跨角色主对象、Execution Package 是执行主对象、Review / Test / Release / Replay 是独立环节”的设计是一致的。

---

# 一、总原则

我建议以后所有核心对象都按下面这个框架判断：

## 1. phase

对象当前处在**哪一段主流程**。

## 2. activity_state

当前这段流程里，**谁在做、做到哪了**。

## 3. gate_state

当前是否在等审批、审核、测试门禁，或者门禁结果是什么。

## 4. resolution

这个对象最终**怎么结束**。

## 5. event

那些瞬时动作，不做状态，进事件流。

---

# 二、一个关键决定

## 不建议把数据库主字段继续叫一个 `status`

因为 `status` 太容易把很多语义混在一起。

更好的方式是：

* 数据库里存多个字段：

  * `phase`
  * `activity_state`
  * `gate_state`
  * `resolution`
* API / UI 再派生一个：

  * `display_status`

这样用户看到的可以仍然是一个状态标签，但底层不会乱。

---

# 三、各对象状态设计总表

先给你最重要的一张总表。

| 对象                | 主字段    | 是否需要 activity_state | 是否需要 gate_state | 是否需要 resolution |
| ----------------- | ------ | ------------------: | --------------: | --------------: |
| Work Item         | phase  |                   是 |              可选 |               是 |
| Spec              | status |                   是 |               是 |               是 |
| Plan              | status |                   是 |               是 |               是 |
| Execution Package | phase  |                   是 |               是 |               是 |
| Review Packet     | status |                   否 |        本体即 gate |            是/可选 |
| Release           | phase  |                   是 |               是 |               是 |
| Incident          | status |                   是 |               否 |               是 |
| Contract          | status |                   否 |               是 |               是 |

---

# 四、Work Item 状态设计

Work Item 是跨角色主对象，不是执行器本体。
所以它应该表达“业务走到哪了”，而不是“第几次 AI 修改中”。PRD 里也是这样定义的。

## 建议字段

```ts id="j26hyt"
type WorkItemPhase =
  | "draft"
  | "triage"
  | "spec"
  | "plan"
  | "execution"
  | "release"
  | "observing"
  | "done"
  | "closed";
```

```ts id="yk6hq4"
type WorkItemActivityState =
  | "idle"
  | "in_progress"
  | "awaiting_ai"
  | "ai_running"
  | "awaiting_human"
  | "human_in_progress"
  | "blocked";
```

```ts id="6e66l1"
type WorkItemGateState =
  | "none"
  | "awaiting_spec_approval"
  | "spec_changes_requested"
  | "awaiting_plan_approval"
  | "plan_changes_requested"
  | "awaiting_release_approval"
  | "release_changes_requested";
```

```ts id="g2c9vn"
type WorkItemResolution =
  | "none"
  | "completed"
  | "cancelled"
  | "rejected"
  | "duplicate"
  | "superseded"
  | "won_t_do";
```

## 为什么这样设计

### phase

表达主业务阶段：

* 现在在写 Spec
* 现在在写 Plan
* 现在在执行
* 现在在发版/观察

### activity_state

表达当前有没有人在推进：

* AI 在跑
* 人在改
* 在等人
* 被 blocker 卡住

### gate_state

Work Item 层只保留**少量关键门禁**

* 等 Spec 审批
* Spec 被打回
* 等 Plan 审批
* 等 Release 审批

不要把所有细节 gate 都挂在 Work Item 上。

### resolution

区分：

* 真完成
* 取消
* 重复
* 被替代

---

## Work Item 不建议放进去的状态

不要放：

* `spec_draft_finished`
* `ai_modifying`
* `human_review_passed`
* `package_rework_in_progress`

这些都太细，应该下沉到 Spec / Plan / Package / Review Packet / Event。

---

## Work Item 典型流转

### 新功能

* phase=draft
* phase=triage
* phase=spec, activity_state=ai_running
* phase=spec, gate_state=awaiting_spec_approval
* phase=plan, activity_state=ai_running
* phase=plan, gate_state=awaiting_plan_approval
* phase=execution
* phase=release
* phase=observing
* phase=done, resolution=completed

### 被取消

* phase=closed, resolution=cancelled

### 被替代

* phase=closed, resolution=superseded

---

# 五、Spec 状态设计

Spec 本身就是定义对象，所以不需要 `phase`，直接一个 `status` 更自然。

## 建议字段

```ts id="jmiy2t"
type SpecStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "rejected"
  | "superseded"
  | "archived";
```

```ts id="tf0v8m"
type SpecEditingState =
  | "idle"
  | "ai_drafting"
  | "human_editing"
  | "co_editing";
```

```ts id="6n6pk0"
type SpecGateState =
  | "not_submitted"
  | "awaiting_approval"
  | "changes_requested"
  | "approved";
```

```ts id="noz0zf"
type SpecResolution =
  | "none"
  | "approved"
  | "rejected"
  | "superseded";
```

## 说明

### `status`

Spec 当前是否还是草稿、审核中、已通过、被替代

### `editing_state`

当前是 AI 在写，还是人在补

### `gate_state`

给审批流程单独留语义，不和 `status` 混

---

## Spec 典型流转

* draft + ai_drafting
* draft + human_editing
* in_review + awaiting_approval
* in_review + changes_requested
* approved + approved
* superseded + resolution=superseded

---

# 六、Plan 状态设计

Plan 和 Spec 类似，但语义是“实施方案与拆分”。

## 建议字段

```ts id="rgteq7"
type PlanStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "rejected"
  | "superseded"
  | "archived";
```

```ts id="221zuh"
type PlanEditingState =
  | "idle"
  | "ai_drafting"
  | "human_editing"
  | "co_editing";
```

```ts id="dxdx3f"
type PlanGateState =
  | "not_submitted"
  | "awaiting_approval"
  | "changes_requested"
  | "approved";
```

```ts id="pp1g5i"
type PlanResolution =
  | "none"
  | "approved"
  | "rejected"
  | "superseded";
```

## 为什么不更复杂

Plan 不直接跑代码，不需要：

* ai_running
* human_reviewing_code
* test_failed

这些属于 Package / Review / Test Evidence。

---

# 七、Execution Package 状态设计

这是最关键的对象。
我建议它用**四层**，因为它是执行主对象，PRD 对它要求最完整。

## 1）主阶段

```ts id="3l2b4o"
type ExecutionPackagePhase =
  | "draft"
  | "ready"
  | "queued"
  | "execution"
  | "review"
  | "integration"
  | "test_gate"
  | "release"
  | "archived";
```

## 2）当前执行态

```ts id="mchhqk"
type ExecutionPackageActivityState =
  | "idle"
  | "ai_running"
  | "ai_retrying"
  | "human_editing"
  | "awaiting_human"
  | "human_reviewing"
  | "blocked"
  | "handover";
```

## 3）门禁/结论态

```ts id="m72yb5"
type ExecutionPackageGateState =
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
```

## 4）最终结果

```ts id="k6ecul"
type ExecutionPackageResolution =
  | "none"
  | "completed"
  | "cancelled"
  | "rolled_back"
  | "superseded";
```

---

## 为什么 Package 必须拆成这么多层

因为它天然混着这些语义：

### 主流程位置

* 现在在执行
* 现在在 review
* 现在在 test gate

### 当前动作

* AI 正在跑
* AI 正在重试
* 人在接管修改
* reviewer 正在看

### 阶段结论

* review 批准
* review 打回
* test 失败
* integration 失败

### 终局

* 已发布
* 已归档
* 已回滚

如果你把这些全塞进一个 `status`，后面就会出现非常奇怪的组合和跳转。

---

## Package 的关键流转例子

### 正常路径

* phase=ready
* phase=queued
* phase=execution, activity_state=ai_running
* phase=review, gate_state=awaiting_human_review
* phase=review, gate_state=review_approved
* phase=test_gate, gate_state=test_passed
* phase=release, gate_state=released
* phase=archived, resolution=completed

### review 打回

* phase=review, gate_state=changes_requested
* phase=execution, activity_state=ai_retrying

### 人工接管

* phase=execution, activity_state=handover
* phase=execution, activity_state=human_editing

### 联调失败

* phase=integration, gate_state=integration_failed
* 回到 phase=execution

---

# 八、Review Packet 状态设计

Review Packet 本身就是“审查对象”，所以不需要再区分复杂 phase。

## 建议字段

```ts id="262m4n"
type ReviewPacketStatus =
  | "draft"
  | "ready"
  | "in_review"
  | "completed"
  | "escalated"
  | "archived";
```

```ts id="bg6z3z"
type ReviewDecision =
  | "none"
  | "approved"
  | "changes_requested"
  | "need_more_context"
  | "escalate";
```

## 说明

* `status` 表示 review packet 当前是否在被处理
* `decision` 表示审查结果

不要把 `changes_requested` 做成 status。
它更像结论。

---

# 九、Release 状态设计

Release 是交付编排对象，不是单纯“已发布/未发布”。

## 建议字段

```ts id="4jppwi"
type ReleasePhase =
  | "draft"
  | "candidate"
  | "approval"
  | "rollout"
  | "observing"
  | "completed"
  | "closed";
```

```ts id="le7duf"
type ReleaseActivityState =
  | "idle"
  | "awaiting_human"
  | "human_in_progress"
  | "rolling_out"
  | "paused"
  | "blocked";
```

```ts id="sd9qyh"
type ReleaseGateState =
  | "not_submitted"
  | "awaiting_approval"
  | "changes_requested"
  | "approved"
  | "rollout_failed"
  | "rollout_succeeded";
```

```ts id="okyq1x"
type ReleaseResolution =
  | "none"
  | "completed"
  | "rolled_back"
  | "cancelled";
```

---

# 十、Incident 状态设计

Incident 是响应与复盘对象，重点不是阶段细分，而是当前处理进展。

## 建议字段

```ts id="3q15in"
type IncidentStatus =
  | "open"
  | "triaging"
  | "mitigating"
  | "resolved"
  | "retrospecting"
  | "closed";
```

```ts id="1yq5es"
type IncidentActivityState =
  | "idle"
  | "human_in_progress"
  | "awaiting_input"
  | "blocked";
```

```ts id="i1j11t"
type IncidentResolution =
  | "none"
  | "resolved"
  | "false_alarm"
  | "duplicate"
  | "cancelled";
```

---

# 十一、Contract 状态设计

Contract 是协同门禁对象，关键是版本冻结和审批。

## 建议字段

```ts id="avh44o"
type ContractStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "frozen"
  | "deprecated"
  | "archived";
```

```ts id="sfdfqw"
type ContractGateState =
  | "not_submitted"
  | "awaiting_approval"
  | "changes_requested"
  | "approved"
  | "frozen";
```

```ts id="ohv6pf"
type ContractResolution =
  | "none"
  | "approved"
  | "deprecated"
  | "superseded";
```

---

# 十二、哪些东西一定要做成 event，而不是 status

这是最容易设计错的地方。

## 一定更适合做事件的

* spec_draft_started
* spec_generated_by_ai
* spec_submitted_for_review
* spec_review_approved
* plan_generated
* package_queued
* ai_run_started
* ai_run_failed
* ai_run_retried
* human_took_over
* review_requested
* review_completed
* release_started
* release_paused
* rollback_triggered

这些不是“长期停留态”，而是**时间点上的动作**。
PRD 已经明确要有 Event / Trace / Replay，所以这些应该进事件层。

---

# 十三、推荐数据库字段模板

## Work Item

```ts id="edx0e5"
{
  phase,
  activity_state,
  gate_state,
  resolution,
  is_blocked,
  blocked_reason,
  blocked_at,
  current_owner_actor_id,
  current_step_started_at,
  last_transition_at
}
```

## Spec / Plan

```ts id="whg2v8"
{
  status,
  editing_state,
  gate_state,
  resolution,
  current_editor_actor_id,
  last_submitted_at,
  last_decided_at
}
```

## Execution Package

```ts id="0hq2n4"
{
  phase,
  activity_state,
  gate_state,
  resolution,
  is_blocked,
  blocked_reason,
  blocked_at,
  current_run_session_id,
  current_assignee_actor_id,
  retry_count,
  last_transition_at
}
```

## Review Packet

```ts id="l12e6l"
{
  status,
  decision,
  reviewer_actor_id,
  review_started_at,
  review_completed_at
}
```

## Release

```ts id="sdrz2x"
{
  phase,
  activity_state,
  gate_state,
  resolution,
  rollout_started_at,
  rollout_completed_at,
  observed_until
}
```

---

# 十四、给 UI 的展示建议

虽然底层存多字段，但 UI 可以给用户一个派生状态。

例如 Work Item：

* `phase=spec + gate_state=awaiting_spec_approval`
  显示：**待审批 Spec**
* `phase=plan + activity_state=ai_running`
  显示：**AI 正在生成 Plan**
* `phase=execution + activity_state=blocked`
  显示：**执行阻塞**
* `phase=done + resolution=completed`
  显示：**已完成**

这样用户体验不会复杂，但底层模型是干净的。

---

# 十五、我最推荐的最终方案

## 不要这样做

* 每个阶段都拆“进行中 / 已完成”
* 所有对象都用一个大 `status`
* 把瞬时动作也做成 status

## 要这样做

### Work Item

* `phase + activity_state + 少量 gate_state + resolution`

### Spec / Plan

* `status + editing_state + gate_state + resolution`

### Execution Package

* `phase + activity_state + gate_state + resolution`

### Review Packet

* `status + decision`

### Release

* `phase + activity_state + gate_state + resolution`

### 细动作

* 全进 `object_events / trace`

---

# 十六、最关键的一句话

**状态负责表达“对象现在稳定地处于哪里”，事件负责表达“刚刚发生了什么动作”，决策负责表达“这一轮判断结论是什么”，终局字段负责表达“它最后怎么结束”。**

把这四件事分开，你这套系统后面才不会在状态机上失控。
这也最符合你 PRD 里“交付主线 + 进化主线 + 全链路回放”的方向。

下一步我建议直接继续做一版 **Postgres enum + table columns 草案**，把这些状态字段正式落到表结构里。
