# Delivery Action & Decision UX Closure Design

## Status

User-approved child design draft under `2026-05-21-main-delivery-product-closure-parallelization-design.md`.

This spec defines Stream A: completing the product action and decision experience from approved planning through release readiness.

## Context

ForgeLoop already has the main delivery objects and routes:

- Work Item Delivery Cockpit with backend-owned readiness.
- ProductAction projection for lane and cockpit actions.
- Package detail with mark-ready, run, rerun, force-rerun, and edit controls.
- Run Console with stream, operator input, cancel, and resume.
- Review Packet detail with approve and request-changes controls.
- Release Cockpit with edit, submit, approve, override, request changes, test acceptance, observing, evidence, and close controls.
- Codex Runtime Distribution and Docker Worker control-plane support now exists for runtime profiles, credential bindings, worker registrations, runtime status, and launch leases.

The product gap is consistency and closure:

- Some next actions are commands, but responsibility-lane actions often navigate without explaining the exact decision the user must complete.
- Package action buttons are not fully state-aware in the UI.
- Run actions do not yet explain Codex runtime readiness blockers such as missing runtime profile, missing credential binding, no compatible online worker, Docker policy mismatch, or launch prerequisite failure.
- Review decisions use hardcoded summaries and generic requested-change payloads.
- QA/Test acceptance is present on Release pages but not clearly connected to Work Item quality-gate readiness.
- Release actions are available as a long command list instead of a state-aware decision rail.
- A user can still need product knowledge to decide which action is valid.

## Goal

Make the post-planning delivery path executable through product-grade actions and decision forms:

Work Item Cockpit -> Package -> Run -> Review Packet -> QA/Test acceptance -> Release readiness.

The user should understand:

- what action is available;
- why it is available or blocked;
- what evidence/rationale is required;
- what object will change;
- where to inspect the result.

## Non-Goals

- No Evolution Loop, Retrospective, or Observation implementation.
- No full Test Center.
- No new execution runtime or generation runtime architecture. This stream consumes the merged Codex runtime readiness/status model but does not redesign runtime profiles, credentials, workers, launch leases, Docker policy, or app-server execution.
- No broad Work Item intake redesign.
- No generic command runner.
- No raw JSON or Dev Tools dependency for the main path.
- No compatibility route, old Workbench alias, or Work Item Owner action surface.
- No inline release override or force-rerun shortcut from Work Item Cockpit; high-risk decisions remain on the owning object page.

## Product Decisions

### ProductAction Boundary

ProductAction remains the single action descriptor for Product Lanes and Work Item Cockpit.

Allowed command actions should remain limited to bounded actions with no rich human decision payload:

- `generate_spec_draft`
- `generate_plan_draft`
- `generate_packages`
- `mark_package_ready`
- `run_package`

During the parallel A/B implementation window, this stream must not add new ProductAction command variants. It must use existing command actions for direct cockpit/lane execution and navigate actions for everything else.

`rerun_package` and `force_rerun_package` stay on the Package page for this stream. `force_rerun_package` requires a human rationale and must not become a ProductAction command.

Actions requiring rationale, evidence, requested-change details, blocker snapshots, or confirmation must be navigate actions into the owning object page:

- Review approve / request changes.
- QA/Test acceptance.
- Release submit / approve / override approve / request changes / start observing / close.
- Force rerun.

### Work Item Cockpit Next Actions

Work Item Cockpit remains the cross-role guidance surface. It should not become an all-command dashboard.

Responsibility-lane actions should be explicit:

- Execution Owner:
  - run the package when the selected package is ready and has no selected run;
  - open Package actions when rerun, force rerun, active-run conflict, or package edit is required.
- Reviewer:
  - open Review decision when a Review Packet is available and awaiting human decision;
  - open Work Item or Package blocker context when no review packet exists.
- QA/Test Owner:
  - open Quality Gate context when upstream checks are incomplete;
  - open Release Test Acceptance when a linked Release is waiting for QA acceptance.
- Release Owner:
  - open Release readiness when a linked Release exists;
  - open Release inventory/create flow when handoff is expected but no Release is linked.

The action label and description must tell the user what decision is expected, not only which page opens.

### Package Action Gating

Package detail must compute a local action model from the package, current/last run, review state when available, and command pending state.

State-aware behavior:

- `Mark ready` enabled only when the package is draft or changes requested and the expected version matches.
- `Run` enabled only when the package is ready, no active run exists, and no current open review blocks replacement.
- `Rerun` enabled only when a previous run exists and normal rerun validation can pass.
- `Force rerun` enabled only when a previous run exists, a non-empty rationale is provided, and the current state allows replacement.
- Edit package details remains available only before execution has started or when gate state is changes requested.
- Codex runtime readiness must be included for `local_codex` run actions. If runtime profile, credential, worker, Docker capability, or launch prerequisites are missing, the run action is disabled with a public-safe blocker reason. The UI may link to an existing owning setup/remediation surface when one exists, but this stream must not create a new runtime preflight or remediation architecture.
- Runtime readiness display must not expose raw auth, raw config, lease tokens, worker session tokens, local paths, raw logs, or Docker command internals.
- The package page may consume a public-safe runtime readiness projection. That projection must be read-only mapping over existing runtime status/readiness data. Browser code must not call internal setup, credential, worker, launch, or lease endpoints directly.

Disabled actions must show concise reasons. Do not hide blocked actions when the reason teaches the user how to proceed.

### Review Decision UX

Review Packet detail must replace hardcoded decisions with a decision form.

Approve form:

- requires a review summary;
- records `reviewed_by_actor_id`;
- records `reviewed_at`;
- allows optional reviewer notes if supported by the API contract.

Request changes form:

- requires a summary;
- requires at least one requested change;
- each requested change has title, description, severity;
- supports add/remove/edit rows;
- validates before submit;
- shows the impact on package/review readiness after success.

Decision availability:

- Approve and request changes are disabled for completed, archived, or superseded review packets.
- If review evidence is incomplete, the page explains whether the reviewer can still decide or must return to Package/Run evidence first.

### QA / Test Acceptance UX

QA/Test Owner work in this slice is bounded to quality-gate and release-test handoff.

The product must expose:

- Work Item Quality Gate blockers and evidence from the cockpit.
- A clear path to the Release page when QA/Test acceptance must be acknowledged.
- Release Test Acceptance form with summary and evidence refs.
- State-aware disabled reasons when upstream delivery readiness is incomplete.

This does not create a standalone Test Center or test case database.

### Release Action Rail UX

Release Action Rail must become a state-aware decision rail instead of a long always-visible command list.

The rail should group actions:

- Edit planning details.
- Submit for approval.
- Approval decision.
- QA/Test acceptance.
- Observation transition.
- Close release.

Each group should show only the active primary decision and relevant secondary actions, with disabled reasons for blocked actions.

Rules:

- Submit is enabled only for draft/candidate states that have required scope and planning details.
- Approve is enabled only when submitted and no blocking readiness blockers remain.
- Override approve requires blockers, blocker snapshot, non-empty rationale, and danger confirmation.
- Request changes requires non-empty rationale and is available only during approval-oriented phases.
- Start observing requires approved or override-approved release state.
- Close requires valid terminal resolution, summary when required, confirmation text, and observation requirements unless an explicit override path is supported.

### Error Handling

All command forms must:

- show validation errors before submit;
- show API errors inline near the action;
- preserve user-entered rationale/evidence on failure;
- invalidate object detail, replay, Product Lanes, and Work Item Cockpit caches after mutation;
- avoid duplicate submits while pending.

### UI Layout

Use existing primitives:

- `ActionRail` for decision actions.
- `Drawer` or local form sections for bounded edit/decision forms.
- `Button`, `Textarea`, `Input`, `Select`, `StatusPill`, `Badge`, `DataTable`.

Do not introduce a new global styling system. Local page polish is allowed where it supports this stream.

## Technical Scope

Likely files:

- `packages/db/src/queries/product-action-builders.ts`
- `packages/db/src/queries/work-item-delivery-readiness.ts`
- `packages/db/src/queries/product-lane-queries.ts`
- `apps/control-plane-api/src/modules/query/*` only if a public-safe Codex runtime readiness projection is needed for Web delivery pages; this is projection/mapping only, not runtime setup or remediation ownership
- `apps/web/src/shared/api/hooks.ts`
- `apps/web/src/shared/api/query-keys.ts`
- `apps/web/src/features/product-actions/product-action-list.tsx`
- `apps/web/src/features/work-items/work-item-detail.tsx`
- `apps/web/src/features/work-items/delivery-cockpit/*`
- `apps/web/src/features/execution-packages/execution-package-routes.tsx`
- `apps/web/src/features/review-packets/review-packet-routes.tsx`
- `apps/web/src/features/releases/release-routes.tsx`

Avoid:

- `apps/web/src/features/work-items/create-work-item-form.tsx`
- Work Item create DTO changes.
- `packages/contracts/src/api.ts` ProductAction command union changes during parallel A/B work.
- `apps/control-plane-api/src/modules/codex-runtime/*` command/setup/worker/launch semantics.
- `packages/db/src/schema/codex-runtime.ts`.
- `packages/domain/src/codex-runtime.ts` runtime policy semantics.
- Broad shared theme rewrites.

## Data And Cache Invalidation

Mutations should invalidate:

- owning object detail query;
- owning object replay query where available;
- related Work Item Cockpit all-lane variants;
- Product Lane project queries;
- Release cockpit/replay for release mutations;
- package/run/review registries affected by status changes.

Cache invalidation must not rely on a single lane variant of Work Item Cockpit. Any mutation with a Work Item id must invalidate all cached cockpit variants for that Work Item.

## Testing

Required tests:

- Contract tests only if this stream changes non-ProductAction response schemas; ProductAction command union changes are out of scope during parallel A/B work.
- DB query tests for next-action derivation in reviewer, QA/Test Owner, release-owner, and execution-owner lanes.
- Web tests for Package action gating.
- Web/API tests for public-safe Codex runtime readiness blockers in run/rerun/force-rerun actions.
- Web tests for Review decision form validation and submit payloads.
- Web tests for Release action rail state-aware enabled/disabled behavior.
- Web tests for Work Item Cockpit next actions routing into Package/Review/Release decisions.
- At least one smoke/E2E route test covering post-plan package -> run -> review -> release readiness navigation.

## Acceptance Criteria

- A user can follow Work Item Cockpit next actions through package execution, review decision, QA/Test handoff, and release readiness without Dev Tools.
- Package buttons expose valid actions only and explain invalid ones.
- Package run actions include public-safe Codex runtime readiness blockers when local Codex execution cannot start.
- Review decisions no longer use hardcoded summaries or generic fixed requested-change payloads.
- Release action rail shows state-aware decisions and required rationales/evidence.
- ProductAction remains bounded and unchanged; complex human decisions stay on object pages.
- No Work Item Owner or old Workbench vocabulary is introduced.
