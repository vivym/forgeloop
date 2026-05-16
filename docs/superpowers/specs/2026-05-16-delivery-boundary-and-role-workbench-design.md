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

- `DeliveryModule`
- `WorkItemService`
- `SpecPlanService`
- `ExecutionPackageService`
- `RunControlService`
- `ReviewEvidenceService`
- `AutomationCommandService`
- existing `ReleaseService`
- existing `QueryService`

The user-facing product surface becomes a role matrix:

- Initiative / Requirement / Bug / Tech Debt intake
- Spec Approver Workbench
- Execution Owner Workbench
- Reviewer Workbench
- QA / Test Owner Workbench
- Release Owner Workbench
- Manager Health View

## Architecture

### Module Ownership

`DeliveryModule` replaces the historical P0 module and imports the shared core, automation, release, and query modules.

`WorkItemService` owns:

- Project creation and lookup if a separate Project module is not introduced in the same slice;
- repo binding and repo listing if a separate Project module is not introduced;
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
- RunSession lookup and public serialization;
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
- object event writes;
- status history writes;
- decision writes;
- trace-event writes that are currently best-effort.

`AutomationCommandService` remains the single command boundary for daemon-origin automation:

- automation capability settings;
- manual-path holds;
- idempotent plan draft creation;
- idempotent package draft creation;
- package generation supersede approval;
- run enqueue through automation, once a later design enables it.

The refactor must remove duplicated private automation-command code from the old service instead of copying it into a new service.

### Shared Infrastructure

The following files are infrastructure, not product-domain files, and must move out of the old namespace:

- actor context helpers;
- trusted actor header signing and verification;
- run event stream token helpers;
- domain error filter;
- Zod validation pipe;
- run worker injection token;
- generic object-event/status-history/decision writer helpers if they are shared across services.

Reasonable target locations are `apps/control-plane-api/src/modules/core`, `apps/control-plane-api/src/modules/http`, and service-local helper files under the new delivery modules.

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

Route names use product terminology. The exact route map is finalized during planning, but the route family must avoid historical P0 prefixes. Examples:

- `POST /projects`
- `POST /projects/:projectId/repos`
- `POST /work-items`
- `GET /work-items`
- `POST /work-items/:workItemId/specs`
- `POST /specs/:specId/approve`
- `POST /work-items/:workItemId/plans`
- `POST /plans/:planId/approve`
- `POST /plan-revisions/:planRevisionId/execution-packages`
- `POST /execution-packages/:packageId/mark-ready`
- `POST /execution-packages/:packageId/run`
- `GET /run-sessions/:runSessionId/events`
- `GET /run-sessions/:runSessionId/events/stream`
- `POST /run-sessions/:runSessionId/input`
- `POST /review-packets/:reviewPacketId/approve`
- `GET /query/work-item-cockpit/:workItemId`
- `GET /query/release-cockpit/:releaseId`
- delivery automation routes without an old prefix, for example `/delivery/automation/capabilities` or equivalent product wording.

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

The storage model may remain compatible with the existing `kind` field in the first slice, but the API and UI must expose type metadata so later work can add configurable type templates without hardcoding every field into the web app.

Bug and Tech Debt may use simplified branches later, but this slice only needs to prevent type erasure in intake and role navigation.

## Role Workbench Matrix

The first product experience after backend cleanup is a role matrix, not a single all-purpose demo workbench.

### Intake

Intake shows Initiative, Requirement, Bug, and Tech Debt entry points. Each entry point creates a typed Work Item and guides the user toward the next state.

### Spec Approver Workbench

Shows Specs awaiting review, missing test strategy summaries, risk notes, current revision links, and approve/request-changes actions.

### Execution Owner Workbench

Shows ExecutionPackages, dependency status, ready gate state, active runs, blockers, and next actions.

### Reviewer Workbench

Shows ready/in-review ReviewPackets, changed-file summaries, check summaries, self-review summaries, requested changes, and review decisions.

### QA / Test Owner Workbench

MVP uses existing fields:

- Spec test strategy summary;
- package required checks;
- package required artifacts;
- failed or missing required checks;
- release blockers related to readiness, tests, and artifacts;
- evidence chain links.

It does not introduce standalone TestAsset or TestRun tables yet.

### Release Owner Workbench

Reuses the existing Release/Risk Radar capability under the cleaned delivery naming. It surfaces release scope, blockers, checklist, risk summary, observations, evidence, approval, observing, and close controls.

### Manager Health View

Shows process health only:

- stage counts;
- items blocked by missing Spec, Plan, package readiness, review, test evidence, or release blocker;
- review backlog;
- package run failure distribution;
- release readiness distribution;
- quality gaps from required checks and artifacts.

It must not include individual scoring, ranking, performance grades, or compensation-facing summaries.

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
10. Evidence Chain and role workbenches project the result.
11. Release Owner links Work Items and packages into Release candidates and manages approval/observation/close.
12. Manager Health summarizes flow state without personal scoring.

The service split must keep each transition owned by one command service. Shared query projections can compose across services through the repository, but write paths must not be duplicated.

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

- Work Item type creation and type metadata;
- Spec/Plan gate transitions;
- package generation/edit/ready graph validation;
- run/rerun/force-rerun enqueue behavior;
- run event list, SSE cursor behavior, and stream tokens;
- input/cancel/resume commands;
- ReviewPacket approve/request-changes behavior;
- Evidence Chain response behavior;
- automation command delegation and removal of duplicated logic;
- release/query behavior under renamed routes.

Integration and regression tests:

- delivery-flow API tests;
- run auth tests;
- run event tests;
- run console E2E tests;
- automation command tests;
- automation daemon integration tests;
- release module tests;
- release-flow dogfood;
- smoke dogfood;
- strict local Codex dogfood where environment allows it;
- build.

Naming cleanup tests:

- no `apps/control-plane-api/src/p0` directory;
- no `P0Service`, `P0Module`, or `P0Controller`;
- no public route test using an old prefix;
- no root package script using old P0 command names;
- no web client path using an old prefix;
- no stale duplicated automation-command implementation in delivery services.

Historical documentation can mention the old name only when describing past reports or migration rationale. Current README, scripts, test names, and product docs must use delivery/product terminology.

## Implementation Sequence

1. Move shared infrastructure out of the old namespace.
2. Create `DeliveryModule` and empty target services wired through Nest dependency injection.
3. Extract `RunControlService` because it has the densest runtime behavior and a clear boundary.
4. Extract `ExecutionPackageService`.
5. Extract `ReviewEvidenceService`.
6. Extract `SpecPlanService`.
7. Extract `WorkItemService`.
8. Remove stale duplicated automation-command private logic.
9. Replace the old controller with semantic controllers.
10. Rename API client methods and web route calls.
11. Rename scripts, dogfood commands, tests, fixtures, and README sections.
12. Delete the old namespace.
13. Add role workbench matrix navigation and MVP panels.
14. Run focused tests, full tests, build, smoke, dogfood, run-console E2E, and release-flow verification.

## Acceptance Criteria

- `apps/control-plane-api/src/p0/**` is deleted.
- The codebase has no `P0Service`, `P0Module`, or `P0Controller`.
- No long-term compatibility controller or facade calls into renamed delivery services.
- Public API routes do not use the old route prefix.
- Root package scripts, README instructions, dogfood commands, test names, and web API clients use delivery/product naming.
- `AutomationCommandService` is the only daemon command boundary.
- `ReleaseService` and `QueryService` still work after route/client naming cleanup.
- Work Item intake exposes Initiative, Requirement, Bug, and Tech Debt.
- Role workbench matrix includes Spec Approver, Execution Owner, Reviewer, QA/Test Owner, Release Owner, and Manager Health.
- Manager Health does not include personal scoring or performance ranking.
- Existing delivery, run, review, evidence, automation, release, durable, and web E2E behavior remains covered by tests under the new names.
- The executor runtime safety design remains separate; this refactor does not take ownership of executor safety modules.

