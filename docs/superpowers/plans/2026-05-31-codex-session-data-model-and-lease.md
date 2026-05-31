# Codex Session Data Model And Lease Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Wave 2's Plan Item Workflow, Codex Session, transition evidence, lease, fork, and entrypoint guardrail foundation without implementing real Codex app-server resume or `CODEX_HOME` snapshot packaging.

**Architecture:** Add explicit contracts/domain models first, then DB schema/repository persistence, then application services for workflow transitions and session leases, then API routes and legacy-entrypoint guards. Existing Brainstorming, Spec/Plan, automation, runtime job, and run-session records become child records that can reference workflow/session/turn instead of owning Superpowers workflow state.

**Tech Stack:** TypeScript, pnpm, Vitest, NestJS, Drizzle ORM, Zod, existing `@forgeloop/domain`, `@forgeloop/contracts`, `@forgeloop/db`, and control-plane modules.

---

## Scope Check

This plan implements only `docs/superpowers/specs/2026-05-31-codex-session-data-model-and-lease-design.md`.

In scope:

- `PlanItemWorkflow` as the authoritative Superpowers product workflow object.
- `PlanItemWorkflowTransition` append-only ledger.
- `WorkflowManualDecision` persisted evidence object.
- `ExecutionReadinessRecord` aggregate evidence object.
- `CodexSession`, `CodexSessionTurn`, `CodexSessionSnapshot`, and `CodexSessionLease` metadata and repository behavior.
- Initial workflow creation with initial active `CodexSession`.
- Lease CAS/fencing behavior and fork role constraints.
- Workflow service transition validation and evidence validation.
- API routes for workflow transitions plus internal lease/turn metadata routes.
- Legacy public entrypoint guards or routing through `PlanItemWorkflowService`.
- Tests for invalid transitions, wrong evidence, stale leases, fork selection, DTO privacy, and bypass prevention.

Out of scope:

- Real Codex app-server thread resume.
- Packaging or restoring `CODEX_HOME`.
- Running candidate/inactive fork sessions.
- Automatic parsing of Codex or Superpowers dialogue to infer workflow state.
- Extracting structured task lists from Implementation Plan Docs.
- Public UI for the workflow beyond route contract/DTO support.
- Backfilling production data.

## File Structure

### Contracts And Domain

- Create `packages/contracts/src/plan-item-workflow.ts`
  - Owns Zod schemas and exported types for workflow status, transition evidence type, manual decision kind, session status/role, lease status, turn intent/status, public DTOs, and action request DTOs.
- Modify `packages/contracts/src/index.ts`
  - Exports the new contract module.
- Create `packages/domain/src/plan-item-workflow.ts`
  - Owns domain interfaces, transition table, evidence validation helpers, public-safe projection helpers, and typed `DomainError` constructors.
- Modify `packages/domain/src/types.ts`
  - Adds new `DomainErrorCode` values.
- Modify `packages/domain/src/index.ts`
  - Exports the new domain module.
- Test `tests/contracts/plan-item-workflow.test.ts`
  - Contract validation and privacy DTO tests.
- Test `tests/domain/plan-item-workflow.test.ts`
  - Transition table, manual decision kind, evidence type, and public-safe projection tests.

### DB Schema And Repository

- Create `packages/db/src/schema/plan-item-workflow.ts`
  - Defines `plan_item_workflows`, `plan_item_workflow_transitions`, `workflow_manual_decisions`, `execution_readiness_records`, `codex_sessions`, `codex_session_turns`, `codex_session_snapshots`, `codex_session_stale_terminalization_attempts`, and `codex_session_leases`.
- Modify `packages/db/src/schema/index.ts`
  - Exports the new schema.
- Modify existing schema files:
  - `packages/db/src/schema/brainstorming.ts`
  - `packages/db/src/schema/spec.ts`
  - `packages/db/src/schema/execution-plan.ts`
  - `packages/db/src/schema/automation.ts`
  - `packages/db/src/schema/codex-runtime.ts`
  - `packages/db/src/schema/run-session.ts`
  - `packages/db/src/schema/execution-package.ts`
  - Add nullable workflow/session/turn references required by the spec.
- Modify `packages/db/src/reset.ts`
  - Adds reset ordering for the new tables before parent planning/runtime tables.
- Modify `packages/db/src/repositories/delivery-repository.ts`
  - Adds repository input/output interfaces and methods for workflow/session/turn/snapshot/lease/manual-decision/readiness records.
- Modify `packages/db/src/repositories/in-memory-delivery-repository.ts`
  - Implements new repository behavior and uniqueness/CAS constraints.
- Modify `packages/db/src/repositories/drizzle-delivery-repository.ts`
  - Implements new repository behavior with transactions and Drizzle queries.
- Test `tests/db/schema.test.ts`
  - New table, column, index, and privacy-sensitive field presence tests.
- Test `tests/db/reset.test.ts`
  - Reset ordering for child workflow/session tables.
- Test `tests/db/plan-item-workflow-repository.test.ts`
  - Repository contract tests for in-memory and critical Drizzle paths.

### Control-Plane Workflow Module

- Create `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts`
  - Zod schemas for public workflow actions and internal lease/turn terminalization requests.
- Create `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts`
  - Owns workflow creation, transition validation, evidence validation, readiness record creation, fork selection, and projection updates.
- Create `apps/control-plane-api/src/modules/plan-item-workflows/codex-session-lease.service.ts`
  - Owns session lease claim/renew/terminalize/stale handling.
- Create `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.controller.ts`
  - Public workflow routes.
- Create `apps/control-plane-api/src/modules/plan-item-workflows/internal-codex-session.controller.ts`
  - Trusted internal lease/turn/snapshot metadata routes.
- Create `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflows.module.ts`
  - Provides and exports workflow services.
- Modify `apps/control-plane-api/src/app.module.ts`
  - Imports `PlanItemWorkflowsModule` if not already reachable through `DeliveryModule`.
- Modify `apps/control-plane-api/src/modules/delivery/delivery.module.ts`
  - Imports `PlanItemWorkflowsModule` so delivery modules share one workflow service.
- Test `tests/api/plan-item-workflows.test.ts`
  - Public workflow action route tests.
- Test `tests/api/codex-session-lease.test.ts`
  - Internal lease/terminalization route tests.
- Create `tests/helpers/plan-item-workflow-fixtures.ts`
  - Shared persisted UUID-shaped API fixtures for organization, actors, project, repo, Development Plan, Development Plan Item, active workflow, approved document evidence, readiness records, and fork/session setup.

### Existing Service Attachments And Guardrails

- Modify `apps/control-plane-api/src/modules/brainstorming/brainstorming.service.ts`
  - Accepts optional workflow/session/turn refs for child records.
  - Existing public entrypoints either delegate through `PlanItemWorkflowService` or reject when they would bypass workflow state.
- Modify `apps/control-plane-api/src/modules/brainstorming/brainstorming.controller.ts`
  - Adds route guards or routes public state-changing calls through workflow service.
- Modify `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`
  - Accepts workflow/session/turn refs for generated/submitted revisions.
  - Direct public state-changing methods become adapter-safe or reject as legacy bypasses where required by the spec.
- Modify `apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts`
  - Routes workflow-owned state changes through `PlanItemWorkflowService` or returns the legacy disabled error.
- Modify `apps/control-plane-api/src/modules/spec-plan/spec-plan.module.ts`
  - Imports `PlanItemWorkflowsModule` without creating circular provider dependencies.
- Modify `apps/control-plane-api/src/modules/codex-runtime/product-generation-runtime-scheduler.service.ts`
  - Carries workflow/session/turn refs into automation action runs and runtime jobs when present.
- Modify `apps/control-plane-api/src/modules/automation/product-generation-result.service.ts`
  - Applies generated revisions as child evidence and does not independently advance workflow status.
- Modify `apps/control-plane-api/src/modules/executions/executions.service.ts`
  - Carries workflow/session/turn refs to execution/run-session records where execution is workflow-owned.
- Modify schema/repository mapping code for:
  - `automation_action_runs`;
  - `codex_runtime_jobs`;
  - `run_sessions`.
- Test existing API suites:
  - `tests/api/brainstorming.test.ts`;
  - `tests/api/spec-plan-service.test.ts`;
  - `tests/api/codex-runtime-control-plane.test.ts`;
  - `tests/api/executions.test.ts`;
  - Add bypass assertions where existing routes remain public.
- Test `tests/smoke/codex-runtime-no-baggage-gate.test.ts`
  - Adds no-bypass/no-leak checks for workflow/session fields.

## Implementation Rules

- Do not implement app-server resume.
- Do not implement `CODEX_HOME` packaging or restore.
- Do not allow candidate or inactive fork sessions to be claimed in Wave 2.
- Do not allow stale terminalization to update latest session snapshot, thread binding, workflow status, or active session id.
- Do not expose raw `codex_thread_id`, snapshot artifact refs, snapshot digests, credential binding ids, lease token hashes, or worker ids in normal product DTOs.
- Store lease tokens hashed only.
- Keep transition ledger append-only.
- Every workflow status change must write a transition row in the same transaction.
- Existing Development Plan Item status fields may be updated only as projections from workflow transitions.
- Any public route that can mutate Superpowers state must route through `PlanItemWorkflowService` or reject with `workflow_legacy_entrypoint_disabled`.
- Keep existing child services as adapters; do not delete their read/query behavior.
- Use TDD. Write failing tests first for each task.

## Task 1: Contracts And Domain Model

**Files:**
- Create: `packages/contracts/src/plan-item-workflow.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/domain/src/plan-item-workflow.ts`
- Modify: `packages/domain/src/types.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `tests/contracts/plan-item-workflow.test.ts`
- Create: `tests/domain/plan-item-workflow.test.ts`

- [ ] **Step 1: Write failing contract tests**

Create `tests/contracts/plan-item-workflow.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  codexSessionPublicDtoSchema,
  planItemWorkflowPublicDtoSchema,
  planItemWorkflowTransitionSchema,
  workflowManualDecisionSchema,
} from '@forgeloop/contracts';

describe('plan item workflow contracts', () => {
  it('validates transition evidence with supporting evidence', () => {
    const parsed = planItemWorkflowTransitionSchema.parse({
      id: 'transition-1',
      workflow_id: 'workflow-1',
      from_status: 'implementation_plan_review',
      to_status: 'execution_ready',
      actor_id: 'actor-tech',
      evidence_object_type: 'execution_readiness_record',
      evidence_object_id: 'readiness-1',
      supporting_evidence: [
        {
          object_type: 'implementation_plan_revision',
          object_id: 'plan-revision-1',
        },
      ],
      codex_session_id: 'codex-session-1',
      created_at: '2026-05-31T00:00:00.000Z',
    });

    expect(parsed.evidence_object_type).toBe('execution_readiness_record');
  });

  it('rejects invalid manual decision kinds and accepts start_brainstorming', () => {
    expect(() =>
      workflowManualDecisionSchema.parse({
        id: 'decision-1',
        workflow_id: 'workflow-1',
        codex_session_id: 'codex-session-1',
        kind: 'start_brainstorming',
        reason: 'Start Superpowers workflow.',
        created_by_actor_id: 'actor-tech',
        created_at: '2026-05-31T00:00:00.000Z',
      }),
    ).not.toThrow();

    expect(() =>
      workflowManualDecisionSchema.parse({
        id: 'decision-2',
        workflow_id: 'workflow-1',
        codex_session_id: 'codex-session-1',
        kind: 'start',
        reason: 'Ambiguous.',
        created_by_actor_id: 'actor-tech',
        created_at: '2026-05-31T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('keeps normal public DTOs free of raw runtime internals', () => {
    const workflow = planItemWorkflowPublicDtoSchema.parse({
      id: 'workflow-1',
      development_plan_id: 'plan-1',
      development_plan_item_id: 'item-1',
      status: 'brainstorming',
      active_codex_session_id: 'codex-session-1',
      session: {
        id: 'codex-session-1',
        status: 'idle',
        role: 'active',
        continuity_state: 'ready',
        can_continue: true,
        last_turn_at: '2026-05-31T00:00:00.000Z',
      },
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    });

    expect(workflow.session).toMatchObject({ continuity_state: 'ready' });
    expect(() =>
      codexSessionPublicDtoSchema.parse({
        id: 'codex-session-1',
        status: 'idle',
        role: 'active',
        continuity_state: 'ready',
        can_continue: true,
        codex_thread_id: 'raw-thread-id',
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run contract tests to verify they fail**

Run:

```bash
pnpm vitest run tests/contracts/plan-item-workflow.test.ts
```

Expected: FAIL because `@forgeloop/contracts` does not export the new schemas.

- [ ] **Step 3: Add contract schemas**

Create `packages/contracts/src/plan-item-workflow.ts`:

```ts
import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);
const isoDateTime = z.string().datetime();

export const planItemWorkflowStatusSchema = z.enum([
  'not_started',
  'brainstorming',
  'boundary_review',
  'spec_generation_queued',
  'spec_review',
  'implementation_plan_generation_queued',
  'implementation_plan_review',
  'execution_ready',
  'execution_running',
  'code_review',
  'qa',
  'release_ready',
  'blocked',
  'archived',
]);
export type PlanItemWorkflowStatus = z.infer<typeof planItemWorkflowStatusSchema>;

export const workflowTransitionEvidenceObjectTypeSchema = z.enum([
  'boundary_summary_revision',
  'spec_revision',
  'implementation_plan_revision',
  'execution_readiness_record',
  'execution_package',
  'run_session',
  'review_packet',
  'internal_artifact',
  'commit',
  'pull_request',
  'manual_decision',
]);
export type WorkflowTransitionEvidenceObjectType = z.infer<typeof workflowTransitionEvidenceObjectTypeSchema>;

export const workflowManualDecisionKindSchema = z.enum([
  'start_brainstorming',
  'change_request',
  'block',
  'recover',
  'archive',
  'fork_select',
  'override',
]);
export type WorkflowManualDecisionKind = z.infer<typeof workflowManualDecisionKindSchema>;

export const codexSessionStatusSchema = z.enum(['starting', 'idle', 'running', 'blocked', 'recovering', 'archived']);
export type CodexSessionStatus = z.infer<typeof codexSessionStatusSchema>;

export const codexSessionRoleSchema = z.enum(['active', 'candidate_fork', 'inactive_fork']);
export type CodexSessionRole = z.infer<typeof codexSessionRoleSchema>;

export const codexSessionTurnIntentSchema = z.enum([
  'continue_brainstorming',
  'draft_boundary_summary',
  'revise_boundary_summary',
  'draft_spec_doc',
  'revise_spec_doc',
  'draft_implementation_plan_doc',
  'revise_implementation_plan_doc',
  'execute_plan',
  'continue_execution',
  'address_review_feedback',
]);
export type CodexSessionTurnIntent = z.infer<typeof codexSessionTurnIntentSchema>;

export const codexSessionTurnStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'stale']);
export type CodexSessionTurnStatus = z.infer<typeof codexSessionTurnStatusSchema>;

export const codexSessionLeaseStatusSchema = z.enum(['active', 'released', 'expired', 'fenced', 'stale']);
export type CodexSessionLeaseStatus = z.infer<typeof codexSessionLeaseStatusSchema>;

export const transitionSupportingEvidenceSchema = z
  .object({
    object_type: workflowTransitionEvidenceObjectTypeSchema,
    object_id: nonEmpty,
    digest: nonEmpty.optional(),
  })
  .strict();

export const planItemWorkflowTransitionSchema = z
  .object({
    id: nonEmpty,
    workflow_id: nonEmpty,
    from_status: planItemWorkflowStatusSchema,
    to_status: planItemWorkflowStatusSchema,
    actor_id: nonEmpty,
    reason: nonEmpty.optional(),
    evidence_object_type: workflowTransitionEvidenceObjectTypeSchema,
    evidence_object_id: nonEmpty,
    evidence_digest: nonEmpty.optional(),
    supporting_evidence: z.array(transitionSupportingEvidenceSchema).optional(),
    codex_session_id: nonEmpty,
    codex_session_turn_id: nonEmpty.optional(),
    created_at: isoDateTime,
  })
  .strict();
export type PlanItemWorkflowTransition = z.infer<typeof planItemWorkflowTransitionSchema>;

export const workflowManualDecisionSchema = z
  .object({
    id: nonEmpty,
    workflow_id: nonEmpty,
    codex_session_id: nonEmpty,
    kind: workflowManualDecisionKindSchema,
    reason: nonEmpty,
    selected_codex_session_id: nonEmpty.optional(),
    related_object_type: workflowTransitionEvidenceObjectTypeSchema.optional(),
    related_object_id: nonEmpty.optional(),
    created_by_actor_id: nonEmpty,
    created_at: isoDateTime,
  })
  .strict()
  .superRefine((decision, ctx) => {
    if (decision.kind === 'fork_select' && decision.selected_codex_session_id === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['selected_codex_session_id'],
        message: 'fork_select requires selected_codex_session_id',
      });
    }
  });
export type WorkflowManualDecision = z.infer<typeof workflowManualDecisionSchema>;

export const codexSessionPublicDtoSchema = z
  .object({
    id: nonEmpty,
    status: codexSessionStatusSchema,
    role: codexSessionRoleSchema,
    continuity_state: z.enum(['ready', 'running', 'blocked', 'stale']),
    can_continue: z.boolean(),
    last_turn_at: isoDateTime.optional(),
    blocked_reason_code: nonEmpty.optional(),
  })
  .strict();
export type CodexSessionPublicDto = z.infer<typeof codexSessionPublicDtoSchema>;

export const planItemWorkflowPublicDtoSchema = z
  .object({
    id: nonEmpty,
    development_plan_id: nonEmpty,
    development_plan_item_id: nonEmpty,
    status: planItemWorkflowStatusSchema,
    active_codex_session_id: nonEmpty,
    active_boundary_summary_revision_id: nonEmpty.optional(),
    active_spec_doc_revision_id: nonEmpty.optional(),
    active_implementation_plan_doc_revision_id: nonEmpty.optional(),
    execution_package_id: nonEmpty.optional(),
    session: codexSessionPublicDtoSchema,
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict();
export type PlanItemWorkflowPublicDto = z.infer<typeof planItemWorkflowPublicDtoSchema>;
```

Modify `packages/contracts/src/index.ts`:

```ts
export * from './plan-item-workflow.js';
```

- [ ] **Step 4: Run contract tests**

Run:

```bash
pnpm vitest run tests/contracts/plan-item-workflow.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing domain tests**

Create `tests/domain/plan-item-workflow.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  assertPlanItemWorkflowTransitionAllowed,
  assertWorkflowManualDecisionAllowedForTransition,
  codexSessionPublicProjection,
  planItemWorkflowStatusValues,
  type CodexSession,
  type PlanItemWorkflowStatus,
  type WorkflowManualDecision,
} from '@forgeloop/domain';

describe('plan item workflow domain', () => {
  it('accepts only allowed transition/evidence combinations', () => {
    expect(() =>
      assertPlanItemWorkflowTransitionAllowed({
        from_status: 'not_started',
        to_status: 'brainstorming',
        evidence_object_type: 'manual_decision',
        manual_decision_kind: 'start_brainstorming',
      }),
    ).not.toThrow();

    expect(() =>
      assertPlanItemWorkflowTransitionAllowed({
        from_status: 'not_started',
        to_status: 'brainstorming',
        evidence_object_type: 'manual_decision',
        manual_decision_kind: 'override',
      }),
    ).toThrow(/workflow_invalid_transition/);
  });

  it('requires fork_select decisions for same-status active-session replacement', () => {
    expect(() =>
      assertPlanItemWorkflowTransitionAllowed({
        from_status: 'spec_review',
        to_status: 'spec_review',
        evidence_object_type: 'manual_decision',
        manual_decision_kind: 'fork_select',
      }),
    ).not.toThrow();

    expect(() =>
      assertPlanItemWorkflowTransitionAllowed({
        from_status: 'blocked',
        to_status: 'blocked',
        evidence_object_type: 'manual_decision',
        manual_decision_kind: 'fork_select',
      }),
    ).not.toThrow();

    expect(() =>
      assertPlanItemWorkflowTransitionAllowed({
        from_status: 'spec_review',
        to_status: 'spec_review',
        evidence_object_type: 'manual_decision',
        manual_decision_kind: 'override',
      }),
    ).toThrow(/workflow_invalid_transition/);
  });

  it('recovers blocked workflows only to the recorded previous safe status', () => {
    expect(() =>
      assertPlanItemWorkflowTransitionAllowed({
        from_status: 'blocked',
        to_status: 'spec_review',
        previous_status: 'spec_review',
        evidence_object_type: 'manual_decision',
        manual_decision_kind: 'recover',
      }),
    ).not.toThrow();

    expect(() =>
      assertPlanItemWorkflowTransitionAllowed({
        from_status: 'blocked',
        to_status: 'execution_ready',
        previous_status: 'spec_review',
        evidence_object_type: 'manual_decision',
        manual_decision_kind: 'recover',
      }),
    ).toThrow(/workflow_invalid_transition/);
  });

  it('rejects terminal workflow mutations', () => {
    expect(() =>
      assertPlanItemWorkflowTransitionAllowed({
        from_status: 'archived',
        to_status: 'blocked',
        evidence_object_type: 'manual_decision',
        manual_decision_kind: 'block',
      }),
    ).toThrow(/workflow_invalid_transition/);

    expect(() =>
      assertPlanItemWorkflowTransitionAllowed({
        from_status: 'archived',
        to_status: 'archived',
        evidence_object_type: 'manual_decision',
        manual_decision_kind: 'fork_select',
      }),
    ).toThrow(/workflow_invalid_transition/);
  });

  it('validates manual decision kinds against transition intent', () => {
    const decision: WorkflowManualDecision = {
      id: 'decision-1',
      workflow_id: 'workflow-1',
      codex_session_id: 'session-1',
      kind: 'change_request',
      reason: 'Revise the scope.',
      related_object_type: 'spec_revision',
      related_object_id: 'spec-revision-1',
      created_by_actor_id: 'actor-tech',
      created_at: '2026-05-31T00:00:00.000Z',
    };

    expect(() =>
      assertWorkflowManualDecisionAllowedForTransition(decision, {
        from_status: 'spec_review',
        to_status: 'spec_generation_queued',
      }),
    ).not.toThrow();
  });

  it('does not project raw runtime internals into public session DTOs', () => {
    const session: CodexSession = {
      id: 'session-1',
      owner_type: 'plan_item_workflow',
      owner_id: 'workflow-1',
      status: 'idle',
      role: 'active',
      codex_thread_id: 'raw-thread',
      codex_thread_id_digest: 'sha256:abc',
      latest_snapshot_id: 'snapshot-1',
      latest_snapshot_digest: 'sha256:def',
      runtime_profile_id: 'profile-1',
      runtime_profile_revision_id: 'profile-revision-1',
      credential_binding_id: 'credential-1',
      credential_binding_version_id: 'credential-version-1',
      lease_epoch: 0,
      created_by_actor_id: 'actor-tech',
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    };

    expect(codexSessionPublicProjection(session)).toEqual({
      id: 'session-1',
      status: 'idle',
      role: 'active',
      continuity_state: 'ready',
      can_continue: true,
    });
  });

  it('exports the expected status set', () => {
    expect(planItemWorkflowStatusValues satisfies readonly PlanItemWorkflowStatus[]).toContain('implementation_plan_review');
  });
});
```

- [ ] **Step 6: Run domain tests to verify they fail**

Run:

```bash
pnpm vitest run tests/domain/plan-item-workflow.test.ts
```

Expected: FAIL because domain helpers do not exist.

- [ ] **Step 7: Add domain models and helpers**

Create `packages/domain/src/plan-item-workflow.ts` with:

```ts
import { DomainError, type IsoDateTime } from './types.js';
import type {
  CodexSessionLeaseStatus,
  CodexSessionRole,
  CodexSessionStatus,
  CodexSessionTurnIntent,
  CodexSessionTurnStatus,
  PlanItemWorkflowStatus,
  WorkflowManualDecisionKind,
  WorkflowTransitionEvidenceObjectType,
} from '@forgeloop/contracts';

export const planItemWorkflowStatusValues = [
  'not_started',
  'brainstorming',
  'boundary_review',
  'spec_generation_queued',
  'spec_review',
  'implementation_plan_generation_queued',
  'implementation_plan_review',
  'execution_ready',
  'execution_running',
  'code_review',
  'qa',
  'release_ready',
  'blocked',
  'archived',
] as const satisfies readonly PlanItemWorkflowStatus[];

export interface PlanItemWorkflow {
  id: string;
  development_plan_id: string;
  development_plan_item_id: string;
  status: PlanItemWorkflowStatus;
  previous_status?: PlanItemWorkflowStatus;
  active_codex_session_id?: string;
  active_boundary_summary_revision_id?: string;
  active_spec_doc_revision_id?: string;
  active_implementation_plan_doc_revision_id?: string;
  execution_package_id?: string;
  created_by_actor_id: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface TransitionSupportingEvidence {
  object_type: WorkflowTransitionEvidenceObjectType;
  object_id: string;
  digest?: string;
}

export interface PlanItemWorkflowTransition {
  id: string;
  workflow_id: string;
  from_status: PlanItemWorkflowStatus;
  to_status: PlanItemWorkflowStatus;
  actor_id: string;
  reason?: string;
  evidence_object_type: WorkflowTransitionEvidenceObjectType;
  evidence_object_id: string;
  evidence_digest?: string;
  supporting_evidence?: TransitionSupportingEvidence[];
  codex_session_id: string;
  codex_session_turn_id?: string;
  created_at: IsoDateTime;
}

export interface WorkflowManualDecision {
  id: string;
  workflow_id: string;
  codex_session_id: string;
  kind: WorkflowManualDecisionKind;
  reason: string;
  selected_codex_session_id?: string;
  related_object_type?: WorkflowTransitionEvidenceObjectType;
  related_object_id?: string;
  created_by_actor_id: string;
  created_at: IsoDateTime;
}

export interface ExecutionReadinessRecord {
  id: string;
  workflow_id: string;
  development_plan_id: string;
  development_plan_item_id: string;
  codex_session_id: string;
  approved_boundary_summary_revision_id: string;
  approved_spec_revision_id: string;
  approved_implementation_plan_revision_id: string;
  readiness_state: 'ready' | 'not_ready';
  blocker_codes: string[];
  supporting_evidence: TransitionSupportingEvidence[];
  created_by_actor_id: string;
  created_at: IsoDateTime;
}

export interface CodexSession {
  id: string;
  owner_type: 'plan_item_workflow';
  owner_id: string;
  status: CodexSessionStatus;
  role: CodexSessionRole;
  codex_thread_id?: string;
  codex_thread_id_digest?: string;
  latest_snapshot_id?: string;
  latest_snapshot_digest?: string;
  latest_turn_id?: string;
  latest_turn_digest?: string;
  runtime_profile_id: string;
  runtime_profile_revision_id: string;
  credential_binding_id: string;
  credential_binding_version_id: string;
  active_lease_id?: string;
  lease_epoch: number;
  forked_from_session_id?: string;
  forked_from_turn_id?: string;
  forked_from_snapshot_id?: string;
  fork_reason?: string;
  created_by_actor_id: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  archived_at?: IsoDateTime;
}

export interface CodexSessionTurn {
  id: string;
  codex_session_id: string;
  workflow_id: string;
  intent: CodexSessionTurnIntent;
  status: CodexSessionTurnStatus;
  input_digest: string;
  expected_previous_snapshot_digest?: string;
  output_snapshot_id?: string;
  output_snapshot_digest?: string;
  output_object_type?: WorkflowTransitionEvidenceObjectType;
  output_object_id?: string;
  codex_thread_id_digest?: string;
  lease_id?: string;
  lease_epoch?: number;
  automation_action_run_id?: string;
  runtime_job_id?: string;
  created_by_actor_id: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface CodexSessionSnapshot {
  id: string;
  codex_session_id: string;
  sequence: number;
  artifact_ref: string;
  digest: string;
  size_bytes: string;
  manifest_digest: string;
  codex_thread_id_digest?: string;
  runtime_profile_revision_id: string;
  created_from_turn_id?: string;
  created_by_actor_id: string;
  created_at: IsoDateTime;
}

export interface CodexSessionStaleTerminalizationAttempt {
  id: string;
  codex_session_id: string;
  codex_session_turn_id?: string;
  lease_id?: string;
  lease_epoch?: number;
  worker_id: string;
  worker_session_digest: string;
  expected_previous_snapshot_digest?: string;
  attempted_output_snapshot_digest?: string;
  attempted_codex_thread_id_digest?: string;
  failure_code: string;
  created_at: IsoDateTime;
}

export interface CodexSessionLease {
  id: string;
  codex_session_id: string;
  lease_token_hash: string;
  lease_epoch: number;
  worker_id: string;
  worker_session_digest: string;
  status: CodexSessionLeaseStatus;
  acquired_at: IsoDateTime;
  heartbeat_at?: IsoDateTime;
  expires_at: IsoDateTime;
  released_at?: IsoDateTime;
  fenced_at?: IsoDateTime;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

interface TransitionCheck {
  from_status: PlanItemWorkflowStatus;
  to_status: PlanItemWorkflowStatus;
  previous_status?: PlanItemWorkflowStatus;
  evidence_object_type: WorkflowTransitionEvidenceObjectType;
  manual_decision_kind?: WorkflowManualDecisionKind;
}

const exactTransitions = new Set<string>([
  'not_started->brainstorming|manual_decision|start_brainstorming',
  'brainstorming->boundary_review|boundary_summary_revision|',
  'boundary_review->brainstorming|manual_decision|change_request',
  'boundary_review->spec_generation_queued|boundary_summary_revision|',
  'spec_generation_queued->spec_review|spec_revision|',
  'spec_review->spec_generation_queued|manual_decision|change_request',
  'spec_review->implementation_plan_generation_queued|spec_revision|',
  'implementation_plan_generation_queued->implementation_plan_review|implementation_plan_revision|',
  'implementation_plan_review->implementation_plan_generation_queued|manual_decision|change_request',
  'implementation_plan_review->execution_ready|execution_readiness_record|',
  'execution_ready->execution_running|execution_package|',
  'execution_running->code_review|run_session|',
  'execution_running->code_review|commit|',
  'code_review->qa|review_packet|',
  'code_review->qa|pull_request|',
  'code_review->qa|manual_decision|override',
  'qa->release_ready|manual_decision|override',
]);

const transitionKey = (input: TransitionCheck) =>
  `${input.from_status}->${input.to_status}|${input.evidence_object_type}|${input.manual_decision_kind ?? ''}`;

export const assertPlanItemWorkflowTransitionAllowed = (input: TransitionCheck): void => {
  if (exactTransitions.has(transitionKey(input))) return;
  if (
    input.to_status === 'blocked' &&
    input.from_status !== 'blocked' &&
    input.from_status !== 'archived' &&
    input.evidence_object_type === 'manual_decision' &&
    input.manual_decision_kind === 'block'
  ) {
    return;
  }
  if (
    input.from_status === 'blocked' &&
    input.evidence_object_type === 'manual_decision' &&
    input.manual_decision_kind === 'recover' &&
    input.previous_status !== undefined &&
    input.to_status === input.previous_status &&
    input.to_status !== 'blocked' &&
    input.to_status !== 'archived'
  ) {
    return;
  }
  if (
    input.to_status === 'archived' &&
    input.from_status !== 'archived' &&
    input.evidence_object_type === 'manual_decision' &&
    input.manual_decision_kind === 'archive'
  ) {
    return;
  }
  if (
    input.from_status === input.to_status &&
    input.from_status !== 'archived' &&
    input.evidence_object_type === 'manual_decision' &&
    input.manual_decision_kind === 'fork_select'
  ) {
    return;
  }

  throw new DomainError('workflow_invalid_transition', `Invalid workflow transition ${transitionKey(input)}`);
};

export const assertWorkflowManualDecisionAllowedForTransition = (
  decision: WorkflowManualDecision,
  transition: Pick<TransitionCheck, 'from_status' | 'to_status' | 'previous_status'>,
): void =>
  assertPlanItemWorkflowTransitionAllowed({
    ...transition,
    evidence_object_type: 'manual_decision',
    manual_decision_kind: decision.kind,
  });

export const codexSessionPublicProjection = (session: CodexSession) => ({
  id: session.id,
  status: session.status,
  role: session.role,
  continuity_state:
    session.status === 'blocked' ? ('blocked' as const) : session.status === 'running' ? ('running' as const) : ('ready' as const),
  can_continue: session.status === 'idle' && session.role === 'active',
  ...(session.latest_turn_id === undefined ? {} : { last_turn_at: session.updated_at }),
  ...(session.status === 'blocked' ? { blocked_reason_code: 'codex_session_blocked' } : {}),
});

export const assertWorkflowActorAuthorized = (
  workflow: Pick<PlanItemWorkflow, 'development_plan_item_id'>,
  action:
    | 'start_brainstorming'
    | 'submit_document_gate'
    | 'approve_document_gate'
    | 'block'
    | 'recover'
    | 'archive'
    | 'start_execution'
    | 'select_fork',
  actorContext: {
    actor_id: string;
    actor_class?: string;
    development_plan_item?: {
      driver_actor_id?: string;
      reviewer_actor_id?: string;
      leader_actor_id?: string;
      leader_delegate_actor_ids?: string[];
    };
    execution_owner_actor_id?: string;
  },
): void => {
  const item = actorContext.development_plan_item;
  const techLeads = new Set([item?.leader_actor_id, item?.reviewer_actor_id, ...(item?.leader_delegate_actor_ids ?? [])].filter(Boolean));
  const productActors = new Set([item?.driver_actor_id, ...techLeads].filter(Boolean));
  const operators = new Set(['human_admin', 'automation_daemon', 'system_bootstrap']);
  const isOperator = actorContext.actor_class !== undefined && operators.has(actorContext.actor_class);
  const actorId = actorContext.actor_id;

  const allowed =
    (action === 'start_brainstorming' && productActors.has(actorId)) ||
    ((action === 'submit_document_gate' || action === 'approve_document_gate' || action === 'select_fork') && techLeads.has(actorId)) ||
    (action === 'start_execution' && (actorContext.execution_owner_actor_id === actorId || techLeads.has(actorId))) ||
    ((action === 'block' || action === 'recover' || action === 'archive') && (techLeads.has(actorId) || isOperator));

  if (!allowed) {
    throw new DomainError('workflow_actor_not_authorized', `Actor ${actorId} cannot perform ${action} on workflow item ${workflow.development_plan_item_id}`);
  }
};
```

Modify `packages/domain/src/types.ts` `DomainErrorCode` union to include:

```ts
| 'workflow_invalid_transition'
| 'workflow_evidence_missing'
| 'workflow_evidence_type_invalid'
| 'workflow_evidence_not_owned'
| 'workflow_actor_not_authorized'
| 'workflow_active_session_missing'
| 'workflow_active_session_conflict'
| 'codex_session_lease_conflict'
| 'codex_session_lease_expired'
| 'codex_session_stale_terminalization'
| 'codex_session_snapshot_stale'
| 'codex_session_thread_binding_conflict'
| 'codex_session_fork_invalid'
| 'workflow_legacy_entrypoint_disabled'
```

Modify `packages/domain/src/index.ts`:

```ts
export * from './plan-item-workflow.js';
```

- [ ] **Step 8: Run domain tests**

Run:

```bash
pnpm vitest run tests/domain/plan-item-workflow.test.ts tests/contracts/plan-item-workflow.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit contracts and domain**

```bash
git add packages/contracts/src/plan-item-workflow.ts packages/contracts/src/index.ts packages/domain/src/plan-item-workflow.ts packages/domain/src/types.ts packages/domain/src/index.ts tests/contracts/plan-item-workflow.test.ts tests/domain/plan-item-workflow.test.ts
git commit -m "feat: add plan item workflow domain contracts"
```

## Task 2: DB Schema And Repository Persistence

**Files:**
- Create: `packages/db/src/schema/plan-item-workflow.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/schema/brainstorming.ts`
- Modify: `packages/db/src/schema/spec.ts`
- Modify: `packages/db/src/schema/execution-plan.ts`
- Modify: `packages/db/src/schema/automation.ts`
- Modify: `packages/db/src/schema/codex-runtime.ts`
- Modify: `packages/db/src/schema/run-session.ts`
- Modify: `packages/db/drizzle.config.ts`
- Modify: `packages/db/src/reset.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Modify: `package.json`
- Create: `packages/db/migrations/<generated-plan-item-workflow-session-migration>.sql`
- Modify: `tests/db/schema.test.ts`
- Modify: `tests/db/reset.test.ts`
- Create: `tests/db/plan-item-workflow-repository.test.ts`

- [ ] **Step 1: Write failing schema tests**

Modify `tests/db/schema.test.ts` imports to include:

```ts
plan_item_workflows,
plan_item_workflow_transitions,
workflow_manual_decisions,
execution_readiness_records,
codex_sessions,
codex_session_turns,
codex_session_snapshots,
codex_session_stale_terminalization_attempts,
codex_session_leases,
```

Add these to `requiredTables`.

Add tests:

```ts
it('defines Plan Item Workflow and Codex Session tables', () => {
  expect(primaryKeyColumnNames(plan_item_workflows)).toEqual([['id']]);
  expect(columnType(plan_item_workflows, 'status')).toBe('PgText');
  expect(columnNotNull(plan_item_workflows, 'development_plan_item_id')).toBe(true);
  expect(columnNotNull(plan_item_workflows, 'created_by_actor_id')).toBe(true);
  expect(hasIndex(plan_item_workflows, 'plan_item_workflows_item_idx', ['development_plan_id', 'development_plan_item_id'])).toBe(true);

  expect(primaryKeyColumnNames(codex_sessions)).toEqual([['id']]);
  expect(columnNotNull(codex_sessions, 'role')).toBe(true);
  expect(columnNotNull(codex_sessions, 'lease_epoch')).toBe(true);
  expect(columnNotNull(codex_sessions, 'created_by_actor_id')).toBe(true);
  expect(hasIndex(codex_sessions, 'codex_sessions_owner_idx', ['owner_type', 'owner_id'])).toBe(true);

  expect(columnNotNull(plan_item_workflow_transitions, 'actor_id')).toBe(true);
  expect(columnNotNull(workflow_manual_decisions, 'created_by_actor_id')).toBe(true);
  expect(columnNotNull(execution_readiness_records, 'created_by_actor_id')).toBe(true);
  expect(columnNotNull(codex_session_turns, 'created_by_actor_id')).toBe(true);
  expect(columnNotNull(codex_session_snapshots, 'created_by_actor_id')).toBe(true);

  expect(primaryKeyColumnNames(codex_session_leases)).toEqual([['id']]);
  expect(columnNotNull(codex_session_leases, 'lease_token_hash')).toBe(true);
  expect(hasIndex(codex_session_leases, 'codex_session_leases_session_epoch_idx', ['codex_session_id', 'lease_epoch'])).toBe(true);
});

it('adds workflow references to child delivery records', () => {
  expect(columnType(brainstorming_sessions, 'workflow_id')).toBe('PgUUID');
  expect(columnType(spec_revisions, 'codex_session_turn_id')).toBe('PgUUID');
  expect(columnType(execution_plan_revisions, 'codex_session_turn_id')).toBe('PgUUID');
  expect(columnType(automation_action_runs, 'workflow_id')).toBe('PgUUID');
  expect(columnType(codex_runtime_jobs, 'codex_session_turn_id')).toBe('PgUUID');
  expect(columnType(run_sessions, 'codex_session_turn_id')).toBe('PgUUID');
});
```

Modify `tests/db/reset.test.ts` to assert new tables truncate before parent records:

```ts
expect(resettableTables.indexOf('codex_session_leases')).toBeLessThan(resettableTables.indexOf('codex_sessions'));
expect(resettableTables.indexOf('codex_session_stale_terminalization_attempts')).toBeLessThan(resettableTables.indexOf('codex_sessions'));
expect(resettableTables.indexOf('codex_session_turns')).toBeLessThan(resettableTables.indexOf('codex_sessions'));
expect(resettableTables.indexOf('plan_item_workflow_transitions')).toBeLessThan(resettableTables.indexOf('plan_item_workflows'));
expect(resettableTables.indexOf('plan_item_workflows')).toBeLessThan(resettableTables.indexOf('development_plan_items'));
```

- [ ] **Step 2: Run schema tests to verify they fail**

Run:

```bash
pnpm vitest run tests/db/schema.test.ts tests/db/reset.test.ts
```

Expected: FAIL because tables and columns do not exist.

- [ ] **Step 3: Add DB schema**

Create `packages/db/src/schema/plan-item-workflow.ts`:

```ts
import { sql } from 'drizzle-orm';
import { integer, jsonb, pgTable, text, uniqueIndex, index, uuid } from 'drizzle-orm/pg-core';
import type {
  CodexSession,
  CodexSessionLease,
  CodexSessionSnapshot,
  CodexSessionStaleTerminalizationAttempt,
  CodexSessionTurn,
  ExecutionReadinessRecord,
  PlanItemWorkflow,
  PlanItemWorkflowTransition,
  WorkflowManualDecision,
} from '@forgeloop/domain';

import { timestampColumn } from './_shared';
import { actors } from './actor';
import { development_plan_items, development_plans } from './development-plan';

export const plan_item_workflows = pgTable(
  'plan_item_workflows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    developmentPlanId: uuid('development_plan_id').notNull().references(() => development_plans.id),
    developmentPlanItemId: uuid('development_plan_item_id').notNull().references(() => development_plan_items.id),
    status: text('status').$type<PlanItemWorkflow['status']>().notNull(),
    previousStatus: text('previous_status').$type<PlanItemWorkflow['previous_status']>(),
    activeCodexSessionId: uuid('active_codex_session_id'),
    activeBoundarySummaryRevisionId: uuid('active_boundary_summary_revision_id'),
    activeSpecDocRevisionId: uuid('active_spec_doc_revision_id'),
    activeImplementationPlanDocRevisionId: uuid('active_implementation_plan_doc_revision_id'),
    executionPackageId: uuid('execution_package_id'),
    createdByActorId: uuid('created_by_actor_id').notNull().references(() => actors.id),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [
    index('plan_item_workflows_item_idx').on(table.developmentPlanId, table.developmentPlanItemId),
    index('plan_item_workflows_active_session_idx').on(table.activeCodexSessionId),
    uniqueIndex('plan_item_workflows_one_active_per_item_idx')
      .on(table.developmentPlanItemId)
      .where(sql`${table.status} <> 'archived'`),
  ],
);

export const codex_sessions = pgTable(
  'codex_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerType: text('owner_type').$type<CodexSession['owner_type']>().notNull(),
    ownerId: uuid('owner_id').notNull(),
    status: text('status').$type<CodexSession['status']>().notNull(),
    role: text('role').$type<CodexSession['role']>().notNull(),
    codexThreadId: text('codex_thread_id'),
    codexThreadIdDigest: text('codex_thread_id_digest'),
    latestSnapshotId: uuid('latest_snapshot_id'),
    latestSnapshotDigest: text('latest_snapshot_digest'),
    latestTurnId: uuid('latest_turn_id'),
    latestTurnDigest: text('latest_turn_digest'),
    runtimeProfileId: uuid('runtime_profile_id').notNull(),
    runtimeProfileRevisionId: uuid('runtime_profile_revision_id').notNull(),
    credentialBindingId: uuid('credential_binding_id').notNull(),
    credentialBindingVersionId: uuid('credential_binding_version_id').notNull(),
    activeLeaseId: uuid('active_lease_id'),
    leaseEpoch: integer('lease_epoch').notNull().default(0),
    forkedFromSessionId: uuid('forked_from_session_id'),
    forkedFromTurnId: uuid('forked_from_turn_id'),
    forkedFromSnapshotId: uuid('forked_from_snapshot_id'),
    forkReason: text('fork_reason'),
    createdByActorId: uuid('created_by_actor_id').notNull().references(() => actors.id),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
    archivedAt: timestampColumn('archived_at'),
  },
  (table) => [
    index('codex_sessions_owner_idx').on(table.ownerType, table.ownerId),
    index('codex_sessions_owner_role_idx').on(table.ownerId, table.role),
    index('codex_sessions_thread_digest_idx').on(table.codexThreadIdDigest),
    index('codex_sessions_latest_snapshot_idx').on(table.latestSnapshotId),
    index('codex_sessions_active_lease_idx').on(table.activeLeaseId),
    uniqueIndex('codex_sessions_one_active_per_workflow_idx')
      .on(table.ownerId)
      .where(sql`${table.role} = 'active' and ${table.status} <> 'archived'`),
  ],
);

export const plan_item_workflow_transitions = pgTable(
  'plan_item_workflow_transitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => plan_item_workflows.id),
    fromStatus: text('from_status').$type<PlanItemWorkflowTransition['from_status']>().notNull(),
    toStatus: text('to_status').$type<PlanItemWorkflowTransition['to_status']>().notNull(),
    actorId: uuid('actor_id').notNull().references(() => actors.id),
    reason: text('reason'),
    evidenceObjectType: text('evidence_object_type')
      .$type<PlanItemWorkflowTransition['evidence_object_type']>()
      .notNull(),
    evidenceObjectId: text('evidence_object_id').notNull(),
    evidenceDigest: text('evidence_digest'),
    supportingEvidence: jsonb('supporting_evidence')
      .$type<NonNullable<PlanItemWorkflowTransition['supporting_evidence']>>()
      .notNull()
      .default([]),
    codexSessionId: uuid('codex_session_id')
      .notNull()
      .references(() => codex_sessions.id),
    codexSessionTurnId: uuid('codex_session_turn_id'),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    index('plan_item_workflow_transitions_workflow_created_idx').on(table.workflowId, table.createdAt),
    index('plan_item_workflow_transitions_evidence_idx').on(table.evidenceObjectType, table.evidenceObjectId),
    index('plan_item_workflow_transitions_session_idx').on(table.codexSessionId),
  ],
);

export const workflow_manual_decisions = pgTable(
  'workflow_manual_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => plan_item_workflows.id),
    codexSessionId: uuid('codex_session_id')
      .notNull()
      .references(() => codex_sessions.id),
    kind: text('kind').$type<WorkflowManualDecision['kind']>().notNull(),
    reason: text('reason').notNull(),
    selectedCodexSessionId: uuid('selected_codex_session_id').references(() => codex_sessions.id),
    relatedObjectType: text('related_object_type').$type<WorkflowManualDecision['related_object_type']>(),
    relatedObjectId: text('related_object_id'),
    createdByActorId: uuid('created_by_actor_id').notNull().references(() => actors.id),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    index('workflow_manual_decisions_workflow_created_idx').on(table.workflowId, table.createdAt),
    index('workflow_manual_decisions_session_idx').on(table.codexSessionId),
    index('workflow_manual_decisions_kind_created_idx').on(table.kind, table.createdAt),
  ],
);

export const execution_readiness_records = pgTable(
  'execution_readiness_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => plan_item_workflows.id),
    developmentPlanId: uuid('development_plan_id')
      .notNull()
      .references(() => development_plans.id),
    developmentPlanItemId: uuid('development_plan_item_id')
      .notNull()
      .references(() => development_plan_items.id),
    codexSessionId: uuid('codex_session_id')
      .notNull()
      .references(() => codex_sessions.id),
    approvedBoundarySummaryRevisionId: uuid('approved_boundary_summary_revision_id').notNull(),
    approvedSpecRevisionId: uuid('approved_spec_revision_id').notNull(),
    approvedImplementationPlanRevisionId: uuid('approved_implementation_plan_revision_id').notNull(),
    readinessState: text('readiness_state').$type<ExecutionReadinessRecord['readiness_state']>().notNull(),
    blockerCodes: jsonb('blocker_codes').$type<ExecutionReadinessRecord['blocker_codes']>().notNull(),
    supportingEvidence: jsonb('supporting_evidence')
      .$type<ExecutionReadinessRecord['supporting_evidence']>()
      .notNull(),
    createdByActorId: uuid('created_by_actor_id').notNull().references(() => actors.id),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    index('execution_readiness_records_workflow_idx').on(table.workflowId),
    index('execution_readiness_records_item_idx').on(table.developmentPlanItemId),
    index('execution_readiness_records_session_idx').on(table.codexSessionId),
    index('execution_readiness_records_plan_revision_idx').on(table.approvedImplementationPlanRevisionId),
  ],
);

export const codex_session_stale_terminalization_attempts = pgTable(
  'codex_session_stale_terminalization_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codexSessionId: uuid('codex_session_id')
      .notNull()
      .references(() => codex_sessions.id),
    codexSessionTurnId: uuid('codex_session_turn_id').references(() => codex_session_turns.id),
    leaseId: uuid('lease_id'),
    leaseEpoch: integer('lease_epoch'),
    workerId: text('worker_id').notNull(),
    workerSessionDigest: text('worker_session_digest').notNull(),
    expectedPreviousSnapshotDigest: text('expected_previous_snapshot_digest'),
    attemptedOutputSnapshotDigest: text('attempted_output_snapshot_digest'),
    attemptedCodexThreadIdDigest: text('attempted_codex_thread_id_digest'),
    failureCode: text('failure_code').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    index('codex_session_stale_terminalization_attempts_session_idx').on(table.codexSessionId, table.createdAt),
    index('codex_session_stale_terminalization_attempts_turn_idx').on(table.codexSessionTurnId),
  ],
);

export const codex_session_turns = pgTable(
  'codex_session_turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codexSessionId: uuid('codex_session_id')
      .notNull()
      .references(() => codex_sessions.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => plan_item_workflows.id),
    intent: text('intent').$type<CodexSessionTurn['intent']>().notNull(),
    status: text('status').$type<CodexSessionTurn['status']>().notNull(),
    inputDigest: text('input_digest').notNull(),
    expectedPreviousSnapshotDigest: text('expected_previous_snapshot_digest'),
    outputSnapshotId: uuid('output_snapshot_id'),
    outputSnapshotDigest: text('output_snapshot_digest'),
    outputObjectType: text('output_object_type').$type<CodexSessionTurn['output_object_type']>(),
    outputObjectId: text('output_object_id'),
    codexThreadIdDigest: text('codex_thread_id_digest'),
    leaseId: uuid('lease_id'),
    leaseEpoch: integer('lease_epoch'),
    automationActionRunId: uuid('automation_action_run_id'),
    runtimeJobId: uuid('runtime_job_id'),
    createdByActorId: uuid('created_by_actor_id').notNull().references(() => actors.id),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [
    index('codex_session_turns_session_created_idx').on(table.codexSessionId, table.createdAt),
    index('codex_session_turns_workflow_created_idx').on(table.workflowId, table.createdAt),
    index('codex_session_turns_runtime_job_idx').on(table.runtimeJobId),
    index('codex_session_turns_action_run_idx').on(table.automationActionRunId),
  ],
);

export const codex_session_snapshots = pgTable(
  'codex_session_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codexSessionId: uuid('codex_session_id')
      .notNull()
      .references(() => codex_sessions.id),
    sequence: integer('sequence').notNull(),
    artifactRef: text('artifact_ref').notNull(),
    digest: text('digest').notNull(),
    sizeBytes: text('size_bytes').notNull(),
    manifestDigest: text('manifest_digest').notNull(),
    codexThreadIdDigest: text('codex_thread_id_digest'),
    runtimeProfileRevisionId: uuid('runtime_profile_revision_id').notNull(),
    createdFromTurnId: uuid('created_from_turn_id'),
    createdByActorId: uuid('created_by_actor_id').notNull().references(() => actors.id),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('codex_session_snapshots_session_sequence_unique').on(table.codexSessionId, table.sequence),
    uniqueIndex('codex_session_snapshots_artifact_ref_unique').on(table.artifactRef),
    index('codex_session_snapshots_session_created_idx').on(table.codexSessionId, table.createdAt),
  ],
);

export const codex_session_leases = pgTable(
  'codex_session_leases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codexSessionId: uuid('codex_session_id')
      .notNull()
      .references(() => codex_sessions.id),
    leaseTokenHash: text('lease_token_hash').notNull(),
    leaseEpoch: integer('lease_epoch').notNull(),
    workerId: text('worker_id').notNull(),
    workerSessionDigest: text('worker_session_digest').notNull(),
    status: text('status').$type<CodexSessionLease['status']>().notNull(),
    acquiredAt: timestampColumn('acquired_at').notNull(),
    heartbeatAt: timestampColumn('heartbeat_at'),
    expiresAt: timestampColumn('expires_at').notNull(),
    releasedAt: timestampColumn('released_at'),
    fencedAt: timestampColumn('fenced_at'),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('codex_session_leases_one_active_per_session_idx')
      .on(table.codexSessionId)
      .where(sql`${table.status} = 'active'`),
    index('codex_session_leases_session_epoch_idx').on(table.codexSessionId, table.leaseEpoch),
    index('codex_session_leases_worker_status_idx').on(table.workerId, table.status),
    index('codex_session_leases_expires_at_idx').on(table.expiresAt),
  ],
);
```

Important: add these foreign-key references only after both tables exist, or keep nullable UUID refs without direct FK if Drizzle circular references become awkward:

- `plan_item_workflows.activeCodexSessionId -> codex_sessions.id`;
- `codex_sessions.activeLeaseId -> codex_session_leases.id`.
- All required actor attribution columns from the spec must be `.notNull()`: `plan_item_workflows.createdByActorId`, `plan_item_workflow_transitions.actorId`, `workflow_manual_decisions.createdByActorId`, `execution_readiness_records.createdByActorId`, `codex_sessions.createdByActorId`, `codex_session_turns.createdByActorId`, and `codex_session_snapshots.createdByActorId`.

Modify `packages/db/src/schema/index.ts`:

```ts
export * from './plan-item-workflow';
```

Modify child schema files to add nullable columns:

```ts
workflowId: uuid('workflow_id').references(() => plan_item_workflows.id),
codexSessionId: uuid('codex_session_id').references(() => codex_sessions.id),
codexSessionTurnId: uuid('codex_session_turn_id').references(() => codex_session_turns.id),
```

Use the exact table-to-column mapping from the File Structure section:

- `brainstorming_sessions`: `workflow_id`, `codex_session_id`;
- `boundary_rounds`: `codex_session_turn_id`;
- `boundary_summary_revisions`: `workflow_id`, `codex_session_id`;
- `specs`: `workflow_id`;
- `spec_revisions`: `workflow_id`, `codex_session_id`, `codex_session_turn_id`;
- `execution_plans`: `workflow_id`;
- `execution_plan_revisions`: `workflow_id`, `codex_session_id`, `codex_session_turn_id`;
- `automation_action_runs`: `workflow_id`, `codex_session_id`, `codex_session_turn_id`;
- `codex_runtime_jobs`: `workflow_id`, `codex_session_id`, `codex_session_turn_id`;
- `execution_packages`: `workflow_id`, `codex_session_id`, `codex_session_turn_id`;
- `run_sessions`: `workflow_id`, `codex_session_id`, `codex_session_turn_id`;
- `review_packets`: `workflow_id`, `codex_session_id`, `codex_session_turn_id`.

In this same task, extend the matching domain interfaces and repository row mappers so `PlanItemWorkflowService` in Task 3 can validate ownership without waiting for Task 5:

- `packages/domain/src/brainstorming.ts`: add optional refs to `BrainstormingSession`, `BoundaryRound` if represented in domain, and `BoundarySummaryRevision`;
- `packages/domain/src/types.ts`: add optional refs to `Spec`, `SpecRevision`, `ExecutionPackage`, `RunSession`, and `ReviewPacket`;
- `packages/domain/src/execution-supervision.ts`: add optional refs to `ExecutionPlanDocument` and `ExecutionPlanRevision`;
- `packages/domain/src/automation.ts` and `packages/domain/src/codex-runtime.ts`: add optional refs to automation action runs and runtime jobs.

Task 5 later wires services to populate these fields. Task 2 only makes the fields persistable and readable.

Modify `packages/db/src/reset.ts` to add new child tables before parent tables:

```ts
'codex_session_leases',
'codex_session_stale_terminalization_attempts',
'codex_session_snapshots',
'codex_session_turns',
'execution_readiness_records',
'workflow_manual_decisions',
'plan_item_workflow_transitions',
'codex_sessions',
'plan_item_workflows',
```

Place them before `automation_action_runs`, `run_sessions`, `execution_plan_revisions`, `spec_revisions`, `brainstorming_sessions`, and `development_plan_items` so FK truncation stays safe.

- [ ] **Step 4: Run schema tests**

Run:

```bash
pnpm vitest run tests/db/schema.test.ts tests/db/reset.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add migration generation support and generate SQL migration**

Modify `packages/db/drizzle.config.ts` so Drizzle Kit has a formal SQL migration output directory:

```ts
export default defineConfig({
  schema: './packages/db/src/schema/index.ts',
  out: './packages/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url,
  },
});
```

Modify root `package.json` scripts to keep the existing local push workflow and add formal migration commands:

```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate --config packages/db/drizzle.config.ts",
    "db:migrate": "drizzle-kit migrate --config packages/db/drizzle.config.ts",
    "db:push": "drizzle-kit push --config packages/db/drizzle.config.ts"
  }
}
```

Run:

```bash
export FORGELOOP_POSTGRES_PORT="${FORGELOOP_POSTGRES_PORT:-35432}"
FORGELOOP_DATABASE_URL="postgresql://forgeloop:forgeloop@127.0.0.1:${FORGELOOP_POSTGRES_PORT}/forgeloop" pnpm db:generate
```

Expected: PASS and a new SQL migration file under `packages/db/migrations/`.

Review the generated SQL before continuing. If this repo still has no committed `packages/db/migrations/` directory when the task is executed, this first formal migration may be a full fresh-database baseline that includes the existing schema plus the new workflow/session/lease changes. That is acceptable for Wave 2 because the product is not launched and the implementation target is a fresh deployable schema. If a migrations directory already exists by execution time, the generated SQL must be incremental.

In either case, the SQL must include the new workflow/session/lease tables, nullable workflow/session/turn references on existing child tables, and required indexes/unique constraints from the spec. It must not drop existing delivery tables or columns. If Drizzle Kit asks about renames, choose explicit create/add behavior; do not let it infer destructive renames or drops.

- [ ] **Step 6: Verify migration applies to a disposable database**

Run against a disposable local database URL, not a shared developer database. The default local Postgres port is `35432`; if that port is already used, set `FORGELOOP_POSTGRES_PORT` to a free port before starting compose.

Start or reuse the project Postgres container:

```bash
export FORGELOOP_POSTGRES_PORT="${FORGELOOP_POSTGRES_PORT:-35432}"
docker compose up -d postgres
```

Create a disposable migration-check database inside that Postgres instance:

```bash
docker compose exec -T postgres dropdb -U forgeloop --if-exists forgeloop_migration_check
docker compose exec -T postgres createdb -U forgeloop forgeloop_migration_check
```

Apply migrations to the disposable database:

```bash
FORGELOOP_DATABASE_URL="postgresql://forgeloop:forgeloop@127.0.0.1:${FORGELOOP_POSTGRES_PORT}/forgeloop_migration_check" pnpm db:migrate
```

Expected: PASS.

Then run:

```bash
FORGELOOP_DATABASE_URL="postgresql://forgeloop:forgeloop@127.0.0.1:${FORGELOOP_POSTGRES_PORT}/forgeloop_migration_check" pnpm vitest run tests/db/schema.test.ts tests/db/reset.test.ts
```

Expected: PASS.

Clean up only the disposable migration-check database:

```bash
docker compose exec -T postgres dropdb -U forgeloop --if-exists forgeloop_migration_check
```

- [ ] **Step 7: Write failing repository tests**

Create `tests/db/plan-item-workflow-repository.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DomainError } from '@forgeloop/domain';
import { InMemoryDeliveryRepository } from '../../packages/db/src/index';

const now = '2026-05-31T00:00:00.000Z';

const expectDomainErrorCode = async (action: () => Promise<unknown>, code: string) => {
  try {
    await action();
      throw new Error(`Expected DomainError ${code}`);
    } catch (error) {
      if (error instanceof Error && error.message === `Expected DomainError ${code}`) throw error;
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe(code as DomainError['code']);
    }
  };

const baseWorkflowInput = {
  id: 'workflow-1',
  codex_session_id: 'session-1',
  development_plan_id: 'plan-1',
  development_plan_item_id: 'item-1',
  runtime_profile_id: 'profile-1',
  runtime_profile_revision_id: 'profile-revision-1',
  credential_binding_id: 'credential-1',
  credential_binding_version_id: 'credential-version-1',
  actor_id: 'actor-tech',
  now,
};

// These repository-only tests may use simple string ids because they test the
// in-memory repository contract without Drizzle FK enforcement. API tests must
// use persisted fixture records with UUID-shaped ids.
describe('Plan Item Workflow repository', () => {
  it('creates workflow with initial active Codex Session', async () => {
    const repository = new InMemoryDeliveryRepository();

    const created = await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);

    expect(created.workflow).toMatchObject({
      id: 'workflow-1',
      status: 'not_started',
      active_codex_session_id: 'session-1',
    });
    expect(created.session).toMatchObject({
      id: 'session-1',
      status: 'idle',
      role: 'active',
      owner_id: 'workflow-1',
      lease_epoch: 0,
    });
  });

  it('rejects a second active workflow for the same Plan Item', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);

    await expect(
      repository.createPlanItemWorkflowWithInitialSession({
        ...baseWorkflowInput,
        id: 'workflow-2',
        codex_session_id: 'session-2',
      }),
    ).rejects.toThrow(DomainError);
  });

  it('claims only the workflow active session and rejects stale snapshot expectations', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);

    const claimed = await repository.claimCodexSessionLease({
      session_id: 'session-1',
      workflow_id: 'workflow-1',
      lease_id: 'lease-1',
      lease_token_hash: 'sha256:lease-token',
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      expected_previous_snapshot_digest: undefined,
      now,
      expires_at: '2026-05-31T00:05:00.000Z',
    });

    expect(claimed.lease).toMatchObject({ status: 'active', lease_epoch: 1 });
    await expectDomainErrorCode(
      () => repository.claimCodexSessionLease({
        session_id: 'session-1',
        workflow_id: 'workflow-1',
        lease_id: 'lease-2',
        lease_token_hash: 'sha256:other',
        worker_id: 'worker-2',
        worker_session_digest: 'sha256:worker-session-2',
        expected_previous_snapshot_digest: undefined,
        now,
        expires_at: '2026-05-31T00:05:00.000Z',
      }),
      'codex_session_lease_conflict',
    );
  });

  it('rejects candidate fork lease and archived fork selection', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionFork({
      id: 'session-fork',
      workflow_id: 'workflow-1',
      parent_session_id: 'session-1',
      forked_from_snapshot_id: 'snapshot-1',
      fork_reason: 'Try another approach.',
      created_by_actor_id: 'actor-tech',
      now,
    });

    await expectDomainErrorCode(
      () => repository.claimCodexSessionLease({
        session_id: 'session-fork',
        workflow_id: 'workflow-1',
        lease_id: 'lease-fork',
        lease_token_hash: 'sha256:fork',
        worker_id: 'worker-1',
        worker_session_digest: 'sha256:worker-session',
        expected_previous_snapshot_digest: undefined,
        now,
        expires_at: '2026-05-31T00:05:00.000Z',
      }),
      'codex_session_lease_conflict',
    );
  });
});
```

- [ ] **Step 8: Run repository tests to verify they fail**

Run:

```bash
pnpm vitest run tests/db/plan-item-workflow-repository.test.ts
```

Expected: FAIL because repository APIs do not exist.

- [ ] **Step 9: Add repository interfaces**

Modify `packages/db/src/repositories/delivery-repository.ts`:

- Import the new domain types.
- Import `WorkflowTransitionEvidenceObjectType` from `@forgeloop/contracts` for terminalized turn output evidence and repository evidence validation.
- Add inputs:

```ts
export interface CreatePlanItemWorkflowWithInitialSessionInput {
  id: string;
  codex_session_id: string;
  development_plan_id: string;
  development_plan_item_id: string;
  runtime_profile_id: string;
  runtime_profile_revision_id: string;
  credential_binding_id: string;
  credential_binding_version_id: string;
  actor_id: string;
  now: string;
}

export interface ClaimCodexSessionLeaseInput {
  session_id: string;
  workflow_id: string;
  lease_id: string;
  lease_token_hash: string;
  worker_id: string;
  worker_session_digest: string;
  expected_previous_snapshot_digest?: string;
  now: string;
  expires_at: string;
}

export interface RenewCodexSessionLeaseInput {
  session_id: string;
  lease_id: string;
  lease_token_hash: string;
  worker_id: string;
  worker_session_digest: string;
  lease_epoch: number;
  now: string;
  expires_at: string;
}

export interface TerminalizeCodexSessionTurnInput {
  session_id: string;
  turn_id: string;
  lease_id: string;
  lease_token_hash: string;
  lease_epoch: number;
  worker_id: string;
  worker_session_digest: string;
  status: 'succeeded' | 'failed' | 'cancelled';
  expected_previous_snapshot_digest?: string;
  output_snapshot?: CodexSessionSnapshot;
  output_object_type?: WorkflowTransitionEvidenceObjectType;
  output_object_id?: string;
  codex_thread_id?: string;
  codex_thread_id_digest?: string;
  failure_code?: string;
  now: string;
}

export interface WorkflowRepositoryEvidenceInput {
  evidence_object_type: 'commit' | 'pull_request';
  evidence_object_id: string;
  workflow_id: string;
  development_plan_id: string;
  development_plan_item_id: string;
}

export interface CreateCodexSessionForkInput {
  id: string;
  workflow_id: string;
  parent_session_id: string;
  forked_from_turn_id?: string;
  forked_from_snapshot_id?: string;
  fork_reason: string;
  created_by_actor_id: string;
  now: string;
}

export interface SelectActiveCodexSessionForkInput {
  workflow_id: string;
  selected_codex_session_id: string;
  manual_decision_id: string;
  actor_id: string;
  reason: string;
  now: string;
}
```

- Add methods to `DeliveryRepository`:

```ts
createPlanItemWorkflowWithInitialSession(input: CreatePlanItemWorkflowWithInitialSessionInput): Promise<{ workflow: PlanItemWorkflow; session: CodexSession }>;
getPlanItemWorkflow(id: string): Promise<PlanItemWorkflow | undefined>;
getActivePlanItemWorkflowByItem(itemId: string): Promise<PlanItemWorkflow | undefined>;
savePlanItemWorkflow(workflow: PlanItemWorkflow): Promise<void>;
appendPlanItemWorkflowTransition(transition: PlanItemWorkflowTransition): Promise<void>;
listPlanItemWorkflowTransitions(workflowId: string): Promise<PlanItemWorkflowTransition[]>;
saveWorkflowManualDecision(decision: WorkflowManualDecision): Promise<void>;
getWorkflowManualDecision(id: string): Promise<WorkflowManualDecision | undefined>;
saveExecutionReadinessRecord(record: ExecutionReadinessRecord): Promise<void>;
getExecutionReadinessRecord(id: string): Promise<ExecutionReadinessRecord | undefined>;
getBoundarySummaryRevisionById(revisionId: string): Promise<BoundarySummaryRevision | undefined>;
resolveWorkflowRepositoryEvidence(input: WorkflowRepositoryEvidenceInput): Promise<{ repository_id: string; resolved_ref: string } | undefined>;
getCodexSession(id: string): Promise<CodexSession | undefined>;
saveCodexSession(session: CodexSession): Promise<void>;
createCodexSessionTurn(turn: CodexSessionTurn): Promise<void>;
getCodexSessionTurn(id: string): Promise<CodexSessionTurn | undefined>;
saveCodexSessionTurn(turn: CodexSessionTurn): Promise<void>;
createCodexSessionSnapshot(snapshot: CodexSessionSnapshot): Promise<void>;
getCodexSessionSnapshot(id: string): Promise<CodexSessionSnapshot | undefined>;
saveStaleCodexSessionTerminalizationAttempt(attempt: CodexSessionStaleTerminalizationAttempt): Promise<void>;
listStaleCodexSessionTerminalizationAttempts(sessionId: string): Promise<CodexSessionStaleTerminalizationAttempt[]>;
  claimCodexSessionLease(input: ClaimCodexSessionLeaseInput): Promise<{ session: CodexSession; lease: CodexSessionLease }>;
  renewCodexSessionLease(input: RenewCodexSessionLeaseInput): Promise<CodexSessionLease>;
  terminalizeCodexSessionTurn(input: TerminalizeCodexSessionTurnInput): Promise<{ session: CodexSession; turn: CodexSessionTurn }>;
  createCodexSessionFork(input: CreateCodexSessionForkInput): Promise<CodexSession>;
  selectActiveCodexSessionFork(input: SelectActiveCodexSessionForkInput): Promise<{ workflow: PlanItemWorkflow; selectedSession: CodexSession }>;
```

If `BoundarySummaryRevision` is currently only addressable by `boundary_summary_id`, implement `getBoundarySummaryRevisionById` by scanning the boundary-summary revision map in the in-memory repository and by querying `boundary_summary_revisions.id` directly in Drizzle. This method exists specifically so workflow evidence validation is not forced to guess a parent summary id.

Use the existing repository methods for current object types wherever possible: `getSpecRevision`, `getExecutionPlanRevision`, `getExecutionPackage`, `getRunSession`, `getReviewPacket`, and `getInternalArtifactObjectById`. Add only the methods missing for workflow/session ownership and repo evidence resolution; do not duplicate existing execution-package, run-session, review-packet, or internal-artifact lookups under new names.

Implement `resolveWorkflowRepositoryEvidence` as a narrow repository helper for Wave 2:

- `commit`: validate `evidence_object_id` is a 40-character hex SHA and belongs to one project repo for the workflow's development plan. In-memory tests may accept any SHA-shaped value for a persisted project repo. Drizzle or service-level implementation may use the bound repo metadata plus local git object lookup if available.
- `pull_request`: validate the id or URL belongs to the workflow's project repository namespace when that metadata is available. In-memory tests may accept a URL/id only when it matches a persisted project repo name.
- Return `undefined` instead of accepting malformed or foreign repo evidence.

- [ ] **Step 10: Implement in-memory repository**

Modify `packages/db/src/repositories/in-memory-delivery-repository.ts`:

- Add maps for all new records.
- Copy them in transaction state.
- Implement uniqueness:
  - one non-archived workflow per `development_plan_item_id`;
  - one active, non-archived session per workflow;
  - one active lease per session.
- Implement `claimCodexSessionLease` with:
  - session exists;
  - session owner workflow exists;
  - session `role === 'active'`;
  - workflow `active_codex_session_id === session.id`;
  - status in `starting|idle|recovering`;
  - no active lease;
  - latest snapshot digest matches expectation.
- Implement fork selection with:
  - selected session same workflow;
  - selected status not archived;
  - previous active and selected child have no active lease;
  - both not running;
  - previous active role becomes `inactive_fork`;
  - selected role becomes `active`;
  - workflow `active_codex_session_id` updates.

- [ ] **Step 11: Implement Drizzle repository**

Modify `packages/db/src/repositories/drizzle-delivery-repository.ts`:

- Add row mappers for new tables.
- Implement create/get/save/list methods.
- Use `withObjectLock` or transactional methods for multi-row workflow/session/lease changes.
- Use SQL filters matching the spec for CAS:

```ts
and(
  eq(codex_sessions.id, input.session_id),
  eq(codex_sessions.role, 'active'),
  eq(plan_item_workflows.activeCodexSessionId, input.session_id),
  inArray(codex_sessions.status, ['starting', 'idle', 'recovering']),
  isNull(codex_sessions.activeLeaseId),
  expectedDigestPredicate,
)
```

- For terminalization, reject non-current lease by returning/throwing `codex_session_stale_terminalization`; do not update latest snapshot or workflow.

- [ ] **Step 12: Run repository tests**

Run:

```bash
pnpm vitest run tests/db/plan-item-workflow-repository.test.ts tests/db/repository.test.ts tests/db/schema.test.ts tests/db/reset.test.ts
```

Expected: PASS.

- [ ] **Step 13: Commit DB schema, migration, and repository**

```bash
git add package.json packages/db/drizzle.config.ts packages/db/migrations packages/db/src/schema packages/db/src/reset.ts packages/db/src/repositories tests/db
git commit -m "feat: persist plan item workflow sessions"
```

## Task 3: Workflow Transition Service

**Files:**
- Create: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts`
- Create: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts`
- Create: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflows.module.ts`
- Modify: `apps/control-plane-api/src/modules/http/domain-error.filter.ts`
- Modify: `apps/control-plane-api/src/modules/delivery/delivery.module.ts`
- Modify: `apps/control-plane-api/src/app.module.ts`
- Create: `tests/helpers/plan-item-workflow-fixtures.ts`
- Create: `tests/api/plan-item-workflows.test.ts`

- [ ] **Step 1: Write failing workflow service/API tests**

Create `tests/api/plan-item-workflows.test.ts`:

```ts
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import {
  createExecutionReadinessRecord,
  ids,
  seedApprovedBoundaryWorkflow,
  seedDevelopmentPlanItem,
  seedWorkflow,
  seedWorkflowWithApprovedImplementationPlan,
  startWorkflow,
} from '../helpers/plan-item-workflow-fixtures';
import type { DeliveryRepository } from '../../packages/db/src';

describe('Plan Item Workflow API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('starts workflow with initial active session and transition ledger', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);

    const response = await request(app.getHttpServer())
      .post(`/development-plans/${plan.id}/items/${item.id}/workflow/start-brainstorming`)
      .send({
        actor_id: ids.actorTech,
        runtime_profile_id: ids.runtimeProfile,
        runtime_profile_revision_id: ids.runtimeProfileRevision,
        credential_binding_id: ids.credentialBinding,
        credential_binding_version_id: ids.credentialBindingVersion,
        reason: 'Start Superpowers workflow.',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      status: 'brainstorming',
      session: {
        status: 'idle',
        role: 'active',
        continuity_state: 'ready',
      },
    });
    expect(response.body.session.codex_thread_id).toBeUndefined();
    expect(response.body.session.latest_snapshot_digest).toBeUndefined();

    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const transitions = await repository.listPlanItemWorkflowTransitions(response.body.id);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      from_status: 'not_started',
      to_status: 'brainstorming',
      evidence_object_type: 'manual_decision',
    });
  });

  it('rejects unauthorized workflow start before creating workflow/session rows', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    await request(app.getHttpServer())
      .post(`/development-plans/${plan.id}/items/${item.id}/workflow/start-brainstorming`)
      .send({
        actor_id: '11111111-1111-4111-8111-111111111999',
        runtime_profile_id: ids.runtimeProfile,
        runtime_profile_revision_id: ids.runtimeProfileRevision,
        credential_binding_id: ids.credentialBinding,
        credential_binding_version_id: ids.credentialBindingVersion,
        reason: 'Unauthorized workflow start.',
      })
      .expect(403)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_actor_not_authorized');
      });

    await expect(repository.getActivePlanItemWorkflowByItem(item.id)).resolves.toBeUndefined();
  });

  it('rejects wrong evidence type for boundary submission', async () => {
    const { plan, item } = await seedDevelopmentPlanItem(app);
    const workflow = await startWorkflow(app, plan.id, item.id);

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${workflow.id}/transitions`)
      .send({
        actor_id: ids.actorTech,
        to_status: 'boundary_review',
        evidence_object_type: 'spec_revision',
        evidence_object_id: 'spec-revision-1',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_invalid_transition');
      });
  });

  it('enforces product authorization before workflow mutations', async () => {
    const { workflow } = await seedWorkflow(app);

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${workflow.id}/block`)
      .send({
        actor_id: ids.actorLeader,
        reason: 'Only a Tech Lead, delegate, owner, or operator can block workflow execution.',
      })
      .expect(403)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_actor_not_authorized');
      });
  });

  it('rejects document evidence from another workflow', async () => {
    const first = await seedApprovedBoundaryWorkflow(app, { idPrefix: '11111111' });
    const second = await seedApprovedBoundaryWorkflow(app, { idPrefix: '22222222' });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${first.workflow.id}/transitions`)
      .send({
        actor_id: first.ids.actorTech,
        to_status: 'spec_generation_queued',
        evidence_object_type: 'boundary_summary_revision',
        evidence_object_id: second.boundaryRevision.id,
      })
      .expect(400)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_evidence_not_owned');
      });
  });

  it('rejects supporting evidence from another workflow', async () => {
    const first = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '33333333' });
    const second = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '44444444' });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const firstWorkflowWithActivePlan = {
      ...first.workflow,
      active_implementation_plan_doc_revision_id: first.implementationPlanRevision.id,
    };
    await repository.savePlanItemWorkflow(firstWorkflowWithActivePlan);
    const readiness = await createExecutionReadinessRecord(app, {
      ...first,
      workflow: firstWorkflowWithActivePlan,
    });

    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${firstWorkflowWithActivePlan.id}/transitions`)
      .send({
        actor_id: first.ids.actorTech,
        to_status: 'execution_ready',
        evidence_object_type: 'execution_readiness_record',
        evidence_object_id: readiness.id,
        supporting_evidence: [
          {
            object_type: 'implementation_plan_revision',
            object_id: second.implementationPlanRevision.id,
          },
        ],
      })
      .expect(400)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_evidence_not_owned');
      });
  });
});
```

Create `tests/helpers/plan-item-workflow-fixtures.ts` and import it from `tests/api/plan-item-workflows.test.ts`, `tests/api/codex-session-lease.test.ts`, and later workflow-owned API suites. Do not duplicate these seed helpers inside each test file.

```ts
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import type { DeliveryRepository } from '../../packages/db/src';

const now = '2026-05-31T00:00:00.000Z';

const idsFor = (prefix = '11111111') => ({
  org: `${prefix}-1111-4111-8111-111111111001`,
  actorTech: `${prefix}-1111-4111-8111-111111111101`,
  actorLeader: `${prefix}-1111-4111-8111-111111111102`,
  project: `${prefix}-1111-4111-8111-111111111201`,
  repo: `${prefix}-1111-4111-8111-111111111202`,
  plan: `${prefix}-1111-4111-8111-111111111301`,
  item: `${prefix}-1111-4111-8111-111111111302`,
  runtimeProfile: `${prefix}-1111-4111-8111-111111111401`,
  runtimeProfileRevision: `${prefix}-1111-4111-8111-111111111402`,
  credentialBinding: `${prefix}-1111-4111-8111-111111111501`,
  credentialBindingVersion: `${prefix}-1111-4111-8111-111111111502`,
});

export const ids = idsFor();

export async function seedDevelopmentPlanItem(app: INestApplication, options: { idPrefix?: string } = {}) {
  const ids = idsFor(options.idPrefix);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  await repository.saveOrganization({ id: ids.org, name: 'ForgeLoop', created_at: now, updated_at: now });
  await repository.saveActor({ id: ids.actorTech, org_id: ids.org, display_name: 'Tech Lead', actor_type: 'human', created_at: now, updated_at: now });
  await repository.saveActor({ id: ids.actorLeader, org_id: ids.org, display_name: 'Product Lead', actor_type: 'human', created_at: now, updated_at: now });
  await repository.saveProject({
    id: ids.project,
    org_id: ids.org,
    name: 'ForgeLoop',
    repo_ids: [ids.repo],
    owner_actor_id: ids.actorTech,
    created_at: now,
    updated_at: now,
  });
  await repository.saveProjectRepo({
    id: ids.repo,
    repo_id: 'forgeloop',
    org_id: ids.org,
    project_id: ids.project,
    name: 'forgeloop',
    status: 'active',
    local_path: '/Users/viv/projs/forgeloop',
    default_branch: 'main',
    base_commit_sha: '0'.repeat(40),
    created_at: now,
    updated_at: now,
  });
  await repository.saveDevelopmentPlan({
    id: ids.plan,
    project_id: ids.project,
    revision_id: `${ids.plan.slice(0, 8)}-1111-4111-8111-111111111303`,
    title: 'Codex Session Workflow',
    status: 'draft',
    source_refs: [],
    items: [],
    created_at: now,
    updated_at: now,
  });
  await repository.saveDevelopmentPlanItem({
    id: ids.item,
    development_plan_id: ids.plan,
    revision_id: `${ids.item.slice(0, 8)}-1111-4111-8111-111111111304`,
    source_ref: { type: 'requirement', id: `${ids.item.slice(0, 8)}-1111-4111-8111-111111111601` },
    title: 'Session continuity',
    summary: 'Model Codex workflow continuity.',
    driver_actor_id: ids.actorLeader,
    responsible_role: 'tech_lead',
    reviewer_actor_id: ids.actorTech,
    leader_actor_id: ids.actorTech,
    leader_delegate_actor_ids: [],
    risk: 'medium',
    dependency_hints: [],
    affected_surfaces: ['control-plane-api', 'db'],
    boundary_status: 'in_progress',
    spec_status: 'missing',
    implementation_plan_status: 'missing',
    execution_status: 'not_started',
    review_status: 'missing',
    qa_handoff_status: 'missing',
    release_impact: 'none',
    next_action: 'Start brainstorming',
    created_at: now,
    updated_at: now,
  });
  return { plan: { id: ids.plan }, item: { id: ids.item } };
}

export async function startWorkflow(app: INestApplication, developmentPlanId: string, itemId: string) {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const item = await repository.getDevelopmentPlanItem(itemId);
  const plan = await repository.getDevelopmentPlan(developmentPlanId);
  const actorId = item?.leader_actor_id ?? ids.actorTech;
  const fixtureIds = idsFor(plan?.id.slice(0, 8));
  return (
    await request(app.getHttpServer())
      .post(`/development-plans/${developmentPlanId}/items/${itemId}/workflow/start-brainstorming`)
      .send({
        actor_id: actorId,
        runtime_profile_id: fixtureIds.runtimeProfile,
        runtime_profile_revision_id: fixtureIds.runtimeProfileRevision,
        credential_binding_id: fixtureIds.credentialBinding,
        credential_binding_version_id: fixtureIds.credentialBindingVersion,
        reason: 'Start Superpowers workflow.',
      })
      .expect(201)
  ).body;
}

export async function seedWorkflow(app: INestApplication, options: { idPrefix?: string } = {}) {
  const { plan, item } = await seedDevelopmentPlanItem(app, options);
  const workflow = await startWorkflow(app, plan.id, item.id);
  return { ids: idsFor(options.idPrefix), plan, item, workflow };
}

export async function seedApprovedBoundaryWorkflow(app: INestApplication, options: { idPrefix?: string } = {}) {
  const seeded = await seedWorkflow(app, options);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const fixtureIds = idsFor(options.idPrefix);
  const boundaryRevision = await seedBoundarySummaryRevisionForWorkflow(repository, seeded, fixtureIds);
  const workflow = {
    ...seeded.workflow,
    status: 'spec_generation_queued' as const,
    active_boundary_summary_revision_id: boundaryRevision.id,
  };
  await repository.savePlanItemWorkflow(workflow);
  return { ...seeded, workflow, boundaryRevision };
}

export async function seedWorkflowWithApprovedImplementationPlan(app: INestApplication, options: { idPrefix?: string } = {}) {
  const seeded = await seedApprovedBoundaryWorkflow(app, options);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const specRevision = await seedSpecRevisionForWorkflow(repository, seeded, idsFor(options.idPrefix));
  const implementationPlanRevision = await seedImplementationPlanRevisionForWorkflow(repository, seeded, idsFor(options.idPrefix));
  const workflow = {
    ...seeded.workflow,
    status: 'implementation_plan_review' as const,
    active_spec_doc_revision_id: specRevision.id,
    ...(seeded.workflow.active_implementation_plan_doc_revision_id === undefined
      ? {}
      : { active_implementation_plan_doc_revision_id: undefined }),
  };
  await repository.savePlanItemWorkflow(workflow);
  return { ...seeded, workflow, specRevision, implementationPlanRevision };
}

export async function createExecutionReadinessRecord(app: INestApplication, seeded: Awaited<ReturnType<typeof seedWorkflowWithApprovedImplementationPlan>>) {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const record = buildExecutionReadinessRecord(seeded);
  await repository.saveExecutionReadinessRecord(record);
  return record;
}
```

Fixture rules:

- Do not use literal non-UUID actor ids in API tests.
- Persist organization, actors, project, repo, Development Plan, and Development Plan Item before hitting the API.
- The helper must return `{ ids, plan, item, startWorkflow, seedWorkflow, seedApprovedBoundaryWorkflow, seedWorkflowWithApprovedImplementationPlan, createExecutionReadinessRecord, createFork }` or equivalent named exports so later API tests do not invent incompatible local fixture shapes.
- For brevity, helper bodies above may call local `seedBoundarySummaryRevisionForWorkflow`, `seedSpecRevisionForWorkflow`, `seedImplementationPlanRevisionForWorkflow`, and `buildExecutionReadinessRecord`; implement those in the same helper file with the current required domain fields, UUID-shaped ids, workflow/session refs, and approval metadata (`approved_at` plus the appropriate approved-by actor fields) so service evidence validation treats them as approved revisions.
- `seedWorkflowWithApprovedImplementationPlan` must create and persist an approved Implementation Plan revision, but it must leave `workflow.active_implementation_plan_doc_revision_id` unset. The active id is set by `approveImplementationPlanAndMarkExecutionReady`, not by review submission fixtures.
- `buildExecutionReadinessRecord` is only for repository-level tests that already set all active ids deliberately. It must copy `workflow.active_boundary_summary_revision_id`, `workflow.active_spec_doc_revision_id`, and `workflow.active_implementation_plan_doc_revision_id` into the readiness fields, set `readiness_state = 'ready'`, and include supporting evidence with `{ object_type: 'implementation_plan_revision', object_id: workflow.active_implementation_plan_doc_revision_id }`.
- Runtime profile and credential ids may be UUID-shaped ids without backing rows until repository-level FK enforcement is added for those fields.
- Keep repository-only tests in Task 2 independent from API fixture helpers.

Implement `createFork(app, workflowId, options?)` in this helper before Task 7 tests use it. It should call `POST /plan-item-workflows/:workflowId/codex-sessions/:activeSessionId/fork` after loading the workflow, return the created candidate fork session, and keep ids UUID-shaped for API tests.

- [ ] **Step 2: Run workflow API tests to verify they fail**

Run:

```bash
pnpm vitest run tests/api/plan-item-workflows.test.ts
```

Expected: FAIL because module/routes/service do not exist.

- [ ] **Step 3: Add DTOs**

Create `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts`:

```ts
import { z } from 'zod';
import {
  codexSessionPublicDtoSchema,
  planItemWorkflowPublicDtoSchema,
  planItemWorkflowStatusSchema,
  workflowManualDecisionKindSchema,
  workflowTransitionEvidenceObjectTypeSchema,
} from '@forgeloop/contracts';

const nonEmpty = z.string().trim().min(1);

export const startBrainstormingWorkflowSchema = z
  .object({
    actor_id: nonEmpty,
    runtime_profile_id: nonEmpty,
    runtime_profile_revision_id: nonEmpty,
    credential_binding_id: nonEmpty,
    credential_binding_version_id: nonEmpty,
    reason: nonEmpty,
  })
  .strict();
export type StartBrainstormingWorkflowDto = z.infer<typeof startBrainstormingWorkflowSchema>;

export const workflowTransitionCommandSchema = z
  .object({
    actor_id: nonEmpty,
    to_status: planItemWorkflowStatusSchema,
    evidence_object_type: workflowTransitionEvidenceObjectTypeSchema,
    evidence_object_id: nonEmpty,
    reason: nonEmpty.optional(),
    manual_decision_kind: workflowManualDecisionKindSchema.optional(),
    selected_codex_session_id: nonEmpty.optional(),
    codex_session_turn_id: nonEmpty.optional(),
    evidence_digest: nonEmpty.optional(),
    supporting_evidence: z
      .array(
        z
          .object({
            object_type: workflowTransitionEvidenceObjectTypeSchema,
            object_id: nonEmpty,
            digest: nonEmpty.optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export type WorkflowTransitionCommandDto = z.infer<typeof workflowTransitionCommandSchema>;

const manualDecisionBodySchema = z.object({
  actor_id: nonEmpty,
  reason: nonEmpty,
}).strict();

export const requestWorkflowChangesSchema = manualDecisionBodySchema.extend({
  rejected_revision_id: nonEmpty.optional(),
}).strict();

export const approveImplementationPlanAndMarkExecutionReadySchema = z.object({
  actor_id: nonEmpty,
  approved_implementation_plan_revision_id: nonEmpty,
  reason: nonEmpty.optional(),
}).strict();

export type ManualDecisionBodyDto = z.infer<typeof manualDecisionBodySchema>;
export type RequestWorkflowChangesDto = z.infer<typeof requestWorkflowChangesSchema>;
export type ApproveImplementationPlanAndMarkExecutionReadyDto = z.infer<typeof approveImplementationPlanAndMarkExecutionReadySchema>;

export { manualDecisionBodySchema };

export { codexSessionPublicDtoSchema, planItemWorkflowPublicDtoSchema };
```

- [ ] **Step 4: Add workflow service**

Create `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts`:

- Inject `DELIVERY_REPOSITORY`.
- Provide `startBrainstorming`.
- Provide `transitionWorkflow`.
- Provide typed product actions that create their own evidence records instead of requiring callers to pre-create evidence:
  - `requestBoundaryChanges`;
  - `requestSpecChanges`;
  - `requestImplementationPlanChanges`;
  - `blockWorkflow`;
  - `recoverWorkflow`;
  - `archiveWorkflow`;
  - `approveImplementationPlanAndMarkExecutionReady`.
- Provide helper methods:
  - `createManualDecision`;
  - `performManualDecisionTransition`;
  - `createExecutionReadinessRecordForApprovedPlan`;
  - `appendTransition`;
  - `toPublicWorkflowDto`;
  - `validateTransitionEvidence`;
  - `validateEvidenceOwnership`.
- Use `assertPlanItemWorkflowTransitionAllowed`.
- On `startBrainstorming`:
  - lock `development-plan:${developmentPlanId}`;
  - call `createPlanItemWorkflowWithInitialSession`;
  - create `WorkflowManualDecision` with `kind = 'start_brainstorming'`;
  - update workflow status to `brainstorming`;
  - append transition.
- Return public DTO without raw internals.
- Do not expose generic `transitionWorkflow` as the only write path for manual decisions. Public controller methods for change request, block, recover, archive, fork select, and execution readiness must call the typed service action that creates the decision/readiness evidence in the same transaction.

Implementation skeleton:

```ts
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DomainError, assertPlanItemWorkflowTransitionAllowed, assertWorkflowActorAuthorized, codexSessionPublicProjection } from '@forgeloop/domain';
import type {
  BoundarySummaryRevision,
  CodexSession,
  PlanItemWorkflow,
  WorkflowManualDecision,
} from '@forgeloop/domain';
import type { WorkflowTransitionEvidenceObjectType } from '@forgeloop/contracts';

import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import type { DeliveryRepository } from '@forgeloop/db';
import type { StartBrainstormingWorkflowDto, WorkflowTransitionCommandDto } from './plan-item-workflow.dto';

@Injectable()
export class PlanItemWorkflowService {
  constructor(@Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository) {}

  async startBrainstorming(developmentPlanId: string, itemId: string, dto: StartBrainstormingWorkflowDto) {
    return this.repository.withObjectLock(`development-plan:${developmentPlanId}`, async (repository) => {
      const now = this.now();
      await this.assertActorCanStartWorkflow(repository, itemId, dto.actor_id);
      const workflowId = randomUUID();
      const sessionId = randomUUID();
      const created = await repository.createPlanItemWorkflowWithInitialSession({
        id: workflowId,
        codex_session_id: sessionId,
        development_plan_id: developmentPlanId,
        development_plan_item_id: itemId,
        runtime_profile_id: dto.runtime_profile_id,
        runtime_profile_revision_id: dto.runtime_profile_revision_id,
        credential_binding_id: dto.credential_binding_id,
        credential_binding_version_id: dto.credential_binding_version_id,
        actor_id: dto.actor_id,
        now,
      });

      const decision: WorkflowManualDecision = {
        id: randomUUID(),
        workflow_id: created.workflow.id,
        codex_session_id: created.session.id,
        kind: 'start_brainstorming',
        reason: dto.reason,
        created_by_actor_id: dto.actor_id,
        created_at: now,
      };
      await repository.saveWorkflowManualDecision(decision);

      const workflow: PlanItemWorkflow = {
        ...created.workflow,
        previous_status: created.workflow.status,
        status: 'brainstorming',
        updated_at: now,
      };
      await repository.savePlanItemWorkflow(workflow);

      await repository.appendPlanItemWorkflowTransition({
        id: randomUUID(),
        workflow_id: workflow.id,
        from_status: 'not_started',
        to_status: 'brainstorming',
        actor_id: dto.actor_id,
        reason: dto.reason,
        evidence_object_type: 'manual_decision',
        evidence_object_id: decision.id,
        codex_session_id: created.session.id,
        created_at: now,
      });

      return this.toPublicWorkflowDto(workflow, created.session);
    });
  }

  async transitionWorkflow(workflowId: string, dto: WorkflowTransitionCommandDto) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (repository) => {
      const workflow = await this.requireWorkflow(repository, workflowId);
      await this.assertActorCanMutateWorkflow(repository, workflow, dto.actor_id, this.actionForTransition(workflow.status, dto.to_status));
      const session = await this.requireActiveSession(repository, workflow);

      assertPlanItemWorkflowTransitionAllowed({
        from_status: workflow.status,
        to_status: dto.to_status,
        previous_status: workflow.previous_status,
        evidence_object_type: dto.evidence_object_type,
        manual_decision_kind: dto.manual_decision_kind,
      });
      await this.validateTransitionEvidence(repository, workflow, dto);

      const now = this.now();
      const updated = this.applyTransitionProjection(workflow, dto, now);
      await repository.savePlanItemWorkflow(updated);
      await this.appendTransition(repository, workflow, dto, session.id, now);
      return this.toPublicWorkflowDto(updated, session);
    });
  }

  async requestImplementationPlanChanges(
    workflowId: string,
    input: { actor_id: string; reason: string; rejected_revision_id?: string },
  ) {
    return this.performManualDecisionTransition(workflowId, {
      actor_id: input.actor_id,
      to_status: 'implementation_plan_generation_queued',
      manual_decision_kind: 'change_request',
      reason: input.reason,
      related_object_type: input.rejected_revision_id === undefined ? undefined : 'implementation_plan_revision',
      related_object_id: input.rejected_revision_id,
    });
  }

  async requestBoundaryChanges(
    workflowId: string,
    input: { actor_id: string; reason: string; rejected_revision_id?: string },
  ) {
    return this.performManualDecisionTransition(workflowId, {
      actor_id: input.actor_id,
      to_status: 'brainstorming',
      manual_decision_kind: 'change_request',
      reason: input.reason,
      related_object_type: input.rejected_revision_id === undefined ? undefined : 'boundary_summary_revision',
      related_object_id: input.rejected_revision_id,
    });
  }

  async requestSpecChanges(
    workflowId: string,
    input: { actor_id: string; reason: string; rejected_revision_id?: string },
  ) {
    return this.performManualDecisionTransition(workflowId, {
      actor_id: input.actor_id,
      to_status: 'spec_generation_queued',
      manual_decision_kind: 'change_request',
      reason: input.reason,
      related_object_type: input.rejected_revision_id === undefined ? undefined : 'spec_revision',
      related_object_id: input.rejected_revision_id,
    });
  }

  async blockWorkflow(workflowId: string, input: { actor_id: string; reason: string }) {
    return this.performManualDecisionTransition(workflowId, {
      actor_id: input.actor_id,
      to_status: 'blocked',
      manual_decision_kind: 'block',
      reason: input.reason,
    });
  }

  async recoverWorkflow(workflowId: string, input: { actor_id: string; reason: string }) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (repository) => {
      const workflow = await this.requireWorkflow(repository, workflowId);
      if (workflow.status !== 'blocked' || workflow.previous_status === undefined || workflow.previous_status === 'blocked' || workflow.previous_status === 'archived') {
        throw new DomainError('workflow_invalid_transition', 'Blocked workflow has no recoverable previous status');
      }
      return this.performManualDecisionTransitionWithRepository(repository, workflow, {
        actor_id: input.actor_id,
        to_status: workflow.previous_status,
        manual_decision_kind: 'recover',
        reason: input.reason,
      });
    });
  }

  async archiveWorkflow(workflowId: string, input: { actor_id: string; reason: string }) {
    return this.performManualDecisionTransition(workflowId, {
      actor_id: input.actor_id,
      to_status: 'archived',
      manual_decision_kind: 'archive',
      reason: input.reason,
    });
  }

  async approveImplementationPlanAndMarkExecutionReady(
    workflowId: string,
    input: { actor_id: string; approved_implementation_plan_revision_id: string; reason?: string },
  ) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (repository) => {
      const workflow = await this.requireWorkflow(repository, workflowId);
      await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, 'approve_document_gate');
      if (workflow.status !== 'implementation_plan_review') {
        throw new DomainError('workflow_invalid_transition', 'Implementation Plan approval requires implementation_plan_review');
      }
      const activePlan = await repository.getExecutionPlanRevision(input.approved_implementation_plan_revision_id);
      if (
        activePlan === undefined ||
        activePlan.development_plan_item_id !== workflow.development_plan_item_id ||
        this.recordWorkflowId(activePlan) !== workflow.id ||
        this.recordCodexSessionId(activePlan) !== workflow.active_codex_session_id ||
        this.recordApprovedAt(activePlan) === undefined
      ) {
        throw new DomainError('workflow_evidence_not_owned', 'Approved Implementation Plan revision does not belong to this workflow/session');
      }

      const workflowWithApprovedPlan: PlanItemWorkflow = {
        ...workflow,
        active_implementation_plan_doc_revision_id: activePlan.id,
      };
      const readiness = await this.createExecutionReadinessRecordForApprovedPlan(repository, workflowWithApprovedPlan, input.actor_id);
      const dto: WorkflowTransitionCommandDto = {
        actor_id: input.actor_id,
        to_status: 'execution_ready',
        evidence_object_type: 'execution_readiness_record',
        evidence_object_id: readiness.id,
        reason: input.reason,
      };
      const now = this.now();
      const updated = this.applyTransitionProjection(workflowWithApprovedPlan, dto, now);
      await repository.savePlanItemWorkflow(updated);
      await this.appendTransition(repository, workflowWithApprovedPlan, dto, workflowWithApprovedPlan.active_codex_session_id, now);
      return this.toPublicWorkflowDto(updated, await this.requireActiveSession(repository, updated));
    });
  }

  private async performManualDecisionTransition(
    workflowId: string,
    input: {
      actor_id: string;
      to_status: PlanItemWorkflow['status'];
      manual_decision_kind: WorkflowManualDecision['kind'];
      reason: string;
      related_object_type?: WorkflowTransitionEvidenceObjectType;
      related_object_id?: string;
      selected_codex_session_id?: string;
    },
  ) {
    return this.repository.withObjectLock(`plan-item-workflow:${workflowId}`, async (repository) => {
      const workflow = await this.requireWorkflow(repository, workflowId);
      await this.assertActorCanMutateWorkflow(repository, workflow, input.actor_id, this.actionForTransition(workflow.status, input.to_status));
      return this.performManualDecisionTransitionWithRepository(repository, workflow, input);
    });
  }

  private async performManualDecisionTransitionWithRepository(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    input: {
      actor_id: string;
      to_status: PlanItemWorkflow['status'];
      manual_decision_kind: WorkflowManualDecision['kind'];
      reason: string;
      related_object_type?: WorkflowTransitionEvidenceObjectType;
      related_object_id?: string;
      selected_codex_session_id?: string;
    },
  ) {
    const session = await this.requireActiveSession(repository, workflow);
    const now = this.now();
    const decision = await this.createManualDecision(repository, workflow, {
      ...input,
      codex_session_id: session.id,
      created_at: now,
    });
    const dto: WorkflowTransitionCommandDto = {
      actor_id: input.actor_id,
      to_status: input.to_status,
      evidence_object_type: 'manual_decision',
      evidence_object_id: decision.id,
      manual_decision_kind: input.manual_decision_kind,
      reason: input.reason,
    };
    assertPlanItemWorkflowTransitionAllowed({
      from_status: workflow.status,
      to_status: input.to_status,
      previous_status: workflow.previous_status,
      evidence_object_type: 'manual_decision',
      manual_decision_kind: input.manual_decision_kind,
    });
    const updated = this.applyTransitionProjection(workflow, dto, now);
    await repository.savePlanItemWorkflow(updated);
    await this.appendTransition(repository, workflow, dto, session.id, now);
    return this.toPublicWorkflowDto(updated, session);
  }

  private async createManualDecision(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    input: {
      actor_id: string;
      codex_session_id: string;
      manual_decision_kind: WorkflowManualDecision['kind'];
      reason: string;
      related_object_type?: WorkflowTransitionEvidenceObjectType;
      related_object_id?: string;
      selected_codex_session_id?: string;
      created_at: string;
    },
  ) {
    const decision: WorkflowManualDecision = {
      id: randomUUID(),
      workflow_id: workflow.id,
      codex_session_id: input.codex_session_id,
      kind: input.manual_decision_kind,
      reason: input.reason,
      selected_codex_session_id: input.selected_codex_session_id,
      related_object_type: input.related_object_type,
      related_object_id: input.related_object_id,
      created_by_actor_id: input.actor_id,
      created_at: input.created_at,
    };
    await repository.saveWorkflowManualDecision(decision);
    return decision;
  }

  private async createExecutionReadinessRecordForApprovedPlan(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    actorId: string,
  ) {
    if (
      workflow.active_boundary_summary_revision_id === undefined ||
      workflow.active_spec_doc_revision_id === undefined ||
      workflow.active_implementation_plan_doc_revision_id === undefined ||
      workflow.active_codex_session_id === undefined
    ) {
      throw new DomainError('workflow_evidence_type_invalid', 'Execution readiness requires active approved Boundary, Spec, and Implementation Plan revisions');
    }
    const now = this.now();
    const record = {
      id: randomUUID(),
      workflow_id: workflow.id,
      development_plan_id: workflow.development_plan_id,
      development_plan_item_id: workflow.development_plan_item_id,
      codex_session_id: workflow.active_codex_session_id,
      approved_boundary_summary_revision_id: workflow.active_boundary_summary_revision_id,
      approved_spec_revision_id: workflow.active_spec_doc_revision_id,
      approved_implementation_plan_revision_id: workflow.active_implementation_plan_doc_revision_id,
      readiness_state: 'ready' as const,
      blocker_codes: [],
      supporting_evidence: [
        {
          object_type: 'implementation_plan_revision' as const,
          object_id: workflow.active_implementation_plan_doc_revision_id,
        },
      ],
      created_by_actor_id: actorId,
      created_at: now,
    };
    await repository.saveExecutionReadinessRecord(record);
    return record;
  }

  private async appendTransition(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    dto: WorkflowTransitionCommandDto,
    codexSessionId: string | undefined,
    now: string,
  ) {
    if (codexSessionId === undefined) {
      throw new DomainError('workflow_active_session_missing', `Workflow ${workflow.id} has no active Codex Session`);
    }
    await repository.appendPlanItemWorkflowTransition({
      id: randomUUID(),
      workflow_id: workflow.id,
      from_status: workflow.status,
      to_status: dto.to_status,
      actor_id: dto.actor_id,
      reason: dto.reason,
      evidence_object_type: dto.evidence_object_type,
      evidence_object_id: dto.evidence_object_id,
      evidence_digest: dto.evidence_digest,
      supporting_evidence: dto.supporting_evidence,
      codex_session_id: codexSessionId,
      codex_session_turn_id: dto.codex_session_turn_id,
      created_at: now,
    });
  }

  private async assertActorCanMutateWorkflow(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    actorId: string,
    action: Parameters<typeof assertWorkflowActorAuthorized>[1],
  ) {
    const item = await repository.getDevelopmentPlanItem(workflow.development_plan_item_id);
    assertWorkflowActorAuthorized(workflow, action, {
      actor_id: actorId,
      development_plan_item: item,
      execution_owner_actor_id: this.executionOwnerActorId(workflow),
    });
  }

  private async assertActorCanStartWorkflow(repository: DeliveryRepository, itemId: string, actorId: string) {
    const item = await repository.getDevelopmentPlanItem(itemId);
    assertWorkflowActorAuthorized({ development_plan_item_id: itemId }, 'start_brainstorming', {
      actor_id: actorId,
      development_plan_item: item,
    });
  }

  private actionForTransition(
    from: PlanItemWorkflow['status'],
    to: PlanItemWorkflow['status'],
  ): Parameters<typeof assertWorkflowActorAuthorized>[1] {
    if (to === 'blocked') return 'block';
    if (from === 'blocked') return 'recover';
    if (to === 'archived') return 'archive';
    if (from === to) return 'select_fork';
    if (to === 'execution_running') return 'start_execution';
    if (to === 'spec_generation_queued' || to === 'implementation_plan_generation_queued' || to === 'execution_ready') {
      return 'approve_document_gate';
    }
    return 'submit_document_gate';
  }

  private applyTransitionProjection(
    workflow: PlanItemWorkflow,
    dto: WorkflowTransitionCommandDto,
    now: string,
  ): PlanItemWorkflow {
    const updated: PlanItemWorkflow = {
      ...workflow,
      previous_status: workflow.status,
      status: dto.to_status,
      updated_at: now,
    };
    if (workflow.status === 'boundary_review' && dto.to_status === 'spec_generation_queued') {
      updated.active_boundary_summary_revision_id = dto.evidence_object_id;
    }
    if (workflow.status === 'spec_review' && dto.to_status === 'implementation_plan_generation_queued') {
      updated.active_spec_doc_revision_id = dto.evidence_object_id;
    }
    if (
      workflow.status === 'implementation_plan_generation_queued' &&
      dto.to_status === 'implementation_plan_review'
    ) {
      // Submission for review does not approve the plan yet.
    }
    if (
      workflow.status === 'implementation_plan_review' &&
      dto.to_status === 'execution_ready'
    ) {
      // execution_ready uses ExecutionReadinessRecord as aggregate evidence.
      // approveImplementationPlanAndMarkExecutionReady sets active_implementation_plan_doc_revision_id
      // before the readiness record is created and before this status transition is appended.
      // The generic transition route must reject execution_ready when that active id is missing.
    }
    return updated;
  }

  private async validateTransitionEvidence(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    dto: WorkflowTransitionCommandDto,
  ) {
    await this.validateEvidenceOwnership(repository, workflow, {
      object_type: dto.evidence_object_type,
      object_id: dto.evidence_object_id,
      to_status: dto.to_status,
      actor_id: dto.actor_id,
      manual_decision_kind: dto.manual_decision_kind,
    });

    for (const supporting of dto.supporting_evidence ?? []) {
      await this.validateEvidenceOwnership(repository, workflow, {
        object_type: supporting.object_type,
        object_id: supporting.object_id,
        to_status: dto.to_status,
        actor_id: dto.actor_id,
        manual_decision_kind: dto.manual_decision_kind,
        supporting: true,
      });
    }
  }

  private async validateEvidenceOwnership(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    evidence: {
      object_type: WorkflowTransitionEvidenceObjectType;
      object_id: string;
      to_status: PlanItemWorkflow['status'];
      actor_id: string;
      manual_decision_kind?: WorkflowManualDecision['kind'];
      supporting?: boolean;
    },
  ) {
    switch (evidence.object_type) {
      case 'manual_decision': {
        const decision = await repository.getWorkflowManualDecision(evidence.object_id);
        if (
          decision === undefined ||
          decision.workflow_id !== workflow.id ||
          decision.codex_session_id !== workflow.active_codex_session_id ||
          decision.kind !== evidence.manual_decision_kind ||
          decision.created_by_actor_id !== evidence.actor_id
        ) {
          throw new DomainError('workflow_evidence_not_owned', 'Manual decision does not belong to this workflow/session');
        }
        return;
      }
      case 'execution_readiness_record': {
        const record = await repository.getExecutionReadinessRecord(evidence.object_id);
        if (
          record === undefined ||
          record.workflow_id !== workflow.id ||
          record.development_plan_id !== workflow.development_plan_id ||
          record.development_plan_item_id !== workflow.development_plan_item_id ||
          record.codex_session_id !== workflow.active_codex_session_id ||
          record.readiness_state !== 'ready' ||
          record.approved_boundary_summary_revision_id !== workflow.active_boundary_summary_revision_id ||
          record.approved_spec_revision_id !== workflow.active_spec_doc_revision_id ||
          record.approved_implementation_plan_revision_id !== workflow.active_implementation_plan_doc_revision_id ||
          !record.supporting_evidence.some(
            (supporting) =>
              supporting.object_type === 'implementation_plan_revision' &&
              supporting.object_id === workflow.active_implementation_plan_doc_revision_id,
          )
        ) {
          throw new DomainError('workflow_evidence_not_owned', 'Execution readiness evidence is not ready for this workflow');
        }
        return;
      }
      case 'boundary_summary_revision': {
        const revision = await repository.getBoundarySummaryRevisionById(evidence.object_id);
        if (
          revision === undefined ||
          this.boundaryRevisionDevelopmentPlanItemId(revision) !== workflow.development_plan_item_id ||
          this.recordWorkflowId(revision) !== workflow.id ||
          this.recordCodexSessionId(revision) !== workflow.active_codex_session_id
        ) {
          throw new DomainError('workflow_evidence_not_owned', 'Boundary Summary revision does not belong to this workflow/session');
        }
        if (!evidence.supporting && evidence.to_status === 'spec_generation_queued' && this.recordApprovedAt(revision) === undefined) {
          throw new DomainError('workflow_evidence_type_invalid', 'Boundary approval requires an approved Boundary Summary revision');
        }
        return;
      }
      case 'spec_revision': {
        const revision = await repository.getSpecRevision(evidence.object_id);
        if (
          revision === undefined ||
          revision.development_plan_item_id !== workflow.development_plan_item_id ||
          this.recordWorkflowId(revision) !== workflow.id ||
          this.recordCodexSessionId(revision) !== workflow.active_codex_session_id
        ) {
          throw new DomainError('workflow_evidence_not_owned', 'Spec revision does not belong to this workflow/session');
        }
        if (
          !evidence.supporting &&
          evidence.to_status === 'implementation_plan_generation_queued' &&
          this.recordApprovedAt(revision) === undefined
        ) {
          throw new DomainError('workflow_evidence_type_invalid', 'Spec approval requires an approved Spec revision');
        }
        return;
      }
      case 'implementation_plan_revision': {
        const revision = await repository.getExecutionPlanRevision(evidence.object_id);
        if (
          revision === undefined ||
          revision.development_plan_item_id !== workflow.development_plan_item_id ||
          this.recordWorkflowId(revision) !== workflow.id ||
          this.recordCodexSessionId(revision) !== workflow.active_codex_session_id
        ) {
          throw new DomainError('workflow_evidence_not_owned', 'Implementation Plan revision does not belong to this workflow/session');
        }
        if (
          !evidence.supporting &&
          evidence.to_status === 'execution_ready' &&
          this.recordApprovedAt(revision) === undefined
        ) {
          throw new DomainError('workflow_evidence_type_invalid', 'Execution readiness requires an approved Implementation Plan revision');
        }
        return;
      }
      case 'execution_package': {
        const executionPackage = await repository.getExecutionPackage(evidence.object_id);
        if (
          executionPackage === undefined ||
          executionPackage.development_plan_item_id !== workflow.development_plan_item_id ||
          this.recordWorkflowId(executionPackage) !== workflow.id ||
          this.recordCodexSessionId(executionPackage) !== workflow.active_codex_session_id
        ) {
          throw new DomainError('workflow_evidence_not_owned', 'Execution Package does not belong to this workflow item');
        }
        return;
      }
      case 'run_session': {
        const runSession = await repository.getRunSession(evidence.object_id);
        if (
          runSession === undefined ||
          this.recordWorkflowId(runSession) !== workflow.id ||
          this.recordCodexSessionId(runSession) !== workflow.active_codex_session_id
        ) {
          throw new DomainError('workflow_evidence_not_owned', 'Run Session does not belong to this workflow/session');
        }
        return;
      }
      case 'review_packet': {
        const packet = await repository.getReviewPacket(evidence.object_id);
        const executionPackage =
          packet === undefined ? undefined : await repository.getExecutionPackage(packet.execution_package_id);
        if (
          packet === undefined ||
          executionPackage === undefined ||
          this.recordWorkflowId(packet) !== workflow.id ||
          this.recordCodexSessionId(packet) !== workflow.active_codex_session_id ||
          executionPackage.development_plan_item_id !== workflow.development_plan_item_id ||
          this.recordWorkflowId(executionPackage) !== workflow.id
        ) {
          throw new DomainError('workflow_evidence_not_owned', 'Review Packet does not belong to this workflow item');
        }
        return;
      }
      case 'internal_artifact': {
        const artifact = await repository.getInternalArtifactObjectById(evidence.object_id);
        const allowedOwnerIds = new Set([
          workflow.id,
          workflow.active_codex_session_id,
          workflow.execution_package_id,
        ].filter((id): id is string => id !== undefined));
        if (artifact === undefined || !allowedOwnerIds.has(artifact.owner_id)) {
          throw new DomainError('workflow_evidence_not_owned', 'Internal artifact does not belong to this workflow');
        }
        return;
      }
      case 'commit':
      case 'pull_request': {
        if (!this.isExecutionSideStatus(workflow.status, evidence.to_status)) {
          throw new DomainError('workflow_evidence_type_invalid', 'Commit and pull request evidence is execution-side only');
        }
        await this.validateRepositoryEvidence(repository, workflow, evidence);
        return;
      }
      default:
        throw new DomainError('workflow_evidence_type_invalid', `Unsupported workflow evidence type ${evidence.object_type}`);
    }
  }

  private async requireWorkflow(repository: DeliveryRepository, workflowId: string) {
    const workflow = await repository.getPlanItemWorkflow(workflowId);
    if (workflow === undefined) {
      throw new DomainError('workflow_evidence_missing', `Workflow ${workflowId} does not exist`);
    }
    return workflow;
  }

  private async requireActiveSession(repository: DeliveryRepository, workflow: PlanItemWorkflow) {
    if (workflow.active_codex_session_id === undefined) {
      throw new DomainError('workflow_active_session_missing', `Workflow ${workflow.id} has no active Codex Session`);
    }
    const session = await repository.getCodexSession(workflow.active_codex_session_id);
    if (session === undefined) {
      throw new DomainError('workflow_active_session_missing', `Active Codex Session ${workflow.active_codex_session_id} does not exist`);
    }
    return session;
  }

  private requireTurnForSession(turn: Awaited<ReturnType<DeliveryRepository['getCodexSessionTurn']>>, sessionId: string, turnId: string) {
    if (turn === undefined || turn.codex_session_id !== sessionId) {
      throw new DomainError('codex_session_stale_terminalization', `Turn ${turnId} does not belong to Codex Session ${sessionId}`);
    }
    return turn;
  }

  private recordWorkflowId(record: unknown) {
    return (record as { workflow_id?: string }).workflow_id;
  }

  private recordCodexSessionId(record: unknown) {
    return (record as { codex_session_id?: string }).codex_session_id;
  }

  private recordApprovedAt(record: unknown) {
    return (record as { approved_at?: string }).approved_at;
  }

  private boundaryRevisionDevelopmentPlanItemId(revision: BoundarySummaryRevision) {
    return (revision as BoundarySummaryRevision & { development_plan_item_id?: string }).development_plan_item_id;
  }

  private isExecutionSideStatus(from: PlanItemWorkflow['status'], to: PlanItemWorkflow['status']) {
    return ['execution_ready', 'execution_running', 'code_review', 'qa', 'release_ready'].includes(from) ||
      ['execution_running', 'code_review', 'qa', 'release_ready'].includes(to);
  }

  private executionOwnerActorId(workflow: PlanItemWorkflow) {
    return (workflow as PlanItemWorkflow & { execution_owner_actor_id?: string }).execution_owner_actor_id;
  }

  private async validateRepositoryEvidence(
    repository: DeliveryRepository,
    workflow: PlanItemWorkflow,
    evidence: { object_type: 'commit' | 'pull_request'; object_id: string },
  ) {
    const resolved = await repository.resolveWorkflowRepositoryEvidence({
      evidence_object_type: evidence.object_type,
      evidence_object_id: evidence.object_id,
      workflow_id: workflow.id,
      development_plan_id: workflow.development_plan_id,
      development_plan_item_id: workflow.development_plan_item_id,
    });
    if (resolved === undefined) {
      throw new DomainError('workflow_evidence_not_owned', 'Repository evidence does not resolve to the workflow project repo');
    }
  }

  private toPublicWorkflowDto(workflow: PlanItemWorkflow, session: CodexSession) {
    return {
      id: workflow.id,
      development_plan_id: workflow.development_plan_id,
      development_plan_item_id: workflow.development_plan_item_id,
      status: workflow.status,
      active_codex_session_id: session.id,
      active_boundary_summary_revision_id: workflow.active_boundary_summary_revision_id,
      active_spec_doc_revision_id: workflow.active_spec_doc_revision_id,
      active_implementation_plan_doc_revision_id: workflow.active_implementation_plan_doc_revision_id,
      execution_package_id: workflow.execution_package_id,
      session: codexSessionPublicProjection(session),
      created_at: workflow.created_at,
      updated_at: workflow.updated_at,
    };
  }

  private now() {
    return new Date().toISOString();
  }
}
```

Evidence validation requirements for the implementation above:

- Authorization is part of the workflow service boundary, not controller-only decoration. Before every public workflow mutation, load the current Development Plan Item and call `assertWorkflowActorAuthorized`; reject unauthorized actors with `workflow_actor_not_authorized` before creating manual decisions, readiness records, or transitions.
- Reuse existing actor/role fields (`driver_actor_id`, `leader_actor_id`, `leader_delegate_actor_ids`, `reviewer_actor_id`, operator actor class) instead of inventing a parallel permission model.
- Validate the primary evidence object and every `supporting_evidence` entry through the same ownership function.
- For document evidence (`boundary_summary_revision`, `spec_revision`, `implementation_plan_revision`), require the current workflow id, current Development Plan Item id, and active Codex Session id.
- For `execution_readiness_record`, require `readiness_state = 'ready'` plus the same workflow, Development Plan, item, and active Codex Session ids.
- `approveImplementationPlanAndMarkExecutionReady` is the concrete public action for Implementation Plan approval in Wave 2. It validates the approved Implementation Plan revision, sets `active_implementation_plan_doc_revision_id`, creates the `ExecutionReadinessRecord`, and appends the `implementation_plan_review -> execution_ready` transition in one locked transaction. Do not rely on a caller-created readiness record to set the active plan revision later.
- For execution-side evidence (`execution_package`, `run_session`, `review_packet`, `commit`, `pull_request`, `internal_artifact`), require the current workflow or a repository/project binding that resolves back to the workflow's Development Plan Item. Do not accept item-only evidence when a workflow/session ref is available.
- Throw `workflow_evidence_not_owned` for missing or foreign evidence. Throw `workflow_evidence_type_invalid` when the evidence type is not legal for the requested transition.

Update `apps/control-plane-api/src/modules/http/domain-error.filter.ts` before running API tests:

```ts
const forbiddenDomainErrorCodes = new Set<DomainErrorCode>([
  'FORCE_RERUN_FORBIDDEN',
  'AUTOMATION_CAPABILITY_REJECTED',
  'workflow_actor_not_authorized',
]);

const conflictDomainErrorCodes = new Set<DomainErrorCode>([
  'workflow_legacy_entrypoint_disabled',
  'codex_session_lease_conflict',
  'codex_session_lease_expired',
  'codex_session_stale_terminalization',
  'codex_session_snapshot_stale',
  'codex_session_thread_binding_conflict',
  'codex_session_fork_invalid',
]);

const statusCode =
  forbiddenDomainErrorCodes.has(error.code)
    ? HttpStatus.FORBIDDEN
    : conflictDomainErrorCodes.has(error.code)
      ? HttpStatus.CONFLICT
      : HttpStatus.BAD_REQUEST;
```

This mapping is required for API tests that expect unauthorized workflow actors to return `403`, stale/lease conflicts to return `409`, and legacy bypass routes to return `409`.

- [ ] **Step 5: Add controller and module**

Create `plan-item-workflow.controller.ts`:

```ts
import { Body, Controller, Inject, Param, Post } from '@nestjs/common';

import { ZodValidationPipe } from '../http/zod-validation.pipe';
import {
  startBrainstormingWorkflowSchema,
  approveImplementationPlanAndMarkExecutionReadySchema,
  requestWorkflowChangesSchema,
  manualDecisionBodySchema,
  workflowTransitionCommandSchema,
  type ApproveImplementationPlanAndMarkExecutionReadyDto,
  type ManualDecisionBodyDto,
  type RequestWorkflowChangesDto,
  type StartBrainstormingWorkflowDto,
  type WorkflowTransitionCommandDto,
} from './plan-item-workflow.dto';
import { PlanItemWorkflowService } from './plan-item-workflow.service';

@Controller()
export class PlanItemWorkflowController {
  constructor(@Inject(PlanItemWorkflowService) private readonly service: PlanItemWorkflowService) {}

  @Post('development-plans/:developmentPlanId/items/:itemId/workflow/start-brainstorming')
  startBrainstorming(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(startBrainstormingWorkflowSchema)) body: StartBrainstormingWorkflowDto,
  ) {
    return this.service.startBrainstorming(developmentPlanId, itemId, body);
  }

  @Post('plan-item-workflows/:workflowId/transitions')
  transition(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(workflowTransitionCommandSchema)) body: WorkflowTransitionCommandDto,
  ) {
    return this.service.transitionWorkflow(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/request-implementation-plan-changes')
  requestImplementationPlanChanges(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(requestWorkflowChangesSchema)) body: RequestWorkflowChangesDto,
  ) {
    return this.service.requestImplementationPlanChanges(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/block')
  block(@Param('workflowId') workflowId: string, @Body(new ZodValidationPipe(manualDecisionBodySchema)) body: ManualDecisionBodyDto) {
    return this.service.blockWorkflow(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/recover')
  recover(@Param('workflowId') workflowId: string, @Body(new ZodValidationPipe(manualDecisionBodySchema)) body: ManualDecisionBodyDto) {
    return this.service.recoverWorkflow(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/archive')
  archive(@Param('workflowId') workflowId: string, @Body(new ZodValidationPipe(manualDecisionBodySchema)) body: ManualDecisionBodyDto) {
    return this.service.archiveWorkflow(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/approve-implementation-plan-and-mark-execution-ready')
  approveImplementationPlanAndMarkExecutionReady(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(approveImplementationPlanAndMarkExecutionReadySchema)) body: ApproveImplementationPlanAndMarkExecutionReadyDto,
  ) {
    return this.service.approveImplementationPlanAndMarkExecutionReady(workflowId, body);
  }
}
```

Create `plan-item-workflows.module.ts`, import `ControlPlaneCoreModule`, export `PlanItemWorkflowService`.

Modify `DeliveryModule` and/or `AppModule` to import `PlanItemWorkflowsModule` once.

- [ ] **Step 6: Run workflow API tests**

Run:

```bash
pnpm vitest run tests/api/plan-item-workflows.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit workflow service**

```bash
git add apps/control-plane-api/src/modules/plan-item-workflows apps/control-plane-api/src/modules/http/domain-error.filter.ts apps/control-plane-api/src/app.module.ts apps/control-plane-api/src/modules/delivery/delivery.module.ts tests/helpers/plan-item-workflow-fixtures.ts tests/api/plan-item-workflows.test.ts
git commit -m "feat: add plan item workflow service"
```

## Task 4: Codex Session Lease Service And Internal Routes

**Files:**
- Create: `apps/control-plane-api/src/modules/plan-item-workflows/codex-session-lease.service.ts`
- Create: `apps/control-plane-api/src/modules/plan-item-workflows/internal-codex-session.controller.ts`
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts`
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflows.module.ts`
- Modify: `tests/helpers/plan-item-workflow-fixtures.ts`
- Create: `tests/api/codex-session-lease.test.ts`

- [ ] **Step 1: Write failing lease API tests**

Create `tests/api/codex-session-lease.test.ts`:

```ts
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { signAutomationRequest } from '../../packages/automation/src/index';
import type { DeliveryRepository } from '../../packages/db/src';
import { seedWorkflow, ids } from '../helpers/plan-item-workflow-fixtures';

const trustedSecret = 'test-secret';
const trustedActorId = 'automation-daemon';
const daemonIdentity = 'codex-session-lease-worker';

const signedAutomationPost = (
  app: INestApplication,
  pathAndQuery: string,
  body: Record<string, unknown>,
  actorClass: 'automation_daemon' | 'human_admin' = 'automation_daemon',
) => {
  const rawBody = JSON.stringify(body);
  const headers = signAutomationRequest({
    method: 'POST',
    pathAndQuery,
    rawBody,
    actorId: trustedActorId,
    actorClass,
    daemonIdentity,
    timestamp: new Date().toISOString(),
    secret: trustedSecret,
  });
  return request(app.getHttpServer()).post(pathAndQuery).set(headers).set('Content-Type', 'application/json').send(rawBody);
};

describe('Codex Session lease API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    vi.stubEnv('FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET', trustedSecret);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('claims and renews only the workflow active session', async () => {
    const { workflow } = await seedWorkflow(app);

    const claim = (
      await signedAutomationPost(
        app,
        `/internal/codex-sessions/${workflow.active_codex_session_id}/leases/claim`,
        {
          workflow_id: workflow.id,
          lease_token: 'lease-token-1',
          worker_id: 'worker-1',
          worker_session_digest: 'sha256:worker-session',
          expected_previous_snapshot_digest: null,
          expires_at: '2026-05-31T00:05:00.000Z',
        },
      )
        .expect(201)
    ).body;

    expect(claim).toMatchObject({
      session_id: workflow.active_codex_session_id,
      lease_epoch: 1,
      status: 'active',
    });

    await signedAutomationPost(
      app,
      `/internal/codex-sessions/${workflow.active_codex_session_id}/leases/${claim.id}/renew`,
      {
        lease_token: 'lease-token-1',
        worker_id: 'worker-1',
        worker_session_digest: 'sha256:worker-session',
        lease_epoch: 1,
        expires_at: '2026-05-31T00:10:00.000Z',
      },
    ).expect(201);
  });

  it('requires trusted automation actor auth for internal lease routes', async () => {
    const { workflow } = await seedWorkflow(app);

    await request(app.getHttpServer())
      .post(`/internal/codex-sessions/${workflow.active_codex_session_id}/leases/claim`)
      .send({
        workflow_id: workflow.id,
        lease_token: 'lease-token-1',
        worker_id: 'worker-1',
        worker_session_digest: 'sha256:worker-session',
        expected_previous_snapshot_digest: null,
        expires_at: '2026-05-31T00:05:00.000Z',
      })
      .expect(401);

    await signedAutomationPost(
      app,
      `/internal/codex-sessions/${workflow.active_codex_session_id}/leases/claim`,
      {
        workflow_id: workflow.id,
        lease_token: 'lease-token-1',
        worker_id: 'worker-1',
        worker_session_digest: 'sha256:worker-session',
        expected_previous_snapshot_digest: null,
        expires_at: '2026-05-31T00:05:00.000Z',
      },
      'human_admin',
    ).expect(403);
  });

  it('marks stale terminalization without updating latest snapshot', async () => {
    const { workflow } = await seedWorkflow(app);
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const sessionId = workflow.active_codex_session_id;
    await repository.createCodexSessionTurn({
      id: '11111111-1111-4111-8111-111111119001',
      codex_session_id: sessionId,
      workflow_id: workflow.id,
      intent: 'continue_brainstorming',
      status: 'running',
      input_digest: 'sha256:turn-input',
      expected_previous_snapshot_digest: undefined,
      created_by_actor_id: ids.actorTech,
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    });

    const claimed = await repository.claimCodexSessionLease({
      session_id: sessionId,
      workflow_id: workflow.id,
      lease_id: 'lease-current',
      lease_token_hash: 'sha256:current',
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      expected_previous_snapshot_digest: undefined,
      now: '2026-05-31T00:00:00.000Z',
      expires_at: '2026-05-31T00:05:00.000Z',
    });

    await signedAutomationPost(
      app,
      `/internal/codex-sessions/${sessionId}/turns/11111111-1111-4111-8111-111111119001/terminalize`,
      {
        lease_id: claimed.lease.id,
        lease_token: 'wrong-token',
        lease_epoch: 1,
        worker_id: 'worker-1',
        worker_session_digest: 'sha256:worker-session',
        status: 'succeeded',
        expected_previous_snapshot_digest: null,
        codex_thread_id_digest: 'sha256:thread-output',
      },
    ).expect(409);

    await expect(repository.getCodexSession(sessionId)).resolves.toMatchObject({
      latest_snapshot_digest: undefined,
      codex_thread_id_digest: undefined,
      status: 'running',
      role: 'active',
    });
    await expect(repository.getCodexSessionTurn('11111111-1111-4111-8111-111111119001')).resolves.toMatchObject({
      status: 'stale',
      output_snapshot_id: undefined,
      output_snapshot_digest: undefined,
      codex_thread_id_digest: undefined,
    });
    await expect(repository.listPlanItemWorkflowTransitions(workflow.id)).resolves.toHaveLength(1);
    await expect(repository.listStaleCodexSessionTerminalizationAttempts(sessionId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codex_session_id: sessionId,
          codex_session_turn_id: '11111111-1111-4111-8111-111111119001',
          lease_id: claimed.lease.id,
          failure_code: 'codex_session_lease_conflict',
        }),
      ]),
    );
  });
});
```

Use `seedWorkflow(app)` from `tests/helpers/plan-item-workflow-fixtures.ts`. The helper must create persisted UUID-shaped organization, actors, project, repo, Development Plan, and Development Plan Item before starting the workflow; do not use plain ids like `actor-tech` in API-layer fixture records.

- [ ] **Step 2: Run lease tests to verify they fail**

Run:

```bash
pnpm vitest run tests/api/codex-session-lease.test.ts
```

Expected: FAIL because routes/service do not exist.

- [ ] **Step 3: Add lease DTOs**

Extend `plan-item-workflow.dto.ts`:

```ts
export const claimCodexSessionLeaseSchema = z.object({
  workflow_id: nonEmpty,
  lease_token: nonEmpty,
  worker_id: nonEmpty,
  worker_session_digest: nonEmpty,
  expected_previous_snapshot_digest: nonEmpty.nullable(),
  expires_at: z.string().datetime(),
}).strict();

export const renewCodexSessionLeaseSchema = z.object({
  lease_token: nonEmpty,
  worker_id: nonEmpty,
  worker_session_digest: nonEmpty,
  lease_epoch: z.number().int().positive(),
  expires_at: z.string().datetime(),
}).strict();

export const terminalizeCodexSessionTurnSchema = z.object({
  lease_id: nonEmpty,
  lease_token: nonEmpty,
  lease_epoch: z.number().int().positive(),
  worker_id: nonEmpty,
  worker_session_digest: nonEmpty,
  status: z.enum(['succeeded', 'failed', 'cancelled']),
  expected_previous_snapshot_digest: nonEmpty.nullable(),
  output_snapshot_id: nonEmpty.optional(),
  output_snapshot_sequence: z.number().int().positive().optional(),
  output_snapshot_artifact_ref: nonEmpty.optional(),
  output_snapshot_digest: nonEmpty.optional(),
  output_snapshot_size_bytes: nonEmpty.optional(),
  output_snapshot_manifest_digest: nonEmpty.optional(),
  runtime_profile_revision_id: nonEmpty.optional(),
  codex_thread_id: nonEmpty.optional(),
  codex_thread_id_digest: nonEmpty.optional(),
  failure_code: nonEmpty.optional(),
}).strict().superRefine((body, ctx) => {
  const snapshotFields = [
    'output_snapshot_id',
    'output_snapshot_sequence',
    'output_snapshot_artifact_ref',
    'output_snapshot_digest',
    'output_snapshot_size_bytes',
    'output_snapshot_manifest_digest',
    'runtime_profile_revision_id',
  ] as const;
  const snapshotProvided = snapshotFields.some((field) => body[field] !== undefined);
  if (!snapshotProvided) return;
  for (const field of snapshotFields) {
    if (body[field] === undefined) {
      ctx.addIssue({ code: 'custom', path: [field], message: `${field} is required when output snapshot is provided` });
    }
  }
});

export type ClaimCodexSessionLeaseDto = z.infer<typeof claimCodexSessionLeaseSchema>;
export type RenewCodexSessionLeaseDto = z.infer<typeof renewCodexSessionLeaseSchema>;
export type TerminalizeCodexSessionTurnDto = z.infer<typeof terminalizeCodexSessionTurnSchema>;
```

Because `superRefine` does not narrow `TerminalizeCodexSessionTurnDto`, all code that constructs `CodexSessionSnapshot` must use the explicit `hasOutputSnapshot()` type guard below. Do not directly branch on only `output_snapshot_id` or `output_snapshot_digest`.

- [ ] **Step 4: Add lease service**

Create `codex-session-lease.service.ts`:

```ts
import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { DomainError } from '@forgeloop/domain';
import type { CodexSessionLease } from '@forgeloop/domain';
import { automationActorIdHeaderName } from '@forgeloop/automation';

import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import type { DeliveryRepository } from '@forgeloop/db';
import type { CodexSessionSnapshot } from '@forgeloop/domain';
import type {
  ClaimCodexSessionLeaseDto,
  RenewCodexSessionLeaseDto,
  TerminalizeCodexSessionTurnDto,
} from './plan-item-workflow.dto';

const hashLeaseToken = (token: string) => `sha256:${createHash('sha256').update(token).digest('hex')}`;

const staleTerminalizationCodes = new Set([
  'codex_session_lease_conflict',
  'codex_session_lease_expired',
  'codex_session_stale_terminalization',
  'codex_session_snapshot_stale',
]);

const hasOutputSnapshot = (
  dto: TerminalizeCodexSessionTurnDto,
): dto is TerminalizeCodexSessionTurnDto & {
  output_snapshot_id: string;
  output_snapshot_sequence: number;
  output_snapshot_artifact_ref: string;
  output_snapshot_digest: string;
  output_snapshot_size_bytes: string;
  output_snapshot_manifest_digest: string;
  runtime_profile_revision_id: string;
} =>
  dto.output_snapshot_id !== undefined &&
  dto.output_snapshot_sequence !== undefined &&
  dto.output_snapshot_artifact_ref !== undefined &&
  dto.output_snapshot_digest !== undefined &&
  dto.output_snapshot_size_bytes !== undefined &&
  dto.output_snapshot_manifest_digest !== undefined &&
  dto.runtime_profile_revision_id !== undefined;

@Injectable()
export class CodexSessionLeaseService {
  constructor(@Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository) {}

  async claim(sessionId: string, dto: ClaimCodexSessionLeaseDto) {
    const claimed = await this.repository.claimCodexSessionLease({
      session_id: sessionId,
      workflow_id: dto.workflow_id,
      lease_id: randomUUID(),
      lease_token_hash: hashLeaseToken(dto.lease_token),
      worker_id: dto.worker_id,
      worker_session_digest: dto.worker_session_digest,
      expected_previous_snapshot_digest: dto.expected_previous_snapshot_digest ?? undefined,
      now: this.now(),
      expires_at: dto.expires_at,
    });
    return this.toLeaseResponse(claimed.lease);
  }

  async renew(sessionId: string, leaseId: string, dto: RenewCodexSessionLeaseDto) {
    const lease = await this.repository.renewCodexSessionLease({
      session_id: sessionId,
      lease_id: leaseId,
      lease_token_hash: hashLeaseToken(dto.lease_token),
      worker_id: dto.worker_id,
      worker_session_digest: dto.worker_session_digest,
      lease_epoch: dto.lease_epoch,
      now: this.now(),
      expires_at: dto.expires_at,
    });
    return this.toLeaseResponse(lease);
  }

  async terminalize(sessionId: string, turnId: string, dto: TerminalizeCodexSessionTurnDto, request: Request) {
    const trustedActorId = this.requireTrustedActorId(request);
    const outputSnapshot: CodexSessionSnapshot | undefined = hasOutputSnapshot(dto)
      ? {
          id: dto.output_snapshot_id,
          codex_session_id: sessionId,
          sequence: dto.output_snapshot_sequence,
          artifact_ref: dto.output_snapshot_artifact_ref,
          digest: dto.output_snapshot_digest,
          size_bytes: dto.output_snapshot_size_bytes,
          manifest_digest: dto.output_snapshot_manifest_digest,
          codex_thread_id_digest: dto.codex_thread_id_digest,
          runtime_profile_revision_id: dto.runtime_profile_revision_id,
          created_from_turn_id: turnId,
          created_by_actor_id: trustedActorId,
          created_at: this.now(),
        }
      : undefined;

    try {
      const result = await this.repository.terminalizeCodexSessionTurn({
        session_id: sessionId,
        turn_id: turnId,
        lease_id: dto.lease_id,
        lease_token_hash: hashLeaseToken(dto.lease_token),
        lease_epoch: dto.lease_epoch,
        worker_id: dto.worker_id,
        worker_session_digest: dto.worker_session_digest,
        status: dto.status,
        expected_previous_snapshot_digest: dto.expected_previous_snapshot_digest ?? undefined,
        output_snapshot: outputSnapshot,
        codex_thread_id: dto.codex_thread_id,
        codex_thread_id_digest: dto.codex_thread_id_digest,
        failure_code: dto.failure_code,
        now: this.now(),
      });
      return { session_id: result.session.id, turn_id: result.turn.id, status: result.turn.status };
    } catch (error) {
      if (!(error instanceof DomainError) || !staleTerminalizationCodes.has(error.code)) throw error;
      const turn = await this.repository.getCodexSessionTurn(turnId);
      const safeTurn = turn !== undefined && turn.codex_session_id === sessionId ? turn : undefined;
      await this.repository.saveStaleCodexSessionTerminalizationAttempt({
        id: randomUUID(),
        codex_session_id: sessionId,
        codex_session_turn_id: safeTurn?.id,
        lease_id: dto.lease_id,
        lease_epoch: dto.lease_epoch,
        worker_id: dto.worker_id,
        worker_session_digest: dto.worker_session_digest,
        expected_previous_snapshot_digest: dto.expected_previous_snapshot_digest ?? undefined,
        attempted_output_snapshot_digest: dto.output_snapshot_digest,
        attempted_codex_thread_id_digest: dto.codex_thread_id_digest,
        failure_code: error.code,
        created_at: this.now(),
      });
      if (safeTurn !== undefined) {
        await this.repository.saveCodexSessionTurn({
          ...safeTurn,
          status: 'stale',
          output_snapshot_id: undefined,
          output_snapshot_digest: undefined,
          codex_thread_id_digest: undefined,
          updated_at: this.now(),
        });
      }
      throw error;
    }
  }

  private toLeaseResponse(lease: CodexSessionLease) {
    return {
      id: lease.id,
      session_id: lease.codex_session_id,
      lease_epoch: lease.lease_epoch,
      status: lease.status,
      expires_at: lease.expires_at,
    };
  }

  private now() {
    return new Date().toISOString();
  }

  private requireTrustedActorId(request: Request) {
    const value = request.header(automationActorIdHeaderName)?.trim();
    if (value === undefined || value.length === 0) {
      throw new DomainError('workflow_actor_not_authorized', 'Trusted automation actor id is required for snapshot attribution');
    }
    return value;
  }
}
```

Delegate CAS logic to repository. The service must never return lease token hashes, raw lease tokens, worker session secrets, or raw thread ids.

Stale terminalization requirements:

- Repository `terminalizeCodexSessionTurn` must throw a stale-terminalization/domain error for non-current lease, expired token, stale epoch, or stale expected snapshot digest before mutating session snapshot/thread/status.
- `CodexSessionLeaseService.terminalize` must catch `DomainError` codes in the stale-terminalization family, load the turn first, persist `CodexSessionStaleTerminalizationAttempt` with `codex_session_turn_id` only when `turn.codex_session_id === sessionId`, mark the turn `stale` only in that same-session case, clear any attempted output/thread fields on that turn, and then rethrow the same public-safe conflict error.
- Do not append workflow transitions, bind thread ids, change `CodexSession.latest_snapshot_*`, change active session role, or mark the session blocked from stale terminalization. Recovery status changes belong to explicit recovery paths only.

- [ ] **Step 5: Add internal controller**

Create `internal-codex-session.controller.ts`:

```ts
import { Body, Controller, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { TrustedAutomationActorGuard } from '../automation/trusted-automation-actor.guard';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import {
  claimCodexSessionLeaseSchema,
  renewCodexSessionLeaseSchema,
  terminalizeCodexSessionTurnSchema,
  type ClaimCodexSessionLeaseDto,
  type RenewCodexSessionLeaseDto,
  type TerminalizeCodexSessionTurnDto,
} from './plan-item-workflow.dto';
import { CodexSessionLeaseService } from './codex-session-lease.service';

@Controller('internal/codex-sessions')
@UseGuards(TrustedAutomationActorGuard)
export class InternalCodexSessionController {
  constructor(@Inject(CodexSessionLeaseService) private readonly service: CodexSessionLeaseService) {}

  @Post(':sessionId/leases/claim')
  claim(
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(claimCodexSessionLeaseSchema)) body: ClaimCodexSessionLeaseDto,
  ) {
    return this.service.claim(sessionId, body);
  }

  @Post(':sessionId/leases/:leaseId/renew')
  renew(
    @Param('sessionId') sessionId: string,
    @Param('leaseId') leaseId: string,
    @Body(new ZodValidationPipe(renewCodexSessionLeaseSchema)) body: RenewCodexSessionLeaseDto,
  ) {
    return this.service.renew(sessionId, leaseId, body);
  }

  @Post(':sessionId/turns/:turnId/terminalize')
  terminalize(
    @Param('sessionId') sessionId: string,
    @Param('turnId') turnId: string,
    @Req() request: Request,
    @Body(new ZodValidationPipe(terminalizeCodexSessionTurnSchema)) body: TerminalizeCodexSessionTurnDto,
  ) {
    return this.service.terminalize(sessionId, turnId, body, request);
  }
}
```

Wire it into `PlanItemWorkflowsModule`.

Internal route guard requirement:

- Register `TrustedAutomationActorGuard` in `PlanItemWorkflowsModule` providers, reusing the same signed automation actor mechanism as current Codex runtime internal routes.
- Apply `@UseGuards(TrustedAutomationActorGuard)` at the `InternalCodexSessionController` class level.
- Tests must assert unsigned requests return `401` and signed non-`automation_daemon` requests return `403`; product/user tokens must not be accepted for lease claim, renew, or terminalize.

- [ ] **Step 6: Run lease API tests**

Run:

```bash
pnpm vitest run tests/api/codex-session-lease.test.ts tests/db/plan-item-workflow-repository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit lease service**

```bash
git add apps/control-plane-api/src/modules/plan-item-workflows tests/api/codex-session-lease.test.ts tests/db/plan-item-workflow-repository.test.ts
git commit -m "feat: add codex session lease controls"
```

## Task 5: Attach Child Records To Workflow Session Turn

**Files:**
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Modify: `apps/control-plane-api/src/modules/brainstorming/brainstorming.service.ts`
- Modify: `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/product-generation-runtime-scheduler.service.ts`
- Modify: `apps/control-plane-api/src/modules/automation/product-generation-result.service.ts`
- Modify: `apps/control-plane-api/src/modules/executions/executions.service.ts`
- Modify: `tests/api/brainstorming.test.ts`
- Modify: `tests/api/spec-plan-service.test.ts`
- Modify: `tests/api/codex-runtime-control-plane.test.ts`
- Modify: `tests/api/executions.test.ts`

- [ ] **Step 1: Write failing child-link tests**

Add tests to existing suites:

In `tests/api/brainstorming.test.ts`:

```ts
it('stores workflow and Codex session refs on boundary brainstorming child records', async () => {
  const { plan, item } = await seedDevelopmentPlanItem(app);
  const workflow = await startWorkflow(app, plan.id, item.id);

  const session = (
    await request(app.getHttpServer())
      .post(`/plan-item-workflows/${workflow.id}/boundary-brainstorming`)
      .send({ actor_id: ids.actorLeader })
      .expect(201)
  ).body;

  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  await expect(repository.getBrainstormingSession(session.id)).resolves.toMatchObject({
    workflow_id: workflow.id,
    codex_session_id: workflow.active_codex_session_id,
  });
});
```

In `tests/api/spec-plan-service.test.ts`:

```ts
it('stores workflow/session/turn refs on generated Spec revisions', async () => {
  const seeded = await seedApprovedBoundaryWorkflow(app);
  const specRevision = await generateSpecThroughWorkflow(app, seeded.workflow.id);

  expect(specRevision).toMatchObject({
    workflow_id: seeded.workflow.id,
    codex_session_id: seeded.workflow.active_codex_session_id,
    codex_session_turn_id: expect.any(String),
  });
});
```

Use helper names that you implement locally in tests. Keep them small and route through new workflow APIs.

- [ ] **Step 2: Run child-link tests to verify they fail**

Run:

```bash
pnpm vitest run tests/api/brainstorming.test.ts tests/api/spec-plan-service.test.ts
```

Expected: FAIL because services do not populate refs or workflow routes do not exist yet.

- [ ] **Step 3: Confirm repository mapping for nullable refs**

The nullable workflow/session/turn fields and row mappers were added in Task 2 so Task 3 could build evidence ownership validation. In this step, verify no service still drops those fields when saving records:

- `BrainstormingSession.workflow_id`;
- `BrainstormingSession.codex_session_id`;
- `BoundaryRound.codex_session_turn_id`;
- `BoundarySummaryRevision.workflow_id`;
- `BoundarySummaryRevision.codex_session_id`;
- `Spec.workflow_id`;
- `SpecRevision.workflow_id`;
- `SpecRevision.codex_session_id`;
- `SpecRevision.codex_session_turn_id`;
- `ExecutionPlanDocument.workflow_id`;
- `ExecutionPlanRevision.workflow_id`;
- `ExecutionPlanRevision.codex_session_id`;
- `ExecutionPlanRevision.codex_session_turn_id`;
- `AutomationActionRun.workflow_id`;
- `AutomationActionRun.codex_session_id`;
- `AutomationActionRun.codex_session_turn_id`;
- `CodexRuntimeJob.workflow_id`;
- `CodexRuntimeJob.codex_session_id`;
- `CodexRuntimeJob.codex_session_turn_id`;
- `RunSession.workflow_id`;
- `RunSession.codex_session_id`;
- `RunSession.codex_session_turn_id`.

- [ ] **Step 4: Add workflow-aware adapter methods**

In `PlanItemWorkflowService`, add narrow orchestration methods:

```ts
startBoundaryBrainstorming(workflowId, dto)
submitBoundarySummary(workflowId, revisionId, dto)
approveBoundary(workflowId, revisionId, dto)
generateSpecRevision(workflowId, dto)
submitSpecRevision(workflowId, revisionId, dto)
approveSpec(workflowId, revisionId, dto)
generateImplementationPlanRevision(workflowId, dto)
submitImplementationPlanRevision(workflowId, revisionId, dto)
approveImplementationPlanAndMarkExecutionReady(workflowId, dto)
```

These methods may call existing services as adapters, but they must:

- create or identify a `CodexSessionTurn`;
- pass workflow/session/turn refs into adapter calls;
- append transitions only after evidence exists;
- not infer status from Codex text.

Avoid circular dependency by extracting adapter functions or injecting existing services into the workflow module with `forwardRef` only if unavoidable. Prefer small adapter methods on existing services that accept an optional context object.

Context type:

```ts
interface PlanItemWorkflowChildContext {
  workflow_id: string;
  codex_session_id: string;
  codex_session_turn_id?: string;
}
```

Add matching DTOs and workflow-addressed controller routes in `plan-item-workflow.dto.ts` and `plan-item-workflow.controller.ts`:

```ts
export const workflowActorCommandSchema = z.object({
  actor_id: nonEmpty,
}).strict();

export const workflowRevisionCommandSchema = workflowActorCommandSchema.extend({
  revision_id: nonEmpty,
  reason: nonEmpty.optional(),
}).strict();

export type WorkflowActorCommandDto = z.infer<typeof workflowActorCommandSchema>;
export type WorkflowRevisionCommandDto = z.infer<typeof workflowRevisionCommandSchema>;
```

Controller routes:

```ts
@Post('plan-item-workflows/:workflowId/boundary-brainstorming')
startBoundaryBrainstorming(@Param('workflowId') workflowId: string, @Body(new ZodValidationPipe(workflowActorCommandSchema)) body: WorkflowActorCommandDto) {
  return this.service.startBoundaryBrainstorming(workflowId, body);
}

@Post('plan-item-workflows/:workflowId/boundary-summary-revisions/:revisionId/submit')
submitBoundarySummary(@Param('workflowId') workflowId: string, @Param('revisionId') revisionId: string, @Body(new ZodValidationPipe(workflowActorCommandSchema)) body: WorkflowActorCommandDto) {
  return this.service.submitBoundarySummary(workflowId, revisionId, body);
}

@Post('plan-item-workflows/:workflowId/boundary-summary-revisions/:revisionId/approve')
approveBoundary(@Param('workflowId') workflowId: string, @Param('revisionId') revisionId: string, @Body(new ZodValidationPipe(workflowActorCommandSchema)) body: WorkflowActorCommandDto) {
  return this.service.approveBoundary(workflowId, revisionId, body);
}

@Post('plan-item-workflows/:workflowId/spec/generate-draft')
generateSpecRevision(@Param('workflowId') workflowId: string, @Body(new ZodValidationPipe(workflowActorCommandSchema)) body: WorkflowActorCommandDto) {
  return this.service.generateSpecRevision(workflowId, body);
}

@Post('plan-item-workflows/:workflowId/spec-revisions/:revisionId/submit')
submitSpecRevision(@Param('workflowId') workflowId: string, @Param('revisionId') revisionId: string, @Body(new ZodValidationPipe(workflowActorCommandSchema)) body: WorkflowActorCommandDto) {
  return this.service.submitSpecRevision(workflowId, revisionId, body);
}

@Post('plan-item-workflows/:workflowId/spec-revisions/:revisionId/approve')
approveSpec(@Param('workflowId') workflowId: string, @Param('revisionId') revisionId: string, @Body(new ZodValidationPipe(workflowActorCommandSchema)) body: WorkflowActorCommandDto) {
  return this.service.approveSpec(workflowId, revisionId, body);
}

@Post('plan-item-workflows/:workflowId/implementation-plan/generate-draft')
generateImplementationPlanRevision(@Param('workflowId') workflowId: string, @Body(new ZodValidationPipe(workflowActorCommandSchema)) body: WorkflowActorCommandDto) {
  return this.service.generateImplementationPlanRevision(workflowId, body);
}

@Post('plan-item-workflows/:workflowId/implementation-plan-revisions/:revisionId/submit')
submitImplementationPlanRevision(@Param('workflowId') workflowId: string, @Param('revisionId') revisionId: string, @Body(new ZodValidationPipe(workflowActorCommandSchema)) body: WorkflowActorCommandDto) {
  return this.service.submitImplementationPlanRevision(workflowId, revisionId, body);
}
```

These routes are the workflow equivalents that Task 6 routes legacy public mutators toward. If an equivalent service method is not completed in Wave 2, the route must explicitly return `workflow_legacy_entrypoint_disabled` instead of silently leaving the old child-service route active.

- [ ] **Step 5: Update existing services to accept context**

Modify `BrainstormingService`:

- Add context to start/continue/terminalize methods used by workflow.
- Save refs on session/round/summary revision.
- Keep read routes unchanged.

Modify `SpecPlanService`:

- Add context to generate/save/submit/approve methods used by workflow.
- Save refs on spec/plan docs and revisions.

Modify scheduler/result services:

- Include refs in action input/metadata and runtime job creation.
- On generated payload completion, save child revision with refs and return evidence to workflow service.

- [ ] **Step 6: Run child-link tests**

Run:

```bash
pnpm vitest run tests/api/brainstorming.test.ts tests/api/spec-plan-service.test.ts tests/api/codex-runtime-control-plane.test.ts tests/api/executions.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit child-record linking**

```bash
git add packages/domain packages/db apps/control-plane-api/src/modules tests/api
git commit -m "feat: attach workflow session refs to delivery records"
```

## Task 6: Legacy Entrypoint Guardrails

**Files:**
- Modify: `apps/control-plane-api/src/modules/brainstorming/brainstorming.controller.ts`
- Modify: `apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts`
- Modify: `apps/control-plane-api/src/modules/execution-packages/execution-packages.controller.ts`
- Modify: `apps/control-plane-api/src/modules/run-control/execution-package-runs.controller.ts`
- Modify: `apps/control-plane-api/src/modules/http/domain-error.filter.ts` for `403` workflow auth errors and `409` lease/legacy/fork conflicts.
- Modify: existing actor/role policy helpers if one already owns Development Plan Item permissions; otherwise keep `assertWorkflowActorAuthorized` in the workflow domain module.
- Modify: `tests/api/brainstorming.test.ts`
- Modify: `tests/api/spec-plan-service.test.ts`
- Modify: `tests/api/execution-package-service.test.ts`
- Modify: `tests/api/run-control-boundary.test.ts`
- Modify: `tests/smoke/codex-runtime-no-baggage-gate.test.ts`

- [ ] **Step 1: Write failing bypass tests**

Add or update tests:

```ts
it('rejects legacy direct Spec generation outside PlanItemWorkflowService', async () => {
  const { plan, item } = await seedApprovedBoundary(app);

  await request(app.getHttpServer())
    .post(`/development-plans/${plan.id}/items/${item.id}/spec/generate-draft`)
    .send({ actor_id: ids.actorTech })
    .expect(409)
    .expect(({ body }) => {
      expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
    });
});
```

Add equivalent tests for:

- direct boundary start/restart if it bypasses workflow;
- direct implementation plan generation/approval;
- direct execution package generation from plan revision where it bypasses workflow;
- direct execution run from package when workflow refs are missing.

Use existing route tests where possible.

- [ ] **Step 2: Run bypass tests to verify they fail**

Run:

```bash
pnpm vitest run tests/api/brainstorming.test.ts tests/api/spec-plan-service.test.ts tests/api/execution-package-service.test.ts tests/api/run-control-boundary.test.ts
```

Expected: FAIL because legacy routes still succeed.

- [ ] **Step 3: Add guard helper**

Create or add to `PlanItemWorkflowService`:

```ts
assertLegacyWorkflowEntrypointDisabled(routeName: string): never {
  throw new DomainError('workflow_legacy_entrypoint_disabled', `${routeName} must use PlanItemWorkflowService`);
}
```

If some routes must remain for compatibility inside tests, make them internal adapter-only and not exposed through public controllers.

- [ ] **Step 4: Route or reject legacy public controllers**

For each public state-changing route:

- If a workflow equivalent exists, update controller to call workflow service.
- If no workflow equivalent exists in Wave 2, reject with `workflow_legacy_entrypoint_disabled`.
- Keep read routes and revision compare routes working.
- Keep direct draft save only if it does not advance workflow state; if it creates evidence for a workflow, require `workflow_id` route or context.

Do not remove tests for old functionality silently. Replace expected success with explicit rejection or workflow route success.

- [ ] **Step 5: Add no-baggage smoke checks**

Modify `tests/smoke/codex-runtime-no-baggage-gate.test.ts` to scan route/controller files for forbidden public patterns such as:

```ts
const forbiddenPublicMutators = [
  "items/:itemId/spec/generate-draft",
  "items/:itemId/spec/approve",
  "items/:itemId/implementation-plan/generate-draft",
  "items/:itemId/implementation-plan/approve",
];
```

The test should allow these strings only if the controller method delegates to `PlanItemWorkflowService` or throws `workflow_legacy_entrypoint_disabled`.

- [ ] **Step 6: Run bypass and smoke tests**

Run:

```bash
pnpm vitest run tests/api/brainstorming.test.ts tests/api/spec-plan-service.test.ts tests/api/execution-package-service.test.ts tests/api/run-control-boundary.test.ts tests/smoke/codex-runtime-no-baggage-gate.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit guardrails**

```bash
git add apps/control-plane-api/src/modules tests/api tests/smoke/codex-runtime-no-baggage-gate.test.ts
git commit -m "feat: route superpowers workflow entrypoints"
```

## Task 7: Execution Readiness And Fork Selection

**Files:**
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts`
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.controller.ts`
- Modify: `apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts`
- Modify: `tests/helpers/plan-item-workflow-fixtures.ts`
- Modify: `tests/api/plan-item-workflows.test.ts`
- Modify: `tests/db/plan-item-workflow-repository.test.ts`

- [ ] **Step 1: Write failing readiness/fork tests**

Add to `tests/api/plan-item-workflows.test.ts`:

```ts
it('requires execution readiness aggregate evidence before execution_ready', async () => {
  const seeded = await seedWorkflowWithApprovedImplementationPlan(app);

  await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/transitions`)
    .send({
      actor_id: ids.actorTech,
      to_status: 'execution_ready',
      evidence_object_type: 'implementation_plan_revision',
      evidence_object_id: seeded.implementationPlanRevision.id,
    })
    .expect(400);

  await request(app.getHttpServer())
    .post(`/plan-item-workflows/${seeded.workflow.id}/approve-implementation-plan-and-mark-execution-ready`)
    .send({
      actor_id: ids.actorTech,
      approved_implementation_plan_revision_id: seeded.implementationPlanRevision.id,
      reason: 'Implementation Plan approved and ready for execution.',
    })
    .expect(201)
    .expect(({ body }) => {
      expect(body).toMatchObject({
        status: 'execution_ready',
        active_implementation_plan_doc_revision_id: seeded.implementationPlanRevision.id,
      });
    });
});

it('selects a fork only when both sessions are lease-free and non-running', async () => {
  const { workflow } = await seedWorkflow(app);
  const fork = await createFork(app, workflow.id);

  await request(app.getHttpServer())
    .post(`/plan-item-workflows/${workflow.id}/codex-sessions/${fork.id}/select-active-fork`)
    .send({
      actor_id: ids.actorTech,
      reason: 'Use the alternative path.',
    })
    .expect(201);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm vitest run tests/api/plan-item-workflows.test.ts tests/db/plan-item-workflow-repository.test.ts
```

Expected: FAIL for missing readiness/fork API implementation.

- [ ] **Step 3: Implement readiness record creation**

In `PlanItemWorkflowService`:

- Use the existing Task 3 method shape `approveImplementationPlanAndMarkExecutionReady(workflowId, input)`, where `input` contains `actor_id`, `approved_implementation_plan_revision_id`, and optional `reason`. Do not introduce an overload that takes `(workflowId, actorId, approvedImplementationPlanRevisionId)`.
- Validate active approved Boundary Summary, Spec Doc, and Implementation Plan Doc revision ids exist.
- In Wave 2, use current known checks only:
  - active approved boundary id present;
  - active approved spec id present;
  - approved implementation plan revision belongs to the current workflow/item/session and is approved;
  - workflow status is `implementation_plan_review`.
- Load those three active revision records and verify each is approved (`approved_at` present and approved actor field present where the current domain type has one).
- Set `active_implementation_plan_doc_revision_id = approvedImplementationPlanRevisionId` before creating readiness evidence.
- Persist `ExecutionReadinessRecord` with `readiness_state = 'ready'` or `not_ready`.
- `ExecutionReadinessRecord.approved_boundary_summary_revision_id`, `approved_spec_revision_id`, and `approved_implementation_plan_revision_id` must exactly match the workflow active revision fields.
- `ExecutionReadinessRecord.supporting_evidence` must include the active approved Implementation Plan revision as `{ object_type: 'implementation_plan_revision', object_id: workflow.active_implementation_plan_doc_revision_id }`.
- `transitionWorkflow` only permits `execution_ready` if the readiness record is ready, belongs to workflow/session, matches all active approved revision ids, and carries the required supporting evidence.
- The public controller route for this action is `POST /plan-item-workflows/:workflowId/approve-implementation-plan-and-mark-execution-ready`; it must not expose a direct child `approve implementation plan` route that advances workflow state outside this service action.

- [ ] **Step 4: Implement fork APIs**

Add controller routes:

```text
POST /plan-item-workflows/:workflowId/codex-sessions/:sessionId/fork
POST /plan-item-workflows/:workflowId/codex-sessions/:sessionId/select-active-fork
```

Implement service:

- `forkCodexSession` creates child with `role = 'candidate_fork'`.
- `selectActiveCodexSessionFork`:
  - creates `WorkflowManualDecision` with `kind = 'fork_select'`;
  - calls repository fork selection;
  - appends same-status transition;
  - returns public workflow.

- [ ] **Step 5: Run readiness/fork tests**

Run:

```bash
pnpm vitest run tests/api/plan-item-workflows.test.ts tests/db/plan-item-workflow-repository.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit readiness and fork selection**

```bash
git add apps/control-plane-api/src/modules/plan-item-workflows tests/api/plan-item-workflows.test.ts tests/db/plan-item-workflow-repository.test.ts
git commit -m "feat: add workflow readiness and fork controls"
```

## Task 8: Final Integration And No-Leak Verification

**Files:**
- Modify as needed from prior tasks.
- Modify: `tests/smoke/codex-runtime-no-baggage-gate.test.ts`
- Modify: `tests/api/delivery-route-contract.test.ts` if route inventory tests require updates.
- Modify: `tests/api/query-module.test.ts` or projection tests only if public DTOs need workflow projections.

- [ ] **Step 1: Run targeted test suite**

Run:

```bash
pnpm vitest run \
  tests/contracts/plan-item-workflow.test.ts \
  tests/domain/plan-item-workflow.test.ts \
  tests/db/plan-item-workflow-repository.test.ts \
  tests/db/schema.test.ts \
  tests/db/reset.test.ts \
  tests/api/plan-item-workflows.test.ts \
  tests/api/codex-session-lease.test.ts \
  tests/api/brainstorming.test.ts \
  tests/api/spec-plan-service.test.ts \
  tests/api/codex-runtime-control-plane.test.ts \
  tests/api/executions.test.ts \
  tests/smoke/codex-runtime-no-baggage-gate.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Inspect public DTO no-leak behavior**

Run:

```bash
rg -n "codex_thread_id|latest_snapshot_digest|artifact_ref|credential_binding_id|lease_token_hash|worker_id" apps/control-plane-api/src packages/contracts/src tests/api tests/contracts
```

Expected:

- raw fields may appear in internal controller/service tests;
- normal public DTO schemas must not expose them;
- any product route response tests should assert these fields are absent.

- [ ] **Step 6: Commit final integration fixes**

If Step 1-5 required changes:

```bash
git add .
git commit -m "test: verify workflow session lease integration"
```

If no changes were needed, do not create an empty commit.

## Execution Handoff Notes

- Start with Task 1 and do not skip ahead to service migration before domain and DB tests pass.
- Keep each task's commit narrow. If a task grows too large, stop and split the task before coding further.
- Prefer adding adapter context parameters over rewriting large existing services.
- When touching legacy public routes, preserve read-only routes and revision compare routes unless they mutate workflow state.
- Treat any direct mutation of `DevelopmentPlanItem.*_status` as projection-only. If it is used as an authority for a Superpowers transition, route through `PlanItemWorkflowService`.
- If a circular NestJS dependency appears, extract a small adapter provider rather than broad `forwardRef` chains.
