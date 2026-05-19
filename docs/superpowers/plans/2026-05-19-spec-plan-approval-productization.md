# Spec / Plan Approval Productization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Productize Spec and Plan approval so users can complete Work Item planning through approved Plan package handoff from product pages, with backend gates as the source of truth.

**Architecture:** Tighten the Spec/Plan command contract first, then make decision evidence visible through replay, then wire Web lifecycle hooks and one shared lifecycle action component into Work Item scoped and direct routes. Keep the slice narrow: no compatibility shims, no old naming aliases, no raw product controls, and no package execution or retrospective loop expansion.

**Tech Stack:** NestJS, Zod, `@forgeloop/domain`, `@forgeloop/db`, React 19, React Router, TanStack Query, Vitest, Testing Library.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-05-19-spec-plan-approval-productization-design.md`
- PRD: `docs/PRD_v1.md`
- Current API service: `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`
- Current API controller: `apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts`
- Current Web Work Item flow: `apps/web/src/features/spec-plan/spec-plan-work-item-flow.tsx`
- Current direct routes: `apps/web/src/features/spec-plan/spec-plan-direct-routes.tsx`

## Scope Check

This is one shippable main-flow product slice: Spec approval, Plan approval, strict Plan creation/draft gates, decision replay, and approved Plan package handoff. It does not implement an Approval Center, run launch changes, package execution changes, Evolution Loop, retrospective learning, compatibility aliases, or legacy UI paths.

## File Structure And Ownership

### Backend Command Contract

- Modify `apps/control-plane-api/src/modules/delivery/dto.ts`
  - Add explicit lifecycle DTO schemas and types:
    - `submitForApprovalCommandSchema`
    - `approveArtifactCommandSchema`
    - `requestArtifactChangesCommandSchema`
    - matching exported DTO types
- Modify `apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts`
  - Use explicit schemas per lifecycle endpoint.
- Modify `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`
  - Require current revisions for submit and approval.
  - Require in-review state for approval and request changes through existing state transition behavior plus clearer service guards where useful.
  - Set `approved_revision_id`, `approved_at`, and `approved_by_actor_id` on approved Specs and Plans.
  - Persist approval and changes-requested decisions with rationale summaries.
  - Use Work Item `resubmit_spec` / `resubmit_plan` transitions when submitting artifacts after changes were requested.
  - Tighten `createPlan` and `generatePlanDraft` to require an approved current Spec with `approved_revision_id` and `current_revision_id === approved_revision_id`.
- Test `tests/api/spec-plan-service.test.ts`
  - Cover API command gates, rationale validation, approval metadata, decisions, and strict Plan creation/draft gates.

### Replay / Read Models

- Modify `packages/db/src/queries/web-product-queries.ts`
  - Include Spec/Plan decision entries in `getSpecPlanReplayTimeline` using `repository.listDecisionsForObject(objectType, objectId)`.
  - Serialize decisions with public replay boundaries and merge chronologically with object events, status history, and parent Work Item replay.
- Test `tests/api/query-module.test.ts`
  - Assert Spec and Plan replay endpoints include approval and request-changes decision summaries without raw decision internals.

### Web API Layer

- Modify `apps/web/src/shared/api/types.ts`
  - Add `approved_revision_id`, `approved_at`, and `approved_by_actor_id` to `SpecPlan`.
  - Add lifecycle request body types:
    - `SubmitForApprovalBody`
    - `ApproveArtifactBody`
    - `RequestArtifactChangesBody`
- Modify `apps/web/src/shared/api/commands.ts`
  - Update lifecycle command method body types while preserving endpoint URLs and trusted actor header behavior.
- Modify `apps/web/src/shared/api/hooks.ts`
  - Add six lifecycle mutation hooks.
  - Add focused invalidation helpers for Spec resources, Plan resources, optional Work Item cockpit, and package query family after approved Plan handoff.
- Test `tests/web/api-hooks.test.tsx`
  - Cover endpoints, actor body/header behavior, invalidation keys, and package invalidation after Plan approval.

### Web Lifecycle UI

- Create `apps/web/src/features/spec-plan/spec-plan-lifecycle-actions.tsx`
  - One artifact-kind-aware component for Spec and Plan lifecycle actions.
  - Derive valid actions from `status`, `gate_state`, `resolution`, `current_revision_id`, `approved_revision_id`, and artifact kind.
  - Render submit, approve with optional rationale, request changes with required rationale, blocked reasons, pending states, and action-level errors.
  - Do not fetch artifacts internally; parent routes pass current artifact state.
- Test `tests/web/spec-plan-lifecycle-actions.test.tsx`
  - Component-level lifecycle derivation, form validation, and mutation body coverage.
- Modify `apps/web/src/features/spec-plan/spec-plan-work-item-flow.tsx`
  - Replace disabled approval placeholder rail with the shared lifecycle component.
  - Enable `Create Plan` only when current Spec is strictly approved.
  - Block Plan draft generation until current Spec is strictly approved.
  - Use `approved_revision_id` for Plan-to-Packages handoff.
- Modify `apps/web/src/features/spec-plan/spec-plan-direct-routes.tsx`
  - Replace disabled direct approval buttons with the shared lifecycle component.
  - Use `approved_revision_id` for Plan package readiness links.
  - Keep direct revision pages read-only and upstream object creation out of direct detail pages.
- Test fixtures:
  - Modify `tests/web/fixtures/product-data.ts`
  - Modify `tests/web/fixtures/product-api-mock.ts`
- Route tests:
  - Modify `tests/web/spec-plan-product-route.test.tsx`
  - Modify `tests/web/spec-plan-direct-routes.test.tsx`

### Guards And Verification

- Modify `tests/web/no-legacy-web-ui.test.ts`
  - Add product-page raw/debug scan terms: `raw JSON`, `raw replay`, `raw payload`, `Replay payload`, `Load raw replay`, `Object ID`, `manual ID`, `manual .*loader`, `direct id loading`, `debug-only`.
- Run `tests/naming/delivery-naming.test.ts`
  - Ensure no old subsystem naming or compatibility aliases return.

## Implementation Rules

- Use @superpowers:test-driven-development for each task: write the failing test, run it to fail, implement the minimum, run it to pass.
- Use @superpowers:verification-before-completion before each commit.
- Do not stage or commit unrelated files. In particular, leave `docs/superpowers/specs/2026-05-19-codex-generation-runtime-plan-package-design.md` untouched if it is still untracked.
- Do not add old subsystem aliases, historical route fallbacks, raw loaders, compatibility shims, or product UI debug controls.
- Use exact approved revision identity for package handoff. Never fall back from `approved_revision_id` to `current_revision_id`.
- Keep commits focused and independently reviewable.

---

### Task 1: Tighten API Lifecycle DTOs And Command Gates

**Files:**
- Modify: `apps/control-plane-api/src/modules/delivery/dto.ts`
- Modify: `apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts`
- Modify: `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`
- Test: `tests/api/spec-plan-service.test.ts`

- [ ] **Step 1: Write failing API tests for lifecycle DTOs and state gates**

Add focused tests to `tests/api/spec-plan-service.test.ts`:

```ts
it('rejects submitting a spec without a current revision', async () => {
  const server = app.getHttpServer();
  const { workItem } = await createProjectRepoWorkItem(app);
  const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;

  const response = await request(server)
    .post(`/specs/${spec.id}/submit-for-approval`)
    .set(ownerHeaders)
    .send({ actor_id: actorOwner })
    .expect(400);

  expect(response.body.message).toContain('has no current revision');
});

it('rejects submitting a plan without a current revision', async () => {
  const server = app.getHttpServer();
  const { workItem } = await createProjectRepoWorkItem(app);
  const spec = await createApprovedSpec(app, workItem.id);
  expect(spec.approved_revision_id).toBeDefined();
  const plan = (await request(server).post(`/work-items/${workItem.id}/plans`).send({}).expect(201)).body;

  const response = await request(server)
    .post(`/plans/${plan.id}/submit-for-approval`)
    .set(ownerHeaders)
    .send({ actor_id: actorOwner })
    .expect(400);

  expect(response.body.message).toContain('has no current revision');
});

it('rejects request changes without a rationale', async () => {
  const server = app.getHttpServer();
  const { workItem } = await createProjectRepoWorkItem(app);
  const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;
  await request(server).post(`/specs/${spec.id}/revisions`).send(validSpecRevision).expect(201);
  await request(server).post(`/specs/${spec.id}/submit-for-approval`).set(ownerHeaders).send({ actor_id: actorOwner }).expect(201);

  await request(server)
    .post(`/specs/${spec.id}/request-changes`)
    .set(reviewerHeaders)
    .send({ actor_id: actorReviewer, rationale: '   ' })
    .expect(400);
});

it('rejects approval and request changes unless the artifact is in review', async () => {
  const server = app.getHttpServer();
  const { workItem } = await createProjectRepoWorkItem(app);
  const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;
  await request(server).post(`/specs/${spec.id}/revisions`).send(validSpecRevision).expect(201);

  await request(server)
    .post(`/specs/${spec.id}/approve`)
    .set(reviewerHeaders)
    .send({ actor_id: actorReviewer })
    .expect(400);
  await request(server)
    .post(`/specs/${spec.id}/request-changes`)
    .set(reviewerHeaders)
    .send({ actor_id: actorReviewer, rationale: 'Needs review first.' })
    .expect(400);
});

it('resubmits specs and plans after requested changes', async () => {
  const server = app.getHttpServer();
  const { workItem } = await createProjectRepoWorkItem(app);
  const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;
  await request(server).post(`/specs/${spec.id}/revisions`).send(validSpecRevision).expect(201);
  await request(server).post(`/specs/${spec.id}/submit-for-approval`).set(ownerHeaders).send({ actor_id: actorOwner }).expect(201);
  await request(server)
    .post(`/specs/${spec.id}/request-changes`)
    .set(reviewerHeaders)
    .send({ actor_id: actorReviewer, rationale: 'Clarify acceptance criteria.' })
    .expect(201);

  await request(server).post(`/specs/${spec.id}/submit-for-approval`).set(ownerHeaders).send({ actor_id: actorOwner }).expect(201);
  expect((await request(server).get(`/work-items/${workItem.id}`).expect(200)).body).toMatchObject({
    phase: 'spec',
    gate_state: 'awaiting_spec_approval',
  });

  await request(server).post(`/specs/${spec.id}/approve`).set(reviewerHeaders).send({ actor_id: actorReviewer }).expect(201);
  const plan = (await request(server).post(`/work-items/${workItem.id}/plans`).send({}).expect(201)).body;
  await request(server).post(`/plans/${plan.id}/revisions`).send(validPlanRevision).expect(201);
  await request(server).post(`/plans/${plan.id}/submit-for-approval`).set(ownerHeaders).send({ actor_id: actorOwner }).expect(201);
  await request(server)
    .post(`/plans/${plan.id}/request-changes`)
    .set(reviewerHeaders)
    .send({ actor_id: actorReviewer, rationale: 'Split rollout checks.' })
    .expect(201);

  await request(server).post(`/plans/${plan.id}/submit-for-approval`).set(ownerHeaders).send({ actor_id: actorOwner }).expect(201);
  expect((await request(server).get(`/work-items/${workItem.id}`).expect(200)).body).toMatchObject({
    phase: 'plan',
    gate_state: 'awaiting_plan_approval',
  });
});
```

Also add helper functions inside the test file:

```ts
const createApprovedSpec = async (app: INestApplication, workItemId: string) => {
  const server = app.getHttpServer();
  const spec = (await request(server).post(`/work-items/${workItemId}/specs`).send({}).expect(201)).body;
  await request(server).post(`/specs/${spec.id}/revisions`).send(validSpecRevision).expect(201);
  await request(server).post(`/specs/${spec.id}/submit-for-approval`).set(ownerHeaders).send({ actor_id: actorOwner }).expect(201);
  return (await request(server).post(`/specs/${spec.id}/approve`).set(reviewerHeaders).send({ actor_id: actorReviewer }).expect(201)).body;
};
```

- [ ] **Step 2: Run the focused API test to verify it fails**

Run: `pnpm vitest run tests/api/spec-plan-service.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because submit currently allows missing current revisions and request-changes currently accepts only `actor_id`.

- [ ] **Step 3: Add explicit lifecycle DTO schemas**

In `apps/control-plane-api/src/modules/delivery/dto.ts`, keep `actorCommandSchema` for existing callers and add:

```ts
export const submitForApprovalCommandSchema = actorCommandSchema;
export type SubmitForApprovalCommandDto = z.infer<typeof submitForApprovalCommandSchema>;

export const approveArtifactCommandSchema = actorCommandSchema
  .extend({
    rationale: nonEmptyString.optional(),
  })
  .strict();
export type ApproveArtifactCommandDto = z.infer<typeof approveArtifactCommandSchema>;

export const requestArtifactChangesCommandSchema = actorCommandSchema
  .extend({
    rationale: nonEmptyString,
  })
  .strict();
export type RequestArtifactChangesCommandDto = z.infer<typeof requestArtifactChangesCommandSchema>;
```

- [ ] **Step 4: Wire explicit DTOs in the controller**

In `apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts`, import the new schemas and types. Use:

```ts
@Body(new ZodValidationPipe(submitForApprovalCommandSchema)) body: SubmitForApprovalCommandDto
@Body(new ZodValidationPipe(approveArtifactCommandSchema)) body: ApproveArtifactCommandDto
@Body(new ZodValidationPipe(requestArtifactChangesCommandSchema)) body: RequestArtifactChangesCommandDto
```

Apply this to both Spec and Plan lifecycle endpoints.

- [ ] **Step 5: Implement service gate checks**

In `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`, change method signatures to use the new DTO types. Add small helpers:

```ts
private requireCurrentRevision(entity: Spec | Plan): string {
  if (entity.current_revision_id === undefined) {
    throw new BadRequestException(`${this.artifactLabel(entity)} ${entity.id} has no current revision`);
  }
  return entity.current_revision_id;
}

private artifactLabel(entity: Spec | Plan): 'Spec' | 'Plan' {
  return entity.entity_type === 'spec' ? 'Spec' : 'Plan';
}

private requireInReview(entity: Spec | Plan): void {
  if (entity.status !== 'in_review' || entity.gate_state !== 'awaiting_approval') {
    throw new BadRequestException(`${this.artifactLabel(entity)} ${entity.id} is not awaiting approval`);
  }
}
```

Call `requireCurrentRevision` before `submit_for_approval` and before `approve` for both Specs and Plans. Call `requireInReview` before `approve` and `request_changes` for both Specs and Plans so lifecycle state failures return intentional product errors rather than depending on a lower-level transition exception.

Update `updateWorkItemForSpecPlan` and the submit methods so resubmission after requested changes uses the domain resubmit transitions:

```ts
private workItemSubmitTransitionFor(entity: Spec | Plan): 'submit_spec' | 'resubmit_spec' | 'submit_plan' | 'resubmit_plan' {
  if (entity.entity_type === 'spec') {
    return entity.gate_state === 'changes_requested' ? 'resubmit_spec' : 'submit_spec';
  }
  return entity.gate_state === 'changes_requested' ? 'resubmit_plan' : 'submit_plan';
}
```

Call `updateWorkItemForSpecPlan(updated.work_item_id, this.workItemSubmitTransitionFor(spec), actorId)` from `submitSpecForApproval` and the Plan equivalent. Extend the `type` union accepted by `updateWorkItemForSpecPlan` to include `resubmit_spec` and `resubmit_plan`.

- [ ] **Step 6: Run API test again**

Run: `pnpm vitest run tests/api/spec-plan-service.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS for new DTO/gate tests and existing lifecycle tests.

- [ ] **Step 7: Commit API DTO and submit-gate changes**

```bash
git add apps/control-plane-api/src/modules/delivery/dto.ts apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts tests/api/spec-plan-service.test.ts
git commit -m "fix: tighten spec plan lifecycle command gates"
```

### Task 2: Persist Approval Metadata, Rationale Decisions, And Strict Plan Preconditions

**Files:**
- Modify: `apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts`
- Test: `tests/api/spec-plan-service.test.ts`

- [ ] **Step 1: Write failing tests for approval metadata and decisions**

Add tests to `tests/api/spec-plan-service.test.ts`:

```ts
import type { DeliveryRepository } from '@forgeloop/db';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';

it('approves specs with approval metadata and optional rationale decision', async () => {
  const server = app.getHttpServer();
  const repo = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const { workItem } = await createProjectRepoWorkItem(app);
  const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;
  const revision = (await request(server).post(`/specs/${spec.id}/revisions`).send(validSpecRevision).expect(201)).body;
  await request(server).post(`/specs/${spec.id}/submit-for-approval`).set(ownerHeaders).send({ actor_id: actorOwner }).expect(201);

  const approved = (
    await request(server)
      .post(`/specs/${spec.id}/approve`)
      .set(reviewerHeaders)
      .send({ actor_id: actorReviewer, rationale: 'Ready for planning.' })
      .expect(201)
  ).body;

  expect(approved).toMatchObject({
    approved_revision_id: revision.id,
    approved_by_actor_id: actorReviewer,
  });
  expect(approved.approved_at).toEqual(expect.any(String));
  expect(await repo.listDecisionsForObject('spec', spec.id)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        actor_id: actorReviewer,
        decision: 'approved',
        summary: 'Ready for planning.',
      }),
    ]),
  );
});

it('records request-changes rationale for specs and plans', async () => {
  const server = app.getHttpServer();
  const repo = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const { workItem } = await createProjectRepoWorkItem(app);
  const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;
  await request(server).post(`/specs/${spec.id}/revisions`).send(validSpecRevision).expect(201);
  await request(server).post(`/specs/${spec.id}/submit-for-approval`).set(ownerHeaders).send({ actor_id: actorOwner }).expect(201);

  const changed = (
    await request(server)
      .post(`/specs/${spec.id}/request-changes`)
      .set(reviewerHeaders)
      .send({ actor_id: actorReviewer, rationale: 'Clarify acceptance criteria.' })
      .expect(201)
  ).body;

  expect(changed.status).toBe('draft');
  expect(changed.gate_state).toBe('changes_requested');
  expect(await repo.listDecisionsForObject('spec', spec.id)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        actor_id: actorReviewer,
        decision: 'changes_requested',
        summary: 'Clarify acceptance criteria.',
      }),
    ]),
  );

  await request(server).post(`/specs/${spec.id}/submit-for-approval`).set(ownerHeaders).send({ actor_id: actorOwner }).expect(201);
  await request(server).post(`/specs/${spec.id}/approve`).set(reviewerHeaders).send({ actor_id: actorReviewer }).expect(201);
  const plan = (await request(server).post(`/work-items/${workItem.id}/plans`).send({}).expect(201)).body;
  await request(server).post(`/plans/${plan.id}/revisions`).send(validPlanRevision).expect(201);
  await request(server).post(`/plans/${plan.id}/submit-for-approval`).set(ownerHeaders).send({ actor_id: actorOwner }).expect(201);
  const changedPlan = (
    await request(server)
      .post(`/plans/${plan.id}/request-changes`)
      .set(reviewerHeaders)
      .send({ actor_id: actorReviewer, rationale: 'Break implementation into smaller checks.' })
      .expect(201)
  ).body;

  expect(changedPlan.status).toBe('draft');
  expect(changedPlan.gate_state).toBe('changes_requested');
  expect(await repo.listDecisionsForObject('plan', plan.id)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        actor_id: actorReviewer,
        decision: 'changes_requested',
        summary: 'Break implementation into smaller checks.',
      }),
    ]),
  );
});
```

Extend the existing Plan approval test by adding `const repo = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;` near the test setup and asserting:

```ts
expect(approvedPlan.approved_at).toEqual(expect.any(String));
expect(approvedPlan.approved_by_actor_id).toBe(actorReviewer);
expect(await repo.listDecisionsForObject('plan', plan.id)).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      actor_id: actorReviewer,
      decision: 'approved',
      summary: 'Plan approved.',
    }),
  ]),
);
```

- [ ] **Step 2: Write failing tests for strict Plan creation and draft gates**

Add tests:

```ts
it('rejects creating a plan until the current spec is the approved revision', async () => {
  const server = app.getHttpServer();
  const { workItem } = await createProjectRepoWorkItem(app);
  const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;
  await request(server).post(`/specs/${spec.id}/revisions`).send(validSpecRevision).expect(201);

  await request(server).post(`/work-items/${workItem.id}/plans`).send({}).expect(400);

  await request(server).post(`/specs/${spec.id}/submit-for-approval`).set(ownerHeaders).send({ actor_id: actorOwner }).expect(201);
  await request(server).post(`/specs/${spec.id}/approve`).set(reviewerHeaders).send({ actor_id: actorReviewer }).expect(201);
  await request(server).post(`/specs/${spec.id}/revisions`).send({ ...validSpecRevision, summary: 'Changed after approval' }).expect(201);

  const staleResponse = await request(server).post(`/work-items/${workItem.id}/plans`).send({}).expect(400);
  expect(staleResponse.body.message).toContain('approved current revision');
});
```

Add a matching `generatePlanDraft` stale-Spec test after creating a Plan from a valid approved Spec, then changing the Spec current revision before `POST /plans/:planId/generate-draft`.

- [ ] **Step 3: Run the focused API test to verify it fails**

Run: `pnpm vitest run tests/api/spec-plan-service.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because approvals do not set all metadata, request changes do not persist decisions, and Plan creation still allows Spec existence without strict approval.

- [ ] **Step 4: Implement approval metadata and decision summaries**

In `approveSpec` and `approvePlan`, capture one timestamp:

```ts
const approvedAt = this.now();
const currentRevisionId = this.requireCurrentRevision(specOrPlan);
const updated = {
  ...(transitionSpecPlan(specOrPlan, { type: 'approve', at: approvedAt }) as Spec | Plan),
  approved_revision_id: currentRevisionId,
  approved_at: approvedAt,
  approved_by_actor_id: actorId,
};
await this.decision(kind, id, actorId, 'approved', dto.rationale ?? `${label} approved.`);
```

In `requestSpecChanges` and `requestPlanChanges`, call:

```ts
await this.decision('spec', spec.id, actorId, 'changes_requested', dto.rationale);
```

Use `'plan'` for Plans. Do not store empty rationale; the DTO rejects it.

- [ ] **Step 5: Implement strict approved current Spec helper and call it from create/generate**

Replace `requireApprovedCurrentSpec` with a repository-aware helper so `createPlan` can validate through the same locked repository instance:

```ts
private async requireApprovedCurrentSpec(workItem: WorkItem, repository: DeliveryRepository = this.repository): Promise<Spec> {
  if (workItem.current_spec_id === undefined) {
    throw new BadRequestException(`WorkItem ${workItem.id} has no current spec`);
  }
  const spec = this.requireFound(await repository.getSpec(workItem.current_spec_id), `Spec ${workItem.current_spec_id}`);
  const approvedRevisionId = spec.approved_revision_id;
  if (
    spec.status !== 'approved' ||
    spec.resolution !== 'approved' ||
    approvedRevisionId === undefined ||
    spec.current_revision_id !== approvedRevisionId
  ) {
    throw new BadRequestException(`Spec ${spec.id} does not have an approved current revision`);
  }
  return spec;
}
```

Call `await this.requireApprovedCurrentSpec(workItem, repository)` inside `createPlan` while holding the Work Item lock, before creating the Plan. Keep existing calls in `createPlanRevision` and `generatePlanDraft` using the default repository.

- [ ] **Step 6: Run API test again**

Run: `pnpm vitest run tests/api/spec-plan-service.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 7: Commit metadata, decisions, and Plan gate changes**

```bash
git add apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts tests/api/spec-plan-service.test.ts
git commit -m "fix: require approved current spec for plan work"
```

### Task 3: Add Spec/Plan Decisions To Replay Timeline

**Files:**
- Modify: `packages/db/src/queries/web-product-queries.ts`
- Test: `tests/api/query-module.test.ts`

- [ ] **Step 1: Write failing replay tests for Spec and Plan decision summaries**

In `tests/api/query-module.test.ts`, extend the Spec/Plan replay test or add a new one:

```ts
it('includes Spec and Plan approval decisions in replay timelines', async () => {
  const { app } = await track(createTestApp());
  const executionPackage = await seedReadyPackage(app);

  const specReplay = await request(app.getHttpServer()).get(`/query/replay/spec/${executionPackage.spec_id}`).expect(200);
  const planReplay = await request(app.getHttpServer()).get(`/query/replay/plan/${executionPackage.plan_id}`).expect(200);

  expect(specReplay.body).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: 'decision',
        object_type: 'spec',
        object_id: executionPackage.spec_id,
        summary: expect.stringMatching(/approved|changes/i),
      }),
    ]),
  );
  expect(planReplay.body).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: 'decision',
        object_type: 'plan',
        object_id: executionPackage.plan_id,
        summary: expect.stringMatching(/approved|changes/i),
      }),
    ]),
  );
  expect(JSON.stringify([...specReplay.body, ...planReplay.body])).not.toContain('raw_ref');
});
```

If `seedReadyPackage` does not create Spec/Plan decisions, insert decisions directly through the tracked repository before the replay requests:

```ts
const replayDecisionAt = '2026-05-19T12:00:00.000Z';
await repo.saveDecision({
  id: 'spec-decision-for-replay',
  object_type: 'spec',
  object_id: executionPackage.spec_id,
  actor_id: 'actor-reviewer',
  decision: 'approved',
  summary: 'Spec approved for replay.',
  evidence_refs: { raw_ref: 'local://private/spec.json' },
  created_at: replayDecisionAt,
});
await repo.saveDecision({
  id: 'plan-decision-for-replay',
  object_type: 'plan',
  object_id: executionPackage.plan_id,
  actor_id: 'actor-reviewer',
  decision: 'approved',
  summary: 'Plan approved for replay.',
  evidence_refs: { raw_ref: 'local://private/plan.json' },
  created_at: replayDecisionAt,
});
```

- [ ] **Step 2: Run query tests to verify they fail**

Run: `pnpm vitest run tests/api/query-module.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because `getSpecPlanReplayTimeline` currently omits `repository.listDecisionsForObject`.

- [ ] **Step 3: Serialize decisions in `getSpecPlanReplayTimeline`**

In `packages/db/src/queries/web-product-queries.ts`, add a third loop after status history:

```ts
for (const item of await repository.listDecisionsForObject(objectType, objectId)) {
  entries.push(
    serializePublicReplayEntry({
      id: item.id,
      source: 'decision',
      object_type: item.object_type,
      object_id: item.object_id,
      summary: item.summary,
      created_at: item.created_at,
      payload: item,
    }),
  );
}
```

Keep the existing de-duplication and chronological sort.

- [ ] **Step 4: Run query tests again**

Run: `pnpm vitest run tests/api/query-module.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS and replay decision payloads remain public-safe.

- [ ] **Step 5: Commit replay coverage**

```bash
git add packages/db/src/queries/web-product-queries.ts tests/api/query-module.test.ts
git commit -m "fix: include spec plan decisions in replay"
```

### Task 4: Add Web Lifecycle Types, Commands, Hooks, And Invalidation

**Files:**
- Modify: `apps/web/src/shared/api/types.ts`
- Modify: `apps/web/src/shared/api/commands.ts`
- Modify: `apps/web/src/shared/api/hooks.ts`
- Test: `tests/web/api-hooks.test.tsx`

- [ ] **Step 1: Write failing hook tests**

In `tests/web/api-hooks.test.tsx`, add imports for the six new hooks and tests like:

```ts
it('submits and approves specs through lifecycle hooks with actor context', async () => {
  const fetchMock = installProductApiMock({
    [`POST /specs/spec-1/submit-for-approval`]: { id: 'spec-1', entity_type: 'spec', work_item_id: workItem.id, status: 'in_review', editing_state: 'idle', gate_state: 'awaiting_approval', resolution: 'none' },
    [`POST /specs/spec-1/approve`]: { id: 'spec-1', entity_type: 'spec', work_item_id: workItem.id, status: 'approved', editing_state: 'idle', gate_state: 'approved', resolution: 'approved', current_revision_id: 'spec-rev-1', approved_revision_id: 'spec-rev-1' },
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

  const submit = renderHook(() => useSubmitSpecForApprovalMutation({ specId: 'spec-1', workItemId: workItem.id }), { wrapper });
  submit.result.current.mutate({ actor_id: 'actor-owner' });
  await waitFor(() => expect(submit.result.current.isSuccess).toBe(true));

  expect(fetchMock).toHaveBeenCalledWith(
    'http://localhost:3000/specs/spec-1/submit-for-approval',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-Forgeloop-Actor-Id': 'actor-owner' }),
    }),
  );
});
```

Add a separate assertion that Plan approval invalidates package queries:

```ts
await queryClient.prefetchQuery({
  queryKey: queryKeys.packages({ project_id: projectId, plan_revision_id: 'plan-rev-approved' }),
  queryFn: async () => ({ items: [], degraded_sources: [] }),
});
const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
```

Then approve a Plan returning `approved_revision_id: 'plan-rev-approved'` and expect an invalidation with `queryKey: ['packages']`.

- [ ] **Step 2: Run hook tests to verify they fail**

Run: `pnpm vitest run tests/web/api-hooks.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because lifecycle hooks and types do not exist.

- [ ] **Step 3: Add Web lifecycle body types and approved fields**

In `apps/web/src/shared/api/types.ts`:

```ts
export interface SpecPlan {
  // existing fields...
  approved_revision_id?: string;
  approved_at?: string;
  approved_by_actor_id?: string;
}

export type SubmitForApprovalBody = ActorCommandBody;

export interface ApproveArtifactBody extends ActorCommandBody {
  rationale?: string;
}

export interface RequestArtifactChangesBody extends ActorCommandBody {
  rationale: string;
}
```

- [ ] **Step 4: Update command method body types**

In `apps/web/src/shared/api/commands.ts`, change Spec/Plan lifecycle methods to use the new body types:

```ts
submitSpecForApproval: (specId: string, body: SubmitForApprovalBody) => ...
approveSpec: (specId: string, body: ApproveArtifactBody) => ...
requestSpecChanges: (specId: string, body: RequestArtifactChangesBody) => ...
```

Repeat for Plan. Keep `actorRequest(actorCommandActorId(body))`.

- [ ] **Step 5: Add lifecycle mutation hooks and invalidation helpers**

In `apps/web/src/shared/api/hooks.ts`, add hooks:

```ts
export function useApprovePlanMutation(input: { planId: string; workItemId?: string }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: ApproveArtifactBody) => createCommandApi().approvePlan(input.planId, body),
    onSuccess: (plan) =>
      Promise.all([
        invalidatePlanResources(queryClient, input.planId),
        invalidateWorkItemCockpit(queryClient, input.workItemId),
        plan.approved_revision_id === undefined ? Promise.resolve() : invalidatePackages(queryClient),
      ]),
  });
}
```

Add the other five hooks with the same pattern:

- Spec hooks invalidate `queryKeys.spec(specId)`, `queryKeys.specRevisions(specId)`, `queryKeys.specReplay(specId)`, `['specs']`, and optional Work Item cockpit.
- Plan hooks invalidate `queryKeys.plan(planId)`, `queryKeys.planRevisions(planId)`, `queryKeys.planReplay(planId)`, `['plans']`, and optional Work Item cockpit.
- Plan approval also invalidates `['packages']`.

- [ ] **Step 6: Run hook tests again**

Run: `pnpm vitest run tests/web/api-hooks.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 7: Commit Web API lifecycle hooks**

```bash
git add apps/web/src/shared/api/types.ts apps/web/src/shared/api/commands.ts apps/web/src/shared/api/hooks.ts tests/web/api-hooks.test.tsx
git commit -m "feat: add spec plan lifecycle web hooks"
```

### Task 5: Build Shared Spec/Plan Lifecycle Action Component

**Files:**
- Create: `apps/web/src/features/spec-plan/spec-plan-lifecycle-actions.tsx`
- Create: `tests/web/spec-plan-lifecycle-actions.test.tsx`

- [ ] **Step 1: Write failing component tests for lifecycle actions**

Create `tests/web/spec-plan-lifecycle-actions.test.tsx` with `// @vitest-environment jsdom`. Render the component under a `QueryClientProvider` and the product API mock. Assert user-visible behavior:

```ts
const renderLifecycle = (ui: ReactNode) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return { ...rendered, queryClient };
};

const inReviewSpec: SpecPlan = {
  id: 'spec-1',
  work_item_id: 'work-item-1',
  entity_type: 'spec',
  status: 'in_review',
  editing_state: 'idle',
  gate_state: 'awaiting_approval',
  resolution: 'none',
  current_revision_id: 'spec-rev-1',
};

it('submits a draft Spec with a current revision', async () => {
  const user = userEvent.setup();
  const fetchMock = installProductApiMock({
    'POST /specs/spec-1/submit-for-approval': {
      id: 'spec-1',
      work_item_id: 'work-item-1',
      entity_type: 'spec',
      status: 'in_review',
      editing_state: 'idle',
      gate_state: 'awaiting_approval',
      resolution: 'none',
      current_revision_id: 'spec-rev-1',
    },
  });

  renderLifecycle(
    <SpecPlanLifecycleActions
      actorId="actor-owner"
      artifact={{
        id: 'spec-1',
        work_item_id: 'work-item-1',
        entity_type: 'spec',
        status: 'draft',
        editing_state: 'idle',
        gate_state: 'not_submitted',
        resolution: 'none',
        current_revision_id: 'spec-rev-1',
      }}
      kind="spec"
      workItemId="work-item-1"
    />,
  );

  await user.click(screen.getByRole('button', { name: 'Submit Spec for approval' }));

  expect(fetchMock).toHaveBeenCalledWith(
    'http://localhost:3000/specs/spec-1/submit-for-approval',
    expect.objectContaining({ method: 'POST' }),
  );
});

it('requires rationale before requesting changes', async () => {
  const user = userEvent.setup();
  renderLifecycle(<SpecPlanLifecycleActions actorId="actor-reviewer" artifact={inReviewSpec} kind="spec" workItemId="work-item-1" />);

  expect((screen.getByRole('button', { name: 'Request Spec changes' }) as HTMLButtonElement).disabled).toBe(true);
  await user.type(screen.getByLabelText('Spec change rationale'), 'Clarify rollout risk.');
  expect((screen.getByRole('button', { name: 'Request Spec changes' }) as HTMLButtonElement).disabled).toBe(false);
});
```

Add blocked-state assertions:

```ts
expect(screen.getByText('Create a current Spec revision before submitting for approval.')).toBeTruthy();
expect(screen.getByText('Plan approval is available after a current Plan revision exists.')).toBeTruthy();
```

- [ ] **Step 2: Run component tests to verify they fail**

Run: `pnpm vitest run tests/web/spec-plan-lifecycle-actions.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because the lifecycle component does not exist yet.

- [ ] **Step 3: Create the lifecycle component**

Create `apps/web/src/features/spec-plan/spec-plan-lifecycle-actions.tsx` with this public API:

```ts
import { useMemo, useState } from 'react';
import {
  useApprovePlanMutation,
  useApproveSpecMutation,
  useRequestPlanChangesMutation,
  useRequestSpecChangesMutation,
  useSubmitPlanForApprovalMutation,
  useSubmitSpecForApprovalMutation,
} from '../../shared/api/hooks';
import type { SpecPlan } from '../../shared/api/types';
import { Button, Textarea } from '../../shared/ui';

export type SpecPlanLifecycleKind = 'spec' | 'plan';

export interface SpecPlanLifecycleActionsProps {
  artifact: SpecPlan | null | undefined;
  actorId: string;
  kind: SpecPlanLifecycleKind;
  workItemId?: string;
}
```

Implement derived helpers in the same file:

```ts
export function isStrictlyApproved(artifact: SpecPlan | null | undefined) {
  return Boolean(
    artifact &&
      artifact.status === 'approved' &&
      artifact.resolution === 'approved' &&
      artifact.approved_revision_id &&
      artifact.current_revision_id === artifact.approved_revision_id,
  );
}

function canSubmit(artifact: SpecPlan | null | undefined) {
  return Boolean(
    artifact &&
      artifact.current_revision_id &&
      artifact.status === 'draft' &&
      (artifact.gate_state === 'not_submitted' || artifact.gate_state === 'changes_requested'),
  );
}

function canReview(artifact: SpecPlan | null | undefined) {
  return Boolean(artifact && artifact.current_revision_id && artifact.status === 'in_review' && artifact.gate_state === 'awaiting_approval');
}
```

Render only the valid action group for the current state:

- Missing artifact: blocked copy.
- Missing current revision: blocked copy.
- Draft with current revision: submit button.
- In review: optional approve rationale textarea, approve button, required request-changes textarea and button.
- Strictly approved: approved state summary.
- Unexpected state: specific blocked copy.

- [ ] **Step 4: Wire mutation calls and action-level feedback**

Use separate local state for approve rationale, request-changes rationale, and last error text. Submit body examples:

```ts
submitMutation.mutate({ actor_id: actorId });
approveMutation.mutate({
  actor_id: actorId,
  ...(approveRationale.trim() ? { rationale: approveRationale.trim() } : {}),
});
requestChangesMutation.mutate({ actor_id: actorId, rationale: changeRationale.trim() });
```

Use button labels:

- `Submit Spec for approval`
- `Approve Spec`
- `Request Spec changes`
- `Submit Plan for approval`
- `Approve Plan`
- `Request Plan changes`

- [ ] **Step 5: Run component tests again**

Run: `pnpm vitest run tests/web/spec-plan-lifecycle-actions.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 6: Commit shared lifecycle component**

```bash
git add apps/web/src/features/spec-plan/spec-plan-lifecycle-actions.tsx tests/web/spec-plan-lifecycle-actions.test.tsx
git commit -m "feat: add spec plan lifecycle actions"
```

### Task 6: Integrate Lifecycle Actions Into Work Item Scoped Flow

**Files:**
- Modify: `apps/web/src/features/spec-plan/spec-plan-work-item-flow.tsx`
- Modify: `tests/web/fixtures/product-data.ts`
- Modify: `tests/web/fixtures/product-api-mock.ts`
- Test: `tests/web/spec-plan-product-route.test.tsx`

- [ ] **Step 1: Write failing Work Item scoped flow tests**

In `tests/web/spec-plan-product-route.test.tsx`, cover:

```ts
it('completes Spec approval, Plan creation, Plan approval, and approved package handoff from the Work Item flow', async () => {
  const user = userEvent.setup();
  const fetchMock = installProductApiMock(/* route responses for each transition */);
  renderProductRoute('/work-items/work-item-1/spec-plan');

  await user.click(await screen.findByRole('button', { name: 'Submit Spec for approval' }));
  await user.type(await screen.findByLabelText('Spec approval rationale'), 'Spec is ready.');
  await user.click(screen.getByRole('button', { name: 'Approve Spec' }));

  expect(((await screen.findByRole('button', { name: 'Create Plan' })) as HTMLButtonElement).disabled).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Create Plan' }));
  await user.click(await screen.findByRole('button', { name: 'Submit Plan for approval' }));
  await user.click(await screen.findByRole('button', { name: 'Approve Plan' }));

  expect((await screen.findByRole('link', { name: 'Continue to Packages' })).getAttribute('href')).toBe(
    '/packages?plan_revision_id=plan-rev-approved',
  );
  expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/plans/plan-1/approve', expect.objectContaining({ method: 'POST' }));
});
```

Add strict disabled cases:

```ts
expect((screen.getByRole('button', { name: 'Create Plan' }) as HTMLButtonElement).disabled).toBe(true);
expect(screen.getByText('Create Plan unlocks after the current Spec revision is approved.')).toBeTruthy();
expect(screen.queryByText('Ready for packages')).toBeNull();
expect(screen.queryByRole('link', { name: 'Continue to Packages' })).toBeNull();
```

Use fixtures where:

- Spec is `approved` but has no `approved_revision_id`.
- Spec has `approved_revision_id` but `current_revision_id !== approved_revision_id`.
- Approved Plan has `current_revision_id !== approved_revision_id`; package handoff must use `approved_revision_id`.
- Approved Plan has no `approved_revision_id`; page links only to `/packages`.

- [ ] **Step 2: Run Work Item route test to verify it fails**

Run: `pnpm vitest run tests/web/spec-plan-product-route.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because the route still enables Plan creation based on Spec existence and shows placeholder approval controls.

- [ ] **Step 3: Replace the approval placeholder rail**

In `apps/web/src/features/spec-plan/spec-plan-work-item-flow.tsx`, import `useActorContext`, read the current actor, and render lifecycle actions with that actor:

```tsx
const { actorId } = useActorContext();

<ActionRail title="Approval actions">
  <SpecPlanLifecycleActions actorId={actorId} artifact={viewModel.spec} kind="spec" workItemId={workItemId} />
  <SpecPlanLifecycleActions actorId={actorId} artifact={viewModel.plan} kind="plan" workItemId={workItemId} />
</ActionRail>
```

Guard this rendering behind loaded `viewModel.workItem !== null`; otherwise show loading/unavailable copy.

- [ ] **Step 4: Gate Create Plan and Plan draft generation with strict Spec approval**

Use the shared `isStrictlyApproved` helper:

```ts
const specApprovedForPlan = isStrictlyApproved(viewModel.spec);
```

Change `Create Plan` disabled/title logic so it requires `specApprovedForPlan`. Change Plan draft button disabled/title logic to require `specApprovedForPlan` too.

- [ ] **Step 5: Add approved Plan package handoff section and fix readiness copy**

In the Work Item flow Plan section or readiness section, render:

```tsx
{viewModel.plan?.status === 'approved' && viewModel.plan.approved_revision_id ? (
  <Link className="fl-button fl-button--primary" to={`/packages?plan_revision_id=${encodeURIComponent(viewModel.plan.approved_revision_id)}`}>
    Continue to Packages
  </Link>
) : viewModel.plan?.status === 'approved' ? (
  <Link className="fl-button fl-button--secondary" to="/packages">View package inventory</Link>
) : null}
```

Do not use `current_revision_id` as fallback.

Update the existing Planning readiness pills so they do not say `Ready for packages` merely because Spec and Plan records exist. Use strict approved Plan state:

```tsx
const planApprovedForPackages = isStrictlyApproved(viewModel.plan);

<StatusPill tone={planApprovedForPackages ? 'success' : 'warning'}>
  {planApprovedForPackages ? 'Ready for packages' : 'Planning in progress'}
</StatusPill>
```

The Work Item scoped route must not show `Ready for packages` or `Continue to Packages` until the Plan is approved with `approved_revision_id`.

- [ ] **Step 6: Run Work Item route test again**

Run: `pnpm vitest run tests/web/spec-plan-product-route.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 7: Commit Work Item scoped integration**

```bash
git add apps/web/src/features/spec-plan/spec-plan-work-item-flow.tsx tests/web/fixtures/product-data.ts tests/web/fixtures/product-api-mock.ts tests/web/spec-plan-product-route.test.tsx
git commit -m "feat: productize work item spec plan approval"
```

### Task 7: Integrate Lifecycle Actions Into Direct Spec And Plan Routes

**Files:**
- Modify: `apps/web/src/features/spec-plan/spec-plan-direct-routes.tsx`
- Modify: `tests/web/fixtures/product-data.ts`
- Modify: `tests/web/fixtures/product-api-mock.ts`
- Test: `tests/web/spec-plan-direct-routes.test.tsx`

- [ ] **Step 1: Write failing direct route tests**

In `tests/web/spec-plan-direct-routes.test.tsx`, add tests:

```ts
it('submits, approves, and requests changes from the direct Spec route', async () => {
  const user = userEvent.setup();
  const fetchMock = installProductApiMock(/* direct spec lifecycle responses */);
  renderProductRoute('/specs/spec-1');

  await user.click(await screen.findByRole('button', { name: 'Submit Spec for approval' }));
  await user.type(await screen.findByLabelText('Spec change rationale'), 'Needs clearer testing.');
  await user.click(screen.getByRole('button', { name: 'Request Spec changes' }));

  expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/specs/spec-1/request-changes', expect.objectContaining({ method: 'POST' }));
});

it('links direct approved Plans to packages by approved revision only', async () => {
  installProductApiMock(/* plan current_revision_id differs from approved_revision_id */);
  renderProductRoute('/plans/plan-approved');

  expect((await screen.findByRole('link', { name: 'View package readiness' })).getAttribute('href')).toBe(
    '/packages?plan_revision_id=plan-rev-approved',
  );
  expect(screen.queryByText('/packages?plan_revision_id=plan-rev-current')).toBeNull();
});
```

Add a fallback test where approved Plan has no `approved_revision_id` and only `/packages` is linked.

- [ ] **Step 2: Run direct route tests to verify they fail**

Run: `pnpm vitest run tests/web/spec-plan-direct-routes.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because direct routes still render disabled approval buttons and use `current_revision_id` for package readiness.

- [ ] **Step 3: Replace direct route action rail controls**

In `ArtifactDetailView` inside `apps/web/src/features/spec-plan/spec-plan-direct-routes.tsx`, import `useActorContext`, read the current actor, keep the current revision link, and replace disabled lifecycle buttons with:

```tsx
const { actorId } = useActorContext();

<SpecPlanLifecycleActions actorId={actorId} artifact={artifact} kind={kind} workItemId={artifact.work_item_id} />
```

Do not add manual actor input controls.

- [ ] **Step 4: Update direct Plan package handoff to use approved revision only**

In `PlanPackageState`, replace `plan.current_revision_id` with `plan.approved_revision_id`. Use:

```tsx
if (plan.approved_revision_id === undefined) {
  return <Link to="/packages">View package inventory</Link>;
}

return <Link to={`/packages?plan_revision_id=${encodeURIComponent(plan.approved_revision_id)}`}>View package readiness</Link>;
```

- [ ] **Step 5: Run direct route tests again**

Run: `pnpm vitest run tests/web/spec-plan-direct-routes.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 6: Commit direct route integration**

```bash
git add apps/web/src/features/spec-plan/spec-plan-direct-routes.tsx tests/web/fixtures/product-data.ts tests/web/fixtures/product-api-mock.ts tests/web/spec-plan-direct-routes.test.tsx
git commit -m "feat: productize direct spec plan approval"
```

### Task 8: Update No-Legacy Guards And Run Final Verification

**Files:**
- Modify: `tests/web/no-legacy-web-ui.test.ts`

- [ ] **Step 1: Write failing guard coverage for raw/debug product controls**

In `tests/web/no-legacy-web-ui.test.ts`, add:

```ts
it('does not expose raw or debug-only controls on product Web surfaces', () => {
  expect(sourceText()).not.toMatch(
    /raw JSON|raw replay|raw payload|Replay payload|Load raw replay|Object ID|manual ID|manual .*loader|direct id loading|debug-only/i,
  );
});
```

If this fails on legitimate Dev Tools source, split `sourceText()` into product source and allowed Dev Tools source. The test must still scan product routes and product route tests.

- [ ] **Step 2: Run guard test to verify the current result**

Run: `pnpm vitest run tests/web/no-legacy-web-ui.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS after product pages avoid raw/debug wording, or FAIL if a product test/route still contains prohibited product controls.

- [ ] **Step 3: Fix any guard violations without adding allowlisted product shims**

If the guard fails, rename user-visible product copy to workflow language. Do not add broad exclusions for product route files. Only exclude gated Dev Tools files if needed.

- [ ] **Step 4: Run focused final verification**

Run:

```bash
pnpm vitest run tests/api/spec-plan-service.test.ts tests/api/query-module.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm vitest run tests/web/api-hooks.test.tsx tests/web/spec-plan-product-route.test.tsx tests/web/spec-plan-direct-routes.test.tsx tests/web/no-legacy-web-ui.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm vitest run tests/naming/delivery-naming.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/web typecheck
pnpm --filter @forgeloop/web build
```

Expected: all commands PASS. The naming guard must still prevent old subsystem names and compatibility aliases.

- [ ] **Step 5: Commit guard and verification cleanup**

```bash
git add tests/web/no-legacy-web-ui.test.ts
git commit -m "test: guard spec plan product surfaces"
```

## Final Acceptance Checklist

- [ ] Spec submit is impossible without a current Spec revision.
- [ ] Plan submit is impossible without a current Plan revision.
- [ ] Spec approval sets `approved_revision_id`, `approved_at`, and `approved_by_actor_id`.
- [ ] Plan approval sets `approved_revision_id`, `approved_at`, and `approved_by_actor_id`.
- [ ] Request changes requires rationale and records a `changes_requested` decision.
- [ ] Approval records an `approved` decision with optional rationale or default summary.
- [ ] Plan creation is impossible until the Work Item current Spec is strictly approved.
- [ ] Plan draft generation is impossible until the Work Item current Spec is strictly approved.
- [ ] Spec/Plan replay includes decision summaries.
- [ ] Work Item scoped route supports Spec approval, Plan approval, and approved Plan package handoff.
- [ ] Direct Spec and Plan routes support lifecycle decisions.
- [ ] Package readiness handoff uses `approved_revision_id` only.
- [ ] No disabled placeholder approval controls remain on product Spec/Plan pages.
- [ ] No raw/debug product controls, old naming aliases, or compatibility shims are added.
