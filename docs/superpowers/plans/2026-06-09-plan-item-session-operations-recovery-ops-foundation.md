# Plan Item Session Operations Recovery Ops Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Wave 8 Recovery/Ops Foundation so ForgeLoop can diagnose, recover, scavenge, and audit Plan Item Codex session control-state failures without invoking Codex or exposing raw runtime internals.

**Architecture:** Add a dedicated product-level Session Operations spine beside the existing Plan Item Workflow module. Contracts/domain code define health projections, candidate predicates, redaction, and recovery invariants; persistence records durable health, recovery, and capsule retention pins; API and UI expose scoped operator controls plus public Plan Item diagnostics. Recovery remains control-only and advisory: it fences stale candidates, records audit evidence, and leaves later continue/fork/archive decisions to separate human product actions.

**Tech Stack:** TypeScript, pnpm, Vitest, NestJS, Drizzle/Postgres, Zod contracts, React, TanStack Query, existing `@forgeloop/domain`, `@forgeloop/contracts`, `@forgeloop/db`, Plan Item Workflow, Codex runtime, and internal audit/object-event infrastructure.

---

## Scope Check

This plan implements the first slice of `docs/superpowers/specs/2026-06-09-plan-item-session-operations-spine-design.md`: **Recovery/Ops Foundation**.

In scope:

- `SessionHealthProjection` / `PlanItemSessionHealth` product read model.
- Health states: `healthy`, `attention_needed`, `blocked_stale_lease`, `blocked_orphaned_action`, `blocked_missing_capsule`, `blocked_lineage_conflict`, `recovered`, `unrecoverable`.
- `ObservedRef<T>` and `SessionRecoveryCandidatePredicate` fencing with explicit observed-absent versus unchecked semantics.
- Durable `SessionRecoveryRecord` rows for applied, skipped, and blocked attempts.
- Per-capsule `CapsuleRetentionPin` projection metadata.
- Control-only `recover`, `mark_unrecoverable`, and `scavenge` operations.
- Operator dashboard API and UI skeleton.
- Plan Item diagnostics API and UI panel.
- Public/operator/internal DTO split and redaction tests.
- No-baggage guards preventing retired execution/runtime bypasses.
- Runbook updates for operator recovery and scavenge.
- Scavenge operator support through dashboard/API, a thin operator script wrapper, and runbook. The wrapper must call the same API semantics and must not bypass authorization, predicate fencing, idempotency, or audit.

Out of scope:

- Public fork creation routes.
- Active fork selection routes.
- Fork comparison UI.
- Automatic Codex continuation after recovery.
- Automatic session creation during recovery.
- Automatic workflow stage transitions during recovery.
- Automatic capsule deletion or retention cleanup workers.
- Raw capsule archive downloads or raw `~/.codex` browsing.
- Generic extraction of structured task lists from implementation plan markdown.

Keep this as one sequential plan. The core contract, persistence, API, and UI all depend on the same predicate and redaction semantics, so splitting the first slice would create duplicate health logic.

## File Structure

### Contracts

- Create `packages/contracts/src/session-operations.ts`
  - Owns Zod schemas and exported types for health states, severities, `ObservedRef`, `CapsuleRetentionPin`, `SessionRecoveryCandidatePredicate`, public Plan Item diagnostics DTO, operator health DTO, recovery requests, scavenge requests, scavenge responses, and audit DTOs.
- Modify `packages/contracts/src/index.ts`
  - Re-export session operations contracts.
- Test `tests/contracts/session-operations.test.ts`
  - Contract validation, DTO redaction shape, predicate exactness, and scavenge request behavior.

### Domain

- Create `packages/domain/src/session-operations.ts`
  - Owns domain interfaces, projection digest creation, health-state derivation helpers, candidate predicate builders, predicate revalidation helpers, redaction helpers, idempotency conflict helpers, and recovery result helpers.
- Modify `packages/domain/src/types.ts`
  - Adds domain error codes for session operations fail-closed cases.
- Modify `packages/domain/src/index.ts`
  - Re-export the new domain module.
- Test `tests/domain/session-operations.test.ts`
  - Healthy/stale/orphan/missing/lineage projection behavior, redaction, fencing, idempotency, and retention pin logic.

### Database And Repository

- Modify `packages/db/src/schema/plan-item-workflow.ts`
  - Add `plan_item_session_health`, `session_recovery_records`, and `capsule_retention_pins` tables near existing workflow/session tables because they are children of workflow/session/capsule state.
- Modify `packages/db/src/schema/index.ts`
  - Export new table definitions if needed by current schema barrel conventions.
- Create: `packages/db/migrations/0006_session_operations_recovery_ops_foundation.sql`
  - Generated Drizzle migration for the new health, recovery, and retention pin tables.
- Modify: `packages/db/migrations/meta/_journal.json`
  - Generated Drizzle migration journal update.
- Create: `packages/db/migrations/meta/0006_snapshot.json`
  - Generated Drizzle schema snapshot for the new migration.
- Modify `packages/db/src/repositories/delivery-repository.ts`
  - Add typed repository interfaces for health projection upsert/list/get, recovery record create/replay/idempotency conflict lookup, retention pin upsert/list, and fenced terminalization helpers.
- Modify `packages/db/src/repositories/in-memory-delivery-repository.ts`
  - Implement the new repository behavior and in-memory uniqueness/idempotency constraints.
- Modify `packages/db/src/repositories/drizzle-delivery-repository.ts`
  - Implement transactional persistence, predicate replay, and Drizzle mappings.
- Test `tests/db/session-operations-repository.test.ts`
  - Repository contract tests for in-memory plus critical Drizzle behavior.
- Test `tests/db/schema.test.ts`
  - Schema/table/index checks.

### Control-Plane API

- Create `apps/control-plane-api/src/modules/session-operations/session-operations.dto.ts`
  - Imports schemas from `@forgeloop/contracts` and exposes request DTO types.
- Create `apps/control-plane-api/src/modules/session-operations/session-operations.service.ts`
  - Owns health projection loading, public/operator redaction, scope checks, recovery/scavenge fencing, audit records, ObjectEvent writing, and no Codex invocation guarantees.
- Create `apps/control-plane-api/src/modules/session-operations/session-operations.controller.ts`
  - Routes:
    - `GET /session-operations/health`
    - `GET /session-operations/:sessionId/audit`
    - `POST /session-operations/:sessionId/recover`
    - `POST /session-operations/scavenge`
    - `GET /plan-items/:planItemId/session-diagnostics`
- Create `apps/control-plane-api/src/modules/session-operations/session-operations.module.ts`
  - Imports `ControlPlaneCoreModule` and `PlanItemWorkflowsModule`; provides `SessionOperationsService`.
- Modify `apps/control-plane-api/src/app.module.ts`
  - Import `SessionOperationsModule`.
- Test `tests/api/session-operations.test.ts`
  - API route, auth/scope, recovery, scavenge, redaction, and no side-effect tests.
- Create `tests/helpers/session-operations-fixtures.ts`
  - Test helpers that seed stale lease, orphaned queued action, orphaned runtime/run-session, missing capsule, ambiguous workflow, scoped actor, and candidate predicate states.
- Modify `tests/helpers/plan-item-workflow-fixtures.ts`
  - Reuse generic org/project/workflow setup where needed; do not duplicate existing seed logic.

### Web

- Modify `apps/web/src/shared/api/types.ts`
  - Import/export session operation DTO types from contracts.
- Modify `apps/web/src/shared/api/query.ts`
  - Add health, audit, and Plan Item diagnostics query functions.
- Modify `apps/web/src/shared/api/commands.ts`
  - Add recover and scavenge command functions only.
- Modify `apps/web/src/shared/api/query-keys.ts`
  - Add `sessionOperationsHealth`, `sessionOperationsAudit`, and `planItemSessionDiagnostics` keys.
- Modify `apps/web/src/shared/api/hooks.ts`
  - Add React Query hooks and mutations with invalidation.
- Create `apps/web/src/features/session-operations/session-operations-dashboard-route.tsx`
  - Operator dashboard skeleton for health rows, candidate details, dry-run, recover, scavenge execute, and audit links.
- Create `apps/web/src/app/routes/session-operations/index.tsx`
  - Route wrapper that renders the dashboard.
- Modify `apps/web/src/app/routes.ts`
  - Add `route('session-operations', './routes/session-operations/index.tsx')`.
- Create `apps/web/src/features/development-plans/plan-item-session-diagnostics-panel.tsx`
  - Public Plan Item diagnostics panel with safe state summary and operator escalation affordance.
- Modify `apps/web/src/features/development-plans/plan-item-workflow-workspace.tsx`
  - Render diagnostics in the right context column without exposing operator-only controls.
- Test `tests/web/session-operations-routes.test.tsx`
  - Dashboard skeleton and recovery controls.
- Test `tests/web/development-plan-routes.test.tsx`
  - Plan Item diagnostics panel states.
- Test `tests/web/api-client-contract.test.ts`
  - API path and request shape coverage.

### Runbooks And Guards

- Create `docs/runbooks/plan-item-session-operations.md`
  - Operator runbook for health dashboard, dry-run scavenge, fenced recovery, no-op handling, and manual product action after recovery.
- Create `scripts/session-operations-scavenge.ts`
  - Thin operator wrapper that calls the Session Operations API for dry-run and execute modes; it must not read/write repository state directly.
- Modify `scripts/check-codex-runtime-superpowers-no-baggage.ts`
  - Add Session Operations module, web route, and runbook to strict scan roots/files if needed.
- Test `tests/smoke/codex-runtime-no-baggage-gate.test.ts`
  - Assert new routes do not expose raw runtime terms or retired bypasses.
- Test `tests/smoke/session-operations-scavenge-script.test.ts`
  - Assert the script calls API routes and requires signed actor/operator context; it must not import `@forgeloop/db`.
- Existing gate `pnpm check:codex-runtime-superpowers-no-baggage`
  - Must pass before final delivery.
- Existing gate `pnpm check:runbook-scripts`
  - Must pass before final delivery.

## Implementation Rules

- Recovery must never invoke Codex, create a Codex session, fork, choose an active fork, advance workflow status, retry execution, delete capsules, mutate capsule archives, or change approved artifact revision pointers.
- Scavenge support in this first slice is API/dashboard/runbook support plus a thin operator script wrapper around the same API. Do not implement separate repository/direct-DB scavenge logic.
- Checkpoint recovery is advisory only. It may record the latest safe checkpoint candidate, but must not mutate `PlanItemWorkflow.active_boundary_summary_revision_id`, `active_spec_doc_revision_id`, `active_implementation_plan_doc_revision_id`, or `execution_package_id`.
- Every recover/scavenge execute request must include a `candidate_predicate` captured from the health projection.
- For single-session recover/mark-unrecoverable, the request `operation_idempotency_key` must exactly equal `candidate_predicate.operation_idempotency_key`. The predicate is the source of the operation identity; a mismatched top-level key fails closed.
- Predicate fields must use `ObservedRef<T>`; missing optional fields must not mean "unchecked."
- Actor identity and scope must come from signed/authenticated request context via `actorContextFromHeaders` or an equivalent server-side context. Request bodies must not carry trusted actor identity.
- Same `operation_idempotency_key` plus identical predicate/reason/operation/session returns the original `SessionRecoveryRecord`.
- Same `operation_idempotency_key` with any different predicate, reason, operation, or target session fails closed as an idempotency conflict.
- Public Plan Item diagnostics must redact worker session digests, idempotency keys, runtime internals, full capsule digests, candidate predicates, raw thread ids, raw filesystem paths, and secret material.
- Operator dashboard projections may include safe operational metadata and candidate predicates for authorized operators only.
- ObjectEvent payloads must include only public-safe redacted predicate summaries, not full predicates.
- A recovered session must remain durably `recovered` until a separate authorized human product action clears or advances it. A later health rebuild must not silently recalculate the row as `healthy` and re-enable continue/fork/archive.
- Do not add compatibility aliases for retired route names or execution starts.
- Use TDD. Write the failing test before implementation for each behavior.

## Task 1: Contracts And DTO Boundaries

**Files:**
- Create: `packages/contracts/src/session-operations.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `tests/contracts/session-operations.test.ts`

- [ ] **Step 1: Write failing contract tests for health state and ObservedRef semantics**

Create `tests/contracts/session-operations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  observedAbsentSchema,
  observedPresentSchema,
  scavengeSessionOperationsRequestSchema,
  sessionOperationsHealthQuerySchema,
  sessionRecoveryCandidatePredicateSchema,
  planItemSessionHealthStateSchema,
} from '@forgeloop/contracts';
import { z } from 'zod';

describe('session operations contracts', () => {
  it('requires explicit observed absent refs instead of missing unchecked fields', () => {
    expect(observedAbsentSchema.parse({ checked: true, state: 'absent' })).toEqual({
      checked: true,
      state: 'absent',
    });

    expect(() => observedPresentSchema({ id: z.string() }).parse({ checked: true, state: 'absent' })).toThrow();
  });

  it('accepts every product health state', () => {
    for (const state of [
      'healthy',
      'attention_needed',
      'blocked_stale_lease',
      'blocked_orphaned_action',
      'blocked_missing_capsule',
      'blocked_lineage_conflict',
      'recovered',
      'unrecoverable',
    ]) {
      expect(planItemSessionHealthStateSchema.parse(state)).toBe(state);
    }
  });

  it('requires full fencing material for recovery predicates', () => {
    expect(() =>
      sessionRecoveryCandidatePredicateSchema.parse({
        codex_session_id: 'session-1',
        workflow_id: 'workflow-1',
        expected_health_state: 'blocked_stale_lease',
        operation_idempotency_key: 'recover-session-1-stale-lease',
        projection_digest: `sha256:${'a'.repeat(64)}`,
        workflow: {
          id: 'workflow-1',
          status: 'execution_running',
          updated_at: '2026-06-09T00:00:00.000Z',
          active_codex_session_id: 'session-1',
          active_boundary_summary_revision_id: null,
          active_spec_doc_revision_id: null,
          active_implementation_plan_doc_revision_id: null,
          execution_package_id: null,
        },
        session: {
          id: 'session-1',
          status: 'active',
          role: 'active',
          updated_at: '2026-06-09T00:00:00.000Z',
          active_lease_id: 'lease-1',
          lease_epoch: 3,
          runner_worker_id: null,
          runner_launch_lease_id: null,
          runner_runtime_job_id: null,
          runner_expires_at: null,
          latest_turn_id: null,
          latest_capsule_id: null,
          latest_capsule_digest: null,
        },
        active_lease: {
          checked: true,
          state: 'present',
          id: 'lease-1',
          status: 'active',
          lease_epoch: 3,
          worker_id: 'worker-1',
          worker_session_digest: `sha256:${'b'.repeat(64)}`,
          heartbeat_at: '2026-06-09T00:01:00.000Z',
          expires_at: '2026-06-09T00:02:00.000Z',
          updated_at: '2026-06-09T00:01:00.000Z',
        },
        pending_queued_action: { checked: true, state: 'absent' },
        latest_turn: { checked: true, state: 'absent' },
        runtime_job: { checked: true, state: 'absent' },
        run_session: { checked: true, state: 'absent' },
        latest_capsule: { checked: true, state: 'absent' },
        observed_at: '2026-06-09T00:03:00.000Z',
      }),
    ).not.toThrow();
  });

  it('requires reason and idempotency prefix for scavenge execute requests', () => {
    expect(() =>
      scavengeSessionOperationsRequestSchema.parse({
        mode: 'execute',
        confirm_execute: true,
      }),
    ).toThrow(/reason/);

    expect(() =>
      scavengeSessionOperationsRequestSchema.parse({
        mode: 'execute',
        confirm_execute: true,
        reason: 'Operator-approved scavenge.',
      }),
    ).toThrow(/operation_idempotency_key_prefix/);
  });

  it('requires confirmation and explicit candidates for scavenge execute requests', () => {
    expect(() =>
      scavengeSessionOperationsRequestSchema.parse({
        mode: 'execute',
        reason: 'Operator-approved scavenge.',
        operation_idempotency_key_prefix: 'scavenge-test',
      }),
    ).toThrow(/confirm_execute/);

    expect(() =>
      scavengeSessionOperationsRequestSchema.parse({
        mode: 'execute',
        confirm_execute: true,
        reason: 'Operator-approved scavenge.',
        operation_idempotency_key_prefix: 'scavenge-test',
      }),
    ).toThrow(/candidates/);
  });

  it('parses operator health query filters', () => {
    expect(
      sessionOperationsHealthQuerySchema.parse({
        state: 'blocked_stale_lease',
        severity: 'blocked',
        development_plan_item_id: 'item-1',
        limit: '50',
      }),
    ).toEqual({
      state: 'blocked_stale_lease',
      severity: 'blocked',
      development_plan_item_id: 'item-1',
      limit: 50,
    });
  });
});
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run: `pnpm vitest run tests/contracts/session-operations.test.ts`

Expected: FAIL because `packages/contracts/src/session-operations.ts` does not exist or schemas are not exported.

- [ ] **Step 3: Implement contract schemas and exports**

Create `packages/contracts/src/session-operations.ts` with:

```ts
import { z } from 'zod';

export const planItemSessionHealthStateSchema = z.enum([
  'healthy',
  'attention_needed',
  'blocked_stale_lease',
  'blocked_orphaned_action',
  'blocked_missing_capsule',
  'blocked_lineage_conflict',
  'recovered',
  'unrecoverable',
]);

export const planItemSessionHealthSeveritySchema = z.enum(['none', 'info', 'warning', 'blocked', 'critical']);

export const observedAbsentSchema = z.object({
  checked: z.literal(true),
  state: z.literal('absent'),
});

export const observedPresentSchema = <T extends z.ZodRawShape>(shape: T) =>
  z.object({
    checked: z.literal(true),
    state: z.literal('present'),
    ...shape,
  });

export const observedRefSchema = <T extends z.ZodRawShape>(shape: T) =>
  z.discriminatedUnion('state', [observedAbsentSchema, observedPresentSchema(shape)]);
```

Continue in the same file with schemas for:

- `capsuleRetentionPinSchema`
- `sessionRecoveryCandidatePredicateSchema`
- `operatorSessionHealthProjectionSchema`
- `sessionOperationsHealthResponseSchema`
- `planItemSessionDiagnosticsSchema`
- `recoverSessionRequestSchema`
- `recoverSessionResponseSchema`
- `scavengeSessionOperationsRequestSchema`
- `scavengeSessionOperationsResponseSchema`
- `sessionRecoveryRecordDtoSchema`
- `sessionOperationsAuditResponseSchema`
- `sessionOperationsHealthQuerySchema`

Use three distinct DTO surfaces:

```ts
export const planItemSessionDiagnosticsSchema = z.object({
  plan_item_id: z.string(),
  workflow_resolution: z.enum(['active_workflow', 'no_active_workflow', 'ambiguous_workflows']),
  workflow_id: z.string().optional(),
  codex_session_id: z.string().optional(),
  state: planItemSessionHealthStateSchema.optional(),
  severity: planItemSessionHealthSeveritySchema.optional(),
  summary: z.string(),
  operator_intervention_required: z.boolean(),
  normal_workflow_actions_available: z.boolean(),
  latest_checkpoint: z
    .object({
      object_type: z.string(),
      object_id: z.string(),
      digest_prefix: z.string().optional(),
      pin_source: z.string().optional(),
    })
    .optional(),
  recovery_request_available: z.boolean(),
});

export const recoverSessionRequestSchema = z.object({
  operation_idempotency_key: z.string().min(1),
  operation: z.enum(['recover', 'mark_unrecoverable']),
  reason: z.string().min(1),
  candidate_predicate: sessionRecoveryCandidatePredicateSchema,
});

export const sessionOperationsHealthResponseSchema = z.object({
  items: z.array(operatorSessionHealthProjectionSchema),
  filters: z.record(z.string(), z.unknown()).default({}),
});

export const sessionRecoveryRecordDtoSchema = z.object({
  id: z.string(),
  operation_idempotency_key: z.string(),
  operation: z.enum(['recover', 'scavenge', 'mark_unrecoverable']),
  actor_id: z.string(),
  reason: z.string(),
  before_state: planItemSessionHealthStateSchema,
  after_state: planItemSessionHealthStateSchema,
  before_projection_digest: z.string(),
  after_projection_digest: z.string(),
  affected_lease_ids: z.array(z.string()).default([]),
  affected_queued_action_ids: z.array(z.string()).default([]),
  affected_turn_ids: z.array(z.string()).default([]),
  affected_runtime_job_ids: z.array(z.string()).default([]),
  affected_run_session_ids: z.array(z.string()).default([]),
  affected_capsule_ids: z.array(z.string()).default([]),
  predicate_summary: z.object({
    expected_health_state: planItemSessionHealthStateSchema,
    projection_digest: z.string(),
    workflow_id: z.string(),
    codex_session_id: z.string(),
  }),
  result: z.enum(['applied', 'skipped', 'blocked']),
  result_code: z.string(),
  object_event_id: z.string().optional(),
  created_at: z.string(),
});

export const sessionOperationsAuditResponseSchema = z.object({
  items: z.array(sessionRecoveryRecordDtoSchema),
});

export const sessionOperationsHealthQuerySchema = z.object({
  state: planItemSessionHealthStateSchema.optional(),
  severity: planItemSessionHealthSeveritySchema.optional(),
  development_plan_item_id: z.string().optional(),
  workflow_id: z.string().optional(),
  codex_session_id: z.string().optional(),
  limit: z.coerce.number().int().positive().max(250).optional(),
});

export const recoverSessionResponseSchema = z.object({
  record: sessionRecoveryRecordDtoSchema,
  before: operatorSessionHealthProjectionSchema,
  after: operatorSessionHealthProjectionSchema,
  replayed: z.boolean().default(false),
});

export const scavengeSessionOperationsRequestSchema = z.object({
  mode: z.enum(['dry_run', 'execute']).default('dry_run'),
  confirm_execute: z.boolean().optional(),
  reason: z.string().min(1).optional(),
  operation_idempotency_key_prefix: z.string().min(1).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  candidates: z
    .array(z.object({ codex_session_id: z.string(), candidate_predicate: sessionRecoveryCandidatePredicateSchema }))
    .optional(),
}).superRefine((value, ctx) => {
  if (value.mode !== 'execute') {
    return;
  }

  if (value.confirm_execute !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['confirm_execute'],
      message: 'confirm_execute is required when mode is execute',
    });
  }

  if (value.reason === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reason'],
      message: 'reason is required when mode is execute',
    });
  }

  if (value.operation_idempotency_key_prefix === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['operation_idempotency_key_prefix'],
      message: 'operation_idempotency_key_prefix is required when mode is execute',
    });
  }

  if (value.candidates === undefined || value.candidates.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['candidates'],
      message: 'candidates are required when mode is execute',
    });
  }
});

export const scavengeSessionOperationsResponseSchema = z.object({
  mode: z.enum(['dry_run', 'execute']),
  candidates: z.array(operatorSessionHealthProjectionSchema).optional(),
  results: z.array(sessionRecoveryRecordDtoSchema).optional(),
});

export type PlanItemSessionHealthState = z.infer<typeof planItemSessionHealthStateSchema>;
export type PlanItemSessionHealthSeverity = z.infer<typeof planItemSessionHealthSeveritySchema>;
export type CapsuleRetentionPin = z.infer<typeof capsuleRetentionPinSchema>;
export type SessionRecoveryCandidatePredicate = z.infer<typeof sessionRecoveryCandidatePredicateSchema>;
export type OperatorSessionHealthProjection = z.infer<typeof operatorSessionHealthProjectionSchema>;
export type SessionOperationsHealthQuery = z.infer<typeof sessionOperationsHealthQuerySchema>;
export type SessionOperationsHealthResponse = z.infer<typeof sessionOperationsHealthResponseSchema>;
export type SessionOperationsAuditResponse = z.infer<typeof sessionOperationsAuditResponseSchema>;
export type PlanItemSessionDiagnostics = z.infer<typeof planItemSessionDiagnosticsSchema>;
export type RecoverSessionRequest = z.infer<typeof recoverSessionRequestSchema>;
export type RecoverSessionResponse = z.infer<typeof recoverSessionResponseSchema>;
export type ScavengeSessionOperationsRequest = z.infer<typeof scavengeSessionOperationsRequestSchema>;
export type ScavengeSessionOperationsResponse = z.infer<typeof scavengeSessionOperationsResponseSchema>;
export type SessionRecoveryRecordDto = z.infer<typeof sessionRecoveryRecordDtoSchema>;
```

Modify `packages/contracts/src/index.ts`:

```ts
export * from './session-operations.js';
```

- [ ] **Step 4: Run contracts test to verify it passes**

Run: `pnpm vitest run tests/contracts/session-operations.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/session-operations.ts packages/contracts/src/index.ts tests/contracts/session-operations.test.ts
git commit -m "feat: add session operations contracts"
```

## Task 2: Domain Projection, Predicate, Redaction, And Idempotency Helpers

**Files:**
- Create: `packages/domain/src/session-operations.ts`
- Modify: `packages/domain/src/types.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `tests/domain/session-operations.test.ts`

- [ ] **Step 1: Write failing domain tests for projection states**

Add tests to `tests/domain/session-operations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildSessionHealthProjection,
  buildCapsuleRetentionPins,
  redactPlanItemSessionDiagnostics,
  recoveryRequestMatchesExistingRecord,
  sessionRecoveryProjectionDigest,
} from '@forgeloop/domain';

const baseInput = {
  workflow: {
    id: 'workflow-1',
    development_plan_id: 'plan-1',
    development_plan_item_id: 'item-1',
    status: 'execution_running',
    active_codex_session_id: 'session-1',
    updated_at: '2026-06-09T00:00:00.000Z',
  },
  session: {
    id: 'session-1',
    status: 'active',
    role: 'active',
    active_lease_id: undefined,
    lease_epoch: 1,
    latest_capsule_id: 'capsule-1',
    latest_capsule_digest: `sha256:${'a'.repeat(64)}`,
    updated_at: '2026-06-09T00:00:00.000Z',
  },
  active_lease: undefined,
  pending_queued_action: undefined,
  latest_turn: undefined,
  runtime_job: undefined,
  run_session: undefined,
  latest_capsule: {
    id: 'capsule-1',
    digest: `sha256:${'a'.repeat(64)}`,
    sequence: 2,
    created_from_turn_id: 'turn-1',
    created_at: '2026-06-09T00:00:00.000Z',
  },
  retention_pins: [],
  checked_at: '2026-06-09T00:05:00.000Z',
};

describe('session operations domain', () => {
  it('projects healthy state when workflow, session, capsule, and no active blocker agree', () => {
    const projection = buildSessionHealthProjection(baseInput);
    expect(projection.state).toBe('healthy');
    expect(projection.recovery_available).toBe(false);
  });

  it('projects blocked stale lease and candidate predicate when active lease is expired', () => {
    const projection = buildSessionHealthProjection({
      ...baseInput,
      session: { ...baseInput.session, active_lease_id: 'lease-1', lease_epoch: 2 },
      active_lease: {
        id: 'lease-1',
        status: 'active',
        lease_epoch: 2,
        worker_id: 'worker-1',
        worker_session_digest: `sha256:${'b'.repeat(64)}`,
        heartbeat_at: '2026-06-09T00:01:00.000Z',
        expires_at: '2026-06-09T00:02:00.000Z',
        updated_at: '2026-06-09T00:01:00.000Z',
      },
    });

    expect(projection.state).toBe('blocked_stale_lease');
    expect(projection.recovery_available).toBe(true);
    expect(projection.candidate_predicate?.active_lease.state).toBe('present');
  });

  it('projects attention_needed for non-blocking diagnostic lag', () => {
    const projection = buildSessionHealthProjection({
      ...baseInput,
      checked_at: '2026-06-09T01:00:00.000Z',
      stale_projection_reason: 'capsule_sync_lag',
    });

    expect(projection.state).toBe('attention_needed');
    expect(projection.recovery_available).toBe(false);
    expect(projection.operator_intervention_required).toBe(false);
  });

  it('derives per-capsule retention pins for active, checkpoint, recovery, and audit references', () => {
    const pins = buildCapsuleRetentionPins({
      active_session: {
        session_id: 'session-1',
        latest_capsule_id: 'capsule-active',
        latest_capsule_digest: `sha256:${'a'.repeat(64)}`,
      },
      product_checkpoints: [
        {
          object_type: 'implementation_plan_revision',
          object_id: 'plan-revision-1',
          capsule_id: 'capsule-plan',
          capsule_digest: `sha256:${'b'.repeat(64)}`,
          pin_reason: 'implementation_plan_doc',
        },
      ],
      recovery_records: [
        {
          object_id: 'recovery-1',
          capsule_id: 'capsule-recovery',
          capsule_digest: `sha256:${'c'.repeat(64)}`,
        },
      ],
      object_events: [
        {
          object_id: 'event-1',
          capsule_id: 'capsule-audit',
          capsule_digest: `sha256:${'d'.repeat(64)}`,
        },
      ],
      unrecoverable_evidence: [
        {
          object_id: 'unrecoverable-1',
          capsule_id: 'capsule-missing',
          capsule_digest: `sha256:${'e'.repeat(64)}`,
        },
      ],
      checked_at: '2026-06-09T00:05:00.000Z',
    });

    expect(pins.map((pin) => pin.pin_reasons).flat()).toEqual(
      expect.arrayContaining([
        'active_session_latest',
        'implementation_plan_doc',
        'recovery_record',
        'object_event',
        'unrecoverable_evidence',
      ]),
    );
  });

  it('redacts public diagnostics', () => {
    const projection = buildSessionHealthProjection({
      ...baseInput,
      session: {
        ...baseInput.session,
        latest_capsule_digest: `sha256:${'c'.repeat(64)}`,
      },
    });

    const publicDto = redactPlanItemSessionDiagnostics(projection);
    expect(JSON.stringify(publicDto)).not.toContain('candidate_predicate');
    expect(JSON.stringify(publicDto)).not.toContain('worker_session_digest');
    expect(JSON.stringify(publicDto)).not.toContain(`sha256:${'c'.repeat(64)}`);
  });

  it('detects idempotency conflicts instead of replaying different predicates', () => {
    const digest = sessionRecoveryProjectionDigest({ one: true });
    expect(
      recoveryRequestMatchesExistingRecord(
        {
          operation_idempotency_key: 'recover-1',
          operation: 'recover',
          reason: 'Release stale lease.',
          predicate_digest: digest,
          codex_session_id: 'session-1',
        },
        {
          operation_idempotency_key: 'recover-1',
          operation: 'recover',
          reason: 'Different reason.',
          predicate_digest: digest,
          codex_session_id: 'session-1',
        },
      ),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run domain test to verify it fails**

Run: `pnpm vitest run tests/domain/session-operations.test.ts`

Expected: FAIL because domain helpers are missing.

- [ ] **Step 3: Implement domain types and projection helpers**

Create `packages/domain/src/session-operations.ts` with:

```ts
import { createHash } from 'node:crypto';
import type {
  PlanItemSessionHealthState,
  SessionRecoveryCandidatePredicate,
} from '@forgeloop/contracts';
import { codexCanonicalDigest } from './codex-runtime.js';
import { DomainError, type IsoDateTime } from './types.js';

export const sessionRecoveryProjectionDigest = (value: unknown): string => codexCanonicalDigest(value);

export interface BuildSessionHealthProjectionInput {
  workflow: {
    id: string;
    development_plan_id: string;
    development_plan_item_id: string;
    status: string;
    active_codex_session_id?: string;
    updated_at: IsoDateTime;
    active_boundary_summary_revision_id?: string;
    active_spec_doc_revision_id?: string;
    active_implementation_plan_doc_revision_id?: string;
    execution_package_id?: string;
  };
  session?: {
    id: string;
    status: string;
    role: string;
    active_lease_id?: string;
    lease_epoch: number;
    runner_worker_id?: string;
    runner_launch_lease_id?: string;
    runner_runtime_job_id?: string;
    runner_expires_at?: IsoDateTime;
    latest_turn_id?: string;
    latest_capsule_id?: string;
    latest_capsule_digest?: string;
    updated_at: IsoDateTime;
  };
  active_lease?: SessionHealthLeaseRef;
  pending_queued_action?: SessionHealthQueuedActionRef;
  latest_turn?: SessionHealthTurnRef;
  runtime_job?: SessionHealthRuntimeJobRef;
  run_session?: SessionHealthRunSessionRef;
  latest_capsule?: SessionHealthCapsuleRef;
  retention_pins: CapsuleRetentionPin[];
  stale_projection_reason?: 'capsule_sync_lag' | 'missing_optional_diagnostic_metadata' | 'stale_projection_timestamp';
  checked_at: IsoDateTime;
}
```

Implement:

- `buildSessionHealthProjection(input)`
- `buildCapsuleRetentionPins(input)`
- `buildSessionRecoveryCandidatePredicate(input, state, projectionDigest)`
- `redactPlanItemSessionDiagnostics(projection)`
- `redactOperatorSessionHealthProjection(projection)`
- `assertRecoveryPredicateStillMatches(currentProjection, predicate)`
- `recoveryRequestMatchesExistingRecord(existing, incoming)`
- `assertRecoveryIdempotencyNotConflicting(existing, incoming)`
- `capsuleDigestPrefix(digest)`

Projection priority should be fail-closed:

```ts
const deriveState = (input: BuildSessionHealthProjectionInput): PlanItemSessionHealthState => {
  if (input.session === undefined || input.workflow.active_codex_session_id !== input.session.id) return 'blocked_lineage_conflict';
  if (input.session.latest_capsule_id !== undefined && input.latest_capsule === undefined) return 'blocked_missing_capsule';
  if (
    input.latest_capsule !== undefined &&
    input.session.latest_capsule_digest !== undefined &&
    input.latest_capsule.digest !== input.session.latest_capsule_digest
  ) {
    return 'blocked_missing_capsule';
  }
  if (input.active_lease !== undefined && Date.parse(input.active_lease.expires_at) <= Date.parse(input.checked_at)) {
    return 'blocked_stale_lease';
  }
  if (input.pending_queued_action !== undefined && input.active_lease === undefined) return 'blocked_orphaned_action';
  if (input.runtime_job !== undefined && input.run_session === undefined) return 'blocked_orphaned_action';
  if (input.stale_projection_reason !== undefined) return 'attention_needed';
  return 'healthy';
};
```

`buildCapsuleRetentionPins(input)` must derive pins from product references, not merely echo already-stored rows:

- active session latest capsule -> `active_session_latest`;
- future fork point metadata when present -> `fork_point`;
- approved Brainstorming boundary checkpoint -> `brainstorming_boundary`;
- committed Spec revision checkpoint -> `spec_doc`;
- committed Implementation Plan revision checkpoint -> `implementation_plan_doc`;
- execution/review checkpoint references -> `execution_checkpoint` / `review_checkpoint`;
- workflow transition evidence that references a capsule -> `workflow_transition`;
- recovery record affected capsules -> `recovery_record`;
- ObjectEvent affected capsules -> `object_event`;
- unrecoverable evidence -> `unrecoverable_evidence`.

The function should merge duplicate capsule references into one `CapsuleRetentionPin` per capsule/digest and aggregate `pin_reasons` plus `referenced_by`. Unknown or inconsistent input should produce `pin_state: 'unknown'` and set health `retention_risk = true`, not silently mark the capsule cleanable.

Modify `packages/domain/src/types.ts` to add domain error codes:

```ts
| 'session_operations_unauthorized'
| 'session_operations_no_active_workflow'
| 'session_operations_ambiguous_workflow'
| 'session_operations_stale_candidate'
| 'session_operations_idempotency_conflict'
| 'session_operations_unsupported_operation'
| 'session_operations_control_only_violation'
```

Modify `packages/domain/src/index.ts`:

```ts
export * from './session-operations.js';
```

- [ ] **Step 4: Run domain test to verify it passes**

Run: `pnpm vitest run tests/domain/session-operations.test.ts`

Expected: PASS.

- [ ] **Step 5: Run focused contract/domain tests**

Run: `pnpm vitest run tests/contracts/session-operations.test.ts tests/domain/session-operations.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/session-operations.ts packages/domain/src/types.ts packages/domain/src/index.ts tests/domain/session-operations.test.ts
git commit -m "feat: derive session operations health"
```

## Task 3: Persistence For Health, Recovery Records, And Retention Pins

**Files:**
- Modify: `packages/db/src/schema/plan-item-workflow.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/migrations/0006_session_operations_recovery_ops_foundation.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Create: `packages/db/migrations/meta/0006_snapshot.json`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Create: `tests/db/session-operations-repository.test.ts`
- Modify: `tests/db/schema.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create `tests/db/session-operations-repository.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  InMemoryDeliveryRepository,
  type DeliveryRepository,
} from '../../packages/db/src/index';

function runSessionOperationsRepositoryExamples(name: string, createRepository: () => DeliveryRepository): void {
  describe(name, () => {
    it('upserts one health projection per workflow/session', async () => {
      const repository = createRepository();
      const health = sessionHealthFixture({ state: 'blocked_stale_lease' });

      await repository.upsertPlanItemSessionHealth(health);
      await repository.upsertPlanItemSessionHealth({
        ...health,
        summary: 'Still stale.',
        checked_at: '2026-06-09T00:10:00.000Z',
      });

      const rows = await repository.listPlanItemSessionHealth({ workflow_id: health.workflow_id });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.summary).toBe('Still stale.');
    });

    it('replays identical recovery records and rejects idempotency conflicts', async () => {
      const repository = createRepository();
      const record = recoveryRecordFixture({ operation_idempotency_key: 'recover-stale-lease-1' });

      await repository.createOrReplaySessionRecoveryRecord(record);
      const replay = await repository.createOrReplaySessionRecoveryRecord(record);
      expect(replay.replayed).toBe(true);

      await expect(
        repository.createOrReplaySessionRecoveryRecord({
          ...record,
          reason: 'Different reason.',
        }),
      ).rejects.toThrow(/idempotency/i);
    });

    it('stores per-capsule retention pins', async () => {
      const repository = createRepository();
      await repository.upsertCapsuleRetentionPins([
        {
          capsule_id: 'capsule-1',
          capsule_digest: `sha256:${'a'.repeat(64)}`,
          pin_state: 'pinned',
          pin_reasons: ['active_session_latest'],
          referenced_by: [{ object_type: 'codex_session', object_id: 'session-1', relation: 'latest_capsule' }],
          checked_at: '2026-06-09T00:00:00.000Z',
        },
      ]);

      const pins = await repository.listCapsuleRetentionPins({ capsule_id: 'capsule-1' });
      expect(pins[0]?.pin_reasons).toContain('active_session_latest');
    });
  });
}

runSessionOperationsRepositoryExamples('Session operations repository in-memory adapter', () => new InMemoryDeliveryRepository());
```

Use local fixture helpers in the same test file. Keep IDs UUID-shaped if the repository contract expects Postgres UUIDs.

- [ ] **Step 2: Run repository test to verify it fails**

Run: `pnpm vitest run tests/db/session-operations-repository.test.ts`

Expected: FAIL because repository methods and schema do not exist.

- [ ] **Step 3: Add schema tables**

Modify `packages/db/src/schema/plan-item-workflow.ts`:

```ts
export const plan_item_session_health = pgTable(
  'plan_item_session_health',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id').notNull().references(() => plan_item_workflows.id),
    developmentPlanItemId: uuid('development_plan_item_id').notNull().references(() => development_plan_items.id),
    codexSessionId: uuid('codex_session_id').notNull().references(() => codex_sessions.id),
    state: text('state').$type<PlanItemSessionHealth['state']>().notNull(),
    severity: text('severity').$type<PlanItemSessionHealth['severity']>().notNull(),
    reasonCode: text('reason_code'),
    summary: text('summary').notNull(),
    projectionDigest: text('projection_digest').notNull(),
    candidatePredicate: jsonb('candidate_predicate').$type<PlanItemSessionHealth['candidate_predicate']>(),
    safeProjectionJson: jsonb('safe_projection_json').$type<Record<string, unknown>>().notNull(),
    checkedAt: timestampColumn('checked_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('plan_item_session_health_workflow_session_idx').on(table.workflowId, table.codexSessionId),
    index('plan_item_session_health_state_idx').on(table.state, table.severity),
    index('plan_item_session_health_item_idx').on(table.developmentPlanItemId),
  ],
);
```

Add:

- `session_recovery_records`
  - unique index on `operation_idempotency_key`
  - indexes on `workflow_id`, `codex_session_id`, and `created_at`
  - JSONB full `candidate_predicate`
- `capsule_retention_pins`
  - unique index on `capsule_id`, `object_type`, `object_id`, `relation`
  - JSONB `pin_reasons` and `referenced_by`

Use type imports from `@forgeloop/domain`.

- [ ] **Step 4: Generate and inspect the Drizzle migration**

Run: `pnpm db:generate`

Expected:

- A new SQL migration appears under `packages/db/migrations/`.
- `packages/db/migrations/meta/_journal.json` is updated.
- A new or updated snapshot appears under `packages/db/migrations/meta/`.

Inspect the generated SQL before continuing:

```bash
git diff -- packages/db/migrations packages/db/migrations/meta/_journal.json
```

Expected migration content:

- creates `plan_item_session_health`;
- creates `session_recovery_records`;
- creates `capsule_retention_pins`;
- creates the unique idempotency index on `session_recovery_records.operation_idempotency_key`;
- creates the health lookup/indexes used by dashboard filters;
- creates the retention pin uniqueness constraint by capsule/reference relation;
- does not drop or rewrite existing Wave 2-7 workflow/session/runtime tables.

If `pnpm db:generate` produces unrelated churn, stop and inspect current schema drift before editing the migration by hand.

- [ ] **Step 5: Add repository interface methods**

Modify `packages/db/src/repositories/delivery-repository.ts` with domain-facing methods:

```ts
upsertPlanItemSessionHealth(health: PlanItemSessionHealth): Promise<PlanItemSessionHealth>;
getPlanItemSessionHealth(input: { workflow_id: string; codex_session_id: string }): Promise<PlanItemSessionHealth | undefined>;
listPlanItemSessionHealth(query: ListPlanItemSessionHealthQuery): Promise<PlanItemSessionHealth[]>;
createOrReplaySessionRecoveryRecord(
  record: SessionRecoveryRecord,
): Promise<{ record: SessionRecoveryRecord; replayed: boolean }>;
listSessionRecoveryRecords(query: ListSessionRecoveryRecordsQuery): Promise<SessionRecoveryRecord[]>;
upsertCapsuleRetentionPins(pins: readonly CapsuleRetentionPinRecord[]): Promise<void>;
listCapsuleRetentionPins(query: ListCapsuleRetentionPinsQuery): Promise<CapsuleRetentionPinRecord[]>;
```

- [ ] **Step 6: Implement in-memory repository**

Modify `packages/db/src/repositories/in-memory-delivery-repository.ts`:

- Store health rows by `${workflow_id}:${codex_session_id}`.
- Store recovery records by `id` and by `operation_idempotency_key`.
- On `createOrReplaySessionRecoveryRecord`, compare the existing record's operation/session/reason/predicate digest/result target fields.
- Throw `DomainError('session_operations_idempotency_conflict', ...)` for conflicts.
- Store retention pins by capsule and reference relation.
- Do not let callers hand-author arbitrary retention classification. Repository writes should persist pins produced by `buildCapsuleRetentionPins`; service code owns the source data used to derive them.

- [ ] **Step 7: Implement Drizzle repository**

Modify `packages/db/src/repositories/drizzle-delivery-repository.ts`:

- Add row mappers for the three tables.
- Implement `upsertPlanItemSessionHealth` with `onConflictDoUpdate`.
- Implement `createOrReplaySessionRecoveryRecord` transactionally:
  - query by idempotency key first;
  - return replay when identical;
  - throw on conflict;
  - insert otherwise.
- Implement retention pin upsert with unique relation key.
- Ensure `upsertPlanItemSessionHealth` and `upsertCapsuleRetentionPins` can run in the same service flow after projection rebuild so the dashboard reads a consistent health/pin snapshot.

- [ ] **Step 8: Add schema and migration tests**

Modify `tests/db/schema.test.ts` to assert:

- new table exports and indexes exist;
- the latest generated SQL migration contains the three new table names;
- the migration journal includes the new migration entry.

- [ ] **Step 9: Run repository and schema tests**

Run: `pnpm vitest run tests/db/session-operations-repository.test.ts tests/db/schema.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/db/src/schema/plan-item-workflow.ts packages/db/src/schema/index.ts packages/db/migrations packages/db/src/repositories/delivery-repository.ts packages/db/src/repositories/in-memory-delivery-repository.ts packages/db/src/repositories/drizzle-delivery-repository.ts tests/db/session-operations-repository.test.ts tests/db/schema.test.ts
git commit -m "feat: persist session operations records"
```

## Task 4: Session Operations API And Control-Only Recovery

**Files:**
- Create: `apps/control-plane-api/src/modules/session-operations/session-operations.dto.ts`
- Create: `apps/control-plane-api/src/modules/session-operations/session-operations.service.ts`
- Create: `apps/control-plane-api/src/modules/session-operations/session-operations.controller.ts`
- Create: `apps/control-plane-api/src/modules/session-operations/session-operations.module.ts`
- Modify: `apps/control-plane-api/src/app.module.ts`
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflows.module.ts` if export wiring is required
- Create: `tests/api/session-operations.test.ts`
- Create: `tests/helpers/session-operations-fixtures.ts`

- [ ] **Step 1: Write failing API tests for diagnostics resolution and redaction**

Create `tests/api/session-operations.test.ts`:

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { actorHeaderName, actorClassHeaderName } from '../../apps/control-plane-api/src/modules/auth/actor-context';
import { createTestApp } from './test-app';
import { seedDevelopmentPlanItem, startWorkflow } from '../helpers/plan-item-workflow-fixtures';

const signedHumanHeaders = (actorId: string) => ({
  [actorHeaderName]: actorId,
  [actorClassHeaderName]: 'human_admin',
});

const signedDeveloperHeaders = (actorId: string) => ({
  [actorHeaderName]: actorId,
  [actorClassHeaderName]: 'human',
});

describe('session operations API', () => {
  it('returns public Plan Item diagnostics without raw recovery predicate', async () => {
    const app = await createTestApp();
    const seeded = await seedDevelopmentPlanItem(app, { idPrefix: '88888881' });
    await startWorkflow(app, seeded.plan.id, seeded.item.id);

    const response = await request(app.getHttpServer())
      .get(`/plan-items/${seeded.item.id}/session-diagnostics`)
      .set(signedHumanHeaders(seeded.ids.actorTech))
      .expect(200);

    expect(response.body.workflow_resolution).toBe('active_workflow');
    expect(JSON.stringify(response.body)).not.toContain('candidate_predicate');
    expect(JSON.stringify(response.body)).not.toContain('worker_session_digest');
    expect(JSON.stringify(response.body)).not.toContain('codex_thread_id');
  });

  it('fails closed when Plan Item workflow resolution is ambiguous', async () => {
    const app = await createTestApp();
    const seeded = await seedDevelopmentPlanItem(app, { idPrefix: '88888882' });
    await startWorkflow(app, seeded.plan.id, seeded.item.id);
    // Insert a second non-archived workflow directly through repository to simulate corrupted state.

    await request(app.getHttpServer())
      .get(`/plan-items/${seeded.item.id}/session-diagnostics`)
      .set(signedHumanHeaders(seeded.ids.actorTech))
      .expect(409);
  });

  it('lists operator health projections with safe candidate metadata', async () => {
    const { app, sessionId, actorId } = await seedBlockedStaleLeaseCandidate('88888896');

    const response = await request(app.getHttpServer())
      .get('/session-operations/health?state=blocked_stale_lease')
      .set(signedHumanHeaders(actorId))
      .expect(200);

    expect(response.body.items.some((item) => item.codex_session_id === sessionId)).toBe(true);
    expect(response.body.items[0].candidate_predicate).toBeDefined();
    expect(JSON.stringify(response.body)).not.toContain('codex_thread_id');
    expect(JSON.stringify(response.body)).not.toContain('lease_token');
  });

  it('lists safe recovery audit records for an operator-scoped session', async () => {
    const { app, sessionId, predicate, actorId } = await seedBlockedStaleLeaseCandidate('88888897');
    await request(app.getHttpServer())
      .post(`/session-operations/${sessionId}/recover`)
      .set(signedHumanHeaders(actorId))
      .send({
        operation_idempotency_key: predicate.operation_idempotency_key,
        operation: 'recover',
        reason: 'Release stale worker lease after heartbeat expiry.',
        candidate_predicate: predicate,
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get(`/session-operations/${sessionId}/audit`)
      .set(signedHumanHeaders(actorId))
      .expect(200);

    expect(response.body.items[0].result).toBe('applied');
    expect(response.body.items[0].predicate_summary).toBeDefined();
    expect(JSON.stringify(response.body)).not.toContain('candidate_predicate');
    expect(JSON.stringify(response.body)).not.toContain('worker_session_digest');
  });
});
```

- [ ] **Step 2: Create session operations API fixture helpers**

Create `tests/helpers/session-operations-fixtures.ts`.

Use `seedDevelopmentPlanItem`, `startWorkflow`, and `idsFor` from `tests/helpers/plan-item-workflow-fixtures.ts` as the base. The helpers must return already-built `candidate_predicate` values by calling the same public service route or domain builder that production uses; do not hand-type predicates in every test.

Required helpers:

```ts
export async function seedBlockedStaleLeaseCandidate(idPrefix: string) {
  return seedBlockedStaleLeaseCandidateInApp(await createTestApp(), idPrefix);
}

export async function seedBlockedStaleLeaseCandidateInApp(app: INestApplication, idPrefix: string) {
  const seeded = await seedDevelopmentPlanItem(app, { idPrefix });
  const workflow = await startWorkflow(app, seeded.plan.id, seeded.item.id);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const sessionId = workflow.active_codex_session_id;

  await repository.claimCodexSessionLease({
    session_id: sessionId,
    worker_id: seeded.ids.actorDelegate,
    worker_session_digest: `sha256:${'b'.repeat(64)}`,
    lease_token_hash: `sha256:${'1'.repeat(64)}`,
    now: '2026-06-09T00:00:00.000Z',
    expires_at: '2026-06-09T00:01:00.000Z',
  });

  const health = await buildFreshOperatorHealthCandidate(app, sessionId, seeded.ids.actorTech, '2026-06-09T00:05:00.000Z');
  return {
    app,
    repository,
    sessionId,
    workflowId: workflow.id,
    itemId: seeded.item.id,
    actorId: seeded.ids.actorTech,
    developerActorId: seeded.ids.actorDelegate,
    outOfScopeOperatorActorId: seeded.ids.actorUnauthorized,
    predicate: health.candidate_predicate!,
  };
}
```

Also implement:

- `seedBlockedOrphanQueuedActionCandidate(idPrefix)`
  - create workflow/session;
  - insert a queued/running `PlanItemWorkflowQueuedAction` with no valid active lease owner;
  - return `actionId`, `workflowId`, `sessionId`, and candidate predicate.
- `seedBlockedOrphanRuntimeRunSessionCandidate(idPrefix)`
  - create workflow/session;
  - attach a runtime job/run session pair whose owner/lease binding is stale or missing according to the predicate builder;
  - return `runtimeJobId`, `runSessionId`, `sessionId`, and candidate predicate.
- `seedBlockedMissingCapsuleCandidate(idPrefix)`
  - set the session latest capsule id/digest to a required capsule reference that cannot be loaded;
  - return candidate predicate with `expected_health_state: 'blocked_missing_capsule'`.
- `seedBlockedMissingCapsuleCandidateInApp(app, idPrefix)`
  - same setup as `seedBlockedMissingCapsuleCandidate`, but reuses the supplied app/repository so one scavenge execute test can combine applied, skipped, and blocked candidates in the same control-plane instance.
- `seedAmbiguousWorkflowForPlanItem(app, seeded)`
  - directly create a second non-archived workflow/session for the same Plan Item through repository APIs.
- `buildFreshOperatorHealthCandidate(app, sessionId, actorId, checkedAt?)`
  - call `GET /session-operations/health` or the domain projection builder to get the same candidate predicate shape the API returns.

Fixture IDs must be UUID-shaped and deterministic. If a needed worker/runtime id is not present in `idsFor`, add it to `tests/helpers/plan-item-workflow-fixtures.ts`.

- [ ] **Step 3: Add no-active-workflow and mark-unrecoverable API tests**

Add to `tests/api/session-operations.test.ts`:

```ts
it('returns no-active-workflow diagnostics when a Plan Item has not started a workflow', async () => {
  const app = await createTestApp();
  const seeded = await seedDevelopmentPlanItem(app, { idPrefix: '88888898' });

  const response = await request(app.getHttpServer())
    .get(`/plan-items/${seeded.item.id}/session-diagnostics`)
    .set(signedHumanHeaders(seeded.ids.actorTech))
    .expect(200);

  expect(response.body.workflow_resolution).toBe('no_active_workflow');
  expect(response.body.normal_workflow_actions_available).toBe(false);
});

it('marks missing capsule state unrecoverable with audit and no Codex continuation', async () => {
  const { app, sessionId, predicate, actorId, repository } = await seedBlockedMissingCapsuleCandidate('88888899');

  const response = await request(app.getHttpServer())
    .post(`/session-operations/${sessionId}/recover`)
    .set(signedHumanHeaders(actorId))
    .send({
      operation_idempotency_key: predicate.operation_idempotency_key,
      operation: 'mark_unrecoverable',
      reason: 'Required capsule is missing and cannot satisfy resume contract.',
      candidate_predicate: predicate,
    })
    .expect(201);

  expect(response.body.record.result).toBe('applied');
  expect(response.body.after.state).toBe('unrecoverable');
  expect(response.body.after.normal_workflow_actions_available).not.toBe(true);
  const records = await repository.listSessionRecoveryRecords({ codex_session_id: sessionId });
  expect(records.at(-1)?.operation).toBe('mark_unrecoverable');
});

it('rejects recover when request idempotency key differs from candidate predicate key', async () => {
  const { app, sessionId, predicate, actorId, repository } = await seedBlockedStaleLeaseCandidate('88888900');

  await request(app.getHttpServer())
    .post(`/session-operations/${sessionId}/recover`)
    .set(signedHumanHeaders(actorId))
    .send({
      operation_idempotency_key: `${predicate.operation_idempotency_key}:different`,
      operation: 'recover',
      reason: 'Mismatched key should fail closed.',
      candidate_predicate: predicate,
    })
    .expect(409);

  const records = await repository.listSessionRecoveryRecords({ codex_session_id: sessionId });
  expect(records.at(-1)?.result).toBe('blocked');
  expect(records.at(-1)?.result_code).toBe('idempotency_key_mismatch');
});
```

In the ambiguous-workflow test above, replace the comment with `await seedAmbiguousWorkflowForPlanItem(app, seeded)`.

- [ ] **Step 4: Write failing API tests for recover idempotency and control-only behavior**

Add tests:

```ts
it('recovers a stale lease only when the candidate predicate still matches', async () => {
  const { app, sessionId, predicate, actorId } = await seedBlockedStaleLeaseCandidate('88888883');

  const body = {
    operation_idempotency_key: predicate.operation_idempotency_key,
    operation: 'recover',
    reason: 'Release stale worker lease after heartbeat expiry.',
    candidate_predicate: predicate,
    actor_id: 'malicious-body-actor',
  };

  const response = await request(app.getHttpServer())
    .post(`/session-operations/${sessionId}/recover`)
    .set(signedHumanHeaders(actorId))
    .send(body)
    .expect(201);

  expect(response.body.record.result).toBe('applied');
  expect(response.body.record.actor_id).toBe(actorId);
  expect(response.body.after.state).toBe('recovered');
  expect(JSON.stringify(response.body)).not.toContain('candidate_predicate');
  expect(JSON.stringify(response.body)).not.toContain('worker_session_digest');
  expect(JSON.stringify(response.body)).not.toContain('lease_token');

  const replay = await request(app.getHttpServer())
    .post(`/session-operations/${sessionId}/recover`)
    .set(signedHumanHeaders(actorId))
    .send(body)
    .expect(201);

  expect(replay.body.replayed).toBe(true);
  expect(replay.body.record.id).toBe(response.body.record.id);
});

it('keeps recovered state durable until a separate human product action clears it', async () => {
  const { app, sessionId, itemId, predicate, actorId } = await seedBlockedStaleLeaseCandidate('88888901');

  await request(app.getHttpServer())
    .post(`/session-operations/${sessionId}/recover`)
    .set(signedHumanHeaders(actorId))
    .send({
      operation_idempotency_key: predicate.operation_idempotency_key,
      operation: 'recover',
      reason: 'Release stale worker lease after heartbeat expiry.',
      candidate_predicate: predicate,
    })
    .expect(201);

  const health = await request(app.getHttpServer())
    .get('/session-operations/health?state=recovered')
    .set(signedHumanHeaders(actorId))
    .expect(200);
  expect(health.body.items.some((item) => item.codex_session_id === sessionId && item.state === 'recovered')).toBe(true);

  const diagnostics = await request(app.getHttpServer())
    .get(`/plan-items/${itemId}/session-diagnostics`)
    .set(signedHumanHeaders(actorId))
    .expect(200);
  expect(diagnostics.body.state).toBe('recovered');
  expect(diagnostics.body.normal_workflow_actions_available).toBe(false);
});

it('records a skipped recovery when a fresh lease supersedes the candidate', async () => {
  const { app, sessionId, predicate, actorId, repository } = await seedBlockedStaleLeaseCandidate('88888884');
  await repository.claimCodexSessionLease({
    session_id: sessionId,
    worker_id: 'fresh-worker-id',
    worker_session_digest: `sha256:${'f'.repeat(64)}`,
    lease_token_hash: `sha256:${'e'.repeat(64)}`,
    now: '2026-06-09T00:08:00.000Z',
    expires_at: '2026-06-09T00:30:00.000Z',
  });

  const response = await request(app.getHttpServer())
    .post(`/session-operations/${sessionId}/recover`)
    .set(signedHumanHeaders(actorId))
    .send({
      operation_idempotency_key: predicate.operation_idempotency_key,
      operation: 'recover',
      reason: 'Release stale worker lease after heartbeat expiry.',
      candidate_predicate: predicate,
    })
    .expect(409);

  expect(response.body.message).toMatch(/stale candidate/i);
  expect(JSON.stringify(response.body)).not.toContain('candidate_predicate');
  expect(JSON.stringify(response.body)).not.toContain('worker_session_digest');
  const records = await repository.listSessionRecoveryRecords({ codex_session_id: sessionId });
  expect(records.at(-1)?.result).toBe('skipped');
  expect(records.at(-1)?.result_code).toBe('stale_candidate');
  expect(records.at(-1)?.object_event_id).toBeUndefined();
});

it('terminalizes an orphaned queued action with recovery audit', async () => {
  const { app, sessionId, workflowId, actionId, predicate, actorId, repository } = await seedBlockedOrphanQueuedActionCandidate('88888886');

  const response = await request(app.getHttpServer())
    .post(`/session-operations/${sessionId}/recover`)
    .set(signedHumanHeaders(actorId))
    .send({
      operation_idempotency_key: predicate.operation_idempotency_key,
      operation: 'recover',
      reason: 'Terminalize orphaned queued action without a valid owner.',
      candidate_predicate: predicate,
    })
    .expect(201);

  expect(response.body.record.result).toBe('applied');
  expect(response.body.record.affected_queued_action_ids).toContain(actionId);
  const action = await repository.getPlanItemWorkflowQueuedAction({ workflow_id: workflowId, action_id: actionId });
  expect(action?.status).toBe('stale');
  expect(action?.blocked_reason_code).toBe('session_operations_orphaned_action');
  const records = await repository.listSessionRecoveryRecords({ codex_session_id: sessionId });
  expect(records.at(-1)?.affected_queued_action_ids).toContain(actionId);
});

it('terminalizes orphaned runtime job and run session with recovery audit', async () => {
  const { app, sessionId, runtimeJobId, runSessionId, predicate, actorId, repository } =
    await seedBlockedOrphanRuntimeRunSessionCandidate('88888887');

  const response = await request(app.getHttpServer())
    .post(`/session-operations/${sessionId}/recover`)
    .set(signedHumanHeaders(actorId))
    .send({
      operation_idempotency_key: predicate.operation_idempotency_key,
      operation: 'recover',
      reason: 'Terminalize orphaned runtime ownership.',
      candidate_predicate: predicate,
    })
    .expect(201);

  expect(response.body.record.result).toBe('applied');
  expect(response.body.record.affected_runtime_job_ids).toContain(runtimeJobId);
  expect(response.body.record.affected_run_session_ids).toContain(runSessionId);
  const records = await repository.listSessionRecoveryRecords({ codex_session_id: sessionId });
  expect(records.at(-1)?.affected_runtime_job_ids).toContain(runtimeJobId);
  expect(records.at(-1)?.affected_run_session_ids).toContain(runSessionId);
});

it('records a blocked recovery when the requested operation is unsupported for the current state', async () => {
  const { app, sessionId, predicate, actorId, repository } = await seedBlockedMissingCapsuleCandidate('88888888');

  await request(app.getHttpServer())
    .post(`/session-operations/${sessionId}/recover`)
    .set(signedHumanHeaders(actorId))
    .send({
      operation_idempotency_key: predicate.operation_idempotency_key,
      operation: 'recover',
      reason: 'Try unsafe missing-capsule recovery.',
      candidate_predicate: predicate,
    })
    .expect(409);

  const records = await repository.listSessionRecoveryRecords({ codex_session_id: sessionId });
  expect(records.at(-1)?.result).toBe('blocked');
  expect(records.at(-1)?.result_code).toBe('unsupported_missing_capsule_recovery');
});

it('allows developer or tech lead diagnostics without global recovery powers', async () => {
  const { app, sessionId, itemId, predicate, developerActorId } = await seedBlockedStaleLeaseCandidate('88888889');

  await request(app.getHttpServer())
    .get(`/plan-items/${itemId}/session-diagnostics`)
    .set(signedDeveloperHeaders(developerActorId))
    .expect(200);

  await request(app.getHttpServer())
    .post(`/session-operations/${sessionId}/recover`)
    .set(signedDeveloperHeaders(developerActorId))
    .send({
      operation_idempotency_key: predicate.operation_idempotency_key,
      operation: 'recover',
      reason: 'Developer should not recover globally.',
      candidate_predicate: predicate,
    })
    .expect(403);
});

it('rejects operator recovery outside the actor support scope', async () => {
  const { app, sessionId, predicate, outOfScopeOperatorActorId } = await seedBlockedStaleLeaseCandidate('88888890');

  await request(app.getHttpServer())
    .post(`/session-operations/${sessionId}/recover`)
    .set(signedHumanHeaders(outOfScopeOperatorActorId))
    .send({
      operation_idempotency_key: predicate.operation_idempotency_key,
      operation: 'recover',
      reason: 'Out of scope recovery should fail.',
      candidate_predicate: predicate,
    })
    .expect(403);
});

it('defaults scavenge to dry-run and does not mutate health, recovery records, or retention pins', async () => {
  const { app, sessionId, actorId, repository } = await seedBlockedStaleLeaseCandidate('88888891');
  const beforeHealth = await repository.listPlanItemSessionHealth({ codex_session_id: sessionId });
  const beforeRecords = await repository.listSessionRecoveryRecords({ codex_session_id: sessionId });
  const beforePins = await repository.listCapsuleRetentionPins({ codex_session_id: sessionId });

  const response = await request(app.getHttpServer())
    .post('/session-operations/scavenge')
    .set(signedHumanHeaders(actorId))
    .send({ mode: 'dry_run', filters: { state: 'blocked_stale_lease' } })
    .expect(201);

  expect(response.body.mode).toBe('dry_run');
  expect(response.body.candidates).toHaveLength(1);
  expect(response.body.candidates[0].candidate_predicate).toBeDefined();
  expect(await repository.listPlanItemSessionHealth({ codex_session_id: sessionId })).toEqual(beforeHealth);
  expect(await repository.listSessionRecoveryRecords({ codex_session_id: sessionId })).toEqual(beforeRecords);
  expect(await repository.listCapsuleRetentionPins({ codex_session_id: sessionId })).toEqual(beforePins);
});

it('requires explicit confirmation before scavenge execute mutates candidates', async () => {
  const { app, predicate, actorId } = await seedBlockedStaleLeaseCandidate('88888892');

  await request(app.getHttpServer())
    .post('/session-operations/scavenge')
    .set(signedHumanHeaders(actorId))
    .send({
      mode: 'execute',
      reason: 'Missing confirmation should fail.',
      operation_idempotency_key_prefix: 'scavenge-88888892',
      candidates: [{ codex_session_id: predicate.codex_session_id, candidate_predicate: predicate }],
    })
    .expect(400);
});

it('scavenge execute revalidates each candidate and reports applied skipped and blocked results', async () => {
  const app = await createTestApp();
  const applied = await seedBlockedStaleLeaseCandidateInApp(app, '88888893');
  const skipped = await seedBlockedStaleLeaseCandidateInApp(app, '88888894');
  const blocked = await seedBlockedMissingCapsuleCandidateInApp(app, '88888895');
  await skipped.repository.claimCodexSessionLease({
    session_id: skipped.sessionId,
    worker_id: 'fresh-worker-id',
    worker_session_digest: `sha256:${'f'.repeat(64)}`,
    lease_token_hash: `sha256:${'e'.repeat(64)}`,
    now: '2026-06-09T00:08:00.000Z',
    expires_at: '2026-06-09T00:30:00.000Z',
  });

  const response = await request(app.getHttpServer())
    .post('/session-operations/scavenge')
    .set(signedHumanHeaders(applied.actorId))
    .send({
      mode: 'execute',
      confirm_execute: true,
      reason: 'Scavenge blocked candidates after operator review.',
      operation_idempotency_key_prefix: 'scavenge-88888893',
      candidates: [
        { codex_session_id: applied.sessionId, candidate_predicate: applied.predicate },
        { codex_session_id: skipped.sessionId, candidate_predicate: skipped.predicate },
        { codex_session_id: blocked.sessionId, candidate_predicate: blocked.predicate },
      ],
    })
    .expect(201);

  expect(response.body.results.map((result) => result.result)).toEqual(['applied', 'skipped', 'blocked']);
});
```

- [ ] **Step 5: Run API test to verify it fails**

Run: `pnpm vitest run tests/api/session-operations.test.ts`

Expected: FAIL because module and routes do not exist.

- [ ] **Step 6: Add DTO file**

Create `apps/control-plane-api/src/modules/session-operations/session-operations.dto.ts`:

```ts
import {
  recoverSessionRequestSchema,
  scavengeSessionOperationsRequestSchema,
  type RecoverSessionRequest,
  type ScavengeSessionOperationsRequest,
} from '@forgeloop/contracts';

export { recoverSessionRequestSchema, scavengeSessionOperationsRequestSchema };
export type RecoverSessionRequestDto = RecoverSessionRequest;
export type ScavengeSessionOperationsRequestDto = ScavengeSessionOperationsRequest;
```

- [ ] **Step 7: Add controller with authenticated context**

Create `apps/control-plane-api/src/modules/session-operations/session-operations.controller.ts`:

```ts
import { Body, Controller, Get, Headers, Inject, Param, Post, Query } from '@nestjs/common';
import { actorContextFromHeaders } from '../auth/actor-context';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import {
  recoverSessionRequestSchema,
  scavengeSessionOperationsRequestSchema,
  type RecoverSessionRequestDto,
  type ScavengeSessionOperationsRequestDto,
} from './session-operations.dto';
import { SessionOperationsService } from './session-operations.service';

@Controller()
export class SessionOperationsController {
  constructor(@Inject(SessionOperationsService) private readonly service: SessionOperationsService) {}

  @Get('session-operations/health')
  listHealth(@Headers() headers: Record<string, string | string[] | undefined>, @Query() query: Record<string, string | undefined>) {
    return this.service.listHealth(query, actorContextFromHeaders(headers));
  }

  @Get('session-operations/:sessionId/audit')
  listAudit(@Param('sessionId') sessionId: string, @Headers() headers: Record<string, string | string[] | undefined>) {
    return this.service.listAudit(sessionId, actorContextFromHeaders(headers));
  }

  @Post('session-operations/:sessionId/recover')
  recover(
    @Param('sessionId') sessionId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(recoverSessionRequestSchema)) body: RecoverSessionRequestDto,
  ) {
    return this.service.recover(sessionId, body, actorContextFromHeaders(headers));
  }

  @Post('session-operations/scavenge')
  scavenge(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(scavengeSessionOperationsRequestSchema)) body: ScavengeSessionOperationsRequestDto,
  ) {
    return this.service.scavenge(body, actorContextFromHeaders(headers));
  }

  @Get('plan-items/:planItemId/session-diagnostics')
  getPlanItemDiagnostics(@Param('planItemId') planItemId: string, @Headers() headers: Record<string, string | string[] | undefined>) {
    return this.service.getPlanItemDiagnostics(planItemId, actorContextFromHeaders(headers));
  }
}
```

- [ ] **Step 8: Implement service scope checks and projections**

Create `apps/control-plane-api/src/modules/session-operations/session-operations.service.ts`:

- Inject `DELIVERY_REPOSITORY`.
- Require `authenticatedActorId`.
- Treat `actorClass === 'human_admin'` as Operator/Admin for first implementation tests.
- For Plan Item diagnostics, allow project participant/leader/developer checks based on existing Development Plan Item fields.
- `listHealth(query, actorContext)`:
  - require Operator/Admin scope;
  - load or rebuild projections for sessions matching filters;
  - use `persist: true` for normal dashboard reads;
  - return `{ items, filters }` with operator-safe projections and candidate predicates only for authorized operators;
  - redact raw thread ids, lease tokens, local paths, secrets, and raw capsule contents.
- `listAudit(sessionId, actorContext)`:
  - require Operator/Admin scope for the session, unless a later Plan Item audit surface provides narrower authorization;
  - list `SessionRecoveryRecord` rows for the session;
  - return `redactSessionRecoveryRecordDto(record)` items only;
  - never expose full `candidate_predicate`.
- Load exactly one active workflow for a Plan Item:
  - no active workflow returns public `workflow_resolution: 'no_active_workflow'`;
  - multiple non-archived workflows throws `ConflictException`;
  - one active workflow returns redacted diagnostics.
- Build fresh projections through one helper with explicit persistence behavior:
  - `buildProjectionForSession(sessionId, { persist: true })` for normal health/dashboard/diagnostics reads and recovery writes;
  - `buildProjectionForSession(sessionId, { persist: false })` for scavenge dry-run candidate computation.
- When `persist: true`, build retention pins from active session, checkpoint/product evidence, recovery records, ObjectEvents, and unrecoverable evidence references before upserting health and pins.
- When `persist: false`, compute the same projection and pins in memory but do not call `upsertPlanItemSessionHealth`, `upsertCapsuleRetentionPins`, `createOrReplaySessionRecoveryRecord`, or `appendObjectEvent`.
- `recover(sessionId, body, actorContext)` must return `RecoverSessionResponse`: `{ record, before, after, replayed }`, where `record` is `SessionRecoveryRecordDto` without the full predicate.
- Before predicate matching, reject and record `result = 'blocked'`, `result_code = 'idempotency_key_mismatch'` when `body.operation_idempotency_key !== body.candidate_predicate.operation_idempotency_key`.
- After an applied recovery, persist the resulting health state as `recovered` or `unrecoverable` in `plan_item_session_health`; later `buildProjectionForSession(..., { persist: true })` must preserve that durable terminal operational state until a separate human product action explicitly clears it.

Service skeleton:

```ts
@Injectable()
export class SessionOperationsService {
  constructor(@Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository) {}

  async recover(sessionId: string, body: RecoverSessionRequestDto, actorContext: ActorContext) {
    const actorId = this.requireActor(actorContext);
    await this.assertOperator(actorContext, sessionId);
    const before = await this.buildProjectionForSession(sessionId, { persist: true });

    if (body.operation_idempotency_key !== body.candidate_predicate.operation_idempotency_key) {
      const record = await this.writeBlockedRecoveryRecord({
        before,
        body,
        actorId,
        result_code: 'idempotency_key_mismatch',
      });
      throw new ConflictException({
        message: 'Recovery idempotency key must match the candidate predicate.',
        response: {
          record: redactSessionRecoveryRecordDto(record),
          before: redactOperatorSessionHealthProjection(before),
          after: redactOperatorSessionHealthProjection(before),
          replayed: false,
        },
      });
    }

    const predicateCheck = this.checkRecoveryPredicate(before, body.candidate_predicate);
    if (predicateCheck.ok === false) {
      const after = await this.buildProjectionForSession(sessionId, { persist: true });
      const { record, replayed } = await this.repository.createOrReplaySessionRecoveryRecord(this.buildRecoveryRecordDraft({
        before,
        after,
        body,
        actorId,
        result: 'skipped',
        result_code: 'stale_candidate',
        objectEventRequired: false,
      }));
      throw new ConflictException({
        message: 'Recovery candidate is stale.',
        response: {
          record: redactSessionRecoveryRecordDto(record),
          before: redactOperatorSessionHealthProjection(before),
          after: redactOperatorSessionHealthProjection(after),
          replayed,
        },
      });
    }

    const applied = await this.applyControlOnlyRecovery(before, body, actorId);
    await this.persistDurableOperationalState(sessionId, applied.after_state);
    const after = await this.buildProjectionForSession(sessionId, { persist: true });
    const { record, replayed } = await this.repository.createOrReplaySessionRecoveryRecord(this.buildRecoveryRecordDraft({
      before,
      after,
      body,
      actorId,
      result: applied.result,
      result_code: applied.result_code,
      objectEventRequired: applied.result === 'applied',
    }));
    return {
      record: redactSessionRecoveryRecordDto(record),
      replayed,
      before: redactOperatorSessionHealthProjection(before),
      after: redactOperatorSessionHealthProjection(after),
    };
  }
}
```

`buildRecoveryRecordDraft` + `repository.createOrReplaySessionRecoveryRecord` must run for applied, skipped, and blocked attempts. Applied attempts must include `object_event_id`; skipped and blocked no-op attempts may omit `object_event_id`, but their response and stored record must include an explicit `result_code`. `createOrReplaySessionRecoveryRecord` owns idempotency replay/conflict behavior; do not add a separate repository lookup method unless the repository contract is updated in Task 3.

`redactSessionRecoveryRecordDto(record)` must drop the full `candidate_predicate` and expose only a public-safe predicate summary:

```ts
{
  id: record.id,
  operation_idempotency_key: record.operation_idempotency_key,
  operation: record.operation,
  actor_id: record.actor_id,
  reason: record.reason,
  before_state: record.before_state,
  after_state: record.after_state,
  before_projection_digest: record.before_projection_digest,
  after_projection_digest: record.after_projection_digest,
  affected_lease_ids: record.affected_lease_ids,
  affected_queued_action_ids: record.affected_queued_action_ids,
  affected_turn_ids: record.affected_turn_ids,
  affected_runtime_job_ids: record.affected_runtime_job_ids,
  affected_run_session_ids: record.affected_run_session_ids,
  affected_capsule_ids: record.affected_capsule_ids,
  predicate_summary: {
    expected_health_state: record.candidate_predicate.expected_health_state,
    projection_digest: record.candidate_predicate.projection_digest,
    workflow_id: record.workflow_id,
    codex_session_id: record.codex_session_id,
  },
  result: record.result,
  result_code: record.result_code,
  object_event_id: record.object_event_id,
  created_at: record.created_at,
}
```

`applyControlOnlyRecovery` must branch on product health state:

- `blocked_stale_lease`: terminalize/release stale `CodexSessionLease`, clear stale session runner owner fields if they match the predicate, and set health to `recovered`.
- `blocked_orphaned_action` with pending queued action: terminalize the queued action as stale/blocked with reason `session_operations_orphaned_action`, terminalize linked turn if needed, and set health to `recovered`.
- `blocked_orphaned_action` with runtime job or run session: terminalize the runtime job/run session using existing terminal status conventions, record affected ids, and set health to `recovered`.
- `blocked_missing_capsule`: block ordinary `recover` with `result = 'blocked'` and `result_code = 'unsupported_missing_capsule_recovery'`; allow only `mark_unrecoverable` to set health to `unrecoverable`.
- `blocked_lineage_conflict`: block ordinary `recover` with `result = 'blocked'` and `result_code = 'unsupported_lineage_conflict_recovery'`; allow only `mark_unrecoverable` to set health to `unrecoverable`.
- `recovered` / `healthy`: skip with explicit no-op result codes.

It must not call any Codex runtime scheduler/client, `PlanItemWorkflowService.start*`, fork methods, or transition methods.

- [ ] **Step 9: Add module and register it**

Create `apps/control-plane-api/src/modules/session-operations/session-operations.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { PlanItemWorkflowsModule } from '../plan-item-workflows/plan-item-workflows.module';
import { SessionOperationsController } from './session-operations.controller';
import { SessionOperationsService } from './session-operations.service';

@Module({
  imports: [ControlPlaneCoreModule, PlanItemWorkflowsModule],
  controllers: [SessionOperationsController],
  providers: [SessionOperationsService],
  exports: [SessionOperationsService],
})
export class SessionOperationsModule {}
```

Modify `apps/control-plane-api/src/app.module.ts` to import `SessionOperationsModule`.

- [ ] **Step 10: Add scavenge dry-run and execute**

Implement `SessionOperationsService.scavenge`:

- Dry-run:
  - list health projections by filters;
  - rebuild projections with `persist: false` before returning candidates;
  - return candidates and predicates;
  - perform no mutations, including no health upsert and no retention pin upsert.
- Execute:
  - require `confirm_execute === true`;
  - require `reason` and `operation_idempotency_key_prefix`;
  - require candidate predicates;
  - call the same fenced recovery path per candidate with `persist: true`;
  - derive each candidate idempotency key as `${operation_idempotency_key_prefix}:${codex_session_id}:${candidate_predicate.projection_digest}`;
  - use the shared `reason` for each generated `SessionRecoveryRecord`;
  - return per-candidate `applied`, `skipped`, or `blocked`;
  - write `SessionRecoveryRecord` for every attempted candidate.

- [ ] **Step 11: Add ObjectEvent writing for applied changes**

Use existing `repository.appendObjectEvent` behavior:

- `object_type`: `codex_session` or existing object-event convention.
- `object_id`: recovered session id.
- payload includes public-safe:
  - operation idempotency key;
  - operation;
  - reason;
  - before/after state;
  - before/after projection digest;
  - affected object ids;
  - redacted predicate summary.
- payload excludes:
  - full candidate predicate;
  - worker session digest;
  - raw thread id;
  - raw paths;
  - secrets.

- [ ] **Step 12: Run API tests**

Run: `pnpm vitest run tests/api/session-operations.test.ts`

Expected: PASS.

- [ ] **Step 13: Run adjacent API tests**

Run: `pnpm vitest run tests/api/session-operations.test.ts tests/api/plan-item-workflows.test.ts tests/api/codex-session-lease.test.ts tests/api/codex-runtime-control-plane.test.ts`

Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add apps/control-plane-api/src/modules/session-operations apps/control-plane-api/src/app.module.ts tests/api/session-operations.test.ts
git commit -m "feat: add session operations API"
```

## Task 5: Recovery Fencing Coverage And No Product-State Mutation Guarantees

**Files:**
- Modify: `tests/domain/session-operations.test.ts`
- Modify: `tests/api/session-operations.test.ts`
- Modify: `apps/control-plane-api/src/modules/session-operations/session-operations.service.ts`
- Modify: `packages/domain/src/session-operations.ts`

- [ ] **Step 1: Add failing tests for every predicate fence**

Extend `tests/domain/session-operations.test.ts` or `tests/api/session-operations.test.ts` with table-driven tests:

```ts
it.each([
  ['workflow status changed', (predicate) => ({ ...predicate, workflow: { ...predicate.workflow, status: 'execution_ready' } })],
  ['workflow updated_at changed', (predicate) => ({ ...predicate, workflow: { ...predicate.workflow, updated_at: '2026-06-09T01:00:00.000Z' } })],
  ['active spec revision changed', (predicate) => ({
    ...predicate,
    workflow: { ...predicate.workflow, active_spec_doc_revision_id: 'new-spec-revision' },
  })],
  ['session lease epoch changed', (predicate) => ({
    ...predicate,
    session: { ...predicate.session, lease_epoch: predicate.session.lease_epoch + 1 },
  })],
  ['queued action idempotency changed', (predicate) => ({
    ...predicate,
    pending_queued_action: {
      checked: true,
      state: 'present',
      id: 'action-1',
      kind: 'continue_execution',
      status: 'queued',
      idempotency_key: 'different',
      codex_session_turn_id: null,
      expected_input_capsule_digest: null,
      updated_at: '2026-06-09T00:00:00.000Z',
    },
  })],
])('rejects stale candidate when %s', (_label, mutate) => {
  const projection = blockedStaleLeaseProjection();
  const mutatedPredicate = mutate(projection.candidate_predicate!);
  expect(() => assertRecoveryPredicateStillMatches(projection, mutatedPredicate)).toThrow(/stale/i);
});
```

Cover:

- active lease id/status/epoch/worker/session digest/expiry/update timestamp;
- queued action idempotency/status/update timestamp;
- latest turn status/digests/runtime job refs/update timestamp;
- runtime job status/terminal status/worker/launch lease/expiry/update timestamp;
- run session status/remote job/remote worker lease/update timestamp;
- session runner owner fields;
- latest capsule id/digest/sequence;
- workflow active revision pointers and execution package id.

- [ ] **Step 2: Add failing API test that recovery does not mutate product evidence**

Add to `tests/api/session-operations.test.ts`:

```ts
it('does not mutate workflow product evidence or enable continuation when recovery applies', async () => {
  const { app, sessionId, workflowId, predicate, actorId, repository } = await seedBlockedStaleLeaseCandidate('88888885');
  const beforeWorkflow = await repository.getPlanItemWorkflow(workflowId);

  await request(app.getHttpServer())
    .post(`/session-operations/${sessionId}/recover`)
    .set(signedHumanHeaders(actorId))
    .send({
      operation_idempotency_key: predicate.operation_idempotency_key,
      operation: 'recover',
      reason: 'Release stale worker lease after heartbeat expiry.',
      candidate_predicate: predicate,
    })
    .expect(201);

  const afterWorkflow = await repository.getPlanItemWorkflow(workflowId);
  expect(afterWorkflow?.status).toBe(beforeWorkflow?.status);
  expect(afterWorkflow?.active_boundary_summary_revision_id).toBe(beforeWorkflow?.active_boundary_summary_revision_id);
  expect(afterWorkflow?.active_spec_doc_revision_id).toBe(beforeWorkflow?.active_spec_doc_revision_id);
  expect(afterWorkflow?.active_implementation_plan_doc_revision_id).toBe(beforeWorkflow?.active_implementation_plan_doc_revision_id);
  expect(afterWorkflow?.execution_package_id).toBe(beforeWorkflow?.execution_package_id);
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `pnpm vitest run tests/domain/session-operations.test.ts tests/api/session-operations.test.ts`

Expected: FAIL until all fences and product-state immutability assertions are implemented.

- [ ] **Step 4: Implement exhaustive predicate matching**

In `packages/domain/src/session-operations.ts`, implement a strict predicate comparison:

```ts
export const assertRecoveryPredicateStillMatches = (
  projection: PlanItemSessionHealth,
  predicate: SessionRecoveryCandidatePredicate,
): void => {
  const fresh = projection.candidate_predicate;
  if (fresh === undefined) {
    throw new DomainError('session_operations_stale_candidate', 'Recovery candidate is no longer available');
  }
  const freshDigest = sessionRecoveryProjectionDigest(fresh);
  const predicateDigest = sessionRecoveryProjectionDigest(predicate);
  if (freshDigest !== predicateDigest) {
    throw new DomainError('session_operations_stale_candidate', 'Recovery candidate no longer matches current session state');
  }
};
```

This canonical digest comparison is acceptable only if the predicate builder includes every required field from the spec. Add focused tests for builder coverage to prevent omitting a field.

- [ ] **Step 5: Ensure recovery cannot call product transition or Codex runtime paths**

In `SessionOperationsService`, keep recovery dependencies limited to:

- repository reads/writes;
- domain helpers;
- `appendObjectEvent`.

Do not inject:

- Codex runtime scheduler;
- worker client;
- `PlanItemWorkflowService` command methods;
- execution service.

Add a code-level guard test if needed by scanning service source:

```ts
it('keeps session operations recovery independent from Codex execution APIs', () => {
  const source = readFileSync('apps/control-plane-api/src/modules/session-operations/session-operations.service.ts', 'utf8');
  expect(source).not.toContain('startExecution');
  expect(source).not.toContain('continueExecution');
  expect(source).not.toContain('createCodexSessionFork');
  expect(source).not.toContain('selectActiveCodexSessionFork');
  expect(source).not.toContain('ProductGenerationRuntimeScheduler');
});
```

- [ ] **Step 6: Run focused tests**

Run: `pnpm vitest run tests/domain/session-operations.test.ts tests/api/session-operations.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/session-operations.ts apps/control-plane-api/src/modules/session-operations/session-operations.service.ts tests/domain/session-operations.test.ts tests/api/session-operations.test.ts
git commit -m "test: harden session recovery fencing"
```

## Task 6: Web API Hooks And Operator Dashboard Skeleton

**Files:**
- Modify: `apps/web/src/shared/api/types.ts`
- Modify: `apps/web/src/shared/api/query.ts`
- Modify: `apps/web/src/shared/api/commands.ts`
- Modify: `apps/web/src/shared/api/query-keys.ts`
- Modify: `apps/web/src/shared/api/hooks.ts`
- Create: `apps/web/src/features/session-operations/session-operations-dashboard-route.tsx`
- Create: `apps/web/src/app/routes/session-operations/index.tsx`
- Modify: `apps/web/src/app/routes.ts`
- Create: `tests/web/session-operations-routes.test.tsx`
- Modify: `tests/web/api-client-contract.test.ts`

- [ ] **Step 1: Write failing web API client tests**

Modify `tests/web/api-client-contract.test.ts`:

```ts
it('calls product-level session operations routes', async () => {
  const queryApi = createForgeloopQueryApi({ baseUrl: 'http://example.test' });
  const commandApi = createForgeloopCommandApi({ baseUrl: 'http://example.test' });
  const calls = captureFetchCalls();

  await queryApi.listSessionOperationsHealth({ state: 'blocked_stale_lease' });
  await queryApi.getPlanItemSessionDiagnostics('item-1');
  await commandApi.recoverSession('session-1', recoverBodyFixture());
  await commandApi.scavengeSessionOperations({ mode: 'dry_run' });

  expect(calls.paths()).toContain('/session-operations/health?state=blocked_stale_lease');
  expect(calls.paths()).toContain('/plan-items/item-1/session-diagnostics');
  expect(calls.paths()).toContain('/session-operations/session-1/recover');
  expect(calls.paths()).toContain('/session-operations/scavenge');
});
```

Adapt to the existing API-client test helpers.

- [ ] **Step 2: Write failing dashboard route test**

Create `tests/web/session-operations-routes.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SessionOperationsDashboardRoute } from '../../apps/web/src/features/session-operations/session-operations-dashboard-route';

const recoverPredicateFixture = () => ({
  codex_session_id: 'session-1',
  workflow_id: 'workflow-1',
  expected_health_state: 'blocked_stale_lease',
  operation_idempotency_key: 'recover-session-1-stale-lease',
  projection_digest: `sha256:${'a'.repeat(64)}`,
  workflow: {
    id: 'workflow-1',
    status: 'execution_running',
    updated_at: '2026-06-09T00:00:00.000Z',
    active_codex_session_id: 'session-1',
    active_boundary_summary_revision_id: null,
    active_spec_doc_revision_id: null,
    active_implementation_plan_doc_revision_id: null,
    execution_package_id: null,
  },
  session: {
    id: 'session-1',
    status: 'active',
    role: 'active',
    updated_at: '2026-06-09T00:00:00.000Z',
    active_lease_id: 'lease-1',
    lease_epoch: 3,
    runner_worker_id: null,
    runner_launch_lease_id: null,
    runner_runtime_job_id: null,
    runner_expires_at: null,
    latest_turn_id: null,
    latest_capsule_id: null,
    latest_capsule_digest: null,
  },
  active_lease: {
    checked: true,
    state: 'present',
    id: 'lease-1',
    status: 'active',
    lease_epoch: 3,
    worker_id: 'worker-1',
    worker_session_digest: `sha256:${'b'.repeat(64)}`,
    heartbeat_at: '2026-06-09T00:01:00.000Z',
    expires_at: '2026-06-09T00:02:00.000Z',
    updated_at: '2026-06-09T00:01:00.000Z',
  },
  pending_queued_action: { checked: true, state: 'absent' },
  latest_turn: { checked: true, state: 'absent' },
  runtime_job: { checked: true, state: 'absent' },
  run_session: { checked: true, state: 'absent' },
  latest_capsule: { checked: true, state: 'absent' },
  observed_at: '2026-06-09T00:03:00.000Z',
});

describe('session operations dashboard route', () => {
  it('renders blocked sessions without raw runtime internals', async () => {
    render(
      <SessionOperationsDashboardRoute
        initialHealth={[
          {
            codex_session_id: 'session-1',
            workflow_id: 'workflow-1',
            development_plan_item_id: 'item-1',
            state: 'blocked_stale_lease',
            severity: 'blocked',
            summary: 'Worker lease expired.',
            recovery_available: true,
            recovery_operation_labels: ['recover'],
            operator_intervention_required: true,
            retention_risk: false,
            lineage_risk: false,
            checked_at: '2026-06-09T00:00:00.000Z',
            candidate_predicate: recoverPredicateFixture(),
          },
        ]}
      />,
    );

    expect(screen.getByText('Session Operations')).toBeInTheDocument();
    expect(screen.getByText('Worker lease expired.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /recover/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mark unrecoverable/i })).toBeInTheDocument();
    expect(screen.queryByText(/worker_session_digest/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/codex_thread_id/i)).not.toBeInTheDocument();
  });

  it('requires operator reason and idempotency prefix before executing selected scavenge candidates', async () => {
    render(
      <SessionOperationsDashboardRoute
        initialHealth={[
          {
            codex_session_id: 'session-1',
            workflow_id: 'workflow-1',
            development_plan_item_id: 'item-1',
            state: 'blocked_stale_lease',
            severity: 'blocked',
            summary: 'Worker lease expired.',
            recovery_available: true,
            recovery_operation_labels: ['recover'],
            operator_intervention_required: true,
            retention_risk: false,
            lineage_risk: false,
            checked_at: '2026-06-09T00:00:00.000Z',
            candidate_predicate: recoverPredicateFixture(),
          },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole('checkbox', { name: /select session-1/i }));
    const execute = screen.getByRole('button', { name: /execute selected scavenge/i });
    expect(execute).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/scavenge reason/i), 'Operator-reviewed stale lease cleanup.');
    expect(execute).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/idempotency prefix/i), 'scavenge-session-1');
    await userEvent.click(screen.getByRole('checkbox', { name: /confirm execute/i }));
    expect(execute).toBeEnabled();
  });
});
```

- [ ] **Step 3: Run web tests to verify they fail**

Run: `pnpm vitest run tests/web/session-operations-routes.test.tsx tests/web/api-client-contract.test.ts`

Expected: FAIL because web API functions and route do not exist.

- [ ] **Step 4: Add shared API types and functions**

Modify `apps/web/src/shared/api/types.ts` to export:

```ts
export type {
  OperatorSessionHealthProjection,
  SessionOperationsHealthQuery,
  SessionOperationsHealthResponse,
  SessionOperationsAuditResponse,
  PlanItemSessionDiagnostics,
  RecoverSessionRequest,
  RecoverSessionResponse,
  ScavengeSessionOperationsRequest,
  ScavengeSessionOperationsResponse,
  SessionRecoveryRecordDto,
} from '@forgeloop/contracts';
```

Modify `apps/web/src/shared/api/query.ts`:

```ts
listSessionOperationsHealth: (query: SessionOperationsHealthQuery) =>
  context.request<SessionOperationsHealthResponse>(`/session-operations/health${queryString(query)}`),
getSessionOperationsAudit: (sessionId: string) =>
  context.request<SessionOperationsAuditResponse>(`/session-operations/${encodeURIComponent(sessionId)}/audit`),
getPlanItemSessionDiagnostics: (planItemId: string) =>
  context.request<PlanItemSessionDiagnostics>(`/plan-items/${encodeURIComponent(planItemId)}/session-diagnostics`),
```

Modify `apps/web/src/shared/api/commands.ts`:

```ts
recoverSession: (sessionId: string, body: RecoverSessionRequest) =>
  context.request<RecoverSessionResponse>(`/session-operations/${encodeURIComponent(sessionId)}/recover`, {
    method: 'POST',
    body,
  }),
scavengeSessionOperations: (body: ScavengeSessionOperationsRequest) =>
  context.request<ScavengeSessionOperationsResponse>('/session-operations/scavenge', {
    method: 'POST',
    body,
  }),
```

- [ ] **Step 5: Add query keys and hooks**

Modify `apps/web/src/shared/api/query-keys.ts`:

```ts
sessionOperationsHealth: (query: SessionOperationsHealthQuery) => ['session-operations-health', query],
sessionOperationsAudit: (sessionId: string | undefined) => ['session-operations-audit', sessionId],
planItemSessionDiagnostics: (planItemId: string | undefined) => ['plan-item-session-diagnostics', planItemId],
```

Modify `apps/web/src/shared/api/hooks.ts`:

- `useSessionOperationsHealthQuery`
- `useSessionOperationsAuditQuery`
- `usePlanItemSessionDiagnosticsQuery`
- `useRecoverSessionMutation`
- `useScavengeSessionOperationsMutation`

On mutation success, invalidate health, audit for the session, and Plan Item diagnostics when known.

- [ ] **Step 6: Build operator dashboard skeleton**

Create `apps/web/src/features/session-operations/session-operations-dashboard-route.tsx`:

- Use existing `Button`, `InlineNotice`, `StatusPill` components.
- Layout:
  - compact header;
  - severity summary row;
  - filter controls;
  - health table/list;
  - side panel or inline details for candidate predicate summary;
  - dry-run scavenge button;
  - selected-candidate scavenge execute controls:
    - row selection checkbox for candidates;
    - required reason text field labeled "Scavenge reason";
    - required idempotency prefix text field labeled "Idempotency prefix";
    - explicit confirmation checkbox labeled "Confirm execute";
    - "Execute selected scavenge" button disabled until at least one candidate is selected and all three execute requirements are satisfied;
  - recover button for single candidate;
  - mark unrecoverable button with required reason for missing-capsule and lineage-conflict states;
  - audit preview.
- Render candidate predicates only through safe labels; do not dump JSON.
- Keep dashboard route a skeleton: it should demonstrate API wiring and operator controls, not full bulk polish.

- [ ] **Step 7: Add route wrapper**

Create `apps/web/src/app/routes/session-operations/index.tsx`:

```tsx
import { SessionOperationsDashboardRoute } from '../../../features/session-operations/session-operations-dashboard-route';

export default function SessionOperationsPage() {
  return <SessionOperationsDashboardRoute />;
}
```

Modify `apps/web/src/app/routes.ts`:

```ts
route('session-operations', './routes/session-operations/index.tsx'),
```

- [ ] **Step 8: Run web tests**

Run: `pnpm vitest run tests/web/session-operations-routes.test.tsx tests/web/api-client-contract.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/shared/api/types.ts apps/web/src/shared/api/query.ts apps/web/src/shared/api/commands.ts apps/web/src/shared/api/query-keys.ts apps/web/src/shared/api/hooks.ts apps/web/src/features/session-operations apps/web/src/app/routes/session-operations apps/web/src/app/routes.ts tests/web/session-operations-routes.test.tsx tests/web/api-client-contract.test.ts
git commit -m "feat: add session operations dashboard"
```

## Task 7: Plan Item Diagnostics Panel

**Files:**
- Create: `apps/web/src/features/development-plans/plan-item-session-diagnostics-panel.tsx`
- Modify: `apps/web/src/features/development-plans/plan-item-workflow-workspace.tsx`
- Modify: `tests/web/development-plan-routes.test.tsx`

- [ ] **Step 1: Write failing UI tests for diagnostics panel states**

Modify `tests/web/development-plan-routes.test.tsx`:

```tsx
it('shows Plan Item session diagnostics without operator-only recovery controls', async () => {
  server.use(
    http.get('/plan-items/:planItemId/session-diagnostics', () =>
      HttpResponse.json({
        plan_item_id: 'dpi-1',
        workflow_resolution: 'active_workflow',
        workflow_id: 'workflow-1',
        codex_session_id: 'session-1',
        state: 'blocked_stale_lease',
        severity: 'blocked',
        summary: 'Operator recovery is required before the workflow can continue.',
        operator_intervention_required: true,
        normal_workflow_actions_available: false,
        recovery_request_available: true,
      }),
    ),
  );

  renderDevelopmentPlanItemRoute('/development-plans/dp-1/items/dpi-1');

  expect(await screen.findByText('Session health')).toBeInTheDocument();
  expect(screen.getByText('Operator recovery is required before the workflow can continue.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /recover/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/candidate_predicate/i)).not.toBeInTheDocument();
});

it('shows recovered state as waiting for a separate human product action', async () => {
  server.use(
    http.get('/plan-items/:planItemId/session-diagnostics', () =>
      HttpResponse.json({
        plan_item_id: 'dpi-1',
        workflow_resolution: 'active_workflow',
        workflow_id: 'workflow-1',
        codex_session_id: 'session-1',
        state: 'recovered',
        severity: 'info',
        summary: 'Control state recovered. Choose a separate product action before continuing.',
        operator_intervention_required: false,
        normal_workflow_actions_available: false,
        recovery_request_available: false,
      }),
    ),
  );

  renderDevelopmentPlanItemRoute('/development-plans/dp-1/items/dpi-1');

  expect(await screen.findByText('Control state recovered. Choose a separate product action before continuing.')).toBeInTheDocument();
  expect(screen.getByText(/Continue, fork, and archive remain separate human actions/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^continue$/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /fork/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run route test to verify it fails**

Run: `pnpm vitest run tests/web/development-plan-routes.test.tsx`

Expected: FAIL because diagnostics panel is missing.

- [ ] **Step 3: Implement diagnostics panel**

Create `apps/web/src/features/development-plans/plan-item-session-diagnostics-panel.tsx`:

```tsx
import { AlertTriangle, CheckCircle2, Wrench } from 'lucide-react';
import { usePlanItemSessionDiagnosticsQuery } from '../../shared/api/hooks';
import { InlineNotice, StatusPill } from '../../shared/ui';

export function PlanItemSessionDiagnosticsPanel({ planItemId }: { planItemId: string }) {
  const diagnosticsQuery = usePlanItemSessionDiagnosticsQuery(planItemId);
  const diagnostics = diagnosticsQuery.data;

  if (diagnosticsQuery.isLoading) return <section aria-label="Session health">Loading session health...</section>;
  if (diagnostics === undefined) return <InlineNotice title="Session health unavailable." tone="warning" />;

  if (diagnostics.workflow_resolution === 'no_active_workflow') {
    return <InlineNotice title="No active workflow session yet." tone="info" />;
  }

  if (diagnostics.workflow_resolution === 'ambiguous_workflows') {
    return <InlineNotice title="Workflow lineage needs operator review." tone="danger" />;
  }

  return (
    <section className="grid gap-3 rounded-card border border-border bg-surface p-3" aria-label="Session health">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-text-muted">Session health</p>
          <h3 className="text-sm font-semibold text-text-primary">{diagnostics.summary}</h3>
        </div>
        {diagnostics.state ? <StatusPill tone={diagnostics.severity === 'blocked' ? 'danger' : 'info'}>{diagnostics.state}</StatusPill> : null}
      </div>
      {diagnostics.operator_intervention_required ? (
        <InlineNotice title="Operator intervention required before normal workflow actions can continue." tone="warning" />
      ) : null}
      {diagnostics.latest_checkpoint ? (
        <p className="text-xs text-text-secondary">
          Latest checkpoint: {diagnostics.latest_checkpoint.object_type} / {diagnostics.latest_checkpoint.object_id}
        </p>
      ) : null}
      <p className="text-xs text-text-muted">Continue, fork, and archive remain separate human actions.</p>
    </section>
  );
}
```

- [ ] **Step 4: Integrate into workflow workspace**

Modify `apps/web/src/features/development-plans/plan-item-workflow-workspace.tsx`:

- Import `PlanItemSessionDiagnosticsPanel`.
- Render it near recovery/context in the right column:

```tsx
<PlanItemSessionDiagnosticsPanel planItemId={item.id} />
```

Do not add operator recover/scavenge buttons in the Plan Item workspace.

- [ ] **Step 5: Run focused web tests**

Run: `pnpm vitest run tests/web/development-plan-routes.test.tsx tests/web/session-operations-routes.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/development-plans/plan-item-session-diagnostics-panel.tsx apps/web/src/features/development-plans/plan-item-workflow-workspace.tsx tests/web/development-plan-routes.test.tsx
git commit -m "feat: show plan item session diagnostics"
```

## Task 8: Runbook, Strict Guards, And Final Verification

**Files:**
- Create: `docs/runbooks/plan-item-session-operations.md`
- Create: `scripts/session-operations-scavenge.ts`
- Modify: `scripts/check-codex-runtime-superpowers-no-baggage.ts`
- Modify: `tests/smoke/codex-runtime-no-baggage-gate.test.ts`
- Create: `tests/smoke/session-operations-scavenge-script.test.ts`

- [ ] **Step 1: Write failing no-baggage/runbook guard tests**

Modify `tests/smoke/codex-runtime-no-baggage-gate.test.ts`:

```ts
it('keeps session operations product-level and control-only', () => {
  const scan = scanCodexRuntimeSuperpowersNoBaggage();
  expect(scan.ok).toBe(true);

  const service = readFileSync('apps/control-plane-api/src/modules/session-operations/session-operations.service.ts', 'utf8');
  expect(service).not.toContain('codex_thread_id');
  expect(service).not.toContain('raw capsule');
  expect(service).not.toContain('startExecution(');
  expect(service).not.toContain('createCodexSessionFork(');
});

it('scans every session operations surface in the no-baggage gate', () => {
  const scanTargets = codexRuntimeSuperpowersNoBaggageScanTargets();
  expect(scanTargets).toEqual(
    expect.arrayContaining([
      expect.stringContaining('apps/control-plane-api/src/modules/session-operations'),
      expect.stringContaining('apps/web/src/features/session-operations'),
      expect.stringContaining('docs/runbooks/plan-item-session-operations.md'),
    ]),
  );
});
```

Add route-name checks if the guard has central pattern support:

- `/session-operations/*` is allowed.
- raw worker/runtime public route naming for recover/scavenge is not allowed.
- retired execution start aliases are still blocked.

- [ ] **Step 2: Write failing operator scavenge wrapper tests**

Create `tests/smoke/session-operations-scavenge-script.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('session operations scavenge script', () => {
  it('uses the public Session Operations API and not direct repository writes', () => {
    const source = readFileSync('scripts/session-operations-scavenge.ts', 'utf8');
    expect(source).toContain('/session-operations/scavenge');
    expect(source).not.toContain('@forgeloop/db');
    expect(source).not.toContain('new InMemoryDeliveryRepository');
    expect(source).not.toContain('DrizzleDeliveryRepository');
  });

  it('requires signed actor/operator context inputs', () => {
    const source = readFileSync('scripts/session-operations-scavenge.ts', 'utf8');
    expect(source).toContain('FORGELOOP_ACTOR_ID');
    expect(source).toContain('FORGELOOP_ACTOR_CLASS');
    expect(source).toContain('FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET');
  });

  it('supports execute-mode reason and idempotency prefix inputs', () => {
    const source = readFileSync('scripts/session-operations-scavenge.ts', 'utf8');
    expect(source).toContain('--reason');
    expect(source).toContain('--operation-idempotency-key-prefix');
    expect(source).toContain('reason is required when mode is execute');
    expect(source).toContain('operation-idempotency-key-prefix is required when mode is execute');
  });
});
```

- [ ] **Step 3: Run guard tests to verify they fail if scan roots omit new files**

Run: `pnpm vitest run tests/smoke/codex-runtime-no-baggage-gate.test.ts`

Expected: FAIL until scan roots include new session operations code or until guard expectations are implemented.

- [ ] **Step 4: Update no-baggage scan**

Modify `scripts/check-codex-runtime-superpowers-no-baggage.ts`:

- Add `apps/control-plane-api/src/modules/session-operations` to scan roots.
- Add `apps/web/src/features/session-operations` to scan roots.
- Add `docs/runbooks/plan-item-session-operations.md` to scan files or roots.
- Add `scripts/session-operations-scavenge.ts` to scan files.
- Add new forbidden patterns if needed for raw recovery route naming or hidden continue/fork/delete.

- [ ] **Step 5: Create operator scavenge wrapper**

Create `scripts/session-operations-scavenge.ts`:

- Parse `--mode=dry_run|execute`, optional filters, optional candidate JSON file, `--confirm-execute`, `--reason`, and `--operation-idempotency-key-prefix`.
- For `--mode=execute`, fail before making the HTTP request unless:
  - `--confirm-execute` is present;
  - `--reason` is non-empty;
  - `--operation-idempotency-key-prefix` is non-empty;
  - candidate input is present from the JSON file or explicit candidate arguments.
- Read `FORGELOOP_API_BASE_URL`, `FORGELOOP_ACTOR_ID`, `FORGELOOP_ACTOR_CLASS`, and `FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET`.
- Sign actor headers using the same trusted actor header algorithm used by `actor-context.ts`.
- POST only to `/session-operations/scavenge`.
- Send execute requests with body shape:
  - `mode: 'execute'`;
  - `confirm_execute: true`;
  - `reason`;
  - `operation_idempotency_key_prefix`;
  - `candidates`.
- Print safe JSON response.
- Do not import `@forgeloop/db`, repositories, runtime workers, or Codex clients.
- Do not accept raw capsule paths or raw thread ids.

- [ ] **Step 6: Create runbook**

Create `docs/runbooks/plan-item-session-operations.md` with:

```md
# Plan Item Session Operations Runbook

## Purpose

Use Session Operations when a Plan Item Workflow has a stale lease, orphaned action, missing capsule, lineage conflict, or recovered state that needs an explicit human next action.

## Recovery Rules

- Recovery is control-only.
- Recovery does not invoke Codex.
- Recovery does not create sessions.
- Recovery does not fork or select forks.
- Recovery does not advance workflow status.
- Recovery does not delete capsules.

## Operator Flow

1. Open `/session-operations`.
2. Filter to blocked or attention-needed states.
3. Run scavenge dry-run from `/session-operations` or `scripts/session-operations-scavenge.ts --mode=dry_run`.
4. Inspect the safe candidate summary.
5. Execute recovery only when the candidate predicate still matches:
   `scripts/session-operations-scavenge.ts --mode=execute --confirm-execute --reason="Operator-reviewed stale control cleanup" --operation-idempotency-key-prefix="scavenge-<ticket-or-date>" --candidates-file=./safe-candidates.json`
6. Confirm the recovery record result.
7. Send the Plan Item owner back to the Plan Item workflow for a separate continue/fork/archive decision.

## No-Op Results

Skipped or blocked results mean the projection changed or recovery is unsafe. Do not retry by changing the predicate by hand; refresh health and let the system generate a new candidate.
```

- [ ] **Step 7: Run strict checks**

Run: `pnpm vitest run tests/smoke/codex-runtime-no-baggage-gate.test.ts`

Expected: PASS.

Run: `pnpm vitest run tests/smoke/session-operations-scavenge-script.test.ts`

Expected: PASS.

Run: `pnpm check:codex-runtime-superpowers-no-baggage`

Expected: PASS with no violations.

Run: `pnpm check:runbook-scripts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add docs/runbooks/plan-item-session-operations.md scripts/session-operations-scavenge.ts scripts/check-codex-runtime-superpowers-no-baggage.ts tests/smoke/codex-runtime-no-baggage-gate.test.ts tests/smoke/session-operations-scavenge-script.test.ts
git commit -m "docs: add session operations runbook"
```

## Task 9: End-To-End Verification And Delivery Review

**Files:**
- No new files expected.
- Modify only files required to fix verification failures discovered in this task.

- [ ] **Step 1: Run focused contract/domain/db/API/web gates**

Run:

```bash
pnpm vitest run tests/contracts/session-operations.test.ts tests/domain/session-operations.test.ts tests/db/session-operations-repository.test.ts tests/api/session-operations.test.ts tests/web/session-operations-routes.test.tsx tests/web/development-plan-routes.test.tsx tests/web/api-client-contract.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run adjacent regression gates**

Run:

```bash
pnpm vitest run tests/contracts/plan-item-workflow.test.ts tests/domain/plan-item-workflow.test.ts tests/db/plan-item-workflow-repository.test.ts tests/db/codex-runtime-repository.test.ts tests/api/plan-item-workflows.test.ts tests/api/codex-session-lease.test.ts tests/api/codex-runtime-control-plane.test.ts tests/web/no-legacy-web-ui.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run strict no-baggage and runbook gates**

Run:

```bash
pnpm check:codex-runtime-superpowers-no-baggage
pnpm check:runbook-scripts
```

Expected: PASS.

- [ ] **Step 4: Run full build**

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 5: Optional full test suite if time permits**

Run: `pnpm test`

Expected: PASS.

If full suite is too slow for the current execution window, record the focused and adjacent gates above plus `pnpm build` in the final delivery notes.

- [ ] **Step 6: Inspect git diff for forbidden scope creep**

Run: `git diff --stat HEAD`

Expected:

- New Drizzle migration SQL and metadata are present under `packages/db/migrations`.
- No public fork routes.
- No active fork selection UI.
- No retention cleanup worker.
- No automatic Codex continuation after recovery.
- No raw capsule download route.
- No retired execution route alias.

- [ ] **Step 7: Commit final verification fixes if any**

If Step 1-6 required fixes:

```bash
git add <fixed files>
git commit -m "fix: complete session operations verification"
```

If there were no fixes, do not create an empty commit.

## Acceptance Checklist

- [ ] Operators can list session health without raw Codex runtime files.
- [ ] Plan Item diagnostics can show active/no-active/ambiguous workflow states.
- [ ] Public diagnostics redact predicates, worker digests, idempotency keys, runtime internals, raw paths, raw thread ids, secrets, and full capsule digests.
- [ ] Operator health can include safe metadata and recovery candidates.
- [ ] Stale lease recovery is fenced and idempotent.
- [ ] Orphan action/runtime recovery terminalizes only stale control state.
- [ ] Scavenge dry-run has no mutations.
- [ ] Scavenge execute revalidates every candidate before applying.
- [ ] Applied recovery writes `SessionRecoveryRecord` and public-safe `ObjectEvent`.
- [ ] Skipped/blocked recovery writes explicit `SessionRecoveryRecord` no-op result.
- [ ] Recovery does not invoke Codex, create sessions, fork, select forks, retry execution, advance workflow stage, delete capsules, or mutate approved revision pointers.
- [ ] Capsule retention projection is per-capsule via `CapsuleRetentionPin`.
- [ ] Recovered state requires a later separate human product action.
- [ ] No-baggage guard scans the new Session Operations surfaces.
