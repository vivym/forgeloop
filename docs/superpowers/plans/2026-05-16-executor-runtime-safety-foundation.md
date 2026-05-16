# Executor Runtime Safety Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 executor runtime safety foundation so production/local Codex execution cannot bypass policy snapshots, path containment, structured command execution, hard-limit attestation, hook/check governance, artifact containment, or authoritative finalization.

**Architecture:** Runtime safety lives in `packages/executor` and is injected into run-worker/executor entry points through typed configuration. The control plane stores frozen package policy snapshots and projects sanitized blockers, while workflow finalization consumes sanitized runtime evidence without importing executor internals. The automation daemon remains PRD-first and `run_enqueue` stays disabled.

**Tech Stack:** TypeScript, Node.js `fs/path/crypto/child_process`, Zod, Vitest, NestJS, Drizzle ORM, pnpm workspaces, existing `@forgeloop/contracts`, `@forgeloop/domain`, `@forgeloop/db`, `@forgeloop/executor`, `@forgeloop/workflow`, `@forgeloop/run-worker`, and `@forgeloop/automation`.

---

## Required Reading

Before implementation, read:

- `docs/superpowers/specs/2026-05-16-executor-runtime-safety-foundation-design.md`
- `packages/executor/src/local-codex-preflight.ts`
- `packages/executor/src/local-codex-executor.ts`
- `packages/executor/src/local-codex-evidence.ts`
- `packages/executor/src/codex-exec-fallback-driver.ts`
- `packages/executor/src/codex-worktree.ts`
- `packages/executor/src/source-repo-guard.ts`
- `packages/run-worker/src/run-worker.ts`
- `packages/workflow/src/activities.ts`
- `packages/workflow/src/execution-finalizer.ts`
- `packages/domain/src/automation.ts`
- `packages/domain/src/types.ts`
- `packages/domain/src/validators.ts`
- `packages/contracts/src/executor.ts`
- `apps/executor-gateway/src/executor.service.ts`
- `apps/workflow-worker/src/worker.ts`
- `apps/control-plane-api/src/modules/automation/automation-command.service.ts`
- `apps/control-plane-api/src/modules/automation/runtime-snapshot.service.ts`
- `apps/control-plane-api/src/modules/automation/automation.dto.ts`
- `packages/db/src/repositories/delivery-repository.ts`
- `packages/db/src/repositories/in-memory-delivery-repository.ts`
- `packages/db/src/repositories/drizzle-delivery-repository.ts`
- `packages/automation/src/types.ts`
- `packages/automation/src/http-client.ts`
- `packages/automation/src/planner.ts`

Use @superpowers:test-driven-development for every code-changing task. Use @superpowers:verification-before-completion before claiming a task is complete.

## Scope And Stop Signs

- Do not enable daemon `run_enqueue`, `enqueue_package_run`, or equivalent planner output.
- Do not copy Symphony's product flow. ForgeLoop's PRD object model and approved spec remain authoritative.
- Do not create a generalized shell runner. Shell strings remain rejected except for the constrained legacy required-check renderer.
- Do not let `StructuredCommand` spawn processes. Only `ResourceGovernor` may launch subprocesses.
- Do not let production/local Codex run unless the primary executor process or app-server worker is governed or leased with an enforcing `run_execution` attestation.
- Do not let workflow-worker or executor-gateway remain a production/local Codex bypass.
- Do not let `@forgeloop/workflow` import `@forgeloop/executor`.
- Do not let subprocesses write directly to `artifact_root`. They may write only to `sandbox_output_root`, then executor imports through `ArtifactWriter`.
- Do not expose raw command text, stdout/stderr, sandbox output, local absolute paths, raw diff contents, env values, credentials, or hook/fallback diagnostics in public/automation projection DTOs.
- Do not allow `allowed_paths: []` unless `source_mutation_policy: no_source_changes`.
- Do not read live `WORKFLOW.md` for frozen packages at run time.

## File Structure

### Executor Safety Modules

- Create: `packages/executor/src/path-safety.ts`
  - Own canonical roots, repo-relative path validation, symlink escape classification, child-path enforcement, destructive operation containment, and artifact path containment.
- Create: `packages/executor/src/artifact-writer.ts`
  - Own all runtime artifact writes/imports, quota enforcement, visibility policy, redaction hooks, atomic writes, and no-follow containment.
- Create: `packages/executor/src/path-policy.ts`
  - Own POSIX repo-relative glob validation, effective policy intersection, forbidden precedence, rename old/new path evaluation, and declared/actual scope validation.
- Create: `packages/executor/src/runtime-policy.ts`
  - Own `WORKFLOW.md` front matter parsing, strict schema validation, defaults, canonical normalized payloads, stable digests, last-known-good reload behavior, and frozen snapshot construction helpers.
- Create: `packages/executor/src/structured-command.ts`
  - Own command spec/result types, legacy required-check rendering, materialization rules, executable/cwd/env/PATH validation, command digesting, and result parsing. It never spawns.
- Create: `packages/executor/src/runtime-safety-config.ts`
  - Own typed runtime safety configuration and explicit `FORGELOOP_EXECUTOR_*` env parsing.
- Create: `packages/executor/src/resource-limits.ts`
  - Own `ResourceLimitVector`, canonical limit digesting, hard maximum resolution, and scope-aware attestation validation helpers.
- Create: `packages/executor/src/resource-governor.ts`
  - Own `UnavailableResourceGovernor`, `ExternalSandboxResourceGovernor`, `TestOnlyMockResourceGovernor`, sandbox self-check, bootstrap/run command launch protocol, run leases, nonce tracking, process timeout, output caps, and sandbox result mapping.
- Create: `packages/executor/src/hook-runner.ts`
  - Own `before_run` fail-closed and `after_run` post-terminal diagnostics.
- Create: `packages/executor/src/required-check-runner.ts`
  - Own frozen structured required-check execution through the governor and artifact writer.
- Create: `packages/executor/src/authoritative-changed-files.ts`
  - Own strict NUL-delimited git changed-file derivation through the run governor.
- Modify: `packages/executor/src/index.ts`
  - Export the new modules.

### Executor Integrations

- Modify: `packages/executor/src/codex-worktree.ts`
  - Replace direct `git` command calls and unsafe cleanup with `PathSafety`, `StructuredCommand`, and bootstrap `ResourceGovernor`.
- Modify: `packages/executor/src/local-codex-preflight.ts`
  - Replace `execFile` command checks with structured/governed probes; consume frozen snapshot, effective path policy, hard-limit readiness, and `before_run` hooks.
- Modify: `packages/executor/src/local-codex-executor.ts`
  - Inject `ExecutorRuntimeSafetyConfig`, `ArtifactWriter`, `ResourceGovernor`, `HookRunner`, and primary executor governance.
- Modify: `packages/executor/src/local-codex-evidence.ts`
  - Remove shell `exec`, naive path checks, and ad hoc artifact writes; use `RequiredCheckRunner`, `ArtifactWriter`, `PathPolicy`, and authoritative changed-file evidence.
- Modify: `packages/executor/src/codex-exec-fallback-driver.ts`
  - Deny fallback unless frozen policy permits it; route fallback through `StructuredCommand` and `ResourceGovernor`.
- Modify: `packages/executor/src/codex-app-server-driver.ts`
  - Require sandbox lease for app-server primary execution.
- Modify: `packages/executor/src/codex-raw-log-store.ts`
  - Persist raw logs through `ArtifactWriter`.
- Modify: `packages/executor/src/source-repo-guard.ts`
  - Keep pure filesystem probes as Node APIs; move enforcement git subprocesses to safe git structured commands where needed.

### Domain And Contracts

- Modify: `packages/domain/src/automation.ts`
  - Extend `RuntimeSafetyAttestation` into `enqueue_preflight` and `run_execution` scope-aware shapes; extend `PackageRuntimePolicySnapshot`.
- Modify: `packages/domain/src/types.ts`
  - Add `source_mutation_policy` to `ExecutionPackage` and `RunSession.run_spec` flow compatibility.
- Modify: `packages/domain/src/validators.ts`
  - Enforce captured snapshot validity, safe-default rules, source mutation rules, and ready/run-eligible package blockers.
- Modify: `packages/domain/src/states.ts`
  - Preserve `source_mutation_policy` when creating packages and run sessions.
- Modify: `packages/contracts/src/executor.ts`
  - Add `source_mutation_policy` to `RunSpec`; change `allowed_paths` validation to allow `[]` only for `no_source_changes`; add runtime failure/blocker reason enums where contracts own wire data.
- Modify: `packages/db/src/schema/execution-package.ts`
  - Persist `source_mutation_policy`.
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
  - Preserve `source_mutation_policy` in package records.
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
  - Preserve `source_mutation_policy` in package records.

### Control Plane, DB, Automation Projection

- Modify: `apps/control-plane-api/src/p0/dto.ts`
  - Add optional `source_mutation_policy` to create/patch package DTOs.
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
  - Default omitted `source_mutation_policy` to `path_policy_scoped`; reject empty `allowed_paths` except no-source-change packages; capture extended snapshot fields in package creation helpers.
- Modify: `apps/control-plane-api/src/modules/automation/automation-command.service.ts`
  - Strengthen enqueue preflight attestation validation; keep daemon planner enqueue disabled.
- Modify: `apps/control-plane-api/src/p0/automation-command-helpers.ts`
  - Validate scope-aware `enqueue_preflight` attestations and reject `run_execution` attestations before RunSession creation.
- Modify: `packages/db/src/repositories/delivery-repository.ts`
  - Add `RuntimeSnapshotBlockerRow`; add `blockers?: RuntimeSnapshotBlockerRow[]` to `RuntimeSnapshotTargetRow`.
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
  - Derive deterministic runtime blockers at query time.
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
  - Derive the same runtime blockers from existing rows without a blocker table.
- Modify: `apps/control-plane-api/src/modules/automation/automation.dto.ts`
  - Add `AutomationRuntimeBlockerDto`; map sorted `blockers[]`; keep singular compatibility fields from first blocker.
- Modify: `apps/control-plane-api/src/modules/automation/runtime-snapshot.service.ts`
  - Compute/sort blockers and pass through DTO mapping.
- Modify: `packages/automation/src/types.ts`
  - Add `AutomationRuntimeBlocker` and `RuntimeSnapshotTarget.blockers`.
- Modify: `packages/automation/src/http-client.ts`
  - Preserve `blockers[]` while retaining singular aliases.
- Modify: `packages/automation/src/planner.ts`
  - Ignore runtime blockers for enqueue because enqueue remains disabled; maintain no run enqueue action tests.

### Run Worker And Workflow

- Modify: `packages/run-worker/src/run-worker.ts`
  - Load frozen snapshot before executor startup; prepare governed worktree; acquire `run_execution` attestation/lease; run preflight, `before_run`, primary execution, required checks, authoritative changed-file derivation, terminalization, `after_run`, and review finalization in spec order.
- Modify: `packages/run-worker/src/index.ts`
  - Export any new runtime safety input types needed by app wiring.
- Modify: `packages/workflow/src/execution-finalizer.ts`
  - Split `finalizePackageRunWithExecutorResult` into `terminalizePackageRunWithRuntimeEvidence` and `completePackageRunReviewFinalization`; keep a mock/test-only compatibility wrapper.
- Modify: `packages/workflow/src/activities.ts`
  - Build `RunSpec.source_mutation_policy`; fail closed or delegate production/local Codex to run-worker instead of legacy activity execution.
- Modify: `apps/workflow-worker/src/worker.ts`
  - Disable production/local Codex gateway adapter path unless routed through the new runtime safety boundary.
- Modify: `apps/executor-gateway/src/executor.service.ts`
  - Reject `local_codex` requests without valid `run_execution` attestation and runtime-safety routing metadata.

### Tests

- Create: `tests/executor/path-safety.test.ts`
- Create: `tests/executor/path-policy.test.ts`
- Create: `tests/executor/effective-path-policy.test.ts`
- Create: `tests/executor/runtime-policy.test.ts`
- Create: `tests/executor/runtime-safety-config.test.ts`
- Create: `tests/executor/structured-command.test.ts`
- Create: `tests/executor/resource-limits.test.ts`
- Create: `tests/executor/resource-governor.test.ts`
- Create: `tests/executor/artifact-writer.test.ts`
- Create: `tests/executor/hook-runner.test.ts`
- Create: `tests/executor/required-check-runner.test.ts`
- Create: `tests/executor/authoritative-changed-files.test.ts`
- Modify: `tests/executor/codex-worktree.test.ts`
- Modify: `tests/executor/local-codex-preflight.test.ts`
- Modify: `tests/executor/source-repo-guard.test.ts`
- Modify: `tests/run-worker/run-worker.test.ts`
- Modify: `tests/workflow/execution-finalizer.test.ts`
- Modify: `tests/workflow/package-execution-workflow.test.ts`
- Modify: `tests/workflow-worker/worker.test.ts`
- Modify: `tests/executor-gateway/executor-gateway.test.ts`
- Modify: `tests/api/automation-commands.test.ts`
- Create or modify: `tests/api/run-spec-validation.test.ts`
- Modify: `tests/api/automation-runtime-snapshot.test.ts`
- Modify: `tests/automation/planner.test.ts`
- Modify fixtures: `tests/helpers/p0-runtime-fixtures.ts`, `tests/executor/test-fixtures.ts`

## Task 0: Baseline Guardrails

**Files:**
- Read: all Required Reading files listed above
- Modify only if baseline tests require fixture drift notes: no source edits in this task

- [ ] **Step 1: Confirm clean planning state**

Run:

```bash
git status --short --branch
```

Expected: branch may be ahead from the spec commit; no unrelated dirty files. If unrelated files are dirty, leave them untouched and record them before implementing.

- [ ] **Step 2: Run baseline targeted tests**

Run:

```bash
pnpm test tests/executor/local-codex-preflight.test.ts tests/executor/codex-worktree.test.ts tests/workflow/execution-finalizer.test.ts tests/run-worker/run-worker.test.ts tests/api/automation-commands.test.ts tests/api/automation-runtime-snapshot.test.ts tests/automation/planner.test.ts
```

Expected: PASS before changes, or record exact existing failures in the task notes before starting.

- [ ] **Step 3: Confirm build baseline**

Run:

```bash
pnpm --filter @forgeloop/executor build
pnpm --filter @forgeloop/workflow build
pnpm --filter @forgeloop/run-worker build
pnpm --filter @forgeloop/control-plane-api build
```

Expected: all selected packages build.

## Task 1: Domain And Wire Contracts For Source Mutation And Attestation

**Files:**
- Modify: `packages/contracts/src/executor.ts`
- Modify: `packages/domain/src/automation.ts`
- Modify: `packages/domain/src/types.ts`
- Modify: `packages/domain/src/validators.ts`
- Modify: `packages/domain/src/states.ts`
- Modify: `packages/db/src/schema/execution-package.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Modify: `apps/control-plane-api/src/p0/dto.ts`
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation-command.service.ts`
- Modify: `apps/control-plane-api/src/p0/automation-command-helpers.ts`
- Modify: `tests/contracts/contracts.test.ts`
- Create or modify: `tests/api/run-spec-validation.test.ts`
- Modify: `tests/domain/automation.test.ts`
- Modify: `tests/domain/validators.test.ts`
- Modify: `tests/domain/states.test.ts`
- Modify: `tests/db/repository.test.ts`
- Modify: `tests/db/automation-repository.test.ts`
- Modify: `tests/api/automation-commands.test.ts`

- [ ] **Step 1: Write failing `RunSpec` conditional validation tests**

In `tests/api/run-spec-validation.test.ts`, add tests for:

```ts
expect(runSpecSchema.parse({ ...baseRunSpec, source_mutation_policy: 'no_source_changes', allowed_paths: [] }).allowed_paths).toEqual([]);
expect(() => runSpecSchema.parse({ ...baseRunSpec, allowed_paths: [] })).toThrow(/source_mutation_policy/i);
expect(() => runSpecSchema.parse({ ...baseRunSpec, source_mutation_policy: 'path_policy_scoped', allowed_paths: [] })).toThrow(/allowed_paths/i);
```

Also add a contract-level test in `tests/contracts/contracts.test.ts` proving `packages/contracts` does not import domain-only snapshot consistency logic.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm test tests/api/run-spec-validation.test.ts tests/contracts/contracts.test.ts
```

Expected: FAIL because `RunSpec.source_mutation_policy` does not exist and `allowed_paths` is still unconditional `.min(1)`.

- [ ] **Step 3: Add source mutation contract types**

In `packages/contracts/src/executor.ts`, add:

```ts
export const sourceMutationPolicySchema = z.enum(['path_policy_scoped', 'no_source_changes']);
export type SourceMutationPolicy = z.infer<typeof sourceMutationPolicySchema>;
```

Change `runSpecSchema` to include:

```ts
source_mutation_policy: sourceMutationPolicySchema.default('path_policy_scoped'),
allowed_paths: z.array(z.string().min(1)),
```

Then add `superRefine` checks:

```ts
if (runSpec.allowed_paths.length === 0 && runSpec.source_mutation_policy !== 'no_source_changes') {
  ctx.addIssue({
    code: 'custom',
    path: ['allowed_paths'],
    message: 'allowed_paths may be empty only when source_mutation_policy is no_source_changes',
  });
}
if (runSpec.source_mutation_policy === 'path_policy_scoped' && runSpec.allowed_paths.length === 0) {
  ctx.addIssue({
    code: 'custom',
    path: ['source_mutation_policy'],
    message: 'path_policy_scoped packages require non-empty allowed_paths',
  });
}
```

- [ ] **Step 4: Add domain source mutation fields and snapshot extensions**

In `packages/domain/src/types.ts`, add to `ExecutionPackage`:

```ts
source_mutation_policy: 'path_policy_scoped' | 'no_source_changes';
```

In `packages/domain/src/automation.ts`, add:

```ts
export type RuntimeSafetyAttestationScope = 'enqueue_preflight' | 'run_execution';
export type NetworkMode = 'disabled' | 'egress_allowlist';
export type SourceMutationPolicy = 'path_policy_scoped' | 'no_source_changes';
export type PolicySnapshotOrigin = 'workflow_md' | 'reviewed_safe_default';
```

Extend `RuntimeSafetyAttestation` with optional scope-specific fields from the spec, preserving compatibility fields. Extend `PackageRuntimePolicySnapshot` with `snapshot_origin`, `normalized_policy_payload`, `workspace_policy`, `prompt_policy`, `artifact_visibility_policy`, policy digest fields, `safe_git_profile`, `safe_default_approval_evidence`, `frozen_command_check_policy`, `frozen_hook_specs`, and `source_mutation_policy`.

- [ ] **Step 5: Preserve source mutation in state transitions**

In `packages/domain/src/states.ts`, update every execution package creation/update path and every run-spec copy path to carry:

```ts
source_mutation_policy: input.source_mutation_policy ?? 'path_policy_scoped'
```

Add assertions in `tests/domain/states.test.ts` proving package creation, package update, run session creation, and run-spec persistence preserve `source_mutation_policy` instead of dropping it to the default.

- [ ] **Step 6: Add domain validator tests for no-source-change rules**

In `tests/domain/validators.test.ts`, add cases:

- ready package with `allowed_paths: []` and missing `source_mutation_policy` fails;
- ready package with `source_mutation_policy: path_policy_scoped` and `allowed_paths: []` fails;
- ready package with `source_mutation_policy: no_source_changes`, snapshot `source_mutation_policy: no_source_changes`, deny-all path policy, no hooks/fallback, and approval evidence passes;
- mismatch between package and snapshot source mutation policy fails.

- [ ] **Step 7: Implement validator rules**

In `packages/domain/src/validators.ts`, extend `validateExecutionPackagePolicy`:

```ts
const sourceMutationPolicy = executionPackage.source_mutation_policy ?? 'path_policy_scoped';
if (sourceMutationPolicy === 'path_policy_scoped' && executionPackage.allowed_paths.length === 0) {
  throw new DomainError('EXECUTION_PACKAGE_POLICY_INVALID', `Package ${executionPackage.id} requires allowed paths for source mutation.`, { execution_package_id: executionPackage.id });
}
if (executionPackage.package_policy_snapshot?.source_mutation_policy !== undefined &&
    executionPackage.package_policy_snapshot.source_mutation_policy !== sourceMutationPolicy) {
  throw new DomainError('EXECUTION_PACKAGE_POLICY_INVALID', `Package ${executionPackage.id} must align source mutation policy with its snapshot.`, { execution_package_id: executionPackage.id });
}
```

Add safe-default checks exactly from the spec: only missing `WORKFLOW.md`, `snapshot_origin: reviewed_safe_default`, non-empty `safe_default_approval_evidence`, deny-all path policy, `no_source_changes`, no hooks, fallback disabled, empty env allowlist, network disabled, and internal artifact defaults.

- [ ] **Step 8: Add scoped attestation tests**

In `tests/api/automation-commands.test.ts`, add cases:

- enqueue accepts only `attestation_scope: 'enqueue_preflight'`;
- enqueue rejects `run_execution`;
- enqueue rejects missing resource limit digest/vector, stale expiry, unavailable hard limits, mock-for-Codex, missing package ids/digests, or mismatched package version;
- enqueue does not require `run_id`, `workspace_root`, `artifact_root`, or `sandbox_output_root`.

- [ ] **Step 9: Implement scoped enqueue attestation validation**

In `apps/control-plane-api/src/p0/automation-command-helpers.ts`, change `assertRuntimeSafetyAttestation` to require:

```ts
attestation.attestation_scope === 'enqueue_preflight'
attestation.execution_package_id === expected.executionPackageId
attestation.expected_package_version === expected.packageVersion
attestation.resource_limit_digest.length > 0
attestation.resource_limits !== undefined
```

and reject `attestation_scope: 'run_execution'` for enqueue commands.

- [ ] **Step 10: Update create/patch DTO and service defaults**

In `apps/control-plane-api/src/p0/dto.ts`, accept optional `source_mutation_policy`.

In `apps/control-plane-api/src/p0/p0.service.ts`, default omitted policy to `path_policy_scoped`, reject empty `allowed_paths` unless `source_mutation_policy === 'no_source_changes'`, and persist the field in execution package creation/update paths.

- [ ] **Step 11: Persist source mutation policy**

In `packages/db/src/schema/execution-package.ts`, add:

```ts
sourceMutationPolicy: text('source_mutation_policy').$type<ExecutionPackage['source_mutation_policy']>().notNull().default('path_policy_scoped'),
```

Update in-memory and Drizzle repository mapping to round-trip `source_mutation_policy`. Existing fixture builders should set `source_mutation_policy: 'path_policy_scoped'` unless a test intentionally uses `no_source_changes`.

- [ ] **Step 12: Run focused tests**

Run:

```bash
pnpm test tests/api/run-spec-validation.test.ts tests/contracts/contracts.test.ts tests/domain/automation.test.ts tests/domain/validators.test.ts tests/domain/states.test.ts tests/db/repository.test.ts tests/db/automation-repository.test.ts tests/api/automation-commands.test.ts
```

Expected: PASS.

- [ ] **Step 13: Commit**

Run:

```bash
git add packages/contracts/src/executor.ts packages/domain/src/automation.ts packages/domain/src/types.ts packages/domain/src/validators.ts packages/domain/src/states.ts packages/db/src/schema/execution-package.ts packages/db/src/repositories/in-memory-delivery-repository.ts packages/db/src/repositories/drizzle-delivery-repository.ts apps/control-plane-api/src/p0/dto.ts apps/control-plane-api/src/p0/p0.service.ts apps/control-plane-api/src/modules/automation/automation-command.service.ts apps/control-plane-api/src/p0/automation-command-helpers.ts tests/contracts/contracts.test.ts tests/api/run-spec-validation.test.ts tests/domain/automation.test.ts tests/domain/validators.test.ts tests/domain/states.test.ts tests/db/repository.test.ts tests/db/automation-repository.test.ts tests/api/automation-commands.test.ts
git commit -m "feat: add runtime safety source mutation contracts"
```

## Task 2: PathSafety And ArtifactWriter Foundations

**Files:**
- Create: `packages/executor/src/path-safety.ts`
- Create: `packages/executor/src/artifact-writer.ts`
- Modify: `packages/executor/src/index.ts`
- Create: `tests/executor/path-safety.test.ts`
- Create: `tests/executor/artifact-writer.test.ts`

- [ ] **Step 1: Write failing PathSafety tests**

In `tests/executor/path-safety.test.ts`, cover:

- rejects empty, absolute, `..`, backslash, control bytes, and root-equivalent child paths;
- classifies ordinary outside-root as `workspace_path_escape`;
- classifies symlink escape as `workspace_symlink_escape`;
- validates artifact root separately from workspace root;
- operation-time destructive helper rejects a symlink race before `rm`.

Use this assertion shape:

```ts
await expect(pathSafety.resolveRepoRelativePath('../secret')).rejects.toMatchObject({ code: 'path_not_repo_relative' });
await expect(pathSafety.assertSafeChildPath('.')).rejects.toMatchObject({ code: 'workspace_equals_root' });
await expect(pathSafety.prepareDestructiveChildPath('link-out')).rejects.toMatchObject({ code: 'workspace_symlink_escape' });
```

- [ ] **Step 2: Run PathSafety tests and verify failure**

Run:

```bash
pnpm test tests/executor/path-safety.test.ts
```

Expected: FAIL because `path-safety.ts` does not exist.

- [ ] **Step 3: Implement PathSafety**

Create `packages/executor/src/path-safety.ts` with:

```ts
export type PathSafetyErrorCode =
  | 'workspace_path_escape'
  | 'workspace_symlink_escape'
  | 'workspace_equals_root'
  | 'path_contains_control_character'
  | 'path_not_repo_relative';

export class PathSafetyError extends Error {
  constructor(readonly code: PathSafetyErrorCode, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'PathSafetyError';
  }
}

export interface PathSafetyRoots {
  repoRoot: string;
  artifactRoot?: string;
  worktreeRoot?: string;
}

export class PathSafety {
  static async create(roots: PathSafetyRoots): Promise<PathSafety>;
  normalizeRepoRelativePath(input: string): string;
  resolveRepoRelativePath(input: string): Promise<string>;
  assertSafeChildPath(input: string): Promise<string>;
  prepareDestructiveChildPath(input: string): Promise<string>;
  artifactPath(input: string): Promise<string>;
  prepareArtifactWrite(input: string): Promise<{ finalPath: string; tempPath: string }>;
}
```

Implementation pins:

- use `realpath` on roots at construction;
- validate syntax before joining;
- resolve segments with `lstat`/`realpath` so symlink escapes are distinguishable;
- do not use recursive `rm` unless `prepareDestructiveChildPath` revalidated the candidate immediately before the operation;
- temp artifact writes stay under a validated parent and rename atomically within that parent.

- [ ] **Step 4: Write failing ArtifactWriter tests**

In `tests/executor/artifact-writer.test.ts`, cover:

- rejects artifact root overlapping repo root, `.git`, `.worktrees`, or package-controlled paths;
- writes through temp file and returns refs without absolute public paths;
- enforces per-artifact and per-run quotas;
- imports files only from `sandbox_output_root`;
- marks raw stdout/stderr/check/hook/fallback outputs internal by default.

- [ ] **Step 5: Run ArtifactWriter tests and verify failure**

Run:

```bash
pnpm test tests/executor/artifact-writer.test.ts
```

Expected: FAIL because `artifact-writer.ts` does not exist.

- [ ] **Step 6: Implement ArtifactWriter**

Create `packages/executor/src/artifact-writer.ts` with:

```ts
export type ArtifactVisibility = 'internal' | 'public_safe';

export interface ArtifactWriterPolicy {
  defaultVisibility: ArtifactVisibility;
  perArtifactByteLimit: number;
  perRunByteLimit: number;
  publicSafeKinds: readonly string[];
}

export interface ArtifactWriterInput {
  runSessionId: string;
  artifactRoot: string;
  repoRoot: string;
  worktreeRoot?: string;
  packageControlledPaths?: readonly string[];
  policy: ArtifactWriterPolicy;
}

export class ArtifactWriter {
  static async create(input: ArtifactWriterInput): Promise<ArtifactWriter>;
  writeText(input: { kind: ArtifactKind; name: string; contentType: string; content: string; visibility?: ArtifactVisibility }): Promise<ArtifactRef>;
  writeBytes(input: { kind: ArtifactKind; name: string; contentType: string; bytes: Uint8Array; visibility?: ArtifactVisibility }): Promise<ArtifactRef>;
  importSandboxOutput(input: { sandboxOutputRoot: string; relativePath: string; kind: ArtifactKind; name: string; contentType: string; visibility?: ArtifactVisibility }): Promise<ArtifactRef>;
}
```

Use `PathSafety.prepareArtifactWrite` for every write. Return internal refs as `local_ref` or future storage refs, but never surface local absolute paths in public-safe summaries.

- [ ] **Step 7: Export modules and run tests**

Modify `packages/executor/src/index.ts`:

```ts
export * from './path-safety.js';
export * from './artifact-writer.js';
```

Run:

```bash
pnpm test tests/executor/path-safety.test.ts tests/executor/artifact-writer.test.ts
pnpm --filter @forgeloop/executor build
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add packages/executor/src/path-safety.ts packages/executor/src/artifact-writer.ts packages/executor/src/index.ts tests/executor/path-safety.test.ts tests/executor/artifact-writer.test.ts
git commit -m "feat: add executor path and artifact safety"
```

## Task 3: PathPolicy And Effective Scope Validation

**Files:**
- Create: `packages/executor/src/path-policy.ts`
- Modify: `packages/executor/src/index.ts`
- Create: `tests/executor/path-policy.test.ts`
- Create: `tests/executor/effective-path-policy.test.ts`

- [ ] **Step 1: Write failing PathPolicy tests**

In `tests/executor/path-policy.test.ts`, add cases for unsafe pattern rejection, deny-all empty allowed paths, explicit `allow_all_repo`, forbidden precedence, rename `previous_path`, duplicate slashes, trailing whitespace, trailing slash directory normalization, dotfiles, globstar, negation, brace expansion, and extglob rejection.

Use this shape:

```ts
const policy = compilePathPolicy({ allowed_paths: ['src/**'], forbidden_paths: ['src/secrets/**'] });
expect(policy.evaluateChangedFile({ path: 'src/index.ts', change_kind: 'modified' })).toMatchObject({ allowed: true });
expect(policy.evaluateChangedFile({ path: 'src/secrets/key.ts', change_kind: 'modified' })).toMatchObject({ allowed: false, code: 'path_policy_actual_changes_rejected' });
```

- [ ] **Step 2: Write failing effective policy tests**

In `tests/executor/effective-path-policy.test.ts`, add cases proving:

- package allowed and repo allowed are intersected;
- package/repo forbidden paths are unioned;
- `allow_all_repo` in one layer does not bypass the other layer;
- same effective policy validates declared scope and actual changes;
- deny-all plus `no_source_changes` accepts no declared source mutations and rejects any actual changed file.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm test tests/executor/path-policy.test.ts tests/executor/effective-path-policy.test.ts
```

Expected: FAIL because `path-policy.ts` does not exist.

- [ ] **Step 4: Implement PathPolicy**

Create `packages/executor/src/path-policy.ts` with:

```ts
export interface RawPathPolicy {
  allowed_paths?: readonly string[];
  forbidden_paths?: readonly string[];
  allow_all_repo?: boolean;
}

export interface PathPolicyCompileOptions {
  validationStrategy: 'checks_required' | 'allow_all_repo' | 'custom';
  reviewedAllowAllRepo?: boolean;
  sourceMutationPolicy?: 'path_policy_scoped' | 'no_source_changes';
}

export interface ChangedPathInput {
  path: string;
  previous_path?: string;
  change_kind?: 'added' | 'modified' | 'deleted' | 'renamed';
}

export function compilePathPolicy(raw: RawPathPolicy, options?: PathPolicyCompileOptions): CompiledPathPolicy;
export function compileEffectivePathPolicy(input: {
  packagePolicy: RawPathPolicy;
  snapshotPolicy: RawPathPolicy;
  packageValidationStrategy: 'checks_required' | 'allow_all_repo' | 'custom';
  snapshotValidationStrategy: 'checks_required' | 'allow_all_repo' | 'custom';
  sourceMutationPolicy: 'path_policy_scoped' | 'no_source_changes';
}): CompiledPathPolicy;
```

Implementation pins:

- use explicit repo-relative POSIX matching, not filesystem access;
- reject absolute paths, empty paths, `.`, `..`, backslashes, control bytes, leading `!`, braces, extglob, and root-wide patterns unless reviewed `allow_all_repo`;
- case-sensitive, globstar-enabled, dotfile explicit, negation-disabled;
- forbidden wins over allowed;
- renamed files evaluate both `previous_path` and `path`.

- [ ] **Step 5: Export and run tests**

Modify `packages/executor/src/index.ts`:

```ts
export * from './path-policy.js';
```

Run:

```bash
pnpm test tests/executor/path-policy.test.ts tests/executor/effective-path-policy.test.ts
pnpm --filter @forgeloop/executor build
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/executor/src/path-policy.ts packages/executor/src/index.ts tests/executor/path-policy.test.ts tests/executor/effective-path-policy.test.ts
git commit -m "feat: add executor path policy validation"
```

## Task 4: Runtime Policy Loader And Frozen Snapshot Capture

**Files:**
- Create: `packages/executor/src/runtime-policy.ts`
- Modify: `packages/executor/src/index.ts`
- Modify: `packages/executor/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation-command.service.ts`
- Modify: `tests/helpers/p0-runtime-fixtures.ts`
- Create: `tests/executor/runtime-policy.test.ts`
- Modify: `tests/api/automation-commands.test.ts`
- Modify: `tests/domain/validators.test.ts`

- [ ] **Step 1: Write failing runtime policy tests**

In `tests/executor/runtime-policy.test.ts`, add cases:

- reads only repo-root `WORKFLOW.md`;
- rejects unsafe policy source paths;
- parses strict YAML front matter with only accepted top-level sections;
- rejects unknown top-level and unknown nested execution fields in execution mode;
- rejects `environment.allow` wildcard entries, secret-looking names such as `*_TOKEN`, `*_KEY`, `*_SECRET`, and dangerous runtime variables such as `PATH`, `NODE_OPTIONS`, `LD_PRELOAD`, `DYLD_*`, `GIT_CONFIG_*`, `GIT_ASKPASS`, `SSH_AUTH_SOCK`, `BASH_ENV`, and `ENV` unless reviewed evidence is present;
- rejects `codex.network_mode: egress_allowlist` unless `codex.egress_allowlist_digest` is frozen, and uses `network-disabled` for disabled network mode;
- applies defaults from the spec;
- computes stable `normalized_payload_digest`, `env_policy_digest`, `command_policy_digest`, `mount_policy_digest`, and `network_policy_digest`;
- preserves last-known-good on invalid reload;
- invalid initial execution load blocks.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm test tests/executor/runtime-policy.test.ts
```

Expected: FAIL because `runtime-policy.ts` does not exist.

- [ ] **Step 3: Implement strict runtime policy parser**

Add a YAML parser dependency before implementation:

```bash
pnpm --filter @forgeloop/executor add yaml
```

Expected: `packages/executor/package.json` and `pnpm-lock.yaml` include `yaml`. Use this dependency only for front matter parsing; strict execution schema validation remains in `runtime-policy.ts`.

Create `packages/executor/src/runtime-policy.ts` with:

```ts
export const RUNTIME_POLICY_PARSER_VERSION = 'executor-runtime-policy/v1';
export const RUNTIME_POLICY_SOURCE_PATH = 'WORKFLOW.md';

export interface RuntimePolicyDocument {
  codex?: { primary_executor?: 'cli' | 'app_server' | 'mock'; network_mode?: 'disabled' | 'egress_allowlist'; egress_allowlist_digest?: string };
  workspace?: { worktree_dir?: '.worktrees'; cleanup?: 'run_workspace_only' | 'disabled'; source_snapshot?: 'required' };
  path_policy?: { allowed_paths?: string[]; forbidden_paths?: string[]; allow_all_repo?: boolean };
  commands?: { trusted_toolchain: string; templates?: Record<string, StructuredCommandSpec>; default_timeout_ms?: number; default_output_limit_bytes?: number; safe_git_profile?: 'forgeloop_default' };
  environment?: { allow?: string[]; path_toolchain?: string };
  checks?: { required?: PolicyRequiredCheckSpec[] };
  hooks?: { before_run?: HookSpec[]; after_run?: HookSpec[] };
  fallback?: FallbackSpec;
  artifacts?: { default_visibility?: 'internal' | 'public_safe'; max_artifact_bytes?: number; max_run_artifact_bytes?: number; public_safe_kinds?: string[] };
  prompt_policy?: { include_workflow_body?: boolean; body_visibility?: 'internal' | 'public_safe' };
  observability?: { public_summary?: string };
}
```

Use a small front matter parser, strict object validation, stable JSON canonicalization, and `sha256:` digests.

- [ ] **Step 4: Implement frozen snapshot builder**

Add:

```ts
export function buildPackageRuntimePolicySnapshot(input: {
  loadedPolicy: LoadedRuntimePolicy;
  executionPackageChecks: readonly RequiredCheckSpec[];
  validationStrategy: 'checks_required' | 'allow_all_repo' | 'custom';
  sourceMutationPolicy: 'path_policy_scoped' | 'no_source_changes';
  validationEvidenceRefs?: readonly ArtifactRef[];
  safeDefaultApprovalEvidence?: ApprovalEvidenceRef;
}): PackageRuntimePolicySnapshot;
```

It must materialize structured check specs into `frozen_command_check_policy`, freeze hooks/fallback/codex/artifact/prompt/workspace sections, and store the normalized policy payload that `policy_digest` covers.

- [ ] **Step 5: Add required-check snapshot lifecycle tests**

In `tests/executor/runtime-policy.test.ts`, add cases for the required-check merge rules:

- every `ExecutionPackage.required_checks[]` entry appears in `frozen_command_check_policy.required_checks`;
- repo policy check with the same `check_id` may provide the structured command template but cannot change `display_name`, weaken `blocks_review`, or raise timeout above the package check timeout;
- package checks without matching repo policy checks render through the constrained legacy command renderer;
- legacy command rendering failure returns `required_check_command_invalid` and prevents package readiness;
- repo policy checks with new ids append as safety checks with `blocks_review: true` and `visibility: internal`;
- duplicate repo policy check ids invalidate the snapshot;
- incompatible duplicate package/policy metadata invalidates the snapshot.

- [ ] **Step 6: Implement required-check merge rules**

In `buildPackageRuntimePolicySnapshot`, construct `FrozenStructuredCheckPolicy` with this order:

1. iterate all package required checks and preserve package `check_id`, `display_name`, timeout, and `blocks_review`;
2. when a repo policy check has the same `check_id`, use only its structured command/template and only stricter timeout/output/visibility/write-policy overrides;
3. render unmatched package legacy command text with `legacyRequiredCheckToStructuredCommand`;
4. append repo-only safety checks after package checks;
5. reject duplicate ids, incompatible metadata, weakening `blocks_review`, timeout increases, missing templates, invalid structured specs, or legacy command renderer failures.

Return deterministic public blocker code `required_check_command_invalid` for legacy render failures and `policy_snapshot_invalid` for incompatible frozen policy structure.

- [ ] **Step 7: Add safe-default snapshot tests**

In `tests/executor/runtime-policy.test.ts` and `tests/domain/validators.test.ts`, add cases proving safe default is accepted only when `WORKFLOW.md` is missing and explicit human/admin/bootstrap approval evidence exists, with `source_mutation_policy: no_source_changes` and deny-all paths.

- [ ] **Step 8: Integrate capture paths without enabling enqueue**

In `apps/control-plane-api/src/p0/p0.service.ts` and `apps/control-plane-api/src/modules/automation/automation-command.service.ts`, update package generation helpers to fill the extended snapshot shape by calling `buildPackageRuntimePolicySnapshot`. Ready/run-eligible packages must have the new required fields; tests should use real snapshot fixture builders rather than hand-written partial snapshot objects.

- [ ] **Step 9: Run focused tests**

Run:

```bash
pnpm test tests/executor/runtime-policy.test.ts tests/domain/validators.test.ts tests/api/automation-commands.test.ts
pnpm --filter @forgeloop/executor build
pnpm --filter @forgeloop/control-plane-api build
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add packages/executor/package.json pnpm-lock.yaml packages/executor/src/runtime-policy.ts packages/executor/src/index.ts apps/control-plane-api/src/p0/p0.service.ts apps/control-plane-api/src/modules/automation/automation-command.service.ts tests/helpers/p0-runtime-fixtures.ts tests/executor/runtime-policy.test.ts tests/api/automation-commands.test.ts tests/domain/validators.test.ts
git commit -m "feat: capture frozen runtime policy snapshots"
```

## Task 5: StructuredCommand Foundation

**Files:**
- Create: `packages/executor/src/structured-command.ts`
- Modify: `packages/executor/src/index.ts`
- Create: `tests/executor/structured-command.test.ts`

- [ ] **Step 1: Write failing StructuredCommand tests**

In `tests/executor/structured-command.test.ts`, add cases:

- rejects shell strings, `shell: true`, absolute untrusted executables, unsafe cwd, unsafe env, command-local `PATH`, ambient PATH inheritance, unsafe PATH entries, writable toolchain roots, timeout/output caps above hard maxima, and missing exactly-one command/template fields;
- renders `pnpm test tests/executor` into executable `pnpm` plus args;
- rejects legacy commands with quotes, `$VAR`, `>`, `<`, `|`, `&&`, `;`, `*`, command substitution, env assignment prefixes, or absolute executable paths;
- proves `StructuredCommand` never calls `child_process.spawn`, `exec`, or `execFile`.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm test tests/executor/structured-command.test.ts
```

Expected: FAIL because `structured-command.ts` does not exist.

- [ ] **Step 3: Implement command types and validation**

Create `packages/executor/src/structured-command.ts` with:

```ts
export type Visibility = 'internal' | 'public_safe';
export type SourceWritePolicy = 'read_only' | 'path_policy_scoped' | 'artifact_only';
export type CwdPolicy = 'workspace_root' | { repo_relative: string };

export interface StructuredCommandSpec {
  executable: string;
  args: string[];
  cwd: CwdPolicy;
  timeout_ms?: number;
  output_limit_bytes?: number;
  env?: Record<string, string>;
  visibility?: Visibility;
  source_write_policy?: SourceWritePolicy;
}

export interface StructuredCommandResult {
  exit_code: number | null;
  timed_out: boolean;
  stdout_ref?: string;
  stderr_ref?: string;
  stdout_truncated: boolean;
  stderr_truncated: boolean;
  visibility: Visibility;
  public_summary: string;
  internal_diagnostic_ref?: string;
}
```

Add `validateStructuredCommandSpec`, `materializeCommandReference`, `legacyRequiredCheckToStructuredCommand`, `structuredCommandDigest`, and `structuredCommandResultFromGovernor`.

- [ ] **Step 4: Implement executable and env policy**

Validation rules:

- executable is logical name only unless a policy-approved relative executable path is explicitly supported later;
- deployment toolchain config resolves logical name to canonical absolute executable;
- trusted roots and parent directories must not be writable by the runtime/untrusted principal;
- child env starts empty;
- `PATH` is constructed only from trusted toolchain roots when required;
- dangerous variables from the spec are rejected by default;
- secret-looking env names are rejected unless reviewed evidence is present.

- [ ] **Step 5: Implement command materialization rules**

For `PolicyRequiredCheckSpec`, `HookSpec`, and fallback specs:

- exactly one of `command_template` or inline `command`;
- template exists in frozen command policy;
- overrides may only lower timeout/output cap, narrow visibility, or narrow source write policy;
- default write policy is read-only for checks/before-run/fallback and artifact-only for after-run.

- [ ] **Step 6: Export and run tests**

Modify `packages/executor/src/index.ts`:

```ts
export * from './structured-command.js';
```

Run:

```bash
pnpm test tests/executor/structured-command.test.ts
pnpm --filter @forgeloop/executor build
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add packages/executor/src/structured-command.ts packages/executor/src/index.ts tests/executor/structured-command.test.ts
git commit -m "feat: add structured executor commands"
```

## Task 6: Runtime Safety Config, Resource Limits, And Attestation Validation

**Files:**
- Create: `packages/executor/src/runtime-safety-config.ts`
- Create: `packages/executor/src/resource-limits.ts`
- Modify: `packages/domain/src/automation.ts`
- Modify: `packages/executor/src/index.ts`
- Create: `tests/executor/runtime-safety-config.test.ts`
- Create: `tests/executor/resource-limits.test.ts`
- Modify: `tests/api/automation-commands.test.ts`

- [ ] **Step 1: Write failing config tests**

In `tests/executor/runtime-safety-config.test.ts`, add cases:

- parser reads only explicit `FORGELOOP_EXECUTOR_*` keys;
- missing sandbox executable, sandbox config digest, trusted toolchain config, or artifact root selects unavailable governor config;
- rejects sandbox/toolchain/artifact paths under workspace, artifact, temp, writable, or package-controlled directories;
- does not inspect ambient `PATH`.

- [ ] **Step 2: Write failing resource limit tests**

In `tests/executor/resource-limits.test.ts`, add cases:

- stable `resource_limit_digest` over canonical `ResourceLimitVector`;
- changing any vector field changes digest;
- timeout/output caps cannot exceed hard maxima;
- production/local Codex enforcing attestation requires process-tree kill and every hard-limit dimension;
- missing hard limits map to `runtime_hard_limits_unavailable`.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm test tests/executor/runtime-safety-config.test.ts tests/executor/resource-limits.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement runtime safety config**

Create `packages/executor/src/runtime-safety-config.ts`:

```ts
export interface ExecutorRuntimeSafetyConfig {
  sandbox?: {
    executable_path: string;
    config_digest: string;
    config_path?: string;
    default_cpu_ms: number;
    default_memory_mb: number;
    default_pids: number;
    default_fds: number;
    default_workspace_bytes: number;
    default_artifact_bytes: number;
  };
  trusted_toolchains: Record<string, {
    root_paths: string[];
    executable_names: string[];
    config_digest: string;
  }>;
  artifact_root: string;
}

export function parseExecutorRuntimeSafetyConfigFromEnv(env: Record<string, string | undefined>): ExecutorRuntimeSafetyConfigParseResult;
```

Use explicit `FORGELOOP_EXECUTOR_SANDBOX_EXECUTABLE`, `FORGELOOP_EXECUTOR_SANDBOX_CONFIG_DIGEST`, `FORGELOOP_EXECUTOR_ARTIFACT_ROOT`, and a JSON encoded `FORGELOOP_EXECUTOR_TRUSTED_TOOLCHAINS` value. Do not read `PATH`.

- [ ] **Step 5: Implement resource limits and attestation helpers**

Create `packages/executor/src/resource-limits.ts`:

```ts
export interface ResourceLimitVector {
  cpu_ms: number;
  memory_mb: number;
  pids: number;
  fds: number;
  workspace_bytes: number;
  artifact_bytes: number;
  timeout_ms: number;
  output_limit_bytes: number;
  run_output_limit_bytes: number;
}

export function resourceLimitDigest(vector: ResourceLimitVector): string;
export function validateRunExecutionAttestation(input: { attestation: RuntimeSafetyAttestation; expected: RunExecutionAttestationBinding }): RuntimeSafetyValidationResult;
export function validateEnqueuePreflightAttestation(input: { attestation: RuntimeSafetyAttestation; expected: EnqueuePreflightAttestationBinding }): RuntimeSafetyValidationResult;
```

Bind all fields required by the spec: project, repo, package, run id for run execution, workspace root, artifact root, policy/env/command/mount/network/resource digests, sandbox identity/config, wrapper env digest, expiry, network mode, process-tree kill, filesystem containment, host-secret isolation, wrapper env isolation, and governor provenance.

- [ ] **Step 6: Wire enqueue helpers to shared validation**

Keep dependency direction clean: put pure scope-aware attestation shape validation in `packages/domain/src/automation.ts` as:

```ts
export function validateEnqueuePreflightAttestation(input: {
  attestation: RuntimeSafetyAttestation | undefined;
  expected: EnqueuePreflightAttestationBinding;
  now: string;
}): RuntimeSafetyAttestationValidationResult;
```

Then call that helper from `apps/control-plane-api/src/p0/automation-command-helpers.ts`. `packages/executor/src/resource-limits.ts` may wrap the same domain helper for executor startup, but control-plane must not import executor just to validate enqueue commands. Do not make `packages/contracts` import domain.

- [ ] **Step 7: Export and run tests**

Modify `packages/executor/src/index.ts`:

```ts
export * from './runtime-safety-config.js';
export * from './resource-limits.js';
```

Run:

```bash
pnpm test tests/executor/runtime-safety-config.test.ts tests/executor/resource-limits.test.ts tests/api/automation-commands.test.ts
pnpm --filter @forgeloop/executor build
pnpm --filter @forgeloop/control-plane-api build
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add packages/executor/src/runtime-safety-config.ts packages/executor/src/resource-limits.ts packages/domain/src/automation.ts packages/executor/src/index.ts apps/control-plane-api/src/p0/automation-command-helpers.ts tests/executor/runtime-safety-config.test.ts tests/executor/resource-limits.test.ts tests/api/automation-commands.test.ts
git commit -m "feat: add runtime safety config and attestations"
```

## Task 7: ResourceGovernor And External Sandbox Protocol

**Files:**
- Create: `packages/executor/src/resource-governor.ts`
- Modify: `packages/executor/src/index.ts`
- Create: `tests/executor/resource-governor.test.ts`

- [ ] **Step 1: Write failing governor tests**

In `tests/executor/resource-governor.test.ts`, add cases:

- `UnavailableResourceGovernor` always reports unavailable and rejects production/local Codex execution;
- `TestOnlyMockResourceGovernor` works only for `executor_type: mock` and `workflow_only: true`;
- external sandbox self-check uses canonical sandbox path, sanitized explicit env, trusted cwd, short timeout, bounded output, and no ambient `PATH`;
- self-check rejects timeout, non-JSON, oversized output, stderr-only failure, missing dimensions, missing process-tree kill, missing wrapper env isolation, missing filesystem containment, missing host-secret isolation, or network policy mismatch;
- bootstrap and run commands use different protocol arguments;
- run command binds command digest, resource-limit digest, cwd, env policy, timeout, output cap, visibility, source write policy, and fresh nonce;
- replayed command nonces are rejected while distinct commands under a valid lease work;
- primary local Codex is blocked when not governed.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm test tests/executor/resource-governor.test.ts
```

Expected: FAIL because `resource-governor.ts` does not exist.

- [ ] **Step 3: Implement governor interfaces**

Create `packages/executor/src/resource-governor.ts`:

```ts
export type GovernorScope = 'bootstrap' | 'run';

export interface ResourceGovernorRunInput {
  scope: GovernorScope;
  command: MaterializedStructuredCommand;
  bindings: BootstrapGovernorBindings | RunGovernorBindings;
}

export interface ResourceGovernor {
  readonly governorId: string;
  readonly provenance: 'external_sandbox' | 'test_only_mock' | 'unavailable';
  checkReadiness(input: ResourceGovernorReadinessInput): Promise<ResourceGovernorReadiness>;
  createRunExecutionAttestation(input: RunExecutionAttestationInput): Promise<RuntimeSafetyAttestation>;
  createRunLease?(input: SandboxLeaseInput): Promise<SandboxLease>;
  run(input: ResourceGovernorRunInput): Promise<StructuredCommandResult>;
}
```

- [ ] **Step 4: Implement unavailable and test-only mock governors**

Rules:

- unavailable returns `hard_limit_mode: unavailable`, reason `runtime_hard_limits_unavailable`;
- mock returns `hard_limit_mode: test_only_mock` only under mock workflow dogfood;
- mock cannot satisfy local Codex or production execution.

- [ ] **Step 5: Implement external sandbox self-check**

Launch:

```text
<sandbox> --forgeloop-self-check --json --config-digest <digest>
```

Use `execFile` or `spawn` only inside `resource-governor.ts`. Wrapper env starts empty. Wrapper cwd is `/` or a trusted non-writable runtime directory. Record wrapper env digest. Fail closed on any invalid output.

- [ ] **Step 6: Implement bootstrap command wrapping**

Build argv exactly from the spec:

```text
<sandbox> --forgeloop-bootstrap-run --json \
  --bootstrap-id <bootstrap_id> \
  --nonce <nonce> \
  --command-id <command_id> \
  --command-digest <command_digest> \
  --repo-root <canonical_repo_root> \
  --workspace-parent <canonical_worktree_parent> \
  --artifact-root <canonical_artifact_root> \
  --cwd <canonical_cwd> \
  --safe-git-profile forgeloop_default \
  --timeout-ms <milliseconds> \
  --output-limit-bytes <bytes> \
  -- <executable> <args...>
```

Every bootstrap invocation must generate and record a fresh nonce. Bootstrap commands cannot produce `run_execution` attestations and cannot receive runtime secrets.

- [ ] **Step 7: Implement run command wrapping and sandbox output import**

Build argv exactly from the spec, including `--resource-limit-digest`, every hard limit, network mode, visibility, and source write policy. Subprocesses may write only to `sandbox-output-root`; after completion, import allowed output files through `ArtifactWriter`.

- [ ] **Step 8: Implement app-server lease model**

Add `SandboxLease` exactly as the spec requires. Bind `prompt_digest`, `run_spec_digest`, policy/config digests, roots, resource limits, sandbox output root, lease expiry, and nonce requirement. Reject lease reuse after expiry or terminal run completion.

- [ ] **Step 9: Export and run tests**

Modify `packages/executor/src/index.ts`:

```ts
export * from './resource-governor.js';
```

Run:

```bash
pnpm test tests/executor/resource-governor.test.ts
pnpm --filter @forgeloop/executor build
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add packages/executor/src/resource-governor.ts packages/executor/src/index.ts tests/executor/resource-governor.test.ts
git commit -m "feat: add executor resource governor"
```

## Task 8: Safe Git Worktree And Authoritative Changed Files

**Files:**
- Create: `packages/executor/src/authoritative-changed-files.ts`
- Modify: `packages/executor/src/codex-worktree.ts`
- Modify: `packages/executor/src/source-repo-guard.ts`
- Modify: `packages/executor/src/index.ts`
- Create: `tests/executor/authoritative-changed-files.test.ts`
- Modify: `tests/executor/codex-worktree.test.ts`
- Modify: `tests/executor/source-repo-guard.test.ts`

- [ ] **Step 1: Write failing worktree safety tests**

In `tests/executor/codex-worktree.test.ts`, add cases:

- unsafe cleanup/removal path is rejected before `rm`;
- `.worktrees` root must be under canonical repo root;
- run workspace segment must match sanitized run-session id;
- git worktree commands are materialized as structured commands and executed through bootstrap governor;
- safe git profile disables config, hooks, prompts, credential helpers, external diff/textconv, fsmonitor, unsafe protocols, and submodule recursion;
- materialization disables clean/smudge/process filters and does not expose writable `.git`, common gitdir, refs, index, worktree metadata, or source snapshot metadata.

- [ ] **Step 2: Write failing authoritative changed-file tests**

In `tests/executor/authoritative-changed-files.test.ts`, cover:

- tracked changes use `git diff --name-status -z --find-renames --diff-filter=ACDMRTUXB <base_commit> --`;
- untracked/ignored use `git status --porcelain=v2 -z --untracked-files=all --ignored=matching`;
- rename old and new paths are returned;
- mode-only changes count;
- submodule path counts as changed;
- ignored directories are enumerated safely or fail closed with `changed_files_unavailable`;
- malformed git output, missing base commit, command failure, or parse failure returns `changed_files_unavailable`;
- all git commands go through run governor.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm test tests/executor/codex-worktree.test.ts tests/executor/authoritative-changed-files.test.ts tests/executor/source-repo-guard.test.ts
```

Expected: FAIL because existing worktree code calls `environment.runCommand` directly and changed files are not authoritative/NUL parsed.

- [ ] **Step 4: Refactor worktree API**

Change `preparePersistentGitWorktree` to accept:

```ts
{
  repoPath: string;
  baseRef: string;
  runSessionId: string;
  pathSafety: PathSafety;
  bootstrapGovernor: ResourceGovernor;
  commandPolicy: FrozenCommandPolicy;
  trustedToolchains: TrustedToolchainConfig;
}
```

Use `StructuredCommand` specs for `git worktree list`, `git worktree remove`, and worktree materialization. Use `PathSafety.prepareDestructiveChildPath` immediately before any removal.

- [ ] **Step 5: Implement safe git profile helper**

In `structured-command.ts` or `authoritative-changed-files.ts`, add `safeGitCommandSpec(input)` that injects safe git profile env/config controls and NUL-output expectations. The helper must not read repo/global/system config or permit hooks/prompts/credential helpers.

- [ ] **Step 6: Implement authoritative changed-file derivation**

Create `packages/executor/src/authoritative-changed-files.ts`:

```ts
export async function deriveAuthoritativeChangedFiles(input: {
  runSpec: RunSpec;
  workspaceRoot: string;
  baseCommit: string;
  runGovernor: ResourceGovernor;
  commandContext: StructuredCommandContext;
  pathSafety: PathSafety;
}): Promise<
  | { ok: true; changedFiles: ChangedFile[]; diagnosticRefs: ArtifactRef[] }
  | { ok: false; code: 'changed_files_unavailable'; summary: string; diagnosticRef?: ArtifactRef }
>;
```

Strictly parse NUL-delimited output. Treat executor-reported `changed_files` as advisory only outside this function.

- [ ] **Step 7: Export and run tests**

Modify `packages/executor/src/index.ts`:

```ts
export * from './authoritative-changed-files.js';
```

Run:

```bash
pnpm test tests/executor/codex-worktree.test.ts tests/executor/authoritative-changed-files.test.ts tests/executor/source-repo-guard.test.ts
pnpm --filter @forgeloop/executor build
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add packages/executor/src/authoritative-changed-files.ts packages/executor/src/codex-worktree.ts packages/executor/src/source-repo-guard.ts packages/executor/src/index.ts tests/executor/authoritative-changed-files.test.ts tests/executor/codex-worktree.test.ts tests/executor/source-repo-guard.test.ts
git commit -m "feat: govern worktree and changed file derivation"
```

## Task 9: HookRunner And RequiredCheckRunner

**Files:**
- Create: `packages/executor/src/hook-runner.ts`
- Create: `packages/executor/src/required-check-runner.ts`
- Modify: `packages/executor/src/index.ts`
- Create: `tests/executor/hook-runner.test.ts`
- Create: `tests/executor/required-check-runner.test.ts`

- [ ] **Step 1: Write failing hook tests**

In `tests/executor/hook-runner.test.ts`, cover:

- hook specs materialize from frozen snapshot only;
- hooks execute through `ResourceGovernor.run`;
- `before_run` non-zero maps to `before_run_hook_failed`;
- `before_run` timeout maps to `before_run_hook_timed_out`;
- `before_run` policy/governor errors fail closed;
- `after_run` failures record internal diagnostics but do not change terminal status or ReviewPacket eligibility;
- raw hook output is internal by default;
- `after_run` uses read-only source/artifact-output policy and skips with internal diagnostics if read-only enforcement is unavailable.

- [ ] **Step 2: Write failing required-check tests**

In `tests/executor/required-check-runner.test.ts`, cover:

- consumes `FrozenStructuredCheckPolicy`;
- runs checks after primary execution;
- non-zero maps to `required_check_failed`;
- timeout maps to `required_check_timed_out`;
- check stdout/stderr refs are written through `ArtifactWriter`;
- raw output internal by default;
- source-writing checks remain subject to final PathPolicy validation.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm test tests/executor/hook-runner.test.ts tests/executor/required-check-runner.test.ts
```

Expected: FAIL because runners do not exist.

- [ ] **Step 4: Implement HookRunner**

Create `packages/executor/src/hook-runner.ts`:

```ts
export interface HookRunner {
  runBeforeRun(input: HookRunInput): Promise<BeforeRunHookResult>;
  runAfterRun(input: AfterRunHookInput): Promise<AfterRunHookDiagnostics>;
}
```

Use `materializeCommandReference`, enforce `max_hook_timeout_ms`, route through run governor, and return sanitized reason codes only.

- [ ] **Step 5: Implement RequiredCheckRunner**

Create `packages/executor/src/required-check-runner.ts`:

```ts
export async function runRequiredChecks(input: {
  frozenCheckPolicy: FrozenStructuredCheckPolicy;
  runGovernor: ResourceGovernor;
  artifactWriter: ArtifactWriter;
  commandContext: StructuredCommandContext;
}): Promise<RequiredCheckRunResult>;
```

Return `CheckResult[]`, artifact refs, and sanitized blockers. Do not execute legacy `RequiredCheckSpec.command` strings directly.

- [ ] **Step 6: Export and run tests**

Modify `packages/executor/src/index.ts`:

```ts
export * from './hook-runner.js';
export * from './required-check-runner.js';
```

Run:

```bash
pnpm test tests/executor/hook-runner.test.ts tests/executor/required-check-runner.test.ts
pnpm --filter @forgeloop/executor build
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add packages/executor/src/hook-runner.ts packages/executor/src/required-check-runner.ts packages/executor/src/index.ts tests/executor/hook-runner.test.ts tests/executor/required-check-runner.test.ts
git commit -m "feat: add governed hooks and required checks"
```

## Task 10: Local Codex Preflight, Primary Execution, Fallback, And Evidence Integration

**Files:**
- Modify: `packages/executor/src/local-codex-preflight.ts`
- Modify: `packages/executor/src/local-codex-executor.ts`
- Modify: `packages/executor/src/local-codex-evidence.ts`
- Modify: `packages/executor/src/codex-exec-fallback-driver.ts`
- Modify: `packages/executor/src/codex-app-server-driver.ts`
- Modify: `packages/executor/src/codex-raw-log-store.ts`
- Modify: `tests/executor/local-codex-preflight.test.ts`
- Modify: `tests/executor/mock-executor.test.ts`
- Modify: `tests/executor/codex-session-driver.test.ts`
- Modify: `tests/executor/codex-worktree.test.ts`

- [ ] **Step 1: Write failing preflight integration tests**

In `tests/executor/local-codex-preflight.test.ts`, add cases:

- missing/invalid frozen snapshot blocks startup;
- declared scope PathPolicy rejection maps to `path_policy_declared_scope_rejected`;
- legacy required check command that cannot render maps to `required_check_command_invalid`;
- hard-limit unavailability maps to `runtime_hard_limits_unavailable`;
- primary Codex not governed maps to `primary_executor_governor_unavailable`;
- `before_run` hook failure blocks startup;
- pure filesystem probes use Node APIs and do not spawn.

- [ ] **Step 2: Write failing fallback/evidence tests**

Add cases proving:

- fallback is denied unless frozen snapshot allows it, returning `fallback_denied_by_policy`;
- fallback command uses structured command and governor;
- raw fallback stderr remains internal;
- required checks no longer use `exec`;
- artifacts are written only through `ArtifactWriter`;
- executor-reported changed files are advisory and not enforcement input.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm test tests/executor/local-codex-preflight.test.ts tests/executor/codex-session-driver.test.ts tests/executor/mock-executor.test.ts
```

Expected: FAIL because local Codex still has direct command paths and direct artifact writes.

- [ ] **Step 4: Refactor `LocalCodexEnvironment`**

Replace generic `commandExists`, `runCommand`, and `runCodex` production paths with typed runtime safety dependencies:

```ts
export interface LocalCodexRuntimeSafety {
  config: ExecutorRuntimeSafetyConfig;
  frozenSnapshot: PackageRuntimePolicySnapshot;
  pathSafety: PathSafety;
  artifactWriter: ArtifactWriter;
  bootstrapGovernor: ResourceGovernor;
  runGovernor: ResourceGovernor;
  hookRunner: HookRunner;
}
```

Keep test-only mocks for unit tests, but production/local Codex must use governed probes and primary execution.

- [ ] **Step 5: Materialize primary Codex CLI execution**

In `local-codex-executor.ts`, replace direct `codex exec --dangerously-bypass-approvals-and-sandbox` with `PrimaryExecutorCommandSpec` launched by run governor:

```ts
{
  executor_type: 'local_codex',
  executable: 'codex',
  args: generatedFixedCodexArgs,
  cwd: 'workspace_root',
  prompt_ref,
  prompt_digest,
  run_spec_digest,
  visibility: 'internal',
  source_write_policy: 'path_policy_scoped',
}
```

Prompt content must be stored as an internal artifact or sandbox stdin channel, not shell-interpreted argv.

- [ ] **Step 6: Integrate required checks and evidence**

In `local-codex-evidence.ts`, remove `execAsync`, `runCheckCommand`, naive `globPrefix`, and direct `writeFile`. Use `RequiredCheckRunner`, `deriveAuthoritativeChangedFiles`, `compileEffectivePathPolicy`, and `ArtifactWriter`.

- [ ] **Step 7: Harden fallback and raw logs**

In `codex-exec-fallback-driver.ts`, deny unless frozen fallback policy allows `codex_exec`; execute through `ResourceGovernor.run`; write raw events through `ArtifactWriter`; expose only sanitized summaries.

- [ ] **Step 8: Govern app-server primary execution**

In `packages/executor/src/codex-app-server-driver.ts`, require an app-server sandbox lease before `startRun`, `resumeRun`, or `sendInput` can deliver prompts, credentials, workspace paths, or run metadata to the app-server worker.

Implementation requirements:

- call `ResourceGovernor.createRunLease` for app-server primary execution;
- bind `prompt_digest`, `run_spec_digest`, workspace root, artifact root, sandbox output root, policy/config digests, network policy digest, resource-limit digest, and lease expiry;
- require a fresh per-command invocation nonce for every app-server action;
- reject missing, expired, mismatched, or reused leases with `primary_executor_governor_unavailable` or `runtime_attestation_invalid`;
- keep fallback to `exec_fallback` denied unless the frozen fallback policy explicitly permits it.

Add tests in `tests/executor/codex-session-driver.test.ts` proving app-server execution cannot start without a valid lease and cannot reuse a nonce.

- [ ] **Step 9: Run focused tests**

Run:

```bash
pnpm test tests/executor/local-codex-preflight.test.ts tests/executor/codex-session-driver.test.ts tests/executor/mock-executor.test.ts tests/executor/codex-worktree.test.ts tests/executor/required-check-runner.test.ts tests/executor/hook-runner.test.ts
pnpm --filter @forgeloop/executor build
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add packages/executor/src/local-codex-preflight.ts packages/executor/src/local-codex-executor.ts packages/executor/src/local-codex-evidence.ts packages/executor/src/codex-exec-fallback-driver.ts packages/executor/src/codex-app-server-driver.ts packages/executor/src/codex-raw-log-store.ts tests/executor/local-codex-preflight.test.ts tests/executor/mock-executor.test.ts tests/executor/codex-session-driver.test.ts tests/executor/codex-worktree.test.ts
git commit -m "feat: route local codex through runtime safety"
```

## Task 11: Run Worker Startup Sequence And Split Workflow Finalization

**Files:**
- Modify: `packages/run-worker/src/run-worker.ts`
- Modify: `packages/run-worker/src/index.ts`
- Modify: `packages/workflow/src/execution-finalizer.ts`
- Modify: `packages/workflow/src/activities.ts`
- Modify: `tests/run-worker/run-worker.test.ts`
- Modify: `tests/workflow/execution-finalizer.test.ts`
- Modify: `tests/workflow/package-execution-workflow.test.ts`

- [ ] **Step 1: Write failing finalization split tests**

In `tests/workflow/execution-finalizer.test.ts`, add cases:

- `terminalizePackageRunWithRuntimeEvidence` persists terminal status, check results, primary artifact refs, authoritative changed-file evidence, and PathPolicy outcome;
- terminalization returns review eligibility but does not create ReviewPacket;
- `completePackageRunReviewFinalization` creates/advances ReviewPacket only from terminalized succeeded state and primary artifact refs;
- `path_policy_actual_changes_rejected` persists failed RunSession and no ReviewPacket;
- `changed_files_unavailable` fails closed;
- executor-reported changed files are ignored for enforcement;
- workflow finalizer does not import executor modules.

- [ ] **Step 2: Write failing run-worker order tests**

In `tests/run-worker/run-worker.test.ts`, add cases asserting this exact order:

1. load RunSession/package/snapshot;
2. validate snapshot/effective PathPolicy;
3. resolve trusted toolchain and sandbox executable identity;
4. prepare worktree under bootstrap governor;
5. capture base commit and source snapshot metadata;
6. acquire run execution attestation/lease;
7. runtime preflight;
8. `before_run`;
9. primary execution;
10. required checks;
11. authoritative changed-file derivation;
12. actual PathPolicy validation;
13. persist primary execution/check artifacts through `ArtifactWriter`;
14. terminalize;
15. `after_run`;
16. persist post-run diagnostics;
17. complete review finalization.

Also assert failed `after_run` does not alter terminal status or ReviewPacket eligibility.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm test tests/workflow/execution-finalizer.test.ts tests/run-worker/run-worker.test.ts tests/workflow/package-execution-workflow.test.ts
```

Expected: FAIL because finalization is currently all-in-one.

- [ ] **Step 4: Add runtime finalization input types**

In `packages/workflow/src/execution-finalizer.ts`, add:

```ts
export interface RuntimeFinalizationEvidence {
  executorResult: ExecutorResult;
  authoritativeChangedFiles: ChangedFile[];
  changedFileEvidenceRef?: ArtifactRef;
  pathPolicy: { ok: boolean; blockerCode?: 'path_policy_actual_changes_rejected' | 'changed_files_unavailable'; publicSummary?: string; diagnosticRef?: ArtifactRef };
  requiredCheckResults: CheckResult[];
  primaryArtifactRefs: ArtifactRef[];
  runtimeBlockers: RuntimeSafetyBlocker[];
}
```

Do not import executor types. Keep this workflow-owned and sanitized.

- [ ] **Step 5: Implement terminalization function**

Add:

```ts
export async function terminalizePackageRunWithRuntimeEvidence(input: TerminalizePackageRunWithRuntimeEvidenceInput): Promise<TerminalizedRunResult>
```

It persists terminal status, artifacts, changed files, check results, and package failure/success reconciliation. It must not run self-review or create ReviewPacket.

- [ ] **Step 6: Implement review finalization function**

Add:

```ts
export async function completePackageRunReviewFinalization(input: CompletePackageRunReviewFinalizationInput): Promise<ExecutePackageRunResult>
```

It requires a terminalized succeeded RunSession, runs self-review when needed, creates/advances ReviewPacket, and writes trace links.

- [ ] **Step 7: Keep compatibility wrapper mock/test-only**

Refactor `finalizePackageRunWithExecutorResult` to call the split functions only for mock/test paths. Production/local Codex run-worker code must call the split sequence directly.

- [ ] **Step 8: Refactor run-worker finalization path**

In `packages/run-worker/src/run-worker.ts`, replace `finalizePackageRunWithExecutorResult` call for real local Codex with:

```ts
const terminalized = await terminalizePackageRunWithRuntimeEvidence(...);
const afterRunDiagnostics = await hookRunner.runAfterRun(...);
await persistAfterRunDiagnostics(...);
if (terminalized.reviewEligible) {
  await completePackageRunReviewFinalization(...);
}
```

Mock workflow dogfood may continue through compatibility wrapper.

- [ ] **Step 9: Build `RunSpec.source_mutation_policy`**

In `packages/workflow/src/activities.ts`, include `source_mutation_policy` from `ExecutionPackage`, validate cross-object consistency outside contracts, and reject production/local Codex activity execution unless run-worker owns the safety boundary.

- [ ] **Step 10: Run focused tests**

Run:

```bash
pnpm test tests/workflow/execution-finalizer.test.ts tests/run-worker/run-worker.test.ts tests/workflow/package-execution-workflow.test.ts
pnpm --filter @forgeloop/workflow build
pnpm --filter @forgeloop/run-worker build
```

Expected: PASS.

- [ ] **Step 11: Commit**

Run:

```bash
git add packages/run-worker/src/run-worker.ts packages/run-worker/src/index.ts packages/workflow/src/execution-finalizer.ts packages/workflow/src/activities.ts tests/run-worker/run-worker.test.ts tests/workflow/execution-finalizer.test.ts tests/workflow/package-execution-workflow.test.ts
git commit -m "feat: split runtime terminalization and review finalization"
```

## Task 12: Close Legacy Production/Local Codex Bypass Paths

**Files:**
- Modify: `apps/executor-gateway/src/executor.service.ts`
- Modify: `apps/executor-gateway/src/executor.controller.ts`
- Modify: `apps/workflow-worker/src/worker.ts`
- Modify: `packages/workflow/src/activities.ts`
- Modify: `tests/executor-gateway/executor-gateway.test.ts`
- Modify: `tests/workflow-worker/worker.test.ts`
- Modify: `tests/workflow/package-execution-workflow.test.ts`

- [ ] **Step 1: Write failing executor-gateway tests**

In `tests/executor-gateway/executor-gateway.test.ts`, add cases:

- `local_codex` request without `run_execution` attestation is rejected;
- `local_codex` request with enqueue preflight attestation is rejected;
- `local_codex` request with stale/mismatched/missing roots attestation is rejected;
- mock executor still works for mock/test-only dogfood.

- [ ] **Step 2: Write failing workflow-worker tests**

In `tests/workflow-worker/worker.test.ts`, add cases:

- production/local Codex worker activities do not call executor-gateway directly;
- production/local Codex path delegates to run-worker/new boundary or fails closed with `primary_executor_governor_unavailable`;
- mock workflow dogfood remains allowed.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm test tests/executor-gateway/executor-gateway.test.ts tests/workflow-worker/worker.test.ts tests/workflow/package-execution-workflow.test.ts
```

Expected: FAIL because executor-gateway and workflow-worker still expose old local Codex paths.

- [ ] **Step 4: Harden executor-gateway**

Create an executor request envelope in `apps/executor-gateway/src/executor.service.ts` instead of treating every POST body as a bare `RunSpec`:

```ts
interface ExecutorExecutionRequest {
  run_spec: RunSpec;
  runtime_safety_attestation?: RuntimeSafetyAttestation;
  runtime_safety_routing?: {
    workspace_root: string;
    artifact_root: string;
    sandbox_output_root?: string;
    policy_digest: string;
    env_policy_digest: string;
    command_policy_digest: string;
    mount_policy_digest: string;
    network_policy_digest: string;
    resource_limit_digest: string;
  };
}
```

Update `apps/executor-gateway/src/executor.controller.ts` to pass the raw request body into `ExecutorService.createExecution`, where the service parses either this envelope or a bare mock `RunSpec`. For backward compatibility, continue accepting a bare `RunSpec` only when `executor_type === 'mock'`. For `local_codex`, require the envelope and validate `runtime_safety_attestation.attestation_scope === 'run_execution'`.

Change adapter invocation from a bare `RunSpec` to a request object:

```ts
export interface ExecutorAdapterInput {
  runSpec: RunSpec;
  runtimeSafetyAttestation?: RuntimeSafetyAttestation;
  runtimeSafetyRouting?: ExecutorExecutionRequest['runtime_safety_routing'];
}

export type ExecutorAdapter = (input: ExecutorAdapterInput) => Promise<ExecutorResult>;
```

Update `createDefaultExecutorAdapters` so:

- `mock` calls `runMockExecutor(input.runSpec)`;
- `local_codex` constructs the runtime-safety dependencies required by Task 10 from `input.runtimeSafetyAttestation` and `input.runtimeSafetyRouting`;
- `local_codex` passes those dependencies to `runLocalCodexExecutor`, not only `artifactRoot` and `codexHome`;
- missing runtime-safety dependencies fail closed before adapter invocation.

Before choosing adapter:

```ts
if (runSpec.executor_type === 'local_codex' && !hasValidRunExecutionRuntimeSafety(request)) {
  throw new BadRequestException({
    code: 'primary_executor_governor_unavailable',
    message: 'local_codex execution requires run_execution runtime safety routing',
  });
}
```

The validation must check run-bound attestation, roots, policy/config/resource digests, and runtime safety routing metadata. Do not accept enqueue preflight attestations.

- [ ] **Step 5: Harden workflow-worker**

In `apps/workflow-worker/src/worker.ts`, ensure `createExecutorGatewayAdapter` is not used for production/local Codex runs. Return a failed executor result or throw with `primary_executor_governor_unavailable` unless the new run-worker boundary is configured.

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm test tests/executor-gateway/executor-gateway.test.ts tests/workflow-worker/worker.test.ts tests/workflow/package-execution-workflow.test.ts
pnpm --filter @forgeloop/executor-gateway build
pnpm --filter @forgeloop/workflow-worker build
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/executor-gateway/src/executor.service.ts apps/executor-gateway/src/executor.controller.ts apps/workflow-worker/src/worker.ts packages/workflow/src/activities.ts tests/executor-gateway/executor-gateway.test.ts tests/workflow-worker/worker.test.ts tests/workflow/package-execution-workflow.test.ts
git commit -m "fix: close legacy local codex execution bypasses"
```

## Task 13: Public Runtime Blocker Projection

**Files:**
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation.dto.ts`
- Modify: `apps/control-plane-api/src/modules/automation/runtime-snapshot.service.ts`
- Modify: `packages/automation/src/types.ts`
- Modify: `packages/automation/src/http-client.ts`
- Modify: `tests/api/automation-runtime-snapshot.test.ts`
- Modify: `tests/automation/planner.test.ts`
- Modify: `tests/db/automation-repository.test.ts`

- [ ] **Step 1: Write failing runtime snapshot DTO tests**

In `tests/api/automation-runtime-snapshot.test.ts`, add cases for every required blocker code:

```ts
const requiredCodes = [
  'policy_snapshot_missing',
  'policy_snapshot_invalid',
  'policy_digest_mismatch',
  'runtime_policy_invalid',
  'path_policy_declared_scope_rejected',
  'path_policy_actual_changes_rejected',
  'changed_files_unavailable',
  'required_check_command_invalid',
  'required_check_failed',
  'required_check_timed_out',
  'structured_command_invalid',
  'runtime_hard_limits_unavailable',
  'runtime_attestation_invalid',
  'sandbox_isolation_unavailable',
  'primary_executor_governor_unavailable',
  'before_run_hook_failed',
  'before_run_hook_timed_out',
  'fallback_denied_by_policy',
  'artifact_visibility_denied',
] as const;
```

Assert each projection includes sanitized `blockers[]`, deterministic sorting, and compatibility `blocked_reason_code`/`blocked_summary` from the first blocker. Assert no raw command/stdout/stderr/diff/local path/env/secret substrings appear.

- [ ] **Step 2: Write failing automation client parsing tests**

In `tests/automation/planner.test.ts` or a new HTTP client test, assert `AutomationHttpClient.runtimeSnapshot()` preserves `blockers[]` and singular aliases.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm test tests/api/automation-runtime-snapshot.test.ts tests/automation/planner.test.ts tests/db/automation-repository.test.ts
```

Expected: FAIL because `blockers[]` is not yet projected.

- [ ] **Step 4: Add repository row types**

In `packages/db/src/repositories/delivery-repository.ts`, add:

```ts
export interface RuntimeSnapshotBlockerRow {
  blocked_reason_code: string;
  blocked_summary: string;
  retryable: boolean;
  policy_digest?: string;
  policy_snapshot_version?: number;
  diagnostic_ref?: string;
}
```

Add `blockers?: RuntimeSnapshotBlockerRow[]` to `RuntimeSnapshotTargetRow`.

- [ ] **Step 5: Derive blockers in repositories**

In both repositories, derive blockers at query time from package/run policy status, action run state, manual holds, and sanitized diagnostic refs. Do not add storage tables in this task.

Sorting precedence must match the spec:

1. snapshot missing/invalid/digest mismatch;
2. runtime policy invalid;
3. declared scope rejection;
4. structured command/check command invalid;
5. hard-limit/sandbox/attestation/primary governor unavailable;
6. before-run hook;
7. required checks;
8. changed-file computation/actual path policy;
9. fallback/artifact visibility denial.

- [ ] **Step 6: Add DTO and client types**

In `apps/control-plane-api/src/modules/automation/automation.dto.ts`, add:

```ts
export interface AutomationRuntimeBlockerDto {
  target_object_type: string;
  target_object_id: string;
  target_revision_id?: string;
  repo_id?: string;
  blocked_reason_code: string;
  blocked_summary: string;
  retryable: boolean;
  policy_digest?: string;
  policy_snapshot_version?: number;
  diagnostic_ref?: string;
}
```

Add `blockers?: AutomationRuntimeBlockerDto[]` to target DTO, and map singular fields from the first sorted blocker.

In `packages/automation/src/types.ts`, add camelCase equivalents. In `packages/automation/src/http-client.ts`, parse `blockers[]`.

- [ ] **Step 7: Verify planner stays enqueue-disabled**

In `tests/automation/planner.test.ts`, assert runtime blockers do not cause run enqueue actions and existing `run_enqueue_disabled_by_scope` behavior remains unchanged.

- [ ] **Step 8: Run focused tests**

Run:

```bash
pnpm test tests/api/automation-runtime-snapshot.test.ts tests/automation/planner.test.ts tests/db/automation-repository.test.ts
pnpm --filter @forgeloop/db build
pnpm --filter @forgeloop/control-plane-api build
pnpm --filter @forgeloop/automation build
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add packages/db/src/repositories/delivery-repository.ts packages/db/src/repositories/in-memory-delivery-repository.ts packages/db/src/repositories/drizzle-delivery-repository.ts apps/control-plane-api/src/modules/automation/automation.dto.ts apps/control-plane-api/src/modules/automation/runtime-snapshot.service.ts packages/automation/src/types.ts packages/automation/src/http-client.ts tests/api/automation-runtime-snapshot.test.ts tests/automation/planner.test.ts tests/db/automation-repository.test.ts
git commit -m "feat: project sanitized runtime blockers"
```

## Task 14: Full Runtime Safety Integration Verification

**Files:**
- Modify as needed only to fix integration breakage in files touched by prior tasks
- Modify: `tests/smoke/p0-local-codex-dogfood-script.test.ts`
- Modify: `tests/smoke/dogfood-strict-local-codex.test.ts`
- Modify: `tests/smoke/automation-dogfood-script.test.ts`
- Modify: `tests/automation/planner.test.ts`

- [ ] **Step 1: Add final no-enqueue regression tests**

In `tests/automation/planner.test.ts`, add an explicit test:

```ts
expect(planNextActions(snapshotWithReadyPackagesAndRuntimeSafetySatisfied)).not.toContainEqual(
  expect.objectContaining({ actionType: expect.stringMatching(/enqueue/i) }),
);
```

- [ ] **Step 2: Add smoke assertions for fail-closed local Codex**

In local Codex smoke tests, assert missing sandbox/runtime config fails with `primary_executor_governor_unavailable` or `runtime_hard_limits_unavailable`, not by launching unsafe local Codex.

- [ ] **Step 3: Run executor safety suite**

Run:

```bash
pnpm test tests/executor/path-safety.test.ts tests/executor/artifact-writer.test.ts tests/executor/path-policy.test.ts tests/executor/effective-path-policy.test.ts tests/executor/runtime-policy.test.ts tests/executor/structured-command.test.ts tests/executor/runtime-safety-config.test.ts tests/executor/resource-limits.test.ts tests/executor/resource-governor.test.ts tests/executor/hook-runner.test.ts tests/executor/required-check-runner.test.ts tests/executor/authoritative-changed-files.test.ts tests/executor/local-codex-preflight.test.ts tests/executor/codex-worktree.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run integration suite**

Run:

```bash
pnpm test tests/run-worker/run-worker.test.ts tests/workflow/execution-finalizer.test.ts tests/workflow/package-execution-workflow.test.ts tests/workflow-worker/worker.test.ts tests/executor-gateway/executor-gateway.test.ts tests/api/automation-commands.test.ts tests/api/automation-runtime-snapshot.test.ts tests/api/run-spec-validation.test.ts tests/automation/planner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run package builds**

Run:

```bash
pnpm --filter @forgeloop/contracts build
pnpm --filter @forgeloop/domain build
pnpm --filter @forgeloop/executor build
pnpm --filter @forgeloop/workflow build
pnpm --filter @forgeloop/run-worker build
pnpm --filter @forgeloop/db build
pnpm --filter @forgeloop/control-plane-api build
pnpm --filter @forgeloop/automation build
pnpm --filter @forgeloop/executor-gateway build
pnpm --filter @forgeloop/workflow-worker build
```

Expected: all builds pass.

- [ ] **Step 6: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 7: Run workspace build**

Run:

```bash
pnpm -r build
```

Expected: PASS.

- [ ] **Step 8: Audit for bypasses**

Run:

```bash
rg -n "exec\\(|execFile\\(|spawn\\(|runCommand\\(|--dangerously-bypass-approvals-and-sandbox|child_process" packages apps tests
```

Expected:

- production subprocess launch sites are limited to `packages/executor/src/resource-governor.ts` and test fakes;
- no production local Codex path still passes `--dangerously-bypass-approvals-and-sandbox` directly to an ungoverned process;
- any remaining direct subprocess references are tests or explicitly safe mock paths.

- [ ] **Step 9: Commit final integration fixes**

Run:

```bash
git add tests/smoke/p0-local-codex-dogfood-script.test.ts tests/smoke/dogfood-strict-local-codex.test.ts tests/smoke/automation-dogfood-script.test.ts tests/automation/planner.test.ts
git commit -m "test: verify runtime safety integration"
```

Only include additional source files if this task fixed integration defects discovered by Steps 3-8.

## Final Verification

Before opening or merging a PR, run:

```bash
pnpm test
pnpm -r build
rg -n "exec\\(|execFile\\(|spawn\\(|--dangerously-bypass-approvals-and-sandbox|run_enqueue|enqueue_package_run" packages apps tests
```

Expected:

- all tests pass;
- all package builds pass;
- direct subprocess launch is confined to `ResourceGovernor` and tests;
- daemon planner still has no run enqueue action;
- any remaining `run_enqueue` text is configuration/docs/tests proving it stays disabled;
- local Codex cannot start without a valid `run_execution` safety boundary.

## Review Checklist

Use this checklist before marking implementation done:

- [ ] `packages/executor` exports `PathSafety`, `PathPolicy`, `RuntimePolicyLoader`, `StructuredCommand`, `ResourceLimitVector`, `ResourceGovernor`, `HookRunner`, `RequiredCheckRunner`, `ArtifactWriter`, and authoritative changed-file derivation.
- [ ] `StructuredCommand` never spawns.
- [ ] Every executor subprocess path routes through `ResourceGovernor.run` or a governor lease.
- [ ] Bootstrap governor and run governor are distinct.
- [ ] Enqueue preflight and run execution attestations are distinct and not interchangeable.
- [ ] Primary Codex execution is governed or leased.
- [ ] Legacy workflow-worker/executor-gateway production/local Codex bypass is closed.
- [ ] Frozen package snapshots contain all accepted execution-affecting policy sections and the normalized payload digest.
- [ ] Runtime policy reload cannot mutate ready/run-eligible packages.
- [ ] `allowed_paths: []` is accepted only for `source_mutation_policy: no_source_changes`.
- [ ] Safe-default snapshot requires explicit approval evidence and missing `WORKFLOW.md`.
- [ ] Artifact root is not writable by subprocesses.
- [ ] Required checks, hooks, fallback, raw logs, and evidence artifacts use `ArtifactWriter`.
- [ ] Authoritative changed files are derived by run-worker/executor through the run governor and finalizer does not trust executor-reported paths.
- [ ] `after_run` runs after terminal status and cannot alter terminal status or review eligibility.
- [ ] Public blocker projection returns deterministic `blockers[]` and sanitized summaries only.
- [ ] Daemon planner still does not enqueue runs.
