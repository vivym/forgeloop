可以。下面给你一版**适合你这个系统的 Drizzle 组织方案**。
核心思路是：

**按领域拆 schema 文件，按“表定义 / relations / 查询 / 迁移”分层，始终把 TypeScript schema 当 source of truth，用 `drizzle-kit generate + migrate` 做正式迁移。** 这是 Drizzle 官方明确支持的工作流：schema 可以写在一个文件里，也可以拆成一个目录递归读取；Drizzle schema 是 queries 和 migrations 的事实来源；`drizzle-kit` 支持 codebase-first，并能生成 SQL migration files。 ([Drizzle ORM][1])

# 1. 我建议的最终选择

## 结论

你这个项目用 **Drizzle + SQL migrations** 最合适。
不要走“只有 push、没有 migration 文件”的路线；`push` 官方更偏向快速原型，而 `generate`/`migrate` 更适合作为正式团队开发流程。 ([Drizzle ORM][2])

所以我建议：

* **开发初期本地试验**：可以偶尔 `push`
* **团队正式环境**：一律 `generate` 出 SQL migration，再 `migrate`

---

# 2. 推荐目录结构

我建议你把 Drizzle 放到 monorepo 里的一个独立包，别散在业务模块里。

```text id="ja1i16"
packages/
  db/
    src/
      index.ts
      client.ts
      schema/
        _shared/
          columns.ts
          enums.ts
          base.ts
        project/
          tables.ts
          relations.ts
        work-item/
          tables.ts
          relations.ts
        spec/
          tables.ts
          relations.ts
        plan/
          tables.ts
          relations.ts
        execution-package/
          tables.ts
          relations.ts
        review/
          tables.ts
          relations.ts
        release/
          tables.ts
          relations.ts
        incident/
          tables.ts
          relations.ts
        contract/
          tables.ts
          relations.ts
        audit/
          tables.ts
          relations.ts
        index.ts
      queries/
        work-item-queries.ts
        release-queries.ts
        replay-queries.ts
      migrations/
      seeds/
        seed-dev.ts
    drizzle.config.ts
```

为什么这样拆：

* `schema/` 只放表和 relations
* `queries/` 专门放复杂查询
* `migrations/` 放生成出来的 SQL
* `seeds/` 放开发测试数据
* `_shared/` 放通用 enum / base columns / timestamp columns

Drizzle 官方明确说 schema 可以是一份 `schema.ts`，也可以是一个目录递归读取；对你这种表很多、关系复杂的系统，目录拆分更合适。 ([Drizzle ORM][1])

---

# 3. schema 组织原则

## 原则一：按领域拆，不按技术层拆

不要做成：

* `tables.ts`
* `relations.ts`
* `tables2.ts`

这样几个月后会很难维护。

要按对象域拆：

* `work-item`
* `spec`
* `plan`
* `execution-package`
* `release`
* `incident`
* `audit`

这会和你前面已经定下来的 NestJS 模块边界保持一致。

## 原则二：每个领域最多两个文件

每个领域先保持：

* `tables.ts`
* `relations.ts`

这样最稳。
只有当查询非常复杂时，再单独加 `queries.ts`。

## 原则三：所有 schema 最后统一 export

Drizzle 官方明确要求：如果你用 Drizzle-Kit 做 migration，schema 文件里定义的模型要导出出来，让 Drizzle-Kit 能在 diff 时导入并读取它们。 ([Drizzle ORM][1])

---

# 4. `drizzle.config.ts` 怎么配

我建议直接让 config 指向整个 `schema/` 目录，而不是某一个大文件。

```ts id="ugdz7i"
// packages/db/drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema',
  out: './src/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
```

Drizzle 官方文档明确说：当你把 schema 放在目录里时，可以把 `schema` 指向该目录，Drizzle 会递归读取其中的文件并找到 drizzle tables。 ([Drizzle ORM][1])

---

# 5. `schema/index.ts` 的写法

这里不要写业务逻辑，只做导出聚合。

```ts id="mme7gu"
// packages/db/src/schema/index.ts
export * from './_shared/enums';
export * from './project/tables';
export * from './project/relations';

export * from './work-item/tables';
export * from './work-item/relations';

export * from './spec/tables';
export * from './spec/relations';

export * from './plan/tables';
export * from './plan/relations';

export * from './execution-package/tables';
export * from './execution-package/relations';

export * from './review/tables';
export * from './review/relations';

export * from './release/tables';
export * from './release/relations';

export * from './incident/tables';
export * from './incident/relations';

export * from './contract/tables';
export * from './contract/relations';

export * from './audit/tables';
export * from './audit/relations';
```

这样做的好处是：

* Drizzle-Kit 能清楚读到全部模型
* 你以后拆包或移动文件不会影响外部导入
* `client.ts` 和 query 层只需要从一个出口拿 schema

---

# 6. 推荐的 `_shared` 设计

你这个系统状态枚举很多，所以 `_shared` 非常关键。

## `_shared/enums.ts`

放：

* work item phase / gate / resolution
* package phase / activity / gate / readiness
* doc status / gate
* release / incident / contract enums

## `_shared/base.ts`

放：

* `id`
* `orgId`
* `projectId`
* `key`
* `title`
* `description`
* `createdAt / updatedAt`
* `createdByActorId / updatedByActorId`
* `archivedAt / deletedAt`

## `_shared/columns.ts`

放：

* `timestamps()`
* `visibility()`
* `labels()`
* `jsonbExtra()`

这样以后每个表定义会更干净。

---

# 7. 表定义和 relations 的建议写法

## `tables.ts`

只定义表、列、索引、唯一约束。

## `relations.ts`

只定义 Drizzle relations，不要混着写查询。

这样你看一个领域时会很清楚：

* `tables.ts` 看数据库结构
* `relations.ts` 看对象关系

Drizzle 官方文档把 schema declaration 和 relations 都当成独立文档主题来讲，这种分离也更符合它本身的思路。 ([Drizzle ORM][1])

---

# 8. 复杂查询应该放哪

不要把复杂查询塞进 Nest service，也不要把所有 SQL 都写在 controller 附近。

我建议在 `packages/db/src/queries/` 下单独放：

```text id="walekw"
queries/
  work-item-queries.ts
  package-queries.ts
  release-queries.ts
  replay-queries.ts
  manager-dashboard-queries.ts
```

因为你这个系统后面一定会有很多：

* cockpit 聚合
* replay timeline
* release 风险汇总
* manager dashboard

这些查询本来就不是单表 CRUD。
Drizzle 的优势之一正是既有 relational API，也有 SQL-like query API，所以把复杂查询集中管理会很自然。 ([Drizzle ORM][3])

---

# 9. migration 策略

我建议你直接定一条团队规范：

## 正式规范

* 改 schema
* 跑 `drizzle-kit generate`
* 提交生成出来的 SQL migration
* CI / deploy 跑 `drizzle-kit migrate`

Drizzle 官方明确把这条路作为 codebase-first 的正式路径：TypeScript schema 作为 source of truth，`generate` 负责根据 diff 生成 SQL migration files，`migrate` 负责应用到数据库。 ([Drizzle ORM][2])

## 不建议的长期方式

不要长期依赖：

* 只 `push`
* 不保留 migration SQL 文件

官方虽然说 `push` 适合快速原型，甚至有团队把它作为主要流，但对你这种复杂对象系统，我还是建议保留正式 SQL migration 历史。 ([Drizzle ORM][2])

---

# 10. 你的项目最适合的 migration 习惯

因为你这里有很多 revision 表、history 表、link 表，我建议：

## 每次 migration 只做一类事情

例如：

* `add_plan_revision_tables`
* `introduce_release_evidences`
* `split_work_item_phase_and_gate_state`

不要一口气混 10 个不相关改动。

## 大改结构时优先手查 SQL

Drizzle 可以生成 SQL migration files，这很好；但像你这种复杂 schema，生成后最好人工 review 一遍。官方文档里也提到 diff 时会提示 rename 等情况。 ([Drizzle ORM][2])

---

# 11. 推荐的 client 组织

```ts id="52joeh"
// packages/db/src/client.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
```

```ts id="t75818"
// packages/db/src/index.ts
export { db } from './client';
export * as schema from './schema';
export * from './queries/work-item-queries';
export * from './queries/release-queries';
export * from './queries/replay-queries';
```

这样控制面 API、workflow worker、executor gateway 都可以共享一套 schema 和 query 层。

---

# 12. 对你这套系统最适合的 schema 划分

按你前面定下来的实体设计，我建议最终就是这几个域：

## `project`

* organizations / actors / projects

## `work-item`

* work_items

## `spec`

* specs
* spec_revisions

## `plan`

* plans
* plan_revisions

## `execution-package`

* execution_packages
* execution_package_dependencies
* run_sessions

## `review`

* review_packets
* test_evidences

## `release`

* releases
* release_work_items
* release_execution_packages
* release_evidences

## `incident`

* incidents
* incident_links

## `contract`

* contracts
* contract_revisions
* package_contract_links

## `audit`

* artifacts
* object_events
* status_histories
* decisions

这和你现在的对象边界是完全一致的，也最适合按目录做 Drizzle schema。

---

# 13. 最终推荐的团队规范

我建议你们直接把这几个约定写进 README：

## 约定一

**所有表都在 `packages/db/src/schema/**/tables.ts` 定义**

## 约定二

**所有关系都在 `relations.ts` 定义**

## 约定三

**所有复杂读查询都放在 `queries/`**

## 约定四

**正式环境不直接 `push`，统一 `generate + migrate`**

## 约定五

**每个 migration PR 必须 review 生成的 SQL**

---

# 14. 一句话版

**对你这个系统，最好的 Drizzle 组织方式不是“一个 schema.ts 全塞完”，而是“按领域拆 schema 目录、统一导出模型、复杂查询独立管理、正式环境坚持 SQL migration 文件化”。** 这正是 Drizzle 官方支持的用法：schema 可以拆目录递归读取，TypeScript schema 作为 source of truth，`drizzle-kit generate/migrate` 负责正式迁移。 ([Drizzle ORM][1])

下一步我可以直接给你一版 **基于这套目录结构的 Drizzle schema 示例代码**，先把 `work_items / specs / plans / execution_packages` 四个核心域写出来。

[1]: https://orm.drizzle.team/docs/sql-schema-declaration "Drizzle ORM - Schema"
[2]: https://orm.drizzle.team/docs/migrations "Drizzle ORM - Migrations"
[3]: https://orm.drizzle.team/docs/overview "Drizzle ORM - Why Drizzle?"

可以。下面我直接给你一版 **Drizzle schema 示例代码**，优先覆盖四个核心域：

* `work_items`
* `specs / spec_revisions`
* `plans / plan_revisions`
* `execution_packages`

我按 Drizzle 官方推荐的 **TypeScript schema**、**按目录拆 schema**、**用 `drizzle-kit generate/migrate` 管 SQL migration** 的思路来写。Drizzle 官方文档明确支持把 schema 放在单文件或目录中递归读取，也支持 `generate / migrate / push / pull` 这几种迁移工作流。([Drizzle ORM][1])

---

## 1. `drizzle.config.ts`

```ts
// packages/db/drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema',
  out: './src/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
```

这里把 `schema` 指到整个目录，让 Drizzle 递归读取。([Drizzle ORM][1])

---

## 2. `_shared/enums.ts`

先把高频 enum 集中起来，后面所有表共用。

```ts
// packages/db/src/schema/_shared/enums.ts
import { pgEnum } from 'drizzle-orm/pg-core';

export const visibilityEnum = pgEnum('visibility_t', [
  'private',
  'project',
  'org',
]);

export const actorTypeEnum = pgEnum('actor_type_t', [
  'human',
  'ai',
  'system',
]);

export const projectKindEnum = pgEnum('project_kind_t', [
  'project',
  'stream',
]);

export const projectStatusEnum = pgEnum('project_status_t', [
  'active',
  'paused',
  'completed',
  'archived',
]);

export const workflowProfileEnum = pgEnum('workflow_profile_t', [
  'backend_default',
  'bugfix_fastlane',
  'multi_end',
]);

export const workItemKindEnum = pgEnum('work_item_kind_t', [
  'initiative',
  'requirement',
  'bug',
  'tech_debt',
]);

export const priorityEnum = pgEnum('priority_t', ['p0', 'p1', 'p2', 'p3']);

export const riskLevelEnum = pgEnum('risk_level_t', [
  'low',
  'medium',
  'high',
  'critical',
]);

export const workItemPhaseEnum = pgEnum('work_item_phase_t', [
  'draft',
  'triage',
  'spec',
  'plan',
  'execution',
  'release',
  'observing',
  'done',
  'closed',
]);

export const workItemActivityStateEnum = pgEnum('work_item_activity_state_t', [
  'idle',
  'in_progress',
  'awaiting_ai',
  'ai_running',
  'awaiting_human',
  'human_in_progress',
  'blocked',
]);

export const workItemGateStateEnum = pgEnum('work_item_gate_state_t', [
  'none',
  'awaiting_spec_approval',
  'spec_changes_requested',
  'awaiting_plan_approval',
  'plan_changes_requested',
  'awaiting_release_approval',
  'release_changes_requested',
]);

export const workItemResolutionEnum = pgEnum('work_item_resolution_t', [
  'none',
  'completed',
  'cancelled',
  'rejected',
  'duplicate',
  'superseded',
  'won_t_do',
]);

export const docStatusEnum = pgEnum('doc_status_t', [
  'draft',
  'in_review',
  'approved',
  'rejected',
  'superseded',
  'archived',
]);

export const docEditingStateEnum = pgEnum('doc_editing_state_t', [
  'idle',
  'ai_drafting',
  'human_editing',
  'co_editing',
]);

export const docGateStateEnum = pgEnum('doc_gate_state_t', [
  'not_submitted',
  'awaiting_approval',
  'changes_requested',
  'approved',
]);

export const docResolutionEnum = pgEnum('doc_resolution_t', [
  'none',
  'approved',
  'rejected',
  'superseded',
]);

export const surfaceTypeEnum = pgEnum('surface_type_t', [
  'backend',
  'web',
  'ios',
  'android',
  'data',
  'infra',
  'qa',
  'release',
]);

export const packagePhaseEnum = pgEnum('package_phase_t', [
  'draft',
  'ready',
  'queued',
  'execution',
  'review',
  'integration',
  'test_gate',
  'release',
  'archived',
]);

export const packageActivityStateEnum = pgEnum('package_activity_state_t', [
  'idle',
  'ai_running',
  'ai_retrying',
  'human_editing',
  'awaiting_human',
  'human_reviewing',
  'blocked',
  'handover',
]);

export const packageGateStateEnum = pgEnum('package_gate_state_t', [
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
  'released',
]);

export const packageResolutionEnum = pgEnum('package_resolution_t', [
  'none',
  'completed',
  'cancelled',
  'rolled_back',
  'superseded',
]);

export const integrationReadinessEnum = pgEnum('integration_readiness_t', [
  'not_ready',
  'contract_ready',
  'mock_ready',
  'partial_integration_ready',
  'full_integration_ready',
  'ready_for_release',
]);
```

---

## 3. `_shared/base.ts`

把公共列抽出来。
这里我刻意只抽“纯共性”字段，避免过度抽象。

```ts
// packages/db/src/schema/_shared/base.ts
import { sql } from 'drizzle-orm';
import {
  jsonb,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { visibilityEnum } from './enums';

export const idCol = (name = 'id') =>
  uuid(name).defaultRandom().primaryKey();

export const orgIdCol = (name = 'org_id') => uuid(name).notNull();

export const projectIdCol = (name = 'project_id') => uuid(name);

export const keyCol = (name = 'key') => text(name).notNull();

export const titleCol = (name = 'title') => text(name).notNull();

export const descriptionCol = (name = 'description') => text(name);

export const createdAtCol = (name = 'created_at') =>
  timestamp(name, { withTimezone: true }).notNull().defaultNow();

export const updatedAtCol = (name = 'updated_at') =>
  timestamp(name, { withTimezone: true }).notNull().defaultNow();

export const archivedAtCol = (name = 'archived_at') =>
  timestamp(name, { withTimezone: true });

export const deletedAtCol = (name = 'deleted_at') =>
  timestamp(name, { withTimezone: true });

export const createdByActorIdCol = (name = 'created_by_actor_id') =>
  uuid(name).notNull();

export const updatedByActorIdCol = (name = 'updated_by_actor_id') =>
  uuid(name).notNull();

export const visibilityCol = (name = 'visibility') =>
  visibilityEnum(name).notNull().default('project');

export const sourceTypeCol = (name = 'source_type') => text(name);

export const labelsCol = (name = 'labels') =>
  text(name)
    .array()
    .notNull()
    .default(sql`'{}'::text[]`);

export const extraCol = (name = 'extra') => jsonb(name);
```

Drizzle 官方的 PostgreSQL 列类型文档里明确包含 `json/jsonb` 等 PG 类型；数组和索引/约束也都用 `pg-core` 这套 schema API 定义。([Drizzle ORM][2])

---

## 4. `project/tables.ts`

因为后面四个核心域都会引用 `projects`，我先把最小 project 表带上。

```ts
// packages/db/src/schema/project/tables.ts
import { pgTable, text, uniqueIndex, index } from 'drizzle-orm/pg-core';
import {
  archivedAtCol,
  createdAtCol,
  createdByActorIdCol,
  deletedAtCol,
  descriptionCol,
  extraCol,
  idCol,
  keyCol,
  labelsCol,
  orgIdCol,
  sourceTypeCol,
  titleCol,
  updatedAtCol,
  updatedByActorIdCol,
  visibilityCol,
} from '../_shared/base';
import {
  projectKindEnum,
  projectStatusEnum,
  workflowProfileEnum,
} from '../_shared/enums';

export const projects = pgTable(
  'projects',
  {
    id: idCol(),
    orgId: orgIdCol(),
    key: keyCol(),
    code: text('code').notNull(),
    title: titleCol(),
    description: descriptionCol(),

    kind: projectKindEnum('kind').notNull(),
    status: projectStatusEnum('status').notNull().default('active'),
    workflowProfile: workflowProfileEnum('workflow_profile')
      .notNull()
      .default('backend_default'),

    ownerActorId: text('owner_actor_id').notNull(),

    visibility: visibilityCol(),
    sourceType: sourceTypeCol(),
    labels: labelsCol(),
    extra: extraCol(),

    createdAt: createdAtCol(),
    createdByActorId: createdByActorIdCol(),
    updatedAt: updatedAtCol(),
    updatedByActorId: updatedByActorIdCol(),
    archivedAt: archivedAtCol(),
    deletedAt: deletedAtCol(),
  },
  (t) => ({
    uqOrgKey: uniqueIndex('projects_org_key_uq').on(t.orgId, t.key),
    uqOrgCode: uniqueIndex('projects_org_code_uq').on(t.orgId, t.code),
    idxOrgStatus: index('projects_org_status_idx').on(t.orgId, t.status),
  }),
);
```

---

## 5. `work-item/tables.ts`

这里按你前面定的最终实体设计来写：
`phase + activity_state + gate_state + resolution` 分层，不把所有动作都塞进一个 status。

```ts
// packages/db/src/schema/work-item/tables.ts
import {
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  archivedAtCol,
  createdAtCol,
  createdByActorIdCol,
  deletedAtCol,
  descriptionCol,
  extraCol,
  idCol,
  keyCol,
  labelsCol,
  orgIdCol,
  sourceTypeCol,
  titleCol,
  updatedAtCol,
  updatedByActorIdCol,
  visibilityCol,
} from '../_shared/base';
import {
  priorityEnum,
  riskLevelEnum,
  workItemActivityStateEnum,
  workItemGateStateEnum,
  workItemKindEnum,
  workItemPhaseEnum,
  workItemResolutionEnum,
  workflowProfileEnum,
} from '../_shared/enums';

export const workItems = pgTable(
  'work_items',
  {
    id: idCol(),
    orgId: orgIdCol(),
    projectId: uuid('project_id').notNull(),
    key: keyCol(),
    title: titleCol(),
    description: descriptionCol(),

    kind: workItemKindEnum('kind').notNull(),

    phase: workItemPhaseEnum('phase').notNull().default('draft'),
    activityState: workItemActivityStateEnum('activity_state')
      .notNull()
      .default('idle'),
    gateState: workItemGateStateEnum('gate_state').notNull().default('none'),
    resolution: workItemResolutionEnum('resolution')
      .notNull()
      .default('none'),

    ownerActorId: uuid('owner_actor_id').notNull(),
    reporterActorId: uuid('reporter_actor_id'),

    priority: priorityEnum('priority').notNull().default('p2'),
    riskLevel: riskLevelEnum('risk_level').notNull().default('medium'),

    background: text('background'),
    goal: text('goal'),
    successCriteria: jsonb('success_criteria'),
    outOfScope: jsonb('out_of_scope'),

    currentSpecId: uuid('current_spec_id'),
    currentSpecRevisionId: uuid('current_spec_revision_id'),
    currentPlanId: uuid('current_plan_id'),
    currentPlanRevisionId: uuid('current_plan_revision_id'),
    currentReleaseId: uuid('current_release_id'),

    parentWorkItemId: uuid('parent_work_item_id'),
    workflowProfile: workflowProfileEnum('workflow_profile')
      .notNull()
      .default('backend_default'),

    blockedReason: text('blocked_reason'),
    blockedAt: createdAtCol('blocked_at'),
    currentStepStartedAt: createdAtCol('current_step_started_at'),
    lastTransitionAt: createdAtCol('last_transition_at'),

    visibility: visibilityCol(),
    sourceType: sourceTypeCol(),
    labels: labelsCol(),
    extra: extraCol(),

    createdAt: createdAtCol(),
    createdByActorId: createdByActorIdCol(),
    updatedAt: updatedAtCol(),
    updatedByActorId: updatedByActorIdCol(),
    archivedAt: archivedAtCol(),
    deletedAt: deletedAtCol(),
  },
  (t) => ({
    uqOrgKey: uniqueIndex('work_items_org_key_uq').on(t.orgId, t.key),
    idxProjectPhase: index('work_items_project_phase_idx').on(
      t.projectId,
      t.phase,
    ),
    idxOwnerPhase: index('work_items_owner_phase_idx').on(
      t.ownerActorId,
      t.phase,
    ),
    idxPriorityRisk: index('work_items_priority_risk_idx').on(
      t.priority,
      t.riskLevel,
    ),
    idxParent: index('work_items_parent_idx').on(t.parentWorkItemId),
  }),
);
```

---

## 6. `spec/tables.ts`

Spec 拆成逻辑对象 `specs` 和版本对象 `spec_revisions`。

```ts
// packages/db/src/schema/spec/tables.ts
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  archivedAtCol,
  createdAtCol,
  createdByActorIdCol,
  deletedAtCol,
  descriptionCol,
  extraCol,
  idCol,
  keyCol,
  labelsCol,
  orgIdCol,
  sourceTypeCol,
  titleCol,
  updatedAtCol,
  updatedByActorIdCol,
  visibilityCol,
} from '../_shared/base';
import {
  docEditingStateEnum,
  docGateStateEnum,
  docResolutionEnum,
  docStatusEnum,
} from '../_shared/enums';

export const specs = pgTable(
  'specs',
  {
    id: idCol(),
    orgId: orgIdCol(),
    projectId: uuid('project_id').notNull(),
    workItemId: uuid('work_item_id').notNull(),

    key: keyCol(),
    title: titleCol(),
    description: descriptionCol(),

    status: docStatusEnum('status').notNull().default('draft'),
    editingState: docEditingStateEnum('editing_state')
      .notNull()
      .default('idle'),
    gateState: docGateStateEnum('gate_state')
      .notNull()
      .default('not_submitted'),
    resolution: docResolutionEnum('resolution').notNull().default('none'),

    approverActorId: uuid('approver_actor_id'),
    qaOwnerActorId: uuid('qa_owner_actor_id'),

    currentRevisionId: uuid('current_revision_id'),
    approvedRevisionId: uuid('approved_revision_id'),
    approvedAt: createdAtCol('approved_at'),

    visibility: visibilityCol(),
    sourceType: sourceTypeCol(),
    labels: labelsCol(),
    extra: extraCol(),

    createdAt: createdAtCol(),
    createdByActorId: createdByActorIdCol(),
    updatedAt: updatedAtCol(),
    updatedByActorId: updatedByActorIdCol(),
    archivedAt: archivedAtCol(),
    deletedAt: deletedAtCol(),
  },
  (t) => ({
    uqOrgKey: uniqueIndex('specs_org_key_uq').on(t.orgId, t.key),
    idxWorkItem: index('specs_work_item_idx').on(t.workItemId),
    idxProjectStatus: index('specs_project_status_idx').on(
      t.projectId,
      t.status,
    ),
  }),
);

export const specRevisions = pgTable(
  'spec_revisions',
  {
    id: idCol(),
    specId: uuid('spec_id').notNull(),
    revisionNo: integer('revision_no').notNull(),

    draftedByActorId: uuid('drafted_by_actor_id').notNull(),
    createdAt: createdAtCol(),

    summary: text('summary'),
    background: text('background'),

    goals: jsonb('goals'),
    scopeIn: jsonb('scope_in'),
    scopeOut: jsonb('scope_out'),
    userStories: jsonb('user_stories'),
    keyFlows: jsonb('key_flows'),
    interfaceChanges: jsonb('interface_changes'),
    acceptanceCriteria: jsonb('acceptance_criteria'),
    testStrategySummary: jsonb('test_strategy_summary'),
    risks: jsonb('risks'),
    openQuestions: jsonb('open_questions'),

    rawMarkdown: text('raw_markdown'),
    structuredDoc: jsonb('structured_doc'),
  },
  (t) => ({
    uqSpecRevisionNo: uniqueIndex('spec_revisions_spec_revision_no_uq').on(
      t.specId,
      t.revisionNo,
    ),
    idxSpecRevisionDesc: index('spec_revisions_spec_revision_idx').on(
      t.specId,
      t.revisionNo,
    ),
  }),
);
```

---

## 7. `plan/tables.ts`

这里最重要的是：
`plan_revisions` 明确是 Execution Package 的上游，不是 1-to-1。

```ts
// packages/db/src/schema/plan/tables.ts
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  archivedAtCol,
  createdAtCol,
  createdByActorIdCol,
  deletedAtCol,
  descriptionCol,
  extraCol,
  idCol,
  keyCol,
  labelsCol,
  orgIdCol,
  sourceTypeCol,
  titleCol,
  updatedAtCol,
  updatedByActorIdCol,
  visibilityCol,
} from '../_shared/base';
import {
  docEditingStateEnum,
  docGateStateEnum,
  docResolutionEnum,
  docStatusEnum,
} from '../_shared/enums';

export const plans = pgTable(
  'plans',
  {
    id: idCol(),
    orgId: orgIdCol(),
    projectId: uuid('project_id').notNull(),
    workItemId: uuid('work_item_id').notNull(),
    specId: uuid('spec_id').notNull(),

    key: keyCol(),
    title: titleCol(),
    description: descriptionCol(),

    status: docStatusEnum('status').notNull().default('draft'),
    editingState: docEditingStateEnum('editing_state')
      .notNull()
      .default('idle'),
    gateState: docGateStateEnum('gate_state')
      .notNull()
      .default('not_submitted'),
    resolution: docResolutionEnum('resolution').notNull().default('none'),

    reviewerActorId: uuid('reviewer_actor_id'),
    qaOwnerActorId: uuid('qa_owner_actor_id'),

    currentRevisionId: uuid('current_revision_id'),
    approvedRevisionId: uuid('approved_revision_id'),
    approvedAt: createdAtCol('approved_at'),

    visibility: visibilityCol(),
    sourceType: sourceTypeCol(),
    labels: labelsCol(),
    extra: extraCol(),

    createdAt: createdAtCol(),
    createdByActorId: createdByActorIdCol(),
    updatedAt: updatedAtCol(),
    updatedByActorId: updatedByActorIdCol(),
    archivedAt: archivedAtCol(),
    deletedAt: deletedAtCol(),
  },
  (t) => ({
    uqOrgKey: uniqueIndex('plans_org_key_uq').on(t.orgId, t.key),
    idxWorkItem: index('plans_work_item_idx').on(t.workItemId),
    idxSpec: index('plans_spec_idx').on(t.specId),
  }),
);

export const planRevisions = pgTable(
  'plan_revisions',
  {
    id: idCol(),
    planId: uuid('plan_id').notNull(),
    basedOnSpecRevisionId: uuid('based_on_spec_revision_id').notNull(),

    revisionNo: integer('revision_no').notNull(),
    draftedByActorId: uuid('drafted_by_actor_id').notNull(),
    createdAt: createdAtCol(),

    implementationSummary: text('implementation_summary'),
    splitStrategy: jsonb('split_strategy'),
    dependencyOrder: jsonb('dependency_order'),
    testMatrix: jsonb('test_matrix'),
    releaseStrategy: jsonb('release_strategy'),
    rollbackPlan: jsonb('rollback_plan'),
    qaRecommendations: jsonb('qa_recommendations'),
    reviewerRecommendations: jsonb('reviewer_recommendations'),
    riskMitigations: jsonb('risk_mitigations'),

    rawMarkdown: text('raw_markdown'),
    structuredDoc: jsonb('structured_doc'),
  },
  (t) => ({
    uqPlanRevisionNo: uniqueIndex('plan_revisions_plan_revision_no_uq').on(
      t.planId,
      t.revisionNo,
    ),
    idxPlanRevisionDesc: index('plan_revisions_plan_revision_idx').on(
      t.planId,
      t.revisionNo,
    ),
    idxSpecRevision: index('plan_revisions_spec_revision_idx').on(
      t.basedOnSpecRevisionId,
    ),
  }),
);
```

---

## 8. `execution-package/tables.ts`

这是最关键的一张表。
它要冻结到 `spec_revision_id` 和 `plan_revision_id`，并且 `planRevision -> packages` 是 1-to-N。

```ts
// packages/db/src/schema/execution-package/tables.ts
import {
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  archivedAtCol,
  createdAtCol,
  createdByActorIdCol,
  deletedAtCol,
  descriptionCol,
  extraCol,
  idCol,
  keyCol,
  labelsCol,
  orgIdCol,
  sourceTypeCol,
  titleCol,
  updatedAtCol,
  updatedByActorIdCol,
  visibilityCol,
} from '../_shared/base';
import {
  integrationReadinessEnum,
  packageActivityStateEnum,
  packageGateStateEnum,
  packagePhaseEnum,
  packageResolutionEnum,
  riskLevelEnum,
  surfaceTypeEnum,
} from '../_shared/enums';

export const executionPackages = pgTable(
  'execution_packages',
  {
    id: idCol(),
    orgId: orgIdCol(),
    projectId: uuid('project_id').notNull(),
    workItemId: uuid('work_item_id').notNull(),

    specId: uuid('spec_id').notNull(),
    specRevisionId: uuid('spec_revision_id').notNull(),

    planId: uuid('plan_id').notNull(),
    planRevisionId: uuid('plan_revision_id').notNull(),

    key: keyCol(),
    title: titleCol(),
    description: descriptionCol(),

    phase: packagePhaseEnum('phase').notNull().default('draft'),
    activityState: packageActivityStateEnum('activity_state')
      .notNull()
      .default('idle'),
    gateState: packageGateStateEnum('gate_state')
      .notNull()
      .default('not_submitted'),
    resolution: packageResolutionEnum('resolution')
      .notNull()
      .default('none'),

    executionOwnerActorId: uuid('execution_owner_actor_id').notNull(),
    reviewerActorId: uuid('reviewer_actor_id'),
    qaOwnerActorId: uuid('qa_owner_actor_id'),

    surfaceType: surfaceTypeEnum('surface_type').notNull(),
    repoId: text('repo_id').notNull(),
    deployUnit: text('deploy_unit'),
    baseBranch: text('base_branch'),
    baseCommitSha: text('base_commit_sha'),

    objective: text('objective').notNull(),
    nonGoals: jsonb('non_goals'),

    allowedPaths: text('allowed_paths')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    forbiddenPaths: text('forbidden_paths')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    moduleBoundaries: jsonb('module_boundaries'),

    requiredChecks: text('required_checks')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    requiredTestGates: text('required_test_gates')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    regressionScope: jsonb('regression_scope'),

    integrationPrerequisites: jsonb('integration_prerequisites'),
    environmentRequirements: jsonb('environment_requirements'),
    integrationReadiness: integrationReadinessEnum('integration_readiness')
      .notNull()
      .default('not_ready'),

    riskLevel: riskLevelEnum('risk_level').notNull().default('medium'),
    riskNotes: jsonb('risk_notes'),
    definitionOfDone: jsonb('definition_of_done'),

    currentRunSessionId: uuid('current_run_session_id'),
    currentReviewPacketId: uuid('current_review_packet_id'),
    currentReleaseId: uuid('current_release_id'),

    manualOverrideEnabled: text('manual_override_enabled')
      .notNull()
      .default('true'),

    originPackageId: uuid('origin_package_id'),
    supersededByPackageId: uuid('superseded_by_package_id'),

    retryCount: text('retry_count').notNull().default('0'),
    blockedReason: text('blocked_reason'),
    blockedAt: createdAtCol('blocked_at'),
    lastTransitionAt: createdAtCol('last_transition_at'),

    visibility: visibilityCol(),
    sourceType: sourceTypeCol(),
    labels: labelsCol(),
    extra: extraCol(),

    createdAt: createdAtCol(),
    createdByActorId: createdByActorIdCol(),
    updatedAt: updatedAtCol(),
    updatedByActorId: updatedByActorIdCol(),
    archivedAt: archivedAtCol(),
    deletedAt: deletedAtCol(),
  },
  (t) => ({
    uqOrgKey: uniqueIndex('execution_packages_org_key_uq').on(t.orgId, t.key),
    idxWorkItem: index('execution_packages_work_item_idx').on(t.workItemId),
    idxPlanRevision: index('execution_packages_plan_revision_idx').on(
      t.planRevisionId,
    ),
    idxSpecRevision: index('execution_packages_spec_revision_idx').on(
      t.specRevisionId,
    ),
    idxProjectPhase: index('execution_packages_project_phase_idx').on(
      t.projectId,
      t.phase,
    ),
    idxOwnerPhase: index('execution_packages_owner_phase_idx').on(
      t.executionOwnerActorId,
      t.phase,
    ),
    idxSurfaceRepo: index('execution_packages_surface_repo_idx').on(
      t.surfaceType,
      t.repoId,
    ),
  }),
);
```

### 两个小建议

这里我为了简洁，把 `manual_override_enabled` 和 `retry_count` 先写成 `text` 默认值了。
你正式落库时建议改成：

* `boolean('manual_override_enabled').notNull().default(true)`
* `integer('retry_count').notNull().default(0)`

---

## 9. `relations.ts`

先给这四个核心域的关系示例。
Drizzle 的关系定义适合放到独立文件里，便于控制表定义和对象关系分离。([Drizzle ORM][1])

### `work-item/relations.ts`

```ts
// packages/db/src/schema/work-item/relations.ts
import { relations } from 'drizzle-orm';
import { workItems } from './tables';
import { specs } from '../spec/tables';
import { plans } from '../plan/tables';
import { executionPackages } from '../execution-package/tables';
import { projects } from '../project/tables';

export const workItemsRelations = relations(workItems, ({ one, many }) => ({
  project: one(projects, {
    fields: [workItems.projectId],
    references: [projects.id],
  }),
  specs: many(specs),
  plans: many(plans),
  executionPackages: many(executionPackages),
}));
```

### `spec/relations.ts`

```ts
// packages/db/src/schema/spec/relations.ts
import { relations } from 'drizzle-orm';
import { specs, specRevisions } from './tables';
import { workItems } from '../work-item/tables';

export const specsRelations = relations(specs, ({ one, many }) => ({
  workItem: one(workItems, {
    fields: [specs.workItemId],
    references: [workItems.id],
  }),
  revisions: many(specRevisions),
}));

export const specRevisionsRelations = relations(specRevisions, ({ one }) => ({
  spec: one(specs, {
    fields: [specRevisions.specId],
    references: [specs.id],
  }),
}));
```

### `plan/relations.ts`

```ts
// packages/db/src/schema/plan/relations.ts
import { relations } from 'drizzle-orm';
import { plans, planRevisions } from './tables';
import { workItems } from '../work-item/tables';
import { specs, specRevisions } from '../spec/tables';
import { executionPackages } from '../execution-package/tables';

export const plansRelations = relations(plans, ({ one, many }) => ({
  workItem: one(workItems, {
    fields: [plans.workItemId],
    references: [workItems.id],
  }),
  spec: one(specs, {
    fields: [plans.specId],
    references: [specs.id],
  }),
  revisions: many(planRevisions),
}));

export const planRevisionsRelations = relations(planRevisions, ({ one, many }) => ({
  plan: one(plans, {
    fields: [planRevisions.planId],
    references: [plans.id],
  }),
  basedOnSpecRevision: one(specRevisions, {
    fields: [planRevisions.basedOnSpecRevisionId],
    references: [specRevisions.id],
  }),
  executionPackages: many(executionPackages),
}));
```

### `execution-package/relations.ts`

```ts
// packages/db/src/schema/execution-package/relations.ts
import { relations } from 'drizzle-orm';
import { executionPackages } from './tables';
import { workItems } from '../work-item/tables';
import { specs, specRevisions } from '../spec/tables';
import { plans, planRevisions } from '../plan/tables';

export const executionPackagesRelations = relations(executionPackages, ({ one }) => ({
  workItem: one(workItems, {
    fields: [executionPackages.workItemId],
    references: [workItems.id],
  }),
  spec: one(specs, {
    fields: [executionPackages.specId],
    references: [specs.id],
  }),
  specRevision: one(specRevisions, {
    fields: [executionPackages.specRevisionId],
    references: [specRevisions.id],
  }),
  plan: one(plans, {
    fields: [executionPackages.planId],
    references: [plans.id],
  }),
  planRevision: one(planRevisions, {
    fields: [executionPackages.planRevisionId],
    references: [planRevisions.id],
  }),
}));
```

这里最关键的一条关系就是：

* `planRevision -> executionPackages = many`

也就是我们前面反复确认过的：
**PlanRevision 1-to-N ExecutionPackages**，不是 1-to-1。

---

## 10. `schema/index.ts`

```ts
// packages/db/src/schema/index.ts
export * from './_shared/enums';

export * from './project/tables';
export * from './project/relations';

export * from './work-item/tables';
export * from './work-item/relations';

export * from './spec/tables';
export * from './spec/relations';

export * from './plan/tables';
export * from './plan/relations';

export * from './execution-package/tables';
export * from './execution-package/relations';
```

Drizzle-Kit 需要能读到导出的 schema 定义，统一出口最省心。([Drizzle ORM][1])

---

## 11. `client.ts`

Drizzle 官方对 PostgreSQL 明确支持 `node-postgres` 和 `postgres.js` 驱动。这里先用 `node-postgres`。([Drizzle ORM][3])

```ts
// packages/db/src/client.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
```

---

## 12. 推荐的命令

正式开发环境，我建议你们走这条：

```bash
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

而不是长期只 `push`。
Drizzle 官方明确把 `generate / migrate / push / pull` 都作为可选工作流，但团队化开发很适合保留 SQL migration files。([Drizzle ORM][4])

---

## 13. 你下一步最应该补的两个域

在这四个核心域之后，最值得马上补的是：

### `review`

* `review_packets`
* `test_evidences`

### `audit`

* `artifacts`
* `object_events`
* `status_histories`
* `decisions`

因为你这个系统一旦要真实跑起来，马上就会依赖：

* Review Packet
* 事件回放
* 状态历史
* artifact 证据链

---

## 14. 我对这版示例的建议

这版代码已经足够你们：

* 起 schema 目录
* 跑第一轮 migration
* 和 NestJS skeleton 对接
* 开始写 `work-item/spec/plan/package` 的 CRUD 和流程

真正落地时，你们只需要再做三件事：

### 1. 把循环外键补齐

比如：

* `work_items.current_spec_id -> specs.id`
* `specs.current_revision_id -> spec_revisions.id`
* `plans.current_revision_id -> plan_revisions.id`

这类建议在 migration 里用后续 `ALTER TABLE` 做。

### 2. 把 actor / organization 正式建表

我这里为了聚焦核心域，没有把 actor/org 一起全展开。

### 3. 给 `updated_at` 做统一更新策略

可以用应用层统一写，也可以配 trigger。

---

## 一句话总结

**对你这个系统，最好的 Drizzle 写法就是：按领域拆 `tables.ts / relations.ts`，把 Spec/Plan 做 revision 化，把 ExecutionPackage 明确冻结到 spec_revision 和 plan_revision，并让 PlanRevision 对 ExecutionPackages 保持 1-to-N。**

这既和你前面定下来的实体设计一致，也最适合继续往 review / release / replay 扩。([Drizzle ORM][1])

下一步我可以继续把 **`review` 和 `audit` 两个域的 Drizzle schema** 也直接补出来。

[1]: https://orm.drizzle.team/docs/sql-schema-declaration?utm_source=chatgpt.com "Schema - Drizzle ORM"
[2]: https://orm.drizzle.team/docs/indexes-constraints?utm_source=chatgpt.com "Indexes & Constraints - Drizzle ORM"
[3]: https://orm.drizzle.team/docs/get-started-postgresql?utm_source=chatgpt.com "PostgreSQL - Drizzle ORM"
[4]: https://orm.drizzle.team/docs/migrations?utm_source=chatgpt.com "Migrations - Drizzle ORM"

可以。下面我把 **`review`** 和 **`audit`** 两个域的 Drizzle schema 直接补出来，风格和前面四个核心域保持一致。

这两块分别对应你 PRD 里的：

* **Review Center / Quality & Test Center**
* **Process Replay / Event / Trace / Decision / Artifact**

所以它们不是附属表，而是主闭环的一部分。

---

# 1. `review/tables.ts`

这里先放两张表：

* `review_packets`
* `test_evidences`

`review_packets` 是 **Execution Package 的审查快照**，不是一个会被覆盖的字段。
`test_evidences` 是测试门禁与回放证据的统一承载。

```ts
// packages/db/src/schema/review/tables.ts
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  archivedAtCol,
  createdAtCol,
  createdByActorIdCol,
  deletedAtCol,
  descriptionCol,
  extraCol,
  idCol,
  keyCol,
  labelsCol,
  orgIdCol,
  projectIdCol,
  sourceTypeCol,
  titleCol,
  updatedAtCol,
  updatedByActorIdCol,
  visibilityCol,
} from '../_shared/base';

export const reviewPacketStatusEnum = pgEnum('review_packet_status_t', [
  'draft',
  'ready',
  'in_review',
  'completed',
  'escalated',
  'archived',
]);

export const reviewDecisionEnum = pgEnum('review_decision_t', [
  'none',
  'approved',
  'changes_requested',
  'need_more_context',
  'escalate',
]);

export const testLayerEnum = pgEnum('test_layer_t', [
  'unit',
  'integration',
  'contract',
  'e2e',
  'exploratory',
  'post_release',
]);

export const testStatusEnum = pgEnum('test_status_t', [
  'passed',
  'failed',
  'partial',
  'skipped',
]);

export const reviewPackets = pgTable(
  'review_packets',
  {
    id: idCol(),
    orgId: orgIdCol(),
    projectId: projectIdCol().notNull(),

    packageId: uuid('package_id').notNull(),
    runSessionId: uuid('run_session_id'),

    specRevisionId: uuid('spec_revision_id').notNull(),
    planRevisionId: uuid('plan_revision_id').notNull(),

    key: keyCol(),
    title: titleCol(),
    description: descriptionCol(),

    status: reviewPacketStatusEnum('status').notNull().default('draft'),
    decision: reviewDecisionEnum('decision').notNull().default('none'),

    reviewerActorId: uuid('reviewer_actor_id'),
    reviewStartedAt: createdAtCol('review_started_at'),
    reviewCompletedAt: createdAtCol('review_completed_at'),

    specRefs: jsonb('spec_refs'),
    planRefs: jsonb('plan_refs'),

    changeSummary: text('change_summary'),
    keyDiffs: jsonb('key_diffs'),
    changedFiles: text('changed_files').array(),

    aiSelfReview: jsonb('ai_self_review'),
    aiIndependentReview: jsonb('ai_independent_review'),

    testMapping: jsonb('test_mapping'),
    riskPoints: jsonb('risk_points'),
    humanDecisionQuestions: jsonb('human_decision_questions'),

    finalComments: text('final_comments'),

    visibility: visibilityCol(),
    sourceType: sourceTypeCol(),
    labels: labelsCol(),
    extra: extraCol(),

    createdAt: createdAtCol(),
    createdByActorId: createdByActorIdCol(),
    updatedAt: updatedAtCol(),
    updatedByActorId: updatedByActorIdCol(),
    archivedAt: archivedAtCol(),
    deletedAt: deletedAtCol(),
  },
  (t) => ({
    uqOrgKey: uniqueIndex('review_packets_org_key_uq').on(t.orgId, t.key),
    idxPackage: index('review_packets_package_idx').on(t.packageId),
    idxRunSession: index('review_packets_run_session_idx').on(t.runSessionId),
    idxStatusDecision: index('review_packets_status_decision_idx').on(
      t.status,
      t.decision,
    ),
    idxReviewer: index('review_packets_reviewer_idx').on(t.reviewerActorId),
  }),
);

export const testEvidences = pgTable(
  'test_evidences',
  {
    id: idCol(),
    orgId: orgIdCol(),
    projectId: projectIdCol().notNull(),

    workItemId: uuid('work_item_id'),
    packageId: uuid('package_id'),
    runSessionId: uuid('run_session_id'),

    key: keyCol(),
    title: titleCol(),
    description: descriptionCol(),

    layer: testLayerEnum('layer').notNull(),
    status: testStatusEnum('status').notNull(),

    summary: text('summary'),
    metrics: jsonb('metrics'),
    artifactId: uuid('artifact_id'),

    visibility: visibilityCol(),
    sourceType: sourceTypeCol(),
    labels: labelsCol(),
    extra: extraCol(),

    createdAt: createdAtCol(),
    createdByActorId: createdByActorIdCol(),
    updatedAt: updatedAtCol(),
    updatedByActorId: updatedByActorIdCol(),
    archivedAt: archivedAtCol(),
    deletedAt: deletedAtCol(),
  },
  (t) => ({
    uqOrgKey: uniqueIndex('test_evidences_org_key_uq').on(t.orgId, t.key),
    idxWorkItem: index('test_evidences_work_item_idx').on(t.workItemId),
    idxPackage: index('test_evidences_package_idx').on(t.packageId),
    idxRunSession: index('test_evidences_run_session_idx').on(t.runSessionId),
    idxLayerStatus: index('test_evidences_layer_status_idx').on(
      t.layer,
      t.status,
    ),
  }),
);
```

---

# 2. `review/relations.ts`

这里把它们和前面的四个核心域接起来：

* `review_packets -> execution_packages`
* `review_packets -> run_sessions`
* `review_packets -> spec_revisions / plan_revisions`
* `test_evidences -> work_items / execution_packages / run_sessions`

```ts
// packages/db/src/schema/review/relations.ts
import { relations } from 'drizzle-orm';
import { reviewPackets, testEvidences } from './tables';
import { executionPackages } from '../execution-package/tables';
import { specRevisions } from '../spec/tables';
import { planRevisions } from '../plan/tables';
import { workItems } from '../work-item/tables';
import { runSessions } from '../execution-runtime/tables';

export const reviewPacketsRelations = relations(reviewPackets, ({ one }) => ({
  executionPackage: one(executionPackages, {
    fields: [reviewPackets.packageId],
    references: [executionPackages.id],
  }),
  runSession: one(runSessions, {
    fields: [reviewPackets.runSessionId],
    references: [runSessions.id],
  }),
  specRevision: one(specRevisions, {
    fields: [reviewPackets.specRevisionId],
    references: [specRevisions.id],
  }),
  planRevision: one(planRevisions, {
    fields: [reviewPackets.planRevisionId],
    references: [planRevisions.id],
  }),
}));

export const testEvidencesRelations = relations(testEvidences, ({ one }) => ({
  workItem: one(workItems, {
    fields: [testEvidences.workItemId],
    references: [workItems.id],
  }),
  executionPackage: one(executionPackages, {
    fields: [testEvidences.packageId],
    references: [executionPackages.id],
  }),
  runSession: one(runSessions, {
    fields: [testEvidences.runSessionId],
    references: [runSessions.id],
  }),
}));
```

---

# 3. 先补一个你前面还没单独拆出来的 `execution-runtime/tables.ts`

因为 `review` 和 `audit` 都会引用 `run_sessions`，我建议把它从 `execution-package` 域里单独拆到 `execution-runtime`，这样更清楚：

```ts
// packages/db/src/schema/execution-runtime/tables.ts
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  archivedAtCol,
  createdAtCol,
  createdByActorIdCol,
  deletedAtCol,
  descriptionCol,
  extraCol,
  idCol,
  keyCol,
  labelsCol,
  orgIdCol,
  projectIdCol,
  sourceTypeCol,
  titleCol,
  updatedAtCol,
  updatedByActorIdCol,
  visibilityCol,
} from '../_shared/base';

export const runStatusEnum = pgEnum('run_status_t', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'handed_over',
]);

export const executorTypeEnum = pgEnum('executor_type_t', ['codex']);

export const sandboxTypeEnum = pgEnum('sandbox_type_t', [
  'docker',
  'k8s_job',
  'microvm',
]);

export const runSessions = pgTable(
  'run_sessions',
  {
    id: idCol(),
    orgId: orgIdCol(),
    projectId: projectIdCol().notNull(),

    packageId: uuid('package_id').notNull(),

    key: keyCol(),
    title: titleCol(),
    description: descriptionCol(),

    status: runStatusEnum('status').notNull().default('queued'),
    executorType: executorTypeEnum('executor_type')
      .notNull()
      .default('codex'),
    executorVersion: text('executor_version'),

    sandboxId: text('sandbox_id'),
    sandboxType: sandboxTypeEnum('sandbox_type'),
    baseCommitSha: text('base_commit_sha'),
    workingBranch: text('working_branch'),

    runSpec: jsonb('run_spec'),
    modelInputSummary: jsonb('model_input_summary'),
    promptRefs: jsonb('prompt_refs'),
    skillRefs: text('skill_refs').array(),
    configRefs: jsonb('config_refs'),

    startedAt: createdAtCol('started_at'),
    endedAt: createdAtCol('ended_at'),

    resultSummary: text('result_summary'),
    changedFiles: text('changed_files').array(),

    outputPatchArtifactId: uuid('output_patch_artifact_id'),
    testReportArtifactId: uuid('test_report_artifact_id'),
    handoverReason: text('handover_reason'),

    visibility: visibilityCol(),
    sourceType: sourceTypeCol(),
    labels: labelsCol(),
    extra: extraCol(),

    createdAt: createdAtCol(),
    createdByActorId: createdByActorIdCol(),
    updatedAt: updatedAtCol(),
    updatedByActorId: updatedByActorIdCol(),
    archivedAt: archivedAtCol(),
    deletedAt: deletedAtCol(),
  },
  (t) => ({
    uqOrgKey: uniqueIndex('run_sessions_org_key_uq').on(t.orgId, t.key),
    idxPackage: index('run_sessions_package_idx').on(t.packageId),
    idxStatusStartedAt: index('run_sessions_status_started_at_idx').on(
      t.status,
      t.startedAt,
    ),
  }),
);
```

如果你不想多一个域，也可以把这张表继续放回 `execution-package/tables.ts`，只是 `review` 和 `audit` 的 import 会绕一点。

---

# 4. `review/index.ts` 补导出

```ts
// packages/db/src/schema/review/index.ts
export * from './tables';
export * from './relations';
```

---

# 5. `audit/tables.ts`

这块先补四张关键表：

* `artifacts`
* `object_events`
* `status_histories`
* `decisions`

这四张表基本就是你后面 Replay / Evolution / 审计的底子。

```ts
// packages/db/src/schema/audit/tables.ts
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  createdAtCol,
  createdByActorIdCol,
  idCol,
  orgIdCol,
  projectIdCol,
} from '../_shared/base';

export const artifactOwnerTypeEnum = pgEnum('artifact_owner_type_t', [
  'run_session',
  'review_packet',
  'release',
  'incident',
  'spec_revision',
  'plan_revision',
  'test_evidence',
]);

export const artifactTypeEnum = pgEnum('artifact_type_t', [
  'patch',
  'diff',
  'log',
  'test_report',
  'build_output',
  'summary',
  'trace',
  'screenshot',
  'deployment_record',
]);

export const objectTypeEnum = pgEnum('object_type_t', [
  'work_item',
  'spec',
  'plan',
  'execution_package',
  'review_packet',
  'release',
  'incident',
  'run_session',
  'contract',
]);

export const objectEventTypeEnum = pgEnum('object_event_type_t', [
  'created',
  'updated',
  'submitted',
  'approved',
  'rejected',
  'superseded',
  'phase_changed',
  'gate_changed',
  'run_started',
  'run_failed',
  'run_succeeded',
  'retry_requested',
  'handover',
  'review_requested',
  'review_completed',
  'released',
  'rolled_back',
  'incident_linked',
]);

export const actorTypeEnum = pgEnum('actor_type_t', [
  'human',
  'ai',
  'system',
]);

export const statusFieldNameEnum = pgEnum('status_field_name_t', [
  'phase',
  'status',
  'activity_state',
  'gate_state',
  'resolution',
]);

export const decisionTypeEnum = pgEnum('decision_type_t', [
  'spec_approval',
  'plan_approval',
  'review_decision',
  'release_approval',
  'manual_override',
  'rollback_decision',
]);

export const artifacts = pgTable(
  'artifacts',
  {
    id: idCol(),
    orgId: orgIdCol(),
    projectId: projectIdCol(),

    ownerObjectType: artifactOwnerTypeEnum('owner_object_type').notNull(),
    ownerObjectId: uuid('owner_object_id').notNull(),

    artifactType: artifactTypeEnum('artifact_type').notNull(),
    storageUri: text('storage_uri').notNull(),
    contentType: text('content_type'),
    sizeBytes: text('size_bytes'),
    checksum: text('checksum'),

    createdAt: createdAtCol(),
    createdByActorId: createdByActorIdCol(),
  },
  (t) => ({
    idxOwner: index('artifacts_owner_idx').on(
      t.ownerObjectType,
      t.ownerObjectId,
    ),
    idxArtifactType: index('artifacts_type_idx').on(t.artifactType),
  }),
);

export const objectEvents = pgTable(
  'object_events',
  {
    id: idCol(),
    orgId: orgIdCol(),
    projectId: projectIdCol(),

    objectType: objectTypeEnum('object_type').notNull(),
    objectId: uuid('object_id').notNull(),
    eventType: objectEventTypeEnum('event_type').notNull(),

    actorType: actorTypeEnum('actor_type').notNull(),
    actorId: uuid('actor_id'),

    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    reason: text('reason'),
    payload: jsonb('payload'),
  },
  (t) => ({
    idxObjectOccurredAt: index('object_events_object_occurred_at_idx').on(
      t.objectType,
      t.objectId,
      t.occurredAt,
    ),
    idxProjectOccurredAt: index('object_events_project_occurred_at_idx').on(
      t.projectId,
      t.occurredAt,
    ),
  }),
);

export const statusHistories = pgTable(
  'status_histories',
  {
    id: idCol(),

    objectType: objectTypeEnum('object_type').notNull(),
    objectId: uuid('object_id').notNull(),

    fieldName: statusFieldNameEnum('field_name').notNull(),
    fromValue: text('from_value'),
    toValue: text('to_value').notNull(),

    changedByActorType: actorTypeEnum('changed_by_actor_type').notNull(),
    changedByActorId: uuid('changed_by_actor_id'),

    changedAt: timestamp('changed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    reason: text('reason'),
    context: jsonb('context'),
  },
  (t) => ({
    idxObjectChangedAt: index('status_histories_object_changed_at_idx').on(
      t.objectType,
      t.objectId,
      t.changedAt,
    ),
  }),
);

export const decisions = pgTable(
  'decisions',
  {
    id: idCol(),
    orgId: orgIdCol(),
    projectId: projectIdCol(),

    objectType: objectTypeEnum('object_type').notNull(),
    objectId: uuid('object_id').notNull(),

    decisionType: decisionTypeEnum('decision_type').notNull(),
    outcome: text('outcome').notNull(),
    decidedByActorId: uuid('decided_by_actor_id').notNull(),
    rationale: text('rationale'),
    evidenceRefs: jsonb('evidence_refs'),

    createdAt: createdAtCol(),
  },
  (t) => ({
    idxObjectCreatedAt: index('decisions_object_created_at_idx').on(
      t.objectType,
      t.objectId,
      t.createdAt,
    ),
  }),
);
```

---

# 6. `audit/relations.ts`

这部分关系不需要像业务对象那样复杂，因为它们本身就是“多态 owner / object”模型。
Drizzle 没法天然优雅表达这种“一个 `ownerObjectType + ownerObjectId` 可以指向多种表”的多态关系，所以这里我建议：

* **不强行定义多态 relations**
* 只对那些单一外键能确定的表定义 relations
* 多态部分在 query 层自己处理

所以 `audit/relations.ts` 可以先很轻：

```ts
// packages/db/src/schema/audit/relations.ts
// 多态 owner/object 关系不建议强行用 drizzle relations 表达。
// 这层先留空，复杂回放查询在 queries/replay-queries.ts 里处理。
export {};
```

这是一个很实际的取舍。
你这类 replay / audit 场景，本来就更适合“SQL-like query + application mapping”，而不是试图用 ORM relations 把所有多态关系都抽出来。

---

# 7. `audit/index.ts`

```ts
// packages/db/src/schema/audit/index.ts
export * from './tables';
export * from './relations';
```

---

# 8. 更新 `schema/index.ts`

把这几个新域导出来。

```ts
// packages/db/src/schema/index.ts
export * from './_shared/enums';

export * from './project/tables';
export * from './project/relations';

export * from './work-item/tables';
export * from './work-item/relations';

export * from './spec/tables';
export * from './spec/relations';

export * from './plan/tables';
export * from './plan/relations';

export * from './execution-package/tables';
export * from './execution-package/relations';

export * from './execution-runtime/tables';

export * from './review/tables';
export * from './review/relations';

export * from './audit/tables';
export * from './audit/relations';
```

---

# 9. 推荐立刻补的 query 文件

既然 `audit` 域有多态 owner/object，我建议你马上建两个 query 文件：

```text
packages/db/src/queries/
  review-queries.ts
  replay-queries.ts
```

## `review-queries.ts` 适合放

* 某个 package 的 latest review packet
* 某个 package 的 test summary
* 某个 work item 的 review/test 聚合

## `replay-queries.ts` 适合放

* 某个 object 的 timeline
* 某个 incident 的关联对象链路
* 某个 work item 的 event + decision + artifact 汇总

这会比强行把所有 replay 逻辑塞进 Nest service 更稳。

---

# 10. 一个很重要的实现提醒

## `artifacts.ownerObjectType + ownerObjectId`

## `objectEvents.objectType + objectId`

## `statusHistories.objectType + objectId`

## `decisions.objectType + objectId`

这四组都是**多态引用**。
数据库层面它们通常不会有真正的 FK，因为一个字段可能指向很多张表。

所以实践上要这么做：

### 规则校验放应用层

在写入这些表时：

* 检查 objectType
* 根据 type 去查对应表是否存在
* 再插入 event / decision / artifact

### 查询聚合放 query 层

不要指望 ORM 自动帮你做完。

这也是我前面更推荐 Drizzle 而不是 Prisma 的原因之一：
你这里这种“强 SQL 心智 + 多态审计模型”的系统，长期会更受益。

---

# 11. 到这里你已经有的完整域

现在你已经有：

## 核心定义域

* `projects`
* `work_items`
* `specs`
* `spec_revisions`
* `plans`
* `plan_revisions`
* `execution_packages`

## 执行与审查域

* `run_sessions`
* `review_packets`
* `test_evidences`

## 审计与回放域

* `artifacts`
* `object_events`
* `status_histories`
* `decisions`

这已经足够支撑一条很像样的 P0/P1 主闭环了。

---

# 12. 我建议的下一个顺序

如果继续补，我建议顺序是：

### 第一优先级

补 `release` 域

* `releases`
* `release_work_items`
* `release_execution_packages`
* `release_evidences`

### 第二优先级

补 `incident` 域

* `incidents`
* `incident_links`

### 第三优先级

补 `contract` 域

* `contracts`
* `contract_revisions`
* `package_contract_links`

因为这样你就能把：
**交付主线**
和
**回放主线**
都真正串起来。

---

## 一句话总结

这版补完以后，你的 Drizzle schema 已经从“定义对象”扩展到了“审查与回放对象”：
**review 域负责质量与审查证据，audit 域负责事件、状态历史、决策和产物归档。**

这正好对应你这套系统里最有差异化的两条能力：
**可控交付** 和 **可回放进化**。

下一步我可以继续直接把 **`release` 和 `incident` 两个域的 Drizzle schema** 也补出来。

好，继续。下面我把 **`release`** 和 **`incident`** 两个域的 Drizzle schema 直接补出来，风格和前面保持一致。

这两块分别对应你 PRD 里的：

* **Release & Risk Radar**
* **Incident / Replay / Retrospective**

而且 PRD 明确要求：

* Release 是**聚合多个 Work Items 与 Execution Packages** 的交付编排对象
* Incident 要能**回链到 Release / Work Item / Package**，支撑全链路复盘

---

# 1. `release/tables.ts`

这里先放三张表：

* `releases`
* `release_work_items`
* `release_execution_packages`
* `release_evidences`

`release_evidences` 我也一起带上，因为 Release 如果没有证据对象，后面 rollout / rollback / test evidence 会很难做结构化沉淀。

```ts
// packages/db/src/schema/release/tables.ts
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  archivedAtCol,
  createdAtCol,
  createdByActorIdCol,
  deletedAtCol,
  descriptionCol,
  extraCol,
  idCol,
  keyCol,
  labelsCol,
  orgIdCol,
  projectIdCol,
  sourceTypeCol,
  titleCol,
  updatedAtCol,
  updatedByActorIdCol,
  visibilityCol,
} from '../_shared/base';

export const releasePhaseEnum = pgEnum('release_phase_t', [
  'draft',
  'candidate',
  'approval',
  'rollout',
  'observing',
  'completed',
  'closed',
]);

export const releaseActivityStateEnum = pgEnum('release_activity_state_t', [
  'idle',
  'awaiting_human',
  'human_in_progress',
  'rolling_out',
  'paused',
  'blocked',
]);

export const releaseGateStateEnum = pgEnum('release_gate_state_t', [
  'not_submitted',
  'awaiting_approval',
  'changes_requested',
  'approved',
  'rollout_failed',
  'rollout_succeeded',
]);

export const releaseResolutionEnum = pgEnum('release_resolution_t', [
  'none',
  'completed',
  'rolled_back',
  'cancelled',
]);

export const releaseTypeEnum = pgEnum('release_type_t', [
  'normal',
  'hotfix',
  'emergency',
  'gray',
]);

export const releases = pgTable(
  'releases',
  {
    id: idCol(),
    orgId: orgIdCol(),
    projectId: projectIdCol().notNull(),

    key: keyCol(),
    title: titleCol(),
    description: descriptionCol(),

    phase: releasePhaseEnum('phase').notNull().default('draft'),
    activityState: releaseActivityStateEnum('activity_state')
      .notNull()
      .default('idle'),
    gateState: releaseGateStateEnum('gate_state')
      .notNull()
      .default('not_submitted'),
    resolution: releaseResolutionEnum('resolution')
      .notNull()
      .default('none'),

    releaseOwnerActorId: uuid('release_owner_actor_id').notNull(),
    releaseType: releaseTypeEnum('release_type').notNull().default('normal'),

    scopeSummary: text('scope_summary'),
    riskSummary: jsonb('risk_summary'),
    rolloutStrategy: jsonb('rollout_strategy'),
    rollbackPlan: jsonb('rollback_plan'),
    observationPlan: jsonb('observation_plan'),

    rolloutStartedAt: createdAtCol('rollout_started_at'),
    rolloutCompletedAt: createdAtCol('rollout_completed_at'),
    observedUntil: createdAtCol('observed_until'),

    visibility: visibilityCol(),
    sourceType: sourceTypeCol(),
    labels: labelsCol(),
    extra: extraCol(),

    createdAt: createdAtCol(),
    createdByActorId: createdByActorIdCol(),
    updatedAt: updatedAtCol(),
    updatedByActorId: updatedByActorIdCol(),
    archivedAt: archivedAtCol(),
    deletedAt: deletedAtCol(),
  },
  (t) => ({
    uqOrgKey: uniqueIndex('releases_org_key_uq').on(t.orgId, t.key),
    idxProjectPhase: index('releases_project_phase_idx').on(
      t.projectId,
      t.phase,
    ),
    idxOwnerPhase: index('releases_owner_phase_idx').on(
      t.releaseOwnerActorId,
      t.phase,
    ),
    idxTypePhase: index('releases_type_phase_idx').on(
      t.releaseType,
      t.phase,
    ),
  }),
);

export const releaseWorkItems = pgTable(
  'release_work_items',
  {
    releaseId: uuid('release_id').notNull(),
    workItemId: uuid('work_item_id').notNull(),
  },
  (t) => ({
    pk: uniqueIndex('release_work_items_pk').on(t.releaseId, t.workItemId),
    idxWorkItem: index('release_work_items_work_item_idx').on(t.workItemId),
  }),
);

export const releaseExecutionPackages = pgTable(
  'release_execution_packages',
  {
    releaseId: uuid('release_id').notNull(),
    packageId: uuid('package_id').notNull(),
  },
  (t) => ({
    pk: uniqueIndex('release_execution_packages_pk').on(
      t.releaseId,
      t.packageId,
    ),
    idxPackage: index('release_execution_packages_package_idx').on(t.packageId),
  }),
);

export const releaseEvidences = pgTable(
  'release_evidences',
  {
    id: idCol(),
    orgId: orgIdCol(),
    projectId: projectIdCol().notNull(),

    releaseId: uuid('release_id').notNull(),

    key: keyCol(),
    title: titleCol(),
    description: descriptionCol(),

    evidenceType: text('evidence_type').notNull(),
    artifactId: uuid('artifact_id'),
    summary: text('summary'),

    visibility: visibilityCol(),
    sourceType: sourceTypeCol(),
    labels: labelsCol(),
    extra: extraCol(),

    createdAt: createdAtCol(),
    createdByActorId: createdByActorIdCol(),
    updatedAt: updatedAtCol(),
    updatedByActorId: updatedByActorIdCol(),
  },
  (t) => ({
    uqOrgKey: uniqueIndex('release_evidences_org_key_uq').on(t.orgId, t.key),
    idxRelease: index('release_evidences_release_idx').on(t.releaseId),
    idxEvidenceType: index('release_evidences_type_idx').on(t.evidenceType),
  }),
);
```

---

# 2. `release/relations.ts`

这里把 Release 和：

* `work_items`
* `execution_packages`
* `release_evidences`

接起来。

因为 `release_work_items`、`release_execution_packages` 都是中间表，所以关系会分两层：

* Release ↔ 中间表
* 中间表 ↔ WorkItem / ExecutionPackage

```ts
// packages/db/src/schema/release/relations.ts
import { relations } from 'drizzle-orm';
import {
  releases,
  releaseWorkItems,
  releaseExecutionPackages,
  releaseEvidences,
} from './tables';
import { workItems } from '../work-item/tables';
import { executionPackages } from '../execution-package/tables';
import { artifacts } from '../audit/tables';

export const releasesRelations = relations(releases, ({ many }) => ({
  workItemLinks: many(releaseWorkItems),
  executionPackageLinks: many(releaseExecutionPackages),
  evidences: many(releaseEvidences),
}));

export const releaseWorkItemsRelations = relations(
  releaseWorkItems,
  ({ one }) => ({
    release: one(releases, {
      fields: [releaseWorkItems.releaseId],
      references: [releases.id],
    }),
    workItem: one(workItems, {
      fields: [releaseWorkItems.workItemId],
      references: [workItems.id],
    }),
  }),
);

export const releaseExecutionPackagesRelations = relations(
  releaseExecutionPackages,
  ({ one }) => ({
    release: one(releases, {
      fields: [releaseExecutionPackages.releaseId],
      references: [releases.id],
    }),
    executionPackage: one(executionPackages, {
      fields: [releaseExecutionPackages.packageId],
      references: [executionPackages.id],
    }),
  }),
);

export const releaseEvidencesRelations = relations(
  releaseEvidences,
  ({ one }) => ({
    release: one(releases, {
      fields: [releaseEvidences.releaseId],
      references: [releases.id],
    }),
    artifact: one(artifacts, {
      fields: [releaseEvidences.artifactId],
      references: [artifacts.id],
    }),
  }),
);
```

---

# 3. `release/index.ts`

```ts
// packages/db/src/schema/release/index.ts
export * from './tables';
export * from './relations';
```

---

# 4. `incident/tables.ts`

这里放两张表：

* `incidents`
* `incident_links`

`incidents` 本身可以带主关联对象：

* `primary_release_id`
* `primary_work_item_id`
* `primary_package_id`

但因为真实事故经常会关联多个对象，所以还需要 `incident_links`。
这也更符合你 PRD 里“Incident 可回链到 Release、Work Item、Execution Package 及其相关轨迹”的要求。

```ts
// packages/db/src/schema/incident/tables.ts
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  archivedAtCol,
  createdAtCol,
  createdByActorIdCol,
  deletedAtCol,
  descriptionCol,
  extraCol,
  idCol,
  keyCol,
  labelsCol,
  orgIdCol,
  projectIdCol,
  sourceTypeCol,
  titleCol,
  updatedAtCol,
  updatedByActorIdCol,
  visibilityCol,
} from '../_shared/base';

export const incidentSeverityEnum = pgEnum('incident_severity_t', [
  'sev0',
  'sev1',
  'sev2',
  'sev3',
]);

export const incidentStatusEnum = pgEnum('incident_status_t', [
  'open',
  'triaging',
  'mitigating',
  'resolved',
  'retrospecting',
  'closed',
]);

export const incidentActivityStateEnum = pgEnum('incident_activity_state_t', [
  'idle',
  'human_in_progress',
  'awaiting_input',
  'blocked',
]);

export const incidentResolutionEnum = pgEnum('incident_resolution_t', [
  'none',
  'resolved',
  'false_alarm',
  'duplicate',
  'cancelled',
]);

export const incidentLinkObjectTypeEnum = pgEnum(
  'incident_link_object_type_t',
  ['release', 'work_item', 'execution_package'],
);

export const incidentLinkRoleEnum = pgEnum('incident_link_role_t', [
  'primary',
  'related',
  'root_cause',
  'affected',
  'fix',
]);

export const incidents = pgTable(
  'incidents',
  {
    id: idCol(),
    orgId: orgIdCol(),
    projectId: projectIdCol().notNull(),

    key: keyCol(),
    title: titleCol(),
    description: descriptionCol(),

    severity: incidentSeverityEnum('severity').notNull(),
    status: incidentStatusEnum('status').notNull().default('open'),
    activityState: incidentActivityStateEnum('activity_state')
      .notNull()
      .default('idle'),
    resolution: incidentResolutionEnum('resolution')
      .notNull()
      .default('none'),

    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),

    impactScope: jsonb('impact_scope'),
    symptomSummary: text('symptom_summary'),
    rootCauseSummary: text('root_cause_summary'),

    primaryReleaseId: uuid('primary_release_id'),
    primaryWorkItemId: uuid('primary_work_item_id'),
    primaryPackageId: uuid('primary_package_id'),

    mitigationActions: jsonb('mitigation_actions'),
    rollbackActions: jsonb('rollback_actions'),
    retrospectiveDocRef: text('retrospective_doc_ref'),

    visibility: visibilityCol(),
    sourceType: sourceTypeCol(),
    labels: labelsCol(),
    extra: extraCol(),

    createdAt: createdAtCol(),
    createdByActorId: createdByActorIdCol(),
    updatedAt: updatedAtCol(),
    updatedByActorId: updatedByActorIdCol(),
    archivedAt: archivedAtCol(),
    deletedAt: deletedAtCol(),
  },
  (t) => ({
    uqOrgKey: uniqueIndex('incidents_org_key_uq').on(t.orgId, t.key),
    idxProjectStatus: index('incidents_project_status_idx').on(
      t.projectId,
      t.status,
    ),
    idxSeverityDetectedAt: index('incidents_severity_detected_at_idx').on(
      t.severity,
      t.detectedAt,
    ),
    idxPrimaryRelease: index('incidents_primary_release_idx').on(
      t.primaryReleaseId,
    ),
    idxPrimaryWorkItem: index('incidents_primary_work_item_idx').on(
      t.primaryWorkItemId,
    ),
    idxPrimaryPackage: index('incidents_primary_package_idx').on(
      t.primaryPackageId,
    ),
  }),
);

export const incidentLinks = pgTable(
  'incident_links',
  {
    id: idCol(),
    incidentId: uuid('incident_id').notNull(),

    objectType: incidentLinkObjectTypeEnum('object_type').notNull(),
    objectId: uuid('object_id').notNull(),

    role: incidentLinkRoleEnum('role').notNull().default('related'),

    createdAt: createdAtCol(),
    createdByActorId: createdByActorIdCol(),
  },
  (t) => ({
    idxIncident: index('incident_links_incident_idx').on(t.incidentId),
    idxObject: index('incident_links_object_idx').on(
      t.objectType,
      t.objectId,
    ),
  }),
);
```

---

# 5. `incident/relations.ts`

这里关系也分两部分：

### 可直接建关系的

* `incidents.primaryReleaseId -> releases`
* `incidents.primaryWorkItemId -> workItems`
* `incidents.primaryPackageId -> executionPackages`
* `incidentLinks -> incidents`

### 不建议强行 relation 的

* `incident_links.object_type + object_id`
  因为这是多态关系，和 `audit` 域的多态 owner 一样，更适合放在 query 层处理。

```ts
// packages/db/src/schema/incident/relations.ts
import { relations } from 'drizzle-orm';
import { incidents, incidentLinks } from './tables';
import { releases } from '../release/tables';
import { workItems } from '../work-item/tables';
import { executionPackages } from '../execution-package/tables';

export const incidentsRelations = relations(incidents, ({ one, many }) => ({
  primaryRelease: one(releases, {
    fields: [incidents.primaryReleaseId],
    references: [releases.id],
  }),
  primaryWorkItem: one(workItems, {
    fields: [incidents.primaryWorkItemId],
    references: [workItems.id],
  }),
  primaryExecutionPackage: one(executionPackages, {
    fields: [incidents.primaryPackageId],
    references: [executionPackages.id],
  }),
  links: many(incidentLinks),
}));

export const incidentLinksRelations = relations(incidentLinks, ({ one }) => ({
  incident: one(incidents, {
    fields: [incidentLinks.incidentId],
    references: [incidents.id],
  }),
}));

// incident_links 的 objectType + objectId 是多态引用，
// 不建议强行定义 drizzle relations，复杂关联在 query 层做。
```

---

# 6. `incident/index.ts`

```ts
// packages/db/src/schema/incident/index.ts
export * from './tables';
export * from './relations';
```

---

# 7. 更新 `schema/index.ts`

把 `release` 和 `incident` 导出来。

```ts
// packages/db/src/schema/index.ts
export * from './_shared/enums';

export * from './project/tables';
export * from './project/relations';

export * from './work-item/tables';
export * from './work-item/relations';

export * from './spec/tables';
export * from './spec/relations';

export * from './plan/tables';
export * from './plan/relations';

export * from './execution-package/tables';
export * from './execution-package/relations';

export * from './execution-runtime/tables';

export * from './review/tables';
export * from './review/relations';

export * from './release/tables';
export * from './release/relations';

export * from './incident/tables';
export * from './incident/relations';

export * from './audit/tables';
export * from './audit/relations';
```

---

# 8. 现在你的 schema 已经具备的能力

到这里为止，你已经有了一套相当完整的 V1 数据骨架：

## 业务定义层

* `projects`
* `work_items`
* `specs`
* `spec_revisions`
* `plans`
* `plan_revisions`

## 执行层

* `execution_packages`
* `run_sessions`

## 审查与质量层

* `review_packets`
* `test_evidences`

## 交付层

* `releases`
* `release_work_items`
* `release_execution_packages`
* `release_evidences`

## 事故与回放层

* `incidents`
* `incident_links`
* `artifacts`
* `object_events`
* `status_histories`
* `decisions`

这已经能比较完整地覆盖你 PRD 里的：

* Work Item 主线
* Spec / Plan 主线
* Execution Package 主线
* Review / Quality
* Release / Incident / Replay

---

# 9. 还差的一个正式域：`contract`

现在还没补的核心正式域，基本只剩：

* `contracts`
* `contract_revisions`
* `package_contract_links`

它主要对应你 PRD 里的：

* Contract-first / Mock-first
* 多端协同
* integration readiness 的上游约束

---

# 10. 我建议的下一步

这时候最值得继续做的，不是再补更多表，而是做这两件事：

## 第一件

把这些 schema 真正串成一轮 migration
先确保：

* enum 正常生成
* 表顺序正确
* 多态表不引发奇怪引用问题

## 第二件

开始写 **query 层**
尤其是：

* `work-item-cockpit-query`
* `release-cockpit-query`
* `replay-query`

因为你现在 schema 的“定义能力”已经够了，下一步真正能体现系统价值的是**聚合读模型**。

---

## 一句话总结

到这一步，你的 Drizzle schema 已经从“核心定义对象”扩展到了“审查、交付、事故、回放对象”，主闭环已经基本成型。
还差的核心正式域只剩 `contract`，再往后就该重点转向 **migration 验证** 和 **读侧聚合查询** 了。

下一步最顺的是，我直接继续给你补 **`contract` 域的 Drizzle schema**，然后再给一版 **`work-item cockpit` 和 `replay` 查询示例**。


可以，继续。下面我把两部分直接补上：

1. **`contract` 域的 Drizzle schema**
2. **`work-item cockpit` 和 `replay` 查询示例**

这两块正好对应你 PRD 里关于：

* **Contract-first / Mock-first**
* **Cross-end Delivery & Integration Hub**
* **Process Replay / Timeline / 决策节点 / 轨迹查看**

的核心要求。

---

# 1. `contract/tables.ts`

这里放三张表：

* `contracts`
* `contract_revisions`
* `package_contract_links`

设计原则还是和前面一致：

* `Contract` 是逻辑对象
* `ContractRevision` 是版本对象
* `ExecutionPackage` 通过 link 表和 Contract 发生关系
* 一个 Package 可以是某个 Contract 的 provider，也可以是 consumer，也可以依赖多个 Contract

```ts id="u0e1mx"
// packages/db/src/schema/contract/tables.ts
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  archivedAtCol,
  createdAtCol,
  createdByActorIdCol,
  deletedAtCol,
  descriptionCol,
  extraCol,
  idCol,
  keyCol,
  labelsCol,
  orgIdCol,
  projectIdCol,
  sourceTypeCol,
  titleCol,
  updatedAtCol,
  updatedByActorIdCol,
  visibilityCol,
} from '../_shared/base';

export const contractKindEnum = pgEnum('contract_kind_t', [
  'api',
  'schema',
  'event',
  'state',
]);

export const contractStatusEnum = pgEnum('contract_status_t', [
  'draft',
  'in_review',
  'approved',
  'frozen',
  'deprecated',
  'archived',
]);

export const contractGateStateEnum = pgEnum('contract_gate_state_t', [
  'not_submitted',
  'awaiting_approval',
  'changes_requested',
  'approved',
  'frozen',
]);

export const contractResolutionEnum = pgEnum('contract_resolution_t', [
  'none',
  'approved',
  'deprecated',
  'superseded',
]);

export const compatibilityModeEnum = pgEnum('compatibility_mode_t', [
  'backward',
  'forward',
  'breaking',
]);

export const contractLinkRoleEnum = pgEnum('contract_link_role_t', [
  'provider',
  'consumer',
  'depends_on',
]);

export const contracts = pgTable(
  'contracts',
  {
    id: idCol(),
    orgId: orgIdCol(),
    projectId: projectIdCol().notNull(),

    key: keyCol(),
    title: titleCol(),
    description: descriptionCol(),

    kind: contractKindEnum('kind').notNull(),

    status: contractStatusEnum('status').notNull().default('draft'),
    gateState: contractGateStateEnum('gate_state')
      .notNull()
      .default('not_submitted'),
    resolution: contractResolutionEnum('resolution')
      .notNull()
      .default('none'),

    currentRevisionId: uuid('current_revision_id'),
    approvedRevisionId: uuid('approved_revision_id'),

    providerPackageId: uuid('provider_package_id'),

    visibility: visibilityCol(),
    sourceType: sourceTypeCol(),
    labels: labelsCol(),
    extra: extraCol(),

    createdAt: createdAtCol(),
    createdByActorId: createdByActorIdCol(),
    updatedAt: updatedAtCol(),
    updatedByActorId: updatedByActorIdCol(),
    archivedAt: archivedAtCol(),
    deletedAt: deletedAtCol(),
  },
  (t) => ({
    uqOrgKey: uniqueIndex('contracts_org_key_uq').on(t.orgId, t.key),
    idxProjectStatus: index('contracts_project_status_idx').on(
      t.projectId,
      t.status,
    ),
    idxKindStatus: index('contracts_kind_status_idx').on(t.kind, t.status),
    idxProviderPackage: index('contracts_provider_package_idx').on(
      t.providerPackageId,
    ),
  }),
);

export const contractRevisions = pgTable(
  'contract_revisions',
  {
    id: idCol(),
    contractId: uuid('contract_id').notNull(),
    revisionNo: integer('revision_no').notNull(),

    version: text('version').notNull(),
    compatibilityMode: compatibilityModeEnum('compatibility_mode').notNull(),

    summary: text('summary'),
    payloadSchema: jsonb('payload_schema'),
    samplePayloads: jsonb('sample_payloads'),
    mockAssets: jsonb('mock_assets'),

    approvedByActorId: uuid('approved_by_actor_id'),
    approvedAt: createdAtCol('approved_at'),

    createdAt: createdAtCol(),
    createdByActorId: createdByActorIdCol(),
  },
  (t) => ({
    uqContractRevisionNo: uniqueIndex(
      'contract_revisions_contract_revision_no_uq',
    ).on(t.contractId, t.revisionNo),
    uqContractVersion: uniqueIndex('contract_revisions_contract_version_uq').on(
      t.contractId,
      t.version,
    ),
    idxContractRevisionDesc: index('contract_revisions_contract_revision_idx').on(
      t.contractId,
      t.revisionNo,
    ),
  }),
);

export const packageContractLinks = pgTable(
  'package_contract_links',
  {
    id: idCol(),
    packageId: uuid('package_id').notNull(),
    contractId: uuid('contract_id').notNull(),
    contractRevisionId: uuid('contract_revision_id'),

    role: contractLinkRoleEnum('role').notNull(),

    createdAt: createdAtCol(),
    createdByActorId: createdByActorIdCol(),
  },
  (t) => ({
    uqPackageContractRole: uniqueIndex(
      'package_contract_links_package_contract_role_uq',
    ).on(t.packageId, t.contractId, t.role),
    idxPackage: index('package_contract_links_package_idx').on(t.packageId),
    idxContract: index('package_contract_links_contract_idx').on(t.contractId),
    idxContractRevision: index('package_contract_links_contract_revision_idx').on(
      t.contractRevisionId,
    ),
  }),
);
```

---

# 2. `contract/relations.ts`

这里关系比较直接：

* `contracts -> contract_revisions`
* `contracts -> package_contract_links`
* `execution_packages -> package_contract_links`

```ts id="5hoh2j"
// packages/db/src/schema/contract/relations.ts
import { relations } from 'drizzle-orm';
import {
  contracts,
  contractRevisions,
  packageContractLinks,
} from './tables';
import { executionPackages } from '../execution-package/tables';

export const contractsRelations = relations(contracts, ({ one, many }) => ({
  revisions: many(contractRevisions),
  providerPackage: one(executionPackages, {
    fields: [contracts.providerPackageId],
    references: [executionPackages.id],
  }),
  packageLinks: many(packageContractLinks),
}));

export const contractRevisionsRelations = relations(
  contractRevisions,
  ({ one }) => ({
    contract: one(contracts, {
      fields: [contractRevisions.contractId],
      references: [contracts.id],
    }),
  }),
);

export const packageContractLinksRelations = relations(
  packageContractLinks,
  ({ one }) => ({
    executionPackage: one(executionPackages, {
      fields: [packageContractLinks.packageId],
      references: [executionPackages.id],
    }),
    contract: one(contracts, {
      fields: [packageContractLinks.contractId],
      references: [contracts.id],
    }),
    contractRevision: one(contractRevisions, {
      fields: [packageContractLinks.contractRevisionId],
      references: [contractRevisions.id],
    }),
  }),
);
```

---

# 3. `contract/index.ts`

```ts id="9lqmuo"
// packages/db/src/schema/contract/index.ts
export * from './tables';
export * from './relations';
```

---

# 4. 更新 `schema/index.ts`

把 contract 域并进总出口。

```ts id="b4mjlwm"
// packages/db/src/schema/index.ts
export * from './_shared/enums';

export * from './project/tables';
export * from './project/relations';

export * from './work-item/tables';
export * from './work-item/relations';

export * from './spec/tables';
export * from './spec/relations';

export * from './plan/tables';
export * from './plan/relations';

export * from './execution-package/tables';
export * from './execution-package/relations';

export * from './execution-runtime/tables';

export * from './review/tables';
export * from './review/relations';

export * from './release/tables';
export * from './release/relations';

export * from './incident/tables';
export * from './incident/relations';

export * from './contract/tables';
export * from './contract/relations';

export * from './audit/tables';
export * from './audit/relations';
```

到这里，**你这套系统的核心 schema 域已经齐了**。

---

# 5. 开始补查询：`work-item cockpit`

这是你后面 UI 里最重要的聚合查询之一。
它需要一次拿到：

* Work Item
* 当前 Spec / Plan
* 所有关联 Packages
* latest run / latest review
* release links
* incident links
* timeline summary

这种查询就很适合放进 `packages/db/src/queries/`，不要塞进 controller 或 service。

---

## `queries/work-item-cockpit-queries.ts`

我这里给你一个**务实版本**：

* 先不追求一条 SQL 把所有东西全打平
* 用 5~7 个查询拼一个 read model
* 这样可维护性更高，也更适合你现在 schema 还在演进的阶段

```ts id="1f83ie"
// packages/db/src/queries/work-item-cockpit-queries.ts
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../client';
import {
  workItems,
  specs,
  specRevisions,
  plans,
  planRevisions,
  executionPackages,
  runSessions,
  reviewPackets,
  releaseWorkItems,
  releases,
  incidentLinks,
  incidents,
} from '../schema';

export async function getWorkItemCockpit(workItemId: string) {
  const workItem = await db.query.workItems.findFirst({
    where: eq(workItems.id, workItemId),
  });

  if (!workItem) return null;

  const currentSpec = workItem.currentSpecId
    ? await db.query.specs.findFirst({
        where: eq(specs.id, workItem.currentSpecId),
      })
    : null;

  const currentSpecRevision =
    workItem.currentSpecRevisionId
      ? await db.query.specRevisions.findFirst({
          where: eq(specRevisions.id, workItem.currentSpecRevisionId),
        })
      : null;

  const currentPlan = workItem.currentPlanId
    ? await db.query.plans.findFirst({
        where: eq(plans.id, workItem.currentPlanId),
      })
    : null;

  const currentPlanRevision =
    workItem.currentPlanRevisionId
      ? await db.query.planRevisions.findFirst({
          where: eq(planRevisions.id, workItem.currentPlanRevisionId),
        })
      : null;

  const packages = await db.query.executionPackages.findMany({
    where: eq(executionPackages.workItemId, workItemId),
    orderBy: [desc(executionPackages.createdAt)],
  });

  const packageIds = packages.map((p) => p.id);

  const latestRuns =
    packageIds.length > 0
      ? await db
          .select()
          .from(runSessions)
          .where(inArray(runSessions.packageId, packageIds))
          .orderBy(desc(runSessions.createdAt))
      : [];

  const latestReviewPackets =
    packageIds.length > 0
      ? await db
          .select()
          .from(reviewPackets)
          .where(inArray(reviewPackets.packageId, packageIds))
          .orderBy(desc(reviewPackets.createdAt))
      : [];

  const releaseLinks = await db
    .select({
      releaseId: releaseWorkItems.releaseId,
      workItemId: releaseWorkItems.workItemId,
      release: releases,
    })
    .from(releaseWorkItems)
    .innerJoin(releases, eq(releaseWorkItems.releaseId, releases.id))
    .where(eq(releaseWorkItems.workItemId, workItemId));

  const incidentRelated = await db
    .select({
      incidentLink: incidentLinks,
      incident: incidents,
    })
    .from(incidentLinks)
    .innerJoin(incidents, eq(incidentLinks.incidentId, incidents.id))
    .where(
      and(
        eq(incidentLinks.objectType, 'work_item'),
        eq(incidentLinks.objectId, workItemId),
      ),
    );

  const latestRunByPackage = new Map<string, (typeof latestRuns)[number]>();
  for (const run of latestRuns) {
    if (!latestRunByPackage.has(run.packageId)) {
      latestRunByPackage.set(run.packageId, run);
    }
  }

  const latestReviewByPackage = new Map<
    string,
    (typeof latestReviewPackets)[number]
  >();
  for (const rp of latestReviewPackets) {
    if (!latestReviewByPackage.has(rp.packageId)) {
      latestReviewByPackage.set(rp.packageId, rp);
    }
  }

  return {
    workItem,
    currentSpec,
    currentSpecRevision,
    currentPlan,
    currentPlanRevision,
    packages: packages.map((pkg) => ({
      ...pkg,
      latestRun: latestRunByPackage.get(pkg.id) ?? null,
      latestReviewPacket: latestReviewByPackage.get(pkg.id) ?? null,
    })),
    releases: releaseLinks.map((x) => x.release),
    incidents: incidentRelated.map((x) => x.incident),
  };
}
```

---

# 6. 为什么 cockpit 查询我建议“多查询拼装”而不是一条巨 SQL

因为你这个系统对象很多，读模型也在演进。
一条超长 SQL 虽然也能写，但会有几个问题：

* 改 schema 时很脆
* 很难调试
* 很难做字段裁剪
* 很难给前端逐步扩展

所以更稳的方式是：

### 简单对象

正常 `db.query.xxx.findFirst/findMany`

### 聚合对象

少量几次查询 + application layer 拼装

等系统稳定后，你再把热点页面改成更重的 SQL。

---

# 7. `replay` 查询示例

Replay 的核心不是“把所有表 join 成一个大对象”，而是做一个**时间线流**：

* object_events
* status_histories
* decisions
* artifacts

再按时间排序，渲染成 timeline。

这也和你 PRD 里对 Process Replay / Timeline / 决策节点 / AI/Human 行为轨迹的要求一致。

---

## `queries/replay-queries.ts`

```ts id="vot37g"
// packages/db/src/queries/replay-queries.ts
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../client';
import {
  objectEvents,
  statusHistories,
  decisions,
  artifacts,
} from '../schema';

type ReplayObjectType =
  | 'work_item'
  | 'spec'
  | 'plan'
  | 'execution_package'
  | 'review_packet'
  | 'release'
  | 'incident'
  | 'run_session'
  | 'contract';

export async function getObjectReplayTimeline(
  objectType: ReplayObjectType,
  objectId: string,
) {
  const [events, histories, objectDecisions, objectArtifacts] = await Promise.all([
    db
      .select()
      .from(objectEvents)
      .where(
        and(
          eq(objectEvents.objectType, objectType),
          eq(objectEvents.objectId, objectId),
        ),
      )
      .orderBy(asc(objectEvents.occurredAt)),

    db
      .select()
      .from(statusHistories)
      .where(
        and(
          eq(statusHistories.objectType, objectType),
          eq(statusHistories.objectId, objectId),
        ),
      )
      .orderBy(asc(statusHistories.changedAt)),

    db
      .select()
      .from(decisions)
      .where(
        and(
          eq(decisions.objectType, objectType),
          eq(decisions.objectId, objectId),
        ),
      )
      .orderBy(asc(decisions.createdAt)),

    db
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.ownerObjectType, mapObjectTypeToArtifactOwner(objectType)),
          eq(artifacts.ownerObjectId, objectId),
        ),
      )
      .orderBy(asc(artifacts.createdAt)),
  ]);

  const timeline = [
    ...events.map((e) => ({
      kind: 'event' as const,
      at: e.occurredAt,
      payload: e,
    })),
    ...histories.map((h) => ({
      kind: 'status_history' as const,
      at: h.changedAt,
      payload: h,
    })),
    ...objectDecisions.map((d) => ({
      kind: 'decision' as const,
      at: d.createdAt,
      payload: d,
    })),
    ...objectArtifacts.map((a) => ({
      kind: 'artifact' as const,
      at: a.createdAt,
      payload: a,
    })),
  ].sort((a, b) => {
    const ta = new Date(a.at).getTime();
    const tb = new Date(b.at).getTime();
    return ta - tb;
  });

  return {
    objectType,
    objectId,
    timeline,
  };
}

function mapObjectTypeToArtifactOwner(objectType: ReplayObjectType) {
  switch (objectType) {
    case 'run_session':
      return 'run_session';
    case 'review_packet':
      return 'review_packet';
    case 'release':
      return 'release';
    case 'incident':
      return 'incident';
    case 'spec':
      return 'spec_revision';
    case 'plan':
      return 'plan_revision';
    default:
      return 'run_session';
  }
}
```

---

# 8. `incident replay` 查询示例

对于 Incident，除了直接回放 Incident 自身事件外，更重要的是把关联对象一起拉出来。

## `queries/incident-replay-queries.ts`

```ts id="njj4jx"
// packages/db/src/queries/incident-replay-queries.ts
import { eq } from 'drizzle-orm';
import { db } from '../client';
import {
  incidents,
  incidentLinks,
  workItems,
  executionPackages,
  releases,
} from '../schema';
import { getObjectReplayTimeline } from './replay-queries';

export async function getIncidentReplay(incidentId: string) {
  const incident = await db.query.incidents.findFirst({
    where: eq(incidents.id, incidentId),
  });

  if (!incident) return null;

  const links = await db.query.incidentLinks.findMany({
    where: eq(incidentLinks.incidentId, incidentId),
  });

  const workItemIds = links
    .filter((l) => l.objectType === 'work_item')
    .map((l) => l.objectId);

  const packageIds = links
    .filter((l) => l.objectType === 'execution_package')
    .map((l) => l.objectId);

  const releaseIds = links
    .filter((l) => l.objectType === 'release')
    .map((l) => l.objectId);

  const [relatedWorkItems, relatedPackages, relatedReleases, incidentTimeline] =
    await Promise.all([
      workItemIds.length
        ? db.query.workItems.findMany({
            where: (table, { inArray }) => inArray(table.id, workItemIds),
          })
        : [],
      packageIds.length
        ? db.query.executionPackages.findMany({
            where: (table, { inArray }) => inArray(table.id, packageIds),
          })
        : [],
      releaseIds.length
        ? db.query.releases.findMany({
            where: (table, { inArray }) => inArray(table.id, releaseIds),
          })
        : [],
      getObjectReplayTimeline('incident', incidentId),
    ]);

  return {
    incident,
    links,
    relatedWorkItems,
    relatedPackages,
    relatedReleases,
    incidentTimeline,
  };
}
```

> 这段里 `findMany + inArray` 写法你可以根据实际 Drizzle 版本微调一下。这里主要是展示结构。

---

# 9. 你现在最适合补的 query 文件总览

到现在，我建议你 `queries/` 目录至少先长这样：

```text id="s29rde"
packages/db/src/queries/
  work-item-cockpit-queries.ts
  replay-queries.ts
  incident-replay-queries.ts
```

### 下一个值得补的

* `release-cockpit-queries.ts`

因为 Release 是另一个超级聚合页面。

---

# 10. 现在 schema 和 query 的职责边界已经比较清楚了

## schema 层负责

* 表定义
* 索引
* 唯一约束
* 普通 relations

## query 层负责

* cockpit read model
* replay timeline
* polymorphic joins
* timeline aggregation
* dashboard query

这就是比较健康的分层。

---

# 11. 你这套数据库设计到这里的状态

到这一步，你已经有：

## 定义对象

* WorkItem
* Spec / SpecRevision
* Plan / PlanRevision
* Contract / ContractRevision

## 执行对象

* ExecutionPackage
* RunSession

## 质量对象

* ReviewPacket
* TestEvidence

## 交付对象

* Release
* ReleaseWorkItem
* ReleaseExecutionPackage
* ReleaseEvidence

## 事故与回放对象

* Incident
* IncidentLink
* Artifact
* ObjectEvent
* StatusHistory
* Decision

## 聚合查询示例

* Work Item Cockpit
* Object Replay Timeline
* Incident Replay

这已经是一个非常完整的 V1 数据和读模型骨架了。

---

## 一句话总结

现在这套设计已经不只是“表设计”，而是开始进入 **真正能支撑产品页面和流程回放的读模型阶段**：
**contract 域补齐了多端协作约束，cockpit 查询补齐了主工作台，replay 查询补齐了进化主线。**

下一步最顺的是：我直接帮你把 **`release-cockpit-queries.ts`** 和 **`NestJS 中如何接这些 query functions`** 也写出来。
