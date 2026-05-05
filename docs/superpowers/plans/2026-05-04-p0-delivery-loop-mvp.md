# P0 Delivery Loop MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Forgeloop P0 thin complete delivery loop: Work Item -> Spec -> Plan -> Execution Package -> RunSession -> AI self-review -> Review Packet -> Human Review -> Timeline/Evidence.

**Architecture:** Implement a TypeScript monorepo with NestJS control-plane API, Drizzle schema/repositories, Temporal workflow worker, executor-gateway adapters, shared domain/contracts packages, and a minimal React workbench. Keep workflows testable through pure activity functions, but wire the P0 execution path through the same contracts the Temporal worker will use.

**Tech Stack:** pnpm workspaces, TypeScript, NestJS, Drizzle ORM, PostgreSQL for runtime, PGlite or repository-level test doubles for tests, Temporal TypeScript SDK, React/Vite, Vitest, Supertest, Zod.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-05-04-p0-delivery-loop-mvp-design.md`
- PRD: `docs/PRD_v1.md`
- Architecture notes: `docs/architecture-design/v0/*.md`

## Scope Guardrails

Implement only P0. Do not build Release, Incident, Contract, full Trace Plane, GraphQL, PR creation, merge, deployment, role dashboards, or full permissions.

All code must preserve these P0 decisions:

- Project can bind multiple repos.
- Each Execution Package binds exactly one repo.
- ReviewPacket uses `status + decision`.
- `changes_requested` is a decision, not a status.
- `local_codex` produces patch/evidence only; no push, PR, merge, or release.
- `force-rerun` is the only rerun command that archives an open ReviewPacket before decision; Package edits also archive open ReviewPackets as specified.
- Blocking check failure creates no ReviewPacket; non-blocking check failure still creates ReviewPacket with risk notes.

## Target File Structure

```text
package.json
pnpm-workspace.yaml
tsconfig.base.json
vitest.config.ts
docker-compose.yml

packages/
  contracts/src/
    index.ts
    executor.ts
    review.ts
    api.ts
  domain/src/
    index.ts
    types.ts
    states.ts
    validators.ts
    completion.ts
  db/src/
    index.ts
    client.ts
    schema/index.ts
    schema/_shared.ts
    schema/project.ts
    schema/work-item.ts
    schema/spec.ts
    schema/plan.ts
    schema/execution-package.ts
    schema/run-session.ts
    schema/review-packet.ts
    schema/evidence.ts
    repositories/p0-repository.ts
    repositories/in-memory-p0-repository.ts
    repositories/drizzle-p0-repository.ts
  executor/src/
    index.ts
    mock-executor.ts
    local-codex-preflight.ts
    local-codex-executor.ts
    self-review.ts
  workflow/src/
    index.ts
    package-execution-workflow.ts
    activities.ts

apps/
  control-plane-api/src/
    main.ts
    app.module.ts
    p0/p0.module.ts
    p0/p0.controller.ts
    p0/p0.service.ts
    p0/dto.ts
  executor-gateway/src/
    main.ts
    app.module.ts
    executor.controller.ts
    executor.service.ts
  workflow-worker/src/
    main.ts
    worker.ts
  web/
    index.html
    src/main.tsx
    src/App.tsx
    src/api.ts
    src/styles.css

tests/
  domain/
  contracts/
  db/
  executor/
  workflow/
  api/
  smoke/
```

## Task 1: Bootstrap TypeScript Monorepo

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `docker-compose.yml`
- Create: `tests/bootstrap.test.ts`
- Create: package manifests for `packages/*` and `apps/*`

- [ ] **Step 1: Create root package manifest**

Include scripts:

```json
{
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run",
    "test:watch": "vitest",
    "dev:api": "pnpm --filter @forgeloop/control-plane-api start:dev",
    "dev:executor": "pnpm --filter @forgeloop/executor-gateway start:dev",
    "dev:worker": "pnpm --filter @forgeloop/workflow-worker start:dev",
    "dev:web": "pnpm --filter @forgeloop/web dev",
    "smoke:p0": "vitest run tests/smoke"
  }
}
```

Add dependencies for NestJS, Drizzle, pg, Temporal, React, Vite, Vitest, Supertest, Zod, and tsx.

- [ ] **Step 2: Create pnpm workspace config**

`pnpm-workspace.yaml` must include `apps/*` and `packages/*`.

- [ ] **Step 3: Create TypeScript config**

Add strict `tsconfig.base.json` with path aliases for `@forgeloop/contracts`, `@forgeloop/domain`, `@forgeloop/db`, `@forgeloop/executor`, and `@forgeloop/workflow`.

- [ ] **Step 4: Create docker compose**

`docker-compose.yml` should define `postgres`, `redis`, and `temporal` services suitable for local dev. Keep environment variables documented in comments or `.env.example`.

- [ ] **Step 5: Create package/app manifests**

Every package gets `build: tsc --noEmit`. Nest apps get `start:dev` through `tsx watch` if the Nest CLI is not installed.

- [ ] **Step 6: Install dependencies**

Run: `pnpm install`

Expected: lockfile generated and install succeeds.

- [ ] **Step 7: Create and verify bootstrap test**

Create `tests/bootstrap.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('bootstrap', () => {
  it('runs the test harness', () => {
    expect(true).toBe(true);
  });
});
```

Run: `pnpm test`

Expected: PASS with the bootstrap test.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vitest.config.ts docker-compose.yml apps packages tests/bootstrap.test.ts
git commit -m "chore: bootstrap P0 monorepo"
```

## Task 2: Contracts Package

**Files:**
- Create: `packages/contracts/src/executor.ts`
- Create: `packages/contracts/src/review.ts`
- Create: `packages/contracts/src/api.ts`
- Create/modify: `packages/contracts/src/index.ts`
- Test: `tests/contracts/contracts.test.ts`

- [ ] **Step 1: Write failing contract tests**

Test Zod parsing for:

- valid `RunSpec`
- blocking and non-blocking `ExecutorResult`
- review request-changes payload
- self-review failed result

Run: `pnpm test tests/contracts/contracts.test.ts`

Expected: FAIL because contracts do not exist.

- [ ] **Step 2: Implement executor contracts**

Define:

- `ExecutorType = 'mock' | 'local_codex'`
- `RunSpec`
- `RequiredCheckSpec`
- `ExecutorResult`
- `CheckResult`
- `ArtifactRef`
- `ChangedFile`
- `FailureKind`

Include `review_context`, `workflow_only`, blocking flag, and idempotency key.

- [ ] **Step 3: Implement review contracts**

Define:

- `SelfReviewInput`
- `SelfReviewResult`
- `ReviewDecisionPayload`
- `RequestedChange`
- `ReviewPacketStatus = 'ready' | 'in_review' | 'completed' | 'archived'`
- `ReviewDecision = 'none' | 'approved' | 'changes_requested'`

- [ ] **Step 4: Implement API DTO contracts**

Define request/response shapes for command inventory endpoints, especially run/rerun/force-rerun and review decisions.

- [ ] **Step 5: Add Zod schemas**

At minimum:

- `runSpecSchema`
- `executorResultSchema`
- `reviewDecisionPayloadSchema`
- `selfReviewResultSchema`

- [ ] **Step 6: Run contract tests**

Run: `pnpm test tests/contracts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts tests/contracts
git commit -m "feat: define P0 contracts"
```

## Task 3: Domain State and Validation Rules

**Files:**
- Create: `packages/domain/src/types.ts`
- Create: `packages/domain/src/states.ts`
- Create: `packages/domain/src/validators.ts`
- Create: `packages/domain/src/completion.ts`
- Create/modify: `packages/domain/src/index.ts`
- Test: `tests/domain/states.test.ts`
- Test: `tests/domain/validators.test.ts`

- [ ] **Step 1: Write failing state tests**

Cover WorkItem, Spec/Plan, ExecutionPackage, RunSession, and ReviewPacket transitions from spec section 11.1.

Run: `pnpm test tests/domain/states.test.ts`

Expected: FAIL.

- [ ] **Step 2: Implement entity and enum types**

Define P0 entity interfaces for Project, ProjectRepo, WorkItem, Spec, SpecRevision, Plan, PlanRevision, ExecutionPackage, dependency, RunSession, ReviewPacket, ObjectEvent, StatusHistory, Artifact, and Decision.

- [ ] **Step 3: Implement transition functions**

Functions:

- `transitionWorkItem`
- `transitionSpecPlan`
- `transitionExecutionPackage`
- `transitionRunSession`
- `transitionReviewPacket`

Throw typed domain errors for invalid transitions.

- [ ] **Step 4: Write failing validator tests**

Cover:

- repo belongs to project
- Package single-repo constraint
- required checks present
- owner and reviewer present
- dependency cycle detection
- edit allowed only in `draft` or `ready`
- force-rerun only with open ReviewPacket and execution owner actor

- [ ] **Step 5: Implement validators**

Implement pure validation functions in `validators.ts`.

- [ ] **Step 6: Implement completion derivation**

`deriveWorkItemCompletion` returns done only when all Packages have successful runs, review-approved completed decisions, and required artifacts.

- [ ] **Step 7: Run domain tests**

Run: `pnpm test tests/domain`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/domain tests/domain
git commit -m "feat: implement P0 domain rules"
```

## Task 4: Drizzle Schema and Repository Boundary

**Files:**
- Create: `packages/db/src/schema/*.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/repositories/p0-repository.ts`
- Create: `packages/db/src/repositories/in-memory-p0-repository.ts`
- Create: `packages/db/src/repositories/drizzle-p0-repository.ts`
- Create/modify: `packages/db/src/index.ts`
- Test: `tests/db/schema.test.ts`
- Test: `tests/db/repository.test.ts`

- [ ] **Step 1: Write schema tests**

Check table exports exist for all P0 entities and enum values include P0 statuses.

- [ ] **Step 2: Implement Drizzle schema**

Create tables for:

- projects, project_repos
- work_items
- specs, spec_revisions
- plans, plan_revisions
- execution_packages, execution_package_dependencies
- run_sessions
- review_packets
- object_events, status_histories, artifacts, decisions

Use JSONB for structured docs, checks, artifacts, changed files, and snapshots.

- [ ] **Step 3: Implement repository interface**

`P0Repository` must expose methods used by API/workflow, not raw table access.

- [ ] **Step 4: Implement in-memory repository for tests**

This is only a test adapter. Runtime API should default to Drizzle repository.

- [ ] **Step 5: Implement Drizzle runtime repository**

Implement core CRUD and query methods. If full integration tests need Docker/Postgres, mark them as optional and keep unit tests on the in-memory adapter.

- [ ] **Step 6: Run db tests**

Run: `pnpm test tests/db`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db tests/db
git commit -m "feat: add P0 Drizzle schema and repositories"
```

## Task 5: Executor and Self-Review Adapters

**Files:**
- Create: `packages/executor/src/mock-executor.ts`
- Create: `packages/executor/src/local-codex-preflight.ts`
- Create: `packages/executor/src/local-codex-executor.ts`
- Create: `packages/executor/src/self-review.ts`
- Create/modify: `packages/executor/src/index.ts`
- Test: `tests/executor/mock-executor.test.ts`
- Test: `tests/executor/self-review.test.ts`
- Test: `tests/executor/local-codex-preflight.test.ts`

- [ ] **Step 1: Write mock executor tests**

Cover success, blocking check failure, non-blocking check failure, patch artifact, changed files, and `workflow_only=true` metadata.

- [ ] **Step 2: Implement mock executor**

`runMockExecutor(runSpec)` returns deterministic `ExecutorResult`. Use `runSpec.raw_metadata?.mock_mode` if present; otherwise success.

- [ ] **Step 3: Write self-review tests**

Cover successful mock self-review, failed self-review degradation, and rerun requested-change context.

- [ ] **Step 4: Implement self-review adapter**

`runMockSelfReview(input)` returns `SelfReviewResult`.

- [ ] **Step 5: Write local preflight tests**

Use temp directories. Cover missing repo, non-git repo, unresolved base commit, unwritable artifact root, missing Codex runtime, workspace prepare failure, and confirm missing check command is not preflight failure.

- [ ] **Step 6: Implement local Codex preflight**

Do not invoke real Codex in tests. Accept injectable command checker and filesystem helpers.

- [ ] **Step 7: Implement local Codex executor**

It should run preflight and return `preflight_failed` if invalid. Implement the real execution path behind an injectable `CodexRunner` interface:

- create disposable worktree/workspace from `base_commit_sha` or `default_branch`
- invoke Codex with the frozen RunSpec objective, context, allowed/forbidden paths, and requested-change context
- collect changed files with `git diff --name-status`
- write patch artifact with `git diff`
- run required check commands in the disposable workspace
- apply blocking/non-blocking check semantics from the spec
- retain workspace reference and artifact refs
- never push, open PR, merge, or release

The default runner may return `executor_process_failed` only when the Codex runtime is unavailable after preflight has passed. Tests should use an injected fake runner that creates real file changes in a temp Git repo so patch/diff and changed-file collection are exercised.

- [ ] **Step 8: Run executor tests**

Run: `pnpm test tests/executor`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/executor tests/executor
git commit -m "feat: add executor and self-review adapters"
```

## Task 6: Package Execution Workflow

**Files:**
- Create: `packages/workflow/src/activities.ts`
- Create: `packages/workflow/src/package-execution-workflow.ts`
- Create/modify: `packages/workflow/src/index.ts`
- Test: `tests/workflow/package-execution-workflow.test.ts`

- [ ] **Step 1: Write workflow tests**

Cover:

- success creates ReviewPacket
- non-blocking check failure creates ReviewPacket with risk
- blocking check failure creates no ReviewPacket
- failed self-review still creates ReviewPacket
- rerun includes requested-change context
- force-rerun archives open ReviewPacket
- duplicate run idempotency

- [ ] **Step 2: Implement framework-neutral workflow function**

`executePackageRun({ repository, runSessionId, executor, selfReview })`.

- [ ] **Step 3: Implement RunSpec builder**

Load Package, WorkItem, SpecRevision, PlanRevision, ProjectRepo, latest requested-change decision, and required checks.

- [ ] **Step 4: Implement result persistence**

Persist RunSession status, artifacts, ObjectEvent, StatusHistory, and ReviewPacket. Only workflow writes execution progress/final result.

- [ ] **Step 5: Add Temporal wrapper exports**

Expose workflow/activity functions that can be registered by `apps/workflow-worker`.

- [ ] **Step 6: Run workflow tests**

Run: `pnpm test tests/workflow`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/workflow tests/workflow
git commit -m "feat: implement package execution workflow"
```

## Task 7: Control Plane API

**Files:**
- Create: `apps/control-plane-api/src/main.ts`
- Create: `apps/control-plane-api/src/app.module.ts`
- Create: `apps/control-plane-api/src/p0/p0.module.ts`
- Create: `apps/control-plane-api/src/p0/p0.controller.ts`
- Create: `apps/control-plane-api/src/p0/p0.service.ts`
- Create: `apps/control-plane-api/src/p0/dto.ts`
- Test: `tests/api/delivery-flow.test.ts`

- [x] **Step 1: Write API tests**

Use Nest testing module + Supertest. Cover full command inventory enough for P0 flow:

- create Project/Repo
- create WorkItem
- create/approve Spec
- create/approve Plan
- generate Spec draft
- generate Plan draft
- generate Package draft
- generate Package
- manually create/edit Package
- edit Package while ReviewPacket is `ready` or `in_review` archives the open packet and preserves old RunSessions
- mark ready
- run/rerun/force-rerun, including owner-only validation for force-rerun
- approve/request changes
- cockpit/timeline reads

- [x] **Step 2: Implement service methods**

Service uses repository, domain validators, and workflow entrypoint.

Add deterministic mock AI draft adapter methods:

- Spec draft: creates a SpecRevision from WorkItem goal/success criteria with scope, acceptance criteria, and test strategy summary.
- Plan draft: creates a PlanRevision from approved SpecRevision with split strategy and test matrix.
- Package draft: generates one or more draft ExecutionPackages from approved PlanRevision.

These adapters must write ObjectEvent records and must not mutate approved revisions on failure.

- [x] **Step 3: Implement controller routes**

Match spec command inventory exactly.

`PATCH /execution-packages/:packageId` must archive an open ReviewPacket if one exists in `ready` or `in_review`, leave completed ReviewPackets immutable, preserve old RunSessions, and ensure the next run creates a new RunSpec snapshot.

- [x] **Step 4: Implement query responses**

WorkItem cockpit includes current Spec/Plan, Packages, RunSessions, ReviewPackets, next actions, and completion state. Timeline merges ObjectEvent, StatusHistory, Decision, and Artifact summaries.

- [x] **Step 5: Run API tests**

Run: `pnpm test tests/api`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add apps/control-plane-api tests/api
git commit -m "feat: add P0 control plane API"
```

## Task 8: Executor Gateway and Workflow Worker Apps

**Files:**
- Create: `apps/executor-gateway/src/main.ts`
- Create: `apps/executor-gateway/src/app.module.ts`
- Create: `apps/executor-gateway/src/executor.controller.ts`
- Create: `apps/executor-gateway/src/executor.service.ts`
- Create: `apps/workflow-worker/src/main.ts`
- Create: `apps/workflow-worker/src/worker.ts`

- [x] **Step 1: Implement executor-gateway API**

Routes:

- `POST /internal/executions`
- `GET /internal/executions/:executionId`

Gateway stores transient execution results only and never writes domain tables.

- [x] **Step 2: Wire mock and local_codex adapters**

Select adapter from `RunSpec.executor_type`.

- [x] **Step 3: Implement workflow worker startup**

Register P0 workflow/activities. If Temporal is unavailable, startup should fail loudly with a clear error.

- [x] **Step 4: Build apps**

Run:

```bash
pnpm --filter @forgeloop/executor-gateway build
pnpm --filter @forgeloop/workflow-worker build
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/executor-gateway apps/workflow-worker
git commit -m "feat: add executor gateway and workflow worker"
```

## Task 9: Minimal Web Workbench

**Files:**
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/api.ts`
- Create: `apps/web/src/styles.css`

- [x] **Step 1: Implement API client**

Functions for WorkItem list/detail/cockpit/timeline, Spec/Plan commands, Package commands, RunSession detail, and ReviewPacket decisions.

- [x] **Step 2: Implement single-screen workbench**

Sections:

- Work Items
- Spec/Plan
- Packages
- Run/Review
- Timeline

- [x] **Step 3: Add workflow actions**

Forms/buttons for create, approve, generate package, manual package, mark ready, run, request changes, rerun, approve.

- [x] **Step 4: Render operational state**

Show phase/gate/activity/resolution, run status, review status/decision, failed checks, artifacts, and next action.

- [x] **Step 5: Build web app**

Run: `pnpm --filter @forgeloop/web build`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat: add minimum P0 workbench"
```

## Task 10: P0 Smoke Tests, Dogfood Script, and Docs

**Files:**
- Create: `tests/smoke/p0-smoke.test.ts`
- Create: `scripts/p0-dogfood.ts`
- Modify: `package.json`
- Modify: `README.md`
- Create: `docs/superpowers/reports/p0-delivery-loop-verification.md`

- [ ] **Step 1: Write smoke tests**

Cover:

```text
Work Item -> Spec approval -> Plan approval -> Package run -> Review decision
```

and:

```text
Work Item -> Spec approval -> Plan approval -> Package run -> changes_requested -> edit Package or rerun -> new RunSession -> new Review Packet -> approve
```

- [ ] **Step 2: Add stale packet smoke test**

Use `force-rerun` to archive open ReviewPacket before human decision.

- [ ] **Step 3: Add dogfood script**

Creates three WorkItems:

- feature with `local_codex` execution path against a server-configured local repo checkout
- bugfix with `local_codex` execution path against a server-configured local repo checkout
- test/refactor with `mock`

Each local_codex dogfood item must produce a review-approved patch/diff artifact, changed-files list, required-check results, and retained workspace/artifact reference. If Codex is unavailable, the script must exit non-zero for local_codex acceptance and write the limitation to the verification report; mock/control-flow validation is not a substitute for the two required local_codex dogfood items.

- [ ] **Step 4: Add scripts**

Add `smoke:p0` and `dogfood:p0` to root `package.json`.

- [ ] **Step 5: Update README**

Document install, local infra, test, API, Web, smoke, dogfood, and P0 boundaries.

- [ ] **Step 6: Add verification report**

Record commands to run and expected outcomes.

- [ ] **Step 7: Run verification**

Run:

```bash
pnpm test
pnpm build
pnpm smoke:p0
```

Expected: PASS. Document any local Codex unavailability.

- [ ] **Step 8: Commit**

```bash
git add tests/smoke scripts package.json README.md docs/superpowers/reports
git commit -m "test: add P0 smoke and dogfood flows"
```

## Final Gate

After Task 10:

- Run `pnpm test`
- Run `pnpm build`
- Run `pnpm smoke:p0`
- Dispatch final code-review subagent for spec compliance and code quality.
- Use `superpowers:finishing-a-development-branch`.
