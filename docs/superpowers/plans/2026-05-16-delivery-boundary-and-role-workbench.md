# Delivery Boundary And Role Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the historical P0 control-plane boundary with delivery/product modules, remove every active P0 subsystem surface, and add the first role workbench MVP with release-blocking Test/Acceptance gates.

**Architecture:** Move shared infrastructure first, then split the old service into focused command services behind semantic controllers. Keep release, automation, query, and shared provider modules independent so no module imports `DeliveryModule` just to reach shared infrastructure. Add role workbench projections only after the command boundaries and final route names are stable.

**Tech Stack:** TypeScript, NestJS, Zod, Drizzle/Postgres, Vitest, Supertest, React/Vite, pnpm workspaces.

---

## Scope Check

This spec touches several subsystems, but they are not independent once the hard requirement is applied: final acceptance requires one coordinated no-P0 migration across API, DB exports, scripts, docs, tests, web clients, and generated report names. Keep this as one plan, but execute it in narrow commits with verification after each boundary.

Do not implement executor runtime safety in this plan. Only relocate DI/provider wiring behavior-preservingly. Coordinate with the runtime-safety owner before deleting old repository names.

## Source Documents

- Spec: `docs/superpowers/specs/2026-05-16-delivery-boundary-and-role-workbench-design.md`
- PRD: `docs/PRD_v1.md`
- Runtime-safety spec owned by another person: `docs/superpowers/specs/2026-05-16-executor-runtime-safety-foundation-design.md`
- Active automation compatibility spec to update or supersede: `docs/superpowers/specs/2026-05-15-http-automation-daemon-mvp-design.md`

## File Structure

### Shared Infrastructure

- Create `apps/control-plane-api/src/modules/auth/auth.module.ts`
- Move `apps/control-plane-api/src/p0/actor-context.ts` to `apps/control-plane-api/src/modules/auth/actor-context.ts`
- Create `apps/control-plane-api/src/modules/http/http-support.module.ts`
- Move `apps/control-plane-api/src/p0/zod-validation.pipe.ts` to `apps/control-plane-api/src/modules/http/zod-validation.pipe.ts`
- Move `apps/control-plane-api/src/p0/domain-error.filter.ts` to `apps/control-plane-api/src/modules/http/domain-error.filter.ts`
- Create `apps/control-plane-api/src/modules/audit/audit.module.ts`
- Create `apps/control-plane-api/src/modules/audit/audit-writer.service.ts`
- Create `apps/control-plane-api/src/modules/query/projection.module.ts`
- Move `apps/control-plane-api/src/p0/run-session-serialization.ts` to `apps/control-plane-api/src/modules/query/public-run-session-projection.ts`
- Create `apps/control-plane-api/src/modules/run-control/run-worker.token.ts`
- Move `apps/control-plane-api/src/p0/run-worker-lifecycle.service.ts` to `apps/control-plane-api/src/modules/run-control/run-worker-lifecycle.service.ts`
- Create `apps/control-plane-api/src/modules/run-control/run-event-stream-token.ts`
- Move `apps/control-plane-api/src/p0/automation-command-helpers.ts` to `apps/control-plane-api/src/modules/automation/automation-command-helpers.ts`

### Delivery Command Modules

- Create `apps/control-plane-api/src/modules/delivery/delivery.module.ts`
- Create `apps/control-plane-api/src/modules/projects/projects.controller.ts`
- Create `apps/control-plane-api/src/modules/projects/project.service.ts`
- Create `apps/control-plane-api/src/modules/projects/projects.module.ts`
- Create `apps/control-plane-api/src/modules/work-items/work-items.controller.ts`
- Create `apps/control-plane-api/src/modules/work-items/work-item-types.ts`
- Create `apps/control-plane-api/src/modules/work-items/work-item.service.ts`
- Create `apps/control-plane-api/src/modules/work-items/work-items.module.ts`
- Create `apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts`
- Create `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`
- Create `apps/control-plane-api/src/modules/spec-plan/spec-plan.module.ts`
- Create `apps/control-plane-api/src/modules/execution-packages/execution-packages.controller.ts`
- Create `apps/control-plane-api/src/modules/execution-packages/execution-package.service.ts`
- Create `apps/control-plane-api/src/modules/execution-packages/execution-packages.module.ts`
- Create `apps/control-plane-api/src/modules/run-control/run-sessions.controller.ts`
- Create `apps/control-plane-api/src/modules/run-control/run-control.service.ts`
- Create `apps/control-plane-api/src/modules/run-control/run-control.module.ts`
- Create `apps/control-plane-api/src/modules/review-evidence/review-packets.controller.ts`
- Create `apps/control-plane-api/src/modules/review-evidence/review-evidence.service.ts`
- Create `apps/control-plane-api/src/modules/review-evidence/review-evidence.module.ts`
- Delete `apps/control-plane-api/src/p0/**` after all imports are moved.

### Existing Modules To Update

- Modify `apps/control-plane-api/src/app.module.ts`
- Modify `apps/control-plane-api/src/modules/core/control-plane-tokens.ts`
- Modify `apps/control-plane-api/src/modules/core/control-plane-core.module.ts`
- Modify `apps/control-plane-api/src/modules/core/control-plane-runtime.service.ts`
- Modify `apps/control-plane-api/src/modules/automation/automation-command.service.ts`
- Modify `apps/control-plane-api/src/modules/automation/automation.controller.ts`
- Modify `apps/control-plane-api/src/modules/automation/automation.module.ts`
- Create `apps/control-plane-api/src/modules/automation/automation-settings.controller.ts`
- Modify `apps/control-plane-api/src/modules/query/query.controller.ts`
- Modify `apps/control-plane-api/src/modules/query/query.service.ts`
- Modify `apps/control-plane-api/src/modules/query/query.module.ts`
- Modify `apps/control-plane-api/src/modules/release/release.controller.ts`
- Modify `apps/control-plane-api/src/modules/release/release.service.ts`
- Modify `apps/control-plane-api/src/modules/release/release.module.ts`

### Packages

- Rename `packages/db/src/repositories/p0-repository.ts` to `packages/db/src/repositories/delivery-repository.ts`
- Rename `packages/db/src/repositories/in-memory-p0-repository.ts` to `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Rename `packages/db/src/repositories/drizzle-p0-repository.ts` to `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Modify `packages/db/src/index.ts`
- Modify `packages/db/src/schema/_shared.ts`
- Modify `packages/domain/src/types.ts`
- Modify `packages/domain/src/validators.ts`
- Modify `packages/contracts/src/api.ts`
- Modify `packages/contracts/src/index.ts`
- Modify `packages/contracts/src/release.ts`
- Modify `apps/workflow-worker/src/worker.ts`

### Web

- Modify `apps/web/src/api/types.ts`
- Modify `apps/web/src/api/commands.ts`
- Modify `apps/web/src/api/query.ts`
- Modify `apps/web/src/workbenchState.ts`
- Modify `apps/web/src/App.tsx`
- Modify `apps/web/src/styles.css`

### Tests

- Rename `tests/helpers/p0-runtime-fixtures.ts` to `tests/helpers/delivery-runtime-fixtures.ts`
- Rename `tests/smoke/p0-smoke.test.ts` to `tests/smoke/delivery-smoke.test.ts`
- Rename `tests/smoke/p0-dogfood-script.test.ts` to `tests/smoke/delivery-dogfood-script.test.ts`
- Rename `tests/smoke/p0-dogfood-work-items-script.test.ts` to `tests/smoke/delivery-dogfood-work-items-script.test.ts`
- Rename `tests/smoke/p0-durable-dogfood-script.test.ts` to `tests/smoke/delivery-durable-dogfood-script.test.ts`
- Rename `tests/smoke/p0-local-codex-dogfood-script.test.ts` to `tests/smoke/delivery-local-codex-dogfood-script.test.ts`
- Create `tests/api/work-items.test.ts`
- Create `tests/api/delivery-route-contract.test.ts`
- Create `tests/api/test-acceptance-gate.test.ts`
- Create `tests/api/role-workbenches.test.ts`
- Create `tests/naming/delivery-naming.test.ts`
- Modify existing `tests/api/*.test.ts`, `tests/db/*.test.ts`, `tests/smoke/*.test.ts`, `tests/web/*.test.ts`.

### Scripts And Docs

- Rename `scripts/p0-dogfood.ts` to `scripts/delivery-dogfood.ts`
- Rename `scripts/p0-durable-dogfood.ts` to `scripts/delivery-durable-dogfood.ts`
- Rename `scripts/p0-local-codex-dogfood.ts` to `scripts/delivery-local-codex-dogfood.ts`
- Rename `scripts/p0-dogfood-work-items.ts` to `scripts/delivery-dogfood-work-items.ts`
- Modify `package.json`
- Modify `tests/bootstrap.test.ts`
- Rename `docs/dogfood/p0-dogfood-work-items.md` to `docs/dogfood/delivery-dogfood-work-items.md`
- Rename or supersede active reports/runbooks/specs/plans containing old P0 subsystem names.

---

## Task 1: Repository And Core Token Rename

**Files:**
- Rename: `packages/db/src/repositories/p0-repository.ts` -> `packages/db/src/repositories/delivery-repository.ts`
- Rename: `packages/db/src/repositories/in-memory-p0-repository.ts` -> `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Rename: `packages/db/src/repositories/drizzle-p0-repository.ts` -> `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Modify: `apps/control-plane-api/src/modules/core/control-plane-tokens.ts`
- Modify: `apps/control-plane-api/src/modules/core/control-plane-core.module.ts`
- Modify: `apps/control-plane-api/src/modules/core/control-plane-runtime.service.ts`
- Modify: `apps/workflow-worker/src/worker.ts`
- Modify: `tests/db/repository-contract.ts`
- Modify: `tests/db/repository.test.ts`
- Modify: `tests/db/automation-repository.test.ts`
- Test: `tests/db/repository.test.ts`
- Test: `tests/db/automation-repository.test.ts`
- Test: `tests/workflow-worker/worker.test.ts`

- [ ] **Step 1: Write the failing repository naming test**

Create `tests/db/delivery-repository-naming.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as db from '../../packages/db/src/index';

describe('delivery repository public exports', () => {
  it('exports delivery repository names without historical subsystem names', () => {
    expect(db).toHaveProperty('InMemoryDeliveryRepository');
    expect(db).toHaveProperty('DrizzleDeliveryRepository');
    expect(db).toHaveProperty('createDrizzleDeliveryRepository');
    expect(db).not.toHaveProperty('InMemoryP0Repository');
    expect(db).not.toHaveProperty('DrizzleP0Repository');
    expect(db).not.toHaveProperty('createDrizzleP0Repository');
  });
});
```

- [ ] **Step 2: Run the naming test and verify it fails**

Run: `pnpm vitest run tests/db/delivery-repository-naming.test.ts`

Expected: FAIL because `InMemoryDeliveryRepository` is not exported yet.

- [ ] **Step 3: Resolve runtime-safety dependency gate before repository rename**

Before moving repository filenames, check the parallel runtime-safety work and update/supersede active references that would break on rename:

```bash
rg -n "p0-repository|P0Repository|InMemoryP0Repository|DrizzleP0Repository|createDrizzleP0Repository|P0_REPOSITORY" docs/superpowers/specs/2026-05-16-executor-runtime-safety-foundation-design.md docs/superpowers/plans apps packages tests
```

Expected: only this delivery-boundary migration plan/spec and explicitly superseded historical notes may still mention old repository names.

If the runtime-safety owner has an active branch or plan still targeting `p0-repository.ts` or `P0Repository`, update that active plan/spec reference to `delivery-repository.ts` / `DeliveryRepository` first, or pause this task until the owner confirms the rename target. Do not create compatibility re-exports for the old repository names.

- [ ] **Step 4: Rename repository files with git mv**

Run:

```bash
git mv packages/db/src/repositories/p0-repository.ts packages/db/src/repositories/delivery-repository.ts
git mv packages/db/src/repositories/in-memory-p0-repository.ts packages/db/src/repositories/in-memory-delivery-repository.ts
git mv packages/db/src/repositories/drizzle-p0-repository.ts packages/db/src/repositories/drizzle-delivery-repository.ts
```

Expected: files move with history preserved.

- [ ] **Step 5: Rename repository symbols**

In `packages/db/src/repositories/delivery-repository.ts`:

```ts
export interface DeliveryRepository {
  withDeliveryTransaction<T>(write: (repository: DeliveryRepository) => Promise<T>): Promise<T>;
  withObjectLock<T>(key: string, write: (repository: DeliveryRepository) => Promise<T>): Promise<T>;
  // keep every existing repository method unchanged below this point
}
```

In `packages/db/src/repositories/in-memory-delivery-repository.ts`, rename:

```ts
export class InMemoryDeliveryRepository implements DeliveryRepository {
  async withDeliveryTransaction<T>(write: (repository: DeliveryRepository) => Promise<T>): Promise<T> {
    return write(this);
  }
}
```

In `packages/db/src/repositories/drizzle-delivery-repository.ts`, rename:

```ts
export class DrizzleDeliveryRepository implements DeliveryRepository {
  async withDeliveryTransaction<T>(write: (repository: DeliveryRepository) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => write(new DrizzleDeliveryRepository(tx as ForgeloopDrizzleDatabase)));
  }
}

export const createDrizzleDeliveryRepository = (db: ForgeloopDrizzleDatabase): DeliveryRepository =>
  new DrizzleDeliveryRepository(db);
```

Also rename lock keys containing `p0-transaction` to delivery/product lock keys.

- [ ] **Step 6: Update package exports**

In `packages/db/src/index.ts`:

```ts
export * from './client';
export * from './repositories/delivery-repository';
export * from './repositories/object-lock';
export * from './repositories/in-memory-delivery-repository';
export * from './repositories/drizzle-delivery-repository';
export * from './schema';
export * from './queries/work-item-cockpit-queries';
export * from './queries/release-cockpit-queries';
export * from './queries/release-public-link-visibility';
export * from './queries/replay-queries';
export * from './queries/public-evidence-serialization';
export * from './reset';
```

- [ ] **Step 7: Update core tokens**

In `apps/control-plane-api/src/modules/core/control-plane-tokens.ts`:

```ts
export const DELIVERY_REPOSITORY = Symbol('DELIVERY_REPOSITORY');
export const RUN_DURABILITY_MODE = Symbol('RUN_DURABILITY_MODE');
```

In `apps/control-plane-api/src/modules/core/control-plane-core.module.ts`, import `createDrizzleDeliveryRepository`, `InMemoryDeliveryRepository`, and `DeliveryRepository`, then provide/export `DELIVERY_REPOSITORY` and `RUN_DURABILITY_MODE`. Do not add actor identity fallback tokens; run operator identity must come from authenticated actor headers.

- [ ] **Step 8: Rename durable id and workflow worker strings**

In `apps/control-plane-api/src/modules/core/control-plane-runtime.service.ts`:

```ts
const uuidBackedDeliveryIdPrefixes = new Set([
  'project',
  'work-item',
  'spec',
  'spec-revision',
  'plan',
  'plan-revision',
  'execution-package',
  'run-session',
  'decision',
]);
```

In `apps/workflow-worker/src/worker.ts`:

```ts
export const DEFAULT_TASK_QUEUE = 'forgeloop-delivery-package-execution';
```

Update dynamic imports to call `createDrizzleDeliveryRepository`.

- [ ] **Step 9: Update imports in tests and packages**

Use `rg "P0Repository|InMemoryP0Repository|DrizzleP0Repository|createDrizzleP0Repository|P0_REPOSITORY|withP0Transaction|uuidBackedP0IdPrefixes|forgeloop-p0-package-execution"` to find all call sites.

Replace them with delivery names. Do not change `priority: 'P0'` literals.

- [ ] **Step 10: Run focused repository and worker tests**

Run:

```bash
pnpm vitest run tests/db/delivery-repository-naming.test.ts tests/db/repository.test.ts tests/db/automation-repository.test.ts tests/workflow-worker/worker.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/db apps/control-plane-api/src/modules/core apps/workflow-worker tests/db tests/workflow-worker
git commit -m "refactor: rename delivery repository boundary"
```

---

## Task 2: Shared Infrastructure Modules

**Files:**
- Create: `apps/control-plane-api/src/modules/auth/auth.module.ts`
- Move: `apps/control-plane-api/src/p0/actor-context.ts` -> `apps/control-plane-api/src/modules/auth/actor-context.ts`
- Create: `apps/control-plane-api/src/modules/http/http-support.module.ts`
- Move: `apps/control-plane-api/src/p0/zod-validation.pipe.ts` -> `apps/control-plane-api/src/modules/http/zod-validation.pipe.ts`
- Move: `apps/control-plane-api/src/p0/domain-error.filter.ts` -> `apps/control-plane-api/src/modules/http/domain-error.filter.ts`
- Create: `apps/control-plane-api/src/modules/audit/audit.module.ts`
- Create: `apps/control-plane-api/src/modules/audit/audit-writer.service.ts`
- Create: `apps/control-plane-api/src/modules/query/projection.module.ts`
- Move: `apps/control-plane-api/src/p0/run-session-serialization.ts` -> `apps/control-plane-api/src/modules/query/public-run-session-projection.ts`
- Create: `apps/control-plane-api/src/modules/run-control/run-worker.token.ts`
- Move: `apps/control-plane-api/src/p0/run-worker-lifecycle.service.ts` -> `apps/control-plane-api/src/modules/run-control/run-worker-lifecycle.service.ts`
- Create: `apps/control-plane-api/src/modules/run-control/run-event-stream-token.ts`
- Move: `apps/control-plane-api/src/p0/automation-command-helpers.ts` -> `apps/control-plane-api/src/modules/automation/automation-command-helpers.ts`
- Modify: `apps/control-plane-api/src/app.module.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation.controller.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.service.ts`
- Modify: `apps/control-plane-api/src/modules/release/release.controller.ts`
- Test: `tests/api/query-module.test.ts`
- Test: `tests/api/run-session-serialization.test.ts`
- Test: `tests/api/run-worker-lifecycle.test.ts`
- Test: `tests/api/automation-internal-auth.test.ts`

- [ ] **Step 1: Write the failing shared import boundary test**

Create `tests/api/shared-infrastructure-boundary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('shared infrastructure boundary', () => {
  it('exports shared providers from product-neutral modules', async () => {
    await expect(import('../../apps/control-plane-api/src/modules/auth/actor-context')).resolves.toHaveProperty('actorContextFromHeaders');
    await expect(import('../../apps/control-plane-api/src/modules/http/zod-validation.pipe')).resolves.toHaveProperty('ZodValidationPipe');
    await expect(import('../../apps/control-plane-api/src/modules/http/domain-error.filter')).resolves.toHaveProperty('DomainErrorFilter');
    await expect(import('../../apps/control-plane-api/src/modules/query/public-run-session-projection')).resolves.toHaveProperty(
      'PublicRunSessionProjection',
    );
  });
});
```

- [ ] **Step 2: Run the shared import test and verify it fails**

Run: `pnpm vitest run tests/api/shared-infrastructure-boundary.test.ts`

Expected: FAIL because target modules do not exist.

- [ ] **Step 3: Move shared files with git mv**

Run:

```bash
mkdir -p apps/control-plane-api/src/modules/auth apps/control-plane-api/src/modules/http apps/control-plane-api/src/modules/audit apps/control-plane-api/src/modules/run-control
git mv apps/control-plane-api/src/p0/actor-context.ts apps/control-plane-api/src/modules/auth/actor-context.ts
git mv apps/control-plane-api/src/p0/zod-validation.pipe.ts apps/control-plane-api/src/modules/http/zod-validation.pipe.ts
git mv apps/control-plane-api/src/p0/domain-error.filter.ts apps/control-plane-api/src/modules/http/domain-error.filter.ts
git mv apps/control-plane-api/src/p0/run-session-serialization.ts apps/control-plane-api/src/modules/query/public-run-session-projection.ts
git mv apps/control-plane-api/src/p0/run-worker-lifecycle.service.ts apps/control-plane-api/src/modules/run-control/run-worker-lifecycle.service.ts
git mv apps/control-plane-api/src/p0/automation-command-helpers.ts apps/control-plane-api/src/modules/automation/automation-command-helpers.ts
```

- [ ] **Step 4: Create shared modules**

`apps/control-plane-api/src/modules/auth/auth.module.ts`:

```ts
import { Module } from '@nestjs/common';

@Module({})
export class AuthModule {}
```

`apps/control-plane-api/src/modules/http/http-support.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { DomainErrorFilter } from './domain-error.filter';
import { ZodValidationPipe } from './zod-validation.pipe';

@Module({
  providers: [{ provide: APP_FILTER, useClass: DomainErrorFilter }, ZodValidationPipe],
  exports: [DomainErrorFilter, ZodValidationPipe],
})
export class HttpSupportModule {}
```

`apps/control-plane-api/src/modules/query/projection.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { PublicRunSessionProjection } from './public-run-session-projection';

@Module({
  providers: [PublicRunSessionProjection],
  exports: [PublicRunSessionProjection],
})
export class ProjectionModule {}
```

- [ ] **Step 5: Convert run session serialization to injectable projection**

In `apps/control-plane-api/src/modules/query/public-run-session-projection.ts`, keep the existing serialization function and add:

```ts
import { Injectable } from '@nestjs/common';
import type { RunSession } from '@forgeloop/domain';

@Injectable()
export class PublicRunSessionProjection {
  serialize(runSession: RunSession): RunSession {
    return serializePublicRunSession(runSession);
  }
}
```

- [ ] **Step 6: Create AuditWriterService**

`apps/control-plane-api/src/modules/audit/audit-writer.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Decision, ObjectEvent, StatusHistory } from '@forgeloop/domain';
import type { DeliveryRepository, TraceArtifactRefRecord, TraceEventRecord, TraceLinkRecord } from '@forgeloop/db';

import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';

@Injectable()
export class AuditWriterService {
  constructor(@Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository) {}

  async objectEvent(event: ObjectEvent, repository: DeliveryRepository = this.repository): Promise<void> {
    await repository.saveObjectEvent(event);
  }

  async statusHistory(row: StatusHistory, repository: DeliveryRepository = this.repository): Promise<void> {
    await repository.saveStatusHistory(row);
  }

  async decision(decision: Decision, repository: DeliveryRepository = this.repository): Promise<void> {
    await repository.saveDecision(decision);
  }

  async traceLink(link: TraceLinkRecord, repository: DeliveryRepository = this.repository): Promise<void> {
    await repository.saveTraceLink(link);
  }

  async traceEvent(event: TraceEventRecord, repository: DeliveryRepository = this.repository): Promise<void> {
    await repository.saveTraceEvent(event);
  }

  async traceArtifactRef(ref: TraceArtifactRefRecord, repository: DeliveryRepository = this.repository): Promise<void> {
    await repository.saveTraceArtifactRef(ref);
  }
}
```

`apps/control-plane-api/src/modules/audit/audit.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { AuditWriterService } from './audit-writer.service';

@Module({
  imports: [ControlPlaneCoreModule],
  providers: [AuditWriterService],
  exports: [AuditWriterService],
})
export class AuditModule {}
```

- [ ] **Step 7: Create run worker token and token helper module files**

`apps/control-plane-api/src/modules/run-control/run-worker.token.ts`:

```ts
export const DELIVERY_RUN_WORKER = Symbol('DELIVERY_RUN_WORKER');
```

Move stream token helper functions out of `actor-context.ts` into `apps/control-plane-api/src/modules/run-control/run-event-stream-token.ts`; keep exported names unchanged unless they include old subsystem names.

- [ ] **Step 8: Update imports**

Run:

```bash
rg "src/p0|\\.\\./\\.\\./p0|\\.\\./p0|p0/" apps tests packages scripts
```

Update imports to the new module paths. Keep `apps/control-plane-api/src/p0/p0.service.ts` imports temporarily if the file still exists during staged extraction.

- [ ] **Step 9: Update AppModule**

In `apps/control-plane-api/src/app.module.ts`, add `HttpSupportModule` to imports and remove the direct `APP_FILTER` provider from `AppModule`:

```ts
import { HttpSupportModule } from './modules/http/http-support.module';

@Module({
  imports: [HttpSupportModule, P0Module, QueryModule, ReleaseModule, AutomationModule],
})
export class AppModule {}
```

- [ ] **Step 10: Run focused shared infrastructure tests**

Run:

```bash
pnpm vitest run tests/api/shared-infrastructure-boundary.test.ts tests/api/query-module.test.ts tests/api/run-session-serialization.test.ts tests/api/run-worker-lifecycle.test.ts tests/api/automation-internal-auth.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/control-plane-api/src/modules apps/control-plane-api/src/app.module.ts tests/api
git commit -m "refactor: move delivery shared infrastructure"
```

---

## Task 3: Project And Work Item Services

**Files:**
- Create: `apps/control-plane-api/src/modules/projects/projects.module.ts`
- Create: `apps/control-plane-api/src/modules/projects/projects.controller.ts`
- Create: `apps/control-plane-api/src/modules/projects/project.service.ts`
- Create: `apps/control-plane-api/src/modules/work-items/work-items.module.ts`
- Create: `apps/control-plane-api/src/modules/work-items/work-items.controller.ts`
- Create: `apps/control-plane-api/src/modules/work-items/work-item.service.ts`
- Create: `apps/control-plane-api/src/modules/work-items/work-item-types.ts`
- Modify: `apps/control-plane-api/src/p0/dto.ts` or move DTOs to `apps/control-plane-api/src/modules/delivery/dto.ts`
- Modify: `packages/domain/src/types.ts`
- Modify: `packages/domain/src/validators.ts`
- Modify: `packages/db/src/schema/_shared.ts`
- Modify: `apps/control-plane-api/src/modules/delivery/delivery.module.ts`
- Test: `tests/api/work-items.test.ts`
- Test: `tests/api/delivery-flow.test.ts`

- [ ] **Step 1: Write failing Work Item type and readiness tests**

Create `tests/api/work-items.test.ts`:

```ts
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';

describe('Work Item product API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });
});
```

Use the existing app setup pattern from `tests/api/delivery-flow.test.ts`. Add these assertions:

```ts
it('lists Initiative, Requirement, Bug, and Tech Debt work item types', async () => {
  const response = await request(app.getHttpServer()).get('/work-item-types').expect(200);
  expect(response.body.map((item: { kind: string }) => item.kind)).toEqual(['initiative', 'requirement', 'bug', 'tech_debt']);
});

it('creates and updates initiative readiness fields', async () => {
  const project = (await request(app.getHttpServer()).post('/projects').send({ name: 'Forgeloop' }).expect(201)).body;
  const created = (
    await request(app.getHttpServer())
      .post('/work-items')
      .send({
        project_id: project.id,
        kind: 'initiative',
        title: 'Launch role workbench',
        goal: 'Close the MVP delivery loop.',
        success_criteria: ['Owner can move from intake to spec.'],
        priority: 'P0',
        risk: 'high',
        owner_actor_id: 'actor-owner',
      })
      .expect(201)
  ).body;

  const updated = (
    await request(app.getHttpServer())
      .patch(`/work-items/${created.id}`)
      .send({
        goal: 'Close the delivery-loop MVP.',
        success_criteria: ['Intake actions point to real routes.'],
        priority: 'P0',
        risk: 'medium',
        owner_actor_id: 'actor-owner-2',
      })
      .expect(200)
  ).body;

  expect(updated.kind).toBe('initiative');
  expect(updated.risk).toBe('medium');
  expect(updated.owner_actor_id).toBe('actor-owner-2');
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm vitest run tests/api/work-items.test.ts`

Expected: FAIL because `initiative`, `/work-item-types`, and `PATCH /work-items/:id` are missing.

- [ ] **Step 3: Add initiative to domain and DB enum values**

In `packages/domain/src/types.ts`:

```ts
export const workItemKinds = ['initiative', 'requirement', 'bug', 'tech_debt'] as const;
```

In `packages/db/src/schema/_shared.ts`:

```ts
export const work_item_kind_values = ['initiative', 'requirement', 'bug', 'tech_debt'] as const;
```

Update any schema tests that assert the exact enum list.

For durable Postgres environments, include the enum update in the normal schema update path before running durable dogfood. Use the repository's existing Drizzle migration or schema-push workflow, and verify the durable database accepts `kind: 'initiative'` by running the Work Item API test against durable mode before final smoke.

- [ ] **Step 4: Create work item type metadata**

`apps/control-plane-api/src/modules/work-items/work-item-types.ts`:

```ts
import type { WorkItemKind } from '@forgeloop/domain';

export interface WorkItemTypeMetadata {
  kind: WorkItemKind;
  label: string;
  description: string;
  required_fields: string[];
  default_priority: string;
  default_risk: string;
  spec_guidance: string;
  plan_guidance: string;
  recommended_next_actions: string[];
  role_hints: {
    approver?: string;
    execution_owner?: string;
    reviewer?: string;
    qa_owner?: string;
    release_owner?: string;
  };
}

const requiredFields = ['project_id', 'title', 'goal', 'success_criteria', 'priority', 'risk', 'owner_actor_id'];

export const workItemTypeMetadata: WorkItemTypeMetadata[] = [
  { kind: 'initiative', label: 'Initiative', description: 'A larger product or business outcome.', required_fields: requiredFields, default_priority: 'P1', default_risk: 'medium', spec_guidance: 'Define outcome, scope, and success criteria.', plan_guidance: 'Split into independently verifiable packages.', recommended_next_actions: ['create_spec', 'generate_spec_draft'], role_hints: {} },
  { kind: 'requirement', label: 'Requirement', description: 'A concrete product or engineering requirement.', required_fields: requiredFields, default_priority: 'P1', default_risk: 'medium', spec_guidance: 'Make acceptance criteria testable.', plan_guidance: 'Map implementation steps to checks.', recommended_next_actions: ['create_spec', 'generate_spec_draft'], role_hints: {} },
  { kind: 'bug', label: 'Bug', description: 'A defect or regression needing diagnosis and fix.', required_fields: requiredFields, default_priority: 'P0', default_risk: 'high', spec_guidance: 'Describe impact, reproduction, and expected behavior.', plan_guidance: 'Include regression coverage.', recommended_next_actions: ['create_spec', 'generate_spec_draft'], role_hints: { qa_owner: 'QA/Test Owner should confirm regression coverage.' } },
  { kind: 'tech_debt', label: 'Tech Debt', description: 'A maintainability or architecture improvement.', required_fields: requiredFields, default_priority: 'P2', default_risk: 'medium', spec_guidance: 'State current cost and desired invariant.', plan_guidance: 'Keep migration steps reversible.', recommended_next_actions: ['create_spec', 'generate_spec_draft'], role_hints: { reviewer: 'Reviewer should focus on behavior preservation.' } },
];
```

- [ ] **Step 5: Create ProjectService and ProjectsController**

Move `createProject`, `getProject`, `createProjectRepo`, and `listProjectRepos` logic from the old service into `ProjectService`. Use `AuditWriterService` for object events.

`ProjectsController` routes:

```ts
@Post('projects')
createProject(@Body(new ZodValidationPipe(createProjectSchema)) body: CreateProjectDto) {
  return this.projectService.createProject(body);
}

@Get('projects/:projectId')
getProject(@Param('projectId') projectId: string) {
  return this.projectService.getProject(projectId);
}
```

Also add `POST /projects/:projectId/repos` and `GET /projects/:projectId/repos`.

- [ ] **Step 6: Create WorkItemService and WorkItemsController**

Move `createWorkItem`, `getWorkItem`, and `listWorkItems` logic into `WorkItemService`.

Add `updateWorkItem`:

```ts
async updateWorkItem(workItemId: string, dto: UpdateWorkItemDto): Promise<WorkItem> {
  const workItem = await this.repository.getWorkItem(workItemId);
  if (workItem === undefined) throw new NotFoundException(`WorkItem ${workItemId} not found`);
  const updated: WorkItem = Object.assign({}, workItem, dto, { updated_at: this.runtime.now() });
  await this.repository.saveWorkItem(updated);
  await this.audit.objectEvent({
    id: this.runtime.id('object-event'),
    object_type: 'work_item',
    object_id: updated.id,
    event_type: 'work_item_updated',
    actor_id: dto.owner_actor_id ?? workItem.owner_actor_id,
    metadata: {},
    created_at: this.runtime.now(),
  });
  return updated;
}
```

Use the repository's actual `ObjectEvent` shape when implementing.

- [ ] **Step 7: Add DTO schema for Work Item update**

Add:

```ts
export const updateWorkItemSchema = z
  .object({
    goal: nonEmptyString.optional(),
    success_criteria: stringList.optional(),
    priority: nonEmptyString.optional(),
    risk: nonEmptyString.optional(),
    owner_actor_id: nonEmptyString.optional(),
    phase: z.enum(workItemPhases).optional(),
  })
  .strict();
export type UpdateWorkItemDto = z.infer<typeof updateWorkItemSchema>;
```

- [ ] **Step 8: Wire modules into DeliveryModule and AppModule**

Create `DeliveryModule` importing `ProjectsModule` and `WorkItemsModule`. For this task, AppModule may still import old modules until later extraction completes, but do not add any new old-prefix route.

- [ ] **Step 9: Run focused tests**

Run:

```bash
pnpm vitest run tests/api/work-items.test.ts tests/api/delivery-flow.test.ts tests/domain/validators.test.ts tests/db/schema.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/domain packages/db apps/control-plane-api/src/modules/projects apps/control-plane-api/src/modules/work-items apps/control-plane-api/src/modules/delivery tests/api tests/domain tests/db
git commit -m "feat: add delivery project and work item services"
```

---

## Task 4: SpecPlanService

**Files:**
- Create: `apps/control-plane-api/src/modules/spec-plan/spec-plan.module.ts`
- Create: `apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts`
- Create: `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`
- Modify: `apps/control-plane-api/src/modules/delivery/delivery.module.ts`
- Modify: `tests/api/delivery-flow.test.ts`
- Create: `tests/api/spec-plan-service.test.ts`

- [ ] **Step 1: Write failing Spec/Plan service tests**

Create `tests/api/spec-plan-service.test.ts` with the app setup from `tests/api/delivery-flow.test.ts`. Add tests that create a Work Item and exercise:

```ts
await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201);
await request(server).post(`/specs/${spec.id}/revisions`).send(validSpecRevision).expect(201);
await request(server).post(`/specs/${spec.id}/submit-for-approval`).set(ownerHeaders).send({ actor_id: actorOwner }).expect(201);
await request(server).post(`/specs/${spec.id}/approve`).set(reviewerHeaders).send({ actor_id: actorReviewer }).expect(201);
await request(server).post(`/work-items/${workItem.id}/plans`).send({}).expect(201);
await request(server).post(`/plans/${plan.id}/generate-draft`).send({}).expect(201);
```

Assert that Work Item phase/gate state changes after approvals.

- [ ] **Step 2: Run test and verify it fails when controller is pointed away from old service**

Run: `pnpm vitest run tests/api/spec-plan-service.test.ts`

Expected: FAIL until `SpecPlanService` is wired.

- [ ] **Step 3: Move Spec/Plan methods from old service**

Move these methods and helper dependencies from the old service into `SpecPlanService`:

- `createSpec`
- `getSpec`
- `listSpecRevisions`
- `getSpecRevision`
- `createSpecRevision`
- `generateSpecDraft`
- `submitSpecForApproval`
- `approveSpec`
- `requestSpecChanges`
- `createPlan`
- `getPlan`
- `listPlanRevisions`
- `getPlanRevision`
- `createPlanRevision`
- `generatePlanDraft`
- `submitPlanForApproval`
- `approvePlan`
- `requestPlanChanges`
- `updateWorkItemForSpecPlan`
- `saveSpecRevision`
- `savePlanRevision`

Inject `DeliveryRepository`, `ControlPlaneRuntimeService`, and `AuditWriterService`.

- [ ] **Step 4: Create SpecPlanController**

Use the exact route table from the spec. Example:

```ts
@Post('work-items/:workItemId/specs')
createSpec(@Param('workItemId') workItemId: string) {
  return this.specPlanService.createSpec(workItemId);
}

@Post('specs/:specId/approve')
approveSpec(
  @Param('specId') specId: string,
  @Body(new ZodValidationPipe(actorCommandSchema)) body: ActorCommandDto,
  @Headers() headers: Record<string, string | string[] | undefined>,
) {
  return this.specPlanService.approveSpec(specId, body, actorContextFromHeaders(headers));
}
```

- [ ] **Step 5: Use AuditWriterService for object events, status history, and decisions**

Replace local event/history/decision helpers with `AuditWriterService`. Keep best-effort trace semantics unchanged.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm vitest run tests/api/spec-plan-service.test.ts tests/api/delivery-flow.test.ts tests/api/automation-commands.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/control-plane-api/src/modules/spec-plan apps/control-plane-api/src/modules/delivery tests/api
git commit -m "refactor: extract spec and plan service"
```

---

## Task 5: ExecutionPackageService

**Files:**
- Create: `apps/control-plane-api/src/modules/execution-packages/execution-packages.module.ts`
- Create: `apps/control-plane-api/src/modules/execution-packages/execution-packages.controller.ts`
- Create: `apps/control-plane-api/src/modules/execution-packages/execution-package.service.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation-command.service.ts`
- Modify: `tests/api/delivery-flow.test.ts`
- Create: `tests/api/execution-package-service.test.ts`

- [ ] **Step 1: Write failing execution package tests**

Create `tests/api/execution-package-service.test.ts`. Seed approved Spec and Plan using API helpers. Assert:

```ts
await request(server).post(`/plan-revisions/${planRevisionId}/generate-packages`).send({}).expect(201);
await request(server).post(`/plan-revisions/${planRevisionId}/execution-packages`).send(validPackageBody).expect(201);
await request(server).patch(`/execution-packages/${packageId}`).send({ objective: 'Updated objective' }).expect(200);
await request(server).post(`/execution-packages/${packageId}/mark-ready`).set(ownerHeaders).send({ actor_id: actorOwner, expected_package_version: 1 }).expect(201);
```

Also test stale package version and open ReviewPacket edit blocking.

- [ ] **Step 2: Run the test and verify it fails before extraction is wired**

Run: `pnpm vitest run tests/api/execution-package-service.test.ts`

Expected: FAIL until controller/service exists.

- [ ] **Step 3: Move package lifecycle methods**

Move these from the old service:

- `generatePackages`
- `createExecutionPackage`
- `listExecutionPackages`
- `getExecutionPackage`
- `patchExecutionPackage`
- `markPackageReady`
- `packageContextFromRepository`
- `requireApprovedCurrentSpecFromRepository`
- `assertExecutionPackageGraphStillCurrent`
- `createExecutionPackageFromContext`
- `defaultPackagePolicyFields`

Rename policy digests and URIs:

```ts
policyDigest: 'delivery-default-policy'
policySourcePath: 'forgeloop://delivery/default-package-policy'
policyDigest: 'delivery-manual-package-policy'
policySourcePath: 'forgeloop://delivery/manual-package-policy'
```

- [ ] **Step 4: Keep runtime safety boundary narrow**

Only validate control-plane package fields already present in the domain model. Do not add path policy parsing, command validation, resource governors, hook behavior, fallback behavior, artifact redaction, or attestation semantics.

- [ ] **Step 5: Update AutomationCommandService to reuse package helpers or duplicate only pure control-plane checks**

Do not call old service or import from old namespace. If shared helper code is needed, move pure helper functions to `apps/control-plane-api/src/modules/execution-packages/package-policy-fields.ts`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm vitest run tests/api/execution-package-service.test.ts tests/api/automation-commands.test.ts tests/domain/validators.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/control-plane-api/src/modules/execution-packages apps/control-plane-api/src/modules/automation tests/api tests/domain
git commit -m "refactor: extract execution package service"
```

---

## Task 6: RunControlService And Worker Provider

**Files:**
- Create: `apps/control-plane-api/src/modules/run-control/run-control.module.ts`
- Create: `apps/control-plane-api/src/modules/run-control/run-control.service.ts`
- Create: `apps/control-plane-api/src/modules/run-control/execution-package-runs.controller.ts`
- Create: `apps/control-plane-api/src/modules/run-control/run-sessions.controller.ts`
- Modify: `apps/control-plane-api/src/modules/run-control/run-worker-lifecycle.service.ts`
- Modify: `apps/control-plane-api/src/modules/run-control/run-worker.token.ts`
- Modify: `apps/control-plane-api/src/modules/delivery/delivery.module.ts`
- Modify: `tests/api/run-events.test.ts`
- Modify: `tests/api/run-auth.test.ts`
- Modify: `tests/api/async-run.test.ts`
- Modify: `tests/api/delivery-flow.test.ts`
- Modify: `tests/e2e/run-console.e2e.test.ts`

- [ ] **Step 1: Write failing provider token test**

Create `tests/api/run-control-boundary.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';

describe('RunControl boundary', () => {
  it('provides the run worker through the delivery run-control token', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DELIVERY_RUN_WORKER)
      .useValue({ kick: () => undefined, drainOnce: async () => undefined })
      .compile();

    expect(moduleRef.get(DELIVERY_RUN_WORKER)).toBeDefined();
  });

  it('keeps run, rerun, and force-rerun package routes outside the old namespace', async () => {
    const routes = readFileSync('apps/control-plane-api/src/modules/run-control/execution-package-runs.controller.ts', 'utf8');
    expect(routes).toContain("@Post('execution-packages/:packageId/run')");
    expect(routes).toContain("@Post('execution-packages/:packageId/rerun')");
    expect(routes).toContain("@Post('execution-packages/:packageId/force-rerun')");
    expect(routes).not.toContain("@Controller('p0");
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run: `pnpm vitest run tests/api/run-control-boundary.test.ts`

Expected: FAIL until the token and module are wired.

- [ ] **Step 3: Move run-worker provider factory into RunControlModule**

Move `createRunWorker`, `mockSelfReview`, `mockEvidence`, `safePathSegment`, and `evidenceChangedFilePath` from the old module to `RunControlModule`. This is a behavior-preserving DI relocation only.

Provider:

```ts
{
  provide: DELIVERY_RUN_WORKER,
  useFactory: createRunWorker,
  inject: [DELIVERY_REPOSITORY],
}
```

- [ ] **Step 4: Move run command and event methods**

Move these from the old service into `RunControlService`:

- `runPackage`
- `runPackageWithRepository`
- `runPackageReplacementContext`
- `getRunSession`
- `listRunEvents`
- `streamRunEvents`
- `resolveRunEventStreamCursor`
- `assertRunEventViewer`
- `createRunInputCommand`
- `createRunCancelCommand`
- `createRunResumeCommand`
- `createRunEventStreamToken`
- `withWorkerLeaseMetadata`
- `assertRunViewerAllowed`
- `assertRunOperatorAllowed`
- `createRunOperatorCommand`
- `enqueueRunWithRepository`
- `recordRunReplacementTrace`

- [ ] **Step 5: Create package run controller and RunSessionsController**

Create `apps/control-plane-api/src/modules/run-control/execution-package-runs.controller.ts` with exact routes:

```ts
@Post('execution-packages/:packageId/run')
runPackage(
  @Param('packageId') packageId: string,
  @Body(new ZodValidationPipe(runPackageSchema)) body: RunPackageDto,
  @Headers() headers: Record<string, string | string[] | undefined>,
) {
  return this.runControlService.runPackage(packageId, body, 'run', actorContextFromHeaders(headers));
}

@Post('execution-packages/:packageId/rerun')
rerunPackage(
  @Param('packageId') packageId: string,
  @Body(new ZodValidationPipe(runPackageSchema)) body: RunPackageDto,
  @Headers() headers: Record<string, string | string[] | undefined>,
) {
  return this.runControlService.runPackage(packageId, body, 'rerun', actorContextFromHeaders(headers));
}

@Post('execution-packages/:packageId/force-rerun')
forceRerunPackage(
  @Param('packageId') packageId: string,
  @Body(new ZodValidationPipe(runPackageSchema)) body: RunPackageDto,
  @Headers() headers: Record<string, string | string[] | undefined>,
) {
  return this.runControlService.runPackage(packageId, body, 'force_rerun', actorContextFromHeaders(headers));
}
```

Preserve existing `rerun` and `force_rerun` behavior from the old service: `rerun` requires a previous run context, `force_rerun` requires `force: true` and `force_reason`, archives the current open ReviewPacket when present, and records replacement trace links through `AuditWriterService`/repository trace writes.

Create `apps/control-plane-api/src/modules/run-control/run-sessions.controller.ts` for run-session event and operator routes.

Use exact routes:

```ts
@Get('run-sessions/:runSessionId/events')
listRunEvents(@Param('runSessionId') runSessionId: string, @Query('after') after: string | undefined, @Headers() headers: Record<string, string | string[] | undefined>) {
  return this.runControlService.listRunEvents(runSessionId, { after, actorContext: actorContextFromHeaders(headers) });
}
```

Include SSE, stream token, input, cancel, and resume routes.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm vitest run tests/api/run-control-boundary.test.ts tests/api/run-events.test.ts tests/api/run-auth.test.ts tests/api/async-run.test.ts tests/e2e/run-console.e2e.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/control-plane-api/src/modules/run-control tests/api tests/e2e
git commit -m "refactor: extract run control service"
```

---

## Task 7: ReviewEvidenceService And AuditWriter Adoption

**Files:**
- Create: `apps/control-plane-api/src/modules/review-evidence/review-evidence.module.ts`
- Create: `apps/control-plane-api/src/modules/review-evidence/review-evidence.service.ts`
- Create: `apps/control-plane-api/src/modules/review-evidence/review-packets.controller.ts`
- Create: `apps/control-plane-api/src/modules/review-evidence/work-item-evidence.controller.ts`
- Move or copy: `apps/control-plane-api/src/p0/evidence-chain.ts` -> `apps/control-plane-api/src/modules/review-evidence/evidence-chain.ts`
- Modify: `apps/control-plane-api/src/modules/release/release.service.ts`
- Modify: `tests/api/evidence-chain.test.ts`
- Modify: `tests/contracts/evidence-chain.test.ts`
- Modify: `tests/api/delivery-flow.test.ts`

- [ ] **Step 1: Write failing audit service usage test**

Create `tests/api/audit-writer-boundary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('audit writer boundary', () => {
  it('does not make release depend on review evidence for shared audit writes', () => {
    const releaseService = readFileSync('apps/control-plane-api/src/modules/release/release.service.ts', 'utf8');
    expect(releaseService).toContain('AuditWriterService');
    expect(releaseService).not.toContain('ReviewEvidenceService');
  });

  it('keeps Work Item evidence chain as a public product route', () => {
    const controller = readFileSync('apps/control-plane-api/src/modules/review-evidence/work-item-evidence.controller.ts', 'utf8');
    expect(controller).toContain("@Get('work-items/:workItemId/evidence-chain')");
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run: `pnpm vitest run tests/api/audit-writer-boundary.test.ts`

Expected: FAIL until release uses `AuditWriterService` and the Work Item evidence-chain controller exists.

- [ ] **Step 3: Move review and evidence methods**

Move these methods to `ReviewEvidenceService`:

- `getReviewPacket`
- `approveReviewPacket`
- `requestReviewChanges`
- `evidenceChain`
- `applyReviewToPackage`
- `archiveReviewPacket`
- `bestEffortTraceWrite`

Move `evidence-chain.ts` to `modules/review-evidence/evidence-chain.ts`.

- [ ] **Step 4: Create ReviewPacketsController and WorkItemEvidenceController**

Use exact routes:

```ts
@Get('review-packets/:reviewPacketId')
getReviewPacket(@Param('reviewPacketId') reviewPacketId: string) {
  return this.reviewEvidenceService.getReviewPacket(reviewPacketId);
}

@Post('review-packets/:reviewPacketId/approve')
approveReviewPacket(
  @Param('reviewPacketId') reviewPacketId: string,
  @Body(new ZodValidationPipe(reviewDecisionSchema)) body: ReviewDecisionDto,
  @Headers() headers: Record<string, string | string[] | undefined>,
) {
  return this.reviewEvidenceService.approveReviewPacket(reviewPacketId, body, actorContextFromHeaders(headers));
}
```

Also include:

```ts
@Post('review-packets/:reviewPacketId/request-changes')
requestReviewChanges(
  @Param('reviewPacketId') reviewPacketId: string,
  @Body(new ZodValidationPipe(reviewDecisionSchema)) body: ReviewDecisionDto,
  @Headers() headers: Record<string, string | string[] | undefined>,
) {
  return this.reviewEvidenceService.requestReviewChanges(reviewPacketId, body, actorContextFromHeaders(headers));
}
```

Create `apps/control-plane-api/src/modules/review-evidence/work-item-evidence.controller.ts` with the required Work Item evidence route:

```ts
@Get('work-items/:workItemId/evidence-chain')
getWorkItemEvidenceChain(@Param('workItemId') workItemId: string) {
  return this.reviewEvidenceService.evidenceChain(workItemId);
}
```

Register both controllers in `ReviewEvidenceModule`.

- [ ] **Step 5: Convert release shared writes to AuditWriterService**

In `ReleaseService`, replace private `writeObjectEvent`, `writeStatusHistory`, and `persistDecisionIntent` internals with `AuditWriterService` calls. Keep release-specific transition orchestration in `ReleaseService`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm vitest run tests/api/audit-writer-boundary.test.ts tests/api/evidence-chain.test.ts tests/contracts/evidence-chain.test.ts tests/api/release-module.test.ts tests/api/delivery-flow.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/control-plane-api/src/modules/review-evidence apps/control-plane-api/src/modules/release tests/api tests/contracts
git commit -m "refactor: extract review evidence service"
```

---

## Task 8: Product Automation Settings Routes

**Files:**
- Create: `apps/control-plane-api/src/modules/automation/automation-settings.controller.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation.module.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation-command.service.ts`
- Modify: `tests/api/automation-commands.test.ts`
- Modify: `tests/api/automation-daemon.integration.test.ts`
- Modify: `scripts/automation-dogfood.ts`

- [ ] **Step 1: Write failing public automation route tests**

In `tests/api/automation-commands.test.ts`, add:

```ts
it('serves product automation settings without old public P0 routes', async () => {
  const { app } = await createTestApp();
  const { project } = await seedProjectRepoWorkItem(app);

  await request(app.getHttpServer())
    .get(`/automation/projects/${project.id}/capabilities?repo_id=repo-1`)
    .set(humanAdminHeaders)
    .expect(200);

  await request(app.getHttpServer()).get(`/p0/projects/${project.id}/automation/capabilities`).expect(404);
  await request(app.getHttpServer()).post(`/p0/manual-path-holds`).send({}).expect(404);
});
```

- [ ] **Step 2: Run test and verify it fails**

Run: `pnpm vitest run tests/api/automation-commands.test.ts`

Expected: FAIL because new routes do not exist and old routes still exist.

- [ ] **Step 3: Add AutomationSettingsController**

`apps/control-plane-api/src/modules/automation/automation-settings.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Query, Headers } from '@nestjs/common';

import { actorContextFromHeaders } from '../auth/actor-context';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import {
  disableAutomationCapabilitiesSchema,
  requestManualPathHoldSchema,
  resolveManualPathHoldSchema,
  setAutomationCapabilitiesSchema,
  type DisableAutomationCapabilitiesDto,
  type RequestManualPathHoldDto,
  type ResolveManualPathHoldDto,
  type SetAutomationCapabilitiesDto,
} from '../delivery/dto';

@Controller('automation')
export class AutomationSettingsController {
  constructor(private readonly automationCommandService: AutomationCommandService) {}

  @Get('projects/:projectId/capabilities')
  getAutomationCapabilities(@Param('projectId') projectId: string, @Query('repo_id') repoId?: string) {
    return this.automationCommandService.getAutomationCapabilities(projectId, repoId);
  }

  @Post('projects/:projectId/capabilities')
  setAutomationCapabilities(
    @Param('projectId') projectId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(setAutomationCapabilitiesSchema)) body: SetAutomationCapabilitiesDto,
  ) {
    return this.automationCommandService.setAutomationCapabilities(projectId, body, actorContextFromHeaders(headers));
  }

  @Post('projects/:projectId/capabilities\\:disable')
  disableAutomation(
    @Param('projectId') projectId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(disableAutomationCapabilitiesSchema)) body: DisableAutomationCapabilitiesDto,
  ) {
    return this.automationCommandService.disableAutomation(projectId, body, actorContextFromHeaders(headers));
  }

  @Post('manual-path-holds')
  requestManualPath(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(requestManualPathHoldSchema)) body: RequestManualPathHoldDto,
  ) {
    return this.automationCommandService.requestManualPath(body, actorContextFromHeaders(headers));
  }

  @Post('manual-path-holds/:holdId/resolve')
  resolveManualPath(
    @Param('holdId') holdId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(resolveManualPathHoldSchema)) body: ResolveManualPathHoldDto,
  ) {
    return this.automationCommandService.resolveManualPath(holdId, body, actorContextFromHeaders(headers));
  }
}
```

Move these DTO schemas from the old namespace into `apps/control-plane-api/src/modules/delivery/dto.ts` before wiring this controller: `setAutomationCapabilitiesSchema`, `disableAutomationCapabilitiesSchema`, `requestManualPathHoldSchema`, and `resolveManualPathHoldSchema`, plus their exported DTO types.

- [ ] **Step 4: Remove old public automation methods from old controller path**

Delete old `@Get('p0/projects/:projectId/automation/capabilities')`, `@Post('p0/projects/:projectId/automation/capabilities')`, `@Post('p0/projects/:projectId/automation/capabilities:disable')`, `@Post('p0/manual-path-holds')`, and `@Post('p0/manual-path-holds/:holdId/resolve')` handlers.

- [ ] **Step 5: Preserve repo-scoped behavior**

Ensure:

- `GET /automation/projects/:projectId/capabilities?repo_id=repo-1` passes `repoId` to `AutomationCommandService.getAutomationCapabilities`.
- set/disable DTOs keep optional `repo_id`.
- responses are scoped settings, not project-only settings.

- [ ] **Step 6: Update scripts and tests**

Replace concrete old public automation paths in code, tests, scripts, and docs:

- `/p0/projects/${projectId}/automation/capabilities` -> `/automation/projects/${projectId}/capabilities`
- `/p0/projects/${projectId}/automation/capabilities:disable` -> `/automation/projects/${projectId}/capabilities:disable`
- `/p0/manual-path-holds` -> `/automation/manual-path-holds`
- `/p0/manual-path-holds/${holdId}/resolve` -> `/automation/manual-path-holds/${holdId}/resolve`

- [ ] **Step 7: Run focused automation tests**

Run:

```bash
pnpm vitest run tests/api/automation-commands.test.ts tests/api/automation-daemon.integration.test.ts tests/api/automation-internal-auth.test.ts tests/smoke/automation-dogfood-script.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/control-plane-api/src/modules/automation tests/api tests/smoke scripts/automation-dogfood.ts
git commit -m "feat: add product automation settings routes"
```

---

## Task 9: Release Test/Acceptance Gate

**Files:**
- Modify: `packages/contracts/src/release.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/control-plane-api/src/modules/release/release.controller.ts`
- Modify: `apps/control-plane-api/src/modules/release/release.service.ts`
- Modify: `apps/web/src/api/types.ts`
- Modify: `apps/web/src/api/commands.ts`
- Create: `tests/api/test-acceptance-gate.test.ts`
- Modify: `tests/api/release-module.test.ts`

- [ ] **Step 1: Write failing release gate tests**

Create `tests/api/test-acceptance-gate.test.ts`:

```ts
it('blocks release approval until high-risk test acceptance is acknowledged or overridden', async () => {
  const { app, releaseId } = await seedReleaseWithHighRiskLinkedWorkItemAndApprovedPackage();

  await request(app.getHttpServer())
    .post(`/releases/${releaseId}/submit-for-approval`)
    .set(ownerHeaders)
    .send({ actor_id: actorOwner })
    .expect(422);

  await request(app.getHttpServer())
    .post(`/releases/${releaseId}/test-acceptance/acknowledge`)
    .set(qaHeaders)
    .send({ actor_id: actorQa, summary: 'QA accepts the existing test evidence.' })
    .expect(201);

  await request(app.getHttpServer())
    .post(`/releases/${releaseId}/submit-for-approval`)
    .set(ownerHeaders)
    .send({ actor_id: actorOwner })
    .expect(201);
});

it('blocks release approval when a submitted release still lacks test acceptance', async () => {
  const { app, releaseId } = await seedSubmittedReleaseWithHighRiskLinkedWorkItemAndMissingTestAcceptance();

  await request(app.getHttpServer())
    .post(`/releases/${releaseId}/approve`)
    .set(releaseOwnerHeaders)
    .send({ actor_id: actorReleaseOwner, release_decision_summary: 'Ready to approve.' })
    .expect(422);
});
```

Also add an override path test using `POST /releases/:releaseId/override-approve`.

Add focused gate-source tests:

- a submitted release missing a minimal `rollback_plan` is rejected on approve with `422`;
- the same missing-rollback-plan release can use `POST /releases/:releaseId/override-approve` only when it records an explicit override decision;
- a linked Work Item whose approved Spec revision has an empty `test_strategy_summary` is rejected on submit with `422`;
- a linked Work Item whose approved Spec revision has empty `acceptance_criteria` is rejected on submit with `422`;
- a linked package with missing blocking required checks is rejected on submit with `422`;
- a linked package with missing required artifacts is rejected on submit with `422`;
- a release with active test/readiness/artifact blockers is rejected on submit with `422`;
- a high-risk linked package without an evidence-chain link is rejected on approve with `422`.

- [ ] **Step 2: Run test and verify it fails**

Run: `pnpm vitest run tests/api/test-acceptance-gate.test.ts`

Expected: FAIL because acknowledgement route and gate logic are missing.

- [ ] **Step 3: Add contract schema**

In `packages/contracts/src/release.ts`:

```ts
export const acknowledgeReleaseTestAcceptanceRequestSchema = releaseActorCommandRequestSchema.extend({
  summary: z.string().trim().min(1),
  evidence_refs: z.array(artifactRefSchema).default([]),
});
export type AcknowledgeReleaseTestAcceptanceRequest = z.infer<typeof acknowledgeReleaseTestAcceptanceRequestSchema>;
```

Export it from `packages/contracts/src/index.ts`.

- [ ] **Step 4: Add controller route**

In `ReleaseController`:

```ts
@Post(':releaseId/test-acceptance/acknowledge')
acknowledgeTestAcceptance(
  @Param('releaseId') releaseId: string,
  @Body(new ZodValidationPipe(acknowledgeReleaseTestAcceptanceRequestSchema)) body: AcknowledgeReleaseTestAcceptanceRequest,
  @Headers() headers: Record<string, string | string[] | undefined>,
) {
  return this.releaseService.acknowledgeTestAcceptance(releaseId, body, actorContextFromHeaders(headers));
}
```

- [ ] **Step 5: Implement gate computation**

Add a private method to `ReleaseService`:

```ts
private async testAcceptanceGateContextWithRepository(repository: DeliveryRepository, release: Release): Promise<{
  passed: boolean;
  blockers: string[];
  highRiskRequiresAcknowledgement: boolean;
  acknowledged: boolean;
}> {
  // Use existing linked Work Items, approved Spec revisions, approved Plan revisions,
  // linked packages, required checks/artifacts, evidence-chain links, release blockers,
  // and test-acceptance decisions.
  // Do not create TestAsset/TestRun tables.
}
```

Rules:

- missing Spec test strategy summaries fail the gate;
- missing Spec acceptance criteria fail the gate;
- missing blocking checks fail the gate;
- missing required artifacts fail the gate;
- missing evidence-chain links for linked high-risk Work Items or packages fail the gate;
- active release blockers related to readiness/tests/artifacts fail the gate;
- high-risk Work Items require a decision/audit acknowledgement;
- override approve can bypass with explicit override decision.

Add a shared assertion helper and call it from both release transition commands:

```ts
private async assertTestAcceptanceGateSatisfiedWithRepository(
  repository: DeliveryRepository,
  release: Release,
  command: 'submit' | 'approve',
): Promise<void> {
  const gate = await this.testAcceptanceGateContextWithRepository(repository, release);
  if (!gate.passed || (gate.highRiskRequiresAcknowledgement && !gate.acknowledged)) {
    throw new UnprocessableEntityException({
      message: `Release Test/Acceptance gate is not satisfied for ${command}`,
      blockers: gate.blockers,
      high_risk_requires_acknowledgement: gate.highRiskRequiresAcknowledgement,
      acknowledged: gate.acknowledged,
    });
  }
}
```

In `submitForApproval`, call `assertTestAcceptanceGateSatisfiedWithRepository(repository, release, 'submit')` before the existing submit transition call.

In `approveRelease`, call `assertTestAcceptanceGateSatisfiedWithRepository(repository, release, 'approve')` before the existing approve transition call.

Do not call this helper from `overrideApproveRelease`; that route remains the explicit override path and must persist an override decision.

Add a separate rollback-plan approval assertion:

```ts
private assertRollbackPlanSatisfiedForApproval(release: Release): void {
  if (release.rollback_plan === undefined || release.rollback_plan.trim().length === 0) {
    throw new UnprocessableEntityException({
      message: 'Release rollback plan is required before approval',
      blockers: ['missing_rollback_plan'],
    });
  }
}
```

Call `assertRollbackPlanSatisfiedForApproval(release)` in `approveRelease` before the existing approve transition call. Do not call it from `submitForApproval`. Do not call it from `overrideApproveRelease`; the override route is the explicit bypass and must persist an override decision that names the missing rollback plan.

- [ ] **Step 6: Write acknowledgement decision**

In `ReleaseService.acknowledgeTestAcceptance`, write a decision through `AuditWriterService` with outcome `completed` and metadata:

```ts
{
  decision_type: 'test_acceptance_acknowledged',
  release_id: releaseId,
  summary: body.summary,
  evidence_refs: body.evidence_refs
}
```

Use the exact `Decision` shape from `@forgeloop/domain`.

- [ ] **Step 7: Wire web API client**

In `apps/web/src/api/commands.ts`:

```ts
acknowledgeReleaseTestAcceptance: (releaseId: string, body: AcknowledgeReleaseTestAcceptanceBody) =>
  request<ReleaseControlResponse>(`/releases/${encodeURIComponent(releaseId)}/test-acceptance/acknowledge`, {
    method: 'POST',
    body,
    actorId: releaseActorId(body),
  }),
```

- [ ] **Step 8: Run focused tests**

Run:

```bash
pnpm vitest run tests/api/test-acceptance-gate.test.ts tests/api/release-module.test.ts tests/web/api.test.ts tests/domain/release-gates.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/contracts apps/control-plane-api/src/modules/release apps/web/src/api tests/api tests/web tests/domain
git commit -m "feat: add release test acceptance gate"
```

---

## Task 10: Query Role Workbenches And Minimal Replay

**Files:**
- Modify: `apps/control-plane-api/src/modules/query/query.controller.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.service.ts`
- Modify: `packages/db/src/queries/replay-queries.ts`
- Create: `packages/db/src/queries/role-workbench-queries.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/contracts/src/api.ts`
- Modify: `apps/web/src/api/query.ts`
- Modify: `apps/web/src/api/types.ts`
- Create: `tests/api/role-workbenches.test.ts`
- Modify: `tests/api/query-module.test.ts`

- [ ] **Step 1: Write failing role workbench tests**

Create `tests/api/role-workbenches.test.ts`:

```ts
it('returns typed intake queues with real action descriptors', async () => {
  const { app, project, workItem } = await seedDraftWorkItem();

  const response = await request(app.getHttpServer())
    .get(`/query/workbenches/intake?project_id=${project.id}&kind=initiative`)
    .expect(200);

  expect(response.body.summary).toBeDefined();
  expect(response.body.items[0]).toMatchObject({
    object: { type: 'work_item', id: workItem.id },
    actions: expect.arrayContaining([
      expect.objectContaining({ method: 'PATCH', path: `/work-items/${workItem.id}` }),
    ]),
  });
});
```

Add one test per workbench route for non-static data and action descriptors.

- [ ] **Step 2: Write failing replay object type test**

In `tests/api/query-module.test.ts`, assert:

```ts
await request(app.getHttpServer()).get(`/query/replay/execution_package/${packageId}`).expect(200);
await request(app.getHttpServer()).get(`/query/replay/review_packet/${reviewPacketId}`).expect(200);
await request(app.getHttpServer()).get('/query/replay/incident/incident-1').expect(400);
```

- [ ] **Step 3: Run tests and verify they fail**

Run: `pnpm vitest run tests/api/role-workbenches.test.ts tests/api/query-module.test.ts`

Expected: FAIL because workbench routes and replay object types are missing.

- [ ] **Step 4: Add role workbench contracts**

In `packages/contracts/src/api.ts`, add:

```ts
export const roleWorkbenchActionSchema = z.object({
  label: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PATCH', 'DELETE']),
  path: z.string().min(1),
  enabled: z.boolean().default(true),
  reason: z.string().optional(),
});

export const roleWorkbenchResponseSchema = z.object({
  summary: z.record(z.unknown()),
  items: z.array(z.record(z.unknown())),
  next_cursor: z.string().optional(),
});
```

Prefer precise item schemas if they stay small; otherwise keep the generic envelope and enforce important fields in tests.

- [ ] **Step 5: Implement DB query projection helpers**

Create `packages/db/src/queries/role-workbench-queries.ts` with pure functions:

- `getIntakeWorkbench(repository, filters)`
- `getSpecApproverWorkbench(repository, filters)`
- `getExecutionOwnerWorkbench(repository, filters)`
- `getReviewerWorkbench(repository, filters)`
- `getQaTestOwnerWorkbench(repository, filters)`
- `getReleaseOwnerWorkbench(repository, filters)`
- `getManagerHealthWorkbench(repository, filters)`

Each returns `{ summary, items, next_cursor? }`.

- [ ] **Step 6: Add QueryController routes**

Add:

```ts
@Get('workbenches/intake')
getIntakeWorkbench(@Query() query: RoleWorkbenchQuery) {
  return this.service.getIntakeWorkbench(query);
}

@Get('workbenches/spec-approver')
getSpecApproverWorkbench(@Query() query: RoleWorkbenchQuery) {
  return this.service.getSpecApproverWorkbench(query);
}

@Get('workbenches/execution-owner')
getExecutionOwnerWorkbench(@Query() query: RoleWorkbenchQuery) {
  return this.service.getExecutionOwnerWorkbench(query);
}

@Get('workbenches/reviewer')
getReviewerWorkbench(@Query() query: RoleWorkbenchQuery) {
  return this.service.getReviewerWorkbench(query);
}

@Get('workbenches/qa-test-owner')
getQaTestOwnerWorkbench(@Query() query: RoleWorkbenchQuery) {
  return this.service.getQaTestOwnerWorkbench(query);
}

@Get('workbenches/release-owner')
getReleaseOwnerWorkbench(@Query() query: RoleWorkbenchQuery) {
  return this.service.getReleaseOwnerWorkbench(query);
}

@Get('workbenches/manager-health')
getManagerHealthWorkbench(@Query() query: RoleWorkbenchQuery) {
  return this.service.getManagerHealthWorkbench(query);
}
```

Define `RoleWorkbenchQuery` next to `QueryController` with supported filters from the spec and tests: `project_id`, `actor_id`, `kind`, `limit`, `cursor`, `phase`, `status`, and `risk`. Keep all fields optional; parse `limit` as an integer with a bounded default in `QueryService` before passing it to DB query helpers.

- [ ] **Step 7: Expand minimal replay**

In `QueryService.getReplay`, support `work_item`, `execution_package`, `review_packet`, and `release`. Update `packages/db/src/queries/replay-queries.ts` if it currently only supports Work Item and Release.

- [ ] **Step 8: Run focused tests**

Run:

```bash
pnpm vitest run tests/api/role-workbenches.test.ts tests/api/query-module.test.ts tests/db/release-replay-queries.test.ts tests/db/release-cockpit-queries.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/contracts packages/db/src/queries apps/control-plane-api/src/modules/query apps/web/src/api tests/api tests/db
git commit -m "feat: add role workbench query projections"
```

---

## Task 11: Web Role Workbench MVP

**Files:**
- Modify: `apps/web/src/api/types.ts`
- Modify: `apps/web/src/api/query.ts`
- Modify: `apps/web/src/workbenchState.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `tests/web/api.test.ts`
- Modify: `tests/web/workbench-state.test.ts`
- Create: `tests/web/role-workbench-state.test.ts`

- [ ] **Step 1: Write failing web API client tests**

In `tests/web/api.test.ts`, add:

```ts
it('fetches role workbench projections', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ summary: {}, items: [] }), { status: 200 }));
  const queryApi = createForgeloopQueryApi({ baseUrl: 'http://api.local', fetch: fetchMock });

  await queryApi.getRoleWorkbench('intake', { project_id: 'project 1', kind: 'initiative' });

  expect(fetchMock).toHaveBeenCalledWith(
    'http://api.local/query/workbenches/intake?project_id=project+1&kind=initiative',
    expect.objectContaining({ method: 'GET' }),
  );
});
```

- [ ] **Step 2: Write failing workbench state tests**

Create `tests/web/role-workbench-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { roleWorkbenchTabs } from '../../apps/web/src/workbenchState';

describe('role workbench tabs', () => {
  it('includes the MVP role matrix', () => {
    expect(roleWorkbenchTabs.map((tab) => tab.id)).toEqual([
      'intake',
      'spec-approver',
      'execution-owner',
      'reviewer',
      'qa-test-owner',
      'release-owner',
      'manager-health',
    ]);
  });
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run: `pnpm vitest run tests/web/api.test.ts tests/web/role-workbench-state.test.ts`

Expected: FAIL until web APIs and state are added.

- [ ] **Step 4: Add web query API**

In `apps/web/src/api/query.ts`:

```ts
const roleWorkbenchQueryString = (params: RoleWorkbenchQuery = {}) => queryString(params);

getRoleWorkbench: (workbenchId: RoleWorkbenchId, query: RoleWorkbenchQuery = {}) =>
  request<RoleWorkbenchResponse>(`/query/workbenches/${encodeURIComponent(workbenchId)}${roleWorkbenchQueryString(query)}`),
```

- [ ] **Step 5: Add types and tabs**

In `apps/web/src/api/types.ts`, add `RoleWorkbenchId`, `RoleWorkbenchQuery`, `RoleWorkbenchAction`, and `RoleWorkbenchResponse`. `RoleWorkbenchQuery` must include optional `project_id`, `actor_id`, `kind`, `limit`, `cursor`, `phase`, `status`, and `risk` so the web client matches the backend query contract.

In `apps/web/src/workbenchState.ts`:

```ts
export const roleWorkbenchTabs = [
  { id: 'intake', label: 'Intake' },
  { id: 'spec-approver', label: 'Spec Approver' },
  { id: 'execution-owner', label: 'Execution Owner' },
  { id: 'reviewer', label: 'Reviewer' },
  { id: 'qa-test-owner', label: 'QA/Test Owner' },
  { id: 'release-owner', label: 'Release Owner' },
  { id: 'manager-health', label: 'Manager Health' },
] as const;
```

- [ ] **Step 6: Render the role matrix in App.tsx**

Keep the interface dense and operational. Do not create a landing page. Add tabs or segmented controls for roles, list queue items, and render action buttons from action descriptors.

Do not show personal scoring or ranked actor lists in Manager Health.

- [ ] **Step 7: Run web tests and build**

Run:

```bash
pnpm vitest run tests/web/api.test.ts tests/web/workbench-state.test.ts tests/web/role-workbench-state.test.ts tests/web/release-owner-surface.test.tsx
pnpm --filter @forgeloop/web build
```

Expected: PASS and build exits 0.

- [ ] **Step 8: Commit**

```bash
git add apps/web tests/web
git commit -m "feat: add role workbench web surface"
```

---

## Task 12: Full Route Split And Delete Old P0 Namespace

**Files:**
- Delete: `apps/control-plane-api/src/p0/**`
- Modify: `apps/control-plane-api/src/app.module.ts`
- Modify: `apps/control-plane-api/src/modules/delivery/delivery.module.ts`
- Modify: all remaining imports found by `rg "p0|P0"`
- Modify: `tests/api/*.test.ts`
- Modify: `tests/e2e/*.test.ts`
- Modify: `tests/smoke/*.test.ts`

- [ ] **Step 1: Write failing no-old-namespace route contract test**

Create `tests/api/delivery-route-contract.test.ts`:

```ts
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';

describe('delivery route contract', () => {
  it('does not register old public automation routes', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    await request(app.getHttpServer()).get('/p0/projects/project-1/automation/capabilities').expect(404);
    await request(app.getHttpServer()).post('/p0/manual-path-holds').send({}).expect(404);
    await app.close();
  });
});
```

- [ ] **Step 2: Run route contract test**

Run: `pnpm vitest run tests/api/delivery-route-contract.test.ts`

Expected: PASS once old public routes were removed in Task 8. Keep it as a regression test.

- [ ] **Step 3: Replace AppModule imports**

In `apps/control-plane-api/src/app.module.ts`, remove old module and import product modules:

```ts
@Module({
  imports: [
    HttpSupportModule,
    DeliveryModule,
    QueryModule,
    ReleaseModule,
    AutomationModule,
  ],
})
export class AppModule {}
```

Do not import `APP_FILTER` or `DomainErrorFilter` in `AppModule`; `HttpSupportModule` owns the global filter provider.

- [ ] **Step 4: Remove old controller/module/service**

Run:

```bash
git rm -r apps/control-plane-api/src/p0
```

If any imports break, move the missing code into the target modules listed in the file structure instead of reintroducing a facade.

- [ ] **Step 5: Update tests to use delivery services and tokens**

Replace `P0Service` access in tests with the new service or repository token. For tests that only need repository access, inject `DELIVERY_REPOSITORY`.

Replace `RUN_WORKER` with `DELIVERY_RUN_WORKER`.

Replace helper imports from `tests/helpers/p0-runtime-fixtures.ts` after the helper is renamed in Task 13.

- [ ] **Step 6: Run API and E2E tests**

Run:

```bash
pnpm vitest run tests/api tests/e2e/run-console.e2e.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/control-plane-api tests/api tests/e2e
git commit -m "refactor: replace p0 module with delivery modules"
```

---

## Task 13: Scripts, Docs, Smoke Tests, And Final Naming Gate

**Files:**
- Rename: `tests/helpers/p0-runtime-fixtures.ts` -> `tests/helpers/delivery-runtime-fixtures.ts`
- Rename: `tests/smoke/p0-smoke.test.ts` -> `tests/smoke/delivery-smoke.test.ts`
- Rename: `tests/smoke/p0-dogfood-script.test.ts` -> `tests/smoke/delivery-dogfood-script.test.ts`
- Rename: `tests/smoke/p0-dogfood-work-items-script.test.ts` -> `tests/smoke/delivery-dogfood-work-items-script.test.ts`
- Rename: `tests/smoke/p0-durable-dogfood-script.test.ts` -> `tests/smoke/delivery-durable-dogfood-script.test.ts`
- Rename: `tests/smoke/p0-local-codex-dogfood-script.test.ts` -> `tests/smoke/delivery-local-codex-dogfood-script.test.ts`
- Rename: `scripts/p0-dogfood.ts` -> `scripts/delivery-dogfood.ts`
- Rename: `scripts/p0-durable-dogfood.ts` -> `scripts/delivery-durable-dogfood.ts`
- Rename: `scripts/p0-local-codex-dogfood.ts` -> `scripts/delivery-local-codex-dogfood.ts`
- Rename: `scripts/p0-dogfood-work-items.ts` -> `scripts/delivery-dogfood-work-items.ts`
- Rename: `docs/dogfood/p0-dogfood-work-items.md` -> `docs/dogfood/delivery-dogfood-work-items.md`
- Modify: `package.json`
- Modify: `tests/bootstrap.test.ts`
- Modify or supersede: active docs/specs/plans/reports with old subsystem language
- Create: `tests/naming/delivery-naming.test.ts`

- [ ] **Step 1: Write final naming gate test**

Create `tests/naming/delivery-naming.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const roots = ['apps', 'packages', 'scripts', 'tests', 'docs', 'package.json'];
const allowedFiles = new Set([
  'docs/superpowers/specs/2026-05-16-delivery-boundary-and-role-workbench-design.md',
  'docs/superpowers/plans/2026-05-16-delivery-boundary-and-role-workbench.md',
]);

const priorityLiteral = /\b(?:priority|default_priority|defaultPriority):\s*['"]P0['"]|Priority:\*\*\s*P0/g;
const oldSubsystem = /P0|p0|p0-|p0_|p0\.|p0\/|\/p0|forgeloop:p0|forgeloop:\/\/p0/g;

const files = (path: string): string[] => {
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  return readdirSync(path).flatMap((entry) => {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') return [];
    return files(join(path, entry));
  });
};

describe('delivery naming cleanup', () => {
  it('has no active historical subsystem names', () => {
    const offenders: string[] = [];
    for (const file of roots.flatMap(files)) {
      const rel = relative(process.cwd(), file);
      if (allowedFiles.has(rel)) continue;
      const content = readFileSync(file, 'utf8').replace(priorityLiteral, '');
      if (oldSubsystem.test(content) || oldSubsystem.test(rel)) offenders.push(rel);
      oldSubsystem.lastIndex = 0;
    }
    expect(offenders).toEqual([]);
  });
});
```

Keep this allowlist limited to the active migration spec and active migration plan while this plan is being executed. If a historical note must remain after the migration, first add the superseded historical migration note from Step 5 to that file, then add that exact file to the allowlist. Do not allow active runbooks, scripts, tests, package exports, generated report names, or product docs.

- [ ] **Step 2: Run naming gate and verify it fails**

Run: `pnpm vitest run tests/naming/delivery-naming.test.ts`

Expected: FAIL with current old names.

- [ ] **Step 3: Rename scripts and tests with git mv**

Run:

```bash
git mv tests/helpers/p0-runtime-fixtures.ts tests/helpers/delivery-runtime-fixtures.ts
git mv tests/smoke/p0-smoke.test.ts tests/smoke/delivery-smoke.test.ts
git mv tests/smoke/p0-dogfood-script.test.ts tests/smoke/delivery-dogfood-script.test.ts
git mv tests/smoke/p0-dogfood-work-items-script.test.ts tests/smoke/delivery-dogfood-work-items-script.test.ts
git mv tests/smoke/p0-durable-dogfood-script.test.ts tests/smoke/delivery-durable-dogfood-script.test.ts
git mv tests/smoke/p0-local-codex-dogfood-script.test.ts tests/smoke/delivery-local-codex-dogfood-script.test.ts
git mv scripts/p0-dogfood.ts scripts/delivery-dogfood.ts
git mv scripts/p0-durable-dogfood.ts scripts/delivery-durable-dogfood.ts
git mv scripts/p0-local-codex-dogfood.ts scripts/delivery-local-codex-dogfood.ts
git mv scripts/p0-dogfood-work-items.ts scripts/delivery-dogfood-work-items.ts
git mv docs/dogfood/p0-dogfood-work-items.md docs/dogfood/delivery-dogfood-work-items.md
```

- [ ] **Step 4: Update package scripts**

In `package.json`:

```json
{
  "smoke:delivery": "vitest run tests/smoke",
  "dogfood:delivery": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/delivery-dogfood.ts",
  "dogfood:delivery:durable": "tsx scripts/delivery-durable-dogfood.ts",
  "dogfood:delivery:local-codex": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/delivery-local-codex-dogfood.ts",
  "dogfood:delivery:work-items": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/delivery-dogfood-work-items.ts"
}
```

Remove old script keys.

- [ ] **Step 5: Supersede active compatibility docs**

Update `docs/superpowers/specs/2026-05-15-http-automation-daemon-mvp-design.md` so old public automation compatibility language is marked superseded by this delivery boundary migration and the current route map points only to routes under `/automation/`.

Update `docs/superpowers/specs/2026-05-16-delivery-boundary-and-role-workbench-design.md` and this plan before final release acceptance in one of two ways:

- rewrite them as completed delivery-boundary records with no active old-namespace operating instructions; or
- mark them with the superseded historical migration note below so they remain audit history, not current operating docs.

Update or supersede active P0-named specs/plans/reports. Historical files that remain must start with a note:

```md
> Superseded historical migration note: this document mentions the old subsystem name for audit history only. Current commands, routes, files, and product docs use delivery terminology.
```

Prefer renaming active runbooks and generated report paths to delivery terminology.

- [ ] **Step 6: Update tests and imports**

Run:

```bash
rg "p0|P0|smoke:p0|dogfood:p0|RUN_WORKER|P0_REPOSITORY|P0Service" apps packages scripts tests docs package.json
```

Resolve every active hit except explicit priority values such as `priority: "P0"` and the two migration documents in `allowedFiles`. The migration documents must either be rewritten or marked superseded before final release acceptance.

- [ ] **Step 7: Run naming and bootstrap tests**

Run:

```bash
pnpm vitest run tests/naming/delivery-naming.test.ts tests/bootstrap.test.ts tests/smoke/delivery-smoke.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json scripts tests docs
git commit -m "chore: remove historical p0 names"
```

---

## Task 14: Final Verification

**Files:**
- No new files unless a failure requires a fix.

- [ ] **Step 1: Run repository-wide naming search**

Run:

```bash
rg -n "P0|p0|p0-|p0_|p0\\.|p0/|/p0|forgeloop:p0|forgeloop://p0" apps packages scripts tests docs package.json
```

Expected: only allowed priority-value literals such as `priority: "P0"`, `priority: 'P0'`, `default_priority: "P0"`, and `default_priority: 'P0'`, the active migration spec/plan while still active, and explicitly superseded historical notes.

- [ ] **Step 2: Run focused delivery tests**

Run:

```bash
pnpm vitest run tests/api/work-items.test.ts tests/api/spec-plan-service.test.ts tests/api/execution-package-service.test.ts tests/api/run-control-boundary.test.ts tests/api/evidence-chain.test.ts tests/api/automation-commands.test.ts tests/api/test-acceptance-gate.test.ts tests/api/role-workbenches.test.ts tests/api/delivery-route-contract.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run integration and regression tests**

Run:

```bash
pnpm vitest run tests/api tests/db tests/domain tests/contracts tests/web tests/e2e/run-console.e2e.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run: `pnpm build`

Expected: exit 0.

- [ ] **Step 5: Run smoke and dogfood commands under new names**

Run:

```bash
pnpm smoke:delivery
pnpm dogfood:delivery
pnpm dogfood:delivery:work-items
```

Expected: all exit 0.

If `FORGELOOP_DATABASE_URL` is available, also run:

```bash
FORGELOOP_DATABASE_URL="$FORGELOOP_DATABASE_URL" pnpm dogfood:delivery:durable
```

Expected: exits 0 using the configured durable database.

- [ ] **Step 6: Run strict local Codex dogfood only when environment is explicitly enabled**

Run only if the environment is intentionally configured:

```bash
FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1 FORGELOOP_LOCAL_CODEX_DOGFOOD_CONFIRM_DANGEROUS_MODE=1 pnpm dogfood:delivery:local-codex
```

Expected: exits 0. If the environment is not configured, record it as skipped, not failed.

- [ ] **Step 7: Commit final verification fixes**

If any verification fixes were needed:

```bash
git add .
git commit -m "test: verify delivery boundary migration"
```

If no changes were needed, do not create an empty commit.

---

## Execution Notes

- Use `rg` before and after every extraction step. Do not leave hidden imports from `apps/control-plane-api/src/p0`.
- Do not create compatibility facades. Temporary staging inside an uncommitted task is acceptable, but each committed checkpoint should move toward final deletion.
- Do not change executor runtime safety behavior. If a test failure points into executor safety semantics, stop and coordinate with the runtime-safety owner.
- Keep `priority: "P0"` and `priority: 'P0'` literals only as priority values. Product copy, command names, files, classes, routes, report names, package exports, and logger namespaces must use delivery/product terminology.
- Prefer small commits. If a task becomes too large, split it before editing more files.
