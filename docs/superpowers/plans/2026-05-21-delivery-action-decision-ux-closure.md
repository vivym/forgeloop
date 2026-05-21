# Delivery Action & Decision UX Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the post-planning delivery path state-aware and executable from Work Item Cockpit through Package run, Review decision, QA/Test acceptance, and Release readiness without Dev Tools or raw IDs.

**Architecture:** Add a sanitized delivery runtime readiness contract and one shared DB query helper, then wire that helper into Package page buttons, Work Item Cockpit ProductActions, and Product Lane ProductActions. Keep complex decisions as object-page forms, not ProductAction commands, and split Package/Review/Release UI logic into local action-model helpers so React components render decisions instead of re-deriving domain policy.

**Tech Stack:** TypeScript, Zod, `@forgeloop/contracts`, `@forgeloop/domain`, `@forgeloop/db`, NestJS query module, React 19, React Router, TanStack Query, Vitest, Testing Library.

---

## Source Documents

- Stream A spec: `docs/superpowers/specs/2026-05-21-delivery-action-decision-ux-closure-design.md`
- Coordination spec: `docs/superpowers/specs/2026-05-21-main-delivery-product-closure-parallelization-design.md`
- PRD: `docs/PRD_v1.md`
- Current ProductAction builders: `packages/db/src/queries/product-action-builders.ts`
- Current Work Item Cockpit readiness: `packages/db/src/queries/work-item-delivery-readiness.ts`
- Current Product Lane query: `packages/db/src/queries/product-lane-queries.ts`
- Current Package route: `apps/web/src/features/execution-packages/execution-package-routes.tsx`
- Current Review route: `apps/web/src/features/review-packets/review-packet-routes.tsx`
- Current Release route: `apps/web/src/features/releases/release-routes.tsx`

## Scope Check

This is one integrated Stream A plan. It touches contracts, DB query helpers, a read-only query endpoint, ProductAction projection, Web API hooks, and three object detail pages because those pieces must share one decision model for the post-planning delivery path.

This plan intentionally excludes Typed Work Item Intake, Work Item create DTO changes, ProductAction command union changes, Evolution Loop, Retrospective, a full Test Center, runtime setup/remediation, credential management, worker registration, launch lease semantics, old Workbench compatibility, and the parallel `feature/codex-generation-runtime-plan-package` worktree.

## Coordination And Merge Rules

- Start implementation from updated `main` after Stream B merges, or rebase this branch onto Stream B before opening/merging PR.
- Do not add `owner_actor_id` to new Work Item type-lane product-facing contracts. If Stream B has already renamed Work Item Driver fields, consume the new public names.
- ProductAction command union remains exactly:
  - `generate_spec_draft`
  - `generate_plan_draft`
  - `generate_packages`
  - `mark_package_ready`
  - `run_package`
- Object-page command endpoints may remain available for rerun, force rerun, review decisions, and release decisions, but they must not become ProductAction command variants in this stream.
- Do not call browser-facing code into `/internal/codex-runtime/*`, runtime setup, credential, worker, launch, or lease endpoints.
- Do not expose profile ids, credential binding ids, worker ids, lease ids, digests, lease timing, local paths, raw config, raw runtime metadata, raw auth, or Docker command internals in the public readiness DTO.
- Do not display raw object ids or fingerprints in Package, Review, or Release page copy. Use object titles, keys, labels, and safe navigation links instead. API payloads may carry object ids needed for routing and mutations, but user-facing text should not echo them as product copy.
- Launch lease and run-worker fence failures are not pre-run blockers in this plan. They surface after enqueue through Run Console/runtime event state.

## Implementation Rules

- Use @superpowers:test-driven-development for each task: write focused failing tests first, run them, implement the minimum, rerun.
- Use @superpowers:verification-before-completion before each task commit.
- Keep every task independently reviewable and commit after each task.
- Prefer pure action-model helpers and DB query helpers over business-rule duplication in React components.
- Use existing UI primitives only: `ActionRail`, `DetailLayout`, `Section`, `Drawer`, `Button`, `Textarea`, `Input`, `Select`, `StatusPill`, `Badge`, `DataTable`.

## Current Contract Literals To Preserve

- Review Packet statuses: `draft`, `ready`, `in_review`, `completed`, `escalated`, `archived`.
- Review decisions: `none`, `approved`, `changes_requested`, `need_more_context`, `escalate`.
- Force-rerun endpoint eligibility is stricter than generic "open review" semantics: `apps/control-plane-api/src/modules/run-control/run-control.service.ts` currently requires the current Review Packet for `previous_run_session_id` to be `ready` or `in_review` with `decision === 'none'`. Do not broaden Package page force-rerun enablement to `draft` or `escalated` unless the endpoint validation changes in the same implementation.
- Run Session nonterminal statuses: `queued`, `running`, `waiting_for_input`, `stalled`, `resuming`, `cancel_requested`.
- Release phases: `draft`, `candidate`, `approval`, `rollout`, `observing`, `completed`, `closed`.
- Release gate states include `not_submitted`, `awaiting_approval`, `changes_requested`, `approved`, `rollout_failed`, `rollout_succeeded`.
- Release resolutions: `none`, `completed`, `rolled_back`, `cancelled`.

## File Structure And Ownership

### Contracts

- Create `packages/contracts/src/delivery-runtime-readiness.ts`
  - Own the public-safe read-only readiness DTO for delivery run actions.
  - Own blocker code schema, action state schema, and response schema.
  - No object ids or raw runtime internals; navigation must use safe `next_step_href` links only.
- Modify `packages/contracts/src/work-item-delivery-readiness.ts`
  - Redact the existing public cockpit `runtime_metadata` projection so it does not expose worker ids, lease timing, cursors, local paths, raw config, raw auth, or other raw runtime internals.
- Modify `packages/contracts/src/index.ts`
  - Export the new readiness module.
- Tests:
  - Create `tests/contracts/delivery-runtime-readiness.test.ts`.
  - Modify `tests/contracts/work-item-delivery-readiness.test.ts`.
  - Modify `tests/contracts/contracts.test.ts` only if the shared contract barrel needs coverage.

### DB Read Models

- Modify `packages/db/src/repositories/delivery-repository.ts`
  - Add read-only credential binding candidate lookup for product-safe readiness, if the existing repository cannot derive credential state without a Web-supplied credential id.
  - Add read-only active runtime profile diagnostics if needed to distinguish "no `run_execution` profile exists" from "only incompatible target profiles exist".
  - Add read-only worker readiness diagnostics if needed to distinguish no online worker, unsupported target capability, Docker image capability mismatch, and network policy/provider mismatch. Return blocker categories only, not worker ids or raw worker records.
- Modify `packages/db/src/repositories/in-memory-delivery-repository.ts`
  - Implement the new read-only lookup.
- Modify `packages/db/src/repositories/drizzle-delivery-repository.ts`
  - Implement the new read-only lookup.
- Create `packages/db/src/queries/delivery-runtime-readiness.ts`
  - Own sanitized readiness derivation for `local_codex` `run_execution`.
  - Call existing runtime repository methods and return only contract-safe fields.
  - Map ambiguous or missing credential state to public blocker codes.
- Modify `packages/db/src/queries/work-item-cockpit-queries.ts`
  - Redact `projectRuntimeMetadata` and leased-run fallback projection to match the tightened public cockpit runtime metadata contract.
  - Precompute runtime readiness for current packages and pass it into `deriveWorkItemDeliveryReadiness`.
- Modify `packages/db/src/queries/work-item-delivery-readiness.ts`
  - Consume precomputed readiness for execution-owner `run_package` actions.
- Modify `packages/db/src/queries/product-lane-queries.ts`
  - Consume the same readiness helper for Package lane `run_package` actions.
- Modify `packages/db/src/index.ts`
  - Export the new readiness query helper.
- Tests:
  - Create `tests/db/delivery-runtime-readiness.test.ts`.
  - Modify `tests/api/product-lanes.test.ts`.
  - Modify or create `tests/db/work-item-delivery-readiness.test.ts` depending on current coverage.

### API Query Surface

- Modify `apps/control-plane-api/src/modules/query/query.controller.ts`
  - Add `GET /query/execution-packages/:packageId/runtime-readiness`.
- Modify `apps/control-plane-api/src/modules/query/query.service.ts`
  - Fetch the package, call the DB readiness helper, and parse the public contract response.
  - Inject `ControlPlaneRuntimeService` or another deterministic clock already used by the API module; do not use browser-supplied readiness inputs.
- Tests:
  - Modify `tests/api/query-module.test.ts`.

### Web API

- Modify `apps/web/src/shared/api/types.ts`
  - Export the new contract types for `DeliveryRunReadiness`.
- Modify `apps/web/src/shared/api/query.ts`
  - Add `getExecutionPackageRuntimeReadiness(packageId)`.
- Modify `apps/web/src/shared/api/query-keys.ts`
  - Add `packageRuntimeReadiness(packageId)`.
  - Add predicate-friendly invalidation helpers if needed by `hooks.ts`.
- Modify `apps/web/src/shared/api/hooks.ts`
  - Add `usePackageRuntimeReadinessQuery(packageId)`.
  - Invalidate package readiness after package run/rerun/force-rerun, package mark-ready/edit, ProductAction `run_package`, and any command that can alter package/run/review/release delivery state.
  - Replace single-lane Work Item Cockpit invalidation with all cached lane variants for a Work Item.
- Tests:
  - Modify `tests/web/api-hooks.test.tsx` if it already covers product action invalidation; otherwise create a focused test in `tests/web/product-action-invalidation.test.tsx`.

### Web Package UX

- Create `apps/web/src/features/execution-packages/package-action-model.ts`
  - Own Package action enablement/disabled reasons for mark ready, run, rerun, force rerun, and edit.
  - Consume package state, previous run, optional open review state if available, command pending state, force-rerun rationale, and runtime readiness.
- Modify `apps/web/src/features/execution-packages/execution-package-routes.tsx`
  - Use `usePackageRuntimeReadinessQuery`.
  - Render disabled reasons inline under blocked actions.
  - Preserve force-rerun rationale on errors.
  - Do not hide blocked run actions when the reason teaches the user how to proceed.
- Tests:
  - Modify `tests/web/package-run-product-routes.test.tsx`.

### Web Review UX

- Create `apps/web/src/features/review-packets/review-decision-form.tsx`
  - Own approve and request-changes forms.
  - Require approve summary.
  - Require request-changes summary and at least one requested change.
  - Support add/remove/edit requested-change rows with severity.
- Modify `apps/web/src/features/review-packets/review-packet-routes.tsx`
  - Replace hardcoded approve/request-changes button payloads with the form.
  - Disable completed or archived packets, and any packet whose decision is no longer `none`.
  - Keep package/run links and explain evidence availability.
- Tests:
  - Modify `tests/web/review-release-product-routes.test.tsx`.

### Web Release UX

- Create `apps/web/src/features/releases/release-action-model.ts`
  - Own state-aware release action groups and disabled reasons.
  - Rules cover edit planning, submit, approval decision, QA/Test acceptance, observation transition, and close release.
- Create `apps/web/src/features/releases/release-action-rail.tsx`
  - Render only active primary decisions and relevant secondary actions from the action model.
  - Keep danger confirmation for override approve and close release.
- Modify `apps/web/src/features/releases/release-routes.tsx`
  - Use the new release action rail.
  - Keep `TestAcceptanceForm`, but wire disabled reasons from release readiness and upstream blockers.
  - Show inline API errors without clearing entered rationale/evidence.
- Tests:
  - Modify `tests/web/review-release-product-routes.test.tsx`.

### Route-Level Closure

- Modify `tests/e2e/web-product-routes.e2e.test.ts` or create a route-level Vitest smoke if Playwright coverage is not currently reliable.
  - Cover Package -> Run disabled/ready states, Review decision, Release Test Acceptance, and Release decision rail.
- Optional after functional tests pass:
  - Run the local Web app and inspect `/packages/:id`, `/reviews/:id`, `/releases/:id`, and a Work Item Cockpit with the in-app browser.

---

### Task 1: Add Public-Safe Delivery Runtime Readiness

**Files:**
- Create: `packages/contracts/src/delivery-runtime-readiness.ts`
- Modify: `packages/contracts/src/work-item-delivery-readiness.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Create: `packages/db/src/queries/delivery-runtime-readiness.ts`
- Modify: `packages/db/src/queries/work-item-cockpit-queries.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.controller.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.service.ts`
- Test: `tests/contracts/delivery-runtime-readiness.test.ts`
- Test: `tests/contracts/work-item-delivery-readiness.test.ts`
- Test: `tests/db/delivery-runtime-readiness.test.ts`
- Test: `tests/api/query-module.test.ts`
- Test: `tests/web/package-run-product-routes.test.tsx`

- [ ] **Step 1: Write failing contract tests for sanitized readiness**

Create `tests/contracts/delivery-runtime-readiness.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deliveryRunReadinessResponseSchema } from '@forgeloop/contracts';

describe('delivery runtime readiness contract', () => {
  it('parses a public-safe blocked local Codex readiness response', () => {
    const parsed = deliveryRunReadinessResponseSchema.parse({
      executor_type: 'local_codex',
      target_kind: 'run_execution',
      state: 'blocked',
      generated_at: '2026-05-21T00:00:00.000Z',
      blockers: [
        {
          code: 'credential_binding_unconfigured',
          message: 'Local Codex run execution needs a configured credential binding.',
          severity: 'blocking',
          next_step_href: '/packages/pkg-1',
        },
      ],
    });

    expect(parsed.blockers[0]?.code).toBe('credential_binding_unconfigured');
  });

  it('rejects raw runtime ids, digests, lease metadata, local paths, and raw config', () => {
    const unsafe = {
      executor_type: 'local_codex',
      target_kind: 'run_execution',
      state: 'ready',
      blockers: [],
      runtime_profile_id: 'profile-1',
      credential_binding_id: 'binding-1',
      worker_id: 'worker-1',
      runtime_profile_digest: 'sha256:secret',
      lease_expires_at: '2026-05-21T00:00:00.000Z',
      workspace_root: '/Users/viv/projs/forgeloop',
      codex_config_toml: 'approval_policy = "never"',
    };

    expect(deliveryRunReadinessResponseSchema.safeParse(unsafe).success).toBe(false);
  });
});
```

- [ ] **Step 1b: Tighten existing cockpit runtime metadata contract tests**

Modify `tests/contracts/work-item-delivery-readiness.test.ts` so the existing `rejects non-public cockpit run runtime metadata fields` test no longer treats worker and lease metadata as public:

```ts
const safeRunSession = {
  ...runSession,
  runtime_metadata: {
    durability_mode: 'durable',
    driver_kind: 'app_server',
    driver_status: 'active',
    last_event_at: '2026-05-20T00:00:01.000Z',
    recovery_attempt_count: 0,
  },
};

expect(workItemCockpitResponseSchema.parse(cockpitResponse({ run_sessions: [safeRunSession] })).run_sessions[0]).toMatchObject({
  runtime_metadata: {
    durability_mode: 'durable',
    driver_kind: 'app_server',
    driver_status: 'active',
    last_event_at: '2026-05-20T00:00:01.000Z',
    recovery_attempt_count: 0,
  },
});

for (const unsafeRuntimeMetadata of [
  { worker_id: 'worker-1' },
  { worker_lease_status: 'active' },
  { worker_lease_heartbeat_at: '2026-05-20T00:00:00.000Z' },
  { worker_lease_expires_at: '2026-05-20T00:05:00.000Z' },
  { last_event_cursor: 'cursor-1' },
  { runtime_profile_id: 'profile-1' },
  { credential_binding_id: 'binding-1' },
  { launch_lease_id: 'lease-1' },
  { workspace_path: '/tmp/workspace' },
  { codex_config_toml: 'approval_policy = "never"' },
]) {
  expect(
    workItemCockpitResponseSchema.safeParse(
      cockpitResponse({
        run_sessions: [{ ...safeRunSession, runtime_metadata: { ...safeRunSession.runtime_metadata, ...unsafeRuntimeMetadata } }],
      }),
    ).success,
  ).toBe(false);
}
```

- [ ] **Step 2: Run contract test to verify it fails**

Run: `pnpm vitest run tests/contracts/delivery-runtime-readiness.test.ts tests/contracts/work-item-delivery-readiness.test.ts`

Expected: FAIL because `deliveryRunReadinessResponseSchema` does not exist and the existing cockpit metadata schema still accepts raw worker/lease fields.

- [ ] **Step 3: Add the public-safe contract**

Create `packages/contracts/src/delivery-runtime-readiness.ts`:

```ts
import { z } from 'zod';
import { productHrefSchema } from './api.js';

const nonEmpty = z.string().trim().min(1);
const isoDateTimeSchema = z.string().datetime();

export const deliveryRunReadinessBlockerCodeSchema = z.enum([
  'runtime_profile_missing',
  'runtime_profile_invalid',
  'runtime_target_incompatible',
  'credential_binding_unconfigured',
  'credential_binding_ambiguous',
  'worker_unavailable',
  'worker_target_unsupported',
  'worker_docker_capability_mismatch',
  'worker_network_policy_mismatch',
  'package_policy_snapshot_missing',
  'package_runtime_target_incompatible',
  'runtime_status_unknown',
]);

export const deliveryRunReadinessBlockerSchema = z
  .object({
    code: deliveryRunReadinessBlockerCodeSchema,
    message: nonEmpty,
    severity: z.enum(['info', 'warning', 'blocking']).default('blocking'),
    next_step_href: productHrefSchema.optional(),
  })
  .strict();

export const deliveryRunReadinessResponseSchema = z
  .object({
    executor_type: z.literal('local_codex'),
    target_kind: z.literal('run_execution'),
    state: z.enum(['ready', 'blocked', 'unknown']),
    blockers: z.array(deliveryRunReadinessBlockerSchema).default([]),
    generated_at: isoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((readiness, ctx) => {
    if (readiness.state === 'ready' && readiness.blockers.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['blockers'], message: 'ready readiness must not include blockers' });
    }
    if (readiness.state !== 'ready' && readiness.blockers.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['blockers'], message: 'blocked or unknown readiness requires at least one blocker' });
    }
  });

export type DeliveryRunReadinessBlockerCode = z.infer<typeof deliveryRunReadinessBlockerCodeSchema>;
export type DeliveryRunReadinessBlocker = z.infer<typeof deliveryRunReadinessBlockerSchema>;
export type DeliveryRunReadinessResponse = z.infer<typeof deliveryRunReadinessResponseSchema>;
```

Modify `packages/contracts/src/index.ts`:

```ts
export * from './delivery-runtime-readiness.js';
```

Modify `packages/contracts/src/work-item-delivery-readiness.ts` so `publicRuntimeMetadataSchema` keeps only human-safe status fields:

```ts
const publicRuntimeMetadataSchema = z
  .object({
    durability_mode: z.enum(['durable', 'volatile_demo']).optional(),
    driver_kind: z.enum(['app_server', 'exec_fallback', 'fake']).optional(),
    driver_status: z.enum(['not_started', 'starting', 'active', 'waiting_for_input', 'stalled', 'terminal']).optional(),
    last_event_at: isoDateTimeSchema.optional(),
    recovery_attempt_count: z.number().int().nonnegative().optional(),
  })
  .strict();
```

Do not add compatibility aliases for removed raw metadata fields. If Web tests currently seed `worker_id` or lease timing into public cockpit fixtures, remove those properties and assert the UI still renders public driver status instead.

- [ ] **Step 3b: Redact Work Item Cockpit runtime metadata projection**

Modify `packages/db/src/queries/work-item-cockpit-queries.ts`:

- Change `withWorkerLeaseMetadata` so a leased run with missing persisted runtime metadata still receives the safe durability fallback, but does not merge `worker_id`, `worker_lease_status`, lease timestamps, or lease tokens into `runSession.runtime_metadata`.
- Change `projectRuntimeMetadata` to project only the fields allowed by `publicRuntimeMetadataSchema`: `durability_mode`, `driver_kind`, `driver_status`, `last_event_at`, and `recovery_attempt_count`.
- Do not expose `last_event_cursor` from cockpit responses. Cursor-level state belongs to Run Console/runtime event APIs, not public Work Item Cockpit readiness.

Update `tests/api/query-module.test.ts`:

```ts
expect(response.body.run_sessions[0].runtime_metadata).toMatchObject({
  durability_mode: 'durable',
});
expect(response.body.run_sessions[0].runtime_metadata).not.toHaveProperty('worker_id');
expect(response.body.run_sessions[0].runtime_metadata).not.toHaveProperty('worker_lease_status');
expect(response.body.run_sessions[0].runtime_metadata).not.toHaveProperty('worker_lease_heartbeat_at');
expect(response.body.run_sessions[0].runtime_metadata).not.toHaveProperty('worker_lease_expires_at');
expect(response.body.run_sessions[0].runtime_metadata).not.toHaveProperty('last_event_cursor');
```

Keep `/run-sessions/:id/events` or Run Console specific tests separate; this stream removes raw runtime identifiers from browser delivery cockpit DTOs, not necessarily from internal runtime control-plane tests.

- [ ] **Step 4: Write failing DB readiness tests**

Create `tests/db/delivery-runtime-readiness.test.ts` with fixtures that use `InMemoryDeliveryRepository`:

```ts
import { describe, expect, it } from 'vitest';
import { InMemoryDeliveryRepository, deriveDeliveryRunReadiness } from '@forgeloop/db';
import {
  seedActiveGenerationProfile,
  seedActiveRunExecutionProfile,
  seedOnlineCodexWorkerWithDockerMismatch,
  seedOnlineCodexWorkerWithNetworkMismatch,
  seedOnlineCompatibleCodexWorker,
  seedReadyExecutionPackage,
  seedReadyLocalCodexExecutionPackage,
  seedSingleCredentialBinding,
} from '../helpers/delivery-runtime-fixtures';

const now = '2026-05-21T00:00:00.000Z';

describe('deriveDeliveryRunReadiness', () => {
  it('blocks local Codex run when no run_execution runtime profile exists', async () => {
    const repository = new InMemoryDeliveryRepository();
    const executionPackage = await seedReadyLocalCodexExecutionPackage(repository);

    const readiness = await deriveDeliveryRunReadiness(repository, { executionPackage, now });

    expect(readiness).toMatchObject({
      state: 'blocked',
      blockers: [expect.objectContaining({ code: 'runtime_profile_missing' })],
    });
    expect(JSON.stringify(readiness)).not.toMatch(/runtime_profile_id|credential_binding_id|worker_id|digest|lease|workspace/);
  });

  it('blocks local Codex run when credential binding cannot be selected safely', async () => {
    const repository = new InMemoryDeliveryRepository();
    const executionPackage = await seedReadyLocalCodexExecutionPackage(repository);
    await seedActiveRunExecutionProfile(repository, executionPackage);
    await seedOnlineCompatibleCodexWorker(repository, executionPackage);

    const readiness = await deriveDeliveryRunReadiness(repository, { executionPackage, now });

    expect(readiness.blockers.map((blocker) => blocker.code)).toContain('credential_binding_unconfigured');
  });

  it('returns ready only when profile, credential, worker, Docker capability, and target match', async () => {
    const repository = new InMemoryDeliveryRepository();
    const executionPackage = await seedReadyLocalCodexExecutionPackage(repository);
    await seedActiveRunExecutionProfile(repository, executionPackage);
    await seedSingleCredentialBinding(repository, executionPackage);
    await seedOnlineCompatibleCodexWorker(repository, executionPackage);

    await expect(deriveDeliveryRunReadiness(repository, { executionPackage, now })).resolves.toMatchObject({
      state: 'ready',
      blockers: [],
    });
  });

  it('distinguishes an incompatible active runtime target from a missing runtime profile', async () => {
    const repository = new InMemoryDeliveryRepository();
    const executionPackage = await seedReadyLocalCodexExecutionPackage(repository);
    await seedActiveGenerationProfile(repository, executionPackage);

    const readiness = await deriveDeliveryRunReadiness(repository, { executionPackage, now });

    expect(readiness.blockers.map((blocker) => blocker.code)).toContain('runtime_target_incompatible');
    expect(readiness.blockers.map((blocker) => blocker.code)).not.toContain('runtime_profile_missing');
  });

  it('blocks packages whose captured runtime policy cannot use local Codex run execution', async () => {
    const repository = new InMemoryDeliveryRepository();
    const executionPackage = await seedReadyExecutionPackage(repository);
    await seedActiveRunExecutionProfile(repository, executionPackage);
    await seedSingleCredentialBinding(repository, executionPackage);
    await seedOnlineCompatibleCodexWorker(repository, executionPackage);

    const readiness = await deriveDeliveryRunReadiness(repository, { executionPackage, now });

    expect(readiness.blockers.map((blocker) => blocker.code)).toContain('package_runtime_target_incompatible');
  });

  it('distinguishes Docker image capability mismatch from generic worker unavailability', async () => {
    const repository = new InMemoryDeliveryRepository();
    const executionPackage = await seedReadyLocalCodexExecutionPackage(repository);
    await seedActiveRunExecutionProfile(repository, executionPackage);
    await seedSingleCredentialBinding(repository, executionPackage);
    await seedOnlineCodexWorkerWithDockerMismatch(repository, executionPackage);

    const readiness = await deriveDeliveryRunReadiness(repository, { executionPackage, now });

    expect(readiness.blockers.map((blocker) => blocker.code)).toContain('worker_docker_capability_mismatch');
    expect(readiness.blockers.map((blocker) => blocker.code)).not.toContain('worker_unavailable');
  });

  it('distinguishes network policy mismatch from generic worker unavailability', async () => {
    const repository = new InMemoryDeliveryRepository();
    const executionPackage = await seedReadyLocalCodexExecutionPackage(repository);
    await seedActiveRunExecutionProfile(repository, executionPackage);
    await seedSingleCredentialBinding(repository, executionPackage);
    await seedOnlineCodexWorkerWithNetworkMismatch(repository, executionPackage);

    const readiness = await deriveDeliveryRunReadiness(repository, { executionPackage, now });

    expect(readiness.blockers.map((blocker) => blocker.code)).toContain('worker_network_policy_mismatch');
    expect(readiness.blockers.map((blocker) => blocker.code)).not.toContain('worker_unavailable');
  });
});
```

Use existing runtime fixture helpers where available. If `tests/helpers/delivery-runtime-fixtures.ts` does not expose these focused seed helpers, create and export them there in this task: `seedActiveRunExecutionProfile`, `seedActiveGenerationProfile`, `seedSingleCredentialBinding`, `seedOnlineCompatibleCodexWorker`, `seedOnlineCodexWorkerWithDockerMismatch`, and `seedOnlineCodexWorkerWithNetworkMismatch`. Do not create duplicate fixture factories in the test file. `seedReadyLocalCodexExecutionPackage` must differ from the existing mock package fixture by producing a captured policy snapshot compatible with local Codex run execution; keep the existing `seedReadyExecutionPackage` mock fixture for the explicit `package_runtime_target_incompatible` test.

- [ ] **Step 5: Run DB readiness tests to verify they fail**

Run: `pnpm vitest run tests/db/delivery-runtime-readiness.test.ts`

Expected: FAIL because the DB helper and possibly seed helper exports do not exist.

- [ ] **Step 6: Add repository read-only runtime diagnostics if needed**

Modify `packages/db/src/repositories/delivery-repository.ts`:

```ts
export interface ListActiveCodexRuntimeProfileRevisionsForScopeInput {
  project_id: string;
  repo_id?: string;
  now: string;
}

export interface ListCodexCredentialBindingsForScopeInput {
  project_id: string;
  repo_id?: string;
  runtime_profile_id: string;
  target_kind: CodexRuntimeTargetKind;
  now: string;
}

export interface CodexWorkerReadinessDiagnosticsInput {
  project_id: string;
  repo_id?: string;
  target_kind: CodexRuntimeTargetKind;
  docker_image_digest: string;
  network_policy_digest: string;
  network_provider_config_digest?: string;
  now: string;
}

export interface CodexWorkerReadinessDiagnostics {
  state:
    | 'ready'
    | 'worker_unavailable'
    | 'worker_target_unsupported'
    | 'worker_docker_capability_mismatch'
    | 'worker_network_policy_mismatch';
}

export interface DeliveryRepository {
  // existing methods...
  listActiveCodexRuntimeProfileRevisionsForScope(
    input: ListActiveCodexRuntimeProfileRevisionsForScopeInput,
  ): Promise<CodexRuntimeProfileRevision[]>;
  listCodexCredentialBindingsForScope(
    input: ListCodexCredentialBindingsForScopeInput,
  ): Promise<CodexCredentialBindingPublic[]>;
  getCodexWorkerReadinessDiagnostics(
    input: CodexWorkerReadinessDiagnosticsInput,
  ): Promise<CodexWorkerReadinessDiagnostics>;
}
```

Implement in both repositories as read-only queries:

- Runtime profile diagnostics list active profile revisions in scope without filtering by target so the helper can return `runtime_target_incompatible` when only non-`run_execution` targets exist.
- Credential lookup reads active credential bindings for the profile, project, optional repo, and active version. Return `CodexCredentialBindingPublic` only. Do not return secret payloads.
- Worker diagnostics evaluate online, connected, fresh workers in scope by target capability, Docker image digest, network policy digest, and optional network provider config digest. Return only the public-safe state enum above. Do not return worker ids, session tokens, lease state, capability arrays, digests, labels, or raw registration rows.

If the current implementation can safely derive any of these answers through existing repository methods without adding the method, skip that method and document the reason in the commit message. Do not degrade blocker specificity to a generic `worker_unavailable` when the diagnostic can distinguish target, Docker, or network mismatch.

- [ ] **Step 7: Implement shared readiness derivation**

Create `packages/db/src/queries/delivery-runtime-readiness.ts`:

```ts
import {
  deliveryRunReadinessResponseSchema,
  type DeliveryRunReadinessBlocker,
  type DeliveryRunReadinessResponse,
} from '@forgeloop/contracts';
import { codexCanonicalDigest, type ExecutionPackage } from '@forgeloop/domain';

import type { DeliveryRepository } from '../repositories/delivery-repository';

export interface DeriveDeliveryRunReadinessInput {
  executionPackage: ExecutionPackage;
  now: string;
}

const blocker = (
  code: DeliveryRunReadinessBlocker['code'],
  message: string,
  executionPackageId: string,
): DeliveryRunReadinessBlocker => ({
  code,
  message,
  severity: 'blocking',
  next_step_href: `/packages/${executionPackageId}`,
});

export const deriveDeliveryRunReadiness = async (
  repository: DeliveryRepository,
  input: DeriveDeliveryRunReadinessInput,
): Promise<DeliveryRunReadinessResponse> => {
  const blockers: DeliveryRunReadinessBlocker[] = [];
  const { executionPackage } = input;

  const activeProfileRevisions = await repository.listActiveCodexRuntimeProfileRevisionsForScope({
    project_id: executionPackage.project_id,
    repo_id: executionPackage.repo_id,
    now: input.now,
  });
  const profileRevision = activeProfileRevisions.find((revision) => revision.target_kind === 'run_execution');

  if (profileRevision === undefined) {
    const hasOtherTargetProfile = activeProfileRevisions.length > 0;
    blockers.push(
      blocker(
        hasOtherTargetProfile ? 'runtime_target_incompatible' : 'runtime_profile_missing',
        hasOtherTargetProfile
          ? 'The active Codex runtime profile is not for run execution.'
          : 'Local Codex run execution has no active runtime profile.',
        executionPackage.id,
      ),
    );
  }

  if (executionPackage.package_policy_snapshot === undefined) {
    blockers.push(blocker('package_policy_snapshot_missing', 'This package is missing a captured runtime policy snapshot.', executionPackage.id));
  } else if (!packagePolicySnapshotSupportsLocalCodexRunExecution(executionPackage.package_policy_snapshot)) {
    blockers.push(blocker('package_runtime_target_incompatible', 'This package was not captured for Local Codex run execution.', executionPackage.id));
  }

  if (profileRevision !== undefined) {
    const credentialBindings = await repository.listCodexCredentialBindingsForScope({
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      runtime_profile_id: profileRevision.profile_id,
      target_kind: 'run_execution',
      now: input.now,
    });

    if (credentialBindings.length === 0) {
      blockers.push(blocker('credential_binding_unconfigured', 'Local Codex run execution needs one configured credential binding.', executionPackage.id));
    } else if (credentialBindings.length > 1) {
      blockers.push(blocker('credential_binding_ambiguous', 'Multiple credential bindings match this package; product-safe selection is ambiguous.', executionPackage.id));
    }

    const status = await repository.getCodexRuntimeStatus({
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      target_kind: 'run_execution',
      runtime_profile_id: profileRevision.profile_id,
      ...(credentialBindings.length === 1 && credentialBindings[0] !== undefined
        ? { credential_binding_id: credentialBindings[0].id }
        : {}),
      now: input.now,
    });

    for (const code of status.blocker_codes ?? []) {
      if (code === 'codex_runtime_profile_invalid') {
        blockers.push(blocker('runtime_profile_invalid', 'The active Codex runtime profile is invalid.', executionPackage.id));
      }
    }

    if (status.worker_status !== 'online') {
      const workerDiagnostics = await repository.getCodexWorkerReadinessDiagnostics({
        project_id: executionPackage.project_id,
        repo_id: executionPackage.repo_id,
        target_kind: 'run_execution',
        docker_image_digest: profileRevision.docker_image_digest,
        network_policy_digest: codexCanonicalDigest(profileRevision.network_policy),
        ...(profileRevision.network_policy.mode === 'docker_network_proxy'
          ? { network_provider_config_digest: profileRevision.network_policy.provider_config.provider_config_digest }
          : {}),
        now: input.now,
      });
      if (workerDiagnostics.state !== 'ready') {
        blockers.push(blocker(workerDiagnostics.state, workerDiagnosticMessage(workerDiagnostics.state), executionPackage.id));
      }
    }
  }

  return deliveryRunReadinessResponseSchema.parse({
    executor_type: 'local_codex',
    target_kind: 'run_execution',
    state: blockers.length === 0 ? 'ready' : 'blocked',
    blockers,
    generated_at: input.now,
  });
};
```

Add small local helpers `packagePolicySnapshotSupportsLocalCodexRunExecution` and `workerDiagnosticMessage` in this file. Adjust the exact Docker/network digest extraction to the current domain helpers, but keep the public output sanitized even if internal status contains ids or digests.

- [ ] **Step 8: Add the public query endpoint**

Modify `apps/control-plane-api/src/modules/query/query.controller.ts`:

```ts
@Get('execution-packages/:packageId/runtime-readiness')
getExecutionPackageRuntimeReadiness(@Param('packageId') packageId: string) {
  return this.service.getExecutionPackageRuntimeReadiness(packageId);
}
```

Modify `apps/control-plane-api/src/modules/query/query.service.ts`:

```ts
async getExecutionPackageRuntimeReadiness(packageId: string) {
  const executionPackage = await this.repository.getExecutionPackage(packageId);
  if (executionPackage === undefined) {
    throw new NotFoundException(`ExecutionPackage ${packageId} not found`);
  }

  return deriveDeliveryRunReadiness(this.repository, {
    executionPackage,
    now: this.controlPlaneRuntime.now(),
  });
}
```

Inject `ControlPlaneRuntimeService` in the service constructor. Do not accept credential ids, worker ids, or runtime profile ids as query parameters.

- [ ] **Step 9: Write failing API endpoint redaction test**

Add to `tests/api/query-module.test.ts`:

```ts
it('serves public-safe execution package runtime readiness without raw runtime identifiers', async () => {
  const { app } = await track(createTestApp());
  const executionPackage = await seedReadyPackage(app);

  const response = await request(app.getHttpServer())
    .get(`/query/execution-packages/${executionPackage.id}/runtime-readiness`)
    .expect(200);

  expect(response.body.executor_type).toBe('local_codex');
  expect(response.body).not.toHaveProperty('execution_package_id');
  expect(JSON.stringify(response.body)).not.toMatch(/runtime_profile_id|credential_binding_id|worker_id|lease|digest|workspace|codex_config/i);
});
```

- [ ] **Step 10: Run focused verification**

Run:

```bash
pnpm vitest run tests/contracts/delivery-runtime-readiness.test.ts tests/contracts/work-item-delivery-readiness.test.ts tests/db/delivery-runtime-readiness.test.ts tests/api/query-module.test.ts tests/web/package-run-product-routes.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 11: Commit Task 1**

```bash
git add packages/contracts/src/delivery-runtime-readiness.ts packages/contracts/src/work-item-delivery-readiness.ts packages/contracts/src/index.ts packages/db/src/repositories/delivery-repository.ts packages/db/src/repositories/in-memory-delivery-repository.ts packages/db/src/repositories/drizzle-delivery-repository.ts packages/db/src/queries/delivery-runtime-readiness.ts packages/db/src/queries/work-item-cockpit-queries.ts packages/db/src/index.ts apps/control-plane-api/src/modules/query/query.controller.ts apps/control-plane-api/src/modules/query/query.service.ts tests/contracts/delivery-runtime-readiness.test.ts tests/contracts/work-item-delivery-readiness.test.ts tests/db/delivery-runtime-readiness.test.ts tests/api/query-module.test.ts tests/helpers/delivery-runtime-fixtures.ts tests/web/package-run-product-routes.test.tsx
git commit -m "feat: add public delivery runtime readiness"
```

---

### Task 2: Gate Package Page Run Actions With The Shared Readiness Model

**Files:**
- Modify: `packages/contracts/src/work-item-delivery-readiness.ts`
- Modify: `packages/db/src/queries/work-item-cockpit-queries.ts`
- Modify: `apps/web/src/shared/api/types.ts`
- Modify: `apps/web/src/shared/api/query.ts`
- Modify: `apps/web/src/shared/api/query-keys.ts`
- Modify: `apps/web/src/shared/api/hooks.ts`
- Create: `apps/web/src/features/execution-packages/package-action-model.ts`
- Modify: `apps/web/src/features/execution-packages/execution-package-routes.tsx`
- Modify: `tests/web/fixtures/product-api-mock.ts`
- Test: `tests/web/package-run-product-routes.test.tsx`

- [ ] **Step 1: Write failing Web tests for Package action gating**

Add tests to `tests/web/package-run-product-routes.test.tsx`:

```ts
it('disables package run actions with public-safe runtime readiness blockers', async () => {
  const screen = await renderRoute(`/packages/${executionPackage.id}`, {
    apiOverrides: {
      [`GET /execution-packages/${executionPackage.id}`]: { ...executionPackage, phase: 'ready', gate_state: 'not_submitted' },
      [`GET /query/replay/execution_package/${executionPackage.id}`]: timeline,
      [`GET /query/execution-packages/${executionPackage.id}/runtime-readiness`]: {
        executor_type: 'local_codex',
        target_kind: 'run_execution',
        state: 'blocked',
        blockers: [
          {
            code: 'worker_unavailable',
            message: 'No compatible online Codex worker is available for this package.',
            severity: 'blocking',
          },
        ],
      },
    },
  });

  expect(await screen.findByRole('button', { name: 'Run' })).toHaveProperty('disabled', true);
  expect(screen.getByText(/No compatible online Codex worker/i)).toBeTruthy();
  expect(screen.queryByText(/runtime_profile_id|credential_binding_id|worker_id|digest|lease/i)).toBeNull();
});

it('enables package run only when package state and runtime readiness are both ready', async () => {
  const screen = await renderRoute(`/packages/${executionPackage.id}`, {
    apiOverrides: {
      [`GET /execution-packages/${executionPackage.id}`]: { ...executionPackageWithoutRun, phase: 'ready', gate_state: 'not_submitted' },
      [`GET /query/replay/execution_package/${executionPackage.id}`]: timeline,
      [`GET /query/execution-packages/${executionPackage.id}/runtime-readiness`]: {
        executor_type: 'local_codex',
        target_kind: 'run_execution',
        state: 'ready',
        blockers: [],
      },
    },
  });

  expect(await screen.findByRole('button', { name: 'Run' })).toHaveProperty('disabled', false);
});

it('blocks package run replacement while the current run pointer is unresolved', async () => {
  const screen = await renderRoute(`/packages/${executionPackage.id}`, {
    apiOverrides: {
      [`GET /execution-packages/${executionPackage.id}`]: {
        ...executionPackage,
        phase: 'ready',
        gate_state: 'not_submitted',
        current_run_session_id: runSession.id,
        last_run_session_id: runSession.id,
      },
      [`GET /query/replay/execution_package/${executionPackage.id}`]: timeline,
      [`GET /query/execution-packages/${executionPackage.id}/runtime-readiness`]: {
        executor_type: 'local_codex',
        target_kind: 'run_execution',
        state: 'ready',
        blockers: [],
      },
    },
  });

  expect(await screen.findByRole('button', { name: 'Run' })).toHaveProperty('disabled', true);
  expect(screen.getByText(/run is already active/i)).toBeTruthy();
});

it('blocks rerun replacement while a current review packet is open', async () => {
  const screen = await renderRoute(`/packages/${executionPackage.id}`, {
    apiOverrides: {
      [`GET /execution-packages/${executionPackage.id}`]: {
        ...executionPackage,
        phase: 'ready',
        gate_state: 'not_submitted',
        last_run_session_id: runSession.id,
        current_review_packet_id: reviewPacket.id,
      },
      [`GET /query/replay/execution_package/${executionPackage.id}`]: timeline,
      [`GET /query/execution-packages/${executionPackage.id}/runtime-readiness`]: {
        executor_type: 'local_codex',
        target_kind: 'run_execution',
        state: 'ready',
        blockers: [],
      },
    },
  });

  expect(await screen.findByRole('button', { name: 'Rerun' })).toHaveProperty('disabled', true);
  expect(screen.getByText(/Review Packet must be decided/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Force rerun' })).toHaveProperty('disabled', true);
});

it('enables force rerun only with a current open review and a governance rationale', async () => {
  const user = userEvent.setup();
  const screen = await renderRoute(`/packages/${executionPackage.id}`, {
    apiOverrides: {
      [`GET /execution-packages/${executionPackage.id}`]: {
        ...executionPackage,
        phase: 'review',
        gate_state: 'awaiting_human_review',
        last_run_session_id: runSession.id,
        current_review_packet_id: reviewPacket.id,
      },
      [`GET /query/reviews/${reviewPacket.id}`]: { ...reviewPacket, status: 'ready', decision: 'none', run_session_id: runSession.id },
      [`GET /query/replay/execution_package/${executionPackage.id}`]: timeline,
      [`GET /query/execution-packages/${executionPackage.id}/runtime-readiness`]: {
        executor_type: 'local_codex',
        target_kind: 'run_execution',
        state: 'ready',
        blockers: [],
      },
    },
  });

  expect(await screen.findByRole('button', { name: 'Force rerun' })).toHaveProperty('disabled', true);
  await user.type(screen.getByLabelText('Force rerun reason'), 'Replace stale evidence after requested changes.');
  expect(screen.getByRole('button', { name: 'Force rerun' })).toHaveProperty('disabled', false);
});

it('blocks force rerun without the backend-required current open review context', async () => {
  const user = userEvent.setup();
  const screen = await renderRoute(`/packages/${executionPackage.id}`, {
    apiOverrides: {
      [`GET /execution-packages/${executionPackage.id}`]: {
        ...executionPackage,
        phase: 'review',
        gate_state: 'awaiting_human_review',
        last_run_session_id: runSession.id,
      },
      [`GET /query/replay/execution_package/${executionPackage.id}`]: timeline,
      [`GET /query/execution-packages/${executionPackage.id}/runtime-readiness`]: {
        executor_type: 'local_codex',
        target_kind: 'run_execution',
        state: 'ready',
        blockers: [],
      },
    },
  });

  await user.type(await screen.findByLabelText('Force rerun reason'), 'Try force rerun without review.');
  expect(screen.getByRole('button', { name: 'Force rerun' })).toHaveProperty('disabled', true);
  expect(screen.getByText(/current open ready or in-review Review Packet/i)).toBeTruthy();
});

it('blocks force rerun for non-owner actors even with an eligible open review', async () => {
  const user = userEvent.setup();
  const screen = await renderRoute(`/packages/${executionPackage.id}`, {
    actorId: 'actor-not-owner',
    apiOverrides: {
      [`GET /execution-packages/${executionPackage.id}`]: {
        ...executionPackage,
        phase: 'review',
        resolution: 'none',
        gate_state: 'awaiting_human_review',
        last_run_session_id: runSession.id,
        current_review_packet_id: reviewPacket.id,
      },
      [`GET /query/reviews/${reviewPacket.id}`]: {
        ...reviewPacket,
        status: 'ready',
        decision: 'none',
        execution_package_id: executionPackage.id,
        run_session_id: runSession.id,
      },
      [`GET /query/replay/execution_package/${executionPackage.id}`]: timeline,
      [`GET /query/execution-packages/${executionPackage.id}/runtime-readiness`]: {
        executor_type: 'local_codex',
        target_kind: 'run_execution',
        state: 'ready',
        blockers: [],
      },
    },
  });

  await user.type(await screen.findByLabelText('Force rerun reason'), 'Replace stale evidence after requested changes.');
  expect(screen.getByRole('button', { name: 'Force rerun' })).toHaveProperty('disabled', true);
  expect(screen.getByText(/only the package owner/i)).toBeTruthy();
});

it('blocks force rerun when the loaded Review Packet is not for the latest package run', async () => {
  const user = userEvent.setup();
  const screen = await renderRoute(`/packages/${executionPackage.id}`, {
    apiOverrides: {
      [`GET /execution-packages/${executionPackage.id}`]: {
        ...executionPackage,
        phase: 'review',
        resolution: 'none',
        gate_state: 'awaiting_human_review',
        last_run_session_id: runSession.id,
        current_review_packet_id: reviewPacket.id,
      },
      [`GET /query/reviews/${reviewPacket.id}`]: {
        ...reviewPacket,
        status: 'ready',
        decision: 'none',
        execution_package_id: executionPackage.id,
        run_session_id: 'stale-run-session',
      },
      [`GET /query/replay/execution_package/${executionPackage.id}`]: timeline,
      [`GET /query/execution-packages/${executionPackage.id}/runtime-readiness`]: {
        executor_type: 'local_codex',
        target_kind: 'run_execution',
        state: 'ready',
        blockers: [],
      },
    },
  });

  await user.type(await screen.findByLabelText('Force rerun reason'), 'Replace stale evidence after requested changes.');
  expect(screen.getByRole('button', { name: 'Force rerun' })).toHaveProperty('disabled', true);
  expect(screen.getByText(/latest package run/i)).toBeTruthy();
});

it('blocks force rerun for draft or escalated review statuses rejected by the command endpoint', async () => {
  const user = userEvent.setup();
  const screen = await renderRoute(`/packages/${executionPackage.id}`, {
    apiOverrides: {
      [`GET /execution-packages/${executionPackage.id}`]: {
        ...executionPackage,
        phase: 'review',
        resolution: 'none',
        gate_state: 'awaiting_human_review',
        last_run_session_id: runSession.id,
        current_review_packet_id: reviewPacket.id,
      },
      [`GET /query/reviews/${reviewPacket.id}`]: {
        ...reviewPacket,
        status: 'draft',
        decision: 'none',
        execution_package_id: executionPackage.id,
        run_session_id: runSession.id,
      },
      [`GET /query/replay/execution_package/${executionPackage.id}`]: timeline,
      [`GET /query/execution-packages/${executionPackage.id}/runtime-readiness`]: {
        executor_type: 'local_codex',
        target_kind: 'run_execution',
        state: 'ready',
        blockers: [],
      },
    },
  });

  await user.type(await screen.findByLabelText('Force rerun reason'), 'Replace stale evidence after requested changes.');
  expect(screen.getByRole('button', { name: 'Force rerun' })).toHaveProperty('disabled', true);
  expect(screen.getByText(/ready or in-review Review Packet/i)).toBeTruthy();
});
```

Import `reviewPacket` from `tests/web/fixtures/product-data` if the file does not already import it.

- [ ] **Step 2: Run Web test to verify it fails**

Run: `pnpm vitest run tests/web/package-run-product-routes.test.tsx`

Expected: FAIL because the runtime readiness query is not called and disabled reasons are not rendered.

- [ ] **Step 3: Add Web query API and key**

Modify `apps/web/src/shared/api/types.ts`:

```ts
export type { DeliveryRunReadinessResponse as DeliveryRunReadiness } from '@forgeloop/contracts';
```

Modify `apps/web/src/shared/api/query.ts`:

```ts
import { deliveryRunReadinessResponseSchema } from '@forgeloop/contracts';
import type { DeliveryRunReadiness } from './types';

getExecutionPackageRuntimeReadiness: async (packageId: string) =>
  deliveryRunReadinessResponseSchema.parse(
    await request<unknown>(`/query/execution-packages/${encodeURIComponent(packageId)}/runtime-readiness`),
  ) as DeliveryRunReadiness,
```

Modify `apps/web/src/shared/api/query-keys.ts`:

```ts
packageRuntimeReadiness: (packageId: string | undefined) => ['package-runtime-readiness', packageId],
```

Modify `apps/web/src/shared/api/hooks.ts`:

```ts
export function usePackageRuntimeReadinessQuery(packageId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.packageRuntimeReadiness(packageId),
    queryFn: () => createQueryApi().getExecutionPackageRuntimeReadiness(requiredId(packageId, 'packageId')),
    enabled: packageId !== undefined,
  });
}
```

- [ ] **Step 4: Add default Web API mock readiness response**

Modify `tests/web/fixtures/product-api-mock.ts` so existing Package route tests that do not override the new endpoint keep rendering with deterministic data:

```ts
[`GET /query/execution-packages/${executionPackage.id}/runtime-readiness`]: {
  executor_type: 'local_codex',
  target_kind: 'run_execution',
  state: 'ready',
  blockers: [],
  generated_at: executionPackage.updated_at,
},
```

Do not make the Package action model treat `readiness === undefined` as ready. Missing readiness data must keep run actions disabled while the query is loading or failed.

- [ ] **Step 5: Expose current run/review pointers on the Web package type**

Modify `packages/contracts/src/work-item-delivery-readiness.ts` package projection schema to include the current package pointers that are already present on the domain object:

```ts
current_run_session_id: nonEmpty.optional(),
current_review_packet_id: nonEmpty.optional(),
current_release_id: nonEmpty.optional(),
```

Modify `packages/db/src/queries/work-item-cockpit-queries.ts` `projectExecutionPackage` to project those fields with conditional spreads:

```ts
...(executionPackage.current_run_session_id === undefined ? {} : { current_run_session_id: executionPackage.current_run_session_id }),
...(executionPackage.current_review_packet_id === undefined ? {} : { current_review_packet_id: executionPackage.current_review_packet_id }),
...(executionPackage.current_release_id === undefined ? {} : { current_release_id: executionPackage.current_release_id }),
```

This keeps `apps/web/src/shared/api/types.ts` `ExecutionPackage = WorkItemCockpitResponse['packages'][number]` usable for `GET /execution-packages/:id` without adding a separate unchecked Web package shape. These product object ids are safe; do not add raw runtime profile, credential, worker, lease, digest, local path, or config fields.

- [ ] **Step 6: Add pure Package action model**

Create `apps/web/src/features/execution-packages/package-action-model.ts`:

```ts
import type { DeliveryRunReadiness, ExecutionPackage, ReviewPacket, RunSession } from '../../shared/api/types';

export interface PackageActionState {
  enabled: boolean;
  reason?: string;
}

export interface PackageActionModel {
  markReady: PackageActionState;
  run: PackageActionState;
  rerun: PackageActionState;
  forceRerun: PackageActionState;
  edit: PackageActionState;
}

const firstRuntimeBlocker = (readiness: DeliveryRunReadiness | undefined): string | undefined => {
  if (readiness === undefined) return 'Checking Local Codex runtime readiness.';
  if (readiness.state === 'ready') return undefined;
  return readiness.blockers[0]?.message ?? 'Local Codex runtime readiness is blocked.';
};

const activeRunStatuses = new Set(['queued', 'running', 'waiting_for_input', 'stalled', 'resuming', 'cancel_requested']);
const openReviewStatuses = new Set(['draft', 'ready', 'in_review', 'escalated']);
const forceRerunReviewStatuses = new Set(['ready', 'in_review']);
const actionState = (enabled: boolean, reason?: string): PackageActionState =>
  reason === undefined ? { enabled } : { enabled, reason };

export function packageActionModel(input: {
  executionPackage: ExecutionPackage;
  actorId: string;
  readiness: DeliveryRunReadiness | undefined;
  currentRun?: Pick<RunSession, 'id' | 'status'>;
  hasActiveRun?: boolean;
  openReview?: Pick<ReviewPacket, 'id' | 'status' | 'decision' | 'execution_package_id' | 'run_session_id'>;
  hasOpenReview?: boolean;
  forceRerunReview?: Pick<ReviewPacket, 'id' | 'status' | 'decision' | 'execution_package_id' | 'run_session_id'>;
  hasForceRerunReview?: boolean;
  actionPending: boolean;
  forceRerunReason: string;
}): PackageActionModel {
  const { executionPackage, actionPending } = input;
  const runtimeReason = firstRuntimeBlocker(input.readiness);
  const hasPreviousRun = executionPackage.last_run_session_id !== undefined;
  const hasCurrentRunPointer = executionPackage.current_run_session_id !== undefined;
  const hasActiveRun =
    input.hasActiveRun ??
    (input.currentRun !== undefined ? activeRunStatuses.has(input.currentRun.status) : hasCurrentRunPointer);
  const hasOpenReview =
    input.hasOpenReview === true ||
    (input.openReview !== undefined &&
      openReviewStatuses.has(input.openReview.status) &&
      input.openReview.decision === 'none');
  const forceRerunReview = input.forceRerunReview ?? input.openReview;
  const hasForceRerunReview =
    input.hasForceRerunReview === true ||
    (forceRerunReview !== undefined &&
      forceRerunReviewStatuses.has(forceRerunReview.status) &&
      forceRerunReview.decision === 'none');
  const forceRerunReviewMatchesCurrentRun =
    forceRerunReview !== undefined &&
    forceRerunReview.execution_package_id === executionPackage.id &&
    forceRerunReview.run_session_id === executionPackage.last_run_session_id;
  const forceRerunOwnerAllowed = executionPackage.owner_actor_id === input.actorId;
  const forceRerunResolutionAllowed = executionPackage.resolution === 'none';
  const markReadyAllowed = executionPackage.phase === 'draft' || executionPackage.gate_state === 'changes_requested';
  const runStateAllowed = executionPackage.phase === 'ready' && executionPackage.gate_state === 'not_submitted';
  const normalReplacementAllowed = !hasActiveRun && !hasOpenReview;
  const normalReplacementReason = hasActiveRun
    ? 'A run is already active for this package. Open the Run Console before starting another run.'
    : hasOpenReview
      ? 'The current Review Packet must be decided before replacing package evidence.'
      : undefined;
  const forceRerunAllowed =
    hasPreviousRun &&
    !hasActiveRun &&
    hasForceRerunReview &&
    forceRerunReviewMatchesCurrentRun &&
    executionPackage.phase === 'review' &&
    forceRerunResolutionAllowed &&
    forceRerunOwnerAllowed &&
    input.forceRerunReason.trim().length > 0;
  const forceRerunReason =
    !hasPreviousRun
      ? 'Force rerun is available after this package has a previous run.'
      : hasActiveRun
        ? 'A run is already active for this package. Open the Run Console before forcing a rerun.'
      : !hasForceRerunReview
        ? hasOpenReview
          ? 'Checking current Review Packet eligibility for force rerun.'
          : 'Force rerun requires a current open ready or in-review Review Packet.'
      : !forceRerunReviewMatchesCurrentRun
        ? 'Force rerun requires a current open Review Packet for the latest package run.'
      : executionPackage.phase !== 'review'
        ? 'Force rerun is available only while the package is in review.'
      : !forceRerunResolutionAllowed
        ? 'Force rerun is unavailable after the package is resolved.'
      : !forceRerunOwnerAllowed
        ? 'Force rerun is available only to the package owner.'
      : input.forceRerunReason.trim().length === 0
        ? 'Force rerun requires a governance rationale.'
      : runtimeReason;
  const editAllowed = !hasActiveRun && (executionPackage.last_run_session_id === undefined || executionPackage.gate_state === 'changes_requested');

  return {
    markReady: actionState(
      markReadyAllowed && !actionPending,
      markReadyAllowed ? undefined : 'Mark ready is available only for draft packages or packages with requested changes.',
    ),
    run: actionState(
      runStateAllowed && normalReplacementAllowed && runtimeReason === undefined && !actionPending,
      !runStateAllowed
        ? 'Run is available only for ready packages that have not been submitted.'
        : normalReplacementReason ?? runtimeReason,
    ),
    rerun: actionState(
      hasPreviousRun && normalReplacementAllowed && runtimeReason === undefined && !actionPending,
      hasPreviousRun ? normalReplacementReason ?? runtimeReason : 'Rerun is available after this package has a previous run.',
    ),
    forceRerun: actionState(
      forceRerunAllowed && runtimeReason === undefined && !actionPending,
      forceRerunReason,
    ),
    edit: actionState(
      editAllowed && !actionPending,
      editAllowed ? undefined : 'Package details can be edited only before execution starts or after changes are requested.',
    ),
  };
}
```

Adjust field names if Stream B or later contracts add a better open-review indicator. Keep this helper pure.
If the Package detail API does not expose `current_run_session_id` or `current_review_packet_id`, extend the Web package type/projection in this task. Do not treat missing active-run/open-review data as false when the backend has that state.
The separate `forceRerunReviewStatuses` set intentionally follows the command endpoint's stricter validation (`ready` or `in_review` only), even though the domain-level generic open-review helper also includes `draft` and `escalated`.

- [ ] **Step 7: Wire Package detail UI to the action model**

Modify `apps/web/src/features/execution-packages/execution-package-routes.tsx`:

- Import `usePackageRuntimeReadinessQuery`, the existing Review Packet detail query hook if one exists, and `packageActionModel`.
- Call `const readinessQuery = usePackageRuntimeReadinessQuery(packageId);`.
- If `executionPackage.current_review_packet_id` exists, load that Review Packet by id and pass it as `openReview`/`forceRerunReview`; if no reusable hook exists, add one to `apps/web/src/shared/api/hooks.ts` instead of enabling force-rerun from the id pointer alone.
- Build the action model from loaded state:

```ts
const reviewPointerLoading =
  executionPackage.current_review_packet_id !== undefined && currentReviewQuery.data === undefined;

const actions = packageActionModel({
  executionPackage,
  actorId,
  readiness: readinessQuery.data,
  hasActiveRun: executionPackage.current_run_session_id !== undefined,
  ...(reviewPointerLoading ? { hasOpenReview: true } : {}),
  ...(currentReviewQuery.data === undefined ? {} : { openReview: currentReviewQuery.data, forceRerunReview: currentReviewQuery.data }),
  actionPending,
  forceRerunReason: forceReason,
});
```

- If this route has loaded the current run detail, pass `currentRun` instead of `hasActiveRun`; the model then enables replacement only when that run status is terminal. Do not infer that `current_run_session_id === last_run_session_id` is safe, because the active current run can also be the latest run.
- Use `current_review_packet_id` as a conservative `hasOpenReview` signal to block normal run/rerun while Review Packet details load. Do not use it as proof that force-rerun is allowed; force-rerun requires a loaded `ready` or `in_review` packet with `decision === 'none'`.
- Keep force-rerun status checks aligned to the command endpoint, not to the broader domain `isOpenReviewPacketStatus` helper. The current endpoint rejects `draft` and `escalated` Review Packets before enqueue.
- Change the Package header subtitle and metadata so it does not display `work_item_id`, `repo_id`, run ids, or package ids as visible product copy. Prefer the Work Item title/Package objective where available and keep raw ids only inside link `to` attributes.
- Disable buttons from `actions.*.enabled`.
- Render concise reason text below blocked actions:

```tsx
{actions.run.reason ? <p className="empty">{actions.run.reason}</p> : null}
```

Do not clear `forceReason` on mutation failure. Render `runPackage.isError`, `rerunPackage.isError`, and `forceRerunPackage.isError` inline near their buttons.

- [ ] **Step 8: Invalidate package runtime readiness after package mutations**

Modify `apps/web/src/shared/api/hooks.ts`:

```ts
function invalidatePackageResources(queryClient: QueryClient, packageId: string) {
  return Promise.all([
    invalidatePackageDetail(queryClient, packageId),
    queryClient.invalidateQueries({ queryKey: queryKeys.packageRuntimeReadiness(packageId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.executionPackageReplay(packageId) }),
    invalidatePackages(queryClient),
  ]);
}
```

Ensure `useMarkPackageReadyMutation`, `usePatchExecutionPackageMutation`, `useRunPackageMutation`, `useRerunPackageMutation`, and `useForceRerunPackageMutation` eventually call this path or explicitly invalidate readiness.

- [ ] **Step 9: Run focused Web verification**

Run: `pnpm vitest run tests/web/package-run-product-routes.test.tsx`

Expected: PASS.

- [ ] **Step 10: Commit Task 2**

```bash
git add packages/contracts/src/work-item-delivery-readiness.ts packages/db/src/queries/work-item-cockpit-queries.ts apps/web/src/shared/api/types.ts apps/web/src/shared/api/query.ts apps/web/src/shared/api/query-keys.ts apps/web/src/shared/api/hooks.ts apps/web/src/features/execution-packages/package-action-model.ts apps/web/src/features/execution-packages/execution-package-routes.tsx tests/web/fixtures/product-api-mock.ts tests/web/package-run-product-routes.test.tsx
git commit -m "feat: gate package actions with runtime readiness"
```

---

### Task 3: Gate ProductAction Run Commands In Cockpit And Product Lanes

**Files:**
- Modify: `packages/db/src/queries/work-item-cockpit-queries.ts`
- Modify: `packages/db/src/queries/work-item-delivery-readiness.ts`
- Modify: `packages/db/src/queries/product-lane-queries.ts`
- Test: `tests/api/product-lanes.test.ts`
- Test: `tests/db/work-item-delivery-readiness.test.ts` or `tests/api/query-module.test.ts`

- [ ] **Step 1: Write failing tests for disabled `run_package` ProductActions**

Add Product Lane coverage to `tests/api/product-lanes.test.ts`:

```ts
it('does not emit enabled run_package lane actions when runtime readiness is blocked', async () => {
  const { app } = await track(createTestApp());
  const executionPackage = await seedReadyExecutionPackageThroughApi(app);

  const response = await request(app.getHttpServer())
    .get('/query/product-lanes/execution-owner')
    .query({ project_id: executionPackage.project_id })
    .expect(200);

  const runAction = response.body.items
    .flatMap((item: { actions: unknown[] }) => item.actions)
    .find((action: any) => action.kind === 'command' && action.command?.type === 'run_package');

  expect(runAction).toMatchObject({
    enabled: false,
    disabled_reason: expect.stringMatching(/runtime|credential|worker|Codex/i),
  });
});
```

Add Work Item Cockpit coverage:

```ts
it('uses the same runtime readiness blocker for Work Item Cockpit run_package', async () => {
  const { app } = await track(createTestApp());
  const executionPackage = await seedReadyExecutionPackageThroughApi(app);

  const response = await request(app.getHttpServer())
    .get(`/query/work-item-cockpit/${executionPackage.work_item_id}`)
    .query({ lane: 'execution-owner' })
    .expect(200);

  const runAction = response.body.delivery_readiness.next_actions.find(
    (action: any) => action.kind === 'command' && action.command?.type === 'run_package',
  );

  expect(runAction).toMatchObject({
    enabled: false,
    disabled_reason: expect.stringMatching(/runtime|credential|worker|Codex/i),
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm vitest run tests/api/product-lanes.test.ts tests/api/query-module.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because ProductAction builders still emit enabled `run_package` commands.

- [ ] **Step 3: Pass readiness into Work Item readiness derivation**

Modify `packages/db/src/queries/work-item-delivery-readiness.ts`:

```ts
import type { DeliveryRunReadinessResponse } from '@forgeloop/contracts';

export interface WorkItemDeliveryReadinessInput {
  // existing fields...
  runtimeReadinessByPackageId?: ReadonlyMap<string, DeliveryRunReadinessResponse>;
}

const readinessDisabledReason = (readiness: DeliveryRunReadinessResponse | undefined): string | undefined => {
  if (readiness === undefined) return 'Local Codex runtime readiness is still being evaluated.';
  if (readiness.state === 'ready') return undefined;
  return readiness.blockers[0]?.message ?? 'Local Codex runtime readiness is blocked.';
};
```

When execution-owner is about to emit `runPackageAction`, compute:

```ts
const disabledReason = readinessDisabledReason(input.runtimeReadinessByPackageId?.get(firstPackage.id));
runPackageAction({
  // existing fields...
  enabled: disabledReason === undefined,
  ...(disabledReason === undefined ? {} : { disabledReason, blockedReason: disabledReason }),
});
```

Keep `deriveWorkItemDeliveryReadiness` pure/synchronous by passing precomputed readiness in.

- [ ] **Step 4: Precompute Work Item package readiness in the cockpit query**

Modify `packages/db/src/queries/work-item-cockpit-queries.ts`:

```ts
const runtimeReadinessEntries = await Promise.all(
  packages.map(async (executionPackage) => [
    executionPackage.id,
    await deriveDeliveryRunReadiness(repository, {
      executionPackage,
      now: options.now ?? new Date().toISOString(),
    }),
  ] as const),
);
const runtimeReadinessByPackageId = new Map(runtimeReadinessEntries);
```

Prefer passing a deterministic `now` through `WorkItemCockpitOptions` from `QueryService` using `ControlPlaneRuntimeService.now()`. Do not make browser code supply this.

- [ ] **Step 5: Gate Product Lane `run_package` actions with the same helper**

Modify `packages/db/src/queries/product-lane-queries.ts`:

- Change `packageItem` to accept optional readiness:

```ts
const packageItem = (
  laneId: ProductLaneId,
  executionPackage: ExecutionPackage,
  workItem: WorkItem,
  runtimeReadiness?: DeliveryRunReadinessResponse,
): ProductLaneProjectionItem => {
  // ...
}
```

- Before building package lane items in `getProductLane`, precompute readiness for candidate packages.
- Use the same `readinessDisabledReason` helper or move it to `packages/db/src/queries/delivery-runtime-readiness.ts` as `deliveryRunReadinessDisabledReason(readiness)`.
- When blocked, still emit a disabled `run_package` ProductAction with target `/packages/:id` and public-safe reason.

- [ ] **Step 6: Ensure manager lane command hardening remains intact**

Run the product action contract tests:

```bash
pnpm vitest run tests/contracts/product-actions.test.ts
```

Expected: PASS; manager lane still receives navigate actions only from Web hardening and DB never emits manager commands.

- [ ] **Step 7: Run focused query verification**

Run:

```bash
pnpm vitest run tests/api/product-lanes.test.ts tests/api/query-module.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add packages/db/src/queries/work-item-cockpit-queries.ts packages/db/src/queries/work-item-delivery-readiness.ts packages/db/src/queries/product-lane-queries.ts tests/api/product-lanes.test.ts tests/api/query-module.test.ts
git commit -m "feat: gate delivery run product actions"
```

---

### Task 4: Replace Review Hardcoded Decisions With Decision Forms

**Files:**
- Create: `apps/web/src/features/review-packets/review-decision-form.tsx`
- Modify: `apps/web/src/features/review-packets/review-packet-routes.tsx`
- Modify: `apps/web/src/shared/api/hooks.ts`
- Test: `tests/web/review-release-product-routes.test.tsx`

- [ ] **Step 1: Write failing Review form tests**

Add to `tests/web/review-release-product-routes.test.tsx`:

```ts
it('requires a reviewer-entered approve summary instead of hardcoded review text', async () => {
  const user = userEvent.setup();
  const screen = await renderRoute(`/reviews/${reviewPacket.id}`, {
    apiOverrides: {
      [`GET /query/reviews/${reviewPacket.id}`]: { ...reviewPacket, status: 'ready', decision: 'none' },
      [`GET /query/replay/review_packet/${reviewPacket.id}`]: timeline,
      [`POST /review-packets/${reviewPacket.id}/approve`]: { review_packet_id: reviewPacket.id, status: 'completed', decision: 'approved' },
    },
  });

  await user.click(await screen.findByRole('button', { name: 'Approve review' }));
  expect(screen.getByText(/review summary is required/i)).toBeTruthy();

  await user.type(screen.getByLabelText('Approve summary'), 'Implementation evidence is complete.');
  await user.click(screen.getByRole('button', { name: 'Approve review' }));

  await waitFor(() => {
    const approveCall = vi.mocked(globalThis.fetch).mock.calls.find(([url]) => String(url).includes('/approve'));
    expect(JSON.parse(String(approveCall?.[1]?.body))).toMatchObject({
      summary: 'Implementation evidence is complete.',
      reviewed_by_actor_id: actorId,
    });
  });
});

it('requires at least one requested change with title, description, and severity', async () => {
  const user = userEvent.setup();
  const screen = await renderRoute(`/reviews/${reviewPacket.id}`, {
    apiOverrides: {
      [`GET /query/reviews/${reviewPacket.id}`]: { ...reviewPacket, status: 'ready', decision: 'none' },
      [`GET /query/replay/review_packet/${reviewPacket.id}`]: timeline,
      [`POST /review-packets/${reviewPacket.id}/request-changes`]: { review_packet_id: reviewPacket.id, status: 'completed', decision: 'changes_requested' },
    },
  });

  await user.click(await screen.findByRole('tab', { name: 'Request changes' }));
  await user.type(screen.getByLabelText('Request changes summary'), 'Implementation needs targeted fixes before approval.');
  await user.click(screen.getByRole('button', { name: 'Request changes' }));
  expect(screen.getByText(/requested change is required/i)).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'Add requested change' }));
  expect(screen.getAllByLabelText('Change title')).toHaveLength(2);
  await user.click(screen.getAllByRole('button', { name: 'Remove requested change' })[0]!);
  expect(screen.getAllByLabelText('Change title')).toHaveLength(1);
});
```

- [ ] **Step 2: Run Review tests to verify they fail**

Run: `pnpm vitest run tests/web/review-release-product-routes.test.tsx`

Expected: FAIL because Review buttons submit hardcoded payloads without forms.

- [ ] **Step 3: Add Review decision form component**

Create `apps/web/src/features/review-packets/review-decision-form.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { Button, Input, Select, Textarea } from '../../shared/ui';
import type { RequestedChange, ReviewDecisionBody } from '../../shared/api/types';

type Mode = 'approve' | 'request_changes';

export function ReviewDecisionForm({
  actionPending,
  apiError,
  disabled,
  mode,
  onSubmit,
}: {
  actionPending: boolean;
  apiError?: string;
  disabled: boolean;
  mode: Mode;
  onSubmit: (body: Omit<ReviewDecisionBody, 'reviewed_by_actor_id' | 'reviewed_at'>) => void;
}) {
  const [summary, setSummary] = useState('');
  const [changes, setChanges] = useState<RequestedChange[]>([
    { title: '', description: '', severity: 'major' },
  ]);
  const [error, setError] = useState<string | undefined>();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!summary.trim()) {
      setError('Review summary is required.');
      return;
    }
    const requestedChanges = changes
      .map((change) => ({
        title: change.title.trim(),
        description: change.description.trim(),
        ...(change.severity === undefined ? {} : { severity: change.severity }),
      }))
      .filter((change) => change.title && change.description);

    if (mode === 'request_changes' && requestedChanges.length === 0) {
      setError('At least one requested change is required.');
      return;
    }

    setError(undefined);
    onSubmit({
      summary: summary.trim(),
      ...(mode === 'request_changes' ? { requested_changes: requestedChanges } : {}),
    });
  }

  function updateChange(index: number, patch: Partial<RequestedChange>): RequestedChange[] {
    return changes.map((change, currentIndex) => (currentIndex === index ? { ...change, ...patch } : change));
  }

  return (
    <form className="stack-form compact" onSubmit={submit}>
      <label className="field">
        {mode === 'approve' ? 'Approve summary' : 'Request changes summary'}
        <Textarea disabled={disabled} onChange={(event) => setSummary(event.currentTarget.value)} rows={3} value={summary} />
      </label>
      {mode === 'request_changes' ? (
        <div className="stack-form compact">
          {changes.map((change, index) => (
            <div className="stack-form compact" key={index}>
              <label className="field">
                Change title
                <Input value={change.title} onChange={(event) => setChanges(updateChange(index, { title: event.currentTarget.value }))} />
              </label>
              <label className="field">
                Change description
                <Textarea value={change.description} onChange={(event) => setChanges(updateChange(index, { description: event.currentTarget.value }))} />
              </label>
              <label className="field">
                Severity
                <Select
                  value={change.severity ?? 'major'}
                  onChange={(event) => setChanges(updateChange(index, { severity: event.currentTarget.value as RequestedChange['severity'] }))}
                  options={[
                    { label: 'Minor', value: 'minor' },
                    { label: 'Major', value: 'major' },
                    { label: 'Critical', value: 'critical' },
                  ]}
                />
              </label>
              {changes.length > 1 ? (
                <Button type="button" variant="ghost" onClick={() => setChanges(changes.filter((_, currentIndex) => currentIndex !== index))}>
                  Remove requested change
                </Button>
              ) : null}
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => setChanges([...changes, { title: '', description: '', severity: 'major' }])}>
            Add requested change
          </Button>
        </div>
      ) : null}
      {error ? <p className="empty">{error}</p> : null}
      {apiError ? <p className="empty">{apiError}</p> : null}
      <Button disabled={disabled || actionPending} loading={actionPending} type="submit" variant={mode === 'approve' ? 'primary' : 'secondary'}>
        {mode === 'approve' ? 'Approve review' : 'Request changes'}
      </Button>
    </form>
  );
}
```

Adjust the exact props so `reviewed_by_actor_id` is injected by the route, not typed by the user. Keep user-entered fields in component state after API errors.

- [ ] **Step 4: Wire Review route**

Modify `apps/web/src/features/review-packets/review-packet-routes.tsx`:

- Import `ReviewDecisionForm`.
- Add local route state for the active decision mode:

```ts
const [decisionMode, setDecisionMode] = useState<'approve' | 'request_changes'>('approve');
```

- Render a two-option tab/segmented control with `role="tab"` labels `Approve` and `Request changes`, then render exactly one `ReviewDecisionForm` for `decisionMode`. Do not mount approve and request-changes forms simultaneously; otherwise duplicated field labels make tests and assistive technology ambiguous.
- Determine `decisionDisabled` from review status/decision:

```ts
const decisionDisabled = review.status === 'completed' || review.status === 'archived' || review.decision !== 'none';
```

- Submit approve when `decisionMode === 'approve'`:

```tsx
<ReviewDecisionForm
  actionPending={approveReview.isPending}
  {...(approveReview.isError ? { apiError: 'Review approval is temporarily unavailable.' } : {})}
  disabled={decisionDisabled || actionPending}
  mode="approve"
  onSubmit={(body) =>
    approveReview.mutate({
      ...body,
      reviewed_by_actor_id: actorId,
      reviewed_at: new Date().toISOString(),
    })
  }
/>
```

- Submit changes similarly to `requestChanges.mutate`.
- Render a disabled reason when `decisionDisabled` is true.
- Change the Review header subtitle and summary metadata so the page does not display raw `execution_package_id`, `run_session_id`, or review id. Use Package objective, run summary/status, and links with ids only inside `to` attributes.

- [ ] **Step 5: Broaden Review invalidation**

Modify `invalidateReviewPacketResources` in `apps/web/src/shared/api/hooks.ts`:

```ts
function invalidateReviewPacketResources(queryClient: QueryClient, reviewPacketId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.review(reviewPacketId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.reviewPacketReplay(reviewPacketId) }),
    queryClient.invalidateQueries({ queryKey: ['review-packets'] }),
    queryClient.invalidateQueries({ queryKey: ['packages'] }),
    queryClient.invalidateQueries({ queryKey: ['product-lanes'] }),
    queryClient.invalidateQueries({ queryKey: ['work-item-cockpit'] }),
  ]);
}
```

If the mutation response includes package/work item ids, prefer targeted invalidation. If it does not, broad prefix invalidation is acceptable for this product page mutation.

- [ ] **Step 6: Run focused Web verification**

Run: `pnpm vitest run tests/web/review-release-product-routes.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add apps/web/src/features/review-packets/review-decision-form.tsx apps/web/src/features/review-packets/review-packet-routes.tsx apps/web/src/shared/api/hooks.ts tests/web/review-release-product-routes.test.tsx
git commit -m "feat: add review decision forms"
```

---

### Task 5: Replace Release Command List With A State-Aware Decision Rail

**Files:**
- Create: `apps/web/src/features/releases/release-action-model.ts`
- Create: `apps/web/src/features/releases/release-action-rail.tsx`
- Modify: `apps/web/src/features/releases/release-routes.tsx`
- Modify: `apps/web/src/shared/api/hooks.ts`
- Test: `tests/web/review-release-product-routes.test.tsx`

- [ ] **Step 1: Write failing Release action rail tests**

Add tests to `tests/web/review-release-product-routes.test.tsx`:

```ts
it('renders only the active release decision group with disabled reasons', async () => {
  const { rollout_strategy: _rolloutStrategy, ...releaseMissingRolloutStrategy } = releaseWithKey;
  const blockedCockpit = {
    ...releaseCockpitResponse,
    release: { ...releaseMissingRolloutStrategy, phase: 'candidate', gate_state: 'not_submitted', resolution: 'none' },
    blockers: [{ code: 'missing_rollout_strategy', category: 'planning', overrideable: true, message: 'Release is missing a rollout strategy.' }],
  };

  const screen = await renderRoute(`/releases/${release.id}`, {
    apiOverrides: {
      [`GET /query/release-cockpit/${release.id}`]: blockedCockpit,
      [`GET /query/replay/release/${release.id}`]: timeline,
    },
  });

  expect(await screen.findByRole('heading', { name: release.title })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Submit for approval' })).toHaveProperty('disabled', true);
  expect(screen.getByText(/missing a rollout strategy/i)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Close release' })).toBeNull();
});

it('requires override rationale and confirmation before override approval', async () => {
  const user = userEvent.setup();
  const screen = await renderRoute(`/releases/${release.id}`, {
    apiOverrides: {
      [`GET /query/release-cockpit/${release.id}`]: {
        ...releaseCockpitResponse,
        release: { ...releaseWithKey, phase: 'approval', gate_state: 'awaiting_approval', resolution: 'none' },
        blockers: [{ code: 'failed_required_check', category: 'evidence', overrideable: true, message: 'A required check failed.' }],
        blocker_snapshot: {
          ...releaseCockpitResponse.blocker_snapshot,
          blockers: [{ code: 'failed_required_check', category: 'evidence', overrideable: true, message: 'A required check failed.' }],
        },
      },
      [`GET /query/replay/release/${release.id}`]: timeline,
      [`POST /releases/${release.id}/override-approve`]: { release_id: release.id, status: 'approved' },
    },
  });

  expect(await screen.findByRole('button', { name: 'Override approve' })).toHaveProperty('disabled', true);
  await user.type(screen.getByLabelText('Override rationale'), 'Risk accepted for an emergency patch.');
  await user.type(screen.getByLabelText('Override confirmation'), 'override approve');
  expect(screen.getByRole('button', { name: 'Override approve' })).toHaveProperty('disabled', false);
});
```

- [ ] **Step 2: Run Release Web tests to verify they fail**

Run: `pnpm vitest run tests/web/review-release-product-routes.test.tsx`

Expected: FAIL because the current Release rail shows a long always-visible command list.

- [ ] **Step 3: Add pure Release action model**

Create `apps/web/src/features/releases/release-action-model.ts`:

```ts
import type { ReleaseCockpitResponse } from '../../shared/api/types';

export type ReleaseDecisionGroup =
  | 'edit_planning'
  | 'submit_for_approval'
  | 'approval_decision'
  | 'qa_test_acceptance'
  | 'observation_transition'
  | 'close_release';

export interface ReleaseActionAvailability {
  group: ReleaseDecisionGroup;
  visible: boolean;
  enabled: boolean;
  reason?: string;
}

const hasText = (value: string | undefined | null): boolean => typeof value === 'string' && value.trim().length > 0;
const firstBlocker = (cockpit: ReleaseCockpitResponse): string | undefined => cockpit.blockers[0]?.message;
const availability = (
  input: Omit<ReleaseActionAvailability, 'reason'>,
  reason?: string,
): ReleaseActionAvailability => (reason === undefined ? input : { ...input, reason });

export function releaseActionModel(cockpit: ReleaseCockpitResponse): Record<ReleaseDecisionGroup, ReleaseActionAvailability> {
  const release = cockpit.release;
  const planningComplete = hasText(release.scope_summary) && hasText(release.rollout_strategy) && hasText(release.rollback_plan) && hasText(release.observation_plan);
  const hasBlockers = cockpit.blockers.length > 0;
  const approvalDecisionVisible = release.phase === 'approval' && release.gate_state === 'awaiting_approval';
  const approved = release.gate_state === 'approved';
  const qaHandoffVisible = approved || release.phase === 'rollout' || release.phase === 'observing';
  const observing = release.phase === 'observing';

  return {
    edit_planning: { group: 'edit_planning', visible: release.phase === 'draft' || release.phase === 'candidate', enabled: true },
    submit_for_approval: availability(
      {
        group: 'submit_for_approval',
        visible: release.phase === 'draft' || release.phase === 'candidate',
        enabled: planningComplete,
      },
      planningComplete ? undefined : 'Release needs scope, rollout, rollback, and observation planning before submission.',
    ),
    approval_decision: availability(
      {
        group: 'approval_decision',
        visible: approvalDecisionVisible,
        enabled: !hasBlockers,
      },
      hasBlockers ? firstBlocker(cockpit) ?? 'Release readiness blockers must be resolved or override-approved.' : undefined,
    ),
    qa_test_acceptance: availability(
      {
        group: 'qa_test_acceptance',
        visible: qaHandoffVisible,
        enabled: !hasBlockers,
      },
      hasBlockers ? firstBlocker(cockpit) : undefined,
    ),
    observation_transition: {
      group: 'observation_transition',
      visible: approved,
      enabled: approved,
    },
    close_release: availability(
      {
        group: 'close_release',
        visible: observing || release.phase === 'rollout',
        enabled: observing,
      },
      observing ? undefined : 'Release must be observing before normal closure.',
    ),
  };
}
```

Adjust release phase/gate state values to the existing contract values in `packages/contracts/src/release.ts` and current fixtures.

- [ ] **Step 4: Move Release rail into focused component**

Create `apps/web/src/features/releases/release-action-rail.tsx` by moving the existing `ReleaseActionRail` contents out of `release-routes.tsx`, then change rendering to:

- Edit planning group visible for draft/candidate.
- Submit group visible for draft/candidate; disabled until planning complete.
- Approval group visible during approval-oriented states.
- Override approve visible only when blockers exist; requires non-empty rationale and confirmation text `override approve`.
- Request changes visible only during approval-oriented phases; requires non-empty rationale.
- QA/Test acceptance group visible when handoff is relevant and disabled when upstream blockers remain.
- Start observing visible only after approved or override-approved release state.
- Close visible only in observing/close-ready states; requires terminal resolution, summary if the selected resolution needs it, confirmation text `close release`, and observation requirement unless the API supports explicit override.

Render disabled reasons with `p.empty` near the relevant action. Keep all form state local so API errors do not clear user input.
Do not render `cockpit.blocker_snapshot.blocker_fingerprint` or raw release/work item/package ids in visible text. Override approval may still submit the full `blocker_snapshot` body required by the API, but the UI should show blocker categories/messages and confirmation text, not fingerprints.

- [ ] **Step 5: Wire route and remove old inline rail**

Modify `apps/web/src/features/releases/release-routes.tsx`:

- Import `ReleaseActionRail` from `./release-action-rail`.
- Import `releaseActionModel` from `./release-action-model` and compute `const releaseActions = releaseActionModel(cockpit);`.
- Pass `model={releaseActions}` to `ReleaseActionRail` so the route and any remaining Test Acceptance section share the same state-aware decision model.
- Delete the old inline `ReleaseActionRail` function after the new component is in use.
- Keep `TestAcceptanceForm` only once; if it remains as a detail section, make the rail link or scroll to it instead of duplicating submission controls.

- [ ] **Step 6: Broaden Release invalidation**

Modify `useReleaseCommandMutation` in `apps/web/src/shared/api/hooks.ts`:

```ts
onSuccess: () =>
  Promise.all([
    invalidateReleaseCockpit(queryClient, releaseId),
    queryClient.invalidateQueries({ queryKey: queryKeys.releaseReplay(releaseId) }),
    queryClient.invalidateQueries({ queryKey: ['releases'] }),
    queryClient.invalidateQueries({ queryKey: ['product-lanes'] }),
    queryClient.invalidateQueries({ queryKey: ['work-item-cockpit'] }),
    queryClient.invalidateQueries({ queryKey: ['packages'] }),
    queryClient.invalidateQueries({ queryKey: ['review-packets'] }),
  ]),
```

If response payloads later include scoped work item ids, tighten to targeted invalidation; do not leave only `release-cockpit` invalidated.

- [ ] **Step 7: Run focused Release verification**

Run: `pnpm vitest run tests/web/review-release-product-routes.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add apps/web/src/features/releases/release-action-model.ts apps/web/src/features/releases/release-action-rail.tsx apps/web/src/features/releases/release-routes.tsx apps/web/src/shared/api/hooks.ts tests/web/review-release-product-routes.test.tsx
git commit -m "feat: add release decision rail"
```

---

### Task 6: Close QA/Test Handoff And Cache Invalidation Gaps

**Files:**
- Modify: `packages/db/src/queries/work-item-delivery-readiness.ts`
- Modify: `apps/web/src/features/releases/release-action-model.ts`
- Modify: `apps/web/src/features/releases/release-action-rail.tsx`
- Modify: `apps/web/src/features/releases/release-routes.tsx`
- Modify: `apps/web/src/shared/api/hooks.ts`
- Test: `tests/api/product-lanes.test.ts`
- Test: `tests/web/review-release-product-routes.test.tsx`
- Test: `tests/web/api-hooks.test.tsx` or `tests/web/product-action-invalidation.test.tsx`

- [ ] **Step 1: Write failing tests for decision-oriented cockpit handoffs**

Add or update query tests so Reviewer, QA/Test Owner, and Release Owner next actions describe the decision expected on the owning object page:

```ts
it('routes Reviewer to a decision-oriented Review Packet action', async () => {
  const { app } = await track(createTestApp());
  const seeded = await seedReviewAwaitingHumanDecision(app);

  const response = await request(app.getHttpServer())
    .get(`/query/work-item-cockpit/${seeded.workItem.id}`)
    .query({ lane: 'reviewer' })
    .expect(200);

  expect(response.body.delivery_readiness.next_actions[0]).toMatchObject({
    kind: 'navigate',
    label: expect.stringMatching(/Decide Review|Review decision/i),
    description: expect.stringMatching(/approve|request changes/i),
    target: expect.objectContaining({ object_type: 'review_packet', object_id: seeded.reviewPacket.id }),
  });
});

it('routes QA/Test owner to release test acceptance when release handoff is waiting', async () => {
  const { app } = await track(createTestApp());
  const seeded = await seedReleaseWaitingForTestAcceptance(app);

  const response = await request(app.getHttpServer())
    .get(`/query/work-item-cockpit/${seeded.workItem.id}`)
    .query({ lane: 'qa-test-owner' })
    .expect(200);

  expect(response.body.delivery_readiness.next_actions[0]).toMatchObject({
    kind: 'navigate',
    label: expect.stringMatching(/Release Test Acceptance|QA/i),
    target: expect.objectContaining({ object_type: 'release', object_id: seeded.release.id }),
  });
});

it('routes Release Owner to a release readiness decision with explicit expected action', async () => {
  const { app } = await track(createTestApp());
  const seeded = await seedReleaseAwaitingApprovalDecision(app);

  const response = await request(app.getHttpServer())
    .get(`/query/work-item-cockpit/${seeded.workItem.id}`)
    .query({ lane: 'release-owner' })
    .expect(200);

  expect(response.body.delivery_readiness.next_actions[0]).toMatchObject({
    kind: 'navigate',
    label: expect.stringMatching(/Release readiness|Approve Release|Submit Release/i),
    description: expect.stringMatching(/submit|approve|request changes|close/i),
    target: expect.objectContaining({ object_type: 'release', object_id: seeded.release.id }),
  });
});
```

Use existing delivery-flow/product-lane seed helpers if they already create these states. If not, add focused helper functions in `tests/api/product-lanes.test.ts` before these tests, or export them from the existing API fixture module already used by this file: `seedReviewAwaitingHumanDecision`, `seedReleaseWaitingForTestAcceptance`, and `seedReleaseAwaitingApprovalDecision`. Keep the helpers narrow and state-focused; avoid building large inline object graphs inside the assertions.

- [ ] **Step 2: Write failing tests for all-lane cockpit invalidation**

Create `tests/web/product-action-invalidation.test.tsx` or extend `tests/web/api-hooks.test.tsx`:

```ts
it('invalidates every cached Work Item Cockpit lane variant after ProductAction commands', async () => {
  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const runPackageProductActionFixture: ProductCommandAction = {
    id: `run-package-${executionPackage.id}`,
    lane_id: 'execution-owner',
    priority: 'primary',
    label: 'Run package',
    enabled: true,
    kind: 'command',
    command: {
      type: 'run_package',
      object_type: 'execution_package',
      object_id: executionPackage.id,
      work_item_id: workItem.id,
      package_id: executionPackage.id,
    },
    target: {
      kind: 'object',
      object_type: 'execution_package',
      object_id: executionPackage.id,
      href: `/packages/${executionPackage.id}`,
    },
  };

  queryClient.setQueryData(queryKeys.workItemCockpit(workItem.id, 'execution-owner'), { marker: 'execution' });
  queryClient.setQueryData(queryKeys.workItemCockpit(workItem.id, 'reviewer'), { marker: 'reviewer' });

  await invalidateProductActionTargets(queryClient, {
    projectId,
    workItemId: workItem.id,
    action: runPackageProductActionFixture,
  });

  const cockpitInvalidation = invalidateSpy.mock.calls
    .map(([input]) => input)
    .find((input): input is { predicate: (query: { queryKey: readonly unknown[] }) => boolean } => {
      return (
        typeof input === 'object' &&
        input !== null &&
        'predicate' in input &&
        typeof input.predicate === 'function' &&
        input.predicate({ queryKey: queryKeys.workItemCockpit(workItem.id, 'execution-owner') }) === true &&
        input.predicate({ queryKey: queryKeys.workItemCockpit('other-work-item', 'execution-owner') }) === false
      );
    });

  expect(cockpitInvalidation?.predicate?.({ queryKey: queryKeys.workItemCockpit(workItem.id, 'execution-owner') })).toBe(true);
  expect(cockpitInvalidation?.predicate?.({ queryKey: queryKeys.workItemCockpit(workItem.id, 'reviewer') })).toBe(true);
  expect(cockpitInvalidation?.predicate?.({ queryKey: queryKeys.workItemCockpit('other-work-item', 'reviewer') })).toBe(false);
});
```

Import `ProductCommandAction`, `QueryClient`, `queryKeys`, `projectId`, `workItem`, and `executionPackage` from the existing Web test helpers. Export `invalidateProductActionTargets` only if the test cannot reach it otherwise. If exporting it would widen production API awkwardly, test through `useProductActionCommandMutation` and keep the same predicate assertions by spying on the query client used by the hook.

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm vitest run tests/api/product-lanes.test.ts tests/web/review-release-product-routes.test.tsx tests/web/api-hooks.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL on QA/Test handoff or invalidation gaps.

- [ ] **Step 4: Make Reviewer, QA/Test, and Release Owner next actions explicit**

Modify `packages/db/src/queries/work-item-delivery-readiness.ts` in `actionForLane`:

- If active lane is `reviewer` and a selected Review Packet is awaiting human decision, navigate to `/reviews/:id` with label `Decide Review Packet` and description `Approve this review or request specific changes.`.
- If active lane is `reviewer` but no Review Packet exists, navigate to the Package blocker context with a description that says review evidence must be generated before the reviewer can decide.
- If active lane is `qa-test-owner` and quality gate is blocked, navigate to Work Item quality gate context with a label like `Review Quality Gate blockers`.
- If quality gate is passed/ready and linked release exists, navigate to `/releases/:id#test-acceptance` with label `Acknowledge Release Test Acceptance`.
- If no linked release exists but handoff is expected, navigate to `/releases` with label `Open Release inventory`.
- If active lane is `release-owner` and a linked release exists, navigate to `/releases/:id` with a state-specific label such as `Submit Release for Approval`, `Decide Release Approval`, `Start Release Observation`, or `Close Release` and a description that names the required decision.
- If active lane is `release-owner` and no release exists but handoff is expected, navigate to `/releases` with label `Create or link Release` and a description that says release scope must be established.

The description must say what decision is expected, not just where the link opens.

- [ ] **Step 5: Add release test acceptance anchors and disabled reason**

Modify `apps/web/src/features/releases/release-routes.tsx`:

```tsx
const releaseActions = releaseActionModel(cockpit);

<ReleaseActionRail actorId={actorId} cockpit={cockpit} model={releaseActions} />

<Section id="test-acceptance" title="Test Acceptance" description="QA acceptance is acknowledged with summary and artifact references.">
  <TestAcceptanceForm actorId={actorId} disabledReason={releaseActions.qa_test_acceptance.reason} releaseId={release.id} />
</Section>
```

Modify `ReleaseActionRail` to accept the precomputed `model` prop instead of recomputing it internally, so the route and rail share one decision model. Modify `TestAcceptanceForm` to accept `disabledReason?: string`, render it, and disable submit when present.

- [ ] **Step 6: Fix invalidation for all Work Item Cockpit lane variants**

Modify `apps/web/src/shared/api/hooks.ts`:

```ts
function invalidateWorkItemCockpit(queryClient: QueryClient, workItemId: string | undefined) {
  if (workItemId === undefined) return Promise.resolve();
  return queryClient.invalidateQueries({
    predicate: ({ queryKey }) => queryKey[0] === 'work-item-cockpit' && queryKey[1] === workItemId,
  });
}
```

Update `invalidateObjectQuery('work_item')` and `invalidateProductActionTargets` to use this helper rather than a single `queryKeys.workItemCockpit(workItemId)` exact key.

- [ ] **Step 7: Run focused verification**

Run:

```bash
pnpm vitest run tests/api/product-lanes.test.ts tests/web/review-release-product-routes.test.tsx tests/web/api-hooks.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

```bash
git add packages/db/src/queries/work-item-delivery-readiness.ts apps/web/src/features/releases/release-action-model.ts apps/web/src/features/releases/release-action-rail.tsx apps/web/src/features/releases/release-routes.tsx apps/web/src/shared/api/hooks.ts tests/api/product-lanes.test.ts tests/web/review-release-product-routes.test.tsx
git add tests/web/api-hooks.test.tsx
# If Step 2 created a separate invalidation test file instead of extending api-hooks, run this additional add:
# git add tests/web/product-action-invalidation.test.tsx
git commit -m "feat: close delivery handoff invalidation"
```

---

### Task 7: Final Route Closure And No-Legacy Verification

**Files:**
- Modify: `tests/web/package-run-product-routes.test.tsx`
- Modify: `tests/web/review-release-product-routes.test.tsx`
- Modify: `tests/api/product-lanes.test.ts`
- Optional modify/create: `tests/e2e/web-product-routes.e2e.test.ts`
- No product code changes unless this task finds a blocker.

- [ ] **Step 1: Add route-level closure smoke**

Add one test covering the main path shape without relying on Dev Tools:

```ts
it('exposes the post-plan delivery closure path through product pages', async () => {
  const screen = await renderRoute(`/packages/${executionPackage.id}`, {
    apiOverrides: {
      [`GET /execution-packages/${executionPackage.id}`]: {
        ...executionPackageWithoutRun,
        phase: 'ready',
        gate_state: 'not_submitted',
      },
      [`GET /query/replay/execution_package/${executionPackage.id}`]: timeline,
      [`GET /query/execution-packages/${executionPackage.id}/runtime-readiness`]: {
        executor_type: 'local_codex',
        target_kind: 'run_execution',
        state: 'ready',
        blockers: [],
      },
    },
  });

  expect(await screen.findByRole('button', { name: 'Run' })).toBeTruthy();
  expect(screen.queryByText(/Dev Tools|raw JSON|runtime_profile_id|credential_binding_id|worker_id/i)).toBeNull();
  expect(screen.queryByText(executionPackage.id)).toBeNull();
  expect(screen.queryByText(executionPackage.work_item_id)).toBeNull();
  expect(screen.queryByText(executionPackage.repo_id)).toBeNull();
});
```

Add companion assertions on `/reviews/:id` and `/releases/:id` in existing tests if a separate e2e test would duplicate too much fixture setup:

```ts
expect(screen.queryByText(reviewPacket.id)).toBeNull();
expect(screen.queryByText(reviewPacket.execution_package_id)).toBeNull();
expect(screen.queryByText(reviewPacket.run_session_id)).toBeNull();
expect(screen.queryByText(release.id)).toBeNull();
expect(screen.queryByText(releaseCockpitResponse.blocker_snapshot.blocker_fingerprint)).toBeNull();
expect(screen.queryByText(/blocker_fingerprint|raw JSON|Dev Tools/i)).toBeNull();
```

- [ ] **Step 2: Run full targeted test suite**

Run:

```bash
pnpm vitest run \
  tests/contracts/delivery-runtime-readiness.test.ts \
  tests/contracts/work-item-delivery-readiness.test.ts \
  tests/contracts/product-actions.test.ts \
  tests/contracts/contracts.test.ts \
  tests/db/delivery-runtime-readiness.test.ts \
  tests/api/query-module.test.ts \
  tests/api/product-lanes.test.ts \
  tests/web/package-run-product-routes.test.tsx \
  tests/web/review-release-product-routes.test.tsx \
  tests/web/api-hooks.test.tsx \
  --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 3: Run no-legacy and type checks**

Run:

```bash
! rg -n "p0|P0|work-item-owner|Work Item Owner|[Ww]orkbench|/workbench" apps/web/src packages/contracts/src packages/db/src/queries
! rg -n "runtime_profile_id|credential_binding_id|worker_id|launch_lease|lease_token|codex_config_toml|runtime_profile_digest|credential_payload_digest|docker_image_digest|workspace_root|local_path|localPath|raw_config|raw_auth|Docker command|docker run" apps/web/src/features/execution-packages apps/web/src/features/review-packets apps/web/src/features/releases packages/contracts/src/delivery-runtime-readiness.ts
rg -n "runtime_profile_id|credential_binding_id|worker_id|launch_lease|lease_token|codex_config_toml" tests/web || true
pnpm vitest run tests/web/no-legacy-web-ui.test.ts tests/api/delivery-route-contract.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/web typecheck
pnpm -r build
```

Expected:
- The first `rg` returns no active legacy `p0`, Workbench, or Work Item Owner product vocabulary in active product source.
- The second `rg` returns no raw runtime identifiers in browser object pages or the public runtime readiness contract. Do not include `packages/contracts/src/work-item-delivery-readiness.ts` in this zero-hit guard because its safe public schema may still contain the field name `runtime_metadata`.
- The third `rg` returns either no hits or only negative assertions/unsafe-input fixtures that prove redaction. There must be no Web fixture that feeds raw runtime identifiers into a successful public DTO parse.
- Legacy guard tests pass.
- `pnpm --filter @forgeloop/web typecheck` and `pnpm -r build` pass.

- [ ] **Step 4: Optional browser visual smoke**

If a local dev server is already running, use the in-app browser. Otherwise run:

```bash
pnpm --filter @forgeloop/web dev --host 127.0.0.1
```

Open:
- `/packages/:packageId`
- `/reviews/:reviewPacketId`
- `/releases/:releaseId`
- `/work-items/:workItemId?lane=execution-owner`

Verify:
- No card-in-card action rail.
- Disabled reasons are visible and concise.
- Review and Release forms preserve entered text after validation errors.
- Runtime readiness UI does not reveal raw runtime ids/digests/paths/config.
- Mobile-width layout does not create horizontal scroll for action controls.

- [ ] **Step 5: Commit final closure tests/fixes**

```bash
git add tests/web/package-run-product-routes.test.tsx tests/web/review-release-product-routes.test.tsx tests/api/product-lanes.test.ts tests/e2e/web-product-routes.e2e.test.ts
git commit -m "test: cover delivery action decision closure"
```

If no code or test changes were needed in this task, skip the commit and record the verification output in the PR description.

---

## Final Verification Before PR

Run:

```bash
pnpm vitest run \
  tests/contracts/delivery-runtime-readiness.test.ts \
  tests/contracts/work-item-delivery-readiness.test.ts \
  tests/contracts/product-actions.test.ts \
  tests/contracts/contracts.test.ts \
  tests/db/delivery-runtime-readiness.test.ts \
  tests/api/query-module.test.ts \
  tests/api/product-lanes.test.ts \
  tests/web/package-run-product-routes.test.tsx \
  tests/web/review-release-product-routes.test.tsx \
  tests/web/api-hooks.test.tsx \
  --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/web typecheck
pnpm -r build
git diff --check
```

Expected: all commands pass.

## PR Notes Checklist

- Confirm Stream A started after Stream B or was rebased onto Stream B.
- Confirm ProductAction command union was not expanded.
- Confirm Work Item create DTOs/forms were not touched.
- Confirm runtime readiness DTO is public-safe and redaction tests pass.
- Confirm Package, Work Item Cockpit, and Product Lane use the same readiness helper for `run_package` gating.
- Confirm Review decisions no longer submit hardcoded summary/requested-change payloads.
- Confirm Release action rail is state-aware and no longer a long always-visible command list.
- Confirm no Evolution Loop / Retrospective work is included.
