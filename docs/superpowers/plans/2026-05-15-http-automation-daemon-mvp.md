# HTTP Automation Daemon MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the HTTP-only ForgeLoop automation daemon MVP that advances PRD state to Plan drafts and ExecutionPackage drafts, projects read-only `WORKFLOW.md` status, and never enqueues runs.

**Architecture:** The control plane stays the only authoritative product-state writer. `apps/automation-daemon` is a separate process that uses `packages/automation` to plan, sign HTTP calls, create/replay/claim action runs, and execute only `/internal/automation/*` commands. Durable daemon recovery is limited to `automation_action_runs`; runtime snapshot and policy digest are projections, not a second source of truth.

**Tech Stack:** TypeScript, NestJS, Drizzle ORM, Vitest, Supertest, pnpm workspaces, Node `crypto/fs/path`, existing `@forgeloop/domain`, `@forgeloop/db`, `@forgeloop/control-plane-api`, and new `@forgeloop/automation`.

---

## Required Reading

Before implementation, read:

- `docs/superpowers/specs/2026-05-15-http-automation-daemon-mvp-design.md`
- `apps/control-plane-api/src/p0/p0.service.ts`
- `apps/control-plane-api/src/p0/p0.module.ts`
- `apps/control-plane-api/src/p0/actor-context.ts`
- `packages/domain/src/automation.ts`
- `packages/db/src/schema/automation.ts`
- `packages/db/src/repositories/p0-repository.ts`
- `packages/db/src/repositories/in-memory-p0-repository.ts`
- `packages/db/src/repositories/drizzle-p0-repository.ts`
- `tests/api/automation-commands.test.ts`
- `tests/db/repository-contract.ts`

Use @superpowers:test-driven-development for every task that changes code. Use @superpowers:verification-before-completion before claiming a task is done.

## Scope And Stop Signs

- Do not implement tracker adapters.
- Do not enable `enqueue_run` in the daemon planner, executor, API, dogfood, or runtime snapshot.
- Do not make `WORKFLOW.md` affect checks, allowed paths, hooks, resources, executor choice, package content, or run eligibility.
- Do not let `apps/automation-daemon` import `P0Service`, Nest control-plane modules, DB schemas, or repository implementations for product writes.
- Do not return raw repository rows, raw `result_json`, raw `metadata_json`, raw runtime metadata, raw command output, HMAC signatures, or public-unsafe local paths from internal automation DTOs.
- Do not use daemon-local files, caches, `automation_cursors`, or a new snapshot table for daemon recovery.

## File Structure

### Control-Plane Core Providers

- Create: `apps/control-plane-api/src/modules/core/control-plane-tokens.ts`
  - Own `P0_REPOSITORY`, `RUN_DURABILITY_MODE`, `P0_DEMO_ACTOR_ID_FALLBACK`, and `RunDurabilityMode`.
- Create: `apps/control-plane-api/src/modules/core/control-plane-core.module.ts`
  - Own repository and durability provider factories currently in `P0Module`.
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
  - Import shared tokens from core module area; keep `P0Service` behavior unchanged.
- Modify: `apps/control-plane-api/src/p0/p0.module.ts`
  - Import `ControlPlaneCoreModule`; keep `RUN_WORKER` provider local.
- Modify: `apps/control-plane-api/src/modules/query/query.module.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.service.ts`
- Modify: `apps/control-plane-api/src/modules/release/release.module.ts`
- Modify: `apps/control-plane-api/src/modules/release/release.service.ts`
- Modify tests importing tokens from `p0.service.ts`.

### Automation Package

- Create: `packages/automation/package.json`
- Create: `packages/automation/tsconfig.json`
- Create: `packages/automation/src/types.ts`
- Create: `packages/automation/src/idempotency.ts`
- Create: `packages/automation/src/signing.ts`
- Create: `packages/automation/src/http-client.ts`
- Create: `packages/automation/src/planner.ts`
- Create: `packages/automation/src/executor.ts`
- Create: `packages/automation/src/policy-digest.ts`
- Create: `packages/automation/src/index.ts`
- Modify: `tsconfig.base.json`
- Modify: `tests/bootstrap.test.ts`
- Test: `tests/automation/idempotency.test.ts`
- Test: `tests/automation/signing.test.ts`
- Test: `tests/automation/planner.test.ts`
- Test: `tests/automation/executor.test.ts`
- Test: `tests/automation/policy-digest.test.ts`

### Control-Plane Automation Module

- Create: `apps/control-plane-api/src/modules/automation/automation.module.ts`
- Create: `apps/control-plane-api/src/modules/automation/automation.controller.ts`
- Create: `apps/control-plane-api/src/modules/automation/automation-command.service.ts`
- Create: `apps/control-plane-api/src/modules/automation/runtime-snapshot.service.ts`
- Create: `apps/control-plane-api/src/modules/automation/trusted-automation-actor.guard.ts`
- Create: `apps/control-plane-api/src/modules/automation/automation.dto.ts`
- Modify: `apps/control-plane-api/src/app.module.ts`
- Modify: `apps/control-plane-api/src/main.ts`
- Modify: `apps/control-plane-api/src/p0/p0.controller.ts`
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
- Test: `tests/api/automation-internal-auth.test.ts`
- Test: `tests/api/automation-action-lifecycle.test.ts`
- Test: `tests/api/automation-runtime-snapshot.test.ts`
- Test: `tests/api/automation-commands.test.ts`

### Domain, Schema, Repository

- Modify: `packages/domain/src/automation.ts`
  - Add action input, target version, precondition fingerprint, stable policy observation identity, and DTO-safe action types.
- Modify: `packages/db/src/schema/automation.ts`
  - Add `target_version`, `precondition_fingerprint`, `action_input_json` to `automation_action_runs`.
- Modify: `packages/db/src/repositories/p0-repository.ts`
  - Add create/replay, claim-next, active claim assertion, latest projection lookup, and snapshot query contracts.
- Modify: `packages/db/src/repositories/in-memory-p0-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-p0-repository.ts`
- Test: `tests/db/repository-contract.ts`
- Test: `tests/db/automation-repository.test.ts`
- Test: `tests/db/schema.test.ts`

### Automation Daemon And Dogfood

- Create: `apps/automation-daemon/package.json`
- Create: `apps/automation-daemon/tsconfig.json`
- Create: `apps/automation-daemon/src/config.ts`
- Create: `apps/automation-daemon/src/workflow-policy-loader.ts`
- Create: `apps/automation-daemon/src/automation-daemon.ts`
- Create: `apps/automation-daemon/src/main.ts`
- Create: `scripts/automation-dogfood.ts`
- Modify: `package.json`
- Test: `tests/automation/daemon.test.ts`
- Test: `tests/smoke/automation-dogfood-script.test.ts`

## Task 0: Baseline Guardrails

**Files:**
- Read: `docs/superpowers/specs/2026-05-15-http-automation-daemon-mvp-design.md`
- Read: `apps/control-plane-api/src/p0/p0.service.ts`
- Read: `packages/db/src/repositories/p0-repository.ts`
- Read: `packages/domain/src/automation.ts`

- [ ] **Step 1: Confirm branch/worktree state**

Run:

```bash
git status --short --branch
```

Expected: only this plan/spec work is present. If unrelated files are dirty, do not edit or revert them.

- [ ] **Step 2: Run baseline tests for touched areas**

Run:

```bash
pnpm test tests/bootstrap.test.ts tests/domain/automation.test.ts tests/db/automation-repository.test.ts tests/api/automation-commands.test.ts
```

Expected: PASS before changes, or record existing failures before starting.

- [ ] **Step 3: Commit baseline plan only if not already committed**

Run:

```bash
git log --oneline -3
```

Expected: the spec/plan branch has the planning commit. Do not commit code in this task.

## Task 1: Core Provider Split

**Files:**
- Create: `apps/control-plane-api/src/modules/core/control-plane-tokens.ts`
- Create: `apps/control-plane-api/src/modules/core/control-plane-core.module.ts`
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
- Modify: `apps/control-plane-api/src/p0/p0.module.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.module.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.service.ts`
- Modify: `apps/control-plane-api/src/modules/release/release.module.ts`
- Modify: `apps/control-plane-api/src/modules/release/release.service.ts`
- Modify: tests that import `P0_REPOSITORY`, `RUN_DURABILITY_MODE`, or `P0_DEMO_ACTOR_ID_FALLBACK` from `p0.service.ts`
- Test: `tests/api/query-module.test.ts`
- Test: `tests/api/release-module.test.ts`
- Test: `tests/api/automation-commands.test.ts`

- [ ] **Step 1: Write failing import/provider tests**

In `tests/api/query-module.test.ts`, add an assertion that `QueryModule` can compile without importing `P0Module` directly by relying on core providers through `AppModule`.

In `tests/api/release-module.test.ts`, add the same provider override smoke path for `P0_REPOSITORY`, `RUN_DURABILITY_MODE`, and `P0_DEMO_ACTOR_ID_FALLBACK`.

Use this shape:

```ts
const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(P0_REPOSITORY)
  .useValue(repository)
  .compile();
expect(moduleRef.get(P0_REPOSITORY)).toBe(repository);
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm test tests/api/query-module.test.ts tests/api/release-module.test.ts
```

Expected: FAIL because tokens still live in `p0.service.ts` and module ownership is not split.

- [ ] **Step 3: Create core tokens**

Create `apps/control-plane-api/src/modules/core/control-plane-tokens.ts`:

```ts
import type { RunRuntimeMetadata } from '@forgeloop/domain';

export type RunDurabilityMode = RunRuntimeMetadata['durability_mode'];

export const P0_REPOSITORY = Symbol('P0_REPOSITORY');
export const RUN_DURABILITY_MODE = Symbol('RUN_DURABILITY_MODE');
export const P0_DEMO_ACTOR_ID_FALLBACK = Symbol('P0_DEMO_ACTOR_ID_FALLBACK');
```

- [ ] **Step 4: Create core provider module**

Move `createRepository` and `durabilityMode` from `apps/control-plane-api/src/p0/p0.module.ts` into `apps/control-plane-api/src/modules/core/control-plane-core.module.ts`.

Implementation shape:

```ts
@Module({
  providers: [
    { provide: P0_REPOSITORY, useFactory: createRepository },
    { provide: RUN_DURABILITY_MODE, useFactory: durabilityMode },
    {
      provide: P0_DEMO_ACTOR_ID_FALLBACK,
      useFactory: (mode: RunDurabilityMode) => mode === 'volatile_demo',
      inject: [RUN_DURABILITY_MODE],
    },
  ],
  exports: [P0_REPOSITORY, RUN_DURABILITY_MODE, P0_DEMO_ACTOR_ID_FALLBACK],
})
export class ControlPlaneCoreModule {}
```

- [ ] **Step 5: Update module imports**

Modify `P0Module` so it imports `ControlPlaneCoreModule`, removes repository/durability providers, and keeps only `RUN_WORKER`, `P0Service`, and lifecycle providers.

Modify `QueryModule` and `ReleaseModule` to import `ControlPlaneCoreModule` instead of `P0Module`.

- [ ] **Step 6: Update token imports**

Replace imports of shared tokens from `apps/control-plane-api/src/p0/p0.service.ts` with `apps/control-plane-api/src/modules/core/control-plane-tokens.ts`.

Keep `RUN_WORKER` and `P0Service` exported by `p0.service.ts`.

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm test tests/api/query-module.test.ts tests/api/release-module.test.ts tests/api/automation-commands.test.ts tests/api/run-auth.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add apps/control-plane-api/src tests/api tests/helpers
git commit -m "refactor: split control plane core providers"
```

## Task 2: Automation Package Skeleton, Types, Idempotency, Signing

**Files:**
- Create: `packages/automation/package.json`
- Create: `packages/automation/tsconfig.json`
- Create: `packages/automation/src/types.ts`
- Create: `packages/automation/src/idempotency.ts`
- Create: `packages/automation/src/signing.ts`
- Create: `packages/automation/src/index.ts`
- Modify: `tsconfig.base.json`
- Modify: `tests/bootstrap.test.ts`
- Test: `tests/automation/idempotency.test.ts`
- Test: `tests/automation/signing.test.ts`

- [ ] **Step 1: Write package registration tests**

Modify `tests/bootstrap.test.ts`:

```ts
expect(baseTsconfig.compilerOptions.paths).toEqual({
  '@forgeloop/automation': ['packages/automation/src/index.ts'],
  '@forgeloop/contracts': ['packages/contracts/src/index.ts'],
  '@forgeloop/domain': ['packages/domain/src/index.ts'],
  '@forgeloop/db': ['packages/db/src/index.ts'],
  '@forgeloop/executor': ['packages/executor/src/index.ts'],
  '@forgeloop/run-worker': ['packages/run-worker/src/index.ts'],
  '@forgeloop/workflow': ['packages/workflow/src/index.ts'],
});
```

Add `packages/automation/package.json` to the registered private modules list.

- [ ] **Step 2: Write idempotency tests**

Create `tests/automation/idempotency.test.ts` with tests for:

```ts
expect(mutatingActionIdempotencyKey(base)).toBe(mutatingActionIdempotencyKey(base));
expect(mutatingActionIdempotencyKey({ ...base, capabilityFingerprint: 'changed' })).not.toBe(mutatingActionIdempotencyKey(base));
expect(mutatingActionIdempotencyKey({ ...base, policyDigest: 'ignored' })).toBe(mutatingActionIdempotencyKey(base));
expect(projectRuntimeSnapshotIdempotencyKey(observationA)).toBe(projectRuntimeSnapshotIdempotencyKey({ ...observationA, observedAt: '2026-05-15T00:00:01.000Z' }));
expect(projectRuntimeSnapshotIdempotencyKey({ ...observationA, policyStatus: 'parse_failed' })).not.toBe(projectRuntimeSnapshotIdempotencyKey(observationA));
```

- [ ] **Step 3: Write signing tests**

Create `tests/automation/signing.test.ts`:

```ts
const verifierNow = '2026-05-15T00:00:00.000Z';
const signingInput = {
  method: 'POST',
  pathAndQuery: '/internal/automation/actions?x=1',
  rawBody: Buffer.from('{"a":1}'),
  actorId: 'daemon-actor',
  actorClass: 'automation_daemon',
  daemonIdentity: 'daemon-1',
  timestamp: verifierNow,
  secret: 'secret',
} satisfies SignAutomationRequestInput;
const signed = signAutomationRequest(signingInput);
expect(signed['X-Forgeloop-Actor-Body-SHA256']).toHaveLength(64);
expect(signed['X-Forgeloop-Actor-Signature']).toMatch(/^v1=[0-9a-f]{64}$/);
expect(verifyAutomationRequestSignature({ ...signedInput, headers: signed, now: verifierNow })).toEqual({ ok: true });
expect(verifyAutomationRequestSignature({ ...signedInput, rawBody: Buffer.from('{"a":2}'), headers: signed, now: verifierNow })).toMatchObject({ ok: false });
expect(verifyAutomationRequestSignature({ ...signedInput, pathAndQuery: '/internal/automation/actions?x=2', headers: signed, now: verifierNow })).toMatchObject({ ok: false });

const insideWindow = signAutomationRequest({ ...signingInput, timestamp: '2026-05-14T23:55:01.000Z' });
expect(verifyAutomationRequestSignature({ ...signedInput, headers: insideWindow, now: verifierNow })).toEqual({ ok: true });

const expired = signAutomationRequest({ ...signingInput, timestamp: '2026-05-14T23:54:59.000Z' });
expect(verifyAutomationRequestSignature({ ...signedInput, headers: expired, now: verifierNow })).toMatchObject({ ok: false, reason: 'timestamp_skew' });
```

- [ ] **Step 4: Run tests and verify failure**

Run:

```bash
pnpm test tests/bootstrap.test.ts tests/automation/idempotency.test.ts tests/automation/signing.test.ts
```

Expected: FAIL because package and functions do not exist.

- [ ] **Step 5: Create package skeleton**

Create `packages/automation/package.json`:

```json
{
  "name": "@forgeloop/automation",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@forgeloop/domain": "workspace:*"
  }
}
```

Create `packages/automation/tsconfig.json` extending `../../tsconfig.lib.json`.

- [ ] **Step 6: Add type contracts**

Create `packages/automation/src/types.ts` with exported types:

```ts
export type AutomationActionType =
  | 'ensure_plan_draft'
  | 'ensure_package_drafts'
  | 'request_manual_path'
  | 'project_runtime_snapshot';

export interface StablePolicyObservationIdentity {
  repoId: string;
  policyStatus: 'missing' | 'loaded' | 'parse_failed' | 'unsafe_path';
  policyDigest?: string;
  parserVersion: string;
  reasonCode?: string;
}
```

Include `NextAction`, `RuntimeSnapshot`, `RuntimeSnapshotRepo`, `RuntimeSnapshotTarget`, and `ActionInputJson` per spec.

- [ ] **Step 7: Implement idempotency helpers**

Create `packages/automation/src/idempotency.ts` using canonical JSON with sorted keys and SHA-256:

```ts
export const mutatingActionIdempotencyKey = (input: MutatingActionIdentity): string =>
  `automation-action:v1:${sha256(canonicalJson({ ...input, policyDigest: undefined }))}`;

export const projectRuntimeSnapshotIdempotencyKey = (input: StablePolicyObservationIdentity): string =>
  `automation-action:v1:${sha256(canonicalJson({ actionType: 'project_runtime_snapshot', ...input }))}`;
```

- [ ] **Step 8: Implement signing helpers**

Create `packages/automation/src/signing.ts` with:

- `SignAutomationRequestInput`
- `sha256Hex(rawBody: Buffer | string)`
- `canonicalAutomationSignaturePayload(input)`
- `signAutomationRequest(input)`
- `verifyAutomationRequestSignature(input)`

Use lowercase hex HMAC-SHA256 and the exact canonical payload from the spec. `verifyAutomationRequestSignature` accepts an optional `now` ISO timestamp for deterministic skew-window unit tests; the Nest guard omits it and uses the current time.

- [ ] **Step 9: Export package API**

Create `packages/automation/src/index.ts` exporting `types`, `idempotency`, and `signing`.

Update `tsconfig.base.json` path aliases and `tests/bootstrap.test.ts`.

- [ ] **Step 10: Run focused tests**

Run:

```bash
pnpm test tests/bootstrap.test.ts tests/automation/idempotency.test.ts tests/automation/signing.test.ts
pnpm --filter @forgeloop/automation build
```

Expected: PASS.

- [ ] **Step 11: Commit**

Run:

```bash
git add packages/automation tsconfig.base.json tests/bootstrap.test.ts tests/automation
git commit -m "feat: add automation package identity and signing helpers"
```

## Task 3: Raw-Body Internal Automation Guard

**Files:**
- Modify: `apps/control-plane-api/src/main.ts`
- Modify: `apps/control-plane-api/package.json`
- Create: `apps/control-plane-api/src/modules/automation/trusted-automation-actor.guard.ts`
- Create: `apps/control-plane-api/src/modules/automation/automation.dto.ts`
- Create: `apps/control-plane-api/src/modules/automation/automation.controller.ts`
- Create: `apps/control-plane-api/src/modules/automation/automation.module.ts`
- Modify: `apps/control-plane-api/src/app.module.ts`
- Test: `tests/api/automation-internal-auth.test.ts`

- [ ] **Step 1: Write failing guard tests**

Create `tests/api/automation-internal-auth.test.ts`:

```ts
import { beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.stubEnv('FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET', 'test-secret');
});

it('rejects unsigned internal automation requests', async () => {
  const { app } = await bootAutomationApp();
  await request(app.getHttpServer()).get('/internal/automation/runtime-snapshot').expect(401);
});

it('rejects signed non-daemon actors', async () => {
  const timestamp = new Date().toISOString();
  const headers = signAutomationRequest({
    method: 'GET',
    pathAndQuery: '/internal/automation/runtime-snapshot',
    rawBody: Buffer.alloc(0),
    actorId: 'admin-actor',
    actorClass: 'human_admin',
    daemonIdentity: 'not-a-daemon',
    timestamp,
    secret: 'test-secret',
  });
  await request(app.getHttpServer()).get('/internal/automation/runtime-snapshot').set(headers).expect(403);
});

it('rejects a changed body hash', async () => {
  const timestamp = new Date().toISOString();
  const headers = signAutomationRequest({
    method: 'POST',
    pathAndQuery: '/internal/automation/actions',
    rawBody: Buffer.from('{"a":1}'),
    actorId: 'daemon-actor',
    actorClass: 'automation_daemon',
    daemonIdentity: 'daemon-1',
    timestamp,
    secret: 'test-secret',
  });
  await request(app.getHttpServer()).post('/internal/automation/actions').set(headers).send({ a: 2 }).expect(401);
});

it('rejects an altered query string', async () => {
  const timestamp = new Date().toISOString();
  const headers = signAutomationRequest({
    method: 'GET',
    pathAndQuery: '/internal/automation/runtime-snapshot?scope=repo-a',
    rawBody: Buffer.alloc(0),
    actorId: 'daemon-actor',
    actorClass: 'automation_daemon',
    daemonIdentity: 'daemon-1',
    timestamp,
    secret: 'test-secret',
  });
  await request(app.getHttpServer()).get('/internal/automation/runtime-snapshot?scope=repo-b').set(headers).expect(401);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm test tests/api/automation-internal-auth.test.ts
```

Expected: FAIL because module/guard/raw-body capture do not exist.

- [ ] **Step 3: Add raw-body capture**

Add `@forgeloop/automation: "workspace:*"` to `apps/control-plane-api/package.json`, because the guard imports shared signing verification from the automation package.

Modify `apps/control-plane-api/src/main.ts` to pass raw-body capture to the Nest adapter. Use Express `verify` support, or Nest's `rawBody` option if available in the installed version. Ensure tests booting `AppModule` use the same setup helper.

If tests create the app directly, add a shared helper in the test file:

```ts
const createAutomationTestApp = async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  await app.init();
  return app;
};
```

- [ ] **Step 4: Implement guard**

`TrustedAutomationActorGuard` must:

- require all `X-Forgeloop-*` headers from the spec;
- recompute body SHA from captured raw bytes;
- use `req.originalUrl` for path/query;
- call `verifyAutomationRequestSignature`;
- return `401` for missing/invalid signature/timestamp/body hash;
- return `403` for signed actor class other than `automation_daemon`.

- [ ] **Step 5: Add minimal controller**

Create `AutomationController` with guarded placeholder:

```ts
@Controller('/internal/automation')
@UseGuards(TrustedAutomationActorGuard)
export class AutomationController {
  @Get('/runtime-snapshot')
  runtimeSnapshot() {
    return { generated_at: new Date(0).toISOString(), projects: [], repos: [], work_items_requiring_plan: [], plan_revisions_requiring_packages: [], recent_action_runs: [], run_enqueue_disabled_reason: 'run_enqueue_disabled_by_scope' };
  }

  @Post('/actions')
  createActionGuardProbe() {
    return { action: null };
  }
}
```

These guard-probe endpoints exist only so Task 3 can verify the guard on matched routes. `POST /actions` is replaced by the real action lifecycle implementation in Task 5, and `GET /runtime-snapshot` is replaced in Task 7.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm test tests/api/automation-internal-auth.test.ts tests/api/run-auth.test.ts
```

Expected: PASS. Existing `/p0/...` trusted actor signing remains compatible.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/control-plane-api/package.json apps/control-plane-api/src tests/api/automation-internal-auth.test.ts
git commit -m "feat: require signed internal automation actors"
```

## Task 4: Action Run Domain, Schema, Repository Primitives

**Files:**
- Modify: `packages/domain/src/automation.ts`
- Modify: `packages/db/src/schema/automation.ts`
- Modify: `packages/db/src/repositories/p0-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-p0-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-p0-repository.ts`
- Modify: `packages/db/src/reset.ts`
- Test: `tests/db/schema.test.ts`
- Test: `tests/db/repository-contract.ts`
- Test: `tests/db/automation-repository.test.ts`

- [ ] **Step 1: Write failing schema tests**

In `tests/db/schema.test.ts`, assert `automation_action_runs` has:

- `target_version`
- `precondition_fingerprint`
- `action_input_json`

- [ ] **Step 2: Write failing repository contract tests**

In `tests/db/repository-contract.ts`, add tests:

```ts
const input = {
  id: 'automation-action-contract-pending',
  action_type: 'ensure_plan_draft',
  target_object_type: 'work_item',
  target_object_id: work_item_id,
  target_revision_id: spec_revision_id,
  target_status: 'approved',
  target_version: 1,
  idempotency_key: 'action-key-contract-pending',
  automation_scope: `repo:${project_id}:repo-1`,
  automation_settings_version: 2,
  capability_fingerprint: settings.capability_fingerprint,
  precondition_fingerprint: 'pre-1',
  action_input_json: { work_item_id, spec_revision_id },
  status: 'pending',
  now: '2026-05-15T00:00:00.000Z',
} satisfies CreateOrReplayAutomationActionRunInput;

const pending = await repository.createOrReplayAutomationActionRun(input);
expect(pending.status).toBe('pending');
expect(pending.claim_token).toBeUndefined();

await expect(repository.createOrReplayAutomationActionRun({ ...input, precondition_fingerprint: 'changed' })).rejects.toThrow(/idempotency|identity|precondition/i);

const claimed = await repository.claimNextAutomationActionRun({
  now: '2026-05-15T00:00:01.000Z',
  claim_token: 'claim-1',
  locked_until: '2026-05-15T00:05:01.000Z',
  limit: 10,
});
expect(claimed?.id).toBe(pending.id);
```

Add concurrent claim test with `Promise.all` and assert only one result has the pending action id.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm test tests/db/schema.test.ts tests/db/automation-repository.test.ts
```

Expected: FAIL because fields and methods do not exist.

- [ ] **Step 4: Extend domain type**

In `packages/domain/src/automation.ts`, update `AutomationActionRun`:

```ts
target_version?: number;
precondition_fingerprint: string;
action_input_json: Record<string, unknown>;
```

Add explicit action status/type helpers if useful. Keep `result_json` and `metadata_json` internal-only.

- [ ] **Step 5: Extend schema**

In `packages/db/src/schema/automation.ts`, add:

```ts
targetVersion: integer('target_version'),
preconditionFingerprint: text('precondition_fingerprint').notNull(),
actionInputJson: jsonb('action_input_json').$type<AutomationActionRun['action_input_json']>().notNull(),
```

- [ ] **Step 6: Extend repository interface**

In `packages/db/src/repositories/p0-repository.ts`, add:

- `CreateOrReplayAutomationActionRunInput`
- `ClaimNextAutomationActionRunInput`
- `GetClaimedAutomationActionRunInput`
- `LatestCompletedProjectionActionRunInput`
- `createOrReplayAutomationActionRun`
- `claimNextAutomationActionRun`
- `getClaimedAutomationActionRun`
- `latestCompletedProjectionActionRun`

- [ ] **Step 7: Implement in-memory repository**

Implement:

- create pending row if idempotency key is new;
- replay if mutating identity or stable projection identity matches;
- throw `DomainError('INVALID_TRANSITION', ...)` on mismatch;
- atomic claim-next using existing object lock manager;
- latest projection lookup by repo id + stable policy observation identity.

- [ ] **Step 8: Implement drizzle repository**

Implement equivalent behavior in transactions. For `claimNextAutomationActionRun`, select ordered claimable candidates and update exactly one row. If update affects no row because another daemon won, retry next candidate or return `undefined`.

- [ ] **Step 9: Run repository tests**

Run:

```bash
pnpm test tests/db/schema.test.ts tests/db/automation-repository.test.ts tests/db/repository.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add packages/domain/src/automation.ts packages/db/src tests/db
git commit -m "feat: add durable automation action lifecycle primitives"
```

## Task 5: Internal Action Lifecycle API And Redaction DTOs

**Files:**
- Create/Modify: `apps/control-plane-api/src/modules/automation/automation.dto.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation.controller.ts`
- Create: `apps/control-plane-api/src/modules/automation/automation-action.service.ts` if needed to keep controller thin
- Test: `tests/api/automation-action-lifecycle.test.ts`

- [ ] **Step 1: Write failing API tests**

Create tests for:

- `POST /internal/automation/actions` creates pending row;
- replay returns same DTO;
- mismatch returns `409 command_idempotency_conflict`;
- missing `action_input_json` returns `400` or `422`;
- `actions:claim-next` returns one action with claim token;
- no claimable action returns `200` with `{ action: null }` or `204`, pick one and keep it consistent;
- complete/gate-pending/block/fail require correct claim token;
- responses omit `result_json`, `metadata_json`, raw errors, and local paths.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm test tests/api/automation-action-lifecycle.test.ts
```

Expected: FAIL because endpoints do not exist or return placeholders.

- [ ] **Step 3: Add zod DTO schemas**

In `automation.dto.ts`, define:

- `createAutomationActionRunSchema`
- `claimNextAutomationActionRunSchema`
- `completeAutomationActionRunSchema`
- `gatePendingAutomationActionRunSchema`
- `blockAutomationActionRunSchema`
- `failAutomationActionRunSchema`
- public DTO mapper functions like `toAutomationActionRunDto`.

Use allowlisted DTO fields only.

- [ ] **Step 4: Implement controller endpoints**

Add:

- `POST /internal/automation/actions`
- `POST /internal/automation/actions:claim-next`
- `POST /internal/automation/actions/:id/complete`
- `POST /internal/automation/actions/:id/gate-pending`
- `POST /internal/automation/actions/:id/block`
- `POST /internal/automation/actions/:id/fail`

All endpoints use `TrustedAutomationActorGuard`.

- [ ] **Step 5: Map repository/domain errors**

Map idempotency/identity mismatch to stable response:

```json
{ "code": "command_idempotency_conflict", "message": "Automation action idempotency identity changed." }
```

Do not return stack traces.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm test tests/api/automation-action-lifecycle.test.ts tests/api/automation-internal-auth.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/control-plane-api/src/modules/automation tests/api/automation-action-lifecycle.test.ts
git commit -m "feat: expose internal automation action lifecycle"
```

## Task 6: Extract AutomationCommandService And Claim Binding

**Files:**
- Create/Modify: `apps/control-plane-api/src/modules/automation/automation-command.service.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation.controller.ts`
- Modify: `apps/control-plane-api/src/p0/p0.service.ts`
- Modify: `apps/control-plane-api/src/p0/p0.controller.ts`
- Test: `tests/api/automation-commands.test.ts`

- [ ] **Step 1: Write failing claim-binding API tests**

Add tests that create and claim an action, then call draft command endpoint with mismatches:

- missing claim token;
- expired claim token;
- wrong action type;
- wrong target;
- wrong idempotency key;
- wrong automation settings version;
- wrong capability fingerprint;
- wrong precondition fingerprint;
- wrong `action_input_json`.

Expected for each: `409` or `422`, and no Plan/ExecutionPackage/ManualPathHold write.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm test tests/api/automation-commands.test.ts
```

Expected: FAIL because claim binding is not implemented.

- [ ] **Step 3: Move automation command methods**

Move these methods from `P0Service` into `AutomationCommandService` without changing behavior:

- `setAutomationCapabilities`
- `disableAutomation`
- `requestManualPath`
- `resolveManualPath`
- `ensurePlanDraftForApprovedSpec`
- `ensureExecutionPackageDraftsForPlanRevision`
- `enqueueRunIfPackageStillReady`

Leave non-automation P0 methods in `P0Service`.

- [ ] **Step 4: Wire Nest module exports for compatibility**

Update `AutomationModule` to provide and export `AutomationCommandService`.

Update `P0Module` to import `AutomationModule` so legacy `/p0/...` controllers or `P0Service` compatibility paths can inject/delegate to `AutomationCommandService`. Keep dependency direction acyclic: `AutomationModule` imports `ControlPlaneCoreModule` only, and must not import `P0Module` or `P0Service`.

- [ ] **Step 5: Add active claim validation helper**

In `AutomationCommandService`, add:

```ts
private async assertActiveActionClaim(input: {
  actionRunId: string;
  claimToken: string;
  actionType: AutomationActionType;
  targetObjectType: string;
  targetObjectId: string;
  targetRevisionId?: string;
  targetVersion?: number;
  idempotencyKey: string;
  automationSettingsVersion: number;
  capabilityFingerprint: string;
  preconditionFingerprint: string;
  actionInputJson: Record<string, unknown>;
  now: string;
}): Promise<void>
```

This helper loads `getClaimedAutomationActionRun`, verifies every field from the spec, and fails before product writes.

- [ ] **Step 6: Add internal draft command endpoints**

Add guarded endpoints:

- `POST /internal/automation/work-items/:workItemId/ensure-plan-draft`
- `POST /internal/automation/plan-revisions/:planRevisionId/ensure-package-drafts`
- `POST /internal/automation/manual-path-holds`

They must re-read current product state inside the command boundary and use command idempotency as existing methods already do.

- [ ] **Step 7: Preserve legacy `/p0/...` routes**

Update `P0Service` or `P0Controller` compatibility paths to delegate to `AutomationCommandService` where needed. Existing tests must keep passing.

- [ ] **Step 8: Verify `run_enqueue` remains disabled for daemon**

Add or update a test asserting the internal daemon planner/API cannot produce or execute an enqueue action in this MVP. `enqueueRunIfPackageStillReady` may exist in service for compatibility but no daemon-facing endpoint/planner path enables it.

- [ ] **Step 9: Run focused tests**

Run:

```bash
pnpm test tests/api/automation-commands.test.ts tests/api/automation-action-lifecycle.test.ts tests/api/release-module.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add apps/control-plane-api/src tests/api/automation-commands.test.ts
git commit -m "feat: extract automation command boundary"
```

## Task 7: Runtime Snapshot Service

**Files:**
- Modify: `apps/control-plane-api/src/modules/automation/runtime-snapshot.service.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation.controller.ts`
- Modify: `apps/control-plane-api/src/modules/automation/automation.dto.ts`
- Modify: `packages/db/src/repositories/p0-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-p0-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-p0-repository.ts`
- Test: `tests/api/automation-runtime-snapshot.test.ts`

- [ ] **Step 1: Write failing snapshot tests**

Create `tests/api/automation-runtime-snapshot.test.ts` with cases:

- approved SpecRevision missing Plan draft appears;
- approved PlanRevision missing package generation appears;
- active manual holds suppress mutating eligibility;
- terminal WorkItem is absent or marked blocked;
- ready package reports `run_enqueue_disabled_by_scope`;
- latest completed `project_runtime_snapshot` projection appears;
- failed or unsafe current policy projection includes `last_known_good_policy_digest` and `last_known_good_observed_at` from the latest prior loaded projection for the same repo;
- snapshot redacts raw `result_json`, `metadata_json`, raw runtime metadata, and public-unsafe local paths.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm test tests/api/automation-runtime-snapshot.test.ts
```

Expected: FAIL because snapshot service is placeholder.

- [ ] **Step 3: Add repository snapshot queries**

Either implement typed query methods directly on `P0Repository` or replace/remove the placeholder `listRuntimeSnapshotRows()`.

Required query result data:

- project/repo automation settings;
- repo ids and internal local path;
- current approved Specs without Plan drafts;
- current approved PlanRevisions without package drafts;
- active holds;
- latest action summaries;
- latest completed projection by repo + stable policy observation identity;
- latest completed loaded projection by repo for last-known-good policy derivation;
- ready package `run_enqueue_disabled_by_scope` projection.

- [ ] **Step 4: Implement DTO mappers**

In `automation.dto.ts`, create allowlisted mappers:

- `toRuntimeSnapshotDto`
- `toRuntimeSnapshotRepoDto`
- `toRuntimeSnapshotTargetDto`
- `toActionRunSummaryDto`
- `toPolicyProjectionDto`

Only `daemon_internal_local_path` may contain a local path.

- [ ] **Step 5: Implement service**

`RuntimeSnapshotService.getRuntimeSnapshot()` should return:

- `generated_at`
- `projects`
- `repos`
- `work_items_requiring_plan`
- `plan_revisions_requiring_packages`
- `recent_action_runs`
- `run_enqueue_disabled_reason: 'run_enqueue_disabled_by_scope'`

When the current projected policy status is `parse_failed` or `unsafe_path`, derive `last_known_good_policy_digest` and `last_known_good_observed_at` from the latest prior completed `project_runtime_snapshot` action for the same repo whose projected status was `loaded`. This is control-plane-derived projection data, not daemon-local state.

- [ ] **Step 6: Wire endpoint**

Update `GET /internal/automation/runtime-snapshot` to call `RuntimeSnapshotService`.

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm test tests/api/automation-runtime-snapshot.test.ts tests/api/automation-internal-auth.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add apps/control-plane-api/src/modules/automation packages/db/src tests/api/automation-runtime-snapshot.test.ts
git commit -m "feat: add automation runtime snapshot"
```

## Task 8: Planner And Executor Package

**Files:**
- Modify: `packages/automation/src/types.ts`
- Modify: `packages/automation/src/planner.ts`
- Modify: `packages/automation/src/executor.ts`
- Modify: `packages/automation/src/http-client.ts`
- Modify: `packages/automation/src/index.ts`
- Test: `tests/automation/planner.test.ts`
- Test: `tests/automation/executor.test.ts`

- [ ] **Step 1: Write failing planner tests**

In `tests/automation/planner.test.ts`, assert:

- approved Spec missing Plan draft -> `ensure_plan_draft`;
- approved PlanRevision missing package drafts -> `ensure_package_drafts`;
- active hold -> no mutating action or `request_manual_path`;
- multi-repo ambiguity -> `request_manual_path` with canonical `scope_key`;
- ready package never emits `enqueue_run`;
- new `WORKFLOW.md` observation emits `project_runtime_snapshot`;
- unchanged policy observation suppresses duplicate projection action.

- [ ] **Step 2: Write failing executor tests**

In `tests/automation/executor.test.ts`, use a fake HTTP client and assert:

- executor creates/replays action before claiming;
- claimed `ensure_plan_draft` calls the correct command endpoint with persisted `action_input_json`;
- stale precondition maps to `gate_pending`;
- active hold maps to `blocked`;
- idempotency conflict maps to `failed` with `retryable=false`;
- `project_runtime_snapshot` completes without calling a draft command;
- `project_runtime_snapshot` completion uses only the current public-safe observation fields from `action_input_json`; last-known-good projection is derived later by `RuntimeSnapshotService`, not from daemon-local state;
- executor never calls run enqueue.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm test tests/automation/planner.test.ts tests/automation/executor.test.ts
```

Expected: FAIL because planner/executor are not implemented.

- [ ] **Step 4: Implement planner**

Implement pure `planNextActions(snapshot)` with no HTTP, filesystem, DB, or current-time access except explicit inputs.

Use stable idempotency helpers from Task 2. Build `action_input_json` for every action.

- [ ] **Step 5: Implement HTTP client**

`AutomationHttpClient` wraps `fetch` and signs every request using `signAutomationRequest`.

Expose typed methods:

- `runtimeSnapshot`
- `createOrReplayAction`
- `claimNextAction`
- `completeAction`
- `gatePendingAction`
- `blockAction`
- `failAction`
- `ensurePlanDraft`
- `ensurePackageDrafts`
- `requestManualPathHold`

- [ ] **Step 6: Implement executor**

`executeClaimedAction` switches on `action_type`:

- `ensure_plan_draft` -> work item endpoint;
- `ensure_package_drafts` -> plan revision endpoint;
- `request_manual_path` -> manual hold endpoint;
- `project_runtime_snapshot` -> complete action with public-safe projection envelope.

Do not add `enqueue_run`.

- [ ] **Step 7: Run package tests**

Run:

```bash
pnpm test tests/automation/planner.test.ts tests/automation/executor.test.ts
pnpm --filter @forgeloop/automation build
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add packages/automation/src tests/automation
git commit -m "feat: add automation planner and executor"
```

## Task 9: Read-Only WORKFLOW.md Digest And Allowed Roots

**Files:**
- Modify: `packages/automation/src/policy-digest.ts`
- Modify: `packages/automation/src/types.ts`
- Create: `apps/automation-daemon/src/workflow-policy-loader.ts`
- Test: `tests/automation/policy-digest.test.ts`

- [ ] **Step 1: Write failing policy digest tests**

Create tests for:

- missing policy -> `missing`;
- valid digest stability;
- invalid front matter -> `parse_failed`;
- repo root outside configured allowed roots -> `unsafe_path`;
- absolute candidate path -> `unsafe_path`;
- outside-repo candidate path -> `unsafe_path`;
- root-equal candidate path -> `unsafe_path`;
- symlink escape -> `unsafe_path`.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm test tests/automation/policy-digest.test.ts
```

Expected: FAIL because policy digest helper is not implemented.

- [ ] **Step 3: Implement lower-level helper**

In `packages/automation/src/policy-digest.ts`, export:

```ts
export const loadWorkflowPolicyDigest = async (input: {
  repoRoot: string;
  allowedRepoRoots: string[];
  policyPath?: string;
  parserVersion: string;
}): Promise<WorkflowPolicyDigestStatus>
```

Rules:

- canonicalize allowed roots with `realpath`;
- canonicalize repo root with `realpath`;
- reject repo root outside allowed roots before reading;
- default `policyPath` to `WORKFLOW.md`;
- reject absolute, outside-repo, root-equal, and symlink-escape paths;
- parse front matter only for MVP status fields using a small local line scanner; do not import a YAML package unless `packages/automation/package.json` is updated with an explicit dependency;
- digest normalized policy content plus parser version;
- never change runtime behavior based on contents.

- [ ] **Step 4: Implement daemon loader wrapper**

In `apps/automation-daemon/src/workflow-policy-loader.ts`, call the package helper with fixed `policyPath: 'WORKFLOW.md'` and configured allowed roots.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm test tests/automation/policy-digest.test.ts
pnpm --filter @forgeloop/automation build
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/automation/src/policy-digest.ts apps/automation-daemon/src/workflow-policy-loader.ts tests/automation/policy-digest.test.ts
git commit -m "feat: add read-only workflow policy digest"
```

## Task 10: Automation Daemon Loop

**Files:**
- Create: `apps/automation-daemon/package.json`
- Create: `apps/automation-daemon/tsconfig.json`
- Create: `apps/automation-daemon/src/config.ts`
- Create: `apps/automation-daemon/src/automation-daemon.ts`
- Create: `apps/automation-daemon/src/main.ts`
- Modify: `package.json`
- Modify: `tests/bootstrap.test.ts`
- Test: `tests/automation/daemon.test.ts`

- [ ] **Step 1: Write failing daemon tests**

In `tests/automation/daemon.test.ts`, use a fake `AutomationHttpClient` and fake policy loader:

- fetches runtime snapshot;
- loads policy digest for repos under allowed roots;
- computes actions;
- creates/replays actions;
- claims and executes one action;
- handles no claimable action with backoff;
- handles `SIGINT`/stop by finishing current iteration;
- never calls `enqueue_run`.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm test tests/automation/daemon.test.ts
```

Expected: FAIL because app does not exist.

- [ ] **Step 3: Create app package**

`apps/automation-daemon/package.json`:

```json
{
  "name": "@forgeloop/automation-daemon",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "start": "tsx src/main.ts"
  },
  "dependencies": {
    "@forgeloop/automation": "workspace:*"
  }
}
```

- [ ] **Step 4: Implement config**

`config.ts` reads:

- `FORGELOOP_CONTROL_PLANE_URL`
- `FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET`
- `FORGELOOP_AUTOMATION_DAEMON_IDENTITY`
- `FORGELOOP_AUTOMATION_ACTOR_ID`
- `FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS` as path-list
- loop interval/backoff envs with safe defaults.

Throw early for missing required config.

- [ ] **Step 5: Implement loop**

`AutomationDaemon.runOnce()`:

1. Fetch snapshot.
2. Load policy digest for each repo using allowed roots.
3. Merge digest observations into planner input.
4. Plan actions.
5. Create/replay each action.
6. Claim next action.
7. Execute claimed action.

Keep loop state in memory only; recovery comes from `automation_action_runs`.

- [ ] **Step 6: Implement main**

`main.ts` constructs config/client/daemon and handles `SIGINT`/`SIGTERM` by stopping after current iteration.

- [ ] **Step 7: Add root scripts**

Modify root `package.json`:

```json
"dev:automation-daemon": "pnpm --filter @forgeloop/automation-daemon start"
```

Do not add run enqueue scripts.

Update `tests/bootstrap.test.ts` so the registered private app manifest list includes `apps/automation-daemon/package.json` with name `@forgeloop/automation-daemon`.

- [ ] **Step 8: Run tests/build**

Run:

```bash
pnpm test tests/bootstrap.test.ts tests/automation/daemon.test.ts tests/automation/planner.test.ts tests/automation/executor.test.ts
pnpm --filter @forgeloop/automation-daemon build
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add apps/automation-daemon package.json tests/bootstrap.test.ts tests/automation/daemon.test.ts
git commit -m "feat: add HTTP automation daemon loop"
```

## Task 11: End-To-End Daemon Integration And Dogfood

**Files:**
- Test: `tests/api/automation-daemon.integration.test.ts`
- Create: `scripts/automation-dogfood.ts`
- Modify: `package.json`
- Test: `tests/smoke/automation-dogfood-script.test.ts`

- [ ] **Step 1: Write failing integration test**

Create `tests/api/automation-daemon.integration.test.ts`:

- boot in-process `AppModule`;
- seed project/repo/work item/spec/plan state with `draft_only`;
- run daemon `runOnce()` enough times to create Plan draft;
- run again to create ExecutionPackage drafts;
- assert action runs are created/replayed/claimed/completed;
- assert no `RunSession` exists;
- restart daemon instance and assert it continues from `automation_action_runs`.

- [ ] **Step 2: Run integration test and verify failure**

Run:

```bash
pnpm test tests/api/automation-daemon.integration.test.ts
```

Expected: FAIL until all pieces are wired.

- [ ] **Step 3: Implement dogfood script**

Create `scripts/automation-dogfood.ts` that:

- boots a local in-memory control plane;
- seeds draft-only automation state;
- runs daemon loop deterministically;
- prints public-safe summary;
- exits nonzero if no Plan/ExecutionPackage drafts were created;
- exits nonzero if any RunSession was enqueued.

- [ ] **Step 4: Add root script and smoke test**

Modify `package.json`:

```json
"automation:dogfood": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/automation-dogfood.ts"
```

Create `tests/smoke/automation-dogfood-script.test.ts` using the existing smoke script pattern to verify the script path and command.

- [ ] **Step 5: Run integration and dogfood tests**

Run:

```bash
pnpm test tests/api/automation-daemon.integration.test.ts tests/smoke/automation-dogfood-script.test.ts
pnpm automation:dogfood
```

Expected: PASS and dogfood output explicitly says no run session was enqueued.

- [ ] **Step 6: Commit**

Run:

```bash
git add tests/api/automation-daemon.integration.test.ts tests/smoke/automation-dogfood-script.test.ts scripts/automation-dogfood.ts package.json
git commit -m "test: dogfood HTTP automation daemon MVP"
```

## Task 12: Final Verification And Documentation

**Files:**
- Create or Modify: `docs/automation-daemon.md`
- Modify: `README.md` only if it already references automation commands in the touched area

- [ ] **Step 1: Write/update documentation**

Create `docs/automation-daemon.md` with:

- daemon is HTTP-only sidecar;
- required env vars;
- allowed repo roots behavior;
- `WORKFLOW.md` is read-only observability;
- `run_enqueue` is disabled in this MVP;
- dogfood command.

- [ ] **Step 2: Run full verification**

Run:

```bash
pnpm test
pnpm -r build
git diff --check
pnpm automation:dogfood
```

Expected: all pass.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
git status --short
git diff --stat origin/main...HEAD
```

Expected: only planned files changed.

- [ ] **Step 4: Commit docs or final fixes**

Run:

```bash
git add docs/automation-daemon.md README.md
git commit -m "docs: document automation daemon MVP"
```

If there are no docs changes beyond previous commits, skip this commit.

## Final Handoff Checklist

- [ ] `apps/automation-daemon` does not import `P0Service`, Nest control-plane modules, DB schemas, or repository implementations.
- [ ] `/internal/automation/*` requires signed `automation_daemon` headers in local, test, and production.
- [ ] `automation_action_runs` is the only daemon recovery state.
- [ ] `project_runtime_snapshot` identity is action type + stable policy observation identity only.
- [ ] `WORKFLOW.md` digest never affects package content, checks, paths, hooks, resources, executor, or run enqueue.
- [ ] No daemon path emits or executes `enqueue_run`.
- [ ] `pnpm test`, `pnpm -r build`, `git diff --check`, and `pnpm automation:dogfood` pass.
