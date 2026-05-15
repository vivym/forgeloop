# PRD-first Automation Daemon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build ForgeLoop's PRD-first automation daemon foundation with control-plane idempotency, runtime safety, opt-in automation, and a public-safe runtime projection.

**Architecture:** Keep `control-plane-api` as the only authoritative product-state write boundary, keep `run-worker` as the owner of RunSession execution/recovery, and add a sidecar `automation-daemon` that only executes eligible `NextAction`s through idempotent control-plane commands. Runtime policy is repo-owned execution configuration, not product workflow configuration; frozen package policy snapshots and path/command safety must exist before automatic run enqueue can be enabled.

**Tech Stack:** TypeScript, NestJS, Drizzle ORM, Vitest, pnpm workspaces, Node `fs/path/child_process`, `minimatch`, existing `@forgeloop/domain`, `@forgeloop/db`, `@forgeloop/executor`, `@forgeloop/run-worker`, and `@forgeloop/control-plane-api`.

---

## Scope And Stop Signs

This spec spans several subsystems. Implement it as a sequence of independently testable PRs. Do not enable daemon mutation before Phase 0 is complete. Do not enable `run_enqueue` before both Phase 0 and Phase 1 are complete and their tests pass.

Hard rules for every task:

- Do not copy Symphony's tracker-first flow.
- Do not let repo policy, external trackers, or daemon identities approve Spec, Plan, ReviewPacket, Release, or automation capabilities.
- Do not let the daemon write product statuses directly.
- Do not make `run_enqueue` default-on.
- Do not expose local paths, raw runtime metadata, raw command output, fallback stderr, or automation diagnostics through public query DTOs.
- Do not rely on `automation_action_runs` as the only safety mechanism. Product commands must be idempotent and CAS-protected.

Before starting implementation, read:

- `docs/PRD_v1.md`
- `docs/superpowers/specs/2026-05-13-prd-first-automation-daemon-design.md`
- `apps/control-plane-api/src/p0/p0.service.ts`
- `packages/db/src/repositories/p0-repository.ts`
- `packages/db/src/repositories/in-memory-p0-repository.ts`
- `packages/db/src/repositories/drizzle-p0-repository.ts`
- `packages/executor/src/local-codex-preflight.ts`
- `packages/executor/src/codex-worktree.ts`
- `packages/run-worker/src/run-worker.ts`

## File Structure

Create and modify these units. Keep files focused; do not put planner/executor/runtime-policy logic into `p0.service.ts`.

### Domain

- Modify: `packages/domain/src/types.ts`
  - Add automation capability, manual hold, idempotency, action run, generation run, path policy, validation strategy, and policy snapshot types.
  - Align `ReviewPacketStatus` with the database enum by including `draft` and `escalated`.
  - Add execution package mutable `version` and frozen package policy fields.
- Modify: `packages/domain/src/states.ts`
  - Default new `ExecutionPackage.version` to `0` and increment it on mutable package transitions.
- Create: `packages/domain/src/automation.ts`
  - Pure helpers and shared contracts: capability resolution, capability fingerprints, automation actor authorization checks, precondition fingerprints, runtime safety attestation types, hold scope builders, terminal/eligible status helpers.
- Modify: `packages/domain/src/validators.ts`
  - Validate execution package version, validation strategy, path policy freeze/readiness, and package policy snapshot readiness.
- Modify: `packages/domain/src/index.ts`
  - Export `automation.ts`.
- Test: `tests/domain/automation.test.ts`
- Test: `tests/domain/validators.test.ts`
- Test: `tests/domain/states.test.ts`

### Database Schema And Repository

- Create: `packages/db/src/schema/automation.ts`
  - Tables/enums: `automation_project_settings`, `manual_path_holds`, `command_idempotency_records`, `execution_package_generation_runs`, `automation_action_runs`, optionally `automation_cursors`.
- Modify: `packages/db/src/schema/execution-package.ts`
  - Add `version`, package generation identity, validation strategy fields, policy snapshot fields, and manifest digest fields.
- Modify: `packages/db/src/schema/run-session.ts`
  - Add partial unique guard for active statuses per `execution_package_id`.
- Modify: `packages/db/src/schema/review-packet.ts`
  - Add partial unique guard for open statuses per `execution_package_id`.
- Modify: `packages/db/src/schema/index.ts`
  - Export `automation.ts`.
- Modify: `packages/db/src/repositories/p0-repository.ts`
  - Add repository methods for automation settings, holds, idempotency, object locks, package generation manifests, action runs, active run/open review lookup, and runtime snapshot reads.
- Create: `packages/db/src/repositories/object-lock.ts`
  - Small in-memory mutex helper and shared lock ordering names.
- Modify: `packages/db/src/repositories/in-memory-p0-repository.ts`
  - Implement new methods with critical sections and same uniqueness/CAS behavior as durable repository.
- Modify: `packages/db/src/repositories/drizzle-p0-repository.ts`
  - Implement new methods with transactions, row locks or serializable-equivalent checks, partial unique indexes where available.
- Test: `tests/db/repository-contract.ts`
- Test: `tests/db/repository.test.ts`
- Test: `tests/db/automation-repository.test.ts`

### Control Plane Commands

- Create: `apps/control-plane-api/src/p0/automation-command-helpers.ts`
  - Normalize command preconditions, compute fingerprints, map command outcomes, and redact internal errors.
- Modify: `apps/control-plane-api/src/p0/dto.ts`
  - Add DTOs for automation capability updates, manual holds, and internal action run inspection.
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
  - Add idempotent command boundaries:
    - `setAutomationCapabilities`
    - `disableAutomation`
    - `requestManualPath`
    - `resolveManualPath`
    - `ensurePlanDraftForApprovedSpec`
    - `ensureExecutionPackageDraftsForPlanRevision`
    - `supersedeExecutionPackageGenerationRun`
    - `markPackageReady`
    - `enqueueRunIfPackageStillReady`
  - Keep existing manual methods, but route daemon-safe paths through the new commands.
- Create: `apps/control-plane-api/src/p0/p0-bootstrap.ts`
  - Shared repository/run-worker factories, including daemon no-op `RunWorker` provider.
- Modify: `apps/control-plane-api/src/p0/p0.module.ts`
  - Use shared bootstrap factories while keeping `RunWorkerLifecycleService` API-only.
- Modify: `apps/control-plane-api/src/p0/p0.controller.ts`
  - Add local/admin endpoints only where required by the spec.
- Modify: `apps/control-plane-api/src/modules/release/release.service.ts`
  - Reject automation daemon/source adapter/repo policy actors for Integration, Test, Release, rollout, and observation gate-passing commands.
- Test: `tests/api/automation-commands.test.ts`
- Test: `tests/api/delivery-flow.test.ts`
- Test: `tests/api/release-module.test.ts`

### Executor Runtime Safety

- Modify: `packages/executor/package.json`
  - Add `minimatch` as a runtime dependency.
- Create: `packages/executor/src/path-safety.ts`
  - Segment-by-segment canonicalization, root equality rejection, symlink escape classification, artifact root guard.
- Create: `packages/executor/src/path-policy.ts`
  - Typed POSIX glob validation and matching with normative options.
- Create: `packages/executor/src/runtime-policy.ts`
  - `WORKFLOW.md` front matter parser, digest, last-known-good loader, safe defaults, policy path safety.
- Create: `packages/executor/src/structured-command.ts`
  - Structured command spec validation and safe spawn wrapper.
- Create: `packages/executor/src/resource-limits.ts`
  - Runtime capability detection and hard/soft limit enforcement surface that returns the shared domain `RuntimeSafetyAttestation`.
- Create: `packages/executor/src/resource-governor.ts`
  - Enforcing runtime governor abstraction that produces the shared domain `RuntimeSafetyAttestation`. Production `run_enqueue` requires an enforcing governor attestation; test-only mock governor is allowed only for mock executor dogfood.
- Create: `packages/executor/src/hook-runner.ts`
  - `before_run` / `after_run` hook execution path with timeout, redaction, and fail-closed semantics for `before_run`.
- Modify: `packages/executor/src/codex-app-server-driver.ts`
  - Consume the frozen package policy snapshot during app-server startup/resume.
- Modify: `packages/executor/src/codex-worktree.ts`
  - Use `PathSafety` before cleanup/removal and worktree creation.
- Modify: `packages/executor/src/local-codex-preflight.ts`
  - Enforce frozen checks/path policy before local Codex runtime.
- Modify: `packages/run-worker/src/run-worker.ts`
  - Consume `after_run` hook execution and frozen package policy snapshot during run completion/startup paths.
- Modify: `packages/executor/src/codex-exec-fallback-driver.ts`
  - Enforce fallback policy, cwd/env restrictions, and public-safe reason codes.
- Modify: `packages/executor/src/local-codex-evidence.ts`
  - Redact/truncate runtime artifacts unless explicitly public-safe.
- Modify: `packages/executor/src/index.ts`
  - Export runtime safety modules.
- Test: `tests/executor/path-safety.test.ts`
- Test: `tests/executor/path-policy.test.ts`
- Test: `tests/executor/runtime-policy.test.ts`
- Test: `tests/executor/structured-command.test.ts`
- Test: `tests/executor/resource-governor.test.ts`
- Test: `tests/executor/hook-runner.test.ts`
- Test: `tests/executor/local-codex-preflight.test.ts`
- Test: `tests/executor/codex-worktree.test.ts`
- Test: `tests/run-worker/run-worker.test.ts`

### Automation Package And Daemon

- Modify: `tsconfig.base.json`
  - Add path aliases `@forgeloop/automation` and `@forgeloop/control-plane-api/*`.
- Create: `packages/automation/package.json`
- Create: `packages/automation/tsconfig.json`
- Create: `packages/automation/src/types.ts`
- Create: `packages/automation/src/idempotency.ts`
- Create: `packages/automation/src/planner.ts`
- Create: `packages/automation/src/executor.ts`
- Create: `packages/automation/src/source-adapter.ts`
- Create: `packages/automation/src/index.ts`
- Create: `apps/automation-daemon/package.json`
- Create: `apps/automation-daemon/tsconfig.json`
- Create: `apps/automation-daemon/src/main.ts`
- Create: `apps/automation-daemon/src/automation-daemon.ts`
- Create: `apps/automation-daemon/src/automation-daemon.module.ts`
- Create: `apps/automation-daemon/src/control-plane-command-boundary.ts`
- Modify: `package.json`
  - Add `dev:automation-daemon`.
- Test: `tests/automation/planner.test.ts`
- Test: `tests/automation/executor.test.ts`
- Test: `tests/automation/daemon.test.ts`

### Runtime Snapshot

- Create: `packages/db/src/queries/runtime-snapshot-queries.ts`
- Modify: `packages/db/src/index.ts`
- Create: `apps/control-plane-api/src/modules/query/runtime-snapshot.projector.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.service.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.controller.ts`
- Test: `tests/api/runtime-snapshot.test.ts`
- Test: `tests/api/query-module.test.ts`

### Smoke And Docs

- Create: `scripts/automation-dogfood.ts`
- Test: `tests/smoke/automation-dogfood-script.test.ts`
- Modify: `README.md` or create `docs/automation-daemon.md`
  - Document default-off behavior, local dogfood enablement, and `run_enqueue` stop signs.

## Task 0: Baseline Guardrails

**Files:**

- Read: `docs/superpowers/specs/2026-05-13-prd-first-automation-daemon-design.md`
- Read: `docs/PRD_v1.md`
- Read: `package.json`
- Read: `packages/domain/src/types.ts`
- Read: `packages/db/src/repositories/p0-repository.ts`
- Read: `apps/control-plane-api/src/p0/p0.service.ts`

- [ ] **Step 1: Capture current baseline**

Run: `git status --short`

Expected: only user-owned or spec/plan changes are present. Do not revert unrelated files.

- [ ] **Step 2: Run focused baseline tests**

Run:

```bash
pnpm test tests/domain/states.test.ts tests/domain/validators.test.ts tests/db/repository.test.ts tests/api/delivery-flow.test.ts tests/run-worker/run-worker.test.ts
```

Expected: PASS. If tests fail before changes, record the failing test names in the task notes before editing code.

- [ ] **Step 3: Confirm build baseline**

Run: `pnpm -r build`

Expected: PASS.

- [ ] **Step 4: Commit baseline note only if code was touched**

If no code was touched, do not commit.

## Task 1: Domain Automation Contracts

**Files:**

- Modify: `packages/domain/src/types.ts`
- Create: `packages/domain/src/automation.ts`
- Modify: `packages/domain/src/validators.ts`
- Modify: `packages/domain/src/states.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `tests/domain/automation.test.ts`
- Test: `tests/domain/validators.test.ts`
- Test: `tests/domain/states.test.ts`

- [ ] **Step 1: Write failing tests for capability defaults and actor rejection**

Add `tests/domain/automation.test.ts`:

```ts
import {
  automationCapabilitiesForPreset,
  assertAutomationCapabilityActor,
  capabilityFingerprint,
  type AutomationActorContext,
} from '../../packages/domain/src/index';

describe('automation capability helpers', () => {
  it('defaults missing production settings to off', () => {
    expect(automationCapabilitiesForPreset('off')).toEqual({
      canProjectRuntimeState: false,
      canGeneratePlanDraft: false,
      canGeneratePackageDrafts: false,
      canEnqueueRuns: false,
    });
  });

  it('treats presets as named capabilities, not an ordinal enum', () => {
    expect(automationCapabilitiesForPreset('ready_projection')).toMatchObject({
      canProjectRuntimeState: true,
      canGeneratePlanDraft: false,
      canGeneratePackageDrafts: false,
      canEnqueueRuns: false,
    });
    expect(automationCapabilitiesForPreset('draft_only')).toMatchObject({
      canGeneratePlanDraft: true,
      canGeneratePackageDrafts: true,
      canEnqueueRuns: false,
    });
  });

  it('rejects daemon, source adapter, tracker, and repo policy actors for capability updates', () => {
    const rejected: AutomationActorContext[] = [
      { actor_id: 'daemon-1', actor_class: 'automation_daemon' },
      { actor_id: 'adapter-1', actor_class: 'source_adapter' },
      { actor_id: 'tracker-1', actor_class: 'external_tracker' },
      { actor_id: 'policy-1', actor_class: 'repo_policy' },
    ];

    for (const actor of rejected) {
      expect(() => assertAutomationCapabilityActor(actor)).toThrow(/automation capability updates/i);
    }

    expect(() => assertAutomationCapabilityActor({ actor_id: 'admin-1', actor_class: 'human_admin' })).not.toThrow();
  });

  it('computes stable fingerprints from normalized capabilities', () => {
    expect(capabilityFingerprint({ canEnqueueRuns: false, canGeneratePackageDrafts: true, canGeneratePlanDraft: true, canProjectRuntimeState: true }))
      .toBe(capabilityFingerprint({ canProjectRuntimeState: true, canGeneratePlanDraft: true, canGeneratePackageDrafts: true, canEnqueueRuns: false }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/domain/automation.test.ts`

Expected: FAIL because `automation.ts` and exported helpers do not exist.

- [ ] **Step 3: Add domain automation types and helpers**

Create `packages/domain/src/automation.ts` with these exported concepts:

```ts
import { createHash } from 'node:crypto';

export type AutomationPreset = 'off' | 'ready_projection' | 'draft_only' | 'run_enqueue';
export type AutomationActorClass =
  | 'human_admin'
  | 'human'
  | 'system_bootstrap'
  | 'migration'
  | 'automation_daemon'
  | 'source_adapter'
  | 'external_tracker'
  | 'repo_policy';

export interface AutomationCapabilities {
  canProjectRuntimeState: boolean;
  canGeneratePlanDraft: boolean;
  canGeneratePackageDrafts: boolean;
  canEnqueueRuns: boolean;
}

export interface AutomationActorContext {
  actor_id: string;
  actor_class: AutomationActorClass;
}

export interface AutomationPrecondition {
  automation_scope: string;
  project_id: string;
  repo_id?: string;
  automation_settings_version: number;
  capability_fingerprint: string;
  required_capability: keyof AutomationCapabilities;
  actor_class: AutomationActorClass;
  daemon_identity?: string;
}

export type RuntimeHardLimitMode = 'unavailable' | 'test_only_mock' | 'enforcing';

export interface RuntimeSafetyAttestation {
  hard_limit_mode: RuntimeHardLimitMode;
  environment: 'production' | 'local_dogfood' | 'test';
  executor_type: string;
  workflow_only: boolean;
  governor_id: string;
  governor_provenance: 'external_sandbox' | 'test_only_mock' | 'unavailable';
  checked_at: string;
  max_command_timeout_ms: number;
  max_hook_timeout_ms: number;
  max_command_output_bytes: number;
  max_run_output_bytes: number;
  supports_cpu_limit: boolean;
  supports_memory_limit: boolean;
  supports_process_limit: boolean;
  supports_fd_limit: boolean;
  supports_workspace_disk_limit: boolean;
  supports_artifact_size_limit: boolean;
  reason_code?: string;
}

export interface PackageRuntimePolicySnapshot {
  policy_snapshot_version: number;
  policy_digest: string;
  policy_source_path: string;
  policy_loaded_at: string;
  policy_last_known_good: boolean;
  hooks: unknown;
  command_policy: unknown;
  check_policy: unknown;
  env_policy: unknown;
  path_policy: unknown;
  codex_runtime_mode: unknown;
  fallback_policy: unknown;
  validation_strategy: ValidationStrategy;
  validation_public_summary: string;
}

export const automationCapabilitiesForPreset = (preset: AutomationPreset): AutomationCapabilities => {
  switch (preset) {
    case 'off':
      return { canProjectRuntimeState: false, canGeneratePlanDraft: false, canGeneratePackageDrafts: false, canEnqueueRuns: false };
    case 'ready_projection':
      return { canProjectRuntimeState: true, canGeneratePlanDraft: false, canGeneratePackageDrafts: false, canEnqueueRuns: false };
    case 'draft_only':
      return { canProjectRuntimeState: true, canGeneratePlanDraft: true, canGeneratePackageDrafts: true, canEnqueueRuns: false };
    case 'run_enqueue':
      return { canProjectRuntimeState: true, canGeneratePlanDraft: true, canGeneratePackageDrafts: true, canEnqueueRuns: true };
  }
};

export const assertAutomationCapabilityActor = (actor: AutomationActorContext): void => {
  if (['automation_daemon', 'source_adapter', 'external_tracker', 'repo_policy'].includes(actor.actor_class)) {
    throw new Error(`${actor.actor_class} cannot perform automation capability updates`);
  }
};

const stableJson = (value: unknown): string => JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());

export const capabilityFingerprint = (capabilities: AutomationCapabilities): string =>
  createHash('sha256').update(stableJson(capabilities)).digest('hex');
```

Then extend it with:

- `AutomationProjectSettings`
- `AutomationScope`
- `AutomationPrecondition`
- `ManualPathHold`
- `CommandIdempotencyRecord`
- `AutomationActionRun`
- `ExecutionPackageGenerationRun`
- `PackageRuntimePolicySnapshot`
- `RuntimeHardLimitMode`
- `RuntimeSafetyAttestation`
- `ValidationStrategy`
- `buildManualScopeKey(...)`
- `assertCanonicalManualScopeKey(...)`
- `automationPreconditionFingerprint(...)`
- `isWorkItemAutomationTerminal(...)`
- `isOpenReviewPacketStatus(...)`
- `isActiveRunSessionStatus(...)`

- [ ] **Step 4: Export domain helpers**

Modify `packages/domain/src/index.ts`:

```ts
export * from './automation.js';
```

- [ ] **Step 5: Align `ReviewPacketStatus` and execution package fields**

Modify `packages/domain/src/types.ts`:

- Change `ReviewPacketStatus` to include `draft` and `escalated`.
- Add `version: number` to `ExecutionPackage`.
- Add package generation fields:
  - `execution_package_set_id?: string`
  - `execution_package_version?: number`
  - `generation_key?: string`
  - `package_key?: string`
  - `sequence?: number`
  - `manifest_digest?: string`
- Add validation fields:
  - `validation_strategy?: ValidationStrategy`
  - `validation_strategy_version?: number`
  - `validation_rationale?: string`
  - `validation_approved_by?: string`
  - `validation_approved_at?: IsoDateTime`
  - `validation_evidence_refs?: ArtifactRef[]`
  - `validation_public_summary?: string`
- Add policy snapshot fields:
  - `policy_snapshot_status?: 'captured' | 'missing' | 'stale' | 'superseded'`
  - `policy_snapshot_version?: number`
  - `package_policy_snapshot?: PackageRuntimePolicySnapshot`

- [ ] **Step 6: Add execution package version transition tests**

Extend `tests/domain/states.test.ts`:

```ts
it('defaults execution package version to zero and increments mutable transitions', () => {
  const created = transitionExecutionPackage(undefined, generatePackageEvent());
  expect(created.version).toBe(0);

  const ready = transitionExecutionPackage(created, { type: 'mark_ready', at: now });
  expect(ready.version).toBe(1);

  const queued = transitionExecutionPackage(ready, { type: 'run', run_session_id: 'run-session-1', at: now });
  expect(queued.version).toBe(2);
});
```

- [ ] **Step 7: Implement version defaults and increments**

Modify `packages/domain/src/states.ts`:

- new `ExecutionPackage` from `generate_package` has `version: 0`;
- every transition returning a changed package sets `version: executionPackage.version + 1`;
- unchanged invalid transitions still throw and do not produce a new object.

Then update existing fixtures in:

- `tests/helpers/p0-runtime-fixtures.ts`
- `tests/db/repository.test.ts`
- `tests/db/repository-contract.ts`
- `tests/domain/validators.test.ts`
- `tests/workflow/package-execution-workflow.test.ts`
- any other compile failure reported by `pnpm test tests/domain/states.test.ts`

- [ ] **Step 8: Add validator tests for run eligibility**

Extend `tests/domain/validators.test.ts`:

```ts
it('rejects ready/run eligibility when checks_required has no frozen checks', () => {
  expect(() =>
    validateExecutionPackage(projectBase(), packageBase({
      phase: 'ready',
      required_checks: [],
      validation_strategy: 'checks_required',
      validation_strategy_version: 1,
    })),
  ).toThrow(/required checks/i);
});

it('rejects run eligibility when policy snapshot is missing', () => {
  expect(() =>
    validateExecutionPackage(projectBase(), packageBase({
      phase: 'ready',
      policy_snapshot_status: 'missing',
    })),
  ).toThrow(/policy snapshot/i);
});
```

- [ ] **Step 9: Implement minimal validator support**

Modify `packages/domain/src/validators.ts` so:

- `ExecutionPackage.version` must be a non-negative integer.
- `checks_required` with ready/run eligibility requires at least one `required_check`.
- `allow_all_repo` requires `validation_approved_by`, `validation_approved_at`, and `validation_evidence_refs`.
- `custom` requires `validation_public_summary` and a frozen strategy version.
- `policy_snapshot_status` must be `captured` before ready/run eligibility.

- [ ] **Step 10: Run domain tests**

Run:

```bash
pnpm test tests/domain/automation.test.ts tests/domain/validators.test.ts tests/domain/states.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/domain/src/types.ts packages/domain/src/automation.ts packages/domain/src/validators.ts packages/domain/src/states.ts packages/domain/src/index.ts tests/domain/automation.test.ts tests/domain/validators.test.ts tests/domain/states.test.ts tests/helpers tests/db tests/workflow
git commit -m "feat: add automation domain contracts"
```

## Task 2: Automation Schema And Repository Contract

**Files:**

- Create: `packages/db/src/schema/automation.ts`
- Modify: `packages/db/src/schema/execution-package.ts`
- Modify: `packages/db/src/schema/run-session.ts`
- Modify: `packages/db/src/schema/review-packet.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/repositories/p0-repository.ts`
- Test: `tests/db/repository-contract.ts`
- Test: `tests/db/automation-repository.test.ts`

- [ ] **Step 1: Write repository contract tests for automation settings CAS**

In `tests/db/repository-contract.ts`, add a reusable section:

```ts
it('enforces automation settings version CAS and default-off resolution', async () => {
  expect(await repository.resolveAutomationProjectSettings({ project_id: ids.project, repo_id: 'repo-1' })).toMatchObject({
    preset: 'off',
    version: 0,
    capabilities_json: {
      canProjectRuntimeState: false,
      canGeneratePlanDraft: false,
      canGeneratePackageDrafts: false,
      canEnqueueRuns: false,
    },
  });

  const created = await repository.setAutomationProjectSettings({
    id: 'automation-settings-1',
    project_id: ids.project,
    repo_id: 'repo-1',
    scope_type: 'repo',
    preset: 'draft_only',
    expected_version: 0,
    reason: 'local dogfood',
    evidence_refs: [],
    actor: { actor_id: ids.actor, actor_class: 'human_admin' },
    now,
  });

  await expect(repository.setAutomationProjectSettings({
    ...created,
    id: 'automation-settings-2',
    expected_version: 0,
    reason: 'stale',
    evidence_refs: [],
    actor: { actor_id: ids.actor, actor_class: 'human_admin' },
    now,
  })).rejects.toThrow(/version/i);
});
```

- [ ] **Step 2: Write repository contract tests for manual holds and command idempotency**

Add tests that prove:

- duplicate active hold for `(object_type, object_id, scope_key)` returns or rejects deterministically;
- resolved hold does not allow duplicate idempotency replay to create a new hold;
- daemon-origin hold requests store and replay `sourceAutomationActionId` so escalation can be traced back to the originating `automation_action_runs` row;
- canonical `scope_key` validation rejects mismatched `work_item`, `spec_revision`, `plan_revision`, `package_generation`, `execution_package`, `run_session`, `review_packet`, and `release_gate` composite scopes;
- dependency propagation returns ancestor/dependent active holds for Plan/package/run/review/release automation checks;
- `command_idempotency_records` reject same `idempotency_key` with different precondition fingerprint;
- succeeded idempotency result replays stable `result_json`.
- long-running command claims can renew `locked_until` and `last_heartbeat_at`, and expired claims can be reclaimed only after target/precondition re-read.
- `supersedeExecutionPackageGenerationRun` marks the prior generation set superseded and records reason/evidence.

- [ ] **Step 3: Write repository contract tests for package generation manifest**

Add a test named `resumes deterministic package generation runs and rejects manifest drift`:

```ts
const first = await repository.claimExecutionPackageGenerationRun({
  plan_revision_id: ids.planRevision,
  generation_key: `default:${ids.planRevision}`,
  generator_version: 'mock-plan-splitter@1',
  policy_digest: 'sha256-policy-a',
  manifest_digest: 'sha256-manifest-a',
  expected_package_count: 2,
  expected_package_keys: ['api', 'tests'],
  claim_token: 'claim-1',
  now,
  locked_until: new Date(Date.parse(now) + 60_000).toISOString(),
});

expect(first.status).toBe('running');

await expect(repository.claimExecutionPackageGenerationRun({
  plan_revision_id: ids.planRevision,
  generation_key: `default:${ids.planRevision}`,
  generator_version: 'mock-plan-splitter@2',
  policy_digest: 'sha256-policy-a',
  manifest_digest: 'sha256-manifest-b',
  expected_package_count: 1,
  expected_package_keys: ['api'],
  claim_token: 'claim-2',
  now,
  locked_until: new Date(Date.parse(now) + 60_000).toISOString(),
})).rejects.toThrow(/manifest/i);
```

Also add tests proving:

- `(plan_revision_id, generation_key)` is unique;
- `(plan_revision_id, generation_key, package_key)` is unique;
- only one current/succeeded package generation set exists per `plan_revision_id`;
- `supersedeExecutionPackageGenerationRun` marks the previous set superseded and allows a new generation key for the same `PlanRevision`.
- `supersedeExecutionPackageGenerationRun` returns the next deterministic generation key / approval reference used by the later regenerate call.

- [ ] **Step 4: Write repository contract tests for active run/open review uniqueness**

Add tests proving:

- one `queued|running|waiting_for_input|stalled|resuming|cancel_requested` run per package;
- one `draft|ready|in_review|escalated` review packet per package;
- terminal run and completed/archived review packet no longer block new records.

- [ ] **Step 5: Run repository tests to verify failure**

Run:

```bash
pnpm test tests/db/repository.test.ts tests/db/automation-repository.test.ts
```

Expected: FAIL because schema/repository methods do not exist.

- [ ] **Step 6: Add Drizzle schema**

Create `packages/db/src/schema/automation.ts` with these tables:

- `automation_project_settings`
- `manual_path_holds`
- `command_idempotency_records`
- `execution_package_generation_runs`
- `automation_action_runs`
- `automation_cursors`

Use `jsonb` for typed JSON payloads and `timestampColumn` for time fields. Use enums or checked text fields matching the domain string unions.

Modify `packages/db/src/schema/index.ts`:

```ts
export * from './automation';
```

- [ ] **Step 7: Add package version and policy fields to execution package schema**

Modify `packages/db/src/schema/execution-package.ts`:

- `version: integer('version').notNull().default(0)`
- `executionPackageSetId: uuid('execution_package_set_id')`
- `executionPackageVersion: integer('execution_package_version')`
- `generationKey: text('generation_key')`
- `packageKey: text('package_key')`
- `sequence: integer('sequence')`
- `manifestDigest: text('manifest_digest')`
- `validationStrategy: text('validation_strategy')`
- `validationStrategyVersion: integer('validation_strategy_version')`
- `validationRationale: text('validation_rationale')`
- `validationApprovedBy: uuid('validation_approved_by')`
- `validationApprovedAt: timestampColumn('validation_approved_at')`
- `validationEvidenceRefs: jsonb('validation_evidence_refs')`
- `validationPublicSummary: text('validation_public_summary')`
- `policySnapshotStatus: text('policy_snapshot_status')`
- `policySnapshotVersion: integer('policy_snapshot_version')`
- `packagePolicySnapshot: jsonb('package_policy_snapshot')`

- [ ] **Step 8: Add durable uniqueness guards**

Modify `packages/db/src/schema/run-session.ts` and `packages/db/src/schema/review-packet.ts` using Drizzle partial unique indexes where supported:

```ts
uniqueIndex('run_sessions_one_active_per_package')
  .on(table.executionPackageId)
  .where(sql`${table.status} in ('queued','running','waiting_for_input','stalled','resuming','cancel_requested')`);
```

```ts
uniqueIndex('review_packets_one_open_per_package')
  .on(table.executionPackageId)
  .where(sql`${table.status} in ('draft','ready','in_review','escalated')`);
```

- [ ] **Step 9: Extend `P0Repository` interface**

Add method groups to `packages/db/src/repositories/p0-repository.ts`:

- `resolveAutomationProjectSettings`
- `setAutomationProjectSettings`
- `disableAutomationProjectSettings`
- `listActiveManualPathHolds`
- `requestManualPathHold`
- `resolveManualPathHold`
- `claimCommandIdempotency`
- `renewCommandIdempotency`
- `completeCommandIdempotency`
- `failCommandIdempotency`
- `blockCommandIdempotency`
- `withP0Transaction`
- `withObjectLock`
- `claimExecutionPackageGenerationRun`
- `saveExecutionPackageGenerationPackage`
- `completeExecutionPackageGenerationRun`
- `supersedeExecutionPackageGenerationRun`
- `findActiveRunSessionForPackage`
- `findOpenReviewPacketForPackage`
- `claimAutomationActionRun`
- `completeAutomationActionRun`
- `markAutomationActionGatePending`
- `listClaimableAutomationActionRuns`
- `listRuntimeSnapshotRows`

- [ ] **Step 10: Implement in-memory critical sections**

Create `packages/db/src/repositories/object-lock.ts` with a tiny promise-chain mutex:

```ts
export class ObjectLockManager {
  private locks = new Map<string, Promise<void>>();

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => current);
    this.locks.set(key, chained);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chained) {
        this.locks.delete(key);
      }
    }
  }
}
```

Use it in `packages/db/src/repositories/in-memory-p0-repository.ts` for command and target-object critical sections. Preserve clone-on-read/clone-on-write behavior.

- [ ] **Step 11: Implement durable repository methods**

Modify `packages/db/src/repositories/drizzle-p0-repository.ts`:

- Use DB transactions for command idempotency and product-object gate checks.
- Re-read target rows inside the transaction.
- Return existing successful/skipped/blocked results for duplicate idempotent commands.
- Throw deterministic errors for fingerprint conflicts and live claim conflicts.
- Mirror in-memory behavior for active run/open review uniqueness.

- [ ] **Step 12: Run repository tests**

Run:

```bash
pnpm test tests/db/repository.test.ts tests/db/automation-repository.test.ts
```

Expected: PASS for both in-memory and durable repository contracts.

- [ ] **Step 13: Run build for affected packages**

Run:

```bash
pnpm --filter @forgeloop/domain build
pnpm --filter @forgeloop/db build
```

Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add packages/db/src/schema packages/db/src/repositories packages/domain/src tests/db
git commit -m "feat: add automation persistence primitives"
```

## Task 3: Idempotent Control-Plane Command Boundaries

**Files:**

- Create: `apps/control-plane-api/src/p0/automation-command-helpers.ts`
- Modify: `apps/control-plane-api/src/p0/dto.ts`
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
- Modify: `apps/control-plane-api/src/p0/p0.controller.ts`
- Modify: `apps/control-plane-api/src/modules/release/release.service.ts`
- Test: `tests/api/automation-commands.test.ts`
- Test: `tests/api/delivery-flow.test.ts`
- Test: `tests/api/release-module.test.ts`

- [ ] **Step 1: Write failing tests for capability command authorization**

Create `tests/api/automation-commands.test.ts`:

```ts
it('rejects daemon actor capability updates and keeps production default off', async () => {
  const { app } = await createP0ApiTestApp();
  const project = await seedProject(app);

  await request(app.getHttpServer())
    .post(`/p0/projects/${project.id}/automation/capabilities`)
    .send({
      repo_id: 'repo-1',
      preset: 'run_enqueue',
      expected_version: 0,
      reason: 'daemon attempt',
      evidence_refs: [],
      actor_context: { actor_id: 'daemon-1', actor_class: 'automation_daemon' },
    })
    .expect(403);

  const settings = await request(app.getHttpServer())
    .get(`/p0/projects/${project.id}/automation/capabilities?repo_id=repo-1`)
    .expect(200);

  expect(settings.body.preset).toBe('off');
});
```

- [ ] **Step 2: Write failing tests for idempotent Plan draft command**

Add test:

```ts
it('ensures one plan draft for an approved spec under duplicate daemon/manual calls', async () => {
  const ctx = await seedApprovedSpecThroughApi(app);
  const precondition = automationPreconditionFor(ctx, { required_capability: 'canGeneratePlanDraft' });

  const [first, second] = await Promise.all([
    service.ensurePlanDraftForApprovedSpec(ctx.workItem.id, ctx.spec.current_revision_id!, precondition, 'idem-plan-draft-1'),
    service.ensurePlanDraftForApprovedSpec(ctx.workItem.id, ctx.spec.current_revision_id!, precondition, 'idem-plan-draft-1'),
  ]);

  expect(first.plan_revision_id).toBe(second.plan_revision_id);
  expect(await service.listPlanRevisions(first.plan_id)).toHaveLength(1);
});
```

- [ ] **Step 3: Write failing tests for command-boundary stale preconditions**

Add tests proving:

- `ensurePlanDraftForApprovedSpec` rejects stale automation settings version/fingerprint after claim;
- `ensurePlanDraftForApprovedSpec` rejects if `canGeneratePlanDraft` was disabled after claim;
- `ensurePlanDraftForApprovedSpec` rejects if the resolved automation scope moved to a different repo before Plan creation;
- `ensurePlanDraftForApprovedSpec` rejects if a Work Item or current SpecRevision hold becomes active after claim;
- `ensurePlanDraftForApprovedSpec` rejects if the Work Item's current approved Spec revision no longer matches `specRevisionId`;
- `ensurePlanDraftForApprovedSpec` rejects held, closed, archived, cancelled, superseded, released, or otherwise terminal Work Items;
- daemon-origin `requestManualPath` rejects stale `automation_settings_version` or `capability_fingerprint` after the action was claimed;
- daemon-origin `requestManualPath` rejects if the resolved automation scope moved to a different repo before hold creation;
- `ensureExecutionPackageDraftsForPlanRevision` rejects stale automation settings version/fingerprint after claim;
- `ensureExecutionPackageDraftsForPlanRevision` rejects if `canGeneratePackageDrafts` was disabled after claim;
- `ensureExecutionPackageDraftsForPlanRevision` rejects if a Work Item, SpecRevision, PlanRevision, or package generation scope hold becomes active after claim;
- `ensureExecutionPackageDraftsForPlanRevision` rejects if the Work Item's current approved Plan revision no longer matches `planRevisionId`;
- `ensureExecutionPackageDraftsForPlanRevision` rejects held, closed, archived, cancelled, superseded, released, or otherwise terminal Work Items;
- `run_enqueue` disabled returns `automation_capability_disabled`;
- open ReviewPacket blocks with `automation_gate_pending`;
- active RunSession blocks duplicate run creation;
- stale `expectedPackageVersion` returns `stale_execution_package_revision`;
- active manual hold blocks with `manual_path_hold_active`.
- missing runtime safety attestation returns `runtime_hard_limits_unavailable`;
- `hard_limit_mode: 'test_only_mock'` is rejected for non-mock or non-`workflow_only` run enqueue requests.
- `enqueueRunIfPackageStillReady` rejects stale automation settings version/fingerprint after claim;
- `enqueueRunIfPackageStillReady` rejects if `canEnqueueRuns` was disabled after claim;
- `enqueueRunIfPackageStillReady` rejects if the resolved automation scope moved to a different repo before RunSession creation.

- [ ] **Step 4: Write failing tests for release gate actor rejection**

Extend `tests/api/release-module.test.ts` or add a focused block in `tests/api/automation-commands.test.ts` proving automation daemon, source adapter, external tracker, and repo policy actors cannot pass or mutate:

- Integration gate;
- Test gate;
- Release gate approval;
- rollout decision;
- observation completion.

Expected error code or response: forbidden/unauthorized with a public-safe reason such as `automation_actor_not_allowed_for_release_gate`.

- [ ] **Step 5: Run API tests to verify failure**

Run: `pnpm test tests/api/automation-commands.test.ts tests/api/release-module.test.ts`

Expected: FAIL because commands/endpoints do not exist.

- [ ] **Step 6: Add command helper functions**

Create `apps/control-plane-api/src/p0/automation-command-helpers.ts`:

- `normalizeAutomationPrecondition`
- `automationPreconditionFingerprint`
- `commandIdempotencyTarget`
- `publicAutomationError`
- `assertAutomationPreconditionStillCurrent`
- `assertCommandCapabilityStillEnabled`
- `assertNoActiveHolds`
- `assertPackageRunEligible`
- `assertRuntimeSafetyAttestation`

- [ ] **Step 7: Add P0Service capability commands**

Modify `apps/control-plane-api/src/p0/p0.service.ts` with:

```ts
async setAutomationCapabilities(input: SetAutomationCapabilitiesInput): Promise<AutomationProjectSettings>
async disableAutomation(input: DisableAutomationInput): Promise<AutomationProjectSettings>
```

Rules:

- call `assertAutomationCapabilityActor`;
- require reason and evidence refs;
- run repository CAS by `expectedVersion`;
- never accept daemon/source adapter/repo policy actors;
- emit status history/object event/audit event.

- [ ] **Step 8: Add P0Service manual-path hold commands**

Add:

```ts
async requestManualPath(input: RequestManualPathInput): Promise<ManualPathHold>
async resolveManualPath(input: ResolveManualPathInput): Promise<ManualPathHold>
```

`RequestManualPathInput` must include:

- `objectType`
- `objectId`
- `scopeKey`
- `reasonCode`
- `reason`
- `evidenceRefs`
- `requestedBy`
- `idempotencyKey`
- `sourceAutomationActionId?`
- `automationPrecondition?`

`ResolveManualPathInput` must include:

- `holdId`
- `resolution`
- `resolvedBy`
- `evidenceRefs`

Rules:

- validate canonical `scopeKey`;
- enforce one active hold per target/scope;
- replay duplicate idempotency keys;
- accept optional `sourceAutomationActionId` on daemon-origin requests and persist it on the hold so the originating `automation_action_runs` row can be traced;
- daemon-origin requests require `automationPrecondition`;
- daemon-origin requests must re-read automation settings inside the same transaction/object lock before hold creation;
- reject daemon-origin hold creation if settings version, capability fingerprint, resolved scope, repo scope, required capability, actor class, or daemon identity no longer matches `automationPrecondition`;
- daemon cannot resolve its own hold.

- [ ] **Step 9: Add idempotent Plan draft command**

Add:

```ts
async ensurePlanDraftForApprovedSpec(
  workItemId: string,
  specRevisionId: string,
  automationPrecondition: AutomationPrecondition,
  idempotencyKey: string,
): Promise<{ plan_id: string; plan_revision_id: string; status: 'created' | 'existing' }>
```

Implementation rules:

- claim command idempotency and object lock together;
- re-read automation settings in the same transaction/object lock and require matching `automation_settings_version`, `capability_fingerprint`, resolved automation scope, repo scope, and capability `canGeneratePlanDraft`;
- re-read Work Item lifecycle, current Spec, SpecRevision, and active Work Item/SpecRevision holds inside the same transaction/object lock before Plan side effects;
- verify current approved Spec revision matches `specRevisionId`;
- reject held, closed, archived, cancelled, superseded, released, or otherwise terminal Work Items;
- return existing Plan/PlanRevision if already generated for the same Spec revision;
- create Plan and PlanRevision otherwise;
- store `based_on_spec_revision_id` on generated PlanRevision;
- do not approve Plan.

- [ ] **Step 10: Add idempotent package generation command**

Add:

```ts
async ensureExecutionPackageDraftsForPlanRevision(
  input: {
    planRevisionId: string;
    automationPrecondition: AutomationPrecondition;
    actorContext: ActorContext;
    idempotencyKey: string;
    generationKey?: string;
    regenerationApproval?: {
      supersededGenerationKey: string;
      supersededExecutionPackageSetId: string;
      supersedeCommandId: string;
    };
  },
): Promise<{ execution_package_set_id: string; package_ids: string[]; status: 'created' | 'existing' }>
```

Implementation rules:

- default deterministic generation key is `default:<plan_revision_id>`;
- daemon callers may only omit `generationKey` and use the default key;
- non-default `generationKey` is allowed only for human/admin callers with a `regenerationApproval` created by `supersedeExecutionPackageGenerationRun`;
- non-default `generationKey` must be deterministic from the supersede result, for example `regenerate:<plan_revision_id>:<supersede_sequence>`;
- claim command idempotency, generation-run row, and target object lock before package side effects;
- re-read automation settings in the same transaction/object lock and require matching `automation_settings_version`, `capability_fingerprint`, resolved automation scope, repo scope, and capability `canGeneratePackageDrafts`;
- re-read Work Item lifecycle, current Spec, current Plan, PlanRevision, and active holds inside the same transaction/object lock before generation side effects;
- verify the Work Item's current approved Plan revision still matches `planRevisionId`;
- verify the Work Item's current approved Spec revision still matches the PlanRevision's `based_on_spec_revision_id`;
- reject held, closed, archived, cancelled, superseded, released, or otherwise terminal Work Items;
- claim generation-run row before inserting packages;
- for non-default generation, re-read the superseded package generation row and require it is still `superseded`, belongs to `regenerationApproval.supersededExecutionPackageSetId`, and matches `regenerationApproval.supersededGenerationKey`;
- reject generator/policy/manifest drift;
- resume partial package rows;
- generate draft/candidate packages only;
- do not mark packages ready.

- [ ] **Step 11: Add package-generation supersede command**

Add:

```ts
async supersedeExecutionPackageGenerationRun(
  input: {
    planRevisionId: string;
    generationKey: string;
    expectedGenerationRunVersion: number;
    reason: string;
    evidenceRefs: ArtifactRef[];
    approvedBy: ActorContext;
    idempotencyKey: string;
  },
): Promise<{ execution_package_set_id: string; status: 'superseded'; next_generation_key: string; supersede_command_id: string }>
```

Implementation rules:

- require a human/admin approver actor, not daemon/source adapter/repo policy/external tracker;
- claim command idempotency and target object lock together;
- re-read the current generation run inside the same transaction/object lock;
- require the previous generation set to belong to the same `planRevisionId` and `generationKey`;
- mark the previous set superseded and persist reason/evidence;
- compute and return the next deterministic generation key, for example `regenerate:<planRevisionId>:<supersede_sequence>`;
- allow a later `ensureExecutionPackageDraftsForPlanRevision` call with that returned generation key only after supersede succeeds and the caller passes the returned approval reference.

- [ ] **Step 12: Add idempotent run enqueue command**

Add:

```ts
async enqueueRunIfPackageStillReady(
  input: {
    packageId: string;
    expectedPackageVersion: number;
    automationPrecondition: AutomationPrecondition;
    idempotencyKey: string;
    actorContext: ActorContext;
    executorType: ExecutorType;
    workflowOnly: boolean;
    runtimeSafetyAttestation: RuntimeSafetyAttestation;
  },
): Promise<RunAcceptedResponse>
```

Implementation rules:

- require capability `canEnqueueRuns`;
- re-read automation settings in the same transaction/object lock and require matching `automation_settings_version`, `capability_fingerprint`, resolved automation scope, repo scope, and capability `canEnqueueRuns`;
- require Phase 1 runtime safety attestation with `hard_limit_mode: 'enforcing'` for production/Codex execution;
- reject missing, stale, or non-matching `runtimeSafetyAttestation`;
- reject `hard_limit_mode: 'test_only_mock'` unless `executorType === 'mock'`, `workflowOnly === true`, and the environment is an explicit local dogfood/test environment;
- lock/re-read Work Item, Spec, Plan, package, dependencies, holds, release blockers, ReviewPackets, RunSessions;
- reject stale Spec/Plan revision mismatch;
- reject stale package version;
- enforce one active RunSession and one open ReviewPacket;
- reuse existing active RunSession only if command idempotency proves this is the same command result;
- call existing run creation code only after all gates pass.

- [ ] **Step 13: Reject automation actors from release gate mutations**

Modify `apps/control-plane-api/src/modules/release/release.service.ts` and any controller DTO plumbing needed so release/integration/test/rollout/observation mutation commands reject actor classes:

- `automation_daemon`
- `source_adapter`
- `external_tracker`
- `repo_policy`

The daemon may only create projection/proposal records for release readiness. It must not directly set release-ready lifecycle state, pass Integration/Test/Release gates, decide rollout, or complete observation.

- [ ] **Step 14: Wire narrow controller endpoints**

Add only:

- `GET /p0/projects/:projectId/automation/capabilities`
- `POST /p0/projects/:projectId/automation/capabilities`
- `POST /p0/projects/:projectId/automation/capabilities:disable`
- `POST /p0/manual-path-holds`
- `POST /p0/manual-path-holds/:holdId:resolve`

Keep `/automation/action-runs` for a later internal/admin task unless needed by tests.

- [ ] **Step 15: Run API tests**

Run:

```bash
pnpm test tests/api/automation-commands.test.ts tests/api/delivery-flow.test.ts tests/api/release-module.test.ts
```

Expected: PASS.

- [ ] **Step 16: Run control-plane build**

Run: `pnpm --filter @forgeloop/control-plane-api build`

Expected: PASS.

- [ ] **Step 17: Commit**

```bash
git add apps/control-plane-api/src/p0 apps/control-plane-api/src/modules/release tests/api/automation-commands.test.ts tests/api/delivery-flow.test.ts tests/api/release-module.test.ts
git commit -m "feat: add idempotent automation commands"
```

## Task 4: Runtime Policy Loader And Path Safety

**Files:**

- Modify: `packages/executor/package.json`
- Create: `packages/executor/src/path-safety.ts`
- Create: `packages/executor/src/path-policy.ts`
- Create: `packages/executor/src/runtime-policy.ts`
- Modify: `packages/executor/src/codex-worktree.ts`
- Modify: `packages/executor/src/index.ts`
- Test: `tests/executor/path-safety.test.ts`
- Test: `tests/executor/path-policy.test.ts`
- Test: `tests/executor/runtime-policy.test.ts`
- Test: `tests/executor/codex-worktree.test.ts`

- [ ] **Step 1: Add minimatch dependency**

Run: `pnpm add minimatch --filter @forgeloop/executor`

Expected: `packages/executor/package.json` and `pnpm-lock.yaml` update.

- [ ] **Step 2: Write failing PathSafety tests**

Create `tests/executor/path-safety.test.ts` with cases:

- rejects path equal to workspace root;
- rejects outside-root normalization;
- rejects null bytes/control characters;
- classifies symlink escape as `workspace_symlink_escape`;
- preserves artifact root containment.

Use temporary directories under `mkdtemp(join(tmpdir(), 'forgeloop-path-safety-'))`.

- [ ] **Step 3: Write failing PathPolicy tests**

Create `tests/executor/path-policy.test.ts`:

```ts
it.each(['', '.', '..', '../x', '/abs', 'src\\x', 'src/\u0000x', '!src/**', '**', '**/*', '*'])(
  'rejects unsafe policy pattern %s',
  (pattern) => {
    expect(() => compilePathPolicy({ allowed_paths: [pattern], forbidden_paths: [], validation_strategy: 'checks_required' }))
      .toThrow(/path policy/i);
  },
);

it('applies forbidden precedence over allowed paths', () => {
  const policy = compilePathPolicy({
    allowed_paths: ['src/**'],
    forbidden_paths: ['src/secrets/**'],
    validation_strategy: 'checks_required',
  });

  expect(evaluatePathPolicy(policy, [{ path: 'src/index.ts' }]).ok).toBe(true);
  expect(evaluatePathPolicy(policy, [{ path: 'src/secrets/key.ts' }])).toMatchObject({ ok: false, code: 'path_policy_forbidden' });
});

it('checks old and new paths for renames', () => {
  const policy = compilePathPolicy({
    allowed_paths: ['src/**'],
    forbidden_paths: ['config/**'],
    validation_strategy: 'checks_required',
  });

  expect(evaluatePathPolicy(policy, [{ old_path: 'config/a.ts', path: 'src/a.ts' }])).toMatchObject({ ok: false });
});
```

- [ ] **Step 4: Write failing RuntimePolicy tests**

Create `tests/executor/runtime-policy.test.ts` with cases:

- parses YAML front matter and Markdown body from `WORKFLOW.md`;
- computes stable digest;
- invalid reload keeps last-known-good;
- invalid initial load blocks unless safe-default mode is explicitly allowed;
- policy source path is repo-relative POSIX only;
- absolute/outside/symlink-escape policy source paths are rejected.

- [ ] **Step 5: Run executor tests to verify failure**

Run:

```bash
pnpm test tests/executor/path-safety.test.ts tests/executor/path-policy.test.ts tests/executor/runtime-policy.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 6: Implement `PathSafety`**

Create `packages/executor/src/path-safety.ts`:

- `canonicalRepoRoot(root: string): Promise<string>`
- `resolveRepoRelativePath(root: string, relativePath: string, options: { allowRoot?: boolean; mustExist?: boolean }): Promise<PathSafetyResult>`
- `assertInsideRoot(root: string, target: string, options?: { rejectRoot?: boolean }): Promise<string>`
- `assertArtifactPath(root: string, target: string): Promise<string>`
- `PathSafetyError` with codes:
  - `workspace_path_escape`
  - `workspace_symlink_escape`
  - `workspace_equals_root`
  - `path_contains_control_character`

Use `lstat`/`realpath` segment-by-segment. Do not trust one final `realpath` call for symlink escape classification.

- [ ] **Step 7: Implement typed `PathPolicy`**

Create `packages/executor/src/path-policy.ts`:

- validate repo-relative POSIX patterns;
- reject root-wide patterns unless `validation_strategy === 'allow_all_repo'` and reviewed evidence is present;
- use `minimatch` with:
  - case-sensitive matching;
  - globstar enabled;
  - dotfiles only when pattern explicitly includes dot segment;
  - no brace expansion;
  - no extglob;
  - no negation.
- evaluate changed files with both `old_path` and `path`;
- forbidden wins over allowed.

- [ ] **Step 8: Implement `RepoRuntimePolicyLoader`**

Create `packages/executor/src/runtime-policy.ts`:

- parse YAML front matter with a small strict parser for top-level sections used by this project, or use a local lightweight parser only if already present;
- validate allowed sections: `codex`, `workspace`, `hooks`, `checks`, `path_policy`, `prompt_policy`, `observability`;
- compute `policy_digest` from normalized policy data and prompt body;
- store `lastKnownGood`;
- return diagnostics instead of crashing daemon;
- block invalid initial load unless caller passes `allowSafeDefault: true`;
- resolve policy source with `PathSafety`.

- [ ] **Step 9: Harden worktree cleanup**

Modify `packages/executor/src/codex-worktree.ts`:

- validate `.worktrees` root under source repo;
- validate worktree target under `.worktrees`;
- reject root equality;
- reject symlink escape before `git worktree remove` and `rm`.

- [ ] **Step 10: Export modules**

Modify `packages/executor/src/index.ts`:

```ts
export * from './path-safety.js';
export * from './path-policy.js';
export * from './runtime-policy.js';
```

- [ ] **Step 11: Run executor tests**

Run:

```bash
pnpm test tests/executor/path-safety.test.ts tests/executor/path-policy.test.ts tests/executor/runtime-policy.test.ts tests/executor/codex-worktree.test.ts
```

Expected: PASS.

- [ ] **Step 12: Build executor**

Run: `pnpm --filter @forgeloop/executor build`

Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add packages/executor/package.json pnpm-lock.yaml packages/executor/src tests/executor
git commit -m "feat: add runtime policy and path safety"
```

## Task 5: Structured Command Execution And Runtime Safety Gate

**Files:**

- Create: `packages/executor/src/structured-command.ts`
- Create: `packages/executor/src/resource-limits.ts`
- Create: `packages/executor/src/resource-governor.ts`
- Create: `packages/executor/src/hook-runner.ts`
- Modify: `packages/executor/src/local-codex-preflight.ts`
- Modify: `packages/executor/src/codex-exec-fallback-driver.ts`
- Modify: `packages/executor/src/local-codex-evidence.ts`
- Modify: `packages/run-worker/src/run-worker.ts`
- Modify: `packages/executor/src/index.ts`
- Test: `tests/executor/structured-command.test.ts`
- Test: `tests/executor/resource-limits.test.ts`
- Test: `tests/executor/resource-governor.test.ts`
- Test: `tests/executor/hook-runner.test.ts`
- Test: `tests/executor/local-codex-preflight.test.ts`
- Test: `tests/run-worker/run-worker.test.ts`

- [ ] **Step 1: Write failing structured-command tests**

Create `tests/executor/structured-command.test.ts` with cases:

- rejects shell strings and `shell: true` unless approved template;
- rejects absolute executable paths by default;
- rejects unapproved relative executable paths;
- rejects executable symlink escapes;
- sanitizes env and controlled `PATH`;
- permits `cwd_policy: workspace_root`;
- permits approved repo-relative cwd validated by `PathSafety`;
- enforces per-command timeout and output byte limit while streaming.

- [ ] **Step 2: Write failing resource-limit and hook tests**

Create `tests/executor/resource-limits.test.ts` and assert:

```ts
expect(resolveRunEnqueueRuntimeSafety({ hardLimitsAvailable: false })).toMatchObject({
  canEnqueueRuns: false,
  reason_code: 'runtime_hard_limits_unavailable',
});
```

This preserves the spec requirement that production `run_enqueue` remains disabled if CPU/memory/process/fd/disk/artifact hard limits cannot be enforced.

Add `tests/executor/resource-governor.test.ts`:

```ts
it('fails closed for production run enqueue without an enforcing governor', () => {
  expect(resolveRuntimeSafetyAttestation({
    environment: 'production',
    governor: { mode: 'unavailable' },
    executor_type: 'local_codex',
    workflow_only: false,
  })).toMatchObject({
    ok: false,
    reason_code: 'runtime_hard_limits_unavailable',
  });
});

it('allows test-only mock governor only for mock workflow dogfood', () => {
  expect(resolveRuntimeSafetyAttestation({
    environment: 'local_dogfood',
    governor: { mode: 'test_only_mock' },
    executor_type: 'mock',
    workflow_only: true,
  })).toMatchObject({
    ok: true,
    hard_limit_mode: 'test_only_mock',
  });

  expect(resolveRuntimeSafetyAttestation({
    environment: 'local_dogfood',
    governor: { mode: 'test_only_mock' },
    executor_type: 'local_codex',
    workflow_only: false,
  })).toMatchObject({
    ok: false,
    reason_code: 'test_only_governor_requires_mock_executor',
  });
});

it('wraps structured commands with an enforcing external sandbox backend', async () => {
  const calls: Array<{ executable: string; args: string[] }> = [];
  const governor = createExternalSandboxResourceGovernor({
    sandbox_executable: 'forgeloop-sandbox',
    sandbox_args: [
      '--cpu-ms=600000',
      '--memory-mb=2048',
      '--pids=128',
      '--fds=256',
      '--workspace-bytes=1073741824',
      '--artifact-bytes=104857600',
      '--',
    ],
    spawn: async (executable, args) => {
      calls.push({ executable, args });
      return { exit_code: 0, stdout: '', stderr: '', timed_out: false };
    },
  });

  await governor.run({
    executable: 'pnpm',
    args: ['test'],
    cwd: '/workspace',
    timeout_ms: 600_000,
    output_limit_bytes: 1_048_576,
  });

  expect(calls[0]).toMatchObject({ executable: 'forgeloop-sandbox' });
  expect(calls[0]?.args).toEqual(expect.arrayContaining(['--cpu-ms=600000', '--memory-mb=2048', '--pids=128']));
});
```

Create `tests/executor/hook-runner.test.ts` with cases:

- `before_run` executes before run startup through `ResourceGovernor.run`;
- `before_run` timeout/non-zero/policy errors fail closed with public-safe reason codes;
- hook stdout/stderr are truncated and internal unless explicitly marked `public_safe`;
- hook timeout cannot exceed the max hook timeout from `RuntimeSafetyAttestation`.

Extend `tests/run-worker/run-worker.test.ts` with cases:

- run startup executes `before_run` hooks before Codex/local executor startup;
- terminal completion executes `after_run` hooks after final run status is persisted;
- failed `after_run` hooks record internal diagnostics but do not overwrite the terminal RunSession status.

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm test tests/executor/structured-command.test.ts tests/executor/resource-limits.test.ts tests/executor/resource-governor.test.ts tests/executor/hook-runner.test.ts tests/executor/local-codex-preflight.test.ts tests/run-worker/run-worker.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement structured command spec**

Create `packages/executor/src/structured-command.ts` with:

- `StructuredCommandSpec`
- `CommandTemplate`
- `validateStructuredCommand`
- `renderCommandTemplate`
- `runStructuredCommand`

Use `spawn`/`execFile` with args arrays. Kill child process trees on timeout. Truncate output as chunks arrive.

- [ ] **Step 5: Implement resource limit capability surface and governors**

Create `packages/executor/src/resource-limits.ts`:

- `RuntimeHardLimitCapabilities`
- `resolveRunEnqueueRuntimeSafety`
- `resolveRuntimeSafetyAttestation`
- default platform maximums:
  - command timeout <= 10 minutes;
  - hook timeout <= 2 minutes;
  - per-command output <= 1 MiB;
  - per-run captured text <= 10 MiB.

Create `packages/executor/src/resource-governor.ts`:

- `ResourceGovernor`
- `UnavailableResourceGovernor`
- `ExternalSandboxResourceGovernor`
- `TestOnlyMockResourceGovernor`
- `createExternalSandboxResourceGovernor`
- `createTestOnlyMockResourceGovernor`

Rules:

- import and return `RuntimeSafetyAttestation` from `@forgeloop/domain`; do not define a second executor-local attestation shape;
- production/Codex `run_enqueue` requires a `RuntimeSafetyAttestation` with `hard_limit_mode: 'enforcing'`;
- `ExternalSandboxResourceGovernor` is the only first-implementation production-enforcing governor;
- `ExternalSandboxResourceGovernor` must launch structured commands through a configured sandbox executable that receives CPU, memory, process-count, fd, workspace-disk, and artifact-size limits as arguments before the real executable;
- the sandbox executable configuration is fail-closed: missing executable, missing any hard-limit argument, or platform self-check failure returns `runtime_hard_limits_unavailable`;
- `TestOnlyMockResourceGovernor` can satisfy local dogfood only when `executor_type === 'mock'` and `workflow_only === true`;
- `TestOnlyMockResourceGovernor` must never satisfy production readiness or local Codex execution readiness;
- if hard CPU/memory/process/fd/workspace-disk/artifact-size limits are unavailable, return `canEnqueueRuns: false` for production mode.

- [ ] **Step 6: Implement hook execution**

Create `packages/executor/src/hook-runner.ts` with:

- `HookRunner`
- `runBeforeRunHooks`
- `runAfterRunHooks`
- `buildHookExecutionSpec`

Rules:

- `before_run` hooks execute before run startup and are fail-closed on timeout, policy error, or non-public-safe command specification;
- `after_run` hooks execute after terminal run completion and must not overwrite the terminal run status if they fail;
- hook execution uses `ResourceGovernor.run` and the same structured-command validation as other runtime commands;
- hook output is truncated and internal by default unless explicitly public-safe;
- hook timeouts obey the policy snapshot and the hard maximum from `RuntimeSafetyAttestation`.

Modify:

- `packages/executor/src/local-codex-preflight.ts`
- `packages/run-worker/src/run-worker.ts`

Tests:

- `tests/executor/hook-runner.test.ts`
- `tests/run-worker/run-worker.test.ts`

- [ ] **Step 7: Enforce runtime safety in preflight and fallback**

Modify:

- `packages/executor/src/local-codex-preflight.ts`
- `packages/executor/src/codex-exec-fallback-driver.ts`
- `packages/executor/src/local-codex-evidence.ts`

Rules:

- no arbitrary shell strings for checks/hooks;
- all check/hook/structured command execution goes through `ResourceGovernor.run`; no direct `spawn`/`execFile` path may bypass the governor after validation;
- fallback denied unless package frozen policy permits it;
- fallback env/cwd restricted;
- public fallback reason is a code, not raw stderr;
- raw check/hook/fallback output internal by default.

- [ ] **Step 8: Export modules**

Modify `packages/executor/src/index.ts`:

```ts
export * from './structured-command.js';
export * from './resource-limits.js';
export * from './resource-governor.js';
export * from './hook-runner.js';
```

- [ ] **Step 9: Run tests**

Run:

```bash
pnpm test tests/executor/structured-command.test.ts tests/executor/resource-limits.test.ts tests/executor/resource-governor.test.ts tests/executor/hook-runner.test.ts tests/executor/local-codex-preflight.test.ts tests/executor/runtime-policy.test.ts tests/run-worker/run-worker.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/executor/src packages/run-worker/src tests/executor tests/run-worker
git commit -m "feat: enforce structured runtime commands"
```

## Task 6: Frozen Package Policy Snapshots

**Files:**

- Modify: `packages/domain/src/types.ts`
- Modify: `packages/domain/src/validators.ts`
- Modify: `packages/db/src/schema/execution-package.ts`
- Modify: `packages/db/src/schema/run-session.ts`
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
- Modify: `packages/executor/src/local-codex-preflight.ts`
- Modify: `packages/executor/src/codex-app-server-driver.ts`
- Modify: `packages/run-worker/src/run-worker.ts`
- Test: `tests/api/automation-commands.test.ts`
- Test: `tests/domain/validators.test.ts`
- Test: `tests/executor/local-codex-preflight.test.ts`
- Test: `tests/run-worker/run-worker.test.ts`

- [ ] **Step 1: Write failing tests for stale/missing snapshots**

Add API tests proving:

- packages generated before policy snapshot support are marked `policy_snapshot_missing`;
- `markPackageReady` rejects missing/stale snapshots;
- `enqueueRunIfPackageStillReady` rejects mutable policy digest mismatch;
- already queued RunSession uses frozen package snapshot even after repo policy reload.
- `markPackageReady` rejects `policy_snapshot_missing`, stale `policy_snapshot_version`, stale package version, superseded package generation sets, and empty required-check policy snapshots.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm test tests/api/automation-commands.test.ts tests/domain/validators.test.ts tests/executor/local-codex-preflight.test.ts tests/run-worker/run-worker.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add package snapshot generation helper**

In `apps/control-plane-api/src/p0/p0.service.ts` or a helper file, add:

```ts
private buildPackagePolicySnapshot(input: {
  package: ExecutionPackage;
  policy: LoadedRepoRuntimePolicy;
  validationStrategy: ValidationStrategy;
}): PackageRuntimePolicySnapshot
```

Snapshot includes:

- `policy_snapshot_version`
- `policy_digest`
- `policy_source_path`
- `policy_loaded_at`
- `policy_last_known_good`
- frozen hook specs;
- frozen command/check policy;
- frozen env policy;
- frozen Codex runtime mode;
- fallback policy;
- validation strategy fields and public summary.

- [ ] **Step 4: Save snapshot during package generation or explicit package review**

Rules:

- generated package drafts may have `policy_snapshot_status: 'captured'` if policy load succeeds;
- generated packages without Phase 1 support must be `policy_snapshot_status: 'missing'`;
- every captured or refreshed snapshot increments `policy_snapshot_version` independently from the package content `version`;
- package readiness requires `captured`;
- frozen snapshot changes require explicit human-reviewed package edit and version bump.

- [ ] **Step 5: Update package readiness command**

Modify `apps/control-plane-api/src/p0/p0.service.ts` method `markPackageReady` or the equivalent package readiness command:

- re-read package row, package version, generation-set status, and frozen policy snapshot inside the same transaction/object lock;
- require caller-provided `expectedPackageVersion` and `expectedPolicySnapshotVersion`;
- reject packages whose generation set is `superseded`;
- reject `policy_snapshot_status !== 'captured'`;
- reject if package `policy_snapshot_version` is missing or does not equal `expectedPolicySnapshotVersion`;
- reject missing `policy_digest`, missing validation strategy, missing frozen command policy, missing path policy, and empty required-check policy unless the package is explicitly marked `workflow_only`;
- increment package version when readiness changes;
- do not let the automation daemon mark packages ready; readiness remains human/review controlled.

- [ ] **Step 6: Record policy metadata on RunSession**

When `enqueueRunIfPackageStillReady` creates a RunSession:

- copy `policy_digest`;
- copy `policy_source_path`;
- copy `policy_loaded_at`;
- copy `policy_last_known_good`;
- copy `package_policy_digest`.

Do not expose these raw internals publicly except safe fields in runtime snapshot.

- [ ] **Step 7: Thread frozen snapshot into run execution**

Modify:

- `packages/run-worker/src/run-worker.ts`
- `packages/executor/src/local-codex-preflight.ts`
- `packages/executor/src/codex-app-server-driver.ts`

Rules:

- run-worker must read the frozen `package_policy_digest` and pass the frozen snapshot into execution setup rather than re-resolving live repo policy at startup;
- a digest mismatch caused by a mutable policy override must block run startup with `policy_digest_mismatch` unless the package is regenerated/reviewed or human-approved policy update paths are used;
- `local-codex-preflight` and app-server startup paths must consume the frozen snapshot and not silently broaden runtime behavior from newer repo policy;
- public runtime views still expose only safe summary fields, not the raw policy payload.

Tests:

- `tests/run-worker/run-worker.test.ts`
- `tests/executor/local-codex-preflight.test.ts`

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm test tests/api/automation-commands.test.ts tests/domain/validators.test.ts tests/executor/local-codex-preflight.test.ts tests/run-worker/run-worker.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/domain/src packages/db/src/schema apps/control-plane-api/src/p0 packages/executor/src packages/run-worker/src tests/api tests/domain tests/executor tests/run-worker
git commit -m "feat: freeze package runtime policy snapshots"
```

## Task 7: Automation Planner Package

**Files:**

- Modify: `tsconfig.base.json`
- Create: `packages/automation/package.json`
- Create: `packages/automation/tsconfig.json`
- Create: `packages/automation/src/types.ts`
- Create: `packages/automation/src/idempotency.ts`
- Create: `packages/automation/src/planner.ts`
- Create: `packages/automation/src/source-adapter.ts`
- Create: `packages/automation/src/index.ts`
- Test: `tests/automation/planner.test.ts`

- [ ] **Step 1: Write exhaustive planner matrix tests**

Create `tests/automation/planner.test.ts` with table tests:

- approved Spec + no Plan + `draft_only` => `generate_plan_draft`;
- approved Spec + existing PlanRevision for same Spec => `NoAction`;
- approved Plan + no packages + `draft_only` => `generate_execution_packages`;
- `ready_projection` => projection-only actions are allowed, but no Plan draft, package draft, or RunSession enqueue action is returned;
- ready package + `draft_only` => `NoAction` with `run_enqueue_disabled`;
- ready package + `run_enqueue` + runtime hard limits unavailable => `NoAction` with `runtime_hard_limits_unavailable`;
- ready package + `run_enqueue` + open review => `enqueue_package_run` with transient gate blocker or `NoAction` reason `open_review_packet`;
- ready ReviewPacket => `notify_review_ready` or projection-only action, never approval;
- stalled/failed RunSession beyond recovery policy => `escalate_manual_path`, not retry/resume;
- release readiness candidate => `release_readiness_projection`, never Integration/Test/Release gate mutation;
- held Work Item/Spec/Plan/package => no mutating action;
- terminal/resolved Work Item => no mutating action;
- multi-repo ambiguous Work Item => `automation_gate_blocked`.

- [ ] **Step 2: Write idempotency key tests**

In `tests/automation/planner.test.ts`, add focused tests for `packages/automation/src/idempotency.ts`:

```ts
it('includes every action precondition dimension in mutating action keys', () => {
  const base = {
    action_type: 'enqueue_package_run' as const,
    target_object_type: 'execution_package' as const,
    target_object_id: 'package-1',
    target_revision_id: 'plan-revision-1',
    target_status: 'ready/idle/not_submitted',
    package_version: 4,
    executor_type: 'mock' as const,
    workflow_only: true,
    automation_scope: 'repo:project-1:repo-1',
    automation_settings_version: 7,
    capability_fingerprint: 'capability-a',
    policy_digest: 'policy-a',
  };

  const key = enqueuePackageRunKey(base);
  expect(key).toContain('enqueue_package_run');
  expect(key).toContain('package-1');
  expect(key).toContain('plan-revision-1');
  expect(key).toContain('ready/idle/not_submitted');
  expect(key).toContain('4');
  expect(key).toContain('repo:project-1:repo-1');
  expect(key).toContain('7');
  expect(key).toContain('capability-a');
  expect(key).toContain('policy-a');

  expect(enqueuePackageRunKey({ ...base, target_revision_id: 'plan-revision-2' })).not.toBe(key);
  expect(enqueuePackageRunKey({ ...base, target_status: 'ready/blocked/not_submitted' })).not.toBe(key);
  expect(enqueuePackageRunKey({ ...base, package_version: 5 })).not.toBe(key);
  expect(enqueuePackageRunKey({ ...base, automation_scope: 'repo:project-1:repo-2' })).not.toBe(key);
  expect(enqueuePackageRunKey({ ...base, automation_settings_version: 8 })).not.toBe(key);
  expect(enqueuePackageRunKey({ ...base, capability_fingerprint: 'capability-b' })).not.toBe(key);
  expect(enqueuePackageRunKey({ ...base, policy_digest: 'policy-b' })).not.toBe(key);
});

it('includes target revision and status in draft generation keys', () => {
  const key = generatePlanDraftKey({
    action_type: 'generate_plan_draft',
    target_object_type: 'work_item',
    target_object_id: 'work-item-1',
    target_revision_id: 'spec-revision-1',
    target_status: 'spec-approved',
    automation_scope: 'project:project-1',
    automation_settings_version: 3,
    capability_fingerprint: 'capability-a',
  });

  expect(generatePlanDraftKey({
    action_type: 'generate_plan_draft',
    target_object_type: 'work_item',
    target_object_id: 'work-item-1',
    target_revision_id: 'spec-revision-2',
    target_status: 'spec-approved',
    automation_scope: 'project:project-1',
    automation_settings_version: 3,
    capability_fingerprint: 'capability-a',
  })).not.toBe(key);
});
```

These tests must prove all `automation_action_runs` keys include:

- action type;
- target object type;
- target object id;
- target revision id;
- target status;
- automation scope;
- automation settings version;
- capability fingerprint;
- policy digest when the action depends on runtime policy;
- package version for package run enqueue.

- [ ] **Step 3: Run planner tests to verify failure**

Run: `pnpm test tests/automation/planner.test.ts`

Expected: FAIL because package does not exist.

- [ ] **Step 4: Add workspace alias and package**

Modify `tsconfig.base.json`:

```json
"@forgeloop/automation": ["packages/automation/src/index.ts"]
```

Create `packages/automation/package.json`:

```json
{
  "name": "@forgeloop/automation",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc --noEmit"
  },
  "dependencies": {
    "@forgeloop/db": "workspace:*",
    "@forgeloop/domain": "workspace:*",
    "@forgeloop/executor": "workspace:*"
  }
}
```

Create `packages/automation/tsconfig.json` extending `../../tsconfig.lib.json`.

- [ ] **Step 5: Implement planner types**

Create `packages/automation/src/types.ts`:

- `NextAction`
- `NoAction`
- `AutomationPlannerInput`
- `AutomationObjectGraph`
- `AutomationGateBlocker`
- `AutomationDecisionReasonCode`
- `DaemonIdentity`

- [ ] **Step 6: Implement idempotency keys**

Create `packages/automation/src/idempotency.ts`:

- `generatePlanDraftKey`
- `generateExecutionPackagesKey`
- `enqueuePackageRunKey`
- `projectRuntimeSnapshotKey`
- `notifyReviewReadyKey`
- `releaseReadinessProjectionKey`

Every action key must be deterministic and include these normalized fields in this order unless the action has no such dimension:

```ts
[
  action_type,
  target_object_type,
  target_object_id,
  target_revision_id,
  target_status,
  automation_scope,
  automation_settings_version,
  capability_fingerprint,
  policy_digest,
]
```

Additional required dimensions:

- `enqueue_package_run` includes `package_version`, `executor_type`, and `workflow_only`;
- `generate_execution_packages` includes `generation_key`;
- projection-only keys include action type, target object type/id, target status, and projection scope, but do not include capability fingerprint unless authorization depends on capabilities.

Keys must change when target revision, target status, automation scope, settings version, capability fingerprint, package version, or relevant policy digest changes.

- [ ] **Step 7: Implement pure planner**

Create `packages/automation/src/planner.ts`:

- do not touch repository;
- check capabilities directly, never compare preset ordinals;
- check active holds and dependency propagation;
- check terminal Work Item/package/review/run blockers;
- distinguish projection-only actions from mutating actions;
- never plan release gate pass/fail, rollout, or observation mutations;
- return public-safe reason codes.

- [ ] **Step 8: Add internal source adapter interface**

Create `packages/automation/src/source-adapter.ts`:

- `WorkItemSourceAdapter`
- `WorkItemIntakeCandidate`
- `ForgeLoopInternalSourceAdapter`

First implementation only emits internal candidates. It must not write lifecycle state.

- [ ] **Step 9: Export automation package**

Create `packages/automation/src/index.ts`:

```ts
export * from './types.js';
export * from './idempotency.js';
export * from './planner.js';
export * from './source-adapter.js';
```

- [ ] **Step 10: Run tests and build**

Run:

```bash
pnpm test tests/automation/planner.test.ts
pnpm --filter @forgeloop/automation build
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add tsconfig.base.json packages/automation tests/automation/planner.test.ts
git commit -m "feat: add PRD-first automation planner"
```

## Task 8: Automation Executor And Action Claims

**Files:**

- Create: `packages/automation/src/executor.ts`
- Modify: `packages/automation/src/index.ts`
- Modify: `packages/db/src/repositories/p0-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-p0-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-p0-repository.ts`
- Test: `tests/automation/executor.test.ts`
- Test: `tests/db/automation-repository.test.ts`

- [ ] **Step 1: Write failing executor tests**

Create `tests/automation/executor.test.ts`:

```ts
it('claims an action before side effects and replays terminal success', async () => {
  const action = generatePlanDraftActionFixture();
  const executor = createAutomationExecutor({ repository, commands: fakeCommands });

  const first = await executor.execute(action);
  const second = await executor.execute(action);

  expect(first.status).toBe('succeeded');
  expect(second.status).toBe('succeeded');
  expect(fakeCommands.ensurePlanDraftForApprovedSpec).toHaveBeenCalledTimes(1);
});

it('marks transient blockers gate_pending instead of permanent skipped', async () => {
  const action = enqueuePackageRunActionFixture();
  fakeCommands.enqueueRunIfPackageStillReady.mockRejectedValue(new AutomationGatePendingError('open_review_packet'));

  const result = await executor.execute(action);

  expect(result.status).toBe('gate_pending');
  expect(result.next_attempt_at).toBeDefined();
});
```

- [ ] **Step 2: Write failing action claim tests**

In `tests/db/automation-repository.test.ts`, add:

- claim pending action;
- live claim conflict;
- expired running claim increments attempt and claim token;
- due `gate_pending`, retryable `blocked`, and retryable `failed` are claimable;
- terminal `succeeded`, permanent `skipped`, and non-retryable `blocked` suppress side effects.

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm test tests/automation/executor.test.ts tests/db/automation-repository.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement action claim repository behavior**

Update repository implementations to match spec's claim protocol:

- `pending` with no owner claimable;
- expired `running` claimable;
- due `gate_pending`, retryable `blocked`, retryable `failed` claimable;
- reclaim increments `attempt`;
- terminal transitions require current `claim_token`;
- terminal successful rows return stored result for duplicate key.

- [ ] **Step 5: Implement AutomationExecutor**

Create `packages/automation/src/executor.ts`:

- export `AutomationCommandBoundary` with the exact command functions the daemon is allowed to call:
  - `ensurePlanDraftForApprovedSpec`;
  - `ensureExecutionPackageDraftsForPlanRevision`;
  - `enqueueRunIfPackageStillReady`;
  - `requestManualPath`;
  - projection/notification helpers only where they do not mutate approval gates;
- accepts repository and command boundary functions as dependencies;
- claims `automation_action_runs`;
- dispatches by action type;
- passes idempotency key and automation precondition into control-plane commands;
- catches known gate/policy/idempotency errors and maps to `gate_pending`, `blocked`, `skipped`, `failed`;
- stores internal diagnostics in action rows but returns public-safe result.

- [ ] **Step 6: Export executor**

Modify `packages/automation/src/index.ts`:

```ts
export * from './executor.js';
```

- [ ] **Step 7: Run tests and build**

Run:

```bash
pnpm test tests/automation/executor.test.ts tests/db/automation-repository.test.ts
pnpm --filter @forgeloop/automation build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/automation/src packages/db/src/repositories tests/automation tests/db/automation-repository.test.ts
git commit -m "feat: add automation executor action claims"
```

## Task 9: Automation Daemon App

**Files:**

- Create: `apps/automation-daemon/package.json`
- Create: `apps/automation-daemon/tsconfig.json`
- Create: `apps/automation-daemon/src/main.ts`
- Create: `apps/automation-daemon/src/automation-daemon.ts`
- Create: `apps/automation-daemon/src/automation-daemon.module.ts`
- Create: `apps/automation-daemon/src/control-plane-command-boundary.ts`
- Create: `apps/control-plane-api/src/p0/p0-bootstrap.ts`
- Modify: `apps/control-plane-api/src/p0/p0.module.ts`
- Modify: `tsconfig.base.json`
- Modify: `package.json`
- Test: `tests/automation/daemon.test.ts`

- [ ] **Step 1: Write failing daemon tests**

Create `tests/automation/daemon.test.ts` with fake repository/commands:

- daemon disabled by default performs no mutation;
- one scan computes eligible actions and executes through `AutomationExecutor`;
- two daemon instances do not duplicate side effects because action claim wins;
- daemon sidecar uses a `P0Service` command-boundary adapter with a no-op `RunWorker` and never imports `P0Module` or calls package/spec/plan/run repository mutation methods directly;
- daemon does not resume/retry RunSessions;
- daemon escalates/manual-paths stalled high-risk runs only through `requestManualPath`.

- [ ] **Step 2: Run daemon tests to verify failure**

Run: `pnpm test tests/automation/daemon.test.ts`

Expected: FAIL.

- [ ] **Step 3: Create app package**

Create `apps/automation-daemon/package.json`:

```json
{
  "name": "@forgeloop/automation-daemon",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc --noEmit",
    "start:dev": "tsx watch src/main.ts"
  },
  "dependencies": {
    "@forgeloop/automation": "workspace:*",
    "@forgeloop/control-plane-api": "workspace:*",
    "@forgeloop/db": "workspace:*",
    "@forgeloop/domain": "workspace:*",
    "@forgeloop/executor": "workspace:*",
    "@nestjs/common": "^11.1.19",
    "@nestjs/core": "^11.1.19",
    "reflect-metadata": "^0.2.2"
  },
  "devDependencies": {
    "tsx": "^4.21.0",
    "typescript": "^6.0.3"
  }
}
```

Create `apps/automation-daemon/tsconfig.json` extending `../../tsconfig.node.json`.

Modify `tsconfig.base.json`:

```json
"@forgeloop/control-plane-api/*": ["apps/control-plane-api/src/*"]
```

- [ ] **Step 4: Add control-plane command-boundary adapter**

Create `apps/control-plane-api/src/p0/p0-bootstrap.ts`:

- export `createP0Repository()` with the same durable/in-memory selection logic currently embedded in `P0Module`;
- export `createP0RunWorker()` for the API app and `createNoopRunWorker()` for the daemon sidecar;
- keep this helper free of any lifecycle service so the daemon can instantiate `P0Service` without starting the API worker loop.

Modify `apps/control-plane-api/src/p0/p0.module.ts`:

- replace the local repository/run-worker factory functions with imports from `p0-bootstrap.ts`;
- keep `RunWorkerLifecycleService` registered only in `P0Module`, not in the daemon module.

Create `apps/automation-daemon/src/control-plane-command-boundary.ts`:

- import `P0Service` from `@forgeloop/control-plane-api/p0/p0.service`;
- implement `createP0ServiceAutomationCommandBoundary(p0Service: P0Service): AutomationCommandBoundary`;
- delegate each mutating daemon action to the corresponding idempotent `P0Service` command;
- do not expose repository mutation methods through this adapter;
- map known `P0Service` command errors to the public-safe automation executor error classes.

- [ ] **Step 5: Implement daemon module**

Create `apps/automation-daemon/src/automation-daemon.module.ts`:

- import `createP0Repository` and `createNoopRunWorker` from `@forgeloop/control-plane-api/p0/p0-bootstrap`;
- provide `P0Service` directly with the repository provider and a no-op `RunWorker`;
- provide `AutomationDaemon`;
- provide `AutomationCommandBoundary` via `createP0ServiceAutomationCommandBoundary(P0Service)`;
- share the same repository selection logic as the API app, but do not load `P0Module` or `RunWorkerLifecycleService`.

- [ ] **Step 6: Implement daemon loop**

Create `apps/automation-daemon/src/automation-daemon.ts`:

- `AutomationDaemon` class with `scanOnce()` and `runUntilStopped()`;
- bounded scan queries;
- resolves settings and policy;
- invokes pure planner;
- invokes `AutomationExecutor` with the injected `AutomationCommandBoundary`;
- never writes WorkItem/Spec/Plan/ExecutionPackage/RunSession/ReviewPacket lifecycle state directly through the repository;
- supports jitter/backoff;
- disabled unless explicit config says enabled.

- [ ] **Step 7: Implement main entry**

Create `apps/automation-daemon/src/main.ts`:

- import `reflect-metadata`;
- create a Nest application context from `AutomationDaemonModule`;
- parse env/config;
- fail closed if no DB config;
- default disabled;
- resolve `AutomationDaemon` from the application context and call `runUntilStopped()`;
- log public-safe action summaries only.

- [ ] **Step 8: Add root script**

Modify root `package.json`:

```json
"dev:automation-daemon": "pnpm --filter @forgeloop/automation-daemon start:dev"
```

- [ ] **Step 9: Run tests and build**

Run:

```bash
pnpm test tests/automation/daemon.test.ts
pnpm --filter @forgeloop/automation-daemon build
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/automation-daemon apps/control-plane-api/src/p0/p0-bootstrap.ts apps/control-plane-api/src/p0/p0.module.ts tsconfig.base.json package.json tests/automation/daemon.test.ts
git commit -m "feat: add automation daemon sidecar"
```

## Task 10: Runtime Snapshot Query

**Files:**

- Create: `packages/db/src/queries/runtime-snapshot-queries.ts`
- Modify: `packages/db/src/index.ts`
- Create: `apps/control-plane-api/src/modules/query/runtime-snapshot.projector.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.service.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.controller.ts`
- Test: `tests/api/runtime-snapshot.test.ts`
- Test: `tests/api/query-module.test.ts`

- [ ] **Step 1: Write failing runtime snapshot tests**

Create `tests/api/runtime-snapshot.test.ts`:

```ts
it('returns PRD-first runtime state without raw local/runtime internals', async () => {
  const app = await createP0ApiTestApp();
  await seedRuntimeSnapshotFixture(app.repository, {
    runtime_metadata: {
      durability_mode: 'durable',
      workspace_path: '/Users/private/repo/.worktrees/run-1',
      source_repo_path: '/Users/private/repo',
      app_server_fallback_reason: 'stderr with /Users/private/token',
      policy_digest: 'sha256-policy',
      policy_source_path: 'WORKFLOW.md',
      recovery_attempt_count: 1,
      effective_dangerous_mode: 'not_requested',
    },
  });

  const response = await request(app.httpServer).get('/query/runtime').expect(200);
  expect(JSON.stringify(response.body)).not.toContain('/Users/private');
  expect(JSON.stringify(response.body)).not.toContain('stderr');
  expect(response.body.policy).toContainEqual(expect.objectContaining({ policy_digest: 'sha256-policy' }));
});
```

Add tests for:

- counts;
- automation action public-safe status;
- package blockers;
- active holds exposed only as status/reason code;
- worker lease heartbeat/expiry without raw metadata;
- `serializePublicRunSession` reuse.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test tests/api/runtime-snapshot.test.ts tests/api/query-module.test.ts`

Expected: FAIL because route/projector does not exist.

- [ ] **Step 3: Add DB query helper**

Create `packages/db/src/queries/runtime-snapshot-queries.ts`:

- query/list active and recent RunSessions;
- query/list worker leases;
- query/list open ReviewPackets;
- query/list action runs;
- query/list active holds;
- query/list package blockers.

Return raw internal rows only to the API projector; do not expose this helper directly as a public DTO.

- [ ] **Step 4: Add public-safe projector**

Create `apps/control-plane-api/src/modules/query/runtime-snapshot.projector.ts`:

- strip local paths;
- strip raw runtime metadata;
- strip raw action `result_json`, `metadata_json`, `error_message`;
- strip command idempotency results;
- expose only ids, statuses, safe reason codes, timestamps, safe summaries, policy digests.

- [ ] **Step 5: Add query service/controller route**

Modify `query.service.ts`:

```ts
async getRuntimeSnapshot() {
  return projectRuntimeSnapshot(await getRuntimeSnapshotRows(this.repository), {
    run_session_metadata_fallback: this.initialRuntimeMetadata(),
  });
}
```

Modify `query.controller.ts`:

```ts
@Get('runtime')
getRuntimeSnapshot() {
  return this.service.getRuntimeSnapshot();
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm test tests/api/runtime-snapshot.test.ts tests/api/query-module.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/queries packages/db/src/index.ts apps/control-plane-api/src/modules/query tests/api/runtime-snapshot.test.ts tests/api/query-module.test.ts
git commit -m "feat: add public-safe runtime snapshot"
```

## Task 11: Automation Smoke Dogfood

**Files:**

- Create: `scripts/automation-dogfood.ts`
- Test: `tests/smoke/automation-dogfood-script.test.ts`
- Modify: `package.json`
- Modify: `docs/automation-daemon.md` or `README.md`

- [ ] **Step 1: Write failing smoke test**

Create `tests/smoke/automation-dogfood-script.test.ts`:

- create Work Item;
- approve Spec;
- daemon scan generates Plan draft;
- approve Plan;
- daemon scan generates package draft;
- mark package ready;
- verify daemon does not enqueue under `draft_only`;
- enable `run_enqueue` through audited command using an explicit local dogfood `TestOnlyMockResourceGovernor`;
- verify the test-only governor is accepted only because the dogfood run uses `executor_type: mock` and `workflow_only: true`;
- verify the same test-only governor is rejected for local Codex/non-mock execution with `test_only_governor_requires_mock_executor`;
- daemon enqueues one RunSession;
- mock run-worker completes;
- ReviewPacket becomes ready;
- `/query/runtime` contains terminal state and no local paths.

- [ ] **Step 2: Run smoke test to verify failure**

Run: `pnpm test tests/smoke/automation-dogfood-script.test.ts`

Expected: FAIL.

- [ ] **Step 3: Add dogfood script**

Create `scripts/automation-dogfood.ts`:

- uses in-memory repository by default;
- seeds explicit local dogfood `draft_only` settings;
- never treats repo policy as authority for automation capabilities;
- requires explicit flag/env for `run_enqueue`;
- injects `TestOnlyMockResourceGovernor` only for mock workflow dogfood;
- refuses to run local Codex or production-like execution unless `ExternalSandboxResourceGovernor` returns an enforcing runtime safety attestation;
- prints public-safe step summaries.

- [ ] **Step 4: Add script alias**

Modify root `package.json`:

```json
"dogfood:automation": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/automation-dogfood.ts"
```

- [ ] **Step 5: Add docs**

Create `docs/automation-daemon.md`:

- daemon is sidecar and disabled by default;
- Phase 0/1 stop signs;
- automation presets are capability maps;
- run enqueue is opt-in and audited;
- runtime snapshot redaction expectations.

- [ ] **Step 6: Run smoke and docs-adjacent tests**

Run:

```bash
pnpm test tests/smoke/automation-dogfood-script.test.ts
pnpm test tests/api/runtime-snapshot.test.ts tests/api/automation-commands.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/automation-dogfood.ts tests/smoke/automation-dogfood-script.test.ts package.json docs/automation-daemon.md
git commit -m "test: add automation daemon dogfood flow"
```

## Task 12: Final Verification

**Files:**

- All files touched by Tasks 1-11.

- [ ] **Step 1: Run targeted test suite**

Run:

```bash
pnpm test \
  tests/domain/automation.test.ts \
  tests/domain/validators.test.ts \
  tests/db/repository.test.ts \
  tests/db/automation-repository.test.ts \
  tests/api/automation-commands.test.ts \
  tests/api/delivery-flow.test.ts \
  tests/api/query-module.test.ts \
  tests/api/release-module.test.ts \
  tests/api/runtime-snapshot.test.ts \
  tests/automation/planner.test.ts \
  tests/automation/executor.test.ts \
  tests/automation/daemon.test.ts \
  tests/executor/codex-worktree.test.ts \
  tests/executor/path-safety.test.ts \
  tests/executor/path-policy.test.ts \
  tests/executor/runtime-policy.test.ts \
  tests/executor/structured-command.test.ts \
  tests/executor/resource-limits.test.ts \
  tests/executor/resource-governor.test.ts \
  tests/executor/hook-runner.test.ts \
  tests/executor/local-codex-preflight.test.ts \
  tests/run-worker/run-worker.test.ts \
  tests/smoke/automation-dogfood-script.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 3: Run full workspace build**

Run: `pnpm -r build`

Expected: PASS.

- [ ] **Step 4: Validate durable schema push**

Run after exporting the local durable database environment variables used by `packages/db/drizzle.config.ts`:

```bash
pnpm db:push
```

Expected: PASS against a disposable local/dev database. If the local machine has no durable DB available, run this in the configured CI or dev database environment before merging.

- [ ] **Step 5: Run diff hygiene**

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 6: Verify default-off behavior manually**

Run: `pnpm dogfood:automation`

Expected:

- daemon starts with projection/draft-only local settings only if script seeds them explicitly;
- production/default missing settings resolve to `off`;
- `run_enqueue` does not happen until the audited capability update step.

- [ ] **Step 7: Commit final fixes**

```bash
git add apps packages tests scripts docs/automation-daemon.md package.json pnpm-lock.yaml tsconfig.base.json
git commit -m "chore: verify automation daemon foundation"
```

## Implementation Notes

- If implementing through subagents, split ownership by task boundaries. Do not let two workers edit `p0.service.ts`, repository implementations, or executor runtime modules at the same time.
- For Phase 0, repository contract tests are the source of truth. Durable and in-memory repositories must fail and pass the same race/idempotency cases.
- For Phase 1, `run_enqueue` remains blocked if hard resource limits are not available. Local dogfood may use only the explicit `TestOnlyMockResourceGovernor` with mock workflow execution; it must not satisfy production or local Codex readiness.
- For Phase 2, planner eligibility is explanation and scheduling only. Control-plane commands must re-check all gates.
- Keep action errors public-safe at DTO boundaries; store raw diagnostics only in internal repository fields.
- Keep commits small enough that a failed phase can be reverted without losing unrelated work.
