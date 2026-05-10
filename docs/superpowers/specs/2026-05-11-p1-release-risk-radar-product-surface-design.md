# P1 Release And Risk Radar Product Surface Design

## Status

Draft for review.

## Context

ForgeLoop now has the Release foundation on `main`: Release contracts, domain types, state/gate helpers, Drizzle schema, repository methods, and shared public evidence serialization. The latest completed work also made public replay/evidence serialization a first-class boundary.

That foundation is not yet a product surface. The current API has `P0Module` for WorkItem/Spec/Plan/Package/Run/Review commands and `QueryModule` for Work Item cockpit/replay. It does not yet have:

- a `ReleaseModule`;
- Release lifecycle command routes;
- Release cockpit read model;
- Release replay support through the generic replay route;
- a Release Owner workbench entry;
- Release Flow dogfood and drift verification.

The existing `docs/superpowers/plans/2026-05-09-p1-core-schema-release-flow.md` is marked complete and should remain a historical record of the foundation work. This spec defines the focused follow-up needed to make Release usable.

## PRD Alignment

This spec is driven by `docs/PRD_v1.md`.

The PRD defines Release as the delivery orchestration object that aggregates deliverable changes, test evidence, gray rollout strategy, risk, and rollback plan. It also defines Release & Risk Radar as the surface for release candidate management, risk aggregation, rollout/rollback suggestions, release checklist, post-release observation, and issue backlinking to WorkItem, Release, and change.

The PRD's delivery line is:

`Work Item -> Spec -> Implementation Plan -> Execution Package -> AI Implementation -> AI Review -> Human Review -> Integration / Cross-end Validation -> Test / Acceptance -> Release -> Observation`

This spec implements the Release and Observation slice of that line, while keeping Process Replay and evidence safety intact.

## Problem

Release is currently present as data and domain primitives, but not as an end-to-end product capability.

Without this work:

- Release Owner cannot create and manage candidates from the app/API.
- Risk and blocker derivation exists in the domain layer but is not exposed as a cockpit.
- Release evidence can be stored but is not integrated into a Release Owner workflow.
- Release replay is not available from the canonical QueryModule route.
- The old release-flow plan can mislead future task selection because it reads broader than the code currently delivers.

The project is not live, so this should be implemented without compatibility shims or legacy route aliases.

## Goals

- Add a first-class `ReleaseModule` command surface.
- Add Release cockpit and Release replay to `QueryModule`.
- Make Release cockpit a minimal Release & Risk Radar:
  - release scope;
  - linked WorkItems and ExecutionPackages;
  - release checklist;
  - blockers and overridden blockers;
  - risk summary;
  - rollout, rollback, and observation plans;
  - review/test/integration evidence;
  - decisions and next actions.
- Add a compact Release Owner workbench surface in the web app.
- Add deterministic Release Flow dogfood that proves create/link/submit/override/observe/close/cockpit/replay redaction.
- Add drift scans so docs and code no longer disagree about Release Flow product availability.

## Non-Goals

- Do not build Incident product pages or Incident workflows.
- Do not build Contract, Mock, Fixture, or Contract-first management product surfaces.
- Do not add a separate `TestEvidence` product/table.
- Do not integrate real CI/CD, deployment, gray rollout, monitoring, or alerting systems.
- Do not build Manager dashboards.
- Do not introduce GraphQL.
- Do not add `{ data, meta }` response envelopes.
- Do not weaken public evidence redaction or add local per-route redaction shortcuts.

## Source Documents

- `docs/PRD_v1.md`
- `docs/architecture-design/v0/entity-design.md`
- `docs/architecture-design/v0/status_design.md`
- `docs/architecture-design/v0/query.md`
- `docs/architecture-design/v0/trace-evidence-plane.md`
- `docs/superpowers/specs/2026-05-09-p1-core-schema-release-flow-design.md`
- `docs/superpowers/specs/2026-05-10-public-evidence-serialization-design.md`
- `docs/superpowers/plans/2026-05-09-p1-core-schema-release-flow.md`
- `docs/superpowers/plans/2026-05-10-public-evidence-serialization.md`

## Current Implementation Baseline

Available foundation:

- `packages/contracts/src/release.ts`
- `packages/contracts/src/public-evidence.ts`
- `packages/domain/src/types.ts`
- `packages/domain/src/states.ts`
- `packages/domain/src/release-gates.ts`
- `packages/db/src/schema/release.ts`
- `packages/db/src/repositories/p0-repository.ts`
- `packages/db/src/repositories/in-memory-p0-repository.ts`
- `packages/db/src/repositories/drizzle-p0-repository.ts`
- `packages/db/src/queries/public-evidence-serialization.ts`
- `packages/db/src/queries/replay-queries.ts`
- `apps/control-plane-api/src/modules/query/*`

Missing product surface:

- `apps/control-plane-api/src/modules/release/*`
- `packages/db/src/queries/release-cockpit-queries.ts`
- Release replay support in `packages/db/src/queries/replay-queries.ts`
- release routes in `apps/control-plane-api/src/modules/query/*`
- web release command/query clients and Release Owner panel
- release-flow dogfood script and verification report

## Recommended Approach

### A. Release And Risk Radar Product Surface

Implement the command surface, cockpit/replay read models, web release panel, dogfood, and drift scan in one focused slice.

This is recommended because it turns the existing Release foundation into a usable product path and aligns with the PRD's Release & Risk Radar requirements.

### B. Backend-Only Release Flow

Implement `ReleaseModule` and query routes but skip Web.

This is faster, but it leaves Release Owner without a product entry and keeps the UI/product loop incomplete.

### C. Query-First Release Cockpit

Implement release cockpit/replay before command lifecycle.

This creates a read model without a reliable way to create and evolve Release candidates through the product, so it is not recommended.

## Architecture And Boundaries

### Command Surface

`ReleaseModule` owns all `/releases` command routes and lightweight release resource reads. It must be a separate module under:

`apps/control-plane-api/src/modules/release/`

It should depend on the existing `P0_REPOSITORY` provider exported by `P0Module`. It must not move WorkItem/Spec/Plan/Package/Run/Review commands out of P0 in this task.

### Read Surface

`QueryModule` remains the canonical read-model API.

Add:

- `GET /query/release-cockpit/:releaseId`
- `GET /query/replay/release/:releaseId`

The concrete replay route should be implemented by extending the existing generic replay shape. Unsupported replay object types still return `400`. Missing supported `work_item` or `release` objects return `404`.

### DB Query Helpers

Release read aggregation belongs in `packages/db/src/queries`, not in controllers.

Add:

- `packages/db/src/queries/release-cockpit-queries.ts`

Extend:

- `packages/db/src/queries/replay-queries.ts`

### Public Safety Boundary

All public Release cockpit and replay evidence must reuse `packages/db/src/queries/public-evidence-serialization.ts`.

Do not add ad hoc redaction in Release controllers, QueryService, web code, or a new helper.

### Deferred Domains

Incident, Contract, and TestEvidence remain deferred. This task may read existing package readiness/check/evidence fields but must not create product routes, UI, or tables for those deferred domains.

## Release Command Lifecycle

The local MVP lifecycle is:

`draft -> candidate -> approval -> rollout -> observing -> completed/closed`

### Routes

Add:

- `POST /releases`
- `GET /releases?project_id=:projectId`
- `GET /releases/:releaseId?project_id=:projectId`
- `PATCH /releases/:releaseId`
- `POST /releases/:releaseId/work-items/:workItemId`
- `DELETE /releases/:releaseId/work-items/:workItemId`
- `POST /releases/:releaseId/execution-packages/:packageId`
- `DELETE /releases/:releaseId/execution-packages/:packageId`
- `POST /releases/:releaseId/submit-for-approval`
- `POST /releases/:releaseId/approve`
- `POST /releases/:releaseId/override-approve`
- `POST /releases/:releaseId/request-changes`
- `POST /releases/:releaseId/evidences`
- `POST /releases/:releaseId/start-observing`
- `POST /releases/:releaseId/close`

`GET /releases` and `GET /releases/:releaseId` are project-scoped and require `project_id`; list must use the canonical project-scoped repository listing path, and detail must verify the loaded Release belongs to the requested project before projection. These lightweight Release resource reads are owned by `ReleaseModule`. They do not replace the cockpit read model. Their DTOs and public projection rules are defined in Public API Contracts.

### Creation

`POST /releases` accepts:

- `actor_id`
- optional `idempotency_key`
- `project_id`
- `title`
- optional `release_owner_actor_id`
- optional `release_type`, default `normal`
- optional `scope_summary`
- optional `rollout_strategy`
- optional `rollback_plan`
- optional `observation_plan`

`actor_id` is the audit actor for creation and becomes `created_by_actor_id` / `updated_by_actor_id`. `release_owner_actor_id` is the Release Owner; when omitted it defaults to `actor_id`. Do not preserve the existing foundation-only `created_by_actor_id` create-request shape as a public compatibility alias; update Release contracts and tests to the product shape above.

`scope_summary` is a canonical Release field. Keep it as text in the Release API, domain model, Drizzle schema/mapping, repository contract, and `PublicReleaseSummary`. The Drizzle table already has a `scope_summary` column; align contracts and mapping instead of treating it as a controller-only convenience field.

`rollout_strategy`, `rollback_plan`, and `observation_plan` are canonical text fields in the MVP API, domain model, and repository contract. They may be absent at creation time. When provided, each must be non-empty after trimming. Missing values become planning blockers before approval; they do not prevent creating or submitting a Release. These fields may contain plain text or markdown-like text, but they are not structured JSON in this task. Update the current Drizzle schema/mapping to align with the text contract instead of keeping JSONB as a public or repository-level shape.

The server generates the Release `id` and `key`. Initial state:

- `phase=draft`
- `activity_state=idle`
- `gate_state=not_submitted`
- `resolution=none`

### Linking

Release links can target WorkItems and ExecutionPackages.

Link commands must reject:

- missing objects;
- archived objects;
- deleted objects;
- cross-project objects;
- unauthorized/invisible objects when the repository can represent that state.

The first valid link should move a draft Release to `candidate`.

Link and unlink routes return a plain JSON response with the release id and linked object identity. They must not wrap responses in `{ data, meta }`.

### Submit For Approval

`submit-for-approval` recomputes blockers.

Only non-overrideable structural blockers prevent submission:

- `empty_work_item_scope`;
- `empty_execution_package_scope`;
- `missing_work_item`;
- `missing_execution_package`.

Overrideable blockers do not prevent submission. Missing rollout strategy, rollback plan, observation plan, review evidence, checks, artifacts, and package readiness blockers are included in the blocker snapshot so the Release Owner can fix them, request changes, plain approve after they clear, or override approve when policy permits.

Successful submission moves the release to:

- `phase=approval`
- `activity_state=awaiting_human`
- `gate_state=awaiting_approval`

`submit-for-approval` is allowed from `candidate` and from `approval/changes_requested` after the Release Owner updates scope, plans, or evidence. It must not be a dead-end approval loop.

### Plain Approval

`approve` recomputes blockers.

It succeeds only when no blockers are present. It writes:

- release approval Decision;
- ObjectEvent;
- StatusHistory entries for changed state fields.

Successful approval moves the release to:

- `phase=rollout`
- `activity_state=idle`
- `gate_state=approved`

### Override Approval

`override-approve` supports PRD's Human Override principle without changing underlying facts.

Request requires:

- `actor_id`
- non-empty `rationale`
- `blocker_snapshot`

The service must:

1. Recompute blockers.
2. Compare recomputed fingerprint to request snapshot.
3. Return `409` when the snapshot is stale.
4. Reject any non-overrideable blocker.
5. Write `manual_override` Decision.
6. Write `release_approval` Decision.
7. Preserve blocker facts in cockpit/replay as overridden blockers.

Successful override approval moves the release to the same rollout state as plain approval:

- `phase=rollout`
- `activity_state=idle`
- `gate_state=approved`
- `resolution=none`

There is no separate `override_approved` gate enum value. Override approval is represented by persisted Decisions and by `overridden_blockers` in cockpit/replay.

### Request Changes

`request-changes` is allowed only while the Release is in approval review (`phase=approval`, `gate_state=awaiting_approval`) or already change-requested. It writes a Decision, ObjectEvent, and StatusHistory.

The target state is:

- `phase=approval`
- `activity_state=awaiting_human`
- `gate_state=changes_requested`
- `resolution=none`

### Evidence

`POST /releases/:releaseId/evidences` records ReleaseEvidence.

Supported evidence types are the existing Release evidence types:

- `test_report`
- `review_packet`
- `build`
- `deployment`
- `metric_snapshot`
- `rollback_record`
- `observation_note`

Validation must enforce type-specific minimum structure:

- `review_packet` evidence requires a review-packet object ref.
- `test_report` evidence requires artifact/check refs or structured check refs.
- `build` evidence requires build identity/status or a safe artifact.
- `deployment` evidence requires target environment and rollout/deploy status.
- `metric_snapshot` evidence requires observation metrics.
- `rollback_record` evidence requires rollback metadata.
- `observation_note` evidence requires source, severity, observed_at, and summary.

Post-release observation and issue-like evidence must support minimal backlinking without productizing Incident or a separate Change object. Use the existing public ReleaseEvidence field `extra.observation.links`; do not introduce a second backlink field such as `related_object_refs`.

Allowed related object types:

- `release`
- `work_item`
- `execution_package`
- `run_session`
- `review_packet`
- `artifact`
- `decision`

Allowed relationships:

- `observed`
- `affected`
- `supports`
- `blocks`
- `generated_by`
- `rollback_of`

Requirements:

- every post-release observation or issue-like evidence must include a `release` ref for the current Release;
- it must include at least one `work_item` ref or `execution_package` ref when the issue can be attributed to scope;
- "change" in this MVP maps to linked `execution_package`, run/review evidence, build/deployment evidence, decision, or public artifact ref; do not add a new Change product object;
- update the `PublicReleaseEvidence.extra.observation.links` schema and `serializePublicReleaseEvidence` to allow the object types and relationships above;
- cockpit and replay must project these refs through public ReleaseEvidence serialization;
- refs that point to missing, unauthorized, local-only, or redacted objects must be omitted from the public projection and surfaced as evidence/backlink blockers when they are required to explain release risk.

`CreateReleaseEvidenceRequest.extra.observation.links` is the only public backlink payload. Its item shape is:

- `object_type`: one of the allowed related object types above;
- `object_id`: non-empty string;
- `relationship`: one of the allowed relationships above.

The command schema must be strict:

- malformed link objects, unknown `object_type`, unknown `relationship`, empty `object_id`, and `related_object_refs` return `400`;
- syntactically valid refs that point to missing, unauthorized, local-only, or redacted objects are accepted as supplied evidence facts, omitted from public cockpit/replay projection, and surfaced as `unsafe_or_redacted_evidence_backlink` when the ref is required for risk explanation or completed-close evidence;
- missing required public `release` or attributable WorkItem/ExecutionPackage links are surfaced as `missing_required_evidence_backlink`, not as DTO validation failures, unless the evidence type-specific minimum structure is itself malformed.

### Start Observing

`start-observing` requires an approved or override-approved rollout state.

It moves the release to:

- `phase=observing`
- `activity_state=idle`
- `gate_state=rollout_succeeded`

### Close

`close` supports:

- `completed`
- `rolled_back`
- `cancelled`

`completed` is allowed only from `phase=observing`. `rolled_back` is allowed from `phase=rollout` or `phase=observing`. `cancelled` is allowed from any non-terminal Release phase before `completed` or `closed`.

Closing as `completed` requires at least one current observation evidence row unless the request includes:

- `override_without_observation=true`
- non-empty override rationale

An observation evidence row satisfies the completed-close gate only when all of these are true:

- `evidence_type` is `observation_note` or `metric_snapshot`;
- `status=current`;
- `redacted=false`;
- `extra.observation` parses through the public ReleaseEvidence serializer and remains visible after sanitization;
- public related refs include the current Release and, when attributable, at least one scoped WorkItem or ExecutionPackage.

`rollback_record` is issue/rollback evidence, not completion observation evidence. `stale`, `superseded`, redacted, unsafe, or sanitizer-dropped observation rows do not satisfy completed close.

Rollback close writes rollback Decision semantics and should be visible in cockpit/replay.

Close transitions:

- `resolution=completed`
  - `phase=completed`
  - `activity_state=idle`
  - `gate_state=rollout_succeeded`
  - `closed_at=<server timestamp>`
- `resolution=rolled_back`
  - `phase=closed`
  - `activity_state=idle`
  - `gate_state=rollout_failed`
  - `closed_at=<server timestamp>`
- `resolution=cancelled`
  - `phase=closed`
  - `activity_state=idle`
  - `gate_state` remains the current gate state unless cancellation happens from `draft` or `candidate`, where it stays `not_submitted`
  - `closed_at=<server timestamp>`

All close paths write StatusHistory for every changed lifecycle field.

## Public API Contracts

Update `packages/contracts/src/release.ts` to expose product-facing request and response schemas. Existing foundation schemas can be changed in place because the project is not live.

### Read Request And Response DTOs

`GET /releases` accepts `ReleaseListQuery`:

- required `project_id`;
- optional `release_owner_actor_id`;
- optional `phase`;
- optional `gate_state`;
- optional `resolution`;
- optional `limit`, default `50`, maximum `100`;
- optional `cursor`.

`GET /releases` returns `ReleaseListResponse`:

- `releases`: array of `PublicReleaseSummary`;
- optional `next_cursor`.

`GET /releases/:releaseId` accepts no request body and returns `ReleaseResourceResponse`:

- required query `project_id`;
- `release`: `PublicReleaseSummary`.

Both read routes must return public Release projections only:

- no raw domain row;
- no raw `extra`;
- no local paths, secrets, raw run/review payloads, or evidence payloads;
- no linked WorkItem, ExecutionPackage, evidence, decision, artifact, risk, or checklist collections. Those belong to `GET /query/release-cockpit/:releaseId`.

`PublicReleaseSummary` must include only:

- id, key, org/project identity, title, scope_summary, owner/type, lifecycle fields, scope id arrays, text rollout/rollback/observation plans, created/updated/closed timestamps, created/updated actor ids.

For `GET /releases/:releaseId`, the service may load by `release_id` using the current repository but must verify `release.project_id === project_id` before returning. A missing Release and a project mismatch both return `404`, so the API does not disclose cross-project Release existence. `PublicReleaseSummary.work_item_ids` and `PublicReleaseSummary.execution_package_ids` must include only same-project, visible, non-deleted ids that survive the same public filtering used by cockpit scope summaries.

### Command Request DTOs

Every route that mutates a Release must include actor identity for audit writes. Use a shared actor command base:

- `actor_id`
- optional `idempotency_key`

Required command DTOs:

- `CreateReleaseRequest`
  - `actor_id`
  - optional `idempotency_key`
  - `project_id`
  - `title`
  - optional `release_owner_actor_id`, defaulting to `actor_id`
  - optional `release_type`, defaulting to `normal`
  - optional `scope_summary`
  - optional `rollout_strategy`
  - optional `rollback_plan`
  - optional `observation_plan`
- `PatchReleaseRequest`
  - `actor_id`
  - optional `idempotency_key`
  - one or more mutable fields: `title`, `scope_summary`, `rollout_strategy`, `rollback_plan`, `observation_plan`
- `LinkReleaseObjectRequest`
  - `actor_id`
  - optional `idempotency_key`
- `UnlinkReleaseObjectRequest`
  - `actor_id`
  - optional `idempotency_key`
- `SubmitReleaseForApprovalRequest`
  - `actor_id`
  - optional `idempotency_key`
- `ApproveReleaseRequest`
  - `actor_id`
  - optional `idempotency_key`
  - optional `rationale`
- `OverrideApproveReleaseRequest`
  - `actor_id`
  - optional `idempotency_key`
  - non-empty `rationale`
  - `blocker_snapshot`
- `RequestReleaseChangesRequest`
  - `actor_id`
  - optional `idempotency_key`
  - non-empty `rationale`
- `CreateReleaseEvidenceRequest`
  - `actor_id`
  - optional `idempotency_key`
  - `evidence_type`
  - `summary`
  - optional `object_ref`
  - optional `artifact_id`
  - optional `extra`
    - optional `observation`
      - `source`
      - `severity`
      - `summary`
      - `observed_at`
      - optional `actor_id`, defaulting to request `actor_id` for public projection
      - optional `links`, using the exact `extra.observation.links[]` shape from the Evidence section
      - optional `metrics`
      - optional `notes`
    - optional `deployment`
    - optional `rollback`
    - optional `build`
    - optional `check_refs`
  - optional `redacted`, default `false`
  - optional `status`, default `current`
- `StartReleaseObservingRequest`
  - `actor_id`
  - optional `idempotency_key`
- `CloseReleaseRequest`
  - `actor_id`
  - optional `idempotency_key`
  - `resolution`
  - optional `summary`
  - optional `override_without_observation`, default `false`
  - optional `override_rationale`

`CloseReleaseRequest.override_rationale` is required when `resolution=completed` and `override_without_observation=true`.

### Control Response

Release control routes return a `ReleaseControlResponse` object with:

- `release`: `PublicReleaseSummary`
- `blocker_snapshot`
- `blockers`
- `overridden_blockers`
- `decision_intents`
- `next_actions`

Control responses must not expose raw Release domain rows. `decision_intents` describes the Decisions the command wrote or would write. It is not a replacement for persisted Decisions in replay/cockpit.

### Link Response

Link/unlink routes return:

- `release_id`
- `object_type`
- `object_id`
- `linked`

### Cockpit Response

Create a separate public `ReleaseCockpitResponse` schema for the read model. Do not overload `ReleaseControlResponse` with cockpit-only fields such as linked objects, checklist, evidence, and observations.

The cockpit response must be public projections only. It must not return raw domain rows for run sessions, review packets, execution packages, decisions, artifacts, or evidence.

Required public projection families:

- `PublicReleaseSummary`
  - Release lifecycle fields, scope_summary, scope ids, owner/type, text rollout/rollback/observation plans, timestamps, and no raw `extra`.
- `PublicReleaseWorkItemSummary`
  - id, title, kind, phase, activity_state, gate_state, resolution, priority/risk fields when available, and no raw payloads. Do not add a WorkItem `key` field unless a separate canonical WorkItem key migration exists.
- `PublicReleaseExecutionPackageSummary`
  - id, work_item_id, objective, optional `display_title` derived from `objective`, phase, activity_state, gate_state, resolution, integration readiness summary, required-check summary, required-artifact summary, and no `allowed_paths`, `forbidden_paths`, raw run spec, local refs, or invented `surface_type`.
- `PublicReleaseRunSessionSummary`
  - reuse the existing public run-session serialization rules where possible; expose status, driver, relevant timestamps, public artifacts/checks only, and no raw runtime metadata or local paths.
- `PublicReleaseReviewPacketSummary`
  - id, execution_package_id, run_session_id, status, decision, summary/risk fields needed for release gates, and no raw review payloads.
- `PublicReleaseDecision`
  - produced by the shared public decision serializer.
- `PublicReleaseEvidence`
  - produced by `serializePublicReleaseEvidence`.
- `PublicArtifactRef`
  - produced by the shared public artifact serializer.

If a field is needed for the Release Owner UI but is not safe under these projection rules, add a derived safe summary instead of exposing the raw row.

### Decision Encoding

Release Decisions must use explicit `decision_type`, `outcome`, and `decision` values so cockpit/replay and public serializers agree.

Required persisted Decision encodings:

- plain approval
  - `decision_type=release_approval`
  - `outcome=approved`
  - `decision=approved`
- override approval manual override
  - `decision_type=manual_override`
  - `outcome=override_approved`
  - `decision=override_approved`
- override approval release approval
  - `decision_type=release_approval`
  - `outcome=override_approved`
  - `decision=override_approved`
- request changes
  - `decision_type=release_changes_requested`
  - `outcome=changes_requested`
  - `decision=changes_requested`
- close completed
  - `decision_type=release_close`
  - `outcome=completed`
  - `decision=completed`
- close rolled back
  - `decision_type=release_close`
  - `outcome=rolled_back`
  - `decision=rolled_back`
- close cancelled
  - `decision_type=release_close`
  - `outcome=cancelled`
  - `decision=cancelled`
- close completed with observation override
  - first write `decision_type=manual_override`, `outcome=override_approved`, `decision=override_approved`
  - then write `decision_type=release_close`, `outcome=completed`, `decision=completed`

Update the domain `Decision` type and public decision schema for all three fields:

- `decision_type` must allow `manual_override`, `release_approval`, `release_changes_requested`, and `release_close`;
- `outcome` must align with the Drizzle `decision_outcome` enum: `approved`, `changes_requested`, `rejected`, `override_approved`, `rolled_back`, `cancelled`, `completed`;
- `decision` must align with the same public values for Release decisions and continue to support existing non-Release public decisions.

The Drizzle `decision_outcome` enum already includes the Release close values; the contract/domain/public schemas should align with that enum instead of adding a one-off Release serializer branch.

### Close Override Audit

When `close completed` uses `override_without_observation=true`, write two Decision semantics:

- `manual_override`, recording the observation override rationale;
- `completed`, recording the close outcome.

If the current Decision contract needs a new decision type/outcome to represent this clearly, add it explicitly and cover it with contract tests.

## Release Gate Derivation

Release gate is derived at transition and query time. It is not a permanent truth table.

Inputs:

- Release resource and links;
- linked WorkItems;
- linked ExecutionPackages;
- RunSessions;
- ReviewPackets;
- required checks;
- required artifacts;
- package integration readiness;
- ReleaseEvidence;
- Decisions;
- rollout/rollback/observation plans.

Blockers:

- `missing_work_item`
- `missing_execution_package`
- `empty_work_item_scope`
- `empty_execution_package_scope`
- `work_item_not_complete`
- `package_not_release_ready`
- `missing_approved_review_packet`
- `failed_required_check`
- `missing_required_artifact`
- `evidence_redacted`
- `stale_or_superseded_evidence`
- `missing_required_evidence_backlink`
- `unsafe_or_redacted_evidence_backlink`
- `missing_rollout_strategy`
- `missing_rollback_plan`
- `missing_observation_plan`

Blocker truth table:

| Code | Predicate | Category | Overrideable | Object fields | Blocks submit | Blocks plain approval | Blocks override approval | Close relevance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `empty_work_item_scope` | no valid linked WorkItem remains after filtering missing/archived/deleted/cross-project/invisible links | `structural` | false | `object_type=work_item_scope` | yes | yes | yes | no |
| `empty_execution_package_scope` | no valid linked ExecutionPackage remains after filtering missing/archived/deleted/cross-project/invisible links | `structural` | false | `object_type=execution_package_scope` | yes | yes | yes | no |
| `missing_work_item` | a stored WorkItem link points at a missing, archived, deleted, cross-project, or invisible WorkItem | `structural` | false | `object_type=work_item`, `object_id` | yes | yes | yes | no |
| `missing_execution_package` | a stored ExecutionPackage link points at a missing, archived, deleted, cross-project, or invisible package | `structural` | false | `object_type=execution_package`, `object_id` | yes | yes | yes | no |
| `work_item_not_complete` | linked WorkItem is not done/release-ready under current lifecycle rules | `risk` | true | `object_type=work_item`, `object_id` | no | yes | no | no |
| `package_not_release_ready` | linked package is not release-ready/released or lacks required integration readiness | `risk` | true | `object_type=execution_package`, `object_id` | no | yes | no | no |
| `missing_approved_review_packet` | required current review packet cannot be selected or is not approved | `evidence` | true | `object_type=execution_package` or `review_packet`, optional `object_id` | no | yes | no | no |
| `failed_required_check` | required check is absent or failed for a linked package/release evidence | `risk` | true | `object_type=execution_package` or `check`, optional `object_id` | no | yes | no | no |
| `missing_required_artifact` | required public-safe artifact is absent | `evidence` | true | `object_type=execution_package` or `artifact_kind` when available | no | yes | no | no |
| `evidence_redacted` | required ReleaseEvidence/artifact exists but cannot be projected publicly | `evidence` | true | `object_type=release_evidence` or `artifact`, `object_id` when available | no | yes | no | yes for completed close evidence |
| `stale_or_superseded_evidence` | required ReleaseEvidence is not `current` | `evidence` | true | `object_type=release_evidence`, `object_id` | no | yes | no | yes for completed close evidence |
| `missing_required_evidence_backlink` | observation/issue evidence is required to explain release risk but lacks a public current Release link or lacks an attributable WorkItem/ExecutionPackage link | `evidence` | true | `object_type=release_evidence`, `object_id` | no | yes | no | yes for completed close evidence |
| `unsafe_or_redacted_evidence_backlink` | supplied evidence backlink points at a missing, unauthorized, local-only, or redacted object and therefore cannot appear in public cockpit/replay projection | `evidence` | true | `object_type=release_evidence`, `object_id` | no | yes | no | yes for completed close evidence |
| `missing_rollout_strategy` | `rollout_strategy` is absent or blank | `planning` | true | none | no | yes | no | no |
| `missing_rollback_plan` | `rollback_plan` is absent or blank | `planning` | true | none | no | yes | no | no |
| `missing_observation_plan` | `observation_plan` is absent or blank | `planning` | true | none | no | yes | no | no |

Submit must succeed when only overrideable blockers are present and must return those blockers in the snapshot. Plain approval must reject any blocker. Override approval must reject only non-overrideable blockers or stale blocker snapshots.

Required evidence selection order:

1. Explicit current review packet/run pointers on the Release when available.
2. Package `last_run_session_id` plus non-archived ReviewPacket for that run.
3. Latest non-archived ReviewPacket by creation time.

Package release readiness should consume existing fields only:

- package gate state;
- required checks;
- required artifact kinds;
- integration readiness;
- latest/current approved review packet;
- release evidence.

Do not productize Contract/Mock/Fixture management in this task. If Contract-derived readiness is needed later, it must be a separate spec.

## Release Cockpit Read Model

Add:

`getReleaseCockpit(repository, releaseId)`

Return a public API object with:

- `release`
- `work_items`
- `execution_packages`
- `latest_run_sessions`
- `current_review_packets`
- `evidences`
- `observations`
- `decisions`
- `blockers`
- `overridden_blockers`
- `risk_summary`
- `checklist`
- `next_actions`

### Checklist

Checklist items should include:

- release scope has valid WorkItems;
- release scope has valid ExecutionPackages;
- linked WorkItems are done or release-ready;
- linked Packages are release-ready/released;
- latest/current ReviewPackets are approved;
- required checks passed;
- required artifacts are present and public-safe;
- integration readiness is ready for release;
- rollout strategy exists;
- rollback plan exists;
- observation plan exists;
- post-release observation evidence exists when relevant.
- post-release observation/issue evidence has public backlinks to the Release and at least one scoped WorkItem or ExecutionPackage when attributable.

### Risk Summary

Risk summary should be deterministic and derived from blockers/evidence:

- structural blocker count;
- risk blocker count;
- evidence blocker count;
- planning blocker count;
- redacted/stale evidence count;
- failed/missing check count;
- packages not ready count;
- release can proceed without override;
- release can proceed with override;
- release cannot proceed.

### Next Actions

Next actions should be backend-derived and web-rendered. Examples:

- add scope;
- complete package review;
- fix failed checks;
- add rollout strategy;
- add rollback plan;
- add observation plan;
- submit for approval;
- approve;
- override approve;
- start observing;
- record observation;
- close release.

## Release Replay Read Model

`GET /query/replay/release/:releaseId` returns public chronological entries.

Include:

- Release ObjectEvents;
- Release StatusHistory;
- Release Decisions;
- ReleaseEvidence;
- safe artifacts linked to Release;
- public related object refs for observation/issue evidence;
- linked WorkItem status/decision highlights;
- linked ExecutionPackage status/decision highlights;
- ReviewPacket and RunSession highlights needed to explain release gate outcomes.

Replay payloads must parse through public DTO schemas and the shared serializer. Raw/local/sensitive fields must not be exposed.

## Web Release Owner Surface

Add a compact Release Owner workbench entry using the existing app style.

This should be a dedicated section/tab within the current single-page app, not a separate app route or new page architecture.

Required capabilities:

- enter/select a Release ID;
- load Release cockpit;
- load Release replay;
- show release state, scope, plans, blockers, risk summary, checklist, evidence, observations, decisions, and next actions;
- create/patch Release;
- link/unlink WorkItems and ExecutionPackages;
- submit/approve/override/request changes/start observing/close;
- record observation evidence.

The web app must not duplicate gate derivation. It may include pure helpers for labels, grouping, form payload construction, and next-action rendering from backend data.

Do not build a marketing page, Manager dashboard, Incident page, or full deployment UI.

## Error Handling

- `400 Bad Request`
  - invalid DTO;
  - unsupported replay object type.

- `404 Not Found`
  - Release, WorkItem, or ExecutionPackage does not exist.

- `409 Conflict`
  - override blocker snapshot is stale;
  - release state changed since the request where optimistic conflict is detectable;
  - lifecycle source state does not allow the requested transition, such as starting observation before approval or closing a terminal Release.

- `422 Unprocessable Entity`
  - non-overrideable structural blockers prevent submit/approve/override, including empty WorkItem scope or empty ExecutionPackage scope;
  - object exists but cannot participate in current Release, such as archived/deleted/cross-project links;
  - override approval includes any non-overrideable blocker;
  - plain approval blocked by current blockers;
  - required plan/evidence is missing for an action that requires it, such as plain approval or completed close without observation override.

Missing rollout/rollback/observation plans and missing review/evidence/check/artifact facts must not return `422` for `create` or `submit-for-approval`; they are overrideable blockers included in the returned blocker snapshot.

Rule of thumb: malformed requests are `400`; missing resources are `404`; stale or incompatible lifecycle state is `409`; valid requests blocked by current Release facts or derived blockers are `422`.

Response bodies should stay consistent with existing Nest error behavior unless contract tests require a focused shape.

## Audit And Traceability

Every Release command must preserve actor attribution. Add `updated_by_actor_id` to the Release domain/contract/repository shape if it is missing today.

Audit matrix:

| Command | Release actor fields | ObjectEvent | StatusHistory | Decision | ReleaseEvidence actor |
| --- | --- | --- | --- | --- | --- |
| create | `created_by_actor_id=actor_id`, `updated_by_actor_id=actor_id` | yes | lifecycle initial history if repository records creates | no | n/a |
| patch | `updated_by_actor_id=actor_id` | yes | for changed mutable fields when history supports them | no | n/a |
| link WorkItem/package | `updated_by_actor_id=actor_id` | yes, even for idempotent already-linked commands | for phase change from `draft` to `candidate` | no | n/a |
| unlink WorkItem/package | `updated_by_actor_id=actor_id` | yes, even for idempotent already-unlinked commands | for lifecycle field changes only | no | n/a |
| submit for approval | `updated_by_actor_id=actor_id` | yes | for phase/activity/gate changes | no | n/a |
| approve | `updated_by_actor_id=actor_id` | yes | for phase/activity/gate changes | `release_approval` | n/a |
| override approve | `updated_by_actor_id=actor_id` | yes | for phase/activity/gate changes | `manual_override` and `release_approval` | n/a |
| request changes | `updated_by_actor_id=actor_id` | yes | for gate/activity changes | `release_changes_requested` | n/a |
| create evidence | `updated_by_actor_id=actor_id` | yes | no lifecycle history unless evidence creation changes lifecycle fields | no | `created_by_actor_id=actor_id`; `extra.observation.actor_id` defaults to `actor_id` when absent |
| start observing | `updated_by_actor_id=actor_id` | yes | for phase/gate changes | no | n/a |
| close | `updated_by_actor_id=actor_id` | yes | for phase/activity/gate/resolution/closed_at changes | `release_close`, plus `manual_override` when completing with observation override | n/a |

ObjectEvents are the command audit trail and should be written for accepted mutating commands even when an idempotent command produces no lifecycle field change. StatusHistory is reserved for actual field changes.

ReleaseEvidence must link back to the relevant Release and object refs where possible.

Observation evidence is the handoff from delivery line into future replay/retrospective work. This task records it but does not generate Rule/Skill/Template proposals.

## Testing Strategy

### Domain Tests

Cover:

- release blocker derivation;
- blocker truth table predicates and submit/plain-approval/override behavior for every blocker code;
- risk summary;
- next action derivation;
- overrideable vs non-overrideable blockers;
- review/run fallback order;
- observation-required close rule and exact observation evidence predicate.

### Contract Tests

Cover:

- Release request DTOs;
- Release response DTOs;
- Release list/get read DTOs and `PublicReleaseSummary`;
- exact Release decision encoding triples for approval, override approval, request changes, completed, rolled_back, cancelled, and completed-with-observation-override;
- public ReleaseEvidence observation links for observation, metric, and rollback evidence, including `artifact` and `decision` refs;
- strict rejection of `related_object_refs` in favor of `extra.observation.links`;
- release blocker codes for every truth-table row, including missing or unsafe evidence backlinks;
- command inventory;
- public cockpit/replay DTO shapes if new schemas are added.

### DB/Query Tests

Cover:

- `getReleaseCockpit`;
- release replay chronological ordering;
- linked WorkItem/ExecutionPackage highlights;
- public redaction for ReleaseEvidence and artifact payloads;
- public projection of observation/issue backlinks to Release, WorkItem, and affected change/package/artifact refs;
- no Incident/Contract/TestEvidence joins.

### API Tests

Cover full lifecycle:

- create;
- create without rollout/rollback/observation plans succeeds;
- patch;
- list/get, including `GET /releases/:releaseId` returning `404` for cross-project mismatch;
- link/unlink;
- submit;
- submit with only planning/evidence/check/artifact blockers succeeds and returns blockers;
- plain approve success;
- plain approve blocked;
- override approve success;
- stale override conflict;
- request changes;
- record evidence;
- start observing;
- close completed;
- close completed without observation blocked unless explicitly overridden;
- close rolled back;
- close cancelled.

### Web Tests

Cover:

- command client routes;
- query client routes;
- release state helpers;
- blocker grouping;
- next-action rendering;
- observation evidence payload construction.
- observation/issue backlink payload construction without Incident or Change product objects.

### Dogfood Smoke

Add `scripts/release-flow-dogfood.ts` and package script `dogfood:release-flow`.

The dogfood script should prove:

- P0 delivery path produces a review-approved package or deterministic fixture equivalent;
- Release create/link/submit works;
- override approval works with rationale and matching blocker fingerprint;
- observing starts;
- observation evidence is recorded;
- close completed works;
- release cockpit returns checklist/risk/blockers/evidence;
- release replay returns redacted public entries.

Write `docs/superpowers/reports/p1-release-risk-radar-verification.md` with exact markers:

- P0 delivery path: PASSED or BLOCKED with reason
- Release create/link/submit: PASSED
- Release approval or override approval: PASSED
- Release observing/close: PASSED
- Release cockpit query: PASSED
- Release replay redaction: PASSED
- Release observation backlink projection: PASSED
- Durable local reset: PASSED or BLOCKED with reason
- Strict local_codex run: PASSED or BLOCKED with reason

### Drift Scan

Run a final scan for:

- old Release Flow docs claiming implemented capabilities that code does not expose;
- accidental `IncidentLink`, `ContractRevision`, `PackageContractLink`, or `test_evidences` productization;
- old enum fixture values;
- local redaction helper duplication.

If docs need adjustment, update them in the same task so future next-task selection is not misled.

## Acceptance Criteria

- `ReleaseModule` exists and is registered.
- Release command lifecycle is covered by API tests.
- `GET /query/release-cockpit/:releaseId` exists and returns release checklist/risk/blockers/evidence/next actions.
- `GET /query/replay/release/:releaseId` works through the canonical replay surface.
- Public ReleaseEvidence and replay payloads are sanitized by the shared serializer.
- Observation/issue-like ReleaseEvidence can backlink safely to Release, WorkItem, and affected package/run/review/artifact/decision refs without adding Incident or Change product surfaces.
- Web exposes a minimal Release Owner surface.
- Release dogfood writes a verification report.
- Existing P0 delivery loop, QueryModule WorkItem reads, Evidence Chain, run worker, and public serialization tests remain green.
- No Incident, Contract, or TestEvidence product surface is added.
- No old release-less compatibility route or enum shim is introduced.
