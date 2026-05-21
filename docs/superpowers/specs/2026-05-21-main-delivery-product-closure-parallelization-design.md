# Main Delivery Product Closure Parallelization Design

## Status

User-approved coordination design draft. This document defines how to split the next main-product closure work into parallel implementation streams without preserving historical baggage or creating overlapping ownership.

This is a coordination spec. It does not replace the child specs:

- `2026-05-21-delivery-action-decision-ux-closure-design.md`
- `2026-05-21-typed-work-item-intake-design.md`

## Context

ForgeLoop has recently closed several important mainline gaps:

- Product routes exist for Lanes, Work Items, Specs, Plans, Packages, Runs, Reviews, and Releases.
- Work Item detail has become a typed Delivery Cockpit backed by backend-owned readiness.
- Product Lanes replaced the coarse historical Workbench model.
- ProductAction exists as the single action projection for lane and Work Item next actions.
- Release, Review, Package, and Run pages have object-specific command surfaces.

The main product gap is now not object existence. The gap is product completeness:

- The Delivery Cockpit can explain readiness and route users to the next object, but the decision/action experience after Package, Review, QA/Test, and Release is still uneven.
- Work Item creation still uses a generic form despite the PRD's typed Work Item model: Initiative, Requirement, Bug, and Tech Debt have different intake semantics.
- UI polish should continue, but broad visual rewrites across the same pages touched by the two product streams would create conflicts and delay closure.

The user direction is explicit:

- Do not start Evolution Loop / Retrospective work yet.
- Focus on the main delivery workflow.
- Do not keep compatibility shims, historical aliases, old Workbench vocabulary, or coarse Work Item Owner product surfaces.
- Avoid touching the parallel `feature/codex-generation-runtime-plan-package` worktree.

## Goal

Enable two developers to work in parallel on the next product closure slice:

1. Delivery Action & Decision UX Closure.
2. Typed Work Item Intake.

The two streams must be independently implementable, testable, reviewable, and mergeable. Shared surfaces must have a single owner to prevent conflicting changes.

## Non-Goals

- No Evolution Loop, Retrospective, Replay Diagnose Learn Codify Improve product implementation.
- No new broad automation daemon or runtime execution architecture.
- No compatibility endpoint, route alias, adapter shim, double-read path, or fallback query for old Workbench or Work Item Owner concepts.
- No full Test Center.
- No new route families such as `/requirements/:id` or `/bugs/:id`.
- No broad all-page UI rewrite while the two product streams are in flight.
- No changes to the parallel `feature/codex-generation-runtime-plan-package` worktree.

## Work Streams

### Stream A: Delivery Action & Decision UX Closure

Primary purpose:

Make the second half of the main delivery path executable and state-aware from product pages:

Work Item Cockpit -> Package -> Run -> Review Packet -> QA/Test acceptance -> Release readiness.

Stream A owns:

- ProductAction command boundary for delivery actions.
- Package action gating and command affordances.
- Review Packet decision forms.
- QA/Test acceptance handoff surfaces.
- Release action rail state gating and decision forms.
- Work Item next-action behavior when it points into Package, Review, QA/Test, or Release.
- Tests proving a user can complete the post-plan delivery decision path without Dev Tools or raw IDs.

### Stream B: Typed Work Item Intake

Primary purpose:

Make Work Item creation reflect the PRD's typed Work Item model instead of one generic owner form.

Stream B owns:

- Type-specific intake form architecture.
- Work Item Driver language and UI copy.
- Type-specific fields for Initiative, Requirement, Bug, and Tech Debt.
- Typed intake normalization into canonical Work Item data and structured intake context.
- Post-create routing into the correct Product Lane and Work Item Cockpit.
- Tests proving typed intake creates valid Work Items without exposing `work-item-owner`.

### Stream C: UI Cleanliness Closure

Stream C is not a third simultaneous implementation branch across all pages.

It has two phases:

1. During Streams A and B, only shared UI primitives and local page polish required by those streams may be changed.
2. After Streams A and B merge, a separate UI cleanup pass can unify spacing, responsive behavior, action rail consistency, empty states, and visual QA across all product pages.

This avoids three branches editing the same Package, Review, Release, Work Item, and shared layout files at the same time.

## Ownership Matrix

| Area | Stream A | Stream B | Shared / Coordination Rule |
| --- | --- | --- | --- |
| `packages/contracts/src/api.ts` ProductAction command union | Read-only; use existing commands only | Read-only for ProductAction | No ProductAction union changes during parallel A/B work |
| Work Item create DTO and validation | Read-only | Owns typed intake payload changes | B owns create semantics |
| Work Item domain/API Driver naming | Read-only | Owns destructive product-facing Driver naming cleanup | B must land before A consumes renamed Work Item driver fields |
| Work Item Delivery Cockpit page | Owns action rail and delivery next-action behavior | Read-only | B routes newly created Work Items into cockpit but does not render typed intake there |
| Package page | Owns | Avoid | A only |
| Run Console | Owns only if command handoff requires it | Avoid | A only |
| Review Packet page | Owns | Avoid | A only |
| Release pages | Owns | Avoid | A only |
| Work Item create page | Avoid | Owns | B only |
| Product Lanes queue projection | Owns only delivery action rows | Read-only | B uses existing kind-to-lane mapping for post-create routing |
| Shared UI primitives | Minimal, with tests | Minimal, with tests | Prefer additive primitives; no broad redesign |
| Global CSS/theme/tokens | Avoid unless required for bug fix | Avoid unless required for typed form layout | Save broad polish for Stream C |
| E2E route smoke | Owns delivery path scenarios | Owns typed create scenario | Final UI pass may expand screenshots |

## Dependency Rules

Streams A and B can start from the same current `main` if they respect ownership.

Hard dependencies:

- Stream A must not depend on any unmerged code in `feature/codex-generation-runtime-plan-package`.
- Stream B must not add a coarse Work Item Owner abstraction to unblock typed intake.
- Stream C broad polish must wait until A and B merge.

Soft dependencies:

- B owns the destructive product/API migration from coarse Work Item owner language to Driver language. If A needs those fields, merge B first or rebase A after B lands.
- B must not edit Work Item Cockpit typed brief rendering during parallel work. Typed intake visibility in the cockpit is deferred to Stream C or a post-merge typed brief slice.
- Stream A must not extend ProductAction command schemas during parallel A/B work. If a new delivery command becomes mandatory, pause parallel work and create a separate contract-first coordination slice.
- If both streams need new shared UI primitives, create small additive components with tests and avoid editing existing component semantics.

## Branch And Worktree Plan

Use two implementation branches:

- `feature/delivery-action-decision-ux-closure`
- `feature/typed-work-item-intake`

Recommended worktree layout:

- `.worktrees/feature/delivery-action-decision-ux-closure`
- `.worktrees/feature/typed-work-item-intake`

Do not reuse or modify:

- `.worktrees/feature/codex-generation-runtime-plan-package`

## Merge Strategy

Preferred order:

1. Merge Stream B first when it changes shared Work Item Driver naming or create DTO contracts.
2. Merge Stream A first only if Stream B stays confined to Web form architecture and does not touch shared Work Item driver fields.
3. After both merge, sync `main`.
4. Start Stream C UI cleanup from updated `main`.

Conflict policy:

- Do not resolve conflicts by restoring old Workbench, Work Item Owner, or compatibility vocabulary.
- Do not add temporary fallback routes or compatibility query helpers to make merge easier.
- If a shared contract conflict appears, choose the forward product model and update consumers in the same branch.

## Shared Product Constraints

All streams must preserve these constraints:

- Work Item is typed: Initiative, Requirement, Bug, Tech Debt.
- Product Lanes remain the user-facing work entry model.
- Work Item Driver language replaces coarse Work Item Owner language in active product UI and product-facing APIs touched by these streams.
- ProductAction remains the only lane/cockpit action descriptor.
- ProductAction command union remains unchanged during these two parallel implementation streams.
- Complex decisions that require rationale, evidence, or confirmation must use dedicated product forms rather than generic raw command buttons.
- Dev Tools remain for debugging only and must not be required for the main delivery path.
- Approved revision handoff remains strict; no fallback to current revision.
- No product route, API, query key, component, or fixture may introduce `work-item-owner` as an active concept.
- Typed intake context display inside Work Item Cockpit is explicitly deferred until after A/B merge.

## UI Policy During Parallel Work

Streams A and B may polish the pages they directly own, but must follow the existing product UI architecture:

- Use `shared/layout` and `shared/ui` primitives.
- Keep object detail actions in the Action Rail.
- Use drawers/dialogs for bounded forms.
- Avoid raw JSON in product pages.
- Avoid card-in-card composition.
- Ensure mobile layouts avoid horizontal scroll.
- Do not introduce a second styling system.

Stream C later owns:

- Page spacing consistency.
- Action Rail visual consistency.
- Table/list density cleanup.
- Empty, loading, error, and disabled states across pages.
- Playwright screenshot QA for the main product pages.

## Verification Expectations

Each child stream must provide:

- Contract tests for schema changes.
- Domain or query tests for backend derivation changes.
- Web unit tests for page/action behavior.
- At least one route-level or E2E smoke covering the main user path affected by the stream.
- Naming guard updates if historical vocabulary is removed or could regress.

Final product closure acceptance requires:

- A new typed Work Item can be created for each kind and opens the correct lane/cockpit context.
- A planned Work Item can proceed through package readiness, run launch, review decision, QA/Test acceptance handoff, and release readiness without Dev Tools.
- No active product surface exposes Work Item Owner as the organizing concept.
- No compatibility shim remains for old Workbench or legacy lane routes.
