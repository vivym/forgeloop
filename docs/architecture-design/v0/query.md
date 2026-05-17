> Superseded historical migration note: this document mentions the old subsystem name for audit history only. Current commands, routes, files, and product docs use delivery terminology.

好，继续。下面我把两块直接补上：

1. **`release-cockpit-queries.ts`**
2. **NestJS 里如何接这些 query functions**

这样你就从“只有 schema”走到了“读模型 + API 落地”。

这两块正好对应你 PRD 里对 **Release & Risk Radar**、**Role-based Workbench**、**Process Replay** 的要求：Release 需要聚合变更、测试证据、灰度与回滚信息；系统也需要对象视图、角色视图和流程视图。

---

# 1. `release-cockpit-queries.ts`

Release cockpit 最常见的页面需求通常是一次拿到：

* Release 基本信息
* 关联 Work Items
* 关联 Execution Packages
* 每个 Package 的 latest run / latest review
* Release evidences
* 关联 Incident
* 汇总统计

我仍然建议你用“多查询拼装”的方式，而不是一条超长 SQL。

```ts id="s0i4it"
// packages/db/src/queries/release-cockpit-queries.ts
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../client';
import {
  releases,
  releaseWorkItems,
  releaseExecutionPackages,
  releaseEvidences,
  workItems,
  executionPackages,
  runSessions,
  reviewPackets,
  incidents,
  incidentLinks,
} from '../schema';

export async function getReleaseCockpit(releaseId: string) {
  const release = await db.query.releases.findFirst({
    where: eq(releases.id, releaseId),
  });

  if (!release) return null;

  const [workItemLinks, packageLinks, evidences, incidentRelated] =
    await Promise.all([
      db
        .select({
          releaseId: releaseWorkItems.releaseId,
          workItemId: releaseWorkItems.workItemId,
          workItem: workItems,
        })
        .from(releaseWorkItems)
        .innerJoin(workItems, eq(releaseWorkItems.workItemId, workItems.id))
        .where(eq(releaseWorkItems.releaseId, releaseId)),

      db
        .select({
          releaseId: releaseExecutionPackages.releaseId,
          packageId: releaseExecutionPackages.packageId,
          executionPackage: executionPackages,
        })
        .from(releaseExecutionPackages)
        .innerJoin(
          executionPackages,
          eq(releaseExecutionPackages.packageId, executionPackages.id),
        )
        .where(eq(releaseExecutionPackages.releaseId, releaseId)),

      db.query.releaseEvidences.findMany({
        where: eq(releaseEvidences.releaseId, releaseId),
        orderBy: [desc(releaseEvidences.createdAt)],
      }),

      db
        .select({
          incidentLink: incidentLinks,
          incident: incidents,
        })
        .from(incidentLinks)
        .innerJoin(incidents, eq(incidentLinks.incidentId, incidents.id))
        .where(
          and(
            eq(incidentLinks.objectType, 'release'),
            eq(incidentLinks.objectId, releaseId),
          ),
        ),
    ]);

  const packages = packageLinks.map((x) => x.executionPackage);
  const packageIds = packages.map((p) => p.id);

  const [latestRunsRaw, latestReviewPacketsRaw] = await Promise.all([
    packageIds.length > 0
      ? db
          .select()
          .from(runSessions)
          .where(inArray(runSessions.packageId, packageIds))
          .orderBy(desc(runSessions.createdAt))
      : [],
    packageIds.length > 0
      ? db
          .select()
          .from(reviewPackets)
          .where(inArray(reviewPackets.packageId, packageIds))
          .orderBy(desc(reviewPackets.createdAt))
      : [],
  ]);

  const latestRunByPackage = new Map<string, (typeof latestRunsRaw)[number]>();
  for (const run of latestRunsRaw) {
    if (!latestRunByPackage.has(run.packageId)) {
      latestRunByPackage.set(run.packageId, run);
    }
  }

  const latestReviewByPackage = new Map<
    string,
    (typeof latestReviewPacketsRaw)[number]
  >();
  for (const rp of latestReviewPacketsRaw) {
    if (!latestReviewByPackage.has(rp.packageId)) {
      latestReviewByPackage.set(rp.packageId, rp);
    }
  }

  const packagesWithLatest = packages.map((pkg) => ({
    ...pkg,
    latestRun: latestRunByPackage.get(pkg.id) ?? null,
    latestReviewPacket: latestReviewByPackage.get(pkg.id) ?? null,
  }));

  const summary = {
    workItemCount: workItemLinks.length,
    packageCount: packages.length,
    evidenceCount: evidences.length,
    incidentCount: incidentRelated.length,
    packageStats: {
      byPhase: aggregateBy(packages, 'phase'),
      byGateState: aggregateBy(packages, 'gateState'),
      bySurfaceType: aggregateBy(packages, 'surfaceType'),
    },
  };

  return {
    release,
    workItems: workItemLinks.map((x) => x.workItem),
    executionPackages: packagesWithLatest,
    evidences,
    incidents: incidentRelated.map((x) => x.incident),
    summary,
  };
}

function aggregateBy<T extends Record<string, any>, K extends keyof T>(
  items: T[],
  key: K,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const value = String(item[key] ?? 'unknown');
    result[value] = (result[value] ?? 0) + 1;
  }
  return result;
}
```

---

# 2. 推荐的 query 目录总览

到现在建议至少长这样：

```text id="b0mj7d"
packages/db/src/queries/
  work-item-cockpit-queries.ts
  release-cockpit-queries.ts
  replay-queries.ts
  incident-replay-queries.ts
```

如果后面还会做 Manager dashboard，再加：

```text id="l6j7oq"
  manager-dashboard-queries.ts
```

---

# 3. NestJS 里怎么接这些 query functions

这里我建议一个很明确的分层：

* `packages/db/src/queries/*`
  负责 **数据库聚合查询**
* NestJS 的 `QueryService`
  负责 **调用 query function + 做少量 API 组装**
* Controller
  只做 HTTP 边界

不要把复杂 Drizzle query 直接写在 controller 里。

---

# 4. 建一个专门的 Query 模块

我建议在控制面 API 里单独建一个：

```text id="41u0k1"
apps/control-plane-api/src/modules/query/
  query.module.ts
  query.controller.ts
  query.service.ts
```

它专门承接 cockpit / dashboard / replay 这类聚合读接口。

---

## `query.module.ts`

```ts id="lakcuq"
// apps/control-plane-api/src/modules/query/query.module.ts
import { Module } from '@nestjs/common';
import { QueryController } from './query.controller';
import { QueryService } from './query.service';

@Module({
  controllers: [QueryController],
  providers: [QueryService],
  exports: [QueryService],
})
export class QueryModule {}
```

---

## `query.service.ts`

这里直接调用你在 `packages/db` 里写好的 query functions。

```ts id="qkg3ns"
// apps/control-plane-api/src/modules/query/query.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { getWorkItemCockpit } from '@repo/db/queries/work-item-cockpit-queries';
import { getReleaseCockpit } from '@repo/db/queries/release-cockpit-queries';
import { getObjectReplayTimeline } from '@repo/db/queries/replay-queries';
import { getIncidentReplay } from '@repo/db/queries/incident-replay-queries';

@Injectable()
export class QueryService {
  async getWorkItemCockpit(workItemId: string) {
    const result = await getWorkItemCockpit(workItemId);
    if (!result) throw new NotFoundException('Work item not found');
    return result;
  }

  async getReleaseCockpit(releaseId: string) {
    const result = await getReleaseCockpit(releaseId);
    if (!result) throw new NotFoundException('Release not found');
    return result;
  }

  async getReplay(objectType: string, objectId: string) {
    return getObjectReplayTimeline(
      objectType as
        | 'work_item'
        | 'spec'
        | 'plan'
        | 'execution_package'
        | 'review_packet'
        | 'release'
        | 'incident'
        | 'run_session'
        | 'contract',
      objectId,
    );
  }

  async getIncidentReplay(incidentId: string) {
    const result = await getIncidentReplay(incidentId);
    if (!result) throw new NotFoundException('Incident not found');
    return result;
  }
}
```

---

## `query.controller.ts`

这里就把它们暴露成 REST 查询接口。

```ts id="dcno2p"
// apps/control-plane-api/src/modules/query/query.controller.ts
import { Controller, Get, Param } from '@nestjs/common';
import { QueryService } from './query.service';

@Controller('query')
export class QueryController {
  constructor(private readonly service: QueryService) {}

  @Get('work-item-cockpit/:workItemId')
  getWorkItemCockpit(@Param('workItemId') workItemId: string) {
    return this.service.getWorkItemCockpit(workItemId);
  }

  @Get('release-cockpit/:releaseId')
  getReleaseCockpit(@Param('releaseId') releaseId: string) {
    return this.service.getReleaseCockpit(releaseId);
  }

  @Get('incident-replay/:incidentId')
  getIncidentReplay(@Param('incidentId') incidentId: string) {
    return this.service.getIncidentReplay(incidentId);
  }

  @Get('replay/:objectType/:objectId')
  getReplay(
    @Param('objectType') objectType: string,
    @Param('objectId') objectId: string,
  ) {
    return this.service.getReplay(objectType, objectId);
  }
}
```

---

# 5. 把 QueryModule 接进 AppModule

```ts id="spoe4c"
// apps/control-plane-api/src/app.module.ts
import { Module } from '@nestjs/common';
import { QueryModule } from './modules/query/query.module';
// 其他 import 省略

@Module({
  imports: [
    // ...
    QueryModule,
  ],
})
export class AppModule {}
```

---

# 6. Replay 模块和 Query 模块怎么分

你前面已经有一个 `ReplayModule` 思路。
这里有两种做法：

## 做法 A：保留 ReplayModule，QueryModule 只管 cockpit/dashboard

* `ReplayModule`：只管 replay
* `QueryModule`：只管 cockpit / dashboard

## 做法 B：全部收敛到 QueryModule

* `QueryModule` 管所有聚合读接口
* Replay 只是其中一类

### 我的建议

**现在先选 B**，更简单。
等后面 replay 逻辑复杂起来，再拆出去。

因为现在最重要的是先把：

* Work Item cockpit
* Release cockpit
* Replay timeline

这几种读模型跑起来。

---

# 7. Controller 返回值建议

因为 cockpit/query 接口一般都不是标准 CRUD 返回，所以建议统一一层响应包装。

## 例如

```ts id="l402qs"
// apps/control-plane-api/src/common/http/api-response.ts
export type ApiResponse<T> = {
  data: T;
  meta?: {
    requestId?: string;
  };
};
```

然后 controller 里返回：

```ts id="70fgcz"
return {
  data: await this.service.getReleaseCockpit(releaseId),
};
```

这样前端会更稳定。

---

# 8. 什么时候该上 GraphQL

这一步你现在还**不需要**。

因为你已经有一个很清晰的模式：

* CRUD / command：领域模块 controller
* 聚合读模型：`QueryModule`

这对现在完全够了。

以后如果你发现：

* `QueryModule` 下的接口越来越多
* 前端很想按需选字段
* cockpit 页面字段需求差异非常大

再把 `QueryModule` 升级成：

* `REST QueryModule`
* 或 `GraphQL BFF`

都行。

但现在没必要为了“可能更灵活”而提前上 GraphQL。

---

# 9. 你现在最适合的最终目录

到这一步，控制面 API 比较完整的形态会是：

```text id="49jvqa"
apps/control-plane-api/src/modules/
  projects/
  work-items/
  specs/
  plans/
  execution-packages/
  run-sessions/
  review-packets/
  releases/
  incidents/
  contracts/
  query/
  health/
  auth/
```

其中：

* 前 10 个是领域对象模块
* `query/` 是聚合读模型模块
* `health/auth` 是基础模块

这是一种很稳的长期形态。

---

# 10. 你现在已经有的完整链路

如果把我们前面所有东西串起来，你现在已经有了一套完整的“可开工蓝图”：

## 数据层

* Drizzle schema
* 分域 tables / relations
* query functions

## API 层

* NestJS 模块结构
* 领域 controller / service skeleton
* QueryModule 聚合读接口

## workflow 层

* Temporal workflow skeleton

## 执行层

* Executor Gateway skeleton
* Codex RunSpec contract

这已经足够支撑你们开始真正做 P0/P1 了。

---

# 11. 我最建议你下一步做什么

不要再继续扩更多 schema 了。
现在最值得做的，是把下面三件事真正落地：

## 第一件

把这些 Drizzle schema 跑通第一版 migration

## 第二件

把 `work-items/specs/plans/execution-packages/query` 这几个模块先真写出来

## 第三件

把 `package_execution_workflow + executor-gateway + codex` 串一条真链路

这三件事做完，系统就不再只是“设计”。

---

## 一句话总结

现在你已经有了：

**定义对象 schema + 执行对象 schema + 审查/交付/事故 schema + cockpit/replay 查询 + NestJS 接入方式**

也就是说，这套方案已经从“架构讨论”进入了“可以分工开工”的状态。
下一步最该进入的是 **migration 验证、第一批模块编码、第一条真实执行链路打通**。

如果你愿意，我下一步可以直接给你一版 **P0/P1 的任务拆分清单（按人天/模块拆）**。
