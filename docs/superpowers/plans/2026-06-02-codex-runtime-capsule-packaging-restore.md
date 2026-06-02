# Codex Runtime Capsule Packaging And Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace narrow Codex session snapshots with durable `CodexRuntimeCapsule` packaging and restore so a Plan Item Workflow can continue the same real Codex app-server thread, memory state, and runtime capability set across worker/process boundaries.

**Architecture:** This wave first removes snapshot vocabulary from the active CodexSession runtime model, then adds capsule component schemas, Internal Artifact Store kinds, discovery, pack/restore, and worker orchestration. Restore is fail-closed: a worker may resume only from verified capsule, memory, environment, and thread-state artifacts, never from global `~/.codex`, hidden new threads, `history`, `path`, or compatibility aliases.

**Tech Stack:** TypeScript, pnpm, Vitest, NestJS control-plane API, Drizzle/Postgres, ForgeLoop domain/db/codex-runtime/codex-worker-runtime packages, Codex app-server protocol, Internal Artifact Store.

---

## Scope Check

This plan implements Wave 4 from `docs/superpowers/specs/2026-06-02-codex-runtime-capsule-packaging-restore-design.md`.

In scope:

- No-baggage rename from `CodexSessionSnapshot` to `CodexRuntimeCapsule`.
- Domain, contract, DB schema, repository, scheduler, worker, and API terminalization fields using capsule naming.
- New Internal Artifact Store kinds for capsule components.
- Canonical manifest and digest validators for runtime capsule, memory bundle/delta, environment manifest, plugin/skill packages, MCP/tool/app connector manifests, credential lineage, trusted runtime manifest, and thread locator repair.
- Discovery gate that classifies Codex `CODEX_HOME` paths and proves a safe locator repair contract before restore implementation is accepted.
- Packager/restorer/materializer that operate only on isolated worker runtime roots and fail on unknown/forbidden state.
- Worker orchestration that restores input capsule state, resumes with `threadId`, packages the next capsule, and terminalizes under lease fencing.
- Dogfood commands:
  - `pnpm dogfood:codex-runtime-capsule-discovery`
  - `pnpm dogfood:codex-runtime-capsule-restore`
- No-baggage guard that rejects active snapshot naming in this runtime domain.

Out of scope:

- Execution worker handoff continuity.
- Workspace bundle restore for code-writing sessions.
- Automatic global memory promotion.
- Automatic parsing of Superpowers natural-language turns into product state.
- Automatic fork merge.
- UI for raw capsule internals.

## Design Decisions For Implementation

- Physical table migration should create `codex_runtime_capsules` and drop `codex_session_snapshots` in the same migration. The product is not live, so there is no compatibility adapter, no shadow table, and no alias type.
- Memory bundles should be stored as full fetchable bundles per successful turn for this wave, plus optional deltas for audit. This avoids base-plus-delta chain restore bugs while still proving delta generation and replay semantics.
- Plugin packages and skill bundles should be session-scoped Internal Artifact Store objects in this wave. Global deduplication by digest is deferred because restore correctness is more important than storage optimization.
- Shell state captures are not implemented until discovery proves an exact allowed set. Unknown shell state is a discovery blocker, not packager follow-up work.
- Locator repair must use `app_server_scan` if dogfood proves it works. If it does not, implement only a minimal `state_5.sqlite` table/column upsert proven by discovery; copying a whole DB remains forbidden.

## File Structure

- Modify `packages/domain/src/plan-item-workflow.ts`
  - Owns `CodexSession`, `CodexSessionTurn`, `CodexRuntimeCapsule`, stale terminalization, and fork field names.
- Modify `packages/contracts/src/plan-item-workflow.ts`
  - Keeps public DTO schemas capsule-safe and free of raw refs/thread ids.
- Modify `packages/domain/src/codex-runtime.ts`
  - Owns capsule blocker codes, canonical digest helpers, public-safe validation, runtime context validation, and capsule manifest exports.
- Create `packages/domain/src/codex-runtime-capsule.ts`
  - Owns canonical capsule, memory, environment, locator repair, and path classification validation functions.
- Modify `packages/domain/src/internal-artifacts.ts`
  - Removes `codex_session_snapshot`; adds new capsule component kinds and owner validation helpers.
- Modify `packages/db/src/schema/plan-item-workflow.ts`
  - Replaces snapshot columns/table with capsule and memory/environment continuation columns.
- Modify `packages/db/src/reset.ts`
  - Drops `codex_runtime_capsules` instead of `codex_session_snapshots`.
- Add migration under `packages/db/migrations/`
  - Drops old snapshot table/columns/indexes and adds capsule columns/table/indexes.
- Modify `packages/db/src/repositories/delivery-repository.ts`
  - Renames repository inputs/methods to capsule terminology and adds memory/environment fields.
- Modify `packages/db/src/repositories/in-memory-delivery-repository.ts`
  - Mirrors capsule invariants for tests.
- Modify `packages/db/src/repositories/drizzle-delivery-repository.ts`
  - Enforces capsule invariants against Postgres/Drizzle.
- Modify `tests/domain/plan-item-workflow.test.ts`
  - Validates no snapshot fields in domain session/turn/capsule examples.
- Modify `tests/contracts/plan-item-workflow.test.ts`
  - Validates public DTOs do not expose capsule refs/raw thread ids.
- Modify `tests/domain/internal-artifacts.test.ts`
  - Validates new component refs and old `codex_session_snapshot` rejection.
- Modify `tests/domain/codex-runtime.test.ts`
  - Adds manifest/digest/public-safety tests.
- Add `tests/domain/codex-runtime-capsule.test.ts`
  - Focused capsule manifest, memory delta, environment manifest, locator repair, and path safety tests.
- Modify `tests/db/schema.test.ts`
  - Validates `codex_runtime_capsules` table/constraints and absence of old schema object exports.
- Modify `tests/db/plan-item-workflow-repository.test.ts`
  - Rewrites snapshot tests to capsule tests across in-memory and Drizzle repositories.
- Modify `tests/helpers/plan-item-workflow-fixtures.ts`
  - Replaces snapshot fixtures with capsule/memory/environment fixtures.
- Modify `apps/control-plane-api/src/modules/http/domain-error.filter.ts`
  - Maps capsule stale/blocker errors to product-safe responses.
- Modify `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts`
  - Renames fork and terminalization DTO fields to capsule names.
- Modify `apps/control-plane-api/src/modules/plan-item-workflows/internal-codex-session.controller.ts`
  - Exposes trusted `/internal/codex-sessions/:sessionId/runtime-capsules` route and removes the old `/snapshots` route.
- Modify `apps/control-plane-api/src/modules/plan-item-workflows/codex-session-lease.service.ts`
  - Builds output capsules and terminalizes with capsule/memory/environment lineage.
- Modify `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts`
  - Schedules turns with expected input capsule and base/latest memory/environment refs.
- Modify `apps/control-plane-api/src/modules/automation/product-generation-result.service.ts`
  - Bridges runtime terminal results into capsule terminalization before product payload application.
- Modify `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts`
  - Adds worker-facing capsule result DTOs and removes snapshot fields.
- Modify `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
  - Persists worker terminal results with capsule evidence and fail-closed blocker codes.
- Modify `apps/control-plane-api/src/modules/codex-runtime/product-generation-runtime-scheduler.service.ts`
  - Supplies expected input capsule, memory, and environment refs to trusted worker context.
- Modify `packages/codex-runtime/src/types.ts`
  - Renames runtime context fields to capsule naming.
- Modify `packages/codex-runtime/src/app-server-generation-driver.ts`
  - Keeps resume request shape strictly `{ threadId, excludeTurns: true, persistExtendedHistory: false }`.
- Modify `tests/codex-runtime/app-server-generation-driver.test.ts`
  - Proves bound-session restore uses `thread/resume(threadId)` only, with no `history`, `path`, `Thread.sessionId`, or replacement `thread/start`.
- Modify `tests/codex-runtime/codex-app-server-schema-smoke.test.ts`
  - Keeps generated app-server protocol facts pinned for `thread/resume` required fields.
- Modify `packages/codex-worker-runtime/src/task-filesystem.ts`
  - Allows preparing a host-visible isolated `CODEX_HOME` with optional restore input before app-server launch.
- Modify `packages/codex-worker-runtime/src/app-server-launcher.ts`
  - Calls restore/materialization before app-server start and package before cleanup.
- Create `packages/codex-worker-runtime/src/codex-runtime-capsule/discovery.ts`
  - Runs controlled local discovery and emits a product-safe report.
- Create `packages/codex-worker-runtime/src/codex-runtime-capsule/path-classifier.ts`
  - Classifies allowed, generated, forbidden, and unknown `CODEX_HOME` paths.
- Create `packages/codex-worker-runtime/src/codex-runtime-capsule/thread-state.ts`
  - Packages/restores rollout JSONL and locator repair manifest.
- Create `packages/codex-worker-runtime/src/codex-runtime-capsule/memory-state.ts`
  - Packages/restores memory bundles and deltas.
- Create `packages/codex-worker-runtime/src/codex-runtime-capsule/environment-state.ts`
  - Packages/restores environment manifest, plugin packages, skill bundles, MCP/tool/app schemas, and trusted runtime manifest.
- Create `packages/codex-worker-runtime/src/codex-runtime-capsule/packager.ts`
  - Uploads component artifacts and final `codex_runtime_capsule`.
- Create `packages/codex-worker-runtime/src/codex-runtime-capsule/restorer.ts`
  - Downloads/verifies capsule artifacts and materializes an isolated runtime root.
- Create `packages/codex-worker-runtime/src/codex-runtime-capsule/materializer.ts`
  - Writes trusted config/auth from ForgeLoop materialization and never from capsule bytes.
- Modify `packages/codex-worker-runtime/src/remote-worker-client.ts`
  - Validates capsule runtime context, restores before generation, packages after success, and returns capsule terminal evidence.
- Modify `packages/codex-worker-runtime/src/runtime-job-artifacts.ts`
  - Carries product-safe capsule artifact metadata in terminal results.
- Modify `packages/codex-worker-runtime/src/index.ts`
  - Exports capsule runtime components.
- Create `scripts/codex-runtime-capsule-discovery.ts`
  - CLI for discovery dogfood.
- Create `scripts/codex-runtime-capsule-restore-dogfood.ts`
  - CLI for cross-worker restore dogfood.
- Modify `package.json`
  - Adds dogfood scripts.
- Modify `scripts/check-codex-runtime-superpowers-no-baggage.ts`
  - Adds capsule-specific snapshot-name guard.
- Modify `tests/smoke/codex-runtime-no-baggage-gate.test.ts`
  - Adds negative tests for legacy snapshot naming.
- Create `tests/codex-worker-runtime/codex-runtime-capsule-path-classifier.test.ts`
  - Worker unit tests for path classification.
- Create `tests/codex-worker-runtime/codex-runtime-capsule-discovery.test.ts`
  - Worker unit tests for discovery reports and locator repair contracts.
- Create `tests/codex-worker-runtime/codex-runtime-capsule-memory-state.test.ts`
  - Worker unit tests for memory bundle and delta handling.
- Create `tests/codex-worker-runtime/codex-runtime-capsule-environment-state.test.ts`
  - Worker unit tests for plugin/skill/MCP/tool/app environment materialization.
- Create `tests/codex-worker-runtime/codex-runtime-capsule-materializer.test.ts`
  - Worker unit tests for trusted config/auth materialization.
- Create `tests/codex-worker-runtime/codex-runtime-capsule-thread-state.test.ts`
  - Worker unit tests for rollout and locator repair handling.
- Create `tests/codex-worker-runtime/codex-runtime-capsule-packager.test.ts`
  - Worker unit tests for packaging component artifacts and final capsule archive.
- Create `tests/codex-worker-runtime/codex-runtime-capsule-restorer.test.ts`
  - Worker unit tests for capsule/component digest verification and restore.
- Create `tests/smoke/codex-runtime-capsule-dogfood-script.test.ts`
  - Script smoke tests for skip/pass reporting shape.
- Modify `tests/api/codex-session-lease.test.ts`
  - Capsule terminalization endpoint tests.
- Modify `tests/api/plan-item-workflows.test.ts`
  - Trusted route and fork DTO tests for capsule naming.
- Modify `tests/api/codex-runtime-product-generation-scheduler.test.ts`
  - Scheduler fail-closed and worker context tests.

## Task 1: Remove Snapshot Vocabulary From Domain And Contracts

**Files:**
- Modify: `packages/domain/src/plan-item-workflow.ts`
- Modify: `packages/domain/src/codex-runtime.ts`
- Modify: `packages/contracts/src/plan-item-workflow.ts`
- Modify: `packages/codex-runtime/src/types.ts`
- Modify: `tests/domain/plan-item-workflow.test.ts`
- Modify: `tests/domain/codex-runtime.test.ts`
- Modify: `tests/contracts/plan-item-workflow.test.ts`

- [ ] **Step 1: Write failing domain tests for capsule fields**

In `tests/domain/plan-item-workflow.test.ts`, replace existing snapshot expectations with a compile/runtime sample:

```ts
const session = {
  id: 'session-1',
  owner_type: 'plan_item_workflow',
  owner_id: 'workflow-1',
  status: 'idle',
  role: 'active',
  codex_thread_id_digest: `sha256:${'a'.repeat(64)}`,
  latest_capsule_id: 'capsule-1',
  latest_capsule_digest: `sha256:${'b'.repeat(64)}`,
  base_memory_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-base',
  base_memory_bundle_digest: `sha256:${'c'.repeat(64)}`,
  latest_memory_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-1',
  latest_memory_bundle_digest: `sha256:${'d'.repeat(64)}`,
  latest_environment_manifest_ref: 'artifact://internal/codex_environment_manifest/codex_session/session-1/env-1',
  latest_environment_manifest_digest: `sha256:${'e'.repeat(64)}`,
  latest_turn_id: 'turn-1',
  latest_turn_digest: `sha256:${'f'.repeat(64)}`,
  runtime_profile_id: 'profile-1',
  runtime_profile_revision_id: 'profile-revision-1',
  credential_binding_id: 'credential-1',
  credential_binding_version_id: 'credential-version-1',
  lease_epoch: 0,
  created_by_actor_id: 'actor-1',
  created_at: '2026-06-02T00:00:00.000Z',
  updated_at: '2026-06-02T00:00:00.000Z',
} satisfies CodexSession;

expect(session.latest_capsule_digest).toMatch(/^sha256:/);
expect('latest_snapshot_digest' in session).toBe(false);
```

Add a `CodexSessionTurn` sample containing:

```ts
expected_input_capsule_digest: `sha256:${'b'.repeat(64)}`,
input_capsule_id: 'capsule-1',
input_capsule_digest: `sha256:${'b'.repeat(64)}`,
output_capsule_id: 'capsule-2',
output_capsule_digest: `sha256:${'9'.repeat(64)}`,
input_memory_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-1',
output_memory_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-2',
input_environment_manifest_ref: 'artifact://internal/codex_environment_manifest/codex_session/session-1/env-1',
output_environment_manifest_ref: 'artifact://internal/codex_environment_manifest/codex_session/session-1/env-2',
```

- [ ] **Step 2: Run domain tests to verify failure**

Run: `pnpm vitest run tests/domain/plan-item-workflow.test.ts tests/contracts/plan-item-workflow.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL with TypeScript/schema errors for missing capsule fields and old snapshot references.

- [ ] **Step 3: Rename domain interfaces**

In `packages/domain/src/plan-item-workflow.ts`:

- Replace `latest_snapshot_id` and `latest_snapshot_digest` with `latest_capsule_id` and `latest_capsule_digest`.
- Add session memory/environment continuation fields exactly from the spec.
- Replace `forked_from_snapshot_id` with `forked_from_capsule_id`.
- Replace turn snapshot fields with:

```ts
expected_input_capsule_digest?: string;
input_capsule_id?: string;
input_capsule_digest?: string;
output_capsule_id?: string;
output_capsule_digest?: string;
base_memory_bundle_ref?: string;
base_memory_bundle_digest?: string;
input_memory_bundle_ref?: string;
input_memory_bundle_digest?: string;
output_memory_bundle_ref?: string;
output_memory_bundle_digest?: string;
memory_delta_artifact_ref?: string;
memory_delta_digest?: string;
input_environment_manifest_ref?: string;
input_environment_manifest_digest?: string;
output_environment_manifest_ref?: string;
output_environment_manifest_digest?: string;
```

- Rename `CodexSessionSnapshot` to `CodexRuntimeCapsule`.
- Add capsule fields from the spec: `created_from_turn_id`, `thread_state_digest`, `memory_state_digest`, `environment_manifest_digest`, `codex_cli_version`, `app_server_protocol_digest`, `trusted_runtime_manifest_digest`, and `credential_binding_lineage_digest`.
- Replace the capsule interface with the exact required shape; do not leave Wave 2 optional fields optional:

```ts
export interface CodexRuntimeCapsule {
  id: string;
  codex_session_id: string;
  created_from_turn_id: string;
  sequence: number;
  artifact_ref: string;
  digest: string;
  size_bytes: string;
  manifest_digest: string;
  thread_state_digest: string;
  memory_state_digest: string;
  environment_manifest_digest: string;
  codex_thread_id_digest: string;
  codex_cli_version: string;
  app_server_protocol_digest: string;
  runtime_profile_revision_id: string;
  trusted_runtime_manifest_digest: string;
  credential_binding_lineage_digest: string;
  created_by_actor_id: string;
  created_at: IsoDateTime;
}
```

- Rename stale attempt fields:

```ts
expected_input_capsule_digest?: string;
attempted_output_capsule_digest?: string;
attempted_codex_thread_id_digest?: string;
```

- [ ] **Step 4: Rename runtime context fields**

In `packages/codex-runtime/src/types.ts`, change `CodexSessionRuntimeContext.expected_previous_snapshot_digest` to `expected_input_capsule_digest`.

Update `validateCodexSessionRuntimeContext` in `packages/domain/src/codex-runtime.ts` to reject empty `expected_input_capsule_digest` and stop accepting `expected_previous_snapshot_digest`.

- [ ] **Step 5: Keep public contracts private**

In `packages/contracts/src/plan-item-workflow.ts`, keep `codexSessionPublicDtoSchema` free of raw capsule refs and raw thread ids. Add a test in `tests/contracts/plan-item-workflow.test.ts`:

```ts
expect(
  codexSessionPublicDtoSchema.safeParse({
    id: 'session-1',
    status: 'idle',
    role: 'active',
    continuity_state: 'ready',
    can_continue: true,
    latest_capsule_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-1',
  }).success,
).toBe(false);
```

- [ ] **Step 6: Write failing app-server resume request tests**

In `tests/codex-runtime/app-server-generation-driver.test.ts`, add or update the bound-session resume case so the fake transport records a request equivalent to:

```ts
expect(requests).toContainEqual({
  method: 'thread/resume',
  params: {
    threadId: 'thread-1',
    excludeTurns: true,
    persistExtendedHistory: false,
  },
});
expect(JSON.stringify(requests)).not.toContain('"history"');
expect(JSON.stringify(requests)).not.toContain('"path"');
expect(JSON.stringify(requests)).not.toContain('"sessionId"');
expect(requests.filter((request) => request.method === 'thread/start')).toHaveLength(0);
```

In `tests/codex-runtime/codex-app-server-schema-smoke.test.ts`, keep generated protocol assertions for `ThreadResumeParams.threadId`, `ThreadResumeParams.excludeTurns`, and `ThreadResumeParams.persistExtendedHistory`.

- [ ] **Step 7: Run focused tests**

Run: `pnpm vitest run tests/domain/plan-item-workflow.test.ts tests/domain/codex-runtime.test.ts tests/contracts/plan-item-workflow.test.ts tests/codex-runtime/app-server-generation-driver.test.ts tests/codex-runtime/codex-app-server-schema-smoke.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 8: Commit domain/contracts rename**

```bash
git add packages/domain/src/plan-item-workflow.ts packages/domain/src/codex-runtime.ts packages/contracts/src/plan-item-workflow.ts packages/codex-runtime/src/types.ts packages/codex-runtime/src/app-server-generation-driver.ts tests/domain/plan-item-workflow.test.ts tests/domain/codex-runtime.test.ts tests/contracts/plan-item-workflow.test.ts tests/codex-runtime/app-server-generation-driver.test.ts tests/codex-runtime/codex-app-server-schema-smoke.test.ts
git commit -m "feat: rename codex session continuity to capsules"
```

## Task 2: Replace Snapshot Table And Repository Contracts

**Files:**
- Modify: `packages/db/src/schema/plan-item-workflow.ts`
- Modify: `packages/db/src/reset.ts`
- Add: `packages/db/migrations/0002_codex_runtime_capsules.sql`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Modify: `tests/db/schema.test.ts`
- Modify: `tests/db/plan-item-workflow-repository.test.ts`
- Modify: `tests/helpers/plan-item-workflow-fixtures.ts`

- [ ] **Step 1: Write failing schema tests**

In `tests/db/schema.test.ts`, replace old `codex_session_snapshots` assertions with:

```ts
expect(tableNames).toContain('codex_runtime_capsules');
expect(tableNames).not.toContain('codex_session_snapshots');
expect(columnNotNull(codex_runtime_capsules, 'created_by_actor_id')).toBe(true);
expect(columnNotNull(codex_runtime_capsules, 'created_from_turn_id')).toBe(true);
expect(columnNotNull(codex_runtime_capsules, 'sequence')).toBe(true);
expect(columnNotNull(codex_runtime_capsules, 'artifact_ref')).toBe(true);
expect(columnNotNull(codex_runtime_capsules, 'digest')).toBe(true);
expect(columnNotNull(codex_runtime_capsules, 'size_bytes')).toBe(true);
expect(columnNotNull(codex_runtime_capsules, 'manifest_digest')).toBe(true);
expect(columnNotNull(codex_runtime_capsules, 'thread_state_digest')).toBe(true);
expect(columnNotNull(codex_runtime_capsules, 'memory_state_digest')).toBe(true);
expect(columnNotNull(codex_runtime_capsules, 'environment_manifest_digest')).toBe(true);
expect(columnNotNull(codex_runtime_capsules, 'codex_thread_id_digest')).toBe(true);
expect(columnNotNull(codex_runtime_capsules, 'codex_cli_version')).toBe(true);
expect(columnNotNull(codex_runtime_capsules, 'app_server_protocol_digest')).toBe(true);
expect(columnNotNull(codex_runtime_capsules, 'runtime_profile_revision_id')).toBe(true);
expect(columnNotNull(codex_runtime_capsules, 'trusted_runtime_manifest_digest')).toBe(true);
expect(columnNotNull(codex_runtime_capsules, 'credential_binding_lineage_digest')).toBe(true);
```

Also assert `codex_sessions` has `latest_capsule_id`, `base_memory_bundle_ref`, and `latest_environment_manifest_ref`, and does not export `latestSnapshotId`.

- [ ] **Step 2: Write failing repository tests**

In `tests/db/plan-item-workflow-repository.test.ts`, rename the snapshot helper to `runtimeCapsuleInput` and add:

```ts
await repository.createCodexRuntimeCapsule(capsuleInput);
await expect(repository.getCodexRuntimeCapsule(capsuleInput.id)).resolves.toMatchObject({
  id: capsuleInput.id,
  artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-1',
});
```

Add stale terminalization test:

```ts
await expect(
  repository.terminalizeCodexSessionTurn({
    session_id: 'session-1',
    turn_id: 'turn-2',
    lease_id: 'lease-2',
    lease_epoch: 2,
    worker_id: 'worker-1',
    worker_session_digest: digestA,
    expected_input_capsule_digest: `sha256:${'0'.repeat(64)}`,
    status: 'succeeded',
    output_capsule: capsuleInput,
    now,
  }),
).rejects.toMatchObject({ code: 'codex_runtime_capsule_stale' });
```

- [ ] **Step 3: Run repository tests to verify failure**

Run: `pnpm vitest run tests/db/schema.test.ts tests/db/plan-item-workflow-repository.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL with missing `codex_runtime_capsules` exports and repository methods.

- [ ] **Step 4: Replace schema**

In `packages/db/src/schema/plan-item-workflow.ts`:

- Rename imports from `CodexSessionSnapshot` to `CodexRuntimeCapsule`.
- Replace session columns:
  - `latestSnapshotId` -> `latestCapsuleId`
  - `latestSnapshotDigest` -> `latestCapsuleDigest`
  - add base/latest memory and environment refs/digests.
- Replace turn columns:
  - `expectedPreviousSnapshotDigest` -> `expectedInputCapsuleDigest`
  - `outputSnapshotId` -> `outputCapsuleId`
  - `outputSnapshotDigest` -> `outputCapsuleDigest`
  - add input/output capsule, memory, and environment columns.
- Replace stale attempt columns with capsule names.
- Replace `codex_session_snapshots` table with `codex_runtime_capsules` and all required fields/constraints.

- [ ] **Step 5: Add explicit migration**

Create `packages/db/migrations/0002_codex_runtime_capsules.sql` using explicit drop/add statements. Include:

```sql
DROP TABLE IF EXISTS "codex_session_snapshots";
ALTER TABLE "codex_sessions" DROP COLUMN IF EXISTS "latest_snapshot_id";
ALTER TABLE "codex_sessions" DROP COLUMN IF EXISTS "latest_snapshot_digest";
ALTER TABLE "codex_sessions" DROP COLUMN IF EXISTS "forked_from_snapshot_id";
ALTER TABLE "codex_sessions" ADD COLUMN "latest_capsule_id" uuid;
ALTER TABLE "codex_sessions" ADD COLUMN "latest_capsule_digest" text;
ALTER TABLE "codex_sessions" ADD COLUMN "base_memory_bundle_ref" text;
ALTER TABLE "codex_sessions" ADD COLUMN "base_memory_bundle_digest" text;
ALTER TABLE "codex_sessions" ADD COLUMN "latest_memory_bundle_ref" text;
ALTER TABLE "codex_sessions" ADD COLUMN "latest_memory_bundle_digest" text;
ALTER TABLE "codex_sessions" ADD COLUMN "latest_environment_manifest_ref" text;
ALTER TABLE "codex_sessions" ADD COLUMN "latest_environment_manifest_digest" text;
ALTER TABLE "codex_sessions" ADD COLUMN "forked_from_capsule_id" uuid;
```

Then create `codex_runtime_capsules` with the spec-required fields and indexes. Drop old turn/stale columns and add capsule/memory/environment columns in the same migration. Do not preserve old columns.

The `codex_runtime_capsules` table must include every field from the spec, including:

```text
id
codex_session_id
created_from_turn_id
sequence
artifact_ref
digest
size_bytes
manifest_digest
thread_state_digest
memory_state_digest
environment_manifest_digest
codex_thread_id_digest
codex_cli_version
app_server_protocol_digest
runtime_profile_revision_id
trusted_runtime_manifest_digest
credential_binding_lineage_digest
created_by_actor_id
created_at
```

- [ ] **Step 6: Rename repository contracts**

In `packages/db/src/repositories/delivery-repository.ts`:

- Replace `CodexSessionSnapshot` imports with `CodexRuntimeCapsule`.
- Rename `output_snapshot` to `output_capsule`.
- Rename `createCodexSessionSnapshot` to `createCodexRuntimeCapsule`.
- Rename `getCodexSessionSnapshot` to `getCodexRuntimeCapsule`.
- Rename stale error code to `codex_runtime_capsule_stale`.
- Rename fork input to `forked_from_capsule_id`.
- Add memory/environment continuation fields to lease claim and terminalization inputs.

- [ ] **Step 7: Update repository implementations**

In both repository implementations:

- Rename private maps/helpers from snapshot to capsule.
- Validate `artifact_ref` kind is `codex_runtime_capsule`.
- Validate component refs use `owner_type: 'codex_session'` and `owner_id === codex_session_id`.
- Validate `created_from_turn_id` belongs to the same session.
- Terminalize success only when `output_capsule_id`/digest are present for generation turns that need continuity.
- Keep stale terminalization from mutating `latest_capsule_*`.
- Update fork selection to start from capsule ids/digests.

- [ ] **Step 8: Update fixtures**

In `tests/helpers/plan-item-workflow-fixtures.ts`, rename helpers and fields. Ensure default first-turn fixture includes `base_memory_bundle_ref` and `base_memory_bundle_digest`; later-turn fixtures copy `latest_memory_bundle_ref` and `latest_environment_manifest_ref`.

- [ ] **Step 9: Run focused DB tests**

Run: `pnpm vitest run tests/db/schema.test.ts tests/db/plan-item-workflow-repository.test.ts tests/api/codex-session-lease.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 10: Commit DB/repository migration**

```bash
git add packages/db/src/schema/plan-item-workflow.ts packages/db/src/reset.ts packages/db/migrations/0002_codex_runtime_capsules.sql packages/db/src/repositories/delivery-repository.ts packages/db/src/repositories/in-memory-delivery-repository.ts packages/db/src/repositories/drizzle-delivery-repository.ts tests/db/schema.test.ts tests/db/plan-item-workflow-repository.test.ts tests/helpers/plan-item-workflow-fixtures.ts tests/api/codex-session-lease.test.ts
git commit -m "feat: persist codex runtime capsules"
```

## Task 3: Add Internal Artifact Component Kinds

**Files:**
- Modify: `packages/domain/src/internal-artifacts.ts`
- Modify: `tests/domain/internal-artifacts.test.ts`
- Modify: `tests/db/internal-artifact-repository.test.ts`
- Modify: `tests/api/internal-artifacts-api.test.ts`

- [ ] **Step 1: Write failing artifact kind tests**

In `tests/domain/internal-artifacts.test.ts`, add:

```ts
it.each([
  'codex_runtime_capsule',
  'codex_thread_state_bundle',
  'codex_memory_bundle',
  'codex_memory_delta',
  'codex_environment_manifest',
  'codex_plugin_package',
  'codex_skill_bundle',
] as const)('builds codex capsule component ref for %s', (kind) => {
  const ref = buildInternalArtifactRef({
    kind,
    owner_type: 'codex_session',
    owner_id: 'session-1',
    artifact_id: 'artifact-1',
  });
  expect(parseInternalArtifactRef(ref)).toEqual({ kind, owner_type: 'codex_session', owner_id: 'session-1', artifact_id: 'artifact-1' });
});

it('rejects legacy codex_session_snapshot refs', () => {
  expect(() =>
    parseInternalArtifactRef('artifact://internal/codex_session_snapshot/codex_session/session-1/snapshot-1'),
  ).toThrow(/kind is invalid/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm vitest run tests/domain/internal-artifacts.test.ts tests/db/internal-artifact-repository.test.ts tests/api/internal-artifacts-api.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because new kinds are missing and old kind still parses.

- [ ] **Step 3: Replace artifact kinds**

In `packages/domain/src/internal-artifacts.ts`, remove `codex_session_snapshot` and add the seven new kinds. Keep owner type `codex_session`.

- [ ] **Step 4: Update repository/API validation fixtures**

Replace any fixture ref using `artifact://internal/codex_session_snapshot/...` with `artifact://internal/codex_runtime_capsule/...` or the appropriate component kind.

- [ ] **Step 5: Run focused artifact tests**

Run: `pnpm vitest run tests/domain/internal-artifacts.test.ts tests/db/internal-artifact-repository.test.ts tests/api/internal-artifacts-api.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 6: Commit artifact kind changes**

```bash
git add packages/domain/src/internal-artifacts.ts tests/domain/internal-artifacts.test.ts tests/db/internal-artifact-repository.test.ts tests/api/internal-artifacts-api.test.ts
git commit -m "feat: add codex capsule artifact kinds"
```

## Task 4: Implement Capsule Manifest Schemas And Digest Validation

**Files:**
- Create: `packages/domain/src/codex-runtime-capsule.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/src/codex-runtime.ts`
- Add: `tests/domain/codex-runtime-capsule.test.ts`
- Modify: `tests/domain/codex-runtime.test.ts`

- [ ] **Step 1: Write failing manifest tests**

Create `tests/domain/codex-runtime-capsule.test.ts` with tests for:

- canonical capsule manifest digest;
- memory bundle manifest digest;
- memory delta add/modify/delete/rename operations;
- plugin manifest package refs/digests;
- skill manifest bundle refs/digests;
- MCP command payload, cwd policy payload, and literal non-secret env payload round-trip;
- exact `cwd_policy_payload`, `env_allowlist_payload.value_payload`, and `scope_payload.scope_policy_payload` round-trip;
- tool schema payload round-trip;
- app connector schema/scope policy payload round-trip;
- credential binding lineage digest;
- trusted runtime manifest digest;
- product-safe report redaction.

Use this pattern:

```ts
const digest = `sha256:${'a'.repeat(64)}`;
const manifest = codexRuntimeCapsuleManifestSchema.parse({
  schema_version: 'codex_runtime_capsule_manifest.v1',
  codex_session_id: 'session-1',
  created_from_turn_id: 'turn-1',
  sequence: 1,
  codex_thread_id_digest: digest,
  codex_cli_version: '0.133.0',
  app_server_protocol_digest: digest,
  thread_state: {
    artifact_ref: 'artifact://internal/codex_thread_state_bundle/codex_session/session-1/capsule-1-thread',
    digest,
  },
  memory_state: {
    base_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-base',
    base_bundle_digest: digest,
    input_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-0',
    input_bundle_digest: digest,
    output_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-1',
    output_bundle_digest: digest,
    delta_ref: 'artifact://internal/codex_memory_delta/codex_session/session-1/turn-1',
    delta_digest: digest,
  },
  environment_manifest: {
    artifact_ref: 'artifact://internal/codex_environment_manifest/codex_session/session-1/env-1',
    digest,
  },
  included_files: [],
  excluded_patterns: [],
  forbidden_patterns_checked: [],
});

expect(codexRuntimeCapsuleManifestDigest(manifest)).toMatch(/^sha256:/);
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm vitest run tests/domain/codex-runtime-capsule.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because module/schemas are missing.

- [ ] **Step 3: Implement schemas**

In `packages/domain/src/codex-runtime-capsule.ts`, use `zod` and existing `codexCanonicalDigest`/`parseInternalArtifactRef` helpers. Export:

```ts
export const codexRuntimeCapsuleManifestSchema = z.object({ ... }).strict();
export const codexMemoryBundleManifestSchema = z.object({ ... }).strict();
export const codexMemoryDeltaManifestSchema = z.object({ ... }).strict();
export const codexEnvironmentManifestSchema = z.object({ ... }).strict();
export const codexThreadLocatorRepairManifestSchema = z.object({ ... }).strict();
export const codexRuntimeCapsuleDiscoveryReportSchema = z.object({ ... }).strict();
```

Implement digest helpers:

```ts
export const codexRuntimeCapsuleManifestDigest = (manifest: CodexRuntimeCapsuleManifest): string =>
  codexCanonicalDigest(manifest);
```

Repeat for memory bundle, memory delta, environment manifest, plugin manifest, skill manifest, MCP manifest, tool schema manifest, app connector manifest, credential lineage, trusted runtime manifest, and locator repair.

- [ ] **Step 4: Add cross-session ref validation helpers**

Implement:

```ts
export const assertCodexSessionArtifactRef = (input: {
  ref: string;
  expectedKind: InternalArtifactKind;
  codexSessionId: string;
}): void => {
  const parsed = parseInternalArtifactRef(input.ref);
  if (parsed.kind !== input.expectedKind || parsed.owner_type !== 'codex_session' || parsed.owner_id !== input.codexSessionId) {
    throw new DomainError('codex_runtime_capsule_component_ref_invalid', 'Codex runtime capsule component ref is invalid.');
  }
};
```

Add tests proving cross-session component refs are rejected.

- [ ] **Step 5: Add public-safe validation**

Implement a validator that rejects product-safe reports containing:

- raw `codex_thread_id`;
- `artifact://internal/`;
- `auth.json`;
- `config.toml`;
- memory content;
- absolute host paths.

Use `DomainError('codex_runtime_capsule_public_report_unsafe', ...)`.

- [ ] **Step 6: Run focused domain tests**

Run: `pnpm vitest run tests/domain/codex-runtime-capsule.test.ts tests/domain/codex-runtime.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 7: Commit capsule schemas**

```bash
git add packages/domain/src/codex-runtime-capsule.ts packages/domain/src/index.ts packages/domain/src/codex-runtime.ts tests/domain/codex-runtime-capsule.test.ts tests/domain/codex-runtime.test.ts
git commit -m "feat: validate codex runtime capsule manifests"
```

## Task 5: Implement Discovery And Path Classification Gate

**Files:**
- Create: `packages/codex-worker-runtime/src/codex-runtime-capsule/path-classifier.ts`
- Create: `packages/codex-worker-runtime/src/codex-runtime-capsule/discovery.ts`
- Modify: `packages/codex-worker-runtime/src/index.ts`
- Create: `tests/codex-worker-runtime/codex-runtime-capsule-path-classifier.test.ts`
- Create: `tests/codex-worker-runtime/codex-runtime-capsule-discovery.test.ts`
- Create: `scripts/codex-runtime-capsule-discovery.ts`
- Modify: `package.json`
- Create: `tests/smoke/codex-runtime-capsule-dogfood-script.test.ts`

- [ ] **Step 1: Write failing path classifier tests**

In `tests/codex-worker-runtime/codex-runtime-capsule-path-classifier.test.ts`, cover:

```ts
expect(classifyCodexHomePath('sessions/2026/06/02/rollout-abc.jsonl').classification).toBe('thread_state_allowed');
expect(classifyCodexHomePath('auth.json').classification).toBe('forbidden');
expect(classifyCodexHomePath('config.toml').classification).toBe('forbidden');
expect(classifyCodexHomePath('logs_1.sqlite').classification).toBe('forbidden');
expect(classifyCodexHomePath('state_5.sqlite').classification).toBe('forbidden_whole_db');
expect(classifyCodexHomePath('plugins/plugin-a/plugin.json').classification).toBe('environment_component');
expect(classifyCodexHomePath('skills/project/SKILL.md').classification).toBe('environment_component');
expect(classifyCodexHomePath('unknown.bin').classification).toBe('unknown');
expect(() => assertSafeCodexHomeRelativePath('../auth.json')).toThrow(/unsafe/);
```

- [ ] **Step 2: Write failing discovery tests**

In `tests/codex-worker-runtime/codex-runtime-capsule-discovery.test.ts`, fake a discovery runner that reports:

- current Codex CLI version;
- app-server protocol digest;
- observed path mutations;
- locator repair manifest.

Assert discovery fails if:

- any unknown path exists;
- forbidden path is required;
- locator repair strategy asks to copy a whole SQLite DB;
- report includes raw thread id or internal refs in public output.

- [ ] **Step 3: Run tests to verify failure**

Run: `pnpm vitest run tests/codex-worker-runtime/codex-runtime-capsule-path-classifier.test.ts tests/codex-worker-runtime/codex-runtime-capsule-discovery.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because modules are missing.

- [ ] **Step 4: Implement classifier**

In `path-classifier.ts`, implement:

```ts
export type CodexHomePathClassification =
  | 'thread_state_allowed'
  | 'memory_state_allowed'
  | 'environment_component'
  | 'generated_environment'
  | 'forbidden'
  | 'forbidden_whole_db'
  | 'unknown';
```

Reject absolute paths, backslashes, `..`, symlinks, sockets, and any path not explicitly classified.

- [ ] **Step 5: Implement discovery service**

In `discovery.ts`, implement a dependency-injected service:

```ts
export interface CodexRuntimeCapsuleDiscoveryProbe {
  codexVersion(): Promise<string>;
  appServerProtocolDigest(): Promise<string>;
  runControlledScenario(input: { codexHomeRoot: string }): Promise<ObservedCodexHomeState>;
}
```

Return a product-safe `CodexRuntimeCapsuleDiscoveryReport`. Require a `CodexThreadLocatorRepairManifest` before returning `status: 'passed'`.

- [ ] **Step 6: Implement script**

Create `scripts/codex-runtime-capsule-discovery.ts`. It should:

- create a temp isolated root;
- run discovery against installed `codex`;
- write `test-results/codex-runtime-capsule-discovery-report.json`;
- print only report path, digests, counts, and blocker codes;
- exit non-zero on blocker.

Add to `package.json`:

```json
"dogfood:codex-runtime-capsule-discovery": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-runtime-capsule-discovery.ts"
```

- [ ] **Step 7: Run focused tests and script smoke**

Run:

```bash
pnpm vitest run tests/codex-worker-runtime/codex-runtime-capsule-path-classifier.test.ts tests/codex-worker-runtime/codex-runtime-capsule-discovery.test.ts tests/smoke/codex-runtime-capsule-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm dogfood:codex-runtime-capsule-discovery
```

Expected:

- Tests PASS.
- Dogfood either PASS with product-safe report or exits with a product-safe blocker if local Codex prerequisites are unavailable. If it skips/blocks, save the blocker output for later; restore acceptance still requires a real passing report.

- [ ] **Step 8: Commit discovery gate**

```bash
git add packages/codex-worker-runtime/src/codex-runtime-capsule/path-classifier.ts packages/codex-worker-runtime/src/codex-runtime-capsule/discovery.ts packages/codex-worker-runtime/src/index.ts tests/codex-worker-runtime/codex-runtime-capsule-path-classifier.test.ts tests/codex-worker-runtime/codex-runtime-capsule-discovery.test.ts scripts/codex-runtime-capsule-discovery.ts package.json tests/smoke/codex-runtime-capsule-dogfood-script.test.ts
git commit -m "feat: add codex capsule discovery gate"
```

## Task 6: Implement Memory And Environment Materialization

**Files:**
- Create: `packages/codex-worker-runtime/src/codex-runtime-capsule/memory-state.ts`
- Create: `packages/codex-worker-runtime/src/codex-runtime-capsule/environment-state.ts`
- Create: `packages/codex-worker-runtime/src/codex-runtime-capsule/materializer.ts`
- Modify: `packages/codex-worker-runtime/src/index.ts`
- Create: `tests/codex-worker-runtime/codex-runtime-capsule-memory-state.test.ts`
- Create: `tests/codex-worker-runtime/codex-runtime-capsule-environment-state.test.ts`
- Create: `tests/codex-worker-runtime/codex-runtime-capsule-materializer.test.ts`

- [ ] **Step 1: Write failing memory state tests**

In `tests/codex-worker-runtime/codex-runtime-capsule-memory-state.test.ts`, cover:

- full bundle digest from files;
- deletion operation;
- rename operation;
- delta replay only when `input_bundle_digest` matches;
- rejection of paths outside memory root;
- unchanged memory produces output digest equal to input digest and no delta ref requirement.

- [ ] **Step 2: Write failing environment tests**

In `tests/codex-worker-runtime/codex-runtime-capsule-environment-state.test.ts`, cover:

- plugin package materialization from `codex_plugin_package` ref;
- skill bundle materialization from `codex_skill_bundle` ref;
- MCP env `literal_non_secret` requires `value_payload`;
- MCP `command_payload.cwd_policy_payload` is embedded and digest-checked;
- MCP env credential/runtime sources reject `value_payload`;
- connector scope policy digest recomputes from embedded payload;
- connector `scope_payload.scope_policy_payload` is embedded and digest-checked;
- tool schema payload digest recomputes from embedded payload;
- missing package/bundle refs fail closed.

- [ ] **Step 3: Write failing materializer tests**

In `tests/codex-worker-runtime/codex-runtime-capsule-materializer.test.ts`, assert:

```ts
await materializer.materialize({
  codexHomeRoot,
  capsuleManifest,
  runtimeProfileMaterialization,
  credentialBindingMaterialization,
});

expect(readFile(join(codexHomeRoot, 'config.toml'), 'utf8')).resolves.toContain('approval_policy');
expect(readFile(join(codexHomeRoot, 'auth.json'), 'utf8')).resolves.toContain('"OPENAI_API_KEY"');
expect(copiedCapsuleFiles).not.toContain('auth.json');
expect(copiedCapsuleFiles).not.toContain('config.toml');
```

- [ ] **Step 4: Run tests to verify failure**

Run: `pnpm vitest run tests/codex-worker-runtime/codex-runtime-capsule-memory-state.test.ts tests/codex-worker-runtime/codex-runtime-capsule-environment-state.test.ts tests/codex-worker-runtime/codex-runtime-capsule-materializer.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because modules are missing.

- [ ] **Step 5: Implement memory bundle operations**

In `memory-state.ts`, implement:

```ts
export const buildCodexMemoryBundleFromRoot(input: { root: string; codexSessionId: string; bundleId: string; sourcePolicyDigest: string }): Promise<CodexMemoryBundleBuildResult>;
export const diffCodexMemoryBundles(input: { beforeRoot: string; afterRoot: string; inputBundleDigest: string; codexSessionId: string; turnId: string }): Promise<CodexMemoryDeltaManifest | undefined>;
export const replayCodexMemoryDelta(input: { root: string; inputBundleDigest: string; delta: CodexMemoryDeltaManifest }): Promise<string>;
```

Use relative-path validation before any file operation.

- [ ] **Step 6: Implement environment materialization**

In `environment-state.ts`, implement validation and materialization for plugin/skill package bytes and embedded schema payloads. Dependencies should be injected:

```ts
export interface CapsuleComponentArtifactReader {
  read(ref: string, expectedDigest: string): Promise<Uint8Array>;
}
```

Do not read from host global plugin/skill folders unless they were explicitly selected and packaged into Internal Artifact Store.

- [ ] **Step 7: Implement trusted config/auth materializer**

In `materializer.ts`, call `writeCodexHomeConfigAndAuth` from `task-filesystem.ts` after capsule/environment validation. The materializer must not accept `auth.json` or `config.toml` from any capsule archive.

- [ ] **Step 8: Run focused materialization tests**

Run: `pnpm vitest run tests/codex-worker-runtime/codex-runtime-capsule-memory-state.test.ts tests/codex-worker-runtime/codex-runtime-capsule-environment-state.test.ts tests/codex-worker-runtime/codex-runtime-capsule-materializer.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 9: Commit memory/environment materialization**

```bash
git add packages/codex-worker-runtime/src/codex-runtime-capsule/memory-state.ts packages/codex-worker-runtime/src/codex-runtime-capsule/environment-state.ts packages/codex-worker-runtime/src/codex-runtime-capsule/materializer.ts packages/codex-worker-runtime/src/index.ts tests/codex-worker-runtime/codex-runtime-capsule-memory-state.test.ts tests/codex-worker-runtime/codex-runtime-capsule-environment-state.test.ts tests/codex-worker-runtime/codex-runtime-capsule-materializer.test.ts
git commit -m "feat: materialize codex capsule memory and environment"
```

## Task 7: Implement Thread State, Packager, And Restorer

**Files:**
- Create: `packages/codex-worker-runtime/src/codex-runtime-capsule/thread-state.ts`
- Create: `packages/codex-worker-runtime/src/codex-runtime-capsule/packager.ts`
- Create: `packages/codex-worker-runtime/src/codex-runtime-capsule/restorer.ts`
- Modify: `packages/codex-worker-runtime/src/index.ts`
- Create: `tests/codex-worker-runtime/codex-runtime-capsule-thread-state.test.ts`
- Create: `tests/codex-worker-runtime/codex-runtime-capsule-packager.test.ts`
- Create: `tests/codex-worker-runtime/codex-runtime-capsule-restorer.test.ts`

- [ ] **Step 1: Write failing thread-state tests**

In `tests/codex-worker-runtime/codex-runtime-capsule-thread-state.test.ts`, cover:

- package only the rollout JSONL for the bound thread;
- reject rollout paths outside isolated `CODEX_HOME`;
- reject raw `codex_thread_id` in report output;
- accept locator repair strategy `app_server_scan`;
- reject locator repair requiring whole `state_5.sqlite`;
- allow `minimal_state_index_upsert` only with explicit table/columns/row digests.

- [ ] **Step 2: Write failing packager tests**

In `tests/codex-worker-runtime/codex-runtime-capsule-packager.test.ts`, cover:

- upload order: thread bundle, memory bundle/delta, environment manifest, final capsule;
- final manifest includes fetchable refs, not digest-only memory/environment lineage;
- forbidden file rejection (`auth.json`, `config.toml`, `logs_*.sqlite`, `memories_*.sqlite`, `plugins/**` raw copy);
- symlink rejection;
- unknown path rejection;
- digest mismatch rejection before upload.

- [ ] **Step 3: Write failing restorer tests**

In `tests/codex-worker-runtime/codex-runtime-capsule-restorer.test.ts`, cover:

- download and verify capsule archive digest;
- reject missing component artifact;
- reject cross-session component ref;
- reject memory digest mismatch;
- reject environment manifest digest mismatch;
- restore into a fresh isolated root only;
- never write `auth.json`/`config.toml`;
- fail if app-server protocol digest mismatches.

- [ ] **Step 4: Run tests to verify failure**

Run: `pnpm vitest run tests/codex-worker-runtime/codex-runtime-capsule-thread-state.test.ts tests/codex-worker-runtime/codex-runtime-capsule-packager.test.ts tests/codex-worker-runtime/codex-runtime-capsule-restorer.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because modules are missing.

- [ ] **Step 5: Implement thread state bundle**

In `thread-state.ts`, implement:

```ts
export const packageCodexThreadStateBundle(input: { codexHomeRoot: string; locatorRepair: CodexThreadLocatorRepairManifest; codexSessionId: string; capsuleId: string }): Promise<ThreadStateBundleBuildResult>;
export const restoreCodexThreadStateBundle(input: { codexHomeRoot: string; bundle: ThreadStateBundle; locatorRepair: CodexThreadLocatorRepairManifest }): Promise<void>;
```

Do not copy complete `state_5.sqlite`; only apply the verified locator repair operation.

- [ ] **Step 6: Implement packager**

In `packager.ts`, implement:

```ts
export interface CodexRuntimeCapsuleArtifactWriter {
  write(input: { kind: InternalArtifactKind; ownerId: string; artifactId: string; content: Uint8Array; digest: string; metadata: Record<string, unknown> }): Promise<{ ref: string; digest: string; size_bytes: string }>;
}
```

Package only allowlisted state. On any unknown/forbidden path, throw a product-safe `DomainError` such as `codex_runtime_capsule_unknown_path`.

- [ ] **Step 7: Implement restorer**

In `restorer.ts`, implement:

```ts
export const restoreCodexRuntimeCapsule = async (input: {
  codexHomeRoot: string;
  codexSessionId: string;
  expectedCapsuleDigest: string;
  capsuleRef: string;
  artifactReader: CapsuleComponentArtifactReader;
  currentCodexCliVersion: string;
  currentAppServerProtocolDigest: string;
}): Promise<RestoredCodexRuntimeCapsule>;
```

Verify every digest before writing files. Reject version/protocol drift.

- [ ] **Step 8: Run focused pack/restore tests**

Run: `pnpm vitest run tests/codex-worker-runtime/codex-runtime-capsule-thread-state.test.ts tests/codex-worker-runtime/codex-runtime-capsule-packager.test.ts tests/codex-worker-runtime/codex-runtime-capsule-restorer.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 9: Commit pack/restore core**

```bash
git add packages/codex-worker-runtime/src/codex-runtime-capsule/thread-state.ts packages/codex-worker-runtime/src/codex-runtime-capsule/packager.ts packages/codex-worker-runtime/src/codex-runtime-capsule/restorer.ts packages/codex-worker-runtime/src/index.ts tests/codex-worker-runtime/codex-runtime-capsule-thread-state.test.ts tests/codex-worker-runtime/codex-runtime-capsule-packager.test.ts tests/codex-worker-runtime/codex-runtime-capsule-restorer.test.ts
git commit -m "feat: package and restore codex runtime capsules"
```

## Task 8: Wire Worker Restore/Pack Into App-Server Orchestration

**Files:**
- Modify: `packages/codex-worker-runtime/src/task-filesystem.ts`
- Modify: `packages/codex-worker-runtime/src/app-server-launcher.ts`
- Modify: `packages/codex-worker-runtime/src/remote-worker-client.ts`
- Modify: `packages/codex-worker-runtime/src/runtime-job-artifacts.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/product-generation-runtime-scheduler.service.ts`
- Modify: `apps/control-plane-api/src/modules/automation/product-generation-result.service.ts`
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/codex-session-lease.service.ts`
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/internal-codex-session.controller.ts`
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts`
- Modify: `apps/control-plane-api/src/modules/http/domain-error.filter.ts`
- Modify: `tests/codex-worker-runtime/app-server-launcher.test.ts`
- Modify: `tests/codex-worker-runtime/remote-worker-client.test.ts`
- Modify: `tests/api/codex-runtime-product-generation-scheduler.test.ts`
- Modify: `tests/api/codex-session-lease.test.ts`
- Modify: `tests/api/plan-item-workflows.test.ts`

- [ ] **Step 1: Write failing worker orchestration tests**

In `tests/codex-worker-runtime/remote-worker-client.test.ts`, add cases:

- later turn with `input_capsule_ref` calls restorer before launching app-server;
- first turn without `base_memory_bundle_ref` fails closed;
- restored turn sends normal resume request through driver and never calls `thread/start`;
- successful turn packages output capsule before terminalizing runtime job;
- packaging failure after Codex turn returns blocked/failed and does not mark generation succeeded.

- [ ] **Step 2: Write failing scheduler/API tests**

In `tests/api/codex-runtime-product-generation-scheduler.test.ts`, assert trusted workload context contains:

```ts
expectedInputCapsuleDigest: session.latest_capsule_digest,
inputCapsuleId: session.latest_capsule_id,
inputMemoryBundleRef: session.latest_memory_bundle_ref,
inputEnvironmentManifestRef: session.latest_environment_manifest_ref,
```

In `tests/api/codex-session-lease.test.ts`, assert terminalization accepts `output_capsule_*` fields and rejects `output_snapshot_*`.

In `tests/api/plan-item-workflows.test.ts` or a focused trusted-internal API test, assert the route rename:

```ts
await signedAutomationPost(app, `/internal/codex-sessions/${sessionId}/runtime-capsules`, {
  capsule_id: 'capsule-1',
  sequence: 1,
  artifact_ref: `artifact://internal/codex_runtime_capsule/codex_session/${sessionId}/capsule-1`,
  digest: digestA,
  size_bytes: '123',
  manifest_digest: digestB,
  thread_state_digest: digestC,
  memory_state_digest: digestD,
  environment_manifest_digest: digestE,
  codex_thread_id_digest: digestF,
  codex_cli_version: '0.133.0',
  app_server_protocol_digest: digestG,
  runtime_profile_revision_id: 'profile-revision-1',
  trusted_runtime_manifest_digest: digestH,
  credential_binding_lineage_digest: digestI,
  created_from_turn_id: turnId,
  actor_id: actorId,
}).expect(201);

await signedAutomationPost(app, `/internal/codex-sessions/${sessionId}/snapshots`, {}).expect(404);
```

- [ ] **Step 3: Run tests to verify failure**

Run: `pnpm vitest run tests/codex-worker-runtime/remote-worker-client.test.ts tests/api/codex-runtime-product-generation-scheduler.test.ts tests/api/codex-session-lease.test.ts tests/api/plan-item-workflows.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL with old snapshot fields and missing capsule orchestration.

- [ ] **Step 4: Extend task filesystem for restore**

In `packages/codex-worker-runtime/src/task-filesystem.ts`, add an option:

```ts
restoreCodexHome?: (codexHomeHostPath: string) => Promise<void>;
writeConfigAndAuth?: boolean;
```

Default `writeConfigAndAuth` stays true for existing paths. Capsule restore path should:

1. create isolated `codex-home`;
2. restore capsule files;
3. materialize trusted config/auth after restore validation.

- [ ] **Step 5: Wire launcher hooks**

In `app-server-launcher.ts`, add optional hooks to `startFromMaterialization`:

```ts
beforeAppServerStart?: (input: { codexHomeHostPath: string; artifactHostPath: string }) => Promise<void>;
beforeRuntimeCleanup?: (input: { codexHomeHostPath: string; artifactHostPath: string; status: 'succeeded' | 'failed' | 'cancelled' }) => Promise<void>;
```

Use them for restore and packager. Ensure cleanup never runs before packager on successful turns.

- [ ] **Step 6: Update worker runtime context**

In `remote-worker-client.ts`, validate capsule context. For bound sessions:

- restore input capsule if present;
- require base memory bundle for first materialized turn;
- launch app-server after restore/materialization;
- call existing driver resume path with `threadId`;
- package output capsule before terminal runtime result;
- include output capsule id/digest/ref/manifest digest and memory/environment output refs in terminal result.

- [ ] **Step 7: Update control-plane DTO/service**

Rename worker-facing DTO fields:

```ts
expected_input_capsule_digest
input_capsule_id
input_capsule_digest
output_capsule_id
output_capsule_sequence
output_capsule_artifact_ref
output_capsule_digest
output_capsule_size_bytes
output_capsule_manifest_digest
```

Add memory/environment terminal fields from the spec. Reject old snapshot fields via strict schemas.

- [ ] **Step 8: Rename trusted runtime-capsule route**

In `apps/control-plane-api/src/modules/plan-item-workflows/internal-codex-session.controller.ts`:

- add `POST /internal/codex-sessions/:sessionId/runtime-capsules` if capsule creation remains a separate trusted route;
- otherwise route terminalization-created capsules through the same capsule-named service method and keep no `/snapshots` route;
- call `createCodexRuntimeCapsule` / `getCodexRuntimeCapsule` repository methods only;
- never expose raw component artifact refs in product DTOs.

- [ ] **Step 9: Update scheduler and product result bridge**

In scheduler/service files, use session latest capsule/memory/environment fields. Later turns missing latest capsule, memory, or environment refs must block with product-safe codes:

- `codex_runtime_capsule_missing`
- `codex_memory_bundle_missing`
- `codex_environment_manifest_missing`

Do not start replacement threads on these failures.

- [ ] **Step 10: Run focused orchestration tests**

Run: `pnpm vitest run tests/codex-worker-runtime/app-server-launcher.test.ts tests/codex-worker-runtime/remote-worker-client.test.ts tests/api/codex-runtime-product-generation-scheduler.test.ts tests/api/codex-session-lease.test.ts tests/api/plan-item-workflows.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 11: Commit orchestration wiring**

```bash
git add packages/codex-worker-runtime/src/task-filesystem.ts packages/codex-worker-runtime/src/app-server-launcher.ts packages/codex-worker-runtime/src/remote-worker-client.ts packages/codex-worker-runtime/src/runtime-job-artifacts.ts apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts apps/control-plane-api/src/modules/codex-runtime/product-generation-runtime-scheduler.service.ts apps/control-plane-api/src/modules/automation/product-generation-result.service.ts apps/control-plane-api/src/modules/plan-item-workflows/codex-session-lease.service.ts apps/control-plane-api/src/modules/plan-item-workflows/internal-codex-session.controller.ts apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts apps/control-plane-api/src/modules/http/domain-error.filter.ts tests/codex-worker-runtime/app-server-launcher.test.ts tests/codex-worker-runtime/remote-worker-client.test.ts tests/api/codex-runtime-product-generation-scheduler.test.ts tests/api/codex-session-lease.test.ts tests/api/plan-item-workflows.test.ts
git commit -m "feat: restore and package capsules in codex workers"
```

## Task 9: Add Cross-Worker Restore Dogfood

**Files:**
- Create: `scripts/codex-runtime-capsule-restore-dogfood.ts`
- Modify: `package.json`
- Modify: `tests/smoke/codex-runtime-capsule-dogfood-script.test.ts`
- Create: `docs/runbooks/codex-runtime-capsule-restore.md`

- [ ] **Step 1: Write failing script smoke tests**

In `tests/smoke/codex-runtime-capsule-dogfood-script.test.ts`, add tests that invoke script helpers with fake probes and assert:

- credentials unavailable prints `SKIP` with product-safe reason;
- discovery blocker prints blocker codes only;
- passing fake scenario writes `test-results/codex-runtime-capsule-restore-report.json`;
- report excludes raw thread ids, raw memory text, internal refs, `auth.json`, and `config.toml`.

- [ ] **Step 2: Run smoke tests to verify failure**

Run: `pnpm vitest run tests/smoke/codex-runtime-capsule-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because restore script is missing.

- [ ] **Step 3: Implement restore dogfood script**

Create `scripts/codex-runtime-capsule-restore-dogfood.ts`. It must:

1. create two isolated `CODEX_HOME` roots;
2. run or require a passing discovery report;
3. start/generate a turn in root A;
4. package capsule A;
5. restore capsule A into root B;
6. resume same `codex_thread_id_digest`;
7. verify memory output/input digest continuity including deletion/rename delta replay;
8. verify environment manifest digest continuity;
9. package capsule B;
10. write product-safe report.

If credentials are unavailable, print `SKIP codex_runtime_capsule_restore_credentials_unavailable` and exit 0. The wave is not accepted until a real passing report exists, but CI may skip.

- [ ] **Step 4: Add package script**

In `package.json`:

```json
"dogfood:codex-runtime-capsule-restore": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-runtime-capsule-restore-dogfood.ts"
```

- [ ] **Step 5: Add runbook**

Create `docs/runbooks/codex-runtime-capsule-restore.md` with:

- prerequisites;
- how to run discovery and restore dogfood;
- accepted PASS/SKIP/BLOCKED output shape;
- no raw thread id/ref/memory output policy;
- known local credential skip behavior.

- [ ] **Step 6: Run focused dogfood tests and script**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-capsule-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm dogfood:codex-runtime-capsule-restore
```

Expected:

- Smoke tests PASS.
- Dogfood PASS if local credentials and discovery are available; otherwise SKIP with product-safe code. Before final acceptance, a real PASS report must be captured and attached to PR evidence.

- [ ] **Step 7: Commit dogfood**

```bash
git add scripts/codex-runtime-capsule-restore-dogfood.ts package.json tests/smoke/codex-runtime-capsule-dogfood-script.test.ts docs/runbooks/codex-runtime-capsule-restore.md
git commit -m "feat: dogfood codex runtime capsule restore"
```

## Task 10: Extend No-Baggage Guard

**Files:**
- Modify: `scripts/check-codex-runtime-superpowers-no-baggage.ts`
- Modify: `tests/smoke/codex-runtime-no-baggage-gate.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing negative tests**

In `tests/smoke/codex-runtime-no-baggage-gate.test.ts`, add a temp file scan containing:

```ts
type CodexSessionSnapshot = {};
const latest_snapshot_digest = 'sha256:old';
const ref = 'artifact://internal/codex_session_snapshot/codex_session/session-1/snapshot-1';
const error = 'codex_session_snapshot_stale';
const fork_point_snapshot_id = 'snapshot-1';
const camel = { latestSnapshotId: 'snapshot-1', expectedPreviousSnapshotDigest: 'sha256:old', outputSnapshotId: 'snapshot-2', forkPointSnapshotId: 'snapshot-1' };
await repository.createCodexSessionSnapshot(snapshot);
await repository.getCodexSessionSnapshot('snapshot-1');
await fetch('/internal/codex-sessions/session-1/snapshots');
await fetch('/internal/codex-sessions/:sessionId/snapshots');
```

Assert violations include a new pattern:

```ts
'legacy_codex_session_snapshot'
```

- [ ] **Step 2: Run no-baggage tests to verify failure**

Run: `pnpm vitest run tests/smoke/codex-runtime-no-baggage-gate.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because the guard does not detect legacy snapshot names yet.

- [ ] **Step 3: Add scanner pattern**

In `scripts/check-codex-runtime-superpowers-no-baggage.ts`, add `legacy_codex_session_snapshot` with patterns:

- `CodexSessionSnapshot`
- `codex_session_snapshot`
- `latest_snapshot_`
- `expected_previous_snapshot_digest`
- `output_snapshot_`
- `forked_from_snapshot_id`
- `fork_point_snapshot_`
- `codex_session_snapshot_stale`
- `latestSnapshot`
- `expectedPreviousSnapshotDigest`
- `outputSnapshot`
- `attemptedOutputSnapshotDigest`
- `forkedFromSnapshotId`
- `forkPointSnapshot`
- `codexSessionSnapshots`
- `createCodexSessionSnapshot`
- `getCodexSessionSnapshot`
- `getLatestSnapshot`
- `/codex-sessions/[^'"]+/snapshots`
- `:sessionId/snapshots`

Allow only:

- historical design docs under `docs/superpowers/specs/` that explicitly describe superseded names;
- this plan file while implementation is in progress, if needed;
- negative tests.

Runtime code, active API contracts, repository tests, worker tests, scripts, and runbooks must not be allowlisted.

- [ ] **Step 4: Run full no-baggage gate**

Run:

```bash
pnpm vitest run tests/smoke/codex-runtime-no-baggage-gate.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm check:codex-runtime-superpowers-no-baggage
```

Expected: PASS with zero active violations.

- [ ] **Step 5: Commit no-baggage guard**

```bash
git add scripts/check-codex-runtime-superpowers-no-baggage.ts tests/smoke/codex-runtime-no-baggage-gate.test.ts package.json
git commit -m "test: reject legacy codex snapshot baggage"
```

## Task 11: Final Integration Verification

**Files:**
- Review all modified files from Tasks 1-10.

- [ ] **Step 1: Search for forbidden active legacy names**

Run:

```bash
rg -n "CodexSessionSnapshot|codex_session_snapshot|latest_snapshot_|expected_previous_snapshot_digest|output_snapshot_|forked_from_snapshot_id|fork_point_snapshot_|codex_session_snapshot_stale|latestSnapshot|expectedPreviousSnapshotDigest|outputSnapshot|attemptedOutputSnapshotDigest|forkedFromSnapshotId|forkPointSnapshot|codexSessionSnapshots|createCodexSessionSnapshot|getCodexSessionSnapshot|getLatestSnapshot|codex-sessions/.*/snapshots|:sessionId/snapshots" packages apps scripts tests docs/runbooks
```

Expected: no output except intentional negative tests if the no-baggage guard allowlists them.

- [ ] **Step 2: Run focused capsule suites**

Run:

```bash
pnpm vitest run \
  tests/domain/codex-runtime-capsule.test.ts \
  tests/domain/internal-artifacts.test.ts \
  tests/domain/plan-item-workflow.test.ts \
  tests/contracts/plan-item-workflow.test.ts \
  tests/db/schema.test.ts \
  tests/db/plan-item-workflow-repository.test.ts \
  tests/codex-worker-runtime/codex-runtime-capsule-path-classifier.test.ts \
  tests/codex-worker-runtime/codex-runtime-capsule-discovery.test.ts \
  tests/codex-worker-runtime/codex-runtime-capsule-memory-state.test.ts \
  tests/codex-worker-runtime/codex-runtime-capsule-environment-state.test.ts \
  tests/codex-worker-runtime/codex-runtime-capsule-materializer.test.ts \
  tests/codex-worker-runtime/codex-runtime-capsule-thread-state.test.ts \
  tests/codex-worker-runtime/codex-runtime-capsule-packager.test.ts \
  tests/codex-worker-runtime/codex-runtime-capsule-restorer.test.ts \
  tests/codex-worker-runtime/remote-worker-client.test.ts \
  tests/api/codex-runtime-product-generation-scheduler.test.ts \
  tests/api/codex-session-lease.test.ts \
  tests/smoke/codex-runtime-capsule-dogfood-script.test.ts \
  tests/smoke/codex-runtime-no-baggage-gate.test.ts \
  --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 3: Run package builds/tests**

Run:

```bash
pnpm --filter @forgeloop/domain build
pnpm --filter @forgeloop/contracts build
pnpm --filter @forgeloop/db build
pnpm --filter @forgeloop/codex-runtime build
pnpm --filter @forgeloop/codex-worker-runtime build
pnpm test
```

Expected: PASS.

- [ ] **Step 4: Run dogfood commands**

Run:

```bash
pnpm dogfood:codex-runtime-capsule-discovery
pnpm dogfood:codex-runtime-capsule-restore
```

Expected:

- Discovery PASS with product-safe report.
- Restore PASS with product-safe report before final wave acceptance. If restore skips due to credentials, document it in PR notes and do not claim full Wave 4 acceptance.

- [ ] **Step 5: Run hygiene checks**

Run:

```bash
pnpm check:codex-runtime-superpowers-no-baggage
git diff --check
git status --short
```

Expected:

- No-baggage check PASS.
- `git diff --check` has no output.
- `git status --short` shows only intentional files before final commit.

- [ ] **Step 6: Final commit**

If any final verification-only/doc cleanup remains:

```bash
git add <remaining-intentional-files>
git commit -m "chore: verify codex runtime capsule restore"
```

Expected: Working tree clean except expected untracked local `test-results/` if ignored.

## Implementation Notes For Agents

- Do not introduce `CodexSessionSnapshot`, `codex_session_snapshot`, `latest_snapshot_*`, `output_snapshot_*`, `fork_point_snapshot_*`, `latestSnapshot*`, `outputSnapshot*`, `forkPointSnapshot*`, `expectedPreviousSnapshotDigest`, `createCodexSessionSnapshot`, `getCodexSessionSnapshot`, `getLatestSnapshot`, `/codex-sessions/:sessionId/snapshots`, or compatibility aliases anywhere in active code.
- Do not add adapters that read old snapshot refs. The product is not live.
- Do not copy whole `CODEX_HOME`, whole `state_5.sqlite`, `auth.json`, `config.toml`, logs sqlite, memories sqlite, cache, plugin folders, or skill folders from a worker global home.
- Do not use Codex app-server `history`, `path`, or `Thread.sessionId` for normal restore.
- Keep the normal resume request exactly:

```ts
{
  threadId: rawCodexThreadId,
  excludeTurns: true,
  persistExtendedHistory: false,
}
```

- Any missing or mismatched capsule, memory, environment, credential, protocol, discovery, or thread-state input blocks the session. It must not start a replacement thread or silently continue with worker-local state.
