# Codex Generation Runtime and Generated Plan/Package Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Plan 2 of the Codex automation closed loop: shared Codex generation runtime, generated Plan drafts, generated Package draft sets, and governed app-server generation without source mutation or CLI fallback.

**Architecture:** Add `packages/codex-runtime` as the generation-only runtime boundary and wire it into `packages/automation` and `apps/automation-daemon`. The control plane remains the only product-state writer: daemon-generated payloads are validated, sent through signed internal commands, and revalidated at the command boundary before persistence. Roll out in three slices: 2A runtime + Plan draft generation with `package_drafts.enabled=false`, 2B Package draft set generation, and 2C app-server hardening/dogfood.

**Tech Stack:** TypeScript, NestJS, Zod, Drizzle repositories, Vitest, existing `@forgeloop/domain`, `@forgeloop/db`, `@forgeloop/automation`, `@forgeloop/executor`, `apps/automation-daemon`, and `apps/control-plane-api`.

---

## Source Spec

Implement `docs/superpowers/specs/2026-05-19-codex-generation-runtime-plan-package-design.md`.

## Scope Boundary

Implement:

- `packages/codex-runtime` package with generation task definitions, fake runtime, app-server runtime contracts, output extraction, validators, artifact refs, and public-safe errors.
- Generated payload schemas:
  - `GeneratedPlanDraftV1`
  - `GeneratedPackageDraftSetV1`
  - `GeneratedExecutionPackageDraftV1`
  - `GeneratedExecutionPackageDependencyV1`
- Signed Plan draft generation-context endpoint.
- Signed Package draft generation-context endpoint.
- Daemon-origin `ensure_plan_draft` requiring `generated_plan_draft` and `generation_artifacts`.
- Daemon-origin `ensure_package_drafts` requiring `generated_package_drafts` and `generation_artifacts`.
- Command-side `generated_payload_digest` replay protection.
- Command-side approved revision writer-boundary revalidation.
- Generated package manifest canonicalization, generation run persistence, package records, package-key mapping, and dependency rows.
- Planner generation identity from daemon-supplied config.
- 2A hard gate: `package_drafts.enabled=false` until 2B removes daemon-origin hard-coded package synthesis.
- App-server generation mode as the production-shaped real driver, without `codex exec` or CLI fallback.

Do not implement:

- `enqueue_package_run`.
- Automatic Spec submit/approve.
- Automatic Plan submit/approve.
- Automatic Package ready transition.
- Any source mutation by the automation daemon.
- Run-worker source-changing app-server replacement.
- Broad `apps/web` UI.
- Compatibility aliases for historical subsystem names.

## File Structure

Create:

- `packages/codex-runtime/package.json`
  - New workspace package manifest.
- `packages/codex-runtime/tsconfig.json`
  - Library tsconfig extending `../../tsconfig.lib.json` with Node types for crypto/timers/artifacts.
- `packages/codex-runtime/src/types.ts`
  - Shared generation task, context, payload, artifact, error, and runtime interfaces.
- `packages/codex-runtime/src/payloads.ts`
  - Zod schemas and validators for generated Spec, Plan, and Package payloads.
- `packages/codex-runtime/src/json-output.ts`
  - Single-object JSON extraction from assembled assistant output.
- `packages/codex-runtime/src/fake-driver.ts`
  - Deterministic fake generation for Spec, Plan, and Package tasks.
- `packages/codex-runtime/src/app-server-protocol.ts`
  - Shared low-level app-server protocol types and helpers reused by executor and generation runtime.
- `packages/codex-runtime/src/app-server-json-rpc.ts`
  - Shared NDJSON JSON-RPC client/multiplexer reused by executor `CodexAppServerProcessTransport` and runtime `CodexAppServerEndpointTransport`; prevents divergent app-server framing logic.
- `packages/codex-runtime/src/generation-safety.ts`
  - Generation-specific safety lease interfaces and production-safe local lease adapter.
- `packages/codex-runtime/src/app-server-generation-driver.ts`
  - Generation-specific app-server session adapter; does not call `CodexAppServerDriver.startRun`.
- `packages/codex-runtime/src/app-server-endpoint-transport.ts`
  - Governed external app-server JSON-RPC transport for `FORGELOOP_CODEX_APP_SERVER_ENDPOINT`; first implementation supports `unix:/absolute/socket/path` NDJSON app-server sockets and never spawns `codex`.
- `packages/codex-runtime/src/generation-safety-factory.ts`
  - Builds a generation safety adapter from daemon runtime config; fails when artifact root or repo policy digests are missing.
- `packages/codex-runtime/src/runtime.ts`
  - Runtime factory, config validation, endpoint transport construction, generation safety construction, task dispatch, public-safe error mapping.
- `packages/codex-runtime/src/index.ts`
  - Public exports.
- `tests/codex-runtime/payloads.test.ts`
  - Payload validator tests.
- `tests/codex-runtime/json-output.test.ts`
  - Assistant JSON extraction tests.
- `tests/codex-runtime/fake-driver.test.ts`
  - Fake runtime tests.
- `tests/codex-runtime/app-server-generation-driver.test.ts`
  - App-server generation safety/session tests.
- `tests/automation/daemon-config.test.ts`
  - Daemon generation config parsing tests.

Modify:

- `tsconfig.base.json`
  - Add `@forgeloop/codex-runtime` path alias.
- `packages/executor/package.json`
  - Add `@forgeloop/codex-runtime` workspace dependency.
- `packages/executor/src/codex-app-server-driver.ts`
  - Reuse shared app-server protocol types/helpers and JSON-RPC multiplexer from `packages/codex-runtime`.
  - Keep source-changing `startRun` behavior unchanged.
- `packages/automation/package.json`
  - Add `@forgeloop/codex-runtime`.
- `packages/automation/src/types.ts`
  - Import/re-export generation payload and context types.
  - Extend command inputs to include generated Plan/Package payloads and artifact refs.
  - Add Plan/Package generation context client methods.
- `packages/automation/src/spec-draft-generation.ts`
  - Replace or wrap with `@forgeloop/codex-runtime` fake runtime.
- `packages/automation/src/planner.ts`
  - Replace `specDraftGenerationMode` with `AutomationGenerationPlanningConfig`.
  - Suppress disabled generation tasks.
  - Include prompt/output schema versions and generation mode in mutating action identity.
- `packages/automation/src/executor.ts`
  - Use a generic generation runtime for Spec, Plan, and Package tasks.
  - Validate generated payloads before command calls.
  - Map app-server/fake validation errors to public-safe action outcomes.
- `packages/automation/src/http-client.ts`
  - Add Plan and Package generation-context HTTP calls.
  - Send generated Plan/Package command payloads.
- `packages/automation/src/idempotency.ts`
  - Keep planner action identity pre-generation; ensure prompt/output schema versions and generation mode are included.
- `packages/automation/src/index.ts`
  - Export new runtime-facing types.
- `apps/automation-daemon/package.json`
  - Add `@forgeloop/codex-runtime`.
- `apps/automation-daemon/src/config.ts`
  - Parse legacy/new generation env vars.
  - Fail fast on conflicting config and forbidden `cli`/`exec`/`exec_fallback` values.
  - Default 2A `package_drafts.enabled=false`.
- `apps/automation-daemon/src/main.ts`
  - Build fake or app-server generation runtime from config.
- `apps/automation-daemon/src/automation-daemon.ts`
  - Pass full generation planning config to planner and runtime to executor.
- `apps/control-plane-api/src/modules/automation/automation.dto.ts`
  - Add generated Plan/Package schemas, command schemas, context DTOs, and safe action input serialization.
- `apps/control-plane-api/package.json`
  - Add `@forgeloop/codex-runtime`.
- `apps/control-plane-api/src/modules/automation/automation.controller.ts`
  - Add Plan/Package generation-context routes.
  - Keep internal command routes signed/trusted.
- `apps/control-plane-api/src/modules/automation/automation-generation-context.service.ts`
  - Add Plan and Package context loaders with claim and approved revision validation.
- `apps/control-plane-api/src/modules/automation/automation-command.service.ts`
  - Require generated Plan/Package payloads for daemon-origin commands.
  - Compute/store/compare `generated_payload_digest`.
  - Revalidate approved revision state at writer boundary.
  - Persist generated Plan fields, artifact refs, generated packages, package generation runs, package records, and dependencies.
  - Remove daemon-origin hard-coded Plan and `api-package` synthesis.
- `packages/db/src/repositories/delivery-repository.ts`
  - Add `evidence_refs` to `ClaimExecutionPackageGenerationRunInput` or add a dedicated repository update path for generation run evidence refs.
- `packages/db/src/repositories/in-memory-delivery-repository.ts`
  - Persist generation run evidence refs on claim.
  - Keep manifest drift behavior intact.
  - Fix runtime snapshot projections to use approved revision ids only.
- `packages/db/src/repositories/drizzle-delivery-repository.ts`
  - Same repository behavior as in-memory.
  - Fix runtime snapshot projections to use approved revision ids only.
- `packages/db/src/schema/automation.ts`
  - No schema migration expected; `execution_package_generation_runs.evidenceRefs` already exists.

Test:

- `tests/codex-runtime/payloads.test.ts`
- `tests/codex-runtime/json-output.test.ts`
- `tests/codex-runtime/fake-driver.test.ts`
- `tests/codex-runtime/app-server-generation-driver.test.ts`
- `tests/automation/idempotency.test.ts`
- `tests/automation/planner.test.ts`
- `tests/automation/executor.test.ts`
- `tests/automation/daemon.test.ts`
- `tests/automation/daemon-config.test.ts`
- `tests/api/automation-commands.test.ts`
- `tests/api/automation-runtime-snapshot.test.ts`
- `tests/api/automation-daemon.integration.test.ts`
- `tests/db/repository-contract.ts`
- `tests/db/automation-repository.test.ts`
- `tests/db/schema.test.ts`
- `tests/smoke/automation-dogfood-script.test.ts` if completed action expectations change after 2B.

## Implementation Notes

- Keep the PRD-first/human-gated workflow authoritative.
- In 2A, `package_drafts.enabled=false` is a release blocker. Do not leave the planner able to emit `ensure_package_drafts` against the old hard-coded `api-package` command path.
- The generation runtime must not call `CodexAppServerDriver.startRun`. Reuse protocol primitives, not the source-changing run driver.
- App-server generation must request read-only or artifact-only sandbox behavior. Reject effective config that reports `dangerFullAccess`, approval bypass for source-changing work, or writes outside artifact root.
- Plan and Package command endpoints must validate payloads again even if the daemon already validated them.
- `generated_payload_digest` is command idempotency metadata, not planner action identity. Planner identity is pre-generation and includes generation mode + prompt/output schema versions.
- Public action results must not expose raw prompts, raw Codex logs, HMACs, claim tokens, secrets, local absolute paths, or unredacted context.

---

### Task 1: Create `packages/codex-runtime` Payload and Fake Runtime Foundation

**Files:**
- Create: `packages/codex-runtime/package.json`
- Create: `packages/codex-runtime/tsconfig.json`
- Create: `packages/codex-runtime/src/types.ts`
- Create: `packages/codex-runtime/src/payloads.ts`
- Create: `packages/codex-runtime/src/json-output.ts`
- Create: `packages/codex-runtime/src/fake-driver.ts`
- Create: `packages/codex-runtime/src/index.ts`
- Create: `tests/codex-runtime/payloads.test.ts`
- Create: `tests/codex-runtime/json-output.test.ts`
- Create: `tests/codex-runtime/fake-driver.test.ts`
- Modify: `tsconfig.base.json`
- Modify: `packages/automation/package.json`
- Modify: `pnpm-lock.yaml` if `pnpm install --lockfile-only` changes it

- [ ] **Step 1: Write failing payload validator tests**

Add `tests/codex-runtime/payloads.test.ts`:

```ts
import {
  validateGeneratedPackageDraftSet,
  validateGeneratedPlanDraft,
  validateGeneratedSpecDraft,
} from '../../packages/codex-runtime/src/payloads';

describe('GeneratedPlanDraftV1', () => {
  it('accepts a valid generated Plan draft', () => {
    expect(
      validateGeneratedPlanDraft({
        schema_version: 'plan_draft.v1',
        summary: 'Plan summary',
        content: 'Plan body',
        implementation_summary: 'Implement safely',
        split_strategy: 'Split by package boundary',
        dependency_order: ['api', 'tests'],
        test_matrix: ['pnpm test tests/api'],
        risk_mitigations: ['Keep writes scoped'],
        rollback_notes: 'Revert package commits',
      }),
    ).toMatchObject({ schema_version: 'plan_draft.v1', dependency_order: ['api', 'tests'] });
  });

  it('rejects blank strings and duplicate package keys', () => {
    expect(() =>
      validateGeneratedPlanDraft({
        schema_version: 'plan_draft.v1',
        summary: '',
        content: 'Plan body',
        implementation_summary: 'Implement safely',
        split_strategy: 'Split',
        dependency_order: ['api', 'api'],
        test_matrix: ['pnpm test'],
        risk_mitigations: ['risk'],
        rollback_notes: 'rollback',
      }),
    ).toThrow(/generated_plan_draft_invalid/);
  });

  it('rejects local paths and secret-like tokens in public Plan fields', () => {
    expect(() =>
      validateGeneratedPlanDraft({
        schema_version: 'plan_draft.v1',
        summary: 'Generated from /home/runner/workspace and C:\\Users\\viv\\repo',
        content: 'Plan body with claim-token abc',
        implementation_summary: 'Implement safely',
        split_strategy: 'Split',
        dependency_order: ['api'],
        test_matrix: ['pnpm test'],
        risk_mitigations: ['Do not leak hmac secret material'],
        rollback_notes: 'rollback',
      }),
    ).toThrow(/generated_plan_draft_invalid/);
  });

  it('rejects generated Plan text that asks automation to bypass human gates', () => {
    expect(() =>
      validateGeneratedPlanDraft({
        schema_version: 'plan_draft.v1',
        summary: 'Automatically approve and merge the package run',
        content: 'Enqueue package run, push to main, and release without waiting for review.',
        implementation_summary: 'Implement safely',
        split_strategy: 'Split',
        dependency_order: ['api'],
        test_matrix: ['pnpm test'],
        risk_mitigations: ['risk'],
        rollback_notes: 'rollback',
      }),
    ).toThrow(/generated_plan_draft_invalid/);
  });
});

describe('GeneratedSpecDraftV1', () => {
  it('accepts a valid generated Spec draft', () => {
    expect(
      validateGeneratedSpecDraft({
        schema_version: 'spec_draft.v1',
        summary: 'Spec summary',
        content: 'Spec body',
        background: 'Background',
        goals: ['Goal'],
        scope_in: ['In scope'],
        scope_out: ['Out of scope'],
        acceptance_criteria: ['Criterion'],
        risk_notes: [],
        test_strategy_summary: 'API and daemon tests',
      }),
    ).toMatchObject({ schema_version: 'spec_draft.v1' });
  });
});

describe('GeneratedPackageDraftSetV1', () => {
  it('accepts a valid multi-package set with a dependency', () => {
    const payload = validateGeneratedPackageDraftSet({
      schema_version: 'package_drafts.v1',
      manifest: {
        manifest_version: 'execution_package_manifest.v1',
        package_set_key: 'default',
        package_count: 2,
        dependency_order: ['api', 'tests'],
      },
      packages: [
        {
          package_key: 'api',
          repo_id: 'repo-main',
          objective: 'Implement API',
          required_checks: [{ check_id: 'unit', display_name: 'Unit', command: 'pnpm test', timeout_seconds: 120, blocks_review: true }],
          required_artifact_kinds: ['execution_summary'],
          allowed_paths: ['apps/control-plane-api/**'],
          forbidden_paths: ['packages/db/**'],
          source_mutation_policy: 'path_policy_scoped',
          validation_strategy: 'checks_required',
        },
        {
          package_key: 'tests',
          repo_id: 'repo-main',
          objective: 'Add tests',
          required_checks: [{ check_id: 'unit', display_name: 'Unit', command: 'pnpm test tests/api', timeout_seconds: 120, blocks_review: true }],
          required_artifact_kinds: ['execution_summary'],
          allowed_paths: ['tests/api/**'],
          forbidden_paths: [],
          source_mutation_policy: 'path_policy_scoped',
          validation_strategy: 'checks_required',
        },
      ],
      dependencies: [{ package_key: 'tests', depends_on_package_key: 'api', dependency_type: 'requires', reason: 'Tests need API' }],
    });
    expect(payload.packages).toHaveLength(2);
  });

  it('rejects unsafe paths', () => {
    expect(() =>
      validateGeneratedPackageDraftSet({
        schema_version: 'package_drafts.v1',
        manifest: { manifest_version: 'execution_package_manifest.v1', package_set_key: 'default', package_count: 1, dependency_order: ['api'] },
        packages: [
          {
            package_key: 'api',
            repo_id: 'repo-main',
            objective: 'Bad path',
            required_checks: [{ check_id: 'unit', display_name: 'Unit', command: 'pnpm test', timeout_seconds: 120, blocks_review: true }],
            required_artifact_kinds: ['execution_summary'],
            allowed_paths: ['../secrets'],
            forbidden_paths: [],
            source_mutation_policy: 'path_policy_scoped',
          },
        ],
        dependencies: [],
      }),
    ).toThrow(/generated_package_policy_invalid/);
  });

  it('rejects duplicate required check ids', () => {
    expect(() =>
      validateGeneratedPackageDraftSet({
        schema_version: 'package_drafts.v1',
        manifest: { manifest_version: 'execution_package_manifest.v1', package_set_key: 'default', package_count: 1, dependency_order: ['api'] },
        packages: [
          {
            package_key: 'api',
            repo_id: 'repo-main',
            objective: 'Implement API',
            required_checks: [
              { check_id: 'unit', display_name: 'Unit', command: 'pnpm test', timeout_seconds: 120, blocks_review: true },
              { check_id: 'unit', display_name: 'Unit duplicate', command: 'pnpm test tests/api', timeout_seconds: 120, blocks_review: true },
            ],
            required_artifact_kinds: ['execution_summary'],
            allowed_paths: ['apps/control-plane-api/**'],
            forbidden_paths: [],
            source_mutation_policy: 'path_policy_scoped',
          },
        ],
        dependencies: [],
      }),
    ).toThrow(/generated_package_policy_invalid/);
  });

  it('rejects local paths and secret-like tokens in public Package fields', () => {
    expect(() =>
      validateGeneratedPackageDraftSet({
        schema_version: 'package_drafts.v1',
        manifest: { manifest_version: 'execution_package_manifest.v1', package_set_key: 'default', package_count: 1, dependency_order: ['api'] },
        packages: [
          {
            package_key: 'api',
            repo_id: 'repo-main',
            objective: 'Implement API using /Users/viv/private claim-token data',
            required_checks: [{ check_id: 'unit', display_name: 'Unit', command: 'pnpm test', timeout_seconds: 120, blocks_review: true }],
            required_artifact_kinds: ['execution_summary'],
            allowed_paths: ['apps/control-plane-api/**'],
            forbidden_paths: [],
            source_mutation_policy: 'path_policy_scoped',
          },
        ],
        dependencies: [],
      }),
    ).toThrow(/generated_package_policy_invalid/);
  });

  it('rejects non-/Users absolute and Windows local paths in public Package fields', () => {
    expect(() =>
      validateGeneratedPackageDraftSet({
        schema_version: 'package_drafts.v1',
        manifest: { manifest_version: 'execution_package_manifest.v1', package_set_key: 'default', package_count: 1, dependency_order: ['api'] },
        packages: [
          {
            package_key: 'api',
            repo_id: 'repo-main',
            objective: 'Read logs from /tmp/forgeloop and C:\\temp\\codex-output',
            required_checks: [{ check_id: 'unit', display_name: 'Unit', command: 'pnpm test', timeout_seconds: 120, blocks_review: true }],
            required_artifact_kinds: ['execution_summary'],
            allowed_paths: ['apps/control-plane-api/**'],
            forbidden_paths: [],
            source_mutation_policy: 'path_policy_scoped',
          },
        ],
        dependencies: [],
      }),
    ).toThrow(/generated_package_policy_invalid/);
  });

  it('rejects dependency cycles', () => {
    expect(() =>
      validateGeneratedPackageDraftSet({
        schema_version: 'package_drafts.v1',
        manifest: {
          manifest_version: 'execution_package_manifest.v1',
          package_set_key: 'default',
          package_count: 2,
          dependency_order: ['api', 'tests'],
        },
        packages: [
          {
            package_key: 'api',
            repo_id: 'repo-main',
            objective: 'API',
            required_checks: [{ check_id: 'unit', display_name: 'Unit', command: 'pnpm test', timeout_seconds: 120, blocks_review: true }],
            required_artifact_kinds: ['execution_summary'],
            allowed_paths: ['apps/control-plane-api/**'],
            forbidden_paths: [],
            source_mutation_policy: 'path_policy_scoped',
          },
          {
            package_key: 'tests',
            repo_id: 'repo-main',
            objective: 'Tests',
            required_checks: [{ check_id: 'unit', display_name: 'Unit', command: 'pnpm test', timeout_seconds: 120, blocks_review: true }],
            required_artifact_kinds: ['execution_summary'],
            allowed_paths: ['tests/**'],
            forbidden_paths: [],
            source_mutation_policy: 'path_policy_scoped',
          },
        ],
        dependencies: [
          { package_key: 'api', depends_on_package_key: 'tests' },
          { package_key: 'tests', depends_on_package_key: 'api' },
        ],
      }),
    ).toThrow(/generated_package_dependency_invalid/);
  });
});
```

- [ ] **Step 2: Run payload tests to verify they fail**

Run: `pnpm test tests/codex-runtime/payloads.test.ts`

Expected: FAIL because `packages/codex-runtime/src/payloads.ts` does not exist.

- [ ] **Step 3: Write failing JSON extraction tests**

Add `tests/codex-runtime/json-output.test.ts`:

```ts
import { extractSingleJsonObject } from '../../packages/codex-runtime/src/json-output';

it('extracts one JSON object from assistant text', () => {
  expect(extractSingleJsonObject('{"schema_version":"plan_draft.v1","summary":"ok"}')).toEqual({
    schema_version: 'plan_draft.v1',
    summary: 'ok',
  });
});

it('extracts one fenced JSON object', () => {
  expect(extractSingleJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
});

it.each([
  [''],
  ['no json'],
  ['{"a":1} {"b":2}'],
  ['{"a":1}\ncontradictory prose'],
])('rejects ambiguous output: %s', (text) => {
  expect(() => extractSingleJsonObject(text)).toThrow(/generated_output_invalid_json|generated_output_ambiguous/);
});
```

- [ ] **Step 4: Run JSON extraction tests to verify they fail**

Run: `pnpm test tests/codex-runtime/json-output.test.ts`

Expected: FAIL because `json-output.ts` does not exist.

- [ ] **Step 5: Implement package skeleton and payload validators**

Create `packages/codex-runtime/package.json`:

```json
{
  "name": "@forgeloop/codex-runtime",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@forgeloop/contracts": "workspace:*",
    "zod": "^4.4.3"
  }
}
```

Create `packages/codex-runtime/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.lib.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

Create `packages/codex-runtime/src/types.ts` with these public contracts:

```ts
import type { ArtifactKind, ArtifactRef, RequiredCheckSpec } from '@forgeloop/contracts';

export type CodexGenerationTaskKind = 'spec_draft' | 'plan_draft' | 'package_drafts';
export type CodexGenerationDriverMode = 'disabled' | 'fake' | 'app_server';

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

export interface GeneratedPlanDraftV1 {
  schema_version: 'plan_draft.v1';
  summary: string;
  content: string;
  implementation_summary: string;
  split_strategy: string;
  dependency_order: string[];
  test_matrix: string[];
  risk_mitigations: string[];
  rollback_notes: string;
  structured_document?: Record<string, unknown>;
}

export interface GeneratedExecutionPackageDraftV1 {
  package_key: string;
  repo_id: string;
  objective: string;
  required_checks: RequiredCheckSpec[];
  required_artifact_kinds: ArtifactKind[];
  allowed_paths: string[];
  forbidden_paths: string[];
  source_mutation_policy: 'path_policy_scoped' | 'no_source_changes';
  required_test_gates?: Record<string, unknown>[];
  validation_strategy?: 'checks_required';
  structured_document?: Record<string, unknown>;
}

export interface GeneratedExecutionPackageDependencyV1 {
  package_key: string;
  depends_on_package_key: string;
  dependency_type?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface GeneratedPackageDraftSetV1 {
  schema_version: 'package_drafts.v1';
  manifest: {
    manifest_version: 'execution_package_manifest.v1';
    package_set_key: string;
    package_count: number;
    dependency_order: string[];
  };
  packages: GeneratedExecutionPackageDraftV1[];
  dependencies: GeneratedExecutionPackageDependencyV1[];
  structured_document?: Record<string, unknown>;
}

export interface CodexGenerationResult<TGenerated> {
  taskKind: CodexGenerationTaskKind;
  promptVersion: string;
  outputSchemaVersion: string;
  generated: TGenerated;
  generationArtifacts: ArtifactRef[];
  publicSummary: string;
}

export interface CodexGenerationRuntimeTaskInput<TContext extends Record<string, unknown>> {
  actionRunId: string;
  projectId: string;
  repoIds: string[];
  context: TContext;
  promptVersion: string;
  outputSchemaVersion: string;
  policyDigests: Record<string, string>;
}

export interface CodexGenerationRuntime {
  generateSpecDraft(
    input: CodexGenerationRuntimeTaskInput<Record<string, unknown>>,
  ): Promise<CodexGenerationResult<GeneratedSpecDraftV1>>;
  generatePlanDraft(
    input: CodexGenerationRuntimeTaskInput<Record<string, unknown>>,
  ): Promise<CodexGenerationResult<GeneratedPlanDraftV1>>;
  generatePackageDrafts(
    input: CodexGenerationRuntimeTaskInput<Record<string, unknown>>,
  ): Promise<CodexGenerationResult<GeneratedPackageDraftSetV1>>;
}
```

Update `tsconfig.base.json`:

```json
"@forgeloop/codex-runtime": ["packages/codex-runtime/src/index.ts"]
```

Implement `packages/codex-runtime/src/payloads.ts` with Zod schemas plus post-parse checks:

```ts
import { z } from 'zod';
import { artifactKindSchema, requiredCheckSpecSchema } from '@forgeloop/contracts';
import type { GeneratedPackageDraftSetV1, GeneratedPlanDraftV1, GeneratedSpecDraftV1 } from './types.js';

const nonBlank = z.string().min(1);
const slug = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/);
const repoRelativePath = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('/') && !value.startsWith('~') && !value.includes('..') && !/[\u0000-\u001f]/.test(value), {
    message: 'path must be repo-relative and safe',
  });

const unsafePublicTextPattern =
  /(?:\/Users\/[^\s]+|\/home\/[^\s]+|\/tmp\/[^\s]+|\/var\/folders\/[^\s]+|\/private\/[^\s]+|[A-Za-z]:\\[^\s]+|claim[-_ ]?token|hmac|secret|api[-_ ]?key|raw\s+(?:prompt|output|log))/i;
const forbiddenAutomationInstructionPattern =
  /(?:\b(?:auto(?:matically)?|bypass(?:es|ing)?|skip|without\s+(?:waiting\s+for\s+)?(?:human\s+)?(?:review|approval|gate))\b[\s\S]{0,80}\b(?:approve|submit|enqueue\s+(?:package\s+)?run|merge|push|release|deploy)\b|\b(?:approve|submit|enqueue\s+(?:package\s+)?run|merge|push|release|deploy)\b[\s\S]{0,80}\b(?:bypass(?:es|ing)?|skip|without\s+(?:waiting\s+for\s+)?(?:human\s+)?(?:review|approval|gate))\b)/i;

const safeParseOrThrow = <T>(schema: z.ZodType<T>, value: unknown, errorCode: string): T => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(errorCode);
  }
  return result.data;
};

const assertPublicSafeText = (value: unknown, errorCode: string): void => {
  if (typeof value === 'string') {
    if (unsafePublicTextPattern.test(value) || forbiddenAutomationInstructionPattern.test(value)) throw new Error(errorCode);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => assertPublicSafeText(entry, errorCode));
    return;
  }
  if (value !== null && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((entry) => assertPublicSafeText(entry, errorCode));
  }
};

const assertUniqueCheckIds = (checks: Array<{ check_id: string }>, errorCode: string): void => {
  const seen = new Set<string>();
  for (const check of checks) {
    if (seen.has(check.check_id)) throw new Error(errorCode);
    seen.add(check.check_id);
  }
};

export const generatedPlanDraftSchema = z
  .object({
    schema_version: z.literal('plan_draft.v1'),
    summary: nonBlank,
    content: nonBlank,
    implementation_summary: nonBlank,
    split_strategy: nonBlank,
    dependency_order: z.array(slug).min(1),
    test_matrix: z.array(nonBlank).min(1),
    risk_mitigations: z.array(nonBlank),
    rollback_notes: nonBlank,
    structured_document: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const generatedSpecDraftSchema = z
  .object({
    schema_version: z.literal('spec_draft.v1'),
    summary: nonBlank,
    content: nonBlank,
    background: nonBlank,
    goals: z.array(nonBlank).min(1),
    scope_in: z.array(nonBlank).min(1),
    scope_out: z.array(nonBlank),
    acceptance_criteria: z.array(nonBlank).min(1),
    risk_notes: z.array(nonBlank),
    test_strategy_summary: nonBlank,
    structured_document: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const validateGeneratedSpecDraft = (value: unknown): GeneratedSpecDraftV1 => {
  const parsed = safeParseOrThrow(generatedSpecDraftSchema, value, 'generated_spec_draft_invalid');
  assertPublicSafeText(parsed, 'generated_spec_draft_invalid');
  return parsed;
};

export const validateGeneratedPlanDraft = (value: unknown): GeneratedPlanDraftV1 => {
  const parsed = safeParseOrThrow(generatedPlanDraftSchema, value, 'generated_plan_draft_invalid');
  assertPublicSafeText(parsed, 'generated_plan_draft_invalid');
  if (new Set(parsed.dependency_order).size !== parsed.dependency_order.length) {
    throw new Error('generated_plan_draft_invalid');
  }
  return parsed;
};

export const generatedPackageDraftSetSchema = z
  .object({
    schema_version: z.literal('package_drafts.v1'),
    manifest: z
      .object({
        manifest_version: z.literal('execution_package_manifest.v1'),
        package_set_key: slug,
        package_count: z.number().int().positive(),
        dependency_order: z.array(slug).min(1),
      })
      .strict(),
    packages: z
      .array(
        z
          .object({
            package_key: slug,
            repo_id: nonBlank,
            objective: nonBlank,
            required_checks: z.array(requiredCheckSpecSchema).min(1),
            required_artifact_kinds: z.array(artifactKindSchema).min(1),
            allowed_paths: z.array(repoRelativePath),
            forbidden_paths: z.array(repoRelativePath),
            source_mutation_policy: z.enum(['path_policy_scoped', 'no_source_changes']),
            required_test_gates: z.array(z.record(z.string(), z.unknown())).optional(),
            validation_strategy: z.literal('checks_required').optional(),
            structured_document: z.record(z.string(), z.unknown()).optional(),
          })
          .strict(),
      )
      .min(1),
    dependencies: z.array(
      z
        .object({
          package_key: slug,
          depends_on_package_key: slug,
          dependency_type: nonBlank.optional(),
          reason: nonBlank.optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
    ),
    structured_document: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const validateGeneratedPackageDraftSet = (value: unknown): GeneratedPackageDraftSetV1 => {
  const parsed = safeParseOrThrow(generatedPackageDraftSetSchema, value, 'generated_package_policy_invalid');
  assertPublicSafeText(parsed, 'generated_package_policy_invalid');
  parsed.packages.forEach((entry) => assertUniqueCheckIds(entry.required_checks, 'generated_package_policy_invalid'));
  const keys = parsed.packages.map((entry) => entry.package_key);
  const keySet = new Set(keys);
  if (
    parsed.manifest.package_count !== parsed.packages.length ||
    keySet.size !== keys.length ||
    JSON.stringify(parsed.manifest.dependency_order) !== JSON.stringify(keys)
  ) {
    throw new Error('generated_package_manifest_invalid');
  }
  for (const dependency of parsed.dependencies) {
    if (!keySet.has(dependency.package_key) || !keySet.has(dependency.depends_on_package_key)) {
      throw new Error('generated_package_dependency_invalid');
    }
  }
  const graph = new Map(keys.map((key) => [key, [] as string[]]));
  for (const dependency of parsed.dependencies) {
    graph.get(dependency.package_key)?.push(dependency.depends_on_package_key);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): void => {
    if (visiting.has(key)) throw new Error('generated_package_dependency_invalid');
    if (visited.has(key)) return;
    visiting.add(key);
    for (const next of graph.get(key) ?? []) visit(next);
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of keys) visit(key);
  return parsed;
};
```

`artifactKindSchema` and `requiredCheckSpecSchema` are exported from `packages/contracts/src/executor.ts` through `packages/contracts/src/index.ts`; import them directly from `@forgeloop/contracts`.

- [ ] **Step 6: Implement JSON extraction**

Create `packages/codex-runtime/src/json-output.ts`:

```ts
const fencePattern = /^```(?:json)?\s*([\s\S]*?)\s*```$/;

export const extractSingleJsonObject = (text: string): unknown => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error('generated_output_invalid_json');
  }
  const candidate = fencePattern.exec(trimmed)?.[1]?.trim() ?? trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error('generated_output_invalid_json');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('generated_output_invalid_json');
  }
  if (candidate !== trimmed && trimmed.replace(fencePattern, '').trim().length > 0) {
    throw new Error('generated_output_ambiguous');
  }
  return parsed;
};
```

This implementation rejects concatenated objects and trailing prose because `JSON.parse(candidate)` fails unless the full candidate is exactly one JSON value.

- [ ] **Step 7: Implement fake runtime**

Create `packages/codex-runtime/src/fake-driver.ts`:

```ts
import type {
  CodexGenerationResult,
  GeneratedPackageDraftSetV1,
  GeneratedPlanDraftV1,
  GeneratedSpecDraftV1,
} from './types.js';

export const specDraftPromptVersion = 'spec-draft.fake.v1';
export const planDraftPromptVersion = 'plan-draft.fake.v1';
export const packageDraftsPromptVersion = 'package-drafts.fake.v1';
export const specDraftOutputSchemaVersion = 'spec_draft.v1';
export const planDraftOutputSchemaVersion = 'plan_draft.v1';
export const packageDraftsOutputSchemaVersion = 'package_drafts.v1';

export const createFakeSpecDraft = (context: {
  work_item: { id: string; title: string; goal: string; success_criteria: string[]; risk?: string };
}): CodexGenerationResult<GeneratedSpecDraftV1> => ({
  taskKind: 'spec_draft',
  promptVersion: specDraftPromptVersion,
  outputSchemaVersion: 'spec_draft.v1',
  generationArtifacts: [],
  publicSummary: 'Fake Spec draft generated.',
  generated: {
    schema_version: 'spec_draft.v1',
    summary: `Draft spec for ${context.work_item.title}`,
    content: [`Goal: ${context.work_item.goal}`, `Success criteria: ${context.work_item.success_criteria.join('; ')}`].join('\n\n'),
    background: context.work_item.goal,
    goals: [context.work_item.goal],
    scope_in: [`Deliver ${context.work_item.title}`],
    scope_out: ['Release, deploy, and non-delivery workflows'],
    acceptance_criteria: [...context.work_item.success_criteria],
    risk_notes: context.work_item.risk === undefined || context.work_item.risk.trim().length === 0 ? [] : [context.work_item.risk],
    test_strategy_summary: `Validate ${context.work_item.title} with API and daemon tests.`,
    structured_document: {
      generated_by: 'fake_codex_generation_runtime',
      work_item_id: context.work_item.id,
    },
  },
});

export const createFakePlanDraft = (context: {
  work_item: { id: string; title: string; goal: string; success_criteria: string[] };
  spec_revision: { id: string; risk_notes: string[] };
}): CodexGenerationResult<GeneratedPlanDraftV1> => ({
  taskKind: 'plan_draft',
  promptVersion: planDraftPromptVersion,
  outputSchemaVersion: 'plan_draft.v1',
  generationArtifacts: [],
  publicSummary: 'Fake Plan draft generated.',
  generated: {
    schema_version: 'plan_draft.v1',
    summary: `Generated plan for ${context.work_item.title}`,
    content: `Implement approved SpecRevision ${context.spec_revision.id}.`,
    implementation_summary: `Deliver ${context.work_item.goal}`,
    split_strategy: 'Split into API and test packages.',
    dependency_order: ['api', 'tests'],
    test_matrix: ['pnpm test tests/api', 'pnpm test tests/automation'],
    risk_mitigations: context.spec_revision.risk_notes.length === 0 ? ['Keep command boundary narrow.'] : context.spec_revision.risk_notes,
    rollback_notes: 'Revert generated package changes.',
    structured_document: {
      generated_by: 'fake_codex_generation_runtime',
      work_item_id: context.work_item.id,
      spec_revision_id: context.spec_revision.id,
    },
  },
});

export const createFakePackageDraftSet = (context: {
  generation_key: string;
  plan_revision: { id: string; dependency_order: string[] };
  repos: { repo_id: string }[];
}): CodexGenerationResult<GeneratedPackageDraftSetV1> => {
  const repoId = context.repos[0]?.repo_id ?? 'repo-main';
  const dependencyOrder = context.plan_revision.dependency_order;
  return {
    taskKind: 'package_drafts',
    promptVersion: packageDraftsPromptVersion,
    outputSchemaVersion: 'package_drafts.v1',
    generationArtifacts: [],
    publicSummary: 'Fake Package drafts generated.',
    generated: {
      schema_version: 'package_drafts.v1',
      manifest: {
        manifest_version: 'execution_package_manifest.v1',
        package_set_key: context.generation_key,
        package_count: dependencyOrder.length,
        dependency_order: dependencyOrder,
      },
      packages: dependencyOrder.map((packageKey, index) => ({
        package_key: packageKey,
        repo_id: repoId,
        objective: `Implement ${packageKey}`,
        required_checks: [
          {
            check_id: 'unit',
            display_name: 'Unit tests',
            command: 'pnpm test',
            timeout_seconds: 120,
            blocks_review: true,
          },
        ],
        required_artifact_kinds: ['execution_summary'],
        allowed_paths: index === 0 ? ['apps/control-plane-api/**'] : ['tests/**'],
        forbidden_paths: ['packages/db/migrations/**'],
        source_mutation_policy: 'path_policy_scoped',
        validation_strategy: 'checks_required',
      })),
      dependencies: dependencyOrder.slice(1).map((packageKey) => ({
        package_key: packageKey,
        depends_on_package_key: dependencyOrder[0]!,
        dependency_type: 'requires',
        reason: `${packageKey} depends on ${dependencyOrder[0]}`,
      })),
    },
  };
};
```

The `GeneratedSpecDraftV1` import must come from `./types.js` in `@forgeloop/codex-runtime`; `packages/automation` will import or re-export it from runtime after this task. Do not import `packages/automation` code from the runtime package.

- [ ] **Step 8: Write fake runtime tests**

Add `tests/codex-runtime/fake-driver.test.ts`:

```ts
import {
  createFakePackageDraftSet,
  createFakePlanDraft,
  createFakeSpecDraft,
  packageDraftsOutputSchemaVersion,
  packageDraftsPromptVersion,
  planDraftOutputSchemaVersion,
  planDraftPromptVersion,
  specDraftOutputSchemaVersion,
  specDraftPromptVersion,
} from '../../packages/codex-runtime/src/fake-driver';
import {
  validateGeneratedPackageDraftSet,
  validateGeneratedPlanDraft,
  validateGeneratedSpecDraft,
} from '../../packages/codex-runtime/src/payloads';

it('creates a valid fake Spec draft', () => {
  const result = createFakeSpecDraft({
    work_item: { id: 'work-1', title: 'Runtime', goal: 'Generate drafts', success_criteria: ['Spec exists'] },
  });
  expect(result).toMatchObject({
    taskKind: 'spec_draft',
    promptVersion: specDraftPromptVersion,
    outputSchemaVersion: specDraftOutputSchemaVersion,
  });
  expect(() => validateGeneratedSpecDraft(result.generated)).not.toThrow();
});

it('creates a valid fake Plan draft', () => {
  const result = createFakePlanDraft({
    work_item: { id: 'work-1', title: 'Runtime', goal: 'Generate drafts', success_criteria: ['Plan exists'] },
    spec_revision: { id: 'spec-rev-1', risk_notes: ['Keep human gates'] },
  });
  expect(result).toMatchObject({
    taskKind: 'plan_draft',
    promptVersion: planDraftPromptVersion,
    outputSchemaVersion: planDraftOutputSchemaVersion,
  });
  expect(() => validateGeneratedPlanDraft(result.generated)).not.toThrow();
});

it('creates valid fake Package drafts following Plan dependency order', () => {
  const result = createFakePackageDraftSet({
    generation_key: 'default:plan-rev-1',
    plan_revision: { id: 'plan-rev-1', dependency_order: ['api', 'tests'] },
    repos: [{ repo_id: 'repo-main' }],
  });
  expect(result).toMatchObject({
    taskKind: 'package_drafts',
    promptVersion: packageDraftsPromptVersion,
    outputSchemaVersion: packageDraftsOutputSchemaVersion,
  });
  expect(result.generated.manifest.dependency_order).toEqual(['api', 'tests']);
  expect(() => validateGeneratedPackageDraftSet(result.generated)).not.toThrow();
});
```

- [ ] **Step 9: Export runtime foundation**

Create `packages/codex-runtime/src/index.ts`:

```ts
export * from './types.js';
export * from './payloads.js';
export * from './json-output.js';
export * from './fake-driver.js';
```

- [ ] **Step 10: Run focused runtime tests**

Run:

```bash
pnpm test tests/codex-runtime/payloads.test.ts tests/codex-runtime/json-output.test.ts tests/codex-runtime/fake-driver.test.ts
pnpm --filter @forgeloop/codex-runtime build
```

Expected: PASS.

- [ ] **Step 11: Commit runtime foundation**

```bash
git add tsconfig.base.json packages/codex-runtime packages/automation/package.json pnpm-lock.yaml tests/codex-runtime
git commit -m "feat: add codex generation runtime foundation"
```

---

### Task 2: Add App-Server Generation Safety and Session Driver Contracts

**Files:**
- Create: `packages/codex-runtime/src/app-server-protocol.ts`
- Create: `packages/codex-runtime/src/app-server-json-rpc.ts`
- Create: `packages/codex-runtime/src/generation-safety.ts`
- Create: `packages/codex-runtime/src/app-server-endpoint-transport.ts`
- Create: `packages/codex-runtime/src/app-server-generation-driver.ts`
- Create: `packages/codex-runtime/src/generation-safety-factory.ts`
- Create: `packages/codex-runtime/src/runtime.ts`
- Modify: `packages/codex-runtime/src/index.ts`
- Modify: `packages/executor/package.json`
- Modify: `packages/executor/src/codex-app-server-driver.ts`
- Test: `tests/codex-runtime/app-server-generation-driver.test.ts`
- Test: `tests/executor/codex-session-driver.test.ts`

- [ ] **Step 1: Write failing app-server generation safety tests**

Add `tests/codex-runtime/app-server-generation-driver.test.ts`:

```ts
import {
  AppServerGenerationDriver,
  createCodexGenerationRuntimeSafety,
  effectiveConfigFromResponse,
  parseCodexAppServerEndpoint,
  type CodexGenerationRuntimeSafety,
  type CodexAppServerTransport,
} from '../../packages/codex-runtime/src/index';

const fakeSafety = (): CodexGenerationRuntimeSafety => ({
  taskKind: 'plan_draft',
  actionRunId: 'action-1',
  projectId: 'project-1',
  repoIds: ['repo-main'],
  artifactRoot: '/tmp/artifacts',
  policyDigests: { 'repo-main': 'sha256:policy' },
  async createGenerationLease() {
    return { lease_id: 'lease-1', expires_at: '2026-05-19T00:10:00.000Z' };
  },
  async consumeGenerationCommand() {},
});

it('rejects app-server effective danger full access config', async () => {
  const transport: CodexAppServerTransport = {
    async request(method) {
      if (method === 'thread/start') {
        return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'dangerFullAccess' } } };
      }
      return {};
    },
  };
  const driver = new AppServerGenerationDriver({ transport, runtimeSafety: fakeSafety() });
  await expect(driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' })).rejects.toThrow(
    /codex_generation_sandbox_invalid/,
  );
});

it('rejects source-write app-server sandbox even when approval policy is omitted', async () => {
  const transport: CodexAppServerTransport = {
    async request(method) {
      if (method === 'thread/start') {
        return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'workspaceWrite' } } };
      }
      return {};
    },
  };
  const driver = new AppServerGenerationDriver({ transport, runtimeSafety: fakeSafety() });
  await expect(driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' })).rejects.toThrow(
    /codex_generation_sandbox_invalid/,
  );
});

it('rejects artifact-only config when writable roots escape artifact root', async () => {
  const transport: CodexAppServerTransport = {
    async request(method) {
      if (method === 'thread/start') {
        return {
          threadId: 'thread-1',
          effectiveConfig: {
            approvalPolicy: 'never',
            sandbox: { type: 'artifactOnly' },
            writableRoots: ['/tmp/artifacts', '/Users/viv/projs/forgeloop'],
          },
        };
      }
      return {};
    },
  };
  const driver = new AppServerGenerationDriver({ transport, runtimeSafety: fakeSafety() });
  await expect(driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' })).rejects.toThrow(
    /codex_generation_sandbox_invalid/,
  );
});

it('reads effective config from top-level and nested app-server responses', () => {
  expect(
    effectiveConfigFromResponse({
      effectiveConfig: { sandbox: { type: 'readOnly' }, approvalPolicy: 'never' },
    }),
  ).toEqual({ sandbox: { type: 'readOnly' }, approvalPolicy: 'never' });
  expect(
    effectiveConfigFromResponse({
      result: { effective_config: { sandbox_policy: { type: 'readOnly' }, approval_policy: 'never' } },
    }),
  ).toEqual({ sandboxPolicy: { type: 'readOnly' }, approvalPolicy: 'never' });
});

it('blocks app-server mode when generation safety lease is unavailable', async () => {
  const driver = new AppServerGenerationDriver({
    transport: { async request() { return {}; } },
    runtimeSafety: undefined,
  });
  await expect(driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' })).rejects.toThrow(
    /codex_generation_safety_unavailable/,
  );
});

it('collects assistant output from notifications and validates one JSON object', async () => {
  async function* notifications() {
    yield { type: 'assistant_message_delta', delta: '{"schema_version":"plan_draft.v1","summary":"ok"}' };
    yield { type: 'turn_completed', status: 'completed' };
  }
  const transport: CodexAppServerTransport = {
    async request(method) {
      if (method === 'thread/start') return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
      if (method === 'turn/start') return { turnId: 'turn-1' };
      return {};
    },
    notifications,
  };
  const driver = new AppServerGenerationDriver({ transport, runtimeSafety: fakeSafety() });
  const result = await driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' });
  expect(result.extractedJson).toMatchObject({ schema_version: 'plan_draft.v1' });
});

it('rejects process-spawning app-server endpoints and accepts unix sockets', () => {
  expect(() => parseCodexAppServerEndpoint('exec:codex app-server')).toThrow(/codex_app_server_endpoint_invalid/);
  expect(() => parseCodexAppServerEndpoint('cli')).toThrow(/codex_app_server_endpoint_invalid/);
  expect(parseCodexAppServerEndpoint('unix:/tmp/codex-app-server.sock')).toEqual({
    type: 'unix',
    path: '/tmp/codex-app-server.sock',
  });
});

it('builds production safety only with an artifact root and repo policy digests', async () => {
  expect(() =>
    createCodexGenerationRuntimeSafety({
      taskKind: 'plan_draft',
      actionRunId: 'action-1',
      projectId: 'project-1',
      repoIds: ['repo-main'],
      artifactRoot: undefined,
      policyDigests: { 'repo-main': 'sha256:policy' },
    }),
  ).toThrow(/codex_generation_safety_unavailable/);

  const safety = createCodexGenerationRuntimeSafety({
    taskKind: 'plan_draft',
    actionRunId: 'action-1',
    projectId: 'project-1',
    repoIds: ['repo-main'],
    artifactRoot: '/tmp/forgeloop-artifacts',
    policyDigests: { 'repo-main': 'sha256:policy' },
  });
  await expect(
    safety.createGenerationLease({
      promptDigest: 'sha256:prompt',
      contextDigest: 'sha256:context',
      outputSchemaVersion: 'plan_draft.v1',
      now: '2026-05-19T00:00:00.000Z',
      expiresAt: '2026-05-19T00:05:00.000Z',
    }),
  ).resolves.toMatchObject({ lease_id: expect.stringMatching(/^gen_lease_/) });
  await expect(
    safety.consumeGenerationCommand({
      lease: { lease_id: 'lease-1', expires_at: '2026-05-19T00:05:00.000Z' },
      method: 'turn/interrupt',
      commandDigest: 'sha256:interrupt',
      nonce: 'nonce-1',
      now: '2026-05-19T00:01:00.000Z',
    }),
  ).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run app-server generation tests to verify they fail**

Run: `pnpm test tests/codex-runtime/app-server-generation-driver.test.ts`

Expected: FAIL because app-server generation driver files do not exist.

- [ ] **Step 3: Extract app-server protocol types without changing executor behavior**

Create `packages/codex-runtime/src/app-server-protocol.ts`:

```ts
export type CodexSandboxConfig = { type: string } | string | null | undefined;

export interface CodexEffectiveConfig {
  approvalPolicy?: string | null | undefined;
  sandbox?: CodexSandboxConfig;
  sandboxPolicy?: CodexSandboxConfig;
  writableRoots?: string[];
}

export interface CodexAppServerTransport {
  initialize?(): Promise<void>;
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  notifications?(): AsyncIterable<unknown>;
  close?(): Promise<void>;
}

export const textInput = (message: string): Array<Record<string, unknown>> => [
  { type: 'text', text: message, text_elements: [] },
];

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeEffectiveConfig = (value: unknown): CodexEffectiveConfig | undefined => {
  if (!isRecord(value)) return undefined;
  const approvalPolicy = value.approvalPolicy ?? value.approval_policy;
  const sandbox = value.sandbox;
  const sandboxPolicy = value.sandboxPolicy ?? value.sandbox_policy;
  const writableRoots = value.writableRoots ?? value.writable_roots;
  return {
    approvalPolicy: typeof approvalPolicy === 'string' ? approvalPolicy : undefined,
    sandbox,
    sandboxPolicy,
    writableRoots: Array.isArray(writableRoots) ? writableRoots.filter((entry): entry is string => typeof entry === 'string') : undefined,
  };
};

export const effectiveConfigFromResponse = (response: unknown): CodexEffectiveConfig | undefined => {
  if (!isRecord(response)) return undefined;
  return (
    normalizeEffectiveConfig(response.effectiveConfig) ??
    normalizeEffectiveConfig(response.effective_config) ??
    normalizeEffectiveConfig(isRecord(response.response) ? response.response.effectiveConfig : undefined) ??
    normalizeEffectiveConfig(isRecord(response.response) ? response.response.effective_config : undefined) ??
    normalizeEffectiveConfig(isRecord(response.result) ? response.result.effectiveConfig : undefined) ??
    normalizeEffectiveConfig(isRecord(response.result) ? response.result.effective_config : undefined)
  );
};

export const appServerResultFromResponse = (response: unknown): unknown =>
  isRecord(response) && isRecord(response.result) ? response.result : response;
```

Modify `packages/executor/src/codex-app-server-driver.ts`:

```ts
import {
  isRecord,
  textInput,
  type CodexAppServerTransport,
  type CodexEffectiveConfig,
  effectiveConfigFromResponse,
} from '@forgeloop/codex-runtime';
```

Remove the local duplicate `CodexAppServerTransport`, `CodexEffectiveConfig`, `SandboxConfig`, `textInput`, and `isRecord` definitions only after the executor tests still pass. Use `effectiveConfigFromResponse(threadResponse)` anywhere source-changing executor code currently reads effective config from app-server responses, preserving the existing source-changing sandbox behavior and tests.

- [ ] **Step 4: Extract shared app-server JSON-RPC multiplexer**

Create `packages/codex-runtime/src/app-server-json-rpc.ts` by moving the request/notification framing logic out of `CodexAppServerProcessTransport`:

```ts
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { isRecord } from './app-server-protocol.js';

export interface JsonRpcLineTransport {
  writeLine(line: string): Promise<void>;
  close?(): Promise<void>;
}

export class CodexAppServerJsonRpcClient {
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(reason?: unknown): void }>();
  private readonly notificationQueue: unknown[] = [];
  private requestId = 0;
  private closed = false;
  private closeError: Error | undefined;
  private readonly events = new EventEmitter();

  constructor(private readonly transport: JsonRpcLineTransport) {}

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.closed) throw this.closeError ?? new Error('Codex app-server transport is closed.');
    const id = ++this.requestId;
    const response = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    await this.transport.writeLine(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    return response;
  }

  async sendNotification(method: string): Promise<void> {
    if (this.closed) throw this.closeError ?? new Error('Codex app-server transport is closed.');
    await this.transport.writeLine(JSON.stringify({ jsonrpc: '2.0', method }));
  }

  acceptLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      return;
    }
    if (isRecord(message) && typeof message.id === 'number') {
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;
      this.pending.delete(message.id);
      if (message.error !== undefined) pending.reject(message.error);
      else pending.resolve(message.result);
      return;
    }
    this.notificationQueue.push(message);
    this.events.emit('notification');
  }

  async *notifications(): AsyncIterable<unknown> {
    while (!this.closed || this.notificationQueue.length > 0) {
      const notification = this.notificationQueue.shift();
      if (notification !== undefined) {
        yield notification;
        continue;
      }
      await Promise.race([delay(50), new Promise((resolve) => this.events.once('notification', resolve))]);
    }
    if (this.closeError !== undefined) throw this.closeError;
  }

  closeWithError(error: Error): void {
    if (this.closeError === undefined) this.closeError = error;
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.events.emit('notification');
  }
}
```

Modify `packages/executor/src/codex-app-server-driver.ts` so `CodexAppServerProcessTransport` owns only process lifecycle and stdin/stdout wiring:

- `createInterface({ input: child.stdout }).on('line', (line) => client.acceptLine(line))`;
- `request(method, params)` delegates to `client.request(method, params)`;
- `#sendNotification(method)` delegates to `client.sendNotification(method)`;
- `notifications()` delegates to `client.notifications()`;
- process close/error calls `client.closeWithError(error)`.

Do not keep a second copy of pending-request maps, notification queues, request id counters, or JSON-RPC envelope construction in executor.

- [ ] **Step 5: Implement generation safety contracts**

Create `packages/codex-runtime/src/generation-safety.ts`:

```ts
import type { CodexGenerationTaskKind } from './types.js';

export interface GenerationLease {
  lease_id: string;
  expires_at: string;
}

export interface CodexGenerationRuntimeSafety {
  readonly taskKind: CodexGenerationTaskKind;
  readonly actionRunId: string;
  readonly projectId: string;
  readonly repoIds: string[];
  readonly artifactRoot: string;
  readonly workspaceRoot?: string;
  readonly policyDigests: Record<string, string>;
  createGenerationLease(input: {
    promptDigest: string;
    contextDigest: string;
    outputSchemaVersion: string;
    now: string;
    expiresAt: string;
  }): Promise<GenerationLease>;
  consumeGenerationCommand(input: {
    lease: GenerationLease;
    method: string;
    commandDigest: string;
    nonce: string;
    now: string;
  }): Promise<void>;
}
```

- [ ] **Step 6: Implement governed endpoint transport**

Create `packages/codex-runtime/src/app-server-endpoint-transport.ts`:

```ts
import { createConnection, type Socket } from 'node:net';
import { CodexAppServerJsonRpcClient } from './app-server-json-rpc.js';
import type { CodexAppServerTransport } from './app-server-protocol.js';

export interface ParsedCodexAppServerEndpoint {
  type: 'unix';
  path: string;
}

export const parseCodexAppServerEndpoint = (endpoint: string | undefined): ParsedCodexAppServerEndpoint => {
  if (endpoint === undefined || endpoint.trim().length === 0) {
    throw new Error('codex_app_server_endpoint_missing');
  }
  if (/^(exec|cli|spawn|stdio):?/i.test(endpoint)) {
    throw new Error('codex_app_server_endpoint_invalid');
  }
  if (!endpoint.startsWith('unix:/')) {
    throw new Error('codex_app_server_endpoint_invalid');
  }
  const socketPath = endpoint.slice('unix:'.length);
  if (!socketPath.startsWith('/')) {
    throw new Error('codex_app_server_endpoint_invalid');
  }
  return { type: 'unix', path: socketPath };
};

export class CodexAppServerEndpointTransport implements CodexAppServerTransport {
  private socket: Socket | undefined;
  private receiveBuffer = '';
  private client: CodexAppServerJsonRpcClient | undefined;

  constructor(private readonly endpoint: string) {}

  async initialize(): Promise<void> {
    const parsed = parseCodexAppServerEndpoint(this.endpoint);
    this.socket = createConnection(parsed.path);
    this.client = new CodexAppServerJsonRpcClient({
      writeLine: async (line) => {
        if (this.socket === undefined) throw new Error('codex_app_server_unavailable');
        await new Promise<void>((resolve, reject) => {
          this.socket?.write(`${line}\n`, (error) => {
            if (error !== undefined && error !== null) reject(error);
            else resolve();
          });
        });
      },
      close: async () => {
        this.socket?.end();
      },
    });
    this.socket.on('data', (chunk) => this.handleData(chunk));
    this.socket.on('close', () => this.client?.closeWithError(new Error('Codex app-server socket closed.')));
    this.socket.on('error', (error) => {
      this.client?.closeWithError(Object.assign(new Error('codex_app_server_unavailable'), { cause: error }));
    });
    await new Promise<void>((resolve, reject) => {
      this.socket?.once('connect', resolve);
      this.socket?.once('error', reject);
    }).catch((error) => {
      throw Object.assign(new Error('codex_app_server_unavailable'), { cause: error });
    });
    await this.client.request('initialize', {
      clientInfo: { name: 'forgeloop', title: 'Forgeloop', version: '0.0.0' },
      capabilities: null,
    });
    await this.client.sendNotification('initialized');
  }

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.client === undefined) throw new Error('codex_app_server_unavailable');
    return this.client.request(method, params);
  }

  notifications(): AsyncIterable<unknown> {
    if (this.client === undefined) throw new Error('codex_app_server_unavailable');
    return this.client.notifications();
  }

  async close(): Promise<void> {
    this.client?.closeWithError(new Error('Codex app-server socket was closed.'));
    this.socket?.end();
    this.socket = undefined;
  }

  private handleData(chunk: Buffer): void {
    this.receiveBuffer += chunk.toString('utf8');
    const lines = this.receiveBuffer.split('\n');
    this.receiveBuffer = lines.pop() ?? '';
    for (const line of lines.filter(Boolean)) {
      this.client?.acceptLine(line);
    }
  }
}
```

This first endpoint transport is deliberately narrow: only pre-existing app-server Unix sockets are valid. It must not spawn `codex`, shell out, or accept `exec:` style endpoint strings. If the real app-server protocol uses a different framed JSON-RPC envelope, adjust `app-server-json-rpc.ts` once and keep both executor and generation transports on that shared implementation.

- [ ] **Step 7: Implement generation safety factory**

Create `packages/codex-runtime/src/generation-safety-factory.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { CodexGenerationTaskKind } from './types.js';
import type { CodexGenerationRuntimeSafety, GenerationLease } from './generation-safety.js';

export interface CreateCodexGenerationRuntimeSafetyInput {
  taskKind: CodexGenerationTaskKind;
  actionRunId: string;
  projectId: string;
  repoIds: string[];
  artifactRoot: string | undefined;
  workspaceRoot?: string;
  policyDigests: Record<string, string>;
}

export const createCodexGenerationRuntimeSafety = (
  input: CreateCodexGenerationRuntimeSafetyInput,
): CodexGenerationRuntimeSafety => {
  if (input.artifactRoot === undefined || !input.artifactRoot.startsWith('/')) {
    throw new Error('codex_generation_safety_unavailable');
  }
  for (const repoId of input.repoIds) {
    if (input.policyDigests[repoId] === undefined) throw new Error('codex_generation_safety_unavailable');
  }
  return {
    taskKind: input.taskKind,
    actionRunId: input.actionRunId,
    projectId: input.projectId,
    repoIds: [...input.repoIds],
    artifactRoot: input.artifactRoot,
    workspaceRoot: input.workspaceRoot,
    policyDigests: { ...input.policyDigests },
    async createGenerationLease({ expiresAt }): Promise<GenerationLease> {
      return { lease_id: `gen_lease_${randomUUID()}`, expires_at: expiresAt };
    },
    async consumeGenerationCommand({ method }): Promise<void> {
      const allowed = new Set(['thread/start', 'turn/start', 'turn/interrupt', 'turn/steer']);
      if (!allowed.has(method)) throw new Error('codex_generation_command_invalid');
    },
  };
};
```

Daemon startup must validate static app-server config and `FORGELOOP_CODEX_GENERATION_ARTIFACT_ROOT` when `FORGELOOP_CODEX_GENERATION_DRIVER=app_server`. The action-scoped safety factory is called after the daemon fetches generation context; missing repo policy digests block that action before `thread/start`, not daemon startup.

- [ ] **Step 8: Implement the generation-specific app-server session adapter**

Create `packages/codex-runtime/src/app-server-generation-driver.ts` with these behaviors:

```ts
import { createHash, randomUUID } from 'node:crypto';
import { extractSingleJsonObject } from './json-output.js';
import {
  effectiveConfigFromResponse,
  appServerResultFromResponse,
  isRecord,
  textInput,
  type CodexAppServerTransport,
  type CodexEffectiveConfig,
} from './app-server-protocol.js';
import type { CodexGenerationTaskKind } from './types.js';
import type { CodexGenerationRuntimeSafety, GenerationLease } from './generation-safety.js';

export interface AppServerGenerateInput {
  taskKind: CodexGenerationTaskKind;
  prompt: string;
  outputSchemaVersion: string;
  contextDigest?: string;
  timeoutMs?: number;
}

export interface AppServerGenerateOutput {
  assistantText: string;
  extractedJson: unknown;
  rawArtifactRefs: Record<string, unknown>[];
}

const digest = (value: unknown): string =>
  `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

const sandboxType = (config: CodexEffectiveConfig | undefined): string | undefined => {
  const sandbox = config?.sandboxPolicy ?? config?.sandbox;
  if (typeof sandbox === 'string') return sandbox;
  if (isRecord(sandbox) && typeof sandbox.type === 'string') return sandbox.type;
  return undefined;
};

const allowedGenerationSandboxTypes = new Set(['readOnly', 'read-only', 'artifactOnly', 'artifact-only']);

const isInsideArtifactRoot = (path: string, artifactRoot: string): boolean =>
  path === artifactRoot || path.startsWith(`${artifactRoot}/`);

const assertSafeEffectiveConfig = (config: CodexEffectiveConfig | undefined, safety: CodexGenerationRuntimeSafety): void => {
  const type = sandboxType(config);
  if (type === undefined || !allowedGenerationSandboxTypes.has(type) || /danger/i.test(type) || /full.?access/i.test(type)) {
    throw new Error('codex_generation_sandbox_invalid');
  }
  const writableRoots = config?.writableRoots ?? [];
  if ((type === 'readOnly' || type === 'read-only') && writableRoots.length > 0) {
    throw new Error('codex_generation_sandbox_invalid');
  }
  if (
    (type === 'artifactOnly' || type === 'artifact-only') &&
    (writableRoots.length === 0 || !writableRoots.every((root) => isInsideArtifactRoot(root, safety.artifactRoot)))
  ) {
    throw new Error('codex_generation_sandbox_invalid');
  }
};

export class AppServerGenerationDriver {
  constructor(
    private readonly options: {
      transport: CodexAppServerTransport;
      runtimeSafety?: CodexGenerationRuntimeSafety;
      nonceFactory?: () => string;
      now?: () => string;
    },
  ) {}

  async generate(input: AppServerGenerateInput): Promise<AppServerGenerateOutput> {
    const safety = this.options.runtimeSafety;
    if (safety === undefined) {
      throw new Error('codex_generation_safety_unavailable');
    }
    const now = this.options.now ?? (() => new Date().toISOString());
    const nonce = this.options.nonceFactory ?? (() => randomUUID());
    await this.options.transport.initialize?.();
    const lease = await safety.createGenerationLease({
      promptDigest: digest(input.prompt),
      contextDigest: input.contextDigest ?? digest({}),
      outputSchemaVersion: input.outputSchemaVersion,
      now: now(),
      expiresAt: new Date(Date.parse(now()) + (input.timeoutMs ?? 300_000)).toISOString(),
    });

    await this.consume(safety, lease, 'thread/start', input.prompt, nonce(), now());
    const threadResponse = await this.options.transport.request('thread/start', {
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly' },
    });
    assertSafeEffectiveConfig(effectiveConfigFromResponse(threadResponse), safety);

    const threadBody = appServerResultFromResponse(threadResponse);
    if (!isRecord(threadBody)) throw new Error('codex_app_server_unavailable');
    const threadIdValue = threadBody.threadId ?? threadBody.thread_id;
    if (typeof threadIdValue !== 'string' || threadIdValue.length === 0) throw new Error('codex_app_server_unavailable');
    const threadId = threadIdValue;
    await this.consume(safety, lease, 'turn/start', input.prompt, nonce(), now());
    await this.options.transport.request('turn/start', {
      threadId,
      input: textInput(input.prompt),
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly' },
    });

    const assistantText = await this.collectAssistantText();
    return { assistantText, extractedJson: extractSingleJsonObject(assistantText), rawArtifactRefs: [] };
  }

  private async consume(
    safety: CodexGenerationRuntimeSafety,
    lease: GenerationLease,
    method: string,
    command: unknown,
    nonce: string,
    now: string,
  ): Promise<void> {
    await safety.consumeGenerationCommand({ lease, method, commandDigest: digest(command), nonce, now });
  }

  private async collectAssistantText(): Promise<string> {
    let text = '';
    for await (const notification of this.options.transport.notifications?.() ?? []) {
      if (isRecord(notification) && typeof notification.delta === 'string') {
        text += notification.delta;
      }
      if (isRecord(notification) && (notification.type === 'turn_completed' || notification.type === 'thread_idle')) {
        break;
      }
    }
    if (text.trim().length === 0) {
      throw new Error('generated_output_invalid_json');
    }
    return text;
  }
}
```

Adjust notification parsing to match the real app-server notifications already normalized in `packages/executor/src/codex-event-normalizer.ts`. The test fixture above is the minimum; add cases for no output, multiple JSON objects, truncation, terminal success with invalid output, timeout, and cancellation.

- [ ] **Step 9: Implement runtime factory wiring for app-server mode**

In `packages/codex-runtime/src/runtime.ts`, ensure `createCodexGenerationRuntime(config)` returns a config-bound runtime and constructs endpoint transport plus per-action safety inside each app-server generation request before the app-server turn starts:

```ts
import { CodexAppServerEndpointTransport } from './app-server-endpoint-transport.js';
import { AppServerGenerationDriver } from './app-server-generation-driver.js';
import { createCodexGenerationRuntimeSafety } from './generation-safety-factory.js';
import type { CodexGenerationTaskKind } from './types.js';

export const createAppServerGenerationDriver = (input: {
  endpoint: string | undefined;
  taskKind: CodexGenerationTaskKind;
  actionRunId: string;
  projectId: string;
  repoIds: string[];
  artifactRoot: string | undefined;
  policyDigests: Record<string, string>;
}): AppServerGenerationDriver =>
  new AppServerGenerationDriver({
    transport: new CodexAppServerEndpointTransport(input.endpoint ?? ''),
    runtimeSafety: createCodexGenerationRuntimeSafety(input),
  });
```

Use this helper from each `CodexGenerationRuntime` method after the executor supplies `actionRunId`, `projectId`, `repoIds`, and `policyDigests`. Keep fake mode independent of endpoint and safety config. App-server mode must throw public-safe startup/runtime errors (`codex_app_server_endpoint_missing`, `codex_app_server_endpoint_invalid`, or `codex_generation_safety_unavailable`) instead of silently falling back to fake or CLI behavior.

- [ ] **Step 10: Export app-server generation contracts**

Update `packages/codex-runtime/src/index.ts`:

```ts
export * from './app-server-protocol.js';
export * from './app-server-json-rpc.js';
export * from './generation-safety.js';
export * from './generation-safety-factory.js';
export * from './app-server-endpoint-transport.js';
export * from './app-server-generation-driver.js';
export * from './runtime.js';
```

- [ ] **Step 11: Run app-server and executor regression tests**

Run:

```bash
pnpm test tests/codex-runtime/app-server-generation-driver.test.ts tests/executor/codex-session-driver.test.ts
pnpm --filter @forgeloop/codex-runtime build
pnpm --filter @forgeloop/executor build
```

Expected: PASS. Existing executor source-changing app-server tests must keep their current behavior.

- [ ] **Step 12: Commit app-server generation contracts**

```bash
git add packages/codex-runtime packages/executor tests/codex-runtime tests/executor pnpm-lock.yaml
git commit -m "feat: add governed app-server generation contracts"
```

---

### Task 3: Replace Planner Generation Mode with Task-Level Planning Config

**Files:**
- Modify: `packages/automation/src/types.ts`
- Modify: `packages/automation/src/planner.ts`
- Modify: `packages/automation/src/idempotency.ts`
- Modify: `apps/automation-daemon/src/config.ts`
- Modify: `apps/automation-daemon/src/automation-daemon.ts`
- Modify: `apps/automation-daemon/src/main.ts`
- Test: `tests/automation/planner.test.ts`
- Test: `tests/automation/idempotency.test.ts`
- Test: `tests/automation/daemon.test.ts`
- Test: `tests/automation/daemon-config.test.ts`

- [ ] **Step 1: Write failing planner config tests**

Add tests in `tests/automation/planner.test.ts`:

```ts
it('suppresses all generation actions when generation mode is disabled', () => {
  const actions = planNextActions(snapshotWithAllDraftTargets(), {
    generation: {
      mode: 'disabled',
      tasks: {
        spec_draft: { enabled: true, promptVersion: 'spec-draft.fake.v1', outputSchemaVersion: 'spec_draft.v1' },
        plan_draft: { enabled: true, promptVersion: 'plan-draft.fake.v1', outputSchemaVersion: 'plan_draft.v1' },
        package_drafts: { enabled: true, promptVersion: 'package-drafts.fake.v1', outputSchemaVersion: 'package_drafts.v1' },
      },
    },
  });
  expect(actions.map((action) => action.actionType)).not.toContain('ensure_spec_draft');
  expect(actions.map((action) => action.actionType)).not.toContain('ensure_plan_draft');
  expect(actions.map((action) => action.actionType)).not.toContain('ensure_package_drafts');
});

it('suppresses package draft actions in 2A when package_drafts is disabled', () => {
  const actions = planNextActions(snapshotWithApprovedPlanRequiringPackages(), {
    generation: {
      mode: 'fake',
      tasks: {
        spec_draft: { enabled: true, promptVersion: 'spec-draft.fake.v1', outputSchemaVersion: 'spec_draft.v1' },
        plan_draft: { enabled: true, promptVersion: 'plan-draft.fake.v1', outputSchemaVersion: 'plan_draft.v1' },
        package_drafts: { enabled: false, promptVersion: 'package-drafts.fake.v1', outputSchemaVersion: 'package_drafts.v1' },
      },
    },
  });
  expect(actions.map((action) => action.actionType)).not.toContain('ensure_package_drafts');
});
```

Use existing snapshot fixture helpers in the file. If they do not exist, add small local builders instead of reusing large integration fixtures.

- [ ] **Step 2: Write failing daemon config tests**

Add `tests/automation/daemon-config.test.ts`:

```ts
import { loadAutomationDaemonConfig } from '../../apps/automation-daemon/src/config';

const baseEnv = {
  FORGELOOP_CONTROL_PLANE_URL: 'http://127.0.0.1:3000',
  FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'secret',
  FORGELOOP_AUTOMATION_DAEMON_IDENTITY: 'daemon',
  FORGELOOP_AUTOMATION_ACTOR_ID: 'actor',
  FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS: '/tmp/repos',
};

it('defaults package_drafts to disabled for 2A', () => {
  const config = loadAutomationDaemonConfig({
    ...baseEnv,
    FORGELOOP_CODEX_AUTOMATION_GENERATION: 'fake',
  });
  expect(config.generationPlanning.tasks.package_drafts.enabled).toBe(false);
  expect(config.generationPlanning.tasks.plan_draft.enabled).toBe(true);
});

it.each(['cli', 'exec', 'exec_fallback', 'codex_exec'])('rejects forbidden generation driver %s', (driver) => {
  expect(() =>
    loadAutomationDaemonConfig({
      ...baseEnv,
      FORGELOOP_CODEX_GENERATION_DRIVER: driver,
    }),
  ).toThrow(/FORGELOOP_CODEX_GENERATION_DRIVER/);
});
```

- [ ] **Step 3: Run planner/config tests to verify they fail**

Run:

```bash
pnpm test tests/automation/planner.test.ts tests/automation/idempotency.test.ts tests/automation/daemon-config.test.ts
```

Expected: FAIL because `generationPlanning` and task-level options do not exist.

- [ ] **Step 4: Add task-level generation planning types**

In `packages/automation/src/types.ts` add:

```ts
export interface AutomationGenerationPlanningConfig {
  mode: 'disabled' | 'fake' | 'app_server';
  tasks: {
    spec_draft: { enabled: boolean; promptVersion: string; outputSchemaVersion: 'spec_draft.v1' };
    plan_draft: { enabled: boolean; promptVersion: string; outputSchemaVersion: 'plan_draft.v1' };
    package_drafts: { enabled: boolean; promptVersion: string; outputSchemaVersion: 'package_drafts.v1' };
  };
}
```

- [ ] **Step 5: Update planner action gating and identity**

In `packages/automation/src/planner.ts`:

- Replace `specDraftGenerationMode?: AutomationGenerationMode` with `generation?: AutomationGenerationPlanningConfig`.
- Add `defaultGenerationPlanningConfig` where all tasks are disabled.
- Suppress all generation actions when `mode === 'disabled'`.
- Suppress any task with `enabled: false`.
- Add generation mode, task prompt version, and output schema version to each generation action idempotency identity.
- Keep `project_runtime_snapshot` behavior unchanged.

Use this helper shape:

```ts
const generationTaskFor = (
  config: AutomationGenerationPlanningConfig,
  task: keyof AutomationGenerationPlanningConfig['tasks'],
) => (config.mode === 'disabled' ? { ...config.tasks[task], enabled: false } : config.tasks[task]);
```

- [ ] **Step 6: Update daemon config and wiring**

In `apps/automation-daemon/src/config.ts`:

- Keep `FORGELOOP_CODEX_AUTOMATION_GENERATION=disabled|fake|codex` compatibility.
- Add `FORGELOOP_CODEX_GENERATION_DRIVER=fake|app_server`.
- Map legacy `codex` to `app_server`.
- Reject conflicting legacy/new driver values.
- Reject `cli`, `exec`, `exec_fallback`, and `codex_exec`.
- Add task flags:
  - `FORGELOOP_CODEX_GENERATION_SPEC_DRAFT_ENABLED`
  - `FORGELOOP_CODEX_GENERATION_PLAN_DRAFT_ENABLED`
  - `FORGELOOP_CODEX_GENERATION_PACKAGE_DRAFTS_ENABLED`
- Default for `fake`/`app_server` in 2A:
  - `spec_draft.enabled=true`
  - `plan_draft.enabled=true`
  - `package_drafts.enabled=false`

In `apps/automation-daemon/src/automation-daemon.ts`, pass `generationPlanning` to `planNextActions`.

In `apps/automation-daemon/src/main.ts`, stop passing only `specDraftGenerationMode`.

- [ ] **Step 7: Run focused planner/config tests**

Run:

```bash
pnpm test tests/automation/planner.test.ts tests/automation/idempotency.test.ts tests/automation/daemon.test.ts tests/automation/daemon-config.test.ts
pnpm --filter @forgeloop/automation build
pnpm --filter @forgeloop/automation-daemon build
```

Expected: PASS.

- [ ] **Step 8: Commit planner generation config**

```bash
git add packages/automation apps/automation-daemon tests/automation
git commit -m "feat: add task-level generation planning config"
```

---

### Task 4: Add Plan Draft Generation Context Endpoint

**Files:**
- Modify: `packages/automation/src/types.ts`
- Modify: `packages/automation/src/http-client.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation.dto.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation.controller.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation-generation-context.service.ts`
- Test: `tests/api/automation-commands.test.ts`
- Test: `tests/automation/executor.test.ts`

- [ ] **Step 1: Write failing API tests for Plan generation context**

In `tests/api/automation-commands.test.ts`, add tests next to existing Spec generation-context tests:

```ts
it('returns Plan generation context for an active claimed ensure_plan_draft action', async () => {
  const ctx = await seedApprovedSpecAndClaimedPlanAction();
  const response = await request(server)
    .get(
      `/internal/automation/generation-context/work-items/${ctx.workItem.id}/plan-draft?spec_revision_id=${ctx.specRevisionId}&action_run_id=${ctx.actionId}&claim_token=${ctx.claimToken}`,
    )
    .set(trustedDaemonHeaders())
    .expect(200);

  expect(response.body).toMatchObject({
    context_version: 'generation_context.plan.v1',
    action_run_id: ctx.actionId,
    work_item: { id: ctx.workItem.id },
    spec_revision: { id: ctx.specRevisionId },
  });
  expect(JSON.stringify(response.body)).not.toContain(ctx.claimToken);
});

it('rejects Plan context when Spec approved_revision_id is missing or stale', async () => {
  const ctx = await seedApprovedSpecAndClaimedPlanAction({ approvedRevisionId: undefined });
  await request(server)
    .get(
      `/internal/automation/generation-context/work-items/${ctx.workItem.id}/plan-draft?spec_revision_id=${ctx.specRevisionId}&action_run_id=${ctx.actionId}&claim_token=${ctx.claimToken}`,
    )
    .set(trustedDaemonHeaders())
    .expect(409);
});
```

Use existing helpers in the test file; if helper names differ, add a small local helper that seeds an approved Spec, creates `ensure_plan_draft`, claims it, and returns ids.

- [ ] **Step 2: Run API tests to verify they fail**

Run: `pnpm test tests/api/automation-commands.test.ts -t "Plan generation context"`

Expected: FAIL because the Plan context route does not exist.

- [ ] **Step 3: Add context types and HTTP client method**

In `packages/automation/src/types.ts`, add `AutomationGenerationPlanContextV1` exactly matching the spec.

In `packages/automation/src/http-client.ts`, add:

```ts
async planDraftGenerationContext(
  workItemId: string,
  input: { specRevisionId: string; actionRunId: string; claimToken: string },
): Promise<AutomationGenerationPlanContextV1> {
  const query = new URLSearchParams({
    spec_revision_id: input.specRevisionId,
    action_run_id: input.actionRunId,
    claim_token: input.claimToken,
  });
  return this.request(
    'GET',
    `/internal/automation/generation-context/work-items/${workItemId}/plan-draft?${query.toString()}`,
  ) as Promise<AutomationGenerationPlanContextV1>;
}
```

- [ ] **Step 4: Add DTO/context schema**

In `apps/control-plane-api/src/modules/automation/automation.dto.ts`, add:

```ts
export const planGenerationContextQuerySchema = z
  .object({
    spec_revision_id: nonBlankString,
    action_run_id: nonBlankString,
    claim_token: nonBlankString,
  })
  .strict();

export type PlanGenerationContextQueryDto = z.infer<typeof planGenerationContextQuerySchema>;
```

Add `AutomationGenerationPlanContextV1` interface matching the spec.

- [ ] **Step 5: Add service method and controller route**

In `apps/control-plane-api/src/modules/automation/automation-generation-context.service.ts`, add `getPlanDraftContext(workItemId, query)` that validates:

- active action claim;
- action type `ensure_plan_draft`;
- target object type/id;
- action input `work_item_id` and `spec_revision_id`;
- WorkItem non-terminal;
- Spec belongs to WorkItem;
- Spec `status === 'approved'`;
- Spec `resolution === 'approved'`;
- `approved_revision_id` exists;
- `current_revision_id === approved_revision_id`;
- query `spec_revision_id === approved_revision_id`;
- active holds block context loading.

In `apps/control-plane-api/src/modules/automation/automation.controller.ts`, add:

```ts
@Get('generation-context/work-items/:workItemId/plan-draft')
planDraftGenerationContext(
  @Param('workItemId') workItemId: string,
  @Query(new ZodValidationPipe(planGenerationContextQuerySchema)) query: PlanGenerationContextQueryDto,
) {
  return this.automationGenerationContextService.getPlanDraftContext(workItemId, query);
}
```

- [ ] **Step 6: Run focused context tests**

Run:

```bash
pnpm test tests/api/automation-commands.test.ts -t "Plan generation context"
pnpm --filter @forgeloop/automation build
pnpm --filter @forgeloop/control-plane-api build
```

Expected: PASS.

- [ ] **Step 7: Commit Plan context endpoint**

```bash
git add packages/automation apps/control-plane-api tests/api
git commit -m "feat: add plan generation context endpoint"
```

---

### Task 5: Require Generated Plan Payload at Command Boundary

**Files:**
- Modify: `packages/automation/src/types.ts`
- Modify: `packages/automation/src/http-client.ts`
- Modify: `packages/automation/src/executor.ts`
- Modify: `apps/control-plane-api/package.json`
- Modify: `apps/control-plane-api/src/modules/automation/automation.dto.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation-command.service.ts`
- Test: `tests/automation/executor.test.ts`
- Test: `tests/api/automation-commands.test.ts`

- [ ] **Step 1: Write failing executor test for generated Plan command payload**

In `tests/automation/executor.test.ts`, update/add:

```ts
it('generates and sends a Plan draft payload before ensurePlanDraft', async () => {
  const client = new FakeAutomationClient();
  client.planContext = validPlanGenerationContext();
  const runtime = fakeGenerationRuntimeReturning({
    taskKind: 'plan_draft',
    generated: validGeneratedPlanDraft({ summary: 'Generated summary' }),
    generationArtifacts: [{ kind: 'logs', name: 'plan-generation.json', content_type: 'application/json', storage_uri: 'artifact://plan-generation.json', digest: 'sha256:plan' }],
  });

  await executeActionRun({
    client,
    action: claimedEnsurePlanDraftAction(),
    actorId: 'actor-automation',
    daemonIdentity: 'daemon-main',
    generationRuntime: runtime,
  });

  expect(client.calls.find((call) => call.method === 'ensurePlanDraft')?.args[1]).toMatchObject({
    generated_plan_draft: { summary: 'Generated summary' },
    generation_artifacts: [{ kind: 'logs', name: 'plan-generation.json', content_type: 'application/json', storage_uri: 'artifact://plan-generation.json', digest: 'sha256:plan' }],
  });
});
```

- [ ] **Step 2: Write failing API tests for generated Plan command**

In `tests/api/automation-commands.test.ts`, add:

```ts
it('daemon ensure-plan-draft requires generated_plan_draft', async () => {
  const ctx = await seedApprovedSpecAndClaimedPlanAction();
  await request(server)
    .post(`/internal/automation/work-items/${ctx.workItem.id}/ensure-plan-draft`)
    .set(trustedDaemonHeaders())
    .send({
      action_run_id: ctx.actionId,
      claim_token: ctx.claimToken,
      idempotency_key: ctx.idempotencyKey,
      automation_precondition: ctx.precondition,
      spec_revision_id: ctx.specRevisionId,
    })
    .expect(400);
});

it('persists generated Plan fields and generation artifacts', async () => {
  const ctx = await seedApprovedSpecAndClaimedPlanAction();
  const payload = validGeneratedPlanDraft({ summary: 'Generated plan summary', dependency_order: ['api', 'tests'] });
  const response = await request(server)
    .post(`/internal/automation/work-items/${ctx.workItem.id}/ensure-plan-draft`)
    .set(trustedDaemonHeaders())
    .send({
      action_run_id: ctx.actionId,
      claim_token: ctx.claimToken,
      idempotency_key: ctx.idempotencyKey,
      automation_precondition: ctx.precondition,
      spec_revision_id: ctx.specRevisionId,
      generated_plan_draft: payload,
      generation_artifacts: [{ kind: 'logs', name: 'plan-generation.json', content_type: 'application/json', storage_uri: 'artifact://plan-generation.json', digest: 'sha256:plan' }],
    })
    .expect(201);

  const revision = await repository.getPlanRevision(response.body.plan_revision_id);
  expect(revision).toMatchObject({
    summary: 'Generated plan summary',
    dependency_order: ['api', 'tests'],
    artifact_refs: [{ kind: 'logs', name: 'plan-generation.json', content_type: 'application/json', storage_uri: 'artifact://plan-generation.json', digest: 'sha256:plan' }],
  });
});

it('blocks idempotency key reuse with a different generated Plan payload digest', async () => {
  const ctx = await seedApprovedSpecAndClaimedPlanAction();
  await postGeneratedPlan(ctx, validGeneratedPlanDraft({ summary: 'First' })).expect(201);
  await postGeneratedPlan(ctx, validGeneratedPlanDraft({ summary: 'Second' })).expect(409);
});

it('rejects generated Plan artifact refs with local paths before persistence', async () => {
  const ctx = await seedApprovedSpecAndClaimedPlanAction();
  await request(server)
    .post(`/internal/automation/work-items/${ctx.workItem.id}/ensure-plan-draft`)
    .set(trustedDaemonHeaders())
    .send({
      action_run_id: ctx.actionId,
      claim_token: ctx.claimToken,
      idempotency_key: ctx.idempotencyKey,
      automation_precondition: ctx.precondition,
      spec_revision_id: ctx.specRevisionId,
      generated_plan_draft: validGeneratedPlanDraft({ summary: 'Generated plan summary' }),
      generation_artifacts: [{ kind: 'logs', name: 'raw.log', content_type: 'text/plain', local_ref: '/tmp/raw.log' }],
    })
    .expect(400);
});
```

- [ ] **Step 3: Run executor/API tests to verify they fail**

Run:

```bash
pnpm test tests/automation/executor.test.ts -t "Plan draft payload"
pnpm test tests/api/automation-commands.test.ts -t "generated Plan"
```

Expected: FAIL because command DTO and executor do not yet send generated Plan payloads.

- [ ] **Step 4: Update automation command/client types**

In `packages/automation/src/types.ts`, change `EnsurePlanDraftCommandInput`:

```ts
export interface EnsurePlanDraftCommandInput {
  action_run_id: string;
  claim_token?: string;
  idempotency_key: string;
  automation_precondition: AutomationPrecondition;
  spec_revision_id: string;
  generated_plan_draft: GeneratedPlanDraftV1;
  generation_artifacts: ArtifactRef[];
}
```

- [ ] **Step 5: Update API DTO schema**

In `apps/control-plane-api/src/modules/automation/automation.dto.ts`:

```ts
import { generatedPlanDraftSchema } from '@forgeloop/codex-runtime';

export const ensurePlanDraftCommandSchema = z
  .object({
    ...internalCommandBaseShape,
    spec_revision_id: nonBlankString,
    generated_plan_draft: generatedPlanDraftSchema,
    generation_artifacts: z.array(artifactRefSchema).default([]),
  })
  .strict();
```

Import the schema from `@forgeloop/codex-runtime`; do not mirror the schema in the control plane.

- [ ] **Step 6: Add command-side generated payload digest helper**

In `apps/control-plane-api/src/modules/automation/automation-command.service.ts`, add:

```ts
const canonicalizeForDigest = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalizeForDigest);
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) result[key] = canonicalizeForDigest(entry);
      return result;
    }, {});
};

const generatedPayloadDigest = (value: unknown): string =>
  `sha256:${createHash('sha256').update(JSON.stringify(canonicalizeForDigest(value))).digest('hex')}`;

const stripUndefined = <T extends Record<string, unknown>>(value: T): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));

const unsafeArtifactTextPattern =
  /(?:\/Users\/[^\s]+|\/home\/[^\s]+|\/tmp\/[^\s]+|\/var\/folders\/[^\s]+|\/private\/[^\s]+|[A-Za-z]:\\[^\s]+|claim[-_ ]?token|hmac|secret|api[-_ ]?key|raw\s+(?:prompt|output|log))/i;

const assertPublicArtifactText = (value: string, errorCode: string): void => {
  if (unsafeArtifactTextPattern.test(value)) {
    throw new BadRequestException({
      code: errorCode,
      message: 'Generated artifact refs must not expose local paths, secrets, or raw logs.',
    });
  }
};

const safeGenerationArtifactRefs = (artifacts: ArtifactRef[]): ArtifactRef[] =>
  artifacts.map((artifact) => {
    assertPublicArtifactText(artifact.name, 'generated_artifact_ref_invalid');
    assertPublicArtifactText(artifact.content_type, 'generated_artifact_ref_invalid');
    if (artifact.digest !== undefined) assertPublicArtifactText(artifact.digest, 'generated_artifact_ref_invalid');
    if (artifact.local_ref !== undefined) {
      throw new BadRequestException({
        code: 'generated_artifact_ref_invalid',
        message: 'Generated artifact refs persisted on product records must use public artifact storage URIs.',
      });
    }
    if (artifact.storage_uri === undefined || !artifact.storage_uri.startsWith('artifact://')) {
      throw new BadRequestException({
        code: 'generated_artifact_ref_invalid',
        message: 'Generated artifact refs persisted on product records must use artifact:// storage URIs.',
      });
    }
    assertPublicArtifactText(artifact.storage_uri, 'generated_artifact_ref_invalid');
    return stripUndefined({
      kind: artifact.kind,
      name: artifact.name,
      content_type: artifact.content_type,
      storage_uri: artifact.storage_uri,
      digest: artifact.digest,
    }) as ArtifactRef;
  });

const publicArtifactIdentity = (artifacts: ArtifactRef[]): Array<Record<string, unknown>> =>
  safeGenerationArtifactRefs(artifacts).map((artifact) =>
    stripUndefined({
      kind: artifact.kind,
      name: artifact.name,
      content_type: artifact.content_type,
      storage_uri: artifact.storage_uri,
      digest: artifact.digest,
    }),
  );
```

Import `createHash` from `node:crypto` next to `randomUUID`, and import `ArtifactRef` from `@forgeloop/contracts` if it is not already in scope. `safeGenerationArtifactRefs` is the command-boundary sanitizer for PlanRevision `artifact_refs` and Package generation run `evidence_refs`; it rejects `local_ref`, absolute paths, raw log markers, secrets, and non-`artifact://` storage URIs. `publicArtifactIdentity` deliberately excludes local refs, absolute paths, raw log text, and any non-artifact storage URI from idempotency metadata and public `result_json`.

Store this digest in command idempotency metadata before replay or persistence. The existing repository compares `precondition_fingerprint` on `claimCommandIdempotency`, so compute a command-level fingerprint that includes both the normalized automation precondition fingerprint and the generated payload digest:

```ts
const planPayloadDigest = generatedPayloadDigest({
  generated_plan_draft: input.generated_plan_draft,
  generation_artifacts: publicArtifactIdentity(input.generation_artifacts),
});
const commandPreconditionJson = {
  automation_precondition: precondition,
  generated_payload_digest: planPayloadDigest,
  generation_artifact_identity: publicArtifactIdentity(input.generation_artifacts),
};
const commandPreconditionFingerprint = generatedPayloadDigest(commandPreconditionJson);
```

Pass `commandPreconditionJson` and `commandPreconditionFingerprint` to `repository.claimCommandIdempotency` instead of the raw automation precondition and action precondition fingerprint:

```ts
const claim = await repository.claimCommandIdempotency({
  // existing fields...
  precondition_json: commandPreconditionJson,
  precondition_fingerprint: commandPreconditionFingerprint,
  actor_scope: actorScope,
});
```

Also copy `generated_payload_digest` into successful command `result_json` for public-safe diagnostics. If an existing idempotency record has the same idempotency key but a different command precondition fingerprint, translate the repository conflict to:

```ts
throw new ConflictException({
  code: 'generated_payload_idempotency_drift',
  message: 'Generated payload differs for the same idempotency key.',
});
```

- [ ] **Step 7: Update Plan writer boundary**

Update `ensurePlanDraftForClaimedAction` and `writePlanDraftForApprovedSpec`:

- Require generated payload.
- Revalidate active action claim.
- Revalidate Spec approved state using `approved_revision_id`, not only current revision.
- Reject when `approved_revision_id` missing.
- Reject when `current_revision_id !== approved_revision_id`.
- Reject when requested `spec_revision_id !== approved_revision_id`.
- Persist generated fields:
  - `summary`
  - `content`
  - `implementation_summary`
  - `split_strategy`
  - `dependency_order`
  - `test_matrix`
  - `risk_mitigations`
  - `rollback_notes`
  - `structured_document`
  - `artifact_refs`
- Persist `artifact_refs` from `safeGenerationArtifactRefs(input.generation_artifacts)`, not raw `input.generation_artifacts`.
- Leave Plan draft; do not submit or approve.

- [ ] **Step 8: Wire executor Plan generation**

In `packages/automation/src/executor.ts`:

- Add `generationRuntime` option.
- For `ensure_plan_draft`, fetch `planDraftGenerationContext`.
- Call runtime task `plan_draft`.
- Validate `GeneratedPlanDraftV1`.
- Call `client.ensurePlanDraft` with generated payload and artifact refs.
- Map invalid app-server output to retryable failure.
- Map stable fake invalid output to non-retryable block.

- [ ] **Step 9: Run Plan command test set**

Run:

```bash
pnpm test tests/automation/executor.test.ts tests/api/automation-commands.test.ts -t "Plan"
pnpm --filter @forgeloop/automation build
pnpm --filter @forgeloop/control-plane-api build
```

Expected: PASS.

- [ ] **Step 10: Commit generated Plan command boundary**

```bash
git add packages/automation apps/control-plane-api tests/automation tests/api
git commit -m "feat: require generated plan draft payloads"
```

---

### Task 6: Wire 2A Daemon Runtime and Human Gate E2E

**Files:**
- Modify: `packages/automation/src/executor.ts`
- Modify: `packages/automation/src/spec-draft-generation.ts`
- Modify: `packages/automation/src/index.ts`
- Modify: `apps/automation-daemon/package.json`
- Modify: `apps/automation-daemon/src/automation-daemon.ts`
- Modify: `apps/automation-daemon/src/main.ts`
- Test: `tests/automation/executor.test.ts`
- Test: `tests/automation/daemon.test.ts`
- Test: `tests/api/automation-daemon.integration.test.ts`

- [ ] **Step 1: Write failing 2A daemon integration tests**

In `tests/api/automation-daemon.integration.test.ts`, add:

```ts
it('2A generates a Plan draft but suppresses Package generation until package_drafts is enabled', async () => {
  const ctx = await seedWorkItemWithApprovedSpec({ generationMode: 'fake' });
  const daemon = createAutomationDaemonForTest({
    generationPlanning: {
      mode: 'fake',
      tasks: {
        spec_draft: { enabled: true, promptVersion: 'spec-draft.fake.v1', outputSchemaVersion: 'spec_draft.v1' },
        plan_draft: { enabled: true, promptVersion: 'plan-draft.fake.v1', outputSchemaVersion: 'plan_draft.v1' },
        package_drafts: { enabled: false, promptVersion: 'package-drafts.fake.v1', outputSchemaVersion: 'package_drafts.v1' },
      },
    },
  });

  await daemon.runOnce();
  const plan = await repository.getPlan(ctx.workItem.current_plan_id!);
  expect(plan?.status).toBe('draft');
  expect(plan?.approved_revision_id).toBeUndefined();

  await approveCurrentPlanRevisionAsHuman(ctx);
  await daemon.runOnce();

  const runs = await repository.listAutomationActionRunsForWorkItem(ctx.workItem.id);
  expect(runs.map((run) => run.action_type)).not.toContain('ensure_package_drafts');
});

it('daemon never submits or approves Spec or Plan during generation', async () => {
  const ctx = await seedWorkItemWithApprovedSpec({ generationMode: 'fake' });
  await createAutomationDaemonForTest().runOnce();
  const plan = await repository.getPlan(ctx.workItem.current_plan_id!);
  expect(plan).toMatchObject({ status: 'draft', resolution: undefined });
});
```

- [ ] **Step 2: Run 2A daemon tests to verify they fail**

Run: `pnpm test tests/api/automation-daemon.integration.test.ts -t "2A|never submits"`

Expected: FAIL until daemon uses runtime and package task suppression consistently.

- [ ] **Step 3: Consolidate Spec fake generation behind runtime**

Update executor and daemon callers to use the generic generation runtime for Spec drafts the same way they use Plan and Package generation. Then reduce `packages/automation/src/spec-draft-generation.ts` to a temporary compatibility surface only for validators/constants still imported by tests:

```ts
export {
  createFakeSpecDraft,
  specDraftOutputSchemaVersion,
  specDraftPromptVersion,
  validateGeneratedSpecDraft,
} from '@forgeloop/codex-runtime';
```

Do not introduce or re-export the old spec-generator wrapper APIs or a new spec-only generator abstraction. If import cycles appear, resolve them by moving the remaining shared Spec draft type/schema into `@forgeloop/codex-runtime` before continuing. Do not keep a permanent automation-owned generation implementation.

- [ ] **Step 4: Update daemon to use one runtime instance**

In `apps/automation-daemon/src/main.ts`, build one runtime:

```ts
const generationRuntime = createCodexGenerationRuntime({
  mode: config.generationPlanning.mode,
  artifactRoot: config.codexGenerationArtifactRoot,
  appServerEndpoint: config.codexAppServerEndpoint,
  turnTimeoutMs: config.codexGenerationTurnTimeoutMs,
  outputLimitBytes: config.codexGenerationOutputLimitBytes,
});
```

In `apps/automation-daemon/src/automation-daemon.ts`, pass both `generationPlanning` and `generationRuntime`. In `packages/automation/src/executor.ts`, pass per-action runtime metadata into the runtime call:

```ts
await generationRuntime.generatePlanDraft({
  actionRunId: actionRun.id,
  projectId: context.work_item.project_id,
  repoIds: context.repos.map((repo) => repo.repo_id),
  context,
  promptVersion: generationPlanning.tasks.plan_draft.promptVersion,
  outputSchemaVersion: generationPlanning.tasks.plan_draft.outputSchemaVersion,
  policyDigests: Object.fromEntries(context.repos.map((repo) => [repo.repo_id, repo.policy_digest])),
});
```

Do not bake `actionRunId`, project id, repo ids, or policy digests into the daemon-wide runtime object; those values are action-specific.

- [ ] **Step 5: Ensure public-safe failure mapping**

In `packages/automation/src/executor.ts`, update `errorCode`, `isBlockedByGate`, and `resultJsonForError` for:

- `codex_generation_safety_unavailable`
- `codex_generation_sandbox_invalid`
- `codex_app_server_unavailable`
- `generated_output_invalid_json`
- `generated_output_schema_invalid`
- `generated_plan_draft_invalid`
- `generated_payload_idempotency_drift`

Do not include raw output or local paths in `result_json`.

- [ ] **Step 6: Run 2A test suite**

Run:

```bash
pnpm test tests/codex-runtime tests/automation/planner.test.ts tests/automation/executor.test.ts tests/automation/daemon.test.ts tests/api/automation-commands.test.ts tests/api/automation-daemon.integration.test.ts
pnpm --filter @forgeloop/codex-runtime build
pnpm --filter @forgeloop/automation build
pnpm --filter @forgeloop/automation-daemon build
pnpm --filter @forgeloop/control-plane-api build
```

Expected: PASS.

- [ ] **Step 7: Commit 2A daemon wiring**

```bash
git add packages/codex-runtime packages/automation apps/automation-daemon apps/control-plane-api tests
git commit -m "feat: wire generated plan drafts through daemon runtime"
```

---

### Task 7: Add Package Draft Generation Context Endpoint

**Files:**
- Modify: `packages/automation/src/types.ts`
- Modify: `packages/automation/src/http-client.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation.dto.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation.controller.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation-generation-context.service.ts`
- Test: `tests/api/automation-commands.test.ts`
- Test: `tests/automation/executor.test.ts`

- [ ] **Step 1: Write failing Package context API tests**

In `tests/api/automation-commands.test.ts`, add:

```ts
it('returns Package generation context for an approved PlanRevision and active claim', async () => {
  const ctx = await seedApprovedPlanAndClaimedPackageAction({ dependencyOrder: ['api', 'tests'] });
  const response = await request(server)
    .get(
      `/internal/automation/generation-context/plan-revisions/${ctx.planRevisionId}/package-drafts?generation_key=${ctx.generationKey}&action_run_id=${ctx.actionId}&claim_token=${ctx.claimToken}`,
    )
    .set(trustedDaemonHeaders())
    .expect(200);

  expect(response.body).toMatchObject({
    context_version: 'generation_context.package.v1',
    generation_key: ctx.generationKey,
    plan_revision: { id: ctx.planRevisionId, dependency_order: ['api', 'tests'] },
  });
  expect(JSON.stringify(response.body)).not.toContain(ctx.claimToken);
});

it('rejects Package context when Plan approved_revision_id is stale', async () => {
  const ctx = await seedApprovedPlanAndClaimedPackageAction({ staleApprovedRevision: true });
  await request(server)
    .get(
      `/internal/automation/generation-context/plan-revisions/${ctx.planRevisionId}/package-drafts?generation_key=${ctx.generationKey}&action_run_id=${ctx.actionId}&claim_token=${ctx.claimToken}`,
    )
    .set(trustedDaemonHeaders())
    .expect(409);
});
```

- [ ] **Step 2: Run Package context tests to verify they fail**

Run: `pnpm test tests/api/automation-commands.test.ts -t "Package generation context"`

Expected: FAIL because route does not exist.

- [ ] **Step 3: Add Package context types and HTTP client**

In `packages/automation/src/types.ts`, add `AutomationGenerationPackageContextV1` from the spec.

In `packages/automation/src/http-client.ts`, add:

```ts
async packageDraftsGenerationContext(
  planRevisionId: string,
  input: { generationKey: string; actionRunId: string; claimToken: string },
): Promise<AutomationGenerationPackageContextV1> {
  const query = new URLSearchParams({
    generation_key: input.generationKey,
    action_run_id: input.actionRunId,
    claim_token: input.claimToken,
  });
  return this.request(
    'GET',
    `/internal/automation/generation-context/plan-revisions/${planRevisionId}/package-drafts?${query.toString()}`,
  ) as Promise<AutomationGenerationPackageContextV1>;
}
```

- [ ] **Step 4: Add controller/service endpoint**

Add `packageGenerationContextQuerySchema` to DTOs and `getPackageDraftsContext(planRevisionId, query)` to `AutomationGenerationContextService`.

Validation must cover:

- active claim;
- action type `ensure_package_drafts`;
- target object type/id;
- action input `plan_revision_id`;
- action input `generation_key`;
- PlanRevision equals Plan `approved_revision_id`;
- Plan `status === 'approved'`;
- Plan `resolution === 'approved'`;
- Plan `current_revision_id === approved_revision_id`;
- PlanRevision `based_on_spec_revision_id === WorkItem Spec approved_revision_id`;
- WorkItem Spec approved state and current/approved match;
- non-terminal WorkItem;
- scope still matches precondition;
- active holds block context loading.

- [ ] **Step 5: Run focused Package context tests**

Run:

```bash
pnpm test tests/api/automation-commands.test.ts -t "Package generation context"
pnpm --filter @forgeloop/automation build
pnpm --filter @forgeloop/control-plane-api build
```

Expected: PASS.

- [ ] **Step 6: Commit Package context endpoint**

```bash
git add packages/automation apps/control-plane-api tests/api
git commit -m "feat: add package generation context endpoint"
```

---

### Task 8: Persist Generated Package Draft Sets

**Files:**
- Modify: `packages/automation/src/types.ts`
- Modify: `packages/automation/src/http-client.ts`
- Modify: `packages/automation/src/executor.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation.dto.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation-command.service.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Test: `tests/api/automation-commands.test.ts`
- Test: `tests/db/repository-contract.ts`
- Test: `tests/db/automation-repository.test.ts`
- Test: `tests/automation/executor.test.ts`

- [ ] **Step 1: Write failing repository evidence ref tests**

In `tests/db/repository-contract.ts`, extend generation run tests:

```ts
const evidenceRefs = [{ kind: 'logs', name: 'package-generation.json', content_type: 'application/json', storage_uri: 'artifact://package-generation.json', digest: 'sha256:generation' }];
const run = await repository.claimExecutionPackageGenerationRun({
  plan_revision_id: planRevisionId,
  generation_key: 'default:plan-revision-1',
  generator_version: 'fake@1',
  manifest_digest: 'sha256:manifest',
  expected_package_count: 2,
  expected_package_keys: ['api', 'tests'],
  evidence_refs: evidenceRefs,
  claim_token: 'claim-1',
  now,
  locked_until,
});
expect(run.evidence_refs).toEqual(evidenceRefs);
```

- [ ] **Step 2: Write failing API tests for generated Package persistence**

In `tests/api/automation-commands.test.ts`, add:

```ts
it('persists generated Package drafts, generation run evidence refs, and dependencies', async () => {
  const ctx = await seedApprovedPlanAndClaimedPackageAction({ dependencyOrder: ['api', 'tests'] });
  const payload = validGeneratedPackageDraftSet({ dependencyOrder: ['api', 'tests'] });
  const evidenceRefs = [{ kind: 'logs', name: 'package-generation.json', content_type: 'application/json', storage_uri: 'artifact://package-generation.json', digest: 'sha256:pkg' }];

  const response = await request(server)
    .post(`/internal/automation/plan-revisions/${ctx.planRevisionId}/ensure-package-drafts`)
    .set(trustedDaemonHeaders())
    .send({
      action_run_id: ctx.actionId,
      claim_token: ctx.claimToken,
      idempotency_key: ctx.idempotencyKey,
      automation_precondition: ctx.precondition,
      generation_key: ctx.generationKey,
      generated_package_drafts: payload,
      generation_artifacts: evidenceRefs,
    })
    .expect(201);

  const generationRun = await repository.getExecutionPackageGenerationRun({
    plan_revision_id: ctx.planRevisionId,
    generation_key: ctx.generationKey,
  });
  expect(generationRun).toMatchObject({
    status: 'succeeded',
    expected_package_keys: ['api', 'tests'],
    evidence_refs: evidenceRefs,
  });
  expect(generationRun?.manifest_digest).toMatch(/^sha256:/);
  expect(generationRun?.result_json).toMatchObject({
    generated_payload_digest: expect.stringMatching(/^sha256:/),
    package_keys: ['api', 'tests'],
  });

  expect(response.body.package_ids).toHaveLength(2);
  const dependencies = await repository.listExecutionPackageDependencies(response.body.package_ids[1]);
  expect(dependencies).toHaveLength(1);
});

it('blocks generated Package payloads whose manifest differs from approved Plan dependency_order', async () => {
  const ctx = await seedApprovedPlanAndClaimedPackageAction({ dependencyOrder: ['api', 'tests'] });
  await postGeneratedPackages(ctx, validGeneratedPackageDraftSet({ dependencyOrder: ['api'] })).expect(422);
});

it('blocks package command idempotency drift for changed generated payload digest', async () => {
  const ctx = await seedApprovedPlanAndClaimedPackageAction({ dependencyOrder: ['api', 'tests'] });
  await postGeneratedPackages(ctx, validGeneratedPackageDraftSet({ objectiveSuffix: 'first' })).expect(201);
  await postGeneratedPackages(ctx, validGeneratedPackageDraftSet({ objectiveSuffix: 'second' })).expect(409);
});

it('rejects generated Package artifact refs with local paths before persistence', async () => {
  const ctx = await seedApprovedPlanAndClaimedPackageAction({ dependencyOrder: ['api', 'tests'] });
  await request(server)
    .post(`/internal/automation/plan-revisions/${ctx.planRevisionId}/ensure-package-drafts`)
    .set(trustedDaemonHeaders())
    .send({
      action_run_id: ctx.actionId,
      claim_token: ctx.claimToken,
      idempotency_key: ctx.idempotencyKey,
      automation_precondition: ctx.precondition,
      generation_key: ctx.generationKey,
      generated_package_drafts: validGeneratedPackageDraftSet({ dependencyOrder: ['api', 'tests'] }),
      generation_artifacts: [{ kind: 'logs', name: 'raw.log', content_type: 'text/plain', local_ref: '/home/runner/raw.log' }],
    })
    .expect(400);
});
```

- [ ] **Step 3: Run package persistence tests to verify they fail**

Run:

```bash
pnpm test tests/db/repository-contract.ts -t "generation run"
pnpm test tests/api/automation-commands.test.ts -t "generated Package"
```

Expected: FAIL because command payloads and repository evidence refs are not implemented.

- [ ] **Step 4: Add generated Package command types**

In `packages/automation/src/types.ts`, update:

```ts
export interface EnsurePackageDraftsCommandInput {
  action_run_id: string;
  claim_token?: string;
  idempotency_key: string;
  automation_precondition: AutomationPrecondition;
  generation_key: string;
  generated_package_drafts: GeneratedPackageDraftSetV1;
  generation_artifacts: ArtifactRef[];
}
```

In `apps/control-plane-api/src/modules/automation/automation.dto.ts`, update `ensurePackageDraftsCommandSchema` to require `generated_package_drafts` and `generation_artifacts`.

- [ ] **Step 5: Persist generation run evidence refs in repositories**

In `packages/db/src/repositories/delivery-repository.ts`, add `evidence_refs?: Artifact['ref'][]` to `ClaimExecutionPackageGenerationRunInput`.

In in-memory and Drizzle repository `claimExecutionPackageGenerationRunUnlocked`, copy `input.evidence_refs` into new/reclaimed run records:

```ts
...(input.evidence_refs === undefined ? {} : { evidence_refs: clone(input.evidence_refs) }),
```

Run:

```bash
pnpm test tests/db/repository-contract.ts tests/db/automation-repository.test.ts -t "generation"
pnpm --filter @forgeloop/db build
```

Expected: PASS for repository tests.

- [ ] **Step 6: Implement Package manifest canonicalization**

In `apps/control-plane-api/src/modules/automation/automation-command.service.ts`, add private helpers:

```ts
private canonicalPackageManifest(input: {
  planRevisionId: string;
  generationKey: string;
  generated: EnsurePackageDraftsCommandDto['generated_package_drafts'];
  outputSchemaVersion: 'package_drafts.v1';
}) {
  return {
    schema_version: input.generated.schema_version,
    plan_revision_id: input.planRevisionId,
    generation_key: input.generationKey,
    package_set_key: input.generated.manifest.package_set_key,
    package_keys: input.generated.packages.map((entry) => entry.package_key),
    dependency_order: input.generated.manifest.dependency_order,
    dependency_edges: input.generated.dependencies.map((entry) => ({
      package_key: entry.package_key,
      depends_on_package_key: entry.depends_on_package_key,
      dependency_type: entry.dependency_type,
    })),
    package_policy_digests: input.generated.packages.map((entry) => ({
      package_key: entry.package_key,
      repo_id: entry.repo_id,
      allowed_paths: entry.allowed_paths,
      forbidden_paths: entry.forbidden_paths,
      required_checks: entry.required_checks,
      source_mutation_policy: entry.source_mutation_policy,
    })),
    output_schema_version: input.outputSchemaVersion,
  };
}
```

Compute `manifest_digest` from canonical JSON. Never use `'api-package-v1'` or another hard-coded stand-in.

- [ ] **Step 7: Replace hard-coded package synthesis with generated payload persistence**

In `writeExecutionPackageDraftsForPlanRevision`:

- Accept generated payload and artifact refs.
- Validate package set against approved PlanRevision `dependency_order`.
- Revalidate Plan approved state using `approved_revision_id`.
- Revalidate Spec approved state and PlanRevision lineage.
- Compute `generated_payload_digest`.
- Use the same command idempotency metadata pattern from Task 5:
  - `precondition_json` wraps the normalized automation precondition, `generated_payload_digest`, `generation_key`, and public-safe generation artifact identity;
  - `precondition_fingerprint` is computed from that wrapper;
  - idempotency-key reuse with a different wrapper is translated to `generated_payload_idempotency_drift`.
- Claim generation run with:
  - `generator_version`
  - `manifest_digest`
  - `expected_package_count`
  - `expected_package_keys`
  - `evidence_refs: safeGenerationArtifactRefs(input.generation_artifacts)`
- For each generated package:
  - validate repo eligibility;
  - validate path policy through current runtime policy projection/default policy helper;
  - create/replay `ExecutionPackage` with generated objective/checks/artifacts/paths/source mutation policy;
  - set `execution_package_set_id`, `generation_key`, `package_key`, `sequence`, and `manifest_digest`;
  - call `validateExecutionPackage`.
- Save `execution_package_generation_packages`.
- After all packages exist, translate dependency package keys to ids and save `execution_package_dependencies`.
- Call `validatePackageDependencyGraph`.
- Complete generation run with public-safe result:

```ts
{
  execution_package_set_id,
  package_ids,
  status,
  manifest_digest,
  generated_payload_digest,
  package_keys,
  generation_artifacts: publicArtifactIdentity(input.generation_artifacts),
}
```

Remove the daemon-origin hard-coded `generatedRequiredChecks`, `generatedAllowedPaths`, `generatedForbiddenPaths`, and package key `'api-package'` path from this command. If a human/manual helper still needs server synthesis, create a separate method outside the daemon endpoint and do not call it from `ensurePackageDraftsForClaimedAction`.

- [ ] **Step 8: Run package command tests**

Run:

```bash
pnpm test tests/api/automation-commands.test.ts -t "generated Package"
pnpm test tests/db/repository-contract.ts tests/db/automation-repository.test.ts -t "generation"
pnpm --filter @forgeloop/control-plane-api build
```

Expected: PASS.

- [ ] **Step 9: Commit generated Package command boundary**

```bash
git add packages/automation packages/db apps/control-plane-api tests/api tests/db
git commit -m "feat: persist generated package draft sets"
```

---

### Task 9: Wire Package Draft Runtime and Enable 2B Flow

**Files:**
- Modify: `packages/automation/src/executor.ts`
- Modify: `packages/automation/src/planner.ts`
- Modify: `apps/automation-daemon/src/config.ts`
- Modify: `apps/automation-daemon/src/automation-daemon.ts`
- Modify: `apps/automation-daemon/src/main.ts`
- Test: `tests/automation/executor.test.ts`
- Test: `tests/automation/planner.test.ts`
- Test: `tests/automation/daemon.test.ts`
- Test: `tests/api/automation-daemon.integration.test.ts`
- Test: `tests/smoke/automation-dogfood-script.test.ts`

- [ ] **Step 1: Write failing executor test for generated Package runtime**

In `tests/automation/executor.test.ts`, update/add:

```ts
it('fetches Package context, runs runtime, and sends generated package drafts', async () => {
  const client = new FakeAutomationClient();
  client.packageContext = validPackageGenerationContext({ dependencyOrder: ['api', 'tests'] });
  const runtime = fakeGenerationRuntimeReturning({
    taskKind: 'package_drafts',
    generated: validGeneratedPackageDraftSet({ dependencyOrder: ['api', 'tests'] }),
    generationArtifacts: [{ kind: 'logs', name: 'package-generation.json', content_type: 'application/json', storage_uri: 'artifact://package-generation.json', digest: 'sha256:pkg' }],
  });

  await executeActionRun({
    client,
    action: claimedEnsurePackageDraftsAction(),
    actorId: 'actor-automation',
    daemonIdentity: 'daemon-main',
    generationRuntime: runtime,
  });

  expect(client.calls.find((call) => call.method === 'ensurePackageDrafts')?.args[1]).toMatchObject({
    generated_package_drafts: { schema_version: 'package_drafts.v1' },
    generation_artifacts: [{ kind: 'logs', name: 'package-generation.json', content_type: 'application/json', storage_uri: 'artifact://package-generation.json', digest: 'sha256:pkg' }],
  });
});
```

- [ ] **Step 2: Write failing 2B integration test**

In `tests/api/automation-daemon.integration.test.ts`:

```ts
it('after 2B generates Package drafts from a human-approved generated Plan', async () => {
  const ctx = await seedWorkItemWithApprovedGeneratedPlan({ dependencyOrder: ['api', 'tests'] });
  const daemon = createAutomationDaemonForTest({
    generationPlanning: {
      mode: 'fake',
      tasks: {
        spec_draft: { enabled: true, promptVersion: 'spec-draft.fake.v1', outputSchemaVersion: 'spec_draft.v1' },
        plan_draft: { enabled: true, promptVersion: 'plan-draft.fake.v1', outputSchemaVersion: 'plan_draft.v1' },
        package_drafts: { enabled: true, promptVersion: 'package-drafts.fake.v1', outputSchemaVersion: 'package_drafts.v1' },
      },
    },
  });
  await daemon.runOnce();

  const packages = await repository.listExecutionPackagesForWorkItem(ctx.workItem.id);
  expect(packages.map((pkg) => pkg.package_key)).toEqual(['api', 'tests']);
  expect(await repository.listRunSessionsForWorkItem(ctx.workItem.id)).toEqual([]);
});
```

- [ ] **Step 3: Run package runtime tests to verify they fail**

Run:

```bash
pnpm test tests/automation/executor.test.ts -t "Package context"
pnpm test tests/api/automation-daemon.integration.test.ts -t "2B"
```

Expected: FAIL until executor and daemon wiring are complete.

- [ ] **Step 4: Wire executor Package generation**

In `packages/automation/src/executor.ts`:

- For `ensure_package_drafts`, fetch `packageDraftsGenerationContext`.
- Run `package_drafts` through generation runtime.
- Validate `GeneratedPackageDraftSetV1`.
- Call command with `generated_package_drafts` and `generation_artifacts`.
- Ensure invalid app-server generated output fails retryably and does not call command endpoint.
- Ensure stable fake invalid output blocks non-retryably.

- [ ] **Step 5: Enable Package planning only when configured**

In `packages/automation/src/planner.ts`, keep the Task 3 `package_drafts.enabled` gate. Confirm:

- 2A default suppresses packages.
- 2B explicit enable emits packages.
- The action identity includes package prompt version and output schema version.

- [ ] **Step 6: Update daemon config for explicit 2B enable**

In `apps/automation-daemon/src/config.ts`, parse `FORGELOOP_CODEX_GENERATION_PACKAGE_DRAFTS_ENABLED=true` to turn on package generation. Keep default false.

- [ ] **Step 7: Run 2B focused tests**

Run:

```bash
pnpm test tests/automation/planner.test.ts tests/automation/executor.test.ts tests/automation/daemon.test.ts tests/api/automation-daemon.integration.test.ts
pnpm --filter @forgeloop/automation build
pnpm --filter @forgeloop/automation-daemon build
```

Expected: PASS.

- [ ] **Step 8: Commit 2B daemon wiring**

```bash
git add packages/automation apps/automation-daemon tests/automation tests/api tests/smoke
git commit -m "feat: wire generated package drafts through daemon runtime"
```

---

### Task 10: Harden App-Server Runtime Config, Errors, Redaction, and Cancellation

**Files:**
- Modify: `packages/codex-runtime/src/runtime.ts`
- Modify: `packages/codex-runtime/src/app-server-generation-driver.ts`
- Modify: `packages/codex-runtime/src/generation-safety.ts`
- Modify: `apps/automation-daemon/src/config.ts`
- Modify: `packages/automation/src/executor.ts`
- Test: `tests/codex-runtime/app-server-generation-driver.test.ts`
- Test: `tests/automation/executor.test.ts`
- Test: `tests/automation/daemon-config.test.ts`
- Test: `tests/automation/daemon.test.ts`

- [ ] **Step 1: Write failing hardening tests**

Add cases:

```ts
it('codex mode fails startup when app-server endpoint is missing', () => {
  expect(() =>
    loadAutomationDaemonConfig({
      ...baseEnv,
      FORGELOOP_CODEX_AUTOMATION_GENERATION: 'codex',
    }),
  ).toThrow(/app-server/i);
});

it('does not expose raw prompts, raw output, local paths, or claim token in failure result_json', async () => {
  const result = await executeActionRun({
    client,
    action: claimedEnsurePlanDraftAction({ claimToken: 'secret-claim-token' }),
    actorId: 'actor',
    daemonIdentity: 'daemon',
    generationRuntime: runtimeThatThrows(
      new Error('generated_output_schema_invalid: /Users/viv/private secret-claim-token raw prompt'),
    ),
  });
  expect(result.status).toBe('failed');
  const resultJson = client.calls.find((call) => call.method === 'failAction')?.args[1].result_json;
  expect(JSON.stringify(resultJson)).not.toContain('/Users/viv');
  expect(JSON.stringify(resultJson)).not.toContain('secret-claim-token');
  expect(JSON.stringify(resultJson)).not.toContain('raw prompt');
});

it('cancels app-server turn on daemon shutdown or timeout', async () => {
  const transport = transportThatNeverCompletes();
  const safety = trackedFakeSafety();
  const driver = new AppServerGenerationDriver({ transport, runtimeSafety: safety, timeoutMs: 1 });
  await expect(driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' })).rejects.toThrow(
    /codex_generation_timeout/,
  );
  expect(transport.requests).toContainEqual(expect.objectContaining({ method: 'turn/interrupt' }));
  expect(safety.consumedMethods).toContain('turn/interrupt');
});
```

- [ ] **Step 2: Run hardening tests to verify they fail**

Run:

```bash
pnpm test tests/codex-runtime/app-server-generation-driver.test.ts tests/automation/executor.test.ts tests/automation/daemon-config.test.ts -t "codex|redact|cancel|timeout"
```

Expected: FAIL until hardening behavior is implemented.

- [ ] **Step 3: Implement config validation**

In `apps/automation-daemon/src/config.ts`:

- `FORGELOOP_CODEX_AUTOMATION_GENERATION=codex` implies `FORGELOOP_CODEX_GENERATION_DRIVER=app_server`.
- `FORGELOOP_CODEX_GENERATION_DRIVER=app_server` requires `FORGELOOP_CODEX_APP_SERVER_ENDPOINT` or another governed transport config, plus `FORGELOOP_CODEX_GENERATION_ARTIFACT_ROOT`.
- Unsafe direct spawn is rejected unless `NODE_ENV === 'test'` and an explicit test-only flag is set.
- Timeout/output/concurrency values must be positive and within documented ranges.

- [ ] **Step 4: Implement runtime factory and redaction**

In `packages/codex-runtime/src/runtime.ts`:

- Add `createCodexGenerationRuntime(config)`.
- Add public-safe `CodexGenerationError` with:
  - `code`
  - `retryable`
  - `publicResultJson`
- Map app-server unavailable to `codex_app_server_unavailable`.
- Map safety lease unavailable to `codex_generation_safety_unavailable`.
- Map unsafe sandbox to `codex_generation_sandbox_invalid`.
- Map timeout to `codex_generation_timeout`.
- Map cancellation to `codex_generation_cancelled`.
- Map app-server invalid JSON/schema to retryable failure.
- Map stable fake invalid output to non-retryable block.

In `packages/automation/src/executor.ts`, consume the structured error instead of serializing `error.message`.

- [ ] **Step 5: Implement timeout/cancellation cleanup**

In `packages/codex-runtime/src/app-server-generation-driver.ts`:

- Race notification collection with timeout.
- On timeout or abort, call `runtimeSafety.consumeGenerationCommand` for `turn/interrupt` before sending the interrupt request when `turnId` is known.
- Send `turn/interrupt` through the same governed transport; do not bypass the lease path for cancellation cleanup.
- Always close owned transport in `finally`.
- Keep raw logs internal-only.

- [ ] **Step 6: Run hardening tests and builds**

Run:

```bash
pnpm test tests/codex-runtime/app-server-generation-driver.test.ts tests/automation/executor.test.ts tests/automation/daemon-config.test.ts tests/automation/daemon.test.ts
pnpm --filter @forgeloop/codex-runtime build
pnpm --filter @forgeloop/automation build
pnpm --filter @forgeloop/automation-daemon build
```

Expected: PASS.

- [ ] **Step 7: Commit app-server hardening**

```bash
git add packages/codex-runtime packages/automation apps/automation-daemon tests/codex-runtime tests/automation
git commit -m "feat: harden codex generation app-server runtime"
```

---

### Task 11: Fix Approved Revision Snapshot Projections

**Files:**
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Test: `tests/api/automation-runtime-snapshot.test.ts`
- Test: `tests/db/repository-contract.ts`
- Test: `tests/db/automation-repository.test.ts`

- [ ] **Step 1: Write failing runtime snapshot tests**

In `tests/api/automation-runtime-snapshot.test.ts`, add:

```ts
it('does not target Plan generation when Spec current revision differs from approved revision', async () => {
  const ctx = await seedSpecWithApprovedAndNewDraftRevision();
  const body = await getRuntimeSnapshot();
  expect(body.work_items_requiring_plan).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ target_object_id: ctx.workItem.id })]),
  );
});

it('does not target Package generation when Plan current revision differs from approved revision', async () => {
  const ctx = await seedPlanWithApprovedAndNewDraftRevision();
  const body = await getRuntimeSnapshot();
  expect(body.plan_revisions_requiring_packages).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ target_object_id: ctx.approvedPlanRevisionId })]),
  );
});
```

- [ ] **Step 2: Run snapshot tests to verify they fail**

Run: `pnpm test tests/api/automation-runtime-snapshot.test.ts -t "approved revision"`

Expected: FAIL if repository projections still use mutable-current fallbacks.

- [ ] **Step 3: Update in-memory projection**

In `packages/db/src/repositories/in-memory-delivery-repository.ts`:

- `work_items_requiring_plan` uses Spec only when:
  - `status === 'approved'`
  - `resolution === 'approved'`
  - `approved_revision_id !== undefined`
  - `current_revision_id === approved_revision_id`
- target revision id is `approved_revision_id`.
- `plan_revisions_requiring_packages` uses Plan only when:
  - `status === 'approved'`
  - `resolution === 'approved'`
  - `approved_revision_id !== undefined`
  - `current_revision_id === approved_revision_id`
- target object id and action input use Plan `approved_revision_id`.
- Do not treat mutable `current_revision_id` as approved.

- [ ] **Step 4: Update Drizzle projection**

Make the same changes in `packages/db/src/repositories/drizzle-delivery-repository.ts`.

- [ ] **Step 5: Run projection tests**

Run:

```bash
pnpm test tests/api/automation-runtime-snapshot.test.ts tests/db/repository-contract.ts tests/db/automation-repository.test.ts
pnpm --filter @forgeloop/db build
```

Expected: PASS.

- [ ] **Step 6: Commit approved revision projection fixes**

```bash
git add packages/db tests/api tests/db
git commit -m "fix: use approved revisions for automation projections"
```

---

### Task 12: Full Acceptance, Dogfood, and Documentation Notes

**Files:**
- Modify: `tests/smoke/automation-dogfood-script.test.ts` if action expectations change
- Modify: `scripts/automation-dogfood.ts`
  - Report app-server dogfood status as passed, skipped, blocked, or failed.
- Modify: `docs/superpowers/plans/2026-05-19-codex-generation-runtime-plan-package-drafts.md` only for checked boxes during execution
- No product docs change required unless implementation discovers a new operator-facing env var name not covered in the spec

- [ ] **Step 1: Run full focused acceptance suite**

Run:

```bash
pnpm test tests/codex-runtime tests/automation tests/api/automation-commands.test.ts tests/api/automation-runtime-snapshot.test.ts tests/api/automation-daemon.integration.test.ts tests/db/automation-repository.test.ts tests/db/repository-contract.ts
```

Expected: PASS.

- [ ] **Step 2: Run package builds**

Run:

```bash
pnpm --filter @forgeloop/codex-runtime build
pnpm --filter @forgeloop/automation build
pnpm --filter @forgeloop/automation-daemon build
pnpm --filter @forgeloop/control-plane-api build
pnpm --filter @forgeloop/db build
pnpm --filter @forgeloop/executor build
```

Expected: PASS.

- [ ] **Step 3: Run full repository test suite when focused tests are stable**

Run: `pnpm test`

Expected: PASS. For local runtime limits, run the full matrix before PR merge in CI and record the local subset that passed.

- [ ] **Step 4: Run fake dogfood path**

Run with local test env used by existing dogfood scripts:

```bash
FORGELOOP_CODEX_AUTOMATION_GENERATION=fake \
FORGELOOP_CODEX_GENERATION_PACKAGE_DRAFTS_ENABLED=true \
pnpm automation:dogfood
```

Expected:

- Spec draft flow still works.
- Approved Spec generates a draft Plan.
- Approved Plan generates draft Packages.
- No RunSession is created.
- No Spec/Plan submit/approve transition is performed by daemon.

- [ ] **Step 5: Run app-server dogfood path where environment supports it**

Run only when a governed app-server endpoint is available:

```bash
FORGELOOP_CODEX_AUTOMATION_GENERATION=codex \
FORGELOOP_CODEX_APP_SERVER_ENDPOINT="$FORGELOOP_CODEX_APP_SERVER_ENDPOINT" \
pnpm automation:dogfood
```

Expected:

- If governed app-server is available: at least one approved Spec produces a generated Plan draft.
- If governed app-server is unavailable: dogfood reports blocked/skipped with public-safe reason, not CLI fallback.

- [ ] **Step 6: Confirm no forbidden runtime paths remain**

Run:

```bash
rg -n "codex exec|exec_fallback|CodexExecFallbackDriver|dangerFullAccess|danger-full-access|api-package-v1|mock-package-drafter" packages/codex-runtime packages/automation apps/automation-daemon apps/control-plane-api tests
```

Expected:

- No hits in `packages/codex-runtime`, `packages/automation`, or `apps/automation-daemon` for generation runtime paths.
- Existing `CodexExecFallbackDriver` hits may remain only in source-changing executor/run-worker code and tests.
- Existing `dangerFullAccess` hits may remain only in source-changing executor code and its tests, not generation runtime.
- `api-package-v1` and `mock-package-drafter` must not remain in daemon-origin package generation command code.

- [ ] **Step 7: Commit final acceptance adjustments**

```bash
git add tests scripts docs packages apps
git commit -m "test: cover codex generation closed loop acceptance"
```

---

## Final Verification Checklist

- [ ] `pnpm test tests/codex-runtime`
- [ ] `pnpm test tests/automation`
- [ ] `pnpm test tests/api/automation-commands.test.ts tests/api/automation-runtime-snapshot.test.ts tests/api/automation-daemon.integration.test.ts`
- [ ] `pnpm test tests/db/automation-repository.test.ts tests/db/repository-contract.ts`
- [ ] `pnpm --filter @forgeloop/codex-runtime build`
- [ ] `pnpm --filter @forgeloop/automation build`
- [ ] `pnpm --filter @forgeloop/automation-daemon build`
- [ ] `pnpm --filter @forgeloop/control-plane-api build`
- [ ] `pnpm --filter @forgeloop/db build`
- [ ] `pnpm --filter @forgeloop/executor build`
- [ ] `pnpm test`
- [ ] Fake dogfood succeeds.
- [ ] App-server dogfood either succeeds or reports blocked/skipped without CLI fallback.
- [ ] No RunSession is created by Plan 2 flows.
- [ ] Daemon never submits or approves Spec/Plan.
- [ ] Public action results do not contain raw prompts, raw app-server logs, HMACs, claim tokens, secrets, or local absolute paths.
