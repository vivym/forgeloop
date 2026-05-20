# Delivery Cockpit Execution Review QA Design

## Status

User-approved design draft. This document defines the next product slice for completing the main delivery path from approved planning through execution, review, quality gate readiness, and release readiness.

This slice is intentionally focused on the delivery mainline:

Work Item -> Spec -> Plan -> Execution Package -> Run -> Review Packet -> Integration Readiness -> Quality Gate -> Release Readiness.

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
  - Integration Readiness
  - Quality Gate
  - Release Readiness
- Make Work Item presentation type-aware:
  - Requirement highlights scope, acceptance criteria, and success criteria.
  - Bug highlights impact, reproduction context, fix verification, and regression focus.
  - Tech Debt highlights technical risk, payoff, validation, and rollback focus.
  - Initiative highlights scope, milestone intent, linked work breakdown, and cross-item coordination.
- Make Product Lane presentation responsibility-aware:
  - Spec Approver sees Spec/Plan approval gaps, risk requirements, and test-strategy gaps.
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
- No broad all-page UI redesign outside the delivery surfaces touched by this slice.
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

- `spec-approver`
- `execution-owner`
- `reviewer`
- `qa-test-owner`
- `release-owner`
- `manager`

### Work Item Kind Applicability

The cockpit is typed in behavior, not only in labels. The read model must derive stage applicability from `work_item.kind`, the current approved-plan package set, and explicit package integration metadata.

Requirement:

- Spec, Plan, Packages, Execution, Review, and Quality Gate are required.
- Integration Readiness is required when the Work Item is high risk, has more than one current package, has package dependencies, or any current package has non-empty `integration_readiness`.
- If Integration Readiness is not required, the stage is `not_applicable`.
- Release Readiness follows the release handoff rules below: it is not applicable before handoff is expected, missing when handoff is expected without a linked Release, blocked when linked Release scope/readiness fails, and ready only when linked pre-release readiness passes.

Bug:

- Spec and Plan are still represented because the product flow remains Spec-first and Plan-before-Execution.
- A Bug may have a simplified Spec/Plan shape, but it cannot bypass approved revision handoff for packages.
- Packages, Execution, Review, and Quality Gate are required for fix validation and regression safety.
- Integration Readiness follows the same requirement rule as Requirement, with extra emphasis on regression or cross-end impact recorded in package `integration_readiness`.
- Release Readiness follows the release handoff rules below. It is `not_applicable` until handoff is expected or a Release is already linked.

Tech Debt:

- Spec, Plan, Packages, Execution, Review, and Quality Gate are required.
- Integration Readiness is required when the debt touches multiple packages, shared contracts, migrations, or package `integration_readiness`.
- Release Readiness follows the release handoff rules below. It is `not_applicable` until handoff is expected or a Release is already linked.

Initiative:

- Initiatives are aggregate Work Items unless they have their own approved Plan and current package set.
- If an Initiative has current packages, it follows the same stage rules as Requirement.
- If an Initiative has no current packages, Packages through Release Readiness are `not_applicable` and the cockpit must show an Initiative breakdown/readiness summary instead of pretending the Initiative itself is directly releasable.
- If child Work Item links are available in the repository, the Initiative brief and evidence sections aggregate child readiness. If child links are not available in this slice, the UI must show that child-work aggregation is unavailable rather than deriving false readiness from empty data.

This applicability matrix prevents a generic Work Item page from hiding type-specific workflow differences while preserving one canonical Work Item route.

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
- Are package `required_checks` passing in the selected authoritative run?
- Are package `required_artifact_kinds` present according to `deriveRequiredArtifactPresence` semantics?
- Are Review Packets approved or still blocking?
- Is Integration Readiness passed or not applicable?
- Is release test acceptance evidence present where a release is linked?
- Are active release/test blockers cleared by the pre-release Release Readiness calculation?

### Release Scope

This slice reaches pre-release Release Readiness. It does not implement post-release observation and must not depend on observation evidence, observing state, release close state, or post-release incident follow-up.

Release Readiness answers:

- Is there a linked release once release handoff is expected?
- Are linked Work Items and Execution Packages reflected in release scope?
- Are pre-release release blockers present?
- Is Quality Gate readiness satisfied for the release scope?
- Can the Release Owner move to the release approval path, or is the Work Item still blocked before release?

This slice supports full Work Item release readiness. Partial release readiness is not considered ready in this cockpit. If a linked Release omits any required package from the current approved-plan package set, Release Readiness is blocked with a partial-scope blocker.

Release handoff is expected when Quality Gate has passed for every required package in the Work Item's current approved-plan package set, or when a Release is already linked to the Work Item or one of those packages. Before that point, missing release linkage is not itself a blocker; the Release Readiness stage should be `not_applicable` or blocked only by upstream stage blockers.

When release handoff is expected and no release is linked, Release Readiness is `missing` with a primary navigation action to the Release surface where the user can create or link a release. It is not `ready`.

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
  | 'integration_readiness'
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
    | 'package_dependency'
    | 'run_session'
    | 'review_packet'
    | 'release'
    | 'release_evidence'
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
    | 'integration_readiness'
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

The implementation should add explicit shared schemas:

- `workItemDeliveryReadinessSchema`
- `deliveryStageSchema`
- `deliveryBlockerSchema`
- `deliveryEvidenceSchema`
- `workItemCockpitResponseSchema`

These schemas should live in a focused contracts module such as `packages/contracts/src/work-item-delivery-readiness.ts` and be exported through `packages/contracts/src/index.ts`. If the implementation keeps them in `packages/contracts/src/api.ts` for consistency with current ProductAction contracts, the exported names above still apply.

The loose Web-only `CockpitResponse` type must be replaced by the shared contract type. The old `next_actions: string[]` field on Work Item cockpit responses must not remain as a parallel public action source; `delivery_readiness.next_actions` is authoritative.

### Stage State Semantics

`DeliveryStage.state` has one meaning across all stages:

- `not_applicable`: the stage is not required for this Work Item kind and current scope.
- `missing`: a required object or handoff is absent after upstream prerequisites are satisfied. Examples: no current Spec, no current Plan after approved Spec, no current packages after approved Plan, no linked Release after release handoff is expected.
- `ready`: prerequisites are satisfied and a lane action can start or continue the stage, but the stage is not complete. Examples: packages are ready to run; a Review Packet is ready for human review.
- `running`: execution, review, or integration work is actively in progress.
- `passed`: the stage has all required evidence for the current scope.
- `failed`: the latest authoritative execution, check, review, or integration evidence ended in a terminal negative state.
- `blocked`: the stage cannot proceed because of stale revisions, unmet dependencies, missing required evidence inside an existing object, degraded required sources, or upstream failed/blocked stages.

Stage derivation must prefer the most specific state:

1. If the stage is not required by kind/scope, `not_applicable`.
2. If a required upstream stage is `failed` or `blocked`, downstream stages are `blocked` with an upstream blocker.
3. If the required object/handoff does not exist after prerequisites pass, `missing`.
4. If the authoritative latest state is terminal negative, `failed`.
5. If work is active, `running`.
6. If prerequisites are satisfied but completion evidence is absent, `ready`.
7. If all completion evidence is present, `passed`.

`DeliveryOverallState` is derived from required stages only:

- `blocked` if any required stage is `failed` or `blocked`.
- `not_started` if Spec is `missing` and no downstream required stage has started.
- `ready_for_release` if all required pre-release stages are `passed` and Release Readiness is `ready` or `passed`.
- `released` only as a read-only display state when a linked Release already indicates released/closed delivery; this slice does not add Observation or post-release behavior.
- `in_progress` otherwise.

### Revision Strictness

The readiness read model must use strict approved-revision checks everywhere:

- Spec is approved only when `status === "approved"`, `resolution === "approved"`, `approved_revision_id` is set, and `current_revision_id === approved_revision_id`.
- Plan is approved only when `status === "approved"`, `resolution === "approved"`, `approved_revision_id` is set, and `current_revision_id === approved_revision_id`.
- Plan must be based on the approved Spec revision.
- Package handoff must reference the current approved Spec and Plan revisions.

Release Test/Acceptance evidence must be derived through a direct strict helper or a refactor of the existing helper so strict Work Item approved-revision checks happen inside the helper contract itself. The readiness read model must not call `deriveReleaseTestAcceptanceGate` directly and must not add a compatibility adapter around it. Any helper path that accepts `approved_revision_id` without checking `current_revision_id === approved_revision_id`, falls back from Work Item current Spec to package Spec, or treats current revisions as approved must not drive this read model.

### Stage Semantics

#### Spec

`passed` only when the current Spec is approved and:

- `approved_revision_id` is set;
- `current_revision_id === approved_revision_id`;
- test strategy summary is present;
- acceptance criteria are present.

`missing` when the Work Item has no current Spec.

`ready` when a Spec exists but still needs draft generation, submission, review, approval, or changes handling.

`blocked` when the Spec is approved without a valid approved revision or lacks required test strategy / acceptance fields.

#### Plan

`passed` only when the current Plan is approved and:

- `approved_revision_id` is set;
- `current_revision_id === approved_revision_id`;
- the approved Plan is based on the approved Spec revision;
- test matrix is present;
- rollback notes are present.

`missing` when Spec has passed and the Work Item has no current Plan.

`ready` when a Plan exists but still needs draft generation, submission, review, approval, or changes handling.

`blocked` when the Plan is approved without a valid approved revision, does not align to the approved Spec, lacks a test matrix, or lacks rollback notes.

#### Packages

The current approved-plan package set is:

- package `work_item_id` matches the Work Item;
- package is not archived or deleted;
- package `plan_revision_id` equals the current Plan `approved_revision_id`;
- package `spec_revision_id` equals the current Spec `approved_revision_id`.

Older visible packages may be shown as stale evidence, but they must not satisfy readiness for the current handoff.

`passed` when at least one current package exists and every current package has `phase !== "draft"` and no `blocked_reason`.

`missing` when Plan passed and no package exists for the approved Plan revision.

`ready` when current packages exist and at least one package has `phase === "draft"` and no `blocked_reason`.

`blocked` when:

- a package selected for the current handoff references missing approved revisions;
- a package has a blocking reason.

Visible packages for older Plan revisions are stale evidence. They must be labeled as stale, but they do not block the current package stage unless they are also linked into the current Release scope.

#### Execution

Required packages are the current approved-plan package set from the Packages stage.

Run selection for each required package uses this precedence:

1. `executionPackage.current_run_session_id` when present and found.
2. `executionPackage.last_run_session_id` when present and found.
3. Most recent run session by `created_at`.

The Work Item readiness model must implement this selection directly or through a new helper created for this contract. It must not reuse `deriveWorkItemCompletion`, release readiness selectors, or any helper that prefers `last_run_session_id` over `current_run_session_id`, chooses an arbitrary successful run, or uses release-level current run IDs for Work Item delivery readiness.

`passed` when every required package has a selected run with `status === "succeeded"`.

`running` when any selected run has `status` in `queued`, `running`, `waiting_for_input`, `stalled`, `resuming`, or `cancel_requested`.

`failed` when any selected run has `status` in `failed`, `timed_out`, or `cancelled`.

`missing` when a required package has no run.

`blocked` when:

- run metadata indicates expired worker lease, unrecovered watchdog stall, or driver terminal failure before `status === "succeeded"`;
- required check results are missing or failed.

There is no vague "acceptable governed state" that passes Execution in this slice. A non-succeeded run may be displayed with governance context, but it does not pass Execution.

#### Review

Review Packet selection for each required package uses this precedence:

1. `executionPackage.current_review_packet_id` when present and found.
2. Review Packet for the selected run from the Execution stage, preferring the most recently updated.
3. Most recently updated Review Packet for the package.

The selected Review Packet must be derived from the selected Work Item run above. Existing release-scoped review selection can be reused only if it is refactored to accept the selected Work Item run explicitly and preserves this precedence.

`passed` when every required package has a selected Review Packet for the selected run and all review evidence is complete:

- `status === "completed"`;
- `decision === "approved"`;
- implementer AI self-review evidence exists and `self_review.status === "succeeded"`;
- independent AI Review evidence exists with a positive conclusion for the selected run/package;
- the Review Packet maps changes back to the approved Spec and Plan revisions;
- test mapping and risk notes are present, even if risk notes are explicitly empty.

If the current Review Packet contract does not expose independent AI Review evidence, this slice must extend the Review Packet/shared contract or emit a `missing_independent_ai_review` blocker. Human approval alone cannot make Review `passed`.

`ready` when a selected Review Packet has `status` in `ready` or `in_review`.

`missing` when a selected run succeeded but no Review Packet exists for it.

`failed` when a selected Review Packet has `decision === "changes_requested"`.

`blocked` when:

- a run completed but no Review Packet is available;
- selected Review Packet points at a non-selected or stale run;
- review evidence is degraded or incomplete.

#### Integration Readiness

Integration Readiness covers the PRD cross-end / integration validation requirement without building the full Cross-end Delivery & Integration Hub.

Integration Readiness is required when any of these are true:

- the current approved-plan package set contains more than one package;
- package dependencies exist between current packages;
- any current package has non-empty `integration_readiness`;
- the Work Item is high risk and has more than one current package;
- the active release scope includes multiple packages for this Work Item.

`not_applicable` when none of the above are true.

The stage must expose both overall readiness and package-level breakdown. The overall stage is not `passed` until the Work Item reaches full integration readiness. Partial integration readiness is useful evidence, but it must remain visible as package-level state and must not satisfy Quality Gate or Release Readiness by itself.

When required, `passed` only when every current package with integration relevance has concrete evidence for all required dimensions and no integration blockers are present:

- contract/API/schema freeze or explicit contract-not-needed rationale;
- mock, fixture, or sample data readiness where the package depends on another end;
- environment readiness where an integration environment is required;
- dependency package completion for declared package dependencies;
- cross-end validation result for high-risk or multi-package Work Items;
- empty explicit blocker list.

The implementation must normalize package `integration_readiness` from explicit fields only. Accepted positive top-level inputs are `status`, `state`, or `result` values of `ready`, `passed`, or `validated`, but top-level status is only a summary and cannot satisfy the stage without the dimension evidence above. Accepted running inputs are `running`, `in_progress`, or `validating`. Accepted failed inputs are `failed`, `invalid`, or `rejected`. Unknown values are not positive evidence and must produce `blocked` with an `unknown_integration_readiness_status` blocker rather than being treated as ready.

`missing` when Integration Readiness is required but no integration readiness record exists.

`running` when integration readiness explicitly indicates in progress.

`failed` when integration readiness explicitly indicates failed validation.

`blocked` when integration readiness records missing contract, missing mock/fixture, missing environment, unresolved dependency, or explicit blocker data. Existing package dependency state must be surfaced here, not hidden in package detail.

#### Quality Gate

`passed` when the Work Item and packages have concrete validation evidence:

- Spec test strategy exists;
- Spec acceptance criteria exist;
- Plan test matrix exists;
- package `required_checks` that block review have corresponding selected-run check results with `status === "succeeded"`;
- package `required_test_gates` are satisfied by explicit gate evidence, or the package has no required test gates;
- package `required_artifact_kinds` are satisfied by `deriveRequiredArtifactPresence` semantics: selected-run `artifacts`, selected-run `log_refs` for `logs`, and approved Review Packet for `review_packet`;
- Review Packets are approved;
- Integration Readiness is `passed` or `not_applicable`;
- linked release Test/Acceptance blockers are clear where applicable.

Blocked when any required validation evidence is missing or failing.

Because `required_test_gates` are currently unstructured records, this slice must define a strict normalizer before they can pass Quality Gate. A required gate is satisfied only when it has a stable gate key/id and matching selected-run, Review Packet, or pre-release Test/Acceptance evidence with `status`/`state`/`result` of `passed`, `succeeded`, `acknowledged`, or `not_required` with rationale. Unknown gate records are blockers, not implicit passes.

Release Test/Acceptance evidence can clear release-level Test/Acceptance blockers, but it does not satisfy package `required_artifact_kinds` unless a future contract explicitly maps release evidence types to artifact kinds. This slice must not invent that mapping.

#### Release Readiness

Release Readiness is evaluated only against pre-release release data: linked release scope, pre-release blockers, Test/Acceptance gate evidence, and release approval-handoff readiness.

Ready when Quality Gate passed and a linked release has no active pre-release readiness blockers for this Work Item/package scope.

The read model must not reuse the full Release Cockpit blocker list as-is because that list can include Observation and close-readiness blockers. It must compute a dedicated pre-release blocker subset and fingerprint path for Work Item Release Readiness. Filtering a rendered Release Cockpit blocker list after the fact is not sufficient unless the source helper already exposes blocker phase/scope metadata that proves Observation, close-readiness, and post-release blockers are excluded before overrides are applied.

Pre-release blockers include only scope, approval-handoff, rollout/rollback, revision, check, artifact, evidence-chain, and Test/Acceptance blockers, such as:

- missing or stale approved Spec / Plan revision;
- stale package Spec / Plan revision;
- failed required check;
- missing required artifact;
- missing Spec test strategy;
- missing Spec acceptance criteria;
- missing rollout strategy;
- missing rollback plan;
- missing release scope link for the Work Item or required package;
- missing or blocked release Test/Acceptance acknowledgement where required.

Pre-release blockers explicitly exclude:

- missing observation plan;
- observing phase blockers;
- release close blockers;
- post-release incident or observation evidence backlinks;
- any blocker whose only evidence source is an Observation artifact.

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

Overridden blockers do not count as active blockers only if the override belongs to the same release blocker fingerprint/scope used for this readiness calculation. A stale override cannot make Release Readiness ready.

Override matching must use the dedicated pre-release blocker fingerprint/scope. Existing release override decisions tied to full Release Cockpit blocker fingerprints must not be applied until the implementation proves the fingerprint was produced by the same pre-release readiness calculation.

## Data Flow

The read model follows a single directional aggregation:

Work Item -> approved Spec -> approved Plan -> Execution Packages -> Run Sessions -> Review Packets -> Integration Readiness -> Quality Gate -> Release Readiness.

Backend query logic collects:

- current Work Item;
- current Spec and current approved Spec revision;
- current Plan and current approved Plan revision;
- current approved-plan package set plus stale package evidence;
- package dependencies for current packages;
- run sessions for current packages;
- selected run session per current package;
- review packets for current packages;
- selected review packet per current package;
- package `integration_readiness`;
- release records linked to the Work Item or its packages;
- pre-release release blocker and Test/Acceptance gate evidence;
- timeline or decision evidence only where needed for stage summaries.

If any downstream query fails, the response should include `degraded_sources`. A degraded source cannot be treated as ready. The UI shows the affected source explicitly.

Use stable degradation source keys so tests can assert exact behavior:

- `work_item`
- `spec`
- `spec_revision`
- `plan`
- `plan_revision`
- `execution_packages`
- `package_dependencies`
- `run_sessions`
- `review_packets`
- `integration_readiness`
- `release_scope`
- `release_blockers`
- `release_test_acceptance`
- `decisions`

Every source key is readiness-affecting for the stage that consumes it. If a consumed source is degraded, the affected stage cannot be `passed` or `ready`, and overall state cannot be `ready_for_release`. In particular, degraded `package_dependencies` or `integration_readiness` blocks Integration Readiness and downstream Quality Gate; degraded `release_scope`, `release_blockers`, or `release_test_acceptance` blocks Release Readiness.

## Product Actions

The cockpit action rail uses `delivery_readiness.next_actions` from the Work Item cockpit response as the only product action source for `/work-items/:workItemId`.

The existing separate Work Item actions query/component (`/query/work-items/:id/actions` and `WorkItemNextActions`) must be removed as a public API/UI source. Shared action-building code may remain only as private functions called by the readiness read model. There must be no compatibility wrapper, duplicate query, or second public source of truth for Work Item detail actions.

The Work Item cockpit query accepts the active lane. The active lane is resolved from the `lane` URL query parameter using Product Lane ids, falling back to the Work Item kind default. The frontend does not issue a second request to discover lane actions.

This slice must migrate Product Lane action targets away from legacy workbench hrefs. The non-legacy lane route contract is `/lanes/:laneId`. Shared `ProductAction` validation and web routing must accept `/lanes/:laneId` for `kind: "lane"` targets and reject `/workbench/:laneId` action targets. Do not keep compatibility routes, redirects, or Work Item detail paths that emit `/workbench` hrefs.

Actions remain lane-aware:

- Planning lanes open Spec/Plan flow or generate missing drafts where existing rules allow.
- Spec Approver lane can open Spec/Plan review context, risky Work Items, and test-strategy gaps.
- Execution Owner lane can mark package ready, run package, or open run console.
- Reviewer lane can open Review Packets and requested-change context.
- QA / Test Owner lane can open Quality Gate blockers and release Test/Acceptance acknowledgement surfaces.
- Release Owner lane can navigate to Release inventory/detail surfaces for create/link/release-readiness work. It must not expose a `ProductCommand` for create/link release unless this slice explicitly adds a release command to the shared `ProductCommand` contract and tests it end to end.
- Manager lane is read-only and only receives navigate/drill-down actions.

The Work Item cockpit does not absorb every deep operation. It links out to:

- package detail for package editing, rerun, force rerun, and package governance;
- run detail for live run events and operator input;
- review detail for approve/request-changes decisions;
- release detail for scope, blockers, Test/Acceptance acknowledgement, and release approval-handoff actions.

If the backend mistakenly returns a mutating action for `manager`, the frontend must hide or downgrade it and tests must cover the case.

No action may target legacy workbench routes. The cockpit must not use `laneTarget` while that helper or the shared target schema emits `/workbench/:laneId`. Lane navigation must use `/lanes/:laneId` after the ProductAction contract migration, or use object route actions. Direct object actions should prefer object routes such as `/work-items/:id`, `/packages/:id`, `/runs/:id`, `/reviews/:id`, and `/releases/:id`.

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

Desktop information architecture:

1. Context Header.
2. Delivery Stage Rail.
3. Main content sections in this order: Typed Brief, Package Matrix, Execution Summary, Review Summary, Integration Readiness, Quality Gate, Release Readiness, Timeline/Evidence.
4. Right Action Rail stays visible near the top of the viewport and shows the active lane's primary action.

Tablet and mobile information architecture:

1. Context Header.
2. A compact sticky or near-top Action Summary with the active lane, primary action, and blocker count.
3. Delivery Stage Rail.
4. Main content sections.
5. Full secondary Action Rail after the Stage Rail or in a drawer, not below every cockpit section.

The primary action must remain discoverable before long evidence sections on every viewport. The existing `DetailLayout` behavior that moves the rail below all content under wide breakpoints is not sufficient for this cockpit unless the implementation adds a mobile/tablet action summary or adjusts the layout primitive for this page.

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

Shows the eight delivery stages:

Spec -> Plan -> Packages -> Execution -> Review -> Integration Readiness -> Quality Gate -> Release Readiness.

Each stage card or rail item shows:

- label;
- state text;
- owner lane;
- blocker count;
- primary evidence label;
- visual tone.

Status must be readable without color. Use text plus pill/dot/icon where the component system supports it.

Stage items use one default interaction: they are in-page anchors to the corresponding section. Each section may contain explicit detail links to object routes. Stage items must be keyboard-focusable, preserve visible focus, and update focus to the target section when activated.

#### Lane-Aware Action Rail

The right rail shows:

- active lane label and description;
- primary next action;
- secondary actions;
- blocked reasons relevant to the active lane;
- drill-down links.

The rail should not render a long ungrouped list. Primary action is visually dominant; secondary actions are grouped or subdued.

On mobile, primary action, lane label, and blocker count render before the Stage Rail. Secondary actions can appear in a drawer or compact group near the top; they must not be pushed below every evidence section.

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
- dependency state;
- owner;
- reviewer;
- QA owner;
- phase;
- gate state;
- latest run state;
- latest review decision;
- blocking reason;
- link to package detail.

On mobile this uses a curated responsive card hierarchy, not a raw dump of all fields:

- card title: objective and package state;
- primary row: owner, reviewer, QA owner;
- readiness row: dependency, latest run, latest review, gate state;
- blocker row: blocking reason, hidden when empty;
- action row: package detail link and run/review links when available.

Long objective and blocker text must wrap without horizontal scroll. Secondary metadata may be collapsed behind details/summary if needed.

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

#### Integration Readiness

Shows:

- whether integration is required or not applicable;
- overall full/partial/not-ready integration state;
- package-level readiness breakdown for each integration-relevant package;
- package dependency blockers;
- contract/mock/fixture readiness where present in package `integration_readiness`;
- environment blockers where present;
- cross-end validation state;
- links to relevant package details.

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

The package, run, review, and release pages remain deep operation pages, but every deep page linked from the cockpit must meet the same visual clarity baseline as the cockpit:

- clear object header with state, owner/reviewer/QA/release lane context where applicable;
- primary action visible near the top on desktop and mobile;
- readable status and blocker presentation without color-only cues;
- responsive layout without horizontal overflow for core tables/cards;
- no legacy workbench labels/routes in visible navigation or actions;
- no card-in-card, decorative hero, gradient/orb, or marketing composition.

This is a focused delivery-surface cleanup, not a broad redesign of unrelated application pages.

## Error and Degraded States

- Missing route parameter: show the existing invalid route pattern.
- Work Item not found: show empty state.
- Work Item cockpit query failure: show unavailable state.
- Delivery readiness degraded: show the partially available cockpit and a clear degraded-source notice.
- Missing approved Spec: block Plan, Package, Execution, Review, Quality Gate, and Release Readiness.
- Missing approved Plan: block Package, Execution, Review, Quality Gate, and Release Readiness.
- Package revision mismatch: block Packages and all downstream stages.
- Integration Readiness required but missing: block Quality Gate and Release Readiness.
- Integration Readiness failed or blocked: block Quality Gate and Release Readiness.
- Required checks failed: block Quality Gate and Release Readiness.
- Review requested changes: block Review, Quality Gate, and Release Readiness.
- Release has active pre-release blockers: block Release Readiness.
- Release handoff expected but no Release is linked: mark Release Readiness missing and show navigation to create/link Release work.
- No Release linked before handoff is expected: mark Release Readiness not applicable, not blocked.

The UI must not display Ready when a required source is missing, degraded, or stale.

Loading states should use skeletons or stable placeholders for the stage rail, action summary, and major matrices. The page should not collapse into one generic loading sentence once the cockpit becomes a dense operations surface.

## Implementation Boundaries

The implementation plan should keep files focused:

- `packages/contracts`: Work Item delivery readiness schemas and exported types.
- `packages/contracts/src/api.ts`: migrate Product Lane action target href validation from `/workbench/:laneId` to `/lanes/:laneId`; ProductAction schemas must reject `/workbench` lane hrefs.
- `packages/contracts` / `packages/domain`: add or expose independent AI Review evidence on Review Packets if the current model cannot prove it.
- `packages/domain`: define a strict `required_test_gates` normalizer or typed gate contract before Quality Gate can pass package test gates.
- `packages/db/src/queries/work-item-delivery-readiness.ts`: readiness aggregation, stage derivation, blockers, evidence, and actions.
- `packages/db/src/queries/work-item-delivery-selection.ts` or equivalent private helper: selected package/run/review algorithms for this contract, if keeping them out of the aggregation file improves clarity.
- `packages/db/src/queries/work-item-release-readiness.ts` or equivalent private helper: strict pre-release Release Readiness calculation, including strict Test/Acceptance helper/refactor and pre-release blocker fingerprints.
- `packages/db/src/queries/work-item-cockpit-queries.ts`: attaches delivery readiness to the cockpit response.
- `packages/db/src/queries/work-item-action-queries.ts`: delete the public query path or refactor reusable logic into private readiness action helpers; do not keep a compatibility endpoint for Work Item detail actions.
- `apps/web/src/app/routes`: migrate Product Lane UI routes/navigation from `/workbench` to `/lanes`; remove old Workbench routes, redirects, nav labels, and action hrefs instead of preserving aliases.
- `apps/web/src/features/work-items/work-item-view-model.ts`: adapts typed delivery readiness into display models, without business-rule derivation.
- `apps/web/src/features/work-items/work-item-detail.tsx`: page composition only.
- `apps/web/src/features/work-items/delivery-cockpit/*`: presentational components for stage rail, typed brief, package matrix, quality gate panel, release readiness panel, and action rail.
- `apps/web/src/features/work-items/work-item-next-actions.tsx`: remove or replace with a component that receives `delivery_readiness.next_actions` from the cockpit response; it must not fetch a separate actions query.

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
- Work Item kind applicability for Requirement, Bug, Tech Debt, and Initiative;
- package stale revision mismatch;
- package draft/blocked;
- package dependency blocker;
- current package set excludes stale packages;
- selected run precedence uses current, last, then latest by created time;
- selected run precedence does not reuse `deriveWorkItemCompletion` or release selectors;
- selected review precedence uses current, selected-run review, then latest package review;
- selected review rejects stale release-scoped review selection when it does not match the selected Work Item run;
- run missing;
- run failed;
- run active/running status mapping;
- review missing;
- review ready/in-review;
- review missing implementer self-review evidence;
- review missing independent AI Review evidence;
- review requested changes;
- required test gate passed;
- required test gate missing/failing/unknown;
- integration readiness not applicable;
- integration readiness missing;
- integration readiness partial but not full;
- integration readiness missing contract/mock/fixture/environment/dependency evidence;
- integration readiness blocked;
- integration readiness passed;
- missing required check result;
- missing required artifact;
- linked release with active blockers;
- linked release with observation-only blockers excluded from pre-release readiness;
- linked release with full Release Cockpit blockers that should not affect pre-release readiness;
- linked release with stale override still blocked;
- linked release override matching uses pre-release blocker fingerprint/scope only;
- release handoff expected with no linked release;
- no linked release before handoff is expected;
- partial release scope blocks readiness;
- linked release ready;
- degraded release/readiness source;
- manager lane receives read-only actions only.

### Contract Tests

Cover:

- readiness response parses through shared contract schemas;
- full Work Item cockpit response parses through `workItemCockpitResponseSchema`;
- all stage ids and state enums are accepted;
- known `degraded_sources` keys are accepted and unknown keys are rejected or represented through an explicit extension path;
- degraded sources are serializable;
- ProductAction lane targets accept `/lanes/:laneId`;
- ProductAction lane targets reject `/workbench/:laneId` hrefs;
- Review Packet contract exposes independent AI Review evidence or readiness contract exposes a blocker when it is absent;
- required test gate normalization accepts only explicit known gate records.

### Web Tests

Cover:

- Requirement brief layout;
- Bug brief layout;
- Tech Debt brief layout;
- Initiative brief layout;
- stage rail renders all eight stages with text labels;
- stage rail uses deterministic section ids;
- stage rail items are keyboard-focusable and activate with Enter/Space;
- target sections are programmatically focusable, for example with `tabIndex={-1}`;
- stage activation updates hash/scroll position and moves focus from the stage item to the target section;
- blockers are visible without relying on color only;
- lane-aware primary action appears in the action rail;
- primary action appears first and visually dominant over secondary actions;
- secondary actions render as a grouped/subdued set, not an undifferentiated list;
- mobile/tablet action summary appears before long evidence sections;
- mobile/tablet action summary appears before the Stage Rail with active lane, primary action, and blocker count;
- desktop action rail remains near the top of the viewport;
- Manager lane hides or downgrades mutating actions;
- package matrix renders dependency, latest selected run, latest selected review, and wraps long content on mobile;
- package mobile cards follow the curated hierarchy: title/state, owner-reviewer-QA row, readiness row, hidden-empty blocker row, and action row;
- package mobile cards do not horizontally overflow with long objective or blocker text;
- Integration Readiness section shows required/not applicable/blocker state;
- Quality Gate panel shows blockers;
- Release Readiness panel shows linked release and blockers;
- degraded notice appears when `degraded_sources` is non-empty;
- cockpit action rail renders from `delivery_readiness.next_actions` and does not issue the old separate actions query;
- package detail page visual baseline: object header with state/lane context, top primary action on desktop/mobile, no horizontal overflow, no color-only status, no legacy route/action text, and no card-in-card or decorative layout;
- run detail page visual baseline: object header with run state, top primary action or clear terminal state on desktop/mobile, event/log content without horizontal page overflow, no color-only status, no legacy route/action text, and no card-in-card or decorative layout;
- review detail page visual baseline: object header with review state and reviewer context, top approve/request-changes action on desktop/mobile when actionable, requested-change/risk content without horizontal overflow, no color-only status, no legacy route/action text, and no card-in-card or decorative layout;
- release detail page visual baseline: object header with release state/scope, top release action on desktop/mobile when actionable, blocker/scope/test evidence without horizontal overflow, no color-only status, no legacy route/action text, and no card-in-card or decorative layout.

### Browser / Viewport Tests

Cover with browser-level tests, not only component tests:

- desktop, tablet, and mobile viewport renders of `/work-items/:workItemId`;
- mobile/tablet Action Summary is visible before the Stage Rail and before long evidence sections;
- desktop Action Rail remains near the top of the viewport during initial render;
- stage rail activation updates hash/scroll and moves browser focus to the target section;
- package mobile cards do not cause document-level horizontal overflow with long objective/blocker text;
- linked package, run, review, and release detail pages do not produce horizontal overflow at mobile width;
- screenshots or DOM assertions confirm no visible legacy Workbench route labels in cockpit or linked delivery pages.

### API / Query Module Tests

Cover:

- Work Item cockpit query accepts active lane and returns `delivery_readiness`.
- Work Item cockpit response no longer exposes old `next_actions: string[]` as a public parallel field.
- Existing package/run/review/release routes still parse their responses after contract additions.
- No public Work Item detail action source competes with `delivery_readiness.next_actions`.
- Product Lane route/action migration rejects `/workbench` targets and accepts `/lanes/:laneId`.

### Regression Verification

The implementation must keep existing package, run, review, and release route tests passing.

Expected verification commands for implementation:

- focused DB/query tests for readiness;
- focused contract schema tests;
- focused API/query-module tests for Work Item cockpit;
- focused Web route/component tests;
- browser-level viewport tests for cockpit and linked delivery pages;
- `pnpm --filter @forgeloop/web typecheck`;
- `pnpm --filter @forgeloop/contracts build`;
- `pnpm --filter @forgeloop/db build`;
- package builds affected by contract/query changes;
- scan for legacy names in changed product files;
- broader `pnpm build` or `pnpm test` when the change touches shared contracts or DB query surfaces.

## Acceptance Criteria

- `/work-items/:workItemId` presents a typed Delivery Cockpit with a stage rail, typed brief, package matrix, execution summary, review summary, Integration Readiness panel, Quality Gate panel, Release Readiness panel, and lane-aware action rail.
- Work Item cockpit API returns a structured delivery readiness read model.
- Work Item cockpit API accepts active lane and does not expose old `next_actions: string[]` as a second public action source.
- The frontend does not derive readiness business rules from raw objects.
- Requirement, Bug, Tech Debt, and Initiative applicability rules are represented in read model and UI.
- Current package set, selected run, and selected review are deterministic and tested.
- Spec Approver lane is supported for Spec/Plan review gaps and test-strategy gaps.
- Review cannot pass without implementer self-review and independent AI Review evidence.
- Quality Gate cannot pass while required test gates are missing, failing, or unknown.
- Integration Readiness blocks Quality Gate and Release Readiness when required and not passed.
- Integration Readiness requires full package-level contract/mock/fixture/environment/dependency evidence when applicable; partial integration readiness remains visible but not release-ready.
- Quality Gate readiness blocks Release Readiness when validation evidence is missing or failing.
- Release Readiness reaches ready only when linked release scope and blockers are satisfied.
- Release Readiness excludes Observation-only blockers and does not require Observation evidence.
- All blocked states explain the blocker and responsible lane.
- Manager lane remains read-only.
- Existing package, run, review, and release pages remain deep operation pages.
- Linked package, run, review, and release pages meet the delivery-surface visual clarity baseline.
- Product Lane action targets use `/lanes/:laneId`, not `/workbench/:laneId`.
- No legacy workbench, coarse owner, priority-code subsystem, or compatibility naming appears in new active product surfaces.

## Open Questions

None. User decisions for this spec:

- Include Release Readiness, but not Observation or Evolution.
- Use canonical typed Work Item Delivery Cockpit as the primary entry.
- Make delivery readiness a first-class backend read model.
- Implement Quality Gate readiness, not a full Test Center.
- Put main-flow actions in the cockpit while leaving deep operations on dedicated pages.
- Treat UI optimization as a core deliverable for this slice.
