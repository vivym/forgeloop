> Superseded historical migration note: this document mentions the old subsystem name for audit history only. Current commands, routes, files, and product docs use delivery terminology.

# P1 Core Schema Release Flow Implementation Plan

## Status

Completed and merged to `main` on 2026-05-10.

- Merge head: `ac02e28` (`Tighten release link ordering persistence`)
- Verified after merge: `pnpm vitest run tests/db/repository-contract.ts tests/db/repository.test.ts`
- Verified after merge: `pnpm --filter @forgeloop/db build`

Superseded scope note, 2026-05-11: this plan delivered the core schema and Release aggregate foundation. The product command/query/web/dogfood Release surface is tracked by `docs/superpowers/plans/2026-05-11-p1-release-risk-radar-product-surface.md`; use that plan and spec as the current source of truth for `ReleaseModule`, release cockpit/replay, Release Owner UI, public evidence backlinks, and Release Flow dogfood.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate ForgeLoop's landed core schema to the V0 architecture shape and add a first-class local Release Flow MVP without preserving old P0 enum/state compatibility.

**Architecture:** Keep command/object writes split from read models: P0Module remains responsible for WorkItem/Spec/Plan/Package/Run/Review commands. This foundation plan prepared Release domain/schema/repository contracts; the current product surface plan owns `ReleaseModule`, lightweight Release resources, release cockpit/replay reads, and Release Owner UI. Domain state machines and repository contracts drive both in-memory and Drizzle-backed persistence, with one shared public evidence serializer for replay, evidence chain, and Release surfaces.

**Tech Stack:** TypeScript, NestJS, Drizzle/Postgres, Vitest, Supertest, React/Vite, pnpm workspaces, local Codex dogfood scripts.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-05-09-p1-core-schema-release-flow-design.md`
- Architecture references:
  - `docs/architecture-design/v0/entity-design.md`
  - `docs/architecture-design/v0/drizzle.md`
  - `docs/architecture-design/v0/status_design.md`
  - `docs/architecture-design/v0/query.md`
  - `docs/architecture-design/v0/trace-evidence-plane.md`
- Existing query cleanup plan to preserve, not duplicate: `docs/superpowers/plans/2026-05-09-p0-query-surface-cleanup.md`
- Current workspace for planning: `/Users/viv/projs/forgeloop`

## Non-Negotiable Scope Decisions

- This is a one-step refactor. Do not add a long-lived old enum/status compatibility layer.
- Add `Release`, `ReleaseWorkItem`, `ReleaseExecutionPackage`, and `ReleaseEvidence`.
- Do not productize `Incident`, `IncidentLink`, `Contract`, `ContractRevision`, `PackageContractLink`, or `TestEvidence`.
- Do not add a `test_evidences` table. Release test evidence is derived from RunSession checks, ExecutionPackage required checks/gates, and test-report artifacts.
- Runtime protocol rows may keep deterministic text IDs. Aggregate entity IDs must become UUID-shaped strings and Drizzle `uuid` columns where applicable.
- Durable mode rejects missing actor/org rows. Volatile fixtures may seed deterministic bootstrap records, but application code must not silently create arbitrary actors.
- Existing public API responses stay raw JSON objects/arrays, not `{ data, meta }` envelopes.
- Release replay must use an allowlist serializer and recursively strip local paths, raw refs, raw logs, raw metadata, token/secret-like keys, and unknown raw payload keys.

## Current Baseline

- Domain types live mostly in `packages/domain/src/types.ts`; state machines live in `packages/domain/src/states.ts`; validators live in `packages/domain/src/validators.ts`.
- Persistence is one `P0Repository` interface with `InMemoryP0Repository` and `DrizzleP0Repository`.
- Drizzle schema files currently use text IDs and P0 enum values in `packages/db/src/schema/*`.
- QueryModule already owns `GET /query/work-item-cockpit/:workItemId` and `GET /query/replay/:objectType/:objectId`.
- P0Module currently owns project/work item/spec/plan/package/run/review command routes and evidence-chain route.
- Web app currently has split command/query clients but its types still reflect P0 work-item kind and state values.
- Durable tests and dogfood rely on `FORGELOOP_DATABASE_URL` or `FORGELOOP_TEST_DATABASE_URL`; disposable DB reset must be explicit and guarded.

## File Structure

### Domain And Contracts

- Modify `packages/domain/src/types.ts`
  - Add `Organization`, `Actor`, all migrated core fields, Release model types, generalized evidence/audit types, and UUID-shaped aggregate IDs as strings.
- Modify `packages/domain/src/states.ts`
  - Expand WorkItem, Spec/Plan, ExecutionPackage, ReviewPacket state machines.
  - Add Release lifecycle transitions.
- Modify `packages/domain/src/validators.ts`
  - Add actor/org presence validation hooks where repository-backed commands need them.
  - Add Release gate validation and blocker override rules.
- Create `packages/domain/src/identity.ts`
  - Own deterministic bootstrap org/actor IDs and UUID helper constants.
- Create `packages/domain/src/release-gates.ts`
  - Own Release blocker derivation, blocker fingerprints, risk summary, and overrideability rules.
- Modify `packages/domain/src/completion.ts`
  - Preserve existing WorkItem completion behavior after new phases and Release pointers are added.
- Modify `packages/domain/src/index.ts`
  - Export new domain files.
- Modify `packages/contracts/src/api.ts`
  - Add Release command inventory items and public response schemas.
- Create `packages/contracts/src/release.ts`
  - Own zod schemas for Release, ReleaseEvidence, blockers, cockpit, replay entries, and command payloads.
- Modify `packages/contracts/src/review.ts`
  - Expand review status/decision schemas to match migrated ReviewPacket values.
- Modify `packages/contracts/src/executor.ts`
  - Add/confirm `test_report` or equivalent artifact kind if needed for Release gates.
- Modify `packages/contracts/src/index.ts`
  - Export Release contracts.

### Database Schema And Repository

- Modify `packages/db/src/schema/_shared.ts`
  - Add UUID-based shared columns, org/actor enums, normalized priority/risk enums, Release enums, expanded status enums, generalized decision enums.
- Create `packages/db/src/schema/organization.ts`
  - Defines `organizations`.
- Create `packages/db/src/schema/actor.ts`
  - Defines `actors`.
- Modify `packages/db/src/schema/project.ts`
  - Move `projects` to architecture container fields and add `org_id`.
  - Keep `project_repos` as runtime binding table with `org_id`.
- Modify `packages/db/src/schema/work-item.ts`
  - Add base fields, new state values, normalized kind/priority/risk, revision pointers, `current_release_id`.
- Modify `packages/db/src/schema/spec.ts`
  - Add base fields, current/approved revision pointers, actor/timestamp fields, status expansion, `based_on` fields where required.
- Modify `packages/db/src/schema/plan.ts`
  - Add base fields, current/approved revision pointers, actor/timestamp fields, and PlanRevision `based_on_spec_revision_id`.
- Modify `packages/db/src/schema/execution-package.ts`
  - Add release-ready fields, renamed owner fields, expanded states, lineage, current run/review/release pointers.
- Modify `packages/db/src/schema/run-session.ts`
  - Add org/project/package context fields and preserve worker/runtime metadata columns.
- Modify `packages/db/src/schema/review-packet.ts`
  - Add spec/plan refs, richer review payload fields, expanded status/decision values.
- Modify `packages/db/src/schema/evidence.ts`
  - Generalize `object_events`, `status_histories`, `artifacts`, `decisions`; preserve current trace substrate.
- Create `packages/db/src/schema/release.ts`
  - Defines `releases`, `release_work_items`, `release_execution_packages`, `release_evidences`.
  - Use hard foreign keys for `release_work_items.release_id`, `release_work_items.work_item_id`, `release_execution_packages.release_id`, and `release_execution_packages.package_id`; `missing_work_item` and `missing_execution_package` blockers cover soft-deleted, archived, unauthorized, or intentionally corrupted in-memory/test rows rather than normal durable FK misses.
  - Field convention: domain/repository/API link objects expose `execution_package_id`; Drizzle maps that to the architecture table column `package_id`.
- Modify `packages/db/src/schema/index.ts`
  - Export new schema files.
- Modify `packages/db/src/repositories/p0-repository.ts`
  - Add org/actor operations, release operations, generalized evidence methods, and keep runtime methods.
- Modify `packages/db/src/repositories/in-memory-p0-repository.ts`
  - Implement new repository contract without compatibility aliases.
- Modify `packages/db/src/repositories/drizzle-p0-repository.ts`
  - Implement new contract with uuid columns and explicit JSON conversion.
- Modify `packages/db/src/client.ts`
  - Keep Drizzle client creation and expose reset helper entry points if needed.
- Create `packages/db/src/reset.ts`
  - Own guarded local/disposable DB reset helpers.
- Modify `packages/db/src/index.ts`
  - Export new repository/schema/query/reset modules.

### Backend API

- Modify `apps/control-plane-api/src/p0/dto.ts`
  - Move P0 DTOs to new enum values and actor/org-aware inputs.
- Modify `apps/control-plane-api/src/p0/p0.service.ts`
  - Generate UUID-shaped aggregate IDs.
  - Seed/require deterministic org/actor anchors.
  - Update P0 commands to migrated states and generalized decisions.
- Modify `apps/control-plane-api/src/p0/p0.controller.ts`
  - Keep only WorkItem/Spec/Plan/Package/Run/Review command/read resources already owned by P0.
- Modify `apps/control-plane-api/src/p0/p0.module.ts`
  - Provide bootstrap identity helpers and keep repository exports.
- Create `apps/control-plane-api/src/modules/release/release.dto.ts`
  - Own Release command DTO zod schemas.
- Create `apps/control-plane-api/src/modules/release/release.service.ts`
  - Own Release CRUD/control lifecycle, link commands, evidence commands, and raw Release resource reads.
- Create `apps/control-plane-api/src/modules/release/release.controller.ts`
  - Own `/releases`, `PATCH /releases/:releaseId`, link/unlink routes, control routes, and evidence routes.
- Create `apps/control-plane-api/src/modules/release/release.module.ts`
  - Wires Release service with `P0_REPOSITORY`.
- Modify `apps/control-plane-api/src/modules/query/query.service.ts`
  - Add Release cockpit and Release replay query methods.
- Modify `apps/control-plane-api/src/modules/query/query.controller.ts`
  - Add `GET /query/release-cockpit/:releaseId` and extend generic `GET /query/replay/:objectType/:objectId` for `release`, so `GET /query/replay/release/:releaseId` works without a separate replay route.
- Modify `apps/control-plane-api/src/app.module.ts`
  - Register `ReleaseModule`.

### Query And Public Serialization

- Create `packages/db/src/queries/public-evidence-serialization.ts`
  - Shared allowlist serializers for public artifact refs, Decision, ObjectEvent, StatusHistory, ReleaseEvidence, and replay payloads.
- Modify `packages/db/src/queries/replay-queries.ts`
  - Use shared serializer and support work item plus release replay.
- Create `packages/db/src/queries/release-cockpit-queries.ts`
  - Builds Release cockpit with linked work items/packages, evidence, blockers, override state, and next actions.
- Modify `packages/db/src/queries/work-item-cockpit-queries.ts`
  - Include `current_release_id` and new completion state without leaking raw evidence.

### Web App

- Modify `apps/web/src/api/types.ts`
  - Replace old WorkItem kinds/statuses and add Release DTO/response types.
- Modify `apps/web/src/api/commands.ts`
  - Add Release command methods.
- Modify `apps/web/src/api/query.ts`
  - Add Release cockpit/replay query methods.
- Modify `apps/web/src/api.ts`
  - Export Release types and clients.
- Modify `apps/web/src/workbenchState.ts`
  - Add pure Release view helpers and blocker label helpers.
- Modify `apps/web/src/App.tsx`
  - Add a compact Release panel/workbench surface using the existing app style.
- Modify `apps/web/src/styles.css`
  - Add responsive styling for Release panel without nested card-in-card layouts.

### Tests, Scripts, Reports

- Modify `tests/db/schema.test.ts`
  - Assert migrated schema tables, uuid columns, and enum value sets.
- Create `tests/db/repository-contract.ts`
  - Shared repository contract suite for in-memory and Drizzle adapters.
- Modify `tests/db/repository.test.ts`
  - Use shared contract and migrated fixtures.
- Create `tests/db/reset.test.ts`
  - Guarded disposable DB reset tests.
- Modify `tests/helpers/p0-runtime-fixtures.ts`
  - Seed deterministic org/actor rows and UUID-shaped aggregate IDs.
- Create `tests/helpers/p0-runtime-fixtures.test.ts`
  - Dedicated tests for identity seeding and missing actor/org rejection; do not run the helper module itself as a test target.
- Modify `tests/domain/states.test.ts`
  - Migrated WorkItem/Spec/Plan/Package state tests.
- Create `tests/domain/release-states.test.ts`
  - Release lifecycle state machine tests.
- Create `tests/domain/release-gates.test.ts`
  - Release blocker derivation and overrideability tests.
- Modify `tests/contracts/contracts.test.ts`
  - Include Release schema contracts and command inventory.
- Create `tests/api/release-flow.test.ts`
  - ReleaseModule command lifecycle tests.
- Modify `tests/api/query-module.test.ts`
  - Add Release cockpit/replay tests and redaction assertions.
- Modify existing API/runtime/workflow/smoke tests that use old enum values:
  - `tests/api/delivery-flow.test.ts`
  - `tests/api/durable-id-generation.test.ts`
  - `tests/api/durable-revision-lookup.test.ts`
  - `tests/api/evidence-chain.test.ts`
  - `tests/api/run-auth.test.ts`
  - `tests/api/run-events.test.ts`
  - `tests/api/run-worker-lifecycle.test.ts`
  - `tests/db/run-runtime-repository.test.ts`
  - `tests/workflow/execution-finalizer.test.ts`
  - `tests/workflow/package-execution-workflow.test.ts`
  - `tests/run-worker/*.test.ts`
  - `tests/smoke/*.test.ts`
- Modify dogfood scripts:
  - `scripts/p0-dogfood.ts`
  - `scripts/p0-durable-dogfood.ts`
  - `scripts/p0-local-codex-dogfood.ts`
  - `scripts/p0-dogfood-work-items.ts`
- Create `scripts/release-flow-dogfood.ts`
  - Deterministic local Release Flow dogfood.
- Modify `package.json`
  - Add `dogfood:release-flow`.
- Create `docs/superpowers/reports/p1-core-schema-release-flow-verification.md`
  - Verification report template/result target.

---

### Task 0: Preflight And Baseline Safety

**Files:**
- Read: `docs/superpowers/specs/2026-05-09-p1-core-schema-release-flow-design.md`
- Read: `docs/superpowers/plans/2026-05-09-p0-query-surface-cleanup.md`
- Read: `package.json`
- No code changes.

- [ ] **Step 1: Confirm worktree and branch state**

Run:

```bash
git status --short --branch
git log --oneline -5
```

Expected:
- Working tree is clean or only contains this plan document if it has not been committed yet.
- You are not inside another person's `p0-durable-revision-lookup-plan` worktree.

- [ ] **Step 2: Create an isolated implementation worktree**

Run from `/Users/viv/projs/forgeloop`:

```bash
git worktree add .worktrees/p1-core-schema-release-flow -b feature/p1-core-schema-release-flow main
cd .worktrees/p1-core-schema-release-flow
```

Expected: new worktree on `feature/p1-core-schema-release-flow`.

- [ ] **Step 3: Record baseline verification**

Run:

```bash
pnpm test
pnpm build
```

Expected: baseline passes on current `main`. If it does not, capture exact failures in `docs/superpowers/reports/p1-core-schema-release-flow-verification.md` before editing.

- [ ] **Step 4: Confirm no implementation starts before test tasks**

Run:

```bash
git status --short
```

Expected: clean working tree.

---

### Task 1: Lock Migrated Domain Contracts With Failing Tests

**Files:**
- Modify: `tests/domain/states.test.ts`
- Create: `tests/domain/release-states.test.ts`
- Create: `tests/domain/release-gates.test.ts`
- Modify: `tests/domain/validators.test.ts`
- Modify: `tests/contracts/contracts.test.ts`
- Create: `packages/contracts/src/release.ts`
- Modify later: `packages/domain/src/types.ts`
- Modify later: `packages/domain/src/states.ts`
- Modify later: `packages/domain/src/validators.ts`
- Create later: `packages/domain/src/release-gates.ts`

- [ ] **Step 1: Write failing enum/state tests**

Add tests asserting these exact target values:

```ts
expect(workItemKinds).toEqual(['requirement', 'bug', 'tech_debt']);
expect(workItemPhases).toEqual(['draft', 'triage', 'spec', 'plan', 'execution', 'release', 'observing', 'done', 'closed']);
expect(executionPackageGateStates).toContain('release_ready');
expect(executionPackageGateStates).not.toContain('none');
expect(reviewPacketDecisions).toEqual(['none', 'approved', 'changes_requested', 'need_more_context', 'escalate']);
```

Run:

```bash
pnpm vitest run tests/domain/states.test.ts tests/domain/validators.test.ts tests/contracts/contracts.test.ts
```

Expected: FAIL because current domain/contracts still expose old P0 values.

- [ ] **Step 2: Write failing Release lifecycle tests**

In `tests/domain/release-states.test.ts`, cover:
- create Release -> `draft/idle/not_submitted/none`
- first valid link -> `candidate/idle/not_submitted/none`
- submit -> `approval/awaiting_human/awaiting_approval/none`
- approve with no blockers -> `rollout/idle/approved/none`
- override approve -> `rollout/idle/approved/none` plus two Decision intents
- start observing -> `observing/idle/rollout_succeeded/none`
- close completed -> `completed/idle/rollout_succeeded/completed`
- close rolled back/cancelled -> `closed/idle/*/rolled_back|cancelled`

Run:

```bash
pnpm vitest run tests/domain/release-states.test.ts
```

Expected: FAIL because Release state machine does not exist.

- [ ] **Step 3: Write failing Release gate tests**

In `tests/domain/release-gates.test.ts`, assert all blocker codes from the spec:

```ts
const expectedCodes = [
  'missing_work_item',
  'missing_execution_package',
  'empty_work_item_scope',
  'empty_execution_package_scope',
  'work_item_not_complete',
  'package_not_release_ready',
  'missing_approved_review_packet',
  'failed_required_check',
  'missing_required_artifact',
  'evidence_redacted',
  'stale_or_superseded_evidence',
  'missing_rollout_strategy',
  'missing_rollback_plan',
  'missing_observation_plan',
];
```

Also assert `empty_work_item_scope` and `empty_execution_package_scope` are not overrideable, evidence/risk blockers are overrideable, and `missing_rollout_strategy`, `missing_rollback_plan`, and `missing_observation_plan` are overrideable risk/planning blockers rather than structural blockers.

Add one scenario test for each required blocker predicate, not just enum membership:
- `missing_work_item` when a ReleaseWorkItem link points at an archived, soft-deleted, unauthorized, or absent WorkItem;
- `missing_execution_package` when a ReleaseExecutionPackage link points at an archived, soft-deleted, unauthorized, or absent ExecutionPackage;
- `empty_work_item_scope` when the Release has zero valid WorkItem links, and `empty_execution_package_scope` when it has zero valid ExecutionPackage links; either blocker prevents `submit-for-approval`, plain `approve`, and `override-approve`;
- `work_item_not_complete` when linked WorkItem resolution is not completed and completion derivation is false;
- `package_not_release_ready` when linked package gate is not `release_ready`/`released` and fallback approved-review/check evidence is insufficient;
- `missing_approved_review_packet` when the package has no current/latest non-archived approved ReviewPacket;
- `failed_required_check` when any required check is missing or not `succeeded`;
- `missing_required_artifact` when a required artifact kind is absent from run, review, and linked Artifact evidence;
- `evidence_redacted` when only raw/local/redacted evidence could satisfy a requirement;
- `stale_or_superseded_evidence` when Evidence Chain marks the relevant run, review packet, artifact, decision, or trace link stale/superseded.
- `missing_rollout_strategy` when the Release has no rollout strategy;
- `missing_rollback_plan` when the Release has no rollback plan;
- `missing_observation_plan` when the Release has no observation plan.

Add evidence-selection tests for the required current/latest package fallback order:
- prefer `current_review_packet_id` / `current_run_session_id` when both pointers exist;
- otherwise use `last_run_session_id` and the non-archived ReviewPacket for that run;
- otherwise use the latest non-archived ReviewPacket by creation time;
- ignore archived ReviewPackets even when they are newer.

Run:

```bash
pnpm vitest run tests/domain/release-gates.test.ts
```

Expected: FAIL because Release gate derivation does not exist.

- [ ] **Step 4: Implement minimal domain/contracts**

Implement:
- `Organization` and `Actor` interfaces.
- Normalized core enums.
- Release interfaces and transitions.
- Release blocker derivation and `isReleaseBlockerOverrideable()`.
- Contract zod schemas for Release responses and command DTOs.

Use UUID-shaped deterministic constants in `packages/domain/src/identity.ts`:

```ts
export const DEFAULT_ORG_ID = '00000000-0000-4000-8000-000000000001';
export const DEFAULT_HUMAN_ACTOR_ID = '00000000-0000-4000-8000-000000000101';
export const DEFAULT_SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000102';
export const DEFAULT_AI_ACTOR_ID = '00000000-0000-4000-8000-000000000103';
```

- [ ] **Step 5: Run domain/contract tests**

Run:

```bash
pnpm vitest run tests/domain/states.test.ts tests/domain/release-states.test.ts tests/domain/release-gates.test.ts tests/domain/validators.test.ts tests/contracts/contracts.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit domain contract baseline**

Run:

```bash
git add packages/domain/src packages/contracts/src tests/domain tests/contracts
git commit -m "feat: define migrated core and release domain contracts"
```

Expected: commit includes only domain/contract/test changes.

---

### Task 2: Add Schema Tests For One-Step Core Migration

**Files:**
- Modify: `tests/db/schema.test.ts`
- Modify later: `packages/db/src/schema/_shared.ts`
- Create later: `packages/db/src/schema/organization.ts`
- Create later: `packages/db/src/schema/actor.ts`
- Create later: `packages/db/src/schema/release.ts`
- Modify later: all existing files under `packages/db/src/schema/`

- [ ] **Step 1: Write failing table/export tests**

Update `requiredTables` in `tests/db/schema.test.ts` to include:

```ts
organizations,
actors,
releases,
release_work_items,
release_execution_packages,
release_evidences,
```

Assert it does not include `test_evidences`, `incidents`, `contracts`, or contract/incident link tables.

Run:

```bash
pnpm vitest run tests/db/schema.test.ts
```

Expected: FAIL because new tables are missing.

- [ ] **Step 2: Write failing enum tests**

Assert old enum values are gone where required:

```ts
expect(work_item_kind_values).toEqual(['requirement', 'bug', 'tech_debt']);
expect(execution_package_activity_state_values).not.toContain('awaiting_ai');
expect(execution_package_gate_state_values).not.toContain('none');
expect(decision_outcome_values).toEqual([
  'approved',
  'changes_requested',
  'rejected',
  'override_approved',
  'rolled_back',
  'cancelled',
  'completed',
]);
```

Run:

```bash
pnpm vitest run tests/db/schema.test.ts
```

Expected: FAIL because old enum sets are still exported.

- [ ] **Step 3: Write failing column type tests**

Assert aggregate `id` columns are `PgUUID` and runtime protocol IDs stay text:

```ts
expect(columnType(organizations, 'id')).toBe('PgUUID');
expect(columnType(actors, 'id')).toBe('PgUUID');
expect(columnType(projects, 'id')).toBe('PgUUID');
expect(columnType(work_items, 'id')).toBe('PgUUID');
expect(columnType(specs, 'id')).toBe('PgUUID');
expect(columnType(spec_revisions, 'id')).toBe('PgUUID');
expect(columnType(plans, 'id')).toBe('PgUUID');
expect(columnType(plan_revisions, 'id')).toBe('PgUUID');
expect(columnType(execution_packages, 'id')).toBe('PgUUID');
expect(columnType(run_sessions, 'id')).toBe('PgUUID');
expect(columnType(review_packets, 'id')).toBe('PgUUID');
expect(columnType(artifacts, 'id')).toBe('PgUUID');
expect(columnType(decisions, 'id')).toBe('PgUUID');
expect(columnType(releases, 'id')).toBe('PgUUID');
expect(columnType(release_evidences, 'id')).toBe('PgUUID');
expect(columnType(run_events, 'id')).toBe('PgText');
expect(columnType(run_commands, 'id')).toBe('PgText');
expect(columnType(run_worker_leases, 'id')).toBe('PgText');
expect(columnType(execution_packages, 'required_checks')).toBe('PgJsonb');
expect(columnType(execution_packages, 'required_test_gates')).toBe('PgJsonb');
expect(columnType(release_evidences, 'object_ref')).toBe('PgJsonb');
```

Run:

```bash
pnpm vitest run tests/db/schema.test.ts
```

Expected: FAIL until schema migrates.

- [ ] **Step 4: Implement migrated schema**

Use Drizzle `uuid`, `text`, `jsonb`, indexes, and composite primary keys. Required minimum columns:
- `organizations`: `id`, `name`, `created_at`
- `actors`: `id`, `org_id`, `actor_type`, `display_name`, nullable `email`, `created_at`
- aggregate tables: `org_id`, project link where applicable, key/title/description/visibility/source_type/labels/extra/audit/archive/delete fields where specified
- `execution_packages.required_checks` and `execution_packages.required_test_gates`: `jsonb` columns storing typed `RequiredCheckSpec[]` / required test gate specs, not comma-delimited text
- `release_evidences.object_ref`: nullable `jsonb` storing the spec's `ReleaseEvidenceObjectRef` shape, plus `extra` as `jsonb`
- link tables: composite keys, release/package/work item IDs, timestamps
- release link tables must use durable hard foreign keys for normal Postgres operation; do not rely on Release blockers to mask missing physical rows in the durable database
- evidence/audit tables: object type/id, actor type/id, reason/payload, field names, generalized decision type/outcome/evidence refs

Do not create out-of-scope product tables.

- [ ] **Step 5: Run schema tests**

Run:

```bash
pnpm vitest run tests/db/schema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit schema migration**

Run:

```bash
git add packages/db/src/schema tests/db/schema.test.ts
git commit -m "feat: migrate core drizzle schema and add release tables"
```

Expected: commit includes schema and schema tests only.

---

### Task 3: Build Shared Repository Contract And Disposable DB Reset

**Files:**
- Create: `tests/db/repository-contract.ts`
- Modify: `tests/db/repository.test.ts`
- Create: `tests/db/reset.test.ts`
- Create: `packages/db/src/reset.ts`
- Modify: `packages/db/src/index.ts`
- Modify later: `packages/db/src/repositories/p0-repository.ts`
- Modify later: `packages/db/src/repositories/in-memory-p0-repository.ts`
- Modify later: `packages/db/src/repositories/drizzle-p0-repository.ts`

- [ ] **Step 1: Write failing reset guard tests**

In `tests/db/reset.test.ts`, cover:
- accepts local disposable URLs whose db name contains `test`, `tmp`, or `forgeloop_dev`
- rejects production-looking hosts or database names without confirmation
- requires `FORGELOOP_CONFIRM_DB_RESET=1` for unrecognized but local URLs
- never resets when URL parsing fails

Run:

```bash
pnpm vitest run tests/db/reset.test.ts
```

Expected: FAIL because reset helper does not exist.

- [ ] **Step 2: Implement reset helper**

In `packages/db/src/reset.ts`, expose:

```ts
export function assertResettableDatabaseUrl(
  databaseUrl: string,
  env: Record<string, string | undefined> = process.env,
): void;

export async function resetForgeloopDatabase(databaseUrl: string): Promise<void>;
```

The reset function should truncate/drop known ForgeLoop tables only after guard validation. It must never be called automatically from application startup.

Run:

```bash
pnpm vitest run tests/db/reset.test.ts
```

Expected: PASS.

- [ ] **Step 3: Extract failing shared repository contract**

Create `tests/db/repository-contract.ts` with concrete assertions, not empty test bodies. The contract helper must seed a complete migrated graph and verify every adapter round-trips the same data:

- bootstrap Organization and human/system/ai Actor anchors;
- Project and ProjectRepo;
- WorkItem, Spec, SpecRevision, Plan, PlanRevision, including current and approved revision lookup pointers;
- ExecutionPackage fields needed by Release readiness, including `required_checks`, `required_test_gates`, `integration_readiness`, `current_run_session_id`, `last_run_session_id`, `current_review_packet_id`, `current_release_id`, and release-ready gate values;
- ExecutionPackageDependency rows with dependency metadata such as dependency type, reason, and timestamps;
- RunSession, RunEvent, RunCommand, RunWorkerLease, and RunEventCounter behavior;
- ReviewPacket with expanded status/decision fields;
- Release, ReleaseWorkItem, ReleaseExecutionPackage, and ReleaseEvidence rows for `review_packet`, `test_report`, and `observation_note`;
- ReleaseExecutionPackage domain/repository fields use `execution_package_id`; Drizzle maps that field to `release_execution_packages.package_id`;
- Artifact, ObjectEvent, StatusHistory, and generalized Decision rows;
- TraceEvent, TraceLink, and TraceArtifactRef rows;
- enough linked objects for Task 6 query helper tests to run against the seeded repository once those helpers are implemented.

The contract must include tests equivalent to:

```ts
it('persists bootstrap identity anchors before actor-owned writes', async () => {
  const repository = await createRepository();
  await seedBootstrapIdentity(repository);

  await expect(repository.getOrganization(DEFAULT_ORG_ID)).resolves.toMatchObject({ id: DEFAULT_ORG_ID });
  await expect(repository.getActor(DEFAULT_HUMAN_ACTOR_ID)).resolves.toMatchObject({
    id: DEFAULT_HUMAN_ACTOR_ID,
    org_id: DEFAULT_ORG_ID,
    actor_type: 'human',
  });
});

it('persists migrated core delivery records and revision lookup pointers', async () => {
  const repository = await createRepository();
  const graph = await seedMigratedDeliveryGraph(repository);

  await expect(repository.getWorkItem(graph.workItem.id)).resolves.toMatchObject({
    kind: 'requirement',
    priority: 'p0',
    risk_level: 'medium',
    current_spec_revision_id: graph.specRevision.id,
    current_plan_revision_id: graph.planRevision.id,
  });
  await expect(repository.getPlanRevision(graph.planRevision.id)).resolves.toMatchObject({
    based_on_spec_revision_id: graph.specRevision.id,
  });
  await expect(repository.getExecutionPackage(graph.executionPackage.id)).resolves.toMatchObject({
    current_run_session_id: graph.runSession.id,
    current_review_packet_id: graph.reviewPacket.id,
    required_test_gates: expect.any(Array),
    integration_readiness: expect.any(Object),
  });
});

it('persists release links, evidence, audit rows, trace rows, and query inputs', async () => {
  const repository = await createRepository();
  const graph = await seedMigratedDeliveryGraph(repository);
  await seedReleaseAndEvidenceGraph(repository, graph);

  await expect(repository.listReleaseWorkItems(graph.release.id)).resolves.toEqual([
    expect.objectContaining({ release_id: graph.release.id, work_item_id: graph.workItem.id }),
  ]);
  await expect(repository.listReleaseExecutionPackages(graph.release.id)).resolves.toEqual([
    expect.objectContaining({ release_id: graph.release.id, execution_package_id: graph.executionPackage.id }),
  ]);
  await expect(repository.listReleaseEvidences(graph.release.id)).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        evidence_type: 'review_packet',
        object_ref: expect.objectContaining({
          object_type: 'review_packet',
          object_id: graph.reviewPacket.id,
          relationship: 'supports',
        }),
      }),
      expect.objectContaining({ evidence_type: 'test_report', object_ref: expect.anything() }),
      expect.objectContaining({ evidence_type: 'observation_note', extra: expect.objectContaining({ observation: expect.any(Object) }) }),
    ]),
  );
  await expect(repository.listDecisionsForObject('release', graph.release.id)).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ decision_type: 'manual_override', outcome: 'override_approved' }),
      expect.objectContaining({ decision_type: 'release_approval', outcome: 'override_approved' }),
    ]),
  );
  await expect(repository.listObjectEvents(graph.release.id, 'release')).resolves.toEqual([
    expect.objectContaining({ event_type: 'release_override_approved', payload: expect.any(Object) }),
  ]);
  await expect(repository.listStatusHistory(graph.release.id, 'release')).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field_name: 'phase', from_value: 'approval', to_value: 'rollout' }),
      expect.objectContaining({ field_name: 'gate_state', to_value: 'approved' }),
    ]),
  );
  await expect(repository.listArtifactsForObject('release', graph.release.id)).resolves.toEqual([
    expect.objectContaining({ artifact_type: 'test_report', ref: expect.any(Object) }),
  ]);

  const traceEvents = await repository.listTraceEventsForSubject('release', graph.release.id);
  expect(traceEvents).toHaveLength(1);
  await expect(repository.listTraceLinks(traceEvents[0].id)).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ relationship: 'supports', object_type: 'review_packet' }),
      expect.objectContaining({ relationship: 'generated_by', object_type: 'run_session' }),
    ]),
  );
  await expect(repository.listTraceArtifactRefs(traceEvents[0].id)).resolves.toEqual([
    expect.objectContaining({ ref: expect.any(Object) }),
  ]);

  await expect(repository.listRunSessionsForPackage(graph.executionPackage.id)).resolves.toEqual([
    expect.objectContaining({ id: graph.runSession.id }),
  ]);
  await expect(repository.listReviewPacketsForPackage(graph.executionPackage.id)).resolves.toEqual([
    expect.objectContaining({ id: graph.reviewPacket.id }),
  ]);
});

it('preserves run event cursor sequencing, worker lease fencing, and command idempotency', async () => {
  const repository = await createRepository();
  const graph = await seedMigratedDeliveryGraph(repository);
  const first = await repository.appendRunEvent(makeRunEvent(graph, 1));
  const duplicate = await repository.appendRunEvent(makeRunEvent(graph, 1));

  expect(first.cursor).toBe('0000000001');
  expect(duplicate.cursor).toBe(first.cursor);

  await repository.claimRunWorkerLease(makeLease(graph, 'worker-1', 'lease-token-1'));
  await repository.saveRunCommand(makeRunCommand(graph, 'resume'));
  await expect(repository.claimNextRunCommand(graph.runSession.id, 'worker-1', 'lease-token-1', graph.now)).resolves.toMatchObject({
    command: expect.objectContaining({ status: 'claimed' }),
    reclaimed: false,
  });
  await expect(repository.claimNextRunCommand(graph.runSession.id, 'worker-2', 'bad-token', graph.now)).rejects.toThrow();
});
```

Wire it into `tests/db/repository.test.ts` for `InMemoryP0Repository` and a real disposable Postgres-backed `DrizzleP0Repository`. The Drizzle contract must run when `FORGELOOP_TEST_DATABASE_URL` or `FORGELOOP_DATABASE_URL` points to a resettable disposable database, after calling `resetForgeloopDatabase()`. If no disposable DB is configured, skip only the Drizzle contract with an explicit skip reason. Keep existing fake Drizzle mapping tests only as supplementary unit coverage, not as the repository contract.

Run:

```bash
pnpm vitest run tests/db/repository.test.ts
```

Expected: FAIL because repository interface/implementations lack new methods and migrated fixtures.

- [ ] **Step 4: Implement repository interface additions**

Extend `P0Repository` with:
- `saveOrganization`, `getOrganization`
- `saveActor`, `getActor`, `listActorsForOrg`
- `saveRelease`, `getRelease`, `listReleases`
- `saveReleaseWorkItem`, `listReleaseWorkItems`
- `saveReleaseExecutionPackage`, `listReleaseExecutionPackages`
- `saveReleaseEvidence`, `getReleaseEvidence`, `listReleaseEvidences`
- generalized `saveDecision`/`listDecisionsForObject` shapes
- generalized `appendStatusHistory` with `field_name`, `from_value`, `to_value`

Keep existing run event/command/lease methods behaviorally compatible.

- [ ] **Step 5: Implement in-memory repository first**

Implement new maps and list ordering. Add foreign-key-like validation only where the previous in-memory repository already enforces behavior; durable missing actor/org validation belongs in service/repository contract tests, not hidden auto-creation.

Run:

```bash
pnpm vitest run tests/db/repository.test.ts
```

Expected: in-memory contract tests PASS; disposable Postgres-backed Drizzle contract and mapping tests still FAIL until adapter is updated.

- [ ] **Step 6: Implement Drizzle repository mapping**

Update `toDbRecord`/`fromDbRecord` usage if needed for uuid/jsonb fields. Ensure nullable optional fields round-trip as `undefined` in domain objects, not `null`.

Run:

```bash
pnpm vitest run tests/db/repository.test.ts
```

Expected: PASS for in-memory contract tests, fake Drizzle mapping tests, and disposable Postgres-backed Drizzle contract tests when a resettable DB is configured. Without a disposable DB, only the Drizzle contract is skipped with an explicit reason.

- [ ] **Step 7: Run repository and reset tests together**

Run:

```bash
pnpm vitest run tests/db/reset.test.ts tests/db/repository.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit repository contract/reset**

Run:

```bash
git add packages/db/src tests/db
git commit -m "feat: add migrated repository contract and guarded db reset"
```

Expected: repository interface, implementations, and reset tests committed together.

---

### Task 4: Migrate P0 Fixtures, DTOs, And Command Service

**Files:**
- Modify: `tests/helpers/p0-runtime-fixtures.ts`
- Create: `tests/helpers/p0-runtime-fixtures.test.ts`
- Modify: `apps/control-plane-api/src/p0/dto.ts`
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
- Modify: `apps/control-plane-api/src/p0/p0.module.ts`
- Modify: `packages/domain/src/completion.ts`
- Modify: `tests/api/delivery-flow.test.ts`
- Modify: `tests/api/durable-id-generation.test.ts`
- Modify: `tests/api/durable-revision-lookup.test.ts`
- Modify: `tests/api/run-auth.test.ts`
- Modify: `tests/api/run-events.test.ts`
- Modify: `tests/api/run-worker-lifecycle.test.ts`
- Modify: `tests/db/run-runtime-repository.test.ts`
- Modify: `tests/workflow/*.test.ts`
- Modify: `tests/run-worker/*.test.ts`

- [ ] **Step 1: Update fixture helper tests to fail on missing identity**

Add `tests/helpers/p0-runtime-fixtures.test.ts` so durable-mode P0 writes reject missing actors/orgs with a clear validation error. Use seeded deterministic IDs from `packages/domain/src/identity.ts`. Keep `tests/helpers/p0-runtime-fixtures.ts` as an imported fixture/helper module, not the direct Vitest target.

Run:

```bash
pnpm vitest run tests/helpers/p0-runtime-fixtures.test.ts tests/api/run-auth.test.ts
```

Expected: FAIL because service/repository still accepts arbitrary actor strings or old fixtures do not seed identity.

- [ ] **Step 2: Migrate fixture data**

Update all fixture aggregate IDs to UUID-shaped constants. Keep protocol IDs text where required:
- `run-event:*`
- `run-command:*`
- worker lease IDs/tokens
- trace deterministic rows

Map old values:
- `feature` -> `requirement`
- `bugfix` -> `bug`
- `test_refactor` -> `tech_debt`
- priority strings -> `p0|p1|p2|p3`
- risk strings -> `low|medium|high|critical`
- ExecutionPackage `awaiting_ai` -> `ai_running` or `idle`
- ExecutionPackage gate `none` -> `not_submitted`
- WorkItem `activity_state = awaiting_ai` remains valid; do not remove or reject it.

- [ ] **Step 3: Update P0 DTO schemas**

Update zod enums in `apps/control-plane-api/src/p0/dto.ts` so incoming API tests use the migrated values. Reject old values with 400.

Run:

```bash
pnpm vitest run tests/api/delivery-flow.test.ts
```

Expected: FAIL until service maps all required fields and state transitions.

- [ ] **Step 4: Update P0Service ID and identity handling**

In `P0Service`:
- create aggregate IDs with `randomUUID()` for Project, WorkItem, Spec, SpecRevision, Plan, PlanRevision, ExecutionPackage, RunSession, ReviewPacket, Artifact, Decision
- keep deterministic text IDs for RunEvent and RunCommand
- seed deterministic default org/human/system/ai actors only in fixture/bootstrap paths, not as side effect of every command
- validate actor/org existence before durable writes
- update `event`, `history`, and `decision` helpers to new ObjectEvent/StatusHistory/Decision shapes

- [ ] **Step 5: Preserve existing P0 behavior**

Run focused suites:

```bash
pnpm vitest run tests/api/delivery-flow.test.ts tests/api/run-auth.test.ts tests/api/run-events.test.ts tests/api/run-worker-lifecycle.test.ts
pnpm vitest run tests/workflow tests/run-worker
```

Expected: PASS.

- [ ] **Step 6: Scan out old compatibility values in active code**

Run:

```bash
rg -n "'feature'|'bugfix'|'test_refactor'|\"feature\"|\"bugfix\"|\"test_refactor\"|gate_state: 'none'|gateState: 'none'|ExecutionPackage.*awaiting_ai|execution_package.*awaiting_ai|executionPackage.*awaiting_ai" apps packages tests scripts
```

Expected: no matches except intentional negative tests that assert rejection of old values. `awaiting_ai` may still appear in WorkItem state definitions/tests because it remains a valid WorkItem activity state.

- [ ] **Step 7: Commit P0 migration**

Run:

```bash
git add apps/control-plane-api/src/p0 packages/domain/src tests/helpers tests/api tests/db tests/workflow tests/run-worker
git commit -m "feat: migrate p0 command flow to core schema"
```

Expected: P0 tests pass and old compatibility values are not used by active fixtures.

---

### Task 5: Add Shared Public Evidence Serialization

**Files:**
- Create: `packages/db/src/queries/public-evidence-serialization.ts`
- Modify: `packages/db/src/queries/replay-queries.ts`
- Modify: `apps/control-plane-api/src/p0/evidence-chain.ts`
- Modify: `tests/api/query-module.test.ts`
- Modify: `tests/api/evidence-chain.test.ts`
- Modify: `tests/contracts/evidence-chain.test.ts`

- [ ] **Step 1: Write failing redaction tests**

Add tests that prove public replay and evidence chain strip:
- `raw_ref`
- `local_ref`
- absolute filesystem paths
- logs artifacts
- raw metadata artifacts
- token/secret-like keys at any nested depth
- unknown raw payload keys

Run:

```bash
pnpm vitest run tests/api/query-module.test.ts tests/api/evidence-chain.test.ts tests/contracts/evidence-chain.test.ts
```

Expected: FAIL because redaction is currently local to replay and not recursive/allowlist-based.

- [ ] **Step 2: Implement allowlist serializer**

Create serializers:
- `serializePublicArtifactRef`
- `serializePublicDecision`
- `serializePublicObjectEvent`
- `serializePublicStatusHistory`
- `serializePublicReleaseEvidence`
- `serializePublicReplayPayload`

Use allowlists per object type. Unknown raw payload keys must be dropped, not copied and filtered later.

- [ ] **Step 3: Wire serializer into replay and evidence chain**

Replace local artifact redaction in `replay-queries.ts`. Update evidence-chain code to call the same artifact serializer.

- [ ] **Step 4: Run redaction tests**

Run:

```bash
pnpm vitest run tests/api/query-module.test.ts tests/api/evidence-chain.test.ts tests/contracts/evidence-chain.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit serializer**

Run:

```bash
git add packages/db/src/queries apps/control-plane-api/src/p0/evidence-chain.ts tests/api tests/contracts
git commit -m "feat: share public evidence serialization"
```

Expected: redaction behavior is tested through public API surfaces.

---

### Task 6: Implement Release Repository Queries And Gate Read Models

**Files:**
- Create: `packages/db/src/queries/release-cockpit-queries.ts`
- Modify: `packages/db/src/queries/replay-queries.ts`
- Modify: `packages/db/src/queries/work-item-cockpit-queries.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `tests/db/repository.test.ts`
- Modify: `tests/api/query-module.test.ts`
- Reuse: `tests/db/repository-contract.ts` seed helpers from Task 3 for query fixtures; do not duplicate a separate release graph.

- [ ] **Step 1: Write failing Release cockpit query tests**

In `tests/api/query-module.test.ts` or a DB query unit test, assert `getReleaseCockpit` returns:
- `release`
- linked `work_items`
- linked `execution_packages`
- `latest_run_sessions`
- `current_review_packets`
- `evidences`
- `observations`
- `blockers`
- `overridden_blockers`
- `risk_summary`
- `decisions`
- `next_actions`
- public-safe artifacts/evidence only
- generic replay route `/query/replay/:objectType/:objectId` supports both `work_item` and `release`
- unsupported generic replay object types return 400
- missing supported release replay objects return 404

Run:

```bash
pnpm vitest run tests/api/query-module.test.ts
```

Expected: FAIL because release query route/helper does not exist.

- [ ] **Step 2: Write failing Release replay tests**

Assert `GET /query/replay/release/:releaseId` returns ObjectEvent, StatusHistory, Decision, ReleaseEvidence, linked WorkItem/ExecutionPackage status and decision highlights, and safe Artifact entries in chronological order through the generic replay route, returns 404 for missing releases, and unsupported generic replay object types still return 400.

Run:

```bash
pnpm vitest run tests/api/query-module.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement query helpers**

Implement:
- `getReleaseCockpit(repository, releaseId)`
- `getReleaseReplayTimeline(repository, releaseId)`
- shared object reference collection for linked work items/packages/evidence
- Release gate package evidence selection using the required fallback order: explicit `current_review_packet_id` / `current_run_session_id`, then `last_run_session_id` plus that run's non-archived ReviewPacket, then latest non-archived ReviewPacket by creation time

Do not include Incident or Contract joins.

- [ ] **Step 4: Wire QueryModule routes**

Add:
- `GET /query/release-cockpit/:releaseId`
- generic `GET /query/replay/:objectType/:objectId` support for both `work_item` and `release`, so `GET /query/replay/release/:releaseId` works as the concrete Release replay route

Keep existing WorkItem replay behavior and add Release as a supported object type. Unsupported object types must return 400; supported missing `work_item` or `release` objects must return 404.

- [ ] **Step 5: Run query tests**

Run:

```bash
pnpm vitest run tests/api/query-module.test.ts tests/db/repository.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Release query surface**

Run:

```bash
git add packages/db/src/queries packages/db/src/index.ts apps/control-plane-api/src/modules/query tests/api/query-module.test.ts tests/db/repository.test.ts
git commit -m "feat: add release cockpit and replay queries"
```

Expected: QueryModule owns Release read models.

---

### Task 7: Implement ReleaseModule Command Lifecycle

**Files:**
- Create: `apps/control-plane-api/src/modules/release/release.dto.ts`
- Create: `apps/control-plane-api/src/modules/release/release.service.ts`
- Create: `apps/control-plane-api/src/modules/release/release.controller.ts`
- Create: `apps/control-plane-api/src/modules/release/release.module.ts`
- Modify: `apps/control-plane-api/src/app.module.ts`
- Create: `tests/api/release-flow.test.ts`
- Modify: `tests/contracts/contracts.test.ts`

- [ ] **Step 1: Write failing Release API tests**

In `tests/api/release-flow.test.ts`, cover:
- `POST /releases`
- `PATCH /releases/:releaseId`
- `GET /releases`
- `GET /releases/:releaseId`
- link work item through `POST /releases/:releaseId/work-items/:workItemId`
- link execution package through `POST /releases/:releaseId/execution-packages/:packageId`
- unlink work item through `DELETE /releases/:releaseId/work-items/:workItemId`
- unlink execution package through `DELETE /releases/:releaseId/execution-packages/:packageId`
- link rejection for missing, archived, deleted, unauthorized, and cross-project WorkItems
- link rejection for missing, archived, deleted, unauthorized, and cross-project ExecutionPackages
- submit for approval through `POST /releases/:releaseId/submit-for-approval`
- `empty_work_item_scope` or `empty_execution_package_scope` returns an error and leaves state unchanged for `submit-for-approval`, plain `approve`, and `override-approve`
- approve with no blockers
- plain approve rejects releases that currently have any blocker and leaves state unchanged
- request changes
- override approve with rationale, blocker snapshot, and matching blocker fingerprint
- stale override approve returns conflict when the supplied blocker fingerprint no longer matches recomputed blockers
- add observation evidence
- start observing
- close completed requires at least one observation evidence row unless the close request includes `override_without_observation: true` and an explicit override rationale
- close rolled back
- close cancelled

Run:

```bash
pnpm vitest run tests/api/release-flow.test.ts
```

Expected: FAIL because ReleaseModule does not exist.

- [ ] **Step 2: Write failing command inventory contract tests**

Add Release commands to `packages/contracts/src/api.ts` inventory:
- `create_release`
- `patch_release`
- `link_release_work_item`
- `unlink_release_work_item`
- `link_release_execution_package`
- `unlink_release_execution_package`
- `submit_release_for_approval`
- `approve_release`
- `override_approve_release`
- `request_release_changes`
- `record_release_evidence`
- `start_release_observing`
- `close_release`

Run:

```bash
pnpm vitest run tests/contracts/contracts.test.ts
```

Expected: FAIL until contracts and controller routes agree.

- [ ] **Step 3: Implement Release DTOs**

Use zod DTOs with exact status enums from contracts. Required create fields:
- `project_id`
- `title`
- `release_owner_actor_id`
- optional `release_type` defaulting to `normal`
- optional `scope_summary`, `rollout_strategy`, `rollback_plan`, `observation_plan`

`CreateReleaseRequest` must not require clients to provide `key` or `release_type`. Generate or derive the Release `key` server-side from the project/title plus a deterministic suffix, default missing `release_type` to `normal`, and expose the stored key/type in responses.

Release evidence DTO validates:
- `review_packet` evidence requires `object_ref.object_type = "review_packet"`
- `test_report` evidence requires `artifact_id`, safe artifact ref, or `extra.check_refs`
- `build` evidence requires `extra.build` with at least build identifier/status fields or a safe artifact reference
- `deployment` evidence requires `extra.deployment` with target environment and rollout/deploy status
- `metric_snapshot` evidence requires `extra.observation.metrics`
- `rollback_record` evidence requires `extra.rollback` and either a rollback Decision object ref or structured rollback metadata
- `CloseReleaseRequest` includes the exact spec field `override_without_observation?: boolean`; tests must prove completed close without observation evidence fails unless this field is true and a non-empty rationale is provided
- `observation_note` evidence requires `extra.observation` with `source`, `severity`, `observed_at`, and `summary`

Response DTOs must match the spec exactly:
- Release control routes (`submit-for-approval`, `approve`, `override-approve`, `request-changes`, `start-observing`, `close`) return `ReleaseControlResponse` with `release`, optional `decisions`, `blockers`, `overridden_blockers`, and `next_actions`.
- Link/unlink routes return `LinkReleaseObjectResponse` with `release` and `linked_object: { object_type: "work_item" | "execution_package"; object_id: string }`.
- Release resource reads return raw stored Release resources and lightweight links; evidence create returns the stored/public ReleaseEvidence resource. None of these responses use `{ data, meta }`.

- [ ] **Step 4: Implement ReleaseService**

Required behavior:
- create Release in `draft/idle/not_submitted/none`
- first valid link transitions to `candidate`
- submit-for-approval computes blockers and transitions only when structural preconditions pass
- approve no blockers writes `release_approval` Decision
- plain approve recomputes blockers and fails without changing Release state when any blocker is present; only `override-approve` may approve with overrideable blockers
- override approve recomputes blockers, compares the supplied `blocker_fingerprint`, returns conflict on stale snapshots, rejects non-overrideable blockers, and writes `manual_override` then `release_approval` Decision
- request changes writes state and Decision
- start observing requires approved rollout state
- close writes status history and optional rollback Decision
- completed close requires at least one ReleaseEvidence observation row unless an explicit observation override rationale is included in the close request
- link commands reject missing, archived, deleted, unauthorized, or cross-project WorkItems/ExecutionPackages before writing links

Every state change must write:
- `ObjectEvent`
- `StatusHistory` entries for changed state fields
- `Decision` where approval/change/override/rollback semantics apply

- [ ] **Step 5: Wire controller/module**

Add routes under `apps/control-plane-api/src/modules/release/release.controller.ts`:
- `POST /releases`
- `GET /releases`
- `GET /releases/:releaseId`
- `PATCH /releases/:releaseId`
- `POST /releases/:releaseId/work-items/:workItemId`
- `DELETE /releases/:releaseId/work-items/:workItemId`
- `POST /releases/:releaseId/execution-packages/:packageId`
- `DELETE /releases/:releaseId/execution-packages/:packageId`
- `POST /releases/:releaseId/submit-for-approval`
- `POST /releases/:releaseId/approve`
- `POST /releases/:releaseId/override-approve`
- `POST /releases/:releaseId/request-changes`
- `POST /releases/:releaseId/evidences`
- `POST /releases/:releaseId/start-observing`
- `POST /releases/:releaseId/close`

Wire the controller to the DTO response contract from Step 3. Do not wrap any response in `{ data, meta }`.

- [ ] **Step 6: Run API/contract tests**

Run:

```bash
pnpm vitest run tests/api/release-flow.test.ts tests/contracts/contracts.test.ts tests/api/query-module.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Release command surface**

Run:

```bash
git add apps/control-plane-api/src/modules/release apps/control-plane-api/src/app.module.ts packages/contracts/src tests/api/release-flow.test.ts tests/contracts/contracts.test.ts
git commit -m "feat: add release command lifecycle"
```

Expected: ReleaseModule is isolated from P0Controller.

---

### Task 8: Update Workflow, Evidence Chain, And Completion Semantics

**Files:**
- Modify: `packages/workflow/src/activities.ts`
- Modify: `packages/workflow/src/package-execution-workflow.ts`
- Modify: `packages/workflow/src/execution-finalizer.ts`
- Modify: `packages/run-worker/src/*`
- Modify: `apps/control-plane-api/src/p0/evidence-chain.ts`
- Modify: `tests/workflow/*.test.ts`
- Modify: `tests/run-worker/*.test.ts`
- Modify: `tests/api/evidence-chain.test.ts`
- Modify: `tests/contracts/evidence-chain.test.ts`

- [ ] **Step 1: Write/adjust failing completion tests**

Assert:
- P0 work item can still complete after approved ReviewPacket.
- ExecutionPackage can reach `review_approved` then be considered release-eligible only when checks/artifacts satisfy gates.
- WorkItem release/observing/done phases do not break `deriveWorkItemCompletion`.

Run:

```bash
pnpm vitest run tests/workflow tests/run-worker tests/api/evidence-chain.test.ts
```

Expected: FAIL until workflow/finalizer state values are migrated.

- [ ] **Step 2: Update workflow state writes**

Update package transitions:
- running execution uses `phase='execution'`, `activity_state='ai_running'`
- successful review handoff uses `phase='review'`, `gate_state='awaiting_human_review'`
- approved review leaves package eligible for Release as `gate_state='review_approved'` or later `release_ready` when Release gate passes

Preserve run command, SSE, worker lease, watchdog, and durable restart semantics.

- [ ] **Step 3: Update evidence chain projections**

Ensure Evidence Chain still links:
- run replacements
- run sessions
- review packets
- artifacts
- decisions
- required checks
- work items

Do not rewrite Trace into full V0 ledger.

- [ ] **Step 4: Run workflow/evidence suites**

Run:

```bash
pnpm vitest run tests/workflow tests/run-worker tests/api/evidence-chain.test.ts tests/contracts/evidence-chain.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit workflow/evidence migration**

Run:

```bash
git add packages/workflow/src packages/run-worker/src apps/control-plane-api/src/p0/evidence-chain.ts tests/workflow tests/run-worker tests/api/evidence-chain.test.ts tests/contracts/evidence-chain.test.ts
git commit -m "feat: preserve execution evidence on migrated schema"
```

Expected: execution and evidence paths are green.

---

### Task 9: Add Web Release Surface

**Files:**
- Modify: `apps/web/src/api/types.ts`
- Modify: `apps/web/src/api/commands.ts`
- Modify: `apps/web/src/api/query.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/workbenchState.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `tests/web/api.test.ts`
- Modify: `tests/web/workbench-state.test.ts`
- Create: `tests/web/release-state.test.ts`

- [ ] **Step 1: Write failing web API tests**

In `tests/web/api.test.ts`, assert command client calls Release routes and query client calls:
- `/query/release-cockpit/:releaseId`
- `/query/replay/release/:releaseId`

Run:

```bash
pnpm vitest run tests/web/api.test.ts
```

Expected: FAIL because web clients do not expose Release methods.

- [ ] **Step 2: Write failing pure state tests**

In `tests/web/release-state.test.ts`, cover:
- blocker grouping/labels
- next action derivation
- public evidence labels do not show raw/local refs
- observation form payload building for `observation_note` evidence with `source`, `severity`, `observed_at`, `summary`, optional metrics, and notes

Run:

```bash
pnpm vitest run tests/web/workbench-state.test.ts tests/web/release-state.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Update web API/types**

Add Release types and client methods. Replace old work item kind values in web types/forms:
- default new work item kind: `requirement`
- priority: `p0`
- risk: `medium`

- [ ] **Step 4: Implement compact Release panel**

In `App.tsx`, add a workbench section that can:
- enter/select a Release ID
- load Release cockpit
- load Release replay
- show blockers, linked work items/packages, evidence, state, and next actions
- show observation feed and provide an add-observation form for human/script-like structured observations
- run command buttons for submit/approve/override/start observing/close when data is available

Keep layout work-focused and consistent with existing app. Do not build a marketing landing page.

- [ ] **Step 5: Run web tests and build**

Run:

```bash
pnpm vitest run tests/web/api.test.ts tests/web/workbench-state.test.ts tests/web/release-state.test.ts
pnpm --filter @forgeloop/web build
```

Expected: PASS.

- [ ] **Step 6: Commit web Release surface**

Run:

```bash
git add apps/web/src tests/web
git commit -m "feat: add release workbench surface"
```

Expected: web client and UI compile.

---

### Task 10: Add Release Dogfood And Update P0 Dogfood Scripts

**Files:**
- Modify: `scripts/p0-dogfood.ts`
- Modify: `scripts/p0-durable-dogfood.ts`
- Modify: `scripts/p0-local-codex-dogfood.ts`
- Modify: `scripts/p0-dogfood-work-items.ts`
- Create: `scripts/release-flow-dogfood.ts`
- Modify: `tests/smoke/p0-dogfood-script.test.ts`
- Modify: `tests/smoke/p0-durable-dogfood-script.test.ts`
- Modify: `tests/smoke/p0-local-codex-dogfood-script.test.ts`
- Create: `tests/smoke/release-flow-dogfood-script.test.ts`
- Modify: `package.json`
- Create: `docs/superpowers/reports/p1-core-schema-release-flow-verification.md`

- [ ] **Step 1: Write failing smoke helper tests**

Add tests that assert Release dogfood:
- creates migrated P0 records with org/actors
- runs P0 delivery path to approved ReviewPacket
- creates Release
- links WorkItem and ExecutionPackage
- records review/test evidence
- submits and override-approves Release with an overrideable blocker, rationale, and matching blocker fingerprint
- enters observing
- closes completed
- writes report markers

Run:

```bash
pnpm vitest run tests/smoke/release-flow-dogfood-script.test.ts tests/smoke/p0-dogfood-script.test.ts
```

Expected: FAIL until scripts migrate.

- [ ] **Step 2: Migrate existing P0 dogfood scripts**

Update scripts to use:
- UUID-shaped aggregate IDs
- new enum values
- bootstrap org/actors
- guarded DB reset when durable local test mode needs clean state

Strict local Codex mode must report blocked when not configured; it must not claim PASS without running.

- [ ] **Step 3: Implement Release dogfood script**

`scripts/release-flow-dogfood.ts` should write `docs/superpowers/reports/p1-core-schema-release-flow-verification.md` with exact markers:
- P0 delivery path: PASSED
- Release create/link/submit: PASSED
- Release override approval: PASSED
- Release observing/close: PASSED
- Release cockpit query: PASSED
- Release replay redaction: PASSED
- Durable local reset: PASSED or BLOCKED with reason
- Strict local_codex run: PASSED or BLOCKED with reason

- [ ] **Step 4: Add package script**

In `package.json`:

```json
"dogfood:release-flow": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/release-flow-dogfood.ts"
```

- [ ] **Step 5: Run smoke tests**

Run:

```bash
pnpm vitest run tests/smoke
```

Expected: PASS.

- [ ] **Step 6: Commit dogfood migration**

Run:

```bash
git add scripts tests/smoke package.json docs/superpowers/reports/p1-core-schema-release-flow-verification.md
git commit -m "feat: add release flow dogfood verification"
```

Expected: smoke tests and report path are ready.

---

### Task 11: Full Local Verification And Drift Scan

**Files:**
- Modify if needed: `docs/superpowers/reports/p1-core-schema-release-flow-verification.md`
- No feature code unless verification finds a defect.

- [ ] **Step 1: Run targeted suites**

Run:

```bash
pnpm vitest run tests/domain tests/contracts tests/db tests/api tests/workflow tests/run-worker tests/web tests/smoke
```

Expected: PASS, except DB tests that are explicitly skipped due to missing disposable DB env.

- [ ] **Step 2: Run full test and build**

Run:

```bash
pnpm test
pnpm build
```

Expected: PASS.

- [ ] **Step 3: Run durable verification when database is available**

If `FORGELOOP_TEST_DATABASE_URL` or `FORGELOOP_DATABASE_URL` points to a disposable database, run:

```bash
FORGELOOP_CONFIRM_DB_RESET=1 pnpm db:push
pnpm dogfood:p0:durable
pnpm dogfood:release-flow
```

Expected: PASS. If no disposable DB is available, update the verification report with `BLOCKED` and the exact missing env/setup reason.

- [ ] **Step 4: Run strict local Codex dogfood when configured**

Run only when required local Codex env is configured:

```bash
pnpm dogfood:p0:local-codex
```

Expected: PASS. If not configured, the verification report must say BLOCKED, not PASS.

- [ ] **Step 5: Scan for old schema baggage and out-of-scope productization**

Run:

```bash
rg -n "test_evidences|IncidentLink|ContractRevision|PackageContractLink|'feature'|'bugfix'|'test_refactor'|\"feature\"|\"bugfix\"|\"test_refactor\"|gate_state: 'none'|gateState: 'none'|ExecutionPackage.*awaiting_ai|execution_package.*awaiting_ai|executionPackage.*awaiting_ai" apps packages tests scripts
```

Expected:
- no `test_evidences`, `IncidentLink`, `ContractRevision`, `PackageContractLink` product code
- no old enum fixture usage except explicit negative tests
- no old ExecutionPackage gate/activity values; WorkItem `awaiting_ai` remains allowed

- [ ] **Step 6: Verify git diff is intentional**

Run:

```bash
git status --short
git diff --stat HEAD
git diff --check
```

Expected: only intentional final verification report updates remain, and `git diff --check` reports no whitespace errors.

- [ ] **Step 7: Commit final verification report**

Run:

```bash
git add docs/superpowers/reports/p1-core-schema-release-flow-verification.md
git commit -m "docs: verify p1 core schema release flow"
```

Expected: final report committed, unless it was already committed in Task 10 and unchanged.

---

### Task 12: Final Review Packet For This Implementation

**Files:**
- Read all changed files from this branch.
- No code changes unless review finds defects.

- [ ] **Step 1: Request implementation review**

Use `superpowers:requesting-code-review` or the repo's current review workflow. Provide:
- this plan path
- spec path
- verification report path
- commit range

Expected: reviewer focuses on blockers, behavioral regressions, and missing tests.

- [ ] **Step 2: Fix review blockers**

For each blocker:
- write/adjust a failing test first
- implement fix
- rerun focused suite
- commit with a focused message

Expected: no unresolved blocker remains.

- [ ] **Step 3: Final verification before completion**

Use `superpowers:verification-before-completion`.

Run:

```bash
pnpm test
pnpm build
pnpm dogfood:release-flow
```

Expected: PASS, or explicitly documented BLOCKED only for environment-dependent local Codex/durable DB checks.

- [ ] **Step 4: Prepare branch completion handoff**

Use `superpowers:finishing-a-development-branch`.

Expected: user gets a clear merge/PR/cleanup choice with verification evidence.
