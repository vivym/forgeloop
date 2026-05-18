> Superseded historical migration note: this document mentions the old subsystem name for audit history only. Current commands, routes, files, and product docs use delivery terminology.

# P1 Core Schema Migration And Release Flow Design

## Status

Superseded by implementation. This design remains historical for the core schema migration and Release aggregate foundation. The current product-surface source of truth for `ReleaseModule`, release cockpit/replay, Release Owner UI, public evidence backlinks, and Release Flow dogfood is `docs/superpowers/specs/2026-05-11-p1-release-risk-radar-product-surface-design.md`.

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
- Evidence and risk blockers are overrideable for Release state progression, but override never changes underlying facts or public API safety rules. Structural preconditions such as empty Release scope are not release risk decisions and are not overrideable.
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
- RunEvent
- RunCommand
- RunWorkerLease
- RunEventCounter
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
- `email?`
- `created_at`

Existing API inputs that pass actor IDs can continue passing explicit actor IDs, but tests and dogfood setup must seed or create matching Actor records. Do not build login, permissions management, teams, invitations, or full identity administration in this spec.

Required bootstrap records:

- a deterministic default organization for local dogfood and tests;
- deterministic human, system, and ai actors in that organization;
- a repository helper or test fixture helper that creates these records before commands that write `created_by_actor_id`, `updated_by_actor_id`, `actor_id`, or `decided_by_actor_id`.

Durable mode should reject writes that reference missing actor or organization rows with a clear validation error. Tests may use fixture helpers, but application code should not silently create arbitrary actors as a side effect of every command.

### ID Strategy

Persisted aggregate entity IDs should move to UUID-shaped IDs and Drizzle `uuid` columns where the architecture docs specify UUIDs. Domain types can continue to expose IDs as strings in TypeScript.

This applies to Organization, Actor, Project, WorkItem, Spec, SpecRevision, Plan, PlanRevision, ExecutionPackage, RunSession, ReviewPacket, Artifact, Decision, Release, and ReleaseEvidence.

Runtime protocol rows may keep deterministic text identifiers where those identifiers are part of idempotency, cursoring, replay, or worker coordination:

- RunEvent IDs and cursors;
- RunCommand IDs and idempotency keys;
- RunWorkerLease IDs, worker IDs, and lease tokens;
- RunEventCounter keys;
- TraceEvent, TraceLink, and trace artifact reference IDs when generated from deterministic evidence relationships.

Public synthetic IDs used only in assembled read models, such as Evidence Chain item IDs, can remain composite strings because they are not persisted entity primary keys.

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

Full aggregate base fields apply to:

- Project
- WorkItem
- Spec
- Plan
- ExecutionPackage
- RunSession
- ReviewPacket
- Release
- ReleaseEvidence

Reduced identity/audit shapes apply to:

- Organization and Actor, which are anchors rather than product surfaces in this spec;
- ReleaseWorkItem, ReleaseExecutionPackage, and ExecutionPackageDependency link tables;
- RunEvent, RunCommand, RunWorkerLease, and RunEventCounter runtime-support tables;
- ObjectEvent, StatusHistory, Artifact, Decision, TraceEvent, TraceLink, and trace artifact refs, which should follow their architecture-specific append-only or evidence-carrier shapes rather than blindly inheriting every aggregate field.

Because this is not a live production database, existing dogfood data and test fixtures can be updated to the new shape instead of backfilled through a compatibility layer. Local durable database reset may be required and should be documented in the implementation plan. Do not drop a user-provided database implicitly from application code.

### Project And ProjectRepo

Project should follow the architecture container shape:

- `org_id`
- `key`
- `code`
- `title`
- `description`
- `kind`: `project | stream`
- `status`: `active | paused | completed | archived`
- `workflow_profile`: `backend_default | bugfix_fastlane | multi_end`
- `owner_actor_id`
- `team_id?`
- `default_branch?`
- `default_repo_ids`
- base entity audit fields.

ProjectRepo is a landed runtime dependency even though it is lighter than the architecture aggregate objects. It should remain the repository binding table used by dogfood and execution:

- `id`
- `org_id`
- `project_id`
- `repo_id`
- `name`
- `status`: `active | paused | archived`
- `local_path`
- `default_branch`
- `remote_url?`
- `base_commit_sha`
- `created_at`
- `updated_at`

Release Flow must continue to respect ProjectRepo validation. ExecutionPackage `repo_id` must refer to a repo bound to the same Project.

### Enum Migration Map

No old enum aliases should remain as long-term compatibility. Fixtures, tests, scripts, web types, and API contracts must move to the new values in the same change.

Required mappings:

| Current value | Target value |
| --- | --- |
| WorkItem `feature` | `requirement` |
| WorkItem `bugfix` | `bug` |
| WorkItem `tech_debt` | `tech_debt` |
| WorkItem `test_refactor` | `tech_debt` unless a test-specific requirement kind is introduced in the plan |
| priority free-form string | `p0 | p1 | p2 | p3` |
| risk free-form string | `low | medium | high | critical` |
| Spec/Plan `draft | in_review | approved` | keep and add `rejected | superseded | archived` |
| Spec/Plan resolution `none | approved` | add `rejected | superseded` |
| ExecutionPackage phases through `review` | keep and add `integration | test_gate | release | archived` |
| ExecutionPackage activity `awaiting_ai` | `ai_running` when work is active, otherwise `idle` |
| ExecutionPackage gate `none` | `not_submitted` |
| ExecutionPackage gate through `review_approved` | keep `not_submitted | awaiting_human_review | changes_requested | review_approved` and add integration/test/release gate values |
| ReviewPacket status `ready | in_review | completed | archived` | keep and add `draft | escalated` |
| ReviewPacket decision `none | approved | changes_requested` | keep and add `need_more_context | escalate` |

RunSession status is a runtime execution protocol. Preserve current durable worker statuses, including `waiting_for_input`, `stalled`, `resuming`, `cancel_requested`, `timed_out`, and `cancelled`, even if the V0 architecture sketch has a smaller status set. These values are not historical baggage; they are required by current app-server, command, and SSE behavior.

Artifact type migration must preserve current `ArtifactRef.kind` semantics. Map public physical artifact rows to architecture `artifact_type` values, but keep enough structured ref data to distinguish logs, raw metadata, local-only artifacts, and safe public/storage artifacts.

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

- `execution_owner_actor_id`, migrated from the current `owner_actor_id`;
- `reviewer_actor_id`;
- `qa_owner_actor_id`;
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
- ref metadata needed by current `ArtifactRef` semantics;
- content type;
- size;
- checksum;
- creator and created timestamp.

The target Artifact shape must not discard current redaction inputs. It should either preserve a structured `ref` JSON payload or map these fields into first-class columns:

- `kind`
- `name`
- `digest`
- `storage_uri`
- `local_ref`
- `raw_ref`
- any raw metadata marker used by current serializers.

Public serialization must still hide raw refs, local refs, raw metadata artifacts, logs artifacts, and local-only artifacts unless a safe public/storage URI is present. Release APIs must reuse one shared public artifact serializer rather than adding a new serializer.

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

ReviewPacket keeps its own `decision` field as the review snapshot state. Generalized Decision is the audit/replay record for approvals, changes requested, manual overrides, and rollback decisions. Spec, Plan, ReviewPacket, and Release commands that make an approval-style judgment should update the owning object's state and also write a generalized Decision row. The implementation should not remove ReviewPacket's snapshot decision field.

Stable Decision outcome values required for this spec:

- `approved`
- `changes_requested`
- `rejected`
- `override_approved`
- `rolled_back`
- `cancelled`
- `completed`

Release override approval writes two Decision rows:

- `manual_override` with outcome `override_approved`, rationale, blocker snapshot, and blocker fingerprint;
- `release_approval` with outcome `override_approved`, rationale, and an evidence reference to the manual override Decision.

### Trace

TraceEvent, TraceLink, and trace artifact references should remain the evidence graph substrate used by Evidence Chain.

Migration must preserve:

- persisted run replacement relationships;
- trace links to run sessions, review packets, artifacts, decisions, required checks, and work items;
- public redaction semantics;
- Evidence Chain risk flags and projection gap behavior.

This spec does not require a broad Trace projector or backfill job beyond what is needed to keep current Evidence Chain behavior green after schema migration.

This spec explicitly keeps the current compact Trace substrate. It does not migrate TraceEvent into the full V0 ledger shape. The implementation may add org/project fields or UUID-shaped aggregate references where needed, but it must not rewrite Trace into a separate canonical source of truth during this Release Flow migration.

### TestEvidence Boundary

Do not add a `test_evidences` table in this spec.

Release gate test evidence is derived from:

- RunSession `check_results`;
- ExecutionPackage `required_checks`;
- ExecutionPackage `required_test_gates`;
- Artifact rows or artifact refs whose kind/type is `test_report` or equivalent.

If future work needs exploratory, post-release, or QA-authored test evidence as a first-class object, it should get a separate spec. For this migration, no TestEvidence routes, UI, repository workflows, or table are added.

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

General ReleaseEvidence fields:

- `release_id`
- `evidence_type`
- `summary`
- `artifact_id?`
- `object_ref?`
- `extra`

`object_ref` should use this shape when evidence points at an existing object:

```ts
type ReleaseEvidenceObjectRef = {
  object_type: "work_item" | "execution_package" | "run_session" | "review_packet" | "artifact" | "decision";
  object_id: string;
  relationship: "supports" | "generated_by" | "observed" | "blocks" | "rollback_of";
};
```

Required non-observation evidence semantics:

- `review_packet`: requires `object_ref.object_type = "review_packet"`.
- `test_report`: requires either `artifact_id`, a safe artifact ref, or `extra.check_refs`.
- `build`: requires `summary` and either a safe artifact ref or structured build metadata in `extra.build`.
- `deployment`: local expression only; requires `summary`, `extra.deployment.environment`, and `extra.deployment.result`.
- `metric_snapshot`: requires `extra.observation.metrics`.
- `rollback_record`: requires `summary` and rollback metadata in `extra.rollback`.

ReleaseEvidence observation payloads must use this shape under `extra.observation`:

```ts
type ReleaseObservationPayload = {
  source: "human" | "script";
  severity: "info" | "warning" | "failure";
  summary: string;
  observed_at: string;
  actor_id?: string;
  links?: Array<{
    object_type: "release" | "work_item" | "execution_package" | "run_session" | "review_packet";
    object_id: string;
    relationship: "observed" | "affected" | "supports" | "blocks";
  }>;
  metrics?: Record<string, number | string | boolean | null>;
  notes?: string;
};
```

`ReleaseEvidence.summary` should duplicate the short human-readable observation summary for list views. Structured details belong in `extra.observation`.

Public ReleaseEvidence serialization should expose only:

- id, release id, evidence type, summary, created metadata;
- safe object refs;
- safe artifact metadata after shared artifact redaction;
- allowlisted `extra.observation`, `extra.deployment`, `extra.rollback`, `extra.build`, and `extra.check_refs` fields after recursive removal of `raw_ref`, `local_ref`, raw logs, local filesystem paths, tokens, secrets, and unrecognized raw payload keys.

## Release Gate

Release cockpit should derive blockers from linked objects and evidence.

Required blocker codes:

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
- `missing_rollout_strategy`
- `missing_rollback_plan`
- `missing_observation_plan`

Blocker predicates:

- `missing_work_item`: a ReleaseWorkItem link points at a soft-deleted, archived, unauthorized, or absent WorkItem.
- `missing_execution_package`: a ReleaseExecutionPackage link points at a soft-deleted, archived, unauthorized, or absent ExecutionPackage.
- `empty_work_item_scope`: Release has zero valid linked WorkItems.
- `empty_execution_package_scope`: Release has zero valid linked ExecutionPackages.
- `work_item_not_complete`: linked WorkItem does not have `resolution = completed` and the existing WorkItem completion derivation does not consider all linked packages complete.
- `package_not_release_ready`: linked package is not `gate_state = release_ready | released`, unless it is already `resolution = completed` with an approved current review packet and all required checks/artifacts present.
- `missing_approved_review_packet`: no current/latest non-archived ReviewPacket for the package has `decision = approved`.
- `failed_required_check`: any blocking required check for the package's current/latest run is missing or not `succeeded`.
- `missing_required_artifact`: any package required artifact kind is absent from current/latest run artifacts, review packet artifacts, or linked public Artifact rows.
- `evidence_redacted`: the only evidence satisfying a release requirement is redacted from public output.
- `stale_or_superseded_evidence`: Evidence Chain marks the run, review packet, artifact, decision, or trace link as stale or superseded.
- `missing_rollout_strategy`: Release has no rollout strategy.
- `missing_rollback_plan`: Release has no rollback plan.
- `missing_observation_plan`: Release has no observation plan.

For "current/latest" package evidence, prefer explicit package pointers in this order:

1. `current_review_packet_id` / `current_run_session_id`;
2. current `last_run_session_id` and the non-archived ReviewPacket for that run;
3. latest non-archived ReviewPacket by creation time.

All evidence and risk blockers can be overridden for Release state progression. Structural blockers are not overrideable when there is no meaningful Release candidate, such as empty WorkItem or ExecutionPackage scope. Override must not mutate underlying facts:

- failed checks remain failed;
- missing evidence remains missing;
- stale/superseded evidence remains visible;
- raw/local artifacts remain redacted;
- missing object links remain invalid and visible as blockers.

Release cockpit must continue to show overridden blockers after approval.

Override blocker snapshot schema:

```ts
type ReleaseBlocker = {
  code:
    | "missing_work_item"
    | "missing_execution_package"
    | "empty_work_item_scope"
    | "empty_execution_package_scope"
    | "work_item_not_complete"
    | "package_not_release_ready"
    | "missing_approved_review_packet"
    | "failed_required_check"
    | "missing_required_artifact"
    | "evidence_redacted"
    | "stale_or_superseded_evidence"
    | "missing_rollout_strategy"
    | "missing_rollback_plan"
    | "missing_observation_plan";
  subject: {
    object_type: "release" | "work_item" | "execution_package" | "run_session" | "review_packet" | "artifact" | "decision";
    object_id: string;
  };
  summary: string;
  severity: "warning" | "blocking";
  overrideable: boolean;
  evidence_refs?: Array<{ object_type: string; object_id: string }>;
};

type ReleaseBlockerSnapshot = {
  release_id: string;
  generated_at: string;
  blocker_fingerprint: string;
  blockers: ReleaseBlocker[];
};
```

`override-approve` must recompute blockers and compare the supplied `blocker_fingerprint` with the current blocker fingerprint. A stale snapshot should return a conflict response and must not approve the Release. Inline override payloads are allowed only on the `override-approve` route, not on plain `approve`.

## API Design

Keep the command/query split.

Simple Release resource reads live on the Release control surface. `GET /releases` and `GET /releases/:releaseId` return stored Release resources and lightweight links. Aggregated read models that compose risk, evidence, decisions, and replay belong under QueryModule.

### Release CRUD And Control API

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

All route responses should follow the current API style and return raw JSON objects rather than `{ data, meta }` wrappers unless an existing route already uses a wrapper.

Required request and response shapes:

```ts
type CreateReleaseRequest = {
  project_id: string;
  title: string;
  release_owner_actor_id: string;
  release_type?: "normal" | "hotfix" | "emergency" | "gray";
  scope_summary?: string;
  rollout_strategy?: Record<string, unknown>;
  rollback_plan?: Record<string, unknown>;
  observation_plan?: Record<string, unknown>;
};

type PatchReleaseRequest = Partial<Pick<
  CreateReleaseRequest,
  "title" | "scope_summary" | "rollout_strategy" | "rollback_plan" | "observation_plan"
>>;

type ReleaseControlResponse = {
  release: Release;
  decisions?: Decision[];
  blockers: ReleaseBlocker[];
  overridden_blockers: ReleaseBlocker[];
  next_actions: string[];
};

type LinkReleaseObjectResponse = {
  release: Release;
  linked_object: { object_type: "work_item" | "execution_package"; object_id: string };
};

type ReleaseActorCommandRequest = {
  actor_id: string;
  rationale?: string;
};

type OverrideApproveReleaseRequest = {
  actor_id: string;
  rationale: string;
  blocker_snapshot: ReleaseBlockerSnapshot;
};

type CloseReleaseRequest = {
  actor_id: string;
  resolution: "completed" | "rolled_back" | "cancelled";
  rationale: string;
  override_without_observation?: boolean;
};
```

`POST /releases/:releaseId/evidences` should accept:

```ts
type CreateReleaseEvidenceRequest = {
  actor_id: string;
  evidence_type: "test_report" | "review_packet" | "build" | "deployment" | "metric_snapshot" | "rollback_record" | "observation_note";
  summary: string;
  artifact_id?: string;
  object_ref?: ReleaseEvidenceObjectRef;
  extra?: Record<string, unknown>;
};
```

Required control payload semantics:

- `POST /releases/:releaseId/approve` requires `actor_id` and may include `rationale`. It succeeds only when no blockers are present.
- `POST /releases/:releaseId/request-changes` requires `actor_id` and `rationale`, writes a `release_approval` Decision with a changes-requested outcome, and moves the gate to `changes_requested`.
- `POST /releases/:releaseId/override-approve` requires `actor_id`, non-empty `rationale`, and the blocker snapshot being overridden. It writes `manual_override` and `release_approval` Decision evidence, then moves the Release into the approved rollout path without modifying underlying blocker facts.
- `POST /releases/:releaseId/start-observing` requires `actor_id` and succeeds only for approved or override-approved Releases.
- `POST /releases/:releaseId/close` requires `actor_id`, `resolution`, and `rationale`. `resolution` must be `completed`, `rolled_back`, or `cancelled`. `completed` moves `phase` to `completed` and `resolution` to `completed`; `rolled_back` and `cancelled` move `phase` to `closed` and set the matching terminal resolution.
- `POST /releases/:releaseId/evidences` requires `actor_id`, `evidence_type`, `summary`, and, for `observation_note` or `metric_snapshot`, a valid `extra.observation` payload.

Required lifecycle transitions:

| Command | From | To |
| --- | --- | --- |
| create | none | `phase=draft`, `activity_state=idle`, `gate_state=not_submitted`, `resolution=none` |
| link/unlink | draft/candidate/approval | recompute risk and keep phase unless no links remain |
| submit-for-approval | draft/candidate/changes_requested | `phase=approval`, `activity_state=awaiting_human`, `gate_state=awaiting_approval`, `resolution=none` |
| approve without blockers | approval | `phase=rollout`, `activity_state=idle`, `gate_state=approved`, `resolution=none` |
| request-changes | approval | `phase=approval`, `activity_state=awaiting_human`, `gate_state=changes_requested`, `resolution=none` |
| override-approve | approval | `phase=rollout`, `activity_state=idle`, `gate_state=approved`, `resolution=none` |
| start-observing | rollout | `phase=observing`, `activity_state=idle`, `gate_state=rollout_succeeded`, `resolution=none`; set rollout timestamps |
| close completed | observing | `phase=completed`, `activity_state=idle`, `resolution=completed` |
| close rolled_back | rollout/observing | `phase=closed`, `activity_state=idle`, `resolution=rolled_back` |
| close cancelled | draft/candidate/approval/rollout/observing | `phase=closed`, `activity_state=idle`, `resolution=cancelled` |

Successful Release commands should write StatusHistory for each changed lifecycle field and ObjectEvent for the command-level action.

Release scope rules:

- A new Release starts in `draft` and may have zero links.
- Adding the first valid WorkItem or ExecutionPackage moves the Release to `candidate` if it is still `draft`.
- Removing links may leave a Release in `candidate`, but cockpit must show `empty_work_item_scope` if valid WorkItem links are empty and `empty_execution_package_scope` if valid ExecutionPackage links are empty.
- `submit-for-approval`, `approve`, and `override-approve` are invalid when either empty-scope blocker is present. Empty scope is not overrideable because there is no release candidate to approve.

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

Release cockpit response shape:

```ts
type ReleaseCockpitResponse = {
  release: Release;
  work_items: WorkItem[];
  execution_packages: ExecutionPackage[];
  latest_run_sessions: RunSession[];
  current_review_packets: ReviewPacket[];
  blockers: ReleaseBlocker[];
  overridden_blockers: ReleaseBlocker[];
  risk_summary: Record<string, unknown>;
  decisions: PublicDecision[];
  evidences: PublicReleaseEvidence[];
  observations: PublicReleaseEvidence[];
  next_actions: string[];
};
```

## Release Replay

Release replay should assemble:

- Release ObjectEvents;
- Release StatusHistory entries;
- Release Decisions;
- ReleaseEvidence entries;
- linked WorkItem/ExecutionPackage status and decision highlights;
- public artifacts only through existing redaction rules.

It should not attempt to implement full Incident replay or manager-level process replay.

Release replay must use an allowlist serializer for every payload-bearing row:

- Decision: expose decision type, outcome, actor id, rationale, created_at, and redacted evidence refs only.
- ReleaseEvidence: expose the public ReleaseEvidence serialization described above.
- ObjectEvent: expose event type, actor id, occurred/created timestamp, reason, and allowlisted payload fields only.
- StatusHistory: expose field name, from/to values, actor id, timestamp, reason, and allowlisted context fields only.

The serializer must recursively remove `raw_ref`, `local_ref`, local filesystem paths, raw logs, raw metadata payloads, tokens, secrets, and any unrecognized raw payload key.

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

The implementation must add or document an explicit disposable-database reset path before requiring Drizzle verification. The reset path must:

- operate only on the database named by an explicit disposable `FORGELOOP_DATABASE_URL`;
- refuse to run against a non-local or unrecognized database unless a deliberate confirmation variable is set;
- drop/truncate all old P0 and migrated tables in dependency order or recreate the disposable schema;
- run schema push after reset;
- update DB test setup/teardown so old hard-coded P0 table truncation does not miss newly added tables.

Safety constraints:

- do not silently drop a user-provided database from application code;
- do not relax strict dogfood source checkout checks;
- do not remove durable run-worker lease, run command, run event, or cursor behavior;
- preserve artifact redaction tests.

API and web contract migration:

- Existing P0 user workflows should keep semantic command coverage, but request/response fields must move to the new schema in the same change.
- `goal`, `success_criteria`, `priority`, `risk`, and `owner_actor_id` are still accepted conceptually, but `priority` and `risk` must be normalized to target enum values and persisted as target fields.
- Web command and query clients, contract schemas, API DTOs, and tests must be updated in the same implementation plan. There is no old wire-contract compatibility guarantee beyond preserving the same user workflow.

Durable revision lookup and frozen package revision semantics:

- Spec and Plan revisions remain immutable.
- ExecutionPackage `spec_revision_id` and `plan_revision_id` are frozen at package creation.
- Existing package reruns and Release evidence queries must use the package's frozen revision pointers, not WorkItem's current revision pointers.
- Creating a new package should still require current approved Spec/Plan revisions.
- If WorkItem current pointers move after a package was created, Release cockpit should flag the package evidence as stale or superseded where appropriate, but direct revision lookup and package replay must still work.

Runtime-support table acceptance:

- RunEvent append and cursor allocation through `run_event_counters` must remain durable and ordered.
- RunCommand creation, claim, apply/fail, supersede, and reclaim behavior must remain durable.
- RunWorkerLease fenced acquire, heartbeat, release, expiry, and restart recovery must remain durable.
- SSE and CLI event tailing must remain backfill-first and cursor-based.
- These paths require Drizzle-backed acceptance tests, not only in-memory tests.

Repository parity:

- Add or preserve a shared repository contract suite that runs against both the in-memory repository and a disposable Postgres-backed Drizzle repository.
- The suite must cover core entity CRUD, revision lookup, Release links, ReleaseEvidence, Decisions, ObjectEvents, StatusHistory, Trace links, run events, run commands, worker leases, and query helper inputs.

Release link integrity:

- Drizzle schema should use hard foreign keys for ReleaseWorkItem and ReleaseExecutionPackage membership.
- Command routes must reject missing or soft-deleted linked objects.
- `missing_work_item` and `missing_execution_package` blockers represent soft-deleted, archived, unauthorized, or intentionally corrupted in-memory/test rows, not normal physical foreign-key misses in the durable database.

## Error Handling

- Linking a missing, archived, deleted, unauthorized, or cross-project WorkItem or ExecutionPackage should fail the command.
- Existing Release links to soft-deleted, archived, unauthorized, or intentionally corrupted in-memory/test objects should appear as cockpit blockers.
- Approving without blockers should write a release approval Decision and move the Release into the approved/rollout path.
- Approving with blockers should fail. Blocked approval is allowed only through `POST /releases/:releaseId/override-approve`.
- Override approval requires a non-empty rationale and a snapshot of blocker codes.
- Start observing requires an approved or override-approved Release.
- Closing requires `resolution` and `rationale`; `completed` should require at least one observation evidence row unless an explicit override rationale is included in the close request.
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

- Organization and Actor bootstrap fixtures;
- core entity round-trip with new fields;
- spec/plan revision direct lookup after migration;
- package dependency metadata;
- generalized Decision writes and reads;
- Artifact/ObjectEvent/StatusHistory writes and reads;
- Release CRUD;
- ReleaseWorkItem and ReleaseExecutionPackage links;
- ReleaseEvidence writes and reads;
- Release cockpit query inputs.
- run event counters, run commands, and worker leases in both backends.

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

### Dogfood Acceptance

The migrated system must have a deterministic local dogfood path that proves:

- P0 delivery workflow still creates WorkItem, Spec, Plan, ExecutionPackage, RunSession, ReviewPacket, Evidence Chain, and replay data in the migrated schema.
- Release Flow can run locally from created/linked WorkItems through override approval, observing, observation evidence, and close.

Strict `local_codex` dogfood should run when the local environment is configured. If strict mode is unavailable, the report must say blocked with concrete blocker details and must not claim strict success.

### Verification Commands

Required before completion:

- `pnpm test`
- `pnpm build`
- `git diff --check`

If durable DB behavior changes:

- run the repository's database push/migration verification against a disposable local database;
- run the relevant dogfood script after updating fixtures.
- run the shared repository contract suite against disposable Postgres.

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
- Deterministic migrated dogfood covers both the P0 delivery path and Release Flow path.
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

## Planning Requirements

- The implementation plan should decide how to split this high-blast-radius migration into commits and verification checkpoints.
- Release CRUD/control routes should live in a new ReleaseModule from the start. The existing P0 module remains the WorkItem/Spec/Plan/Package/Run/Review command surface during migration. Shared repository providers and QueryModule helpers can be reused.
