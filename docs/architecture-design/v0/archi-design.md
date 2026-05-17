> Superseded historical migration note: this document mentions the old subsystem name for audit history only. Current commands, routes, files, and product docs use delivery terminology.

可以。我给你一个**长期可演进**、同时又适合现在开工的版本。

## 先给结论

### 后端架构

**长期最合适的是：TypeScript 为主，Go 为辅，Rust 后置。**

更具体一点：

* **TypeScript**：控制面 + 工作流编排
* **Go**：执行基础设施
* **Rust**：只做少数高性能/高隔离底层组件

### API 风格

**主 API 选 RESTful。**
**GraphQL 不作为主协议，只作为后期可选的读侧聚合层。**

也就是：

* **写操作、状态流转、审批、执行触发、回调、webhook：REST**
* **复杂页面聚合查询：后期可加 GraphQL BFF**
* **内部长流程：Temporal，不靠同步 API 串起来**

这是我最稳的建议。

---

# 一、长期后端分层怎么拆

你这个系统天然不是一个“单纯 CRUD 后端”，而是三种后端叠在一起：

## 1. 控制面

负责对象模型和产品逻辑。

包括：

* Work Item
* Spec / Plan
* Execution Package
* Review Packet
* Release / Incident
* 权限、审批、查询、工作台

这层我建议用 **TypeScript + NestJS**。
Nest 现在仍然是一个面向可扩展 Node 服务端应用的框架，并且官方同时支持 GraphQL 和 OpenAPI/Swagger，所以框架本身不会把你锁死到某一种 API 风格。([NestJS 文档][1])

## 2. 工作流编排面

负责长流程、重试、补偿、回放、异步推进。

包括：

* Spec 审批后自动生成 Plan
* Plan 审批后自动拆 Package
* Package 触发 Codex 执行
* Review / Test / Release gate 推进
* 失败重试、人工接管

这层我建议也先放 **TypeScript + Temporal**。
Temporal 的 TypeScript SDK 已经完整支持 Workflows、Activities、Workers 和 Task Queue 模型，也有专门的 worker 运行与性能文档，足够支撑 durable workflow。([Temporal 文档][2])

## 3. 执行基础设施面

负责真正“跑任务”和“管资源”。

包括：

* sandbox manager
* workspace provisioner
* runner / attach / terminal bridge
* artifact 上传与流式日志
* 容器 / K8s Job 生命周期

这层长期最适合 **Go**。
原因不是 TS 做不了，而是这层更像并发服务、系统工具和资源编排，Go 会更稳、更直接。

## 4. 少数底层硬组件

只有当你们真的遇到性能/安全瓶颈时，再上 **Rust**。

比如：

* repo indexer
* 高性能 diff / patch 引擎
* 更强隔离的本地/远端 agent runtime
* 高吞吐日志/trace 处理器

---

# 二、我推荐的长期服务拆分

## 阶段 1：先做“模块化单体 + 执行侧独立服务”

这是最适合你当前阶段的。

### A. `control-plane-api`（TS）

一个大的模块化后端，不要一开始就拆微服务。

模块包括：

* work-item
* spec
* plan
* package
* review
* release
* incident
* query / search
* auth / permission
* integration

### B. `workflow-worker`（TS）

专门跑 Temporal worker。

职责：

* 审批后触发下一步
* 生成 Package
* 路由到不同执行队列
* 处理重试 / 超时 / 补偿 / 人工接管

### C. `executor-gateway`（TS）

一个薄层服务，把业务系统和你 fork 的 Codex 隔开。

职责：

* 接收 RunSpec
* 组织 skills / config / prompt refs
* 调起远端执行
* 回收结果，写回 RunSession / ReviewPacket

### D. `sandbox-manager`（Go）

职责：

* 拉起 / 销毁 sandbox
* 管理 workspace
* attach / streaming logs
* secrets 注入
* 网络策略 / 资源配额

### E. `artifact-service`（先 TS，后期可 Go）

职责：

* 测试报告
* patch / diff
* logs / screenshots
* trace 归档

---

## 阶段 2：当并发和复杂度上来后，再往外拆

到那时再拆出：

* `query-api` / `graphql-bff`
* `notification-service`
* `search-indexer`
* `audit-replay-service`

但我不建议现在就走微服务。
你现在最大的风险不是“单服务不够高级”，而是**对象模型和流程模型还在收敛**。这时候过早拆分会让迭代速度明显下降。

---

# 三、为什么我不建议全 Go 或全 Rust

## 不建议全 Go

Go 很适合 infra，但你的系统有大量：

* 对象模型快速演进
* 页面驱动的复杂查询
* 审批与流程状态
* 前后端共享 DTO / schema
* 业务规则频繁变化

这些地方，TS 通常会更顺。

## 不建议全 Rust

Rust 当然可以做，但现在你最重要的是：

* 先打通闭环
* 快速改 schema
* 快速改流程
* 快速做 dogfood

Rust 更适合在模型收敛以后下沉到热点组件。

---

# 四、RESTful 还是 GraphQL

这里我给你一个明确结论：

## 主 API：RESTful

## 可选读侧：GraphQL

## 不建议 GraphQL-first

---

## 为什么主 API 该选 RESTful

你的主业务其实是**命令驱动**，不是“内容查询驱动”。

你大量核心操作都是：

* 创建 Work Item
* 提交 Spec 审批
* 提交 Plan 审批
* 生成 Execution Package
* 触发执行
* 人工接管
* 提交 Review 结论
* 进入 Release
* 回滚

这些动作本质上更像：

* 资源操作
* 状态转移
* 命令触发
* 幂等写入
* 审计留痕

这类东西，REST 会更自然。
再加上 Nest 对 REST/OpenAPI 的支持很直接，可以从路由、DTO 和装饰器生成 OpenAPI 文档。([NestJS 文档][3])

### 你这个系统特别适合 REST 的地方

* 审批动作天然是 command endpoint
* webhooks / callbacks 天然是 HTTP endpoint
* 执行器回调天然是 HTTP endpoint
* 权限、审计、幂等键、重试语义更好表达
* 对接外部系统更通用

---

## GraphQL 适合哪里

GraphQL 最强的地方，是**复杂读侧聚合**。

官方定义里，GraphQL 提供强类型 schema，可以描述对象关系；它通常通过单一 endpoint 暴露，并支持 introspection；如果以后你有多个子图，还能做 federation 的统一 schema。([GraphQL][4])

这正适合你后面这些页面：

* Work Item 详情页
  一次拿到 WorkItem + 当前 Spec + 当前 Plan + Packages + ReviewPackets + Release
* Release cockpit
  一次拿到 Release + 风险摘要 + Packages + 测试证据 + 回滚信息
* Manager dashboard
  一次拿到多个对象聚合后的统计与 drill-down

这些页面如果全靠 REST，前端可能要打很多请求，BFF 聚合会越来越重。

所以 GraphQL 在你这里最适合作为：

**后期只读聚合层**，不是主写接口。

---

## 为什么不建议 GraphQL-first

因为你这个系统不是一个典型“前端想自由拼查询”的内容平台。
它更像一个**有强状态机、强审计、强门禁、强命令语义**的研发操作系统。

GraphQL 虽然也支持 mutation，但 mutation 在这类“状态推进系统”里通常没有 REST 清晰。官方文档也强调写操作应显式作为 mutation。([NestJS 文档][5])

你如果一开始就 GraphQL-first，常见问题会是：

* command 和 query 混在一起
* 状态转移语义不清
* webhooks / callback 不自然
* 执行器与平台之间的协议不直观
* 审计和幂等约束容易散掉

---

# 五、我给你的最终 API 建议

## 现在就这样定

### 对外/前端主 API

**RESTful**

示例风格：

* `POST /work-items`
* `POST /work-items/{id}/submit-spec`
* `POST /specs/{id}/approve`
* `POST /plans/{id}/approve`
* `POST /execution-packages/{id}/run`
* `POST /execution-packages/{id}/handover`
* `POST /review-packets/{id}/decide`
* `POST /releases/{id}/approve`
* `POST /releases/{id}/rollback`

### 查询 API

前期仍然用 REST：

* `GET /work-items/{id}`
* `GET /work-items/{id}/timeline`
* `GET /execution-packages/{id}`
* `GET /releases/{id}`
* `GET /incidents/{id}`

### 后期新增

**GraphQL BFF 只做读侧聚合**

* `/graphql`
* 只给前端复杂 cockpit / dashboard 用
* 不承载执行命令

---

# 六、我会怎么落地

## 推荐技术组合

### 控制面

* **NestJS + TypeScript**
* Postgres
* Redis
* OpenAPI / Swagger

Nest 官方对 OpenAPI/Swagger 支持很直接，可以从装饰器生成 RESTful API 文档。([NestJS 文档][3])

### 工作流

* **Temporal + TypeScript Workers**

Temporal TS 文档明确覆盖了 Workflows、Activities、Workers 和 Task Queue 运行方式。([Temporal 文档][2])

### 执行基础设施

* **Go**
* Docker / K8s Job
* object storage

### 可选读侧聚合

* **NestJS GraphQL module**
* 只在你们真有复杂聚合页面时再上

Nest 官方也明确支持 GraphQL，并可复用 guards / pipes / interceptors 这类机制。([NestJS 文档][6])

---

# 七、最终拍板建议

如果今天就要拍板，我会这样定：

## 长期后端技术架构

**TS 控制面 + TS Temporal 工作流 + Go 执行基础设施 + Rust 后置**

## API 策略

**RESTful-first，GraphQL-later-for-reads**

## 不做的事

* 不做 GraphQL-first
* 不做全 Rust
* 不做一开始就全微服务

---

# 八、一句话版

**你的系统本质上是“强对象模型 + 强状态机 + 强命令语义 + 强回放”的平台，所以主后端应该选 TypeScript，主 API 应该选 RESTful；GraphQL 更适合作为后期复杂读侧页面的聚合层，而不是整套系统的主协议。**

下一步最适合继续的是：我直接给你画一版 **服务边界图 + API 分层图**，把哪些接口走 REST、哪些未来可进 GraphQL 明确出来。

[1]: https://docs.nestjs.com/?utm_source=chatgpt.com "Documentation | NestJS - A progressive Node.js framework"
[2]: https://docs.temporal.io/develop/typescript?utm_source=chatgpt.com "TypeScript SDK developer guide"
[3]: https://docs.nestjs.com/openapi/introduction?utm_source=chatgpt.com "OpenAPI (Swagger) | NestJS - A progressive Node.js ..."
[4]: https://graphql.org/?utm_source=chatgpt.com "GraphQL | The query language for modern APIs"
[5]: https://docs.nestjs.com/graphql/mutations?utm_source=chatgpt.com "GraphQL + TypeScript - Mutations"
[6]: https://docs.nestjs.com/graphql/quick-start?utm_source=chatgpt.com "GraphQL + TypeScript | NestJS - A progressive Node.js ..."


可以，我给你一版**能直接指导研发拆分**的服务边界图和 API 分层方案。

我的最终建议还是这句：

**后端主架构：TypeScript 控制面 + TypeScript Temporal 工作流 + Go 执行基础设施。**
**API 主协议：RESTful。GraphQL 只作为后期读侧聚合层，不做主协议。**

这既符合你这套系统“强对象模型 + 强状态机 + 强执行编排 + 强回放”的本质，也和官方能力边界匹配：Nest 原生支持 OpenAPI/Swagger 生成，也支持 GraphQL 模块；Temporal 的 TypeScript SDK 明确围绕 Workflows、Activities、Workers 和 Task Queues 提供能力；GraphQL 官方强调强类型 schema、query/mutation 和 introspection，更适合复杂读侧查询。([NestJS 文档][1])

---

# 1. 总体服务边界

我建议你把系统长期拆成五层，但**现在只实现前三层**。

## 第一层：Web / API Gateway

这是前端唯一稳定入口。

职责：

* 鉴权
* Session / Token
* 请求路由
* OpenAPI 文档
* SSE / WebSocket 推送入口
* 内部管理 API 聚合

技术：

* **NestJS / TypeScript**

为什么这层适合 TS：
你的 Web 控制台、DTO、校验、对象查询模型、状态流转接口都会高频变化，Nest 对 REST/OpenAPI 支持很直接，适合先把控制面跑顺。([NestJS 文档][1])

---

## 第二层：Control Plane

这是产品本体。

建议先做成**模块化单体**，不要一上来微服务。

模块边界建议：

### `work-item` 模块

* Work Item CRUD
* Triage
* priority / risk
* current_spec / current_plan / current_release 指针

### `spec-plan` 模块

* Spec
* SpecRevision
* Plan
* PlanRevision
* 审批流
* 模板渲染

### `package` 模块

* Execution Package
* dependency graph
* readiness
* RunSpec 生成
* owner/reviewer/qa 分配

### `review-quality` 模块

* Review Packet
* Test Evidence
* gate 汇总
* quality summary

### `release-incident` 模块

* Release
* Release Evidence
* Incident
* Incident links

### `audit-replay` 模块

* ObjectEvent
* StatusHistory
* Decision
* Artifact 索引
* Replay timeline 查询

这些模块正好对应你 PRD 里的对象模型和产品模块，只是我把它们收敛成了更适合工程实现的服务边界。

---

## 第三层：Workflow Plane

这层是你系统最容易被忽视、但其实最重要的一层。

职责：

* 长流程推进
* 重试
* timeout
* 补偿
* 审批后自动推进
* Package 执行编排
* Human override 后恢复流程

建议：

* **Temporal**
* **TypeScript workers**

Temporal 的模型就是 Workflow + Activity + Worker + Task Queue，这和你的系统非常贴：
Work Item / Package 的生命周期天然是 durable workflow；每个外部动作，比如“生成 Plan”“触发 Codex 执行”“等待人工审批”，都很适合做 Activity 或等待信号。([Temporal 文档][2])

---

## 第四层：Execution Infra

这层长期应该从控制面剥出来。

职责：

* sandbox 生命周期
* workspace provisioning
* repo checkout
* attach/terminal
* streaming logs
* artifact upload
* secrets 注入
* 网络与资源隔离

建议：

* **Go**

为什么是 Go：
这层更像系统服务、资源控制和高并发调度，不像“业务对象系统”。长期放在 TS 里会让控制面和执行面耦太紧。

### 这层的推荐服务拆分

* `sandbox-manager`
* `workspace-service`
* `runner-service`
* `terminal-bridge`
* `artifact-uploader`

---

## 第五层：Optional Read Model Layer

这层现在不用做，但将来复杂工作台多了以后很有价值。

职责：

* 聚合多对象只读视图
* dashboard / cockpit / manager view
* 复杂 drill-down 查询

建议：

* **GraphQL BFF**
* 只读，不承载命令

GraphQL 的优势在于强类型 schema 和按需查询，非常适合复杂聚合读接口；官方也明确它以 schema 描述关系，并通过 queries / mutations 提供访问能力。([GraphQL][3])

---

# 2. 最适合现在开工的部署形态

不要一开始就 8 个服务分布式部署。

## V1 推荐形态

### 服务 A：`control-plane-api`

* TypeScript / NestJS
* 模块化单体
* 提供全部 REST API
* 持久化到 Postgres
* 对外暴露 OpenAPI

### 服务 B：`workflow-worker`

* TypeScript
* Temporal worker
* 跑所有 durable workflow

### 服务 C：`executor-gateway`

* TypeScript
* 薄薄一层
* 接收 RunSpec
* 调你 fork 的 Codex
* 和 sandbox-manager 对接

### 服务 D：`sandbox-manager`

* Go
* 管远端 Docker / K8s Job
* 提供 attach / logs / workspace / artifact

### 公共基础设施

* Postgres
* Redis
* Temporal Server
* COS / S3
* 日志与指标

这套已经足够撑起 P0/P1/P2。

---

# 3. 服务边界图（文字版）

你可以直接把下面这段当成架构图初稿：

```text
Web Console
   |
   v
API Gateway / Control Plane API (TS/Nest)
   |---- WorkItem / Spec / Plan / Package / Review / Release / Incident APIs
   |---- Query APIs
   |---- Auth / Permission
   |
   +----> Temporal Client
             |
             v
        Workflow Workers (TS)
             |---- generate_spec
             |---- generate_plan
             |---- split_packages
             |---- run_package
             |---- await_review
             |---- test_gate
             |---- release_gate
             |
             +----> Executor Gateway (TS)
                        |
                        +----> Sandbox Manager (Go)
                        |         |---- create sandbox
                        |         |---- attach terminal
                        |         |---- stream logs
                        |         |---- upload artifacts
                        |
                        +----> Codex Executor

Control Plane API / Workers
   |
   +----> Postgres
   +----> Redis
   +----> Object Storage
   +----> Observability
```

---

# 4. RESTful 还是 GraphQL：最终判定

## 结论

**主协议选 RESTful。**

原因不是 GraphQL 不好，而是你的系统更像“命令驱动平台”，不是“自由查询型内容平台”。

你大量最核心的操作都是：

* 提交 Work Item
* 提交 Spec 审批
* 批准 / 驳回 Plan
* 生成 Package
* 启动执行
* 接管执行
* 提交 Review 决策
* 批准 Release
* 回滚

这些都是**明确命令**，而不是“前端想拿哪些字段就拿哪些字段”的问题。

Nest 的 OpenAPI/Swagger 支持可以直接从装饰器生成 REST API 文档，这对你这种“状态机 + 审批 + webhook + executor callback”的系统非常实用。([NestJS 文档][1])

---

## 为什么不建议 GraphQL-first

因为 GraphQL-first 在你这里会带来几个真实问题：

### 1. 命令语义不够清楚

虽然 GraphQL 有 mutation，但在这类系统里，REST 对“动作”表达更自然。

比如：

* `POST /plans/{id}:approve`
* `POST /execution-packages/{id}:run`
* `POST /review-packets/{id}:decide`
* `POST /releases/{id}:rollback`

这些都是很强的命令语义。

### 2. webhook / callback 不自然

你的执行器、CI、sandbox manager、artifact uploader 都会有很多回调。
这些天然就是 HTTP endpoint，不需要 GraphQL 参与。

### 3. 状态机系统更依赖幂等命令

你后面会大量处理：

* 重试
* 幂等键
* 回调补偿
* 信号恢复
* 审批重复提交

REST 更容易把这些边界设计清楚。

---

## 什么时候值得加 GraphQL

只有当你开始出现很多**复杂只读页面**时，再加。

例如：

### Work Item Cockpit

一个页面同时想拿：

* WorkItem
* current Spec / Plan
* 所有 Packages
* review 状态
* 测试证据
* release 记录
* incident 历史

### Release Cockpit

一个页面同时想拿：

* Release
* 关联 Work Items
* 所有 Packages
* test evidences
* rollout metrics
* rollback evidence

### Manager Dashboard

一个页面同时想拿：

* 多项目聚合
* 风险分布
* bottleneck
* review SLA
* release health

这时候 GraphQL 作为**读侧聚合层**会很舒服。
GraphQL 官方强调 schema 描述能力、类型系统、按需查询和 introspection，这些都很适合复杂前端工作台。([GraphQL][3])

---

# 5. 最推荐的 API 分层

## A. External Command APIs：REST

这部分永远走 REST。

例如：

```text
POST   /work-items
POST   /work-items/{id}/submit-spec
POST   /specs/{id}/approve
POST   /specs/{id}/request-changes
POST   /plans/{id}/approve
POST   /execution-packages/{id}/run
POST   /execution-packages/{id}/handover
POST   /review-packets/{id}/decide
POST   /releases/{id}/approve
POST   /releases/{id}/rollback
POST   /incidents
```

适合 REST 的原因：

* 明确命令
* 易做审计
* 易做幂等
* 易做 webhook / callback
* 易生成 OpenAPI

---

## B. Read APIs：前期 REST，后期可补 GraphQL

前期先这样：

```text
GET /work-items/{id}
GET /work-items/{id}/timeline
GET /specs/{id}
GET /plans/{id}
GET /execution-packages/{id}
GET /execution-packages/{id}/runs
GET /releases/{id}
GET /incidents/{id}
```

后期如果页面太复杂，再加：

```text
POST /graphql
```

只提供复杂聚合查询，不承载执行命令。

---

## C. Internal System APIs：REST + Async

内部服务之间不建议 GraphQL。

### Control Plane -> Executor Gateway

REST / gRPC 都行，但 V1 先 REST

### Executor Gateway -> Sandbox Manager

REST 或 gRPC
如果以后追求流式 attach 和高吞吐，可以演进成 gRPC

### Workflow -> Control Plane

尽量走数据库 + Activity 边界，不要绕来绕去同步调用

---

## D. 实时更新：SSE 优先，WebSocket 后置

你的很多页面本质是“状态流更新”，不是双向聊天。

所以建议：

* **前期用 SSE**

  * package 执行状态
  * review 状态
  * release rollout 进度
* 真有复杂交互时再上 WebSocket

SSE 对 dashboard / long-running task updates 很够用，而且简单。

---

# 6. 领域边界到 API 边界的映射

这是我最建议你直接拿去做 controller 模块划分的一版。

## `work-items`

REST

* 创建、更新、列表、详情、切 phase
* 查询当前 spec / plan / packages / release 指针

## `specs`

REST

* 生成草案
* 提交审批
* approve / request-changes
* revisions 查询

## `plans`

REST

* 生成草案
* 提交审批
* approve / request-changes
* revisions 查询

## `execution-packages`

REST

* 列表、详情
* run / cancel / retry / handover
* dependencies
* readiness
* attached runs

## `run-sessions`

REST

* 查询 run 详情
* logs metadata
* artifact list

## `review-packets`

REST

* 列表、详情
* decide
* comments
* escalation

## `releases`

REST

* 创建 release candidate
* approve
* start rollout
* rollback
* evidence

## `incidents`

REST

* 创建
* triage
* resolve
* links
* replay query

## `query`（后期）

GraphQL 或专门 query REST

* work-item cockpit
* release cockpit
* manager dashboard

---

# 7. 为什么这套边界长期更稳

## 对控制面

TS 会让对象模型和 DTO 演进更快。

## 对工作流

Temporal TS 让你不需要额外切语言就能先把 durable workflow 打通。官方文档已经明确把 Workflows、Activities、Workers、Task Queue 作为核心模型。([Temporal 文档][2])

## 对执行基础设施

Go 让你后面把资源控制和任务运行能力抽出来，而不污染控制面。

## 对 API

REST 让命令边界、审计、幂等、webhook 都更自然；GraphQL 只在它真正擅长的“复杂读侧聚合”里发挥价值。GraphQL 官方对 schema、query、mutation、introspection 的介绍，本身也说明它更偏“强类型查询层”。([GraphQL][3])

---

# 8. 最终拍板版

如果今天就要定，我会这样写进架构文档：

### 技术架构

* **Frontend**: Next.js / TypeScript
* **Control Plane API**: NestJS / TypeScript
* **Workflow Engine**: Temporal + TypeScript Workers
* **Executor Gateway**: TypeScript
* **Sandbox / Runner Infra**: Go
* **DB**: PostgreSQL
* **Cache / Queue Aux**: Redis
* **Object Storage**: COS / S3
* **Observability**: OTel + Metrics + Logs

### API 策略

* **Primary API**: RESTful + OpenAPI
* **Realtime**: SSE
* **Optional Read Aggregation**: GraphQL later
* **Do not use GraphQL as primary command protocol**

---

# 9. 一句话总结

**这套系统长期最稳的形态，是把“产品与流程”留在 TypeScript，把“资源与执行”交给 Go，把“复杂聚合读取”留给后期 GraphQL，而主协议始终坚持 REST。**

如果你愿意，我下一步直接给你出一版 **NestJS 模块结构 + REST 路由清单**。

[1]: https://docs.nestjs.com/openapi/introduction?utm_source=chatgpt.com "OpenAPI (Swagger) | NestJS - A progressive Node.js ..."
[2]: https://docs.temporal.io/develop/typescript?utm_source=chatgpt.com "TypeScript SDK developer guide"
[3]: https://graphql.org/?utm_source=chatgpt.com "GraphQL | The query language for modern APIs"

可以。下面我给你一版**可直接开工的 NestJS 模块结构 + REST 路由清单**。
这版会严格围绕你前面已经定下来的实体模型和边界来设计：

* Work Item 是跨角色主对象
* Spec / Plan 是定义对象
* Execution Package 是执行主对象
* Release 是交付编排对象
* Incident / Event / Artifact 支撑 replay 与 evolution

这和 PRD 里的对象分层、状态机和双主线是一致的。

---

# 1. 总体代码仓结构

我建议先不要一上来搞多 repo。
先用 **monorepo**，把控制面、workflow worker、executor gateway 放一起，后面再把 Go 的 sandbox manager 独立出去。

## 推荐目录

```text id="0qjlwm"
apps/
  control-plane-api/
  workflow-worker/
  executor-gateway/

packages/
  domain/
  application/
  infrastructure/
  contracts/
  shared/

services-go/
  sandbox-manager/    # 后面再实现也行

tools/
  scripts/
  migrations/
```

---

# 2. NestJS 总体模块分层

我建议控制面 API 不要按“技术层”切模块，而是按**领域对象**切模块。

## 控制面 API 的一级模块

```text id="g4opvw"
AppModule
├── AuthModule
├── ProjectModule
├── WorkItemModule
├── SpecModule
├── PlanModule
├── ExecutionPackageModule
├── RunSessionModule
├── ReviewPacketModule
├── TestEvidenceModule
├── ReleaseModule
├── IncidentModule
├── ContractModule
├── ReplayModule
├── ArtifactModule
├── DecisionModule
├── SearchQueryModule
├── IntegrationModule
└── HealthModule
```

这套模块基本就对应你前面定的实体设计方案。

---

# 3. 推荐的模块内部结构

每个领域模块内部尽量保持一致：

```text id="zw3cm8"
work-item/
  controllers/
    work-item.controller.ts
    work-item-query.controller.ts
  application/
    commands/
    queries/
    handlers/
    dto/
  domain/
    work-item.entity.ts
    work-item.repository.ts
    work-item.policy.ts
    work-item-state-machine.ts
  infrastructure/
    work-item.orm-entity.ts
    work-item.repository.impl.ts
  work-item.module.ts
```

## 为什么这样拆

* `controller`：HTTP 边界
* `application`：用例层
* `domain`：实体、规则、状态机
* `infrastructure`：数据库、外部集成

这样后面你迁移数据库、拆服务、接 workflow 都不会太乱。

---

# 4. 我建议的公共包

## `packages/domain`

放：

* 领域枚举
* 基础实体
* 状态机
* 领域错误
* 领域事件定义

## `packages/application`

放：

* command/query handler
* 用例编排
* 权限检查器
* 审批策略
* transition service

## `packages/infrastructure`

放：

* Prisma / TypeORM / Drizzle 封装
* Outbox
* Event publisher
* object storage client
* temporal client

## `packages/contracts`

放：

* DTO
* OpenAPI schema
* RunSpec schema
* executor result schema

## `packages/shared`

放：

* logger
* config
* ids
* paging
* auth context
* common decorators

---

# 5. 控制面 API：核心模块设计

---

## 5.1 ProjectModule

### 职责

* Project CRUD
* workflow_profile
* 默认 repo / branch
* 项目级配置

### 路由建议

```text id="wxq4ij"
GET    /projects
POST   /projects
GET    /projects/:projectId
PATCH  /projects/:projectId
GET    /projects/:projectId/summary
GET    /projects/:projectId/settings
PATCH  /projects/:projectId/settings
```

---

## 5.2 WorkItemModule

### 职责

* Work Item intake
* triage
* priority / risk
* current spec / plan / release 指针
* phase 流转

### 路由建议

```text id="dq0e0u"
GET    /work-items
POST   /work-items
GET    /work-items/:workItemId
PATCH  /work-items/:workItemId
POST   /work-items/:workItemId/triage
POST   /work-items/:workItemId/phase-transition
POST   /work-items/:workItemId/close
POST   /work-items/:workItemId/reopen
GET    /work-items/:workItemId/links
GET    /work-items/:workItemId/timeline
```

### 建议的 command

* `CreateWorkItemCommand`
* `TriageWorkItemCommand`
* `TransitionWorkItemPhaseCommand`
* `CloseWorkItemCommand`

### 不建议

不要把 Spec / Plan 的逻辑塞进 WorkItemController。

---

## 5.3 SpecModule

### 职责

* Spec 生成
* revisions
* 提交审批
* approve / request changes

### 路由建议

```text id="v956pa"
GET    /specs
POST   /specs
GET    /specs/:specId
PATCH  /specs/:specId
GET    /specs/:specId/revisions
POST   /specs/:specId/revisions
GET    /specs/:specId/revisions/:revisionId
POST   /specs/:specId/generate-draft
POST   /specs/:specId/submit-for-approval
POST   /specs/:specId/approve
POST   /specs/:specId/request-changes
POST   /specs/:specId/supersede
```

### 补充一个便捷入口

因为 Work Item 是主入口，前端也会经常从 Work Item 发起：

```text id="b43x50"
POST   /work-items/:workItemId/specs/generate
POST   /work-items/:workItemId/specs
GET    /work-items/:workItemId/specs
```

---

## 5.4 PlanModule

### 职责

* 从 Spec 生成 Plan
* revisions
* 审批
* 与 PlanRevision 的拆分关系管理

### 路由建议

```text id="d1zj72"
GET    /plans
POST   /plans
GET    /plans/:planId
PATCH  /plans/:planId
GET    /plans/:planId/revisions
POST   /plans/:planId/revisions
GET    /plans/:planId/revisions/:revisionId
POST   /plans/:planId/generate-draft
POST   /plans/:planId/submit-for-approval
POST   /plans/:planId/approve
POST   /plans/:planId/request-changes
POST   /plans/:planId/supersede
```

### Work Item 入口

```text id="tihj88"
POST   /work-items/:workItemId/plans/generate
POST   /work-items/:workItemId/plans
GET    /work-items/:workItemId/plans
```

---

## 5.5 ExecutionPackageModule

这是核心模块之一。
它负责真正的执行单元管理，对应 PRD 中的执行主对象。

### 职责

* Package CRUD
* 从 PlanRevision 生成 packages
* dependency graph
* readiness
* owner/reviewer/qa
* RunSpec 生成
* phase/activity/gate 流转

### 路由建议

```text id="wo7rm9"
GET    /execution-packages
POST   /execution-packages
GET    /execution-packages/:packageId
PATCH  /execution-packages/:packageId
POST   /execution-packages/:packageId/phase-transition
POST   /execution-packages/:packageId/block
POST   /execution-packages/:packageId/unblock
POST   /execution-packages/:packageId/handover
POST   /execution-packages/:packageId/archive
GET    /execution-packages/:packageId/readiness
GET    /execution-packages/:packageId/run-spec
GET    /execution-packages/:packageId/dependencies
POST   /execution-packages/:packageId/dependencies
DELETE /execution-packages/:packageId/dependencies/:dependsOnPackageId
```

### 从 PlanRevision 批量生成

这里是关键入口，因为我们已经明确了 **PlanRevision 1-N ExecutionPackages**。

```text id="pv54mw"
POST   /plan-revisions/:planRevisionId/generate-packages
GET    /plan-revisions/:planRevisionId/execution-packages
```

### Work Item 维度查询

```text id="bt2dvw"
GET    /work-items/:workItemId/execution-packages
```

---

## 5.6 RunSessionModule

### 职责

* 单次执行会话
* logs metadata
* artifact 引用
* executor result 查询

### 路由建议

```text id="3wglsa"
GET    /run-sessions
GET    /run-sessions/:runSessionId
GET    /run-sessions/:runSessionId/logs
GET    /run-sessions/:runSessionId/artifacts
GET    /run-sessions/:runSessionId/result
POST   /run-sessions/:runSessionId/cancel
```

### Package 触发执行

更自然地应该从 Package 发：

```text id="n9ejvm"
POST   /execution-packages/:packageId/run
POST   /execution-packages/:packageId/retry
POST   /execution-packages/:packageId/cancel-run
GET    /execution-packages/:packageId/run-sessions
```

---

## 5.7 ReviewPacketModule

### 职责

* review packet 生成
* AI self-review / independent review
* human review decision

### 路由建议

```text id="l7aptw"
GET    /review-packets
POST   /review-packets
GET    /review-packets/:reviewPacketId
PATCH  /review-packets/:reviewPacketId
POST   /review-packets/:reviewPacketId/start-review
POST   /review-packets/:reviewPacketId/decide
POST   /review-packets/:reviewPacketId/escalate
GET    /review-packets/:reviewPacketId/comments
POST   /review-packets/:reviewPacketId/comments
```

### Package 维度入口

```text id="9sq00v"
POST   /execution-packages/:packageId/generate-review-packet
GET    /execution-packages/:packageId/review-packets
```

---

## 5.8 TestEvidenceModule

### 职责

* 测试证据
* gate 汇总
* 回归建议

### 路由建议

```text id="a5yocd"
GET    /test-evidences
POST   /test-evidences
GET    /test-evidences/:testEvidenceId
PATCH  /test-evidences/:testEvidenceId
GET    /execution-packages/:packageId/test-evidences
GET    /work-items/:workItemId/test-evidences
GET    /execution-packages/:packageId/test-summary
```

---

## 5.9 ReleaseModule

### 职责

* Release candidate
* 聚合 work items / packages
* 审批
* rollout / rollback
* evidence

### 路由建议

```text id="fx29bm"
GET    /releases
POST   /releases
GET    /releases/:releaseId
PATCH  /releases/:releaseId
POST   /releases/:releaseId/submit-for-approval
POST   /releases/:releaseId/approve
POST   /releases/:releaseId/request-changes
POST   /releases/:releaseId/start-rollout
POST   /releases/:releaseId/pause-rollout
POST   /releases/:releaseId/rollback
GET    /releases/:releaseId/evidences
POST   /releases/:releaseId/evidences
GET    /releases/:releaseId/timeline
```

### 关联对象路由

```text id="yo444g"
GET    /releases/:releaseId/work-items
POST   /releases/:releaseId/work-items/:workItemId
DELETE /releases/:releaseId/work-items/:workItemId

GET    /releases/:releaseId/execution-packages
POST   /releases/:releaseId/execution-packages/:packageId
DELETE /releases/:releaseId/execution-packages/:packageId
```

---

## 5.10 IncidentModule

### 职责

* incident lifecycle
* link 到 release/work item/package
* replay 起点

### 路由建议

```text id="x57hcn"
GET    /incidents
POST   /incidents
GET    /incidents/:incidentId
PATCH  /incidents/:incidentId
POST   /incidents/:incidentId/triage
POST   /incidents/:incidentId/mark-resolved
POST   /incidents/:incidentId/close
GET    /incidents/:incidentId/links
POST   /incidents/:incidentId/links
DELETE /incidents/:incidentId/links/:linkId
GET    /incidents/:incidentId/timeline
```

---

## 5.11 ContractModule

如果 V1 不全做，也建议先把接口骨架留出来。

### 路由建议

```text id="g8u36j"
GET    /contracts
POST   /contracts
GET    /contracts/:contractId
PATCH  /contracts/:contractId
GET    /contracts/:contractId/revisions
POST   /contracts/:contractId/revisions
POST   /contracts/:contractId/submit-for-approval
POST   /contracts/:contractId/approve
POST   /contracts/:contractId/freeze
GET    /execution-packages/:packageId/contracts
POST   /execution-packages/:packageId/contracts/:contractId
DELETE /execution-packages/:packageId/contracts/:contractId
```

---

## 5.12 ReplayModule

这是你和普通 AI coding 平台拉开差距的关键模块之一。PRD 里也明确有 Process Replay / Timeline / 决策节点 / AI/Human 行为轨迹查看。

### 路由建议

```text id="9dnxg4"
GET /replay/work-items/:workItemId
GET /replay/execution-packages/:packageId
GET /replay/releases/:releaseId
GET /replay/incidents/:incidentId
GET /replay/objects/:objectType/:objectId/timeline
GET /replay/objects/:objectType/:objectId/events
GET /replay/objects/:objectType/:objectId/decisions
GET /replay/objects/:objectType/:objectId/status-history
```

---

## 5.13 ArtifactModule

### 路由建议

```text id="js0z5f"
GET    /artifacts/:artifactId
GET    /objects/:objectType/:objectId/artifacts
POST   /objects/:objectType/:objectId/artifacts
```

---

## 5.14 DecisionModule

### 路由建议

```text id="2vhjwe"
GET  /objects/:objectType/:objectId/decisions
POST /objects/:objectType/:objectId/decisions
```

---

## 5.15 SearchQueryModule

这个模块前期仍然建议 REST，不要一开始上 GraphQL。

### 路由建议

```text id="57ph1s"
GET /search/work-items
GET /search/execution-packages
GET /search/releases
GET /search/incidents
GET /query/work-item-cockpit/:workItemId
GET /query/release-cockpit/:releaseId
GET /query/manager-dashboard
```

这几个 `/query/*` 路由，本质上就是以后最可能迁到 GraphQL 的读侧聚合接口。

---

# 6. Workflow Worker 的职责分解

控制面 API 不应该直接做长逻辑。
这些应该下沉到 workflow worker。

## 推荐 workflow 名称

```text id="kp5j6u"
work_item_intake_workflow
spec_drafting_workflow
spec_approval_workflow
plan_drafting_workflow
plan_approval_workflow
package_generation_workflow
package_execution_workflow
review_workflow
release_workflow
incident_replay_workflow
```

## 典型 workflow 例子

### `package_execution_workflow`

步骤可能是：

1. 校验 package phase / gate
2. 生成 RunSpec
3. 调 executor-gateway
4. 等待 run 完成回调
5. 生成 review packet
6. 更新 package phase/gate
7. 发通知

### `release_workflow`

步骤可能是：

1. 聚合 packages / work items
2. 校验证据
3. 等待审批 signal
4. rollout
5. 观察期
6. 完成或 rollback

Temporal 的 TS SDK 天然适合这种 durable workflow / worker 模式。([docs.temporal.io](https://docs.temporal.io/develop/typescript?utm_source=chatgpt.com))

---

# 7. Executor Gateway 的职责

这个服务不要承担太多产品逻辑。
它的定位应该很薄。

## 职责

* 接收 RunSpec
* 组装执行上下文
* 调 sandbox-manager
* 调你 fork 的 Codex
* 接收执行结果
* 上传 artifacts
* 回调 control-plane

## 推荐接口

```text id="qkscft"
POST /internal/executions
GET  /internal/executions/:executionId
POST /internal/executions/:executionId/cancel
POST /internal/executions/:executionId/handover
POST /internal/executions/:executionId/callback
```

### 输入

* `run_spec`
* `executor_policy`
* `skills_refs`
* `artifact_policy`

### 输出

* `status`
* `changed_files`
* `summary`
* `artifact_refs`
* `test_results`
* `review_inputs`

---

# 8. Sandbox Manager（Go）的接口建议

这层只管资源和运行，不懂 Work Item / Plan / ReviewPacket 这些业务语义。

## 推荐接口

```text id="zctlqj"
POST /sandboxes
GET  /sandboxes/:sandboxId
DELETE /sandboxes/:sandboxId

POST /sandboxes/:sandboxId/workspaces
POST /sandboxes/:sandboxId/exec
POST /sandboxes/:sandboxId/attach
GET  /sandboxes/:sandboxId/logs
POST /sandboxes/:sandboxId/artifacts
```

这样服务边界会非常清楚：

* Control Plane：懂业务对象
* Workflow：懂流程推进
* Executor Gateway：懂执行协议
* Sandbox Manager：只懂资源和命令运行

---

# 9. REST 与 GraphQL 的最终划分

## 现在就用 REST 的

这些一定 REST：

* 所有 command
* 所有审批
* 所有 phase transition
* 所有 run / retry / cancel / rollback
* 所有 callback / webhook
* 所有 artifact upload

因为它们都是**强动作语义**。

---

## 未来可以放进 GraphQL 的

这些以后很适合 GraphQL：

### 1. Work Item Cockpit

一个 query 拿：

* WorkItem
* current Spec / Plan
* packages
* latest runs
* latest review packets
* release summary
* incident summary

### 2. Release Cockpit

一个 query 拿：

* Release
* work items
* packages
* evidences
* rollout status
* rollback history

### 3. Manager Dashboard

一个 query 拿：

* 多项目统计
* 风险分布
* bottleneck
* SLA
* release health

所以 GraphQL 最好以后只做：
**复杂读侧聚合层**

Nest 官方对 GraphQL 模块支持是成熟的，但我仍然不建议你把 mutation/command 主体放进去。([docs.nestjs.com](https://docs.nestjs.com/graphql/quick-start?utm_source=chatgpt.com))

---

# 10. 推荐的 OpenAPI 分组

为了让前后端协作更顺，我建议你一开始就按 tag 分组：

```text id="ryogdk"
Projects
Work Items
Specs
Plans
Execution Packages
Run Sessions
Review Packets
Test Evidences
Releases
Incidents
Contracts
Replay
Artifacts
Decisions
Search / Query
Internal Executions
Internal Sandboxes
```

这样后面不管是给前端、给外部集成、还是给 executor，对接口理解都会更清楚。

---

# 11. 我最建议的 NestJS App 结构

## `apps/control-plane-api/src/app.module.ts`

```text id="rk3hd2"
AppModule
├── ConfigModule
├── LoggerModule
├── DatabaseModule
├── AuthModule
├── ProjectModule
├── WorkItemModule
├── SpecModule
├── PlanModule
├── ExecutionPackageModule
├── RunSessionModule
├── ReviewPacketModule
├── TestEvidenceModule
├── ReleaseModule
├── IncidentModule
├── ContractModule
├── ReplayModule
├── ArtifactModule
├── DecisionModule
├── SearchQueryModule
├── IntegrationModule
└── HealthModule
```

## `apps/workflow-worker/src`

```text id="n2cc84"
workers/
  spec.worker.ts
  plan.worker.ts
  package.worker.ts
  review.worker.ts
  release.worker.ts

activities/
  generate-spec.activity.ts
  generate-plan.activity.ts
  generate-packages.activity.ts
  build-runspec.activity.ts
  trigger-executor.activity.ts
  create-review-packet.activity.ts
  aggregate-release-evidence.activity.ts
```

## `apps/executor-gateway/src`

```text id="l21a4e"
ExecutorGatewayModule
├── ExecutionController
├── ExecutionCallbackController
├── SandboxClient
├── CodexClient
├── ArtifactClient
└── ExecutionResultMapper
```

---

# 12. 你现在最适合先实现的接口子集

为了避免接口太多一开始压垮研发，我建议先做 P0/P1 的最小子集：

## 第一批必须有

```text id="xdjlwm"
POST /work-items
GET  /work-items/:id

POST /work-items/:id/specs/generate
POST /specs/:id/submit-for-approval
POST /specs/:id/approve

POST /work-items/:id/plans/generate
POST /plans/:id/submit-for-approval
POST /plans/:id/approve

POST /plan-revisions/:id/generate-packages
GET  /execution-packages/:id
POST /execution-packages/:id/run
GET  /execution-packages/:id/run-sessions

POST /execution-packages/:id/generate-review-packet
POST /review-packets/:id/decide

GET  /replay/execution-packages/:id
```

这批就能跑通最短闭环。

---

# 13. 最终一句话

**NestJS 控制面应该按领域对象切模块，REST 负责所有命令与状态流转，Temporal worker 负责长流程推进，Executor Gateway 隔离 Codex 执行器，Go 的 Sandbox Manager 只负责资源与运行。GraphQL 未来只做复杂只读 cockpit。**

这套边界最适合你现在这个系统从 0 到 1 起盘，也能平滑演进到后面的多端协同、复盘和组织级能力。

下一步最顺的是，我直接继续给你一版 **P0/P1 对应的 NestJS controller + service + DTO skeleton**。

下面我直接给你一版 **P0 / P1 可开工的 NestJS skeleton**。
它只覆盖最短闭环：

**Work Item → Spec → Plan → Execution Package → RunSession → ReviewPacket**

这和你 PRD 里把 Work Item 作为跨角色主对象、Execution Package 作为执行主对象、Spec/Plan 作为上游定义、Review Packet 作为结构化审查包的设计是对齐的。

---

# 1. 目录骨架

```text
apps/
  control-plane-api/
    src/
      main.ts
      app.module.ts

      modules/
        auth/
        health/
        projects/
        work-items/
        specs/
        plans/
        execution-packages/
        run-sessions/
        review-packets/
        replay/

      common/
        decorators/
        filters/
        guards/
        interceptors/
        pipes/

  workflow-worker/
    src/
      main.ts
      workers/
        spec.worker.ts
        plan.worker.ts
        package.worker.ts
        review.worker.ts
      workflows/
        spec-drafting.workflow.ts
        plan-drafting.workflow.ts
        package-execution.workflow.ts
      activities/
        generate-spec.activity.ts
        generate-plan.activity.ts
        generate-packages.activity.ts
        build-runspec.activity.ts
        trigger-executor.activity.ts
        create-review-packet.activity.ts

  executor-gateway/
    src/
      main.ts
      app.module.ts
      execution/
        execution.controller.ts
        execution.service.ts
        codex.client.ts
        sandbox.client.ts
        result-mapper.ts

packages/
  shared/
    src/
      ids/
      enums/
      dto/
      errors/
      utils/

  domain/
    src/
      work-item/
      spec/
      plan/
      execution-package/
      review-packet/

  contracts/
    src/
      runspec/
      executor-result/
      api/
```

---

# 2. 控制面 AppModule

```ts
// apps/control-plane-api/src/app.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { WorkItemsModule } from './modules/work-items/work-items.module';
import { SpecsModule } from './modules/specs/specs.module';
import { PlansModule } from './modules/plans/plans.module';
import { ExecutionPackagesModule } from './modules/execution-packages/execution-packages.module';
import { RunSessionsModule } from './modules/run-sessions/run-sessions.module';
import { ReviewPacketsModule } from './modules/review-packets/review-packets.module';
import { ReplayModule } from './modules/replay/replay.module';

@Module({
  imports: [
    AuthModule,
    HealthModule,
    ProjectsModule,
    WorkItemsModule,
    SpecsModule,
    PlansModule,
    ExecutionPackagesModule,
    RunSessionsModule,
    ReviewPacketsModule,
    ReplayModule,
  ],
})
export class AppModule {}
```

---

# 3. 最关键的共享枚举

这些枚举尽量和你前面定下来的实体状态一致，不要在 controller 里随手写字符串。PRD 已经明确给了 Work Item 和 Execution Package 的生命周期，以及 Review / Release / Replay 的主线语义。

```ts
// packages/shared/src/enums/work-item.enums.ts
export enum WorkItemKind {
  Initiative = 'initiative',
  Requirement = 'requirement',
  Bug = 'bug',
  TechDebt = 'tech_debt',
}

export enum WorkItemPhase {
  Draft = 'draft',
  Triage = 'triage',
  Spec = 'spec',
  Plan = 'plan',
  Execution = 'execution',
  Release = 'release',
  Observing = 'observing',
  Done = 'done',
  Closed = 'closed',
}

export enum WorkItemActivityState {
  Idle = 'idle',
  InProgress = 'in_progress',
  AwaitingAI = 'awaiting_ai',
  AIRunning = 'ai_running',
  AwaitingHuman = 'awaiting_human',
  HumanInProgress = 'human_in_progress',
  Blocked = 'blocked',
}

export enum WorkItemGateState {
  None = 'none',
  AwaitingSpecApproval = 'awaiting_spec_approval',
  SpecChangesRequested = 'spec_changes_requested',
  AwaitingPlanApproval = 'awaiting_plan_approval',
  PlanChangesRequested = 'plan_changes_requested',
  AwaitingReleaseApproval = 'awaiting_release_approval',
  ReleaseChangesRequested = 'release_changes_requested',
}
```

```ts
// packages/shared/src/enums/execution-package.enums.ts
export enum ExecutionPackagePhase {
  Draft = 'draft',
  Ready = 'ready',
  Queued = 'queued',
  Execution = 'execution',
  Review = 'review',
  Integration = 'integration',
  TestGate = 'test_gate',
  Release = 'release',
  Archived = 'archived',
}

export enum ExecutionPackageActivityState {
  Idle = 'idle',
  AIRunning = 'ai_running',
  AIRetrying = 'ai_retrying',
  HumanEditing = 'human_editing',
  AwaitingHuman = 'awaiting_human',
  HumanReviewing = 'human_reviewing',
  Blocked = 'blocked',
  Handover = 'handover',
}

export enum ExecutionPackageGateState {
  NotSubmitted = 'not_submitted',
  SelfReviewPending = 'self_review_pending',
  AwaitingHumanReview = 'awaiting_human_review',
  ChangesRequested = 'changes_requested',
  ReviewApproved = 'review_approved',
  IntegrationFailed = 'integration_failed',
  IntegrationPassed = 'integration_passed',
  TestFailed = 'test_failed',
  TestPassed = 'test_passed',
  ReleaseReady = 'release_ready',
  Released = 'released',
}
```

---

# 4. WorkItem 模块 skeleton

## Module

```ts
// apps/control-plane-api/src/modules/work-items/work-items.module.ts
import { Module } from '@nestjs/common';
import { WorkItemsController } from './work-items.controller';
import { WorkItemsService } from './work-items.service';

@Module({
  controllers: [WorkItemsController],
  providers: [WorkItemsService],
  exports: [WorkItemsService],
})
export class WorkItemsModule {}
```

## DTO

```ts
// apps/control-plane-api/src/modules/work-items/dto/create-work-item.dto.ts
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { WorkItemKind } from '@repo/shared/enums/work-item.enums';

export class CreateWorkItemDto {
  @IsUUID()
  projectId!: string;

  @IsEnum(WorkItemKind)
  kind!: WorkItemKind;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  background?: string;

  @IsOptional()
  @IsString()
  goal?: string;
}
```

```ts
// apps/control-plane-api/src/modules/work-items/dto/transition-work-item-phase.dto.ts
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { WorkItemPhase } from '@repo/shared/enums/work-item.enums';

export class TransitionWorkItemPhaseDto {
  @IsEnum(WorkItemPhase)
  toPhase!: WorkItemPhase;

  @IsOptional()
  @IsString()
  reason?: string;
}
```

## Controller

```ts
// apps/control-plane-api/src/modules/work-items/work-items.controller.ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { WorkItemsService } from './work-items.service';
import { CreateWorkItemDto } from './dto/create-work-item.dto';
import { TransitionWorkItemPhaseDto } from './dto/transition-work-item-phase.dto';

@Controller('work-items')
export class WorkItemsController {
  constructor(private readonly service: WorkItemsService) {}

  @Get()
  list(@Query('projectId') projectId?: string) {
    return this.service.list(projectId);
  }

  @Post()
  create(@Body() dto: CreateWorkItemDto) {
    return this.service.create(dto);
  }

  @Get(':workItemId')
  get(@Param('workItemId') workItemId: string) {
    return this.service.getById(workItemId);
  }

  @Patch(':workItemId')
  update(@Param('workItemId') workItemId: string, @Body() dto: Record<string, unknown>) {
    return this.service.update(workItemId, dto);
  }

  @Post(':workItemId/triage')
  triage(@Param('workItemId') workItemId: string) {
    return this.service.triage(workItemId);
  }

  @Post(':workItemId/phase-transition')
  transitionPhase(
    @Param('workItemId') workItemId: string,
    @Body() dto: TransitionWorkItemPhaseDto,
  ) {
    return this.service.transitionPhase(workItemId, dto);
  }

  @Get(':workItemId/timeline')
  timeline(@Param('workItemId') workItemId: string) {
    return this.service.getTimeline(workItemId);
  }
}
```

## Service

```ts
// apps/control-plane-api/src/modules/work-items/work-items.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateWorkItemDto } from './dto/create-work-item.dto';
import { TransitionWorkItemPhaseDto } from './dto/transition-work-item-phase.dto';
import { WorkItemPhase, WorkItemActivityState } from '@repo/shared/enums/work-item.enums';

@Injectable()
export class WorkItemsService {
  async list(projectId?: string) {
    return { items: [], projectId };
  }

  async create(dto: CreateWorkItemDto) {
    return {
      id: 'wi_xxx',
      key: 'WI-1',
      phase: WorkItemPhase.Draft,
      activityState: WorkItemActivityState.Idle,
      ...dto,
    };
  }

  async getById(workItemId: string) {
    if (!workItemId) throw new NotFoundException('WorkItem not found');
    return { id: workItemId };
  }

  async update(workItemId: string, dto: Record<string, unknown>) {
    return { id: workItemId, ...dto };
  }

  async triage(workItemId: string) {
    return {
      id: workItemId,
      phase: WorkItemPhase.Triage,
      activityState: WorkItemActivityState.InProgress,
    };
  }

  async transitionPhase(workItemId: string, dto: TransitionWorkItemPhaseDto) {
    return {
      id: workItemId,
      phase: dto.toPhase,
      reason: dto.reason ?? null,
    };
  }

  async getTimeline(workItemId: string) {
    return {
      objectType: 'work_item',
      objectId: workItemId,
      events: [],
    };
  }
}
```

---

# 5. Spec 模块 skeleton

PRD 里 Spec Studio 的职责很清楚：生成草案、多角色协作、版本管理、审批。

## Controller

```ts
// apps/control-plane-api/src/modules/specs/specs.controller.ts
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { SpecsService } from './specs.service';

@Controller()
export class SpecsController {
  constructor(private readonly service: SpecsService) {}

  @Post('work-items/:workItemId/specs/generate')
  generateForWorkItem(@Param('workItemId') workItemId: string) {
    return this.service.generateDraftForWorkItem(workItemId);
  }

  @Post('work-items/:workItemId/specs')
  createForWorkItem(@Param('workItemId') workItemId: string, @Body() dto: Record<string, unknown>) {
    return this.service.createForWorkItem(workItemId, dto);
  }

  @Get('work-items/:workItemId/specs')
  listByWorkItem(@Param('workItemId') workItemId: string) {
    return this.service.listByWorkItem(workItemId);
  }

  @Get('specs/:specId')
  get(@Param('specId') specId: string) {
    return this.service.getById(specId);
  }

  @Patch('specs/:specId')
  update(@Param('specId') specId: string, @Body() dto: Record<string, unknown>) {
    return this.service.update(specId, dto);
  }

  @Get('specs/:specId/revisions')
  listRevisions(@Param('specId') specId: string) {
    return this.service.listRevisions(specId);
  }

  @Post('specs/:specId/submit-for-approval')
  submit(@Param('specId') specId: string) {
    return this.service.submitForApproval(specId);
  }

  @Post('specs/:specId/approve')
  approve(@Param('specId') specId: string) {
    return this.service.approve(specId);
  }

  @Post('specs/:specId/request-changes')
  requestChanges(@Param('specId') specId: string, @Body() body: { reason?: string }) {
    return this.service.requestChanges(specId, body.reason);
  }
}
```

## Service

```ts
// apps/control-plane-api/src/modules/specs/specs.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class SpecsService {
  async generateDraftForWorkItem(workItemId: string) {
    return {
      specId: 'spec_xxx',
      workItemId,
      status: 'draft',
      editingState: 'ai_drafting',
    };
  }

  async createForWorkItem(workItemId: string, dto: Record<string, unknown>) {
    return { specId: 'spec_xxx', workItemId, ...dto };
  }

  async listByWorkItem(workItemId: string) {
    return { items: [], workItemId };
  }

  async getById(specId: string) {
    return { id: specId };
  }

  async update(specId: string, dto: Record<string, unknown>) {
    return { id: specId, ...dto };
  }

  async listRevisions(specId: string) {
    return { specId, revisions: [] };
  }

  async submitForApproval(specId: string) {
    return { id: specId, status: 'in_review', gateState: 'awaiting_approval' };
  }

  async approve(specId: string) {
    return { id: specId, status: 'approved', gateState: 'approved' };
  }

  async requestChanges(specId: string, reason?: string) {
    return { id: specId, status: 'in_review', gateState: 'changes_requested', reason: reason ?? null };
  }
}
```

---

# 6. Plan 模块 skeleton

Plan & Execution Builder 在 PRD 里承担从已批准 Spec 生成实施方案与执行包的职责。

## Controller

```ts
// apps/control-plane-api/src/modules/plans/plans.controller.ts
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { PlansService } from './plans.service';

@Controller()
export class PlansController {
  constructor(private readonly service: PlansService) {}

  @Post('work-items/:workItemId/plans/generate')
  generate(@Param('workItemId') workItemId: string) {
    return this.service.generateDraftForWorkItem(workItemId);
  }

  @Get('work-items/:workItemId/plans')
  listByWorkItem(@Param('workItemId') workItemId: string) {
    return this.service.listByWorkItem(workItemId);
  }

  @Get('plans/:planId')
  get(@Param('planId') planId: string) {
    return this.service.getById(planId);
  }

  @Patch('plans/:planId')
  update(@Param('planId') planId: string, @Body() dto: Record<string, unknown>) {
    return this.service.update(planId, dto);
  }

  @Get('plans/:planId/revisions')
  listRevisions(@Param('planId') planId: string) {
    return this.service.listRevisions(planId);
  }

  @Post('plans/:planId/submit-for-approval')
  submit(@Param('planId') planId: string) {
    return this.service.submitForApproval(planId);
  }

  @Post('plans/:planId/approve')
  approve(@Param('planId') planId: string) {
    return this.service.approve(planId);
  }

  @Post('plans/:planId/request-changes')
  requestChanges(@Param('planId') planId: string, @Body() body: { reason?: string }) {
    return this.service.requestChanges(planId, body.reason);
  }
}
```

---

# 7. ExecutionPackage 模块 skeleton

这是最关键的模块之一。PRD 里已经明确：Execution Package 是执行层一等公民，必须支持依赖、修改边界、测试要求、环境要求、联调 readiness 和状态跟踪。

## Controller

```ts
// apps/control-plane-api/src/modules/execution-packages/execution-packages.controller.ts
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ExecutionPackagesService } from './execution-packages.service';

@Controller()
export class ExecutionPackagesController {
  constructor(private readonly service: ExecutionPackagesService) {}

  @Post('plan-revisions/:planRevisionId/generate-packages')
  generateFromPlanRevision(@Param('planRevisionId') planRevisionId: string) {
    return this.service.generateFromPlanRevision(planRevisionId);
  }

  @Get('plan-revisions/:planRevisionId/execution-packages')
  listByPlanRevision(@Param('planRevisionId') planRevisionId: string) {
    return this.service.listByPlanRevision(planRevisionId);
  }

  @Get('work-items/:workItemId/execution-packages')
  listByWorkItem(@Param('workItemId') workItemId: string) {
    return this.service.listByWorkItem(workItemId);
  }

  @Get('execution-packages/:packageId')
  get(@Param('packageId') packageId: string) {
    return this.service.getById(packageId);
  }

  @Patch('execution-packages/:packageId')
  update(@Param('packageId') packageId: string, @Body() dto: Record<string, unknown>) {
    return this.service.update(packageId, dto);
  }

  @Get('execution-packages/:packageId/run-spec')
  getRunSpec(@Param('packageId') packageId: string) {
    return this.service.buildRunSpec(packageId);
  }

  @Post('execution-packages/:packageId/run')
  run(@Param('packageId') packageId: string) {
    return this.service.run(packageId);
  }

  @Post('execution-packages/:packageId/retry')
  retry(@Param('packageId') packageId: string) {
    return this.service.retry(packageId);
  }

  @Post('execution-packages/:packageId/handover')
  handover(@Param('packageId') packageId: string, @Body() body: { reason?: string }) {
    return this.service.handover(packageId, body.reason);
  }

  @Get('execution-packages/:packageId/dependencies')
  listDependencies(@Param('packageId') packageId: string) {
    return this.service.listDependencies(packageId);
  }

  @Post('execution-packages/:packageId/dependencies')
  addDependency(
    @Param('packageId') packageId: string,
    @Body() body: { dependsOnPackageId: string; dependencyType: string },
  ) {
    return this.service.addDependency(packageId, body);
  }

  @Delete('execution-packages/:packageId/dependencies/:dependsOnPackageId')
  removeDependency(
    @Param('packageId') packageId: string,
    @Param('dependsOnPackageId') dependsOnPackageId: string,
  ) {
    return this.service.removeDependency(packageId, dependsOnPackageId);
  }
}
```

## Service

```ts
// apps/control-plane-api/src/modules/execution-packages/execution-packages.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class ExecutionPackagesService {
  async generateFromPlanRevision(planRevisionId: string) {
    return {
      planRevisionId,
      packages: [],
    };
  }

  async listByPlanRevision(planRevisionId: string) {
    return { planRevisionId, items: [] };
  }

  async listByWorkItem(workItemId: string) {
    return { workItemId, items: [] };
  }

  async getById(packageId: string) {
    return { id: packageId };
  }

  async update(packageId: string, dto: Record<string, unknown>) {
    return { id: packageId, ...dto };
  }

  async buildRunSpec(packageId: string) {
    return {
      packageId,
      objective: 'implement package',
      allowedPaths: ['src/**'],
      requiredChecks: ['lint', 'test'],
    };
  }

  async run(packageId: string) {
    return {
      packageId,
      workflow: 'package_execution_workflow',
      status: 'queued',
    };
  }

  async retry(packageId: string) {
    return { packageId, status: 'queued', retried: true };
  }

  async handover(packageId: string, reason?: string) {
    return { packageId, activityState: 'handover', reason: reason ?? null };
  }

  async listDependencies(packageId: string) {
    return { packageId, items: [] };
  }

  async addDependency(packageId: string, body: { dependsOnPackageId: string; dependencyType: string }) {
    return { packageId, ...body };
  }

  async removeDependency(packageId: string, dependsOnPackageId: string) {
    return { packageId, dependsOnPackageId, removed: true };
  }
}
```

---

# 8. RunSession 模块 skeleton

```ts
// apps/control-plane-api/src/modules/run-sessions/run-sessions.controller.ts
import { Controller, Get, Param, Post } from '@nestjs/common';
import { RunSessionsService } from './run-sessions.service';

@Controller()
export class RunSessionsController {
  constructor(private readonly service: RunSessionsService) {}

  @Get('execution-packages/:packageId/run-sessions')
  listByPackage(@Param('packageId') packageId: string) {
    return this.service.listByPackage(packageId);
  }

  @Get('run-sessions/:runSessionId')
  get(@Param('runSessionId') runSessionId: string) {
    return this.service.getById(runSessionId);
  }

  @Get('run-sessions/:runSessionId/logs')
  getLogs(@Param('runSessionId') runSessionId: string) {
    return this.service.getLogs(runSessionId);
  }

  @Get('run-sessions/:runSessionId/artifacts')
  listArtifacts(@Param('runSessionId') runSessionId: string) {
    return this.service.listArtifacts(runSessionId);
  }

  @Post('run-sessions/:runSessionId/cancel')
  cancel(@Param('runSessionId') runSessionId: string) {
    return this.service.cancel(runSessionId);
  }
}
```

---

# 9. ReviewPacket 模块 skeleton

Review Center 在 PRD 中是正式产品模块，包含自动生成 Review Packet、AI 自审、独立 AI Review、人工审查入口。

```ts
// apps/control-plane-api/src/modules/review-packets/review-packets.controller.ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ReviewPacketsService } from './review-packets.service';

@Controller()
export class ReviewPacketsController {
  constructor(private readonly service: ReviewPacketsService) {}

  @Post('execution-packages/:packageId/generate-review-packet')
  generate(@Param('packageId') packageId: string) {
    return this.service.generateForPackage(packageId);
  }

  @Get('execution-packages/:packageId/review-packets')
  listByPackage(@Param('packageId') packageId: string) {
    return this.service.listByPackage(packageId);
  }

  @Get('review-packets/:reviewPacketId')
  get(@Param('reviewPacketId') reviewPacketId: string) {
    return this.service.getById(reviewPacketId);
  }

  @Post('review-packets/:reviewPacketId/start-review')
  startReview(@Param('reviewPacketId') reviewPacketId: string) {
    return this.service.startReview(reviewPacketId);
  }

  @Post('review-packets/:reviewPacketId/decide')
  decide(
    @Param('reviewPacketId') reviewPacketId: string,
    @Body()
    body: {
      decision: 'approved' | 'changes_requested' | 'need_more_context' | 'escalate';
      comment?: string;
    },
  ) {
    return this.service.decide(reviewPacketId, body);
  }
}
```

---

# 10. Replay 模块 skeleton

PRD 把 Process Replay 当成正式模块，而且要求能从 Work Item、Package、Release、Incident 回放全过程。

```ts
// apps/control-plane-api/src/modules/replay/replay.controller.ts
import { Controller, Get, Param } from '@nestjs/common';
import { ReplayService } from './replay.service';

@Controller('replay')
export class ReplayController {
  constructor(private readonly service: ReplayService) {}

  @Get('work-items/:workItemId')
  replayWorkItem(@Param('workItemId') workItemId: string) {
    return this.service.replay('work_item', workItemId);
  }

  @Get('execution-packages/:packageId')
  replayPackage(@Param('packageId') packageId: string) {
    return this.service.replay('execution_package', packageId);
  }

  @Get('releases/:releaseId')
  replayRelease(@Param('releaseId') releaseId: string) {
    return this.service.replay('release', releaseId);
  }

  @Get('incidents/:incidentId')
  replayIncident(@Param('incidentId') incidentId: string) {
    return this.service.replay('incident', incidentId);
  }
}
```

---

# 11. Workflow Worker skeleton

长流程不要塞进 controller/service，同步调一串会很乱。
像 Spec 生成、Plan 生成、Package 执行、Review 回写，都更适合 Workflow 层。PRD 的交付主线本身就是 durable workflow。

## package execution workflow

```ts
// apps/workflow-worker/src/workflows/package-execution.workflow.ts
import * as wf from '@temporalio/workflow';

const activities = wf.proxyActivities<{
  buildRunSpec(input: { packageId: string }): Promise<{ runSpec: unknown }>;
  triggerExecutor(input: { packageId: string; runSpec: unknown }): Promise<{ runSessionId: string }>;
  createReviewPacket(input: { packageId: string; runSessionId: string }): Promise<{ reviewPacketId: string }>;
}>({
  startToCloseTimeout: '10 minutes',
});

export async function packageExecutionWorkflow(input: { packageId: string }) {
  const { runSpec } = await activities.buildRunSpec({ packageId: input.packageId });
  const { runSessionId } = await activities.triggerExecutor({
    packageId: input.packageId,
    runSpec,
  });

  const executionFinishedSignal = wf.defineSignal<[{
    status: 'succeeded' | 'failed' | 'cancelled';
  }]>('executionFinished');

  let executionResult: { status: 'succeeded' | 'failed' | 'cancelled' } | null = null;

  wf.setHandler(executionFinishedSignal, async (payload) => {
    executionResult = payload;
  });

  await wf.condition(() => executionResult !== null);

  if (executionResult?.status !== 'succeeded') {
    return {
      packageId: input.packageId,
      runSessionId,
      status: executionResult?.status,
    };
  }

  const { reviewPacketId } = await activities.createReviewPacket({
    packageId: input.packageId,
    runSessionId,
  });

  return {
    packageId: input.packageId,
    runSessionId,
    reviewPacketId,
    status: 'awaiting_human_review',
  };
}
```

## activities

```ts
// apps/workflow-worker/src/activities/build-runspec.activity.ts
export async function buildRunSpecActivity(input: { packageId: string }) {
  return {
    runSpec: {
      packageId: input.packageId,
      objective: 'Implement package safely',
      allowedPaths: ['src/**'],
      requiredChecks: ['lint', 'test'],
    },
  };
}
```

```ts
// apps/workflow-worker/src/activities/trigger-executor.activity.ts
export async function triggerExecutorActivity(input: { packageId: string; runSpec: unknown }) {
  // 调 executor-gateway
  return {
    runSessionId: 'run_xxx',
  };
}
```

```ts
// apps/workflow-worker/src/activities/create-review-packet.activity.ts
export async function createReviewPacketActivity(input: { packageId: string; runSessionId: string }) {
  return {
    reviewPacketId: 'rp_xxx',
  };
}
```

---

# 12. Executor Gateway skeleton

这层只做执行协议，不懂 Work Item / Spec / Plan 业务语义。

## Controller

```ts
// apps/executor-gateway/src/execution/execution.controller.ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ExecutionService } from './execution.service';

@Controller('internal/executions')
export class ExecutionController {
  constructor(private readonly service: ExecutionService) {}

  @Post()
  create(@Body() body: { packageId: string; runSpec: unknown }) {
    return this.service.create(body);
  }

  @Get(':executionId')
  get(@Param('executionId') executionId: string) {
    return this.service.get(executionId);
  }

  @Post(':executionId/cancel')
  cancel(@Param('executionId') executionId: string) {
    return this.service.cancel(executionId);
  }

  @Post(':executionId/handover')
  handover(@Param('executionId') executionId: string, @Body() body: { reason?: string }) {
    return this.service.handover(executionId, body.reason);
  }

  @Post(':executionId/callback')
  callback(
    @Param('executionId') executionId: string,
    @Body()
    body: {
      status: 'succeeded' | 'failed' | 'cancelled';
      changedFiles?: string[];
      summary?: string;
      artifactRefs?: string[];
    },
  ) {
    return this.service.callback(executionId, body);
  }
}
```

## Service

```ts
// apps/executor-gateway/src/execution/execution.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class ExecutionService {
  async create(body: { packageId: string; runSpec: unknown }) {
    return {
      executionId: 'exec_xxx',
      packageId: body.packageId,
      status: 'queued',
    };
  }

  async get(executionId: string) {
    return { executionId, status: 'running' };
  }

  async cancel(executionId: string) {
    return { executionId, status: 'cancelled' };
  }

  async handover(executionId: string, reason?: string) {
    return { executionId, status: 'handed_over', reason: reason ?? null };
  }

  async callback(
    executionId: string,
    body: {
      status: 'succeeded' | 'failed' | 'cancelled';
      changedFiles?: string[];
      summary?: string;
      artifactRefs?: string[];
    },
  ) {
    return { executionId, ...body };
  }
}
```

---

# 13. RunSpec 合同 skeleton

Execution Package 在 PRD 中必须明确执行目标、允许修改范围、必须通过的检查与测试、环境需求、联调要求和完成定义，所以 RunSpec 一定要结构化。

```ts
// packages/contracts/src/runspec/run-spec.ts
export type RunSpec = {
  packageId: string;
  workItemId: string;

  objective: string;
  nonGoals?: string[];

  repo: {
    repoId: string;
    baseBranch?: string;
    baseCommitSha?: string;
  };

  boundaries: {
    allowedPaths: string[];
    forbiddenPaths?: string[];
  };

  checks: {
    requiredChecks: string[];
    requiredTestGates: string[];
  };

  context: {
    specRevisionId: string;
    planRevisionId: string;
    relatedArtifacts?: string[];
    skillRefs?: string[];
  };

  integration?: {
    readiness: string;
    prerequisites?: string[];
  };

  environment?: {
    networkPolicy?: 'none' | 'restricted' | 'full';
    timeoutSeconds?: number;
    cpu?: number;
    memoryMb?: number;
  };
};
```

---

# 14. 最小 DTO / 返回值风格建议

不要先纠结 CQRS 库，先统一 API 响应形状。

```ts
// packages/shared/src/dto/api-response.ts
export type ApiResponse<T> = {
  data: T;
  meta?: {
    requestId?: string;
    nextCursor?: string;
  };
};
```

```ts
// packages/shared/src/dto/paginated-response.ts
export type PaginatedResponse<T> = {
  items: T[];
  nextCursor?: string | null;
};
```

---

# 15. 我建议第一批先真的写出来的文件

不要一开始把所有模块都 fully implement。
先把这 12 个文件写出来，就能正式开干：

### control-plane-api

* `app.module.ts`
* `modules/work-items/work-items.module.ts`
* `modules/work-items/work-items.controller.ts`
* `modules/work-items/work-items.service.ts`
* `modules/specs/specs.controller.ts`
* `modules/specs/specs.service.ts`
* `modules/plans/plans.controller.ts`
* `modules/plans/plans.service.ts`
* `modules/execution-packages/execution-packages.controller.ts`
* `modules/execution-packages/execution-packages.service.ts`
* `modules/review-packets/review-packets.controller.ts`
* `modules/review-packets/review-packets.service.ts`

### workflow-worker

* `workflows/package-execution.workflow.ts`
* `activities/build-runspec.activity.ts`
* `activities/trigger-executor.activity.ts`
* `activities/create-review-packet.activity.ts`

### contracts

* `runspec/run-spec.ts`

---

# 16. 最终一句话

**先把控制面按对象切模块，把长流程放进 workflow worker，把 Codex 执行协议收敛到 executor-gateway，把 RunSpec 和 ReviewPacket 做成强结构化合同。**

这样你们就不是在“讨论架构”，而是在按 PRD 的主闭环真正起系统。

下一步最顺的是我直接继续给你一版 **Prisma schema / Drizzle schema 对应这些 skeleton 的数据层定义**。


如果只能二选一，**我建议你选 Drizzle**。

## 直接结论

对你这个系统，**Drizzle 比 Prisma 更合适做长期主 ORM / 数据访问层**。

原因不是它“更流行”，而是它更适合你这类系统的真实特点：

* **Postgres-centric**
* **对象关系复杂**
* **revision / event / history / link tables 很多**
* **状态机和审计查询很多**
* **后面一定会出现不少手写 SQL、聚合查询和定制迁移**

Drizzle 官方就把自己定位成既有 **relational API** 又有 **SQL-like query API** 的 TypeScript ORM，而且它的迁移工具 `drizzle-kit` 明确支持 **codebase-first** 和 **database-first** 两种方式，并且可以生成 SQL migration files。([Drizzle ORM][1])

---

## 为什么我不优先推荐 Prisma

Prisma 的优点很明显：

* 有单独的 **Prisma schema**
* Prisma Client 的类型体验很好
* Prisma Migrate 会生成带历史的 `.sql` migration files
* 上手很快，做常规 CRUD 很顺手 ([Prisma][2])

但对你这个项目，Prisma 有一个结构性问题：

**它会让你维护两套“模型心智”**：

1. 你的业务对象模型
2. Prisma 自己的 schema DSL

而你现在这个系统的难点，本来就不是“把表映射出来”，而是：

* 把 `WorkItem / Spec / Plan / ExecutionPackage / ReviewPacket / Release / Incident`
* 再加上 `revision / dependency / event / decision / artifact`
* 做成一套长期可演进的 Postgres 结构

这种情况下，我更倾向于让 schema **尽量贴近 TypeScript 和 SQL 本身**，少一层额外抽象。

---

## 为什么 Drizzle 更贴你这个系统

### 1. 你的 schema 很“工程系统”，不是普通业务 CRUD

你这里不是简单的：

* user
* post
* comment

而是很多这种对象：

* `plan_revisions`
* `execution_package_dependencies`
* `status_histories`
* `incident_links`
* `release_execution_packages`

这类表的特点是：

* 关系多
* 约束多
* 查询和索引设计重要
* 很多地方要“像 SQL 一样思考”

Drizzle 官方就强调它同时提供 **relational** 和 **SQL-like** 的查询方式。对这类系统，这通常比“更高抽象的 ORM 心智”更舒服。([Drizzle ORM][1])

### 2. 你后面一定会写不少偏 SQL 的查询

比如：

* Work Item cockpit 聚合查询
* release 风险汇总
* replay timeline
* incident root-cause drill-down
* phase / gate / resolution 的统计
* 各类 join + group by + window-like 分析

这类查询，长期几乎不可能完全靠高层 ORM 风格优雅解决。
Drizzle 更适合“ORM 不够时，直接下探 SQL 风格继续写”。

### 3. 你已经决定后端主栈是 TypeScript

Drizzle 的 schema 本身就在 TypeScript 里。
这点对你很重要，因为你前面已经在往：

* NestJS
* DTO
* domain enums
* RunSpec contracts
* state machine enums

这条路走了。

Drizzle 会让“数据库 schema”和“应用层类型系统”更贴近，而 Prisma 会再引入一层独立 schema 语言。

### 4. 你这个项目会频繁调 schema

你现在还在讨论对象模型、基数关系、状态字段。
这意味着未来几个月 schema 会一直变。

Drizzle 的迁移工具 `drizzle-kit` 官方写得很明确：它既支持 **push schema**，也支持 **generate SQL migration files**，还支持 **pull from database**，并且适配 codebase-first / database-first 两种工作流。对你这种还在快速演进模型的系统，很合适。([Drizzle ORM][3])

---

## Prisma 更适合什么场景

如果你现在做的是这类项目，我会更偏向 Prisma：

* 典型 SaaS CRUD 系统
* 数据模型比较规整
* 团队 SQL 能力一般
* 想尽快把 admin / dashboard / 基本业务跑起来
* 对复杂 SQL 控制要求没那么强

因为 Prisma 官方的核心价值主张就是：

* Prisma schema
* type-safe Prisma Client
* developer-friendly workflows
* migrations/introspection 比较顺手 ([Prisma][4])

但你的项目不是这个画像。

---

## 我对你这个项目的最终判断

### 如果你要“最快有一个 demo”

Prisma 可能会让前两周更轻松。

### 如果你要“长期做成研发执行系统”

**Drizzle 更稳。**

因为你这个产品长期更像一个：

* 研发控制面
* 工作流系统
* 执行编排系统
* 审计/回放系统

而不是一个“关系简单的业务后台”。

这类系统越往后，越依赖：

* 清晰的 SQL 心智
* 精确的 migration 控制
* 复杂查询和索引设计
* 尽量少的抽象泄漏

所以长期看，我会选 **Drizzle**。

---

## 我的落地建议

### 现在就这么定

* **NestJS**
* **PostgreSQL**
* **Drizzle**
* **drizzle-kit migrations**
* 复杂查询直接保留 SQL 风格能力
* Temporal workflow 继续走 TypeScript

### 一个很实用的原则

* **简单 CRUD / 单表关系查询**：正常用 Drizzle
* **复杂 cockpit / replay / metrics 查询**：直接写更贴 SQL 的查询，不要强行 ORM 化
* **迁移**：始终保留 SQL migration 文件作为事实基线

---

## 一句话版

**Prisma 更适合“通用 TypeScript CRUD 产品”，Drizzle 更适合“Postgres 中心、关系复杂、需要长期精细控制 SQL 和迁移”的系统。你这个项目明显是后者，所以我建议选 Drizzle。** ([Drizzle ORM][1])

下一步我可以直接给你一版 **基于 Drizzle 的 schema 组织方式和目录结构**。

[1]: https://orm.drizzle.team/docs/overview?utm_source=chatgpt.com "Drizzle ORM - Why Drizzle?"
[2]: https://www.prisma.io/docs/orm/prisma-schema/overview?utm_source=chatgpt.com "Overview of Prisma Schema"
[3]: https://orm.drizzle.team/docs/migrations?utm_source=chatgpt.com "Migrations - Drizzle ORM"
[4]: https://www.prisma.io/docs/orm?utm_source=chatgpt.com "What is Prisma ORM? (Overview)"

