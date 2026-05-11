# Release Risk Radar Product Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the P1 Release command surface, Release & Risk Radar cockpit/replay reads, minimal Release Owner web surface, and dogfood verification without legacy compatibility shims.

**Architecture:** Contracts and domain own the canonical Release DTOs, lifecycle, blocker truth table, and public decision/evidence schemas. Repository/query helpers assemble public read models through the shared public evidence serializer, Nest `ReleaseModule` owns `/releases` commands and lightweight reads, `QueryModule` owns cockpit/replay reads, and the web app renders backend-derived state without duplicating gate logic.

**Tech Stack:** TypeScript, Zod v4, Vitest, Supertest, NestJS, React/Vite, Drizzle ORM, pnpm workspaces, in-memory and Drizzle-backed P0 repositories.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-05-11-p1-release-risk-radar-product-surface-design.md`
- PRD: `docs/PRD_v1.md`
- Architecture references:
  - `docs/architecture-design/v0/entity-design.md`
  - `docs/architecture-design/v0/status_design.md`
  - `docs/architecture-design/v0/query.md`
  - `docs/architecture-design/v0/trace-evidence-plane.md`
- Completed foundation plan: `docs/superpowers/plans/2026-05-09-p1-core-schema-release-flow.md`
- Completed public evidence plan: `docs/superpowers/plans/2026-05-10-public-evidence-serialization.md`

## Scope And Guardrails

- Execute this plan in a dedicated feature worktree from current `main`.
  - Suggested branch: `feature/p1-release-risk-radar-product-surface`
  - Suggested worktree: `/Users/viv/projs/forgeloop/.worktrees/p1-release-risk-radar-product-surface`
- Do not preserve old `created_by_actor_id` create request compatibility. `CreateReleaseRequest` uses `actor_id`.
- Do not add legacy route aliases, `{ data, meta }` envelopes, local redaction helpers, or controller-only DTO shapes.
- Do not productize Incident, Change, Deployment, Contract, Monitoring, or TestEvidence. ReleaseEvidence backlinks are enough for this MVP.
- Use TDD. Every task starts by adding or changing focused tests and running them to see the expected failure.
- Commit after each task. Keep commits small and reviewable.

## File Structure

### Contracts And Domain

- Modify: `packages/contracts/src/release.ts`
  - Product-facing Release request/response schemas.
  - `PublicReleaseSummary`, `ReleaseListQuery`, `ReleaseListResponse`, `ReleaseResourceResponse`, `ReleaseCockpitResponse`.
  - Full blocker code list and Decision intent schemas.
  - Strict `CreateReleaseEvidenceRequest` with `extra.observation.links`.
- Modify: `packages/contracts/src/public-evidence.ts`
  - Extend public observation links to `artifact`, `decision`, `generated_by`, and `rollback_of`.
  - Extend public decision values and decision type expectations for Release close/change decisions.
- Modify: `packages/domain/src/types.ts`
  - Add canonical Release fields: `scope_summary`, `release_owner_actor_id`, `release_type`, `updated_by_actor_id`.
  - Add Release decision types/outcomes and blocker codes.
- Modify: `packages/domain/src/release-gates.ts`
  - Implement blocker truth table, observation backlink blocker derivation, risk summary, checklist, next actions, and completed-close evidence predicate.
- Modify: `packages/domain/src/states.ts`
  - Implement full Release lifecycle commands: patch, unlink, submit from changes requested, request changes, close cancelled from non-terminal states, completed observation override intent.
- Tests:
  - `tests/contracts/contracts.test.ts`
  - `tests/contracts/public-evidence.test.ts`
  - `tests/domain/release-gates.test.ts`
  - `tests/domain/release-states.test.ts`

### Database And Query Helpers

- Modify: `packages/db/src/schema/_shared.ts`
  - Ensure enums align with contract/domain values.
- Modify: `packages/db/src/schema/release.ts`
  - Convert `rolloutStrategy`, `rollbackPlan`, `observationPlan` from JSONB to text.
  - Keep `scopeSummary`, `releaseOwnerActorId`, `releaseType`, `updatedByActorId`.
- Modify: `packages/db/src/repositories/p0-repository.ts`
  - Add any repository methods required for Release cockpit aggregation if existing list methods are insufficient.
- Modify: `packages/db/src/repositories/in-memory-p0-repository.ts`
  - Persist normalized Release fields and link/evidence ordering.
- Modify: `packages/db/src/repositories/drizzle-p0-repository.ts`
  - Map text plan fields, `scope_summary`, actor fields, and release evidence audit anchors.
- Create: `packages/db/src/queries/release-cockpit-queries.ts`
  - Public Release cockpit aggregation.
- Modify: `packages/db/src/queries/replay-queries.ts`
  - Add supported `release` replay timeline through public serializers.
- Modify: `packages/db/src/queries/public-evidence-serialization.ts`
  - Preserve observation links after sanitizer with the expanded allowed object types/relationships.
- Modify: `packages/db/src/index.ts`
  - Export release cockpit helper and types.
- Tests:
  - `tests/db/schema.test.ts`
  - `tests/db/repository.test.ts`
  - `tests/db/public-evidence-serialization.test.ts`
  - `tests/api/query-module.test.ts`

### Control Plane API

- Create: `apps/control-plane-api/src/modules/release/release.module.ts`
  - Imports `P0Module`.
  - Registers Release controller/service.
- Create: `apps/control-plane-api/src/modules/release/release.controller.ts`
  - Owns all `/releases` routes.
- Create: `apps/control-plane-api/src/modules/release/release.service.ts`
  - Owns Release command orchestration, validation, audit writes, id generation, public projections.
- Create: `apps/control-plane-api/src/modules/release/release-serialization.ts`
  - Converts domain rows to public Release summaries/control responses.
- Modify: `apps/control-plane-api/src/app.module.ts`
  - Registers `ReleaseModule`.
- Modify: `apps/control-plane-api/src/modules/query/query.controller.ts`
  - Adds `GET /query/release-cockpit/:releaseId`.
  - Keeps generic replay route and accepts `release`.
- Modify: `apps/control-plane-api/src/modules/query/query.service.ts`
  - Calls release cockpit helper and release replay helper.
- Tests:
  - Create: `tests/api/release-module.test.ts`
  - Modify: `tests/api/query-module.test.ts`

### Web

- Modify: `apps/web/src/api/types.ts`
  - Add Release DTO and cockpit/replay types.
- Modify: `apps/web/src/api/commands.ts`
  - Add Release command/resource client methods.
- Modify: `apps/web/src/api/query.ts`
  - Add Release cockpit and Release replay methods.
- Modify: `apps/web/src/workbenchState.ts`
  - Add pure helpers for release blockers, next actions, checklist, and observation payload construction.
- Modify: `apps/web/src/App.tsx`
  - Add compact Release Owner workbench section/tab inside the existing single-page app.
- Modify: `apps/web/src/styles.css`
  - Add restrained release workbench styles consistent with the existing UI.
- Modify: `vitest.config.ts`
  - Include TSX web surface tests.
- Tests:
  - `tests/web/api.test.ts`
  - `tests/web/workbench-state.test.ts`
  - `tests/web/release-owner-surface.test.tsx`

### Dogfood And Reports

- Create: `scripts/release-flow-dogfood.ts`
  - Deterministic Release Flow smoke against in-memory API or repository fixture.
- Modify: `package.json`
  - Add `dogfood:release-flow`.
- Create: `tests/smoke/release-flow-dogfood-script.test.ts`
  - Proves the script exports/runs and writes required report markers.
- Create: `docs/superpowers/reports/p1-release-risk-radar-verification.md`
  - Written by dogfood script, then updated with final verification results.
- Potential docs update:
  - `docs/superpowers/plans/2026-05-09-p1-core-schema-release-flow.md`
  - Only if drift scan finds it still claims product surface capabilities that remain unimplemented before this plan finishes.

---

### Task 0: Prepare The Dedicated Worktree

**Files:**
- No code files.

- [ ] **Step 1: Verify current main is clean**

Run:

```bash
git status --short --branch
```

Expected: current `main` has no unstaged or staged changes before creating the worktree. If the only change is this plan file, commit only the reviewed plan first so the feature worktree contains it:

```bash
git add docs/superpowers/plans/2026-05-11-p1-release-risk-radar-product-surface.md
git commit -m "docs: plan release risk radar product surface"
git status --short --branch
```

Expected after the optional plan commit: status is clean.

- [ ] **Step 2: Create the feature worktree**

Run:

```bash
git worktree add -b feature/p1-release-risk-radar-product-surface /Users/viv/projs/forgeloop/.worktrees/p1-release-risk-radar-product-surface main
```

Expected: worktree is created at `/Users/viv/projs/forgeloop/.worktrees/p1-release-risk-radar-product-surface`.

- [ ] **Step 3: Move into the worktree and verify branch**

Run:

```bash
cd /Users/viv/projs/forgeloop/.worktrees/p1-release-risk-radar-product-surface
git status --short --branch
```

Expected: branch is `feature/p1-release-risk-radar-product-surface` and status is clean.

- [ ] **Step 4: Confirm baseline tests before implementation**

Run:

```bash
pnpm vitest run tests/contracts/contracts.test.ts tests/domain/release-gates.test.ts tests/domain/release-states.test.ts tests/db/repository.test.ts tests/api/query-module.test.ts
```

Expected: existing baseline passes before edits. If unrelated failures appear, record exact failure output and fix them before continuing because the user asked not to leave unrelated repo failures.

- [ ] **Step 5: Commit nothing**

Run:

```bash
git status --short
```

Expected: no changes. This task creates the worktree only.

---

### Task 1: Productize Release Contracts

**Files:**
- Modify: `packages/contracts/src/release.ts`
- Modify: `packages/contracts/src/public-evidence.ts`
- Modify: `packages/domain/src/release-gates.ts`
- Test: `tests/contracts/contracts.test.ts`
- Test: `tests/contracts/public-evidence.test.ts`

- [ ] **Step 1: Write failing contract tests for Release product DTOs**

In `tests/contracts/contracts.test.ts`, update the Release contract coverage so it asserts:

```ts
expect(createReleaseRequestSchema.parse({
  actor_id: 'actor-owner',
  project_id: 'project-1',
  title: 'P1 release',
  scope_summary: 'Ship release radar.',
}).release_owner_actor_id).toBe('actor-owner');

expect(createReleaseRequestSchema.safeParse({
  project_id: 'project-1',
  title: 'P1 release',
  created_by_actor_id: 'legacy-actor',
}).success).toBe(false);

expect(releaseListQuerySchema.parse({ project_id: 'project-1' })).toMatchObject({
  project_id: 'project-1',
  limit: 50,
});

expect(releaseListQuerySchema.parse({
  project_id: 'project-1',
  release_owner_actor_id: 'actor-owner',
  phase: 'approval',
  gate_state: 'awaiting_approval',
  resolution: 'none',
  limit: 100,
  cursor: 'release-cursor-1',
})).toMatchObject({
  project_id: 'project-1',
  release_owner_actor_id: 'actor-owner',
  phase: 'approval',
  gate_state: 'awaiting_approval',
  resolution: 'none',
  limit: 100,
  cursor: 'release-cursor-1',
});

expect(releaseListQuerySchema.safeParse({
  project_id: 'project-1',
  limit: 101,
}).success).toBe(false);

expect(releaseResourceQuerySchema.parse({ project_id: 'project-1' })).toEqual({ project_id: 'project-1' });

expect(releaseListResponseSchema.parse({
  releases: [publicReleaseSummaryFixture({
    work_item_ids: ['work-item-public'],
    execution_package_ids: ['package-public'],
  })],
  next_cursor: 'release-cursor-2',
}).next_cursor).toBe('release-cursor-2');
```

Also assert `publicReleaseSummarySchema` includes only public scope id arrays supplied by projection:

```ts
expect(publicReleaseSummarySchema.parse(publicReleaseSummaryFixture({
  work_item_ids: ['work-item-public'],
  execution_package_ids: ['package-public'],
}))).toMatchObject({
  work_item_ids: ['work-item-public'],
  execution_package_ids: ['package-public'],
});
```

Also assert `releaseBlockerCodes` exactly includes:

```ts
[
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
  'missing_required_evidence_backlink',
  'unsafe_or_redacted_evidence_backlink',
  'missing_rollout_strategy',
  'missing_rollback_plan',
  'missing_observation_plan',
]
```

- [ ] **Step 2: Write failing contract tests for command DTO inventory**

In `tests/contracts/contracts.test.ts`, add coverage that every public Release command schema accepts the product audit shape and rejects legacy/no-op shapes:

```ts
expect(patchReleaseRequestSchema.safeParse({ actor_id: 'actor-owner' }).success).toBe(false);
expect(patchReleaseRequestSchema.parse({ actor_id: 'actor-owner', title: 'Renamed release' }).title).toBe(
  'Renamed release',
);
expect(linkReleaseObjectRequestSchema.parse({ actor_id: 'actor-owner' }).actor_id).toBe('actor-owner');
expect(unlinkReleaseObjectRequestSchema.parse({ actor_id: 'actor-owner' }).actor_id).toBe('actor-owner');
expect(submitReleaseForApprovalRequestSchema.parse({ actor_id: 'actor-owner' }).actor_id).toBe('actor-owner');
expect(approveReleaseRequestSchema.parse({ actor_id: 'actor-reviewer' }).actor_id).toBe('actor-reviewer');
expect(overrideApproveReleaseRequestSchema.safeParse({
  actor_id: 'actor-reviewer',
  rationale: '',
  blocker_snapshot: blockerSnapshot,
}).success).toBe(false);
expect(requestReleaseChangesRequestSchema.safeParse({
  actor_id: 'actor-reviewer',
  rationale: '',
}).success).toBe(false);
expect(startReleaseObservingRequestSchema.parse({ actor_id: 'actor-owner' }).actor_id).toBe('actor-owner');
expect(closeReleaseRequestSchema.safeParse({
  actor_id: 'actor-owner',
  resolution: 'completed',
  override_without_observation: true,
}).success).toBe(false);
```

Also add command schema export checks so missing schema names fail at compile time:

```ts
expect(typeof createReleaseEvidenceRequestSchema.parse).toBe('function');
expect(typeof releaseCockpitResponseSchema.parse).toBe('function');
expect(linkReleaseObjectResponseSchema.parse({
  release_id: 'release-1',
  object_type: 'work_item',
  object_id: 'work-item-1',
  linked: true,
}).linked).toBe(true);
```

- [ ] **Step 3: Write failing public evidence contract tests**

In `tests/contracts/public-evidence.test.ts`, add:

```ts
expect(publicReleaseEvidenceSchema.parse({
  id: 'evidence-1',
  release_id: 'release-1',
  evidence_type: 'observation_note',
  summary: 'Observed rollback.',
  extra: {
    observation: {
      source: 'human',
      severity: 'warning',
      summary: 'Rollback decision linked.',
      observed_at: timestamp,
      actor_id: 'actor-observer',
      links: [
        { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
        { object_type: 'artifact', object_id: 'artifact-1', relationship: 'generated_by' },
        { object_type: 'decision', object_id: 'decision-1', relationship: 'rollback_of' },
      ],
    },
  },
  redacted: false,
  status: 'current',
  created_at: timestamp,
}).extra.observation?.links).toHaveLength(3);
expect(publicReleaseEvidenceSchema.parse({
  id: 'evidence-actor',
  release_id: 'release-1',
  evidence_type: 'observation_note',
  summary: 'Observed by actor.',
  extra: {
    observation: {
      source: 'human',
      severity: 'info',
      summary: 'Actor preserved.',
      observed_at: timestamp,
      actor_id: 'actor-observer',
      links: [{ object_type: 'release', object_id: 'release-1', relationship: 'observed' }],
    },
  },
  redacted: false,
  status: 'current',
  created_at: timestamp,
}).extra.observation?.actor_id).toBe('actor-observer');

for (const link of [
  { object_type: 'work_item', object_id: 'work-item-1', relationship: 'affected' },
  { object_type: 'execution_package', object_id: 'package-1', relationship: 'blocks' },
  { object_type: 'run_session', object_id: 'run-1', relationship: 'generated_by' },
  { object_type: 'review_packet', object_id: 'review-1', relationship: 'supports' },
] as const) {
  expect(publicReleaseEvidenceObservationLinkSchema.parse(link)).toEqual(link);
}

expect(publicReleaseEvidenceSchema.safeParse({
  id: 'evidence-2',
  release_id: 'release-1',
  evidence_type: 'observation_note',
  summary: 'Bad field',
  extra: {
    observation: {
      source: 'human',
      severity: 'info',
      summary: 'Bad',
      observed_at: timestamp,
      related_object_refs: [],
    },
  },
  redacted: false,
  status: 'current',
  created_at: timestamp,
}).success).toBe(false);
```

Add public decision coverage:

```ts
for (const [decision_type, outcome, decision] of [
  ['release_approval', 'approved', 'approved'],
  ['manual_override', 'override_approved', 'override_approved'],
  ['release_approval', 'override_approved', 'override_approved'],
  ['release_changes_requested', 'changes_requested', 'changes_requested'],
  ['release_close', 'completed', 'completed'],
  ['release_close', 'rolled_back', 'rolled_back'],
  ['release_close', 'cancelled', 'cancelled'],
] as const) {
  expect(publicDecisionSchema.parse({
    id: `decision-${decision_type}-${outcome}`,
    object_type: 'release',
    object_id: 'release-1',
    actor_id: 'actor-owner',
    decision_type,
    outcome,
    decision,
    summary: `Release ${outcome}`,
    created_at: timestamp,
  }).decision).toBe(decision);
}
```

- [ ] **Step 4: Run tests and verify they fail**

Run:

```bash
pnpm vitest run tests/contracts/contracts.test.ts tests/contracts/public-evidence.test.ts
```

Expected: FAIL because schemas still use old `created_by_actor_id`, the legacy combined empty-scope blocker code, narrow observation links, and narrow public decision values.

- [ ] **Step 5: Implement contract schemas**

Modify `packages/contracts/src/release.ts`:

- Replace `createReleaseRequestSchema` with strict product fields:
  - `actor_id`
  - optional `idempotency_key`
  - `project_id`
  - `title`
  - optional `release_owner_actor_id`, defaulting to `actor_id`
  - optional `release_type`, defaulting to `normal`
  - optional `scope_summary`
  - optional text plans
- Add `releaseListQuerySchema`, `releaseResourceQuerySchema`, `publicReleaseSummarySchema`, `releaseListResponseSchema`, `releaseResourceResponseSchema`.
- Add `linkReleaseObjectResponseSchema` for link/unlink routes with `{ release_id, object_type, object_id, linked }`.
- Replace the legacy combined empty-scope blocker with `empty_work_item_scope` and `empty_execution_package_scope`.
- Add backlink blocker codes.
- Add command request schemas named in the spec:
  - `patchReleaseRequestSchema`
  - `linkReleaseObjectRequestSchema`
  - `unlinkReleaseObjectRequestSchema`
  - `submitReleaseForApprovalRequestSchema`
  - `approveReleaseRequestSchema`
  - `overrideApproveReleaseRequestSchema`
  - `requestReleaseChangesRequestSchema`
  - `createReleaseEvidenceRequestSchema`
  - `startReleaseObservingRequestSchema`
  - `closeReleaseRequestSchema`
- Keep `PatchReleaseRequest` actor-audited and require at least one mutable field besides `actor_id` / `idempotency_key`.
- Require `CloseReleaseRequest.override_rationale` when `resolution=completed` and `override_without_observation=true`.
- Make `releaseControlResponseSchema.release` use `publicReleaseSummarySchema`.
- Do not let `publicReleaseSummarySchema` compute filtering by itself; filtering belongs to service/query projection. The schema should accept already-filtered `work_item_ids` and `execution_package_ids`.

Modify `packages/domain/src/release-gates.ts` only enough to keep the repo buildable after the contract enum change:

- replace category/override entries for the legacy combined empty-scope blocker with `empty_work_item_scope` and `empty_execution_package_scope`;
- replace the old combined empty-scope derivation with separate blockers for empty WorkItem scope and empty ExecutionPackage scope;
- add category/override entries for `missing_required_evidence_backlink` and `unsafe_or_redacted_evidence_backlink`.

Do not implement the full truth table, risk summary, checklist, next actions, or observation backlink derivation here; those belong to Task 2.

Modify `packages/contracts/src/public-evidence.ts`:

- Extend `publicDecisionSchema.decision_type` to allow `manual_override`, `release_approval`, `release_changes_requested`, and `release_close` while preserving existing non-Release values.
- Extend `publicDecisionSchema.outcome` / `decision` to allow `approved`, `changes_requested`, `rejected`, `override_approved`, `rolled_back`, `cancelled`, and `completed` while preserving existing non-Release values.
- Extend and export `publicReleaseEvidenceObservationLinkSchema` object types and relationships to match the spec.
- Ensure `publicReleaseEvidenceSchema.extra.observation.actor_id` remains public when supplied. Do not try to default it inside the contract schema because the default comes from request-level `actor_id` in `ReleaseService`.

- [ ] **Step 6: Run contract tests and verify they pass**

Run:

```bash
pnpm vitest run tests/contracts/contracts.test.ts tests/contracts/public-evidence.test.ts
pnpm --filter @forgeloop/contracts build
pnpm --filter @forgeloop/domain build
```

Expected: PASS. The domain build is required here because contract Release blocker enum changes are consumed by domain types and `release-gates.ts`.

- [ ] **Step 7: Commit contracts**

Run:

```bash
git add packages/contracts/src/release.ts packages/contracts/src/public-evidence.ts tests/contracts/contracts.test.ts tests/contracts/public-evidence.test.ts
git add packages/domain/src/release-gates.ts
git commit -m "feat: productize release contracts"
```

Expected: commit succeeds with contract files, contract tests, and the minimal domain compile alignment.

---

### Task 2: Update Release Domain Lifecycle And Gate Derivation

**Files:**
- Modify: `packages/domain/src/types.ts`
- Modify: `packages/domain/src/release-gates.ts`
- Modify: `packages/domain/src/states.ts`
- Test: `tests/domain/release-gates.test.ts`
- Test: `tests/domain/release-states.test.ts`

- [ ] **Step 1: Write failing gate truth-table tests**

In `tests/domain/release-gates.test.ts`, update expected blocker codes to the new list and add table assertions:

```ts
const table = releaseBlockerTruthTable();

expect(table.empty_work_item_scope).toMatchObject({
  category: 'structural',
  overrideable: false,
  blocks_submit: true,
  blocks_plain_approval: true,
  blocks_override_approval: true,
});

expect(table.missing_rollout_strategy).toMatchObject({
  category: 'planning',
  overrideable: true,
  blocks_submit: false,
  blocks_plain_approval: true,
  blocks_override_approval: false,
});
```

Add derivation tests:

```ts
expect(deriveCodes({ release: release({ work_item_ids: [] }), work_items: [], execution_packages: [executionPackage()] }))
  .toContain('empty_work_item_scope');

expect(deriveCodes({ release: release({ execution_package_ids: [] }), work_items: [workItem()], execution_packages: [] }))
  .toContain('empty_execution_package_scope');
```

Add evidence backlink tests:

```ts
expect(deriveCodes({
  evidence: [evidence({
    evidence_type: 'observation_note',
    extra: {
      observation: {
        source: 'human',
        severity: 'failure',
        summary: 'Issue without public release link',
        observed_at: timestamp,
        links: [{ object_type: 'work_item', object_id: 'work-item-1', relationship: 'affected' }],
      },
    },
  })],
})).toContain('missing_required_evidence_backlink');

expect(deriveCodes({
  release: release({ id: 'release-1' }),
  evidence: [evidence({
    evidence_type: 'observation_note',
    extra: {
      observation: {
        source: 'human',
        severity: 'failure',
        summary: 'Issue with unsafe public backlink',
        observed_at: timestamp,
        links: [
          { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
          { object_type: 'artifact', object_id: 'missing-artifact', relationship: 'generated_by' },
        ],
      },
    },
  })],
  public_link_visibility: [{ object_type: 'artifact', object_id: 'missing-artifact', public: false }],
})).toContain('unsafe_or_redacted_evidence_backlink');
```

- [ ] **Step 2: Write failing state transition tests**

In `tests/domain/release-states.test.ts`, add tests for:

- create stores `scope_summary`, `release_owner_actor_id`, `release_type`, `updated_by_actor_id`;
- submit from `approval/changes_requested`;
- request changes target state;
- close cancelled from draft/candidate/approval/rollout/observing;
- close completed with observation override emits `manual_override` and `release_close` intents;
- stale override snapshot still throws.
- close cancelled from `approval/awaiting_approval`, `approval/changes_requested`, `rollout/approved`, and `observing/rollout_succeeded` preserves the current `gate_state`;
- close cancelled from `draft` or `candidate` leaves `gate_state=not_submitted`;

Use assertions like:

```ts
expect(transitionRelease(release, {
  type: 'request_changes',
  actor_id: 'actor-reviewer',
  rationale: 'Need rollout notes.',
  at: timestamp,
}).release).toMatchObject({
  phase: 'approval',
  activity_state: 'awaiting_human',
  gate_state: 'changes_requested',
  resolution: 'none',
});
```

- [ ] **Step 3: Run domain tests and verify they fail**

Run:

```bash
pnpm vitest run tests/domain/release-gates.test.ts tests/domain/release-states.test.ts
```

Expected: FAIL on missing truth table export, missing lifecycle events, missing exact cancelled gate preservation, and missing backlink blocker derivation.

- [ ] **Step 4: Implement domain types and blocker table**

Modify `packages/domain/src/types.ts`:

- Add `scope_summary?: string` to `Release`.
- Ensure `release_owner_actor_id`, `release_type`, and `updated_by_actor_id` are canonical.
- Extend `ReleaseDecisionIntent.decision_type` to include `release_changes_requested` and `release_close`.
- Extend `ReleaseDecisionIntent.outcome` to include `changes_requested`, `completed`, `rolled_back`, `cancelled`.
- Extend persisted `Decision.decision` to include `completed`, `rolled_back`, and `cancelled`, so Release close decisions written by `ReleaseService` type-check later.

Modify `packages/domain/src/release-gates.ts`:

- Replace the legacy combined empty-scope blocker with separate empty scope blockers.
- Add `releaseBlockerTruthTable()`.
- Add helper `deriveReleaseRiskSummary()`.
- Add helper `deriveReleaseChecklist()`.
- Add helper `deriveReleaseNextActions()`.
- Add helper `isCompletedCloseObservationEvidence()`.
- Add observation backlink validation using `extra.observation.links`.
- Add a `ReleaseGateContext.public_link_visibility` or equivalent input that lets DB/query code tell domain derivation whether supplied backlinks are publicly projectable.
- Add explicit handling for syntactically valid but non-public/missing/redacted backlinks: keep the evidence fact, omit unsafe public links in query projection later, and derive `unsafe_or_redacted_evidence_backlink`.

- [ ] **Step 5: Implement Release state transitions**

Modify `packages/domain/src/states.ts`:

- Add transition event types for patch, unlink, request changes, close override.
- Preserve `submit` from candidate and approval changes-requested.
- Ensure `override_approve` requires a non-empty rationale and a blocker snapshot, rejects any non-overrideable blocker, and only represents approval through persisted override/approval decisions; when no blockers exist, the public service path should use plain `approve`.
- Set `updated_by_actor_id` on mutating transitions when actor is supplied.
- Emit correct decision intent triples.

- [ ] **Step 6: Run domain tests and verify they pass**

Run:

```bash
pnpm vitest run tests/domain/release-gates.test.ts tests/domain/release-states.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit domain work**

Run:

```bash
git add packages/domain/src/types.ts packages/domain/src/release-gates.ts packages/domain/src/states.ts tests/domain/release-gates.test.ts tests/domain/release-states.test.ts
git commit -m "feat: implement release gate truth table"
```

Expected: commit succeeds with domain files only.

---

### Task 3: Align Release Schema And Repository Mappings

**Files:**
- Modify: `packages/db/src/schema/release.ts`
- Modify: `packages/db/src/repositories/p0-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-p0-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-p0-repository.ts`
- Test: `tests/db/schema.test.ts`
- Test: `tests/db/repository.test.ts`

- [ ] **Step 1: Write failing schema tests**

In `tests/db/schema.test.ts`, update Release column assertions:

```ts
expect(columnType(releases, 'scope_summary')).toBe('PgText');
expect(columnType(releases, 'rollout_strategy')).toBe('PgText');
expect(columnType(releases, 'rollback_plan')).toBe('PgText');
expect(columnType(releases, 'observation_plan')).toBe('PgText');
expect(columnNotNull(releases, 'updated_by_actor_id')).toBe(true);
```

Keep existing no-productization assertions:

```ts
expect(dbSchema).not.toHaveProperty('test_evidences');
expect(dbSchema).not.toHaveProperty('incidents');
expect(dbSchema).not.toHaveProperty('contracts');
```

- [ ] **Step 2: Write failing repository contract tests**

In `tests/db/repository.test.ts`, extend the repository contract to save and reload a Release with:

```ts
scope_summary: 'Two work items, one package.',
rollout_strategy: 'Ship behind flag.',
rollback_plan: 'Disable flag.',
observation_plan: 'Watch latency.',
release_owner_actor_id: 'actor-owner',
release_type: 'gray',
updated_by_actor_id: 'actor-owner',
```

Assert `listReleasesForProject('project-1')` returns that Release and not a Release from another project.

- [ ] **Step 3: Run DB tests and verify they fail**

Run:

```bash
pnpm vitest run tests/db/schema.test.ts tests/db/repository.test.ts
```

Expected: FAIL because plan fields are still JSONB in Drizzle schema or because mappings omit new canonical fields.

- [ ] **Step 4: Implement schema and mappings**

Modify `packages/db/src/schema/release.ts`:

- Change:
  - `rolloutStrategy: text('rollout_strategy')`
  - `rollbackPlan: text('rollback_plan')`
  - `observationPlan: text('observation_plan')`
- Keep `scopeSummary`, `releaseOwnerActorId`, `releaseType`, `updatedByActorId`.

Modify repositories:

- In in-memory repository, preserve all canonical Release fields in `saveRelease()`.
- In Drizzle repository, ensure `fromDbRecord` maps text fields back to strings.
- Keep `saveReleaseEvidence()` audit anchor normalization.
- Remove or stop relying on deprecated `listReleaseEvidence()` in new code.

- [ ] **Step 5: Run DB tests and verify they pass**

Run:

```bash
pnpm vitest run tests/db/schema.test.ts tests/db/repository.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit DB alignment**

Run:

```bash
git add packages/db/src/schema/release.ts packages/db/src/repositories/p0-repository.ts packages/db/src/repositories/in-memory-p0-repository.ts packages/db/src/repositories/drizzle-p0-repository.ts tests/db/schema.test.ts tests/db/repository.test.ts
git commit -m "feat: align release repository schema"
```

Expected: commit succeeds.

---

### Task 4: Extend Public Release Evidence Serialization

**Files:**
- Modify: `packages/db/src/queries/public-evidence-serialization.ts`
- Test: `tests/db/public-evidence-serialization.test.ts`
- Test: `tests/contracts/public-evidence.test.ts`

- [ ] **Step 1: Write failing serializer tests**

In `tests/db/public-evidence-serialization.test.ts`, add tests:

```ts
const serialized = serializePublicReleaseEvidence({
  evidence: releaseEvidence({
    evidence_type: 'metric_snapshot',
    extra: {
      observation: {
        source: 'script',
        severity: 'warning',
        summary: 'Latency up.',
        observed_at: timestamp,
        links: [
          { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
          { object_type: 'artifact', object_id: 'artifact-1', relationship: 'generated_by' },
          { object_type: 'decision', object_id: 'decision-1', relationship: 'rollback_of' },
        ],
      },
    },
  }),
});

expect(serialized?.extra.observation?.links).toEqual([
  { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
  { object_type: 'artifact', object_id: 'artifact-1', relationship: 'generated_by' },
  { object_type: 'decision', object_id: 'decision-1', relationship: 'rollback_of' },
]);
```

Add a negative test that `related_object_refs` is dropped/rejected through public schema.

- [ ] **Step 2: Run serializer tests and verify they fail**

Run:

```bash
pnpm vitest run tests/contracts/public-evidence.test.ts tests/db/public-evidence-serialization.test.ts
```

Expected: FAIL until serializer and schemas accept expanded links and reject the legacy field.

- [ ] **Step 3: Implement serializer updates**

Modify `packages/db/src/queries/public-evidence-serialization.ts`:

- Update safe observation link serialization to use `publicReleaseEvidenceExtraSchema`.
- Preserve only `extra.observation.links`.
- Do not introduce `related_object_refs`.
- Keep local path and unsafe key filtering.

- [ ] **Step 4: Run serializer tests and verify they pass**

Run:

```bash
pnpm vitest run tests/contracts/public-evidence.test.ts tests/db/public-evidence-serialization.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit serializer work**

Run:

```bash
git add packages/db/src/queries/public-evidence-serialization.ts tests/db/public-evidence-serialization.test.ts tests/contracts/public-evidence.test.ts
git commit -m "feat: serialize release observation backlinks"
```

Expected: commit succeeds.

---

### Task 5: Add Release Cockpit Query Helper

**Files:**
- Create: `packages/db/src/queries/release-cockpit-queries.ts`
- Modify: `packages/db/src/index.ts`
- Test: Create `tests/db/release-cockpit-queries.test.ts`

- [ ] **Step 1: Write failing release cockpit tests**

Create `tests/db/release-cockpit-queries.test.ts` with an in-memory repository fixture. Seed:

- one Project;
- one completed WorkItem;
- one release-ready ExecutionPackage;
- one succeeded RunSession;
- one approved ReviewPacket;
- one Release with text rollout/rollback/observation plans;
- one current observation ReleaseEvidence with public links.

Assert:

```ts
const cockpit = await getReleaseCockpit(repo, 'release-1');

expect(cockpit?.release).toMatchObject({
  id: 'release-1',
  project_id: 'project-1',
  scope_summary: 'Ship Release Radar',
});
expect(cockpit?.work_items).toHaveLength(1);
expect(cockpit?.execution_packages).toHaveLength(1);
expect(cockpit?.latest_run_sessions).toHaveLength(1);
expect(cockpit?.current_review_packets).toHaveLength(1);
expect(cockpit?.evidences).toHaveLength(1);
expect(cockpit?.observations).toHaveLength(1);
expect(cockpit?.decisions).toEqual(expect.any(Array));
expect(cockpit?.overridden_blockers).toEqual([]);
expect(cockpit?.blockers).toEqual([]);
expect(cockpit?.risk_summary.release_can_proceed_without_override).toBe(true);
expect(cockpit?.next_actions).toContain('start_observing');
const serialized = JSON.stringify(cockpit);
expect(serialized).not.toContain('allowed_paths');
expect(serialized).not.toContain('forbidden_paths');
expect(serialized).not.toContain('raw_payload');
expect(serialized).not.toContain('raw_metadata');
expect(serialized).not.toContain('runtime_metadata');
expect(serialized).not.toContain('review_payload');
expect(serialized).not.toContain('raw_extra');
expect(serialized).not.toContain('client_secret');
expect(serialized).not.toContain('/Users/');
expect(cockpit?.evidences?.[0]?.extra?.observation?.links).toEqual(
  expect.arrayContaining([{ object_type: 'release', object_id: 'release-1', relationship: 'observed' }]),
);
```

Add a second test where plans/evidence are missing and assert planning/evidence blockers and `release_can_proceed_with_override`.

Add a third test for unsafe observation backlinks:

- save syntactically valid observation evidence whose `links` include the current Release and a missing/redacted/local-only artifact or decision ref;
- assert `getReleaseCockpit()` still returns the evidence fact;
- assert public `extra.observation.links` omits the unsafe link;
- assert `blockers` contains `unsafe_or_redacted_evidence_backlink`.

Add a fourth test for stale stored scope links:

- save a Release whose stored `work_item_ids` and `execution_package_ids` include one valid same-project object plus one archived/deleted/cross-project/missing object;
- assert `cockpit.release.work_item_ids` and `cockpit.release.execution_package_ids` include only the valid public ids;
- assert `cockpit.work_items` and `cockpit.execution_packages` include only the same valid objects;
- assert blockers include the appropriate `missing_work_item` or `missing_execution_package` entries for invalid stored links, and `empty_work_item_scope` / `empty_execution_package_scope` when no valid ids remain.

- [ ] **Step 2: Run cockpit query tests and verify they fail**

Run:

```bash
pnpm vitest run tests/db/release-cockpit-queries.test.ts
```

Expected: FAIL because `getReleaseCockpit` does not exist.

- [ ] **Step 3: Implement `getReleaseCockpit()`**

Create `packages/db/src/queries/release-cockpit-queries.ts`:

- Load Release by id; return `undefined` if missing.
- Load linked WorkItems and ExecutionPackages through release link ids.
- Load latest RunSessions and current ReviewPackets using existing repository methods.
- Load ReleaseEvidence and Decisions.
- Derive blockers, checklist, risk summary, and next actions from domain helpers.
- Include all required top-level response families: `release`, `work_items`, `execution_packages`, `latest_run_sessions`, `current_review_packets`, `evidences`, `observations`, `decisions`, `blockers`, `overridden_blockers`, `risk_summary`, `checklist`, and `next_actions`.
- Project every row into public summaries.
- Project `PublicReleaseSummary.work_item_ids` and `execution_package_ids` from the same resolved public scope used by cockpit summaries, not directly from the raw stored Release arrays.
- Serialize ReleaseEvidence through `serializePublicReleaseEvidence()`.
- Keep accepted ReleaseEvidence facts in public arrays after shared serialization; omit only unsafe/redacted backlink items and unsafe payload fields from the serialized evidence. Preserve blockers that explain omitted evidence details.
- Build `public_link_visibility` or equivalent domain context so syntactically valid but non-public backlinks are accepted as evidence facts, omitted from public projection, and surfaced as `unsafe_or_redacted_evidence_backlink`.

Modify `packages/db/src/index.ts` to export the helper.

- [ ] **Step 4: Run cockpit query tests and verify they pass**

Run:

```bash
pnpm vitest run tests/db/release-cockpit-queries.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit cockpit helper**

Run:

```bash
git add packages/db/src/queries/release-cockpit-queries.ts packages/db/src/index.ts tests/db/release-cockpit-queries.test.ts
git commit -m "feat: add release cockpit query"
```

Expected: commit succeeds.

---

### Task 6: Extend Replay Queries To Release

**Files:**
- Modify: `packages/db/src/queries/replay-queries.ts`
- Test: Create `tests/db/release-replay-queries.test.ts`

- [ ] **Step 1: Write failing release replay query tests**

Create `tests/db/release-replay-queries.test.ts`:

- Seed a Release with ObjectEvents, StatusHistory, Decisions, ReleaseEvidence, safe Artifact, linked WorkItem, linked ExecutionPackage, RunSession, and ReviewPacket.
- Call `getObjectReplayTimeline(repo, 'release', 'release-1')`.
- Assert entries include `object_event`, `status_history`, `decision`, `release_evidence`, and linked object highlights.
- Assert unsafe artifact/local/raw fields are absent: `allowed_paths`, `forbidden_paths`, `raw_payload`, `raw_metadata`, `runtime_metadata`, `review_payload`, `evidence_refs.raw_ref`, `raw_extra`, `token=`, `/Users/`, and secret-like keys. Public `extra.observation.links` remains allowed.
- Assert syntactically valid but unsafe observation backlinks are omitted from the public ReleaseEvidence replay entry while the timeline still includes a blocker/explanation entry containing `unsafe_or_redacted_evidence_backlink`.
- Assert missing release returns `undefined`.

- [ ] **Step 2: Keep API query tests unchanged in this task**

Do not modify `tests/api/query-module.test.ts` yet. QueryModule routing and supported object-type behavior are wired in Task 8 after the Release command module and cockpit helper exist.

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
pnpm vitest run tests/db/release-replay-queries.test.ts
```

Expected: FAIL because replay only supports `work_item`.

- [ ] **Step 4: Implement release replay support**

Modify `packages/db/src/queries/replay-queries.ts`:

- Keep unsupported object behavior by returning `undefined` to service for unsupported types, or add a supported-type guard in service.
- For `release`, gather:
  - release object events/status history/decisions/artifacts;
  - release evidence entries;
  - linked WorkItem object events/status/decisions highlights;
  - linked ExecutionPackage object events/status/decisions highlights;
  - selected RunSession and ReviewPacket highlights.
- Serialize every entry through `serializePublicReplayEntry()`.
- Sort chronologically by `created_at`.

- [ ] **Step 5: Run tests and verify they pass**

Run:

```bash
pnpm vitest run tests/db/release-replay-queries.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit replay support**

Run:

```bash
git add packages/db/src/queries/replay-queries.ts tests/db/release-replay-queries.test.ts
git commit -m "feat: add release replay query"
```

Expected: commit succeeds.

---

### Task 7: Add ReleaseModule Command API

**Files:**
- Create: `apps/control-plane-api/src/modules/release/release.module.ts`
- Create: `apps/control-plane-api/src/modules/release/release.controller.ts`
- Create: `apps/control-plane-api/src/modules/release/release.service.ts`
- Create: `apps/control-plane-api/src/modules/release/release-serialization.ts`
- Modify: `apps/control-plane-api/src/app.module.ts`
- Test: Create `tests/api/release-module.test.ts`

- [ ] **Step 1: Write failing API tests for resource reads and create**

Create `tests/api/release-module.test.ts` with a Nest test app using `InMemoryP0Repository`. Seed `project-1` before every create/list/get test. Add tests:

```ts
await request(server).post('/releases').send({
  actor_id: 'actor-owner',
  project_id: 'project-1',
  title: 'Release Radar',
}).expect(201);

await request(server).get('/releases').query({ project_id: 'project-1' }).expect(200);
await request(server).get(`/releases/${releaseId}`).query({ project_id: 'other-project' }).expect(404);
```

Assert create without plans succeeds and response has planning blockers.

Add list/read filter coverage after seeding at least two matching Releases for `project-1`:

```ts
const firstPage = await request(server)
  .get('/releases')
  .query({
    project_id: 'project-1',
    release_owner_actor_id: 'actor-owner',
    phase: 'approval',
    gate_state: 'awaiting_approval',
    resolution: 'none',
    limit: '1',
  })
  .expect(200)
  .expect(({ body }) => {
    expect(body.releases).toEqual(expect.any(Array));
    expect(body).toEqual(expect.objectContaining({ next_cursor: expect.any(String) }));
  });

await request(server)
  .get('/releases')
  .query({ project_id: 'project-1', limit: '1', cursor: firstPage.body.next_cursor })
  .expect(200);

await request(server).get('/releases').query({ project_id: 'project-1', limit: '101' }).expect(400);
```

Also assert `GET /releases/:releaseId?project_id=project-1` returns only `PublicReleaseSummary` fields and does not include cockpit-only arrays such as `evidences`, `decisions`, `checklist`, or raw `extra`.

Add stale stored scope projection coverage:

- seed a Release with raw stored `work_item_ids` / `execution_package_ids` containing valid same-project ids plus archived/deleted/cross-project/missing ids;
- assert `GET /releases/:releaseId?project_id=project-1` returns `release.work_item_ids` and `release.execution_package_ids` with only the valid same-project public ids;
- assert invalid stored ids do not appear in `GET /releases` list items either.

- [ ] **Step 2: Write failing API tests for patch**

In `tests/api/release-module.test.ts`, add `PATCH /releases/:releaseId` coverage:

```ts
await request(server)
  .patch(`/releases/${releaseId}`)
  .send({
    actor_id: 'actor-owner',
    title: 'Release Radar v2',
    scope_summary: 'Updated scope.',
    rollout_strategy: 'Ship behind a feature flag.',
    rollback_plan: 'Disable the feature flag.',
    observation_plan: 'Watch latency for 30 minutes.',
  })
  .expect(200)
  .expect(({ body }) => {
    expect(body.release).toMatchObject({
      id: releaseId,
      title: 'Release Radar v2',
      scope_summary: 'Updated scope.',
      rollout_strategy: 'Ship behind a feature flag.',
      rollback_plan: 'Disable the feature flag.',
      observation_plan: 'Watch latency for 30 minutes.',
      updated_by_actor_id: 'actor-owner',
    });
  });

await request(server).patch(`/releases/${releaseId}`).send({ actor_id: 'actor-owner' }).expect(400);
await request(server).patch('/releases/missing-release').send({
  actor_id: 'actor-owner',
  title: 'No such release',
}).expect(404);
```

Also assert patch writes an ObjectEvent and StatusHistory entries for changed lifecycle/audit fields when the repository exposes those reads in test fixtures.

- [ ] **Step 3: Write failing API tests for link/submit/approval**

In the same file, seed a completed WorkItem and release-ready ExecutionPackage. Add tests:

- link/unlink WorkItem;
- link/unlink ExecutionPackage;
- link/unlink responses return exactly `{ release_id, object_type, object_id, linked }`, with `linked=true` for link routes and `linked=false` for unlink routes;
- link rejects missing, archived, deleted, and cross-project WorkItems/ExecutionPackages with the expected `404` or `422` status. Add invisible/unauthorized coverage only if the repository exposes an explicit visibility/authorization state by the time this task is implemented; do not invent a new visibility field in this plan.
- submit succeeds with only overrideable blockers;
- plain approval succeeds after all blockers are cleared;
- plain approval rejects blockers with `422`;
- override approval succeeds with matching snapshot;
- stale override snapshot returns `409`;
- request changes sets `gate_state=changes_requested`;
- re-submit from changes requested succeeds.

- [ ] **Step 4: Write failing API tests for evidence/start/close**

Add tests:

- `POST /releases/:releaseId/evidences` accepts `extra.observation.links`;
- `POST /releases/:releaseId/evidences` with `extra.observation` but without `extra.observation.actor_id` persists public `extra.observation.actor_id` equal to the request `actor_id`;
- `related_object_refs` returns `400`;
- syntactically valid missing/redacted/local-only backlink refs are accepted with `201`, are persisted as evidence facts, and the returned control response includes `unsafe_or_redacted_evidence_backlink` in blockers. Public cockpit/replay projection assertions for omitting unsafe links are covered in Task 8 after QueryModule wiring exists.
- evidence type-specific minimum validation:
  - `review_packet` without `object_ref.object_type=review_packet` returns `400`;
  - `test_report` without an artifact/check ref returns `400`;
  - `build` without build identity/status or a safe artifact returns `400`;
  - `deployment` without target environment and rollout/deploy status returns `400`;
  - `metric_snapshot` without `extra.observation.metrics` returns `400`;
  - `rollback_record` without rollback metadata returns `400`;
  - `observation_note` without source, severity, observed_at, or summary returns `400`;
  - one valid minimal request for each evidence type returns `201`;
- `start-observing` before approval returns `409`;
- close completed without observation returns `422`;
- close completed with observation succeeds;
- close completed with `override_without_observation=true` writes manual override and close decisions;
- close rolled_back and close cancelled succeed from allowed states.

- [ ] **Step 5: Run release API tests and verify they fail**

Run:

```bash
pnpm vitest run tests/api/release-module.test.ts
```

Expected: FAIL because `ReleaseModule` does not exist.

- [ ] **Step 6: Implement Release module wiring**

Create:

```ts
// apps/control-plane-api/src/modules/release/release.module.ts
import { Module } from '@nestjs/common';
import { P0Module } from '../../p0/p0.module';
import { ReleaseController } from './release.controller';
import { ReleaseService } from './release.service';

@Module({
  imports: [P0Module],
  controllers: [ReleaseController],
  providers: [ReleaseService],
})
export class ReleaseModule {}
```

Modify `apps/control-plane-api/src/app.module.ts` to import `ReleaseModule`.

- [ ] **Step 7: Implement controller and service**

Implement controller routes with `ZodValidationPipe` and schemas from `@forgeloop/contracts`.

In `release.service.ts`:

- Generate deterministic ids using a local counter like `P0Service`.
- Implement `PATCH /releases/:releaseId` with mutable fields only: `title`, `scope_summary`, `rollout_strategy`, `rollback_plan`, `observation_plan`.
- Validate project/resource existence, including seeding/lookup assumptions used by API tests.
- Implement `GET /releases` filters for `project_id`, `release_owner_actor_id`, `phase`, `gate_state`, `resolution`, `limit`, and `cursor`, and return `next_cursor` when more rows remain.
- Implement `GET /releases/:releaseId` as a project-scoped read that verifies `release.project_id === project_id` and returns `404` on mismatch.
- Project `PublicReleaseSummary.work_item_ids` and `execution_package_ids` by resolving stored links and keeping only same-project, non-archived, non-deleted, visible objects. Use the same filtering helper/path as `getReleaseCockpit()` to avoid list/get and cockpit drift.
- Reject archived/deleted/cross-project links. Also reject invisible/unauthorized links when the repository can represent that state; do not introduce a new visibility model in this task.
- Enforce ReleaseEvidence type-specific minimum structure before persistence:
  - `review_packet` requires `object_ref.object_type=review_packet`;
  - `test_report` requires `artifact_id`, a safe artifact ref, or `extra.check_refs`;
  - `build` requires build identity/status in `extra.build` or a safe artifact ref;
  - `deployment` requires target environment and rollout/deploy status in `extra.deployment`;
  - `metric_snapshot` requires `extra.observation.metrics`;
  - `rollback_record` requires rollback metadata in `extra.rollback`;
  - `observation_note` requires `extra.observation.source`, `severity`, `observed_at`, and `summary`.
- Reject malformed observation links and unknown legacy fields such as `related_object_refs` via the strict contract schema.
- When `CreateReleaseEvidenceRequest.extra.observation` exists and omits `actor_id`, set `extra.observation.actor_id` to the request-level `actor_id` before persistence and public projection.
- Persist Release with audit fields.
- Persist ObjectEvents for accepted mutating commands.
- Persist StatusHistory for lifecycle field changes.
- Persist Decisions for approval, override, request changes, close.
- Persist ReleaseEvidence with `created_by_actor_id`.
- Return `ReleaseControlResponse` with `PublicReleaseSummary` for create, patch, submit, approve, override approve, request changes, evidence, start observing, and close.
- Return the spec-defined link response `{ release_id, object_type, object_id, linked }` for link/unlink routes; do not wrap link responses in `ReleaseControlResponse`.

- [ ] **Step 8: Run release API tests and verify they pass**

Run:

```bash
pnpm vitest run tests/api/release-module.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit ReleaseModule**

Run:

```bash
git add apps/control-plane-api/src/modules/release apps/control-plane-api/src/app.module.ts tests/api/release-module.test.ts
git commit -m "feat: add release command module"
```

Expected: commit succeeds.

---

### Task 8: Wire Release Cockpit And Replay Into QueryModule

**Files:**
- Modify: `apps/control-plane-api/src/modules/query/query.controller.ts`
- Modify: `apps/control-plane-api/src/modules/query/query.service.ts`
- Test: `tests/api/query-module.test.ts`

- [ ] **Step 1: Write failing QueryModule API tests**

In `tests/api/query-module.test.ts`, add:

```ts
const cockpitResponse = await request(server)
  .get(`/query/release-cockpit/${release.id}`)
  .expect(200);

expect(cockpitResponse.body.release.id).toBe(release.id);
expect(cockpitResponse.body.latest_run_sessions).toEqual(expect.any(Array));
expect(cockpitResponse.body.current_review_packets).toEqual(expect.any(Array));
expect(cockpitResponse.body.evidences).toEqual(expect.any(Array));
expect(cockpitResponse.body.observations).toEqual(expect.any(Array));
expect(cockpitResponse.body.decisions).toEqual(expect.any(Array));
expect(cockpitResponse.body.overridden_blockers).toEqual(expect.any(Array));
expect(cockpitResponse.body.checklist).toEqual(expect.any(Array));
expect(cockpitResponse.body.risk_summary).toEqual(expect.any(Object));
const cockpitJson = JSON.stringify(cockpitResponse.body);
expect(cockpitJson).not.toContain('allowed_paths');
expect(cockpitJson).not.toContain('forbidden_paths');
expect(cockpitJson).not.toContain('raw_payload');
expect(cockpitJson).not.toContain('raw_metadata');
expect(cockpitJson).not.toContain('runtime_metadata');
expect(cockpitJson).not.toContain('review_payload');
expect(cockpitJson).not.toContain('raw_extra');
expect(cockpitJson).not.toContain('client_secret');

const replayResponse = await request(server)
  .get(`/query/replay/release/${release.id}`)
  .expect(200);
const replayJson = JSON.stringify(replayResponse.body);
expect(replayJson).not.toContain('allowed_paths');
expect(replayJson).not.toContain('forbidden_paths');
expect(replayJson).not.toContain('raw_payload');
expect(replayJson).not.toContain('raw_metadata');
expect(replayJson).not.toContain('runtime_metadata');
expect(replayJson).not.toContain('review_payload');
expect(replayJson).not.toContain('raw_extra');
expect(replayJson).not.toContain('client_secret');

expect(replayResponse.body).toEqual(expect.arrayContaining([
  expect.objectContaining({ object_type: 'release', object_id: release.id }),
]));
```

Add an API-level unsafe backlink case seeded through `POST /releases/:releaseId/evidences`: the evidence create call returns `201`, cockpit/replay omit the unsafe backlink from public links, and cockpit blockers include `unsafe_or_redacted_evidence_backlink`.

Also change any existing test that treats `GET /query/replay/release/:id` as unsupported. After this task, `release` is a supported replay object type, so unsupported coverage must use a truly unsupported type such as `unsupported`:

```ts
await request(server).get('/query/replay/release/missing-release').expect(404);
await request(server).get('/query/replay/unsupported/missing').expect(400);
```

- [ ] **Step 2: Run QueryModule tests and verify they fail**

Run:

```bash
pnpm vitest run tests/api/query-module.test.ts
```

Expected: FAIL until controller/service add release cockpit and allow release replay.

- [ ] **Step 3: Implement QueryModule release reads**

Modify `query.controller.ts`:

- Add `@Get('release-cockpit/:releaseId')`.
- Keep `@Get('replay/:objectType/:objectId')`.

Modify `query.service.ts`:

- Add `getReleaseCockpit(releaseId)`.
- Permit replay object types `work_item` and `release`.
- Keep unsupported types as `400`; missing supported objects as `404`.

- [ ] **Step 4: Run QueryModule tests and verify they pass**

Run:

```bash
pnpm vitest run tests/api/query-module.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit QueryModule wiring**

Run:

```bash
git add apps/control-plane-api/src/modules/query/query.controller.ts apps/control-plane-api/src/modules/query/query.service.ts tests/api/query-module.test.ts
git commit -m "feat: expose release query surface"
```

Expected: commit succeeds.

---

### Task 9: Add Web Release Client And State Helpers

**Files:**
- Modify: `apps/web/src/api/types.ts`
- Modify: `apps/web/src/api/commands.ts`
- Modify: `apps/web/src/api/query.ts`
- Modify: `apps/web/src/workbenchState.ts`
- Test: `tests/web/api.test.ts`
- Test: `tests/web/workbench-state.test.ts`

- [ ] **Step 1: Write failing web API client tests**

In `tests/web/api.test.ts`, add:

```ts
await api.createRelease({
  actor_id: 'actor-owner',
  project_id: 'project-1',
  title: 'Release Radar',
});

await api.getRelease('release/1', 'project with spaces');
await api.submitReleaseForApproval('release/1', { actor_id: 'actor-owner' });
await api.overrideApproveRelease('release/1', {
  actor_id: 'actor-owner',
  rationale: 'Accept planning blocker.',
  blocker_snapshot: snapshot,
});
```

Assert encoded URLs:

- `/releases`
- `/releases/release%2F1?project_id=project+with+spaces`
- `/releases/release%2F1/submit-for-approval`
- `/releases/release%2F1/override-approve`

Add Query API tests for:

- `/query/release-cockpit/release%2F1`
- `/query/replay/release/release%2F1`

- [ ] **Step 2: Write failing state helper tests**

In `tests/web/workbench-state.test.ts`, add tests for:

- grouping blockers by category;
- rendering next action labels from backend strings;
- building observation evidence payload with `extra.observation.links`;
- never building Incident or Change payloads.

- [ ] **Step 3: Run web tests and verify they fail**

Run:

```bash
pnpm vitest run tests/web/api.test.ts tests/web/workbench-state.test.ts
```

Expected: FAIL because Release client/state helpers do not exist.

- [ ] **Step 4: Implement web API types and clients**

Modify `apps/web/src/api/types.ts`:

- Add `ReleaseSummary`, `ReleaseControlResponse`, `ReleaseCockpitResponse`, `ReleaseEvidence`, `ReleaseBlocker`, `ReleaseChecklistItem`.
- Add command body types for every Release command.

Modify `apps/web/src/api/commands.ts`:

- Add create/list/get/patch Release methods.
- Add link/unlink scope methods.
- Add submit/approve/override/request-changes/start-observing/close.
- Add create ReleaseEvidence.

Modify `apps/web/src/api/query.ts`:

- Add `getReleaseCockpit(releaseId)`.
- Add `getReleaseReplay(releaseId)`.

- [ ] **Step 5: Implement web state helpers**

Modify `apps/web/src/workbenchState.ts`:

- Add `groupReleaseBlockers(blockers)`.
- Add `releaseNextActionLabel(action)`.
- Add `buildObservationEvidencePayload(input)`.
- Keep helpers pure and covered by tests.

- [ ] **Step 6: Run web tests and verify they pass**

Run:

```bash
pnpm vitest run tests/web/api.test.ts tests/web/workbench-state.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit web client/helpers**

Run:

```bash
git add apps/web/src/api/types.ts apps/web/src/api/commands.ts apps/web/src/api/query.ts apps/web/src/workbenchState.ts tests/web/api.test.ts tests/web/workbench-state.test.ts
git commit -m "feat: add release web clients"
```

Expected: commit succeeds.

---

### Task 10: Add Compact Release Owner Web Surface

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `vitest.config.ts`
- Test: `tests/web/workbench-state.test.ts`
- Test: Create `tests/web/release-owner-surface.test.tsx`

- [ ] **Step 1: Add a failing behavior-level test for payload construction if needed**

If Task 9 did not already cover all UI payload helpers, add missing helper tests in `tests/web/workbench-state.test.ts` before touching `App.tsx`.

Modify `vitest.config.ts` so TSX tests are included:

```ts
include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
```

Create `tests/web/release-owner-surface.test.tsx` using `react-dom/server`:

```tsx
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from '../../apps/web/src/App';

describe('Release Owner surface', () => {
  it('renders the release owner controls required by the product surface', () => {
    const html = renderToString(<App />);

    for (const label of [
      'Release Owner',
      'Release ID',
      'Load cockpit',
      'Load replay',
      'Create release',
      'Patch release',
      'Link WorkItem',
      'Unlink WorkItem',
      'Link ExecutionPackage',
      'Unlink ExecutionPackage',
      'Submit',
      'Approve',
      'Override approve',
      'Request changes',
      'Start observing',
      'Close release',
      'Record observation',
      'Blockers',
      'Checklist',
      'Risk summary',
      'Evidence',
      'Decisions',
      'Next actions',
    ]) {
      expect(html).toContain(label);
    }
  });
});
```

Run:

```bash
pnpm vitest run tests/web/workbench-state.test.ts tests/web/release-owner-surface.test.tsx
```

Expected: FAIL because the Release Owner UI and/or TSX test include support does not exist yet.

- [ ] **Step 2: Implement the Release Owner section in `App.tsx`**

Add a compact section/tab inside the existing single-page app with:

- Release ID input;
- project id input;
- create/patch form with title, scope summary, rollout, rollback, observation plans;
- load cockpit and replay buttons;
- state summary;
- linked WorkItems/ExecutionPackages;
- link and unlink controls for WorkItems and ExecutionPackages;
- blockers grouped by category;
- checklist;
- risk summary;
- evidence/observations;
- decisions;
- next actions;
- command buttons for submit/approve/override/request changes/start observing/close;
- observation evidence form that submits `extra.observation.links`.

Do not duplicate gate derivation in React. Render values from backend responses.

Wire the UI controls to the Release client methods added in Task 9. The UI does not need a full browser e2e suite in this task, but the server-render smoke test must prove the required controls are present and buildable.

- [ ] **Step 3: Implement restrained styles**

Modify `apps/web/src/styles.css`:

- Keep dense operational layout.
- No landing page, hero, cards inside cards, decorative gradients, or marketing copy.
- Ensure controls have stable dimensions and labels fit on mobile/desktop.

- [ ] **Step 4: Run web build**

Run:

```bash
pnpm --filter @forgeloop/web build
```

Expected: PASS.

- [ ] **Step 5: Run web tests**

Run:

```bash
pnpm vitest run tests/web/api.test.ts tests/web/workbench-state.test.ts tests/web/release-owner-surface.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit web surface**

Run:

```bash
git add apps/web/src/App.tsx apps/web/src/styles.css vitest.config.ts tests/web/workbench-state.test.ts tests/web/release-owner-surface.test.tsx
git commit -m "feat: add release owner workbench"
```

Expected: commit succeeds.

---

### Task 11: Add Release Flow Dogfood And Verification Report

**Files:**
- Create: `scripts/release-flow-dogfood.ts`
- Modify: `package.json`
- Create: `tests/smoke/release-flow-dogfood-script.test.ts`
- Create: `docs/superpowers/reports/p1-release-risk-radar-verification.md`

- [ ] **Step 1: Write failing smoke test for dogfood script**

Create `tests/smoke/release-flow-dogfood-script.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { requiredReleaseFlowReportMarkers } from '../../scripts/release-flow-dogfood';

describe('release flow dogfood script', () => {
  it('defines every required verification marker', () => {
    expect(requiredReleaseFlowReportMarkers).toEqual([
      'P0 delivery path',
      'Release create/link/submit',
      'Release approval or override approval',
      'Release observing/close',
      'Release cockpit query',
      'Release replay redaction',
      'Release observation backlink projection',
      'Durable local reset',
      'Strict local_codex run',
    ]);
  });
});
```

- [ ] **Step 2: Run smoke test and verify it fails**

Run:

```bash
pnpm vitest run tests/smoke/release-flow-dogfood-script.test.ts
```

Expected: FAIL because script does not exist.

- [ ] **Step 3: Implement dogfood script**

Create `scripts/release-flow-dogfood.ts`:

- Export `requiredReleaseFlowReportMarkers`.
- Seed or drive a deterministic P0 delivery fixture.
- Create Release.
- Link WorkItem and ExecutionPackage.
- Submit.
- Override approve with rationale and matching blocker fingerprint when blockers remain.
- Start observing.
- Record observation evidence with public backlinks.
- Close completed.
- Fetch cockpit and replay.
- Assert serialized output has no local paths or raw fields.
- Write `docs/superpowers/reports/p1-release-risk-radar-verification.md` with exact required markers.

Modify `package.json`:

```json
"dogfood:release-flow": "tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/release-flow-dogfood.ts"
```

- [ ] **Step 4: Run smoke test and dogfood script**

Run:

```bash
pnpm vitest run tests/smoke/release-flow-dogfood-script.test.ts
pnpm dogfood:release-flow
```

Expected:

- smoke test PASS;
- script exits 0;
- report exists and contains every marker from the spec.

- [ ] **Step 5: Commit dogfood**

Run:

```bash
git add scripts/release-flow-dogfood.ts package.json tests/smoke/release-flow-dogfood-script.test.ts docs/superpowers/reports/p1-release-risk-radar-verification.md
git commit -m "test: add release flow dogfood"
```

Expected: commit succeeds.

---

### Task 12: Drift Scan And Full Verification

**Files:**
- Potential modify: `docs/superpowers/plans/2026-05-09-p1-core-schema-release-flow.md`
- Potential modify: `docs/superpowers/reports/p1-release-risk-radar-verification.md`

- [ ] **Step 1: Run drift scans**

Run:

```bash
rg -n "ReleaseModule|release-cockpit|release replay|Release Owner|Release Flow" docs/PRD_v1.md docs/architecture-design docs/superpowers/plans docs/superpowers/specs
rg -n -e "IncidentLink|ContractRevision|PackageContractLink|test_evidences|related_object_refs|created_by_actor_id" -e "empty_""release_scope" packages apps tests scripts docs/superpowers
rg -n "local redaction|redactArtifact|serialize.*Artifact" apps packages tests
```

Expected:

- no active docs incorrectly claim old Release Flow plan already delivered product surface before this implementation;
- no accidental deferred productization symbols in product code or schema;
- no `related_object_refs` in product code or positive public DTOs; negative rejection tests and migration/spec notes may mention it;
- no legacy combined empty-scope blocker in product code, tests, or active current-source docs;
- no public `CreateReleaseRequest` path that accepts `created_by_actor_id`; internal audit fields such as `Release.created_by_actor_id` and `ReleaseEvidence.created_by_actor_id` are expected and should not be removed;
- no duplicated local redaction helper outside shared public evidence serializer; imports/usages of the shared serializer are expected.

- [ ] **Step 2: Fix any drift found**

If the scans find active misleading docs or obsolete enum names, update only the relevant docs/tests/code. Do not broaden scope.

- [ ] **Step 3: Run focused test suite**

Run:

```bash
pnpm vitest run \
  tests/contracts/contracts.test.ts \
  tests/contracts/public-evidence.test.ts \
  tests/domain/release-gates.test.ts \
  tests/domain/release-states.test.ts \
  tests/db/schema.test.ts \
  tests/db/repository.test.ts \
  tests/db/public-evidence-serialization.test.ts \
  tests/db/release-cockpit-queries.test.ts \
  tests/db/release-replay-queries.test.ts \
  tests/api/release-module.test.ts \
  tests/api/query-module.test.ts \
  tests/web/api.test.ts \
  tests/web/workbench-state.test.ts \
  tests/web/release-owner-surface.test.tsx \
  tests/smoke/release-flow-dogfood-script.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run full repository checks**

Run:

```bash
pnpm build
pnpm test
pnpm dogfood:release-flow
git diff --check
```

Expected: all commands PASS. If unrelated repo failures appear, fix them in this branch before completion.

- [ ] **Step 5: Update verification report**

Ensure `docs/superpowers/reports/p1-release-risk-radar-verification.md` contains:

```markdown
- P0 delivery path: PASSED or BLOCKED with reason
- Release create/link/submit: PASSED
- Release approval or override approval: PASSED
- Release observing/close: PASSED
- Release cockpit query: PASSED
- Release replay redaction: PASSED
- Release observation backlink projection: PASSED
- Durable local reset: PASSED or BLOCKED with reason
- Strict local_codex run: PASSED or BLOCKED with reason
```

Use `PASSED` only when the dogfood output proves it. Use `BLOCKED with reason` only for environment-dependent checks that cannot run locally.

- [ ] **Step 6: Commit final verification**

Run:

```bash
git add docs/superpowers/reports/p1-release-risk-radar-verification.md docs/superpowers/plans/2026-05-09-p1-core-schema-release-flow.md
git commit -m "docs: verify release risk radar surface"
```

Expected: commit succeeds if docs changed. If no docs changed, skip this commit.

- [ ] **Step 7: Final status**

Run:

```bash
git status --short --branch
git log --oneline --max-count=12
```

Expected: worktree is clean and the branch contains small commits for every task.
