# P1 Core Schema Migration And Release Flow Design

## Status

Ready for implementation planning.

## Context

ForgeLoop has closed the P0 delivery loop and the reviewer-first Evidence Chain. Current `main` also makes the QueryModule the canonical read surface for Work Item cockpit and replay. The next product surface is Release, because the accepted P1 Trace / Evidence Plane decision explicitly defers Release grouping until reviewer evidence is trustworthy.

During brainstorming, we found that Release is not the only area where the implementation is behind the architecture documents. The current codebase implements a P0-compatible schema subset for the objects needed to run dogfood:

- WorkItem stops at `execution` and `done`.
- ExecutionPackage stops at review.
- Decision only stores `approved` and `changes_requested`.
- Artifact, ObjectEvent, and StatusHistory are intentionally compact.
- Release tables do not exist.

The project is not live. This is the right time to migrate the landed core schema to the architecture model instead of adding another compatibility layer around the P0 subset.

## Problem

Building Release Flow directly on the current P0 schema would force temporary concepts into the wrong places:

- Release approval would not fit the current WorkItem or ExecutionPackage state models.
- Release owner override would need either a new ad hoc table or an overloaded `Decision`.
- Post-release observations would likely become a new one-off table instead of ReleaseEvidence.
- Release replay would need richer ObjectEvent, StatusHistory, Decision, and Artifact semantics than the current compact tables express.

That would create the same kind of drift we just discovered in the architecture documents: a future contributor would have to reconcile a Release implementation with a separate target model that already exists in `docs/architecture-design/v0`.

## User-Approved Decisions

- Build the Release surface as a full Release Flow MVP, not a cockpit-only read panel.
- Release observation uses structured human/script writes, not real external monitoring integration.
- Release gate uses a mixed model: the system derives blockers, and Release owner can override blockers with rationale.
- All blockers are overrideable for Release state progression, but override never changes underlying facts or public API safety rules.
- Core schema migration is in scope and should be done in one step.
- Do not keep old P0 schema/status compatibility as long-term baggage.
- Full migration scope covers landed core objects. Incident, Contract, and TestEvidence are not productized in this spec.

## Goals

- Migrate the landed core domain and database schema to the V0 architecture shape for the delivery loop.
- Add Release as a first-class aggregate object using the architecture-defined Release tables.
- Preserve existing verified capabilities after migration:
  - P0 dogfood flow.
  - durable spec/plan revision lookup.
  - Evidence Chain.
  - QueryModule Work Item cockpit and replay.
  - RunEvent stream and cursor behavior.
  - public artifact redaction.
- Add a local Release Flow MVP:
  - create and update Release candidates;
  - link WorkItems and ExecutionPackages;
  - compute Release blockers and risk summary;
  - submit/approve/request-changes/override approve;
  - enter observing without real deployment automation;
  - record structured ReleaseEvidence observations;
  - close Release;
  - query Release cockpit and Release replay.
- Keep command and query API boundaries clear.

## Non-Goals

- Do not connect to real deployment, CI, monitoring, or gray rollout platforms.
- Do not build Incident product pages or Incident workflows.
- Do not build Contract product pages or Contract workflows.
- Do not productize TestEvidence as a separate first-class surface.
- Do not build Manager dashboards.
- Do not add a long-lived compatibility layer for old P0 enum values or old release-less states.
- Do not silently hide override blockers after approval.
- Do not weaken artifact redaction, local path hiding, or raw evidence safety rules.

## Source Of Truth

The target schema should follow the architecture documents unless preserving a verified runtime behavior requires a narrower shape.

Primary references:

- `docs/architecture-design/v0/entity-design.md`
- `docs/architecture-design/v0/drizzle.md`
- `docs/architecture-design/v0/status_design.md`
- `docs/architecture-design/v0/query.md`
- `docs/architecture-design/v0/trace-evidence-plane.md`

When architecture docs and current runtime behavior conflict, the implementation plan should state the conflict explicitly and choose the smallest model that preserves the verified behavior while moving toward the architecture semantics.

## Recommended Approach

### A. Release Patch On Current P0 Schema

This would add Release tables and minimal Release APIs while leaving the current WorkItem, ExecutionPackage, Decision, Artifact, and event tables largely unchanged.

This is rejected. It would ship Release on top of a schema that cannot naturally express Release lifecycle, release gate state, manual overrides, observations, or replay.

### B. Core Schema Migration First, Then Release Flow

This is the recommended approach.

Migrate the landed core objects to the V0 architecture shape, update repositories/tests/dogfood fixtures, then implement Release Flow on the migrated model. Because the project is not live, this should be a one-step refactor with no old-state compatibility layer.

### C. Full Architecture Productization

This would implement every architecture object now, including Incident, Contract, and TestEvidence surfaces.

This is rejected for this spec. Those objects matter, but they are not required for the Release Flow MVP and would turn the task into a broad platform build.

## Core Schema Migration Scope

### In Scope

Migrate these landed core objects:

- Organization
- Actor
- Project
- ProjectRepo
- WorkItem
- Spec
- SpecRevision
- Plan
- PlanRevision
- ExecutionPackage
- ExecutionPackageDependency
- RunSession
- ReviewPacket
- Artifact
- ObjectEvent
- StatusHistory
- Decision
- TraceEvent
- TraceLink
- Trace artifact references

Add these Release objects:

- Release
- ReleaseWorkItem
- ReleaseExecutionPackage
- ReleaseEvidence

### Out Of Scope For Productization

Do not productize these objects in this spec:

- Incident
- IncidentLink
- Contract
- ContractRevision
- PackageContractLink
- TestEvidence

If a migrated core table needs an enum value or object type that references those future objects, keep the enum value only when it is needed for forward-compatible event or artifact ownership semantics. Do not add routes, UI, repository workflows, or product tests for those deferred objects.

## Target Core Model

### Identity Anchors

The architecture base shape depends on `org_id` and actor references. This spec therefore includes minimal Organization and Actor tables as schema anchors, not as a full IAM product.

Required Organization fields:

- `id`
- `name`
- `created_at`

Required Actor fields:

- `id`
- `org_id`
- `actor_type`
- `display_name`
- `email`
- `created_at`

Existing API inputs that pass actor IDs can continue passing explicit actor IDs, but tests and dogfood setup must seed or create matching Actor records. Do not build login, permissions management, teams, invitations, or full identity administration in this spec.

### ID Strategy

Persisted core entity IDs should move to UUID-shaped IDs and Drizzle `uuid` columns where the architecture docs specify UUIDs. Domain types can continue to expose IDs as strings in TypeScript.

This applies to the migrated core entities and Release entities. Public synthetic IDs used only in assembled read models, such as Evidence Chain item IDs, can remain composite strings because they are not persisted entity primary keys.

The implementation plan should update tests and fixtures to use generated or UUID-shaped IDs instead of preserving old human-readable P0 fixture IDs as a compatibility contract.

### Base Entity Shape

Core aggregate tables should move toward the architecture base shape:

- `id`
- `org_id`
- `project_id` where applicable
- `key`
- `title`
- `description`
- `visibility`
- `source_type`
- `labels`
- `extra`
- `created_at`
- `created_by_actor_id`
- `updated_at`
- `updated_by_actor_id`
- `archived_at`
- `deleted_at`

Not every table needs every field. Link tables and append-only event tables should keep the lighter shape described in the architecture docs.

Because this is not a live production database, existing dogfood data and test fixtures can be updated to the new shape instead of backfilled through a compatibility layer. Local durable database reset may be required and should be documented in the implementation plan. Do not drop a user-provided database implicitly from application code.

### WorkItem

WorkItem should support the full delivery lifecycle:

- `phase`: `draft`, `triage`, `spec`, `plan`, `execution`, `release`, `observing`, `done`, `closed`
- `activity_state`: `idle`, `in_progress`, `awaiting_ai`, `ai_running`, `awaiting_human`, `human_in_progress`, `blocked`
- `gate_state`: `none`, `awaiting_spec_approval`, `spec_changes_requested`, `awaiting_plan_approval`, `plan_changes_requested`, `awaiting_release_approval`, `release_changes_requested`
- `resolution`: `none`, `completed`, `cancelled`, `rejected`, `duplicate`, `superseded`, `won_t_do`

WorkItem should also carry current pointers that the Release flow needs:

- `current_spec_id`
- `current_spec_revision_id`
- `current_plan_id`
- `current_plan_revision_id`
- `current_release_id`

The current P0 `priority` and `risk` strings should be normalized toward architecture-level `priority` and `risk_level` values.

### Spec And Plan

Spec and Plan remain logical documents whose content lives in revisions.

Spec/Plan status should support:

- `draft`
- `in_review`
- `approved`
- `rejected`
- `superseded`
- `archived`

Spec/Plan editing state should support:

- `idle`
- `ai_drafting`
- `human_editing`
- `co_editing`

Both should store:

- current revision pointer;
- approved revision pointer;
- approval timestamp;
- approver/reviewer and QA owner fields where applicable.

Plan should preserve the architecture relationship to Spec. PlanRevision should explicitly know which SpecRevision it is based on.

### ExecutionPackage

ExecutionPackage should support delivery beyond review:

- `phase`: `draft`, `ready`, `queued`, `execution`, `review`, `integration`, `test_gate`, `release`, `archived`
- `activity_state`: `idle`, `ai_running`, `ai_retrying`, `human_editing`, `awaiting_human`, `human_reviewing`, `blocked`, `handover`
- `gate_state`: `not_submitted`, `self_review_pending`, `awaiting_human_review`, `changes_requested`, `review_approved`, `integration_failed`, `integration_passed`, `test_failed`, `test_passed`, `release_ready`, `released`
- `resolution`: `none`, `completed`, `cancelled`, `rolled_back`, `superseded`

ExecutionPackage should carry Release-ready fields:

- `surface_type`
- `deploy_unit`
- `base_branch`
- `base_commit_sha`
- `required_test_gates`
- `regression_scope`
- `integration_prerequisites`
- `environment_requirements`
- `integration_readiness`
- `risk_level`
- `risk_notes`
- `definition_of_done`
- `current_run_session_id`
- `current_review_packet_id`
- `current_release_id`
- `manual_override_enabled`
- lineage fields for supersession
- retry/blocking fields

Existing required checks and artifact requirements must continue to work. If the architecture doc uses text arrays and the current implementation uses structured `RequiredCheckSpec[]`, preserve the structured runtime behavior and document the chosen column type in the plan.

### RunSession

RunSession should remain durable and continue to support current worker lifecycle behavior.

Target fields should include architecture concepts:

- package pointer;
- run status;
- executor metadata;
- sandbox and branch/base commit information;
- run spec;
- model/prompt/skill/config references;
- started/ended timestamps;
- result summary;
- changed files;
- output artifact pointers;
- handover reason.

The current run-event, command, worker lease, cursor, and runtime metadata behavior must not regress. The migration should not remove durable app-server execution fields needed by the local Codex dogfood path.

### ReviewPacket

ReviewPacket remains a review snapshot.

Target fields should include:

- package pointer;
- run session pointer;
- spec revision pointer;
- plan revision pointer;
- status including `draft`, `ready`, `in_review`, `completed`, `escalated`, `archived`;
- decision including `none`, `approved`, `changes_requested`, `need_more_context`, `escalate`;
- review started/completed timestamps;
- spec/plan refs;
- change summary and key diffs;
- AI self review;
- AI independent review;
- test mapping;
- risk points;
- human decision questions;
- final comments.

Existing review approval and changes-requested workflows must be migrated to this model.

### Artifact

Artifact should move toward being the unified physical evidence carrier:

- owner object type;
- owner object id;
- artifact type;
- storage URI;
- content type;
- size;
- checksum;
- creator and created timestamp.

Public serialization must still hide raw refs, local refs, raw metadata artifacts, logs artifacts, and local-only artifacts unless a safe public/storage URI is present. Release APIs must reuse the same public redaction behavior rather than adding a new serializer.

### ObjectEvent And StatusHistory

ObjectEvent should describe actions:

- object type;
- object id;
- event type;
- actor type;
- actor id;
- occurred timestamp;
- reason;
- payload.

StatusHistory should describe state field changes:

- object type;
- object id;
- field name;
- from value;
- to value;
- actor type;
- actor id;
- changed timestamp;
- reason;
- context.

Release replay depends on StatusHistory tracking `phase`, `activity_state`, `gate_state`, and `resolution` changes rather than relying on free-form event summaries.

### Decision

Decision should be generalized from the current `approved | changes_requested` value into:

- object type;
- object id;
- decision type;
- outcome;
- decided by actor id;
- rationale;
- evidence refs;
- created timestamp.

Required decision types for this spec:

- `spec_approval`
- `plan_approval`
- `review_decision`
- `release_approval`
- `manual_override`
- `rollback_decision`

Release owner override must be represented as a Decision and must include the blocker snapshot in `evidence_refs` or a structured equivalent.

### Trace

TraceEvent, TraceLink, and trace artifact references should remain the evidence graph substrate used by Evidence Chain.

Migration must preserve:

- persisted run replacement relationships;
- trace links to run sessions, review packets, artifacts, decisions, required checks, and work items;
- public redaction semantics;
- Evidence Chain risk flags and projection gap behavior.

This spec does not require a broad Trace projector or backfill job beyond what is needed to keep current Evidence Chain behavior green after schema migration.

## Release Model

Release should use the architecture-defined four-axis lifecycle:

- `phase`: `draft`, `candidate`, `approval`, `rollout`, `observing`, `completed`, `closed`
- `activity_state`: `idle`, `awaiting_human`, `human_in_progress`, `rolling_out`, `paused`, `blocked`
- `gate_state`: `not_submitted`, `awaiting_approval`, `changes_requested`, `approved`, `rollout_failed`, `rollout_succeeded`
- `resolution`: `none`, `completed`, `rolled_back`, `cancelled`

Release should include:

- release owner;
- release type: `normal`, `hotfix`, `emergency`, `gray`;
- scope summary;
- risk summary;
- rollout strategy;
- rollback plan;
- observation plan;
- rollout timestamps;
- observed-until timestamp.

Release link tables:

- `release_work_items`
- `release_execution_packages`

Release evidence:

- `release_evidences`
- evidence types should include at least `test_report`, `review_packet`, `build`, `deployment`, `metric_snapshot`, `rollback_record`, and `observation_note`.

Observation does not get a separate table in this spec. Human/script observations are ReleaseEvidence rows with structured payload in `extra` or the architecture-equivalent JSON field.

## Release Gate

Release cockpit should derive blockers from linked objects and evidence.

Required blocker codes:

- `missing_work_item`
- `missing_execution_package`
- `work_item_not_complete`
- `package_not_release_ready`
- `missing_approved_review_packet`
- `failed_required_check`
- `missing_required_artifact`
- `evidence_redacted`
- `stale_or_superseded_evidence`
- `missing_rollout_strategy`
- `missing_rollback_plan`
- `missing_observation_plan`

All blockers can be overridden for Release state progression. Override must not mutate underlying facts:

- failed checks remain failed;
- missing evidence remains missing;
- stale/superseded evidence remains visible;
- raw/local artifacts remain redacted;
- missing object links remain invalid and visible as blockers.

Release cockpit must continue to show overridden blockers after approval.

## API Design

Keep the command/query split.

### Command API

Release command routes:

- `POST /releases`
- `GET /releases`
- `GET /releases/:releaseId`
- `PATCH /releases/:releaseId`
- `POST /releases/:releaseId/work-items/:workItemId`
- `DELETE /releases/:releaseId/work-items/:workItemId`
- `POST /releases/:releaseId/execution-packages/:packageId`
- `DELETE /releases/:releaseId/execution-packages/:packageId`
- `POST /releases/:releaseId/submit-for-approval`
- `POST /releases/:releaseId/approve`
- `POST /releases/:releaseId/request-changes`
- `POST /releases/:releaseId/override-approve`
- `POST /releases/:releaseId/start-observing`
- `POST /releases/:releaseId/close`
- `POST /releases/:releaseId/evidences`

These routes should write ObjectEvent, StatusHistory, Decision, and ReleaseEvidence records where appropriate.

### Query API

Release query routes:

- `GET /query/release-cockpit/:releaseId`
- `GET /query/replay/release/:releaseId`

Existing query routes must remain:

- `GET /query/work-item-cockpit/:workItemId`
- `GET /query/replay/work_item/:objectId`

`/query/replay/:objectType/:objectId` should support `work_item` and `release` after this spec. Unsupported object types should continue to return `400 Bad Request`. Supported missing objects should return `404 Not Found`.

## Release Cockpit Read Model

Release cockpit should return:

- release core object;
- linked work items;
- linked execution packages;
- latest run sessions per package;
- latest/current review packets per package;
- completion/release readiness summary;
- blockers;
- overridden blockers;
- risk summary;
- decisions;
- release evidence;
- observation feed;
- next actions.

The query composition belongs in `packages/db/src/queries/*` and the QueryModule service, not in the controller.

## Release Replay

Release replay should assemble:

- Release ObjectEvents;
- Release StatusHistory entries;
- Release Decisions;
- ReleaseEvidence entries;
- linked WorkItem/ExecutionPackage status and decision highlights;
- public artifacts only through existing redaction rules.

It should not attempt to implement full Incident replay or manager-level process replay.

## Web UI Scope

Add Release flow to the existing Workbench style. Do not build a standalone marketing page or a broad role-based dashboard.

Required UI elements:

- Release selector and minimal create/edit surface;
- linked WorkItems and ExecutionPackages;
- blocker/risk summary;
- decision history;
- approval/request-changes/override actions;
- override rationale input;
- observation feed;
- add observation form for human/script-like structured observations.

The UI should remain dense, operational, and scan-friendly.

## Migration Strategy

Because the project is not live:

- update schema, domain types, repositories, tests, scripts, and fixtures in one migration;
- do not preserve old P0 enum aliases as a compatibility layer;
- update dogfood setup to create records in the new shape;
- update existing tests to use new enum values and required fields;
- document any needed local database reset command for developers.

Safety constraints:

- do not silently drop a user-provided database from application code;
- do not relax strict dogfood source checkout checks;
- do not remove durable run-worker lease, run command, run event, or cursor behavior;
- preserve artifact redaction tests.

## Error Handling

- Linking a missing WorkItem or ExecutionPackage should fail the command and should also appear as a blocker if a stale link already exists in test data.
- Approving without blockers should write a release approval Decision and move the Release into the approved/rollout path.
- Approving with blockers should fail unless the override route or override payload is used.
- Override approval requires a non-empty rationale and a snapshot of blocker codes.
- Start observing requires an approved or override-approved Release.
- Closing requires either completed observation or explicit cancellation/rollback rationale.
- Public query serializers must omit raw/local evidence even when ReleaseEvidence points to artifacts.

## Testing

### Domain Tests

Cover:

- new enum/state values;
- WorkItem release and observing states;
- ExecutionPackage release readiness states;
- Release gate blocker derivation;
- override does not mutate underlying check/evidence facts;
- release completion/closure derivation.

### Repository Tests

Cover both in-memory and Drizzle repositories:

- core entity round-trip with new fields;
- spec/plan revision direct lookup after migration;
- package dependency metadata;
- generalized Decision writes and reads;
- Artifact/ObjectEvent/StatusHistory writes and reads;
- Release CRUD;
- ReleaseWorkItem and ReleaseExecutionPackage links;
- ReleaseEvidence writes and reads;
- Release cockpit query inputs.

### API Tests

Cover:

- Release lifecycle commands;
- link and unlink WorkItems/ExecutionPackages;
- submit for approval;
- approve with no blockers;
- approve blocked without override;
- override approve with rationale and blocker snapshot;
- request changes;
- start observing;
- record ReleaseEvidence observation;
- close Release;
- Release cockpit;
- Release replay;
- unsupported replay object type remains `400`;
- missing supported replay object remains `404`;
- public artifact redaction through Work Item and Release replay.

### Regression Tests

These must remain green:

- P0 dogfood workflow can create WorkItem, Spec, Plan, ExecutionPackage, RunSession, ReviewPacket.
- Durable revision lookup is restart-safe.
- QueryModule Work Item cockpit and Work Item replay still work.
- Evidence Chain still reconstructs run/review/decision/artifact support.
- RunEvent stream still uses backfill-first cursor semantics.
- Strict or deterministic dogfood reports do not falsely claim success.

### Verification Commands

Required before completion:

- `pnpm test`
- `pnpm build`
- `git diff --check`

If durable DB behavior changes:

- run the repository's database push/migration verification against a disposable local database;
- run the relevant dogfood script after updating fixtures.

## Acceptance Criteria

- Landed core schema and domain types align with the architecture V0 model for in-scope objects.
- No long-lived old P0 state compatibility layer remains.
- Existing P0/P1 verified behavior remains green.
- Release can be exercised locally:
  - create Release;
  - link WorkItems and ExecutionPackages;
  - compute blockers;
  - submit for approval;
  - override approve with rationale;
  - start observing;
  - record observation;
  - close.
- Release cockpit explains why a Release can or cannot proceed.
- Overridden blockers remain visible.
- Release replay shows Release decisions, evidence, status changes, and safe linked context.
- Public API responses do not expose raw refs, local refs, local-only artifacts, raw metadata artifacts, or logs artifacts.

## Risks

- This is a high-blast-radius migration. The implementation plan should split work into narrow commits and use focused tests between phases.
- Architecture docs contain examples from a broader product model. The implementation must avoid pulling Incident, Contract, or TestEvidence into product scope accidentally.
- Current dogfood scripts may assume old enum values and required fields. They must be updated intentionally.
- Drizzle and in-memory repositories may drift if migration is done in only one backend first.
- Evidence Chain can regress if trace links, decisions, or artifacts change shape without updating serializers and query assembly.

## Open Implementation Notes

- Decide exact JSON field names for ReleaseEvidence observation payloads.
- Decide whether generalized Decision should replace old ReviewPacket decision immediately or coexist with ReviewPacket's own decision field as the review snapshot state. The recommended model is to keep ReviewPacket decision for snapshot state and write generalized Decision for audit/replay.
- Decide how much of BaseEntity to apply to append-only trace tables. Prefer the architecture-specific lighter shape for append-only rows.
