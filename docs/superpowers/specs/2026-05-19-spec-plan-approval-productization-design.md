# Spec / Plan Approval Productization Design

## Status

User-approved design draft. This document defines the next product slice for completing the main delivery path from Work Item planning through approved Plan handoff to package readiness.

This slice is intentionally narrow. It productizes Spec and Plan approval in the Web UI and tightens the backend gates that make those actions authoritative. It does not build an Approval Center, does not automate approval, and does not extend the Run Console path.

## Context

ForgeLoop now has a product-grade Web route architecture with first-class routes for Work Items, Specs, Plans, Packages, Runs, Reviews, Releases, and gated Dev Tools. The PRD delivery loop is:

Work Item -> Spec -> Implementation Plan -> Execution Package -> AI Implementation -> Review -> Integration / Test -> Release -> Observation.

The current codebase already has the backend state machine and command endpoints for Spec and Plan lifecycle transitions:

- `POST /specs/:specId/submit-for-approval`
- `POST /specs/:specId/approve`
- `POST /specs/:specId/request-changes`
- `POST /plans/:planId/submit-for-approval`
- `POST /plans/:planId/approve`
- `POST /plans/:planId/request-changes`

The current Web product routes still leave those controls disabled:

- `apps/web/src/features/spec-plan/spec-plan-work-item-flow.tsx` shows disabled approval actions with placeholder copy.
- `apps/web/src/features/spec-plan/spec-plan-direct-routes.tsx` shows disabled direct Spec/Plan approval actions.
- `apps/web/src/shared/api/commands.ts` already exposes command API methods for those endpoints.
- `apps/web/src/shared/api/hooks.ts` has create and draft-generation hooks, but no lifecycle approval hooks.

The current backend gates are also looser than the intended PRD flow:

- A Plan can be created when a Spec merely exists, even if the Spec is not approved.
- A Spec or Plan can be submitted for approval without a current revision, leaving an in-review artifact that cannot be approved.
- Approval and request-changes commands accept only `actor_id`, so reviewer rationale is not captured as product evidence.
- Request-changes commands update status and history, but do not persist a decision record that can be replayed with the reason.

This creates a product gap: a user cannot complete Work Item -> Spec approval -> Plan approval -> Package readiness from product pages without raw API usage or disabled placeholders.

## Goals

- Let users complete Spec and Plan approval from the product UI.
- Make the Work Item scoped Spec & Plan page the primary planning workflow surface.
- Make direct Spec and direct Plan detail routes capable of lifecycle decisions for their artifact.
- Enforce PRD gates:
  - no Plan creation until the current Spec is approved;
  - no approval submission until the artifact has a current revision;
  - no Plan draft generation unless the current Spec is approved;
  - no Package readiness handoff until the Plan is approved.
- Capture useful human decision evidence:
  - submit is lightweight and only requires actor context;
  - approve accepts optional rationale;
  - request changes requires rationale.
- Ensure decision evidence appears in replay/timeline views.
- Keep the UI clean, product-grade, responsive, and consistent with the new route architecture.
- Avoid any compatibility shim, old naming alias, raw loader, or historical UI path.

## Non-Goals

- No standalone Approval Center.
- No multi-artifact approval inbox in this slice.
- No automatic Spec approval or Plan approval.
- No Run Console automation, run enqueue, or AI implementation launch changes.
- No broad revision editor redesign beyond the fields and states needed for lifecycle actions.
- No retrospective or Evolution Loop implementation.
- No Dev Tools exposure of this flow as a product workaround.
- No retention of the old rule that "Spec exists" is enough to create a Plan.

## Product Workflow

### Work Item Scoped Spec & Plan

Route: `/work-items/:workItemId/spec-plan`

This is the main workflow surface for planning a Work Item.

The page shows the Work Item context, Spec state, Plan state, revision availability, and the right-side approval action rail. The action rail is state-aware and only exposes valid actions for the active artifact state.

Spec flow:

1. If no Spec exists, show `Create Spec`.
2. If a Spec exists without a current revision, show `Generate spec draft`; approval actions are disabled with a clear reason.
3. If a Spec has a current revision, `status === "draft"`, and `gate_state` is `not_submitted` or `changes_requested`, show `Submit Spec for approval`.
4. If a Spec has `status === "in_review"` and `gate_state === "awaiting_approval"`, show `Approve Spec` and `Request Spec changes`.
5. If a Spec has `status === "approved"`, `resolution === "approved"`, `approved_revision_id` set, and `current_revision_id === approved_revision_id`, show the approved revision and unlock Plan creation.

Plan flow:

1. If no Plan exists and the Spec is not approved, show a disabled Plan creation state with the reason.
2. If no Plan exists and the Spec is approved, show `Create Plan`.
3. If a Plan exists without a current revision, show `Generate plan draft`; approval actions are disabled with a clear reason.
4. If a Plan has a current revision, `status === "draft"`, and `gate_state` is `not_submitted` or `changes_requested`, show `Submit Plan for approval`.
5. If a Plan has `status === "in_review"` and `gate_state === "awaiting_approval"`, show `Approve Plan` and `Request Plan changes`.
6. If a Plan has `status === "approved"`, `resolution === "approved"`, and an approved revision, show `Continue to Packages` linking to `/packages?plan_revision_id=<approved_revision_id>`.

If `approved_revision_id` is missing on an approved Plan, the page must not invent a package readiness link. It shows a degraded state and links only to the package inventory.

### Direct Spec Detail

Route: `/specs/:specId`

The direct Spec page remains an artifact detail page. It supports lifecycle actions for that Spec and continues to link back to the parent Work Item. It does not create Work Items or Plans.

The direct page uses the same lifecycle component and the same action validity rules as the Work Item scoped page. Successful actions refresh Spec detail, Spec revisions, Spec replay, and Spec registry queries. If the parent Work Item cockpit is not loaded on this route, the action still succeeds and the artifact read models refresh.

### Direct Plan Detail

Route: `/plans/:planId`

The direct Plan page supports lifecycle actions for that Plan and shows package handoff after approval. It does not create Specs. It does not generate packages inline unless the user follows the existing package readiness route.

Successful actions refresh Plan detail, Plan revisions, Plan replay, Plan registry queries, and package readiness state where relevant.

## UX Design

The UI should remain a focused internal SaaS workflow, not a wizard-heavy demo path.

Use the existing product layout primitives:

- `DetailLayout`
- `PageHeader`
- `Section`
- `ActionRail`
- shared UI buttons, textareas, status pills, badges, drawers or compact panels

Approval actions live in the right action rail on object detail pages. The main content area explains current state, revision availability, and next-step readiness.

Interaction model:

- Submit is a single button.
- Approve has an optional rationale textarea.
- Request changes has a required rationale textarea and disabled submit button until the text is non-empty.
- Every disabled action has specific explanatory copy, not a generic placeholder.
- Pending mutations show loading states on the exact action button.
- Failed mutations show action-level error copy near the control.
- Timeline/replay sections show human-readable decision summaries, never raw field names such as `actor_id` or raw payload blobs.

Visual constraints:

- Keep the calm, information-dense operations style introduced by the Web redesign.
- Avoid card-in-card composition.
- Do not introduce new page-local visual systems.
- Use controlled form inputs with accessible labels.
- Preserve mobile and desktop layouts without horizontal scroll.
- Do not add emoji icons or decorative gradients.

## Backend Contract Changes

### DTOs

Replace the current generic-only Spec/Plan lifecycle command body with explicit schemas:

- Submit for approval:
  - `actor_id?: string`
- Approve:
  - `actor_id?: string`
  - `rationale?: string`
- Request changes:
  - `actor_id?: string`
  - `rationale: string`

`rationale` is trimmed. Empty request-changes rationale is rejected by the backend.

The command actor still follows the existing actor context rules:

- explicit body `actor_id` may be supplied;
- otherwise the actor context from headers can be used;
- persisted approval metadata and decision records use the resolved human actor.

### State Gates

Backend commands must enforce the same gates the UI presents:

- Submit Spec requires a current Spec revision.
- Submit Plan requires a current Plan revision.
- Approve Spec requires the Spec to be `in_review` and have a current revision.
- Approve Plan requires the Plan to be `in_review` and have a current revision.
- Request changes requires the artifact to be `in_review`.
- Create Plan requires the Work Item current Spec to be approved with `approved_revision_id` set and `current_revision_id === approved_revision_id`.
- Generate Plan draft continues to require the current Spec to be approved with `approved_revision_id` set and `current_revision_id === approved_revision_id`.

The backend remains authoritative. The UI may disable buttons for clarity, but product correctness must not depend on client-only guards.

### Approval Metadata

Approve commands must populate approval metadata on the approved artifact:

- `approved_revision_id` is set to the artifact `current_revision_id`;
- `approved_at` is set from the command transition timestamp;
- `approved_by_actor_id` is set from the resolved human actor.

This applies to both `approveSpec` and `approvePlan`. The API tests for approval must assert all three fields, not only `approved_revision_id`.

### Decision Evidence

Approval and request-changes commands persist decision records:

- approve Spec: decision `approved`, summary from optional rationale or a default product summary;
- request Spec changes: decision `changes_requested`, summary from required rationale;
- approve Plan: decision `approved`, summary from optional rationale or a default product summary;
- request Plan changes: decision `changes_requested`, summary from required rationale.

History/status events remain separate from decision evidence. Replay views should be able to show both status movement and the human decision summary.

The implementation must explicitly include Spec/Plan decisions in `getSpecPlanReplayTimeline` in `packages/db/src/queries/web-product-queries.ts`. Use the existing `repository.listDecisionsForObject(objectType, objectId)` repository method, serialize those decisions as public timeline entries, and merge them with object events and status history in chronological order. Approval and request-changes summaries must be visible without exposing raw decision payload fields.

### Read Model Fields

Web-facing `SpecPlan` types and serializers must expose the fields needed to render approved handoff state:

- `current_revision_id`
- `approved_revision_id`
- `approved_at`
- `approved_by_actor_id`
- `status`
- `gate_state`
- `resolution`

Existing query surfaces that already carry `revision_state.approved_revision_id` should remain consistent with direct artifact responses.

## Web Architecture

### Shared Lifecycle Hooks

Add lifecycle mutations in `apps/web/src/shared/api/hooks.ts`:

- `useSubmitSpecForApprovalMutation`
- `useApproveSpecMutation`
- `useRequestSpecChangesMutation`
- `useSubmitPlanForApprovalMutation`
- `useApprovePlanMutation`
- `useRequestPlanChangesMutation`

Each mutation calls the corresponding command API method from `apps/web/src/shared/api/commands.ts`.

On success, invalidate or refresh:

- artifact detail query;
- artifact revisions query;
- artifact replay query;
- artifact registry query family;
- Work Item cockpit query when the work item id is available;
- package registry/readiness queries after Plan approval when `approved_revision_id` is available.

Direct routes must not require a Work Item cockpit query to perform lifecycle actions.

### Shared Lifecycle Component

Add a shared Spec/Plan lifecycle action component under the Spec/Plan feature boundary. It should be artifact-kind aware but not duplicate Spec and Plan logic.

Inputs:

- artifact kind: `spec` or `plan`;
- artifact record;
- current actor id;
- optional work item id for cockpit invalidation;
- optional package handoff callback/link for approved Plans.

Responsibilities:

- derive valid actions from status, gate, revision availability, and artifact kind;
- render submit, approve, and request-changes controls;
- render specific blocked reasons;
- call lifecycle hooks;
- surface mutation loading and error states.

It must not own artifact fetching. Parent routes own data loading and pass the current artifact state in.

### Work Item Scoped Route Changes

`spec-plan-work-item-flow.tsx` should:

- replace disabled placeholder approval rail with the shared lifecycle component;
- use approved Spec state to enable Plan creation;
- show Plan blocked reason until the Spec is approved;
- use `approved_revision_id` as the Plan-to-Packages handoff id;
- keep create and draft-generation actions scoped to the Work Item flow.

The existing `Create Plan` button must no longer enable just because a Spec exists.

### Direct Route Changes

`spec-plan-direct-routes.tsx` should:

- replace disabled approval buttons with the shared lifecycle component;
- keep current revision and parent Work Item links;
- keep direct revision routes read-only;
- show package handoff only for approved Plans with an approved revision;
- keep creation/editing of upstream objects out of direct detail pages.

## Data Flow

Successful lifecycle command flow:

1. User triggers a lifecycle action from a product route.
2. Web sends command body with resolved actor id and optional/required rationale.
3. Control plane validates state and persists status/history/decision evidence.
4. Web refreshes authoritative read models.
5. Page re-renders next valid action:
   - submitted artifact shows in-review actions;
   - approved Spec unlocks Plan creation;
   - approved Plan shows package handoff;
   - changes requested artifact returns to draft-like revision/draft flow.

The UI may apply immediate query data updates for responsiveness, but final visible state must come from refreshed authoritative read models.

## Error Handling

- Validation errors show near the action that caused them.
- State conflicts explain that the artifact changed and the page should refresh or has already refreshed.
- Empty request-changes rationale is blocked in the UI and rejected by the API.
- Missing current revision blocks submit and approve with a specific message.
- Missing approved Plan revision blocks package readiness handoff and shows an inventory fallback.
- Replay unavailability does not block lifecycle actions; action success still refreshes detail and revision state.

## Security and Governance

- Product actions use existing actor context and human gate actor resolution.
- Automatic approval remains out of scope.
- The daemon and automation code paths do not gain new approval capabilities in this slice.
- Decision evidence must be public-safe for replay and review surfaces.
- No raw payload or debug-only control is exposed on product pages.

## Testing Plan

### API Tests

Add or update focused API tests for Spec/Plan service:

- submit Spec without current revision is rejected;
- submit Plan without current revision is rejected;
- approve Spec accepts optional rationale and persists decision summary;
- approve Plan accepts optional rationale and persists decision summary;
- request Spec changes requires rationale and persists `changes_requested` decision summary;
- request Plan changes requires rationale and persists `changes_requested` decision summary;
- approve Spec sets `approved_revision_id`, `approved_at`, and `approved_by_actor_id`;
- approve Plan sets `approved_revision_id`, `approved_at`, and `approved_by_actor_id`;
- create Plan is rejected when the Work Item current Spec is not approved;
- create Plan is rejected when the Work Item current Spec has `status === "approved"` and `resolution === "approved"` but lacks `approved_revision_id`;
- create Plan is rejected when the Work Item current Spec has `approved_revision_id` set but `current_revision_id !== approved_revision_id`;
- create Plan succeeds only when the Work Item current Spec has `status === "approved"`, `resolution === "approved"`, `approved_revision_id` set, and `current_revision_id === approved_revision_id`;
- generate Plan draft is rejected when the Work Item current Spec has `status === "approved"` and `resolution === "approved"` but lacks `approved_revision_id`;
- generate Plan draft is rejected when the Work Item current Spec has `approved_revision_id` set but `current_revision_id !== approved_revision_id`;
- generate Plan draft succeeds only when the Work Item current Spec has `status === "approved"`, `resolution === "approved"`, `approved_revision_id` set, and `current_revision_id === approved_revision_id`;
- replay/timeline surfaces include decision summaries after approval and request changes.

### Web Hook Tests

Add or update hook-level or route-backed assertions for lifecycle hooks:

- each hook calls the correct endpoint and method;
- actor body/header behavior matches existing command API conventions;
- success invalidates artifact detail, revisions, replay, registry, and Work Item cockpit when scoped.
- Plan approval with an `approved_revision_id` invalidates the package query family/readiness route state so `/packages?plan_revision_id=<approved_revision_id>` cannot show stale package readiness after approval.

### Web Route Tests

Update `tests/web/spec-plan-product-route.test.tsx`:

- full Work Item scoped path from generated Spec revision through Spec approval, Plan creation, generated Plan revision, Plan approval, and package handoff;
- Create Plan remains disabled until Spec approval has a stable approved revision: `status === "approved"`, `resolution === "approved"`, `approved_revision_id` exists, and `current_revision_id === approved_revision_id`;
- Create Plan remains disabled for approved Spec fixtures that lack `approved_revision_id`;
- Create Plan remains disabled for approved Spec fixtures where `current_revision_id !== approved_revision_id`;
- submit is disabled without current revision;
- request changes requires rationale;
- approved Plan package handoff uses `approved_revision_id`, with a fixture where `current_revision_id !== approved_revision_id`;
- approved Plan without `approved_revision_id` falls back to package inventory and does not link readiness by `current_revision_id`;
- action-level errors render without exposing raw payloads.

Update `tests/web/spec-plan-direct-routes.test.tsx`:

- direct Spec submit, approve, and request changes actions call the correct endpoints;
- direct Plan submit, approve, and request changes actions call the correct endpoints;
- approved Plan links to package readiness by `approved_revision_id`, with a fixture where `current_revision_id !== approved_revision_id`;
- approved Plan with `current_revision_id` but no `approved_revision_id` falls back to package inventory and does not link readiness by `current_revision_id`;
- direct pages remain read-only for revision content.

### Guard and Regression Tests

Continue running:

- `tests/web/no-legacy-web-ui.test.ts`
- update `tests/web/no-legacy-web-ui.test.ts` to guard product routes against raw/debug controls outside gated Dev Tools, using the delivery-report scan terms: `raw JSON`, `raw replay`, `raw payload`, `Replay payload`, `Load raw replay`, `Object ID`, `manual ID`, `manual .*loader`, `direct id loading`, and `debug-only`;
- naming guard tests that prevent historical subsystem naming from returning;
- focused API Spec/Plan tests;
- focused Web Spec/Plan route tests;
- Web typecheck/build for the implementation plan.

## Acceptance Criteria

- Product users can complete Spec approval from Work Item scoped and direct Spec routes.
- Product users can complete Plan approval from Work Item scoped and direct Plan routes.
- Plan creation is impossible before approved Spec, both in UI and backend.
- Submitted artifacts always have a current revision.
- Request changes always records a human-readable reason.
- Approval can record a human-readable reason.
- Decision summaries are visible through replay/timeline read models.
- Approved Plan handoff leads to the Packages readiness route using the approved revision id.
- No disabled placeholder approval controls remain on product Spec/Plan pages.
- No raw/debug loader, compatibility alias, legacy route, or old naming workaround is added.

## Implementation Boundaries for the Plan

The implementation plan should keep this as one shippable slice with clear checkpoints:

1. Backend DTO and gate tightening.
2. Decision evidence and replay coverage.
3. Web command hooks and query invalidation.
4. Work Item scoped lifecycle UI.
5. Direct Spec/Plan lifecycle UI.
6. Focused tests and no-legacy guards.

Do not combine this with broader package execution or automation runtime work. Those remain separate specs/plans.
