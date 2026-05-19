# Codex Automation Spec Draft Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first closed-loop Codex automation slice: WorkItem -> fake-generated Spec draft through the automation daemon and signed control-plane command boundary.

**Architecture:** Extend the existing automation projection/planner/executor/control-plane command path with `ensure_spec_draft` before existing Plan and Package actions. The daemon remains a sidecar that fetches signed generation context, produces a minimal local fake `GeneratedSpecDraftV1`, and applies it only through a signed internal command. Human Spec and Plan approvals remain unchanged, and Plan/Package generation payloads, `packages/codex-runtime`, `apps/web`, and dogfood autorun stay out of this plan.

**Tech Stack:** TypeScript, NestJS, Zod, Drizzle repository, Vitest, existing `@forgeloop/domain`, `@forgeloop/db`, `@forgeloop/automation`, and `apps/automation-daemon`.

---

## Scope Boundary

This is Plan 1 from `docs/superpowers/specs/2026-05-18-codex-automation-closed-loop-foundation-design.md`.

Implement only:

- `canGenerateSpecDraft`.
- Runtime snapshot `work_items_requiring_spec` / `workItemsRequiringSpec`.
- `ensure_spec_draft` action type, action input, planner, executor, idempotency identity, DTOs, and HTTP client support.
- Signed generation-context endpoint for WorkItem Spec draft generation.
- Signed internal command `POST /internal/automation/work-items/:workItemId/ensure-spec-draft`.
- Local minimal fake Spec draft generation for deterministic tests and local dogfood.

Do not implement:

- Generated Plan payloads.
- Generated Package payloads.
- `packages/codex-runtime`.
- `enqueue_package_run`.
- `FORGELOOP_CODEX_AUTOMATION_DOGFOOD_AUTORUN`.
- Production `run_enqueue`.
- `apps/web`.
- Any compatibility alias naming for old service boundaries.

## File Structure

Create:

- `packages/automation/src/spec-draft-generation.ts`
  - Owns Plan 1 local fake/disabled Spec draft generation and constants:
    - `specDraftPromptVersion`
    - `specDraftOutputSchemaVersion`
    - `AutomationGenerationMode`
    - `SpecDraftGenerator`
    - `validateGeneratedSpecDraft`
    - `createFakeSpecDraftGenerator`
    - `disabledSpecDraftGenerator`
- `apps/control-plane-api/src/modules/automation/automation-generation-context.service.ts`
  - Owns signed read-side generation context loading and active action claim validation for generation-context endpoints.

Modify:

- `packages/automation/package.json`
  - Add `@forgeloop/contracts` as a workspace dependency so the new generation-context and command types can reference `ArtifactRef`.
- `pnpm-lock.yaml`
  - Update if the workspace dependency graph changes after adding the new package dependency.
- `packages/domain/src/automation.ts`
  - Add `canGenerateSpecDraft`.
  - Add `normalizeAutomationCapabilities`.
  - Update preset materialization and capability fingerprints to include Spec generation.
- `packages/db/src/repositories/delivery-repository.ts`
  - Add `work_items_requiring_spec` to `RuntimeSnapshotRepositoryData`.
- `packages/db/src/repositories/in-memory-delivery-repository.ts`
  - Add WorkItem -> Spec draft projection and include it in snapshot data.
  - Allow `runtimeSnapshotDraftTargetScope` to check `canGenerateSpecDraft`.
- `packages/db/src/repositories/drizzle-delivery-repository.ts`
  - Add the same projection in Drizzle.
  - Include `ensure_spec_draft` in latest matching action lookup, including actions whose `target_revision_id` is absent.
  - Normalize old settings capabilities without rewriting stored fingerprints.
- `packages/automation/src/types.ts`
  - Add `ensure_spec_draft`, generated Spec draft DTO types, generation context types, action input, command input, and client methods.
- `packages/automation/src/idempotency.ts`
  - Include optional `promptVersion`, `outputSchemaVersion`, and `generationMode` in mutating action identity.
- `packages/automation/src/planner.ts`
  - Add planner options for Spec draft generation.
  - Emit `ensure_spec_draft` before Plan and Package actions when generation mode is enabled.
  - Use `canGenerateSpecDraft` for ambiguity manual-path preconditions.
- `packages/automation/src/executor.ts`
  - Parse and execute `ensure_spec_draft`.
  - Fetch generation context, run fake/disabled generator, call command endpoint, and complete/block/fail action safely.
- `packages/automation/src/http-client.ts`
  - Parse `work_items_requiring_spec`.
  - Add `specDraftGenerationContext`.
  - Add `ensureSpecDraft`.
- `packages/automation/src/index.ts`
  - Export new generation helpers and types if index exports are explicit.
- `apps/automation-daemon/src/config.ts`
  - Add `FORGELOOP_CODEX_AUTOMATION_GENERATION=disabled|fake`.
- `apps/automation-daemon/src/main.ts`
  - Wire fake or disabled generator into `AutomationDaemon`.
- `apps/automation-daemon/src/automation-daemon.ts`
  - Pass planner generation options and executor generator options.
- `apps/control-plane-api/src/modules/automation/automation.dto.ts`
  - Add action input schema, generated Spec draft schema, command schema, generation-context query schema, context DTO interfaces, and runtime snapshot field.
- `apps/control-plane-api/src/modules/automation/automation.controller.ts`
  - Add `POST /work-items/:workItemId/ensure-spec-draft`.
  - Add `GET /generation-context/work-items/:workItemId/spec-draft`.
- `apps/control-plane-api/src/modules/automation/automation-command.service.ts`
  - Add `ensureSpecDraftForClaimedAction`, command idempotency, and SpecRevision writer.
  - Keep Plan/Package command payloads unchanged in this plan.
- `apps/control-plane-api/src/modules/automation/automation.module.ts`
  - Register the generation context service if providers are explicit.

Test:

- `tests/domain/automation.test.ts`
- `tests/db/repository-contract.ts`
- `tests/db/automation-repository.test.ts`
- `tests/automation/idempotency.test.ts`
- `tests/automation/planner.test.ts`
- `tests/automation/executor.test.ts`
- `tests/automation/daemon.test.ts`
- `tests/api/automation-runtime-snapshot.test.ts`
- `tests/api/automation-commands.test.ts`
- `tests/api/automation-internal-auth.test.ts`
- `tests/api/automation-daemon.integration.test.ts`
- `tests/smoke/automation-dogfood-script.test.ts` only if expected completed action type lists need the new Spec action in seeded full-loop scenarios.

## Implementation Notes

- Keep action input for `ensure_spec_draft` exactly:

```json
{
  "work_item_id": "work-item-id"
}
```

- Keep command payload for `ensure_spec_draft` exactly:

```json
{
  "action_run_id": "action-run-id",
  "claim_token": "claim-token",
  "idempotency_key": "action-idempotency-key",
  "automation_precondition": {},
  "generated_spec_draft": {
    "schema_version": "spec_draft.v1",
    "summary": "summary",
    "content": "content",
    "background": "background",
    "goals": ["goal"],
    "scope_in": ["scope"],
    "scope_out": ["out of scope"],
    "acceptance_criteria": ["criterion"],
    "risk_notes": ["risk"],
    "test_strategy_summary": "tests"
  },
  "generation_artifacts": []
}
```

- The fake generator must produce schema-valid content from public-safe WorkItem context only.
- When generation mode is `disabled`, the planner should not emit `ensure_spec_draft`. If an already-claimed `ensure_spec_draft` is executed with the disabled generator, executor should block it with public reason `generation_disabled`.
- `codex` generation mode is intentionally unsupported until Plan 2. Config may reject it or map it to a clear unsupported error, but do not add a real Codex driver here.
- Do not recompute persisted capability fingerprints for old Drizzle rows during read. Normalize `capabilities_json` so missing `canGenerateSpecDraft` is false, but preserve stored `capability_fingerprint`. New settings writes compute fingerprints from the full capability object.
- Existing deterministic Plan/Package commands remain unchanged.

---

### Task 1: Domain Capability Materialization

**Files:**
- Modify: `packages/domain/src/automation.ts`
- Test: `tests/domain/automation.test.ts`

- [ ] **Step 1: Write failing domain tests**

Add assertions that every preset contains `canGenerateSpecDraft`, `draft_only` and `run_enqueue` enable it, `off` and `ready_projection` disable it, and old partial capability objects normalize it to false.

```ts
import {
  automationCapabilitiesForPreset,
  capabilityFingerprint,
  normalizeAutomationCapabilities,
} from '../../packages/domain/src/automation';

it('materializes Spec draft capability in every preset', () => {
  expect(automationCapabilitiesForPreset('off')).toEqual({
    canProjectRuntimeState: false,
    canGenerateSpecDraft: false,
    canGeneratePlanDraft: false,
    canGeneratePackageDrafts: false,
    canEnqueueRuns: false,
  });
  expect(automationCapabilitiesForPreset('draft_only')).toMatchObject({
    canProjectRuntimeState: true,
    canGenerateSpecDraft: true,
    canGeneratePlanDraft: true,
    canGeneratePackageDrafts: true,
    canEnqueueRuns: false,
  });
  expect(automationCapabilitiesForPreset('run_enqueue')).toMatchObject({
    canGenerateSpecDraft: true,
    canEnqueueRuns: true,
  });
});

it('normalizes legacy capability JSON without granting Spec generation', () => {
  expect(
    normalizeAutomationCapabilities({
      canProjectRuntimeState: true,
      canGeneratePlanDraft: true,
      canGeneratePackageDrafts: true,
      canEnqueueRuns: false,
    }),
  ).toEqual({
    canProjectRuntimeState: true,
    canGenerateSpecDraft: false,
    canGeneratePlanDraft: true,
    canGeneratePackageDrafts: true,
    canEnqueueRuns: false,
  });
});

it('fingerprints capabilities after full materialization', () => {
  const first = capabilityFingerprint({
    canEnqueueRuns: false,
    canGeneratePackageDrafts: true,
    canGeneratePlanDraft: true,
    canGenerateSpecDraft: true,
    canProjectRuntimeState: true,
  });
  const second = capabilityFingerprint({
    canProjectRuntimeState: true,
    canGenerateSpecDraft: true,
    canGeneratePlanDraft: true,
    canGeneratePackageDrafts: true,
    canEnqueueRuns: false,
  });

  expect(first).toBe(second);
});
```

- [ ] **Step 2: Run the failing domain test**

Run:

```bash
pnpm vitest run --pool=forks --no-file-parallelism --maxWorkers=1 tests/domain/automation.test.ts
```

Expected: FAIL with TypeScript or assertion errors around missing `canGenerateSpecDraft` / `normalizeAutomationCapabilities`.

- [ ] **Step 3: Implement capability normalization**

In `packages/domain/src/automation.ts`, update the interface and add the normalizer near `automationCapabilitiesForPreset`:

```ts
export interface AutomationCapabilities {
  canProjectRuntimeState: boolean;
  canGenerateSpecDraft: boolean;
  canGeneratePlanDraft: boolean;
  canGeneratePackageDrafts: boolean;
  canEnqueueRuns: boolean;
}

export const normalizeAutomationCapabilities = (value: Partial<AutomationCapabilities> | undefined): AutomationCapabilities => ({
  canProjectRuntimeState: value?.canProjectRuntimeState === true,
  canGenerateSpecDraft: value?.canGenerateSpecDraft === true,
  canGeneratePlanDraft: value?.canGeneratePlanDraft === true,
  canGeneratePackageDrafts: value?.canGeneratePackageDrafts === true,
  canEnqueueRuns: value?.canEnqueueRuns === true,
});
```

Update preset maps:

```ts
const automationCapabilityByPreset: Record<AutomationPreset, AutomationCapabilities> = {
  off: {
    canProjectRuntimeState: false,
    canGenerateSpecDraft: false,
    canGeneratePlanDraft: false,
    canGeneratePackageDrafts: false,
    canEnqueueRuns: false,
  },
  ready_projection: {
    canProjectRuntimeState: true,
    canGenerateSpecDraft: false,
    canGeneratePlanDraft: false,
    canGeneratePackageDrafts: false,
    canEnqueueRuns: false,
  },
  draft_only: {
    canProjectRuntimeState: true,
    canGenerateSpecDraft: true,
    canGeneratePlanDraft: true,
    canGeneratePackageDrafts: true,
    canEnqueueRuns: false,
  },
  run_enqueue: {
    canProjectRuntimeState: true,
    canGenerateSpecDraft: true,
    canGeneratePlanDraft: true,
    canGeneratePackageDrafts: true,
    canEnqueueRuns: true,
  },
};

export const automationCapabilitiesForPreset = (preset: AutomationPreset): AutomationCapabilities =>
  normalizeAutomationCapabilities(automationCapabilityByPreset[preset]);

export const capabilityFingerprint = (capabilities: AutomationCapabilities): string =>
  fingerprint(normalizeAutomationCapabilities(capabilities));
```

- [ ] **Step 4: Run the domain tests again**

Run:

```bash
pnpm vitest run --pool=forks --no-file-parallelism --maxWorkers=1 tests/domain/automation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/automation.ts tests/domain/automation.test.ts
git commit -m "feat: add spec draft automation capability"
```

---

### Task 2: Runtime Snapshot Spec Targets

**Files:**
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Test: `tests/db/repository-contract.ts`
- Test: `tests/db/automation-repository.test.ts`

- [ ] **Step 1: Write failing repository contract tests**

Add a repository contract case that creates:

- Project and active repo.
- `draft_only` repo automation settings.
- WorkItem with no `current_spec_id`.

Then assert `getRuntimeSnapshotData()` returns one `work_items_requiring_spec` target:

```ts
expect(snapshot.work_items_requiring_spec).toContainEqual(
  expect.objectContaining({
    target_object_type: 'work_item',
    target_object_id: workItem.id,
    target_status: workItem.phase,
    project_id: workItem.project_id,
    repo_id: repo.repo_id,
    automation_scope: `repo:${workItem.project_id}:${repo.repo_id}`,
  }),
);
```

Add negative assertions in the same test or nearby tests:

```ts
expect(snapshot.work_items_requiring_spec).toEqual([]);
```

Cover these cases:

- WorkItem already has current Spec with current revision.
- WorkItem is terminal for automation.
- Automation settings do not have `canGenerateSpecDraft`.
- Active manual path hold exists on `work_item:<id>`.
- A pending/running/succeeded `ensure_spec_draft` action suppresses the target through latest matching action fields.
- The suppression case must cover an `ensure_spec_draft` action with no `target_revision_id` / SQL `target_revision_id IS NULL`; this is the key regression for Spec targets.

- [ ] **Step 2: Run repository tests to verify failure**

Run:

```bash
pnpm vitest run --pool=forks --no-file-parallelism --maxWorkers=1 tests/db/repository-contract.ts tests/db/automation-repository.test.ts
```

Expected: FAIL because `work_items_requiring_spec` does not exist and `ensure_spec_draft` is not part of the snapshot lookups.

- [ ] **Step 3: Extend repository data contract**

In `packages/db/src/repositories/delivery-repository.ts`, add:

```ts
export interface RuntimeSnapshotRepositoryData {
  projects: RuntimeSnapshotProjectRow[];
  repos: RuntimeSnapshotRepoRow[];
  work_items_requiring_spec: RuntimeSnapshotTargetRow[];
  work_items_requiring_plan: RuntimeSnapshotTargetRow[];
  plan_revisions_requiring_packages: RuntimeSnapshotTargetRow[];
  run_enqueue_disabled_packages: RuntimeSnapshotTargetRow[];
  active_holds: RuntimeSnapshotManualHoldRow[];
  recent_action_runs: AutomationActionRun[];
  policy_projection_action_runs: AutomationActionRun[];
}
```

- [ ] **Step 4: Implement in-memory projection**

In `packages/db/src/repositories/in-memory-delivery-repository.ts`:

Add `work_items_requiring_spec` in `getRuntimeSnapshotData()` before `work_items_requiring_plan`.

Add a helper:

```ts
const suppressingLatestActionStatuses = new Set(['pending', 'running', 'succeeded']);

private async runtimeSnapshotWorkItemsRequiringSpec(repos: ProjectRepo[]): Promise<RuntimeSnapshotTargetRow[]> {
  const targets: RuntimeSnapshotTargetRow[] = [];
  for (const workItem of valuesFor(this.workItems).sort(byCreatedAtThenId)) {
    if (isWorkItemAutomationTerminal(workItem)) {
      continue;
    }
    const existingSpec = workItem.current_spec_id === undefined ? undefined : this.specs.get(workItem.current_spec_id);
    if (existingSpec?.current_revision_id !== undefined) {
      continue;
    }
    const targetScope = await this.runtimeSnapshotDraftTargetScope(repos, workItem.project_id, 'canGenerateSpecDraft');
    if (targetScope === undefined) {
      continue;
    }
    if (this.hasActiveManualHold([`work_item:${workItem.id}`])) {
      continue;
    }
    const latestActionFields = this.latestMatchingActionFields('ensure_spec_draft', workItem.id, undefined);
    if (
      latestActionFields.latest_matching_action_status !== undefined &&
      suppressingLatestActionStatuses.has(latestActionFields.latest_matching_action_status)
    ) {
      continue;
    }
    targets.push({
      target_object_type: 'work_item',
      target_object_id: workItem.id,
      target_status: workItem.phase,
      project_id: workItem.project_id,
      ...targetScope,
      ...latestActionFields,
    });
  }
  return targets;
}
```

Update `latestMatchingActionFields` so Spec draft targets can match actions without a target revision:

```ts
private latestMatchingActionFields(
  actionType: string,
  targetObjectId: string,
  targetRevisionId?: string,
): Pick<RuntimeSnapshotTargetRow, 'latest_matching_action_status' | 'blocked_reason_code' | 'blocked_summary' | 'blockers'> {
  const actionRun = valuesFor(this.automationActionRuns)
    .filter(
      (candidate) =>
        candidate.action_type === actionType &&
        candidate.target_object_id === targetObjectId &&
        candidate.target_revision_id === targetRevisionId,
    )
    .sort(this.compareAutomationActionRecency)[0];
  ...
}
```

Update the capability union:

```ts
capability: 'canGenerateSpecDraft' | 'canGeneratePlanDraft' | 'canGeneratePackageDrafts'
```

- [ ] **Step 5: Implement Drizzle projection**

In `packages/db/src/repositories/drizzle-delivery-repository.ts`:

Add a `runtimeSnapshotWorkItemsRequiringSpec(...)` helper mirroring the in-memory logic. It should take `workItems`, `repos`, `specsById`, `holds`, and `settingsByScope`.

Update snapshot assembly:

```ts
const workItemsRequiringSpec = await this.runtimeSnapshotWorkItemsRequiringSpec(
  workItemRows,
  repoRows,
  specsById,
  holds,
  settingsByScope,
);
const latestMatchingTargets = [
  ...workItemsRequiringSpec,
  ...workItemsRequiringPlan,
  ...planRevisionsRequiringPackages,
];
```

Add the same suppression rule to the Drizzle helper. Because the actual latest action fields are fetched in a later batched query, do this in two stages:

1. `runtimeSnapshotWorkItemsRequiringSpec(...)` returns raw eligible Spec targets without latest action fields.
2. After `latestMatchingActionFields` is computed, apply fields to Spec targets and filter suppressing statuses before returning snapshot data.

Use an explicit helper near the Drizzle snapshot assembly:

```ts
const suppressingLatestActionStatuses = new Set(['pending', 'running', 'succeeded']);

const suppressTargetsWithLatestAction = (targets: RuntimeSnapshotTargetRow[]): RuntimeSnapshotTargetRow[] =>
  targets.filter(
    (target) =>
      target.latest_matching_action_status === undefined ||
      !suppressingLatestActionStatuses.has(target.latest_matching_action_status),
  );
```

Then return:

```ts
const workItemsRequiringSpecWithActionFields = this.applyLatestMatchingActionFields(
  workItemsRequiringSpec,
  latestMatchingActionFields,
);

return {
  ...
  work_items_requiring_spec: suppressTargetsWithLatestAction(workItemsRequiringSpecWithActionFields),
  work_items_requiring_plan: this.applyLatestMatchingActionFields(workItemsRequiringPlan, latestMatchingActionFields),
  ...
};
```

Update latest matching action lookup. Drizzle currently keys latest matching actions by `target_revision_id`, so this change must explicitly include `ensure_spec_draft` actions whose revision is `NULL` / absent. Add `isNull` to the Drizzle imports if needed.

```ts
inArray(automation_action_runs.actionType, [
  'ensure_spec_draft',
  'ensure_plan_draft',
  'ensure_package_drafts',
])
```

Replace the revision filter with a defined-revision-or-null condition:

```ts
const targetRevisionIds = [
  ...new Set(latestMatchingTargets.flatMap((target) => (target.target_revision_id === undefined ? [] : [target.target_revision_id]))),
];
const includesRevisionlessTargets = latestMatchingTargets.some((target) => target.target_revision_id === undefined);
const revisionCondition =
  targetRevisionIds.length === 0
    ? isNull(automation_action_runs.targetRevisionId)
    : includesRevisionlessTargets
      ? or(inArray(automation_action_runs.targetRevisionId, targetRevisionIds), isNull(automation_action_runs.targetRevisionId))
      : inArray(automation_action_runs.targetRevisionId, targetRevisionIds);
```

Use `revisionCondition` inside the existing `and(...)` expression.

Update `latestMatchingActionFieldsByTarget`, `latestMatchingActionKey`, and `runtimeSnapshotActionTypeForTarget` to preserve the absent revision as part of identity rather than skipping it:

```ts
private applyLatestMatchingActionFields(
  targets: RuntimeSnapshotTargetRow[],
  latestMatchingActionFields: Map<
    string,
    Pick<RuntimeSnapshotTargetRow, 'latest_matching_action_status' | 'blocked_reason_code' | 'blocked_summary' | 'blockers'>
  >,
): RuntimeSnapshotTargetRow[] {
  return targets.map((target) => ({
    ...target,
    ...latestMatchingActionFields.get(
      this.latestMatchingActionKey(
        this.runtimeSnapshotActionTypeForTarget(target),
        target.target_object_id,
        target.target_revision_id,
      ),
    ),
  }));
}

private latestMatchingActionFieldsByTarget(actions: AutomationActionRun[]) {
  const fieldsByTarget = new Map<
    string,
    Pick<RuntimeSnapshotTargetRow, 'latest_matching_action_status' | 'blocked_reason_code' | 'blocked_summary' | 'blockers'>
  >();
  for (const actionRun of actions) {
    const key = this.latestMatchingActionKey(actionRun.action_type, actionRun.target_object_id, actionRun.target_revision_id);
    if (!fieldsByTarget.has(key)) {
      fieldsByTarget.set(key, this.latestMatchingActionFields(actionRun));
    }
  }
  return fieldsByTarget;
}

private latestMatchingActionKey(actionType: string, targetObjectId: string, targetRevisionId?: string): string {
  return `${actionType}:${targetObjectId}:${targetRevisionId ?? '<none>'}`;
}
```

Then update `runtimeSnapshotActionTypeForTarget`:

```ts
private runtimeSnapshotActionTypeForTarget(
  target: RuntimeSnapshotTargetRow,
): 'ensure_spec_draft' | 'ensure_plan_draft' | 'ensure_package_drafts' {
  if (target.target_object_type === 'plan_revision') {
    return 'ensure_package_drafts';
  }
  return target.target_revision_id === undefined ? 'ensure_spec_draft' : 'ensure_plan_draft';
}
```

Normalize persisted settings rows in read helpers:

```ts
const normalizeSettings = (settings: AutomationProjectSettings): AutomationProjectSettings => ({
  ...settings,
  capabilities_json: normalizeAutomationCapabilities(settings.capabilities_json),
});
```

Use this wrapper when returning existing settings and when adding `settingsByScope`, but preserve `settings.capability_fingerprint` from storage.

- [ ] **Step 6: Run repository tests again**

Run:

```bash
pnpm vitest run --pool=forks --no-file-parallelism --maxWorkers=1 tests/db/repository-contract.ts tests/db/automation-repository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/repositories/delivery-repository.ts packages/db/src/repositories/in-memory-delivery-repository.ts packages/db/src/repositories/drizzle-delivery-repository.ts tests/db/repository-contract.ts tests/db/automation-repository.test.ts
git commit -m "feat: project work items requiring spec drafts"
```

---

### Task 3: Automation Types, Generated Spec Schema, and HTTP Wire Parsing

**Files:**
- Modify: `packages/automation/package.json`
- Create: `packages/automation/src/spec-draft-generation.ts`
- Modify: `packages/automation/src/types.ts`
- Modify: `packages/automation/src/http-client.ts`
- Modify: `packages/automation/src/index.ts`
- Test: `tests/automation/planner.test.ts`
- Test: `tests/automation/executor.test.ts`

- [ ] **Step 1: Write failing type-level and HTTP parser tests**

In `tests/automation/planner.test.ts` or a new nearby describe block, add a runtime snapshot fixture with `workItemsRequiringSpec`.

At the top of that test file, add a dedicated Spec target helper so the new cases do not rely on a nonexistent fixture name:

```ts
const specWorkItemTarget = (overrides: Partial<RuntimeSnapshotTarget> = {}): RuntimeSnapshotTarget => ({
  targetObjectType: 'work_item',
  targetObjectId: 'work-item-needs-spec',
  targetStatus: 'triage',
  projectId: 'project-1',
  repoId: 'repo-1',
  automationScope: repoScope,
  ...overrides,
});
```

Keep the existing `workItemTarget` and `packageTarget` helpers for the approved Spec and Package cases.

In `tests/automation/executor.test.ts`, extend the fake client interface to require:

Add a local `specDraftContext()` fixture near the existing `baseAction` and `claimedAction` helpers so the new test does not depend on an undefined helper:

```ts
import { createFakeSpecDraftGenerator } from '../../packages/automation/src/index';
import type {
  AutomationGenerationWorkItemContextV1,
  EnsureSpecDraftCommandInput,
} from '../../packages/automation/src/index';

const specDraftContext = (): AutomationGenerationWorkItemContextV1 => ({
  context_version: 'generation_context.work_item.v1',
  action_run_id: 'action-run-1',
  work_item: {
    id: 'work-item-1',
    project_id: 'project-1',
    title: 'Spec draft work item',
    goal: 'Ship the spec draft path',
    success_criteria: ['Draft spec exists'],
    risk: 'low',
    priority: 'high',
    kind: 'initiative',
  },
  repos: [
    {
      project_id: 'project-1',
      repo_id: 'repo-1',
      default_branch: 'main',
      policy_status: 'missing',
    },
  ],
});
```

```ts
async specDraftGenerationContext(workItemId: string, input: { actionRunId: string; claimToken: string }) {
  this.calls.push({ method: 'specDraftGenerationContext', args: [workItemId, input] });
  return specDraftContext();
}

async ensureSpecDraft(workItemId: string, input: EnsureSpecDraftCommandInput) {
  this.calls.push({ method: 'ensureSpecDraft', args: [workItemId, input] });
  return { status: 'created', spec_id: 'spec-1', spec_revision_id: 'spec-revision-1' };
}
```

Update the local `commandPreconditionFor` helper to return `canGenerateSpecDraft` for `ensure_spec_draft` actions, `canGeneratePlanDraft` for plan draft actions, and `canGeneratePackageDrafts` for package draft actions so the expected precondition fingerprint stays aligned with the production executor.

Add an HTTP client parser test in `tests/automation/planner.test.ts` near existing wire tests:

```ts
expect(snapshot.workItemsRequiringSpec[0]).toMatchObject({
  targetObjectType: 'work_item',
  targetObjectId: 'work-item-1',
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm vitest run --pool=forks --no-file-parallelism --maxWorkers=1 tests/automation/planner.test.ts tests/automation/executor.test.ts
```

Expected: FAIL because types/client methods and parser fields do not exist.

- [ ] **Step 3: Add generation types**

First update `packages/automation/package.json` to add the workspace dependency on `@forgeloop/contracts`, then make the type imports below compile.
If `pnpm-lock.yaml` changes, include it in the same commit.

In `packages/automation/src/types.ts`, add:

```ts
export type AutomationActionType =
  | 'ensure_spec_draft'
  | 'ensure_plan_draft'
  | 'ensure_package_drafts'
  | 'request_manual_path'
  | 'project_runtime_snapshot';

export interface GeneratedSpecDraftV1 {
  schema_version: 'spec_draft.v1';
  summary: string;
  content: string;
  background: string;
  goals: string[];
  scope_in: string[];
  scope_out: string[];
  acceptance_criteria: string[];
  risk_notes: string[];
  test_strategy_summary: string;
  structured_document?: Record<string, unknown>;
}

export interface AutomationGenerationRepoContextV1 {
  project_id: string;
  repo_id: string;
  default_branch: string;
  policy_status: 'missing' | 'loaded' | 'parse_failed' | 'unsafe_path';
  policy_digest?: string;
  parser_version?: string;
  package_manager?: string;
  workspace_summary?: string;
}

export interface AutomationGenerationWorkItemContextV1 {
  context_version: 'generation_context.work_item.v1';
  action_run_id: string;
  work_item: {
    id: string;
    project_id: string;
    title: string;
    goal: string;
    success_criteria: string[];
    risk?: string;
    priority?: string;
    kind?: string;
  };
  repos: AutomationGenerationRepoContextV1[];
}

export interface EnsureSpecDraftCommandInput {
  action_run_id: string;
  claim_token?: string;
  idempotency_key: string;
  automation_precondition: AutomationPrecondition;
  generated_spec_draft: GeneratedSpecDraftV1;
  generation_artifacts: import('@forgeloop/contracts').ArtifactRef[];
}
```

Extend `RuntimeSnapshot`:

```ts
workItemsRequiringSpec: RuntimeSnapshotTarget[];
```

Extend `AutomationExecutorClient`:

```ts
specDraftGenerationContext(
  workItemId: string,
  input: { actionRunId: string; claimToken: string },
): Promise<AutomationGenerationWorkItemContextV1>;
ensureSpecDraft(workItemId: string, input: EnsureSpecDraftCommandInput): Promise<unknown>;
```

- [ ] **Step 4: Create fake/disabled generator module**

Create `packages/automation/src/spec-draft-generation.ts`:

```ts
import type { ArtifactRef } from '@forgeloop/contracts';
import type { AutomationGenerationWorkItemContextV1, GeneratedSpecDraftV1 } from './types.js';

export const specDraftPromptVersion = 'spec-draft.fake.v1';
export const specDraftOutputSchemaVersion = 'spec_draft.v1';

export type AutomationGenerationMode = 'disabled' | 'fake';

export interface GeneratedSpecDraftResult {
  generated: unknown;
  generationArtifacts: ArtifactRef[];
}

export interface SpecDraftGenerator {
  readonly mode: AutomationGenerationMode;
  generateSpecDraft(context: AutomationGenerationWorkItemContextV1): Promise<GeneratedSpecDraftResult>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const stringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => nonBlank(entry));

export const validateGeneratedSpecDraft = (value: unknown): GeneratedSpecDraftV1 => {
  if (!isRecord(value) || value.schema_version !== 'spec_draft.v1') {
    throw new Error('generated_spec_draft_invalid');
  }
  if (
    !nonBlank(value.summary) ||
    !nonBlank(value.content) ||
    !nonBlank(value.background) ||
    !stringList(value.goals) ||
    !stringList(value.scope_in) ||
    !stringList(value.scope_out) ||
    !stringList(value.acceptance_criteria) ||
    !stringList(value.risk_notes) ||
    !nonBlank(value.test_strategy_summary) ||
    (value.structured_document !== undefined && !isRecord(value.structured_document))
  ) {
    throw new Error('generated_spec_draft_invalid');
  }
  return value as unknown as GeneratedSpecDraftV1;
};

export const disabledSpecDraftGenerator: SpecDraftGenerator = {
  mode: 'disabled',
  async generateSpecDraft(): Promise<GeneratedSpecDraftResult> {
    throw new Error('generation_disabled');
  },
};

export const createFakeSpecDraftGenerator = (): SpecDraftGenerator => ({
  mode: 'fake',
  async generateSpecDraft(context) {
    const workItem = context.work_item;
    return {
      generated: {
        schema_version: 'spec_draft.v1',
        summary: `Draft spec for ${workItem.title}`,
        content: [
          `Goal: ${workItem.goal}`,
          `Success criteria: ${workItem.success_criteria.join('; ')}`,
          'Scope: implement only the delivery behavior needed for this work item.',
          'Test strategy: cover command flow and persisted evidence.',
        ].join('\n\n'),
        background: workItem.goal,
        goals: [workItem.goal],
        scope_in: [`Deliver ${workItem.title}`],
        scope_out: ['Release, deploy, and non-delivery workflows'],
        acceptance_criteria: [...workItem.success_criteria],
        risk_notes: workItem.risk === undefined || workItem.risk.trim().length === 0 ? [] : [workItem.risk],
        test_strategy_summary: `Validate ${workItem.title} with API and daemon tests.`,
        structured_document: {
          generated_by: 'fake_spec_draft_generator',
          prompt_version: specDraftPromptVersion,
          output_schema_version: specDraftOutputSchemaVersion,
          work_item_id: workItem.id,
        },
      },
      generationArtifacts: [],
    };
  },
});
```

- [ ] **Step 5: Parse HTTP wire fields**

In `packages/automation/src/http-client.ts`:

Add `workItemsRequiringSpec: targets(snapshot.work_items_requiring_spec)` before `workItemsRequiringPlan`.

Add:

```ts
async specDraftGenerationContext(workItemId: string, input: { actionRunId: string; claimToken: string }) {
  const query = new URLSearchParams({
    action_run_id: input.actionRunId,
    claim_token: input.claimToken,
  });
  return this.request(
    'GET',
    `/internal/automation/generation-context/work-items/${workItemId}/spec-draft?${query.toString()}`,
  ) as Promise<AutomationGenerationWorkItemContextV1>;
}

async ensureSpecDraft(workItemId: string, input: EnsureSpecDraftCommandInput) {
  return this.request('POST', `/internal/automation/work-items/${workItemId}/ensure-spec-draft`, input);
}
```

Use explicit imports for the new input/context types.

- [ ] **Step 6: Export new helpers**

If `packages/automation/src/index.ts` has explicit exports, add:

```ts
export * from './spec-draft-generation.js';
```

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm vitest run --pool=forks --no-file-parallelism --maxWorkers=1 tests/automation/planner.test.ts tests/automation/executor.test.ts
```

Expected: PASS for type/parser coverage added in this task, even though planner/executor behavior for `ensure_spec_draft` may still be pending in later tasks if tests are staged narrowly.

- [ ] **Step 8: Commit**

```bash
git add packages/automation/package.json pnpm-lock.yaml packages/automation/src/spec-draft-generation.ts packages/automation/src/types.ts packages/automation/src/http-client.ts packages/automation/src/index.ts tests/automation/planner.test.ts tests/automation/executor.test.ts
git commit -m "feat: add spec draft generation wire types"
```

---

### Task 4: Planner and Idempotency for `ensure_spec_draft`

**Files:**
- Modify: `packages/automation/src/idempotency.ts`
- Modify: `packages/automation/src/planner.ts`
- Test: `tests/automation/idempotency.test.ts`
- Test: `tests/automation/planner.test.ts`

- [ ] **Step 1: Write failing idempotency tests**

In `tests/automation/idempotency.test.ts`, assert that Spec generation identity includes mode, prompt version, and schema version:

```ts
const base = {
  actionType: 'ensure_spec_draft' as const,
  targetObjectType: 'work_item',
  targetObjectId: 'work-item-1',
  automationScope: 'repo:project-1:repo-1' as const,
  automationSettingsVersion: 3,
  capabilityFingerprint: 'capability-1',
  preconditionFingerprint: 'precondition-1',
  generationMode: 'fake',
  promptVersion: 'spec-draft.fake.v1',
  outputSchemaVersion: 'spec_draft.v1',
};

expect(mutatingActionIdempotencyKey(base)).not.toBe(
  mutatingActionIdempotencyKey({ ...base, generationMode: 'codex' as never }),
);
expect(mutatingActionIdempotencyKey(base)).not.toBe(
  mutatingActionIdempotencyKey({ ...base, promptVersion: 'spec-draft.fake.v2' }),
);
```

- [ ] **Step 2: Write failing planner tests**

In `tests/automation/planner.test.ts`, add:

```ts
it('emits ensure_spec_draft before downstream draft actions when fake generation is enabled', () => {
  const actions = planNextActions(
    baseSnapshot({
      workItemsRequiringSpec: [specWorkItemTarget()],
      workItemsRequiringPlan: [workItemTarget()],
      planRevisionsRequiringPackages: [packageTarget()],
    }),
    { specDraftGenerationMode: 'fake' },
  );

  expect(actions.map((action) => action.actionType).slice(0, 3)).toEqual([
    'ensure_spec_draft',
    'ensure_plan_draft',
    'ensure_package_drafts',
  ]);
  expect(actions[0]).toMatchObject({
    actionType: 'ensure_spec_draft',
    targetObjectType: 'work_item',
    targetObjectId: 'work-item-needs-spec',
    actionInputJson: { work_item_id: 'work-item-needs-spec' },
  });
});

it('does not emit ensure_spec_draft when generation is disabled', () => {
  expect(
    planNextActions(baseSnapshot({ workItemsRequiringSpec: [specWorkItemTarget()] }), {
      specDraftGenerationMode: 'disabled',
    }).map((action) => action.actionType),
  ).not.toContain('ensure_spec_draft');
});
```

Add suppression and ambiguity tests:

```ts
it('uses canGenerateSpecDraft when a Spec target needs manual path disambiguation', () => {
  const actions = planNextActions(
    baseSnapshot({ workItemsRequiringSpec: [specWorkItemTarget({ repoId: undefined, eligibleRepoIds: ['repo-1', 'repo-2'] })] }),
    { specDraftGenerationMode: 'fake' },
  );
  expect(actions[0]).toMatchObject({
    actionType: 'request_manual_path',
    actionInputJson: expect.objectContaining({ object_type: 'work_item' }),
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm vitest run --pool=forks --no-file-parallelism --maxWorkers=1 tests/automation/idempotency.test.ts tests/automation/planner.test.ts
```

Expected: FAIL because planner options and `ensure_spec_draft` identity fields do not exist.

- [ ] **Step 4: Extend idempotency identity**

In `packages/automation/src/types.ts`, extend `MutatingActionIdentity`:

```ts
promptVersion?: string;
outputSchemaVersion?: string;
generationMode?: string;
```

In `packages/automation/src/idempotency.ts`, include these fields in `mutatingActionIdentityJson`.

- [ ] **Step 5: Add planner options**

In `packages/automation/src/planner.ts`:

```ts
import {
  specDraftOutputSchemaVersion,
  specDraftPromptVersion,
  type AutomationGenerationMode,
} from './spec-draft-generation.js';

export interface AutomationPlannerOptions {
  specDraftGenerationMode?: AutomationGenerationMode;
}

const specDraftGenerationModeFor = (options?: AutomationPlannerOptions): AutomationGenerationMode =>
  options?.specDraftGenerationMode ?? 'disabled';
```

Change signature:

```ts
export const planNextActions = (snapshot: RuntimeSnapshot, options: AutomationPlannerOptions = {}): NextAction[] => {
```

- [ ] **Step 6: Add Spec action planning**

Generalize `mutatingActionForTarget` to accept `ensure_spec_draft`.

Use this action input:

```ts
const actionInputJson =
  actionType === 'ensure_spec_draft'
    ? ({ work_item_id: target.targetObjectId } satisfies ActionInputJson)
    : actionType === 'ensure_plan_draft'
      ? ({ work_item_id: target.targetObjectId, spec_revision_id: target.targetRevisionId ?? '' } satisfies ActionInputJson)
      : ({ plan_revision_id: target.targetObjectId, generation_key: generationKey ?? '' } satisfies ActionInputJson);
```

Only require `targetRevisionId` for `ensure_plan_draft`. Only require `generationKey` for `ensure_package_drafts`.

When building the Spec action idempotency key, add:

```ts
...(actionType === 'ensure_spec_draft'
  ? {
      generationMode: specDraftGenerationModeFor(options),
      promptVersion: specDraftPromptVersion,
      outputSchemaVersion: specDraftOutputSchemaVersion,
    }
  : {}),
```

Emit Spec actions before Plan actions:

```ts
const specDraftGenerationMode = specDraftGenerationModeFor(options);
if (specDraftGenerationMode !== 'disabled') {
  for (const target of snapshot.workItemsRequiringSpec) {
    const action = mutatingActionForTarget(
      snapshot,
      target,
      'ensure_spec_draft',
      'canGenerateSpecDraft',
      { specDraftGenerationMode },
    );
    if (action !== undefined) {
      actions.push(action);
    }
  }
}
```

Update `requestManualPathForAmbiguity` required capability:

```ts
const requiredCapability =
  target.targetObjectType === 'plan_revision'
    ? 'canGeneratePackageDrafts'
    : target.targetRevisionId === undefined
      ? 'canGenerateSpecDraft'
      : 'canGeneratePlanDraft';
```

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm vitest run --pool=forks --no-file-parallelism --maxWorkers=1 tests/automation/idempotency.test.ts tests/automation/planner.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/automation/src/idempotency.ts packages/automation/src/planner.ts packages/automation/src/types.ts tests/automation/idempotency.test.ts tests/automation/planner.test.ts
git commit -m "feat: plan spec draft automation actions"
```

---

### Task 5: Control-Plane DTOs and Runtime Snapshot Wire Contract

**Files:**
- Modify: `apps/control-plane-api/src/modules/automation/automation.dto.ts`
- Test: `tests/api/automation-runtime-snapshot.test.ts`

- [ ] **Step 1: Write failing API DTO/snapshot tests**

In `tests/api/automation-runtime-snapshot.test.ts`, add coverage that a WorkItem with repo `draft_only` automation appears in `body.work_items_requiring_spec`.

Use the existing setup helpers in the file. The assertion should be:

```ts
expect(body.work_items_requiring_spec).toContainEqual(
  expect.objectContaining({
    target_object_type: 'work_item',
    target_object_id: workItem.id,
    target_status: workItem.phase,
    project_id: workItem.project_id,
    repo_id: repo.repo_id,
  }),
);
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm vitest run --pool=forks --no-file-parallelism --maxWorkers=1 tests/api/automation-runtime-snapshot.test.ts
```

Expected: FAIL because the runtime snapshot DTO field does not exist.

- [ ] **Step 3: Add DTO schemas**

In `apps/control-plane-api/src/modules/automation/automation.dto.ts`:

Add action input schema:

```ts
const ensureSpecDraftActionInputSchema = z
  .object({
    work_item_id: nonBlankString,
  })
  .strict();
```

Add `ensure_spec_draft` to `createAutomationActionRunSchema`.

Add `canGenerateSpecDraft` to `automationPreconditionSchema.required_capability`.

Add generated Spec draft schema:

```ts
export const generatedSpecDraftSchema = z
  .object({
    schema_version: z.literal('spec_draft.v1'),
    summary: nonBlankString,
    content: nonBlankString,
    background: nonBlankString,
    goals: z.array(nonBlankString),
    scope_in: z.array(nonBlankString),
    scope_out: z.array(nonBlankString),
    acceptance_criteria: z.array(nonBlankString),
    risk_notes: z.array(nonBlankString).default([]),
    test_strategy_summary: nonBlankString,
    structured_document: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
```

Add command schema:

```ts
export const ensureSpecDraftCommandSchema = z
  .object({
    ...internalCommandBaseShape,
    generated_spec_draft: generatedSpecDraftSchema,
    generation_artifacts: z.array(artifactRefSchema).default([]),
  })
  .strict();
```

Export the inferred DTO for controller and service imports:

```ts
export type EnsureSpecDraftCommandDto = z.infer<typeof ensureSpecDraftCommandSchema>;
```

Add generation context query schema:

```ts
export const generationContextQuerySchema = z
  .object({
    action_run_id: nonBlankString,
    claim_token: nonBlankString,
  })
  .strict();
```

Update `safeActionInputJson` to recognize `ensure_spec_draft`.

- [ ] **Step 4: Add runtime snapshot DTO field**

Update `AutomationRuntimeSnapshotDto`:

```ts
work_items_requiring_spec: AutomationRuntimeSnapshotTargetDto[];
```

Update `toRuntimeSnapshotDto`:

```ts
work_items_requiring_spec: input.data.work_items_requiring_spec.map(toRuntimeSnapshotTargetDto),
```

- [ ] **Step 5: Run focused API tests**

Run:

```bash
pnpm vitest run --pool=forks --no-file-parallelism --maxWorkers=1 tests/api/automation-runtime-snapshot.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/control-plane-api/src/modules/automation/automation.dto.ts tests/api/automation-runtime-snapshot.test.ts
git commit -m "feat: expose spec draft automation wire contract"
```

---

### Task 6: Internal `ensure-spec-draft` Command

**Files:**
- Modify: `apps/control-plane-api/src/modules/automation/automation-command.service.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation.dto.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation.controller.ts`
- Test: `tests/api/automation-commands.test.ts`
- Test: `tests/api/automation-internal-auth.test.ts`

- [ ] **Step 1: Write failing command tests**

In `tests/api/automation-commands.test.ts`, add tests matching existing `ensure_plan_draft` command style:

1. Creates Spec and SpecRevision for a claimed `ensure_spec_draft` action.
2. Replays idempotently with the same command key.
3. Rejects when the WorkItem already has a current Spec revision.
4. Rejects when `automation_precondition.required_capability` is not `canGenerateSpecDraft`.
5. Rejects when the claim token/action type/action input does not match.
6. Persists `generation_artifacts` on the created `SpecRevision.artifact_refs` without exposing raw artifacts in action projection.

Use command payload:

```ts
const generatedSpecDraft = {
  schema_version: 'spec_draft.v1',
  summary: 'Generated spec summary',
  content: 'Generated spec content',
  background: 'Generated background',
  goals: ['Goal 1'],
  scope_in: ['Scope in'],
  scope_out: ['Scope out'],
  acceptance_criteria: ['Criterion 1'],
  risk_notes: ['Risk 1'],
  test_strategy_summary: 'Run API and daemon tests.',
  structured_document: { source: 'test' },
};
```

In `tests/api/automation-internal-auth.test.ts`, add auth protection for:

```text
POST /internal/automation/work-items/work-item-auth/ensure-spec-draft
```

- [ ] **Step 2: Run command tests to verify failure**

Run:

```bash
pnpm vitest run --pool=forks --no-file-parallelism --maxWorkers=1 tests/api/automation-commands.test.ts
```

Expected: FAIL because `ensureSpecDraftForClaimedAction` does not exist.

- [ ] **Step 3: Add command types**

In `automation-command.service.ts`, import `EnsureSpecDraftCommandDto` and add:

```ts
type EnsureSpecDraftResult = { spec_id: string; spec_revision_id: string; status: 'created' | 'existing' };
```

- [ ] **Step 4: Add claimed action entry point**

Add public method near `ensurePlanDraftForClaimedAction`:

```ts
async ensureSpecDraftForClaimedAction(workItemId: string, input: EnsureSpecDraftCommandDto): Promise<EnsureSpecDraftResult> {
  const precondition = normalizeAutomationPrecondition(input.automation_precondition as AutomationPrecondition);
  await this.assertActiveActionClaim({
    actionRunId: input.action_run_id,
    claimToken: input.claim_token ?? '',
    actionType: 'ensure_spec_draft',
    targetObjectType: 'work_item',
    targetObjectId: workItemId,
    idempotencyKey: input.idempotency_key,
    automationSettingsVersion: precondition.automation_settings_version,
    capabilityFingerprint: precondition.capability_fingerprint,
    preconditionFingerprint: automationPreconditionFingerprint(precondition),
    actionInputJson: { work_item_id: workItemId },
    now: currentIsoTime(),
  });
  return this.ensureSpecDraftForWorkItem({
    workItemId,
    generated: input.generated_spec_draft,
    generationArtifacts: input.generation_artifacts,
    automationPrecondition: precondition,
    idempotencyKey: input.idempotency_key,
  });
}
```

- [ ] **Step 5: Add command boundary method**

Add private/public writer wrapper:

```ts
private async ensureSpecDraftForWorkItem(input: {
  workItemId: string;
  generated: EnsureSpecDraftCommandDto['generated_spec_draft'];
  generationArtifacts: EnsureSpecDraftCommandDto['generation_artifacts'];
  automationPrecondition: AutomationPrecondition;
  idempotencyKey: string;
}): Promise<EnsureSpecDraftResult> {
  const precondition = normalizeAutomationPrecondition(input.automationPrecondition);
  if (precondition.required_capability !== 'canGenerateSpecDraft') {
    throw new BadRequestException('ensureSpecDraftForWorkItem requires canGenerateSpecDraft precondition');
  }
  const preconditionFingerprint = automationPreconditionFingerprint(precondition);
  const actorScope = `${precondition.actor_class}:${precondition.daemon_identity ?? 'unknown'}`;
  const claimToken = randomUUID();
  const claimedAt = this.now();

  const outcome = await this.repository.withObjectLock(`work-item:${input.workItemId}`, async (repository) => {
    const claim = await repository.claimCommandIdempotency({
      id: this.id('command-idempotency'),
      command_name: 'ensure_spec_draft_for_work_item',
      idempotency_key: input.idempotencyKey,
      ...commandIdempotencyTarget({ objectType: 'work_item', objectId: input.workItemId }),
      precondition_json: precondition as unknown as Record<string, unknown>,
      precondition_fingerprint: preconditionFingerprint,
      actor_scope: actorScope,
      claim_token: claimToken,
      locked_until: this.lockedUntil(claimedAt),
      now: claimedAt,
    });
    const replayed = this.replayedSpecDraftResult(claim.result_json);
    const replayable = this.replayableCommandResultOrThrow(claim, replayed);
    if (replayable !== undefined) {
      return { ok: true as const, value: { ...replayable, status: 'existing' as const } };
    }

    try {
      const result = await this.writeSpecDraftForWorkItem(repository, input);
      await repository.completeCommandIdempotency({
        idempotency_key: input.idempotencyKey,
        claim_token: claimToken,
        result_json: result,
        finished_at: this.now(),
      });
      return { ok: true as const, value: result };
    } catch (error) {
      await this.blockCommandIdempotencyAfterError(repository, {
        idempotency_key: input.idempotencyKey,
        claim_token: claimToken,
        error,
      });
      return { ok: false as const, error };
    }
  });
  if (!outcome.ok) {
    throw outcome.error;
  }
  return outcome.value;
}
```

- [ ] **Step 6: Add Spec writer**

Add `writeSpecDraftForWorkItem`:

```ts
private async writeSpecDraftForWorkItem(
  repository: DeliveryRepository,
  input: {
    workItemId: string;
    generated: EnsureSpecDraftCommandDto['generated_spec_draft'];
    generationArtifacts: EnsureSpecDraftCommandDto['generation_artifacts'];
    automationPrecondition: AutomationPrecondition;
  },
): Promise<EnsureSpecDraftResult> {
  const precondition = normalizeAutomationPrecondition(input.automationPrecondition);
  const settings = await repository.resolveAutomationProjectSettings({
    project_id: precondition.project_id,
    ...(precondition.repo_id === undefined ? {} : { repo_id: precondition.repo_id }),
  });
  assertAutomationPreconditionStillCurrent(settings, precondition);
  assertCommandCapabilityStillEnabled(settings, 'canGenerateSpecDraft');
  await this.assertRepoScopeCurrent(repository, precondition.project_id, precondition.repo_id);

  const workItem = this.requireFound(await repository.getWorkItem(input.workItemId), `WorkItem ${input.workItemId}`);
  if (workItem.project_id !== precondition.project_id) {
    throw new ConflictException('WorkItem project does not match automation precondition');
  }
  if (isWorkItemAutomationTerminal(workItem)) {
    throw new UnprocessableEntityException({
      code: 'work_item_terminal',
      message: `WorkItem ${workItem.id} is terminal for automation.`,
    });
  }
  await assertNoActiveHolds(repository, [{ object_type: 'work_item', object_id: workItem.id }]);

  const existingSpec = workItem.current_spec_id === undefined ? undefined : await repository.getSpec(workItem.current_spec_id);
  if (existingSpec?.current_revision_id !== undefined) {
    throw new ConflictException('WorkItem already has a current Spec revision');
  }

  const createdAt = this.now();
  const spec =
    existingSpec ??
    (transitionSpecPlan(undefined, {
      type: 'create',
      entity_type: 'spec',
      id: this.id('spec'),
      work_item_id: workItem.id,
      at: createdAt,
    }) as Spec);

  if (existingSpec === undefined) {
    const currentWorkItem = this.requireFound(await repository.getWorkItem(workItem.id), `WorkItem ${workItem.id}`);
    if (currentWorkItem.current_spec_id !== undefined) {
      throw new ConflictException('WorkItem current spec changed before spec draft could be attached');
    }
    await repository.saveSpec(spec);
    await repository.saveWorkItem({ ...currentWorkItem, current_spec_id: spec.id, updated_at: spec.updated_at });
    await this.eventWithRepository(repository, 'spec', spec.id, 'spec_created', workItem.owner_actor_id, {
      work_item_id: workItem.id,
    });
  }

  const drafting = transitionSpecPlan(spec, { type: 'generate_draft_start', at: this.now() }) as Spec;
  await repository.saveSpec(drafting);
  await this.eventWithRepository(repository, 'spec', spec.id, 'spec_draft_generation_started', workItem.owner_actor_id, {
    work_item_id: workItem.id,
  });

  const revision: SpecRevision = {
    id: this.id('spec-revision'),
    spec_id: drafting.id,
    work_item_id: workItem.id,
    revision_number: (await repository.listSpecRevisions(drafting.id)).length + 1,
    summary: input.generated.summary,
    content: input.generated.content,
    background: input.generated.background,
    goals: input.generated.goals,
    scope_in: input.generated.scope_in,
    scope_out: input.generated.scope_out,
    acceptance_criteria: input.generated.acceptance_criteria,
    risk_notes: input.generated.risk_notes,
    test_strategy_summary: input.generated.test_strategy_summary,
    ...(input.generated.structured_document === undefined ? {} : { structured_document: input.generated.structured_document }),
    author_actor_id: precondition.daemon_identity ?? 'automation-spec-drafter',
    artifact_refs: input.generationArtifacts,
    created_at: this.now(),
  };
  await repository.saveSpecRevision(revision);

  const updated = transitionSpecPlan({ ...drafting, current_revision_id: revision.id }, {
    type: 'generate_draft_success',
    at: this.now(),
  }) as Spec;
  await repository.saveSpec(updated);
  await this.eventWithRepository(repository, 'spec_revision', revision.id, 'spec_draft_generated', revision.author_actor_id, {
    spec_id: updated.id,
    work_item_id: workItem.id,
  });

  return { spec_id: updated.id, spec_revision_id: revision.id, status: 'created' };
}
```

- [ ] **Step 7: Add replay helper**

```ts
private replayedSpecDraftResult(result: Record<string, unknown> | undefined): EnsureSpecDraftResult | undefined {
  if (
    result === undefined ||
    typeof result.spec_id !== 'string' ||
    typeof result.spec_revision_id !== 'string' ||
    (result.status !== 'created' && result.status !== 'existing')
  ) {
    return undefined;
  }
  return {
    spec_id: result.spec_id,
    spec_revision_id: result.spec_revision_id,
    status: result.status,
  };
}
```

- [ ] **Step 8: Add controller route**

In `automation.controller.ts`, import `ensureSpecDraftCommandSchema` and `EnsureSpecDraftCommandDto`, then add:

```ts
@Post('work-items/:workItemId/ensure-spec-draft')
ensureSpecDraft(
  @Param('workItemId') workItemId: string,
  @Body(new ZodValidationPipe(ensureSpecDraftCommandSchema)) body: EnsureSpecDraftCommandDto,
) {
  return this.automationCommandService.ensureSpecDraftForClaimedAction(workItemId, body);
}
```

- [ ] **Step 9: Run command and auth tests**

Run:

```bash
pnpm vitest run --pool=forks --no-file-parallelism --maxWorkers=1 tests/api/automation-commands.test.ts tests/api/automation-internal-auth.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/control-plane-api/src/modules/automation/automation-command.service.ts apps/control-plane-api/src/modules/automation/automation.dto.ts apps/control-plane-api/src/modules/automation/automation.controller.ts tests/api/automation-commands.test.ts tests/api/automation-internal-auth.test.ts
git commit -m "feat: add ensure spec draft automation command"
```

---

### Task 7: Signed Spec Draft Generation Context Endpoint

**Files:**
- Create: `apps/control-plane-api/src/modules/automation/automation-generation-context.service.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation.controller.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation.dto.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation.module.ts`
- Test: `tests/api/automation-commands.test.ts`
- Test: `tests/api/automation-internal-auth.test.ts`

- [ ] **Step 1: Write failing context endpoint tests**

In `tests/api/automation-commands.test.ts` or a new `describe('automation generation context')`, test:

- Valid signed GET with active claimed `ensure_spec_draft` action returns:

```ts
expect(body).toMatchObject({
  context_version: 'generation_context.work_item.v1',
  action_run_id: actionRun.id,
  work_item: {
    id: workItem.id,
    project_id: workItem.project_id,
    title: workItem.title,
    goal: workItem.goal,
    success_criteria: workItem.success_criteria,
    risk: workItem.risk,
    priority: workItem.priority,
    kind: workItem.kind,
  },
  repos: [
    expect.objectContaining({
      project_id: workItem.project_id,
      repo_id: repo.repo_id,
      default_branch: repo.default_branch,
      policy_status: 'missing',
    }),
  ],
});
expect(JSON.stringify(body)).not.toContain('claim-token');
```

- Wrong `claim_token` returns 409 with `automation_action_claim_conflict`.
- Action type `ensure_plan_draft` cannot fetch Spec context.
- `workItemId` mismatch returns 409.
- Repo context is scoped to the claimed action's repo automation scope; it must not return every project repo for a repo-scoped `ensure_spec_draft` action.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm vitest run --pool=forks --no-file-parallelism --maxWorkers=1 tests/api/automation-commands.test.ts tests/api/automation-internal-auth.test.ts
```

Expected: FAIL because generation context service does not exist.

- [ ] **Step 3: Add context DTOs**

In `automation.dto.ts`, export:

```ts
export type GenerationContextQueryDto = z.infer<typeof generationContextQuerySchema>;

export interface AutomationGenerationRepoContextV1 {
  project_id: string;
  repo_id: string;
  default_branch: string;
  policy_status: 'missing' | 'loaded' | 'parse_failed' | 'unsafe_path';
  policy_digest?: string;
  parser_version?: string;
  package_manager?: string;
  workspace_summary?: string;
}

export interface AutomationGenerationWorkItemContextV1 {
  context_version: 'generation_context.work_item.v1';
  action_run_id: string;
  work_item: {
    id: string;
    project_id: string;
    title: string;
    goal: string;
    success_criteria: string[];
    risk?: string;
    priority?: string;
    kind?: string;
  };
  repos: AutomationGenerationRepoContextV1[];
}
```

- [ ] **Step 4: Implement generation context service**

Create `automation-generation-context.service.ts`:

```ts
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DomainError } from '@forgeloop/domain';
import type { DeliveryRepository } from '@forgeloop/db';
import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import type { AutomationGenerationWorkItemContextV1, GenerationContextQueryDto } from './automation.dto';

const claimConflictBody = {
  code: 'automation_action_claim_conflict',
  message: 'Automation action claim is not active.',
};

const isAtOrBefore = (left: string, right: string): boolean => Date.parse(left) <= Date.parse(right);

const repoIdFromAutomationScope = (automationScope: string): string | undefined => {
  const [scopeType, , repoId, extra] = automationScope.split(':');
  return scopeType === 'repo' && repoId !== undefined && extra === undefined ? repoId : undefined;
};

const currentIsoTime = (): string => {
  const testNow = process.env.NODE_ENV === 'test' ? process.env.FORGELOOP_AUTOMATION_TEST_NOW?.trim() : undefined;
  return testNow === undefined || testNow.length === 0 ? new Date().toISOString() : new Date(testNow).toISOString();
};

@Injectable()
export class AutomationGenerationContextService {
  constructor(@Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository) {}

  async getSpecDraftContext(workItemId: string, query: GenerationContextQueryDto): Promise<AutomationGenerationWorkItemContextV1> {
    const action = await this.getActiveClaim(query.action_run_id, query.claim_token);
    const mismatched =
      action.action_type !== 'ensure_spec_draft' ||
      action.target_object_type !== 'work_item' ||
      action.target_object_id !== workItemId ||
      action.action_input_json.work_item_id !== workItemId;
    if (mismatched) {
      throw new ConflictException(claimConflictBody);
    }

    const workItem = await this.repository.getWorkItem(workItemId);
    if (workItem === undefined) {
      throw new NotFoundException(`WorkItem ${workItemId}`);
    }
    const scopedRepoId = repoIdFromAutomationScope(action.automation_scope);
    const repos = (await this.repository.listProjectRepos(workItem.project_id))
      .filter((repo) => repo.status === 'active' && (scopedRepoId === undefined || repo.repo_id === scopedRepoId))
      .map((repo) => ({
        project_id: repo.project_id,
        repo_id: repo.repo_id,
        default_branch: repo.default_branch,
        policy_status: 'missing' as const,
      }));
    if (scopedRepoId !== undefined && repos.length === 0) {
      throw new ConflictException(claimConflictBody);
    }

    return {
      context_version: 'generation_context.work_item.v1',
      action_run_id: action.id,
      work_item: {
        id: workItem.id,
        project_id: workItem.project_id,
        title: workItem.title,
        goal: workItem.goal,
        success_criteria: workItem.success_criteria,
        risk: workItem.risk,
        priority: workItem.priority,
        kind: workItem.kind,
      },
      repos,
    };
  }

  private async getActiveClaim(actionRunId: string, claimToken: string) {
    try {
      const action = await this.repository.getClaimedAutomationActionRun({ id: actionRunId, claim_token: claimToken });
      if (action.locked_until === undefined || isAtOrBefore(action.locked_until, currentIsoTime())) {
        throw new ConflictException(claimConflictBody);
      }
      return action;
    } catch (error) {
      if (error instanceof DomainError && error.code === 'INVALID_TRANSITION') {
        throw new ConflictException(claimConflictBody);
      }
      throw error;
    }
  }
}
```

If `ProjectRepo.default_branch` is optional in the domain type, default to `'main'` only when existing repository creation already does the same elsewhere. Otherwise preserve the stored field.

- [ ] **Step 5: Register service and controller**

In `automation.module.ts`, add `AutomationGenerationContextService` to providers.

In `automation.controller.ts`, import `Query`, inject the service, and add:

```ts
@Get('generation-context/work-items/:workItemId/spec-draft')
specDraftGenerationContext(
  @Param('workItemId') workItemId: string,
  @Query(new ZodValidationPipe(generationContextQuerySchema)) query: GenerationContextQueryDto,
) {
  return this.automationGenerationContextService.getSpecDraftContext(workItemId, query);
}
```

- [ ] **Step 6: Run context tests**

Run:

```bash
pnpm vitest run --pool=forks --no-file-parallelism --maxWorkers=1 tests/api/automation-commands.test.ts tests/api/automation-internal-auth.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/control-plane-api/src/modules/automation/automation-generation-context.service.ts apps/control-plane-api/src/modules/automation/automation.controller.ts apps/control-plane-api/src/modules/automation/automation.dto.ts apps/control-plane-api/src/modules/automation/automation.module.ts tests/api/automation-commands.test.ts tests/api/automation-internal-auth.test.ts
git commit -m "feat: add spec draft generation context endpoint"
```

---

### Task 8: Executor Support for `ensure_spec_draft`

**Files:**
- Modify: `packages/automation/src/executor.ts`
- Modify: `packages/automation/src/types.ts`
- Modify: `packages/automation/src/spec-draft-generation.ts`
- Test: `tests/automation/executor.test.ts`

- [ ] **Step 1: Write failing executor tests**

In `tests/automation/executor.test.ts`, update the existing automation package import to include `executeActionRun` because the representative direct-run test calls it:

```ts
import {
  AutomationHttpError,
  executeActionRun,
  executeClaimedAction,
  type AutomationActionResponse,
  type AutomationActionRunRecord,
  type AutomationExecutorClient,
  type NextAction,
} from '../../packages/automation/src/index';
```

Add tests:

1. Claimed `ensure_spec_draft` with fake generator calls:
   - `specDraftGenerationContext`
   - `ensureSpecDraft`
   - `completeAction`
2. Command payload contains `generated_spec_draft.schema_version === 'spec_draft.v1'`, `generation_artifacts`, `automation_precondition.required_capability === 'canGenerateSpecDraft'`.
3. Disabled generator blocks with `generation_disabled` and does not call `ensureSpecDraft`.
4. Invalid generated Spec payload fails before `ensureSpecDraft` is called and returns public code `generated_spec_draft_invalid`.
5. Context endpoint transport failure maps through existing retry/failure handling without leaking prompt/raw data.

Representative test:

```ts
const action = claimedAction({
  actionType: 'ensure_spec_draft',
  targetObjectType: 'work_item',
  targetObjectId: 'work-item-1',
  targetRevisionId: undefined,
  targetStatus: 'triage',
  actionInputJson: { work_item_id: 'work-item-1' },
});
const result = await executeActionRun({
  client,
  action,
  actorId: 'daemon-actor',
  daemonIdentity: 'daemon-1',
  specDraftGenerator: createFakeSpecDraftGenerator(),
});

expect(result).toMatchObject({ status: 'succeeded' });
expect(client.calls.map((call) => call.method)).toEqual([
  'specDraftGenerationContext',
  'ensureSpecDraft',
  'completeAction',
]);
```

- [ ] **Step 2: Run executor tests to verify failure**

Run:

```bash
pnpm vitest run --pool=forks --no-file-parallelism --maxWorkers=1 tests/automation/executor.test.ts
```

Expected: FAIL because executor cannot parse or execute `ensure_spec_draft`.

- [ ] **Step 3: Extend executor input types**

In `packages/automation/src/executor.ts`:

```ts
import { disabledSpecDraftGenerator, validateGeneratedSpecDraft, type SpecDraftGenerator } from './spec-draft-generation.js';

export interface ExecuteClaimedActionInput {
  client: AutomationExecutorClient;
  action: NextAction;
  claimToken: string;
  actorId: string;
  daemonIdentity?: string;
  leaseMs?: number;
  specDraftGenerator?: SpecDraftGenerator;
}

export interface ExecuteActionRunInput {
  client: AutomationExecutorClient;
  action: AutomationActionRunRecord;
  actorId: string;
  daemonIdentity?: string;
  specDraftGenerator?: SpecDraftGenerator;
}
```

When `executeClaimedAction` calls `executeActionRun`, pass `specDraftGenerator`.

- [ ] **Step 4: Add parser and capability mapping**

Add:

```ts
type EnsureSpecDraftActionInput = {
  workItemId: string;
};

const parseEnsureSpecDraftInput = (action: AutomationActionRunRecord): EnsureSpecDraftActionInput => ({
  workItemId: requiredString(action.actionInputJson, 'work_item_id'),
});
```

Update `requiredCapabilityFor`:

```ts
if (action.actionType === 'ensure_spec_draft') {
  return 'canGenerateSpecDraft';
}
```

Update `commandConcurrencyTokenFor` if needed to leave Spec draft undefined; do not invent a generation key in Plan 1.

- [ ] **Step 5: Execute Spec draft action**

In `executeCommand`, before `ensure_plan_draft`:

```ts
if (action.actionType === 'ensure_spec_draft') {
  const actionInput = parseEnsureSpecDraftInput(action);
  const generator = input.specDraftGenerator ?? disabledSpecDraftGenerator;
  if (generator.mode === 'disabled') {
    throw new AutomationHttpError(422, { code: 'generation_disabled' }, 'Spec draft generation is disabled');
  }
  const context = await client.specDraftGenerationContext(actionInput.workItemId, {
    actionRunId: action.id,
    claimToken: action.claimToken ?? '',
  });
  const generated = await generator.generateSpecDraft(context);
  const generatedSpecDraft = validateGeneratedSpecDraft(generated.generated);
  await client.ensureSpecDraft(actionInput.workItemId, {
    action_run_id: action.id,
    ...(action.claimToken === undefined ? {} : { claim_token: action.claimToken }),
    idempotency_key: action.idempotencyKey,
    automation_precondition: precondition,
    generated_spec_draft: generatedSpecDraft,
    generation_artifacts: generated.generationArtifacts,
  });
  return;
}
```

Update error mapping so `generation_disabled` becomes blocked and non-retryable:

```ts
const isBlockedByGate = (code: string | undefined): boolean =>
  code === 'generation_disabled' ||
  code === 'generated_spec_draft_invalid' ||
  code === 'manual_path_hold_active' ||
  ...
```

Update `errorCode` or generation error handling so a thrown `Error('generated_spec_draft_invalid')` maps to public code `generated_spec_draft_invalid` instead of generic `transport_error`.

- [ ] **Step 6: Run executor tests**

Run:

```bash
pnpm vitest run --pool=forks --no-file-parallelism --maxWorkers=1 tests/automation/executor.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/automation/src/executor.ts packages/automation/src/types.ts packages/automation/src/spec-draft-generation.ts tests/automation/executor.test.ts
git commit -m "feat: execute spec draft automation actions"
```

---

### Task 9: Daemon Config and Loop Wiring

**Files:**
- Modify: `apps/automation-daemon/src/config.ts`
- Modify: `apps/automation-daemon/src/automation-daemon.ts`
- Modify: `apps/automation-daemon/src/main.ts`
- Test: `tests/automation/daemon.test.ts`

- [ ] **Step 1: Write failing daemon tests**

Update `baseSnapshot` in `tests/automation/daemon.test.ts` to include:

```ts
workItemsRequiringSpec: [],
```

Add these local helpers at the top of the file so the new test remains self-contained:

```ts
import { createFakeSpecDraftGenerator } from '../../packages/automation/src/index';
import type {
  AutomationGenerationWorkItemContextV1,
  EnsureSpecDraftCommandInput,
} from '../../packages/automation/src/index';

const validEnv = () => ({
  FORGELOOP_CONTROL_PLANE_URL: 'http://127.0.0.1:3000',
  FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'secret-1',
  FORGELOOP_AUTOMATION_DAEMON_IDENTITY: 'daemon-1',
  FORGELOOP_AUTOMATION_ACTOR_ID: 'actor-1',
  FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS: ['/workspace'].join(':'),
});

const claimedSpecAction = (overrides: Partial<AutomationActionRunRecord> = {}): AutomationActionRunRecord => ({
  id: 'spec-action-run-1',
  actionType: 'ensure_spec_draft',
  targetObjectType: 'work_item',
  targetObjectId: 'work-item-1',
  targetStatus: 'triage',
  idempotencyKey: 'spec-action-run-1-idempotency',
  automationScope: repoScope,
  automationSettingsVersion: 3,
  capabilityFingerprint: 'capability-fingerprint-1',
  preconditionFingerprint: 'precondition-fingerprint-1',
  actionInputJson: { work_item_id: 'work-item-1' },
  status: 'running',
  attempt: 1,
  claimToken: 'claim-token-1',
  ...overrides,
});

const daemonOptions = {
  actorId: 'daemon-actor',
  daemonIdentity: 'daemon-1',
  claimToken: 'claim-token-1',
  allowedRepoRoots: ['/workspace'],
  policyParserVersion: parserVersion,
  policyLoader: async () => loadedPolicy(),
  noClaimBackoffMs: 25,
  loopIntervalMs: 1_000,
};
```

Extend the `FakeDaemonClient` in this test file with the new Spec-generation methods before the daemon test cases:

```ts
async specDraftGenerationContext(
  workItemId: string,
  input: Record<string, unknown>,
): Promise<AutomationGenerationWorkItemContextV1> {
  this.calls.push({ method: 'specDraftGenerationContext', args: [workItemId, input] });
  return {
    context_version: 'generation_context.work_item.v1',
    action_run_id: 'action-run-1',
    work_item: {
      id: workItemId,
      project_id: 'project-1',
      title: 'Spec draft work item',
      goal: 'Ship the spec draft path',
      success_criteria: ['Draft spec exists'],
      risk: 'low',
      priority: 'high',
      kind: 'initiative',
    },
    repos: [
      {
        project_id: 'project-1',
        repo_id: 'repo-1',
        default_branch: 'main',
        policy_status: 'missing',
      },
    ],
  };
}

async ensureSpecDraft(workItemId: string, input: EnsureSpecDraftCommandInput): Promise<unknown> {
  this.calls.push({ method: 'ensureSpecDraft', args: [workItemId, input] });
  return { status: 'created', spec_id: 'spec-1', spec_revision_id: 'spec-revision-1' };
}
```

Add config tests:

```ts
expect(loadAutomationDaemonConfig(validEnv())).toMatchObject({
  codexAutomationGeneration: 'disabled',
});

expect(
  loadAutomationDaemonConfig({
    ...validEnv(),
    FORGELOOP_CODEX_AUTOMATION_GENERATION: 'fake',
  }),
).toMatchObject({
  codexAutomationGeneration: 'fake',
});

expect(() =>
  loadAutomationDaemonConfig({
    ...validEnv(),
    FORGELOOP_CODEX_AUTOMATION_GENERATION: 'codex',
  }),
).toThrow(/Plan 2/);
```

Add a run-once test where fake generation plans and executes a Spec action:

```ts
client.snapshot = baseSnapshot({
  workItemsRequiringSpec: [
    {
      targetObjectType: 'work_item',
      targetObjectId: 'work-item-1',
      targetStatus: 'triage',
      projectId: 'project-1',
      repoId: 'repo-1',
      automationScope: repoScope,
    },
  ],
});
client.actionToClaim = claimedSpecAction();

const daemon = new AutomationDaemon({
  ...daemonOptions,
  client,
  specDraftGenerationMode: 'fake',
  specDraftGenerator: createFakeSpecDraftGenerator(),
});

const result = await daemon.runOnce();
expect(result).toMatchObject({ plannedActionCount: 2, executed: { status: 'succeeded' } });
expect(client.calls.map((call) => call.method)).toEqual([
  'runtimeSnapshot',
  'createOrReplayAction',
  'createOrReplayAction',
  'claimNextAction',
  'specDraftGenerationContext',
  'ensureSpecDraft',
  'completeAction',
]);
```

- [ ] **Step 2: Run daemon tests to verify failure**

Run:

```bash
pnpm vitest run --pool=forks --no-file-parallelism --maxWorkers=1 tests/automation/daemon.test.ts
```

Expected: FAIL because config and daemon options do not exist.

- [ ] **Step 3: Extend config**

In `apps/automation-daemon/src/config.ts`:

```ts
import type { AutomationGenerationMode } from '@forgeloop/automation';

export interface AutomationDaemonConfig {
  ...
  codexAutomationGeneration: AutomationGenerationMode;
}

const generationModeEnv = (env: EnvLike): AutomationGenerationMode => {
  const raw = env.FORGELOOP_CODEX_AUTOMATION_GENERATION?.trim() ?? 'disabled';
  if (raw === 'disabled' || raw === 'fake') {
    return raw;
  }
  if (raw === 'codex') {
    throw new Error('FORGELOOP_CODEX_AUTOMATION_GENERATION=codex is introduced in Plan 2');
  }
  throw new Error('Invalid automation daemon config: FORGELOOP_CODEX_AUTOMATION_GENERATION must be disabled or fake');
};
```

Return `codexAutomationGeneration: generationModeEnv(env)`.

- [ ] **Step 4: Wire daemon planning and execution**

In `apps/automation-daemon/src/automation-daemon.ts`:

```ts
import { disabledSpecDraftGenerator, type AutomationGenerationMode, type SpecDraftGenerator } from '@forgeloop/automation';

export interface AutomationDaemonOptions {
  ...
  specDraftGenerationMode?: AutomationGenerationMode;
  specDraftGenerator?: SpecDraftGenerator;
}
```

Use:

```ts
const actions = planNextActions(snapshot, {
  specDraftGenerationMode: this.options.specDraftGenerationMode ?? 'disabled',
});
```

Pass to executor:

```ts
specDraftGenerator: this.options.specDraftGenerator ?? disabledSpecDraftGenerator,
```

- [ ] **Step 5: Wire main**

In `apps/automation-daemon/src/main.ts`:

```ts
import { createFakeSpecDraftGenerator, disabledSpecDraftGenerator } from '@forgeloop/automation';

const specDraftGenerator =
  config.codexAutomationGeneration === 'fake' ? createFakeSpecDraftGenerator() : disabledSpecDraftGenerator;
```

Pass `specDraftGenerationMode` and `specDraftGenerator` into `AutomationDaemon`.

- [ ] **Step 6: Run daemon tests**

Run:

```bash
pnpm vitest run --pool=forks --no-file-parallelism --maxWorkers=1 tests/automation/daemon.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/automation-daemon/src/config.ts apps/automation-daemon/src/automation-daemon.ts apps/automation-daemon/src/main.ts tests/automation/daemon.test.ts
git commit -m "feat: wire fake spec generation into automation daemon"
```

---

### Task 10: End-to-End API and Daemon Integration

**Files:**
- Modify: `tests/api/automation-daemon.integration.test.ts`
- Modify: `tests/smoke/automation-dogfood-script.test.ts` only if current smoke assertions enumerate completed generation actions.

- [ ] **Step 1: Write failing integration test**

In `tests/api/automation-daemon.integration.test.ts`, add a scenario:

- Seed WorkItem with no Spec.
- Enable repo automation preset `draft_only`.
- Run daemon once with fake Spec generator.
- Assert:
  - `ensure_spec_draft` action is created, claimed, and completed.
  - WorkItem now has `current_spec_id`.
  - Spec exists and status is `draft`.
  - Spec has `current_revision_id`.
  - SpecRevision content comes from fake generator.
  - No Plan or Package draft is generated in the same action execution unless the test explicitly runs further daemon iterations after human approval.

Expected action type sequence:

```ts
expect(completedActionRuns.map((action) => action.action_type)).toContain('ensure_spec_draft');
expect(completedActionRuns.map((action) => action.action_type)).not.toContain('enqueue_package_run');
```

- [ ] **Step 2: Run integration test to verify failure**

Run:

```bash
pnpm vitest run --pool=forks --no-file-parallelism --maxWorkers=1 tests/api/automation-daemon.integration.test.ts
```

Expected: FAIL until all prior wiring is complete.

- [ ] **Step 3: Update existing integration expectations**

Existing tests may expect initial pending action types:

```ts
const expectedInitialPendingActionTypes = ['ensure_plan_draft', 'project_runtime_snapshot'] as const;
```

Do not blindly add `ensure_spec_draft` to old tests. Only update scenarios whose seeded WorkItem has no Spec. Existing approved-Spec scenarios should continue to start at `ensure_plan_draft`.

- [ ] **Step 4: Update smoke assertions only if needed**

If `tests/smoke/automation-dogfood-script.test.ts` represents a full WorkItem-from-scratch fake loop, add `ensure_spec_draft` to expected completed action types. If it is intentionally testing the old approved-Spec dogfood script, leave it unchanged.

- [ ] **Step 5: Run integration and smoke tests**

Run:

```bash
pnpm vitest run --pool=forks --no-file-parallelism --maxWorkers=1 tests/api/automation-daemon.integration.test.ts tests/smoke/automation-dogfood-script.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/api/automation-daemon.integration.test.ts tests/smoke/automation-dogfood-script.test.ts
git commit -m "test: cover fake spec draft daemon loop"
```

---

### Task 11: Full Regression and Cleanup

**Files:**
- Verify all files touched in prior tasks.

- [ ] **Step 1: Search for prohibited scope creep**

Run:

```bash
git diff --name-only main...HEAD
```

Expected: no `apps/web` files, no `packages/codex-runtime`, no run enqueue implementation files outside incidental tests.

Run:

```bash
git diff --unified=0 main...HEAD -- packages apps tests | rg '^\+' | rg -v '^\+\+\+' | rg -n "enqueue_package_run|DOGFOOD_AUTORUN|packages/codex-runtime|generated_plan_draft|generated_package_drafts"
```

Expected:

- No matches in added implementation or test lines.
- `enqueue_package_run`, `DOGFOOD_AUTORUN`, `packages/codex-runtime`, `generated_plan_draft`, and `generated_package_drafts` only appear in docs or explicit non-goal/scope guard text, not implementation.

- [ ] **Step 2: Run focused automation suite**

Run:

```bash
pnpm vitest run --pool=forks --no-file-parallelism --maxWorkers=1 tests/domain/automation.test.ts tests/db/repository-contract.ts tests/db/automation-repository.test.ts tests/automation/idempotency.test.ts tests/automation/planner.test.ts tests/automation/executor.test.ts tests/automation/daemon.test.ts tests/api/automation-runtime-snapshot.test.ts tests/api/automation-commands.test.ts tests/api/automation-internal-auth.test.ts tests/api/automation-daemon.integration.test.ts tests/smoke/automation-dogfood-script.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 5: Inspect git state**

Run:

```bash
git status --short
```

Expected: only intentional files are modified, or clean if prior task commits were made.

- [ ] **Step 6: Final commit if cleanup changed files**

```bash
git add packages/domain/src/automation.ts \
  packages/db/src/repositories/delivery-repository.ts \
  packages/db/src/repositories/in-memory-delivery-repository.ts \
  packages/db/src/repositories/drizzle-delivery-repository.ts \
  packages/automation/package.json \
  pnpm-lock.yaml \
  packages/automation/src/spec-draft-generation.ts \
  packages/automation/src/types.ts \
  packages/automation/src/idempotency.ts \
  packages/automation/src/planner.ts \
  packages/automation/src/executor.ts \
  packages/automation/src/http-client.ts \
  packages/automation/src/index.ts \
  apps/automation-daemon/src/config.ts \
  apps/automation-daemon/src/automation-daemon.ts \
  apps/automation-daemon/src/main.ts \
  apps/control-plane-api/src/modules/automation/automation.dto.ts \
  apps/control-plane-api/src/modules/automation/automation.controller.ts \
  apps/control-plane-api/src/modules/automation/automation-command.service.ts \
  apps/control-plane-api/src/modules/automation/automation-generation-context.service.ts \
  apps/control-plane-api/src/modules/automation/automation.module.ts \
  tests/domain/automation.test.ts \
  tests/db/repository-contract.ts \
  tests/db/automation-repository.test.ts \
  tests/automation/idempotency.test.ts \
  tests/automation/planner.test.ts \
  tests/automation/executor.test.ts \
  tests/automation/daemon.test.ts \
  tests/api/automation-runtime-snapshot.test.ts \
  tests/api/automation-commands.test.ts \
  tests/api/automation-internal-auth.test.ts \
  tests/api/automation-daemon.integration.test.ts \
  tests/smoke/automation-dogfood-script.test.ts
git commit -m "chore: finalize spec draft automation foundation"
```

Skip this commit if there are no cleanup changes.

---

## Acceptance Checks

After all tasks:

- `draft_only` capability includes `canGenerateSpecDraft`.
- Older capability JSON without `canGenerateSpecDraft` normalizes to false.
- Runtime snapshot exposes `work_items_requiring_spec`.
- Planner emits `ensure_spec_draft` before `ensure_plan_draft` only when Spec generation mode is enabled.
- `ensure_spec_draft` action identity includes generation mode, prompt version, and output schema version.
- Daemon fake mode can execute WorkItem -> Spec draft through:
  - action claim;
  - generation-context GET;
  - fake generator;
  - signed internal `ensure-spec-draft` command;
  - action completion.
- Control plane is the only product-state writer.
- Generated Spec stays draft and is not submitted or approved automatically.
- Plan and Package commands are not converted to generated payloads in this plan.
- Package run enqueue remains disabled.

## Execution Handoff

Plan complete when this document has passed plan review. Recommended execution style: subagent-driven, one task per worker, with review between tasks. Use `superpowers:test-driven-development` inside implementation tasks and `superpowers:verification-before-completion` before claiming the branch is ready.
