# Delivery Cockpit Execution Review QA Design

## Status

User-approved design draft. This document defines the next product slice for completing the main delivery path from approved planning through execution, review, quality gate readiness, and release readiness.

This slice is intentionally focused on the delivery mainline:

Work Item -> Spec -> Plan -> Execution Package -> Run -> Review Packet -> Quality Gate -> Release Readiness.

It does not implement Observation, Retrospective, or the Evolution Loop. It does not rebuild every page in the Web app. It does make the Work Item detail page a product-grade, typed Delivery Cockpit with a first-class readiness read model and a substantially improved layout.

## Context

ForgeLoop now has product routes for Work Items, Specs, Plans, Packages, Runs, Reviews, and Releases. Recent work tightened Spec/Plan approval and package handoff so package generation must use approved revisions, not current revision fallbacks.

The current Work Item detail route is still a summary page:

- It shows generic overview metrics, brief, Spec/Plan status, package objective list, run/review counts, timeline, and a placeholder evidence sentence.
- It does not show the full delivery mainline as stages.
- It does not explain where a Work Item is blocked, which lane owns the blocker, or what evidence proves readiness.
- It renders Requirement, Bug, Tech Debt, and Initiative with the same brief structure.
- It relies on separate pages for package, run, review, and release details, but the Work Item page does not orchestrate those surfaces into a clear delivery cockpit.

The backend already has useful building blocks:

- Work Item cockpit query with current Spec, current Plan, packages, run sessions, review packets, and completion state.
- Product Lane actions for typed Work Item and responsibility-lane entry points.
- Execution Package lifecycle commands and package/run/review routes.
- Release cockpit, blockers, release evidence, and Test/Acceptance gate logic.

The product gap is not that these objects are missing. The gap is that readiness is not a first-class product contract and the Work Item page does not present the end-to-end delivery decision clearly.

## Goals

- Make `/work-items/:workItemId` a typed Delivery Cockpit, not a generic summary page.
- Introduce a first-class Work Item delivery readiness read model owned by backend query logic.
- Show the delivery mainline as structured stages:
  - Spec
  - Plan
  - Packages
  - Execution
  - Review
  - Quality Gate
  - Release Readiness
- Make Work Item presentation type-aware:
  - Requirement highlights scope, acceptance criteria, and success criteria.
  - Bug highlights impact, reproduction context, fix verification, and regression focus.
  - Tech Debt highlights technical risk, payoff, validation, and rollback focus.
  - Initiative highlights scope, milestone intent, linked work breakdown, and cross-item coordination.
- Make Product Lane presentation responsibility-aware:
  - Execution Owner sees package/run blockers.
  - Reviewer sees Review Packet decisions and requested changes.
  - QA / Test Owner sees Quality Gate blockers and acceptance gaps.
  - Release Owner sees Release Readiness blockers and release handoff.
  - Manager gets read-only health, blocker, and drill-down context.
- Improve UI information architecture, visual hierarchy, and scanability for the Work Item delivery page.
- Keep deep operations on dedicated package, run, review, and release routes.
- Preserve the clean, product-grade frontend architecture and design system already introduced.
- Avoid all historical naming baggage, compatibility shims, and coarse owner concepts.

## Non-Goals

- No Observation implementation.
- No Retrospective or Evolution Loop implementation.
- No full Test Center implementation with test case, test plan, and test execution asset management.
- No generic workflow engine rebuild.
- No separate route families such as `/requirements/:id` or `/bugs/:id`.
- No broad all-page UI redesign in this slice.
- No frontend-only readiness derivation as the source of truth.
- No compatibility alias, fallback, or adapter for legacy workbench naming.
- No coarse owner page concept for Work Items.
- No legacy priority-code subsystem naming in active product code or new documentation.
- No approved-revision fallback to current revision at any delivery handoff.

## Product Decisions

### Primary Entry

The primary entry is the canonical Work Item detail route:

`/work-items/:workItemId`

The route stays canonical because Work Item is the cross-role business object. The page becomes typed and lane-aware instead of generic.

The route may accept the existing `lane` query parameter. If no lane is provided, the default lane is derived from Work Item kind:

- `requirement` -> `requirements`
- `bug` -> `bugs`
- `tech_debt` -> `tech-debt`
- `initiative` -> `initiatives`

Responsibility lanes can also open the same Work Item cockpit with their own perspective:

- `execution-owner`
- `reviewer`
- `qa-test-owner`
- `release-owner`
- `manager`

### Backend Readiness Contract

Delivery readiness is a backend read model, not a frontend aggregation trick.

The Work Item cockpit response gains:

```ts
delivery_readiness: WorkItemDeliveryReadiness
```

`WorkItemDeliveryReadiness` is the authoritative product contract for staged delivery state, blockers, evidence, degraded sources, and lane-aware next actions.

The frontend may map state to layout and visual tone, but it must not invent readiness rules from raw packages, runs, reviews, or releases.

### Quality Gate Scope

This slice implements Quality Gate readiness, not a full Test Center.

Quality Gate readiness answers:

- Does the Work Item have an approved Spec with test strategy and acceptance criteria?
- Does the Work Item have an approved Plan with a test matrix?
- Are all generated packages tied to the approved Spec and Plan revisions?
- Are required checks passing or accounted for?
- Are required artifacts present?
- Are Review Packets approved or still blocking?
- Is release test acceptance evidence present where a release is linked?
- Are active release/test blockers cleared or explicitly acknowledged by governed release logic?

### Release Scope

This slice reaches pre-release Release Readiness. It does not implement post-release observation and must not depend on observation evidence, observing state, release close state, or post-release incident follow-up.

Release Readiness answers:

- Is there a linked release once release handoff is expected?
- Are linked Work Items and Execution Packages reflected in release scope?
- Are pre-release release blockers present?
- Is Quality Gate readiness satisfied for the release scope?
- Can the Release Owner move to the release approval path, or is the Work Item still blocked before release?

Release handoff is expected when Quality Gate has passed for at least one execution package in the Work Item's current approved-plan package set, or when a Release is already linked to the Work Item or one of those packages. Before that point, missing release linkage is not itself a blocker; the Release Readiness stage should be `not_applicable` or blocked only by upstream stage blockers.

When release handoff is expected and no release is linked, Release Readiness is `missing` with a primary action to create or link a release. It is not `ready`.

When a release is linked before Quality Gate passes, Release Readiness is `blocked` by upstream Quality Gate blockers, even if the linked release itself has no blockers.

This slice consumes only pre-release scope, readiness, Test/Acceptance, approval-handoff, and release blocker data. Observation evidence and post-release blockers are out of scope for this cockpit.

## Read Model Contract

### Types

The shared contract should expose a schema similar to:

```ts
type DeliveryOverallState =
  | 'not_started'
  | 'blocked'
  | 'in_progress'
  | 'ready_for_release'
  | 'released';

type DeliveryStageId =
  | 'spec'
  | 'plan'
  | 'packages'
  | 'execution'
  | 'review'
  | 'quality_gate'
  | 'release_readiness';

type DeliveryStageState =
  | 'missing'
  | 'blocked'
  | 'ready'
  | 'running'
  | 'passed'
  | 'failed'
  | 'not_applicable';

interface WorkItemDeliveryReadiness {
  work_item_id: string;
  work_item_kind: WorkItemKind;
  active_lane: ProductLaneId;
  overall_state: DeliveryOverallState;
  stages: DeliveryStage[];
  blockers: DeliveryBlocker[];
  evidence: DeliveryEvidence[];
  next_actions: ProductAction[];
  degraded_sources: string[];
}

interface DeliveryStage {
  id: DeliveryStageId;
  label: string;
  state: DeliveryStageState;
  owner_lane: ProductLaneId;
  object_refs: DeliveryObjectRef[];
  blockers: DeliveryBlocker[];
  evidence_refs: DeliveryEvidenceRef[];
  primary_action?: ProductAction;
}

interface DeliveryBlocker {
  id: string;
  code: string;
  severity: 'info' | 'warning' | 'blocking';
  message: string;
  owner_lane: ProductLaneId;
  object_ref?: DeliveryObjectRef;
}

interface DeliveryObjectRef {
  object_type:
    | 'work_item'
    | 'spec'
    | 'spec_revision'
    | 'plan'
    | 'plan_revision'
    | 'execution_package'
    | 'run_session'
    | 'review_packet'
    | 'release'
    | 'decision'
    | 'artifact';
  object_id: string;
  href?: string;
  label?: string;
}

interface DeliveryEvidenceRef {
  evidence_id: string;
  object_ref: DeliveryObjectRef;
}

interface DeliveryEvidence {
  id: string;
  kind:
    | 'approved_spec_revision'
    | 'approved_plan_revision'
    | 'execution_package'
    | 'run_session'
    | 'review_packet'
    | 'check_result'
    | 'artifact'
    | 'release'
    | 'release_evidence'
    | 'decision';
  label: string;
  object_ref: DeliveryObjectRef;
  status?: string;
  summary?: string;
  created_at?: string;
}
```

Exact naming can follow existing contract conventions, but the response must preserve these semantics.

### Stage Semantics

#### Spec

Passed only when the current Spec is approved and:

- `approved_revision_id` is set;
- `current_revision_id === approved_revision_id`;
- test strategy summary is present;
- acceptance criteria are present.

Blocked if the Spec is missing, has no current revision, is not approved, or is approved without a valid approved revision.

#### Plan

Passed only when the current Plan is approved and:

- `approved_revision_id` is set;
- `current_revision_id === approved_revision_id`;
- the approved Plan is based on the approved Spec revision;
- test matrix is present;
- rollback notes are present.

Blocked if the Plan is missing, has no current revision, is not approved, or does not align to the approved Spec.

#### Packages

The package set is the execution packages returned for the Work Item that belong to the current approved Plan revision. If older packages exist for stale Plan revisions, they may be shown as evidence but must not satisfy readiness for the current handoff.

Passed when at least one current package exists and all current package handoffs reference the approved Spec and Plan revisions.

Blocked when:

- no packages exist after approved Plan;
- any package references stale or missing approved revisions;
- a package is draft and needs to be marked ready;
- a package has a blocking reason.

#### Execution

Required packages are the current approved-plan package set from the Packages stage.

Passed when required packages have completed successful latest runs or have acceptable governed state.

Running when latest run sessions are queued, active, or waiting for input.

Blocked when:

- ready packages have not been run;
- latest run failed;
- run metadata indicates stalled worker lease or terminal failure;
- required check results are missing or failed.

#### Review

Passed when relevant Review Packets are approved.

Blocked when:

- a run completed but no Review Packet is available;
- any Review Packet is ready or in review;
- any Review Packet requested changes;
- review evidence is degraded or incomplete.

#### Quality Gate

Passed when the Work Item and packages have adequate validation evidence:

- Spec test strategy exists;
- Spec acceptance criteria exist;
- Plan test matrix exists;
- package `required_checks` that block review have corresponding latest run check results that passed or are represented as governed blockers;
- package `required_artifact_kinds` are present in latest run artifacts, review evidence, or release Test/Acceptance evidence where the release scope exists;
- Review Packets are approved;
- linked release Test/Acceptance blockers are clear where applicable.

Blocked when any required validation evidence is missing or failing.

#### Release Readiness

Release Readiness is evaluated only against pre-release release data: linked release scope, pre-release blockers, Test/Acceptance gate evidence, and release approval-handoff readiness.

Ready when Quality Gate passed and a linked release has no active pre-release readiness blockers for this Work Item/package scope.

Blocked when:

- upstream Quality Gate has not passed and a release is already linked;
- release scope omits the Work Item or package;
- active pre-release blockers remain;
- release Test/Acceptance is not acknowledged where required;
- release readiness depends on degraded data.

Missing when:

- release handoff is expected and no release is linked.

Not applicable when:

- release handoff is not yet expected and no release is linked.

When multiple conditions apply, Release Readiness uses this precedence:

1. Degraded release or Test/Acceptance source -> `blocked`.
2. Linked release exists but upstream Quality Gate has not passed -> `blocked`.
3. Release handoff is expected and no release is linked -> `missing`.
4. Linked release scope omits the Work Item or required package -> `blocked`.
5. Linked release has active pre-release blockers -> `blocked`.
6. Linked release satisfies scope, Quality Gate, and pre-release blockers -> `ready`.
7. No linked release and release handoff is not yet expected -> `not_applicable`.

## Data Flow

The read model follows a single directional aggregation:

Work Item -> approved Spec -> approved Plan -> Execution Packages -> Run Sessions -> Review Packets -> Quality Gate -> Release Readiness.

Backend query logic collects:

- current Work Item;
- current Spec and current approved Spec revision;
- current Plan and current approved Plan revision;
- packages for the Work Item;
- run sessions for those packages;
- review packets for those packages;
- release records linked to the Work Item or its packages;
- pre-release release blocker and Test/Acceptance gate evidence;
- timeline or decision evidence only where needed for stage summaries.

If any downstream query fails, the response should include `degraded_sources`. A degraded source cannot be treated as ready. The UI shows the affected source explicitly.

## Product Actions

The cockpit action rail uses `delivery_readiness.next_actions`.

Actions remain lane-aware:

- Planning lanes open Spec/Plan flow or generate missing drafts where existing rules allow.
- Execution Owner lane can mark package ready, run package, or open run console.
- Reviewer lane can open Review Packets and requested-change context.
- QA / Test Owner lane can open Quality Gate blockers and release Test/Acceptance acknowledgement surfaces.
- Release Owner lane can create/link release or open release readiness.
- Manager lane is read-only and only receives navigate/drill-down actions.

The Work Item cockpit does not absorb every deep operation. It links out to:

- package detail for package editing, rerun, force rerun, and package governance;
- run detail for live run events and operator input;
- review detail for approve/request-changes decisions;
- release detail for scope, blockers, Test/Acceptance acknowledgement, and release approval-handoff actions.

If the backend mistakenly returns a mutating action for `manager`, the frontend must hide or downgrade it and tests must cover the case.

## UI Design

### Design System Direction

The UI should follow the existing product design system:

- calm internal SaaS operations style;
- light background, white surfaces, clear borders;
- 8px or smaller radius for cards and panels;
- semantic status pills and badges;
- dense but readable tables and matrices;
- no decorative gradients, hero sections, orb backgrounds, or marketing composition;
- no emoji icons;
- no card-in-card layout;
- no color-only state indication.

`ui-ux-pro-max` analysis supports this direction: a professional SaaS dashboard should prioritize scanability, contrast, explicit state labels, keyboard accessibility, loading feedback, and stable layout.

### Current Page Problems

The existing Work Item detail page should be replaced because:

- It presents a flat sequence of sections instead of the PRD delivery mainline.
- It uses one generic brief for all Work Item kinds.
- It shows package objectives but not package readiness.
- It shows run/review counts but not whether the latest run or review is blocking release.
- Its Evidence section is not an evidence list.
- Its action rail is disconnected from stage-level readiness.
- It does not show QA/Test or Release Readiness as first-class product decisions.

### Target Layout

The Work Item detail page becomes a Typed Delivery Cockpit.

#### Context Header

Shows:

- Work Item title;
- Work Item kind;
- active lane;
- priority;
- risk;
- overall delivery state;
- blocker count;
- last updated timestamp where available.

The subtitle should be kind-aware, not a generic goal-only sentence.

#### Delivery Stage Rail

Shows the seven delivery stages:

Spec -> Plan -> Packages -> Execution -> Review -> Quality Gate -> Release Readiness.

Each stage card or rail item shows:

- label;
- state text;
- owner lane;
- blocker count;
- primary evidence label;
- visual tone.

Status must be readable without color. Use text plus pill/dot/icon where the component system supports it.

Clicking a stage scrolls to the corresponding section or opens the relevant detail route when the stage has a single canonical object.

#### Lane-Aware Action Rail

The right rail shows:

- active lane label and description;
- primary next action;
- secondary actions;
- blocked reasons relevant to the active lane;
- drill-down links.

The rail should not render a long ungrouped list. Primary action is visually dominant; secondary actions are grouped or subdued.

#### Typed Work Item Brief

Requirement:

- goal;
- scope/acceptance emphasis;
- success criteria;
- Spec/Plan state.

Bug:

- impact;
- reproduction or diagnosis context where available;
- fix verification;
- regression focus;
- release risk.

Tech Debt:

- technical risk;
- payoff;
- affected surface;
- validation path;
- rollback focus.

Initiative:

- scope intent;
- milestone or cross-item coordination;
- linked Work Item summary where available;
- readiness of child work.

The initial implementation can use existing fields plus clear labels. It must structure the brief differently per kind even if some fields fall back to available Work Item data.

#### Package Matrix

A scannable matrix shows each package:

- objective;
- owner;
- reviewer;
- QA owner;
- phase;
- gate state;
- latest run state;
- latest review decision;
- blocking reason;
- link to package detail.

On mobile this uses the existing responsive table/card pattern.

#### Execution Summary

Shows:

- latest run per package;
- status;
- failure kind/reason;
- worker lease status where available;
- latest event time;
- link to run console.

#### Review Summary

Shows:

- open reviews;
- review decisions;
- requested changes;
- risk notes;
- review packet links.

#### Quality Gate Panel

Shows:

- required check blockers;
- required artifact blockers;
- Spec test strategy and acceptance readiness;
- Plan test matrix readiness;
- review decision readiness;
- release Test/Acceptance blocker status when linked.

#### Release Readiness Panel

Shows:

- linked releases;
- release scope inclusion;
- blocker fingerprint where available;
- active blockers;
- ready/not-ready reason;
- link to release detail.

### Dedicated Pages

The package, run, review, and release pages remain deep operation pages. They may receive small consistency updates needed for the new cockpit links, but this slice must not become an all-page redesign.

## Error and Degraded States

- Missing route parameter: show the existing invalid route pattern.
- Work Item not found: show empty state.
- Work Item cockpit query failure: show unavailable state.
- Delivery readiness degraded: show the partially available cockpit and a clear degraded-source notice.
- Missing approved Spec: block Plan, Package, Execution, Review, Quality Gate, and Release Readiness.
- Missing approved Plan: block Package, Execution, Review, Quality Gate, and Release Readiness.
- Package revision mismatch: block Packages and all downstream stages.
- Required checks failed: block Quality Gate and Release Readiness.
- Review requested changes: block Review, Quality Gate, and Release Readiness.
- Release has active pre-release blockers: block Release Readiness.
- Release handoff expected but no Release is linked: mark Release Readiness missing and show create/link action.
- No Release linked before handoff is expected: mark Release Readiness not applicable, not blocked.

The UI must not display Ready when a required source is missing, degraded, or stale.

## Implementation Boundaries

The implementation plan should keep files focused:

- `packages/contracts`: Work Item delivery readiness schemas and exported types.
- `packages/db/src/queries/work-item-delivery-readiness.ts`: readiness aggregation, stage derivation, blockers, evidence, and actions.
- `packages/db/src/queries/work-item-cockpit-queries.ts`: attaches delivery readiness to the cockpit response.
- `apps/web/src/features/work-items/work-item-view-model.ts`: adapts typed delivery readiness into display models, without business-rule derivation.
- `apps/web/src/features/work-items/work-item-detail.tsx`: page composition only.
- `apps/web/src/features/work-items/delivery-cockpit/*`: presentational components for stage rail, typed brief, package matrix, quality gate panel, release readiness panel, and action rail.

Do not put readiness business rules in React components.

## Testing

### Read Model Tests

Cover:

- happy path through ready for release;
- missing Spec;
- missing approved Spec revision;
- missing Plan;
- missing approved Plan revision;
- Plan not aligned to approved Spec revision;
- package stale revision mismatch;
- package draft/blocked;
- run missing;
- run failed;
- review missing;
- review requested changes;
- missing required check result;
- missing required artifact;
- linked release with active blockers;
- release handoff expected with no linked release;
- no linked release before handoff is expected;
- linked release ready;
- degraded release/readiness source;
- manager lane receives read-only actions only.

### Contract Tests

Cover:

- readiness response parses through shared contract schemas;
- all stage ids and state enums are accepted;
- degraded sources are serializable;
- ProductAction targets remain compatible with existing web action rendering.

### Web Tests

Cover:

- Requirement brief layout;
- Bug brief layout;
- Tech Debt brief layout;
- Initiative brief layout;
- stage rail renders all seven stages with text labels;
- blockers are visible without relying on color only;
- lane-aware primary action appears in the action rail;
- Manager lane hides or downgrades mutating actions;
- package matrix renders latest run and review state;
- Quality Gate panel shows blockers;
- Release Readiness panel shows linked release and blockers;
- degraded notice appears when `degraded_sources` is non-empty.

### Regression Verification

The implementation must keep existing package, run, review, and release route tests passing.

Expected verification commands for implementation:

- focused DB/query tests for readiness;
- focused Web route/component tests;
- `pnpm --filter @forgeloop/web typecheck`;
- package builds affected by contract/query changes;
- broader `pnpm build` or `pnpm test` when the change touches shared contracts or DB query surfaces.

## Acceptance Criteria

- `/work-items/:workItemId` presents a typed Delivery Cockpit with a stage rail, typed brief, package matrix, execution summary, review summary, Quality Gate panel, Release Readiness panel, and lane-aware action rail.
- Work Item cockpit API returns a structured delivery readiness read model.
- The frontend does not derive readiness business rules from raw objects.
- Quality Gate readiness blocks Release Readiness when validation evidence is missing or failing.
- Release Readiness reaches ready only when linked release scope and blockers are satisfied.
- All blocked states explain the blocker and responsible lane.
- Manager lane remains read-only.
- Existing package, run, review, and release pages remain deep operation pages.
- No legacy workbench, coarse owner, priority-code subsystem, or compatibility naming appears in new active product surfaces.

## Open Questions

None. User decisions for this spec:

- Include Release Readiness, but not Observation or Evolution.
- Use canonical typed Work Item Delivery Cockpit as the primary entry.
- Make delivery readiness a first-class backend read model.
- Implement Quality Gate readiness, not a full Test Center.
- Put main-flow actions in the cockpit while leaving deep operations on dedicated pages.
- Treat UI optimization as a core deliverable for this slice.
