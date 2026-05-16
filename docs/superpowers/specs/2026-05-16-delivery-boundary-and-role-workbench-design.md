# Delivery Boundary And Role Workbench Design

## Status

Draft approved by user for spec review.

## Context

ForgeLoop currently has a strong delivery-loop control plane: Work Item, Spec, Plan, ExecutionPackage, RunSession, ReviewPacket, Evidence Chain, Release, durable repositories, a web workbench, a run worker, local Codex dogfood, and release risk radar are all present.

The remaining product problem is that the code and user experience still carry the historical P0 shape. `apps/control-plane-api/src/p0/p0.service.ts` is a large multipurpose service. It owns product lifecycle commands, package lifecycle commands, run control, review decisions, evidence-chain queries, trace writes, actor helpers, and stale duplicated automation-command logic. The web app also still presents one broad workbench rather than the PRD role matrix.

The user made one hard requirement: after the refactor is complete, no historical P0 compatibility remains. That includes old directories, class names, modules, route prefixes, scripts, command names, docs, and compatibility facades. The migration may be staged internally, but final delivery must remove the old surface rather than wrap it.

Another person is working on `docs/superpowers/specs/2026-05-16-executor-runtime-safety-foundation-design.md`. This design must avoid implementing executor runtime safety. It may consume the runtime safety metadata and attestation boundaries once they exist, but it must not move path safety, runtime policy parsing, structured command execution, resource governors, hooks, fallback execution, or artifact visibility policy out of `packages/executor`.

## Goals

- Replace the historical P0 API implementation with product-semantics modules and services.
- Delete `apps/control-plane-api/src/p0/**` by the end of the migration.
- Remove `P0Service`, `P0Module`, `P0Controller`, and the `RUN_WORKER` token from the old namespace.
- Replace old route prefixes and script names with delivery/product terminology. No historical route compatibility is kept.
- Rename the repository, repository implementations, Nest tokens, test helpers, scripts, report paths, and public docs that currently use the historical P0 delivery namespace.
- Split the current service by real ownership boundaries: work items, specs/plans, execution packages, run control, review/evidence, automation commands, releases, and queries.
- Remove stale duplicated automation-command logic from the old service and keep `AutomationCommandService` as the only daemon command boundary.
- Build the first role-workbench product surface after the backend boundary is clean.
- Preserve behavior for the existing delivery loop, run event stream, review handoff, durable mode, dogfood flows, and release risk radar under the new names.

## Non-Goals

- No runtime safety implementation. That belongs to the executor runtime safety design.
- No long-term compatibility layer for old P0 routes, classes, files, command names, docs, or scripts.
- No full TestAsset/TestRun model in this slice. The QA/Test workbench MVP uses existing checks, artifacts, release blockers, and test strategy summaries.
- No Incident, Contract, Environment, Version, Rule Proposal, Skill Proposal, or Template Proposal product modules in this slice.
- No production auth or fine-grained RBAC redesign in this slice, beyond preserving current actor checks and making future role boundaries explicit.
- No Manager performance scoring. The Manager MVP is a process-health view only.

## Decision Summary

Use a boundary-cleanup-first approach.

The implementation first creates delivery/product modules, migrates behavior out of the historical P0 service, renames public routes and scripts, updates tests and web clients, then deletes the old namespace. Only after that does it add the role workbench matrix. This sequencing avoids building a new product surface on top of the old architecture.

The target module shape is:

- `ProjectService`
- `DeliveryModule`
- `AuditModule`
- `AuthModule`
- `HttpSupportModule`
- `ProjectionModule`
- `WorkItemService`
- `SpecPlanService`
- `ExecutionPackageService`
- `RunControlService`
- `ReviewEvidenceService`
- `AuditWriterService`
- `PublicRunSessionProjection`
- `AutomationCommandService`
- existing `ReleaseService`
- existing `QueryService`

The user-facing product surface becomes a role matrix:

- Work Item Owner / Intake Workbench for Initiative, Requirement, Bug, and Tech Debt
- Spec Approver Workbench
- Execution Owner Workbench
- Reviewer Workbench
- QA / Test Owner Workbench
- Release Owner Workbench
- Manager Health View

## Architecture

### Module Ownership

`DeliveryModule` replaces the historical P0 module as the product delivery composition module. It wires the semantic command controllers and command services, but it is not the owner or exporter of shared audit, auth, HTTP, projection, release, automation, or query infrastructure.

Shared provider ownership is explicit:

- `AuditModule` exports `AuditWriterService`;
- `AuthModule` exports actor context helpers and trusted actor header signing/verification;
- `HttpSupportModule` exports the Zod validation pipe and domain error filter;
- `ProjectionModule` exports `PublicRunSessionProjection`.

`ReleaseModule`, `AutomationModule`, `QueryModule`, `RunControlModule`, and the delivery command modules import these shared modules directly. They must not import `DeliveryModule` or a delivery command service just to access shared infrastructure.

`ProjectService` owns:

- project creation and lookup;
- repo binding and repo listing;
- project/repo object events through `AuditWriterService`;
- project/repo controller ownership.

`WorkItemService` owns:

- type-aware Work Item creation and listing;
- Work Item type template metadata for Initiative, Requirement, Bug, and Tech Debt;
- Work Item state updates that are not owned by Spec/Plan, Execution, Review, or Release.

`SpecPlanService` owns:

- Spec creation, lookup, revision creation, and draft generation adapter calls;
- Spec submit, approve, and request-changes commands;
- Plan creation, lookup, revision creation, and draft generation adapter calls;
- Plan submit, approve, and request-changes commands;
- Work Item state transitions caused by Spec/Plan gates.

`ExecutionPackageService` owns:

- package generation and manual package creation;
- package patch/edit behavior;
- mark-ready gate;
- dependency graph checks;
- current approved Spec/Plan graph checks;
- control-plane validation of frozen package policy snapshot presence and status;
- package edit behavior when open ReviewPackets exist;
- package generation metadata and manifest bookkeeping.

`RunControlService` owns:

- run, rerun, and force-rerun enqueue commands;
- RunSession lookup;
- run event list/backfill;
- SSE run event streams;
- run event stream token creation and verification;
- input, cancel, and resume operator commands;
- run viewer/operator authorization;
- worker kick.

`ReviewEvidenceService` owns:

- ReviewPacket lookup;
- review approval and changes-requested decisions;
- applying review outcomes to ExecutionPackage state;
- archiving stale ReviewPackets;
- Evidence Chain responses;
- review/evidence trace-event writes that are currently best-effort.

`AuditWriterService` owns shared writes for:

- object events;
- status history;
- decisions;
- shared trace links when a command service needs them.

`ReleaseService`, `ReviewEvidenceService`, `ProjectService`, `WorkItemService`, `SpecPlanService`, `ExecutionPackageService`, and `RunControlService` must use `AuditWriterService` for shared audit rows rather than duplicating write helpers or depending on `ReviewEvidenceService`.

`PublicRunSessionProjection` owns public RunSession serialization. `RunControlService` and `QueryService` both use this projection so `QueryModule` does not depend back on `RunControlService`.

`AutomationCommandService` remains the single command boundary for daemon-origin automation:

- automation capability settings;
- manual-path holds;
- idempotent plan draft creation;
- idempotent package draft creation;
- package generation supersede approval;
- run enqueue through automation, once a later design enables it.

The refactor must remove duplicated private automation-command code from the old service instead of copying it into a new service.

### Shared Infrastructure

The following moves are canonical. Implementation plans must not choose different destinations.

| Current ownership | Target ownership |
| --- | --- |
| `p0/actor-context.ts` | `modules/auth/actor-context.ts`, exported by `AuthModule` |
| run event stream token helpers currently in actor context | `modules/run-control/run-event-stream-token.ts` |
| `p0/zod-validation.pipe.ts` | `modules/http/zod-validation.pipe.ts`, exported by `HttpSupportModule` |
| `p0/domain-error.filter.ts` | `modules/http/domain-error.filter.ts`, exported by `HttpSupportModule` |
| `RUN_WORKER` token | `modules/run-control/run-worker.token.ts` as `DELIVERY_RUN_WORKER` |
| `p0/run-worker-lifecycle.service.ts` | `modules/run-control/run-worker-lifecycle.service.ts` |
| `p0/run-session-serialization.ts` | `modules/query/public-run-session-projection.ts`, exported by `ProjectionModule` |
| `p0/automation-command-helpers.ts` | `modules/automation/automation-command-helpers.ts` |
| shared object event/status history/decision helper methods | `modules/audit/audit-writer.service.ts`, exported by `AuditModule` |

`ReleaseModule`, `AutomationModule`, and `QueryModule` must import these target modules directly. They must not import from delivery command services just to access shared infrastructure.

### Controllers And Routes

The old controller is replaced by product-semantic controllers:

- `ProjectsController`
- `WorkItemsController`
- `SpecPlanController`
- `ExecutionPackagesController`
- `RunSessionsController`
- `ReviewPacketsController`
- existing `ReleaseController`
- existing `QueryController`, updated for new route terminology where needed

No old route compatibility is kept.

Route names use product terminology. This route map is normative; implementation plans must not defer route names.

| Capability | Route |
| --- | --- |
| Create project | `POST /projects` |
| Get project | `GET /projects/:projectId` |
| Bind project repo | `POST /projects/:projectId/repos` |
| List project repos | `GET /projects/:projectId/repos` |
| List Work Item types | `GET /work-item-types` |
| Create Work Item | `POST /work-items` |
| List Work Items | `GET /work-items` |
| Get Work Item | `GET /work-items/:workItemId` |
| Update Work Item readiness | `PATCH /work-items/:workItemId` |
| Work Item evidence chain | `GET /work-items/:workItemId/evidence-chain` |
| Create Spec | `POST /work-items/:workItemId/specs` |
| Get Spec | `GET /specs/:specId` |
| List Spec revisions | `GET /specs/:specId/revisions` |
| Get Spec revision | `GET /spec-revisions/:specRevisionId` |
| Create Spec revision | `POST /specs/:specId/revisions` |
| Generate Spec draft | `POST /specs/:specId/generate-draft` |
| Submit Spec | `POST /specs/:specId/submit-for-approval` |
| Approve Spec | `POST /specs/:specId/approve` |
| Request Spec changes | `POST /specs/:specId/request-changes` |
| Create Plan | `POST /work-items/:workItemId/plans` |
| Get Plan | `GET /plans/:planId` |
| List Plan revisions | `GET /plans/:planId/revisions` |
| Get Plan revision | `GET /plan-revisions/:planRevisionId` |
| Create Plan revision | `POST /plans/:planId/revisions` |
| Generate Plan draft | `POST /plans/:planId/generate-draft` |
| Submit Plan | `POST /plans/:planId/submit-for-approval` |
| Approve Plan | `POST /plans/:planId/approve` |
| Request Plan changes | `POST /plans/:planId/request-changes` |
| Generate packages | `POST /plan-revisions/:planRevisionId/generate-packages` |
| Create package | `POST /plan-revisions/:planRevisionId/execution-packages` |
| List packages for Work Item | `GET /work-items/:workItemId/execution-packages` |
| Get package | `GET /execution-packages/:packageId` |
| Patch package | `PATCH /execution-packages/:packageId` |
| Mark package ready | `POST /execution-packages/:packageId/mark-ready` |
| Run package | `POST /execution-packages/:packageId/run` |
| Rerun package | `POST /execution-packages/:packageId/rerun` |
| Force rerun package | `POST /execution-packages/:packageId/force-rerun` |
| Get RunSession | `GET /run-sessions/:runSessionId` |
| List run events | `GET /run-sessions/:runSessionId/events` |
| Stream run events | `GET /run-sessions/:runSessionId/events/stream` |
| Create run event stream token | `POST /run-sessions/:runSessionId/events/stream-token` |
| Send run input | `POST /run-sessions/:runSessionId/input` |
| Cancel run | `POST /run-sessions/:runSessionId/cancel` |
| Resume run | `POST /run-sessions/:runSessionId/resume` |
| Get ReviewPacket | `GET /review-packets/:reviewPacketId` |
| Approve ReviewPacket | `POST /review-packets/:reviewPacketId/approve` |
| Request ReviewPacket changes | `POST /review-packets/:reviewPacketId/request-changes` |
| Create Release | `POST /releases` |
| List Releases | `GET /releases` |
| Get Release | `GET /releases/:releaseId` |
| Patch Release | `PATCH /releases/:releaseId` |
| Link Release Work Item | `POST /releases/:releaseId/work-items/:workItemId` |
| Unlink Release Work Item | `DELETE /releases/:releaseId/work-items/:workItemId` |
| Link Release package | `POST /releases/:releaseId/execution-packages/:packageId` |
| Unlink Release package | `DELETE /releases/:releaseId/execution-packages/:packageId` |
| Submit Release | `POST /releases/:releaseId/submit-for-approval` |
| Approve Release | `POST /releases/:releaseId/approve` |
| Override approve Release | `POST /releases/:releaseId/override-approve` |
| Request Release changes | `POST /releases/:releaseId/request-changes` |
| Create Release evidence | `POST /releases/:releaseId/evidences` |
| Acknowledge Release Test/Acceptance gate | `POST /releases/:releaseId/test-acceptance/acknowledge` |
| Start Release observing | `POST /releases/:releaseId/start-observing` |
| Close Release | `POST /releases/:releaseId/close` |
| Work Item cockpit query | `GET /query/work-item-cockpit/:workItemId` |
| Release cockpit query | `GET /query/release-cockpit/:releaseId` |
| Intake workbench query | `GET /query/workbenches/intake` |
| Spec Approver workbench query | `GET /query/workbenches/spec-approver` |
| Execution Owner workbench query | `GET /query/workbenches/execution-owner` |
| Reviewer workbench query | `GET /query/workbenches/reviewer` |
| QA/Test Owner workbench query | `GET /query/workbenches/qa-test-owner` |
| Release Owner workbench query | `GET /query/workbenches/release-owner` |
| Manager Health query | `GET /query/workbenches/manager-health` |
| Process replay query | `GET /query/replay/:objectType/:objectId` |
| Get automation capabilities | `GET /automation/projects/:projectId/capabilities` |
| Set automation capabilities | `POST /automation/projects/:projectId/capabilities` |
| Disable automation capabilities | `POST /automation/projects/:projectId/capabilities:disable` |
| Request manual path hold | `POST /automation/manual-path-holds` |
| Resolve manual path hold | `POST /automation/manual-path-holds/:holdId/resolve` |

Automation capability routes preserve the current project/repo scoping semantics without preserving old paths. `GET /automation/projects/:projectId/capabilities` accepts optional `?repo_id=...`. Set and disable request bodies preserve optional `repo_id` and return the scoped settings they changed.

The old public automation routes are removed, not redirected:

- `GET /p0/projects/:projectId/automation/capabilities`;
- `POST /p0/projects/:projectId/automation/capabilities`;
- `POST /p0/projects/:projectId/automation/capabilities:disable`;
- `POST /p0/manual-path-holds`;
- `POST /p0/manual-path-holds/:holdId/resolve`.

Those routes must be unregistered and return the framework's normal not-found response. Scripts, tests, web clients, and active docs must use the `/automation/...` routes above.

The existing internal daemon routes under `/internal/automation` are not the historical public route surface. They remain internal daemon APIs and continue to be owned by `AutomationController`, but their imports must move away from the old namespace.

The public automation routes above are owned by a product-facing `AutomationSettingsController`. They delegate to `AutomationCommandService`; they must not duplicate the internal action-run controller.

## Naming Migration Inventory

The final implementation must remove the historical delivery-loop namespace from current code, tests, scripts, docs, and package exports. It may preserve `P0` only when it is clearly a priority value such as `priority: "P0"` rather than the old subsystem name. This exception must not be used for files, modules, scripts, route paths, repository interfaces, Nest tokens, report names, or product copy.

Required renames:

| Current name/pattern | Target name/pattern |
| --- | --- |
| `apps/control-plane-api/src/p0/**` | deleted after files move to target modules |
| `P0Module` | `DeliveryModule` |
| `P0Controller` | semantic controllers listed above |
| `P0Service` | split services listed above |
| `packages/db/src/repositories/p0-repository.ts` | `packages/db/src/repositories/delivery-repository.ts` |
| `packages/db/src/repositories/in-memory-p0-repository.ts` | `packages/db/src/repositories/in-memory-delivery-repository.ts` |
| `packages/db/src/repositories/drizzle-p0-repository.ts` | `packages/db/src/repositories/drizzle-delivery-repository.ts` |
| `p0-repository`, `in-memory-p0-repository`, and `drizzle-p0-repository` package export paths | delivery repository export paths |
| `P0Repository` | `DeliveryRepository` |
| `InMemoryP0Repository` | `InMemoryDeliveryRepository` |
| `DrizzleP0Repository` | `DrizzleDeliveryRepository` |
| `createDrizzleP0Repository` | `createDrizzleDeliveryRepository` |
| `P0_REPOSITORY` | `DELIVERY_REPOSITORY` |
| `P0_DEMO_ACTOR_ID_FALLBACK` | `DELIVERY_DEMO_ACTOR_ID_FALLBACK` |
| `RUN_WORKER` from old service | `DELIVERY_RUN_WORKER` from run-control token file |
| `withP0Transaction` | `withDeliveryTransaction` |
| `p0-transaction` and other old subsystem lock-key prefixes | delivery/product lock-key prefixes |
| `forgeloop-p0-package-execution` task queue | `forgeloop-delivery-package-execution` |
| `uuidBackedP0IdPrefixes` | `uuidBackedDeliveryIdPrefixes` |
| `smoke:p0` | `smoke:delivery` |
| `dogfood:p0` | `dogfood:delivery` |
| `dogfood:p0:durable` | `dogfood:delivery:durable` |
| `dogfood:p0:local-codex` | `dogfood:delivery:local-codex` |
| `dogfood:p0:work-items` | `dogfood:delivery:work-items` |
| `scripts/p0-dogfood.ts` | `scripts/delivery-dogfood.ts` |
| `scripts/p0-durable-dogfood.ts` | `scripts/delivery-durable-dogfood.ts` |
| `scripts/p0-local-codex-dogfood.ts` | `scripts/delivery-local-codex-dogfood.ts` |
| `scripts/p0-dogfood-work-items.ts` | `scripts/delivery-dogfood-work-items.ts` |
| `tests/helpers/p0-runtime-fixtures.ts` | `tests/helpers/delivery-runtime-fixtures.ts` |
| `tests/smoke/p0-smoke.test.ts` | `tests/smoke/delivery-smoke.test.ts` |
| `tests/smoke/p0-*-script.test.ts` | `tests/smoke/delivery-*-script.test.ts` |
| `docs/dogfood/p0-dogfood-work-items.md` | `docs/dogfood/delivery-dogfood-work-items.md` |
| `forgeloop://p0/*` package policy URIs | `forgeloop://delivery/*` package policy URIs |
| `p0-default-policy` and `p0-manual-package-policy` policy digests | `delivery-default-policy` and `delivery-manual-package-policy` policy digests |
| `[forgeloop:p0.trace]` logger namespace | `[forgeloop:delivery.trace]` logger namespace |
| generated markers such as `P0 delivery path` | delivery/product markers |
| active reports and runbooks with old delivery-loop names | delivery-loop report/runbook names |
| old public route prefix | removed; use route map above |

Documentation cleanup is not optional. Current README, active plans, active specs, dogfood docs, report filenames, and generated report content must use delivery/product terminology by the end of the migration. Historical git history is not rewritten. If a historical report must be kept for audit, it is renamed and prefaced with a migration note using delivery terminology; it must not remain an active runbook or command reference under the old namespace.

This spec supersedes active compatibility language in `docs/superpowers/specs/2026-05-15-http-automation-daemon-mvp-design.md` for public `/p0/...` automation routes. Final implementation cleanup must update or supersede that spec so it no longer requires old `/p0/...` routes to keep passing.

The migration spec itself may mention the old namespace while planning the rename. Final implementation cleanup must update or supersede this spec so current docs no longer instruct users to operate the old namespace.

## Work Item Type Model

`WorkItem` remains the shared abstraction, but the product no longer treats Work Item Owner as one coarse role.

The MVP has four built-in types:

- Initiative;
- Requirement;
- Bug;
- Tech Debt.

Each type has:

- display label;
- required fields;
- default risk hints;
- recommended next action;
- default Spec/Plan guidance;
- optional role hints for approver, execution owner, reviewer, QA owner, and release owner.

The current domain only supports `requirement`, `bug`, and `tech_debt`. This design adds `initiative` as a first-class Work Item kind across:

- `packages/domain/src/types.ts`;
- `packages/domain/src/validators.ts`;
- `packages/db/src/schema/_shared.ts` and any durable enum migration required by Drizzle/Postgres;
- repository fixtures;
- API DTO schemas;
- contract/web API types;
- web intake forms and tests.

The first metadata endpoint is `GET /work-item-types`. It returns a stable list with:

- `kind`;
- `label`;
- `description`;
- `required_fields`;
- `default_priority`;
- `default_risk`;
- `spec_guidance`;
- `plan_guidance`;
- `recommended_next_actions`;
- `role_hints`.

The MVP required fields use existing storage fields so this slice does not add type-specific Work Item tables:

| Kind | Required fields |
| --- | --- |
| `initiative` | `project_id`, `title`, `goal`, `success_criteria`, `priority`, `risk`, `owner_actor_id` |
| `requirement` | `project_id`, `title`, `goal`, `success_criteria`, `priority`, `risk`, `owner_actor_id` |
| `bug` | `project_id`, `title`, `goal`, `success_criteria`, `priority`, `risk`, `owner_actor_id` |
| `tech_debt` | `project_id`, `title`, `goal`, `success_criteria`, `priority`, `risk`, `owner_actor_id` |

Type-specific fields such as customer impact, severity, affected surface, or business value are not persisted as first-class fields in this slice. They may be represented in `goal`, `success_criteria`, or later template extensions.

Bug and Tech Debt may use simplified branches later, but this slice only needs to prevent type erasure in intake and role navigation.

## Role Workbench Matrix

The first product experience after backend cleanup is a role matrix, not a single all-purpose demo workbench.

Role workbenches are query projections owned by `QueryService`. The web app must not derive these queues by fetching every object and filtering client-side.

All role workbench query endpoints accept these optional query parameters where relevant:

- `project_id`;
- `actor_id`;
- `kind`;
- `limit`;
- `cursor`.

All role workbench responses use this envelope:

```ts
type RoleWorkbenchResponse<TItem, TSummary = Record<string, unknown>> = {
  summary: TSummary;
  items: TItem[];
  next_cursor?: string;
};
```

Items must include safe object references, display labels, status summary, risk summary, blocker summary, and action descriptors. Action descriptors name existing command routes; they do not invent hidden client-only commands.

### Intake

Intake is the Work Item Owner MVP. It is typed by Initiative, Requirement, Bug, and Tech Debt so it does not collapse every owner workflow into one coarse queue.

`GET /query/workbenches/intake` returns Work Item type metadata plus draft, triage, and ready-for-spec Work Items grouped by type. Items include missing required fields, owner assignment status, risk status, success criteria status, and Work Item Brief status.

Full generated Work Item Briefs remain a later PRD module. The MVP substitute is a structured readiness summary derived from existing Work Item fields: `goal`, `success_criteria`, `priority`, `risk`, `owner_actor_id`, and linked Spec status. Actions link to `POST /work-items`, `PATCH /work-items/:workItemId`, `POST /work-items/:workItemId/specs`, and `POST /specs/:specId/generate-draft`.

`PATCH /work-items/:workItemId` is owned by `WorkItemService`. It supports updating the MVP readiness fields `goal`, `success_criteria`, `priority`, `risk`, and `owner_actor_id`, plus allowed Work Item state/readiness transitions that are not owned by Spec/Plan, Execution, Review, or Release services.

### Spec Approver Workbench

Shows Specs awaiting review, missing test strategy summaries, risk notes, current revision links, and approve/request-changes actions.

`GET /query/workbenches/spec-approver` returns Specs with `gate_state=awaiting_approval` or `gate_state=changes_requested`, their current revision summary, missing test-strategy signal, risk notes, Work Item reference, and actions for approve/request changes.

### Execution Owner Workbench

Shows ExecutionPackages, dependency status, ready gate state, active runs, blockers, and next actions.

`GET /query/workbenches/execution-owner` returns packages grouped by draft, ready, active run, blocked, and review handoff. Items include dependency status, ready gate state, latest run summary, current ReviewPacket reference, and actions for patch, mark ready, run, rerun, or force rerun when allowed.

### Reviewer Workbench

Shows ready/in-review ReviewPackets, changed-file summaries, check summaries, self-review summaries, requested changes, and review decisions.

`GET /query/workbenches/reviewer` returns ReviewPackets with status `ready` or `in_review`, sorted by risk and age. Items include changed-file count, check summary, self-review summary, requested changes, linked package, linked Work Item, and review decision actions.

### QA / Test Owner Workbench

MVP uses existing fields:

- Spec test strategy summary;
- package required checks;
- package required artifacts;
- failed or missing required checks;
- release blockers related to readiness, tests, and artifacts;
- evidence chain links.

It does not introduce standalone TestAsset or TestRun tables yet.

`GET /query/workbenches/qa-test-owner` returns Work Items, packages, and releases that have missing or failed test evidence. Items include test strategy summary, required checks, required artifacts, missing artifact kinds, failed blocking checks, release blocker references, and evidence chain links.

The QA/Test MVP is also a release-blocking Test/Acceptance gate, not only a dashboard. The gate is computed from existing Spec test strategy summaries, acceptance criteria, package required checks and artifacts, failed or missing blocking checks, release blockers, and evidence-chain links.

Release submit and approve commands must reject linked Work Items or packages with an unmet Test/Acceptance gate unless an explicit override decision is recorded. High-risk Work Items require QA/Test Owner acknowledgement before release approval. The acknowledgement is represented as a decision/audit record in this slice rather than a new TestAsset table.

`POST /releases/:releaseId/test-acceptance/acknowledge` records the QA/Test Owner acknowledgement required by the gate. It is owned by `ReleaseService` because the gate is release-blocking, and it writes a decision/audit record through `AuditWriterService` scoped to the release and its linked Work Items/packages. QA/Test Owner workbench items expose this route as an action descriptor when acknowledgement is required.

### Release Owner Workbench

Reuses the existing Release/Risk Radar capability under the cleaned delivery naming. It surfaces release scope, blockers, checklist, risk summary, observations, evidence, approval, observing, and close controls.

`GET /query/workbenches/release-owner` returns Releases grouped by candidate, approval, rollout, observing, and blocked. It may reuse release cockpit projection per item but must include enough summary for a list view without one request per release.

Release Owner items must include `rollout_strategy_summary`, `rollback_plan_summary`, `release_decision_summary`, `missing_release_plan_blockers`, `test_evidence_summary`, and `observation_backlinks`. Full deployment unit, version, and rollback inventory remain future PRD modules, but this slice requires a minimal rollback plan or explicit override decision before release approval.

### Manager Health View

Shows process health only:

- stage counts;
- items blocked by missing Spec, Plan, package readiness, review, test evidence, or release blocker;
- review backlog;
- package run failure distribution;
- release readiness distribution;
- quality gaps from required checks and artifacts.

It must not include individual scoring, ranking, performance grades, or compensation-facing summaries.

`GET /query/workbenches/manager-health` returns aggregate counts and blocker groups only. It may include object links for drilldown, but it must not include per-person score fields, ranked actor lists, performance grades, compensation notes, or promotion recommendations.

## Data Flow

The delivery flow remains:

1. A typed Work Item is created.
2. A Spec is created, drafted, revised, submitted, and approved.
3. A Plan is created, drafted, revised, submitted, and approved.
4. ExecutionPackages are generated or manually created from the approved PlanRevision.
5. Packages pass mark-ready gates.
6. A run is enqueued.
7. Run events stream publicly through filtered events.
8. The worker finalizes the run and creates review evidence.
9. ReviewPacket decisions update package state.
10. Test/Acceptance gate status is computed from existing strategy, check, artifact, blocker, and evidence records.
11. Evidence Chain and role workbenches project the result.
12. Release Owner links Work Items and packages into Release candidates and manages approval/observation/close.
13. Manager Health summarizes flow state without personal scoring.

The service split must keep each transition owned by one command service. Shared query projections can compose across services through the repository, but write paths must not be duplicated.

## PRD V1 Alignment And Product Closure

This slice targets the first usable product closure from `docs/PRD_v1.md`, not the full PRD end state.

After this slice, ForgeLoop should have a coherent delivery-loop MVP:

- typed Work Item intake for Initiative, Requirement, Bug, and Tech Debt;
- Spec and Plan drafting, revision, submit, approve, and request-changes gates;
- ExecutionPackage creation, dependency checks, readiness checks, run control, and review handoff;
- public run event viewing and operator controls;
- ReviewPacket decisions and Evidence Chain projection;
- Release candidate, approval, observation, and close flows;
- a minimal Test/Acceptance gate before Release approval;
- role workbenches for intake, Spec approver, execution owner, reviewer, QA/Test owner, release owner, and manager process health;
- no old P0 namespace or compatibility surface.

The remaining PRD v1 gaps are explicit future modules, not hidden requirements of this boundary cleanup:

- container planning beyond Project: Stream, Iteration, and Milestone;
- standalone TestAsset, TestRun, test case, and regression asset management;
- Contract, Mock, Fixture, and cross-end integration readiness objects;
- Environment, Artifact, Version, deployment unit, and rollback inventory;
- Incident object, Incident Replay, Daily Replay, and retrospective workflows;
- Rule Proposal, Skill Proposal, Template Proposal, and learning-loop adoption workflows;
- multi-agent assignment recommendations based on load, historical collaboration, and role expertise;
- governed performance-reference insights with privacy, evidence review, appeal, and calibration controls.

The MVP must still leave extension points for these PRD modules through object events, status history, decisions, trace links, evidence chain references, and role workbench action descriptors. It must not invent partial tables for these modules in this slice.

### Minimal Process Replay

`GET /query/replay/:objectType/:objectId` is an MVP Process Replay projection, not the full retrospective/evolution product.

Supported MVP object types are:

- `work_item`;
- `execution_package`;
- `review_packet`;
- `release`.

The response composes object events, status history, decisions, trace links, and evidence-chain references for the requested object. Role workbench items may link to this projection for context. Daily Replay, Incident Replay, retrospective workflows, and Rule/Skill/Template proposal adoption remain future modules.

## Executor Runtime Safety Boundary

This design changes control-plane module boundaries and product naming. It does not change executor safety behavior.

The current module wiring creates Codex drivers, fallback drivers, evidence capture, and run-worker startup in the old module. This design may relocate that provider factory into `RunControlModule`, but the relocation must be behavior-preserving. It must not introduce new path policy semantics, command execution semantics, resource limits, hook behavior, fallback policy, artifact redaction, or safety attestation rules.

The parallel executor runtime safety design owns:

- path safety;
- path policy;
- runtime policy loading;
- structured command validation/execution;
- resource governor enforcement;
- hook runner behavior;
- fallback execution policy;
- artifact visibility and redaction policy;
- production runtime safety attestation semantics.

`ExecutionPackageService` may check only control-plane fields that already exist or are delivered by the runtime safety work, such as snapshot presence, snapshot status, expected version, and attestation object presence. It must call shared executor/runtime-safety APIs for safety validation once those APIs exist. It must not duplicate executor-owned policy matching or command validation.

Implementation ordering must include a dependency gate:

1. If the runtime safety branch still imports or edits files under the old namespace, move shared helpers first and coordinate that branch to import the new helper paths.
2. If runtime safety has already landed, this migration consumes its exported APIs and preserves its tests.
3. If runtime safety has not landed, this migration relocates DI/provider wiring only and leaves safety behavior unchanged.

Before deleting the old namespace, the implementation owner must coordinate with the runtime-safety owner to update or supersede active runtime-safety specs, plans, and branch references from `p0-repository.ts`/`P0Repository` to `delivery-repository.ts`/`DeliveryRepository`. Final delivery acceptance fails while any active runtime-safety spec, plan, or branch targets the old repository namespace, except for historical migration notes explicitly marked superseded.

## Error Handling

Known domain errors remain public-safe and structured. The migration must preserve current behavior for:

- stale package revisions;
- stale Spec/Plan graph references;
- missing required checks/artifacts;
- duplicate active runs;
- open ReviewPacket blocking duplicate run;
- unauthorized actor contexts;
- forbidden automation actors at product gates;
- manual-path holds;
- release gate blockers;
- malformed stream tokens;
- run commands against terminal runs.

New routes must return the same effective HTTP status and public error body as the old behavior unless a product naming change is required. Tests must assert behavior, not just snapshots of old text.

Best-effort trace writes must remain best-effort. A trace write failure must not fail the authoritative delivery command.

## Testing Strategy

Use focused tests for each extracted service before relying on end-to-end tests.

Focused tests:

- Project/repo command behavior through `ProjectService`;
- Work Item type creation and type metadata;
- durable enum/schema support for `initiative`;
- Work Item Owner/Intake readiness projection;
- Work Item readiness update command through `PATCH /work-items/:workItemId`;
- Spec/Plan gate transitions;
- package generation/edit/ready graph validation;
- Test/Acceptance gate computation and release blocking behavior;
- QA/Test Owner acknowledgement command and explicit release override paths;
- run/rerun/force-rerun enqueue behavior;
- run event list, SSE cursor behavior, and stream tokens;
- input/cancel/resume commands;
- ReviewPacket approve/request-changes behavior;
- Evidence Chain response behavior;
- automation command delegation and removal of duplicated logic;
- release/query behavior under renamed routes;
- minimal Process Replay projection shape and supported object-type validation;
- role workbench query projection shapes and action descriptors.

Integration and regression tests:

- delivery-flow API tests;
- run auth tests;
- run event tests;
- run console E2E tests;
- automation command tests;
- automation daemon integration tests;
- release module tests;
- release-flow dogfood;
- `pnpm smoke:delivery`;
- `pnpm dogfood:delivery`;
- `pnpm dogfood:delivery:durable`;
- `pnpm dogfood:delivery:work-items`;
- strict local Codex dogfood where environment allows it;
- run-console E2E;
- build.

Naming cleanup tests:

- no `apps/control-plane-api/src/p0` directory;
- no `P0Service`, `P0Module`, or `P0Controller`;
- no `packages/db/src/repositories/p0-repository.ts`, `in-memory-p0-repository.ts`, `drizzle-p0-repository.ts`, or package export paths using those names;
- no `P0Repository`, `InMemoryP0Repository`, `DrizzleP0Repository`, `createDrizzleP0Repository`, `P0_REPOSITORY`, or `P0_DEMO_ACTOR_ID_FALLBACK`;
- no `RUN_WORKER`, `withP0Transaction`, `p0-transaction`, old subsystem lock-key prefixes, `forgeloop-p0-package-execution`, `uuidBackedP0IdPrefixes`, or old P0 product-copy strings such as `P0 control plane` and `P0 API`;
- no `forgeloop://p0/*` package policy URI, `p0-default-policy`, `p0-manual-package-policy`, `[forgeloop:p0.trace]`, or generated `P0 delivery path` marker;
- no public route test using an old prefix;
- no old `/p0/...` public automation handlers registered; the old public automation route paths return the framework's normal not-found response;
- no root package script using old P0 command names;
- no web client path using an old prefix;
- no stale duplicated automation-command implementation in delivery services.

Current README, scripts, test names, generated report paths, dogfood docs, active plans, active specs, and product docs must use delivery/product terminology. Historical git history is not rewritten.

Final naming cleanup verification must run a repository-wide search over code, tests, scripts, package exports, active docs, and generated report names. It must find no historical subsystem identifiers matching:

```text
P0|p0|p0-|p0_|p0\.|p0/|/p0|forgeloop:p0|forgeloop://p0
```

The only allowed matches are explicit priority values such as `priority: "P0"`, this migration spec while it is the active rename plan, and historical migration notes explicitly marked superseded. As part of final implementation cleanup, active specs such as `docs/superpowers/specs/2026-05-15-http-automation-daemon-mvp-design.md` must be updated or superseded so they no longer instruct `/p0/...` compatibility.

This gate must catch old colon command names such as `smoke:p0`, `dogfood:p0`, `dogfood:p0:durable`, `dogfood:p0:local-codex`, and `dogfood:p0:work-items` across package scripts, docs, CI, tests, and generated report names.

## Implementation Sequence

1. Move shared infrastructure to the canonical destinations listed above.
2. Rename repository contracts and Nest tokens to delivery terminology.
3. Create `ProjectService`, `DeliveryModule`, `AuditWriterService`, `PublicRunSessionProjection`, and empty target delivery services wired through Nest dependency injection.
4. Relocate run-worker provider wiring into run-control ownership without changing executor safety behavior.
5. Extract `RunControlService` because it has the densest runtime behavior and a clear boundary.
6. Extract `ExecutionPackageService`.
7. Extract `ReviewEvidenceService`, using `AuditWriterService` for shared audit writes.
8. Extract `SpecPlanService`.
9. Extract `WorkItemService` and add `initiative` plus Work Item type metadata.
10. Remove stale duplicated automation-command private logic.
11. Replace the old controller with semantic controllers and the exact route map above.
12. Add product-facing automation settings/manual-path routes while keeping internal daemon routes separate.
13. Rename API client methods and web route calls.
14. Rename scripts, dogfood commands, tests, fixtures, README sections, report paths, and active docs.
15. Delete the old namespace.
16. Add role workbench query endpoints.
17. Add role workbench matrix navigation and MVP panels.
18. Add Test/Acceptance gate checks and QA/Test acknowledgement command to Release submit and approve paths.
19. Add minimal Process Replay projection.
20. Run focused tests, full tests, build, smoke, dogfood, run-console E2E, and release-flow verification under the new command names.

## Acceptance Criteria

- `apps/control-plane-api/src/p0/**` is deleted.
- The codebase has no `P0Service`, `P0Module`, or `P0Controller`.
- The codebase has no old repository filenames or package export paths: `p0-repository.ts`, `in-memory-p0-repository.ts`, `drizzle-p0-repository.ts`, `p0-repository`, `in-memory-p0-repository`, or `drizzle-p0-repository`.
- The codebase has no historical delivery repository names or tokens: `P0Repository`, `InMemoryP0Repository`, `DrizzleP0Repository`, `createDrizzleP0Repository`, `P0_REPOSITORY`, or `P0_DEMO_ACTOR_ID_FALLBACK`.
- The codebase has no `RUN_WORKER`, `withP0Transaction`, old subsystem lock-key prefixes, `forgeloop-p0-package-execution`, `uuidBackedP0IdPrefixes`, package policy URI/digest leftovers, logger namespace leftovers, or old P0 product-copy strings except explicit priority values, this migration spec while active, and superseded historical notes.
- The codebase uses `ProjectService`, `DeliveryModule`, `WorkItemService`, `SpecPlanService`, `ExecutionPackageService`, `RunControlService`, `ReviewEvidenceService`, `AuditWriterService`, and `PublicRunSessionProjection` with the ownership described above.
- Shared providers are exported by `AuditModule`, `AuthModule`, `HttpSupportModule`, and `ProjectionModule`; release, automation, query, run-control, and delivery command modules import them directly without importing `DeliveryModule` for shared infrastructure.
- No long-term compatibility controller or facade calls into renamed delivery services.
- Public API routes do not use the old route prefix.
- Public API routes match the route table in this spec.
- Old public `/p0/...` automation routes are unregistered and return not-found; all scripts, tests, web clients, and active docs use `/automation/...`.
- Automation capability routes preserve repo-scoped behavior through optional `repo_id` query/body fields.
- Root package scripts, README instructions, dogfood commands, test names, report paths, active docs, and web API clients use delivery/product naming.
- Package policy URIs, policy digests, logger namespaces, generated report markers, and generated evidence text use delivery/product naming.
- `AutomationCommandService` is the only daemon command boundary.
- Internal `/internal/automation` routes remain internal daemon APIs; public automation settings/manual-path routes are separate and product-facing.
- `ReleaseService` and `QueryService` still work after route/client naming cleanup.
- Work Item intake exposes Initiative, Requirement, Bug, and Tech Debt.
- Domain, DB schema, API DTOs, contracts, web types, and tests all support `initiative`.
- `GET /work-item-types` exposes type metadata for the four built-in Work Item kinds.
- `PATCH /work-items/:workItemId` updates the MVP readiness fields and allowed Work Item readiness transitions owned by `WorkItemService`.
- Role workbench query endpoints return non-static projections with action descriptors wired to real command routes.
- Intake is the Work Item Owner MVP and exposes typed draft, triage, and ready-for-spec queues with readiness summaries and real action descriptors.
- Role workbench matrix includes Work Item Owner/Intake, Spec Approver, Execution Owner, Reviewer, QA/Test Owner, Release Owner, and Manager Health.
- Release submit and approve enforce the minimal Test/Acceptance gate, including QA/Test Owner acknowledgement for high-risk Work Items through `POST /releases/:releaseId/test-acceptance/acknowledge` or an explicit override decision.
- Release Owner projections include rollout, rollback, decision, blocker, test evidence, and observation summaries.
- Minimal Process Replay supports Work Item, ExecutionPackage, ReviewPacket, and Release projections from existing audit/evidence records.
- Manager Health does not include personal scoring or performance ranking.
- Existing delivery, run, review, evidence, automation, release, durable, and web E2E behavior remains covered by tests under the new names.
- The executor runtime safety design remains separate; this refactor does not take ownership of executor safety modules.
- Active runtime-safety specs, plans, and branches no longer target old repository names before this migration deletes the old namespace, except for superseded historical migration notes.
- The spec explicitly identifies the remaining PRD v1 modules outside this slice, and the MVP leaves audit/evidence extension points for them without creating partial product tables.
